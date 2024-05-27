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

export type FunctionParameters =
  | ObjectParameter
  | StringParameter
  | NumberParameter;

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

export class Tool {
  constructor(
    metadata: FunctionDefinition,
    execute: (arg: string) => Promise<string>,
  ) {
    this._metadata = metadata;
    this._execute = execute;
  }

  private _metadata: FunctionDefinition;
  public get metadata(): FunctionDefinition {
    return this._metadata;
  }

  private _execute: (arg: string) => Promise<string>;
  public get execute(): (arg: string) => Promise<string> {
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
