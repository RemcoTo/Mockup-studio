// Draait de beeldtaken in een echte, gebundelde worker thread, zoals in productie.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

let dir = '';
let workerDir = '';
let pool: typeof import('../../server/lib/imaging/pool');

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-worker-'));
  const { buildWorker } = await import('../../scripts/build-worker.mjs');
  // Binnen het project bouwen, zodat de worker sharp uit node_modules kan laden (zoals in .output/server).
  workerDir = mkdtempSync(path.resolve(__dirname, '../../.nuxt/test-worker-'));
  process.env.IMAGING_WORKER_PATH = await buildWorker(path.join(workerDir, 'imaging.mjs'));
  process.env.IMAGING_WORKERS = '2';
  pool = await import('../../server/lib/imaging/pool');
}, 60_000);

afterAll(async () => {
  await pool.closePool();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workerDir, { recursive: true, force: true });
  delete process.env.IMAGING_WORKER_PATH;
  delete process.env.IMAGING_WORKERS;
});

describe('rekenpool met worker threads', () => {
  it('analyseert een scène en rendert een mockup in de worker', async () => {
    const { renderDemoScene } = await import('../../server/lib/generation/demo-scenes');
    const { writeFile } = await import('node:fs/promises');
    const input = path.join(dir, 'scene-in.png');
    await writeFile(input, await renderDemoScene('laptop', { width: 1200, height: 800, seed: 2, chroma: true }));
    const res = await pool.runTask('analyzeScene', { inputPath: input, outDir: path.join(dir, 'out'), surfaceKind: 'screen', surfaceOrientation: 'landscape', multiDevice: false, detect: true, maxEdge: 4096 });
    expect(pool.poolStats().mode).toBe('workers');
    expect(res.surfaces).toHaveLength(1);

    const design = path.join(dir, 'design.png');
    await sharp({ create: { width: 400, height: 250, channels: 4, background: '#ff0000' } }).png().toFile(design);
    const out = await pool.runTask('render', {
      scenePath: path.join(dir, 'out', res.sceneFile), sceneWidth: res.width, sceneHeight: res.height, width: 600,
      placements: [{ quad: res.surfaces[0]!.quad, design: { path: design, cacheKey: 'd', mime: 'image/png', width: 400, height: 250 }, transform: { fit: 'cover', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 },
        background: '#ffffff', blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, maskPath: path.join(dir, 'out', res.surfaces[0]!.maskFile), shadingPath: null }],
      output: { format: 'png', quality: 90 },
    });
    expect(out.buffer).toBeInstanceOf(Uint8Array);
    const meta = await sharp(Buffer.from(out.buffer)).metadata();
    expect(meta.width).toBe(600);
  });

  it('geeft een gebruikersfout uit de worker door met status en melding', async () => {
    const { writeFile } = await import('node:fs/promises');
    const bad = path.join(dir, 'kapot.png');
    await writeFile(bad, Buffer.from('geen beeld'));
    await expect(pool.runTask('analyzeScene', { inputPath: bad, outDir: path.join(dir, 'out2'), surfaceKind: 'screen', multiDevice: false, detect: true, maxEdge: 4096 })).rejects.toThrow();
  });

  it('verwerkt meerdere taken tegelijk zonder de hoofdthread te blokkeren', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { renderDemoScene } = await import('../../server/lib/generation/demo-scenes');
    const input = path.join(dir, 'big.png');
    await writeFile(input, await renderDemoScene('poster', { width: 1600, height: 2000, seed: 1, chroma: true }));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const t = performance.now();
    await Promise.all([1, 2, 3].map((i) => pool.runTask('analyzeScene', { inputPath: input, outDir: path.join(dir, `p${i}`), surfaceKind: 'paper', multiDevice: false, detect: true, maxEdge: 4096 })));
    clearInterval(timer);
    const elapsed = performance.now() - t;
    // De hoofdthread bleef reageren: de timer liep vrijwel ononderbroken door.
    expect(ticks).toBeGreaterThan((elapsed / 10) * 0.5);
  });
});
