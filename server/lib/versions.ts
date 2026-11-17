// Ontwerpversies: een ontwerp vervangen door een nieuwe versie (upload of opnieuw vastgelegde website)
// zonder dat mockups hun koppeling verliezen. Alle mockups met dit ontwerp worden daarna opnieuw
// gerenderd. Vorige versies blijven bewaard en kunnen worden teruggezet.
import { createHash } from 'node:crypto';
import type { Asset, AssetVersion } from '../../shared/types';
import { getConfig } from './config';
import { AppError, badRequest, notFound } from './errors';
import { newId, now } from './ids';
import { openImage, thumbnail } from './imaging/io';
import { enqueue, registerJob, type Job } from './jobs/queue';
import { keys } from './keys';
import { log } from './log';
import { renderPreview } from './mockups';
import { assets, assetVersions, mockups, projects } from './repositories';
import { storage } from './storage';
import { checkSvg, renderPdfPages, sniffType } from './uploads';

/** Zoveel vorige versies bewaren we per ontwerp; oudere worden opgeruimd. */
export const MAX_VERSIONS = 20;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };

interface Content { mime: string; file: string; preview: string; width: number; height: number; meta: Record<string, unknown> }

/** Valideert en bewaart de bestanden voor een nieuwe versie, onder de map van het ontwerp. */
async function storeContent(asset: Asset, workspaceId: string, buffer: Buffer, version: number): Promise<Content & { sha256: string }> {
  const max = getConfig().uploadMaxMb * 1024 * 1024;
  if (!buffer.length) throw badRequest('Het bestand is leeg.');
  if (buffer.length > max) throw new AppError(413, `Het bestand is groter dan ${getConfig().uploadMaxMb} MB.`, 'too_large');
  const mime = sniffType(buffer);
  if (!mime) throw new AppError(415, 'Dit bestandstype wordt niet ondersteund. Gebruik PNG, JPG, WebP, SVG of PDF.', 'unsupported_type');
  if (asset.kind === 'reference' && mime === 'application/pdf') throw badRequest('Gebruik voor referentiebeelden een PNG, JPG of WebP.');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const dir = keys.asset(workspaceId, asset.id);
  const v = `v${version}`;

  if (mime === 'application/pdf') {
    // Zelfde pagina als de vorige versie, of de eerste als de nieuwe PDF korter is.
    const want = Math.max(1, Number(asset.meta.page) || 1);
    const pages = await renderPdfPages(buffer, { maxPages: want, targetWidth: 3200 }).catch((e) => {
      if (e instanceof AppError) throw e;
      throw badRequest('Deze PDF kon niet worden gelezen. Mogelijk is het bestand beschadigd of beveiligd met een wachtwoord.', 'pdf_invalid');
    });
    const page = pages[Math.min(want, pages.length) - 1]!;
    const file = `${dir}/original-${v}.pdf`;
    const raster = `${dir}/page-${v}.png`;
    const preview = `${dir}/preview-${v}.webp`;
    await storage.put(file, buffer);
    await storage.put(raster, page.png);
    await storage.put(preview, await thumbnail(page.png, 1600));
    return { mime, file, preview, width: page.width, height: page.height, meta: { raster, page: page.page, pages: page.pages, sha256 }, sha256 };
  }

  if (mime === 'image/svg+xml') checkSvg(buffer.toString('utf8'));
  let meta;
  try { meta = await openImage(buffer).metadata(); } catch { throw badRequest('Dit beeld kon niet worden gelezen. Mogelijk is het bestand beschadigd.', 'image_invalid'); }
  if (!meta.width || !meta.height) throw badRequest('Dit beeld heeft geen leesbare afmetingen.');
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  const file = `${dir}/original-${v}.${EXT[mime]}`;
  const preview = `${dir}/preview-${v}.webp`;
  await storage.put(file, buffer);
  const previewSource = mime === 'image/svg+xml' ? await openImage(buffer, { density: Math.min(600, Math.max(72, (72 * 1600) / width)) }).png().toBuffer() : buffer;
  await storage.put(preview, await thumbnail(previewSource, 1600));
  return { mime, file, preview, width, height, meta: { hasAlpha: !!meta.hasAlpha, bytes: buffer.length, sha256 }, sha256 };
}

/** Bewaart de huidige inhoud als versie. De notitie beschrijft hoe díe versie is ontstaan. */
function snapshot(asset: Asset, userId: string | null): AssetVersion {
  const note = typeof asset.meta.versionNote === 'string' ? asset.meta.versionNote : '';
  return assetVersions.insert({
    id: newId(), assetId: asset.id, version: asset.version, originalName: asset.originalName, mime: asset.mime, file: asset.file,
    preview: asset.preview, width: asset.width, height: asset.height, meta: asset.meta, note, createdBy: userId, createdAt: asset.updatedAt ?? asset.createdAt,
  });
}

/** Bestanden die niet meer door het ontwerp of een bewaarde versie worden gebruikt, mogen weg. */
async function prune(asset: Asset) {
  const versions = assetVersions.list(asset.id);
  for (const old of versions.slice(MAX_VERSIONS)) {
    assetVersions.remove(old.id);
    const current = assets.get(asset.id);
    const keep = new Set<string>();
    for (const x of [current, ...assetVersions.list(asset.id)]) {
      if (!x) continue;
      keep.add(x.file); keep.add(x.preview);
      if (typeof x.meta.raster === 'string') keep.add(x.meta.raster);
    }
    for (const f of [old.file, old.preview, typeof old.meta.raster === 'string' ? old.meta.raster : null]) {
      // Gedeelde originelen van een meerpagina-PDF uit de eerste upload laten we staan.
      if (f && !keep.has(f) && f.includes(`/assets/${asset.id}/`)) await storage.remove(f).catch(() => {});
    }
  }
}

export interface ReplaceResult { changed: boolean; asset: Asset; affectedMockups: number }

/**
 * Vervangt de inhoud van een ontwerp. Is het nieuwe bestand identiek aan het huidige, dan gebeurt er niets.
 * Mockups houden hun passing (schaal, positie, rotatie); die is relatief aan het ontwerp.
 */
export async function replaceAsset(asset: Asset, buffer: Buffer, opts: { filename?: string; note?: string; userId: string | null; metaExtra?: Record<string, unknown> }): Promise<ReplaceResult> {
  const project = projects.get(asset.projectId);
  if (!project) throw notFound('Project');
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (asset.meta.sha256 === hash) {
    if (opts.metaExtra) assets.updateMeta(asset.id, { ...asset.meta, ...opts.metaExtra });
    return { changed: false, asset: assets.get(asset.id)!, affectedMockups: 0 };
  }
  const next = asset.version + 1;
  const content = await storeContent(asset, project.workspaceId, buffer, next);
  snapshot(asset, opts.userId);
  // Websitegegevens (URL, viewport) blijven bij een opnieuw vastgelegde pagina behouden.
  const keepMeta = asset.source === 'url' ? Object.fromEntries(Object.entries(asset.meta).filter(([k]) => ['url', 'viewport', 'fullPage', 'hideCookieBanners', 'delayMs', 'autoRefresh'].includes(k))) : {};
  const name = opts.filename ? opts.filename.replace(/[^\p{L}\p{N}._ ()-]+/gu, '').slice(0, 120) || asset.originalName : asset.originalName;
  const updated = assets.replaceContent(asset.id, {
    originalName: name, mime: content.mime, file: content.file, preview: content.preview, width: content.width, height: content.height,
    meta: { ...keepMeta, ...content.meta, ...opts.metaExtra, versionNote: opts.note ?? '' }, version: next,
  })!;
  await prune(updated);
  const affected = queueRerender(asset.id);
  log.info('asset.version', { asset: asset.id, version: next, mockups: affected });
  return { changed: true, asset: updated, affectedMockups: affected };
}

/** Zet een eerdere versie terug als nieuwste versie; de huidige blijft als versie bewaard. */
export async function restoreVersion(asset: Asset, versionId: string, userId: string | null): Promise<ReplaceResult> {
  const v = assetVersions.get(versionId);
  if (!v || v.assetId !== asset.id) throw notFound('Versie');
  snapshot(asset, userId);
  const updated = assets.replaceContent(asset.id, {
    originalName: v.originalName, mime: v.mime, file: v.file, preview: v.preview, width: v.width, height: v.height,
    meta: { ...v.meta, restoredFrom: v.version, versionNote: `Versie ${v.version} teruggezet`, ...(asset.source === 'url' ? { url: asset.meta.url, viewport: asset.meta.viewport, fullPage: asset.meta.fullPage, autoRefresh: asset.meta.autoRefresh } : {}) },
    version: asset.version + 1,
  })!;
  await prune(updated);
  return { changed: true, asset: updated, affectedMockups: queueRerender(asset.id) };
}

function queueRerender(assetId: string) {
  const n = mockups.usingAsset(assetId).length;
  if (n) enqueue('rerender-asset', { assetId }, { ref: assetId, maxAttempts: 2 });
  return n;
}

registerJob<{ assetId: string }>('rerender-asset', {
  concurrency: 1,
  timeoutMs: 10 * 60_000,
  async run(job: Job<{ assetId: string }>) {
    for (const m of mockups.usingAsset(job.payload.assetId)) {
      await renderPreview(m).catch((e) => log.warn('asset.rerender_failed', { mockup: m.id, error: (e as Error).message }));
    }
  },
});
