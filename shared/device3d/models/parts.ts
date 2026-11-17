// Bouwstenen voor de devicemodellen: afgeronde behuizingen met exacte normalen, platte afgeronde vlakken en
// toetsen. Alleen gebruikt door het buildscript dat de modellen als GLB exporteert (scripts/build-devices.mjs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Punten rond een afgeronde rechthoek (tegen de klok in, gezien van boven), met de normaal naar buiten. */
function outline(w: number, d: number, r: number, seg = 10): { p: [number, number]; n: [number, number] }[] {
  const out: { p: [number, number]; n: [number, number] }[] = [];
  const hw = w / 2, hd = d / 2;
  r = Math.min(r, hw, hd);
  // Vier hoekbogen achter elkaar (x rechts, z naar voren); de rechte zijden liggen tussen de bogen.
  const arcs: [number, number, number, number][] = [
    [hw - r, -hd + r, 0, -Math.PI / 2], // rechtsachter: van +x naar -z
    [-hw + r, -hd + r, -Math.PI / 2, -Math.PI], // linksachter
    [-hw + r, hd - r, Math.PI, Math.PI / 2], // linksvoor
    [hw - r, hd - r, Math.PI / 2, 0], // rechtsvoor
  ];
  for (const [cx, cz, a0, a1] of arcs) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const nx = Math.cos(a), nz = Math.sin(a);
      out.push({ p: [cx + nx * r, cz + nz * r], n: [nx, nz] });
    }
  }
  return out;
}

export interface SlabOptions {
  w: number;
  d: number;
  h: number;
  /** Hoekradius in bovenaanzicht. */
  r: number;
  /** Radius van de afronding aan de bovenrand en de onderrand. */
  rTop?: number;
  rBottom?: number;
  cornerSegments?: number;
  edgeSegments?: number;
}

/** Afgeronde rechthoekige plaat met afgeronde randen, onderkant op y=0, gecentreerd in x en z. */
export function roundedSlab(o: SlabOptions): THREE.BufferGeometry {
  const { w, d, h } = o;
  const rt = Math.min(o.rTop ?? 0.001, h / 2), rb = Math.min(o.rBottom ?? 0.001, h / 2);
  const ring = outline(w, d, o.r, o.cornerSegments ?? 12);
  const es = o.edgeSegments ?? 6;
  // Profiel van de rand van onder naar boven: [inzet naar binnen, hoogte, normaal naar buiten, normaal omhoog].
  const prof: [number, number, number, number][] = [];
  for (let i = 0; i <= es; i++) { const t = (i / es) * (Math.PI / 2); prof.push([rb - rb * Math.sin(t), rb - rb * Math.cos(t), Math.sin(t), -Math.cos(t)]); }
  for (let i = 0; i <= es; i++) { const t = (i / es) * (Math.PI / 2); prof.push([rt - rt * Math.cos(t), h - rt + rt * Math.sin(t), Math.cos(t), Math.sin(t)]); }
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const R = ring.length, P = prof.length;
  for (const { p, n } of ring) for (const [o2, y, no, ny] of prof) {
    pos.push(p[0] - n[0] * o2, y, p[1] - n[1] * o2);
    const l = Math.hypot(no, ny) || 1;
    nor.push((n[0] * no) / l, ny / l, (n[1] * no) / l);
  }
  for (let i = 0; i < R; i++) {
    const a = i, b = (i + 1) % R;
    for (let j = 0; j < P - 1; j++) {
      const a0 = a * P + j, a1 = a * P + j + 1, b0 = b * P + j, b1 = b * P + j + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  side.setIndex(idx);
  side.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  // Deksels: plat, met hun eigen normaal (geen verloop over het grote vlak).
  const top = flatRounded(w - 2 * rt, d - 2 * rt, Math.max(0.0001, o.r - rt), o.cornerSegments ?? 12);
  top.rotateX(-Math.PI / 2); top.translate(0, h, 0);
  const bottom = flatRounded(w - 2 * rb, d - 2 * rb, Math.max(0.0001, o.r - rb), o.cornerSegments ?? 12);
  bottom.rotateX(Math.PI / 2);
  const g = mergeGeometries([fixWinding(side), top, bottom])!;
  return g;
}

/** Zorgt dat de driehoeken naar buiten wijzen (zelfde kant als de normalen). */
function fixWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), ix = g.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  let flip = 0, keep = 0;
  for (let i = 0; i < ix.count; i += 3) {
    a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
    nn.fromBufferAttribute(n, ix.getX(i));
    const fn = b.sub(a).cross(c.sub(a));
    if (fn.dot(nn) < 0) flip++; else keep++;
  }
  if (flip > keep) {
    const arr = ix.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]!; arr[i + 1] = arr[i + 2]!; arr[i + 2] = t; }
    ix.needsUpdate = true;
  }
  return g;
}

/** Plat afgerond vlak in het XY-vlak, normaal naar +Z, UV van 0 tot 1 over de rechthoek. */
export function flatRounded(w: number, h: number, r: number | [number, number, number, number], seg = 12): THREE.BufferGeometry {
  const [rtl, rtr, rbr, rbl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  s.moveTo(-hw + rbl!, -hh);
  s.lineTo(hw - rbr!, -hh);
  if (rbr) s.absarc(hw - rbr, -hh + rbr, rbr, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - rtr!);
  if (rtr) s.absarc(hw - rtr, hh - rtr, rtr, 0, Math.PI / 2, false);
  s.lineTo(-hw + rtl!, hh);
  if (rtl) s.absarc(-hw + rtl, hh - rtl, rtl, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + rbl!);
  if (rbl) s.absarc(-hw + rbl, -hh + rbl, rbl, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ShapeGeometry(s, seg);
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + hw) / w; uv[i * 2 + 1] = (p.getY(i) + hh) / h; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Indexloos samenvoegen met andere delen vraagt dezelfde attributen.
  return g.index ? g : g;
}

/**
 * Profielpunt voor sweep(): o = verschuiving naar buiten ten opzichte van de contour, y = hoogte, (nh, nv) = normaal
 * (horizontaal naar buiten, verticaal omhoog), ao = ingebakken occlusie (1 = vrij, lager = in een naad of hoek).
 */
export interface ProfilePoint { o: number; y: number; nh: number; nv: number; ao?: number }

/** Kwartcirkel (of deel) als profielpunten; hoeken in graden, normaal van het middelpunt af. */
export function arcProfile(co: number, cy: number, rad: number, a0: number, a1: number, n: number, ao0 = 1, ao1 = ao0): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * t);
    out.push({ o: co + rad * Math.cos(a), y: cy + rad * Math.sin(a), nh: Math.cos(a), nv: Math.sin(a), ao: ao0 + (ao1 - ao0) * t });
  }
  return out;
}

/**
 * Veegt een profiel langs een afgeronde rechthoek (w x d, hoekradius r) rond de y-as. Levert een gesloten band met
 * exacte normalen, vertexkleuren als occlusie en UV's 0. Scherpe randen: zet twee punten op dezelfde plek met elk
 * hun eigen normaal (of maak er aparte sweeps van met elk een eigen materiaal).
 */
export function sweep(w: number, d: number, r: number, profile: ProfilePoint[], seg = 12): THREE.BufferGeometry {
  const ring = outline(w, d, r, seg);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const R = ring.length, P = profile.length;
  for (const { p, n } of ring) for (const q of profile) {
    pos.push(p[0] + n[0] * q.o, q.y, p[1] + n[1] * q.o);
    const l = Math.hypot(q.nh, q.nv) || 1;
    nor.push((n[0] * q.nh) / l, q.nv / l, (n[1] * q.nh) / l);
    const a = q.ao ?? 1;
    col.push(a, a, a);
  }
  for (let i = 0; i < R; i++) {
    const a = i, b = (i + 1) % R;
    for (let j = 0; j < P - 1; j++) {
      // Twee punten op dezelfde plek (scherpe rand): geen driehoeken ertussen.
      if (profile[j]!.o === profile[j + 1]!.o && profile[j]!.y === profile[j + 1]!.y) continue;
      const a0 = a * P + j, a1 = a * P + j + 1, b0 = b * P + j, b1 = b * P + j + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return fixWinding(g);
}

/** Afgeronde rechthoek als pad (voor vormen en gaten), tegen de klok in. */
function roundedRectPath(path: THREE.Path, cx: number, cy: number, w: number, h: number, r: number, reverse = false) {
  const hw = w / 2, hh = h / 2;
  r = Math.max(0.00001, Math.min(r, hw, hh));
  const pts: [number, number][] = [];
  const arc = (ax: number, ay: number, a0: number) => { for (let i = 0; i <= 8; i++) { const a = a0 + (Math.PI / 2) * (i / 8); pts.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]); } };
  arc(cx + hw - r, cy - hh + r, -Math.PI / 2);
  arc(cx + hw - r, cy + hh - r, 0);
  arc(cx - hw + r, cy + hh - r, Math.PI / 2);
  arc(cx - hw + r, cy - hh + r, Math.PI);
  if (reverse) pts.reverse();
  path.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) path.lineTo(x, y);
  path.closePath();
}

export interface Hole { cx: number; cz: number; w: number; d: number; r: number }

/**
 * Plat afgerond vlak in het XZ-vlak (normaal omhoog, op y=0) met afgeronde uitsparingen; UV over de buitenmaat.
 * Gebruikt voor een bovenblad met een verzonken toetsenbord en trackpad.
 */
export function capWithHoles(w: number, d: number, r: number, holes: Hole[], color = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  roundedRectPath(shape, 0, 0, w, d, r);
  // Vorm in XY met y = -z, zodat hij na het kantelen (-90 graden om x) in het XZ-vlak ligt met de normaal omhoog.
  for (const h of holes) { const p = new THREE.Path(); roundedRectPath(p, h.cx, -h.cz, h.w, h.d, h.r, true); shape.holes.push(p); }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + w / 2) / w; uv[i * 2 + 1] = 1 - (p.getZ(i) + d / 2) / d; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return withAO(g, color);
}

/**
 * Uitsparing in een plat blad: een schuine gefreesde rand (glanzend), een korte wand naar beneden en een bodem.
 * Ligt onder y=0; de bovenrand valt samen met het gat in capWithHoles. Geeft drie delen: rand, wand, bodem.
 */
export function recess(h: Hole, depth: number, chamfer: number, seg = 10): { edge: THREE.BufferGeometry; wall: THREE.BufferGeometry; floor: THREE.BufferGeometry } {
  const c = chamfer, inward = -1;
  const edge = sweep(h.w, h.d, h.r, [
    { o: 0, y: 0, nh: inward * 0.7071, nv: 0.7071 },
    { o: -c, y: -c, nh: inward * 0.7071, nv: 0.7071 },
  ], seg);
  const wall = sweep(h.w, h.d, h.r, [
    { o: -c, y: -c, nh: inward, nv: 0, ao: 0.95 },
    { o: -c, y: -depth, nh: inward, nv: 0, ao: 0.35 },
  ], seg);
  const floor = flatRounded(h.w - 2 * c, h.d - 2 * c, Math.max(0.0002, h.r - c), seg);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, -depth, 0);
  for (const g of [edge, wall]) g.translate(h.cx, 0, h.cz);
  floor.translate(h.cx, 0, h.cz);
  return { edge, wall, floor: withAO(floor, 1) };
}

/** Geeft een geometrie een (egale) occlusiekleur als die er nog geen heeft; nodig om delen samen te voegen. */
export function withAO(g: THREE.BufferGeometry, value = 1): THREE.BufferGeometry {
  if (!g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count * 3).fill(value), 3));
  return g;
}

/** Planaire UV's op x en z binnen een rechthoek (bijvoorbeeld een toetsenbordtextuur over alle toetsen). */
export function planarUV(g: THREE.BufferGeometry, x0: number, x1: number, z0: number, z1: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - x0) / (x1 - x0); uv[i * 2 + 1] = 1 - (p.getZ(i) - z0) / (z1 - z0); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Geeft een mesh een naam en materiaal; het materiaal herkent de studio later aan zijn naam. */
export function part(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Voegt geometrieën samen (allemaal geïndexeerd of allemaal niet). */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Alle delen dezelfde attributen: wie geen occlusiekleur heeft, krijgt 1.
  const hasColor = list.some((g) => g.getAttribute('color'));
  const norm = list.map((g) => (hasColor ? withAO(g) : g));
  const allIndexed = norm.every((g) => g.index);
  return mergeGeometries(allIndexed ? norm : norm.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/**
 * Benoemde materialen (PBR); de studio past ze bij het renderen aan (afwerking, scherm, reflecties). Occlusie zit als
 * vertexkleur in de geometrie en vermenigvuldigt de kleur.
 */
export function materials() {
  const m = <T extends THREE.Material>(mat: T, name: string) => { mat.name = name; return mat; };
  return {
    // Geparelstraald, geanodiseerd aluminium: volledig metaal, fijn mat.
    aluminium: m(new THREE.MeshPhysicalMaterial({ color: '#c9cbcf', metalness: 1, roughness: 0.34 }), 'Aluminium'),
    // Gefreesde glansrand: hetzelfde metaal, gepolijst.
    chamfer: m(new THREE.MeshPhysicalMaterial({ color: '#d4d6da', metalness: 1, roughness: 0.1 }), 'Chamfer'),
    // Glas voor het scherm: zwart, glanzend, met de reflectie van glas (geen metaal).
    bezel: m(new THREE.MeshPhysicalMaterial({ color: '#030304', metalness: 0, roughness: 0.04, ior: 1.52, specularIntensity: 1 }), 'Bezel'),
    screen: m(new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: '#00d84a', emissiveIntensity: 1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }), 'Screen'),
    // Toetsen: satijnmat kunststof; de opdruk komt uit de toetsenbordtextuur.
    keys: m(new THREE.MeshPhysicalMaterial({ color: '#17181b', metalness: 0, roughness: 0.4, specularIntensity: 0.7 }), 'Keys'),
    well: m(new THREE.MeshPhysicalMaterial({ color: '#0b0c0e', metalness: 0, roughness: 0.6 }), 'KeyboardWell'),
    // Glazen trackpad met een matte coating in de kleur van de behuizing.
    trackpad: m(new THREE.MeshPhysicalMaterial({ color: '#c9cbcf', metalness: 1, roughness: 0.27, clearcoat: 0.15, clearcoatRoughness: 0.35 }), 'Trackpad'),
    gap: m(new THREE.MeshStandardMaterial({ color: '#101113', metalness: 0, roughness: 0.8 }), 'Gap'),
    grille: m(new THREE.MeshStandardMaterial({ color: '#1b1c1f', metalness: 0, roughness: 0.85 }), 'Grille'),
    hinge: m(new THREE.MeshPhysicalMaterial({ color: '#2a2b2f', metalness: 0.85, roughness: 0.32 }), 'Hinge'),
    port: m(new THREE.MeshStandardMaterial({ color: '#060607', metalness: 0.1, roughness: 0.7 }), 'Port'),
    portTongue: m(new THREE.MeshStandardMaterial({ color: '#26272b', metalness: 0.2, roughness: 0.5 }), 'PortTongue'),
    gasket: m(new THREE.MeshStandardMaterial({ color: '#141518', metalness: 0, roughness: 0.75 }), 'Gasket'),
    lens: m(new THREE.MeshPhysicalMaterial({ color: '#05060a', metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.6, iridescenceIOR: 1.6 }), 'Lens'),
    lensRing: m(new THREE.MeshPhysicalMaterial({ color: '#8d9096', metalness: 1, roughness: 0.18 }), 'LensRing'),
    glassBack: m(new THREE.MeshPhysicalMaterial({ color: '#c7c9cd', metalness: 0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.35 }), 'GlassBack'),
    rubber: m(new THREE.MeshStandardMaterial({ color: '#111214', metalness: 0, roughness: 0.95 }), 'Rubber'),
    // Antennebandjes in het metalen frame (kunststof), de flitser en de zwarte rand van het glas.
    antenna: m(new THREE.MeshStandardMaterial({ color: '#5a5c61', metalness: 0, roughness: 0.55 }), 'Antenna'),
    flash: m(new THREE.MeshPhysicalMaterial({ color: '#e9e3d2', metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }), 'Flash'),
  };
}
export type Materials = ReturnType<typeof materials>;

/** Poort als inzet in een zijwand: glanzende rand, donkere opening en (bij USB-C) een tong. */
export function portInsert(w: number, h: number, mat: Materials, tongue: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const rim = capWithHoles(w + 0.0007, h + 0.0007, (h + 0.0007) / 2, [{ cx: 0, cz: 0, w, d: h, r: h / 2 }]);
  rim.rotateX(Math.PI / 2);
  g.add(part(rim, mat.chamfer, 'PortRim'));
  const hole = withAO(flatRounded(w, h, h / 2, 8), 0.6);
  hole.translate(0, 0, -0.00002);
  g.add(part(hole, mat.port, 'Port'));
  if (tongue) {
    const t = withAO(flatRounded(w * 0.64, h * 0.26, h * 0.12, 4), 0.8);
    t.translate(0, 0, 0.00001);
    g.add(part(t, mat.portTongue, 'PortTongue'));
  }
  return g;
}


/**
 * Gefreesde plaat: zachte onderrand (radius rb), rechte zijkant, smalle gepolijste facetrand (c) bovenaan, vlakke
 * boven- en onderkant. Onderkant op y=0. Geeft de delen apart, zodat de facetrand een eigen (glanzend) materiaal krijgt.
 */
export function machinedSlab(o: { w: number; d: number; h: number; r: number; rb: number; c: number; seg?: number; aoBottom?: number }) {
  const { w, d, h, r, rb, c } = o, seg = o.seg ?? 14;
  const shell = sweep(w, d, r, [
    ...arcProfile(-rb, rb, rb, -90, 0, 6, o.aoBottom ?? 0.6, 0.95),
    { o: 0, y: h - c, nh: 1, nv: 0, ao: 1 },
  ], seg);
  const chamfer = sweep(w, d, r, [{ o: 0, y: h - c, nh: 0.7071, nv: 0.7071 }, { o: -c, y: h, nh: 0.7071, nv: 0.7071 }], seg);
  const top = withAO(flatRounded(w - 2 * c, d - 2 * c, Math.max(0.0002, r - c), seg));
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, 0);
  const bottom = withAO(flatRounded(w - 2 * rb, d - 2 * rb, Math.max(0.0002, r - rb), seg), o.aoBottom ?? 0.6);
  bottom.rotateX(Math.PI / 2);
  return { body: merge([shell, top, bottom]), chamfer };
}
