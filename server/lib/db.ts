// SQLite via de ingebouwde node:sqlite-module. Alle queries zitten in repositories.ts,
// zodat een overstap naar PostgreSQL alleen die laag raakt.
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dataPath, getConfig } from './config';

let db: DatabaseSync | null = null;
let dbDir = '';

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE assets (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, source TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL,
     file TEXT NOT NULL, preview TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
   CREATE INDEX assets_project ON assets(project_id);
   CREATE TABLE scenes (
     id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
     origin TEXT NOT NULL, in_library INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL, object_type TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '{}',
     file TEXT NOT NULL, thumb TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     surfaces TEXT NOT NULL DEFAULT '[]', prompt TEXT NOT NULL DEFAULT '', config TEXT,
     provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', license TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL);
   CREATE INDEX scenes_project ON scenes(project_id);
   CREATE TABLE generations (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     status TEXT NOT NULL, config TEXT NOT NULL, prompt TEXT NOT NULL, count INTEGER NOT NULL,
     asset_id TEXT, scene_ids TEXT NOT NULL DEFAULT '[]', mockup_ids TEXT NOT NULL DEFAULT '[]',
     error TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT);
   CREATE TABLE mockups (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, generation_id TEXT,
     placements TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0, preview_file TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX mockups_project ON mockups(project_id);
   CREATE TABLE exports (
     id TEXT PRIMARY KEY, mockup_id TEXT NOT NULL REFERENCES mockups(id) ON DELETE CASCADE,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     format TEXT NOT NULL, quality INTEGER NOT NULL, file TEXT NOT NULL,
     width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL);`,

  // v1: accounts, werkruimtes, rollen, credits en een duurzame takenwachtrij.
  `CREATE TABLE users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
     password_hash TEXT NOT NULL, email_verified_at TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, last_login_at TEXT);
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
     stripe_customer_id TEXT, stripe_subscription_id TEXT, subscription_status TEXT, current_period_end TEXT,
     created_at TEXT NOT NULL);
   CREATE TABLE memberships (
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
     created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
   CREATE INDEX memberships_user ON memberships(user_id);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '');
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE email_tokens (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')), expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
   CREATE TABLE invitations (
     id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     email TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
     token_hash TEXT NOT NULL UNIQUE, invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
     expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL);
   CREATE INDEX invitations_ws ON invitations(workspace_id);
   CREATE TABLE credit_ledger (
     id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     delta INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL);
   CREATE INDEX credit_ledger_ws ON credit_ledger(workspace_id);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
     ref TEXT, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
     attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1, run_after TEXT NOT NULL,
     locked_until TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX jobs_status ON jobs(status, run_after);
   ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
   CREATE INDEX projects_ws ON projects(workspace_id);
   ALTER TABLE scenes ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
   CREATE INDEX scenes_ws ON scenes(workspace_id);
   ALTER TABLE generations ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE generations ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
   ALTER TABLE generations ADD COLUMN created_by TEXT;`,

  // v2: bibliotheekpijplijn. Elke regel is één scène die het platform zelf laat genereren voor de
  // systeembibliotheek; de kosten tellen mee voor het dagelijkse platformplafond.
  `CREATE TABLE library_runs (
     id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, preset_id TEXT NOT NULL, status TEXT NOT NULL,
     quality TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt TEXT NOT NULL,
     cost_usd REAL NOT NULL DEFAULT 0, scene_id TEXT, error TEXT, created_by TEXT,
     created_at TEXT NOT NULL, finished_at TEXT);
   CREATE INDEX library_runs_created ON library_runs(created_at);`,

  // v3: ontwerpversies. Een ontwerp houdt zijn id; vorige versies blijven bewaard en zijn terug te zetten.
  `ALTER TABLE assets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE assets ADD COLUMN updated_at TEXT;
   CREATE TABLE asset_versions (
     id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, version INTEGER NOT NULL,
     original_name TEXT NOT NULL, mime TEXT NOT NULL, file TEXT NOT NULL, preview TEXT NOT NULL,
     width INTEGER NOT NULL, height INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '',
     created_by TEXT, created_at TEXT NOT NULL);
   CREATE INDEX asset_versions_asset ON asset_versions(asset_id, version);`,

  // v4: klantpresentaties. Een geheime link toont een selectie mockups; de klant geeft akkoord of
  // vraagt een wijziging, zonder account.
  `CREATE TABLE shares (
     id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', mockup_ids TEXT NOT NULL DEFAULT '[]', allow_download INTEGER NOT NULL DEFAULT 0,
     created_by TEXT, created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_viewed_at TEXT, views INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX shares_project ON shares(project_id);
   CREATE TABLE share_feedback (
     id TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE, mockup_id TEXT,
     kind TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
   CREATE INDEX share_feedback_share ON share_feedback(share_id, created_at);`,

  // v5: verwerkte Stripe-gebeurtenissen; Stripe kan een webhook meer dan eens sturen.
  `CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL);`,

  // v6: AI-kosten van verwijderde werkruimtes blijven meetellen voor het platformplafond.
  `CREATE TABLE spend_archive (id TEXT PRIMARY KEY, cost_usd REAL NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX spend_archive_created ON spend_archive(created_at);`,

  // v7: een verwijderde configuratie (generatie) laat haar kosten achter voor de dagplafonds van werkruimte
  // en persoon, zonder prompt of instellingen; anders zou verwijderen het plafond omzeilen.
  `ALTER TABLE spend_archive ADD COLUMN workspace_id TEXT;
   ALTER TABLE spend_archive ADD COLUMN user_id TEXT;
   CREATE INDEX spend_archive_workspace ON spend_archive(workspace_id, created_at);`,

  // v8: scènes met een echt 3D-device bewaren hun instellingen en de achtergrond zonder device.
  `ALTER TABLE scenes ADD COLUMN device3d TEXT;`,
];

export function getDb(): DatabaseSync {
  const dir = getConfig().dataDir;
  if (db && dbDir === dir) return db;
  mkdirSync(dataPath(), { recursive: true });
  db = new DatabaseSync(dataPath('studio.sqlite'));
  dbDir = dir;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)');
  const done = new Set((db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db!.exec('BEGIN');
    try {
      db!.exec(sql);
      db!.prepare('INSERT INTO _migrations (version) VALUES (?)').run(i);
      db!.exec('COMMIT');
    } catch (e) {
      db!.exec('ROLLBACK');
      throw e;
    }
  });
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}
