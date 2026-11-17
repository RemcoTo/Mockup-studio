// Vierhoeken passen op een groen gebied aan de hand van de rechte randen ervan.
//
// Werkwijze: de randpixels van het gebied leveren via een Hough-transformatie de dominante rechte lijnen
// (ook als een zijde deels is afgedekt). Snijpunten van die lijnen die op de rand liggen zijn hoeken; lijnen
// tussen twee hoeken door het groen heen zijn mogelijke gedeelde ribben (zoals tussen de voor- en zijkant
// van een doos). Elke combinatie van vier lijnen is een kandidaat-vierhoek, die wordt beoordeeld op:
//   - support: welk deel van de omtrek op de echte rand van het gebied ligt;
//   - contain: welk deel van het groen binnen de vierhoek valt;
//   - green:   welk deel van de vierhoek groen is (laag = afgedekt door een voorwerp of geen vlak).
// Eén vlak (eventueel deels afgedekt) is de kandidaat die al het groen bevat met de beste randen.
// Meerdere vlakken zijn een kleine set "schone" vierhoeken (vrijwel geheel groen) die samen het gebied
// verklaren en die niet in hetzelfde vlak liggen (ze delen hooguit één lijn).

import { orderQuad, polygonArea, type Point, type Quad } from '../../../shared/geometry';

export interface Region {
  /** Kader in beeldcoördinaten, inclusief een marge rondom het gebied. */
  x0: number; y0: number; w: number; h: number;
  /** 1 = pixel hoort bij het gebied (lokaal binnen het kader). */
  pix: Uint8Array;
  imgW: number; imgH: number;
  count: number;
  /** Pixels van andere (voorliggende) groene vlakken: verklaren een afgedekt deel, tellen niet als gat. */
  occ?: Uint8Array;
}

export interface Line { nx: number; ny: number; c: number; len: number; diag: boolean }

export interface Candidate {
  quad: Quad;
  lines: [number, number, number, number];
  support: number;
  contain: number;
  green: number;
  area: number;
}

export interface QuadFit {
  lines: Line[];
  /** Beste enkele vierhoek die al het groen omvat (eventueel deels afgedekt). */
  single: Candidate | null;
  /** Meerdere vlakken, of null als het gebied één vlak is. */
  multi: Candidate[] | null;
  /** Afstand (px) van elke pixel in het kader tot de rand van het gebied. */
  dist: Float32Array;
  tol: number;
}

const DEG = Math.PI / 180;

/** Randpunten met een halve pixel naar buiten verschoven, zodat lijnen op de echte rand liggen. */
function boundary(r: Region): { pts: number[]; edge: Uint8Array } {
  const { w, h, pix } = r;
  const pts: number[] = [];
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!pix[i]) continue;
      let ox = 0, oy = 0, out = false;
      const gx = r.x0 + x, gy = r.y0 + y;
      // Buiten het beeld telt niet als rand: daar loopt het vlak alleen het beeld uit.
      if (x > 0 ? !pix[i - 1] : gx > 0) { ox -= 1; out = true; }
      if (x < w - 1 ? !pix[i + 1] : gx < r.imgW - 1) { ox += 1; out = true; }
      if (y > 0 ? !pix[i - w] : gy > 0) { oy -= 1; out = true; }
      if (y < h - 1 ? !pix[i + w] : gy < r.imgH - 1) { oy += 1; out = true; }
      if (!out) continue;
      edge[i] = 1;
      const l = Math.hypot(ox, oy);
      const s = l > 0 ? 0.5 / l : 0;
      pts.push(x + 0.5 + ox * s, y + 0.5 + oy * s);
    }
  return { pts, edge };
}

/** Afstandskaart (chamfer 3-4) tot de dichtstbijzijnde randpixel. */
export function distanceMap(edge: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = edge[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

/** Lijn door punten (kleinste kwadraten, loodrecht): normaal (nx, ny) en c met nx*x + ny*y = c. */
function fitPoints(xs: number[], ys: number[]): { nx: number; ny: number; c: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  return { nx, ny, c: nx * mx + ny * my };
}

function sameLine(a: { nx: number; ny: number; c: number }, b: { nx: number; ny: number; c: number }, angTol = 2 * DEG, offTol = 3): boolean {
  const dot = a.nx * b.nx + a.ny * b.ny;
  const ang = Math.acos(Math.min(1, Math.abs(dot)));
  if (ang > angTol) return false;
  const c2 = dot < 0 ? -b.c : b.c;
  return Math.abs(a.c - c2) < offTol;
}

export function intersectLines(a: { nx: number; ny: number; c: number }, b: { nx: number; ny: number; c: number }): Point | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return [(a.c * b.ny - a.ny * b.c) / det, (a.nx * b.c - a.c * b.nx) / det];
}

/** Dominante rechte randen via een sequentiële Hough-transformatie (lokale coördinaten). */
function houghLines(pts: number[], w: number, h: number, minLen: number, tolIn: number, maxLines: number): Line[] {
  const n = pts.length / 2;
  const nT = 360;
  const cos = new Float64Array(nT), sin = new Float64Array(nT);
  for (let t = 0; t < nT; t++) { cos[t] = Math.cos((t * Math.PI) / nT); sin[t] = Math.sin((t * Math.PI) / nT); }
  const rMax = Math.ceil(Math.hypot(w, h)) + 2;
  const nR = 2 * rMax + 1;
  const acc = new Int32Array(nT * nR);
  const vote = (k: number, delta: number) => {
    const x = pts[2 * k]!, y = pts[2 * k + 1]!;
    for (let t = 0; t < nT; t++) { const i = t * nR + Math.round(x * cos[t]! + y * sin[t]!) + rMax; acc[i] = acc[i]! + delta; }
  };
  for (let k = 0; k < n; k++) vote(k, 1);
  const used = new Uint8Array(n);
  const lines: Line[] = [];
  const minVotes = Math.max(8, Math.round(minLen * 0.6));
  const gapMax = Math.max(4, minLen * 0.35);
  for (let iter = 0; iter < maxLines * 3 && lines.length < maxLines; iter++) {
    let best = 0, bv = -1;
    for (let i = 0; i < acc.length; i++) if (acc[i]! > bv) { bv = acc[i]!; best = i; }
    if (bv < minVotes) break;
    const t = Math.floor(best / nR), rho = (best % nR) - rMax;
    let line = { nx: cos[t]!, ny: sin[t]!, c: rho };
    // Inliers verzamelen, lijn verfijnen en opnieuw verzamelen.
    let idx: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
      idx = [];
      for (let k = 0; k < n; k++) if (!used[k] && Math.abs(pts[2 * k]! * line.nx + pts[2 * k + 1]! * line.ny - line.c) <= tolIn) idx.push(k);
      if (idx.length < 2) break;
      const f = fitPoints(idx.map((k) => pts[2 * k]!), idx.map((k) => pts[2 * k + 1]!));
      if (f) line = f;
    }
    if (idx.length < minVotes) { acc[best] = 0; continue; }
    // Aaneengesloten stukken langs de lijn; een zijde die in het midden is afgedekt telt als één lijn.
    const dx = -line.ny, dy = line.nx;
    const proj = idx.map((k) => ({ k, s: pts[2 * k]! * dx + pts[2 * k + 1]! * dy })).sort((a, b) => a.s - b.s);
    const keep: number[] = [];
    let cover = 0;
    for (let i = 0; i < proj.length;) {
      let j = i;
      while (j + 1 < proj.length && proj[j + 1]!.s - proj[j]!.s <= gapMax) j++;
      const ext = proj[j]!.s - proj[i]!.s;
      if (ext >= 6 && j - i + 1 >= 6) { cover += ext; for (let q = i; q <= j; q++) keep.push(proj[q]!.k); }
      i = j + 1;
    }
    for (const k of idx) { used[k] = 1; vote(k, -1); }
    if (cover < minLen || keep.length < 6) continue;
    const f = fitPoints(keep.map((k) => pts[2 * k]!), keep.map((k) => pts[2 * k + 1]!));
    if (!f) continue;
    if (lines.some((l) => sameLine(l, f))) continue;
    lines.push({ ...f, len: cover, diag: false });
  }
  return lines;
}

function lineAngle(a: Line, b: Line): number {
  return Math.acos(Math.min(1, Math.abs(a.nx * b.nx + a.ny * b.ny)));
}

export interface FitOptions {
  /** Minimale oppervlakte (px) van een vlak. */
  minArea: number;
  /** Kandidaat uit de oude omhullende-methode; wordt op dezelfde manier beoordeeld. */
  extra?: Quad[];
  /** Meerdere vlakken binnen het gebied toestaan. */
  allowSplit: boolean;
  /** Randsterkte op een beeldpunt; een verborgen ribbe telt alleen als er langs die lijn een overgang zit. */
  edgeStrength?: (x: number, y: number) => number;
  diagEvidence?: number;
}

export function fitQuads(r: Region, opts: FitOptions): QuadFit {
  const { w, h, pix } = r;
  const diag = Math.hypot(w, h);
  const tol = Math.max(1.6, diag * 0.006);
  const { pts, edge } = boundary(r);
  const dist = distanceMap(edge, w, h);
  const minLen = Math.max(10, diag * 0.07);
  const lines = houghLines(pts, w, h, minLen, Math.max(1.5, tol), 14);

  const inFrame = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const distAt = (x: number, y: number) => (inFrame(x, y) ? dist[Math.floor(y) * w + Math.floor(x)]! : Infinity);
  const pixAt = (x: number, y: number) => (inFrame(x, y) ? pix[Math.floor(y) * w + Math.floor(x)]! : 0);

  // Hoeken: snijpunten van twee lijnen die op de rand liggen. Lijnen tussen twee hoeken door het groen
  // zijn mogelijke gedeelde ribben.
  const corners: Point[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      if (lineAngle(lines[i]!, lines[j]!) < 20 * DEG) continue;
      const p = intersectLines(lines[i]!, lines[j]!);
      if (p && distAt(p[0], p[1]) <= 2.5 * tol && !corners.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < tol * 2)) corners.push(p);
    }
  const diags: Line[] = [];
  for (let i = 0; i < corners.length; i++)
    for (let j = i + 1; j < corners.length; j++) {
      const a = corners[i]!, b = corners[j]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < minLen * 1.5) continue;
      let inside = 0;
      const N = 24;
      for (let k = 0; k < N; k++) {
        const t = 0.1 + (0.8 * k) / (N - 1);
        if (pixAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) inside++;
      }
      if (inside / N < 0.9) continue;
      if (opts.edgeStrength) {
        // Alleen binnen het groen meten, uit de buurt van de rand: daar zegt een overgang iets over een ribbe.
        let e = 0, m = 0;
        for (let k = 0; k < 48; k++) {
          const t = 0.05 + (0.9 * k) / 47;
          const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
          if (!pixAt(x, y) || distAt(x, y) < 3 * tol + 3) continue;
          e += opts.edgeStrength(x + r.x0, y + r.y0); m++;
        }
        if (m < 12 || e / m < (opts.diagEvidence ?? 4)) continue;
      } else continue;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const l: Line = { nx, ny, c: nx * a[0] + ny * a[1], len, diag: true };
      if (lines.some((x) => sameLine(x, l, 3 * DEG, tol * 2)) || diags.some((x) => sameLine(x, l, 3 * DEG, tol * 2))) continue;
      diags.push(l);
    }
  diags.sort((a, b) => b.len - a.len);
  const all = [...lines, ...diags.slice(0, 8)];

  // Raster voor snelle oppervlaktetellingen.
  const cs = Math.max(1, Math.ceil(Math.max(w, h) / 150));
  const gw = Math.ceil(w / cs), gh = Math.ceil(h / cs);
  const grid = new Float32Array(gw * gh);
  const occGrid = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cell = Math.floor(y / cs) * gw + Math.floor(x / cs);
    if (pix[y * w + x]) grid[cell]! += 1;
    else if (r.occ?.[y * w + x]) occGrid[cell]! += 1;
  }
  const cellsInside = (q: Point[], cb: (cell: number) => void) => {
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    const gx0 = Math.max(0, Math.floor(Math.min(...xs) / cs)), gx1 = Math.min(gw - 1, Math.floor(Math.max(...xs) / cs));
    const gy0 = Math.max(0, Math.floor(Math.min(...ys) / cs)), gy1 = Math.min(gh - 1, Math.floor(Math.max(...ys) / cs));
    const sgn = Math.sign(polySigned(q)) || 1;
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = (gx + 0.5) * cs, py = (gy + 0.5) * cs;
        let ok = true;
        for (let e = 0; e < 4 && ok; e++) {
          const a = q[e]!, b = q[(e + 1) % 4]!;
          if (((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) * sgn < 0) ok = false;
        }
        if (ok) cb(gy * gw + gx);
      }
  };

  // Kandidaten: elke vier lijnen, in elk van de drie mogelijke paren van overstaande zijden.
  const L = all.length;
  const X: (Point | null)[][] = Array.from({ length: L }, () => new Array<Point | null>(L).fill(null));
  for (let i = 0; i < L; i++)
    for (let j = i + 1; j < L; j++) {
      if (lineAngle(all[i]!, all[j]!) < 15 * DEG) continue;
      const p = intersectLines(all[i]!, all[j]!);
      X[i]![j] = p; X[j]![i] = p;
    }
  const gxMin = -r.x0 - 0.3 * r.imgW, gxMax = r.imgW * 1.3 - r.x0, gyMin = -r.y0 - 0.3 * r.imgH, gyMax = r.imgH * 1.3 - r.y0;
  type Raw = { pts: Point[]; lines: [number, number, number, number]; support: number };
  const raws: Raw[] = [];
  const tryQuad = (a: number, b: number, c: number, d: number) => {
    const p = [X[a]![b], X[b]![c], X[c]![d], X[d]![a]];
    if (p.some((q) => !q)) return;
    const q = p as Point[];
    if (q.some(([x, y]) => x < gxMin || x > gxMax || y < gyMin || y > gyMax)) return;
    if (!convexWithAngles(q, 20, 160)) return;
    if (Math.abs(polySigned(q)) / 2 < opts.minArea) return;
    raws.push({ pts: q, lines: [a, b, c, d], support: supportOf(q) });
  };
  const supportOf = (q: Point[]): number => {
    let sup = 0, tot = 0;
    for (let e = 0; e < 4; e++) {
      const a = q[e]!, b = q[(e + 1) % 4]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(4, Math.ceil(len / 2));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps, y = a[1] + ((b[1] - a[1]) * k) / steps;
        const gx = x + r.x0, gy = y + r.y0;
        if (gx < 0 || gy < 0 || gx >= r.imgW || gy >= r.imgH) continue; // buiten beeld: niet te beoordelen
        tot++;
        if (distAt(x, y) <= tol) sup++;
      }
    }
    return tot ? sup / tot : 0;
  };
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++)
      for (let c = b + 1; c < L; c++)
        for (let d = c + 1; d < L; d++) {
          tryQuad(a, b, c, d); // overstaand: (a,c) en (b,d)
          tryQuad(a, b, d, c); // overstaand: (a,d) en (b,c)
          tryQuad(a, c, b, d); // overstaand: (a,b) en (c,d)
        }
  for (const e of opts.extra ?? []) {
    const q = e.map(([x, y]) => [x - r.x0, y - r.y0] as Point);
    if (convexWithAngles(q, 5, 175)) raws.push({ pts: q, lines: [-1, -1, -1, -1], support: supportOf(q) });
  }
  raws.sort((p, q) => q.support - p.support);
  const total = r.count;
  const scored: Candidate[] = [];
  for (const raw of raws.slice(0, 600)) {
    if (raw.support < 0.3 && raw.lines[0] !== -1) continue;
    let g = 0, o = 0;
    cellsInside(raw.pts, (cell) => { g += grid[cell]!; o += occGrid[cell]!; });
    const area = Math.abs(polySigned(raw.pts)) / 2;
    scored.push({
      quad: orderQuad(raw.pts.map(([x, y]) => [x + r.x0, y + r.y0] as Point)),
      lines: raw.lines, support: raw.support, contain: g / Math.max(1, total), green: Math.min(1, (g + o) / Math.max(1, area)), area,
      // Lokale punten bewaren voor de rastertellingen hieronder.
      ...({ local: raw.pts } as object),
    });
  }
  const localOf = (c: Candidate) => (c as unknown as { local: Point[] }).local;

  let single: Candidate | null = null, bestScore = -Infinity;
  for (const c of scored) {
    if (c.contain < 0.975) continue;
    const s = c.support + 0.6 * c.green;
    if (s > bestScore) { bestScore = s; single = c; }
  }

  // Randpunten (steekproef): welke ervan liggen op een zijde van een vierhoek. Een goede verklaring van het
  // gebied laat geen stuk echte rand onverklaard; een "spookvierhoek" (gevormd uit randen van twee vlakken)
  // laat juist stukken rand liggen.
  const nb = pts.length / 2;
  const bstep = Math.max(1, Math.floor(nb / 600));
  const bpts: Point[] = [];
  for (let k = 0; k < nb; k += bstep) bpts.push([pts[2 * k]!, pts[2 * k + 1]!]);
  const bWords = Math.ceil(bpts.length / 32);
  const explainBits = (q: Point[]) => {
    const bits = new Uint32Array(bWords);
    bpts.forEach((p, k) => {
      for (let e = 0; e < 4; e++) if (segDist(p, q[e]!, q[(e + 1) % 4]!) <= tol * 1.5) { bits[k >> 5]! |= 1 << (k & 31); break; }
    });
    return bits;
  };
  const singleExplain = single ? popcount(explainBits(localOf(single))) / Math.max(1, bpts.length) : 0;

  let multi: Candidate[] | null = null;
  if (opts.allowSplit && bpts.length) {
    // Alleen vrijwel geheel groene vierhoeken: een vlak dat achter een ander groen vlak ligt is binnen zijn
    // vierhoek ook groen (de overlap is groen), een vierhoek die over de achtergrond loopt niet.
    const pool = scored
      .filter((c) => c.lines[0] !== -1 && c.green >= 0.95 && c.support >= 0.4 && c.contain >= 0.06)
      .sort((a, b) => b.contain * b.support - a.contain * a.support)
      .slice(0, 120);
    const cWords = Math.ceil(grid.length / 32);
    const greenBits = new Uint32Array(cWords);
    for (let i = 0; i < grid.length; i++) if (grid[i]! >= 0.5 * cs * cs) greenBits[i >> 5]! |= 1 << (i & 31);
    const greenCount = Math.max(1, popcount(greenBits));
    const cells = pool.map((c) => {
      const bits = new Uint32Array(cWords);
      cellsInside(localOf(c), (cell) => { bits[cell >> 5]! |= 1 << (cell & 31); });
      return bits;
    });
    const sizes = cells.map(popcount);
    const expl = pool.map((c) => explainBits(localOf(c)));
    const shares = (a: Candidate, b: Candidate) => {
      let n = 0;
      for (const i of a.lines) for (const j of b.lines) if (i === j || sameLine(all[i]!, all[j]!, 3 * DEG, tol * 2)) { n++; break; }
      return n;
    };
    const compatible = (i: number, j: number) => {
      if (shares(pool[i]!, pool[j]!) >= 2) return false; // zelfde vlak, door een voorwerp in stukken
      let inter = 0;
      for (let k = 0; k < cWords; k++) inter += popcount1(cells[i]![k]! & cells[j]![k]!);
      return inter / Math.max(1, Math.min(sizes[i]!, sizes[j]!)) <= 0.85; // de een ligt niet vrijwel in de ander
    };
    const evaluate = (set: number[]) => {
      let cov = 0, ex = 0;
      for (let k = 0; k < cWords; k++) { let u = 0; for (const i of set) u |= cells[i]![k]!; cov += popcount1(u & greenBits[k]!); }
      for (let k = 0; k < bWords; k++) { let u = 0; for (const i of set) u |= expl[i]![k]!; ex += popcount1(u); }
      return { cov: cov / greenCount, ex: ex / bpts.length };
    };
    let best: { set: number[]; score: number; ex: number } | null = null;
    const pairs: { set: number[]; cov: number; ex: number }[] = [];
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++) {
        if (!compatible(i, j)) continue;
        const { cov, ex } = evaluate([i, j]);
        pairs.push({ set: [i, j], cov, ex });
        if (cov < 0.97) continue;
        const score = ex + 0.3 * (pool[i]!.support + pool[j]!.support) / 2;
        if (!best || score > best.score) best = { set: [i, j], score, ex };
      }
    if (!best) {
      // Drie vlakken (bijvoorbeeld een waaier van telefoons): de beste paren aanvullen met een derde.
      pairs.sort((a, b) => b.cov + b.ex - (a.cov + a.ex));
      for (const pr of pairs.slice(0, 30))
        for (let k = 0; k < pool.length; k++) {
          if (pr.set.includes(k) || !pr.set.every((i) => compatible(i, k))) continue;
          const set = [...pr.set, k];
          const { cov, ex } = evaluate(set);
          if (cov < 0.97) continue;
          const score = ex + 0.3 * set.reduce((s, i) => s + pool[i]!.support, 0) / 3 - 0.05;
          if (!best || score > best.score) best = { set, score, ex };
        }
    }
    const clean = single && single.green >= 0.93 && single.support >= 0.75;
    if (best && !clean && best.ex >= singleExplain + 0.08) {
      multi = best.set.map((i) => pool[i]!);
    }
  }
  return { lines: all, single, multi, dist, tol };
}

function popcount1(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

function popcount(bits: Uint32Array): number {
  let n = 0;
  for (const v of bits) n += popcount1(v);
  return n;
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function polySigned(q: Point[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i]!, n = q[(i + 1) % q.length]!; a += p[0] * n[1] - n[0] * p[1]; }
  return a;
}

function convexWithAngles(q: Point[], minDeg: number, maxDeg: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4]!, b = q[i]!, c = q[(i + 1) % 4]!;
    const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 3 || lv < 3) return false;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const s = Math.sign(cr);
    if (!s || (sign && s !== sign)) return false;
    sign = s;
    const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) / DEG;
    if (ang < minDeg || ang > maxDeg) return false;
  }
  return true;
}

/** Bedekking (0..1) van een pixel door een convexe vierhoek, via de afstand tot de dichtstbijzijnde zijde. */
export function quadCoverage(q: Quad): (x: number, y: number) => number {
  const sgn = Math.sign(polygonSigned4(q)) || 1;
  const edges = q.map((a, i) => {
    const b = q[(i + 1) % 4]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Binnenwaartse normaal.
    return { ax: a[0], ay: a[1], nx: (-(b[1] - a[1]) / len) * sgn, ny: ((b[0] - a[0]) / len) * sgn };
  });
  return (x, y) => {
    let d = Infinity;
    for (const e of edges) d = Math.min(d, (x - e.ax) * e.nx + (y - e.ay) * e.ny);
    return d >= 0.5 ? 1 : d <= -0.5 ? 0 : d + 0.5;
  };
}

function polygonSigned4(q: Quad): number {
  return polySigned(q as unknown as Point[]);
}

export { polygonArea };
