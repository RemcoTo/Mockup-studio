import type { H3Event } from 'h3';
import type { User } from '../repo-accounts';
import { isVerified } from '../auth/verification';

/**
 * Het adres van de bezoeker. X-Forwarded-For is door de bezoeker zelf in te vullen en telt alleen als er
 * een vertrouwde proxy voor de studio staat (NUXT_TRUST_PROXY = aantal proxy's, bijvoorbeeld 1 voor Caddy).
 * Dan nemen we het adres dat die proxy heeft toegevoegd: van rechts geteld.
 */
export const clientIp = (event: H3Event) => {
  const hops = Number(process.env.NUXT_TRUST_PROXY || 0);
  const socket = event.node.req.socket?.remoteAddress ?? 'onbekend';
  if (!hops) return socket;
  const chain = String(getRequestHeader(event, 'x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - hops] ?? socket;
};
export const userAgent = (event: H3Event) => getRequestHeader(event, 'user-agent') ?? '';
export const safeUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, emailVerified: isVerified(u), isAdmin: u.isAdmin, createdAt: u.createdAt });
