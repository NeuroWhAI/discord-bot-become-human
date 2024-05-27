import { ChatMessage } from './chat-message.ts';

export class ChatBuffer {
  private readonly bufferTable: Map<string, ChatMessage[]> = new Map();

  public append(channelId: string, message: ChatMessage) {
    let buffer = this.bufferTable.get(channelId);
    if (!buffer) {
      buffer = [];
      this.bufferTable.set(channelId, buffer);
    }

    if (buffer.length > 0) {
      const latestMsg = buffer[buffer.length - 1];
      const elapsedTime = message.date.getTime() - latestMsg.date.getTime();

      // 하나로 합칠 수 있는 메시지는 합침.
      if (
        latestMsg.authorId === message.authorId &&
        elapsedTime < 30 * 1000
      ) {
        if (latestMsg.content) {
          latestMsg.content = `${latestMsg.content}\n${message.content}`;
        } else {
          latestMsg.content = message.content;
        }

        if (message.imageUrls.length > 0) {
          latestMsg.imageUrls = [...latestMsg.imageUrls, ...message.imageUrls];
        }

        if (message.refMessage) {
          latestMsg.refMessage = message.refMessage;
        }

        return;
      }
    }

    buffer.push(message);

    // 메모리 부족 방지로 단순 개수 제한.
    // 이게 컨텍스트 제한이 되는 건 아님.
    const maxCount = 50;
    if (buffer.length > maxCount) {
      buffer.splice(0, buffer.length - maxCount);
    }
  }

  public flush(channelId: string): ChatMessage[] {
    const buffer = this.bufferTable.get(channelId);
    if (!buffer) return [];
    this.bufferTable.set(channelId, []);
    return buffer;
  }
}
