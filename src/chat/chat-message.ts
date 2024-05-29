export class ChatMessage {
  constructor(
    { authorId, author, content, date, imageUrls, fileUrls }: {
      authorId: string;
      author: string;
      content: string;
      date: Date;
      imageUrls: string[];
      fileUrls: string[];
    },
  ) {
    this.authorId = authorId;
    this.author = author;
    this.content = content;
    this.date = date;
    this.imageUrls = imageUrls;
    this.fileUrls = fileUrls;
  }

  public authorId: string;
  public author: string;
  public content: string;
  public date: Date;
  public imageUrls: string[];
  public fileUrls: string[];

  public refMessage: ChatMessage | null = null;
}
