/**
 * https://pyodide.org/en/stable/
 */

import { loadPyodide } from 'pyodide';
import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'run_python_code',
  description: 'Utilize computing power to execute Python code and get results',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
      },
    },
    required: ['code'],
  },
};

export async function execute(arg: string, _ctx: ToolContext): Promise<string> {
  try {
    const { code } = JSON.parse(arg);

    let stdOutput = '';
    const py = await loadPyodide({
      fullStdLib: true,
      stdout: (s) => {
        stdOutput += s;
        stdOutput += '\n';
      },
      stderr: (s) => {
        stdOutput += s;
        stdOutput += '\n';
      },
    });
    py.setStdin({ error: true });

    const res = await py.runPythonAsync(code);

    if (res != null) {
      const resText = JSON.stringify(res, null, 1);

      if (stdOutput) {
        return resText + '\n\nStdout:' + stdOutput;
      } else {
        return resText;
      }
    } else {
      return stdOutput;
    }
  } catch (err) {
    return `Failed to run Python code: ${(err as Error).message}`;
  }
}
