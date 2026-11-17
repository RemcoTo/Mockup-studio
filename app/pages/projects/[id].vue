<template>
  <div v-if="data">
    <PageHeader :title="data.project.name" :lead="lead" :back="{ to: '/projects', label: 'Projecten' }">
      <template #actions>
        <button class="btn btn-quiet" @click="editing = !editing"><Icon name="pencil" />Gegevens</button>
        <NuxtLink :to="`/generate?project=${data.project.id}`" class="btn btn-primary"><Icon name="plus" />Nieuwe mockup</NuxtLink>
      </template>
    </PageHeader>

    <form v-if="editing" class="grid gap-4 border-b border-rule bg-paper px-5 py-5 sm:grid-cols-3 sm:px-8 lg:px-10" @submit.prevent="saveMeta">
      <label class="field"><span>Projectnaam</span><input v-model="meta.name" class="input" required maxlength="120" /></label>
      <label class="field"><span>Klant of bedrijf</span><input v-model="meta.client" class="input" maxlength="120" /></label>
      <label class="field"><span>Website-URL</span><input v-model="meta.url" class="input" maxlength="500" /></label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn btn-primary btn-sm">Opslaan</button><button type="button" class="btn btn-quiet btn-sm" @click="editing = false">Annuleren</button></div>
    </form>

    <nav class="flex gap-1 overflow-x-auto border-b border-rule px-5 sm:px-8 lg:px-10" aria-label="Projectonderdelen">
      <button v-for="t in visibleTabs" :key="t.id" class="tab" :aria-current="tab === t.id ? 'page' : undefined" @click="tab = t.id">
        {{ t.label }} <span class="text-mist">{{ t.count }}</span>
      </button>
    </nav>

    <div class="px-5 py-7 sm:px-8 lg:px-10">
      <!-- Ontwerpen -->
      <section v-if="tab === 'designs'" class="grid gap-8">
        <DesignImport v-if="can('member')" :project-id="data.project.id" :initial-mode="(route.query.import as 'url' | 'upload') ?? 'upload'" :initial-url="data.project.url" @added="load" />
        <p v-if="!designs.length" class="text-sm text-graphite">Nog geen ontwerpen in dit project.</p>
        <div class="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
          <AssetTile v-for="a in designs" :key="a.id" :asset="a">
            <NuxtLink :to="`/generate?project=${data.project.id}&asset=${a.id}`" class="btn btn-secondary btn-sm">Mockup maken</NuxtLink>
            <span v-if="a.version > 1" class="self-center px-1 text-xs text-graphite">v{{ a.version }}</span>
            <ActionMenu class="ml-auto" :label="`Meer acties voor ${a.originalName}`">
              <button role="menuitem" @click="versionsOf = a"><Icon name="copy" :size="15" />Versies</button>
              <a role="menuitem" :href="a.originalUrl"><Icon name="download" :size="15" />Origineel downloaden</a>
              <template v-if="can('member')"><hr /><button role="menuitem" class="danger" @click="removeAsset(a)"><Icon name="trash" :size="15" />Verwijderen</button></template>
            </ActionMenu>
          </AssetTile>
        </div>
      </section>

      <!-- Mockups -->
      <section v-if="tab === 'mockups'" class="grid gap-6">
        <div v-if="data.mockups.length" class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="selected.size === data.mockups.length" @change="toggleAll" />Alles selecteren</label>
          <template v-if="selected.size">
            <span class="text-sm text-graphite">{{ selected.size }} geselecteerd</span>
            <select v-model="zipFormat" class="input h-8 w-auto"><option value="png">PNG</option><option value="jpg">JPG</option></select>
            <button class="btn btn-secondary btn-sm" :disabled="zipping" @click="downloadZip"><Icon name="download" :size="14" />{{ zipping ? 'Exporteren…' : 'Downloaden als zip' }}</button>
            <button v-if="can('member')" class="btn btn-primary btn-sm" @click="sharing = true"><Icon name="globe" :size="14" />Delen met klant</button>
          </template>
        </div>
        <p v-else class="text-sm text-graphite">Nog geen mockups. Kies hierboven Nieuwe mockup, of Mockup maken bij een ontwerp.</p>
        <div class="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          <MockupTile v-for="m in data.mockups" :key="m.id" :mockup="m" :decision="decisionOf(m.id)" :selected="selected.has(m.id)" @toggle="toggle(m.id)" @favorite="favorite(m)" @remove="removeMockup(m)" />
        </div>
      </section>

      <!-- Scènes -->
      <section v-if="tab === 'scenes'" class="grid gap-6">
        <p class="max-w-2xl text-sm text-graphite">Scènes die voor dit project zijn gegenereerd. Zet een geslaagde scène in de bibliotheek om hem ook voor andere projecten te gebruiken.</p>
        <div class="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
          <figure v-for="s in data.scenes" :key="s.id" class="grid gap-2">
            <img :src="s.thumbUrl" :alt="s.title" class="aspect-[4/3] w-full rounded-sm object-cover" loading="lazy" />
            <figcaption class="text-sm font-medium">{{ s.title }}</figcaption>
            <span class="text-xs" :class="s.surfaces.length ? 'text-graphite' : 'text-danger'">{{ s.surfaces.length ? `${s.surfaces.length} ${s.surfaces.length === 1 ? 'vlak' : 'vlakken'} gevonden` : 'Geen vlak gevonden, wijs de hoeken zelf aan' }}</span>
            <div class="flex flex-wrap gap-1">
              <NuxtLink :to="`/library/${s.id}`" class="btn btn-secondary btn-sm">Vlakken bewerken</NuxtLink>
              <button class="btn btn-quiet btn-sm" @click="toggleLibrary(s)">{{ s.inLibrary ? 'Uit bibliotheek halen' : 'In bibliotheek zetten' }}</button>
            </div>
          </figure>
        </div>
      </section>

      <!-- Exports -->
      <section v-if="tab === 'exports'">
        <p v-if="!data.exports.length" class="text-sm text-graphite">Nog geen exports. Exporteer een mockup vanuit de editor.</p>
        <ul class="rule-list">
          <li v-for="e in data.exports" :key="e.id" class="flex items-center gap-4 py-3">
            <img :src="e.url" alt="" class="h-12 w-16 rounded-sm object-cover" loading="lazy" />
            <div class="min-w-0 flex-1 text-sm"><span class="font-medium uppercase">{{ e.format }}</span> <span class="text-graphite">{{ e.width }} × {{ e.height }} px{{ e.format === 'jpg' ? `, kwaliteit ${e.quality}` : '' }}, {{ timeAgo(e.createdAt) }}</span></div>
            <NuxtLink :to="`/editor/${e.mockupId}`" class="btn btn-quiet btn-sm">Mockup openen</NuxtLink>
            <a :href="e.downloadUrl" class="btn btn-secondary btn-sm"><Icon name="download" :size="14" />Downloaden</a>
          </li>
        </ul>
      </section>

      <!-- Presentaties -->
      <section v-if="tab === 'feedback'" class="grid gap-8">
        <p v-if="!shareList.length" class="max-w-2xl text-sm text-graphite">Nog geen presentaties. Selecteer mockups onder Mockups en kies Delen met klant. Je klant geeft per beeld akkoord of vraagt een wijziging, zonder account.</p>
        <article v-for="s in shareList" :key="s.id" class="grid gap-4 border-b border-rule pb-8">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-base font-medium">{{ s.title }}</h3>
              <p class="text-xs text-graphite">
                {{ s.mockupIds.length }} {{ s.mockupIds.length === 1 ? 'mockup' : 'mockups' }}, gedeeld {{ timeAgo(s.createdAt) }}, {{ s.views ? `${s.views} keer bekeken` : 'nog niet bekeken' }}<template v-if="s.revokedAt">, ingetrokken</template><template v-else-if="s.expiresAt">, werkt tot {{ new Date(s.expiresAt).toLocaleDateString('nl-NL') }}</template>
              </p>
            </div>
            <div v-if="s.path" class="flex gap-1">
              <button class="btn btn-secondary btn-sm" @click="copyLink(s.path)"><Icon name="copy" :size="14" />Link kopiëren</button>
              <a :href="s.path" target="_blank" rel="noopener" class="btn btn-quiet btn-sm">Bekijken</a>
              <button v-if="can('member')" class="btn btn-danger btn-sm" @click="revoke(s.id)">Intrekken</button>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <NuxtLink v-for="mid in s.mockupIds" :key="mid" :to="`/editor/${mid}`" class="grid w-36 gap-1">
              <img v-if="previewOf(mid)" :src="previewOf(mid)!" alt="" class="aspect-[3/2] w-full rounded-sm object-cover" loading="lazy" />
              <span class="text-xs" :class="s.decisions[mid]?.kind === 'approve' ? 'text-ok' : s.decisions[mid]?.kind === 'changes' ? 'text-danger' : 'text-mist'">{{ s.decisions[mid]?.kind === 'approve' ? 'Akkoord' : s.decisions[mid]?.kind === 'changes' ? 'Wijziging gevraagd' : 'Nog geen reactie' }}</span>
            </NuxtLink>
          </div>
          <ul v-if="s.feedback.some((f) => f.body)" class="rule-list max-w-3xl">
            <li v-for="f in s.feedback.filter((x) => x.body)" :key="f.id" class="grid gap-0.5 py-3 text-sm">
              <span><span class="font-medium">{{ f.name }}</span> <span class="text-graphite">{{ f.kind === 'changes' ? 'vraagt een wijziging' : 'schreef' }}{{ f.mockupId ? ` bij mockup ${s.mockupIds.indexOf(f.mockupId) + 1}` : '' }}, {{ timeAgo(f.createdAt) }}</span></span>
              <span class="whitespace-pre-line">{{ f.body }}</span>
            </li>
          </ul>
        </article>
      </section>

      <!-- Configuraties -->
      <section v-if="tab === 'configs'">
        <p v-if="!data.generations.length" class="text-sm text-graphite">Nog geen gegenereerde scènes. Elke generatie bewaart zijn instellingen, zodat je hem later kunt herhalen of aanpassen.</p>
        <ul class="rule-list">
          <li v-for="g in data.generations" :key="g.id" class="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ objectLabel(g.config.objectType) }}<span v-if="envLabel(g.config)">, {{ envLabel(g.config) }}</span></div>
              <div class="text-xs text-graphite">{{ g.count }} {{ g.count === 1 ? 'variant' : 'varianten' }}, {{ statusLabel(g.status) }}, {{ timeAgo(g.createdAt) }}, {{ g.provider === 'demo' ? 'testscènes' : g.model }}</div>
              <p v-if="g.error" class="mt-1 text-xs text-danger">{{ g.error }}</p>
              <p v-if="g.config.instructions" class="mt-1 line-clamp-2 max-w-2xl text-xs text-graphite">{{ g.config.instructions }}</p>
            </div>
            <div class="flex gap-1">
              <NuxtLink :to="`/generate?project=${data.project.id}&config=${g.id}${g.assetId ? `&asset=${g.assetId}` : ''}`" class="btn btn-secondary btn-sm">Configuratie hergebruiken</NuxtLink>
              <button v-if="can('member')" class="btn btn-quiet btn-sm" :disabled="g.status === 'queued' || g.status === 'running' || removingConfig === g.id" :title="g.status === 'queued' || g.status === 'running' ? 'Kan pas verwijderd worden als de generatie klaar is' : 'Configuratie verwijderen'" :aria-label="`Configuratie ${objectLabel(g.config.objectType)} van ${timeAgo(g.createdAt)} verwijderen`" @click="removeConfig(g)"><Icon name="trash" :size="14" /></button>
            </div>
          </li>
        </ul>
      </section>
    </div>
    <AssetVersions :asset="versionsOf" :editable="can('member')" @close="versionsOf = null" @changed="onVersionChanged" />
    <ShareDialog :open="sharing" :project-id="data.project.id" :mockup-ids="[...selected]" :default-title="data.project.name" @close="sharing = false" @created="loadShares" />
  </div>
</template>

<script setup lang="ts">
import { api, downloadPost } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { timeAgo, type AssetView, type SceneView, type MockupView, type ProjectDetail } from '~/utils/types';
import { findObject, labelOf, ENVIRONMENTS } from '~~/shared/catalog';
import type { Generation, SceneConfig } from '~~/shared/types';

const route = useRoute();
const toast = useToast();
const { can } = useSession();
const id = computed(() => String(route.params.id));
const data = ref<ProjectDetail | null>(null);
const tab = ref<'designs' | 'mockups' | 'feedback' | 'scenes' | 'exports' | 'configs'>((route.query.tab as never) ?? 'designs');
const editing = ref(false);
const meta = reactive({ name: '', client: '', url: '' });
const selected = ref(new Set<string>());
const zipFormat = ref<'png' | 'jpg'>('png');
const zipping = ref(false);
const versionsOf = ref<AssetView | null>(null);
const sharing = ref(false);
interface ShareRow { id: string; path: string | null; title: string; mockupIds: string[]; createdAt: string; expiresAt: string | null; revokedAt: string | null; views: number; decisions: Record<string, { kind: 'approve' | 'changes'; name: string; at: string }>; feedback: { id: string; mockupId: string | null; kind: string; name: string; body: string; createdAt: string }[] }
const shareList = ref<ShareRow[]>([]);
async function loadShares() { shareList.value = await api<ShareRow[]>(`/api/projects/${id.value}/shares`); }
/** Laatste reactie per mockup over alle actieve presentaties heen. */
function decisionOf(mid: string) {
  let best: { kind: 'approve' | 'changes'; name: string; at: string } | null = null;
  for (const s of shareList.value) { const d = s.decisions[mid]; if (d && (!best || d.at > best.at)) best = d; }
  return best;
}
const previewOf = (mid: string) => data.value?.mockups.find((m) => m.id === mid)?.previewUrl ?? null;
async function copyLink(path: string) {
  try { await navigator.clipboard.writeText(`${location.origin}${path}`); toast.info('Link gekopieerd.'); } catch { toast.error('Kopiëren lukte niet.'); }
}
async function revoke(shareId: string) {
  if (!confirm('Deze link intrekken? Je klant kan de presentatie daarna niet meer openen. De reacties blijven bewaard.')) return;
  try { await api(`/api/shares/${shareId}`, { method: 'DELETE' }); await loadShares(); } catch (e) { toast.error((e as Error).message); }
}
function onVersionChanged(a: AssetView) {
  versionsOf.value = a;
  load().catch(() => {});
  // Mockups worden op de achtergrond opnieuw gerenderd; ververs de lijst zodra dat klaar is.
  setTimeout(() => load().catch(() => {}), 4000);
}

const designs = computed(() => data.value?.assets.filter((a) => a.kind === 'design') ?? []);
const lead = computed(() => [data.value?.project.client, data.value?.project.url].filter(Boolean).join(', ') || undefined);
const tabs = computed(() => [
  { id: 'designs', label: 'Ontwerpen', count: designs.value.length },
  { id: 'mockups', label: 'Mockups', count: data.value?.mockups.length ?? 0 },
  { id: 'feedback', label: 'Presentaties', count: shareList.value.filter((s) => !s.revokedAt).length },
  { id: 'scenes', label: 'Scènes', count: data.value?.scenes.length ?? 0 },
  { id: 'exports', label: 'Exports', count: data.value?.exports.length ?? 0 },
  { id: 'configs', label: 'Configuraties', count: data.value?.generations.length ?? 0 },
] as const);
// Ontwerpen en mockups altijd; de rest pas zodra er iets in staat (of als je er al bent).
const visibleTabs = computed(() => tabs.value.filter((t) => t.id === 'designs' || t.id === 'mockups' || t.count > 0 || t.id === tab.value));

async function load() {
  const first = !data.value;
  data.value = await api<ProjectDetail>(`/api/projects/${id.value}`);
  // Zonder gekozen tab: open bij de mockups als die er zijn, anders bij de ontwerpen.
  if (first && !route.query.tab && data.value.mockups.length) tab.value = 'mockups';
  Object.assign(meta, { name: data.value.project.name, client: data.value.project.client, url: data.value.project.url });
}
onMounted(() => { load().catch((e) => toast.error(e.message)); loadShares().catch(() => {}); });

const objectLabel = (o: string) => findObject(o)?.object.label ?? o;
const envLabel = (c: SceneConfig) => c.environmentCustom || labelOf(ENVIRONMENTS, c.environment);
const statusLabel = (s: string) => ({ queued: 'in de wachtrij', running: 'bezig', done: 'klaar', failed: 'mislukt' })[s] ?? s;

async function saveMeta() {
  try { await api(`/api/projects/${id.value}`, { method: 'PATCH', body: meta }); editing.value = false; await load(); toast.info('Gegevens opgeslagen.'); }
  catch (e) { toast.error((e as Error).message); }
}
const removingConfig = ref<string | null>(null);
async function removeConfig(g: Generation) {
  const made = g.sceneIds.length ? ` De ${g.sceneIds.length === 1 ? 'scène en mockup' : 'scènes en mockups'} die eruit ${g.sceneIds.length === 1 ? 'is' : 'zijn'} ontstaan blijven bewaard.` : '';
  if (!confirm(`Deze configuratie definitief verwijderen?${made}`)) return;
  removingConfig.value = g.id;
  try {
    await api(`/api/generations/${g.id}`, { method: 'DELETE' });
    data.value!.generations = data.value!.generations.filter((x) => x.id !== g.id);
    if (!data.value!.generations.length && tab.value === 'configs') tab.value = 'mockups';
    toast.info('Configuratie verwijderd.');
  } catch (e) { toast.error((e as Error).message); await load().catch(() => {}); }
  finally { removingConfig.value = null; }
}
async function removeAsset(a: AssetView) {
  if (!confirm(`"${a.originalName}" verwijderen? Mockups die dit ontwerp gebruiken tonen het daarna niet meer.`)) return;
  try { await api(`/api/assets/${a.id}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error((e as Error).message); }
}
function toggle(mid: string) { const s = new Set(selected.value); s.has(mid) ? s.delete(mid) : s.add(mid); selected.value = s; }
function toggleAll() { selected.value = selected.value.size === data.value!.mockups.length ? new Set() : new Set(data.value!.mockups.map((m) => m.id)); }
async function favorite(m: MockupView) {
  try { await api(`/api/mockups/${m.id}`, { method: 'PATCH', body: { favorite: !m.favorite } }); m.favorite = !m.favorite; } catch (e) { toast.error((e as Error).message); }
}
async function removeMockup(m: MockupView) {
  if (!confirm('Deze mockup en zijn exports verwijderen?')) return;
  try { await api(`/api/mockups/${m.id}`, { method: 'DELETE' }); selected.value.delete(m.id); await load(); } catch (e) { toast.error((e as Error).message); }
}
async function downloadZip() {
  zipping.value = true;
  try { await downloadPost('/api/exports/zip', { mockupIds: [...selected.value], format: zipFormat.value, quality: 92 }, `${data.value!.project.name}-mockups.zip`); await load(); }
  catch (e) { toast.error((e as Error).message); }
  finally { zipping.value = false; }
}
async function toggleLibrary(s: SceneView) {
  try { await api(`/api/scenes/${s.id}`, { method: 'PATCH', body: { inLibrary: !s.inLibrary } }); s.inLibrary = !s.inLibrary; toast.info(s.inLibrary ? 'Scène staat nu in de bibliotheek.' : 'Scène uit de bibliotheek gehaald.'); }
  catch (e) { toast.error((e as Error).message); }
}
</script>

<style scoped>
.tab { height: 2.75rem; padding: 0 0.75rem; font-size: var(--text-sm); color: var(--color-graphite); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.tab:hover { color: var(--color-ink); }
.tab[aria-current='page'] { color: var(--color-ink); border-bottom-color: var(--color-cyan); }
</style>
