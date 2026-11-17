import { verificationRequired } from '../../lib/auth/verification';
import { sendVerification } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/ratelimit';

import { apiHandler } from '../../lib/http/api';
import { requireUser } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const { user } = requireUser(event);
  if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
  // Bevestigen staat uit: er gaat geen mail uit.
  if (!verificationRequired()) return { ok: true, notRequired: true };
  rateLimit(`verify-mail:${user.id}`, 3, 3600_000, 'Je hebt al een paar bevestigingsmails aangevraagd.');
  await sendVerification(user);
  return { ok: true };
});
