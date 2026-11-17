// E-mailhandtekening: mailweergave (geometrie, ware grootte, onvervormd), de volledige keten met de
// bibliotheekscènes, opslaan en opschonen, en het omzetten van oude social-gegevens bij het opstarten.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../shared/catalog';
import { applyH, homography, rectQuad, surfaceDimensions } from '../../shared/geometry';
import { DEFAULT_MAIL, drawMail, naturalSignatureWidth, resolveSignatureWidth, screenCanvasSize, type ScreenLayout } from '../../shared/mail';
import type { Mockup, Placement, Scene } from '../../shared/types';
import { dataPath, setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { newId, now } from '../../server/lib/ids';
import { renderScreen, screenSlots, type ScreenSource } from '../../server/lib/imaging/screen';
import { loadRGBA } from '../../server/lib/imaging/io';
import { retireSocial } from '../../server/lib/migrations/retire-social';
import { assetIdsOf, createMockup, placementsFor, renderImage, validatePlacements } from '../../server/lib/mockups';
import { workspaces } from '../../server/lib/repo-accounts';
import { assets, generations, mockups, projects, scenes } from '../../server/lib/repositories';
import { seedSystemLibrary } from '../../server/lib/seed';
import { deleteAsset, ingestUpload } from '../../server/lib/uploads';
import { screenLayoutSchema } from '../../server/lib/validation';

let dir = '', WS = '', P = '';
const RED: [number, number, number] = [214, 36, 48];

/** Handtekening met vier kwadranten: stand, schaal en bijsnijden zijn zo in de render te meten. */
async function quadrants(w: number, h: number, base: [number, number, number] = RED) {
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const block = (c: [number, number, number], bw: number, bh: number) => sharp({ create: { width: bw, height: bh, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: base[0], g: base[1], b: base[2] } } }).composite([
    { input: await block([255, 255, 255], w - hw, hh), left: hw, top: 0 },
    { input: await block([0, 0, 0], hw, h - hh), left: 0, top: hh },
    { input: await block([128, 128, 128], w - hw, h - hh), left: hw, top: hh },
  ]).png().toBuffer();
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-email-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  WS = workspaces.create('Bureau').id;
  await seedSystemLibrary();
  P = projects.create({ workspaceId: WS, name: 'Huisstijl' }).id;
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

const L = (template: ScreenLayout['template'], extra: Partial<ScreenLayout> = {}): ScreenLayout => ({ template, slots: [{ assetId: 'sig' }], ...extra });
const dims = { sig: { width: 840, height: 264 } } as Record<string, { width: number; height: number }>;

describe('mailweergave', () => {
  it('leidt de ware grootte van een handtekening af van het bestand', () => {
    expect(naturalSignatureWidth(840)).toBe(420); // 2× geëxporteerd
    expect(naturalSignatureWidth(600)).toBe(600);
    expect(naturalSignatureWidth(1500)).toBe(375);
    expect(naturalSignatureWidth(2400)).toBe(600);
    expect(resolveSignatureWidth(L('mail-desktop'), (id) => dims[id] ?? null).signatureWidth).toBe(420);
    expect(resolveSignatureWidth(L('mail-desktop', { signatureWidth: 300 }), (id) => dims[id] ?? null).signatureWidth).toBe(300);
  });

  it('zet de handtekening op ware grootte en in de juiste verhouding onder de tekst', () => {
    // Laptop: 1920 px breed voor 1280 CSS-pixels, dus 420 px handtekening = 630 px.
    const desk = drawMail(null, resolveSignatureWidth(L('mail-desktop'), (id) => dims[id] ?? null), 1920, 1200, (id) => dims[id] ?? null).find((s) => s.kind === 'signature')!;
    expect(desk.w).toBeCloseTo(630, 5);
    expect(desk.h).toBeCloseTo((630 * 264) / 840, 5);
    // Telefoon: niet breder dan de tekstkolom (390 − 2 × 20 CSS-pixels), verhouding blijft gelijk.
    const mob = drawMail(null, resolveSignatureWidth(L('mail-mobile'), (id) => dims[id] ?? null), 1080, 2337, (id) => dims[id] ?? null).find((s) => s.kind === 'signature')!;
    expect(mob.w).toBeCloseTo((1080 / 390) * 350, 5);
    expect(mob.w / mob.h).toBeCloseTo(840 / 264, 5);
    expect(mob.x).toBeCloseTo((1080 / 390) * 20, 5);
    // Een eigen breedte wordt gevolgd.
    const custom = drawMail(null, L('mail-desktop', { signatureWidth: 300 }), 1920, 1200, (id) => dims[id] ?? null).find((s) => s.kind === 'signature')!;
    expect(custom.w).toBeCloseTo(450, 5);
    // Langere tekst schuift de handtekening omlaag.
    const long = drawMail(null, L('mail-desktop', { signatureWidth: 300, mail: { body: `${DEFAULT_MAIL.body}\n\nNog een alinea.\n\nEn nog een.` } }), 1920, 1200, (id) => dims[id] ?? null).find((s) => s.kind === 'signature')!;
    expect(long.y).toBeGreaterThan(custom.y + 50);
  });

  it('plaatst de handtekening onvervormd, niet gedraaid en niet bijgesneden', async () => {
    const file = path.join(dir, 'sig.png');
    await sharp(await quadrants(800, 240)).toFile(file);
    const src: Record<string, ScreenSource> = { sig: { path: file, mime: 'image/png', width: 800, height: 240, cacheKey: 'sig' } };
    for (const [tpl, W, H] of [['mail-desktop', 1920, 1200], ['mail-mobile', 1080, 2337]] as const) {
      for (const theme of ['light', 'dark'] as const) {
        const layout = L(tpl, { theme });
        const img = await renderScreen(layout, src, W, H);
        const slot = screenSlots(layout, (id) => src[id] ?? null, W, H).find((s) => s.kind === 'signature')!;
        const px = (fx: number, fy: number) => { const i = (Math.round(slot.y + slot.h * fy) * img.width + Math.round(slot.x + slot.w * fx)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
        expect(px(0.2, 0.25), `${tpl} ${theme}`).toEqual(RED);
        expect(px(0.8, 0.25), `${tpl} ${theme}`).toEqual([255, 255, 255]);
        expect(px(0.2, 0.75), `${tpl} ${theme}`).toEqual([0, 0, 0]);
        expect(px(0.8, 0.75), `${tpl} ${theme}`).toEqual([128, 128, 128]);
        // De hoeken liggen binnen het vak: niets afgesneden.
        expect(px(0.02, 0.04)).toEqual(RED);
        expect(px(0.98, 0.96)).toEqual([128, 128, 128]);
      }
    }
  });

  it('rendert een SVG-handtekening scherp op de benodigde maat', async () => {
    const file = path.join(dir, 'sig.svg');
    await import('node:fs/promises').then((fs) => fs.writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="10"><rect width="20" height="10" fill="#1e46dc"/><rect x="20" width="20" height="10" fill="#ffffff"/></svg>'));
    const layout = L('mail-desktop', { signatureWidth: 400 });
    const src = { sig: { path: file, mime: 'image/svg+xml', width: 40, height: 10, cacheKey: 'svg' } };
    const img = await renderScreen(layout, src, 1920, 1200);
    const slot = screenSlots(layout, (id) => (src as Record<string, { width: number; height: number }>)[id] ?? null, 1920, 1200).find((s) => s.kind === 'signature')!;
    const y = Math.round(slot.y + slot.h / 2);
    let blended = 0;
    for (let x = Math.round(slot.x); x < slot.x + slot.w; x++) { const r = img.data[(y * img.width + x) * 4]!; if (r > 40 && r < 245) blended++; }
    expect(blended).toBeLessThanOrEqual(2);
  });

  it('accepteert alleen mailweergaven bij het opslaan', () => {
    expect(screenLayoutSchema.safeParse({ template: 'mail-mobile', slots: [{ assetId: 'x' }], mail: { subject: 'Hoi' }, signatureWidth: 420 }).success).toBe(true);
    expect(screenLayoutSchema.safeParse({ template: 'grid', slots: [{ assetId: 'x' }] }).success).toBe(false);
    expect(screenLayoutSchema.safeParse({ template: 'mail-mobile', slots: [{ assetId: 'x' }, { assetId: 'y' }] }).success).toBe(false);
    expect(screenLayoutSchema.safeParse({ template: 'mail-mobile', slots: [{ assetId: 'x' }], signatureWidth: 5000 }).success).toBe(false);
  });
});

/** Kleur in de render op een punt van het scherm (u, v als fractie van het mailcanvas). */
function colorAt(img: { width: number; data: Uint8Array | Uint8ClampedArray }, scene: Scene, p: Placement, u: number, v: number) {
  const surface = scene.surfaces.find((s) => s.id === p.surfaceId)!;
  const [x, y] = applyH(homography(rectQuad(1, 1), surface.quad), u, v);
  const k = img.width / scene.width;
  const i = (Math.round(y * k) * img.width + Math.round(x * k)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

describe('volledige keten met de e-mailbibliotheek', () => {
  const mailScenes = () => scenes.list({ library: true }).filter((s) => s.category === 'email');

  it('heeft voor elk e-mailobject een testscène en geen social-scènes meer', () => {
    const objects = CATEGORIES.find((c) => c.id === 'email')!.objects;
    const expected: Record<string, number> = { 'email-laptop': 1, 'email-phone': 1, 'email-phone-hand': 1, 'email-devices': 2 };
    for (const o of objects) {
      const s = mailScenes().find((x) => x.objectType === o.id);
      expect(s, o.id).toBeTruthy();
      expect(s!.surfaces, o.id).toHaveLength(expected[o.id]!);
    }
    expect(CATEGORIES.some((c) => c.id === 'social')).toBe(false);
    expect(scenes.list({ library: true }).some((s) => s.objectType.startsWith('social-'))).toBe(false);
  });

  it('zet op elke e-mailscène de handtekening op ware grootte in de juiste weergave', async () => {
    const [sig] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'handtekening.png', buffer: await quadrants(800, 240) });
    for (const scene of mailScenes()) {
      const m = createMockup({ projectId: P, sceneId: scene.id, assetId: sig!.id });
      validatePlacements(scene, P, m.placements);
      const img = await loadRGBA(Buffer.from((await renderImage(m, scene, { width: scene.width, output: { format: 'png' } })).buffer));
      for (const p of m.placements) {
        const surface = scene.surfaces.find((s) => s.id === p.surfaceId)!;
        const d = surfaceDimensions(surface.quad, scene);
        expect(p.layout?.template, scene.objectType).toBe(d.width > d.height ? 'mail-desktop' : 'mail-mobile');
        expect(p.transform.fit).toBe('fill');
        expect(p.assetId).toBe(sig!.id);
        // Het rode kwadrant van de handtekening staat op de plek die de mailweergave berekent.
        const canvas = screenCanvasSize(d, p.layout!.template === 'mail-desktop', d.width * 2.2);
        const slot = screenSlots(p.layout!, (id) => assets.get(id) ?? null, canvas.width, canvas.height).find((s) => s.kind === 'signature')!;
        if (slot.y + slot.h > canvas.height) continue; // onder de schermrand
        const c = colorAt(img, scene, p, (slot.x + slot.w * 0.25) / canvas.width, (slot.y + slot.h * 0.25) / canvas.height);
        expect(c[0]! - Math.max(c[1]!, c[2]!), `${scene.objectType}: ${c}`).toBeGreaterThan(70);
      }
    }
  });

  it('neemt het bericht mee naar een andere scène en laat het bij drukwerk weg', () => {
    const laptop = mailScenes().find((s) => s.objectType === 'email-laptop')!;
    const phone = mailScenes().find((s) => s.objectType === 'email-phone')!;
    const sig = assets.list({ projectId: P }).find((a) => a.originalName === 'handtekening.png')!;
    const m = createMockup({ projectId: P, sceneId: laptop.id, assetId: sig.id });
    const edited: Mockup = { ...m, placements: m.placements.map((p) => ({ ...p, layout: { ...p.layout!, mail: { subject: 'Kennismaking' }, theme: 'dark' as const, signatureWidth: 360 } })) };
    const onPhone = placementsFor(phone, null, edited);
    expect(onPhone[0]!.layout).toMatchObject({ template: 'mail-mobile', theme: 'dark', signatureWidth: 360, mail: { subject: 'Kennismaking' } });
    const card = scenes.list({ library: true }).find((s) => s.objectType === 'business-card')!;
    expect(placementsFor(card, null, edited).every((p) => !p.layout && p.assetId === sig.id)).toBe(true);
  });

  it('weigert een handtekening of profielfoto uit een ander project en ruimt verwijderde ontwerpen op', async () => {
    const laptop = mailScenes().find((s) => s.objectType === 'email-laptop')!;
    const other = projects.create({ workspaceId: WS, name: 'Ander' }).id;
    const buf = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#555' } }).png().toBuffer();
    const [foreign] = await ingestUpload({ projectId: other, workspaceId: WS, kind: 'design', filename: 'x.png', buffer: buf });
    const [own] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'eigen.png', buffer: buf });
    const [photo] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'portret.png', buffer: buf });
    const m = createMockup({ projectId: P, sceneId: laptop.id, assetId: own!.id });
    expect(() => validatePlacements(laptop, P, m.placements.map((p) => ({ ...p, layout: { ...p.layout!, avatar: { assetId: foreign!.id } } })))).toThrow(/buiten dit project/);
    const withPhoto = mockups.update(m.id, { placements: m.placements.map((p) => ({ ...p, layout: { ...p.layout!, avatar: { assetId: photo!.id } } })) })!;
    expect(assetIdsOf(withPhoto.placements[0]!).sort()).toEqual([own!.id, photo!.id].sort());
    expect(mockups.usingAsset(photo!.id).map((x) => x.id)).toContain(m.id);
    await deleteAsset(assets.get(photo!.id)!);
    await deleteAsset(assets.get(own!.id)!);
    const after = mockups.get(m.id)!;
    expect(after.placements[0]!.layout!.avatar).toBeNull();
    expect(after.placements[0]!.layout!.slots[0]!.assetId).toBeNull();
    expect(() => validatePlacements(laptop, P, after.placements)).not.toThrow();
  });
});

describe('oude social-gegevens bij het opstarten', () => {
  it('maakt een back-up, zet mockups om, ruimt ongebruikte testscènes op en laat eigen scènes werken', async () => {
    const template = mailScenes()[0]!;
    // Gegevens zoals een vorige versie ze achterliet.
    const demoId = newId();
    // Eigen bestandsmap (bestaat niet): opruimen mag de bestanden van andere scènes niet raken.
    const demoUnused: Scene = { ...template, id: demoId, file: `system/scenes/${demoId}/scene.png`, thumb: `system/scenes/${demoId}/thumb.webp`, workspaceId: null, origin: 'demo', inLibrary: true, objectType: 'social-prints', category: 'social', createdAt: now() };
    const own: Scene = { ...template, id: newId(), workspaceId: WS, origin: 'generated', inLibrary: true, objectType: 'social-laptop', category: 'social', config: { category: 'social', objectType: 'social-laptop', socialFormat: 'profile' } as never, createdAt: now() };
    scenes.insert(demoUnused);
    scenes.insert(own);
    const buf = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#2f3b33' } }).png().toBuffer();
    const [a] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'post-1.png', buffer: buf });
    const [b] = await ingestUpload({ projectId: P, workspaceId: WS, kind: 'design', filename: 'post-2.png', buffer: buf });
    const oldLayout = { template: 'profile-web', slots: [{ assetId: a!.id }, { assetId: b!.id }], aspect: '3:4', account: { handle: 'oud' } };
    const m = mockups.insert({
      id: newId(), projectId: P, sceneId: own.id, generationId: null, favorite: false, previewFile: null, createdAt: now(), updatedAt: now(),
      placements: own.surfaces.map((s) => ({ ...placementsFor(template, a!.id)[0]!, surfaceId: s.id, layout: oldLayout as never })),
    });
    const genId = newId();
    generations.insert({
      id: genId, projectId: P, status: 'done', prompt: '', count: 1, assetId: null, sceneIds: [own.id], mockupIds: [m.id], error: null, provider: 'demo', model: '', credits: 0, costUsd: 0, createdBy: null, createdAt: now(), finishedAt: now(),
      config: { category: 'social', objectType: 'social-phones', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', socialFormat: 'campaign', socialAssetIds: [a!.id] } as never,
    });

    const r = await retireSocial();
    expect(r.backup).toMatch(/^studio-\d{8}-\d{6}\.sqlite$/);
    expect(existsSync(path.join(dataPath('backups'), r.backup!))).toBe(true);
    expect(r).toMatchObject({ mockups: 1, scenesRemoved: 1, scenesRemapped: 1, configs: 1 });
    // Mockup: gewone plaatsing met het eerste ontwerp, opslaanbaar.
    const converted = mockups.get(m.id)!;
    expect(converted.placements.every((p) => !p.layout && p.assetId === a!.id)).toBe(true);
    expect(() => validatePlacements(scenes.get(own.id)!, P, converted.placements)).not.toThrow();
    // Eigen scène blijft, nu als laptop; de ongebruikte testscène is weg.
    expect(scenes.get(own.id)).toMatchObject({ objectType: 'laptop', category: 'devices' });
    expect(scenes.get(own.id)!.config).toMatchObject({ objectType: 'laptop', category: 'devices' });
    expect((scenes.get(own.id)!.config as Record<string, unknown>).socialFormat).toBeUndefined();
    expect(scenes.get(demoUnused.id)).toBeNull();
    // Configuratie: geen social-velden meer.
    const cfg = generations.get(genId)!.config as Record<string, unknown>;
    expect(cfg).toMatchObject({ objectType: 'smartphone', category: 'devices' });
    expect(cfg.socialFormat).toBeUndefined();
    expect(cfg.socialAssetIds).toBeUndefined();
    // Het omgezette mockup rendert gewoon.
    expect((await renderImage(converted, scenes.get(own.id)!, { width: 600, output: { format: 'png' } })).buffer.length).toBeGreaterThan(1000);
    // Een tweede keer opstarten doet niets (en maakt geen extra back-up).
    expect(await retireSocial()).toEqual({ backup: null, mockups: 0, scenesRemapped: 0, scenesRemoved: 0, configs: 0 });
  });

  function mailScenes() { return scenes.list({ library: true }).filter((s) => s.category === 'email'); }
});
