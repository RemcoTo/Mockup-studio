import { z } from 'zod';
import { requestPasswordReset } from '../../lib/auth/accounts';
import { log } from '../../lib/log';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { clientIp } from '../../lib/http/client';
export default apiHandler(async (event) => {
  const { email } = parse(z.object({ email: z.string().max(254) }), await readBody(event));
  rateLimit(`forgot-ip:${clientIp(event)}`, 10, 3600_000);
  rateLimit(`forgot-email:${email.trim().toLowerCase()}`, 3, 3600_000);
  // Altijd hetzelfde antwoord, ook als het versturen mislukt; de fout staat in de log.
  await requestPasswordReset(email).catch((e) => log.error('accounts.reset_mail_failed', { error: String(e) }));
  return { ok: true };
});
