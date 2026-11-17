import { acceptInvite } from '../../../lib/auth/accounts';
import { sessions } from '../../../lib/repo-accounts';

import { apiHandler } from '../../../lib/http/api';
import { requireUser } from '../../../lib/http/auth';
export default apiHandler((event) => {
  const a = requireUser(event);
  const ws = acceptInvite(getRouterParam(event, 'token') ?? '', a.user);
  sessions.setWorkspace(a.session.id, ws.id);
  return { workspaceId: ws.id };
});
