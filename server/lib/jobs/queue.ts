// Duurzame takenwachtrij in SQLite. Taken overleven een herstart: wachtende taken worden gewoon
// opgepakt, een taak die tijdens een herstart liep krijgt een nieuwe poging of wordt netjes afgesloten.
import { getDb } from '../db';
import { newId, now } from '../ids';
import { log } from '../log';

export interface Job<P = Record<string, unknown>> {
  id: string; type: string; workspaceId: string | null; ref: string | null; payload: P;
  status: 'queued' | 'running' | 'done' | 'failed'; attempts: number; maxAttempts: number; error: string | null; createdAt: string;
}

export interface JobHandler<P = Record<string, unknown>> {
  run(job: Job<P>): Promise<void>;
  /** Wordt aangeroepen als de taak definitief mislukt (ook na een herstart), voor opruimen en terugboeken. */
  onFail?(job: Job<P>, error: string): Promise<void> | void;
  concurrency: number;
  /** Maximale looptijd; daarna geldt de taak als vastgelopen. */
  timeoutMs: number;
}

type Row = Record<string, unknown>;
const toJob = (r: Row): Job => ({
  id: r.id as string, type: r.type as string, workspaceId: (r.workspace_id as string) ?? null, ref: (r.ref as string) ?? null,
  payload: JSON.parse((r.payload as string) || '{}'), status: r.status as Job['status'], attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts), error: (r.error as string) ?? null, createdAt: r.created_at as string,
});

const handlers = new Map<string, JobHandler<never>>();
const running = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
const waiters = new Map<string, (() => void)[]>();

export function registerJob<P>(type: string, handler: JobHandler<P>) {
  handlers.set(type, handler as JobHandler<never>);
}

export function enqueue(type: string, payload: Record<string, unknown>, opts: { workspaceId?: string | null; ref?: string | null; maxAttempts?: number; delayMs?: number } = {}): string {
  const id = newId();
  const t = now();
  getDb().prepare(`INSERT INTO jobs (id, type, workspace_id, ref, payload, status, attempts, max_attempts, run_after, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`).run(id, type, opts.workspaceId ?? null, opts.ref ?? null, JSON.stringify(payload),
    opts.maxAttempts ?? 1, new Date(Date.now() + (opts.delayMs ?? 0)).toISOString(), t, t);
  setImmediate(tick);
  return id;
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
  return r ? toJob(r) : null;
}

/** Wacht tot een taak klaar is (voor tests en scripts). */
export function waitForJob(id: string, timeoutMs = 120_000): Promise<Job> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const j = getJob(id);
      if (j && (j.status === 'done' || j.status === 'failed')) { clearTimeout(to); resolve(j); return true; }
      return false;
    };
    const to = setTimeout(() => reject(new Error(`Taak ${id} is niet binnen ${timeoutMs} ms klaar.`)), timeoutMs);
    if (check()) return;
    const list = waiters.get(id) ?? [];
    list.push(() => { check(); });
    waiters.set(id, list);
  });
}

function notify(id: string) {
  const list = waiters.get(id);
  if (!list) return;
  waiters.delete(id);
  for (const fn of list) fn();
}

function claim(type: string, timeoutMs: number): Job | null {
  const t = now();
  const r = getDb().prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND type = ? AND run_after <= ? ORDER BY created_at LIMIT 1)
    RETURNING *`).get(new Date(Date.now() + timeoutMs).toISOString(), t, type, t) as Row | undefined;
  return r ? toJob(r) : null;
}

function finish(id: string, status: 'done' | 'failed', error: string | null) {
  getDb().prepare('UPDATE jobs SET status = ?, error = ?, locked_until = NULL, updated_at = ? WHERE id = ?').run(status, error, now(), id);
  notify(id);
}

async function execute(job: Job, handler: JobHandler<never>) {
  running.set(job.type, (running.get(job.type) ?? 0) + 1);
  const started = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      handler.run(job as never),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('De taak duurde te lang en is afgebroken.')), handler.timeoutMs); }),
    ]);
    finish(job.id, 'done', null);
    log.info('job.done', { type: job.type, id: job.id, ms: Date.now() - started });
  } catch (e) {
    const message = (e as Error).message || 'Onbekende fout';
    if (job.attempts < job.maxAttempts) {
      // Opnieuw proberen met oplopende wachttijd.
      getDb().prepare("UPDATE jobs SET status = 'queued', error = ?, locked_until = NULL, run_after = ?, updated_at = ? WHERE id = ?")
        .run(message, new Date(Date.now() + 2 ** job.attempts * 5000).toISOString(), now(), job.id);
      log.warn('job.retry', { type: job.type, id: job.id, attempt: job.attempts, error: message });
    } else {
      finish(job.id, 'failed', message);
      log.warn('job.failed', { type: job.type, id: job.id, error: message });
      try { await handler.onFail?.(job as never, message); } catch (err) { log.error('job.onfail_error', { id: job.id, error: String(err) }); }
    }
  } finally {
    clearTimeout(timeout);
    running.set(job.type, (running.get(job.type) ?? 1) - 1);
    setImmediate(tick);
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const [type, handler] of handlers) {
      while ((running.get(type) ?? 0) < handler.concurrency) {
        const job = claim(type, handler.timeoutMs + 60_000);
        if (!job) break;
        void execute(job, handler);
      }
    }
  } catch (e) {
    log.error('job.tick_error', { error: String(e) });
  } finally {
    ticking = false;
  }
}

/** Taken die liepen tijdens een herstart: nieuwe poging als dat mag, anders definitief mislukt. */
export async function recoverInterrupted() {
  const rows = getDb().prepare("SELECT * FROM jobs WHERE status = 'running'").all() as Row[];
  for (const r of rows) {
    const job = toJob(r);
    const handler = handlers.get(job.type);
    if (job.attempts < job.maxAttempts) {
      getDb().prepare("UPDATE jobs SET status = 'queued', locked_until = NULL, updated_at = ? WHERE id = ?").run(now(), job.id);
      log.info('job.requeued_after_restart', { type: job.type, id: job.id });
    } else {
      const msg = 'Onderbroken doordat de server opnieuw is gestart.';
      finish(job.id, 'failed', msg);
      log.warn('job.failed_after_restart', { type: job.type, id: job.id });
      try { await handler?.onFail?.(job as never, msg); } catch (err) { log.error('job.onfail_error', { id: job.id, error: String(err) }); }
    }
  }
}

export function startQueue(intervalMs = 1000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref();
  setImmediate(tick);
}

export function stopQueue() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function queueStats() {
  const rows = getDb().prepare("SELECT type, status, COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running') GROUP BY type, status").all() as Row[];
  return rows.map((r) => ({ type: r.type as string, status: r.status as string, count: Number(r.n) }));
}

/** Oude afgeronde taken opruimen. */
export function purgeJobs(olderThanDays = 30) {
  getDb().prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?").run(new Date(Date.now() - olderThanDays * 86400_000).toISOString());
}
