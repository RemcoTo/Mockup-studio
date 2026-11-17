<template>
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
    <template v-if="id === 'devices'"><path d="M6 7h16v11H6z" /><path d="M3 21h22l-1.5-3h-19z" /></template>
    <template v-else-if="id === 'print'"><path d="M5 9l11-3 3 10-11 3z" /><path d="M10 6.5l10-1.5 3 10" /></template>
    <template v-else-if="id === 'apparel'"><path d="M10 5l-6 3 2 5 3-1v11h10V12l3 1 2-5-6-3c-1 2-2 3-4 3s-3-1-4-3z" /></template>
    <template v-else-if="id === 'signage'"><path d="M3 9h14v9H3z" /><path d="M17 12h4l3 3v3h-7" /><circle cx="7" cy="19.5" r="1.8" /><circle cx="20" cy="19.5" r="1.8" /></template>
    <template v-else><path d="M5 10l9-4 9 4v10l-9 4-9-4z" /><path d="M5 10l9 4 9-4M14 14v10" /></template>
  </svg>
</template>
<script setup lang="ts">
defineProps<{ id: string }>();
</script>
