import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';

interface ChatCompletionContentPartText {
  text: string;
  type: 'text';
}
interface ChatCompletionContentPartImage {
  image_url: { url: string };
  type: 'image_url';
}
type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage;
interface AgentMessage {
  role: 'system' | 'assistant' | 'user';
  content: string | ChatCompletionContentPart[];
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
        let text = `${msg.author} — ${localeDate(msg.date)}\n${msg.content}`;
        let imageUrls: string[];

        if (msg.refMessage) {
          const refMsg = msg.refMessage;
          text =
            `${refMsg.author} — past\n${refMsg.content}\n--- Referred to by the following message ---\n` +
            text;
          imageUrls = [...refMsg.imageUrls, ...msg.imageUrls];
        } else {
          imageUrls = msg.imageUrls;
        }

        this.messages.push({
          role: 'user',
          content: [
            { type: 'text', text },
            ...imageUrls.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ],
          name: msg.authorId.replaceAll(/[^a-zA-Z0-9_-]/g, '_'),
        });
      }

      if (this.typing) {
        return '';
      }
      this.typing = true;

      const completion = await this.openai.chat.completions.create({
        model: this.chatModel,
        // deno-lint-ignore no-explicit-any
        messages: this.messages as any,
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
      } else {
        this.running = true;
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

function localeDate(date: Date) {
  return date.toLocaleString(undefined, {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });
}
