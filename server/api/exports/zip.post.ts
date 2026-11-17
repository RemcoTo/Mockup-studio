import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { exportMockup, zipExports } from '../../lib/mockups';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireMockup } from '../../lib/http/auth';
const schema = z.object({
  mockupIds: z.array(z.string().max(40)).min(1).max(50),
  format: z.enum(['png', 'jpg']),
  quality: z.number().int().min(40).max(100).default(92),
});

/** Exporteert meerdere mockups in volle resolutie en levert ze als één zip. */
export default apiHandler(async (event) => {
  const body = parse(schema, await readBody(event));
  const list = body.mockupIds.map((id) => requireMockup(event, id));
  const projectId = list[0]!.project.id;
  if (list.some((m) => m.project.id !== projectId)) throw badRequest('Selecteer mockups uit één project.');
  rateLimit(`zip:${list[0]!.ctx.user.id}`, 30, 3600_000);
  const records = [];
  for (const { mockup } of list) records.push(await exportMockup(mockup, { format: body.format, quality: body.quality }));
  const zip = await zipExports(records, list[0]!.project.name);
  setHeader(event, 'Content-Type', 'application/zip');
  setHeader(event, 'Content-Disposition', 'attachment; filename="mockups.zip"');
  return Buffer.from(zip);
});
