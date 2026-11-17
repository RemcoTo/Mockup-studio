<template>
  <div>
    <PageHeader title="Abonnement en credits" lead="Credits gebruik je alleen voor nieuwe AI-scènes. Bibliotheekmockups, plaatsen, exporteren en delen kosten niets. Credits vervallen niet en een mislukte generatie kost niets." />
    <div v-if="b" class="grid gap-12 px-5 py-8 sm:px-8 lg:px-10">
      <p v-if="paid" class="notice text-sm">Dank je wel. De betaling is ontvangen; je abonnement of credits staan er binnen enkele seconden.</p>
      <p v-if="!b.enforced" class="notice text-sm">Betalen staat uit op deze installatie. Alle functies zijn beschikbaar en AI-generaties worden niet met credits verrekend.</p>
      <p v-else-if="!b.stripe.checkout && me?.isAdmin" class="notice notice-error text-sm">Stripe is nog niet ingesteld, dus afrekenen werkt nog niet. Zie de handleiding, stap “Betalen instellen”.</p>

      <!-- Huidige stand -->
      <section class="grid gap-6 sm:grid-cols-3">
        <div class="grid gap-1">
          <span class="text-sm text-graphite">Abonnement</span>
          <span class="text-xl">{{ currentPlan.name }}</span>
          <span class="text-xs text-graphite">{{ statusText }}</span>
        </div>
        <div class="grid gap-1">
          <span class="text-sm text-graphite">Credits</span>
          <span class="tabular text-xl">{{ b.credits.balance }}</span>
          <span class="text-xs text-graphite">Een normale AI-scène kost 5 credits, hoge kwaliteit 20.</span>
        </div>
        <div v-if="b.canManage && b.current.hasCustomer" class="flex items-start sm:justify-end">
          <button class="btn btn-secondary" :disabled="busy === 'portal'" @click="portal">Abonnement beheren</button>
        </div>
      </section>

      <!-- Abonnementen -->
      <section class="grid gap-4">
        <h2 class="text-lg">Abonnementen</h2>
        <div class="grid divide-y divide-rule border-y border-rule lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <article v-for="p in b.plans" :key="p.id" class="grid content-start gap-4 py-6 lg:px-6 lg:first:pl-0 lg:last:pr-0" :class="{ current: p.id === b.current.plan }">
            <div class="grid gap-1">
              <h3 class="flex items-baseline justify-between gap-3 text-base"><span>{{ p.name }}</span><span v-if="p.id === b.current.plan" class="text-xs font-normal text-cyan">Huidig</span></h3>
              <p class="text-sm text-graphite">{{ p.tagline }}</p>
            </div>
            <p><span class="tabular text-2xl">€{{ p.monthlyEur }}</span><span class="text-sm text-graphite"> per maand{{ p.monthlyEur ? ', excl. btw' : '' }}</span></p>
            <ul class="grid gap-1.5 text-sm">
              <li v-for="h in p.highlights" :key="h" class="flex gap-2"><Icon name="check" :size="14" class="mt-0.5 text-graphite" />{{ h }}</li>
            </ul>
            <div v-if="b.canManage && b.enforced">
              <button v-if="p.id !== 'free' && p.id !== b.current.plan && !hasSubscription" class="btn btn-primary btn-sm" :disabled="!!busy || !b.stripe.checkout" @click="checkout({ kind: 'plan', id: p.id })">{{ busy === p.id ? 'Doorsturen…' : `Kies ${p.name}` }}</button>
              <button v-else-if="p.id !== b.current.plan && hasSubscription" class="btn btn-secondary btn-sm" :disabled="!!busy" @click="portal">{{ p.id === 'free' ? 'Opzeggen' : 'Overstappen' }}</button>
            </div>
          </article>
        </div>
        <p class="text-xs text-graphite">Maandelijks opzegbaar. Bij opzeggen loopt het abonnement door tot het einde van de betaalde maand; je credits blijven staan.</p>
      </section>

      <!-- Bijkopen -->
      <section v-if="b.enforced" class="grid gap-4">
        <h2 class="text-lg">Credits bijkopen</h2>
        <ul class="rule-list max-w-xl">
          <li v-for="t in b.topups" :key="t.id" class="flex items-center justify-between gap-4 py-3">
            <span class="text-sm"><span class="tabular font-medium">{{ t.credits }} credits</span> <span class="text-graphite">€{{ t.priceEur }}, excl. btw</span></span>
            <button v-if="b.canManage" class="btn btn-secondary btn-sm" :disabled="!!busy || !b.stripe.checkout" @click="checkout({ kind: 'topup', id: t.id })">{{ busy === t.id ? 'Doorsturen…' : 'Kopen' }}</button>
          </li>
        </ul>
      </section>

      <!-- Historie -->
      <section v-if="b.credits.history.length" class="grid gap-4">
        <h2 class="text-lg">Creditgeschiedenis</h2>
        <ul class="rule-list max-w-2xl">
          <li v-for="h in b.credits.history" :key="h.id" class="flex items-center justify-between gap-4 py-2.5 text-sm">
            <span>{{ REASONS[h.reason] ?? h.reason }} <span class="text-graphite">{{ timeAgo(h.createdAt) }}</span></span>
            <span class="tabular" :class="h.delta > 0 ? 'text-ok' : ''">{{ h.delta > 0 ? `+${h.delta}` : h.delta }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { timeAgo } from '~/utils/types';
import type { Plan, PlanId, TopUp } from '~~/shared/plans';

interface Billing {
  current: { plan: PlanId; status: string | null; currentPeriodEnd: string | null; hasCustomer: boolean };
  enforced: boolean; stripe: { checkout: boolean; webhooks: boolean }; canManage: boolean;
  credits: { balance: number; history: { id: string; delta: number; reason: string; createdAt: string }[] };
  plans: Plan[]; topups: TopUp[];
}

const REASONS: Record<string, string> = { welcome: 'Welkomstcredits', plan: 'Maandcredits', topup: 'Bijgekocht', generation: 'AI-scène', refund: 'Teruggeboekt, generatie mislukt', grant: 'Bijgeschreven door beheerder', test: 'Test' };
const route = useRoute();
const toast = useToast();
const { state: session, refresh } = useSession();
const me = computed(() => session.value?.user ?? null);
const b = ref<Billing | null>(null);
const busy = ref<string | null>(null);
const paid = computed(() => !!route.query.betaald);

async function load() { b.value = await api<Billing>('/api/billing'); }
await load().catch((e) => toast.error((e as Error).message));
// Na terugkomst van Stripe verwerkt de webhook de betaling; even later opnieuw laden.
onMounted(() => { if (paid.value) setTimeout(() => { load().catch(() => {}); refresh().catch(() => {}); }, 3000); });

const currentPlan = computed(() => b.value!.plans.find((p) => p.id === b.value!.current.plan) ?? b.value!.plans[0]!);
const hasSubscription = computed(() => !!b.value?.current.status && b.value.current.status !== 'canceled' && b.value.current.plan !== 'free');
const statusText = computed(() => {
  const c = b.value!.current;
  const end = c.currentPeriodEnd ? new Date(c.currentPeriodEnd).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : '';
  if (c.plan === 'free') return 'Geen betaald abonnement';
  if (c.status === 'past_due') return 'Betaling mislukt; werk je betaalgegevens bij via Abonnement beheren';
  return end ? `Loopt tot ${end}, wordt automatisch verlengd` : 'Actief';
});

async function checkout(item: { kind: 'plan' | 'topup'; id: string }) {
  busy.value = item.id;
  try { const r = await api<{ url: string }>('/api/billing/checkout', { method: 'POST', body: item }); window.location.href = r.url; }
  catch (e) { toast.error((e as Error).message); busy.value = null; }
}
async function portal() {
  busy.value = 'portal';
  try { const r = await api<{ url: string }>('/api/billing/portal', { method: 'POST' }); window.location.href = r.url; }
  catch (e) { toast.error((e as Error).message); busy.value = null; }
}
</script>

<style scoped>
.current { position: relative; }
</style>
