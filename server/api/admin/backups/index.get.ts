import { listBackups } from '../../../lib/backup';

import { apiHandler } from '../../../lib/http/api';
import { requirePlatformAdmin } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  return listBackups();
});
