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
  type: 'integer';
  description?: string;
  minimum?: number;
  maximum?: number;
}
export interface BooleanParameter {
  type: 'boolean';
  description?: string;
}

export type FunctionParameters =
  | ObjectParameter
  | StringParameter
  | NumberParameter
  | BooleanParameter;

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

class ImageUrlStorageData {
  constructor(public readonly url: string, public lastAccess: number) {}
}

export class ImageUrlStorage {
  private id2data: Map<string, ImageUrlStorageData> = new Map();
  private url2id: Map<string, string> = new Map();
  private inc: number = 0;

  public setUrl(url: string): string {
    let id = this.url2id.get(url);
    if (id) {
      return id;
    }

    if (this.id2data.size > 100) {
      let oldId = '';
      let oldData: ImageUrlStorageData | null = null;
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
    id = 'i' + this.inc.toString(36);

    this.id2data.set(id, new ImageUrlStorageData(url, Date.now()));
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
  private _imgStorage: ImageUrlStorage = new ImageUrlStorage();
  public get imgStorage(): ImageUrlStorage {
    return this._imgStorage;
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
