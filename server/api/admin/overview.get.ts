import { overview } from '../../lib/admin';
import { listBackups } from '../../lib/backup';

import { apiHandler } from '../../lib/http/api';
import { requirePlatformAdmin } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  return { ...(await overview()), backups: (await listBackups()).slice(0, 5) };
});
