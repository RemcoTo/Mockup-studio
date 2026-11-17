import { z } from 'zod';
import { createSession, resetPassword } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { setSessionCookie } from '../../lib/http/auth';
import { clientIp, userAgent, safeUser } from '../../lib/http/client';
export default apiHandler(async (event) => {
  rateLimit(`reset-ip:${clientIp(event)}`, 20, 3600_000);
  const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().max(200) }), await readBody(event));
  const user = await resetPassword(body.token, body.password);
  const s = createSession(user, clientIp(event), userAgent(event));
  setSessionCookie(event, s.token, s.expiresAt);
  return { user: safeUser(user) };
});
