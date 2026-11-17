// Alle databasetoegang. Rijen gaan hier van en naar de gedeelde domeintypes.
import type { Asset, AssetVersion, ExportRecord, Generation, Mockup, Project, Scene } from '../../shared/types';
import { getDb } from './db';
import { newId, now } from './ids';

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || !v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};
const all = (sql: string, ...p: unknown[]) => getDb().prepare(sql).all(...(p as never[])) as Row[];
const one = (sql: string, ...p: unknown[]) => getDb().prepare(sql).get(...(p as never[])) as Row | undefined;
const run = (sql: string, ...p: unknown[]) => getDb().prepare(sql).run(...(p as never[]));

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Projecten -----------------------------------------------------------------

const toProject = (r: Row): Project => ({
  id: r.id as string, workspaceId: r.workspace_id as string, name: r.name as string, client: r.client as string, url: r.url as string,
  createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

export const projects = {
  list(workspaceId: string): (Project & { mockupCount: number; cover: string | null; coverIsMockup: boolean })[] {
    return all(`SELECT p.*, (SELECT COUNT(*) FROM mockups m WHERE m.project_id = p.id) AS mockup_count,
      COALESCE((SELECT m.preview_file FROM mockups m WHERE m.project_id = p.id AND m.preview_file IS NOT NULL ORDER BY m.favorite DESC, m.updated_at DESC LIMIT 1),
        (SELECT a.preview FROM assets a WHERE a.project_id = p.id AND a.kind = 'design' ORDER BY a.created_at LIMIT 1)) AS cover,
      (SELECT COUNT(*) FROM mockups m WHERE m.project_id = p.id AND m.preview_file IS NOT NULL) AS has_mockup_cover
      FROM projects p WHERE p.workspace_id = ? ORDER BY p.updated_at DESC`, workspaceId).map((r) => ({ ...toProject(r), mockupCount: Number(r.mockup_count), cover: (r.cover as string) ?? null, coverIsMockup: Number(r.has_mockup_cover) > 0 }));
  },
  get(id: string): Project | null {
    const r = one('SELECT * FROM projects WHERE id = ?', id);
    return r ? toProject(r) : null;
  },
  create(data: { workspaceId: string; name: string; client?: string; url?: string }): Project {
    const p: Project = { id: newId(), workspaceId: data.workspaceId, name: data.name, client: data.client ?? '', url: data.url ?? '', createdAt: now(), updatedAt: now() };
    run('INSERT INTO projects (id, workspace_id, name, client, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, p.workspaceId, p.name, p.client, p.url, p.createdAt, p.updatedAt);
    return p;
  },
  update(id: string, data: Partial<Pick<Project, 'name' | 'client' | 'url'>>) {
    const p = this.get(id);
    if (!p) return null;
    const next = { ...p, ...data, updatedAt: now() };
    run('UPDATE projects SET name = ?, client = ?, url = ?, updated_at = ? WHERE id = ?', next.name, next.client, next.url, next.updatedAt, id);
    return next;
  },
  touch(id: string) { run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), id); },
  remove(id: string) { run('DELETE FROM projects WHERE id = ?', id); },
  count(workspaceId: string) { return Number(one('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?', workspaceId)!.n); },
  /** Projecten zonder werkruimte (van vóór de accounts) aan een werkruimte koppelen. */
  adoptOrphans(workspaceId: string) { return Number(run('UPDATE projects SET workspace_id = ? WHERE workspace_id IS NULL', workspaceId).changes); },
};

// Ontwerpen en referenties ------------------------------------------------------

const toAsset = (r: Row): Asset => ({
  id: r.id as string, projectId: r.project_id as string, kind: r.kind as Asset['kind'], source: r.source as Asset['source'],
  originalName: r.original_name as string, mime: r.mime as string, file: r.file as string, preview: r.preview as string,
  width: Number(r.width), height: Number(r.height), meta: json(r.meta, {}), version: Number(r.version ?? 1),
  createdAt: r.created_at as string, updatedAt: (r.updated_at as string) ?? null,
});

export const assets = {
  list(filter: { projectId?: string; workspaceId?: string; kind?: Asset['kind'] } = {}): Asset[] {
    const where: string[] = [], p: unknown[] = [];
    if (filter.projectId) { where.push('a.project_id = ?'); p.push(filter.projectId); }
    if (filter.workspaceId) { where.push('pr.workspace_id = ?'); p.push(filter.workspaceId); }
    if (filter.kind) { where.push('a.kind = ?'); p.push(filter.kind); }
    return all(`SELECT a.* FROM assets a JOIN projects pr ON pr.id = a.project_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC`, ...p).map(toAsset);
  },
  get(id: string) { const r = one('SELECT * FROM assets WHERE id = ?', id); return r ? toAsset(r) : null; },
  insert(a: Omit<Asset, 'version' | 'updatedAt'> & Partial<Pick<Asset, 'version' | 'updatedAt'>>): Asset {
    const full: Asset = { version: 1, updatedAt: null, ...a };
    run(`INSERT INTO assets (id, project_id, kind, source, original_name, mime, file, preview, width, height, meta, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, full.id, full.projectId, full.kind, full.source, full.originalName, full.mime, full.file, full.preview,
      full.width, full.height, JSON.stringify(full.meta), full.version, full.createdAt, full.updatedAt);
    projects.touch(full.projectId);
    return full;
  },
  /** Nieuwe inhoud voor hetzelfde ontwerp (versie). */
  replaceContent(id: string, d: Pick<Asset, 'originalName' | 'mime' | 'file' | 'preview' | 'width' | 'height' | 'meta' | 'version'>) {
    run('UPDATE assets SET original_name = ?, mime = ?, file = ?, preview = ?, width = ?, height = ?, meta = ?, version = ?, updated_at = ? WHERE id = ?',
      d.originalName, d.mime, d.file, d.preview, d.width, d.height, JSON.stringify(d.meta), d.version, now(), id);
    const a = this.get(id);
    if (a) projects.touch(a.projectId);
    return a;
  },
  rename(id: string, name: string) { run('UPDATE assets SET original_name = ? WHERE id = ?', name, id); },
  updateMeta(id: string, meta: Record<string, unknown>) { run('UPDATE assets SET meta = ? WHERE id = ?', JSON.stringify(meta), id); },
  remove(id: string) { run('DELETE FROM assets WHERE id = ?', id); },
};

// Scènes ----------------------------------------------------------------------

const toScene = (r: Row): Scene => ({
  id: r.id as string, workspaceId: (r.workspace_id as string) ?? null, projectId: (r.project_id as string) ?? null, origin: r.origin as Scene['origin'], inLibrary: !!r.in_library,
  title: r.title as string, category: r.category as string, objectType: r.object_type as string, tags: json(r.tags, {}),
  file: r.file as string, thumb: r.thumb as string, width: Number(r.width), height: Number(r.height),
  surfaces: json(r.surfaces, []), prompt: r.prompt as string, config: json(r.config, null), provider: r.provider as string,
  model: r.model as string, license: r.license as string, createdAt: r.created_at as string, device3d: json(r.device3d, null),
});

export const scenes = {
  /**
   * workspaceId beperkt tot de systeembibliotheek plus de scènes van die werkruimte.
   * Zonder workspaceId (alleen intern gebruik) worden alle scènes doorzocht.
   */
  list(filter: { workspaceId?: string; library?: boolean; projectId?: string; category?: string; objectType?: string; q?: string } = {}): Scene[] {
    const where: string[] = [], p: unknown[] = [];
    // Systeemscènes alleen als ze gepubliceerd zijn; nog te beoordelen bibliotheekscènes ziet alleen de beheerder.
    if (filter.workspaceId) { where.push('((workspace_id IS NULL AND in_library = 1) OR workspace_id = ?)'); p.push(filter.workspaceId); }
    if (filter.library) where.push('in_library = 1');
    if (filter.projectId) { where.push('project_id = ?'); p.push(filter.projectId); }
    if (filter.category) { where.push('category = ?'); p.push(filter.category); }
    if (filter.objectType) { where.push('object_type = ?'); p.push(filter.objectType); }
    if (filter.q) { where.push('(title LIKE ? OR tags LIKE ? OR prompt LIKE ?)'); const q = `%${filter.q}%`; p.push(q, q, q); }
    return all(`SELECT * FROM scenes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`, ...p).map(toScene);
  },
  get(id: string) { const r = one('SELECT * FROM scenes WHERE id = ?', id); return r ? toScene(r) : null; },
  insert(s: Scene) {
    run(`INSERT INTO scenes (id, workspace_id, project_id, origin, in_library, title, category, object_type, tags, file, thumb, width, height, surfaces, prompt, config, provider, model, license, created_at, device3d)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.workspaceId, s.projectId, s.origin, s.inLibrary ? 1 : 0, s.title, s.category, s.objectType, JSON.stringify(s.tags), s.file, s.thumb,
      s.width, s.height, JSON.stringify(s.surfaces), s.prompt, s.config ? JSON.stringify(s.config) : null, s.provider, s.model, s.license, s.createdAt,
      s.device3d ? JSON.stringify(s.device3d) : null);
    return s;
  },
  update(id: string, data: Partial<Pick<Scene, 'title' | 'tags' | 'surfaces' | 'inLibrary' | 'license' | 'category' | 'objectType'>>) {
    const s = this.get(id);
    if (!s) return null;
    const n = { ...s, ...data };
    run('UPDATE scenes SET title = ?, tags = ?, surfaces = ?, in_library = ?, license = ?, category = ?, object_type = ? WHERE id = ?',
      n.title, JSON.stringify(n.tags), JSON.stringify(n.surfaces), n.inLibrary ? 1 : 0, n.license, n.category, n.objectType, id);
    return n;
  },
  /** Nieuwe render van een 3D-scène: beeld, miniatuur, maten, vlakken en instellingen in één keer. */
  replaceRender(id: string, data: Pick<Scene, 'file' | 'thumb' | 'width' | 'height' | 'surfaces' | 'device3d'>) {
    run('UPDATE scenes SET file = ?, thumb = ?, width = ?, height = ?, surfaces = ?, device3d = ? WHERE id = ?',
      data.file, data.thumb, data.width, data.height, JSON.stringify(data.surfaces), data.device3d ? JSON.stringify(data.device3d) : null, id);
    return this.get(id);
  },
  remove(id: string) { run('DELETE FROM scenes WHERE id = ?', id); },
  detachFromProject(id: string) { run('UPDATE scenes SET project_id = NULL WHERE id = ?', id); },
  countSystem() { return Number(one('SELECT COUNT(*) AS n FROM scenes WHERE workspace_id IS NULL AND in_library = 1')!.n); },
};

// Mockups ---------------------------------------------------------------------

const toMockup = (r: Row): Mockup => ({
  id: r.id as string, projectId: r.project_id as string, sceneId: r.scene_id as string, generationId: (r.generation_id as string) ?? null,
  placements: json(r.placements, []), favorite: !!r.favorite, previewFile: (r.preview_file as string) ?? null,
  createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

export const mockups = {
  list(filter: { projectId?: string; generationId?: string; workspaceId?: string; sceneId?: string } = {}): Mockup[] {
    if (filter.generationId) return all('SELECT * FROM mockups WHERE generation_id = ? ORDER BY created_at', filter.generationId).map(toMockup);
    if (filter.projectId) return all('SELECT * FROM mockups WHERE project_id = ? ORDER BY favorite DESC, updated_at DESC', filter.projectId).map(toMockup);
    if (filter.sceneId) return all('SELECT * FROM mockups WHERE scene_id = ?', filter.sceneId).map(toMockup);
    if (filter.workspaceId) return all('SELECT m.* FROM mockups m JOIN projects p ON p.id = m.project_id WHERE p.workspace_id = ? ORDER BY m.updated_at DESC LIMIT 200', filter.workspaceId).map(toMockup);
    return [];
  },
  /** Mockups die een bepaald ontwerp gebruiken (voor ontwerpversies). */
  usingAsset(assetId: string): Mockup[] {
    return all("SELECT * FROM mockups WHERE placements LIKE ? ", `%"assetId":"${assetId.replace(/[^a-z0-9]/gi, '')}"%`).map(toMockup);
  },
  get(id: string) { const r = one('SELECT * FROM mockups WHERE id = ?', id); return r ? toMockup(r) : null; },
  insert(m: Mockup) {
    run(`INSERT INTO mockups (id, project_id, scene_id, generation_id, placements, favorite, preview_file, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, m.id, m.projectId, m.sceneId, m.generationId, JSON.stringify(m.placements), m.favorite ? 1 : 0, m.previewFile, m.createdAt, m.updatedAt);
    projects.touch(m.projectId);
    return m;
  },
  update(id: string, data: Partial<Pick<Mockup, 'placements' | 'favorite' | 'previewFile' | 'sceneId'>>) {
    const m = this.get(id);
    if (!m) return null;
    const n = { ...m, ...data, updatedAt: now() };
    run('UPDATE mockups SET placements = ?, favorite = ?, preview_file = ?, scene_id = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(n.placements), n.favorite ? 1 : 0, n.previewFile, n.sceneId, n.updatedAt, id);
    projects.touch(m.projectId);
    return n;
  },
  remove(id: string) { run('DELETE FROM mockups WHERE id = ?', id); },
};

// Exports -----------------------------------------------------------------------

const toExport = (r: Row): ExportRecord => ({
  id: r.id as string, mockupId: r.mockup_id as string, projectId: r.project_id as string, format: r.format as ExportRecord['format'],
  quality: Number(r.quality), file: r.file as string, width: Number(r.width), height: Number(r.height), createdAt: r.created_at as string,
});

export const exportsRepo = {
  list(filter: { projectId?: string; mockupId?: string }): ExportRecord[] {
    if (filter.mockupId) return all('SELECT * FROM exports WHERE mockup_id = ? ORDER BY created_at DESC', filter.mockupId).map(toExport);
    return all('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC', filter.projectId).map(toExport);
  },
  get(id: string) { const r = one('SELECT * FROM exports WHERE id = ?', id); return r ? toExport(r) : null; },
  insert(e: ExportRecord) {
    run('INSERT INTO exports (id, mockup_id, project_id, format, quality, file, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      e.id, e.mockupId, e.projectId, e.format, e.quality, e.file, e.width, e.height, e.createdAt);
    return e;
  },
  remove(id: string) { run('DELETE FROM exports WHERE id = ?', id); },
};

// Generaties --------------------------------------------------------------------

const toGeneration = (r: Row): Generation => ({
  id: r.id as string, projectId: r.project_id as string, status: r.status as Generation['status'], config: json(r.config, {} as Generation['config']),
  prompt: r.prompt as string, count: Number(r.count), assetId: (r.asset_id as string) ?? null, sceneIds: json(r.scene_ids, []),
  mockupIds: json(r.mockup_ids, []), error: (r.error as string) ?? null, provider: r.provider as string, model: r.model as string,
  credits: Number(r.credits ?? 0), costUsd: Number(r.cost_usd ?? 0), createdBy: (r.created_by as string) ?? null,
  createdAt: r.created_at as string, finishedAt: (r.finished_at as string) ?? null,
});

export const generations = {
  list(filter: { projectId?: string } = {}): Generation[] {
    if (filter.projectId) return all('SELECT * FROM generations WHERE project_id = ? ORDER BY created_at DESC', filter.projectId).map(toGeneration);
    return [];
  },
  get(id: string) { const r = one('SELECT * FROM generations WHERE id = ?', id); return r ? toGeneration(r) : null; },
  insert(g: Generation) {
    run(`INSERT INTO generations (id, project_id, status, config, prompt, count, asset_id, scene_ids, mockup_ids, error, provider, model, credits, cost_usd, created_by, created_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, g.id, g.projectId, g.status, JSON.stringify(g.config), g.prompt, g.count, g.assetId,
      JSON.stringify(g.sceneIds), JSON.stringify(g.mockupIds), g.error, g.provider, g.model, g.credits, g.costUsd, g.createdBy, g.createdAt, g.finishedAt);
    return g;
  },
  update(id: string, data: Partial<Pick<Generation, 'status' | 'sceneIds' | 'mockupIds' | 'error' | 'finishedAt'>>) {
    const g = this.get(id);
    if (!g) return null;
    const n = { ...g, ...data };
    run('UPDATE generations SET status = ?, scene_ids = ?, mockup_ids = ?, error = ?, finished_at = ? WHERE id = ?',
      n.status, JSON.stringify(n.sceneIds), JSON.stringify(n.mockupIds), n.error, n.finishedAt, id);
    return n;
  },
  /** Generaties die als lopend staan maar geen taak meer hebben (van vóór de wachtrij): afsluiten. */
  failOrphaned() {
    run(`UPDATE generations SET status = 'failed', error = 'Onderbroken doordat de server opnieuw is gestart.', finished_at = ?
      WHERE status IN ('queued', 'running') AND id NOT IN (SELECT ref FROM jobs WHERE type = 'generation' AND ref IS NOT NULL AND status IN ('queued', 'running'))`, now());
  },
  /** Uitgegeven bedrag (geschat) sinds een tijdstip, voor uitgavenplafonds; inclusief verwijderde configuraties. */
  spendSince(sinceIso: string, workspaceId?: string): number {
    const r = workspaceId
      ? one(`SELECT COALESCE(SUM(g.cost_usd), 0) AS s FROM generations g JOIN projects p ON p.id = g.project_id WHERE g.created_at >= ? AND p.workspace_id = ? AND g.status != 'failed'`, sinceIso, workspaceId)
      : one(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM generations WHERE created_at >= ? AND status != 'failed'`, sinceIso);
    const archived = workspaceId ? Number(one('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM spend_archive WHERE workspace_id = ? AND created_at >= ?', workspaceId, sinceIso)!.s) : 0;
    return Number(r!.s) + archived;
  },
  /** Uitgegeven bedrag van één persoon, ook over verwijderde configuraties. */
  spendByUserSince(userId: string, sinceIso: string): number {
    const live = Number(one("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM generations WHERE created_by = ? AND created_at >= ? AND status != 'failed'", userId, sinceIso)!.s);
    const archived = Number(one('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM spend_archive WHERE user_id = ? AND created_at >= ?', userId, sinceIso)!.s);
    return live + archived;
  },
  /**
   * Een configuratie verwijderen. De scènes en mockups die eruit zijn ontstaan blijven bestaan (ze verliezen
   * alleen de verwijzing); de kosten blijven als kale regel meetellen voor de dagplafonds.
   */
  remove(g: Generation, workspaceId: string) {
    const db = getDb();
    db.exec('BEGIN');
    try {
      if (g.costUsd > 0 && g.status !== 'failed') {
        run('INSERT INTO spend_archive (id, cost_usd, created_at, workspace_id, user_id) VALUES (?, ?, ?, ?, ?)', newId(), g.costUsd, g.createdAt, workspaceId, g.createdBy);
      }
      run('UPDATE mockups SET generation_id = NULL WHERE generation_id = ?', g.id);
      run('DELETE FROM generations WHERE id = ?', g.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};

// Bibliotheekpijplijn ---------------------------------------------------------

export interface LibraryRun {
  id: string; batchId: string; presetId: string; status: 'queued' | 'running' | 'done' | 'failed';
  quality: string; provider: string; model: string; prompt: string; costUsd: number; sceneId: string | null;
  error: string | null; createdBy: string | null; createdAt: string; finishedAt: string | null;
}
const toRun = (r: Row): LibraryRun => ({
  id: r.id as string, batchId: r.batch_id as string, presetId: r.preset_id as string, status: r.status as LibraryRun['status'],
  quality: r.quality as string, provider: r.provider as string, model: r.model as string, prompt: r.prompt as string,
  costUsd: Number(r.cost_usd), sceneId: (r.scene_id as string) ?? null, error: (r.error as string) ?? null,
  createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, finishedAt: (r.finished_at as string) ?? null,
});

export const libraryRuns = {
  insert(r: LibraryRun) {
    run(`INSERT INTO library_runs (id, batch_id, preset_id, status, quality, provider, model, prompt, cost_usd, scene_id, error, created_by, created_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.batchId, r.presetId, r.status, r.quality, r.provider, r.model, r.prompt, r.costUsd, r.sceneId, r.error, r.createdBy, r.createdAt, r.finishedAt);
    return r;
  },
  get(id: string) { const r = one('SELECT * FROM library_runs WHERE id = ?', id); return r ? toRun(r) : null; },
  update(id: string, d: Partial<Pick<LibraryRun, 'status' | 'sceneId' | 'error' | 'finishedAt'>>) {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...d };
    run('UPDATE library_runs SET status = ?, scene_id = ?, error = ?, finished_at = ? WHERE id = ?', n.status, n.sceneId, n.error, n.finishedAt, id);
    return n;
  },
  recent(limit = 60) { return all('SELECT * FROM library_runs ORDER BY created_at DESC LIMIT ?', limit).map(toRun); },
  bySceneId(sceneId: string) { const r = one('SELECT * FROM library_runs WHERE scene_id = ?', sceneId); return r ? toRun(r) : null; },
  spendSince(sinceIso: string): number {
    return Number(one(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM library_runs WHERE created_at >= ? AND status != 'failed'`, sinceIso)!.s);
  },
};

// Ontwerpversies --------------------------------------------------------------

const toVersion = (r: Row): AssetVersion => ({
  id: r.id as string, assetId: r.asset_id as string, version: Number(r.version), originalName: r.original_name as string, mime: r.mime as string,
  file: r.file as string, preview: r.preview as string, width: Number(r.width), height: Number(r.height), meta: json(r.meta, {}),
  note: r.note as string, createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string,
});

export const assetVersions = {
  insert(v: AssetVersion) {
    run(`INSERT INTO asset_versions (id, asset_id, version, original_name, mime, file, preview, width, height, meta, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, v.id, v.assetId, v.version, v.originalName, v.mime, v.file, v.preview, v.width, v.height,
      JSON.stringify(v.meta), v.note, v.createdBy, v.createdAt);
    return v;
  },
  list(assetId: string) { return all('SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version DESC', assetId).map(toVersion); },
  get(id: string) { const r = one('SELECT * FROM asset_versions WHERE id = ?', id); return r ? toVersion(r) : null; },
  remove(id: string) { run('DELETE FROM asset_versions WHERE id = ?', id); },
  count(assetId: string) { return Number(one('SELECT COUNT(*) AS n FROM asset_versions WHERE asset_id = ?', assetId)!.n); },
};

// Klantpresentaties -----------------------------------------------------------

export interface Share {
  id: string; tokenHash: string; projectId: string; title: string; message: string; mockupIds: string[]; allowDownload: boolean;
  createdBy: string | null; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastViewedAt: string | null; views: number;
}
export interface ShareFeedback { id: string; shareId: string; mockupId: string | null; kind: 'approve' | 'changes' | 'comment'; name: string; body: string; createdAt: string }

const toShare = (r: Row): Share => ({
  id: r.id as string, tokenHash: r.token_hash as string, projectId: r.project_id as string, title: r.title as string, message: r.message as string,
  mockupIds: json(r.mockup_ids, []), allowDownload: !!r.allow_download, createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string,
  expiresAt: (r.expires_at as string) ?? null, revokedAt: (r.revoked_at as string) ?? null, lastViewedAt: (r.last_viewed_at as string) ?? null, views: Number(r.views),
});
const toFeedback = (r: Row): ShareFeedback => ({
  id: r.id as string, shareId: r.share_id as string, mockupId: (r.mockup_id as string) ?? null, kind: r.kind as ShareFeedback['kind'],
  name: r.name as string, body: r.body as string, createdAt: r.created_at as string,
});

export const shares = {
  insert(s: Share) {
    run(`INSERT INTO shares (id, token_hash, project_id, title, message, mockup_ids, allow_download, created_by, created_at, expires_at, revoked_at, last_viewed_at, views)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, s.id, s.tokenHash, s.projectId, s.title, s.message, JSON.stringify(s.mockupIds), s.allowDownload ? 1 : 0,
      s.createdBy, s.createdAt, s.expiresAt, s.revokedAt, s.lastViewedAt, s.views);
    return s;
  },
  get(id: string) { const r = one('SELECT * FROM shares WHERE id = ?', id); return r ? toShare(r) : null; },
  byTokenHash(h: string) { const r = one('SELECT * FROM shares WHERE token_hash = ?', h); return r ? toShare(r) : null; },
  list(projectId: string) { return all('SELECT * FROM shares WHERE project_id = ? ORDER BY created_at DESC', projectId).map(toShare); },
  revoke(id: string) { run('UPDATE shares SET revoked_at = ? WHERE id = ?', now(), id); },
  viewed(id: string) { run('UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', now(), id); },
  addFeedback(f: ShareFeedback) {
    run('INSERT INTO share_feedback (id, share_id, mockup_id, kind, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', f.id, f.shareId, f.mockupId, f.kind, f.name, f.body, f.createdAt);
    return f;
  },
  feedback(shareId: string) { return all('SELECT * FROM share_feedback WHERE share_id = ? ORDER BY created_at', shareId).map(toFeedback); },
  feedbackForProject(projectId: string) {
    return all('SELECT f.* FROM share_feedback f JOIN shares s ON s.id = f.share_id WHERE s.project_id = ? ORDER BY f.created_at', projectId).map(toFeedback);
  },
};
