// Klantpresentaties: link, akkoord en wijzigingen, intrekken, verlopen, downloaden.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../server/lib/config';
import { closeDb, getDb } from '../../server/lib/db';
import { createMockup, renderPreview } from '../../server/lib/mockups';
import { users, workspaces } from '../../server/lib/repo-accounts';
import { assets, scenes, shares } from '../../server/lib/repositories';
import { createSampleProject, seedSystemLibrary } from '../../server/lib/seed';
import { addFeedback, createShare, downloadFor, ownerView, publicView, shareByToken } from '../../server/lib/shares';

const fixtures = path.resolve(__dirname, '../../fixtures');
let dir = '';
let projectId = '';
let mockupIds: string[] = [];
let userId = '';

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-shares-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', appUrl: 'https://studio.example' });
  const ws = workspaces.create('Bureau').id;
  userId = users.create({ email: 'maker@bureau.test', name: 'Maker', passwordHash: 'x' }).id;
  await seedSystemLibrary();
  projectId = (await createSampleProject(ws, fixtures))!.id;
  const logo = assets.list({ projectId }).find((a) => a.originalName === 'Logo.svg')!;
  for (const type of ['poster', 'mug']) {
    const scene = scenes.list({ library: true }).find((s) => s.objectType === type)!;
    const m = createMockup({ projectId, sceneId: scene.id, assetId: logo.id });
    await renderPreview(m);
    mockupIds.push(m.id);
  }
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('klantpresentaties', () => {
  it('maakt een geheime link die zonder account de mockups toont', () => {
    const { url, token, share } = createShare({ projectId, title: 'Huisstijl ronde 1', message: 'Graag je reactie voor vrijdag.', mockupIds, userId });
    expect(url).toBe(`https://studio.example/p/${token}`);
    expect(token.length).toBeGreaterThanOrEqual(40);
    // Alleen de hash staat in de database.
    expect(JSON.stringify(getDb().prepare('SELECT * FROM shares').all())).not.toContain(token);
    const view = publicView(shareByToken(token));
    expect(view.title).toBe('Huisstijl ronde 1');
    expect(view.mockups).toHaveLength(2);
    expect(view.mockups[0]!.previewUrl).toMatch(/^\/api\/files\/.+[?&]s=/);
    expect(share.allowDownload).toBe(false);
    // De link is opnieuw op te vragen voor de maker.
    expect(ownerView(projectId)[0]!.path).toBe(`/p/${token}`);
  });

  it('legt akkoord en wijzigingsverzoeken vast en mailt de maker', async () => {
    const s = shares.list(projectId)[0]!;
    const token = ownerView(projectId)[0]!.path!.slice(3);
    await addFeedback(s, { mockupId: mockupIds[0]!, kind: 'approve', name: 'Klant', body: '' });
    await addFeedback(s, { mockupId: mockupIds[1]!, kind: 'changes', name: 'Klant', body: 'Logo iets kleiner op de mok.' });
    await expect(addFeedback(s, { mockupId: mockupIds[1]!, kind: 'changes', name: 'Klant', body: '' })).rejects.toThrow(/welke wijziging/);
    await expect(addFeedback(s, { mockupId: 'bestaat-niet', kind: 'approve', name: 'Klant', body: '' })).rejects.toThrow(/hoort niet/);
    const view = publicView(shareByToken(token));
    expect(view.decisions[mockupIds[0]!]!.kind).toBe('approve');
    expect(view.decisions[mockupIds[1]!]!.kind).toBe('changes');
    // Later toch akkoord: het laatste besluit telt.
    await addFeedback(s, { mockupId: mockupIds[1]!, kind: 'approve', name: 'Klant', body: '' });
    expect(publicView(shareByToken(token)).decisions[mockupIds[1]!]!.kind).toBe('approve');
    await new Promise((r) => setTimeout(r, 100));
    const outbox = readdirSync(path.join(dir, 'outbox'));
    const mails = outbox.map((f) => JSON.parse(readFileSync(path.join(dir, 'outbox', f), 'utf8')));
    expect(mails.some((m) => m.to === 'maker@bureau.test' && /vraagt een wijziging/.test(m.subject) && /kleiner/.test(m.text))).toBe(true);
  });

  it('weigert ingetrokken, verlopen en verzonnen links', () => {
    const { token, share } = createShare({ projectId, title: 'Tijdelijk', mockupIds: [mockupIds[0]!], userId, expiresInDays: 1 });
    expect(() => shareByToken(token)).not.toThrow();
    getDb().prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), share.id);
    expect(() => shareByToken(token)).toThrow(/verlopen/);
    const other = createShare({ projectId, title: 'Ingetrokken', mockupIds: [mockupIds[0]!], userId });
    shares.revoke(other.share.id);
    expect(() => shareByToken(other.token)).toThrow(/niet gevonden/i);
    expect(() => shareByToken('a'.repeat(43))).toThrow(/niet gevonden/i);
    expect(() => shareByToken('../../etc')).toThrow(/niet gevonden/i);
  });

  it('staat downloaden alleen toe als de maker dat heeft aangezet', async () => {
    const closed = createShare({ projectId, title: 'Zonder download', mockupIds, userId });
    await expect(downloadFor(closed.share, mockupIds[0]!)).rejects.toThrow(/staat uit/);
    const open = createShare({ projectId, title: 'Met download', mockupIds, userId, allowDownload: true });
    const e = await downloadFor(open.share, mockupIds[0]!);
    expect(e.width).toBeGreaterThan(0);
    await expect(downloadFor(open.share, 'onbekend')).rejects.toThrow(/niet gevonden/i);
  });
});
