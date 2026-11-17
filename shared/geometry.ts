// Perspectiefgeometrie die zowel de server (warp) als de browser (CSS matrix3d) gebruikt.
// Eén implementatie zorgt dat de live preview en de export exact dezelfde transformatie volgen.

export type Point = [number, number];
/** Hoeken in vaste volgorde: linksboven, rechtsboven, rechtsonder, linksonder. */
export type Quad = [Point, Point, Point, Point];
/** Beeld waarin een vlak ligt; met aspect de bekende echte verhouding van het vlak (dan wordt niet geschat). */
export interface ImageFrame { width: number; height: number; aspect?: number | null }
/** 3x3 matrix, rij voor rij. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Lost Ax = b op met Gauss-eliminatie en partiële pivotering. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    if (Math.abs(M[pivot]![col]!) < 1e-12) throw new Error('Ontaarde vierhoek: de hoeken liggen op één lijn.');
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Homografie die de vier bronpunten op de vier doelpunten afbeeldt. */
export function homography(src: Quad, dst: Quad): Mat3 {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const [u, v] = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function rectQuad(w: number, h: number): Quad {
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

export function applyH(H: Mat3, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) throw new Error('Matrix is niet inverteerbaar.');
  const inv: Mat3 = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ];
  return inv.map((v) => v / det) as Mat3;
}

export function multiply3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] = r[i * 3 + j]! + a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

/**
 * CSS matrix3d voor een element van w x h (transform-origin 0 0) dat op de vierhoek moet vallen.
 * CSS verwacht kolom-volgorde; de derde as blijft ongemoeid.
 */
export function cssMatrix3d(w: number, h: number, quad: Quad): string {
  const H = homography(rectQuad(w, h), quad);
  const n = H.map((v) => v / H[8]);
  const m = [n[0], n[3], 0, n[6], n[1], n[4], 0, n[7], 0, 0, 1, 0, n[2], n[5], 0, n[8]];
  return `matrix3d(${m.map((v) => +v!.toFixed(10)).join(',')})`;
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Werkelijke verhouding (breedte/hoogte) van de rechthoek achter een vierhoek in perspectief.
 * Met de beeldmaat erbij wordt de brandpuntsafstand geschat (Zhang en He, "Whiteboard scanning",
 * hoofdpunt in het midden van het beeld) en volgt de verhouding exact uit de projectie.
 * Zonder beeldmaat, of bij een (bijna) affiene vierhoek, valt hij terug op de gemiddelde zijden.
 */
export function quadAspect(q: Quad, imageW?: number, imageH?: number): number {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const fallback = h > 0 ? w / h : 1;
  if (!imageW || !imageH) return fallback;
  const u0 = imageW / 2, v0 = imageH / 2;
  const m1 = [q[0][0], q[0][1], 1], m2 = [q[1][0], q[1][1], 1], m3 = [q[3][0], q[3][1], 1], m4 = [q[2][0], q[2][1], 1];
  const cr = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dt = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const k2 = dt(cr(m1, m4), m3) / dt(cr(m2, m4), m3);
  const k3 = dt(cr(m1, m4), m2) / dt(cr(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return fallback;
  const n2 = m2.map((v, i) => k2 * v - m1[i]!);
  const n3 = m3.map((v, i) => k3 * v - m1[i]!);
  const [n21, n22, n23] = n2 as [number, number, number];
  const [n31, n32, n33] = n3 as [number, number, number];
  const scaleRef = Math.max(imageW, imageH);
  // Bijna affien: de verhouding volgt direct uit de vectoren.
  if (Math.abs(n23) < 1e-6 || Math.abs(n33) < 1e-6) {
    const r = Math.sqrt((n21 * n21 + n22 * n22) / (n31 * n31 + n32 * n32));
    return Number.isFinite(r) && r > 0 ? r : fallback;
  }
  const f2 = -((n21 * n31 - (n21 * n33 + n23 * n31) * u0 + n23 * n33 * u0 * u0) + (n22 * n32 - (n22 * n33 + n23 * n32) * v0 + n23 * n33 * v0 * v0)) / (n23 * n33);
  // Een onwaarschijnlijke brandpuntsafstand betekent een onbetrouwbare schatting.
  if (!(f2 > 0) || Math.sqrt(f2) < scaleRef * 0.25 || Math.sqrt(f2) > scaleRef * 12) return fallback;
  const f = Math.sqrt(f2);
  const kinv = (n: number[]) => [(n[0]! - u0 * n[2]!) / f, (n[1]! - v0 * n[2]!) / f, n[2]!];
  const a = kinv(n2), b = kinv(n3);
  const r = Math.sqrt(dt(a, a) / dt(b, b));
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

/** Afmeting van het "vlakke" oppervlak in pixels, gebaseerd op de langste zijden. */
export function quadSurfaceSize(q: Quad): { width: number; height: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Zet vier willekeurige punten in de volgorde linksboven, rechtsboven, rechtsonder, linksonder. */
export function orderQuad(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('Een vierhoek heeft precies vier punten nodig.');
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // Na sortering op hoek (met y omlaag) loopt de volgorde met de klok mee; begin bij het punt met kleinste x+y.
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i]![0] + sorted[i]![1] < sorted[start]![0] + sorted[start]![1]) start = i;
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]!) as Quad;
}

/** Controleert of een vierhoek convex en niet gedraaid is (bruikbaar voor een homografie). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!, c = q[(i + 2) % 4]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/**
 * Plaatsing van het ontwerp binnen het vlakke oppervlak (in oppervlak-pixels).
 * Geeft de affiene matrix die ontwerp-pixels naar oppervlak-pixels brengt.
 */
export interface DesignTransform {
  fit: 'cover' | 'contain' | 'fill' | 'width';
  /** Verschuiving als fractie van de oppervlakbreedte/-hoogte. */
  offsetX: number;
  offsetY: number;
  /** Extra schaal bovenop de fit (1 = precies passend). */
  scale: number;
  /** Rotatie in graden, rond het midden van het oppervlak. */
  rotation: number;
  /** Uitlijning van het ontwerp bij fit 'width' (bijvoorbeeld websitescreenshots die bovenaan beginnen). */
  anchor?: 'top' | 'center';
}

export function designToSurfaceMatrix(
  design: { width: number; height: number },
  surface: { width: number; height: number },
  t: DesignTransform,
): Mat3 {
  const sx0 = surface.width / design.width;
  const sy0 = surface.height / design.height;
  let sx: number, sy: number;
  switch (t.fit) {
    case 'fill': sx = sx0; sy = sy0; break;
    case 'contain': sx = sy = Math.min(sx0, sy0); break;
    case 'width': sx = sy = sx0; break;
    default: sx = sy = Math.max(sx0, sy0);
  }
  sx *= t.scale;
  sy *= t.scale;
  const dw = design.width * sx;
  const dh = design.height * sy;
  // Centreer, of lijn bovenaan uit bij een websitescreenshot dat langer is dan het scherm.
  const baseX = (surface.width - dw) / 2;
  const baseY = t.fit === 'width' && t.anchor !== 'center' ? 0 : (surface.height - dh) / 2;
  const tx = baseX + t.offsetX * surface.width;
  const ty = baseY + t.offsetY * surface.height;
  const scaleTranslate: Mat3 = [sx, 0, tx, 0, sy, ty, 0, 0, 1];
  if (!t.rotation) return scaleTranslate;
  const r = (t.rotation * Math.PI) / 180;
  const cx = surface.width / 2, cy = surface.height / 2;
  const cos = Math.cos(r), sin = Math.sin(r);
  const rot: Mat3 = [cos, -sin, cx - cos * cx + sin * cy, sin, cos, cy - sin * cx - cos * cy, 0, 0, 1];
  return multiply3(rot, scaleTranslate);
}

/** Volledige afbeelding ontwerp-pixel -> scène-pixel. */
export function designToSceneMatrix(
  design: { width: number; height: number },
  quad: Quad,
  t: DesignTransform,
  image?: ImageFrame,
): { H: Mat3; surface: { width: number; height: number } } {
  const surface = quadSurfaceSize(quad);
  const aspect = image?.aspect || quadAspect(quad, image?.width, image?.height);
  // Corrigeer de oppervlakmaat naar de geschatte werkelijke verhouding.
  const s = { width: surface.width, height: surface.width / aspect };
  const surfaceToScene = homography(rectQuad(s.width, s.height), quad);
  const designToSurface = designToSurfaceMatrix(design, s, t);
  return { H: multiply3(surfaceToScene, designToSurface), surface: s };
}

/** Draait de hoekvolgorde een kwartslag: het ontwerp op het vlak draait 90 graden mee. */
export function rotateQuad(q: Quad, steps = 1): Quad {
  const k = ((steps % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + k) % 4]!) as Quad;
}

/**
 * Kiest welke hoek linksboven is, zodat het ontwerp rechtop staat: de bovenzijde is de zijde die
 * het hoogst in beeld ligt, met de verwachte stand (staand of liggend) van het vlak.
 */
export function orientQuad(q: Quad, orientation?: 'portrait' | 'landscape'): Quad {
  if (!orientation) {
    // Onbekend: de langste zijden die vooral horizontaal lopen zijn boven- en onderkant (liggend);
    // lopen ze vooral de diepte in, dan staat het vlak rechtop (staand), zoals een telefoon op tafel.
    const a = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, b = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    if (Math.max(a, b) / Math.min(a, b) > 1.15) {
      const [p0, p1] = a > b ? [q[0], q[1]] : [q[0], q[3]];
      orientation = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]) ? 'landscape' : 'portrait';
    }
  }
  let best = q, bestY = Infinity;
  for (let r = 0; r < 4; r++) {
    const c = rotateQuad(q, r);
    const top = dist(c[0], c[1]), side = dist(c[0], c[3]);
    if (orientation === 'landscape' && top < side * 0.98) continue;
    if (orientation === 'portrait' && top > side * 1.02) continue;
    const y = (c[0][1] + c[1][1]) / 2;
    if (y < bestY) { bestY = y; best = c; }
  }
  return best;
}

/** Afmeting van het vlakke oppervlak zoals editor en export die gebruiken (breedte uit de langste zijde, hoogte uit de verhouding). */
export function surfaceDimensions(q: Quad, image?: ImageFrame): { width: number; height: number } {
  const s = quadSurfaceSize(q);
  return { width: s.width, height: s.width / (image?.aspect || quadAspect(q, image?.width, image?.height)) };
}
