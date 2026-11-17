import { publicView, shareByToken } from '../../../lib/shares';
import { shares } from '../../../lib/repositories';
import { rateLimit } from '../../../lib/ratelimit';

import { apiHandler } from '../../../lib/http/api';
import { clientIp } from '../../../lib/http/client';
/** Openbare presentatie; geen account nodig, wel de geheime link. */
export default apiHandler((event) => {
  rateLimit(`share-view:${clientIp(event)}`, 600, 3600_000);
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow');
  setResponseHeader(event, 'Cache-Control', 'no-store');
  const s = shareByToken(getRouterParam(event, 'token')!);
  shares.viewed(s.id);
  return publicView(s);
});
