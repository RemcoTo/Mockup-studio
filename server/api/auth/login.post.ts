import { z } from 'zod';
import { createSession, login } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { setSessionCookie } from '../../lib/http/auth';
import { clientIp, userAgent, safeUser } from '../../lib/http/client';
export default apiHandler(async (event) => {
  const body = parse(z.object({ email: z.string().max(254), password: z.string().max(200) }), await readBody(event));
  rateLimit(`login-ip:${clientIp(event)}`, 30, 15 * 60_000);
  rateLimit(`login-email:${body.email.trim().toLowerCase()}`, 10, 15 * 60_000);
  const user = await login(body.email, body.password);
  const s = createSession(user, clientIp(event), userAgent(event));
  setSessionCookie(event, s.token, s.expiresAt);
  return { user: safeUser(user) };
});
