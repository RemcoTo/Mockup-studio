// Betalen via Stripe: Checkout voor abonnementen en creditpakketten, het klantportaal voor wijzigen en
// opzeggen, en webhooks die plan en credits bijwerken. Prijzen worden opgezocht via hun lookup key
// (aangemaakt met `npm run stripe:setup`), zodat er geen prijs-id's in de configuratie hoeven.
// Elke webhook wordt één keer verwerkt (tabel stripe_events); credits krijgen een unieke referentie.
import Stripe from 'stripe';
import { PLANS, TOPUPS, planById, planByLookupKey, type PlanId } from '../../../shared/plans';
import { getConfig } from '../config';
import { getDb } from '../db';
import { AppError, badRequest } from '../errors';
import { now } from '../ids';
import { log } from '../log';
import { credits, workspaces, type User, type Workspace } from '../repo-accounts';
import { transaction } from '../repositories';

let client: Stripe | null = null;
let clientKey = '';

export function stripeConfigured() {
  const c = getConfig();
  return { checkout: !!c.stripeSecretKey, webhooks: !!c.stripeSecretKey && !!c.stripeWebhookSecret };
}

export function stripe(): Stripe {
  const key = getConfig().stripeSecretKey;
  if (!key) throw new AppError(503, 'Betalen is nog niet ingesteld. De beheerder moet een Stripe-sleutel toevoegen (zie de handleiding).', 'billing_not_configured');
  if (!client || clientKey !== key) {
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: getConfig().appName } });
    clientKey = key;
  }
  return client;
}

async function priceFor(lookupKey: string) {
  const res = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = res.data[0];
  if (!price) throw new AppError(503, `De prijs “${lookupKey}” bestaat nog niet in Stripe. Voer eenmalig npm run stripe:setup uit.`, 'price_missing');
  return price;
}

async function customerFor(ws: Workspace, user: User) {
  if (ws.stripeCustomerId) return ws.stripeCustomerId;
  const c = await stripe().customers.create({ email: user.email, name: ws.name, metadata: { workspaceId: ws.id } }, { idempotencyKey: `customer-${ws.id}` });
  workspaces.update(ws.id, { stripeCustomerId: c.id });
  return c.id;
}

/** Stripe-fouten vertalen naar iets waar een beheerder of klant mee verder kan. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    const err = e as { type?: string; message?: string };
    log.error('stripe.error', { type: err.type, message: err.message });
    if (err.type === 'StripeAuthenticationError') throw new AppError(503, 'De Stripe-sleutel wordt geweigerd. Controleer NUXT_STRIPE_SECRET_KEY.', 'billing_not_configured');
    if (err.type === 'StripeConnectionError') throw new AppError(503, 'Stripe is op dit moment niet bereikbaar. Probeer het over een paar minuten opnieuw.', 'billing_unavailable');
    if (err.type === 'StripeInvalidRequestError') throw new AppError(400, `Stripe weigerde het verzoek: ${err.message ?? 'onbekende reden'}`, 'billing_invalid');
    throw new AppError(502, 'Afrekenen via Stripe is niet gelukt. Er is niets afgeschreven. Probeer het opnieuw.', 'billing_failed');
  }
}

export function createCheckout(ws: Workspace, user: User, item: { kind: 'plan'; id: PlanId } | { kind: 'topup'; id: string }) {
  return friendly(() => checkoutInner(ws, user, item));
}

async function checkoutInner(ws: Workspace, user: User, item: { kind: 'plan'; id: PlanId } | { kind: 'topup'; id: string }) {
  stripe(); // eerst melden als betalen niet is ingesteld
  const base = getConfig().appUrl;
  const customer = await customerFor(ws, user);
  const common = {
    customer, client_reference_id: ws.id, locale: 'nl' as const, allow_promotion_codes: true,
    billing_address_collection: 'required' as const, tax_id_collection: { enabled: true }, customer_update: { name: 'auto' as const, address: 'auto' as const },
    success_url: `${base}/abonnement?betaald={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/abonnement`,
  };
  if (item.kind === 'plan') {
    const plan = PLANS[item.id];
    if (!plan?.lookupKey) throw badRequest('Dit abonnement bestaat niet.');
    if (ws.stripeSubscriptionId && ws.subscriptionStatus && ws.subscriptionStatus !== 'canceled') {
      throw new AppError(409, 'Je hebt al een abonnement. Wijzig of stop het via Abonnement beheren.', 'has_subscription');
    }
    const price = await priceFor(plan.lookupKey);
    const s = await stripe().checkout.sessions.create({
      ...common, mode: 'subscription', line_items: [{ price: price.id, quantity: 1 }],
      metadata: { workspaceId: ws.id, plan: plan.id }, subscription_data: { metadata: { workspaceId: ws.id, plan: plan.id } },
    });
    return s.url!;
  }
  const pack = TOPUPS.find((t) => t.id === item.id);
  if (!pack) throw badRequest('Dit creditpakket bestaat niet.');
  const price = await priceFor(pack.lookupKey);
  const s = await stripe().checkout.sessions.create({
    ...common, mode: 'payment', line_items: [{ price: price.id, quantity: 1 }], invoice_creation: { enabled: true },
    metadata: { workspaceId: ws.id, topup: pack.id, credits: String(pack.credits) },
  });
  return s.url!;
}

export function createPortal(ws: Workspace) {
  return friendly(async () => {
    if (!ws.stripeCustomerId) throw badRequest('Er is nog geen betaalgegeven voor deze werkruimte.');
    const s = await stripe().billingPortal.sessions.create({ customer: ws.stripeCustomerId, return_url: `${getConfig().appUrl}/abonnement`, locale: 'nl' });
    return s.url;
  });
}

// ---------------------------------------------------------------------------------------------
// Webhooks

export function verifyWebhook(raw: string | Buffer, signature: string | undefined): Stripe.Event {
  const secret = getConfig().stripeWebhookSecret;
  if (!secret) throw new AppError(503, 'Webhookgeheim ontbreekt (NUXT_STRIPE_WEBHOOK_SECRET).', 'billing_not_configured');
  if (!signature) throw new AppError(400, 'Handtekening ontbreekt.', 'bad_signature');
  try {
    return stripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    throw new AppError(400, 'Ongeldige handtekening.', 'bad_signature');
  }
}

/** Periode-einde: sinds API-versie 2025-03-31 staat dit per abonnementsregel. */
function periodEnd(sub: Stripe.Subscription): string | null {
  const ts = sub.items?.data?.map((i) => (i as unknown as { current_period_end?: number }).current_period_end ?? 0).reduce((a, b) => Math.max(a, b), 0)
    || (sub as unknown as { current_period_end?: number }).current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

/**
 * Het plan volgt uit de prijs die werkelijk wordt betaald (lookup key van de abonnementsregel), niet uit
 * metadata: bij overstappen in het klantportaal verandert de prijs, de metadata van de checkout niet.
 */
function planOfSubscription(sub: Stripe.Subscription): PlanId | null {
  for (const item of sub.items?.data ?? []) {
    const p = planByLookupKey(item.price?.lookup_key);
    if (p) return p.id;
  }
  return null;
}

function workspaceFor(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null, metaWs?: string | null) {
  const id = typeof customer === 'string' ? customer : customer?.id;
  return (id && workspaces.byStripeCustomer(id)) || (metaWs ? workspaces.get(metaWs) : null);
}

function applySubscription(sub: Stripe.Subscription) {
  const ws = workspaceFor(sub.customer, sub.metadata?.workspaceId);
  if (!ws) { log.warn('stripe.unknown_customer', { subscription: sub.id }); return; }
  const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';
  workspaces.update(ws.id, {
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: ended ? null : sub.id,
    subscriptionStatus: sub.status,
    plan: ended ? 'free' : planOfSubscription(sub) ?? ws.plan,
    currentPeriodEnd: periodEnd(sub),
  });
}

/** Subscription-id van een factuur; sinds 2025-03-31 onder parent.subscription_details. */
function invoiceSubscription(inv: Stripe.Invoice): { id: string | null; plan: string | null } {
  const parent = (inv as unknown as { parent?: { type?: string; subscription_details?: { subscription?: string | { id: string }; metadata?: Record<string, string> } } }).parent;
  const details = parent?.type === 'subscription_details' ? parent.subscription_details : undefined;
  const legacy = inv as unknown as { subscription?: string | { id: string } };
  const sub = details?.subscription ?? legacy.subscription ?? null;
  return { id: typeof sub === 'string' ? sub : sub?.id ?? null, plan: details?.metadata?.plan ?? null };
}

export async function handleEvent(event: Stripe.Event): Promise<'processed' | 'duplicate' | 'ignored'> {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(event.id)) return 'duplicate';
  let result: 'processed' | 'ignored' = 'processed';
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const ws = workspaceFor(s.customer, s.metadata?.workspaceId ?? s.client_reference_id);
      if (!ws) { result = 'ignored'; break; }
      if (s.mode === 'payment' && s.payment_status === 'paid' && s.metadata?.topup) {
        const amount = Number(s.metadata.credits) || TOPUPS.find((t) => t.id === s.metadata!.topup)?.credits || 0;
        transaction(() => { if (!credits.hasRef(ws.id, 'topup', s.id)) credits.add(ws.id, amount, 'topup', s.id); });
      } else if (s.mode === 'subscription' && s.subscription) {
        const sub = typeof s.subscription === 'string' ? await stripe().subscriptions.retrieve(s.subscription) : s.subscription;
        applySubscription(sub);
      }
      break;
    }
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session;
      const ws = workspaceFor(s.customer, s.metadata?.workspaceId);
      if (ws && s.metadata?.topup) {
        const amount = Number(s.metadata.credits) || 0;
        transaction(() => { if (!credits.hasRef(ws.id, 'topup', s.id)) credits.add(ws.id, amount, 'topup', s.id); });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      applySubscription(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid': {
      // Maandelijkse credits: bij de eerste factuur en elke verlenging, één keer per factuur.
      const inv = event.data.object as Stripe.Invoice;
      if (!['subscription_create', 'subscription_cycle'].includes(inv.billing_reason ?? '')) { result = 'ignored'; break; }
      const sub = invoiceSubscription(inv);
      const ws = workspaceFor(inv.customer, null);
      if (!ws) { result = 'ignored'; break; }
      // Het plan van het abonnement zoals het nu is; lukt ophalen niet, dan het plan dat al bekend is.
      let planId: string | null = null;
      if (sub.id) planId = await stripe().subscriptions.retrieve(sub.id).then(planOfSubscription).catch(() => null);
      const plan = planById(planId ?? workspaces.get(ws.id)?.plan);
      // Nog geen plan bekend (abonnementsbericht nog niet binnen): niet als verwerkt markeren, Stripe probeert het opnieuw.
      if (plan.id === 'free') throw new AppError(503, 'Het abonnement van deze factuur is nog niet bekend; Stripe stuurt het bericht later opnieuw.', 'retry_later');
      if (plan.monthlyCredits > 0 && inv.id) {
        const invId = inv.id;
        transaction(() => { if (!credits.hasRef(ws.id, 'plan', invId)) credits.add(ws.id, plan.monthlyCredits, 'plan', invId); });
      }
      break;
    }
    default:
      result = 'ignored';
  }
  db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, created_at) VALUES (?, ?, ?)').run(event.id, event.type, now());
  log.info('stripe.event', { id: event.id, type: event.type, result });
  return result;
}
