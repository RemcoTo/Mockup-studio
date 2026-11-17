// Meerdere merkkleuren met elk een eigen toepassing: validatie, omzetten van oude configuraties, de prompt per rol,
// gradients (ook exact bij een platte achtergrond), de testscène, Brand Shoot, en het verzoek dat echt naar de
// beeldprovider gaat. Alles zonder kosten: de testprovider, en een nagebootste OpenAI-server op deze machine.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHex, rgbToHsl } from '../../shared/color';
import { normalizeSceneColors, paletteProblem, palettePrompt, sceneBackdrop, scenePalette, type ScenePalette } from '../../shared/palette';
import { keyConflict } from '../../shared/scene-style';
import type { SceneConfig } from '../../shared/types';
import { getConfig, setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { demoLook, renderDemoScene } from '../../server/lib/generation/demo-scenes';
import { previewGeneration, sceneColorProblem, startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { buildPrompt } from '../../server/lib/generation/prompt';
import { previewShoot, startShoot } from '../../server/lib/generation/shoot';
import { backdropColorAt, keyness, makeFlatBackdrop } from '../../server/lib/imaging/backdrop';
import { loadRGBA } from '../../server/lib/imaging/io';
import type { RGBA } from '../../server/lib/imaging/raster';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { renderImage } from '../../server/lib/mockups';
import { workspaces } from '../../server/lib/repo-accounts';
import { generations, mockups, projects, scenes } from '../../server/lib/repositories';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
import { parse, sceneConfigSchema, shootSchema } from '../../server/lib/validation';
import { closeDeviceRenderer } from '../../server/lib/device3d/render';
// @ts-expect-error -- JavaScript-buildscript zonder types
import { buildRenderPage } from '../../scripts/build-devices.mjs';

// In Brand Shoot wordt de laptop standaard een echt 3D-model; dat rendert in de headless browser.
const chromium = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'].find((p) => p && existsSync(p)) ?? '';

let dir = '';
let WS = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-palette-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', chromiumPath: chromium });
  await buildRenderPage(path.resolve('.nuxt/device3d/render-page.js'));
  WS = workspaces.create('Kleurbureau').id;
  workspaces.update(WS, { plan: 'studio', subscriptionStatus: 'active' });
  startQueue(120);
});
afterAll(async () => { stopQueue(); await closeDeviceRenderer(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

const base: SceneConfig = { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', palette: { colors: [] } };
/** Het voorbeeld uit de vraag: donkergroen op de ondergrond, lichtbeige achtergrond, oranje accent. */
const example: ScenePalette = { colors: [{ hex: '#243b32', role: 'ground' }, { hex: '#e8e1d5', role: 'background' }, { hex: '#f28c28', role: 'accent' }] };
const lineOf = (prompt: string, label: string) => prompt.split('\n').find((l) => l.startsWith(`- ${label}`)) ?? '';
const px = (img: RGBA, x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]; };
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

async function design(projectId: string, color: string) {
  const buf = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: color } }).png().toBuffer();
  return (await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'ontwerp.png', buffer: buf }))[0]!;
}

describe('palet: invoer en oude configuraties', () => {
  it('accepteert meerdere kleuren met elk een toepassing, en weigert wat niet klopt', () => {
    const ok = parse(sceneConfigSchema, { ...base, palette: { colors: [{ hex: '243B32', role: 'ground' }, { hex: '#E8E1D5', role: 'background' }, { hex: '#f28c28', role: 'accent' }] } });
    expect(ok.palette).toEqual(example);
    expect(() => parse(sceneConfigSchema, { ...base, palette: { colors: [{ hex: 'oranje', role: 'accent' }] } })).toThrow(/HEX/);
    expect(() => parse(sceneConfigSchema, { ...base, palette: { colors: [{ hex: '#f28c28', role: 'plafond' }] } })).toThrow(/role/);
    const many = Array.from({ length: 13 }, () => ({ hex: '#f28c28', role: 'accent' }));
    expect(() => parse(sceneConfigSchema, { ...base, palette: { colors: many } })).toThrow(/maximaal 12/);
    expect(() => parse(sceneConfigSchema, { ...base, palette: { colors: [], gradient: { direction: 'spiraal' } } })).toThrow();
    // Brand Shoot neemt hetzelfde palet aan.
    const shoot = parse(shootSchema, { projectId: 'p', quality: 'low', direction: { palette: example }, items: [{ objectType: 'laptop', assetId: null }] });
    expect(shoot.direction.palette).toEqual(example);
  });

  it('zet een oude merkkleur en een oude platte achtergrond om naar het palet', () => {
    // Een oude merkkleur ging als beschrijving naar de AI; zo blijft hij werken (achtergrond Door de AI).
    expect(scenePalette({ brandColor: '#B4644A' })).toEqual({ colors: [{ hex: '#b4644a', role: 'background' }, { hex: '#b4644a', role: 'props' }], background: 'ai' });
    expect(scenePalette({ brandColor: '#b4644a', brandColorUse: ['ground', 'light'] }).colors.map((c) => c.role)).toEqual(['ground', 'light']);
    // Bij een platte achtergrond telde de merkkleur niet voor de achtergrond: die komt van de achtergrond zelf.
    const flat = scenePalette({ brandColor: '#b4644a', backdrop: { mode: 'gradient', color: '#f1ece4', color2: '#1e2a4a', direction: 'diagonal' } });
    expect(flat).toEqual({ colors: [{ hex: '#f1ece4', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }, { hex: '#b4644a', role: 'props' }], gradient: { direction: 'diagonal' }, background: 'ai' });
    // Een nieuwe configuratie (met palet, ook leeg) wordt niet aangevuld vanuit de achtergrond.
    const fresh = normalizeSceneColors({ ...base, backdrop: { mode: 'solid', color: '#e8e2d9' } });
    expect(fresh.palette).toEqual({ colors: [] });
    expect(fresh.backdrop!.color).toBe('#e8e2d9');
    // Idempotent.
    const twice = normalizeSceneColors(normalizeSceneColors({ ...base, palette: example, backdrop: { mode: 'solid', color: '#ffffff' } }));
    expect(twice.backdrop!.color).toBe('#e8e1d5');
  });

  it('meldt een gradient met één kleur en een achtergrond met kleur én gradient', () => {
    expect(paletteProblem(example)).toBeNull();
    expect(paletteProblem({ colors: [{ hex: '#ffffff', role: 'gradient' }] })).toMatch(/minstens twee kleuren/);
    expect(paletteProblem({ colors: [{ hex: '#ffffff', role: 'gradient' }, { hex: '#000000', role: 'gradient' }, { hex: '#e8e1d5', role: 'background' }] })).toMatch(/óf een gradient/);
    const p = projects.create({ workspaceId: WS, name: 'Probleem' });
    const bad = { ...base, surfaceMethod: 'blank' as const, palette: { colors: [{ hex: '#ffffff', role: 'gradient' as const }] } };
    expect(previewGeneration(bad, 1).problem).toMatch(/minstens twee/);
    expect(() => startGeneration({ projectId: p.id, assetId: null, config: bad, count: 1 })).toThrow(/minstens twee/);
    expect(generations.list({ projectId: p.id })).toHaveLength(0);
  });
});

describe('palet: prompt per toepassing', () => {
  it('zet het voorbeeld uit de vraag elk op de eigen plek, met een exacte achtergrond', () => {
    // Donkergroen lijkt te veel op het groene vlak voor automatisch vinden; met een leeg vlak kan het wel.
    expect(sceneColorProblem({ ...base, palette: example })).toMatch(/#243b32 lijkt te veel op het groene vlak/);
    const cfg: SceneConfig = { ...base, surfaceMethod: 'blank', sceneType: 'studio', palette: example };
    expect(sceneColorProblem(cfg)).toBeNull();
    expect(sceneBackdrop(cfg)).toEqual({ mode: 'solid', color: '#e8e1d5', texture: 'none', shadow: 'none', extent: 'region' });
    const p = buildPrompt(cfg, { hasReferences: false });
    const ground = lineOf(p, 'Ground:'), accent = lineOf(p, 'Accent color:');
    expect(ground).toMatch(/tabletop, floor or surface the product stands on is .*\(#243b32\)/);
    expect(accent).toMatch(/\(#f28c28\) only for a few small, subtle accents/);
    // Exact: het model maakt een magenta sleutelscherm en krijgt de achtergrondkleur niet te zien; die zet de studio.
    expect(p).toMatch(/Background: the wall or backdrop behind the product is a flat, perfectly uniform chroma-key magenta \(#FF00FF\)/);
    expect(p).not.toContain('#e8e1d5');
    expect(lineOf(p, 'Background')).toBe('');
    // Geen kleur op een verkeerde plek.
    expect(ground).not.toMatch(/#e8e1d5|#f28c28/);
    expect(accent).not.toMatch(/#243b32|#e8e1d5/);
    expect(p).toMatch(/exactly one assigned role: apply it there and nowhere else, and do not swap colors between roles/);
    // Het ontwerp en het product krijgen geen paletkleur.
    expect(p).toMatch(/the product itself keeps its own colors, and none of these colors may appear on the target surface/);
    expect(p).toMatch(/Target surface: .* completely blank/);
  });

  it('geeft de achtergrond bij Door de AI mee als harde kleurinstructie', () => {
    const cfg: SceneConfig = { ...base, surfaceMethod: 'blank', sceneType: 'studio', palette: { ...example, background: 'ai' } };
    expect(sceneBackdrop(cfg)).toBeNull();
    const p = buildPrompt(cfg, { hasReferences: false });
    expect(p).not.toMatch(/magenta/);
    const bg = lineOf(p, 'Background color');
    expect(bg).toMatch(/^- Background color \(a fixed brand color, not a suggestion\): the background wall or backdrop behind the product is exactly #e8e1d5 \(RGB 232, 225, 213\)/);
    expect(bg).toMatch(/evenly lit, matte, uniform surface without vignetting, gradient, texture or pattern/);
    expect(bg).toMatch(/lighting, color temperature, shadows, colored light and color grading must not shift its hue, saturation or brightness/);
    expect(bg).not.toMatch(/#243b32|#f28c28/);
    // Gradient: ook vaste kleuren.
    const g = palettePrompt({ colors: [{ hex: '#f1ece4', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }], background: 'ai' }, { propsNone: false })!;
    expect(g).toMatch(/Background gradient \(fixed brand colors, not a suggestion\)/);
    expect(g).toMatch(/Use exactly these colors on an evenly lit, matte surface/);
    // Gekleurd licht: bij Door de AI ook op de achtergrond, bij Exact nooit op de achtergrond.
    expect(palettePrompt({ colors: [{ hex: '#f2b56b', role: 'light' }], background: 'ai' }, { propsNone: false })).toMatch(/on the background and the set/);
    expect(palettePrompt({ colors: [{ hex: '#f2b56b', role: 'light' }] }, { propsNone: false, exactBackground: true })).toMatch(/never falls on the background, the product or the target surface/);
  });

  it('weigert bij een exacte achtergrond een scènekleur die op het magenta scherm lijkt', () => {
    const purple: ScenePalette = { colors: [{ hex: '#e8e1d5', role: 'background' }, { hex: '#7a2e8c', role: 'accent' }] };
    expect(keyConflict({ palette: purple, backdrop: null })).toBe('#7a2e8c');
    expect(sceneColorProblem({ ...base, palette: purple })).toMatch(/#7a2e8c lijkt op het magenta scherm .* Door de AI/);
    // Door de AI, of zonder achtergrondkleur: geen sleutelscherm, dus geen bezwaar.
    expect(sceneColorProblem({ ...base, palette: { ...purple, background: 'ai' } })).toBeNull();
    expect(sceneColorProblem({ ...base, palette: { colors: [{ hex: '#7a2e8c', role: 'accent' }] } })).toBeNull();
    // Gewone kleuren botsen niet.
    expect(keyConflict({ palette: { colors: [{ hex: '#e8e1d5', role: 'background' }, { hex: '#b4644a', role: 'ground' }, { hex: '#f28c28', role: 'accent' }, { hex: '#e8a0c0', role: 'props' }] }, backdrop: null })).toBeNull();
    const p = projects.create({ workspaceId: WS, name: 'Magenta' });
    expect(() => startGeneration({ projectId: p.id, assetId: null, config: { ...base, palette: purple }, count: 1 })).toThrow(/magenta scherm/);
    expect(generations.list({ projectId: p.id })).toHaveLength(0);
  });

  it('beschrijft objecten, verlichting en meerdere kleuren per toepassing', () => {
    const p = buildPrompt({ ...base, props: 'brand', palette: { colors: [
      { hex: '#2f5aa8', role: 'props' }, { hex: '#c9a227', role: 'props' }, { hex: '#f2b56b', role: 'light' }, { hex: '#d8c3a5', role: 'ground' }, { hex: '#1e2a4a', role: 'ground' },
    ] } }, { hasReferences: false });
    expect(lineOf(p, 'Decorative objects')).toMatch(/#2f5aa8\) and .*#c9a227\)/);
    expect(lineOf(p, 'Lighting color')).toMatch(/#f2b56b.*never falls on the product or the target surface/);
    expect(lineOf(p, 'Ground')).toMatch(/color-blocked in .*#d8c3a5\) and .*#1e2a4a\)/);
    // Props op Geen: de objectkleur heeft niets om op te landen en blijft uit de prompt.
    const none = buildPrompt({ ...base, props: 'none', palette: { colors: [{ hex: '#2f5aa8', role: 'props' }, { hex: '#e8e1d5', role: 'background' }] } }, { hasReferences: false });
    expect(none).not.toMatch(/Decorative objects:/);
    expect(none).toMatch(/No props or decorative objects/);
    // Materiaal en kleur van de ondergrond samen.
    const marble = buildPrompt({ ...base, ground: 'marble', palette: { colors: [{ hex: '#d8c3a5', role: 'ground' }] } }, { hasReferences: false });
    expect(marble).toMatch(/material and texture of a white marble surface .*ground color given in the palette/);
    // Zonder kleuren: geen paletblok.
    expect(buildPrompt(base, { hasReferences: false })).not.toMatch(/Brand color palette/);
  });

  it('beschrijft een gradient met meerdere kleuren in volgorde en richting', () => {
    const grad = (direction: 'vertical' | 'horizontal' | 'diagonal' | 'radial') => palettePrompt({
      colors: [{ hex: '#f1ece4', role: 'gradient' }, { hex: '#e3a587', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }], gradient: { direction },
    }, { propsNone: false })!;
    expect(grad('vertical')).toMatch(/gradient running from top to bottom: .*\(#f1ece4\) at the top, through .*\(#e3a587\), to .*\(#1e2a4a\) at the bottom/);
    expect(grad('horizontal')).toMatch(/left to right: .*#f1ece4\) on the left.*#1e2a4a\) on the right/);
    expect(grad('diagonal')).toMatch(/diagonally from the top-left corner to the bottom-right corner/);
    expect(grad('radial')).toMatch(/radiating outward from the center.*#f1ece4\) in the center.*#1e2a4a\) at the outer edges/);
  });

  it('gebruikt bij een platte achtergrond het palet voor de exacte achtergrond, niet voor de prompt', () => {
    const cfg = normalizeSceneColors({ ...base, palette: { colors: [
      { hex: '#f1ece4', role: 'gradient' }, { hex: '#e3a587', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }, { hex: '#f28c28', role: 'accent' },
    ], gradient: { direction: 'horizontal' } }, backdrop: { mode: 'solid', color: '#ffffff', texture: 'none', shadow: 'soft' } });
    expect(cfg.backdrop).toMatchObject({ mode: 'gradient', stops: ['#f1ece4', '#e3a587', '#1e2a4a'], direction: 'horizontal' });
    const p = buildPrompt(cfg, { hasReferences: false });
    expect(p).toMatch(/chroma-key magenta/);
    expect(p).not.toMatch(/Brand color palette|#f28c28/);
    // Drie stops: links, midden, rechts exact.
    const at = (u: number) => backdropColorAt(cfg.backdrop!, u, 0.5, 1.5).map(Math.round);
    expect(at(0)).toEqual(parseHex('#f1ece4'));
    expect(at(0.5)).toEqual(parseHex('#e3a587'));
    expect(at(1)).toEqual(parseHex('#1e2a4a'));
    // Alleen een achtergrondkleur: effen.
    const solid = normalizeSceneColors({ ...base, palette: { colors: [{ hex: '#e8e1d5', role: 'background' }] }, backdrop: { mode: 'gradient', color: '#000000', color2: '#ffffff' } });
    expect(solid.backdrop).toMatchObject({ mode: 'solid', color: '#e8e1d5' });
    expect(solid.backdrop!.stops).toBeUndefined();
  });
});

describe('palet: genereren', () => {
  it('kleurt de testscène per toepassing en laat het ontwerp precies zoals het is', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Palet' });
    const a = await design(p.id, '#c03a2b');
    const palette: ScenePalette = { colors: [
      { hex: '#2f5aa8', role: 'background' }, { hex: '#b4644a', role: 'ground' }, { hex: '#c9a227', role: 'props' }, { hex: '#f2b56b', role: 'light' }, { hex: '#3d3a8c', role: 'accent' },
    ], background: 'ai' };
    const g = startGeneration({ projectId: p.id, assetId: a.id, config: { ...base, sceneType: 'studio', props: 'brand', palette }, count: 1 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status).toBe('done');
    expect(done.config.palette).toEqual(palette);
    for (const c of palette.colors) expect(done.prompt).toContain(c.hex);
    const s = scenes.get(done.sceneIds[0]!)!;
    expect(s.title).toBe('Laptop, studio, kleuren #2f5aa8, #b4644a, #c9a227 …');
    const img = await loadRGBA(await storage.localPath(s.file));
    // Wand blauw, vloer terracotta. De wand links gemeten: rechtsboven valt het warme licht van de kleur voor Verlichting.
    const wall = px(img, 12, img.height * 0.3);
    expect(wall[2]!).toBeGreaterThan(wall[0]! + 50);
    const floor = px(img, img.width * 0.5, img.height - 6);
    expect(floor[0]!).toBeGreaterThan(floor[2]! + 40);
    // Ontwerp: exact de ontwerpkleur. Ook met licht en schaduw aan blijft de tint die van het ontwerp
    // (het licht gaat als helderheid over het ontwerp, niet als kleur).
    const m = mockups.get(done.mockupIds[0]!)!;
    const q = s.surfaces[0]!.quad;
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const flatLight = m.placements.map((pl) => ({ ...pl, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } }));
    const exact = await loadRGBA((await renderImage({ placements: flatLight }, s, { width: s.width, output: { format: 'png' } })).buffer);
    expect(dist(px(exact, cx, cy), [192, 58, 43])).toBeLessThanOrEqual(2);
    const lit = await loadRGBA((await renderImage({ placements: m.placements.map((pl) => ({ ...pl, blend: { ...pl.blend, gloss: 0, reflections: 0 } })) }, s, { width: s.width, output: { format: 'png' } })).buffer);
    const hue = (c: number[]) => rgbToHsl(c as [number, number, number]).h;
    expect(Math.abs(hue(px(lit, cx, cy)) - hue([192, 58, 43]))).toBeLessThan(3);
  });

  it('gebruikt een gradient uit het palet in de testscène', async () => {
    const look = demoLook({ ...base, palette: { colors: [{ hex: '#f1ece4', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }], gradient: { direction: 'vertical' }, background: 'ai' } })!;
    expect(look.wallGradient).toEqual({ stops: ['#f1ece4', '#1e2a4a'], direction: 'vertical' });
    const img = await loadRGBA(await renderDemoScene('laptop', { width: 900, height: 600, seed: 3, chroma: true, look }));
    const top = px(img, 450, 4), low = px(img, 450, 600 * 0.55);
    expect(top[0]!).toBeGreaterThan(low[0]! + 60);
  });
});

describe('palet: Brand Shoot', () => {
  it('geeft elk beeld van de serie dezelfde kleuren en weigert vooraf een kleur die op het groene vlak lijkt', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Shoot' });
    const direction = { environment: 'architecture', lighting: 'daylight', style: 'editorial', palette: { colors: [{ hex: '#e8e1d5', role: 'background' as const }, { hex: '#f28c28', role: 'accent' as const }] } };
    const items = [{ objectType: 'laptop', assetId: null }, { objectType: 'poster', assetId: null }];
    const prev = previewShoot('Serie', direction, items, 'low');
    expect(prev.problem).toBeNull();
    // Exact (standaard): sleutelscherm in elk beeld; de studio zet de kleur er daarna in.
    expect(prev.items.every((it) => /chroma-key magenta/.test(it.prompt) && !it.prompt.includes('#e8e1d5') && /Accent color: .*#f28c28/.test(it.prompt))).toBe(true);
    const res = startShoot({ projectId: p.id, title: 'Serie', direction, items, quality: 'low', userId: null });
    for (const g of res.generations) await waitForGeneration(g.id);
    for (const g of res.generations.map((x) => generations.get(x.id)!)) {
      expect(g.status).toBe('done');
      expect(g.config.palette).toEqual(direction.palette);
      // De achtergrond van elk beeld is exact de kleur (linksboven op de wand gemeten).
      const img = await loadRGBA(await storage.localPath(scenes.get(g.sceneIds[0]!)!.file));
      expect(px(img, 6, 6)).toEqual([232, 225, 213]);
    }
    const green = { ...direction, palette: { colors: [{ hex: '#243b32', role: 'ground' as const }] } };
    expect(previewShoot('Groen', green, items, 'low').problem).toMatch(/Brand Shoot vindt dat vlak altijd automatisch/);
    const before = generations.list({ projectId: p.id }).length;
    expect(() => startShoot({ projectId: p.id, title: 'Groen', direction: green, items, quality: 'low', userId: null })).toThrow(/groene vlak/);
    expect(generations.list({ projectId: p.id })).toHaveLength(before);
  });
});

describe('palet: verzoek aan de beeldprovider', () => {
  let server: Server;
  const received: { path: string; prompt: string }[] = [];
  let image = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', prompt: (JSON.parse(body) as { prompt: string }).prompt });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: image }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  });
  afterAll(() => { server.close(); setConfig({ imageProvider: 'demo' }); });

  it('stuurt de kleuren per toepassing mee in het echte verzoek, bij een losse scène en bij Brand Shoot', async () => {
    const port = (server.address() as AddressInfo).port;
    const prev = getConfig();
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', openaiBaseUrl: `http://127.0.0.1:${port}/v1`, aiDailyLimitUsd: 100, aiWorkspaceDailyLimitUsd: 100, billingMode: 'off' });
    try {
      const palette: ScenePalette = { colors: [{ hex: '#e8e1d5', role: 'background' }, { hex: '#b4644a', role: 'ground' }, { hex: '#f28c28', role: 'accent' }] };
      const cfg: SceneConfig = { ...base, sceneType: 'studio', palette };
      // De nagebootste server geeft een scène terug zoals een model die volgens deze kleuren zou maken.
      image = (await renderDemoScene('laptop', { width: 1536, height: 1024, seed: 11, chroma: true, look: demoLook(cfg) })).toString('base64');
      const p = projects.create({ workspaceId: WS, name: 'Provider' });
      const g = startGeneration({ projectId: p.id, assetId: null, config: cfg, count: 1 });
      await waitForGeneration(g.id);
      expect(generations.get(g.id)!.status).toBe('done');
      const sent = received.at(-1)!;
      expect(sent.path).toBe('/v1/images/generations');
      // Exact: het verzoek vraagt een sleutelscherm, zonder de achtergrondkleur; de studio zet die erin.
      expect(sent.prompt).toMatch(/Background: the wall or backdrop behind the product is a flat, perfectly uniform chroma-key magenta/);
      expect(sent.prompt).not.toContain('#e8e1d5');
      expect(lineOf(sent.prompt, 'Ground')).toContain('#b4644a');
      expect(lineOf(sent.prompt, 'Accent color')).toContain('#f28c28');
      const scene = scenes.get(generations.get(g.id)!.sceneIds[0]!)!;
      expect(px(await loadRGBA(await storage.localPath(scene.file)), 6, 6)).toEqual([232, 225, 213]);

      // Brand Shoot met Door de AI: de harde kleurinstructie staat in elk verzoek.
      image = (await renderDemoScene('laptop', { width: 1536, height: 1024, seed: 11, chroma: true, look: demoLook({ ...cfg, palette: { ...palette, background: 'ai' } }) })).toString('base64');
      const n = received.length;
      const res = startShoot({ projectId: p.id, title: 'Serie', direction: { style: 'editorial', palette: { ...palette, background: 'ai' } }, items: [{ objectType: 'laptop', assetId: null }, { objectType: 'laptop', assetId: null }], quality: 'low', userId: null });
      for (const x of res.generations) await waitForGeneration(x.id);
      const shootPrompts = received.slice(n).map((r) => r.prompt);
      expect(shootPrompts).toHaveLength(2);
      for (const sp of shootPrompts) {
        expect(lineOf(sp, 'Background color')).toMatch(/exactly #e8e1d5 \(RGB 232, 225, 213\)/);
        expect(lineOf(sp, 'Ground')).toContain('#b4644a');
        expect(lineOf(sp, 'Accent color')).toContain('#f28c28');
      }
    } finally {
      setConfig({ imageProvider: prev.imageProvider, openaiApiKey: prev.openaiApiKey, openaiBaseUrl: prev.openaiBaseUrl });
    }
  });
});

describe('exacte achtergrond in een scène', () => {
  const sceneCfg = (palette: ScenePalette, objectType = 'laptop'): SceneConfig => ({ ...base, objectType, sceneType: 'studio', ground: 'oak', palette });
  /** Testscène met magenta wand zoals een model hem maakt, en het resultaat na het exact inkleuren. */
  async function exactCase(cfg: SceneConfig, seed = 5) {
    const input = await renderDemoScene(cfg.objectType, { width: 1200, height: 800, seed, chroma: true, look: demoLook(cfg) });
    const before = await loadRGBA(input);
    const { image } = await makeFlatBackdrop(input, sceneBackdrop(cfg)!, 1);
    return { before, after: image };
  }
  const keyOf = (img: RGBA, p: number) => keyness(img.data[p * 4]!, img.data[p * 4 + 1]!, img.data[p * 4 + 2]!);

  it('maakt de achtergrond pixel voor pixel de HEX-kleur en laat ondergrond, object en ontwerpvlak ongemoeid', async () => {
    for (const objectType of ['laptop', 'mug', 'poster']) {
      const cfg = sceneCfg({ colors: [{ hex: '#2f5aa8', role: 'background' }, { hex: '#b4644a', role: 'ground' }] }, objectType);
      const { before, after } = await exactCase(cfg);
      const N = before.width * before.height;
      // Achtergrond: elke pixel van de magenta wand die niet tegen een object aan ligt, is exact de kleur.
      const reach = Math.round(1200 * 0.006) + 1;
      let wall = 0, exact = 0, other = 0, changed = 0;
      for (let p = 0; p < N; p++) {
        const x = p % 1200, y = (p - x) / 1200;
        if (keyOf(before, p) >= 0.5) {
          let clear = true;
          for (let dy = -reach; dy <= reach && clear; dy += reach) for (let dx = -reach; dx <= reach && clear; dx += reach) {
            const q = (Math.min(799, Math.max(0, y + dy))) * 1200 + Math.min(1199, Math.max(0, x + dx));
            if (keyOf(before, q) < 0.22) clear = false;
          }
          if (!clear) continue;
          wall++;
          if (after.data[p * 4] === 47 && after.data[p * 4 + 1] === 90 && after.data[p * 4 + 2] === 168) exact++;
        } else if (keyOf(before, p) === 0) {
          // Ondergrond, product, props en het groene vlak: byte voor byte gelijk.
          other++;
          if (before.data[p * 4] !== after.data[p * 4] || before.data[p * 4 + 1] !== after.data[p * 4 + 1] || before.data[p * 4 + 2] !== after.data[p * 4 + 2]) changed++;
        }
      }
      expect(wall, objectType).toBeGreaterThan(N * 0.2);
      expect(exact, objectType).toBe(wall);
      expect(other, objectType).toBeGreaterThan(N * 0.2);
      expect(changed, objectType).toBe(0);
    }
  });

  it('vervangt ook een lichtere, minder verzadigde plek in het sleutelscherm volledig', async () => {
    // Zoals een model een magenta wand soms belicht: een lichte vlek (minder sleutelkleur) midden in de achtergrond.
    const W = 600, H = 400;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f20cf0"/>` +
      `<circle cx="150" cy="120" r="60" fill="#ffa0ff"/><rect x="330" y="160" width="160" height="180" fill="#6b6f75"/></svg>`;
    const input = await sharp(Buffer.from(svg)).png().toBuffer();
    const { image } = await makeFlatBackdrop(input, { mode: 'solid', color: '#e8e1d5', texture: 'none', shadow: 'none', extent: 'region' });
    expect(keyness(255, 160, 255)).toBeLessThan(0.7);
    for (const [x, y] of [[150, 120], [120, 100], [190, 150], [10, 10], [590, 390], [300, 60]] as const) expect(px(image, x, y), `${x},${y}`).toEqual([232, 225, 213]);
    expect(px(image, 410, 250)).toEqual([107, 111, 117]);
  });

  it('laat een gradient over de achtergrond lopen, niet over de ondergrond', async () => {
    const cfg = sceneCfg({ colors: [{ hex: '#f1ece4', role: 'gradient' }, { hex: '#1e2a4a', role: 'gradient' }], gradient: { direction: 'vertical' } });
    const bd = sceneBackdrop(cfg)!;
    expect(bd).toMatchObject({ mode: 'gradient', stops: ['#f1ece4', '#1e2a4a'], extent: 'region', shadow: 'none', texture: 'none' });
    const { before, after } = await exactCase(cfg);
    // Laagste wandpixel in de linkerkolom: daar is het verloop (vrijwel) bij de tweede kleur.
    let low = 0;
    for (let y = 0; y < 800; y++) if (keyOf(before, y * 1200 + 4) >= 0.5) low = y;
    expect(low).toBeGreaterThan(200);
    expect(low).toBeLessThan(760);
    expect(dist(px(after, 4, 2), [241, 236, 228])).toBeLessThanOrEqual(2);
    expect(dist(px(after, 4, low), [30, 42, 74])).toBeLessThanOrEqual(6);
  });

  it('vraagt de achtergrond zichtbaar in beeld, en maakt bij bovenaanzicht alles rond het product achtergrond', async () => {
    const pal: ScenePalette = { colors: [{ hex: '#e8e1d5', role: 'background' }, { hex: '#b4644a', role: 'ground' }] };
    const side = buildPrompt({ ...sceneCfg(pal, 'business-card'), angle: 'three-quarter' }, { hasReferences: false });
    expect(side).toMatch(/Frame the shot so that this background is clearly visible behind the surface the product stands on/);
    expect(lineOf(side, 'Ground')).toContain('#b4644a');
    const top = buildPrompt({ ...sceneCfg(pal, 'business-card'), angle: 'top' }, { hasReferences: false });
    expect(top).toMatch(/seen from directly above, everything around the product, including the surface it lies on, is a flat, perfectly uniform chroma-key magenta/);
    expect(top).not.toMatch(/#b4644a|oak/);
    // Bij Door de AI blijft een bovenaanzicht gewoon met ondergrond.
    expect(lineOf(buildPrompt({ ...sceneCfg({ ...pal, background: 'ai' }, 'business-card'), angle: 'top' }, { hasReferences: false }), 'Ground')).toContain('#b4644a');
    // Testscène van bovenaf (geen wand): het hele vlak rond het kaartje wordt exact de kleur.
    const { after } = await exactCase({ ...sceneCfg(pal, 'business-card'), angle: 'top' });
    for (const [x, y] of [[4, 4], [1195, 4], [4, 795], [1195, 795]] as const) expect(px(after, x, y)).toEqual([232, 225, 213]);
  });

  it('werkt in de hele keten: generatie, scène en mockup', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Exact' });
    const a = await design(p.id, '#c03a2b');
    const g = startGeneration({ projectId: p.id, assetId: a.id, config: { ...sceneCfg({ colors: [{ hex: '#2f5aa8', role: 'background' }, { hex: '#b4644a', role: 'ground' }] }), props: 'minimal' }, count: 2 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status).toBe('done');
    expect(done.error ?? null).toBeNull();
    expect(done.prompt).toMatch(/chroma-key magenta/);
    for (const [i, sid] of done.sceneIds.entries()) {
      const s = scenes.get(sid)!;
      const img = await loadRGBA(await storage.localPath(s.file));
      for (const [x, y] of [[4, 4], [img.width - 5, 4], [img.width / 2, 6]] as const) expect(px(img, x, y)).toEqual([47, 90, 168]);
      // Het ontwerpvlak is gevonden en het ontwerp staat er exact op.
      expect(s.surfaces.length).toBeGreaterThan(0);
      const m = mockups.get(done.mockupIds[i]!)!;
      const q = s.surfaces[0]!.quad;
      const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      const flatLight = m.placements.map((pl) => ({ ...pl, blend: { ...pl.blend, shading: 0, gloss: 0, reflections: 0, opacity: 1 } }));
      const out = await loadRGBA((await renderImage({ placements: flatLight }, s, { width: s.width, output: { format: 'png' } })).buffer);
      expect(dist(px(out, cx, cy), [192, 58, 43])).toBeLessThanOrEqual(2);
    }
  });
});
