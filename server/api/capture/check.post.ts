import { z } from 'zod';
import { checkReachable } from '../../lib/capture/ssrf';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'member');
  rateLimit(`check:${ctx.user.id}`, 120, 3600_000);
  const { url } = parse(z.object({ url: z.string().max(2000) }), await readBody(event));
  return checkReachable(url);
});
