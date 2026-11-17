// Social media mockups zijn uit de studio gehaald. Bestaande gegevens blijven bruikbaar: deze stap draait bij
// het opstarten, één keer, en alleen als er nog social-gegevens zijn.
// - Eerst een volledige back-up van de database (zichtbaar onder Back-ups, terug te zetten).
// - Mockups met een social-sjabloon worden een gewone mockup met het eerste ontwerp erop.
// - Eigen scènes (geüpload of met AI gemaakt) blijven bestaan als gewone apparaat- of drukwerkscène.
// - De meegeleverde social-testscènes verdwijnen, behalve als er nog een mockup op staat.
import { findObject, smartFit } from '../../../shared/catalog';
import { surfaceDimensions } from '../../../shared/geometry';
import { DEFAULT_TRANSFORM, type Placement } from '../../../shared/types';
import { createBackup } from '../backup';
import { getDb } from '../db';
import { log } from '../log';
import { renderPreview } from '../mockups';
import { assets, mockups, scenes } from '../repositories';
import { deleteScene } from '../scenes';

/** Waar een social-object naartoe gaat: het dichtstbijzijnde gewone object. */
export const SOCIAL_TO: Record<string, { objectType: string; category: string }> = {
  'social-phone': { objectType: 'smartphone', category: 'devices' },
  'social-phone-hand': { objectType: 'smartphone', category: 'devices' },
  'social-phones': { objectType: 'smartphone', category: 'devices' },
  'social-laptop': { objectType: 'laptop', category: 'devices' },
  'social-devices': { objectType: 'multi-device', category: 'devices' },
  'social-presentation': { objectType: 'monitor', category: 'devices' },
  'social-prints': { objectType: 'poster', category: 'print' },
};
const SOCIAL_TEMPLATES = new Set(['post', 'story', 'reel', 'grid', 'profile', 'profile-web']);
const target = (objectType: string) => SOCIAL_TO[objectType] ?? (objectType.startsWith('social-') ? { objectType: 'smartphone', category: 'devices' } : null);

type Row = Record<string, unknown>;
const all = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Row[];
const run = (sql: string, ...p: (string | number | null)[]) => getDb().prepare(sql).run(...p);

/** Zet een opgeslagen sceneconfiguratie om (object en categorie), zonder de social-velden. */
function cleanConfig(json: string): string | null {
  const c = JSON.parse(json) as Record<string, unknown>;
  const t = typeof c.objectType === 'string' ? target(c.objectType) : null;
  const had = c.category === 'social' || !!t || 'socialFormat' in c || 'socialAssetIds' in c;
  if (!had) return null;
  if (t) { c.objectType = t.objectType; c.category = t.category; } else if (c.category === 'social') { c.category = 'devices'; c.objectType = 'smartphone'; }
  delete c.socialFormat;
  delete c.socialAssetIds;
  return JSON.stringify(c);
}

export interface RetireResult { backup: string | null; mockups: number; scenesRemapped: number; scenesRemoved: number; configs: number }

export async function retireSocial(): Promise<RetireResult> {
  const result: RetireResult = { backup: null, mockups: 0, scenesRemapped: 0, scenesRemoved: 0, configs: 0 };
  const socialScenes = all("SELECT id, workspace_id, origin, object_type FROM scenes WHERE object_type LIKE 'social-%' OR category = 'social'");
  const socialMockups = all("SELECT id, placements FROM mockups WHERE placements LIKE '%\"template\":%'").filter((r) =>
    (JSON.parse(String(r.placements)) as { layout?: { template?: string } | null }[]).some((p) => p.layout?.template && SOCIAL_TEMPLATES.has(p.layout.template)));
  const socialGens = all("SELECT id, config FROM generations WHERE config LIKE '%social%'");
  const sceneConfigs = all("SELECT id, config FROM scenes WHERE config LIKE '%social%'");
  if (!socialScenes.length && !socialMockups.length && !socialGens.length && !sceneConfigs.length) return result;

  // Vóór elke wijziging: een volledige kopie van de database.
  result.backup = (await createBackup()).name;
  const rerender: string[] = [];

  // Mockups: het eerste ontwerp van het sjabloon komt zelf op het vlak, passend voor het object.
  for (const r of socialMockups) {
    const m = mockups.get(String(r.id));
    if (!m) continue;
    const scene = scenes.get(m.sceneId);
    const obj = scene ? findObject(target(scene.objectType)?.objectType ?? scene.objectType)?.object : null;
    const placements: Placement[] = m.placements.map((p) => {
      const tpl = (p.layout as { template?: string } | null | undefined)?.template;
      if (!tpl || !SOCIAL_TEMPLATES.has(tpl)) return p;
      const first = p.layout!.slots.find((s) => s.assetId)?.assetId ?? p.assetId ?? null;
      const asset = first ? assets.get(first) : null;
      const surface = scene?.surfaces.find((s) => s.id === p.surfaceId);
      const fit = surface && scene ? smartFit(obj?.defaultFit ?? 'cover', asset, surfaceDimensions(surface.quad, scene)) : 'cover';
      return { ...p, layout: null, assetId: first && asset ? first : null, transform: { ...DEFAULT_TRANSFORM, fit, anchor: 'top' } };
    });
    mockups.update(m.id, { placements });
    rerender.push(m.id);
    result.mockups++;
  }

  // Scènes: de meegeleverde testscènes weg als niemand ze gebruikt; al het andere wordt een gewone scène.
  for (const r of socialScenes) {
    const id = String(r.id);
    const used = mockups.list({ sceneId: id }).length > 0;
    if (r.workspace_id === null && r.origin === 'demo' && !used) {
      await deleteScene(id).catch((e) => log.warn('migration.social_scene_remove_failed', { scene: id, error: String(e) }));
      result.scenesRemoved++;
      continue;
    }
    const t = target(String(r.object_type)) ?? { objectType: 'smartphone', category: 'devices' };
    run('UPDATE scenes SET object_type = ?, category = ? WHERE id = ?', t.objectType, t.category, id);
    // Een meegeleverde testscène die nog in gebruik is, blijft werken maar staat niet meer in de bibliotheek.
    if (r.workspace_id === null && r.origin === 'demo') run('UPDATE scenes SET in_library = 0 WHERE id = ?', id);
    result.scenesRemapped++;
  }

  // Opgeslagen instellingen (configuraties en scènes): verwijzen niet meer naar social media.
  for (const r of socialGens) {
    const next = cleanConfig(String(r.config));
    if (next) { run('UPDATE generations SET config = ? WHERE id = ?', next, String(r.id)); result.configs++; }
  }
  for (const r of sceneConfigs) {
    const next = r.config ? cleanConfig(String(r.config)) : null;
    if (next) run('UPDATE scenes SET config = ? WHERE id = ?', next, String(r.id));
  }

  log.info('migration.social_removed', { ...result });
  // Nieuwe previews op de achtergrond, zodat de overzichten de omgezette mockups tonen.
  void (async () => {
    for (const id of rerender) {
      const m = mockups.get(id);
      if (m) await renderPreview(m).catch((e) => log.warn('migration.preview_failed', { mockup: id, error: String(e) }));
    }
  })();
  return result;
}
