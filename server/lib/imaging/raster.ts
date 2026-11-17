// Ruwe pixelbuffers zonder afhankelijkheden, zodat de beeldverwerking puur en testbaar blijft.

export interface RGBA {
  width: number;
  height: number;
  /** RGBA, 8 bit per kanaal, rij voor rij. */
  data: Uint8ClampedArray;
}

export interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRGBA(width: number, height: number): RGBA {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function createGray(width: number, height: number, fill = 0): Gray {
  const data = new Uint8ClampedArray(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

/** Bilineaire bemonstering in een RGBA-buffer; coördinaten in pixelruimte (0,0 = linksboven van de eerste pixel). */
export function sampleBilinear(img: RGBA, x: number, y: number, out: Float64Array): boolean {
  const fx = x - 0.5;
  const fy = y - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > img.width - 0.5 || fy > img.height - 0.5) return false;
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const d = img.data;
  const i00 = (y0 * img.width + x0) * 4;
  const i10 = (y0 * img.width + x1) * 4;
  const i01 = (y1 * img.width + x0) * 4;
  const i11 = (y1 * img.width + x1) * 4;
  // Bemonster met voorvermenigvuldigde alfa, zodat transparante randen geen donkere zoom geven.
  const a00 = d[i00 + 3]! / 255, a10 = d[i10 + 3]! / 255, a01 = d[i01 + 3]! / 255, a11 = d[i11 + 3]! / 255;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
  out[3] = a;
  for (let c = 0; c < 3; c++) {
    out[c] = d[i00 + c]! * a00 * w00 + d[i10 + c]! * a10 * w10 + d[i01 + c]! * a01 * w01 + d[i11 + c]! * a11 * w11;
  }
  return true;
}

export function sampleGray(img: Gray, x: number, y: number): number {
  const fx = Math.max(0, Math.min(img.width - 1, x - 0.5));
  const fy = Math.max(0, Math.min(img.height - 1, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const d = img.data, w = img.width;
  return (
    d[y0 * w + x0]! * (1 - tx) * (1 - ty) +
    d[y0 * w + x1]! * tx * (1 - ty) +
    d[y1 * w + x0]! * (1 - tx) * ty +
    d[y1 * w + x1]! * tx * ty
  );
}

export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
