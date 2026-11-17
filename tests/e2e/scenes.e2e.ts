// End-to-end test van de scèneworkflow in een echte browser: presets, scènetype, kleuren (met waarschuwing
// bij groen), platte achtergrond, genereren met de testprovider, en de nieuwe scène die direct onder Scènes
// staat met openen, hergebruiken en verwijderen.
//   BASE_URL=http://localhost:3000 node --experimental-strip-types tests/e2e/scenes.e2e.ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `scenes-${n}.png`), fullPage: false });

try {
  step('registreren');
  await page.goto(`${BASE}/registreren`, { waitUntil: 'networkidle' });
  await page.getByLabel('Naam', { exact: true }).fill('Sanne Scène');
  await page.getByLabel('E-mailadres').fill(`sanne+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Scènebureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();
  const project = (await (await page.request.get(`${BASE}/api/projects`)).json())[0];
  const before = (await (await page.request.get(`${BASE}/api/scenes?library=1`)).json()) as { id: string }[];

  step('configurator: preset, scènetype, ondergrond, props');
  await page.goto(`${BASE}/generate?project=${project.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  await page.getByRole('group', { name: 'Presets' }).getByRole('button', { name: /Warm interieur/ }).click();
  const prompt = page.locator('pre');
  await page.getByText('Prompt bekijken').click();
  await page.waitForFunction(() => /tidy contemporary interior/.test(document.querySelector('pre')?.textContent ?? ''));
  assert(/light oak wooden surface/.test(await prompt.textContent() ?? ''), 'preset zet de ondergrond');
  await page.getByRole('button', { name: /^Editorial Sfeer/ }).click();
  await page.getByRole('button', { name: 'Marmer', exact: true }).click();
  await page.getByRole('button', { name: 'Passend bij het merk' }).click();
  await page.waitForFunction(() => /editorial set/.test(document.querySelector('pre')?.textContent ?? '') && /marble/.test(document.querySelector('pre')?.textContent ?? ''));

  step('kleuren: groen wordt geweigerd, blauw komt in de prompt');
  // Een laptop is standaard een echt 3D-model (dan botst groen niet); hier de laptop door de AI, met het groene vlak.
  await page.locator('[data-section="device3d"]').getByRole('button', { name: /Door de AI/ }).click();
  const colors = page.locator('[data-section="colors"]');
  await colors.getByRole('button', { name: 'Kleur toevoegen' }).click();
  const hex = page.getByLabel('Kleur 1, HEX-code');
  await hex.fill('#2e7d32');
  await hex.press('Tab');
  await page.getByText(/lijkt te veel op het groene vlak/).first().waitFor();
  assert(await page.getByRole('button', { name: /scènes genereren|Scène genereren/ }).isDisabled(), 'genereren staat uit bij een groene kleur');
  await hex.fill('#2f5aa8');
  await hex.press('Tab');
  // Achtergrond Exact (standaard): sleutelscherm in de prompt; de studio zet de kleur er daarna in.
  await page.waitForFunction(() => /Background: the wall or backdrop behind the product is a flat, perfectly uniform chroma-key magenta/.test(document.querySelector('pre')?.textContent ?? ''));
  await colors.getByRole('button', { name: 'Kleur toevoegen' }).click();
  await page.getByLabel('Toepassing van kleur 2').selectOption('light');
  await page.waitForFunction(() => /Lighting color: .*accent light/.test(document.querySelector('pre')?.textContent ?? ''));
  await shot('01-configurator-scene');

  step('platte achtergrond: gradient uit de kleuren, met korrel');
  await page.getByRole('group', { name: 'Presets' }).getByRole('button', { name: /Verloop/ }).click();
  await page.getByLabel('Toepassing van kleur 1').selectOption('gradient');
  await page.getByLabel('Toepassing van kleur 2').selectOption('gradient');
  await hex.fill('#f1ece4');
  await hex.press('Tab');
  await page.getByLabel('Kleur 2, HEX-code').fill('#1e2a4a');
  await page.getByLabel('Kleur 2, HEX-code').press('Tab');
  await page.getByRole('button', { name: 'Diagonaal' }).click();
  await page.locator('[data-backdrop-source]').getByText(/Gradient uit je kleuren, diagonaal/).waitFor();
  await page.waitForFunction(() => /chroma-key magenta/.test(document.querySelector('pre')?.textContent ?? ''));
  await shot('02-configurator-plat');
  await page.locator('.segmented button', { hasText: /^1$/ }).first().click();
  await page.getByRole('button', { name: /Scène genereren/ }).click();

  step('genereren en meteen onder Scènes');
  await page.getByText(/staat in de bibliotheek onder Scènes/).waitFor({ timeout: 90_000 });
  await shot('03-resultaat');
  const after = (await (await page.request.get(`${BASE}/api/scenes?library=1`)).json()) as { id: string; title: string; config: { backdrop?: { color2?: string } } | null; workspaceId: string | null }[];
  const fresh = after.filter((s) => !before.some((b) => b.id === s.id));
  assert(fresh.length === 1, `precies één nieuwe scène in de bibliotheek (${fresh.length})`);
  const scene = fresh[0]!;
  assert(/verloop #f1ece4 naar #1e2a4a/.test(scene.title), `herkenbare titel (${scene.title})`);
  assert(scene.config?.backdrop?.color2 === '#1e2a4a', 'instellingen bij de scène bewaard');

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  const card = page.locator(`[data-scene="${scene.id}"]`);
  await card.waitFor();
  assert(await card.getByText('Nieuw').isVisible(), 'label Nieuw op de nieuwe scène');
  assert(await card.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), 'preview geladen');
  await shot('04-bibliotheek');

  step('hergebruiken: gebruiken voor een mockup');
  await card.getByRole('button', { name: `Acties voor ${scene.title}` }).click();
  await page.getByRole('menuitem', { name: 'Gebruiken voor een mockup' }).click();
  await page.waitForURL(/scene=/);
  await page.getByText('Gekozen in de bibliotheek.').waitFor();
  await page.getByRole('button', { name: 'In de editor openen' }).click();
  await page.waitForURL(/\/editor\//);
  await page.getByText('Exacte weergave').waitFor({ timeout: 60_000 });
  const mid = page.url().split('/editor/')[1]!;
  const m = (await (await page.request.get(`${BASE}/api/mockups/${mid}`)).json()).mockup;
  assert(m.sceneId === scene.id, 'mockup op de gekozen bibliotheekscène');
  await shot('05-editor');

  step('instellingen hergebruiken');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.locator(`[data-scene="${scene.id}"]`).getByRole('button', { name: `Acties voor ${scene.title}` }).click();
  await page.getByRole('menuitem', { name: 'Nieuwe scène met deze instellingen' }).click();
  await page.waitForURL(/fromScene=/);
  await page.getByText('Prompt bekijken').click();
  await page.waitForFunction(() => /chroma-key magenta/.test(document.querySelector('pre')?.textContent ?? ''));
  assert(await page.getByLabel('Kleur 2, HEX-code').inputValue() === '#1e2a4a', 'gradientkleur overgenomen');

  step('verwijderen uit Scènes');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.locator(`[data-scene="${scene.id}"]`).getByRole('button', { name: `Acties voor ${scene.title}` }).click();
  await page.getByRole('menuitem', { name: 'Verwijderen' }).click();
  await page.getByText('Scène verwijderd.').waitFor();
  assert(await page.locator(`[data-scene="${scene.id}"]`).count() === 0, 'scène weg uit de lijst');
  const gone = await page.request.get(`${BASE}/api/scenes/${scene.id}`);
  assert(gone.status() === 404, 'scène ook op de server verwijderd');

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
