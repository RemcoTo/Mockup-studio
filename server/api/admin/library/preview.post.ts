import { z } from 'zod';
import { parse } from '../../../lib/validation';
import { libraryPreview } from '../../../lib/library/pipeline';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
const Body = z.object({ presetIds: z.array(z.string().max(80)).max(30), quality: z.enum(['low', 'medium', 'high']), provider: z.string().max(40).optional() });

export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  const b = parse(Body, await readBody(event));
  return libraryPreview(b.presetIds, b.quality, b.provider);
});
