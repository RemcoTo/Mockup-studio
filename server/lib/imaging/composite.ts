// Plaatst het originele ontwerp met een perspectieftransformatie op een oppervlak in de scène.
// Het ontwerp wordt alleen geometrisch vervormd en belicht; de inhoud verandert nooit.

import { designToSurfaceMatrix, homography, invert3, surfaceDimensions, type DesignTransform, type ImageFrame, type Quad } from '../../../shared/geometry';
import { arcFactor, effectiveMesh, meshCells, meshSurfaceDims, type CylinderParams, type Mesh } from '../../../shared/warp';
import { glossAt } from '../../../shared/gloss';
import type { BlendSettings } from '../../../shared/types';
import { sampleBilinear, sampleGray, type Gray, type RGBA } from './raster';

export interface CompositeInput {
  quad: Quad;
  /** Gebogen of vrij vervormd oppervlak; null = vlak (alleen de vierhoek). */
  mesh?: Mesh | null;
  cylinder?: CylinderParams | null;
  design: RGBA | null;
  transform: DesignTransform;
  /**
   * Vulkleur binnen het vlak; null = transparant (alleen het ontwerp zelf); 'auto' = naadloos: het vlak
   * wordt opgevuld vanuit het object eromheen (met het verloop van de foto), zodat alleen de print zichtbaar is.
   */
  background: [number, number, number] | null | 'auto';
  blend: BlendSettings;
  mask: Gray | null;
  shading: Gray | null;
  /** Bemonsteringen per as per pixel (2 = 4 monsters), voor gladde randen. */
  supersample?: number;
  /** Groene rand van het chroma-vlak neutraliseren. */
  despill?: boolean;
  /** Bekende echte verhouding van het vlak (3D-model); anders geschat uit de hoeken. */
  aspect?: number | null;
}

/** Afmeting van het uitgerolde oppervlak voor een plaatsing. */
export function placementSurface(quad: Quad, mesh: Mesh | null | undefined, cylinder: CylinderParams | null | undefined, image?: ImageFrame) {
  const m = effectiveMesh(quad, mesh, cylinder);
  if (m.cols === 1 && m.rows === 1 && !cylinder) return { mesh: m, surface: surfaceDimensions(quad, image) };
  return { mesh: m, surface: meshSurfaceDims(m, image, cylinder) };
}

/** Hoeveel ontwerp-pixels er per scène-pixel nodig zijn; gebruikt om het ontwerp vooraf te verkleinen. */
export function designScaleOnScene(design: { width: number; height: number }, quad: Quad, t: DesignTransform, image?: ImageFrame, mesh?: Mesh | null, cylinder?: CylinderParams | null): number {
  const { surface } = placementSurface(quad, mesh, cylinder, image);
  const A = designToSurfaceMatrix(design, surface, t);
  // Bij een cilinder is het midden breder in beeld dan gemiddeld; neem dat mee zodat het scherp blijft.
  return Math.hypot(A[0], A[3]) * (cylinder && cylinder.wrap > 0 ? arcFactor(cylinder.wrap) : 1);
}

type Locator = (x: number, y: number, out: Float64Array) => boolean;

/** Snelle zoekfunctie: scènepunt naar punt op het uitgerolde oppervlak, of false als het erbuiten valt. */
function buildLocator(m: Mesh, surface: { width: number; height: number }): { locate: Locator; bbox: [number, number, number, number] } {
  const cells = meshCells(m, surface).map((c) => ({ quad: c.quad, inv: invert3(homography(c.rect, c.quad)), w: surface.width, h: surface.height }));
  const xs = m.points.map((p) => p[0]), ys = m.points.map((p) => p[1]);
  const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (cells.length === 1) {
    const c = cells[0]!;
    return {
      bbox,
      locate(x, y, out) {
        const w = c.inv[6] * x + c.inv[7] * y + c.inv[8];
        const u = (c.inv[0] * x + c.inv[1] * y + c.inv[2]) / w, v = (c.inv[3] * x + c.inv[4] * y + c.inv[5]) / w;
        if (u < 0 || v < 0 || u > c.w || v > c.h) return false;
        out[0] = u; out[1] = v;
        return true;
      },
    };
  }
  // Raster met vakjes; per vakje de cellen die het overlappen, zodat we per punt maar een paar cellen testen.
  const G = 48;
  const bw = (bbox[2] - bbox[0]) / G || 1, bh = (bbox[3] - bbox[1]) / G || 1;
  const bins: number[][] = Array.from({ length: G * G }, () => []);
  cells.forEach((c, i) => {
    const cx = c.quad.map((p) => p[0]), cy = c.quad.map((p) => p[1]);
    const gx0 = Math.max(0, Math.floor((Math.min(...cx) - bbox[0]) / bw)), gx1 = Math.min(G - 1, Math.floor((Math.max(...cx) - bbox[0]) / bw));
    const gy0 = Math.max(0, Math.floor((Math.min(...cy) - bbox[1]) / bh)), gy1 = Math.min(G - 1, Math.floor((Math.max(...cy) - bbox[1]) / bh));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) bins[gy * G + gx]!.push(i);
  });
  const inside = (q: Quad, x: number, y: number) => {
    let c = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = q[i]!, [xj, yj] = q[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return {
    bbox,
    locate(x, y, out) {
      const gx = Math.floor((x - bbox[0]) / bw), gy = Math.floor((y - bbox[1]) / bh);
      if (gx < 0 || gy < 0 || gx >= G || gy >= G) return false;
      for (const i of bins[gy * G + gx]!) {
        const c = cells[i]!;
        if (!inside(c.quad, x, y)) continue;
        const w = c.inv[6] * x + c.inv[7] * y + c.inv[8];
        out[0] = Math.max(0, Math.min(c.w, (c.inv[0] * x + c.inv[1] * y + c.inv[2]) / w));
        out[1] = Math.max(0, Math.min(c.h, (c.inv[3] * x + c.inv[4] * y + c.inv[5]) / w));
        return true;
      }
      return false;
    },
  };
}

export function compositeOnto(scene: RGBA, input: CompositeInput): void {
  const { design, transform, background, blend, mask, shading } = input;
  const ss = Math.max(1, Math.min(4, input.supersample ?? 2));
  const W = scene.width, Hh = scene.height;
  const { mesh, surface } = placementSurface(input.quad, input.mesh, input.cylinder, { width: W, height: Hh, aspect: input.aspect });
  const { locate, bbox } = buildLocator(mesh, surface);
  const dims = design ? { width: design.width, height: design.height } : { width: surface.width, height: surface.height };
  const surfToDesign = invert3(designToSurfaceMatrix(dims, surface, transform));

  // Met masker iets ruimer: de overgangspixels van het paneel liggen soms net buiten het gepaste vlak.
  const pad = Math.ceil(blend.displacement) + (mask ? 6 : 2);
  const x0 = Math.max(0, Math.floor(bbox[0]) - pad), x1 = Math.min(W - 1, Math.ceil(bbox[2]) + pad);
  const y0 = Math.max(0, Math.floor(bbox[1]) - pad), y1 = Math.min(Hh - 1, Math.ceil(bbox[3]) + pad);

  const sample = new Float64Array(4);
  const uv = new Float64Array(2);
  const d = scene.data;
  const k = Math.max(0, Math.min(1, blend.shading));
  const gloss = Math.max(0, Math.min(1, blend.gloss));
  const opacity = Math.max(0, Math.min(1, blend.opacity));
  const disp = Math.max(0, blend.displacement);
  const n = ss * ss;
  const panel = mask && input.despill !== false ? panelColor(scene, mask, x0, y0, x1, y1) : null;
  const seamless = background === 'auto' && mask ? surroundFill(scene, mask, x0, y0, x1, y1, shading) : null;
  // Originele pixels van het kader: de paneelkleur vlak naast een randpixel is de beste schatting om te ontmengen.
  const bw0 = x1 - x0 + 1;
  const orig = panel ? new Uint8ClampedArray((y1 - y0 + 1) * bw0 * 3) : null;
  if (orig) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const si = (y * W + x) * 4, oi = ((y - y0) * bw0 + (x - x0)) * 3; orig[oi] = scene.data[si]!; orig[oi + 1] = scene.data[si + 1]!; orig[oi + 2] = scene.data[si + 2]!; }
  // Licht en reflecties van het groene paneel: per pixel een schaalfactor (schaduw, lichtval) en een
  // opgetelde reflectie (glimlicht, spiegeling van een raam). Het ontwerp krijgt de schaalfactor, de
  // reflectie komt er bovenop; het groen zelf komt nooit in het resultaat.
  const refl = Math.max(0, Math.min(1, blend.reflections ?? 1));
  const light = panel && orig ? panelLight(orig, mask!, panel, x0, y0, x1, y1, W, Hh) : null;
  const localPanel = (x: number, y: number, out: number[]) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || mask!.data[ny * W + nx]! < 250 || onMaskEdge(mask!, nx, ny, W, Hh)) continue;
        const oi = ((ny - y0) * bw0 + (nx - x0)) * 3;
        n++; r += orig![oi]!; g += orig![oi + 1]!; b += orig![oi + 2]!;
      }
    if (n) { out[0] = r / n; out[1] = g / n; out[2] = b / n; } else { out[0] = panel![0]; out[1] = panel![1]; out[2] = panel![2]; }
  };
  const lp = [0, 0, 0];
  const lb = [0, 0, 0];
  // Kandidaten voor de achtergrond naast een randpixel: de dichtstbijzijnde pixels buiten het masker (de eerste
  // ring rondom waarin er zijn). Verder kijken pakt bij een smal kader de kleur achter het kader.
  const bgCands: number[] = [];
  const bgCandidates = (x: number, y: number) => {
    bgCands.length = 0;
    for (let rad = 1; rad <= 4 && !bgCands.length; rad++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || mask!.data[ny * W + nx]! > 0) continue;
          bgCands.push(((ny - y0) * bw0 + (nx - x0)) * 3);
        }
    return bgCands;
  };
  /**
   * Aandeel paneel in een mengpixel. Een randpixel is een mengsel van paneel en de achtergrond direct ernaast;
   * van alle buren buiten het vlak geldt de buur waarvoor de pixel het best op de lijn buur-paneel ligt. Zo
   * telt een pixel van een smal kader niet als half paneel omdat er toevallig ook bureau naast ligt.
   */
  const panelShare = (x: number, y: number, pi4: number): number | null => {
    localPanel(x, y, lp);
    const oi = ((y - y0) * bw0 + (x - x0)) * 3;
    const c0 = orig![oi]!, c1 = orig![oi + 1]!, c2 = orig![oi + 2]!;
    let best: number | null = null, bestRes = Infinity, bestLen2 = 0;
    for (const bi of bgCandidates(x, y)) {
      const b0 = orig![bi]!, b1 = orig![bi + 1]!, b2 = orig![bi + 2]!;
      const gx = lp[0]! - b0, gy = lp[1]! - b1, gz = lp[2]! - b2;
      const len2 = gx * gx + gy * gy + gz * gz;
      if (len2 < 900) continue;
      const t = Math.max(0, Math.min(1, ((c0 - b0) * gx + (c1 - b1) * gy + (c2 - b2) * gz) / len2));
      const rx = c0 - b0 - t * gx, ry = c1 - b1 - t * gy, rz = c2 - b2 - t * gz;
      const res = rx * rx + ry * ry + rz * rz;
      if (res < bestRes) { bestRes = res; best = t; bestLen2 = len2; lb[0] = b0; lb[1] = b1; lb[2] = b2; }
    }
    // Is het paneeldeel kleiner dan wat de lijn niet verklaart, dan is dit geen mengsel met het paneel
    // (bijvoorbeeld een overgang van kader naar bureau): niets van het paneel aftrekken.
    if (best !== null) return best * best * bestLen2 < bestRes ? 0 : Math.min(0.97, best);
    const span = lp[1]! - Math.max(lp[0]!, lp[2]!);
    if (span < 20) return null;
    return Math.max(0, Math.min(0.97, (d[pi4 + 1]! - Math.max(d[pi4]!, d[pi4 + 2]!)) / span));
  };
  const solid = Array.isArray(background) ? background : null;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const pi = y * W + x;
      let m = mask ? mask.data[pi]! / 255 : 1;
      // Binnen het paneel (geen lege maskerpixel in de buurt) telt het vlak volledig; een lagere maskerwaarde
      // daar komt van een lichtere plek in het groen (reflectie), niet van een rand.
      const edgePx = mask ? nearLow(mask, x, y, W, Hh) : false;
      if (mask && !edgePx && m > 0) m = 1;
      if (mask && edgePx && input.despill !== false) {
        // Overgangspixels: het masker zit er vaak naast (te hoog of te laag), wat een donker of paars lijntje
        // geeft. Schat het paneelaandeel opnieuw uit de kleur: waar ligt de pixel tussen achtergrond en paneel.
        // Buiten het masker alleen de pixels er direct naast: alleen die kunnen nog een stukje paneel bevatten.
        if (m === 0 && !nearMask(mask, x, y, W, Hh, 1)) continue;
        const di0 = pi * 4, lim0 = Math.max(d[di0]!, d[di0 + 2]!);
        if (panel) {
          const share = panelShare(x, y, di0);
          if (share !== null) m = share;
        } else if (m === 0 && d[di0 + 1]! > lim0) d[di0 + 1] = lim0 + (d[di0 + 1]! - lim0) * 0.3;
        if (m < 0.01) {
          // Geen paneel in deze pixel, maar wel vaak groen strooilicht (gloed op een kader): dat eruit halen.
          const lim = Math.max(d[di0]!, d[di0 + 2]!);
          if (d[di0 + 1]! > lim) d[di0 + 1] = lim;
          continue;
        }
      }

      // Verplaatsing langs de plooien: de helling van de schaduwkaart duwt het monsterpunt opzij.
      let ox = 0, oy = 0;
      if (disp > 0 && shading) {
        const gx = sampleGray(shading, x + 1.5, y + 0.5) - sampleGray(shading, x - 0.5, y + 0.5);
        const gy = sampleGray(shading, x + 0.5, y + 1.5) - sampleGray(shading, x + 0.5, y - 0.5);
        ox = Math.max(-1, Math.min(1, gx / 24)) * disp;
        oy = Math.max(-1, Math.min(1, gy / 24)) * disp;
      }

      let cov = 0, r = 0, g = 0, b = 0, a = 0, su = 0, sv = 0;
      const add = (u: number, v: number, weight: number) => {
        cov += weight; su += u * weight; sv += v * weight;
        let sr = 0, sg = 0, sb = 0, sa = 0;
        if (design) {
          const dw = surfToDesign[6] * u + surfToDesign[7] * v + surfToDesign[8];
          const dx = (surfToDesign[0] * u + surfToDesign[1] * v + surfToDesign[2]) / dw;
          const dy = (surfToDesign[3] * u + surfToDesign[4] * v + surfToDesign[5]) / dw;
          if (sampleBilinear(design, dx, dy, sample)) {
            sr = sample[0]!; sg = sample[1]!; sb = sample[2]!; sa = sample[3]!;
          }
        }
        // Ontwerp (voorvermenigvuldigd) over de vulkleur.
        if (solid) {
          r += (sr + solid[0] * (1 - sa)) * weight;
          g += (sg + solid[1] * (1 - sa)) * weight;
          b += (sb + solid[2] * (1 - sa)) * weight;
          a += weight;
        } else {
          r += sr * weight; g += sg * weight; b += sb * weight; a += sa * weight;
        }
      };
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          if (locate(x + (sx + 0.5) / ss + ox, y + (sy + 0.5) / ss + oy, uv)) add(uv[0]!, uv[1]!, 1);
      if (mask && m > 0 && cov < n) {
        // Het masker loopt soms een pixel of twee verder dan het (gepaste) vlak. Zonder aanvulling blijft
        // daar paneelkleur staan; neem dan de dichtstbijzijnde rand van het ontwerp over.
        let found = false;
        for (let rad = 1; rad <= 3 && !found; rad++)
          for (let dy = -rad; dy <= rad && !found; dy++)
            for (let dx = -rad; dx <= rad && !found; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
              if (locate(x + 0.5 + dx + ox, y + 0.5 + dy + oy, uv)) found = true;
            }
        if (found) add(uv[0]!, uv[1]!, n - cov);
      }

      const di = pi * 4;
      if (mask && input.despill !== false && m > 0) {
        let sr0 = d[di]!, sg0 = d[di + 1]!, sb0 = d[di + 2]!;
        if (panel && m < 1) {
          // Randpixels zijn een mengsel van paneel en achtergrond: haal het paneel eruit (ontmengen),
          // zodat er geen donkere of groene zoom achterblijft langs het vlak. (lp is gezet door panelShare.)
          const mu = Math.min(m, 0.85), inv = 1 / (1 - mu);
          sr0 = clamp255((sr0 - mu * lp[0]!) * inv);
          sg0 = clamp255((sg0 - mu * lp[1]!) * inv);
          sb0 = clamp255((sb0 - mu * lp[2]!) * inv);
        }
        // Wat er dan nog aan groen over is, wegnemen.
        const lim = Math.max(sr0, sb0);
        if (sg0 > lim) sg0 = lim;
        d[di] = sr0; d[di + 1] = sg0; d[di + 2] = sb0;
      }
      if (!cov) continue;
      if (a <= 0 && !seamless) continue;
      let da = 1;
      if (seamless) { da = Math.min(1, a / cov); a = Math.max(a, 1e-9); }
      r /= a; g /= a; b /= a;

      const li = (y - y0) * bw0 + (x - x0);
      const ls = light ? light.s[li]! : NaN;
      if ((shading || !Number.isNaN(ls)) && k > 0) {
        const s = !Number.isNaN(ls) ? ls : shading!.data[pi]! / 128;
        const f = 1 - k + k * s;
        r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);
      }
      if (gloss > 0) {
        const ga = glossAt(su / cov, sv / cov, surface.width, surface.height) * gloss;
        if (ga > 0) { r += (255 - r) * ga; g += (255 - g) * ga; b += (255 - b) * ga; }
      }
      if (seamless) {
        // Naadloos: de print over de opgevulde ondergrond; die heeft het licht van de foto al.
        // Mengpixels net buiten het masker: de ontmengde scènepixel is daar zelf de ondergrond.
        const fi = ((y - y0) * (x1 - x0 + 1) + (x - x0)) * 3;
        const halo = mask!.data[pi] === 0;
        r = r * da + (halo ? d[di]! : seamless[fi]!) * (1 - da);
        g = g * da + (halo ? d[di + 1]! : seamless[fi + 1]!) * (1 - da);
        b = b * da + (halo ? d[di + 2]! : seamless[fi + 2]!) * (1 - da);
        a = cov;
      }
      if (light && refl > 0 && !Number.isNaN(ls)) {
        r = Math.min(255, r + light.r[li * 3]! * refl);
        g = Math.min(255, g + light.r[li * 3 + 1]! * refl);
        b = Math.min(255, b + light.r[li * 3 + 2]! * refl);
      }

      const alpha = (a / n) * m * opacity;
      if (alpha <= 0) continue;
      d[di] = r * alpha + d[di]! * (1 - alpha);
      d[di + 1] = g * alpha + d[di + 1]! * (1 - alpha);
      d[di + 2] = b * alpha + d[di + 2]! * (1 - alpha);
    }
  }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Mediane kleur van het volledig gemaskeerde paneel binnen het kader; basis voor het ontmengen van randen. */
export function panelColor(scene: RGBA, mask: { data: Uint8Array | Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number): [number, number, number] | null {
  const W = scene.width;
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const step = Math.max(1, Math.floor(Math.sqrt(area / 40000)));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const pi = y * W + x;
      if (mask.data[pi]! < 250) continue;
      rs.push(scene.data[pi * 4]!); gs.push(scene.data[pi * 4 + 1]!); bs.push(scene.data[pi * 4 + 2]!);
    }
  }
  if (rs.length < 16) return null;
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]!; };
  return [med(rs), med(gs), med(bs)];
}

function nearMask(mask: { data: Uint8Array | Uint8ClampedArray }, x: number, y: number, W: number, H: number, r = 2): boolean {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask.data[ny * W + nx]! > 0) return true;
    }
  return false;
}

/**
 * Vult het gemaskeerde vlak op vanuit de omgeving: per rij de kleur links en rechts van het vlak, per kolom
 * erboven en eronder, gewogen naar afstand. Zo loopt het verloop van een mok of shirt door onder de print.
 * Levert RGB voor het kader [x0..x1] x [y0..y1].
 */
export function surroundFill(scene: RGBA, mask: { data: Uint8Array | Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, shading?: Gray | null): Float32Array {
  const W = scene.width, H = scene.height, bw = x1 - x0 + 1, bh = y1 - y0 + 1, d = scene.data;
  const GAP = 3;
  // Met een schaduwkaart: per kleurkanaal een lineair verband tussen het licht net binnen de rand en de kleur
  // net erbuiten (kleur = a + b x licht), gefit over alle randmonsters. Binnen het vlak wordt de kleur dan
  // a + b x het licht van het paneel zelf, plus een vloeiend geïnterpoleerde rest. Zo komen plooien, kreukels
  // en de ronding van een mok mee, en trekt een plooi die toevallig over de rand loopt geen streep door het vlak.
  const light = (x: number, y: number) => {
    if (!shading || x < 0 || y < 0 || x >= W || y >= H) return 1;
    return shading.data[y * W + x]! / 128;
  };
  const px = (x: number, y: number, out: number[]) => {
    if (x < 0 || y < 0 || x >= W || y >= H || mask.data[y * W + x]! > 0) return false;
    const i = (y * W + x) * 4;
    out[0] = d[i]!; out[1] = d[i + 1]!; out[2] = d[i + 2]!;
    return true;
  };
  type Side = { pos: Int32Array; col: Float32Array; ok: Uint8Array; lit: Float32Array };
  const side = (len: number): Side => ({ pos: new Int32Array(len), col: new Float32Array(len * 3), ok: new Uint8Array(len), lit: new Float32Array(len) });
  const L = side(bh), R = side(bh), T = side(bw), B = side(bw);
  const tmp = [0, 0, 0];
  // Een monster moet echt buiten het vlak liggen: geen maskerpixel in de buurt en geen groene zweem.
  // Bij een schuine of gebogen rand ligt het eerste punt naast het vlak soms nog in de overgang; dan verder naar buiten.
  const clean = (x: number, y: number) => {
    if (!px(x, y, tmp) || tmp[1]! > Math.max(tmp[0]!, tmp[2]!) + 6) return false;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask.data[ny * W + nx]! > 0) return false;
      }
    return px(x, y, tmp);
  };
  const take = (s: Side, i: number, pos: number, x: number, y: number, dx: number, dy: number, inner: number) => {
    s.pos[i] = pos;
    for (let step = 0; step <= 12; step++, pos += dx + dy, x += dx, y += dy) {
      if (!clean(x, y)) continue;
      s.pos[i] = pos; s.ok[i] = 1; s.lit[i] = inner; s.col[i * 3] = tmp[0]!; s.col[i * 3 + 1] = tmp[1]!; s.col[i * 3 + 2] = tmp[2]!;
      return;
    }
  };
  for (let j = 0; j < bh; j++) {
    const y = y0 + j;
    let first = -1, last = -1;
    for (let x = x0; x <= x1; x++) if (mask.data[y * W + x]! > 0) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    take(L, j, first - GAP, first - GAP, y, -1, 0, light(first + GAP, y));
    take(R, j, last + GAP, last + GAP, y, 1, 0, light(last - GAP, y));
  }
  for (let i = 0; i < bw; i++) {
    const x = x0 + i;
    let first = -1, last = -1;
    for (let y = y0; y <= y1; y++) if (mask.data[y * W + x]! > 0) { if (first < 0) first = y; last = y; }
    if (first < 0) continue;
    take(T, i, first - GAP, x, first - GAP, 0, -1, light(x, first + GAP));
    take(B, i, last + GAP, x, last + GAP, 0, 1, light(x, last - GAP));
  }
  const fitA = [0, 0, 0], fitB = [0, 0, 0];
  if (shading) {
    let n = 0, sx = 0, sxx = 0;
    const sy = [0, 0, 0], sxy = [0, 0, 0];
    for (const sd of [L, R, T, B])
      for (let i = 0; i < sd.ok.length; i++) {
        if (!sd.ok[i]) continue;
        const l = sd.lit[i]!;
        n++; sx += l; sxx += l * l;
        for (let c = 0; c < 3; c++) { sy[c] = sy[c]! + sd.col[i * 3 + c]!; sxy[c] = sxy[c]! + l * sd.col[i * 3 + c]!; }
      }
    const den = n * sxx - sx * sx;
    for (let c = 0; c < 3; c++) {
      // Te weinig spreiding in het licht: geen betrouwbaar verband, dan alleen interpoleren.
      const b = n > 8 && den > 1e-6 * n * n ? Math.max(0, (n * sxy[c]! - sx * sy[c]!) / den) : 0;
      fitB[c] = b; fitA[c] = n ? (sy[c]! - b * sx) / n : 0;
    }
    for (const sd of [L, R, T, B])
      for (let i = 0; i < sd.ok.length; i++) {
        if (!sd.ok[i]) continue;
        for (let c = 0; c < 3; c++) sd.col[i * 3 + c] = sd.col[i * 3 + c]! - (fitA[c]! + fitB[c]! * sd.lit[i]!);
      }
  }
  // Ruis en textuur gladstrijken langs de rand, anders ontstaan strepen.
  const smooth = (s: Side, len: number, rad: number) => {
    const out = new Float32Array(len * 3);
    for (let i = 0; i < len; i++) {
      if (!s.ok[i]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (let k = Math.max(0, i - rad); k <= Math.min(len - 1, i + rad); k++) {
        if (!s.ok[k]) continue;
        n++; r += s.col[k * 3]!; g += s.col[k * 3 + 1]!; b += s.col[k * 3 + 2]!;
      }
      out[i * 3] = r / n; out[i * 3 + 1] = g / n; out[i * 3 + 2] = b / n;
    }
    s.col = out;
  };
  // Ontbrekende monsters (langs een flauw hellende rand vinden we geen schone pixel) aanvullen met de dichtstbijzijnde.
  const nearest = (s: Side, len: number, has: Uint8Array) => {
    for (let i = 0; i < len; i++) {
      if (s.ok[i] || !has[i]) continue;
      for (let reach = 1; reach < len; reach++) {
        const k = s.ok[i - reach] ? i - reach : s.ok[i + reach] ? i + reach : -1;
        if (k < 0) continue;
        s.col.copyWithin(i * 3, k * 3, k * 3 + 3);
        s.ok[i] = 2;
        break;
      }
    }
  };
  const rad = Math.max(2, Math.round(Math.min(bw, bh) / 60));
  const rowSpan = new Uint8Array(bh), colSpan = new Uint8Array(bw);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) if (mask.data[(y0 + j) * W + x0 + i]) { rowSpan[j] = 1; colSpan[i] = 1; }
  smooth(L, bh, rad); smooth(R, bh, rad); smooth(T, bw, rad); smooth(B, bw, rad);
  nearest(T, bw, colSpan); nearest(B, bw, colSpan);

  const out = new Float32Array(bw * bh * 3);
  let fr = 0, fg = 0, fb = 0, fn = 0;
  for (const s of [L, R, T, B]) for (let i = 0; i < s.ok.length; i++) if (s.ok[i]) { fr += s.col[i * 3]!; fg += s.col[i * 3 + 1]!; fb += s.col[i * 3 + 2]!; fn++; }
  const avg = [fn ? fr / fn : 0, fn ? fg / fn : 0, fn ? fb / fn : 0];
  // Verticale interpolatie in kolom i op hoogte y (tussen de kleur erboven en eronder).
  const vert = (i: number, y: number, c: number): number | null => {
    if (i < 0 || i >= bw) return null;
    const t = T.ok[i], b = B.ok[i];
    if (t && b) {
      const v = Math.min(1, Math.max(0, (y - T.pos[i]!) / Math.max(1, B.pos[i]! - T.pos[i]!)));
      return T.col[i * 3 + c]! * (1 - v) + B.col[i * 3 + c]! * v;
    }
    return t ? T.col[i * 3 + c]! : b ? B.col[i * 3 + c]! : null;
  };
  // Rijen zonder eigen monster links of rechts: neem de kolominterpolatie op die rand, zodat de
  // rij- en kolomschatting daar overeenkomen en er geen sprong ontstaat.
  for (let j = 0; j < bh; j++) {
    if (!rowSpan[j]) continue;
    for (const [s, edgeX] of [[L, L.pos[j]! + GAP], [R, R.pos[j]! - GAP]] as const) {
      if (s.ok[j]) continue;
      let filled = true;
      for (let c = 0; c < 3; c++) { const v = vert(edgeX - x0, y0 + j, c); if (v === null) { filled = false; break; } s.col[j * 3 + c] = v; }
      if (filled) s.ok[j] = 2;
    }
  }
  // Transfiniete (Gordon-Coons) interpolatie: rij + kolom - de kolominterpolatie langs de rijranden.
  // Reproduceert zowel horizontale als verticale verlopen exact, zonder kruispatroon.
  for (let j = 0; j < bh; j++) {
    const y = y0 + j;
    const hasL = L.ok[j], hasR = R.ok[j];
    const xl = L.pos[j]! + GAP, xr = R.pos[j]! - GAP;
    for (let i = 0; i < bw; i++) {
      const x = x0 + i;
      if (!mask.data[y * W + x]) continue;
      const o = (j * bw + i) * 3;
      const u = hasL && hasR ? Math.min(1, Math.max(0, (x - L.pos[j]!) / Math.max(1, R.pos[j]! - L.pos[j]!))) : 0.5;
      for (let c = 0; c < 3; c++) {
        const V = vert(i, y, c);
        const Hc = hasL && hasR ? L.col[j * 3 + c]! * (1 - u) + R.col[j * 3 + c]! * u : hasL ? L.col[j * 3 + c]! : hasR ? R.col[j * 3 + c]! : null;
        let val: number;
        if (V !== null && Hc !== null) {
          const vl = vert(xl - x0, y, c), vr = vert(xr - x0, y, c);
          const corr = vl !== null && vr !== null ? vl * (1 - u) + vr * u : null;
          val = corr !== null ? V + Hc - corr : (V + Hc) / 2;
        } else val = V ?? Hc ?? avg[c]!;
        const lit = val + fitA[c]! + fitB[c]! * light(x, y);
        out[o + c] = lit < 0 ? 0 : lit > 255 ? 255 : lit;
      }
    }
  }
  return out;
}

function onMaskEdge(mask: { data: Uint8Array | Uint8ClampedArray }, x: number, y: number, W: number, H: number): boolean {
  if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return true;
  const p = y * W + x;
  return mask.data[p - 1]! < 250 || mask.data[p + 1]! < 250 || mask.data[p - W]! < 250 || mask.data[p + W]! < 250;
}

/** Fijne lichtstructuur binnen het paneel: schaduwkaart / vervaagde schaduwkaart (genormaliseerde convolutie). */
function lightDetail(shading: Gray, mask: { data: Uint8Array | Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number): Float32Array {
  const W = shading.width, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const sv = new Float64Array((bw + 1) * (bh + 1)), wv = new Float64Array((bw + 1) * (bh + 1));
  for (let j = 0; j < bh; j++) {
    let rs = 0, rw = 0;
    for (let i = 0; i < bw; i++) {
      const p = (y0 + j) * W + x0 + i;
      if (mask.data[p]! >= 250) { rs += shading.data[p]!; rw += 1; }
      const o = (j + 1) * (bw + 1) + i + 1;
      sv[o] = sv[o - bw - 1]! + rs; wv[o] = wv[o - bw - 1]! + rw;
    }
  }
  const r = Math.max(8, Math.round(Math.min(bw, bh) / 10));
  const out = new Float32Array(bw * bh).fill(1);
  for (let j = 0; j < bh; j++) {
    const ja = Math.max(0, j - r), jb = Math.min(bh, j + r + 1);
    for (let i = 0; i < bw; i++) {
      const p = (y0 + j) * W + x0 + i;
      if (!mask.data[p]) continue;
      const ia = Math.max(0, i - r), ib = Math.min(bw, i + r + 1);
      const at = (a: Float64Array) => a[jb * (bw + 1) + ib]! - a[ja * (bw + 1) + ib]! - a[jb * (bw + 1) + ia]! + a[ja * (bw + 1) + ia]!;
      const wsum = at(wv);
      if (wsum < 1) continue;
      const lp = at(sv) / wsum;
      out[j * bw + i] = Math.max(0.4, Math.min(2, shading.data[p]! / Math.max(1, lp)));
    }
  }
  return out;
}

/** Is er een (vrijwel) lege maskerpixel binnen twee pixels: dan is dit een rand- of overgangspixel. */
function nearLow(mask: { data: Uint8Array | Uint8ClampedArray }, x: number, y: number, W: number, H: number): boolean {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || mask.data[ny * W + nx]! < 128) return true;
    }
  return false;
}

/**
 * Splitst een pixel van het groene paneel in licht en reflectie: kleur = s x paneelkleur + R.
 * s (schaal) is de lichtval en schaduw; R (opgeteld, vrijwel neutraal) is glimlicht of een gespiegelde
 * lichtbron. Opgelost met kleinste kwadraten over de drie kanalen met een neutrale reflectie; wat dan nog
 * overblijft gaat mee in R (een warme of koele tint van de reflectie), behalve groen: dat is altijd van het paneel.
 */
export function decomposePanel(c0: number, c1: number, c2: number, P: [number, number, number], out: Float64Array): void {
  const pm = (P[0] + P[1] + P[2]) / 3, cm = (c0 + c1 + c2) / 3;
  const p0 = P[0] - pm, p1 = P[1] - pm, p2 = P[2] - pm;
  const den = p0 * p0 + p1 * p1 + p2 * p2;
  let s = den > 1e-6 ? ((c0 - cm) * p0 + (c1 - cm) * p1 + (c2 - cm) * p2) / den : 0;
  let h = cm - s * pm;
  if (h < 0) {
    h = 0;
    const pp = P[0] * P[0] + P[1] * P[1] + P[2] * P[2];
    s = pp > 0 ? (c0 * P[0] + c1 * P[1] + c2 * P[2]) / pp : 0;
  }
  if (s < 0) s = 0;
  if (s > 2) s = 2;
  // Ruisdrempel: kleine afwijkingen (compressie, korrel) zijn geen reflectie.
  let r0 = Math.max(0, c0 - s * P[0] - 4), r1 = Math.max(0, c1 - s * P[1] - 4), r2 = Math.max(0, c2 - s * P[2] - 4);
  r1 = Math.min(r1, Math.max(r0, r2));
  out[0] = s; out[1] = r0; out[2] = r1; out[3] = r2;
  void h;
}

/**
 * Licht (s) en reflectie (R, drie kanalen) per pixel in het kader. Binnenin uit de eigen kleur; aan de rand
 * (waar de kleur gemengd is met de omgeving) van de dichtstbijzijnde binnenpixel. NaN = onbekend.
 */
function panelLight(orig: Uint8ClampedArray, mask: { data: Uint8Array | Uint8ClampedArray }, panel: [number, number, number], x0: number, y0: number, x1: number, y1: number, W: number, H: number) {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const s = new Float32Array(bw * bh).fill(NaN);
  const r = new Float32Array(bw * bh * 3);
  const tmp = new Float64Array(4);
  const interior = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const li = (y - y0) * bw + (x - x0);
      if (mask.data[y * W + x]! < 128 || nearLow(mask, x, y, W, H)) continue;
      interior[li] = 1;
      decomposePanel(orig[li * 3]!, orig[li * 3 + 1]!, orig[li * 3 + 2]!, panel, tmp);
      s[li] = tmp[0]!; r[li * 3] = tmp[1]!; r[li * 3 + 1] = tmp[2]!; r[li * 3 + 2] = tmp[3]!;
    }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const li = (y - y0) * bw + (x - x0);
      if (interior[li] || !nearMaskPx(mask, x, y, W, H)) continue;
      let best = -1, bd = Infinity;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
          const nli = (ny - y0) * bw + (nx - x0);
          if (!interior[nli]) continue;
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = nli; }
        }
      if (best < 0) continue;
      s[li] = s[best]!; r[li * 3] = r[best * 3]!; r[li * 3 + 1] = r[best * 3 + 1]!; r[li * 3 + 2] = r[best * 3 + 2]!;
    }
  void bh;
  return { s, r };
}

function nearMaskPx(mask: { data: Uint8Array | Uint8ClampedArray }, x: number, y: number, W: number, H: number): boolean {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask.data[ny * W + nx]! > 0) return true;
    }
  return false;
}

export interface SpillTarget {
  mask: { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
  /** Paneelkleur in de oorspronkelijke scène (vóór het plaatsen). */
  panel: [number, number, number];
  quad: [number, number][] | readonly (readonly [number, number])[];
  /** Gemiddelde kleur van wat er nu op het vlak staat; strooilicht krijgt die tint in plaats van groen. */
  tint: [number, number, number];
  /**
   * Hoe ver rond het vlak strooilicht kan zitten (pixels). Standaard ruim (een AI-beeld kan groen licht op het object
   * en de ondergrond hebben); bij een 3D-device alleen de overgangsrand, want daar is het groen alleen het scherm.
   */
  radius?: number | null;
}

/**
 * Groen strooilicht buiten de vlakken: een spiegeling in een glanzend bureau, licht van het scherm op het
 * kader, een groene rand om een voorwerp. Het groene deel wordt eruit gehaald (de helderheid blijft) en
 * vervangen door de tint van het ontwerp, zoals een scherm met dat beeld zijn omgeving zou kleuren.
 * Alleen tinten dicht bij het paneelgroen en binnen een straal rond het vlak; pixels van een vlak zelf blijven.
 */
export function suppressSpill(scene: RGBA, targets: SpillTarget[]): void {
  if (!targets.length) return;
  const W = scene.width, H = scene.height, d = scene.data;
  const any = new Uint8Array(W * H);
  // Pixels die echt bij een vlak horen blijven; overgangspixels (lage maskerwaarde) krijgen dezelfde correctie.
  for (const t of targets) for (let p = 0; p < any.length; p++) if (t.mask.data[p]! >= 128) any[p] = 1;
  const hueOf = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), dl = max - min;
    if (dl < 1e-6) return -1;
    if (max === g) return 60 * ((b - r) / dl) + 120;
    if (max === r) return (60 * ((g - b) / dl) + 360) % 360;
    return 60 * ((r - g) / dl) + 240;
  };
  for (const t of targets) {
    const P = t.panel;
    const excessP = P[1] - Math.max(P[0], P[2]);
    if (excessP < 20) continue;
    const hueP = hueOf(P[0], P[1], P[2]);
    const xs = t.quad.map((p) => p[0]), ys = t.quad.map((p) => p[1]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const radius = t.radius ?? Math.max(12, diag * 0.6);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - radius)), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - radius)), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys) + radius));
    // Afstand tot dit vlak (chamfer, binnen het kader).
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const dist = new Float32Array(bw * bh).fill(1e9);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (t.mask.data[y * W + x]! >= 128) dist[(y - y0) * bw + (x - x0)] = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x; let v = dist[i]!;
      if (x > 0) v = Math.min(v, dist[i - 1]! + 1);
      if (y > 0) { v = Math.min(v, dist[i - bw]! + 1); if (x > 0) v = Math.min(v, dist[i - bw - 1]! + 1.4142); if (x < bw - 1) v = Math.min(v, dist[i - bw + 1]! + 1.4142); }
      dist[i] = v;
    }
    for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x; let v = dist[i]!;
      if (x < bw - 1) v = Math.min(v, dist[i + 1]! + 1);
      if (y < bh - 1) { v = Math.min(v, dist[i + bw]! + 1); if (x < bw - 1) v = Math.min(v, dist[i + bw + 1]! + 1.4142); if (x > 0) v = Math.min(v, dist[i + bw - 1]! + 1.4142); }
      dist[i] = v;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = y * W + x;
        if (any[p]) continue;
        const dd = dist[(y - y0) * bw + (x - x0)]!;
        if (dd > radius) continue;
        const i = p * 4;
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
        const e = g - Math.max(r, b);
        if (e <= 2) continue;
        const hue = hueOf(r, g, b);
        const dh = Math.abs(hue - hueP);
        if (hue < 0 || dh > 40) continue;
        // Volle correctie dicht bij het vlak en voor tinten die echt op het paneel lijken; zachter verder weg.
        const wHue = dh < 25 ? 1 : (40 - dh) / 15;
        const wDist = dd < radius * 0.7 ? 1 : (radius - dd) / (radius * 0.3);
        const wgt = wHue * wDist;
        // Pixel = ondergrond + a x paneelkleur. Vervang het gespiegelde paneel door het gespiegelde ontwerp.
        const a = Math.min(1, e / excessP) * wgt;
        let nr = r - a * P[0] + a * t.tint[0], ng = g - a * P[1] + a * t.tint[1], nb = b - a * P[2] + a * t.tint[2];
        // Wat er na de vervanging nog aan groen over is (afwijkende tint), wegnemen.
        const lim = Math.max(nr, nb);
        if (ng > lim && wgt >= 1) ng = lim + (ng - lim) * 0.15;
        d[i] = Math.max(0, Math.min(255, nr));
        d[i + 1] = Math.max(0, Math.min(255, ng));
        d[i + 2] = Math.max(0, Math.min(255, nb));
      }
  }
}
