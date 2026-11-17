import { findObject } from '../../../shared/catalog';
import { getConfig } from '../../lib/config';
import { badRequest } from '../../lib/errors';
import { rateLimit } from '../../lib/ratelimit';
import { createScene } from '../../lib/scenes';
import { sniffType } from '../../lib/uploads';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
import { present } from '../../lib/http/present';
/**
 * Eigen mockupfoto toevoegen aan de bibliotheek van de werkruimte. Platformbeheerders kunnen met
 * system=1 ook aan de standaardbibliotheek toevoegen. Daarna wijst de gebruiker het vlak aan.
 */
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'member');
  rateLimit(`scene-upload:${ctx.user.id}`, 100, 3600_000);
  const parts = await readMultipartFormData(event);
  const field = (n: string) => parts?.find((p) => p.name === n)?.data.toString().trim() ?? '';
  const file = parts?.find((p) => p.name === 'file' && p.filename);
  if (!file) throw badRequest('Kies een foto om toe te voegen.');
  if (file.data.length > getConfig().uploadMaxMb * 1024 * 1024) throw badRequest(`De foto is groter dan ${getConfig().uploadMaxMb} MB.`);
  const mime = sniffType(file.data);
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw badRequest('Gebruik voor mockupfoto’s een JPG, PNG of WebP.');
  const found = findObject(field('objectType'));
  if (!found) throw badRequest('Kies het objecttype dat op de foto staat.');
  const license = field('license');
  if (!license) throw badRequest('Vul de bron of licentie van de foto in, zodat duidelijk is dat hij gebruikt mag worden.');
  const system = field('system') === '1' && ctx.user.isAdmin;
  const scene = await createScene({
    buffer: file.data, workspaceId: system ? null : ctx.workspace.id, projectId: null, origin: 'library', inLibrary: true,
    title: field('title').slice(0, 120) || `${found.object.label}`,
    category: found.category.id, objectType: found.object.id, surfaceKind: found.object.surfaceKind,
    tags: { material: field('material') || undefined, angle: field('angle') || undefined, composition: field('composition') || undefined, color: field('color') || undefined },
    license: license.slice(0, 300),
    // Een foto met een groen vlak wordt direct herkend; een gewone foto krijgt handmatig gemarkeerde hoeken.
    detect: field('detect') !== 'false',
  });
  return present.scene(scene);
});
