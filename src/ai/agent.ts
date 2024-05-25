import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';

interface AgentMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
  name?: string;
}

export class Agent {
  constructor(
    openai: OpenAI,
    chatModel: string,
    prompt: string,
  ) {
    this.openai = openai;
    this.chatModel = chatModel;
    this.prompt = prompt;
    this.reset();
  }

  private readonly openai: OpenAI;
  private readonly chatModel: string;
  private readonly prompt: string;

  private messages: AgentMessage[] = [];
  private typing: boolean = false;

  private _running: boolean = false;
  public get running(): boolean {
    return this._running;
  }
  private set running(v: boolean) {
    this._running = v;
  }

  private reset() {
    this.messages = [{
      role: 'system',
      content: this.prompt,
    }];
    this.running = false;
    this.typing = false;
  }

  public async chat(newMessages: ChatMessage[]): Promise<string> {
    try {
      // 새 대화 이력 추가.
      for (const msg of newMessages) {
        const dateStr = msg.date.toLocaleString(undefined, {
          hour: 'numeric',
          minute: 'numeric',
          hour12: true,
        });
        const content = `${msg.author} — ${dateStr}\n${msg.content}`;
        this.messages.push({
          role: 'user',
          content,
          name: msg.authorId.replaceAll(/[^a-zA-Z0-9_-]/g, '_'),
        });
      }

      if (this.typing) {
        return '';
      }
      this.typing = true;

      this.running = true;

      const completion = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: this.messages,
        temperature: 0.5,
        top_p: 0.5,
      });
      const res = completion.choices[0].message;
      let resContent = res.content?.trim() ?? '';

      if (resContent === 'IDLE') {
        console.log('IDLE');
        return '';
      } else if (resContent.endsWith('STOP')) {
        console.log('STOP');
        this.reset();
        resContent = resContent.substring(0, resContent.length - 4);
      }

      this.messages.push({
        role: res.role,
        content: resContent,
      });

      return resContent;
    } finally {
      this.typing = false;
    }
  }
}
