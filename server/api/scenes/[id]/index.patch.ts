import { z } from 'zod';
import { findObject } from '../../../../shared/catalog';
import { badRequest } from '../../../lib/errors';
import { scenes } from '../../../lib/repositories';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireScene } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
const schema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  license: z.string().trim().max(300).optional(),
  inLibrary: z.boolean().optional(),
  objectType: z.string().max(40).optional(),
  tags: z.object({ material: z.string().max(60).optional(), angle: z.string().max(60).optional(), composition: z.string().max(60).optional(), color: z.string().max(60).optional(), orientation: z.enum(['landscape', 'portrait', 'square']).optional() }).optional(),
});

export default apiHandler(async (event) => {
  const { scene } = requireScene(event, param(event), 'write');
  const id = scene.id;
  const body = parse(schema, await readBody(event));
  const patch: Parameters<typeof scenes.update>[1] = { ...body, tags: body.tags ? { ...scene.tags, ...body.tags } : undefined };
  if (body.objectType) {
    const f = findObject(body.objectType);
    if (!f) throw badRequest('Onbekend objecttype.');
    patch.category = f.category.id;
  }
  if (body.inLibrary && !scene.license && !body.license) throw badRequest('Vul eerst de bron of licentie in voordat de scène in de bibliotheek komt.');
  Object.keys(patch).forEach((k) => (patch as Record<string, unknown>)[k] === undefined && delete (patch as Record<string, unknown>)[k]);
  return present.scene(scenes.update(id, patch)!);
});
