<template>
  <div>
    <h1 class="text-xl">E-mailadres bevestigen</h1>
    <p v-if="status === 'busy'" class="mt-4 text-sm text-graphite">Bezig met bevestigen…</p>
    <template v-else-if="status === 'ok'">
      <p class="notice mt-6">Je e-mailadres is bevestigd.</p>
      <NuxtLink to="/" class="btn btn-primary mt-6">Naar de studio</NuxtLink>
    </template>
    <p v-else class="notice notice-error mt-6" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
definePageMeta({ layout: 'auth' });
useHead({ title: 'E-mailadres bevestigen' });
const route = useRoute();
const { refresh } = useSession();
const status = ref<'busy' | 'ok' | 'error'>('busy');
const error = ref('');
onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  try {
    await api('/api/auth/verify', { method: 'POST', body: { token } });
    status.value = 'ok';
    refresh().catch(() => {});
  } catch (e) { status.value = 'error'; error.value = (e as Error).message; }
});
</script>
