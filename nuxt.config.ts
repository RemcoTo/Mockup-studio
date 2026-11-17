import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';

// De worker thread voor beeldwerk wordt apart gebundeld: in ontwikkeling naar .nuxt/workers,
// bij een productiebuild naast de server in .output/server/workers.
async function buildImagingWorker(outfile: string) {
  const { buildWorker } = await import('./scripts/build-worker.mjs');
  await buildWorker(outfile);
}
// De renderpagina voor 3D-devices (Three.js in headless Chromium): ook apart gebundeld, naast de worker.
async function buildDevicePage(outfile: string) {
  const { buildRenderPage } = await import('./scripts/build-devices.mjs');
  await buildRenderPage(outfile);
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  ssr: false,
  css: ['~/assets/css/main.css'],
  // Eigen composables en helpers worden overal expliciet geïmporteerd. Het automatisch doorzoeken van
  // mappen werkt met glob-patronen; staat het project in een map met haakjes in de naam (bijvoorbeeld
  // "mockup-studio (1)" na een tweede download op Windows), dan vinden die patronen niets en ontbreken
  // de functies pas tijdens het draaien. Framework-functies (ref, navigateTo, defineEventHandler) en
  // componenten blijven automatisch beschikbaar; die hangen niet van zo'n patroon af.
  imports: { scan: false },
  vite: { plugins: [tailwindcss()] },
  app: {
    head: {
      htmlAttrs: { lang: 'nl' },
      title: 'Mockup Studio',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  runtimeConfig: {
    dataDir: './data',
    imageProvider: 'demo',
    openaiApiKey: '',
    openaiImageModel: 'gpt-image-2',
    openaiBaseUrl: 'https://api.openai.com/v1',
    chromiumPath: '',
    captureMaxConcurrency: 2,
    captureAllowPrivate: false,
    uploadMaxMb: 40,
    appUrl: 'http://localhost:3000',
    appName: 'Mockup Studio',
    mailFrom: '',
    smtpUrl: '',
    allowSignup: true,
    requireEmailVerification: false,
    billingMode: 'off',
    aiDailyLimitUsd: 25,
    aiWorkspaceDailyLimitUsd: 5,
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    public: {},
  },
  nitro: {
    // Native en zware pakketten niet bundelen maar als afhankelijkheid meeleveren in .output/server/node_modules.
    externals: { external: ['sharp', 'playwright-core', '@napi-rs/canvas', 'pdfjs-dist', 'nodemailer', 'ffmpeg-static', 'stripe'] },
  },
  hooks: {
    'nitro:init'(nitro) {
      if (nitro.options.dev) {
        void buildImagingWorker(path.resolve(nitro.options.rootDir, '.nuxt/workers/imaging.mjs')).catch((e) => console.error('[worker]', e));
        void buildDevicePage(path.resolve(nitro.options.rootDir, '.nuxt/device3d/render-page.js')).catch((e) => console.error('[3d]', e));
      } else {
        nitro.hooks.hook('compiled', async () => {
          await buildImagingWorker(path.join(nitro.options.output.serverDir, 'workers/imaging.mjs'));
          await buildDevicePage(path.join(nitro.options.output.serverDir, 'device3d/render-page.js'));
          // De standaardlettertypen van pdf.js zijn geen JavaScript en worden niet automatisch meegenomen.
          const { cp } = await import('node:fs/promises');
          const from = path.resolve(nitro.options.rootDir, 'node_modules/pdfjs-dist/standard_fonts');
          await cp(from, path.join(nitro.options.output.serverDir, 'node_modules/pdfjs-dist/standard_fonts'), { recursive: true }).catch(() => {});
          // Lettertype voor mailschermen (interface rond de handtekening), naast de worker.
          const fonts = path.resolve(nitro.options.rootDir, 'node_modules/@fontsource-variable/schibsted-grotesk/files');
          for (const f of ['schibsted-grotesk-latin-wght-normal.woff2', 'schibsted-grotesk-latin-ext-wght-normal.woff2']) {
            await cp(path.join(fonts, f), path.join(nitro.options.output.serverDir, 'fonts', f)).catch(() => {});
          }
          // ffmpeg voor scrollvideo's: het pakket bevat een binary voor het eigen platform, die nft niet ziet.
          const ff = path.resolve(nitro.options.rootDir, 'node_modules/ffmpeg-static');
          await cp(ff, path.join(nitro.options.output.serverDir, 'node_modules/ffmpeg-static'), { recursive: true }).catch(() => {});
        });
      }
    },
  },
  typescript: { strict: true },
});
