import { z } from 'zod';
import { exportMockup } from '../../../lib/mockups';
import { rateLimit } from '../../../lib/ratelimit';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
const schema = z.object({
  format: z.enum(['png', 'jpg', 'tiff']),
  quality: z.number().int().min(40).max(100).default(92),
  width: z.number().int().min(320).max(8000).optional(),
  preset: z.string().max(40).nullable().optional(),
  cmyk: z.boolean().optional(),
});

export default apiHandler(async (event) => {
  const { mockup, ctx } = requireMockup(event, param(event));
  rateLimit(`export:${ctx.user.id}`, 300, 3600_000);
  return present.export(await exportMockup(mockup, parse(schema, await readBody(event))));
});
