import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { ChatBuffer } from './chat/chat-buffer.ts';
import { ChatMessage } from './chat/chat-message.ts';
import { AgentManager } from './ai/agent-manager.ts';
import { TextBasedChannel } from 'discord.js';
import { Message } from 'discord.js';
import { MessageReaction } from 'discord.js';
import { getOGTags } from 'opengraph';

const chatBuffer = new ChatBuffer();
const agentManager = new AgentManager();
const chatTriggers = new Map<
  string,
  [number, Promise<MessageReaction> | null]
>();
const chatTimeouts = new Map<string, number>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

for (const file of Deno.readDirSync('src/commands')) {
  if (!file.name.endsWith('.ts')) continue;

  const command = await import(`./commands/${file.name}`);

  if (!('data' in command) || !('execute' in command)) {
    console.log(
      `The command at ${file.name} is missing a required "data" or "execute" property.`,
    );

    continue;
  }

  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (c) => {
  agentManager.agentName = c.user.displayName;
  console.log(`# Logged in as ${c.user.displayName}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  await command.execute(interaction);
});

client.on(Events.MessageCreate, async (msg) => {
  const channelId = msg.channelId;
  if (env.CHANNEL_WHITELIST && !env.CHANNEL_WHITELIST.includes(channelId)) {
    return;
  }

  const botUser = client.user;
  if (!botUser) {
    return;
  }

  if (msg.author.id === botUser.id) return;

  console.log(
    `[${msg.author.tag} — ${msg.createdAt.toLocaleTimeString()}]\n${msg.cleanContent}`,
  );

  const chatMsg = await makeChatMessageFrom(msg);

  if (msg.reference) {
    const refMessages = await msg.channel.messages.fetch({
      around: msg.reference.messageId,
      limit: 1,
    });
    const refMsg = refMessages.first();
    if (refMsg) {
      chatMsg.refMessage = await makeChatMessageFrom(refMsg);
    }
  }

  chatBuffer.append(
    channelId,
    chatMsg,
  );

  if (msg.author.bot) {
    return;
  }

  const triggerData = chatTriggers.get(channelId);
  if (triggerData != null) {
    const [triggerId, lookingEmoji] = triggerData;
    clearTimeout(triggerId);
    lookingEmoji?.then((emoji) => emoji.users.remove()).catch(() => {});

    chatTriggers.delete(channelId);
  }

  const timeoutId = chatTimeouts.get(channelId);
  if (timeoutId != null) {
    clearTimeout(timeoutId);
    chatTimeouts.delete(channelId);
  }

  const botMentioned = msg.mentions.users.some((user) =>
    user.id === botUser.id
  );
  if (botMentioned) {
    const loading = msg.react('⏳');
    await chat(msg.channel);
    loading.then((emoji) => emoji.users.remove()).catch(() => {});
  } else {
    const agentChatting = agentManager.checkChatting(channelId);
    const triggerTime = agentChatting
      ? 8 * 1000 + Math.floor(4 * 1000 * Math.random())
      : 5 * 60 * 1000 + Math.floor(2 * 3600 * 1000 * Math.random());

    let lookingEmoji: Promise<MessageReaction> | null = null;
    if (agentChatting) {
      lookingEmoji = msg.react('👀');
    }

    const triggerId = setTimeout(async () => {
      console.log(
        `# Triggered after ${Math.round(triggerTime / 1000 / 60)}m`,
      );
      chatTriggers.delete(channelId);

      if (agentChatting || Math.random() < 0.1) {
        console.log('# Start triggered chat');
        lookingEmoji?.then((emoji) => emoji.users.remove()).catch(() => {});
        const loading = msg.react('⏳');
        await chat(msg.channel);
        loading.then((emoji) => emoji.users.remove()).catch(() => {});
      }
    }, triggerTime);
    chatTriggers.set(channelId, [triggerId, lookingEmoji]);
  }
});

async function makeChatMessageFrom(msg: Message): Promise<ChatMessage> {
  const maxImageSize = 20 * 1024 * 1024 - 100;

  const emojiUrls: Set<string> = new Set();
  const emojiMatches = msg.content.matchAll(/<a?:\w+:(\d+)>/g);
  for (const match of emojiMatches) {
    const emojiId = match[1];
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.webp`;
    emojiUrls.add(emojiUrl);
    if (emojiUrls.size >= 3) {
      break;
    }
  }

  const imageTypes = /\.(png|jpeg|jpg|gif|webp)$/g;
  const fileTypes = /\.(txt|md|csv|json|xml)$/g;

  const imageUrls = msg.attachments
    .map((attachment) => attachment.url)
    .filter((url) => imageTypes.test(new URL(url).pathname))
    .slice(0, 4);

  const stickerUrls = msg.stickers.map((s) => s.url).filter((url) =>
    imageTypes.test(new URL(url).pathname)
  ).slice(0, 1);

  const fileUrls = msg.attachments.map((attachment) => attachment.url).filter((
    url,
  ) => fileTypes.test(new URL(url).pathname));

  const httpImageUrls: string[] = [];
  let msgContent = msg.cleanContent;

  const httpUrls = msg.content.matchAll(/\bhttps?:\/\/\S+/g);
  for (const [url] of httpUrls) {
    const pathname = new URL(url).pathname;
    if (imageTypes.test(pathname)) {
      if (httpImageUrls.length < 2) {
        httpImageUrls.push(url);
      }
    } else if (url.startsWith('https://discord.com/channels/')) {
      const match = url.match(
        /^https:\/\/discord.com\/channels\/(\d+)\/(\d+)\/(\d+)/,
      );
      if (match) {
        const [_, guildId, channelId, messageId] = match;
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (channel) {
          try {
            const linkMsg = await channel.messages.fetch(messageId);

            const author = linkMsg.member
              ? linkMsg.member.displayName
              : linkMsg.author.displayName;

            const linkText = `${author} — past\n${linkMsg.cleanContent}`;
            msgContent = linkText +
              '\n--- Referred to by the following message ---\n' + msgContent;

            if (imageUrls.length === 0) {
              const linkImgs = linkMsg.attachments
                .map((attachment) => attachment.url)
                .filter((url) => imageTypes.test(new URL(url).pathname))
                .slice(0, 4);
              imageUrls.push(...linkImgs);
            }
          } catch (err) {
            console.log(`Failed to get link message from ${url}`);
            console.log((err as Error).stack);
          }
        }
      }
    } else {
      try {
        const headRes = await fetch(url, { method: 'HEAD' });
        const contentType = headRes.headers.get('content-type');
        if (!contentType || !contentType.includes('text/html')) {
          continue;
        }

        const og = await getOGTags(url);
        let ogContent = `(URL Metadata) [${og.title}]`;
        if (og.description) {
          ogContent += ' ' + og.description;
        }

        if (og.image) {
          const ogImage = typeof og.image === 'string'
            ? og.image
            : og.image.content;
          if (ogImage && imageTypes.test(new URL(ogImage).pathname)) {
            httpImageUrls.push(ogImage);
          }
        }

        if (msgContent) {
          msgContent += '\n\n' + ogContent;
        } else {
          msgContent = ogContent;
        }
      } catch (err) {
        console.log(`Failed to get og tags from ${url}`);
        console.log((err as Error).stack);
      }
    }
  }

  let bigImageRemoved = false;
  const sizeCheckTargets = [imageUrls, httpImageUrls];
  for (const urls of sizeCheckTargets) {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let imgSize = 0;

      try {
        const headRes = await fetch(url, { method: 'HEAD' });
        imgSize = parseInt(
          headRes.headers.get('content-length') ?? '0',
        );
        if (imgSize < maxImageSize) {
          continue;
        }
      } catch (err) {
        console.log(`# Failed to fetch image ${url}\n${err}`);
      }

      urls.splice(i, 1);
      i -= 1;

      bigImageRemoved = true;
    }
  }

  if (bigImageRemoved) {
    if (msgContent) {
      msgContent += '\n\n' + '(image too large)';
    } else {
      msgContent = '(image too large)';
    }
  }

  return new ChatMessage({
    authorId: msg.author.tag,
    author: msg.member ? msg.member.displayName : msg.author.displayName,
    content: msgContent,
    date: msg.createdAt,
    imageUrls: [...emojiUrls, ...imageUrls, ...stickerUrls, ...httpImageUrls],
    fileUrls,
  });
}

async function chat(channel: TextBasedChannel) {
  const channelId = channel.id;
  const messages = chatBuffer.flush(channelId);
  const respond = await agentManager.chat(
    channelId,
    messages,
    (msg) => sendMessage(channel, msg),
    async (file, ext) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(file);
          controller.close();
        },
      });
      await channel.send({
        files: [{ attachment: stream, name: `file.${ext}` }],
      });
    },
  );

  if (respond) {
    console.log(
      `[assistant]\n${respond}`,
    );
    await sendMessage(channel, respond);

    const timeoutId = setTimeout(async () => {
      console.log('# Timeout');
      chatTimeouts.delete(channelId);
      await agentManager.stopChatting(channelId);
    }, 5 * 60 * 1000);
    chatTimeouts.set(channelId, timeoutId);
  }
}

async function sendMessage(channel: TextBasedChannel, message: string) {
  if (message.length < 2000) {
    await channel.send({ content: message });
    return;
  }

  const chunks: string[] = [];
  const lines = message.split('\n');
  let currBlockHead = '';
  for (const line of lines) {
    if (currBlockHead) {
      if (chunks[chunks.length - 1].length + line.length + 1 >= 1800) {
        if (chunks[chunks.length - 1].length + 4 < 2000) {
          chunks[chunks.length - 1] += '\n```';
        }
        chunks.push(currBlockHead);
      }

      chunks[chunks.length - 1] += '\n' + line;

      if (line.startsWith('```')) {
        currBlockHead = '';
      }
    } else if (line.startsWith('```')) {
      currBlockHead = line;
      chunks.push(line);
    } else {
      chunks.push(line);
    }
  }

  let needWait = false;
  let buffer = '';
  for (const chunk of chunks) {
    if (buffer && buffer.length + chunk.length + 1 >= 1800) {
      if (needWait) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await channel.send({ content: buffer });
      buffer = '';
      needWait = true;
    }

    if (buffer) {
      buffer += '\n' + chunk;
    } else {
      buffer = chunk;
    }
  }
  if (buffer) {
    if (needWait) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await channel.send({ content: buffer });
  }
}

client.login(env.DISCORD_TOKEN);

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

self.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error);
  event.preventDefault();
});
