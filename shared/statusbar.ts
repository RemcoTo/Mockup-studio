// Statusbalk (telefoon, tablet) en menubalk (laptop, monitor) op het scherm van een 3D-device. Eén tekenfunctie voor
// browser (live weergave) en server (exacte render), op een canvas met dezelfde 2D-API, zodat beide gelijk zijn.
// Eigen iconen (bereik, wifi, batterij, zoeken, bediening), geen merklogo's. Het ontwerp komt onder de balk: de
// balk dekt nooit iets van het ontwerp af.
import type { ScreenCtx } from './mail';
import type { StatusBarKind, StatusBarSpec } from './device3d/spec';
import { designToSurfaceMatrix, type DesignTransform, type Mat3 } from './geometry';

type RGB = [number, number, number];

const lum = ([r, g, b]: RGB) => (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
function lin(c: number) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const css = ([r, g, b]: RGB, a = 1) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

export interface BarStyle { bg: string; fg: string; dim: string; dark: boolean }

/**
 * Kleuren van de balk: de achtergrond sluit aan op de bovenrand van het ontwerp (zoals een app die tot bovenaan
 * doorloopt); tekst en iconen zijn donker op een lichte achtergrond en licht op een donkere, of vast gekozen.
 */
export function barStyle(top: RGB, kind: StatusBarKind, tone: StatusBarSpec['tone']): BarStyle {
  // De menubalk van een desktop is een halfdoorzichtige laag: iets lichter of donkerder dan wat eronder ligt.
  const L = lum(top);
  const bgRGB: RGB = kind === 'desktop'
    ? (L > 0.4 ? top.map((c) => c + (255 - c) * 0.35) as RGB : top.map((c) => c * 0.72) as RGB)
    : top;
  const darkText = tone === 'dark' ? true : tone === 'light' ? false : lum(bgRGB) > 0.36;
  const fg: RGB = darkText ? [0, 0, 0] : [255, 255, 255];
  return { bg: css(bgRGB), fg: css(fg, darkText ? 0.92 : 1), dim: css(fg, darkText ? 0.36 : 0.42), dark: darkText };
}

function roundRect(ctx: ScreenCtx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** Bereik: vier oplopende balkjes. Geeft de breedte terug. Tekent rechts uitgelijnd op x. */
function signal(ctx: ScreenCtx, xr: number, cy: number, h: number, fg: string): number {
  const bw = h * 0.2, gap = h * 0.11, w = bw * 4 + gap * 3;
  ctx.fillStyle = fg;
  for (let i = 0; i < 4; i++) {
    const bh = h * (0.4 + 0.2 * i);
    ctx.beginPath();
    roundRect(ctx, xr - w + i * (bw + gap), cy + h / 2 - bh, bw, bh, bw * 0.3);
    ctx.fill();
  }
  return w;
}

/** Wifi: drie bogen en een punt, als een waaier. */
function wifi(ctx: ScreenCtx, xr: number, cy: number, h: number, fg: string): number {
  const w = h * 1.38, cx = xr - w / 2, base = cy + h / 2;
  const a0 = -Math.PI * 0.75, a1 = -Math.PI * 0.25;
  ctx.fillStyle = fg;
  // Elke boog als gevulde ring-segment (scherper dan een lijn met afgeronde eindjes).
  const band = (r0: number, r1: number) => {
    ctx.beginPath();
    ctx.arc(cx, base, r1, a0, a1);
    ctx.arc(cx, base, r0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  };
  const R = h * 1.0;
  band(R * 0.78, R);
  band(R * 0.45, R * 0.66);
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.arc(cx, base, R * 0.33, a0, a1);
  ctx.closePath();
  ctx.fill();
  return w;
}

/** Batterij: omtrek (gedimd), vulling en nopje; met percentage erin als dat past. */
function battery(ctx: ScreenCtx, xr: number, cy: number, h: number, fg: string, dim: string, level = 1): number {
  const bh = h * 0.92, bw = bh * 2.05, nub = bh * 0.12, w = bw + nub + bh * 0.06;
  const x = xr - w, y = cy - bh / 2, r = bh * 0.3, sw = Math.max(1, bh * 0.085);
  ctx.strokeStyle = dim; ctx.lineWidth = sw;
  ctx.beginPath(); roundRect(ctx, x + sw / 2, y + sw / 2, bw - sw, bh - sw, r); ctx.stroke();
  ctx.fillStyle = dim;
  ctx.beginPath(); roundRect(ctx, x + bw + bh * 0.06, cy - bh * 0.18, nub, bh * 0.36, nub * 0.5); ctx.fill();
  ctx.fillStyle = fg;
  const pad = sw + bh * 0.08;
  ctx.beginPath(); roundRect(ctx, x + pad, y + pad, (bw - pad * 2) * level, bh - pad * 2, r * 0.6); ctx.fill();
  return w;
}

/** Zoeken: vergrootglas. */
function search(ctx: ScreenCtx, xr: number, cy: number, h: number, fg: string): number {
  const w = h, r = h * 0.34, sw = Math.max(1, h * 0.13);
  ctx.strokeStyle = fg; ctx.lineWidth = sw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(xr - w + r + sw / 2, cy - h * 0.08, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(xr - w + r * 1.75, cy + r * 0.62); ctx.lineTo(xr - sw / 2, cy + h * 0.44); ctx.stroke();
  return w;
}

/** Bediening: twee schakelaartjes onder elkaar. */
function toggles(ctx: ScreenCtx, xr: number, cy: number, h: number, fg: string): number {
  const w = h * 1.15, th = h * 0.38, sw = Math.max(1, h * 0.1), x = xr - w;
  ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = sw;
  for (const [i, on] of [[0, true], [1, false]] as const) {
    const y = cy - h * 0.46 + i * h * 0.54;
    ctx.beginPath(); roundRect(ctx, x + sw / 2, y + sw / 2, w - sw, th, th / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(on ? x + w - th / 2 - sw / 2 + 0.5 : x + th / 2 + sw / 2, y + th / 2 + sw / 2, th * 0.28, 0, Math.PI * 2); ctx.fill();
  }
  return w;
}

/** Menu's van een browser in de menubalk (Nederlands). */
const MENUS = ['Archief', 'Wijzig', 'Weergave', 'Geschiedenis', 'Bladwijzers', 'Venster', 'Help'];

/**
 * Tekent de balk in (x, y, W, H). Telefoon: tijd links, rechts bereik, wifi en batterij (de cameraopening valt in
 * het midden van de balk). Tablet: tijd en datum links, rechts wifi, percentage en batterij. Desktop: menubalk met
 * programmanaam en menu's links, rechts batterij, wifi, zoeken, bediening en datum met tijd.
 */
export function drawStatusBar(ctx: ScreenCtx, x: number, y: number, W: number, H: number, kind: StatusBarKind, bar: Pick<StatusBarSpec, 'time' | 'date'>, style: BarStyle, font: string) {
  ctx.save();
  ctx.fillStyle = style.bg;
  ctx.fillRect(x, y, W, H);
  ctx.textBaseline = 'middle';
  const set = (size: number, weight: number) => { ctx.font = `${weight} ${size.toFixed(2)}px ${font}`; };
  if (kind === 'phone') {
    // Inhoud iets onder het midden, op de hoogte van de cameraopening.
    const cy = y + H * 0.6, s = H * 0.3;
    set(s, 640);
    ctx.fillStyle = style.fg; ctx.textAlign = 'center';
    ctx.fillText(bar.time, x + W * 0.19, cy);
    const ih = H * 0.22;
    let xr = x + W * 0.905;
    xr -= battery(ctx, xr, cy, ih, style.fg, style.dim) + ih * 0.42;
    xr -= wifi(ctx, xr, cy, ih, style.fg) + ih * 0.4;
    signal(ctx, xr, cy, ih, style.fg);
  } else if (kind === 'tablet') {
    // Ruime marge: de afgeronde schermhoeken lopen tot in de balk.
    const cy = y + H * 0.52, s = H * 0.48, m = W * 0.043;
    set(s, 600);
    ctx.fillStyle = style.fg; ctx.textAlign = 'left';
    ctx.fillText(bar.time, x + m, cy);
    const tw = ctx.measureText(bar.time).width;
    if (bar.date) { set(s, 500); ctx.fillText(bar.date, x + m + tw + s * 0.55, cy); }
    const ih = H * 0.36;
    let xr = x + W - m;
    xr -= battery(ctx, xr, cy, ih, style.fg, style.dim) + ih * 0.35;
    set(s * 0.92, 560); ctx.textAlign = 'right';
    ctx.fillText('100%', xr, cy);
    xr -= ctx.measureText('100%').width + ih * 0.55;
    wifi(ctx, xr, cy, ih, style.fg);
  } else {
    const cy = y + H * 0.52, s = H * 0.5, m = W * 0.012;
    ctx.fillStyle = style.fg; ctx.textAlign = 'left';
    set(s, 680);
    let xl = x + m;
    ctx.fillText('Browser', xl, cy);
    xl += ctx.measureText('Browser').width + s * 1.25;
    set(s, 480);
    for (const menu of MENUS) { ctx.fillText(menu, xl, cy); xl += ctx.measureText(menu).width + s * 1.25; }
    const ih = H * 0.5;
    let xr = x + W - m;
    set(s, 480); ctx.textAlign = 'right';
    const clock = bar.date ? `${bar.date}  ${bar.time}` : bar.time;
    ctx.fillText(clock, xr, cy);
    xr -= ctx.measureText(clock).width + s * 1.1;
    xr -= toggles(ctx, xr, cy, ih, style.fg) + s * 1.0;
    xr -= search(ctx, xr, cy, ih, style.fg) + s * 1.0;
    xr -= wifi(ctx, xr, cy, ih, style.fg) + s * 1.0;
    battery(ctx, xr, cy, ih * 0.8, style.fg, style.dim);
  }
  ctx.restore();
}

/** Gemiddelde kleur van de bovenste rijen van een beeld (RGBA-pixels), of null als die doorzichtig zijn. */
export function topColor(data: ArrayLike<number>, width: number, height: number, rows = Math.max(1, Math.round(height * 0.012))): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  const stepX = Math.max(1, Math.floor(width / 256));
  for (let y = 0; y < Math.min(height, rows); y++) for (let x = 0; x < width; x += stepX) {
    const i = (y * width + x) * 4, a = data[i + 3]! / 255;
    if (a < 0.5) continue;
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/**
 * Indeling van een scherm met balk, in pixels van het schermcanvas: de balk bovenaan, het ontwerpvlak eronder, en
 * de matrix die ontwerp-pixels naar canvas-pixels brengt (dezelfde passing als zonder balk, maar binnen het vlak).
 */
export function screenLayout(canvas: { width: number; height: number }, fraction: number, design: { width: number; height: number }, t: DesignTransform): { barH: number; area: { width: number; height: number }; matrix: Mat3 } {
  const barH = Math.round(canvas.height * fraction);
  const area = { width: canvas.width, height: canvas.height - barH };
  const m = designToSurfaceMatrix(design, area, t);
  // Naar canvascoördinaten: het vlak begint onder de balk.
  const matrix: Mat3 = [m[0], m[1], m[2], m[3], m[4], m[5] + barH * m[8], m[6], m[7], m[8]];
  return { barH, area, matrix };
}
