import { endSession } from '../../lib/auth/accounts';

import { apiHandler } from '../../lib/http/api';
import { SESSION_COOKIE, clearSessionCookie } from '../../lib/http/auth';
export default apiHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE);
  if (token) endSession(token);
  clearSessionCookie(event);
  return { ok: true };
});
