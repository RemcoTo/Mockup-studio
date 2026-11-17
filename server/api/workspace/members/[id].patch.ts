import { z } from 'zod';
import { AppError, notFound } from '../../../lib/errors';
import { memberships } from '../../../lib/repo-accounts';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireWorkspace } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'admin');
  const userId = param(event);
  const { role } = parse(z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) }), await readBody(event));
  const current = memberships.role(ctx.workspace.id, userId);
  if (!current) throw notFound('Lid');
  // Eigenaarschap toekennen of afnemen kan alleen de eigenaar zelf.
  if ((role === 'owner' || current === 'owner') && ctx.role !== 'owner') throw new AppError(403, 'Alleen de eigenaar kan eigenaarschap toekennen of afnemen.', 'forbidden');
  if (current === 'owner' && role !== 'owner' && memberships.countOwners(ctx.workspace.id) <= 1) {
    throw new AppError(400, 'Een werkruimte heeft minimaal één eigenaar. Maak eerst iemand anders eigenaar.', 'last_owner');
  }
  memberships.setRole(ctx.workspace.id, userId, role);
  return { ok: true };
});
