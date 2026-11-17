import { z } from 'zod';
import { assets } from '../../../lib/repositories';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
export default apiHandler(async (event) => {
  const { asset } = requireAsset(event, param(event), 'member');
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), await readBody(event));
  assets.rename(asset.id, name);
  return present.asset(assets.get(asset.id)!);
});
