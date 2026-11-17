// Generaties: invoer controleren, credits reserveren, taak in de wachtrij zetten. De taak zelf roept
// de beeldprovider aan, analyseert de scènes en plaatst het ontwerp. Een mislukte aanroep levert een
// duidelijke foutmelding op, de credits gaan terug en er wordt nooit een resultaat verzonnen.
import { findObject } from '../../../shared/catalog';
import { isValidSize, sizeMode, surfaceOrientationFor } from '../../../shared/design-size';
import { SCENE_TYPES, chromaConflict, keyConflict } from '../../../shared/scene-style';
import { backdropStops, normalizeSceneColors, paletteProblem, sceneBackdrop, scenePalette } from '../../../shared/palette';
import { deviceSpecFor, findDeviceModel, variantSpec } from '../../../shared/device3d/spec';
import { createScene3d, flatBackground } from '../device3d/scenes';
import { creditsFor, estimateCost } from '../../../shared/pricing';
import { outputSize } from '../../../shared/sizes';
import type { Generation, SceneConfig } from '../../../shared/types';
import { assertSpendLimits, refundCredits, reserveCredits } from '../billing/credits';
import { AppError, badRequest, notFound } from '../errors';
import { newId, now } from '../ids';
import { openImage } from '../imaging/io';
import { enqueue, registerJob, waitForJob, type Job } from '../jobs/queue';
import { log } from '../log';
import { createMockup, renderPreview } from '../mockups';
import { assets, generations, mockups, projects } from '../repositories';
import { users } from '../repo-accounts';
import { isVerified } from '../auth/verification';
import { createScene } from '../scenes';
import { storage, tempDir } from '../storage';
import { runTask } from '../imaging/pool';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPrompt } from './prompt';
import { getProvider } from './providers';

export interface StartInput {
  projectId: string;
  assetId: string | null;
  config: SceneConfig;
  count: number;
  provider?: string;
  userId?: string | null;
}

/**
 * Een kleur die op het groene ontwerpvlak lijkt, maakt automatisch vinden onbetrouwbaar: de studio zou de
 * achtergrond voor het vlak kunnen aanzien. Dan vooraf weigeren, met wat de gebruiker wel kan doen.
 */
export function sceneColorProblem(cfg: SceneConfig): string | null {
  const bad = chromaConflict(cfg);
  if (bad) return `De kleur ${bad} lijkt te veel op het groene vlak waarmee de studio het ontwerpvlak vindt. Kies een andere kleur, of kies bij "Hoe wordt het ontwerpvlak gevonden?" voor "Leeg vlak, zelf aanwijzen".`;
  return keyProblem(cfg) ?? paletteProblem(scenePalette(cfg));
}

/** Een kleur in de scène die op het magenta sleutelscherm lijkt, zou bij een exacte achtergrond mee vervangen worden. */
export function keyProblem(cfg: SceneConfig): string | null {
  const bad = keyConflict(cfg);
  return bad ? `De kleur ${bad} lijkt op het magenta scherm waarmee de studio de achtergrond exact maakt, en zou dan mee vervangen kunnen worden. Kies een andere tint, of zet de achtergrond op Door de AI.` : null;
}

/** Een 3D-device op een effen achtergrond: de studio rendert alles zelf, zonder AI en zonder kosten. */
export function withoutAi(cfg: SceneConfig): boolean {
  return !!deviceSpecFor(cfg) && !!cfg.backdrop && (cfg.backdrop.mode === 'solid' || cfg.backdrop.mode === 'gradient');
}
const LOCAL_3D = { id: 'local-3d', label: '3D-model (lokaal)', model: 'three.js', isAi: false } as const;

export function previewGeneration(input: SceneConfig, count: number, providerId?: string) {
  const config = normalizeSceneColors(input);
  const local = withoutAi(config);
  const provider = local ? { ...getProvider(providerId).info(), ...LOCAL_3D, configured: true } : getProvider(providerId).info();
  const size = outputSize(config.aspect, config.resolution);
  const hasReferences = !!config.referenceAssetIds?.length && provider.supportsReferences;
  const cost = provider.isAi ? estimateCost(provider.model, config.quality, size.width, size.height, count) : { usd: 0, exact: true };
  return {
    prompt: buildPrompt(config, { hasReferences }),
    size,
    provider,
    cost,
    credits: provider.isAi ? creditsFor(config.quality, size.width, size.height, count) : 0,
    /** Waarom genereren nu niet kan (bijvoorbeeld een groene merkkleur); de knop gaat dan uit. */
    problem: sceneColorProblem(config),
  };
}

export function startGeneration(start: StartInput): Generation {
  // Eén vorm voor de kleuren, ook als de configuratie van vóór het palet is of niet via de API binnenkwam.
  const input = { ...start, config: normalizeSceneColors(start.config) };
  const project = projects.get(input.projectId);
  if (!project) throw notFound('Project');
  const found = findObject(input.config.objectType);
  if (!found) throw badRequest('Kies een object voor de scène.');
  const provider = getProvider(input.provider);
  const local = withoutAi(input.config);
  const info = local ? { ...provider.info(), ...LOCAL_3D, configured: true } : provider.info();
  if (!info.configured) throw new AppError(503, info.problem ?? 'De beeldprovider is niet geconfigureerd.', 'provider_not_configured');
  const count = Math.max(1, Math.min(info.maxCount, Math.round(input.count)));
  if (input.assetId) {
    const a = assets.get(input.assetId);
    if (!a || a.projectId !== project.id) throw badRequest('Het gekozen ontwerp hoort niet bij dit project.');
  }
  const colorProblem = sceneColorProblem(input.config);
  if (colorProblem) throw badRequest(colorProblem, 'color_conflict');
  const refIds = (input.config.referenceAssetIds ?? []).slice(0, 4);
  const refs = refIds.map((id) => assets.get(id)).filter((a) => a && a.projectId === project.id);
  if (refs.length !== refIds.length) throw badRequest('Een referentiebeeld hoort niet bij dit project.');
  const hasReferences = refs.length > 0 && info.supportsReferences;
  const prompt = buildPrompt(input.config, { hasReferences });
  const size = outputSize(input.config.aspect, input.config.resolution);
  const cost = info.isAi ? estimateCost(info.model, input.config.quality, size.width, size.height, count)?.usd ?? 0 : 0;
  const credits = info.isAi ? creditsFor(input.config.quality, size.width, size.height, count) : 0;
  if (info.isAi) {
    // AI kost geld: alleen met een bevestigd e-mailadres (houdt massaal aangemaakte accounts buiten de deur).
    const u = input.userId ? users.get(input.userId) : null;
    if (u && !isVerified(u)) throw new AppError(403, 'Bevestig eerst je e-mailadres; daarna kun je AI-scènes maken. Bibliotheekmockups werken al wel.', 'email_unverified');
    assertSpendLimits(project.workspaceId, cost, input.userId);
  }

  const id = newId();
  // Eerst credits reserveren; pas daarna bestaat de generatie. Lukt het reserveren niet, dan is er niets aangemaakt.
  reserveCredits(project.workspaceId, credits, id);
  const gen = generations.insert({
    id, projectId: project.id, status: 'queued', config: input.config, prompt, count, assetId: input.assetId,
    sceneIds: [], mockupIds: [], error: null, provider: info.id, model: info.model, credits, costUsd: cost,
    createdBy: input.userId ?? null, createdAt: now(), finishedAt: null,
  });
  enqueue('generation', { generationId: gen.id, providerId: local ? provider.info().id : info.id }, { workspaceId: project.workspaceId, ref: gen.id, maxAttempts: 1 });
  return gen;
}

interface GenerationPayload { generationId: string; providerId: string }

async function runGeneration(job: Job<GenerationPayload>) {
  const gen = generations.get(job.payload.generationId);
  if (!gen) return;
  const project = projects.get(gen.projectId);
  if (!project) return;
  const found = findObject(gen.config.objectType)!;
  const provider = getProvider(job.payload.providerId);
  const device = deviceSpecFor(gen.config);
  const local = withoutAi(gen.config);
  const info = local ? { ...provider.info(), ...LOCAL_3D } : provider.info();
  generations.update(gen.id, { status: 'running' });
  const size = outputSize(gen.config.aspect, gen.config.resolution);
  const refs = (gen.config.referenceAssetIds ?? []).map((rid) => assets.get(rid)).filter((a) => !!a);
  const references = info.supportsReferences
    ? await Promise.all(refs.map(async (a) => ({
        data: await openImage(await storage.localPath(a!.file)).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer(),
        mime: 'image/png',
        name: `referentie-${a!.id}.png`,
      })))
    : [];
  // Zonder AI: de effen achtergrond exact in de gekozen kleuren; varianten verschillen in camerastandpunt.
  let images = local
    ? await Promise.all(Array.from({ length: gen.count }, () => flatBackground(gen.config.backdrop!, size.width, size.height)))
    : await provider.generate({
      prompt: gen.prompt, width: size.width, height: size.height, quality: gen.config.quality, count: gen.count, references,
      objectType: gen.config.objectType, surfaceMethod: gen.config.surfaceMethod, config: gen.config, signal: AbortSignal.timeout(300_000),
    });
  // Platte achtergrond, of een scène met een exacte achtergrond: het model maakt een magenta sleutelscherm en de
  // studio zet de kleur er daarna exact in, zonder object, ondergrond of ontwerpvlak te raken.
  const flat = gen.config.backdrop && (gen.config.backdrop.mode === 'solid' || gen.config.backdrop.mode === 'gradient') ? gen.config.backdrop : null;
  const exact = flat ?? sceneBackdrop(gen.config);
  const notes: string[] = [];
  if (exact && !local) {
    images = await Promise.all(images.map(async (buf, i) => {
      const r = await exactBackdrop(buf, exact, i + 1);
      if (!r.ok) notes.push(`Bij variant ${i + 1} leverde het model geen egale sleutelachtergrond; de scène is bewaard zoals het model hem maakte, zonder de gekozen achtergrondkleur.`);
      return r.buffer;
    }));
  }
  const sceneIds: string[] = [];
  const mockupIds: string[] = [];
  for (const [i, buffer] of images.entries()) {
    const common = {
      workspaceId: project.workspaceId,
      projectId: project.id,
      origin: (info.isAi ? 'generated' : 'demo') as 'generated' | 'demo',
      inLibrary: true,
      title: sceneTitle(gen.config, found.object.label, i + 1, gen.count),
      category: found.category.id,
      objectType: found.object.id,
      tags: { material: gen.config.material, angle: gen.config.angle, composition: gen.config.composition, color: gen.config.color },
      prompt: gen.prompt,
      config: gen.config,
      provider: info.id,
      model: info.model,
    };
    // Echt 3D-device: de omgeving (of effen achtergrond) is de achtergrond; het device wordt erop gerenderd.
    const scene = device ? await createScene3d({
      ...common,
      origin: local ? 'generated' : common.origin,
      spec: local ? variantSpec(device, i) : device,
      background: buffer,
      license: `${findDeviceModel(device.model)!.license}${local ? '' : info.isAi ? ` Omgeving gegenereerd met ${info.label} (${info.model}).` : ' Omgeving: testscène, geen AI.'}`,
    }) : await createScene({
      buffer,
      workspaceId: project.workspaceId,
      projectId: project.id,
      origin: info.isAi ? 'generated' : 'demo',
      // Direct onder Scènes, zonder extra stap; blijft ook bewaard als het project later verdwijnt.
      inLibrary: true,
      title: sceneTitle(gen.config, found.object.label, i + 1, gen.count),
      category: found.category.id,
      objectType: found.object.id,
      surfaceKind: found.object.surfaceKind,
      tags: { material: gen.config.material, angle: gen.config.angle, composition: gen.config.composition, color: gen.config.color },
      prompt: gen.prompt,
      config: gen.config,
      provider: info.id,
      model: info.model,
      license: info.isAi ? `Gegenereerd met ${info.label} (${info.model})` : 'Testscène, geen AI. Alleen voor het testen van de workflow.',
      detect: gen.config.surfaceMethod === 'chroma',
      // Opgegeven afmetingen: het vlak wordt in die stand herkend, zodat het ontwerp rechtop staat.
      surfaceOrientation: surfaceOrientationFor(gen.config.objectType, gen.config.designSize),
    });
    sceneIds.push(scene.id);
    // Het ontwerp kan tijdens het genereren zijn verwijderd; dan een mockup zonder ontwerp.
    let m = createMockup({ projectId: project.id, sceneId: scene.id, assetId: gen.assetId && assets.get(gen.assetId) ? gen.assetId : null, generationId: gen.id });
    if (isValidSize(gen.config.designSize) && sizeMode(gen.config.objectType) === 'surface') {
      // Nooit bijsnijden of uitrekken: het hele ontwerp past binnen het vlak (bij een gelijke verhouding vult het precies).
      m = mockups.update(m.id, { placements: m.placements.map((p) => (p.layout ? p : { ...p, transform: { ...p.transform, fit: 'contain' } })) }) ?? m;
    }
    await renderPreview(m).catch((e) => log.warn('generation.preview_failed', { error: (e as Error).message }));
    mockupIds.push(m.id);
    // Tussenstand opslaan, zodat de interface de eerste resultaten al kan tonen.
    generations.update(gen.id, { sceneIds: [...sceneIds], mockupIds: [...mockupIds] });
  }
  // Een melding bij een geslaagde generatie (bijvoorbeeld een achtergrond die niet exact kon) staat in error.
  generations.update(gen.id, { status: 'done', sceneIds, mockupIds, finishedAt: now(), ...(notes.length ? { error: notes.join(' ') } : {}) });
}

/**
 * Een configuratie (generatie) verwijderen. Een lopende generatie niet: die schrijft nog scènes, mockups en
 * credits weg. Wat eruit is ontstaan (scènes in de bibliotheek, mockups) blijft gewoon bestaan.
 */
export function deleteGeneration(gen: Generation, workspaceId: string) {
  if (gen.status === 'queued' || gen.status === 'running') {
    throw new AppError(409, 'Deze configuratie wordt nu gegenereerd. Verwijder hem als de generatie klaar is.', 'generation_running');
  }
  generations.remove(gen, workspaceId);
  log.info('generation.deleted', { generation: gen.id });
}

/** Herkenbare titel in de bibliotheek: object, look en volgnummer, bijvoorbeeld 'Laptop, studio, effen #e8e2d9 2'. */
function sceneTitle(cfg: SceneConfig, object: string, n: number, total: number): string {
  const flat = cfg.backdrop && (cfg.backdrop.mode === 'solid' || cfg.backdrop.mode === 'gradient') ? cfg.backdrop : null;
  const look = flat
    ? flat.mode === 'gradient' ? `verloop ${backdropStops(flat).join(' naar ')}` : `effen ${flat.color}`
    : [SCENE_TYPES.find((t) => t.id === cfg.sceneType)?.label.toLowerCase(), paletteLabel(cfg)].filter(Boolean).join(', ');
  return `${object}${look ? `, ${look}` : ''}${total > 1 ? ` ${n}` : ''}`.slice(0, 120);
}

/** 'kleuren #243b32, #e8e1d5' of 'kleur #243b32'; ook voor configuraties van vóór het palet. */
function paletteLabel(cfg: SceneConfig): string {
  const hexes = [...new Set(scenePalette(cfg).colors.map((c) => c.hex))];
  return hexes.length ? `${hexes.length === 1 ? 'kleur' : 'kleuren'} ${hexes.slice(0, 3).join(', ')}${hexes.length > 3 ? ' …' : ''}` : '';
}

async function exactBackdrop(buffer: Buffer, backdrop: NonNullable<SceneConfig['backdrop']>, seed: number): Promise<{ buffer: Buffer; ok: boolean }> {
  const tmp = await tempDir();
  try {
    const inputPath = path.join(tmp.dir, 'in'), outPath = path.join(tmp.dir, 'out.png');
    await writeFile(inputPath, buffer);
    await runTask('flatBackdrop', { inputPath, outPath, backdrop, seed });
    return { buffer: await readFile(outPath), ok: true };
  } catch (e) {
    // Lukt het niet (geen sleutelachtergrond herkend), dan het beeld van het model houden en dat melden.
    log.warn('generation.backdrop_skipped', { error: (e as Error).message });
    return { buffer, ok: false };
  } finally {
    await tmp.cleanup();
  }
}

registerJob<GenerationPayload>('generation', {
  concurrency: 2,
  timeoutMs: 6 * 60_000,
  run: runGeneration,
  onFail(job, error) {
    const gen = generations.get(job.payload.generationId);
    if (!gen) return;
    // Alleen gebruikersvriendelijke meldingen tonen; technische details staan in de log.
    const known = /OpenAI|sleutel|tegoed|limiet|inhoudsbeleid|duurde te lang|niet bereikbaar|verzoek|opnieuw is gestart|beeld kon niet|3D-devices/i.test(error);
    generations.update(gen.id, { status: 'failed', error: known ? error : 'De generatie is mislukt door een onverwachte fout. Er is niets opgeslagen.', finishedAt: now() });
    const ws = projects.get(gen.projectId)?.workspaceId;
    if (ws) refundCredits(ws, gen.credits, gen.id);
  },
});

/** Voor tests en scripts: wacht tot een generatie klaar is. */
export async function waitForGeneration(id: string) {
  const { getDb } = await import('../db');
  const row = getDb().prepare("SELECT id FROM jobs WHERE type = 'generation' AND ref = ? ORDER BY created_at DESC LIMIT 1").get(id) as { id: string } | undefined;
  if (row) await waitForJob(row.id);
}
