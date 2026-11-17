import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { deleteWorkspace } from '../../lib/gdpr';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
/** Werkruimte definitief verwijderen, met alle projecten en bestanden. Alleen de eigenaar. */
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'owner');
  const { confirm } = parse(z.object({ confirm: z.string().max(200) }), await readBody(event));
  if (confirm.trim() !== ctx.workspace.name.trim()) throw badRequest('Typ de naam van de werkruimte precies over om te bevestigen.');
  await deleteWorkspace(ctx.workspace);
  return { ok: true };
});
