<template>
  <div class="grid gap-1.5" :class="{ off: disabled }">
    <div class="flex items-center justify-between gap-2 text-sm">
      <span :id="id">{{ label }}</span>
      <span class="num">
        <input type="number" inputmode="decimal" :aria-label="`${label}, exacte waarde`" :min="min" :max="max" :step="step" :value="shown" :disabled="disabled"
          @change="onNumber" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        <span v-if="unit" class="unit" aria-hidden="true">{{ unit }}</span>
      </span>
    </div>
    <input type="range" class="range" :aria-labelledby="id" :min="min" :max="max" :step="step" :value="modelValue ?? min" :disabled="disabled"
      @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" @change="$emit('commit')" />
  </div>
</template>

<script setup lang="ts">
// Schuifregelaar met een getalveld ernaast: grof schuiven of een exacte waarde typen. Enter of verlaten van het veld
// legt de waarde vast (binnen de grenzen).
const props = withDefaults(defineProps<{ label: string; modelValue: number | null; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean }>(), { min: 0, max: 100, step: 1, unit: '', disabled: false });
const emit = defineEmits<{ 'update:modelValue': [v: number]; commit: [] }>();
const id = useId();
const decimals = computed(() => (String(props.step).split('.')[1]?.length ?? 0));
const shown = computed(() => (props.modelValue == null ? '' : Number(props.modelValue.toFixed(decimals.value))));
function onNumber(e: Event) {
  const el = e.target as HTMLInputElement;
  const v = Number(el.value.replace(',', '.'));
  if (!el.value.trim() || !Number.isFinite(v)) { el.value = String(shown.value); return; }
  const clamped = Math.min(props.max, Math.max(props.min, v));
  el.value = String(Number(clamped.toFixed(decimals.value)));
  emit('update:modelValue', clamped);
  emit('commit');
}
</script>

<style scoped>
.num { display: inline-flex; align-items: center; gap: 0.25rem; }
.num input { width: 4.25rem; height: 1.75rem; padding: 0 0.4rem; border: 1px solid var(--color-rule); border-radius: var(--radius-sm); background: var(--color-white); font-size: var(--text-xs); text-align: right; font-variant-numeric: tabular-nums; }
.num input:focus-visible { outline: 2px solid var(--color-cyan); outline-offset: 1px; }
.unit { min-width: 1.4rem; font-size: var(--text-xs); color: var(--color-graphite); }
.off { opacity: 0.5; }
</style>
