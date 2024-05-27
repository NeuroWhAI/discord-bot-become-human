import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.ts';
import { ChatCompletionTool, getTool } from './tool.ts';

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
interface ChatCompletionMessageToolCallFunction {
  arguments: string;
  name: string;
}
interface ChatCompletionMessageToolCall {
  id: string;
  function: ChatCompletionMessageToolCallFunction;
  type: 'function';
}
interface AgentMessage {
  role: 'system' | 'assistant' | 'user' | 'tool';
  content: string | ChatCompletionContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
}

export class Agent {
  constructor(
    openai: OpenAI,
    chatModel: string,
    chatPrompt: string,
    summarizePrompt: string,
    tools: ChatCompletionTool[],
  ) {
    this.openai = openai;
    this.chatModel = chatModel;
    this.chatPrompt = chatPrompt;
    this.summarizePrompt = summarizePrompt;
    this.tools = tools;
    this.reset();
  }

  private readonly openai: OpenAI;
  private readonly chatModel: string;
  private readonly chatPrompt: string;
  private readonly summarizePrompt: string;
  private readonly tools: ChatCompletionTool[];

  private summaryTarget: string = '';
  private messages: AgentMessage[] = [];
  private prevSummaryIndex: number = -1;
  private typing: boolean = false;

  private _running: boolean = false;
  public get running(): boolean {
    return this._running;
  }
  public set running(v: boolean) {
    this._running = v;
  }

  private reset() {
    this.summaryTarget = '';
    this.messages = [{
      role: 'system',
      content: this.chatPrompt,
    }];
    this.prevSummaryIndex = -1;
    this.running = false;
    this.typing = false;
  }

  public async chat(newMessages: ChatMessage[]): Promise<string> {
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

      if (this.summaryTarget) {
        this.summaryTarget += `\n\n${text}`;
      } else {
        this.summaryTarget = text;
      }

      if (imageUrls.length > 0) {
        this.summaryTarget += '\n(attached images)';
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

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.chatModel,
        // deno-lint-ignore no-explicit-any
        messages: this.messages as any,
        temperature: 0.5,
        top_p: 0.5,
        // deno-lint-ignore no-explicit-any
        tools: this.tools as any,
        tool_choice: 'auto',
      });
      const res = completion.choices[0].message;
      let resContent = res.content?.trim() ?? '';

      const toolCalls = res.tool_calls;
      if (toolCalls) {
        this.messages.push({
          role: res.role,
          content: res.content ?? '',
          tool_calls: res.tool_calls,
        });

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const functionArg = toolCall.function.arguments;

          console.log(`# Calling tool: ${functionName}(${functionArg})`);

          const tool = getTool(functionName);
          const toolRes = tool
            ? await tool.execute(functionArg)
            : `The ${functionName} tool not found!`;

          console.log(`# Tool response:\n${toolRes}`);

          this.messages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: toolRes,
          });
        }

        const completion2 = await this.openai.chat.completions.create({
          model: this.chatModel,
          // deno-lint-ignore no-explicit-any
          messages: this.messages as any,
          temperature: 0.5,
          top_p: 0.5,
        });
        const res2 = completion2.choices[0].message;
        resContent = res2.content?.trim() ?? '';
      }

      let cmd: '' | 'IDLE' | 'STOP' | 'SWITCH' = '';
      if (resContent === 'IDLE') {
        cmd = 'IDLE';
      } else if (resContent.endsWith('STOP')) {
        cmd = 'STOP';
      } else if (resContent.endsWith('SWITCH')) {
        cmd = 'SWITCH';
      }

      if (cmd === 'IDLE') {
        resContent = '';
      } else {
        if (cmd === 'STOP') {
          resContent = resContent.substring(0, resContent.length - 4);
        } else if (cmd === 'SWITCH') {
          resContent = resContent.substring(0, resContent.length - 7);
        }

        this.summaryTarget += `\n\nassistant — ${
          localeDate(new Date())
        }\n${resContent}`;

        this.messages.push({
          role: res.role,
          content: resContent,
        });
      }

      if (cmd === 'STOP' || cmd === 'SWITCH') {
        console.log('# ' + cmd);

        if (cmd === 'STOP') {
          this.running = false;
        }

        const summary = await this.summarize(this.summaryTarget);
        const summaryContent =
          '--- Below is a summary of previous conversation ---\n\n' +
          summary +
          '\n\n--- This is end of the summary. ---';
        console.log(summaryContent);

        this.summaryTarget = summaryContent;

        if (this.prevSummaryIndex >= 0) {
          this.messages = [
            this.messages[0], // System message.
            ...this.messages.slice(this.prevSummaryIndex),
          ];
        }

        this.prevSummaryIndex = this.messages.length;
        this.messages.push({
          role: 'user',
          content: summaryContent,
          name: 'summarizer',
        });
      } else if (cmd !== 'IDLE') {
        this.running = true;
      }

      console.log(`# Context cnt: ${this.messages.length}`);

      return resContent;
    } finally {
      this.typing = false;
    }
  }

  private async summarize(content: string): Promise<string> {
    const completion = await this.openai.chat.completions.create({
      model: this.chatModel,
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
  }
}

function localeDate(date: Date) {
  return date.toLocaleString(undefined, {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });
}
