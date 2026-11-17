import { scenes } from '../../lib/repositories';

import { apiHandler } from '../../lib/http/api';
import { present } from '../../lib/http/present';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler((event) => {
  const ctx = requireWorkspace(event);
  const q = getQuery(event);
  const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 80) : undefined);
  let list = scenes.list({
    workspaceId: ctx.workspace.id,
    library: q.library === '1' || q.library === 'true',
    projectId: str(q.projectId),
    category: str(q.category),
    objectType: str(q.objectType),
    q: str(q.q),
  });
  // Filters op kenmerken van de foto.
  for (const key of ['material', 'angle', 'composition', 'color', 'orientation'] as const) {
    const v = str(q[key]);
    if (v) list = list.filter((s) => s.tags[key] === v);
  }
  return list.map((s) => ({ ...present.scene(s), editable: s.workspaceId === ctx.workspace.id || ctx.user.isAdmin }));
});
