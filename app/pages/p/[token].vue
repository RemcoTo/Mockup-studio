<template>
  <div class="min-h-dvh">
    <header class="sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <span class="flex min-w-0 items-center gap-2.5 text-sm font-medium"><RegMark :size="16" class="shrink-0 text-cyan" /><span class="truncate">{{ view?.client || 'Presentatie' }}</span></span>
        <span v-if="view && view.mockups.length" class="tabular shrink-0 text-sm" :class="approved === view.mockups.length ? 'text-ok' : 'text-graphite'">
          {{ approved === view.mockups.length ? 'Alles akkoord' : `${approved} van ${view.mockups.length} akkoord` }}
        </span>
      </div>
    </header>

    <main v-if="view" class="mx-auto grid max-w-6xl gap-16 px-5 pb-24 pt-14 sm:px-8 lg:pt-20">
      <section class="grid max-w-3xl gap-4">
        <h1 class="text-2xl sm:text-[2.75rem] sm:leading-[1.08]">{{ view.title }}</h1>
        <p v-if="view.message" class="whitespace-pre-line text-base text-graphite">{{ view.message }}</p>
        <p class="text-sm text-graphite">Geef per beeld akkoord of vraag een wijziging. Je reactie gaat direct naar de afzender.<template v-if="view.expiresAt"> Deze link werkt tot {{ dateLabel(view.expiresAt) }}.</template></p>
      </section>

      <article v-for="(m, i) in view.mockups" :id="`m-${m.id}`" :key="m.id" class="grid gap-5">
        <figure class="overflow-hidden rounded-[var(--radius-md)] bg-surround">
          <img :src="m.previewUrl!" :alt="m.title || `Mockup ${i + 1}`" :width="m.width" :height="m.height" class="h-auto w-full" :loading="i < 2 ? 'eager' : 'lazy'" />
        </figure>
        <div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div class="flex items-baseline gap-3">
            <span class="tabular text-sm text-mist">{{ String(i + 1).padStart(2, '0') }}</span>
            <span v-if="view.decisions[m.id]" class="text-sm" :class="view.decisions[m.id]!.kind === 'approve' ? 'text-ok' : 'text-danger'">
              {{ view.decisions[m.id]!.kind === 'approve' ? 'Akkoord' : 'Wijziging gevraagd' }} door {{ view.decisions[m.id]!.name }}, {{ timeAgo(view.decisions[m.id]!.at) }}
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <a v-if="view.allowDownload" :href="`/api/p/${token}/download/${m.id}`" class="btn btn-quiet btn-sm"><Icon name="download" :size="14" />Downloaden</a>
            <button class="btn btn-secondary btn-sm" :aria-pressed="open === m.id" @click="open = open === m.id ? null : m.id">Wijziging vragen</button>
            <button class="btn btn-sm" :class="view.decisions[m.id]?.kind === 'approve' ? 'btn-ok' : 'btn-primary'" :disabled="sending" @click="send(m.id, 'approve')">
              <Icon name="check" :size="14" />{{ view.decisions[m.id]?.kind === 'approve' ? 'Akkoord gegeven' : 'Akkoord' }}
            </button>
          </div>
        </div>
        <form v-if="open === m.id" class="grid max-w-2xl gap-3" @submit.prevent="send(m.id, 'changes')">
          <label class="field"><span class="text-sm">Wat wil je anders?</span><textarea v-model="draft" class="input min-h-24 py-2" maxlength="2000" required /></label>
          <div class="flex gap-2"><button class="btn btn-primary btn-sm" :disabled="sending || !draft.trim()">Versturen</button><button type="button" class="btn btn-quiet btn-sm" @click="open = null">Annuleren</button></div>
        </form>
        <ul v-if="threadOf(m.id).length" class="rule-list max-w-2xl">
          <li v-for="f in threadOf(m.id)" :key="f.id" class="grid gap-0.5 py-3 text-sm">
            <span><span class="font-medium">{{ f.name }}</span> <span class="text-graphite">{{ f.kind === 'approve' ? 'gaf akkoord' : f.kind === 'changes' ? 'vroeg een wijziging' : '' }} {{ timeAgo(f.createdAt) }}</span></span>
            <span v-if="f.body" class="whitespace-pre-line">{{ f.body }}</span>
          </li>
        </ul>
      </article>

      <section class="grid max-w-2xl gap-4 border-t border-rule pt-10">
        <h2 class="text-lg">Algemene opmerking</h2>
        <ul v-if="general.length" class="rule-list">
          <li v-for="f in general" :key="f.id" class="grid gap-0.5 py-3 text-sm"><span><span class="font-medium">{{ f.name }}</span> <span class="text-graphite">{{ timeAgo(f.createdAt) }}</span></span><span class="whitespace-pre-line">{{ f.body }}</span></li>
        </ul>
        <form class="grid gap-3" @submit.prevent="send(null, 'comment')">
          <textarea v-model="comment" class="input min-h-24 py-2" maxlength="2000" placeholder="Schrijf hier je opmerking" aria-label="Algemene opmerking" />
          <div><button class="btn btn-secondary btn-sm" :disabled="sending || !comment.trim()">Versturen</button></div>
        </form>
      </section>
    </main>

    <main v-else-if="error" class="mx-auto grid max-w-xl gap-3 px-5 py-28 sm:px-8">
      <h1 class="text-xl">{{ error.status === 410 ? 'Deze presentatie is verlopen' : 'Deze presentatie bestaat niet (meer)' }}</h1>
      <p class="text-sm text-graphite">{{ error.status === 410 ? 'Vraag de afzender om een nieuwe link.' : 'Controleer of de link volledig is, of vraag de afzender om een nieuwe.' }}</p>
    </main>

    <Transition name="fade">
      <div v-if="asking" class="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" @click.self="asking = null">
        <form class="grid w-full max-w-sm gap-4 rounded-[var(--radius-lg)] bg-paper p-6" role="dialog" aria-modal="true" aria-labelledby="name-title" @submit.prevent="confirmName">
          <h2 id="name-title" class="text-lg">Wie reageert er?</h2>
          <p class="text-sm text-graphite">Je naam staat bij je reactie, zodat de afzender weet van wie die komt.</p>
          <label class="field"><span class="text-sm">Naam</span><input v-model="nameDraft" class="input" maxlength="80" required autofocus /></label>
          <div class="flex gap-2"><button class="btn btn-primary btn-sm" :disabled="!nameDraft.trim()">Doorgaan</button><button type="button" class="btn btn-quiet btn-sm" @click="asking = null">Annuleren</button></div>
        </form>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ApiError, api } from '~/composables/useApi';
import { useToast } from '~/composables/useToast';
import { timeAgo } from '~/utils/types';
definePageMeta({ layout: 'presentation' });
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] });

type Kind = 'approve' | 'changes' | 'comment';
interface Feedback { id: string; mockupId: string | null; kind: Kind; name: string; body: string; createdAt: string }
interface View {
  title: string; message: string; client: string; allowDownload: boolean; expiresAt: string | null;
  mockups: { id: string; previewUrl: string | null; width: number; height: number; title: string }[];
  decisions: Record<string, { kind: 'approve' | 'changes'; name: string; at: string }>;
  feedback: Feedback[];
}

const route = useRoute();
const toast = useToast();
const token = String(route.params.token);
const view = ref<View | null>(null);
const error = ref<{ status: number } | null>(null);
const open = ref<string | null>(null);
const draft = ref('');
const comment = ref('');
const sending = ref(false);
const asking = ref<{ mockupId: string | null; kind: Kind } | null>(null);
const nameDraft = ref('');

const NAME_KEY = 'ms-reviewer-name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const name = ref('');
onMounted(() => { name.value = readName(); nameDraft.value = name.value; });

useHead(() => ({ title: view.value ? view.value.title : 'Presentatie' }));

async function load() {
  try { view.value = await api<View>(`/api/p/${token}`); error.value = null; }
  catch (e) { error.value = { status: (e as ApiError).status ?? 404 }; }
}
await load();

const approved = computed(() => view.value ? view.value.mockups.filter((m) => view.value!.decisions[m.id]?.kind === 'approve').length : 0);
const threadOf = (id: string) => view.value?.feedback.filter((f) => f.mockupId === id && (f.kind !== 'approve' || f.body)) ?? [];
const general = computed(() => view.value?.feedback.filter((f) => !f.mockupId) ?? []);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

function send(mockupId: string | null, kind: Kind) {
  if (!name.value) { asking.value = { mockupId, kind }; return; }
  void post(mockupId, kind);
}
function confirmName() {
  name.value = nameDraft.value.trim();
  try { localStorage.setItem(NAME_KEY, name.value); } catch { /* privémodus: alleen voor deze sessie */ }
  const a = asking.value;
  asking.value = null;
  if (a) void post(a.mockupId, a.kind);
}

async function post(mockupId: string | null, kind: Kind) {
  sending.value = true;
  try {
    const body = kind === 'changes' ? draft.value : kind === 'comment' ? comment.value : '';
    await api(`/api/p/${token}/feedback`, { method: 'POST', body: { mockupId, kind, name: name.value, body } });
    if (kind === 'changes') { draft.value = ''; open.value = null; }
    if (kind === 'comment') comment.value = '';
    toast.info(kind === 'approve' ? 'Akkoord verstuurd.' : 'Verstuurd. Dank je wel.');
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { sending.value = false; }
}
</script>
