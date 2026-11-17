import { atLeast } from '../../../shared/roles';
import { credits, invitations, memberships } from '../../lib/repo-accounts';
import { projects } from '../../lib/repositories';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler((event) => {
  const ctx = requireWorkspace(event);
  const canManage = atLeast(ctx.role, 'admin');
  return {
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, plan: ctx.workspace.plan, createdAt: ctx.workspace.createdAt, subscriptionStatus: ctx.workspace.subscriptionStatus, currentPeriodEnd: ctx.workspace.currentPeriodEnd },
    role: ctx.role,
    members: memberships.members(ctx.workspace.id),
    invitations: canManage ? invitations.pending(ctx.workspace.id).map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt })) : [],
    credits: { balance: credits.balance(ctx.workspace.id), history: canManage ? credits.history(ctx.workspace.id, 50) : [] },
    usage: { projects: projects.count(ctx.workspace.id), members: memberships.count(ctx.workspace.id) },
  };
});
