<template>
  <div>
    <PageHeader title="Ontwerpen" lead="Alle ontwerpen en websitescreenshots uit je projecten. Originelen blijven altijd ongewijzigd bewaard.">
      <template #actions>
        <select v-model="project" class="input w-56" aria-label="Project"><option value="">Alle projecten</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        <div class="segmented"><button :aria-pressed="kind === 'design'" @click="kind = 'design'">Ontwerpen</button><button :aria-pressed="kind === 'reference'" @click="kind = 'reference'">Referenties</button></div>
      </template>
    </PageHeader>
    <div class="px-5 py-7 sm:px-8 lg:px-10">
      <p v-if="loaded && !list.length" class="text-sm text-graphite">Nog geen bestanden. Upload ze in een project.</p>
      <div class="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
        <AssetTile v-for="a in list" :key="a.id" :asset="a">
          <NuxtLink v-if="a.kind === 'design'" :to="`/generate?project=${a.projectId}&asset=${a.id}`" class="btn btn-secondary btn-sm">Mockup maken</NuxtLink>
          <a :href="a.originalUrl" class="btn btn-quiet btn-sm" title="Origineel downloaden"><Icon name="download" :size="14" /></a>
          <a v-if="a.meta.finalUrl" :href="String(a.meta.finalUrl)" target="_blank" rel="noopener noreferrer" class="btn btn-quiet btn-sm" title="Website openen"><Icon name="globe" :size="14" /></a>
        </AssetTile>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import type { AssetView, ProjectSummary } from '~/utils/types';
const projects = ref<ProjectSummary[]>([]);
const all = ref<AssetView[]>([]);
const loaded = ref(false);
const project = ref('');
const kind = ref<'design' | 'reference'>('design');
const list = computed(() => all.value.filter((a) => a.kind === kind.value && (!project.value || a.projectId === project.value)));
onMounted(async () => {
  [projects.value, all.value] = await Promise.all([api<ProjectSummary[]>('/api/projects'), api<AssetView[]>('/api/assets')]);
  loaded.value = true;
});
</script>
