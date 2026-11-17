// Applicatiegeheim voor ondertekende bestands-URL's. Uit de omgeving, of eenmalig gegenereerd en bewaard.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataPath, getConfig } from './config';
import { log } from './log';

let cached: { dir: string; key: Buffer } | null = null;

export function appSecret(): Buffer {
  const dir = getConfig().dataDir;
  if (cached?.dir === dir) return cached.key;
  let key: Buffer;
  if (process.env.NUXT_APP_SECRET && process.env.NUXT_APP_SECRET.length >= 32) {
    key = Buffer.from(process.env.NUXT_APP_SECRET);
  } else {
    const file = dataPath('.secret');
    if (existsSync(file)) key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64url');
    else {
      mkdirSync(dataPath(), { recursive: true });
      key = randomBytes(48);
      writeFileSync(file, key.toString('base64url'), { mode: 0o600 });
      log.warn('secret.generated', { hint: 'Zet NUXT_APP_SECRET in productie, zodat het geheim niet aan de datamap vastzit.' });
    }
  }
  cached = { dir, key };
  return key;
}

export function sign(value: string): string {
  return createHmac('sha256', appSecret()).update(value).digest('base64url').slice(0, 32);
}

export function verifySignature(value: string, sig: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
