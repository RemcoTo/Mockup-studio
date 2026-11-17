import { z } from 'zod';
import { parse } from '../../../../../lib/validation';
import { publishScene } from '../../../../../lib/library/pipeline';

import { apiHandler } from '../../../../../lib/http/api';
import { requirePlatformAdmin } from '../../../../../lib/http/auth';
import { present } from '../../../../../lib/http/present';
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  const b = parse(z.object({ force: z.boolean().optional() }), await readBody(event));
  return present.scene(publishScene(getRouterParam(event, 'id')!, b));
});
