<template>
  <details class="section" :data-section="id" :open="isOpen" @toggle="onToggle">
    <summary class="summary">
      <span class="title">{{ title }}</span>
      <span v-if="meta" class="meta">{{ meta }}</span>
      <Icon name="chevron" :size="15" class="chev" />
    </summary>
    <div class="body"><slot /></div>
  </details>
</template>

<script setup lang="ts">
// Inklapbaar onderdeel van het eigenschappenpaneel. Open of dicht wordt per onderdeel onthouden.
const props = withDefaults(defineProps<{ id: string; title: string; meta?: string; open?: boolean }>(), { meta: '', open: true });
const key = `ms.section.${props.id}`;
const read = () => { try { const v = localStorage.getItem(key); return v === null ? props.open : v === '1'; } catch { return props.open; } };
const isOpen = ref(props.open);
onMounted(() => { isOpen.value = read(); });
function onToggle(e: Event) {
  isOpen.value = (e.target as HTMLDetailsElement).open;
  try { localStorage.setItem(key, isOpen.value ? '1' : '0'); } catch { /* geen opslag: alleen deze sessie */ }
}
</script>

<style scoped>
.section { border-bottom: 1px solid var(--color-rule); }
.summary { display: flex; align-items: center; gap: 0.6rem; padding: 0.95rem 1.25rem; cursor: pointer; list-style: none; user-select: none; }
.summary::-webkit-details-marker { display: none; }
.summary:hover .title { color: var(--color-ink); }
.title { font-size: var(--text-sm); font-weight: 600; }
.meta { margin-left: auto; font-size: var(--text-xs); color: var(--color-graphite); }
.chev { color: var(--color-graphite); transition: transform 140ms var(--ease-studio); }
.meta + .chev { margin-left: 0.25rem; }
.title + .chev { margin-left: auto; }
.section:not([open]) .chev { transform: rotate(-90deg); }
.body { display: grid; gap: 0.8rem; padding: 0 1.25rem 1.15rem; }
</style>
