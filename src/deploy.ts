import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { REST, Routes } from 'discord.js';

const commands = [];

for (const file of Deno.readDirSync('src/commands')) {
  if (!file.name.endsWith('.ts')) continue;

  const command = await import(`./commands/${file.name}`);

  if (!('data' in command) || !('execute' in command)) {
    console.log(
      `The command at ${file.name} is missing a required "data" or "execute" property.`,
    );

    continue;
  }

  commands.push(command.data.toJSON());

  console.log(`Loaded command ${command.data.name}.`);
}

const rest = new REST().setToken(env.DISCORD_TOKEN);

await rest.put(Routes.applicationCommands(env.CLIENT_ID), {
  body: commands,
});
