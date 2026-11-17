import { previewShoot } from '../../lib/generation/shoot';
import { parse, shootSchema } from '../../lib/validation';
import { assets } from '../../lib/repositories';

import { apiHandler } from '../../lib/http/api';
import { requireProject } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const b = parse(shootSchema, await readBody(event));
  const { project } = requireProject(event, b.projectId, 'viewer');
  // Alleen ontwerpen uit dit project tellen mee (hun afmetingen komen in de prompt).
  const items = b.items.map((it) => ({ ...it, assetId: it.assetId && assets.get(it.assetId)?.projectId === project.id ? it.assetId : null }));
  return previewShoot(b.title, b.direction, items, b.quality, undefined, b.devices3d);
});
