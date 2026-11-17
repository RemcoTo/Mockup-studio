<template>
  <div class="grid min-h-dvh place-items-center px-4 py-12">
    <div class="w-full max-w-sm">
      <NuxtLink to="/" class="mb-10 flex items-center gap-2.5 text-[15px] font-semibold"><RegMark class="text-cyan" />{{ appName }}</NuxtLink>
      <slot />
    </div>
    <ToastHost />
  </div>
</template>
<script setup lang="ts">
import { useSession } from '~/composables/useSession';
const { state } = useSession();
const appName = computed(() => state.value?.site.appName ?? 'Mockup Studio');
</script>
