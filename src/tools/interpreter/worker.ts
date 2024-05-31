import { encodeBase64 } from 'std/encoding/base64.ts';
import { loadPyodide } from 'pyodide';
// @deno-types="npm:@types/mime-types"
import mime from 'mime-types';
import { WorkerMessage, WorkerMessageExecute } from './worker-message.ts';

self.addEventListener('message', async (evt) => {
  const msg = evt as MessageEvent;
  const data = msg.data as WorkerMessage;
  if (data.cmd === 'execute') {
    let result: string;
    try {
      result = await runPython(data);
    } catch (err) {
      result = `Failed to execute code: ${(err as Error).message}`;
    }

    // deno-lint-ignore no-explicit-any
    (self as any).postMessage(
      { cmd: 'result', result } satisfies WorkerMessage,
    );

    self.close();
  }
});

async function runPython(data: WorkerMessageExecute) {
  const { code, files } = data;

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

  files.forEach((file) => py.FS.writeFile(file.id, file.data));

  await py.loadPackagesFromImports(code);
  const res = await py.runPythonAsync(code);

  if (data.outputFile) {
    const file = py.FS.readFile(data.outputFile);
    if (file) {
      const mimeType = mime.lookup(data.outputFile) ||
        'application/octet-stream';
      return `data:${mimeType};base64,${encodeBase64(file)}`;
    }
  }

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
}
