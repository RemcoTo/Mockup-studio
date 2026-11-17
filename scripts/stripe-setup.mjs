// Zet eenmalig de producten en prijzen klaar in je Stripe-account (eerst in testmodus).
// Veilig om vaker uit te voeren: bestaande prijzen met dezelfde lookup key worden hergebruikt.
//   npm run stripe:setup
// Leest NUXT_STRIPE_SECRET_KEY uit .env. Optioneel: NUXT_APP_URL voor de webhook-instructie.
import { readFileSync, existsSync } from 'node:fs';
import Stripe from 'stripe';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = process.env.NUXT_STRIPE_SECRET_KEY;
if (!key) {
  console.error('NUXT_STRIPE_SECRET_KEY ontbreekt. Zet je geheime sleutel (sk_test_...) in .env en probeer het opnieuw.');
  process.exit(1);
}
const stripe = new Stripe(key);
const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
console.log(`Stripe ${live ? 'LIVE' : 'testmodus'}\n`);

// Moet overeenkomen met shared/plans.ts.
const ITEMS = [
  { lookup: 'studio_monthly', product: 'Mockup Studio, Studio', amount: 1900, recurring: { interval: 'month' } },
  { lookup: 'team_monthly', product: 'Mockup Studio, Team', amount: 5900, recurring: { interval: 'month' } },
  { lookup: 'credits_250', product: 'Mockup Studio, 250 credits', amount: 900 },
  { lookup: 'credits_1000', product: 'Mockup Studio, 1000 credits', amount: 2900 },
];

const productIds = [];
for (const it of ITEMS) {
  const existing = (await stripe.prices.list({ lookup_keys: [it.lookup], active: true, limit: 1, expand: ['data.product'] })).data[0];
  if (existing) {
    console.log(`  bestaat al   ${it.lookup}  ${existing.id}  €${(existing.unit_amount / 100).toFixed(2)}`);
    if (it.recurring) productIds.push(typeof existing.product === 'string' ? existing.product : existing.product.id);
    continue;
  }
  const product = await stripe.products.create({ name: it.product });
  const price = await stripe.prices.create({
    product: product.id, currency: 'eur', unit_amount: it.amount, lookup_key: it.lookup, tax_behavior: 'exclusive',
    ...(it.recurring ? { recurring: it.recurring } : {}),
  });
  if (it.recurring) productIds.push(product.id);
  console.log(`  aangemaakt   ${it.lookup}  ${price.id}  €${(it.amount / 100).toFixed(2)}`);
}

// Klantportaal: opzeggen, betaalmethode, facturen en wisselen tussen de abonnementen.
const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
if (!configs.data.length) {
  const prices = [];
  for (const it of ITEMS.filter((i) => i.recurring)) prices.push((await stripe.prices.list({ lookup_keys: [it.lookup], limit: 1 })).data[0]);
  await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Je abonnement op Mockup Studio' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: prices.map((p) => ({ product: typeof p.product === 'string' ? p.product : p.product.id, prices: [p.id] })) },
    },
  });
  console.log('\n  Klantportaal ingesteld.');
} else {
  console.log('\n  Klantportaal was al ingesteld.');
}

const url = (process.env.NUXT_APP_URL || 'https://jouw-domein.nl').replace(/\/$/, '');
console.log(`
Klaar. Nog één stap in het Stripe-dashboard (Ontwikkelaars, Webhooks, Eindpunt toevoegen):
  URL:          ${url}/api/webhooks/stripe
  Gebeurtenissen: checkout.session.completed, checkout.session.async_payment_succeeded,
                customer.subscription.created, customer.subscription.updated,
                customer.subscription.deleted, invoice.paid
Kopieer daarna het ondertekeningsgeheim (whsec_...) naar NUXT_STRIPE_WEBHOOK_SECRET in .env.`);
