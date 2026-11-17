
import { apiHandler, param } from '../../../lib/http/api';
import { present } from '../../../lib/http/present';
import { requireScene } from '../../../lib/http/auth';
export default apiHandler((event) => {
  const { scene, ctx } = requireScene(event, param(event), 'read');
  return { ...present.scene(scene), editable: scene.workspaceId === ctx.workspace.id || ctx.user.isAdmin };
});
