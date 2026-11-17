// Live weergave van een mailscherm in de editor: dezelfde tekencode als de server (shared/mail), op een
// browsercanvas met de previews van de ontwerpen. De exacte render komt daarna van de server.
import { drawMail, resolveSignatureWidth, type ScreenCtx, type ScreenLayout } from '~~/shared/mail';

const FONT = '"Schibsted Grotesk Variable", ui-sans-serif, system-ui, sans-serif';
const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string) {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

let fontsReady: Promise<unknown> | null = null;
function ensureFonts() {
  // Het lettertype wordt pas geladen als iets het gebruikt; zonder wachten tekent het canvas eerst een systeemletter.
  fontsReady ??= Promise.all([400, 500, 600, 700].map((w) => document.fonts?.load(`${w} 16px "Schibsted Grotesk Variable"`).catch(() => null)));
  return fontsReady;
}

export interface PreviewAsset { previewUrl: string; width: number; height: number }

/** Tekent het scherm en geeft een object-URL terug (of null als het tekenen niet lukt). */
export async function renderScreenPreview(input: ScreenLayout, width: number, height: number, assetOf: (assetId: string) => PreviewAsset | null): Promise<string | null> {
  await ensureFonts();
  // De breedte van de handtekening volgt uit het originele bestand, niet uit de (kleinere) preview.
  const layout = resolveSignatureWidth(input, (id) => assetOf(id));
  const ids = [...layout.slots.map((s) => s.assetId), layout.avatar?.assetId ?? null].filter((x): x is string => !!x);
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    const a = assetOf(id);
    const img = a ? await loadImage(a.previewUrl) : null;
    if (img) loaded.set(id, img);
  }));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawMail(ctx as unknown as ScreenCtx, layout, canvas.width, canvas.height, (id) => loaded.get(id) ?? null, FONT);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
  return blob ? URL.createObjectURL(blob) : null;
}
