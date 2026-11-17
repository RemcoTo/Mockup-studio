import { getDb } from '../lib/db';
import { verificationRequired } from '../lib/auth/verification';

import { apiHandler } from '../lib/http/api';
import { requireWorkspace } from '../lib/http/auth';
/** Eerste stappen in een werkruimte, voor de checklist op het dashboard. */
export default apiHandler((event) => {
  const ctx = requireWorkspace(event, 'viewer');
  const ws = ctx.workspace.id;
  const has = (sql: string) => !!getDb().prepare(sql).get(ws);
  return {
    // Eigen ontwerp: iets anders dan de vier bestanden van het voorbeeldproject.
    design: has("SELECT 1 FROM assets a JOIN projects p ON p.id = a.project_id WHERE p.workspace_id = ? AND p.name NOT LIKE 'Voorbeeld:%' LIMIT 1"),
    mockup: has('SELECT 1 FROM mockups m JOIN projects p ON p.id = m.project_id WHERE p.workspace_id = ? LIMIT 1'),
    exported: has('SELECT 1 FROM exports e JOIN projects p ON p.id = e.project_id WHERE p.workspace_id = ? LIMIT 1'),
    shared: has('SELECT 1 FROM shares s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ? LIMIT 1'),
    verified: !!ctx.user.emailVerifiedAt,
    verificationRequired: verificationRequired(),
  };
});
