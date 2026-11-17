// Bibliotheekpijplijn: de platformbeheerder laat scènes genereren uit samengestelde presets. Elke scène
// komt eerst in een beoordelingsrij (niet zichtbaar voor gebruikers) en gaat pas na goedkeuring de
// bibliotheek in. Kosten worden vooraf getoond en tellen mee voor het dagelijkse platformplafond.
import { findObject } from '../../../shared/catalog';
import { findLibraryPreset, LIBRARY_PRESETS, presetConfig } from '../../../shared/library-presets';
import { estimateCost } from '../../../shared/pricing';
import { outputSize } from '../../../shared/sizes';
import type { SceneConfig } from '../../../shared/types';
import { assertPlatformSpend, platformSpend24h } from '../billing/credits';
import { getConfig } from '../config';
import { AppError, badRequest, notFound } from '../errors';
import { newId, now } from '../ids';
import { enqueue, registerJob, waitForJob, type Job } from '../jobs/queue';
import { buildPrompt } from '../generation/prompt';
import { getProvider } from '../generation/providers';
import { libraryRuns, scenes } from '../repositories';
import { createScene, deleteScene } from '../scenes';

export const MAX_BATCH = 30;

/** Minimale detectiekwaliteit om een scène zonder waarschuwing te kunnen publiceren. */
export const PUBLISH_QUALITY = 0.9;

export function libraryPreview(presetIds: string[], quality: SceneConfig['quality'], providerId?: string) {
  const provider = getProvider(providerId).info();
  const items = presetIds.map((id) => {
    const p = findLibraryPreset(id);
    if (!p) throw badRequest(`Onbekende preset: ${id}`);
    const config = presetConfig(p, quality);
    const size = outputSize(config.aspect, config.resolution);
    const cost = provider.isAi ? estimateCost(provider.model, quality, size.width, size.height, 1) : { usd: 0, exact: true };
    return { presetId: id, title: p.title, size, cost, prompt: buildPrompt(config, { hasReferences: false }) };
  });
  const totalUsd = items.reduce((s, i) => s + (i.cost?.usd ?? 0), 0);
  const exact = items.every((i) => i.cost?.exact !== false && i.cost !== null);
  const spent = platformSpend24h();
  const limit = getConfig().aiDailyLimitUsd;
  return {
    provider, items, totalUsd, exact,
    spend: { last24h: spent, limit, remaining: Math.max(0, limit - spent), fits: spent + totalUsd <= limit },
  };
}

export function startLibraryBatch(input: { presetIds: string[]; quality: SceneConfig['quality']; providerId?: string; userId: string | null; expectUsd?: number }) {
  const ids = [...new Set(input.presetIds)];
  if (!ids.length) throw badRequest('Kies minstens één preset.');
  if (ids.length > MAX_BATCH) throw badRequest(`Maximaal ${MAX_BATCH} presets per keer.`);
  const provider = getProvider(input.providerId);
  const info = provider.info();
  if (!info.configured) throw new AppError(503, info.problem ?? 'De beeldprovider is niet geconfigureerd.', 'provider_not_configured');
  const preview = libraryPreview(ids, input.quality, info.id);
  if (info.isAi && preview.items.some((i) => i.cost === null)) throw badRequest('Voor dit model is geen prijs bekend; de kosten kunnen niet vooraf worden bepaald.');
  // Het bevestigde bedrag moet kloppen met de berekening; anders is er iets veranderd sinds de beheerder keek.
  if (input.expectUsd !== undefined && Math.abs(input.expectUsd - preview.totalUsd) > 0.005) {
    throw new AppError(409, `De kosten zijn gewijzigd naar $${preview.totalUsd.toFixed(2)}. Bekijk de raming opnieuw en bevestig.`, 'cost_changed');
  }
  if (info.isAi) assertPlatformSpend(preview.totalUsd);
  const batchId = newId();
  const runs = preview.items.map((item) => {
    const r = libraryRuns.insert({
      id: newId(), batchId, presetId: item.presetId, status: 'queued', quality: input.quality, provider: info.id, model: info.model,
      prompt: item.prompt, costUsd: info.isAi ? item.cost?.usd ?? 0 : 0, sceneId: null, error: null, createdBy: input.userId,
      createdAt: now(), finishedAt: null,
    });
    enqueue('library-scene', { runId: r.id }, { workspaceId: null, ref: r.id, maxAttempts: 1 });
    return r;
  });
  return { batchId, runs, totalUsd: preview.totalUsd };
}

async function runLibraryScene(job: Job<{ runId: string }>) {
  const r = libraryRuns.get(job.payload.runId);
  if (!r) return;
  const preset = findLibraryPreset(r.presetId);
  if (!preset) throw new Error('De preset bestaat niet meer.');
  const found = findObject(preset.config.objectType);
  if (!found) throw new Error('Het object van deze preset bestaat niet meer.');
  libraryRuns.update(r.id, { status: 'running' });
  const config = presetConfig(preset, r.quality as SceneConfig['quality']);
  const size = outputSize(config.aspect, config.resolution);
  const provider = getProvider(r.provider);
  const [buffer] = await provider.generate({
    prompt: r.prompt, width: size.width, height: size.height, quality: config.quality, count: 1, references: [],
    objectType: config.objectType, surfaceMethod: 'chroma', signal: AbortSignal.timeout(300_000),
  });
  if (!buffer) throw new Error('De beeldprovider leverde geen beeld op.');
  const info = provider.info();
  const scene = await createScene({
    buffer, workspaceId: null, projectId: null, origin: info.isAi ? 'generated' : 'demo', inLibrary: false,
    title: preset.title, category: found.category.id, objectType: found.object.id, surfaceKind: found.object.surfaceKind,
    tags: { material: config.material, angle: config.angle, composition: config.composition, color: config.color, preset: preset.id },
    prompt: r.prompt, config, provider: info.id, model: info.model,
    license: info.isAi ? `Gegenereerd met ${info.label} (${info.model}) voor de bibliotheek` : 'Testscène, geen AI. Alleen voor het testen van de workflow.',
    detect: true,
  });
  libraryRuns.update(r.id, { status: 'done', sceneId: scene.id, finishedAt: now() });
}

registerJob<{ runId: string }>('library-scene', {
  concurrency: 2,
  timeoutMs: 6 * 60_000,
  run: runLibraryScene,
  onFail(job, error) {
    const known = /OpenAI|sleutel|tegoed|limiet|inhoudsbeleid|duurde te lang|niet bereikbaar|verzoek|opnieuw is gestart|beeld kon niet|preset|beeldprovider/i.test(error);
    libraryRuns.update(job.payload.runId, { status: 'failed', error: known ? error : 'Mislukt door een onverwachte fout; zie de serverlog.', finishedAt: now() });
  },
});

/** Scènes die wachten op beoordeling, met hun detectiekwaliteit. */
export function pendingScenes() {
  return scenes.list().filter((s) => s.workspaceId === null && !s.inLibrary);
}

export function sceneQuality(s: { surfaces: { quality?: number }[] }) {
  if (!s.surfaces.length) return 0;
  return Math.min(...s.surfaces.map((x) => x.quality ?? 1));
}

export function publishScene(id: string, opts: { force?: boolean } = {}) {
  const s = scenes.get(id);
  if (!s || s.workspaceId !== null) throw notFound('Scène');
  if (!s.surfaces.length) throw badRequest('In deze scène is geen ontwerpvlak gevonden. Wijs eerst handmatig de hoeken aan, of verwijder de scène.');
  if (sceneQuality(s) < PUBLISH_QUALITY && !opts.force) {
    throw new AppError(409, 'Het ontwerpvlak is niet met zekerheid gevonden. Controleer de hoeken in de scène-editor, of publiceer toch.', 'low_quality');
  }
  return scenes.update(id, { inLibrary: true })!;
}

export async function rejectScene(id: string) {
  const s = scenes.get(id);
  if (!s || s.workspaceId !== null || s.inLibrary) throw notFound('Scène');
  await deleteScene(id);
}

/** Overzicht per preset: hoeveel gepubliceerde en te beoordelen scènes er zijn. */
export function presetOverview() {
  const counts = new Map<string, { published: number; pending: number }>();
  for (const s of scenes.list()) {
    if (s.workspaceId !== null) continue;
    const pid = s.tags.preset;
    if (typeof pid !== 'string') continue;
    const c = counts.get(pid) ?? { published: 0, pending: 0 };
    if (s.inLibrary) c.published++; else c.pending++;
    counts.set(pid, c);
  }
  return LIBRARY_PRESETS.map((p) => {
    const obj = findObject(p.config.objectType);
    return { id: p.id, title: p.title, note: p.note, objectType: p.config.objectType, objectLabel: obj?.object.label ?? p.config.objectType, category: obj?.category.label ?? '', aspect: p.config.aspect, ...(counts.get(p.id) ?? { published: 0, pending: 0 }) };
  });
}

export async function waitForLibraryRun(runId: string) {
  const { getDb } = await import('../db');
  const row = getDb().prepare("SELECT id FROM jobs WHERE type = 'library-scene' AND ref = ? ORDER BY created_at DESC LIMIT 1").get(runId) as { id: string } | undefined;
  if (row) await waitForJob(row.id);
}
