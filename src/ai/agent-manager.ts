import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';
import { Agent } from './agent.ts';
import { ChatCompletionTool, getAllTools } from './tool.ts';
import { ChatDB } from '../db/chat-db.ts';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class AgentManager {
  constructor() {
    this.tools = getAllTools().map((tool) => ({
      type: 'function',
      function: tool.metadata,
    }));
  }

  private readonly agents: Map<string, Agent> = new Map();
  private readonly chatDBs: Map<string, ChatDB> = new Map();
  private readonly tools: ChatCompletionTool[];

  private _agentName: string = 'assistant';
  public get agentName(): string {
    return this._agentName;
  }
  public set agentName(v: string) {
    this._agentName = v;
  }

  public async chat(
    channelId: string,
    newMessages: ChatMessage[],
    intermMsgCallback: (msg: string) => Promise<void>,
    fileCallback: (file: Uint8Array, format: string) => Promise<void>,
  ): Promise<string> {
    let agent = this.agents.get(channelId);
    if (!agent) {
      const chatDB = new ChatDB(openai, env.OPENAI_EMBEDDING_MODEL, channelId);
      this.chatDBs.set(channelId, chatDB);

      const chatPrompt = await Deno.readTextFile('prompt/chat-en.txt');
      const summarizePrompt = await Deno.readTextFile(
        'prompt/summarize-en.txt',
      );
      agent = new Agent(
        openai,
        env.OPENAI_CHAT_MODEL,
        this.agentName,
        this.interpolatePrompt(chatPrompt.trim()),
        this.interpolatePrompt(summarizePrompt.trim()),
        this.tools,
        chatDB,
      );
      this.agents.set(channelId, agent);

      console.log(`# Create new ${env.OPENAI_CHAT_MODEL} agent`);
    }

    const res = await agent.chat(newMessages, intermMsgCallback, fileCallback);
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

  private interpolatePrompt(prompt: string) {
    return prompt.replaceAll(/\${NAME}/g, this.agentName);
  }
}
