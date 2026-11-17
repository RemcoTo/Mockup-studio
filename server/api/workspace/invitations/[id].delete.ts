import { notFound } from '../../../lib/errors';
import { invitations } from '../../../lib/repo-accounts';

import { apiHandler, param } from '../../../lib/http/api';
import { requireWorkspace } from '../../../lib/http/auth';
export default apiHandler((event) => {
  const ctx = requireWorkspace(event, 'admin');
  const inv = invitations.get(param(event));
  if (!inv || inv.workspaceId !== ctx.workspace.id) throw notFound('Uitnodiging');
  invitations.remove(inv.id);
  return { ok: true };
});
