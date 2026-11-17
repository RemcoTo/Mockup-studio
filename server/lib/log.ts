// Gestructureerde logging als JSON-regels op stdout, zodat elke hosting ze kan opvangen en doorzoeken.
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === 'production' ? 'info' : 'info')] ?? 20;
const pretty = process.env.LOG_FORMAT === 'pretty' || (!process.env.LOG_FORMAT && process.env.NODE_ENV !== 'production' && process.stdout.isTTY);
type Sink = (level: Level, event: string, data: Record<string, unknown>) => void;
const sinks: Sink[] = [];

function write(level: Level, event: string, data: Record<string, unknown> = {}) {
  for (const s of sinks) { try { s(level, event, data); } catch { /* sink-fouten mogen loggen niet breken */ } }
  if (ORDER[level] < min || process.env.VITEST) return;
  const line = pretty
    ? `${new Date().toISOString().slice(11, 19)} ${level.padEnd(5)} ${event} ${Object.keys(data).length ? JSON.stringify(data) : ''}`
    : JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (e: string, d?: Record<string, unknown>) => write('debug', e, d),
  info: (e: string, d?: Record<string, unknown>) => write('info', e, d),
  warn: (e: string, d?: Record<string, unknown>) => write('warn', e, d),
  error: (e: string, d?: Record<string, unknown>) => write('error', e, d),
  addSink: (s: Sink) => sinks.push(s),
};

/** Geheime tokens in een pad (presentatielinks, uitnodigingen) vervangen, voor logs en foutmeldingen. */
export const maskPath = (p: string) => p.split('?')[0]!.replace(/\/(p|invitations|uitnodiging)\/[^/]+/, '/$1/…');
