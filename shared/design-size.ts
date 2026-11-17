// Afmetingen van het ontwerp (in pixels) bij het genereren van een scène. Het model maakt het oppervlak in
// dezelfde verhouding en stand, de studio herkent het vlak in die stand en plaatst het ontwerp zonder
// uitrekken of bijsnijden. Dezelfde regels gelden in de interface, de prompt en de verwerking.
import { findObject } from './catalog';

export interface DesignSize { width: number; height: number }

export const DESIGN_SIZE_MIN = 16;
export const DESIGN_SIZE_MAX = 20000;

export type Orientation = 'portrait' | 'landscape' | 'square';

export function isValidSize(s: Partial<DesignSize> | null | undefined): s is DesignSize {
  return !!s && Number.isInteger(s.width) && Number.isInteger(s.height)
    && s.width! >= DESIGN_SIZE_MIN && s.height! >= DESIGN_SIZE_MIN && s.width! <= DESIGN_SIZE_MAX && s.height! <= DESIGN_SIZE_MAX;
}

/** Staand, liggend of (binnen 3%) vierkant. */
export function orientationOf(s: DesignSize): Orientation {
  const r = s.width / s.height;
  return r > 1.03 ? 'landscape' : r < 1 / 1.03 ? 'portrait' : 'square';
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Leesbare verhouding: 550 × 850 wordt 11:17, 1080 × 1350 wordt 4:5; anders bijvoorbeeld 1:1,55. */
export function ratioLabel(s: DesignSize, decimal = ','): string {
  const g = gcd(s.width, s.height);
  const w = s.width / g, h = s.height / g;
  if (w <= 40 && h <= 40) return `${w}:${h}`;
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, '').replace('.', decimal);
  return s.width >= s.height ? `${fmt(s.width / s.height)}:1` : `1:${fmt(s.height / s.width)}`;
}

/**
 * Wat de afmetingen doen voor dit object:
 * - 'surface': het oppervlak krijgt exact deze verhouding en stand (drukwerk, borden, kleding, verpakking);
 * - 'orientation': alleen staand of liggend (een tablet kan beide);
 * - 'none': het object bepaalt de verhouding zelf (een laptopscherm, een rond etiket, een e-mail op een scherm).
 */
export function sizeMode(objectType: string): 'surface' | 'orientation' | 'none' {
  const found = findObject(objectType);
  if (!found) return 'none';
  const { object } = found;
  if (object.mail || object.cylinder || object.id === 'multi-device') return 'none';
  if (object.surfaceKind === 'screen') return object.surfaceOrientation ? 'none' : 'orientation';
  return 'surface';
}

/** Uitleg in de interface als de afmetingen voor dit object niets doen. */
export function sizeNote(objectType: string): string {
  const found = findObject(objectType);
  if (!found) return '';
  const { object } = found;
  if (object.mail) return 'Een e-mailhandtekening staat op ware grootte onder de e-mail; de breedte stel je in de editor in.';
  if (object.cylinder) return 'Bij een rond object loopt het ontwerp om het object heen; de verhouding volgt het etiket of de print.';
  if (object.surfaceKind === 'screen') return `Het scherm van ${object.label.toLowerCase() === 'meerdere apparaten' ? 'elk apparaat' : `een ${object.label.toLowerCase()}`} heeft een vaste verhouding; je ontwerp wordt passend op het scherm gezet.`;
  return '';
}

/** Stand die de vlakherkenning moet aanhouden, of undefined als het object dat zelf bepaalt. */
export function surfaceOrientationFor(objectType: string, s: DesignSize | null | undefined): 'portrait' | 'landscape' | undefined {
  if (!isValidSize(s) || sizeMode(objectType) === 'none') return undefined;
  const o = orientationOf(s);
  return o === 'square' ? undefined : o;
}
