// Scènes aanmaken (bibliotheekfoto, AI-generatie, testscène) en hun oppervlakken bijhouden.
// Het zware beeldwerk draait in de rekenpool; deze module regelt opslag en database.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findObject } from '../../shared/catalog';
import { isConvexQuad, type Quad } from '../../shared/geometry';
import { remapMesh, type CylinderParams, type Mesh } from '../../shared/warp';

const remapExisting = (s: Surface, quad: Quad) => (s.mesh ? remapMesh(s.mesh, s.quad, quad) : null);
import type { Scene, SceneConfig, SceneTags, Surface, SurfaceKind } from '../../shared/types';
import { AppError, badRequest, notFound } from './errors';
import { newId, now } from './ids';
import { runTask } from './imaging/pool';
import { dirOf, keys } from './keys';
import { mockups, scenes } from './repositories';
import { storage, tempDir } from './storage';

/** Grootste zijde waarop we scènes opslaan; groter levert geen zichtbare winst maar wel trage renders. */
export const MAX_SCENE_EDGE = 4096;

export interface CreateSceneInput {
  buffer: Buffer;
  /** null = systeembibliotheek. */
  workspaceId: string | null;
  projectId: string | null;
  origin: Scene['origin'];
  inLibrary: boolean;
  title: string;
  category: string;
  objectType: string;
  surfaceKind: SurfaceKind;
  tags?: SceneTags;
  prompt?: string;
  config?: SceneConfig | null;
  provider?: string;
  model?: string;
  license?: string;
  detect: boolean;
  /** Stand van het vlak als die afwijkt van het object (een staand visitekaartje); anders die van het object. */
  surfaceOrientation?: 'portrait' | 'landscape';
}

function orientationOf(w: number, h: number): SceneTags['orientation'] {
  const r = w / h;
  return r > 1.08 ? 'landscape' : r < 0.92 ? 'portrait' : 'square';
}

export async function createScene(input: CreateSceneInput): Promise<Scene> {
  const id = newId();
  const base = keys.scene(input.workspaceId, id);
  const tmp = await tempDir();
  try {
    const inputPath = path.join(tmp.dir, 'input');
    await writeFile(inputPath, input.buffer);
    const obj = findObject(input.objectType)?.object;
    const res = await runTask('analyzeScene', {
      inputPath,
      outDir: path.join(tmp.dir, 'out'),
      surfaceKind: input.surfaceKind,
      surfaceOrientation: input.surfaceOrientation ?? obj?.surfaceOrientation,
      multiDevice: input.objectType === 'multi-device',
      cylinder: obj?.cylinder,
      seamless: obj?.defaultBackground === 'auto',
      detect: input.detect,
      maxEdge: MAX_SCENE_EDGE,
    });
    const put = (name: string) => storage.putFile(`${base}/${name}`, path.join(tmp.dir, 'out', name));
    await put(res.sceneFile);
    await put(res.thumbFile);
    const surfaces: Surface[] = [];
    for (const [i, s] of res.surfaces.entries()) {
      await put(s.maskFile);
      await put(s.shadingFile);
      surfaces.push({
        id: s.id, label: res.surfaces.length > 1 ? `Vlak ${i + 1}` : 'Ontwerpvlak', kind: input.surfaceKind, quad: s.quad,
        maskFile: `${base}/${s.maskFile}`, shadingFile: `${base}/${s.shadingFile}`, detection: 'chroma', fillColor: s.fillColor,
        quality: s.fill, mesh: s.mesh, cylinder: s.cylinder,
      });
    }
    const scene: Scene = {
      id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      origin: input.origin,
      inLibrary: input.inLibrary,
      title: input.title,
      category: input.category,
      objectType: input.objectType,
      tags: { ...input.tags, orientation: input.tags?.orientation ?? orientationOf(res.width, res.height) },
      file: `${base}/${res.sceneFile}`,
      thumb: `${base}/${res.thumbFile}`,
      width: res.width,
      height: res.height,
      surfaces,
      prompt: input.prompt ?? '',
      config: input.config ?? null,
      provider: input.provider ?? '',
      model: input.model ?? '',
      license: input.license ?? '',
      createdAt: now(),
    };
    scenes.insert(scene);
    return scene;
  } catch (e) {
    await storage.remove(base).catch(() => {});
    throw e;
  } finally {
    await tmp.cleanup();
  }
}

/**
 * Slaat handmatig aangewezen oppervlakken op. Voor nieuwe of verplaatste vlakken wordt een schaduwkaart
 * berekend uit de helderheid van de foto, zodat licht en plooien ook op een lege foto meekomen.
 */
export async function saveSurfaces(sceneId: string, incoming: { id?: string; label: string; kind: SurfaceKind; quad: Quad; mesh?: Mesh | null; cylinder?: CylinderParams | null }[]): Promise<Scene> {
  const scene = scenes.get(sceneId);
  if (!scene) throw notFound('Scène');
  if (incoming.length > 12) throw badRequest('Maximaal twaalf vlakken per scène.');
  const dir = dirOf(scene.file);
  const next: Surface[] = [];
  for (const s of incoming) {
    if (!isConvexQuad(s.quad)) throw badRequest(`De hoeken van "${s.label}" vormen geen geldige vierhoek. Zet ze met de klok mee, zonder dat zijden elkaar kruisen.`);
    if (s.quad.some(([x, y]) => x < -scene.width || y < -scene.height || x > scene.width * 2 || y > scene.height * 2)) throw badRequest('Een hoek ligt ver buiten de scène.');
    const existing = s.id ? scene.surfaces.find((e) => e.id === s.id) : undefined;
    const unchanged = existing && JSON.stringify(existing.quad) === JSON.stringify(s.quad);
    if (existing && (unchanged || existing.detection !== 'manual')) {
      // Ongewijzigd, of een gedetecteerd vlak met bijgestelde hoeken: masker en schaduwkaart blijven bruikbaar.
      next.push({ ...existing, label: s.label, kind: s.kind, quad: s.quad, mesh: s.mesh === undefined ? (unchanged ? existing.mesh : remapExisting(existing, s.quad)) : s.mesh, cylinder: s.cylinder === undefined ? existing.cylinder : s.cylinder });
      continue;
    }
    const sid = existing?.id ?? newId();
    const shadingFile = `${dir}/shading-${sid}-${Date.now().toString(36)}.png`;
    await runTask('manualShading', { scenePath: await storage.localPath(scene.file), quad: s.quad, outPath: await storage.localPath(shadingFile) });
    if (existing?.shadingFile) await storage.remove(existing.shadingFile).catch(() => {});
    next.push({ id: sid, label: s.label, kind: s.kind, quad: s.quad, maskFile: null, shadingFile, detection: 'manual', fillColor: null, mesh: s.mesh ?? null, cylinder: s.cylinder ?? null });
  }
  const updated = scenes.update(sceneId, { surfaces: next });
  if (!updated) throw new AppError(500, 'Opslaan van de vlakken is mislukt.');
  return updated;
}

export async function deleteScene(id: string) {
  const scene = scenes.get(id);
  if (!scene) throw notFound('Scène');
  const affected = mockups.list({ sceneId: id });
  scenes.remove(id);
  await storage.remove(dirOf(scene.file));
  for (const m of affected) if (m.previewFile) await storage.remove(dirOf(m.previewFile)).catch(() => {});
}
