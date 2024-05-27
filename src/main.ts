import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { ChatBuffer } from './chat/chat-buffer.ts';
import { ChatMessage } from './chat/chat-message.ts';
import { AgentManager } from './ai/agent-manager.ts';
import { TextBasedChannel } from 'discord.js';
import { Message } from 'discord.js';

const chatBuffer = new ChatBuffer();
const agentManager = new AgentManager();
const chatTriggers = new Map<string, number>();
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
  console.log(`# Logged in as ${c.user.tag}`);
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

  const chatMsg = makeChatMessageFrom(msg);

  if (msg.reference) {
    const refMessages = await msg.channel.messages.fetch({
      around: msg.reference.messageId,
      limit: 1,
    });
    const refMsg = refMessages.first();
    if (refMsg) {
      chatMsg.refMessage = makeChatMessageFrom(refMsg);
    }
  }

  chatBuffer.append(
    channelId,
    chatMsg,
  );

  if (msg.author.bot) {
    return;
  }

  let triggerId = chatTriggers.get(channelId);
  if (triggerId != null) {
    clearTimeout(triggerId);
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
    msg.channel.sendTyping();
    await chat(msg.channel);
  } else {
    const agentRunning = agentManager.checkRunning(channelId);
    const triggerTime = agentRunning
      ? 8 * 1000 + Math.floor(4 * 1000 * Math.random())
      : 5 * 60 * 1000 + Math.floor(2 * 3600 * 1000 * Math.random());

    triggerId = setTimeout(async () => {
      console.log(
        `# Triggered after ${Math.round(triggerTime / 1000 / 60)}m`,
      );
      chatTriggers.delete(channelId);
      if (agentRunning || Math.random() < 0.1) {
        console.log('# Start triggered chat');
        await chat(msg.channel);
      }
    }, triggerTime);
    chatTriggers.set(channelId, triggerId);
  }
});

function makeChatMessageFrom(msg: Message): ChatMessage {
  const emojiUrls: Set<string> = new Set();
  const emojiMatches = msg.content.matchAll(/<a?:\w+:(\d+)>/g);
  for (const match of emojiMatches) {
    const [fullMatch, emojiId] = match;
    const isAnimated = fullMatch.startsWith('<a:');
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${
      isAnimated ? 'gif' : 'png'
    }`;
    if (emojiUrls.size < 3) {
      emojiUrls.add(emojiUrl);
    }
  }

  const imageUrls = msg.attachments.map((attachment) => attachment.url).filter((
    url,
  ) => /\.(png|jpeg|jpg|gif|webp)$/g.test(new URL(url).pathname)).slice(0, 4);

  const stickerUrls = msg.stickers.map((s) => s.url).filter((url) =>
    /\.(png|jpeg|jpg|gif|webp)$/g.test(new URL(url).pathname)
  ).slice(0, 1);

  return new ChatMessage({
    authorId: msg.author.tag,
    author: msg.member ? msg.member.displayName : msg.author.displayName,
    content: msg.cleanContent,
    date: msg.createdAt,
    imageUrls: [...emojiUrls, ...imageUrls, ...stickerUrls],
  });
}

async function chat(channel: TextBasedChannel) {
  const channelId = channel.id;
  const messages = chatBuffer.flush(channelId);
  const respond = await agentManager.chat(channelId, messages);
  if (respond) {
    console.log(
      `[assistant]\n${respond}`,
    );
    await channel.send({ content: respond });

    const timeoutId = setTimeout(() => {
      console.log('# Timeout');
      chatTimeouts.delete(channelId);
      agentManager.setRunning(channelId, false);
    }, 5 * 60 * 1000);
    chatTimeouts.set(channelId, timeoutId);
  }
}

client.login(env.DISCORD_TOKEN);
