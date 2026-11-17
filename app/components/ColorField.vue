<template>
  <div class="color-field">
    <label class="swatch" :style="{ background: valid ?? 'transparent' }" :title="`${label}: kleur kiezen`">
      <input type="color" :value="valid ?? '#ffffff'" :aria-label="`${label}, kleurkiezer`" @input="onPick(($event.target as HTMLInputElement).value)" />
      <span v-if="!valid" class="empty" aria-hidden="true" />
    </label>
    <input class="input hex" :value="draft" :aria-label="`${label}, HEX-code`" :aria-invalid="invalid" maxlength="7" spellcheck="false" placeholder="#rrggbb" @input="onType(($event.target as HTMLInputElement).value)" @blur="onBlur" />
    <button v-if="clearable && valid" type="button" class="btn btn-quiet btn-sm" :aria-label="`${label} wissen`" @click="emit('update:modelValue', undefined); draft = ''">Wissen</button>
  </div>
</template>

<script setup lang="ts">
// Kleur kiezen met de kleurkiezer van het systeem of door een HEX-code te typen of te plakken.
import { normalizeHex } from '~~/shared/color';

const props = withDefaults(defineProps<{ modelValue?: string | null; label: string; clearable?: boolean }>(), { modelValue: undefined, clearable: false });
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();
const valid = computed(() => normalizeHex(props.modelValue));
const draft = ref(valid.value ?? '');
const invalid = computed(() => draft.value !== '' && !normalizeHex(draft.value));
watch(valid, (v) => { if (normalizeHex(draft.value) !== v) draft.value = v ?? ''; });

function onPick(v: string) { draft.value = v; emit('update:modelValue', normalizeHex(v) ?? undefined); }
function onType(v: string) {
  draft.value = v.trim();
  const n = normalizeHex(draft.value);
  // Pas doorgeven als het een volledige kleur is; '#1e' tijdens het typen is nog geen kleur.
  if (n && draft.value.replace('#', '').length === 6) emit('update:modelValue', n);
}
function onBlur() {
  const n = normalizeHex(draft.value);
  if (n) { draft.value = n; emit('update:modelValue', n); }
  else if (!draft.value && props.clearable) emit('update:modelValue', undefined);
  else draft.value = valid.value ?? '';
}
</script>

<style scoped>
.color-field { display: flex; align-items: center; gap: 0.5rem; }
.swatch { position: relative; flex: none; width: 2.25rem; height: 2.25rem; border-radius: var(--radius-sm); border: 1px solid var(--color-rule-strong); overflow: hidden; cursor: pointer; box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.6); }
.swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.empty { position: absolute; inset: 0; background: linear-gradient(135deg, transparent 47%, var(--color-danger) 48%, var(--color-danger) 52%, transparent 53%); opacity: 0.5; pointer-events: none; }
.hex { width: 7.5rem; font-variant-numeric: tabular-nums; text-transform: lowercase; }
.hex[aria-invalid='true'] { border-color: var(--color-danger); }
</style>
