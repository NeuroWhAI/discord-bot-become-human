import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import OpenAI from 'openai';
import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export const metadata: FunctionDefinition = {
  name: 'reason_deeply',
  description:
    'Provide answers only to complex or open-ended questions through logical reasoning.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question requiring reasoning and deep analysis.',
      },
    },
    required: ['question'],
  },
};

export async function execute(arg: string, _ctx: ToolContext): Promise<string> {
  const model = env.OPENAI_REASONING_MODEL;
  if (!model) {
    return 'The reasoning model is not configured.';
  }

  const { question } = JSON.parse(arg);

  const completion = await openai.chat.completions.create({
    model: env.OPENAI_REASONING_MODEL,
    messages: [
      {
        role: 'user',
        content: question,
      },
    ],
  });

  console.log(`# Reasoning:\n` + JSON.stringify(completion));

  return completion.choices[0].message.content ?? '(empty)';
}
