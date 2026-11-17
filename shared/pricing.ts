// Indicatieve kosten van beeldgeneratie en de vertaling naar credits.
// Bron en datum staan erbij; controleer bij twijfel https://openai.com/api/pricing.

export const PRICE_SOURCE = {
  label: 'aifreeapi.com, prijzen gecontroleerd op 6 september 2026 (OpenAI-documentatie verwijst naar de prijscalculator)',
  url: 'https://www.aifreeapi.com/en/posts/openai-image-generation-api-pricing',
};

type Quality = 'low' | 'medium' | 'high';
/** USD per beeld, per model, kwaliteit en formaat, zoals gepubliceerd. */
export const PRICE_TABLE: Record<string, Record<Quality, Record<string, number>>> = {
  'gpt-image-2': {
    low: { '1024x1024': 0.006, '1024x1536': 0.005, '1536x1024': 0.005 },
    medium: { '1024x1024': 0.053, '1024x1536': 0.041, '1536x1024': 0.041 },
    high: { '1024x1024': 0.211, '1024x1536': 0.165, '1536x1024': 0.165 },
  },
  'gpt-image-1.5': {
    low: { '1024x1024': 0.009, '1024x1536': 0.013, '1536x1024': 0.013 },
    medium: { '1024x1024': 0.034, '1024x1536': 0.05, '1536x1024': 0.05 },
    high: { '1024x1024': 0.133, '1024x1536': 0.2, '1536x1024': 0.2 },
  },
};

export interface CostEstimate {
  usd: number;
  /** true als het formaat letterlijk in de prijstabel staat; anders geschat vanaf het dichtstbijzijnde formaat. */
  exact: boolean;
}

/**
 * Kosten voor `count` beelden. Formaten buiten de tabel worden geschat vanaf het formaat met de meest
 * vergelijkbare verhouding, naar rato van het aantal pixels. Geeft null als het model onbekend is.
 */
export function estimateCost(model: string, quality: Quality, width: number, height: number, count: number): CostEstimate | null {
  const table = PRICE_TABLE[model]?.[quality];
  if (!table) return null;
  const key = `${width}x${height}`;
  if (table[key] !== undefined) return { usd: round(table[key]! * count), exact: true };
  const ratio = width / height;
  let best = '', bestDiff = Infinity;
  for (const k of Object.keys(table)) {
    const [w, h] = k.split('x').map(Number) as [number, number];
    const d = Math.abs(Math.log(w / h) - Math.log(ratio));
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  const [bw, bh] = best.split('x').map(Number) as [number, number];
  return { usd: round(table[best]! * ((width * height) / (bw * bh)) * count), exact: false };
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Credits per beeld. Voorspelbaar voor de gebruiker: alleen kwaliteit en grootte tellen.
 * Grootte: tot 2,5 megapixel ×1, tot 5 megapixel ×2, daarboven ×4.
 */
export const CREDITS_PER_IMAGE: Record<Quality, number> = { low: 1, medium: 5, high: 20 };
export function creditsFor(quality: Quality, width: number, height: number, count: number): number {
  const mp = (width * height) / 1_000_000;
  const factor = mp <= 2.5 ? 1 : mp <= 5 ? 2 : 4;
  return CREDITS_PER_IMAGE[quality] * factor * count;
}
