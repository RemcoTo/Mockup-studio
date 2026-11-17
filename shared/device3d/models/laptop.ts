// Laptop van 14 inch op echte maten (meter), eigen ontwerp (geen kopie van een bestaand merk, geen logo).
// Onderkant: aluminium unibody met een taps toelopende onderrand en een smalle gefreesde glansrand; bovenblad met een
// verzonken toetsenbord (toetsen met opdruk) en een verzonken glazen trackpad, speakerperforatie, poorten en voetjes.
// Scharnier: een donkere scharnierbuis achter het toetsenbord. Deksel: aluminium achterkant, rubberen rand, glazen
// voorkant met dunne randen en camera. Het scherm ('Screen') ligt in het lokale XY-vlak van het deksel ('Lid'), dat
// om de scharnieras draait; de schermmaat is exact die van spec.ts (302,5 x 196,5 mm).
import * as THREE from 'three';
import { arcProfile, capWithHoles, flatRounded, materials, merge, part, planarUV, portInsert, recess, roundedSlab, sweep, withAO, type Hole } from './parts';

export const LAPTOP = {
  W: 0.3105, D: 0.2215, baseH: 0.0108, r: 0.0105,
  screenW: 0.3025, screenH: 0.1965,
  /** Afstand van de onderkant van het deksel tot de onderkant van het scherm (de kin). */
  chin: 0.0108,
  topBezel: 0.0068,
  lidT: 0.0052,
};

/** Toetsenbordindeling: per rij de hoogte (in eenheden) en per toets de breedte en het opschrift. */
type Key = { w: number; label: string; align?: 'c' | 'l' | 'r' | 'two'; sub?: string };
const ROWS: { h: number; keys: (Key | 'arrows')[] }[] = [
  { h: 0.56, keys: [{ w: 1.5, label: 'esc', align: 'l' }, ...Array.from({ length: 12 }, (_, i) => ({ w: 1, label: `F${i + 1}` })), { w: 1, label: '' }] },
  { h: 1, keys: [['~', '`'], ['!', '1'], ['@', '2'], ['#', '3'], ['$', '4'], ['%', '5'], ['^', '6'], ['&', '7'], ['*', '8'], ['(', '9'], [')', '0'], ['_', '-'], ['+', '=']].map(([a, b]): Key => ({ w: 1, label: b!, sub: a!, align: 'two' })).concat([{ w: 1.5, label: 'delete', align: 'r' }]) },
  { h: 1, keys: [{ w: 1.5, label: 'tab', align: 'l' }, ...'QWERTYUIOP'.split('').map((c) => ({ w: 1, label: c })), { w: 1, label: '[' }, { w: 1, label: ']' }, { w: 1, label: '\\' }] },
  { h: 1, keys: [{ w: 1.8, label: 'caps', align: 'l' }, ...'ASDFGHJKL'.split('').map((c) => ({ w: 1, label: c })), { w: 1, label: ';' }, { w: 1, label: "'" }, { w: 1.7, label: 'return', align: 'r' }] },
  { h: 1, keys: [{ w: 2.3, label: 'shift', align: 'l' }, ...'ZXCVBNM'.split('').map((c) => ({ w: 1, label: c })), { w: 1, label: ',' }, { w: 1, label: '.' }, { w: 1, label: '/' }, { w: 2.2, label: 'shift', align: 'r' }] },
  { h: 1, keys: [{ w: 1, label: 'fn', align: 'l' }, { w: 1, label: 'ctrl', align: 'l' }, { w: 1, label: 'alt', align: 'l' }, { w: 1.25, label: '' }, { w: 5, label: '' }, { w: 1.25, label: '' }, { w: 1, label: 'alt', align: 'r' }, 'arrows'] },
];

interface KeyRect { x: number; z: number; w: number; d: number; key: Key | null; arrow?: string }

/** Rechthoeken van alle toetsen (midden, breedte, diepte) in meters, met de indeling hierboven. */
function keyLayout(kbW: number, unit: number, gap: number, z0: number): { rects: KeyRect[]; depth: number } {
  const rects: KeyRect[] = [];
  let z = z0;
  for (const row of ROWS) {
    const d = row.h * unit;
    let x = -kbW / 2;
    for (const k of row.keys) {
      if (k === 'arrows') {
        // Pijltjes: links en rechts halve hoogte onderaan, omhoog en omlaag gestapeld in het midden.
        const w = unit, hd = d / 2;
        rects.push({ x: x + w / 2, z: z + hd * 1.5, w: w - gap, d: hd - gap * 0.6, key: null, arrow: 'left' });
        rects.push({ x: x + w * 1.5, z: z + hd * 0.5, w: w - gap, d: hd - gap * 0.6, key: null, arrow: 'up' });
        rects.push({ x: x + w * 1.5, z: z + hd * 1.5, w: w - gap, d: hd - gap * 0.6, key: null, arrow: 'down' });
        rects.push({ x: x + w * 2.5, z: z + hd * 1.5, w: w - gap, d: hd - gap * 0.6, key: null, arrow: 'right' });
        x += 3 * unit;
        continue;
      }
      const w = k.w * unit;
      rects.push({ x: x + w / 2, z: z + d / 2, w: w - gap, d: d - gap, key: k });
      x += w;
    }
    z += d;
  }
  return { rects, depth: z - z0 };
}

/** Textuur met het toetsenbord van boven: donkere toetsen met lichte opdruk, in de verhouding van het toetsenbord. */
function keyboardTexture(rects: KeyRect[], x0: number, z0: number, kbW: number, kbD: number, unit: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 4096, H = Math.round((W * kbD) / kbW);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1c1d21';
  ctx.fillRect(0, 0, W, H);
  const s = W / kbW; // pixels per meter
  const font = (px: number, weight = 500) => `${weight} ${Math.round(px)}px Inter, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(226, 228, 232, 0.92)';
  ctx.textBaseline = 'middle';
  const u = unit * s;
  for (const r of rects) {
    const cx = (r.x - x0) * s, cy = (r.z - z0) * s, hw = (r.w * s) / 2, hd = (r.d * s) / 2;
    const pad = u * 0.14;
    if (r.arrow) {
      // Pijl als klein driehoekje.
      const a = u * 0.07;
      ctx.save(); ctx.translate(cx, cy);
      ctx.rotate({ up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[r.arrow]!);
      ctx.beginPath(); ctx.moveTo(0, -a); ctx.lineTo(a * 0.9, a * 0.6); ctx.lineTo(-a * 0.9, a * 0.6); ctx.closePath(); ctx.fill();
      ctx.restore();
      continue;
    }
    const k = r.key!;
    if (!k.label) continue;
    if (k.align === 'two') {
      ctx.textAlign = 'center';
      ctx.font = font(u * 0.2);
      ctx.fillText(k.sub ?? '', cx, cy - hd * 0.32);
      ctx.fillText(k.label, cx, cy + hd * 0.3);
    } else if (k.align === 'l' || k.align === 'r') {
      ctx.font = font(u * 0.17);
      ctx.textAlign = k.align === 'l' ? 'left' : 'right';
      ctx.fillText(k.label, k.align === 'l' ? cx - hw + pad : cx + hw - pad, cy + hd - pad * 1.05);
    } else {
      ctx.textAlign = 'center';
      const small = k.label.length > 1;
      ctx.font = font(u * (small ? 0.17 : 0.27));
      ctx.fillText(k.label, cx, cy + (small ? 0 : u * 0.01));
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.name = 'KeyboardLegends';
  return tex;
}

/** Eén gaatje per tegel, herhaald over de speakervlakken (wit gaatje = donker, rest transparant). */
function perforationTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, n, n);
  ctx.fillStyle = '#16171a';
  ctx.beginPath(); ctx.arc(n / 2, n / 2, n * 0.27, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.name = 'Perforation';
  return tex;
}

/** Toetsdop: rechte wand met ingebakken occlusie onderaan, afgeronde bovenrand en plat bovenvlak. */
function keycap(w: number, d: number, h: number, r: number, rt: number): THREE.BufferGeometry {
  const side = sweep(w, d, r, [
    { o: 0, y: 0, nh: 1, nv: 0, ao: 0.32 },
    { o: 0, y: h * 0.45, nh: 1, nv: 0, ao: 0.72 },
    ...arcProfile(-rt, h - rt, rt, 0, 90, 3, 0.95, 1),
  ], 4);
  const top = withAO(flatRounded(w - 2 * rt, d - 2 * rt, Math.max(0.0002, r - rt), 4));
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, 0);
  return merge([side, top]);
}

export function buildLaptop(): THREE.Group {
  const L = LAPTOP;
  const mat = materials();
  const root = new THREE.Group();
  root.name = 'Laptop';
  const base = new THREE.Group();
  base.name = 'Base';
  root.add(base);

  // Onderkant: taps toelopende onderrand (grote afronding), rechte zijkant, smalle gefreesde glansrand bovenaan.
  const rb = 0.0034, c = 0.00045, H = L.baseH;
  base.add(part(sweep(L.W, L.D, L.r, [
    ...arcProfile(-rb, rb, rb, -90, 0, 10, 0.55, 0.9),
    { o: 0, y: H - c, nh: 1, nv: 0, ao: 1 },
  ], 16), mat.aluminium, 'BaseShell'));
  base.add(part(sweep(L.W, L.D, L.r, [
    { o: 0, y: H - c, nh: 0.7071, nv: 0.7071 },
    { o: -c, y: H, nh: 0.7071, nv: 0.7071 },
  ], 16), mat.chamfer, 'BaseChamfer'));
  const bottom = withAO(flatRounded(L.W - 2 * rb, L.D - 2 * rb, L.r - rb, 16), 0.5);
  bottom.rotateX(Math.PI / 2);
  base.add(part(bottom, mat.aluminium, 'BaseBottom'));

  // Toetsenbord: 14,5 eenheden van 19,1 mm; zes rijen (functierij half zo hoog).
  const kbW = 0.2775, unit = kbW / 14.5, keyGap = 0.0029;
  const kbZ0 = -L.D / 2 + 0.0132;
  const { rects, depth: kbD } = keyLayout(kbW, unit, keyGap, kbZ0);
  const margin = 0.0016;
  const kbHole: Hole = { cx: 0, cz: kbZ0 + kbD / 2, w: kbW + margin * 2, d: kbD + margin * 2, r: 0.0026 };
  // Trackpad: groot, glas, verzonken in een smalle naad.
  const tpW = 0.1495, tpD = 0.0815, seam = 0.00045;
  const tpZ = L.D / 2 - 0.0088 - tpD / 2;
  const tpHole: Hole = { cx: 0, cz: tpZ, w: tpW + seam * 2, d: tpD + seam * 2, r: 0.0062 };
  if (tpZ - tpD / 2 - (kbHole.cz + kbHole.d / 2) < 0.006) throw new Error('Trackpad en toetsenbord overlappen.');

  // Bovenblad met de uitsparingen.
  const deck = capWithHoles(L.W - 2 * c, L.D - 2 * c, L.r - c, [kbHole, tpHole]);
  deck.translate(0, H, 0);
  base.add(part(deck, mat.aluminium, 'Deck'));
  const wellDepth = 0.0011;
  const kb = recess(kbHole, wellDepth, 0.00035);
  for (const g of [kb.edge, kb.wall, kb.floor]) g.translate(0, H, 0);
  base.add(part(kb.edge, mat.chamfer, 'KeyboardEdge'), part(kb.wall, mat.aluminium, 'KeyboardWall'), part(kb.floor, mat.well, 'KeyboardWell'));
  const tp = recess(tpHole, 0.0012, 0.00022);
  for (const g of [tp.edge, tp.wall, tp.floor]) g.translate(0, H, 0);
  base.add(part(tp.edge, mat.chamfer, 'TrackpadEdge'), part(tp.wall, mat.aluminium, 'TrackpadWall'), part(tp.floor, mat.gap, 'TrackpadSeam'));
  const pad = sweep(tpW, tpD, 0.0058, [
    { o: 0, y: -0.0009, nh: 1, nv: 0, ao: 0.5 },
    ...arcProfile(-0.0003, -0.0001 - 0.0003, 0.0003, 0, 90, 3),
  ], 10);
  const padTop = withAO(flatRounded(tpW - 0.0006, tpD - 0.0006, 0.0055, 10));
  padTop.rotateX(-Math.PI / 2);
  padTop.translate(0, -0.0001, 0);
  const padGeo = merge([pad.toNonIndexed(), padTop.toNonIndexed()]);
  padGeo.translate(0, H, tpZ);
  base.add(part(padGeo, mat.trackpad, 'Trackpad'));

  // Toetsen in de bak, bovenkant net onder het bovenblad; met de opdruk als textuur over het hele toetsenbord.
  const keyH = 0.00085;
  const keyGeos = rects.map((r) => { const g = keycap(r.w, r.d, keyH, 0.0012, 0.00038); g.translate(r.x, H - wellDepth, r.z); return g; });
  const keysGeo = planarUV(merge(keyGeos), -kbW / 2, kbW / 2, kbZ0, kbZ0 + kbD);
  const legends = keyboardTexture(rects, -kbW / 2, kbZ0, kbW, kbD, unit);
  if (legends) { mat.keys.map = legends; mat.keys.color.set('#ffffff'); }
  base.add(part(keysGeo, mat.keys, 'Keys'));

  // Speakerperforatie links en rechts van het toetsenbord: een vlak met een herhalende textuur van gaatjes
  // (licht en scherp, ook van dichtbij; van ver vloeit het samen tot een zacht grijs vlak).
  const side = (L.W - 2 * c - kbHole.w) / 2, pitch = 0.00098;
  const grilleW = pitch * 8, grilleD = kbHole.d - 0.004;
  const dots = perforationTexture();
  for (const sgn of [-1, 1]) {
    const g = withAO(flatRounded(grilleW, grilleD, 0.0006, 4));
    g.rotateX(-Math.PI / 2);
    const cx = sgn * (kbHole.w / 2 + side / 2);
    g.translate(cx, H + 0.00002, kbHole.cz);
    planarUV(g, cx - grilleW / 2, cx + grilleW / 2, kbHole.cz - grilleD / 2, kbHole.cz + grilleD / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (grilleW / pitch), uv.getY(i) * (grilleD / pitch));
    base.add(part(g, mat.grille, 'Grille'));
  }
  if (dots) { mat.grille.map = dots; mat.grille.transparent = true; mat.grille.color.set('#ffffff'); }

  // Poorten in de zijkanten: links twee USB-C, rechts USB-C en een audio-aansluiting.
  const portY = (rb + H - c) / 2;
  const addPort = (sideX: number, z: number, w: number, h: number, tongue: boolean) => {
    const p = portInsert(w, h, mat, tongue);
    p.rotation.y = sideX * Math.PI / 2;
    p.position.set(sideX * (L.W / 2 + 0.00003), portY, z);
    base.add(p);
  };
  addPort(-1, -0.058, 0.0088, 0.0031, true);
  addPort(-1, -0.040, 0.0088, 0.0031, true);
  addPort(1, -0.052, 0.0088, 0.0031, true);
  addPort(1, 0.035, 0.0036, 0.0036, false);

  // Voetjes: twee lange rubberen strips onder de onderkant.
  const feet: THREE.BufferGeometry[] = [];
  for (const fz of [-1, 1]) {
    const g = withAO(roundedSlab({ w: L.W - 0.07, d: 0.0062, h: 0.0007, r: 0.0031, rTop: 0.0001, rBottom: 0.0005, cornerSegments: 8, edgeSegments: 3 }), 0.6);
    g.translate(0, -0.0007, fz * (L.D / 2 - 0.016));
    feet.push(g);
  }
  base.add(part(merge(feet), mat.rubber, 'Feet'));

  // Scharnierbuis achter het toetsenbord, licht verzonken in de onderkant.
  const hingeR = 0.0040, hingeL = L.W - 0.034, hingeY = H - 0.0006, hingeZ = -L.D / 2 + 0.0052;
  const e = 0.0009;
  const prof: THREE.Vector2[] = [new THREE.Vector2(0, -hingeL / 2)];
  for (let i = 0; i <= 6; i++) { const a = (-Math.PI / 2) + (Math.PI / 2) * (i / 6); prof.push(new THREE.Vector2(hingeR - e + e * Math.cos(a), -hingeL / 2 + e + e * Math.sin(a))); }
  for (let i = 0; i <= 6; i++) { const a = (Math.PI / 2) * (i / 6); prof.push(new THREE.Vector2(hingeR - e + e * Math.cos(a), hingeL / 2 - e + e * Math.sin(a))); }
  prof.push(new THREE.Vector2(0, hingeL / 2));
  const barrel = new THREE.LatheGeometry(prof, 48);
  barrel.rotateZ(Math.PI / 2);
  barrel.translate(0, hingeY, hingeZ);
  base.add(part(withAO(barrel, 0.85), mat.hinge, 'Hinge'));

  // Deksel: om de scharnieras; gebouwd rechtop met de voorkant naar +Z.
  const lid = new THREE.Group();
  lid.name = 'Lid';
  lid.position.set(0, hingeY, hingeZ);
  const T = L.lidT, Hl = L.chin + L.screenH + L.topBezel, y0 = hingeR + 0.0006;
  const lc = 0.00035, lrb = 0.0021;
  // Plat gebouwd: y = 0 is de voorkant, y = T de achterkant; daarna rechtop gezet.
  const shell = sweep(L.W, Hl, L.r, [
    { o: -lc, y: 0, nh: 0.7071, nv: -0.7071 },
    { o: 0, y: lc, nh: 0.7071, nv: -0.7071 },
  ], 16);
  const shellSide = sweep(L.W, Hl, L.r, [
    { o: 0, y: lc, nh: 1, nv: 0 },
    ...arcProfile(-lrb, T - lrb, lrb, 0, 90, 8),
  ], 16);
  const back = withAO(flatRounded(L.W - 2 * lrb, Hl - 2 * lrb, L.r - lrb, 16));
  back.rotateX(-Math.PI / 2);
  back.translate(0, T, 0);
  const upright = (g: THREE.BufferGeometry) => { g.rotateX(-Math.PI / 2); g.translate(0, y0 + Hl / 2, T / 2); return g; };
  lid.add(part(upright(shell), mat.chamfer, 'LidChamfer'));
  lid.add(part(upright(shellSide), mat.aluminium, 'LidShell'));
  lid.add(part(upright(back), mat.aluminium, 'LidBack'));
  // Voorkant: smalle rubberen rand en daarbinnen het glas (zwart, glanzend) met het scherm.
  const gasket = 0.0011;
  const gw = L.W - 2 * lc, gh = Hl - 2 * lc;
  const ring = capWithHoles(gw, gh, L.r - lc, [{ cx: 0, cz: 0, w: gw - 2 * gasket, d: gh - 2 * gasket, r: L.r - lc - gasket }]);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, y0 + Hl / 2, T / 2 + 0.00003);
  lid.add(part(ring, mat.gasket, 'Gasket'));
  const glass = withAO(flatRounded(gw - 2 * gasket, gh - 2 * gasket, L.r - lc - gasket, 16));
  glass.translate(0, y0 + Hl / 2, T / 2 + 0.00008);
  lid.add(part(glass, mat.bezel, 'Bezel'));
  const screen = part(flatRounded(L.screenW, L.screenH, [0.0042, 0.0042, 0, 0]), mat.screen, 'Screen');
  screen.position.set(0, y0 + L.chin + L.screenH / 2, T / 2 + 0.00014);
  screen.castShadow = false;
  screen.userData = { screenMM: [L.screenW * 1000, L.screenH * 1000] };
  lid.add(screen);
  const camY = y0 + L.chin + L.screenH + L.topBezel / 2;
  const camRing = part(withAO(new THREE.RingGeometry(0.00085, 0.0014, 32)), mat.lensRing, 'CameraRing');
  camRing.position.set(0, camY, T / 2 + 0.00012);
  const cam = part(withAO(new THREE.CircleGeometry(0.00085, 32)), mat.lens, 'Camera');
  cam.position.set(0, camY, T / 2 + 0.00013);
  lid.add(camRing, cam);
  root.add(lid);
  root.userData = { device: 'laptop-14', lidAxis: 'x' };
  return root;
}
