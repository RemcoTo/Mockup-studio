// Kleurhulpen die server en browser allebei gebruiken: HEX lezen, een kleur in woorden beschrijven
// voor de beeldprompt, en bepalen of een kleur botst met het groene vlak dat de studio zoekt.

export type RGB = [number, number, number];

/** '#1e2a4a', '1E2A4A' of '#abc' → [r, g, b]; null bij een ongeldige waarde. */
export function parseHex(input: string | null | undefined): RGB | null {
  if (!input) return null;
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Altijd '#rrggbb' in kleine letters, of null. */
export function normalizeHex(input: string | null | undefined): string | null {
  const c = parseHex(input);
  return c ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : null;
}

export function rgbToHsl([r, g, b]: RGB): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Mate van "chroma-groen" van een pixel, 0..1, op basis van tint, verzadiging en helderheid.
 * Ruim genoeg voor groen dat naar geel of blauwgroen neigt en voor donkergroen in de schaduw.
 * Dezelfde maat waarmee de vlakdetectie het groene ontwerpvlak zoekt.
 */
export function greenness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  if (g < max || max < 30) return 0;
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 12) return 0;
  const sat = delta / max;
  const hue = 60 * ((b - r) / delta) + 120; // 60 = geel, 120 = groen, 180 = cyaan
  const hueScore = hue < 65 || hue > 172 ? 0 : hue < 85 ? (hue - 65) / 20 : hue > 152 ? (172 - hue) / 20 : 1;
  const satScore = Math.min(1, Math.max(0, (sat - 0.22) / 0.23));
  const valScore = Math.min(1, Math.max(0, (max - 30) / 40));
  return Math.min(hueScore, satScore, valScore);
}

/**
 * Zou deze kleur in een scène (ook belicht of in de schaduw) voor het groene ontwerpvlak aangezien kunnen
 * worden? Dan kan de studio het vlak niet betrouwbaar vinden.
 */
export function isChromaLike(hex: string | null | undefined): boolean {
  const c = parseHex(hex);
  if (!c) return false;
  return [1, 0.75, 0.55].some((f) => greenness(c[0] * f, c[1] * f, c[2] * f) > 0.15);
}

const HUES: [number, string][] = [
  [12, 'red'], [35, 'orange'], [50, 'amber'], [66, 'yellow'], [85, 'yellow-green'], [150, 'green'], [175, 'teal'],
  [195, 'cyan'], [235, 'blue'], [260, 'indigo'], [285, 'violet'], [320, 'magenta'], [345, 'pink'], [360, 'red'],
];

/** Kleur in Engelse woorden voor de beeldprompt, bijvoorbeeld 'a deep, muted blue'. Modellen volgen woorden beter dan HEX. */
export function describeColor(hex: string): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const { h, s, l } = rgbToHsl(c);
  if (s < 0.1 || (l > 0.93 && s < 0.4) || l < 0.07) {
    const warm = c[0] > c[2] + 6 ? 'warm ' : c[2] > c[0] + 6 ? 'cool ' : '';
    if (l > 0.94) return `a ${warm}white`;
    if (l > 0.82) return `a ${warm}off-white`;
    if (l > 0.6) return `a light ${warm}grey`;
    if (l > 0.35) return `a mid ${warm}grey`;
    if (l > 0.12) return `a dark ${warm}charcoal grey`;
    return 'an almost black';
  }
  let name = HUES.find(([max]) => h < max)![1];
  // Bruin is donker oranje; beige is licht oranje met weinig verzadiging.
  if ((name === 'orange' || name === 'amber' || name === 'red') && l < 0.42 && s < 0.75) name = 'brown';
  if ((name === 'orange' || name === 'amber' || name === 'yellow') && l > 0.7 && s < 0.6) name = 'beige';
  const light = l < 0.22 ? 'very dark' : l < 0.38 ? 'deep' : l > 0.85 ? 'very pale' : l > 0.7 ? 'light' : '';
  const sat = s < 0.3 ? 'greyish' : s < 0.55 ? 'muted' : s > 0.85 && l > 0.3 && l < 0.7 ? 'vivid' : '';
  const words = [light, sat].filter(Boolean).join(', ');
  return `a ${words ? `${words} ` : ''}${name}`;
}

/** Lineair mengen van twee kleuren (t = 0..1). */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
