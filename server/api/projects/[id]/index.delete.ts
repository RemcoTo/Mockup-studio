import { dirOf, keys } from '../../../lib/keys';
import { assets, mockups, projects, scenes } from '../../../lib/repositories';
import { storage } from '../../../lib/storage';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { project, ctx } = requireProject(event, param(event), 'member');
  // Eerst verzamelen welke bestanden weg moeten; de database ruimt daarna via cascade alles op.
  const dirs = new Set<string>();
  for (const s of scenes.list({ workspaceId: ctx.workspace.id, projectId: project.id })) if (!s.inLibrary && s.workspaceId) dirs.add(dirOf(s.file));
  for (const a of assets.list({ projectId: project.id })) dirs.add(dirOf(a.preview));
  for (const m of mockups.list({ projectId: project.id })) if (m.previewFile) dirs.add(dirOf(m.previewFile));
  dirs.add(keys.exports(ctx.workspace.id, project.id));
  dirs.add(keys.original(ctx.workspace.id, project.id));
  // Scènes die in de bibliotheek van de werkruimte staan blijven bestaan, los van het project.
  for (const s of scenes.list({ workspaceId: ctx.workspace.id, projectId: project.id })) if (s.inLibrary) scenes.detachFromProject(s.id);
  projects.remove(project.id);
  for (const d of dirs) await storage.remove(d).catch(() => {});
  return { ok: true };
});
