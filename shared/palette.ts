// Kleurenpalet van een AI-scène: meerdere merkkleuren, elk met een eigen toepassing in de omgeving
// (ondergrond, achtergrond, gradient, objecten, accent, verlichting). Configurator, Brand Shoot, promptopbouw,
// platte achtergrond, validatie en testscènes lezen allemaal uit dit bestand.
//
// Uitbreiden: voeg een rol toe aan COLOR_ROLES (label, uitleg, of hij bij een platte achtergrond telt) en
// beschrijf in roleLine() hoe het model hem toepast. Validatie en interface volgen de lijst vanzelf.
//
// De kleuren zijn er alleen voor de scène. Het ontwerp gaat nooit naar het model en wordt na het genereren
// pixel-exact geplaatst; het licht op het vlak gaat er alleen als helderheid overheen, niet als kleur.
import { describeColor, normalizeHex, parseHex } from './color';
import type { Backdrop, BackdropDirection } from './scene-style';
import type { SceneConfig } from './types';

export type ColorRole = 'ground' | 'background' | 'gradient' | 'props' | 'accent' | 'light';

export interface PaletteColor {
  /** '#rrggbb' */
  hex: string;
  role: ColorRole;
}

/**
 * Hoe de achtergrond in een scène zijn kleur krijgt:
 * - exact: het model maakt de achtergrond als magenta sleutelscherm en de studio zet je kleur (of gradient)
 *   er achteraf pixel voor pixel in, met dezelfde techniek als de platte achtergrond;
 * - ai: het model schildert de achtergrond zelf, met de kleur als harde instructie.
 * Afwezig = exact. Instellingen van vóór deze keuze (één merkkleur) worden 'ai', zoals ze toen werkten.
 */
export type BackgroundMode = 'exact' | 'ai';

export interface ScenePalette {
  /** In volgorde; de volgorde van de gradientkleuren is de volgorde van het verloop. */
  colors: PaletteColor[];
  gradient?: { direction: BackdropDirection };
  background?: BackgroundMode;
}

export const BACKGROUND_MODES: { id: BackgroundMode; label: string; hint: string }[] = [
  { id: 'exact', label: 'Exact', hint: 'De studio zet je kleur achteraf pixel voor pixel op de achtergrond: effen, zonder lichtval of kleurzweem. Ondergrond, objecten en licht maakt de AI.' },
  { id: 'ai', label: 'Door de AI', hint: 'De AI maakt de achtergrond mee in de scène, met je kleur als harde instructie en natuurlijke lichtval. Daardoor kan hij iets afwijken.' },
];
export const backgroundMode = (p: ScenePalette | null | undefined): BackgroundMode => p?.background ?? 'exact';

export interface ColorRoleDef {
  id: ColorRole;
  label: string;
  hint: string;
  /** Telt deze rol bij een platte achtergrond? Daar maakt de studio alleen de achtergrond exact. */
  flat: boolean;
}

export const COLOR_ROLES: ColorRoleDef[] = [
  { id: 'ground', label: 'Ondergrond', hint: 'De tafel, vloer of het oppervlak waarop het product staat', flat: false },
  { id: 'background', label: 'Achtergrond', hint: 'De achtergrond van de hele scène', flat: true },
  { id: 'gradient', label: 'Gradient', hint: 'Kleurverloop over de achtergrond, samen met je andere gradientkleuren', flat: true },
  { id: 'props', label: 'Objecten', hint: 'Decoratieve objecten en elementen in de scène', flat: false },
  { id: 'accent', label: 'Accentkleur', hint: 'Subtiele kleuraccenten in de omgeving', flat: false },
  { id: 'light', label: 'Verlichting', hint: 'Gekleurde lichtreflecties of sfeerverlichting', flat: false },
];
export const COLOR_ROLE_IDS = COLOR_ROLES.map((r) => r.id) as [ColorRole, ...ColorRole[]];
export const PALETTE_MAX = 12;

export function emptyPalette(): ScenePalette {
  return { colors: [] };
}

export const colorsFor = (p: ScenePalette | null | undefined, role: ColorRole): string[] => (p?.colors ?? []).filter((c) => c.role === role).map((c) => c.hex);

/** Volgende logische rol voor een nieuwe kleur: eerst wat nog ontbreekt, in de volgorde van de lijst. */
export function nextRole(p: ScenePalette): ColorRole {
  const used = new Set(p.colors.map((c) => c.role));
  return (['background', 'ground', 'accent', 'props', 'light'] as ColorRole[]).find((r) => !used.has(r)) ?? 'accent';
}

/** Oude configuraties: één merkkleur met toepassingen, en een platte achtergrond met eigen kleuren. */
type LegacyColors = { brandColor?: string; brandColorUse?: string[] };
const LEGACY_USE: Record<string, ColorRole> = { background: 'background', ground: 'ground', props: 'props', light: 'light' };
const LEGACY_DEFAULT_USES = ['background', 'props'];

/** Palet uit een configuratie, ook uit een configuratie van vóór het palet. */
export function scenePalette(cfg: Pick<SceneConfig, 'palette' | 'backdrop'> & LegacyColors): ScenePalette {
  if (cfg.palette) return cfg.palette;
  const colors: PaletteColor[] = [];
  let gradient: ScenePalette['gradient'];
  const b = cfg.backdrop;
  if (b && (b.mode === 'solid' || b.mode === 'gradient')) {
    const stops = backdropStops(b);
    if (b.mode === 'gradient' && stops.length >= 2) {
      for (const hex of stops) colors.push({ hex, role: 'gradient' });
      gradient = { direction: b.direction ?? 'vertical' };
    } else colors.push({ hex: stops[0] ?? b.color, role: 'background' });
  }
  const brand = normalizeHex(cfg.brandColor);
  if (brand) {
    const uses = cfg.brandColorUse?.length ? cfg.brandColorUse : LEGACY_DEFAULT_USES;
    for (const u of uses) {
      const role = LEGACY_USE[u];
      // Bij een platte achtergrond telde de merkkleur niet mee; de achtergrond komt dan van de achtergrond zelf.
      if (role && !(role === 'background' && colors.some((c) => c.role === 'background' || c.role === 'gradient'))) colors.push({ hex: brand, role });
    }
  }
  const out: ScenePalette = gradient ? { colors, gradient } : { colors };
  // Een oude merkkleur ging als beschrijving naar de AI; zo blijft hij werken.
  if (brand) out.background = 'ai';
  return out;
}

/** Kleuren van een platte achtergrond in volgorde: meerdere stops, of de eerste en tweede kleur. */
export function backdropStops(b: Backdrop): string[] {
  if (b.mode === 'gradient') {
    if (b.stops && b.stops.length >= 2) return b.stops;
    return [b.color, b.color2 ?? b.color];
  }
  return [b.color];
}

/** De platte achtergrond volgt het palet: een gradient als die er is, anders de achtergrondkleur. */
export function backdropFromPalette(p: ScenePalette, current: Backdrop): Backdrop {
  const grad = colorsFor(p, 'gradient');
  const bg = colorsFor(p, 'background');
  if (grad.length >= 2) return { ...current, mode: 'gradient', color: grad[0]!, color2: grad[grad.length - 1]!, stops: grad, direction: p.gradient?.direction ?? current.direction ?? 'vertical' };
  if (bg.length) {
    const { color2: _c2, stops: _s, ...rest } = current;
    return { ...rest, mode: 'solid', color: bg[0]! };
  }
  return current;
}

/**
 * Eén vorm voor alle kleurinstellingen: oude velden omgezet naar het palet, en de platte achtergrond
 * afgeleid van het palet. Idempotent; server en browser gebruiken dezelfde functie.
 */
export function normalizeSceneColors<T extends SceneConfig>(cfg: T): T {
  const legacy = cfg as T & LegacyColors;
  const palette = scenePalette(legacy);
  const { brandColor: _b, brandColorUse: _u, ...rest } = legacy;
  const out = { ...rest, palette } as unknown as T;
  if (out.backdrop) out.backdrop = backdropFromPalette(palette, out.backdrop);
  return out;
}

/**
 * Achtergrond die de studio na het genereren exact zet, bij een scène met Exact (niet bij een platte achtergrond:
 * die heeft zijn eigen instellingen). Zelfde techniek als de platte achtergrond, maar effen zonder lichtval en
 * zonder textuur, en een gradient loopt over het deel van het beeld dat achtergrond is in plaats van over het hele beeld.
 */
export function sceneBackdrop(cfg: Pick<SceneConfig, 'palette' | 'backdrop'> & LegacyColors): Backdrop | null {
  if (cfg.backdrop) return null;
  const p = scenePalette(cfg);
  if (backgroundMode(p) !== 'exact') return null;
  const grad = colorsFor(p, 'gradient'), bg = colorsFor(p, 'background');
  const base = { texture: 'none' as const, shadow: 'none' as const, extent: 'region' as const };
  if (grad.length >= 2) return { ...base, mode: 'gradient', color: grad[0]!, color2: grad[grad.length - 1]!, stops: grad, direction: p.gradient?.direction ?? 'vertical' };
  if (bg.length) return { ...base, mode: 'solid', color: bg[0]! };
  return null;
}

/** Waarom deze kleurinstelling niet te genereren is, of null. Zelfde controle in de interface en op de server. */
export function paletteProblem(p: ScenePalette | null | undefined): string | null {
  const grad = colorsFor(p, 'gradient');
  if (grad.length === 1) return 'Een gradient heeft minstens twee kleuren. Geef nog een kleur de toepassing Gradient, of kies voor deze kleur een andere toepassing.';
  if (grad.length >= 2 && colorsFor(p, 'background').length) return 'De gradient vormt de achtergrond. Kies voor de achtergrond één kleur óf een gradient, niet allebei.';
  return null;
}

interface PromptOpts {
  propsNone: boolean;
  /** De achtergrond wordt een sleutelscherm dat de studio exact inkleurt. */
  exactBackground?: boolean;
  /** Recht van boven met een exacte achtergrond: alles rond het product is achtergrond, er is geen ondergrond. */
  noGround?: boolean;
}

const DIRECTION_TEXT: Record<BackdropDirection, [string, string, string]> = {
  vertical: ['running from top to bottom', 'at the top', 'at the bottom'],
  horizontal: ['running from left to right', 'on the left', 'on the right'],
  diagonal: ['running diagonally from the top-left corner to the bottom-right corner', 'in the top-left corner', 'in the bottom-right corner'],
  radial: ['radiating outward from the center behind the product', 'in the center', 'at the outer edges'],
};

const named = (hex: string) => `${describeColor(hex)} (${hex})`;
const exactly = (hex: string) => { const c = parseHex(hex)!; return `exactly ${hex} (RGB ${c.join(', ')}), ${describeColor(hex)}`; };
const HOLD_COLOR = 'lighting, color temperature, shadows, colored light and color grading must not shift its hue, saturation or brightness';
function list(hexes: string[]): string {
  const parts = hexes.map(named);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Hoe het model één rol toepast. */
function roleLine(role: ColorRole, hexes: string[], p: ScenePalette, opts: PromptOpts): string | null {
  const many = hexes.length > 1;
  switch (role) {
    case 'ground':
      return `Ground: the tabletop, floor or surface the product stands on is ${many ? `color-blocked in ${list(hexes)}` : list(hexes)}.`;
    case 'background':
      // Harde kleurinstructie: de kleur is een vaste merkkleur, geen inspiratie.
      return `Background color (a fixed brand color, not a suggestion): the background wall or backdrop behind the product is ${many ? `built from planes that are ${hexes.map(exactly).join('; and ')}` : exactly(hexes[0]!)}, filling the background of the whole scene.` +
        ` Render it as an evenly lit, matte, uniform surface without vignetting, gradient, texture or pattern, and keep its visible color as close to the given value as possible: ${HOLD_COLOR}.`;
    case 'gradient': {
      if (hexes.length < 2) return null;
      const [dir, start, end] = DIRECTION_TEXT[p.gradient?.direction ?? 'vertical'];
      const middle = hexes.slice(1, -1);
      return `Background gradient (fixed brand colors, not a suggestion): the background of the whole scene is one smooth, seamless color gradient ${dir}: ${named(hexes[0]!)} ${start}${middle.length ? `, through ${list(middle)}` : ''}, to ${named(hexes[hexes.length - 1]!)} ${end}, with soft, even transitions and no banding.` +
        ` Use exactly these colors on an evenly lit, matte surface: ${HOLD_COLOR}.`;
    }
    case 'props':
      return `Decorative objects: the decorative objects and set pieces in the scene are ${many ? `in ${list(hexes)}` : list(hexes)}.`;
    case 'accent':
      return `Accent color: use ${list(hexes)} only for a few small, subtle accents in the environment, such as a detail, a thin edge or a small object; never as a large area.`;
    case 'light':
      return opts.exactBackground
        ? `Lighting color: a soft colored glow and accent light in ${list(hexes)} on the set and the surface the product stands on, as rim or ambient light; it never falls on the background, the product or the target surface.`
        : `Lighting color: a soft colored glow and accent light in ${list(hexes)} on the background and the set, as rim or ambient light; it never falls on the product or the target surface.`;
  }
}

/**
 * Prompttekst voor het palet in een scène (niet bij een platte achtergrond: die zet de studio exact).
 * Elke kleur krijgt precies één plek; de rest van de set blijft rustig, en het product en het ontwerpvlak
 * krijgen geen van deze kleuren.
 */
export function palettePrompt(p: ScenePalette, opts: PromptOpts): string | null {
  const lines: string[] = [];
  for (const r of COLOR_ROLES) {
    if (r.id === 'props' && opts.propsNone) continue;
    // Exacte achtergrond: die zet de studio achteraf; het model maakt daar een sleutelscherm.
    if (opts.exactBackground && (r.id === 'background' || r.id === 'gradient')) continue;
    if (opts.noGround && r.id === 'ground') continue;
    const hexes = colorsFor(p, r.id);
    if (!hexes.length) continue;
    const line = roleLine(r.id, hexes, p, opts);
    if (line) lines.push(`- ${line}`);
  }
  if (!lines.length) return null;
  return [
    'Brand color palette for the set and environment. Each color has exactly one assigned role: apply it there and nowhere else, and do not swap colors between roles.',
    ...lines,
    'Keep everything else in the set neutral and calm, so these colors read as a deliberate brand palette.' +
      ' These colors are only for the environment: the product itself keeps its own colors, and none of these colors may appear on the target surface.',
  ].join('\n');
}
