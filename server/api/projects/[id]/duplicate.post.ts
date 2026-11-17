import { newId, now } from '../../../lib/ids';
import { keys } from '../../../lib/keys';
import { assets, mockups, projects, scenes, transaction } from '../../../lib/repositories';
import { storage } from '../../../lib/storage';
import { assertProjectQuota } from '../../../lib/billing/plans';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
const swap = (key: string | null | undefined, from: string, to: string) => (key ? key.replace(from, to) : key ?? null);

/**
 * Dupliceert een project met eigen kopieën van ontwerpen, projectscènes en mockups, zodat het
 * origineel later verwijderd kan worden zonder de kopie te raken. Bibliotheekscènes blijven gedeeld.
 */
export default apiHandler(async (event) => {
  const { project: src, ctx } = requireProject(event, param(event), 'member');
  const ws = ctx.workspace.id;
  assertProjectQuota(ws);
  const copy = projects.create({ workspaceId: ws, name: `${src.name} (kopie)`, client: src.client, url: src.url });
  const assetMap = new Map<string, string>();
  const sceneMap = new Map<string, string>();
  const srcAssets = assets.list({ projectId: src.id });
  const srcScenes = scenes.list({ workspaceId: ws, projectId: src.id }).filter((s) => !s.inLibrary && s.workspaceId === ws);
  const oldOriginals = keys.original(ws, src.id), newOriginals = keys.original(ws, copy.id);
  await storage.copy(oldOriginals, newOriginals);
  // Ook bestanden in de oudere indeling worden naar de nieuwe indeling gekopieerd.
  const assetFiles = new Map<string, { file: string; preview: string; raster?: string }>();
  for (const a of srcAssets) {
    const id = newId();
    assetMap.set(a.id, id);
    const dir = keys.asset(ws, id);
    const oldDir = a.preview.slice(0, a.preview.lastIndexOf('/'));
    await storage.copy(oldDir, dir);
    const rel = (k: string) => `${dir}/${k.slice(oldDir.length + 1)}`;
    assetFiles.set(a.id, {
      file: a.mime === 'application/pdf' ? swap(a.file, oldOriginals, newOriginals)! : rel(a.file),
      preview: rel(a.preview),
      raster: a.meta.raster ? rel(String(a.meta.raster)) : undefined,
    });
  }
  for (const s of srcScenes) {
    const id = newId();
    sceneMap.set(s.id, id);
    const oldDir = s.file.slice(0, s.file.lastIndexOf('/'));
    await storage.copy(oldDir, keys.scene(ws, id));
  }
  transaction(() => {
    for (const a of srcAssets) {
      const f = assetFiles.get(a.id)!;
      assets.insert({ ...a, id: assetMap.get(a.id)!, projectId: copy.id, file: f.file, preview: f.preview, meta: { ...a.meta, ...(f.raster ? { raster: f.raster } : {}) }, createdAt: now() });
    }
    for (const s of srcScenes) {
      const id = sceneMap.get(s.id)!;
      const oldDir = s.file.slice(0, s.file.lastIndexOf('/'));
      const newDir = keys.scene(ws, id);
      scenes.insert({
        ...s, id, workspaceId: ws, projectId: copy.id, file: swap(s.file, oldDir, newDir)!, thumb: swap(s.thumb, oldDir, newDir)!, createdAt: now(),
        surfaces: s.surfaces.map((x) => ({ ...x, maskFile: swap(x.maskFile, oldDir, newDir), shadingFile: swap(x.shadingFile, oldDir, newDir) })),
      });
    }
    for (const m of mockups.list({ projectId: src.id })) {
      mockups.insert({
        ...m, id: newId(), projectId: copy.id, generationId: null, previewFile: null,
        sceneId: sceneMap.get(m.sceneId) ?? m.sceneId,
        placements: m.placements.map((p) => {
          const map = (id: string | null | undefined) => (id ? assetMap.get(id) ?? null : null);
          return {
            ...p, assetId: map(p.assetId),
            layout: p.layout ? { ...p.layout, slots: p.layout.slots.map((s) => ({ assetId: map(s.assetId) })), avatar: p.layout.avatar && map(p.layout.avatar.assetId) ? { assetId: map(p.layout.avatar.assetId)! } : null } : p.layout,
          };
        }),
        createdAt: now(), updatedAt: now(),
      });
    }
  });
  return copy;
});
