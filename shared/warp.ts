// Vervormingsrasters voor gebogen en vrije oppervlakken. Een raster is een rooster van punten in de
// scène; elke cel wordt met een eigen homografie gevuld. Een vierhoek is een raster van 1×1 cel.
// Dezelfde code draait in de browser (live weergave) en op de server (export).
import { applyH, homography, quadAspect, type ImageFrame, type Point, type Quad } from './geometry';

export interface Mesh {
  cols: number;
  rows: number;
  /** (cols+1) × (rows+1) punten, rij voor rij, van linksboven naar rechtsonder. */
  points: Point[];
}

export interface CylinderParams {
  /** Zichtbare boog van het etiket of de print, in graden (0 = vlak). */
  wrap: number;
  /** Hoeveel de boven- en onderrand doorbuigen, als fractie van de hoogte (positief = midden lager). */
  bulge: number;
}

export const MAX_MESH = 24;

export function meshPoint(m: Mesh, c: number, r: number): Point {
  return m.points[r * (m.cols + 1) + c]!;
}

export function meshCorners(m: Mesh): Quad {
  return [meshPoint(m, 0, 0), meshPoint(m, m.cols, 0), meshPoint(m, m.cols, m.rows), meshPoint(m, 0, m.rows)];
}

/** Vlak raster binnen een vierhoek, in perspectief (punten via de homografie van de vierhoek). */
export function meshFromQuad(q: Quad, cols: number, rows: number): Mesh {
  const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], q);
  const points: Point[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) points.push(applyH(H, c / cols, r / rows));
  return { cols, rows, points };
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Raster voor een etiket of print op een cilinder (mok, fles, pot). De kolommen liggen op gelijke
 * afstand in hoek, zodat het ontwerp aan de zijkanten samengedrukt wordt zoals bij een echte ronding.
 * Boven- en onderrand volgen een ellipsboog.
 */
export function cylinderMesh(q: Quad, p: CylinderParams, cols = 16, rows = 2): Mesh {
  const wrap = Math.max(0, Math.min(300, p.wrap)) * (Math.PI / 180);
  const half = wrap / 2;
  const height = (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
  const points: Point[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const left = lerp(q[0], q[3], v), right = lerp(q[1], q[2], v);
    // Ellipsboog per rij: onder buigt iets meer door dan boven, zoals bij een camera boven het object.
    const bend = p.bulge * height * (0.85 + 0.3 * v);
    for (let c = 0; c <= cols; c++) {
      const t = c / cols;
      const phi = (t - 0.5) * wrap;
      const h = half > 1e-4 ? (Math.sin(phi) / Math.sin(Math.min(half, Math.PI / 2)) + 1) / 2 : t;
      const base = lerp(left, right, Math.max(0, Math.min(1, h)));
      const sag = half > 1e-4 ? (Math.cos(phi) - Math.cos(half)) / (1 - Math.cos(half)) : 0;
      points.push([base[0], base[1] + bend * sag]);
    }
  }
  return { cols, rows, points };
}

/** Verhouding boog/koorde: hoeveel breder het uitgerolde etiket is dan wat je recht van voren ziet. */
export function arcFactor(wrapDeg: number): number {
  const half = (Math.max(0, Math.min(300, wrapDeg)) * Math.PI) / 360;
  if (half < 1e-4) return 1;
  return half / Math.sin(Math.min(half, Math.PI / 2));
}

const polyLength = (pts: Point[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

/**
 * Afmeting van het uitgerolde oppervlak. Voor een vlak raster gelijk aan die van de vierhoek;
 * voor een gebogen raster tellen de werkelijke randlengtes en de boog mee.
 */
export function meshSurfaceDims(m: Mesh, image?: ImageFrame, cylinder?: CylinderParams | null): { width: number; height: number } {
  const corners = meshCorners(m);
  const top = Array.from({ length: m.cols + 1 }, (_, c) => meshPoint(m, c, 0));
  const bottom = Array.from({ length: m.cols + 1 }, (_, c) => meshPoint(m, c, m.rows));
  const left = Array.from({ length: m.rows + 1 }, (_, r) => meshPoint(m, 0, r));
  const right = Array.from({ length: m.rows + 1 }, (_, r) => meshPoint(m, m.cols, r));
  const width = Math.max(polyLength(top), polyLength(bottom), 1);
  const height = Math.max((polyLength(left) + polyLength(right)) / 2, 1);
  let aspect = width / height;
  if (cylinder && cylinder.wrap > 0) {
    // Bij een cilinder zie je de koorde; het uitgerolde etiket is de boog.
    aspect = quadAspect(corners, image?.width, image?.height) * arcFactor(cylinder.wrap);
  } else if (m.cols === 1 && m.rows === 1) {
    aspect = image?.aspect || quadAspect(corners, image?.width, image?.height);
  }
  return { width, height: width / aspect };
}

export interface MeshCell {
  /** Hoeken van de cel in de scène. */
  quad: Quad;
  /** Hoeken van de cel in het uitgerolde oppervlak (pixels). */
  rect: Quad;
}

export function meshCells(m: Mesh, surface: { width: number; height: number }): MeshCell[] {
  const cells: MeshCell[] = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const x0 = (c / m.cols) * surface.width, x1 = ((c + 1) / m.cols) * surface.width;
      const y0 = (r / m.rows) * surface.height, y1 = ((r + 1) / m.rows) * surface.height;
      cells.push({
        quad: [meshPoint(m, c, r), meshPoint(m, c + 1, r), meshPoint(m, c + 1, r + 1), meshPoint(m, c, r + 1)],
        rect: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      });
    }
  }
  return cells;
}

export function isValidMesh(m: Mesh): boolean {
  return Number.isInteger(m.cols) && Number.isInteger(m.rows) && m.cols >= 1 && m.rows >= 1 && m.cols <= MAX_MESH && m.rows <= MAX_MESH
    && m.points.length === (m.cols + 1) * (m.rows + 1) && m.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

/** Het raster dat bij een plaatsing hoort: eigen raster, anders cilinder, anders de vierhoek. */
export function effectiveMesh(quad: Quad, mesh: Mesh | null | undefined, cylinder: CylinderParams | null | undefined): Mesh {
  if (mesh && isValidMesh(mesh)) return mesh;
  if (cylinder && (cylinder.wrap > 0 || cylinder.bulge !== 0)) return cylinderMesh(quad, cylinder);
  return { cols: 1, rows: 1, points: [quad[0], quad[1], quad[3], quad[2]] };
}

/** Verschuift alle punten zodat de hoeken op een nieuwe vierhoek vallen (bij het verslepen van hoeken). */
export function remapMesh(m: Mesh, from: Quad, to: Quad): Mesh {
  const toUnit = homography(from, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const fromUnit = homography([[0, 0], [1, 0], [1, 1], [0, 1]], to);
  return { ...m, points: m.points.map(([x, y]) => { const [u, v] = applyH(toUnit, x, y); return applyH(fromUnit, u, v); }) };
}

export interface GeometrySource {
  quad: Quad;
  mesh?: Mesh | null;
  cylinder?: CylinderParams | null;
  aspect?: number | null;
}

/**
 * Welke geometrie geldt voor een plaatsing: eigen raster > eigen cilinder > raster van het vlak
 * (meeverschoven als de hoeken zijn aangepast) > de vierhoek. Server en browser gebruiken deze functie,
 * zodat de live weergave en de export altijd hetzelfde oppervlak vullen.
 */
export function resolveGeometry(surface: GeometrySource, placement: { quad: Quad | null; mesh?: Mesh | null; cylinder?: CylinderParams | null }): { quad: Quad; mesh: Mesh | null; cylinder: CylinderParams | null; aspect: number | null } {
  const quad = placement.quad ?? surface.quad;
  // De bekende verhouding van het vlak geldt zolang de plaatsing de hoeken en vorm van het vlak volgt.
  const aspect = !placement.quad && !placement.mesh && !placement.cylinder && !surface.mesh && !surface.cylinder ? surface.aspect ?? null : null;
  const cylinder = placement.cylinder ?? surface.cylinder ?? null;
  // Een eigen raster is een grof stuurraster; voor het renderen wordt het vloeiend verfijnd.
  if (placement.mesh && isValidMesh(placement.mesh)) return { quad, mesh: refineMesh(placement.mesh), cylinder, aspect };
  if (placement.cylinder) return { quad, mesh: cylinderMesh(quad, placement.cylinder), cylinder, aspect };
  if (surface.mesh && isValidMesh(surface.mesh)) {
    return { quad, mesh: placement.quad ? remapMesh(surface.mesh, surface.quad, placement.quad) : surface.mesh, cylinder, aspect };
  }
  return { quad, mesh: null, cylinder, aspect };
}

export function scaleMesh(m: Mesh, f: number): Mesh {
  return { ...m, points: m.points.map(([x, y]) => [x * f, y * f] as Point) };
}

/** Draait de parametrisering een kwartslag, net als rotateQuad: de nieuwe linkerbovenhoek is de oude rechterbovenhoek. */
export function rotateMesh(m: Mesh): Mesh {
  const cols = m.rows, rows = m.cols;
  const points: Point[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) points.push(meshPoint(m, m.cols - r, c));
  return { cols, rows, points };
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function splineRow(pts: Point[], sub: number): Point[] {
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(n - 1, i + 2)]!;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push(pts[n - 1]!);
  return out;
}

/**
 * Verfijnt een grof stuurraster met Catmull-Rom-splines (door alle stuurpunten), zodat het ontwerp
 * vloeiend buigt in plaats van in rechte stukken. Fijne rasters (zoals een cilinder) blijven zoals ze zijn.
 */
export function refineMesh(m: Mesh, target = 16): Mesh {
  if (m.cols >= 8 && m.rows >= 8) return m;
  const subC = m.cols >= 8 ? 1 : Math.max(1, Math.ceil(target / m.cols));
  const subR = m.rows >= 8 ? 1 : Math.max(1, Math.ceil(Math.min(target, 8) / m.rows));
  if (subC === 1 && subR === 1) return m;
  const rows = Array.from({ length: m.rows + 1 }, (_, r) => splineRow(Array.from({ length: m.cols + 1 }, (_, c) => meshPoint(m, c, r)), subC));
  const cols = m.cols * subC, outRows = m.rows * subR;
  const grid: Point[][] = Array.from({ length: outRows + 1 }, () => []);
  for (let c = 0; c <= cols; c++) {
    const col = splineRow(rows.map((row) => row[c]!), subR);
    col.forEach((p, r) => { grid[r]![c] = p; });
  }
  return { cols, rows: outRows, points: grid.flat() };
}

/** Grof stuurraster uit een (fijn) raster: een deelverzameling van de punten, zodat de vorm behouden blijft. */
export function controlMesh(m: Mesh, maxCols = 4, maxRows = 3): Mesh {
  const pick = (n: number, max: number) => {
    if (n <= max) return Array.from({ length: n + 1 }, (_, i) => i);
    const steps = Array.from({ length: max + 1 }, (_, i) => Math.round((i * n) / max));
    return [...new Set(steps)];
  };
  const cs = pick(m.cols, maxCols), rs = pick(m.rows, maxRows);
  return { cols: cs.length - 1, rows: rs.length - 1, points: rs.flatMap((r) => cs.map((c) => meshPoint(m, c, r))) };
}
