// Database-back-ups: consistent, terug te lezen, opgeruimd na 14.
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupIfDue, backupPath, createBackup, KEEP_BACKUPS, listBackups } from '../../server/lib/backup';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { workspaces } from '../../server/lib/repo-accounts';

let dir = '';
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'ms-backup-')); setConfig({ dataDir: dir }); workspaces.create('Bureau met back-up'); });
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('back-ups', () => {
  it('maakt een leesbare kopie van de database', async () => {
    const { name } = await createBackup();
    const copy = new DatabaseSync(backupPath(name)!, { readOnly: true });
    expect((copy.prepare('SELECT name FROM workspaces').get() as { name: string }).name).toBe('Bureau met back-up');
    copy.close();
  });
  it('maakt er niet nog een als de laatste recent is, en bewaart er maximaal 14', async () => {
    expect(await backupIfDue()).toBeNull();
    for (let i = 0; i < KEEP_BACKUPS + 3; i++) {
      await createBackup();
      await new Promise((r) => setTimeout(r, 1050)); // namen hebben een seconde-resolutie
    }
    expect((await listBackups()).length).toBe(KEEP_BACKUPS);
  }, 60_000);
  it('weigert namen buiten het patroon', () => {
    expect(backupPath('../studio.sqlite')).toBeNull();
    expect(backupPath('studio-20260101-000000.sqlite')).toMatch(/backups/);
    void utimesSync;
  });
});
