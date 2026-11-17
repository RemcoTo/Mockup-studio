# Blauwdruk Mockup Studio als SaaS

Dit document legt vast wat er gebouwd wordt, in welke volgorde, waar gegevens staan en met welke techniek. Het is gebaseerd op een doorlichting van de bestaande code met metingen, niet op de README.

## 1. Bevindingen bij de doorlichting

Gemeten op de bestaande versie (2 CPU-kernen, Node 22):

| Onderwerp | Bevinding | Gevolg |
|---|---|---|
| Rekenwerk blokkeert de server | Een scène van 4096 px verwerken (opslaan, vlak detecteren, miniatuur) duurt 1,8 s; een export op volle resolutie 1,9 s. Het rekenwerk draait op de hoofdthread. (Een eerste meting van 14 s bleek grotendeels het tekenen van de testscène te zijn, niet de verwerking.) | Zolang er gerekend wordt, reageert de applicatie voor niemand. Met meerdere gelijktijdige gebruikers stapelt dat op. |
| Achtergrondtaken | Generaties staan in het werkgeheugen. Na een herstart zijn ze weg. | Betaalde generaties kunnen verloren gaan. |
| Accounts | Er zijn geen gebruikers, geen werkruimtes, geen rechten. Elk bestand is bereikbaar voor wie de URL kent. | Niet te verkopen; elke query moet per werkruimte worden afgeschermd. |
| Kostenindicatie | De schatting rekent lineair met het aantal pixels. Bij gpt-image-2 is een liggend beeld (1536×1024) goedkoper dan een vierkant, dus de schatting zat bij liggende formaten ongeveer 90% te hoog. | Fout in een getal dat de gebruiker vertrouwt. |
| Bibliotheek | Alleen getekende testscènes. | Het product toont nu niet wat het kan. Dit is commercieel het grootste gat. |
| AI-generatie | Gebouwd volgens de documentatie, nooit live aangeroepen. De chroma-methode (model maakt het vlak groen) is niet bewezen op echte modeluitvoer. | Grootste technische onzekerheid; moet als eerste worden gevalideerd zodra er een sleutel is. |
| Gebogen oppervlakken | Mokken, flessen en kleding met sterke plooien worden als plat vlak behandeld. | Zichtbaar onecht bij precies de producten die merchandise-klanten willen. |
| Scène wisselen | Maakt intern een tijdelijke mockup aan en verwijdert die weer. | Werkt, maar is foutgevoelig; opschonen. |
| Kwaliteit van de basis | 53 tests slagen, typecheck schoon, end-to-end-workflow slaagt in een echte browser. Geometrie, detectie, SSRF-bescherming en uploads zijn degelijk. | Goede basis om op voort te bouwen; geen herschrijving nodig. |

## 2. Productrichting

Het product wint niet op het aantal mockups in de bibliotheek; daar hebben Placeit en Canva een voorsprong die niet in te halen is. Het wint op drie dingen die bureaus dagelijks nodig hebben en die AI-tools structureel slecht doen:

1. **Exact.** Het ontwerp van de klant verandert nooit: geen vervormde logo's, geen verzonnen tekst. Dit is de kern en moet aantoonbaar zijn.
2. **Een hele presentatie in één keer.** Logo, huisstijl en website erin, een samenhangende set mockups in één art direction eruit: laptop, telefoon, visitekaartje, kleding, signing. Dat is wat een bureau aan een klant laat zien.
3. **Van mockup naar klantgoedkeuring.** Een deelbare presentatiepagina waarop de klant goedkeurt of reageert, en websitemockups die bijwerken wanneer de site verandert, plus scroll-video's van websites voor cases en social.

Het marktonderzoek (`docs/marktonderzoek.md`) bevestigt deze richting en voegt twee dingen toe: een ontwerp vervangen moet alle mockups bijwerken zonder nieuwe generatie, en het prijsmodel moet eerlijk zijn (niet betalen voor mislukte generaties, maandelijks opzegbaar, credits die niet vervallen).

## 3. Architectuur

```
Browser (Nuxt 4, Vue 3)
   │  sessiecookie, alleen eigen werkruimte
Nitro-server (Node 24+)
   ├─ API-routes ─ authenticatie, rechten per werkruimte, invoercontrole, rate limiting
   ├─ Takenwachtrij (SQLite) ─ generaties, captures, exports, video's; overleeft herstarts
   ├─ Rekenpool (worker threads) ─ detectie, compositing, export; de server blijft reageren
   ├─ Providers ─ beeldgeneratie (OpenAI), e-mail (SMTP), betalingen (Stripe)
   └─ Opslag ─ database (SQLite, WAL, back-ups) en bestanden (lokale schijf of S3-compatibel)
```

| Onderdeel | Techniek | Waar staan de gegevens |
|---|---|---|
| Database | SQLite via `node:sqlite`, WAL-modus | `data/studio.sqlite`; dagelijkse online back-up naar `data/backups/` |
| Bestanden | Opslaglaag met lokale schijf; S3-compatibel (Cloudflare R2, Hetzner) als tweede adapter | `data/files/ws/<werkruimte>/…`; systeembibliotheek onder `data/files/system/…` |
| Accounts | Eigen implementatie: scrypt-wachtwoorden, sessies in de database, httpOnly-cookie | tabellen `users`, `sessions`, `email_tokens` |
| Werkruimtes en rollen | Eigenaar, beheerder, lid, kijker | `workspaces`, `memberships`, `invitations` |
| Credits | Grootboek: elke bij- en afschrijving is een regel; saldo is de som | `credit_ledger` |
| Betalingen | Stripe Checkout, klantportaal en webhooks | Stripe is leidend; lokale kopie van plan en status in `workspaces` |
| E-mail | SMTP (bijvoorbeeld Microsoft 365 of een transactionele dienst); in ontwikkeling een uitbak die je in de app kunt lezen | `data/outbox/` in ontwikkeling |
| Taken | Eigen wachtrij in SQLite met pogingen en vergrendeling | `jobs` |
| Rekenwerk | `node:worker_threads`, één worker per vrije kern | geen opslag; leest en schrijft bestanden |
| Logging en fouten | Gestructureerde JSON-logs; optioneel Sentry via een DSN | stdout, op te vangen door de hosting |
| Deployment | Docker-image met Chromium, ffmpeg en sharp; één container plus een volume | volume voor `data/` |

Waarom geen extra diensten nu: één container met SQLite draait honderden actieve gebruikers. De repository-laag en opslaglaag zijn zo opgezet dat PostgreSQL en S3 later een adapter zijn, geen herschrijving.

## 4. Volgorde

De volgorde wijkt af van de briefing op één punt: accounts en werkruimtes komen in het fundament, omdat elke query en elk bestand per werkruimte moet worden afgeschermd. Later inbouwen betekent alles twee keer aanraken.

### Fase 1, fundament
- Rekenpool met worker threads; detectie versnellen.
- Takenwachtrij in de database; generaties overleven herstarts.
- Accounts, sessies, werkruimtes, rollen, uitnodigingen, e-mailverificatie en wachtwoordherstel.
- Alle data en bestanden per werkruimte afgeschermd; systeembibliotheek los daarvan.
- Kostenindicatie corrigeren met de echte prijstabel per formaat.
- Gestructureerde logging, health-endpoint, rate limiting, Origin-controle, beveiligingsheaders.

### Fase 2, kernproduct
- Gebogen oppervlakken: cilinder (mokken, flessen) en een vervormingsraster voor vrije vormen.
- Detectie robuuster tegen echte modeluitvoer (verlopen, reflecties, ruis), met een kwaliteitsscore en automatische terugval op handmatig.
- Editor: pijltjestoetsen, uitlijnen, zoom naar het vlak, vergelijken met een schuifbalk.
- Export: eigen formaten, presets (Dribbble, Behance, Instagram, LinkedIn, presentatie 16:9), printklare CMYK-TIFF op 300 dpi.
- Getrouwheidscontrole: per mockup aantonen dat het ontwerp pixel voor pixel uit het origineel komt.
- Bibliotheekpijplijn: met één opdracht een reeks scènes genereren, met vooraf de kosten.

### Fase 3, onderscheidend vermogen
- Merkpresentatie in één keer (Brand Shoot): één art direction, een complete set mockups.
- Deelbare klantpresentatie met goedkeuren en reageren.
- Levende websitemockups: opnieuw vastleggen en alle mockups van die site bijwerken.
- Scroll-video van een website in een apparaat (MP4).
- Ontwerpversies: een nieuwe versie van een logo of website werkt alle mockups bij.

### Fase 4, betalen en limieten
- Plannen, maandelijkse credits, losse creditpakketten.
- Stripe Checkout, klantportaal, webhooks; reserveren en terugboeken van credits bij mislukte generaties.
- Limieten per plan: leden, projecten, opslag, maximale exportresolutie.
- Uitgavenplafond per dag per werkruimte en voor het hele platform.

### Fase 5, professionalisering
- Back-ups met herstelprocedure, getest.
- Beheeromgeving: gebruikers, werkruimtes, gebruik, kosten, fouten.
- Uitbreiding van de tests: rechten, betalingen, wachtrij, belasting.
- Beveiligingsreview door een onafhankelijke controle.

### Fase 6, lancering
- Dockerfile en deploymentconfiguratie, met instructies.
- Onboarding: eerste project, eerste mockup binnen een minuut.
- Prijspagina en documentatie.
- Installatie-instructies voor Windows en VS Code.

## 5. Wat externe actie vraagt

| Actie | Nodig voor | Wanneer |
|---|---|---|
| OpenAI-sleutel met tegoed | Live valideren van de chroma-methode, bibliotheek vullen, AI-scènes | Zo vroeg mogelijk: dit is de grootste technische onzekerheid |
| Stripe-account | Betalingen live testen (testmodus is gratis) | Fase 4 |
| SMTP-gegevens of e-maildienst | Verificatie- en herstelmails versturen | Fase 1 werkt zonder (uitbak); voor livegang nodig |
| Hosting en domein | Livegang | Fase 6 |
| Productnaam, prijzen, gratis plan wel of niet met watermerk | Commerciële keuzes | Vóór fase 4 |
