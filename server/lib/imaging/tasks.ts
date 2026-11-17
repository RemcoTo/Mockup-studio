// Zwaar beeldwerk als losse taken met alleen serialiseerbare invoer (paden en getallen).
// Deze taken draaien in een worker thread, zodat de server blijft reageren, of inline in tests.
// Ze kennen geen database en geen opslaglaag: de aanroeper geeft paden mee en verwerkt de uitvoer.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { designToSurfaceMatrix, orientQuad, type DesignTransform, type ImageFrame, type Quad } from '../../../shared/geometry';
import { scaleMesh, type CylinderParams, type Mesh } from '../../../shared/warp';
import { DEFAULT_BLEND, DEFAULT_TRANSFORM, type BlendSettings, type SurfaceKind } from '../../../shared/types';
import { compositeOnto, designScaleOnScene, panelColor, placementSurface, suppressSpill, type SpillTarget } from './composite';
import { detectChromaSurfaces, fitCylinderMesh, quadMask, shadingMap } from './detect';
import sharp from 'sharp';
import { grayToPng, loadGray, loadRGBA, openImage, rgbaToSharp } from './io';
import { parseHexColor, type Gray, type RGBA } from './raster';
import { renderScreen, renderStatusScreen, type ScreenSource } from './screen';
import type { StatusBarKind } from '../../../shared/device3d/spec';
import { screenCanvasSize, type ScreenLayout } from '../../../shared/mail';
import { makeFlatBackdrop } from './backdrop';
import type { Backdrop } from '../../../shared/scene-style';

// ---------------------------------------------------------------------------------------------
// Renderen

export interface DesignSource {
  /** Pad naar het bestand dat gerasterd wordt (bij PDF het raster, anders het origineel). */
  path: string;
  /** Sleutel voor de cache; verandert als het bestand verandert. */
  cacheKey: string;
  mime: string;
  width: number;
  height: number;
}

export interface PlacementSpec {
  quad: Quad;
  mesh: Mesh | null;
  cylinder: CylinderParams | null;
  design: DesignSource | null;
  transform: DesignTransform;
  background: string;
  blend: BlendSettings;
  maskPath: string | null;
  shadingPath: string | null;
  /** Bekende echte verhouding van het vlak (3D-model); anders geschat uit de hoeken. */
  aspect?: number | null;
  /** Mailscherm: de mailweergave met de handtekening (en profielfoto); vervangt design. */
  screen?: { layout: ScreenLayout; sources: Record<string, ScreenSource> } | null;
  /** Straal voor strooilichtcorrectie rond het vlak; bij een 3D-device alleen de overgangsrand. */
  spillRadius?: number | null;
  /**
   * Status- of menubalk (3D-device): quad en aspect zijn dan die van het hele scherm; het ontwerp komt in het vlak
   * onder de balk (deel 'fraction' van de schermhoogte is balk).
   */
  statusBar?: { kind: StatusBarKind; fraction: number; time: string; date: string; tone: 'auto' | 'light' | 'dark' } | null;
}

export interface RenderSpec {
  scenePath: string;
  sceneWidth: number;
  sceneHeight: number;
  /** Doelbreedte; nooit groter dan de scène. */
  width: number;
  supersample?: number;
  placements: PlacementSpec[];
  output: RenderOutput;
}

export interface RenderOutput {
  format: 'png' | 'jpg' | 'webp' | 'tiff';
  quality: number;
  /** Bijsnijden naar een verhouding rond een middelpunt (0..1 in de scène), en eventueel exact schalen. */
  crop?: { aspect: number; focus: [number, number] } | null;
  size?: { width: number; height: number } | null;
  /** Alleen bij TIFF: omzetten naar CMYK met dit profiel ('cmyk' = standaardprofiel van libvips, of een pad naar een ICC-bestand). */
  cmykProfile?: string | null;
  dpi?: number;
  /** Tekst in de EXIF-beschrijving (herkomst van het ontwerp). Alleen ASCII. */
  description?: string | null;
}

export interface EncodedImage { buffer: Uint8Array; width: number; height: number }

const designCache = new Map<string, RGBA>();
let designCacheBytes = 0;
const DESIGN_CACHE_LIMIT = 384 * 1024 * 1024;

function cachePut(key: string, img: RGBA) {
  designCache.set(key, img);
  designCacheBytes += img.data.byteLength;
  while (designCacheBytes > DESIGN_CACHE_LIMIT && designCache.size > 1) {
    const [k, v] = designCache.entries().next().value!;
    designCache.delete(k);
    designCacheBytes -= v.data.byteLength;
  }
}

/** Laadt het ontwerp op de resolutie die de scène nodig heeft. SVG's worden op die maat opnieuw gerenderd. */
async function loadDesign(src: DesignSource, targetWidth: number): Promise<RGBA> {
  const isSvg = src.mime === 'image/svg+xml';
  const width = Math.max(16, Math.round(isSvg ? Math.min(8000, targetWidth) : Math.min(src.width, targetWidth)));
  const bucket = Math.ceil(width / 256) * 256;
  const key = `${src.cacheKey}:${bucket}`;
  const hit = designCache.get(key);
  if (hit) {
    // Opnieuw achteraan zetten: minst recent gebruikt gaat er het eerst uit.
    designCache.delete(key);
    designCache.set(key, hit);
    return hit;
  }
  let img: RGBA;
  if (isSvg) {
    const density = Math.min(2400, Math.max(72, (72 * bucket) / Math.max(1, src.width)));
    const buf = await openImage(src.path, { density }).resize({ width: Math.min(bucket, 8000) }).png().toBuffer();
    img = await loadRGBA(buf);
  } else {
    const w = Math.min(src.width, bucket);
    img = await loadRGBA(src.path, w < src.width ? { width: w, height: Math.round((src.height * w) / src.width) } : undefined);
  }
  cachePut(key, img);
  return img;
}

const scaleQuad = (q: Quad, f: number): Quad => q.map(([x, y]) => [x * f, y * f]) as Quad;

async function screenDesign(screen: NonNullable<PlacementSpec['screen']>, quad: Quad, mesh: Mesh | null, cylinder: CylinderParams | null, image: ImageFrame): Promise<RGBA> {
  const { surface } = placementSurface(quad, mesh, cylinder, image);
  const c = screenCanvasSize(surface, screen.layout.template === 'mail-desktop', surface.width * 2.2);
  return renderScreen(screen.layout, screen.sources, c.width, c.height);
}

/**
 * Scherm met status- of menubalk als één ontwerp: op ruim twee keer de geprojecteerde maat van het scherm, het
 * ontwerp (of mailscherm) in het vlak onder de balk met de gekozen passing, de balk erboven.
 */
async function statusScreen(p: PlacementSpec, quad: Quad, size: { width: number; height: number }, t: DesignTransform): Promise<RGBA> {
  const sb = p.statusBar!;
  const { surface } = placementSurface(quad, null, null, { ...size, aspect: p.aspect });
  const W = Math.round(Math.min(5200, Math.max(64, surface.width * 2.2)));
  const H = Math.round(W / (p.aspect || surface.width / surface.height));
  const areaH = H - Math.round(H * sb.fraction);
  let inner: RGBA | null = null, dims = { width: 1, height: 1 }, transform = t;
  if (p.screen) {
    // Mailscherm in de verhouding van het vlak onder de balk.
    inner = await renderScreen(p.screen.layout, p.screen.sources, W, areaH);
    dims = { width: inner.width, height: inner.height };
    transform = { ...DEFAULT_TRANSFORM, fit: 'fill' };
  } else if (p.design) {
    dims = { width: p.design.width, height: p.design.height };
    const m = designToSurfaceMatrix(dims, { width: W, height: areaH }, t);
    inner = await loadDesign(p.design, p.design.width * Math.hypot(m[0], m[3]));
  }
  const bg = backgroundFor(p.background, null);
  return renderStatusScreen({ width: W, height: H, fraction: sb.fraction, kind: sb.kind, bar: sb, inner, innerDims: dims, transform, fallback: Array.isArray(bg) ? bg : [0, 0, 0] });
}

/** Vulling binnen het vlak. Op een chroma-vlak bestaat 'geen vulling' niet: dan zou het groen zichtbaar blijven. */
function backgroundFor(bg: string, mask: Gray | null): [number, number, number] | null | 'auto' {
  if (bg === 'transparent' || bg === 'auto') return mask ? 'auto' : null;
  return parseHexColor(bg);
}

/** Gemiddelde kleur van wat er op het vlak komt (ontwerp over de vulling); kleurt het strooilicht eromheen. */
function tintOf(design: RGBA | null, background: [number, number, number] | null | 'auto', fallback: [number, number, number]): [number, number, number] {
  const bg = Array.isArray(background) ? background : fallback;
  if (!design) return bg;
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((design.width * design.height) / 4096)));
  for (let y = 0; y < design.height; y += step)
    for (let x = 0; x < design.width; x += step) {
      const i = (y * design.width + x) * 4, a = design.data[i + 3]! / 255;
      r += design.data[i]! * a + bg[0] * (1 - a); g += design.data[i + 1]! * a + bg[1] * (1 - a); b += design.data[i + 2]! * a + bg[2] * (1 - a); n++;
    }
  return n ? [r / n, g / n, b / n] : bg;
}

/** Paneelkleur van een chroma-vlak, vóór het plaatsen gemeten; nodig om strooilicht te herkennen. */
function spillTarget(scene: RGBA, mask: Gray | null, quad: Quad, radius: number | null = null): Omit<SpillTarget, 'tint'> | null {
  if (!mask) return null;
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const panel = panelColor(scene, mask, Math.max(0, Math.floor(Math.min(...xs))), Math.max(0, Math.floor(Math.min(...ys))), Math.min(scene.width - 1, Math.ceil(Math.max(...xs))), Math.min(scene.height - 1, Math.ceil(Math.max(...ys))));
  return panel ? { mask, panel, quad, radius } : null;
}

export async function renderRaw(spec: RenderSpec, opts: { spill?: boolean } = {}): Promise<RGBA> {
  const targetW = Math.max(1, Math.min(spec.sceneWidth, Math.round(spec.width)));
  const f = targetW / spec.sceneWidth;
  const targetH = Math.max(1, Math.round(spec.sceneHeight * f));
  const base = await loadRGBA(spec.scenePath, f < 1 ? { width: targetW, height: targetH } : undefined, 'mitchell');
  const size = { width: base.width, height: base.height };
  const spill: SpillTarget[] = [];
  for (const p of spec.placements) {
    const quad = scaleQuad(p.quad, f);
    const mesh = p.mesh ? scaleMesh(p.mesh, f) : null;
    let design: RGBA | null = null;
    let transform = p.transform;
    if (p.statusBar && (p.screen || p.design)) {
      design = await statusScreen(p, quad, size, p.transform);
      transform = { ...DEFAULT_TRANSFORM, fit: 'fill' };
    } else if (p.screen) {
      // Mailscherm in de verhouding van het vlak, op ruim twee keer de geprojecteerde maat.
      design = await screenDesign(p.screen, quad, mesh, p.cylinder, { ...size, aspect: p.aspect });
      transform = { ...DEFAULT_TRANSFORM, fit: 'fill' };
    } else if (p.design) {
      const s = designScaleOnScene({ width: p.design.width, height: p.design.height }, quad, p.transform, { ...size, aspect: p.aspect }, mesh, p.cylinder);
      // Twee keer de geprojecteerde maat geeft de bilineaire bemonstering genoeg detail zonder aliasing.
      design = await loadDesign(p.design, p.design.width * s * 2);
    }
    const mask = p.maskPath ? await loadGray(p.maskPath, size) : null;
    const shading = p.shadingPath ? await loadGray(p.shadingPath, size) : null;
    const background = backgroundFor(p.background, mask);
    const target = spillTarget(base, mask, quad, p.spillRadius == null ? null : Math.max(2, p.spillRadius * f));
    compositeOnto(base, {
      quad,
      mesh,
      cylinder: p.cylinder,
      design,
      transform,
      background,
      blend: { ...p.blend, displacement: p.blend.displacement * f },
      mask,
      shading,
      supersample: spec.supersample ?? (f < 0.6 ? 2 : 3),
      aspect: p.aspect,
    });
    if (target) spill.push({ ...target, tint: tintOf(design, background, [128, 128, 128]) });
  }
  // Groen strooilicht rond de vlakken pas na alle vlakken: dan zijn alle panelen al vervangen.
  if (opts.spill !== false) suppressSpill(base, spill);
  return base;
}

/** Uitsnede met de gevraagde verhouding, zo groot mogelijk, met het middelpunt zo dicht mogelijk bij de focus. */
export function cropBox(w: number, h: number, aspect: number, focus: [number, number]) {
  let cw = w, ch = Math.round(w / aspect);
  if (ch > h) { ch = h; cw = Math.round(h * aspect); }
  const left = Math.round(Math.max(0, Math.min(w - cw, focus[0] * w - cw / 2)));
  const top = Math.round(Math.max(0, Math.min(h - ch, focus[1] * h - ch / 2)));
  return { left, top, width: Math.max(1, cw), height: Math.max(1, ch) };
}

export async function render(spec: RenderSpec): Promise<EncodedImage> {
  const img = await renderRaw(spec);
  const o = spec.output;
  let pipe = rgbaToSharp(img);
  let width = img.width, height = img.height;
  if (o.crop && o.crop.aspect > 0) {
    const box = cropBox(img.width, img.height, o.crop.aspect, o.crop.focus);
    pipe = sharp(await pipe.extract(box).png({ compressionLevel: 1 }).toBuffer());
    width = box.width; height = box.height;
  }
  if (o.size && (o.size.width !== width || (o.size.height && o.size.height !== height))) {
    const tw = o.size.width, th = o.size.height || Math.round((height * tw) / width);
    pipe = pipe.resize(tw, th, { fit: 'fill', kernel: 'lanczos3' });
    width = tw; height = th;
  }
  if (o.description) pipe = pipe.withExif({ IFD0: { ImageDescription: o.description.replace(/[^\x20-\x7e]/g, ''), Software: 'Mockup Studio' } });
  let buffer: Buffer;
  if (o.format === 'webp') buffer = await pipe.webp({ quality: o.quality }).toBuffer();
  else if (o.format === 'jpg') buffer = await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: o.quality, mozjpeg: true, chromaSubsampling: o.quality >= 90 ? '4:4:4' : '4:2:0' }).toBuffer();
  else if (o.format === 'tiff') {
    const dpmm = (o.dpi ?? 300) / 25.4;
    let t = pipe.flatten({ background: '#ffffff' });
    if (o.cmykProfile) t = t.toColourspace('cmyk').withIccProfile(o.cmykProfile);
    buffer = await t.tiff({ compression: 'lzw', xres: dpmm, yres: dpmm, resolutionUnit: 'inch' }).toBuffer();
  } else buffer = await pipe.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
  // Kopie met een eigen ArrayBuffer: sharp-buffers zijn niet over te dragen tussen threads.
  return { buffer: new Uint8Array(buffer), width, height };
}

// ---------------------------------------------------------------------------------------------
// Scène analyseren: normaliseren, vlakken vinden, masker, schaduwkaart en miniatuur maken

export interface AnalyzeSpec {
  inputPath: string;
  /** Werkmap waarin de uitvoer komt; de aanroeper verplaatst de bestanden naar de opslag. */
  outDir: string;
  surfaceKind: SurfaceKind;
  surfaceOrientation?: 'portrait' | 'landscape';
  multiDevice: boolean;
  detect: boolean;
  maxEdge: number;
  /** Ronde objecten: na de detectie een raster passen dat de ronding volgt. */
  cylinder?: CylinderParams;
  /** Printvlak binnen een object: de miniatuur vult het vlak naadloos op. */
  seamless?: boolean;
}

export interface AnalyzedSurface {
  id: string;
  quad: Quad;
  maskFile: string;
  shadingFile: string;
  fillColor: string | null;
  coverage: number;
  fill: number;
  mesh: Mesh | null;
  cylinder: CylinderParams | null;
}

export interface AnalyzeResult {
  width: number;
  height: number;
  sceneFile: string;
  thumbFile: string;
  surfaces: AnalyzedSurface[];
}

/** Mediane kleur net buiten het vlak: de kleur van het object waarop het vlak ligt. */
export function surroundColor(img: RGBA, mask: Gray, quad: Quad): string | null {
  const cx = quad.reduce((a, p) => a + p[0], 0) / 4, cy = quad.reduce((a, p) => a + p[1], 0) / 4;
  const size = Math.hypot(quad[2][0] - quad[0][0], quad[2][1] - quad[0][1]);
  const d = Math.max(3, size * 0.025);
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let e = 0; e < 4; e++) {
    const a = quad[e]!, b = quad[(e + 1) % 4]!;
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      const len = Math.hypot(px - cx, py - cy) || 1;
      const x = Math.round(px + ((px - cx) / len) * d), y = Math.round(py + ((py - cy) / len) * d);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height || mask.data[y * img.width + x]! > 0) continue;
      const i = (y * img.width + x) * 4;
      rs.push(img.data[i]!); gs.push(img.data[i + 1]!); bs.push(img.data[i + 2]!);
    }
  }
  if (rs.length < 8) return null;
  const med = (v: number[]) => v.sort((x, y) => x - y)[Math.floor(v.length / 2)]!;
  return '#' + [med(rs), med(gs), med(bs)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const shortId = () => randomUUID().replace(/-/g, '').slice(0, 20);

export async function analyzeScene(spec: AnalyzeSpec): Promise<AnalyzeResult> {
  await mkdir(spec.outDir, { recursive: true });
  const meta = await openImage(spec.inputPath).metadata();
  if (!meta.width || !meta.height) throw Object.assign(new Error('Dit beeld kon niet worden gelezen.'), { status: 400, code: 'image_invalid' });
  const png = await openImage(spec.inputPath)
    .resize({ width: spec.maxEdge, height: spec.maxEdge, fit: 'inside', withoutEnlargement: true, kernel: 'mitchell' })
    .toColourspace('srgb')
    .png({ compressionLevel: 6 })
    .toBuffer();
  const sceneFile = 'scene.png';
  const thumbFile = 'thumb.webp';
  await writeFile(path.join(spec.outDir, sceneFile), png);
  const img = await loadRGBA(png);

  const surfaces: AnalyzedSurface[] = [];
  const maps: { mask: Gray; shading: Gray }[] = [];
  if (spec.detect) {
    // Gebogen vlakken (mok, fles) niet opdelen: hun randen zijn geen rechte lijnen.
    const found = detectChromaSurfaces(img, { curved: !!spec.cylinder });
    const largest = found.reduce((m, s) => Math.max(m, s.coverage), 0);
    for (const s of found) {
      // Meerdere apparaten: het grootste scherm is de laptop (liggend), kleinere zijn telefoon of tablet (staand).
      const o = spec.surfaceOrientation ?? (spec.multiDevice && found.length > 1 ? (s.coverage === largest ? 'landscape' : 'portrait') : undefined);
      const quad = orientQuad(s.quad, o);
      const id = shortId();
      const shading = shadingMap(img, s.mask, 'green');
      const maskFile = `mask-${id}.png`;
      const shadingFile = `shading-${id}.png`;
      await writeFile(path.join(spec.outDir, maskFile), await grayToPng(s.mask));
      await writeFile(path.join(spec.outDir, shadingFile), await grayToPng(shading));
      maps.push({ mask: s.mask, shading });
      const mesh = spec.cylinder ? fitCylinderMesh(s.mask, quad, spec.cylinder.wrap) : null;
      // De hoeken van het raster zijn de echte hoeken van het gebogen vlak.
      const finalQuad: Quad = mesh ? [mesh.points[0]!, mesh.points[mesh.cols]!, mesh.points[mesh.points.length - 1]!, mesh.points[mesh.points.length - 1 - mesh.cols]!] : quad;
      surfaces.push({ id, quad: finalQuad, maskFile, shadingFile, fillColor: surroundColor(img, s.mask, quad), coverage: s.coverage, fill: spec.cylinder ? s.fill : s.quality, mesh, cylinder: spec.cylinder ?? null });
    }
  }

  // Miniatuur zonder fel groen: schermen uit, andere vlakken in de kleur van het object.
  // Rekenen op miniatuurformaat; dat is tientallen keren minder werk dan op volle resolutie.
  const tw = Math.min(720, img.width);
  const f = tw / img.width;
  const th = Math.max(1, Math.round(img.height * f));
  const plate = await loadRGBA(png, { width: tw, height: th }, 'mitchell');
  const spill: SpillTarget[] = [];
  for (const [i, sf] of surfaces.entries()) {
    const size = { width: tw, height: th };
    const mask = await loadGray(await grayToPng(maps[i]!.mask), size);
    const shading = await loadGray(await grayToPng(maps[i]!.shading), size);
    const quad = scaleQuad(sf.quad, f);
    const background = spec.surfaceKind === 'screen' ? parseHexColor('#1d1e21') : spec.seamless ? 'auto' as const : parseHexColor(sf.fillColor ?? '#e2e1dd');
    const target = spillTarget(plate, mask, quad);
    compositeOnto(plate, {
      quad, mesh: sf.mesh ? scaleMesh(sf.mesh, f) : null, cylinder: sf.cylinder, design: null, transform: DEFAULT_TRANSFORM, mask, shading,
      background,
      blend: { ...DEFAULT_BLEND[spec.surfaceKind], gloss: spec.surfaceKind === 'screen' ? 0.18 : 0, displacement: 0 },
      supersample: 2,
    });
    if (target) spill.push({ ...target, tint: Array.isArray(background) ? background : parseHexColor(sf.fillColor ?? '#e2e1dd') });
  }
  suppressSpill(plate, spill);
  await writeFile(path.join(spec.outDir, thumbFile), await rgbaToSharp(plate).webp({ quality: 82 }).toBuffer());
  return { width: img.width, height: img.height, sceneFile, thumbFile, surfaces };
}

// ---------------------------------------------------------------------------------------------
// Schaduwkaart voor een handmatig aangewezen vlak

export interface ManualShadingSpec { scenePath: string; quad: Quad; outPath: string }

export async function manualShading(spec: ManualShadingSpec): Promise<{ ok: true }> {
  const img = await loadRGBA(spec.scenePath);
  const region = quadMask(img.width, img.height, spec.quad);
  await mkdir(path.dirname(spec.outPath), { recursive: true });
  await writeFile(spec.outPath, await grayToPng(shadingMap(img, region, 'luma')));
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Scrollvideo: een lange websitescreenshot scrolt in het scherm van een apparaat

export interface ScrollSpec {
  render: RenderSpec;
  /** Index van de plaatsing die scrolt; de andere staan stil. */
  animate: number;
  outDir: string;
  fps: number;
  /** Totale duur in seconden, inclusief stilstand boven en onder. */
  duration: number;
  hold: number;
  /** Deel van de frames (voor verdeling over workers): [van, tot). */
  from: number;
  to: number;
}

/** Zachte versnelling en vertraging. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Hoe ver het ontwerp kan scrollen, als fractie van de hoogte van het vlak (0 = past al). */
export function scrollRange(design: { width: number; height: number }, surface: { width: number; height: number }, scale: number) {
  const dh = design.height * (surface.width / design.width) * scale;
  return Math.max(0, dh / surface.height - 1);
}

export async function renderScrollFrames(spec: ScrollSpec): Promise<{ frames: number; width: number; height: number }> {
  const target = spec.render.placements[spec.animate];
  if (!target?.design) throw new Error('Kies een plaatsing met een ontwerp om te laten scrollen.');
  // Even afmetingen: H.264 met 4:2:0 vraagt dat.
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const width = even(Math.min(spec.render.sceneWidth, spec.render.width));
  const f = width / spec.render.sceneWidth;
  const height = even(spec.render.sceneHeight * f);
  const base = await renderRaw({ ...spec.render, width, placements: spec.render.placements.filter((_, i) => i !== spec.animate) }, { spill: false });
  const others: SpillTarget[] = [];
  const size = { width: base.width, height: base.height };
  const quad = scaleQuad(target.quad, f);
  const mesh = target.mesh ? scaleMesh(target.mesh, f) : null;
  const { surface } = placementSurface(quad, mesh, target.cylinder, { ...size, aspect: target.aspect });
  const transform = { ...target.transform, fit: 'width' as const, anchor: 'top' as const, rotation: 0, offsetX: 0 };
  // Met een statusbalk scrolt het ontwerp in het vlak onder de balk; de balk staat stil.
  const sb = target.statusBar ?? null;
  const barCanvas = sb ? { width: Math.round(Math.min(3600, Math.max(64, surface.width * 1.6))), height: 0 } : null;
  if (barCanvas) barCanvas.height = Math.round(barCanvas.width / (target.aspect || surface.width / surface.height));
  const area = sb && barCanvas ? { width: barCanvas.width, height: barCanvas.height - Math.round(barCanvas.height * sb.fraction) } : surface;
  const range = scrollRange(target.design, area, transform.scale);
  const s = designScaleOnScene({ width: target.design.width, height: target.design.height }, quad, transform, { ...size, aspect: target.aspect }, mesh, target.cylinder);
  const design = await loadDesign(target.design, sb && barCanvas ? target.design.width * (barCanvas.width / target.design.width) * transform.scale : target.design.width * s * 1.6);
  const ownFallback = (() => { const b = backgroundFor(target.background, null); return Array.isArray(b) ? b : [0, 0, 0] as [number, number, number]; })();
  // De balk houdt de kleur van de bovenkant van de pagina, ook als die wegscrolt (zoals een browser op een telefoon).
  const barTop = sb && barCanvas
    ? renderStatusScreen({ width: 64, height: Math.max(8, Math.round(64 * barCanvas.height / barCanvas.width)), fraction: sb.fraction, kind: sb.kind, bar: sb, inner: design, innerDims: { width: target.design.width, height: target.design.height }, transform, fallback: ownFallback }).barTop
    : null;
  const mask = target.maskPath ? await loadGray(target.maskPath, size) : null;
  const shading = target.shadingPath ? await loadGray(target.shadingPath, size) : null;
  // Strooilicht: de andere vlakken staan al in de basis; hun paneelkleur komt uit de oorspronkelijke scène.
  const plain = await loadRGBA(spec.render.scenePath, { width: base.width, height: base.height }, 'mitchell');
  for (const [i, p] of spec.render.placements.entries()) {
    if (i === spec.animate || !p.maskPath) continue;
    const m = await loadGray(p.maskPath, size);
    const t = spillTarget(plain, m, scaleQuad(p.quad, f), p.spillRadius == null ? null : Math.max(2, p.spillRadius * f));
    if (t) others.push({ ...t, tint: Array.isArray(backgroundFor(p.background, m)) ? backgroundFor(p.background, m) as [number, number, number] : [128, 128, 128] });
  }
  const own = spillTarget(base, mask, quad, target.spillRadius == null ? null : Math.max(2, target.spillRadius * f));
  const ownBg = backgroundFor(target.background, mask);
  const ownTint = tintOf(design, ownBg, [128, 128, 128]);
  const total = Math.round(spec.duration * spec.fps);
  await mkdir(spec.outDir, { recursive: true });
  for (let i = spec.from; i < Math.min(spec.to, total); i++) {
    const t = i / spec.fps;
    const p = Math.min(1, Math.max(0, (t - spec.hold) / Math.max(0.001, spec.duration - 2 * spec.hold)));
    const frame = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
    const scrolled = { ...transform, offsetY: -ease(p) * range };
    const screen = sb && barCanvas
      ? renderStatusScreen({ width: barCanvas.width, height: barCanvas.height, fraction: sb.fraction, kind: sb.kind, bar: sb, inner: design, innerDims: { width: target.design.width, height: target.design.height }, transform: scrolled, fallback: ownFallback, barTop })
      : null;
    compositeOnto(frame, {
      quad, mesh, cylinder: target.cylinder, design: screen ?? design, transform: screen ? { ...DEFAULT_TRANSFORM, fit: 'fill' } : scrolled,
      background: ownBg,
      blend: { ...target.blend, displacement: target.blend.displacement * f }, mask, shading, supersample: 2, aspect: target.aspect,
    });
    suppressSpill(frame, own ? [...others, { ...own, tint: ownTint }] : others);
    await rgbaToSharp(frame).extract({ left: 0, top: 0, width, height: Math.min(height, frame.height) }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toFile(path.join(spec.outDir, `frame-${String(i).padStart(5, '0')}.jpg`));
  }
  return { frames: total, width, height };
}

// ---------------------------------------------------------------------------------------------
// Platte achtergrond: de achtergrond van een gegenereerd beeld exact op kleur of verloop zetten

export interface FlatBackdropSpec { inputPath: string; outPath: string; backdrop: Backdrop; seed: number }

export async function flatBackdrop(spec: FlatBackdropSpec): Promise<{ coverage: number }> {
  const { image, coverage } = await makeFlatBackdrop(spec.inputPath, spec.backdrop, spec.seed);
  await mkdir(path.dirname(spec.outPath), { recursive: true });
  // Zonder verlies, zodat de exacte kleur niet door compressie verschuift.
  await rgbaToSharp(image).png({ compressionLevel: 6 }).toFile(spec.outPath);
  return { coverage };
}

export const TASKS = { render, analyzeScene, manualShading, renderScrollFrames, flatBackdrop } as const;
export type TaskName = keyof typeof TASKS;
