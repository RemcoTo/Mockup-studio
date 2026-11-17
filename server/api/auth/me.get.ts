import { mailMode } from '../../lib/mail';
import { verificationRequired } from '../../lib/auth/verification';
import { credits, workspaces } from '../../lib/repo-accounts';
import { users } from '../../lib/repo-accounts';
import { getConfig } from '../../lib/config';
import { creditsEnforced } from '../../lib/billing/credits';
import { billingEnabled, effectivePlan } from '../../lib/billing/plans';
import { PLANS } from '../../../shared/plans';

import { apiHandler } from '../../lib/http/api';
import { getAuth } from '../../lib/http/auth';
import { safeUser } from '../../lib/http/client';
/** Wie is ingelogd, in welke werkruimte, met welke rol. Zonder sessie: user null (geen fout). */
export default apiHandler((event) => {
  const a = getAuth(event);
  const cfg = getConfig();
  const site = { appName: cfg.appName, signupOpen: cfg.allowSignup || users.count() === 0, firstUser: users.count() === 0, mailMode: mailMode(), creditsEnforced: creditsEnforced(), emailVerification: verificationRequired() };
  if (!a) return { user: null, workspace: null, role: null, workspaces: [], site };
  return {
    user: safeUser(a.user),
    workspace: a.workspace ? {
      id: a.workspace.id, name: a.workspace.name, plan: effectivePlan(a.workspace).id, credits: credits.balance(a.workspace.id),
      // Zonder betalen is alles beschikbaar; anders de functies van het plan.
      features: billingEnabled() ? effectivePlan(a.workspace).features : PLANS.team.features,
    } : null,
    role: a.role,
    workspaces: workspaces.forUser(a.user.id).map((w) => ({ id: w.id, name: w.name, role: w.role })),
    site,
  };
});
