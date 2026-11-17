/// <reference lib="dom" />
// De DOM-typen zijn nodig voor code die in de browser van Playwright draait (page.evaluate).
// Legt een website vast zoals een bezoeker hem ziet: echte browser, echte rendering, geen AI.
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { assertPublicHost, checkReachable } from './ssrf';
import { egressProxy } from './egress';
import { COOKIE_HIDE_CSS, dismissCookieBanners } from './cookies';

export type ViewportId = 'desktop' | 'laptop' | 'tablet' | 'smartphone';

export const VIEWPORTS: Record<ViewportId, { label: string; width: number; height: number; scale: number; mobile: boolean }> = {
  desktop: { label: 'Desktop', width: 1440, height: 900, scale: 2, mobile: false },
  laptop: { label: 'Laptop', width: 1280, height: 800, scale: 2, mobile: false },
  tablet: { label: 'Tablet', width: 820, height: 1180, scale: 2, mobile: true },
  smartphone: { label: 'Smartphone', width: 390, height: 844, scale: 3, mobile: true },
};

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TABLET_UA = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
/** Langste volledige pagina in CSS-pixels; daarboven wordt afgesneden om geheugen te sparen. */
const MAX_FULL_PAGE_HEIGHT = 14_000;

export interface CaptureRequest {
  url: string;
  viewport: ViewportId;
  fullPage: boolean;
  hideCookieBanners: boolean;
  /** Extra wachttijd na het laden, voor animaties en lazy loading. */
  delayMs?: number;
}

export interface CaptureResult {
  png: Buffer;
  width: number;
  height: number;
  finalUrl: string;
  title: string;
  warnings: string[];
}

let browserPromise: Promise<Browser> | null = null;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  const max = Math.max(1, getConfig().captureMaxConcurrency);
  if (active < max) { active++; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.isConnected()) return b;
  }
  browserPromise = (async () => {
    const { chromium } = await import('playwright-core');
    try {
      // Alle verkeer van de browser via de eigen egress-proxy; '<-loopback>' zorgt dat ook localhost erdoor gaat.
      const proxy = await egressProxy();
      const b = await chromium.launch({
        executablePath: getConfig().chromiumPath || undefined,
        headless: true,
        proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' },
        args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio', '--hide-scrollbars'],
      });
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    } catch (e) {
      browserPromise = null;
      const msg = String((e as Error).message);
      if (/Executable doesn't exist|executable/i.test(msg)) {
        throw new AppError(503, 'De browser voor website-import is niet geïnstalleerd. Voer eenmalig "npm run browsers" uit en probeer het opnieuw.', 'browser_missing', msg);
      }
      throw new AppError(503, 'De browser voor website-import kon niet starten.', 'browser_failed', msg);
    }
  })();
  return browserPromise;
}

export async function closeBrowser() {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

async function guardContext(context: BrowserContext) {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    let u: URL;
    try { u = new URL(url); } catch { return route.abort('blockedbyclient'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort('blockedbyclient');
    try {
      await assertPublicHost(u.hostname);
    } catch {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  // WebSockets zijn voor een screenshot niet nodig en zijn lastig te controleren: blokkeer ze.
  await context.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: 'blocked' }));
}

async function settle(page: Page, fullPage: boolean, delayMs: number) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  if (fullPage) {
    // Rustig naar beneden scrollen zodat lazy-loaded beelden en scroll-animaties hun eindtoestand bereiken.
    await page.evaluate(async (max) => {
      const step = Math.max(300, window.innerHeight * 0.8);
      const end = Math.min(document.documentElement.scrollHeight, max);
      for (let y = 0; y < end; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    }, MAX_FULL_PAGE_HEIGHT).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(Math.min(10_000, Math.max(300, delayMs)));
}

export async function captureWebsite(req: CaptureRequest): Promise<CaptureResult> {
  const vp = VIEWPORTS[req.viewport];
  if (!vp) throw new AppError(400, 'Onbekende viewport.');
  const reach = await checkReachable(req.url);
  const warnings: string[] = [];
  if (reach.redirected) warnings.push(`Doorgestuurd naar ${reach.url}.`);

  await acquire();
  const browser = await getBrowser().catch((e) => { release(); throw e; });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.scale,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    userAgent: req.viewport === 'smartphone' ? MOBILE_UA : req.viewport === 'tablet' ? TABLET_UA : undefined,
    locale: 'nl-NL',
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
    colorScheme: 'light',
  });
  try {
    await guardContext(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    let response;
    try {
      response = await page.goto(reach.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      const msg = String((e as Error).message);
      if (/timeout/i.test(msg)) throw new AppError(504, 'De website laadde niet binnen dertig seconden. Probeer het opnieuw of upload zelf een screenshot.', 'capture_timeout');
      if (/ERR_BLOCKED_BY_CLIENT/.test(msg)) throw new AppError(422, 'Deze website verwijst naar een intern adres en kan niet worden geïmporteerd.', 'url_private');
      throw new AppError(422, 'De website kon niet worden geopend. Upload zelf een screenshot als dit blijft gebeuren.', 'capture_failed', msg);
    }
    const status = response?.status() ?? 0;
    await settle(page, req.fullPage, req.delayMs ?? 800);

    const title = await page.title().catch(() => '');
    const bodyText = (await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? '').catch(() => '')).toLowerCase();
    if ((status === 403 || status === 429 || status === 503) && /just a moment|attention required|captcha|verify you are human|access denied|ddos/i.test(title + ' ' + bodyText)) {
      throw new AppError(422, 'Deze website blokkeert geautomatiseerde browsers. Maak zelf een screenshot en upload die.', 'capture_blocked');
    }
    if (status >= 400) warnings.push(`De website antwoordde met status ${status}. Controleer of het vastgelegde beeld klopt.`);
    const hasPassword = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (hasPassword || /\/(login|signin|sign-in|inloggen|account\/login)/i.test(new URL(page.url()).pathname)) {
      warnings.push('Deze pagina lijkt een inlogscherm. Pagina’s achter een login kunnen niet worden vastgelegd; upload dan zelf een screenshot.');
    }

    if (req.hideCookieBanners) {
      await page.addStyleTag({ content: COOKIE_HIDE_CSS }).catch(() => {});
      const removed = await dismissCookieBanners(page);
      if (removed) await page.waitForTimeout(400);
    }

    let png: Buffer;
    try {
      if (req.fullPage) {
        const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
        // Een lange pagina vastleggen duurt langer dan een scherm; ruim de tijd nemen in plaats van de standaard 20 seconden.
        const opts = { type: 'png' as const, fullPage: true, animations: 'disabled' as const, caret: 'hide' as const, timeout: 90_000 };
        if (height > MAX_FULL_PAGE_HEIGHT) {
          warnings.push(`De pagina is langer dan ${MAX_FULL_PAGE_HEIGHT.toLocaleString('nl-NL')} pixels en is onderaan afgesneden.`);
          png = await page.screenshot({ ...opts, clip: { x: 0, y: 0, width: vp.width, height: MAX_FULL_PAGE_HEIGHT } });
        } else {
          png = await page.screenshot(opts);
        }
      } else {
        png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout: 30_000 });
      }
    } catch (e) {
      const msg = String((e as Error).message);
      if (/timeout/i.test(msg)) throw new AppError(504, 'Het vastleggen van de pagina duurde te lang. Probeer het opnieuw zonder "Volledige pagina", of met een kortere wachttijd.', 'capture_timeout', msg);
      throw new AppError(422, 'De pagina kon niet worden vastgelegd. Probeer het opnieuw of upload zelf een screenshot.', 'capture_failed', msg);
    }
    const sharp = (await import('sharp')).default;
    const meta = await sharp(png).metadata();
    return { png, width: meta.width ?? 0, height: meta.height ?? 0, finalUrl: page.url(), title, warnings };
  } finally {
    await context.close().catch(() => {});
    release();
  }
}
