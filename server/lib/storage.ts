// Bestandsopslag achter een kleine interface. Lokaal tijdens ontwikkeling; een S3-variant
// implementeert dezelfde vier methodes en verandert verder niets aan de applicatie.
import { cp, mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dataPath } from './config';
import { sign, verifySignature } from './secret';

export interface Storage {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(keyOrPrefix: string): Promise<void>;
  /** Lokaal pad voor beeldbewerking; een externe opslag zou hier eerst naar een tijdelijk bestand halen. */
  localPath(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  /** Kopieert een bestand of map naar een nieuw pad. */
  copy(from: string, to: string): Promise<void>;
  /** Zet een lokaal (tijdelijk) bestand op een opslagpad; het lokale bestand verdwijnt. */
  putFile(key: string, localFile: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

export function assertKey(key: string) {
  if (!KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error(`Ongeldig opslagpad: ${key}`);
}

class LocalStorage implements Storage {
  private root() { return dataPath('files'); }
  private full(key: string) {
    assertKey(key);
    const p = path.resolve(this.root(), key);
    if (!p.startsWith(this.root() + path.sep)) throw new Error('Pad buiten de opslagmap.');
    return p;
  }
  async put(key: string, data: Buffer | Uint8Array) {
    const p = this.full(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async putFile(key: string, localFile: string) {
    const p = this.full(key);
    await mkdir(path.dirname(p), { recursive: true });
    try { await rename(localFile, p); }
    catch { await cp(localFile, p); await rm(localFile, { force: true }); }
  }
  read(key: string) { return readFile(this.full(key)); }
  async remove(key: string) { await rm(this.full(key), { recursive: true, force: true }); }
  async localPath(key: string) { return this.full(key); }
  async copy(from: string, to: string) {
    if (!(await this.exists(from))) return;
    const dest = this.full(to);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(this.full(from), dest, { recursive: true });
  }
  async exists(key: string) {
    try { await stat(this.full(key)); return true; } catch { return false; }
  }
}

export const storage: Storage = new LocalStorage();
const BUCKET_MS = 2 * 3600_000;

/**
 * Ondertekende, tijdelijke URL voor een opgeslagen beeld. Alleen API-routes die het record al hebben
 * geautoriseerd geven zo'n URL uit. De vervaltijd valt op vaste blokken van twee uur, zodat dezelfde
 * URL een tijd gelijk blijft en de browser hem kan cachen; hij is 2 tot 4 uur geldig. Kort genoeg dat
 * een ingetrokken presentatie of een verwijderd teamlid niet lang bij de beelden kan.
 */
export function fileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const exp = Math.ceil(Date.now() / BUCKET_MS) * BUCKET_MS + BUCKET_MS;
  return `/api/files/${key}?e=${exp}&s=${sign(`${key}:${exp}`)}`;
}

export function verifyFileUrl(key: string, exp: string, sig: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() || e > Date.now() + 2 * BUCKET_MS + 60_000) return false;
  return verifySignature(`${key}:${exp}`, sig);
}

/** Tijdelijke werkmap op dezelfde schijf als de opslag, zodat verplaatsen direct gaat. */
export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = dataPath('tmp', randomUUID());
  await mkdir(dir, { recursive: true });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
