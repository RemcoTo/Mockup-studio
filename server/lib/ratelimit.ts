// Eenvoudige rate limiting in het geheugen (vast venster per sleutel). Genoeg voor één serverproces;
// bij meerdere instanties hoort dit in een gedeelde opslag.
import { AppError } from './errors';

const buckets = new Map<string, { count: number; reset: number }>();
let lastSweep = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number, message = 'Te veel pogingen. Wacht even en probeer het opnieuw.') {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) {
    const wait = Math.ceil((b.reset - now) / 1000);
    throw new AppError(429, `${message} (${wait < 120 ? `${wait} seconden` : `${Math.ceil(wait / 60)} minuten`})`, 'rate_limited');
  }
}

export function resetRateLimits() { buckets.clear(); }
