import { previewInvite } from '../../../lib/auth/accounts';
import { AppError } from '../../../lib/errors';

import { apiHandler } from '../../../lib/http/api';
export default apiHandler((event) => {
  const token = getRouterParam(event, 'token') ?? '';
  const inv = token.length < 200 ? previewInvite(token) : null;
  if (!inv) throw new AppError(404, 'Deze uitnodiging is verlopen of al gebruikt. Vraag om een nieuwe uitnodiging.', 'invite_invalid');
  return inv;
});
