// Abonnementen, limieten en Stripe-webhooks. Geen netwerk: webhooks worden lokaal ondertekend.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFeature, assertProjectQuota, assertSeat, effectivePlan, grantWelcomeCreditsForUser, maxExportEdge } from '../../server/lib/billing/plans';
import { createCheckout, handleEvent, verifyWebhook } from '../../server/lib/billing/stripe';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { credits, memberships, users, workspaces } from '../../server/lib/repo-accounts';
import { projects } from '../../server/lib/repositories';
import { startGeneration } from '../../server/lib/generation/jobs';

let dir = '', WS = '';
const SECRET = 'whsec_test_geheim';
const sign = (payload: object) => {
  const body = JSON.stringify(payload);
  return { body, sig: new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) };
};
const evt = (id: string, type: string, object: object) => ({ id, object: 'event', type, api_version: '2026-09-30.endive', created: 1, livemode: false, pending_webhooks: 0, request: null, data: { object } });

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-billing-'));
  setConfig({ dataDir: dir, billingMode: 'credits', stripeSecretKey: 'sk_test_niet_echt', stripeWebhookSecret: SECRET });
  WS = workspaces.create('Bureau').id;
  workspaces.update(WS, { stripeCustomerId: 'cus_test1' });
  memberships.add(WS, users.create({ email: 'lid@bureau.test', name: 'Lid', passwordHash: 'x' }).id, 'owner');
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('planlimieten', () => {
  it('geeft welkomstcredits één keer per persoon, in de eigen werkruimte', () => {
    const owner = memberships.members(WS)[0]!.id;
    grantWelcomeCreditsForUser(owner); grantWelcomeCreditsForUser(owner);
    expect(credits.balance(WS)).toBe(30);
    // Een tweede werkruimte van dezelfde persoon krijgt niets extra.
    const second = workspaces.create('Nog een');
    memberships.add(second.id, owner, 'owner');
    grantWelcomeCreditsForUser(owner);
    expect(credits.balance(second.id)).toBe(0);
  });
  it('begrenst het gratis plan en ontgrendelt functies met een abonnement', () => {
    expect(() => assertFeature(WS, 'tiff')).toThrow(/vanaf het Studio/);
    expect(maxExportEdge(WS)).toBe(2000);
    for (let i = 0; i < 3; i++) projects.create({ workspaceId: WS, name: `P${i}`, client: '', url: '' });
    expect(() => assertProjectQuota(WS)).toThrow(/maximaal 3 projecten/);
    expect(() => assertSeat(WS)).toThrow(/Teamleden uitnodigen is beschikbaar vanaf het Team/);
    workspaces.update(WS, { plan: 'studio', subscriptionStatus: 'active' });
    expect(() => assertFeature(WS, 'tiff')).not.toThrow();
    expect(() => assertProjectQuota(WS)).not.toThrow();
    expect(maxExportEdge(WS)).toBeNull();
    // Een opgezegd abonnement valt terug op gratis, ook als het plan nog op studio staat.
    expect(effectivePlan({ plan: 'studio', subscriptionStatus: 'canceled' }).id).toBe('free');
    workspaces.update(WS, { plan: 'free', subscriptionStatus: null });
  });
  it('dwingt niets af zonder betalen', () => {
    setConfig({ billingMode: 'off' });
    expect(() => assertFeature(WS, 'video')).not.toThrow();
    expect(maxExportEdge(WS)).toBeNull();
    setConfig({ billingMode: 'credits' });
  });
});

describe('misbruik van AI-tegoed', () => {
  it('vraagt een bevestigd e-mailadres voor AI-generaties als dat is ingesteld', () => {
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', requireEmailVerification: true });
    try {
      const u = users.create({ email: 'nieuw@spam.test', name: 'Nieuw', passwordHash: 'x' });
      const p = projects.create({ workspaceId: WS, name: 'AI', client: '', url: '' });
      expect(() => startGeneration({ projectId: p.id, assetId: null, count: 1, userId: u.id, config: { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma' } })).toThrow(/Bevestig eerst/);
    } finally {
      setConfig({ imageProvider: 'demo', requireEmailVerification: false });
    }
  });
});

describe('stripe-webhooks', () => {
  it('weigert een ongeldige of ontbrekende handtekening', () => {
    const { body } = sign(evt('evt_x', 'invoice.paid', {}));
    expect(() => verifyWebhook(body, undefined)).toThrow(/ontbreekt/);
    expect(() => verifyWebhook(body, 't=1,v1=deadbeef')).toThrow(/Ongeldige/);
    expect(() => verifyWebhook(body.replace('invoice', 'invoicx'), sign(evt('evt_x', 'invoice.paid', {})).sig)).toThrow(/Ongeldige/);
  });

  it('schrijft een creditpakket precies één keer bij', async () => {
    const before = credits.balance(WS);
    const session = { id: 'cs_test_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid', customer: 'cus_test1', client_reference_id: WS, metadata: { workspaceId: WS, topup: 'credits_250', credits: '250' } };
    const { body, sig } = sign(evt('evt_topup', 'checkout.session.completed', session));
    expect(await handleEvent(verifyWebhook(body, sig))).toBe('processed');
    expect(await handleEvent(verifyWebhook(body, sig))).toBe('duplicate');
    // Zelfde sessie in een ander event (Stripe kan herhalen): nog steeds één keer.
    const again = sign(evt('evt_topup_2', 'checkout.session.completed', session));
    await handleEvent(verifyWebhook(again.body, again.sig));
    expect(credits.balance(WS) - before).toBe(250);
  });

  it('zet het plan bij een abonnementswijziging en valt terug bij opzeggen', async () => {
    const sub = { id: 'sub_1', object: 'subscription', customer: 'cus_test1', status: 'active', metadata: { workspaceId: WS, plan: 'team' }, items: { data: [{ current_period_end: 1893456000, price: { lookup_key: 'team_monthly' } }] } };
    const a = sign(evt('evt_sub_upd', 'customer.subscription.updated', sub));
    await handleEvent(verifyWebhook(a.body, a.sig));
    const ws = workspaces.get(WS)!;
    expect(ws).toMatchObject({ plan: 'team', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' });
    expect(ws.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString());
    // Overstappen naar Studio in het klantportaal: de prijs verandert, de metadata van de checkout niet.
    const down = sign(evt('evt_sub_down', 'customer.subscription.updated', { ...sub, items: { data: [{ current_period_end: 1893456000, price: { lookup_key: 'studio_monthly' } }] } }));
    await handleEvent(verifyWebhook(down.body, down.sig));
    expect(workspaces.get(WS)!.plan).toBe('studio');
    const d = sign(evt('evt_sub_del', 'customer.subscription.deleted', { ...sub, status: 'canceled' }));
    await handleEvent(verifyWebhook(d.body, d.sig));
    expect(workspaces.get(WS)).toMatchObject({ plan: 'free', subscriptionStatus: 'canceled', stripeSubscriptionId: null });
  });

  it('schrijft maandcredits bij per betaalde factuur, niet bij andere facturen', async () => {
    // Nog geen abonnement bekend: niet verwerken, zodat Stripe het later opnieuw stuurt.
    const early = sign(evt('evt_inv_0', 'invoice.paid', { id: 'in_0', object: 'invoice', customer: 'cus_test1', billing_reason: 'subscription_create', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: { plan: 'team' } } } }));
    await expect(handleEvent(verifyWebhook(early.body, early.sig))).rejects.toThrow(/later opnieuw/);
    workspaces.update(WS, { plan: 'studio', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' });
    const before = credits.balance(WS);
    const inv = { id: 'in_1', object: 'invoice', customer: 'cus_test1', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: { plan: 'studio', workspaceId: WS } } } };
    const a = sign(evt('evt_inv_1', 'invoice.paid', inv));
    await handleEvent(verifyWebhook(a.body, a.sig));
    expect(credits.balance(WS) - before).toBe(300);
    const manual = sign(evt('evt_inv_2', 'invoice.paid', { ...inv, id: 'in_2', billing_reason: 'manual' }));
    expect(await handleEvent(verifyWebhook(manual.body, manual.sig))).toBe('ignored');
    expect(credits.balance(WS) - before).toBe(300);
  });

  it('geeft een duidelijke melding als betalen niet is ingesteld', async () => {
    setConfig({ stripeSecretKey: '' });
    // setConfig negeert lege waarden; daarom de sleutel direct leegmaken.
    const { getConfig } = await import('../../server/lib/config');
    getConfig().stripeSecretKey = '';
    const u = users.create({ email: 'eigenaar@bureau.test', name: 'Eigenaar', passwordHash: 'x' });
    await expect(createCheckout(workspaces.get(WS)!, u, { kind: 'plan', id: 'studio' })).rejects.toThrow(/nog niet ingesteld/);
  });
});
