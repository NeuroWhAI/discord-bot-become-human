import type { CommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if the bot is alive.');

export const execute = async (interaction: CommandInteraction) => {
  if (!interaction.isRepliable()) return;

  await interaction.reply('Pong!');
};
