// Mailscherm opbouwen op de server: de handtekening wordt geladen (SVG scherp op de benodigde maat), de
// mailweergave tekent interface en handtekening op een canvas, en het resultaat gaat als één ontwerp door
// de gewone plaatsingsketen (perspectief, licht, reflecties, export).
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { drawMail, resolveSignatureWidth, type ScreenCtx, type ScreenLayout } from '../../../shared/mail';
import { openImage } from './io';
import { barStyle, drawStatusBar, screenLayout, topColor } from '../../../shared/statusbar';
import type { StatusBarKind, StatusBarSpec } from '../../../shared/device3d/spec';
import type { DesignTransform } from '../../../shared/geometry';
import type { RGBA } from './raster';

export interface ScreenSource { path: string; mime: string; width: number; height: number; cacheKey: string }

export const SCREEN_FONT = 'StudioSans';
let fontReady = false;

/** Het lettertype van de studio (Schibsted Grotesk) registreren; zonder dat valt het terug op een systeemletter. */
function ensureFont() {
  if (fontReady) return;
  fontReady = true;
  const candidates: string[] = [];
  // Productie: de build zet de lettertypen naast de worker (.output/server/fonts).
  try { candidates.push(fileURLToPath(new URL('../fonts/', import.meta.url))); } catch { /* geen bestands-URL */ }
  try {
    const req = createRequire(import.meta.url);
    candidates.push(path.join(path.dirname(req.resolve('@fontsource-variable/schibsted-grotesk/package.json')), 'files'));
  } catch { /* pakket niet vindbaar vanuit de bundel */ }
  candidates.push(path.resolve(process.cwd(), 'node_modules/@fontsource-variable/schibsted-grotesk/files'));
  candidates.push(path.resolve(process.cwd(), 'server/node_modules/@fontsource-variable/schibsted-grotesk/files'));
  for (const dir of candidates) {
    for (const f of ['schibsted-grotesk-latin-wght-normal.woff2', 'schibsted-grotesk-latin-ext-wght-normal.woff2']) {
      const p = path.join(dir, f);
      if (existsSync(p)) GlobalFonts.registerFromPath(p, SCREEN_FONT);
    }
  }
}

const imageCache = new Map<string, Image>();

/** Laadt een ontwerp voor een vak: SVG wordt op de vakmaat gerenderd, andere bestanden zo nodig verkleind. */
async function loadSlotImage(src: ScreenSource, maxEdge: number): Promise<Image> {
  const isSvg = src.mime === 'image/svg+xml';
  const edge = Math.max(64, Math.min(4096, Math.ceil(maxEdge / 128) * 128));
  const key = `${src.cacheKey}:${edge}`;
  const hit = imageCache.get(key);
  if (hit) return hit;
  let pipe = isSvg
    ? openImage(src.path, { density: Math.min(2400, Math.max(72, (72 * edge) / Math.max(1, Math.max(src.width, src.height)))) })
    : openImage(src.path);
  // Niet groter laden dan het vak nodig heeft (twee keer voor scherpe bemonstering); nooit vergroten.
  pipe = pipe.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: !isSvg });
  const img = await loadImage(await pipe.ensureAlpha().png({ compressionLevel: 1 }).toBuffer());
  if (imageCache.size > 64) imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(key, img);
  return img;
}

/**
 * Vakken van de mailweergave met echte tekstmaten (zelfde lettertype als de render): waar de handtekening
 * en profielfoto precies komen. Afmetingen van de ontwerpen komen uit dims (de originele bestanden).
 */
export function screenSlots(input: ScreenLayout, dims: (assetId: string) => { width: number; height: number } | null, width: number, height: number) {
  ensureFont();
  const layout = resolveSignatureWidth(input, dims);
  const canvas = createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext('2d');
  // Alleen meten: beelden worden niet getekend.
  (ctx as unknown as { drawImage: () => void }).drawImage = () => {};
  return drawMail(ctx as unknown as ScreenCtx, layout, width, height, dims, SCREEN_FONT);
}

export async function renderScreen(input: ScreenLayout, sources: Record<string, ScreenSource>, width: number, height: number): Promise<RGBA> {
  ensureFont();
  // De breedte van de handtekening volgt uit het originele bestand, niet uit een verkleind geladen beeld.
  const layout = resolveSignatureWidth(input, (id) => sources[id] ?? null);
  // Eerst de vakken bepalen (met de afmetingen van de bestanden) voor de benodigde laadmaat.
  const dims = (id: string) => (sources[id] ? { width: sources[id]!.width, height: sources[id]!.height } : null);
  const slots = screenSlots(layout, dims, width, height);
  const need = new Map<string, number>();
  slots.forEach((s) => {
    const id = s.kind === 'avatar' ? layout.avatar?.assetId : layout.slots[s.index]?.assetId;
    if (id && sources[id]) need.set(id, Math.max(need.get(id) ?? 0, Math.max(s.w, s.h) * 2));
  });
  const images = new Map<string, Image>();
  for (const [id, edge] of need) images.set(id, await loadSlotImage(sources[id]!, edge));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // Afmetingen blijven die van het bestand (een verkleind geladen beeld heeft dezelfde verhouding).
  drawMail(ctx as unknown as ScreenCtx, layout, width, height, (id) => images.get(id) ?? null, SCREEN_FONT);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Scherm met status- of menubalk: de balk bovenaan, het ontwerp (of een opgebouwd scherm) eronder met dezelfde
 * passing als zonder balk, maar binnen het vlak onder de balk. Het resultaat gaat als één ontwerp met 'vullen' over
 * het hele scherm, zodat perspectief, masker, licht en reflecties voor balk en ontwerp gelijk zijn.
 * Delen van het vlak zonder ontwerp blijven doorzichtig: daar geldt de gewone vulling van de plaatsing.
 */
export function renderStatusScreen(o: {
  width: number; height: number; fraction: number; kind: StatusBarKind; bar: Pick<StatusBarSpec, 'time' | 'date' | 'tone'>;
  /** Ontwerppixels (mogelijk verkleind geladen) met de maat van het originele bestand, en de passing. */
  inner: RGBA | null; innerDims: { width: number; height: number }; transform: DesignTransform;
  /** Kleur als er bovenaan het vlak niets van het ontwerp staat. */
  fallback: [number, number, number];
  /** Vaste kleur van de balk (scrollvideo: de kleur van de bovenkant van de pagina, ook als die wegscrolt). */
  barTop?: [number, number, number] | null;
}): RGBA & { barTop: [number, number, number] } {
  ensureFont();
  const W = Math.max(2, Math.round(o.width)), H = Math.max(2, Math.round(o.height));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const { barH, matrix } = screenLayout({ width: W, height: H }, o.fraction, o.innerDims, o.transform);
  if (o.inner) {
    const src = createCanvas(o.inner.width, o.inner.height);
    const sctx = src.getContext('2d');
    const img = sctx.createImageData(o.inner.width, o.inner.height);
    img.data.set(o.inner.data);
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, barH, W, H - barH); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(matrix[0], matrix[3], matrix[1], matrix[4], matrix[2], matrix[5]);
    ctx.drawImage(src, 0, 0, o.inner.width, o.inner.height, 0, 0, o.innerDims.width, o.innerDims.height);
    ctx.restore();
  }
  // Kleur van de balk uit wat er direct onder staat (de bovenrand van het ontwerp in het vlak).
  const probe = ctx.getImageData(0, barH, W, Math.max(1, Math.min(H - barH, Math.round(H * 0.006) + 1))).data;
  const top = o.barTop ?? topColor(probe, W, Math.max(1, Math.min(H - barH, Math.round(H * 0.006) + 1))) ?? o.fallback;
  drawStatusBar(ctx as unknown as ScreenCtx, 0, 0, W, barH, o.kind, o.bar, barStyle(top, o.kind, o.bar.tone), SCREEN_FONT);
  const data = ctx.getImageData(0, 0, W, H).data;
  return { width: W, height: H, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), barTop: top };
}
