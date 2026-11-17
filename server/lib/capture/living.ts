// Levende websitemockups: een vastgelegde website opnieuw vastleggen (handmatig of op een vast ritme).
// Verandert de pagina, dan wordt het een nieuwe versie van hetzelfde ontwerp en worden alle mockups
// opnieuw gerenderd. Is de pagina gelijk gebleven, dan verandert er niets.
import type { Asset } from '../../../shared/types';
import { badRequest } from '../errors';
import { enqueue, registerJob, type Job } from '../jobs/queue';
import { getDb } from '../db';
import { log } from '../log';
import { assets, projects } from '../repositories';
import { assertFeature, hasFeature } from '../billing/plans';
import { replaceAsset } from '../versions';
import { captureWebsite, type ViewportId } from './capture';

export type RefreshInterval = 'off' | 'daily' | 'weekly';
const INTERVAL_MS: Record<Exclude<RefreshInterval, 'off'>, number> = { daily: 86400_000, weekly: 7 * 86400_000 };

export async function recaptureAsset(asset: Asset, userId: string | null) {
  if (asset.source !== 'url' || typeof asset.meta.url !== 'string') throw badRequest('Dit ontwerp komt niet van een website en kan niet opnieuw worden vastgelegd.');
  const shot = await captureWebsite({
    url: asset.meta.url,
    viewport: (asset.meta.viewport as ViewportId) ?? 'desktop',
    fullPage: !!asset.meta.fullPage,
    hideCookieBanners: asset.meta.hideCookieBanners !== false,
    delayMs: typeof asset.meta.delayMs === 'number' ? asset.meta.delayMs : undefined,
  });
  const res = await replaceAsset(asset, shot.png, {
    note: 'Website opnieuw vastgelegd', userId,
    metaExtra: { finalUrl: shot.finalUrl, title: shot.title, capturedAt: new Date().toISOString(), warnings: shot.warnings, lastRefreshError: null },
  });
  return { ...res, warnings: shot.warnings };
}

export function setAutoRefresh(asset: Asset, interval: RefreshInterval) {
  if (asset.source !== 'url') throw badRequest('Alleen vastgelegde websites kunnen automatisch worden bijgewerkt.');
  if (interval !== 'off') assertFeature(projects.get(asset.projectId)!.workspaceId, 'living');
  assets.updateMeta(asset.id, { ...asset.meta, autoRefresh: interval });
  return assets.get(asset.id)!;
}

/** Zet websites waarvan de laatste vastlegging ouder is dan hun ritme in de wachtrij. */
export function scheduleDueRecaptures(nowMs = Date.now()) {
  const rows = getDb().prepare("SELECT id FROM assets WHERE source = 'url' AND meta LIKE '%\"autoRefresh\":\"%'").all() as { id: string }[];
  let queued = 0;
  for (const { id } of rows) {
    const a = assets.get(id);
    const interval = a?.meta.autoRefresh as RefreshInterval | undefined;
    if (!a || !interval || interval === 'off') continue;
    // Na een overstap naar een plan zonder deze functie niet meer automatisch vastleggen.
    const ws = projects.get(a.projectId)?.workspaceId;
    if (!ws || !hasFeature(ws, 'living')) continue;
    const last = Date.parse(String(a.meta.capturedAt ?? a.updatedAt ?? a.createdAt));
    if (Number.isFinite(last) && nowMs - last < INTERVAL_MS[interval] - 30 * 60_000) continue;
    const pending = getDb().prepare("SELECT 1 FROM jobs WHERE type = 'recapture-asset' AND ref = ? AND status IN ('queued', 'running')").get(id);
    if (pending) continue;
    enqueue('recapture-asset', { assetId: id }, { ref: id, maxAttempts: 2 });
    queued++;
  }
  return queued;
}

registerJob<{ assetId: string }>('recapture-asset', {
  concurrency: 1,
  timeoutMs: 3 * 60_000,
  async run(job: Job<{ assetId: string }>) {
    const a = assets.get(job.payload.assetId);
    if (!a) return;
    const res = await recaptureAsset(a, null);
    log.info('asset.recaptured', { asset: a.id, changed: res.changed, mockups: res.affectedMockups });
  },
  onFail(job, error) {
    // Een mislukte automatische vastlegging laat het ontwerp ongewijzigd; noteer het voor de interface.
    const a = assets.get(job.payload.assetId);
    if (a) assets.updateMeta(a.id, { ...a.meta, lastRefreshError: error, lastRefreshAttempt: new Date().toISOString() });
  },
});
