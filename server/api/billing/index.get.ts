import { PLANS, TOPUPS } from '../../../shared/plans';
import { planSummary } from '../../lib/billing/plans';
import { stripeConfigured } from '../../lib/billing/stripe';
import { credits } from '../../lib/repo-accounts';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
/** Abonnement, tegoed en wat er te kiezen is. */
export default apiHandler((event) => {
  const ctx = requireWorkspace(event, 'viewer');
  const s = planSummary(ctx.workspace.id);
  return {
    current: { plan: s.plan.id, status: s.subscriptionStatus, currentPeriodEnd: s.currentPeriodEnd, hasCustomer: !!ctx.workspace.stripeCustomerId },
    enforced: s.enforced,
    stripe: stripeConfigured(),
    credits: { balance: s.credits, history: ctx.role === 'owner' || ctx.role === 'admin' ? credits.history(ctx.workspace.id, 40) : [] },
    plans: Object.values(PLANS), topups: TOPUPS,
    canManage: ctx.role === 'owner' || ctx.role === 'admin',
  };
});
