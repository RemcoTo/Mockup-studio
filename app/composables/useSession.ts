import type { Role } from '~~/shared/roles';
import { atLeast } from '~~/shared/roles';

import { api } from '~/composables/useApi';
export interface SessionState {
  user: { id: string; email: string; name: string; emailVerified: boolean; isAdmin: boolean; createdAt: string } | null;
  workspace: { id: string; name: string; plan: string; credits: number; features: import('~~/shared/plans').Feature[] } | null;
  role: Role | null;
  workspaces: { id: string; name: string; role: Role }[];
  site: { appName: string; signupOpen: boolean; firstUser: boolean; mailMode: 'smtp' | 'outbox'; creditsEnforced: boolean; emailVerification: boolean };
}

const state = ref<SessionState | null>(null);
let pending: Promise<SessionState> | null = null;

export function useSession() {
  async function refresh(): Promise<SessionState> {
    pending = api<SessionState>('/api/auth/me').then((s) => { state.value = s; return s; }).finally(() => { pending = null; });
    return pending;
  }
  async function ensure(): Promise<SessionState> {
    if (state.value) return state.value;
    return pending ?? refresh();
  }
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.value = null;
    await navigateTo('/login');
  }
  async function switchWorkspace(id: string) {
    await api(`/api/workspaces/${id}/switch`, { method: 'POST' });
    await refresh();
    // Alles opnieuw laden voor de andere werkruimte.
    window.location.assign('/');
  }
  const can = (min: Role) => atLeast(state.value?.role ?? null, min);
  /** Zit een functie in het plan van de huidige werkruimte? */
  const has = (f: import('~~/shared/plans').Feature) => !!state.value?.workspace?.features?.includes(f);
  return { state, refresh, ensure, logout, switchWorkspace, can, has };
}
