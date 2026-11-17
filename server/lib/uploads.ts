// Uploads valideren en opslaan. Het originele bestand blijft altijd ongewijzigd bewaard;
// alleen previews en rasters voor PDF worden afgeleid.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Asset } from '../../shared/types';
import { getConfig } from './config';
import { AppError, badRequest } from './errors';
import { newId, now } from './ids';
import { openImage, thumbnail } from './imaging/io';
import { assets, mockups } from './repositories';
import { storage } from './storage';
import { dirOf, keys } from './keys';

export type SupportedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'application/pdf';

const EXT: Record<SupportedMime, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
};

/** Bepaalt het bestandstype op basis van de inhoud, niet op basis van de naam of de browser. */
export function sniffType(buf: Buffer): SupportedMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) && /<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * SVG's kunnen scripts, externe verwijzingen en XML-entiteiten bevatten. In plaats van te proberen
 * dat weg te poetsen, weigeren we zulke bestanden met een duidelijke uitleg. Een normaal export-SVG
 * uit Figma of Illustrator bevat dit niet.
 */
export function checkSvg(text: string): void {
  const rules: [RegExp, string][] = [
    [/<!DOCTYPE|<!ENTITY/i, 'Deze SVG bevat een DOCTYPE of entiteiten. Exporteer het bestand opnieuw zonder DOCTYPE.'],
    [/<script[\s>]/i, 'Deze SVG bevat een script. Scripts zijn om veiligheidsredenen niet toegestaan.'],
    [/<foreignObject[\s>]/i, 'Deze SVG bevat ingesloten HTML (foreignObject). Zet tekst om naar contouren of exporteer zonder HTML.'],
    [/\son[a-z]+\s*=/i, 'Deze SVG bevat event-attributen (zoals onload). Die zijn niet toegestaan.'],
    [/(?:href|src)\s*=\s*["']\s*(?:https?:|file:|ftp:|\/\/|javascript:)/i, 'Deze SVG verwijst naar externe bestanden. Sluit afbeeldingen en lettertypen in of zet tekst om naar contouren.'],
    [/url\(\s*["']?\s*(?:https?:|file:|\/\/)/i, 'Deze SVG laadt externe stijlen of lettertypen. Sluit ze in of zet tekst om naar contouren.'],
    [/@import/i, 'Deze SVG importeert externe stijlen. Die zijn niet toegestaan.'],
  ];
  for (const [re, msg] of rules) if (re.test(text)) throw badRequest(msg, 'svg_unsafe');
}

const require = createRequire(import.meta.url);
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function loadPdfjs() {
  // Statische specifier, zodat de build het pakket (en @napi-rs/canvas) meeneemt in .output.
  // pdf.js laadt @napi-rs/canvas zelf; deze import zorgt dat de build het native pakket meeneemt.
  await import('@napi-rs/canvas');
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/**
 * Rendert PDF-pagina's naar PNG zonder scripts (pdf.js voert geen PDF-JavaScript uit), zonder XFA-formulieren
 * en zonder systeemlettertypen of externe bronnen.
 */
export async function renderPdfPages(buf: Buffer, opts: { maxPages: number; targetWidth: number }): Promise<{ png: Buffer; width: number; height: number; page: number; pages: number }[]> {
  const lib = await loadPdfjs();
  const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const task = lib.getDocument({
    data: new Uint8Array(buf),
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: fontDir,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const out = [];
    const pages = Math.min(doc.numPages, opts.maxPages);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(8, Math.max(1, opts.targetWidth / base.width));
      const vp = page.getViewport({ scale });
      // Bescherming tegen extreme paginaformaten.
      if (vp.width * vp.height > 60_000_000) throw badRequest(`Pagina ${n} van de PDF is te groot om te verwerken.`);
      const { canvas, context } = (doc.canvasFactory as { create(w: number, h: number): { canvas: unknown; context: unknown } }).create(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvas, canvasContext: context, viewport: vp, annotationMode: 0 } as never).promise;
      const png = (canvas as unknown as { toBuffer(t: string): Buffer }).toBuffer('image/png');
      out.push({ png, width: Math.ceil(vp.width), height: Math.ceil(vp.height), page: n, pages: doc.numPages });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export interface UploadInput {
  projectId: string;
  workspaceId: string;
  kind: Asset['kind'];
  filename: string;
  buffer: Buffer;
  source?: Asset['source'];
  meta?: Record<string, unknown>;
}

const safeName = (n: string) => path.basename(n).replace(/[^\p{L}\p{N}._ -]+/gu, '').slice(0, 120) || 'bestand';

export async function ingestUpload(input: UploadInput): Promise<Asset[]> {
  const { buffer } = input;
  const max = getConfig().uploadMaxMb * 1024 * 1024;
  if (!buffer.length) throw badRequest('Het bestand is leeg.');
  if (buffer.length > max) throw new AppError(413, `Het bestand is groter dan ${getConfig().uploadMaxMb} MB.`, 'too_large');
  const mime = sniffType(buffer);
  if (!mime) throw new AppError(415, 'Dit bestandstype wordt niet ondersteund. Gebruik PNG, JPG, WebP, SVG of PDF.', 'unsupported_type');
  if (mime === 'application/pdf' && input.kind === 'reference') throw badRequest('Gebruik voor referentiebeelden een PNG, JPG of WebP.');
  const name = safeName(input.filename);
  // Vingerafdruk van het origineel: staat later in elke export, zodat herkomst aantoonbaar is.
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  if (mime === 'application/pdf') {
    const pages = await renderPdfPages(buffer, { maxPages: 12, targetWidth: 3200 }).catch((e) => {
      if (e instanceof AppError) throw e;
      console.warn('[pdf]', (e as Error).message);
      throw badRequest('Deze PDF kon niet worden gelezen. Mogelijk is het bestand beschadigd of beveiligd met een wachtwoord.', 'pdf_invalid');
    });
    const originalKey = `${keys.original(input.workspaceId, input.projectId)}/${newId()}.pdf`;
    await storage.put(originalKey, buffer);
    const out: Asset[] = [];
    for (const p of pages) {
      const id = newId();
      const raster = `${keys.asset(input.workspaceId, id)}/page-${p.page}.png`;
      const preview = `${keys.asset(input.workspaceId, id)}/preview.webp`;
      await storage.put(raster, p.png);
      await storage.put(preview, await thumbnail(p.png, 1600));
      out.push(assets.insert({
        id, projectId: input.projectId, kind: input.kind, source: input.source ?? 'upload',
        originalName: p.pages > 1 ? `${name} (pagina ${p.page})` : name, mime, file: originalKey, preview,
        width: p.width, height: p.height, meta: { ...input.meta, raster, page: p.page, pages: p.pages, sha256 }, createdAt: now(),
      }));
    }
    return out;
  }

  if (mime === 'image/svg+xml') checkSvg(buffer.toString('utf8'));
  let meta;
  try {
    meta = await openImage(buffer).metadata();
  } catch {
    throw badRequest('Dit beeld kon niet worden gelezen. Mogelijk is het bestand beschadigd.', 'image_invalid');
  }
  if (!meta.width || !meta.height) throw badRequest('Dit beeld heeft geen leesbare afmetingen.');
  // Houd rekening met EXIF-rotatie van foto's.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  const id = newId();
  const file = `${keys.asset(input.workspaceId, id)}/original.${EXT[mime]}`;
  const preview = `${keys.asset(input.workspaceId, id)}/preview.webp`;
  await storage.put(file, buffer);
  const previewSource = mime === 'image/svg+xml' ? await openImage(buffer, { density: Math.min(600, Math.max(72, (72 * 1600) / width)) }).png().toBuffer() : buffer;
  await storage.put(preview, await thumbnail(previewSource, 1600));
  return [assets.insert({
    id, projectId: input.projectId, kind: input.kind, source: input.source ?? 'upload', originalName: name, mime, file, preview,
    width, height, meta: { ...input.meta, hasAlpha: !!meta.hasAlpha, bytes: buffer.length, sha256 }, createdAt: now(),
  })];
}

export async function deleteAsset(asset: Asset) {
  assets.remove(asset.id);
  // Verwijzingen in mockups leegmaken (ook de handtekening en profielfoto van een mailscherm), zodat ze opslaanbaar blijven.
  const clear = (id: string | null | undefined) => (id === asset.id ? null : id ?? null);
  for (const m of mockups.usingAsset(asset.id)) {
    mockups.update(m.id, {
      placements: m.placements.map((p) => ({
        ...p, assetId: clear(p.assetId),
        layout: p.layout ? { ...p.layout, slots: p.layout.slots.map((s) => ({ assetId: clear(s.assetId) })), avatar: p.layout.avatar && clear(p.layout.avatar.assetId) ? { assetId: p.layout.avatar.assetId } : null } : p.layout,
      })),
    });
  }
  await storage.remove(dirOf(asset.preview));
  if (asset.mime === 'application/pdf' && !assets.list({ projectId: asset.projectId }).some((a) => a.file === asset.file)) {
    await storage.remove(asset.file);
  }
}
