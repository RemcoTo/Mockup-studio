// End-to-end test van de kleuren in een echte browser: meerdere kleuren toevoegen, per kleur een toepassing kiezen,
// verwijderen, een gradient met richting en volgorde, de controle op groen (met uitwijken naar een leeg vlak),
// genereren met de testprovider, onthouden per project, en dezelfde kleuren in Brand Shoot.
//   BASE_URL=http://localhost:3000 node --experimental-strip-types tests/e2e/palette.e2e.ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push(m.text()); });
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `palette-${n}.png`) });
const promptText = () => page.locator('pre').textContent().then((t) => t ?? '');
const waitPrompt = (re: RegExp) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('pre')?.textContent ?? ''), re.source);
/** Wacht tot het aantal kleurregels klopt (de interface werkt na een klik bij). */
const rowsAre = (n: number, scope = '[data-section="colors"]', timeout = 5000) => page.waitForFunction(([sel, k]) => document.querySelectorAll(`${sel} .row`).length === k, [scope, n] as const, { timeout }).then(() => true, () => false);
const generateBtn = () => page.getByRole('button', { name: /scènes genereren|Scène genereren/ });

try {
  step('registreren');
  await page.goto(`${BASE}/registreren`, { waitUntil: 'networkidle' });
  await page.getByLabel('Naam', { exact: true }).fill('Kees Kleur');
  await page.getByLabel('E-mailadres').fill(`kees+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Kleurbureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();
  const project = (await (await page.request.get(`${BASE}/api/projects`)).json())[0];

  step('drie kleuren met elk een toepassing');
  await page.goto(`${BASE}/generate?project=${project.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  await page.getByRole('group', { name: 'Presets' }).getByRole('button', { name: /Rustige studio/ }).click();
  // Een laptop is standaard een echt 3D-model; deze test gaat over het groene ontwerpvlak, dus de laptop door de AI.
  await page.locator('[data-section="device3d"]').getByRole('button', { name: /Door de AI/ }).click();
  await page.getByText('Prompt bekijken').click();
  const colors = page.locator('[data-section="colors"]');
  const add = colors.getByRole('button', { name: 'Kleur toevoegen' });
  const setHex = async (n: number, v: string) => { const f = page.getByLabel(`Kleur ${n}, HEX-code`); await f.fill(v); await f.press('Tab'); };
  await add.click();
  await page.getByLabel('Toepassing van kleur 1').selectOption('ground');
  await setHex(1, '#243B32');
  await add.click();
  assert(await page.getByLabel('Toepassing van kleur 2').inputValue() === 'background', 'tweede kleur begint als achtergrond');
  await setHex(2, '#E8E1D5');
  await add.click();
  assert(await page.getByLabel('Toepassing van kleur 3').inputValue() === 'accent', 'derde kleur begint als accent');
  await setHex(3, '#F28C28');
  assert(await page.getByLabel('Kleur 1, HEX-code').inputValue() === '#243b32', 'HEX genormaliseerd');

  step('donkergroen botst met automatisch vinden; uitwijken naar een leeg vlak');
  await colors.getByText(/#243b32 lijkt te veel op het groene vlak/).waitFor();
  assert(await generateBtn().isDisabled(), 'genereren uit bij een kleur die op het groene vlak lijkt');
  assert(await colors.locator('.row.conflict').count() === 1, 'de botsende kleur is gemarkeerd');
  await colors.getByRole('button', { name: 'Leeg vlak gebruiken' }).click();
  await waitPrompt(/Target surface: .* completely blank/);
  assert(!(await colors.getByText(/lijkt te veel op het groene vlak/).count()), 'waarschuwing weg met een leeg vlak');
  await waitPrompt(/- Ground: .*#243b32/);
  const p1 = await promptText();
  const line = (label: string) => p1.split('\n').find((l) => l.startsWith(`- ${label}:`)) ?? '';
  assert(/#243b32/.test(line('Ground')) && !/#e8e1d5|#f28c28/.test(line('Ground')), 'donkergroen alleen op de ondergrond');
  // Achtergrond Exact (standaard): het model krijgt een sleutelscherm en de kleur niet te zien; de studio zet hem erin.
  const modes = colors.locator('[data-background-mode]');
  assert(await modes.getByRole('button', { name: 'Exact' }).getAttribute('aria-pressed') === 'true', 'achtergrond staat standaard op Exact');
  assert(/chroma-key magenta/.test(p1) && !p1.includes('#e8e1d5'), 'exacte achtergrond: sleutelscherm, kleur niet in de prompt');
  await modes.getByRole('button', { name: 'Door de AI' }).click();
  await waitPrompt(/- Background color \(a fixed brand color, not a suggestion\): .*exactly #e8e1d5 \(RGB 232, 225, 213\)/);
  const p2 = await promptText();
  assert(!/magenta/.test(p2), 'Door de AI: geen sleutelscherm');
  const bgLine = p2.split('\n').find((l) => l.startsWith('- Background color')) ?? '';
  assert(!/#243b32|#f28c28/.test(bgLine), 'lichtbeige alleen op de achtergrond');
  await colors.scrollIntoViewIfNeeded();
  await colors.screenshot({ path: path.join(SHOTS, 'palette-00-door-de-ai.png') });
  await modes.getByRole('button', { name: 'Exact' }).click();
  await page.waitForFunction(() => /chroma-key magenta/.test(document.querySelector('pre')?.textContent ?? ''));
  assert(/#f28c28/.test(line('Accent color')) && !/#243b32|#e8e1d5/.test(line('Accent color')), 'oranje alleen als accent');
  await colors.scrollIntoViewIfNeeded();
  await colors.screenshot({ path: path.join(SHOTS, 'palette-01-kleuren.png') });

  step('kleur toevoegen en verwijderen');
  await add.click();
  await page.getByLabel('Toepassing van kleur 4').selectOption('props');
  assert(await rowsAre(4), 'vier kleuren');
  await colors.getByRole('button', { name: 'Kleur 4 verwijderen' }).click();
  assert(await rowsAre(3), 'terug naar drie kleuren');

  step('gradient: controle, richting en volgorde');
  await add.click();
  await page.getByLabel('Toepassing van kleur 4').selectOption('gradient');
  await colors.getByText(/minstens twee kleuren/).waitFor();
  assert(await generateBtn().isDisabled(), 'genereren uit bij een gradient met één kleur');
  await setHex(4, '#1e2a4a');
  await page.getByLabel('Toepassing van kleur 2').selectOption('gradient');
  await colors.locator('[data-gradient]').waitFor();
  assert(!(await colors.getByText(/minstens twee kleuren/).count()), 'gradient met twee kleuren is geldig');
  // De volgorde en richting staan in de prompt als de AI de achtergrond maakt; bij Exact zet de studio het verloop.
  await modes.getByRole('button', { name: 'Door de AI' }).click();
  await colors.getByRole('button', { name: 'Van links naar rechts' }).click();
  await waitPrompt(/left to right: .*#e8e1d5\) on the left.*#1e2a4a\) on the right/);
  await colors.getByRole('button', { name: 'Volgorde omdraaien' }).click();
  await waitPrompt(/left to right: .*#1e2a4a\) on the left.*#e8e1d5\) on the right/);
  await add.click();
  await page.getByLabel('Toepassing van kleur 5').selectOption('background');
  await colors.getByText(/óf een gradient/).waitFor();
  await colors.getByRole('button', { name: 'Kleur 5 verwijderen' }).click();
  assert(!(await colors.getByText(/óf een gradient/).count()), 'probleem weg na verwijderen');
  await colors.scrollIntoViewIfNeeded();
  await colors.screenshot({ path: path.join(SHOTS, 'palette-02-gradient.png') });

  step('platte achtergrond volgt de gradient');
  await modes.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: 'Platte achtergrond', exact: true }).click();
  await page.locator('[data-backdrop-source]').getByText(/Gradient uit je kleuren, van links naar rechts/).waitFor();
  assert(await colors.getByText('Telt niet bij een platte achtergrond').count() === 2, 'ondergrond en accent tellen niet bij een platte achtergrond');
  await page.getByRole('button', { name: 'Scène', exact: true }).click();

  step('genereren met de testprovider');
  await page.locator('.segmented button', { hasText: /^1$/ }).first().click();
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST'), generateBtn().click()]);
  const gen = await resp.json();
  assert(gen.config.palette.colors.length === 4, 'palet opgeslagen bij de generatie');
  let done = gen;
  for (let t = 0; t < 120 && !['done', 'failed'].includes(done.status); t++) {
    await page.waitForTimeout(750);
    done = (await (await page.request.get(`${BASE}/api/generations/${gen.id}`)).json()).generation;
  }
  assert(done.status === 'done', `generatie klaar (${done.status})`);
  assert(/- Ground: .*#243b32/.test(done.prompt) && /- Accent color: .*#f28c28/.test(done.prompt) && /chroma-key magenta/.test(done.prompt) && !done.error, 'prompt van de generatie bevat de kleuren per toepassing en de exacte achtergrond is gezet');

  step('onthouden per project');
  await page.goto(`${BASE}/generate?project=${project.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  // Ruimere wachttijd: het live 3D-voorbeeld van de laptop compileert zijn shaders hier zonder grafische kaart.
  assert(await rowsAre(4, undefined, 30_000), 'kleuren terug na opnieuw openen');
  assert(await page.getByLabel('Kleur 1, HEX-code').inputValue() === '#243b32', 'eerste kleur onthouden');

  step('Brand Shoot: dezelfde kleuren, controle op groen');
  await page.goto(`${BASE}/shoot?project=${project.id}`, { waitUntil: 'networkidle' });
  const sc = page.locator('[data-section="colors"]');
  await sc.locator('.row').first().waitFor();
  assert(await rowsAre(4), 'kleuren van het project ook in Brand Shoot');
  const start = page.getByRole('button', { name: /Shoot starten/ });
  await page.getByText(/Brand Shoot vindt dat vlak altijd automatisch/).waitFor();
  assert(await start.isDisabled(), 'shoot start niet met een kleur die op het groene vlak lijkt');
  await page.getByLabel('Kleur 1, HEX-code').fill('#6b4c38');
  await page.getByLabel('Kleur 1, HEX-code').press('Tab');
  await page.waitForFunction(() => !/altijd automatisch/.test(document.body.textContent ?? ''));
  await sc.scrollIntoViewIfNeeded();
  await shot('03-brand-shoot');
  const [sr] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/shoots') && r.request().method() === 'POST'), start.click()]);
  const shoot = await sr.json();
  assert(shoot.generations.length >= 1, 'shoot gestart');
  for (const g of shoot.generations as { id: string }[]) {
    const d = (await (await page.request.get(`${BASE}/api/generations/${g.id}`)).json()).generation;
    assert(/- Ground: .*#6b4c38/.test(d.prompt) && /- Accent color: .*#f28c28/.test(d.prompt) && /chroma-key magenta/.test(d.prompt), 'elk beeld van de serie heeft de kleuren per toepassing en een exacte achtergrond');
  }

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
