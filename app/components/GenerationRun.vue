<template>
  <section class="grid gap-5">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h3 class="text-base">{{ heading }}</h3>
      <span v-if="gen" class="text-xs text-graphite">{{ gen.provider === 'demo' ? 'Testscènes, geen AI' : `${gen.model}` }}, {{ gen.count }} {{ gen.count === 1 ? 'variant' : 'varianten' }}</span>
    </div>

    <div v-if="!gen || gen.status === 'queued' || gen.status === 'running'" class="grid gap-5">
      <!-- Waar de generatie is: wachtrij, het model maakt de scène, de vlakken worden gezocht en het ontwerp geplaatst. -->
      <ol class="phases" aria-label="Voortgang">
        <li v-for="(ph, i) in phases" :key="ph" :class="{ done: i < phase, now: i === phase }">
          <span class="dot"><span v-if="i === phase" class="spinner" /><Icon v-else-if="i < phase" name="check" :size="11" /></span>{{ ph }}
        </li>
      </ol>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <template v-for="n in count" :key="n">
          <MockupTile v-if="mockups[n - 1]" class="develop" :mockup="mockups[n - 1]!" :selectable="false" :removable="false" @favorite="favorite(mockups[n - 1]!)" />
          <div v-else class="pending aspect-[3/2] rounded-sm" />
        </template>
      </div>
      <p class="text-sm text-graphite"><span class="tabular">{{ elapsed }} s</span>. {{ phaseNote }}</p>
    </div>

    <div v-else-if="gen.status === 'failed'" class="notice notice-error grid gap-2">
      <span>{{ gen.error }}</span>
      <span class="text-xs">Er is niets gegenereerd of opgeslagen.</span>
      <button class="btn btn-secondary btn-sm justify-self-start" @click="$emit('retry')">Opnieuw proberen</button>
    </div>

    <template v-else>
      <p v-if="gen.error" class="notice text-sm">{{ gen.error }}</p>
      <p class="saved text-sm" role="status"><Icon name="check" :size="14" />{{ savedNote }} <NuxtLink to="/library" class="underline underline-offset-2">Naar Scènes</NuxtLink></p>
      <div class="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="m in mockups" :key="m.id" class="grid gap-2">
          <MockupTile class="develop" :mockup="m" :selected="selected.has(m.id)" :removable="false" @toggle="toggle(m.id)" @favorite="favorite(m)" />
          <p v-if="!sceneOf(m)?.surfaces.length" class="text-xs text-danger">Geen ontwerpvlak gevonden. Open de scène en wijs de hoeken zelf aan.
            <NuxtLink :to="`/library/${m.sceneId}?back=/editor/${m.id}`" class="underline underline-offset-2">Hoeken aanwijzen</NuxtLink>
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn btn-secondary btn-sm" :disabled="!selected.size || zipping" @click="zip"><Icon name="download" :size="14" />{{ zipping ? 'Exporteren…' : selected.size ? `${selected.size} downloaden als zip` : 'Selecteer varianten om te downloaden' }}</button>
        <button class="btn btn-quiet btn-sm" @click="$emit('again')">Nog een reeks met deze instellingen</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { api, downloadPost } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { SceneView, MockupView } from '~/utils/types';
import type { Generation } from '~~/shared/types';

const props = defineProps<{ generationId: string; count: number; projectName: string; title?: string }>();
const emit = defineEmits<{ retry: []; again: []; done: [sceneIds: string[]] }>();
const toast = useToast();
const gen = ref<Generation | null>(null);
const mockups = ref<MockupView[]>([]);
const scenes = ref<SceneView[]>([]);
const selected = ref(new Set<string>());
const zipping = ref(false);
const started = Date.now();
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

const heading = computed(() => props.title ?? (gen.value?.status === 'done' ? 'Varianten' : gen.value?.status === 'failed' ? 'Generatie mislukt' : 'Bezig met genereren'));
const savedNote = computed(() => {
  const n = scenes.value.length;
  return n === 1 ? 'De scène staat in de bibliotheek onder Scènes; je kunt hem opnieuw gebruiken voor elk ontwerp.' : `De ${n} scènes staan in de bibliotheek onder Scènes; je kunt ze opnieuw gebruiken voor elk ontwerp.`;
});
const sceneOf = (m: MockupView) => scenes.value.find((s) => s.id === m.sceneId);
const isAi = computed(() => !!gen.value && gen.value.provider !== 'demo');
const phases = computed(() => ['In de wachtrij', isAi.value ? 'Het model maakt de scène' : 'Testscène tekenen', 'Vlakken zoeken en ontwerp plaatsen']);
const phase = computed(() => (!gen.value || gen.value.status === 'queued' ? 0 : (gen.value.sceneIds?.length ?? 0) > 0 ? 2 : 1));
const phaseNote = computed(() => {
  if (phase.value === 0) return 'Er draait nog een andere taak; deze start zodra die klaar is.';
  if (phase.value === 1) return isAi.value ? 'Een AI-scène duurt meestal tussen de twintig seconden en twee minuten. Je kunt deze pagina open laten of later terugkomen in het project.' : 'Testscènes zijn binnen een paar seconden klaar.';
  return `${mockups.value.length} van ${props.count} klaar.`;
});

async function poll() {
  elapsed.value = Math.round((Date.now() - started) / 1000);
  try {
    const r = await api<{ generation: Generation; mockups: MockupView[]; scenes: SceneView[] }>(`/api/generations/${props.generationId}`);
    gen.value = r.generation;
    // Tussenresultaten tonen zodra ze er zijn.
    mockups.value = r.mockups;
    scenes.value = r.scenes;
    if (r.generation.status === 'done' || r.generation.status === 'failed') {
      clearInterval(timer);
      if (r.generation.status === 'done') emit('done', r.generation.sceneIds);
    }
  } catch (e) {
    toast.error((e as Error).message);
    clearInterval(timer);
  }
}
onMounted(() => { poll(); timer = setInterval(poll, 1500); });
onBeforeUnmount(() => clearInterval(timer));

function toggle(id: string) { const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); selected.value = s; }
async function favorite(m: MockupView) {
  try { await api(`/api/mockups/${m.id}`, { method: 'PATCH', body: { favorite: !m.favorite } }); m.favorite = !m.favorite; } catch (e) { toast.error((e as Error).message); }
}
async function zip() {
  zipping.value = true;
  try { await downloadPost('/api/exports/zip', { mockupIds: [...selected.value], format: 'png', quality: 92 }, `${props.projectName}-varianten.zip`); }
  catch (e) { toast.error((e as Error).message); }
  finally { zipping.value = false; }
}
</script>

<style scoped>
.saved { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; color: var(--color-graphite); }
.saved :deep(svg) { color: var(--color-ok); }
.phases { display: flex; flex-wrap: wrap; gap: 0.4rem 1.25rem; font-size: var(--text-sm); color: var(--color-mist); }
.phases li { display: inline-flex; align-items: center; gap: 0.5rem; }
.phases li.now { color: var(--color-ink); font-weight: 520; }
.phases li.done { color: var(--color-graphite); }
.dot { display: inline-grid; place-items: center; width: 1.15rem; height: 1.15rem; border-radius: 50%; border: 1px solid currentColor; }
.phases li.now .dot { border: 0; }
.phases li.done .dot { background: var(--color-ok); border-color: var(--color-ok); color: white; }
.pending { background: linear-gradient(100deg, var(--color-paper) 30%, #ececea 50%, var(--color-paper) 70%); background-size: 300% 100%; animation: sheen 1.6s linear infinite; }
@keyframes sheen { from { background-position: 100% 0; } to { background-position: 0 0; } }
</style>
