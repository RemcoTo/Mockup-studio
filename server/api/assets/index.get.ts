import { assets, projects } from '../../lib/repositories';

import { apiHandler } from '../../lib/http/api';
import { present } from '../../lib/http/present';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler((event) => {
  const ctx = requireWorkspace(event);
  const q = getQuery(event);
  const names = new Map(projects.list(ctx.workspace.id).map((p) => [p.id, p.name]));
  const projectId = typeof q.projectId === 'string' && names.has(q.projectId) ? q.projectId : undefined;
  return assets
    .list({ workspaceId: ctx.workspace.id, projectId, kind: q.kind === 'reference' ? 'reference' : q.kind === 'design' ? 'design' : undefined })
    .map((a) => ({ ...present.asset(a), projectName: names.get(a.projectId) ?? '' }));
});
