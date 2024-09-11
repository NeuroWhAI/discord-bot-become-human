import OpenAI from 'openai';
import { AgentMessage } from './message.ts';

export class Context {
  constructor(openai: OpenAI, model: string, summarizePrompt: string) {
    this.openai = openai;
    this.model = model;
    this.summarizePrompt = summarizePrompt;
  }

  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly summarizePrompt: string;

  private textHistory: string = '';
  private context: { msg: AgentMessage; date: Date }[] = [];
  private prevSummaryIndices: number[] = [];
  private clockAppended: boolean = false;

  public get messages(): ReadonlyArray<AgentMessage> {
    return this.context.map(({ msg }) => msg);
  }

  public get size(): number {
    return this.context.length;
  }

  public appendMessage(message: AgentMessage, date?: Date) {
    if (!date) {
      date = new Date();
    }

    this.context.push({ msg: message, date });

    if (!this.clockAppended) {
      this.appendSystemClock(date);
      this.clockAppended = true;
    }
  }

  public appendHistory(history: string) {
    if (this.textHistory) {
      this.textHistory += `\n\n${history}`;
    } else {
      this.textHistory = history;
    }
  }

  public clone(): Context {
    const ctx = new Context(this.openai, this.model, this.summarizePrompt);
    ctx.textHistory = this.textHistory;
    ctx.context = [...this.context];
    ctx.prevSummaryIndices = [...this.prevSummaryIndices];
    return ctx;
  }

  public expireOldImages() {
    const now = Date.now();
    for (let i = 1; i < this.context.length; i++) {
      const { msg, date } = this.context[i];
      if (now - date.getTime() > 20 * 3600 * 1000) {
        this.expireImages(msg);
      }
    }
  }

  public async compress(): Promise<string> {
    const summary = await this.summarize(this.textHistory);
    const summaryContent =
      '--- Below is a summary of previous conversation ---\n\n' +
      summary +
      '\n\n--- This is end of the summary ---';
    console.log(summaryContent);

    this.textHistory = summaryContent;

    // 토큰 사용량 절약을 위해 최근 대화 및 요약만 남김.
    if (
      this.prevSummaryIndices.length > 1 ||
      (this.prevSummaryIndices.length > 0 && this.context.length > 32)
    ) {
      this.context = [
        this.context[0], // System message.
        ...this.context.slice(this.prevSummaryIndices[0]),
      ];
      for (let i = 1; i < this.prevSummaryIndices.length; i++) {
        this.prevSummaryIndices[i] -= this.prevSummaryIndices[0] - 1;
      }
      this.prevSummaryIndices = this.prevSummaryIndices.slice(1);
    }

    // 토큰 사용량 절약을 위해 좀 이전의 메시지 내 이미지들은 삭제.
    if (this.prevSummaryIndices.length > 0 || this.context.length > 32) {
      const expiredEndIndex = this.prevSummaryIndices.length > 0
        ? this.prevSummaryIndices[this.prevSummaryIndices.length - 1]
        : Math.floor(this.context.length * 0.7);

      for (let i = 1; i < expiredEndIndex; i++) {
        const msg = this.context[i].msg;
        this.expireImages(msg);
      }
    }

    this.prevSummaryIndices.push(this.context.length);

    this.appendMessage({
      role: 'user',
      content: summaryContent,
      name: 'summarizer',
    });

    this.clockAppended = false;

    return summary;
  }

  private async summarize(content: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.summarizePrompt,
          },
          {
            role: 'user',
            content,
          },
        ],
        temperature: 0.5,
        top_p: 0.5,
      }, { timeout: 20000 });
      const res = completion.choices[0].message;
      const resContent = res.content?.trim() ?? '';

      return resContent.trim();
    } catch (err) {
      return `Failed to summarize.\n${(err as Error).message}`;
    }
  }

  private expireImages(msg: AgentMessage) {
    if (Array.isArray(msg.content)) {
      let expiredImgCnt = 0;
      for (let j = 0; j < msg.content.length; j++) {
        const content = msg.content[j];
        if (content.type === 'image_url') {
          msg.content.splice(j, 1);
          j--;
          expiredImgCnt++;
        }
      }

      if (expiredImgCnt > 0) {
        const expirationPhrase = `(${expiredImgCnt} image${
          expiredImgCnt > 1 ? 's' : ''
        } expired)`;

        // 기존 텍스트 컨텐츠가 있으면 거기 만료 문구 추가.
        for (const content of msg.content) {
          if (content.type === 'text') {
            if (content.text) {
              content.text += '\n' + expirationPhrase;
            } else {
              content.text = expirationPhrase;
            }
            expiredImgCnt = 0;
            break;
          }
        }

        // 없으면 새 텍스트 컨텐츠로 만료 문구 추가.
        if (expiredImgCnt > 0) {
          msg.content.push({
            type: 'text',
            text: expirationPhrase,
          });
        }
      }
    }
  }

  private appendSystemClock(date: Date) {
    this.context.push({
      msg: {
        role: 'system',
        content: `Today is ${date.toLocaleString()}. just for reference.`,
        name: 'clock',
      },
      date,
    });
  }
}
