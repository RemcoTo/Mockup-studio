// Gegevens van klanten: werkruimte verwijderen, account verwijderen en een export van alle gegevens.
// Verwijderen is definitief; de database ruimt via foreign keys alles van de werkruimte op en de
// bestanden worden van schijf gehaald. Een lopend abonnement moet eerst worden opgezegd.
import { AppError } from './errors';
import { getDb } from './db';
import { newId } from './ids';
import { log } from './log';
import { credits, memberships, users, workspaces, type User, type Workspace } from './repo-accounts';
import { assets, exportsRepo, generations, mockups, projects, scenes, shares } from './repositories';
import { keys } from './keys';
import { storage } from './storage';

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export async function deleteWorkspace(ws: Workspace) {
  if (ws.stripeSubscriptionId && ACTIVE.has(ws.subscriptionStatus ?? '')) {
    throw new AppError(409, 'Deze werkruimte heeft nog een lopend abonnement. Zeg dat eerst op via Abonnement, Abonnement beheren.', 'has_subscription');
  }
  const db = getDb();
  // Recente AI-kosten bewaren voor het platformplafond, zonder herleidbaarheid naar de werkruimte.
  const recent = db.prepare(`SELECT g.cost_usd, g.created_at FROM generations g JOIN projects p ON p.id = g.project_id
    WHERE p.workspace_id = ? AND g.status != 'failed' AND g.cost_usd > 0 AND g.created_at >= ?`).all(ws.id, new Date(Date.now() - 2 * 86400_000).toISOString()) as { cost_usd: number; created_at: string }[];
  for (const r of recent) db.prepare('INSERT INTO spend_archive (id, cost_usd, created_at) VALUES (?, ?, ?)').run(newId(), r.cost_usd, r.created_at);
  workspaces.remove(ws.id);
  await storage.remove(keys.workspace(ws.id));
  log.info('gdpr.workspace_deleted', { workspace: ws.id });
}

/**
 * Account verwijderen. Werkruimtes waarvan je de enige eigenaar bent: zonder andere leden worden ze
 * verwijderd; met andere leden moet je eerst iemand anders eigenaar maken.
 */
export async function deleteAccount(user: User) {
  const mine = workspaces.forUser(user.id);
  const blocking = mine.filter((w) => w.role === 'owner' && memberships.countOwners(w.id) === 1 && memberships.count(w.id) > 1);
  if (blocking.length) {
    throw new AppError(409, `Je bent de enige eigenaar van ${blocking.map((w) => `“${w.name}”`).join(', ')}, waar ook anderen in werken. Maak eerst iemand anders eigenaar of verwijder die werkruimte.`, 'sole_owner');
  }
  if (user.isAdmin && users.count() > 1 && Number((getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number }).n) === 1) {
    throw new AppError(409, 'Je bent de enige platformbeheerder. Draag dat eerst over voordat je je account verwijdert.', 'sole_admin');
  }
  for (const w of mine) {
    if (w.role === 'owner' && memberships.count(w.id) === 1) await deleteWorkspace(workspaces.get(w.id)!);
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(user.id);
  log.info('gdpr.account_deleted', { user: user.id });
}

/** Alle gegevens van een werkruimte als JSON (de bestanden zelf zijn per stuk te downloaden). */
export function exportWorkspace(ws: Workspace) {
  const ps = projects.list(ws.id);
  return {
    exportedAt: new Date().toISOString(),
    workspace: { id: ws.id, name: ws.name, plan: ws.plan, createdAt: ws.createdAt },
    members: memberships.members(ws.id).map((m) => ({ name: m.name, email: m.email, role: m.role, joinedAt: m.joinedAt })),
    credits: credits.history(ws.id, 100000),
    projects: ps.map((p) => ({
      id: p.id, name: p.name, client: p.client, url: p.url, createdAt: p.createdAt,
      designs: assets.list({ projectId: p.id }).map((a) => ({ id: a.id, name: a.originalName, type: a.mime, width: a.width, height: a.height, version: a.version, source: a.source, url: a.meta.url ?? null, sha256: a.meta.sha256 ?? null, createdAt: a.createdAt })),
      scenes: scenes.list({ projectId: p.id }).map((s) => ({ id: s.id, title: s.title, origin: s.origin, prompt: s.prompt, provider: s.provider, model: s.model, createdAt: s.createdAt })),
      mockups: mockups.list({ projectId: p.id }).map((m) => ({ id: m.id, sceneId: m.sceneId, placements: m.placements, createdAt: m.createdAt })),
      generations: generations.list({ projectId: p.id }).map((g) => ({ id: g.id, status: g.status, prompt: g.prompt, model: g.model, credits: g.credits, createdAt: g.createdAt })),
      exports: exportsRepo.list({ projectId: p.id }).map((e) => ({ id: e.id, mockupId: e.mockupId, format: e.format, width: e.width, height: e.height, createdAt: e.createdAt })),
      presentations: shares.list(p.id).map((s) => ({ title: s.title, createdAt: s.createdAt, revokedAt: s.revokedAt, feedback: shares.feedback(s.id).map((f) => ({ mockupId: f.mockupId, kind: f.kind, name: f.name, body: f.body, createdAt: f.createdAt })) })),
    })),
  };
}
