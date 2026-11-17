<template>
  <Transition name="fade">
    <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" @click.self="$emit('close')">
      <div class="grid w-full max-w-lg gap-5 rounded-[var(--radius-lg)] bg-paper p-6" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="flex items-start justify-between gap-4">
          <h2 id="share-title" class="text-lg">{{ link ? 'Link klaar om te delen' : `${mockupIds.length} ${mockupIds.length === 1 ? 'mockup' : 'mockups'} delen met je klant` }}</h2>
          <button class="btn btn-quiet" aria-label="Sluiten" @click="$emit('close')"><Icon name="close" /></button>
        </div>
        <form v-if="!link" class="grid gap-4" @submit.prevent="create">
          <label class="field"><span class="text-sm">Titel</span><input v-model="title" class="input" maxlength="120" :placeholder="defaultTitle" /></label>
          <label class="field"><span class="text-sm">Bericht voor je klant</span><textarea v-model="message" class="input min-h-24 py-2" maxlength="2000" placeholder="Bijvoorbeeld: graag je reactie voor vrijdag." /></label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="field"><span class="text-sm">Link werkt</span>
              <select v-model="expires" class="input"><option :value="7">7 dagen</option><option :value="30">30 dagen</option><option :value="90">90 dagen</option><option :value="null">Tot je hem intrekt</option></select>
            </label>
            <label class="flex items-center gap-2 self-end pb-2.5 text-sm"><input v-model="allowDownload" type="checkbox" class="check" />Klant mag downloaden</label>
          </div>
          <p class="text-xs text-graphite">Iedereen met de link kan de mockups zien en reageren, zonder account. Je kunt de link altijd intrekken.</p>
          <div><button class="btn btn-primary" :disabled="busy"><Icon name="globe" />{{ busy ? 'Link maken…' : 'Link maken' }}</button></div>
        </form>
        <div v-else class="grid gap-4">
          <div class="flex gap-2">
            <input :value="link" class="input" readonly aria-label="Link" @focus="($event.target as HTMLInputElement).select()" />
            <button class="btn btn-secondary" @click="copy"><Icon name="copy" />{{ copied ? 'Gekopieerd' : 'Kopiëren' }}</button>
          </div>
          <p class="text-sm text-graphite">Reacties zie je onder Presentaties in dit project; je krijgt ook een e-mail bij elke reactie.</p>
          <div class="flex gap-2"><a :href="link" target="_blank" rel="noopener" class="btn btn-quiet btn-sm">Bekijken zoals je klant</a></div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
const props = defineProps<{ open: boolean; projectId: string; mockupIds: string[]; defaultTitle: string }>();
const emit = defineEmits<{ close: []; created: [] }>();
const toast = useToast();
const title = ref('');
const message = ref('');
const expires = ref<number | null>(30);
const allowDownload = ref(false);
const busy = ref(false);
const link = ref<string | null>(null);
const copied = ref(false);

watch(() => props.open, (o) => { if (o) { link.value = null; copied.value = false; title.value = ''; message.value = ''; } });

async function create() {
  busy.value = true;
  try {
    const r = await api<{ path: string }>(`/api/projects/${props.projectId}/shares`, { method: 'POST', body: { title: title.value || props.defaultTitle, message: message.value, mockupIds: props.mockupIds, allowDownload: allowDownload.value, expiresInDays: expires.value } });
    link.value = `${location.origin}${r.path}`;
    emit('created');
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
async function copy() {
  if (!link.value) return;
  try { await navigator.clipboard.writeText(link.value); copied.value = true; } catch { toast.error('Kopiëren lukte niet; selecteer de link en kopieer hem zelf.'); }
}
</script>
