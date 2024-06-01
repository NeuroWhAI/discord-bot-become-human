import { decodeBase64 } from 'std/encoding/base64.ts';
import OpenAI from 'openai';
// @deno-types="npm:@types/mime-types"
import mime from 'mime-types';
import { ChatMessage } from '../chat/chat-message.ts';
import { ChatCompletionTool, getTool, ToolContext } from './tool.ts';
import { AgentMessage } from './message.ts';
import { Context } from './context.ts';
import { ChatDB } from '../db/chat-db.ts';

export class Agent {
  constructor(
    openai: OpenAI,
    model: string,
    chatPrompt: string,
    summarizePrompt: string,
    tools: ChatCompletionTool[],
    chatDB: ChatDB,
  ) {
    this.openai = openai;
    this.model = model;
    this.tools = tools;
    this.chatDB = chatDB;

    this.context = new Context(openai, model, summarizePrompt);
    this.context.appendMessage({
      role: 'system',
      content: chatPrompt,
    });
  }

  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly tools: ChatCompletionTool[];
  private readonly chatDB: ChatDB;

  private context: Context;
  private readonly toolContext: ToolContext = new ToolContext();

  private incomingTextHistory: string = '';
  private incomingMessages: AgentMessage[] = [];
  private thinking: boolean = false;

  private _chatting: boolean = false;
  public get chatting(): boolean {
    return this._chatting;
  }
  public set chatting(v: boolean) {
    this._chatting = v;
  }

  private processChatMessage(msg: ChatMessage) {
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

    if (this.incomingTextHistory) {
      this.incomingTextHistory += `\n\n${text}`;
    } else {
      this.incomingTextHistory = text;
    }

    if (imageUrls.length) {
      this.incomingTextHistory += '\n(attached images)';
    }
    if (msg.fileUrls.length || msg.refMessage?.imageUrls.length) {
      this.incomingTextHistory += '\n(attached files)';
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

  private flushChatMessages() {
    if (this.incomingTextHistory) {
      this.context.appendHistory(this.incomingTextHistory);
      this.incomingTextHistory = '';
    }

    if (this.incomingMessages.length > 0) {
      this.incomingMessages.forEach((msg) => this.context.appendMessage(msg));
      this.incomingMessages = [];
    }
  }

  public async chat(
    newMessages: ChatMessage[],
    fileCallback: (file: Uint8Array, format: string) => Promise<void>,
  ): Promise<string> {
    for (const msg of newMessages) {
      this.processChatMessage(msg);
    }

    if (this.thinking) {
      return '';
    }
    this.thinking = true;

    this.flushChatMessages();

    const backupContext = this.context.clone();

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        // deno-lint-ignore no-explicit-any
        messages: this.context.messages as any,
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
        this.context.appendMessage({
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

          this.context.appendMessage(toolMessage);
        }

        const completion2 = await this.openai.chat.completions.create({
          model: this.model,
          // deno-lint-ignore no-explicit-any
          messages: this.context.messages as any,
          temperature: 0.5,
          top_p: 0.5,
          presence_penalty: 0.1,
          frequency_penalty: 0.1,
        });
        const res2 = completion2.choices[0].message;
        resContent = res2.content?.trim() ?? '';

        afterToolMessages.forEach((msg) => this.context.appendMessage(msg));
      }

      let cmd: '' | 'IDLE' | 'STOP' = '';
      if (resContent === 'IDLE') {
        cmd = 'IDLE';
      } else if (resContent.endsWith('STOP')) {
        cmd = 'STOP';
      }

      if (cmd) {
        console.log(`# ${cmd}`);
      }

      if (cmd === 'IDLE') {
        resContent = '';
      } else {
        if (cmd === 'STOP') {
          resContent = resContent.substring(0, resContent.length - 4);
        }

        this.context.appendHistory(
          `assistant — ${localeDate(new Date())}\n${resContent}`,
        );
        this.context.appendMessage({
          role: res.role,
          content: resContent,
        });
      }

      if (cmd === 'STOP') {
        this.chatting = false;
        const summary = await this.context.compress();
        this.chatDB.store(summary)
          .then(() => console.log('# Summary stored'))
          .catch((err) => console.log(err));
      } else if (cmd !== 'IDLE') {
        this.chatting = true;
      }

      console.log(`# Context cnt: ${this.context.size}`);

      return resContent;
    } catch (err) {
      console.log((err as Error).stack);

      this.context = backupContext;

      const errMessage = `Failed to generate response.\n${
        (err as Error).message
      }`;

      this.context.appendHistory(
        `assistant — ${localeDate(new Date())}\n${errMessage}`,
      );
      this.context.appendMessage({
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
      const summary = await this.context.compress();
      this.chatDB.store(summary)
        .then(() => console.log('# Summary stored'))
        .catch((err) => console.log(err));
    } finally {
      this.thinking = false;
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
