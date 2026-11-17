// Invoercontrole voor de API. Elk verzoek wordt hier gevalideerd voordat het de services bereikt.
import { z } from 'zod';
import { DESIGN_SIZE_MAX, DESIGN_SIZE_MIN } from '../../shared/design-size';
import { SIGNATURE_WIDTH_MAX, SIGNATURE_WIDTH_MIN } from '../../shared/mail';
import { badRequest } from './errors';
import { normalizeHex } from '../../shared/color';
import { GROUNDS, SCENE_TYPES } from '../../shared/scene-style';
import { COLOR_ROLE_IDS, PALETTE_MAX, normalizeSceneColors } from '../../shared/palette';
import { clampDeviceSpec, type Device3DSpec } from '../../shared/device3d/spec';

const point = z.tuple([z.number().finite(), z.number().finite()]);
export const quadSchema = z.tuple([point, point, point, point]);
export const meshSchema = z.object({ cols: z.number().int().min(1).max(24), rows: z.number().int().min(1).max(24), points: z.array(point).max(625) })
  .refine((m) => m.points.length === (m.cols + 1) * (m.rows + 1), 'het aantal rasterpunten klopt niet');
export const cylinderSchema = z.object({ wrap: z.number().min(0).max(300), bulge: z.number().min(-0.5).max(0.5) });

export const transformSchema = z.object({
  fit: z.enum(['cover', 'contain', 'fill', 'width']),
  offsetX: z.number().min(-5).max(5),
  offsetY: z.number().min(-50).max(50),
  scale: z.number().min(0.02).max(20),
  rotation: z.number().min(-360).max(360),
  anchor: z.enum(['top', 'center']).optional(),
});

const assetRef = z.object({ assetId: z.string().min(1).max(40).nullable() });
const short = (n: number) => z.string().max(n).optional();
export const screenLayoutSchema = z.object({
  template: z.enum(['mail-desktop', 'mail-mobile']),
  slots: z.array(assetRef).length(1),
  avatar: z.object({ assetId: z.string().min(1).max(40) }).nullable().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  mail: z.object({ fromName: short(80), fromEmail: short(120), to: short(80), subject: short(160), date: short(40), body: short(2000) }).optional(),
  signatureWidth: z.number().int().min(SIGNATURE_WIDTH_MIN).max(SIGNATURE_WIDTH_MAX).optional(),
});

export const placementSchema = z.object({
  surfaceId: z.string().min(1).max(40),
  assetId: z.string().min(1).max(40).nullable(),
  transform: transformSchema,
  quad: quadSchema.nullable(),
  mesh: meshSchema.nullable().optional(),
  cylinder: cylinderSchema.nullable().optional(),
  blend: z.object({
    shading: z.number().min(0).max(1),
    displacement: z.number().min(0).max(24),
    gloss: z.number().min(0).max(1),
    opacity: z.number().min(0).max(1),
    reflections: z.number().min(0).max(1).optional(),
  }),
  background: z.string().regex(/^(#[0-9a-f]{6}|transparent|auto)$/i),
  useMask: z.boolean(),
  hidden: z.boolean(),
  layout: screenLayoutSchema.nullable().optional(),
});

const opt = z.string().max(60).optional();
/** '#rrggbb'; ook '#abc' en zonder hekje, altijd opgeslagen als '#rrggbb'. */
const hexColor = z.string().max(9).transform((v, ctx) => {
  const n = normalizeHex(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'gebruik een HEX-kleur zoals #1e2a4a' }); return z.NEVER; }
  return n;
});
const gradientDirection = z.enum(['vertical', 'horizontal', 'diagonal', 'radial']);
/** Merkkleuren met elk één toepassing in de scène (zie shared/palette). */
export const paletteSchema = z.object({
  colors: z.array(z.object({ hex: hexColor, role: z.enum(COLOR_ROLE_IDS) })).max(PALETTE_MAX, `maximaal ${PALETTE_MAX} kleuren`),
  gradient: z.object({ direction: gradientDirection }).optional(),
  background: z.enum(['exact', 'ai']).optional(),
});
/** Instellingen van een 3D-device (zie shared/device3d/spec); de studio houdt ze daarna binnen de grenzen. */
export const device3dSpecSchema = z.object({
  model: z.string().max(40),
  finish: z.string().max(40),
  pose: z.enum(['standing', 'flat', 'upright']),
  lidAngle: z.number().min(0).max(180),
  yaw: z.number().min(-360).max(360),
  tilt: z.number().min(-90).max(90),
  roll: z.number().min(-180).max(180).optional(),
  camera: z.object({ elevation: z.number().min(0).max(90), fov: z.number().min(5).max(90), size: z.number().min(0.05).max(3) }),
  frame: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
  light: z.object({ auto: z.boolean(), azimuth: z.number().min(-360).max(360), elevation: z.number().min(0).max(90), intensity: z.number().min(0).max(3), warmth: z.number().min(-1).max(1) }),
  shadow: z.number().min(0).max(1),
  reflections: z.number().min(0).max(1),
  offset: z.object({ x: z.number().min(-5).max(5), y: z.number().min(-5).max(5), z: z.number().min(-5).max(5) }).optional(),
  statusBar: z.object({ show: z.boolean(), time: z.string().max(40), date: z.string().max(60), tone: z.enum(['auto', 'light', 'dark']) }).optional(),
}).transform((s) => clampDeviceSpec(s as Device3DSpec));
export const sceneConfigSchema = z.object({
  category: z.string().min(1).max(40),
  objectType: z.string().min(1).max(40),
  brandModel: z.string().max(80).optional(),
  material: z.string().max(80).optional(),
  color: z.string().max(60).optional(),
  finish: opt,
  objectCount: z.number().int().min(1).max(6).optional(),
  orientation: opt,
  framing: opt,
  objectPosition: opt,
  environment: opt,
  environmentCustom: z.string().max(400).optional(),
  angle: opt,
  composition: opt,
  negativeSpace: opt,
  symmetry: opt,
  compositionCustom: z.string().max(400).optional(),
  lighting: opt,
  colorTemperature: z.number().int().min(2000).max(9000).optional(),
  shadows: opt,
  style: opt,
  aspect: z.string().max(10),
  resolution: z.enum(['standard', 'high', 'max']),
  quality: z.enum(['low', 'medium', 'high']),
  instructions: z.string().max(2000).optional(),
  avoid: z.array(z.string().max(40)).max(20).optional(),
  avoidCustom: z.string().max(400).optional(),
  referenceAssetIds: z.array(z.string().max(40)).max(4).optional(),
  referenceAspects: z.array(z.string().max(40)).max(10).optional(),
  sceneType: z.enum(SCENE_TYPES.map((t) => t.id) as [string, ...string[]]).optional(),
  props: z.enum(['none', 'minimal', 'brand']).optional(),
  ground: z.enum(GROUNDS.map((t) => t.id) as [string, ...string[]]).optional(),
  palette: paletteSchema.optional(),
  device3d: device3dSpecSchema.nullable().optional(),
  // Configuraties van vóór het palet (hergebruikt of via de API): worden hieronder omgezet naar het palet.
  brandColor: hexColor.optional(),
  brandColorUse: z.array(z.enum(['background', 'ground', 'props', 'light'])).max(4).optional(),
  backdrop: z.object({
    mode: z.enum(['solid', 'gradient']),
    color: hexColor,
    color2: hexColor.optional(),
    stops: z.array(hexColor).min(2).max(PALETTE_MAX).optional(),
    direction: gradientDirection.optional(),
    texture: z.enum(['none', 'grain', 'paper']).optional(),
    shadow: z.enum(['soft', 'hard', 'none']).optional(),
  }).nullable().optional(),
  designSize: z.object({ width: z.number().int().min(DESIGN_SIZE_MIN).max(DESIGN_SIZE_MAX), height: z.number().int().min(DESIGN_SIZE_MIN).max(DESIGN_SIZE_MAX) }).optional(),
  surfaceMethod: z.enum(['chroma', 'blank']),
  series: z.object({ id: z.string().max(40), title: z.string().max(120), index: z.number().int().min(1).max(20), total: z.number().int().min(1).max(20) }).optional(),
}).transform((cfg) => normalizeSceneColors(cfg));

export const surfaceInputSchema = z.object({
  id: z.string().max(40).optional(),
  label: z.string().min(1).max(60),
  kind: z.enum(['screen', 'paper', 'fabric', 'rigid']),
  quad: quadSchema,
  mesh: meshSchema.nullable().optional(),
  cylinder: cylinderSchema.nullable().optional(),
});

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest(`Ongeldige invoer${issue?.path.length ? ` bij ${issue.path.join('.')}` : ''}: ${issue?.message ?? 'onbekend'}.`, 'validation');
  }
  return r.data;
}

// Brand Shoot
const shootOpt = z.string().max(40).optional();
export const shootSchema = z.object({
  projectId: z.string().min(1).max(40),
  title: z.string().max(120).default(''),
  quality: z.enum(['low', 'medium', 'high']),
  direction: z.object({
    environment: shootOpt, environmentCustom: z.string().max(400).optional(), lighting: shootOpt, colorTemperature: z.number().int().min(2000).max(9000).optional(),
    shadows: shootOpt, style: shootOpt, instructions: z.string().max(2000).optional(), avoid: z.array(z.string().max(40)).max(20).optional(),
    avoidCustom: z.string().max(400).optional(), referenceAssetIds: z.array(z.string().max(40)).max(4).optional(),
    referenceAspects: z.array(z.string().max(40)).max(10).optional(), negativeSpace: shootOpt,
    palette: paletteSchema.optional(),
  }),
  items: z.array(z.object({
    objectType: z.string().min(1).max(40), assetId: z.string().max(40).nullable(), material: z.string().max(80).optional(),
    color: z.string().max(60).optional(), angle: shootOpt, aspect: z.string().max(10).optional(),
  })).min(1).max(8),
  /** Laptops, telefoons, tablets en monitoren als echt 3D-model (standaard aan). */
  devices3d: z.boolean().default(true),
});
