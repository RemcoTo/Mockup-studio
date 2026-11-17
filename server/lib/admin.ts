// Platformoverzicht voor de beheerder: gebruik, kosten, wachtrij, opslag en werkruimtes.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { platformSpend24h } from './billing/credits';
import { effectivePlan } from './billing/plans';
import { dataPath } from './config';
import { getDb } from './db';
import { poolStats } from './imaging/pool';
import { credits, memberships, workspaces } from './repo-accounts';

const n = (sql: string, ...p: unknown[]) => Number((getDb().prepare(sql).get(...(p as never[])) as { n: number }).n ?? 0);
const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

let storageCache: { at: number; bytes: number; files: number } | null = null;
async function walk(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = await walk(p); bytes += r.bytes; files += r.files; }
    else if (e.isFile()) { bytes += (await stat(p).catch(() => ({ size: 0 }))).size; files++; }
  }
  return { bytes, files };
}
/** Opslaggebruik van de bestanden; tien minuten in het geheugen, want tellen kost tijd. */
export async function storageUsage() {
  if (!storageCache || Date.now() - storageCache.at > 10 * 60_000) storageCache = { at: Date.now(), ...(await walk(dataPath('files'))) };
  return { bytes: storageCache.bytes, files: storageCache.files, measuredAt: new Date(storageCache.at).toISOString() };
}

export async function overview() {
  const gens30 = n("SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?", since(30));
  const failed30 = n("SELECT COUNT(*) AS n FROM generations WHERE created_at >= ? AND status = 'failed'", since(30));
  return {
    users: { total: n('SELECT COUNT(*) AS n FROM users'), new7d: n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since(7)), active7d: n('SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ?', since(7)) },
    workspaces: {
      total: n('SELECT COUNT(*) AS n FROM workspaces'),
      paying: n("SELECT COUNT(*) AS n FROM workspaces WHERE plan != 'free' AND subscription_status IN ('active', 'trialing', 'past_due')"),
      pastDue: n("SELECT COUNT(*) AS n FROM workspaces WHERE subscription_status = 'past_due'"),
    },
    content: { projects: n('SELECT COUNT(*) AS n FROM projects'), mockups: n('SELECT COUNT(*) AS n FROM mockups'), exports30d: n('SELECT COUNT(*) AS n FROM exports WHERE created_at >= ?', since(30)), shares: n('SELECT COUNT(*) AS n FROM shares WHERE revoked_at IS NULL') },
    ai: {
      generations30d: gens30, failed30d: failed30, failureRate: gens30 ? failed30 / gens30 : 0,
      spend24hUsd: platformSpend24h(),
      spend30dUsd: Number((getDb().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS n FROM generations WHERE created_at >= ? AND status != 'failed'").get(since(30)) as { n: number }).n)
        + Number((getDb().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS n FROM library_runs WHERE created_at >= ? AND status != 'failed'").get(since(30)) as { n: number }).n)
        + Number((getDb().prepare('SELECT COALESCE(SUM(cost_usd), 0) AS n FROM spend_archive WHERE created_at >= ?').get(since(30)) as { n: number }).n),
      creditsSold30d: n("SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE reason IN ('topup', 'plan') AND created_at >= ?", since(30)),
    },
    queue: {
      queued: n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'"), running: n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'"),
      failed24h: n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND updated_at >= ?", since(1)),
      recentFailures: (getDb().prepare("SELECT type, error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 8").all() as { type: string; error: string; updated_at: string }[])
        .map((r) => ({ type: r.type, error: r.error, at: r.updated_at })),
    },
    imaging: poolStats(),
    storage: await storageUsage(),
  };
}

export function workspaceList(q = '', limit = 100) {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = getDb().prepare(`SELECT w.id FROM workspaces w WHERE w.name LIKE ? OR EXISTS (
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND u.email LIKE ?)
    ORDER BY w.created_at DESC LIMIT ?`).all(like, like, limit) as { id: string }[];
  return rows.map(({ id }) => {
    const w = workspaces.get(id)!;
    const members = memberships.members(id);
    return {
      id, name: w.name, plan: effectivePlan(w).id, status: w.subscriptionStatus, credits: credits.balance(id), createdAt: w.createdAt,
      owner: members.find((m) => m.role === 'owner')?.email ?? null, members: members.length,
      projects: n('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?', id),
    };
  });
}
