import { statfs } from 'node:fs/promises';
import { dataPath } from '../lib/config';
import { getDb } from '../lib/db';
import { poolStats } from '../lib/imaging/pool';
import { queueStats } from '../lib/jobs/queue';

/** Voor monitoring en de hosting: 200 als alles werkt, 503 als de database of schijf een probleem heeft. */
export default defineEventHandler(async (event) => {
  const checks: Record<string, unknown> = {};
  let healthy = true;
  try {
    getDb().prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch (e) {
    healthy = false;
    checks.database = String(e);
  }
  try {
    const s = await statfs(dataPath());
    const freeGb = (s.bavail * s.bsize) / 1e9;
    checks.diskFreeGb = Math.round(freeGb * 10) / 10;
    if (freeGb < 1) healthy = false;
  } catch {
    checks.diskFreeGb = null;
  }
  checks.queue = queueStats();
  checks.imaging = poolStats();
  checks.uptimeSeconds = Math.round(process.uptime());
  setResponseStatus(event, healthy ? 200 : 503);
  setHeader(event, 'Cache-Control', 'no-store');
  return { status: healthy ? 'ok' : 'degraded', ...checks };
});
