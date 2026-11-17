// Brand Shoot: één art direction, meerdere objecten, alles-of-niets bij tegoed en plafonds.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { waitForGeneration } from '../../server/lib/generation/jobs';
import { previewShoot, startShoot } from '../../server/lib/generation/shoot';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { credits, workspaces } from '../../server/lib/repo-accounts';
import { assets, generations, mockups } from '../../server/lib/repositories';
import { createSampleProject, seedSystemLibrary } from '../../server/lib/seed';
import { closeDeviceRenderer } from '../../server/lib/device3d/render';
import { scenes } from '../../server/lib/repositories';
// @ts-expect-error -- JavaScript-buildscript zonder types
import { buildRenderPage } from '../../scripts/build-devices.mjs';

const fixtures = path.resolve(__dirname, '../../fixtures');
// De laptop wordt standaard een echt 3D-model; dat rendert in dezelfde headless browser als de website-import.
const chromium = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'].find((p) => p && existsSync(p)) ?? '';
let dir = '', WS = '', projectId = '';
const direction = { environment: 'architecture', lighting: 'daylight', colorTemperature: 4500, style: 'editorial', instructions: 'Lichte travertin, ochtendlicht' };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-shoot-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', chromiumPath: chromium });
  await buildRenderPage(path.resolve('.nuxt/device3d/render-page.js'));
  WS = workspaces.create('Bureau').id;
  await seedSystemLibrary();
  projectId = (await createSampleProject(WS, fixtures))!.id;
  startQueue(100);
});
afterAll(async () => { stopQueue(); await closeDeviceRenderer(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('brand shoot', () => {
  it('maakt per object een generatie met dezelfde art direction en een gedeelde serie', async () => {
    const a = assets.list({ projectId });
    const logo = a.find((x) => x.originalName === 'Logo.svg')!.id;
    const site = a.find((x) => x.originalName === 'Website desktop.png')!.id;
    const res = startShoot({
      projectId, title: 'Atelier Noord lancering', direction, quality: 'low', userId: null,
      items: [{ objectType: 'laptop', assetId: site }, { objectType: 'mug', assetId: logo }, { objectType: 'business-card', assetId: a.find((x) => x.originalName === 'Visitekaartje.svg')!.id }],
    });
    expect(res.generations).toHaveLength(3);
    for (const g of res.generations) await waitForGeneration(g.id);
    const done = res.generations.map((g) => generations.get(g.id)!);
    expect(done.every((g) => g.status === 'done' && g.mockupIds.length === 1)).toBe(true);
    expect(new Set(done.map((g) => g.config.series!.id)).size).toBe(1);
    expect(done.map((g) => g.config.series!.index)).toEqual([1, 2, 3]);
    for (const g of done) {
      expect(g.prompt).toMatch(/image \d of a coherent brand photo series of 3/);
      expect(g.prompt).toMatch(/architectural setting/);
      expect(g.prompt).toMatch(/travertin/);
    }
    expect(mockups.get(done[1]!.mockupIds[0]!)!.placements[0]!.assetId).toBe(logo);
    // De laptop is een echt 3D-model (de AI maakt alleen de omgeving); mok en visitekaartje blijven AI met groen vlak.
    expect(done[0]!.config.device3d?.model).toBe('laptop-14');
    expect(done[0]!.prompt).toMatch(/of an empty set/);
    expect(scenes.get(done[0]!.sceneIds[0]!)!.surfaces[0]!.detection).toBe('3d');
    expect(done[1]!.config.device3d).toBeUndefined();
    expect(done[1]!.prompt).toMatch(/chroma-key green/);
  }, 180_000);

  it('kan devices ook door de AI laten maken, en laat groen alleen toe als geen enkel beeld het groene vlak gebruikt', () => {
    const green = { ...direction, palette: { colors: [{ hex: '#22c55e', role: 'props' as const }] } };
    const devices = [{ objectType: 'laptop', assetId: null }, { objectType: 'smartphone', assetId: null }];
    const p3d = previewShoot('x', green, devices, 'low');
    expect(p3d.devices3d).toBe(2);
    expect(p3d.problem).toBeNull();
    expect(p3d.items.every((it) => /of an empty set/.test(it.prompt))).toBe(true);
    // Uit: de devices krijgen het groene schermvlak, en groen botst dan wel.
    const ai = previewShoot('x', green, devices, 'low', undefined, false);
    expect(ai.devices3d).toBe(0);
    expect(ai.items.every((it) => /chroma-key green/.test(it.prompt))).toBe(true);
    expect(ai.problem).toMatch(/groene vlak/);
    // Gemengde serie: de mok gebruikt het groene vlak, dus groen botst ook met 3D aan.
    expect(previewShoot('x', green, [...devices, { objectType: 'mug', assetId: null }], 'low').problem).toMatch(/groene vlak/);
  });

  it('start niets als het tegoed niet voor de hele serie volstaat', () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', billingMode: 'credits', aiDailyLimitUsd: 100, aiWorkspaceDailyLimitUsd: 100 });
    try {
      const items = [{ objectType: 'laptop', assetId: null }, { objectType: 'poster', assetId: null }];
      const p = previewShoot('x', direction, items, 'high');
      expect(p.credits).toBeGreaterThan(20);
      // Gratis plan: brand shoot zit er niet in.
      expect(() => startShoot({ projectId, title: 'x', direction, items, quality: 'high', userId: null })).toThrow(/vanaf het Studio/);
      workspaces.update(WS, { plan: 'studio', subscriptionStatus: 'active' });
      credits.add(WS, 25 - credits.balance(WS), 'test', 'saldo');
      const before = generations.list({ projectId }).length;
      expect(() => startShoot({ projectId, title: 'x', direction, items, quality: 'high', userId: null })).toThrow(/credits/);
      expect(credits.balance(WS)).toBe(25);
      expect(generations.list({ projectId }).length).toBe(before);
    } finally {
      setConfig({ imageProvider: 'demo', openaiApiKey: '', billingMode: 'off' });
    }
  });

  it('weigert te grote series en onbekende objecten', () => {
    expect(() => previewShoot('x', direction, [], 'low')).toThrow(/minstens één/);
    expect(() => previewShoot('x', direction, Array.from({ length: 9 }, () => ({ objectType: 'mug', assetId: null })), 'low')).toThrow(/maximaal/);
    expect(() => previewShoot('x', direction, [{ objectType: 'ruimteschip', assetId: null }], 'low')).toThrow(/Onbekend/);
  });
});
