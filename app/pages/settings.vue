<template>
  <div>
    <PageHeader title="Instellingen" />
    <nav class="flex gap-1 overflow-x-auto border-b border-rule px-5 sm:px-8 lg:px-10" aria-label="Onderdelen">
      <button v-for="t in tabs" :key="t.id" class="tab" :aria-current="tab === t.id ? 'page' : undefined" @click="setTab(t.id)">{{ t.label }}</button>
    </nav>

    <div class="max-w-3xl px-5 py-8 sm:px-8 lg:px-10">
      <!-- Werkruimte en team -->
      <div v-if="tab === 'team' && ws" class="grid gap-10">
        <section class="grid gap-3">
          <h2 class="text-lg">Werkruimte</h2>
          <form v-if="can('admin')" class="flex flex-wrap items-end gap-2" @submit.prevent="renameWs">
            <label class="field min-w-64 flex-1"><span>Naam</span><input v-model="wsName" class="input" maxlength="120" required /></label>
            <button class="btn btn-secondary" :disabled="wsName === ws.workspace.name">Opslaan</button>
          </form>
          <p v-else class="text-sm">{{ ws.workspace.name }}</p>
          <p class="text-sm text-graphite">{{ ws.usage.projects }} {{ ws.usage.projects === 1 ? 'project' : 'projecten' }}, {{ ws.usage.members }} {{ ws.usage.members === 1 ? 'lid' : 'leden' }}. Je rol: {{ ROLE_LABELS[ws.role].toLowerCase() }}.</p>
        </section>

        <section class="grid gap-3">
          <h2 class="text-lg">Leden</h2>
          <ul class="rule-list">
            <li v-for="m in ws.members" :key="m.id" class="flex flex-wrap items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ m.name }}<span v-if="m.id === me?.id" class="font-normal text-graphite"> (jij)</span></div>
                <div class="truncate text-xs text-graphite">{{ m.email }}</div>
              </div>
              <select v-if="can('admin') && m.id !== me?.id" class="input h-8 w-auto" :value="m.role" :aria-label="`Rol van ${m.name}`" @change="setRole(m.id, ($event.target as HTMLSelectElement).value)">
                <option v-for="r in assignable" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
              </select>
              <span v-else class="text-sm text-graphite">{{ ROLE_LABELS[m.role] }}</span>
              <button v-if="(can('admin') && m.id !== me?.id) || (m.id === me?.id && ws.members.length > 1)" class="btn btn-danger btn-sm" @click="removeMember(m)">{{ m.id === me?.id ? 'Verlaten' : 'Verwijderen' }}</button>
            </li>
          </ul>
        </section>

        <section v-if="can('admin')" class="grid gap-3">
          <h2 class="text-lg">Iemand uitnodigen</h2>
          <p v-if="!me?.emailVerified" class="notice">Bevestig eerst je eigen e-mailadres; daarna kun je collega’s uitnodigen. <button class="underline underline-offset-2" @click="resend">Bevestigingsmail opnieuw sturen</button></p>
          <form v-else class="flex flex-wrap items-end gap-2" @submit.prevent="sendInvite">
            <label class="field min-w-64 flex-1"><span>E-mailadres</span><input v-model="inviteEmail" class="input" type="email" required /></label>
            <label class="field"><span>Rol</span>
              <select v-model="inviteRole" class="input w-auto"><option value="member">Lid</option><option value="admin">Beheerder</option><option value="viewer">Kijker</option></select>
            </label>
            <button class="btn btn-primary" :disabled="inviting">{{ inviting ? 'Versturen…' : 'Uitnodiging versturen' }}</button>
          </form>
          <p v-if="me?.emailVerified" class="text-xs text-graphite">{{ ROLE_HINTS[inviteRole] }}.</p>
          <ul v-if="ws.invitations.length" class="rule-list mt-2">
            <li v-for="i in ws.invitations" :key="i.id" class="flex items-center gap-3 py-2.5 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ i.email }} <span class="text-graphite">als {{ ROLE_LABELS[i.role].toLowerCase() }}, verloopt {{ dateNl(i.expiresAt) }}</span></span>
              <button class="btn btn-quiet btn-sm" @click="revoke(i.id)">Intrekken</button>
            </li>
          </ul>
        </section>

        <section v-if="ws.credits.history.length || session?.site.creditsEnforced" class="grid gap-3">
          <h2 class="text-lg">Credits</h2>
          <p class="text-sm">Saldo: {{ ws.credits.balance }} credits. <NuxtLink v-if="session?.site.creditsEnforced" to="/abonnement" class="underline underline-offset-2">Abonnement en bijkopen</NuxtLink></p>
          <ul v-if="ws.credits.history.length" class="rule-list text-sm">
            <li v-for="h in ws.credits.history.slice(0, 15)" :key="h.id" class="flex justify-between gap-3 py-2">
              <span class="text-graphite">{{ creditReason(h.reason) }}, {{ timeAgo(h.createdAt) }}</span>
              <span :class="h.delta < 0 ? '' : 'text-ok'">{{ h.delta > 0 ? '+' : '' }}{{ h.delta }}</span>
            </li>
          </ul>
        </section>

        <section v-if="can('admin')" class="grid gap-3 border-t border-rule pt-8">
          <h2 class="text-lg">Gegevens</h2>
          <p class="text-sm text-graphite">Een overzicht van alles in deze werkruimte (projecten, ontwerpen, prompts, presentaties en reacties) als JSON-bestand. Ontwerpen en exports download je per stuk in het project.</p>
          <div><a href="/api/workspace/export" class="btn btn-secondary btn-sm"><Icon name="download" :size="14" />Gegevens exporteren</a></div>
        </section>
        <section v-if="ws.role === 'owner'" class="grid gap-3">
          <h2 class="text-lg">Werkruimte verwijderen</h2>
          <p class="text-sm text-graphite">Verwijdert alle projecten, ontwerpen, scènes, mockups, exports en presentaties van iedereen in deze werkruimte. Dit kan niet ongedaan worden gemaakt. Heb je een abonnement, zeg dat dan eerst op.</p>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="deleteWs">
            <label class="field min-w-64 flex-1"><span>Typ “{{ ws.workspace.name }}” om te bevestigen</span><input v-model="deleteConfirm" class="input" autocomplete="off" /></label>
            <button class="btn btn-danger" :disabled="deleteConfirm.trim() !== ws.workspace.name.trim()">Definitief verwijderen</button>
          </form>
        </section>
      </div>

      <!-- Account -->
      <div v-if="tab === 'account' && me" class="grid gap-10">
        <section class="grid gap-3">
          <h2 class="text-lg">Profiel</h2>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveName">
            <label class="field min-w-64 flex-1"><span>Naam</span><input v-model="myName" class="input" maxlength="120" required /></label>
            <button class="btn btn-secondary" :disabled="myName === me.name">Opslaan</button>
          </form>
          <p class="text-sm">{{ me.email }} <span v-if="session?.site.emailVerification" :class="me.emailVerified ? 'text-ok' : 'text-danger'">{{ me.emailVerified ? 'bevestigd' : 'nog niet bevestigd' }}</span>
            <button v-if="!me.emailVerified" class="ml-2 text-sm underline underline-offset-2" @click="resend">Bevestigingsmail opnieuw sturen</button>
          </p>
        </section>
        <section class="grid gap-3">
          <h2 class="text-lg">Wachtwoord wijzigen</h2>
          <form class="grid max-w-md gap-3" @submit.prevent="changePassword">
            <label class="field"><span>Huidig wachtwoord</span><input v-model="pwCurrent" class="input" type="password" autocomplete="current-password" required /></label>
            <label class="field"><span>Nieuw wachtwoord</span><input v-model="pwNext" class="input" type="password" autocomplete="new-password" minlength="10" required /></label>
            <button class="btn btn-secondary justify-self-start">Wachtwoord wijzigen</button>
            <p class="text-xs text-graphite">Je wordt op andere apparaten uitgelogd.</p>
          </form>
        </section>
        <section class="grid gap-3 border-t border-rule pt-8">
          <h2 class="text-lg">Account verwijderen</h2>
          <p class="max-w-2xl text-sm text-graphite">Je account en de werkruimtes waarin alleen jij zit worden definitief verwijderd. Werkruimtes met collega’s blijven bestaan; ben je daar de enige eigenaar, maak dan eerst iemand anders eigenaar.</p>
          <form class="flex max-w-md flex-wrap items-end gap-2" @submit.prevent="deleteMe">
            <label class="field min-w-56 flex-1"><span>Wachtwoord ter bevestiging</span><input v-model="deletePw" class="input" type="password" autocomplete="current-password" required /></label>
            <button class="btn btn-danger">Account verwijderen</button>
          </form>
        </section>
      </div>

      <!-- Systeem -->
      <div v-if="tab === 'system' && status" class="grid gap-10">
        <section class="grid gap-3">
          <h2 class="text-lg">Beeldgeneratie</h2>
          <dl class="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt class="text-graphite">Provider</dt><dd>{{ status.provider.label }}</dd>
            <dt class="text-graphite">Model</dt><dd>{{ status.provider.isAi ? status.provider.model : 'Geen AI, getekende testscènes' }}</dd>
            <dt class="text-graphite">Status</dt><dd :class="status.provider.configured ? 'text-ok' : 'text-danger'">{{ status.provider.configured ? 'Klaar voor gebruik' : 'Niet ingesteld' }}</dd>
            <dt class="text-graphite">Dagmaximum</dt><dd>${{ status.limits.aiWorkspaceDailyUsd }} per werkruimte, ${{ status.limits.aiDailyUsd }} voor het platform</dd>
          </dl>
          <p v-if="status.provider.problem" class="notice notice-error">{{ status.provider.problem }}</p>
          <details v-if="me?.isAdmin" class="mt-2" :open="!status.provider.configured">
            <summary class="cursor-pointer text-sm font-medium">OpenAI-sleutel instellen, stap voor stap</summary>
            <ol class="mt-3 grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
              <li>Ga naar <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="underline underline-offset-2">platform.openai.com/api-keys</a> en log in met het account waarop het tegoed staat.</li>
              <li>Kies <em>Create new secret key</em>, geef hem een naam zoals “Mockup Studio” en kopieer de sleutel. Je ziet hem maar één keer.</li>
              <li>Controleer onder <em>Settings, Organization, General</em> of de organisatie geverifieerd is; de beeldmodellen vragen daar soms om.</li>
              <li>Open in de projectmap het bestand <code>.env</code> en zet de sleutel achter <code>NUXT_OPENAI_API_KEY=</code>.</li>
              <li>Zet <code>NUXT_IMAGE_PROVIDER=openai</code> en start de applicatie opnieuw. Deze pagina toont dan “Klaar voor gebruik”.</li>
              <li>Stel bij <em>Settings, Limits</em> een maandlimiet in, zodat er nooit meer wordt uitgegeven dan je wilt.</li>
            </ol>
          </details>
        </section>

        <section class="grid gap-3">
          <h2 class="text-lg">Kosten per beeld</h2>
          <p class="text-sm text-graphite">Gepubliceerde prijzen per beeld. Bij elke generatie zie je vooraf de geschatte kosten en het aantal credits. Website-import, bibliotheekmockups, plaatsing en export zijn gratis.</p>
          <div v-for="(row, model) in status.pricing.table" :key="model" class="grid gap-1">
            <h3 class="text-sm font-medium">{{ model }}</h3>
            <table class="w-full text-sm">
              <thead><tr class="border-b border-rule text-left text-graphite"><th class="py-1.5 font-normal">Formaat</th><th class="py-1.5 font-normal">Snel concept</th><th class="py-1.5 font-normal">Normaal</th><th class="py-1.5 font-normal">Hoog</th></tr></thead>
              <tbody>
                <tr v-for="size in Object.keys(row.low)" :key="size" class="border-b border-rule">
                  <td class="py-1.5">{{ size.replace('x', ' × ') }}</td><td>${{ fmt(row.low[size]) }}</td><td>${{ fmt(row.medium[size]) }}</td><td>${{ fmt(row.high[size]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-sm">Credits per beeld: snel concept {{ status.pricing.credits.low }}, normaal {{ status.pricing.credits.medium }}, hoog {{ status.pricing.credits.high }}. Boven 2,5 megapixel twee keer zoveel, boven 5 megapixel vier keer. Een mislukte generatie kost niets.</p>
          <p class="text-xs text-graphite">Bron: <a :href="status.pricing.source.url" target="_blank" rel="noopener" class="underline underline-offset-2">{{ status.pricing.source.label }}</a>. Controleer de actuele prijzen op <a href="https://openai.com/api/pricing" target="_blank" rel="noopener" class="underline underline-offset-2">openai.com/api/pricing</a>.</p>
        </section>

        <section class="grid gap-3">
          <h2 class="text-lg">Website-import</h2>
          <dl class="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt class="text-graphite">Browser</dt><dd :class="status.browser.installed ? 'text-ok' : 'text-danger'">{{ status.browser.installed ? 'Geïnstalleerd' : 'Niet gevonden' }}</dd>
            <dt class="text-graphite">Interne adressen</dt><dd>{{ status.captureAllowPrivate ? 'Toegestaan (alleen voor lokaal testen)' : 'Geblokkeerd' }}</dd>
          </dl>
          <p v-if="!status.browser.installed" class="notice">Voer in de projectmap eenmalig <code>npm run browsers</code> uit. Dat installeert de Chromium-browser waarmee websites worden vastgelegd.</p>
        </section>

        <section class="grid gap-3">
          <h2 class="text-lg">E-mail</h2>
          <p class="text-sm">{{ status.mailMode === 'smtp' ? 'E-mails worden via SMTP verstuurd.' : `Er is geen SMTP ingesteld en dat is ook niet nodig. ${session?.site.emailVerification ? 'Bevestigings-, herstel-' : 'Herstel-'} en uitnodigingsmails komen in de uitbak hieronder.` }}</p>
          <div v-if="me?.isAdmin && status.mailMode === 'outbox'">
            <button class="btn btn-secondary btn-sm" @click="loadOutbox">Uitbak bekijken</button>
            <ul v-if="outbox" class="rule-list mt-3 text-sm">
              <li v-if="!outbox.length" class="py-2 text-graphite">De uitbak is leeg.</li>
              <li v-for="m in outbox" :key="m.id" class="grid gap-1 py-3">
                <span class="font-medium">{{ m.subject }}</span>
                <span class="text-xs text-graphite">aan {{ m.to }}, {{ timeAgo(m.createdAt) }}</span>
                <span class="whitespace-pre-wrap break-all text-xs">{{ m.text }}</span>
              </li>
            </ul>
          </div>
        </section>

        <section class="grid gap-3">
          <h2 class="text-lg">Uploads</h2>
          <p class="text-sm">Maximaal {{ status.uploadMaxMb }} MB per bestand. PNG, JPG, WebP, SVG en PDF (tot twaalf pagina’s).</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { dateNl, timeAgo, type StatusInfo } from '~/utils/types';
import { ROLE_HINTS, ROLE_LABELS, type Role } from '~~/shared/roles';

interface WsInfo {
  workspace: { id: string; name: string; plan: string };
  role: Role;
  members: { id: string; email: string; name: string; role: Role }[];
  invitations: { id: string; email: string; role: Role; expiresAt: string }[];
  credits: { balance: number; history: { id: string; delta: number; reason: string; createdAt: string }[] };
  usage: { projects: number; members: number };
}

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { state: session, refresh, can } = useSession();
const me = computed(() => session.value?.user ?? null);
const tabs = [{ id: 'team', label: 'Werkruimte en team' }, { id: 'account', label: 'Account' }, { id: 'system', label: 'Systeem' }] as const;
type TabId = (typeof tabs)[number]['id'];
const tab = ref<TabId>((tabs.find((t) => t.id === route.query.tab)?.id) ?? 'team');
function setTab(t: TabId) { tab.value = t; router.replace({ query: { tab: t } }); }

const ws = ref<WsInfo | null>(null);
const status = ref<StatusInfo | null>(null);
const wsName = ref('');
const myName = ref('');
const inviteEmail = ref('');
const inviteRole = ref<Exclude<Role, 'owner'>>('member');
const inviting = ref(false);
const pwCurrent = ref(''), pwNext = ref('');
const outbox = ref<{ id: string; to: string; subject: string; text: string; createdAt: string }[] | null>(null);
const assignable = computed<Role[]>(() => (session.value?.role === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['admin', 'member', 'viewer']));

async function loadWs() {
  ws.value = await api<WsInfo>('/api/workspace');
  wsName.value = ws.value.workspace.name;
}
onMounted(async () => {
  await loadWs().catch((e) => toast.error(e.message));
  myName.value = me.value?.name ?? '';
  status.value = await api<StatusInfo>('/api/status').catch(() => null);
});
watch(me, (u) => { if (u && !myName.value) myName.value = u.name; });

const fmt = (n?: number) => (n ?? 0).toFixed(3).replace('.', ',');
const creditReason = (r: string) => ({ generation: 'Generatie', refund: 'Teruggeboekt na mislukte generatie', grant: 'Bijgeschreven door beheerder', plan: 'Maandcredits', topup: 'Bijgekocht', welcome: 'Welkomstcredits', test: 'Correctie' })[r] ?? r;

async function act(fn: () => Promise<unknown>, ok?: string) {
  try { await fn(); if (ok) toast.info(ok); await loadWs(); await refresh(); }
  catch (e) { toast.error((e as Error).message); }
}
const renameWs = () => act(() => api('/api/workspace', { method: 'PATCH', body: { name: wsName.value } }), 'Naam opgeslagen.');
const setRole = (id: string, role: string) => act(() => api(`/api/workspace/members/${id}`, { method: 'PATCH', body: { role } }), 'Rol aangepast.');
async function removeMember(m: { id: string; name: string }) {
  const self = m.id === me.value?.id;
  if (!confirm(self ? 'Deze werkruimte verlaten? Je verliest de toegang tot alle projecten erin.' : `${m.name} uit de werkruimte verwijderen?`)) return;
  await act(() => api(`/api/workspace/members/${m.id}`, { method: 'DELETE' }), self ? undefined : 'Lid verwijderd.');
  if (self) window.location.assign('/');
}
async function sendInvite() {
  inviting.value = true;
  await act(() => api('/api/workspace/invite', { method: 'POST', body: { email: inviteEmail.value, role: inviteRole.value } }), `Uitnodiging verstuurd naar ${inviteEmail.value}.`);
  inviteEmail.value = '';
  inviting.value = false;
}
const revoke = (id: string) => act(() => api(`/api/workspace/invitations/${id}`, { method: 'DELETE' }), 'Uitnodiging ingetrokken.');
const resend = () => act(() => api('/api/auth/resend-verification', { method: 'POST' }), 'Bevestigingsmail verstuurd.');
const saveName = () => act(() => api('/api/auth/profile', { method: 'PATCH', body: { name: myName.value } }), 'Naam opgeslagen.');
async function changePassword() {
  await act(() => api('/api/auth/password', { method: 'POST', body: { current: pwCurrent.value, next: pwNext.value } }), 'Wachtwoord gewijzigd.');
  pwCurrent.value = ''; pwNext.value = '';
}
const deleteConfirm = ref('');
const deletePw = ref('');
async function deleteWs() {
  if (!confirm('Laatste controle: alles in deze werkruimte wordt definitief verwijderd.')) return;
  try { await api('/api/workspace', { method: 'DELETE', body: { confirm: deleteConfirm.value } }); window.location.assign('/'); }
  catch (e) { toast.error((e as Error).message); }
}
async function deleteMe() {
  if (!confirm('Je account definitief verwijderen?')) return;
  try { await api('/api/auth/account', { method: 'DELETE', body: { password: deletePw.value } }); window.location.assign('/login'); }
  catch (e) { toast.error((e as Error).message); }
}
async function loadOutbox() {
  try { outbox.value = (await api<{ items: { id: string; to: string; subject: string; text: string; createdAt: string }[] }>('/api/admin/outbox')).items; }
  catch (e) { toast.error((e as Error).message); }
}
</script>

<style scoped>
.tab { height: 2.75rem; padding: 0 0.75rem; font-size: var(--text-sm); color: var(--color-graphite); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.tab:hover { color: var(--color-ink); }
.tab[aria-current='page'] { color: var(--color-ink); border-bottom-color: var(--color-cyan); }
</style>
