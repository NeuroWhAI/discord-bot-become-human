/**
 * https://pyodide.org/en/stable/
 */

import { decodeBase64 } from 'std/encoding/base64.ts';
import { FunctionDefinition, ToolContext } from '../ai/tool.ts';
import { WorkerMessage } from './interpreter/worker-message.ts';

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
      output_file: {
        type: 'string',
        description: 'The output file name',
      },
    },
    required: ['code'],
  },
};

export async function execute(arg: string, ctx: ToolContext): Promise<string> {
  let timeoutId: number | null = null;

  try {
    const { code, file_ids, output_file } = JSON.parse(arg);

    const files: { id: string; data: Uint8Array }[] = [];
    if (Array.isArray(file_ids)) {
      for (const fileId of file_ids) {
        const fileUrl = ctx.fileStorage.getUrlById(fileId);
        if (!fileUrl) {
          return `File ${fileId} not found!`;
        }

        if (fileUrl.startsWith('data:')) {
          const fileData = fileUrl.substring(fileUrl.indexOf(',') + 1);
          files.push({ id: fileId, data: decodeBase64(fileData) });
        } else {
          const res = await fetch(fileUrl);
          if (!res.ok) {
            return `Fail to download file ${fileId}!\nHTTP Status: ${res.status}`;
          }
          const fileData = await res.arrayBuffer();
          files.push({ id: fileId, data: new Uint8Array(fileData) });
        }
      }
    }

    const job = new Promise<string>((resolve) => {
      const worker = new Worker(
        import.meta.resolve('./interpreter/worker.ts'),
        {
          type: 'module',
        },
      );

      worker.onmessage = (evt) => {
        const data = evt.data as WorkerMessage;
        if (data.cmd === 'result') {
          resolve(data.result);
        }
      };
      worker.onerror = () => resolve('Failed to run Python code!');
      worker.onmessageerror = () => resolve('Failed to run Python code!');

      worker.postMessage(
        {
          cmd: 'execute',
          code,
          files,
          outputFile: output_file,
        } satisfies WorkerMessage,
      );

      timeoutId = setTimeout(() => {
        worker.terminate();
        resolve('Timeout!');
      }, 16 * 1000);
    });

    const result = await job;

    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    return result ? result : '(Empty result)';
  } catch (err) {
    console.log((err as Error).stack);
    return `Failed to run Python code: ${(err as Error).message}`;
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}
