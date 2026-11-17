// Back-ups van de database. Een back-up is een volledige, consistente kopie (SQLite online backup),
// ook terwijl de studio draait. Dagelijks automatisch, de laatste 14 blijven bewaard.
// De bestanden (ontwerpen, scènes, exports) staan in de datamap onder files/; maak daarvan een
// snapshot van het volume bij je hostingpartij (zie de handleiding).
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { dataPath } from './config';
import { getDb } from './db';
import { log } from './log';

export const KEEP_BACKUPS = 14;
const dir = () => process.env.NUXT_BACKUP_DIR || dataPath('backups');
const NAME = /^studio-\d{8}-\d{6}\.sqlite$/;

export async function listBackups() {
  const names = (await readdir(dir()).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort().reverse();
  return Promise.all(names.map(async (name) => {
    const s = await stat(path.join(dir(), name));
    return { name, bytes: s.size, createdAt: s.mtime.toISOString() };
  }));
}

export async function createBackup(): Promise<{ name: string; bytes: number }> {
  await mkdir(dir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `studio-${stamp}.sqlite`;
  const target = path.join(dir(), name);
  await backup(getDb(), target);
  const { size } = await stat(target);
  // Oude back-ups opruimen.
  for (const old of (await listBackups()).slice(KEEP_BACKUPS)) await rm(path.join(dir(), old.name), { force: true });
  log.info('backup.created', { name, bytes: size });
  return { name, bytes: size };
}

/** Maakt een back-up als de laatste ouder is dan 20 uur. */
export async function backupIfDue() {
  const [latest] = await listBackups();
  if (latest && Date.now() - Date.parse(latest.createdAt) < 20 * 3600_000) return null;
  return createBackup();
}

export function backupPath(name: string): string | null {
  return NAME.test(name) ? path.join(dir(), name) : null;
}
