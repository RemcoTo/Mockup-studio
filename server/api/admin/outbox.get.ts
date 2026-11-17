import { mailMode, readOutbox } from '../../lib/mail';

import { apiHandler } from '../../lib/http/api';
import { requirePlatformAdmin } from '../../lib/http/auth';
/** Uitbak met verstuurde e-mails zolang er geen SMTP is ingesteld; alleen voor platformbeheerders. */
export default apiHandler(async (event) => {
  requirePlatformAdmin(event);
  return { mode: mailMode(), items: mailMode() === 'outbox' ? await readOutbox(50) : [] };
});
