import { describe, expect, it } from 'vitest';
import { applyH, homography, rectQuad, type Quad } from '../../shared/geometry';
import { compositeOnto, surroundFill } from '../../server/lib/imaging/composite';
import { detectChromaSurfaces, quadMask, shadingMap } from '../../server/lib/imaging/detect';
import { createRGBA, type RGBA } from '../../server/lib/imaging/raster';
import { DEFAULT_TRANSFORM } from '../../shared/types';

/** Tekent een scène: grijze achtergrond, groen vlak in perspectief met verloop, rood voorwerp ervoor. */
function syntheticScene(quad: Quad, occluder = true): RGBA {
  const w = 640, h = 480;
  const img = createRGBA(w, h);
  const toSurf = homography(quad, rectQuad(1, 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [u, v] = applyH(toSurf, x + 0.5, y + 0.5);
      const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      if (inside) {
        const shade = 170 + 70 * (1 - v); // licht van boven
        img.data[i] = 10; img.data[i + 1] = shade; img.data[i + 2] = 14;
      } else {
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 128;
      }
      if (occluder && (x - 500) ** 2 + (y - 360) ** 2 < 45 ** 2) { img.data[i] = 200; img.data[i + 1] = 40; img.data[i + 2] = 40; }
      img.data[i + 3] = 255;
    }
  return img;
}

const quad: Quad = [[140, 90], [520, 120], [505, 400], [120, 365]];

describe('chroma-detectie', () => {
  it('vindt de vier hoeken van een groen vlak tot op twee pixels nauwkeurig', () => {
    const found = detectChromaSurfaces(syntheticScene(quad, false));
    expect(found).toHaveLength(1);
    found[0]!.quad.forEach((p, i) => {
      expect(Math.abs(p[0] - quad[i]![0])).toBeLessThan(2);
      expect(Math.abs(p[1] - quad[i]![1])).toBeLessThan(2);
    });
  });

  it('houdt de hoeken correct als een voorwerp een deel afdekt, en maskeert dat voorwerp', () => {
    const scene = syntheticScene(quad, true);
    const [s] = detectChromaSurfaces(scene);
    expect(s).toBeDefined();
    s!.quad.forEach((p, i) => {
      expect(Math.abs(p[0] - quad[i]![0])).toBeLessThan(3);
      expect(Math.abs(p[1] - quad[i]![1])).toBeLessThan(3);
    });
    // Midden van het rode voorwerp valt binnen de vierhoek maar buiten het masker.
    expect(s!.mask.data[360 * 640 + 500]).toBe(0);
    expect(s!.mask.data[240 * 640 + 320]).toBeGreaterThan(200);
    expect(s!.fill).toBeLessThan(0.99);
  });

  it('vindt niets in een beeld zonder groen vlak', () => {
    const img = createRGBA(200, 200);
    img.data.fill(128);
    expect(detectChromaSurfaces(img)).toHaveLength(0);
  });

  it('maakt een schaduwkaart die het verloop van het vlak volgt', () => {
    const scene = syntheticScene(quad, false);
    const [s] = detectChromaSurfaces(scene);
    const map = shadingMap(scene, s!.mask, 'green');
    const top = map.data[130 * 640 + 320]!;
    const bottom = map.data[350 * 640 + 320]!;
    expect(top).toBeGreaterThan(bottom);
    expect(map.data[10 * 640 + 10]).toBe(128);
  });
});

describe('plaatsing van het ontwerp', () => {
  it('zet elke pixel van het ontwerp exact op de verwachte plek, zonder de kleuren te veranderen', () => {
    const scene = syntheticScene(quad, false);
    // Ontwerp: vier gekleurde kwadranten.
    const design = createRGBA(200, 100);
    const colors = [[255, 0, 0], [0, 0, 255], [255, 255, 0], [0, 0, 0]];
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 200; x++) {
        const c = colors[(y < 50 ? 0 : 2) + (x < 100 ? 0 : 1)]!;
        const i = (y * 200 + x) * 4;
        design.data.set([c[0]!, c[1]!, c[2]!, 255], i);
      }
    const [s] = detectChromaSurfaces(scene);
    compositeOnto(scene, {
      quad: s!.quad, design, transform: { ...DEFAULT_TRANSFORM, fit: 'fill' }, background: [255, 255, 255],
      blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, mask: s!.mask, shading: null,
    });
    const H = homography(rectQuad(1, 1), s!.quad);
    const probe = (u: number, v: number) => {
      const [x, y] = applyH(H, u, v);
      const i = (Math.floor(y) * 640 + Math.floor(x)) * 4;
      return [scene.data[i], scene.data[i + 1], scene.data[i + 2]];
    };
    expect(probe(0.25, 0.25)).toEqual([255, 0, 0]);
    expect(probe(0.75, 0.25)).toEqual([0, 0, 255]);
    expect(probe(0.25, 0.75)).toEqual([255, 255, 0]);
    expect(probe(0.75, 0.75)).toEqual([0, 0, 0]);
    // Geen groen meer binnen het vlak.
    for (let y = 100; y < 380; y += 7)
      for (let x = 130; x < 515; x += 7) {
        const i = (y * 640 + x) * 4;
        expect(scene.data[i + 1]! - Math.max(scene.data[i]!, scene.data[i + 2]!)).toBeLessThan(40);
      }
  });

  it('laat voorwerpen voor het vlak zichtbaar via het masker', () => {
    const scene = syntheticScene(quad, true);
    const [s] = detectChromaSurfaces(scene);
    const design = createRGBA(10, 10);
    design.data.fill(255);
    compositeOnto(scene, {
      quad: s!.quad, design, transform: DEFAULT_TRANSFORM, background: [255, 255, 255],
      blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, mask: s!.mask, shading: null,
    });
    const i = (360 * 640 + 500) * 4;
    expect([scene.data[i], scene.data[i + 1], scene.data[i + 2]]).toEqual([200, 40, 40]);
  });

  it('maakt een handmatig masker voor een vierhoek', () => {
    const m = quadMask(100, 100, [[10, 10], [90, 10], [90, 90], [10, 90]]);
    expect(m.data[50 * 100 + 50]).toBe(255);
    expect(m.data[5 * 100 + 5]).toBe(0);
  });

  it('ontmengt randpixels zodat er geen donkere of groene zoom langs het vlak blijft', () => {
    const W = 200, H = 200, bg = 236, G = [20, 190, 30];
    const scene = createRGBA(W, H);
    const mask = { width: W, height: H, data: new Uint8Array(W * H) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const inside = x >= 50 && x < 150 && y >= 50 && y < 150;
        const edge = inside && (x === 50 || x === 149 || y === 50 || y === 149);
        const m = edge ? 0.5 : inside ? 1 : 0;
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) scene.data[i + c] = Math.round(m * G[c]! + (1 - m) * bg);
        scene.data[i + 3] = 255;
        mask.data[y * W + x] = Math.round(m * 255);
      }
    const design = createRGBA(4, 4);
    design.data.fill(236);
    compositeOnto(scene, {
      quad: [[51, 51], [149, 51], [149, 149], [51, 149]], design, transform: { ...DEFAULT_TRANSFORM, fit: 'fill' }, background: [236, 236, 236],
      blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, mask, shading: null,
    });
    for (const [x, y] of [[50, 100], [149, 100], [100, 50], [100, 149]] as const) {
      const i = (y * W + x) * 4;
      const [r, g, b] = [scene.data[i]!, scene.data[i + 1]!, scene.data[i + 2]!];
      expect(Math.min(r, g, b)).toBeGreaterThan(200);
      expect(g - Math.max(r, b)).toBeLessThan(8);
    }
  });

  it('vult een printvlak naadloos op met het verloop van het object eromheen', () => {
    const W = 200, H = 160;
    const scene = createRGBA(W, H);
    const mask = { width: W, height: H, data: new Uint8Array(W * H) };
    const shade = (x: number) => 150 + Math.round((x / W) * 90); // horizontaal verloop, zoals een mok
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inside = x >= 60 && x < 140 && y >= 40 && y < 120;
        scene.data.set(inside ? [30, 200, 40, 255] : [shade(x), shade(x), shade(x), 255], i);
        if (inside) mask.data[y * W + x] = 255;
      }
    const fill = surroundFill(scene, mask, 50, 30, 150, 130);
    const at = (x: number, y: number) => fill[((y - 30) * 101 + (x - 50)) * 3]!;
    for (const x of [62, 100, 138]) expect(Math.abs(at(x, 80) - shade(x))).toBeLessThan(6);
    // Volledige compositie zonder ontwerp: geen zichtbare rechthoek meer.
    compositeOnto(scene, {
      quad: [[60, 40], [140, 40], [140, 120], [60, 120]], design: null, transform: DEFAULT_TRANSFORM, background: 'auto',
      blend: { shading: 0, displacement: 0, gloss: 0, opacity: 1 }, mask, shading: null,
    });
    for (const x of [61, 100, 139]) {
      const i = (80 * W + x) * 4;
      expect(Math.abs(scene.data[i]! - shade(x))).toBeLessThan(6);
      expect(Math.abs(scene.data[i + 1]! - scene.data[i]!)).toBeLessThan(3);
    }
  });
});
