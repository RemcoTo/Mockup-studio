import { z } from 'zod';
import { createShare } from '../../../../lib/shares';
import { rateLimit } from '../../../../lib/ratelimit';
import { parse } from '../../../../lib/validation';

import { apiHandler, param } from '../../../../lib/http/api';
import { requireProject } from '../../../../lib/http/auth';
const Body = z.object({
  title: z.string().trim().max(120).default(''),
  message: z.string().max(2000).default(''),
  mockupIds: z.array(z.string().max(40)).min(1).max(60),
  allowDownload: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(30),
});

export default apiHandler(async (event) => {
  const { project, ctx } = requireProject(event, param(event), 'member');
  rateLimit(`share-create:${ctx.user.id}`, 100, 3600_000);
  const b = parse(Body, await readBody(event));
  const { share, url, path } = createShare({ ...b, projectId: project.id, userId: ctx.user.id });
  return { id: share.id, url, path };
});
