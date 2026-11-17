// Pool van worker threads voor beeldwerk. Valt terug op uitvoeren in de hoofdthread als er geen
// gebundelde worker is (tests, scripts), zodat de applicatie altijd werkt.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { AppError } from '../errors';
import { log } from '../log';
import type { TASKS, TaskName } from './tasks';

type Spec<K extends TaskName> = Parameters<(typeof TASKS)[K]>[0];
type Result<K extends TaskName> = Awaited<ReturnType<(typeof TASKS)[K]>>;

interface Pending { resolve: (v: unknown) => void; reject: (e: unknown) => void; name: string; started: number }
interface Slot { worker: Worker; busy: number; pending: Map<number, Pending> }

let slots: Slot[] | null = null;
let workerPath: string | null | undefined;
let seq = 0;
const queue: { name: TaskName; spec: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
/** Taken tegelijk per worker; sharp gebruikt zelf ook threads, dus één tegelijk is het snelst. */
const PER_WORKER = 1;

function resolveWorkerPath(): string | null {
  if (workerPath !== undefined) return workerPath;
  const candidates = [
    process.env.IMAGING_WORKER_PATH,
    process.argv[1] ? path.join(path.dirname(process.argv[1]), 'workers', 'imaging.mjs') : undefined,
    path.resolve(process.cwd(), '.nuxt', 'workers', 'imaging.mjs'),
  ].filter((p): p is string => !!p);
  workerPath = process.env.IMAGING_WORKERS === '0' ? null : candidates.find((p) => existsSync(p)) ?? null;
  if (!workerPath) log.info('imaging.inline', { reason: process.env.IMAGING_WORKERS === '0' ? 'uitgeschakeld' : 'geen gebundelde worker gevonden' });
  return workerPath;
}

export function poolSize() {
  const fromEnv = Number(process.env.IMAGING_WORKERS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(16, fromEnv);
  return Math.max(1, Math.min(8, os.availableParallelism() - 1));
}

function spawn(file: string): Slot {
  const worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 2048 } });
  const slot: Slot = { worker, busy: 0, pending: new Map() };
  worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: { message: string; status?: number; code?: string; stack?: string } }) => {
    const p = slot.pending.get(msg.id);
    if (!p) return;
    slot.pending.delete(msg.id);
    slot.busy--;
    log.debug('imaging.task', { name: p.name, ms: Math.round(performance.now() - p.started), ok: msg.ok });
    if (msg.ok) p.resolve(msg.result);
    else if (msg.error?.status) p.reject(new AppError(msg.error.status, msg.error.message, msg.error.code));
    else {
      log.error('imaging.task_failed', { name: p.name, error: msg.error?.message, stack: msg.error?.stack });
      p.reject(new Error(msg.error?.message ?? 'Beeldverwerking mislukt.'));
    }
    drain();
  });
  worker.on('error', (e) => log.error('imaging.worker_error', { error: String(e), stack: (e as Error).stack }));
  worker.on('exit', (code) => {
    // Een gecrashte worker: lopende taken laten mislukken en een nieuwe starten.
    for (const p of slot.pending.values()) p.reject(new AppError(500, 'De beeldverwerking is onverwacht gestopt. Probeer het opnieuw.', 'worker_crashed'));
    slot.pending.clear();
    if (!slots) return;
    const i = slots.indexOf(slot);
    if (i >= 0) {
      if (code !== 0) log.warn('imaging.worker_exit', { code });
      slots[i] = spawn(file);
      drain();
    }
  });
  worker.unref();
  return slot;
}

function drain() {
  if (!slots) return;
  while (queue.length) {
    const slot = slots.reduce((a, b) => (b.busy < a.busy ? b : a));
    if (slot.busy >= PER_WORKER) return;
    const job = queue.shift()!;
    const id = ++seq;
    slot.busy++;
    slot.pending.set(id, { resolve: job.resolve, reject: job.reject, name: job.name, started: performance.now() });
    slot.worker.postMessage({ id, name: job.name, spec: job.spec });
  }
}

export async function runTask<K extends TaskName>(name: K, spec: Spec<K>): Promise<Result<K>> {
  const file = resolveWorkerPath();
  if (!file) {
    const { TASKS } = await import('./tasks');
    try {
      return (await (TASKS[name] as (s: Spec<K>) => Promise<Result<K>>)(spec));
    } catch (e) {
      const err = e as { status?: number; message: string; code?: string };
      if (err.status) throw new AppError(err.status, err.message, err.code);
      throw e;
    }
  }
  slots ??= Array.from({ length: poolSize() }, () => spawn(file));
  return new Promise<Result<K>>((resolve, reject) => {
    queue.push({ name, spec, resolve: resolve as (v: unknown) => void, reject });
    drain();
  });
}

export function poolStats() {
  return { mode: resolveWorkerPath() ? 'workers' : 'inline', workers: slots?.length ?? 0, busy: slots?.reduce((a, s) => a + s.busy, 0) ?? 0, queued: queue.length };
}

export async function closePool() {
  const s = slots;
  slots = null;
  await Promise.all((s ?? []).map((x) => x.worker.terminate()));
}
