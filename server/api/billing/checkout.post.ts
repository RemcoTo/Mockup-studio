import { z } from 'zod';
import { createCheckout } from '../../lib/billing/stripe';
import { rateLimit } from '../../lib/ratelimit';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
const Body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), id: z.enum(['studio', 'team']) }),
  z.object({ kind: z.literal('topup'), id: z.string().max(40) }),
]);

export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'admin');
  rateLimit(`checkout:${ctx.workspace.id}`, 20, 3600_000);
  const item = parse(Body, await readBody(event));
  return { url: await createCheckout(ctx.workspace, ctx.user, item) };
});
