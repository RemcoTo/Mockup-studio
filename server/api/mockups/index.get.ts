import { mockups, projects } from '../../lib/repositories';

import { apiHandler } from '../../lib/http/api';
import { present } from '../../lib/http/present';
import { requireWorkspace } from '../../lib/http/auth';
/** Recent bewerkte mockups in de werkruimte, voor het dashboard. */
export default apiHandler((event) => {
  const ctx = requireWorkspace(event);
  const names = new Map(projects.list(ctx.workspace.id).map((p) => [p.id, p.name]));
  return mockups.list({ workspaceId: ctx.workspace.id }).filter((m) => m.previewFile).slice(0, 9).map((m) => ({ ...present.mockup(m), projectName: names.get(m.projectId) ?? '' }));
});
