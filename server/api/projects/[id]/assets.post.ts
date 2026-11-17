import { badRequest } from '../../../lib/errors';
import { rateLimit } from '../../../lib/ratelimit';
import { ingestUpload } from '../../../lib/uploads';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler(async (event) => {
  const { project, ctx } = requireProject(event, param(event), 'member');
  rateLimit(`upload:${ctx.user.id}`, 200, 3600_000, 'Je hebt in korte tijd heel veel bestanden geüpload.');
  const parts = await readMultipartFormData(event);
  if (!parts?.length) throw badRequest('Er is geen bestand meegestuurd.');
  const kind = parts.find((p) => p.name === 'kind')?.data.toString() === 'reference' ? 'reference' : 'design';
  const files = parts.filter((p) => p.name === 'file' && p.filename);
  if (!files.length) throw badRequest('Er is geen bestand meegestuurd.');
  if (files.length > 20) throw badRequest('Upload maximaal twintig bestanden tegelijk.');
  const created = [];
  const errors: { name: string; message: string }[] = [];
  for (const f of files) {
    try {
      created.push(...(await ingestUpload({ projectId: project.id, workspaceId: ctx.workspace.id, kind, filename: f.filename!, buffer: f.data })));
    } catch (e) {
      errors.push({ name: f.filename!, message: (e as Error).message });
    }
  }
  if (!created.length && errors.length) throw badRequest(errors.length === 1 ? errors[0]!.message : `Geen van de bestanden kon worden verwerkt. ${errors[0]!.name}: ${errors[0]!.message}`);
  return { assets: created.map(present.asset), errors };
});
