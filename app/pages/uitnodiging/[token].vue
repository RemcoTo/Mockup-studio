<template>
  <div>
    <template v-if="invite">
      <h1 class="text-xl">Uitnodiging voor {{ invite.workspaceName }}</h1>
      <p class="mt-2 text-sm text-graphite">{{ invite.invitedBy ? `${invite.invitedBy} nodigt je uit` : 'Je bent uitgenodigd' }} als {{ ROLE_LABELS[invite.role].toLowerCase() }}. De uitnodiging is voor {{ invite.email }}.</p>
      <div class="mt-6 grid gap-2">
        <template v-if="user">
          <p v-if="user.email.toLowerCase() !== invite.email.toLowerCase()" class="notice notice-error">Je bent ingelogd als {{ user.email }}. Log uit en log in met {{ invite.email }}.</p>
          <button v-else class="btn btn-primary" :disabled="busy" @click="accept">{{ busy ? 'Bezig…' : 'Uitnodiging accepteren' }}</button>
        </template>
        <template v-else-if="invite.hasAccount">
          <NuxtLink :to="{ path: '/login', query: { next: route.fullPath } }" class="btn btn-primary">Inloggen om te accepteren</NuxtLink>
        </template>
        <template v-else>
          <NuxtLink :to="{ path: '/registreren', query: { uitnodiging: token } }" class="btn btn-primary">Account aanmaken</NuxtLink>
        </template>
      </div>
    </template>
    <p v-if="error" class="notice notice-error mt-6" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { ROLE_LABELS, type Role } from '~~/shared/roles';
definePageMeta({ layout: 'auth' });
useHead({ title: 'Uitnodiging' });
const route = useRoute();
const token = String(route.params.token);
const { refresh, state } = useSession();
const invite = ref<{ email: string; role: Exclude<Role, 'owner'>; workspaceName: string; invitedBy: string | null; hasAccount: boolean } | null>(null);
const error = ref(''), busy = ref(false);
const user = computed(() => state.value?.user ?? null);
onMounted(async () => {
  await refresh().catch(() => {});
  try { invite.value = await api(`/api/invitations/${token}`); } catch (e) { error.value = (e as Error).message; }
});
async function accept() {
  busy.value = true; error.value = '';
  try { await api(`/api/invitations/${token}/accept`, { method: 'POST' }); await refresh(); window.location.assign('/'); }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
