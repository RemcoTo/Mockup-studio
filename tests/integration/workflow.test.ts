// Volledige workflow op serviceniveau, met een tijdelijke datamap en de demoprovider (geen kosten).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { memberships, workspaces, credits } from '../../server/lib/repo-accounts';
import { renderDemoScene } from '../../server/lib/generation/demo-scenes';
import { createMockup, exportMockup, renderPreview, zipExports } from '../../server/lib/mockups';
import { generations, mockups, projects, scenes } from '../../server/lib/repositories';
import { createScene, saveSurfaces } from '../../server/lib/scenes';
import { createSampleProject, seedSystemLibrary } from '../../server/lib/seed';
import { storage } from '../../server/lib/storage';
import { checkSvg, ingestUpload, sniffType } from '../../server/lib/uploads';
import { buildPrompt } from '../../server/lib/generation/prompt';
import { outputSize } from '../../shared/sizes';
import type { SceneConfig } from '../../shared/types';

const fixtures = path.resolve(__dirname, '../../fixtures');
let dir = '';

let WS = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-studio-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  WS = workspaces.create('Testbureau').id;
  await seedSystemLibrary();
  await createSampleProject(WS, fixtures);
  startQueue(200);
});
afterAll(() => {
  stopQueue();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const baseConfig: SceneConfig = { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', avoid: ['text', 'people'] };

describe('uploads', () => {
  it('herkent bestandstypen aan de inhoud', () => {
    expect(sniffType(readFileSync(path.join(fixtures, 'atelier-noord-desktop.png')))).toBe('image/png');
    expect(sniffType(readFileSync(path.join(fixtures, 'atelier-noord-logo.svg')))).toBe('image/svg+xml');
    expect(sniffType(Buffer.from('MZ\x90\x00 dit is geen beeld'))).toBeNull();
  });

  it('weigert onveilige SVG-bestanden met een uitleg', () => {
    expect(() => checkSvg('<svg><script>alert(1)</script></svg>')).toThrow(/script/);
    expect(() => checkSvg('<svg onload="x()"></svg>')).toThrow(/event/);
    expect(() => checkSvg('<svg><image href="https://evil.example/x.png"/></svg>')).toThrow(/extern/);
    expect(() => checkSvg('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toThrow(/DOCTYPE/);
    expect(() => checkSvg(readFileSync(path.join(fixtures, 'atelier-noord-logo.svg'), 'utf8'))).not.toThrow();
  });

  it('bewaart het origineel ongewijzigd en maakt een preview', async () => {
    const p = projects.create({ workspaceId: WS, name: 'Uploadtest' });
    const buf = readFileSync(path.join(fixtures, 'atelier-noord-desktop.png'));
    const [a] = await ingestUpload({ projectId: p.id, workspaceId: WS, kind: 'design', filename: 'site.png', buffer: buf });
    expect(a!.width).toBe(2880);
    expect((await storage.read(a!.file)).equals(buf)).toBe(true);
    expect(await storage.exists(a!.preview)).toBe(true);
  });

  it('zet een PDF om naar een raster per pagina', async () => {
    const p = projects.create({ workspaceId: WS, name: 'PDF' });
    const pdf = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 24>>stream
1 0 0 rg 20 20 100 80 re f
endstream endobj
trailer<</Root 1 0 R>>
%%EOF`);
    const [a] = await ingestUpload({ projectId: p.id, workspaceId: WS, kind: 'design', filename: 'flyer.pdf', buffer: pdf });
    expect(a!.mime).toBe('application/pdf');
    expect(a!.width).toBeGreaterThan(2000);
    expect(await storage.exists(String(a!.meta.raster))).toBe(true);
  });
});

describe('promptopbouw', () => {
  it('vraagt om een chroma-vlak en sluit tekst op het doeloppervlak uit', () => {
    const prompt = buildPrompt({ ...baseConfig, instructions: 'Warm licht van links.' }, { hasReferences: false });
    expect(prompt).toMatch(/#00FF00/);
    expect(prompt).toMatch(/the laptop screen/);
    expect(prompt).toMatch(/Do not include:.*hands or people/);
    expect(prompt).toMatch(/Warm licht van links/);
  });

  it('beschrijft een leeg vlak bij de handmatige methode', () => {
    const prompt = buildPrompt({ ...baseConfig, surfaceMethod: 'blank' }, { hasReferences: true });
    expect(prompt).not.toMatch(/#00FF00/);
    expect(prompt).toMatch(/blank and plain/);
    expect(prompt).toMatch(/style references for the art direction only/);
  });

  it('kiest uitvoermaten binnen de grenzen van het model', () => {
    for (const aspect of ['1:1', '16:9', '9:16', '21:9', '4:5'])
      for (const res of ['standard', 'high', 'max']) {
        const s = outputSize(aspect, res);
        expect(s.width % 16).toBe(0);
        expect(s.height % 16).toBe(0);
        expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(3840);
        expect(s.width * s.height).toBeLessThanOrEqual(8_294_400);
      }
  });
});

describe('workflow van ontwerp tot export', () => {
  it('vult de bibliotheek en het demoproject bij de eerste start', async () => {
    expect(projects.list(WS).some((p) => p.name === 'Voorbeeld: Atelier Noord')).toBe(true);
    const lib = scenes.list({ workspaceId: WS, library: true });
    expect(lib.length).toBeGreaterThanOrEqual(7);
    // Elke testscène heeft een automatisch gevonden vlak, de multi-device-scène twee.
    for (const s of lib) expect(s.surfaces.length).toBeGreaterThan(0);
    expect(lib.find((s) => s.objectType === 'multi-device')!.surfaces).toHaveLength(2);
  });

  it('plaatst een ontwerp op een bibliotheekscène en exporteert PNG en JPG', async () => {
    const project = projects.list(WS).find((p) => p.name === 'Voorbeeld: Atelier Noord')!;
    const { assets } = await import('../../server/lib/repositories');
    const design = assets.list({ projectId: project.id }).find((a) => a.originalName === 'Website desktop.png')!;
    const scene = scenes.list({ workspaceId: WS, library: true }).find((s) => s.objectType === 'laptop')!;
    const m = createMockup({ projectId: project.id, sceneId: scene.id, assetId: design.id });
    expect(m.placements).toHaveLength(1);
    const withPreview = await renderPreview(m);
    expect(withPreview.previewFile).toBeTruthy();
    const png = await exportMockup(m, { format: 'png', quality: 100 });
    expect(png.width).toBe(scene.width);
    const jpg = await exportMockup(m, { format: 'jpg', quality: 85 });
    const meta = await sharp(await storage.read(jpg.file)).metadata();
    expect(meta.format).toBe('jpeg');

    // In het midden van het scherm staat nu het ontwerp, niet meer het groen.
    const raw = await sharp(await storage.read(png.file)).raw().toBuffer({ resolveWithObject: true });
    const q = scene.surfaces[0]!.quad;
    const cx = Math.round((q[0][0] + q[2][0]) / 2), cy = Math.round((q[0][1] + q[2][1]) / 2);
    const i = (cy * raw.info.width + cx) * raw.info.channels;
    expect(raw.data[i + 1]! - Math.max(raw.data[i]!, raw.data[i + 2]!)).toBeLessThan(30);

    const zip = await zipExports([png, jpg], project.name);
    expect(Buffer.from(zip.subarray(0, 2)).toString()).toBe('PK');
  });

  it('genereert varianten via de demoprovider en zet het ontwerp er direct op', async () => {
    const project = projects.list(WS).find((p) => p.name === 'Voorbeeld: Atelier Noord')!;
    const { assets } = await import('../../server/lib/repositories');
    const design = assets.list({ projectId: project.id })[0]!;
    const g = startGeneration({ projectId: project.id, assetId: design.id, config: baseConfig, count: 3 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    expect(done.status).toBe('done');
    expect(done.mockupIds).toHaveLength(3);
    for (const id of done.mockupIds) expect(mockups.get(id)!.placements[0]!.assetId).toBe(design.id);
  });

  it('meldt een fout zonder resultaat te verzinnen als de provider niet is ingesteld', () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: '' });
    const project = projects.list(WS)[0]!;
    expect(() => startGeneration({ projectId: project.id, assetId: null, config: baseConfig, count: 1 })).toThrow(/sleutel/);
    setConfig({ imageProvider: 'demo' });
  });

  it('laat de gebruiker op een gewone foto zelf het vlak aanwijzen', async () => {
    const photo = await renderDemoScene('poster', { width: 1200, height: 1500, seed: 1, chroma: false });
    const scene = await createScene({
      buffer: photo, workspaceId: WS, projectId: null, origin: 'library', inLibrary: true, title: 'Lege poster', category: 'print',
      objectType: 'poster', surfaceKind: 'paper', license: 'Test', detect: true,
    });
    expect(scene.surfaces).toHaveLength(0);
    const updated = await saveSurfaces(scene.id, [{ label: 'Poster', kind: 'paper', quad: [[400, 300], [800, 310], [790, 1200], [410, 1190]] }]);
    expect(updated.surfaces[0]!.detection).toBe('manual');
    expect(await storage.exists(updated.surfaces[0]!.shadingFile!)).toBe(true);
    await expect(saveSurfaces(scene.id, [{ label: 'Fout', kind: 'paper', quad: [[0, 0], [100, 100], [100, 0], [0, 100]] }])).rejects.toThrow(/vierhoek/);
  });
});

describe('credits en uitgavenplafonds', () => {
  it('weigert een generatie zonder genoeg credits en maakt dan niets aan', async () => {
    setConfig({ billingMode: 'credits', imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt' });
    const project = projects.list(WS)[0]!;
    const before = (await import('../../server/lib/repositories')).generations.list({ projectId: project.id }).length;
    expect(() => startGeneration({ projectId: project.id, assetId: null, config: { ...baseConfig, quality: 'medium' }, count: 2 })).toThrow(/credits/);
    expect((await import('../../server/lib/repositories')).generations.list({ projectId: project.id }).length).toBe(before);
    setConfig({ billingMode: 'off', imageProvider: 'demo', openaiApiKey: '' });
  });

  it('boekt credits terug als een generatie mislukt', async () => {
    setConfig({ billingMode: 'credits', imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', openaiBaseUrl: 'http://127.0.0.1:9/v1', aiDailyLimitUsd: 100, aiWorkspaceDailyLimitUsd: 100 });
    credits.add(WS, 50, 'test');
    const project = projects.list(WS)[0]!;
    const g = startGeneration({ projectId: project.id, assetId: null, config: { ...baseConfig, quality: 'medium' }, count: 1 });
    expect(credits.balance(WS)).toBe(45);
    await waitForGeneration(g.id);
    const { generations } = await import('../../server/lib/repositories');
    expect(generations.get(g.id)!.status).toBe('failed');
    expect(generations.get(g.id)!.error).toMatch(/niet bereikbaar/);
    expect(credits.balance(WS)).toBe(50);
    setConfig({ billingMode: 'off', imageProvider: 'demo', openaiApiKey: '', openaiBaseUrl: 'https://api.openai.com/v1' });
  });

  it('stopt bij het dagelijkse maximum van de werkruimte', () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', aiWorkspaceDailyLimitUsd: 0.01, aiDailyLimitUsd: 100 });
    const project = projects.list(WS)[0]!;
    expect(() => startGeneration({ projectId: project.id, assetId: null, config: { ...baseConfig, quality: 'high' }, count: 1 })).toThrow(/dagelijkse maximum/);
    setConfig({ imageProvider: 'demo', openaiApiKey: '', aiWorkspaceDailyLimitUsd: 5, aiDailyLimitUsd: 25 });
  });

  it('houdt werkruimtes gescheiden', async () => {
    const other = workspaces.create('Ander bureau');
    expect(projects.list(other.id)).toHaveLength(0);
    const own = scenes.list({ workspaceId: WS }).filter((s) => s.workspaceId === WS);
    expect(own.length).toBeGreaterThan(0);
    expect(scenes.list({ workspaceId: other.id }).some((s) => s.workspaceId === WS)).toBe(false);
    expect(memberships.members(other.id)).toHaveLength(0);
  });
});

describe('printklare export en herkomst', () => {
  it('levert een CMYK-TIFF op 300 dpi en schrijft de vingerafdruk van het ontwerp in PNG-exports', async () => {
    const project = projects.list(WS).find((p) => p.name === 'Voorbeeld: Atelier Noord')!;
    const { assets } = await import('../../server/lib/repositories');
    const design = assets.list({ projectId: project.id }).find((a) => a.originalName === 'Logo.svg')!;
    expect(design.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const scene = scenes.list({ workspaceId: WS, library: true }).find((s) => s.objectType === 'poster')!;
    const m = createMockup({ projectId: project.id, sceneId: scene.id, assetId: design.id });
    const tif = await exportMockup(m, { format: 'tiff', quality: 100 });
    const tm = await sharp(await storage.read(tif.file)).metadata();
    expect(tm.space).toBe('cmyk');
    expect(tm.density).toBe(300);
    const png = await exportMockup(m, { format: 'png', quality: 100 });
    const exif = (await sharp(await storage.read(png.file)).metadata()).exif!.toString('latin1');
    expect(exif).toContain(String(design.meta.sha256));
    expect(exif).toContain('zonder AI-bewerking');
  });

  it('snijdt bij een preset bij naar de verhouding en houdt het ontwerpvlak in beeld', async () => {
    const project = projects.list(WS).find((p) => p.name === 'Voorbeeld: Atelier Noord')!;
    const scene = scenes.list({ workspaceId: WS, library: true }).find((s) => s.objectType === 'laptop')!;
    const m = createMockup({ projectId: project.id, sceneId: scene.id, assetId: null });
    const e = await exportMockup(m, { format: 'jpg', quality: 85, preset: 'instagram' });
    expect([e.width, e.height]).toEqual([1080, 1350]);
    const meta = await sharp(await storage.read(e.file)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
  });
});
