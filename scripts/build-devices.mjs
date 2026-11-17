// 3D-devices: bundelt de renderpagina voor de server, en exporteert de devicemodellen als GLB.
//   node scripts/build-devices.mjs models   -> public/models/devices/*.glb (opnieuw opbouwen uit de code)
//   node scripts/build-devices.mjs page     -> .nuxt/device3d/render-page.js
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function bundle(entry) {
  const r = await build({ entryPoints: [path.join(root, entry)], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, minify: true, logLevel: 'warning' });
  return r.outputFiles[0].text;
}

/** De pagina die de server in headless Chromium laadt om devices te renderen. */
export async function buildRenderPage(outfile) {
  await mkdir(path.dirname(outfile), { recursive: true });
  await writeFile(outfile, await bundle('shared/device3d/render-page.ts'));
  return outfile;
}

/** Bouwt de modellen in code en schrijft ze als GLB. */
export async function exportModels(outDir = path.join(root, 'public/models/devices')) {
  const { chromium } = await import('playwright-core');
  const code = await bundle('shared/device3d/models/export-page.ts');
  const browser = await chromium.launch({ executablePath: process.env.NUXT_CHROMIUM_PATH || process.env.CHROMIUM_PATH || undefined, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: code });
    const models = await page.evaluate(() => window.__exportModels());
    await mkdir(outDir, { recursive: true });
    const written = [];
    for (const [id, b64] of Object.entries(models)) {
      const file = path.join(outDir, `${id}.glb`);
      await writeFile(file, Buffer.from(b64, 'base64'));
      written.push(`${id}.glb (${Math.round(Buffer.from(b64, 'base64').length / 1024)} kB)`);
    }
    return written;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const what = process.argv[2] ?? 'all';
  if (what === 'models' || what === 'all') console.log('modellen:', (await exportModels()).join(', '));
  if (what === 'page' || what === 'all') console.log('renderpagina:', path.relative(root, await buildRenderPage(path.join(root, '.nuxt/device3d/render-page.js'))));
}
