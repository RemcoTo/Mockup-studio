// Gegevens van klanten: export, werkruimte verwijderen, account verwijderen.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformSpend24h } from '../../server/lib/billing/credits';
import { dataPath, setConfig } from '../../server/lib/config';
import { closeDb, getDb } from '../../server/lib/db';
import { deleteAccount, deleteWorkspace, exportWorkspace } from '../../server/lib/gdpr';
import { memberships, users, workspaces } from '../../server/lib/repo-accounts';
import { generations, projects } from '../../server/lib/repositories';
import { createSampleProject, seedSystemLibrary } from '../../server/lib/seed';

const fixtures = path.resolve(__dirname, '../../fixtures');
let dir = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-gdpr-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  await seedSystemLibrary();
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

async function setup(name: string) {
  const ws = workspaces.create(name);
  const owner = users.create({ email: `${name.toLowerCase().replace(/\W/g, '')}@test.nl`, name, passwordHash: 'x' });
  memberships.add(ws.id, owner.id, 'owner');
  const p = (await createSampleProject(ws.id, fixtures))!;
  return { ws, owner, p };
}

describe('gegevens van klanten', () => {
  it('exporteert alle gegevens van een werkruimte', async () => {
    const { ws } = await setup('Export');
    const data = exportWorkspace(ws);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]!.designs.length).toBe(5); // website (2), logo, visitekaartje en een e-mailhandtekening
    expect(data.members[0]!.role).toBe('owner');
  });

  it('verwijdert een werkruimte met alle bestanden, maar houdt de AI-kosten voor het plafond', async () => {
    const { ws, p } = await setup('Weg');
    generations.insert({ id: 'g-test', projectId: p.id, status: 'done', config: { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma' }, prompt: 'x', count: 1, assetId: null, sceneIds: [], mockupIds: [], error: null, provider: 'openai', model: 'gpt-image-2', credits: 1, costUsd: 0.5, createdBy: null, createdAt: new Date().toISOString(), finishedAt: null });
    const spent = platformSpend24h();
    expect(existsSync(dataPath('files', 'ws', ws.id))).toBe(true);
    await deleteWorkspace(ws);
    expect(workspaces.get(ws.id)).toBeNull();
    expect(projects.get(p.id)).toBeNull();
    expect(existsSync(dataPath('files', 'ws', ws.id))).toBe(false);
    expect(platformSpend24h()).toBeCloseTo(spent, 6);
  });

  it('weigert te verwijderen met een lopend abonnement', async () => {
    const { ws } = await setup('Betalend');
    workspaces.update(ws.id, { plan: 'studio', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_x' });
    await expect(deleteWorkspace(workspaces.get(ws.id)!)).rejects.toThrow(/abonnement/);
  });

  it('verwijdert een account met de eigen werkruimtes, maar niet als anderen afhankelijk zijn', async () => {
    const { ws, owner } = await setup('Gedeeld');
    const colleague = users.create({ email: 'collega@test.nl', name: 'Collega', passwordHash: 'x' });
    memberships.add(ws.id, colleague.id, 'member');
    await expect(deleteAccount(owner)).rejects.toThrow(/enige eigenaar/);
    memberships.setRole(ws.id, colleague.id, 'owner');
    await deleteAccount(owner);
    expect(users.get(owner.id)).toBeNull();
    expect(workspaces.get(ws.id)).not.toBeNull(); // de collega werkt er nog in
    const solo = await setup('Alleen');
    await deleteAccount(solo.owner);
    expect(workspaces.get(solo.ws.id)).toBeNull();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(solo.owner.id)).toEqual({ n: 0 });
  });
});
