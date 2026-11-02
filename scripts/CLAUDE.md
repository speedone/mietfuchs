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

## Programmfenster (#517)

- **Electron nur als Fenster** ([../desktop/](../desktop/), eigenes Paket mit eigenem Lockfile; `npm install` installiert es
  **nicht** mit, das Docker-Image kennt den Ordner nicht, sondern `npm --prefix desktop install`. Ohne Installation
  überspringt `npm run typecheck` das Fenster mit Hinweis, in der CI ist das ein Fehler): Der Server läuft mit
  **Electrons eigenem Node als `utilityProcess`** (`serviceName` `Mietfuchs-Server`, Ausgabe über Pipes ins
  Protokoll), das Fenster zeigt `http://127.0.0.1:17517`; `node:sqlite` ist dabei (Electron 45.2 bringt Node 24.22).
  Keine Programmdatei des Servers. **Ausgeliefert als Bündel in der `app.asar`**, drei Dateien unter `mietfuchs/` in der
  Anordnung des Repos: `server/server.mjs` (Server, `shared/`, Abhängigkeiten und Migrationen), daneben
  `server/THIRD-PARTY-LICENSES.txt` und `client/dist.pack` (das Frontend als eine Datei,
  [clientPack.ts](../server/src/clientPack.ts)). Das Bündel erkennt sich an `IN_BUNDLE`
  ([bundle.ts](../server/src/bundle.ts), beim Bündeln auf true gesetzt) und nimmt dann Migrationen und Frontend
  daraus statt von der Platte. Aus den Quellen (rund 470 Dateien, Typen abstreifen) kostete der Start ein bis drei
  Sekunden mehr, und die Tausende Dateien aus Quellen und node_modules prüft der Echtzeitschutz unter Windows beim
  Installieren einzeln. **Warum in der asar** (Fund auf einem echten Rechner): Offen unter `resources/mietfuchs`
  stufte die Malware-Prävention von HP Wolf Security (KI-Erkennung) `server.mjs` als Schadcode ein und blockierte es,
  der Start scheiterte mit `EPERM`. Electron empfiehlt beides: „we heavily recommend that you bundle all your code into
  one single file“ ([Performance, 7. Bundle your code](https://www.electronjs.org/docs/latest/tutorial/performance)),
  und die asar „to improve the performance of reading files on platforms like Windows“
  ([Application Distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution)), „By
  bundling the app we can mitigate issues around long path names on Windows, speed up `require` and conceal your
  source code from cursory inspection“ ([ASAR Archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)).
  Nicht entpacken (`asarUnpack`): Was Electron in temporäre Dateien auslagert, kann laut derselben Seite Virenscanner
  auslösen; `fs.open` liefert für Einträge der asar echte Deskriptoren ohne Kopie, so liest `clientPack.ts` das
  Frontend direkt. Zu `utilityProcess.fork` aus der asar und zu ESM in der asar sagt die Doku nichts
  ([utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [ESM](https://www.electronjs.org/docs/latest/tutorial/esm));
  geprüft mit Electron 45: Der utilityProcess lädt `app.asar/mietfuchs/server/server.mjs` als ESM und liest
  `dist.pack` mit `openSync`/`readSync` aus dem Archiv, unter Linux (xvfb-run) und in der CI gepackt mit allen Fuses
  unter Windows und macOS. Der Arbeitsordner ist `resources`, ein Archiv kann keiner sein. Die Prüfung der Integrität
  ([ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), Windows ab Electron 30, macOS)
  deckt den Server so mit ab: Electron prüft beim Lesen einer Datei aus dem Archiv ihre Prüfsumme und beendet sich bei
  Abweichung (`validateBufferIntegrity` in Electrons asar-fs-wrapper). **Blockiert ein Virenschutz trotzdem eine
  Datei** (`EPERM`, `EACCES`, `ENOENT` auf einer Datei unter dem Programmordner), sagt der Dialog das gesiezt mit der
  Datei auf der Platte (die `app.asar`, nicht der Eintrag darin) und was zu tun ist, die technische Meldung klein
  darunter (`findBlockedFile`, `blockedFileIn`, `startFailure` in server.js). Erst werden die Dateien selbst geprüft,
  dann die Ausgabe: Bei einem Fehler im Lesen aus der asar druckt Node erst eine Zeile von Electrons eigenem
  Quelltext, rund 8 KB, und die eigentliche Meldung kam unter Linux danach nicht mehr an. Sperrt der Virenschutz die
  `app.asar` selbst, startet schon das Fenster nicht (main.js liegt darin); dafür gibt es keine eigene Meldung.
  **Beim Entwickeln** (`npm run desktop`) läuft der Server aus den Quellen im Repo, ohne
  Bauschritt, mit `NKA_DATA_DIR` auf server/data. [main.js](../desktop/src/main.js) setzt zusammen, was
  [server.js](../desktop/src/server.js) ohne Electron prüfbar hält (Modul, Umgebung, Port, Startzeile, Links;
  desktop/test). Code bleibt JavaScript, geprüft mit `checkJs` über
  `npm run typecheck` ([typecheck-desktop.mjs](typecheck-desktop.mjs)); die Tests in desktop/test brauchen keine
  Installation und laufen mit `npm test`. Electron lädt seine Datei nicht beim Installieren (seit 42), sondern beim ersten
  `npm run desktop` bzw. mit `npx --prefix desktop install-electron`; npm 11 führt Installskripte nur mit Freigabe in
  `allowScripts` aus (desktop/.npmrc, electron-winstaller bleibt aus).
- **Server im Fenster** (Betriebsart `desktop`, aus dem Store `store`): Das Fenster setzt `NKA_DESKTOP=1`, aus dem Store
  zusätzlich `NKA_STORE=1` (`process.windowsStore`). Der Server glaubt das nur im utilityProcess (`process.parentPort`,
  `inWindow` in server/src/version.ts), sonst hielten sich Dev-Server oder Container mit geerbter Angabe für das Fenster;
  den Store erkennt er zur Sicherheit auch am Paketordner. Das Protokoll nennt in der ersten Zeile, was das Fenster
  sah (Electron, Node, Store ja/nein). Er lauscht
  nur auf 127.0.0.1 (`NKA_HOST`), außer mit Zugriff aus dem Heimnetz (unten), öffnet keinen Browser, Daten im Benutzerordner (Windows `%USERPROFILE%\Mietfuchs`
  wie der Store, macOS `~/Library/Application Support/Mietfuchs`), nie im Installationsordner (`chooseDataDir` entscheidet das vor `packaged`, das an Bun hängt). **Mit dem Fenster
  endet der utilityProcess**, auch nach einem Absturz oder beim Abmelden unter Windows (kein SIGTERM); es bleibt keine
  Waise, die Port und Datenbank hält, geprüft unter Windows und macOS (desktop-check.mjs, Schritt 5, auch über die PID).
  Die Standardeingabe eines utilityProcess ist immer leer und endet sofort; an ihr hängt nichts mehr. Beenden aus dem
  Fenster erst über `/api/quit` (die Schreibschlange läuft leer), ohne Adresse die Nachricht `quit` über `parentPort`,
  nach acht Sekunden hart, während des Starts erst nach zehn Minuten (eine Migration soll zu Ende laufen). Servertests
  stellen den utilityProcess mit [fakeUtilityProcess.ts](../server/testing/fakeUtilityProcess.ts) nach (`--import`). Electrons eigener Ordner heißt `mietfuchs-fenster`, damit er sich auf dem Mac nie mit dem Datenordner
  mischt; dort liegen `fenster.json` (gemerkter Port, Zugriff aus dem Heimnetz) und das Protokoll des Servers.
- **Port 17517** fest, damit Adresse und damit Entwürfe im Browser-Speicher gleich bleiben; antwortet dort ein
  anderes Programm, nimmt das Fenster einen freien und merkt ihn sich. Die Programmdatei ohne Fenster bleibt bei 3001.
- **Sicherheit**: Sandbox, `contextIsolation`, kein Node in der Seite; die Brücke ([preload.cjs](../desktop/src/preload.cjs))
  kennt nur das Drucken, den Zugriff aus dem Heimnetz, den Ordner-Dialog des Umzugs und die Updates; alles nimmt der Hauptprozess nur von der eigenen Seite an
  (`linkTarget(event.senderFrame.url, origin) === 'window'`). Navigation und neue Fenster bleiben auf der eigenen Adresse, http, https und mailto gehen ans
  Standardprogramm, alles andere nirgendwohin, Berechtigungen werden abgelehnt. Fuses in desktop/package.json (`build`):
  `runAsNode`, `NODE_OPTIONS` und Inspect aus, Asar-Integrität und `onlyLoadAppFromAsar` an; sein Modul lädt der
  utilityProcess aus derselben asar, die Integrität deckt es also mit ab.
- **Zugriff aus dem Heimnetz**: Karte in den Einstellungen ([NetworkCard.tsx](../client/src/components/NetworkCard.tsx),
  Logik in [desktopNetwork.ts](../client/src/desktopNetwork.ts)), nur wenn `window.mietfuchsDesktop.network` da ist,
  also nie im Browser oder auf dem Handy; der Typ der Brücke steht in client/src/desktop.d.ts. Die Brücke hat `get()`
  und `set(enabled)`, beide ergeben `{ enabled, port, addresses }` (`networkState`, `lanUrls` in server.js: IPv4 der
  äußeren Netzwerkkarten ohne 169.254.x.x). `set` schreibt `network` in fenster.json und startet den Server neu, mit
  `NKA_HOST=0.0.0.0` bzw. `127.0.0.1` und **demselben Port**, damit Origin und Browser-Speicher bleiben; danach lädt
  das Fenster die Seite neu. Ein absichtlich beendeter Server steht in `retired` und löst weder „unerwartet beendet“
  noch `app.quit` aus. Scheitert der Start mit der neuen Adresse, gilt wieder die alte. Beim ersten Einschalten fragt
  unter Windows die Firewall nach Mietfuchs.exe (der Server ist ein Prozess des Fensters); die Karte sagt das. Das Häkchen ist ein Entwurf (#309).
- **Drucken**: `window.print()` druckt in Electron ohne Hintergründe; das Preload leitet es auf `webContents.print`
  mit `printBackground` um. Geprüft mit [safari-print-check.mjs](safari-print-check.mjs) `--engines chromium,electron`
  (unter Linux mit `xvfb-run`): dieselben Fälle im Fenster, Seitenzahl gleich Chromium.
- **Bau** ([package-desktop.mjs](package-desktop.mjs), electron-builder): Vorher `npm run build` (client/dist, bringt
  mit Vite auch rolldown mit) und die Abhängigkeiten des Servers (`npm --prefix server ci --omit=dev` genügt). Das
  Skript bündelt den Server mit **rolldown aus client/node_modules** (über Vite aufgelöst, kein eigenes Werkzeug; ESM,
  Ziel node24.22) nach `dist-desktop-server/`. Extern bleiben nur `node:*`, `bun:sqlite` und das eingebettete Frontend
  der Programmdatei (beide hinter `globalThis.Bun`); jede Abhängigkeit ist bündelbar, ein unaufgelöster Import bricht
  den Bau ab. Weil `import.meta.url` im Bündel die eine Datei ist, schreibt `rewriteImportMeta` es je Modul auf den
  Ort im Repo um (so stimmen die Wege nach `client/dist.pack` und, beim Entwickeln, `server/data`); anderes an
  `import.meta` und Abhängigkeiten, die es nutzen, brechen ab. Die Migrationen kommen über `migrationsFromDisk` ins
  Bündel, also genau wie unter Node gelesen. Die Lizenzen der gebündelten Pakete schreibt der Bau daneben, sie fehlen
  sonst mit node_modules. `checkServerFolder` verlangt genau die drei Dateien.
  `files` (FileSet `from: ../dist-desktop-server`, `to: mietfuchs`) nimmt den Ordner in die `app.asar` mit, für jede
  Architektur derselbe (keine nativen Module). Nach dem Bau prüft `checkServerArchive` jede gebaute asar am Kopf
  (`asarFiles`, ohne @electron/asar): genau die drei Dateien unter `mietfuchs/`, keine entpackt, jede mit Prüfsummen;
  release.yml prüft dasselbe am installierten Fenster und dass kein `resources/mietfuchs` mehr offen daliegt.
  `node scripts/package-desktop.mjs server` legt nur den Ordner an. Windows ein Installer für x64 und ARM64
  zusammen (`Mietfuchs-Setup-<Version>.exe`, NSIS für den Benutzer, ohne Adminrechte; `latest.yml` des Updaters kennt
  keine Architektur). Daneben legt electron-builder je
  Architektur den entpackten Ordner ab (`dist-desktop/win-unpacked`, `win-arm64-unpacked`), den Inhalt des
  Store-Pakets. macOS je ein .dmg, ad hoc signiert (`identity: "-"`, ohne Notarisierung), der Server
  in `Contents/Resources/mietfuchs`; electron-builder nennt die Architektur arm64 und x64, das Skript benennt danach um in
  `Mietfuchs-<Version>-apple-silicon.dmg` und `-intel.dmg` (`userFileName`, wie die Zips der Programmdateien).
  **Kein Web-Installer** (`nsis-web`, lädt nur das Paket der eigenen Architektur): In electron-builder 26.18 wählt er
  ARM64 nur, wenn es auch ein 32-Bit-Paket gibt (`installApplicationFiles` in
  app-builder-lib/templates/nsis/include/installer.nsh und `downloadApplicationFiles` in webPackage.nsh, Zweig
  ohne `APP_32_NAME`); mit x64 und ARM64 bekäme ein ARM-Rechner das x64-Paket. Der gemeinsame Installer wählt richtig (`identify_package` in extractAppPackage.nsh).
- **Eigene Teile des Windows-Installers** ([../desktop/build/installer.nsh](../desktop/build/installer.nsh), über
  `nsis.include`; electron-builder setzt die Datei in den Kopf des Skripts, vor seine Vorlagen in
  app-builder-lib/templates/nsis, für Installer und Deinstallationsprogramm derselbe Kopf, dort mit `BUILD_UNINSTALLER`):
  **Zeitprotokoll** nach `%TEMP%\mietfuchs-installation.log` (UTF-16, Ortszeit mit Millisekunden, Sekunden seit dem
  Start, je Zeile eine Marke wie `[pruefung-ende]`), an den Haken `customInit`, `customCheckAppRunning`,
  `customUnInstallCheck` (nach dem Deinstallieren der vorigen Fassung), `customFiles_x64`/`_arm64` (nach dem
  Auspacken), `customInstall`, `customUnInit`, `customUnInstall` und `unregisterFileAssociations` (nach dem Entfernen
  der Dateien). Die beiden letzten Haken legt electron-builder selbst nur für vorkomprimierte Dateien bzw.
  Dateizuordnungen an; käme so etwas dazu, bricht der Bau laut ab. NSIS übernimmt beim Schreiben die Zeitstempel aus
  dem Bau, echt sind nur Anlagezeiten neuer Kopien. **Prüfung auf ein laufendes Mietfuchs mit tasklist** statt der
  Vorlage, die bis zu dreimal PowerShell startet (beim Aktualisieren samt altem Deinstallationsprogramm sechsmal):
  gemessen auf windows-11-arm 7 bis 18 Sekunden je Prüfung, mit tasklist 0,2 bis 1. **Die Kopie des Installers**
  nach `%LOCALAPPDATA%\mietfuchs-updater\installer.exe` (rund 230 MB, `installApplicationFiles` der Vorlage) bleibt:
  Sie ist die alte Datei der Teil-Downloads von electron-updater (unten, „Automatische Updates“). Von PR #541 bis
  zum Updater unterdrückte der Installer sie; das Deinstallationsprogramm entfernt sie (`customUnInstall`, nicht beim
  Aktualisieren). Die Deinstallation fasst nach, wenn `RMDir /r` eine gerade geöffnete Datei übergeht (in der CI blieb so
  Mietfuchs.exe liegen). Prüfen ohne Windows: makensis aus dem Cache von electron-builder läuft unter Linux;
  `electron-builder --win nsis --x64 --prepackaged <Ordner mit Attrappe>` mit einem `wine`, das nur das
  Deinstallationsprogramm kopiert, übersetzt beide Durchläufe.
- **Automatische Updates** (nur Windows mit dem Installer; [updater.js](../desktop/src/updater.js), eingesetzt in
  main.js, Oberfläche in client/src/desktopUpdater.ts und components/DesktopUpdater.tsx): **electron-updater 6.8.11**,
  fest gepinnt, als einzige Abhängigkeit in der asar; erschienen am selben Tag wie electron-builder 26.18.0 und mit
  demselben builder-util-runtime 9.7.0. Quelle sind die Releases von speedone/mietfuchs (`build.publish` in
  desktop/package.json, `releaseType: release`). **Nicht** im Store (`process.windowsStore`), nicht auf dem Mac
  (Squirrel.Mac verlangt eine bezahlte Developer-ID-Signatur), nicht beim Entwickeln (`updaterSource`).
  - **Release-Dateien**: Mit `build.publish` legt electron-builder auch bei `--publish never` `latest.yml` und
    `Mietfuchs-Setup-<Version>.exe.blockmap` neben den Installer (`artifactCreatedWithoutExplicitPublishConfig` in
    app-builder-lib/out/publish/PublishManager.js schreibt die Update-Infos außerhalb von `if (this.isPublish)`;
    `createBlockmap` in NsisTarget.js, weil `differentialPackage` an ist). Ohne Quelle entstand nur die .blockmap
    (geprüft mit `--prepackaged` und dem wine-Ersatz oben). „Programmfenster bauen (Windows)“ prüft beide und lädt
    sie hoch, „Ans Release anhängen“ hängt sie an, `latest.yml` in einem eigenen Schritt zuletzt (erst dann sehen die
    Fenster die neue Version, und Installer und .blockmap liegen schon da). `latest.yml` kennt keine Architektur; der eine Installer für x64
    und ARM64 passt dazu.
  - **Keine Signatur**: `win.verifyUpdateCodeSignature: false`, also kein `publisherName` in app-update.yml, und ohne
    ihn prüft NsisUpdater nicht (`verifySignature` in electron-updater/out/NsisUpdater.js). Ein Zertifikat für
    Windows gibt es nicht. Die **SHA-512** aus latest.yml prüft electron-updater trotzdem: beim vollen Download
    (`DigestTransform` in builder-util-runtime/out/httpExecutor.js, `executeDownload` reicht `sha512` weiter), beim
    Teil-Download (`DigestTransform` in differentialDownloader/DifferentialDownloader.js) und bei einer schon
    geladenen Datei (`validateDownloadedPath` in DownloadedUpdateHelper.js). Sie kommt aus demselben Release wie der
    Installer: Sie fängt beschädigte und abgebrochene Downloads ab, nicht ein fremdes Release; das hält nur HTTPS zu
    GitHub und das Konto, das veröffentlicht.
  - **Zustimmung**: Das Fenster liest vor jeder Prüfung `updateCheck` aus `GET /api/settings` über 127.0.0.1; nur
    `'on'` zählt. Geprüft wird beim Start, danach höchstens einmal am Tag (Takt eine Stunde), nach einem Fehler nach
    einer Stunde, „Jetzt prüfen“ höchstens einmal pro Minute; das gerade gesetzte Häkchen löst eine Prüfung aus, wenn
    heute noch keine lief. `allowPrerelease` und `allowDowngrade` aus, auch wenn die installierte Fassung eine
    Vorabversion ist (electron-updater setzt `allowPrerelease` sonst danach), `disableWebInstaller` an. **Keine
    Kennung der Installation**: electron-updater legt sonst `userData/.updaterId` an und schickt sie als
    `x-user-staging-id` bei jeder Prüfung mit; das Fenster setzt sie auf Nullen (`NO_INSTALLATION_ID`), weil das
    Häkchen zusagt, dass GitHub nur IP-Adresse und Version sieht.
  - **Installieren**: `autoInstallOnAppQuit` bleibt aus. electron-updater hängt seinen Haken ans `quit`-Ereignis nur,
    wenn der Schalter beim Ende des Downloads an ist (`addQuitHandler` in BaseUpdater.js), und er käme nach
    `before-quit`, ohne Gewähr, dass der Server dann beendet ist. Stattdessen: **„Beim nächsten Start“** merkt die
    Wahl, `before-quit` beendet erst den Server und ruft dann `installOnQuit` (still, ohne anschließenden Start); ohne
    Wahl bleibt die Datei im Zwischenspeicher, und der Hinweis kommt beim nächsten Start ohne neuen Download wieder.
    **„Jetzt neu starten“** beendet den Server über `/api/quit`, dann `install(true, true)` (still, `--force-run`),
    dann `app.quit`. Vorher prüft es, dass die geladene Datei noch da ist; danach wartet es 1,5 Sekunden auf ein
    `error` (electron-updater startet den Installer asynchron); scheitert der Start, startet der Server wieder.
    „Jetzt neu starten“ läuft in derselben Reihe (`restarting`) wie der Neustart für den Heimnetz-Schalter, auf die
    `before-quit` wartet. Der Installer prüft wie immer
    auf ein laufendes Mietfuchs (`customCheckAppRunning`); der Server ist dann schon beendet. Die Sicherung vor dem
    Migrieren legt der Server beim ersten Start der neuen Version an (`backupBeforeMigrating`), wie bei jedem
    Update. Vom Installer gestartet, läuft Mietfuchs über die Verknüpfung im Startmenü (`ExecShellAsUser` in
    templates/nsis/common.nsh), erbt also nicht unbedingt die Umgebung des alten.
  - **Brücke** `updater`: `get`, `check({ force })`, `later`, `restart`, `onChange`; Absenderprüfung wie Drucken und
    Netzwerk. Ohne Updater meldet sie `phase: 'off'`, dann gilt der Hinweis des Servers. Im Fenster unter Windows
    zeigt die Seitenleiste nur „Version x ist bereit“ und „Über Mietfuchs“ den Stand des Fensters („wird
    heruntergeladen“, „bereit“, Fehler mit Weg zur Release-Seite) statt der Anleitung; nie beide Hinweise. Protokoll
    in `mietfuchs-fenster\protokoll\updater.log`.
  - **Mac**: Der Update-Hinweis des Servers führt auf `Mietfuchs-<Version>-apple-silicon.dmg` bzw. `-intel.dmg`
    (`desktopDmgName` in server/src/update.ts) mit Anleitung (Abbild öffnen, in „Programme“ ziehen, „Ersetzen“). Läuft
    Mietfuchs nicht aus „Programme“, bietet es vor dem Start des Servers einmal `app.moveToApplicationsFolder()` an,
    „Nicht verschieben“ steht als `moveDeclined` in fenster.json; nicht mit `CI`.
  - **Andere Quelle nur mit `CI`**: `MIETFUCHS_UPDATE_FEED` (nur `http://127.0.0.1:…`) lenkt auf einen lokalen
    Server, für die Probe unten und für Bildschirmfotos unter Linux (ungepackt mit `forceDevUpdateConfig`, dort heißt
    die Kanaldatei `latest-linux.yml`). Im ausgelieferten Betrieb ließe eine untergeschobene Variable sonst die
    Updates von einem fremden Server laden, samt passender Prüfsumme.
  - **Echte Probe** (Jobs „Programmfenster bauen (Windows, zweite Fassung …)“ und „Automatisches Update prüfen auf
    Windows x64/ARM64“ in release.yml, [updater-check.mjs](updater-check.mjs)): Die zweite Fassung baut
    [updater-probe.mjs](updater-probe.mjs) mit der nächsten Patch-Version und einem Migrationsschritt ohne Wirkung
    (sonst gäbe es keine Sicherung zu prüfen). Die Probe installiert v1, bietet v2 über einen lokalen HTTP-Server mit
    Protokoll an (einzelne Bereiche, deshalb `useMultipleRangeRequest: false`), prüft ohne Zustimmung, dass keine
    Anfrage ankommt, dann „Jetzt neu starten“ und, nach erneuter Installation von v1, „Beim nächsten Start“, beide
    über die Knöpfe der Oberfläche (DevTools-Protokoll, `--remote-debugging-port`); danach v2 mit allen Daten und
    `mietfuchs.sqlite.vor-<Schritt>`.
- **Installer messen** (Job in release.yml, nur im vollen Prüfumfang,
  [../desktop/build/installer-messung.ps1](../desktop/build/installer-messung.ps1)): dreimal installieren, darüber installieren und deinstallieren, einmal bei laufendem Mietfuchs, auf windows-11-arm
  und windows-2025; Phasen aus dem Zeitprotokoll, Schreibzugriffe aus einem FileSystemWatcher, Stand und
  Ereignisprotokoll von Defender. **Defender auf den Runnern ist kein Nutzerrechner:** Auf beiden sind `C:\` und
  `D:\` ausgenommen, der Cloud-Schutz ist aus (MAPSReporting 0), auf windows-2025 auch der Echtzeitschutz (lässt
  sich nicht einschalten). Was das Prüfen der Dateien kostet, zeigt nur das Protokoll vom Rechner eines Nutzers. Der
  Vergleich mit der Prüfung der Vorlage steht in PR #537.
- **Umzug der Daten** (server/src/CLAUDE.md, „Umzug ins Programmfenster“): Die Brücke kennt dafür `chooseFolder`
  (Ordner-Dialog, Absenderprüfung wie Drucken und Netzwerk, `chosenFolder` in server.js gibt nur den Pfad weiter).
  desktop-check.mjs prüft ihn in Schritt 6 unter Windows und macOS: der Bestand aus Schritt 1 in `Downloads/…/data`
  neben einer Datei `mietfuchs-win.exe` bzw. `mietfuchs-macos-apple-silicon` unter `NKA_TEST_HOME`, das Fenster mit
  leerem Datenordner findet und übernimmt ihn. Mit echten alten Fassungen läuft
  [fenster-umzug-praxislauf.mjs](fenster-umzug-praxislauf.mjs) (unten).
- **Im Release-Lauf** ([release.yml](../.github/workflows/release.yml), Jobs „Programmfenster bauen“ und
  „Programmfenster prüfen auf …“, in jedem Prüfumfang): Der Bau hängt an keinem Bun-Artefakt und beginnt sofort; er
  baut das Frontend selbst. Installiert wie ein Nutzer und geprüft mit [desktop-check.mjs](desktop-check.mjs) (Start,
  smoke-test, zweiter Start, Beenden, Absturz des Fensters, jeweils auch über die PID des Servers) auf Windows x64 und
  ARM64, macOS Apple Silicon und Intel; Größen, Dauer der Installation, Startzeit und Speicher von Fenster und Server
  in der Zusammenfassung. **Kein eigener Workflow mehr**: Das frühere desktop.yml ist in release.yml
  aufgegangen, weil ein PR dort so lange läuft wie desktop.yml allein (rund sechs Minuten), weil eine Änderung am
  Fenster jetzt auch das Store-Paket ändert, das nur release.yml prüft, und damit Bau und Prüfung an einer Stelle
  stehen. Deshalb steht `desktop/**` in der Pfadliste von release.yml.

## Microsoft Store

- **MSIX** (#500, [package-msix.mjs](package-msix.mjs), Manifest
  [../packaging/msix/AppxManifest.xml](../packaging/msix/AppxManifest.xml), Symbole in `packaging/msix/Assets`):
  je Architektur ein `.msix`, zusammen ein `.msixbundle`, unsigniert (der Store signiert). Nur unter Windows
  (makeappx aus dem Windows SDK). **Eingepackt wird das Programmfenster** (#517): der entpackte Ordner aus
  package-desktop.mjs (`dist-desktop/win-unpacked`, `win-arm64-unpacked`), `Executable` im Manifest ist
  `Mietfuchs.exe`, der Befehlsalias heißt weiter `mietfuchs.exe` und zeigt darauf. Der Server liegt darin als Bündel
  in `resources\app.asar` und läuft als utilityProcess von Mietfuchs.exe; eine eigene ausführbare Datei, die ein
  Konsolenfenster öffnen könnte, gibt es nicht mehr. Vor dem Packen prüft `checkWindowFolder` Mietfuchs.exe am PE-Kopf
  (Architektur des Pakets, kein Konsolenfenster), den Server in der asar mit `checkServerArchive` und dass kein offener
  `resources\mietfuchs` mehr daliegt. Identität aus dem Partner Center (`speedone.Mietfuchs`, Store-ID
  `9PMHZ0ZJPZDZ`); `STORE_PACKAGE_NAME` in server/src/paths.ts muss dazu passen.
- **Version**: vier Teile, der erste nicht 0, der vierte immer 0, und der Store nimmt nur höhere an. Deshalb
  `msixVersion`: Hauptversion plus 1 (0.14.2 wird 1.14.2.0), für immer festgelegt.
- **Betriebsart `store`** (server/src/version.ts, erkannt am Paketordner unter `WindowsApps`): kein Update-Abgleich
  mit GitHub, keine Frage danach, Beenden aus der Oberfläche. **Daten in `%USERPROFILE%\Mietfuchs`**, nicht unter
  AppData: Dorthin schreibende Store-Apps lenkt Windows in einen Paketordner um und löscht ihn beim Deinstallieren.
  Abschalten ginge nur mit `unvirtualizedResources`, das Microsoft für Spiele vorsieht; außerhalb von AppData lenkt
  Windows nichts um. Nicht „Dokumente“, weil OneDrive den Ordner oft abgleicht.
- **Im Fenster ist die Betriebsart `store`** (`NKA_STORE` aus `process.windowsStore`, zur Sicherheit auch der Ort): Port 17517 wie das Fenster
  ohne Store, Daten in `%USERPROFILE%\Mietfuchs`. Electrons eigener Ordner (`%LOCALAPPDATA%\mietfuchs-fenster`,
  gemerkter Port, Zugriff aus dem Heimnetz, Protokoll des Servers) liegt dagegen unter AppData und landet umgelenkt in
  `%LOCALAPPDATA%\Packages\speedone.Mietfuchs_…\LocalCache\Local`; das ist gewollt, beim Deinstallieren geht
  nur er verloren.
- **Prüfung** (Job „Store-Paket bauen und prüfen“ in release.yml, bei jedem Lauf): signiert eine Kopie mit einem
  Wegwerf-Zertifikat desselben Herausgebers, installiert sie, startet über den Befehlsalias `mietfuchs.exe` (nur so
  erbt das Fenster `CI` und `NKA_UPDATE_URL` und reicht sie über `serverEnv` an den Server weiter, der Start übers
  Startmenü reicht nichts weiter), Prüfskript auf Port 17517 mit `--mode store`, Fenster und Server laufen aus dem
  Paket (der Server als utilityProcess von Mietfuchs.exe, erkannt an `node.mojom.NodeService` in der Befehlszeile),
  Beenden über `/api/quit` (das Fenster geht mit dem Server), deinstallieren; die Datenbank muss danach noch
  in `%USERPROFILE%\Mietfuchs` liegen. Scheitert etwas, steht das Protokoll des Servers im Log.
- **Einreichen** ([store.yml](../.github/workflows/store.yml), von release.yml aufgerufen): beim Tag ohne Bindestrich,
  nach dem Anhängen ans Release, nur mit der Repository-Variable `MSSTORE_EINREICHEN = an`.
  [store-submit.mjs](store-submit.mjs) spricht die Submission-API des Partner Centers unmittelbar an: offenen Entwurf
  löschen, neue Einreichung als Kopie der veröffentlichten anlegen, umbauen, ein ZIP mit Paket und
  Bildschirmfotos hochladen, abschicken, auf die Prüfung des Uploads warten. Umgebaut wird nur, was das Skript
  setzt: das `.msixbundle`, die Bildschirmfotos (`SCREENSHOTS`, aus `docs/screenshots`), Beschreibung, Funktionen
  und Suchbegriffe aus [../packaging/msix/store-eintrag.md](../packaging/msix/store-eintrag.md), „Neuigkeiten in
  dieser Version“ (Version und Link aufs Release) und „nach der Zertifizierung sofort veröffentlichen“. Alles
  andere bleibt, wie es im Partner Center steht, auch Felder, die das Skript nicht kennt. **Texte des Eintrags
  ändert man deshalb in store-eintrag.md**, eine Änderung im Partner Center überschreibt das nächste Release. Im
  Partner Center auch keine Einreichung beginnen („Aktualisieren“): Einen solchen Entwurf darf die API nicht
  löschen, er blockiert die nächste Einreichung, bis er dort von Hand gelöscht ist (so beim Nachreichen von 0.14.0).
  Nicht die Store-CLI (`msstore publish`): Die lädt keine Bilder hoch und legt unter Linux die Zugangsdaten im
  Schlüsselbund ab, den ein Runner nicht hat; daran scheiterte v0.14.0. `--dry-run <Ordner>` liest nur und
  schreibt die umgebaute Einreichung und das ZIP dorthin.
  Scheitert die Einreichung beim Tag, startest du store.yml von Hand mit der Nummer des Release-Laufs; das reicht
  dessen Paket mit Texten und Bildern im Stand von main ein, sofern der Lauf ans Release angehängt hat. Die
  Variable zählt dann nicht. Die **erste Einreichung geht von Hand** im Partner Center (die API aktualisiert nur
  eine veröffentlichte App). Zugang: Entra-Anwendung `mietfuchs-github` (Rolle Manager), Secrets
  `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, `MSSTORE_CLIENT_SECRET` (`MSSTORE_SELLER_ID` braucht nur die CLI); das
  Secret läuft ab und wird dann im Partner Center neu erzeugt.

- **Umzug der Daten auch im Store** (#517): Die Store-App bietet „Ihre bisherigen Daten übernehmen“ wie das Fenster an.
  Anders als dort **liest sie die Ortsdatei nur** (`%LOCALAPPDATA%\mietfuchs-standorte\standorte.json`; Lesen fällt bei
  MSIX auf den echten Ort durch) und vermerkt den neuen Ort nicht: Unter AppData lenkte Windows das Schreiben einer
  Store-App in ihren Paketordner um, die Programmdatei sähe es nie. Geschrieben wird nur in den Datenordner
  `%USERPROFILE%\Mietfuchs` (nicht umgelenkt) und der Vermerk in den alten Ordner. Liegt der alte Ordner selbst unter
  AppData (Ausweichort `%LOCALAPPDATA%\Mietfuchs` der Programmdatei), landete der Vermerk umgelenkt im Paket; dieser Fall
  ist bekannt und hingenommen. Geprüft in „Store-Paket bauen und prüfen“: Nach der ersten Prüfung wird der Bestand zum
  Ordner einer alten Programmdatei unter `Downloads\mietfuchs-alt`, die Ortsdatei nennt ihn, die Store-App (mit
  `NKA_TEST_HOME` auf dem Benutzerordner des Runners) übernimmt; danach Daten in `%USERPROFILE%\Mietfuchs`, Vermerk im
  alten Ordner, Ortsdatei unverändert. Nachgestellt in api-umzug.test.ts mit `NKA_TEST_STORE=1`.

## Release

- [release.yml](../.github/workflows/release.yml) baut beim `v*`-Tag alle Ziele und hängt sie an:
  macOS als Zip, Linux als tar.gz (Ausführungsbit), Windows roh. **Die Namen der x64-Dateien bleiben
  fest**, der Update-Hinweis älterer Versionen sucht sie. Dazu das Programmfenster (#517):
  `Mietfuchs-Setup-<Version>.exe`, `Mietfuchs-<Version>-apple-silicon.dmg` und `-intel.dmg`. Die
  Programmdateien bleiben vorerst daneben, bis PR 3 von #517 die Daten aus dem Ordner neben der
  Programmdatei von selbst in den Benutzerordner umzieht; ohne das fänden Nutzer ihre Daten im Fenster
  nicht.
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
- **[fenster-umzug-praxislauf.mjs](fenster-umzug-praxislauf.mjs)** (#517): lädt die Linux-Programmdateien 0.3.1 und
  0.7.1 (db.json), 0.9.0, 0.12.0 und 0.14.1 von den Releases (höchstens 150 MB, drei Minuten je Datei, drei Versuche,
  zwischengespeichert in `--cache`, nie ins Repo, beim Laufen fest verknüpft statt kopiert), startet jede wie draußen
  aus `Downloads/mietfuchs-<Fassung>/` mit `data/` daneben (HOME im Wegwerf-Ordner, CI, ohne Anzeige), legt den Bestand
  über ihre API an (Backup mit db.json und zwei Belegen, dann eine Zahlung; bis 0.3 legt erst ein Speichern die db.json
  an) und holt Abrechnung 2024, Zahlen und Backup. Dann übernimmt der Server von heute als nachgestelltes Fenster den
  Ordner (Suche, laufende alte Fassung erkennen und beenden, vor 0.7 statt dessen ihr Fenster schließen, übernehmen) und prüft: Abrechnung
  centgenau wie in der alten Fassung **und** wie der Server von heute an Ort und Stelle auf einer Kopie, Zahlen, Belege
  mit Inhalt, Vermerk, alter Ordner sonst byteweise und mit Dateizeit gleich, danach nur lesend. Dann legt die alte
  Fassung, die den Vermerk nicht kennt, noch eine Zahlung an; das Fenster meldet `newer` und übernimmt den neueren Stand
  erst auf Wunsch. Ebenso über das Backup.
  Beide Mietverhältnisse laufen das ganze Jahr, weil Mietfuchs Leerstand seit 0.3 anders rechnet. Job „Umzug ins
  Programmfenster mit alten Fassungen“ in release.yml im vollen Umfang; `--nur 0.3.1` für eine Fassung, `--out` für den
  Bericht. Nur unter Linux.
- **Prüfumfang je Anlass** (#52), entschieden im Job „Prüfumfang festlegen“ in release.yml: **Ein PR
  ohne Label** prüft Tests und Build ([ci.yml](../.github/workflows/ci.yml)), Bauen und Signieren,
  die sechs Programmdateien ohne lange KI-Antwort, `centos:7` und `ubuntu:26.04`, das `.deb` auf
  Ubuntu 24.04 und das `.rpm` auf Fedora. **Alles** (alle Distributionen und Pakete, ARM64-Container,
  lange KI-Antwort, Browserlauf) läuft beim Tag, mittwochs 4:23 UTC auf `main` (das Netz gegen eine
  fehlerhafte Bun-Fassung; nach 60 Tagen ohne Bewegung schaltet GitHub Zeitpläne ab), von Hand und
  mit dem Label `full-check`. Die Bedingung ist als Ausnahme geschrieben (vollständig außer am PR
  ohne Label), damit ein neuer Auslöser im Zweifel zu breit läuft. Das Programmfenster und das
  Store-Paket laufen in jedem Umfang. Am PR läuft release.yml nur,
  wenn er Server, Oberfläche, Programmfenster, Skripte, Paketierung oder die Datei selbst anfasst. **Eine leere
  Matrix erzeugt keinen Job und keinen Fehler**, deshalb bricht „Prüfumfang festlegen“ bei einer
  leeren Liste ab. „Ans Release anhängen“ wartet auf alles, auch auf den Browserlauf.
