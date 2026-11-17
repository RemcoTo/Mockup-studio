import { z } from 'zod';
import { projects } from '../../../lib/repositories';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), client: z.string().trim().max(120).optional(), url: z.string().trim().max(500).optional() });

export default apiHandler(async (event) => {
  const { project } = requireProject(event, param(event), 'member');
  return projects.update(project.id, parse(schema, await readBody(event)));
});
