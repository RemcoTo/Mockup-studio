import { z } from 'zod';
import { assertProjectQuota } from '../../lib/billing/plans';
import { projects } from '../../lib/repositories';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
const schema = z.object({ name: z.string().trim().min(1, 'geef het project een naam').max(120), client: z.string().trim().max(120).optional(), url: z.string().trim().max(500).optional() });

export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'member');
  const body = parse(schema, await readBody(event));
  assertProjectQuota(ctx.workspace.id);
  return projects.create({ ...body, workspaceId: ctx.workspace.id });
});
