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
  private _messages: AgentMessage[] = [];
  private prevSummaryIndices: number[] = [];

  public get messages(): ReadonlyArray<AgentMessage> {
    return this._messages;
  }
  private set messages(v: AgentMessage[]) {
    this._messages = v;
  }

  public get size(): number {
    return this.messages.length;
  }

  public appendMessage(message: AgentMessage) {
    this._messages.push(message);
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
    ctx.messages = [...this.messages];
    ctx.prevSummaryIndices = [...this.prevSummaryIndices];
    return ctx;
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
      this.prevSummaryIndices.length > 3 ||
      (this.prevSummaryIndices.length > 0 && this.messages.length > 64)
    ) {
      this.messages = [
        this.messages[0], // System message.
        ...this.messages.slice(this.prevSummaryIndices[0]),
      ];
      for (let i = 1; i < this.prevSummaryIndices.length; i++) {
        this.prevSummaryIndices[i] -= this.prevSummaryIndices[0] - 1;
      }
      this.prevSummaryIndices = this.prevSummaryIndices.slice(1);
    }

    // 토큰 사용량 절약을 위해 좀 이전의 메시지 내 이미지들은 삭제.
    if (this.prevSummaryIndices.length > 0 || this.messages.length > 64) {
      const expiredEndIndex = this.prevSummaryIndices.length > 0
        ? this.prevSummaryIndices[this.prevSummaryIndices.length - 1]
        : this.messages.length;

      for (let i = 1; i < expiredEndIndex; i++) {
        const msg = this.messages[i];
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
    }

    this.prevSummaryIndices.push(this.messages.length);

    this._messages.push({
      role: 'user',
      content: summaryContent,
      name: 'summarizer',
    });

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
      });
      const res = completion.choices[0].message;
      const resContent = res.content?.trim() ?? '';

      return resContent.trim();
    } catch (err) {
      return `Failed to summarize.\n${(err as Error).message}`;
    }
  }
}
