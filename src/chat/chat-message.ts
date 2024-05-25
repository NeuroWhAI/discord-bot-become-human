export class ChatMessage {
  constructor(
    { authorId, author, content, date, imageUrls }: {
      authorId: string;
      author: string;
      content: string;
      date: Date;
      imageUrls: string[];
    },
  ) {
    this.authorId = authorId;
    this.author = author;
    this.content = content;
    this.date = date;
    this.imageUrls = imageUrls;
  }

  public authorId: string;
  public author: string;
  public content: string;
  public date: Date;
  public imageUrls: string[];

  public refMessage: ChatMessage | null = null;
}
