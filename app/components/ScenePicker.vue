<template>
  <div class="grid gap-5">
    <!-- Zoeken en categorieën altijd zichtbaar; de overige filters achter één knop. -->
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="search relative min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite" />
          <input v-model="q" class="input pl-9" type="search" placeholder="Zoek een scène" aria-label="Scènes zoeken" />
        </label>
        <button v-if="tagFilters.length || objectOptions.length > 1" class="btn btn-secondary" :aria-expanded="more" @click="more = !more">
          <Icon name="filter" :size="15" />Filters<span v-if="extraCount" class="count">{{ extraCount }}</span>
        </button>
        <button v-if="activeFilters" class="btn btn-quiet" @click="clear">Wissen</button>
        <span v-if="loaded" class="ml-auto hidden text-sm text-graphite sm:inline">{{ filtered.length }} {{ filtered.length === 1 ? 'scène' : 'scènes' }}</span>
      </div>
      <div class="chips flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Categorie">
        <button class="chip shrink-0" :aria-pressed="!category" @click="category = ''">Alles</button>
        <button v-for="c in categoryOptions" :key="c.id" class="chip shrink-0" :aria-pressed="category === c.id" @click="category = category === c.id ? '' : c.id">{{ c.label }}</button>
      </div>
      <div v-if="more" class="grid grid-cols-2 gap-3 rounded-lg border border-rule bg-white p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filters">
        <label class="field"><span>Object</span>
          <select v-model="objectType" class="input h-9"><option value="">Alle objecten</option><option v-for="o in objectOptions" :key="o.id" :value="o.id">{{ o.label }}</option></select>
        </label>
        <label v-for="f in tagFilters" :key="f.key" class="field"><span>{{ f.label }}</span>
          <select v-model="tags[f.key]" class="input h-9"><option value="">Alle</option><option v-for="v in f.values" :key="v.id" :value="v.id">{{ v.label }}</option></select>
        </label>
      </div>
    </div>

    <p v-if="loaded && !filtered.length" class="py-8 text-sm text-graphite">Geen scènes gevonden. <button v-if="activeFilters" class="underline underline-offset-2" @click="clear">Filters wissen</button></p>
    <div v-if="!loaded" class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3" :class="dense ? 'xl:grid-cols-3' : 'xl:grid-cols-4 2xl:grid-cols-5'">
      <span v-for="n in 8" :key="n" class="aspect-[4/3] animate-pulse rounded-sm bg-paper" />
    </div>
    <div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3" :class="dense ? 'xl:grid-cols-3' : 'xl:grid-cols-4 2xl:grid-cols-5'">
      <div v-for="s in filtered" :key="s.id" class="scene-card relative" :data-scene="s.id">
        <button type="button" class="scene grid w-full gap-2 text-left" :aria-pressed="selectedId === s.id" @click="$emit('pick', s)">
          <span class="relative block aspect-[4/3] overflow-hidden rounded-sm bg-paper">
            <img :src="thumbOf(s)" :alt="s.title" class="h-full w-full object-cover" loading="lazy" />
            <span v-if="isNew(s)" class="tag new left-2">Nieuw</span>
            <span v-if="s.surfaces.length > 1" class="tag right-2">{{ s.surfaces.length }} vlakken</span>
            <span v-if="!s.surfaces.length" class="tag right-2 bg-danger! text-white!">Geen vlak</span>
            <span v-if="pickLabel" class="cta">{{ pickLabel }}</span>
          </span>
          <span class="grid pr-8">
            <span class="truncate text-sm font-medium">{{ s.title }}</span>
            <span class="truncate text-xs text-graphite">{{ originLabel(s) }}</span>
          </span>
        </button>
        <ActionMenu v-if="manage && s.editable" class="menu-at" :label="`Acties voor ${s.title}`">
          <NuxtLink role="menuitem" :to="`/library/${s.id}`"><Icon name="corners" :size="15" />Openen en vlakken bekijken</NuxtLink>
          <NuxtLink v-if="s.surfaces.length" role="menuitem" :to="`/generate?scene=${s.id}`"><Icon name="image" :size="15" />Gebruiken voor een mockup</NuxtLink>
          <NuxtLink v-if="s.config" role="menuitem" :to="`/generate?fromScene=${s.id}`"><Icon name="spark" :size="15" />Nieuwe scène met deze instellingen</NuxtLink>
          <button role="menuitem" class="danger" @click="remove(s)"><Icon name="trash" :size="15" />Verwijderen</button>
        </ActionMenu>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { SceneView } from '~/utils/types';
import { ANGLES, CATEGORIES, POSITIONS, findObject } from '~~/shared/catalog';

const props = withDefaults(defineProps<{ selectedId?: string | null; dense?: boolean; includeProject?: string | null; requireSurfaces?: boolean; previewAssetId?: string | null; pickLabel?: string; manage?: boolean }>(), { selectedId: null, dense: false, includeProject: null, requireSurfaces: false, previewAssetId: null, pickLabel: '', manage: false });
const toast = useToast();
/** Herkomst onder de titel: object en of het een eigen, gegenereerde of standaardscène is. */
function originLabel(s: SceneView) {
  const what = s.origin === 'generated' ? 'gegenereerd met AI' : s.origin === 'demo' ? (s.workspaceId ? 'testscène, eigen' : 'testscène') : s.workspaceId ? 'eigen foto' : '';
  return [objectLabel(s.objectType), what].filter(Boolean).join(', ');
}
/** Een scène van het eigen team uit het afgelopen uur krijgt het label Nieuw. */
const isNew = (s: SceneView) => !!s.workspaceId && Date.now() - new Date(s.createdAt).getTime() < 3600_000;
async function remove(s: SceneView) {
  if (!confirm(`"${s.title}" verwijderen? Mockups op deze scène worden ook verwijderd.`)) return;
  try {
    await api(`/api/scenes/${s.id}`, { method: 'DELETE' });
    scenes.value = scenes.value.filter((x) => x.id !== s.id);
    toast.info('Scène verwijderd.');
  } catch (e) { toast.error((e as Error).message); }
}
const thumbOf = (s: SceneView) => (props.previewAssetId && s.surfaces.length ? `/api/scenes/${s.id}/preview?asset=${props.previewAssetId}&w=560` : s.thumbUrl);
defineEmits<{ pick: [scene: SceneView] }>();

const scenes = ref<SceneView[]>([]);
const loaded = ref(false);
const q = ref('');
const category = ref('');
const objectType = ref('');
const tags = reactive<Record<string, string>>({ material: '', angle: '', composition: '', color: '', orientation: '' });
const more = ref(false);

async function load() {
  const lib = await api<SceneView[]>('/api/scenes', { query: { library: 1 } });
  const own = props.includeProject ? await api<SceneView[]>('/api/scenes', { query: { projectId: props.includeProject } }) : [];
  const seen = new Set<string>();
  scenes.value = [...own, ...lib].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  loaded.value = true;
}
onMounted(load);
defineExpose({ reload: load });

const objectOptions = computed(() => (category.value ? CATEGORIES.find((c) => c.id === category.value)?.objects : CATEGORIES.flatMap((c) => c.objects)) ?? []);
watch(category, () => { if (!objectOptions.value.some((o) => o.id === objectType.value)) objectType.value = ''; });
const objectLabel = (id: string) => findObject(id)?.object.label ?? id;

const LABELS: Record<string, Record<string, string>> = {
  angle: Object.fromEntries(ANGLES.map((a) => [a.id, a.label])),
  composition: Object.fromEntries(POSITIONS.map((a) => [a.id, a.label])),
  orientation: { landscape: 'Liggend', portrait: 'Staand', square: 'Vierkant' },
};
const tagFilters = computed(() =>
  ([['material', 'Materiaal'], ['angle', 'Camerahoek'], ['composition', 'Compositie'], ['color', 'Kleur'], ['orientation', 'Oriëntatie']] as const).map(([key, label]) => {
    const values = [...new Set(scenes.value.map((s) => s.tags[key]).filter((v): v is string => !!v))].sort();
    return { key, label, values: values.map((v) => ({ id: v, label: LABELS[key]?.[v] ?? v.charAt(0).toUpperCase() + v.slice(1) })) };
  }).filter((f) => f.values.length > 0),
);

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return scenes.value.filter((x) =>
    (!props.requireSurfaces || x.surfaces.length > 0) &&
    (!category.value || x.category === category.value) &&
    (!objectType.value || x.objectType === objectType.value) &&
    Object.entries(tags).every(([k, v]) => !v || x.tags[k as keyof typeof x.tags] === v) &&
    (!s || `${x.title} ${objectLabel(x.objectType)} ${Object.values(x.tags).join(' ')}`.toLowerCase().includes(s)),
  );
});
// Alleen categorieën waarin scènes staan.
const categoryOptions = computed(() => CATEGORIES.filter((c) => scenes.value.some((x) => x.category === c.id && (!props.requireSurfaces || x.surfaces.length > 0))));
const extraCount = computed(() => (objectType.value ? 1 : 0) + Object.values(tags).filter(Boolean).length);
const activeFilters = computed(() => !!(q.value || category.value || objectType.value || Object.values(tags).some(Boolean)));
function clear() { q.value = ''; category.value = ''; objectType.value = ''; Object.keys(tags).forEach((k) => (tags[k] = '')); }
</script>

<style scoped>
.scene img { transition: transform 600ms var(--ease-studio); }
.scene:hover img { transform: scale(1.015); }
.menu-at { position: absolute; right: -0.35rem; bottom: 0.1rem; }
.tag.new { top: 0.5rem; bottom: auto; background: var(--color-ink); color: var(--color-paper); }
.tag { position: absolute; bottom: 0.5rem; padding: 0.1rem 0.4rem; border-radius: 3px; background: rgb(255 255 255 / 0.92); color: var(--color-graphite); font-size: 11px; }
.cta { position: absolute; inset: auto 0.5rem 0.5rem auto; padding: 0.35rem 0.65rem; border-radius: var(--radius-md); background: var(--color-ink); color: var(--color-paper); font-size: var(--text-xs); font-weight: 520; opacity: 0; transform: translateY(4px); transition: opacity 140ms, transform 140ms var(--ease-studio); }
.scene:hover .cta, .scene:focus-visible .cta { opacity: 1; transform: none; }
.scene:hover .tag:not(.new), .scene:focus-visible .tag:not(.new) { opacity: 0; }
.count { display: inline-grid; place-items: center; min-width: 1.15rem; height: 1.15rem; padding: 0 0.3rem; border-radius: 999px; background: var(--color-ink); color: var(--color-paper); font-size: 10px; font-weight: 600; }
.chips { scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.scene[aria-pressed='true'] > span:first-child { outline: 2px solid var(--color-cyan); outline-offset: 3px; }
</style>
