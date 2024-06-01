import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'search_chat_db',
  description: 'Search for previous conversation history in the DB',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
      },
    },
    required: ['query'],
  },
};

export async function execute(arg: string, ctx: ToolContext): Promise<string> {
  try {
    const { query } = JSON.parse(arg);
    const results = await ctx.chatDB.search(query);

    if (results.length === 0) {
      return 'No results found';
    }

    return results.map((result) =>
      '[Previous Conversation]\n' + result + '\n---'
    ).join('\n\n');
  } catch (err) {
    console.log((err as Error).stack);
    return `Failed to search: ${(err as Error).message}`;
  }
}
