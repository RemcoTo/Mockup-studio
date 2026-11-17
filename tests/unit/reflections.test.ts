// Reflecties en lichtinval: na het plaatsen van een ontwerp mag er nergens fel groen overblijven, terwijl
// glimlicht en reflecties zichtbaar blijven en het ontwerp verder onaangetast is.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyH, homography, rectQuad, type Quad } from '../../shared/geometry';
import { DEFAULT_BLEND, DEFAULT_TRANSFORM } from '../../shared/types';
import { compositeOnto, panelColor, suppressSpill } from '../../server/lib/imaging/composite';
import { detectChromaSurfaces, shadingMap } from '../../server/lib/imaging/detect';
import { grayToPng, rgbaToSharp } from '../../server/lib/imaging/io';
import { renderRaw } from '../../server/lib/imaging/tasks';
import { createRGBA, type RGBA } from '../../server/lib/imaging/raster';
import { CHROMA, flat, grow, paint, type RGB } from '../helpers/scenes';

const W = 800, H = 600;
const DUMP = process.env.DUMP_SCENES;
const screen: Quad = [[200, 110], [600, 130], [590, 380], [210, 370]];
const toUV = homography(screen, rectQuad(1, 1));

/** Ontwerp: donkerblauw met een oranje blok, zodat reflecties en groen goed te meten zijn. */
function design(): RGBA {
  const d = createRGBA(400, 250);
  for (let y = 0; y < 250; y++) for (let x = 0; x < 400; x++) {
    const i = (y * 400 + x) * 4;
    const orange = x > 250 && y > 60 && y < 190;
    d.data.set(orange ? [235, 120, 30, 255] : [22, 34, 70, 255], i);
  }
  return d;
}

/** Een schuine lichtstreep over het scherm: wit licht opgeteld bij het groen (hoe een raam weerspiegelt). */
const streak = (u: number, v: number) => Math.abs(u - 0.35 - 0.5 * v) < 0.06;
const inStreakCore = (u: number, v: number) => Math.abs(u - 0.35 - 0.5 * v) < 0.03;

function screenScene(opts: { streak?: boolean; deskReflection?: boolean; bezelSpill?: boolean; gloss?: boolean } = {}): RGBA {
  const deskBase = (x: number, y: number): RGB => [92 - y * 0.02, 88 - y * 0.02, 84 - y * 0.02];
  // Glanzend bureau: onder het scherm een vage spiegeling van het groen.
  const desk = (x: number, y: number): RGB => {
    const c = deskBase(x, y);
    if (opts.deskReflection && y > 400 && y < 520 && x > 230 && x < 580) {
      const a = 0.32 * (1 - (y - 400) / 120);
      return [c[0] * (1 - a) + CHROMA[0] * a, c[1] * (1 - a) + CHROMA[1] * a, c[2] * (1 - a) + CHROMA[2] * a];
    }
    return c;
  };
  const bezel = (u: number, v: number, x: number, y: number): RGB => {
    // Groene zweem op de binnenrand van het kader (licht van het scherm).
    if (!opts.bezelSpill) return [26, 26, 28];
    const [su, sv] = applyH(toUV, x, y);
    const d = Math.max(-su, su - 1, -sv, sv - 1, 0) * 400;
    const a = Math.max(0, 0.35 * (1 - d / 10));
    return [26 * (1 - a) + CHROMA[0] * a, 26 * (1 - a) + CHROMA[1] * a, 28 * (1 - a) + CHROMA[2] * a];
  };
  const green = (u: number, v: number): RGB => {
    const k = 0.85 + 0.15 * (1 - v);
    let c: RGB = [CHROMA[0] * k, CHROMA[1] * k, CHROMA[2] * k];
    if (opts.streak && streak(u, v)) {
      const a = inStreakCore(u, v) ? 0.75 : 0.45;
      c = [c[0] + (250 - c[0]) * a, c[1] + (250 - c[1]) * a, c[2] + (250 - c[2]) * a];
    }
    if (opts.gloss) {
      // Glimlicht linksboven, zoals een lamp op glanzend materiaal.
      const g = Math.exp(-(((u - 0.2) / 0.08) ** 2 + ((v - 0.25) / 0.1) ** 2));
      c = [c[0] + (255 - c[0]) * g * 0.8, c[1] + (255 - c[1]) * g * 0.8, c[2] + (255 - c[2]) * g * 0.8];
    }
    return c;
  };
  return paint(W, H, desk, [{ quad: grow(screen, 14), color: bezel }, { quad: screen, color: green }], { noise: 3 });
}

async function place(scene: RGBA, opts: { reflections?: number } = {}) {
  const [s] = detectChromaSurfaces(scene);
  expect(s).toBeTruthy();
  const shading = shadingMap(scene, s!.mask, 'green');
  const out: RGBA = { width: W, height: H, data: new Uint8ClampedArray(scene.data) };
  const xs = s!.quad.map((p) => p[0]), ys = s!.quad.map((p) => p[1]);
  const panel = panelColor(scene, s!.mask, Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys)))!;
  const blend = { ...DEFAULT_BLEND.screen, gloss: 0, ...(opts.reflections !== undefined ? { reflections: opts.reflections } : {}) };
  compositeOnto(out, { quad: s!.quad, design: design(), transform: { ...DEFAULT_TRANSFORM, fit: 'fill' }, background: [255, 255, 255], blend, mask: s!.mask, shading });
  suppressSpill(out, [{ mask: s!.mask, panel, quad: s!.quad, tint: [60, 60, 80] }]);
  return out;
}

async function dump(name: string, img: RGBA) {
  if (!DUMP) return;
  mkdirSync(DUMP, { recursive: true });
  await rgbaToSharp(img).png().toFile(`${DUMP}/${name}.png`);
}

/** Grootste groene overmaat (G boven max(R,B)) in het hele beeld. */
function maxGreen(img: RGBA): { value: number; x: number; y: number } {
  let value = -Infinity, x = 0, y = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4, e = img.data[i + 1]! - Math.max(img.data[i]!, img.data[i + 2]!);
    if (e > value) { value = e; x = p % W; y = Math.floor(p / W); }
  }
  return { value, x, y };
}

/** Gemiddelde helderheid van het resultaat op een plek op het scherm (u,v). */
function lumaAt(img: RGBA, u: number, v: number) {
  const [x, y] = applyH(homography(rectQuad(1, 1), screen), u, v);
  let s = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = ((Math.round(y) + dy) * W + Math.round(x) + dx) * 4;
    s += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
  }
  return s / 25;
}

describe('reflecties en lichtinval', () => {
  it('laat geen groen achter in een schuine lichtstreep over het scherm, en houdt de streep zichtbaar', async () => {
    const scene = screenScene({ streak: true });
    const out = await place(scene);
    await dump('streep', out);
    expect(maxGreen(out).value).toBeLessThan(10);
    // In de streep is het ontwerp lichter dan ernaast (op hetzelfde donkerblauw).
    const inStreak = lumaAt(out, 0.35 + 0.5 * 0.25, 0.25), beside = lumaAt(out, 0.1, 0.25);
    expect(inStreak - beside).toBeGreaterThan(60);
    // Buiten de streep blijft het ontwerp zoals het is (donkerblauw, lichte schaduw toegestaan).
    expect(beside).toBeLessThan(45);
  });

  it('houdt glimlicht op een glanzend oppervlak als licht, niet als groene vlek', async () => {
    const scene = screenScene({ gloss: true });
    const out = await place(scene);
    await dump('glimlicht', out);
    expect(maxGreen(out).value).toBeLessThan(10);
    expect(lumaAt(out, 0.2, 0.25) - lumaAt(out, 0.1, 0.7)).toBeGreaterThan(80);
  });

  it('haalt het groen uit een spiegeling op een glanzend bureau en uit de rand van het kader', async () => {
    const scene = screenScene({ deskReflection: true, bezelSpill: true });
    const out = await place(scene);
    await dump('bureau-kader', out);
    const g = maxGreen(out);
    expect(g.value, `groen op ${g.x},${g.y}`).toBeLessThan(10);
    // De spiegeling krijgt de tint van het ontwerp: geen donker gat en geen groen.
    const at = (x: number, y: number) => { const i = (y * W + x) * 4; return (out.data[i]! + out.data[i + 1]! + out.data[i + 2]!) / 3; };
    expect(Math.abs(at(400, 420) - at(150, 420))).toBeLessThan(12);
    const i = (420 * W + 400) * 4;
    expect(out.data[i + 2]!).toBeGreaterThanOrEqual(out.data[i + 1]! - 2); // blauwig ontwerp: blauw ≥ groen
  });

  it('kan reflecties uitzetten: dan blijft alleen het ontwerp met schaduw', async () => {
    const scene = screenScene({ streak: true });
    const out = await place(scene, { reflections: 0 });
    expect(maxGreen(out).value).toBeLessThan(10);
    expect(Math.abs(lumaAt(out, 0.35 + 0.5 * 0.25, 0.25) - lumaAt(out, 0.1, 0.25))).toBeLessThan(15);
  });

  it('laat het ontwerp buiten reflecties ongewijzigd', async () => {
    const scene = screenScene();
    const out = await place(scene);
    const [x, y] = applyH(homography(rectQuad(1, 1), screen), 0.8, 0.5);
    const i = (Math.round(y) * W + Math.round(x)) * 4;
    // Oranje blok: schermen krijgen weinig schaduw, dus de kleur blijft vrijwel gelijk.
    expect(Math.abs(out.data[i]! - 235)).toBeLessThan(30);
    expect(Math.abs(out.data[i + 1]! - 120)).toBeLessThan(20);
    expect(Math.abs(out.data[i + 2]! - 30)).toBeLessThan(15);
  });

  it('geeft geen gekleurde zoom langs een smal kader in een verkleinde weergave (zoals in de editor)', async () => {
    // Telefoon met een kader van 6 px op een licht bureau; verkleind tot een derde is het kader 2 px breed.
    const phone: Quad = [[300, 200], [520, 240], [470, 640], [250, 600]];
    const scene = paint(W, H, () => [196, 176, 150], [{ quad: grow(phone, 6), color: flat([30, 30, 32]) }, { quad: phone, color: flat(CHROMA) }]);
    const [s] = detectChromaSurfaces(scene);
    const dir = mkdtempSync(path.join(tmpdir(), 'ms-zoom-'));
    await rgbaToSharp(scene).png().toFile(path.join(dir, 'scene.png'));
    writeFileSync(path.join(dir, 'mask.png'), await grayToPng(s!.mask));
    writeFileSync(path.join(dir, 'shading.png'), await grayToPng(shadingMap(scene, s!.mask, 'green')));
    for (const width of [W / 3, W / 2, W]) {
      const out = await renderRaw({
        scenePath: path.join(dir, 'scene.png'), sceneWidth: W, sceneHeight: H, width,
        placements: [{ quad: s!.quad, mesh: null, cylinder: null, design: null, transform: DEFAULT_TRANSFORM, background: '#f0f0f0', blend: { ...DEFAULT_BLEND.screen }, maskPath: path.join(dir, 'mask.png'), shadingPath: path.join(dir, 'shading.png') }],
        output: { format: 'png', quality: 90 },
      });
      let worstPink = 0, worstGreen = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        worstPink = Math.max(worstPink, Math.min(out.data[i]!, out.data[i + 2]!) - out.data[i + 1]!);
        worstGreen = Math.max(worstGreen, out.data[i + 1]! - Math.max(out.data[i]!, out.data[i + 2]!));
      }
      expect(worstPink, `paars bij breedte ${width}`).toBeLessThan(14);
      expect(worstGreen, `groen bij breedte ${width}`).toBeLessThan(10);
    }
  });
});
