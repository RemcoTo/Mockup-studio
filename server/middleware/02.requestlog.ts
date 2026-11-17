// Eén logregel per API-verzoek: methode, pad, status en duur. Bestanden en de editor-preview worden
// niet gelogd (te veel ruis); trage verzoeken altijd wel.
import { log, maskPath } from '../lib/log';

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return;
  const start = performance.now();
  const quiet = event.path.startsWith('/api/files/') || event.path.endsWith('/render') || event.path.startsWith('/api/health');
  event.node.res.once('finish', () => {
    const ms = Math.round(performance.now() - start);
    const status = event.node.res.statusCode;
    if (quiet && ms < 2000 && status < 500) return;
    // Geheime tokens in het pad (presentatielinks, uitnodigingen) komen niet in de log of in Sentry.
    const path = maskPath(event.path);
    const data = { method: event.method, path, status, ms, user: (event.context.auth as { user?: { id: string } } | null | undefined)?.user?.id };
    if (status >= 500) log.error('http.request', data);
    else if (ms > 5000) log.warn('http.slow', data);
    else log.info('http.request', data);
  });
});
