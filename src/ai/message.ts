export interface ChatCompletionContentPartText {
  text: string;
  type: 'text';
}
export interface ChatCompletionContentPartImage {
  image_url: { url: string };
  type: 'image_url';
}
export type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage;

export interface ChatCompletionMessageToolCallFunction {
  arguments: string;
  name: string;
}
export interface ChatCompletionMessageToolCall {
  id: string;
  function: ChatCompletionMessageToolCallFunction;
  type: 'function';
}

export interface AgentMessage {
  role: 'system' | 'assistant' | 'user' | 'tool';
  content: string | ChatCompletionContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
}
