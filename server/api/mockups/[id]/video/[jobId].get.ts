import { videoStatus } from '../../../../lib/video';

import { apiHandler, param } from '../../../../lib/http/api';
import { requireMockup } from '../../../../lib/http/auth';
import { present } from '../../../../lib/http/present';
export default apiHandler((event) => {
  const { mockup } = requireMockup(event, param(event));
  const s = videoStatus(getRouterParam(event, 'jobId')!, mockup.id);
  return { ...s, export: s.export ? present.export(s.export) : null };
});
