import { z } from 'zod';
import { log } from '../../lib/log';
import { memberships, sessions, workspaces } from '../../lib/repo-accounts';
import { transaction } from '../../lib/repositories';
import { rateLimit } from '../../lib/ratelimit';
import { createSampleProject } from '../../lib/seed';
import { parse } from '../../lib/validation';

import { apiHandler } from '../../lib/http/api';
import { requireUser } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const a = requireUser(event);
  rateLimit(`new-ws:${a.user.id}`, 10, 24 * 3600_000);
  const { name } = parse(z.object({ name: z.string().trim().min(1, 'geef de werkruimte een naam').max(120) }), await readBody(event));
  const ws = transaction(() => {
    const w = workspaces.create(name);
    memberships.add(w.id, a.user.id, 'owner');
    sessions.setWorkspace(a.session.id, w.id);
    return w;
  });
  await createSampleProject(ws.id).catch((e) => log.warn('workspace.sample_failed', { error: String(e) }));
  return { id: ws.id, name: ws.name };
});
