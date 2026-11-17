// Rendert 3D-devices op de server: Three.js in headless Chromium (WebGL2; zonder GPU via SwiftShader), met de
// renderpagina uit shared/device3d/render-page.ts. De browser heeft geen netwerk: model en achtergrond gaan
// als data mee. Eén browser en één pagina, hergebruikt en na een minuut zonder werk gesloten.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Browser, Page } from 'playwright-core';
import type { Quad } from '../../../shared/geometry';
import { clampDeviceSpec, findDeviceModel, type Device3DSpec } from '../../../shared/device3d/spec';
import type { LightEstimate } from '../../../shared/device3d/stage';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { log } from '../log';

export interface DeviceRender {
  /** Achtergrond met het device en zijn schaduw erop (PNG). */
  image: Buffer;
  /** Schermmasker (PNG, grijswaarden): wit = zichtbaar scherm. */
  mask: Buffer;
  quad: Quad;
  /** Ziet de camera de voorkant van het scherm? */
  facing: boolean;
  /** Aandeel van de schermhoeken dat zichtbaar is (0..1). */
  visible: number;
  width: number;
  height: number;
  light: LightEstimate;
  ms: number;
}

let browserP: Promise<Browser> | null = null;
let pageP: Promise<Page> | null = null;
let idle: NodeJS.Timeout | null = null;
let chain: Promise<unknown> = Promise.resolve();
let pageCode: string | null = null;
const glbCache = new Map<string, string>();

function candidates(...rel: string[]): string[] {
  const roots = [process.cwd(), process.argv[1] ? path.resolve(path.dirname(process.argv[1]), '..') : '', process.argv[1] ? path.dirname(process.argv[1]) : ''].filter(Boolean);
  return roots.flatMap((r) => rel.map((p) => path.join(r, p)));
}

/** De gebundelde renderpagina: naast de server na een productiebuild, in .nuxt tijdens ontwikkeling. */
async function renderPageCode(): Promise<string> {
  if (pageCode) return pageCode;
  const file = candidates('server/device3d/render-page.js', 'device3d/render-page.js', '.nuxt/device3d/render-page.js').find((f) => existsSync(f));
  if (!file) throw new AppError(503, 'De 3D-renderer is niet gebouwd. Voer "npm run build" uit (of "node scripts/build-devices.mjs page").', 'device3d_missing');
  pageCode = await readFile(file, 'utf8');
  return pageCode;
}

/** Map met de GLB-modellen (public/models/devices, of de gepubliceerde kopie na een build). */
export function modelsDir(): string {
  const dir = candidates('public/models/devices', '.output/public/models/devices', 'public/models/devices').find((d) => existsSync(d));
  if (!dir) throw new AppError(503, 'De 3D-modellen ontbreken (public/models/devices).', 'device3d_models_missing');
  return dir;
}

async function modelData(file: string): Promise<string> {
  const hit = glbCache.get(file);
  if (hit) return hit;
  const b64 = (await readFile(path.join(modelsDir(), file))).toString('base64');
  glbCache.set(file, b64);
  return b64;
}

async function getPage(): Promise<Page> {
  if (pageP) {
    const p = await pageP.catch(() => null);
    if (p && !p.isClosed()) return p;
  }
  pageP = (async () => {
    if (!browserP) {
      browserP = (async () => {
        const { chromium } = await import('playwright-core');
        try {
          const b = await chromium.launch({
            executablePath: getConfig().chromiumPath || undefined,
            headless: true,
            // WebGL ook zonder grafische kaart (SwiftShader); op een computer met GPU gebruikt Chromium die.
            args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', '--mute-audio', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-webgl'],
          });
          b.on('disconnected', () => { browserP = null; pageP = null; });
          return b;
        } catch (e) {
          browserP = null;
          throw new AppError(503, 'De browser voor 3D-devices kon niet starten. Voer eenmalig "npm run browsers" uit en probeer het opnieuw.', 'browser_failed', String((e as Error).message));
        }
      })();
    }
    const b = await browserP;
    const page = await b.newPage();
    // Geen netwerk: alles wat de pagina nodig heeft, krijgt ze als data.
    await page.route('**/*', (route) => route.abort());
    page.on('pageerror', (e) => log.warn('device3d.page_error', { error: String(e) }));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: await renderPageCode() });
    return page;
  })();
  return pageP;
}

function scheduleClose() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => { void closeDeviceRenderer(); }, 60_000);
  idle.unref?.();
}

export async function closeDeviceRenderer() {
  if (idle) { clearTimeout(idle); idle = null; }
  const b = await browserP?.catch(() => null);
  browserP = null; pageP = null;
  await b?.close().catch(() => {});
}

export interface RenderDeviceInput {
  spec: Device3DSpec;
  /** Achtergrond (elk beeldformaat dat sharp leest). */
  background: Buffer;
  /** Langste zijde van het resultaat; groter wordt verkleind. */
  maxEdge?: number;
  /** Supersampling voor zachte randen (standaard 2). */
  supersample?: number;
}

/** Rendert het device op de achtergrond. Renders lopen na elkaar: één WebGL-context, voorspelbaar geheugen. */
export function renderDevice(input: RenderDeviceInput): Promise<DeviceRender> {
  const job = chain.then(() => renderNow(input));
  chain = job.catch(() => {});
  return job;
}

async function renderNow(input: RenderDeviceInput): Promise<DeviceRender> {
  const t0 = Date.now();
  const spec = clampDeviceSpec(input.spec);
  const model = findDeviceModel(spec.model);
  if (!model) throw new AppError(400, 'Onbekend 3D-model.', 'device3d_model');
  const maxEdge = input.maxEdge ?? 4096;
  const bg = await sharp(input.background).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer({ resolveWithObject: true });
  const { width, height } = bg.info;
  const env = `data:image/jpeg;base64,${(await sharp(bg.data).resize({ width: 512, height: 512, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`;
  const page = await getPage();
  let r: { layer: string; mask: string; quad: Quad; facing: boolean; light: LightEstimate; supersample: number };
  try {
    r = await page.evaluate((a) => (window as unknown as { __device3d: { render: (x: unknown) => Promise<typeof r> } }).__device3d.render(a), {
      glb: await modelData(model.file), modelKey: model.id, env, width, height, spec, supersample: input.supersample ?? 2,
    });
  } catch (e) {
    // Een vastgelopen pagina niet hergebruiken.
    pageP = null;
    throw new AppError(500, 'Het 3D-device kon niet gerenderd worden.', 'device3d_render', String((e as Error).message));
  } finally {
    scheduleClose();
  }
  const layer = Buffer.from(r.layer.split(',')[1]!, 'base64');
  const image = await sharp(bg.data).composite([{ input: layer }]).png().toBuffer();
  const mask = await sharp(Buffer.from(r.mask.split(',')[1]!, 'base64')).extractChannel(0).png().toBuffer();
  const visible = r.quad.filter(([x, y]) => x >= 0 && y >= 0 && x <= width && y <= height).length / 4;
  return { image, mask, quad: r.quad, facing: r.facing, visible, width, height, light: r.light, ms: Date.now() - t0 };
}
