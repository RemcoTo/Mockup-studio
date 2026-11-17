<template>
  <div>
    <h1 class="text-xl">Inloggen</h1>
    <form class="mt-6 grid gap-4" @submit.prevent="submit">
      <label class="field"><span>E-mailadres</span><input v-model="email" class="input" type="email" autocomplete="email" required autofocus /></label>
      <label class="field"><span>Wachtwoord</span><input v-model="password" class="input" type="password" autocomplete="current-password" required /></label>
      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Inloggen…' : 'Inloggen' }}</button>
    </form>
    <div class="mt-6 grid gap-2 text-sm text-graphite">
      <NuxtLink to="/wachtwoord/vergeten" class="hover:text-ink">Wachtwoord vergeten</NuxtLink>
      <NuxtLink v-if="signupOpen" :to="{ path: '/registreren', query: route.query }" class="hover:text-ink">Nog geen account? Registreren</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Inloggen' });
const route = useRoute();
const { refresh, state } = useSession();
const email = ref(''), password = ref('');
const busy = ref(false), error = ref('');
const signupOpen = computed(() => state.value?.site.signupOpen ?? true);
onMounted(() => refresh().catch(() => {}));
const next = () => (typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('//') ? route.query.next : '/');
async function submit() {
  busy.value = true; error.value = '';
  try {
    await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
    await refresh();
    await navigateTo(next());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
