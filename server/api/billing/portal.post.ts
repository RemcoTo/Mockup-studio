import { createPortal } from '../../lib/billing/stripe';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireWorkspace(event, 'admin');
  return { url: await createPortal(ctx.workspace) };
});
