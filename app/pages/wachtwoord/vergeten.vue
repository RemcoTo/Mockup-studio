<template>
  <div>
    <h1 class="text-xl">Wachtwoord vergeten</h1>
    <template v-if="!sent">
      <p class="mt-2 text-sm text-graphite">Vul je e-mailadres in. Je krijgt een link om een nieuw wachtwoord te kiezen.</p>
      <form class="mt-6 grid gap-4" @submit.prevent="submit">
        <label class="field"><span>E-mailadres</span><input v-model="email" class="input" type="email" autocomplete="email" required autofocus /></label>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Versturen…' : 'Herstellink versturen' }}</button>
      </form>
    </template>
    <p v-else class="notice mt-6">Als er een account bij {{ email }} hoort, staat er binnen een paar minuten een e-mail met een herstellink in je inbox. De link is een uur geldig.</p>
    <p class="mt-6 text-sm text-graphite"><NuxtLink to="/login" class="hover:text-ink">Terug naar inloggen</NuxtLink></p>
  </div>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Wachtwoord vergeten' });
const email = ref(''), busy = ref(false), sent = ref(false), error = ref('');
async function submit() {
  busy.value = true; error.value = '';
  try { await api('/api/auth/forgot', { method: 'POST', body: { email: email.value } }); sent.value = true; }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
