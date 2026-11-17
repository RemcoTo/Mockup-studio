import { z } from 'zod';
import { invite } from '../../lib/auth/accounts';
import { AppError } from '../../lib/errors';
import { isVerified } from '../../lib/auth/verification';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'admin');
  if (!isVerified(ctx.user)) throw new AppError(403, 'Bevestig eerst je eigen e-mailadres voordat je anderen uitnodigt.', 'email_unverified');
  rateLimit(`invite:${ctx.workspace.id}`, 30, 3600_000);
  const body = parse(z.object({ email: z.string().max(254), role: z.enum(['admin', 'member', 'viewer']) }), await readBody(event));
  const inv = await invite(ctx.workspace, body.email, body.role, ctx.user);
  return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
});
