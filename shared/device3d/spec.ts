// Echte 3D-devices: de instellingen van een device in een scène, de modellen die de studio kent, en de vaste
// camerastandpunten. Dit bestand gebruikt geen Three.js, zodat server, validatie en interface het kunnen delen;
// het renderen staat in stage.ts.
//
// Een nieuw device toevoegen: een GLB in public/models/devices met een mesh 'Screen' (het actieve schermvlak, in
// het lokale XY-vlak, normaal naar +Z) en, bij een laptop, een node 'Lid' met de oorsprong op de scharnieras.
// Daarna een regel in DEVICE_MODELS met de echte maten en de afwerkingen.

export type DevicePose = 'standing' | 'flat' | 'upright';

export interface DeviceFinish {
  id: string;
  label: string;
  /** Kleur van het metaal of de behuizing. */
  body: string;
  roughness: number;
}

export interface DeviceModel {
  id: string;
  label: string;
  /** Objecttype in de catalogus waarvoor dit model geldt. */
  objectType: string;
  /** GLB-bestand onder public/models/devices. */
  file: string;
  /** Afmetingen van het actieve scherm in millimeter (breedte x hoogte bij normaal gebruik). */
  screenMM: [number, number];
  /** Schermresolutie van het echte apparaat; bepaalt de verhouding waarop ontwerpen het best passen. */
  screenPx: [number, number];
  poses: DevicePose[];
  defaultPose: DevicePose;
  finishes: DeviceFinish[];
  /** Laptop: openingshoek van het scherm instelbaar. */
  lid?: { min: number; max: number; default: number };
  /** Beschrijving voor de AI-prompt van de omgeving (lege plek voor dit apparaat). */
  promptSpot: string;
  /** Afmeting in de prompt, zodat de AI de lege plek op schaal laat. */
  sizeText: string;
  /** Licentie van het model. */
  license: string;
  /**
   * Statusbalk (telefoon, tablet) of menubalk (laptop, monitor) bovenaan het scherm: soort en hoogte als deel van
   * de schermhoogte, zoals op een echt apparaat met deze schermmaat.
   */
  statusBar: { kind: StatusBarKind; height: number };
}

export type StatusBarKind = 'phone' | 'tablet' | 'desktop';

const ALU: DeviceFinish[] = [
  { id: 'silver', label: 'Zilver', body: '#b9bcc1', roughness: 0.38 },
  { id: 'space-grey', label: 'Spacegrijs', body: '#6e7176', roughness: 0.38 },
  { id: 'midnight', label: 'Middernacht', body: '#2c2f34', roughness: 0.42 },
];
const OWN = 'Eigen model van Mockup Studio (gemaakt in code, geen licentie van derden).';

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'laptop-14', label: 'Laptop 14 inch', objectType: 'laptop', file: 'laptop-14.glb',
    screenMM: [302.5, 196.5], screenPx: [3024, 1964], poses: ['standing'], defaultPose: 'standing', finishes: ALU,
    lid: { min: 92, max: 140, default: 110 },
    promptSpot: 'a clear, empty area on the tabletop where an open laptop will be placed', sizeText: 'about 31 by 22 cm',
    license: OWN, statusBar: { kind: 'desktop', height: 0.026 },
  },
  {
    id: 'phone-6', label: 'Smartphone 6,1 inch', objectType: 'smartphone', file: 'phone-6.glb',
    screenMM: [64.4, 139.6], screenPx: [1179, 2556], poses: ['upright', 'flat'], defaultPose: 'upright',
    finishes: [
      { id: 'titanium', label: 'Titanium', body: '#b9b4ab', roughness: 0.3 },
      { id: 'graphite', label: 'Grafiet', body: '#3a3b3e', roughness: 0.32 },
      { id: 'white', label: 'Wit', body: '#e9e8e4', roughness: 0.28 },
    ],
    promptSpot: 'a clear, empty area where a smartphone will be placed', sizeText: 'about 7 by 15 cm',
    license: OWN, statusBar: { kind: 'phone', height: 0.062 },
  },
  {
    id: 'tablet-11', label: 'Tablet 11 inch', objectType: 'tablet', file: 'tablet-11.glb',
    screenMM: [237.8, 166.1], screenPx: [2388, 1668], poses: ['upright', 'flat'], defaultPose: 'upright', finishes: ALU,
    promptSpot: 'a clear, empty area where a tablet will be placed', sizeText: 'about 25 by 18 cm',
    license: OWN, statusBar: { kind: 'tablet', height: 0.03 },
  },
  {
    id: 'monitor-27', label: 'Monitor 27 inch', objectType: 'monitor', file: 'monitor-27.glb',
    screenMM: [596.7, 335.6], screenPx: [5120, 2880], poses: ['standing'], defaultPose: 'standing', finishes: ALU,
    promptSpot: 'a clear, empty area on the desk where a large desktop monitor on a stand will be placed', sizeText: 'about 62 cm wide and 50 cm tall',
    license: OWN, statusBar: { kind: 'desktop', height: 0.018 },
  },
];

export const findDeviceModel = (id: string | null | undefined) => DEVICE_MODELS.find((m) => m.id === id) ?? null;
/** Het 3D-model voor een objecttype uit de catalogus, of null als er (nog) geen is. */
export const deviceModelFor = (objectType: string | null | undefined) => DEVICE_MODELS.find((m) => m.objectType === objectType) ?? null;

export interface DeviceCamera {
  /** Hoe hoog de camera staat, in graden boven het horizontale vlak (0 = ooghoogte, 90 = recht van boven). */
  elevation: number;
  /** Beeldhoek in graden (verticaal); klein = tele (vlak perspectief), groot = groothoek. */
  fov: number;
  /** Hoe groot het device in beeld staat: 1 = het device vult ongeveer het beeld. */
  size: number;
}

export interface DeviceLight {
  /** Licht uit de achtergrond afleiden (richting, kleur, sterkte). */
  auto: boolean;
  /** Richting van het hoofdlicht in graden rond het device (0 = van voren, 90 = van rechts). */
  azimuth: number;
  /** Hoogte van het hoofdlicht in graden. */
  elevation: number;
  /** Sterkte van het hoofdlicht, 0..2. */
  intensity: number;
  /** Kleurtemperatuur: -1 koel .. 0 neutraal .. 1 warm. */
  warmth: number;
}

export interface Device3DSpec {
  model: string;
  finish: string;
  pose: DevicePose;
  /** Openingshoek van een laptopscherm in graden (90 = rechtop). */
  lidAngle: number;
  /** Draaiing van het device rond de verticale as, in graden (0 = scherm naar de camera). */
  yaw: number;
  /** Kanteling van het device naar achteren of voren (rotatie om de X-as), in graden. */
  tilt: number;
  /** Rotatie om de Z-as (de as naar de camera): het device leunt naar links of rechts, in graden. */
  roll: number;
  camera: DeviceCamera;
  /** Positie van het device in beeld, als deel van de beeldbreedte en -hoogte (0 = midden). */
  frame: { x: number; y: number };
  /**
   * Verplaatsing in de ruimte, in meter: x naar rechts, y omhoog (zwevend boven de ondergrond), z naar de camera.
   * Anders dan 'frame' verandert dit het perspectief, zoals een device echt verschuiven op tafel.
   */
  offset: { x: number; y: number; z: number };
  /** Statusbalk of menubalk op het scherm; het ontwerp komt eronder, nooit eronder verstopt. */
  statusBar: StatusBarSpec;
  light: DeviceLight;
  /** Sterkte van de schaduw op de ondergrond, 0..1. */
  shadow: number;
  /** Hoeveel de omgeving in het device weerspiegelt, 0..1. */
  reflections: number;
}

export interface StatusBarSpec {
  show: boolean;
  /** Tijd zoals op het scherm, bijvoorbeeld 9:41. */
  time: string;
  /** Datum (tablet en menubalk), bijvoorbeeld 'ma 9 nov.'. */
  date: string;
  /** Kleur van tekst en iconen: automatisch uit het ontwerp, of vast licht of donker. */
  tone: 'auto' | 'light' | 'dark';
}

export interface CameraPreset {
  id: string;
  label: string;
  /** Beschrijving voor de AI-prompt, zodat de omgeving vanuit dezelfde hoek gefotografeerd is. */
  prompt: string;
  spec: Pick<Device3DSpec, 'yaw' | 'tilt'> & { camera: Pick<DeviceCamera, 'elevation' | 'fov'> & { size?: number }; pose?: DevicePose; roll?: number };
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'front', label: 'Front', prompt: 'photographed straight from the front at a low angle, camera only slightly above the tabletop, about 8 degrees down, with a 50mm lens', spec: { yaw: 0, tilt: 0, camera: { elevation: 8, fov: 26 } } },
  { id: 'perspective', label: 'Perspectief', prompt: 'photographed from the front and slightly to the side, camera about 20 degrees above the tabletop, with a 50mm lens', spec: { yaw: -22, tilt: 0, camera: { elevation: 20, fov: 30 } } },
  { id: 'three-quarter', label: 'Driekwart', prompt: 'photographed from a three-quarter angle, camera about 30 degrees above the tabletop and about 40 degrees to the side, with a 50mm lens', spec: { yaw: -40, tilt: 0, camera: { elevation: 30, fov: 30 } } },
  { id: 'side', label: 'Zijkant', prompt: 'photographed from the side at a low angle, camera about 10 degrees above the tabletop and about 70 degrees to the side, with a 50mm lens', spec: { yaw: -70, tilt: 0, camera: { elevation: 10, fov: 28 } } },
  { id: 'top', label: 'Bovenaanzicht', prompt: 'photographed from directly above (flat lay), looking straight down at the tabletop', spec: { yaw: 0, tilt: 0, camera: { elevation: 88, fov: 30 }, pose: 'flat' } },
  { id: 'hero', label: 'Laag standpunt', prompt: 'photographed from a low hero angle, camera just above the tabletop and slightly to the side, with an 85mm lens', spec: { yaw: -16, tilt: 0, camera: { elevation: 3, fov: 18 } } },
  { id: 'high', label: 'Schuin van boven', prompt: 'photographed from high above at an angle, camera about 55 degrees above the tabletop and slightly to the side, with a 50mm lens', spec: { yaw: -24, tilt: 0, camera: { elevation: 55, fov: 30 } } },
  { id: 'close-up', label: 'Close-up', prompt: 'photographed close up from the front and slightly to the side, camera about 24 degrees above the tabletop, with an 85mm lens, the product filling the frame', spec: { yaw: -18, tilt: 0, camera: { elevation: 24, fov: 20, size: 1.3 } } },
];

export const findCameraPreset = (id: string | null | undefined) => CAMERA_PRESETS.find((p) => p.id === id) ?? null;

/** Standaardinstellingen voor een model en camerastandpunt. */
export function defaultDeviceSpec(modelId: string, presetId = 'perspective'): Device3DSpec {
  const model = findDeviceModel(modelId) ?? DEVICE_MODELS[0]!;
  const preset = findCameraPreset(presetId) ?? CAMERA_PRESETS[1]!;
  const pose = preset.spec.pose && model.poses.includes(preset.spec.pose) ? preset.spec.pose : model.defaultPose;
  return {
    model: model.id,
    finish: model.finishes[0]!.id,
    pose,
    lidAngle: model.lid?.default ?? 90,
    yaw: preset.spec.yaw,
    tilt: preset.spec.tilt,
    roll: preset.spec.roll ?? 0,
    camera: { elevation: preset.spec.camera.elevation, fov: preset.spec.camera.fov, size: preset.spec.camera.size ?? 0.85 },
    frame: { x: 0, y: 0.04 },
    offset: { x: 0, y: 0, z: 0 },
    light: { auto: true, azimuth: -35, elevation: 50, intensity: 1, warmth: 0 },
    shadow: 0.75,
    reflections: 0.6,
    statusBar: defaultStatusBar(),
  };
}

/** Datum zoals op het scherm (Nederlands, kort): 'ma 9 nov.'. */
export function statusDate(d = new Date()): string {
  const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** Statusbalk zoals een nieuwe mockup hem krijgt: aan, 9:41, de datum van vandaag (daarna vast bewaard). */
export function defaultStatusBar(): StatusBarSpec {
  return { show: true, time: '9:41', date: statusDate(), tone: 'auto' };
}

/** Standaardwaarden voor positie en camera, met behoud van model, afwerking, houding en statusbalk (de resetknop). */
export function resetDeviceSpec(spec: Device3DSpec): Device3DSpec {
  const d = defaultDeviceSpec(spec.model);
  return { ...d, finish: spec.finish, statusBar: spec.statusBar, light: spec.light };
}

/** Beeldhoek (verticaal, graden) naar brandpuntsafstand in mm, als op een kleinbeeldcamera (24 mm beeldhoogte). */
export const focalFromFov = (fov: number) => 12 / Math.tan((fov * Math.PI) / 360);
export const fovFromFocal = (mm: number) => (360 / Math.PI) * Math.atan(12 / mm);

/** Deel van de schermhoogte dat de statusbalk inneemt (0 als hij uit staat). */
export function statusBarFraction(spec: Pick<Device3DSpec, 'model' | 'statusBar'>): number {
  const model = findDeviceModel(spec.model);
  return model && spec.statusBar?.show ? model.statusBar.height : 0;
}

/** Past een camerastandpunt toe op bestaande instellingen (afwerking, grootte en licht blijven). */
export function applyCameraPreset(spec: Device3DSpec, presetId: string): Device3DSpec {
  const preset = findCameraPreset(presetId);
  const model = findDeviceModel(spec.model);
  if (!preset || !model) return spec;
  const pose = preset.spec.pose && model.poses.includes(preset.spec.pose) ? preset.spec.pose : spec.pose === 'flat' && presetId !== 'top' ? model.defaultPose : spec.pose;
  return {
    ...spec, pose, yaw: preset.spec.yaw, tilt: preset.spec.tilt, roll: preset.spec.roll ?? 0,
    camera: { ...spec.camera, elevation: preset.spec.camera.elevation, fov: preset.spec.camera.fov, size: preset.spec.camera.size ?? (spec.camera.size > 1.2 ? 0.85 : spec.camera.size) },
  };
}

/** Welk vast standpunt past bij deze instellingen (voor de knoppen in de interface), of null. */
export function matchingPreset(spec: Device3DSpec): string | null {
  return CAMERA_PRESETS.find((p) => p.spec.yaw === spec.yaw && p.spec.camera.elevation === spec.camera.elevation && p.spec.camera.fov === spec.camera.fov && (p.spec.roll ?? 0) === (spec.roll ?? 0))?.id ?? null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Grenzen die voor elk device gelden; buiten deze waarden ziet een device er niet meer echt uit. */
export const LIMITS = {
  yaw: [-180, 180], tilt: [-30, 30], roll: [-45, 45], elevation: [0, 90], fov: [12, 60], size: [0.15, 1.6], frame: [-0.5, 0.5],
  offsetXZ: [-0.6, 0.6], offsetY: [0, 0.4],
  lightAzimuth: [-180, 180], lightElevation: [5, 85], intensity: [0, 2], warmth: [-1, 1],
} as const;

/** Houdt instellingen binnen de grenzen van het model. */
export function clampDeviceSpec(spec: Device3DSpec): Device3DSpec {
  const model = findDeviceModel(spec.model) ?? DEVICE_MODELS[0]!;
  // Oudere scènes hebben nog geen rolhoek, verplaatsing of statusbalk: die blijven zoals ze waren (balk uit).
  const off = spec.offset ?? { x: 0, y: 0, z: 0 };
  const sb = spec.statusBar;
  return {
    model: model.id,
    finish: model.finishes.some((f) => f.id === spec.finish) ? spec.finish : model.finishes[0]!.id,
    pose: model.poses.includes(spec.pose) ? spec.pose : model.defaultPose,
    lidAngle: model.lid ? clamp(spec.lidAngle, model.lid.min, model.lid.max) : 90,
    yaw: clamp(spec.yaw, ...LIMITS.yaw),
    tilt: clamp(spec.tilt, ...LIMITS.tilt),
    roll: clamp(spec.roll ?? 0, ...LIMITS.roll),
    camera: { elevation: clamp(spec.camera.elevation, ...LIMITS.elevation), fov: clamp(spec.camera.fov, ...LIMITS.fov), size: clamp(spec.camera.size, ...LIMITS.size) },
    frame: { x: clamp(spec.frame.x, ...LIMITS.frame), y: clamp(spec.frame.y, ...LIMITS.frame) },
    offset: { x: clamp(off.x, ...LIMITS.offsetXZ), y: clamp(off.y, ...LIMITS.offsetY), z: clamp(off.z, ...LIMITS.offsetXZ) },
    light: {
      auto: !!spec.light.auto,
      azimuth: clamp(spec.light.azimuth, ...LIMITS.lightAzimuth), elevation: clamp(spec.light.elevation, ...LIMITS.lightElevation),
      intensity: clamp(spec.light.intensity, ...LIMITS.intensity), warmth: clamp(spec.light.warmth, ...LIMITS.warmth),
    },
    shadow: clamp(spec.shadow, 0, 1),
    reflections: clamp(spec.reflections, 0, 1),
    statusBar: {
      show: !!sb?.show,
      time: String(sb?.time ?? '9:41').trim().slice(0, 12) || '9:41',
      date: String(sb?.date ?? '').trim().slice(0, 24),
      tone: sb?.tone === 'light' || sb?.tone === 'dark' ? sb.tone : 'auto',
    },
  };
}

/** Of twee instellingen hetzelfde 3D-beeld geven (alleen de statusbalk verschilt niet mee: die zit niet in de render). */
export function sameRender(a: Device3DSpec, b: Device3DSpec): boolean {
  const strip = (s: Device3DSpec) => JSON.stringify({ ...clampDeviceSpec(s), statusBar: null });
  return strip(a) === strip(b);
}

/** De camerazin voor de AI-prompt van de omgeving, uit de instellingen (niet alleen het preset). */
export function cameraPromptFor(spec: Device3DSpec): string {
  const e = spec.camera.elevation;
  const lens = spec.camera.fov <= 20 ? 'an 85mm lens' : spec.camera.fov >= 42 ? 'a 35mm lens' : 'a 50mm lens';
  if (e >= 75) return 'photographed from directly above (flat lay), looking straight down at the tabletop';
  const side = Math.abs(spec.yaw) < 12 ? 'straight from the front' : Math.abs(spec.yaw) < 55 ? 'from the front and slightly to the side' : 'from the side';
  return `photographed ${side}, camera about ${Math.round(e)} degrees above the tabletop, with ${lens}`;
}

/** Het 3D-device voor een configuratie, als het objecttype een model heeft en 3D gekozen is; anders null. */
export function deviceSpecFor(cfg: { objectType: string; device3d?: Device3DSpec | null }): Device3DSpec | null {
  if (!cfg.device3d) return null;
  const model = deviceModelFor(cfg.objectType);
  return model ? clampDeviceSpec({ ...cfg.device3d, model: model.id }) : null;
}

/** Varianten zonder AI (effen achtergrond) verschillen in camerastandpunt; dit is het standpunt voor variant i. */
export function variantSpec(spec: Device3DSpec, i: number): Device3DSpec {
  if (i === 0) return spec;
  const current = matchingPreset(spec) ?? 'perspective';
  const order = ['perspective', 'three-quarter', 'front', 'side', 'top'].filter((p) => p !== current);
  return applyCameraPreset(spec, order[(i - 1) % order.length]!);
}
