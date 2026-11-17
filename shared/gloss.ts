// Synthetische schermglans. Dezelfde formule als de CSS-gradient in de live preview,
// zodat wat je in de editor ziet overeenkomt met de export.

export const GLOSS_ANGLE = 115;
export const GLOSS_STOPS = { start: 0.18, peak: 0.36, end: 0.58 } as const;

/** Glansintensiteit (0..1, vóór vermenigvuldiging met de glans-instelling) op punt (x, y) in een vlak van w x h. */
export function glossAt(x: number, y: number, w: number, h: number): number {
  const a = (GLOSS_ANGLE * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const t = ((x - w / 2) * dx + (y - h / 2) * dy) / len + 0.5;
  const { start, peak, end } = GLOSS_STOPS;
  if (t <= start || t >= end) return 0;
  return t < peak ? (t - start) / (peak - start) : (end - t) / (end - peak);
}

/** CSS-gradient met dezelfde stops, voor de preview. */
export function glossCss(strength: number): string {
  const { start, peak, end } = GLOSS_STOPS;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return `linear-gradient(${GLOSS_ANGLE}deg, rgba(255,255,255,0) ${pct(start)}, rgba(255,255,255,${strength.toFixed(3)}) ${pct(peak)}, rgba(255,255,255,0) ${pct(end)})`;
}
