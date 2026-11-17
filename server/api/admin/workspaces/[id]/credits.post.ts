import { z } from 'zod';
import { notFound } from '../../../../lib/errors';
import { log } from '../../../../lib/log';
import { credits, workspaces } from '../../../../lib/repo-accounts';
import { parse } from '../../../../lib/validation';

import { apiHandler, param } from '../../../../lib/http/api';
import { requirePlatformAdmin } from '../../../../lib/http/auth';
/** Credits bijschrijven of afschrijven (support, compensatie). Wordt gelogd met de beheerder erbij. */
export default apiHandler(async (event) => {
  const { user } = requirePlatformAdmin(event);
  const ws = workspaces.get(param(event));
  if (!ws) throw notFound('Werkruimte');
  const { amount, note } = parse(z.object({ amount: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, 'Vul een aantal in.'), note: z.string().trim().min(1, 'Geef een reden op.').max(200) }), await readBody(event));
  credits.add(ws.id, amount, 'grant', `${user.id}:${note}`);
  log.info('admin.credits', { workspace: ws.id, amount, by: user.id, note });
  return { balance: credits.balance(ws.id) };
});
