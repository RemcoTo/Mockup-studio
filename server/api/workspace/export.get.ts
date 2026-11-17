import { exportWorkspace } from '../../lib/gdpr';

import { apiHandler } from '../../lib/http/api';
import { requireWorkspace } from '../../lib/http/auth';
/** Alle gegevens van de werkruimte als JSON-bestand. */
export default apiHandler((event) => {
  const ctx = requireWorkspace(event, 'admin');
  const name = ctx.workspace.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'werkruimte';
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${name}-gegevens.json"`);
  return exportWorkspace(ctx.workspace);
});
