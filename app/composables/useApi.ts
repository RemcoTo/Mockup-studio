// Dunne laag rond fetch: geeft fouten terug als leesbare Nederlandse melding.
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

function messageOf(e: unknown): { message: string; status: number; code?: string } {
  const err = e as { data?: { data?: { message?: string; code?: string }; message?: string }; statusCode?: number; status?: number; message?: string };
  const status = err.statusCode ?? err.status ?? 0;
  const message = err.data?.data?.message ?? err.data?.message ?? (status === 0 ? 'De server is niet bereikbaar. Controleer of de applicatie draait.' : 'Er ging iets mis. Probeer het opnieuw.');
  return { message, status, code: err.data?.data?.code };
}

export async function api<T>(url: string, opts: Parameters<typeof $fetch>[1] = {}): Promise<T> {
  try {
    return (await $fetch(url, opts as never)) as T;
  } catch (e) {
    const m = messageOf(e);
    // Sessie verlopen: terug naar inloggen, daarna verder waar je was.
    if (m.status === 401 && import.meta.client && !url.startsWith('/api/auth/')) {
      const route = useRoute();
      if (!PUBLIC_PREFIXES.some((p) => route.path.startsWith(p))) await navigateTo(`/login?next=${encodeURIComponent(route.fullPath)}`);
    }
    throw new ApiError(m.message, m.status, m.code);
  }
}

/** Pagina's die zonder account bereikbaar zijn. */
export const PUBLIC_PREFIXES = ['/login', '/registreren', '/wachtwoord', '/account/bevestigen', '/uitnodiging', '/p/'];

export async function downloadPost(url: string, body: unknown, filename: string) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data?.data?.message ?? data?.message ?? 'Downloaden is mislukt.', res.status);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
