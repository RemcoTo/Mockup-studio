import { startShoot } from '../../lib/generation/shoot';
import { rateLimit } from '../../lib/ratelimit';
import { parse, shootSchema } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireProject, requireAsset } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const b = parse(shootSchema, await readBody(event));
  const { ctx } = requireProject(event, b.projectId, 'member');
  rateLimit(`generate:${ctx.workspace.id}`, 30, 3600_000, 'Je hebt in korte tijd veel generaties gestart.');
  for (const id of b.direction.referenceAssetIds ?? []) requireAsset(event, id, 'viewer');
  return startShoot({ ...b, userId: ctx.user.id });
});
