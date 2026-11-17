<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="pointer-events-auto max-w-lg rounded-md px-4 py-2.5 text-sm shadow-lg" :class="t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-paper'">
        {{ t.text }}
        <NuxtLink v-if="t.link" :to="t.link.to" class="ml-1 font-medium underline underline-offset-2">{{ t.link.label }}</NuxtLink>
      </div>
    </TransitionGroup>
  </div>
</template>
<script setup lang="ts">
import { useToast } from '~/composables/useToast';
const { toasts } = useToast();
</script>
<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 180ms, transform 180ms var(--ease-studio); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
</style>
