import { notFound } from '../../../lib/errors';
import { shares } from '../../../lib/repositories';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
/** Link intrekken: werkt direct niet meer. De reacties blijven bewaard. */
export default apiHandler((event) => {
  const s = shares.get(param(event));
  if (!s) throw notFound('Presentatie');
  requireProject(event, s.projectId, 'member');
  shares.revoke(s.id);
  return { ok: true };
});
