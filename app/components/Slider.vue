<template>
  <label class="grid gap-1.5">
    <span class="flex items-baseline justify-between text-sm">
      <span>{{ label }}</span>
      <span class="text-xs text-graphite">{{ display }}</span>
    </span>
    <input type="range" class="range" :min="min" :max="max" :step="step" :value="modelValue" @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" @change="$emit('commit')" />
  </label>
</template>
<script setup lang="ts">
const props = withDefaults(defineProps<{ label: string; modelValue: number; min?: number; max?: number; step?: number; unit?: string }>(), { min: 0, max: 100, step: 1, unit: '' });
defineEmits<{ 'update:modelValue': [v: number]; commit: [] }>();
const display = computed(() => `${Number.isInteger(props.step) ? Math.round(props.modelValue) : props.modelValue.toFixed(1).replace('.', ',')}${props.unit === '%' || props.unit === '°' ? props.unit : props.unit ? ` ${props.unit}` : ''}`);
</script>
