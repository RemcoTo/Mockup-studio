<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="1.5" />
    <path d="M12 1.5v21M1.5 12h21" stroke="currentColor" stroke-width="1.5" />
  </svg>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 18 });
</script>
