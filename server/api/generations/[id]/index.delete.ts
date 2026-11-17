import { deleteGeneration } from '../../../lib/generation/jobs';

import { apiHandler, param } from '../../../lib/http/api';
import { requireGeneration } from '../../../lib/http/auth';
/** Configuratie verwijderen; scènes en mockups die eruit zijn ontstaan blijven bestaan. */
export default apiHandler((event) => {
  const { generation, project } = requireGeneration(event, param(event), 'member');
  deleteGeneration(generation, project.workspaceId);
  return { ok: true };
});
