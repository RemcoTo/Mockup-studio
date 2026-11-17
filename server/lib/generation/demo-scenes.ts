// Getekende testscènes met echte perspectiefprojectie. Ze dienen als testmateriaal voor de
// detectie- en plaatsingsketen en als demo zonder betaalde API. Het zijn geen foto's.
import { isValidSize, sizeMode } from '../../../shared/design-size';
import sharp from 'sharp';
import type { SceneConfig } from '../../../shared/types';
import { colorsFor, sceneBackdrop, scenePalette } from '../../../shared/palette';
import { deviceSpecFor } from '../../../shared/device3d/spec';

type V3 = [number, number, number];
type P2 = [number, number];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const rotY = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];

function camera(eye: V3, target: V3, focal: number, w: number, h: number) {
  const f = norm(sub(target, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return (p: V3): P2 => {
    const d = sub(p, eye);
    const z = dot(d, f);
    return [w / 2 + (focal * dot(d, r)) / z, h / 2 - (focal * dot(d, u)) / z];
  };
}

const poly = (pts: P2[], fill: string, extra = '') =>
  `<polygon points="${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')}" fill="${fill}" ${extra}/>`;

function gradient(id: string, from: P2, to: P2, stops: [number, string][]) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;
}

/** Rechthoek in een vlak: oorsprong o, assen ax en ay, maten in die assen. */
function rect(o: V3, ax: V3, ay: V3, x0: number, y0: number, x1: number, y1: number): V3[] {
  return [add(o, add(mul(ax, x0), mul(ay, y0))), add(o, add(mul(ax, x1), mul(ay, y0))), add(o, add(mul(ax, x1), mul(ay, y1))), add(o, add(mul(ax, x0), mul(ay, y1)))];
}

interface Ctx { w: number; h: number; r: () => number; chroma: boolean; defs: string[]; body: string[]; look?: DemoLook }

/**
 * Hoe de testscène de configuratie volgt: kleuren van wand en vloer, een platte achtergrond, props en
 * gekleurd licht. Zo zijn merkkleur, ondergrond en platte achtergrond zonder betaalde AI te testen.
 */
export interface DemoLook {
  wall?: [string, string];
  /** Gradient over de wand: twee of meer kleuren in een richting. */
  wallGradient?: { stops: string[]; direction: 'vertical' | 'horizontal' | 'diagonal' | 'radial' };
  floor?: [string, string];
  /** Kleine accenten in de omgeving. */
  accents?: string[];
  /** Exacte achtergrond in een scène: de wand is een magenta sleutelscherm dat de studio daarna inkleurt. */
  keyWall?: boolean;
  /**
   * Lege omgeving voor een 3D-device: geen object, wel wand, ondergrond, props en licht; de horizon volgt de
   * camerahoogte (0..1 van het beeld, 0 = recht van boven).
   */
  empty?: { horizon: number };
  /** Platte achtergrond: één vlak (of verloop) over het hele beeld, zonder horizon. */
  flat?: { from: string; to: string; direction: 'vertical' | 'horizontal' | 'diagonal' | 'radial' };
  props?: { color: string; count: number };
  light?: string;
  /** Verhouding (breedte/hoogte) van het ontwerpvlak bij opgegeven afmetingen, zoals het model die volgt. */
  ratio?: number;
}

/** Afmetingen van een vlak met dezelfde oppervlakte als de standaard, in de gevraagde verhouding. */
function sized(base: [number, number], ratio: number | undefined, maxH = Infinity): [number, number] {
  if (!ratio) return base;
  let w = Math.sqrt(base[0] * base[1] * ratio), h = w / ratio;
  if (h > maxH) { h = maxH; w = h * ratio; }
  return [w, h];
}

const GROUND_COLORS: Record<string, [string, string]> = {
  oak: ['#d2b48c', '#b8956a'], walnut: ['#6b4c38', '#4e3526'], marble: ['#efeeeb', '#dddbd6'], travertine: ['#e6d6bc', '#cdb995'],
  concrete: ['#c4c4c1', '#a9a9a6'], terrazzo: ['#e8e3da', '#d3cdc2'], linen: ['#ddd3c3', '#c7bba7'], paper: ['#f3f1ec', '#e2dfd8'], metal: ['#cdd0d3', '#a9adb1'],
};

const hexOf = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const tone = (hex: string, toward: string, t: number) => { const a = rgbOf(hex), b = rgbOf(toward); return hexOf(a.map((v, i) => v + (b[i]! - v) * t)); };

/** Vertaalt de scèneconfiguratie naar de testscène. Een AI raakt een kleur nooit precies; de testscène wijkt bewust iets af. */
export function demoLook(cfg?: SceneConfig | null): DemoLook | undefined {
  if (!cfg) return undefined;
  const look: DemoLook = {};
  const device = deviceSpecFor(cfg);
  if (device) look.empty = { horizon: device.camera.elevation >= 75 ? 0 : Math.max(0.18, Math.min(0.62, 0.56 - device.camera.elevation / 110)) };
  if (isValidSize(cfg.designSize) && sizeMode(cfg.objectType) === 'surface') look.ratio = cfg.designSize.width / cfg.designSize.height;
  const b = cfg.backdrop;
  if (b && (b.mode === 'solid' || b.mode === 'gradient')) {
    // Zoals het beeldmodel: een magenta sleutelscherm met wat lichtval; de studio zet de kleur er daarna in.
    look.flat = { from: '#f40cf2', to: '#d606da', direction: 'vertical' };
    return look;
  }
  const g = cfg.ground ? GROUND_COLORS[cfg.ground] : undefined;
  if (g) look.floor = g;
  // Het palet: elke kleur op zijn eigen plek, zoals de prompt het model vraagt.
  const palette = scenePalette(cfg);
  const bg = colorsFor(palette, 'background'), grad = colorsFor(palette, 'gradient'), ground = colorsFor(palette, 'ground');
  const props = colorsFor(palette, 'props'), accents = colorsFor(palette, 'accent'), light = colorsFor(palette, 'light');
  if (sceneBackdrop(cfg)) {
    // Zoals het beeldmodel: een magenta wand met wat lichtval; de studio zet de kleur er daarna in.
    look.keyWall = true;
    look.wall = ['#f40cf2', '#d606da'];
  } else if (grad.length >= 2) look.wallGradient = { stops: grad, direction: palette.gradient?.direction ?? 'vertical' };
  else if (bg.length) look.wall = [tone(bg[0]!, '#ffffff', 0.08), tone(bg[0]!, '#000000', 0.12)];
  if (ground.length) look.floor = [tone(ground[0]!, '#ffffff', 0.15), tone(ground[0]!, '#000000', 0.08)];
  if (light.length) look.light = light[0];
  if (accents.length) look.accents = accents;
  if (cfg.props && cfg.props !== 'none') look.props = { color: props[0] ?? '#cfc6ba', count: cfg.props === 'minimal' ? 1 : 3 };
  else if (!cfg.props && props.length) look.props = { color: props[0]!, count: 2 };
  return look;
}

/** Props: eenvoudige bollen en sokkels aan de zijkant, achter het object. */
function drawProps(ctx: Ctx) {
  const p = ctx.look?.props;
  if (!p) return;
  const { w, h } = ctx;
  const spots: [number, number, number][] = [[0.1, 0.84, 0.07], [0.9, 0.8, 0.05], [0.16, 0.7, 0.04]];
  for (const [fx, fy, fr] of spots.slice(0, p.count)) {
    const r = Math.min(w, h) * fr, cx = w * fx, cy = h * fy;
    ctx.body.push(`<ellipse cx="${cx + r * 0.3}" cy="${cy + r * 0.95}" rx="${r * 1.1}" ry="${r * 0.25}" fill="#000" opacity="0.25" filter="url(#blur-s)"/>`);
    ctx.body.push(`<rect x="${cx - r * 0.8}" y="${cy}" width="${r * 1.6}" height="${r}" fill="${tone(p.color, '#000000', 0.18)}"/>`);
    ctx.body.push(`<circle cx="${cx}" cy="${cy - r * 0.6}" r="${r * 0.62}" fill="${p.color}"/>`);
  }
}

function surfaceFill(ctx: Ctx, id: string, a: P2, b: P2) {
  if (ctx.chroma) ctx.defs.push(gradient(id, a, b, [[0, '#19f23a'], [1, '#0bbd2a']]));
  else ctx.defs.push(gradient(id, a, b, [[0, '#fbfbfa'], [1, '#e3e3e0']]));
  return `url(#${id})`;
}

function backdrop(ctx: Ctx, horizon: number, wall: [string, string], floor: [string, string]) {
  const { w, h } = ctx;
  const flat = ctx.look?.flat;
  if (flat) {
    // Platte achtergrond: één vlak over het hele beeld, zonder wand en vloer.
    const dir = { vertical: [[0, 0], [0, h]], horizontal: [[0, 0], [w, 0]], diagonal: [[0, 0], [w, h]], radial: [[0, 0], [0, h]] }[flat.direction] as [P2, P2];
    if (flat.direction === 'radial') {
      const R = Math.hypot(w, h) / 2;
      ctx.defs.push(`<radialGradient id="flatbg" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h / 2}" r="${R}"><stop offset="0" stop-color="${flat.from}"/><stop offset="1" stop-color="${flat.to}"/></radialGradient>`);
    } else ctx.defs.push(gradient('flatbg', dir[0], dir[1], [[0, flat.from], [1, flat.to]]));
    ctx.defs.push(`<radialGradient id="light" cx="0.35" cy="0.2" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    ctx.defs.push('<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>');
    ctx.defs.push('<filter id="blur-s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>');
    ctx.body.push(`<rect width="${w}" height="${h}" fill="url(#flatbg)"/>`);
    return;
  }
  if (ctx.look?.wall) wall = ctx.look.wall;
  if (ctx.look?.floor) floor = ctx.look.floor;
  // Van bovenaf gezien (geen wand in beeld) met een exacte achtergrond: alles rond het product is sleutelscherm.
  if (ctx.look?.keyWall && horizon <= 0) floor = ['#f40cf2', '#d606da'];
  const wg = ctx.look?.wallGradient;
  if (wg && wg.direction === 'radial') {
    const R = Math.hypot(w, horizon || h) / 2;
    ctx.defs.push(`<radialGradient id="wall" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${(horizon || h) / 2}" r="${R}">${wg.stops.map((c, i) => `<stop offset="${i / (wg.stops.length - 1)}" stop-color="${c}"/>`).join('')}</radialGradient>`);
  } else if (wg) {
    const H = horizon || h;
    const dir = { vertical: [[0, 0], [0, H]], horizontal: [[0, 0], [w, 0]], diagonal: [[0, 0], [w, H]] }[wg.direction as 'vertical' | 'horizontal' | 'diagonal'] as [P2, P2];
    ctx.defs.push(gradient('wall', dir[0], dir[1], wg.stops.map((c, i) => [i / (wg.stops.length - 1), c] as [number, string])));
  } else ctx.defs.push(gradient('wall', [0, 0], [0, horizon], [[0, wall[0]], [1, wall[1]]]));
  ctx.defs.push(gradient('floor', [0, horizon], [0, h], [[0, floor[0]], [1, floor[1]]]));
  ctx.defs.push(`<radialGradient id="light" cx="${0.25 + ctx.r() * 0.2}" cy="0.15" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="${ctx.look?.keyWall ? 0.12 : 0.35}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
  ctx.defs.push('<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>');
  ctx.defs.push('<filter id="blur-s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>');
  ctx.body.push(`<rect width="${w}" height="${horizon}" fill="url(#wall)"/>`);
  ctx.body.push(`<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#floor)"/>`);
  if (ctx.look?.light) {
    ctx.defs.push(`<radialGradient id="accent" cx="0.85" cy="0.15" r="0.6"><stop offset="0" stop-color="${ctx.look.light}" stop-opacity="0.45"/><stop offset="1" stop-color="${ctx.look.light}" stop-opacity="0"/></radialGradient>`);
    // Bij een exacte achtergrond valt het gekleurde licht niet op de wand (zoals de prompt het model vraagt).
    if (!ctx.look.keyWall) ctx.body.push(`<rect width="${w}" height="${h}" fill="url(#accent)"/>`);
    else if (horizon > 0) ctx.body.push(`<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#accent)"/>`);
  }
  drawProps(ctx);
  drawAccents(ctx, horizon);
}

/** Accenten: een smalle lijst op de wand en een klein object, in de accentkleuren. */
function drawAccents(ctx: Ctx, horizon: number) {
  const list = ctx.look?.accents;
  if (!list?.length) return;
  const { w, h } = ctx;
  list.slice(0, 3).forEach((c, i) => {
    if (horizon > h * 0.2) ctx.body.push(`<rect x="${w * (0.06 + i * 0.05)}" y="${horizon * 0.18}" width="${w * 0.025}" height="${horizon * 0.5}" fill="${c}"/>`);
    else ctx.body.push(`<circle cx="${w * (0.93 - i * 0.05)}" cy="${h * 0.1}" r="${Math.min(w, h) * 0.02}" fill="${c}"/>`);
  });
}

function shadow(ctx: Ctx, pts: P2[], opacity = 0.35) {
  ctx.body.push(poly(pts, '#000', `opacity="${opacity}" filter="url(#blur)"`));
}

function laptop(ctx: Ctx, project: (p: V3) => P2, origin: V3, yaw: number, scale = 1, idx = 0) {
  const W = 30 * scale, D = 21 * scale, T = 1.4 * scale;
  const X: V3 = rotY([1, 0, 0], yaw), Z: V3 = rotY([0, 0, 1], yaw);
  const top = add(origin, [0, T, 0]);
  const baseTop = rect(top, X, Z, -W / 2, -D / 2, W / 2, D / 2).map(project);
  const front = [add(origin, add(mul(X, -W / 2), mul(Z, D / 2))), add(origin, add(mul(X, W / 2), mul(Z, D / 2))), add(top, add(mul(X, W / 2), mul(Z, D / 2))), add(top, add(mul(X, -W / 2), mul(Z, D / 2)))].map(project);
  shadow(ctx, rect(origin, X, Z, -W / 2 - 2, -D / 2, W / 2 + 2, D / 2 + 3).map(project));
  ctx.defs.push(gradient(`alu${idx}`, baseTop[0]!, baseTop[2]!, [[0, '#d9dadc'], [1, '#a9abaf']]));
  ctx.body.push(poly(front, '#8c8e92'));
  ctx.body.push(poly(baseTop, `url(#alu${idx})`));
  ctx.body.push(poly(rect(top, X, Z, -W / 2 + 2.2 * scale, -D / 2 + 1.6 * scale, W / 2 - 2.2 * scale, -D / 2 + 11 * scale).map(project), '#2a2b2e'));
  ctx.body.push(poly(rect(top, X, Z, -5.5 * scale, -D / 2 + 12.5 * scale, 5.5 * scale, D / 2 - 1.6 * scale).map(project), '#b8babd'));
  // Scherm: draait 112 graden open rond het scharnier aan de achterkant.
  const a = (112 * Math.PI) / 180;
  const dir = norm(add(mul([0, 1, 0], Math.sin(a)), mul(Z, Math.cos(a))));
  const hinge = add(top, mul(Z, -D / 2));
  const lidBack = rect(add(hinge, mul(cross(dir, X), -0.5 * scale)), X, dir, -W / 2, 0, W / 2, D).map(project);
  ctx.body.push(poly(lidBack, '#7b7d81'));
  const lid = rect(hinge, X, dir, -W / 2, 0, W / 2, D).map(project);
  ctx.body.push(poly(lid, '#141517'));
  const screen = rect(hinge, X, dir, -W / 2 + 1.1 * scale, 1.9 * scale, W / 2 - 1.1 * scale, D - 1.0 * scale).map(project);
  ctx.body.push(poly(screen, surfaceFill(ctx, `scr${idx}`, screen[3]!, screen[1]!)));
}

function phone(ctx: Ctx, project: (p: V3) => P2, origin: V3, yaw: number, idx = 0) {
  const W = 7.4, D = 15.6, T = 0.8;
  const X: V3 = rotY([1, 0, 0], yaw), Z: V3 = rotY([0, 0, 1], yaw);
  const top = add(origin, [0, T, 0]);
  shadow(ctx, rect(origin, X, Z, -W / 2 - 0.6, -D / 2, W / 2 + 0.8, D / 2 + 1).map(project), 0.4);
  const side = [add(origin, add(mul(X, -W / 2), mul(Z, D / 2))), add(origin, add(mul(X, W / 2), mul(Z, D / 2))), add(top, add(mul(X, W / 2), mul(Z, D / 2))), add(top, add(mul(X, -W / 2), mul(Z, D / 2)))].map(project);
  ctx.body.push(poly(side, '#5d5f63'));
  ctx.body.push(poly(rect(top, X, Z, -W / 2, -D / 2, W / 2, D / 2).map(project), '#121315'));
  const screen = rect(top, X, Z, -W / 2 + 0.35, -D / 2 + 0.35, W / 2 - 0.35, D / 2 - 0.35).map(project);
  ctx.body.push(poly(screen, surfaceFill(ctx, `ph${idx}`, screen[0]!, screen[2]!)));
}

function card(ctx: Ctx, project: (p: V3) => P2, origin: V3, yaw: number, idx = 0) {
  const [W, D] = sized([8.5, 5.5], ctx.look?.ratio, 11);
  const T = 0.06;
  const X: V3 = rotY([1, 0, 0], yaw), Z: V3 = rotY([0, 0, 1], yaw);
  shadow(ctx, rect(origin, X, Z, -W / 2 + 0.2, -D / 2 + 0.3, W / 2 + 0.5, D / 2 + 0.6).map(project), 0.45);
  const face = rect(add(origin, [0, T, 0]), X, Z, -W / 2, -D / 2, W / 2, D / 2).map(project);
  ctx.body.push(poly(face, surfaceFill(ctx, `card${idx}`, face[0]!, face[2]!)));
}

/** Telefoon rechtop, licht achterover leunend, scherm naar de camera. base = midden onderkant op de vloer. */
function phoneUpright(ctx: Ctx, project: (p: V3) => P2, base: V3, yaw: number, lean: number, idx = 0) {
  const W = 7.4, H = 15.6, T = 0.8;
  const X: V3 = rotY([1, 0, 0], yaw), Zf: V3 = rotY([0, 0, 1], yaw);
  const U = norm(add(mul([0, 1, 0], Math.cos(lean)), mul(Zf, -Math.sin(lean))));
  // Schaduw op de vloer achter het toestel en een zachte contactschaduw eronder.
  shadow(ctx, rect(base, X, Zf, -W / 2 - 0.4, -H * Math.sin(lean) - 2.5, W / 2 + 1.2, 0.6).map(project), 0.3);
  const back = add(base, mul(Zf, -T));
  ctx.body.push(poly(rect(back, X, U, -W / 2, 0, W / 2, H).map(project), '#4b4d51'));
  // Zijkant (dikte) aan de kant die naar de camera draait.
  const side = yaw >= 0 ? -W / 2 : W / 2;
  const edge = [add(base, mul(X, side)), add(back, mul(X, side)), add(add(back, mul(X, side)), mul(U, H)), add(add(base, mul(X, side)), mul(U, H))].map(project);
  ctx.body.push(poly(edge, '#6a6c70'));
  ctx.body.push(poly(rect(base, X, U, -W / 2, 0, W / 2, H).map(project), '#121315'));
  const screen = rect(add(base, mul(Zf, 0.01)), X, U, -W / 2 + 0.36, 0.36, W / 2 - 0.36, H - 0.36).map(project);
  ctx.body.push(poly(screen, surfaceFill(ctx, `up${idx}`, screen[3]!, screen[1]!)));
}

export interface DemoOptions { width: number; height: number; seed: number; chroma: boolean; look?: DemoLook }

export function demoSceneSvg(objectType: string, o: DemoOptions): string {
  const r = rng(o.seed);
  const ctx: Ctx = { w: o.width, h: o.height, r, chroma: o.chroma, defs: [], body: [], look: o.look };
  const { width: w, height: h } = o;
  const focal = Math.max(w, h) * 1.15;
  const jitter = (s: number) => (r() - 0.5) * s;

  if (o.look?.empty) {
    // Zoals het beeldmodel bij een 3D-device: alleen de omgeving, met een lege plek in het midden.
    backdrop(ctx, h * o.look.empty.horizon, ['#ebe5dd', '#d9d0c5'], ['#c3a585', '#9c7d60']);
    ctx.body.push(`<rect width="${w}" height="${h}" fill="url(#light)"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${ctx.defs.join('')}</defs>${ctx.body.join('')}</svg>`;
  }

  if (objectType === 'email-phone') {
    backdrop(ctx, h * 0.66, ['#ebe0d7', '#e2d4c8'], ['#d9cabd', '#c9b8a9']);
    const project = camera([jitter(4), 10, 33], [0, 8.2, 0], focal, w, h);
    phoneUpright(ctx, project, [0, 0, 0], 0.18 + jitter(0.2), 0.12);
  } else if (objectType === 'email-phone-hand') {
    backdrop(ctx, 0, ['#d6dcd5', '#d6dcd5'], ['#d3d9d1', '#bcc4ba']);
    const project = camera([jitter(5), 30, 9], [0, 0, 0], focal, w, h);
    phone(ctx, project, [0, 0, 0], jitter(0.3), 7);
  } else if (objectType === 'email-laptop') {
    const horizon = h * 0.44;
    backdrop(ctx, horizon, ['#ece6e0', '#ddd5cd'], ['#cdbfb1', '#b8a897']);
    const project = camera([jitter(8), 24, 50], [0, 10, -3], focal, w, h);
    laptop(ctx, project, [0, 0, 0], jitter(0.15));
  } else if (objectType === 'email-devices') {
    const horizon = h * 0.4;
    backdrop(ctx, horizon, ['#ece8e2', '#dcd6ce'], ['#c9b69e', '#b39f86']);
    const project = camera([8 + jitter(8), 34, 60], [2, 6, -2], focal, w, h);
    laptop(ctx, project, [-6, 0, -4], -0.1 + jitter(0.1), 0.95, 0);
    phone(ctx, project, [16.5, 0, 5], -0.3 + jitter(0.2), 1);
  } else if (objectType === 'smartphone') {
    backdrop(ctx, 0, ['#d8d6d1', '#d8d6d1'], ['#cfccc5', '#b9b5ad']);
    const project = camera([jitter(8), 30, 14], [0, 0, 0], focal, w, h);
    phone(ctx, project, [0, 0, 0], 0.35 + jitter(0.5));
  } else if (objectType === 'business-card' || objectType === 'flyer' || objectType === 'letterhead' || objectType === 'envelope') {
    backdrop(ctx, 0, ['#c9c5bd', '#c9c5bd'], ['#d6d1c8', '#bdb7ac']);
    const project = camera([jitter(6), 30, 16], [0, 0, 0], focal, w, h);
    card(ctx, project, [-5.2, 0, 1.2], -0.2 + jitter(0.3), 1);
    card(ctx, project, [5.2, 0, -1.4], 0.3 + jitter(0.3), 0);
  } else if (objectType === 'poster' || objectType === 'facade' || objectType === 'sign-board' || objectType === 'wayfinding') {
    const horizon = h * 0.82;
    backdrop(ctx, horizon, ['#e2dfda', '#cbc7c0'], ['#a39d93', '#8b857b']);
    const project = camera([30 + jitter(20), 95, 260], [0, 95, 0], focal, w, h);
    const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0];
    const [fw, fh] = sized([71, 99], ctx.look?.ratio, 130);
    const frame = rect([0, 95, 0], X, Y, -fw / 2 - 2.5, -fh / 2 - 2.5, fw / 2 + 2.5, fh / 2 + 2.5).map(project);
    shadow(ctx, frame.map(([x, y]) => [x + 14, y + 18] as P2), 0.28);
    ctx.body.push(poly(frame, '#222326'));
    const face = rect([0, 95, 0.5], X, Y, -fw / 2, -fh / 2, fw / 2, fh / 2).map(project);
    ctx.body.push(poly(face, surfaceFill(ctx, 'poster', face[3]!, face[1]!)));
  } else if (objectType === 't-shirt' || objectType === 'hoodie' || objectType === 'polo' || objectType === 'workwear' || objectType === 'tote-bag') {
    backdrop(ctx, 0, ['#dcdad5', '#dcdad5'], ['#dcdad5', '#c8c5be']);
    const s = Math.min(w, h) / 1000;
    const cx = w / 2, cy = h / 2 + 30 * s;
    const P = (x: number, y: number) => `${(cx + x * s).toFixed(1)},${(cy + y * s).toFixed(1)}`;
    const shirt = `M${P(-150, -330)} C${P(-90, -300)} ${P(90, -300)} ${P(150, -330)} L${P(330, -250)} L${P(400, -60)} L${P(300, -20)} L${P(270, -110)} L${P(265, 380)} L${P(-265, 380)} L${P(-270, -110)} L${P(-300, -20)} L${P(-400, -60)} L${P(-330, -250)} Z`;
    ctx.defs.push(gradient('cloth', [cx - 300 * s, 0], [cx + 300 * s, 0], [[0, '#2c3a4f'], [0.5, '#3a4b64'], [1, '#26324a']]));
    ctx.body.push(`<path d="${shirt}" fill="#000" opacity="0.25" filter="url(#blur)" transform="translate(${12 * s},${22 * s})"/>`);
    ctx.body.push(`<path d="${shirt}" fill="url(#cloth)"/>`);
    ctx.body.push(`<path d="M${P(-150, -330)} C${P(-60, -250)} ${P(60, -250)} ${P(150, -330)}" stroke="#1d2737" stroke-width="${18 * s}" fill="none"/>`);
    const q: P2[] = [[cx - 150 * s, cy - 170 * s], [cx + 150 * s, cy - 172 * s], [cx + 148 * s, cy + 90 * s], [cx - 152 * s, cy + 92 * s]];
    ctx.body.push(poly(q, surfaceFill(ctx, 'patch', q[0]!, q[2]!)));
    // Plooien: zachte donkere banen over stof en print, zoals bij een echt kledingstuk.
    for (let i = 0; i < 4; i++) {
      const x = (r() - 0.5) * 360, y = -150 + r() * 360;
      ctx.body.push(`<path d="M${P(x - 140, y)} Q${P(x, y + 30 + jitter(40))} ${P(x + 140, y + jitter(30))}" stroke="#000" stroke-opacity="0.22" stroke-width="${16 * s}" fill="none" filter="url(#blur-s)"/>`);
    }
  } else if (objectType === 'mug' || objectType === 'label' || objectType === 'bottle' || objectType === 'can') {
    // Cilinder recht van voren, licht van boven gezien: boven- en onderrand zijn ellipsen.
    const horizon = h * 0.7;
    backdrop(ctx, horizon, ['#e6e4df', '#d6d3cc'], ['#c9c4bb', '#b3ada2']);
    const R = Math.min(w, h) * 0.2, ry = R * 0.22;
    const cx = w * 0.47 + jitter(w * 0.04), top = h * 0.24, bottom = h * 0.74;
    ctx.defs.push(gradient('body', [cx - R, 0], [cx + R, 0], [[0, '#c9c7c2'], [0.35, '#fbfaf8'], [0.7, '#e9e7e2'], [1, '#a9a6a0']]));
    ctx.body.push(`<ellipse cx="${cx + 8}" cy="${bottom + ry + 10}" rx="${R * 1.05}" ry="${ry * 1.1}" fill="#000" opacity="0.28" filter="url(#blur)"/>`);
    if (objectType === 'mug') ctx.body.push(`<path d="M${cx + R * 0.96},${top + R * 0.45} C${cx + R * 1.75},${top + R * 0.35} ${cx + R * 1.75},${bottom - R * 0.55} ${cx + R * 0.96},${bottom - R * 0.65}" stroke="#e2e0db" stroke-width="${R * 0.22}" fill="none"/>`);
    ctx.body.push(`<path d="M${cx - R},${top} L${cx - R},${bottom} A${R},${ry} 0 0 0 ${cx + R},${bottom} L${cx + R},${top} Z" fill="url(#body)"/>`);
    ctx.body.push(`<ellipse cx="${cx}" cy="${top}" rx="${R}" ry="${ry}" fill="#d9d7d2" stroke="#c4c1bb" stroke-width="2"/>`);
    ctx.body.push(`<ellipse cx="${cx}" cy="${top}" rx="${R * 0.9}" ry="${ry * 0.82}" fill="#8f8c86"/>`);
    // Etiket: van -55° tot 55°, boven- en onderrand op de ellips van de cilinder.
    const a = (55 * Math.PI) / 180, lt = top + (bottom - top) * 0.18, lb = top + (bottom - top) * 0.82;
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) { const f = -a + (2 * a * i) / 40; pts.push(`${(cx + R * Math.sin(f)).toFixed(1)},${(lt + ry * Math.cos(f)).toFixed(1)}`); }
    for (let i = 40; i >= 0; i--) { const f = -a + (2 * a * i) / 40; pts.push(`${(cx + R * Math.sin(f)).toFixed(1)},${(lb + ry * Math.cos(f)).toFixed(1)}`); }
    // Het groene vlak krijgt hetzelfde lichtverloop als de cilinder (de bodykleuren op dezelfde plek, als
    // fractie van het hoogste licht), zoals een echt geprint vlak in een foto.
    if (ctx.chroma) ctx.defs.push(gradient('label', [cx - R * Math.sin(a), 0], [cx + R * Math.sin(a), 0], [[0, '#1dd138'], [0.317, '#22f441'], [0.744, '#20e33d'], [1, '#1ab831']]));
    else ctx.defs.push(gradient('label', [cx - R * Math.sin(a), 0], [cx + R * Math.sin(a), 0], [[0, '#d8d6d1'], [0.38, '#fdfcfa'], [1, '#c9c6c0']]));
    ctx.body.push(`<polygon points="${pts.join(' ')}" fill="url(#label)"/>`);
  } else if (objectType === 'multi-device') {
    const horizon = h * 0.42;
    backdrop(ctx, horizon, ['#e6e4df', '#d2cfc8'], ['#bfa98d', '#a68f72']);
    const project = camera([10 + jitter(10), 34, 62], [0, 6, -2], focal, w, h);
    laptop(ctx, project, [-6, 0, -4], -0.12 + jitter(0.15), 0.95, 0);
    phone(ctx, project, [17, 0, 5], -0.45 + jitter(0.3), 1);
  } else if (objectType === 'laptop' || objectType === 'monitor' || objectType === 'tablet') {
    const horizon = h * 0.4;
    backdrop(ctx, horizon, ['#e8e6e1', '#d4d1ca'], ['#b49c7e', '#977f62']);
    const project = camera([16 + jitter(14), 30 + jitter(6), 58], [0, 9, -3], focal, w, h);
    laptop(ctx, project, [0, 0, 0], -0.2 + jitter(0.3));
  } else {
    // Generiek: een paneel dat schuin in de ruimte staat (bord, doos, voertuigpaneel).
    const horizon = h * 0.62;
    backdrop(ctx, horizon, ['#e5e3de', '#cfccc5'], ['#a8a297', '#918b80']);
    const project = camera([40 + jitter(30), 80, 230], [0, 60, 0], focal, w, h);
    const X: V3 = rotY([1, 0, 0], -0.4 + jitter(0.3)), Y: V3 = [0, 1, 0];
    shadow(ctx, rect([0, 0.5, 0], X, [0, 0, 1], -60, -10, 60, 30).map(project), 0.3);
    const [pw, ph] = sized([116, 96], ctx.look?.ratio, 112);
    ctx.body.push(poly(rect([0, 60, -2], X, Y, -pw / 2 - 4, -ph / 2 - 4, pw / 2 + 4, ph / 2 + 4).map(project), '#3b3d41'));
    const face = rect([0, 60, 0], X, Y, -pw / 2, -ph / 2, pw / 2, ph / 2).map(project);
    ctx.body.push(poly(face, surfaceFill(ctx, 'panel', face[3]!, face[1]!)));
  }
  ctx.body.push(`<rect width="${w}" height="${h}" fill="url(#light)"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${ctx.defs.join('')}</defs>${ctx.body.join('')}</svg>`;
}

export async function renderDemoScene(objectType: string, o: DemoOptions): Promise<Buffer> {
  return sharp(Buffer.from(demoSceneSvg(objectType, o))).png().toBuffer();
}
