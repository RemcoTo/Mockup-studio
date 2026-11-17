<template>
  <div>
    <PageHeader title="Foto toevoegen" lead="Gebruik alleen eigen fotografie of foto’s met een licentie die commercieel gebruik toestaat." :back="{ to: '/library', label: 'Scènes' }" />
    <form class="grid max-w-2xl gap-5 px-5 py-8 sm:px-8 lg:px-10" @submit.prevent="submit">
      <label class="field"><span>Foto (JPG, PNG of WebP)</span>
        <input class="input pt-1.5" type="file" accept="image/jpeg,image/png,image/webp" required @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
      </label>
      <div class="grid gap-5 sm:grid-cols-2">
        <label class="field"><span>Titel</span><input v-model="title" class="input" maxlength="120" placeholder="Bijvoorbeeld: Laptop op eiken bureau" /></label>
        <label class="field"><span>Objecttype</span>
          <select v-model="objectType" class="input" required>
            <optgroup v-for="c in CATEGORIES" :key="c.id" :label="c.label"><option v-for="o in c.objects" :key="o.id" :value="o.id">{{ o.label }}</option></optgroup>
          </select>
        </label>
        <label class="field"><span>Materiaal</span><input v-model="material" class="input" maxlength="60" placeholder="Bijvoorbeeld: hout" /></label>
        <label class="field"><span>Camerahoek</span>
          <select v-model="angle" class="input"><option value="">Onbekend</option><option v-for="a in ANGLES" :key="a.id" :value="a.id">{{ a.label }}</option></select>
        </label>
        <label class="field"><span>Compositie</span>
          <select v-model="composition" class="input"><option value="">Onbekend</option><option v-for="a in POSITIONS" :key="a.id" :value="a.id">{{ a.label }}</option></select>
        </label>
        <label class="field"><span>Kleur</span><input v-model="color" class="input" maxlength="60" placeholder="Bijvoorbeeld: warm, licht" /></label>
      </div>
      <label class="field"><span>Bron of licentie</span><input v-model="license" class="input" required maxlength="300" placeholder="Bijvoorbeeld: eigen fotografie Wedentify, of naam van de mockupset en licentie" /></label>
      <label class="flex items-start gap-2 text-sm"><input v-model="detect" type="checkbox" class="check mt-0.5" />De foto heeft een egaal groen vlak; zoek het automatisch. Laat uit voor een gewone foto, dan wijs je de hoeken zelf aan.</label>
      <p v-if="error" class="notice notice-error">{{ error }}</p>
      <div><button class="btn btn-primary" :disabled="busy || !file">{{ busy ? 'Toevoegen…' : 'Toevoegen en vlak aanwijzen' }}</button></div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import type { SceneView } from '~/utils/types';
import { ANGLES, CATEGORIES, POSITIONS } from '~~/shared/catalog';
const file = ref<File | null>(null);
const title = ref(''), objectType = ref('laptop'), material = ref(''), angle = ref(''), composition = ref(''), color = ref(''), license = ref('');
const detect = ref(false);
const busy = ref(false), error = ref('');
async function submit() {
  if (!file.value) return;
  busy.value = true; error.value = '';
  const form = new FormData();
  form.set('file', file.value, file.value.name);
  Object.entries({ title: title.value, objectType: objectType.value, material: material.value, angle: angle.value, composition: composition.value, color: color.value, license: license.value, detect: String(detect.value) })
    .forEach(([k, v]) => form.set(k, v));
  try {
    const s = await api<SceneView>('/api/scenes', { method: 'POST', body: form });
    await navigateTo(`/library/${s.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
