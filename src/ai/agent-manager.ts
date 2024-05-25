import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';
import { Agent } from './agent.ts';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class AgentManager {
  private readonly agents: Map<string, Agent> = new Map();

  public async chat(
    channelId: string,
    newMessages: ChatMessage[],
  ): Promise<string> {
    let agent = this.agents.get(channelId);
    if (!agent) {
      const systemPrompt = await Deno.readTextFile('prompt/chat-en.txt');
      agent = new Agent(openai, env.OPENAI_CHAT_MODEL, systemPrompt.trim());
      this.agents.set(channelId, agent);
    }

    const res = await agent.chat(newMessages);
    return res;
  }

  public checkRunning(channelId: string): boolean {
    const agent = this.agents.get(channelId);
    if (!agent) return false;
    return agent.running;
  }
}
