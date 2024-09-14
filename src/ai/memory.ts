export class Memory {
  constructor(filePath: string) {
    this.filePath = filePath;
    this._content = '(empty)';
  }

  private readonly filePath: string;
  private _content: string;

  public get content(): string {
    return this._content;
  }

  public async load() {
    try {
      this._content = await Deno.readTextFile(this.filePath);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }
  }

  public async setContent(content: string) {
    this._content = content;
    await Deno.writeTextFile(this.filePath, content);
  }
}
