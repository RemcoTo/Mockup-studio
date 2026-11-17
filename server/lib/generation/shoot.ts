// Brand Shoot: één art direction (plek, licht, stijl, kleurtemperatuur, merkkleuren, referentie) toegepast op
// meerdere objecten tegelijk, zodat er een samenhangende serie ontstaat in plaats van losse beelden.
// Elk beeld is een gewone generatie (eigen credits, eigen terugboeking bij mislukken); vooraf wordt
// gecontroleerd of de hele serie binnen het tegoed en de dagplafonds past, zodat er geen halve serie start.
import { findObject } from '../../../shared/catalog';
import type { SceneConfig } from '../../../shared/types';
import { assertSpendLimits, creditsEnforced } from '../billing/credits';
import { assertFeature } from '../billing/plans';
import { AppError, badRequest, notFound } from '../errors';
import { newId } from '../ids';
import { credits, users } from '../repo-accounts';
import { isVerified } from '../auth/verification';
import { assets, projects } from '../repositories';
import { keyProblem, previewGeneration, startGeneration } from './jobs';
import { paletteProblem, scenePalette } from '../../../shared/palette';
import { chromaConflict } from '../../../shared/scene-style';
import { getProvider } from './providers';
import { defaultDeviceSpec, deviceModelFor } from '../../../shared/device3d/spec';

export const MAX_SHOOT_ITEMS = 8;

/** De gedeelde art direction: alles behalve het object zelf. */
export type Direction = Pick<SceneConfig,
  'environment' | 'environmentCustom' | 'lighting' | 'colorTemperature' | 'shadows' | 'style' | 'instructions' | 'avoid' | 'avoidCustom' |
  'referenceAssetIds' | 'referenceAspects' | 'negativeSpace' | 'palette'>;

export interface ShootItem { objectType: string; assetId: string | null; material?: string; color?: string; angle?: string; aspect?: string }

/** Afmetingen van het gekozen ontwerp per beeld, zodat elk oppervlak de stand en verhouding van zijn ontwerp krijgt. */
function designSizeOf(it: ShootItem): SceneConfig['designSize'] {
  const a = it.assetId ? assets.get(it.assetId) : null;
  return a && a.width > 0 && a.height > 0 ? { width: Math.max(16, Math.min(20000, Math.round(a.width))), height: Math.max(16, Math.min(20000, Math.round(a.height))) } : undefined;
}

function defaultAspect(objectType: string) {
  const o = findObject(objectType)?.object;
  return o?.surfaceOrientation === 'portrait' || ['t-shirt', 'hoodie', 'polo', 'mug', 'bottle', 'can', 'tote-bag', 'poster', 'flyer', 'magazine'].includes(objectType) ? '4:5' : '3:2';
}

/**
 * Bouwt de configuraties van de serie. Met devices3d worden laptops, telefoons, tablets en monitoren een echt
 * 3D-model (de AI maakt alleen de omgeving); alle devices van de serie delen hetzelfde camerastandpunt.
 */
export function shootConfigs(title: string, direction: Direction, items: ShootItem[], quality: SceneConfig['quality'], seriesId = newId(), devices3d = true): SceneConfig[] {
  if (!items.length) throw badRequest('Kies minstens één object voor de shoot.');
  if (items.length > MAX_SHOOT_ITEMS) throw badRequest(`Een shoot heeft maximaal ${MAX_SHOOT_ITEMS} beelden.`);
  return items.map((it, i) => {
    const found = findObject(it.objectType);
    if (!found) throw badRequest(`Onbekend object: ${it.objectType}`);
    const model = devices3d ? deviceModelFor(found.object.id) : null;
    return {
      ...direction,
      category: found.category.id, objectType: found.object.id, material: it.material, color: it.color, angle: it.angle,
      aspect: it.aspect ?? defaultAspect(it.objectType), resolution: 'standard', quality, surfaceMethod: 'chroma', designSize: designSizeOf(it),
      series: { id: seriesId, title: title.trim().slice(0, 120) || 'Brand shoot', index: i + 1, total: items.length },
      ...(model ? { device3d: defaultDeviceSpec(model.id) } : {}),
    };
  });
}

/** Zoals bij een losse scène, maar Brand Shoot vindt het ontwerpvlak altijd automatisch: er is geen leeg vlak om naar uit te wijken. */
function shootColorProblem(configs: SceneConfig[]): string | null {
  // Alle beelden delen de kleuren; alleen beelden die het groene vlak gebruiken (geen 3D-device) kunnen botsen.
  const cfg = configs.find((c) => chromaConflict(c)) ?? configs[0]!;
  const bad = chromaConflict(cfg);
  if (bad) return `De kleur ${bad} lijkt te veel op het groene vlak waarmee de studio het ontwerpvlak vindt. Brand Shoot vindt dat vlak altijd automatisch; kies voor deze kleur een andere tint.`;
  return keyProblem(cfg) ?? paletteProblem(scenePalette(cfg));
}

export function previewShoot(title: string, direction: Direction, items: ShootItem[], quality: SceneConfig['quality'], providerId?: string, devices3d = true) {
  const configs = shootConfigs(title, direction, items, quality, 'voorbeeld', devices3d);
  const parts = configs.map((c) => previewGeneration(c, 1, providerId));
  const provider = parts[0]!.provider;
  return {
    provider,
    items: parts.map((p, i) => ({ objectType: configs[i]!.objectType, size: p.size, cost: p.cost, credits: p.credits, prompt: p.prompt })),
    totalUsd: parts.reduce((s, p) => s + (p.cost?.usd ?? 0), 0),
    exact: parts.every((p) => p.cost?.exact !== false),
    credits: parts.reduce((s, p) => s + p.credits, 0),
    /** Waarom de shoot niet kan starten (bijvoorbeeld een kleur die op het groene ontwerpvlak lijkt); alle beelden delen de kleuren. */
    problem: shootColorProblem(configs),
    /** Beelden waarvan het device een echt 3D-model wordt. */
    devices3d: configs.filter((c) => !!c.device3d).length,
  };
}

export function startShoot(input: { projectId: string; title: string; direction: Direction; items: ShootItem[]; quality: SceneConfig['quality']; providerId?: string; userId: string | null; devices3d?: boolean }) {
  const devices3d = input.devices3d ?? true;
  const project = projects.get(input.projectId);
  if (!project) throw notFound('Project');
  assertFeature(project.workspaceId, 'brandShoot');
  for (const it of input.items) {
    if (!it.assetId) continue;
    const a = assets.get(it.assetId);
    if (!a || a.projectId !== project.id) throw badRequest('Een gekozen ontwerp hoort niet bij dit project.');
  }
  // Referentiebeelden vooraf toetsen, zodat er nooit een halve serie start.
  for (const id of input.direction.referenceAssetIds ?? []) {
    const a = assets.get(id);
    if (!a || a.projectId !== project.id || a.kind !== 'reference') throw badRequest('Een referentiebeeld hoort niet bij dit project.');
  }
  const info = getProvider(input.providerId).info();
  if (!info.configured) throw new AppError(503, info.problem ?? 'De beeldprovider is niet geconfigureerd.', 'provider_not_configured');
  const preview = previewShoot(input.title, input.direction, input.items, input.quality, info.id, devices3d);
  if (preview.problem) throw badRequest(preview.problem, 'color_conflict');
  // Alles of niets: eerst het geheel toetsen, daarna pas de afzonderlijke generaties starten.
  if (info.isAi) {
    if (creditsEnforced() && credits.balance(project.workspaceId) < preview.credits) {
      throw new AppError(402, `Deze shoot kost ${preview.credits} credits en je hebt er nog ${credits.balance(project.workspaceId)}. Kies minder beelden of een lagere kwaliteit, of vul je credits aan.`, 'insufficient_credits');
    }
    const u = input.userId ? users.get(input.userId) : null;
    if (u && !isVerified(u)) throw new AppError(403, 'Bevestig eerst je e-mailadres; daarna kun je AI-scènes maken.', 'email_unverified');
    assertSpendLimits(project.workspaceId, preview.totalUsd, input.userId);
  }
  const seriesId = newId();
  const configs = shootConfigs(input.title, input.direction, input.items, input.quality, seriesId, devices3d);
  const gens = configs.map((config, i) => startGeneration({ projectId: project.id, assetId: input.items[i]!.assetId, config, count: 1, provider: info.id, userId: input.userId }));
  return { seriesId, generations: gens, totalUsd: preview.totalUsd, credits: preview.credits };
}
