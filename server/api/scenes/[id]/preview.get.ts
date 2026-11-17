import { createHash } from 'node:crypto';
import { badRequest, notFound } from '../../../lib/errors';
import { keys } from '../../../lib/keys';
import { placementsFor, renderImage } from '../../../lib/mockups';
import { assets } from '../../../lib/repositories';
import { storage } from '../../../lib/storage';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset, requireScene } from '../../../lib/http/auth';
/**
 * Kleine preview van een ontwerp op een scène, voor de bibliotheekkiezer: je ziet je eigen ontwerp
 * al op elke foto voordat je kiest. Wordt na de eerste keer uit de cache geserveerd.
 */
export default apiHandler(async (event) => {
  const { scene, ctx } = requireScene(event, param(event), 'read');
  const q = getQuery(event);
  const assetId = typeof q.asset === 'string' && /^[a-z0-9]{1,40}$/i.test(q.asset) ? q.asset : null;
  if (!assetId) throw badRequest('Geen ontwerp opgegeven.');
  const { asset } = requireAsset(event, assetId);
  if (!asset || !assets.get(asset.id)) throw notFound('Ontwerp');
  const width = Math.max(240, Math.min(960, Number(q.w) || 560));
  // Een nieuwe versie van het ontwerp (ander bestand) of aangepaste vlakken geven een nieuwe preview.
  const hash = createHash('sha1').update(JSON.stringify([scene.surfaces, asset.file])).digest('hex').slice(0, 12);
  const key = `${keys.previews(ctx.workspace.id, scene.id)}/${asset.id}-${width}-${hash}.webp`;
  if (!(await storage.exists(key))) {
    if (!scene.surfaces.length) throw badRequest('Deze scène heeft nog geen ontwerpvlak.');
    const placements = placementsFor(scene, asset.id, null);
    const img = await renderImage({ placements }, scene, { width, supersample: 2, output: { format: 'webp', quality: 80 } });
    await storage.put(key, img.buffer);
  }
  setHeader(event, 'Content-Type', 'image/webp');
  setHeader(event, 'Cache-Control', 'private, max-age=86400');
  return storage.read(key);
});
