export class ChatMessage {
  constructor(
    { author, content, date }: { author: string; content: string; date: Date },
  ) {
    this.author = author;
    this.content = content;
    this.date = date;
  }

  public author: string;
  public content: string;
  public date: Date;
}
