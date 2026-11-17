import { AppError, notFound } from '../../../lib/errors';
import { memberships, sessions } from '../../../lib/repo-accounts';

import { apiHandler, param } from '../../../lib/http/api';
import { getAuth, requireWorkspace } from '../../../lib/http/auth';
/** Een lid verwijderen, of jezelf uit de werkruimte halen. */
export default apiHandler((event) => {
  const userId = param(event);
  const self = getAuth(event)?.user.id === userId;
  const ctx = requireWorkspace(event, self ? 'viewer' : 'admin');
  const current = memberships.role(ctx.workspace.id, userId);
  if (!current) throw notFound('Lid');
  if (current === 'owner' && !self && ctx.role !== 'owner') throw new AppError(403, 'Alleen de eigenaar kan een eigenaar verwijderen.', 'forbidden');
  if (current === 'owner' && memberships.countOwners(ctx.workspace.id) <= 1) {
    throw new AppError(400, 'Een werkruimte heeft minimaal één eigenaar. Maak eerst iemand anders eigenaar.', 'last_owner');
  }
  memberships.remove(ctx.workspace.id, userId);
  if (self) sessions.setWorkspace(ctx.session.id, '');
  return { ok: true };
});
