<template>
  <header class="flex flex-wrap items-end justify-between gap-4 border-b border-rule px-5 pb-5 pt-7 sm:px-8 lg:px-10 lg:pt-9">
    <div class="min-w-0 max-w-3xl">
      <NuxtLink v-if="back" :to="back.to" class="mb-3 inline-flex items-center gap-1.5 text-xs text-graphite hover:text-ink"><Icon name="back" :size="14" />{{ back.label }}</NuxtLink>
      <h1 class="text-xl sm:text-2xl">{{ title }}</h1>
      <p v-if="lead" class="mt-2 text-sm text-graphite">{{ lead }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
  </header>
</template>
<script setup lang="ts">
defineProps<{ title: string; lead?: string; back?: { to: string; label: string } }>();
</script>
