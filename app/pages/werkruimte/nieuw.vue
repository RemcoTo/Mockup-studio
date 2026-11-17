<template>
  <div>
    <h1 class="text-xl">Nieuwe werkruimte</h1>
    <p class="mt-2 text-sm text-graphite">Een werkruimte is van één bureau of bedrijf: projecten, bibliotheek, leden en credits zijn per werkruimte gescheiden.</p>
    <form class="mt-6 grid gap-4" @submit.prevent="submit">
      <label class="field"><span>Naam</span><input v-model="name" class="input" required maxlength="120" autofocus /></label>
      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Aanmaken…' : 'Werkruimte aanmaken' }}</button>
    </form>
    <p v-if="state?.workspace" class="mt-6 text-sm text-graphite"><NuxtLink to="/" class="hover:text-ink">Annuleren</NuxtLink></p>
    <p v-else class="mt-6 text-sm text-graphite"><button class="hover:text-ink" @click="logout">Uitloggen</button></p>
  </div>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Nieuwe werkruimte' });
const { state, refresh, logout } = useSession();
const name = ref(''), busy = ref(false), error = ref('');
async function submit() {
  busy.value = true; error.value = '';
  try { await api('/api/workspaces', { method: 'POST', body: { name: name.value } }); await refresh(); window.location.assign('/'); }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
