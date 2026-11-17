import { z } from 'zod';
import { verifyEmail } from '../../lib/auth/accounts';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { safeUser } from '../../lib/http/client';
export default apiHandler(async (event) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), await readBody(event));
  const user = verifyEmail(token);
  return { user: safeUser(user) };
});
