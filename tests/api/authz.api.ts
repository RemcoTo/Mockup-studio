// Rechtentest op HTTP-niveau tegen een draaiende server: twee werkruimtes, en alles wat de ene van
// de andere probeert te lezen of te wijzigen moet worden geweigerd.
//   BASE_URL=http://localhost:3000 npm run test:api
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let failures = 0;
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? '  ok ' : '  FOUT'} ${msg}`); if (!cond) failures++; };

class Client {
  cookie = '';
  name: string;
  constructor(name: string) { this.name = name; }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), Origin: BASE, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set && set.includes('ms_session=')) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* geen json */ }
    return { status: res.status, json, text };
  }
}

const stamp = Date.now();
const a = new Client('A'), b = new Client('B'), anon = new Client('anoniem');

const s1 = await a.req('POST', '/api/auth/signup', { name: 'Anna A', email: `anna+${stamp}@a.test`, password: 'paarse olifant op de fiets', workspaceName: 'Bureau A' });
ok(s1.status === 200, `A registreert (${s1.status})`);
const s2 = await b.req('POST', '/api/auth/signup', { name: 'Bram B', email: `bram+${stamp}@b.test`, password: 'blauwe giraf onder de brug', workspaceName: 'Bureau B' });
ok(s2.status === 200, `B registreert (${s2.status})`);

const aProjects = (await a.req('GET', '/api/projects')).json as any[];
const aProject = aProjects[0];
ok(aProject, 'A heeft een voorbeeldproject');
const detail = (await a.req('GET', `/api/projects/${aProject.id}`)).json;
const aAsset = detail.assets[0];
const lib = (await a.req('GET', '/api/scenes?library=1')).json as any[];
const m = await a.req('POST', '/api/mockups', { projectId: aProject.id, sceneId: lib[0].id, assetId: aAsset.id });
ok(m.status === 200, 'A maakt een mockup');
const aMockup = m.json;

console.log('B probeert bij A te komen:');
ok((await b.req('GET', '/api/projects')).json.every((p: any) => p.id !== aProject.id), 'projectlijst van B bevat het project van A niet');
ok((await b.req('GET', `/api/projects/${aProject.id}`)).status === 404, 'project van A lezen geeft 404');
ok((await b.req('PATCH', `/api/projects/${aProject.id}`, { name: 'gekaapt' })).status === 404, 'project van A hernoemen geeft 404');
ok((await b.req('DELETE', `/api/projects/${aProject.id}`)).status === 404, 'project van A verwijderen geeft 404');
ok((await b.req('GET', `/api/assets/${aAsset.id}/original`)).status === 404, 'origineel van A downloaden geeft 404');
ok((await b.req('DELETE', `/api/assets/${aAsset.id}`)).status === 404, 'ontwerp van A verwijderen geeft 404');
ok((await b.req('GET', `/api/mockups/${aMockup.id}`)).status === 404, 'mockup van A lezen geeft 404');
ok((await b.req('POST', `/api/mockups/${aMockup.id}/export`, { format: 'png', quality: 90 })).status === 404, 'mockup van A exporteren geeft 404');
ok((await b.req('POST', '/api/mockups', { projectId: aProject.id, sceneId: lib[0].id, assetId: null })).status === 404, 'mockup aanmaken in project van A geeft 404');
const bProject = ((await b.req('GET', '/api/projects')).json as any[])[0];
ok((await b.req('POST', '/api/mockups', { projectId: bProject.id, sceneId: lib[0].id, assetId: aAsset.id })).status === 400, 'ontwerp van A gebruiken in project van B wordt geweigerd');
// E-mailhandtekening: ontwerpen van A als handtekening of profielfoto in een mailscherm van B.
const mailScene = lib.find((x: any) => x.objectType === 'email-laptop');
const bAsset = ((await b.req('GET', `/api/projects/${bProject.id}`)).json.assets as any[])[0];
const bMail = await b.req('POST', '/api/mockups', { projectId: bProject.id, sceneId: mailScene.id, assetId: bAsset.id });
ok(bMail.status === 200 && bMail.json.placements[0].layout?.template === 'mail-desktop', 'B maakt een e-mailmockup met de eigen handtekening');
const withA = bMail.json.placements.map((p: any) => ({ ...p, layout: { ...p.layout, slots: [{ assetId: aAsset.id }] } }));
ok((await b.req('PATCH', `/api/mockups/${bMail.json.id}`, { placements: withA })).status === 400, 'handtekening van A in een mailscherm van B wordt geweigerd');
const avatarA = bMail.json.placements.map((p: any) => ({ ...p, layout: { ...p.layout, avatar: { assetId: aAsset.id } } }));
ok((await b.req('PATCH', `/api/mockups/${bMail.json.id}`, { placements: avatarA })).status === 400, 'profielfoto van A in een mailscherm van B wordt geweigerd');
const tooWide = bMail.json.placements.map((p: any) => ({ ...p, layout: { ...p.layout, signatureWidth: 5000 } }));
ok((await b.req('PATCH', `/api/mockups/${bMail.json.id}`, { placements: tooWide })).status === 400, 'onmogelijke breedte van de handtekening wordt geweigerd');
ok((await b.req('POST', '/api/generations', { projectId: aProject.id, assetId: null, count: 1, config: { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma' } })).status === 404, 'generatie starten in project van A geeft 404');
// Configuraties: alleen binnen de eigen werkruimte te verwijderen.
const aGen = (await a.req('POST', '/api/generations', { projectId: aProject.id, assetId: null, count: 1, config: { category: 'print', objectType: 'business-card', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', designSize: { width: 550, height: 850 } } })).json;
ok(!!aGen?.id, 'A start een generatie met afmetingen');
ok((await b.req('DELETE', `/api/generations/${aGen.id}`)).status === 404, 'configuratie van A verwijderen geeft 404 voor B');
ok((await a.req('POST', '/api/generations', { projectId: aProject.id, assetId: null, count: 1, config: { category: 'print', objectType: 'business-card', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma', designSize: { width: 5, height: 850 } } })).status === 400, 'onmogelijke afmetingen worden geweigerd');
for (let t = 0; t < 40 && (await a.req('GET', `/api/generations/${aGen.id}`)).json.generation.status !== 'done'; t++) await new Promise((r) => setTimeout(r, 500));
ok((await a.req('DELETE', `/api/generations/${aGen.id}`)).status === 200, 'A verwijdert de eigen configuratie');
ok((await a.req('GET', `/api/generations/${aGen.id}`)).status === 404, 'verwijderde configuratie is weg');
ok((await b.req('GET', `/api/scenes/${lib[0].id}`)).status === 200, 'systeembibliotheek is voor B leesbaar');
ok((await b.req('PUT', `/api/scenes/${lib[0].id}/surfaces`, { surfaces: [] })).status === 403, 'systeemscène wijzigen wordt geweigerd voor een gewone gebruiker');

console.log('Presentaties en versies:');
const sh = await a.req('POST', `/api/projects/${aProject.id}/shares`, { title: 'Ronde 1', mockupIds: [aMockup.id] });
ok(sh.status === 200 && sh.json?.path?.startsWith('/p/'), 'A maakt een presentatielink');
ok((await b.req('GET', `/api/projects/${aProject.id}/shares`)).status === 404, 'B ziet de presentaties van A niet');
ok((await b.req('DELETE', `/api/shares/${sh.json?.id}`)).status === 404, 'B kan de link van A niet intrekken');
ok((await b.req('POST', `/api/projects/${bProject.id}/shares`, { title: 'x', mockupIds: [aMockup.id] })).status === 400, 'B kan geen mockup van A in een eigen presentatie zetten');
const pub = await anon.req('GET', `/api/${sh.json?.path?.slice(1)}`);
ok(pub.status === 200 && pub.json?.mockups?.length === 1, 'de presentatie is zonder account te bekijken');
ok(!JSON.stringify(pub.json).includes('@'), 'de presentatie bevat geen e-mailadressen');
ok((await anon.req('POST', `/api/${sh.json?.path?.slice(1)}/feedback`, { mockupId: aMockup.id, kind: 'approve', name: 'Klant' })).status === 200, 'klant geeft zonder account akkoord');
ok((await anon.req('GET', `/api/${sh.json?.path?.slice(1)}/download/${aMockup.id}`)).status === 403, 'downloaden is standaard uit');
ok((await anon.req('GET', '/api/p/' + 'x'.repeat(43))).status === 404, 'verzonnen link geeft 404');
ok((await a.req('DELETE', `/api/shares/${sh.json?.id}`)).status === 200, 'A trekt de link in');
ok((await anon.req('GET', `/api/${sh.json?.path?.slice(1)}`)).status === 404, 'ingetrokken link werkt niet meer');
ok((await b.req('GET', `/api/assets/${aAsset.id}/versions`)).status === 404, 'B ziet de versies van een ontwerp van A niet');
ok((await b.req('POST', `/api/assets/${aAsset.id}/recapture`)).status === 404, 'B kan een ontwerp van A niet opnieuw vastleggen');
ok((await b.req('PATCH', `/api/assets/${aAsset.id}/refresh`, { interval: 'daily' })).status === 404, 'B kan het bijwerkritme van A niet wijzigen');

console.log('Abonnement:');
ok((await anon.req('GET', '/api/billing')).status === 401, 'abonnementsgegevens zonder sessie geven 401');
ok((await b.req('GET', '/api/billing')).status === 200, 'B ziet het eigen abonnement');
ok([400, 503].includes((await anon.req('POST', '/api/webhooks/stripe', {}, { 'Stripe-Signature': 't=1,v1=00' })).status), 'webhook met valse handtekening wordt geweigerd');

console.log('Bibliotheekbeheer:');
ok((await b.req('GET', '/api/admin/library')).status === 404, 'bibliotheekbeheer is voor een gewone gebruiker onzichtbaar');
ok((await b.req('POST', '/api/admin/library/runs', { presetIds: ['laptop-concrete'], quality: 'low', confirmUsd: 0 })).status === 404, 'gewone gebruiker kan geen bibliotheekrun starten');
const run = await a.req('POST', '/api/admin/library/runs', { presetIds: ['laptop-concrete'], quality: 'low', confirmUsd: 0 });
ok(run.status === 202, `beheerder start een bibliotheekrun met de testprovider (${run.status})`);
let pendingId: string | null = null;
for (let i = 0; i < 60 && !pendingId; i++) {
  const libState = (await a.req('GET', '/api/admin/library')).json;
  pendingId = libState?.pending?.find((x: any) => x.tags?.preset === 'laptop-concrete')?.id ?? null;
  if (!pendingId) await new Promise((r) => setTimeout(r, 1000));
}
ok(pendingId, 'de gegenereerde scène staat in de beoordelingsrij');
if (pendingId) {
  ok((await b.req('GET', `/api/scenes/${pendingId}`)).status === 404, 'nog niet gepubliceerde scène is voor een gewone gebruiker onzichtbaar');
  ok(((await b.req('GET', '/api/scenes')).json as any[]).every((x) => x.id !== pendingId), 'scènelijst van B bevat de te beoordelen scène niet');
  ok((await b.req('POST', '/api/mockups', { projectId: bProject.id, sceneId: pendingId, assetId: null })).status === 404, 'mockup op een te beoordelen scène wordt geweigerd');
  ok((await b.req('POST', `/api/admin/library/scenes/${pendingId}/publish`, {})).status === 404, 'gewone gebruiker kan niet publiceren');
  ok((await a.req('POST', `/api/admin/library/scenes/${pendingId}/publish`, {})).status === 200, 'beheerder publiceert');
  ok((await b.req('GET', `/api/scenes/${pendingId}`)).status === 200, 'na publicatie is de scène voor iedereen leesbaar');
}

console.log('Bestanden:');
const preview = aMockup.previewUrl as string;
ok(preview && (await anon.req('GET', preview)).status === 200, 'ondertekende URL werkt zonder sessie');
const unsigned = preview.split('?')[0]!;
ok((await anon.req('GET', unsigned)).status === 403, 'zonder handtekening geen toegang');
ok((await anon.req('GET', preview.replace(/s=[^&]+/, 's=' + 'x'.repeat(32)))).status === 403, 'vervalste handtekening geweigerd');
ok((await anon.req('GET', preview.replace(/e=\d+/, `e=${Date.now() + 10 * 86400_000}`))).status === 403, 'verlengde vervaltijd geweigerd');

console.log('Zonder sessie en van buitenaf:');
for (const p of ['/api/projects', '/api/assets', '/api/scenes', '/api/workspace', '/api/status', `/api/mockups/${aMockup.id}`]) ok((await anon.req('GET', p)).status === 401, `${p} zonder sessie geeft 401`);
ok((await a.req('POST', '/api/projects', { name: 'csrf' }, { Origin: 'https://kwaadaardig.example' })).status === 403, 'verzoek met vreemde Origin wordt geweigerd');
ok((await a.req('POST', '/api/projects', { name: 'eigen origin' })).status === 200, 'zelfde Origin werkt');

console.log('Rollen:');
const inv = await a.req('POST', '/api/workspace/invite', { email: `kijker+${stamp}@a.test`, role: 'viewer' });
const verification = (await a.req('GET', '/api/auth/me')).json?.site?.emailVerification;
if (verification) ok(inv.status === 403 && /bevestig/i.test(inv.json?.message ?? ''), 'uitnodigen vraagt eerst een bevestigd e-mailadres');
else ok(inv.status === 200, 'zonder verplichte e-mailbevestiging kan een beheerder direct uitnodigen');
ok([400, 403].includes((await b.req('POST', '/api/workspace/invite', { email: `x+${stamp}@b.test`, role: 'owner' })).status), 'niemand kan iemand als eigenaar uitnodigen');

console.log('Inlogpogingen:');
let limited = false;
for (let i = 0; i < 12; i++) {
  const r = await anon.req('POST', '/api/auth/login', { email: `anna+${stamp}@a.test`, password: 'fout fout fout fout' });
  if (r.status === 429) { limited = true; break; }
}
ok(limited, 'na tien foute pogingen wordt inloggen voor dit adres tijdelijk geblokkeerd');

console.log(failures ? `\n${failures} controle(s) mislukt.` : '\nAlle controles geslaagd.');
process.exitCode = failures ? 1 : 0;
