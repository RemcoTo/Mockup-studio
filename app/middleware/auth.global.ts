// Alles achter een account, behalve de publieke pagina's. Zonder werkruimte naar de keuze daarvoor.
import { PUBLIC_PREFIXES } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PREFIXES.some((p) => to.path.startsWith(p))) return;
  const { ensure } = useSession();
  let s;
  try {
    s = await ensure();
  } catch {
    return; // Server onbereikbaar: de pagina toont zelf de fout.
  }
  if (!s.user) return navigateTo(`/${s.site.firstUser ? 'registreren' : 'login'}?next=${encodeURIComponent(to.fullPath)}`);
  if (!s.workspace && to.path !== '/werkruimte/nieuw') return navigateTo('/werkruimte/nieuw');
});
