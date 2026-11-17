import { readdir, rm, stat } from 'node:fs/promises';
import { setWorkspaceCreatedHook } from '../lib/auth/accounts';
import { closeBrowser } from '../lib/capture/capture';
import { closeEgressProxy } from '../lib/capture/egress';
import { dataPath, setConfig } from '../lib/config';
import { getDb } from '../lib/db';
import '../lib/generation/jobs';
import '../lib/library/pipeline';
import '../lib/versions';
import '../lib/video';
import { scheduleDueRecaptures } from '../lib/capture/living';
import { closePool } from '../lib/imaging/pool';
import { backupIfDue } from '../lib/backup';
import { purgeJobs, recoverInterrupted, startQueue, stopQueue } from '../lib/jobs/queue';
import { log } from '../lib/log';
import { sessions } from '../lib/repo-accounts';
import { generations } from '../lib/repositories';
import { createSampleProject, seedSystemLibrary } from '../lib/seed';
import { retireSocial } from '../lib/migrations/retire-social';

async function housekeeping() {
  try {
    sessions.purgeExpired();
    await backupIfDue().catch((e) => log.error('backup.failed', { error: String(e) }));
    purgeJobs(30);
    // Tijdelijke werkmappen ouder dan een dag (achtergebleven na een crash).
    const tmp = dataPath('tmp');
    for (const name of await readdir(tmp).catch(() => [] as string[])) {
      const p = `${tmp}/${name}`;
      const s = await stat(p).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 86400_000) await rm(p, { recursive: true, force: true });
    }
  } catch (e) {
    log.warn('housekeeping.failed', { error: String(e) });
  }
}

export default defineNitroPlugin(async (nitro) => {
  const rc = useRuntimeConfig();
  setConfig({
    dataDir: rc.dataDir,
    imageProvider: rc.imageProvider,
    openaiApiKey: rc.openaiApiKey,
    openaiImageModel: rc.openaiImageModel,
    openaiBaseUrl: rc.openaiBaseUrl,
    chromiumPath: rc.chromiumPath,
    captureMaxConcurrency: Number(rc.captureMaxConcurrency),
    captureAllowPrivate: String(rc.captureAllowPrivate) === 'true',
    uploadMaxMb: Number(rc.uploadMaxMb),
    appUrl: rc.appUrl,
    appName: rc.appName,
    mailFrom: rc.mailFrom,
    smtpUrl: rc.smtpUrl,
    allowSignup: String(rc.allowSignup) !== 'false',
    requireEmailVerification: String(rc.requireEmailVerification) === 'true',
    billingMode: rc.billingMode === 'credits' ? 'credits' : 'off',
    aiDailyLimitUsd: Number(rc.aiDailyLimitUsd),
    aiWorkspaceDailyLimitUsd: Number(rc.aiWorkspaceDailyLimitUsd),
    stripeSecretKey: rc.stripeSecretKey,
    stripeWebhookSecret: rc.stripeWebhookSecret,
  });
  getDb();
  setWorkspaceCreatedHook(async (ws) => { await createSampleProject(ws.id); });
  await recoverInterrupted();
  generations.failOrphaned();
  startQueue();
  // Social media is uit de studio gehaald: bestaande social-gegevens eenmalig omzetten (met back-up vooraf).
  await retireSocial().catch((e) => log.error('migration.social_failed', { error: String(e) }));
  seedSystemLibrary().catch((e) => log.error('seed.failed', { error: String(e) }));
  void housekeeping();
  const hk = setInterval(housekeeping, 6 * 3600_000);
  hk.unref();
  // Levende websitemockups: elk uur kijken welke websites opnieuw moeten worden vastgelegd.
  const living = setInterval(() => { try { scheduleDueRecaptures(); } catch (e) { log.warn('living.schedule_failed', { error: String(e) }); } }, 3600_000);
  living.unref();
  log.info('server.started', { dataDir: rc.dataDir, provider: rc.imageProvider, billing: rc.billingMode });
  nitro.hooks.hook('close', async () => {
    clearInterval(hk);
    clearInterval(living);
    stopQueue();
    await closeBrowser();
    await closeEgressProxy();
    await closePool();
  });
});
