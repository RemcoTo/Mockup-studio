<template>
  <div>
    <PageHeader title="Nieuwe mockup" lead="Kies je ontwerp en een scène. Het ontwerp wordt exact geplaatst; daarna werk je het af in de editor." />

    <div class="grid gap-12 px-5 py-8 sm:px-8 lg:px-10">
      <!-- Stap 1 -->
      <section class="step" :class="{ done: !!asset }">
        <h2 class="step-title"><span class="num">1</span>Ontwerp</h2>
        <div class="grid gap-5">
          <div class="flex flex-wrap items-end gap-3">
            <label class="field w-72"><span>Project</span>
              <select v-model="projectId" class="input">
                <option value="" disabled>Kies een project</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <NuxtLink to="/projects/new" class="btn btn-quiet">Nieuw project</NuxtLink>
          </div>

          <template v-if="projectId">
            <div class="flex gap-3 overflow-x-auto pb-2" role="listbox" aria-label="Ontwerp">
              <button type="button" class="design add" :aria-expanded="adding" @click="adding = !adding">
                <span class="grid h-24 w-32 place-items-center rounded-sm border border-dashed border-rule-strong text-graphite"><Icon name="plus" :size="20" /></span>
                <span class="block w-32 pt-1.5 text-left text-xs text-graphite">Ontwerp toevoegen</span>
              </button>
              <button v-for="a in designs" :key="a.id" type="button" role="option" class="design" :aria-selected="assetId === a.id" :aria-pressed="assetId === a.id" @click="assetId = a.id">
                <span class="relative block">
                  <Checker class="h-24 w-32 overflow-hidden rounded-sm"><img :src="a.previewUrl" :alt="a.originalName" class="h-full w-full object-contain p-1.5" /></Checker>
                  <span v-if="assetId === a.id" class="tick"><Icon name="check" :size="12" /></span>
                </span>
                <span class="block w-32 truncate pt-1.5 text-left text-xs">{{ a.originalName }}</span>
              </button>
            </div>
            <div v-if="adding || !designs.length" class="max-w-3xl"><DesignImport :project-id="projectId" :max-mb="status?.uploadMaxMb" @added="onAdded" /></div>
            <p v-if="asset" class="text-xs text-graphite">{{ asset.originalName }}, {{ asset.width }} × {{ asset.height }} px. Dit bestand wordt ongewijzigd geplaatst.</p>
          </template>
        </div>
      </section>

      <!-- Stap 2 -->
      <section class="step" :class="{ muted: !asset }">
        <h2 class="step-title"><span class="num">2</span>Scène</h2>
        <div class="grid gap-6">
          <div class="segmented self-start">
            <button :aria-pressed="method === 'library'" @click="method = 'library'">Uit de bibliotheek</button>
            <button :aria-pressed="method === 'ai'" @click="method = 'ai'"><Icon name="spark" :size="13" class="mr-1 inline" />Nieuwe scène met AI</button>
          </div>

          <div v-if="method === 'library' && chosenScene" class="chosen">
            <img :src="chosenScene.thumbUrl" :alt="chosenScene.title" class="h-24 w-32 rounded-sm object-cover" />
            <div class="grid content-center gap-2">
              <span class="text-sm font-medium">{{ chosenScene.title }}</span>
              <span class="text-xs text-graphite">Gekozen in de bibliotheek. Kies hierboven je ontwerp en open hem in de editor.</span>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-primary btn-sm" :disabled="!projectId || !assetId" @click="useScene(chosenScene)">In de editor openen</button>
                <button class="btn btn-quiet btn-sm" @click="clearChosen">Andere scène kiezen</button>
              </div>
            </div>
          </div>

          <div v-if="method === 'library' && !chosenScene">
            <p class="mb-5 max-w-2xl text-sm text-graphite">Je ziet je ontwerp al op elke foto staan. Kies er een en hij opent in de editor.</p>
            <ScenePicker ref="picker" :include-project="projectId || null" :preview-asset-id="assetId" require-surfaces pick-label="In de editor openen" @pick="useScene" />
          </div>

          <div v-else class="grid gap-10 xl:grid-cols-[1fr_340px]">
            <SceneConfigurator v-model="config" :project-id="projectId" :references="references" :supports-references="!!status?.provider.supportsReferences" :design-asset="asset" @references-added="(a) => projectAssets.push(...a)" />
            <aside class="xl:sticky xl:top-6 xl:self-start">
              <div class="grid gap-4 rounded-lg border border-rule bg-white p-5">
                <h3 class="text-base">Generatie</h3>
                <p v-if="status && !status.provider.configured" class="notice notice-error text-sm">{{ status.provider.problem }}</p>
                <p v-else-if="status && !status.provider.isAi" class="notice text-sm">De testprovider is actief: je krijgt getekende testscènes, geen AI-beelden. Handig om de workflow gratis te proberen.</p>
                <label class="field"><span>Aantal varianten</span>
                  <div class="segmented self-start"><button v-for="n in maxCount" :key="n" type="button" :aria-pressed="count === n" @click="count = n">{{ n }}</button></div>
                </label>
                <dl v-if="preview" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt class="text-graphite">Formaat</dt><dd>{{ preview.size.width }} × {{ preview.size.height }} px</dd>
                  <dt class="text-graphite">Model</dt><dd>{{ preview.provider.isAi ? `${preview.provider.label} ${preview.provider.model}` : 'Testscènes' }}</dd>
                  <dt class="text-graphite">Kosten</dt>
                  <dd>{{ costText }}</dd>
                </dl>
                <details>
                  <summary class="cursor-pointer text-xs text-graphite hover:text-ink">Prompt bekijken</summary>
                  <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-paper p-3 text-[12px] leading-relaxed">{{ preview?.prompt }}</pre>
                </details>
                <p v-if="preview?.problem" class="notice notice-error text-sm">{{ preview.problem }}</p>
                <p v-if="!asset" class="text-xs text-graphite">Kies eerst een ontwerp in stap 1. Je kunt ook zonder ontwerp een scène maken en er later een kiezen.</p>
                <button class="btn btn-primary" :disabled="!canGenerate || starting || !!preview?.problem || !!chromaConflict(config) || !!paletteProblem(config.palette) || !!keyConflict(config)" @click="generate">
                  <Icon name="spark" />{{ starting ? 'Starten…' : count > 1 ? `${count} scènes genereren` : 'Scène genereren' }}
                </button>
                <p class="text-xs leading-relaxed text-graphite">Het model maakt alleen de omgeving. Je ontwerp gaat niet naar het model en wordt daarna pixel-exact geplaatst.</p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <!-- Stap 3 -->
      <section v-if="runs.length" ref="results" class="step">
        <h2 class="step-title"><span class="num">3</span>Resultaat</h2>
        <div class="grid gap-12">
          <GenerationRun v-for="r in runs" :key="r.id" :generation-id="r.id" :count="r.count" :project-name="project?.name ?? 'mockups'" @retry="generate" @again="generate" @done="onGenerated" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { AssetView, SceneView, MockupView, ProjectSummary, ProjectDetail, StatusInfo } from '~/utils/types';
import type { Generation, SceneConfig } from '~~/shared/types';
import { chromaConflict, keyConflict } from '~~/shared/scene-style';
import { paletteProblem } from '~~/shared/palette';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const projects = ref<ProjectSummary[]>([]);
const status = ref<StatusInfo | null>(null);
const projectId = ref(String(route.query.project ?? ''));
const project = ref<ProjectDetail['project'] | null>(null);
const projectAssets = ref<AssetView[]>([]);
const assetId = ref<string | null>(route.query.asset ? String(route.query.asset) : null);
const method = ref<'library' | 'ai'>(route.query.config ? 'ai' : 'library');
const count = ref(2);
const starting = ref(false);
const runs = ref<{ id: string; count: number }[]>([]);
const results = ref<HTMLElement | null>(null);
const adding = ref(false);

const config = ref<SceneConfig>({
  category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'medium',
  surfaceMethod: 'chroma', avoid: ['text', 'logos', 'people', 'watermark'], environment: 'workspace', angle: 'three-quarter', lighting: 'daylight', style: 'product',
});

const designs = computed(() => projectAssets.value.filter((a) => a.kind === 'design'));
const references = computed(() => projectAssets.value.filter((a) => a.kind === 'reference'));
const asset = computed(() => designs.value.find((a) => a.id === assetId.value) ?? null);
const maxCount = computed(() => Math.min(4, status.value?.provider.maxCount ?? 4));
const canGenerate = computed(() => !!projectId.value && !!status.value?.provider.configured);

onMounted(async () => {
  [projects.value, status.value] = await Promise.all([api<ProjectSummary[]>('/api/projects'), api<StatusInfo>('/api/status')]);
  if (!projectId.value && projects.value.length === 1) projectId.value = projects.value[0]!.id;
  // Vanuit Scènes: een gekozen scène gebruiken, of de instellingen van een gegenereerde scène hergebruiken.
  const sceneId = typeof route.query.scene === 'string' ? route.query.scene : typeof route.query.fromScene === 'string' ? route.query.fromScene : '';
  if (sceneId) {
    try {
      const sc = await api<SceneView>(`/api/scenes/${sceneId}`);
      if (route.query.fromScene) {
        // De kleuren komen van die scène (ook als die er geen had), niet uit wat al was ingevuld.
        if (sc.config) { config.value = { ...config.value, palette: undefined, ...sc.config, series: undefined }; method.value = 'ai'; }
        else toast.error('Deze scène heeft geen opgeslagen instellingen.');
      } else {
        chosenScene.value = sc;
      }
    } catch (e) { toast.error((e as Error).message); }
  }
  if (route.query.config) {
    try {
      const r = await api<{ generation: Generation }>(`/api/generations/${route.query.config}`);
      config.value = { ...r.generation.config };
      count.value = r.generation.count;
    } catch (e) {
      // Verwijderde configuratie: gewoon met de standaardinstellingen verder.
      toast.error((e as { status?: number }).status === 404 ? 'Deze configuratie bestaat niet meer. Je begint met de standaardinstellingen.' : (e as Error).message);
      router.replace({ query: { ...route.query, config: undefined } });
    }
  }
});

watch(projectId, async (id) => {
  if (!id) return;
  const d = await api<ProjectDetail>(`/api/projects/${id}`);
  project.value = d.project;
  projectAssets.value = d.assets;
  if (assetId.value && !d.assets.some((a) => a.id === assetId.value)) assetId.value = null;
  if (!assetId.value && designs.value.length) assetId.value = designs.value[0]!.id;
  router.replace({ query: { ...route.query, project: id } });
}, { immediate: true });
watch(assetId, (id) => router.replace({ query: { ...route.query, asset: id ?? undefined } }));

function onAdded(a: AssetView[]) {
  adding.value = false;
  projectAssets.value.unshift(...a);
  const d = a.find((x) => x.kind === 'design');
  if (d) assetId.value = d.id;
}

// Prompt en kosten live bijwerken.
const preview = ref<{ prompt: string; size: { width: number; height: number }; provider: StatusInfo['provider']; cost: { usd: number; exact: boolean } | null; credits: number; problem: string | null } | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch([config, count], () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try { preview.value = await api('/api/generations/preview', { method: 'POST', body: { config: config.value, count: count.value } }); } catch { /* wordt bij genereren gemeld */ }
  }, 250);
}, { deep: true, immediate: true });
const costText = computed(() => {
  const p = preview.value;
  if (!p) return '';
  if (!p.provider.isAi) return 'Gratis (testscènes)';
  if (p.cost === null) return 'Onbekend voor dit model, zie Instellingen';
  const amount = `$${p.cost.usd.toFixed(2).replace('.', ',')}`;
  const what = `${count.value} ${count.value === 1 ? 'beeld' : 'beelden'}`;
  const credits = status.value?.creditsEnforced ? `, ${p.credits} credits` : '';
  return p.cost.exact ? `${amount} voor ${what}${credits}` : `circa ${amount} voor ${what}${credits} (formaat buiten de prijstabel, geschat)`;
});

async function generate() {
  if (!canGenerate.value) return;
  starting.value = true;
  try {
    const base: SceneConfig = { ...config.value };
    // Een hergebruikte configuratie kan verwijzen naar een referentiebeeld dat inmiddels is verwijderd.
    const refs = (base.referenceAssetIds ?? []).filter((id) => references.value.some((r) => r.id === id));
    const cfg: SceneConfig = { ...base, referenceAssetIds: refs.length ? refs : undefined };
    const g = await api<Generation>('/api/generations', { method: 'POST', body: { projectId: projectId.value, assetId: assetId.value, config: cfg, count: count.value } });
    runs.value.unshift({ id: g.id, count: g.count });
    await nextTick();
    results.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    starting.value = false;
  }
}

// Een scène die vanuit de bibliotheek is gekozen (?scene=).
const chosenScene = ref<SceneView | null>(null);
function clearChosen() { chosenScene.value = null; router.replace({ query: { ...route.query, scene: undefined } }); }
const picker = ref<{ reload: () => Promise<void> } | null>(null);
/** Nieuwe scènes staan meteen in de bibliotheek; de kiezer op deze pagina laadt ze direct mee. */
function onGenerated() { void picker.value?.reload(); }

async function useScene(scene: SceneView) {
  if (!projectId.value) return toast.error('Kies eerst een project.');
  try {
    const m = await api<MockupView>('/api/mockups', { method: 'POST', body: { projectId: projectId.value, sceneId: scene.id, assetId: assetId.value } });
    await navigateTo(`/editor/${m.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<style scoped>
.step { display: grid; gap: 1.25rem; }
.chosen { display: flex; gap: 1rem; padding: 0.75rem; border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-white); max-width: 40rem; }
@media (min-width: 1024px) { .step { grid-template-columns: 9rem 1fr; gap: 2rem; } }
.step-title { display: flex; align-items: baseline; gap: 0.65rem; font-size: var(--text-lg); }
.num { display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; border: 1.5px solid var(--color-ink); font-size: var(--text-xs); font-weight: 600; transform: translateY(-2px); }
.step.done .num { background: var(--color-ink); color: var(--color-paper); }
.step.muted { opacity: 0.55; }
.step.muted:focus-within, .step.muted:hover { opacity: 1; }
.design { border-radius: var(--radius-sm); }
.design[aria-pressed='true'] > :first-child { outline: 2px solid var(--color-cyan); outline-offset: 2px; border-radius: var(--radius-sm); }
.design.add:hover span:first-child { border-color: var(--color-ink); color: var(--color-ink); }
.tick { position: absolute; top: 0.35rem; right: 0.35rem; display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: var(--color-cyan); color: white; }
</style>
