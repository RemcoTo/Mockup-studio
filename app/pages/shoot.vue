<template>
  <div>
    <PageHeader title="Brand shoot" lead="Eén art direction voor al je dragers. Dezelfde plek, hetzelfde licht en dezelfde stijl, zodat de beelden samen een serie vormen." />

    <div class="grid gap-10 px-5 py-8 sm:px-8 lg:px-10 xl:grid-cols-[1fr_340px]">
      <div class="grid gap-12">
        <!-- Project -->
        <section class="grid gap-4">
          <div class="flex flex-wrap items-end gap-3">
            <label class="field w-72"><span>Project</span>
              <select v-model="projectId" class="input">
                <option value="" disabled>Kies een project</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <label class="field w-80"><span>Naam van de shoot</span><input v-model="title" class="input" maxlength="120" :placeholder="project ? `${project.name}, lancering` : 'Bijvoorbeeld: lancering voorjaar'" /></label>
          </div>
        </section>

        <!-- Art direction -->
        <section class="grid gap-6">
          <h2 class="text-lg">Art direction</h2>
          <div class="grid gap-3">
            <span class="text-sm">Plek</span>
            <div class="flex flex-wrap gap-2">
              <button v-for="e in ENVIRONMENTS" :key="e.id" type="button" class="chip" :aria-pressed="direction.environment === e.id && !direction.environmentCustom" @click="direction.environment = e.id; direction.environmentCustom = ''">{{ e.label }}</button>
            </div>
            <input v-model="direction.environmentCustom" class="input max-w-2xl" maxlength="400" placeholder="Of beschrijf de plek zelf, bijvoorbeeld: een lichte werkplaats met travertin en eikenhout" />
          </div>
          <div class="grid gap-3">
            <span class="text-sm">Licht</span>
            <div class="flex flex-wrap gap-2">
              <button v-for="l in LIGHTING" :key="l.id" type="button" class="chip" :aria-pressed="direction.lighting === l.id" @click="direction.lighting = l.id">{{ l.label }}</button>
            </div>
            <div class="max-w-md"><Slider label="Kleurtemperatuur" :model-value="direction.colorTemperature ?? 5000" :min="2700" :max="7500" :step="100" unit="K" @update:model-value="(v) => (direction.colorTemperature = v)" /></div>
          </div>
          <div class="grid gap-3" data-section="colors">
            <span class="text-sm">Kleuren</span>
            <p class="max-w-2xl text-sm text-graphite">Dezelfde merkkleuren in elk beeld van de serie. Kies per kleur waar hij terugkomt; je ontwerpen blijven precies zoals je ze aanlevert.</p>
            <PaletteEditor v-model="palette" :conflict="conflictHex" />
          </div>
          <div class="grid gap-3">
            <span class="text-sm">Fotografische stijl</span>
            <div class="flex flex-wrap gap-2">
              <button v-for="s in STYLES" :key="s.id" type="button" class="chip" :aria-pressed="direction.style === s.id" @click="direction.style = s.id">{{ s.label }}</button>
            </div>
          </div>
          <label class="field max-w-2xl"><span class="text-sm">Aanwijzingen voor de fotograaf</span>
            <textarea v-model="direction.instructions" class="input min-h-24 py-2" maxlength="2000" placeholder="Materialen, kleurpalet, sfeer. Bijvoorbeeld: warm ochtendlicht van links, zandkleurig linnen, één takje eucalyptus, geen andere rekwisieten." />
          </label>
        </section>

        <!-- Referentiebeelden: sturen de art direction van de hele serie, nooit de inhoud. -->
        <section v-if="projectId" class="grid gap-5">
          <div class="grid gap-2">
            <h2 class="text-lg">Referentiebeelden <span class="tabular text-graphite">{{ refIds.length }}/{{ MAX_REFS }}</span></h2>
            <p class="max-w-2xl text-sm text-graphite">Beelden waarvan je de fotografie mooi vindt: compositie, licht, materialen, kleur. Het model gebruikt ze als richting voor alle beelden in de serie en maakt er nieuwe foto’s mee; het kopieert ze niet. Op de vlakken komen altijd jouw eigen ontwerpen.</p>
          </div>
          <ul v-if="chosenRefs.length" class="flex flex-wrap gap-3" aria-label="Gekozen referentiebeelden">
            <li v-for="r in chosenRefs" :key="r.id" class="ref-card">
              <img :src="r.previewUrl" :alt="r.originalName" class="h-28 w-40 rounded-sm object-cover" />
              <button type="button" class="ref-remove" :title="uploadedHere.has(r.id) ? 'Verwijderen' : 'Niet gebruiken in deze shoot'" :aria-label="`${r.originalName} ${uploadedHere.has(r.id) ? 'verwijderen' : 'niet gebruiken'}`" :disabled="removingRef === r.id" @click="removeRef(r)"><Icon name="close" :size="13" /></button>
              <span class="block w-40 truncate pt-1 text-xs text-graphite">{{ r.originalName }}</span>
            </li>
          </ul>
          <div v-if="refIds.length < MAX_REFS" class="max-w-3xl">
            <DesignImport :project-id="projectId" kind="reference" :max-mb="status?.uploadMaxMb" @added="onRefsAdded" />
          </div>
          <div v-if="otherRefs.length" class="grid gap-2">
            <span class="text-xs text-graphite">Eerder geüpload in dit project</span>
            <div class="flex flex-wrap gap-2">
              <button v-for="r in otherRefs" :key="r.id" type="button" class="ref-add" :title="`${r.originalName} gebruiken`" :disabled="refIds.length >= MAX_REFS" @click="addRef(r.id)">
                <img :src="r.previewUrl" :alt="r.originalName" class="h-14 w-20 rounded-sm object-cover" /><span class="plus"><Icon name="plus" :size="12" /></span>
              </button>
            </div>
          </div>
          <div v-if="refIds.length" class="grid gap-2">
            <span class="text-sm">Gebruik de referenties voor</span>
            <div class="flex flex-wrap gap-2">
              <button v-for="a in REFERENCE_ASPECTS" :key="a.id" type="button" class="chip" :aria-pressed="refAspects.includes(a.id)" @click="toggleAspect(a.id)">{{ a.label }}</button>
            </div>
          </div>
          <p v-if="refIds.length && status && !status.provider.supportsReferences" class="notice max-w-2xl text-sm">De testprovider maakt getekende testscènes en gebruikt geen referentiebeelden. Met OpenAI als provider gaan ze mee naar het model.</p>
          <p v-else-if="refIds.length && status?.provider.isAi" class="max-w-2xl text-xs text-graphite">Referentiebeelden gaan bij elk beeld als invoer mee naar het model. Dat geeft een kleine extra invoerkost per beeld, die niet in de kostenschatting hiernaast zit.</p>
        </section>

        <!-- Serie -->
        <section class="grid gap-5">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-lg">De serie <span class="tabular text-graphite">{{ items.length }}</span></h2>
            <button class="btn btn-quiet btn-sm" :disabled="items.length >= 8" @click="addItem"><Icon name="plus" :size="14" />Beeld toevoegen</button>
          </div>
          <p v-if="!designs.length && projectId" class="notice text-sm">Dit project heeft nog geen ontwerpen. Je kunt de shoot maken zonder ontwerp en er later een kiezen in de editor.</p>
          <ol class="rule-list">
            <li v-for="(it, i) in items" :key="it.key" class="grid items-center gap-3 py-3 sm:grid-cols-[2rem_1fr_1fr_auto]">
              <span class="tabular text-sm text-mist">{{ String(i + 1).padStart(2, '0') }}</span>
              <label class="field"><span class="sr-only">Object</span>
                <select v-model="it.objectType" class="input">
                  <optgroup v-for="c in CATEGORIES" :key="c.id" :label="c.label"><option v-for="o in c.objects" :key="o.id" :value="o.id">{{ o.label }}</option></optgroup>
                </select>
              </label>
              <label class="field"><span class="sr-only">Ontwerp</span>
                <select v-model="it.assetId" class="input">
                  <option :value="null">Zonder ontwerp</option>
                  <option v-for="d in designs" :key="d.id" :value="d.id">{{ d.originalName }}</option>
                </select>
              </label>
              <button class="btn btn-quiet btn-sm" :disabled="items.length === 1" aria-label="Verwijderen" @click="items.splice(i, 1)"><Icon name="trash" :size="14" /></button>
            </li>
          </ol>
          <label v-if="deviceCount" class="flex max-w-2xl items-start gap-2.5 text-sm" data-section="device3d">
            <input v-model="devices3d" type="checkbox" class="check mt-0.5" />
            <span class="grid gap-0.5">
              <span>{{ deviceCount === 1 ? 'Het device' : 'Devices' }} als echt 3D-model</span>
              <span class="text-graphite">De AI maakt alleen de omgeving. {{ deviceCount === 1 ? 'Het toestel wordt' : 'Laptops, telefoons, tablets en monitoren worden' }} lokaal gerenderd, met je ontwerp exact op het scherm; camera en openingshoek pas je daarna aan in de editor.</span>
            </span>
          </label>
        </section>

        <section v-if="runs.length" ref="results" class="grid gap-6 border-t border-rule pt-10">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-lg">{{ runTitle }}</h2>
            <span class="tabular text-sm text-graphite">{{ doneCount }} van {{ runs.length }} klaar</span>
          </div>
          <div class="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
            <figure v-for="(r, i) in runs" :key="r.id" class="grid gap-2">
              <NuxtLink v-if="r.mockup?.previewUrl" :to="`/editor/${r.mockup.id}`" class="block overflow-hidden rounded-sm bg-paper"><img :src="r.mockup.previewUrl" :alt="r.label" class="aspect-[4/3] w-full object-cover" /></NuxtLink>
              <div v-else-if="r.status === 'failed'" class="notice notice-error aspect-[4/3] text-sm">{{ r.error }}</div>
              <div v-else class="pending aspect-[4/3] rounded-sm" />
              <figcaption class="flex items-baseline justify-between gap-2 text-sm">
                <span><span class="tabular text-mist">{{ String(i + 1).padStart(2, '0') }}</span> {{ r.label }}</span>
                <NuxtLink v-if="r.mockup" :to="`/editor/${r.mockup.id}`" class="btn btn-quiet btn-sm">Bewerken</NuxtLink>
              </figcaption>
            </figure>
          </div>
          <div v-if="doneCount === runs.length && readyIds.length" class="flex flex-wrap gap-2">
            <button class="btn btn-primary btn-sm" @click="sharing = true"><Icon name="globe" :size="14" />Serie delen met klant</button>
            <button class="btn btn-secondary btn-sm" :disabled="zipping" @click="zip"><Icon name="download" :size="14" />{{ zipping ? 'Exporteren…' : 'Serie downloaden als zip' }}</button>
          </div>
        </section>
        <ShareDialog v-if="project" :open="sharing" :project-id="project.id" :mockup-ids="readyIds" :default-title="runTitle" @close="sharing = false" />
      </div>

      <aside class="xl:sticky xl:top-6 xl:self-start">
        <div class="grid gap-4 rounded-lg border border-rule bg-white p-5">
          <h3 class="text-base">Shoot</h3>
          <p v-if="status && !status.provider.configured" class="notice notice-error text-sm">{{ status.provider.problem }}</p>
          <p v-else-if="status && !status.provider.isAi" class="notice text-sm">De testprovider is actief: je krijgt getekende testscènes, geen AI-beelden.</p>
          <div class="grid gap-2">
            <span class="text-sm">Kwaliteit</span>
            <div class="segmented"><button v-for="q in QUALITIES" :key="q.id" type="button" :aria-pressed="quality === q.id" @click="quality = q.id">{{ q.label }}</button></div>
          </div>
          <dl v-if="preview" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt class="text-graphite">Beelden</dt><dd>{{ items.length }}</dd>
            <dt class="text-graphite">Kosten</dt><dd>{{ costText }}</dd>
            <template v-if="status?.creditsEnforced"><dt class="text-graphite">Credits</dt><dd>{{ preview.credits }}</dd></template>
          </dl>
          <p v-if="preview?.problem" class="notice notice-error text-sm" role="alert">{{ preview.problem }}</p>
          <button class="btn btn-primary" :disabled="!canStart || starting || !!preview?.problem || !!conflictHex || !!paletteProblem(paletteRef) || !!keyConflict({ palette: paletteRef, backdrop: null })" @click="start"><Icon name="spark" />{{ starting ? 'Starten…' : `Shoot starten, ${items.length} ${items.length === 1 ? 'beeld' : 'beelden'}` }}</button>
          <p class="text-xs leading-relaxed text-graphite">Het model maakt alleen de omgevingen. Je ontwerpen gaan niet naar het model en worden daarna pixel-exact geplaatst. Een mislukt beeld kost niets.</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api, downloadPost } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { AssetView, ProjectSummary, ProjectDetail, StatusInfo } from '~/utils/types';
import { CATEGORIES, ENVIRONMENTS, LIGHTING, REFERENCE_ASPECTS, STYLES, findObject } from '~~/shared/catalog';
import { emptyPalette, paletteProblem, type ScenePalette } from '~~/shared/palette';
import { chromaConflict, keyConflict } from '~~/shared/scene-style';
import { recallPalette, rememberPalette } from '~/composables/usePaletteMemory';
import { deviceModelFor } from '~~/shared/device3d/spec';
import type { Generation } from '~~/shared/types';

interface Item { key: number; objectType: string; assetId: string | null }
interface Preview { totalUsd: number; exact: boolean; credits: number; provider: StatusInfo['provider']; problem: string | null }

const QUALITIES = [{ id: 'low', label: 'Snel concept' }, { id: 'medium', label: 'Normaal' }, { id: 'high', label: 'Hoog' }] as const;
const route = useRoute();
const router = useRouter();
const toast = useToast();
const projects = ref<ProjectSummary[]>([]);
const status = ref<StatusInfo | null>(null);
const projectId = ref(String(route.query.project ?? ''));
const project = ref<ProjectDetail['project'] | null>(null);
const assets = ref<AssetView[]>([]);
const title = ref('');
const quality = ref<'low' | 'medium' | 'high'>('medium');
const direction = reactive<{ environment?: string; environmentCustom?: string; lighting?: string; colorTemperature?: number; style?: string; instructions?: string }>({
  environment: 'architecture', lighting: 'daylight', colorTemperature: 5000, style: 'editorial', instructions: '',
});
const refIds = ref<string[]>([]);
// Merkkleuren voor de hele serie; per project onthouden in deze browser (gedeeld met Nieuwe mockup).
const paletteRef = ref<ScenePalette>(emptyPalette());
const palette = computed<ScenePalette>({
  get: () => paletteRef.value,
  set: (p) => { paletteRef.value = p; rememberPalette(projectId.value, p); },
});
// Brand Shoot vindt het ontwerpvlak altijd automatisch (groen vlak); een groene kleur maakt dat onbetrouwbaar.
// Met echte 3D-devices zoekt de studio daar geen groen vlak; alleen de overige beelden kunnen dan botsen.
const devices3d = ref(true);
const deviceCount = computed(() => items.value.filter((it) => !!deviceModelFor(it.objectType)).length);
const usesChroma = computed(() => !devices3d.value || items.value.some((it) => !deviceModelFor(it.objectType)));
const conflictHex = computed(() => usesChroma.value ? chromaConflict({ surfaceMethod: 'chroma', backdrop: null, palette: paletteRef.value }) : null);
let seq = 0;
const items = ref<Item[]>([]);
interface Run { id: string; label: string; status: string; error: string | null; mockup: { id: string; previewUrl: string | null } | null }
const runs = ref<Run[]>([]);
const sharing = ref(false);
const zipping = ref(false);
const doneCount = computed(() => runs.value.filter((r) => r.status === 'done' || r.status === 'failed').length);
const readyIds = computed(() => runs.value.map((r) => r.mockup?.id).filter((x): x is string => !!x));
let poller: ReturnType<typeof setInterval> | undefined;
async function pollRuns() {
  for (const r of runs.value) {
    if (r.status === 'done' || r.status === 'failed') continue;
    try {
      const d = await api<{ generation: Generation; mockups: { id: string; previewUrl: string | null }[] }>(`/api/generations/${r.id}`);
      r.status = d.generation.status; r.error = d.generation.error;
      if (d.generation.status === 'done') r.mockup = d.mockups[0] ?? null;
    } catch { /* volgende ronde */ }
  }
  if (doneCount.value === runs.value.length) clearInterval(poller);
}
onBeforeUnmount(() => clearInterval(poller));
async function zip() {
  zipping.value = true;
  try { await downloadPost('/api/exports/zip', { mockupIds: readyIds.value, format: 'png', quality: 92 }, `${runTitle.value || 'brand-shoot'}.zip`); }
  catch (e) { toast.error((e as Error).message); } finally { zipping.value = false; }
}
const runTitle = ref('');
const starting = ref(false);
const results = ref<HTMLElement | null>(null);

const designs = computed(() => assets.value.filter((a) => a.kind === 'design'));
const references = computed(() => assets.value.filter((a) => a.kind === 'reference'));
const canStart = computed(() => !!projectId.value && !!status.value?.provider.configured && items.value.length > 0);

onMounted(async () => {
  [projects.value, status.value] = await Promise.all([api<ProjectSummary[]>('/api/projects'), api<StatusInfo>('/api/status')]);
  if (!projectId.value && projects.value.length) projectId.value = projects.value[0]!.id;
});

/** Een logische eerste serie op basis van de ontwerpen in het project. */
function suggest(list: AssetView[]): Item[] {
  // Een e-mailhandtekening is ook breed, maar geen website: die niet op het laptopscherm voorstellen.
  const signature = (a: AssetView) => /handtekening|signature/i.test(a.originalName);
  const site = list.find((a) => a.source === 'url' && a.meta.viewport !== 'smartphone') ?? list.find((a) => !signature(a) && a.width / a.height > 1.3 && a.width / a.height < 2.4 && a.mime !== 'image/svg+xml');
  const mobile = list.find((a) => a.source === 'url' && a.meta.viewport === 'smartphone') ?? list.find((a) => a.height / a.width > 1.5);
  const logo = list.find((a) => /logo/i.test(a.originalName)) ?? list.find((a) => a.mime === 'image/svg+xml');
  const card = list.find((a) => /visitekaart|business|card/i.test(a.originalName));
  const out: Omit<Item, 'key'>[] = [];
  if (site) out.push({ objectType: 'laptop', assetId: site.id });
  if (mobile) out.push({ objectType: 'smartphone', assetId: mobile.id });
  if (card) out.push({ objectType: 'business-card', assetId: card.id });
  if (logo) out.push({ objectType: 'mug', assetId: logo.id }, { objectType: 't-shirt', assetId: logo.id });
  if (!out.length) out.push({ objectType: 'laptop', assetId: null }, { objectType: 'poster', assetId: null });
  return out.slice(0, 5).map((x) => ({ ...x, key: ++seq }));
}

watch(projectId, async (id) => {
  if (!id) return;
  const d = await api<ProjectDetail>(`/api/projects/${id}`);
  project.value = d.project;
  assets.value = d.assets;
  items.value = suggest(designs.value);
  refIds.value = [];
  paletteRef.value = recallPalette(id) ?? emptyPalette();
  uploadedHere.clear();
  router.replace({ query: { ...route.query, project: id } });
}, { immediate: true });

function addItem() { items.value.push({ key: ++seq, objectType: 'poster', assetId: designs.value[0]?.id ?? null }); }
// Referentiebeelden: maximaal vier per shoot (zoals bij een losse generatie), standaard voor alle aspecten.
const MAX_REFS = 4;
const refAspects = ref<string[]>(REFERENCE_ASPECTS.map((a) => a.id));
const uploadedHere = reactive(new Set<string>());
const removingRef = ref<string | null>(null);
const chosenRefs = computed(() => refIds.value.map((id) => references.value.find((r) => r.id === id)).filter((r): r is AssetView => !!r));
const otherRefs = computed(() => references.value.filter((r) => !refIds.value.includes(r.id)));
function addRef(id: string) {
  if (refIds.value.includes(id)) return;
  if (refIds.value.length >= MAX_REFS) { toast.info(`Een shoot gebruikt maximaal ${MAX_REFS} referentiebeelden.`); return; }
  refIds.value = [...refIds.value, id];
}
function onRefsAdded(list: AssetView[]) {
  assets.value = [...list, ...assets.value];
  for (const a of list) { uploadedHere.add(a.id); addRef(a.id); }
}
/** In deze shoot geüpload: echt verwijderen. Al eerder in het project: alleen niet gebruiken. */
async function removeRef(r: AssetView) {
  refIds.value = refIds.value.filter((x) => x !== r.id);
  if (!uploadedHere.has(r.id)) return;
  removingRef.value = r.id;
  try {
    await api(`/api/assets/${r.id}`, { method: 'DELETE' });
    assets.value = assets.value.filter((a) => a.id !== r.id);
    uploadedHere.delete(r.id);
  } catch (e) { toast.error((e as Error).message); } finally { removingRef.value = null; }
}
function toggleAspect(id: string) {
  const next = refAspects.value.includes(id) ? refAspects.value.filter((x) => x !== id) : [...refAspects.value, id];
  refAspects.value = next.length ? next : REFERENCE_ASPECTS.map((a) => a.id);
}

const body = computed(() => ({
  projectId: projectId.value, title: title.value || (project.value ? `${project.value.name}, brand shoot` : ''), quality: quality.value,
  direction: { ...direction, palette: paletteRef.value.colors.length ? paletteRef.value : undefined, referenceAssetIds: refIds.value.length ? refIds.value : undefined, referenceAspects: refIds.value.length ? refAspects.value : undefined, avoid: ['text', 'logos', 'people', 'watermark'] },
  items: items.value.map(({ objectType, assetId }) => ({ objectType, assetId })),
  devices3d: devices3d.value,
}));

const preview = ref<Preview | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(body, () => {
  clearTimeout(timer);
  if (!projectId.value || !items.value.length) { preview.value = null; return; }
  timer = setTimeout(async () => {
    try { preview.value = await api<Preview>('/api/shoots/preview', { method: 'POST', body: body.value }); } catch { /* bij starten gemeld */ }
  }, 250);
}, { deep: true, immediate: true });

const costText = computed(() => {
  const p = preview.value;
  if (!p) return '';
  if (!p.provider.isAi) return 'Gratis (testscènes)';
  return `${p.exact ? '' : 'circa '}$${p.totalUsd.toFixed(2).replace('.', ',')}`;
});

async function start() {
  if (!canStart.value) return;
  starting.value = true;
  try {
    const r = await api<{ generations: Generation[] }>('/api/shoots', { method: 'POST', body: body.value });
    runTitle.value = body.value.title;
    runs.value = r.generations.map((g) => ({ id: g.id, label: findObject(g.config.objectType)?.object.label ?? g.config.objectType, status: g.status, error: null, mockup: null }));
    clearInterval(poller);
    poller = setInterval(pollRuns, 1500);
    await nextTick();
    results.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast.error((e as Error).message); } finally { starting.value = false; }
}
</script>

<style scoped>
.ref-card { position: relative; }
.ref-remove { position: absolute; top: 0.35rem; right: 0.35rem; display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: rgb(255 255 255 / 0.94); color: var(--color-ink); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); transition: background 120ms; }
.ref-remove:hover { background: var(--color-white); color: var(--color-danger); }
.ref-add { position: relative; border-radius: var(--radius-sm); opacity: 0.85; transition: opacity 120ms; }
.ref-add:hover:not(:disabled) { opacity: 1; }
.ref-add:disabled { opacity: 0.35; cursor: not-allowed; }
.ref-add .plus { position: absolute; right: 0.25rem; bottom: 0.25rem; display: grid; place-items: center; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: var(--color-ink); color: var(--color-paper); }
.pending { background: linear-gradient(100deg, var(--color-paper) 30%, #ececea 50%, var(--color-paper) 70%); background-size: 300% 100%; animation: sheen 1.6s linear infinite; }
@keyframes sheen { from { background-position: 100% 0; } to { background-position: 0 0; } }
</style>
