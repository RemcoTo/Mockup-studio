import { z } from 'zod';
import { createMockup, renderPreview } from '../../lib/mockups';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireProject, requireMockup, requireScene } from '../../lib/http/auth';
import { present } from '../../lib/http/present';
const schema = z.object({
  projectId: z.string().min(1).max(40),
  sceneId: z.string().min(1).max(40),
  assetId: z.string().max(40).nullable(),
  /** Neem ontwerp en passing over van een bestaande mockup (zelfde ontwerp op een andere scène). */
  fromMockupId: z.string().max(40).optional(),
});

export default apiHandler(async (event) => {
  const body = parse(schema, await readBody(event));
  requireProject(event, body.projectId, 'member');
  requireScene(event, body.sceneId, 'read');
  const from = body.fromMockupId ? requireMockup(event, body.fromMockupId).mockup : null;
  const m = createMockup({ projectId: body.projectId, sceneId: body.sceneId, assetId: body.assetId, from });
  return present.mockup(await renderPreview(m).catch(() => m));
});
