// Planlimieten afdwingen. Alleen actief als betalen aan staat (NUXT_BILLING_MODE=credits); zonder
// betalen (bijvoorbeeld een eigen installatie voor één bureau) is alles beschikbaar.
import { FEATURE_LABELS, PLANS, planById, type Feature, type Plan } from '../../../shared/plans';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { credits, invitations, memberships, workspaces, type Workspace } from '../repo-accounts';
import { getDb } from '../db';

export const billingEnabled = () => getConfig().billingMode === 'credits';

/** Een betaald plan geldt zolang het abonnement actief is; bij een mislukte betaling blijft het even geldig. */
const ACTIVE = new Set(['active', 'trialing', 'past_due']);
export function effectivePlan(ws: Pick<Workspace, 'plan' | 'subscriptionStatus'>): Plan {
  if (ws.plan === 'free' || !ACTIVE.has(ws.subscriptionStatus ?? '')) return PLANS.free;
  return planById(ws.plan);
}

function planOf(workspaceId: string): Plan {
  const ws = workspaces.get(workspaceId);
  return ws ? effectivePlan(ws) : PLANS.free;
}

/** Laagste plan dat een functie bevat, voor een duidelijke melding. */
function cheapestWith(feature: Feature): Plan {
  return Object.values(PLANS).filter((p) => p.features.includes(feature)).sort((a, b) => a.monthlyEur - b.monthlyEur)[0] ?? PLANS.team;
}

export class PlanLimitError extends AppError {
  constructor(message: string) { super(402, message, 'plan_limit'); }
}

export function hasFeature(workspaceId: string, feature: Feature) {
  return !billingEnabled() || planOf(workspaceId).features.includes(feature);
}

export function assertFeature(workspaceId: string, feature: Feature) {
  if (hasFeature(workspaceId, feature)) return;
  throw new PlanLimitError(`${FEATURE_LABELS[feature]} is beschikbaar vanaf het ${cheapestWith(feature).name}-abonnement.`);
}

export function assertProjectQuota(workspaceId: string) {
  if (!billingEnabled()) return;
  const plan = planOf(workspaceId);
  if (plan.projects === null) return;
  const n = Number((getDb().prepare('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?').get(workspaceId) as { n: number }).n);
  if (n >= plan.projects) throw new PlanLimitError(`Met ${plan.name} heb je maximaal ${plan.projects} projecten. Verwijder een project of kies een abonnement voor onbeperkt projecten.`);
}

export function assertSeat(workspaceId: string) {
  if (!billingEnabled()) return;
  const plan = planOf(workspaceId);
  const used = memberships.count(workspaceId) + invitations.pending(workspaceId).length;
  if (used >= plan.seats) {
    throw new PlanLimitError(plan.features.includes('teamInvites')
      ? `Je ${plan.name}-abonnement heeft plaats voor ${plan.seats} teamleden, inclusief openstaande uitnodigingen.`
      : `Teamleden uitnodigen is beschikbaar vanaf het ${cheapestWith('teamInvites').name}-abonnement.`);
  }
}

export function assertShareQuota(workspaceId: string) {
  if (!billingEnabled()) return;
  assertFeature(workspaceId, 'shares');
  const plan = planOf(workspaceId);
  if (plan.activeShares === null) return;
  const n = Number((getDb().prepare(`SELECT COUNT(*) AS n FROM shares s JOIN projects p ON p.id = s.project_id
    WHERE p.workspace_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)`).get(workspaceId, new Date().toISOString()) as { n: number }).n);
  if (n >= plan.activeShares) throw new PlanLimitError(`Met ${plan.name} kun je ${plan.activeShares} presentatie tegelijk delen. Trek een oude link in of kies een abonnement.`);
}

/** Langste zijde van een export, of null voor de volledige resolutie. */
export function maxExportEdge(workspaceId: string): number | null {
  return billingEnabled() ? planOf(workspaceId).maxExportEdge : null;
}

/**
 * Welkomstcredits: één keer per persoon, pas na een bevestigd e-mailadres, in de eerste werkruimte waarvan
 * die persoon eigenaar is. Zo levert het aanmaken van veel accounts of werkruimtes geen gratis AI op.
 */
export function grantWelcomeCreditsForUser(userId: string) {
  if (!billingEnabled()) return;
  const amount = PLANS.free.welcomeCredits;
  if (amount <= 0) return;
  const ref = `user:${userId}`;
  if (getDb().prepare("SELECT 1 FROM credit_ledger WHERE reason = 'welcome' AND ref = ?").get(ref)) return;
  const owned = workspaces.forUser(userId).find((w) => w.role === 'owner');
  if (owned) credits.add(owned.id, amount, 'welcome', ref);
}

export function planSummary(workspaceId: string) {
  const ws = workspaces.get(workspaceId)!;
  const plan = effectivePlan(ws);
  return { plan, enforced: billingEnabled(), subscriptionStatus: ws.subscriptionStatus, currentPeriodEnd: ws.currentPeriodEnd, credits: credits.balance(workspaceId) };
}
