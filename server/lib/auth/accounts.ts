// Accounts: registreren, inloggen, sessies, e-mailverificatie, wachtwoordherstel en uitnodigingen.
import { assertSeat, grantWelcomeCreditsForUser } from '../billing/plans';
import { verificationRequired } from './verification';
import type { Role } from '../../../shared/roles';
import { getConfig } from '../config';
import { AppError, badRequest } from '../errors';
import { log } from '../log';
import { actionMail, sendMail } from '../mail';
import { projects, transaction } from '../repositories';
import { emailTokens, invitations, memberships, sessions, users, workspaces, type User, type Workspace } from '../repo-accounts';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './password';
import { hashToken, newToken } from './tokens';

export const SESSION_DAYS = 30;
const HOUR = 3600_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw badRequest('Vul een geldig e-mailadres in.', 'email_invalid');
  return e;
}

export interface SignupInput { email: string; name: string; password: string; workspaceName?: string; inviteToken?: string }

/** Wordt na het aanmaken van een nieuwe werkruimte aangeroepen (voorbeeldproject); ingesteld bij het opstarten. */
let onWorkspaceCreated: ((ws: Workspace) => Promise<void>) | null = null;
export function setWorkspaceCreatedHook(fn: (ws: Workspace) => Promise<void>) { onWorkspaceCreated = fn; }

export async function signup(input: SignupInput): Promise<{ user: User; workspace: Workspace }> {
  const cfg = getConfig();
  const email = normalizeEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw badRequest('Vul je naam in.', 'name_required');
  const problem = passwordProblem(input.password, email);
  if (problem) throw badRequest(problem, 'password_weak');

  const invite = input.inviteToken ? invitations.byToken(hashToken(input.inviteToken)) : null;
  if (input.inviteToken && (!invite || invite.acceptedAt || invite.expiresAt < new Date().toISOString())) {
    throw badRequest('Deze uitnodiging is verlopen of al gebruikt. Vraag om een nieuwe uitnodiging.', 'invite_invalid');
  }
  if (invite && invite.email.toLowerCase() !== email) throw badRequest(`Deze uitnodiging is voor ${invite.email}. Registreer met dat e-mailadres.`, 'invite_email');
  const firstUser = users.count() === 0;
  if (!cfg.allowSignup && !invite && !firstUser) throw new AppError(403, 'Registreren is op deze installatie alleen mogelijk met een uitnodiging.', 'signup_closed');
  if (users.byEmail(email)) throw new AppError(409, 'Er bestaat al een account met dit e-mailadres. Log in of herstel je wachtwoord.', 'email_taken');

  const passwordHash = await hashPassword(input.password);
  let createdWorkspace = false;
  const result = transaction(() => {
    // Opnieuw tellen binnen de transactie: bij twee gelijktijdige registraties wordt er maar één beheerder.
    const user = users.create({ email, name, passwordHash, isAdmin: firstUser && users.count() === 0 });
    let workspace: Workspace;
    if (invite) {
      workspace = workspaces.get(invite.workspaceId)!;
      memberships.add(workspace.id, user.id, invite.role);
      invitations.accept(invite.id);
      // Het e-mailadres is bewezen: de uitnodiging kwam op dit adres binnen.
      users.update(user.id, { emailVerifiedAt: new Date().toISOString() });
    } else {
      workspace = workspaces.create((input.workspaceName?.trim() || `Werkruimte van ${name.split(' ')[0]}`).slice(0, 120));
      memberships.add(workspace.id, user.id, 'owner');
      createdWorkspace = true;
      // Data van vóór de accounts gaat naar de eerste werkruimte, zodat niets verloren gaat.
      if (user.isAdmin) {
        const adopted = projects.adoptOrphans(workspace.id);
        if (adopted) log.info('accounts.adopted_orphans', { workspace: workspace.id, projects: adopted });
      }
    }
    return { user: users.get(user.id)!, workspace };
  });
  log.info('accounts.signup', { user: result.user.id, workspace: result.workspace.id, invited: !!invite });
  if (createdWorkspace && onWorkspaceCreated) await onWorkspaceCreated(result.workspace).catch((e) => log.warn('accounts.workspace_hook_failed', { error: String(e) }));
  if (!verificationRequired()) grantWelcomeCreditsForUser(result.user.id);
  else if (!result.user.emailVerifiedAt) await sendVerification(result.user).catch((e) => log.warn('accounts.verify_mail_failed', { error: String(e) }));
  return result;
}

export async function login(emailRaw: string, password: string): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const user = email ? users.byEmail(email) : null;
  if (!user) {
    await burnPasswordCheck(password);
    throw new AppError(401, 'Dit e-mailadres en wachtwoord horen niet bij elkaar.', 'invalid_credentials');
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    log.info('accounts.login_failed', { user: user.id });
    throw new AppError(401, 'Dit e-mailadres en wachtwoord horen niet bij elkaar.', 'invalid_credentials');
  }
  users.update(user.id, { lastLoginAt: new Date().toISOString() });
  return user;
}

export function createSession(user: User, ip: string, userAgent: string, workspaceId?: string | null): { token: string; expiresAt: string } {
  const token = newToken();
  const ws = workspaceId && memberships.role(workspaceId, user.id) ? workspaceId : workspaces.forUser(user.id)[0]?.id ?? null;
  const expiresAt = iso(SESSION_DAYS * 24 * HOUR);
  sessions.create({ id: hashToken(token), userId: user.id, workspaceId: ws, expiresAt, ip, userAgent });
  return { token, expiresAt };
}

/** Zoekt de sessie bij een token. Verlengt de sessie hooguit één keer per uur. */
export function resolveSession(token: string) {
  const id = hashToken(token);
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < new Date().toISOString()) {
    sessions.remove(id);
    return null;
  }
  const user = users.get(s.userId);
  if (!user) return null;
  let renewed: string | null = null;
  if (Date.now() - new Date(s.lastSeenAt).getTime() > HOUR) {
    renewed = iso(SESSION_DAYS * 24 * HOUR);
    sessions.touch(id, renewed);
  }
  return { session: s, user, renewedUntil: renewed };
}

export function endSession(token: string) { sessions.remove(hashToken(token)); }

export async function sendVerification(user: User) {
  if (user.emailVerifiedAt) return;
  emailTokens.invalidate(user.id, 'verify');
  const token = newToken();
  emailTokens.create(hashToken(token), user.id, 'verify', iso(48 * HOUR));
  const url = `${getConfig().appUrl}/account/bevestigen?token=${token}`;
  await sendMail(actionMail(user.email, `Bevestig je e-mailadres voor ${getConfig().appName}`,
    `Hallo ${user.name.split(' ')[0]}, bevestig je e-mailadres om je account volledig te gebruiken.`,
    'E-mailadres bevestigen', url, 'De link is 48 uur geldig. Heb je geen account aangemaakt, dan kun je dit bericht negeren.'));
}

export function verifyEmail(token: string): User {
  const t = emailTokens.get(hashToken(token));
  if (!t || t.purpose !== 'verify' || t.usedAt || t.expiresAt < new Date().toISOString()) {
    throw badRequest('Deze bevestigingslink is verlopen of al gebruikt. Vraag in je account een nieuwe aan.', 'token_invalid');
  }
  emailTokens.use(t.id);
  const user = users.update(t.userId, { emailVerifiedAt: new Date().toISOString() })!;
  grantWelcomeCreditsForUser(user.id);
  return user;
}

/** Geeft altijd hetzelfde antwoord, zodat niet te achterhalen is welke e-mailadressen een account hebben. */
export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = email ? users.byEmail(email) : null;
  if (!user) return;
  emailTokens.invalidate(user.id, 'reset');
  const token = newToken();
  emailTokens.create(hashToken(token), user.id, 'reset', iso(HOUR));
  const url = `${getConfig().appUrl}/wachtwoord/nieuw?token=${token}`;
  await sendMail(actionMail(user.email, `Nieuw wachtwoord voor ${getConfig().appName}`,
    `Hallo ${user.name.split(' ')[0]}, met de knop hieronder kies je een nieuw wachtwoord.`,
    'Nieuw wachtwoord kiezen', url, 'De link is een uur geldig. Heb je dit niet aangevraagd, dan blijft je huidige wachtwoord gewoon werken.'));
}

export async function resetPassword(token: string, password: string): Promise<User> {
  const t = emailTokens.get(hashToken(token));
  if (!t || t.purpose !== 'reset' || t.usedAt || t.expiresAt < new Date().toISOString()) {
    throw badRequest('Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe aan.', 'token_invalid');
  }
  const user = users.get(t.userId)!;
  const problem = passwordProblem(password, user.email);
  if (problem) throw badRequest(problem, 'password_weak');
  emailTokens.use(t.id);
  // Wie een herstellink kan openen, bewijst ook het e-mailadres. Alle bestaande sessies vervallen.
  const updated = users.update(user.id, { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date().toISOString() })!;
  sessions.removeForUser(user.id);
  log.info('accounts.password_reset', { user: user.id });
  return updated;
}

export async function changePassword(user: User, current: string, next: string, keepSessionId: string) {
  if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Je huidige wachtwoord klopt niet.', 'invalid_credentials');
  const problem = passwordProblem(next, user.email);
  if (problem) throw badRequest(problem, 'password_weak');
  users.update(user.id, { passwordHash: await hashPassword(next) });
  sessions.removeForUser(user.id, keepSessionId);
}

export async function invite(workspace: Workspace, emailRaw: string, role: Exclude<Role, 'owner'>, by: User) {
  const email = normalizeEmail(emailRaw);
  const existing = users.byEmail(email);
  if (existing && memberships.role(workspace.id, existing.id)) throw new AppError(409, `${email} is al lid van deze werkruimte.`, 'already_member');
  for (const p of invitations.pending(workspace.id)) if (p.email.toLowerCase() === email) invitations.remove(p.id);
  assertSeat(workspace.id);
  const token = newToken();
  const inv = invitations.create({ workspaceId: workspace.id, email, role, tokenHash: hashToken(token), invitedBy: by.id, expiresAt: iso(7 * 24 * HOUR) });
  const url = `${getConfig().appUrl}/uitnodiging/${token}`;
  await sendMail(actionMail(email, `${by.name} nodigt je uit voor ${workspace.name}`,
    `${by.name} heeft je uitgenodigd om samen te werken in ${workspace.name} op ${getConfig().appName}.`,
    'Uitnodiging bekijken', url, 'De uitnodiging is zeven dagen geldig.'));
  return inv;
}

export function previewInvite(token: string) {
  const inv = invitations.byToken(hashToken(token));
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date().toISOString()) return null;
  const ws = workspaces.get(inv.workspaceId);
  const by = inv.invitedBy ? users.get(inv.invitedBy) : null;
  return ws ? { email: inv.email, role: inv.role, workspaceName: ws.name, invitedBy: by?.name ?? null, hasAccount: !!users.byEmail(inv.email) } : null;
}

export function acceptInvite(token: string, user: User): Workspace {
  const inv = invitations.byToken(hashToken(token));
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date().toISOString()) throw badRequest('Deze uitnodiging is verlopen of al gebruikt.', 'invite_invalid');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError(403, `Deze uitnodiging is voor ${inv.email}. Log in met dat account.`, 'invite_email');
  transaction(() => {
    if (!memberships.role(inv.workspaceId, user.id)) memberships.add(inv.workspaceId, user.id, inv.role);
    invitations.accept(inv.id);
    if (!user.emailVerifiedAt) users.update(user.id, { emailVerifiedAt: new Date().toISOString() });
  });
  return workspaces.get(inv.workspaceId)!;
}
