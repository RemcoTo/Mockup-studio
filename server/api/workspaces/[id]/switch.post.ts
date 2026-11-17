import { notFound } from '../../../lib/errors';
import { memberships, sessions } from '../../../lib/repo-accounts';

import { apiHandler, param } from '../../../lib/http/api';
import { requireUser } from '../../../lib/http/auth';
export default apiHandler((event) => {
  const a = requireUser(event);
  const id = param(event);
  if (!memberships.role(id, a.user.id)) throw notFound('Werkruimte');
  sessions.setWorkspace(a.session.id, id);
  return { ok: true };
});
