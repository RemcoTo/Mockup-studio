import { ASPECTS, RESOLUTIONS } from './catalog';

/**
 * Bepaalt de uitvoermaat voor gpt-image-2: zijden in veelvouden van 16, langste zijde maximaal 3840 px
 * en maximaal 8.294.400 pixels. Andere providers kunnen deze functie vervangen via hun eigen beschrijving.
 */
export function outputSize(aspectId: string, resolution: string): { width: number; height: number } {
  const ratio = ASPECTS.find((a) => a.id === aspectId)?.ratio ?? 3 / 2;
  const longEdge = RESOLUTIONS.find((r) => r.id === resolution)?.longEdge ?? 1536;
  const round16 = (v: number) => Math.max(16, Math.round(v / 16) * 16);
  let w = ratio >= 1 ? longEdge : longEdge * ratio;
  let h = ratio >= 1 ? longEdge / ratio : longEdge;
  const maxPixels = 8_294_400;
  if (w * h > maxPixels) {
    const f = Math.sqrt(maxPixels / (w * h));
    w *= f;
    h *= f;
  }
  let width = round16(Math.min(3840, w));
  let height = round16(Math.min(3840, h));
  while (width * height > maxPixels) {
    if (width >= height) width -= 16;
    else height -= 16;
  }
  return { width, height };
}
