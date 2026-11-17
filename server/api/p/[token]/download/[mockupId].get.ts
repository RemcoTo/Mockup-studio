import { downloadFor, shareByToken } from '../../../../lib/shares';
import { rateLimit } from '../../../../lib/ratelimit';
import { storage } from '../../../../lib/storage';

import { apiHandler } from '../../../../lib/http/api';
import { clientIp } from '../../../../lib/http/client';
export default apiHandler(async (event) => {
  rateLimit(`share-download:${clientIp(event)}`, 60, 3600_000, 'Je hebt in korte tijd veel bestanden gedownload.');
  const s = shareByToken(getRouterParam(event, 'token')!);
  rateLimit(`share-download-total:${s.id}`, 120, 3600_000, 'Er is in korte tijd heel vaak gedownload uit deze presentatie.');
  const e = await downloadFor(s, getRouterParam(event, 'mockupId')!);
  const name = `${s.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'mockup'}-${e.mockupId.slice(0, 6)}.${e.format === 'tiff' ? 'tif' : e.format}`;
  setResponseHeader(event, 'Content-Type', e.format === 'jpg' ? 'image/jpeg' : 'image/png');
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${name}"`);
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow');
  return storage.read(e.file);
});
