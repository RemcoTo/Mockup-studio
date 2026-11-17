<template>
  <div class="grid gap-4">
    <div v-if="kind === 'design'" class="segmented" role="tablist">
      <button role="tab" :aria-pressed="mode === 'upload'" @click="mode = 'upload'">Bestand uploaden</button>
      <button role="tab" :aria-pressed="mode === 'url'" @click="mode = 'url'">Website importeren</button>
    </div>

    <!-- Uploaden -->
    <div v-if="mode === 'upload'"
      class="drop grid min-h-40 place-items-center rounded-lg border border-dashed border-rule-strong bg-white px-6 py-8 text-center"
      :class="{ 'is-over': over }"
      @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
      <div class="grid justify-items-center gap-2">
        <Icon name="upload" :size="22" class="text-graphite" />
        <p class="text-sm"><button class="font-medium text-cyan underline-offset-2 hover:underline" @click="input?.click()">Kies bestanden</button> of sleep ze hierheen</p>
        <p class="text-xs text-graphite">{{ kind === 'design' ? `PNG, JPG, WebP, SVG of PDF, maximaal ${maxMb} MB per bestand. Transparantie blijft behouden.` : `PNG, JPG of WebP, maximaal ${maxMb} MB per bestand.` }}</p>
        <p v-if="uploading" class="text-xs text-graphite">Bezig met uploaden…</p>
      </div>
      <input ref="input" type="file" multiple class="hidden" :accept="accept" @change="onPick" />
    </div>

    <!-- Website -->
    <form v-else class="grid gap-4 rounded-lg border border-rule bg-white p-5" @submit.prevent="capture">
      <div class="flex flex-wrap items-end gap-2">
        <label class="field min-w-64 flex-1"><span>Webadres</span>
          <input v-model="url" class="input" inputmode="url" placeholder="https://voorbeeld.nl" required @blur="check" />
        </label>
        <button class="btn btn-primary" :disabled="busy || !url">{{ busy ? 'Vastleggen…' : 'Website vastleggen' }}</button>
      </div>
      <p v-if="reach" class="text-xs" :class="reach.ok ? 'text-ok' : 'text-danger'">{{ reach.text }}</p>
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div class="segmented" aria-label="Viewport">
          <button v-for="v in viewports" :key="v.id" type="button" :aria-pressed="viewport === v.id" @click="viewport = v.id">{{ v.label }}</button>
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="fullPage" type="checkbox" class="check" />Volledige pagina</label>
        <label class="flex items-center gap-2 text-sm"><input v-model="hideCookies" type="checkbox" class="check" />Cookiebanners verbergen</label>
        <label class="flex items-center gap-2 text-sm">Wachttijd
          <select v-model.number="delay" class="input h-8 w-28"><option :value="800">Kort</option><option :value="2500">2,5 sec</option><option :value="6000">6 sec</option></select>
        </label>
      </div>
      <p class="text-xs text-graphite">De website wordt in een echte browser geopend en precies zo vastgelegd als een bezoeker hem ziet. Pagina’s achter een login kunnen niet worden vastgelegd.</p>
      <div v-if="error" class="notice notice-error grid gap-2">
        <span>{{ error }}</span>
        <button type="button" class="justify-self-start text-sm underline underline-offset-2" @click="mode = 'upload'">Zelf een screenshot uploaden</button>
      </div>
      <ul v-if="warnings.length" class="notice grid gap-1">
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </form>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import type { AssetView } from '~/utils/types';

const props = withDefaults(defineProps<{ projectId: string; kind?: 'design' | 'reference'; initialMode?: 'upload' | 'url'; initialUrl?: string; maxMb?: number }>(), { kind: 'design', initialMode: 'upload', initialUrl: '', maxMb: 40 });
const emit = defineEmits<{ added: [assets: AssetView[]] }>();
const toast = useToast();

const mode = ref<'upload' | 'url'>(props.kind === 'reference' ? 'upload' : props.initialMode);
const input = ref<HTMLInputElement | null>(null);
const over = ref(false);
const uploading = ref(false);
const accept = computed(() => (props.kind === 'reference' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.svg,.pdf'));

async function upload(files: File[]) {
  if (!files.length) return;
  uploading.value = true;
  try {
    const form = new FormData();
    form.set('kind', props.kind);
    files.forEach((f) => form.append('file', f, f.name));
    const res = await api<{ assets: AssetView[]; errors: { name: string; message: string }[] }>(`/api/projects/${props.projectId}/assets`, { method: 'POST', body: form });
    emit('added', res.assets);
    res.errors.forEach((e) => toast.error(`${e.name}: ${e.message}`));
    if (res.assets.length) toast.info(res.assets.length === 1 ? `${res.assets[0]!.originalName} toegevoegd.` : `${res.assets.length} bestanden toegevoegd.`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    uploading.value = false;
    if (input.value) input.value.value = '';
  }
}
const onPick = (e: Event) => upload(Array.from((e.target as HTMLInputElement).files ?? []));
const onDrop = (e: DragEvent) => { over.value = false; upload(Array.from(e.dataTransfer?.files ?? [])); };

const viewports = [
  { id: 'desktop', label: 'Desktop' }, { id: 'laptop', label: 'Laptop' }, { id: 'tablet', label: 'Tablet' }, { id: 'smartphone', label: 'Smartphone' },
] as const;
const url = ref(props.initialUrl);
const viewport = ref<(typeof viewports)[number]['id']>('desktop');
const fullPage = ref(false);
const hideCookies = ref(true);
const delay = ref(800);
const busy = ref(false);
const error = ref('');
const warnings = ref<string[]>([]);
const reach = ref<{ ok: boolean; text: string } | null>(null);

async function check() {
  if (!url.value.trim()) return;
  reach.value = { ok: true, text: 'Bereikbaarheid controleren…' };
  try {
    const r = await api<{ url: string; status: number; redirected: boolean }>('/api/capture/check', { method: 'POST', body: { url: url.value } });
    reach.value = { ok: r.status < 400, text: r.status < 400 ? `Bereikbaar${r.redirected ? `, doorgestuurd naar ${r.url}` : ''}.` : `De website antwoordt met status ${r.status}. Vastleggen kan alsnog lukken.` };
  } catch (e) {
    reach.value = { ok: false, text: (e as Error).message };
  }
}

async function capture() {
  busy.value = true; error.value = ''; warnings.value = [];
  try {
    const res = await api<{ asset: AssetView; warnings: string[] }>(`/api/projects/${props.projectId}/capture`, {
      method: 'POST', body: { url: url.value, viewport: viewport.value, fullPage: fullPage.value, hideCookieBanners: hideCookies.value, delayMs: delay.value },
      // Een volledige pagina: laden, rustig doorscrollen voor lazy loading en de lange screenshot kosten samen meer tijd.
      timeout: fullPage.value ? 240_000 : 120_000,
    });
    warnings.value = res.warnings;
    emit('added', [res.asset]);
    toast.info('Website vastgelegd.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.drop.is-over { border-color: var(--color-cyan); background: var(--color-cyan-soft); }
</style>
