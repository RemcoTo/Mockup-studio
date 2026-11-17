// Smartphone (6,1 inch) en tablet (11 inch) op echte maten (meter), eigen ontwerp (geen kopie van een merk, geen
// logo). Opbouw: metalen frame met vlakke zijkanten en zachte afrondingen naar voor- en achterkant, glazen voorkant met
// een afgeronde glasrand en dunne zwarte rand, scherm met afgeronde hoeken, knoppen die uit het frame steken,
// antennebandjes, poort, speaker- en microfoongaatjes, en een cameramodule met gelaagde lenzen en flitser.
// Gebouwd liggend (voorkant +y, bovenkant -z) en daarna rechtop gezet: scherm naar +Z, onderkant op y=0,
// dikte gecentreerd rond z=0. Het scherm ('Screen') houdt de maat uit spec.ts.
import * as THREE from 'three';
import { arcProfile, flatRounded, materials, merge, part, portInsert, roundedSlab, sweep, withAO, type Materials } from './parts';

interface Lens { x: number; z: number; r: number }
interface SlateSpec {
  name: string;
  W: number; H: number; T: number; r: number;
  screenW: number; screenH: number; screenR: number;
  /** Voorcamera: in het scherm (gat dat het ontwerp afdekt) of in de rand. Afstand vanaf de bovenkant van het scherm. */
  frontCam: { from: number; r: number; inScreen: boolean };
  /** Achterkant van glas (telefoon) of uit één stuk metaal (tablet). */
  back: 'glass' | 'metal';
  /** Knoppen: zijde (-1 links, 1 rechts, 0 bovenkant), positie vanaf de bovenkant (of vanaf links bij de bovenkant), lengte. */
  buttons: { side: -1 | 0 | 1; at: number; len: number }[];
  island: { x: number; z: number; w: number; d: number; r: number; t: number } | null;
  lenses: Lens[];
  flash: { x: number; z: number; r: number } | null;
  /** Antennebandjes: zijde en positie vanaf de bovenkant. */
  antennas: { side: -1 | 1 | 'top' | 'bottom'; at: number }[];
  /** Poort in de onderkant (telefoon) of rechterzijkant (tablet). */
  port: { where: 'bottom' | 'right'; w: number; h: number };
  /** Speakergaatjes: rij gaatjes op de onderkant, of perforatie op beide korte zijden. */
  speakers: 'bottom' | 'sides';
  earpiece: boolean;
}

/** Lens met een gepolijste ring die uit de module steekt, een zwarte glaslaag met coating en een binnenring. */
function lensAssembly(l: Lens, z0: number, mat: Materials): THREE.Object3D {
  const g = new THREE.Group();
  const h = 0.0006, e = 0.00025;
  // Ring: kort buisje met een afgeronde bovenrand (draaiprofiel), naar -y (achterkant) gericht.
  const prof: THREE.Vector2[] = [new THREE.Vector2(l.r * 0.78, 0), new THREE.Vector2(l.r, 0)];
  for (let i = 0; i <= 5; i++) { const a = (Math.PI / 2) * (i / 5); prof.push(new THREE.Vector2(l.r - e + e * Math.cos(a), h - e + e * Math.sin(a))); }
  prof.push(new THREE.Vector2(l.r * 0.8, h));
  const ring = new THREE.LatheGeometry(prof, 48);
  ring.rotateX(Math.PI); // naar beneden (achterkant)
  g.add(part(withAO(ring), mat.lensRing, 'LensRing'));
  const glass = withAO(new THREE.CircleGeometry(l.r * 0.8, 48));
  glass.rotateX(Math.PI / 2); // normaal naar -y
  glass.translate(0, -h + 0.00012, 0);
  g.add(part(glass, mat.lens, 'Lens'));
  const inner = withAO(new THREE.RingGeometry(l.r * 0.34, l.r * 0.42, 48), 0.8);
  inner.rotateX(Math.PI / 2);
  inner.translate(0, -h + 0.00008, 0);
  g.add(part(inner, mat.lensRing, 'LensInner'));
  g.position.set(l.x, z0, l.z);
  return g;
}

/** Rondje (gaatje) als donker vlakje met een normaal in de gegeven richting. */
function dot(r: number, seg = 12): THREE.BufferGeometry { return withAO(new THREE.CircleGeometry(r, seg), 0.6); }

function buildSlate(s: SlateSpec, mat: Materials & { frame: THREE.MeshPhysicalMaterial }): THREE.Group {
  const root = new THREE.Group();
  root.name = s.name;
  const flat = new THREE.Group(); // liggend opgebouwd; wordt aan het eind rechtop gezet
  root.add(flat);
  const { W, H, T, r } = s;
  const rf = Math.min(0.0009, T * 0.13), rbk = Math.min(0.0011, T * 0.16);

  // Frame: achterrand, vlakke zijkant, voorrand.
  flat.add(part(sweep(W, H, r, [
    ...arcProfile(-rbk, -T / 2 + rbk, rbk, -90, 0, 6, 0.85, 1),
    ...arcProfile(-rf, T / 2 - rf, rf, 0, 90, 6),
  ], 20), mat.frame, 'Frame'));

  // Voorkant: glas met een afgeronde rand, daarbinnen het scherm.
  // Het glas sluit aan op de voorrand van het frame en loopt met een zachte ronding (2,5D) naar het vlakke deel.
  const ge = 0.00045, gy = T / 2 - 0.00002;
  flat.add(part(sweep(W - 2 * rf, H - 2 * rf, r - rf, [
    { o: 0, y: gy - 0.0004, nh: 1, nv: 0 },
    ...arcProfile(-ge, gy, ge, 0, 90, 6),
  ], 20), mat.bezel, 'GlassEdge'));
  const glass = withAO(flatRounded(W - 2 * rf - 2 * ge, H - 2 * rf - 2 * ge, Math.max(0.001, r - rf - ge), 20));
  glass.rotateX(-Math.PI / 2);
  glass.translate(0, gy + ge, 0);
  flat.add(part(glass, mat.bezel, 'Bezel'));
  const front = gy + ge;
  const screen = part(flatRounded(s.screenW, s.screenH, s.screenR, 24), mat.screen, 'Screen');
  screen.castShadow = false;
  screen.userData = { screenMM: [s.screenW * 1000, s.screenH * 1000] };
  flat.add(screen);
  // Het scherm wordt rechtop in het XY-vlak gebruikt (normaal +Z): na het rechtop zetten van 'flat' klopt dat,
  // dus hier liggend neerleggen: draaien zodat de normaal +y wordt.
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, front + 0.00004, 0);

  // Voorcamera.
  const camZ = -s.screenH / 2 + s.frontCam.from;
  const camRing = withAO(new THREE.RingGeometry(s.frontCam.r * 0.62, s.frontCam.r, 32));
  camRing.rotateX(-Math.PI / 2);
  camRing.translate(0, front + (s.frontCam.inScreen ? 0.00008 : 0.00003), camZ);
  const camGlass = withAO(new THREE.CircleGeometry(s.frontCam.r * 0.62, 32));
  camGlass.rotateX(-Math.PI / 2);
  camGlass.translate(0, front + (s.frontCam.inScreen ? 0.00009 : 0.00004), camZ);
  flat.add(part(merge([camRing, camGlass]), mat.lens, 'FrontCamera'));
  if (s.earpiece) {
    const ear = withAO(flatRounded(0.0105, 0.00055, 0.00027, 4), 0.7);
    ear.rotateX(-Math.PI / 2);
    ear.translate(0, front + 0.00002, -H / 2 + rf + ge + 0.0006);
    flat.add(part(ear, mat.port, 'Earpiece'));
  }

  // Achterkant.
  const backY = -T / 2;
  const backCap = withAO(flatRounded(W - 2 * rbk, H - 2 * rbk, r - rbk, 20));
  backCap.rotateX(Math.PI / 2);
  backCap.translate(0, backY, 0);
  flat.add(part(backCap, s.back === 'glass' ? mat.glassBack : mat.frame, 'Back'));

  // Cameramodule: verhoogd eiland met afgeronde rand, lenzen, flitser en microfoongaatje.
  let lensY = backY;
  if (s.island) {
    const i = s.island, e = Math.min(0.0007, i.t * 0.7);
    const side = sweep(i.w, i.d, i.r, [
      { o: 0, y: 0, nh: 1, nv: 0, ao: 0.55 },
      ...arcProfile(-e, i.t - e, e, 0, 90, 5),
    ], 14);
    const cap = withAO(flatRounded(i.w - 2 * e, i.d - 2 * e, Math.max(0.0005, i.r - e), 14));
    cap.rotateX(-Math.PI / 2);
    cap.translate(0, i.t, 0);
    const geo = merge([side, cap]);
    geo.rotateX(Math.PI); // naar de achterkant (-y)
    geo.translate(i.x, backY, i.z);
    flat.add(part(geo, s.back === 'glass' ? mat.glassBack : mat.frame, 'CameraIsland'));
    lensY = backY - i.t;
  }
  for (const l of s.lenses) flat.add(lensAssembly(l, lensY, mat));
  if (s.flash) {
    const f = withAO(new THREE.CircleGeometry(s.flash.r, 32));
    f.rotateX(Math.PI / 2);
    f.translate(s.flash.x, lensY - 0.00003, s.flash.z);
    flat.add(part(f, mat.flash, 'Flash'));
  }

  // Knoppen: pilvormig, steken 0,5 mm uit het frame.
  const btns: THREE.BufferGeometry[] = [];
  for (const b of s.buttons) {
    const th = Math.min(0.0028, T * 0.42), out = 0.0005;
    const g = roundedSlab({ w: 0.0014, d: b.len, h: th, r: 0.0006, rTop: 0.0005, rBottom: 0.0005, cornerSegments: 6, edgeSegments: 4 });
    g.translate(0, -th / 2, 0);
    if (b.side === 0) {
      g.rotateY(Math.PI / 2);
      g.translate(-W / 2 + b.at + b.len / 2, 0, -(H / 2 - 0.0007 + out));
    } else {
      g.translate(b.side * (W / 2 - 0.0007 + out), 0, -H / 2 + b.at + b.len / 2);
    }
    btns.push(withAO(g));
  }
  if (btns.length) flat.add(part(merge(btns), mat.frame, 'Buttons'));

  // Antennebandjes: smalle kunststof onderbrekingen in het frame.
  const bands: THREE.BufferGeometry[] = [];
  const bh = T - 2 * Math.max(rf, rbk) - 0.0002;
  for (const a of s.antennas) {
    const g = withAO(new THREE.PlaneGeometry(0.0008, bh));
    if (a.side === 'top' || a.side === 'bottom') {
      const sz = a.side === 'top' ? -1 : 1;
      if (sz > 0) g.rotateY(0); else g.rotateY(Math.PI);
      g.translate(-W / 2 + a.at, 0, sz * (H / 2 + 0.00002));
    } else {
      g.rotateY(a.side * Math.PI / 2);
      g.translate(a.side * (W / 2 + 0.00002), 0, -H / 2 + a.at);
    }
    bands.push(g);
  }
  if (bands.length) flat.add(part(merge(bands), mat.antenna, 'Antenna'));

  // Poort.
  const p = portInsert(s.port.w, s.port.h, mat, true);
  if (s.port.where === 'bottom') p.position.set(0, 0, H / 2 + 0.00003);
  else { p.rotation.y = Math.PI / 2; p.position.set(W / 2 + 0.00003, 0, 0); }
  flat.add(p);

  // Speaker- en microfoongaatjes.
  const holes: THREE.BufferGeometry[] = [];
  if (s.speakers === 'bottom') {
    for (const sgn of [-1, 1]) for (let i = 0; i < 6; i++) {
      const g = dot(0.00042);
      g.translate(sgn * (s.port.w / 2 + 0.0035 + i * 0.00155), 0, H / 2 + 0.00002);
      holes.push(g);
    }
  } else {
    for (const sgn of [-1, 1]) for (const zc of [-H * 0.28, H * 0.28]) for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const g = dot(0.00038);
      g.rotateY(sgn * Math.PI / 2);
      g.translate(sgn * (W / 2 + 0.00002), (j - 0.5) * 0.0011, zc + (i - 2) * 0.0013);
      holes.push(g);
    }
  }
  if (holes.length) flat.add(part(merge(holes), mat.port, 'Speaker'));

  // Rechtop zetten: voorkant (+y) naar +Z, bovenkant (-z) naar +Y, onderkant op y = 0.
  flat.rotation.x = Math.PI / 2;
  flat.position.set(0, H / 2, 0);
  root.updateMatrixWorld(true);
  return root;
}

function slateMaterials(): Materials & { frame: THREE.MeshPhysicalMaterial } {
  const mat = materials();
  const frame = mat.aluminium.clone();
  frame.name = 'Frame';
  return { ...mat, frame };
}

/** Smartphone van 6,1 inch: 69,6 x 144,6 x 7,8 mm, scherm 64,4 x 139,6 mm. */
export function buildPhone(): THREE.Group {
  const W = 0.0696, H = 0.1446;
  const g = buildSlate({
    name: 'Phone', W, H, T: 0.0078, r: 0.0106,
    screenW: 0.0644, screenH: 0.1396, screenR: 0.0082,
    frontCam: { from: 0.0056, r: 0.00165, inScreen: true },
    back: 'glass',
    buttons: [{ side: 1, at: 0.036, len: 0.017 }, { side: -1, at: 0.024, len: 0.0065 }, { side: -1, at: 0.037, len: 0.0105 }, { side: -1, at: 0.0505, len: 0.0105 }],
    island: { x: W / 2 - 0.0042 - 0.0105, z: -H / 2 + 0.0042 + 0.0195, w: 0.021, d: 0.039, r: 0.0105, t: 0.0011 },
    lenses: [{ x: W / 2 - 0.0042 - 0.0105, z: -H / 2 + 0.0042 + 0.0098, r: 0.0067 }, { x: W / 2 - 0.0042 - 0.0105, z: -H / 2 + 0.0042 + 0.0262, r: 0.0067 }],
    flash: { x: W / 2 - 0.0042 - 0.0105, z: -H / 2 + 0.0042 + 0.0362, r: 0.0016 },
    antennas: [{ side: -1, at: 0.012 }, { side: 1, at: 0.012 }, { side: -1, at: H - 0.012 }, { side: 1, at: H - 0.012 }, { side: 'top', at: W * 0.72 }, { side: 'bottom', at: W * 0.28 }],
    port: { where: 'bottom', w: 0.0089, h: 0.0031 },
    speakers: 'bottom',
    earpiece: true,
  }, slateMaterials());
  g.userData = { device: 'phone-6' };
  return g;
}

/** Tablet van 11 inch, liggend: 247,6 x 178,5 x 5,9 mm, scherm 237,8 x 166,1 mm. */
export function buildTablet(): THREE.Group {
  const W = 0.2476, H = 0.1785;
  const g = buildSlate({
    name: 'Tablet', W, H, T: 0.0059, r: 0.0185,
    screenW: 0.2378, screenH: 0.1661, screenR: 0.0128,
    frontCam: { from: -0.0031, r: 0.0011, inScreen: false },
    back: 'metal',
    buttons: [{ side: 0, at: 0.022, len: 0.021 }, { side: 1, at: 0.019, len: 0.0125 }, { side: 1, at: 0.034, len: 0.0125 }],
    island: { x: W / 2 - 0.0062 - 0.0105, z: -H / 2 + 0.0062 + 0.0105, w: 0.021, d: 0.021, r: 0.0062, t: 0.0009 },
    lenses: [{ x: W / 2 - 0.0062 - 0.0105 + 0.0035, z: -H / 2 + 0.0062 + 0.0105 - 0.0035, r: 0.0046 }],
    flash: { x: W / 2 - 0.0062 - 0.0105 - 0.0052, z: -H / 2 + 0.0062 + 0.0105 + 0.0052, r: 0.0013 },
    antennas: [],
    port: { where: 'right', w: 0.0089, h: 0.0031 },
    speakers: 'sides',
    earpiece: false,
  }, slateMaterials());
  g.userData = { device: 'tablet-11' };
  return g;
}
