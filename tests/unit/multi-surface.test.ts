// Meerdere groene vlakken in één beeld: elk vlak apart herkennen, ook als ze elkaar raken of overlappen,
// met de juiste hoeken per vlak en een masker dat elke pixel aan precies één vlak geeft.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Quad } from '../../shared/geometry';
import { detectChromaSurfaces, type DetectedSurface } from '../../server/lib/imaging/detect';
import { loadRGBA, rgbaToSharp } from '../../server/lib/imaging/io';
import type { RGBA } from '../../server/lib/imaging/raster';
import { CHROMA, bestMatch, desk, flat, grow, lit, paint, type Layer, type RGB } from '../helpers/scenes';

const W = 800, H = 600;
const DUMP = process.env.DUMP_SCENES;

async function dump(name: string, img: RGBA, found: DetectedSurface[]) {
  if (!DUMP) return;
  mkdirSync(DUMP, { recursive: true });
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const colors: RGB[] = [[255, 40, 40], [40, 120, 255], [255, 200, 0], [200, 0, 255]];
  found.forEach((f, k) => {
    const c = colors[k % colors.length]!;
    for (let p = 0; p < W * H; p++) {
      const m = f.mask.data[p]! / 255;
      if (m <= 0) continue;
      for (let ch = 0; ch < 3; ch++) out.data[p * 4 + ch] = out.data[p * 4 + ch]! * (1 - 0.45 * m) + c[ch]! * 0.45 * m;
    }
    for (let e = 0; e < 4; e++) {
      const a = f.quad[e]!, b = f.quad[(e + 1) % 4]!;
      for (let t = 0; t <= 1; t += 0.002) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
        if (x >= 0 && y >= 0 && x < W && y < H) { const i = (y * W + x) * 4; out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; }
      }
    }
  });
  await rgbaToSharp(out).png().toFile(`${DUMP}/${name}.png`);
}

const at = (f: DetectedSurface, x: number, y: number) => f.mask.data[Math.round(y) * W + Math.round(x)]!;

function expectSurfaces(found: DetectedSurface[], expected: Quad[], tol = 4) {
  expect(found).toHaveLength(expected.length);
  for (const q of expected) {
    const { error } = bestMatch(found, q);
    expect(error, `hoeken wijken ${error.toFixed(1)} px af`).toBeLessThan(tol);
  }
}

/** Geen pixel mag voor meer dan één vlak volledig meetellen. */
function expectExclusive(found: DetectedSurface[]) {
  let both = 0;
  for (let p = 0; p < W * H; p++) {
    let sum = 0;
    for (const f of found) sum += f.mask.data[p]!;
    if (sum > 255 + 40) both++;
  }
  expect(both).toBeLessThan(40);
}

// Achterste telefoon iets gedraaid, voorste telefoon overlapt de rechteronderhoek.
const back: Quad = [[180, 90], [400, 120], [370, 470], [150, 440]];
const front: Quad = [[330, 210], [560, 190], [590, 540], [355, 560]];

describe('meerdere groene vlakken', () => {
  it('splitst twee overlappende vlakken zonder zichtbare naad en geeft de overlap aan het voorste vlak', async () => {
    const img = paint(W, H, desk, [{ quad: back, color: flat(CHROMA) }, { quad: front, color: flat(CHROMA) }]);
    const found = detectChromaSurfaces(img);
    await dump('overlap-naadloos', img, found);
    expectSurfaces(found, [back, front]);
    expectExclusive(found);
    const f = bestMatch(found, front).item!, b = bestMatch(found, back).item!;
    // Midden van de overlap hoort bij het voorste vlak.
    expect(at(f, 365, 320)).toBeGreaterThan(200);
    expect(at(b, 365, 320)).toBeLessThan(60);
  });

  it('splitst twee overlappende telefoons met een dun kader ertussen', async () => {
    const bezel: RGB = [28, 28, 30];
    const img = paint(W, H, desk, [
      { quad: grow(back, 5), color: flat(bezel) }, { quad: back, color: lit(CHROMA, (u) => 1 - 0.15 * u) },
      { quad: grow(front, 3), color: flat(bezel) }, { quad: front, color: lit(CHROMA, (u, v) => 0.95 - 0.1 * v) },
    ], { noise: 6 });
    const found = detectChromaSurfaces(img);
    await dump('overlap-kader', img, found);
    expect(found).toHaveLength(2);
    expect(bestMatch(found, front).error).toBeLessThan(4);
    // Het achterste vlak is deels afgedekt; de zichtbare hoeken moeten kloppen.
    const b = bestMatch(found, back);
    expect(Math.hypot(b.item!.quad[0][0] - back[0][0], b.item!.quad[0][1] - back[0][1])).toBeLessThan(4);
    expect(Math.hypot(b.item!.quad[3][0] - back[3][0], b.item!.quad[3][1] - back[3][1])).toBeLessThan(4);
    expectExclusive(found);
  });

  it('blijft splitsen na JPEG-compressie', async () => {
    const bezel: RGB = [28, 28, 30];
    const img = paint(W, H, desk, [
      { quad: grow(back, 5), color: flat(bezel) }, { quad: back, color: flat(CHROMA) },
      { quad: grow(front, 3), color: flat(bezel) }, { quad: front, color: flat(CHROMA) },
    ], { noise: 8 });
    const jpg = await sharp(Buffer.from(img.data.buffer), { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 70 }).toBuffer();
    const found = detectChromaSurfaces(await loadRGBA(jpg));
    expect(found).toHaveLength(2);
    expect(bestMatch(found, front).error).toBeLessThan(4);
  });

  it('splitst een waaier van drie telefoons met een smal kader', async () => {
    // Zonder kader is van de middelste telefoon alleen de bovenrand te zien en is het vlak niet te bepalen;
    // echte telefoons hebben altijd een kader.
    const a: Quad = [[120, 160], [300, 120], [350, 470], [170, 510]];
    const b: Quad = [[260, 110], [450, 100], [460, 460], [270, 470]];
    const c: Quad = [[410, 130], [590, 170], [540, 520], [360, 480]];
    const bezel: RGB = [30, 30, 33];
    const img = paint(W, H, desk, [
      { quad: grow(a, 3), color: flat(bezel) }, { quad: a, color: lit(CHROMA, (u) => 0.9 + 0.1 * u) },
      { quad: grow(b, 3), color: flat(bezel) }, { quad: b, color: flat(CHROMA) },
      { quad: grow(c, 3), color: flat(bezel) }, { quad: c, color: lit(CHROMA, (u, v) => 1 - 0.12 * v) },
    ], { noise: 6 });
    const found = detectChromaSurfaces(img);
    await dump('waaier', img, found);
    expect(found).toHaveLength(3);
    expect(bestMatch(found, c).error).toBeLessThan(4);
    // Linker telefoon: de linkerhoeken zijn zichtbaar.
    const fa = bestMatch(found, a).item!;
    expect(Math.hypot(fa.quad[0][0] - a[0][0], fa.quad[0][1] - a[0][1])).toBeLessThan(4);
    expect(Math.hypot(fa.quad[3][0] - a[3][0], fa.quad[3][1] - a[3][1])).toBeLessThan(4);
    expectExclusive(found);
  });

  it('vindt het achterste vlak ook als het voorste een hele zijde afdekt', async () => {
    const back2: Quad = [[200, 120], [520, 140], [510, 420], [190, 400]];
    const front2: Quad = [[420, 80], [640, 100], [630, 500], [410, 480]];
    const img = paint(W, H, desk, [{ quad: back2, color: flat(CHROMA) }, { quad: grow(front2, 3), color: flat([25, 25, 28]) }, { quad: front2, color: flat(CHROMA) }]);
    const found = detectChromaSurfaces(img);
    await dump('zijde-afgedekt', img, found);
    expect(found).toHaveLength(2);
    expect(bestMatch(found, front2).error).toBeLessThan(4);
    // Van het achterste vlak zijn alleen de linkerhoeken zichtbaar; die moeten kloppen.
    const b = found.find((f) => f !== bestMatch(found, front2).item)!;
    expect(Math.hypot(b.quad[0][0] - back2[0][0], b.quad[0][1] - back2[0][1])).toBeLessThan(4);
    expect(Math.hypot(b.quad[3][0] - back2[3][0], b.quad[3][1] - back2[3][1])).toBeLessThan(4);
    expectExclusive(found);
  });

  it('ziet de voor- en zijkant van een doos als twee vlakken, ook bij een klein lichtverschil', async () => {
    const faceA: Quad = [[220, 180], [430, 220], [430, 470], [220, 420]];
    const faceB: Quad = [[430, 220], [600, 170], [600, 410], [430, 470]];
    for (const [name, la, lb] of [['doos-licht', 1, 0.72], ['doos-subtiel', 1, 0.93]] as const) {
      const img = paint(W, H, desk, [{ quad: faceA, color: lit(CHROMA, () => la) }, { quad: faceB, color: lit(CHROMA, () => lb) }]);
      const found = detectChromaSurfaces(img);
      await dump(name, img, found);
      expectSurfaces(found, [faceA, faceB]);
      expectExclusive(found);
    }
  });

  it('herkent drie vlakken met elk een eigen perspectief', async () => {
    const q1: Quad = [[60, 120], [250, 100], [260, 300], [70, 330]];
    const q2: Quad = [[320, 80], [520, 140], [500, 360], [300, 300]];
    const q3: Quad = [[480, 330], [760, 300], [740, 520], [520, 560]];
    const img = paint(W, H, desk, [
      { quad: q1, color: lit(CHROMA, (u) => 0.8 + 0.2 * u) }, { quad: q2, color: lit(CHROMA, (u, v) => 1 - 0.2 * v) }, { quad: q3, color: flat(CHROMA) },
    ], { noise: 8 });
    const found = detectChromaSurfaces(img);
    await dump('drie-vlakken', img, found);
    expectSurfaces(found, [q1, q2, q3]);
    expectExclusive(found);
  });

  it('houdt een deels afgedekt vlak heel, ook als het voorwerp rechte randen heeft', async () => {
    const screen: Quad = [[150, 100], [650, 130], [640, 460], [140, 430]];
    const phone: Quad = [[480, 300], [700, 280], [720, 580], [500, 590]];
    const img = paint(W, H, desk, [{ quad: screen, color: flat(CHROMA) }, { quad: phone, color: flat([30, 30, 34]) }]);
    const found = detectChromaSurfaces(img);
    await dump('afgedekt-recht', img, found);
    expectSurfaces(found, [screen]);
    // Het voorwerp hoort niet bij het masker.
    expect(at(found[0]!, 560, 400)).toBe(0);
  });

  it('houdt een deels afgedekt vlak heel bij een rond voorwerp ervoor', async () => {
    const screen: Quad = [[150, 100], [650, 130], [640, 460], [140, 430]];
    const cup: Layer = { inside: (x, y) => Math.hypot(x - 560, y - 420) < 110, color: flat([200, 190, 180]) };
    const img = paint(W, H, desk, [{ quad: screen, color: lit(CHROMA, (u) => 1 - 0.2 * u) }, cup]);
    const found = detectChromaSurfaces(img);
    await dump('afgedekt-rond', img, found);
    expectSurfaces(found, [screen]);
  });

  it('splitst een vlak niet op een harde schaduwlijn', async () => {
    const screen: Quad = [[150, 100], [650, 130], [640, 460], [140, 430]];
    const img = paint(W, H, desk, [{ quad: screen, color: (u, v) => { const k = u + 0.3 * v > 0.62 ? 0.62 : 1; return [CHROMA[0] * k, CHROMA[1] * k, CHROMA[2] * k]; } }]);
    const found = detectChromaSurfaces(img);
    await dump('schaduwlijn', img, found);
    expectSurfaces(found, [screen]);
  });
});
