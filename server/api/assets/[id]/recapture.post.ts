import { recaptureAsset } from '../../../lib/capture/living';
import { rateLimit } from '../../../lib/ratelimit';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
/** Website opnieuw vastleggen met dezelfde instellingen. */
export default apiHandler(async (event) => {
  const { asset, ctx } = requireAsset(event, param(event), 'member');
  rateLimit(`capture:${ctx.workspace.id}`, 60, 3600_000, 'Je hebt in korte tijd veel websites vastgelegd.');
  const res = await recaptureAsset(asset, ctx.user.id);
  return { changed: res.changed, affectedMockups: res.affectedMockups, warnings: res.warnings, asset: present.asset(res.asset) };
});
