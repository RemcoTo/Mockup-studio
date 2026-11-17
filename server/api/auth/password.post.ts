import { z } from 'zod';
import { changePassword } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireUser } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const a = requireUser(event);
  rateLimit(`password:${a.user.id}`, 10, 3600_000);
  const body = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), await readBody(event));
  await changePassword(a.user, body.current, body.next, a.session.id);
  return { ok: true };
});
