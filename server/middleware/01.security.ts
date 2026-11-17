// Beveiligingsheaders voor elk antwoord en een Origin-controle voor alles wat iets wijzigt.
// De sessiecookie is SameSite=Lax; de Origin-controle sluit de resterende CSRF-routes af.
import { log } from '../lib/log';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default defineEventHandler((event) => {
  const h = event.node.res;
  h.setHeader('X-Content-Type-Options', 'nosniff');
  h.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.setHeader('X-Frame-Options', 'DENY');
  h.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  h.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // blob: voor de 3D-modellen: GLTFLoader leest ingebedde texturen (toetsenbord, perforatie) via fetch van een blob-URL.
    "connect-src 'self' blob:",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '));
  if (getRequestProtocol(event, { xForwardedProto: true }) === 'https') h.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  const path = event.path;
  if (!path.startsWith('/api/') || !UNSAFE.has(event.method)) return;
  // Webhooks van externe diensten hebben hun eigen handtekening en geen Origin.
  if (path.startsWith('/api/webhooks/')) return;
  const origin = getRequestHeader(event, 'origin');
  const site = getRequestHeader(event, 'sec-fetch-site');
  const host = getRequestHost(event, { xForwardedHost: true });
  let ok = false;
  if (origin) {
    try { ok = new URL(origin).host === host; } catch { ok = false; }
  } else {
    // Zonder Origin (oudere browsers, scripts): alleen als de browser zegt dat het van dezelfde site komt,
    // of als er helemaal geen browsercontext is (geen cookie mogelijk via een andere site).
    ok = !site || site === 'same-origin' || site === 'none';
  }
  if (!ok) {
    log.warn('security.origin_blocked', { path, origin, host });
    throw createError({ statusCode: 403, message: 'Dit verzoek kwam niet van deze applicatie.', data: { code: 'bad_origin', message: 'Dit verzoek kwam niet van deze applicatie.' } });
  }
});
