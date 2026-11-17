import { z } from 'zod';
import { previewGeneration } from '../../lib/generation/jobs';
import { parse, sceneConfigSchema } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  requireWorkspace(event);
  const body = parse(z.object({ config: sceneConfigSchema, count: z.number().int().min(1).max(6) }), await readBody(event));
  return previewGeneration(body.config, body.count);
});
