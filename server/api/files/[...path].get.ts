import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { AppError } from '../../lib/errors';
import { assertKey, storage, verifyFileUrl } from '../../lib/storage';

import { apiHandler } from '../../lib/http/api';
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.tif': 'image/tiff' };

/**
 * Serveert afgeleide beelden via een ondertekende URL. Zonder geldige handtekening geen toegang,
 * ook niet als het pad bekend is. Originelen gaan via hun eigen, geautoriseerde download-route.
 */
export default apiHandler(async (event) => {
  const key = getRouterParam(event, 'path') ?? '';
  try { assertKey(key); } catch { throw new AppError(400, 'Ongeldig pad.'); }
  const q = getQuery(event);
  if (typeof q.e !== 'string' || typeof q.s !== 'string' || !verifyFileUrl(key, q.e, q.s)) {
    throw new AppError(403, 'Deze link is verlopen of ongeldig. Vernieuw de pagina.', 'link_expired');
  }
  const type = TYPES[path.extname(key).toLowerCase()];
  if (!type) throw new AppError(404, 'Bestand niet gevonden.');
  const full = await storage.localPath(key);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new AppError(404, 'Bestand niet gevonden.');
  setHeader(event, 'Content-Type', type);
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  setHeader(event, 'Accept-Ranges', 'bytes');
  setHeader(event, 'Cache-Control', 'private, max-age=21600, immutable');
  if (q.download) setHeader(event, 'Content-Disposition', `attachment; filename="${path.basename(key)}"`);
  // Byte ranges, zodat video's in de browser kunnen spoelen.
  const range = getRequestHeader(event, 'range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : info.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : info.size - 1;
    start = Math.max(0, start); end = Math.min(info.size - 1, end);
    if (start > end) { setResponseStatus(event, 416); setHeader(event, 'Content-Range', `bytes */${info.size}`); return ''; }
    setResponseStatus(event, 206);
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${info.size}`);
    setHeader(event, 'Content-Length', end - start + 1);
    return sendStream(event, createReadStream(full, { start, end }));
  }
  setHeader(event, 'Content-Length', info.size);
  return sendStream(event, createReadStream(full));
});
