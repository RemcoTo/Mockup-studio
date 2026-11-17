import type { ScreenLayout } from './mail';
import type { Backdrop } from './scene-style';
import type { ScenePalette } from './palette';
import type { Device3DSpec } from './device3d/spec';
import type { DesignTransform, Quad } from './geometry';
import type { CylinderParams, Mesh } from './warp';

export type SurfaceKind = 'screen' | 'paper' | 'fabric' | 'rigid';

export interface Surface {
  id: string;
  label: string;
  kind: SurfaceKind;
  quad: Quad;
  /** Bestand met zacht masker (grijswaarden, scènegrootte). Ontbreekt bij handmatig gemarkeerde vlakken. */
  maskFile?: string | null;
  /** Bestand met schaduwkaart (grijswaarden, scènegrootte; wit = geen verandering). */
  shadingFile?: string | null;
  /** Hoe het vlak gevonden is. */
  /** chroma = gevonden op een groen vlak, 3d = uit een 3D-model (exact), manual = met de hand aangewezen. */
  detection: 'chroma' | '3d' | 'manual';
  /** Kleur van het object rondom het chroma-vlak; vult de delen die het ontwerp niet bedekt. */
  fillColor?: string | null;
  /** Hoe volledig het gevonden vlak een vierhoek vult (0..1); laag = deels afgedekt of geen nette rechthoek. */
  quality?: number;
  /** Gebogen oppervlak: raster dat de werkelijke vorm volgt (bijvoorbeeld uit de detectie). */
  mesh?: Mesh | null;
  /** Cilinder (mok, fles): zichtbare boog en doorbuiging. */
  cylinder?: CylinderParams | null;
  /**
   * Echte verhouding (breedte / hoogte) van het vlak als die bekend is, zoals bij een 3D-model. Zonder deze
   * waarde schat de studio de verhouding uit de vier hoeken; recht van voren of van boven kan dat niet exact.
   */
  aspect?: number | null;
}

export interface BlendSettings {
  /** Hoeveel van de belichting en plooien van de scène op het ontwerp komt (0..1). */
  shading: number;
  /** Verplaatsing langs stofplooien in pixels (alleen zinvol bij textiel). */
  displacement: number;
  /** Synthetische schermglans (0..1). */
  gloss: number;
  /** Dekking van het ontwerp (0..1). */
  opacity: number;
  /**
   * Hoeveel van de reflecties en het glimlicht uit de scène over het ontwerp komt (0..1). Ontbreekt bij
   * mockups van vóór deze instelling; dan geldt 1.
   */
  reflections?: number;
}

export interface Placement {
  surfaceId: string;
  assetId: string | null;
  transform: DesignTransform;
  /** Hoeken die de gebruiker heeft aangepast; null = hoeken van het oppervlak. */
  quad: Quad | null;
  /** Eigen vervormingsraster; null = dat van het oppervlak. */
  mesh?: Mesh | null;
  /** Eigen cilinderinstelling; null = die van het oppervlak. */
  cylinder?: CylinderParams | null;
  blend: BlendSettings;
  /** Vulkleur achter het ontwerp binnen het oppervlak ('#rrggbb'), 'transparent', of 'auto' (naadloos opvullen vanuit het object). */
  background: string;
  /** Het masker van de scène gebruiken, zodat voorwerpen vóór het vlak zichtbaar blijven. */
  useMask: boolean;
  hidden: boolean;
  /**
   * Mailscherm: de handtekening (het ontwerp) onder een e-mail in een mailprogramma.
   * Ontbreekt of null = het ontwerp (assetId) staat zelf op het vlak.
   */
  layout?: ScreenLayout | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  client: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  kind: 'design' | 'reference';
  source: 'upload' | 'url';
  originalName: string;
  mime: string;
  file: string;
  preview: string;
  width: number;
  height: number;
  meta: Record<string, unknown>;
  /** Versienummer; begint bij 1 en loopt op bij elke vervanging. */
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  originalName: string;
  mime: string;
  file: string;
  preview: string;
  width: number;
  height: number;
  meta: Record<string, unknown>;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface Scene {
  id: string;
  /** null = systeembibliotheek, voor iedereen zichtbaar. */
  workspaceId: string | null;
  projectId: string | null;
  origin: 'library' | 'generated' | 'demo';
  inLibrary: boolean;
  title: string;
  category: string;
  objectType: string;
  tags: SceneTags;
  file: string;
  thumb: string;
  width: number;
  height: number;
  surfaces: Surface[];
  prompt: string;
  config: SceneConfig | null;
  provider: string;
  model: string;
  license: string;
  createdAt: string;
  /** Scène met een echt 3D-device: de instellingen en de achtergrond waarop het device gerenderd wordt. */
  device3d?: Device3DScene | null;
}

export interface Device3DScene {
  spec: Device3DSpec;
  /** Opslagsleutel van de achtergrond zonder device (AI-omgeving, effen achtergrond of eigen foto). */
  background: string;
  /** Uit de achtergrond afgeleid licht (ter informatie). */
  light?: { azimuth: number; elevation: number; intensity: number; warmth: number; ambient: number } | null;
  /**
   * Het hele scherm in de render (hoeken en echte verhouding). Het vlak van de scène is het deel onder de statusbalk
   * als die aan staat; de balk komt bij het renderen van de mockup in de rest van het scherm.
   */
  screen?: { quad: Quad; aspect: number } | null;
}

export interface SceneTags {
  material?: string;
  angle?: string;
  composition?: string;
  color?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  /** Bibliotheekpreset waaruit de scène is gegenereerd. */
  preset?: string;
}

export interface Mockup {
  id: string;
  projectId: string;
  sceneId: string;
  generationId: string | null;
  placements: Placement[];
  favorite: boolean;
  previewFile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  mockupId: string;
  projectId: string;
  format: 'png' | 'jpg' | 'tiff' | 'mp4';
  quality: number;
  file: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface Generation {
  id: string;
  projectId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  config: SceneConfig;
  prompt: string;
  count: number;
  assetId: string | null;
  sceneIds: string[];
  mockupIds: string[];
  error: string | null;
  provider: string;
  model: string;
  credits: number;
  costUsd: number;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Alles wat de gebruiker in de configurator kan instellen. Elk veld is optioneel behalve categorie en object. */
export interface SceneConfig {
  category: string;
  objectType: string;
  brandModel?: string;
  material?: string;
  color?: string;
  finish?: string;
  objectCount?: number;
  orientation?: string;
  framing?: string;
  objectPosition?: string;
  environment?: string;
  environmentCustom?: string;
  angle?: string;
  composition?: string;
  negativeSpace?: string;
  symmetry?: string;
  compositionCustom?: string;
  lighting?: string;
  colorTemperature?: number;
  shadows?: string;
  style?: string;
  aspect: string;
  resolution: 'standard' | 'high' | 'max';
  quality: 'low' | 'medium' | 'high';
  instructions?: string;
  avoid?: string[];
  avoidCustom?: string;
  referenceAssetIds?: string[];
  referenceAspects?: string[];
  /** 'chroma': model rendert een egaal groen vlak dat automatisch gevonden wordt. 'blank': leeg vlak, hoeken handmatig. */
  surfaceMethod: 'chroma' | 'blank';
  /** Soort set: studio, interieur, minimalistisch, editorial, productfotografie of abstract (zie SCENE_TYPES). */
  sceneType?: string;
  /** Props in beeld: geen, minimaal of passend bij het merk. */
  props?: 'none' | 'minimal' | 'brand';
  /** Ondergrond waar het object op staat (zie GROUNDS). */
  ground?: string;
  /**
   * Merkkleuren voor de omgeving, elk met een eigen toepassing (zie shared/palette); komen nooit op het ontwerpvlak.
   * Afwezig bij configuraties van vóór het palet: die hadden brandColor en brandColorUse, en scenePalette() zet ze om.
   */
  palette?: ScenePalette;
  /**
   * Echt 3D-device: de AI maakt alleen de omgeving en de studio rendert dit device erop (zie shared/device3d).
   * Alleen voor objecten met een 3D-model; anders genegeerd.
   */
  device3d?: Device3DSpec | null;
  /** Platte achtergrond in plaats van een ruimte; null of afwezig = gewone scène. */
  backdrop?: Backdrop | null;
  /** Afmetingen van het ontwerp in pixels: het oppervlak krijgt deze verhouding en stand (zie shared/design-size). */
  designSize?: { width: number; height: number };
  /** Onderdeel van een Brand Shoot: één art direction over meerdere beelden. */
  series?: { id: string; title: string; index: number; total: number };
}

export const DEFAULT_BLEND: Record<SurfaceKind, BlendSettings> = {
  screen: { shading: 0.15, displacement: 0, gloss: 0.12, opacity: 1, reflections: 1 },
  paper: { shading: 0.85, displacement: 0, gloss: 0, opacity: 1, reflections: 1 },
  fabric: { shading: 0.9, displacement: 4, gloss: 0, opacity: 0.96, reflections: 0.7 },
  rigid: { shading: 0.75, displacement: 0, gloss: 0.05, opacity: 1, reflections: 1 },
};

export const DEFAULT_TRANSFORM: DesignTransform = { fit: 'cover', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
