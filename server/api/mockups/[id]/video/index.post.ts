import { z } from 'zod';
import { rateLimit } from '../../../../lib/ratelimit';
import { parse } from '../../../../lib/validation';
import { startScrollVideo } from '../../../../lib/video';

import { apiHandler, param } from '../../../../lib/http/api';
import { requireMockup } from '../../../../lib/http/auth';
/** Scrollvideo starten; het resultaat komt als export (MP4) bij de mockup. */
export default apiHandler(async (event) => {
  const { mockup, ctx } = requireMockup(event, param(event), 'member');
  rateLimit(`video:${ctx.workspace.id}`, 30, 3600_000, 'Je hebt in korte tijd veel video’s gemaakt.');
  const { width } = parse(z.object({ width: z.number().int() }), await readBody(event));
  setResponseStatus(event, 202);
  return startScrollVideo(mockup.id, width);
});
