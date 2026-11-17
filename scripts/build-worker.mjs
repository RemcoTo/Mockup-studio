// Bundelt de worker thread voor beeldwerk naar één ESM-bestand. Native pakketten blijven extern.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildWorker(outfile) {
  await build({
    entryPoints: [path.join(root, 'server/workers/imaging.worker.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['sharp', '@napi-rs/canvas'],
    sourcemap: false,
    logLevel: 'warning',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  return outfile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? path.join(root, '.nuxt/workers/imaging.mjs');
  await buildWorker(out);
  console.log(`worker gebouwd: ${path.relative(root, out)}`);
}
