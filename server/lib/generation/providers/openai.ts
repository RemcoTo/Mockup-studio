// OpenAI Images API. Zonder referentiebeelden: /images/generations, met referenties: /images/edits.
import { AppError } from '../../errors';
import { getConfig } from '../../config';
import type { GenerateRequest, ImageProvider } from './types';

interface OpenAIImageResponse { data?: { b64_json?: string }[]; error?: { message?: string; code?: string; type?: string } }

function explain(status: number, body: OpenAIImageResponse): AppError {
  const msg = body.error?.message ?? '';
  const code = body.error?.code ?? '';
  if (status === 401) return new AppError(502, 'De OpenAI-sleutel is ongeldig of ingetrokken. Controleer NUXT_OPENAI_API_KEY.', 'provider_auth', msg);
  if (status === 403) return new AppError(502, 'Deze OpenAI-sleutel heeft geen toegang tot het beeldmodel. Mogelijk moet de organisatie eerst geverifieerd worden.', 'provider_forbidden', msg);
  if (status === 429) {
    if (code === 'insufficient_quota' || /quota|billing/i.test(msg)) return new AppError(502, 'Het OpenAI-tegoed is op of de limiet is bereikt. Vul het tegoed aan of verhoog de limiet.', 'provider_quota', msg);
    return new AppError(503, 'OpenAI krijgt nu te veel verzoeken. Probeer het over een minuut opnieuw.', 'provider_rate', msg);
  }
  if (status === 400 && /safety|moderation|content policy/i.test(msg)) return new AppError(422, 'OpenAI heeft deze prompt geweigerd op basis van het inhoudsbeleid. Pas de instructies aan.', 'provider_refused', msg);
  if (status === 400) return new AppError(422, `OpenAI accepteerde het verzoek niet: ${msg || 'onbekende parameter'}.`, 'provider_bad_request', msg);
  return new AppError(502, `OpenAI gaf een fout (${status}). Er is geen beeld gemaakt.`, 'provider_error', msg);
}

export function openAIProvider(): ImageProvider {
  return {
    info() {
      const c = getConfig();
      return {
        id: 'openai',
        label: 'OpenAI',
        model: c.openaiImageModel,
        configured: !!c.openaiApiKey,
        problem: c.openaiApiKey ? null : 'Er is geen OpenAI-sleutel ingesteld. Zet NUXT_OPENAI_API_KEY in het .env-bestand en start de server opnieuw.',
        maxCount: 4,
        supportsReferences: true,
        isAi: true,
      };
    },
    async generate(req: GenerateRequest) {
      const c = getConfig();
      if (!c.openaiApiKey) throw new AppError(503, 'Er is geen OpenAI-sleutel ingesteld.', 'provider_not_configured');
      const size = `${req.width}x${req.height}`;
      const headers = { Authorization: `Bearer ${c.openaiApiKey}` };
      let res: Response;
      try {
        if (req.references.length) {
          const form = new FormData();
          form.set('model', c.openaiImageModel);
          form.set('prompt', req.prompt);
          form.set('size', size);
          form.set('quality', req.quality);
          form.set('n', String(req.count));
          for (const r of req.references) form.append('image[]', new Blob([new Uint8Array(r.data)], { type: r.mime }), r.name);
          res = await fetch(`${c.openaiBaseUrl}/images/edits`, { method: 'POST', headers, body: form, signal: req.signal });
        } else {
          res = await fetch(`${c.openaiBaseUrl}/images/generations`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: c.openaiImageModel, prompt: req.prompt, size, quality: req.quality, n: req.count, output_format: 'png' }),
            signal: req.signal,
          });
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw new AppError(504, 'De generatie duurde te lang en is afgebroken.', 'provider_timeout');
        throw new AppError(502, 'OpenAI is niet bereikbaar. Controleer de internetverbinding van de server.', 'provider_unreachable', String(e));
      }
      const body = (await res.json().catch(() => ({}))) as OpenAIImageResponse;
      if (!res.ok) throw explain(res.status, body);
      const images = (body.data ?? []).map((d) => d.b64_json).filter((b): b is string => !!b).map((b) => Buffer.from(b, 'base64'));
      if (!images.length) throw new AppError(502, 'OpenAI gaf een antwoord zonder beeld. Er is niets opgeslagen.', 'provider_empty');
      return images;
    },
  };
}
