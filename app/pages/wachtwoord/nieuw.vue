<template>
  <div>
    <h1 class="text-xl">Nieuw wachtwoord kiezen</h1>
    <form class="mt-6 grid gap-4" @submit.prevent="submit">
      <label class="field"><span>Nieuw wachtwoord</span><input v-model="password" class="input" type="password" autocomplete="new-password" required minlength="10" autofocus />
        <small class="text-xs text-graphite">Minimaal tien tekens. Je wordt op andere apparaten uitgelogd.</small>
      </label>
      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" :disabled="busy || !token">{{ busy ? 'Opslaan…' : 'Wachtwoord opslaan' }}</button>
    </form>
  </div>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Nieuw wachtwoord' });
const route = useRoute();
const { refresh } = useSession();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const password = ref(''), busy = ref(false), error = ref(token ? '' : 'Deze link is onvolledig. Open de link uit de e-mail opnieuw.');
async function submit() {
  busy.value = true; error.value = '';
  try {
    await api('/api/auth/reset', { method: 'POST', body: { token, password: password.value } });
    await refresh();
    useToast().info('Je nieuwe wachtwoord is opgeslagen.');
    await navigateTo('/');
  } catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
