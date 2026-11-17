import { assets, exportsRepo, generations, mockups, scenes } from '../../../lib/repositories';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler((event) => {
  const { project, ctx } = requireProject(event, param(event));
  return {
    project,
    role: ctx.role,
    assets: assets.list({ projectId: project.id }).map(present.asset),
    mockups: mockups.list({ projectId: project.id }).map(present.mockup),
    scenes: scenes.list({ workspaceId: ctx.workspace.id, projectId: project.id }).map(present.scene),
    generations: generations.list({ projectId: project.id }),
    exports: exportsRepo.list({ projectId: project.id }).map(present.export),
  };
});
