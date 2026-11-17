// Vindt de egaal groene vlakken die het beeldmodel als doeloppervlak heeft gerenderd.
// Levert per vlak: vier hoeken, een zacht masker (voor voorwerpen die ervoor staan) en een schaduwkaart.

import { orderQuad, polygonArea, type Point, type Quad, isConvexQuad } from '../../../shared/geometry';
import { createGray, type Gray, type RGBA } from './raster';
import { distanceMap, fitQuads, quadCoverage, type Candidate, type Region } from './quadfit';

export interface DetectedSurface {
  quad: Quad;
  /** Aandeel van het beeld dat het vlak beslaat. */
  coverage: number;
  /** Hoe goed het masker de vierhoek vult (1 = volledig zichtbaar, lager = deels afgedekt of geen rechthoek). */
  fill: number;
  /** Aandeel van de rand dat op een zijde van de vierhoek ligt (1 = nette vierhoek, laag = vrije vorm zoals een plant). */
  edgeFit: number;
  /** Samengevatte betrouwbaarheid, 0..1: het laagste van vulling en randpassing. */
  quality: number;
  mask: Gray;
  /** Diepte binnen een groep overlappende vlakken: 0 = voorste. */
  depth: number;
}

export interface DetectOptions {
  /** Minimaal aandeel van het beeld voor een vlak, standaard 0,4%. */
  minCoverage?: number;
  maxSurfaces?: number;
  /** Gebogen oppervlak (mok, fles): niet opdelen in meerdere vlakken. */
  curved?: boolean;
}

// De maat voor chroma-groen staat in shared/color, zodat de interface dezelfde controle kan doen.
import { greenness } from '../../../shared/color';
export { greenness };

export function greenMap(img: RGBA): Gray {
  const out = createGray(img.width, img.height);
  const d = img.data;
  for (let i = 0, p = 0; p < out.data.length; i += 4, p++) {
    out.data[p] = Math.round(greenness(d[i]!, d[i + 1]!, d[i + 2]!) * 255);
  }
  return out;
}

function erode(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = bin[i]! & bin[i - 1]! & bin[i + 1]! & bin[i - w]! & bin[i + w]!;
    }
  return out;
}

function dilate(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = bin[i]! | (x > 0 ? bin[i - 1]! : 0) | (x < w - 1 ? bin[i + 1]! : 0) | (y > 0 ? bin[i - w]! : 0) | (y < h - 1 ? bin[i + w]! : 0);
    }
  return out;
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Vereenvoudigt een convexe omhullende tot vier punten door telkens het punt met de kleinste driehoek te verwijderen. */
function reduceToQuad(hull: Point[]): Point[] {
  const pts = [...hull];
  const tri = (a: Point, b: Point, c: Point) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > 4) {
    let best = 0, bestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = tri(pts[(i - 1 + pts.length) % pts.length]!, pts[i]!, pts[(i + 1) % pts.length]!);
      if (a < bestArea) { bestArea = a; best = i; }
    }
    pts.splice(best, 1);
  }
  return pts;
}

interface Line { nx: number; ny: number; c: number } // nx*x + ny*y = c

/**
 * Schat de vierhoek uit de vier langste rechte zijden van de omhullende.
 * Werkt ook als een hoek is afgedekt: de afgesneden hoek levert een korte zijde op,
 * terwijl de verlengde lange zijden elkaar op de werkelijke hoek snijden.
 */
function quadFromLongestSides(hull: Point[]): Point[] | null {
  const n = hull.length;
  if (n < 4) return null;
  type Side = { pts: Point[]; len: number; angle: number; start: number };
  const sides: Side[] = [];
  for (let i = 0; i < n; i++) {
    const a = hull[i]!, b = hull[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const last = sides[sides.length - 1];
    if (last && Math.abs(angleDiff(last.angle, angle)) < 0.09) {
      last.pts.push(b);
      last.len += len;
      const f = last.pts[0]!;
      last.angle = Math.atan2(b[1] - f[1], b[0] - f[0]);
      continue;
    }
    sides.push({ pts: [a, b], len, angle, start: i });
  }
  // De eerste en laatste groep kunnen één zijde zijn die over het beginpunt loopt.
  if (sides.length > 1 && Math.abs(angleDiff(sides[0]!.angle, sides[sides.length - 1]!.angle)) < 0.09) {
    const last = sides.pop()!;
    sides[0] = { pts: [...last.pts, ...sides[0]!.pts], len: last.len + sides[0]!.len, angle: sides[0]!.angle, start: last.start };
  }
  if (sides.length < 4) return null;
  const top = [...sides].sort((a, b) => b.len - a.len).slice(0, 4);
  const ordered = sides.filter((s) => top.includes(s));
  const lines = ordered.map((s) => fitLine(s.pts.length >= 8 ? s.pts : densify(s.pts)));
  if (lines.some((l) => !l)) return null;
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4]!, lines[i]!);
    if (!p) return null;
    corners.push(p);
  }
  return corners;
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function densify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    for (let t = 0; t < 1; t += 0.125) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function fitLine(points: Point[]): Line | null {
  if (points.length < 8) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p[0]; my += p[1]; }
  mx /= points.length; my /= points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Richting met de grootste spreiding; de normaal staat daar loodrecht op.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  return { nx, ny, c: nx * mx + ny * my };
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return [(a.c * b.ny - a.ny * b.c) / det, (a.nx * b.c - a.c * b.nx) / det];
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Verfijnt de hoeken: elke zijde krijgt een lijn door de randpixels die er dichtbij liggen,
 * en de hoeken worden de snijpunten. Zo kloppen hoeken ook bij afgeronde of deels afgedekte vlakken.
 */
function refineQuad(initial: Quad, edge: Point[], tolerance: number): Quad {
  const groups: Point[][] = [[], [], [], []];
  for (const p of edge) {
    let best = -1, bestD = tolerance;
    for (let s = 0; s < 4; s++) {
      const d = distToSegment(p, initial[s]!, initial[(s + 1) % 4]!);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best >= 0) {
      // Laat de punten vlak bij de hoeken weg; daar buigen afgeronde hoeken af.
      const a = initial[best]!, b = initial[(best + 1) % 4]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len || 1);
      if (t > 0.08 && t < 0.92) groups[best]!.push(p);
    }
  }
  const lines = groups.map(fitLine);
  if (lines.some((l) => !l)) return initial;
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4]!, lines[i]!);
    if (!p) return initial;
    // Een snijpunt ver van de eerste schatting betekent een mislukte lijn; houd dan de schatting aan.
    const init = initial[i]!;
    if (Math.hypot(p[0] - init[0], p[1] - init[1]) > tolerance * 4) corners.push(init);
    else corners.push(p);
  }
  const q = corners as Quad;
  return isConvexQuad(q) ? q : initial;
}

/**
 * Vult gaten in een component die volledig binnen het vlak liggen en licht en onverzadigd zijn
 * (glimlicht, reflectie van een lamp). Gaten met een andere kleur zijn voorwerpen en blijven open.
 */
function fillGlareHoles(img: RGBA, labels: Int32Array, c: { id: number; minX: number; maxX: number; minY: number; maxY: number; pixels: number }, w: number, h: number) {
  const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
  if (bw < 3 || bh < 3) return;
  const outside = new Uint8Array(bw * h > 0 ? bw * bh : 0);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const li = (y - c.minY) * bw + (x - c.minX);
    if (outside[li] || labels[y * w + x] === c.id) return;
    outside[li] = 1;
    stack.push(x, y);
  };
  for (let x = c.minX; x <= c.maxX; x++) { push(x, c.minY); push(x, c.maxY); }
  for (let y = c.minY; y <= c.maxY; y++) { push(c.minX, y); push(c.maxX, y); }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (x > c.minX) push(x - 1, y);
    if (x < c.maxX) push(x + 1, y);
    if (y > c.minY) push(x, y - 1);
    if (y < c.maxY) push(x, y + 1);
  }
  // Wat niet van buitenaf bereikbaar is en niet bij de component hoort, is een gat. Per gat beoordelen.
  const seen = new Uint8Array(bw * bh);
  const d = img.data;
  for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) {
    const li = (y - c.minY) * bw + (x - c.minX);
    if (outside[li] || seen[li] || labels[y * w + x] === c.id) continue;
    const hole: number[] = [];
    const q = [x, y];
    seen[li] = 1;
    let bright = 0;
    while (q.length) {
      const yy = q.pop()!, xx = q.pop()!;
      const pi = yy * w + xx;
      hole.push(pi);
      const r = d[pi * 4]!, g = d[pi * 4 + 1]!, b = d[pi * 4 + 2]!;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 170 && (max - min) / (max || 1) < 0.3) bright++;
      for (const [nx, ny] of [[xx - 1, yy], [xx + 1, yy], [xx, yy - 1], [xx, yy + 1]] as const) {
        if (nx < c.minX || nx > c.maxX || ny < c.minY || ny > c.maxY) continue;
        const nli = (ny - c.minY) * bw + (nx - c.minX);
        if (outside[nli] || seen[nli] || labels[ny * w + nx] === c.id) continue;
        seen[nli] = 1;
        q.push(nx, ny);
      }
    }
    if (bright / hole.length > 0.7) for (const pi of hole) labels[pi] = c.id;
  }
}

interface Comp { id: number; pixels: number; minX: number; maxX: number; minY: number; maxY: number }

/** Randpunten per rij en kolom van alle pixels met een van de gegeven labels. */
function extremeEdge(labels: Int32Array, ids: Set<number>, c: Pick<Comp, 'minX' | 'maxX' | 'minY' | 'maxY'>, w: number): Point[] {
  const edge: Point[] = [];
  for (let y = c.minY; y <= c.maxY; y++) {
    let first = -1, last = -1;
    for (let x = c.minX; x <= c.maxX; x++) if (ids.has(labels[y * w + x]!)) { if (first < 0) first = x; last = x; }
    if (first >= 0) { edge.push([first, y + 0.5]); edge.push([last + 1, y + 0.5]); }
  }
  for (let x = c.minX; x <= c.maxX; x++) {
    let first = -1, last = -1;
    for (let y = c.minY; y <= c.maxY; y++) if (ids.has(labels[y * w + x]!)) { if (first < 0) first = y; last = y; }
    if (first >= 0) { edge.push([x + 0.5, first]); edge.push([x + 0.5, last + 1]); }
  }
  return edge;
}

/** Vierhoek via de convexe omhullende (de oorspronkelijke methode), met vulling en randpassing. */
function hullFit(edge: Point[], pixels: number, c: Pick<Comp, 'minX' | 'maxX' | 'minY' | 'maxY'>, w: number, h: number): { quad: Quad; fill: number; edgeFit: number; quality: number } | null {
  const hull = convexHull(edge);
  if (hull.length < 4) return null;
  const hullArea = polygonArea(hull);
  let initial: Quad | null = null;
  const fromSides = quadFromLongestSides(hull);
  if (fromSides) {
    const q = orderQuad(fromSides);
    const a = polygonArea(q);
    const inBounds = q.every((p) => p[0] > -0.2 * w && p[0] < 1.2 * w && p[1] > -0.2 * h && p[1] < 1.2 * h);
    if (isConvexQuad(q) && inBounds && a >= hullArea * 0.98 && a <= hullArea * 1.6) initial = q;
  }
  if (!initial) initial = orderQuad(reduceToQuad(hull));
  if (!isConvexQuad(initial)) return null;
  const diag = Math.hypot(c.maxX - c.minX, c.maxY - c.minY);
  const quad = refineQuad(initial, edge, Math.max(3, diag * 0.02));
  const area = polygonArea(quad);
  if (area <= 0) return null;
  const { edgeFit } = edgeFitOf(edge, quad, diag);
  const fill = Math.min(1, pixels / area);
  return { quad, fill, edgeFit, quality: Math.min(fill, edgeFit) };
}

function edgeFitOf(edge: Point[], quad: Quad, diag: number) {
  const tol = Math.max(2, diag * 0.015);
  const onEdge = edge.filter((p) => Math.min(...[0, 1, 2, 3].map((k) => distToSegment(p, quad[k]!, quad[(k + 1) % 4]!))) <= tol).length;
  return { edgeFit: edge.length ? onEdge / edge.length : 0 };
}

/** Helderheid, licht vervaagd (twee keer een 3x3-gemiddelde), voor naad- en randdetectie. */
function smoothLuma(img: RGBA): Float32Array {
  const { width: w, height: h, data: d } = img;
  let a = new Float32Array(w * h);
  for (let p = 0, i = 0; p < a.length; p++, i += 4) a[p] = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += a[yy * w + xx]!; n++;
          }
        }
        b[y * w + x] = s / n;
      }
    a = b;
  }
  return a;
}

/** Sterkte van een helderheidsovergang over vier pixels (vangt een volledige trede, ook na vervagen). */
function gradientMap(L: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      g[i] = Math.hypot(L[i + 2]! - L[i - 2]!, L[i + 2 * w]! - L[i - 2 * w]!);
    }
  return g;
}

/**
 * Lichte, onverzadigde stroken binnen het groen (een reflectie die schuin over een scherm loopt) knippen
 * een vlak in tweeën. Vul ze op als ze binnen de "sluiting" van het groen liggen: smaller dan 2r en niet
 * verbonden met een groot licht gebied erbuiten (zoals een witte achtergrond tussen twee apparaten).
 */
function bridgeGlare(img: RGBA, bin: Uint8Array, w: number, h: number): Uint8Array {
  const d = img.data;
  const filled = new Uint8Array(w * h);
  const r = Math.max(4, Math.hypot(w, h) * 0.03);
  const glare = new Uint8Array(w * h);
  let any = false;
  for (let p = 0, i = 0; p < glare.length; p++, i += 4) {
    if (bin[p]) continue;
    const max = Math.max(d[i]!, d[i + 1]!, d[i + 2]!), min = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
    if (max > 150 && (max - min) / max < 0.35) { glare[p] = 1; any = true; }
  }
  if (!any) return filled;
  const toGreen = distanceMap(bin, w, h);
  const outside = new Uint8Array(w * h);
  for (let p = 0; p < outside.length; p++) outside[p] = toGreen[p]! > r ? 1 : 0;
  const toOutside = distanceMap(outside, w, h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < glare.length; start++) {
    if (!glare[start] || seen[start]) continue;
    const members: number[] = [];
    let inside = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      if (toOutside[p]! > r) inside++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (glare[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
    }
    if (inside / members.length >= 0.85) for (const p of members) { bin[p] = 1; filled[p] = 1; }
  }
  return filled;
}

/** Labelt verbonden gebieden in bin (4- of 8-buren). */
function labelComponents(bin: Uint8Array, w: number, h: number, eight: boolean): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start] !== -1) continue;
    const id = comps.length;
    let sp = 0, count = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const i = stack[--sp]!;
      count++;
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!eight && dx && dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (bin[j] && labels[j] === -1) { labels[j] = id; stack[sp++] = j; }
        }
    }
    comps.push({ pixels: count, minX, maxX, minY, maxY, id });
  }
  return { labels, comps };
}

/**
 * Deelt het groen op in afzonderlijke vlakken.
 * 1. Naden: waar de helderheid binnen het groen sprongsgewijs verandert (een kader, een ribbe tussen twee
 *    zijden van een doos, een rand van een voorste apparaat) wordt het groen doorgeknipt.
 * 2. De naadpixels gaan terug naar het dichtstbijzijnde deel.
 * 3. Delen die samen één nette vierhoek vormen (een harde schaduw of een glimlicht knipte één vlak door)
 *    worden weer samengevoegd, behalve als ze gescheiden zijn door een donkere lijn (twee panelen naast elkaar).
 */
function segmentGreen(img: RGBA, bin: Uint8Array, w: number, h: number, minKeep: number, split: boolean): { labels: Int32Array; comps: Comp[]; grad: Float32Array } {
  const L = smoothLuma(img);
  const grad = gradientMap(L, w, h);
  if (!split) {
    const { labels, comps } = labelComponents(bin, w, h, true);
    return { labels, comps, grad };
  }
  const ls: number[] = [], gs: number[] = [];
  for (let p = 0; p < bin.length; p += 7) if (bin[p]) { ls.push(L[p]!); gs.push(grad[p]!); }
  if (!ls.length) return { labels: new Int32Array(w * h).fill(-1), comps: [], grad };
  ls.sort((a, b) => a - b); gs.sort((a, b) => a - b);
  const Lm = ls[ls.length >> 1]!, Gm = gs[gs.length >> 1]!;
  const T = Math.max(0.1 * Lm, 3 * Gm, 8);
  const seam = new Uint8Array(w * h);
  const core = new Uint8Array(w * h);
  for (let p = 0; p < bin.length; p++) {
    if (!bin[p]) continue;
    if (grad[p]! > T) seam[p] = 1; else core[p] = 1;
  }
  const { labels, comps: raw } = labelComponents(core, w, h, false);
  const keep = new Set(raw.filter((c) => c.pixels >= minKeep).map((c) => c.id));
  for (let p = 0; p < labels.length; p++) if (labels[p]! >= 0 && !keep.has(labels[p]!)) labels[p] = -1;

  // Terugwijzen: van de behouden delen uit over al het groen groeien; contacten tussen delen bijhouden.
  // Naadpixels alleen binnen een smalle overgangszone toewijzen: anders groeit een vlak via groen
  // strooilicht (de gloed van een scherm op het kader) over zijn eigen rand heen.
  const queue = new Int32Array(w * h);
  const depth = new Uint8Array(w * h);
  let qh = 0, qt = 0;
  for (let p = 0; p < labels.length; p++) if (labels[p]! >= 0) queue[qt++] = p;
  const contact = new Map<string, { n: number; lum: number }>();
  while (qh < qt) {
    const p = queue[qh++]!;
    const a = labels[p]!;
    const x = p % w, y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!bin[j]) continue;
        const b = labels[j]!;
        if (b === -1) {
          const dj = core[j] ? 0 : depth[p]! + 1;
          if (dj > 3) continue;
          labels[j] = a; depth[j] = dj; queue[qt++] = j;
        }
        else if (b !== a) {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          const e = contact.get(key) ?? { n: 0, lum: 0 };
          e.n++; e.lum += Math.min(L[p]!, L[j]!);
          contact.set(key, e);
        }
      }
  }

  // Samenvoegen waar de delen één vlak blijken.
  const parent = new Map<number, number>();
  const find = (a: number): number => { let r = a; while (parent.has(r)) r = parent.get(r)!; return r; };
  const members = new Map<number, Set<number>>();
  for (const id of keep) members.set(id, new Set([id]));
  const bbox = new Map<number, Comp>();
  const pixels = new Map<number, number>();
  for (const c of raw) if (keep.has(c.id)) { bbox.set(c.id, { ...c }); pixels.set(c.id, 0); }
  const medLum = new Map<number, number[]>();
  for (let p = 0; p < labels.length; p++) {
    const id = labels[p]!;
    if (id < 0) continue;
    pixels.set(id, pixels.get(id)! + 1);
    const b = bbox.get(id)!;
    const x = p % w, y = (p - x) / w;
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    if (core[p] && (p % 5 === 0)) { const arr = medLum.get(id) ?? []; arr.push(L[p]!); medLum.set(id, arr); }
  }
  const lumOf = (id: number) => { const a = (medLum.get(id) ?? [0]).sort((x, y) => x - y); return a[a.length >> 1]!; };
  const qualityCache = new Map<string, number>();
  const quality = (ids: Set<number>): number => {
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (qualityCache.has(key)) return qualityCache.get(key)!;
    let n = 0;
    const box = { minX: w, maxX: 0, minY: h, maxY: 0 };
    for (const id of ids) {
      const b = bbox.get(id)!;
      n += pixels.get(id)!;
      box.minX = Math.min(box.minX, b.minX); box.maxX = Math.max(box.maxX, b.maxX); box.minY = Math.min(box.minY, b.minY); box.maxY = Math.max(box.maxY, b.maxY);
    }
    const f = hullFit(extremeEdge(labels, ids, box, w), n, box, w, h);
    const q = f ? f.quality : 0;
    qualityCache.set(key, q);
    return q;
  };
  const pairs = [...contact.entries()].map(([k, v]) => { const [a, b] = k.split(':').map(Number) as [number, number]; return { a, b, ...v }; }).sort((p, q) => q.n - p.n);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pr of pairs) {
      const ra = find(pr.a), rb = find(pr.b);
      if (ra === rb) continue;
      const ma = members.get(ra)!, mb = members.get(rb)!;
      const union = new Set([...ma, ...mb]);
      const qa = quality(ma), qb = quality(mb), qu = quality(union);
      // Donkere lijn tussen de delen: een kader of naad, geen schaduw.
      const ridge = pr.lum / pr.n < 0.7 * Math.min(lumOf(pr.a), lumOf(pr.b));
      if (qu >= 0.9 && qu >= Math.min(qa, qb) - 0.01 && !(ridge && qa >= 0.88 && qb >= 0.88)) {
        parent.set(rb, ra);
        members.set(ra, union);
        members.delete(rb);
        changed = true;
      }
    }
  }
  const comps: Comp[] = [];
  const remap = new Map<number, number>();
  for (const [root, ids] of members) {
    const id = comps.length;
    let n = 0;
    const box = { minX: w, maxX: 0, minY: h, maxY: 0 };
    for (const m of ids) {
      remap.set(m, id);
      const b = bbox.get(m)!;
      n += pixels.get(m)!;
      box.minX = Math.min(box.minX, b.minX); box.maxX = Math.max(box.maxX, b.maxX); box.minY = Math.min(box.minY, b.minY); box.maxY = Math.max(box.maxY, b.maxY);
    }
    void root;
    comps.push({ id, pixels: n, ...box });
  }
  for (let p = 0; p < labels.length; p++) if (labels[p]! >= 0) labels[p] = remap.get(labels[p]!) ?? -1;
  return { labels, comps, grad };
}

/** Basismasker van een gebied: zachte groenwaarde, plus een overgangsrand die niet in een ander vlak ligt. */
/** Eigenaar van elke niet-toegewezen pixel tot twee pixels buiten een vlak: het dichtstbijzijnde vlak. */
function borderOwners(labels: Int32Array, w: number, h: number): Int32Array {
  let owner = Int32Array.from(labels);
  for (let pass = 0; pass < 2; pass++) {
    const next = Int32Array.from(owner);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (owner[i]! !== -1) continue;
        // Recht boven/onder/links/rechts eerst, dan diagonaal: de dichtstbijzijnde buur wint.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const o = owner[ny * w + nx]!;
          if (o >= 0) { next[i] = o; break; }
        }
      }
    owner = next;
  }
  return owner;
}

function regionMask(labels: Int32Array, owners: Int32Array, soft: Gray, glareFilled: Uint8Array, c: Comp, w: number, h: number): Gray {
  const mask = createGray(w, h);
  const pad = 3;
  for (let y = Math.max(0, c.minY - pad); y <= Math.min(h - 1, c.maxY + pad); y++)
    for (let x = Math.max(0, c.minX - pad); x <= Math.min(w - 1, c.maxX + pad); x++) {
      const i = y * w + x;
      const own = labels[i] === c.id;
      // Een overgangspixel hoort bij precies één vlak: het dichtstbijzijnde.
      if (!own && owners[i] !== c.id) continue;
      mask.data[i] = own ? Math.max(soft.data[i]!, 200) : soft.data[i]!;
      if (own && (soft.data[i]! < 110 || glareFilled[i])) mask.data[i] = 255; // opgevuld glimlicht
    }
  return mask;
}

/**
 * Welk van twee overlappende vlakken vooraan ligt. De zijde van het voorste vlak die over het achterste
 * loopt is in de foto zichtbaar als rand (kader, schaduw, lichtverschil); de verborgen zijde van het
 * achterste vlak niet. Zonder enig verschil: het vlak dat lager in beeld eindigt staat dichter bij de camera.
 */
function frontOf(a: Candidate, b: Candidate, grad: Float32Array, inRegion: (x: number, y: number) => boolean, w: number, h: number): Candidate {
  const evidence = (p: Candidate, other: Candidate) => {
    const inside = quadCoverage(other.quad);
    let s = 0, n = 0;
    for (let e = 0; e < 4; e++) {
      const s0 = p.quad[e]!, s1 = p.quad[(e + 1) % 4]!;
      const len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
      for (let k = 1; k < len; k += 1) {
        const x = s0[0] + ((s1[0] - s0[0]) * k) / len, y = s0[1] + ((s1[1] - s0[1]) * k) / len;
        if (inside(x, y) < 1 || !inRegion(x, y)) continue;
        // Alleen echt binnen het andere vlak (niet vlak bij diens rand).
        if (inside(x + 3, y) < 1 || inside(x - 3, y) < 1 || inside(x, y + 3) < 1 || inside(x, y - 3) < 1) continue;
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.max(m, grad[yy * w + xx]!);
        }
        s += m; n++;
      }
    }
    return n ? s / n : 0;
  };
  const ea = evidence(a, b), eb = evidence(b, a);
  if (Math.max(ea, eb) > 6 && Math.max(ea, eb) > 1.6 * Math.min(ea, eb)) return ea > eb ? a : b;
  const low = (c: Candidate) => Math.max(...c.quad.map((p) => p[1]));
  if (Math.abs(low(a) - low(b)) > 2) return low(a) > low(b) ? a : b;
  return a.area < b.area ? a : b;
}

export function detectChromaSurfaces(img: RGBA, opts: DetectOptions = {}): DetectedSurface[] {
  const { width: w, height: h } = img;
  const minCoverage = opts.minCoverage ?? 0.004;
  const maxSurfaces = opts.maxSurfaces ?? 8;
  const split = !opts.curved;
  const soft = greenMap(img);
  let bin: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = soft.data[i]! > 110 ? 1 : 0;
  // Opening verwijdert losse groene pixels (bladeren, reflecties) zonder het vlak te veranderen.
  bin = dilate(erode(bin, w, h), w, h);
  const glareFilled = bridgeGlare(img, bin, w, h);

  const total = w * h;
  const { labels, comps, grad } = segmentGreen(img, bin, w, h, Math.max(30, total * minCoverage * 0.2), split);
  const results: DetectedSurface[] = [];
  const candidates = comps.filter((c) => c.pixels / total >= minCoverage).sort((a, b) => b.pixels - a.pixels).slice(0, maxSurfaces);
  // Gaten binnen het vlak: een glimlicht (licht en onverzadigd) hoort bij het vlak, een voorwerp ervoor niet.
  for (const c of candidates) fillGlareHoles(img, labels, c, w, h);
  const kept = new Set(candidates.map((c) => c.id));
  for (let p = 0; p < labels.length; p++) if (labels[p]! >= 0 && !kept.has(labels[p]!)) labels[p] = -1;
  const owners = borderOwners(labels, w, h);
  for (const c of candidates) {
    let pixels = 0;
    for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) if (labels[y * w + x] === c.id) pixels++;
    const ids = new Set([c.id]);
    const edge = extremeEdge(labels, ids, c, w);
    const hull = hullFit(edge, pixels, c, w, h);
    const diag = Math.hypot(c.maxX - c.minX, c.maxY - c.minY);

    // Rechte randen van het gebied: één vlak (eventueel deels afgedekt) of meerdere vlakken.
    const m = 6;
    const rx0 = Math.max(0, c.minX - m), ry0 = Math.max(0, c.minY - m);
    const rw = Math.min(w - 1, c.maxX + m) - rx0 + 1, rh = Math.min(h - 1, c.maxY + m) - ry0 + 1;
    const pix = new Uint8Array(rw * rh);
    const occ = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const l = labels[(ry0 + y) * w + rx0 + x]!;
      if (l === c.id) pix[y * rw + x] = 1; else if (l >= 0) occ[y * rw + x] = 1;
    }
    const region: Region = { x0: rx0, y0: ry0, w: rw, h: rh, pix, imgW: w, imgH: h, count: pixels, occ };
    const edgeStrength = (x: number, y: number) => {
      let mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) mx = Math.max(mx, grad[yy * w + xx]!);
      }
      return mx;
    };
    const fit = fitQuads(region, { minArea: Math.max(64, total * minCoverage * 0.5), extra: hull ? [hull.quad] : [], allowSplit: split, edgeStrength, diagEvidence: 4 });
    const base = regionMask(labels, owners, soft, glareFilled, c, w, h);

    if (fit.multi) {
      const inRegion = (x: number, y: number) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        return xi >= 0 && yi >= 0 && xi < w && yi < h && labels[yi * w + xi] === c.id;
      };
      // Volgorde van voor naar achter: telt hoe vaak een vlak vóór een overlappend ander vlak ligt.
      const quads = fit.multi;
      const wins = quads.map(() => 0);
      for (let i = 0; i < quads.length; i++)
        for (let j = i + 1; j < quads.length; j++) {
          const f = frontOf(quads[i]!, quads[j]!, grad, inRegion, w, h);
          wins[f === quads[i] ? i : j]!++;
        }
      const order = quads.map((q, i) => ({ q, i })).sort((a, b) => wins[b.i]! - wins[a.i]!);
      const covs = order.map(({ q }) => quadCoverage(q.quad));
      const masks = order.map(() => createGray(w, h));
      const visible = order.map(() => 0);
      const pad = 3;
      for (let y = Math.max(0, c.minY - pad); y <= Math.min(h - 1, c.maxY + pad); y++)
        for (let x = Math.max(0, c.minX - pad); x <= Math.min(w - 1, c.maxX + pad); x++) {
          const i = y * w + x;
          const bm = base.data[i]!;
          if (!bm) continue;
          let rem = 1;
          const wts = covs.map((cov) => { const v = rem * cov(x + 0.5, y + 0.5); rem -= v; return v; });
          let sum = 1 - rem;
          if (sum < 1e-3) {
            // Buiten alle vierhoeken (rafelrand): naar het dichtstbijzijnde vlak.
            let best = 0, bd = Infinity;
            order.forEach(({ q }, k) => {
              const d = Math.min(...[0, 1, 2, 3].map((e) => distToSegment([x + 0.5, y + 0.5], q.quad[e]!, q.quad[(e + 1) % 4]!)));
              if (d < bd) { bd = d; best = k; }
            });
            wts.fill(0); wts[best] = 1; sum = 1;
          }
          for (let k = 0; k < wts.length; k++) {
            const v = wts[k]! / sum;
            if (v <= 0) continue;
            masks[k]!.data[i] = Math.round(bm * v);
            if (labels[i] === c.id) visible[k]! += v;
          }
        }
      order.forEach(({ q }, k) => {
        const area = polygonArea(q.quad);
        let cov = 0;
        for (const v of masks[k]!.data) cov += v;
        const fill = Math.min(1, visible[k]! / Math.max(1, area));
        results.push({ quad: q.quad, coverage: cov / 255 / total, fill, edgeFit: q.support, quality: Math.min(fill, q.support), mask: masks[k]!, depth: k });
      });
      continue;
    }

    // De lijnen zijn al met kleinste kwadraten op de randpixels gepast; de omhullende-methode is zelf al verfijnd.
    const quad: Quad | null = fit.single?.quad ?? hull?.quad ?? null;
    if (!quad) continue;
    const area = polygonArea(quad);
    if (area <= 0) continue;
    const { edgeFit } = edgeFitOf(edge, quad, diag);
    const fill = Math.min(1, pixels / area);
    results.push({ quad, coverage: pixels / total, fill, edgeFit, quality: Math.min(fill, edgeFit), mask: base, depth: 0 });
  }
  // Van links naar rechts, zodat "Vlak 1" voorspelbaar is bij meerdere apparaten.
  return results.sort((a, b) => a.quad[0][0] - b.quad[0][0]);
}

/** Neutrale waarde in de schaduwkaart: 128 betekent "geen verandering". */
export const SHADING_NEUTRAL = 128;

/**
 * Schaduwkaart: helderheid binnen het vlak ten opzichte van de mediaan van dat vlak.
 * Opgeslagen als grijswaarde waarbij 128 neutraal is; donkerder dempt, lichter licht het ontwerp op.
 * Zo valt een gevuld deel (bijvoorbeeld de stofkleur) niet donkerder uit dan de omgeving.
 */
export function shadingMap(img: RGBA, region: Gray, channel: 'green' | 'luma'): Gray {
  const { width: w, height: h } = img;
  const values: number[] = [];
  const lum = new Float32Array(w * h);
  const d = img.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const v = channel === 'green' ? d[i + 1]! : 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    lum[p] = v;
    if (region.data[p]! > 200 && (p & 3) === 0) values.push(v);
  }
  const out = createGray(w, h, SHADING_NEUTRAL);
  if (!values.length) return out;
  values.sort((a, b) => a - b);
  const ref = Math.max(1, values[Math.floor(values.length * 0.5)]!);
  for (let p = 0; p < w * h; p++) {
    const m = region.data[p]!;
    if (!m) continue;
    const s = Math.min(2, lum[p]! / ref);
    const k = m / 255;
    out.data[p] = Math.round(SHADING_NEUTRAL * (1 - k + k * s));
  }
  // Randpixels zijn een mengsel van paneel en omgeving; hun helderheid zegt niets over het licht en zou een
  // donker randje geven. Neem daar de waarde van de dichtstbijzijnde volle paneelpixel over.
  // Ook volle maskerpixels direct aan de rand zijn vaak nog gemengd.
  const solid = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || region.data[ny * w + nx]! < 250) return false;
      }
    return true;
  };
  const fixed = new Uint8Array(out.data);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, m = region.data[p]!;
      if (!m || solid(x, y)) continue;
      let best = -1, bd = Infinity;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !solid(nx, ny)) continue;
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = ny * w + nx; }
        }
      if (best >= 0) fixed[p] = out.data[best]!;
    }
  out.data.set(fixed);
  return out;
}

/** Vult een vierhoek als masker (met eenvoudige 4x4-randverzachting). */
export function quadMask(w: number, h: number, quad: Quad): Gray {
  const out = createGray(w, h);
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const edges = quad.map((a, i) => {
    const b = quad[(i + 1) % 4]!;
    return { a, b };
  });
  const sign = polygonSign(quad);
  const inside = (x: number, y: number) =>
    edges.every(({ a, b }) => ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * sign >= 0);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      out.data[y * w + x] = Math.round((n / 16) * 255);
    }
  return out;
}

function polygonSign(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) a += q[i]![0] * q[(i + 1) % 4]![1] - q[(i + 1) % 4]![0] * q[i]![1];
  return Math.sign(a) || 1;
}

/**
 * Raster voor een gebogen vlak (mok, fles, blik), afgeleid uit het masker: per kolom de werkelijke
 * boven- en onderrand. De kolommen liggen op gelijke hoek over de cilinder, zodat het ontwerp aan de
 * zijkanten samengedrukt wordt zoals bij een echte ronding.
 */
export function fitCylinderMesh(mask: Gray, quad: Quad, wrapDeg: number, cols = 16): { cols: number; rows: number; points: Point[] } {
  const half = (Math.max(1, Math.min(300, wrapDeg)) * Math.PI) / 360;
  const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const at = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < mask.width && yi < mask.height ? mask.data[yi * mask.width + xi]! : 0;
  };
  const top: Point[] = [], bottom: Point[] = [];
  for (let c = 0; c <= cols; c++) {
    const t = c / cols;
    const phi = (t - 0.5) * 2 * half;
    // Iets binnen de linker- en rechterrand blijven, anders valt de scanlijn net naast het masker.
    const h = Math.min(0.995, Math.max(0.005, (Math.sin(phi) / Math.sin(Math.min(half, Math.PI / 2)) + 1) / 2));
    const pt = lerp(quad[0], quad[1], h), pb = lerp(quad[3], quad[2], h);
    const len = Math.hypot(pb[0] - pt[0], pb[1] - pt[1]);
    const steps = Math.max(8, Math.ceil(len * 1.4) * 2);
    // Scan van ruim boven tot ruim onder de rechte lijn en neem de buitenste maskerpunten.
    let first: Point | null = null, last: Point | null = null;
    for (let i = 0; i <= steps; i++) {
      const p = lerp(pt, pb, -0.2 + (1.4 * i) / steps);
      if (at(p[0], p[1]) > 127) { first ??= p; last = p; }
    }
    top.push(first ?? pt);
    bottom.push(last ?? pb);
  }
  const points: Point[] = [...top, ...top.map((p, i) => lerp(p, bottom[i]!, 0.5)), ...bottom];
  return { cols, rows: 2, points };
}
