// End-to-end test van de eerste versie in een echte browser.
// Vereist een draaiende server met de demoprovider en toegestane lokale adressen:
//   NUXT_IMAGE_PROVIDER=demo NUXT_CAPTURE_ALLOW_PRIVATE=true npm run dev
//   BASE_URL=http://localhost:3000 npm run test:e2e
// Optioneel: CHROMIUM_PATH voor een eigen Chromium-binary, SHOTS=map voor screenshots.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
const root = path.resolve(import.meta.dirname, '../../fixtures/site');

function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

// Met 'variant' aan toont de site een andere kop, om opnieuw vastleggen te testen.
let variant = false;
const site = createServer(async (req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : path.normalize(req.url ?? '').replace(/^(\.\.[/\\])+/, ''));
  try {
    let body: Buffer | string = await readFile(file);
    if (variant && file.endsWith('index.html')) body = body.toString().replace('</head>', '<style>h1{color:#c0392b!important}body{background:#f3efe6!important}</style></head>');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise<void>((r) => site.listen(8080, '127.0.0.1', r));
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: process.env.CHROMIUM_ARGS?.split(' ').filter(Boolean) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

try {
  step('eerste gebruiker registreert zich');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/registreren/);
  await page.getByLabel('Naam', { exact: true }).fill('Eva Eigenaar');
  await page.getByLabel('E-mailadres').fill(`eva+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Testbureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();

  step('project openen');
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const project = projects.find((p: { name: string }) => p.name.includes('Atelier Noord')) ?? projects[0];
  assert(project, 'er is een demoproject');
  await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: 'networkidle' });

  step('website importeren');
  await page.getByRole('tab', { name: 'Website importeren' }).click();
  await page.getByPlaceholder('https://voorbeeld.nl').fill('http://127.0.0.1:8080/');
  await page.getByRole('button', { name: 'Website vastleggen' }).click();
  await page.getByText('127.0.0.1 desktop.png').first().waitFor({ timeout: 90_000 });
  await shot('01-project-na-import');

  step('ontwerp kiezen en bibliotheekscène kiezen');
  const assets = await (await page.request.get(`${BASE}/api/assets?projectId=${project.id}`)).json();
  const captured = assets.find((a: { originalName: string }) => a.originalName.startsWith('127.0.0.1'));
  assert(captured, 'het screenshot staat in het project');
  assert(captured.width === 2880, 'screenshot op 2x resolutie van 1440 breed');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${captured.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('02-genereren-bibliotheek');
  // Exact deze scène; er zijn ook andere scènes met 'laptop' in de naam.
  await page.locator('button.scene', { has: page.locator('img[alt="Testscène laptop"]') }).click();
  await page.waitForURL(/\/editor\//, { timeout: 30_000 });

  step('editor: exacte weergave, hoeken, ongedaan maken');
  await page.getByText('Exacte weergave').waitFor({ timeout: 30_000 });
  await shot('03-editor');
  // Perspectief is standaard ingeklapt: openen en de hoeken aanpassen.
  const persp = page.locator('summary', { hasText: 'Perspectief' });
  if (!(await page.getByRole('button', { name: 'Hoeken aanpassen' }).isVisible())) await persp.click();
  await page.getByRole('button', { name: 'Hoeken aanpassen' }).click();
  const handle = page.locator('g.reg').first();
  const box = await handle.boundingBox();
  assert(box, 'hoekpunt zichtbaar');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Terugzetten', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Terugzetten', exact: true }).isEnabled(), 'aangepaste hoek geregistreerd');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert(!(await page.getByRole('button', { name: 'Terugzetten', exact: true }).isEnabled()), 'ongedaan maken zet de hoek terug');
  await page.getByRole('button', { name: 'Hoeken klaar' }).click();
  await page.getByText('Opgeslagen', { exact: true }).waitFor({ timeout: 15_000 });

  step('exporteren');
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Exporteren', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Downloaden', exact: true }).click();
  const file = await download;
  await page.keyboard.press('Escape');
  assert(/\.png$/.test(file.suggestedFilename()), 'PNG gedownload');
  await file.saveAs(path.join(SHOTS, 'export.png'));

  step('levende website: opnieuw vastleggen werkt de mockup bij');
  const mockupId = page.url().split('/editor/')[1]!;
  const previewBefore = (await (await page.request.get(`${BASE}/api/mockups/${mockupId}`)).json()).mockup?.previewFile;
  // Met mockups opent het project bij de mockups; de ontwerpen staan onder het eerste tabblad.
  await page.goto(`${BASE}/projects/${project.id}?tab=designs`, { waitUntil: 'networkidle' });
  const tile = page.locator('figure', { hasText: '127.0.0.1 desktop.png' }).first();
  await tile.getByRole('button', { name: /Meer acties/ }).click();
  await page.getByRole('menuitem', { name: 'Versies' }).click();
  await page.getByRole('dialog').getByText('Nog geen eerdere versies.').waitFor();
  // Ongewijzigde site: geen nieuwe versie.
  await page.getByRole('button', { name: 'Website opnieuw vastleggen' }).click();
  await page.getByText(/geen wijzigingen gevonden/).waitFor({ timeout: 90_000 });
  variant = true;
  await page.getByRole('button', { name: 'Website opnieuw vastleggen' }).click();
  await page.getByText(/mockup wordt bijgewerkt|mockups worden bijgewerkt/).waitFor({ timeout: 90_000 });
  await page.getByRole('dialog').getByText('Versie 1', { exact: true }).waitFor();
  const refreshSelect = page.getByRole('dialog').getByLabel('Automatisch bijwerken');
  if (await refreshSelect.isEnabled()) {
    await refreshSelect.selectOption('weekly');
    await page.getByText('elke week opnieuw vastgelegd').waitFor();
  } // Met betalen aan zit automatisch bijwerken niet in het gratis plan; dan is de keuze uitgeschakeld.
  await shot('04-versies');
  let updated = false;
  for (let i = 0; i < 30 && !updated; i++) {
    const m = await (await page.request.get(`${BASE}/api/mockups/${mockupId}`)).json();
    updated = !!m.mockup?.previewFile && m.mockup.previewFile !== previewBefore;
    if (!updated) await page.waitForTimeout(1000);
  }
  assert(updated, 'de preview van de mockup is opnieuw gerenderd');
  await page.keyboard.press('Escape');

  step('nieuwe scène genereren met de testprovider');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${captured.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Nieuwe scène met AI' }).click();
  await page.getByRole('button', { name: /scènes genereren|Scène genereren/ }).click();
  await page.getByRole('heading', { name: 'Varianten' }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot('05-varianten');

  step('uitloggen en weer inloggen');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Uitloggen' }).click();
  await page.waitForURL(/\/login/);
  const anon = await page.request.get(`${BASE}/api/projects`);
  assert(anon.status() === 401, 'zonder sessie geen toegang tot projecten');

  assert(!errors.length, `geen JavaScript-fouten (${errors.join('; ')})`);
  console.log('Alle stappen geslaagd.');
} catch (e) {
  await shot('fout').catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  site.close();
}
