export interface ObjectParameter {
  type: 'object';
  properties: Record<string, FunctionParameters>;
  required?: string[];
}
export interface StringParameter {
  type: 'string';
  description?: string;
  enum?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  format?: 'date-time' | 'email' | 'hostname' | 'ipv4' | 'ipv6' | 'uri';
}
export interface NumberParameter {
  type: 'number';
  description?: string;
  minimum?: number;
  maximum?: number;
}
export interface BooleanParameter {
  type: 'boolean';
  description?: string;
}
export interface ArrayParameter {
  type: 'array';
  items: {
    type: 'string' | 'number' | 'boolean';
  };
  description?: string;
}

export type FunctionParameters =
  | ObjectParameter
  | StringParameter
  | NumberParameter
  | BooleanParameter
  | ArrayParameter;

export interface FunctionDefinition {
  name: string;
  description?: string;
  /**
   * https://platform.openai.com/docs/guides/text-generation/function-calling
   * https://json-schema.org/understanding-json-schema/
   */
  parameters?: FunctionParameters;
}
export interface ChatCompletionTool {
  function: FunctionDefinition;
  type: 'function';
}

class FileUrlStorageData {
  constructor(public readonly url: string, public lastAccess: number) {}
}

export class FileUrlStorage {
  private id2data: Map<string, FileUrlStorageData> = new Map();
  private url2id: Map<string, string> = new Map();
  private inc: number = 0;

  public setImageUrl(url: string) {
    return this.setUrl(url, 'i');
  }
  public setFileUrl(url: string) {
    return this.setUrl(url, 'f');
  }

  private setUrl(url: string, idPrefix: string): string {
    let id = this.url2id.get(url);
    if (id) {
      return id;
    }

    if (this.id2data.size > 100) {
      let oldId = '';
      let oldData: FileUrlStorageData | null = null;
      let oldTime = Date.now();

      for (const [id, data] of this.id2data.entries()) {
        if (data.lastAccess < oldTime) {
          oldId = id;
          oldData = data;
          oldTime = data.lastAccess;
        }
      }

      if (oldId && oldData) {
        this.id2data.delete(oldId);
        this.url2id.delete(oldData.url);
      }
    }

    this.inc += 1;
    id = idPrefix + this.inc.toString(36);

    this.id2data.set(id, new FileUrlStorageData(url, Date.now()));
    this.url2id.set(url, id);

    return id;
  }

  public getUrlById(id: string): string | null {
    const data = this.id2data.get(id);
    if (!data) {
      return null;
    }
    data.lastAccess = Date.now();
    return data.url;
  }
}

export class ToolContext {
  private _fileStorage: FileUrlStorage = new FileUrlStorage();
  public get fileStorage(): FileUrlStorage {
    return this._fileStorage;
  }
}

export class Tool {
  constructor(
    metadata: FunctionDefinition,
    execute: (arg: string, ctx: ToolContext) => Promise<string>,
  ) {
    this._metadata = metadata;
    this._execute = execute;
  }

  private _metadata: FunctionDefinition;
  public get metadata(): FunctionDefinition {
    return this._metadata;
  }

  private _execute: (arg: string, ctx: ToolContext) => Promise<string>;
  public get execute(): (arg: string, ctx: ToolContext) => Promise<string> {
    return this._execute;
  }
}

const tools: Map<string, Tool> = new Map();

export function getAllTools(): Tool[] {
  return [...tools.values()];
}

export function getTool(name: string): Tool | null {
  return tools.get(name) || null;
}

// Load tools.
for (const file of Deno.readDirSync('src/tools')) {
  if (!file.name.endsWith('.ts')) continue;

  const tool = await import(`../tools/${file.name}`);

  if (!('metadata' in tool) || !('execute' in tool)) {
    console.log(
      `The tool at ${file.name} is missing a required "metadata" or "execute" property.`,
    );

    continue;
  }

  tools.set(tool.metadata.name, new Tool(tool.metadata, tool.execute));
}
