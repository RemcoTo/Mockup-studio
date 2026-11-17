import { deleteAsset } from '../../../lib/uploads';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { asset } = requireAsset(event, param(event), 'member');
  await deleteAsset(asset);
  return { ok: true };
});
