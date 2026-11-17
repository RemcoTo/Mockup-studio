// Afmetingen van het ontwerp bij generatie, referentiebeelden bij een Brand Shoot (tot aan het verzoek
// naar het model), lange screenshots en het verwijderen van configuraties.
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyH, homography, rectQuad, surfaceDimensions } from '../../shared/geometry';
import { isValidSize, orientationOf, ratioLabel, sizeMode, surfaceOrientationFor } from '../../shared/design-size';
import type { SceneConfig } from '../../shared/types';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { assertSpendLimits } from '../../server/lib/billing/credits';
import { deleteGeneration, startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { buildPrompt } from '../../server/lib/generation/prompt';
import { startShoot } from '../../server/lib/generation/shoot';
import { renderImage } from '../../server/lib/mockups';
import { loadRGBA } from '../../server/lib/imaging/io';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { workspaces } from '../../server/lib/repo-accounts';
import { assets, generations, mockups, projects, scenes } from '../../server/lib/repositories';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
import { renderDemoScene } from '../../server/lib/generation/demo-scenes';

let dir = '', WS = '', P = '';
const base: SceneConfig = { category: 'print', objectType: 'business-card', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', avoid: ['text'] };
const Q = { tl: [214, 40, 50], tr: [40, 90, 220], bl: [245, 160, 20], br: [130, 40, 200] } as const;

/** Ontwerp met vier gekleurde kwadranten: stand, draaiing en bijsnijden zijn zo in de render te meten. */
async function quadrants(w: number, h: number) {
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const block = (c: readonly number[], bw: number, bh: number) => sharp({ create: { width: bw, height: bh, channels: 3, background: { r: c[0]!, g: c[1]!, b: c[2]! } } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: Q.tl[0], g: Q.tl[1], b: Q.tl[2] } } }).composite([
    { input: await block(Q.tr, w - hw, hh), left: hw, top: 0 },
    { input: await block(Q.bl, hw, h - hh), left: 0, top: hh },
    { input: await block(Q.br, w - hw, h - hh), left: hw, top: hh },
  ]).png().toBuffer();
}
async function design(w: number, h: number, name: string) {
  const [a] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: name, buffer: await quadrants(w, h) });
  return a!;
}
function nearest(c: number[]) {
  const n = (x: readonly number[]) => { const m = Math.hypot(...x) || 1; return x.map((v) => v / m); };
  const v = n(c);
  return (Object.keys(Q) as (keyof typeof Q)[]).map((k) => ({ k, d: Math.hypot(...n(Q[k]).map((x, i) => x - v[i]!)) })).sort((a, b) => a.d - b.d)[0]!;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-improve-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  WS = workspaces.create('Bureau').id;
  P = projects.create({ workspaceId: WS, name: 'Drukwerk' }).id;
  startQueue(100);
});
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('afmetingen van het ontwerp', () => {
  it('leidt stand, verhouding en werking per object af', () => {
    expect(orientationOf({ width: 550, height: 850 })).toBe('portrait');
    expect(orientationOf({ width: 850, height: 550 })).toBe('landscape');
    expect(orientationOf({ width: 1000, height: 1010 })).toBe('square');
    expect(ratioLabel({ width: 550, height: 850 })).toBe('11:17');
    expect(ratioLabel({ width: 1080, height: 1350 })).toBe('4:5');
    expect(ratioLabel({ width: 1001, height: 1553 })).toBe('1:1,55');
    expect(isValidSize({ width: 550, height: 850 })).toBe(true);
    expect(isValidSize({ width: 5, height: 850 })).toBe(false);
    expect(isValidSize({ width: 550.5, height: 850 })).toBe(false);
    expect(sizeMode('business-card')).toBe('surface');
    expect(sizeMode('poster')).toBe('surface');
    expect(sizeMode('tablet')).toBe('orientation');
    expect(sizeMode('laptop')).toBe('none');
    expect(sizeMode('mug')).toBe('none');
    expect(sizeMode('email-laptop')).toBe('none');
    expect(sizeMode('email-devices')).toBe('none');
    // Een staand visitekaartje: het vlak wordt staand herkend, ook al is een kaartje standaard liggend.
    expect(surfaceOrientationFor('business-card', { width: 550, height: 850 })).toBe('portrait');
    expect(surfaceOrientationFor('laptop', { width: 550, height: 850 })).toBeUndefined();
  });

  it('neemt de verhouding en stand op in de prompt voor het model', () => {
    const p = buildPrompt({ ...base, designSize: { width: 550, height: 850 } }, { hasReferences: false });
    expect(p).toMatch(/a single business card, .*vertical \(portrait\) format/);
    expect(p).toMatch(/width-to-height ratio of exactly 550:850 \(11:17\)/);
    expect(p).toMatch(/without stretching or cropping/);
    const l = buildPrompt({ ...base, designSize: { width: 850, height: 550 } }, { hasReferences: false });
    expect(l).toMatch(/horizontal \(landscape\) format/);
    const t = buildPrompt({ ...base, category: 'devices', objectType: 'tablet', designSize: { width: 1640, height: 2360 } }, { hasReferences: false });
    expect(t).toMatch(/portrait orientation/);
    expect(t).not.toMatch(/ratio of exactly/);
    // Een laptopscherm heeft een vaste verhouding: daar verandert niets.
    const lap = buildPrompt({ ...base, category: 'devices', objectType: 'laptop', designSize: { width: 550, height: 850 } }, { hasReferences: false });
    expect(lap).not.toMatch(/ratio of exactly|portrait/);
  });

  for (const [w, h] of [[550, 850], [850, 550]] as const) {
    it(`maakt een passende mockup voor een ontwerp van ${w} × ${h} px, zonder uitrekken, bijsnijden of draaien`, async () => {
      const a = await design(w, h, `kaartje-${w}x${h}.png`);
      const g = startGeneration({ projectId: P, assetId: a.id, config: { ...base, designSize: { width: w, height: h } }, count: 1 });
      await waitForGeneration(g.id);
      const done = generations.get(g.id)!;
      expect(done.status).toBe('done');
      const m = mockups.get(done.mockupIds[0]!)!;
      const scene = scenes.get(m.sceneId)!;
      expect(scene.surfaces.length).toBeGreaterThan(0);
      const img = await loadRGBA(await storage.localPath(scene.file));
      const rendered = await loadRGBA(Buffer.from((await renderImage(m, scene, { width: scene.width, output: { format: 'png' } })).buffer));
      for (const [i, p] of m.placements.entries()) {
        const surface = scene.surfaces.find((s) => s.id === p.surfaceId)!;
        // Vlak in de stand en verhouding van het ontwerp (perspectief meegerekend).
        const d = surfaceDimensions(surface.quad, scene);
        expect(d.width / d.height, `vlak ${i + 1}`).toBeCloseTo(w / h, 1);
        // Nooit bijsnijden of uitrekken.
        expect(p.transform.fit).toBe('contain');
        // Rechtop: elk kwadrant van het ontwerp staat op zijn eigen plek in het vlak.
        const H = homography(rectQuad(1, 1), surface.quad);
        for (const [k, u, v] of [['tl', 0.25, 0.25], ['tr', 0.75, 0.25], ['bl', 0.25, 0.75], ['br', 0.75, 0.75]] as const) {
          const [x, y] = applyH(H, u, v);
          const at = (Math.round(y) * rendered.width + Math.round(x)) * 4;
          expect(nearest([rendered.data[at]!, rendered.data[at + 1]!, rendered.data[at + 2]!]).k, `vlak ${i + 1}, ${k}`).toBe(k);
        }
      }
      void img;
    });
  }
});

describe('referentiebeelden bij een Brand Shoot', () => {
  let srv: Server;
  const seen: { prompt: string; images: number; endpoint: string }[] = [];
  beforeAll(async () => {
    // Nagebootste beelddienst (geen betaalde aanroep): leest het verzoek en geeft een getekende scène terug.
    const scene = (await renderDemoScene('business-card', { width: 1536, height: 1024, seed: 3, chroma: true })).toString('base64');
    srv = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString('latin1');
      const prompt = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? (req.headers['content-type']?.includes('json') ? JSON.parse(body).prompt : '');
      seen.push({ prompt, images: (body.match(/name="image\[\]"/g) ?? []).length, endpoint: req.url ?? '' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: scene }] }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-lokaal', openaiBaseUrl: `http://127.0.0.1:${port}/v1`, aiDailyLimitUsd: 100, aiWorkspaceDailyLimitUsd: 100 });
  });
  afterAll(() => { srv.close(); setConfig({ imageProvider: 'demo', openaiApiKey: '' }); });

  it('stuurt de referenties met elk beeld van de serie mee als stijlrichting', async () => {
    const refs = [];
    for (const [i, color] of ['#d8c4a8', '#3c4a44'].entries()) {
      const [r] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'reference', filename: `sfeer-${i + 1}.jpg`, buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).jpeg().toBuffer() });
      refs.push(r!.id);
    }
    const card = await design(550, 850, 'shoot-kaartje.png');
    const res = startShoot({
      projectId: P, title: 'Lancering', quality: 'low', userId: null,
      direction: { environment: 'studio', lighting: 'soft', style: 'editorial', referenceAssetIds: refs, referenceAspects: ['composition', 'angle', 'lighting', 'materials', 'colors', 'style'] },
      items: [{ objectType: 'business-card', assetId: card.id }, { objectType: 'poster', assetId: null }],
    });
    for (const g of res.generations) await waitForGeneration(g.id);
    expect(res.generations.map((g) => generations.get(g.id)!.status)).toEqual(['done', 'done']);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      // Met referenties via het bewerkingsendpoint, met beide beelden als invoer.
      expect(s.endpoint).toBe('/v1/images/edits');
      expect(s.images).toBe(2);
      expect(s.prompt).toMatch(/style references for the art direction only; follow them for the composition, camera angle, lighting, materials and surfaces, color palette, overall photographic style/);
      expect(s.prompt).toMatch(/do not recreate the reference scene/);
      expect(s.prompt).toMatch(/nothing from the references may appear on the target surface/);
      expect(s.prompt).toMatch(/coherent brand photo series of 2/);
    }
    // Het staande kaartje in de serie krijgt ook zijn eigen verhouding mee.
    expect(seen.find((s) => /business card/.test(s.prompt))!.prompt).toMatch(/ratio of exactly 550:850/);
    expect(generations.get(res.generations[0]!.id)!.config.referenceAssetIds).toEqual(refs);
  });

  it('weigert referentiebeelden uit een ander project vóórdat er iets start', async () => {
    const other = projects.create({ workspaceId: WS, name: 'Ander' }).id;
    const [r] = await ingestUpload({ projectId: other, workspaceId: WS, kind: 'reference', filename: 'x.jpg', buffer: await sharp({ create: { width: 200, height: 200, channels: 3, background: '#888' } }).jpeg().toBuffer() });
    const before = generations.list({ projectId: P }).length;
    expect(() => startShoot({ projectId: P, title: 'x', quality: 'low', userId: null, direction: { referenceAssetIds: [r!.id] }, items: [{ objectType: 'poster', assetId: null }, { objectType: 'laptop', assetId: null }] })).toThrow(/referentiebeeld/);
    expect(generations.list({ projectId: P }).length).toBe(before);
  });
});

describe('lange screenshots', () => {
  it('maakt een preview van een pagina die langer is dan WebP toestaat', async () => {
    // Een volledige pagina op een telefoon: 1170 px breed en 36.000 px lang.
    const tall = await sharp({ create: { width: 1170, height: 36000, channels: 3, background: '#e8e2d9' } }).png().toBuffer();
    const [a] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'lang.png', buffer: tall, source: 'url' });
    expect(a!.width).toBe(1170);
    expect(a!.height).toBe(36000);
    const meta = await sharp(await storage.read(a!.preview)).metadata();
    expect(meta.height).toBeLessThanOrEqual(16383);
    expect(meta.width! / meta.height!).toBeCloseTo(1170 / 36000, 2);
  });

  const chromium = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => p && existsSync(p));
  it.skipIf(!chromium)('legt een website vast met en zonder volledige pagina', async () => {
    const { captureWebsite, closeBrowser } = await import('../../server/lib/capture/capture');
    setConfig({ captureAllowPrivate: true, chromiumPath: chromium });
    const page = (n: number) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lang</title></head><body style="margin:0">${Array.from({ length: n }, (_, i) => `<section style="height:600px;background:hsl(${i * 40},40%,70%)">Blok ${i + 1}</section>`).join('')}</body></html>`;
    const srv = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(page(req.url === '/kort' ? 2 : 20)); });
    await new Promise<void>((r) => srv.listen(8080, '127.0.0.1', r));
    try {
      for (const viewport of ['desktop', 'smartphone'] as const) {
        for (const fullPage of [false, true]) {
          const shot = await captureWebsite({ url: 'http://127.0.0.1:8080/lang', viewport, fullPage, hideCookieBanners: true, delayMs: 300 });
          const [a] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: `${viewport}-${fullPage}.png`, buffer: shot.png, source: 'url', meta: { viewport, fullPage } });
          const scale = viewport === 'desktop' ? 2 : 3;
          // Zonder volledige pagina: het eerste scherm; met: de hele pagina van 12.000 px.
          expect(a!.height, `${viewport} ${fullPage}`).toBe(fullPage ? 12000 * scale : viewport === 'desktop' ? 1800 : 2532);
          expect((await sharp(await storage.read(a!.preview)).metadata()).height).toBeLessThanOrEqual(16383);
        }
      }
    } finally {
      srv.close();
      await closeBrowser();
    }
  });
});

describe('configuraties verwijderen', () => {
  it('verwijdert de configuratie, laat scènes en mockups staan en telt de kosten mee', async () => {
    const g = startGeneration({ projectId: P, assetId: null, config: { ...base }, count: 1 });
    await waitForGeneration(g.id);
    const done = generations.get(g.id)!;
    const sceneId = done.sceneIds[0]!, mockupId = done.mockupIds[0]!;
    // Kosten van een (gesimuleerde) betaalde generatie van een andere configuratie in dezelfde werkruimte.
    const paid = { ...done, id: 'betaald' + Date.now(), costUsd: 4, createdBy: null, mockupIds: [], sceneIds: [] };
    generations.insert(paid);
    setConfig({ aiWorkspaceDailyLimitUsd: 5 });
    expect(() => assertSpendLimits(WS, 1.5)).toThrow(/dagelijkse maximum/);
    deleteGeneration(generations.get(paid.id)!, WS);
    expect(generations.get(paid.id)).toBeNull();
    // Verwijderen omzeilt het dagplafond niet.
    expect(() => assertSpendLimits(WS, 1.5)).toThrow(/dagelijkse maximum/);
    setConfig({ aiWorkspaceDailyLimitUsd: 100 });

    deleteGeneration(done, WS);
    expect(generations.get(g.id)).toBeNull();
    expect(generations.list({ projectId: P }).some((x) => x.id === g.id)).toBe(false);
    expect(scenes.get(sceneId)).not.toBeNull();
    expect(mockups.get(mockupId)!.generationId).toBeNull();
  });

  it('weigert een configuratie die nog wordt gegenereerd', () => {
    const running = { ...generations.list({ projectId: P })[0]!, id: 'loopt' + Date.now(), status: 'running' as const };
    generations.insert(running);
    expect(() => deleteGeneration(running, WS)).toThrow(/wordt nu gegenereerd/);
    expect(generations.get(running.id)).not.toBeNull();
  });
});

void readFileSync; void assets;
