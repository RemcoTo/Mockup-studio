// E-mailhandtekening in een mailprogramma: het scherm van een laptop of telefoon wordt opgebouwd uit een
// neutrale mailinterface met de handtekening (het ontwerp) op ware grootte onder de tekst. Dezelfde code
// tekent op de server (exacte render) en in de browser (live weergave in de editor).
// Bewust geen logo of naam van een bestaand mailprogramma: de herkenbare opbouw zit in de indeling.

export type ScreenTemplate = 'mail-desktop' | 'mail-mobile';

export interface MailFields {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

export interface ScreenLayout {
  template: ScreenTemplate;
  /** De handtekening; één vak (een lijst, zodat zoeken op ontwerp en opschonen generiek blijft). */
  slots: { assetId: string | null }[];
  /** Profielfoto van de afzender; zonder foto een cirkel met de initiaal. */
  avatar?: { assetId: string } | null;
  theme?: 'light' | 'dark';
  mail?: Partial<MailFields>;
  /** Breedte van de handtekening in de e-mail, in CSS-pixels; zonder waarde afgeleid van het bestand. */
  signatureWidth?: number;
}

export const DEFAULT_MAIL: MailFields = {
  fromName: 'Jouw naam',
  fromEmail: 'naam@jouwbedrijf.nl',
  to: 'Lotte de Wit',
  subject: 'Voorstel en vervolgafspraak',
  date: 'Vandaag 10:24',
  body: 'Beste Lotte,\n\nDank voor het prettige gesprek van vanochtend. Zoals afgesproken stuur ik je hierbij het voorstel, met de planning en de onderdelen die we bespraken. Laat gerust weten als er nog vragen zijn.\n\nIk hoor graag van je.\n\nMet vriendelijke groet,',
};

export const SIGNATURE_WIDTH_MIN = 120;
export const SIGNATURE_WIDTH_MAX = 900;

export const templateFor = (landscape: boolean): ScreenTemplate => (landscape ? 'mail-desktop' : 'mail-mobile');

/**
 * Breedte waarop een handtekening in een e-mail staat (CSS-pixels). Handtekeningen worden vaak op 2× of 3×
 * geëxporteerd voor scherpte; zonder eigen instelling halveren we tot hij in een gangbare breedte past.
 */
export function naturalSignatureWidth(imgWidth: number): number {
  let w = imgWidth;
  while (w > 700) w /= 2;
  return Math.round(Math.max(SIGNATURE_WIDTH_MIN, w));
}

/** Vult de breedte van de handtekening in vanuit de afmetingen van het originele bestand, als die ontbreekt. */
export function resolveSignatureWidth(layout: ScreenLayout, dims: (assetId: string) => ScreenImage | null): ScreenLayout {
  const id = layout.slots[0]?.assetId;
  const d = id ? dims(id) : null;
  return layout.signatureWidth || !d ? layout : { ...layout, signatureWidth: naturalSignatureWidth(d.width) };
}

export function newMailLayout(landscape: boolean, assetId: string | null, brand?: Partial<ScreenLayout>): ScreenLayout {
  return { template: templateFor(landscape), slots: [{ assetId }], avatar: brand?.avatar ?? null, theme: brand?.theme ?? 'light', mail: brand?.mail ?? {}, signatureWidth: brand?.signatureWidth };
}

export interface ScreenCtx {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineCap: string; lineJoin: string; font: string;
  textAlign: string; textBaseline: string; globalAlpha: number; imageSmoothingEnabled: boolean; imageSmoothingQuality: string;
  save(): void; restore(): void; beginPath(): void; closePath(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void; stroke(): void; clip(): void; fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void; measureText(t: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  drawImage(img: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

export interface ScreenImage { width: number; height: number }

/** Een vak waarin een ontwerp staat, in canvaspixels. */
export interface Slot { kind: 'signature' | 'avatar'; index: number; x: number; y: number; w: number; h: number; round: boolean }

interface Palette { bg: string; panel: string; line: string; text: string; sub: string; faint: string; accent: string; selected: string; field: string }
const LIGHT: Palette = { bg: '#ffffff', panel: '#f5f6f8', line: '#e4e6ea', text: '#1b1d21', sub: '#666b74', faint: '#9a9fa7', accent: '#2a5bd7', selected: '#e7edfb', field: '#eceef2' };
const DARK: Palette = { bg: '#15171a', panel: '#1c1f23', line: '#2a2e34', text: '#eceef1', sub: '#a3a8b0', faint: '#6f757e', accent: '#86a8ff', selected: '#22304c', field: '#262a30' };

const INBOX = [
  { from: 'Studio Vermeer', time: '09:12', subject: 'Drukproef visitekaartjes', preview: 'Bijgevoegd de drukproef op het nieuwe papier. Kun je vandaag akkoord geven?' },
  { from: 'Mark Jansen', time: 'Gisteren', subject: 'Re: planning lancering', preview: 'Goed idee om de livegang een week te verschuiven, dan hebben we ruimte voor' },
  { from: 'Eva Hendriks', time: 'Gisteren', subject: 'Foto’s van de opening', preview: 'Hierbij de selectie van zaterdag. De hoge resolutie staat in de gedeelde map.' },
  { from: 'Bas Willems', time: 'Ma', subject: 'Offerte website', preview: 'Dank voor de toelichting. We gaan akkoord met de voorgestelde aanpak en' },
  { from: 'Notaris Van Dijk', time: 'Ma', subject: 'Concept akte', preview: 'Zoals besproken ontvangt u hierbij het concept ter beoordeling. Wilt u eventuele' },
  { from: 'Lisa de Groot', time: 'Vr', subject: 'Uitnodiging netwerkavond', preview: 'Graag nodigen we je uit voor de netwerkavond op donderdag 19 november in' },
  { from: 'Tim Bakker', time: 'Vr', subject: 'Re: materialen showroom', preview: 'De stalen zijn binnen. Zullen we volgende week samen kijken welke het beste' },
];

/**
 * Tekent de mailweergave op een canvas van W × H, of bepaalt alleen de vakken (ctx = null).
 * images(id) levert de (afmetingen van de) afbeelding van een ontwerp, of null als die ontbreekt.
 */
export function drawMail(ctx: ScreenCtx | null, layout: ScreenLayout, W: number, H: number, images: (assetId: string) => ScreenImage | null, font = 'sans-serif'): Slot[] {
  const pal = layout.theme === 'dark' ? DARK : LIGHT;
  const mail: MailFields = { ...DEFAULT_MAIL, ...Object.fromEntries(Object.entries(layout.mail ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) };
  const d = new Draw(ctx, font);
  const slots: Slot[] = [];
  const sigId = layout.slots[0]?.assetId ?? null;
  const sig = sigId ? images(sigId) : null;
  const avatarId = layout.avatar?.assetId ?? null;

  const drawImage = (kind: Slot['kind'], x: number, y: number, w: number, h: number, id: string | null, round: boolean) => {
    slots.push({ kind, index: 0, x, y, w, h, round });
    const img = id ? images(id) : null;
    if (!ctx || !img || !(img.width > 0)) return;
    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Profielfoto vult de cirkel (bijsnijden vanuit het midden); de handtekening staat er altijd heel en onvervormd.
    if (round) {
      const s = Math.max(w / img.width, h / img.height);
      const sw = w / s, sh = h / s;
      ctx.drawImage(img as never, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
    } else {
      ctx.drawImage(img as never, 0, 0, img.width, img.height, x, y, w, h);
    }
    ctx.restore();
  };
  const avatar = (cx: number, cy: number, r: number) => {
    if (avatarId && images(avatarId)) return drawImage('avatar', cx - r, cy - r, r * 2, r * 2, avatarId, true);
    if (avatarId) slots.push({ kind: 'avatar', index: 0, x: cx - r, y: cy - r, w: r * 2, h: r * 2, round: true });
    d.circle(cx, cy, r, pal.selected, true);
    d.text(initials(mail.fromName), cx, cy + r * 0.36, r * 0.92, 600, pal.accent, 'center');
  };
  /** Handtekening op ware grootte: breedte in CSS-pixels × schaal, hoogte volgens het bestand. */
  const signature = (x: number, y: number, maxCss: number, u: number) => {
    const css = Math.min(maxCss, layout.signatureWidth ?? (sig ? naturalSignatureWidth(sig.width) : 480));
    const w = css * u;
    const h = sig && sig.width > 0 ? (w * sig.height) / sig.width : w * 0.3;
    if (!sigId) {
      // Nog geen ontwerp gekozen: een rustige plek waar de handtekening komt.
      slots.push({ kind: 'signature', index: 0, x, y, w, h, round: false });
      d.roundStroke(x, y, w, h, 6 * u, pal.line, 1.5 * u);
      d.text('Handtekening', x + w / 2, y + h / 2 + 5 * u, 14 * u, 500, pal.faint, 'center');
      return;
    }
    drawImage('signature', x, y, w, h, sigId, false);
  };
  /** Tekst met alinea's (een lege regel geeft witruimte); geeft de y onder de laatste regel terug. */
  const body = (x: number, y: number, maxW: number, size: number, lh: number) => {
    let cy = y;
    for (const para of mail.body.split('\n')) {
      if (!para.trim()) { cy += lh * 0.6; continue; }
      for (const line of d.wrap(para, maxW, size, 400, 40)) { cy += lh; d.text(line, x, cy - lh * 0.28, size, 400, pal.text); }
    }
    return cy;
  };

  if (ctx) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H); }

  if (layout.template === 'mail-desktop') {
    const u = W / 1280;
    const side = 232 * u, listW = 360 * u, listX = side, readX = side + listW;
    // Zijbalk met mappen.
    if (ctx) { ctx.fillStyle = pal.panel; ctx.fillRect(0, 0, side, H); }
    d.round(16 * u, 16 * u, side - 32 * u, 44 * u, 12 * u, pal.accent);
    const onAccent = layout.theme === 'dark' ? '#0e1630' : '#ffffff';
    d.icon('pen', 30 * u, 28 * u, 20 * u, onAccent, 1.8 * u);
    d.text('Nieuw bericht', 60 * u, 44 * u, 15 * u, 600, onAccent);
    const folders: [string, string, string][] = [['inbox', 'Postvak IN', '3'], ['star', 'Met ster', ''], ['send', 'Verzonden', ''], ['file', 'Concepten', '1'], ['archive', 'Archief', ''], ['trash', 'Prullenbak', '']];
    folders.forEach(([icon, label, count], i) => {
      const y = 84 * u + i * 40 * u;
      if (i === 0) d.round(10 * u, y, side - 20 * u, 36 * u, 10 * u, pal.selected);
      const color = i === 0 ? pal.accent : pal.sub;
      d.icon(icon, 24 * u, y + 8 * u, 20 * u, color, 1.7 * u);
      d.text(label, 56 * u, y + 23.5 * u, 14.5 * u, i === 0 ? 600 : 500, i === 0 ? pal.text : pal.sub);
      if (count) d.text(count, side - 26 * u, y + 23.5 * u, 13 * u, 600, color, 'right');
    });
    // Zoekveld en eigen profiel bovenin.
    d.round(listX + 16 * u, 14 * u, 420 * u, 38 * u, 19 * u, pal.field);
    d.icon('search', listX + 30 * u, 23 * u, 20 * u, pal.faint, 1.7 * u);
    d.text('Zoeken in e-mail', listX + 60 * u, 38 * u, 14.5 * u, 400, pal.faint);
    d.circle(W - 40 * u, 33 * u, 17 * u, pal.selected, true);
    d.text(initials(mail.to), W - 40 * u, 38.5 * u, 14 * u, 600, pal.accent, 'center');
    d.round(listX, 66 * u, W - listX, 1 * u, 0, pal.line);
    // Berichtenlijst; het eerste bericht is het geopende.
    d.round(readX, 66 * u, 1 * u, H, 0, pal.line);
    d.text('Postvak IN', listX + 24 * u, 106 * u, 20 * u, 700, pal.text);
    const items = [{ from: mail.fromName, time: shortTime(mail.date), subject: mail.subject, preview: firstLine(mail.body) }, ...INBOX];
    items.forEach((it, i) => {
      const y = 124 * u + i * 92 * u;
      if (y > H) return;
      if (i === 0) d.round(listX + 8 * u, y, listW - 16 * u, 86 * u, 12 * u, pal.selected);
      else d.round(listX + 24 * u, y - 3 * u, listW - 48 * u, 1 * u, 0, pal.line);
      if (i === 1 || i === 2) d.circle(listX + 16 * u, y + 25 * u, 4 * u, pal.accent, true);
      const tx = listX + 28 * u, tw = listW - 56 * u;
      const timeW = d.text(it.time, listX + listW - 24 * u, y + 30 * u, 12.5 * u, 500, pal.sub, 'right');
      d.text(d.fit(it.from, tw - timeW - 12 * u, 15 * u, i <= 2 ? 650 : 500), tx, y + 30 * u, 15 * u, i <= 2 ? 650 : 500, pal.text);
      d.text(d.fit(it.subject, tw, 14 * u, 500), tx, y + 52 * u, 14 * u, 500, pal.text);
      d.text(d.fit(it.preview, tw, 13.5 * u, 400), tx, y + 72 * u, 13.5 * u, 400, pal.sub);
    });
    // Leesvenster.
    const px = readX + 48 * u, pw = Math.min(W - px - 48 * u, 720 * u);
    ['reply', 'replyAll', 'forward', 'archive', 'trash'].forEach((ic, i) => d.icon(ic, readX + 40 * u + i * 44 * u, 86 * u, 22 * u, pal.sub, 1.7 * u));
    d.dots(W - 64 * u, 97 * u, 2.2 * u, pal.sub);
    let y = 150 * u;
    for (const line of d.wrap(mail.subject, pw, 26 * u, 700, 2)) { y += 34 * u; d.text(line, px, y - 8 * u, 26 * u, 700, pal.text); }
    y += 20 * u;
    avatar(px + 22 * u, y + 22 * u, 22 * u);
    const nameW = d.text(d.fit(mail.fromName, pw * 0.5, 16 * u, 650), px + 58 * u, y + 17 * u, 16 * u, 650, pal.text);
    d.text(d.fit(`<${mail.fromEmail}>`, pw - nameW - 200 * u, 14 * u, 400), px + 66 * u + nameW, y + 17 * u, 14 * u, 400, pal.sub);
    d.text(`Aan: ${mail.to}`, px + 58 * u, y + 39 * u, 13.5 * u, 400, pal.sub);
    d.text(mail.date, px + pw, y + 17 * u, 13.5 * u, 400, pal.sub, 'right');
    y = body(px, y + 76 * u, Math.min(pw, 680 * u), 15.5 * u, 25 * u);
    signature(px, y + 18 * u, Math.min(pw, 900 * u) / u, u);
    return slots;
  }

  // Telefoon.
  const u = W / 390;
  d.status(W, u, pal.text, pal.bg);
  d.icon('back', 10 * u, 62 * u, 26 * u, pal.accent, 2.2 * u);
  d.text('Postvak IN', 38 * u, 82 * u, 17 * u, 500, pal.accent);
  d.icon('archive', W - 128 * u, 63 * u, 24 * u, pal.accent, 1.8 * u);
  d.icon('trash', W - 88 * u, 63 * u, 24 * u, pal.accent, 1.8 * u);
  d.dots(W - 34 * u, 75 * u, 2 * u, pal.accent);
  const pad = 20 * u, cw = W - pad * 2;
  let y = 112 * u;
  for (const line of d.wrap(mail.subject, cw, 24 * u, 700, 3)) { y += 31 * u; d.text(line, pad, y - 7 * u, 24 * u, 700, pal.text); }
  y += 18 * u;
  avatar(pad + 20 * u, y + 20 * u, 20 * u);
  const timeW = d.text(shortTime(mail.date), W - pad, y + 16 * u, 13 * u, 400, pal.sub, 'right');
  d.text(d.fit(mail.fromName, cw - 52 * u - timeW - 10 * u, 16 * u, 650), pad + 52 * u, y + 16 * u, 16 * u, 650, pal.text);
  const toW = d.text(d.fit(`aan ${mail.to}`, cw - 80 * u, 14 * u, 400), pad + 52 * u, y + 37 * u, 14 * u, 400, pal.sub);
  d.icon('chevron', pad + 56 * u + toW, y + 25 * u, 14 * u, pal.sub, 1.6 * u);
  d.round(pad, y + 60 * u, cw, 1 * u, 0, pal.line);
  y = body(pad, y + 76 * u, cw, 16 * u, 24 * u);
  signature(pad, y + 16 * u, cw / u, u);
  // Onderbalk met beantwoorden en doorsturen, en de thuisbalk.
  const bh = 84 * u;
  if (ctx) { ctx.fillStyle = pal.bg; ctx.fillRect(0, H - bh, W, bh); }
  d.round(0, H - bh, W, 0.7 * u, 0, pal.line);
  ['reply', 'forward', 'pen'].forEach((ic, i) => d.icon(ic, W * (0.18 + i * 0.32) - 12 * u, H - bh + 14 * u, 24 * u, pal.accent, 1.9 * u));
  d.round(W / 2 - 67 * u, H - 13 * u, 134 * u, 5 * u, 2.5 * u, pal.text);
  return slots;
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
};
const firstLine = (body: string) => body.split('\n').map((l) => l.trim()).filter(Boolean).slice(1).join(' ') || body.trim();
const shortTime = (date: string) => /(\d{1,2}[:.]\d{2})/.exec(date)?.[1] ?? date;

/** Tekenhulp: tekst, vormen en een kleine set lijniconen. Zonder context (ctx = null) doet hij niets. */
class Draw {
  constructor(private ctx: ScreenCtx | null, private font: string) {}
  private set(size: number, weight: number) { if (this.ctx) this.ctx.font = `${weight} ${Math.max(1, size).toFixed(2)}px ${this.font}`; }
  measure(s: string, size: number, weight: number): number {
    if (!this.ctx) return s.length * size * 0.55;
    this.set(size, weight);
    return this.ctx.measureText(s).width;
  }
  text(s: string, x: number, y: number, size: number, weight: number, color: string, align: 'left' | 'center' | 'right' = 'left'): number {
    const w = this.measure(s, size, weight);
    const c = this.ctx;
    if (!c) return w;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(s, x, y);
    return w;
  }
  /** Kort een regel in met een beletselteken als hij niet past. */
  fit(s: string, max: number, size: number, weight: number): string {
    if (this.measure(s, size, weight) <= max) return s;
    let t = s;
    while (t.length > 1 && this.measure(`${t}…`, size, weight) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }
  wrap(s: string, max: number, size: number, weight: number, lines: number): string[] {
    const words = s.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (this.measure(next, size, weight) <= max || !cur) cur = next;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; out[lines - 1] = this.fit(`${out[lines - 1]} …`, max, size, weight); }
    return out;
  }
  round(x: number, y: number, w: number, h: number, r: number, fill: string) {
    const c = this.ctx;
    if (!c) return;
    this.roundPath(x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
  }
  roundStroke(x: number, y: number, w: number, h: number, r: number, stroke: string, lw: number) {
    const c = this.ctx;
    if (!c) return;
    this.roundPath(x, y, w, h, r);
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.stroke();
  }
  private roundPath(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx!;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }
  circle(cx: number, cy: number, r: number, color: string, filled: boolean, lw = 1) {
    const c = this.ctx;
    if (!c) return;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    if (filled) { c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = lw; c.stroke(); }
  }
  dots(cx: number, cy: number, r: number, color: string) {
    for (const dx of [-3.2, 0, 3.2]) this.circle(cx + dx * r * 1.4, cy, r, color, true);
  }
  /** Statusbalk: tijd links, bereik, wifi en batterij rechts. */
  status(W: number, u: number, color: string, bg: string) {
    const c = this.ctx;
    if (!c) return;
    c.fillStyle = bg; c.fillRect(0, 0, W, 54 * u);
    this.text('9:41', 54 * u, 34 * u, 16 * u, 600, color, 'center');
    const x = W - 100 * u, y = 23 * u;
    for (let i = 0; i < 4; i++) this.round(x + i * 5 * u, y + 9 * u - (i + 1) * 2.4 * u, 3 * u, (i + 1) * 2.4 * u + 1 * u, 0.8 * u, color);
    c.strokeStyle = color; c.lineWidth = 1.7 * u; c.lineCap = 'round';
    for (const r of [3, 6.5, 10]) { c.beginPath(); c.arc(x + 36 * u, y + 11 * u, r * u, -Math.PI * 0.75, -Math.PI * 0.25); c.stroke(); }
    this.roundStroke(x + 54 * u, y, 25 * u, 12 * u, 3.5 * u, color, 1.1 * u);
    this.round(x + 56 * u, y + 2 * u, 19 * u, 8 * u, 2 * u, color);
    this.round(x + 80.5 * u, y + 4 * u, 1.6 * u, 4 * u, 0.8 * u, color);
  }
  /** Lijniconen in een vak van 24 × 24, geschaald naar size. */
  icon(name: string, x: number, y: number, size: number, color: string, lw: number) {
    const c = this.ctx;
    if (!c) return;
    const s = size / 24;
    const P = (px: number, py: number): [number, number] => [x + px * s, y + py * s];
    c.save();
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    const m = (px: number, py: number) => c.moveTo(...P(px, py));
    const l = (px: number, py: number) => c.lineTo(...P(px, py));
    const q = (cx: number, cy: number, px: number, py: number) => c.quadraticCurveTo(...P(cx, cy), ...P(px, py));
    const a = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2) => { c.moveTo(...P(cx + r * Math.cos(a0), cy + r * Math.sin(a0))); c.arc(...P(cx, cy), r * s, a0, a1); };
    switch (name) {
      case 'back': m(15, 4); l(7, 12); l(15, 20); break;
      case 'chevron': m(6, 9); l(12, 15); l(18, 9); break;
      case 'search': a(10.5, 10.5, 7); m(15.6, 15.6); l(21, 21); break;
      case 'inbox': m(3, 13); l(8, 13); l(9.5, 16); l(14.5, 16); l(16, 13); l(21, 13); m(3, 13); l(5.5, 5); q(6, 4, 7, 4); l(17, 4); q(18, 4, 18.5, 5); l(21, 13); l(21, 19); q(21, 20, 20, 20); l(4, 20); q(3, 20, 3, 19); l(3, 13); break;
      case 'star': m(12, 3); l(14.7, 8.7); l(21, 9.5); l(16.4, 13.8); l(17.6, 20); l(12, 17); l(6.4, 20); l(7.6, 13.8); l(3, 9.5); l(9.3, 8.7); l(12, 3); break;
      case 'send': m(21.5, 2.5); l(10.5, 13.5); m(21.5, 2.5); l(14.5, 21.5); l(10.5, 13.5); l(2.5, 9.5); l(21.5, 2.5); break;
      case 'file': m(6, 3); l(14, 3); l(19, 8); l(19, 20); q(19, 21, 18, 21); l(6, 21); q(5, 21, 5, 20); l(5, 4); q(5, 3, 6, 3); m(14, 3); l(14, 8); l(19, 8); break;
      case 'archive': m(3, 4); l(21, 4); l(21, 8); l(3, 8); l(3, 4); m(5, 8); l(5, 19); q(5, 20, 6, 20); l(18, 20); q(19, 20, 19, 19); l(19, 8); m(10, 12); l(14, 12); break;
      case 'trash': m(3.5, 6); l(20.5, 6); m(9, 6); l(9.5, 3.5); l(14.5, 3.5); l(15, 6); m(6, 6); l(7, 20); q(7.1, 21, 8, 21); l(16, 21); q(16.9, 21, 17, 20); l(18, 6); m(10, 10); l(10.4, 17); m(14, 10); l(13.6, 17); break;
      case 'reply': m(10, 5); l(3.5, 11); l(10, 17); m(3.5, 11); l(14, 11); q(20.5, 11, 20.5, 18); break;
      case 'replyAll': m(8, 5); l(2, 11); l(8, 17); m(13, 5); l(6.5, 11); l(13, 17); m(6.5, 11); l(15, 11); q(21, 11, 21, 18); break;
      case 'forward': m(14, 5); l(20.5, 11); l(14, 17); m(20.5, 11); l(10, 11); q(3.5, 11, 3.5, 18); break;
      case 'pen': m(4, 20); l(5, 15.5); l(15.5, 5); q(17, 3.5, 18.5, 5); q(20, 6.5, 18.5, 8); l(8, 18.5); l(4, 20); m(13.5, 7); l(16.5, 10); break;
      default: break;
    }
    c.stroke();
    c.restore();
  }
}

/** Afmeting waarop het scherm getekend wordt: de verhouding van het vlak, scherp genoeg voor de uitvoer. */
export function screenCanvasSize(surface: { width: number; height: number }, landscape: boolean, pixels: number): { width: number; height: number } {
  const aspect = surface.width / Math.max(1e-6, surface.height);
  // Telefoon: minimaal de breedte van een echt scherm (1080 px); desktop: minimaal 1920 px voor scherpe tekst.
  const base = landscape ? 1920 : 1080;
  const width = Math.round(Math.min(landscape ? 3840 : 2160, Math.max(base, pixels)));
  return { width, height: Math.max(1, Math.round(width / aspect)) };
}
