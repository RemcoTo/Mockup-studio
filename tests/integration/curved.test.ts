// Gebogen oppervlakken: een mok met een groen etiket wordt gedetecteerd als cilinder en het ontwerp
// volgt de ronding (smaller aan de zijkanten, boven- en onderrand gebogen).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderDemoScene } from '../../server/lib/generation/demo-scenes';
import { analyzeScene, render } from '../../server/lib/imaging/tasks';
import { cylinderMesh, meshPoint, resolveGeometry } from '../../shared/warp';

let dir = '';
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'ms-curved-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Ontwerp met tien even brede verticale banen in afwisselend zwart en wit. */
async function stripes(file: string) {
  const w = 1000, h = 600, buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.fill(Math.floor(x / 100) % 2 ? 255 : 0, (y * w + x) * 3, (y * w + x) * 3 + 3);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
}

describe('cilinderraster', () => {
  it('drukt kolommen aan de zijkanten samen en buigt de randen door', () => {
    const m = cylinderMesh([[0, 0], [100, 0], [100, 100], [0, 100]], { wrap: 120, bulge: 0.1 }, 8, 1);
    const xs = Array.from({ length: 9 }, (_, c) => meshPoint(m, c, 0)[0]);
    const widths = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(widths[0]!).toBeLessThan(widths[3]!);
    expect(meshPoint(m, 4, 0)[1]).toBeGreaterThan(meshPoint(m, 0, 0)[1]);
  });

  it('laat een aangepaste vierhoek het raster van het vlak meenemen', () => {
    const surface = { quad: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], mesh: cylinderMesh([[0, 0], [100, 0], [100, 100], [0, 100]], { wrap: 90, bulge: 0.1 }), cylinder: { wrap: 90, bulge: 0.1 } };
    const g = resolveGeometry(surface as never, { quad: [[10, 10], [110, 10], [110, 110], [10, 110]] });
    expect(g.mesh!.points[0]![0]).toBeCloseTo(10, 5);
  });
});

describe('mok met etiket', () => {
  it('detecteert het gebogen etiket en plaatst het ontwerp langs de ronding', async () => {
    const input = path.join(dir, 'mug.png');
    writeFileSync(input, await renderDemoScene('mug', { width: 1600, height: 1200, seed: 4, chroma: true }));
    const res = await analyzeScene({ inputPath: input, outDir: path.join(dir, 'out'), surfaceKind: 'rigid', multiDevice: false, detect: true, maxEdge: 4096, cylinder: { wrap: 110, bulge: 0.06 } });
    expect(res.surfaces).toHaveLength(1);
    const s = res.surfaces[0]!;
    expect(s.mesh).not.toBeNull();
    // Midden van de bovenrand ligt lager dan de hoeken (ellips van de cilinder).
    const mid = meshPoint(s.mesh!, 8, 0)[1], corner = meshPoint(s.mesh!, 0, 0)[1];
    expect(mid - corner).toBeGreaterThan(10);

    const design = path.join(dir, 'stripes.png');
    await stripes(design);
    const out = await render({
      scenePath: path.join(dir, 'out', res.sceneFile), sceneWidth: res.width, sceneHeight: res.height, width: res.width,
      placements: [{ quad: s.quad, mesh: s.mesh, cylinder: s.cylinder, design: { path: design, cacheKey: 'stripes', mime: 'image/png', width: 1000, height: 600 },
        transform: { fit: 'fill', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 }, background: '#ffffff',
        blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, maskPath: path.join(dir, 'out', s.maskFile), shadingPath: null }],
      output: { format: 'png', quality: 100 },
    });
    writeFileSync(path.join(dir, 'result.png'), out.buffer);
    if (process.env.KEEP_RENDER) writeFileSync(process.env.KEEP_RENDER, out.buffer);
    // Meet de breedte van de banen langs het midden: de buitenste moeten smaller zijn dan de middelste.
    const { data, info } = await sharp(Buffer.from(out.buffer)).raw().toBuffer({ resolveWithObject: true });
    const y = Math.round((meshPoint(s.mesh!, 8, 0)[1] + meshPoint(s.mesh!, 8, 2)[1]) / 2);
    const runs: number[] = [];
    let prev = -1, len = 0;
    for (let x = Math.ceil(s.quad[0][0]) + 2; x < Math.floor(s.quad[1][0]) - 2; x++) {
      const v = data[(y * info.width + x) * info.channels]! > 128 ? 1 : 0;
      if (v === prev) len++; else { if (prev >= 0) runs.push(len); prev = v; len = 1; }
    }
    runs.push(len);
    const inner = runs.slice(1, -1);
    expect(inner.length).toBeGreaterThanOrEqual(7);
    const middle = inner[Math.floor(inner.length / 2)]!;
    expect(inner[0]!).toBeLessThan(middle * 0.85);
    expect(inner[inner.length - 1]!).toBeLessThan(middle * 0.85);
  });
});

import { rotateMesh } from '../../shared/warp';
import { rotateQuad } from '../../shared/geometry';
describe('raster draaien', () => {
  it('draait dezelfde kant op als de vierhoek', () => {
    const q: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const m = cylinderMesh(q as never, { wrap: 90, bulge: 0.1 }, 4, 2);
    const r = rotateMesh(m);
    const rq = rotateQuad(q as never, 1);
    expect(meshPoint(r, 0, 0)).toEqual(meshPoint(m, m.cols, 0));
    expect(meshPoint(r, 0, 0)).toEqual(rq[0]);
    expect(r.cols).toBe(m.rows);
  });
});

import { controlMesh, refineMesh } from '../../shared/warp';
describe('stuurraster', () => {
  it('verfijnt vloeiend door alle stuurpunten en behoudt de hoeken', () => {
    const coarse = { cols: 2, rows: 1, points: [[0, 0], [50, 20], [100, 0], [0, 100], [50, 120], [100, 100]] as [number, number][] };
    const fine = refineMesh(coarse);
    expect(fine.cols).toBeGreaterThanOrEqual(16);
    expect(meshPoint(fine, 0, 0)).toEqual([0, 0]);
    expect(meshPoint(fine, fine.cols, fine.rows)).toEqual([100, 100]);
    // Het middelste stuurpunt ligt op de curve.
    expect(meshPoint(fine, fine.cols / 2, 0)[1]).toBeCloseTo(20, 5);
  });
  it('maakt van een fijn raster een grof stuurraster met dezelfde vorm', () => {
    const m = cylinderMesh([[0, 0], [100, 0], [100, 100], [0, 100]], { wrap: 120, bulge: 0.1 }, 16, 2);
    const c = controlMesh(m, 4, 3);
    expect([c.cols, c.rows]).toEqual([4, 2]);
    expect(meshPoint(c, 2, 0)).toEqual(meshPoint(m, 8, 0));
  });
});
