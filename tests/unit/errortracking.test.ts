import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseDsn } from '../../server/lib/errortracking';

describe('foutregistratie', () => {
  it('leest een Sentry-DSN', () => {
    expect(parseDsn('https://abc123@o1.ingest.sentry.io/456')).toEqual({ endpoint: 'https://o1.ingest.sentry.io/api/456/envelope/', key: 'abc123' });
    expect(parseDsn('https://key@glitchtip.example.com/sub/7')!.endpoint).toBe('https://glitchtip.example.com/sub/api/7/envelope/');
    expect(parseDsn('geen-url')).toBeNull();
  });
  it('bouwt een geldige envelope met stacktrace', () => {
    const env = buildEnvelope(new Error('kapot'), { path: '/api/x' }, 'abc');
    const [header, item, payload] = env.trim().split('\n').map((l) => JSON.parse(l));
    expect(header.dsn).toBe('key:abc');
    expect(item.type).toBe('event');
    expect(payload.exception.values[0].value).toBe('kapot');
    expect(payload.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(payload.extra.path).toBe('/api/x');
  });
});
