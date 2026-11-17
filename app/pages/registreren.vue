<template>
  <div>
    <h1 class="text-xl">{{ invite ? `Word lid van ${invite.workspaceName}` : first ? 'Richt de studio in' : 'Account aanmaken' }}</h1>
    <p v-if="first" class="mt-2 text-sm text-graphite">Je bent de eerste gebruiker. Je wordt eigenaar van de werkruimte en beheerder van deze installatie.</p>
    <p v-else-if="invite" class="mt-2 text-sm text-graphite">{{ invite.invitedBy ? `${invite.invitedBy} heeft je uitgenodigd.` : 'Je bent uitgenodigd.' }} Je rol wordt {{ ROLE_LABELS[invite.role].toLowerCase() }}.</p>
    <p v-else-if="!signupOpen" class="notice mt-4">Registreren is op deze installatie alleen mogelijk met een uitnodiging.</p>
    <form v-if="signupOpen || invite" class="mt-6 grid gap-4" @submit.prevent="submit">
      <label class="field"><span>Naam</span><input v-model="name" class="input" autocomplete="name" required maxlength="120" autofocus /></label>
      <label class="field"><span>E-mailadres</span><input v-model="email" class="input" type="email" autocomplete="email" required :readonly="!!invite" /></label>
      <label class="field"><span>Wachtwoord</span><input v-model="password" class="input" type="password" autocomplete="new-password" required minlength="10" />
        <small class="text-xs text-graphite">Minimaal tien tekens. Een zin van een paar woorden werkt goed.</small>
      </label>
      <label v-if="!invite" class="field"><span>Naam van je bureau of bedrijf</span><input v-model="workspaceName" class="input" maxlength="120" autocomplete="organization" /></label>
      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Account aanmaken…' : 'Account aanmaken' }}</button>
    </form>
    <p class="mt-6 text-sm text-graphite"><NuxtLink :to="{ path: '/login', query: route.query }" class="hover:text-ink">Al een account? Inloggen</NuxtLink></p>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { ROLE_LABELS, type Role } from '~~/shared/roles';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Account aanmaken' });
const route = useRoute();
const { refresh, state } = useSession();
const name = ref(''), email = ref(''), password = ref(''), workspaceName = ref('');
const busy = ref(false), error = ref('');
const inviteToken = typeof route.query.uitnodiging === 'string' ? route.query.uitnodiging : '';
const invite = ref<{ email: string; role: Exclude<Role, 'owner'>; workspaceName: string; invitedBy: string | null } | null>(null);
const signupOpen = computed(() => state.value?.site.signupOpen ?? true);
const first = computed(() => state.value?.site.firstUser ?? false);
onMounted(async () => {
  await refresh().catch(() => {});
  if (inviteToken) {
    try {
      invite.value = await api(`/api/invitations/${inviteToken}`);
      email.value = invite.value!.email;
    } catch (e) { error.value = (e as Error).message; }
  }
});
async function submit() {
  busy.value = true; error.value = '';
  try {
    await api('/api/auth/signup', { method: 'POST', body: { name: name.value, email: email.value, password: password.value, workspaceName: workspaceName.value || undefined, inviteToken: inviteToken || undefined } });
    await refresh();
    await navigateTo(typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('//') ? route.query.next : '/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
