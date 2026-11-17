import { z } from 'zod';
import { users } from '../../lib/repo-accounts';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireUser } from '../../lib/http/auth';
import { safeUser } from '../../lib/http/client';
export default apiHandler(async (event) => {
  const a = requireUser(event);
  const { name } = parse(z.object({ name: z.string().trim().min(1, 'vul je naam in').max(120) }), await readBody(event));
  return { user: safeUser(users.update(a.user.id, { name })!) };
});
