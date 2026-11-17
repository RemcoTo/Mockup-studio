// Wachtwoorden met scrypt (OWASP: N=2^16, r=8, p=2). Asynchroon, dus blokkeert de server niet.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));

const PARAMS = { N: 2 ** 16, r: 8, p: 2 };
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...PARAMS, maxmem: 160 * 1024 * 1024 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt!, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Zelfde rekentijd als een echte controle, zodat een onbekend e-mailadres niet sneller antwoordt. */
let dummy: string | null = null;
export async function burnPasswordCheck(password: string) {
  dummy ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
}

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return 'Gebruik minimaal tien tekens.';
  if (password.length > 200) return 'Gebruik maximaal tweehonderd tekens.';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'Gebruik geen deel van je e-mailadres in je wachtwoord.';
  if (/^(.)\1+$/.test(password)) return 'Gebruik niet steeds hetzelfde teken.';
  const common = ['wachtwoord', 'password', '1234567890', 'qwertyuiop', 'welkom123', 'letmein123'];
  if (common.some((c) => password.toLowerCase().includes(c))) return 'Dit wachtwoord is te voorspelbaar.';
  return null;
}
