/**
 * https://pyodide.org/en/stable/
 */

import { decodeBase64 } from 'std/encoding/base64.ts';
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
      file_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'The file or image IDs required to run code',
      },
    },
    required: ['code'],
  },
};

export async function execute(arg: string, ctx: ToolContext): Promise<string> {
  try {
    const { code, file_ids } = JSON.parse(arg);

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

    if (Array.isArray(file_ids)) {
      for (const fileId of file_ids) {
        const fileUrl = ctx.fileStorage.getUrlById(fileId);
        if (!fileUrl) {
          return `File ${fileId} not found!`;
        }

        if (fileUrl.startsWith('data:')) {
          const fileData = fileUrl.substring(fileUrl.indexOf(',') + 1);
          py.FS.writeFile(fileId, decodeBase64(fileData));
        } else {
          const res = await fetch(fileUrl);
          if (!res.ok) {
            return `Fail to download file ${fileId}!\nHTTP Status: ${res.status}`;
          }
          const fileData = await res.arrayBuffer();
          py.FS.writeFile(fileId, new Uint8Array(fileData));
        }
      }
    }

    const res = await py.runPythonAsync(code);

    if (res != null) {
      const resText = JSON.stringify(res, null, 1);

      if (stdOutput) {
        return resText + '\n\nStdout:\n' + stdOutput;
      } else {
        return resText;
      }
    } else {
      return stdOutput;
    }
  } catch (err) {
    console.log((err as Error).stack);
    return `Failed to run Python code: ${(err as Error).message}`;
  }
}
