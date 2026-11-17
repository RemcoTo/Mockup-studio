import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { verifyPassword } from '../../lib/auth/password';
import { deleteAccount } from '../../lib/gdpr';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { clearSessionCookie, requireUser } from '../../lib/http/auth';
/** Eigen account definitief verwijderen, na bevestiging met het wachtwoord. */
export default apiHandler(async (event) => {
  const a = requireUser(event);
  rateLimit(`delete-account:${a.user.id}`, 5, 3600_000);
  const { password } = parse(z.object({ password: z.string().max(200) }), await readBody(event));
  if (!(await verifyPassword(password, a.user.passwordHash))) throw new AppError(403, 'Het wachtwoord klopt niet.', 'bad_password');
  await deleteAccount(a.user);
  clearSessionCookie(event);
  return { ok: true };
});
