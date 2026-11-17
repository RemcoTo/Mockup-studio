// Echte 3D-devices: model laden, scherm vinden, origineel ontwerp pixel-exact en perspectiefcorrect op het scherm,
// camerahoek en openingshoek aanpassen, hoge resolutie, en het device op een achtergrond zonder die achtergrond
// zelf te veranderen. Rendert met Three.js in headless Chromium, zoals de server dat doet.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyH, homography } from '../../shared/geometry';
import { applyCameraPreset, clampDeviceSpec, defaultDeviceSpec, DEVICE_MODELS, statusBarFraction, type Device3DSpec } from '../../shared/device3d/spec';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { closeDeviceRenderer, modelsDir, renderDevice } from '../../server/lib/device3d/render';
import { createScene3d, flatBackground, rerenderScene3d } from '../../server/lib/device3d/scenes';
import { loadRGBA } from '../../server/lib/imaging/io';
import type { RGBA } from '../../server/lib/imaging/raster';
import { createMockup, renderImage, renderSpec } from '../../server/lib/mockups';
import { renderScrollFrames } from '../../server/lib/imaging/tasks';
import { previewGeneration, sceneColorProblem, startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { buildPrompt } from '../../server/lib/generation/prompt';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import type { SceneConfig } from '../../shared/types';
import { generations, mockups } from '../../server/lib/repositories';
import { workspaces } from '../../server/lib/repo-accounts';
import { projects, scenes } from '../../server/lib/repositories';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
// @ts-expect-error -- JavaScript-buildscript zonder types
import { buildRenderPage } from '../../scripts/build-devices.mjs';

const chromium = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => p && existsSync(p));
let dir = '';
let WS = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-3d-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', chromiumPath: chromium ?? '' });
  WS = workspaces.create('3D-bureau').id;
  await buildRenderPage(path.resolve('.nuxt/device3d/render-page.js'));
  startQueue(150);
}, 120_000);
afterAll(async () => { stopQueue(); await closeDeviceRenderer(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

const px = (img: RGBA, x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]; };
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Achtergrond zoals een AI-omgeving: wand met lichtval, tafelblad, wat structuur. */
async function background(w: number, h: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>` +
    `<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e3da"/><stop offset="1" stop-color="#d4c9bc"/></linearGradient>` +
    `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98f66"/><stop offset="1" stop-color="#8a6243"/></linearGradient>` +
    `<radialGradient id="l" cx="0.2" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#w)"/><rect y="${h * 0.5}" width="${w}" height="${h * 0.5}" fill="url(#t)"/><rect width="${w}" height="${h}" fill="url(#l)"/>` +
    `<rect x="${w * 0.06}" y="${h * 0.12}" width="${w * 0.1}" height="${h * 0.3}" fill="#6d7d63"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Ontwerp in de schermverhouding van de laptop: vier vlakken in eigen kleuren en een dunne lijn. */
const QUAD_COLORS = [[214, 40, 40], [40, 120, 214], [250, 196, 30], [30, 160, 90]];
const BORDER = [24, 24, 28];
async function design(projectId: string, aspect = 1512 / 982) {
  const W = aspect >= 1 ? 1512 : Math.round(1400 * aspect), H = aspect >= 1 ? Math.round(1512 / aspect) : 1400;
  // Rand van 2% van de breedte (links en rechts) en 2% van de hoogte (boven en onder): bij een verkeerde verhouding
  // snijdt passend vullen hem aan twee kanten weg.
  const bx = W * 0.02, by = H * 0.02, iw = W - bx * 2, ih = H - by * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="rgb(${BORDER})"/>` +
    `<rect x="${bx}" y="${by}" width="${iw / 2}" height="${ih / 2}" fill="rgb(${QUAD_COLORS[0]})"/><rect x="${bx + iw / 2}" y="${by}" width="${iw / 2}" height="${ih / 2}" fill="rgb(${QUAD_COLORS[1]})"/>` +
    `<rect x="${bx}" y="${by + ih / 2}" width="${iw / 2}" height="${ih / 2}" fill="rgb(${QUAD_COLORS[2]})"/><rect x="${bx + iw / 2}" y="${by + ih / 2}" width="${iw / 2}" height="${ih / 2}" fill="rgb(${QUAD_COLORS[3]})"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return (await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'ontwerp.png', buffer: buf }))[0]!;
}

/** Controleert dat het ontwerp onvervormd en perspectiefcorrect op het scherm staat: elk kwadrant op zijn plek. */
/** Zonder statusbalk: het ontwerp vult het hele scherm (voor de metingen op de schermverhouding). */
const noBar = (s: Device3DSpec): Device3DSpec => ({ ...s, statusBar: { ...s.statusBar, show: false } });

async function expectDesignOnScreen(mockupBuffer: Buffer, quad: [number, number][]) {
  const img = await loadRGBA(mockupBuffer);
  const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad as never);
  const at = (u: number, v: number) => px(img, ...applyH(H, u, v));
  // Middens van de vier kwadranten, en punten vlak bij de hoeken van het scherm.
  const pts: [number, number, number][] = [[0.25, 0.25, 0], [0.75, 0.25, 1], [0.25, 0.75, 2], [0.75, 0.75, 3], [0.06, 0.08, 0], [0.94, 0.08, 1], [0.06, 0.92, 2], [0.94, 0.92, 3], [0.47, 0.47, 0], [0.53, 0.53, 3]];
  for (const [u, v, k] of pts) expect(dist(at(u, v), QUAD_COLORS[k]!), `${u},${v}`).toBeLessThanOrEqual(6);
  // De rand van 2% staat aan alle vier kanten: geen uitrekking, geen bijsnijding.
  for (const [u, v] of [[0.5, 0.008], [0.5, 0.992], [0.007, 0.5], [0.993, 0.5]] as const) expect(dist(at(u, v), BORDER), `rand ${u},${v}`).toBeLessThanOrEqual(10);
  // Net binnen de rand begint het ontwerp zelf.
  for (const [u, v, k] of [[0.3, 0.04, 0], [0.7, 0.96, 3], [0.035, 0.3, 0], [0.965, 0.7, 3]] as const) expect(dist(at(u, v), QUAD_COLORS[k]!), `binnen ${u},${v}`).toBeLessThanOrEqual(8);
}

describe('3D-devices: renderen', () => {
  it('heeft voor elk model een GLB in de modellenmap of meldt dat het ontbreekt', () => {
    const dirM = modelsDir();
    for (const m of DEVICE_MODELS) expect(existsSync(path.join(dirM, m.file)), m.file).toBe(true);
    for (const m of DEVICE_MODELS) expect(m.license).toMatch(/Eigen model/);
  });

  it('laadt het laptopmodel, vindt het scherm en laat de achtergrond buiten device en schaduw ongemoeid', async () => {
    const bg = await background(1200, 800);
    const r = await renderDevice({ spec: defaultDeviceSpec('laptop-14', 'perspective'), background: bg });
    expect(r.width).toBe(1200);
    expect(r.facing).toBe(true);
    expect(r.visible).toBe(1);
    // De schermhoeken vormen een bolle vierhoek midden in beeld; de verhouding past bij een laptopscherm.
    const [tl, tr, br, bl] = r.quad;
    expect(tl[0]).toBeLessThan(tr[0]); expect(bl[0]).toBeLessThan(br[0]); expect(tl[1]).toBeLessThan(bl[1]); expect(tr[1]).toBeLessThan(br[1]);
    // Masker: wit binnen het scherm, zwart erbuiten.
    const mask = await sharp(r.mask).raw().toBuffer({ resolveWithObject: true });
    const m = (x: number, y: number) => mask.data[(Math.round(y) * mask.info.width + Math.round(x)) * mask.info.channels]!;
    const c = [(tl[0] + tr[0] + br[0] + bl[0]) / 4, (tl[1] + tr[1] + br[1] + bl[1]) / 4];
    expect(m(c[0]!, c[1]!)).toBe(255);
    expect(m(20, 20)).toBe(0);
    // Achtergrond: ver van het device exact gelijk aan het origineel.
    const before = await loadRGBA(bg), after = await loadRGBA(r.image);
    for (const [x, y] of [[10, 10], [1190, 10], [600, 30], [10, 790], [1190, 790], [100, 300]] as const) expect(px(after, x, y)).toEqual(px(before, x, y));
    // Het device is er wel: in het midden van het scherm staat het groene schermvlak.
    const g = px(after, c[0]!, c[1]!);
    expect(g[1]!).toBeGreaterThan(g[0]! + 80);
  }, 120_000);

  it('verandert met camerahoek, draaiing en openingshoek, en houdt het scherm in verhouding', async () => {
    const bg = await background(1200, 800);
    const base = defaultDeviceSpec('laptop-14', 'front');
    const front = await renderDevice({ spec: base, background: bg });
    const top = await renderDevice({ spec: applyCameraPreset(base, 'three-quarter'), background: bg });
    const wide = await renderDevice({ spec: { ...base, lidAngle: 135 }, background: bg });
    const width = (q: [number, number][]) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    const height = (q: [number, number][]) => Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
    // Recht van voren: het scherm staat recht en heeft (bij 110 graden openen) een iets kortere hoogte dan echt.
    expect(Math.abs(front.quad[0][1] - front.quad[1][1])).toBeLessThan(2);
    const ratio = width(front.quad as never) / height(front.quad as never);
    expect(ratio).toBeGreaterThan(1.54);
    expect(ratio).toBeLessThan(1.75);
    // Driekwart: de verre kant van het scherm is korter (perspectief).
    expect(height([top.quad[1], top.quad[0], top.quad[3], top.quad[2]] as never)).not.toBeCloseTo(height(top.quad as never), 0);
    // Verder open: van voren gezien wordt het scherm korter.
    expect(height(wide.quad as never)).toBeLessThan(height(front.quad as never) - 5);
  }, 180_000);

  it('rendert op hoge resolutie', async () => {
    const r = await renderDevice({ spec: defaultDeviceSpec('laptop-14', 'perspective'), background: await background(3840, 2560) });
    expect([r.width, r.height]).toEqual([3840, 2560]);
    const meta = await sharp(r.image).metadata();
    expect([meta.width, meta.height]).toEqual([3840, 2560]);
    // Het scherm is groot genoeg voor een scherp ontwerp.
    expect(Math.hypot(r.quad[1][0] - r.quad[0][0], r.quad[1][1] - r.quad[0][1])).toBeGreaterThan(900);
  }, 240_000);
});

describe('3D-devices: scène en mockup', () => {
  it('zet het originele ontwerp onvervormd en perspectiefcorrect op het scherm, ook na een andere camerahoek', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D' });
    const a = await design(p.id);
    const scene = await createScene3d({
      workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: 'Laptop 3D', category: 'devices', objectType: 'laptop',
      spec: noBar(defaultDeviceSpec('laptop-14', 'perspective')), background: await background(1600, 1066),
    });
    expect(scene.device3d?.spec.model).toBe('laptop-14');
    expect(scene.surfaces).toHaveLength(1);
    expect(scene.surfaces[0]!.detection).toBe('3d');
    expect(await storage.exists(scene.device3d!.background)).toBe(true);
    const m = createMockup({ projectId: p.id, sceneId: scene.id, assetId: a.id });
    const flat = { placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const }, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } })) };
    await expectDesignOnScreen((await renderImage(flat, scene, { width: scene.width, output: { format: 'png' } })).buffer, scene.surfaces[0]!.quad);

    // Andere camerahoek: zelfde scène, nieuwe render; het ontwerp staat weer exact.
    const moved = await rerenderScene3d(scene.id, applyCameraPreset(scene.device3d!.spec, 'three-quarter'));
    expect(moved.surfaces[0]!.quad).not.toEqual(scene.surfaces[0]!.quad);
    expect(moved.file).not.toBe(scene.file);
    expect(await storage.exists(scene.file)).toBe(false);
    await expectDesignOnScreen((await renderImage(flat, moved, { width: moved.width, output: { format: 'png' } })).buffer, moved.surfaces[0]!.quad);
    // Met de standaard menginstellingen (reflecties van het glas) blijft de tint van het ontwerp.
    const lit = await loadRGBA((await renderImage({ placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const } })) }, moved, { width: moved.width, output: { format: 'png' } })).buffer);
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], moved.surfaces[0]!.quad as never);
    const c = px(lit, ...applyH(H, 0.25, 0.75));
    expect(c[0]!).toBeGreaterThan(c[2]! + 120); // geel blijft geel
    expect(scenes.get(scene.id)!.device3d!.spec.camera.elevation).toBe(30);
  }, 240_000);

  it('houdt de schermverhouding exact, ook recht van voren en van boven (evenwijdige randen)', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D-frontaal' });
    const a = await design(p.id);
    for (const preset of ['front', 'top']) {
      const scene = await createScene3d({
        workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: preset, category: 'devices', objectType: 'laptop',
        spec: noBar(applyCameraPreset(defaultDeviceSpec('laptop-14'), preset)), background: await background(1200, 800),
      });
      expect(scene.surfaces[0]!.aspect).toBeCloseTo(302.5 / 196.5, 4);
      const m = createMockup({ projectId: p.id, sceneId: scene.id, assetId: a.id });
      const flat = { placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const }, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } })) };
      await expectDesignOnScreen((await renderImage(flat, scene, { width: scene.width, output: { format: 'png' } })).buffer, scene.surfaces[0]!.quad);
    }
  }, 240_000);

  it('telefoon, tablet en monitor: model laden, scherm in de echte verhouding, ontwerp exact (ook van boven)', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D-alle' });
    for (const model of DEVICE_MODELS.filter((m) => m.id !== 'laptop-14')) {
      const aspect = model.screenMM[0] / model.screenMM[1];
      const a = await design(p.id, aspect);
      for (const preset of ['three-quarter', 'top']) {
        if (preset === 'top' && model.id === 'monitor-27') continue; // een monitor op een voet fotografeer je niet van boven
        const spec = noBar(applyCameraPreset(defaultDeviceSpec(model.id), preset));
        expect(spec.pose).toBe(preset === 'top' ? (model.poses.includes('flat') ? 'flat' : model.defaultPose) : model.defaultPose);
        const scene = await createScene3d({
          workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: `${model.id} ${preset}`, category: 'devices', objectType: model.objectType,
          spec, background: await background(1200, 800),
        });
        expect(scene.surfaces, `${model.id} ${preset}: scherm zichtbaar`).toHaveLength(1);
        expect(scene.surfaces[0]!.aspect).toBeCloseTo(aspect, 4);
        const m = createMockup({ projectId: p.id, sceneId: scene.id, assetId: a.id });
        const flat = { placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const }, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } })) };
        await expectDesignOnScreen((await renderImage(flat, scene, { width: scene.width, output: { format: 'png' } })).buffer, scene.surfaces[0]!.quad);
      }
    }
  }, 600_000);

  it('statusbalk: boven het ontwerp, nooit eroverheen; ontwerp exact in de ruimte eronder, op alle vier de devices', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D-statusbalk' });
    for (const model of DEVICE_MODELS) {
      const spec = defaultDeviceSpec(model.id, 'front');
      expect(spec.statusBar.show).toBe(true);
      const t = statusBarFraction(spec);
      // Het ontwerp in de verhouding van de ruimte onder de balk: dan past het exact, met de rand aan vier kanten.
      const full = model.screenMM[0] / model.screenMM[1];
      const a = await design(p.id, full / (1 - t));
      const scene = await createScene3d({
        workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: `${model.id} balk`, category: 'devices', objectType: model.objectType,
        spec, background: await background(1500, 1000),
      });
      expect(scene.device3d!.screen!.aspect).toBeCloseTo(full, 4);
      expect(scene.surfaces[0]!.aspect).toBeCloseTo(full / (1 - t), 4);
      const m = createMockup({ projectId: p.id, sceneId: scene.id, assetId: a.id });
      const flat = { placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const }, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } })) };
      const buf = (await renderImage(flat, scene, { width: scene.width, output: { format: 'png' } })).buffer;
      await expectDesignOnScreen(buf, scene.surfaces[0]!.quad);
      // De balk: in de kleur van de bovenrand van het ontwerp (hier de donkere rand), met lichte tekst en iconen.
      const img = await loadRGBA(buf);
      const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], scene.device3d!.screen!.quad as never);
      let bg = 0, light = 0, n = 0;
      for (let u = 0.05; u < 0.95; u += 0.004) for (const v of [t * 0.35, t * 0.5, t * 0.6, t * 0.7]) {
        const c = px(img, ...applyH(H, u, v)); n++;
        if (dist(c, BORDER) < 22) bg++;
        if (c[0]! + c[1]! + c[2]! > BORDER[0]! + BORDER[1]! + BORDER[2]! + 120) light++; // duidelijk lichter dan de balk
      }
      expect(bg / n, `${model.id}: balk in de kleur van het ontwerp`).toBeGreaterThan(0.6);
      expect(light, `${model.id}: tijd en iconen zichtbaar`).toBeGreaterThan(4);
    }
  }, 600_000);

  it('statusbalk aan of uit, tijd of kleur: zonder nieuwe 3D-render; oude scènes zonder balk blijven gelijk', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D-balk-snel' });
    const spec = defaultDeviceSpec('phone-6', 'three-quarter');
    const scene = await createScene3d({ workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: 'tel', category: 'devices', objectType: 'smartphone', spec, background: await background(1200, 800) });
    const off = await rerenderScene3d(scene.id, { ...spec, statusBar: { ...spec.statusBar, show: false, time: '10:08' } });
    expect(off.file).toBe(scene.file); // geen nieuwe render
    expect(off.surfaces[0]!.quad).toEqual(scene.device3d!.screen!.quad);
    expect(off.device3d!.spec.statusBar).toMatchObject({ show: false, time: '10:08' });
    const on = await rerenderScene3d(scene.id, { ...spec, statusBar: { ...spec.statusBar, tone: 'dark' } });
    expect(on.file).toBe(scene.file);
    expect(on.surfaces[0]!.quad).toEqual(scene.surfaces[0]!.quad);
    // Een scène van vóór de statusbalk (spec zonder balk): clamp zet hem uit, dus niets verandert.
    const legacy = clampDeviceSpec({ ...spec, statusBar: undefined } as unknown as Device3DSpec);
    expect(legacy.statusBar.show).toBe(false);
    expect(legacy.roll).toBe(0);
    expect(legacy.offset).toEqual({ x: 0, y: 0, z: 0 });
  }, 240_000);

  it('scrollvideo met statusbalk: de pagina scrolt onder de balk, de balk staat stil', async () => {
    const p = projects.create({ workspaceId: WS, name: '3D-video' });
    const w = 600, h = 2400;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${Array.from({ length: 12 }, (_, i) => `<rect y="${i * 200}" width="${w}" height="200" fill="${i % 2 ? '#1e1f22' : '#e8e4dc'}"/>`).join('')}</svg>`;
    const [page] = await ingestUpload({ projectId: p.id, workspaceId: WS, kind: 'design', filename: 'lang.png', buffer: await sharp(Buffer.from(svg)).png().toBuffer() });
    const scene = await createScene3d({ workspaceId: WS, projectId: p.id, origin: 'generated', inLibrary: false, title: 'tel', category: 'devices', objectType: 'smartphone', spec: { ...defaultDeviceSpec('phone-6', 'front'), camera: { elevation: 8, fov: 26, size: 1.1 } }, background: await background(900, 600) });
    const m = createMockup({ projectId: p.id, sceneId: scene.id, assetId: page!.id });
    const spec = await renderSpec(m, scene, { width: scene.width, output: { format: 'jpg', quality: 90 } });
    expect(spec.placements[0]!.statusBar?.kind).toBe('phone');
    const out = mkdtempSync(path.join(tmpdir(), 'ms-3dvid-'));
    const r = await renderScrollFrames({ render: spec, animate: 0, outDir: out, fps: 4, duration: 3, hold: 0.5, from: 0, to: 12 });
    const first = await loadRGBA(path.join(out, 'frame-00000.jpg'));
    const last = await loadRGBA(path.join(out, `frame-${String(r.frames - 1).padStart(5, '0')}.jpg`));
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], scene.device3d!.screen!.quad as never);
    const t = statusBarFraction(scene.device3d!.spec);
    // Balk gelijk, ontwerp verschoven.
    const mid = await loadRGBA(path.join(out, `frame-${String(Math.floor(r.frames / 2)).padStart(5, '0')}.jpg`));
    let barDiff = 0, n = 0, changed = 0, m2 = 0;
    for (let u = 0.05; u < 0.95; u += 0.01) {
      barDiff += dist(px(first, ...applyH(H, u, t * 0.5)), px(last, ...applyH(H, u, t * 0.5))); n++;
    }
    for (let v = t + 0.05; v < 0.95; v += 0.01) for (const other of [mid, last]) { m2++; if (dist(px(first, ...applyH(H, 0.5, v)), px(other, ...applyH(H, 0.5, v))) > 60) changed++; }
    expect(barDiff / n).toBeLessThan(12);
    expect(changed / m2).toBeGreaterThan(0.2); // de pagina is verschoven
    rmSync(out, { recursive: true, force: true });
  }, 240_000);

  it('positie, rotatie en meten: zweven, opzij, naar de camera en de rolhoek veranderen het beeld zoals verwacht', async () => {
    const base = defaultDeviceSpec('tablet-11', 'front');
    const bg = await background(1200, 800);
    const quadOf = async (s: Device3DSpec) => (await renderDevice({ spec: s, background: bg })).quad;
    const center = (q: [number, number][]) => [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4];
    const width = (q: [number, number][]) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    const q0 = await quadOf(base);
    const up = await quadOf({ ...base, offset: { x: 0, y: 0.05, z: 0 } });
    expect(center(up)[1]).toBeLessThan(center(q0)[1] - 20); // zweeft: hoger in beeld
    const right = await quadOf({ ...base, offset: { x: 0.05, y: 0, z: 0 } });
    expect(center(right)[0]).toBeGreaterThan(center(q0)[0] + 20);
    const near = await quadOf({ ...base, offset: { x: 0, y: 0, z: 0.1 } });
    expect(width(near)).toBeGreaterThan(width(q0) * 1.08); // dichterbij: groter
    const rolled = await quadOf({ ...base, roll: 15 });
    const angle = (q: [number, number][]) => Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180 / Math.PI;
    expect(Math.abs(angle(rolled) - angle(q0))).toBeGreaterThan(10); // bovenrand helt
    expect(Math.abs(angle(q0))).toBeLessThan(1.5);
  }, 240_000);

  it('maakt een effen of verlopende achtergrond exact, zonder AI', async () => {
    const solid = await loadRGBA(await flatBackground({ mode: 'solid', color: '#e8e1d5' }, 300, 200));
    expect(px(solid, 150, 100)).toEqual([232, 225, 213]);
    const grad = await loadRGBA(await flatBackground({ mode: 'gradient', color: '#f1ece4', color2: '#1e2a4a', stops: ['#f1ece4', '#1e2a4a'], direction: 'vertical' }, 300, 200));
    expect(px(grad, 150, 0)).toEqual([241, 236, 228]);
    expect(px(grad, 150, 199)).toEqual([30, 42, 74]);
  });
});

describe('3D-devices: genereren', () => {
  const cfgBase: SceneConfig = { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', palette: { colors: [] } };

  it('laat de AI alleen de omgeving maken, met dezelfde camera en een lege plek', () => {
    const spec = applyCameraPreset(defaultDeviceSpec('laptop-14'), 'three-quarter');
    const p = buildPrompt({ ...cfgBase, sceneType: 'studio', ground: 'oak', device3d: spec }, { hasReferences: false });
    expect(p).toMatch(/^A .* of an empty set/);
    expect(p).toMatch(/Leave a clear, empty area on the tabletop where an open laptop will be placed \(about 31 by 22 cm\)/);
    expect(p).toMatch(/there is no laptop, computer, monitor, tablet, phone, screen or other electronic device anywhere/);
    expect(p).toMatch(/Composition: photographed from the front and slightly to the side, camera about 30 degrees above the tabletop, with a 50mm lens/);
    expect(p).toMatch(/The surface where the product will stand is .*oak/);
    expect(p).not.toMatch(/chroma-key green|Target surface/);
    // Zonder 3D: de bekende prompt met groen schermvlak.
    expect(buildPrompt(cfgBase, { hasReferences: false })).toMatch(/chroma-key green/);
  });

  it('genereert een omgeving met de testprovider en rendert het device erop', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Gen 3D' });
    const a = await design(p.id);
    const g = startGeneration({ projectId: p.id, assetId: a.id, config: { ...cfgBase, sceneType: 'studio', device3d: noBar(defaultDeviceSpec('laptop-14')) }, count: 1 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status, done.error ?? '').toBe('done');
    const scene = scenes.get(done.sceneIds[0]!)!;
    expect(scene.device3d?.spec.model).toBe('laptop-14');
    expect(scene.surfaces[0]!.detection).toBe('3d');
    expect(scene.license).toMatch(/Eigen model/);
    // De achtergrond is alleen omgeving: geen groen schermvlak.
    const bg = await loadRGBA(await storage.read(scene.device3d!.background));
    let green = 0;
    for (let i = 0; i < bg.data.length; i += 4 * 97) if (bg.data[i + 1]! > bg.data[i]! + 60 && bg.data[i + 1]! > bg.data[i + 2]! + 60) green++;
    expect(green).toBe(0);
    const m = mockups.get(done.mockupIds[0]!)!;
    const flat = { placements: m.placements.map((pl) => ({ ...pl, transform: { ...pl.transform, fit: 'cover' as const }, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } })) };
    await expectDesignOnScreen((await renderImage(flat, scene, { width: scene.width, output: { format: 'png' } })).buffer, scene.surfaces[0]!.quad);
  }, 300_000);

  it('maakt een device op een effen achtergrond zonder AI en zonder kosten, met een ander standpunt per variant', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Effen 3D' });
    const cfg: SceneConfig = { ...cfgBase, device3d: defaultDeviceSpec('laptop-14'), backdrop: { mode: 'solid', color: '#e8e1d5', texture: 'none', shadow: 'soft' }, palette: { colors: [{ hex: '#e8e1d5', role: 'background' }] } };
    const prev = previewGeneration(cfg, 3);
    expect(prev.cost.usd).toBe(0);
    expect(prev.credits).toBe(0);
    expect(prev.provider.id).toBe('local-3d');
    expect(prev.prompt).toMatch(/Geen AI-beeld nodig/);
    const g = startGeneration({ projectId: p.id, assetId: null, config: cfg, count: 3 });
    expect(g.costUsd).toBe(0);
    expect(g.credits).toBe(0);
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status, done.error ?? '').toBe('done');
    const all = done.sceneIds.map((id) => scenes.get(id)!);
    expect(new Set(all.map((s) => s.device3d!.spec.camera.elevation)).size).toBe(3);
    for (const s of all) {
      const img = await loadRGBA(await storage.read(s.file));
      expect(px(img, 4, 4)).toEqual([232, 225, 213]);
      expect(px(img, img.width - 5, 4)).toEqual([232, 225, 213]);
    }
  }, 400_000);

  it('laat groen in de scène toe bij een 3D-device (de studio zoekt geen groen vlak)', () => {
    const green = { ...cfgBase, palette: { colors: [{ hex: '#243b32', role: 'ground' as const }], background: 'ai' as const } };
    expect(sceneColorProblem(green)).toMatch(/groene vlak/);
    expect(sceneColorProblem({ ...green, device3d: defaultDeviceSpec('laptop-14') })).toBeNull();
  });
});
