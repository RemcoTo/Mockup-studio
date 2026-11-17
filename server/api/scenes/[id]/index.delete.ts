import { deleteScene } from '../../../lib/scenes';

import { apiHandler, param } from '../../../lib/http/api';
import { requireScene } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { scene } = requireScene(event, param(event), 'write');
  await deleteScene(scene.id);
  return { ok: true };
});
