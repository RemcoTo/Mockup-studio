import { notFound } from '../../../lib/errors';
import { assets, exportsRepo, scenes } from '../../../lib/repositories';

import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler((event) => {
  const { mockup, project, ctx } = requireMockup(event, param(event));
  const scene = scenes.get(mockup.sceneId);
  if (!scene) throw notFound('Scène');
  return {
    mockup: present.mockup(mockup),
    scene: present.scene(scene),
    project,
    role: ctx.role,
    assets: assets.list({ projectId: mockup.projectId, kind: 'design' }).map(present.asset),
    exports: exportsRepo.list({ mockupId: mockup.id }).map(present.export),
  };
});
