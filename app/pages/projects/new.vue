<template>
  <div>
    <PageHeader title="Nieuw project" lead="Een project bevat de ontwerpen, scènes en mockups van één klant of opdracht." :back="{ to: '/projects', label: 'Projecten' }" />
    <form class="grid max-w-xl gap-5 px-5 py-8 sm:px-8 lg:px-10" @submit.prevent="create">
      <label class="field"><span>Projectnaam</span><input v-model="name" class="input" required maxlength="120" placeholder="Bijvoorbeeld: Rebranding 2027" autofocus /></label>
      <label class="field"><span>Klant of bedrijf</span><input v-model="client" class="input" maxlength="120" /></label>
      <label class="field"><span>Website-URL (optioneel)</span><input v-model="url" class="input" maxlength="500" inputmode="url" placeholder="voorbeeld.nl" /></label>
      <p v-if="error" class="notice notice-error">{{ error }}</p>
      <div class="flex gap-2 pt-2">
        <button class="btn btn-primary" :disabled="busy || !name.trim()">{{ busy ? 'Aanmaken…' : 'Project aanmaken' }}</button>
        <NuxtLink to="/projects" class="btn btn-quiet">Annuleren</NuxtLink>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import type { Project } from '~~/shared/types';
const name = ref(''), client = ref(''), url = ref('');
const busy = ref(false), error = ref('');
async function create() {
  busy.value = true; error.value = '';
  try {
    const p = await api<Project>('/api/projects', { method: 'POST', body: { name: name.value, client: client.value, url: url.value } });
    await navigateTo(`/projects/${p.id}?import=${url.value ? 'url' : 'upload'}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
