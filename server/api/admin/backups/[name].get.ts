import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { backupPath } from '../../../lib/backup';
import { notFound } from '../../../lib/errors';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  const name = getRouterParam(event, 'name')!;
  const p = backupPath(name);
  const s = p ? await stat(p).catch(() => null) : null;
  if (!p || !s) throw notFound('Back-up');
  setResponseHeader(event, 'Content-Type', 'application/vnd.sqlite3');
  setResponseHeader(event, 'Content-Length', s.size);
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${name}"`);
  return sendStream(event, createReadStream(p));
});
