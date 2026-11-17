// Startmateriaal: een systeembibliotheek met testscènes (eenmalig) en een voorbeeldproject per nieuwe
// werkruimte, zodat een nieuwe gebruiker direct een complete workflow kan proberen.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findObject } from '../../shared/catalog';
import { renderDemoScene } from './generation/demo-scenes';
import { log } from './log';
import { projects, scenes } from './repositories';
import { createScene } from './scenes';
import { ingestUpload } from './uploads';

const LICENSE = 'Testscène, door Mockup Studio getekend. Geen foto; alleen voor het testen van de workflow.';

const LIBRARY: { objectType: string; width: number; height: number; seed: number; tags: Record<string, string> }[] = [
  { objectType: 'laptop', width: 2400, height: 1600, seed: 11, tags: { material: 'aluminium', angle: 'three-quarter', composition: 'center', color: 'neutraal' } },
  { objectType: 'multi-device', width: 2400, height: 1600, seed: 23, tags: { material: 'aluminium', angle: 'three-quarter', composition: 'center', color: 'warm' } },
  { objectType: 'smartphone', width: 1600, height: 2000, seed: 5, tags: { material: 'glas', angle: 'top', composition: 'center', color: 'neutraal' } },
  { objectType: 'business-card', width: 2400, height: 1600, seed: 8, tags: { material: 'papier', angle: 'top', composition: 'center', color: 'warm' } },
  { objectType: 'poster', width: 1600, height: 2000, seed: 3, tags: { material: 'papier', angle: 'front', composition: 'center', color: 'neutraal' } },
  { objectType: 't-shirt', width: 2000, height: 2000, seed: 17, tags: { material: 'katoen', angle: 'front', composition: 'center', color: 'koel' } },
  { objectType: 'mug', width: 2000, height: 1500, seed: 4, tags: { material: 'keramiek', angle: 'front', composition: 'center', color: 'neutraal' } },
  { objectType: 'sign-board', width: 2400, height: 1600, seed: 29, tags: { material: 'metaal', angle: 'three-quarter', composition: 'center', color: 'neutraal' } },
  // E-mailhandtekening
  { objectType: 'email-laptop', width: 2400, height: 1600, seed: 53, tags: { material: 'aluminium', angle: 'front', composition: 'center', color: 'warm' } },
  { objectType: 'email-phone', width: 1600, height: 2000, seed: 41, tags: { material: 'glas', angle: 'front', composition: 'center', color: 'warm' } },
  { objectType: 'email-phone-hand', width: 1600, height: 2000, seed: 47, tags: { material: 'glas', angle: 'top', composition: 'center', color: 'koel' } },
  { objectType: 'email-devices', width: 2400, height: 1600, seed: 61, tags: { material: 'aluminium', angle: 'three-quarter', composition: 'center', color: 'warm' } },
];

export const fixturesDir = () => process.env.NUXT_FIXTURES_DIR || path.resolve(process.cwd(), 'fixtures');

export async function seedSystemLibrary() {
  if (process.env.NUXT_SEED_DEMO === 'false') return;
  // Aanvullen: nieuwe testscènes in een latere versie komen er ook bij bestaande installaties bij.
  const existing = new Set(scenes.list({ library: true }).filter((x) => x.workspaceId === null && x.origin === 'demo').map((x) => x.objectType));
  for (const item of LIBRARY) {
    if (existing.has(item.objectType)) continue;
    const found = findObject(item.objectType)!;
    await createScene({
      buffer: await renderDemoScene(item.objectType, { width: item.width, height: item.height, seed: item.seed, chroma: true }),
      workspaceId: null, projectId: null, origin: 'demo', inLibrary: true, title: `Testscène ${found.object.label.toLowerCase()}`,
      category: found.category.id, objectType: found.object.id, surfaceKind: found.object.surfaceKind, tags: item.tags,
      license: LICENSE, detect: true,
    });
  }
  log.info('seed.library', { scenes: LIBRARY.length });
}

/** Voorbeeldproject met een website, logo en visitekaartje van een fictief architectenbureau. */
export async function createSampleProject(workspaceId: string, dir = fixturesDir()) {
  if (process.env.NUXT_SEED_DEMO === 'false') return null;
  const p = projects.create({ workspaceId, name: 'Voorbeeld: Atelier Noord', client: 'Fictief architectenbureau', url: '' });
  const files: [string, string][] = [
    ['atelier-noord-desktop.png', 'Website desktop.png'],
    ['atelier-noord-mobile.png', 'Website smartphone.png'],
    ['atelier-noord-logo.svg', 'Logo.svg'],
    ['atelier-noord-visitekaartje.svg', 'Visitekaartje.svg'],
    // Een e-mailhandtekening om de e-mailmockups mee te proberen.
    ['email/handtekening-atelier-noord.png', 'E-mailhandtekening.png'],
  ];
  for (const [file, name] of files) {
    try {
      await ingestUpload({ projectId: p.id, workspaceId, kind: 'design', filename: name, buffer: await readFile(path.join(dir, file)) });
    } catch (e) {
      log.warn('seed.sample_file_skipped', { file, error: (e as Error).message });
    }
  }
  return p;
}
