// Mockups aanmaken, bijwerken, renderen en exporteren. Renderen gebeurt in de rekenpool.
import { zipSync } from 'fflate';
import { findObject, smartFit } from '../../shared/catalog';
import { isConvexQuad, surfaceDimensions, type Quad } from '../../shared/geometry';
import { findDeviceModel, statusBarFraction } from '../../shared/device3d/spec';
import { newMailLayout, templateFor, type ScreenLayout } from '../../shared/mail';
import { resolveGeometry } from '../../shared/warp';
import { DEFAULT_BLEND, DEFAULT_TRANSFORM, type ExportRecord, type Mockup, type Placement, type Scene } from '../../shared/types';
import { badRequest, notFound } from './errors';
import { newId, now } from './ids';
import { runTask } from './imaging/pool';
import type { EncodedImage, PlacementSpec, RenderSpec } from './imaging/tasks';
import { dirOf, keys } from './keys';
import { findPreset } from '../../shared/export-presets';
import { assets, exportsRepo, mockups, projects, scenes } from './repositories';
import { storage } from './storage';
import { assertFeature, maxExportEdge } from './billing/plans';

/** Ligt het vlak liggend in beeld (laptop) of staand (telefoon)? */
function landscapeOf(scene: Scene, surfaceId: string) {
  const s = scene.surfaces.find((x) => x.id === surfaceId)!;
  const d = surfaceDimensions(s.quad, { width: scene.width, height: scene.height, aspect: s.aspect });
  return d.width > d.height;
}

/** Standaardweergave voor een scherm in een e-mailhandtekening-scène: de handtekening onder een e-mail. */
function defaultLayout(scene: Scene, surfaceId: string, assetId: string | null): ScreenLayout | null {
  const obj = findObject(scene.objectType)?.object;
  const surface = scene.surfaces.find((s) => s.id === surfaceId);
  if (!obj?.mail || surface?.kind !== 'screen') return null;
  return newMailLayout(landscapeOf(scene, surfaceId), assetId);
}

export function defaultPlacement(scene: Scene, surfaceId: string, assetId: string | null, layout?: ScreenLayout | null): Placement {
  const surface = scene.surfaces.find((s) => s.id === surfaceId)!;
  const obj = findObject(scene.objectType)?.object;
  const asset = assetId ? assets.get(assetId) : null;
  const lay = layout === undefined ? defaultLayout(scene, surfaceId, assetId) : layout;
  // Met een mailweergave vult het opgebouwde scherm het vlak precies; anders de passing van het object.
  const fit = lay ? 'fill' : smartFit(obj?.defaultFit ?? 'cover', asset, surfaceDimensions(surface.quad, { width: scene.width, height: scene.height, aspect: surface.aspect }));
  return {
    layout: lay,
    surfaceId,
    assetId,
    transform: { ...DEFAULT_TRANSFORM, fit, anchor: 'top', scale: lay ? 1 : obj?.defaultScale ?? DEFAULT_TRANSFORM.scale },
    quad: null,
    mesh: null,
    cylinder: null,
    blend: { ...DEFAULT_BLEND[surface.kind] },
    // Handmatig vlak op een foto: de foto toont het object al, dus geen vulkleur. Chroma-vlak: het groen
    // moet weg; schermen krijgen de standaardkleur, printvlakken lopen naadloos op in het object, andere
    // objecten krijgen de kleur rondom het vlak.
    background: surface.detection === 'manual' ? 'transparent' : surface.kind === 'screen' ? obj?.defaultBackground ?? '#ffffff' : obj?.defaultBackground === 'auto' ? 'auto' : surface.fillColor ?? obj?.defaultBackground ?? '#ffffff',
    useMask: surface.detection !== 'manual',
    hidden: false,
  };
}

/** Plaatsingen voor een scène; neemt per vlak ontwerp, passing en vulkleur over van een bestaande mockup. */
export function placementsFor(scene: Scene, assetId: string | null, from?: Mockup | null): Placement[] {
  return scene.surfaces.map((s, i) => {
    const prev = from?.placements[i] ?? from?.placements[0];
    const p = defaultPlacement(scene, s.id, prev ? prev.assetId : assetId);
    if (!prev) return p;
    // Een vulkleur van een ander soort vlak (bijvoorbeeld transparant op een foto) past niet altijd; alleen overnemen bij hetzelfde soort.
    const sameKind = from && scenes.get(from.sceneId)?.surfaces.find((x) => x.id === prev.surfaceId)?.detection === s.detection;
    // Naadloos past alleen bij printvlakken binnen een object; niet meenemen naar bijvoorbeeld een poster.
    const keepBg = sameKind && (prev.background === 'auto') === (p.background === 'auto');
    // Een mailweergave gaat mee naar een ander scherm, met de juiste weergave voor dat scherm (laptop of telefoon).
    const layout = prev.layout && s.kind === 'screen' ? { ...prev.layout, template: templateFor(landscapeOf(scene, s.id)) } : p.layout;
    const transform = layout ? { ...DEFAULT_TRANSFORM, fit: 'fill' as const, anchor: 'top' as const, scale: 1 } : p.layout ? p.transform : { ...prev.transform };
    return { ...p, layout, transform, background: keepBg ? prev.background : p.background };
  });
}

export function createMockup(input: { projectId: string; sceneId: string; assetId: string | null; generationId?: string | null; from?: Mockup | null }): Mockup {
  const project = projects.get(input.projectId);
  if (!project) throw notFound('Project');
  const scene = scenes.get(input.sceneId);
  if (!scene) throw notFound('Scène');
  if (scene.workspaceId && scene.workspaceId !== project.workspaceId) throw notFound('Scène');
  if (input.assetId) {
    const a = assets.get(input.assetId);
    if (!a || a.projectId !== project.id) throw badRequest('Dit ontwerp hoort niet bij het project.');
  }
  const m: Mockup = {
    id: newId(), projectId: project.id, sceneId: scene.id, generationId: input.generationId ?? null,
    placements: placementsFor(scene, input.assetId, input.from), favorite: false, previewFile: null, createdAt: now(), updatedAt: now(),
  };
  return mockups.insert(m);
}

export function validatePlacements(scene: Scene, projectId: string, placements: Placement[]) {
  for (const p of placements) {
    if (!scene.surfaces.some((s) => s.id === p.surfaceId)) throw badRequest('Een plaatsing verwijst naar een vlak dat niet in deze scène zit.');
    for (const id of assetIdsOf(p)) {
      const a = assets.get(id);
      if (!a || a.projectId !== projectId) throw badRequest('Een plaatsing verwijst naar een ontwerp buiten dit project.');
    }
    if (p.quad && !isConvexQuad(p.quad)) throw badRequest('De aangepaste hoeken vormen geen geldige vierhoek.');
  }
}

/** Alle ontwerpen in een plaatsing: het ontwerp zelf, of de vakken en profielfoto van het sjabloon. */
export function assetIdsOf(p: Placement): string[] {
  const ids = p.layout ? [...p.layout.slots.map((s) => s.assetId), p.layout.avatar?.assetId ?? null] : [p.assetId];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

async function designSource(assetId: string) {
  const asset = assets.get(assetId);
  if (!asset) return null;
  const sourceKey = asset.mime === 'application/pdf' ? String(asset.meta.raster) : asset.file;
  if (!sourceKey) return null;
  return { path: await storage.localPath(sourceKey), cacheKey: `${asset.id}:${sourceKey}`, mime: asset.mime === 'application/pdf' ? 'image/png' : asset.mime, width: asset.width, height: asset.height };
}

/** Status- of menubalk van een 3D-scène: het hele scherm en de instellingen van de balk, of null. */
function statusBarFor(scene: Scene): { quad: Quad; aspect: number; bar: NonNullable<PlacementSpec['statusBar']> } | null {
  const d = scene.device3d;
  const fraction = d ? statusBarFraction(d.spec) : 0;
  const model = d ? findDeviceModel(d.spec.model) : null;
  if (!d?.screen || !fraction || !model) return null;
  return { quad: d.screen.quad, aspect: d.screen.aspect, bar: { kind: model.statusBar.kind, fraction, time: d.spec.statusBar.time, date: d.spec.statusBar.date, tone: d.spec.statusBar.tone } };
}

/** Vertaalt een mockup naar een rendertaak met alleen paden en getallen. */
export async function renderSpec(mockup: Pick<Mockup, 'placements'>, scene: Scene, opts: { width: number; supersample?: number; output: RenderSpec['output'] }): Promise<RenderSpec> {
  const placements: PlacementSpec[] = [];
  for (const p of mockup.placements) {
    const surface = scene.surfaces.find((s) => s.id === p.surfaceId);
    if (!surface) continue;
    // Een verborgen ontwerp op een chroma-vlak: het vlak krijgt alleen de vulling, anders blijft het groen staan.
    if (p.hidden && !(surface.detection !== 'manual' && surface.maskFile && p.useMask)) continue;
    const asset = p.assetId && !p.hidden && !p.layout ? assets.get(p.assetId) : null;
    const sourceKey = asset ? (asset.mime === 'application/pdf' ? String(asset.meta.raster) : asset.file) : null;
    const geo = resolveGeometry(surface, p);
    let screen: PlacementSpec['screen'] = null;
    if (p.layout && !p.hidden) {
      const sources: NonNullable<PlacementSpec['screen']>['sources'] = {};
      for (const id of assetIdsOf(p)) { const src = await designSource(id); if (src) sources[id] = src; }
      screen = { layout: p.layout, sources };
    }
    // 3D-device met statusbalk: het hele scherm als vlak, de balk erin en het ontwerp in het deel eronder.
    const bar = surface.detection === '3d' && !p.hidden && (asset || screen) ? statusBarFor(scene) : null;
    placements.push({
      screen,
      quad: bar ? bar.quad : geo.quad,
      mesh: bar ? null : geo.mesh,
      cylinder: bar ? null : geo.cylinder,
      aspect: bar ? bar.aspect : geo.aspect,
      statusBar: bar?.bar ?? null,
      design: asset && sourceKey ? { path: await storage.localPath(sourceKey), cacheKey: `${asset.id}:${sourceKey}`, mime: asset.mime, width: asset.width, height: asset.height } : null,
      transform: p.transform,
      background: p.background,
      blend: p.blend,
      maskPath: p.useMask && surface.maskFile ? await storage.localPath(surface.maskFile) : null,
      shadingPath: surface.shadingFile ? await storage.localPath(surface.shadingFile) : null,
      // 3D-device: het groen zit alleen op het scherm zelf; alleen de overgangsrand corrigeren, nooit de omgeving.
      spillRadius: surface.detection === '3d' ? 3 : null,
    });
  }
  return {
    scenePath: await storage.localPath(scene.file), sceneWidth: scene.width, sceneHeight: scene.height,
    width: Math.max(1, Math.min(scene.width, Math.round(opts.width))), supersample: opts.supersample, placements, output: opts.output,
  };
}

export async function renderImage(mockup: Pick<Mockup, 'placements'>, scene: Scene, opts: { width: number; supersample?: number; output: RenderSpec['output'] }): Promise<EncodedImage> {
  return runTask('render', await renderSpec(mockup, scene, opts));
}

function workspaceOf(projectId: string) {
  const p = projects.get(projectId);
  if (!p) throw notFound('Project');
  return p.workspaceId;
}

export async function renderPreview(mockup: Mockup): Promise<Mockup> {
  const scene = scenes.get(mockup.sceneId);
  if (!scene) throw notFound('Scène');
  const img = await renderImage(mockup, scene, { width: Math.min(scene.width, 1600), supersample: 2, output: { format: 'webp', quality: 86 } });
  const key = `${keys.mockup(workspaceOf(mockup.projectId), mockup.id)}/preview-${Date.now().toString(36)}.webp`;
  await storage.put(key, img.buffer);
  const latest = mockups.get(mockup.id);
  if (!latest) { await storage.remove(key); throw notFound('Mockup'); }
  if (latest.previewFile && latest.previewFile !== key) await storage.remove(latest.previewFile).catch(() => {});
  return mockups.update(mockup.id, { previewFile: key })!;
}

/** Snelle render voor de editor; wordt niet opgeslagen. */
export async function renderLive(mockup: Pick<Mockup, 'placements' | 'sceneId'>, width: number): Promise<Uint8Array> {
  const scene = scenes.get(mockup.sceneId);
  if (!scene) throw notFound('Scène');
  return (await renderImage(mockup, scene, { width: Math.min(scene.width, Math.max(320, width)), supersample: 2, output: { format: 'webp', quality: 88 } })).buffer;
}

export interface ExportOptions { format: 'png' | 'jpg' | 'tiff'; quality: number; width?: number; preset?: string | null; cmyk?: boolean }

/** Midden van alle ontwerpvlakken, als fractie van de scène; bijsnijden houdt deze plek in beeld. */
function focusOf(mockup: Mockup, scene: Scene): [number, number] {
  const pts = mockup.placements.flatMap((p) => p.quad ?? scene.surfaces.find((s) => s.id === p.surfaceId)?.quad ?? []);
  if (!pts.length) return [0.5, 0.5];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [((Math.min(...xs) + Math.max(...xs)) / 2) / scene.width, ((Math.min(...ys) + Math.max(...ys)) / 2) / scene.height];
}

/** Herkomstregel voor in de EXIF: welke originelen erin staan, met hun vingerafdruk. */
export async function provenance(mockup: Mockup): Promise<string> {
  const parts: string[] = [];
  for (const id of new Set(mockup.placements.filter((p) => !p.hidden).flatMap(assetIdsOf))) {
    const a = assets.get(id);
    if (!a) continue;
    let hash = typeof a.meta.sha256 === 'string' ? a.meta.sha256 : null;
    if (!hash) {
      const { createHash } = await import('node:crypto');
      hash = createHash('sha256').update(await storage.read(a.file)).digest('hex');
      assets.updateMeta(a.id, { ...a.meta, sha256: hash });
    }
    // Geen haakjes: libvips leest 'tekst (uitleg)' in EXIF als opgemaakte waarde en kapt dan af.
    parts.push(`${a.originalName.replace(/[()]/g, '')}, SHA-256 ${hash}`);
  }
  return parts.length ? `Ontwerp geplaatst zonder AI-bewerking: ${parts.join(' | ')}` : 'Mockup Studio';
}

export async function exportMockup(mockup: Mockup, opts: ExportOptions): Promise<ExportRecord> {
  const scene = scenes.get(mockup.sceneId);
  if (!scene) throw notFound('Scène');
  const ws = workspaceOf(mockup.projectId);
  if (opts.format === 'tiff') assertFeature(ws, 'tiff');
  // Maximale exportmaat van het plan: de langste zijde wordt begrensd, de verhouding blijft gelijk.
  const edge = maxExportEdge(ws);
  if (edge) {
    const longest = Math.max(scene.width, scene.height);
    const cap = Math.round(scene.width * Math.min(1, edge / longest));
    opts = { ...opts, width: Math.min(opts.width ?? scene.width, cap) };
  }
  const quality = Math.max(40, Math.min(100, Math.round(opts.quality)));
  const preset = findPreset(opts.preset);
  const img = await renderImage(mockup, scene, {
    width: preset ? scene.width : opts.width ?? scene.width,
    supersample: 3,
    output: {
      format: opts.format,
      quality,
      crop: preset && preset.height ? { aspect: preset.width / preset.height, focus: focusOf(mockup, scene) } : null,
      size: preset ? { width: preset.width, height: preset.height } : null,
      cmykProfile: opts.format === 'tiff' && opts.cmyk !== false ? process.env.NUXT_CMYK_ICC || 'cmyk' : null,
      dpi: 300,
      description: await provenance(mockup),
    },
  });
  const id = newId();
  const file = `${keys.exports(workspaceOf(mockup.projectId), mockup.projectId)}/${id}.${opts.format === 'tiff' ? 'tif' : opts.format}`;
  await storage.put(file, img.buffer);
  return exportsRepo.insert({ id, mockupId: mockup.id, projectId: mockup.projectId, format: opts.format, quality, file, width: img.width, height: img.height, createdAt: now() });
}

export async function zipExports(records: ExportRecord[], projectName: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const base = projectName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'mockups';
  let i = 1;
  for (const r of records) {
    files[`${base}-${String(i++).padStart(2, '0')}.${r.format === 'tiff' ? 'tif' : r.format}`] = new Uint8Array(await storage.read(r.file));
  }
  // Beelden zijn al gecomprimeerd; opnieuw comprimeren kost alleen tijd.
  return zipSync(files, { level: 0 });
}

export async function deleteMockup(id: string) {
  const m = mockups.get(id);
  if (!m) throw notFound('Mockup');
  for (const e of exportsRepo.list({ mockupId: id })) await storage.remove(e.file).catch(() => {});
  mockups.remove(id);
  if (m.previewFile) await storage.remove(dirOf(m.previewFile)).catch(() => {});
}
