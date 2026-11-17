import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../server/lib/config';
import { closeDb, getDb } from '../../server/lib/db';
import { enqueue, getJob, recoverInterrupted, registerJob, startQueue, stopQueue, waitForJob } from '../../server/lib/jobs/queue';

let dir = '';
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'ms-queue-')); setConfig({ dataDir: dir }); });
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('takenwachtrij', () => {
  it('voert taken uit en probeert opnieuw volgens het maximum', async () => {
    let calls = 0;
    const failed: string[] = [];
    registerJob<{ n: number }>('flaky', {
      concurrency: 1, timeoutMs: 5000,
      async run(job) { calls++; if (calls < 2) throw new Error(`poging ${job.attempts} mislukt`); },
      onFail(job) { failed.push(job.id); },
    });
    startQueue(50);
    const id = enqueue('flaky', { n: 1 }, { maxAttempts: 3 });
    // Tweede poging komt na een wachttijd; zet die terug zodat de test niet hoeft te wachten.
    await new Promise((r) => setTimeout(r, 200));
    getDb().prepare("UPDATE jobs SET run_after = ? WHERE id = ?").run(new Date(0).toISOString(), id);
    const job = await waitForJob(id, 5000);
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
    expect(failed).toHaveLength(0);
  });

  it('sluit een taak die tijdens een herstart liep netjes af en roept het opruimen aan', async () => {
    stopQueue();
    const failed: string[] = [];
    registerJob('once', { concurrency: 1, timeoutMs: 5000, async run() {}, onFail(job, err) { failed.push(`${job.id}:${err}`); } });
    const id = enqueue('once', {}, { maxAttempts: 1 });
    // Simuleer een crash: de taak staat op lopend met een verbruikte poging.
    getDb().prepare("UPDATE jobs SET status = 'running', attempts = 1 WHERE id = ?").run(id);
    await recoverInterrupted();
    expect(getJob(id)!.status).toBe('failed');
    expect(failed[0]).toMatch(/opnieuw is gestart/);
  });

  it('breekt een vastgelopen taak af na de maximale looptijd', async () => {
    registerJob('slow', { concurrency: 1, timeoutMs: 100, run: () => new Promise((r) => setTimeout(r, 2000)) });
    startQueue(50);
    const job = await waitForJob(enqueue('slow', {}), 5000);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/te lang/);
  });
});
