// Scèneopties, merkkleur, platte achtergrond en het automatisch opslaan van gegenereerde scènes.
// Alles met de testprovider (geen kosten); de testscènes volgen de configuratie zoals een beeldmodel dat zou doen.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeColor, isChromaLike, normalizeHex, parseHex } from '../../shared/color';
import { SCENE_PRESETS, presetMatches, type Backdrop } from '../../shared/scene-style';
import type { SceneConfig } from '../../shared/types';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { demoLook, renderDemoScene } from '../../server/lib/generation/demo-scenes';
import { previewGeneration, sceneColorProblem, startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { buildPrompt } from '../../server/lib/generation/prompt';
import { backdropColorAt, makeFlatBackdrop } from '../../server/lib/imaging/backdrop';
import { loadRGBA } from '../../server/lib/imaging/io';
import type { RGBA } from '../../server/lib/imaging/raster';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { createMockup, renderImage } from '../../server/lib/mockups';
import { workspaces } from '../../server/lib/repo-accounts';
import { generations, mockups, projects, scenes } from '../../server/lib/repositories';
import { deleteScene } from '../../server/lib/scenes';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
import { parse, sceneConfigSchema } from '../../server/lib/validation';

let dir = '';
let WS = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-style-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  WS = workspaces.create('Stijlbureau').id;
  startQueue(150);
});
afterAll(() => {
  stopQueue();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const base: SceneConfig = { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', avoid: ['text'] };
const px = (img: RGBA, x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]; };
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('kleuren', () => {
  it('leest en normaliseert HEX-codes', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#1E2A4A')).toBe('#1e2a4a');
    expect(normalizeHex('blauw')).toBeNull();
    expect(parseHex('#b4644a')).toEqual([180, 100, 74]);
  });

  it('beschrijft een kleur in woorden voor het model', () => {
    expect(describeColor('#1e2a4a')).toMatch(/blue/);
    expect(describeColor('#ffffff')).toMatch(/white/);
    expect(describeColor('#b4644a')).toMatch(/orange|brown/);
    expect(describeColor('#e8e2d9')).toMatch(/off-white|beige|grey/);
  });

  it('herkent kleuren die botsen met het groene ontwerpvlak', () => {
    for (const c of ['#00ff00', '#2e7d32', '#7ed957', '#1fae8e']) expect(isChromaLike(c), c).toBe(true);
    for (const c of ['#1e2a4a', '#b4644a', '#e8e2d9', '#2f3b33', '#ffffff', '#000000', '#c9a227']) expect(isChromaLike(c), c).toBe(false);
  });
});

describe('configuratie en prompt', () => {
  it('controleert de nieuwe velden', () => {
    // Een configuratie van vóór het palet: de merkkleur wordt omgezet naar kleuren met elk hun toepassing.
    const ok = parse(sceneConfigSchema, { ...base, sceneType: 'editorial', props: 'brand', ground: 'travertine', brandColor: 'B4644A', brandColorUse: ['background', 'light'], backdrop: null });
    expect(ok.palette).toEqual({ colors: [{ hex: '#b4644a', role: 'background' }, { hex: '#b4644a', role: 'light' }], background: 'ai' });
    expect('brandColor' in ok).toBe(false);
    expect(() => parse(sceneConfigSchema, { ...base, brandColor: 'rood' })).toThrow(/HEX/);
    expect(() => parse(sceneConfigSchema, { ...base, sceneType: 'ruimteschip' })).toThrow();
    expect(() => parse(sceneConfigSchema, { ...base, backdrop: { mode: 'gradient', color: '#fff', color2: 'x' } })).toThrow(/HEX/);
    const flat = parse(sceneConfigSchema, { ...base, backdrop: { mode: 'gradient', color: '#FFF', color2: '#123456', direction: 'radial', texture: 'grain', shadow: 'none' } });
    expect(flat.backdrop).toEqual({ mode: 'gradient', color: '#ffffff', color2: '#123456', stops: ['#ffffff', '#123456'], direction: 'radial', texture: 'grain', shadow: 'none' });
    expect(flat.palette).toEqual({ colors: [{ hex: '#ffffff', role: 'gradient' }, { hex: '#123456', role: 'gradient' }], gradient: { direction: 'radial' } });
  });

  it('neemt scènetype, ondergrond, props en merkkleur op, en houdt de merkkleur van het vlak af', () => {
    const p = buildPrompt({ ...base, sceneType: 'editorial', ground: 'travertine', props: 'brand', brandColor: '#b4644a', brandColorUse: ['background', 'light'] }, { hasReferences: false });
    expect(p).toMatch(/editorial set/);
    expect(p).toMatch(/travertine/);
    expect(p).toMatch(/props that fit the world of the brand/);
    expect(p).toMatch(/Brand color palette/);
    expect(p).toMatch(/Background color \(a fixed brand color, not a suggestion\): the background wall or backdrop behind the product is exactly #b4644a/);
    expect(p).toMatch(/Lighting color: .*accent light in .*#b4644a/);
    expect(p).not.toMatch(/Ground:/);
    expect(p).toMatch(/none of these colors may appear on the target surface/);
    expect(p).toMatch(/chroma-key green/);

    const none = buildPrompt({ ...base, props: 'none' }, { hasReferences: false });
    expect(none).toMatch(/No props or decorative objects/);
    expect(none).toMatch(/Do not include:.*decorative props/);
  });

  it('vraagt bij een platte achtergrond een sleutelscherm in plaats van een ruimte', () => {
    const solid = buildPrompt({ ...base, environment: 'luxury', sceneType: 'interior', ground: 'oak', brandColor: '#b4644a', backdrop: { mode: 'solid', color: '#e8e2d9', shadow: 'soft' } }, { hasReferences: false });
    expect(solid).toMatch(/chroma-key magenta \(#FF00FF\) studio sweep/);
    expect(solid).toMatch(/no horizon line/);
    expect(solid).toMatch(/soft, natural contact shadow/);
    expect(solid).toMatch(/no magenta reflections/);
    // Geen ruimte, ondergrond of merkkleur in de omgeving: de achtergrond komt van de studio.
    expect(solid).not.toMatch(/luxury interior|oak|real, tidy contemporary interior|Brand color/);
    expect(solid).toMatch(/magenta/);
    const none = buildPrompt({ ...base, backdrop: { mode: 'gradient', color: '#f1ece4', color2: '#c9d3dd', direction: 'horizontal', shadow: 'none' } }, { hasReferences: false });
    expect(none).toMatch(/almost no visible shadow/);
  });

  it('weigert vooraf een merkkleur of achtergrond die op het groene vlak lijkt', () => {
    expect(sceneColorProblem({ ...base, brandColor: '#2e7d32' })).toMatch(/lijkt te veel op het groene vlak/);
    expect(sceneColorProblem({ ...base, brandColor: '#2e7d32', surfaceMethod: 'blank' })).toBeNull();
    expect(sceneColorProblem({ ...base, backdrop: { mode: 'gradient', color: '#ffffff', color2: '#33cc66' } })).toMatch(/#33cc66/);
    expect(sceneColorProblem({ ...base, brandColor: '#1e2a4a' })).toBeNull();
    expect(previewGeneration({ ...base, brandColor: '#00ff00' }, 1).problem).toMatch(/groene vlak/);
    const p = projects.create({ workspaceId: WS, name: 'Groen' });
    expect(() => startGeneration({ projectId: p.id, assetId: null, config: { ...base, brandColor: '#00ff00' }, count: 1 })).toThrow(/groene vlak/);
    expect(generations.list({ projectId: p.id })).toHaveLength(0);
  });

  it('presets zetten een complete look en zijn daarna te herkennen', () => {
    for (const p of SCENE_PRESETS) {
      const cfg = { ...base, ...JSON.parse(JSON.stringify(p.config)) } as SceneConfig;
      expect(presetMatches(p, cfg), p.id).toBe(true);
      expect(() => parse(sceneConfigSchema, cfg), p.id).not.toThrow();
      expect(sceneColorProblem(cfg), p.id).toBeNull();
      // Elke preset levert een andere prompt op.
      expect(buildPrompt(cfg, { hasReferences: false }).length).toBeGreaterThan(200);
    }
    // Scènepresets leveren elk een eigen prompt op. De twee platte presets vragen het model hetzelfde sleutelscherm;
    // hun verschil (effen of verloop) zet de studio er na het genereren in.
    const scenePresets = SCENE_PRESETS.filter((p) => !p.config.backdrop);
    const prompts = new Set(scenePresets.map((p) => buildPrompt({ ...base, ...JSON.parse(JSON.stringify(p.config)) }, { hasReferences: false })));
    expect(prompts.size).toBe(scenePresets.length);
    const flats = SCENE_PRESETS.filter((p) => p.config.backdrop).map((p) => p.config.backdrop!.mode);
    expect(flats).toEqual(['solid', 'gradient']);
  });
});

/** Testscène met platte achtergrond zoals een model hem maakt (kleur bewust iets ernaast), en het resultaat. */
async function flatCase(objectType: string, b: Backdrop, w = 1200, h = 800) {
  const look = demoLook({ ...base, objectType, backdrop: b });
  const input = await renderDemoScene(objectType, { width: w, height: h, seed: 7, chroma: true, look });
  const before = await loadRGBA(input);
  const { image, coverage } = await makeFlatBackdrop(input, b, 3);
  return { before, after: image, coverage };
}

describe('platte achtergrond', () => {
  it('zet een effen achtergrond exact op de HEX-kleur en laat object en ontwerpvlak ongemoeid', async () => {
    const { before, after, coverage } = await flatCase('mug', { mode: 'solid', color: '#b4644a', shadow: 'soft' });
    expect(coverage).toBeGreaterThan(0.6);
    // Rand en hoeken: precies de gekozen kleur (het model zat er zichtbaar naast).
    expect(near(px(before, 10, 10), [180, 100, 74], 6)).toBe(false);
    for (const [x, y] of [[5, 5], [1190, 5], [5, 790], [1190, 790], [600, 20], [100, 400], [1100, 400]]) expect(px(after, x!, y!), `${x},${y}`).toEqual([180, 100, 74]);
    // Elke groene pixel (het ontwerpvlak) en de mok zelf zijn byte voor byte gelijk gebleven.
    let green = 0, changedGreen = 0, body = 0, changedBody = 0;
    for (let y = 0; y < 800; y += 2)
      for (let x = 0; x < 1200; x += 2) {
        const a = px(before, x, y), b2 = px(after, x, y);
        if (a[1]! > a[0]! + 40 && a[1]! > a[2]! + 40) { green++; if (a.join() !== b2.join()) changedGreen++; }
      }
    for (let y = 230; y < 430; y += 3) for (let x = 400; x < 500; x += 3) { body++; if (px(before, x, y).join() !== px(after, x, y).join()) changedBody++; }
    expect(green).toBeGreaterThan(5000);
    expect(changedGreen).toBe(0);
    expect(changedBody).toBe(0);
    // De contactschaduw onder de mok blijft: donkerder dan de achtergrond, in dezelfde tint.
    const shadow = px(after, 470, 625);
    expect(shadow[0]!).toBeLessThan(170);
    expect(Math.abs(shadow[0]! / shadow[2]! - 180 / 74)).toBeLessThan(0.35);
  });

  it('volgt het verloop in elke richting', async () => {
    const b1 = '#f1ece4', b2 = '#4a5f8c';
    for (const direction of ['vertical', 'horizontal', 'diagonal', 'radial'] as const) {
      const b: Backdrop = { mode: 'gradient', color: b1, color2: b2, direction, shadow: 'soft' };
      const { after } = await flatCase('business-card', b);
      for (const [x, y] of [[4, 4], [1195, 4], [4, 795], [1195, 795], [600, 10], [10, 400]] as const) {
        const want = backdropColorAt(b, x / 1199, y / 799, 1.5).map(Math.round);
        expect(near(px(after, x, y), want, 1), `${direction} ${x},${y}`).toBe(true);
      }
    }
    // Richting klopt: verticaal is boven licht en onder donker; horizontaal links licht en rechts donker.
    const v = (await flatCase('business-card', { mode: 'gradient', color: b1, color2: b2, direction: 'vertical' })).after;
    expect(px(v, 600, 5)[0]!).toBeGreaterThan(px(v, 600, 795)[0]! + 100);
    const hz = (await flatCase('business-card', { mode: 'gradient', color: b1, color2: b2, direction: 'horizontal' })).after;
    expect(px(hz, 5, 400)[0]!).toBeGreaterThan(px(hz, 1195, 400)[0]! + 100);
  });

  it('raakt een beeld zonder sleutelscherm niet aan', async () => {
    const plain = await renderDemoScene('mug', { width: 800, height: 600, seed: 3, chroma: true });
    await expect(makeFlatBackdrop(plain, { mode: 'solid', color: '#ffffff' })).rejects.toThrow(/geen sleutelachtergrond/);
  });

  it('voegt een subtiele textuur toe en kan de schaduw weglaten', async () => {
    const plain = (await flatCase('mug', { mode: 'solid', color: '#e8e2d9', texture: 'none', shadow: 'soft' })).after;
    const grain = (await flatCase('mug', { mode: 'solid', color: '#e8e2d9', texture: 'grain', shadow: 'soft' })).after;
    const paper = (await flatCase('mug', { mode: 'solid', color: '#e8e2d9', texture: 'paper', shadow: 'soft' })).after;
    const stats = (img: RGBA) => {
      const v: number[] = [];
      for (let y = 20; y < 160; y += 2) for (let x = 20; x < 300; x += 2) v.push(px(img, x, y)[0]!);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return { mean: m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) };
    };
    expect(stats(plain).sd).toBe(0);
    for (const s of [stats(grain), stats(paper)]) {
      expect(Math.abs(s.mean - 232)).toBeLessThan(2); // gemiddeld de gekozen kleur
      expect(s.sd).toBeGreaterThan(0.8); // zichtbaar korrel
      expect(s.sd).toBeLessThan(8); // maar subtiel
    }
    const soft = (await flatCase('mug', { mode: 'solid', color: '#e8e2d9', shadow: 'soft' })).after;
    const none = (await flatCase('mug', { mode: 'solid', color: '#e8e2d9', shadow: 'none' })).after;
    expect(px(soft, 470, 625)[0]!).toBeLessThan(220);
    expect(px(none, 470, 625)).toEqual([232, 226, 217]);
  });
});

describe('genereren: opslaan onder Scènes', () => {
  async function design(projectId: string, color: string) {
    const buf = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: color } }).png().toBuffer();
    return (await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'ontwerp.png', buffer: buf }))[0]!;
  }

  it('zet een platte achtergrond exact en toont de scène direct in de bibliotheek', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Plat' });
    const a = await design(p.id, '#c03a2b');
    const g = startGeneration({ projectId: p.id, assetId: a.id, config: { ...base, backdrop: { mode: 'solid', color: '#1e2a4a', shadow: 'soft' } }, count: 2 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status).toBe('done');
    expect(done.sceneIds).toHaveLength(2);
    const lib = scenes.list({ workspaceId: WS, library: true });
    for (const id of done.sceneIds) {
      const s = scenes.get(id)!;
      expect(lib.some((x) => x.id === id), 'staat in de bibliotheek').toBe(true);
      expect(s.inLibrary).toBe(true);
      expect(s.workspaceId).toBe(WS);
      expect(s.title).toMatch(/^Laptop, effen #1e2a4a [12]$/);
      expect(s.surfaces).toHaveLength(1);
      expect(s.config?.backdrop?.color).toBe('#1e2a4a');
      const img = await loadRGBA(await storage.localPath(s.file));
      expect(px(img, 4, 4)).toEqual([30, 42, 74]);
      expect(px(img, img.width - 5, 4)).toEqual([30, 42, 74]);
    }
    // Het ontwerp is ongewijzigd geplaatst: zonder licht, glans en reflecties is het midden exact de ontwerpkleur.
    const m = mockups.get(done.mockupIds[0]!)!;
    const scene = scenes.get(m.sceneId)!;
    const flatLight = m.placements.map((pl) => ({ ...pl, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } }));
    const out = await loadRGBA((await renderImage({ placements: flatLight }, scene, { width: scene.width, output: { format: 'png' } })).buffer);
    const q = scene.surfaces[0]!.quad;
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    expect(near(px(out, cx, cy), [192, 58, 43], 1)).toBe(true);
    // Na de generatie blijft de scène bestaan als het project verdwijnt? Nee: verwijderen werkt en haalt hem weg.
    await deleteScene(done.sceneIds[1]!);
    expect(scenes.list({ workspaceId: WS, library: true }).some((x) => x.id === done.sceneIds[1])).toBe(false);
  });

  it('gebruikt de merkkleur voor de omgeving en niet voor het ontwerp', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Merk' });
    const a = await design(p.id, '#c03a2b');
    const brand = '#2f5aa8';
    const g = startGeneration({ projectId: p.id, assetId: a.id, config: { ...base, sceneType: 'studio', props: 'brand', ground: 'oak', brandColor: brand, brandColorUse: ['background', 'props'] }, count: 1 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status).toBe('done');
    expect(done.prompt).toMatch(/Background color .*exactly #2f5aa8/);
    expect(done.prompt).toMatch(/Decorative objects: .*#2f5aa8/);
    const s = scenes.get(done.sceneIds[0]!)!;
    expect(s.inLibrary).toBe(true);
    expect(s.title).toBe('Laptop, studio, kleur #2f5aa8');
    // De wand van de testscène heeft de merktint (blauw), de ondergrond het eiken.
    const img = await loadRGBA(await storage.localPath(s.file));
    const wall = px(img, img.width * 0.5, 8);
    expect(wall[2]!).toBeGreaterThan(wall[0]! + 60);
    const floor = px(img, 6, img.height - 6);
    expect(floor[0]!).toBeGreaterThan(floor[2]! + 25);
    // Het ontwerp op het scherm: exact de ontwerpkleur, niet blauw getint.
    const m = mockups.get(done.mockupIds[0]!)!;
    const flatLight = m.placements.map((pl) => ({ ...pl, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } }));
    const out = await loadRGBA((await renderImage({ placements: flatLight }, s, { width: s.width, output: { format: 'png' } })).buffer);
    const q = s.surfaces[0]!.quad;
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    expect(near(px(out, cx, cy), [192, 58, 43], 1)).toBe(true);
    // Een nieuwe mockup met een ander ontwerp op dezelfde bibliotheekscène (hergebruik).
    const other = await design(p.id, '#2b7a3a');
    const reuse = createMockup({ projectId: p.id, sceneId: s.id, assetId: other.id });
    expect(reuse.sceneId).toBe(s.id);
  });
});
