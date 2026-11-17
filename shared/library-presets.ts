// Samengestelde art direction voor de systeembibliotheek. Elke preset is één scène die het platform
// zelf laat genereren (met een groen vlak, zodat het ontwerp er later pixelexact in komt).
// Uitgangspunten: rustige, echte materialen, natuurlijk licht, ruimte rond het object, geen rekwisieten
// die de aandacht van het ontwerp afleiden.
import { findObject } from './catalog';
import type { SceneConfig } from './types';

export interface LibraryPreset {
  id: string;
  title: string;
  /** Korte omschrijving voor de beheerder: waarom deze scène in de bibliotheek hoort. */
  note: string;
  config: Omit<SceneConfig, 'quality' | 'resolution' | 'surfaceMethod' | 'category'>;
}

const P = (id: string, title: string, note: string, config: LibraryPreset['config']): LibraryPreset => ({ id, title, note, config });

export const LIBRARY_PRESETS: LibraryPreset[] = [
  // E-mailhandtekening
  P('email-laptop-desk', 'E-mail op een laptop', 'Je handtekening onder een e-mail op een rustig bureau, frontaal en goed leesbaar.', {
    objectType: 'email-laptop', material: 'aluminium', environment: 'workspace', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', negativeSpace: 'little', aspect: '16:9', instructions: 'a light oak desk, a ceramic cup at the edge of the frame, nothing else on the desk',
  }),
  P('email-phone-hand', 'E-mail op de telefoon', 'Een telefoon in de hand met de e-mail open, bij zacht daglicht.', {
    objectType: 'email-phone-hand', material: 'black', environment: 'luxury', angle: 'close', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '4:5', instructions: 'held upright in one hand, softly blurred warm interior background',
  }),
  P('email-devices-desk', 'Laptop en telefoon', 'Dezelfde handtekening op desktop en mobiel, naast elkaar op het bureau.', {
    objectType: 'email-devices', material: 'aluminium', environment: 'workspace', angle: 'three-quarter', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', negativeSpace: 'little', aspect: '3:2', instructions: 'a pale oak desk, the phone lies to the right of the laptop, nothing else on the desk',
  }),
  // Schermen
  P('laptop-oak-desk', 'Laptop op eiken bureau', 'De standaard websitepresentatie: rustig, warm, schuin van boven.', {
    objectType: 'laptop', material: 'space grey aluminium', environment: 'workspace', angle: 'three-quarter', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', negativeSpace: 'lots', aspect: '3:2', instructions: 'a light oak desk, a linen notebook at the edge of the frame, nothing else on the desk',
  }),
  P('laptop-concrete', 'Laptop in betonnen ruimte', 'Architectonisch en koel, voor bureaus en tech.', {
    objectType: 'laptop', material: 'aluminium', environment: 'architecture', angle: 'front', lighting: 'soft', shadows: 'soft',
    style: 'architecture', negativeSpace: 'lots', symmetry: 'symmetric', aspect: '16:9',
  }),
  P('monitor-studio', 'Monitor in studio', 'Groot scherm frontaal, voor dashboards en webapps.', {
    objectType: 'monitor', material: 'black', environment: 'studio', angle: 'front', lighting: 'soft', shadows: 'soft',
    style: 'minimal', negativeSpace: 'lots', symmetry: 'symmetric', aspect: '16:9',
  }),
  P('phone-hand-daylight', 'Smartphone in de hand', 'Mobiele site of app in gebruik, daglicht.', {
    objectType: 'smartphone', material: 'titanium', environment: 'outdoor', angle: 'close', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '4:5', instructions: 'held naturally in one hand, softly blurred city street behind',
  }),
  P('phone-flatlay-stone', 'Smartphone op natuursteen', 'Bovenaanzicht, voor app-schermen.', {
    objectType: 'smartphone', material: 'black', environment: 'nature', angle: 'top', lighting: 'sun', shadows: 'hard',
    style: 'product', negativeSpace: 'lots', aspect: '4:5', instructions: 'lying on pale travertine stone, a sharp shadow of a leaf falling across the stone but not across the screen',
  }),
  P('tablet-sofa', 'Tablet in interieur', 'Leesomgeving, voor magazines en content.', {
    objectType: 'tablet', material: 'aluminium', environment: 'luxury', angle: 'high', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '3:2', instructions: 'resting on a wool throw on a low sofa',
  }),
  P('devices-workspace', 'Laptop, tablet en telefoon', 'Responsive presentatie in één beeld.', {
    objectType: 'multi-device', environment: 'workspace', angle: 'three-quarter', lighting: 'daylight', shadows: 'soft',
    style: 'commercial', negativeSpace: 'little', aspect: '16:9',
  }),
  // Drukwerk
  P('cards-linen', 'Visitekaartjes op linnen', 'Twee kaartjes, voor- en achterkant.', {
    objectType: 'business-card', material: 'cotton paper', objectCount: 2, environment: 'studio', angle: 'top', lighting: 'sun', shadows: 'hard',
    style: 'product', negativeSpace: 'lots', aspect: '3:2', instructions: 'on natural undyed linen, crisp diagonal window shadows',
  }),
  P('cards-stack-stone', 'Stapel visitekaartjes', 'Dik karton, schuin licht, toont papierdikte.', {
    objectType: 'business-card', material: 'thick board', environment: 'nature', angle: 'low', lighting: 'dramatic', shadows: 'hard',
    style: 'campaign', aspect: '3:2', instructions: 'a small stack of cards on dark slate, the top card fully visible',
  }),
  P('letterhead-desk', 'Briefpapier op bureau', 'A4 met envelop, voor huisstijlpresentaties.', {
    objectType: 'letterhead', material: 'uncoated paper', environment: 'workspace', angle: 'top', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', negativeSpace: 'lots', aspect: '4:5',
  }),
  P('poster-gallery', 'Poster in galerieruimte', 'Ingelijste poster aan een witte wand.', {
    objectType: 'poster', material: 'matte paper', environment: 'architecture', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'architecture', negativeSpace: 'lots', symmetry: 'symmetric', aspect: '4:5', instructions: 'a thin oak frame on a white plaster wall, a wooden bench below',
  }),
  P('poster-street', 'Poster op straat', 'Campagne in de openbare ruimte.', {
    objectType: 'poster', material: 'satin paper', environment: 'outdoor', angle: 'three-quarter', lighting: 'sun', shadows: 'hard',
    style: 'campaign', aspect: '2:3', instructions: 'pasted on a concrete wall in a quiet street, late afternoon sun',
  }),
  P('flyer-hand', 'Flyer in de hand', 'A5, licht gebogen papier.', {
    objectType: 'flyer', material: 'uncoated paper', environment: 'studio', angle: 'front', lighting: 'soft', shadows: 'soft',
    style: 'minimal', aspect: '4:5',
  }),
  P('magazine-table', 'Tijdschrift op tafel', 'Cover in een interieur.', {
    objectType: 'magazine', material: 'matte paper', environment: 'luxury', angle: 'high', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '4:5', instructions: 'on a walnut coffee table next to a ceramic cup',
  }),
  // Verpakking en merchandise
  P('mug-morning', 'Mok in ochtendlicht', 'Keramiek met print, warm daglicht.', {
    objectType: 'mug', material: 'white ceramic', environment: 'workspace', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'product', aspect: '4:5',
  }),
  P('bottle-studio', 'Fles met etiket', 'Etiket rond de fles, studio.', {
    objectType: 'bottle', environment: 'studio', angle: 'front', lighting: 'soft', shadows: 'soft',
    style: 'product', negativeSpace: 'lots', aspect: '4:5',
  }),
  P('can-sun', 'Blik in de zon', 'Drankverpakking met harde schaduw.', {
    objectType: 'can', environment: 'abstract', angle: 'front', lighting: 'sun', shadows: 'hard',
    style: 'campaign', aspect: '4:5',
  }),
  P('box-shelf', 'Productdoos', 'Verpakking, schuin, rustige achtergrond.', {
    objectType: 'packaging', material: 'white board', environment: 'studio', angle: 'three-quarter', lighting: 'soft', shadows: 'soft',
    style: 'product', aspect: '1:1',
  }),
  P('tote-wall', 'Draagtas aan de wand', 'Canvas tas met printvlak.', {
    objectType: 'tote-bag', material: 'natural canvas', environment: 'architecture', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '4:5', instructions: 'hanging from a simple wooden peg on a plaster wall',
  }),
  P('paperbag-floor', 'Papieren tas', 'Retail, kraft papier.', {
    objectType: 'paper-bag', material: 'kraft paper', environment: 'studio', angle: 'three-quarter', lighting: 'soft', shadows: 'soft',
    style: 'commercial', aspect: '1:1',
  }),
  // Kleding
  P('tshirt-hanger', 'T-shirt aan een hanger', 'Printvlak op de borst, natuurlijke plooien.', {
    objectType: 't-shirt', material: 'heavyweight cotton', color: 'off-white', environment: 'architecture', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'editorial', aspect: '4:5', instructions: 'on a wooden hanger against a concrete wall',
  }),
  P('hoodie-flatlay', 'Hoodie plat gelegd', 'Bovenaanzicht, zachte plooien.', {
    objectType: 'hoodie', material: 'cotton fleece', color: 'black', environment: 'studio', angle: 'top', lighting: 'soft', shadows: 'soft',
    style: 'product', aspect: '4:5',
  }),
  P('cap-studio', 'Pet', 'Frontpaneel met logo.', {
    objectType: 'cap', material: 'cotton twill', color: 'navy', environment: 'studio', angle: 'three-quarter', lighting: 'soft', shadows: 'soft',
    style: 'product', aspect: '1:1',
  }),
  // Signing
  P('facade-sign', 'Gevelreclame', 'Paneel op een bakstenen gevel.', {
    objectType: 'facade', material: 'brick', environment: 'outdoor', angle: 'low', lighting: 'sun', shadows: 'hard',
    style: 'architecture', aspect: '3:2',
  }),
  P('van-side', 'Bestelwagen zijkant', 'Belettering op een bus, zij-aanzicht.', {
    objectType: 'van', material: 'white paint', environment: 'outdoor', angle: 'front', lighting: 'daylight', shadows: 'soft',
    style: 'commercial', aspect: '16:9', instructions: 'parked in a quiet industrial street',
  }),
  P('wayfinding-lobby', 'Bewegwijzering in lobby', 'Wandbord in een interieur.', {
    objectType: 'wayfinding', material: 'aluminium', environment: 'architecture', angle: 'three-quarter', lighting: 'soft', shadows: 'soft',
    style: 'architecture', aspect: '3:2',
  }),
];

export function findLibraryPreset(id: string) {
  return LIBRARY_PRESETS.find((p) => p.id === id) ?? null;
}

/** Volledige generatie-instelling voor een preset. */
export function presetConfig(p: LibraryPreset, quality: SceneConfig['quality'], resolution: SceneConfig['resolution'] = 'standard'): SceneConfig {
  const found = findObject(p.config.objectType);
  return { ...p.config, category: found?.category.id ?? '', quality, resolution, surfaceMethod: 'chroma' };
}
