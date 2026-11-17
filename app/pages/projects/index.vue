<template>
  <div>
    <PageHeader title="Projecten">
      <template #actions>
        <input v-model="q" class="input w-56" type="search" placeholder="Zoeken op naam of klant" aria-label="Projecten zoeken" />
        <NuxtLink to="/projects/new" class="btn btn-primary"><Icon name="plus" />Nieuw project</NuxtLink>
      </template>
    </PageHeader>

    <div class="px-5 py-6 sm:px-8 lg:px-10">
      <p v-if="loaded && !filtered.length" class="py-10 text-sm text-graphite">{{ q ? 'Geen projecten gevonden voor deze zoekterm.' : 'Nog geen projecten. Maak er een aan om ontwerpen te uploaden.' }}</p>
      <ul class="rule-list">
        <li v-for="p in filtered" :key="p.id" class="flex items-center gap-4 py-3">
          <NuxtLink :to="`/projects/${p.id}`" class="flex min-w-0 flex-1 items-center gap-4">
            <div class="h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-paper">
              <img v-if="p.coverUrl" :src="p.coverUrl" alt="" class="h-full w-full object-cover" loading="lazy" />
            </div>
            <div class="min-w-0">
              <template v-if="renaming === p.id">
                <input v-model="draft" class="input h-8 w-72" autofocus @click.prevent @keydown.enter.prevent="saveName(p)" @keydown.esc="renaming = null" @blur="saveName(p)" />
              </template>
              <div v-else class="truncate font-medium">{{ p.name }}</div>
              <div class="truncate text-xs text-graphite">{{ [p.client, `${p.mockupCount} ${p.mockupCount === 1 ? 'mockup' : 'mockups'}`, `aangemaakt ${dateNl(p.createdAt)}`].filter(Boolean).join(', ') }}</div>
            </div>
          </NuxtLink>
          <div class="flex shrink-0 items-center">
            <button class="btn btn-quiet btn-sm" @click="startRename(p)"><Icon name="pencil" :size="14" /><span class="hidden sm:inline">Hernoemen</span></button>
            <button class="btn btn-quiet btn-sm" @click="duplicate(p)"><Icon name="copy" :size="14" /><span class="hidden sm:inline">Dupliceren</span></button>
            <button class="btn btn-danger btn-sm" @click="remove(p)"><Icon name="trash" :size="14" /><span class="hidden sm:inline">Verwijderen</span></button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import { dateNl, type ProjectSummary } from '~/utils/types';
const toast = useToast();
const list = ref<ProjectSummary[]>([]);
const loaded = ref(false);
const q = ref('');
const renaming = ref<string | null>(null);
const draft = ref('');
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? list.value.filter((p) => `${p.name} ${p.client}`.toLowerCase().includes(s)) : list.value;
});
async function load() { list.value = await api('/api/projects'); loaded.value = true; }
onMounted(load);
function startRename(p: ProjectSummary) { renaming.value = p.id; draft.value = p.name; }
async function saveName(p: ProjectSummary) {
  if (renaming.value !== p.id) return;
  renaming.value = null;
  if (!draft.value.trim() || draft.value === p.name) return;
  try { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: draft.value } }); p.name = draft.value.trim(); toast.info('Project hernoemd.'); }
  catch (e) { toast.error((e as Error).message); }
}
async function duplicate(p: ProjectSummary) {
  try { await api(`/api/projects/${p.id}/duplicate`, { method: 'POST' }); await load(); toast.info(`${p.name} gedupliceerd.`); }
  catch (e) { toast.error((e as Error).message); }
}
async function remove(p: ProjectSummary) {
  if (!confirm(`"${p.name}" verwijderen? Alle ontwerpen, scènes, mockups en exports van dit project worden definitief verwijderd.`)) return;
  try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); list.value = list.value.filter((x) => x.id !== p.id); toast.info('Project verwijderd.'); }
  catch (e) { toast.error((e as Error).message); }
}
</script>
