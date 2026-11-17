// 3D-device van een mockup aanpassen (camera, draaiing, openingshoek, licht...). De scène wordt opnieuw gerenderd.
// Gebruikt een andere mockup dezelfde scène, of staat ze in de bibliotheek, dan krijgt alleen deze mockup een
// eigen kopie: aanpassen raakt nooit andere mockups of de bibliotheek.
import { z } from 'zod';
import { badRequest } from '../../../lib/errors';
import { forkScene3d, rerenderScene3d } from '../../../lib/device3d/scenes';
import { renderPreview } from '../../../lib/mockups';
import { mockups, scenes } from '../../../lib/repositories';
import { device3dSpecSchema, parse } from '../../../lib/validation';
import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
import { rateLimit } from '../../../lib/ratelimit';

const schema = z.object({ spec: device3dSpecSchema });

export default apiHandler(async (event) => {
  const { mockup: m, project, ctx } = requireMockup(event, param(event), 'member');
  // Een render kost enkele seconden rekentijd op de server; ruim genoeg voor gewoon werken, niet voor misbruik.
  rateLimit(`device3d:${ctx.workspace.id}`, 240, 3600_000, 'Je hebt in korte tijd heel vaak een 3D-device aangepast. Probeer het over een paar minuten opnieuw.');
  const { spec } = parse(schema, await readBody(event));
  const scene = scenes.get(m.sceneId);
  if (!scene?.device3d) throw badRequest('Deze mockup heeft geen 3D-device.');
  const shared = scene.inLibrary || scene.workspaceId !== ctx.workspace.id || mockups.list({ sceneId: scene.id }).some((x) => x.id !== m.id);
  const next = shared
    ? await forkScene3d(scene.id, { workspaceId: ctx.workspace.id, projectId: project.id }, { ...spec, model: scene.device3d.spec.model })
    : await rerenderScene3d(scene.id, spec);
  // Een eigen kopie: de mockup verhuist mee; het vlak heeft dezelfde id, dus de plaatsingen blijven gelden.
  const moved = next.id !== scene.id ? mockups.update(m.id, { sceneId: next.id })! : mockups.get(m.id)!;
  const updated = await renderPreview(moved);
  return { mockup: present.mockup(updated), scene: present.scene(next), forked: next.id !== scene.id };
});
