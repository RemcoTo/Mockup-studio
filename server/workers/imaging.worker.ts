// Ingang van een worker thread voor beeldwerk. Wordt bij het bouwen gebundeld naar workers/imaging.mjs.
import { parentPort } from 'node:worker_threads';
import { TASKS, type TaskName } from '../lib/imaging/tasks';

parentPort!.on('message', async (msg: { id: number; name: TaskName; spec: unknown }) => {
  try {
    const result = await (TASKS[msg.name] as (s: unknown) => Promise<unknown>)(msg.spec);
    const transfer: ArrayBuffer[] = [];
    const buf = (result as { buffer?: Uint8Array })?.buffer;
    if (buf instanceof Uint8Array && buf.buffer instanceof ArrayBuffer) transfer.push(buf.buffer);
    parentPort!.postMessage({ id: msg.id, ok: true, result }, transfer);
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string; stack?: string };
    parentPort!.postMessage({ id: msg.id, ok: false, error: { message: err.message ?? String(e), status: err.status, code: err.code, stack: err.stack } });
  }
});
