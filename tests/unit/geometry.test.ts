import { describe, expect, it } from 'vitest';
import { applyH, cssMatrix3d, designToSurfaceMatrix, homography, invert3, isConvexQuad, orderQuad, rectQuad, type Quad } from '../../shared/geometry';

const quad: Quad = [[120, 80], [610, 140], [580, 470], [90, 400]];

describe('homografie', () => {
  it('beeldt de hoeken van een rechthoek exact af op de vierhoek', () => {
    const H = homography(rectQuad(1000, 600), quad);
    rectQuad(1000, 600).forEach((p, i) => {
      const [x, y] = applyH(H, p[0], p[1]);
      expect(x).toBeCloseTo(quad[i]![0], 6);
      expect(y).toBeCloseTo(quad[i]![1], 6);
    });
  });

  it('heeft een inverse die terugrekent naar het origineel', () => {
    const H = homography(rectQuad(1000, 600), quad);
    const inv = invert3(H);
    const [x, y] = applyH(H, 333, 222);
    const [u, v] = applyH(inv, x, y);
    expect(u).toBeCloseTo(333, 6);
    expect(v).toBeCloseTo(222, 6);
  });

  it('weigert een ontaarde vierhoek', () => {
    expect(() => homography(rectQuad(10, 10), [[0, 0], [5, 0], [10, 0], [15, 0]])).toThrow();
  });

  it('zet losse punten in vaste hoekvolgorde', () => {
    const shuffled = [quad[2], quad[0], quad[3], quad[1]] as Quad;
    expect(orderQuad(shuffled)).toEqual(quad);
    expect(isConvexQuad(quad)).toBe(true);
    expect(isConvexQuad([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(false);
  });

  it('levert een CSS matrix3d die dezelfde afbeelding beschrijft', () => {
    const css = cssMatrix3d(1000, 600, quad);
    const m = css.slice(9, -1).split(',').map(Number);
    // Kolomvolgorde: punt (1000, 600) moet op quad[2] vallen.
    const x = 1000, y = 600;
    const X = m[0]! * x + m[4]! * y + m[12]!;
    const Y = m[1]! * x + m[5]! * y + m[13]!;
    const W = m[3]! * x + m[7]! * y + m[15]!;
    expect(X / W).toBeCloseTo(quad[2]![0], 4);
    expect(Y / W).toBeCloseTo(quad[2]![1], 4);
  });
});

describe('ontwerpplaatsing binnen het oppervlak', () => {
  it('vult bij cover het hele oppervlak zonder uit te rekken', () => {
    const A = designToSurfaceMatrix({ width: 400, height: 200 }, { width: 300, height: 300 }, { fit: 'cover', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 });
    expect(A[0]).toBeCloseTo(1.5);
    expect(A[4]).toBeCloseTo(1.5);
    const [x0] = applyH(A, 0, 0);
    expect(x0).toBeCloseTo(-150);
  });

  it('lijnt een websitescreenshot bij fit "width" bovenaan uit', () => {
    const A = designToSurfaceMatrix({ width: 1440, height: 4000 }, { width: 720, height: 450 }, { fit: 'width', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 });
    const [, y0] = applyH(A, 0, 0);
    expect(y0).toBeCloseTo(0);
    expect(A[0]).toBeCloseTo(0.5);
  });
});

import { orientQuad, rotateQuad } from '../../shared/geometry';
describe('stand van het vlak', () => {
  it('zet een liggend telefoonscherm rechtop met de verre korte zijde als bovenkant', () => {
    // Telefoon schuin op tafel: lange zijden lopen de diepte in.
    const phone: Quad = [[300, 100], [380, 140], [260, 420], [180, 380]];
    const o = orientQuad(rotateQuad(phone, 1));
    expect(o[0]).toEqual([300, 100]);
  });
  it('houdt een laptopscherm liggend', () => {
    const screen: Quad = [[100, 100], [500, 120], [490, 360], [110, 340]];
    expect(orientQuad(rotateQuad(screen, 2), 'landscape')[0]).toEqual([100, 100]);
  });
});

import { quadAspect } from '../../shared/geometry';
describe('werkelijke verhouding in perspectief', () => {
  it('herstelt de verhouding van een rechthoek die met een camera is gefotografeerd', () => {
    // Projecteer een rechthoek van 3:2 met een pinhole-camera (brandpunt 1200, hoofdpunt in het midden).
    const W = 1600, H = 1200, f = 1200;
    const rot = (p: [number, number, number]): [number, number, number] => {
      const a = 0.6, b = -0.45; // draaiing om y en x
      let [x, y, z] = p;
      [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
      [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
      return [x, y, z + 9];
    };
    const project = (p: [number, number, number]): [number, number] => { const [x, y, z] = rot(p); return [W / 2 + (f * x) / z, H / 2 + (f * y) / z]; };
    const q: Quad = [project([-1.5, -1, 0]), project([1.5, -1, 0]), project([1.5, 1, 0]), project([-1.5, 1, 0])];
    expect(quadAspect(q, W, H)).toBeCloseTo(1.5, 2);
    // De eenvoudige schatting zit er duidelijk naast; daarom is de beeldmaat nodig.
    expect(Math.abs(quadAspect(q) - 1.5)).toBeGreaterThan(0.05);
  });
});

import { creditsFor, estimateCost } from '../../shared/pricing';
describe('kosten en credits', () => {
  it('gebruikt de gepubliceerde prijs per formaat in plaats van lineair te schalen', () => {
    expect(estimateCost('gpt-image-2', 'medium', 1536, 1024, 1)).toEqual({ usd: 0.041, exact: true });
    expect(estimateCost('gpt-image-2', 'high', 1024, 1024, 2)).toEqual({ usd: 0.422, exact: true });
  });
  it('schat formaten buiten de tabel vanaf de meest vergelijkbare verhouding', () => {
    const e = estimateCost('gpt-image-2', 'medium', 2560, 1712, 1)!;
    expect(e.exact).toBe(false);
    expect(e.usd).toBeCloseTo(0.041 * (2560 * 1712) / (1536 * 1024), 3);
  });
  it('rekent credits alleen op kwaliteit en grootte', () => {
    expect(creditsFor('medium', 1536, 1024, 3)).toBe(15);
    expect(creditsFor('high', 3840, 2160, 1)).toBe(80);
    expect(estimateCost('onbekend', 'low', 1024, 1024, 1)).toBeNull();
  });
});

import { smartFit } from '../../shared/catalog';
describe('slimme passing', () => {
  it('vult een poster met een staand ontwerp, maar plaatst een breed logo passend', () => {
    expect(smartFit('cover', { width: 800, height: 1100 }, { width: 600, height: 840 })).toBe('cover');
    expect(smartFit('cover', { width: 1200, height: 300 }, { width: 600, height: 840 })).toBe('contain');
  });
  it('past een lange websitescreenshot op breedte en een brede op vullen', () => {
    expect(smartFit('width', { width: 1440, height: 5000 }, { width: 1600, height: 1000 })).toBe('width');
    expect(smartFit('width', { width: 1440, height: 900 }, { width: 1600, height: 1000 })).toBe('cover');
  });
});
