import { decodeBase64 } from 'std/encoding/base64.ts';
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
  private prevSummaryIndices: number[] = [];
  private thinking: boolean = false;

  private _chatting: boolean = false;
  public get chatting(): boolean {
    return this._chatting;
  }
  public set chatting(v: boolean) {
    this._chatting = v;
  }

  private reset() {
    this.summaryTarget = '';
    this.messages = [{
      role: 'system',
      content: this.chatPrompt,
    }];
    this.prevSummaryIndices = [];
    this.chatting = false;
    this.thinking = false;
  }

  public async chat(
    newMessages: ChatMessage[],
    imageCallback: (image: Uint8Array, format: string) => Promise<void>,
  ): Promise<string> {
    const backupSummaryTarget = this.summaryTarget;
    const backupMessages = [...this.messages];
    const backupPrevSummaryIndices = [...this.prevSummaryIndices];

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

    if (this.thinking) {
      return '';
    }
    this.thinking = true;

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
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
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

        const afterToolMessages: AgentMessage[] = [];

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const functionArg = toolCall.function.arguments;

          console.log(`# Calling tool: ${functionName}(${functionArg})`);

          let toolRes: string;
          try {
            const tool = getTool(functionName);
            toolRes = tool
              ? await tool.execute(functionArg)
              : `The ${functionName} tool not found!`;
          } catch (err) {
            toolRes = `The ${functionName} tool failed to execute!\n${
              (err as Error).message
            }`;
          }

          console.log(`# Tool response:\n${toolRes}`);

          const toolMessage: AgentMessage = {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: toolRes,
          };

          if (toolRes.startsWith('data:image/')) {
            try {
              const imgData = toolRes.substring(toolRes.indexOf(',') + 1);
              const imgFormat = /image\/(\w+);/g.exec(toolRes)?.[1] ?? 'png';
              await imageCallback(decodeBase64(imgData), imgFormat);

              toolMessage.content =
                'The image has been successfully shared with users.';

              afterToolMessages.push({
                role: 'user',
                content: [
                  { type: 'text', text: '(assistant generated image)' },
                  { type: 'image_url', image_url: { url: toolRes } },
                ],
              });
            } catch (err) {
              toolMessage.content = `Fail to share the image with users.\n${
                (err as Error).message
              }`;
            }
          }

          this.messages.push(toolMessage);
        }

        const completion2 = await this.openai.chat.completions.create({
          model: this.chatModel,
          // deno-lint-ignore no-explicit-any
          messages: this.messages as any,
          temperature: 0.5,
          top_p: 0.5,
          presence_penalty: 0.1,
          frequency_penalty: 0.1,
        });
        const res2 = completion2.choices[0].message;
        resContent = res2.content?.trim() ?? '';

        afterToolMessages.forEach((msg) => this.messages.push(msg));
      }

      let cmd: '' | 'IDLE' | 'STOP' | 'SWITCH' = '';
      if (resContent === 'IDLE') {
        cmd = 'IDLE';
      } else if (resContent.endsWith('STOP')) {
        cmd = 'STOP';
      } else if (resContent.endsWith('SWITCH')) {
        cmd = 'SWITCH';
      }

      if (cmd) {
        console.log(`# ${cmd}`);
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
        this.chatting = cmd === 'SWITCH';
        await this.compress();
      } else if (cmd !== 'IDLE') {
        this.chatting = true;
      }

      console.log(`# Context cnt: ${this.messages.length}`);

      return resContent;
    } catch (err) {
      console.log((err as Error).stack);

      this.summaryTarget = backupSummaryTarget;
      this.messages = backupMessages;
      this.prevSummaryIndices = backupPrevSummaryIndices;

      const errMessage = `Failed to generate response.\n${
        (err as Error).message
      }`;
      this.summaryTarget += `\n\nassistant — ${
        localeDate(new Date())
      }\n${errMessage}`;

      this.messages.push({
        role: 'assistant',
        content: errMessage,
      });
      return errMessage;
    } finally {
      this.thinking = false;
    }
  }

  public async compressContext() {
    if (this.thinking) {
      return;
    }
    this.thinking = true;

    try {
      await this.compress();
    } finally {
      this.thinking = false;
    }
  }

  private async compress() {
    const summary = await this.summarize(this.summaryTarget);
    const summaryContent =
      '--- Below is a summary of previous conversation ---\n\n' +
      summary +
      '\n\n--- This is end of the summary. ---';
    console.log(summaryContent);

    this.summaryTarget = summaryContent;

    if (
      this.prevSummaryIndices.length > 3 ||
      (this.prevSummaryIndices.length > 0 && this.messages.length > 128)
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

    this.prevSummaryIndices.push(this.messages.length);

    this.messages.push({
      role: 'user',
      content: summaryContent,
      name: 'summarizer',
    });
  }

  private async summarize(content: string): Promise<string> {
    try {
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
    } catch (err) {
      return `Failed to summarize.\n${(err as Error).message}`;
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
