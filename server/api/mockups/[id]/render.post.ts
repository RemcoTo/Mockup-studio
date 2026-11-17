import { z } from 'zod';
import { renderLive, validatePlacements } from '../../../lib/mockups';
import { rateLimit } from '../../../lib/ratelimit';
import { scenes } from '../../../lib/repositories';
import { parse, placementSchema } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup } from '../../../lib/http/auth';
/** Render met niet-opgeslagen instellingen, voor de preview in de editor. Exact dezelfde code als de export. */
export default apiHandler(async (event) => {
  const { mockup: m, ctx } = requireMockup(event, param(event));
  rateLimit(`render:${ctx.user.id}`, 600, 3600_000, 'Te veel voorbeeldweergaven in korte tijd.');
  const body = parse(z.object({ placements: z.array(placementSchema).max(12), width: z.number().int().min(320).max(2400) }), await readBody(event));
  validatePlacements(scenes.get(m.sceneId)!, m.projectId, body.placements);
  const buf = await renderLive({ sceneId: m.sceneId, placements: body.placements }, body.width);
  setHeader(event, 'Content-Type', 'image/webp');
  setHeader(event, 'Cache-Control', 'no-store');
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
});
