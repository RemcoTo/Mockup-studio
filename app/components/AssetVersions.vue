<template>
  <Transition name="fade">
    <div v-if="asset" class="fixed inset-0 z-40 flex justify-end bg-ink/40" @click.self="$emit('close')">
      <aside class="flex h-full w-full max-w-md flex-col overflow-y-auto bg-surround" role="dialog" aria-modal="true" :aria-label="`Versies van ${asset.originalName}`">
        <header class="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
          <div class="min-w-0">
            <h2 class="truncate text-lg">{{ asset.originalName }}</h2>
            <p class="text-sm text-graphite">Versie {{ asset.version }}<template v-if="asset.updatedAt">, bijgewerkt {{ timeAgo(asset.updatedAt) }}</template><template v-if="asset.meta.versionNote">. {{ asset.meta.versionNote }}</template></p>
          </div>
          <button class="btn btn-quiet" aria-label="Sluiten" @click="$emit('close')"><Icon name="close" /></button>
        </header>

        <div class="grid gap-8 px-6 py-6">
          <Checker class="aspect-[4/3] overflow-hidden rounded-sm"><img :src="asset.previewUrl" :alt="asset.originalName" class="h-full w-full object-contain p-3" /></Checker>

          <section v-if="editable" class="grid gap-3">
            <h3 class="text-sm font-medium">Nieuwe versie</h3>
            <p class="text-sm text-graphite">Alle mockups met dit ontwerp worden bijgewerkt. Schaal, positie en rotatie blijven zoals ze zijn.</p>
            <div class="flex flex-wrap gap-2">
              <label class="btn btn-secondary btn-sm cursor-pointer" :class="{ 'pointer-events-none opacity-50': busy }">
                <Icon name="upload" :size="14" />Bestand kiezen
                <input type="file" class="sr-only" accept=".png,.jpg,.jpeg,.webp,.svg,.pdf" :disabled="!!busy" @change="upload" />
              </label>
              <button v-if="isWebsite" class="btn btn-secondary btn-sm" :disabled="!!busy" @click="recapture"><Icon name="reset" :size="14" />{{ busy === 'capture' ? 'Vastleggen…' : 'Website opnieuw vastleggen' }}</button>
            </div>
            <template v-if="isWebsite">
              <label class="field mt-2">
                <span class="text-sm">Automatisch bijwerken<NuxtLink v-if="!has('living')" to="/abonnement" class="plan-tag">Studio</NuxtLink></span>
                <select class="input" :value="refresh" :disabled="!!busy || !has('living')" @change="setRefresh(($event.target as HTMLSelectElement).value as Interval)">
                  <option value="off">Uit</option>
                  <option value="daily">Elke dag</option>
                  <option value="weekly">Elke week</option>
                </select>
              </label>
              <p class="text-xs text-graphite">{{ String(asset.meta.url ?? '') }}<template v-if="asset.meta.capturedAt">, laatst vastgelegd {{ timeAgo(String(asset.meta.capturedAt)) }}</template>. Verandert de pagina, dan worden je mockups vanzelf bijgewerkt; is hij gelijk gebleven, dan verandert er niets.</p>
              <p v-if="asset.meta.lastRefreshError" class="notice notice-error text-sm">De laatste automatische vastlegging is mislukt: {{ asset.meta.lastRefreshError }}</p>
            </template>
          </section>

          <section class="grid gap-3">
            <h3 class="text-sm font-medium">Eerdere versies</h3>
            <p v-if="versions && !versions.length" class="text-sm text-graphite">Nog geen eerdere versies.</p>
            <ul v-if="versions?.length" class="rule-list">
              <li v-for="v in versions" :key="v.id" class="flex items-center gap-3 py-3">
                <Checker class="h-12 w-16 shrink-0 overflow-hidden rounded-sm"><img v-if="v.previewUrl" :src="v.previewUrl" alt="" class="h-full w-full object-contain p-1" loading="lazy" /></Checker>
                <div class="min-w-0 flex-1 text-sm">
                  <p class="truncate"><span class="font-medium">Versie {{ v.version }}</span> <span class="text-graphite">{{ timeAgo(v.createdAt) }}</span></p>
                  <p class="truncate text-xs text-graphite">{{ v.note || (v.version === 1 ? (isWebsite ? 'Eerste vastlegging' : 'Eerste upload') : v.originalName) }}, {{ v.width }} × {{ v.height }} px</p>
                </div>
                <button v-if="editable" class="btn btn-quiet btn-sm" :disabled="!!busy" @click="restore(v)">Terugzetten</button>
              </li>
            </ul>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { timeAgo, type AssetView } from '~/utils/types';

type Interval = 'off' | 'daily' | 'weekly';
interface VersionRow { id: string; version: number; originalName: string; width: number; height: number; note: string; createdAt: string; previewUrl: string | null }
interface ChangeResult { changed?: boolean; affectedMockups: number; warnings?: string[]; asset: AssetView }

const props = defineProps<{ asset: AssetView | null; editable: boolean }>();
const emit = defineEmits<{ close: []; changed: [asset: AssetView] }>();
const toast = useToast();
const { has } = useSession();
const versions = ref<VersionRow[] | null>(null);
const busy = ref<'upload' | 'capture' | 'restore' | 'refresh' | null>(null);
const isWebsite = computed(() => props.asset?.source === 'url');
const refresh = computed<Interval>(() => (props.asset?.meta.autoRefresh as Interval) ?? 'off');

function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && props.asset) emit('close'); }
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function loadVersions() {
  if (!props.asset) return;
  versions.value = (await api<{ versions: VersionRow[] }>(`/api/assets/${props.asset.id}/versions`)).versions;
}
watch(() => props.asset?.id, () => { versions.value = null; loadVersions().catch((e) => toast.error((e as Error).message)); }, { immediate: true });

function report(r: ChangeResult, what: string) {
  if (r.changed === false) toast.info(`${what}: geen wijzigingen gevonden, er is niets aangepast.`);
  else toast.info(r.affectedMockups ? `${what}. ${r.affectedMockups} ${r.affectedMockups === 1 ? 'mockup wordt' : 'mockups worden'} bijgewerkt.` : `${what}.`);
  for (const w of r.warnings ?? []) toast.info(w);
  emit('changed', r.asset);
  loadVersions().catch(() => {});
}

async function upload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !props.asset) return;
  busy.value = 'upload';
  try {
    const fd = new FormData();
    fd.append('file', file);
    report(await api<ChangeResult>(`/api/assets/${props.asset.id}/replace`, { method: 'POST', body: fd }), 'Nieuwe versie opgeslagen');
  } catch (err) { toast.error((err as Error).message); } finally { busy.value = null; }
}

async function recapture() {
  if (!props.asset) return;
  busy.value = 'capture';
  try { report(await api<ChangeResult>(`/api/assets/${props.asset.id}/recapture`, { method: 'POST' }), 'Website opnieuw vastgelegd'); }
  catch (err) { toast.error((err as Error).message); } finally { busy.value = null; }
}

async function restore(v: VersionRow) {
  if (!props.asset || !confirm(`Versie ${v.version} terugzetten? De huidige versie blijft bewaard.`)) return;
  busy.value = 'restore';
  try { report(await api<ChangeResult>(`/api/assets/${props.asset.id}/versions/${v.id}/restore`, { method: 'POST' }), `Versie ${v.version} teruggezet`); }
  catch (err) { toast.error((err as Error).message); } finally { busy.value = null; }
}

async function setRefresh(interval: Interval) {
  if (!props.asset) return;
  busy.value = 'refresh';
  try {
    const a = await api<AssetView>(`/api/assets/${props.asset.id}/refresh`, { method: 'PATCH', body: { interval } });
    emit('changed', a);
    toast.info(interval === 'off' ? 'Automatisch bijwerken staat uit.' : `Deze website wordt ${interval === 'daily' ? 'elke dag' : 'elke week'} opnieuw vastgelegd.`);
  } catch (err) { toast.error((err as Error).message); } finally { busy.value = null; }
}
</script>
