import { deleteMockup } from '../../../lib/mockups';

import { apiHandler, param } from '../../../lib/http/api';
import { requireMockup } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { mockup } = requireMockup(event, param(event), 'member');
  await deleteMockup(mockup.id);
  return { ok: true };
});
