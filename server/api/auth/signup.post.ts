import { z } from 'zod';
import { createSession, signup } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { setSessionCookie } from '../../lib/http/auth';
import { clientIp, userAgent, safeUser } from '../../lib/http/client';
const schema = z.object({
  email: z.string().max(254),
  name: z.string().max(120),
  password: z.string().max(200),
  workspaceName: z.string().max(120).optional(),
  inviteToken: z.string().max(200).optional(),
});

export default apiHandler(async (event) => {
  rateLimit(`signup:${clientIp(event)}`, 10, 3600_000, 'Te veel accounts aangemaakt vanaf dit adres.');
  // Vangnet voor het hele platform, ook als iemand vanaf veel adressen tegelijk registreert.
  rateLimit('signup:all', 300, 3600_000, 'Er worden op dit moment erg veel accounts aangemaakt. Probeer het over een uur opnieuw.');
  const body = parse(schema, await readBody(event));
  const { user, workspace } = await signup(body);
  const s = createSession(user, clientIp(event), userAgent(event), workspace.id);
  setSessionCookie(event, s.token, s.expiresAt);
  return { user: safeUser(user), workspaceId: workspace.id };
});
