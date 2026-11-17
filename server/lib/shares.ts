// Klantpresentaties: een geheime, intrekbare link naar een selectie mockups. De klant bekijkt ze zonder
// account, geeft per mockup akkoord of vraagt een wijziging, en kan opmerkingen achterlaten. De maker krijgt
// een e-mail bij elke reactie. Alleen de hash van de link wordt opgeslagen.
import { getConfig } from './config';
import { AppError, badRequest, notFound } from './errors';
import { newId, now } from './ids';
import { log } from './log';
import { actionMail, sendMail } from './mail';
import { exportMockup } from './mockups';
import { createHmac } from 'node:crypto';
import { hashToken } from './auth/tokens';
import { appSecret } from './secret';
import { assertShareQuota } from './billing/plans';
import { users } from './repo-accounts';
import { exportsRepo, mockups, projects, scenes, shares, type Share, type ShareFeedback } from './repositories';
import { fileUrl } from './storage';

export const MAX_SHARE_MOCKUPS = 60;

/**
 * De link wordt afgeleid van het geheim van de applicatie en de id van de presentatie. Zo kan de maker
 * hem altijd opnieuw kopiëren, terwijl de database alleen een hash bevat. Intrekken gaat via revoked_at.
 */
const tokenFor = (shareId: string) => createHmac('sha256', appSecret()).update(`share:${shareId}`).digest('base64url');
export const sharePath = (shareId: string) => `/p/${tokenFor(shareId)}`;
export const shareUrl = (shareId: string) => `${getConfig().appUrl.replace(/\/$/, '')}${sharePath(shareId)}`;

export function createShare(input: { projectId: string; title: string; message?: string; mockupIds: string[]; allowDownload?: boolean; expiresInDays?: number | null; userId: string | null }) {
  const project = projects.get(input.projectId);
  if (!project) throw notFound('Project');
  assertShareQuota(project.workspaceId);
  const ids = [...new Set(input.mockupIds)];
  if (!ids.length) throw badRequest('Kies minstens één mockup om te delen.');
  if (ids.length > MAX_SHARE_MOCKUPS) throw badRequest(`Deel maximaal ${MAX_SHARE_MOCKUPS} mockups per presentatie.`);
  for (const id of ids) {
    const m = mockups.get(id);
    if (!m || m.projectId !== project.id) throw badRequest('Een van de mockups hoort niet bij dit project.');
  }
  const id = newId();
  const token = tokenFor(id);
  const days = input.expiresInDays ?? null;
  const share = shares.insert({
    id, tokenHash: hashToken(token), projectId: project.id, title: input.title.trim() || project.name, message: input.message?.trim() ?? '',
    mockupIds: ids, allowDownload: !!input.allowDownload, createdBy: input.userId, createdAt: now(),
    expiresAt: days ? new Date(Date.now() + days * 86400_000).toISOString() : null, revokedAt: null, lastViewedAt: null, views: 0,
  });
  return { share, url: shareUrl(id), path: sharePath(id), token };
}

/** Een geldige presentatie bij een link, of een nette fout zonder te verraden of hij ooit bestond. */
export function shareByToken(token: string): Share {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw notFound('Presentatie');
  const s = shares.byTokenHash(hashToken(token));
  if (!s || s.revokedAt) throw notFound('Presentatie');
  if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) throw new AppError(410, 'Deze presentatie is verlopen. Vraag de afzender om een nieuwe link.', 'expired');
  return s;
}

/** Laatste akkoord of wijzigingsverzoek per mockup. */
export function decisions(feedback: ShareFeedback[]) {
  const out: Record<string, { kind: 'approve' | 'changes'; name: string; at: string }> = {};
  for (const f of feedback) if (f.mockupId && (f.kind === 'approve' || f.kind === 'changes')) out[f.mockupId] = { kind: f.kind, name: f.name, at: f.createdAt };
  return out;
}

export function publicView(s: Share) {
  const project = projects.get(s.projectId)!;
  const feedback = shares.feedback(s.id);
  const items = s.mockupIds.map((id) => mockups.get(id)).filter((m) => !!m && m.previewFile).map((m) => {
    const scene = scenes.get(m!.sceneId);
    return { id: m!.id, previewUrl: fileUrl(m!.previewFile), width: scene?.width ?? 0, height: scene?.height ?? 0, title: scene?.title ?? '' };
  });
  return {
    title: s.title, message: s.message, client: project.client, allowDownload: s.allowDownload, expiresAt: s.expiresAt,
    mockups: items, decisions: decisions(feedback),
    // De klant ziet de opmerkingen van iedereen met de link; geen e-mailadressen of interne gegevens.
    feedback: feedback.map((f) => ({ id: f.id, mockupId: f.mockupId, kind: f.kind, name: f.name, body: f.body, createdAt: f.createdAt })),
  };
}

export async function addFeedback(s: Share, input: { mockupId: string | null; kind: ShareFeedback['kind']; name: string; body: string }) {
  if (input.mockupId && !s.mockupIds.includes(input.mockupId)) throw badRequest('Deze mockup hoort niet bij de presentatie.');
  if (input.kind === 'comment' && !input.body.trim()) throw badRequest('Schrijf een opmerking.');
  if (input.kind === 'changes' && !input.body.trim()) throw badRequest('Beschrijf kort welke wijziging je wilt.');
  if (input.kind !== 'comment' && !input.mockupId) throw badRequest('Kies de mockup waarop je reageert.');
  const f = shares.addFeedback({ id: newId(), shareId: s.id, mockupId: input.mockupId, kind: input.kind, name: input.name.trim().slice(0, 80), body: input.body.trim().slice(0, 2000), createdAt: now() });
  notifyOwner(s, f).catch((e) => log.warn('share.notify_failed', { error: (e as Error).message }));
  return f;
}

async function notifyOwner(s: Share, f: ShareFeedback) {
  const owner = s.createdBy ? users.get(s.createdBy) : null;
  if (!owner) return;
  const what = f.kind === 'approve' ? 'gaf akkoord op een mockup' : f.kind === 'changes' ? 'vraagt een wijziging' : 'plaatste een opmerking';
  const url = `${getConfig().appUrl.replace(/\/$/, '')}/projects/${s.projectId}?tab=feedback`;
  const quote = f.body ? `\n\n“${f.body}”` : '';
  await sendMail(actionMail(owner.email, `${f.name} ${what} in “${s.title}”`, `${f.name} ${what} in de presentatie “${s.title}”.${quote}`, 'Bekijk de reacties', url, 'Je ontvangt deze e-mail omdat je deze presentatie hebt gedeeld.'));
}

/** Download voor de klant: de nieuwste export van de mockup, of anders een PNG op presentatieformaat. */
export async function downloadFor(s: Share, mockupId: string) {
  if (!s.allowDownload) throw new AppError(403, 'Downloaden staat uit voor deze presentatie.', 'forbidden');
  if (!s.mockupIds.includes(mockupId)) throw notFound('Mockup');
  const m = mockups.get(mockupId);
  if (!m) throw notFound('Mockup');
  const existing = exportsRepo.list({ mockupId }).find((e) => e.format === 'png' || e.format === 'jpg');
  return existing ?? exportMockup(m, { format: 'png', quality: 92, width: 2400 });
}

export function ownerView(projectId: string) {
  return shares.list(projectId).map((s) => {
    const fb = shares.feedback(s.id);
    return {
      id: s.id, url: s.revokedAt ? null : shareUrl(s.id), path: s.revokedAt ? null : sharePath(s.id), title: s.title, mockupIds: s.mockupIds, allowDownload: s.allowDownload, createdAt: s.createdAt, expiresAt: s.expiresAt,
      revokedAt: s.revokedAt, views: s.views, lastViewedAt: s.lastViewedAt, decisions: decisions(fb), feedback: fb,
    };
  });
}
