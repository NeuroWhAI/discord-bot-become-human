import { decodeBase64 } from 'std/encoding/base64.ts';
import OpenAI from 'openai';
// @deno-types="npm:@types/mime-types"
import mime from 'mime-types';
import { ChatMessage } from '../chat/chat-message.ts';
import { ChatCompletionTool, getTool, ToolContext } from './tool.ts';
import { AgentMessage } from './message.ts';
import { Context } from './context.ts';
import { ChatDB } from '../db/chat-db.ts';
import { Memory } from './memory.ts';

export class Agent {
  constructor(
    openai: OpenAI,
    model: string,
    agentName: string,
    chatPrompt: string,
    summarizePrompt: string,
    memorizerPrompt: string,
    tools: ChatCompletionTool[],
    chatDB: ChatDB,
    memory: Memory,
  ) {
    this.openai = openai;
    this.model = model;
    this.agentName = agentName;
    this.chatPrompt = chatPrompt;
    this.tools = tools;
    this.chatDB = chatDB;
    this.memory = memory;

    this.context = new Context(
      openai,
      model,
      summarizePrompt,
      memorizerPrompt,
      memory,
    );
    this.context.setSystemPrompt({
      role: 'system',
      content: chatPrompt +
        (memory.content
          ? '\n\nUtilize the following memories in conversations:\n' +
            memory.content
          : ''),
    });

    this.toolContext = new ToolContext(chatDB);
  }

  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly agentName: string;
  private readonly chatPrompt: string;
  private readonly tools: ChatCompletionTool[];
  private readonly chatDB: ChatDB;
  private readonly memory: Memory;

  private context: Context;
  private readonly toolContext: ToolContext;

  private incomingMessages: ChatMessage[] = [];
  private thinking: boolean = false;

  private _chatting: boolean = false;
  public get chatting(): boolean {
    return this._chatting;
  }
  public set chatting(v: boolean) {
    this._chatting = v;
  }

  private pipeChatMessage(messages: ChatMessage[]) {
    let textHistory = '';

    for (const msg of messages) {
      let text = `${msg.author} — ${localeDate(msg.date)}\n${msg.content}`;

      if (msg.imageUrls.length > 0) {
        text += '\nattached image IDs:';
        for (const imgUrl of msg.imageUrls) {
          const id = this.toolContext.fileStorage.setImageUrl(imgUrl);
          text += `\n- ${id}`;
          console.log(`# Image ${id}: ${imgUrl}`);
        }
      }
      if (msg.fileUrls.length > 0) {
        text += '\nattached file IDs:';
        for (const fileUrl of msg.fileUrls) {
          const id = this.toolContext.fileStorage.setFileUrl(fileUrl);
          text += `\n- ${id}`;
          console.log(`# File ${id}: ${fileUrl}`);
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
            console.log(`# Image ${id}: ${imgUrl}`);
          }
        }
        if (refMsg.fileUrls.length > 0) {
          refText += '\nattached file IDs:';
          for (const fileUrl of refMsg.fileUrls) {
            const id = this.toolContext.fileStorage.setFileUrl(fileUrl);
            refText += `\n- ${id}`;
            console.log(`# File ${id}: ${fileUrl}`);
          }
        }

        text = refText + '\n--- Referred to by the following message ---\n' +
          text;

        imageUrls = [...refMsg.imageUrls, ...msg.imageUrls];
      } else {
        imageUrls = msg.imageUrls;
      }

      if (textHistory) {
        textHistory += `\n\n${text}`;
      } else {
        textHistory = text;
      }

      if (imageUrls.length) {
        textHistory += '\n(attached images)';
      }
      if (msg.fileUrls.length || msg.refMessage?.imageUrls.length) {
        textHistory += '\n(attached files)';
      }

      this.context.appendMessage({
        role: 'user',
        content: [
          { type: 'text', text },
          ...imageUrls.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ],
        name: msg.authorId.replaceAll(/[^a-zA-Z0-9_-]/g, '_'),
      }, msg.date);
    }

    this.context.appendHistory(textHistory);
  }

  public async chat(
    newMessages: ChatMessage[],
    intermMsgCallback: (msg: string) => Promise<void>,
    fileCallback: (file: Uint8Array, format: string) => Promise<void>,
  ): Promise<string> {
    this.incomingMessages.push(...newMessages);

    console.log(
      `# Incoming messages cnt: ${this.incomingMessages.length} + ${newMessages.length}`,
    );

    if (this.thinking) {
      return '';
    }
    this.thinking = true;

    const backupContext = this.context.clone();

    try {
      this.pipeChatMessage(this.incomingMessages);
      this.incomingMessages = [];

      this.context.expireOldImages();

      this.context.setSystemPrompt({
        role: 'system',
        content: this.chatPrompt +
          (this.memory.content
            ? '\n\nUtilize the following memories in conversations:\n' +
              this.memory.content
            : ''),
      });

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
      }, { timeout: 20000 });

      console.log(`# Completion:\n` + JSON.stringify(completion));

      let totalTokens = completion.usage?.total_tokens ?? 0;
      const res = completion.choices[0].message;
      let resContent = res.content?.trim() ?? '';

      const toolCalls = res.tool_calls;
      if (toolCalls) {
        if (resContent) {
          await intermMsgCallback(resContent);
        }

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
                      text: `(ID: ${imgId})`,
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
        }, { timeout: 20000 });

        console.log(`# Completion:\n` + JSON.stringify(completion2));

        totalTokens = completion2.usage?.total_tokens ?? 0;
        const res2 = completion2.choices[0].message;
        resContent = res2.content?.trim() ?? '';

        afterToolMessages.forEach((msg) => this.context.appendMessage(msg));
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

        this.context.appendHistory(
          `${this.agentName} — ${localeDate(new Date())}\n${resContent}`,
        );
        this.context.appendMessage({
          role: res.role,
          content: resContent,
        });
      }

      console.log(
        `# Context cnt: ${this.context.size}, Total tokens: ${totalTokens}`,
      );

      if (cmd === 'STOP' || cmd === 'SWITCH' || totalTokens > 8000) {
        if (cmd === 'STOP') {
          this.chatting = false;
        } else if (cmd === 'SWITCH') {
          this.chatting = true;
        }

        const summary = await this.context.compress();
        this.chatDB.store(summary)
          .then(() => console.log('# Summary stored'))
          .catch((err) => console.log(err));

        console.log(`# Compressed context cnt: ${this.context.size}`);
      } else if (cmd !== 'IDLE') {
        this.chatting = true;
      }

      return resContent;
    } catch (err) {
      console.log((err as Error).stack);

      this.context = backupContext;

      const errMessage = `Failed to generate response.\n${
        (err as Error).message
      }`;

      this.context.appendHistory(
        `${this.agentName} — ${localeDate(new Date())}\n${errMessage}`,
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

      console.log(`# Compressed context cnt: ${this.context.size}`);
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
