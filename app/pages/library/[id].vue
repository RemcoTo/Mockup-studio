<template>
  <div v-if="scene">
    <PageHeader :title="scene.title" :lead="scene.license" :back="{ to: backTo, label: backLabel }">
      <template #actions>
        <NuxtLink v-if="scene.config" :to="`/generate?fromScene=${scene.id}`" class="btn btn-quiet"><Icon name="spark" />Nieuwe scène met deze instellingen</NuxtLink>
        <NuxtLink v-if="scene.surfaces.length" :to="`/generate?scene=${scene.id}`" class="btn btn-secondary"><Icon name="image" />Gebruiken voor een mockup</NuxtLink>
        <button class="btn btn-danger" @click="remove"><Icon name="trash" />Verwijderen</button>
      </template>
    </PageHeader>
    <div class="grid gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[1fr_320px] lg:px-10">
      <div>
        <SurfaceMarker v-model="surfaces" :scene="scene" :selected="selected" @select="(i) => (selected = i)" />
        <p class="mt-3 text-xs text-graphite">Sleep de registertekens naar de hoeken van het vlak waar het ontwerp op komt. De dikke lijn is de bovenkant van het ontwerp; draai hem zo nodig met 90°.</p>
      </div>
      <aside class="grid content-start gap-6">
        <section class="grid gap-3">
          <h2 class="text-base">Ontwerpvlakken</h2>
          <p v-if="!surfaces.length" class="text-sm text-graphite">Nog geen vlak. Voeg er een toe en zet de hoeken op hun plek.</p>
          <ul class="rule-list">
            <li v-for="(s, i) in surfaces" :key="s.id ?? i" class="grid gap-2 py-3" :class="{ 'is-sel': i === selected }" @click="selected = i">
              <div class="flex items-center gap-2">
                <input v-model="s.label" class="input h-8 flex-1" maxlength="60" aria-label="Naam van het vlak" />
                <button class="btn btn-danger btn-sm" aria-label="Vlak verwijderen" @click.stop="surfaces.splice(i, 1)"><Icon name="trash" :size="14" /></button>
              </div>
              <div class="flex items-center gap-2">
                <select v-model="s.kind" class="input h-8" aria-label="Soort oppervlak">
                  <option value="screen">Scherm</option><option value="paper">Papier en karton</option><option value="fabric">Textiel</option><option value="rigid">Hard oppervlak</option>
                </select>
                <button class="btn btn-quiet btn-sm" title="Draai de bovenkant van het ontwerp een kwartslag" @click.stop="rotate(i)"><Icon name="rotate" :size="14" />90°</button>
              </div>
              <span class="text-xs text-graphite">{{ s.detection === 'chroma' ? 'Automatisch gevonden, met masker en schaduwkaart' : s.detection === '3d' ? 'Uit het 3D-model, met exact masker' : 'Handmatig, schaduwkaart uit de foto' }}</span>
            </li>
          </ul>
          <button class="btn btn-secondary btn-sm justify-self-start" @click="addSurface"><Icon name="plus" :size="14" />Vlak toevoegen</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveSurfaces">{{ saving ? 'Opslaan…' : 'Vlakken opslaan' }}</button>
        </section>

        <section class="grid gap-3 border-t border-rule pt-6">
          <h2 class="text-base">Gegevens</h2>
          <label class="field"><span>Titel</span><input v-model="meta.title" class="input" maxlength="120" /></label>
          <label class="field"><span>Bron of licentie</span><input v-model="meta.license" class="input" maxlength="300" /></label>
          <label class="field"><span>Materiaal</span><input v-model="meta.material" class="input" maxlength="60" /></label>
          <label class="field"><span>Kleur</span><input v-model="meta.color" class="input" maxlength="60" /></label>
          <label class="flex items-center gap-2 text-sm"><input v-model="meta.inLibrary" type="checkbox" class="check" />In de bibliotheek tonen</label>
          <button class="btn btn-secondary btn-sm justify-self-start" @click="saveMeta">Gegevens opslaan</button>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { SceneView } from '~/utils/types';
import { rotateQuad, type Quad } from '~~/shared/geometry';
import type { SurfaceKind } from '~~/shared/types';
import type { EditableSurface } from '~/components/SurfaceMarker.vue';

const route = useRoute();
const toast = useToast();
const scene = ref<SceneView | null>(null);
const surfaces = ref<EditableSurface[]>([]);
const selected = ref(0);
const saving = ref(false);
const meta = reactive({ title: '', license: '', material: '', color: '', inLibrary: false });
const backTo = computed(() => (typeof route.query.back === 'string' && route.query.back.startsWith('/') ? route.query.back : scene.value?.projectId && !scene.value.inLibrary ? `/projects/${scene.value.projectId}?tab=scenes` : '/library'));
const backLabel = computed(() => (backTo.value.startsWith('/editor') ? 'Terug naar de editor' : backTo.value.startsWith('/projects') ? 'Terug naar het project' : 'Scènes'));

function apply(s: SceneView) {
  scene.value = s;
  surfaces.value = s.surfaces.map((x) => ({ id: x.id, label: x.label, kind: x.kind, quad: x.quad.map((p) => [...p]) as Quad, detection: x.detection }));
  Object.assign(meta, { title: s.title, license: s.license, material: s.tags.material ?? '', color: s.tags.color ?? '', inLibrary: s.inLibrary });
}
onMounted(async () => { try { apply(await api<SceneView>(`/api/scenes/${route.params.id}`)); } catch (e) { toast.error((e as Error).message); } });

function addSurface() {
  const w = scene.value!.width, h = scene.value!.height;
  const kind: SurfaceKind = 'paper';
  surfaces.value.push({ label: `Vlak ${surfaces.value.length + 1}`, kind, quad: [[w * 0.35, h * 0.35], [w * 0.65, h * 0.35], [w * 0.65, h * 0.65], [w * 0.35, h * 0.65]], detection: 'manual' });
  selected.value = surfaces.value.length - 1;
}
function rotate(i: number) { surfaces.value[i]!.quad = rotateQuad(surfaces.value[i]!.quad, 1); }
async function saveSurfaces() {
  saving.value = true;
  try {
    apply(await api<SceneView>(`/api/scenes/${scene.value!.id}/surfaces`, { method: 'PUT', body: { surfaces: surfaces.value.map(({ id, label, kind, quad }) => ({ id, label, kind, quad })) } }));
    toast.info('Vlakken opgeslagen.');
    if (backTo.value.startsWith('/editor')) await navigateTo(backTo.value);
  } catch (e) { toast.error((e as Error).message); }
  finally { saving.value = false; }
}
async function saveMeta() {
  try {
    apply(await api<SceneView>(`/api/scenes/${scene.value!.id}`, { method: 'PATCH', body: { title: meta.title, license: meta.license, inLibrary: meta.inLibrary, tags: { material: meta.material || undefined, color: meta.color || undefined } } }));
    toast.info('Gegevens opgeslagen.');
  } catch (e) { toast.error((e as Error).message); }
}
async function remove() {
  if (!confirm('Deze scène verwijderen? Mockups die deze scène gebruiken worden ook verwijderd.')) return;
  try { await api(`/api/scenes/${scene.value!.id}`, { method: 'DELETE' }); await navigateTo('/library'); } catch (e) { toast.error((e as Error).message); }
}
</script>

<style scoped>
.is-sel { box-shadow: inset 2px 0 0 var(--color-cyan); padding-left: 0.6rem; }
</style>
