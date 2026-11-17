// Databasetoegang voor accounts: gebruikers, sessies, werkruimtes, lidmaatschappen, uitnodigingen,
// e-mailtokens en het creditgrootboek.
import type { Role } from '../../shared/roles';
import { getDb } from './db';
import { newId, now } from './ids';

type Row = Record<string, unknown>;
const all = (sql: string, ...p: unknown[]) => getDb().prepare(sql).all(...(p as never[])) as Row[];
const one = (sql: string, ...p: unknown[]) => getDb().prepare(sql).get(...(p as never[])) as Row | undefined;
const run = (sql: string, ...p: unknown[]) => getDb().prepare(sql).run(...(p as never[]));

export interface User { id: string; email: string; name: string; passwordHash: string; emailVerifiedAt: string | null; isAdmin: boolean; createdAt: string; lastLoginAt: string | null }
export interface Workspace { id: string; name: string; plan: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; subscriptionStatus: string | null; currentPeriodEnd: string | null; createdAt: string }
export interface Session { id: string; userId: string; workspaceId: string | null; createdAt: string; expiresAt: string; lastSeenAt: string }
export interface Invitation { id: string; workspaceId: string; email: string; role: Exclude<Role, 'owner'>; tokenHash: string; invitedBy: string | null; expiresAt: string; acceptedAt: string | null; createdAt: string }

const toUser = (r: Row): User => ({
  id: r.id as string, email: r.email as string, name: r.name as string, passwordHash: r.password_hash as string,
  emailVerifiedAt: (r.email_verified_at as string) ?? null, isAdmin: !!r.is_admin, createdAt: r.created_at as string, lastLoginAt: (r.last_login_at as string) ?? null,
});
const toWorkspace = (r: Row): Workspace => ({
  id: r.id as string, name: r.name as string, plan: r.plan as string, stripeCustomerId: (r.stripe_customer_id as string) ?? null,
  stripeSubscriptionId: (r.stripe_subscription_id as string) ?? null, subscriptionStatus: (r.subscription_status as string) ?? null,
  currentPeriodEnd: (r.current_period_end as string) ?? null, createdAt: r.created_at as string,
});
const toInvitation = (r: Row): Invitation => ({
  id: r.id as string, workspaceId: r.workspace_id as string, email: r.email as string, role: r.role as Invitation['role'],
  tokenHash: r.token_hash as string, invitedBy: (r.invited_by as string) ?? null, expiresAt: r.expires_at as string,
  acceptedAt: (r.accepted_at as string) ?? null, createdAt: r.created_at as string,
});

export const users = {
  get(id: string) { const r = one('SELECT * FROM users WHERE id = ?', id); return r ? toUser(r) : null; },
  byEmail(email: string) { const r = one('SELECT * FROM users WHERE email = ?', email.trim()); return r ? toUser(r) : null; },
  create(data: { email: string; name: string; passwordHash: string; isAdmin?: boolean }): User {
    const u: User = { id: newId(), email: data.email.trim(), name: data.name.trim(), passwordHash: data.passwordHash, emailVerifiedAt: null, isAdmin: !!data.isAdmin, createdAt: now(), lastLoginAt: null };
    run('INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.email, u.name, u.passwordHash, u.isAdmin ? 1 : 0, u.createdAt);
    return u;
  },
  update(id: string, data: Partial<Pick<User, 'name' | 'passwordHash' | 'emailVerifiedAt' | 'lastLoginAt' | 'isAdmin'>>) {
    const u = this.get(id);
    if (!u) return null;
    const n = { ...u, ...data };
    run('UPDATE users SET name = ?, password_hash = ?, email_verified_at = ?, last_login_at = ?, is_admin = ? WHERE id = ?', n.name, n.passwordHash, n.emailVerifiedAt, n.lastLoginAt, n.isAdmin ? 1 : 0, id);
    return n;
  },
  count() { return Number(one('SELECT COUNT(*) AS n FROM users')!.n); },
  list(limit = 200) { return all('SELECT * FROM users ORDER BY created_at DESC LIMIT ?', limit).map(toUser); },
  remove(id: string) { run('DELETE FROM users WHERE id = ?', id); },
};

export const sessions = {
  get(id: string): Session | null {
    const r = one('SELECT * FROM sessions WHERE id = ?', id);
    return r ? { id: r.id as string, userId: r.user_id as string, workspaceId: (r.workspace_id as string) ?? null, createdAt: r.created_at as string, expiresAt: r.expires_at as string, lastSeenAt: r.last_seen_at as string } : null;
  },
  create(data: { id: string; userId: string; workspaceId: string | null; expiresAt: string; ip: string; userAgent: string }) {
    run('INSERT INTO sessions (id, user_id, workspace_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      data.id, data.userId, data.workspaceId, now(), data.expiresAt, now(), data.ip.slice(0, 64), data.userAgent.slice(0, 300));
  },
  touch(id: string, expiresAt: string) { run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now(), expiresAt, id); },
  setWorkspace(id: string, workspaceId: string) { run('UPDATE sessions SET workspace_id = ? WHERE id = ?', workspaceId, id); },
  remove(id: string) { run('DELETE FROM sessions WHERE id = ?', id); },
  removeForUser(userId: string, exceptId?: string) { run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, exceptId ?? ''); },
  purgeExpired() { run('DELETE FROM sessions WHERE expires_at < ?', now()); },
};

export const emailTokens = {
  create(id: string, userId: string, purpose: 'verify' | 'reset', expiresAt: string) {
    run('INSERT INTO email_tokens (id, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', id, userId, purpose, expiresAt, now());
  },
  get(id: string) {
    const r = one('SELECT * FROM email_tokens WHERE id = ?', id);
    return r ? { id: r.id as string, userId: r.user_id as string, purpose: r.purpose as 'verify' | 'reset', expiresAt: r.expires_at as string, usedAt: (r.used_at as string) ?? null } : null;
  },
  use(id: string) { run('UPDATE email_tokens SET used_at = ? WHERE id = ?', now(), id); },
  invalidate(userId: string, purpose: 'verify' | 'reset') { run('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', now(), userId, purpose); },
};

export const workspaces = {
  get(id: string) { const r = one('SELECT * FROM workspaces WHERE id = ?', id); return r ? toWorkspace(r) : null; },
  create(name: string): Workspace {
    const w: Workspace = { id: newId(), name: name.trim(), plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, createdAt: now() };
    run('INSERT INTO workspaces (id, name, plan, created_at) VALUES (?, ?, ?, ?)', w.id, w.name, w.plan, w.createdAt);
    return w;
  },
  update(id: string, data: Partial<Omit<Workspace, 'id' | 'createdAt'>>) {
    const w = this.get(id);
    if (!w) return null;
    const n = { ...w, ...data };
    run('UPDATE workspaces SET name = ?, plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ?, current_period_end = ? WHERE id = ?',
      n.name, n.plan, n.stripeCustomerId, n.stripeSubscriptionId, n.subscriptionStatus, n.currentPeriodEnd, id);
    return n;
  },
  byStripeCustomer(customerId: string) { const r = one('SELECT * FROM workspaces WHERE stripe_customer_id = ?', customerId); return r ? toWorkspace(r) : null; },
  forUser(userId: string): (Workspace & { role: Role })[] {
    return all('SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at', userId)
      .map((r) => ({ ...toWorkspace(r), role: r.role as Role }));
  },
  list(limit = 200) { return all('SELECT * FROM workspaces ORDER BY created_at DESC LIMIT ?', limit).map(toWorkspace); },
  remove(id: string) { run('DELETE FROM workspaces WHERE id = ?', id); },
};

export const memberships = {
  role(workspaceId: string, userId: string): Role | null {
    const r = one('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
    return r ? (r.role as Role) : null;
  },
  add(workspaceId: string, userId: string, role: Role) {
    run('INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role', workspaceId, userId, role, now());
  },
  setRole(workspaceId: string, userId: string, role: Role) { run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', role, workspaceId, userId); },
  remove(workspaceId: string, userId: string) { run('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, userId); },
  members(workspaceId: string) {
    return all('SELECT u.id, u.email, u.name, u.last_login_at, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at', workspaceId)
      .map((r) => ({ id: r.id as string, email: r.email as string, name: r.name as string, role: r.role as Role, lastLoginAt: (r.last_login_at as string) ?? null, joinedAt: r.created_at as string }));
  },
  countOwners(workspaceId: string) { return Number(one("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'", workspaceId)!.n); },
  count(workspaceId: string) { return Number(one('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?', workspaceId)!.n); },
};

export const invitations = {
  create(data: Omit<Invitation, 'id' | 'acceptedAt' | 'createdAt'>): Invitation {
    const i: Invitation = { ...data, id: newId(), acceptedAt: null, createdAt: now() };
    run('INSERT INTO invitations (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      i.id, i.workspaceId, i.email, i.role, i.tokenHash, i.invitedBy, i.expiresAt, i.createdAt);
    return i;
  },
  byToken(hash: string) { const r = one('SELECT * FROM invitations WHERE token_hash = ?', hash); return r ? toInvitation(r) : null; },
  get(id: string) { const r = one('SELECT * FROM invitations WHERE id = ?', id); return r ? toInvitation(r) : null; },
  pending(workspaceId: string) { return all('SELECT * FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC', workspaceId, now()).map(toInvitation); },
  accept(id: string) { run('UPDATE invitations SET accepted_at = ? WHERE id = ?', now(), id); },
  remove(id: string) { run('DELETE FROM invitations WHERE id = ?', id); },
};

export const credits = {
  balance(workspaceId: string) { return Number(one('SELECT COALESCE(SUM(delta), 0) AS b FROM credit_ledger WHERE workspace_id = ?', workspaceId)!.b); },
  add(workspaceId: string, delta: number, reason: string, ref: string | null = null) {
    const id = newId();
    run('INSERT INTO credit_ledger (id, workspace_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, workspaceId, Math.round(delta), reason, ref, now());
    return id;
  },
  hasRef(workspaceId: string, reason: string, ref: string) { return !!one('SELECT 1 FROM credit_ledger WHERE workspace_id = ? AND reason = ? AND ref = ?', workspaceId, reason, ref); },
  history(workspaceId: string, limit = 100) {
    return all('SELECT * FROM credit_ledger WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?', workspaceId, limit)
      .map((r) => ({ id: r.id as string, delta: Number(r.delta), reason: r.reason as string, ref: (r.ref as string) ?? null, createdAt: r.created_at as string }));
  },
};
