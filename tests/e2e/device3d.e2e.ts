// End-to-end test van echte 3D-devices in een echte browser: in Nieuwe mockup kiezen voor het 3D-model (met live
// voorbeeld), genereren met de testprovider, in de editor camera en openingshoek aanpassen (live 3D, daarna de
// exacte render), een gedeelde scène niet aanpassen maar kopiëren, en een device op een effen achtergrond zonder AI.
//   BASE_URL=http://localhost:3000 node --experimental-strip-types tests/e2e/device3d.e2e.ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'test-results';
function step(name: string) { console.log(`- ${name}`); }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Mislukt: ${msg}`); }

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|GPU stall/.test(m.text())) errors.push(m.text()); });
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, `device3d-${n}.png`) });
const api = async (url: string) => (await page.request.get(`${BASE}${url}`)).json();
const canvasHasPixels = (sel: string) => page.waitForFunction((s) => {
  const c = document.querySelector(s) as HTMLCanvasElement | null;
  if (!c || !c.width) return false;
  const t = document.createElement('canvas'); t.width = 64; t.height = 64;
  const ctx = t.getContext('2d')!; ctx.drawImage(c, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 200) n++;
  return n > 40;
}, sel, { timeout: 60_000 });

try {
  step('registreren');
  await page.goto(`${BASE}/registreren`, { waitUntil: 'networkidle' });
  await page.getByLabel('Naam', { exact: true }).fill('Daan Device');
  await page.getByLabel('E-mailadres').fill(`daan+${Date.now()}@bureau.test`);
  await page.getByLabel('Wachtwoord').fill('paarse olifant op de fiets');
  await page.getByLabel('Naam van je bureau of bedrijf').fill('Devicebureau');
  await page.getByRole('button', { name: 'Account aanmaken' }).click();
  await page.getByRole('heading', { name: 'Start' }).waitFor();
  const project = (await api('/api/projects'))[0];
  const site = (await api(`/api/projects/${project.id}`)).assets.find((a: { originalName: string }) => a.originalName === 'Website desktop.png');
  assert(site, 'een liggend ontwerp in het voorbeeldproject');

  step('Nieuwe mockup: laptop als echt 3D-model, met live voorbeeld');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${site.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  const dev = page.locator('[data-section="device3d"]');
  await dev.waitFor();
  assert(await dev.getByRole('button', { name: /Echt 3D-model/ }).getAttribute('aria-pressed') === 'true', '3D-model staat standaard aan voor een laptop');
  await dev.scrollIntoViewIfNeeded();
  await canvasHasPixels('[data-section="device3d"] canvas').catch(async (e) => { await dev.screenshot({ path: path.join(SHOTS, 'device3d-fout-blok.png') }); throw e; });
  assert(!(await dev.locator('.err').count()), 'geen foutmelding in het live voorbeeld');
  await dev.getByRole('group', { name: 'Camerastandpunt' }).getByRole('button', { name: 'Driekwart' }).click();
  await dev.getByRole('group', { name: 'Afwerking' }).getByRole('button', { name: 'Spacegrijs' }).click();
  await page.getByText('Prompt bekijken').click();
  await page.waitForFunction(() => /of an empty set/.test(document.querySelector('pre')?.textContent ?? '') && /30 degrees above the tabletop/.test(document.querySelector('pre')?.textContent ?? ''));
  assert(!(await page.getByText('Hoe wordt het ontwerpvlak gevonden?').count()), 'geen keuze voor groen of leeg vlak bij een 3D-device');
  await dev.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await dev.screenshot({ path: path.join(SHOTS, 'device3d-01-nieuwe-mockup.png') });

  step('genereren met de testprovider');
  await page.locator('.segmented button', { hasText: /^1$/ }).first().click();
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST'), page.getByRole('button', { name: /scènes genereren|Scène genereren/ }).click()]);
  const gen = await resp.json();
  assert(gen.config.device3d?.model === 'laptop-14' && gen.config.device3d.finish === 'space-grey', '3D-instellingen bij de generatie');
  let done = gen;
  for (let t = 0; t < 240 && !['done', 'failed'].includes(done.status); t++) { await page.waitForTimeout(750); done = (await api(`/api/generations/${gen.id}`)).generation; }
  assert(done.status === 'done', `generatie klaar (${done.status}: ${done.error})`);
  const mockupId = done.mockupIds[0];

  step('editor: 3D-device aanpassen met live weergave en exacte render');
  await page.goto(`${BASE}/editor/${mockupId}`, { waitUntil: 'networkidle' });
  const sec = page.locator('[data-section="device3d"]');
  await sec.waitFor();
  await page.getByText('Exacte weergave').waitFor({ timeout: 90_000 });
  await shot('02-editor');
  const before = (await api(`/api/mockups/${mockupId}`)).scene;
  assert(before.device3d && before.surfaces[0].detection === '3d', 'scène met 3D-device en exact schermvlak');
  // Schuiven: live 3D in de browser.
  const yaw = sec.getByLabel('Draaiing (Y)', { exact: true });
  await yaw.fill('-15');
  await page.locator('[data-live3d]').waitFor();
  await canvasHasPixels('[data-live3d] canvas');
  await page.getByText('Live 3D-weergave').waitFor();
  assert(!(await page.locator('[data-live3d] .err').count()), 'geen foutmelding in de live 3D-weergave');
  await shot('03-live');
  await yaw.dispatchEvent('change');
  // Loslaten: de server rendert; de scène is een eigen kopie (de gegenereerde scène staat in de bibliotheek).
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  const after = await api(`/api/mockups/${mockupId}`);
  assert(after.scene.id !== before.id, 'eigen kopie van de bibliotheekscène');
  assert(after.scene.device3d.spec.yaw === -15, `draaiing opgeslagen (${after.scene.device3d.spec.yaw})`);
  assert(JSON.stringify(after.scene.surfaces[0].quad) !== JSON.stringify(before.surfaces[0].quad), 'nieuw schermvlak');
  const original = (await api(`/api/scenes/${before.id}`).catch(() => null));
  void original;
  await sec.getByText(/eigen versie van de scène/).waitFor();
  // Openingshoek: tweede aanpassing, nu op de eigen kopie (geen nieuwe kopie).
  const lid = sec.getByLabel('Openingshoek', { exact: true });
  await lid.fill('125');
  await lid.dispatchEvent('change');
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  const after2 = await api(`/api/mockups/${mockupId}`);
  assert(after2.scene.id === after.scene.id, 'tweede aanpassing op dezelfde eigen scène');
  assert(after2.scene.device3d.spec.lidAngle === 125, 'openingshoek opgeslagen');
  await page.getByText('Exacte weergave').waitFor({ timeout: 90_000 });
  await shot('04-na-aanpassen');

  step('precieze invoer: rolhoek als getal, uitlijnen, zweven');
  const roll = sec.getByLabel('Rolhoek (Z), exacte waarde');
  await roll.fill('4.5');
  await roll.press('Enter');
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  let cur = (await api(`/api/mockups/${mockupId}`)).scene;
  assert(cur.device3d.spec.roll === 4.5, `rolhoek opgeslagen (${cur.device3d.spec.roll})`);
  await sec.getByRole('group', { name: 'Horizontaal uitlijnen' }).getByRole('button', { name: 'Rechts' }).click();
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  cur = (await api(`/api/mockups/${mockupId}`)).scene;
  assert(cur.device3d.spec.frame.x > 0.05, `rechts uitgelijnd (${cur.device3d.spec.frame.x})`);
  // De rechterkant van het scherm ligt nu in de rechterhelft van het beeld.
  assert(Math.max(...cur.device3d.screen.quad.map((p: number[]) => p[0])) > cur.width * 0.75, 'device staat rechts in beeld');
  const width = sec.getByLabel('Breedte in beeld, exacte waarde');
  await width.fill('40');
  await width.press('Enter');
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  await page.waitForTimeout(400);
  const measured = Number(await width.inputValue());
  assert(Math.abs(measured - 40) < 1.5, `breedte in beeld 40% (${measured})`);
  await page.getByText('Exacte weergave').waitFor({ timeout: 90_000 });
  await sec.scrollIntoViewIfNeeded();
  await shot('05-precies');

  step('menubalk: uit en aan zonder nieuwe 3D-render');
  cur = (await api(`/api/mockups/${mockupId}`)).scene;
  const fileBefore = cur.fileUrl;
  const bar = sec.locator('[data-statusbar]');
  await bar.getByLabel('Menubalk tonen').uncheck();
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  cur = (await api(`/api/mockups/${mockupId}`)).scene;
  assert(cur.device3d.spec.statusBar.show === false && cur.fileUrl === fileBefore, 'menubalk uit, zelfde render');
  await bar.getByLabel('Menubalk tonen').check();
  await bar.getByLabel('Tijd').fill('10:08');
  await bar.getByLabel('Tijd').press('Tab');
  await page.locator('[data-live3d]').waitFor({ state: 'detached', timeout: 120_000 });
  cur = (await api(`/api/mockups/${mockupId}`)).scene;
  assert(cur.device3d.spec.statusBar.show && cur.device3d.spec.statusBar.time === '10:08' && cur.fileUrl === fileBefore, 'menubalk aan met 10:08');
  await page.getByText('Exacte weergave').waitFor({ timeout: 90_000 });
  await bar.scrollIntoViewIfNeeded();
  await shot('06-menubalk');

  step('exporteren');
  await page.getByRole('button', { name: 'Exporteren' }).click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: 'Downloaden' }).click()]);
  await download.saveAs(path.join(SHOTS, 'device3d-export.png'));
  await page.keyboard.press('Escape');

  step('effen achtergrond: geen AI, geen kosten');
  await page.goto(`${BASE}/generate?project=${project.id}&asset=${site.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nieuwe scène met AI/ }).click();
  await page.getByRole('button', { name: 'Platte achtergrond', exact: true }).click();
  await page.getByText('Prompt bekijken').click();
  await page.waitForFunction(() => /Geen AI-beeld nodig/.test(document.querySelector('pre')?.textContent ?? ''));
  await page.getByText(/Op een platte achtergrond is geen AI nodig/).waitFor();
  const [r2] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST'), page.getByRole('button', { name: /scènes genereren|Scène genereren/ }).click()]);
  const g2 = await r2.json();
  assert(g2.costUsd === 0 && g2.credits === 0 && g2.provider === 'local-3d', 'zonder AI en zonder kosten');

  step('Brand Shoot: devices standaard als echt 3D-model, uit te zetten');
  await page.goto(`${BASE}/shoot?project=${project.id}`, { waitUntil: 'networkidle' });
  const toggle = page.locator('[data-section="device3d"] input[type="checkbox"]');
  await toggle.waitFor();
  assert(await toggle.isChecked(), '3D staat standaard aan in Brand Shoot');
  await toggle.scrollIntoViewIfNeeded();
  await page.locator('[data-section="device3d"]').screenshot({ path: path.join(SHOTS, 'device3d-07-brand-shoot.png') });
  const [sresp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/shoots') && r.request().method() === 'POST'), page.getByRole('button', { name: /Shoot starten/ }).click()]);
  const shoot = await sresp.json();
  assert(sresp.ok(), `shoot gestart (${JSON.stringify(shoot).slice(0, 200)})`);
  const laptopGen = shoot.generations.find((g: { config: { objectType: string } }) => g.config.objectType === 'laptop');
  assert(laptopGen?.config.device3d?.model === 'laptop-14', 'laptop in de shoot als 3D-model');
  let sg = laptopGen;
  for (let t = 0; t < 240 && !['done', 'failed'].includes(sg.status); t++) { await page.waitForTimeout(750); sg = (await api(`/api/generations/${laptopGen.id}`)).generation; }
  assert(sg.status === 'done', `laptop uit de shoot klaar (${sg.status}: ${sg.error})`);
  await page.waitForFunction(() => document.querySelectorAll('figure img').length > 0, null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot('08-brand-shoot-resultaat');

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
