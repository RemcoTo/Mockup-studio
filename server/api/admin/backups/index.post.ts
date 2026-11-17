import { createBackup } from '../../../lib/backup';
import { rateLimit } from '../../../lib/ratelimit';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { user } = requirePlatformAdmin(event);
  rateLimit(`backup:${user.id}`, 12, 3600_000);
  return createBackup();
});
