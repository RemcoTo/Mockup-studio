<template>
  <nav class="flex h-full flex-col gap-8 px-5 py-6" aria-label="Hoofdnavigatie">
    <NuxtLink to="/" class="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]" @click="$emit('navigate')">
      <RegMark :size="18" class="text-cyan" />
      Mockup Studio
    </NuxtLink>

    <!-- Eén hoofdactie: van ontwerp naar mockup. Al het andere is navigatie. -->
    <NuxtLink to="/generate" class="btn btn-primary justify-start" @click="$emit('navigate')">
      <Icon name="plus" /> Nieuwe mockup
    </NuxtLink>

    <ul class="grid gap-0.5 text-sm">
      <li v-for="item in items" :key="item.to">
        <NuxtLink :to="item.to" class="nav-link" :class="{ 'is-active': isActive(item.to) }" @click="$emit('navigate')">
          <Icon :name="item.icon" class="text-graphite" />{{ item.label }}<span v-if="item.to === '/shoot' && session?.workspace && !has('brandShoot')" class="plan-tag">Studio</span>
        </NuxtLink>
      </li>
    </ul>

    <div class="mt-auto grid gap-3 text-sm">
      <NuxtLink v-if="session?.user?.isAdmin" to="/beheer" class="nav-link" :class="{ 'is-active': isActive('/beheer') }" @click="$emit('navigate')">
        <Icon name="grid" class="text-graphite" />Platformbeheer
      </NuxtLink>
      <NuxtLink v-if="session?.site.creditsEnforced" to="/abonnement" class="nav-link" :class="{ 'is-active': isActive('/abonnement') }" @click="$emit('navigate')">
        <Icon name="star" class="text-graphite" />Abonnement
      </NuxtLink>
      <NuxtLink to="/settings" class="nav-link" :class="{ 'is-active': isActive('/settings') }" @click="$emit('navigate')">
        <Icon name="settings" class="text-graphite" />Instellingen
      </NuxtLink>
      <div v-if="session" class="grid gap-1 border-t border-rule pt-3">
        <label class="sr-only" for="ws-switch">Werkruimte</label>
        <select v-if="session.workspaces.length > 1" id="ws-switch" class="input h-9" :value="session.workspace?.id" @change="onSwitch">
          <option v-for="w in session.workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
          <option value="__new">Nieuwe werkruimte…</option>
        </select>
        <div v-else class="truncate px-0.5 font-medium">{{ session.workspace?.name }}</div>
        <div class="flex items-center justify-between gap-2 px-0.5 text-xs text-graphite">
          <span class="truncate">{{ session.user?.name }}</span>
          <button class="shrink-0 hover:text-ink" @click="logout">Uitloggen</button>
        </div>
        <NuxtLink v-if="session.site.creditsEnforced && session.workspace" to="/abonnement" class="px-0.5 text-xs text-graphite hover:text-ink" @click="$emit('navigate')">{{ session.workspace.credits }} credits</NuxtLink>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useSession } from '~/composables/useSession';
defineEmits<{ navigate: [] }>();
const route = useRoute();
const { state: session, logout, switchWorkspace, has } = useSession();
function onSwitch(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (v === '__new') navigateTo('/werkruimte/nieuw');
  else if (v !== session.value?.workspace?.id) switchWorkspace(v);
}
const items = [
  { to: '/', label: 'Start', icon: 'home' },
  { to: '/projects', label: 'Projecten', icon: 'folder' },
  { to: '/uploads', label: 'Ontwerpen', icon: 'upload' },
  { to: '/library', label: 'Scènes', icon: 'grid' },
  { to: '/shoot', label: 'Brand shoot', icon: 'image' },
];
function isActive(to: string) {
  if (to === '/') return route.path === '/';
  if (to === '/projects') return route.path === '/projects' || (route.path.startsWith('/projects/') && route.path !== '/projects/new');
  return route.path.startsWith(to);
}
</script>

<style scoped>
.nav-link { display: flex; align-items: center; gap: 0.7rem; height: 2.25rem; padding: 0 0.6rem; border-radius: var(--radius-md); color: var(--color-ink); }
.nav-link:hover { background: rgb(0 0 0 / 0.045); }
.nav-link.is-active { background: var(--color-white); box-shadow: inset 2px 0 0 var(--color-cyan); }
</style>
