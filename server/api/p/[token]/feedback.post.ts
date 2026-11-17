import { z } from 'zod';
import { addFeedback, shareByToken } from '../../../lib/shares';
import { rateLimit } from '../../../lib/ratelimit';
import { parse } from '../../../lib/validation';

import { apiHandler } from '../../../lib/http/api';
import { clientIp } from '../../../lib/http/client';
const Body = z.object({
  mockupId: z.string().max(40).nullable(),
  kind: z.enum(['approve', 'changes', 'comment']),
  name: z.string().trim().min(1, 'Vul je naam in.').max(80),
  body: z.string().max(2000).default(''),
});

export default apiHandler(async (event) => {
  rateLimit(`share-feedback:${clientIp(event)}`, 60, 3600_000, 'Je hebt in korte tijd veel reacties gestuurd.');
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow');
  const s = shareByToken(getRouterParam(event, 'token')!);
  // Per presentatie een plafond, ook als iemand van veel adressen tegelijk reageert.
  rateLimit(`share-feedback-total:${s.id}`, 300, 86400_000, 'Deze presentatie heeft vandaag al heel veel reacties gekregen.');
  const f = await addFeedback(s, parse(Body, await readBody(event)));
  return { id: f.id, mockupId: f.mockupId, kind: f.kind, name: f.name, body: f.body, createdAt: f.createdAt };
});
