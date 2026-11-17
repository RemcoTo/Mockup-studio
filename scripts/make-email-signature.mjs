// Maakt de voorbeeld-e-mailhandtekening in fixtures/email (fictief architectenbureau), met het lettertype van de studio.
// Draaien vanuit de projectmap: node scripts/make-email-signature.mjs
// Geëxporteerd op 2× (840 × 264 px) voor scherpte; in de e-mail staat hij op 420 × 132 CSS-pixels.
import { createCanvas, GlobalFonts, Path2D } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const dir = 'node_modules/@fontsource-variable/schibsted-grotesk/files/';
GlobalFonts.registerFromPath(dir + 'schibsted-grotesk-latin-wght-normal.woff2', 'S');
const S = 2, W = 420 * S, H = 132 * S;
const ink = '#1f1f1c', sub = '#6c6a64', green = '#2f3b33', clay = '#b4644a';
const c = createCanvas(W, H);
const x = c.getContext('2d');
x.fillStyle = '#ffffff';
x.fillRect(0, 0, W, H);
const text = (s, px, w, col, tx, ty, ls = 0) => { x.font = `${w} ${px * S}px S`; x.fillStyle = col; x.letterSpacing = `${ls * S}px`; x.fillText(s, tx * S, ty * S); };

// Beeldmerk: dezelfde lijnvorm als op het visitekaartje, in een vlak van het merkgroen.
x.fillStyle = green;
x.beginPath(); x.roundRect(0, 18 * S, 96 * S, 96 * S, 6 * S); x.fill();
x.save();
x.translate(22 * S, 40 * S); x.scale(1.4 * S, 1.4 * S);
x.strokeStyle = '#e9e5de'; x.lineWidth = 3; x.lineCap = 'butt';
x.stroke(new Path2D('M20 4a16 16 0 1 0 16 16V36H20'));
x.restore();

// Naam en functie, daaronder de contactregels; een dunne lijn in de accentkleur scheidt ze.
const left = 120;
text('Femke de Vries', 19, 650, ink, left, 42, -0.2);
text('Architect, partner bij Atelier Noord', 13, 450, sub, left, 62);
x.fillStyle = clay; x.fillRect(left * S, 76 * S, 28 * S, 2 * S);
text('050 123 45 67', 12.5, 500, ink, left, 100);
text('femke@ateliernoord.nl', 12.5, 500, ink, left + 108, 100);
text('ateliernoord.nl', 12.5, 500, green, left, 120);
text('Noorderhaven 12, Groningen', 12.5, 400, sub, left + 108, 120);
writeFileSync('fixtures/email/handtekening-atelier-noord.png', c.toBuffer('image/png'));
console.log('ok');
