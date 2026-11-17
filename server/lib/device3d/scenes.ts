// Scènes met een echt 3D-device. De achtergrond (AI-omgeving, effen kleur of eigen foto) wordt apart bewaard; het
// device wordt erop gerenderd. Het schermvlak (hoeken en exact masker) komt uit het 3D-model, zodat de bestaande
// pipeline het ontwerp er perspectiefcorrect en pixel-exact op zet, net als bij elke andere scène.
import sharp from 'sharp';
import type { Device3DScene, Scene, SceneConfig, SceneTags, Surface } from '../../../shared/types';
import { clampDeviceSpec, findDeviceModel, sameRender, statusBarFraction, type Device3DSpec } from '../../../shared/device3d/spec';
import { applyH, homography, rectQuad, type Quad } from '../../../shared/geometry';
import { backdropStops } from '../../../shared/palette';
import type { Backdrop } from '../../../shared/scene-style';
import { backdropColorAt } from '../imaging/backdrop';
import { AppError, notFound } from '../errors';
import { newId } from '../ids';
import { keys } from '../keys';
import { scenes } from '../repositories';
import { storage } from '../storage';
import { MAX_SCENE_EDGE } from '../scenes';
import { renderDevice, type DeviceRender } from './render';

const now = () => new Date().toISOString();
const SCREEN_ID = 'screen';

export interface CreateScene3dInput {
  workspaceId: string | null;
  projectId: string | null;
  origin: Scene['origin'];
  inLibrary: boolean;
  title: string;
  category: string;
  objectType: string;
  spec: Device3DSpec;
  /** Achtergrond zonder device. */
  background: Buffer;
  tags?: SceneTags;
  prompt?: string;
  config?: SceneConfig | null;
  provider?: string;
  model?: string;
  license?: string;
}

/** Bewaart een render als bestanden onder de map van de scène; elke render krijgt eigen namen (geen oude caches). */
async function storeRender(base: string, r: DeviceRender, spec: Device3DSpec): Promise<Pick<Scene, 'file' | 'thumb' | 'width' | 'height' | 'surfaces'> & { screen: Device3DScene['screen'] }> {
  const model = findDeviceModel(spec.model)!;
  const v = Date.now().toString(36);
  const file = `${base}/scene-${v}.png`, thumb = `${base}/thumb-${v}.webp`, maskFile = `${base}/mask-${v}.png`;
  await storage.put(file, r.image);
  await storage.put(maskFile, r.mask);
  // Miniatuur zonder fel groen: het scherm donker, zoals een toestel dat uit staat.
  const alpha = await sharp(r.mask).greyscale().raw().toBuffer();
  const dark = await sharp({ create: { width: r.width, height: r.height, channels: 3, background: '#0c0d10' } }).joinChannel(alpha, { raw: { width: r.width, height: r.height, channels: 1 } }).png().toBuffer();
  const off = await sharp(r.image).composite([{ input: dark }]).png().toBuffer();
  await storage.put(thumb, await sharp(off).resize({ width: 640, height: 640, fit: 'inside' }).webp({ quality: 82 }).toBuffer());
  const screen = r.facing ? { quad: r.quad, aspect: model.screenMM[0] / model.screenMM[1] } : null;
  return { file, thumb, width: r.width, height: r.height, surfaces: screenSurfaces(screen, maskFile, spec), screen };
}

/**
 * Het ontwerpvlak van een 3D-scherm: het hele scherm, of met een statusbalk het deel eronder. Dat deel is exact:
 * dezelfde perspectieftransformatie als het scherm, met de echte verhouding van het model.
 */
export function screenSurfaces(screen: { quad: Quad; aspect: number } | null, maskFile: string | null, spec: Device3DSpec): Surface[] {
  if (!screen) return [];
  const t = statusBarFraction(spec);
  let quad = screen.quad, aspect = screen.aspect;
  if (t > 0) {
    const H = homography(rectQuad(1, 1), screen.quad);
    quad = [applyH(H, 0, t), applyH(H, 1, t), applyH(H, 1, 1), applyH(H, 0, 1)] as Quad;
    aspect = screen.aspect / (1 - t);
  }
  // De echte schermverhouding uit het model: ook recht van voren of van boven (evenwijdige randen) exact.
  return [{ id: SCREEN_ID, label: 'Scherm', kind: 'screen', quad, maskFile, shadingFile: null, detection: '3d', fillColor: '#050506', quality: 1, mesh: null, cylinder: null, aspect }];
}

export async function createScene3d(input: CreateScene3dInput): Promise<Scene> {
  const spec = clampDeviceSpec(input.spec);
  const model = findDeviceModel(spec.model)!;
  const id = newId();
  const base = keys.scene(input.workspaceId, id);
  try {
    const bgKey = `${base}/background.png`;
    const bg = await sharp(input.background).rotate().resize({ width: MAX_SCENE_EDGE, height: MAX_SCENE_EDGE, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer();
    await storage.put(bgKey, bg);
    const r = await renderDevice({ spec, background: bg, maxEdge: MAX_SCENE_EDGE });
    const { screen, ...files } = await storeRender(base, r, spec);
    const w = files.width, h = files.height;
    const scene: Scene = {
      id, workspaceId: input.workspaceId, projectId: input.projectId, origin: input.origin, inLibrary: input.inLibrary,
      title: input.title, category: input.category, objectType: input.objectType,
      tags: { ...input.tags, orientation: input.tags?.orientation ?? (w / h > 1.08 ? 'landscape' : w / h < 0.92 ? 'portrait' : 'square') },
      ...files,
      prompt: input.prompt ?? '', config: input.config ?? null, provider: input.provider ?? '', model: input.model ?? '',
      license: input.license ?? model.license, createdAt: now(),
      device3d: { spec, background: bgKey, light: r.light, screen },
    };
    scenes.insert(scene);
    return scene;
  } catch (e) {
    await storage.remove(base).catch(() => {});
    throw e;
  }
}

/** Rendert een 3D-scène opnieuw met nieuwe instellingen. Oude bestanden worden pas daarna opgeruimd. */
export async function rerenderScene3d(sceneId: string, spec: Device3DSpec): Promise<Scene> {
  const scene = scenes.get(sceneId);
  if (!scene) throw notFound('Scène');
  if (!scene.device3d) throw new AppError(400, 'Deze scène heeft geen 3D-device.', 'not_3d');
  const next = clampDeviceSpec({ ...spec, model: scene.device3d.spec.model });
  // Alleen de statusbalk anders (tijd, datum, kleur, aan of uit): geen nieuwe 3D-render, alleen het ontwerpvlak.
  if (sameRender(next, scene.device3d.spec)) {
    const screen = scene.device3d.screen ?? (scene.surfaces[0] ? { quad: scene.surfaces[0].quad, aspect: scene.surfaces[0].aspect ?? 1 } : null);
    const device3d: Device3DScene = { ...scene.device3d, spec: next, screen };
    return scenes.replaceRender(sceneId, { file: scene.file, thumb: scene.thumb, width: scene.width, height: scene.height, surfaces: screenSurfaces(screen, scene.surfaces[0]?.maskFile ?? null, next), device3d })!;
  }
  const r = await renderDevice({ spec: next, background: await storage.read(scene.device3d.background), maxEdge: MAX_SCENE_EDGE });
  const base = scene.file.slice(0, scene.file.lastIndexOf('/'));
  const { screen, ...files } = await storeRender(base, r, next);
  const device3d: Device3DScene = { ...scene.device3d, spec: next, light: r.light, screen };
  const updated = scenes.replaceRender(sceneId, { ...files, device3d });
  for (const old of [scene.file, scene.thumb, ...scene.surfaces.map((s) => s.maskFile)]) if (old && old !== scene.device3d.background) await storage.remove(old).catch(() => {});
  return updated!;
}

/** Kopie van een 3D-scène (zelfde achtergrond) voor één mockup, zodat aanpassen andere mockups niet raakt. */
export async function forkScene3d(sceneId: string, owner: { workspaceId: string; projectId: string }, spec: Device3DSpec): Promise<Scene> {
  const scene = scenes.get(sceneId);
  if (!scene?.device3d) throw new AppError(400, 'Deze scène heeft geen 3D-device.', 'not_3d');
  return createScene3d({
    workspaceId: owner.workspaceId, projectId: owner.projectId, origin: scene.origin === 'demo' ? 'generated' : scene.origin, inLibrary: false,
    title: scene.title, category: scene.category, objectType: scene.objectType, spec, background: await storage.read(scene.device3d.background),
    tags: scene.tags, prompt: scene.prompt, config: scene.config, provider: scene.provider, model: scene.model, license: scene.license,
  });
}

/** Effen of verlopende achtergrond, exact in de opgegeven kleuren (voor een device zonder AI-omgeving). */
export async function flatBackground(b: Pick<Backdrop, 'mode' | 'color' | 'color2' | 'stops' | 'direction'>, width: number, height: number): Promise<Buffer> {
  const stops = backdropStops(b as Backdrop);
  if (b.mode !== 'gradient' || stops.length < 2) return sharp({ create: { width, height, channels: 3, background: b.color } }).png().toBuffer();
  const data = Buffer.alloc(width * height * 3);
  const aspect = width / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = backdropColorAt(b as Backdrop, x / Math.max(1, width - 1), y / Math.max(1, height - 1), aspect);
    const i = (y * width + x) * 3;
    data[i] = Math.round(c[0]); data[i + 1] = Math.round(c[1]); data[i + 2] = Math.round(c[2]);
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
