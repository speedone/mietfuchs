# Betrieb, Pakete und Release

Jeder Server, den ein Skript für eine Prüfung startet, bekommt `NKA_DATA_DIR`, `CI=1` und
`NKA_UPDATE_URL` (siehe Wurzel-CLAUDE.md, Tests).

## Bildschirmfotos und Browserlauf

- **[screenshots.mjs](screenshots.mjs)** (`npm run screenshots`) erzeugt `docs/screenshots/` neu und
  gehört zu jedem Release: baut die Oberfläche (`--skip-build`), startet Server und
  [fake-ollama.mjs](fake-ollama.mjs), legt per API den Beispielbestand aus
  [demo-stock.mjs](demo-stock.mjs) an und fotografiert mit Playwright (1440 × 900, hell). **Der
  Bestand ist erfunden** („Lindenweg 12, 12345 Musterstadt“, Beispiel-IBAN
  `DE02 1203 0000 0000 2020 51`); echte Namen, Adressen oder Belege gehören nie hinein. Steht ein
  Fehler im Bild, bricht das Skript ab; die Bilder trotzdem vor dem Commit ansehen. Dateinamen
  beibehalten, das README verlinkt sie. Browser einmalig: `npx playwright install chromium`. Dazu
  `muster-hell.png` und `muster-dunkel.png` von der Musterseite (`?muster`, ganze Seite, vom README
  nicht verlinkt), und das Skript bricht ab, wenn die Tabelle „Auswertung prüfen“ bei 1440 px seitlich
  rollt. `startServer` (demo-stock.mjs) setzt `NKA_TEST_IDS=seq` (server/src/CLAUDE.md): dieselben
  Kennungen in jedem Lauf.
- **[browser-check.mjs](browser-check.mjs)** (`npm run browser-check`): derselbe Bestand plus
  Heizanlage, jede Seite der Navigation in Chromium, Firefox und WebKit, bei 1440 × 900 und
  390 × 844, hell und dunkel. Je Seite: keine Konsolenfehler, keine sichtbare Fehlermeldung, kein
  seitliches Scrollen, kein abgeschnittenes Feld (auch in Seitenfenstern, siehe client/CLAUDE.md),
  axe-core ohne serious/critical. Dazu Bedienproben per Tastatur (Seitenfenster, Monatsfeld,
  Begriff, Sammelmeldung, Beleg zuordnen ohne springenden Knopf, Menüblatt am Handy), axe auch auf
  diesen Zuständen und mit der Regel `target-size` (WCAG 2.5.8, in axe sonst aus). Jede Seite wird
  ein zweites Mal mit allen `<details>` offen gemessen (Breite und abgeschnittene Felder, Befund
  „aufgeklappt:“). Die Musterseite (`?muster`) prüft er in jeder Kombination wie eine Seite, mit
  offenem Seitenfenster, Rückfrage und Begriff; `--pages muster` allein. Jeder Befund: Exit 1
  und eine Zeile in `<out>/bericht.md`; Fotos in `--out` (Temp, nie im Repo). Ausnahmen für axe in
  [browser-check-axe.json](browser-check-axe.json) mit Grund und Anzahl, nur sinkend (heute leer;
  `--merge` fasst CI-Läufe zusammen). Eingrenzen mit `--engines`, `--views`, `--themes`, `--pages`
  (`--pages -` nur Bedienproben); eine unbekannte Seite, ein Lauf ohne Seite oder eine Seite aus
  nav.ts, die in der Navigation fehlt, ist ein Befund. WebKit braucht unter Linux GTK4, sonst im
  Container `mcr.microsoft.com/playwright:v<Fassung>-noble` (Befehl im Kopf des Skripts). Läuft in
  release.yml je Engine im vollen Prüfumfang. Gedruckt wird dort nicht (WebKit druckt unter Linux in
  Playwright nicht); dafür der Druck in Safari.
- **[safari-print-check.mjs](safari-print-check.mjs)** (#286, Workflow
  [druck-safari.yml](../.github/workflows/druck-safari.yml), nur von Hand, `macos-latest`, nicht in
  release.yml): derselbe Bestand plus Heizanlage, acht Fälle der Seite Abrechnung (Strg+P alle mit und
  ohne Anschreiben, ein Mieter mit Anschreiben, mit Auszug, ohne Anschreiben, mit Hinweis der Datenbank,
  mit Logo, mit Briefpapier). Je Fall bedient ein Skript in der Seite die Oberfläche wie ein Mensch
  (Fenster „Drucken“, Mieter, Häkchen, Rückfragen); `window.print()` wird abgefangen, gedruckt wird
  danach mit dem Zustand, den die Seite gesetzt hat. Safari: [safari-print/main.swift](safari-print/main.swift)
  (`swiftc`, ohne Xcode-Projekt), WKWebView und `NSPrintOperation` mit Disposition „save“, A4, ohne
  Hintergründe wie Safaris Vorgabe; die Ränder der Seiteneinstellung ändern nichts, `@page { margin }`
  gilt. Vergleich: Chromium mit `page.pdf()` auf demselben Rechner. pdf.js prüft Seitenzahl gleich
  Chromium, A4, jede Mieterabrechnung auf neuer Seite (Anrede bzw. Zeile „Mieter“, darüber kein Betrag),
  „Seite x von y“ (nur ein Mieter ohne Briefpapier) und Fußvermerk als unterste Zeile jeder Seite außer
  der Briefseite, kein Text außerhalb 25 bis 190 mm und 5 mm vom oberen Rand, kein Text der Oberfläche,
  keine Fehler oder `console.error` der Seite. Bericht `bericht.md` in der Zusammenfassung, PDFs und
  Seitenbilder als Artefakt. Exit 1 heißt Befunde (der Workflow meldet sie vorerst als Warnung und
  bleibt grün, aber nur, wenn `bericht.md` mindestens einen nennt), Exit 2 ein gescheiterter Lauf
  (rot; auch ein kaputter Import, eine PDF ohne Seite oder ein Bestand ohne Mieter).
  Lokal ohne Mac: `--engines chromium`; `--evaluate` wertet vorhandene PDFs neu aus. **Was in WebKit gilt** (Safari 26.6.2,
  nachgemessen an Testseiten und im Lauf, #286): keine Randfelder von `@page`, also keine Seitenzahl (erwartet);
  `thead`/`tfoot` und fest positionierte Elemente nicht je Seite wiederholt, also der Fußvermerk einmal am Ende jeder
  Aufstellung (erwartet) und ohne wiederholten Tabellenkopf weniger Seiten als Chromium (erwartet, wenn dieselben
  Beträge und derselbe Text ohne Tabellenköpfe, Fußvermerk und Seitenzahl dastehen); die Ränder der ersten Seite (auch
  `@page :first`) für alle Seiten, deshalb druckt Safari ohne Briefpapier, mit Hinweis auf der Seite und im Fenster
  „Drucken“ (erwartet und geprüft, `canPagePaper` in client/src/letterDesignView.ts); `box-decoration-break: clone`
  nur mit Präfix und nicht über Druckseiten. Die Erkennung prüft nur, ob es die Eigenschaft ohne Präfix gibt: Führt
  WebKit sie ein, meldet der Workflow „Briefpapier gedruckt“, und es ist neu zu messen, ob die Ränder je Seite wirken. `break-inside: avoid` an `tr` beachtet WebKit nicht (eine mehrzeilige Zeile der Kostentabelle
  kann ihre letzte Zeile auf die nächste Seite schieben; dieselbe Angabe an einem Block je Zelle trennt die Zellen
  voneinander, das war schlechter, offen). Der Maßstab: WebKit legt die Druckseite 1,25-mal so breit an, wie sie in Punkt
  misst (`printingMinimumShrinkFactor` in WebCore/page/PrintContext.h), und verkleinert auf die Breite des Inhalts;
  ohne breiten Inhalt druckte es rund 7 % größer, mit der überlangen E-Mail 3 %. Das ist Safari selbst, nicht der
  Aufbau (die Ränder und `scalingFactor` von NSPrintInfo ändern nichts, Safari druckt über denselben Weg); behoben
  mit `body { width: 186mm }` im Druck, nur ohne `box-decoration-break: clone` (Klasse `print-fixed-width`, client/src/letter.css; in Chromium und
  Firefox schaltete die feste Breite die Skalierung des Druckdialogs ab). Erwartetes steht im Bericht unter „Erwartet“, nicht
  als Befund. **Von Hand bleibt**: ein Blick auf die Seitenbilder (Überdrucken, Bilder, Linien prüft
  die Auswertung nicht) und gelegentlich „Als PDF sichern“ im echten Safari als Gegenprobe, denn der
  Lauf druckt über WKWebView, nicht über Safaris Menü.

## Messung mit großem Bestand

- **[perf-stock.mjs](perf-stock.mjs)** legt einen erfundenen, reproduzierbaren Bestand an (fester Startwert je
  Stufe, `--size s|m|l`, `--out` ein leerer Wegwerf-Ordner). Stufe **m** ist das Ziel: 5 Objekte, 60 Wohnungen,
  10 Jahre mit Mieterwechseln, rund 3.000 Belege (kleine echte PDFs aus `textPdf`, je Datei eine eigene Prüfsumme),
  22.000 Ablesungen, 1.500 Kostenpositionen, Zahlungen, Ölheizung mit Lieferungen und Vorrat, 100 Auswertungen,
  rund 10.000 Gruppen im Verlauf, abgeschlossene Vorjahre; **s** ein Zehntel, **l** das Dreifache. Alles geht über
  die API eines echten Servers, **nur Ablesungen und Zahlungen** schreibt ein eigener Prozess mit `openDatabase` und
  `insertEntityIn`, während kein Server läuft (über die Route kostete jede ein Lesen der ganzen Sammlung, und das
  Journal bekäme Zehntausende Gruppen); sie stehen deshalb nicht im Verlauf. Kennungen zufällig, nicht
  `NKA_TEST_IDS=seq` (der Aufbau startet den Server zweimal).
- **[perf-check.mjs](perf-check.mjs)** misst auf Kopien des Bestands: Start, RSS, Größe der Datenbank je Tabelle,
  Antwortzeiten kalt und warm (Median, p95) der Rechen- und Listenrouten, Schreiben, Backup und Wiederherstellen
  (das zugleich prüft, dass der Bestand gültig ist), ein `--cpu-prof` der zwei langsamsten Routen und einen
  Chromium-Lauf durch jede Seite (1440 × 900 und 390 × 844, größtes Objekt) mit Zeit bis Inhalt und bis Ruhe,
  DOM-Knoten, API-Größe, Long Tasks, JS-Heap, typischen Aktionen (auch Filter, Rücksprung- und Sicherungsvorschau
  im Verlauf) und Fotos. Ergebnis in `<out>/<Stufe>/messung.md`. `--stock <Ordner>` nimmt einen vorhandenen Bestand
  aus perf-stock.mjs (ohne ihn legt das Skript ihn unter `<out>/stock-<Stufe>` an), `--runs`, `--skip-browser`,
  `--skip-build`, `--skip-profile`, `--skip-heavy`. Jeder Server läuft in `try`/`finally` und wird mit SIGTERM, nach
  10 s mit SIGKILL beendet, auch bei Strg+C; NKA_*-Angaben der eigenen Shell gelangen nicht hinein. Nicht in der CI,
  von Hand vor einem Release, **allein auf dem Rechner** (die Antwortzeiten hängen an fremder Last; die Rechenzeit
  des Servers je Aufruf aus `/proc` nicht). **Last**: m braucht grob 1 bis 2 GB Arbeitsspeicher, l ein Mehrfaches
  (perf-stock.mjs bricht l unter 4 GB freiem Speicher ab, außer mit `--force`). Der Belegordner über alle Jahre und
  Objekte läuft zuletzt und kann den Rechner lahmlegen (jedes Vorschaubild startet einen eigenen pdf.js-Worker; Last
  in den Hunderten, Tab-Absturz), bis der Fix für die Belegvorschauen gemergt ist; `--skip-heavy` lässt ihn weg.

## Programmdateien, Pakete, Docker

- **Programmdateien** ([package-binaries.mjs](package-binaries.mjs), `npm run package`): Server und
  Frontend per **Bun `--compile`** zu je einer Datei für Windows, Linux und macOS, je x64 und ARM64
  (`node scripts/package-binaries.mjs win` baut ein Ziel). Bun, weil der Server ESM ist; **keine
  nativen Module** im Server. Das Frontend bettet [embed-client.mjs](embed-client.mjs) ins
  gitignorierte `server/src/embedded-client.js` ein (`with { type: 'file' }`). Erkannt wird der
  Betrieb an `globalThis.Bun`: Daten in `data/` **neben der Programmdatei**, der Browser öffnet sich
  (außer bei `CI`). Wo die Daten liegen, entscheidet `chooseDataDir` (server/src/store.ts).
  Die macOS-Dateien werden auf einem Mac-Runner mit `codesign --sign -` neu signiert (Buns
  Ad-hoc-Signatur beim Cross-Kompilieren war wiederholt ungültig). Bun baut bewusst mit `latest`.
- **Linux-Pakete** (#25, [package-linux.mjs](package-linux.mjs), `npm run package:linux`): `.deb`,
  `.rpm` und Arch je x64 und ARM64 mit **nFPM** nach [../packaging/nfpm.yaml](../packaging/nfpm.yaml)
  (von der Platte oder als Container). Programm nach `/usr/bin`, dazu
  [mietfuchs.desktop](../packaging/mietfuchs.desktop) und Symbol. **Ein Systemort** (`/usr`, `/opt`,
  `Program Files`) **führt immer in den Benutzerordner** (`~/.local/share/mietfuchs`, XDG), auch mit
  Schreibrecht (`systemLocation` in server/src/paths.ts, zugleich Betriebsart `package`). Der
  Heimatordner wird erst gesucht, wenn er gebraucht wird (`os.homedir()` wirft in Containern mit
  `--user`). Der Server nennt den Datenordner in der zweiten Zeile.
- **Start aus dem Startmenü** (#45): `Terminal=false` (mit `true` startet ohne Terminalprogramm still
  nichts). Ersatz fürs Konsolenfenster: `POST /api/quit` (Knopf nur bei `STANDALONE`), und ein Start
  auf belegtem Port, auf dem schon Mietfuchs antwortet (`app: 'mietfuchs'` in `/healthz`), endet still
  mit 0. **Der Port wird gebunden, bevor die Datenbank geöffnet wird** (#244), damit ein zweiter Start
  nie unter der laufenden Instanz migriert (Binden statt Nachfragen, keine Sperrdatei). Bis Datenbank
  und Umstieg bereit sind, antwortet nur `/healthz` sofort mit 503 und `status: 'starting'`; wer auf
  den Start wartet, fragt nach 200 oder einem anderen `status`. Bleibt die Antwort aus, fragt der
  zweite Start bis 30 Sekunden. Geprüft auf allen Programmdateien mit
  [second-start.mjs](second-start.mjs) (Exit 0, Datenordner byteweise unverändert); scheitert der Start
  sonst, meldet Linux über `notify-send`. Testgriffe: `NKA_TEST_START_DELAY_MS`, `NKA_RUNTIME=binary`.
  Den Klick im Menü prüft nur eine Probe auf einem echten Desktop.
- **Docker** ([docker.yml](../.github/workflows/docker.yml), [Dockerfile](../Dockerfile)): bei
  `v*`-Tags und auf `main` für amd64 und arm64 nach `ghcr.io/speedone/mietfuchs`; an PRs, die
  Dockerfile, Abhängigkeiten oder Workflow ändern, nur Probebau. Die Laufzeitstufe übernimmt `server`,
  `client/dist` **und `shared`** (der Server lädt Laufzeithelfer von dort; ohne den Ordner startet
  das Image nicht, und nur die Prüfung des Images bemerkt es).
- **Node-Versionen**: Docker und Release-Build Node 24, die CI zusätzlich die Untergrenze **24.15**
  aus `engines` (ab 24.12 TypeScript ohne Build stabil, ab 24.15 keine `ExperimentalWarning` von
  `node:sqlite` mehr, die sich nicht sauber unterdrücken lässt). Beim Anheben mitziehen: `engines`
  (samt Lockfile), README-Badge, Dockerfile, ci.yml, release.yml. Dependabot
  ([dependabot.yml](../.github/dependabot.yml)) hält Actions und npm monatlich aktuell; bei
  Hauptversionen die Changelogs gegen unsere Nutzung prüfen (Express 5: `listen`-Callback auch bei
  Fehlern, `res.sendFile` braucht `root` bei Punkt-Ordnern).

## Microsoft Store

- **MSIX** (#500, [package-msix.mjs](package-msix.mjs), Manifest
  [../packaging/msix/AppxManifest.xml](../packaging/msix/AppxManifest.xml), Symbole in `packaging/msix/Assets`):
  je Architektur ein `.msix`, zusammen ein `.msixbundle`, unsigniert (der Store signiert). Nur unter Windows
  (makeappx aus dem Windows SDK). Eingepackt werden eigene Programmdateien aus `dist-bin/store`, die
  package-binaries.mjs mit `--windows-hide-console` baut (geht als einzige Windows-Angabe von Bun auch beim Bau
  unter Linux); ans Release gehen sie nicht. Identität aus dem Partner Center (`speedone.Mietfuchs`, Store-ID
  `9PMHZ0ZJPZDZ`); `STORE_PACKAGE_NAME` in server/src/paths.ts muss dazu passen.
- **Version**: vier Teile, der erste nicht 0, der vierte immer 0, und der Store nimmt nur höhere an. Deshalb
  `msixVersion`: Hauptversion plus 1 (0.14.2 wird 1.14.2.0), für immer festgelegt.
- **Betriebsart `store`** (server/src/version.ts, erkannt am Paketordner unter `WindowsApps`): kein Update-Abgleich
  mit GitHub, keine Frage danach, Beenden aus der Oberfläche. **Daten in `%USERPROFILE%\Mietfuchs`**, nicht unter
  AppData: Dorthin schreibende Store-Apps lenkt Windows in einen Paketordner um und löscht ihn beim Deinstallieren.
  Abschalten ginge nur mit `unvirtualizedResources`, das Microsoft für Spiele vorsieht; außerhalb von AppData lenkt
  Windows nichts um. Nicht „Dokumente“, weil OneDrive den Ordner oft abgleicht.
- **Prüfung** (Job „Store-Paket bauen und prüfen“ in release.yml, bei jedem Lauf): signiert eine Kopie mit einem
  Wegwerf-Zertifikat desselben Herausgebers, installiert sie, startet über den Befehlsalias `mietfuchs.exe` (nur so
  erbt das Programm `CI` und `NKA_UPDATE_URL`, der Start übers Startmenü reicht nichts weiter), Prüfskript mit
  `--mode store`, Beenden über `/api/quit`, deinstallieren; die Datenbank muss danach noch in
  `%USERPROFILE%\Mietfuchs` liegen.
- **Einreichen** ([store.yml](../.github/workflows/store.yml), von release.yml aufgerufen): beim Tag ohne Bindestrich,
  nach dem Anhängen ans Release, nur mit der Repository-Variable `MSSTORE_EINREICHEN = an`. Läuft auf Windows, weil
  msstore die Zugangsdaten im Schlüsselbund ablegt und ein Linux-Runner keinen hat. Scheitert die Einreichung beim
  Tag, startest du store.yml von Hand mit der Nummer des Release-Laufs; das reicht dessen Paket ohne neuen Tag ein,
  sofern der Lauf ans Release angehängt hat. Die Variable zählt dann nicht.
  `msstore publish <bundle> -id 9PMHZ0ZJPZDZ --noCommit` übernimmt Eintrag und Bilder der letzten Einreichung und
  tauscht nur das Paket; einen offenen Entwurf im Partner Center löscht es dabei. Vor dem Abschicken setzt der
  Workflow zwei Felder: „Nach der Zertifizierung sofort veröffentlichen“ (sonst kopiert der Store „Manual“ der ersten
  Einreichung, und eine Einstellung im Entwurf ginge mit ihm verloren) und „Neuigkeiten in dieser Version“ (Version
  und Link aufs Release). Beschreibung und Bildschirmfotos bleiben, wie sie im Partner Center stehen. Die **erste Einreichung geht von Hand** im
  Partner Center (die CLI aktualisiert nur eine veröffentlichte App), Texte dafür in
  [../packaging/msix/store-eintrag.md](../packaging/msix/store-eintrag.md). Zugang: Entra-Anwendung
  `mietfuchs-github` (Rolle Manager), Secrets `MSSTORE_TENANT_ID`, `MSSTORE_SELLER_ID`, `MSSTORE_CLIENT_ID`,
  `MSSTORE_CLIENT_SECRET`; das Secret läuft ab und wird dann im Partner Center neu erzeugt.

## Release

- [release.yml](../.github/workflows/release.yml) baut beim `v*`-Tag alle Ziele und hängt sie an:
  macOS als Zip, Linux als tar.gz (Ausführungsbit), Windows roh. **Die Namen der x64-Dateien bleiben
  fest**, der Update-Hinweis älterer Versionen sucht sie.
- **Bei jeder Nebenversion kommt ein Eintrag in `RELEASE_STEPS`** ([server/src/db/releaseSteps.ts](../server/src/db/releaseSteps.ts),
  `{ version: 'x.y.0', steps: <Zahl der Dateien server/drizzle/*.sql> }`, #318): Daraus nennt der Verlauf die Sicherung
  „Vor dem Update auf Version …“. Beim Tag prüft es der Schritt „Rechtsregister geprüft?“ in release.yml
  (`MIETFUCHS_RELEASE=1`, Test „Release: RELEASE_STEPS nennt die Schritte dieser Version“ in law-release.test.ts); eine
  Patchversion ohne neuen Schritt braucht keinen.
- **Ein Tag mit Bindestrich ist eine Vorabversion** (`v0.8.0-rc.1`) und wird ausdrücklich so
  gekennzeichnet, sonst böte `releases/latest` sie jedem an. Docker vergibt dann von selbst kein
  `latest`.
- **Die Version kommt aus dem Tag** (#166): [set-version.mjs](set-version.mjs) schreibt sie vor dem
  Bauen in die drei package.json samt Lockfiles (in release.yml und docker.yml). Abweichen darf nur
  das Vorab-Suffix, eine andere Basis bricht ab (`parseVersion` aus update.ts). Linux-Pakete tragen
  `0.9.0~rc.2` (Arch `0.9.0rc.2`, `version_schema: semver`), **im Dateinamen steht ein Punkt statt
  „~“**, wie GitHub ihn ohnehin umschriebe.

## Prüfungen der Artefakte

- **[smoke-test.mjs](smoke-test.mjs)** prüft eine laufende Instanz von außen (Oberfläche samt
  Skriptteilen und pdf.js, KI-Auswertung gegen nachgebautes Ollama, Belege, Abrechnung, Backup,
  Wiederherstellen, Datenbank aus `/healthz`) und braucht einen leeren Datenordner. Läuft für jede
  Programmdatei auf ihrem System, in Containern vieler Distributionen (CentOS 7 mit glibc 2.17 bis
  Ubuntu 26.04), fürs Docker-Image und in der CI gegen den Quellcode. Lokal:
  `node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm`. Den **gelungenen** Umstieg
  prüft er nicht.
- **[umstieg-praxislauf.mjs](umstieg-praxislauf.mjs)** spielt den Umstieg mit echten Servern über
  zwei Starts durch (frischer Rechner, gewachsener Bestand, Altformate, abgelehnter Bestand, Backup
  mit und ohne Datenbank; ein Fall einzeln mit `--nur 6`). **Fall 7** (Archive von vor der Datenbank,
  auf die [MIGRATION.md](../MIGRATION.md) verweist) startet bewusst in einem **anderen Haus**
  (`bestandAnderesHaus`), sonst blieben die Zusicherungen grün, auch wenn nichts übernommen wurde.
  **Fall 18** legt rohe Zeilen auf den Stand 0076 und prüft den Datenschritt 0077 (Quellen, #455) über
  echte Starts; er wird rot, wenn der Schritt in `DATA_STEPS` fehlt. Nicht in der CI, sondern von Hand vor jedem Release. Eine unbekannte Fallnummer bricht ab.
  `--slow-ai 320` lässt das Ollama über fünf Minuten schweigen; das läuft im vollen Umfang auf den
  Programmdateien (Linux x64, Windows x64, Apple Silicon) und gegen Node.
- **Prüfumfang je Anlass** (#52), entschieden im Job „Prüfumfang festlegen“ in release.yml: **Ein PR
  ohne Label** prüft Tests und Build ([ci.yml](../.github/workflows/ci.yml)), Bauen und Signieren,
  die sechs Programmdateien ohne lange KI-Antwort, `centos:7` und `ubuntu:26.04`, das `.deb` auf
  Ubuntu 24.04 und das `.rpm` auf Fedora. **Alles** (alle Distributionen und Pakete, ARM64-Container,
  lange KI-Antwort, Browserlauf) läuft beim Tag, mittwochs 4:23 UTC auf `main` (das Netz gegen eine
  fehlerhafte Bun-Fassung; nach 60 Tagen ohne Bewegung schaltet GitHub Zeitpläne ab), von Hand und
  mit dem Label `full-check`. Die Bedingung ist als Ausnahme geschrieben (vollständig außer am PR
  ohne Label), damit ein neuer Auslöser im Zweifel zu breit läuft. Am PR läuft release.yml nur,
  wenn er Server, Oberfläche, Skripte, Paketierung oder die Datei selbst anfasst. **Eine leere
  Matrix erzeugt keinen Job und keinen Fehler**, deshalb bricht „Prüfumfang festlegen“ bei einer
  leeren Liste ab. „Ans Release anhängen“ wartet auf alles, auch auf den Browserlauf.
