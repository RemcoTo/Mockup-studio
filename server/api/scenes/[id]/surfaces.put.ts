import { z } from 'zod';
import { saveSurfaces } from '../../../lib/scenes';
import { parse, surfaceInputSchema } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireScene } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler(async (event) => {
  const { scene } = requireScene(event, param(event), 'write');
  const { surfaces } = parse(z.object({ surfaces: z.array(surfaceInputSchema).max(12) }), await readBody(event));
  return present.scene(await saveSurfaces(scene.id, surfaces));
});
