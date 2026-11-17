// In- en uitlezen van beelden met sharp. De rekenkern werkt op ruwe buffers (raster.ts).
import sharp, { type SharpOptions } from 'sharp';
import type { Gray, RGBA } from './raster';

/** Bescherming tegen decompressiebommen: maximaal ~120 megapixel per invoerbestand. */
export const MAX_INPUT_PIXELS = 120_000_000;
sharp.cache({ memory: 256, files: 0, items: 64 });

export function openImage(input: string | Buffer, opts: SharpOptions = {}) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', ...opts }).rotate();
}

/**
 * Laadt een beeld als RGBA. Ontwerpen worden met Lanczos verkleind (scherpst). Scènes met 'mitchell':
 * Lanczos schiet naast een hard contrast (fel groen tegen een zwart kader) door en laat dan paarse
 * pixels achter in de verkleinde scène, die in de editor als zoom rond het vlak zichtbaar werden.
 */
export async function loadRGBA(input: string | Buffer, resize?: { width: number; height: number }, kernel: 'lanczos3' | 'mitchell' = 'lanczos3'): Promise<RGBA> {
  let img = openImage(input).ensureAlpha().toColourspace('srgb');
  if (resize) img = img.resize(Math.max(1, Math.round(resize.width)), Math.max(1, Math.round(resize.height)), { fit: 'fill', kernel });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

export async function loadGray(input: string | Buffer, resize?: { width: number; height: number }): Promise<Gray> {
  let img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
  // Maskers en schaduwkaarten: zonder doorschieten, anders krijgt een rand buiten het vlak een kleine maskerwaarde.
  if (resize) img = img.resize(Math.round(resize.width), Math.round(resize.height), { fit: 'fill', kernel: 'mitchell' });
  const { data, info } = await img.greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

export function rgbaToSharp(img: RGBA) {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
}

export function grayToPng(img: Gray): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 1 },
  }).png({ compressionLevel: 9 }).toBuffer();
}

export async function encode(img: RGBA, format: 'png' | 'jpg', quality = 92): Promise<Buffer> {
  const s = rgbaToSharp(img);
  if (format === 'jpg') return s.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' }).toBuffer();
  return s.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
}

/** WebP kan geen zijde boven 16383 px opslaan; een volledige webpagina is vaak veel langer. */
export const WEBP_MAX_EDGE = 16383;

export async function thumbnail(input: string | Buffer, width = 640): Promise<Buffer> {
  // Breedte begrenzen én hoogte: een lange screenshot (volledige pagina) wordt dan smaller in plaats van te hoog.
  return openImage(input).resize({ width, height: WEBP_MAX_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}
