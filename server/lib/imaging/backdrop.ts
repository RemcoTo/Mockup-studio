// Platte achtergrond exact maken. Het beeldmodel zet het object voor een egaal magenta sleutelscherm (net zoals
// het ontwerpvlak groen is). De studio herkent dat magenta, haalt het weg en zet de gekozen kleur, het verloop en
// eventueel een textuur ervoor in de plaats. De schaduw op het scherm gaat mee als lichtfactor. Het object zelf
// (ook een wit of grijs product voor een lichte achtergrond) en het groene ontwerpvlak worden niet aangeraakt;
// alleen een magenta zweem vlak langs de rand van het object wordt geneutraliseerd.
import { greenness, parseHex, type RGB } from '../../../shared/color';
import { keyness } from '../../../shared/scene-style';
import type { Backdrop } from '../../../shared/scene-style';
import { loadRGBA } from './io';
import type { RGBA } from './raster';


export interface BackdropResult {
  image: RGBA;
  /** Aandeel van het beeld dat als achtergrond is herkend. */
  coverage: number;
}

/** Doelkleur op positie (u, v) in 0..1. */
export function backdropColorAt(b: Backdrop, u: number, v: number, aspect: number): RGB {
  const a = parseHex(b.color) ?? [255, 255, 255];
  if (b.mode !== 'gradient') return a;
  // Twee of meer kleuren, gelijk verdeeld over het verloop.
  const stops = (b.stops && b.stops.length >= 2 ? b.stops : b.color2 ? [b.color, b.color2] : []).map((h) => parseHex(h) ?? a);
  if (stops.length < 2) return a;
  let t: number;
  switch (b.direction ?? 'vertical') {
    case 'horizontal': t = u; break;
    case 'diagonal': t = (u + v) / 2; break;
    case 'radial': {
      // Cirkel in beeldverhouding: gelijke afstand is gelijke kleur, ook in een breed beeld.
      const dx = (u - 0.5) * aspect, dy = v - 0.5;
      t = Math.min(1, Math.hypot(dx, dy) / Math.hypot(0.5 * aspect, 0.5));
      break;
    }
    default: t = v;
  }
  const f = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i, p = stops[i]!, q = stops[i + 1]!;
  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
}

/**
 * Mate van "sleutelmagenta", 0..1: rood en blauw allebei ver boven groen. Werkt ook in de schaduw
 * (donker magenta blijft magenta); een wit, grijs, zwart of gekleurd object scoort (vrijwel) 0.
 */
export { keyness } from '../../../shared/scene-style';

/** Box-blur in drie rondes (benadert een Gauss), genormaliseerd met gewichten. */
function blurWeighted(val: Float32Array, wt: Float32Array, W: number, H: number, r: number): Float32Array {
  let v: Float32Array = new Float32Array(val.length), w: Float32Array = new Float32Array(wt.length);
  for (let i = 0; i < val.length; i++) { v[i] = val[i]! * wt[i]!; w[i] = wt[i]!; }
  for (let pass = 0; pass < 3; pass++) { v = box(v, W, H, r); w = box(w, W, H, r); }
  const out = new Float32Array(val.length);
  for (let i = 0; i < out.length; i++) out[i] = w[i]! > 1e-4 ? v[i]! / w[i]! : NaN;
  return out;
}
function box(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))]!;
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(W - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]!;
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x]! - tmp[Math.max(0, y - r) * W + x]!;
    }
  }
  return out;
}

/** Verkleind veld bilineair uitlezen. */
function sampleField(f: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = Math.min(w - 1, Math.max(0, x)), fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = f[y0 * w + x0]!, b = f[y0 * w + x1]!, c = f[y1 * w + x0]!, d = f[y1 * w + x1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Deterministische ruis in -1..1 (zelfde zaad = zelfde korrel). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
/** Vermenigvuldigingsfactor voor textuur, rond 1. */
function textureAt(kind: Backdrop['texture'], x: number, y: number, long: number, seed: number): number {
  if (!kind || kind === 'none') return 1;
  const grain = hash(x, y, seed) * 0.5 + hash(x + 7, y + 3, seed) * 0.5;
  if (kind === 'grain') return 1 + grain * 0.022;
  // Papier: zachte vlekken op meerdere schalen en een fijnere vezel.
  const s = 1600 / long;
  const mottle = valueNoise(x * s / 90, y * s / 90, seed) * 0.6 + valueNoise(x * s / 30, y * s / 30, seed + 1) * 0.3 + valueNoise(x * s / 9, y * s / 9, seed + 2) * 0.1;
  return 1 + mottle * 0.03 + grain * 0.01;
}

/** Drempels voor het sleutelscherm: daaronder object, daarboven volledig achtergrond, ertussen de rand. */
const K_LOW = 0.22, K_HIGH = 0.7;

export async function makeFlatBackdrop(input: string | Buffer, b: Backdrop, seed = 1): Promise<BackdropResult> {
  const img = await loadRGBA(input);
  const { width: W, height: H, data: src } = img;
  const N = W * H;
  const key = new Float32Array(N);
  for (let p = 0; p < N; p++) key[p] = keyness(src[p * 4]!, src[p * 4 + 1]!, src[p * 4 + 2]!);

  // Achtergrond = alles met sleutelkleur dat vanaf de rand bereikbaar is, plus grotere ingesloten stukken
  // zuiver magenta (het gat in een mokoor). Een magenta weerspiegeling ín het object hoort daar niet bij.
  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let tail = 0;
  const push = (p: number) => { if (!bg[p] && key[p]! >= K_LOW) { bg[p] = 1; queue[tail++] = p; } };
  const grow = (start: number) => {
    let head = start;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % W;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (p >= W) push(p - W);
      if (p < N - W) push(p + W);
    }
  };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  grow(0);
  const minHole = Math.max(30, Math.round(N * 0.0004));
  const seen = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (bg[p] || seen[p] || key[p]! < K_HIGH) continue;
    const comp = [p];
    seen[p] = 1;
    for (let c = 0; c < comp.length; c++) {
      const q0 = comp[c]!, x = q0 % W;
      for (const q of [x > 0 ? q0 - 1 : -1, x < W - 1 ? q0 + 1 : -1, q0 - W, q0 + W]) {
        if (q < 0 || q >= N || seen[q] || bg[q] || key[q]! < K_HIGH) continue;
        seen[q] = 1;
        comp.push(q);
      }
    }
    if (comp.length < minHole) continue;
    const start = tail;
    for (const c of comp) { bg[c] = 1; queue[tail++] = c; }
    grow(start);
  }

  let covered = 0;
  for (let p = 0; p < N; p++) covered += bg[p]!;
  if (covered < N * 0.05) throw new Error('beeld kon niet: geen sleutelachtergrond gevonden');

  // Belichting op het scherm, op een verkleinde kopie: helderheid van het magenta ten opzichte van de gladde
  // basis eromheen. Zo blijft de schaduw van het object en verdwijnt de lichtval van het model (een lichtere
  // hoek), zodat de achtergrond overal precies de gekozen kleur heeft.
  const k = Math.min(1, 512 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const lv = new Float32Array(w * h), lw = new Float32Array(w * h);
  const cr = new Float32Array(w * h), cg = new Float32Array(w * h), cb = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) / k)));
      const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) / k)));
      let n = 0, sv = 0, sr = 0, sg = 0, sb = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const p = yy * W + xx;
          if (!bg[p] || key[p]! < K_HIGH) continue;
          const r = src[p * 4]!, g = src[p * 4 + 1]!, bl = src[p * 4 + 2]!;
          n++; sv += Math.max(r, bl); sr += r; sg += g; sb += bl;
        }
      if (!n) continue;
      const i = y * w + x;
      lv[i] = sv / n; cr[i] = sr / n; cg[i] = sg / n; cb[i] = sb / n; lw[i] = n;
    }
  const big = Math.max(4, Math.round(Math.max(w, h) / 9));
  const base = blurWeighted(lv, lw, w, h, big);
  const near = blurWeighted(lv, lw, w, h, 2);
  // De werkelijke (beschaduwde) sleutelkleur dicht bij elke pixel, om randpixels te ontmengen.
  const kr = blurWeighted(cr, lw, w, h, 2), kg = blurWeighted(cg, lw, w, h, 2), kb = blurWeighted(cb, lw, w, h, 2);
  const shadowOn = (b.shadow ?? 'soft') !== 'none';
  const lightAt = (sx: number, sy: number, own: number | null) => {
    if (!shadowOn) return 1;
    const bs = sampleField(base, w, h, sx, sy);
    const v = own ?? sampleField(near, w, h, sx, sy);
    if (!(bs > 1) || Number.isNaN(v)) return 1;
    let f = Math.min(1, v / bs);
    // Kleine lichtverschillen zijn geen schaduw; daaronder loopt het vloeiend over in de echte schaduw.
    if (f >= 0.94) f = 1;
    else if (f > 0.86) f = 0.86 + ((f - 0.86) / 0.08) * 0.14;
    return Math.max(0.15, f);
  };

  const out: RGBA = { width: W, height: H, data: new Uint8ClampedArray(src) };
  const d = out.data;
  const long = Math.max(W, H);
  const reach = Math.max(2, Math.round(long * 0.006));
  // Waarover het verloop loopt: het hele beeld, of (in een scène) alleen het deel dat achtergrond is.
  let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
  if (b.extent === 'region') {
    x0 = W; y0 = H; x1 = 0; y1 = 0;
    for (let p = 0; p < N; p++) {
      if (!bg[p]) continue;
      const x = p % W, y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const spanX = Math.max(1, x1 - x0), spanY = Math.max(1, y1 - y0), aspect = (spanX + 1) / (spanY + 1);
  // Midden in de achtergrond (geen object binnen bereik) is elke pixel achtergrond, ook waar het model het magenta
  // lichter of minder verzadigd maakte. Alleen langs het object wordt gemengd, zodat de rand zacht blijft.
  const nearObj = box(Float32Array.from(bg, (v) => 1 - v), W, H, reach);
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) * k - 0.5;
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!bg[p]) continue;
      const i = p * 4;
      const kv = nearObj[p]! <= 1e-6 ? 1 : key[p]!;
      const sx = (x + 0.5) * k - 0.5;
      const t = backdropColorAt(b, Math.min(1, Math.max(0, (x - x0) / spanX)), Math.min(1, Math.max(0, (y - y0) / spanY)), aspect);
      const tex = textureAt(b.texture, x, y, long, seed);
      if (kv >= K_HIGH) {
        const f = key[p]! >= K_HIGH ? lightAt(sx, sy, Math.max(src[i]!, src[i + 2]!)) : lightAt(sx, sy, null);
        d[i] = t[0] * f * tex; d[i + 1] = t[1] * f * tex; d[i + 2] = t[2] * f * tex;
        continue;
      }
      // Rand: mengsel van object en (beschaduwd) magenta. Alleen het magentadeel vervangen door de nieuwe kleur.
      const a = (kv - K_LOW) / (K_HIGH - K_LOW);
      const f = lightAt(sx, sy, null);
      let r0 = sampleField(kr, w, h, sx, sy), g0 = sampleField(kg, w, h, sx, sy), b0 = sampleField(kb, w, h, sx, sy);
      if (Number.isNaN(r0)) { r0 = 255; g0 = 0; b0 = 255; }
      d[i] = src[i]! + a * (t[0] * f * tex - r0);
      d[i + 1] = src[i + 1]! + a * (t[1] * f * tex - g0);
      d[i + 2] = src[i + 2]! + a * (t[2] * f * tex - b0);
    }
  }

  // Magenta zweem op de rand van het object (licht dat van het scherm terugkaatst) neutraliseren: alleen vlak
  // langs de achtergrond en alleen waar rood én blauw boven groen uitkomen. Het groene ontwerpvlak blijft buiten schot.
  const nearBg = box(Float32Array.from(bg), W, H, reach);
  for (let p = 0; p < N; p++) {
    if (bg[p] || nearBg[p]! <= 0) continue;
    const i = p * 4;
    const r = d[i]!, g = d[i + 1]!, bl = d[i + 2]!;
    if (greenness(r, g, bl) > 0.05) continue;
    const excess = Math.min(r, bl) - g;
    if (excess <= 2 || keyness(r, g, bl) <= 0) continue;
    d[i] = r - excess * 0.85;
    d[i + 2] = bl - excess * 0.85;
  }
  return { image: out, coverage: covered / N };
}
