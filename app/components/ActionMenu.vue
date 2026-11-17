<template>
  <div ref="root" class="relative inline-flex">
    <button type="button" class="btn btn-quiet btn-sm px-2" :aria-label="label" :aria-expanded="open" aria-haspopup="menu" @click="open = !open"><Icon name="more" :size="18" /></button>
    <Transition name="pop">
      <div v-if="open" class="menu" :class="align === 'right' ? 'right-0' : 'left-0'" style="top: calc(100% + 4px)" role="menu" @click="open = false"><slot /></div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// Overloopmenu voor minder gebruikte acties op een kaart, zodat de kaart zelf rustig blijft.
withDefaults(defineProps<{ label?: string; align?: 'left' | 'right' }>(), { label: 'Meer acties', align: 'right' });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
function onDoc(e: Event) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false; }
onMounted(() => { document.addEventListener('pointerdown', onDoc); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); });
</script>

<style scoped>
.pop-enter-active, .pop-leave-active { transition: opacity 120ms, transform 120ms var(--ease-studio); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-3px); }
</style>
