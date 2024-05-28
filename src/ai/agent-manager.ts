import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';
import { Agent } from './agent.ts';
import { ChatCompletionTool, getAllTools } from './tool.ts';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class AgentManager {
  constructor() {
    this.tools = getAllTools().map((tool) => ({
      type: 'function',
      function: tool.metadata,
    }));
  }

  private readonly agents: Map<string, Agent> = new Map();
  private readonly tools: ChatCompletionTool[];

  public async chat(
    channelId: string,
    newMessages: ChatMessage[],
  ): Promise<string> {
    let agent = this.agents.get(channelId);
    if (!agent) {
      const chatPrompt = await Deno.readTextFile('prompt/chat-en.txt');
      const summarizePrompt = await Deno.readTextFile(
        'prompt/summarize-en.txt',
      );
      agent = new Agent(
        openai,
        env.OPENAI_CHAT_MODEL,
        chatPrompt.trim(),
        summarizePrompt.trim(),
        this.tools,
      );
      this.agents.set(channelId, agent);

      console.log(`# Create new ${env.OPENAI_CHAT_MODEL} agent`);
    }

    const res = await agent.chat(newMessages);
    return res;
  }

  public checkChatting(channelId: string): boolean {
    const agent = this.agents.get(channelId);
    if (!agent) return false;
    return agent.chatting;
  }

  public async stopChatting(channelId: string) {
    const agent = this.agents.get(channelId);
    if (!agent) return;
    agent.chatting = false;
    await agent.compressContext();
  }
}
