import { restoreVersion } from '../../../../../lib/versions';

import { apiHandler, param } from '../../../../../lib/http/api';
import { requireAsset } from '../../../../../lib/http/auth';
import { present } from '../../../../../lib/http/present';
export default apiHandler(async (event) => {
  const { asset, ctx } = requireAsset(event, param(event), 'member');
  const res = await restoreVersion(asset, getRouterParam(event, 'versionId')!, ctx.user.id);
  return { affectedMockups: res.affectedMockups, asset: present.asset(res.asset) };
});
