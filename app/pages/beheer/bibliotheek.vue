<template>
  <div>
    <PageHeader title="Bibliotheek samenstellen" :back="{ to: '/beheer', label: 'Platformbeheer' }" lead="Laat scènes genereren uit vaste presets. Nieuwe scènes komen eerst hier ter beoordeling en zijn pas na publicatie zichtbaar voor gebruikers." />
    <div v-if="data" class="grid gap-12 px-5 py-7 sm:px-8 lg:px-10">
      <!-- Beoordelen -->
      <section v-if="data.pending.length" class="grid gap-4">
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-lg">Te beoordelen <span class="tabular text-graphite">{{ data.pending.length }}</span></h2>
          <p class="text-xs text-graphite">Publiceer alleen scènes waarin het groene vlak strak gevonden is en het beeld klopt.</p>
        </div>
        <ul class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <li v-for="s in data.pending" :key="s.id" class="grid gap-2">
            <NuxtLink :to="`/library/${s.id}`" class="block overflow-hidden rounded-[var(--radius-md)] border border-rule bg-paper">
              <img :src="s.thumbUrl" :alt="s.title" class="aspect-[4/3] w-full object-cover" loading="lazy" />
            </NuxtLink>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ s.title }}</p>
                <p class="text-xs" :class="s.quality >= data.publishQuality ? 'text-graphite' : 'text-danger'">
                  {{ !s.surfaces.length ? 'Geen vlak gevonden' : s.quality >= data.publishQuality ? `Vlak gevonden, ${pct(s.quality)} zeker` : `Vlak onzeker, ${pct(s.quality)}` }}
                </p>
              </div>
              <div class="flex shrink-0 gap-1">
                <button class="btn btn-quiet btn-sm" :disabled="busy === s.id" @click="reject(s.id)">Verwijderen</button>
                <button class="btn btn-primary btn-sm" :disabled="busy === s.id || !s.surfaces.length" @click="publish(s)">Publiceren</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- Genereren -->
      <section class="grid gap-5">
        <div class="flex flex-wrap items-baseline justify-between gap-4">
          <h2 class="text-lg">Presets</h2>
          <div class="flex items-center gap-3 text-sm">
            <button class="btn btn-quiet btn-sm" @click="selectMissing">Alles zonder scène</button>
            <button class="btn btn-quiet btn-sm" :disabled="!selected.size" @click="selected = new Set()">Niets</button>
          </div>
        </div>
        <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <li v-for="p in data.presets" :key="p.id">
            <button type="button" class="tile w-full" :aria-pressed="selected.has(p.id)" @click="toggle(p.id)">
              <span class="flex items-baseline justify-between gap-3">
                <span class="font-medium">{{ p.title }}</span>
                <span class="tabular shrink-0 text-xs text-graphite">{{ countLabel(p) }}</span>
              </span>
              <small>{{ p.objectLabel }} · {{ p.aspect }} · {{ p.note }}</small>
            </button>
          </li>
        </ul>

        <div class="grid gap-4 border-t border-rule pt-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div class="grid gap-3">
            <div class="flex flex-wrap items-center gap-4">
              <span class="text-sm">Kwaliteit</span>
              <div class="segmented" role="group" aria-label="Kwaliteit">
                <button v-for="q in qualities" :key="q.id" type="button" :aria-pressed="quality === q.id" @click="quality = q.id">{{ q.label }}</button>
              </div>
            </div>
            <p class="text-sm">
              <template v-if="!data.provider.configured"><span class="text-danger">{{ data.provider.problem ?? 'De beeldprovider is niet ingesteld.' }}</span></template>
              <template v-else-if="!data.provider.isAi">Provider: testprovider. Er wordt niets betaald; de scènes zijn getekende testbeelden.</template>
              <template v-else>Provider: {{ data.provider.label }}, {{ data.provider.model }}.</template>
            </p>
            <p v-if="preview && selected.size" class="text-sm">
              <span class="tabular font-medium">{{ selected.size }} {{ selected.size === 1 ? 'scène' : 'scènes' }}, {{ preview.exact ? '' : 'circa ' }}{{ usd(preview.totalUsd) }}</span>
              <span class="text-graphite"> · platform afgelopen 24 uur {{ usd(preview.spend.last24h) }} van {{ usd(preview.spend.limit) }}</span>
            </p>
            <p v-if="preview && !preview.spend.fits" class="notice notice-error">Dit past niet binnen het dagelijkse platformmaximum. Kies minder presets of een lagere kwaliteit.</p>
          </div>
          <button class="btn btn-primary" :disabled="!canStart" @click="start">
            <Icon name="spark" />{{ preview && preview.totalUsd > 0 ? `Genereren voor ${usd(preview.totalUsd)}` : 'Genereren' }}
          </button>
        </div>
      </section>

      <!-- Runs -->
      <section v-if="data.runs.length" class="grid gap-3">
        <h2 class="text-lg">Recente runs</h2>
        <table class="w-full text-sm">
          <thead><tr class="border-b border-rule text-left text-graphite"><th class="py-1.5 font-normal">Preset</th><th class="py-1.5 font-normal">Status</th><th class="py-1.5 font-normal">Kwaliteit</th><th class="py-1.5 text-right font-normal">Kosten</th><th class="py-1.5 text-right font-normal">Gestart</th></tr></thead>
          <tbody>
            <tr v-for="r in data.runs" :key="r.id" class="border-b border-rule align-top">
              <td class="py-1.5">{{ titleOf(r.presetId) }}<p v-if="r.error" class="text-xs text-danger">{{ r.error }}</p></td>
              <td class="py-1.5" :class="{ 'text-danger': r.status === 'failed' }">{{ STATUS[r.status] }}</td>
              <td class="py-1.5">{{ qualities.find((q) => q.id === r.quality)?.label }}</td>
              <td class="tabular py-1.5 text-right">{{ usd(r.status === 'failed' ? 0 : r.costUsd) }}</td>
              <td class="py-1.5 text-right text-graphite">{{ timeAgo(r.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { timeAgo, type SceneView } from '~/utils/types';

interface Preset { id: string; title: string; note: string; objectLabel: string; aspect: string; published: number; pending: number }
interface Run { id: string; presetId: string; status: 'queued' | 'running' | 'done' | 'failed'; quality: string; costUsd: number; error: string | null; createdAt: string }
interface Provider { id: string; label: string; model: string; isAi: boolean; configured: boolean; problem?: string | null }
interface Spend { last24h: number; limit: number; remaining: number; fits: boolean }
interface LibraryData { provider: Provider; spend: Spend; publishQuality: number; presets: Preset[]; pending: (SceneView & { quality: number })[]; runs: Run[] }
interface Preview { totalUsd: number; exact: boolean; spend: Spend }

const { state: session } = useSession();
if (session.value && !session.value.user?.isAdmin) await navigateTo('/');

const toast = useToast();
const data = ref<LibraryData | null>(null);
const selected = ref(new Set<string>());
const quality = ref<'low' | 'medium' | 'high'>('medium');
const preview = ref<Preview | null>(null);
const busy = ref<string | null>(null);
const qualities = [{ id: 'low', label: 'Snel concept' }, { id: 'medium', label: 'Normaal' }, { id: 'high', label: 'Hoog' }] as const;
const STATUS: Record<Run['status'], string> = { queued: 'In de wachtrij', running: 'Bezig', done: 'Klaar', failed: 'Mislukt' };

function countLabel(p: Preset) {
  const parts = [p.published ? `${p.published} gepubliceerd` : '', p.pending ? `${p.pending} wacht op beoordeling` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nog geen';
}
const usd = (n: number) => `$${n.toFixed(2).replace('.', ',')}`;
const pct = (q: number) => `${Math.round(q * 100)}%`;
const titleOf = (id: string) => data.value?.presets.find((p) => p.id === id)?.title ?? id;

async function load() {
  data.value = await api<LibraryData>('/api/admin/library');
}
await load().catch((e) => toast.error((e as Error).message));

function toggle(id: string) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selected.value = s;
}
function selectMissing() {
  selected.value = new Set((data.value?.presets ?? []).filter((p) => !p.published && !p.pending).map((p) => p.id));
}

// Kosten opnieuw ramen bij elke wijziging in selectie of kwaliteit.
let seq = 0;
watch([selected, quality], async () => {
  const mine = ++seq;
  if (!selected.value.size) { preview.value = null; return; }
  try {
    const p = await api<Preview>('/api/admin/library/preview', { method: 'POST', body: { presetIds: [...selected.value], quality: quality.value } });
    if (mine === seq) preview.value = p;
  } catch (e) { toast.error((e as Error).message); }
}, { deep: true });

const canStart = computed(() => !!data.value?.provider.configured && selected.value.size > 0 && !!preview.value && preview.value.spend.fits && busy.value !== 'start');

async function start() {
  if (!preview.value) return;
  const amount = preview.value.totalUsd;
  if (amount > 0 && !confirm(`Er worden ${selected.value.size} beelden gegenereerd voor ${preview.value.exact ? '' : 'circa '}${usd(amount)}. Doorgaan?`)) return;
  busy.value = 'start';
  try {
    await api('/api/admin/library/runs', { method: 'POST', body: { presetIds: [...selected.value], quality: quality.value, confirmUsd: amount } });
    toast.info('Gestart. Nieuwe scènes verschijnen hierboven zodra ze klaar zijn.');
    selected.value = new Set();
    await load();
    poll();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = null; }
}

let timer: ReturnType<typeof setTimeout> | null = null;
function poll() {
  if (timer) clearTimeout(timer);
  if (!data.value?.runs.some((r) => r.status === 'queued' || r.status === 'running')) return;
  timer = setTimeout(async () => { await load().catch(() => {}); poll(); }, 2500);
}
onMounted(poll);
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

async function publish(s: SceneView & { quality: number }) {
  busy.value = s.id;
  try {
    const force = s.quality < (data.value?.publishQuality ?? 0.9);
    if (force && !confirm('Het vlak is niet met zekerheid gevonden. Toch publiceren?')) return;
    await api(`/api/admin/library/scenes/${s.id}/publish`, { method: 'POST', body: { force } });
    toast.info(`“${s.title}” staat nu in de bibliotheek.`);
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = null; }
}

async function reject(id: string) {
  if (!confirm('Deze scène verwijderen?')) return;
  busy.value = id;
  try { await api(`/api/admin/library/scenes/${id}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error((e as Error).message); } finally { busy.value = null; }
}
</script>
