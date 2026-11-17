// Ontwerpversies en levende websitemockups.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleDueRecaptures } from '../../server/lib/capture/living';
import { setConfig } from '../../server/lib/config';
import { closeDb, getDb } from '../../server/lib/db';
import { startQueue, stopQueue, waitForJob } from '../../server/lib/jobs/queue';
import { createMockup, exportMockup, provenance } from '../../server/lib/mockups';
import { workspaces } from '../../server/lib/repo-accounts';
import { assets, assetVersions, mockups, projects, scenes } from '../../server/lib/repositories';
import { createSampleProject, seedSystemLibrary } from '../../server/lib/seed';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
import { MAX_VERSIONS, replaceAsset, restoreVersion } from '../../server/lib/versions';

const fixtures = path.resolve(__dirname, '../../fixtures');
let dir = '';
let WS = '';
let projectId = '';

const solid = (w: number, h: number, c: [number, number, number]) => sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer();
async function rerenderDone() {
  const row = getDb().prepare("SELECT id FROM jobs WHERE type = 'rerender-asset' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
  if (row) await waitForJob(row.id, 60_000);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-versions-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', captureAllowPrivate: false });
  WS = workspaces.create('Bureau').id;
  await seedSystemLibrary();
  projectId = (await createSampleProject(WS, fixtures))!.id;
  startQueue(100);
});
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('ontwerpversies', () => {
  it('vervangt een ontwerp, werkt mockups bij en bewaart de vorige versie', async () => {
    const logo = assets.list({ projectId }).find((a) => a.originalName === 'Logo.svg')!;
    const scene = scenes.list({ library: true }).find((s) => s.objectType === 'poster')!;
    const m = createMockup({ projectId, sceneId: scene.id, assetId: logo.id });
    const before = await provenance(m);
    const res = await replaceAsset(logo, await solid(800, 600, [200, 30, 30]), { filename: 'Logo v2.png', note: 'Nieuwe kleur', userId: null });
    expect(res.changed).toBe(true);
    expect(res.affectedMockups).toBe(1);
    expect(res.asset.version).toBe(2);
    expect(res.asset.mime).toBe('image/png');
    expect(res.asset.originalName).toBe('Logo v2.png');
    await rerenderDone();
    expect(mockups.get(m.id)!.previewFile).toBeTruthy();
    // De herkomst in de export volgt de nieuwe versie.
    expect(await provenance(mockups.get(m.id)!)).not.toBe(before);
    const v = assetVersions.list(logo.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version: 1, mime: 'image/svg+xml', note: '' });
    expect(res.asset.meta.versionNote).toBe('Nieuwe kleur');
    // Hetzelfde bestand nog een keer: geen nieuwe versie.
    const same = await replaceAsset(res.asset, await solid(800, 600, [200, 30, 30]), { userId: null });
    expect(same.changed).toBe(false);
    expect(assets.get(logo.id)!.version).toBe(2);
  });

  it('zet een eerdere versie terug zonder iets kwijt te raken', async () => {
    const logo = assets.list({ projectId }).find((a) => a.originalName === 'Logo v2.png')!;
    const v1 = assetVersions.list(logo.id).find((v) => v.version === 1)!;
    const res = await restoreVersion(logo, v1.id, null);
    expect(res.asset.version).toBe(3);
    expect(res.asset.mime).toBe('image/svg+xml');
    expect(res.asset.file).toBe(v1.file);
    expect(assetVersions.list(logo.id).map((v) => v.version)).toEqual([2, 1]);
    await rerenderDone();
    const m = mockups.usingAsset(logo.id)[0]!;
    const e = await exportMockup(m, { format: 'png', quality: 90 });
    expect(e.width).toBeGreaterThan(0);
  });

  it(`bewaart maximaal ${MAX_VERSIONS} versies en ruimt oude bestanden op`, async () => {
    const [a] = await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'Kleur.png', buffer: await solid(64, 64, [0, 0, 0]) });
    let cur = a!;
    const firstFile = cur.file;
    for (let i = 1; i <= MAX_VERSIONS + 2; i++) cur = (await replaceAsset(cur, await solid(64, 64, [i * 10, 0, 0]), { userId: null })).asset;
    expect(assetVersions.count(cur.id)).toBe(MAX_VERSIONS);
    expect(await storage.exists(firstFile)).toBe(false);
    expect(await storage.exists(cur.file)).toBe(true);
  });

  it('weigert een onleesbaar bestand en laat het ontwerp ongemoeid', async () => {
    const a = assets.list({ projectId }).find((x) => x.originalName === 'Visitekaartje.svg')!;
    await expect(replaceAsset(a, Buffer.from('geen beeld'), { userId: null })).rejects.toThrow(/niet ondersteund/);
    expect(assets.get(a.id)!.version).toBe(1);
  });
});

describe('levende websitemockups', () => {
  it('plant een nieuwe vastlegging als de laatste ouder is dan het ritme, en noteert een mislukking', async () => {
    const [a] = await ingestUpload({
      projectId, workspaceId: WS, kind: 'design', filename: 'site.png', buffer: readFileSync(path.join(fixtures, 'atelier-noord-desktop.png')), source: 'url',
      meta: { url: 'http://127.0.0.1:9/', viewport: 'desktop', fullPage: false, autoRefresh: 'weekly', capturedAt: new Date(Date.now() - 8 * 86400_000).toISOString() },
    });
    expect(scheduleDueRecaptures()).toBe(1);
    expect(scheduleDueRecaptures()).toBe(0); // staat al in de wachtrij
    const job = getDb().prepare("SELECT id FROM jobs WHERE type = 'recapture-asset' AND ref = ?").get(a!.id) as { id: string };
    await waitForJob(job.id, 60_000).catch(() => {});
    // Het interne adres wordt geweigerd: het ontwerp blijft zoals het was, met een melding.
    const after = assets.get(a!.id)!;
    expect(after.version).toBe(1);
    expect(String(after.meta.lastRefreshError)).toMatch(/poort|intern|privé|lokaal|niet toegestaan|adres/i);
    // Een recent vastgelegde website wordt niet opnieuw gepland.
    assets.updateMeta(a!.id, { ...after.meta, capturedAt: new Date().toISOString() });
    getDb().prepare("DELETE FROM jobs WHERE type = 'recapture-asset'").run();
    expect(scheduleDueRecaptures()).toBe(0);
    expect(projects.get(projectId)).toBeTruthy();
  });
});
