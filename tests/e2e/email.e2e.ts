// End-to-end test van e-mailhandtekening-mockups in een echte browser: categorie in de bibliotheek, mockup
// maken, bericht, breedte en thema aanpassen in de editor, exporteren, en een scène met laptop en telefoon.
// Vereist een draaiende server met de demoprovider (zie workflow.e2e.ts):
//   BASE_URL=http://localhost:3000 node --experimental-strip-types tests/e2e/email.e2e.ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push(m.text()); });
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `email-${n}.png`) });
const api = async (url: string) => (await page.request.get(`${BASE}${url}`)).json();
const waitExact = () => page.getByText('Exacte weergave').waitFor({ timeout: 60_000 });

try {
  step('registreren');
  await page.goto(`${BASE}/registreren`, { waitUntil: 'networkidle' });
  await page.getByLabel('Naam', { exact: true }).fill('Mila Mail');
  await page.getByLabel('E-mailadres').fill(`mila+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Mailbureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();
  const project = (await api('/api/projects'))[0];
  const signature = (await api(`/api/projects/${project.id}`)).assets.find((a: { originalName: string }) => a.originalName === 'E-mailhandtekening.png');
  assert(signature, 'voorbeeldhandtekening in het voorbeeldproject');

  step('bibliotheek: eigen categorie, geen social media meer');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  assert(!(await page.getByRole('button', { name: 'Social media', exact: true }).count()), 'geen categorie social media');
  await page.getByRole('button', { name: 'E-mailhandtekening', exact: true }).click();
  await page.waitForTimeout(500);
  const count = await page.locator('button.scene').count();
  assert(count === 4, `vier e-mailscènes (gevonden: ${count})`);
  await shot('01-bibliotheek');

  step('mockup maken met de handtekening');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${signature.id}`, { waitUntil: 'networkidle' });
  assert(!(await page.locator('[aria-label="Wat presenteer je"]').count()), 'geen keuze voor social media in Nieuwe mockup');
  await page.getByRole('button', { name: 'E-mailhandtekening', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('button.scene img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 120_000 });
  await shot('02-nieuwe-mockup');
  await page.locator('button.scene', { has: page.locator('img[alt="Testscène laptop met e-mail"]') }).click();
  await page.waitForURL(/\/editor\//);
  await page.locator('[data-section="mail"]').waitFor();
  const id = page.url().split('/editor/')[1]!;
  let m = (await api(`/api/mockups/${id}`)).mockup;
  assert(m.placements[0].layout?.template === 'mail-desktop' && m.placements[0].layout.slots[0].assetId === signature.id, 'laptop toont de e-mail met de handtekening');
  await waitExact();
  await shot('03-editor-laptop');

  step('bericht, breedte en donkere modus aanpassen');
  await page.getByLabel('Afzender').fill('Femke de Vries');
  await page.getByLabel('E-mailadres').fill('femke@ateliernoord.nl');
  await page.getByLabel('Onderwerp').fill('Ontwerpen voor de nieuwe showroom');
  await page.getByLabel('Onderwerp').press('Tab');
  const slider = page.locator('#sig-width');
  assert(await slider.inputValue() === '420', `ware grootte uit het bestand (${await slider.inputValue()})`);
  await slider.fill('360');
  await slider.dispatchEvent('change');
  await page.locator('[data-section="mail"]').getByRole('button', { name: 'Donker' }).click();
  await page.getByText('Opgeslagen').waitFor({ timeout: 15_000 });
  for (let t = 0; t < 20; t++) {
    m = (await api(`/api/mockups/${id}`)).mockup;
    if (m.placements[0].layout.theme === 'dark' && m.placements[0].layout.mail?.subject) break;
    await page.waitForTimeout(500);
  }
  const lay = m.placements[0].layout;
  assert(lay.mail.fromName === 'Femke de Vries' && lay.mail.subject === 'Ontwerpen voor de nieuwe showroom', 'berichtvelden opgeslagen');
  assert(lay.signatureWidth === 360 && lay.theme === 'dark', 'breedte en thema opgeslagen');
  await waitExact();
  await shot('04-editor-donker');
  await page.locator('[data-section="mail"]').getByRole('button', { name: 'Ware grootte' }).click();
  await page.locator('[data-section="mail"]').getByRole('button', { name: 'Licht' }).click();
  await waitExact();

  step('exporteren');
  await page.getByRole('button', { name: 'Exporteren' }).click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: 'Downloaden' }).click()]);
  await download.saveAs(path.join(SHOTS, 'email-export.png'));
  await page.keyboard.press('Escape');

  step('zonder e-mail en terug');
  await page.getByRole('button', { name: 'Zonder e-mail tonen' }).click();
  await page.locator('[data-section="placement"]').waitFor();
  await page.getByRole('button', { name: 'Als e-mailhandtekening tonen' }).click();
  await page.locator('[data-section="mail"]').waitFor();

  step('laptop en telefoon: één bericht op beide schermen');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${signature.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'E-mailhandtekening', exact: true }).click();
  await page.locator('button.scene', { has: page.locator('img[alt="Testscène laptop en smartphone"]') }).click();
  await page.waitForURL(/\/editor\//);
  await page.locator('[data-section="mail"]').waitFor();
  const id2 = page.url().split('/editor/')[1]!;
  await page.getByLabel('Onderwerp').fill('Tot dinsdag');
  await page.getByLabel('Onderwerp').press('Tab');
  await page.getByText('Opgeslagen').waitFor({ timeout: 15_000 });
  let m2 = (await api(`/api/mockups/${id2}`)).mockup;
  for (let t = 0; t < 20 && !m2.placements.every((p: { layout: { mail?: { subject?: string } } }) => p.layout.mail?.subject === 'Tot dinsdag'); t++) { await page.waitForTimeout(500); m2 = (await api(`/api/mockups/${id2}`)).mockup; }
  const templates = m2.placements.map((p: { layout: { template: string } }) => p.layout.template).sort();
  assert(JSON.stringify(templates) === JSON.stringify(['mail-desktop', 'mail-mobile']), `laptop en telefoon elk in hun eigen weergave (${templates})`);
  assert(m2.placements.every((p: { layout: { mail?: { subject?: string } } }) => p.layout.mail?.subject === 'Tot dinsdag'), 'het onderwerp staat op beide schermen');
  await waitExact();
  await shot('05-editor-laptop-en-telefoon');

  assert(errors.length === 0, `geen fouten in de browser: ${errors.join(' | ')}`);
  console.log('Alles geslaagd.');
} catch (e) {
  await shot('fout').catch(() => {});
  console.error(e);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
