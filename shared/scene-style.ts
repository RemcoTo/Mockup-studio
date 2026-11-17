// Presentatie van een AI-scène: scènetype, props, ondergrond, platte achtergrond en snelle presets.
// De kleuren staan in shared/palette. Configurator, promptopbouw, validatie en testscènes lezen uit deze lijsten.
import type { Option } from './catalog';
import type { SceneConfig } from './types';
import { isChromaLike, parseHex } from './color';
import { backdropFromPalette, backdropStops, colorsFor, sceneBackdrop, scenePalette } from './palette';
import { deviceSpecFor } from './device3d/spec';

export const SCENE_TYPES: (Option & { hint: string })[] = [
  { id: 'studio', label: 'Studio', hint: 'Naadloze achtergrond, gecontroleerd licht', prompt: 'Setting: a professional photo studio with a seamless paper sweep backdrop and controlled studio light.' },
  { id: 'interior', label: 'Interieur', hint: 'Een echte, opgeruimde ruimte', prompt: 'Setting: a real, tidy contemporary interior with natural materials and daylight, photographed on location; the room stays calm and slightly out of focus behind the product.' },
  { id: 'minimal', label: 'Minimalistisch', hint: 'Een of twee kleurvlakken, veel rust', prompt: 'Setting: an extremely minimal, quiet set built from one or two planes of color, with lots of empty space and nothing that competes with the product.' },
  { id: 'editorial', label: 'Editorial', hint: 'Sfeer zoals in een magazine', prompt: 'Setting: an art-directed editorial set with a considered mood, refined styling and a cinematic, magazine-like feel.' },
  { id: 'product', label: 'Productfotografie', hint: 'Strak tafelblad, alle aandacht op het product', prompt: 'Setting: a clean commercial product photography tabletop setup; every choice serves the product.' },
  { id: 'abstract', label: 'Abstract', hint: 'Sculpturale vormen, sokkels en bogen', prompt: 'Setting: an abstract set of simple sculptural geometric forms such as plinths, arches, steps and spheres in matte materials.' },
];

export const PROPS: (Option & { hint: string })[] = [
  { id: 'none', label: 'Geen', hint: 'Alleen het product', prompt: 'No props or decorative objects at all: only the product and the surface it stands on.' },
  { id: 'minimal', label: 'Minimaal', hint: 'Hooguit één of twee kleine', prompt: 'At most one or two small, understated props placed well away from the product so they never draw attention.' },
  { id: 'brand', label: 'Passend bij het merk', hint: 'Een paar gekozen objecten', prompt: 'A few carefully chosen props that fit the world of the brand and support its story, placed so they never cover or touch the product.' },
];

export const GROUNDS: Option[] = [
  { id: 'oak', label: 'Licht eiken', prompt: 'a light oak wooden surface' },
  { id: 'walnut', label: 'Donker notenhout', prompt: 'a dark walnut wooden surface' },
  { id: 'marble', label: 'Marmer', prompt: 'a white marble surface with soft grey veining' },
  { id: 'travertine', label: 'Travertin', prompt: 'a warm beige travertine stone surface' },
  { id: 'concrete', label: 'Beton', prompt: 'a smooth light grey concrete surface' },
  { id: 'terrazzo', label: 'Terrazzo', prompt: 'a pale terrazzo surface with small, muted stone chips' },
  { id: 'linen', label: 'Linnen', prompt: 'a natural linen cloth' },
  { id: 'paper', label: 'Papier', prompt: 'a sheet of thick matte paper' },
  { id: 'metal', label: 'Geborsteld metaal', prompt: 'a brushed aluminium surface' },
];

/** Sleutelkleur waarmee het model een platte achtergrond rendert; de studio vervangt hem door de gekozen kleur. */
export const BACKDROP_KEY = '#FF00FF';

export type BackdropMode = 'solid' | 'gradient';
export type BackdropDirection = 'vertical' | 'horizontal' | 'diagonal' | 'radial';
export type BackdropTexture = 'none' | 'grain' | 'paper';
export type BackdropShadow = 'soft' | 'hard' | 'none';

/** Platte achtergrond in plaats van een ruimte: effen of verloop, met optioneel textuur en schaduw. */
export interface Backdrop {
  mode: BackdropMode;
  color: string;
  color2?: string;
  /** Alle kleuren van het verloop in volgorde (twee of meer); color en color2 zijn dan de eerste en laatste. */
  stops?: string[];
  /**
   * Waarover het verloop loopt: het hele beeld (platte achtergrond, standaard) of alleen het deel dat
   * achtergrond is (exacte achtergrond in een scène, waar de ondergrond het onderste deel vult).
   */
  extent?: 'frame' | 'region';
  direction?: BackdropDirection;
  texture?: BackdropTexture;
  shadow?: BackdropShadow;
}

export const BACKDROP_DIRECTIONS: { id: BackdropDirection; label: string }[] = [
  { id: 'vertical', label: 'Van boven naar onder' },
  { id: 'horizontal', label: 'Van links naar rechts' },
  { id: 'diagonal', label: 'Diagonaal' },
  { id: 'radial', label: 'Vanuit het midden' },
];
export const BACKDROP_TEXTURES: { id: BackdropTexture; label: string }[] = [
  { id: 'none', label: 'Geen' },
  { id: 'grain', label: 'Fijne korrel' },
  { id: 'paper', label: 'Papier' },
];
export const BACKDROP_SHADOWS: { id: BackdropShadow; label: string; prompt: string }[] = [
  { id: 'soft', label: 'Zacht', prompt: 'a soft, natural contact shadow under the product' },
  { id: 'hard', label: 'Scherp', prompt: 'a crisp, defined shadow cast by a single hard light' },
  { id: 'none', label: 'Geen', prompt: 'almost no visible shadow, as if lit evenly from all sides' },
];

/** Een complete look in één klik; de gebruiker kan daarna alles verfijnen. */
export interface ScenePreset {
  id: string;
  label: string;
  hint: string;
  /** Kleuren voor het voorbeeldvlakje in de interface. */
  swatch: [string, string];
  config: Partial<SceneConfig>;
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'calm-studio', label: 'Rustige studio', hint: 'Zacht licht, naadloze achtergrond', swatch: ['#efebe5', '#d9d2c8'],
    config: { sceneType: 'studio', props: 'none', ground: undefined, lighting: 'soft', shadows: 'soft', angle: 'front', negativeSpace: 'lots', style: 'minimal', backdrop: null },
  },
  {
    id: 'warm-interior', label: 'Warm interieur', hint: 'Daglicht, hout, een paar props', swatch: ['#d8c3a5', '#8c6d4f'],
    config: { sceneType: 'interior', props: 'minimal', ground: 'oak', lighting: 'daylight', shadows: 'soft', angle: 'three-quarter', style: 'editorial', backdrop: null },
  },
  {
    id: 'editorial-stone', label: 'Editorial op steen', hint: 'Hard zonlicht, travertin', swatch: ['#e6d9c6', '#a8916f'],
    config: { sceneType: 'editorial', props: 'minimal', ground: 'travertine', lighting: 'sun', shadows: 'hard', angle: 'three-quarter', style: 'editorial', backdrop: null },
  },
  {
    id: 'product-white', label: 'Productfoto', hint: 'Strak, licht, alles op het product', swatch: ['#ffffff', '#e4e4e2'],
    config: { sceneType: 'product', props: 'none', ground: 'paper', lighting: 'soft', shadows: 'soft', angle: 'front', style: 'product', backdrop: null },
  },
  {
    id: 'brand-set', label: 'In merkkleuren', hint: 'Rustige set waarin je kleuren het beeld bepalen', swatch: ['#2f3b33', '#b4644a'],
    config: { sceneType: 'minimal', props: 'brand', lighting: 'soft', shadows: 'soft', angle: 'three-quarter', style: 'campaign', backdrop: null },
  },
  {
    id: 'abstract-forms', label: 'Abstracte vormen', hint: 'Sokkels en bogen, matte materialen', swatch: ['#d9d4ea', '#9f97c2'],
    config: { sceneType: 'abstract', props: 'none', lighting: 'soft', shadows: 'soft', angle: 'front', symmetry: 'symmetric', style: 'campaign', backdrop: null },
  },
  {
    id: 'flat-color', label: 'Effen vlak', hint: 'Platte achtergrond in één kleur', swatch: ['#e8e2d9', '#e8e2d9'],
    config: { sceneType: undefined, props: 'none', ground: undefined, lighting: 'soft', angle: 'front', style: 'minimal', backdrop: { mode: 'solid', color: '#e8e2d9', texture: 'none', shadow: 'soft' } },
  },
  {
    id: 'flat-gradient', label: 'Verloop', hint: 'Platte achtergrond met een zacht verloop', swatch: ['#f1ece4', '#c9d3dd'],
    config: { sceneType: undefined, props: 'none', ground: undefined, lighting: 'soft', angle: 'front', style: 'minimal', backdrop: { mode: 'gradient', color: '#f1ece4', color2: '#c9d3dd', direction: 'vertical', texture: 'grain', shadow: 'soft' } },
  },
];

/** Is de preset (nog) actief in deze configuratie? */
export function presetMatches(p: ScenePreset, cfg: SceneConfig): boolean {
  return Object.entries(p.config).every(([k, v]) => {
    const cur = (cfg as unknown as Record<string, unknown>)[k];
    if (k === 'backdrop') return !v ? !cur : !!cur && (cur as { mode: string }).mode === (v as { mode: string }).mode;
    if (Array.isArray(v)) return Array.isArray(cur) && v.join() === (cur as unknown[]).join();
    return (cur ?? undefined) === (v ?? undefined);
  });
}

/** Mate van sleutelmagenta, 0..1 (rood en blauw allebei ver boven groen). Zelfde formule als bij het vervangen. */
export function keyness(r: number, g: number, b: number): number {
  const mx = Math.max(r, b);
  if (mx < 24) return 0;
  const m = Math.min(r, b) - g;
  if (m <= 0) return 0;
  const balance = Math.min(r, b) / mx;
  return Math.min(1, (m / mx) * Math.min(1, balance / 0.6));
}
/** Vanaf deze sleutelwaarde kan de studio een kleur voor achtergrond aanzien (zelfde drempel als bij het vervangen). */
export const KEY_LOW = 0.22;

/**
 * Welke kleur zou de studio bij een exacte achtergrond in een scène voor het magenta sleutelscherm aanzien?
 * Geldt voor de kleuren die de AI in de scène zet (ondergrond, objecten, accent, licht).
 */
export function keyConflict(cfg: Pick<SceneConfig, 'palette' | 'backdrop'> & { brandColor?: string; brandColorUse?: string[] }): string | null {
  if (!sceneBackdrop(cfg)) return null;
  const p = scenePalette(cfg);
  const hexes = (['ground', 'props', 'accent', 'light'] as const).flatMap((r) => colorsFor(p, r));
  return hexes.find((h) => { const c = parseHex(h); return !!c && keyness(c[0], c[1], c[2]) >= KEY_LOW; }) ?? null;
}

/**
 * Welke gekozen kleur zou de studio voor het groene ontwerpvlak kunnen aanzien? Bij een scène telt elke
 * kleur van het palet (ook gekleurd licht), bij een platte achtergrond alleen de achtergrond.
 * Alleen relevant als het vlak automatisch wordt gezocht. Zelfde controle in de interface en op de server.
 */
export function chromaConflict(cfg: Pick<SceneConfig, 'surfaceMethod' | 'backdrop' | 'palette'> & { objectType?: string; device3d?: SceneConfig['device3d']; brandColor?: string; brandColorUse?: string[] }): string | null {
  if (cfg.surfaceMethod !== 'chroma') return null;
  // Een 3D-device brengt zijn eigen scherm en masker mee: de studio zoekt geen groen vlak, dus groen botst niet.
  if (cfg.objectType && deviceSpecFor({ objectType: cfg.objectType, device3d: cfg.device3d })) return null;
  const palette = scenePalette(cfg);
  const flat = cfg.backdrop && (cfg.backdrop.mode === 'solid' || cfg.backdrop.mode === 'gradient') ? backdropFromPalette(palette, cfg.backdrop) : null;
  const colors = flat ? backdropStops(flat) : palette.colors.map((c) => c.hex);
  return colors.find((c) => !!c && isChromaLike(c)) ?? null;
}
