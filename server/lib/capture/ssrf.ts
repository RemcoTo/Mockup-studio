// Bescherming tegen SSRF: de server mag via website-import nooit interne adressen, cloud-metadata
// of lokale bestanden bereiken. Elke hop (redirect) en elk verzoek van de browser wordt gecontroleerd.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { getConfig } from '../config';
import { AppError, badRequest } from '../errors';

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  // IPv4-staart (::ffff:1.2.3.4) omzetten naar twee groepen.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [...h, ...Array(tail !== undefined ? fill : 0).fill('0'), ...t].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // onleesbaar = niet vertrouwen
  const allZero = g.slice(0, 7).every((x) => x === 0);
  if (allZero && (g[7] === 0 || g[7] === 1)) return true; // :: en ::1
  // IPv4-mapped (::ffff:a.b.c.d) en IPv4-compatible: controleer het ingebedde IPv4-adres.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    return isPrivateIPv4(v4);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentatie
  if (g[0] === 0x2002) return true; // 6to4 kan naar intern routeren
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

/** Controleert de vorm van een URL. Zet een kale domeinnaam om naar https. */
export function normalizeUrl(raw: string): URL {
  let s = raw.trim();
  if (!s) throw badRequest('Vul een webadres in.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw badRequest('Dit is geen geldig webadres.', 'url_invalid');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('Alleen http- en https-adressen kunnen worden geïmporteerd.', 'url_scheme');
  if (u.username || u.password) throw badRequest('Webadressen met een gebruikersnaam of wachtwoord worden niet ondersteund.', 'url_credentials');
  if (!ALLOWED_PORTS.has(u.port)) throw badRequest('Alleen de standaardpoorten (80, 443, 8080, 8443) zijn toegestaan.', 'url_port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || (!host.includes('.') && !isIP(host) && host !== 'localhost')) throw badRequest('Gebruik een volledig domein, bijvoorbeeld voorbeeld.nl.', 'url_host');
  return u;
}

/**
 * Zoekt de adressen van een host op en geeft ze alleen terug als ze allemaal publiek zijn.
 * Geen cache: elke verbinding gebruikt precies het adres dat hier is gecontroleerd (zie resolvePublic
 * en de egress-proxy), zodat een DNS-antwoord dat tussendoor verandert (rebinding) geen kans krijgt.
 */
export async function resolvePublic(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowPrivate = getConfig().captureAllowPrivate;
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))) throw blocked();
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new AppError(422, `Het domein ${host} bestaat niet of is niet bereikbaar.`, 'dns_failed');
    }
  }
  if (!addresses.length) throw new AppError(422, `Het domein ${host} bestaat niet of is niet bereikbaar.`, 'dns_failed');
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a))) throw blocked();
  return addresses;
}

/** Snelle controle vooraf (zonder het adres vast te pinnen); de verbinding zelf gaat via resolvePublic. */
export async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublic(hostname);
}

/** lookup-functie voor http(s).request: de socket verbindt met precies het gecontroleerde adres. */
export function safeLookup(hostname: string, options: unknown, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) {
  resolvePublic(hostname).then(
    (addrs) => {
      const all = (options as { all?: boolean })?.all;
      if (all) cb(null, addrs.map((a) => ({ address: a, family: isIP(a) })));
      else cb(null, addrs[0]!, isIP(addrs[0]!));
    },
    (e) => cb(e as Error, ''),
  );
}

export const isAllowedPort = (port: string) => ALLOWED_PORTS.has(port);

const blocked = () => new AppError(422, 'Dit adres verwijst naar een intern netwerk en kan om veiligheidsredenen niet worden geïmporteerd.', 'url_private');

/** Eén GET zonder redirects te volgen, via een gecontroleerd en vastgepind adres. */
function probe(url: URL): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET', lookup: safeLookup as never, timeout: 12_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MockupStudio/1.0)', Accept: 'text/html,*/*' },
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === 'string' ? res.headers.location : null });
      req.destroy();
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end();
  });
}

/** Volgt redirects handmatig (maximaal vijf), en controleert elke stap. */
export async function checkReachable(raw: string): Promise<{ url: string; status: number; redirected: boolean }> {
  let url = normalizeUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    let res: { status: number; location: string | null };
    try {
      res = await probe(url);
    } catch (e) {
      if (e instanceof AppError) throw e;
      if ((e as Error).name === 'TimeoutError') throw new AppError(504, 'De website reageert niet binnen twaalf seconden.', 'url_timeout');
      throw new AppError(422, 'De website is niet bereikbaar. Controleer het adres.', 'url_unreachable');
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = normalizeUrl(new URL(res.location, url).href);
      continue;
    }
    return { url: url.href, status: res.status, redirected: hop > 0 };
  }
  throw new AppError(422, 'De website stuurt te vaak door (meer dan vijf keer).', 'url_redirects');
}
