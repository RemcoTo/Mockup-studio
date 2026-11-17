// Mockupcategorieën en objecttypen. Nieuwe objecten toevoegen = één regel hier;
// configurator, promptopbouw, bibliotheekfilters en plaatsing lezen allemaal uit deze lijst.
import type { SurfaceKind } from './types';
import type { CylinderParams } from './warp';

export interface ObjectType {
  id: string;
  label: string;
  /** Hoe het object in de prompt heet (Engels; beeldmodellen volgen Engels het nauwkeurigst). */
  noun: string;
  /** Welk deel het ontwerp draagt, voor in de prompt. */
  surface: string;
  surfaceKind: SurfaceKind;
  /** Standaard passing van het ontwerp op het vlak. */
  defaultFit: 'cover' | 'contain' | 'width';
  /** '#rrggbb' of 'auto': naadloos, het vlak loopt op in het object (printvlak op een mok of shirt). */
  defaultBackground: string;
  materials?: string[];
  /** Verwachte stand van het vlak; bepaalt welke zijde de bovenkant van het ontwerp is. */
  surfaceOrientation?: 'portrait' | 'landscape';
  /** Ronde objecten: het vlak loopt om een cilinder heen. */
  cylinder?: CylinderParams;
  /** Standaardschaal van het ontwerp op het vlak (1 = passend); een logo op een mok staat met marge. */
  defaultScale?: number;
  /** E-mailhandtekening-scène: elk scherm toont standaard een e-mail met de handtekening eronder. */
  mail?: boolean;
  /** Extra aanwijzing voor de beeldprompt. */
  promptExtra?: string;
}

export interface Category {
  id: string;
  label: string;
  description: string;
  objects: ObjectType[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'devices',
    label: 'Websites en apparaten',
    description: 'Laptops, monitoren, telefoons en tablets',
    objects: [
      { id: 'laptop', surfaceOrientation: 'landscape', label: 'Laptop', noun: 'a modern laptop with a thin bezel, lid open', surface: 'the laptop screen', surfaceKind: 'screen', defaultFit: 'width', defaultBackground: '#ffffff', materials: ['aluminium', 'space grey aluminium', 'black'] },
      { id: 'monitor', surfaceOrientation: 'landscape', label: 'Desktopmonitor', noun: 'a large desktop monitor on a stand', surface: 'the monitor screen', surfaceKind: 'screen', defaultFit: 'width', defaultBackground: '#ffffff', materials: ['aluminium', 'black', 'white'] },
      { id: 'smartphone', surfaceOrientation: 'portrait', label: 'Smartphone', noun: 'a modern smartphone with thin bezels', surface: 'the phone screen', surfaceKind: 'screen', defaultFit: 'width', defaultBackground: '#ffffff', materials: ['titanium', 'black', 'white'] },
      { id: 'tablet', label: 'Tablet', noun: 'a modern tablet with thin bezels', surface: 'the tablet screen', surfaceKind: 'screen', defaultFit: 'width', defaultBackground: '#ffffff', materials: ['aluminium', 'space grey'] },
      { id: 'multi-device', label: 'Meerdere apparaten', noun: 'a laptop, a tablet and a smartphone arranged together', surface: 'each of the three screens', surfaceKind: 'screen', defaultFit: 'width', defaultBackground: '#ffffff' },
    ],
  },
  {
    id: 'email',
    label: 'E-mailhandtekening',
    description: 'Je handtekening onder een e-mail, op laptop en telefoon',
    objects: [
      {
        id: 'email-laptop', surfaceOrientation: 'landscape', label: 'Laptop met e-mail', noun: 'a modern laptop with a thin bezel, lid open, on a desk', surface: 'the laptop screen',
        surfaceKind: 'screen', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['aluminium', 'space grey aluminium'], mail: true,
      },
      {
        id: 'email-phone', surfaceOrientation: 'portrait', label: 'Smartphone met e-mail', noun: 'a modern smartphone with thin bezels, standing upright with its screen facing the camera', surface: 'the phone screen',
        surfaceKind: 'screen', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['titanium', 'black', 'white'], mail: true,
      },
      {
        id: 'email-phone-hand', surfaceOrientation: 'portrait', label: 'Smartphone in de hand', noun: 'a modern smartphone held naturally in one hand, its screen facing the camera', surface: 'the phone screen',
        surfaceKind: 'screen', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['titanium', 'black', 'white'], mail: true,
        promptExtra: 'The hand holds the phone at the edges so that no finger covers any part of the screen.',
      },
      {
        id: 'email-devices', label: 'Laptop en smartphone', noun: 'a modern laptop with its lid open and a modern smartphone lying beside it on the desk', surface: 'the laptop screen and the phone screen',
        surfaceKind: 'screen', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['aluminium', 'space grey aluminium'], mail: true,
        promptExtra: 'The phone lies flat next to the laptop, fully visible, its screen facing up.',
      },
    ],
  },
  {
    id: 'print',
    label: 'Branding en drukwerk',
    description: 'Visitekaartjes, briefpapier, flyers, posters',
    objects: [
      { id: 'business-card', surfaceOrientation: 'landscape', label: 'Visitekaartje', noun: 'a single business card', surface: 'the front face of the card', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['uncoated paper', 'cotton paper', 'thick board'] },
      { id: 'letterhead', surfaceOrientation: 'portrait', label: 'Briefpapier', noun: 'an A4 letterhead sheet', surface: 'the sheet', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['uncoated paper', 'textured paper'] },
      { id: 'envelope', surfaceOrientation: 'landscape', label: 'Envelop', noun: 'a closed envelope seen from the front', surface: 'the front of the envelope', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['paper', 'kraft paper'] },
      { id: 'flyer', surfaceOrientation: 'portrait', label: 'Flyer', noun: 'a single A5 flyer', surface: 'the printed side of the flyer', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['silk paper', 'uncoated paper'] },
      { id: 'brochure', label: 'Brochure', noun: 'an open brochure lying flat', surface: 'the right-hand page', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['silk paper', 'uncoated paper'] },
      { id: 'poster', surfaceOrientation: 'portrait', label: 'Poster', noun: 'a poster', surface: 'the poster', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['matte paper', 'satin paper'] },
      { id: 'magazine', surfaceOrientation: 'portrait', label: 'Tijdschrift', noun: 'a magazine lying closed', surface: 'the front cover', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['gloss paper', 'matte paper'] },
      { id: 'label', label: 'Etiket op een pot', noun: 'a glass jar with a wrap-around label, seen from the front', surface: 'the label', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', cylinder: { wrap: 120, bulge: 0.05 } },
      { id: 'bottle', label: 'Fles met etiket', noun: 'a bottle with a wrap-around label, seen from the front', surface: 'the label', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', cylinder: { wrap: 120, bulge: 0.04 } },
      { id: 'can', label: 'Blik', noun: 'a beverage can, seen from the front', surface: 'the printed body of the can', surfaceKind: 'rigid', defaultFit: 'cover', defaultBackground: '#ffffff', cylinder: { wrap: 140, bulge: 0.04 } },
    ],
  },
  {
    id: 'apparel',
    label: 'Bedrijfskleding',
    description: 'T-shirts, polo’s, hoodies, jassen, petten',
    objects: [
      { id: 't-shirt', label: 'T-shirt', noun: 'a plain crew-neck t-shirt', surface: 'the chest print area', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['cotton', 'organic cotton', 'heavyweight cotton'] },
      { id: 'polo', label: 'Polo', noun: 'a plain polo shirt', surface: 'the left chest logo area', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['piqué cotton'], defaultScale: 0.8 },
      { id: 'hoodie', label: 'Hoodie', noun: 'a plain hoodie', surface: 'the chest print area', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['cotton fleece', 'heavyweight fleece'] },
      { id: 'jacket', label: 'Jas', noun: 'a plain work jacket', surface: 'the back print area', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['canvas', 'softshell', 'nylon'] },
      { id: 'cap', label: 'Pet', noun: 'a plain six-panel cap', surface: 'the front panel', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['cotton twill', 'wool'], defaultScale: 0.8 },
      { id: 'workwear', label: 'Werkkleding', noun: 'a plain work shirt', surface: 'the chest print area', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['canvas', 'twill'] },
    ],
  },
  {
    id: 'signage',
    label: 'Voertuigen en signing',
    description: 'Bestelwagens, auto’s, gevels, borden',
    objects: [
      { id: 'van', surfaceOrientation: 'landscape', label: 'Bestelwagen', noun: 'a plain delivery van seen from the side', surface: 'the flat side panel of the cargo area', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: 'auto', materials: ['white paint', 'black paint', 'silver paint'] },
      { id: 'car', surfaceOrientation: 'landscape', label: 'Personenauto', noun: 'a plain car seen from the side', surface: 'the rear door panel', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: 'auto', materials: ['white paint', 'black paint'] },
      { id: 'facade', surfaceOrientation: 'landscape', label: 'Gevelreclame', noun: 'a building facade with a sign panel', surface: 'the sign panel on the facade', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['brick', 'concrete', 'glass'] },
      { id: 'sign-board', label: 'Bedrijfsbord', noun: 'a free-standing sign board', surface: 'the face of the board', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['aluminium', 'wood', 'steel'] },
      { id: 'window', label: 'Raambelettering', noun: 'a shop window', surface: 'the lettering area on the glass', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: '#ffffff' },
      { id: 'wayfinding', label: 'Bewegwijzering', noun: 'a wall-mounted wayfinding sign', surface: 'the face of the sign', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['aluminium', 'acrylic'] },
    ],
  },
  {
    id: 'merch',
    label: 'Producten en merchandise',
    description: 'Dozen, tassen, mokken, verpakkingen',
    objects: [
      { id: 'shipping-box', label: 'Verzenddoos', noun: 'a closed cardboard shipping box', surface: 'the front face of the box', surfaceKind: 'paper', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['kraft cardboard', 'white cardboard'] },
      { id: 'tote-bag', label: 'Draagtas', noun: 'a canvas tote bag', surface: 'the front print area of the bag', surfaceKind: 'fabric', defaultFit: 'contain', defaultBackground: 'auto', materials: ['natural canvas', 'black canvas'], defaultScale: 0.8 },
      { id: 'paper-bag', label: 'Papieren tas', noun: 'a paper shopping bag', surface: 'the front face of the bag', surfaceKind: 'paper', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['kraft paper', 'white paper'] },
      { id: 'mug', label: 'Mok', noun: 'a ceramic mug, side view with the handle to the right', surface: 'the front print area of the mug', surfaceKind: 'rigid', defaultFit: 'contain', defaultBackground: 'auto', materials: ['white ceramic', 'matte ceramic'], cylinder: { wrap: 110, bulge: 0.06 }, defaultScale: 0.7 },
      { id: 'packaging', label: 'Productverpakking', noun: 'a product box', surface: 'the front face of the box', surfaceKind: 'paper', defaultFit: 'cover', defaultBackground: '#ffffff', materials: ['white board', 'kraft board'] },
      { id: 'gift', label: 'Relatiegeschenk', noun: 'a notebook', surface: 'the front cover', surfaceKind: 'paper', defaultFit: 'contain', defaultBackground: '#ffffff', materials: ['linen', 'leather', 'paper'] },
    ],
  },
];

export function findObject(id: string): { category: Category; object: ObjectType } | null {
  for (const category of CATEGORIES) {
    const object = category.objects.find((o) => o.id === id);
    if (object) return { category, object };
  }
  return null;
}

export interface Option { id: string; label: string; prompt: string }

export const ENVIRONMENTS: Option[] = [
  { id: 'studio', label: 'Minimalistische studio', prompt: 'in a minimal photo studio with a seamless backdrop' },
  { id: 'workspace', label: 'Moderne werkplek', prompt: 'on a modern, uncluttered workspace' },
  { id: 'luxury', label: 'Luxe interieur', prompt: 'in a refined luxury interior with natural materials' },
  { id: 'architecture', label: 'Architectonische omgeving', prompt: 'in an architectural setting with clean concrete and strong geometry' },
  { id: 'outdoor', label: 'Buitenlocatie', prompt: 'at an outdoor location' },
  { id: 'abstract', label: 'Abstracte studioachtergrond', prompt: 'against an abstract studio background of simple geometric forms' },
  { id: 'nature', label: 'Natuurlijke omgeving', prompt: 'in a natural setting with stone, wood and plants' },
];

export const ANGLES: Option[] = [
  { id: 'front', label: 'Frontaal', prompt: 'shot straight-on from the front' },
  { id: 'three-quarter', label: 'Schuin perspectief', prompt: 'shot from a three-quarter angle' },
  { id: 'top', label: 'Bovenaanzicht', prompt: 'shot from directly above (flat lay)' },
  { id: 'close', label: 'Close-up', prompt: 'close-up shot' },
  { id: 'low', label: 'Lage camerahoek', prompt: 'shot from a low camera angle' },
  { id: 'high', label: 'Hoge camerahoek', prompt: 'shot from a high camera angle' },
];

export const POSITIONS: Option[] = [
  { id: 'left', label: 'Links', prompt: 'the subject placed on the left of the frame' },
  { id: 'center', label: 'Gecentreerd', prompt: 'the subject centered in the frame' },
  { id: 'right', label: 'Rechts', prompt: 'the subject placed on the right of the frame' },
];

export const NEGATIVE_SPACE: Option[] = [
  { id: 'lots', label: 'Veel negatieve ruimte', prompt: 'generous negative space' },
  { id: 'little', label: 'Weinig negatieve ruimte', prompt: 'a tight frame with little negative space' },
];

export const SYMMETRY: Option[] = [
  { id: 'symmetric', label: 'Symmetrisch', prompt: 'a symmetrical composition' },
  { id: 'asymmetric', label: 'Asymmetrisch', prompt: 'an asymmetrical composition' },
];

export const FRAMING: Option[] = [
  { id: 'close', label: 'Close-up', prompt: 'framed as a close-up' },
  { id: 'overview', label: 'Overzicht', prompt: 'framed as a wider overview shot' },
];

export const LIGHTING: Option[] = [
  { id: 'soft', label: 'Zacht diffuus licht', prompt: 'soft diffused light' },
  { id: 'sun', label: 'Hard zonlicht', prompt: 'hard direct sunlight' },
  { id: 'dramatic', label: 'Dramatische studioverlichting', prompt: 'dramatic studio lighting with deep contrast' },
  { id: 'daylight', label: 'Natuurlijk daglicht', prompt: 'natural daylight from a window' },
];

export const SHADOWS: Option[] = [
  { id: 'soft', label: 'Zachte schaduwen', prompt: 'soft shadows' },
  { id: 'hard', label: 'Harde schaduwen', prompt: 'crisp hard-edged shadows' },
];

export const STYLES: Option[] = [
  { id: 'product', label: 'Fotorealistische productfotografie', prompt: 'photorealistic product photography' },
  { id: 'editorial', label: 'Editorial fotografie', prompt: 'editorial photography' },
  { id: 'campaign', label: 'High-end campagnebeeld', prompt: 'a high-end advertising campaign image' },
  { id: 'architecture', label: 'Architectuurfotografie', prompt: 'architectural photography' },
  { id: 'minimal', label: 'Minimalistische studiofotografie', prompt: 'minimal studio photography' },
  { id: 'commercial', label: 'Commerciële productfotografie', prompt: 'commercial product photography' },
];

export const FINISHES: Option[] = [
  { id: 'matte', label: 'Mat', prompt: 'matte finish' },
  { id: 'satin', label: 'Zijdeglans', prompt: 'satin finish' },
  { id: 'gloss', label: 'Hoogglans', prompt: 'glossy finish' },
  { id: 'textured', label: 'Gestructureerd', prompt: 'textured finish' },
];

export const MATERIALS = ['hout', 'metaal', 'glas', 'papier', 'kunststof', 'katoen', 'steen'];

export const AVOID: Option[] = [
  { id: 'text', label: 'Geen extra tekst', prompt: 'any text or lettering' },
  { id: 'logos', label: 'Geen andere logo’s', prompt: 'any logos or brand marks' },
  { id: 'people', label: 'Geen handen of personen', prompt: 'hands or people' },
  { id: 'devices', label: 'Geen extra apparaten', prompt: 'additional devices' },
  { id: 'busy', label: 'Geen drukke achtergrond', prompt: 'a busy background' },
  { id: 'props', label: 'Geen decoratieve objecten', prompt: 'decorative props' },
  { id: 'watermark', label: 'Geen watermerken', prompt: 'watermarks' },
];

export const REFERENCE_ASPECTS: Option[] = [
  { id: 'composition', label: 'Compositie', prompt: 'composition' },
  { id: 'lighting', label: 'Belichting', prompt: 'lighting' },
  { id: 'materials', label: 'Materialen', prompt: 'materials and surfaces' },
  { id: 'colors', label: 'Kleuren', prompt: 'color palette' },
  { id: 'angle', label: 'Camerahoek', prompt: 'camera angle' },
  { id: 'style', label: 'Fotografische stijl', prompt: 'overall photographic style' },
];

export interface AspectOption { id: string; label: string; ratio: number }
export const ASPECTS: AspectOption[] = [
  { id: '1:1', label: 'Vierkant 1:1', ratio: 1 },
  { id: '4:5', label: 'Staand 4:5', ratio: 4 / 5 },
  { id: '2:3', label: 'Staand 2:3', ratio: 2 / 3 },
  { id: '3:2', label: 'Liggend 3:2', ratio: 3 / 2 },
  { id: '16:9', label: 'Liggend 16:9', ratio: 16 / 9 },
  { id: '9:16', label: 'Staand 9:16', ratio: 9 / 16 },
  { id: '21:9', label: 'Breed 21:9', ratio: 21 / 9 },
];

export const RESOLUTIONS = [
  { id: 'standard', label: 'Standaard', longEdge: 1536 },
  { id: 'high', label: 'Hoog', longEdge: 2560 },
  { id: 'max', label: 'Maximaal (experimenteel)', longEdge: 3840 },
] as const;

export function labelOf(list: Option[], id?: string) {
  return list.find((o) => o.id === id)?.label ?? '';
}

/**
 * Passing bij het plaatsen: de standaard van het object, tenzij het ontwerp daar duidelijk niet bij past.
 * Een breed logo op een staande poster met 'vullen' zou grotendeels wegvallen; dan passend plaatsen.
 */
export function smartFit(defaultFit: ObjectType['defaultFit'], asset: { width: number; height: number } | null, surface: { width: number; height: number }): ObjectType['defaultFit'] {
  if (!asset || asset.width <= 0 || asset.height <= 0 || surface.width <= 0 || surface.height <= 0) return defaultFit;
  const a = asset.width / asset.height, s = surface.width / surface.height;
  // Websitescreenshot dat langer is dan het scherm: op breedte passen en bovenaan beginnen; anders vullen.
  if (defaultFit === 'width') return a > 1.2 ? 'cover' : 'width';
  if (defaultFit === 'cover' && Math.max(a / s, s / a) > 1.5) return 'contain';
  return defaultFit;
}
