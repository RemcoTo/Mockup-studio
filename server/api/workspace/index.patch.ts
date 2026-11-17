import { z } from 'zod';
import { workspaces } from '../../lib/repo-accounts';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'admin');
  const { name } = parse(z.object({ name: z.string().trim().min(1, 'geef de werkruimte een naam').max(120) }), await readBody(event));
  const w = workspaces.update(ctx.workspace.id, { name })!;
  return { id: w.id, name: w.name };
});
