// Credits: afschrijven bij het starten van een generatie, terugboeken als die mislukt.
// Elke mutatie is een regel in het grootboek; het saldo is de som. Terugboeken is idempotent.
import { getConfig } from '../config';
import { getDb } from '../db';
import { AppError } from '../errors';
import { transaction } from '../repositories';
import { credits } from '../repo-accounts';
import { generations, libraryRuns } from '../repositories';

export const creditsEnforced = () => getConfig().billingMode === 'credits';

export function reserveCredits(workspaceId: string, amount: number, ref: string) {
  if (amount <= 0) return;
  transaction(() => {
    if (creditsEnforced()) {
      const balance = credits.balance(workspaceId);
      if (balance < amount) {
        throw new AppError(402, `Deze generatie kost ${amount} credits en je hebt er nog ${balance}. Kies een lagere kwaliteit of minder varianten, of vul je credits aan.`, 'insufficient_credits');
      }
    }
    credits.add(workspaceId, -amount, 'generation', ref);
  });
}

export function refundCredits(workspaceId: string, amount: number, ref: string) {
  if (amount <= 0) return;
  transaction(() => {
    if (credits.hasRef(workspaceId, 'refund', ref)) return;
    credits.add(workspaceId, amount, 'refund', ref);
  });
}

/**
 * Uitgavenplafonds per dag, voor het hele platform en per werkruimte, op basis van de geschatte kosten.
 * Beschermt tegen een fout of misbruik die in korte tijd veel AI-kosten maakt.
 */
export function assertSpendLimits(workspaceId: string, extraUsd: number, userId?: string | null) {
  const cfg = getConfig();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  assertPlatformSpend(extraUsd);
  const ws = generations.spendSince(since, workspaceId);
  if (ws + extraUsd > cfg.aiWorkspaceDailyLimitUsd) {
    throw new AppError(429, 'Het dagelijkse maximum voor AI-generaties van deze werkruimte is bereikt. Morgen kun je weer verder.', 'workspace_spend_limit');
  }
  // Ook per persoon, zodat meerdere werkruimtes niet tot meer AI-ruimte leiden.
  if (userId) {
    const mine = generations.spendByUserSince(userId, since);
    if (mine + extraUsd > cfg.aiWorkspaceDailyLimitUsd) {
      throw new AppError(429, 'Je persoonlijke dagelijkse maximum voor AI-generaties is bereikt. Morgen kun je weer verder.', 'user_spend_limit');
    }
  }
}

/** Platformbreed plafond: generaties van gebruikers plus de bibliotheekpijplijn, over de afgelopen 24 uur. */
export function platformSpend24h() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const archived = Number((getDb().prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM spend_archive WHERE created_at >= ?').get(since) as { s: number }).s);
  return generations.spendSince(since) + libraryRuns.spendSince(since) + archived;
}

export function assertPlatformSpend(extraUsd: number) {
  if (platformSpend24h() + extraUsd > getConfig().aiDailyLimitUsd) {
    throw new AppError(429, 'Het dagelijkse maximum voor AI-generaties op dit platform is bereikt. Probeer het later opnieuw.', 'platform_spend_limit');
  }
}
