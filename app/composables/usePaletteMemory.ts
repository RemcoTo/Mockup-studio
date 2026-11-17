// Merkkleuren per project onthouden in deze browser, zodat je ze in Nieuwe mockup en Brand Shoot niet elke keer
// opnieuw invult. Alleen een gemak: zonder opslag (privévenster, geblokkeerd) werkt alles gewoon zonder.
import { normalizeHex } from '~~/shared/color';
import { COLOR_ROLE_IDS, PALETTE_MAX, scenePalette, type ScenePalette } from '~~/shared/palette';

const key = (projectId: string) => `ms.palette.${projectId}`;
/** Sleutel van vóór het palet: één merkkleur per project. */
const oldKey = (projectId: string) => `ms.brandColor.${projectId}`;

function clean(raw: unknown): ScenePalette | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ScenePalette).colors)) return null;
  const p = raw as ScenePalette;
  const colors = p.colors
    .map((c) => ({ hex: normalizeHex(c?.hex), role: c?.role }))
    .filter((c): c is { hex: string; role: ScenePalette['colors'][number]['role'] } => !!c.hex && COLOR_ROLE_IDS.includes(c.role as never))
    .slice(0, PALETTE_MAX);
  const dir = p.gradient?.direction;
  const bg = p.background === 'ai' || p.background === 'exact' ? p.background : undefined;
  return { colors, ...(dir && ['vertical', 'horizontal', 'diagonal', 'radial'].includes(dir) ? { gradient: { direction: dir } } : {}), ...(bg ? { background: bg } : {}) };
}

export function recallPalette(projectId: string | null | undefined): ScenePalette | null {
  if (!projectId) return null;
  try {
    const v = localStorage.getItem(key(projectId));
    if (v) return clean(JSON.parse(v));
    const old = localStorage.getItem(oldKey(projectId));
    return old ? scenePalette({ brandColor: old }) : null;
  } catch { return null; }
}

export function rememberPalette(projectId: string | null | undefined, palette: ScenePalette) {
  if (!projectId) return;
  try {
    if (palette.colors.length) localStorage.setItem(key(projectId), JSON.stringify(palette));
    else localStorage.removeItem(key(projectId));
    localStorage.removeItem(oldKey(projectId));
  } catch { /* geen opslag in deze browser */ }
}
