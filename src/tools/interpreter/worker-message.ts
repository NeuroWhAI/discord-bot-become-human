export interface WorkerMessageExecute {
  cmd: 'execute';
  code: string;
  files: { id: string; data: Uint8Array }[];
}
export interface WorkerMessageResult {
  cmd: 'result';
  result: string;
}
export type WorkerMessage =
  | WorkerMessageExecute
  | WorkerMessageResult;
