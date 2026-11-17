import { projects } from '../../lib/repositories';
import { fileUrl } from '../../lib/storage';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler((event) => {
  const ctx = requireWorkspace(event);
  return projects.list(ctx.workspace.id).map((p) => ({ ...p, coverUrl: fileUrl(p.cover) }));
});
