# Mockup Studio

Mockup Studio maakt van websites, logo’s, huisstijlen, drukwerk, kleding en signing fotorealistische mockups. Het originele ontwerp blijft pixel-exact. AI maakt alleen de omgeving; je ontwerp gaat nooit door een beeldmodel. Elke export bevat in de metadata een vingerafdruk (SHA-256) van het origineel.

Werkruimtes met teamleden en rollen, abonnementen en credits, klantpresentaties met akkoord, ontwerpversies, levende websitemockups, brand shoots en scrollvideo’s zitten er allemaal in. Hieronder staat hoe je de studio op je eigen computer start, hoe je hem instelt en hoe je hem online zet.

---

## 1. Starten op Windows met VS Code

Je hoeft niet te programmeren. Je typt alleen een paar opdrachten in de terminal van VS Code.

**Eenmalig installeren**

1. **Node.js.** Ga naar [nodejs.org](https://nodejs.org) en kies de nieuwste versie (*Current*). Installeer met de standaardinstellingen. Het vinkje bij *Automatically install the necessary tools* hoeft niet aan.
2. **VS Code.** Download het via [code.visualstudio.com](https://code.visualstudio.com) en installeer het.
3. **De projectmap.** Pak het zip-bestand uit, bijvoorbeeld naar `Documenten\mockup-studio`.

**De studio starten**

1. Open VS Code en kies *File, Open Folder…*. Selecteer de map `mockup-studio`.
2. Open de terminal via *Terminal, New Terminal*. Onderin verschijnt een venster.
3. Typ de volgende opdrachten. Druk na elke regel op Enter en wacht tot hij klaar is.

   ```powershell
   npm install
   npm run browsers
   copy .env.example .env
   npm run dev
   ```

   - `npm install` haalt alle onderdelen op. Dat duurt de eerste keer een paar minuten.
   - `npm run browsers` installeert eenmalig de browser waarmee websites worden vastgelegd.
   - `copy` maakt je eigen instellingenbestand aan.
   - `npm run dev` start de studio.

4. Open [http://localhost:3000](http://localhost:3000) in je browser. Het eerste account dat je aanmaakt wordt de **platformbeheerder**. Is poort 3000 al bezet, bijvoorbeeld door een studio die nog in een ander terminalvenster draait, dan kiest Nuxt de eerstvolgende vrije poort (3001, 3002). Het adres staat in de terminal. Zet in dat geval `NUXT_APP_URL` in `.env` op dat adres, anders wijzen deellinks en e-maillinks naar de verkeerde poort.

De map mag elke naam hebben, ook met spaties of haakjes (zoals `mockup-studio (1)` na een tweede download). Getest met Node.js 22 en 24.

Stoppen doe je met `Ctrl+C` in de terminal. Starten doe je daarna steeds met alleen `npm run dev`.

Na het aanmaken van je account zie je een voorbeeldproject (Atelier Noord, fictief) en een bibliotheek met getekende testscènes. Daarmee probeer je de hele workflow gratis.

**Zoals op een server (sneller):**

```powershell
npm run build
npm start
```

`npm start` leest het bestand `.env` vanzelf.

**macOS en Linux:** hetzelfde, maar gebruik `cp .env.example .env` in plaats van `copy`.

---

## 2. Instellen

Alle instellingen staan in het bestand `.env`. Open het in VS Code, wijzig wat je nodig hebt, sla op en start de studio opnieuw. In de studio zie je onder *Instellingen, Systeem* wat er werkt en wat nog ontbreekt.

### AI-scènes (OpenAI)

Zonder sleutel werkt alles behalve nieuwe AI-scènes. Met `NUXT_IMAGE_PROVIDER=demo` krijg je gratis getekende testscènes.

**Wat het kost.** Je betaalt OpenAI per beeld (`gpt-image-2`, prijzen gecontroleerd op 6 september 2026):

| Formaat | Snel concept | Normaal | Hoog |
|---|---|---|---|
| 1536 × 1024 | ca. $0,005 | ca. $0,04 | ca. $0,17 |

Voor elke generatie toont de studio vooraf de kosten. Een mislukte generatie wordt niet in rekening gebracht. Twee dagplafonds beschermen tegen onverwachte kosten: `NUXT_AI_DAILY_LIMIT_USD` voor het hele platform en `NUXT_AI_WORKSPACE_DAILY_LIMIT_USD` per werkruimte en per persoon.

**Een sleutel aanmaken:**

1. Log in op [platform.openai.com/api-keys](https://platform.openai.com/api-keys) met het account waarop je tegoed staat.
2. Kies *Create new secret key*, noem hem bijvoorbeeld “Mockup Studio” en kopieer de sleutel. Je ziet hem maar één keer.
3. Controleer onder *Settings, Organization, General* of de organisatie geverifieerd is. Beeldmodellen vragen daar soms om.
4. Zet in `.env` de regels `NUXT_IMAGE_PROVIDER=openai` en `NUXT_OPENAI_API_KEY=` gevolgd door je sleutel.
5. Stel bij *Settings, Limits* een maandlimiet in.
6. Doe de eerste generatie op *Snel concept* met één variant. Dat kost ongeveer een halve cent en laat zien of alles werkt.

### E-mail

Voor gebruik op je eigen computer is geen e-mail nodig. E-mailbevestiging staat standaard uit: na registreren kun je direct mockups en AI-scènes maken, en er wordt geen bevestigingsmail verstuurd. Herstel- en uitnodigingsmails komen zonder e-mailserver in de uitbak; platformbeheerders lezen die onder *Instellingen, Systeem*.

Zet je de studio op een openbare server, zet dan `NUXT_REQUIRE_EMAIL_VERIFICATION=true`. Dan zijn AI-scènes en uitnodigen pas beschikbaar na een bevestigd e-mailadres, wat misbruik van AI-tegoed met nep-accounts tegenhoudt. Daarvoor heb je wel echte e-mail nodig:

```
NUXT_SMTP_URL=smtps://gebruiker:wachtwoord@smtp.jouwprovider.nl:465
NUXT_MAIL_FROM=Mockup Studio <studio@jouwdomein.nl>
```

Je provider (Postmark, Mailgun, Microsoft 365, TransIP) geeft je de server, gebruikersnaam en wachtwoord.

### Betalen (Stripe)

Met `NUXT_BILLING_MODE=off` (de standaard) is alles beschikbaar en zijn er geen credits; dat is geschikt voor een eigen installatie. Met `credits` gelden abonnementen, credits en limieten per plan. De plannen en prijzen staan in `shared/plans.ts`.

1. Maak een account op [stripe.com](https://stripe.com). Laat *Testmodus* aan staan tot alles werkt.
2. Kopieer onder *Ontwikkelaars, API-sleutels* de geheime sleutel (`sk_test_…`) naar `NUXT_STRIPE_SECRET_KEY` in `.env`.
3. Typ in de terminal `npm run stripe:setup`. Dit maakt de producten, prijzen en het klantportaal aan.
4. Volg de instructie die het script toont om de webhook toe te voegen. Kopieer het ondertekeningsgeheim (`whsec_…`) naar `NUXT_STRIPE_WEBHOOK_SECRET`.
   - De webhook moet je studio via internet kunnen bereiken. Doe deze stap daarom pas als de studio online staat (zie hieronder).
   - Lokaal testen kan met de [Stripe CLI](https://docs.stripe.com/stripe-cli): `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
5. Zet `NUXT_BILLING_MODE=credits` en start opnieuw.
6. Betaal onder *Abonnement* met testkaart `4242 4242 4242 4242`, een datum in de toekomst en een willekeurige CVC.
7. Werkt dat, herhaal dan stap 2 tot en met 5 met de live-sleutels.

Credits vervallen niet. Een opgezegd abonnement loopt door tot het einde van de betaalde maand.

---

## 3. Online zetten

De eenvoudigste route is een eigen kleine server (een VPS met 2 processorkernen en 4 GB geheugen is genoeg om te beginnen) met Docker. Caddy regelt automatisch HTTPS.

1. Huur een server met Ubuntu en installeer Docker volgens [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/).
2. Laat bij je domeinregistrar een A-record (bijvoorbeeld `studio.jouwdomein.nl`) naar het IP-adres van de server wijzen.
3. Kopieer de projectmap naar de server en maak daar `.env` aan. Zet daarin in elk geval:
   - `NUXT_APP_URL=https://studio.jouwdomein.nl`
   - `NUXT_ALLOW_SIGNUP` naar wens. Op een openbare server zonder betalen is `false` verstandig.
4. Start de studio:

   ```bash
   DOMAIN=studio.jouwdomein.nl docker compose up -d
   ```

5. Open `https://studio.jouwdomein.nl` en maak direct het eerste account aan. Dat wordt de beheerder.

Alles staat in het Docker-volume `data`: de database, de bestanden en de back-ups. Laat je hostingpartij daar dagelijks een snapshot van maken. Daarnaast maakt de studio zelf elke dag een back-up van de database; de laatste 14 blijven bewaard. Die download je onder *Platformbeheer*.

**Herstellen:** stop de studio, vervang `data/studio.sqlite` door een back-up (hernoem die naar `studio.sqlite`) en start weer.

---

## 4. Wat er in zit

- **Ontwerpen aanleveren.** Upload PNG, JPG, WebP, SVG of PDF, of leg een website vast (desktop, laptop, tablet, smartphone, ook als volledige pagina). Cookiebanners worden verborgen.
- **Mockups.**
  - Je ontwerp staat direct op elke bibliotheekfoto.
  - In de editor stel je hoeken, schaal, positie, rotatie, passing, licht, plooien, glans en dekking bij. Er is ook een vrij vervormingsraster.
  - Gebogen vlakken zoals mokken, flessen en blikken volgen de ronding.
  - Printvlakken lopen naadloos op in het object.
- **E-mailhandtekening.** Een eigen categorie in de bibliotheek, met laptop, smartphone, smartphone in de hand, en laptop en smartphone samen.
  - Je handtekening (PNG, JPG of SVG) staat onder een e-mail in een neutraal mailprogramma: op de laptop met mappen, berichtenlijst en leesvenster, op de telefoon als geopend bericht. Daarna gaat het scherm door dezelfde keten als elke mockup: perspectief, licht, reflecties, export.
  - Ware grootte: de breedte in de e-mail volgt uit het bestand (een handtekening die op 2× is geëxporteerd, staat op de helft), of stel je zelf in tussen 120 en 700 pixels. De handtekening wordt nooit uitgerekt, bijgesneden of gedraaid; op een telefoon wordt hij niet breder dan de tekstkolom.
  - In de editor pas je afzender, e-mailadres, ontvanger, datum, onderwerp en de tekst boven de handtekening aan, kies je een profielfoto en zet je het mailprogramma op licht of donker, om te zien of de handtekening ook in donkere modus leesbaar blijft. Het bericht geldt voor alle schermen in de scène.
  - Elk scherm in een andere scène kan ook een e-mail tonen (Als e-mailhandtekening tonen), en omgekeerd kan een mailscherm zonder e-mail.
  - Bewust geen logo of naam van een bestaand mailprogramma in de interface.
  - Het voorbeeldproject bevat een e-mailhandtekening van een fictief architectenbureau.
- **AI-scènes.**
  - Een configurator met object, materiaal, omgeving, camera, compositie, licht en stijl, plus referentiebeelden.
  - Afmetingen van je ontwerp in pixels (breedte en hoogte, staand of liggend), standaard overgenomen van het gekozen ontwerp, met een voorbeeld van de verhouding. Bij drukwerk, borden, kleding en verpakking vraagt de prompt het oppervlak in precies die verhouding en stand (een ontwerp van 550 × 850 px geeft een staand visitekaartje), herkent de studio het vlak in die stand en plaatst het ontwerp passend: niet uitgerekt, niet bijgesneden, niet gedraaid. Bij een tablet bepalen ze of het scherm staand of liggend staat; bij een laptop, een rond object of een e-mailhandtekening bepaalt het object de verhouding.
  - Acht looks in één klik (rustige studio, warm interieur, editorial op steen, productfoto, in merkkleuren, abstracte vormen, effen vlak, verloop). Daarna verfijn je scènetype (studio, interieur, minimalistisch, editorial, productfotografie, abstract), ondergrond (onder meer eiken, marmer, travertin, beton, linnen), props (geen, minimaal, passend bij het merk), camera, licht en schaduw.
  - Kleuren: zoveel merkkleuren als je wilt (tot twaalf), elk via kleurkiezer of HEX-code, met per kleur een toepassing: ondergrond, achtergrond, gradient, objecten, accentkleur of verlichting. Kleuren met Gradient vormen samen een verloop over de achtergrond, in de volgorde van de lijst, van boven naar onder, links naar rechts, diagonaal of vanuit het midden. Een voorbeeldje laat zien welke kleur waar komt. De prompt geeft elke kleur precies één plek en verbiedt de kleuren op het product en het ontwerpvlak; het ontwerp gaat nooit naar het model en wordt daarna ongewijzigd geplaatst (het licht van de scène gaat er alleen als helderheid overheen, niet als kleur). De kleuren worden per project onthouden in je browser en gelden ook in Brand Shoot. Wat niet kan, wordt vooraf gemeld: een gradient met één kleur, een achtergrond met zowel een kleur als een gradient, en een kleur die op het groene ontwerpvlak lijkt (dan kun je met één klik naar een leeg vlak dat je zelf aanwijst). Instellingen van vóór dit palet (één merkkleur) worden bij hergebruik automatisch omgezet.
  - Achtergrond in een scène: kies **Exact** of **Door de AI**. Bij Exact (standaard) maakt het model de wand of achtergrond als egaal magenta sleutelscherm en zet de studio je kleur of gradient er daarna pixel voor pixel in, met dezelfde techniek als de platte achtergrond: effen, zonder lichtval, textuur of kleurzweem, terwijl ondergrond, objecten, licht, product en ontwerpvlak onaangeroerd blijven. De prompt vraagt de achtergrond zichtbaar in beeld; bij bovenaanzicht is alles rond het product achtergrond. Een scènekleur die op het magenta scherm lijkt, wordt vooraf gemeld. Bij Door de AI gaat de kleur als harde instructie naar het model (exacte HEX en RGB, egaal belicht, licht en kleurcorrectie mogen hem niet verschuiven); het model blijft hem wel zelf schilderen, dus kleine afwijkingen zijn mogelijk. Oude instellingen met één merkkleur werken als Door de AI, zoals voorheen.
  - Uitbreiden met een nieuwe toepassing: voeg hem toe aan `COLOR_ROLES` in `shared/palette.ts` en beschrijf in `roleLine()` hoe het model hem toepast; validatie en interface volgen vanzelf.
  - Platte achtergrond in plaats van een ruimte: in je kleur voor Achtergrond of je gradient (ook met meer dan twee kleuren), met fijne korrel of papiertextuur en een zachte, scherpe of geen schaduw. Het model zet het object voor een magenta sleutelscherm; de studio vervangt dat door precies de gekozen kleuren. De schaduw blijft, het object en het ontwerpvlak worden niet aangeraakt.
  - Elke gegenereerde scène staat direct onder Scènes, met preview, het label Nieuw en een titel als "Laptop, verloop #f1ece4 naar #1e2a4a". Vanuit het menu op de kaart open je hem, gebruik je hem voor een mockup met een ander ontwerp, start je een nieuwe scène met dezelfde instellingen of verwijder je hem.
  - Het model rendert het vlak groen. De studio vindt dat vlak automatisch en plaatst je originele bestand erop.
  - Meerdere groene vlakken in één beeld worden apart herkend, ook als ze elkaar raken of overlappen (twee telefoons, de voor- en zijkant van een doos). Elk vlak krijgt eigen hoeken en een eigen masker; waar vlakken overlappen hoort het groen bij het voorste vlak. Een voorwerp vóór een vlak blijft zichtbaar.
  - Licht uit de scène gaat mee: schaduw en lichtval als schaalfactor, glimlicht en spiegelingen (een raam in een scherm) als reflectie over je ontwerp. Groen strooilicht buiten het vlak, op een kader of in een glanzend bureau, krijgt de tint van je ontwerp. In de editor regel je de reflecties met een schuif.
- **Echte 3D-devices.** Laptop (14 inch), smartphone (6,1 inch), tablet (11 inch) en monitor (27 inch) als echt 3D-model, gerenderd met Three.js op je eigen computer of server. Geen betaalde dienst, geen API-sleutel.
  - In Nieuwe mockup staat bij deze vier objecten standaard **Echt 3D-model** aan, met een live voorbeeld. Je kiest het camerastandpunt (Frontaal, Perspectief, Driekwart, Zijkant, Bovenaanzicht), de afwerking en of het toestel rechtop staat of plat ligt. **Door de AI** werkt zoals voorheen, met het groene schermvlak.
  - De AI maakt alleen de omgeving: een lege plek op de juiste grootte, vanuit hetzelfde camerastandpunt, zonder device. De studio rendert het toestel daarop zoals in een fotostudio: een ruimte in de tinten van de achtergrond met grote softboxen (hoofdlicht uit de richting van het helderste deel van de omgeving, bovenlicht, striplichten voor de glanslijnen langs randen, een groot doek achter voor het verloop over vlakke delen en een reflectiekaart vóór het product), PBR-materialen (metalness en roughness), een slagschaduw die zachter wordt naarmate het device hoger boven de ondergrond uitsteekt, en contactschaduw. Het model wordt dus nooit door de AI getekend of vervormd.
  - Je ontwerp gaat niet als textuur door de 3D-render maar door dezelfde keten als elke mockup: het origineel komt pixel voor pixel en perspectiefcorrect op het scherm, in de echte schermverhouding van het model, ook recht van voren en van boven. Delen van het toestel die vóór het scherm staan (het cameragat van de telefoon) dekken het ontwerp af, zoals in het echt.
  - Op een effen of verlopende achtergrond is geen AI nodig: de studio maakt achtergrond en device zelf, zonder kosten. Meerdere varianten krijgen elk een ander camerastandpunt.
  - In de editor stel je alles in met een schuifregelaar en een getalveld voor een exacte waarde:
    - positie in beeld (horizontaal en verticaal, met uitlijnen links, midden, rechts, boven, midden, onder) en in de ruimte (X opzij, Y zweven boven de ondergrond, Z naar voren of achteren, in cm)
    - rotatie om de X-, Y- en Z-as
    - schaal: zoom, breedte of hoogte in beeld (in procenten van het beeld) en afstand tot de camera; het device schaalt altijd als geheel, zodat device en scherm niet vervormen
    - camera: camerahoogte, beeldhoek en brandpuntsafstand (perspectief)
    - openingshoek, afwerking, houding, licht, schaduw en reflecties
    - acht camerastandpunten (Front, Perspectief, Driekwart, Zijkant, Bovenaanzicht, Laag standpunt, Schuin van boven, Close-up) en een knop terug naar de standaardwaarden
  - Tijdens het aanpassen zie je een live 3D-weergave in de browser, met dezelfde code, dezelfde schermindeling en dezelfde statusbalk als de server; bij loslaten rendert de server het exacte beeld. Alles wordt per mockup bewaard. Een scène die ook elders wordt gebruikt (bijvoorbeeld in de bibliotheek) wordt daarbij gekopieerd, niet overschreven.
  - Statusbalk en menubalk: telefoon en tablet krijgen een statusbalk (tijd, bereik, wifi, batterij; op de tablet ook datum en percentage), laptop en monitor een menubalk (programmanaam en menu's, batterij, wifi, zoeken, bediening, datum en tijd), zonder merklogo's. De balk staat bóven het ontwerp, niet eroverheen: het ontwerp komt exact en perspectiefcorrect in de ruimte eronder. De kleur sluit aan op de bovenrand van het ontwerp; tekst en iconen zijn automatisch licht of donker (of vast gekozen). Tijd en datum zijn aan te passen, de balk kan uit. Aanzetten, uitzetten en de tijd of kleur wijzigen vraagt geen nieuwe 3D-render. Nieuwe mockups krijgen de balk standaard (9:41); bestaande mockups blijven zoals ze waren.
  - Brand Shoot: laptops, telefoons, tablets en monitoren in een serie worden standaard een echt 3D-model (uit te zetten). Groen als merkkleur mag dan, zolang geen ander beeld in de serie het groene vlak gebruikt.
  - De modellen zijn eigen werk, in code opgebouwd op echte maten, dus zonder licentie van derden. Het zijn geen kopieën van bestaande merkproducten en ze dragen geen logo. Gratis modellen zijn onderzocht: Poly Haven (CC0) heeft alleen een retro laptop en geen telefoons, tablets of monitoren, en wat elders gratis staat is meestal een kopie van een merkproduct of heeft een onduidelijke licentie.
    - Laptop: aluminium onderkant met een taps toelopende onderrand en een gepolijste facetrand, verzonken toetsenbord met losse toetsen en opdruk, verzonken glazen trackpad met naad, speakerperforatie, USB-C- en audiopoorten, rubberen voetjes, scharnierbuis, deksel met rubberen rand, glazen voorkant met dunne randen en camera.
    - Smartphone en tablet: metalen frame met vlakke zijkanten en zachte afrondingen, glas met afgeronde rand, scherm met afgeronde hoeken, cameragat (telefoon) of camera in de rand (tablet), knoppen die uit het frame steken, antennebandjes, poort, speaker- en microfoongaatjes, cameramodule met gelaagde lenzen en flitser.
    - Monitor: glazen voorkant van rand tot rand, gepolijste facetrand, aluminium achterkant met bevestigingsplaat, gefreesde voet en hals met kabeldoorvoer.
    - Naden en kieren zijn donkerder door ingebakken occlusie (vertexkleur), zonder extra rekenwerk tijdens het renderen. Modellen: laptop 1,2 MB, telefoon 0,35 MB, tablet 0,3 MB, monitor 0,2 MB.
  - Een eigen GLB-model toevoegen: zie Architectuur.
- **Brand shoot.** Eén art direction geldt voor een hele serie dragers, zodat de beelden samen een set vormen. Upload tot vier referentiebeelden (met preview, afzonderlijk te verwijderen) en kies waarvoor ze gelden: compositie, camerahoek, belichting, materialen, kleuren en fotografische stijl. Ze gaan bij elk beeld van de serie mee naar het model als stijlrichting; de prompt verbiedt het letterlijk overnemen van scène, objecten, tekst of ontwerp, en op de vlakken komen altijd je eigen ontwerpen. Elk beeld krijgt de afmetingen van zijn eigen ontwerp mee, en de kleuren met hun toepassing gelden voor de hele serie.
- **Configuraties.** Elke generatie bewaart haar instellingen om te hergebruiken, en is te verwijderen (na bevestiging). De scènes en mockups die eruit zijn ontstaan blijven bestaan; een configuratie die nog wordt gegenereerd kan niet worden verwijderd, en de kosten blijven meetellen voor het dagplafond.
- **Klantpresentatie.** Een deellink waarop je klant zonder account per beeld akkoord geeft of een wijziging vraagt. Jij krijgt bij elke reactie een e-mail.
- **Ontwerpversies.** Upload een nieuwe versie en alle mockups worden bijgewerkt. Eerdere versies kun je terugzetten.
- **Levende websitemockups.** Een website opnieuw vastleggen kan met de hand, dagelijks of wekelijks. Mockups veranderen alleen als de site veranderd is.
- **Exports.**
  - PNG en JPG op elk formaat of met een preset (Instagram, LinkedIn, Dribbble, Behance, presentatie).
  - TIFF in CMYK op 300 dpi voor de drukker.
  - Scrollvideo (MP4) van een volledige webpagina in een apparaat.
  - Een zip met meerdere mockups.
- **Team.** Werkruimtes met eigenaar, beheerder, lid en kijker, uitnodigen per e-mail en wisselen tussen werkruimtes.
- **Abonnementen en credits.** Via Stripe, met maandcredits, bijkopen, het klantportaal en limieten per plan.
- **Beheer.**
  - Platformoverzicht met gebruik, kosten, wachtrij en opslag, en credits bijschrijven.
  - De bibliotheek samenstellen uit 29 art-directionpresets (waarvan 3 voor e-mailhandtekeningen), met beoordeling vóór publicatie.
  - Dagelijkse back-ups.
- **Privacy.** Gegevens exporteren (JSON), een werkruimte verwijderen en je account verwijderen.

---

## 5. Wat is getest

Wat er werkelijk is uitgevoerd in de ontwikkelomgeving (Linux, Node 22.23 en Node 24.22):

| Onderdeel | Status |
|---|---|
| Uploads, website-import, editor, export (PNG, JPG, TIFF/CMYK, presets, zip), vlakdetectie, gebogen en naadloze vlakken | **Volledig getest**: unit- en integratietests en een browsertest van begin tot eind |
| Meerdere vlakken (overlap, doos, waaier, afgedekt, schaduwlijn) en reflecties (lichtstreep, glimlicht, spiegelend bureau, kadergloed, verkleinde weergave) | **Volledig getest** op synthetische scènes die modeluitvoer nabootsen (`tests/unit/multi-surface.test.ts`, `tests/unit/reflections.test.ts`). Nog niet op echte AI-beelden: daarvoor is een betaalde generatie nodig |
| E-mailhandtekening: mailweergave op laptop en telefoon, ware grootte en eigen breedte, handtekening onvervormd en niet gedraaid (gemeten in de render, licht en donker), alle vier de e-mailscènes, bericht meenemen naar een andere scène, opschonen bij verwijderen | **Volledig getest**: `tests/integration/email.test.ts` en een browsertest (`tests/e2e/email.e2e.ts`): categorie, mockup maken, bericht, breedte en donkere modus aanpassen, exporteren, laptop en telefoon samen |
| Scèneopties, presets, merkkleur, platte achtergrond (effen, vier verlooprichtingen, korrel, papier, schaduw aan en uit) en automatisch opslaan onder Scènes | **Volledig getest**: `tests/integration/scene-style.test.ts` (achtergrond exact op HEX gemeten, object en groen vlak byte voor byte ongewijzigd, ontwerp in de mockup exact de ontwerpkleur, scène direct in de bibliotheek) en een browsertest (`tests/e2e/scenes.e2e.ts`): preset, scènetype, ondergrond, props, groene merkkleur geweigerd, verloop genereren, nieuwe scène onder Scènes, hergebruiken, instellingen overnemen, verwijderen |
| Meerdere kleuren met elk een toepassing, gradients, in Nieuwe mockup en Brand Shoot | **Volledig getest**: `tests/integration/palette.test.ts` (validatie, omzetten van oude instellingen, prompt per toepassing met het voorbeeld donkergroen/lichtbeige/oranje, gradient met drie kleuren en vier richtingen, platte achtergrond exact op de drie kleuren gemeten, testscène gekleurd per toepassing, ontwerp exact en ook met licht in eigen tint, Brand Shoot, en het verzoek dat echt naar een nagebootste OpenAI-dienst gaat bij een losse scène en bij Brand Shoot) en een browsertest (`tests/e2e/palette.e2e.ts`) |
| Exacte achtergrond in een scène en harde kleurinstructie bij Door de AI | **Volledig getest** in `tests/integration/palette.test.ts`: elke wandpixel die niet tegen een object aan ligt exact de HEX (laptop, mok, poster), ondergrond, product en groen vlak byte voor byte gelijk, een lichtere plek in het sleutelscherm volledig vervangen, gradient alleen over de achtergrond, bovenaanzicht, magenta-controle, de hele keten tot het ontwerp in de mockup, Brand Shoot, en het verzoek aan een nagebootste OpenAI-dienst. Browsertest `tests/e2e/palette.e2e.ts`. Hoe egaal een echt model het magenta scherm in een volledige scène maakt, is nog niet met een betaalde generatie vastgesteld |
| Platte achtergrond en kleuren met echte AI-beelden | **Niet getest met een betaald model**: getest met de testprovider, die de configuratie volgt zoals een model dat zou doen (sleutelscherm met lichtval en schaduw, kleuren op wand, vloer, objecten, accenten en licht). Hoe nauwkeurig een echt model elke kleur op de juiste plek zet, is nog niet vastgesteld. Hoe nauwkeurig een echt model het magenta scherm egaal houdt, is nog niet vastgesteld |
| E-mailhandtekening op fotorealistische scènes | **Niet getest met echte AI-beelden**: de e-mailscènes in de bibliotheek zijn getekende testscènes. Fotorealistische scènes komen uit de 3 e-mailpresets of uit *Nieuwe scène met AI*; dat is een betaalde generatie die hier niet is uitgevoerd |
| Social media verwijderd | **Getest**, ook als echte upgrade: een datamap van de vorige versie met social-mockups, een social-generatie en de social-testscènes is met deze versie opgestart. Vooraf een back-up, social-mockups werden gewone mockups met hun eigen ontwerp, eigen scènes bleven werken, ongebruikte testscènes verdwenen |
| Accounts, rollen, uitnodigingen, scheiding tussen werkruimtes | **Volledig getest**, ook met 55+ controles over HTTP |
| Afmetingen van het ontwerp, referentiebeelden bij een brand shoot, website-import met en zonder volledige pagina, configuraties verwijderen | **Volledig getest**: `tests/integration/improvements.test.ts` (staand en liggend visitekaartje: vlak in de juiste verhouding, ontwerp rechtop en passend gemeten in de render; referenties tot in het verzoek aan een nagebootste beelddienst; lange pagina's tot 36.000 px; kosten na verwijderen), browsertest `tests/e2e/improvements.e2e.ts` en HTTP-controles. Niet tegen de echte OpenAI-dienst: dat is een betaalde aanroep |
| Echte 3D-devices: statusbalk en menubalk op alle vier de devices (boven het ontwerp, ontwerp exact eronder, aan en uit zonder nieuwe render), positie in de ruimte, rolhoek en zweven, laden van de vier modellen, render, masker, achtergrond buiten device en schaduw byte voor byte gelijk, camerahoek, draaiing en openingshoek, render op 3840 × 2560, ontwerp onvervormd en perspectiefcorrect op het scherm (kwadranten, hoeken en een rand van 2% aan vier kanten gemeten) voor laptop, telefoon, tablet en monitor, ook recht van voren en van boven, omgeving genereren met de testprovider, effen achtergrond zonder AI en zonder kosten, Brand Shoot | **Volledig getest**: `tests/integration/device3d.test.ts`, `tests/integration/shoot.test.ts` en een browsertest (`tests/e2e/device3d.e2e.ts`): 3D-model met live voorbeeld in Nieuwe mockup, genereren, in de editor draaien en openingshoek aanpassen met live 3D en daarna de exacte render, een exacte rolhoek typen, rechts uitlijnen, breedte in beeld op 40%, menubalk uit en aan met een andere tijd, kopie van een gedeelde scène, exporteren, effen achtergrond zonder kosten |
| 3D-device in een echte AI-omgeving | **Niet getest met een betaald model**: getest met de testprovider. Hoe goed een echt model de lege plek en het camerastandpunt volgt, is nog niet vastgesteld; perspectief en grootte zijn in de editor bij te stellen |
| Klantpresentaties, versies, opnieuw vastleggen, brand shoot, scrollvideo | **Volledig getest** (browser, integratie, frames uit de video bekeken) |
| Planlimieten, credits, Stripe-webhooks (handtekening, dubbele berichten, abonnement, maandcredits, overstappen) | **Volledig getest** met lokaal ondertekende webhooks |
| Stripe Checkout en klantportaal | **Externe configuratie nodig**: gebouwd volgens de Stripe-API, maar niet tegen een echt Stripe-account uitgevoerd (geen sleutel) |
| OpenAI-beeldgeneratie | **Externe configuratie nodig**: gebouwd volgens de Images API, foutafhandeling getest, maar geen echte (betaalde) aanroep gedaan |
| E-mail via SMTP | **Gedeeltelijk getest**: tegen een lokale testserver; nog niet met een echte provider |
| Docker-image en docker-compose | **Niet getest**: Docker Hub was vanuit de ontwikkelomgeving niet bereikbaar. De Dockerfile is geschreven, maar niet gebouwd |
| Windows | **Niet getest** op een Windows-machine. Alle gebruikte pakketten (sharp, canvas, ffmpeg, Playwright) leveren kant-en-klare Windows-versies |
| Node 24 | **Volledig getest**: alle tests, productiebuild, dev-server, browsertest en HTTP-controles op Node 24.22, ook vanuit een map met spaties en haakjes in het pad |
| Node 25 en 26 | **Niet getest**: die versies zijn in de ontwikkelomgeving niet gedraaid |

Zelf de tests draaien:

```bash
npm test             # 210+ unit- en integratietests
npm run typecheck
```

Browsertest en HTTP-rechtentest: start de studio met `NUXT_IMAGE_PROVIDER=demo NUXT_CAPTURE_ALLOW_PRIVATE=true npm run dev` op een lege datamap. Draai daarna in een tweede terminal `BASE_URL=http://localhost:3000 npm run test:e2e`, voor e-mailhandtekeningen `BASE_URL=http://localhost:3000 npm run test:e2e:email`, voor kleuren `BASE_URL=http://localhost:3000 npm run test:e2e:palette`, voor scènes `BASE_URL=http://localhost:3000 npm run test:e2e:scenes` voor afmetingen, referenties, volledige pagina en configuraties `BASE_URL=http://localhost:3000 npm run test:e2e:improvements` en voor 3D-devices `BASE_URL=http://localhost:3000 npm run test:e2e:device3d`.

---

## 6. Beveiliging

- **Website-import.**
  - Alle browserverkeer gaat via een eigen proxy. Die zoekt het adres op, controleert dat het publiek is en verbindt met precies dat adres. Interne netwerken, cloud-metadata en DNS-rebinding zijn zo uitgesloten.
  - Alleen de standaardpoorten zijn toegestaan.
  - Elke redirect wordt gecontroleerd.
- **Uploads.** Het bestandstype wordt bepaald op de inhoud. SVG’s met scripts, entiteiten, externe verwijzingen of HTML worden geweigerd. Er is een limiet op beeldgrootte en paginagrootte.
- **Accounts.**
  - Wachtwoorden met scrypt, sessies als hash.
  - CSRF-bescherming en rate limiting op inloggen, registreren en herstellen.
  - Elk record wordt gecontroleerd op werkruimte en rol.
- **Bestanden.** Ondertekende links die na 2 tot 4 uur verlopen. Presentatielinks zijn intrekbaar en komen niet in de logboeken.
- **AI-kosten.** Dagplafonds voor het platform, per werkruimte en per persoon; welkomstcredits één keer per persoon. Op een openbare server zet je daarnaast de e-mailbevestiging aan (`NUXT_REQUIRE_EMAIL_VERIFICATION=true`).
- **Onafhankelijke controle.** Er is een aparte beveiligingsreview gedaan. De gevonden punten zijn opgelost (DNS-rebinding, overstappen in het klantportaal, IP-spoofing, misbruik van welkomstcredits, quota bij dupliceren, tokens in logboeken).
- **Achter een proxy** (Caddy, nginx): zet `NUXT_TRUST_PROXY=1`, zodat rate limiting het echte IP-adres gebruikt. De docker-compose doet dat al.

---

## 7. Architectuur

| Onderdeel | Keuze |
|---|---|
| Applicatie | Nuxt 4 (Vue 3, TypeScript), Nitro-server, één proces |
| Database | SQLite via `node:sqlite`; alle queries in `server/lib/repositories.ts` en `repo-accounts.ts` |
| Bestanden | `server/lib/storage.ts`, lokale map (een S3-variant implementeert dezelfde interface) |
| Beeldwerk | Sharp met een eigen TypeScript-kern (homografie, meshwarp, chroma-detectie, ontmengen, opvullen), in worker threads |
| Achtergrondtaken | Duurzame wachtrij in SQLite (`server/lib/jobs/queue.ts`) |
| Website-import | Playwright met Chromium, achter een eigen egress-proxy |
| 3D-devices | Three.js (MIT), modellen als GLB in `public/models/devices`; renderen in headless Chromium (WebGL, zonder grafische kaart via SwiftShader), dezelfde code als de live weergave in de browser |
| Video | ffmpeg (pakket `ffmpeg-static`) |
| Betalen | Stripe Checkout, Customer Portal, webhooks |

```
app/                     interface (pagina’s, componenten, stijl)
server/api/              API-routes
server/lib/              domeinlogica (accounts, billing, capture, generation, imaging, library, jobs)
server/lib/http/         helpers voor API-routes (apiHandler, requireUser, present)
shared/                  code voor server en browser (geometrie, catalogus, plannen, prijzen)
shared/device3d/         3D-devices: modellen (code), instellingen en presets, de render-stage
public/models/devices/   de 3D-modellen als GLB
scripts/                 hulpscripts (worker bouwen, Stripe instellen)
tests/                   unit-, integratie-, browser- en HTTP-tests
docs/                    blauwdruk en marktonderzoek
```

**Imports.** Eigen code wordt altijd expliciet geïmporteerd: composables uit `~/composables/...`, serverhelpers uit `server/lib/http/...`. Het automatisch importeren op basis van mappen staat uit (`imports.scan: false`). Dat werkt met glob-patronen die in een pad met haakjes niets vinden, en een ontbrekende import viel dan pas op tijdens het draaien. Nu meldt `npm run typecheck` hem direct. Framework-functies (`ref`, `navigateTo`, `defineEventHandler`, `createError`) en componenten blijven automatisch beschikbaar.

**Een 3D-device toevoegen.** Elk device is een GLB-bestand plus één regel in `DEVICE_MODELS` (`shared/device3d/spec.ts`): het objecttype, de schermmaat in millimeters, de houdingen, de afwerkingen en de licentie. Het model staat in meters, met de voorkant naar +Z en de onderkant op y=0. Het scherm is een vlak mesh met de naam `Screen` (UV 0..1, normaal naar +Z); bij een laptop draait de groep `Lid` om het scharnier. Materialen met de namen `Aluminium`, `Frame`, `GlassBack`, `Trackpad` en `Chamfer` (gepolijste randen) krijgen de gekozen afwerking. Een eigen of gedownload model (bijvoorbeeld uit Blender) kan zo, mits de licentie gebruik in een commerciële app toestaat (CC0 of CC BY met naamsvermelding in `license`); de vier meegeleverde modellen worden gebouwd met `npm run build:devices`. De 3D-render gebruikt dezelfde Chromium als de website-import (`npm run browsers`).
