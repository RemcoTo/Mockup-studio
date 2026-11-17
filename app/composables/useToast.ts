export interface Toast { id: number; text: string; tone: 'info' | 'error'; link?: { to: string; label: string } }
const toasts = ref<Toast[]>([]);
let n = 0;

/** Meldingen over planlimieten of te weinig credits krijgen een link naar de abonnementspagina. */
function linkFor(text: string): Toast['link'] {
  return /abonnement|credits|vanaf het \w+-abonnement/i.test(text) ? { to: '/abonnement', label: 'Abonnementen bekijken' } : undefined;
}

export function useToast() {
  function push(text: string, tone: Toast['tone'] = 'info', ms = 4200, link?: Toast['link']) {
    const id = ++n;
    toasts.value.push({ id, text, tone, link });
    setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), ms);
  }
  return {
    toasts,
    info: (t: string) => push(t, 'info'),
    error: (t: string) => { const link = linkFor(t); push(t, 'error', link ? 10000 : 7000, link); },
  };
}
