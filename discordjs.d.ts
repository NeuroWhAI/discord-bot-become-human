import type { Collection, Interaction } from "discord.js";

// Define the structure of a command
interface Command {
  name: string;
  description: string;
  execute: (interaction: Interaction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}
