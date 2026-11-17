import { ownerView } from '../../../../lib/shares';

import { apiHandler, param } from '../../../../lib/http/api';
import { requireProject } from '../../../../lib/http/auth';
export default apiHandler((event) => {
  const { project } = requireProject(event, param(event), 'viewer');
  return ownerView(project.id);
});
