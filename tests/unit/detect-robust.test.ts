// Detectie onder omstandigheden die echte modeluitvoer heeft: ruis, JPEG-compressie, licht dat over het
// vlak verloopt, een glimlicht op het scherm, en groen dat naar geel of blauwgroen neigt.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyH, homography, rectQuad, type Quad } from '../../shared/geometry';
import { detectChromaSurfaces } from '../../server/lib/imaging/detect';
import { loadRGBA } from '../../server/lib/imaging/io';
import { createRGBA, type RGBA } from '../../server/lib/imaging/raster';

const quad: Quad = [[160, 110], [500, 135], [490, 380], [150, 355]];
const W = 640, H = 480;

function scene(opts: { green?: [number, number, number]; gradient?: number; glare?: boolean; noise?: number } = {}): RGBA {
  const img = createRGBA(W, H);
  const toSurf = homography(quad, rectQuad(1, 1));
  const [gr, gg, gb] = opts.green ?? [20, 220, 40];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [u, v] = applyH(toSurf, x + 0.5, y + 0.5);
    let c: [number, number, number] = [118, 112, 104];
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const f = 1 - (opts.gradient ?? 0) * u; // licht valt van links in
      c = [gr * f, gg * f, gb * f];
      if (opts.glare && (u - 0.62) ** 2 / 0.02 + (v - 0.35) ** 2 / 0.01 < 1) c = [235, 245, 238];
    }
    const n = opts.noise ?? 0;
    img.data[i] = c[0] + rnd() * n; img.data[i + 1] = c[1] + rnd() * n; img.data[i + 2] = c[2] + rnd() * n; img.data[i + 3] = 255;
  }
  return img;
}

function expectCorners(found: ReturnType<typeof detectChromaSurfaces>, tol = 3) {
  expect(found).toHaveLength(1);
  found[0]!.quad.forEach((p, i) => {
    expect(Math.abs(p[0] - quad[i]![0])).toBeLessThan(tol);
    expect(Math.abs(p[1] - quad[i]![1])).toBeLessThan(tol);
  });
}

describe('robuuste detectie', () => {
  it('met ruis', () => expectCorners(detectChromaSurfaces(scene({ noise: 30 }))));

  it('na JPEG-compressie', async () => {
    const s = scene({ noise: 10 });
    const jpg = await sharp(Buffer.from(s.data.buffer), { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 65 }).toBuffer();
    expectCorners(detectChromaSurfaces(await loadRGBA(jpg)));
  });

  it('met licht dat over het vlak verloopt tot donkergroen', () => expectCorners(detectChromaSurfaces(scene({ gradient: 0.72 }))));

  it('met groen dat naar geel neigt', () => expectCorners(detectChromaSurfaces(scene({ green: [130, 215, 45] }))));

  it('met groen dat naar blauwgroen neigt', () => expectCorners(detectChromaSurfaces(scene({ green: [25, 200, 145] }))));

  it('vult een glimlicht in het scherm op in het masker', () => {
    const found = detectChromaSurfaces(scene({ glare: true }));
    expectCorners(found);
    // Midden van het glimlicht: hoort bij het vlak, het ontwerp moet daar ook komen.
    const toScene = homography(rectQuad(1, 1), quad);
    const [gx, gy] = applyH(toScene, 0.62, 0.35);
    expect(found[0]!.mask.data[Math.round(gy) * W + Math.round(gx)]).toBeGreaterThan(200);
  });

  it('ziet groen gras of een plant niet als vlak als het geen vierhoek is', () => {
    const img = createRGBA(W, H);
    img.data.fill(120);
    // Onregelmatige groene vlek (zoals een plant): wordt een vlak, maar met een lage kwaliteitsscore.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 320, y - 240), a = Math.atan2(y - 240, x - 320);
      if (r < 110 + 40 * Math.sin(a * 7)) { const i = (y * W + x) * 4; img.data[i] = 40; img.data[i + 1] = 160; img.data[i + 2] = 50; }
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    const found = detectChromaSurfaces(img);
    expect(found.every((f) => f.quality < 0.8)).toBe(true);
  });
});
