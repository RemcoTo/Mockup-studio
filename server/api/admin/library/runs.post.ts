import { z } from 'zod';
import { rateLimit } from '../../../lib/ratelimit';
import { parse } from '../../../lib/validation';
import { startLibraryBatch } from '../../../lib/library/pipeline';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
const Body = z.object({
  presetIds: z.array(z.string().max(80)).min(1).max(30),
  quality: z.enum(['low', 'medium', 'high']),
  provider: z.string().max(40).optional(),
  /** De beheerder bevestigt het getoonde bedrag; wijkt het af, dan wordt er niets gestart. */
  confirmUsd: z.number().min(0),
});

export default apiHandler(async (event) => {
  const { user } = requirePlatformAdmin(event);
  rateLimit(`library-run:${user.id}`, 10, 3600_000, 'Je hebt in korte tijd veel bibliotheekruns gestart.');
  const b = parse(Body, await readBody(event));
  const res = startLibraryBatch({ presetIds: b.presetIds, quality: b.quality, providerId: b.provider, userId: user.id, expectUsd: b.confirmUsd });
  setResponseStatus(event, 202);
  return res;
});
