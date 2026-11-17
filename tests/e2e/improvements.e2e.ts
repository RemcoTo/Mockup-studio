// End-to-end test in een echte browser: afmetingen van het ontwerp bij generatie, referentiebeelden bij een
// Brand Shoot, website-import met en zonder volledige pagina, en configuraties verwijderen.
// Vereist een draaiende server met de demoprovider en toegestane lokale adressen (zie workflow.e2e.ts):
//   BASE_URL=http://localhost:3000 node --experimental-strip-types tests/e2e/improvements.e2e.ts
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

// Een lange pagina (20 blokken van 600 px) om "Volledige pagina" mee te testen.
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lange pagina</title></head><body style="margin:0;font:32px sans-serif">${Array.from({ length: 20 }, (_, i) => `<section style="height:600px;display:grid;place-items:center;background:hsl(${i * 36},35%,75%)">Blok ${i + 1}</section>`).join('')}</body></html>`);
});
await new Promise<void>((r) => site.listen(8080, '127.0.0.1', r));
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|404/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `verbeteringen-${n}.png`) });
const api = async (url: string) => (await page.request.get(`${BASE}${url}`)).json();

try {
  step('registreren');
  await page.goto(`${BASE}/registreren`, { waitUntil: 'networkidle' });
  await page.getByLabel('Naam', { exact: true }).fill('Vera Verbeter');
  await page.getByLabel('E-mailadres').fill(`vera+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Verbeterbureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();
  const project = (await api('/api/projects'))[0];

  step('staand visitekaartje van 550 × 850 px uploaden');
  await page.goto(`${BASE}/projects/${project.id}?tab=designs`, { waitUntil: 'networkidle' });
  const card = await sharp({ create: { width: 550, height: 850, channels: 3, background: '#1f3b33' } })
    .composite([{ input: await sharp({ create: { width: 550, height: 300, channels: 3, background: '#e9e3da' } }).png().toBuffer(), top: 550, left: 0 }]).png().toBuffer();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'Visitekaartje staand.png', mimeType: 'image/png', buffer: card });
  await page.getByText('Visitekaartje staand.png').first().waitFor({ timeout: 30_000 });
  const asset = (await api(`/api/projects/${project.id}`)).assets.find((a: { originalName: string }) => a.originalName === 'Visitekaartje staand.png');
  assert(asset?.width === 550 && asset.height === 850, 'ontwerp van 550 × 850 px');

  step('nieuwe AI-scène: afmetingen overgenomen, verhouding getoond, in de prompt');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${asset.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  await page.getByRole('button', { name: /Branding en drukwerk/ }).click();
  await page.getByRole('button', { name: 'Visitekaartje', exact: true }).click();
  const width = page.getByLabel('Breedte in pixels');
  const height = page.getByLabel('Hoogte in pixels');
  assert(await width.inputValue() === '550' && await height.inputValue() === '850', `afmetingen van het ontwerp overgenomen (${await width.inputValue()} × ${await height.inputValue()})`);
  const summary = page.locator('[data-size-summary]');
  await summary.getByText('Verhouding 11:17').waitFor();
  await summary.getByText('Staand', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Breedte en hoogte wisselen' }).click();
  await summary.getByText('Liggend', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Breedte en hoogte wisselen' }).click();
  await summary.getByText('Staand', { exact: true }).waitFor();
  await height.fill('5');
  await page.getByText(/Gebruik hele pixels tussen 16/).waitFor();
  await height.fill('850');
  await page.locator('summary', { hasText: 'Prompt bekijken' }).click();
  await page.locator('pre', { hasText: 'ratio of exactly 550:850 (11:17)' }).waitFor({ timeout: 10_000 });
  await page.getByText('Afmetingen van je ontwerp').scrollIntoViewIfNeeded();
  await shot('01-afmetingen');
  await page.locator('aside .segmented button', { hasText: /^1$/ }).click();
  await page.getByRole('button', { name: /Scène genereren/ }).click();
  await page.getByRole('link', { name: /Bewerken|Openen in de editor|Openen/ }).first().waitFor({ timeout: 90_000 }).catch(() => {});
  let gen: { id: string; status: string; config: { designSize?: { width: number; height: number } }; mockupIds: string[] } | undefined;
  for (let t = 0; t < 60; t++) {
    gen = (await api(`/api/projects/${project.id}`)).generations[0];
    if (gen?.status === 'done' || gen?.status === 'failed') break;
    await page.waitForTimeout(1000);
  }
  assert(gen?.status === 'done', `generatie klaar (${gen?.status})`);
  assert(gen.config.designSize?.width === 550 && gen.config.designSize.height === 850, 'afmetingen opgeslagen in de configuratie');
  const m = (await api(`/api/mockups/${gen.mockupIds[0]}`)).mockup;
  assert(m.placements.every((p: { transform: { fit: string } }) => p.transform.fit === 'contain'), 'ontwerp past zonder bijsnijden of uitrekken');
  await page.goto(`${BASE}/editor/${m.id}`, { waitUntil: 'networkidle' });
  await page.getByText('Exacte weergave').waitFor({ timeout: 60_000 });
  await shot('02-staand-kaartje-in-editor');

  step('configuratie verwijderen');
  await page.goto(`${BASE}/projects/${project.id}?tab=configs`, { waitUntil: 'networkidle' });
  const scenesBefore = (await api(`/api/projects/${project.id}`)).scenes.length;
  await page.getByRole('button', { name: /^Configuratie Visitekaartje .* verwijderen$/ }).click();
  await page.getByText('Configuratie verwijderd.').waitFor();
  const after = await api(`/api/projects/${project.id}`);
  assert(after.generations.length === 0, 'configuratie weg uit de lijst en de database');
  assert(after.scenes.length === scenesBefore, 'scènes uit de configuratie blijven bewaard');
  assert((await page.request.get(`${BASE}/api/generations/${gen.id}`)).status() === 404, 'configuratie is niet meer op te vragen');
  assert(after.mockups.some((x: { id: string }) => x.id === m.id), 'mockup blijft bewaard');

  step('brand shoot met referentiebeelden');
  await page.goto(`${BASE}/shoot?project=${project.id}`, { waitUntil: 'networkidle' });
  const refs = await Promise.all(['#cdb9a0', '#2f3a34'].map((c) => sharp({ create: { width: 900, height: 600, channels: 3, background: c } }).jpeg().toBuffer()));
  const refSection = page.locator('section', { has: page.getByRole('heading', { name: /Referentiebeelden/ }) });
  await refSection.locator('input[type="file"]').setInputFiles([
    { name: 'sfeer-zand.jpg', mimeType: 'image/jpeg', buffer: refs[0]! },
    { name: 'sfeer-groen.jpg', mimeType: 'image/jpeg', buffer: refs[1]! },
  ]);
  const chosen = page.getByRole('list', { name: 'Gekozen referentiebeelden' }).locator('li');
  await chosen.nth(1).waitFor({ timeout: 30_000 });
  assert(await chosen.count() === 2, 'twee referentiebeelden met preview');
  await page.getByText('Gebruik de referenties voor').waitFor();
  await refSection.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await shot('03-shoot-referenties');
  const removed = (await api(`/api/projects/${project.id}`)).assets.find((a: { originalName: string }) => a.originalName === 'sfeer-zand.jpg');
  await page.getByRole('button', { name: 'sfeer-zand.jpg verwijderen' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Gekozen referentiebeelden"] li').length === 1);
  await page.waitForTimeout(500);
  assert(!(await api(`/api/projects/${project.id}`)).assets.some((a: { id: string }) => a.id === removed.id), 'verwijderde referentie is ook uit de opslag weg');
  await page.getByRole('button', { name: /Shoot starten/ }).click();
  await page.getByText(/klaar/).first().waitFor({ timeout: 30_000 });
  let gens: { status: string; config: { referenceAssetIds?: string[]; series?: unknown } }[] = [];
  for (let t = 0; t < 90; t++) {
    gens = (await api(`/api/projects/${project.id}`)).generations;
    if (gens.length && gens.every((g) => g.status === 'done' || g.status === 'failed')) break;
    await page.waitForTimeout(1000);
  }
  const kept = (await api(`/api/projects/${project.id}`)).assets.find((a: { originalName: string }) => a.originalName === 'sfeer-groen.jpg');
  assert(gens.length > 1 && gens.every((g) => g.status === 'done'), `serie klaar (${gens.map((g) => g.status).join(', ')})`);
  assert(gens.every((g) => JSON.stringify(g.config.referenceAssetIds) === JSON.stringify([kept.id])), 'elk beeld van de serie krijgt de referentie mee');

  step('website importeren zonder en met volledige pagina');
  await page.goto(`${BASE}/projects/${project.id}?tab=designs`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Website importeren' }).click();
  await page.getByPlaceholder('https://voorbeeld.nl').fill('http://127.0.0.1:8080/');
  await page.getByRole('button', { name: 'Website vastleggen' }).click();
  await page.getByText('127.0.0.1 desktop.png').first().waitFor({ timeout: 90_000 });
  for (const vp of ['Desktop', 'Smartphone']) {
    await page.getByRole('button', { name: vp, exact: true }).click();
    const box = page.getByLabel('Volledige pagina');
    if (!(await box.isChecked())) await box.check();
    await page.getByRole('button', { name: 'Website vastleggen' }).click();
    await page.getByText(`127.0.0.1 ${vp.toLowerCase()} volledig.png`).first().waitFor({ timeout: 120_000 });
  }
  assert(!(await page.locator('.notice-error').count()), 'geen foutmelding bij volledige pagina');
  const full = (await api(`/api/projects/${project.id}`)).assets.filter((a: { originalName: string }) => a.originalName.includes('volledig'));
  const phone = full.find((a: { originalName: string }) => a.originalName.includes('smartphone'));
  assert(phone?.height === 36000 && phone.width === 1170, `smartphone, hele pagina van 12.000 px op 3× (${phone?.width} × ${phone?.height})`);
  await shot('04-website-volledig');

  assert(errors.length === 0, `geen fouten in de browser: ${errors.join(' | ')}`);
  console.log('Alles geslaagd.');
} catch (e) {
  await shot('fout').catch(() => {});
  console.error(e);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  site.close();
}
