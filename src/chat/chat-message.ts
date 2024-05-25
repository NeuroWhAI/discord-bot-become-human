export class ChatMessage {
  constructor(
    { authorId, author, content, date }: {
      authorId: string;
      author: string;
      content: string;
      date: Date;
    },
  ) {
    this.authorId = authorId;
    this.author = author;
    this.content = content;
    this.date = date;
  }

  public authorId: string;
  public author: string;
  public content: string;
  public date: Date;

  public refMessage: ChatMessage | null = null;
}
