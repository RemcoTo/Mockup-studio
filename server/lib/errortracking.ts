// Foutregistratie naar Sentry (of een Sentry-compatibele dienst zoals GlitchTip) via de envelope-API,
// zonder SDK. Alleen actief met NUXT_SENTRY_DSN. Persoonsgegevens worden niet meegestuurd.
import { randomUUID } from 'node:crypto';
import { log } from './log';

interface Dsn { endpoint: string; key: string }
let dsn: Dsn | null | undefined;

export function parseDsn(raw: string): Dsn | null {
  try {
    const u = new URL(raw);
    const project = u.pathname.replace(/^\//, '').split('/').pop();
    if (!u.username || !project) return null;
    const basePath = u.pathname.slice(0, u.pathname.lastIndexOf('/'));
    return { endpoint: `${u.protocol}//${u.host}${basePath}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

function current(): Dsn | null {
  if (dsn === undefined) dsn = process.env.NUXT_SENTRY_DSN ? parseDsn(process.env.NUXT_SENTRY_DSN) : null;
  return dsn;
}

export function buildEnvelope(error: { message: string; stack?: string; name?: string }, context: Record<string, unknown>, key: string): string {
  const eventId = randomUUID().replace(/-/g, '');
  const frames = (error.stack ?? '').split('\n').slice(1, 30).map((l) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim());
    return m ? { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null;
  }).filter(Boolean).reverse();
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NUXT_RELEASE ?? undefined,
    exception: { values: [{ type: error.name ?? 'Error', value: error.message, stacktrace: { frames } }] },
    extra: context,
  };
  const header = { event_id: eventId, sent_at: new Date().toISOString(), dsn: `key:${key}` };
  const payload = JSON.stringify(event);
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event', length: Buffer.byteLength(payload) })}\n${payload}\n`;
}

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
  const d = current();
  if (!d) return;
  const e = error instanceof Error ? error : new Error(String(error));
  const body = buildEnvelope(e, context, d.key);
  fetch(d.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${d.key}, sentry_client=mockup-studio/1.0` },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch((err) => log.warn('errortracking.send_failed', { error: String(err) }));
}

/** Alle fouten die gelogd worden ook doorsturen. */
log.addSink((level, event, data) => {
  if (level !== 'error') return;
  captureError(new Error(String(data.error ?? event)), { event, ...data });
});
