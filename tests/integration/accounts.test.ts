import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite, createSession, invite, login, requestPasswordReset, resetPassword, resolveSession, signup, verifyEmail, previewInvite } from '../../server/lib/auth/accounts';
import { hashPassword, passwordProblem, verifyPassword } from '../../server/lib/auth/password';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { readOutbox } from '../../server/lib/mail';
import { memberships, users } from '../../server/lib/repo-accounts';
import { projects } from '../../server/lib/repositories';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-accounts-'));
  // Deze tests gaan over de bevestigingsflow; die staat standaard uit en wordt hier aangezet.
  setConfig({ dataDir: dir, appUrl: 'http://studio.test', smtpUrl: '', allowSignup: true, requireEmailVerification: true });
  process.env.NUXT_SEED_DEMO = 'false';
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.NUXT_SEED_DEMO; });

const linkFrom = (text: string) => /(http:\/\/studio\.test\S+)/.exec(text)![1]!;
const tokenFrom = (url: string) => new URL(url).searchParams.get('token') ?? url.split('/').pop()!;

describe('wachtwoorden', () => {
  it('hasht met scrypt en controleert correct', async () => {
    const h = await hashPassword('een lang wachtwoord');
    expect(h.startsWith('scrypt$65536$8$2$')).toBe(true);
    expect(await verifyPassword('een lang wachtwoord', h)).toBe(true);
    expect(await verifyPassword('een ander wachtwoord', h)).toBe(false);
  });
  it('weigert zwakke wachtwoorden met uitleg', () => {
    expect(passwordProblem('kort')).toMatch(/tien/);
    expect(passwordProblem('wachtwoord123')).toMatch(/voorspelbaar/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/hetzelfde/);
    expect(passwordProblem('thijs-is-de-baas', 'thijs@voorbeeld.nl')).toMatch(/e-mailadres/);
    expect(passwordProblem('paarse olifant op de fiets')).toBeNull();
  });
});

describe('registreren, inloggen en sessies', () => {
  it('maakt bij de eerste registratie een beheerder met eigen werkruimte en neemt oude projecten mee', async () => {
    const orphan = projects.create({ workspaceId: null as unknown as string, name: 'Van vóór de accounts' });
    const { user, workspace } = await signup({ email: 'Eigenaar@Bureau.nl', name: 'Eva Eigenaar', password: 'paarse olifant op de fiets' });
    expect(user.email).toBe('eigenaar@bureau.nl');
    expect(user.isAdmin).toBe(true);
    expect(memberships.role(workspace.id, user.id)).toBe('owner');
    expect(projects.get(orphan.id)!.workspaceId).toBe(workspace.id);
  });

  it('weigert een dubbel e-mailadres en een fout wachtwoord met dezelfde melding als een onbekend adres', async () => {
    await expect(signup({ email: 'eigenaar@bureau.nl', name: 'X', password: 'paarse olifant op de fiets' })).rejects.toThrow(/bestaat al/);
    await expect(login('eigenaar@bureau.nl', 'fout wachtwoord!!')).rejects.toThrow(/horen niet bij elkaar/);
    await expect(login('niemand@bureau.nl', 'fout wachtwoord!!')).rejects.toThrow(/horen niet bij elkaar/);
  });

  it('maakt een sessie die alleen met de echte token werkt', async () => {
    const user = await login('eigenaar@bureau.nl', 'paarse olifant op de fiets');
    const s = createSession(user, '127.0.0.1', 'test');
    expect(resolveSession(s.token)!.user.id).toBe(user.id);
    expect(resolveSession(s.token + 'x')).toBeNull();
  });

  it('bevestigt het e-mailadres via de link uit de mail, maar maar één keer', async () => {
    const mail = (await readOutbox()).find((m) => m.subject.startsWith('Bevestig'))!;
    expect(mail.to).toBe('eigenaar@bureau.nl');
    const token = tokenFrom(linkFrom(mail.text));
    expect(verifyEmail(token).emailVerifiedAt).toBeTruthy();
    expect(() => verifyEmail(token)).toThrow(/verlopen of al gebruikt/);
  });

  it('herstelt een wachtwoord, beëindigt oude sessies en verraadt niet welke adressen bestaan', async () => {
    const user = users.byEmail('eigenaar@bureau.nl')!;
    const old = createSession(user, '127.0.0.1', 'test');
    await requestPasswordReset('bestaat-niet@bureau.nl');
    await requestPasswordReset('eigenaar@bureau.nl');
    const resets = (await readOutbox()).filter((m) => m.subject.startsWith('Nieuw wachtwoord'));
    expect(resets).toHaveLength(1);
    const token = tokenFrom(linkFrom(resets[0]!.text));
    await expect(resetPassword(token, 'kort')).rejects.toThrow(/tien/);
    await resetPassword(token, 'blauwe giraf onder de brug');
    expect(resolveSession(old.token)).toBeNull();
    await expect(login('eigenaar@bureau.nl', 'blauwe giraf onder de brug')).resolves.toBeTruthy();
    await expect(resetPassword(token, 'nog een ander wachtwoord')).rejects.toThrow(/verlopen of al gebruikt/);
  });
});

describe('uitnodigingen', () => {
  it('nodigt uit per e-mail; de genodigde registreert en komt in dezelfde werkruimte', async () => {
    const owner = users.byEmail('eigenaar@bureau.nl')!;
    const ws = (await import('../../server/lib/repo-accounts')).workspaces.forUser(owner.id)[0]!;
    await invite(ws, 'collega@bureau.nl', 'member', owner);
    const mail = (await readOutbox()).find((m) => m.to === 'collega@bureau.nl')!;
    const token = tokenFrom(linkFrom(mail.text));
    expect(previewInvite(token)!.workspaceName).toBe(ws.name);
    await expect(signup({ email: 'iemand-anders@bureau.nl', name: 'X', password: 'paarse olifant op de fiets', inviteToken: token })).rejects.toThrow(/collega@bureau.nl/);
    const { user, workspace } = await signup({ email: 'collega@bureau.nl', name: 'Cas Collega', password: 'paarse olifant op de fiets', inviteToken: token });
    expect(workspace.id).toBe(ws.id);
    expect(memberships.role(ws.id, user.id)).toBe('member');
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(() => acceptInvite(token, user)).toThrow(/verlopen of al gebruikt/);
  });

  it('sluit registratie zonder uitnodiging als dat is ingesteld', async () => {
    setConfig({ allowSignup: false });
    await expect(signup({ email: 'vreemde@bureau.nl', name: 'V', password: 'paarse olifant op de fiets' })).rejects.toThrow(/uitnodiging/);
    setConfig({ allowSignup: true });
  });
});
