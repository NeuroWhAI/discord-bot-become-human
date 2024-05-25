import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { ChatBuffer } from './chat/chat-buffer.ts';
import { ChatMessage } from './chat/chat-message.ts';
import { AgentManager } from './ai/agent-manager.ts';

const chatBuffer = new ChatBuffer();
const agentManager = new AgentManager();
const chatTriggers = new Map<string, number>();

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
  console.log(`Logged in as ${c.user.tag}`);
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
    `${msg.author.tag} — ${msg.createdAt.toLocaleTimeString()}\n${msg.cleanContent}`,
  );

  chatBuffer.append(
    channelId,
    new ChatMessage({
      authorId: msg.author.tag,
      author: msg.member ? msg.member.displayName : msg.author.displayName,
      content: msg.cleanContent,
      date: msg.createdAt,
    }),
  );

  if (msg.author.bot) {
    return;
  }

  let triggerId = chatTriggers.get(channelId);
  if (triggerId != null) {
    clearTimeout(triggerId);
    chatTriggers.delete(channelId);
  }

  const botMentioned = msg.mentions.users.some((user) =>
    user.id === botUser.id
  );
  if (botMentioned) {
    msg.channel.sendTyping();
    const messages = chatBuffer.flush(channelId);
    const respond = await agentManager.chat(channelId, messages);
    if (respond) {
      console.log(
        `${botUser.tag}\n${respond}`,
      );
      await msg.channel.send({ content: respond });
    }
  } else {
    const agentRunning = agentManager.checkRunning(channelId);
    const triggerTime = agentRunning ? 10 * 1000 : 60 * 1000;

    triggerId = setTimeout(async () => {
      chatTriggers.delete(channelId);

      const messages = chatBuffer.flush(channelId);
      const respond = await agentManager.chat(channelId, messages);
      if (respond) {
        console.log(
          `${botUser.tag}\n${respond}`,
        );
        await msg.channel.send({ content: respond });
      }
    }, triggerTime);
    chatTriggers.set(channelId, triggerId);
  }
});

client.login(env.DISCORD_TOKEN);
