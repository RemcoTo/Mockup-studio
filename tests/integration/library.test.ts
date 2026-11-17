// Bibliotheekpijplijn met de demoprovider (geen kosten) en een onbereikbare OpenAI-URL (geen echte aanroep).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformSpend24h } from '../../server/lib/billing/credits';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { libraryPreview, pendingScenes, presetOverview, publishScene, rejectScene, startLibraryBatch, waitForLibraryRun } from '../../server/lib/library/pipeline';
import { workspaces } from '../../server/lib/repo-accounts';
import { libraryRuns, scenes } from '../../server/lib/repositories';
import { findObject } from '../../shared/catalog';
import { LIBRARY_PRESETS } from '../../shared/library-presets';

let dir = '';
let WS = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-library-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', aiDailyLimitUsd: 25 });
  WS = workspaces.create('Bureau').id;
  startQueue(100);
});
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('presets', () => {
  it('verwijzen allemaal naar een bestaand object en hebben een unieke id', () => {
    const ids = new Set<string>();
    for (const p of LIBRARY_PRESETS) {
      expect(findObject(p.config.objectType), p.id).not.toBeNull();
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
    }
    expect(LIBRARY_PRESETS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('bibliotheekpijplijn', () => {
  it('raamt de kosten vooraf: nul voor de demoprovider, een exact bedrag voor OpenAI', () => {
    const demo = libraryPreview(['laptop-oak-desk', 'mug-morning'], 'medium');
    expect(demo.totalUsd).toBe(0);
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt' });
    try {
      const ai = libraryPreview(['laptop-oak-desk', 'mug-morning'], 'medium');
      expect(ai.totalUsd).toBeGreaterThan(0);
      // 1536x1024 staat in de gepubliceerde prijstabel; een staand 4:5-formaat is een schatting.
      expect(ai.items[0]!.cost!.exact).toBe(true);
      expect(ai.items[1]!.cost!.exact).toBe(false);
      expect(ai.exact).toBe(false);
      expect(ai.items[0]!.prompt).toMatch(/green/i);
    } finally {
      setConfig({ imageProvider: 'demo', openaiApiKey: '' });
    }
  });

  it('genereert scènes in een beoordelingsrij die gebruikers niet zien tot publicatie', async () => {
    const { runs } = startLibraryBatch({ presetIds: ['laptop-oak-desk', 'mug-morning', 'tshirt-hanger'], quality: 'low', userId: null, expectUsd: 0 });
    for (const r of runs) await waitForLibraryRun(r.id);
    const done = runs.map((r) => libraryRuns.get(r.id)!);
    expect(done.every((r) => r.status === 'done' && r.sceneId)).toBe(true);
    expect(pendingScenes()).toHaveLength(3);
    // Niet zichtbaar voor een werkruimte.
    const visible = scenes.list({ workspaceId: WS }).map((s) => s.id);
    for (const r of done) expect(visible).not.toContain(r.sceneId);
    const mug = scenes.get(done[1]!.sceneId!)!;
    expect(mug.tags.preset).toBe('mug-morning');
    expect(mug.surfaces).toHaveLength(1);
    expect(mug.surfaces[0]!.cylinder).toBeTruthy();
    publishScene(mug.id);
    expect(scenes.list({ workspaceId: WS, library: true }).map((s) => s.id)).toContain(mug.id);
    expect(presetOverview().find((p) => p.id === 'mug-morning')).toMatchObject({ published: 1, pending: 0 });
    await rejectScene(done[0]!.sceneId!);
    expect(scenes.get(done[0]!.sceneId!)).toBeNull();
  });

  it('start niets als het bevestigde bedrag niet klopt of het platformplafond wordt overschreden', () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt' });
    const before = libraryRuns.recent(100).length;
    expect(() => startLibraryBatch({ presetIds: ['laptop-oak-desk'], quality: 'high', userId: null, expectUsd: 0 })).toThrow(/gewijzigd/);
    setConfig({ aiDailyLimitUsd: 0.01 });
    const cost = libraryPreview(['laptop-oak-desk'], 'high').totalUsd;
    expect(() => startLibraryBatch({ presetIds: ['laptop-oak-desk'], quality: 'high', userId: null, expectUsd: cost })).toThrow(/dagelijkse maximum/);
    expect(libraryRuns.recent(100).length).toBe(before);
    setConfig({ imageProvider: 'demo', openaiApiKey: '', aiDailyLimitUsd: 25 });
  });

  it('meldt een mislukte aanroep duidelijk en telt de kosten dan niet mee', async () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', openaiBaseUrl: 'http://127.0.0.1:9/v1' });
    const spent = platformSpend24h();
    const cost = libraryPreview(['poster-gallery'], 'low').totalUsd;
    const { runs } = startLibraryBatch({ presetIds: ['poster-gallery'], quality: 'low', userId: null, expectUsd: cost });
    await waitForLibraryRun(runs[0]!.id);
    const r = libraryRuns.get(runs[0]!.id)!;
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/OpenAI|bereikbaar/);
    expect(platformSpend24h()).toBeCloseTo(spent, 6);
    setConfig({ imageProvider: 'demo', openaiApiKey: '', openaiBaseUrl: 'https://api.openai.com/v1' });
  });
});
