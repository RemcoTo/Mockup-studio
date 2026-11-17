import { workspaceList } from '../../../lib/admin';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
export default apiHandler((event) => {
  requirePlatformAdmin(event);
  const q = getQuery(event).q;
  return workspaceList(typeof q === 'string' ? q.slice(0, 80) : '');
});
