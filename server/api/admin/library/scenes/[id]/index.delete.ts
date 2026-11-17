import { rejectScene } from '../../../../../lib/library/pipeline';

import { apiHandler } from '../../../../../lib/http/api';
import { requirePlatformAdmin } from '../../../../../lib/http/auth';
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  await rejectScene(getRouterParam(event, 'id')!);
  return { ok: true };
});
