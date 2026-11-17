import { z } from 'zod';
import { startGeneration } from '../../lib/generation/jobs';
import { rateLimit } from '../../lib/ratelimit';
import { parse, sceneConfigSchema } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireProject } from '../../lib/http/auth';
const schema = z.object({
  projectId: z.string().min(1).max(40),
  assetId: z.string().max(40).nullable(),
  config: sceneConfigSchema,
  count: z.number().int().min(1).max(6),
});

export default apiHandler(async (event) => {
  const body = parse(schema, await readBody(event));
  const { ctx } = requireProject(event, body.projectId, 'member');
  rateLimit(`generate:${ctx.workspace.id}`, 30, 3600_000, 'Je hebt in korte tijd veel generaties gestart.');
  return startGeneration({ ...body, userId: ctx.user.id });
});
