import { z } from 'zod';
import { badRequest } from '../../../lib/errors';
import { placementsFor, renderPreview, validatePlacements } from '../../../lib/mockups';
import { mockups, scenes } from '../../../lib/repositories';
import { parse, placementSchema } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup, requireScene } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
const schema = z.object({
  placements: z.array(placementSchema).max(12).optional(),
  favorite: z.boolean().optional(),
  /** Andere scène kiezen: plaatsingen worden per vlak overgezet. */
  sceneId: z.string().max(40).optional(),
});

export default apiHandler(async (event) => {
  const { mockup: m } = requireMockup(event, param(event), 'member');
  const body = parse(schema, await readBody(event));
  if (body.sceneId && body.sceneId !== m.sceneId) {
    const { scene } = requireScene(event, body.sceneId, 'read');
    if (!scene.surfaces.length) throw badRequest('Deze scène heeft nog geen ontwerpvlak. Wijs eerst de hoeken aan in de bibliotheek.');
    const updated = mockups.update(m.id, { sceneId: scene.id, placements: placementsFor(scene, null, m) });
    return present.mockup(await renderPreview(updated!));
  }
  if (body.placements) validatePlacements(scenes.get(m.sceneId)!, m.projectId, body.placements);
  const updated = mockups.update(m.id, { placements: body.placements, favorite: body.favorite });
  if (body.placements) return present.mockup(await renderPreview(updated!));
  return present.mockup(updated!);
});
