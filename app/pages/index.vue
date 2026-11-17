<template>
  <div>
    <PageHeader title="Start" />

    <div class="grid gap-14 px-5 py-8 sm:px-8 lg:px-10">
      <p v-if="status && !status.provider.configured" class="notice max-w-3xl">
        Nieuwe AI-scènes staan uit: {{ status.provider.problem }}
        Mockups op bibliotheekfoto’s, website-import en export werken gewoon.
        <NuxtLink to="/settings" class="underline underline-offset-2">Instellingen bekijken</NuxtLink>
      </p>

      <section v-if="steps && !steps.every((s) => s.done)" class="grid max-w-3xl gap-3">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-lg">Aan de slag</h2>
          <span class="tabular text-sm text-graphite">{{ steps.filter((s) => s.done).length }} van {{ steps.length }}</span>
        </div>
        <ol class="rule-list">
          <li v-for="(s, i) in steps" :key="s.label" class="flex items-center gap-4 py-3">
            <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs" :class="s.done ? 'border-ok bg-ok text-paper' : 'border-rule-strong text-graphite'">
              <Icon v-if="s.done" name="check" :size="13" /><template v-else>{{ i + 1 }}</template>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm" :class="s.done ? 'text-graphite line-through decoration-rule-strong' : 'font-medium'">{{ s.label }}</span>
              <span v-if="!s.done" class="block text-xs text-graphite">{{ s.hint }}</span>
            </span>
            <NuxtLink v-if="!s.done && s.to" :to="s.to" class="btn btn-secondary btn-sm">{{ s.action }}</NuxtLink>
          </li>
        </ol>
      </section>

      <section v-if="mockups.length">
        <h2 class="mb-5 text-lg">Recente mockups</h2>
        <div class="recent grid gap-5">
          <NuxtLink v-for="(m, i) in mockups" :key="m.id" :to="`/editor/${m.id}`" class="group grid content-start gap-2" :class="{ lead: i === 0 }">
            <div class="aspect-[3/2] overflow-hidden rounded-sm bg-paper">
              <img :src="m.previewUrl!" alt="Mockup" class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.012]" loading="lazy" />
            </div>
            <span class="text-xs text-graphite">{{ m.projectName }}, {{ timeAgo(m.updatedAt) }}</span>
          </NuxtLink>
        </div>
      </section>

      <section v-if="projects.length">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="text-lg">Projecten</h2>
          <NuxtLink to="/projects" class="text-sm text-graphite hover:text-ink">Alle projecten</NuxtLink>
        </div>
        <ul class="rule-list max-w-4xl">
          <li v-for="p in projects.slice(0, 6)" :key="p.id">
            <NuxtLink :to="`/projects/${p.id}`" class="flex items-center gap-4 py-3 hover:text-cyan">
              <Checker class="h-12 w-16 shrink-0 overflow-hidden rounded-sm">
                <img v-if="p.coverUrl" :src="p.coverUrl" alt="" class="h-full w-full" :class="p.coverIsMockup ? 'object-cover' : 'object-contain p-1'" loading="lazy" />
              </Checker>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ p.name }}</span>
                <span class="block truncate text-xs text-graphite">{{ [p.client, `${p.mockupCount} ${p.mockupCount === 1 ? 'mockup' : 'mockups'}`, timeAgo(p.updatedAt)].filter(Boolean).join(', ') }}</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="loaded && !mockups.length && !steps" class="max-w-xl">
        <h2 class="text-lg">{{ projects.length ? 'Maak je eerste mockup' : 'Begin met een project' }}</h2>
        <p class="mt-2 text-sm leading-relaxed text-graphite">
          {{ projects.length
            ? 'Kies een ontwerp uit een project en plaats het op een foto uit de bibliotheek of op een nieuwe AI-scène. Je ziet je ontwerp direct op elke foto staan.'
            : 'Een project bundelt de ontwerpen van één klant: websitescreenshots, logo’s en drukwerk. Daarna plaats je ze op bibliotheekfoto’s of op nieuwe scènes.' }}
        </p>
        <NuxtLink :to="projects.length ? '/generate' : '/projects/new'" class="btn btn-primary mt-5">{{ projects.length ? 'Nieuwe mockup' : 'Nieuw project' }}</NuxtLink>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { timeAgo, type MockupView, type ProjectSummary, type StatusInfo } from '~/utils/types';

const loaded = ref(false);
const projects = ref<(ProjectSummary & { coverIsMockup?: boolean })[]>([]);
const mockups = ref<(MockupView & { projectName: string })[]>([]);
const status = ref<StatusInfo | null>(null);
const onboarding = ref<{ design: boolean; mockup: boolean; exported: boolean; shared: boolean; verified: boolean; verificationRequired: boolean } | null>(null);
const steps = computed(() => {
  const o = onboarding.value;
  if (!o) return null;
  return [
    ...(!o.verificationRequired ? [] : [{ label: 'Bevestig je e-mailadres', hint: 'Nodig om collega’s uit te nodigen en AI-scènes te maken. Kijk in je inbox.', done: o.verified, to: '/settings?tab=account', action: 'Account' }]),
    { label: 'Voeg een eigen ontwerp toe', hint: 'Leg een website vast of upload een logo, poster of PDF.', done: o.design, to: '/projects/new', action: 'Nieuw project' },
    { label: 'Maak je eerste mockup', hint: 'Kies een foto uit de bibliotheek; je ontwerp staat er direct exact op.', done: o.mockup, to: '/generate', action: 'Mockup maken' },
    { label: 'Exporteer', hint: 'PNG of JPG op elk formaat, of een TIFF voor de drukker.', done: o.exported, to: null, action: '' },
    { label: 'Deel met je klant', hint: 'Selecteer mockups in een project en kies Delen met klant.', done: o.shared, to: '/projects', action: 'Projecten' },
  ];
});

onMounted(async () => {
  [projects.value, mockups.value, status.value] = await Promise.all([
    api<ProjectSummary[]>('/api/projects'),
    api<(MockupView & { projectName: string })[]>('/api/mockups'),
    api<StatusInfo>('/api/status').catch(() => null),
  ]);
  onboarding.value = await api<typeof onboarding.value>('/api/onboarding').catch(() => null);
  loaded.value = true;
});
</script>

<style scoped>
.recent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 1024px) {
  .recent { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .recent .lead { grid-column: span 2; grid-row: span 2; }
}
</style>
