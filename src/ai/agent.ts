import { decodeBase64 } from 'std/encoding/base64.ts';
import OpenAI from 'openai';
// @deno-types="npm:@types/mime-types"
import mime from 'mime-types';
import { ChatMessage } from '../chat/chat-message.ts';
import { ChatCompletionTool, getTool, ToolContext } from './tool.ts';

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

  private readonly toolContext: ToolContext = new ToolContext();

  private summaryTarget: string = '';
  private incomingSummaryTarget: string = '';
  private messages: AgentMessage[] = [];
  private incomingMessages: AgentMessage[] = [];
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
    this.incomingSummaryTarget = '';
    this.messages = [{
      role: 'system',
      content: this.chatPrompt,
    }];
    this.incomingMessages = [];
    this.prevSummaryIndices = [];
    this.chatting = false;
    this.thinking = false;
  }

  public async chat(
    newMessages: ChatMessage[],
    fileCallback: (file: Uint8Array, format: string) => Promise<void>,
  ): Promise<string> {
    // 새 대화 이력 추가.
    for (const msg of newMessages) {
      let text = `${msg.author} — ${localeDate(msg.date)}\n${msg.content}`;

      if (msg.imageUrls.length > 0) {
        text += '\nattached image IDs:';
        for (const imgUrl of msg.imageUrls) {
          const id = this.toolContext.fileStorage.setImageUrl(imgUrl);
          text += `\n- ${id}`;
        }
      }
      if (msg.fileUrls.length > 0) {
        text += '\nattached file IDs:';
        for (const fileUrl of msg.fileUrls) {
          const id = this.toolContext.fileStorage.setFileUrl(fileUrl);
          text += `\n- ${id}`;
        }
      }

      let imageUrls: string[];

      if (msg.refMessage) {
        const refMsg = msg.refMessage;
        let refText = `${refMsg.author} — past\n${refMsg.content}`;

        if (refMsg.imageUrls.length > 0) {
          refText += '\nattached image IDs:';
          for (const imgUrl of refMsg.imageUrls) {
            const id = this.toolContext.fileStorage.setImageUrl(imgUrl);
            refText += `\n- ${id}`;
          }
        }
        if (refMsg.fileUrls.length > 0) {
          refText += '\nattached file IDs:';
          for (const fileUrl of refMsg.fileUrls) {
            const id = this.toolContext.fileStorage.setFileUrl(fileUrl);
            refText += `\n- ${id}`;
          }
        }

        text = refText + '\n--- Referred to by the following message ---\n' +
          text;

        imageUrls = [...refMsg.imageUrls, ...msg.imageUrls];
      } else {
        imageUrls = msg.imageUrls;
      }

      if (this.incomingSummaryTarget) {
        this.incomingSummaryTarget += `\n\n${text}`;
      } else {
        this.incomingSummaryTarget = text;
      }

      if (imageUrls.length) {
        this.incomingSummaryTarget += '\n(attached images)';
      }
      if (msg.fileUrls.length || msg.refMessage?.imageUrls.length) {
        this.incomingSummaryTarget += '\n(attached files)';
      }

      this.incomingMessages.push({
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

    if (this.incomingSummaryTarget) {
      if (this.summaryTarget) {
        this.summaryTarget += `\n\n${this.incomingSummaryTarget}`;
      } else {
        this.summaryTarget = this.incomingSummaryTarget;
      }
      this.incomingSummaryTarget = '';
    }

    if (this.incomingMessages.length > 0) {
      this.messages.push(...this.incomingMessages);
      this.incomingMessages = [];
    }

    const backupSummaryTarget = this.summaryTarget;
    const backupMessages = [...this.messages];
    const backupPrevSummaryIndices = [...this.prevSummaryIndices];

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
              ? await tool.execute(functionArg, this.toolContext)
              : `The ${functionName} tool not found!`;
          } catch (err) {
            toolRes = `The ${functionName} tool failed to execute!\n${
              (err as Error).message
            }`;
          }

          const toolMessage: AgentMessage = {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: toolRes,
          };

          if (toolRes.startsWith('data:')) {
            console.log(`# Tool response: (file)`);

            try {
              const fileData = toolRes.substring(toolRes.indexOf(',') + 1);
              const fileMime = /data:([\w\/]+);/g.exec(toolRes)?.[1] ??
                'application/octet-stream';
              const fileFormat = mime.extension(fileMime) || 'bin';
              await fileCallback(decodeBase64(fileData), fileFormat);

              if (toolRes.startsWith('data:image')) {
                const imgId = this.toolContext.fileStorage.setImageUrl(toolRes);

                toolMessage.content =
                  `The image(ID: ${imgId}) has been successfully shared with users.` +
                  '\n(Do not print the ID.)';

                afterToolMessages.push({
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `assistant generated image (ID: ${imgId})`,
                    },
                    { type: 'image_url', image_url: { url: toolRes } },
                  ],
                });
              } else {
                const fileId = this.toolContext.fileStorage.setFileUrl(toolRes);

                toolMessage.content =
                  `The file(ID: ${fileId}) has been successfully shared with users.` +
                  '\n(Do not print the ID. The file name has been changed to this ID.)';
              }
            } catch (err) {
              toolMessage.content = `Fail to share the file with users.\n${
                (err as Error).message
              }`;
            }
          } else {
            console.log(`# Tool response:\n${toolRes}`);
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
