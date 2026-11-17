// Rendert een 3D-device met Three.js, in de browser (live in de editor) en op de server (headless Chromium).
// Beide gebruiken deze code, zodat wat je in de editor ziet en wat de server maakt hetzelfde is.
//
// Lagen:
// - device: het device met zijn schaduw op de ondergrond, op een transparante achtergrond. Achtergrondpixels raakt
//   de studio niet aan: de laag gaat er na het renderen bovenop.
// - masker: welk deel van het beeld schermvlak is (wit), inclusief afdekking door andere delen.
// - schermhoeken: de vier hoeken van het actieve scherm in beeldpixels. Daarop plaatst de bestaande pipeline het
//   ontwerp perspectiefcorrect en pixel-exact.
import * as THREE from 'three';
import type { Quad } from '../geometry';
import { findDeviceModel, type Device3DSpec } from './spec';

export interface LightEstimate {
  azimuth: number;
  elevation: number;
  intensity: number;
  warmth: number;
  /** Gemiddelde helderheid van de omgeving (0..1). */
  ambient: number;
}

export type ScreenMode = 'chroma' | 'design' | 'dark';

const SCREEN_GREEN = new THREE.Color().setRGB(0, 0.86, 0.29, THREE.SRGBColorSpace);
const deg = THREE.MathUtils.degToRad;

/** Leidt lichtrichting, -kleur en -sterkte af uit een (verkleinde) achtergrond. */
export function estimateLight(img: CanvasImageSource | null, w = 96, h = 64): LightEstimate {
  const fallback: LightEstimate = { azimuth: -35, elevation: 50, intensity: 1, warmth: 0, ambient: 0.6 };
  if (!img || typeof document === 'undefined') return fallback;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { L[i] = (0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!) / 255; sum += L[i]!; }
  const mean = sum / (w * h);
  const sorted = Float32Array.from(L).sort();
  const thr = sorted[Math.floor(sorted.length * 0.92)]!;
  let cx = 0, cy = 0, n = 0, r = 0, b = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (L[i]! < thr) continue;
    cx += x; cy += y; n++; r += d[i * 4]!; b += d[i * 4 + 2]!;
  }
  if (!n) return { ...fallback, ambient: mean };
  cx /= n * (w - 1); cy /= n * (h - 1);
  const spread = thr - mean;
  return {
    azimuth: Math.round((cx - 0.5) * 150),
    elevation: Math.round(Math.min(75, Math.max(20, 72 - cy * 55))),
    // Een duidelijk lichtere plek (raam, lamp) geeft een sterker hoofdlicht; vlak licht een zachter.
    intensity: Math.min(1.5, Math.max(0.55, 0.65 + spread * 1.6)),
    warmth: Math.max(-1, Math.min(1, ((r - b) / Math.max(1, r + b)) * 6)),
    ambient: mean,
  };
}

function warmthColor(w: number): THREE.Color {
  return w >= 0 ? new THREE.Color(1, 1 - 0.08 * w, 1 - 0.2 * w) : new THREE.Color(1 + 0.16 * w, 1 + 0.06 * w, 1);
}

/** Gemiddelde kleur (lineair, 0..1) van drie banden van de achtergrond: boven (wand), midden, onder (ondergrond). */
function bandColors(bg: CanvasImageSource | null): { top: THREE.Color; mid: THREE.Color; bottom: THREE.Color } {
  const fallback = { top: new THREE.Color(0.62, 0.62, 0.63), mid: new THREE.Color(0.5, 0.5, 0.51), bottom: new THREE.Color(0.32, 0.31, 0.3) };
  if (!bg || typeof document === 'undefined') return fallback;
  const w = 32, h = 32;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(bg, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const band = (y0: number, y1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++; }
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  };
  return { top: band(0, 0.3), mid: band(0.4, 0.6), bottom: band(0.75, 1) };
}

let softbox: THREE.Texture | null = null;
/** Witte rechthoek met een zachte rand, als textuur voor de softboxen (eenmalig gemaakt). */
function softboxTexture(): THREE.Texture | null {
  if (softbox || typeof document === 'undefined') return softbox;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ex = Math.min(x, n - 1 - x) / (n * 0.22), ey = Math.min(y, n - 1 - y) / (n * 0.22);
    const a = Math.min(1, ex) * Math.min(1, ey);
    const v = a * a * (3 - 2 * a);
    const i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, 0, 0);
  softbox = new THREE.CanvasTexture(c);
  return softbox;
}

/**
 * Omgeving voor reflecties, opgebouwd als een fotostudio: een ruimte in de kleuren van de achtergrond (wand boven,
 * ondergrond onder) met grote softboxen: een hoofdlicht uit de richting van het licht in de scène, een groot
 * bovenlicht, twee striplichten schuin achter voor de glanslijnen langs randen en afrondingen, en een zwakke
 * reflectiekaart vóór het product zodat ook de voorkant tekening houdt. Zo krijgen metaal en glas het verloop en de
 * hooglichten van een productfoto in plaats van een egale of zwarte reflectie.
 */
function environmentScene(bg: CanvasImageSource | null, light: LightEstimate, keyDir: THREE.Vector3): THREE.Scene {
  const s = new THREE.Scene();
  const { top, mid, bottom } = bandColors(bg);
  // Studioruimte: een bol met een verloop van plafond via wand naar vloer, in de tinten van de achtergrond.
  const ceiling = top.clone().lerp(new THREE.Color(1, 1, 1), 0.25).multiplyScalar(0.85);
  const horizon = mid.clone().multiplyScalar(0.8);
  const floor = bottom.clone().multiplyScalar(0.55);
  const geo = new THREE.SphereGeometry(40, 64, 32);
  const pos = geo.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 40; // -1 (onder) .. 1 (boven)
    if (y >= 0) c.copy(horizon).lerp(ceiling, Math.pow(y, 0.7));
    else c.copy(horizon).lerp(floor, Math.min(1, Math.pow(-y, 0.35)));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // Softboxen (HDR: sterker dan 1, zodat ze als hooglicht in metaal en glas verschijnen).
  const col = warmthColor(light.warmth);
  // Softbox met een zachte rand (doek met falloff): geeft vloeiende hooglichten in plaats van harde rechthoeken.
  const feather = softboxTexture();
  const box = (w: number, h: number, pos: THREE.Vector3, intensity: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(intensity), map: feather, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(pos); m.lookAt(0, 0, 0);
    s.add(m);
  };
  const I = light.intensity;
  box(16, 11, keyDir.clone().setY(Math.max(0.35, keyDir.y)).normalize().multiplyScalar(20), 5.5 * I); // hoofdlicht
  box(22, 13, new THREE.Vector3(0, 24, 2), 2.4); // bovenlicht
  box(3.2, 20, new THREE.Vector3(-17, 7, -9), 3.4); // striplicht links achter
  box(3.2, 20, new THREE.Vector3(17, 7, -9), 3.4); // striplicht rechts achter
  box(40, 12, new THREE.Vector3(-keyDir.x * 6, 5, 22), 1.35); // reflectiekaart vóór het product
  box(30, 12, new THREE.Vector3(0, 11, -22), 1.6); // groot doek schuin achter: het verloop over vlakke delen
  return s;
}

/** Eenvoudige drievoudige boxblur op een grijswaardenbuffer (overal gelijk, ook zonder canvasfilters). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a: Float32Array = src, b: Float32Array = new Float32Array(src.length);
  const R = Math.max(1, Math.round(r));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -R; x <= R; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * R + 1);
        acc += a[y * w + Math.min(w - 1, x + R + 1)]! - a[y * w + Math.max(0, x - R)]!;
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += a[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / (2 * R + 1);
        acc += a[Math.min(h - 1, y + R + 1) * w + x]! - a[Math.max(0, y - R) * w + x]!;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

export interface StageOptions {
  width: number;
  height: number;
  /** Achtergrond voor reflecties en lichtschatting (mag verkleind zijn). */
  environment?: CanvasImageSource | null;
}

/** Resultaat van het neerzetten van een device: het midden (na verplaatsing), de cameraafstand en de maat. */
export interface Framing { target: THREE.Vector3; dist: number; R: number; box: THREE.Box3 }

/**
 * Zet het device neer en richt de camera, voor renderen én meten: pose (plat, rechtop), kanteling (X), rolhoek (Z)
 * en draaiing (Y), op de ondergrond, de camera op de gekozen hoogte en afstand, de positie in beeld via het richtpunt
 * (geen verschoven lens, zodat het optische midden in het midden blijft), en tot slot de verplaatsing in de ruimte.
 * Die laatste stap komt ná het richten: verschuiven op tafel verandert dan echt het perspectief.
 */
export function frameDevice(yawGroup: THREE.Object3D, poseGroup: THREE.Object3D, device: THREE.Object3D, lid: THREE.Object3D | null, spec: Device3DSpec, cam: THREE.PerspectiveCamera, aspect: number): Framing {
  const poseX = spec.pose === 'flat' ? -Math.PI / 2 : 0;
  // Volgorde: eerst de pose en kanteling (X), dan de rolhoek (Z); de draaiing (Y) zit in de groep erboven.
  poseGroup.rotation.set(poseX - deg(spec.tilt), 0, deg(spec.roll ?? 0), 'ZYX');
  yawGroup.rotation.set(0, deg(spec.yaw), 0);
  if (lid) lid.rotation.set(-deg(spec.lidAngle - 90), 0, 0);
  // Op de ondergrond zetten en centreren.
  yawGroup.position.set(0, 0, 0);
  yawGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(device);
  const center = box.getCenter(new THREE.Vector3());
  yawGroup.position.set(-center.x, -box.min.y, -center.z);
  yawGroup.updateMatrixWorld(true);
  box.setFromObject(device);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const R = sphere.radius;

  // Camera: vóór het device, op de gekozen hoogte, gericht op het midden; grootte via de afstand.
  const e = deg(Math.min(89.5, spec.camera.elevation));
  cam.fov = spec.camera.fov;
  cam.aspect = aspect;
  const halfV = Math.tan(deg(spec.camera.fov) / 2);
  const dist = R / (spec.camera.size * halfV * Math.min(1, aspect));
  const target = sphere.center.clone();
  cam.position.set(target.x, target.y + Math.sin(e) * dist, target.z + Math.cos(e) * dist);
  cam.up.set(0, Math.cos(e), -Math.sin(e));
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const upV = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const aim = target.clone()
    .addScaledVector(right, -spec.frame.x * 2 * dist * halfV * aspect)
    .addScaledVector(upV, spec.frame.y * 2 * dist * halfV);
  cam.lookAt(aim);
  // Verplaatsing in de ruimte (na het richten): naar rechts, omhoog en naar de camera.
  const off = spec.offset ?? { x: 0, y: 0, z: 0 };
  yawGroup.position.add(new THREE.Vector3(off.x, off.y, off.z));
  yawGroup.updateMatrixWorld(true);
  box.setFromObject(device);
  const moved = target.clone().add(new THREE.Vector3(off.x, off.y, off.z));
  const reach = Math.hypot(off.x, off.y, off.z);
  cam.near = Math.max(0.002, dist - R * 3 - reach);
  cam.far = dist + R * 30 + reach;
  cam.clearViewOffset();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return { target: moved, dist, R, box };
}

/** Maat van een device in beeld: grenzen als deel van de beeldbreedte en -hoogte (0..1), cameraafstand en straal. */
export interface DeviceMeasure { left: number; right: number; top: number; bottom: number; dist: number; R: number }

/**
 * Meet waar het device in beeld staat met de gegeven instellingen, zonder te renderen: alle hoekpunten van het model
 * geprojecteerd (bij grote modellen een steekproef). Voor uitlijnen, breedte en hoogte in beeld en de cameraafstand.
 */
export function measureDevice(model: THREE.Object3D, spec: Device3DSpec, aspect: number): DeviceMeasure {
  const yaw = new THREE.Group(), pose = new THREE.Group();
  yaw.add(pose);
  pose.add(model);
  const cam = new THREE.PerspectiveCamera();
  const lid = model.getObjectByName('Lid') ?? null;
  const f = frameDevice(yaw, pose, model, lid, spec, cam, aspect);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(cam);
      const x = (v.x + 1) / 2, y = (1 - v.y) / 2;
      if (x < left) left = x; if (x > right) right = x;
      if (y < top) top = y; if (y > bottom) bottom = y;
    }
  });
  pose.remove(model);
  return { left, right, top, bottom, dist: f.dist, R: f.R };
}

export class DeviceStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private yawGroup = new THREE.Group();
  private poseGroup = new THREE.Group();
  private device: THREE.Object3D | null = null;
  private lid: THREE.Object3D | null = null;
  private screen: THREE.Mesh | null = null;
  private key = new THREE.DirectionalLight('#ffffff', 2.4);
  private fill = new THREE.HemisphereLight('#ffffff', '#3a3631', 0.25);
  private catcher: THREE.Mesh;
  private contact: THREE.Mesh;
  private contactTex: THREE.DataTexture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envSource: CanvasImageSource | null = null;
  private envSourceKey = '';
  private builtEnvKey = '';
  light: LightEstimate = estimateLight(null);
  private screenMaterial: THREE.MeshPhysicalMaterial;
  private designTexture: THREE.Texture | null = null;
  spec: Device3DSpec | null = null;
  width = 1;
  height = 1;

  constructor(readonly renderer: THREE.WebGLRenderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: bedoeld voor productbeelden; kleuren van materialen blijven kloppen.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.add(this.yawGroup);
    this.yawGroup.add(this.poseGroup);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 10;
    this.key.shadow.blurSamples = 20;
    this.key.shadow.bias = -0.0004;
    this.scene.add(this.key, this.key.target, this.fill);
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.4, depthWrite: false }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.receiveShadow = true;
    this.catcher.renderOrder = -2;
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, depthWrite: false, toneMapped: false }));
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.00005;
    this.contact.renderOrder = -1;
    this.scene.add(this.catcher, this.contact);
    this.screenMaterial = new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: SCREEN_GREEN, emissiveIntensity: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, toneMapped: false });
    this.screenMaterial.name = 'Screen';
  }

  /** Zet het geladen model (GLB-scène) neer. */
  setDevice(object: THREE.Object3D) {
    if (this.device) this.poseGroup.remove(this.device);
    this.device = object;
    this.poseGroup.add(object);
    this.lid = object.getObjectByName('Lid') ?? null;
    this.screen = null;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.name !== 'Screen';
      m.receiveShadow = false;
      if (m.name === 'Screen' || (m.material as THREE.Material).name === 'Screen') { this.screen = m; m.material = this.screenMaterial; }
    });
    if (!this.screen) throw new Error('Het model heeft geen mesh met de naam Screen.');
  }

  setSize(width: number, height: number) {
    this.width = width; this.height = height;
    this.camera.aspect = width / height;
  }

  /** Omgeving voor reflecties en lichtschatting (de achtergrond van de scène, verkleind volstaat). */
  setEnvironment(img: CanvasImageSource | null, key = '') {
    this.envSource = img;
    this.light = estimateLight(img);
    this.envSourceKey = `${key}|${Math.random()}`; // nieuwe omgeving: bij de volgende update opnieuw opbouwen
  }

  /** Ontwerp op het scherm (live voorbeeld); null = groen schermvlak voor de definitieve render. */
  setScreen(mode: ScreenMode, texture: THREE.Texture | null = null) {
    this.designTexture = texture;
    const m = this.screenMaterial;
    if (mode === 'design' && texture) { m.emissive.set('#ffffff'); m.emissiveMap = texture; }
    else if (mode === 'dark') { m.emissive.set('#020203'); m.emissiveMap = null; }
    else { m.emissive.copy(SCREEN_GREEN); m.emissiveMap = null; }
    m.needsUpdate = true;
  }

  private effectiveLight(spec: Device3DSpec) {
    return spec.light.auto ? { ...this.light, intensity: this.light.intensity * spec.light.intensity } : { azimuth: spec.light.azimuth, elevation: spec.light.elevation, intensity: spec.light.intensity, warmth: spec.light.warmth, ambient: this.light.ambient };
  }

  /** Past de instellingen toe: afwerking, pose, deksel, camera, licht en schaduw. */
  update(spec: Device3DSpec) {
    if (!this.device) throw new Error('Geen model geladen.');
    this.spec = spec;
    const model = findDeviceModel(spec.model);
    const finish = model?.finishes.find((f) => f.id === spec.finish) ?? model?.finishes[0];
    // Afwerking en reflecties.
    this.device.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (finish && (mat.name === 'Aluminium' || mat.name === 'Trackpad' || mat.name === 'Frame' || mat.name === 'GlassBack')) {
          mat.color.set(finish.body);
          if (mat.name === 'Aluminium' || mat.name === 'Frame') mat.roughness = finish.roughness;
        }
        // Gepolijste randen: dezelfde kleur als de behuizing, iets lichter (gepolijst metaal kaatst meer terug).
        if (finish && mat.name === 'Trackpad') mat.color.multiplyScalar(0.9);
        if (finish && mat.name === 'Chamfer') mat.color.set(finish.body).lerp(new THREE.Color('#ffffff'), 0.12);
        if ('envMapIntensity' in mat) mat.envMapIntensity = 0.3 + spec.reflections * 0.95;
      }
    });
    this.screenMaterial.envMapIntensity = 0.15 + spec.reflections * 0.9;

    // Pose, rotaties, plaats op de ondergrond, verplaatsing en camera: dezelfde berekening als bij het meten.
    const { target, R, box } = frameDevice(this.yawGroup, this.poseGroup, this.device, this.lid, spec, this.camera, this.width / this.height);

    // Licht: richting ten opzichte van de camera (0 = van voren), kleur en sterkte.
    const L = this.effectiveLight(spec);
    const la = deg(L.azimuth), le = deg(L.elevation);
    const dir = new THREE.Vector3(Math.sin(la) * Math.cos(le), Math.sin(le), Math.cos(la) * Math.cos(le));
    this.key.position.copy(target).addScaledVector(dir, R * 6);
    this.key.target.position.copy(target);
    this.key.color.copy(warmthColor(L.warmth));
    this.key.intensity = 1.7 * L.intensity;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -R * 2.4; sc.right = R * 2.4; sc.top = R * 2.4; sc.bottom = -R * 2.4;
    // Ook een zwevend device: de ondergrond moet binnen bereik van de schaduwkaart blijven.
    sc.near = R * 2; sc.far = R * 10 + (spec.offset?.y ?? 0) * 4;
    sc.left -= (spec.offset?.y ?? 0); sc.right += (spec.offset?.y ?? 0); sc.top += (spec.offset?.y ?? 0); sc.bottom -= (spec.offset?.y ?? 0);
    sc.updateProjectionMatrix();
    // Zachte slagschaduw zoals onder een grote softbox: de halfschaduw groeit met de hoogte van het device
    // (een monitorpaneel op 10 tot 45 cm boven het bureau geeft een veel zachtere schaduw dan een liggende telefoon).
    // De vervaging ligt vast in pixels van de schaduwkaart; de resolutie van de kaart bepaalt hoe breed dat is.
    // Hoogte boven de ondergrond (ook als het device zweeft): hoe hoger, hoe zachter de schaduw.
    const height = Math.max(0, box.max.y);
    const blurWorld = Math.max(0.004, 0.14 * height) * (1 + (1 - Math.min(1, L.intensity)) * 0.6);
    const radius = 16;
    const want = (4.8 * R) / (blurWorld / radius);
    const mapSize = Math.min(2048, Math.max(256, 2 ** Math.round(Math.log2(want))));
    if (this.key.shadow.mapSize.x !== mapSize) {
      this.key.shadow.mapSize.set(mapSize, mapSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
      this.key.shadow.mapPass?.dispose();
      this.key.shadow.mapPass = null;
    }
    this.key.shadow.radius = radius * (want / mapSize);
    this.key.shadow.blurSamples = 24;
    this.fill.intensity = 0.25 + L.ambient * 0.35;
    this.fill.color.copy(warmthColor(L.warmth * 0.5));

    // Ondergrond: schaduwvanger en contactschaduw.
    // Binnen het bereik van de schaduwkaart blijven: daarbuiten geeft de vervaagde kaart een rand.
    this.catcher.scale.set(R * 4.2, R * 4.2, 1);
    this.catcher.position.set(target.x, 0, target.z);
    (this.catcher.material as THREE.ShadowMaterial).opacity = 0.42 * spec.shadow;
    this.updateContactShadow(spec.shadow);

    // Omgeving opnieuw opbouwen als licht of achtergrond veranderd is.
    const envKey = `${this.envSourceKey}|${L.azimuth}|${L.elevation}|${L.warmth.toFixed(2)}|${L.intensity.toFixed(2)}`;
    if (envKey !== this.builtEnvKey || !this.envTarget) {
      this.envTarget?.dispose();
      const envScene = environmentScene(this.envSource, L, dir);
      this.envTarget = this.pmrem.fromScene(envScene, 0.02);
      this.scene.environment = this.envTarget.texture;
      this.builtEnvKey = envKey;
      envScene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const map = (m.material as THREE.MeshBasicMaterial).map; if (map && map !== softbox) map.dispose(); (m.material as THREE.Material).dispose(); } });
    }
    this.scene.environmentIntensity = 0.8 + L.ambient * 0.3;
  }

  /** Zachte contactschaduw: het deel van het device vlak boven de grond, van onderen gezien en vervaagd. */
  private updateContactShadow(strength: number) {
    if (!this.device) return;
    const box = new THREE.Box3().setFromObject(this.device);
    const size = box.getSize(new THREE.Vector3());
    const margin = Math.max(size.x, size.z) * 0.25;
    const w = size.x + margin * 2, d = size.z + margin * 2;
    const res = 256;
    const px = Math.round(res * Math.min(1, w / d)), pz = Math.round(res * Math.min(1, d / w));
    // Van boven gezien, maar alleen de onderste 12 mm (near/far): wat dicht bij de grond zit, geeft contactschaduw.
    const slab = 0.012;
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, slab);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    cam.position.set(cx, slab, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    const rt = new THREE.WebGLRenderTarget(px, pz);
    const r = this.renderer;
    const prev = { target: r.getRenderTarget(), clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), shadow: r.shadowMap.enabled, tone: r.toneMapping };
    const swap = this.swapMaterials(() => new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
    const hidden = [this.catcher, this.contact].filter((m) => m.visible);
    hidden.forEach((m) => (m.visible = false));
    r.shadowMap.enabled = false;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, cam);
    const buf = new Uint8Array(px * pz * 4);
    r.readRenderTargetPixels(rt, 0, 0, px, pz, buf);
    r.setRenderTarget(prev.target);
    r.setClearColor(prev.clear, prev.alpha);
    r.shadowMap.enabled = prev.shadow;
    r.toneMapping = prev.tone;
    hidden.forEach((m) => (m.visible = true));
    swap();
    rt.dispose();
    const src = new Float32Array(px * pz);
    for (let i = 0; i < px * pz; i++) src[i] = buf[i * 4]! / 255;
    const tight = blur(src, px, pz, res / 120), wide = blur(src, px, pz, res / 26);
    const out = new Uint8Array(px * pz * 4);
    for (let i = 0; i < px * pz; i++) {
      const a = Math.min(1, tight[i]! * 0.75 + wide[i]! * 0.45) * strength;
      // alphaMap leest het groene kanaal; alle kanalen gelijk houdt het eenduidig.
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = Math.round(a * 255);
    }
    this.contactTex?.dispose();
    const tex = new THREE.DataTexture(out, px, pz, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    this.contactTex = tex;
    const mat = this.contact.material as THREE.MeshBasicMaterial;
    mat.alphaMap = tex; mat.needsUpdate = true;
    // De kaart is van boven genomen met -z boven in beeld; het vlak ligt net zo (bovenkant textuur naar -z).
    this.contact.scale.set(w, d, 1);
    this.contact.position.set(cx, 0.00005, cz);
    this.contact.rotation.set(-Math.PI / 2, 0, 0);
  }

  /** Vervangt alle materialen tijdelijk; geeft een functie terug die ze herstelt. */
  private swapMaterials(make: (mesh: THREE.Mesh) => THREE.Material | null): () => void {
    const saved: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    this.device?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const next = make(m);
      if (!next) return;
      saved.push([m, m.material]);
      m.material = next;
    });
    return () => { for (const [m, mat] of saved) { (m.material as THREE.Material).dispose(); m.material = mat; } };
  }

  /** Rendert het device met schaduw op een transparante achtergrond, in de huidige canvasgrootte. */
  renderDevice() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /** Rendert het schermmasker: wit waar het scherm zichtbaar is, zwart elders (ook waar iets het scherm afdekt). */
  renderMask() {
    const r = this.renderer;
    const tone = r.toneMapping, shadow = r.shadowMap.enabled;
    const swap = this.swapMaterials((m) => new THREE.MeshBasicMaterial({ color: m === this.screen ? '#ffffff' : '#000000', side: THREE.FrontSide }));
    const vis = [this.catcher, this.contact];
    vis.forEach((m) => (m.visible = false));
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = false;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.camera);
    r.setClearColor(0x000000, 0);
    r.toneMapping = tone;
    r.shadowMap.enabled = shadow;
    vis.forEach((m) => (m.visible = true));
    swap();
  }

  /** Hoeken van het actieve scherm in beeldpixels: linksboven, rechtsboven, rechtsonder, linksonder. */
  screenQuad(): Quad {
    if (!this.screen) throw new Error('Geen scherm.');
    const g = this.screen.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const pts: [number, number][] = [[b.min.x, b.max.y], [b.max.x, b.max.y], [b.max.x, b.min.y], [b.min.x, b.min.y]];
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    return pts.map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(this.screen!.matrixWorld).project(this.camera);
      return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height];
    }) as Quad;
  }

  /** Ziet de camera de voorkant van het scherm? */
  screenFacesCamera(): boolean {
    if (!this.screen) return false;
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.screen.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(this.screen.matrixWorld);
    return n.dot(this.camera.position.clone().sub(p)) > 0;
  }

  dispose() {
    this.envTarget?.dispose();
    this.contactTex?.dispose();
    this.pmrem.dispose();
    this.designTexture = null;
  }
}
