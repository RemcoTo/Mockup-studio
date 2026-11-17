// Synthetische testscènes die nabootsen wat een beeldmodel aflevert: groene vlakken in perspectief, randen
// met anti-aliasing, voorwerpen ervoor, licht dat verloopt, reflecties en groen strooilicht op de omgeving.
// Lagen worden van achter naar voren getekend, met 3x3 supersampling voor zachte randen.
import { applyH, homography, rectQuad, type Quad } from '../../shared/geometry';
import { createRGBA, type RGBA } from '../../server/lib/imaging/raster';

export type RGB = [number, number, number];

export interface Layer {
  /** Vierhoek (dan krijgt color ook u,v op het vlak) of een vrije vorm. */
  quad?: Quad;
  inside?: (x: number, y: number) => boolean;
  color: (u: number, v: number, x: number, y: number) => RGB;
}

export const CHROMA: RGB = [24, 222, 52];

export function paint(W: number, H: number, background: (x: number, y: number) => RGB, layers: Layer[], opts: { ss?: number; noise?: number; seed?: number } = {}): RGBA {
  const ss = opts.ss ?? 3;
  const img = createRGBA(W, H);
  const inv = layers.map((l) => (l.quad ? homography(l.quad, rectQuad(1, 1)) : null));
  let seed = opts.seed ?? 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
          let c = background(px, py);
          for (let li = 0; li < layers.length; li++) {
            const l = layers[li]!;
            if (l.quad) {
              const [u, v] = applyH(inv[li]!, px, py);
              if (u >= 0 && u <= 1 && v >= 0 && v <= 1) c = l.color(u, v, px, py);
            } else if (l.inside!(px, py)) c = l.color(0, 0, px, py);
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      const n = ss * ss, i = (y * W + x) * 4, z = opts.noise ?? 0;
      img.data[i] = r / n + rnd() * z; img.data[i + 1] = g / n + rnd() * z; img.data[i + 2] = b / n + rnd() * z; img.data[i + 3] = 255;
    }
  return img;
}

export const flat = (c: RGB) => () => c;
/** Groen met lichtverloop: f = helderheidsfactor over het vlak. */
export const lit = (c: RGB, f: (u: number, v: number) => number) => (u: number, v: number): RGB => {
  const k = f(u, v);
  return [c[0] * k, c[1] * k, c[2] * k];
};
export const desk = (x: number, y: number): RGB => [150 - y * 0.03, 142 - y * 0.03, 132 - y * 0.03];

/** Rechthoek met een kader eromheen (zoals een telefoon): kader is iets groter dan het scherm. */
export function grow(q: Quad, px: number): Quad {
  const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
  return q.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * px, y + ((y - cy) / d) * px];
  }) as Quad;
}

/** Gemiddelde afwijking per hoek tussen twee vierhoeken (in pixels). */
export function cornerError(a: Quad, b: Quad): number {
  return Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1])));
}

/** Zoekt bij een verwachte vierhoek het best passende gevonden vlak. */
export function bestMatch<T extends { quad: Quad }>(found: T[], expected: Quad): { item: T | null; error: number } {
  let item: T | null = null, error = Infinity;
  for (const f of found) {
    const e = cornerError(f.quad, expected);
    if (e < error) { error = e; item = f; }
  }
  return { item, error };
}
