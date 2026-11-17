<template>
  <div>
    <PageHeader title="Platformbeheer" lead="Gebruik, kosten, wachtrij, opslag en werkruimtes van het hele platform.">
      <template #actions><NuxtLink to="/beheer/bibliotheek" class="btn btn-secondary">Bibliotheek samenstellen</NuxtLink></template>
    </PageHeader>
    <div v-if="o" class="grid gap-12 px-5 py-8 sm:px-8 lg:px-10">
      <section class="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
        <div v-for="k in kpis" :key="k.label" class="grid gap-1">
          <span class="text-sm text-graphite">{{ k.label }}</span>
          <span class="text-xl" :class="{ tabular: typeof k.value === 'number' }">{{ k.value }}</span>
          <span class="text-xs text-graphite">{{ k.sub }}</span>
        </div>
      </section>

      <section class="grid gap-3">
        <h2 class="text-lg">Wachtrij en beeldwerk</h2>
        <p class="text-sm">{{ o.queue.queued }} in de wachtrij, {{ o.queue.running }} bezig, {{ o.queue.failed24h }} mislukt in 24 uur. Rekenprocessen: {{ o.imaging.mode === 'workers' ? `${o.imaging.workers}, waarvan ${o.imaging.busy} bezig` : 'in het hoofdproces' }}.</p>
        <ul v-if="o.queue.recentFailures.length" class="rule-list max-w-4xl">
          <li v-for="(f, i) in o.queue.recentFailures" :key="i" class="grid gap-0.5 py-2 text-sm sm:grid-cols-[10rem_1fr_auto] sm:gap-4">
            <span class="font-medium">{{ JOBS[f.type] ?? f.type }}</span><span class="truncate text-graphite" :title="f.error">{{ f.error }}</span><span class="text-xs text-graphite">{{ timeAgo(f.at) }}</span>
          </li>
        </ul>
      </section>

      <section class="grid gap-3">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="text-lg">Back-ups van de database</h2>
          <button class="btn btn-secondary btn-sm" :disabled="busy === 'backup'" @click="backupNow">{{ busy === 'backup' ? 'Bezig…' : 'Nu een back-up maken' }}</button>
        </div>
        <p class="text-sm text-graphite">Elke dag automatisch, de laatste 14 blijven bewaard. Bestanden ({{ bytes(o.storage.bytes) }} in {{ o.storage.files }} bestanden) vallen hier niet onder; maak daarvan snapshots bij je hostingpartij.</p>
        <ul v-if="o.backups.length" class="rule-list max-w-2xl">
          <li v-for="bk in o.backups" :key="bk.name" class="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{{ new Date(bk.createdAt).toLocaleString('nl-NL') }} <span class="text-graphite">{{ bytes(bk.bytes) }}</span></span>
            <a :href="`/api/admin/backups/${bk.name}`" class="btn btn-quiet btn-sm">Downloaden</a>
          </li>
        </ul>
        <p v-else class="text-sm text-danger">Er is nog geen back-up.</p>
      </section>

      <section class="grid gap-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <h2 class="text-lg">Werkruimtes</h2>
          <input v-model="q" class="input w-72" placeholder="Zoek op naam of e-mailadres" aria-label="Zoeken" />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-sm">
            <thead><tr class="border-b border-rule text-left text-graphite"><th class="py-1.5 font-normal">Naam</th><th class="font-normal">Eigenaar</th><th class="font-normal">Plan</th><th class="text-right font-normal">Leden</th><th class="text-right font-normal">Projecten</th><th class="text-right font-normal">Credits</th><th class="text-right font-normal">Sinds</th><th></th></tr></thead>
            <tbody>
              <tr v-for="w in list" :key="w.id" class="border-b border-rule">
                <td class="py-2">{{ w.name }}</td><td class="text-graphite">{{ w.owner }}</td>
                <td>{{ PLAN_NAMES[w.plan] }}<span v-if="w.status === 'past_due'" class="text-danger">, betaling mislukt</span></td>
                <td class="tabular text-right">{{ w.members }}</td><td class="tabular text-right">{{ w.projects }}</td><td class="tabular text-right">{{ w.credits }}</td>
                <td class="text-right text-graphite">{{ new Date(w.createdAt).toLocaleDateString('nl-NL') }}</td>
                <td class="text-right"><button class="btn btn-quiet btn-sm" @click="grant(w)">Credits</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { timeAgo } from '~/utils/types';
interface Overview {
  users: { total: number; new7d: number; active7d: number };
  workspaces: { total: number; paying: number; pastDue: number };
  content: { projects: number; mockups: number; exports30d: number; shares: number };
  ai: { generations30d: number; failed30d: number; failureRate: number; spend24hUsd: number; spend30dUsd: number; creditsSold30d: number };
  queue: { queued: number; running: number; failed24h: number; recentFailures: { type: string; error: string; at: string }[] };
  imaging: { mode: string; workers: number; busy: number; queued: number };
  storage: { bytes: number; files: number; measuredAt: string };
  backups: { name: string; bytes: number; createdAt: string }[];
}
interface WsRow { id: string; name: string; owner: string | null; plan: string; status: string | null; members: number; projects: number; credits: number; createdAt: string }

const PLAN_NAMES: Record<string, string> = { free: 'Gratis', studio: 'Studio', team: 'Team' };
const JOBS: Record<string, string> = { generation: 'AI-generatie', 'library-scene': 'Bibliotheekscène', 'scroll-video': 'Scrollvideo', 'recapture-asset': 'Website bijwerken', 'rerender-asset': 'Mockups bijwerken' };
const { state: session } = useSession();
if (session.value && !session.value.user?.isAdmin) await navigateTo('/');
const toast = useToast();
const o = ref<Overview | null>(null);
const list = ref<WsRow[]>([]);
const q = ref('');
const busy = ref<string | null>(null);

const usd = (n: number) => `$${n.toFixed(2).replace('.', ',')}`;
const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const kpis = computed(() => {
  const x = o.value!;
  return [
    { label: 'Gebruikers', value: x.users.total, sub: `${x.users.new7d} nieuw, ${x.users.active7d} actief in 7 dagen` },
    { label: 'Betalende werkruimtes', value: x.workspaces.paying, sub: `van ${x.workspaces.total}${x.workspaces.pastDue ? `, ${x.workspaces.pastDue} met mislukte betaling` : ''}` },
    { label: 'AI-kosten', value: usd(x.ai.spend24hUsd), sub: `afgelopen 24 uur, ${usd(x.ai.spend30dUsd)} in 30 dagen` },
    { label: 'Generaties', value: x.ai.generations30d, sub: `30 dagen, ${Math.round(x.ai.failureRate * 100)}% mislukt` },
    { label: 'Mockups', value: x.content.mockups, sub: `${x.content.projects} projecten` },
    { label: 'Exports', value: x.content.exports30d, sub: '30 dagen' },
    { label: 'Actieve presentaties', value: x.content.shares, sub: 'niet ingetrokken' },
    { label: 'Credits verkocht', value: x.ai.creditsSold30d, sub: 'abonnementen en bijkoop, 30 dagen' },
  ];
});

async function load() { o.value = await api<Overview>('/api/admin/overview'); }
async function loadList() { list.value = await api<WsRow[]>(`/api/admin/workspaces?q=${encodeURIComponent(q.value)}`); }
await Promise.all([load(), loadList()]).catch((e) => toast.error((e as Error).message));
let t: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(t); t = setTimeout(() => loadList().catch(() => {}), 250); });

async function backupNow() {
  busy.value = 'backup';
  try { await api('/api/admin/backups', { method: 'POST' }); await load(); toast.info('Back-up gemaakt.'); } catch (e) { toast.error((e as Error).message); } finally { busy.value = null; }
}
async function grant(w: WsRow) {
  const amount = Number(prompt(`Hoeveel credits bijschrijven voor ${w.name}? (negatief = afschrijven)`, '50'));
  if (!amount) return;
  const note = prompt('Reden (zichtbaar in het logboek)', 'Compensatie') ?? '';
  try { await api(`/api/admin/workspaces/${w.id}/credits`, { method: 'POST', body: { amount, note } }); await loadList(); toast.info('Credits bijgewerkt.'); } catch (e) { toast.error((e as Error).message); }
}
</script>
