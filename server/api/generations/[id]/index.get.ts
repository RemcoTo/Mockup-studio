import { mockups, scenes } from '../../../lib/repositories';

import { apiHandler, param } from '../../../lib/http/api';
import { requireGeneration } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler((event) => {
  const { generation: g } = requireGeneration(event, param(event));
  return {
    generation: g,
    mockups: g.mockupIds.map((id) => mockups.get(id)).filter((m) => !!m).map((m) => present.mockup(m!)),
    scenes: g.sceneIds.map((id) => scenes.get(id)).filter((s) => !!s).map((s) => present.scene(s!)),
  };
});
