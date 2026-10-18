# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

**Mietfuchs** — lokales Web-Tool für die Nebenkostenabrechnung privater Vermieter (Deutschland).
Alles läuft auf dem eigenen Rechner — keine Cloud, kein Konto. Sprache von UI, Kommentaren und
Domänenbegriffen ist durchgängig **Deutsch**; bitte beibehalten. Bezeichner im Code sind dagegen
**englisch** (siehe Konventionen).

## Commands

Vom Repo-Root (npm-Workspaces-artiges Setup ohne echte Workspaces — `postinstall` installiert
Server und Client mit):

```powershell
npm install        # installiert Root + server + client
npm run dev        # concurrently: Server (Port 3001) + Vite (Port 5173)
npm test           # alle Tests: Server (node:test) + Client (vitest)
npm run test:server # nur Engine- und API-Tests
npm run test:client # nur Formularlogik- und Komponententests
npm run build      # baut das Frontend nach client/dist (tsc --noEmit + vite build)
npm run typecheck  # nur Typprüfung: Server, Skripte, Client, vite.config.ts (tsc), ohne Build
npm --prefix server run db:generate # neue Migration aus server/src/db/schema.ts erzeugen
npm start          # Produktivbetrieb: Server liefert App + API auf Port 3001
npm run package    # baut eigenständige Binaries nach dist-bin/ (braucht Bun)
npm run package:linux # baut daraus .deb/.rpm/Arch-Pakete (braucht nFPM oder Docker)
npm run screenshots # Bildschirmfotos fürs README nach docs/screenshots (braucht Playwright-Chromium)
npm run browser-check # Browserlauf: jede Seite in Chromium, Firefox, WebKit mit axe (braucht die drei Browser)
```

**Bildschirmfotos fürs README**: [scripts/screenshots.mjs](scripts/screenshots.mjs) (`npm run
screenshots`) erzeugt die Bilder in `docs/screenshots/` neu und gehört zu jedem Release. Es baut
die Oberfläche (`--skip-build` lässt das aus), startet den Server wie `npm start` mit den drei
Angaben jedes Prüfstarts (siehe unten) und das nachgebaute Ollama aus
[scripts/fake-ollama.mjs](scripts/fake-ollama.mjs), legt per API einen Beispielbestand an
([scripts/demo-stock.mjs](scripts/demo-stock.mjs), denselben nimmt der Browserlauf) und
fotografiert mit Playwright bei 1440 × 900 im hellen Design. **Der Bestand ist erfunden**: ein
Mehrfamilienhaus „Lindenweg 12, 12345 Musterstadt“ mit selbstgenutzter Dachwohnung, Garage,
Mieterwechsel mit Leerstand, Zählern, Zahlungen und Belegen (vom selben Browser als PDF gedruckt),
dazu eine vermietete Eigentumswohnung mit Kosten laut Hausgeldabrechnung; die IBAN ist die
veröffentlichte Beispiel-IBAN `DE02 1203 0000 0000 2020 51` (gültig, denn seit #279 lehnt der Server
eine ungültige ab). Echte Namen, Adressen oder Belege gehören nie hinein. Das Abrechnungsjahr ist das
Vorjahr, wie es die Oberfläche voreinstellt. Playwright ist devDependency im Wurzelpaket, den
Browser lädt einmalig `npx playwright install chromium`. Meldet die Oberfläche einen Fehler oder
steht eine Fehlermeldung im Bild, bricht das Skript ab; die Bilder trotzdem vor dem Commit
ansehen. Bestehende Dateinamen beibehalten, das README verlinkt sie.

**Browserlauf** (#340, Schritt 11 von #346): [scripts/browser-check.mjs](scripts/browser-check.mjs)
(`npm run browser-check`) legt denselben Beispielbestand an, dazu eine Heizanlage für die Seite
Heizkosten, und geht jede Seite der Navigation in Chromium, Firefox und WebKit (die Engine von
Safari) durch, bei 1440 × 900 und 390 × 844, hell und dunkel. Je Seite: keine Konsolenfehler, keine
sichtbare Fehlermeldung, `scrollWidth` nicht größer als das Fenster, kein abgeschnittenes Feld (auch in
den Seitenfenstern der Seite, siehe „Felder in Stufen“), und axe-core
(`@axe-core/playwright`, MPL-2.0) ohne Verstöße der Stufen serious und critical. Dazu je Engine
und Ansicht Bedienproben per Tastatur: Seitenfenster (Esc fragt, Fokus auf „Abbrechen“, Enter
lässt offen, „Verwerfen“ schließt), Monatsfeld (Text und Raster), Begriffserklärung, die
Sammelmeldung nach „Ablesung speichern“ (sichtbar, mit Fokus) und am Handy Menüblatt und untere
Leiste; axe läuft auch auf diesen offenen Zuständen. Jeder Befund ergibt Exit-Code 1 und eine
Zeile im Bericht (`<out>/bericht.md`, in Actions die Zusammenfassung); die Fotos landen in `--out`
(Vorgabe im Temp-Ordner, nie im Repo). Ausnahmen für axe stehen mit Grund und Anzahl in
[scripts/browser-check-axe.json](scripts/browser-check-axe.json) und dürfen nur sinken: Mehr ist
ein Befund, weniger nach einem Lauf über alle drei Engines ebenfalls, bis die Zahl gesenkt ist
(`--merge` fasst die Läufe der CI zusammen). Heute ist die Liste leer. Zum Nachprüfen grenzen
`--engines`, `--views`, `--themes` und `--pages` ein (`--pages -` nur die Bedienproben); eine
unbekannte Seite in `--pages` oder ein Lauf ohne geprüfte Seite ist ein Befund, ebenso eine Seite aus
[client/src/nav.ts](client/src/nav.ts), die in der Navigation fehlt. WebKit
braucht unter Linux GTK4; fehlt es, läuft er im Container `mcr.microsoft.com/playwright:v<Fassung
aus package-lock.json>-noble` (Befehl im Kopf des Skripts). In release.yml läuft er je Engine als
Job „Browserlauf“ im vollen Prüfumfang, nicht an jedem PR, und „Ans Release anhängen“ wartet auf
ihn. **Probe von Hand bleibt** „Als PDF sichern“ in Safari auf dem Mac (#286): WebKit unter Linux
druckt in Playwright nicht, und echtes Safari gibt es nur auf Apple-Geräten.

**Eigenständige Binaries** (für Endanwender ohne Node): [scripts/package-binaries.mjs](scripts/package-binaries.mjs)
kompiliert Server + eingebettetes Frontend per **Bun `--compile`** zu je einer Datei pro
Plattform (Windows/macOS-Intel/macOS-ARM/Linux) in `dist-bin/`. `node scripts/package-binaries.mjs win`
baut nur ein Ziel. Bun wird gewählt, weil der Server ESM ist, was pkg/SEA nicht bündeln
kann. Native Module lassen sich so nicht für alle Ziele einbetten, der Server kommt deshalb
bewusst ohne aus (siehe KI-Belegauswertung). Das Frontend wird beim Build über
[scripts/embed-client.mjs](scripts/embed-client.mjs) aus `client/dist` in das generierte
(gitignorierte) Modul `server/src/embedded-client.js` eingebettet (Bun-Importattribut
`with { type: 'file' }`) und im gepackten Betrieb daraus ausgeliefert. In der Binary erkennt der
Server den gepackten Modus an `globalThis.Bun`: Daten landen dann in `data/` **neben der
ausführbaren Datei** (nicht in `server/data`), und der Standard-Browser wird automatisch geöffnet.
Wo die Daten liegen, entscheidet `chooseDataDir` in [server/src/store.ts](server/src/store.ts).

**Linux-Pakete** (#25): [scripts/package-linux.mjs](scripts/package-linux.mjs) (`npm run
package:linux`) baut aus denselben Linux-Programmdateien `.deb`, `.rpm` und das Arch-Paket, je
für x64 und ARM64. Gebaut wird mit **nFPM** nach [packaging/nfpm.yaml](packaging/nfpm.yaml),
das alle Formate aus einer Vorschrift erzeugt; nFPM kommt von der Platte oder aus seinem
Container, mehr als Docker braucht der Rechner nicht. Das Paket legt die Programmdatei nach
`/usr/bin`, dazu [packaging/mietfuchs.desktop](packaging/mietfuchs.desktop) (Startmenü,
`Terminal=false`, siehe unten) und das Symbol als SVG und PNG. Dort installiert, kann der Server nicht neben sich schreiben, deshalb liegen die Daten
dann in `~/.local/share/mietfuchs` (XDG; entsprechend unter Windows und macOS). Die Regel dafür
steht in `systemLocation` ([server/src/paths.ts](server/src/paths.ts), gemeinsame Quelle für
Datenordner und Betriebsart): ein Systemort (`/usr`, `/opt`, `Program Files`) führt immer in den
Benutzerordner, auch mit Schreibrecht, sonst würde ein Start als Administrator die Daten dorthin
legen, wo der normale Benutzer sie nicht wiederfindet. Der Heimatordner wird erst gesucht, wenn
er gebraucht wird: `os.homedir()` wirft ohne `HOME` und ohne Eintrag in der Benutzerdatenbank
(Container mit `--user`), und das darf den Start nicht verhindern. Dieselbe Regel ergibt die
Betriebsart `package` ([server/src/version.ts](server/src/version.ts)): Der Update-Hinweis
erklärt dann das Neuinstallieren des Pakets statt des Austauschens der Datei. Beim Start nennt
der Server den Datenordner in der zweiten Zeile. Vor dem Release wird jedes Format in einem
Container seiner Distribution installiert, als gewöhnlicher Benutzer gestartet und mit
[scripts/smoke-test.mjs](scripts/smoke-test.mjs) geprüft (`--mode package`).

**Start aus dem Startmenü** (#45): Der Eintrag hat `Terminal=false`. Mit `Terminal=true` startet
auf Systemen ohne Terminalprogramm gar nichts, und zwar ohne sichtbare Meldung („Unable to find
terminal required for application“, nachgestellt mit `gio launch`). Ohne Konsolenfenster fehlen
zwei Dinge, die es leistete, deshalb gibt es dafür Ersatz: `POST /api/quit` beendet den Server
aus der Oberfläche (Knopf in der Seitenleiste, nur wenn `STANDALONE`, also Betriebsart `binary`
oder `package`); ein Start auf belegtem Port fragt `/healthz` und beendet sich still mit Code 0,
wenn dort schon Mietfuchs antwortet (die Marke dafür ist `app: 'mietfuchs'` im Bericht), sodass
ein zweiter Klick im Menü nur die Oberfläche nach vorn holt. **Der Port wird gebunden, bevor
die Datenbank geöffnet wird** (#244): Vorher migrierte ein zweiter Start nach einem Update die
Datei unter der noch laufenden alten Version und legte eine Sicherung samt Merkdatei an, bevor er
den belegten Port bemerkte. Gebunden und nicht nur nachgefragt, weil zwischen Frage und `listen`
sonst zwei gleichzeitige Starts beide migrieren könnten; das Binden entscheidet das
Betriebssystem für genau einen. Eine Sperrdatei im Datenordner wurde verworfen, weil sie nach
einem Absturz liegen bliebe. Bis Datenbank und Umstieg fertig sind, warten alle Anfragen; nur
`/healthz` antwortet sofort mit 503, `app: 'mietfuchs'` und `status: 'starting'`, damit ein
zweiter Start Mietfuchs auch während eines langen Umstiegs erkennt. Wer auf den Start wartet,
fragt deshalb nach 200 oder nach einem anderen `status` als `starting` (smoke-test.mjs,
umstieg-praxislauf.mjs). `NKA_TEST_START_DELAY_MS` hält den Start nach dem Binden fest, nur für
den Test dieses Rennens. Bleibt die Antwort auf `/healthz` aus (der erste Start blockiert gerade
seine Ereignisschleife), fragt der zweite bis zu 30 Sekunden lang erneut, bevor er „anderes
Programm“ meldet; eine Antwort, die nicht Mietfuchs ist, entscheidet sofort. Der bewusste Preis:
Ein fremdes Programm, das auf dem Port Verbindungen annimmt, aber nie antwortet, wird erst nach
rund 30 Sekunden gemeldet, und die Programmdatei endet danach wie immer erst 10 Sekunden später. Ob Bun den Port auf
jedem System exklusiv bindet, prüft [scripts/second-start.mjs](scripts/second-start.mjs) in
release.yml auf allen sechs Programmdateien und in jedem Prüfumfang: zweiter Start auf dem Port
der laufenden Instanz, mit einer `db.json`, die umsteigen will, erwartet Exit 0 und einen
byteweise unveränderten Datenordner. Und scheitert der Start aus einem
anderen Grund, geht unter Linux zusätzlich eine Meldung über `notify-send` hinaus. Für Tests
gibt `NKA_RUNTIME=binary` die Programmdatei vor, ohne eine zu sein; die Auslieferung des
Frontends hängt weiterhin an `globalThis.Bun`. Den Klick im Menü selbst prüft kein Test, das
bleibt eine Probe auf einem echten Desktop.

**Docker-Image**: [.github/workflows/docker.yml](.github/workflows/docker.yml) baut das
[Dockerfile](Dockerfile) bei `v*`-Tags und Pushes auf `main` für `linux/amd64` + `linux/arm64`
und pusht nach `ghcr.io/speedone/mietfuchs` (Tags: `X.Y.Z`, `X.Y`, `latest`, `main`). Damit
läuft die App ohne Clone des Repos. Bei PRs, die Dockerfile, Abhängigkeiten oder den Workflow
ändern, baut er nur zur Probe (ohne Login und Push). Die Laufzeit-Stufe übernimmt `server`,
`client/dist` **und `shared`**. Der Server lädt aus dem Ordner seit #140 auch einen Helfer für die
Laufzeit (`shared/heating.ts`, seit #141 auch `shared/allocation.ts` und `shared/duplicates.ts`,
seit #170 `shared/costItem.ts`, `shared/assessment.ts` und `shared/categories.ts`, seit #255
`shared/paidOn.ts`); ohne den
Ordner startete das Image nicht mehr, und die Prüfläufe
gegen den Start aus dem Quellcode bemerkten es nicht, nur die Prüfung des Images selbst.

**Node-Versionen**: Docker-Image und Release-Build nutzen Node 24, die CI testet zusätzlich die
Mindestversion 24.15 aus `engines`. Zwei Gründe liegen dort übereinander. Ab **24.12** gilt das
Ausführen von TypeScript ohne Build-Schritt als stabil. Ab **24.15** meldet `node:sqlite` beim
Laden keine `ExperimentalWarning: SQLite is an experimental feature and might change at any time`
mehr; Node hat die Meldung dort entfernt (Commit `aaf9af1672`, PR #61262) und die Stufe auf
„1.2 - Release candidate" gehoben. Auf 24.12 bis 24.14 bekäme sie jeder zu sehen, der Mietfuchs
aus dem Quellcode startet, und für Vermieter ohne technische Vorkenntnisse ist eine solche Zeile
bei jedem Start beunruhigend. Unterdrücken ließe sie sich nur mit Mitteln, die auch die
Warnungen verschlucken, die man sehen will (`--no-warnings`,
`process.removeAllListeners('warning')`); ein eigener `warning`-Horcher verdrängt Nodes Ausgabe
nicht, sondern tritt daneben. Deshalb die Untergrenze statt eines Kniffs. Die Programmdatei
nutzt `bun:sqlite` und war nie betroffen, das Docker-Image fährt `node:24-slim` und liegt
ohnehin darüber. Beim Anheben alle Stellen mitziehen: `engines` (plus
`package-lock.json`), README-Badge, Dockerfile, `ci.yml`, `release.yml`. Actions und npm-Pakete
hält Dependabot aktuell ([.github/dependabot.yml](.github/dependabot.yml), monatlich: Actions
in einem PR, kleine npm-Updates gebündelt je Ordner, Hauptversionen einzeln). Sicherheitswarnungen
und automatische Sicherheits-PRs sind im Repo eingeschaltet. Bei Hauptversionen die
Changelogs gegen unsere Nutzung prüfen; Express 5 etwa ruft den `listen`-Callback auch bei
Startfehlern auf, und `res.sendFile` braucht `root`, wenn der Installationspfad Punkt-Ordner hat.

Release-Automatik: [.github/workflows/release.yml](.github/workflows/release.yml) baut bei einem
`v*`-Tag alle Ziele auf einem Linux-Runner und hängt sie ans GitHub-Release — macOS als Zip,
Linux als tar.gz (konserviert das Ausführungs-Bit, das rohe Downloads verlieren würden), die
Windows-`.exe` roh. Ziele: Windows, Linux und macOS jeweils für x64 und ARM64. Die Namen der
x64-Dateien bleiben fest, der Update-Hinweis älterer Versionen sucht sie darunter. **Ein Tag mit
Bindestrich ist eine Vorabversion** (`v0.8.0-rc.1`) und wird als solche gekennzeichnet. Das ist
eine Sicherung und kein Verfahren: `prerelease` kennt bei softprops keine Automatik, ohne die
Zeile erschiene ein Release-Kandidat als vollwertiges Release, `releases/latest` lieferte ihn
aus, und jeder Nutzer mit eingeschalteter Update-Prüfung bekäme ihn angeboten. Das Docker-Image
braucht nichts dergleichen, `docker/metadata-action` mit `latest=auto` vergibt `latest` bei einer
Vorabversion von sich aus nicht. **Die Version kommt beim Tag aus dem Tag** (#166): Vor dem Bauen schreibt
[scripts/set-version.mjs](scripts/set-version.mjs) sie in die drei package.json-Dateien (samt
Lockfiles), in release.yml im Bau der Programmdateien und in den Jobs, die sie prüfen
(Programmdateien, Distributionen, Pakete; der Smoke-Test erwartet die Version aus
`server/package.json`), und in docker.yml; sonst meldete sich `v0.9.0-rc.2` als 0.9.0. Die
lange KI-Antwort braucht den Schritt nicht, sie startet aus dem Quellcode, und Server und
Smoke-Test lesen dort dieselbe Datei. Abweichen darf nur das Vorab-Suffix, eine andere Basis im
Tag bricht den Lauf ab, statt still eine andere Version zu bauen; was als Version gilt, prüft
das Skript mit `parseVersion` aus update.ts. Die Linux-Pakete tragen den Kandidaten in ihren
Paketdaten als `0.9.0~rc.2` (Arch `0.9.0rc.2`) und sortieren ihn so vor die fertige Version
(`version_schema: semver` in nfpm.yaml). **Im Dateinamen steht kein „~“**: package-linux.mjs
macht daraus einen Punkt, wie GitHub es beim Hochladen ohnehin täte, sonst fände ein erneutes
Anhängen ans Release die Datei unter ihrem alten Namen nicht wieder.

**Artefakt-Tests** (#22): Vor dem Anhängen startet jede Programmdatei auf einem GitHub-Runner
ihres Systems (Linux, Windows und macOS jeweils x64 und ARM64), die Linux-Dateien zusätzlich in
Containern von 15 Distributionen (CentOS 7 mit glibc 2.17 bis Ubuntu 26.04). Das Docker-Image
wird für amd64 und arm64 ebenso geprüft, bevor es veröffentlicht wird, und die CI prüft den
Start aus dem Quellcode. Alle nutzen [scripts/smoke-test.mjs](scripts/smoke-test.mjs): Es
prüft eine laufende Instanz von außen (Oberfläche mit allen Skriptteilen und pdf.js-Dateien,
KI-Auswertung gegen ein eigenes nachgebautes Ollama, Belege, Abrechnung, Backup und
Wiederherstellung, dazu die beim Start angelegte Datenbank aus `/healthz`) und braucht einen
leeren Datenordner. Aus `/healthz` liest er auch, dass der Umstieg gelaufen ist und im leeren
Ordner nichts zu tun hatte; den **gelungenen** Umstieg prüft er nicht, dafür müsste dieselbe
Instanz mit einer vorhandenen `db.json` ein zweites Mal starten (siehe den Bericht zu #55). Lokal:
`node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm`.

**Den Umstieg selbst spielt [scripts/umstieg-praxislauf.mjs](scripts/umstieg-praxislauf.mjs)
durch** (`node scripts/umstieg-praxislauf.mjs`, ein Fall einzeln mit `--nur 6`). Es startet
echte Server mit Wegwerf-Datenordnern und geht die Lagen durch, die beim Vermieter vorkommen:
frischer Rechner, gewachsener Bestand, Altformate, ein zweiter Start nach gelungenem Umstieg,
ein abgelehnter Bestand, Backup und Wiederherstellen mit und ohne Datenbank. Fall 7 ist dabei der
wichtigste für die Zukunft, weil er am längsten vorkommt: Archive **von vor der Datenbank**, also
genau das, was heutige Nutzer liegen haben, einmal mit Belegen und einmal mit nichts als der
`db.json` darin. [MIGRATION.md](MIGRATION.md) verweist sie auf beide Wege, und ohne den Fall
stünde die Anleitung auf einer ungeprüften Zusage. Sein Vorzustand ist bewusst ein **anderes
Haus** (`bestandAnderesHaus`): Stünde dort derselbe Bestand wie im Archiv, blieben die fachlichen
Zusicherungen auch dann grün, wenn nichts übernommen wurde, und das waren nachgemessen sechs von
zehn. Das deckt genau
die Lücke, die der Smoke-Test offenlässt, nämlich den **gelungenen** Umstieg über zwei Starts
hinweg. In der CI läuft es nicht, es ist für die Hand vor einem Release. Eine Nummer, die es
nicht gibt, bricht ab statt still Erfolg zu melden; das war einmal anders und ist dieselbe Falle
wie eine Matrix ohne Einträge. Mit `--slow-ai 320`
schweigt das nachgebaute Ollama länger als fünf Minuten; die Auswertung muss trotzdem ankommen
(siehe KI-Belegauswertung). So läuft es bei den Programmdateien auf Linux x64, Windows x64 und
Apple Silicon und gegen Node im Job „Lange KI-Antwort (Node)“, beides aber nur noch beim vollen
Umfang, also beim Tag, im wöchentlichen Lauf und auf Zuruf (siehe Prüfumfang je Anlass). Weg
fällt die Prüfung damit nicht, sie rückt ans Release: Ohne sie wird nichts angehängt. Ist `CI`
gesetzt, öffnet die Programmdatei keinen Browser. Bun baut bewusst mit `latest`; eine
fehlerhafte neue Version fällt in diesen Tests auf, seit #52 im Pull Request allerdings nicht
mehr, sondern erst im wöchentlichen Lauf oder mit dem Label.
Die macOS-Dateien werden nach dem Bau auf einem Mac-Runner mit
`codesign --sign -` neu signiert: Buns eigene Ad-hoc-Signatur beim Cross-Kompilieren unter
Linux war wiederholt ungültig (zuletzt die Intel-Datei mit Bun 1.4.2), und neuere macOS-Versionen
beenden solche Programme beim Start.

**Prüfumfang je Anlass** (#52): Ein Pull Request prüft nicht mehr alles; vorher waren es 41 Jobs
mit rund 80 Runner-Minuten und gut elf Minuten Wartezeit. Jetzt sind es 15 Jobs, rund 22
Runner-Minuten und acht Minuten Wartezeit, am Pull Request dieser Änderung nachgemessen. Die
Wartezeit sinkt weniger als die Rechenzeit, weil ein großer Teil davon nicht Prüfen ist, sondern
Warten auf einen freien macOS-Intel-Runner bei GitHub; daran ändert der Umfang nichts. Im PR
laufen die Tests und der Build aus
[ci.yml](.github/workflows/ci.yml), das Bauen und Signieren, die sechs Betriebssysteme ohne die
320 Sekunden Wartezeit der langen KI-Antwort und aus den Containern eine Auswahl: `centos:7` für
die Untergrenze glibc 2.17 und `ubuntu:26.04` für das neueste Ende, dazu je ein Paket, nämlich
das `.deb` auf Ubuntu 24.04 (dort auch der Startmenü-Eintrag) und das `.rpm` auf Fedora. Beim
Tag läuft alles: 22 Distributionen, sieben Pakete, die lange KI-Antwort unter Node und dieselbe
lange Wartezeit auf Linux x64, Windows x64 und Apple Silicon, dazu der Browserlauf in drei Engines
(siehe Browserlauf). Denselben vollen Umfang fährt
mittwochs um 4:23 UTC ein Zeitplan auf `main`, damit niemand auf ein Label angewiesen ist: Er
ist das Netz für die Prüfungen, die im PR fehlen, vor allem gegen eine fehlerhafte Bun-Fassung,
denn Bun wird mit `latest` gebaut. Veröffentlicht wird dabei nichts, „Ans Release anhängen“
hängt weiter am Tag. Die Zeit liegt bewusst nicht auf einer vollen Stunde, weil GitHub Zeitpläne
dort staut; und nach 60 Tagen ohne Bewegung im Repo schaltet GitHub Zeitpläne ab, nach einer
langen Pause also nachsehen. Den Umfang entscheidet der Job „Prüfumfang
festlegen“ in [release.yml](.github/workflows/release.yml); seine Zusammenfassung nennt jeden
Container, den der Lauf geprüft hat. Seine Bedingung ist bewusst als Ausnahme geschrieben, also
vollständig außer an einem Pull Request ohne Label: Ein neuer Auslöser läuft so im Zweifel zu
breit statt still zu schmal. Wer die volle Breite schon vor dem Merge braucht, hängt dem
Pull Request das Label `full-check` an, wie beim KI-Prüflauf das Label `ai-eval`; das
startet release.yml neu, dann mit allem. Ein Start von Hand über Actions prüft ebenfalls alles.
Das Label muss im Repo angelegt sein, sonst lässt es sich nicht vergeben. Am Pull Request läuft
release.yml nur, wenn er Server, Oberfläche, Skripte, Paketierung oder die Datei selbst anfasst;
sonst bewirkt auch das Label nichts, dann gibt es aber auch nichts zu prüfen. Offen bleibt im PR
alles zwischen den beiden Enden, also Debian 11 bis 13, Ubuntu 20.04 und 22.04, AlmaLinux,
Rocky, openSUSE und Arch, dazu jeder Container auf ARM64, das Arch-Paket und die Pakete auf
ARM64. Ein Fehler, der nur dort auftritt, zeigt sich spätestens im Lauf der folgenden Woche,
immer aber vor dem Anhängen ans Release. Die ARM64-Programmdatei selbst prüft weiterhin jeder PR
auf einem ARM-Runner. Am selben Umfang hängen die lange KI-Antwort und der Browserlauf, damit
Zeitplan und Label alles abdecken, was ein PR auslässt. Eine leere Liste wäre die gefährlichste Lücke, weil eine
Matrix ohne Einträge keinen Job erzeugt und GitHub das nicht als Fehler meldet, sondern
überspringt; der Job
„Prüfumfang festlegen“ bricht deshalb ab, wenn eine der beiden Listen leer ist.

Einzelnen Test ausführen:

```powershell
npm --prefix server test -- --test-name-pattern "Flächenschlüssel"
npm --prefix client test -- costForm
```

Es gibt **keinen Linter**; `npm run typecheck` prüft per `tsc` vier Teile: Server, Client, die
Vite-Konfiguration ([client/tsconfig.node.json](client/tsconfig.node.json), mit Node- statt
DOM-Typen) und die Skripte in `scripts/` und `server/scripts/` ([scripts/tsconfig.json](scripts/tsconfig.json), #64).
`npm run build` schließt die Prüfung des Clients samt Vite-Konfiguration mit ein und baut
zusätzlich das Frontend.

**Die Skripte bleiben JavaScript** und werden mit `checkJs` geprüft, mit dem Compiler und den
Node-Typen des Servers. Eine einzige Einstellung weicht vom Server ab, `noImplicitAny` ist aus:
Mit ihr verlangte der Übersetzer rund 140 JSDoc-Angaben an Parametern, und gewonnen wäre wenig,
denn bei Skripten zählen Tippfehler, verschwundene Importe und geänderte Node-Schnittstellen,
und die findet er auch so. Alles andere muss dem Server gleichen, weil die Skripte aus
`server/src` importieren und der Übersetzer diese Dateien im selben Lauf mit den Einstellungen
der Skripte noch einmal prüft (mit `strict: false` meldete er dort Fehler, die es im Server
nicht gibt). Eine Folge davon: Eine Variable in `server/src`, die mit `null` beginnt, bekommt
ihren Typ ausdrücklich (`let x: number | null = null`), sonst bleibt sie ohne `noImplicitAny`
vom Typ `null`, und dieser Lauf wird rot. Wo ein Skript unbekanntes JSON liest, steht ein
benanntes `/** @type {any} */` statt einer Typbeschreibung der Antwort; was darin steht, prüfen
die Zusicherungen des Skripts. Ein neues Skript `scripts/*.mjs` oder `server/scripts/*.mjs` ist
ohne weiteres Zutun dabei.

**Tests, drei Ebenen** — beim Erweitern der Verteilung oder der Formulare jeweils mitdenken:

1. [server/test/calc.test.ts](server/test/calc.test.ts) — Engine (node:test, kein Framework).
   Neben Beispielfällen prüfen drei Tests Invarianten über zufällig erzeugte Datenbestände
   (fester Startwert, also reproduzierbar): Mieteranteile + Vermieteranteil = Gesamtkosten,
   keine negativen Anteile, Eigenanteil ≤ Vermieteranteil. Einzelfall-Tests übersehen genau
   die schiefen Konstellationen — ein Geldverlust bei der Direktzuordnung fiel erst hier auf.
2. `server/test/api-*.test.ts` — Integration: startet den Server als
   eigenen Prozess mit `NKA_DATA_DIR` auf einem Wegwerf-Ordner (deshalb gibt es diese
   Variable) und prüft die Routen. Berührt nie eine vorhandene `db.json`. `NKA_UPDATE_URL`
   zeigt dort standardmäßig auf einen geschlossenen Port, damit kein Test GitHub erreicht.
   **Zehn Dateien nach Themen statt einer** (#263): `node --test` verteilt nur Dateien auf
   Prozesse, nicht die Tests einer Datei, und die eine api.test.ts mit rund 270 Serverstarts
   bestimmte allein das Ende des ganzen Laufs (418 von 420 Sekunden). Die gemeinsamen Helfer
   (Antworttypen, `startServerIn`, `startServerRaw`, die nachgebauten Dienste) stehen in
   [server/testing/api.ts](server/testing/api.ts); was nur ein Teil braucht, steht bei ihm.
   Ein neuer Test gehört in die Datei seines Themas; wird eine Datei deutlich länger als die
   anderen, lohnt das Teilen wieder.

**Wer für eine Prüfung einen Server startet, setzt drei Dinge**, und zwar immer zusammen. Das
gilt für Tests, für Skripte und für jede Probe von Hand:

- **`NKA_DATA_DIR`** auf einen Wegwerf-Ordner. Ohne ihn läuft die Prüfung gegen den echten
  Bestand des Entwicklers, und der Umstieg, das Wiederherstellen und das Löschen von Belegen
  schreiben dort wirklich.
- **`CI=1`** gegen das Browserfenster. In der Betriebsart `binary` oder `package` öffnet
  Mietfuchs beim Start den Standard-Browser ([version.ts](server/src/version.ts), `STANDALONE`).
  Bei einer Prüfung nützt das niemandem, und auf einem Arbeitsrechner nimmt es den Fokus weg,
  oft mehrfach hintereinander. Ein Fenster gehört nur dorthin, wo es wirklich gebraucht wird,
  also zu einem Browser-Test oder einem Screenshot. Nötig ist das auch dann, wenn nur
  `NKA_RUNTIME=binary` gesetzt ist, um den gepackten Betrieb nachzustellen.
- **`NKA_UPDATE_URL`** auf einen geschlossenen Port, damit keine Anfrage zu GitHub hinausgeht.

Dieselben drei stehen in [server/testing/api.ts](server/testing/api.ts) (`startServerIn` und
`startServerRaw`) und in [scripts/umstieg-praxislauf.mjs](scripts/umstieg-praxislauf.mjs); wer
einen neuen Prüfpfad baut, nimmt sie von dort.

**`CI` steht dort hinter dem `...env` des Aufrufers und nicht davor**, kann also nicht
versehentlich überschrieben werden. Das ist kein Übereifer: `startServerIn` setzte es gar nicht,
ein Aufrufer stellt mit `NKA_RUNTIME: 'binary'` die Programmdatei nach, und damit riss **jeder
volle Testlauf** ein Browserfenster auf, auf einem Zufallsport, weil `NKA_PORT` dort `'0'` ist.
Ein Wächter in api-start.test.ts liest deshalb den `env`-Block jedes Serverstarts in jeder
Datei unter `server/test/` und `server/testing/` und verlangt das `CI`. Geprüft wird der
Quelltext, denn am Verhalten ließe es sich nur messen, indem der Test genau das tut, was er
verhindern soll.

**Frische Datenbank für einen Test: die Vorlage** (#263,
[server/testing/freshDatabase.ts](server/testing/freshDatabase.ts)). Wer eine leere, voll
migrierte Datenbank braucht, nimmt `openFreshDatabase(dataDir)` statt `openDatabase({ dataDir })`
auf einem leeren Ordner. Die ganze Kette je Test kostete gut eine Viertelsekunde (ein fsync je
Schritt), in der Invariante mit über 1.700 Läufen je Abschnitt war das im Profil rund 40 Prozent
der Rechenzeit. So geht es: Je Testprozess entsteht beim ersten Aufruf **einmal** eine Vorlage,
mit `openDatabase` auf einem Wegwerf-Ordner, also mit der Kette, wie sie gerade auf der Platte
steht; nichts davon wird eingecheckt, und die Vorlage endet mit ihrem Prozess. Jeder Test bekommt
eine Dateikopie in seinen eigenen Ordner (zulässig, weil die Vorlage geschlossen ist und ohne
WAL läuft), **geöffnet wieder mit `openDatabase`**: Fremdschlüssel, `integrity_check`,
Schreibprobe und Abgleich mit der Kette laufen also wie bei jedem Start, kein Pragma muss
nachgestellt werden. Musste beim Öffnen der Kopie noch ein Schritt nachgeholt werden, ist die
Vorlage veraltet, und der Helfer wirft, statt es still nachzuholen.
[fresh-database.test.ts](server/test/fresh-database.test.ts) vergleicht die Kopie mit einer frisch
migrierten Datenbank (Aufbau, Inhalt, Pragmas). **Bei der echten Kette bleiben** alle Tests, die
die Kette selbst prüfen: db-open, db-changeover, db-objekte, migrations, migration-notice,
legacy-guard, ueberschneidung-bestand, die Serverstarts der Integrationstests und alles über
`openDatabaseWithStock` (der eingefrorene Eingang: 0000, Bestand, dann die Kette).
3. `client/src/**/*.test.ts(x)` — vitest. Die Entscheidungslogik der Formulare liegt in
   [client/src/costForm.ts](client/src/costForm.ts) und
   [client/src/unitForm.ts](client/src/unitForm.ts), damit sie ohne DOM prüfbar ist; die
   Seiten sollen darüber nur noch rendern. Dazu ein jsdom-Komponententest
   ([Kosten.test.tsx](client/src/pages/Kosten.test.tsx), fordert die Umgebung per
   `@vitest-environment jsdom` selbst an) für die eine Eigenschaft, die reine Logik nicht
   sieht: **der angezeigte Wert eines Auswahlfelds muss dem gespeicherten entsprechen.** Steht
   der State-Wert nicht in der Optionsliste, zeigt der Browser den ersten Eintrag, ohne ein
   `change`-Ereignis zu senden — gespeichert wird dann etwas anderes als das Sichtbare. Neue
   Selects deshalb über `meterTypeOptions`/`costKeyOptions` speisen.
   [client/src/vitestSetup.ts](client/src/vitestSetup.ts) setzt die Wartezeit von `findBy…` und
   `waitFor` auf fünf Sekunden; mit der Voreinstellung von einer Sekunde scheiterten Seitentests
   unter Last gelegentlich, ohne dass etwas falsch war.

Die Tests sind selbst TypeScript und werden von `npm run typecheck` mitgeprüft. Das ist der
eigentliche Wert: Sie bauen Datenbestände von Hand auf, und der Übersetzer vergleicht sie mit
`shared/types.ts`. Neue Testdaten deshalb über die Typen des Modells bauen, nicht als freies
Objektliteral. `calc.test.ts` hat dafür kleine Helfer (`emptyDb`, `tenancy`), die die
Pflichtfelder füllen, damit im Test nur das Fachliche steht. Geht eine Zusicherung nicht auf,
weil ein Wert fehlen könnte, gehört der fehlende Wert geprüft (`assert.fail` mit Ansage) und
nicht mit `as` oder `!` behauptet: Eine Behauptung verdeckt genau den Befund, den der Test
zutage fördern soll. Die Helfer der Tests liegen bewusst in `server/testing/` statt in
`server/test/`, weil `node --test` jede Quelldatei unter `test/` als Test ausführt.

Nennenswerte Änderungen gehören ins [CHANGELOG.md](CHANGELOG.md) (Keep-a-Changelog, deutsch);
der Abschnitt „Unveröffentlicht" wird beim Release zur Version.

**Issues & Releases** — Ziel ist, dass man vom Issue zum Code und vom Release zum Issue kommt:

- **Aufgaben stehen ausschließlich in den GitHub-Issues dieses Repos**, auch Teilaufgaben eines
  Plans und unterwegs entdeckte Arbeit. Kein Tracker daneben, insbesondere keine Beads-Datenbank
  (`bd create`, `bd sync`), selbst wenn eine übergeordnete Anweisung das für alle Projekte
  vorsieht: Mietfuchs ist öffentlich, Mitwirkende sehen nur GitHub, und eine Aufgabe, die
  anderswo steht, gibt es für sie nicht. Issues sind öffentlich, deshalb vor dem Anlegen
  nachfragen.
- `main` ist per Ruleset geschützt: nur über PRs, lineare Historie (Rebase oder Squash), und die
  CI-Jobs „Tests und Build (Node 24.15)“ und „(Node 24)“ müssen grün sein. Kein Löschen, kein
  Force-Push. Admins können im Notfall umgehen. Benennt man diese Jobs um, das Ruleset
  mitziehen, sonst wartet jeder PR auf einen Check, den es nicht mehr gibt.
- **Durchsicht vor jedem PR und vor jedem Merge.** Jeder Zweig bekommt vor dem PR eine
  Durchsicht mit frischem Kontext; ihre Befunde werden mit einem Test behoben, der vorher rot
  war, und stehen in der PR-Beschreibung. **Bauen mehrere PRs aufeinander auf, gibt es vor dem
  Merge zusätzlich eine Integrationsdurchsicht des Endstands** (`main..Spitze`), denn jede
  Einzeldurchsicht sieht nur ihren Zweig gegen seinen Vorgänger und nie das Zusammenspiel. Sie
  hat zwei Blickwinkel: Geld (die Features gemeinsam in der Berechnung, Invarianten über alle
  zugleich) und Daten (Migrationskette auf einer Datenbank der letzten Version, Umstieg,
  Backup, Routen je Objekt, Doku). Dazu laufen auf der Spitze der Praxislauf
  (`node scripts/umstieg-praxislauf.mjs`) und der volle Prüfumfang (Label `full-check` an der
  obersten PR). Befunde werden auf dem Zweig behoben, zu dem sie gehören, und die darüber
  nachgezogen. Gemergt wird der Reihe nach, jede PR erst nach dem Umstellen auf `main` und
  grüner CI.
- Eine Behebung referenziert ihr Issue mit **`Refs #N`** im PR-Text bzw. in der
  Commit-Nachricht. Das erzeugt die Verknüpfung im Issue-Verlauf. **Nicht** `Fixes`/`Closes #N`:
  diese Schlüsselwörter schließen das Issue schon beim Merge nach `main`, also bevor Nutzer den
  Fix bekommen.
- Der Changelog-Eintrag nennt das Issue als Link, `([#N](https://github.com/speedone/mietfuchs/issues/N))`
  — in Repo-Dateien verlinkt GitHub ein nacktes `#N` nicht. In Release-Notes genügt `(#N)`.
  Nummern nur dort, wo das Issue den Punkt tatsächlich verlangt hat.
- Geschlossen wird **beim Release**: kurzer Kommentar mit Link auf das Release, in der Sprache
  des Melders, dazu nötige Schritte für bestehende Daten. Danach das Issue als *completed*
  schließen.
- **Labels, knapp gehalten.** Die Art steht ohne Präfix (`bug`, `enhancement`, `documentation`,
  `chore`), denn GitHub und Dependabot vergeben einige davon selbst; wer sie umbenennt, bricht
  das und gewinnt nur Symmetrie. Mit Präfix stehen die beiden Dimensionen, nach denen man
  wirklich filtert: `priority: high | medium | low` und `status: awaiting release | needs
  decision`. Die Grenze der Dringlichkeit ist fachlich gezogen und nicht abstrakt: **hoch** heißt
  „geht an Geld oder Daten", also falsche Zahlen in einer zugestellten Abrechnung oder in der
  Steuer oder Datenverlust; **mittel** heißt falsch angezeigt, ohne dass eine Zahl wandert;
  **niedrig** heißt, kein Nutzer merkt es. `status: awaiting release` trägt, was behoben und in
  `main` ist: Weil erst beim Release geschlossen wird, sieht man sonst nicht, welche offenen
  Issues eigentlich erledigt sind. Bereichs-Labels gibt es bewusst nicht, dafür sind es zu
  wenige Issues; ab etwa dreißig lohnen sie.
- **`ai-eval` und `full-check` sind keine Beschriftungen, sondern Schalter** und deshalb ohne
  Präfix und klein geschrieben. Sie starten den KI-Prüflauf beziehungsweise die volle
  Artefaktmatrix an einem Pull Request. Ihre Namen stehen im Klartext in
  [ai-eval.yml](.github/workflows/ai-eval.yml) und [release.yml](.github/workflows/release.yml):
  Wer eines umbenennt, ohne den Workflow mitzuziehen, schaltet den Auslöser **lautlos** ab,
  dieselbe Falle wie bei den Job-Namen im Ruleset.
- Release-Notes aus dem Changelog-Abschnitt erzeugen, dabei die harten Zeilenumbrüche der
  Listenpunkte zusammenziehen — GitHub stellt jeden Umbruch in Release-Texten als echten dar.
  Die automatisch erzeugte Nennung neuer Beitragender übernehmen.

## Architektur

Zwei getrennte npm-Pakete: `server/` (Express, ESM, TypeScript) und `client/` (React 19 + Vite +
TypeScript), dazu der Ordner `shared/` mit dem gemeinsamen Datenmodell (#48). Der Server wird
nicht gebaut: Node führt die `.ts`-Dateien unmittelbar aus und streift die Typen dabei ab, das
ist ab Node 24.12 stabil und einer der beiden Gründe für die Untergrenze in `engines` (der
andere ist die Warnung von `node:sqlite`, siehe Node-Versionen). Geprüft werden sie
trotzdem, durch `npm run typecheck`. Im Dev proxyt Vite `/api` und `/uploads` an
`localhost:3001` ([client/vite.config.ts](client/vite.config.ts)); im Produktivbuild liefert der
Express-Server das statische `client/dist` selbst aus
([server/src/index.ts](server/src/index.ts)).

**Persistenz**: die SQLite-Datei `server/data/mietfuchs.sqlite` (#55). `NKA_DATA_DIR` verlegt den
Ordner (Tests, abweichende Ablage). Belege liegen in `server/data/uploads/`, API-Schlüssel
externer KI-Dienste getrennt davon in `server/data/secrets.json` (siehe secrets.ts; nicht im
Backup). Backup = diesen Ordner kopieren. Daneben liegen nach dem Umstieg
`db.json.abgeloest` mit dem Bestand von davor und `umstieg-protokoll.txt`.

Die frühere `db.json` ist damit **Vergangenheit und nicht mehr Ablage**: Sie wird gelesen, wenn
ein Bestand von vor dem Umstieg übernommen oder ein altes Backup eingespielt wird, und danach nie
wieder geschrieben. Die Umwandlung ihrer alten Formate steht in
[server/src/legacy/migrate.ts](server/src/legacy/migrate.ts) (z. B. fester Monatsbetrag zur
Vorauszahlungs-Staffel), in einer **eigenen Datei** und nicht mehr in `load()`, weil der Umstieg
dieselben Regeln braucht: Ein Bestand, der beim Einlesen anders geradegezogen würde als beim
Übernehmen, änderte beim Umstieg still eine Abrechnung. Die Tests dazu stehen in
[server/test/store.test.ts](server/test/store.test.ts) und halten jede Regel einzeln fest;
wer dort etwas ändert, sieht am roten Test, dass er eine Abrechnung verändert. Der Rest von
store.ts (`getDb`, `save`, `reloadDb`) ruft niemand mehr auf; gebraucht werden nur noch
`chooseDataDir`, `DATA_DIR`, `UPLOAD_DIR`, `newId` und der Typ `Db`.

**Die Datenbank** (#55): Die JSON-Datei ist durch SQLite abgelöst, später soll auch PostgreSQL
möglich sein. Die Grenze dafür zog der Schnappschuss (siehe unten); das Schema dahinter steht in
[server/src/db/schema.ts](server/src/db/schema.ts). Geöffnet wird sie beim Start
([server/src/db/open.ts](server/src/db/open.ts)), die vorhandenen Bestände wandern beim ersten
Start hinein (siehe Umstieg unten), und **die Routen lesen und schreiben sie**
([server/src/db/repository.ts](server/src/db/repository.ts)).

- **Der Treiber ist `drizzle-orm/sqlite-proxy`**, und das ist eine bewusste Wahl gegen zwei
  naheliegendere. `drizzle-orm/better-sqlite3` importiert ein natives Modul fest beim Laden, und
  native Module lassen sich nicht für alle Ziele in die Bun-Programmdatei einbetten (#21).
  `drizzle-orm/node-sqlite` gibt es nur in der 1.0.0-Vorabreihe, und die scheidet an zwei
  nachgemessenen Stellen aus: Ihr Treiber wartet den Rumpf einer Transaktion nicht ab, wodurch
  eine gescheiterte Transaktion festgeschrieben statt zurückgerollt wird, und ihr drizzle-kit
  lässt bei einem Primärschlüssel aus Text das `NOT NULL` weg, was SQLite als Erlaubnis für
  NULL-Kennungen liest. Der Proxy ist eigentlich für einen entfernten Dienst gedacht; wir nutzen
  ihn für eine Verbindung im selben Prozess. Kommt die stabile 1.0, tauscht man ihn gegen den
  eigenen Treiber — betroffen ist dann nur
  [server/src/db/client.ts](server/src/db/client.ts), denn Schema und Migrationen liegen schon
  in der Form der stabilen Reihe.
- **Node und Bun unterscheidet allein client.ts**, erkannt an `globalThis.Bun`. Betroffen sind
  das eingebaute SQLite (`node:sqlite` mit `setReturnArrays(true)` gegen `bun:sqlite` mit
  `values()`) und die Herkunft der Migrationen.
- **`PRAGMA foreign_keys = ON` beim Öffnen**, je Verbindung. Die Voreinstellung von SQLite ist
  aus; ohne diese Zeile sind alle Fremdschlüssel Dekoration. Damit die Zeile wirklich die Arbeit
  tut, öffnet `openNode` mit **`enableForeignKeyConstraints: false`**: `node:sqlite` schaltet die
  Prüfung sonst von sich aus ein, `bun:sqlite` nicht, und dann bliebe unter Node jeder Test grün,
  während in der Programmdatei alle Verweise still Zierde wären. open.ts sieht nach dem Öffnen
  zusätzlich nach, dass der Wert wirklich 1 ist.
- **Beim Start wird geprüft, bevor geschrieben wird** ([server/src/db/open.ts](server/src/db/open.ts)):
  ob der Datenordner beschreibbar ist (mit `writable` aus paths.ts, wie chooseDataDir), ob die
  Fremdschlüsselprüfung gilt, ob `PRAGMA integrity_check` die Datei für unversehrt hält, ob sich
  in die Datei überhaupt schreiben lässt und ob sie aus einer **neueren** Mietfuchs-Version stammt.
  Der Schreibschutz wird zweistufig erkannt: Die Rechteprüfung des Dateisystems ist billig, lügt
  aber auf Netzlaufwerken, darf also nur den Verdacht wecken; bestätigt wird er mit einem
  Schreibvorgang, der nichts ändert (`PRAGMA user_version` auf den Wert, der schon dasteht).
  `BEGIN IMMEDIATE` taugt dafür nicht, nachgemessen: SQLite holt die Sperre erst beim ersten
  wirklichen Schreiben. Das Letzte steht in ihrer eigenen
  Buchführung: Führt `__drizzle_migrations` eine Marke, die dieses Programm nicht kennt, hat eine
  neuere Fassung darauf gearbeitet. Dann wird nicht migriert, sondern erklärt; unsere Schritte
  auf einen unbekannten Aufbau anzuwenden ergäbe einen Bestand, den danach keine der beiden
  Versionen mehr liest. **Eine beschädigte oder neuere Datei wird nie angefasst**, auch nicht
  beiseitegelegt: Ob nichts darin steht, ist genau das, was man in diesem Augenblick nicht weiß.
  Jede Meldung sagt, was los ist und was zu tun ist; die Meldung von SQLite steht höchstens
  benannt am Ende („Technischer Befund“) und nie allein.
- **Ein Netzlaufwerk ergibt eine Warnung, keinen Abbruch.** SQLite verlässt sich auf
  Dateisperren, die Netzwerk-Dateisysteme oft nur vortäuschen. Gefragt wird nach dem **wirklichen**
  Ort der Datei (Symlinks und Abzweigungen werden aufgelöst, sonst wäre ein Ordner im
  Heimatverzeichnis, der aufs NAS zeigt, unsichtbar); erkannt wird er unter Linux über
  `/proc/self/mounts` und unter Windows am UNC-Pfad. Die Plattform **kommt in `networkLocation`
  hinein** und stammt nicht aus der Laufzeit, wie bei `systemLocation` in paths.ts und aus
  demselben Grund: Sonst prüft jeder Zweig nur dort, wo zufällig jemand entwickelt. Gerechnet
  wird entsprechend mit `path.win32` beziehungsweise `path.posix`, nicht mit der Voreinstellung.
  Dieselbe Falle hat hier schon einmal einen Prüflauf umgeworfen:
  `path.posix.dirname` eines UNC-Pfads ergibt „.“, das Arbeitsverzeichnis lässt sich auflösen,
  und danach beginnt der Pfad nicht mehr mit zwei Gegenschrägstrichen. Es gewinnt der längste passende
  Einhängepunkt, bei gleicher Länge der spätere: Gleich lang und beide im Pfad heißt derselbe
  Einhängepunkt, also ein Dateisystem über einem anderen, und wirksam ist dann das obere. Nicht
  erkannt werden ein verbundenes Netzlaufwerk unter Windows (Z:), alles unter macOS und die
  Freigaben einer virtuellen Maschine; gewarnt wird dann nicht, falsch gewarnt aber auch niemand.
- **Scheitert das Öffnen, startet der Server trotzdem, aber ohne Daten.** Die angekündigte Umkehr
  ist mit dem Umstellen der Routen eingetreten: Ein Start ohne Datenbank ist jetzt ein Start ohne
  Daten. Die Datenrouten antworten mit **503** statt mit einer leeren Liste, und der Eintrag
  steht unter `checks`, damit ein Container den Fehler sieht. Der Server selbst muss dennoch
  hochkommen, sonst gäbe es auch keine Oberfläche, in der die Meldung stünde, und keine Route zum
  Wiederherstellen eines Backups. **Dasselbe gilt für einen gescheiterten Umstieg**, und das ist
  der schwerer zu sehende Fall: Die Datenbank ist dann offen, aber leer, und die Daten stehen noch
  in der `db.json`. Eine leere Antwort wäre keine Auskunft über einen leeren Bestand, sondern eine
  falsche über einen vorhandenen; und was der Vermieter in das leere Haus hineinschriebe, stünde
  danach als zweiter Bestand da, während seine `db.json` für immer abgehängt wäre, denn der
  nächste Umstieg unterbleibt, sobald in der Datenbank etwas steht. Von den beiden Zusagen aus
  changeover.ts gewinnt deshalb die zweite: nie Daten verlieren, notfalls auf Kosten des
  Weiterarbeitens. Die Frage „trägt die Datenbank den Bestand?" und ihre beiden Begründungen
  stehen einmal in [server/src/health.ts](server/src/health.ts) (`databaseUnavailable`), denn ein
  `/healthz` mit „ok", während jede Datenroute 503 antwortet, wäre die unbrauchbarste Auskunft von
  beiden. Der Umstiegsstand in index.ts ist veränderlich, weil das Wiederherstellen eines Backups
  ihn ändert: Sonst sperrte ein einmal gescheiterter Umstieg auch dann noch, wenn der Nutzer das
  Problem gerade mit genau dem Mittel behoben hat, das ihm dafür angeboten wird.
- **Alle Zugriffe laufen nacheinander**, durch die Schlange in open.ts
  (`createLane`, benutzt als `opened.write(...)` und `opened.read(...)`). Express bedient nebenläufig, und alle
  Anfragen teilen sich **eine** Verbindung. Eine Transaktion mit asynchronem Rumpf gibt zwischen
  ihren Anweisungen die Kontrolle ab; eine zweite Anfrage beginnt dann mitten hinein ihre eigene,
  die SQLite mit „cannot start a transaction within a transaction“ ablehnt. Schlimmer ist der
  zweite Ausgang, und deshalb läuft **jeder** Schreibvorgang durch die Schlange und nicht nur die
  Transaktionen: Ein gewöhnliches Einfügen, das währenddessen hereinkommt, landet unbemerkt
  innerhalb der fremden Transaktion und verschwindet mit ihr, nachdem seine Anfrage längst mit
  „gespeichert“ geantwortet hat. Beides ist nachgemessen. Ein Schreibvorgang **im**
  Schreibvorgang meldet sich mit einem Fehler, statt auf sich selbst zu warten. Zwei Feinheiten
  stecken darin, und beide waren Fehler, bevor sie es nicht mehr waren: Im Speicher von
  `AsyncLocalStorage` liegt ein **veränderliches Kärtchen**, das am Ende des Vorgangs ungültig
  gestempelt wird, denn der Speicher überlebt den Vorgang in jedem Zeitgeber, den er angelegt hat,
  und ein Zeitgeber, der später aufräumt, gälte sonst für immer als verschachtelt. Und die
  Ablehnung wird **geworfen** statt als abgelehntes Versprechen zurückgegeben: Wer sein Ergebnis
  wegwirft, hätte sonst niemanden, der sie entgegennimmt, und Node beendet den Prozess bei einer
  unbehandelten Ablehnung. Geworfen landet sie im Rumpf des äußeren Vorgangs und von dort bei
  dessen Aufrufer. Dauert ein Schreibvorgang länger als 30 Sekunden, gibt es eine Meldung;
  abgebrochen wird nichts, denn eine halb geschriebene Transaktion abzuräumen wäre schlimmer als
  zu warten. **Lesevorgänge gehen durch dieselbe Schlange**, seit die Routen aus der Datenbank
  lesen: Alle Anfragen teilen sich eine Verbindung, und ein Lesevorgang neben einer offenen
  Transaktion sähe deren noch nicht festgeschriebenen Stand. Ein Lesevorgang **innerhalb** eines
  Schreibvorgangs läuft dagegen einfach durch, sonst wartete er auf die Schlange, die sein
  eigener Aufrufer gerade hält. In index.ts sind `readData` und `writeData` der einzige Weg
  dorthin; eine Route, die `database.db` unmittelbar benutzte, ginge daran vorbei.
- **Verschachtelte Listen wurden Tabellen**: die drei Staffeln (`person_history`, `prepayments`,
  `base_rents`), die Jahreskorrektur (`prepayment_overrides`, nach Jahr geschlüsselt statt nach
  Datum) und die vereinbarten Anteile (`cost_item_shares`). In einer Spalte mit JSON ließe sich
  nichts zusichern: kein negativer Betrag, kein zweiter Eintrag zum selben Stichtag, kein
  Eintrag ohne Mietverhältnis. Bei `cost_item_shares` am deutlichsten, weil seine Schlüssel
  Wohnungs-Kennungen sind — index.ts ging sie beim Löschen einer Wohnung von Hand durch, und
  genau das erledigt jetzt `ON DELETE CASCADE`.
- **Die Einstellungen haben echte Spalten** (#60). Ein JSON-Klumpen hätte den Befund unverändert
  mitgenommen: `PUT /api/settings` übernahm jeden Schlüssel des Rumpfes, auch einen erfundenen.
  Mit Spalten gibt es für ein unbekanntes Feld keinen Ort mehr, und damit ist #60 erledigt. Die
  beiden Plätze der KI sind Zeilen in `ai_slots` und keine Spalten mit Präfix, weil `text` und
  `images` dieselbe Gestalt haben; die Bestätigung steht in derselben Zeile wie die Adresse, für
  die sie gilt. **Kein Feld für den API-Schlüssel**, der bleibt in `data/secrets.json`.
- **Was mit einem Datensatz geschieht, steht in
  [server/src/db/repository.ts](server/src/db/repository.ts)**, nicht mehr in index.ts. Drei
  Entscheidungen stehen dort begründet. `PUT` **ergänzt und ersetzt nicht**, weil die Oberfläche
  Teilrümpfe schickt (Stammdaten.tsx sendet beim Auszug nur `{ end }`); zusammengeführt wird nach
  **Anwesenheit eines Schlüssels** und nicht nach seinem Wert, sonst ließe sich ein Feld nie
  leeren. Die Hauptzeile wird **geändert und nicht gelöscht und neu eingefügt**, damit ihr
  `rowid` und damit die Reihenfolge erhalten bleibt. Und ein unbekanntes Feld hat schlicht keine
  Spalte. Die Sammlungen hängen an einem Beschreiber (`withCollection`) statt an Abfragen auf
  Feldnamen: Wer eine Sammlung ergänzt, bekommt vom Übersetzer gesagt, was fehlt.
- **Was krumm hereinkommt, wird geradegerückt und nicht abgelehnt.** Zwei Staffeleinträge zum
  selben Stichtag sind über die Oberfläche erzeugbar: Stammdaten.tsx setzt für eine Zeile ohne
  Monat den Einzugsmonat ein und prüft nie auf Doppelung. In der Datenbank ist der Stichtag Teil
  des Primärschlüssels, ungeprüft hineingeschrieben gäbe das also einen Fehler statt eines
  gespeicherten Mietverhältnisses, wo die db.json es klaglos annahm. Es gilt deshalb der letzte
  Eintrag, wie in calc.ts und beim Umstieg; die Regel steht einmal in
  [server/src/schedule.ts](server/src/schedule.ts), und legacy/migrate.ts wie repository.ts holen sie von
  dort. Dieselbe Haltung bei der Jahreskorrektur: Ihr Schlüssel muss eine **vierstellige**
  Jahreszahl sein, sonst führten „2024" und „2024.0" auf dieselbe Spalte und ließen den ganzen
  Vorgang am Primärschlüssel scheitern.
- **Die Personen-Staffel ist dabei die Ausnahme, und das ist nachgemessen.** „Es gilt der
  letzte" verschiebt dort Personentage, denn `personDaysInPeriod` in calc.ts baut seine Stufen
  aus allen Einträgen, und **die erste gilt ab Einzug** und nicht erst ab ihrem eigenen Stichtag
  (der Kommentar steht an der Zeile, `personsAt` nimmt davor ebenfalls den ersten Eintrag). Wirft
  man den ersten von zwei Einträgen zum selben Stichtag weg, übernimmt der zweite rückwirkend die
  ganze Zeit davor: an einem Mietverhältnis ab 01.01.2024 mit [1 Person, 4 Personen], beide ab
  01.07.2024, sind das 918 Personentage gegen 1464. Beim Personenschlüssel ist das unmittelbar
  Geld. `straightenPersonHistory` schreibt deshalb eine vorhandene Regel aus, statt eine neue zu
  erfinden: Weil die erste Stufe ohnehin ab Einzug gilt, darf ihr Stichtag dorthin vorgezogen
  werden, und danach greift „es gilt der letzte" wieder gefahrlos. Geprüft wird das **rechnend**
  und nicht am Ergebnis der Funktion
  ([server/test/schedule.test.ts](server/test/schedule.test.ts)).
- **Fehler der Datenbank werden übersetzt**
  ([server/src/db/errors.ts](server/src/db/errors.ts)). Drizzles äußere Meldung enthält das SQL
  **samt der eingesetzten Werte des Nutzers** und gehört damit nicht in eine Oberfläche;
  `databaseProblem` geht deshalb die `cause`-Kette bis zur **innersten** Meldung von SQLite
  hinunter. Aus FOREIGN KEY, UNIQUE, CHECK und NOT NULL wird ein deutscher Satz, die Meldung von
  SQLite steht höchstens am Ende als „Technischer Befund" und nie allein. **Der Status gehört zur
  Einordnung und kommt von dort mit**: Eine verletzte Zusicherung kommt aus der Anfrage und ist
  eine 400, Schreibschutz und volle Platte sind eine 503. Angeschlossen ist es in der
  Fehlerbehandlung von index.ts, und das war es einmal nicht: Die Datei war importiert und
  niemals aufgerufen, 182 Zeilen mit zehn grünen Tests, die nur sich selbst prüften. Ein Test
  über eine echte Route hält das jetzt fest.
- **Löschverhalten ist aus index.ts abgelesen.** Eine Wohnung kaskadiert auf Mietverhältnisse,
  Zähler, Ablesungen, Zahlungen (über das Mietverhältnis) und die vereinbarten Anteile. Bei
  `cost_items.direct_unit_id` steht dagegen **`SET NULL`**: Die Rechnung ist bezahlt worden und
  gehört weiter in die Abrechnung des Jahres. `CASCADE` löschte sie und veränderte damit die
  Summe einer bereits abgerechneten Vergangenheit. Später hinzugekommen und ebenfalls kaskadierend: die Pauschale
  (`flat_rates`), Teilnehmer, Einzel- und Eigenbeträge (`cost_item_participants`,
  `cost_item_amounts`, `cost_item_self_amounts`) und `unit_no_connection`; auf das Objekt verweisen
  Wohnungen, Zähler, Kosten, Abschlüsse und frühere Abschlüsse mit `RESTRICT`.
  Ausnahme an der Route: Die Rechnungen einer Etagenheizung (`fuel_deliveries.unit_id`) stehen zwar auf
  `CASCADE`, eine Wohnung mit Rechnungen löscht `DELETE /api/units/:id` aber nicht (409, `dependents` zählt sie
  als `fuelDeliveries`): Die Rechnung ist Beleg der CO₂-Aufteilung, und hing eine Position daran, scheiterte das
  Löschen vorher an deren `RESTRICT` mit einer irreführenden Meldung. Gesperrt statt `SET NULL`, weil eine
  Rechnung einer Etagenheizung ohne Wohnung keiner Wohnung mehr zuzuordnen wäre.
- **Prüfbedingungen je Feld entschieden.** Ohne Bedingung bleiben bewusst
  `cost_items.amount_cents` (eine Gutschrift ist negativ), `labor_35a_cents` (calc.ts meldet
  einen ungültigen Lohnanteil als Warnung und rechnet weiter; eine Bedingung nähme dem Nutzer
  genau diese Erklärung) und `payments.amount_cents` (Rücklastschrift). Dazu Bedingungen auf die
  Aufzählungen, denn `text({ enum })` bindet nur den Übersetzer und hinterlässt im SQL nichts.
- **Zwei Indizes, beide aus snapshot.ts abgelesen**: `cost_items(property_id, year)` ist der
  einzige Filter, den der Schnappschuss wirklich setzt, und `closed_settlements(property_id,
  year)` ist eindeutig und damit zugleich die Zusicherung, dass es je Objekt und Jahr höchstens
  eine abgeschlossene Abrechnung gibt (seit #92, vorher je Jahr). Dazu kommt
  `closed_settlement_history(property_id, year)` für die früheren Abschlüsse (#56). Alle
  übrigen Sammlungen gehen vollständig in den Schnappschuss; dort wäre ein Index auf Verdacht.
- **Der eingefrorene Berechnungsstand bleibt JSON.** Er ist ein Archivstück, das wortgleich
  erhalten bleiben soll, auch wenn spätere Versionen anders rechnen. In Spalten zerlegt hinge er
  am heutigen Ergebnisformat, und eine Programmänderung veränderte rückwirkend, was dem Mieter
  zugestellt wurde.
- **Migrationen**: erzeugt mit `npm --prefix server run db:generate`, nie von Hand geschrieben.
  **Ausnahme Datenanweisungen** (#92, Muster 0001/0002): Braucht eine neue Pflichtspalte Werte,
  wird sie zuerst ohne Pflicht erzeugt, die Daten werden an diesen Schritt angehängt, und ein
  zweiter erzeugter Schritt zieht die Pflicht per Neubau nach; nur vor der Veröffentlichung, und
  näher in [server/drizzle/README.md](server/drizzle/README.md). **Vor dem Anwenden ausstehender
  Schritte** legt der Server eine Sicherung `mietfuchs.sqlite.vor-<Schritt>` daneben
  (`backupBeforeMigrating` in open.ts); scheitert sie, wird nicht migriert.
  Es gilt die Regel aus [server/drizzle/README.md](server/drizzle/README.md): **Ein Schritt wird
  nie gelöscht und nie geändert**, sonst hält die Zusage nicht mehr, dass man von jeder alten
  Version auf die neueste kommt. Ein Fehler wird mit einem neuen Schritt geradegerückt. Ein Test
  hält die Marke jedes veröffentlichten Schrittes fest. Für die Programmdatei bettet
  [scripts/embed-migrations.mjs](scripts/embed-migrations.mjs) sie in ein gitignoriertes Modul
  ein, nach demselben Muster wie `embed-client.mjs` (erzeugte `.js`, gepflegte `.d.ts` daneben);
  ein Test hält beide Wege gegeneinander. Zeilenenden werden dabei vereinheitlicht, weil Git
  Textdateien unter Windows auf CRLF umstellt und die Marke sonst vom Rechner abhinge.
- **Der eingefrorene Eingang** ([server/src/legacy/](server/src/legacy/), Aufgabe 6b, mit eigenem
  [README.md](server/src/legacy/README.md)): der Weg einer alten `db.json` in die Datenbank, und
  zwar **auf den Stand nach Migration 0000 und nicht auf den neuesten**. Der Umstieg legt deshalb
  nur den ersten Schritt an, importiert, rechnet nach, und **erst danach** läuft die übrige
  Migrationskette darüber (`changeover.ts`, Schritt 8b). Möglich ist das, weil `applyMigrations`
  an Prüfsummen hängt, ein zweiter Aufruf also nur das Fehlende nachholt. Dasselbe Muster wie
  Djangos „historical models" und Flyways „baseline".
  **Der Gewinn ist, dass eine Datenregel nur noch einmal dasteht.** Vorher hätte jede Änderung am
  Wortschatz an zwei Stellen gepflegt werden müssen, im Migrationsschritt und im Importpfad, und
  wer die zweite vergaß, bekam keinen Fehler, sondern einen Bestand, der still anders dasteht.
  Jetzt trägt die Migrationskette die Regel allein.
  **Drei Dateien hängen an einer Prüfsumme** (`schema.ts`, `write.ts`, `migrate.ts`, siehe
  [legacy-schema.test.ts](server/test/legacy-schema.test.ts)), dazu zwei Quelltext-Wächter: kein
  Import aus `db/schema.ts`, und der Umstieg liest mit `legacy/read.ts`. Geprüft wird der
  Quelltext, weil es kein Verhalten gibt, solange Ausgangsstand und neuester Stand derselbe sind.
  `read.ts` steht bewusst **nicht** unter der Marke: Es erfüllt `SnapshotSource` und wächst
  deshalb mit dem mit, was die Berechnung aus einem Bestand liest.
  **Eingefroren ist der Aufbau der Tabellen, nicht jeder Helfer** — die Dateien importieren
  `ai/settings.ts`, `schedule.ts` und `calc.ts`. Die enge Ausnahme für eine Änderung steht im
  README daneben, samt der Regel, dass die neue Marke in denselben Commit gehört; sonst ist der
  Zweig dazwischen rot und `git bisect` bricht dort ab.
  **Die Grenze zieht, was die Daten brauchen**: Fachliches wird eingefroren, weil es
  reproduzierbar sein muss; die Einstellungen bleiben am lebenden Stand, weil sie heute benutzbar
  sein müssen, und an der Grenze klemmt `legacy/write.ts` vier Aufzählungen auf erlaubte Werte.
- **Schema und Datenmodell hält [server/test/schema.test.ts](server/test/schema.test.ts)
  zusammen**, zur Übersetzungszeit. `shared/types.ts` bleibt von Hand geschrieben, weil der
  Browser es benutzt und von Drizzle nichts wissen darf; der Test schlägt fehl, sobald jemand
  nur eine Seite ändert.
- **Der Validator** ([server/src/legacy/validate.ts](server/src/legacy/validate.ts), #59) prüft einen
  Datenbestand, bevor er übernommen wird: beim Wiederherstellen eines Backups und beim
  Umstieg der vorhandenen Bestände. Geprüft wird der **rohe** Inhalt der Datei
  und nicht der schon eingelesene Bestand, denn `migrateLegacy` verträgt keinen beliebigen
  Inhalt und genau davor soll die Prüfung schützen. Das Ergebnis ist eine **Liste von Befunden
  mit Ort und Grund**, kein Wahrheitswert: „Die Datei enthält keine gültigen Daten" ist keine
  Antwort, mit der ein Vermieter etwas anfangen kann. Die Listen erlaubter Werte kommen aus
  schema.ts und stehen nicht noch einmal daneben.
- **Die Grenze zwischen kaputt und krumm** ist der Entwurfspunkt des Validators, und an ihr
  hängt der Umstieg. Zu streng heißt, dass ein Bestand, mit dem jemand seit Jahren arbeitet, nie
  in die Datenbank käme; zu lasch heißt, dass ein beschädigter erst beim Einfügen auffällt,
  mitten im Umstieg. **Abgelehnt** wird, was sich nicht übernehmen lässt, ohne eine Zahl der
  Abrechnung zu verändern oder Erfasstes zu verlieren. **Hingenommen** wird, was beides
  erfüllt: Es entsteht durch gewöhnliche Bedienung oder in einem älteren Bestand, und es lässt
  sich so geraderücken, dass die Abrechnung dieselben Zahlen ergibt. Das Geraderücken folgt
  dabei immer einer Regel, die schon in calc.ts oder legacy/migrate.ts steht, und erfindet nie eine
  neue. Hingenommen sind heute: die alten Formate, eine fehlende Sammlung oder Einstellung, eine
  Direktzuordnung auf eine gelöschte Wohnung (wird `null`, wie `ON DELETE SET NULL`), ein
  vereinbarter Anteil auf eine gelöschte Wohnung (entfällt, verteilt wurde er ohnehin nicht),
  zwei Staffeleinträge zum selben Stichtag (der letzte gilt, wie in calc.ts), eine fehlende
  Wohnfläche (0 m², wie `u.areaM2 || 0`), eine fehlende Beteiligung, eine fehlende Personenzahl,
  ein Zähler mit leerer Wohnungs-Kennung (Hauptzähler, wie `m.unitId && …` ihn schon liest) und
  ein fehlendes Feld, das nur angezeigt wird. Was hingenommen wird, steht als `adjustments` im
  Ergebnis und ist zugleich die **Vorschrift für den Umstieg**.
- **Geprüft wird das Geraderücken rechnend, und zwar über alle vier Rechnungen**
  ([validate.test.ts](server/test/validate.test.ts)): Abrechnung, Mietkonto, Steuerübersicht und
  Verbrauchsübersicht, je einmal vor und einmal nach dem Geraderücken. Die Abrechnung allein
  genügt nicht, und das ist nicht theoretisch: **Ein Fall bewegt eine Zahl**, nämlich der feste
  Monatsbetrag neben einer *leeren* Staffel. Die Abrechnung liest ihn (`computePrepaymentCents`),
  das Mietkonto nicht (`rentLedger` liest nur `prepayments`), und die Steuerübersicht nimmt ihre
  Einnahmen vom Mietkonto. Nach dem Geraderücken sagen alle drei dasselbe: Das Soll steigt um
  die Vorauszahlung, dieselbe Zahlung deckt weniger Monate, und ein Monat kann von „bezahlt" auf
  „teilweise" wechseln. Die Richtung ist gutartig, das Mietkonto forderte bisher zu wenig, aber
  es ist eine Änderung und steht deshalb überall ausdrücklich dabei. Es ist eine gemessene
  Ausprägung von #70. Ein weiterer Test lässt den ganzen Prüfkatalog durch den Validator laufen,
  damit niemand ihn unbemerkt verschärft; seine Fangkraft hängt allerdings daran, dass zwei
  Fixtures Felder auslassen (siehe die Warnung im Test).
- **Backup und Wiederherstellen sprechen die Datenbank**
  ([server/src/db/backup.ts](server/src/db/backup.ts), Aufgabe 7a). Das steht **vor** dem
  Umstellen der Routen, und zwar wegen des Ausgangs, den es zu vermeiden gilt: Sobald die Routen
  aus der Datenbank lesen, spielt jemand ein Backup ein, sieht eine Bestätigung und arbeitet
  danach mit den alten Daten weiter. Ein zweiter Umstieg holt das nicht nach, denn er
  unterbleibt, sobald in der Datenbank etwas steht. Das Archiv enthält deshalb
  `mietfuchs.sqlite` und `mietfuchs-backup.json` (Version und Zeitpunkt, eine **Auskunft und
  keine Prüfung**; Archive aus älteren Versionen haben sie nicht). Der Schnappschuss entsteht
  mit **`VACUUM INTO` und nicht als Dateikopie**: Der Server hält die Datei die ganze Laufzeit
  offen, und eine laufende SQLite-Datei zu kopieren liefert im schlechtesten Fall einen Stand,
  den es nie gab. `VACUUM INTO` liefert eine Datei, die für sich steht, ohne Beidateien und mit
  der Buchführung über den Aufbau. Geprüft wird sie **vor** dem Austausch, mit derselben Frage
  wie beim Öffnen (`unknownSteps` in open.ts steht dafür nur einmal da, die Empfehlung an den
  Nutzer formuliert jeder Aufrufer selbst): Über den Umweg Backup käme ein neueres Schema sonst
  herein, und die Prüfung beim Start käme zu spät, weil die Datei dann schon an ihrem Platz
  läge. Ersetzt wird nach demselben Muster wie beim Umstieg, also die Schlange leerlaufen lassen,
  schließen, ersetzen, neu öffnen; die bisherige Datei wandert als `mietfuchs.sqlite.vor-restore`
  beiseite. Bewegt wird mit `replaceFile` und damit mit Wiederholungen, wie beim Umstieg: Ein
  Virenscanner unter Windows hält die eben geschlossene Datei kurz fest, und ein nacktes `rename`
  scheiterte dann ausgerechnet, während die einzige Kopie der wiederhergestellten Daten noch
  unter ihrem Zwischennamen liegt.
- **Genau eine der beiden Ablagen kommt ins Archiv, nämlich die, die den Bestand trägt.** Diese
  Regel und ihr Gegenstück beim Wiederherstellen sind aus einer Durchsicht hervorgegangen, und
  ohne sie verliert der Aktualisierungsweg Daten. Ein Archiv konnte beides führen, und beim
  Wiederherstellen gewann die mitgebrachte Datenbank ohne Prüfung. Wer eine Version vor dem
  Umstellen der Routen fährt, hat aber eine lebende `db.json` und eine Datenbank, die auf dem
  Stand des Umstiegstags stehengeblieben ist; und wer ein Backup zieht, während der Umstieg
  gescheitert ist, hat eine **leere** Datenbank neben einer vollen `db.json`. In beiden Fällen
  sah der Vermieter nach der Bestätigung „ok" ein veraltetes oder leeres Haus, schrieb hinein,
  und ab dem Augenblick fand der Umstieg eine gefüllte Datenbank vor und lief nie wieder. Genau
  der Ausgang, den die Sperre in health.ts verhindern soll; das Backup führte daran vorbei.
  Deshalb: Das Backup packt die Datenbank nur ein, wenn `databaseUnavailable` `null` sagt, sonst
  die `db.json`. **Und beim Wiederherstellen gilt eine `db.json` im Archiv vor der Datenbank**,
  denn jede bisher veröffentlichte Version hat sie als lebenden Bestand geschrieben. Geraten wird
  dabei nichts: Ab dieser Version kann gar kein Archiv mehr entstehen, das beides führt.
- **Ein Archiv ohne Datenbank** ist kein Randfall, sondern jedes, das vor dieser Version
  entstanden ist: Dann wird die Datenbank aus der wiederhergestellten `db.json` neu aufgebaut,
  mit `runChangeover` und damit mit derselben centgenauen Regression. Sie wandert dafür ganz
  beiseite statt gelöscht zu werden, damit der Umstieg sie leer vorfindet und seine Regel „steht
  schon etwas darin, passiert nichts" nicht weich wird. **Danach werden die Einstellungen neu
  eingelesen**: Sie liegen als Kopie im Arbeitsspeicher, und ohne das Auffrischen zeigte die
  Oberfläche bis zum nächsten Start den Stand von vorher. Die gedruckte Abrechnung nimmt von dort
  Vermietername und IBAN, und weil `PUT /api/settings` vom Zwischenspeicher ausgeht, schriebe die
  nächste beliebige Änderung den veralteten Stand vollständig zurück.
- **ZIP lesen und schreiben**: Backup und „Belege für die Steuer“ schreibt yazl als Strom an den
  Browser, statt das Archiv im Speicher zusammenzusetzen; jeder Name steht als UTF-8 mit dem
  Kennzeichen dafür da, wie vorher bei adm-zip, und ein Test liest ein neues Backup mit adm-zip
  Byte für Byte zurück, weil der Rückweg in eine ältere Version es so lesen muss. Gelesen wird
  das hochgeladene Archiv mit yauzl über [server/src/zipRead.ts](server/src/zipRead.ts): Es
  prüft zuerst nur das Verzeichnis (Zahl der Einträge aus dem Ende des Archivs, Größe je Eintrag
  und zusammen, Packdichte, Namen) und packt dann als Strom aus, zählt dabei nach und rechnet die
  Prüfsumme nach, die yauzl nicht prüft. Die Grenzen fürs Wiederherstellen stehen mit Begründung
  an `RESTORE_LIMITS` in index.ts (50.000 Einträge, 2 GB je Eintrag, 20 GB zusammen und nicht mehr
  als frei ist, höchstens hundertfach gepackt ab 64 MB). Das hochgeladene Archiv liegt dabei auf
  der Platte, ausgepackt wird in eine Zwischenablage `restore-…` im Datenordner, und erst wenn
  alles gelesen und geprüft ist, wandern die Belege per `rename` in den Belegordner, vor der
  db.json. Reste eines abgebrochenen Vorgangs (`restore-upload-<id>.zip`, `restore-<id>/`) räumt der
  Start weg, `mietfuchs.sqlite.restore-*` bleibt. Die Dateiarbeit samt Platzbedarf (Belege plus
  doppelte Datenbank, doppelte db.json und 64 MB Reserve) steht in
  [server/src/restoreFiles.ts](server/src/restoreFiles.ts); `NKA_TEST_FREE_BYTES` gibt den freien
  Platz für Tests vor. **Namen liest zipRead.ts wie adm-zip**: ohne UTF-8-Kennzeichen als UTF-8,
  wenn die Bytes gültig sind, sonst CP437, danach NFC; yauzl allein läse nach der Norm CP437, und
  ein neu gepacktes Backup bekäme „M├╝ll.pdf“ statt „Müll.pdf“. Beim Schreiben hängt der
  `error`-Horcher von yazl ab `createZip` (sonst beendet eine verschwundene Datei den Server).
  **Datendeskriptor**: yazl schreibt Dateien von der Platte immer mit Bit 3, und einen
  gespeicherten Eintrag damit können Stromleser (funzip, Java ZipInputStream) nicht abgrenzen.
  Das Backup packt deshalb alles (schon Gepacktes mit Stufe 1), das Steuer-ZIP entsteht aus dem
  Speicher (`addBuffer`, ohne Bit 3, PDF und Fotos nur gespeichert), weil ein Steuerberater es mit
  beliebigen Werkzeugen öffnet. Das Aufräumen beim Start nimmt nur die Namen, die die Route
  vergibt (`restore-<16 Hexziffern>`), nie einen Ordner des Nutzers. Der Kontoauszugsleser
  (server/src/bank/read.ts) liest noch mit adm-zip und eigenen Grenzen.

**Objekte** (#92): Eine Installation verwaltet mehrere Objekte (`properties`), und **ein Objekt
ist zugleich die Abrechnungseinheit**. Eine dritte Ebene gibt es bewusst nicht: Alle Programme
für Kleinvermieter haben Objekt → Einheit → Mietverhältnis, eine Wirtschaftseinheit als eigene
Ebene nur Verwaltersoftware. Mehrere Gebäude, die gemeinsam abrechnen, sind *ein* Objekt; eine
Rechnung für mehrere Objekte wird vorverteilt (#95). Die Flexibilität kommt in die
Kostenposition (#94), nicht in weitere Ebenen.

- **Wurzeln tragen das Objekt, alles andere erbt es**: `property_id` steht an Wohnungen, Zählern
  (eigens, weil ein Hauptzähler keine Wohnung hat), Kostenpositionen und abgeschlossenen
  Abrechnungen. Mietverhältnisse erben über die Wohnung, Zahlungen über das Mietverhältnis,
  Ablesungen über den Zähler. Eine zweite Spalte wäre eine zweite Wahrheit. `ON DELETE RESTRICT`:
  Gelöscht wird nur ein leeres Objekt, und nie das letzte (repository.ts, `removeProperty`).
- **Eingegrenzt wird an genau einer Stelle**, `narrowToProperty` in snapshot.ts. Ein fehlender
  Filter ergäbe keine Fehlermeldung, sondern eine Verteilung über zwei Häuser. Die Routen rechnen
  über `snapshotFor` und listen über dieselbe Funktion; eine Invariante in calc.test.ts prüft an
  zufälligen Beständen mit zwei Objekten, dass jedes rechnet, als wäre es allein.
- **Kein Verweis über Objektgrenzen**: Zähler, Direktzuordnung, vereinbarte Anteile, Teilnehmer
  und Einzelbeträge (#94) dürfen nicht auf eine Wohnung oder ein Mietverhältnis eines anderen
  Objekts zeigen; das gilt auch, wenn eine Wohnung das Objekt oder ein Mietverhältnis die Wohnung
  wechselt (`guardUnit`, `guardTenancy`) (`sameProperty`, `CrossPropertyError`
  mit 400). Zusammengesetzte Fremdschlüssel scheiden aus, weil `direct_unit_id` mit `ON DELETE
  SET NULL` alle Spalten des Schlüssels leeren würde, auch das Pflichtfeld. Das Wiederherstellen
  fragt denselben Befund über den ganzen Bestand ab (`crossPropertyViolations`).
- **Abgeschlossene Abrechnungen sind eindeutig je (Objekt, Jahr).** Vorher je Jahr, und mit zwei
  Objekten hätten Versanddatum und Wiederöffnen die Abrechnung des falschen Hauses getroffen.
- **Die Routen nehmen `?property=`**, beim Anlegen einer Wurzel auch `propertyId` im Rumpf
  (`propertyOf` in index.ts). **Fehlt die Angabe und gibt es genau ein Objekt, gilt dieses**, so
  arbeiten alte Tabs, Smoke-Test und Praxislauf unverändert; bei mehreren antwortet die Route mit
  400, statt still alle zu liefern. Belege und Backup bleiben installationsweit; der Belegordner
  fragt die Kostenpositionen deshalb je Objekt ab (siehe Belegordner).
- **Einstellungen**: Name und Adresse gehören zum Objekt. Die Spalten `house_name` und `address`
  stehen noch in `settings`, weil der eingefrorene Eingang sie schreibt und Migration 0001 sie
  abliest; ausgeliefert und angenommen werden sie nicht mehr. Vermieter, IBAN und Zahlungsfrist
  bleiben dort als **Vorgabe**; am Objekt dürfen sie abweichen, `null` heißt „Vorgabe gilt“
  (`effectiveLandlord` in client/src/landlord.ts).
- **Die db.json kennt keine Objekte**: `Db` in store.ts beschreibt ihre Sammlungen mit
  `LegacyUnit`, `LegacyMeter` und `LegacyCostItem`. Tests, die einen Bestand in die Datenbank
  bringen, gehen den Weg des Umstiegs (`openDatabaseWithStock` in server/testing/database.ts):
  auf 0000 schreiben, dann die Kette.
- **Oberfläche**: `PropertyProvider` (client/src/property.tsx) nach dem Muster des
  `YearProvider`; der Umschalter erscheint erst ab dem zweiten Objekt. Seiten hängen das Objekt
  mit `withProperty` an ihre Abrufe. `PageHeader` nennt das gewählte Objekt in der Kontextzeile
  (seit #346 Schritt 8 auch bei einem einzigen, siehe Seitenkopf unter Konventionen), und nach dem Wechsel in ein Objekt ohne Wohnungen steht oben ein Hinweis mit „Zurück zu …“
  (#157, Logik in client/src/propertyView.ts, das vorige Objekt merkt der Provider): Ein leeres
  neues Objekt sah sonst aus wie ein verlorener Bestand.

**Abrechnungszeitraum** (#208, Kern): Ein Objekt rechnet im Kalenderjahr oder in einem eigenen
Rhythmus ab. **Der Zeitraum ist ein eigener Schlüssel** `PeriodKey` (`'JJJJ-MM'`, Monat des Beginns,
Markentyp in shared/types.ts), und kein Jahr: `cost_items.period`, `closed_settlements.period`,
`closed_settlement_history.period`, `prepayment_overrides.period` und `assessments.requested_period`
(nur mit Objekt). `uploads.year`, `assessments.year` und `detected_year` bleiben Kalenderjahre, denn
sie sind Tatsachen über den Beleg; ebenso `assessments.requested_year`, das gewählte Jahr, das auch
ohne Objekt stehen bleibt und beim Zuordnen den Zeitraum ergibt (sonst wäre eine später zugeordnete
Auswertung grün und „Alle grünen übernehmen“ buchte ungesehen in ein anderes Jahr). **Die Zeiträume werden berechnet und nie gespeichert**
([shared/period.ts](shared/period.ts)): aus `properties.period_start_month` und `period_changes`
entstehen lückenlose Zeiträume von höchstens zwölf Monaten (`bgb.max-period-months`), vor jedem
Wechsel ein Rumpf. Aus Text wird ein Schlüssel nur dort (Wächter in period.test.ts). Der
Schnappschuss trägt P und den Vorzeitraum, `computeSettlement` rechnet über dessen Grenzen und
Monate, eine Wache in calc-zeitraum.test.ts verbietet Kalenderdaten in seinem Rumpf. **Mietkonto und
Steuer bleiben Kalenderjahr**; die Abrechnung teilt sich mit dem Mietkonto die Monatsrechnung
`ledgerRows`. Die Routen der Abrechnung und des Verbrauchs nehmen `JJJJ-MM`; **die nackte Jahreszahl
gilt nur bei einem reinen Kalenderobjekt**, sonst 404 mit einem Satz, der den gemeinten Zeitraum
nennt, damit ein alter Tab nie still einen Rumpf bekommt. Dasselbe beim Schreiben: `year` statt
`period` oder eine vierstellige Jahreskorrektur nimmt repository.ts nur beim Kalenderobjekt an
(`PeriodError`), und die Listen nennen einem alten Tab dort weiter `year` an den Kostenpositionen
und die Jahreskorrektur nach Jahreszahl. Schickt ein Tab Jahreszahlen, gilt sein Stand vollständig
für die Kalenderzeiträume, sonst bliebe eine zurückgesetzte Korrektur stehen. Ein ungültiger
`period` ist eine 400 und wird nicht still ersetzt. Ein
Schlüssel, den es für sein Objekt nicht gibt, wird beim Schreiben abgelehnt und beim Wiederherstellen
eines Archivs ebenso (`orphanPeriodKeys`). Die Frist kommt vom Server (`Settlement.deadline`,
`settlementDeadline` mit `bgb.deadline-months`) und friert mit ein.
**Bedienung** (PR 3): Den Rhythmus ändert nur der Wechsel mit Vorschau
([server/src/db/periodChange.ts](server/src/db/periodChange.ts), `POST /api/properties/:id/period/preview`
und `PUT …/period`); er bekommt die ganzen neuen Regeln und vergleicht sie mit den alten. Ein
abgeschlossener Zeitraum, der sich änderte, sperrt (409); Jahreskorrekturen werden neu erfasst, wenn
ein Mietverhältnis danach Monate in mehr als einem oder einem anders geschnittenen Zeitraum hat
(eine gezahlte Summe lässt sich nicht verteilen), ohne Antwort wird nicht gespeichert. Das Jahr der
Zahlung jeder Position, die in einen Zeitraum über zwei Kalenderjahre gelangt oder deren Zeitraum
dorthin wächst, fragt die Vorschau, vorbelegt und in die Spanne geklemmt; verschoben wird durch
dieselbe Schreibprüfung wie beim Speichern, eine gescheiterte ist eine 409 mit Vorschau. Die
Vorschau trägt eine Marke (`token`); stimmt sie beim Wechsel nicht mehr, gibt es 409 mit der neuen. **Kalte
Rechnungen mit Leistungszeitraum über zwei Zeiträume werden beim Speichern nach Tagen aufgeteilt**
(ein Teil wird danach nur berichtigt: Leistungszeitraum und Zeitraum eines Teils ändert weder das
Speichern noch das Aufteilen, `isSplitPart` in repository.ts)
([server/src/serviceSplit.ts](server/src/serviceSplit.ts), Leistungsprinzip); jeder Teil trägt den
ganzen Leistungszeitraum, daran erkennt die Abrechnung ihn. Heizkosten nie (VIII ZR 156/11), dort
warnt `period.heating-mismatch`. `tax_year` ist das Jahr der Zahlung, Pflicht nur bei einem
Zeitraum über zwei Kalenderjahre; die Steuerübersicht jedes Objekts schöpft aus allen
Abrechnungen, die das Jahr berühren (`taxPartsFor` in calc.ts, seit #255 auch beim Kalenderobjekt),
und das Steuer-ZIP nimmt dieselben Positionen (`taxArchiveItems` in taxReceipts.ts). **Welches Jahr
eine Position für die Steuer hat, sagt beim Rechnen `outflowShares`** ([server/src/outflow.ts](server/src/outflow.ts)),
eine Liste `{ year, cents, source }` als Naht zu #292; bis dahin genau ein Anteil über den ganzen
Betrag (angegebenes Jahr, sonst Beginn des Zeitraums). **Ein Abzug beim Betriebsstrom hat kein eigenes Jahr**
(#267): Er nimmt das seiner Stromrechnung (`operatingPowerGeneralId`, Quelle `bill`), abgeleitet und nicht
gespeichert; `mergeCostItem` leert `tax_year` am Abzug beim Speichern, und ein älterer Wert wird nicht gelesen.
Der Zeitraumwechsel (periodChange.ts) und die Schätzhilfe (db/operatingPower.ts) lesen das bisherige Jahr über
`storedOutflowYear`; heatingPeriodChange.ts und `defaultHeatingPlant` in repository.ts lesen `taxYear ?? Beginn`
noch selbst, das zieht PR 3 von #255 nach. Gegen eine vom Code unabhängige Referenz prüft
[outflow.test.ts](server/test/outflow.test.ts): Prüfsummen der Steuerübersicht je Startwert in
`server/test/fixtures/tax-golden.json` (server/testing/taxGolden.ts), erzeugt mit dem Code von `main` auf dem Bestand
mit dem Abzug im Jahr seiner Rechnung; für ein Jahr mit einem Abzug außerhalb des Teils seiner Heizposition nur die
Beträge, den privaten Teil prüft dort die Invariante S1. **Der Vorschlag nach § 560 im
Rumpf** rechnet je Position einen Jahresfaktor ([server/src/prepaymentSuggestion.ts](server/src/prepaymentSuggestion.ts)):
kalt nach den Tagen ihres Leistungszeitraums im Rumpf, gleichartige über die Vereinigung, ohne
Leistungszeitraum als Jahresbetrag mit Hinweis `prepayment.annual-assumed`; Brennstoff (`heating_part = 'fuel'`) nach Gradtagen aus `hkv.degree-days` über die
Vereinigung der Leistungszeiträume, feste Heizpositionen nach den Tagen ihres Leistungszeitraums;
fehlt für den Brennstoff ein Faktor, gibt es keinen Vorschlag. Die Oberfläche hält einen **Tag** und
keinen Schlüssel ([client/src/period.tsx](client/src/period.tsx), Logik in
[client/src/periodForm.ts](client/src/periodForm.ts)): Der Zeitraum ist der, der ihn enthält, so
passt ein Objektwechsel ihn von selbst an. Beim Kalenderobjekt heißt der Umschalter weiter
„Abrechnungsjahr“, seine Werte sind Jahreszahlen und die Routen bekommen die Jahreszahl; Mietkonto
und Steuer haben bei abweichendem Zeitraum einen eigenen Umschalter „Kalenderjahr“ auf der Seite
(`CalendarYearSelect`, beim Kalenderobjekt gibt es ihn nicht, dort ist das Kalenderjahr der Zeitraum
der Seitenleiste). Gewählt wird der Zeitraum sonst nur in der Seitenleiste (#346 Schritt 8). Die Belegbuchung
bucht in `bookingPeriod` (shared/assessment.ts): den gewählten Zeitraum, wenn er das Jahr des Belegs
berührt, sonst den mit der größten Überschneidung. Der gewählte Zeitraum einer Auswertung entsteht
aus dem gewählten Jahr nach den Regeln des Objekts (`periodForYear`) und nie als festes `JJJJ-01`:
Das wäre bei Mai bis April ein verwaister Schlüssel, und jedes spätere Backup lehnte das
Wiederherstellen ab. Ein schon aufgeteilter Teil wird bei einem weiteren Wechsel nur über den Teil
seines Leistungszeitraums neu geteilt, der in seinem bisherigen Zeitraum liegt, und beim Berichtigen
seines Betrags nicht noch einmal (`needsSplitCheck` mit der gespeicherten Position).

**Fristen und Feiertage** ([shared/holidays.ts](shared/holidays.ts),
[shared/deadlines.ts](shared/deadlines.ts)): reine Funktionen in UTC, ohne Uhr und ohne Datenzugriff.
Maßgeblich ist das Land des Objekts (`properties.state`, eine der 16 Kennungen oder `null`, Schritte
0060/0061, ein fremdes Kürzel ist eine 400 und wird nicht still zu „unbekannt“).

- **Regeln und Feiertage stehen im Rechtsregister**: `bgb.rent-due-workday` (3, § 556b Abs. 1 BGB),
  `bgb.rent-due-saturday` (Samstag zählt nicht, BGH VIII ZR 129/09; VIII ZR 222/15 betrifft nur die
  Rechtzeitigkeit der Überweisung), `bgb.deadline-on-workday` (§ 193 BGB) in shared/law/bgb-betrkv.ts, und
  je Feiertag ein Parameter `holiday.*` in [shared/law/feiertagsgesetze.ts](shared/law/feiertagsgesetze.ts)
  (Tag im Jahr, Länder, gemeindeweise Länder; einmalige Feiertage als Fassung eines Tages, `eventDate`).
  Im Register und nicht in einer eigenen Tabelle, weil es Rechtswerte mit Gültigkeit sind und dort
  Fassungsgeschichte, Prüfstand und Release-Sperre schon gelten. `checked` nur, wo der Wortlaut amtlich
  gelesen ist; Werte für mehrere Länder, deren Gesetze nicht alle gelesen sind, `adopted` mit Angabe, was
  gelesen ist, und dem Abgleich mit beiden Vergleichslisten. holidays.ts rechnet daraus mit Osterformel,
  ohne Laufzeitbibliothek: feiertagejs wich von der Vergleichsliste ab, und date-holidays stimmt zwar,
  seine Feiertagsdaten stehen aber unter CC BY-SA 3.0 (Mietfuchs: AGPL-3.0, damit nicht verträglich) und kämen mit rund 40 MB
  Abhängigkeiten in Programmdatei und Image. Geprüft wird gegen **zwei unabhängige Quellen**: eine feste
  Liste der Python-Bibliothek holidays
  ([server/test/fixtures/holidays/](server/test/fixtures/holidays/README.md), 1995 bis 2100) und
  **date-holidays als devDependency der Wurzel** (`holidays-date-holidays.test.ts`, 1995 bis laufendes
  Jahr + 10). Die Wurzel, weil deren node_modules weder das Docker-Image (es übernimmt nur server/,
  client/dist und shared/) noch Bun noch Vite erreichen; ein Test verlangt, dass nichts außer Tests das
  Paket importiert. Dependabot hebt es monatlich: Trägt seine Pflege eine Gesetzesänderung nach, wird
  der Test rot, und das Register bekommt eine neue Fassung mit amtlicher Fundstelle. Die gemeindeweisen
  Regionen (BY KATH/A, SN BZ, TH EIC) sind in beiden Abgleichen genau Land plus Hinweis. Vor 1995 wird
  nicht gerechnet. Einmalige Feiertage, die ein Land
  künftig beschließt, kommen als neue Fassung ins Register. Gefragt wird mit `valueAt`, weil noch keine
  Abrechnung damit rechnet; rechnet calc.ts einmal mit einer Frist, dann mit `law()` und Protokoll.
- **Gemeindeweise Feiertage werden nicht geraten** (Mariä Himmelfahrt in Bayern, Augsburger
  Friedensfest, Fronleichnam in Teilen Sachsens und Thüringens): `localHolidaysOf` nennt sie, gezählt
  werden sie nie. Fällt einer bis zum Fälligkeitstag auf einen Werktag (Fronleichnam am 03.06.2021 in
  Sachsen), sagt die Auskunft im Mietkonto, dass es dort ein Werktag später ist. **Ohne Land** zählen nur die Tage, die in allen 16 Ländern Feiertag sind; eine Frist
  kann dann einen Tag früher erscheinen als am Ort, und die Oberfläche sagt das.
- `isWorkday` verlangt die Angabe, ob der Samstag zählt; es gibt keine Voreinstellung.
  `rentDueDate` ist der dritte Werktag ohne Samstag, `deadlineOnWorkday` das Fristende nach § 193 BGB.
- **Nichts wird still ersetzt.** `ledgerRows` und die Regel aus #133 (der laufende Monat ist nie
  fällig) bleiben; calc.ts nutzt die Bausteine nicht. Einziger Einsatz ist eine Auskunft im Mietkonto
  (`rentDueNote` in client/src/ledgerView.ts): eine Zeile „Miete … fällig am …“, die Einzelheiten
  zum Aufklappen (Regel, Feiertage am Ort, der Mietvertrag kann Abweichendes bestimmen, der
  Überweisungsauftrag bis zu dem Tag genügt). Über den Rückstand sagt sie nichts, denn das Mietkonto
  zählt den laufenden Monat noch nach #133; den Fälligkeitstag dort einzusetzen ist ein eigener Schritt; gezeigt nur, wenn im laufenden Monat eine volle Monatsmiete
  geschuldet ist (`rentDueApplies`, nicht im angebrochenen Monat nach #311). Die gestrichelten Monate
  heißen dort „zählen noch nicht als Rückstand“ und nicht „noch nicht fällig“. Jeder weitere Einsatz ist eine eigene Entscheidung mit eigenem Test.
- Bewusst nicht: ein Vorschlag des Landes aus der Postleitzahl (Postleitzahlgebiete folgen nicht
  überall den Landesgrenzen, und eine Tabelle dafür wäre eine weitere Datenquelle), die Sonntage als Feiertage in Hessen (für Werktage ohne Folge) und die Frage, ob
  § 193 BGB auf eine bestimmte Frist überhaupt anzuwenden ist; das entscheidet der Aufrufer.

**Belegordner** (#170, [client/src/pages/Belege.tsx](client/src/pages/Belege.tsx), Logik in
[client/src/receipts.ts](client/src/receipts.ts)): Objekt → Jahr → Kostenart als Register, Suche,
Belegabdeckung, Posteingang und zwei Mappen. Entscheidungen und Quellen in
[docs/superpowers/specs/2026-10-02-belegordner-design.md](docs/superpowers/specs/2026-10-02-belegordner-design.md).
Objekt und Jahr kommen aus der Seitenleiste (#346 Schritt 8); der Ordner hat dafür keine eigene Auswahl
mehr, nur die Häkchen „Belege aller Objekte zeigen“ und „Belege aller Jahre zeigen“. Objekt und Jahr
eines Belegs im Posteingang sind Eigenschaften des Belegs und bleiben Auswahlfelder.

- **Die Datei ist der Beleg, die Tabelle `uploads` nur eine Beschreibung dazu**
  ([server/src/db/uploads.ts](server/src/db/uploads.ts), Migration 0012): Originalname, Art,
  Größe, SHA-256, genaue Hochladezeit, Rechnungsdatum. **Eine fehlende Zeile ist kein Fehler**:
  Alles von vor der Tabelle und jeder Beleg aus einem alten Backup wird aus der Datei beschrieben
  ([server/src/uploads.ts](server/src/uploads.ts), `describeFile`; Hochladezeit aus dem
  Zeitstempel im Namen, nicht aus der Dateizeit, die ein ZIP verfälscht). Deshalb auch kein
  Fremdschlüssel von `cost_items.invoice_file` dorthin. `GET /api/uploads` liefert die Liste auch
  ohne Datenbank, nur ohne Posteingang, und übergeht Unterordner und verschwundene Dateien. **Die
  Prüfsumme wird nie synchron gerechnet**: Fehlt sie, trägt `backfillUploads` sie gestreamt und
  je Beleg einzeln nach und schreibt sie in die Zeile; bis dahin ist `sha256` leer.
- **`kind`**: `receipt` oder `meterPhoto`. Ein Foto, das der Schuhkarton als Zählerstand erkennt,
  wird ohne Objekt als Zählerfoto gekennzeichnet und steht weder im Posteingang noch beim
  Nachreichen.
- **Objekt und Jahr nur für den Posteingang**, also für Belege an keiner Position; für verknüpfte
  ergeben sie sich aus den Positionen (keine zweite Wahrheit). `property_id` mit `SET NULL`.
  Hochladen nimmt `propertyId` und `year` als Formularfelder (`/api/upload`, `/api/extract`,
  `/api/intake`); ein unbekanntes Objekt oder ungültiges Jahr wird abgelehnt und die Datei
  entfernt, ein Fehler der Datenbank dagegen verhindert das Hochladen nicht.
- **Ein Beleg aus dem Posteingang wird nicht erneut hochgeladen**: Die KI-Routen nehmen statt
  `file` das Feld `existingFile` (nur ein Name im Belegordner, `path.basename`), und ein Abbruch
  löscht ihn nicht. Die Schnellerfassung bekommt die Belege über `handoff` aus App.tsx; ihre
  Auswertung läuft über die gespeicherte Auswertung (siehe Belegbuchung).
- **Zuordnen an eine bestehende Position** (`attachChoices`, `amountCheckBody` in receipts.ts):
  Mehr als den Namen weiß der Posteingang über einen Beleg nicht; nennt er eine Kostenart
  (`matchCategory`), stehen die Positionen, die nach shared/duplicates.ts dazu passen, oben.
  Danach fragt „Betrag prüfen“ nach dem Betrag, weil eine übernommene Position einen Schätzbetrag
  trägt; gespeichert wird nur `amountCents`, mit derselben Prüfung wie im Formular. Bei `amounts`
  und `external` (`amountCheckMode`) und wenn der Lohnanteil über dem neuen Betrag läge, gibt es
  kein Feld, sondern „Position öffnen“ (Formular auf der Seite Kosten, `onOpenItem`). Der Dateiname
  wird vor `matchCategory` mit NFC normalisiert. Trägt die Position einen §35a-Lohnanteil, nennt „Betrag prüfen“
  ihn und führt ins Formular, damit eine Schätzung nicht still in die Anlage V gelangt.
- **Löschen** nimmt die Zeile mit und bleibt gesperrt, solange irgendeine Position irgendeines
  Objekts auf den Beleg zeigt (`invoiceFilesInUse` fragt ohne Objekt).
- **Backup und Umstieg**: Die Tabelle steckt im Schnappschuss der Datenbank und kommt so mit; ein
  Archiv ohne sie (nur `db.json`, oder Datenbank einer älteren Version) ergibt eine leere Tabelle,
  der eingefrorene Eingang kennt sie nicht. Praxislauf Fall 13 prüft das über zwei Starts.
- **Belegabdeckung** wird am Betrag gemessen, eine Gutschrift mit ihrem Betrag, Positionen über
  0 € zählen nicht. Die Cockpit-Zeile „Belege vollständig“ wird **höchstens gelb**: Ein fehlender
  Beleg ändert keine Zahl der Abrechnung.
- **Belegmappe für Mieter** ([client/src/tenantFolder.ts](client/src/tenantFolder.ts)) entsteht im
  Browser mit **pdf-lib** (reines JavaScript, erst bei Bedarf geladen); was pdf-lib nicht kopieren
  kann, kommt über pdf.js als Seitenbilder hinein. Sie enthält die Positionen der Mieterzeilen der
  Abrechnung in deren Reihenfolge, ohne nicht Umlagefähiges. **Belege, die nur einzelne Mieter
  betreffen (Einzelbeträge, Direktzuordnung, Teilnehmer), nur auf ausdrückliche Wahl**, solange es
  keine Mappe je Mieter gibt; Begründung mit Quellen im Design-Text. Ein Beleg, der sich weder
  übernehmen noch rendern lässt, bricht die Mappe nicht ab: Das Deckblatt sagt „nicht
  übernehmbar, bitte gesondert beilegen“. Die Standardschrift kann nur WinAnsi, `winAnsiSafe` ersetzt den Rest.
- **Belege für die Steuer** ([server/src/taxReceipts.ts](server/src/taxReceipts.ts)) baut der
  Server mit yazl (siehe ZIP lesen und schreiben): Ordner je Gruppe aus `ANLAGE_V_GROUP` in derselben Reihenfolge wie die
  Steuerübersicht, Erhaltungsrücklage gesondert, dazu `Übersicht.csv` (mit BOM, Semikolon) mit
  jeder Position, auch ohne Beleg. Textfelder, die mit = + - @ beginnen, bekommen einen Apostroph
  davor (CSV-Formel-Einschleusung).

**Heizanlage** (Heizung PR 4, #99, #214, #180): Ein Objekt hat höchstens eine Heizanlage
(`heating_plants`, eine zweite kommt mit PR 9), dazu die angeschlossenen Wohnungen
(`heating_plant_units`) und eine Zeile je Heizperiode (`heating_periods`, ohne Vorrat; geschrieben
ab PR 6). Anlegen, Ändern und Entfernen stehen in
[server/src/db/heating.ts](server/src/db/heating.ts), die Prüfungen an Zählern und Kostenpositionen
in repository.ts, das dafür seine Rumpf-Helfer exportiert (heating.ts importiert von dort, nie
umgekehrt).

- **Eine Anlage ändert keine Zahl.** `manual` und `service` verteilen wie bisher; `change_split` wird
  gespeichert und wirkt erst mit `heating_target` (PR 10). Was spätere PRs rechnen (eigene
  Abrechnung, Etagenheizung, zweite Anlage, eigene Heizperiode, getrennte Abrechnung, beheizte
  Fläche), lehnt der Server mit `HeatingError` (400) und einem Satz ab.
- **Ohne Liste alle Wohnungen, mit Liste genau diese.** Ob es eine Liste gibt, sagt
  `units_limited`, wie `participants_limited` (#94): Sonst versorgte eine Anlage, deren letzte
  Wohnung gelöscht wurde, plötzlich das ganze Haus. Eine Wohnung in der Liste wechselt nicht das
  Objekt (`guardUnit`).
- **Heizpositionen gehören zur Anlage ihres Objekts.** Beim Einrichten mit Vorschau
  (`/api/heating-plants/assignable`), danach bekommt jede neue Position der Kostenart Heizung und
  Warmwasser ohne Feld `heatingPlantId` die einzige Anlage (`defaultHeatingPlant`, auch für alte
  Tabs und die Belegbuchung). Abgeschlossene Zeiträume bekommen keine Anlage. Entfernen gibt die
  Positionen frei; hängen noch Zähler an der Anlage, wird abgelehnt.
- **Zähler der Anlage** (`heating_plant_id` mit Rolle, ohne Wohnung) sind **keine Hauptzähler** des
  Hauses (`houseMeters` in calc.ts). **Warmwasserzähler zählen beim Kaltwasser mit**, aber nur ein
  Kaltwasserzähler sagt, ob eine Wohnung gemessen ist (G-B8, `measures`). Nach
  Heizkostenverteilern verteilt Mietfuchs erst mit Bewertungsfaktoren (PR 12); bis dahin lehnt der
  Server den Schlüssel ab, und die Oberfläche bietet ihn nicht an.
- **Fernablesbarkeit** entscheidet [server/src/remoteReading.ts](server/src/remoteReading.ts) nach
  `hkv.remote-reading.new-devices` (Einbau nach dem Stichtag: ab Einbau) und
  `hkv.remote-reading.retrofit` (ältere ab 2027), aus den Zählern oder, beim Messdienst, aus der
  Angabe an der Anlage. Ein neues Gerät in einem System, dessen übrige Geräte nicht fernablesbar
  sind (laut Anlage keines oder alle anderen bekannten nicht), kann ein Ersatz nach § 5 Abs. 2 Satz 4
  sein; dann gilt die Frist des Abs. 3, vorher heißt es nur „bis zu“. Ob einzeln ersetzt oder als
  Ganzes neu installiert, fragt die Anlage (`new_devices_install`: `single` | `whole`, NULL offen);
  unbeantwortet nennt der Hinweis die Frage. Ein allein bekanntes Gerät ist nur sicher, wenn die
  Anlage keine weiteren Wohnungen ohne erfasstes Gerät versorgt. Sicher heißt
  `heating.remote-reading-missing` (warning, 3 % je Mieter in Wohnungen an der Anlage, auf die
  gedruckten Heizzeilen), möglich `heating.remote-reading` mit „bis zu“; ohne Anlage oder ohne
  Angaben bleibt `heating.remote-reading` wortgleich wie vor PR 4. Zwei Codes, weil die Stufe am
  Code hängt (#112).
- **Zweifamilienhaus** ist eine Art des Objekts (`zfh`) und nur Beschreibung; § 2 hängt an den
  Wohnungen (`mayAgreeOtherwise`), ein Widerspruch ergibt `property.kind-mismatch` (hint).
- Das Wiederherstellen prüft Verweise auf Anlagen anderer Objekte, überlappende Anlagen und
  Heizperioden ohne Zeitraum (`heatingPlantViolations`).

**Eigene Heizperiode und getrennte Heizkostenabrechnung** (Heizung PR 5, #217): Eine Anlage rechnet
im Zeitraum ihres Objekts ab (`period_start_month` null) oder in eigenen Heizperioden
(`period_start_month`, `heating_period_changes`, berechnet wie die Zeiträume des Objekts). Die Regeln
stehen in [shared/heatingPeriod.ts](shared/heatingPeriod.ts).

- **Positionen tragen den Schlüssel ihrer Heizperiode** (G-A2): Eine Heizposition einer Anlage mit
  eigener Heizperiode steht unter einer Heizperiode der Anlage, sonst 400. Eine neue ohne Angabe (alter
  Tab, Belegbuchung) kommt in die Heizperiode, die in ihrem Objektzeitraum endet
  (`defaultHeatingPlant`). Den Rhythmus setzt nur der Wechsel mit Vorschau
  ([server/src/db/heatingPeriodChange.ts](server/src/db/heatingPeriodChange.ts)), nie `PUT`; er
  schlüsselt die Positionen um, erfasst Korrekturen neu und lässt Abgeschlossenes unangetastet.
- **Weg b** (VIII ZR 240/07): Eine Heizperiode gehört in die Abrechnung P, in der sie endet. Der
  Schnappschuss trägt sie als `heatingParts`; `computeSettlement` rechnet jede mit derselben Funktion
  über ihre eigenen Tage (`scope: 'heatingPart'`, ohne Vorauszahlungen) und führt sie in P zusammen.
  Wer nur in der Heizperiode wohnte, bekommt `heatingOnly` mit `recommendedDeadline` und der Warnung
  `period.heating-only-statement` (15.1 Nr. 2).
- **Weg d** (Auslegung, 15.1 Nr. 21): Nur bei getrennter Abrechnung und H ≠ P. Ob eine Heizperiode
  getrennt abgerechnet wird, sagen die gespeicherten Spannen (`heating_separate_spans`: ab Monat X bis
  vor W), nicht die Antwort von heute, damit Ein- und Ausschalten nie rückwirkend wirken (C3, D1).
  Ein- und Ausschalten laufen über die Vorschau in
  [server/src/db/separateSettlement.ts](server/src/db/separateSettlement.ts); P lässt die Heizperiode
  weg, sie hat ihre eigene Abrechnung (`scope: 'heating'`, `heatingSnapshotFor`), Frist und
  Abschluss (`closed_heating_settlements` samt Verlauf; der Abschluss von P friert sie nicht ein).
  Bei H = P gibt es eine Gesamtabrechnung mit getrennt ausgewiesenen Vorauszahlungen.
- **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5): Er gehört der getrennt
  abgerechneten Heizperiode, die ihn enthält, wenn er ab X liegt, sonst der Abrechnung P
  (`separateOwner`, die einzige Stelle). **Die Jahreskorrektur von P gilt für alles, was P anrechnet**
  (bei Weg d also nur die übrigen Vorauszahlungen); eine Heizkorrektur (`heating_prepayment_overrides`,
  endgültig oder vorläufig mit Monaten, D2) gibt es nur für eine getrennt abgerechnete Heizperiode.
  Invariante 11 prüft das über zufällige Abläufe mit Abschlüssen (invariant-heizperiode.test.ts).
- Das Mietkonto führt beide Staffeln im Soll; die Steuerübersicht nimmt Heizpositionen einer eigenen
  Heizperiode im Jahr ihrer Zahlung, bei Weg d aus der Heizkostenabrechnung, und nennt dann keine
  Vorauszahlung der Abrechnung (`prepaymentSettlementCents` null).
- Ein Wechsel des Objektzeitraums lässt Heizpositionen einer eigenen Heizperiode, wo sie sind, und
  lehnt ab, wenn er Weg d für eine Heizperiode umschalten würde.
- **Jede Vorschau trägt eine Marke** (`token`, wie beim Wechsel des Abrechnungszeitraums): Der
  Wechsel des Zeitraums der Heizung und das Ein- und Ausschalten schreiben nur mit der Marke der
  Vorschau, die der Vermieter gesehen hat; sonst 409 mit der neuen Vorschau.
- **Einrichtung Schritt 3** erklärt die drei Wege (Heizperiode des Messdienstes in der
  Gesamtabrechnung, Objekt auf den Zeitraum des Messdienstes umstellen, Messdienst auf den 31.12.
  umstellen lassen) mit Vor- und Nachteilen; Vorgabe ist der erste, solange die Heizkosten nicht
  getrennt abgerechnet werden (VIII ZR 240/07, Leitsatz a). Logik in
  [client/src/heatingPeriodForm.ts](client/src/heatingPeriodForm.ts) (`heatingWays`).

**CO₂ beim Messdienst** (Heizung PR 6, #97, #209, #211): Die CO₂-Angaben einer Heizperiode stehen in
`co2_statements` (eine Zeile je Zeile in `heating_periods`), die Beträge „vom Vermieter übernommen“ je
Mietverhältnis in `co2_tenant_reliefs`. Lesen und Schreiben in
[server/src/db/co2.ts](server/src/db/co2.ts), gerechnet in [server/src/co2.ts](server/src/co2.ts) und im
CO₂-Block von `computeSettlement`; die Probe in [shared/co2Probe.ts](shared/co2Probe.ts), weil die
Oberfläche sie live zeigt. Die Rechtswerte (Anwendbarkeit ab 01.01.2023, Stufentabelle, Rundung, 3 %)
stehen in [shared/law/co2kostaufg.ts](shared/law/co2kostaufg.ts), am Wortlaut auf
gesetze-im-internet.de gegengelesen.

- **Die Methode ist eine Antwort, keine Vorgabe** (Entwurf 7.2): `serviceDeducted` (Abzugszeile),
  `serviceShown` (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt). Bei freien Schlüsseln gibt
  es nur `self`, und der Datensatz hält nur die Fläche der Einstufung (Heizung PR 7); der Topf führt
  ihn nicht (`co2PotsOf` kennt nur Angaben laut Messdienst), die eigene Aufteilung liest ihn eigens.
- **S ist die gedruckte Kostensumme** (G-B3), nicht die Summe der gerundeten Nutzerzeilen. Die Probe
  läuft nur über die Messdienstpositionen (Schlüssel `amounts`, W9): Vorwegabzug Σ = S + L ± 1 ct, nur
  ausgewiesen Σ = S, beide Einzel- und Eigenbeträge ≤ S + NE · 2 ct. Scheitert sie, wird **nichts**
  gebucht (`co2.sum-check`, error); mit „Ich finde diese Zeile nicht“ ist S geschätzt, und der
  Spielraum NE · 2 ct gilt auch für den Betrag. Geht die Probe dann auf, bleibt ein Hinweis
  (`co2.sum-check-approx`); geht sie nicht auf, wird ebenso **nichts** gebucht (Durchsicht I-2).
  Alle Hinweise eines Topfs hängen daran, dass jemand eine Zeile aus ihm hat (`settledOn`):
  Pauschal- und Warmmieter kürzen nichts. Kappt `take()` den co2Share über den Spielraum, sagt
  `co2.share-capped`, dass L in einer anderen Position steckt.
- **Vorwegabzug:** In der Position, in der L steckt (`carrierId`: die gewählte, sonst die größte),
  steht L_self exakt in `selfUse` (#203: nie über `take()`), der Rest von L als eigener Grund
  `co2Share` direkt dahinter, durch den Rest begrenzt. Die Mieter zahlen ihre Einzelbeträge
  unverändert. Damit ist #209 behoben: Werbungskosten sind das Bezahlte, L_self privat.
- **Nur ausgewiesen:** Zeilen `kind: 'co2Relief'` ohne Kostenposition (`costItemId` =
  `co2:<Anlage>:<Heizperiode>`), je Mieter der Wert laut Messdienst oder L · x / S, als eine Verteilung
  von R = round(Σ r) mit `distributeCents`; der Vermieter trägt R in einer Zeile gleicher Kennung als
  `co2Share`. Σ aller Zeilen bleibt Σ der Positionen.
- **Kürzungen** (6.5) je Mieter auf seine gedruckten Zeilen im Topf nach der Abzugszeile, nie summiert:
  3 % nach § 7 Abs. 4 CO2KostAufG (`co2.missing`, `co2.service-unsplit`, `co2.incomplete`,
  `co2.sum-check`, ohne Anlage `co2.fuel-unknown` und `co2.missing-first-year`), 15 % bei Warmwasser
  nach Formel (`heating.dhw-not-metered`). Alle Rechtswerte aus `shared/law/co2kostaufg.ts`.
- **Nachstufung** (9.2): Mietfuchs ordnet den Wert laut Messdienst in die Stufentabelle ein (gerundet
  auf eine Nachkommastelle, bei kurzer Heizperiode mit gekürzten Grenzen, ein ganzzahlig gedruckter
  Wert als Spanne) und meldet eine Abweichung als Hinweis (`co2.stage-mismatch`). § 8 und § 9
  rechnet die Berechnung nur bei der eigenen Aufteilung (PR 7, Merkmale an der Anlage).
- **Töpfe und eigene Heizperiode:** Ein Topf ist je Anlage die Menge ihrer Heizpositionen mit dem
  Schlüssel des Zeitraums der Berechnung. Bei eigener Heizperiode rechnet die Teilabrechnung (Weg b)
  bzw. die Heizkostenabrechnung (Weg d) den Topf; `mergeHeatingPart` übernimmt `heating`.
- **Ausweis:** `Settlement.heating` je Anlage und Heizperiode mit `Co2Assessment`; der Druckblock
  „CO₂-Kostenaufteilung“ ([client/src/co2View.ts](client/src/co2View.ts)) ist nicht `no-print`.
- **Oberfläche:** Seite „Heizkosten“, erst ab einer Heizanlage in der Navigation (`navFor`), mit den
  Karten „CO₂-Kosten“ (Logik in [client/src/co2Form.ts](client/src/co2Form.ts)) und „Warmwasser“.
- Eine Anlage mit CO₂-Angaben wird nicht still mitgelöscht (409); Beträge je Mietverhältnis gehören zum
  Objekt der Anlage (`guardTenancyMove`, `crossPropertyViolations`). Eine Zeile in `heating_periods`,
  die nach dem Entfernen keine Angabe mehr trägt, wird mit entfernt (`dropIfEmpty`): Der Wechsel des
  Zeitraums der Heizung (PR 5) sieht jede Zeile als erfasste Angabe. Beim Wiederherstellen prüft
  `heatingPlantViolations` die Schlüssel nach dem Rhythmus der Anlage (`plantRules`).
- **Kostenart „Heizung“ ist keine Heizposition.** CO₂-Hinweise erscheinen wie alle Heizregeln nur bei
  der Kostenart „Heizung und Warmwasser“ (`HEATING_CATEGORY`); deshalb bleibt Golden F06 (Kostenart
  „Heizung“) wortgleich, anders als im Entwurf (12.1) angenommen.

**Lieferungen** (Heizung PR 7, #97): Rechnungen des Versorgers an der Heizanlage in `fuel_deliveries`
(Teilmengen in `fuel_delivery_parts`), Positionen zeigen über `cost_items.fuel_delivery_id` darauf,
mehrere je Lieferung (Abschlag, Schlussrechnung, Gutschrift). Abgegrenzt wird in
[server/src/fuel.ts](server/src/fuel.ts) (`plantFuel`), gelesen und geschrieben in
[server/src/db/fuel.ts](server/src/db/fuel.ts); die Gradtagzahlen des Orts je Objekt und Monat in
`degree_day_values`. Die CO₂-Merkmale (§ 8, § 9, § 2 Abs. 4 Satz 2 CO2KostAufG) stehen an der Anlage
(`non_residential`, `restriction`, `district_ets_new`), ihre Rechtswerte im Register.

- **Stufen, tagesgenau gibt es nicht** (Entwurf 3.2): eingetragener Anteil, Zählerstand (genau ein
  Versorgungszähler, Stände genau an den Grenzen), Zwischenrechnung, Teilmengen, Ortswerte, Tabelle
  `hkv.degree-days`; feste Preisbestandteile (`fixed_cents`) immer nach Tagen. Die Tabelle wird nur
  gefragt, wenn eine Anlage Lieferungen hat; sonst stünde sie im Rechtsstand jeder Abrechnung.
- **Die Positionen stehen in der Heizperiode, die das Ende der Rechnung enthält** (die Verknüpfung
  wird sonst abgelehnt, `guardFuelLink`). Der Teil einer anderen Heizperiode ist eine Zeile ohne
  Position (`kind: 'fuelCarry'`, Kennung `fuel:<Lieferung>:<Heizperiode>:<andere>:<Position>`), mit dem
  Schlüssel der Position verteilt, und eine Gegenzeile beim Vermieter (`fuelCarry`, Kennung
  `fuel:<Lieferung>:<Heizperiode>:<andere>`). Über die Zeiträume hinweg ist jede Rechnung genau einmal
  verteilt; eine Invariante in calc-fuel.test.ts prüft das an Zufallsbeständen, auch über einen
  Abschluss. Eine Heizperiode ohne eigene Positionen rechnet trotzdem, wenn die Anlage Lieferungen
  hat (Topf und Teilabrechnung nach Weg b), sonst fehlte ihr der Übertrag.
- **Abgeschlossenes bleibt** (G-A4): Der Abschluss friert je Lieferung und Heizperiode in
  `fuel_carry_frozen` ein, was sie herein- oder hinausgebucht hat; gelesen wird das nur für eine
  abgeschlossene Heizperiode, das Wiederöffnen gibt es frei (`unfreezeFuelCarries`, im selben
  Vorgang wie das Wiederöffnen, danach `dropIfEmpty`). Kommt der Teil einer Rechnung in eine
  abgeschlossene Heizperiode, trägt ihn der Vermieter (`fuelClosedPeriod`), oder er ersetzt eine
  Schätzung (`fuelEstimateDiff` mit Vorzeichen). Eine Schätzung zählt, solange keine echte Rechnung
  ihre Tage abdeckt; gespeichert wird „ersetzt“ nicht. Gesperrt (409) sind eine Lieferung mit
  eingefrorenem Teil (außer der Bezeichnung) und Ablesungen des Versorgungszählers mit Datum in
  einer abgeschlossenen Heizperiode (`guardSupplyReading`, `heatingPeriodAt`).
- **Rückfrage beim Abschluss:** Bei einer Lücke mit Schätzvorschlag antwortet der Abschluss mit 409
  und `fuelGaps` (samt Frist); `fuelEstimates: 'estimate' | 'none'` entscheidet. In der Oberfläche
  ist **Abwarten** die Vorgabe (`defaultChoice: 'cancel'` im Bestätigungsdialog), weil die Schätzung
  einer noch fehlenden Versorgerrechnung höchstrichterlich nicht entschieden ist; die Schätzung
  trägt ihre Grundlage in der Bezeichnung. Eine Heizposition der Anlage ohne Lieferung deckt mit
  ihrem Leistungszeitraum ab; ohne Leistungszeitraum gibt es keinen Schätzvorschlag, sondern
  `fuel.loose-item`. Eine Schätzung, deren Tage eine echte Rechnung teilweise abdeckt, zählt nur für
  die übrigen Tage. Rechnen, Schätzungen anlegen,
  neu rechnen, Abschließen und Einfrieren laufen in **einer** Transaktion (`closeWithFuel` in
  index.ts); deshalb nehmen die Leser in read.ts ein `Executor`, und `readStock(tx)` sieht die eben
  angelegten Schätzungen.
- **Eigene CO₂-Aufteilung:** C bei freien Schlüsseln abgegrenzt, beim Messdienst ohne Aufteilung die
  angesetzten Rechnungen ganz (G-A3); E immer umgerechnet. Der Abzug folgt dem Schlüssel des
  Brennstoffs (G-B5, `bookReliefs`), § 8 und § 9 aus dem Register (`co2.non-residential`,
  `co2.restriction`), Wärme aus dem Emissionshandel bei Anschluss nach dem Stichtag
  (`co2.district-ets-new`) ohne Aufteilung.
- **Was die Durchsicht von #233 festhält:** Eine mit 0 eingefrorene Lieferung (beim Abschluss noch
  ohne Position) lässt sich verknüpfen; ihr Teil der abgeschlossenen Heizperiode geht an den
  Vermieter (`fuelClosedPeriod`). Hat eine abgeschlossene Heizperiode einen Teil ungleich 0
  eingefroren, sind Lösen, Umhängen, Verschieben und Löschen nur der **letzten** Position der
  Lieferung gesperrt (409); weitere Positionen (Abschlag, Gutschrift) sind erlaubt. Der eingefrorene
  Stand führt die Überträge je Lieferung (`frozenFuelCarriesOf`): Eine offene Heizperiode nimmt
  genau, was die abgeschlossene Heizperiode der Positionen ihr hinausgebucht hat. Eine Position zeigt nur auf eine Lieferung ihres Objekts. Die Kennung einer
  Übertragszeile nennt beide Heizperioden (`fuel:<Lieferung>:<Heizperiode>:<andere>:<Position>`),
  Hinweise an ihr führen zur Position. Die CO₂-Aufteilung gilt nur für Brennstoffe mit Standardwerten
  (§ 2 Abs. 1 CO2KostAufG): nicht für Strom einer Wärmepumpe, bei Fernwärme nur mit ausgewiesenen
  CO₂-Kosten. Die Nachstufung beim Messdienst erwartet § 8 und § 9 nach den Angaben zum Gebäude.
  **Storno nach Abschluss** (W1): Ergeben die Positionen einer Lieferung 0, wird nichts gesperrt und
  nichts verteilt; hat eine abgeschlossene Heizperiode einen Teil hereingebucht oder die
  abgeschlossene Heizperiode der Positionen einen hinausgebucht, steht beim Vermieter die
  Gegenbuchung und ihr Gegenteil als `fuelClosedPeriod` (Summe 0, ausgewiesen), dazu die Warnung
  `fuel.cancelled-after-close`; das Gegenstück nennt, was die Mieter der abgeschlossenen Heizperiode zu
  viel getragen haben (dafür führt der eingefrorene Übertrag `totalCents`). War die andere Heizperiode
  mit Schätzung abgeschlossen, steht die Schätzung als `fuelEstimateDiff` gegen. Eine stornierte
  Rechnung (Positionen mit Summe 0) verdrängt keine Schätzung, deckt keine Tage ab und zählt nicht in
  der Bewertung; die Lücke steht wieder da. Weil das auch eine echte Rechnung über 0 € treffen kann,
  sagt es der Hinweis `fuel.zero-invoice`, `fuel.uncovered` und die Rückfrage beim Abschluss nennen die
  Rechnung (`zeroInvoices` an der Lücke). Eine Schätzung ohne Rechnung mit Positionen als Vorlage für
  ihren Schlüssel wird nicht verteilt und meldet `fuel.estimate-undistributed` statt `fuel.estimated`. Ihr Satz zur Frist hält sich an den Wortlaut von § 556 Abs. 3 Satz 3
  BGB (ausgeschlossen ist nur die Nachforderung durch den Vermieter). Wurde eine Position erst nach
  dem Abschluss ihrer Heizperiode verknüpft, nimmt die andere nichts und sagt es
  (`fuel.owner-closed-unlinked`, Stufe `hint`).
  Eine Invariante über Zufallsbestände mit Abschluss (auch mit Schätzung), Wiederöffnen, Verknüpfen,
  Gutschriften bis zum Storno, geänderten Beträgen und später eintreffenden Rechnungen
  (fuel-invariant.test.ts, über die echten Schreibwege der Datenbank, ohne nachgebildete Sperren)
  prüft, dass jede Rechnung genau einmal verteilt ist: Die Mieter tragen die Positionen bis auf die
  ausgewiesenen Teile, nach oben wie nach unten, und je Lieferung und Paar von Heizperioden heben sich
  die Gegenbuchungen auf oder ein ausgewiesener Teil desselben Paars deckt sie genau (eine Summe über
  alle Lieferungen ließe eine falsche Gegenbuchung hinter einem berechtigten Teil verschwinden). Feste Startwerte, mehr mit `INV_FROM`/`INV_TO`; jede
  Rücknahme der Befunde der Durchsicht macht sie rot (Mutationsprobe).
- **Gutschrift ohne Rechnung** (#251): Ob eine Lieferung Rechnung, Storno oder Gutschrift ohne
  Rechnung ist, entscheidet **eine** Stelle, `invoiceStatusOf` in fuel.ts (Summe der Positionen > 0,
  = 0, < 0; Bewertung, Blatt für den Messdienst und Plausibilität fragen `notInvoiceDeliveries`). Eine
  Lieferung mit negativer Summe belegt keinen Verbrauch (§ 7 Abs. 2 HeizkostenV): keine Tage, keine
  Verdrängung einer Schätzung, keine Vorlage für einen Vorschlag (`templateFor` nur mit Summe > 0),
  kein CO₂, im Vorrat ungültig mit Satz. Ihr Geld wird nach Anteil verteilt wie das einer Rechnung;
  das ist Auslegung am Verbrauchsprinzip (BGH VIII ZR 156/11) und steht so im Hinweis
  `fuel.credit-only` (bestätigt `fuel.credit-only-confirmed`, Stufe `hint`, über
  `fuel_deliveries.credit_note_kind = 'standalone'`, Migration 0046/0047; die Angabe steuert nur die
  Stufe, keine Zahl). `POST /api/fuel-deliveries/:id/reassign-credit` (`reassignCredit`) hängt die
  Positionen an die Lieferung, die sie berichtigt, in deren Heizperiode; 409, solange eine der
  beiden abgeschlossen ist. Oberfläche: `client/src/fuelCredit.ts`.
  **Eingefrorener Teil ≠ heutiger Teil** (R-2): Hat eine abgeschlossene Heizperiode einen anderen Teil
  einer Rechnung eingefroren als heute auf sie entfiele, bucht die Heizperiode der Positionen nur den
  heutigen hinaus (`frozenPart` am Übertrag); der Unterschied steht beim Vermieter als
  `fuelClosedPeriod` (darüber: `fuel.reduced-after-close`, die Mieter jener Abrechnung haben zu viel
  getragen; darunter: `fuel.closed-period-part`, nachfordern nur dort). Der eingefrorene Übertrag führt
  dafür `bookedCents`, damit ein späteres Storno das Hereingebuchte gegenbucht. **`estimatesIn`** (R-3)
  nimmt als ersetzt den Betrag der Schätzung für die Tage, die die Rechnung abdeckt; Tage, die
  mehrere Rechnungen anderer Heizperioden abdecken, zählen für jede zu ihrem Teil, und zusammen
  ersetzen sie höchstens den eingefrorenen Betrag (der ist schon um die beim Abschluss abgedeckten
  Tage gekürzt). Hat die abgeschlossene Heizperiode neben dem Teil einer Lieferung eine Schätzung
  eingefroren (die Lieferung war damals eine Gutschrift ohne Rechnung), gilt beides zusammen gegen den
  heutigen Teil (`fuelEstimateDiff`). Einen Schätzvorschlag gibt es nur über 0 €. Die Invariante prüft dazu (c1) Abdeckung ohne Gutschriften, (c2) keinen negativen
  Vorschlag, (c3) je Mieter gegen die offene andere Heizperiode, und die Gutschrift je Mieter auch neben
  einer zweiten Rechnung (doppeltes Kontrafaktum); Variante „Gutschrift ohne Rechnung“.
- **Gesperrt bis zu ihren PRs:** Vorratsenergien (PR 8), Lieferungen je Wohnung (PR 9), Netzentgelte
  und Biobrennstoff (PR 18), Methode `self` (PR 10); jeder Satz sagt, was bis dahin geht.
- **Golden F15 und F12** ([server/test/fixtures/heating/](server/test/fixtures/heating/)): F15 ist das
  Techem-Muster mit Vorwegabzug, F12 eine anonymisierte reale Abrechnung Mai bis April. In F12 sind
  nur die Gesamtwerte und der eine Nutzer des Belegs echt; die übrigen drei Nutzer sind synthetisch und
  die kg CO₂ geschätzt, beides steht so in README und `betraege.json`.

**Mehrere Heizanlagen, Etagenheizung und Kesseltausch** (Heizung PR 9, #97): Ein Objekt kann mehrere
Anlagen haben. Ab zwei braucht jede einen Namen (im Objekt verschieden) und ihre Liste der Wohnungen,
und keine Wohnung hängt an zweien, außer die Anlagen gehören zu einer Linie von Täuschen (`replaces_plant_id`,
transitiv: `lineRoot`/`sameLine` in [shared/heatingPeriod.ts](shared/heatingPeriod.ts)); geprüft wird das nach jedem
Schreiben über alle Anlagen des Objekts (`guardPlantsOfProperty` in
[server/src/db/heating.ts](server/src/db/heating.ts)), in derselben Transaktion, und beim
Wiederherstellen mit `heatingPlantViolations`. Das Anlegen nimmt Namen und Wohnungen bisheriger Anlagen
im Rumpf `adjust` mit, damit nie ein halber Stand entsteht.

- **Gebäude** (`building_with`, Recht I3 der Durchsicht von #238): Eine weitere Anlage neben einer laufenden
  sagt beim Anlegen, ob sie im selben Gebäude steht (Kennung einer anderen Anlage) oder in einem eigenen
  (`'own'`); Pflicht, ohne Vorbelegung. Im selben Gebäude stuft die Abrechnung über den Ausstoß aller Anlagen
  und die Wohnfläche aller versorgten Wohnungen ein (`partnersOf`/`contributionOf` in calc.ts, § 5 Abs. 1
  Satz 1 und 2 CO2KostAufG, Hinweis `co2.building-joint` als Auslegung); dieselbe Mechanik gilt für die Linie
  eines Kesseltauschs. Fehlt der Ausstoß einer mitheizenden Anlage, `co2.classification-incomplete`.
  **Die Fläche** ist bei Anlagen im selben Gebäude die aller Anlagen des Gebäudes: je Linie die eingetragene
  (9.2) oder die der versorgten Wohnungen, jede Wohnung einmal (`jointAreaOf`); eine eingetragene Fläche einer
  Anlage allein teilte den Ausstoß des ganzen Gebäudes durch einen Teil seiner Fläche (Nachprüfung, I-A).
  **Die erste Anlage wird nicht gefragt** (`building_with` NULL), auch nicht beim Ändern; eine beantwortete
  Frage lässt sich neben einer laufenden Anlage nicht wieder leeren. Ein Kreis der Angaben (`buildingCycle`)
  wird mit 400 abgelehnt; steht er in einem Archiv, ist die Wurzel die kleinste Kennung im Kreis
  (`buildingRoot`). Wird die Anlage entfernt, auf die andere zeigen, gehen die Verweise an ihre
  Nachfolgerin, sonst an das Gebäude, in dem sie stand, sonst wird die erste verweisende der Bezugspunkt;
  ein Verweis ins Leere im Archiv wird beim Wiederherstellen NULL. Die Auswahl in der Oberfläche zeigt bei
  einem Verweis auf eine stillgelegte Anlage die laufende ihrer Linie, mit dem gespeicherten Wert.
- **Eine neue Heizposition ohne Anlage** bekommt mit verknüpfter Lieferung deren Anlage, sonst bei mehreren
  Anlagen die, an der alle von ihr genannten Wohnungen hängen (Direktzuordnung, Teilnehmer, Einzelbeträge;
  `plantForNewItem` in repository.ts) und die zu Beginn ihres Leistungszeitraums heizt, sonst keine. Gehört
  eine Heizposition zu keiner Anlage, obwohl das Objekt welche hat, sagt `co2.fuel-unknown` das an der
  Position statt „Richten Sie die Heizung ein“.
- **Position über zwei Anlagen** (`co2.item-spans-plants`, error): Reicht die Verteilbasis einer
  Heizposition (`itemBasisUnits` in [server/src/co2.ts](server/src/co2.ts)) in eine zweite Anlage,
  gehört sie zu keinem Topf und mindert keinen Abzug; verteilt wird sie weiter nach ihrem Schlüssel.
  Alte und neue Anlage eines Kesseltauschs zählen dafür nicht als zwei.
- **Etagenheizung auf Vertrag des Vermieters** (`supply = 'perUnit'`, § 5 Abs. 1 Satz 2
  CO2KostAufG): nur mit freien Schlüsseln und ohne Vorratsenergie; jede Heizposition direkt bei einer
  Wohnung der Anlage, jede Rechnung (`fuel_deliveries.unit_id`) mit dieser Wohnung, eine verknüpfte
  Rechnung mit derselben. Eine zentrale Anlage nimmt keine Rechnung mit Wohnung, und ob zentral oder
  je Wohnung, lässt sich nicht mehr umstellen, sobald Positionen oder Rechnungen daran hängen.
  Eingestuft wird über Σ kg / Σ Fläche der vermieteten Wohnungen mit Rechnung in der Heizperiode (eine
  eingetragene Fläche geht vor). Der Abzug ist je Mietverhältnis r = ‰ · C_u · x_t / A_u, **ohne**
  Normierung auf die Mieter der Wohnung: Was in A_u auf Leerstand, Eigennutzung oder Pauschale fällt,
  bleibt beim Vermieter. C_u über A_u → `co2.exceeds-heating` für diese Wohnung, sie bekommt keinen
  Abzug, die übrigen schon. Die Rechnung steht in `perUnitClassification`, `perUnitReliefs`,
  `perUnitExceeding`; calc.ts setzt sie über `perUnitFuelOf` aus den Zeilen der Abgrenzung (PR 7) ein.
- **Kesseltausch** (`POST /api/heating-plants/:id/replace`, `replaceHeatingPlant`, Migration 0026):
  Die alte Anlage bekommt `ends_on` (letzter Betriebstag), die neue `replaces_plant_id`, Namen und
  dieselben Wohnungen; Rhythmus und Gebäudemerkmale übernimmt sie. Ohne Fremdschlüssel, weil drizzle-kit
  beim Hinzufügen einer Spalte kein `ON DELETE` schreibt. Lieferungen müssen in die Betriebszeit ihrer
  Anlage fallen (`plantSpanOf`, db/fuel.ts); die Abgrenzung (PR 7) rechnet eine Anlage nur über ihre
  Betriebstage, die Bestandsrechnung (PR 8) endet am letzten Betriebstag, und der Endbestand dort ist
  der **Restbestand**: den Mietern gutgeschrieben, beim Vermieter als eigene Zeile `stockRemaining`,
  Hinweis `fuel.stock-remaining` mit § 7 Abs. 2 HeizkostenV (im selbstbewohnten Zweifamilienhaus § 2
  Nr. 4a BetrKV). Die Steuerübersicht ändert sich nicht, die Rechnungen bleiben voll. Teilen alte und
  neue Anlage eine Heizperiode, wird das Gebäude über den Ausstoß beider eingestuft (§ 5 Abs. 1 Satz 1
  CO2KostAufG: „des Gebäudes … und Jahr“, `successionOf` in calc.ts, Hinweis `co2.plant-replaced`).
  Gleicher Vorratsbrennstoff: Der Tausch fragt „Verheizt der neue Kessel den Brennstoff im Tank weiter?“
  (`takes_over_stock`, Vorbelegung ja, änderbar, solange weder die letzte Heizperiode der alten noch die
  erste der neuen abgeschlossen ist). Mit Ja beginnt die Kette der neuen Anlage mit der der alten
  (`stockChainsOf` mit `plants`), der Restbestand ist ihr Anfangsbestand, ein eigener wird mit einem Satz
  über die alte Anlage abgelehnt. Mit Nein bleibt der Restbestand wie bei anderem Brennstoff beim
  Vermieter. Zurück von Nein auf Ja fragt die Oberfläche vorher, denn der eigene Anfangsbestand der neuen Anlage entfällt dann. Übernimmt sie den Restbestand im selben Zeitraum nicht, nennt `fuel.stock-not-taken-over` den Restbestand der alten Anlage zum letzten Betriebstag. In beiden Fällen kommt der Schlüssel der Überträge auch von den Positionen der Vorgängerin
  (`sameFuelLine`, `stockTemplateOfLine`; sonst ging der Anfangsbestand ohne eigene Position der neuen
  Anlage im Tauschjahr mit 0 € weiter, Nachprüfung K1). Eine stillgelegte Anlage rechnet in einem späteren Zeitraum mit, wenn
  eine Position dort mit ihrer Lieferung verknüpft ist (die Gasrechnung bis zum Tausch, im Folgejahr
  gebucht): Sie wird in den Zeitraum der Lieferung abgegrenzt, sonst trügen die Mieter sie zweimal. Gleicher Brennstoff über einen Zähler (Gas, Fernwärme,
  Strom): 409, kein Tausch nötig. Das Entfernen der neuen Anlage macht den Tausch rückgängig, das der alten
  nimmt der Nachfolgerin den Verweis, das aus der Mitte einer Linie lässt die nächste den Zeitraum
  übernehmen (Hinweis in Rückfrage und Antwort, `notice`); ein verwaister Verweis im Archiv wird beim Wiederherstellen
  geradegerückt (`straightenHeatingPlants`). Vorrat und Lieferungen nur in der Betriebszeit. Gesperrt
  bleiben der Tausch einer Etagenheizung, bei getrennter Heizkostenabrechnung (Weg d), mitten in einer
  abgeschlossenen Heizperiode (zum Ersten nach dem Abschluss geht er), vor einer abgeschlossenen späteren
  und mit Angaben der alten Anlage für die Zeit danach.
- **Etagenheizung, Grundlage der Umlage:** Die HeizkostenV gilt nicht (§ 1 Abs. 1), § 2 Nr. 4 Buchstabe d
  BetrKV nennt nur Reinigung und Wartung. Eine belegte Grundlage für die Umlage der Gaskosten bei Vertrag des
  Vermieters hat die Durchsicht nicht gefunden; Hinweis `heating.per-unit-basis` und Lexikon „Etagenheizung“
  sagen „nicht geklärt“ und verweisen auf § 556 Abs. 1 Satz 1 BGB. Fernwärme ist keine Etagenheizung. `fuel-invariant.test.ts` und `fuel-stock-invariant.test.ts`
  rechnen je eine Variante mit zwei Anlagen und prüfen, dass jede Lieferung nur bei ihrer Anlage steht.

**Eigene Heizkostenabrechnung** (Heizung PR 10, #99): Bei `method = 'self'` verteilt Mietfuchs nach
der Heizkostenverordnung. Die reine Rechnung steht in [server/src/heating.ts](server/src/heating.ts):
Nutzer je Wohnung (Mietverhältnisse, Leerstand, Eigennutzung, außerhalb), die Ablesung je Grenze (die
beim Mieterwechsel erfasste fest, `readings.interim_for`; sonst die nächste in der Zelle über H−1, H und
H+1; zwei Werte am selben Tag sind ein Befund; der eingefrorene Endstand der Vorperiode ist der
Anfangsstand; ohne Rückrechnung, Entwurf 3.5),
§ 9b Abs. 3 als Gruppe über die Grenzen ohne Ablesung, Bruchteile je Topf und daraus **ein Gewicht je
Nutzer und Ziel** (`weightsOf`). calc.ts verteilt jede Position mit `key = 'heatingSystem'` mit diesen
Gewichten durch `distributeCents` (#202), wie jede andere Position; Leerstand und Eigennutzung gehen
über `landlordRecipients`.

- **Teil und Ziel** stehen an der Position (`heatingPart`, `heatingTarget`); bei verbundener
  Warmwasserbereitung teilt der Warmwasseranteil α (`hotWaterShareOf`, seit PR 11 über dhw.ts, siehe
  unten) die Ziele „beides“. Der Anteil nach Verbrauch gilt aus der Heizperiode oder der vorigen
  (`consumptionSharesOf`, § 6 Abs. 4); § 7 Abs. 1 Satz 2 ist `hkv.consumption-share-forced`.
- **Umgestellt wird nur über die Einrichtung** (`PUT /api/heating-plants/:id/self`,
  [server/src/db/heatingSelf.ts](server/src/db/heatingSelf.ts)): Anlage, Anteil, Zähler und die
  Positionen offener Zeiträume in einer Transaktion; fehlen Teil und Ziel, antwortet sie 409 mit der
  Liste. Zurück auf „Niemand“ verlangt `convertItems: 'area'`.
- **Nicht verteilbar** (fehlender Stand, fehlender Zähler, kein Anteil, α unbestimmbar) heißt Fehler an
  der Anlage und alle Positionen beim Vermieter; geraten wird nie. Die Hinweise zu Ablesung und
  Zwischenablesung rechnen nach dem CO₂-Block, weil ihre Kürzungsbeträge auf den gedruckten Zeilen
  stehen; fehlende Zwischenablesungen beantwortet der Vermieter in `interim_reading_gaps`.
- **Wärmepumpe**: Ob die Verordnung gilt, entscheidet `heatPumpVerdict` aus dem Datum der Erfassung
  oder des Einbaus (§ 12 Abs. 3, `hkv.heat-pump.capture`).
- **„Nur Heizung“ bei freien Schlüsseln** nimmt beim Mieterwechsel die Gradtage statt der Tage
  (Fläche, Einheiten, vereinbarte Anteile, Direktzuordnung); eine kombinierte Position bleibt nach
  Tagen, deshalb ändert sich für Bestandsnutzer keine Zahl.
- **Golden F16, F17** in `server/test/fixtures/heating/` rechnen Beispiel A und das Heizöl mit Vorrat von
  Hand nach; Heizkostenverteiler und Werte eines Ablesedienstes kamen mit PR 12, die Angaben nach § 6a mit PR 14.
- **Invarianten**: fuel-invariant.test.ts und fuel-stock-invariant.test.ts haben Läufe mit eigener
  Abrechnung, fuel-invariant auch mit verbundenem und getrenntem Warmwasser; dazu prüfen sie, dass die
  Gewichte jeden Topf ganz verteilen, jede Lieferung über alle Heizperioden genau einmal in den Zeilen
  steht und der Topf Warmwasser den Warmwasseranteil α trägt (s3). Der Vorratsübertrag nimmt bei `self` nur eine
  Brennstoffposition nach Heizkostenverordnung als Vorlage (`stockKeysOf` in fuelStock.ts).
- **Zeiträume und Linie** (Durchsicht von #239 und ihre Nachprüfung): Wann die eigene Abrechnung gilt,
  steht in der Tabelle `heating_self_spans` (von, bis ausschließlich; `until` NULL beim laufenden), wie die
  Spannen nach Weg d. Die Einrichtung öffnet einen Zeitraum (nie vor einem laufenden und nie vor oder in einer
  abgeschlossenen Heizperiode; unmittelbar am Ende eines früheren geht dieser weiter). Das Zurückschalten
  schließt ihn mit der ersten offenen Heizperiode, wenn abgeschlossene nach ihm gerechnet wurden, sonst
  entfällt er, und es leert die Anteile offener Heizperioden; abgeschlossene rechnen weiter nach der
  Verordnung, wie sie zugestellt wurden. Liegt eine abgeschlossene Heizperiode hinter einer offenen, lehnt
  es mit 409 ab. Der Kesseltausch erbt den laufenden Zeitraum. Abgeleitet aus den Anteilszeilen wird nichts.
  Gerechnet wird je Heizperiode (`selfActive` in heating.ts, `selfAt` und `withSelfBegin` in snapshot.ts,
  auch in der Teilabrechnung von calc.ts, der Wächter in repository.ts, `selfItemsOf` mit `from`), denn § 6 Abs. 4
lässt die Wahl nur für künftige Zeiträume zu. Der Anteil gehört zur **Linie** der Anlage
  (`lineShareRows`, [server/src/db/selfLine.ts](server/src/db/selfLine.ts)): Nach einem Kesseltausch gilt er
  weiter, und in derselben Heizperiode lehnt `saveDistribution` einen anderen ab. Den Pflichtanteil nach
  § 7 Abs. 1 Satz 2 nachzutragen ist keine Wahl und geht auch in einer begonnenen Heizperiode. Läuft eine
  Anlage nur einen Teil der Heizperiode, wird die Wärme am Speicher an ihrer Laufzeit abgegrenzt; dafür
  braucht es den Stand am Tauschtag (der Tausch nimmt `meterReadings` an), sonst `heating.self-incomplete`.
  Der eingefrorene Endstand kommt auch aus der Heizkostenabrechnung nach Weg d. Die Angaben nach § 6a
  stehen seit PR 14 unter „Pflichtangaben und Ausnahmen“ (`heating.info-incomplete` statt
  `heating.self-6a-missing`).
- **Migrationen 0027/0028**: Spalten an `heating_plants` (`hot_water`, `capture`, `area_basis_heat`,
  `heat_pump_installed_on`), `cost_items.heating_target`, `readings.interim_for` und die Tabellen
  `interim_reading_gaps` und `heating_self_spans`; die Bedingungen im zweiten Schritt.
- **Warmwasseranteil α** (Heizung PR 11, #211, [server/src/dhw.ts](server/src/dhw.ts)): eine Stelle
  für alle drei Verfahren des § 9 Abs. 2 HeizkostenV, als reine Funktionen; `hotWaterShareOf` bleibt der
  eine Aufruf in calc.ts. Die Faktoren 1,11, 1,15 und 0,30 gelten **nur für Formelwerte**, nie für
  gemessene Wärme (Entwurf G-B1 abgelehnt, 15.1 Nr. 9; das Lexikon nennt beide Lesarten, ⟨Norm offen:
  VDI 2077⟩). Wogegen Q gestellt wird, hängt am Erzeuger: Brennstoff in kWh laut Rechnung (die kWh der
  Heizperiode aus der Bewertung der Lieferungen, wie in PR 10), sonst als Menge mit B = Q / Hᵢ (§ 9
  Abs. 3), Fernwärme die gelieferte Wärme, die Wärmepumpe mit Formel den Strom, gemessen bei Wärmepumpe
  und Mischanlage die gemessene Gesamtwärme. Der **Heizwert laut Rechnung** geht vor; die Tabelle nur
  hilfsweise, nur bei Heizkesseln und nur mit der Zeile, die der Vermieter an der Lieferung wählt
  (`fuel_grade`, Zeilen in [shared/fuelGrades.ts](shared/fuelGrades.ts)); mehrere Heizwerte
  mengengewichtet, beim Vorrat ohne Lieferung in der Heizperiode der der jüngsten früheren.
  **Holzhackschnitzel**: Die Verordnung vom 24.11.2021 hat § 9 Abs. 3 Satz 1 und Satz 2 Nr. 2 neu
  gefasst (BGBl. 2021 I S. 4966), und mit der alten Nummer ist die Angabe 650 kWh/SRm entfallen; seit
  01.12.2021 gelten 4 kWh/kg und B nur in Litern, Kubikmetern oder Kilogramm. gesetze-im-internet.de
  druckt die alte Tabelle hinter Satz 5 noch ab; das ist ein Versehen der Konsolidierung. Eine Formel
  verlangt die Antwort, ob die Anlage die Wärme **allein** erzeugt (`heat_generation`); ohne sie und bei
  mehreren Erzeugern rechnet sie nicht (Satz 6 Nr. 3 „monovalent“, Satz 5). Die Flächenformel liefert kWh
  „pro Jahr“ und wird im Rumpf und bei einem Kesseltausch nach Tagen gekürzt (Festlegung F7, § 9b
  Abs. 2); das Volumen nimmt Mietfuchs beim Tausch nur aus der Zeile der Anlage selbst. Was fehlt, ergibt
  `heating.dhw-share-invalid` mit dem Satz, was fehlt. Der Ausweis führt α als `self.alpha`, den
  Rechenweg als `self.dhw`. Die **Stromheizung** rechnet gemessen gegen den Strom laut Rechnung wie in
  PR 10, nur die Formeln sind dort gesperrt: Eine Anlage, die vorher abrechenbar war, sperrt eine spätere
  PR nicht. Die **Wärmepumpe vor dem 01.10.2024** fiel nach § 11 Abs. 1 Nr. 3 Buchst. a a. F. nicht unter
  die Verordnung (`hkv.exemption.renewable`, zwei Fassungen), wenn sie überwiegend versorgte: Die Anlage
  fragt das (`heat_pump_majority`, unabhängig vom Erzeuger nach § 9); „ja“ und ohne Antwort Hinweis statt
  Fehler, keine Kürzungsbeträge, ohne α gehen Heizung und Warmwasser gemeinsam in den Topf Heizung; „nein“
  rechnet nach der Verordnung. Erzeuger- und Überwiegend-Frage stehen an der Anlage (Karte „Heizung“),
  nicht in der Warmwasser-Karte. Nach einem Kesseltausch mit übernommenem Vorrat zählen für den Heizwert die
  Lieferungen der Vorgängerin gleicher Energie mit. Brennwert/Heizwert, Heizwert und Tabellenzeile bleiben
  an eingefrorenen Lieferungen änderbar (`unfrozenAside` in db/fuel.ts); α abgeschlossener Abrechnungen ist
  eingefroren. Die Kürzung um
  15 % bei einer Formel ohne bestätigten Aufwand (`heating.dhw-not-metered`) gilt auch bei `self`. Tests
  der eigenen Abrechnung bauen Beispiel A mit `selfSnapshot()`
  ([server/testing/selfHeating.ts](server/testing/selfHeating.ts)); ein Test hält den Helfer gleich mit
  dem Weg über die Datenbank. Die Invarianten prüfen Q, Faktor und α gegen die Eingaben (fuel-invariant
  (s4), fuel-stock-invariant (w) mit Heizöl und Heizwert). Migrationen 0029/0030 (`fuel_grade`,
  `heat_generation`, `heat_pump_majority`).
- **Heizkostenverteiler und Ablesedienst** (Heizung PR 12, #99, [server/src/hca.ts](server/src/hca.ts)):
  § 5 Abs. 1 Satz 1 HeizkostenV lässt Wärmezähler und Heizkostenverteiler gleichrangig zu, und Mietfuchs
  bringt alle drei Erfassungen in **das Grenzmodell von PR 10**: Ein Heizkostenverteiler ist ein Zähler
  vom Typ `hkv` mit einem Faktor am Zähler (`SelfMeter.factor`, `meterFactor`), `planSelf` wählt den
  Gerätetyp nach der Erfassung, und die Werte eines Ablesedienstes sind je Wohnung ein gedachter Zähler
  mit kumulierten Ständen (`serviceMeters`; 0 am Tag vor der ersten Zeile, ohne Stand am Beginn einer
  Zeile nach einer Lücke, sonst zählte die Lücke still als 0; ein eingefrorener Endstand der Vorperiode
  gilt für diese Zähler nicht, denn ihre Zeilen gehören zu genau einer Heizperiode). Zwischenablesung,
  Gradtage, Leerstand und „keine Interpolation“ bleiben damit an einer Stelle, und ein Test hält fest,
  dass dieselben bewerteten Einheiten dieselben Beträge ergeben, gleich woher sie kommen. Die Einheit des
  Topfs Heizung heißt dann „Einheiten“. Bei der **Einheitsskala** zählt der Ablesewert mal dem
  Bewertungsfaktor, bei der **Produktskala** wie abgelesen (ein eingetragener Faktor wirkt dann nicht);
  ohne Skala oder Faktor `heating.hca-factor-missing` und keine Verteilung. Der **Stichtagswert** ist
  kein eigenes Feld, sondern eine Ablesung mit `replacement` und Wert 0; eine Rücksetzung mitten in der
  Heizperiode ergibt `heating.device-cutoff`. Ein Gerät mit anderem Faktor ist ein neuer Zähler; Skala und
  Faktor eines Geräts, dessen Ablesungen in einer abgeschlossenen Heizperiode mit Heizkostenverteilern
  zählen, sind gesperrt (409), ebenso das Löschen; geprüft wird nach Überdeckung, nicht nach Ablesedatum.
  **Gezählt wird ein Gerät nur in Heizperioden, die seine Ablesungen überdecken** (`coversPeriod`: erste vor
  dem Ende, letzte nach dem Tag vor dem Beginn); ein ausgebautes Gerät mit letzter Ablesung am Stichtag
  muss deshalb nicht gelöscht werden. **Gemischt** ist eine Wohnung, an der in der Heizperiode ein Gerät der
  anderen Art zählt und kein Gerät der eingestellten Art sie **ganz** abdeckt (`spansPeriod`: erste Ablesung am
  Tag vor dem Beginn oder früher, letzte am Ende oder später); ein Heizkostenverteiler neben dem Wärmezähler
  derselben Wohnung ändert also nichts, ein Wechsel mitten in der Heizperiode dagegen schon (`switched`, der
  Satz nennt Zwischenstand bzw. Schätzung nach § 9a, mit der die Wohnung seit PR 13 nicht mehr gemischt ist, und die Meldung zum fehlenden Stand
  nennt das andere Gerät). Sonst fiele der Verbrauch des alten Geräts still weg, nachgemessen 1.349,39 € statt
  1.794,28 €. Das verlangt nach § 5 Abs. 7 eine Vorerfassung, die Mietfuchs nicht rechnet (#218):
  `heating.mixed-capture`, keine Verteilung; Warmwasserzähler und Zähler der Anlage zählen nicht. Beim
  Ablesedienst nennt jede Zeile, ob die Heizung in Einheiten oder kWh steht (`heat_unit`); gemischt ist
  dort, wo beides vorkommt.
  **Verdunster** wertet Mietfuchs nicht aus; ihre Werte kommen wie alle eines Ablesedienstes über
  `heating_service_values` (je Wohnung und Nutzungszeitraum, Warmwasser für alle Zeilen oder keine,
  Lücken bleiben Lücken, die Zeilen einer Heizperiode werden als Ganzes ersetzt; `dropIfEmpty` lässt eine
  Heizperiode mit solchen Werten stehen). Gelesen werden sie **über die Linie** (`lineServiceRows`, eigene
  Zeilen vor denen der Vorgängerin): Nach einem Kesseltausch liest die neue Anlage dieselben Werte, und eine
  Heizperiode der alten Anlage, an der nur solche Werte hängen, sperrt den Tausch nicht. Skala und Faktor gibt es nur am Zähler vom Typ `hkv`
  (Prüfbedingung). Der Ausweis je Gerät (`self.devices`) entsteht aus den Differenzen des Plans
  (`SelfUnitPlan.measured`, je Nutzer bzw. Gruppe nach § 9b Abs. 3), nicht aus einer zweiten Lesart der
  Ablesungen; gedruckt bekommt jeder Mieter nur seine Geräte in seinem Zeitraum und nur die Zeilen des
  Ablesedienstes, die in seinen Zeitraum fallen. Das Ableseergebnis nennt am Stichtag den Stichtagswert
  (`SelfReadingView.oldEndValue`), nicht die 0. Dass die Abrechnung den Faktor nennt, ist Praxis der
  Messdienste (Berliner Mieterverein), keine Norm; so steht es in Lexikon und Sätzen. **Erfassung und Warmwasserbereitung gehören zum Zeitraum der eigenen Abrechnung**
  (`heating_self_spans.capture`, `.hot_water`, `captureOf` und `hotWaterOf` in shared/heatingPeriod.ts, weil die
  Seiten Kosten und Heizkosten dieselbe Frage stellen; beide ändern sich
  über `PUT` bei eigener Abrechnung nicht, sondern nur mit der Einrichtung ab einer Heizperiode): Eine andere Erfassung beginnt mit der Einrichtung ab einer Heizperiode einen neuen
  Zeitraum, frühere Heizperioden rechnen weiter nach ihren Geräten. Ab einer schon begonnenen Heizperiode gilt
  die neue Einstellung ab deren Beginn: Geräte und Warmwasserbereitung sind Tatsachen der Anlage, keine Maßstäbe
  nach § 6 Abs. 4; geschützt bleibt der Anteil nach Verbrauch (`checkShares`, beim Warmwasser nur, wo es vorher
  und nachher einen gibt). Eine offene Heizperiode eines früheren Zeitraums rechnet weiter selbst ab; Verteilung
  und Ansicht fragen dafür `selfActive`, nicht den Beginn des laufenden Zeitraums. Ein Zeitraum von vor PR 12 bekommt beim
  nächsten Schreiben die bisherige Erfassung der Anlage (`pinSelfSpans`); über `PUT /api/heating-plants/:id`
  ändert sie sich bei eigener Abrechnung nicht. Die Einrichtung legt bei Heizkostenverteilern und
  Ablesedienst keine Wärmezähler an. Die Invariante fuel-invariant hat drei Varianten mit
  Heizkostenverteilern bzw. Ablesedienst samt Mieterwechsel und Leerstand ((s5): Verbrauch je Wohnung =
  Σ Differenz × Faktor bzw. Σ der Werte). Weitere Varianten: Heizkostenverteiler und
  Ablesedienst mit Kesseltausch, Heizkostenverteiler mit Ablesungen bis zehn Tage neben dem Stichtag; (s5) wird je
  Variante gezählt. Migrationen 0031/0032 (`hca_scale`, `rating_factor`, `hca_model`, `heating_self_spans.capture`
  und `.hot_water`, `heating_service_values` mit `heat_unit`).
- **Schätzung nach § 9a** (Heizung PR 13, #99, [server/src/db/heatingEstimates.ts](server/src/db/heatingEstimates.ts)):
  Tabelle `heating_estimates` (Heizperiode, Wohnung, Topf `heat`/`water`, Wert, Weg, Grund aus der Auswahl,
  Begründung Pflicht, Bestätigung, **Erfassung und Einheit beim Speichern**; Migration 0033). Passen Erfassung
  oder Einheit nicht mehr zur Heizperiode (`estimateFits` in hca.ts; beim Warmwasser zählt nur eigene Zähler oder
  Ablesedienst), rechnet die Schätzung nicht: Ohne verwertbare Ablesung gilt die Wohnung als nicht erfasst
  (`heating.estimate-stale`, Stufe `error`), neben vollständiger Ablesung gilt die Ablesung
  (`heating.estimate-stale-unused`, Warnung, Runde 2 N-I1); die Karte zeigt eine veraltete Schätzung immer
  sichtbar mit „Entfernen“ und „Schätzung neu eintragen“. `setUpSelf` nennt solche Schätzungen in
  `estimatesNotice` (Durchsicht von #242, G-I1). Beim Ablesedienst ohne Werte wählt der Vermieter die Einheit
  der Schätzung (Einheiten oder kWh), mit Werten gilt deren Einheit (N-M3). Eine Schätzung gilt für die ganze Heizperiode der Wohnung in der Einheit der
  Erfassung (beim Heizkostenverteiler bewertete Einheiten, ohne Faktor) und tritt in `planSelf` **nur an die
  Stelle des nicht erfassten Verbrauchs**: Ein Nutzer mit gültigen Ablesungen, etwa der
  Vormieter bis zur Zwischenablesung, behält seinen Messwert, denn § 9a Abs. 1 Satz 1 erfasst nur den Verbrauch
  von Nutzern, der nicht ordnungsgemäß erfasst werden kann (Durchsicht von #242, R-I4); die übrigen tragen
  zusammen ihren Anteil nach Gradtagen bzw. Tagen und teilen ihn wie nach § 9b Abs. 3 (Festlegung). Ohne
  behaltenen Wert ersetzt die Schätzung auch abgelesene Zeiten desselben Nutzers; Hinweis, Karte und Druck sagen
  das nur, wenn wirklich ein gemessenes Teilstück ersetzt wird (zwei Stände desselben Geräts im Zeitraum des
  Nutzers, `replacesMeasured`; G-M6, Runde 2 N-I2). Sind alle Ablesungen vollständig, ersetzt die Schätzung alles (Markierung „unbrauchbar“):
  `heating.estimate-complete` ist dann ein Hinweis, der nicht färbt, unbestätigt eine Warnung
  (`heating.estimate-unconfirmed`, R-I7); deckt die Schätzung zwei Stände am selben Tag, warnt
  `heating.estimate-same-day` (G-M7). Weitere Hinweise: `heating.estimate-no-device` (Gerät danach gelöscht,
  die Schätzung zählt weiter), `heating.estimate-below-measured` (Schätzung unter dem abgelesenen Teil des
  Vormieters). Nach einem Kesseltausch steht jeder Hinweis einmal je Linie und Schätzung (zwei Schätzungen derselben
  Wohnung an beiden Anlagen haben je ihre Hinweise, N-M2); abgeschlossen wird weiter je Anlage. Mit Schätzung sind ein fehlender Stand, ein Zählerwechsel ohne Endstand, negativer
  Verbrauch und zwei Stände am selben Tag gedeckt; die Geräte einer geschätzten Wohnung lösen keine Hinweise zu
  fehlenden Zwischenablesungen aus (`liveMetersOf`), stehen aber weiter im Ausweis. Begrenzt eine Ablesung ihres
  Geräts einen behaltenen Messwert, fragt Mietfuchs bei einer fernen Zwischenablesung wie ohne Schätzung
  („Ablesung verwenden“ / „Nach § 9b Abs. 3“, `usableAt` in heating.ts, G-I2). Überschreitet die geschätzte Fläche
  eines Topfs die Grenze `hkv.estimate-threshold` (streng größer, über Produkte verglichen, je Topf, Heizung mit
  der Fläche nach § 7 Abs. 1 Satz 5; die Fläche einer Wohnung zählt ganz, auch wenn nur ein Teil ihrer
  Heizperiode geschätzt ist; beides ist eine **Auslegung von Mietfuchs** und steht so in Hinweis, Dialog, Lexikon
  und Regel), geht der Topf nur nach Fläche, ohne Kürzungsbetrag und ohne `heating.no-consumption` (Auslegung,
  Entwurf 15.1 Nr. 7; für eine Abrechnung nach § 9a Abs. 1 hat der BGH die Kürzung verneint, VIII ZR 373/04
  Leitsatz c). Gelesen werden Schätzungen **über die Linie** wie die Werte eines Ablesedienstes (die eigene geht vor);
  eine Wohnung mit Gerätewechsel mitten in der Heizperiode ist mit Schätzung nicht mehr gemischt
  (`withoutEstimatedSwitches`). Eine Wohnung mit Schätzung oder Werten eines Ablesedienstes wechselt nicht das
  Objekt (`guardUnit`, G-I3). Keine Schätzung für eine Wohnung ohne Gerät (Ausstattungspflicht, 400; beim
  Ablesedienst prüft Mietfuchs keine Geräte) und nie wegen verschiedener Ablesetage; abgeschlossene
  Heizperioden sind gesperrt (409), `dropIfEmpty` lässt eine Heizperiode mit Schätzung stehen. Die Vorschläge
  (`estimateProposals`: Durchschnitt der übrigen erfassten Wohnungen je m², vergleichbare Wohnung je m²,
  Vorperiode) rechnen die Vorperiode neu, nur bei gleich vielen Monaten und gleicher Erfassung, mit eigenem
  Protokoll der Rechtswerte. Die Grenze steht nur mit einer Schätzung im Rechtsstand. Seite Heizkosten: Karte
  „Schätzung (§ 9a)“ ([EstimateCard.tsx](client/src/components/EstimateCard.tsx), Logik in
  [client/src/estimateForm.ts](client/src/estimateForm.ts)) mit dem tatsächlichen Flächenanteil vor dem
  Speichern. Die Invariante fuel-invariant hat zwei Varianten „Gerät ausgefallen“ mit vier Wohnungen (30, 20, 25
  und 25 % der Fläche) und Mieterwechsel ((s6): Grenze, Verteilung nur nach Fläche, Wert der Schätzung, der
  Vormieter behält seinen Wert); die Mutationsproben stehen im PR.
- **Pflichtangaben und Ausnahmen** (Heizung PR 14, #99, [server/src/heatingInfo.ts](server/src/heatingInfo.ts),
  [server/src/db/heatingInfo.ts](server/src/db/heatingInfo.ts)): **Ausnahme nach § 11, Vereinbarung nach § 2, die
  Bestätigung zur monatlichen Information und die Antwort zum Verbrauchervertrag stehen je Heizperiode** in
  `heating_periods` und gelten ab ihr für die folgenden der Linie, bis eine spätere etwas anderes sagt
  (`heatingRulesOf`; in derselben Heizperiode geht die eigene Anlage vor, `null` heißt geerbt). An der Anlage
  stünden sie zeitlos und wirkten rückwirkend auf offene und abgeschlossene Heizperioden; das war die
  Fehlerklasse der Durchsichten von #239, #241 und #242. In computeSettlement gilt eine Ausnahme je Topf
  (`exemptionScopeOf`, `exemptPot`; ohne Antwort zum Umfang nur die Wärme, ohne zentrales Warmwasser die ganze Anlage): für den ausgenommenen Topf keine
  Kürzung nach § 12 (`noCutFor`, an jeder Stelle mit § 12 Abs. 1 Satz 1, bei der Fernablesbarkeit zählen ganz
  ausgenommene Anlagen nicht mit); sind Wärme und Warmwasser ausgenommen, keine Angaben nach § 6a und keine
  CO₂-Aufteilung ohne vereinbarte Abrechnung (`co2OffByExemption`, § 2 Abs. 7 CO2KostAufG). Ist nur die Wärme
  ausgenommen, teilt Mietfuchs die CO₂-Kosten weiter auf (nach BT-Drs. 20/3172, S. 28 betrifft § 2 Abs. 7 Räume, „in
  denen keine Heizkostenabrechnung durchgeführt wird“; das Warmwasser wird abgerechnet), und **jede Kürzung
  beziffert es dann nur auf den Anteil Warmwasser** (`waterBaseOf`: Kosten des Topfs mal Gewicht, abzüglich des
  CO₂-Abzugs im Topf; bei freien Schlüsseln die Positionen mit Ziel Warmwasser, eine Position für beides ohne
  Betrag), ebenso bei der Fernablesbarkeit und der monatlichen Information nur die Warmwassergeräte (Durchsicht
  von #243). Beim Warmwasser ohne Wärmezähler ist das als Auslegung gekennzeichnet, und der Betrag auf Wärme und
  Warmwasser insgesamt (wie BGH VIII ZR 151/20) steht als Obergrenze dabei. Hat der Messdienst unter voller Ausnahme trotzdem CO₂ abgezogen, bleibt der Abzug zerlegt (der Teil
  der eigenen Wohnung ist privat) und `co2.exempt-deducted` sagt es. Eine Vereinbarung nach
  § 2 (`agreedFor`) wirkt nur, solange das Haus im Zeitraum die Voraussetzung erfüllt (`heatingAgreeable`), und
  hebt nur die Kürzung nach § 12 Abs. 1 Satz 1 auf. „Nach Wohnfläche“ verteilt die eigene Abrechnung ganz nach
  der Fläche (`agreedArea`, Anteil 0, ohne die Grenzen der §§ 7, 8, 10; fehlende Ablesungen und Warmwasseranteil
  sperren dann nicht); „feste Anteile“ kann sie nicht (400 beim
  Speichern, sonst `heating.self-incomplete`). Der Umfang der Angaben folgt dem, was Mietfuchs tatsächlich
  rechnet, nicht der Vereinbarung. Eine Änderung von Umfang oder vereinbarter Abrechnung unter geerbter Ausnahme
  schreibt die Ausnahme in die eigene Zeile; ohne geltende Ausnahme 400. `dryRun` beim Speichern nennt die
  späteren abgeschlossenen Heizperioden, an denen eine Angabe vorbei auf eine offene wirkt; die Karte fragt nach.
  Etagenheizungen haben keine dieser Angaben (§ 1 Abs. 1). Mehr als 70 % nur mit `above_70_agreed` (§ 10), mit
  dem Anteil geerbt, auch über dem Pflichtanteil des § 7 Abs. 1 Satz 2 (Auslegung), nie über 100 %.
  **Die Angaben nach § 6a** rechnet `heatingInfoOf` je Linie und Heizperiode (`Settlement.heating[].info` an der
  Anlage, die am Ende der Heizperiode heizt, mit `tenancyIds`, damit nur deren Mieter den Block gedruckt
  bekommen): Abs. 3 oder Abs. 5 entscheiden die Schlüssel der Positionen, auch bei freien Schlüsseln. **Nr. 4 ist
  nie ein Hausdurchschnitt**: Die Begründung schließt den Vergleich mit den Nutzern desselben Gebäudes aus
  (BR-Drs. 643/21, S. 19, 21); der Vermieter trägt einen Vergleichswert in kWh je m² mit Pflichtquelle ein,
  umgerechnet auf Wohnfläche und Tage des Mieters (Festlegung). Nr. 5: Wärme mal Klimafaktor, Warmwasser
  unbereinigt, der Vorjahreswert aus der neu gerechneten Vorperiode (`prev`); die Klimafaktoren trägt der
  Vermieter mit Quelle ein, denn die des DWD (je Postleitzahl, gleitende zwölf Monate, monatlich neu) bettet
  Mietfuchs nicht ein. Wohnte ein Mieter im Vorjahr noch nicht dort, „bis zu 3 %“ (Auslegung, `heating.info-open`);
  wohnte er dort, aber Mietfuchs kennt seinen Vorjahresverbrauch nicht, fehlt Nr. 5 sicher. **Was fehlt, steht je
  Mieter** (`users[].missing`, die Angaben zur Anlage in `missingCommon`): Kürzen darf der Nutzer, dem die
  Information fehlt. Wo Mietfuchs Nr. 4 nicht rechnen kann (Heizkostenverteiler, Werte des Ablesedienstes,
  Warmwasser allein) oder bei freien Schlüsseln Nr. 4 und 5, bestätigt der Vermieter den beigelegten Vergleich
  des Ablesedienstes mit Quelle (`info_comparison_source`); ohne Bestätigung ist es offen, nicht fehlend. Ist
  der Verbrauch eines Mieters nach § 9a geschätzt, gelten für ihn nur die Mindestangaben nach Abs. 5 (Nr. 2 und 3;
  BR-Drs. 643/21, S. 19 und 22; je Mieter ist Auslegung). Bei Werten des Ablesedienstes deckt die Bestätigung
  auch Nr. 5 (`attachedCoversPrev`). Ohne Position mit dem Teil Erfassung druckt Nr. 1 c keine Zahl (`meteringCents`
  `null`, offen). Jede sicher fehlende Angabe ergibt `heating.info-incomplete` mit 3 % für die betroffenen Mieter
  (ein Kürzungsrecht nach Satz 3, auch mit der monatlichen Information: deren Hinweis nennt die Beträge nicht
  ein zweites Mal; BR-Drs. 643/21, S. 24 f.), nur für Zeiträume ab dem 01.12.2021 (`hkv.settlement-info`). `heating.monthly-info` nur, wenn ein Gerät, das in der
  Heizperiode in Betrieb ist (Ablesungen überdecken sie, `coversPeriod`, oder es hat noch keine), als fernablesbar eingetragen ist oder die Anlage es angibt; ohne Angabe schweigt
  es, denn das Anlegen einer Anlage ändert keinen Hinweis (Entwurf 11.2). Kontaktadressen in
  `shared/heatingInfo.ts`, jährlich prüfen. Seite Heizkosten: Karten „Ausnahmen und Vereinbarungen“
  ([HeatingRulesCard.tsx](client/src/components/HeatingRulesCard.tsx)) und „Angaben zur Abrechnung (§ 6a)“
  ([HeatingInfoCard.tsx](client/src/components/HeatingInfoCard.tsx)); Druckblock
  [HeatingInfoBlock.tsx](client/src/components/HeatingInfoBlock.tsx) mit Balken. Migrationen 0034/0035 (`exemption` mit `chp` für § 11 Abs. 1 Nr. 3 Buchst. b); die
  Invarianten haben je eine Variante „Ausnahme je Heizperiode“ ((x): keine Kürzung und keine Angaben im
  ausgenommenen Topf, keine Zeile außer den CO₂-Abzügen hängt an den Angaben).

**Monatliche Verbrauchsinformation** (Heizung PR 22, #99, [server/src/monthlyInfo.ts](server/src/monthlyInfo.ts),
Monatsnamen und Lückentexte in [shared/monthlyInfo.ts](shared/monthlyInfo.ts)): Mietfuchs erstellt sie nur bei
eigener Abrechnung einer zentralen Anlage mit eigenen Zählern (nicht mit Werten des Ablesedienstes) und nur, wenn
ein Gerät einer Wohnung selbst als fernablesbar eingetragen ist; die Angabe an der Anlage allein sagt nicht,
welche Wohnungen. Sonst bleibt der Hinweis von PR 14 („bis zu 3 %“, mit dem Satz, was Mietfuchs braucht).
Verbrauch nur aus Ablesungen **genau** an den Monatsgrenzen (bei Ein- und Auszug am Tag vor dem Einzug bzw. am
Auszugstag), nie interpoliert (§ 6a Abs. 2 Nr. 2 „soweit erhoben“); fehlt einem Gerät einer Größe der Wert, fehlt
die ganze Größe. Vergleiche nur desselben Mietverhältnisses (Begründung: keine Daten anderer Nutzer). Die Geräte
sind die der Linie (Kesseltausch), nur in Betrieb: Ein Gerät gilt als ausgebaut, wenn in derselben Wohnung ein
Nachfolger derselben Größe übernimmt, sonst ist eine fehlende Ablesung eine Lücke. Der Durchschnittsnutzer kommt
als Vergleichswert je Monat mit Quelle (Tabelle `heating_monthly_info`, Migration 0045, an der Anlage, die am
Monatsende heizt, gelesen über die Linie), nie aus dem eigenen Haus (BR-Drs. 643/21, S. 19); der Wert der
Heizperiode (Nr. 4) wird nicht aufgeteilt. Warmwasser in kWh über § 9 Abs. 2 Satz 2 ist eine Auslegung (die
Gleichung gilt der Anlage und enthält die Verluste der Erzeugung) und steht getrennt von der gemessenen Wärme,
ohne Summe und ohne die Faktoren des Satzes 6; die Temperatur ist `heating_periods.dhw_temp_c`. Heizkostenverteiler
ergeben keine kWh. Ist nach § 11 nur die Wärme ausgenommen, zählt nur das Warmwasser. „Mitgeteilt“ je Anlage und
Monat, frühestens am Tag nach dem Monatsende; fällig ist ein Monat ab dem Folgemonat (`asOf`, ohne ihn alle).
`heating.monthly-info` nennt die offenen Monate und je betroffenem Mieter **einmal** 3 % (ein Kürzungsrecht nach
Satz 3, Beträge nicht doppelt neben `heating.info-incomplete`; BR-Drs. 643/21, S. 24 f.), „um 3 %“ für den, dessen
Wohnung ganz fernablesbar ist, sonst „möglich“, und bei gemischter Ausstattung die Einzelfallprüfung
(BR-Drs. 643/21, S. 18); beides und der einzelne fehlende Monat sind als Auslegung benannt. Abgezogen wird
nichts. Karte [MonthlyInfoCard.tsx](client/src/components/MonthlyInfoCard.tsx) auf der Seite Heizkosten, Blatt
[MonthlyInfoSheet.tsx](client/src/components/MonthlyInfoSheet.tsx) als Portal an `body`, gedruckt mit
`body.print-monthly-info` ohne `#root`. Die Warmwassertemperatur steht bei verbundenem Warmwasser in der Karte
„Warmwasser“, bei getrenntem in dieser Karte (`saveDhwTemperature` in db/co2.ts, dieselbe Prüfung und Spalte;
ohne sie könnte der Vermieter die genannte Kürzung nicht abwenden). Alle Monate statt nur der Heizperiode
(Vorblatt der BR-Drs. 643/21) und „fällig ab dem 1. des Folgemonats“ stehen als Auslegung bzw. Festlegung im Text.

**Brennstoffvorrat** (Heizung PR 8, #97, #99): Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle
(`STOCK_ENERGIES` in [shared/fuelStock.ts](shared/fuelStock.ts)) rechnet
[server/src/fuelStock.ts](server/src/fuelStock.ts) den verbrauchten Brennstoff: Anfangsbestand +
Lieferungen − Endbestand, für Menge, Betrag, kg und CO₂-Kosten. Die acht Spalten des Vorrats stehen an
`heating_periods` (Migrationen 0024, 0025); gelesen und geschrieben in
[server/src/db/fuelStock.ts](server/src/db/fuelStock.ts). Lieferungen dieser Brennstoffe haben
Lieferdatum und Menge statt Rechnungszeitraum und laufen nicht durch die Abgrenzung von PR 7
(`plantFuel` überspringt sie); ihr Betrag ist Σ der verknüpften Positionen, sonst der an der Lieferung.

- **Bewertung, eine Bewertungsregel:** Die HeizkostenV regelt die Bewertung des Restbestands nicht.
  Verbraucht wird rechnerisch das Älteste zuerst (Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121; ebenso
  Minol); der Endbestand besteht aus den jüngsten Teilen und wird zu deren Preisen, kg und CO₂-Kosten
  bewertet, je Teil gerundet (Cent, kg auf das Hundertstel, nicht 0,1 kg wie im Entwurf, weil dessen
  Zahlen zwei Stellen haben). BGH VIII ZR 298/80, auf das Minol sich beruft, betrifft die
  Mindestangaben einer Abrechnung und sagt zur Bewertung nichts.
- **Was weitergegeben wird** (`handover`, Durchsicht von #237): Bucht eine Heizperiode keinen
  Übertrag (freie Schlüssel ohne Brennstoffposition mit Umlageschlüssel, `stockTemplateOf` in
  fuelStock.ts, dieselbe Regel in Schnappschuss und Abrechnung), haben ihre Mieter den Endbestand mit
  den Rechnungen bezahlt; er geht mit 0 € und ohne CO₂-Kosten weiter, die kg bleiben. Ebenso zählt der
  Anfangsbestand der ersten Heizperiode mit Vorrat mit 0 €, wenn er schon umgelegt wurde
  (`heating_periods.opening_already_settled`; ohne Antwort „ja“, wenn die Vorperiode an dieser Anlage
  oder ohne Anlage eine Heizposition **ausdrücklich als Brennstoff** hat (`heatingPart: 'fuel'` oder mit
  Lieferung verknüpft), oder wenn die **positiven** Beträge ihrer Heizpositionen **ohne Kennzeichen**
  zusammen mindestens den Wert des Anfangsbestands erreichen (eine Gutschrift zieht nicht ab): Eine
  Wartung von 250 € erklärt keinen Bestand von 2.000 €, und vorher trug der Vermieter ihn dann still.
  Die Regel steht einmal als `settledByDefault` in fuelStock.ts; Schnappschuss, Abrechnung und Karte
  fragen dort. Die Karte „Vorrat“ belegt „Ja“ nur bei `defaultAlreadySettled: 'default'` vor, sonst
  steht „Bitte wählen …“ und es wird nichts gesendet: Eine Vorbelegung ohne Grund würde beim ersten
  Speichern zur Angabe. Unter der Schwelle und ohne Antwort nennt der Hinweis
  `fuel.opening-check-loose` (Stufe `hint`) die Positionen. „Betrieb“ und „Ablesung“ zählen nie; „abgeschlossen ohne Vorrat“
  allein reicht nicht), Hinweis `fuel.opening-settled` mit „nach Ihrer Angabe“ oder „nach der
  Vorbelegung“. Beruht die Vorbelegung nur auf Positionen ohne Kennzeichen (`defaultLoose`), steht
  statt des Hinweises die Warnung `fuel.opening-settled-assumed`, die die Positionen mit Betrag nennt.
  Ein ausdrückliches „nein“ trotz Brennstoff in der Vorperiode (dieselbe Schwelle) ergibt
  `fuel.opening-not-settled` mit Betrag. Die Auswahl „Teil der Heizkosten“ im Kostenformular führt
  alle Werte des Modells und „ohne Angabe“ (`HEATING_PART_OPTIONS` in costForm.ts). Trägt der
  Vermieter in der Vorperiode einen Endbestand ein, leert das in derselben Transaktion den eigenen
  Anfangsbestand der offenen Folgeperiode, und das Entfernen des Vorrats setzt deren Antwort auf
  „schon umgelegt?“ zurück; sonst lebte ein veralteter Anfangsbestand wieder auf (`saveStock`,
  `removeStock` in db/fuelStock.ts). Eine abgeschlossene Heizperiode, deren Stand
  keinen Vorrat eingefroren hat, gibt ihren Endbestand ebenfalls mit 0 € weiter (`closedWithoutStock`).
  Übernimmt eine Heizperiode einen Bestand mit Wert nicht (Bestandsrechnung fehlt, geht nicht auf oder
  kein Schlüssel), oder ist die Folgeperiode ohne Vorrat abgeschlossen, nennt `fuel.stock-not-taken-over`
  den Betrag, den der Vermieter trägt.
- **Die Kette:** Den Anfangsbestand trägt der Vermieter nur in der ersten Heizperiode mit Vorrat ein;
  jede weitere übernimmt den Endbestand der Vorperiode mit seinen Teilen (der Server lehnt einen
  eigenen ab). `stockChainsOf` in snapshot.ts baut die Kette bis zur ersten abgeschlossenen
  Vorperiode; deren Endbestand ist eingefroren und steht im abgeschlossenen Stand unter
  `heating[].stock.closing`, gelesen über `frozenSettlementOf` (`stockClosings`). Ein Wiederöffnen
  hebt ihn auf.
- **Und rückwärts:** Ist die Folgeperiode abgeschlossen und hat sie den Endbestand übernommen
  (`stockOpenings`), ist ihr eingefrorener Anfangsbestand der Endbestand der Vorperiode
  (`nextFrozenOpening`), und er wird dort als „im Vorrat“ gutgeschrieben, auch wenn die
  Bestandsrechnung nicht mehr aufgeht. Einheit und Endbestand sind gesperrt, sobald die Folgeperiode
  abgeschlossen ist, mit oder ohne Vorrat; hat sie den Bestand übernommen, auch Menge, Einheit und
  Lieferdatum der Lieferungen, ihr Entfernen und das Lösen ihrer Positionen (`stockTakenOverBy` in
  repository.ts); Beträge bleiben änderbar. Ohne diese Regeln änderte die wieder geöffnete Vorperiode,
  was sie weitergibt; die Invariante
  [fuel-stock-invariant.test.ts](server/test/fuel-stock-invariant.test.ts) prüft die Übergabe je Paar
  von Heizperioden, die Befunde der Durchsicht hält [vorrat-durchsicht.test.ts](server/test/vorrat-durchsicht.test.ts).
- **Gesperrt** sind Vorrat und Lieferungen einer abgeschlossenen Heizperiode (Lieferdatum dort, auch
  beim Verschieben hinein oder hinaus; die Bezeichnung bleibt änderbar), und der Wechsel des
  Energieträgers, sobald irgendwo ein Vorrat eingetragen ist (409).
- **§ 11 Abs. 2 Satz 2 CO2KostAufG** (`co2.costs-before`, Rechnungsdatum): Brennstoff mit Rechnung vor
  dem 01.01.2023 zählt mit seinen kg, nicht mit seinen CO₂-Kosten; `fuel.before-2023` sagt, dass er die
  Stufe hebt. CO₂-Kosten gibt es nur bei Heizöl, Flüssiggas und Kohle (`CO2_FUELS`): Holz und Pellets
  stehen nicht in Anlage 1 BEHG, für sie gibt es keine Standardwerte nach § 7 Abs. 4 BEHG, und das
  CO2KostAufG gilt nach § 2 Abs. 1 nicht.
- **Messdienst ohne Aufteilung** (`selfAfterService`): E und C aus dem Bestand (Naht N1 zur eigenen
  Aufteilung von PR 7, `OwnFuel` in calc.ts); ohne Bestand keine Aufteilung und `fuel.stock-missing`
  mit 3 % je Mieter statt `co2.service-unsplit`. Wer zum Vorrat nichts erfasst hat, sieht den Hinweis
  von PR 6.
- **Freie Schlüssel** (`manual`): Die Rechnungen bleiben Positionen; zwei Übertragsposten
  `stock:<Anlage>:<Heizperiode>:in|out` („aus dem Vorrat“, „im Vorrat“) laufen mit dem Schlüssel der
  größten Brennstoffposition (sonst der jüngsten der Vorperiode) durch die Verteilung, als Zeilen
  `kind: 'fuelCarry'` über denselben Weg wie die Überträge von PR 7 (`fuelSynthetic`), Gegenzeile beim
  Vermieter `fuelCarry` unter `stock:<Anlage>:<Heizperiode>`. Sie zählen nicht in die Gesamtkosten und
  nicht in die Steuer. Ohne Bestand oder ohne Schlüssel `fuel.manual-by-delivery` und Verteilung nach
  Lieferung wie bisher, die CO₂-Einstufung dann nach den gelieferten kg. Der Hinweis sagt, dass eine
  Abrechnung nach Lieferungen nicht zulässig ist und sich nicht durch die Kürzung ausgleichen lässt (BGH
  VIII ZR 156/11, Leitsätze 1 und 2); im selbstbewohnten Zweifamilienhaus nennt er § 2 Nr. 4a BetrKV.
  Eine Brennstoffposition ohne Lieferung neben dem Vorrat meldet `fuel.stock-unlinked`, und die
  CO₂-Aufteilung gilt dann als unvollständig. Die Kürzung nach § 12 Abs. 1 HeizkostenV rechnet auf den
  Anteil samt Übertrag.
- **Steuer nach Bezahltem:** Der Eigenanteil der Abrechnung enthält den Anteil am Übertrag, die
  Steuerübersicht nicht; `TaxReport.expenses.stockCarrySelfCents` nennt den Abstand, die Steuerseite
  erklärt ihn (N8).
- **Peildatum:** gerechnet wird mit dem Wert wie gepeilt; `fuel.stock-date-differs` nennt Tage,
  Gradtagsanteil und Lieferungen dazwischen.
- `fuel.stock-missing` ist eine Warnung; den Fehler bei der eigenen Heizkostenabrechnung bringt PR 10
  mit eigenem Code, denn eine Stufe hängt am Code.

**Der Umstieg** ([server/src/db/changeover.ts](server/src/db/changeover.ts)): Beim ersten Start
der neuen Version wandern die Daten der `db.json` in die Datenbank, ohne dass jemand einen Befehl
eingibt. Die Reihenfolge steht dort ausführlich; kurz: erkennen, prüfen (mit dem Validator,
**bevor irgendetwas geschrieben wird**), in eine eigene Datei `mietfuchs.sqlite.umstieg`
schreiben, importieren, nachrechnen und erst dann mit einem `rename` aktivieren. Zuletzt heißt
die `db.json` **`db.json.abgeloest`**: Ihr Inhalt bleibt unverändert der Rückweg, aber unter
einem Namen, den niemand für den laufenden Stand hält. Seit die Routen die Datenbank schreiben,
läge sie sonst tot im Ordner und sähe doch aus wie vorher. Eine gesonderte Sicherungskopie gibt
es aus demselben Grund nicht mehr: Sie sollte den vorgefundenen Stand einfrieren, *während* die
`db.json` weiterbenutzt wurde, und zwei byteweise gleiche Dateien nebeneinander erklären
niemandem etwas. `umstieg-protokoll.txt` nennt, was übernommen wurde.

- **Die centgenaue Regression ist die Bedingung, unter der überhaupt aktiviert wird**
  ([server/src/db/regression.ts](server/src/db/regression.ts)). Für jedes Jahr, in dem der
  Bestand etwas enthält, **und jedes Jahr dazwischen**, werden Abrechnung,
  Verbrauchsübersicht, Mietkonto und Steuerübersicht aus beiden Beständen gerechnet und
  verglichen. Die Jahre dazwischen gehören dazu, weil ein Mietverhältnis durch sie hindurchläuft
  und der Verbrauch zwischen zwei Ablesungen interpoliert wird; ein unbefristetes
  Mietverhältnis reicht bis ins laufende Jahr, sonst bliebe gerade das Jahr ungeprüft, in dem
  der Vermieter arbeitet. Weicht ein Cent ab, wird nicht aktiviert, und die Meldung nennt Jahr
  und Zahl. **Ausgenommen sind genau sieben Angaben** (`unitName`, `tenantName`, `description`,
  `basisText`, `warnings`, `notices`, dieselben Meldungen in fester Gestalt, und `steps`, der
  Rechenweg aus denselben Beschriftungen), jede eine, die das Geraderücken ausdrücklich verändern darf; sie
  stehen benannt in regression.ts. Verglichen wird gegen den Bestand, wie Mietfuchs ihn **heute**
  rechnet, und nicht gegen den schon geradegerückten: Sonst prüfte die Regression das
  Geraderücken gegen sich selbst. Die eine Ausnahme davon ist der feste Monatsbetrag neben einer
  leeren Staffel, und sie steht als `standToCompare` sichtbar da.
- **Das Geraderücken steht als Funktion in legacy/migrate.ts** (`straightenForDatabase`), nicht im
  Umstieg. Dieselbe Datei hält die Regeln des Einlesens, und validate.test.ts rechnet mit
  **dieser** Funktion nach, dass keine Zahl wandert. Solange das nur in den Tests von Hand
  geschah, waren die Hinweise des Validators eine Beschreibung ohne Gegenstück im Code.
- **Scheitert ein Schritt, ist der alte Zustand unberührt**, Mietfuchs arbeitet mit der `db.json`
  weiter, und beim nächsten Start wird es erneut versucht. Jeder Abbruch hat seinen eigenen Test
  ([db-changeover.test.ts](server/test/db-changeover.test.ts)); zwei davon lassen sich von außen
  nicht herbeiführen (das Einfügen und die Regression), dafür gibt es benannte Griffe in den
  Optionen. `runChangeover` **wirft nie**: Auch das Aufräumen im Fehlerfall schluckt, was es
  nicht schafft, sonst käme aus dem Umstieg eine Ausnahme statt einer Meldung.
- **Ohne WAL, und vor dem `rename` wird nachgesehen.** Ein `rename` bewegt nur die Hauptdatei;
  eine liegengebliebene `-wal` oder `-journal` gehörte danach zu keiner Datenbank mehr. Die
  Verbindungen werden vorher geschlossen, denn unter Windows lässt sich eine geöffnete Datei
  nicht ersetzen, und der `rename` hat ein paar Wiederholungen, weil ein Virenscanner sie
  kurzzeitig offen halten kann.
- **Gelesen und geschrieben wird über [read.ts](server/src/db/read.ts) und
  [write.ts](server/src/db/write.ts)**, und beide sind mechanisch: eine Spalte je Feld, keine
  fachliche Regel. `read.ts` liest **in der Reihenfolge, in der die Zeilen angelegt wurden**
  (`ORDER BY rowid`). Das ist keine Kosmetik: Zwei Ablesungen mit demselben Datum sortiert die
  Berechnung stabil, es gilt also die Reihenfolge der Datei, und welcher der beiden Stände der
  spätere ist, entscheidet über den Verbrauch. Fehlt die Zeile der Einstellungen, gelten die
  Vorgabewerte einer neuen Einrichtung ([server/src/defaults.ts](server/src/defaults.ts)) — das
  ist jeder erste Start, denn die Zeile entsteht erst beim ersten Speichern. Entschieden wird das
  an der **Zeile** und nie an einem Wert: Ein Feld, das der Nutzer geleert hat, bleibt leer.
- **Der Nutzer erfährt es in der Oberfläche**, nicht nur auf der Konsole: Beim Start aus einem
  Linux-Paket gibt es keine. Der Weg dafür ist `database.changeover` in `/healthz`
  ([client/src/components/Database.tsx](client/src/components/Database.tsx), Logik in
  [client/src/database.ts](client/src/database.ts)). Gelungen ist ein Satz mit einem Knopf,
  gescheitert eine Erklärung samt der Zusage, dass unverändert weitergearbeitet wird. Unterbleibt der Umstieg, weil die Datenbank schon Daten trägt und
  daneben eine `db.json` liegt, ist das der Zustand `stale` (#89): kein Fehler, sondern ein
  Hinweis mit dem Weg über das Backup. `none` bleibt der stumme Normalfall.
  Nach einem Update nennt `database.migrated` die Sicherung, die `backupBeforeMigrating` vor dem
  Nachholen angelegt hat (`{ steps, backup, at }`, nur der Dateiname, denn sie liegt immer im
  Datenordner), und die Oberfläche zeigt einmal einen Hinweis mit dem Rückweg aus MIGRATION.md
  (#154). `null` ist es bei einer frisch angelegten Datenbank, nach dem Umstieg aus der
  `db.json` (Rückweg ist dort `db.json.abgeloest`) und nach dem Wiederherstellen eines Backups
  (dort `mietfuchs.sqlite.vor-restore`); eine Meldung nennte sonst eine Datei, die es nicht gibt.
  Liegt eine Sicherung gleichen Namens schon da (ein früher gescheitertes Update), wird sie als
  `….vom-JJJJ-MM-TT-HHMM` beiseitegelegt und neu gesichert, nie wiederverwendet: Sie hielte einen
  Stand fest, hinter dem seitdem gearbeitet wurde. Das Wegklicken merkt sich die Oberfläche je
  Name und Zeitpunkt. **Der Hinweis übersteht einen Neustart** (#180): Wer in Docker oder mit npm
  neu startet, bevor er die Oberfläche öffnet, verlor ihn sonst. Gemerkt wird er in der kleinen
  Datei `sicherung-vor-update.json` im Datenordner ([server/src/db/migrationNotice.ts](server/src/db/migrationNotice.ts)),
  bewusst nicht in der Datenbank: Er gehört zum Update, nicht zum Bestand, und braucht so keine
  Migration und kommt nicht ins Backup. Weg ist er, wenn „Verstanden“ ihn mit
  `POST /api/database/migrated/seen` meldet (nur mit passendem Schlüssel `Name@Zeitpunkt`), wenn
  ein Backup eingespielt wird oder wenn die genannte Sicherung fehlt. Die Konsole nennt die
  Sicherung mit vollem Pfad, aber nur beim Start, der sie angelegt hat. **Entschieden wird erst
  nach dem Umstieg** (`noteAfterChangeover` in index.ts): Lag eine leere Datenbank eines früher
  gescheiterten Umstiegs neben der `db.json`, sichert das Nachholen der Schritte einen leeren
  Stand; nach `done` gibt es deshalb weder Hinweis noch Merkdatei noch Konsolenzeile, nach
  `failed` in diesem Lauf keinen Hinweis.

**API** ([server/src/index.ts](server/src/index.ts)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Sie gehen durch [server/src/db/repository.ts](server/src/db/repository.ts); das Kaskadieren beim
Löschen erledigen die Fremdschlüssel und nicht mehr index.ts. Alle Datenrouten grenzen mit
`?property=` auf ein Objekt ein (siehe Objekte). `POST /api/tenancies/:id/change` führt den
Mieterwechsel (Ende, Zwischenablesungen, Nachmieter) in einer Transaktion aus, ganz oder gar
nicht (#150, `changeTenant` in repository.ts). Daneben Spezialrouten: `/api/properties`
(Objekte anlegen, ändern, nur leere löschen), `/api/heating-plants` (Heizanlage, siehe dort; der Rumpf beim Anlegen nimmt `adjust` für Name und Wohnungen bisheriger Anlagen, `/:id/replace` ist der Kesseltausch; `PUT /:id/self` richtet die eigene Heizkostenabrechnung ein, 409 mit Positionen; `PUT …/periods/:period/distribution` setzt den Anteil nach Verbrauch; `PUT …/periods/:period/info` die Angaben nach § 6a und `PUT …/periods/:period/rules` Ausnahme, Vereinbarung, monatliche Information und Verbrauchervertrag ab dieser Heizperiode (siehe Pflichtangaben); `PUT`/`DELETE …/periods/:period/estimates/:unitId/:part` die Schätzung nach § 9a (siehe dort); `PUT`/`DELETE /api/units/:id/interim-gaps/:date` die Antwort zu einer fehlenden Zwischenablesung, siehe Eigene Heizkostenabrechnung), `/api/heating-plants/:id/periods` (Heizperioden einer Anlage mit CO₂-Angaben und Warmwasser, siehe CO₂ beim Messdienst), `…/periods/:period/stock` (PUT/DELETE, Vorrat, siehe Brennstoffvorrat), `/api/heating-plants/:id/period` und `/separate` (je mit `/preview`), `/api/heating-settlement/:plant/:period` (samt `/close` und `/history`) und `/api/heating-settlements` (eigene Heizperiode, siehe dort), `/api/heating-plants/:id/deliveries`, `/api/fuel-deliveries/:id` und `/api/properties/:id/degree-days` (siehe Lieferungen), `/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract` und `/api/intake` (KI-Auswertung, auf Wunsch als Strom, siehe
unten), die KI-Einstellungen `/api/ai/presets`, `/api/ai/status`, `/api/ai/key` und
`/api/ai/consent` sowie `/api/ollama/status` für ältere Tabs (alles siehe
KI-Belegauswertung), `/api/update` und `POST /api/update/check`
(Update-Hinweis, siehe unten), `/api/uploads` (Belegordner: Liste mit Angaben, `PUT` für Objekt,
Jahr und Rechnungsdatum im Posteingang, Löschen unverknüpfter Dateien, siehe Belegordner), `/api/assessments` (Belegbuchung, siehe dort),
`/api/receipts/tax/:year` (Belege für die Steuer als ZIP), `/api/backup`/`/api/restore` (ZIP via yazl und yauzl; das
Wiederherstellen prüft die `db.json` im Archiv erst mit dem Validator und lehnt sie ab, bevor
irgendetwas überschrieben wird, siehe Die Datenbank. Es setzt dabei **keinen vorhandenen Stand
voraus**: Auf einem frischen Rechner gibt es noch keine `db.json`, denn die entsteht erst beim
ersten Speichern, und genau dort wird am häufigsten wiederhergestellt. Die Sicherheitskopie
`db.json.vor-restore` entsteht deshalb nur, wenn es etwas zu sichern gab, und den Belegordner
legt die Route selbst an, statt sich darauf zu verlassen, dass multer ihn beim Laden des Moduls
angelegt hat. Beides spricht seit Aufgabe 7a auch die Datenbank, siehe Backup und
Wiederherstellen) sowie
`/api/settlement/:year/close` (POST/PUT/DELETE; DELETE schiebt den Stand in die Tabelle
`closed_settlement_history` statt ihn zu löschen, lesbar über `/api/settlement/:year/history`,
#56): friert die Abrechnung als Snapshot in der
Collection `closedSettlements` ein (inkl. `sentAt` für die §556-Frist) — `GET
/api/settlement/:year` liefert dann den Snapshot statt der Live-Berechnung; daneben rechnet sie neu und
liefert in `deviation` je Mieter, was die heutige Berechnung anders ergäbe (#56,
[server/src/settlementDiff.ts](server/src/settlementDiff.ts)); ein unlesbarer alter Stand heißt
„nicht vergleichbar“ und nicht „keine Abweichung“; ebenso nimmt
`taxReport` den Eigenanteil aus dem Snapshot, damit Steuerübersicht und versendete Abrechnung
nicht auseinanderlaufen.

**Der Schnappschuss** ([server/src/snapshot.ts](server/src/snapshot.ts), #55): Die Berechnung
liest den Speicher nicht mehr selbst, sondern bekommt den `Snapshot` eines Abrechnungsjahres
gereicht. `snapshotFromDb(db, year)` baut ihn, die Routen in index.ts rufen ihn auf, und
`computeSettlement`, `rentLedger`, `taxReport` und `consumptionOverview` nehmen nur noch ihn
(das Jahr steckt darin, damit sich ein Schnappschuss nicht mit einem anderen Jahr verrechnen
lässt). Der Typ führt nur die Sammlungen und Felder, die die Berechnung wirklich liest, mit
`Pick` aus `shared/types.ts` geschnitten: keine Einstellungen, keine Kontaktdaten, keine
Belegdateien. So sieht man der Grenze an, woraus eine Abrechnung entsteht, und ein zweites
Speicher-Backend wird später eine neue Datei statt eines Umbaus.
**Nach Jahr eingegrenzt wird nur, was sein Jahr als Feld trägt** (`costItems`, die abgeschlossene
Abrechnung). Ablesungen, Mietverhältnisse, Zahlungen, Wohnungen und Zähler gehen vollständig
hinein: Der Anfangsstand eines Jahres ist die Ablesung vom 31. Dezember des Vorjahres, und die
Staffeln für Personenzahl, Vorauszahlung und Kaltmiete gelten „ab diesem Datum" mit einem
Eintrag, der Jahre alt sein kann. Wer dort filtert, bekommt keinen Fehler, sondern eine stille
Falschrechnung. Die Begründung je Sammlung steht in snapshot.ts, die Tests dazu in calc.test.ts.
Der Schnappschuss reicht die Datensätze durch und kopiert sie nicht; die Berechnung ändert
nichts an ihm. **Vom Objekt führt er nur, was die Berechnung braucht** (`property`: Art und Baujahr
der Kabelanlage, #121), gefüllt in `snapshotFor` aus dem Bestand. Fehlt es, etwa beim Umstieg aus
einer `db.json` und in der Regression, rechnet die Berechnung wie ohne die Angabe; beide Seiten der
Regression haben es deshalb gleichermaßen nicht. Aufgefangen wird dort nichts: Ist eine Sammlung in der Datei `null` (#59), soll
es krachen. Ein `?? []` an der Grenze ergäbe eine leere Abrechnung ohne Kosten und ohne
Warnung, in der jeder Mieter seine Vorauszahlung voll erstattet bekommt. Sie sähe stimmig aus
und wäre falsch, und das ist der schlimmere der beiden Ausgänge.

**Hinweise und Regelverzeichnis** (#112): Die Berechnung erzeugt keine losen Sätze mehr, sondern
`notices` (`Notice` in shared/types.ts) mit Code, Stufe, Titel, Text, dem betroffenen Eintrag
(`subject`, daraus wird „Hier beheben →“) und gegebenenfalls der Regel. **Stufe, Titel und Regel
hängen am Code** (`noticeKinds` in calc.ts), und `warn` nimmt nur Codes aus dieser Tabelle; so
hat derselbe Code nie zwei Stufen. Die Stufen sind fachlich bestimmt: `error` heißt, eine
Position wird wegen widersprüchlicher Angaben gar nicht verteilt, `warning`, Geld landet anders
als vermutlich gewollt oder eine Rechtsregel ist verletzt, `hint`, prüfen ohne sicheren Fehler.
**`warnings` bleibt als Liste der Texte, Wortlaut unverändert**: Cockpit, ältere Tabs und
eingefrorene Abrechnungen lesen sie, und eine vor #112 abgeschlossene Abrechnung kennt nur sie
(die Oberfläche zeigt sie dann als Warnungen ohne Titel, `noticesOf` in
[client/src/notices.ts](client/src/notices.ts)).
**Ein `error` sichert das Abschließen ab** (#319): Beide Close-Routen antworten mit 409,
`errorNotices` und `errorToken`, in derselben Rückfrage wie `fuelGaps`, bis `despiteErrors` die
Marke des Stands trägt, der eingefroren würde (nach einer Schätzung;
[server/src/closeQuestion.ts](server/src/closeQuestion.ts)). Ausgenommen sind die Auskünfte aus
`INFORMATIONAL`, die dafür in [shared/notices.ts](shared/notices.ts) stehen (`blockingErrors`).
**Die Oberfläche fragt bei denselben Fehlern auch vor dem Drucken** (#341,
[client/src/despiteErrors.ts](client/src/despiteErrors.ts)), denn der Druck ist Browser-Druck: nur bei
einer offenen Abrechnung, eine abgeschlossene wurde beim Abschluss schon bestätigt, und das
Versanddatum gibt es nur dort. Zeigt die Seite schon Fehler, nennt sie die erste Rückfrage zum
Abschließen, und die Rückfrage des Servers zu denselben Fehlern gilt damit als beantwortet
(`sameErrors`). Solange eine offene Abrechnung Fehler hat, trägt jede Mieterabrechnung im Druck den
Vermerk „Entwurf, nicht versenden“ (`print-only`), auch bei Strg+P; eine abgeschlossene nie, denn nach
„Trotzdem abschließen“ muss sie sich ohne ihn drucken lassen.
**Dargestellt wird jeder Hinweis über den Baustein `Notice`** (#346, Schritt 10, M8;
[client/src/components/Notice.tsx](client/src/components/Notice.tsx)): Stufe als Zeichen und Wort, fetter
Titel, der Text, „Hier beheben →“, und unter „Mehr dazu“ (eingeklappt, im Druck immer da) **nur
Begründungen aus Fundstellen**. Für Hinweise der Berechnung (`CalcNotice`) wird der Text des Servers nur in
Sätze zerlegt ([client/src/noticeText.ts](client/src/noticeText.ts)). **Sichtbar bleibt grundsätzlich
alles**: Ein Satz, der zuerst „ein Satz was tun“ zeigte, verlor bei allen Kürzungs-Codes Prozentzahl und
Beträge und ließ Pronomen ohne Bezug stehen (Durchsicht M1, M2). Eingeklappt wird nur ein Satz, der nach
Abzug seiner Fundstellen (Normen, Urteile mit Aktenzeichen, Drucksachen, Randnummern) weder eine
Prozentzahl, einen Betrag, ein Datum, eine Kürzung, eine Aufforderung noch eine Folge für Geld oder
Pflichten trägt und überwiegend aus Fundstellen besteht oder ein Urteil oder eine Drucksache als Beleg
nennt (`isCitationSentence`); verweist ein sichtbarer Satz danach mit einem Pronomen auf ihn, bleibt er
sichtbar. Ein Fehler (Stufe `error`) steht ganz offen (#236). Geprüft über echte Texte je Code
(`client/src/testing/noticeSamples.json`, je Code der längste Text aus den Server-Tests; neu erzeugen, wenn
calc.ts Texte ändert). Kein Feld `action` am Server: Es wären rund 180 zweite Texte, die vom ersten
wegliefen, und eingefrorene Abrechnungen hätten es nicht. Abkürzungen („Abs.“, „S.“, „z. B.“), Daten und
„am 6. April“ beenden keinen Satz. Seitentexte nehmen `NoticeBox` (Titel, Text, Rest von Hand gesetzt) oder
`TextNotice` für einen fertigen Text. Wächter S26: Stufenklasse und -wort nur im Baustein, und freie Kästen
`className="notice|error|hint"` nur noch nach Ausnahmeliste mit Anzahl, die nur sinkt.
**Leerzustände** (`EmptyState`, [client/src/emptyStock.ts](client/src/emptyStock.ts)): Im leeren Zeitraum
nennen Cockpit und Abrechnung den ersten fehlenden Schritt mit Knopf (Wohnung, Mietverhältnis, Belege),
ohne „Entwurf“, Frist, Kennzahlen, Druckeinstellungen und Rechtsstand; ein gesperrter Knopf nennt seinen
Grund daneben (`aria-describedby`). Nach dem Abschluss nennt die Unterzeile des Cockpits den Stand und die
offenen Punkte beim Namen (`cockpitSubtitle`, M9); abgeschlossen ohne Versanddatum zeigt sie die Frist, die
weiterläuft, und ein Versand nach Ablauf der Frist steht ausdrücklich da. Die Kopfzeile im Druck lässt einen
Objektnamen weg, der schon am Anfang der Adresse steht (`letterhead`), und die Abrechnung trägt Datum und
Anschrift des Mieters (`recipientLines`, N5); ist der Mieter ausgezogen und fehlt die Anschrift für den
Schriftverkehr, warnt die Seite vor dem Druck (`printsFormerAddress`, #229).

**Rechtsregister** (Heizung PR 1, Entwurf `2026-10-05-heizung-gesamt-design.md` Abschnitt 4):
Jede Rechtszahl steht nur in [shared/law/](shared/law/), mit Gültigkeit, Fundstelle, Prüfstand und
**genau einer Zeitregel** (`periodStart`, `overlap`, `eventDate`; braucht ein Fall zwei, sind es
zwei Parameter). Abgefragt wird mit `law(param, ctx, log)` aus
[shared/law/register.ts](shared/law/register.ts); die Berechnung legt je Abrechnung ein Protokoll
an (`createLawLog`, kein globaler Zustand), fragt erst dort, wo ein Wert gebraucht wird, und legt
die benutzten Werte in `legalBasis.values`. **Ein Wert, der im Zeitraum nicht gilt, ist kein
angewandter Wert**: `overlap` protokolliert bei `none` nichts; braucht ein Hinweis die Fassung
trotzdem (die Kabelregel ab 2025), trägt calc.ts sie mit `recordVersionAt` ein, und die Anzeige
nennt die Gültigkeit („gilt bis 30.06.2024“). Die Werte frieren mit dem Abschluss ein, `deviation`
meldet einen später geänderten Wert in `valueChanges`, je Fassung (Kennung und Beginn). Texte außerhalb einer Abrechnung (Lexikon,
Anleitungen, Cockpit) lesen `valueAt(param, LAW_AS_OF)`. Das Regelverzeichnis liegt in
[shared/law/rules.ts](shared/law/rules.ts) und nimmt seine Daten und Zahlen aus den Parametern.
**Eine Fassung wird nie geändert, nur eine neue angelegt**; `law-history.test.ts` hält jede
ausgelieferte Fassung als Zahl fest. Einzige erlaubte Änderung: das offene Ende einer Fassung zu
schließen, wenn eine neue anschließt. `law-literals.test.ts` verbietet Prozentangaben einer
Rechtsfolge außerhalb des Registers, Datumsliterale in den Dateien der Berechnung und die Zahlen
des Registers im Code (ohne Zeichenketten und Kommentare) von calc.ts, snapshot.ts,
shared/heating.ts und invoiceAmounts.ts; erlaubte Stellen stehen dort mit Grund, eine
Mutationsprobe hält fest, dass der Wächter die früheren Stellen fängt. Beim Tag bricht release.yml
ab, solange ein Wert `checked: 'unchecked'` hat (`law-release.test.ts`); der Schritt prüft an der
TAP-Ausgabe, dass der Sperrtest nicht übersprungen wurde, sonst fiele die Sperre bei fehlender
Variable still aus. **Es gibt nur ein Stichtagsdatum**,
`LAW_AS_OF`; das frühere `RULES_AS_OF` des Regelverzeichnisses ist entfallen. Wer eine Regel oder
einen Wert prüft, setzt `retrieved` der betroffenen Parameter und `LAW_AS_OF` auf den Tag der
Durchsicht (#110); `LAW_AS_OF` ist das jüngste `retrieved` und steht als Rechtsstand in jeder
Abrechnung. Die
jährliche Durchsicht (Entwurf 4.8) geht jeden Parameter an seiner Fundstelle durch, legt bei
einer Änderung eine neue Fassung an statt die alte zu ändern, trägt veröffentlichte Werte ein,
sieht Bundesgesetzblatt (HeizkostenV, CO2KostAufG, GModG, BetrKV, MessEV) und neue Urteile des
VIII. Senats zu Heiz- und Betriebskosten durch und setzt zuletzt `LAW_AS_OF`.

**Werte, die erst später veröffentlicht werden** (Heizung PR 17, Entwurf 4.5): `co2.price` (ab 2027) und
`co2.price-ets` (ab Rechnungsjahr 2027) haben `null` und sind `overridable`. Sie fragt nur
`lawOverridable`, das einen Eintrag des Vermieters aus `law_overrides` (je Kalenderjahr, mit Quelle;
[server/src/db/lawOverrides.ts](server/src/db/lawOverrides.ts), Routen `/api/law-overrides`) liest und als
`overridden` protokolliert; `law()` lehnt überschreibbare Parameter ab. Die Abrechnung nennt einen benutzten
Eintrag (`law.value-overridden`, hint). Ein Release mit dem amtlichen Wert setzt ihn an die Stelle von `null`
(die zweite Ausnahme in `law-history.test.ts`), und der Eintrag heißt „überholt“. Gebraucht werden diese
Werte, die EBeV-Werte und `ustg.gas-heat-network-rate` nur für `co2.cost-implausible`
([server/src/co2Plausibility.ts](server/src/co2Plausibility.ts), je Rechnung, die die Heizperiode berührt,
auch bei Vorratsenergien): Spannen über Preisjahre, Emissionshandel und Steuersätze (Mischsatz über die
Stichtage nach BMF-Schreiben vom 25.10.2022, Rz. 12; Flüssiggas beide Sätze nach Rz. 5), Grenzen 1 €/3 %
und bei den kg 1 % nach oben, 10 % nach unten wegen anerkannter Biomasseanteile (Festlegung ohne
Rechtsquelle nach 15.2 F6, `KG_TOLERANCE`, `COST_TOLERANCE`). Mietfuchs rechnet nie kg oder € aus kWh vor,
es vergleicht nur. Ins Register kommt, was im BGBl. steht oder das UBA nach § 4 Abs. 2, 3 CO2KostAufG
bekanntmacht; keine Drucksachen. Das Blatt „CO₂-Angaben für den Messdienst“ baut
[server/src/co2Sheet.ts](server/src/co2Sheet.ts) (#210, nicht abgegrenzt; Betrag ohne Eintrag aus den
verknüpften Positionen), die Seite Heizkosten zeigt es über `Co2SheetView`. **Seine Summe zählt nur, was die
Abrechnung zählt** (Durchsicht von #246): Storno und abgedeckte Schätzung über `cancelledDeliveries` und
`estimateFactors` aus fuel.ts (dieselbe Auswahl wie die Bewertung; auch die Prüfung in calc.ts überspringt
Stornos), eine Rechnung vor 2023 nur mit kg, der Anfangsbestand mit seinen CO₂-Kosten nach der Regel der
Bestandsrechnung; jede nicht zählende Zeile trägt einen Vermerk. Bei Wärme aus dem Emissionshandel mit
Anschluss nach dem Stichtag prüfen Abrechnung und Blatt nicht (`etsExempt` in co2Plausibility.ts, eine
Stelle). Das Blatt spricht in der dritten Person, der Kasten „Bitte prüfen“ ist `no-print`; dieselben
Befunde stehen an der Lieferung auf der Seite Heizkosten. **Das Blatt rechnet nichts, was die Abrechnung
entscheidet** (Runde 3 von #246): Endbestand, Verbrauch, der Teil je Rechnung in der Heizperiode sowie kg/m²
und Stufe kommen aus dem Ergebnis der Abrechnung (`heating[].stock`, `fuel`, `co2`, als `billing`);
`co2SheetFor` rechnet dafür die Abrechnung, in der die Heizperiode steht. Eine Zufallsprüfung in
co2-sheet-runde3.test.ts hält die abgegrenzte Zeile gleich der CO₂-Grundlage der Abrechnung, auch bei einer Lücke.
Auch die Fläche der Einstufung kommt von dort (bei mehreren Anlagen eines Gebäudes die gemeinsame, `areaSource:
'building'`). Vermerke stehen nummeriert unter der Tabelle (`sheetNotes`), nicht als Zeile darin: Die Tabelle
scrollt auf dem Handy seitlich. Ob das CO2KostAufG gilt und welche Befunde die Prüfung je Rechnung hat, steht in
`heating[].co2Check` (`applies`, `exemption`, `findings`); Blatt und Karte „Lieferungen“ lesen es von dort, auch
die Ausnahme nach § 11 für Wärme und Warmwasser ohne vereinbarte Abrechnung (§ 2 Abs. 7). Die Regel dazu steht einmal in
[server/src/co2Exemption.ts](server/src/co2Exemption.ts) (`co2OffByExemptionOf`, `exemptionText`); steht eine Heizperiode in
keiner Abrechnung, fragt das Blatt sie mit den Periodendaten (`heatingRulesOf`) selbst. Werte, die nur geprüft werden, tragen
`checkOnly` (shared/law); die Abweichung einer abgeschlossenen Abrechnung sagt dann „Prüfwert geändert“.

**IBAN** (#279): Die Prüfung nach ISO 13616 (Länderkennung, Länge je Land, Prüfziffer) steht
einmal in [shared/iban.ts](shared/iban.ts), für Formular und Server dieselbe. Geprüft wird nur
beim Speichern über die Routen (`acceptIban` in [server/src/iban.ts](server/src/iban.ts), aus
den Verschmelzungen in repository.ts und aus `PUT /api/settings`) und im Formular
([client/src/ibanField.ts](client/src/ibanField.ts), Feld
[IbanInput.tsx](client/src/components/IbanInput.tsx)), und **nur eine neu gesetzte oder
geänderte**: Eine gespeicherte ungültige, die eine Seite unverändert mitschickt (normiert
verglichen), hindert das Speichern einer anderen Angabe nicht und wird nicht still
umgeschrieben; das Formular nennt sie als Hinweis. Backup, Wiederherstellen, Umstieg und
Validator prüfen bewusst nicht: Eine falsche IBAN ändert keine Zahl, sie ist krumm und nicht
kaputt. Leer ist immer erlaubt. Was dennoch ungültig im Bestand steht, nennt das Cockpit als
ruhigen Hinweis ohne Ampel ([client/src/ibanCheck.ts](client/src/ibanCheck.ts)), mit Sprung zur
Stelle, und nur, was das gewählte Objekt betrifft: die Vorgabe der Einstellungen nur ohne eigene
IBAN am Objekt, Mietverhältnisse nur, wenn sie im Vorjahr oder später noch liefen.

**Begriffslexikon** (#113): [shared/glossary.ts](shared/glossary.ts) hält jeden Fachbegriff mit
Erklärung, Beispiel mit Zahlen, Rechtsgrundlage und „Brauche ich das?“. Es war der **erste
Laufzeitanteil in `shared/`**; der Client bündelt ihn (dafür `allowImportingTsExtensions` in
client/tsconfig.json), der Server braucht nur den Typ `TermId`. Seit #140 lädt auch der Server
Laufzeitanteile aus `shared/` (seit #141 `allocation.ts` und `duplicates.ts`, seit #170
`costItem.ts`, `assessment.ts` und `categories.ts`), zuerst [shared/heating.ts](shared/heating.ts): Heizkostenart, § 2 HeizkostenV
(eine Garage zählt nicht als Wohnung) und welche Wohnung bei welcher Heizposition ohne
Verbrauchsanteil dasteht. Das Cockpit wendet die Regel nicht selbst an, sondern liest den Hinweis
`heating.not-by-consumption` der Abrechnung (client/src/meterCheck.ts). Jeder Hinweis-Code in
`noticeKinds` trägt mindestens einen Begriff (`terms`, als nicht leeres Tupel getippt, dazu
[glossary.test.ts](server/test/glossary.test.ts)). In der Oberfläche zeigt
[Term.tsx](client/src/components/Term.tsx) die Erklärung, und zwar über einen Auslöser als `span`
mit `role="button"`: In einem `<label>` wäre ein `<button>` das erste bedienbare Element und
nähme dem Eingabefeld die Beschriftung. Seit #346 Schritt 6 ist die Erklärung ein Popover
(`usePopover`, siehe „Ein Monat ist ein Monatsfeld“): hinter dem Begriff ein „?“ (gezeichnet von CSS,
Utility `term-q`, inline und für Vorleser ausgeblendet, damit der Name des Felds seine Beschriftung
bleibt; Tippfläche `--target` über `::after`), die Erklärung im Top-Layer, nicht im Label, am Handy als
Blatt unten (höchstens 60 % der Höhe). Sie zeigt Erklärung und Beispiel; Rechtsgrundlage und „Brauche ich
das?“ stehen in der Hilfe, dorthin führt „Mehr in ‚Hilfe & Begriffe‘ →“ (ein Link, über `TermHelp` aus
App.tsx mit `navigate`, also mit Rückfrage bei offenem Formular; die Hilfe springt mit `focusTerm` zum
Begriff, einmal: danach meldet sie `onFocusTermDone`, und die App vergisst den Sprung). Esc schließt nur die Erklärung, auch im Seitenfenster. Die Seite „Hilfe & Begriffe“ listet alle. Rechtsaussagen
nur, wo sie im Gesetz stehen; Beispiele werden nachgerechnet. Lexikon und Anleitungen nehmen ihre
Rechtszahlen aus dem Rechtsregister.

**Anleitungen je Vermietungsart** (#164): [shared/guides.ts](shared/guides.ts) hält acht
Anleitungen (Einliegerwohnung, Mehrfamilienhaus, Eigentumswohnung, mehrere Objekte, Garage,
Pauschale/Inklusivmiete, Messdienst, Mieterwechsel/Leerstand), jede mit „Trifft das auf Sie zu?“,
Schritten mit Sprung, „Was Mietfuchs daraus macht“, Beispiel, „Worauf Sie achten müssen“
(Rechtliches nur mit `norm`) und „Was Mietfuchs (noch) nicht kann“ (mit `issue`). Die Seite
„Hilfe & Begriffe“ zeigt sie aufklappbar über den Begriffen, eine Suche gilt für beide. Die
Sprungziele (`GUIDE_PAGES`) sind Kennungen der Navigation; [client/src/nav.ts](client/src/nav.ts)
hält `Tab` und `NAV` (aus App.tsx herausgezogen) und übersetzt nur, wenn jede davon eine Seite
ist. [guides.test.ts](server/test/guides.test.ts) **rechnet jedes Beispiel mit der Berechnung
nach** (`computeSettlement`, `taxReport`) und verlangt die Beträge wörtlich im Text, und es
verlangt jede Beschriftung in „…“ der Schritte wörtlich in der Oberfläche: Wer eine Schaltfläche
umbenennt oder die Verteilung ändert, sieht die Anleitung rot werden. **Die Grenze dieses
Wächters**: Er sucht den Wortlaut im Quelltext (client/src und shared/, `&amp;` aufgelöst), nicht in
der gerenderten Seite; ein Zitat besteht also auch, wenn der Text nur in einem Kommentar oder auf
einer anderen Seite steht, und Text, den JSX zerlegt (ein `<Term>` im Satz, `{year}` im Knopf),
findet er nicht und darf deshalb nicht zitiert werden. Beschrieben wird nur, was Mietfuchs auf dem
Stand des Zweigs kann; wo Mietfuchs eine nicht abschließend geklärte Frage selbst auslegt
(Leerstand beim Personenschlüssel, #177), sagt die Anleitung das, statt einen Ausweg zu raten. Auf der Seite sind
Anleitungstitel und Begriffe `h3`, die Abschnitte einer Anleitung `h4`; bei einer Suche sind die
Treffer aufgeklappt, und ein Sprung beginnt oben auf der Zielseite.

**Rechenweg** (#114): Jede Zeile der Mieter trägt `steps` (`CalcStep` in shared/types.ts),
erzeugt dort, wo die Zeile entsteht, aus denselben Zahlen, als fertiger Text. Der Restcent aus
`largestRemainder` wird an der Zeile benannt, die ihn bekommt. Die Seite Abrechnung zeigt die
Schritte aufklappbar ([CalcSteps.tsx](client/src/components/CalcSteps.tsx)), immer `no-print`.
Eine vorher abgeschlossene Abrechnung hat keine Schritte; dann zeigt `stepsOf`
([calcSteps.ts](client/src/calcSteps.ts)) nur, was die Zeile selbst hergibt, statt nachzurechnen,
denn eine neue Rechnung muss nicht zum eingefrorenen Stand passen. Die Regression des Umstiegs
nimmt `steps` aus wie `basisText`.

**Schlüssel merken und Vorjahr übernehmen** (#141, Entwurf in
[docs/superpowers/specs/2026-10-02-schluessel-merken-design.md](docs/superpowers/specs/2026-10-02-schluessel-merken-design.md)):
Der gemerkte Schlüssel einer Kostenart ist **der Schlüssel ihrer Positionen im Vorjahr desselben
Objekts**, abgeleitet aus dem Bestand und ohne eigene Tabelle; eine Staffel daneben wäre ein
zweites Abbild, das auseinanderläuft. Was „derselbe Schlüssel“ heißt (Schlüssel, Zählertyp,
Wohnung, Anteile, Teilnehmer, Maßstab der Gemeinschaft, **nicht** deren Summe der Anteile), steht
einmal in [shared/allocation.ts](shared/allocation.ts), weil Vorschlag (client/src/costForm.ts,
`withCategory`/`newItemForm`/`aiPositionDefaults` mit `KeyContext`) und Hinweis
(`key.changed-from-previous-year` in calc.ts, Stufe `hint`) dasselbe meinen müssen; sonst löste
der Vorschlag selbst den Hinweis aus. Widersprechen sich die Vorjahrespositionen, gibt es keinen
Vorschlag. Bei einer breiten Kostenart (`BROAD_CATEGORIES`, heute „Sonstige Betriebskosten“) zählt
nur die Vorjahresposition mit derselben Beschreibung (Jahreszahl ersetzt), sonst bekäme die
Dachrinne die Direktzuordnung der Hebeanlage (`comparablePrevious`, für Vorschlag und Hinweis
dieselbe). Eine KI-Zeile mit gemerkten Teilnehmern oder Direktzuordnung ist nie vorab angehakt
und in der Schnellerfassung nie grün. Für Heizung und Warmwasser nennt der Hinweis § 6 Abs. 4
HeizkostenV statt § 556a Abs. 2 BGB. Das Abrechnungsjahr wechselt nur über `useSwitchYear`
(property.tsx), das wie `useSwitchProperty` bei offenem Formular fragt; App.tsx stellt die
Seiten je Objekt **und Jahr** neu auf. Der Schnappschuss trägt dafür `previousCostItems` (optional wie `property`, gefüllt in
`snapshotOf`); verteilt wird davon nichts. **„Aus dem Vorjahr übernehmen“ lebt nur im Browser**
([client/src/carryOver.ts](client/src/carryOver.ts)): keine Entwürfe in der Datenbank, denn eine
Position ohne Betrag wäre dort eine 0 oder ein Kennzeichen, das jede Rechnung kennen müsste.
Gespeichert wird über `buildCostItemBody`, also mit derselben Prüfung wie im Formular; Betrag,
§35a-Anteil, Kosten der Gemeinschaft und Beleg kommen nie mit. Die KI-Übernahme baut ihren Rumpf
seither ebenfalls über `buildCostItemBody` (`aiPositionBody`). Die Summe der MEA am Objekt und die
Hausgeldabrechnung als Klammer sind Folgearbeit mit #102; bis dahin kommt die Summe von der
zuletzt erfassten Position „laut Gemeinschaftsabrechnung“ (`lastExternalBasis`).

**Doppelte Kostenpositionen** (Zusammenspiel von #141 und #170): Die Übernahme aus dem Vorjahr
legt eine Position mit Schätzbetrag und ohne Beleg an; kam danach die echte Rechnung über einen
KI-Weg, entstand still eine zweite derselben Kostenart, und umgekehrt traf der Vergleich der
Beschreibung eine KI-Beschreibung nie. Ob eine Position dieselbe Rechnung sein könnte, steht
deshalb **einmal** in [shared/duplicates.ts](shared/duplicates.ts) (`sameCostCandidates`):
dasselbe Objekt, Jahr und dieselbe Kostenart; bei den breiten Kostenarten (`LOOSE_CATEGORIES`:
`BROAD_CATEGORIES` und „Nicht umlagefähig“) zusätzlich ähnliche Beschreibung oder gleicher
Rechnungssteller (ohne Jahreszahlen und Satzzeichen, Präfixvergleich), weil dort ganz
verschiedene Rechnungen nebeneinander stehen. Die Regel findet nur Kandidaten, entscheiden tut der
Vermieter. Sie fragen: `alreadyCarried` (carryOver.ts, ausgenommen die genaue Übernahme einer
Schwesterposition des Vorjahres), der Vorschlag jeder Zeile einer Auswertung (`describeAssessment`
in server/src/assessment.ts, nicht vorab angehakt, Rückfrage „Trotzdem anlegen“ aus der Vorschau),
das Kostenformular beim Neuanlegen („Stattdessen … bearbeiten“) und der Hinweis
`cost.possible-duplicate` in calc.ts. Was beim Verknüpfen mit dem Betrag geschieht, steht in
**Belegbuchung** unten; die Logik dafür lebt nicht mehr im Browser.
Der Hinweis der Abrechnung (`possibleDuplicates`, Stufe `hint`, zählt in der
Ampel) kommt nur, wenn eine Position der Gruppe keinen Beleg hat und dazu (a) eine einen Beleg
hat oder (b) das Vorjahr Positionen dieser Art hatte und das Jahr mehr hat. Ohne Vorjahr und ganz
ohne Belege bleibt er still, ebenso Restmüll und Biomüll, beide übernommen. Gezählt wird im Jahr des Belegs (`detectedYear` in
server/src/assessment.ts, gespeichert als `assessments.detected_year`), nicht im gewählten, denn im Januar steht die Auswahl oft noch auf dem Vorjahr. Der Schnappschuss
führt dafür `vendor` und `invoiceFile`; verteilt wird nach keinem.

**Belegbuchung** (#170, Entwurf in
[docs/superpowers/specs/2026-10-02-belegbuchung-design.md](docs/superpowers/specs/2026-10-02-belegbuchung-design.md)):
Eine Rechnung landet genau einmal in den Kosten, weil der **Server** bucht und nicht die Seite.
Das ersetzt die frühere Logik im Browser (Gruppen, Verknüpfen, Rückfragen in triage.ts und den
beiden Seiten), die dreimal einen Geldfehler hatte.

- **Eine Auswertung ist ein gespeicherter Gegenstand** (Tabellen `assessments` und
  `assessment_lines`, Migration 0013): eine je Beleg, gespeichert nur nach Erfolg der KI (nach der
  Antwort wird `signal.aborted` geprüft, ein Abbruch speichert nichts; schlägt die Prüfsumme fehl,
  geht die Auswertung trotzdem ohne sie ein). Der Zustand einer Zeile wird **abgeleitet**
  (`lineState` in server/src/assessment.ts): ohne `cost_item_id` offen oder verworfen („Verwerfen“
  an der Zeile, die Auswertung bleibt; „Ausblenden“ heißt nur der Knopf der Warteschlange auf der
  Kostenseite, der die Karte wegnimmt und nichts verwirft), mit ihr angelegt oder verknüpft. `cost_item_id` ist
  `ON DELETE SET NULL`, das Löschen einer Position macht ihre Zeilen von selbst wieder offen.
  **Zeilennummern kommen aus einer Hochwassermarke** (`assessments.next_idx`) und werden nie
  wiederverwendet: Erneutes Auswerten ersetzt nur offene und verworfene Zeilen, gebuchte bleiben
  mit ihren Nummern, neue bekommen nie benutzte, und eine Zeile, die einer gebuchten gleicht,
  kommt nicht wieder. Die Routen sprechen Zeilen über diese Nummer an, eine wiederverwendete
  Nummer träfe die falsche Zeile. **„Gleicht einer gebuchten“ reicht dabei nicht** (`withoutBooked`
  vergleicht Betrag und Beschreibung oder Kostenart): Eine von Hand berichtigte Zeile oder eine,
  die die KI anders aufteilt, kam als neue grüne Zeile wieder und wurde mit „Alle grünen
  übernehmen“ ein zweites Mal gebucht (Integrationsdurchsicht H1, nachgemessen 2.250 € statt
  1.550 €). Zeilen, die beim erneuten Auswerten **neben gebuchten** dazukommen, tragen deshalb
  `reassessed`; für sie sind die schon aus diesem Beleg gebuchten Positionen Kandidaten, gleich
  welcher Kostenart, die Zeile ist rot („Dieser Beleg ist schon gebucht …“), und Anlegen braucht
  die Bestätigung. Ebenso das Verknüpfen mit einer solchen Position, denn es addiert den Betrag:
  Ohne `despiteCandidates` an der Entscheidung antwortet der Planer mit einer Rückfrage und die
  Buchung mit 400, die Oberfläche fragt „Trotzdem verknüpfen“ (`confirmLabel` in client/src/assessment.ts). Für die Zeilen der ersten Auswertung gilt das nicht, sonst stünde Abwasser rot,
  sobald Frischwasser gebucht ist.
  Neben den Spalten der Spezifikation stehen `detected_year` (Ampel „Rechnungsjahr ≠ Zieljahr“),
  `requested_year` (das gewählte Jahr: beim Auswerten mitgeschickt, nach einem `PUT` mit Jahr das
  gesetzte; weicht `year` davon ab, ist die Zeile gelb und nicht vorab angehakt, und „Alle grünen
  übernehmen“ bucht sie nicht, sonst landete eine Jahresrechnung vom Februar ohne gelesenen
  Leistungszeitraum ungesehen im Folgejahr; Schlussdurchsicht I1),
  `amounts_adjusted`/`labor_from_total` (die Hinweise #34 überleben das Neuladen) und
  `category_guessed` (gelb, wenn die Kostenart nur aus der Beschreibung kam).
- **Planen ist eine reine Funktion** (`planBooking` in server/src/bookingPlan.ts), Buchen führt
  ihre Schreibliste in einer Transaktion durch die Schreibschlange aus (server/src/db/booking.ts).
  **Summenregel**: Der Betrag einer Position mit Zeilen ist die Summe **aller** ihrer Zeilen,
  angelegter wie verknüpfter, über alle Belege, aus dem gespeicherten Stand; der §35a-Lohnanteil
  ist die Summe der gelesenen, und nennt keine einen, wird ein vorhandener entfernt (sonst würde
  ein stehengebliebener Schätzwert Mietern und Anlage V bescheinigt). Eine Schätzung, ein von
  Hand geänderter Betrag und ein ungelesener Beleg an der Position werden ersetzt, die Vorschau
  sagt es in ganzen Sätzen vorher. Ziele sind nur Positionen im Objekt und Jahr der Auswertung;
  `amounts` und `external` sind keine Ziele („Position öffnen“, ihr Betrag hängt an weiteren
  Angaben; der Hinweis sagt, die Zeile nach dem Aktualisieren der Position zu verwerfen, sonst
  bliebe der Beleg offen). **Gutschrift-Positionen sind keine Verknüpfungsziele, und eine Gutschrift-Zeile
  bekommt nur Gutschriften als Kandidaten**; sie wird nie verrechnet, damit sie auf der
  Abrechnung sichtbar bleibt. Ein Beleg gleichen Inhalts (Prüfsumme) kann nicht ein zweites Mal an
  dieselbe Position, der Doppelt-Hinweis erscheint bei gleichen Beträgen an einer Position.
  **Hängt der Beleg schon von Hand (`invoice_file`) an einer Position**, ohne dass eine Zeile
  gebucht ist, ist sie Kandidat jeder seiner Zeilen, unabhängig von der Kostenart
  (`lineCandidates` in server/src/assessment.ts, Ansicht und Rückfrage des Planers fragen dieselbe
  Regel): Die Zeile ist rot („Dieser Beleg hängt schon an …“), Anlegen braucht die Bestätigung.
  **Dasselbe gilt für einen Beleg gleichen Inhalts** (gleiche Prüfsumme), der von Hand an einer
  Position hängt (Integrationsdurchsicht H2): Vorher prüften `twinOf` und der Planer nur gebuchte
  Zeilen, und las die KI eine andere Kostenart, stand dieselbe Rechnung grün und vorab angehakt
  da.
  Verwerfen ergibt einen Hinweis je Zeile, damit Vorschau und Erfolgsmeldung nie leer sind.
  **Beim Lösen einer Zeile wechselt der Beleg der Position nur, wenn der gelöste ihr Beleg war**
  (und keine Zeile dieser Datei bleibt); ein von Hand angehängter Beleg bleibt, die Vorschau
  kündigt den Wechsel an.
- **Eine Zeile wird nie zweimal gebucht.** „Genau so gebucht“ (Betrag, Lohnanteil, bei neu
  angelegten auch Beschreibung, Kostenart, Schlüssel, Verteilung) ist ein Erfolg ohne Änderung
  (Doppelklick, Wiederholung nach Netzfehler); **jede Abweichung ist ein 409 mit dem aktuellen
  Stand**. **Die Vorschau trägt eine Prüfmarke** (`token`, SHA-256 über `tokenSource`, bei neu
  angelegten Positionen mit Schlüssel und Verteilung): Weicht der Stand beim Buchen ab, antwortet
  der Server mit 409 und der neuen Vorschau, statt still anders zu buchen. Gebucht wird immer im
  Objekt der Auswertung, `?property=` gilt nur für die Liste. **Objekt und Jahr sind nach der
  ersten gebuchten Zeile fest** (`placeAssessment` lehnt beides mit 409 ab, sonst entstünden
  Verknüpfungen über Jahre). Solange nichts gebucht ist, ziehen sich Posteingang
  (`PUT /api/uploads/:file`) und Auswertung (`PUT /api/assessments/:id`) Jahr und Objekt
  gegenseitig nach, damit beide Listen übereinstimmen.
- **Prüfungen in shared/**: `amountProblem` und `costItemBody` (shared/costItem.ts, nimmt Cent,
  das Formular liest nur die Eingaben), Ampel, Vorauswahl und gemerkter Schlüssel einer KI-Zeile
  (shared/assessment.ts), die Kostenarten (shared/categories.ts, client/src/types.ts reicht sie
  weiter). `POST`/`PUT /api/costItems` prüfen bewusst noch nicht damit (eigener Schritt).
- **Routen**: `/api/extract` und `/api/intake` liefern `assessment` mit Vorschlag je Zeile;
  `GET /api/assessments?property=…&open=1`, `GET`/`PUT /api/assessments/:id`,
  `POST …/plan` und `POST …/book`. `GET /api/uploads` nennt je Beleg `bookedItemIds`, die Summe
  seiner eigenen gebuchten Zeilen je Position (`bookedCents`) und die Auswertung; ein Beleg, der
  nur über eine gebuchte Zeile an einer Position hängt, steht nicht im Posteingang, zählt für die
  Belegabdeckung, kommt in Belegmappe und Steuer-ZIP und lässt sich nicht löschen (die Karte zeigt
  die Summe der eigenen Zeilen, nicht den Betrag der Position). Das Löschen prüft „in Gebrauch“
  und vergisst die Auswertung in einem Schreibvorgang, erst danach geht die Datei. Eine
  Auswertung, deren Datei fehlt, erscheint nicht in der Liste, und `plan`, `book` und `PUT`
  antworten 404 (`PUT` prüft das, bevor es schreibt).
- **Oberfläche**: eine Komponente
  ([AssessmentReview.tsx](client/src/components/AssessmentReview.tsx), Logik in
  [client/src/assessment.ts](client/src/assessment.ts)) für Schnellerfassung und Kostenseite,
  die Warteschlange dahinter ist der gemeinsame Hook `useEvaluationQueue`
  ([client/src/evaluationQueue.ts](client/src/evaluationQueue.ts)). Beide Seiten zeigen dieselbe
  Ampel: eine rote Zeile ist nicht vorab angehakt, das Jahr aus dem Beleg geht vor dem
  gewählten, und beide zeigen „Jahr …“, wenn das Jahr der Buchung vom gewählten abweicht; die
  Vorschau nennt das Jahr neuer Positionen. Die Kostenseite schickt Objekt und Jahr mit. Der
  Posteingang führt mit „Weiter prüfen“ in die Schnellerfassung (ohne Objekt
  wird zuerst das gewählte zugewiesen). „Alle grünen übernehmen“ bucht je Auswertung nacheinander,
  damit der zweite Beleg derselben Kostenart die eben angelegte Position sieht; dieser Knopf und
  „Ablesung übernehmen“ haben eine Sperre gegen Doppelklick (eine ausdrücklich übernommene rote
  Ablesung wird gesendet, als übernommen gilt sie erst danach). Die jsdom-Tests rechnen mit dem
  echten Planer ([client/src/testing/fakeBooking.ts](client/src/testing/fakeBooking.ts)). Für
  Praxislauf (Fall 14) und Browserprobe gibt es ein nachgebautes Ollama mit den Abnahmefällen
  ([scripts/fake-ollama.mjs](scripts/fake-ollama.mjs)).
- **Testgriff `NKA_TEST_ASSESSMENT_DELAY_MS`**: verzögert das Speichern einer Auswertung um so
  viele Millisekunden, nur für Tests (api-belegbuchung.test.ts legt damit einen Abbruch in das Fenster zwischen
  Antwort der KI und Speichern). Ohne die Variable gibt es keine Pause; ein Nutzer setzt sie nie.
- **Testgriff `NKA_TEST_TODAY`** (Laienprobe Heizung, Durchsicht): ein fester Tag als JJJJ-MM-TT für
  die Uhr des Servers (`today()` in index.ts, server/src/testToday.ts), nur für Tests. Prüfbestände mit
  festen Jahren kippen sonst an einem bestimmten Datum, weil eine Frist abläuft und Zeitraumwechsel,
  Aufteilen und Heizperiodenwechsel dann eine Bestätigung verlangen. Er wirkt nur auf den Server,
  nicht auf die Uhr des Browsers. Ist er gesetzt, nennt die Konsole ihn beim Start; ein Wert, der kein
  echtes Kalenderdatum ist, bricht den Start mit Meldung ab. Ein Nutzer setzt ihn nie.

**Berechnungs-Engine** ([server/src/calc.ts](server/src/calc.ts)) — das Herzstück, hier liegt
die ganze fachliche Komplexität:
- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats — Gleitkomma-Fehler vermeiden.
- **Eine Rundungsregel für jede Verteilung** (#202, `distributeCents`): Jede Position wird
  genau einmal nach Hare/largest-remainder verteilt, über alle Empfänger zugleich, also die
  Mieter **und je Grund eine Zeile des Vermieters** (Eigennutzung, Pauschale, Inklusivmiete,
  außerhalb, Rest der Vereinbarung, Rest des Hauptzählers, zuletzt Leerstand bzw. Rest der
  Einzelbeträge als Betrag minus alles übrige; `landlordRecipients`). Die exakten Werte ergeben
  genau den Betrag, jede Zeile ist ihr Wert ab- oder aufgerundet, keine wechselt das Vorzeichen,
  eine mit exakt 0 bekommt nie einen Cent. Gleichstand (mit Toleranz gegen Rauschen): erst der
  Vermieter, dann die Kennung per `compareText`. Gutschriften als Spiegelbild. Der Eigenanteil
  ist genau die Zeile `selfUse`, die Zeilen des Vermieters sind die `landlordParts`; einen
  Grund `rounding` erzeugt die Berechnung nicht mehr. Der §35a-Lohn wird danach **innerhalb**
  der Kostenanteile verteilt (`distributeLaborCents`): je Zeile ab- oder aufgerundet, nie über
  dem Kostenanteil, zusammen genau L, bei L = A gleich dem Kostenanteil. Nicht Lohn und Rest
  getrennt verteilen: zwei Rundungen zusammen können fast 2 Cent vom exakten Anteil abweichen.
  Ein Test über Zufallsbestände prüft das über `onAllocation` in den Optionen.
- **Umlageschlüssel** (`item.key`): `area` (Wohnfläche), `persons` (personentagesgenau),
  `units` (Wohneinheiten), `meter` (Verbrauch nach Zählertyp), `direct` (Direktzuordnung),
  `custom` (vereinbarte Prozentanteile je Wohnung in `item.customShares`, absolut gerechnet —
  was unter 100 % fehlt, trägt der Vermieter), `external` (laut Gemeinschaftsabrechnung, #94)
  und `amounts` (Einzelbeträge je Mietverhältnis, #94).
- **Verteilbasis je Position** (#94): `participantUnitIds` grenzt die Basis auf Teilnehmer ein
  (Fläche, Einheiten, Personen, Verbrauch, `external`, `amounts`); ohne Teilnehmer ist sie
  **dasselbe Objekt** wie bisher (`fullBasis` in calc.ts), damit die Umstellung keine Zahl
  verschiebt. Bei `external` **trägt die Position den eigenen Anteil** laut Hausgeldabrechnung,
  nicht die Summe der Anlage, sonst stünde die Summe als Vermieteranteil und Werbungskosten da;
  `externalBasis` (Maßstab, Summe, Gesamtkosten) steht daneben für den Rechenweg und eine
  Plausibilitätswarnung. Verteilt wird nach `mea`, Fläche oder 1 je Wohnung. Bei `amounts` ist
  der Anteil genau der Betrag des Mietverhältnisses, ohne Tagesanteil (der Messdienst teilt beim
  Wechsel selbst), der Rest beim Vermieter; eine Summe über dem Rechnungsbetrag wird nicht
  verteilt. Tests in calc-verteilbasis.test.ts samt eigener Invariante.
- **Nebenkostenmodell am Mietverhältnis** (#93): `costModel` (kalte Kosten) und
  `heatingModel` (Kostenart „Heizung und Warmwasser“, `HEATING_CATEGORY` in calc.ts), jeweils
  `settlement | flatRate | inclusive`, fehlend `settlement`; beim Heizmodell dazu `selfSupply` (siehe
  „Mieter heizt selbst“ unten), das jede Stelle über `allocationModel` als `settlement` liest. Ein Mietverhältnis mit Pauschale
  oder Inklusivmiete **bleibt in der Verteilbasis**, sein Anteil wird ihm nicht zugebucht und
  fällt dem Vermieter zu, und zwar **nicht als Eigenanteil** (abziehbar). Bleibt seine Abrechnung
  leer und gibt es keine Vorauszahlung, fehlt sie in `statements` und steht in `notSettled`.
  **Die Pauschale hat eine eigene Staffel** (`flatRates`, Tabelle `flat_rates`): Das Mietkonto
  führt sie im Soll, die Abrechnung rechnet sie nie an. In der Staffel der Vorauszahlung wurde
  sie bei einem gemischten Modell (kalt pauschal, Heizung abgerechnet) gegen die Heizkosten
  gutgeschrieben, gefunden in der Durchsicht. Warnung nach
  § 2 HeizkostenV außerhalb des selbstbewohnten Zweifamilienhauses. Die drei Listen der
  Kostenarten (Oberfläche, KI-Schema, Anlage V) hält categories.test.ts zusammen.
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`) und Vorauszahlung
  (`prepayments`, `from: YYYY-MM`) werden als „ab Datum gilt Wert" geführt. Die tatsächlich
  gezahlten Vorauszahlungen je Abrechnungszeitraum lassen sich via `prepaymentOverrides`
  eintragen und haben Vorrang, denn anzusetzen ist, was der Mieter für den Abrechnungszeitraum
  tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16). Mietfuchs rechnet ohne
  Eintrag mit der Staffel, also dem Soll; auf das Ist kommt es durch die Jahreskorrektur, und
  `prepayment.arrears` und `prepayment.partial-month` weisen darauf hin.
  **Die Monatsregel steht an einer Stelle** (#311, `monthShare` und `rateInMonth` in calc.ts) und
  gilt für die Abrechnung (Vorauszahlung, Heizstaffel) wie für das Mietkonto (Kaltmiete,
  Vorauszahlung, Heizstaffel, Pauschale). Ein Monat zählt, sobald das Mietverhältnis an einem
  seiner Tage besteht; im angebrochenen Ein- und Auszugsmonat gilt die Rate nach Kalendertagen,
  `round(Rate × Tage / Tage des Monats)` je Monat in Cent, ein voller Monat ohne Rundung. Vorher
  zählte ein Monat nur, wenn das Mietverhältnis am Monatsersten bestand, falsch in beide
  Richtungen (Einzug am 15.03. bei 150 €: 82,26 € zu wenig angerechnet; Auszug am 15.06.: 75,00 €
  zu viel). **Das ist eine Auslegung**, wie `VACANCY_PERSONS`: Ein Gesetz oder eine
  BGH-Entscheidung zur Methode gibt es nicht. Kalendertage, weil die Kostenseite derselben
  Abrechnung nach Kalendertagen verteilt; 1/30 je Tag nach der Wertung des § 191 BGB ist ebenso
  vertretbar und weicht um Euro-Beträge ab (bei 150 € und Einzug am 15.: 2,74 € im März, 5,00 € im
  Februar). § 556b Abs. 1 BGB regelt nur die Fälligkeit und trägt die Regel nicht. Bei
  getrennter Heizstaffel wird je Staffel gerundet (32,90 € + 49,35 € = 82,25 €), weil die Beträge
  bei Weg d zwei Abrechnungen gehören. Der Hinweis `prepayment.partial-month` (Stufe `hint`,
  `INFORMATIONAL`) nennt den angesetzten Betrag und Beispielsummen mit und ohne vollen Monat,
  ausdrücklich als Beispiel, das volle Zahlung der übrigen Monate voraussetzt; `prepaymentNote`
  nennt dem Mieter den Anteil. Abgeschlossene Abrechnungen bleiben eingefroren, `deviation`
  zeigt den Unterschied. Eine Invariante in calc.test.ts hält Abrechnung und Mietkonto je
  Mietverhältnis gleich.
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen, in UTC gerechnet; Tagesanteile zählen
  für Teiljahre. `end: null` = offenes Mietverhältnis.
- **Zähler**: Ablesungen → Verbrauchssegmente (`meterSegments`), tagesanteilig interpoliert
  (`consumptionInPeriod`). Zählerwechsel über `replacement: true` + `oldEndValue`. Negativer
  Verbrauch erzeugt eine Warnung.
  **Ein Zählerwechsel ohne `oldEndValue` ebenfalls** (#83), und dort entsteht **kein Segment**.
  Auch hier zahlt die Lücke **ein anderer Mieter** und nicht der Vermieter, aus demselben Grund
  wie unten: gemessen 540,15 € statt 802,40 € beim einen und 1.459,85 € statt 1.197,60 € beim
  anderen. Der Rechenweg auf der Abrechnung liest sich dabei plausibel, die Meldung ist also das
  Einzige, was darauf stößt.
  Das frühere `?? 0` las das fehlende Feld als Null und machte aus einem Stand von 980 einen
  Verbrauch von minus 980 (im Jahr gemessen minus 910), der beim Verbrauchsschlüssel in die
  Verteilbasis einging und die Anteile aller Mieter verschob. Gefragt wird nach `null` und nicht
  nach dem Wert, denn ein eingetragener Endstand von 0 ist eine Angabe (Zähler lief rückwärts)
  und keine Lücke. Validator und Schema bleiben bewusst außen vor: Beide würden den Bestand
  ablehnen und dem Vermieter den Umstieg verwehren, obwohl die Übernahme selbst keine Zahl
  verändert — die ist schon vorher falsch.
  **Zwei Ablesungen am selben Tag ebenso** (#69), und zwar statt der über negativen Verbrauch:
  Ein Segment entsteht nur bei mindestens einem Tag Abstand, sonst müsste durch null geteilt
  werden, und die Differenz fiel bisher wortlos heraus. Sie wird **nicht** verteilt, und das ist
  eine Entscheidung mit Begründung: Zwei gewöhnliche Ablesungen am selben Tag sind fast immer
  eine Korrektur, und dann wäre die Differenz ein Tippfehler und keine Menge Wasser; beim
  Zählerwechsel wäre sie Verbrauch über null Tage, also selbst schon ein Widerspruch. Welche der
  beiden stimmt, weiß nur der Vermieter, und geraten wird in calc.ts nicht.
  **Wer das bezahlt, ist nachgemessen und stand im Issue falsch**: nicht der Vermieter, sondern
  ein anderer Mieter. Die Verteilbasis des Verbrauchsschlüssels ist die Summe des *gemessenen*
  Verbrauchs, Zähler und Nenner schrumpfen also gemeinsam, und der Rechnungsbetrag wird trotzdem
  vollständig verteilt (zwei Wohnungen, 2.000 € Wasser, 10 m³ Tippfehler: 947,37 € gegen
  1.052,63 €). Ein Test hält die Zahlen fest.
  Die Warnungen aus `meterSegments` gehen über `consumptionOverview` an die **Zähler-Seite** und
  ans **Cockpit**, dessen Ampel „Zählerstände" davon auf Rot springt; auf der Abrechnung
  erscheinen sie nicht, denn `computeSettlement` ruft `consumptionInPeriod` auf und wirft sie
  weg. Das war vorher schon so, und es soll so bleiben: Die Abrechnung ist das Dokument, das der
  Mieter bekommt, und ein Hinweis auf einen Datenfehler des Vermieters gehört nicht darauf.
  **Die Einheit** (#342, [shared/meterUnits.ts](shared/meterUnits.ts)) bleibt ein Text am Zähler, wird aber
  gelesen: Wärme kWh, MWh, GJ (2.500/9 kWh), Wasser m³, l, Strom kWh, MWh, als exakte Brüche auf kWh bzw. m³;
  Heizkostenverteiler und „Sonstiges“ (auch der Gaszähler, m³ und kWh Gas sind verschiedene Größen) ohne
  Umrechnung. Normiert wird beim Lesen (`unitKey`: „m3“, „cbm“, „KWh“ …, die Schreibweisen bei jeder Sparte),
  eine Migration gibt es nicht. **Leitsatz der Durchsicht: Ein Bestand, der vor #342 richtig rechnete, ändert
  sich nicht.** Wer Verbräuche mehrerer Zähler zusammenzählt, fragt `unitScale`, und zwar **nur mit den Zählern,
  die im Zeitraum Verbrauch beitragen** (`coveredDays` beim Verbrauchsschlüssel, sonst `coversPeriod`): Ein
  stillgelegter Zähler mit alter Einheit änderte sonst eine Abrechnung, in der er nichts misst. `relative`
  (Verbrauchsschlüssel samt Hauptzähler, Teilnehmern, Überschneidung und Zerlegung des Vermieteranteils; die
  Verteilung der eigenen Heizkostenabrechnung über `SelfMeter.scale`): Einheitlich heißt Faktor 1, auch bei MWh,
  Litern oder einer unbekannten Einheit, so bleiben gespeicherte Schätzungen nach § 9a und die Vorschläge in ihren
  Zahlen; nur gemischt bekannte Einheiten werden in die Grundeinheit umgerechnet. Der Ausweis nennt dann die Einheit
  der Zähler (`potUnits`, `potShownUnit`, `SelfPotView.consumptionUnit` ist ein Text); `estimateFits` und die
  gespeicherte `valueUnit` bleiben bei `potUnitFor`. Wird umgerechnet und gibt es eine Schätzung im Topf, sagt
  `heating.estimate-base-unit` (hint), dass ihre Zahl in kWh bzw. m³ gilt. `base` (absolute Vergleiche: Wärme am
  Speicher für α gegen die kWh der Brennstoffrechnung, Volumenvorschlag in db/co2.ts, monatliche Information)
  rechnet bekannte Einheiten immer in die Grundeinheit; das behebt α bei einem Speicherzähler in MWh. **Ein Zähler
  ohne Einheit gilt wie die übrigen.** Eine für die Sparte unbekannte Einheit neben anderen (etwa „m³“ an Wärme, die
  Vorgabe vor #142) sperrt nicht: Faktor 1 wie vor #342 und `meter.unit-unknown` (warning). Umgerechnet wird nur,
  wo alle Einheiten bekannt sind. `meter.units-mixed` (error, nicht verteilt) bleibt für verschiedene bekannte
  Größen ohne Umrechnung, also Gas über „Sonstiges“ in m³ neben kWh; das rechnete schon vorher falsch. Beide Hinweise
  nennen die Zähler mit Name und Einheit (`metersByUnitText`) und führen zur Seite Zähler (Subjekt `meter`, der
  erste Zähler mit unpassender Einheit). Das Ableseergebnis nennt die Einheit des Zählers
  (`SelfReadingView.meterUnit`). Auf der Seite Zähler ist die Einheit bei bekannten Sparten eine Auswahl
  (`meterUnitOptions`, eine gespeicherte unbekannte steht dabei); ein Zähler ohne Einheit bekommt keine Vorgabe,
  sondern „Bitte wählen“, und ein Spartenwechsel auf eine Sparte, die die Einheit nicht kennt, leert sie mit Hinweis
  (`unitDropped`, `meterUnitHint`); gespeichert wird bei Sparten mit Auswahl nur eine gewählte Einheit, eine schon
  leer gespeicherte darf leer bleiben. Der Server prüft nur eine neue oder geänderte Einheit (`acceptMeterUnit` in
  repository.ts, Muster der IBAN), nimmt bei Sparten mit Auswahl keine neue leere an und speichert die bekannte
  Schreibweise. Die Angaben nach § 6a (`heatingInfoOf`) stehen in kWh (#345): Steht der Topf Wärme in MWh oder GJ,
  rechnet heatingInfo.ts Verbrauch, Vorjahr und bereinigte Werte mit dem Faktor aus shared/meterUnits.ts um und
  vergleicht mit dem Vergleichswert in kWh je m²; der Ausweis nennt dann kWh. Vorperiode und Zeitraum rechnen mit
  denselben Zählern und Faktoren, stehen also in derselben Einheit. Heizkostenverteiler bleiben unvergleichbar.
  **Die Eichfrist** (#98, Heizung PR 21) ist eine Warnung und keine Sperre: `meters.calibrated_until`
  (Jahr, mit dessen Ende die Frist endet, § 34 Abs. 2 MessEV; Migrationen 0046/0047, Bedingungen
  `meters_calibrated_until_valid` mit `typeof`, weil die INTEGER-Affinität eine Kommazahl als REAL behält,
  und `meters_calibrated_until_hca_valid`) ergibt `meter.calibration-overdue` in `consumptionOverview`
  (Zähler-Seite, dort als `warn` und nicht als Fehler), nie auf der Abrechnung. Geprüft wird die jüngste
  Ablesung, die der Zeitraum benutzt (`readingsUsedFor` in server/src/calibration.ts: die im Zeitraum ab dem
  Vortag des Beginns, die davor und die erste danach nur, wenn interpoliert wird; ohne Gegenstück zählen sie
  nicht); eine Ablesung vom 31.12. des Eichjahres zählt noch. Liegt der letzte Zählerwechsel am letzten Tag
  des Zeitraums oder danach, misst das heutige Gerät im Zeitraum nichts, und es gibt keinen Hinweis. Die
  Regel `meter-calibration` hat `scope: 'meters'`: `rulesFor` lässt sie aus dem Rechtsstand jeder Abrechnung,
  denn die Abrechnung prüft nicht nach ihr. Das Cockpit zeigt eine eigene gelbe Zeile „Eichfrist“
  (`overdueMeters`, `calibrationDetail` in client/src/meterCheck.ts); die Ampel „Zählerstände“ zählt diesen
  Hinweis nicht (`readingProblems`). Heizkostenverteiler haben kein Eichjahr: Beim Umstellen der Sparte auf
  HKV fällt es weg, ausdrücklich gesendet gibt es 400. Die Fristen stehen im Register
  (`messev.calibration-years`, Zeitregel `eventDate`): ab 01.01.2015 Kaltwasser 6, Warmwasser und Wärme 5
  Jahre (amtlich aus BR-Drs. 599/21, Begründung zu Art. 1 Nr. 11 a), ab 03.11.2021 je 6 (Dritte
  Änderungsverordnung, BGBl. 2021 I S. 4742). **Die Verordnung hat keine Übergangsregel** (Art. 2 nur
  Inkrafttreten, § 58 Abs. 7 MessEV betrifft § 25, am Wortlaut gelesen am 12.10.2026). Die Änderungsverordnung
  vom 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren auch auf Fristen an, die
  am 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine Auslegung.
  Gerechnet wird sie in `calibrationEnd` (shared/calibration.ts; Jahreszahl 2016 bis 2021 ergibt J + 6, bis 2015 J + 5). Eine Praxis
  von Behörden oder Messdiensten wird nirgends als Beleg genannt, denn dafür gibt es keine Quelle (Durchsicht
  S1); Hinweis, Regel und Lexikon zitieren Leitsatz c wörtlich („abgelesenen Verbrauchswerten“, Durchsicht M1),
  ein Test hält beide Wortlaute fest. Der Vorschlag im Zählerformular sagt es mit demselben Satz; gefragt wird
  nach der Jahreszahl auf dem Zähler (Eichmarke: Jahr des Fristbeginns, Anlage 8; „M22“: Jahr der
  Kennzeichnung, vermutet als Inverkehrbringen). Hinweis, Regel und Lexikon zitieren BGH VIII ZR 112/10 nur
  mit dem Wortlaut von Leitsatz c. Gas- und Stromzähler haben das Feld, aber keinen Vorschlag (Frist nach
  Bauart, Anlage 7 Nr. 5.6, 6). Die Vierte Änderungsverordnung (2024) berührt diese Nummern nicht.
- **Leerstand beim Personenschlüssel** (#177): Jede Wohnung der Verteilbasis, die vermietet
  wird (`participates`, nicht selbstgenutzt, unter den Teilnehmern der Position), zählt für jeden Tag ohne Mietverhältnis mit `VACANCY_PERSONS` Personen (heute 1),
  auch zwischen zwei Mietern. Diese Personentage bekommt niemand zugebucht, ihr Anteil bleibt als
  `vacancy` beim Vermieter. Vorher fiel die leere Wohnung aus der Basis, und die übrigen Mieter
  zahlten ihren Anteil. Grundsatz: BGH VIII ZR 159/05 (am Flächenschlüssel); die fiktive Person
  nennt BGH VIII ZR 180/12 als Möglichkeit im Einzelfall, höchstrichterlich ist es nicht
  geklärt, abweichend etwa AG Köln WuM 2002, 28 (Durchschnittsbelegung). Die Zahl ist deshalb
  **eine Auslegung an genau einer Stelle** (`VACANCY_PERSONS`, verwendet über `vacancyPersons` in
  computeSettlement), und Hinweis `basis.vacancy-persons` (Stufe `hint`: nichts ist falsch
  erfasst) und Lexikon sagen das. `item.no-basis` hängt an den Personentagen der **Bewohner**
  (`occupantPersonDays`), nicht an der Basis samt Leerstand: Fehlen die Personen aller Mieter,
  bleibt das ein Datenmangel. **Wohnung ist, was Fläche hat oder bewohnt ist** (`isDwelling`,
  dieselbe Regel wie bei § 2 HeizkostenV): Eine Einheit ohne Fläche und ohne Bewohner (Garage,
  Stellplatz, auch ganz leer) ist kein Leerstand, sonst verschöben vier leere Stellplätze einen
  großen Teil der Müllabfuhr zum Vermieter; eine ganz leere meldet `basis.vacancy-no-area`, weil
  sie auch eine Wohnung mit vergessener Fläche sein kann. Eine leere Garage **mit** eingetragener
  Fläche zählt weiter als Leerstand. Der Rechenweg nennt die Leerstandstage („davon
  Leerstand“), der gedruckte `basisText` die Summe („(davon N Leerstand)“). Beide Hinweise färben
  die Cockpit-Ampel nicht (`INFORMATIONAL` in client/src/notices.ts). Abgeschlossene Abrechnungen bleiben, `deviation` zeigt
  den Unterschied.
- **Betriebsstrom der Heizung** (#212, Heizung PR 15): `cost_items.operating_power` sagt an einer
  Heizposition `included` (der Strom läuft über den Zähler des Hauses und steckt im Allgemeinstrom), an
  einer Position „Beleuchtung/Allgemeinstrom“ `deduction` (der Abzug); der Abzug zeigt mit
  `operating_power_item_id` auf seinen Betriebsstrom (`RESTRICT`, Löschen mit einem Satz gesperrt).
  Die Verweisbedingung vergleicht mit `IS` statt `=`: `NULL = 'deduction'` ist in SQLite kein Verstoß.
  Die Abrechnung prüft jede Position, die sie verteilt, gegen die Abzüge **aus allen Zeiträumen**
  (`operatingPowerDeductions` im Schnappschuss, `deductionsOf`), denn eine eigene Heizperiode und der
  Allgemeinstrom liegen oft in verschiedenen; `heating.operating-power-double` nennt die Differenz. Ein
  Abzug in einer abgeschlossenen Abrechnung hat vier Zustände am eingefrorenen Stand (`itemTotals`):
  gutgeschrieben, geändert (es zählt der eingefrorene Betrag), nicht darin (zählt nicht) und unlesbar
  (zählt nicht, aber der Text behauptet nichts und bittet nicht um neue Zustellung); je ein eigener
  Satz. Die Schätzhilfe (`shared/operatingPower.ts`, Route `POST /api/heating-plants/:id/operating-power`,
  `server/src/db/operatingPower.ts`) rechnet kWh aus Leistung, Laufzeit und Tagen je Gerät, nimmt den
  Zwischenzähler oder einen selbst geschätzten Betrag mit Pflichtgrundlage, Euro als Anteil an der
  Stromrechnung samt Grundpreis (Festlegung im Schätzermessen, im Rechenweg benannt), und legt beide
  Positionen in einer Transaktion an; 409, wenn Heizperiode oder Allgemeinstrom abgeschlossen sind. Die
  Grundlage der Schätzung steht als Text in `cost_items.operating_power_basis` an beiden Positionen und
  im Rechenweg (`no-print`), denn bestreitet ein Mieter den Betrag, muss der Vermieter sie darlegen
  (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz c). Bei Wärmepumpe und Stromheizung
  gibt es keine Hilfe: Der Strom zur Wärmeerzeugung gehört zu den Heizkosten, ist aber weder Brennstoff
  noch Betriebsstrom (§ 7 Abs. 2 HeizkostenV nennt seit 01.10.2024 die „Kosten des zur Wärmeerzeugung
  verbrauchten Stroms“ neben den Brennstoffen). Seine Heizposition (Teil `fuel`) darf trotzdem `included`
  tragen, wenn die Anlage mit Strom heizt (`POWER_GENERATED`, geprüft in `guardOperatingPower`), damit
  ein Abzug auf sie zeigen kann; das Herausrechnen ist als Auslegung gekennzeichnet. Umwälzpumpen und
  Regelung bleiben Betriebsstrom. **Durchsicht von #252:** Der Abzug zeigt außerdem auf seine
  Stromrechnung (`operating_power_general_id`, Schritt 0039 mit Datenanweisung, Bedingungen in 0040):
  dasselbe Objekt und derselbe Zeitraum, Löschen und Umstellen der Rechnung gesperrt, solange er besteht;
  Hinweise `heating.operating-power-key` (anders verteilt als die Rechnung), `-exceeds` (mehr Abzug als
  Rechnung); `-tax-year` (Betriebsstrom und Abzug in verschiedenen Steuerjahren) entfällt seit #268, siehe Steuer. Die Schätzhilfe
  nimmt nur eine Stromrechnung, die die Heizperiode berührt, übernimmt deren Jahr der Zahlung, wo der
  Zeitraum zwei Kalenderjahre berührt, lehnt eine Summe der Abzüge über der Rechnung ab (400) und fragt
  bei schon gebuchtem Betriebsstrom zurück (409 mit `question: 'despiteExisting'`; nur dann bietet die
  Karte „Trotzdem anlegen“). Dieselbe Summenregel gilt im Kostenformular (Abzug anlegen oder ändern,
  Rechnung verkleinern). Beim Steuerjahr folgt der Abzug seit #267 der Stromrechnung (outflow.ts), nicht mehr dem
  Betriebsstrom; der Betriebsstrom hat das Jahr seiner Heizperiode bzw. das angegebene. Beim Wechsel des Abrechnungszeitraums wandern Rechnung und Abzüge
  als Einheit: Die Prüfungen gelten für den Endstand (Option `periodChange`, `settleOperatingPowerLinks`),
  der Abzug folgt immer dem Endzustand seiner Rechnung (auch wenn deren Leistungszeitraum ganz in einem
  neuen Zeitraum liegt und die Gruppe des Abzugs woandershin geht; dann steht er in der Vorschau unter
  `moves` und in keiner Gruppe), denn der Betriebsstrom steckt in jedem Teil der Rechnung; jeder Teil zeigt
  auf den Teil der Rechnung im selben Zeitraum. Mehrere Abzüge einer Rechnung werden **gemeinsam** geteilt
  (`splitDeductionsAlike` in serviceSplit.ts), und zwar nach den **Beträgen** der Teile, nicht nach Tagen:
  Nur so ist aus keinem Teil mehr abgezogen, als er beträgt, auch bei drei und mehr Teilen und wenn die
  Abzüge die ganze Rechnung ergeben (Restverfahren nach Tagen ist nicht monoton). Das Jahr der Zahlung
  eines Abzugsteils fragt die Vorschau nicht und schreibt keines (#267): Jeder Teil steht im Zeitraum seines Teils der
  Rechnung und damit in dessen Jahr. Die frühere Einschränkung auf den Schnitt der Spannen und die Sperre eines Ziels
  ohne passendes Jahr (`noYearText`) sind damit entfallen, ebenso zählt ein Abzug nicht in den Sätzen zur Verschiebung
  (`followsBill`). Einen Satz zur Verschiebung in der Anlage V bei einem Teil mit festem Jahr gibt es seit #268 nicht
  mehr, denn die Steuerübersicht gleicht je Steuerjahr aus und es verschiebt sich nichts. Geprüft wird das
  **je Mieter** gegen von Hand hergeleitete Beträge, nicht je Zeitraum: „Abzug gleich Betriebsstrom je
  Zeitraum“ hielt auch ein falsches Ergebnis aus. Ein
  Scheitern ist eine 409 mit Vorschau. Kein Objektwechsel, solange ein
  Verweis besteht; `crossPropertyViolations` kennt beide. `included` nur mit positivem Betrag. Liegt ein
  Abzug in einer abgeschlossenen Abrechnung, hat jeder Zustand seinen eigenen Text, und keiner rät zu
  einem neuen Abzug in einem anderen Jahr. „Aus dem Vorjahr übernehmen“
  behält nur die Kennzeichnung `included`, nicht Grundlage und Abzug. Die Prozentspannen der Literatur
  stehen nur im Lexikon: BGH V ZR 166/15 Rn. 14 lässt den Bruchteil der Brennstoffkosten als
  Schätzgrundlage zu, gibt die Werte aber nur wieder und legt keinen fest; Mietfuchs rechnet ihn bewusst
  nicht vor. Kein Eintrag im Regelverzeichnis, denn der änderte den Rechtsstand jeder Abrechnung.
- **Betriebsstrom fehlt und Strom der Wärmepumpe im Allgemeinstrom** (#224, #253, Folge-PR zu #252,
  `missingPowerFindings` in server/src/operatingPower.ts): zwei Hinweise der Stufe `hint`, nur in der
  Gesamtberechnung, beide reine Auskunft. `heating.operating-power-missing` kommt bei einer zentralen
  Anlage mit Brenner (nicht Fernwärme, nicht „sonstige“), ohne Messdienst, ohne Eigentümergemeinschaft, mit
  Heizkosten im Zeitraum und Allgemeinstrom (nicht `external`/`amounts`), wenn keine Heizposition
  gekennzeichnet ist, keine den Teil „Betrieb“ hat, keine ohne Teil ist und kein Abzug als Antwort gilt
  (ohne Verweis oder auf eine Position dieser Anlage). **Die Grenze ist gewollt:** Ohne Angabe an der Anlage
  schweigt er, sobald irgendeine Position „Betrieb“ besteht, auch nur die Wartung, denn dann ist sie von
  einer Rechnung über einen eigenen Stromvertrag nicht zu unterscheiden, und wegklicken lässt sich ein
  Hinweis nicht. Er färbt die Cockpit-Ampel nicht (`INFORMATIONAL`), weil er auch den rechtmäßigen Fall
  „eigener Stromvertrag, Vermieter trägt selbst“ trifft. **Die Angabe an der Anlage** (#266,
  `heating_plants.operating_power_handling`, Schritte 0041/0042, Karte „Betriebsstrom der Heizung“ auf der
  Seite Heizkosten) unterscheidet die Fälle: `deducted` (über die Stromrechnung des Hauses, auch mit
  Zwischenzähler, beim Allgemeinstrom abgezogen) meldet `heating.operating-power-deduction-missing`, wenn
  Allgemeinstrom da ist, aber weder Abzug noch gekennzeichneter Betriebsstrom, **auch wenn eine Position
  „Betrieb“ besteht**; das ist die Lage aus V ZR 166/15 und VIII ZR 27/07, deshalb färbt er gelb.
  `ownMeter` (eigener Stromvertrag, Rechnung als Heizposition „Betrieb“) meldet
  `heating.operating-power-bill-missing`, wenn weder Position „Betrieb“ noch ohne Teil noch Kennzeichnung
  noch Abzug besteht, **auch ohne Allgemeinstrom** (er betrifft die eigene Rechnung); er färbt nicht, denn
  der Vermieter verliert nur eigenes Geld. `landlordPays` schweigt immer, `null` verhält sich wie vor #266.
  Die Werte richten sich nach **Stromvertrag und Rechnung, nicht nach dem Zähler** (E1 mit Rechtsprüfung
  M-1): Läuft der Strom über die Rechnung des Hauses, muss er dort heraus, gleich wer ihn trägt, und ein
  Zwischenzähler ersetzt nur das Schätzen (VIII ZR 27/07, Rn. 32). Eigene Codes statt Varianten (E6), weil
  Stufe und Ampel am Code hängen. Die Angabe steht an der Anlage, nicht je Heizperiode (E2), der Kesseltausch
  übernimmt sie (E3), der Server nimmt sie an jeder Anlage an (E4), und ob gefragt und ausgewertet wird,
  entscheidet einmal `asksOperatingPowerHandling` in shared/operatingPower.ts (E5). Frage, Beschriftungen
  und die zitierte Frage des Kostenformulars stehen dort als Konstanten, damit Hinweis, Lexikon und
  Oberfläche wortgleich sind (OperatingPowerFields.test.tsx hält die gerenderte Frage fest). Ist die
  Position „Betrieb“ womöglich schon der Betriebsstrom selbst, sagt `deduction-missing`, ihn zu kennzeichnen
  statt mit der Karte ein zweites Mal anzulegen; die Karte sieht eine Position ohne Kennzeichnung nicht.
  Keine Zahl ändert sich; ein Satz zur Steuer beim Weg „abziehen und selbst tragen“ steht bewusst nicht
  darin (eigener Befund). `heating.generation-power-missing` kommt bei Wärmepumpe und
  Elektrokessel ohne eigene Stromrechnung (Teil `fuel`, ohne Teil, Lieferung) und ohne Abzug, auch ganz
  ohne Heizposition, solange die Anlage im Zeitraum besteht; er färbt gelb. Die Daten der Fassungen kommen
  aus dem Register (`betrkv.generation-power` ab 01.01.2024, `hkv.generation-power` ab 01.10.2024, beide
  `overlap`, BGBl. 2023 I Nr. 280): ganz vor 2024 schweigt er, die HeizkostenV nennt er nur, wo der Zeitraum
  ihre Fassung berührt und `heating.heat-pump-capture` für die Anlage nicht meldet, dass sie noch nicht
  gilt (§ 12 Abs. 3 Satz 2). Abgefragt wird das Register erst, wenn der Hinweis sonst käme, damit es nicht
  im Rechtsstand jeder Abrechnung mit Wärmepumpe steht. Das Herausrechnen und die Schätzung sind beim
  Strom zur Wärmeerzeugung als Auslegung gekennzeichnet; entschieden ist beides für den Betriebsstrom.
- **Wärmelieferung, Contracting** (#213, Heizung PR 16, [shared/heatDelivery.ts](shared/heatDelivery.ts),
  [server/src/heatDelivery.ts](server/src/heatDelivery.ts)): `heating_plants.contracting` (Schritte 0043/0044)
  an jeder zentralen Anlage außer Fernwärme, **auch an der Wärmepumpe** (Prüfung R-M4); `energy` ist dann der
  Brennstoff des Kessels. Dazu `heat_delivery_since`, `previous_supply` (`landlord` | `tenant`) und
  `switch_announced_on`, nur bei Fernwärme oder Contracting. **Eine Naht:** `asBilledPlant` in `snapshotFor` und
  `heatingSnapshotFor` gibt der Berechnung bei Contracting `energy = 'districtHeating'` und daneben
  `fuelEnergy`; damit gelten die Regeln der Fernwärme ohne weitere Zeile (kein Pflichtanteil nach § 7 Abs. 1
  Satz 2 wegen § 7 Abs. 3, ÷ 1,15 nach § 9 Abs. 2 Satz 6 Nr. 2, kein Vorrat, Lieferungen als Wärmerechnungen).
  `asBilledPlant` ist idempotent (calc.ts baut Schnappschüsse auch aus Schnappschüssen). Schreibwege, Oberfläche,
  Betriebsstrom und das Blatt für den Messdienst fragen `billingEnergy`; der Wächter
  [heat-delivery-guard.test.ts](server/test/heat-delivery-guard.test.ts) verbietet dort `plant.energy` in
  Entscheidungen (Vorrat, Heizwerttabelle, Pflichtanteil, CO₂-Felder, Betriebsstrom), mit benannten Ausnahmen.
  **Ausnahmen der Naht:** § 2 Abs. 4 Satz 2 CO2KostAufG hängt an der gespeicherten Energie; ob CO₂ aufzuteilen
  ist, sagt `co2Required` nach dem Brennstoff des Lieferanten (`NO_CO2_FUELS`: Pellets, Holz, Strom, Wärmepumpe;
  „Sonstiges“ bleibt pflichtig, Auslegung); die Informationen nach § 6a nennen den Brennstoff (`generatorEnergy`)
  und verlangen Werte eines Wärmenetzes nur bei Fernwärme ohne Merkmal (§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a,
  Prüfung C-M2); bei Contracting mit Wärmepumpe sperrt dhw.ts die Formeln (`heating.dhw-share-invalid`), denn
  offen ist, ob Satz 6 Nr. 2 oder Nr. 3 gilt; gemessen rechnet sie gegen die gelieferte Wärme. § 11 Abs. 1 Nr. 3
  Buchst. a a. F. und § 12 Abs. 3 hängen am Wärmeerzeuger (`generatorEnergy` in calc.ts, Durchsicht von #272, M1;
  Auslegung am Wortlaut von § 1 Abs. 1 Nr. 2); bei Contracting mit Pellets, Holz, Strom oder Wärmepumpe teilt die
  Berechnung kein CO₂ auf und prüft keine CO₂-Werte, auch wenn eine Rechnung welche trägt.
  Nach dem Betriebsstrom fragt Mietfuchs bei Contracting wie bei Fernwärme nicht (Prüfung C-M3). **Umschalten**
  des Merkmals an einer Anlage mit Lieferungen, Vorrat, CO₂-Angaben oder Heizpositionen und Angaben (Verteilung,
  Warmwasser) eines offenen Zeitraums ist gesperrt (409, Weg über den
  Kesseltausch), denn die Abrechnung hängt am Merkmal und nicht an einem Datum; der Kesseltausch nimmt Merkmal
  und Angaben an (`SWAP_FIELDS`) und vergleicht nach der Energie der Abrechnung, Gas → Gas mit Contracting ist
  also ein Tausch (Prüfung C-M1); die Oberfläche schlägt den Tag des Tauschs als Tag der Umstellung vor.
  `heating.contracting` (hint, färbt das Cockpit nicht, führt zur Anlage) nennt für Mieter, deren Mietvertrag
  vor der Umstellung geschlossen wurde (`contractDate`, sonst Mietbeginn) und am Tag noch lief, ohne Inklusivmiete
  bei der Heizung (eine Betriebskostenpauschale zählt mit, § 556 Abs. 2 BGB, Auslegung; Durchsicht von #272, S1): die beiden Voraussetzungen des § 556c Abs. 1 BGB, die Ankündigung als
  eigene Pflicht (Abs. 2) mit § 11 Abs. 3 WärmeLV bei Zugang ab dem Tag `noticeMonths` Monate vorher
  (Auslegung entsprechend §§ 187, 188 BGB, im Text als vorsichtige Auslegung mit dem letzten Tag genannt; eine
  Ankündigung nach der Umstellung hat einen eigenen Satz), den Weg über § 5 WärmeLV; bei vorheriger Eigenversorgung der Mieter
  BGH VIII ZR 46/25 und 47/25 (Volltext geprüft am 11.10.2026: § 556c gilt nicht; im entschiedenen Fall
  jedenfalls § 7 Abs. 2, § 8 Abs. 2 HeizkostenV, der volle Umfang offen); vor dem 01.07.2013 einen eigenen
  Text (VIII ZR 54/04). Der Wortlaut folgt der rechtlichen Gegenprüfung. Die Zahlen kommen aus
  `bgb.heat-delivery-switch` (ab 01.07.2013, `eventDate`); kein Eintrag im Regelverzeichnis, damit § 556c
  nicht im Rechtsstand jeder Abrechnung steht. Nicht abgebildet: die Lieferung mit unmittelbarer Abrechnung
  des Lieferanten (§ 1 Abs. 3, § 11 Abs. 1 Nr. 4 HeizkostenV) und Contracting bei Etagenheizungen.
- **Hälftige Teilung nach § 5a CO2KostAufG** (#215, Heizung PR 18, [server/src/halfSplit.ts](server/src/halfSplit.ts),
  [shared/law/gmodg.ts](shared/law/gmodg.ts)): Ab 2028 trägt der Vermieter bei einer Heizung nach § 43 Abs. 1 GModG
  die Hälfte der Gasnetzentgelte und CO₂-Kosten, ab 2029 des Pflichtanteils an Biobrennstoff (bis 30 % des
  Brennstoffs). Merkmale: `heating_plants.gmodg43_installed_on` (gesetzt heißt „Heizung nach § 43“, nur Gas, Öl,
  Flüssiggas, nach dem 29.07.2026 außer im Neubau), `emergency_install`, `emergency_prior_duty` (gefragt als „war die
  ausgefallene eine solche Heizung, nach dem 29.07.2026 eingebaut?“, Prüfung M8), `new_building_first_use`,
  `building_application_before_2026_05_13`; `tenancies.half_split_notice_on` (§ 5d Abs. 4 je Mieter);
  `properties.tight_market` mit `tight_market_from`/`_to` (Geltung der Verordnung); Schritte 0048/0049, die
  Bedingungen an NULL-fähigen Merkmalen vergleichen mit `IS 1`, weil `= 1` bei NULL die Bedingung bestehen ließe.
  **Die Zeitregel ist `incurred`**: `law()` teilt den Zeitraum an den Fassungen von `co2.half-split` und gewichtet
  nach Anfall; je Lieferung nach den Stufen 1–5 (`deliveryShare` mit dem `ctx` aus `fuelResults`), ohne Lieferungen
  (Messdienst, Vorrat) nach Gradtagen; dass auch die CO₂-Kosten nach Anfall geteilt werden, ist Auslegung (15.1
  Nr. 13). Vor 2028 und ohne Merkmal fragt `halfSplitOf` das Register nicht. § 5a Abs. 4 Satz 2 heißt zwölf Monate
  ab dem Einbau (BT-Drs. 21/7009, S. 154), „zwölf Monate ab“ rechnet `eventPeriodEnd` (§§ 187, 188 BGB); ein Einbau
  genau zwölf Monate vor dem 01.01.2028 wird nach dem Wortlaut geteilt und als Auslegung genannt. `selfSplit` mischt
  den Anteil nach Stufen (mit § 8 und § 9) und die Hälfte; § 9 kürzt nur den Teil nach Stufen (Auslegung zulasten
  des Vermieters; bei § 9 Abs. 2 ist der Teil nach Stufen 0 ‰, nie „unbekannt“). Die Nachstufung des Messdienstes
  mischt über den vorhandenen Parameter `adjust` von `restage` mit Toleranz 1 ‰. Die Etagenheizung mischt je Wohnung
  nach ihren Rechnungen. Im selbst bewohnten Gebäude mit höchstens zwei Wohnungen an einer zentralen Anlage gilt
  die Ausnahme des § 5d Abs. 3 nur bei festgestellten Voraussetzungen: Gebiet in der Heizperiode „nein“ und für
  jeden Mieter eine zählende Mitteilung, vor Beginn der Heizperiode oder, wenn der Vertrag schon vor den
  Voraussetzungen bestand, bis zum Ende der Abrechnungsfrist (§ 5d Abs. 4 Satz 2). Contracting ist eingeschlossen
  (BT-Drs. 21/6278, S. 124); ob Gas, entscheidet `generatorEnergy` (Ausnahme der Naht, im Wächter benannt).
  Netzentgelte und Biobrennstoff stehen als Zeilen `gmodgRelief` unter `gmodg:<Anlage>:<Heizperiode>` mit Grund
  `gmodgShare` (§ 7 Abs. 5), verteilt nach dem Anteil am Brennstoff; **jede Stelle, die die CO₂-Abzugszeile an
  `reliefKey` erkennt, fragt `reliefKeysOf`** (Kürzungsbeträge, Ausweis der eigenen Abrechnung, Vorschlag nach
  § 560 im Rumpf; Prüfung M5). Fehlen Netzentgelte oder Biobrennstoff an einer Lieferung mit Tagen in der Teilung,
  warnt `co2.half-split-missing` mit 3 % je Mieter; Biobrennstoff aus dem Vorrat rechnet Mietfuchs nicht (Warnung,
  außer an jeder Lieferung ab dem 01.01.2029 (oder ohne Datum) steht 0, Durchsicht S3; ein Betrag über 0 wird abgelehnt, ebenso ab 2040).
- **Mieter heizt selbst und die CO₂-Erstattung** (#97, Heizung PR 19, [server/src/co2Refund.ts](server/src/co2Refund.ts),
  [server/src/db/co2Refunds.ts](server/src/db/co2Refunds.ts)): `heatingModel: 'selfSupply'` heißt, der Mieter
  bezieht Brennstoff oder Wärme über einen eigenen Vertrag, als Etagenheizung oder als zentrale Heizung mit
  Brennstoffvertrag beim Mieter (§ 2 Abs. 1, § 6 Abs. 2 CO2KostAufG). **Nie wie Pauschale oder Inklusivmiete lesen**:
  `allocationModel` macht daraus `settlement` für `modelFor`, `notSettled`, `heatingFlat` und `costModels`, denn
  Wartung und Betriebsstrom, die der Vermieter trägt, bleiben umlegbar. Für eine solche Anlage entsteht **keine
  Heizanlage** (die Einrichtung fragt bei Gas, Öl, Flüssiggas und Kohle nach dem Liefervertrag und bietet die
  Umstellung der Mietverhältnisse an; ein Mieter, über dessen Vertrag auch Dritte versorgt werden, ist nicht
  abgedeckt). Die Art steht in `selfSupplyKind` (`perUnit` Heizung in der Wohnung, `central` zentrale Heizung, Schritte
  0052/0053): Bei `central` meldet `heating.self-supply-operating-power` (Auskunft, färbt nicht, wie Hinweis A aus #265), wenn andere Mieter den Allgemeinstrom
  tragen und kein Abzug des Betriebsstroms erfasst ist (V ZR 166/15, Rn. 13); die Art geht beim Mieterwechsel mit.
  Heizpositionen, die nur Selbstversorger tragen, melden keine Kürzung nach § 7 Abs. 4 CO2KostAufG und
  keine nach § 12 HeizkostenV (bei der Etagenheizung gilt die Verordnung nicht, beim einzigen Nutzer wird nichts
  verteilt; Auslegung), sondern `co2.self-supply-items`; wer selbst heizt und zugleich Positionen einer Heizanlage
  trägt, bekommt `co2.self-supply-mixed` (error). Die Erstattung (`co2_refunds`, Schritte 0050/0051) gibt es nur bei
  `selfSupply` (Route 400, Abrechnung `co2.refund-not-self` und keine Zeile); verrechnet wird sie als Zeile
  `co2Refund` (Kostenart `CO₂-Erstattung`, ohne Position) mit Gegenzeile `co2Refund` beim Vermieter, Σ unverändert;
  nur in einem Zeitraum, in dem der Mieter wohnte, nie in einem abgeschlossenen, und eine dort verrechnete bleibt
  unveränderlich. Gebucht wird der angezeigte Betrag; die Nachrechnung (`selfSplit` wie bei der eigenen Aufteilung:
  Stufe, § 8 Abs. 2, § 9 nur auf den Teil nach Stufen, § 5a nach Gradtagen) steht im Rechenweg, eine Abweichung
  meldet `co2.refund-differs`; über mehr als ein Jahr rechnet sie nicht nach (umzurechnen ist nach § 5 Abs. 1 Satz 5,
  offen ist nur das Verfahren). **Steuer:** Eine verrechnete Erstattung wirkt über Saldo und Zahlungen; eine
  ausgezahlte (`paidOutOn`) steht in `taxReport` im Jahr der Auszahlung als Werbungskosten (§ 11 Abs. 2 EStG) und
  **nie als negative Zahlung im Mietkonto** (die läse `rentLedger` als Rücklastschrift). Der Vorschlag nach § 560 Abs. 4 BGB rechnet mit `recurringShareCents` ohne Erstattungen.
  Offen ist, ob § 8 Abs. 2 seit der Neufassung von § 6 Abs. 2 noch auf die Auszahlungsfrist verweist; Mietfuchs warnt.
- **Überschneidende Mietverhältnisse einer Wohnung** (#204): Wann sich zwei überschneiden (ein
  gemeinsamer Tag, inklusive Grenzen), steht einmal in [shared/tenancyOverlap.ts](shared/tenancyOverlap.ts);
  Server und Oberfläche fragen dieselbe Funktion. Gerechnet wird wie erfasst, jedes mit vollem
  Tagesanteil, aber mit Hinweis `tenancy.overlap` der Stufe `error` und beziffertem Mehrbetrag
  (`overlapExtra` in calc.ts): je Position, was die Wohnung ohne die Überschneidungstage **eines**
  der beiden weniger trüge, beide Lesarten gerechnet und beide genannt, wenn sie verschieden sind
  (eine kann 0 sein, etwa neben einer Pauschale), denn welches Datum falsch ist, weiß nur der
  Vermieter. Kosten (zu viel getragen) und Gutschriften (zu viel gutgeschrieben) werden getrennt
  summiert; es ist die Summe der Überzahlungen je Position, kein Saldo. Je Position wird zur Seite
  „zu viel“ geklemmt, eine Lesart von 0 heißt also nur „nicht zu viel“ und nie „keine Auswirkung“. Bei Schlüsseln mit fester Basis ist das der Anteil an
  den doppelten Tagen (beim Verbrauch nach dem in der Zeit gemessenen Verbrauch); beim
  Personenschlüssel stecken die Personentage auch in der Basis, dort wird neu geteilt
  (S/P − (S − o)/(P − o)); bei Einzelbeträgen entsteht nichts doppelt. Die Stammdaten fragen beim
  Speichern nach (`overlapQuestion` in client/src/tenancyModel.ts), der Server lehnt nicht ab, und
  Validator, Umstieg und Backup rücken nichts gerade. Ein Hinweis der Stufe `error` färbt die
  Cockpit-Ampel rot (`attentionLevel` in client/src/notices.ts).
- **Beteiligung je Wohnung** (drei Zustände, siehe `UnitUsage` in shared/types.ts): `participates:
  true` = vermietet, Anteil trägt der Mieter · `selfUsed: true` = selbstgenutzt, zählt in die
  Verteilbasis von `area`/`units`/`persons` (dort mit `selfPersons`), Anteil fällt in den
  Vermieteranteil · beides `false` = außerhalb der Abrechnungseinheit, bleibt ganz außen vor.
  Grund für die Basis-Zugehörigkeit: Kosten einer Rechnung über das ganze Haus dürfen nur
  anteilig auf die Mieter umgelegt werden. Beim `meter`-Schlüssel bilden **alle**
  Wohnungszähler die Basis, unabhängig vom Kennzeichen — ein Zählerstand belegt Verbrauch
  innerhalb der abgerechneten Menge. **Fehlt einer Wohnung der Verteilbasis der Zähler, wird
  der Hauptzähler (Zähler ohne Wohnung) zur Basis** (#116, Vorwegabzug): Ihr Verbrauch ist der
  Rest nach Abzug der Wohnungszähler, bei selbstgenutzten Wohnungen als Eigenanteil, bei einer
  vermieteten ohne Zähler beim Vermieter und mit Warnung, denn aufteilen ließe er sich nur mit
  einer erfundenen Regel. Vorher zahlte bei einer Einliegerwohnung mit Zwischenzähler der
  Mieter die ganze Rechnung (gemessen 1.000 € statt 200 €). Haben alle Wohnungen Zähler, bleibt
  es beim Verhältnis der Wohnungszähler, und die Messdifferenz geht darin auf; zeigen sie
  zusammen mehr als der Hauptzähler, ebenso, dann mit Warnung. Mit Teilnehmern (#94) gilt der
  Hauptzähler nie, er misst das ganze Haus. Vier Feinheiten aus der Durchsicht, jede mit Test:
  Gefragt wird nur nach **bewohnten** Einheiten (selbstgenutzt oder mit Mietverhältnis im
  Jahr), eine leere Garage verbraucht nichts; ohne Teilnehmer nach **allen** Einheiten des
  Objekts, auch außerhalb der Abrechnungseinheit, denn deren Verbrauch steckt ebenfalls im
  Hauptzähler und gehört nicht in den Eigenanteil. Ein Zähler **ohne Ablesung im Jahr** zählt
  nicht als Zähler (`coveredDays`). Und ein Hauptzähler, der **nicht das ganze Jahr** abdeckt,
  wird nicht zur Basis, sondern ergibt eine Warnung: Der Versorger liest selten zum 31.12. ab,
  und ein Teiljahr gegen ganzjährige Wohnungszähler ließe den Mieter zu viel zahlen. Einer Einheit
  mit `noConnection` für den Zählertyp (#117, Tabelle `unit_no_connection`) fehlt kein Zähler,
  etwa die vermietete Garage ohne Wasser. `computeSettlement` liefert den auf `selfUsed`-Wohnungen
  entfallenden Teil separat als `selfUsedShareCents` (für die Anlage V privat, nicht
  abziehbar). Ein Datenschritt setzt das Kennzeichen bewusst **nicht** automatisch, weil es die
  Verteilung bereits abgerechneter Jahre verändern würde.
- **Mietkonto** (`rentLedger`): Kaltmiete-Staffel (`baseRents`) + Vorauszahlung ergeben das
  monatliche Soll (Bruttomiete); Zahlungseingänge (`payments`) werden Jan→Dez FIFO auf die
  Monate verteilt (Status bezahlt/teilweise/offen). Im angebrochenen Ein- und Auszugsmonat ist
  das Soll anteilig nach Kalendertagen, mit derselben Funktion wie die Abrechnung (`rateInMonth`,
  #311); der Monat trägt dann `share` und die Seite zeigt „anteilig 17/31 Tage“. Vorher fehlte im
  Einzugsmonat das ganze Soll, und im Auszugsmonat meldete `prepayment.arrears` einen Rückstand,
  den es nicht gab. #281 (Übertrag, Tilgung nach § 366 BGB) baut auf dieser Funktion auf; die
  Verteilung der Zahlungen bleibt dort.
  **Nur die Miete** (#280): Jede Zahlung hat eine Art (`payments.kind`, `rent` oder `settlement`,
  Vorgabe `rent`; fehlt sie im Schnappschuss, gilt Miete, `isRentPayment` in calc.ts). Nachzahlung
  und Guthaben aus der Abrechnung (Guthaben negativ) verteilt das Mietkonto nicht, sondern führt sie
  in `settlementYearCents` je Zeile und in `settlementOnly` für Mietverhältnisse ohne Tag im Jahr
  (meist nach dem Auszug; eigene Liste, weil eine Zeile ohne Soll in `costModels` mitzählte). Auch
  „wird das Mietkonto geführt“ (`prepayment.arrears`) und „ohne Zahlung“ (`tenanciesWithoutPayment`)
  fragen nur Mietzahlungen. Die Steuerübersicht zählt beide Arten im Ist (§ 11 Abs. 1 EStG) und
  nennt `settlementBackPaymentsCents` und `settlementRefundsCents` daneben, mit dem Saldo für Zeile
  21 nur in den belegten Jahren (siehe unten). Die Oberfläche (client/src/paymentForm.ts) zeigt die
  Abrechnung nach dem Vorhandensein solcher Zahlungen, nicht nach ihrer Summe, lässt die Art einer
  erfassten Zahlung umstellen (erst nach Rückfrage, `kindChangeQuestion`: Mit den Pfeiltasten
  wechselt ein Auswahlfeld seinen Wert schon beim Durchgehen der Tabelle), beginnt ohne
  Mietverhältnis im Jahr mit „Abrechnung“ und fragt nach, bevor eine Miete ohne Zeile im Mietkonto
  gespeichert wird. Ein mit der Miete verrechnetes Guthaben ist volle Miete plus negative
  Abrechnung, sonst stünde der Monat offen und der Zufluss zu niedrig. Die Kaution gehört nicht
  dazu (#228). Spalte und Bedingung in zwei Schritten (0058/0059); der eingefrorene Eingang kennt
  die Spalte nicht, die Vorgabe gibt sie.
- **Steuer/Anlage V** (`taxReport`): aggregiert Einnahmen (das Soll aus `rentLedger`, das Ist
  unmittelbar aus den Zahlungen) und
  Werbungskosten (Kostenpositionen nach `ANLAGE_V_GROUP`-Mapping), liefert §35a-Summe,
  Gesamtfläche und selbstgenutzte Fläche in Quadratmetern (#68: **das Private wird gemessen, nicht
  das Vermietete**, denn nur das ist eindeutig, und die Anlage V fragt genau diese beiden Zahlen
  im Kopf ab; die Grundmenge ist das ganze Gebäude und damit eine andere als die Verteilbasis der
  Abrechnung) sowie den Überschuss. Bewusst beschreibende Gruppen statt fester
  Anlage-V-Zeilennummern.
  **Bei teilweiser Eigennutzung teilt sie jede Position in privat und abziehbar** (#163,
  `splitForTax` in calc.ts, Entscheidungen samt Quellen in
  [docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md](docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md)).
  Direkt zugeordnet gehört eine Position ganz zu ihrer Einheit; nicht umlagefähige Gebäudekosten
  gehen nach der Fläche der betroffenen Einheiten (Teilnehmer, sonst das ganze Objekt wie #68;
  BFH IX R 26/06); **umlagefähige übernehmen den Eigenanteil der Abrechnung** (`landlordParts`
  mit `selfUse`), damit Abrechnung und Steuer dasselbe sagen; **außer** es gibt unter den
  betroffenen Einheiten eine außerhalb der Abrechnungseinheit: Dann gilt bei den Schlüsseln über
  Wohnungen (Fläche, Einheiten, Personen, vereinbart, Gemeinschaft) die Gebäudefläche, denn der
  Eigenanteil der Abrechnung lässt diese Einheit außen vor und ist kein Anteil am ganzen Gebäude
  (`settlementPrivateCents` steht zum Vergleich daneben). Der Hinweis dazu nennt den Abstand **mit
  Richtung** (`excludedAreaDifference`): Beim Flächenschlüssel ist es weniger privat, beim
  Personenschlüssel kann es auch mehr sein. Das ist eine Auslegung: Bei Personen,
  Einheiten, vereinbarten Anteilen und Gemeinschaft rechnet `areaPrivateCents` zum Vergleich nach
  Fläche, und ein Hinweis beziffert den Abstand. Leerstand ist dabei keine Ursache mehr: Seit #177
  bleibt der Anteil einer leeren Wohnung als `vacancy` beim Vermieter, ist nicht privat und bleibt
  bei Vermietungsabsicht abziehbar; der Hinweis sagt das so. Hat die Abrechnung eine Position nicht verteilt
  (`noBasis`), gilt die Fläche. Bei abgeschlossener Abrechnung kommen die Eigenanteile je Position
  aus dem eingefrorenen Stand (`selfUseByItem` in `frozenSettlementOf`), aber nur für Positionen,
  die mit demselben Betrag darin stehen (`itemTotals`); nachgetragene oder geänderte rechnet sie
  heute (`closedItemsChanged`); eine 0-€-Position, für die ältere Versionen keine Zeile schrieben,
  zählt dabei nicht als geändert. Ein Archivstück von vor
  #142 oder eines, dessen Teile nicht die Summe ergeben, verteilt die eingefrorene Summe im
  Verhältnis der heutigen. `abziehbar = Betrag − privat` je Position, Rundung spiegelbildlich
  (und ohne negative Null, die Invariante fand sie). **Der Überschuss rechnet mit
  `deductibleCents`**, `totalCents` bleibt die Bruttosumme. Ohne selbstgenutzte Einheit ist nichts
  privat, und keine Zahl ändert sich (Invariante in calc.test.ts). Die Abrechnung bleibt
  unberührt. „Nicht umlagefähig“ lässt sich im Formular für die Steuer einer Einheit zuordnen
  („Betrifft (für die Steuer)“, gespeichert als `key: 'direct'`) oder bestimmten Einheiten
  (`participantUnitIds`); die Abrechnung liest das nicht.
  AfA, Schuldzinsen, § 82b EStDV, verbilligte Vermietung und ein Nutzungswechsel im Jahr werden
  nicht gerechnet, nur genannt. Zeilennummern der Anlage V nennt die Seite nur, wo der Vordruck 2025
  sie belegt (11, 12, 33/34, 87/88); eine Anleitung 2025 war nicht auffindbar. Dazu Zeile 21
  (Kennzahl 11, Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung, saldiert; Zeile 23 bei
  Angehörigen, Zeile 19) für 2023 bis 2025, je im amtlichen Vordruck des Jahres nachgesehen: 2023
  und 2024 im Formular-Management-System der Bundesfinanzverwaltung („2023AnlV101NET – September
  2023 –“, „2024AnlV101NET – September 2024 –“), 2025 bei der Finanzverwaltung NRW („2025AnlV101 –
  September 2025 –“), jeweils Seite 1; Fundstellen an `settlementLine` in client/src/taxView.ts
  (#280). Für andere Jahre nennt die Seite keine Zeile. **Die Seite zeigt den Zufluss in zwei Teilen,
  die zusammen den Zufluss ergeben** (`paidWithoutSettlementCents` und `settlementBalanceCents`): ohne
  Abrechnung für die Zeilen der Mieten und Umlagen, den Saldo für Zeile 21. Stünde nur der Saldo
  neben dem ganzen Zufluss, trüge mancher beides ein und zählte den Saldo doppelt (Durchsicht zu
  #328). Den Hinweis dazu gibt es nur auf der Ist-Grundlage.
  **Maßgeblich ist das Ist** (#70): § 11 Abs. 1 Satz 1 EStG setzt Einnahmen im Jahr des Zuflusses
  an, ein vereinbartes, nicht gezahltes Soll ist keine Einnahme. Das Soll bleibt umschaltbar, denn
  zum Abgleich taugt es, ist aber nicht mehr die Vorgabe; die Entscheidungslogik samt Hinweisen
  steht in [client/src/taxView.ts](client/src/taxView.ts). Dass die Vorgabe früher das Soll war,
  hatte einen ehrlichen Grund, nämlich eine Zahl auch ohne erfasste Zahlungen — und war genau
  deshalb der schlimmere Ausgang: 0 € sind sichtbar falsch und führen ins Mietkonto, eine
  Soll-Summe ist unsichtbar falsch und wandert in die Steuererklärung. Dieselbe Abwägung wie beim
  `?? []` an der Schnappschuss-Grenze.
  **Drei Sichten, drei Zahlen, und nur die Steuerübersicht war falsch.** Die Abrechnung setzt die
  Staffel an und die Jahreskorrektur, wenn sie erfasst ist (`prepaymentOverrides` hat Vorrang);
  maßgeblich ist das tatsächlich Geleistete. Anzusetzen sind die Vorauszahlungen, die der Mieter
  für den Abrechnungszeitraum tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16;
  VIII ZA 2/08); Soll statt Ist ist, wenn beide abweichen, ein inhaltlicher und kein formeller
  Fehler. Nach Ablauf der Frist des § 556 Abs. 3 BGB ist nach Satz 3 die Nachforderung über das
  Ergebnis einer rechtzeitig erteilten Abrechnung hinaus ausgeschlossen, ohne rechtzeitige
  Abrechnung die Nachforderung über die vereinbarten Vorauszahlungen hinaus (VIII ZR 190/06;
  VIII ZR 261/06); eine erteilte
  Abrechnung lässt sich danach grundsätzlich nicht mehr zulasten des Mieters korrigieren, auch
  nicht bei zu hoch angesetzten Vorauszahlungen (VIII ZR 133/10, Rn. 12 f.; Ausnahme bei einem auf
  den ersten Blick erkennbaren, kurz nach Fristablauf berichtigten Fehler, Rn. 15). Das
  Mietkonto führt das monatliche Soll, denn eine Jahreszahl auf zwölf Monate zu verteilen wäre
  erfunden. `taxReport` führt beide nebeneinander (`prepaymentSollCents` und
  `prepaymentSettlementCents` samt `prepaymentOverridden`) und **entnimmt die zweite der
  Abrechnung**, statt die Staffel ein zweites Mal auszulegen; bei abgeschlossener Abrechnung gilt
  ihr eingefrorener Stand, dieselbe Regel wie beim Eigenanteil und aus demselben Grund. Die
  Oberfläche erklärt den Abstand, **sobald es ihn gibt, und schreibt ihm keine Ursache zu**: Er
  entsteht aus der Jahreskorrektur und ebenso daraus, dass die Abrechnung nur über Wohnungen der
  Abrechnungseinheit verteilt, während das Mietkonto jedes Mietverhältnis führt. Die Durchsicht
  hat gemessen, dass von 1.500 € Abstand nur 600 € aus der Korrektur kamen; ein Kausalsatz wäre
  dort zu 60 Prozent falsch gewesen.
  **Das Ist kommt nicht aus dem Mietkonto**, sondern zählt jede Zahlung mit Datum im Jahr. Das
  Mietkonto bildet Zeilen nur für Mietverhältnisse mit Überlappung, und dadurch fielen zwei
  alltägliche Fälle aus **beiden** Jahren: die Dezembermiete, die im Januar eingeht, nachdem das
  Mietverhältnis am 31.12. endete, und der Dauerauftrag, der die Januarmiete am 30.12. bucht.
  Für das Mietkonto ist die Zeilenbindung richtig, für eine Zahl nach dem Zuflussprinzip nicht.
  Die Zehn-Tage-Regel des § 11 Abs. 1
  Satz 2 EStG bleibt ein Hinweis in der Oberfläche und wird nicht gerechnet: Sie hängt an der
  vertraglichen Fälligkeit, die Mietfuchs nicht kennt, und ein Feld dafür machte eine Zahl der
  Steuererklärung davon abhängig, dass jeder Nutzer es richtig ausfüllt. Das Beispiel dort ist
  bewusst die vorab gezahlte Januarmiete: Die Dezembermiete ist nach § 556b Abs. 1 BGB im
  Dezember fällig, bei ihr greift die Regel also gerade nicht.
  **Die Kopfzeilen der Anlage V, die am Mietmodell hängen** (#96): `costModels` zählt die
  Mietverhältnisse des Jahres, ganz inklusiv (kalt und warm; ohne Heizposition im Jahr zählt nur
  kalt), teilweise inklusiv und mit Pauschale. Daraus entscheidet `taxView.ts` die Hinweise zu
  Zeile 24 und Zeile 20; die Zuordnung der Pauschale zu Zeile 20 ist eine Auslegung und steht als
  solche da.
  **Dem Abflussprinzip folgen die Werbungskosten nur mit Zahlungsdatum** (#255, PR 3). Die
  Kostenposition trägt optional `paidOn` (Spalte `paid_on`, „Bezahlt am (für die Steuer)“), das
  Datum der ganzen Zahlung. Das Steuerjahr bestimmt allein `outflowShares` in
  [server/src/outflow.ts](server/src/outflow.ts), Rangfolge Zahlungsdatum, dann `taxYear`, dann das
  Jahr des Beginns des Zeitraums; die Rangfolge selbst steht als `statedOutflowYear` in
  [shared/paidOn.ts](shared/paidOn.ts), damit Formular und Schreibwege (Wechsel des Zeitraums und
  der Heizperiode, Heizposition aus der Belegbuchung, Übernahme aus dem Vorjahr) dasselbe meinen.
  Keine andere Stelle leitet ein Steuerjahr aus `taxYear` oder `paidOn` ab; nur zur Auswahl lesen
  `taxPartsFor` (Suchfenster) und die Rückfrage „Jahr der Zahlung“ beim Aufteilen in Kosten.tsx das
  Jahr des Datums. `taxPartsFor` sucht
  zusätzlich in den Zeiträumen jeder Position, die im Steuerjahr bezahlt ist, auch nach dem Jahr
  (vorab bezahlt) und Jahre davor (späte Nachzahlung); der private Teil kommt aus der Abrechnung
  ihres Zeitraums. Ein Datum, das das wirksame Jahr ändert, einem gesetzten `taxYear` widerspricht
  oder außerhalb von Beginn − 1 bis Ende + 3 liegt, wird nur mit `confirmPaidOn: true` gespeichert
  (`PaidOnQuestion`, 409 mit `question: 'paidOn'`; dieselben Sätze zeigt das Formular). Beim Aufteilen
  zählt jeder Teil mit seinem eigenen Zeitraum (eine Jahresversicherung 07/2025 bis 06/2026, bezahlt
  am 01.07.2025, ändert das Jahr des Teils 2026): Server und Formular fragen dafür mit denselben
  Teilen der Vorschau (`splitPaidOnQuestions`, die Vorschau nennt je Teil `startYear`/`endYear`).
  Kommt trotzdem eine 409 mit `question: 'paidOn'`, zeigt das Formular sie als Rückfrage und
  wiederholt mit Bestätigung. Beim Wechsel des
  Abrechnungszeitraums behält eine datierte Position ihr Steuerjahr (`keepsTaxYear` in
  periodChange.ts): keine Frage nach dem Jahr, keine angekündigte Verschiebung. Kein Datum
  bei `external` (Hausgeld, abgelehnt mit Hinweis) und am Abzug beim Betriebsstrom (geleert, er
  folgt seiner Rechnung, auch deren Datum). Die Belegbuchung belegt es nie vor: Das Rechnungsdatum
  ist kein Zahlungsdatum. Teilzahlungen bildet das Datum nicht ab, die kommen mit #292 über
  dieselbe Funktion, und eine verknüpfte Abbuchung ist dort ein Nachweis, keine zusätzliche
  Zahlung. Die Zehn-Tage-Regel ist nur ein Hinweis im Formular (Datum zwischen 22.12. und 10.01.,
  nie bei der Grundsteuer). **Ohne Datum gilt weiter das Abrechnungsjahr**: Die Grundsteuer 2025,
  im Februar 2026 gezahlt, steht dann in der Anlage V 2025, obwohl sie nach § 11 Abs. 2 EStG in
  2026 abfließt; die Gleichheitsinvariante und die Prüfsummen in outflow.test.ts halten fest, dass
  ohne Datum keine Zahl wandert. Die db.json kennt das Feld nicht, Umstieg und alte Backups
  ergeben `NULL`.
  **Die Steuerübersicht zeigt die Verschiebung** (#255, PR 4), nur als Auskunft: `shiftNotes` in
  calc.ts liest dieselbe Antwort von `outflowShares` noch einmal und rechnet nichts. Verschoben
  heißt, das Jahr der Zahlung liegt außerhalb der Kalenderjahre, die der Zeitraum der Position
  berührt (bei Mai bis April ist 2026 für 2025/2026 keine Verschiebung, 2027 schon). Jede Position
  trägt `outflow` (Jahr und Quelle `paid`, `stated`, `period`, `bill`), eine verschobene dazu
  `settlementPeriod` („aus Abrechnung 2025, bezahlt am …“); umgekehrt nennt `movedOut` die
  Positionen der Zeiträume, die im Jahr beginnen und anderswo stehen. Jede Verschiebung steht so
  auf jeder Seite genau einmal (Invariante in calc-steuer-verschiebung.test.ts). `unstatedCount`
  zählt die Positionen ohne Angabe, aber nur, wo das Formular ein Datum anbietet (`allowsPaidOn`),
  und ergibt einen ruhigen Satz. Ein Datum außerhalb von Beginn − 1 bis Ende + 3 trägt
  `outsideSpan`: Ein späterer Wechsel des Zeitraums fragt nicht neu (Durchsicht von PR 3, K8), die
  Übersicht nennt es stattdessen. Die Texte stehen in taxView.ts (`movedInLines`, `movedOutLines`,
  `unstatedText`); die Übersicht.csv im Steuer-ZIP hat dafür die letzte Spalte „Jahr der Zahlung“.
  Die Prüfsummen (`taxFingerprint`) lesen die neuen Felder nicht. Eine Heizposition unter eigener
  Heizperiode nimmt ihren Zeitraum aus der Heizperiode (`plantRules`), nie nach dem Schlüssel: Ein
  Rumpf am Wechsel des Rhythmus kann denselben Schlüssel tragen. Über alle Steuerjahre ändert ein
  Datum weder den Gesamtbetrag noch den privaten Teil
  ([invariant-steuer-summe-zahlungsdatum.test.ts](server/test/invariant-steuer-summe-zahlungsdatum.test.ts)),
  auch nicht den der Ausgleichszeilen beim Betriebsstrom (bis auf einen Cent Rundung je Zeile): Ihr
  Heizanteil (`plantHeatQuota`) kommt aus den Heizpositionen des Teils, die ohne Zahlungsdatum im
  selben Steuerjahr stünden wie der Betriebsstrom (`heatPool`, `yearWithoutDate`), nicht aus denen,
  die per Datum im Steuerjahr stehen. Vorher wichen über alle Jahre bis 55,78 € ab. Trägt eine
  Position eines Zeitraums über zwei Kalenderjahre nur ein Datum, gilt dafür das Jahr des Datums,
  geklemmt auf Beginn bis Ende + 1 wie ein `taxYear` (`asStatedYear`): Jahr der Zahlung t und Datum
  im Jahr t ergeben dieselbe Übersicht. Offen bleibt die Regel „alle Heizpositionen der Anlage im
  Zeitraum, unabhängig von Datum und Jahr“; sie änderte veröffentlichte Zahlen bei Mai bis April.
  **Betriebsstrom: die Stromrechnung zählt genau einmal** (#268). Eine Heizposition `included`
  („steckt auch in der Stromrechnung“) und ein Abzug beim Allgemeinstrom (`operatingPower:
  'deduction'`) sind beide nur Ausschnitte derselben bezahlten Stromrechnung, keine eigene Zahlung.
  Summiert mit Vorzeichen stand der Strom als G − Σ Abzug + Σ Heizposition da: Ein selbst
  getragener Abzug ohne Gegenstück senkte die Werbungskosten wie eine Gutschrift, eine Heizposition
  über dem Abzug zählte doppelt. `operatingPowerBalance` (server/src/operatingPower.ts) rechnet je
  Steuerjahr **C = Σ Betrag der Abzüge − Σ Betrag der Heizpositionen `included`**, über alle
  Positionen des Steuerjahres, **mit Vorzeichen und ohne Klemme**, und `taxReport` stellt C als
  abgeleitete Zeile `operating-power-balance:<Jahr>` beim Allgemeinstrom dazu
  (`TaxExpenseItem.operatingPowerBalance`). Damit ist der Strom in jedem Jahr die bezahlte Rechnung,
  auch wenn Abzug und Betriebsstrom in verschiedenen Steuerjahren stehen (deshalb entfielen der Hinweis
  `heating.operating-power-tax-year` und der Satz zur Verschiebung in der Vorschau des Zeitraumwechsels). **Seit #267
  steht der Abzug im Steuerjahr seiner Stromrechnung**: Stand er in einem anderen, blieb dort ein privater Rest, weil
  sein privater Teil dem Schlüssel der Rechnung folgt und der von C dem Heizanteil (Beispiel B2 im Plan zu #255, Test in
  calc-steuer-betriebsstrom.test.ts). Auseinander liegen können nur noch Abzug und Heizposition; die Heizposition und
  ihr Beitrag zu C heben sich in ihrem Jahr auf, im Betrag wie im privaten Teil. **Ein verknüpfter Abzug nimmt den
  Heizanteil aus dem Teil, in dem seine Heizposition steht**, nicht aus dem Teil, in dem er selbst steht (Durchsicht
  von #255 PR 2, M1): Steht sie in einem anderen Steuerjahr, rechnet `foreignHeatQuota` in calc.ts deren Teil und
  Aufteilung wie die Steuerübersicht jenes Jahres. Vorher galt im Jahr des Abzugs der Heizanteil dort und ohne
  Heizkosten dort die Fläche; über beide Jahre fehlte dann privat der Unterschied (gemessen 26,67 €). So ist der
  private Teil über alle Steuerjahre zusammen derselbe, gleich wo Rechnung, Abzug und Heizposition stehen (Invariante
  S1 in invariant-betriebsstrom-steuer.test.ts); stehen Abzug und Heizposition im selben Teil, ändert sich nichts.
  Dafür löst `taxReportFor` den Verweis über alle Positionen des Objekts auf (`linkable`), denn der Schnappschuss
  kennt nur sein Jahr (Durchsicht M1 zu #268).
  Zeilenname und Texte folgen der Lage (`operatingPowerBalanceKind`): „selbst getragen“ nur beim Abzug ohne Verweis,
  „prüfen“ nur, wenn Abzug und Betriebsstrom im selben Steuerjahr verschieden hoch sind;
  eine Sonderregel für
  Verweise über Jahre gibt es bewusst nicht (eine Klemme bei 0 und „anderes Jahr neutral“ waren
  beide nachgemessen falsch). Ausgenommen sind Abzüge **ohne Verweis**, wenn eine Anlage mit
  Messdienst den Zeitraum berührt (`serviceReceivesOperatingPower` in shared/operatingPower.ts,
  dieselbe Frage wie im Kostenformular): Dann ist der Betrag nach Angabe des Nutzers dem Messdienst
  gemeldet und steckt in dessen Betrag. Mietfuchs folgt dieser Angabe; ist in Wahrheit nichts
  gemeldet, fehlt der Betrag, und das ist eine bekannte Grenze. Heizt im Zeitraum zugleich eine
  Anlage ohne Messdienst (Kesseltausch), nennt die Seite den Abzug als nicht eindeutig
  (`operatingPowerAmbiguous`). Ohne Messdienst heißt dieselbe Wahl im Formular „Ja, ich lege ihn
  nicht um und trage ihn selbst“ (`OPERATING_POWER_KEPT`). **Der private Teil folgt dem
  Heizanteil**: jeder Beitrag zu C mal Eigenanteil an den Heizkosten seiner Anlage in der Abrechnung
  seines Teils, so wie die Übersicht diese Heizpositionen aufteilt (bei abgeschlossener Abrechnung
  also eingefroren); dann ergibt ein verknüpfter Abzug über dem Betriebsstrom dasselbe wie das richtige Paar. Ohne
  zuordenbare Anlage (Abzug ohne Verweis) gilt die Fläche des ganzen Gebäudes (BFH IX R 26/06); das kann vom Paar
  abweichen, etwa wenn die Anlage die eigene Wohnung gar nicht heizt. Beides ist
  Auslegung und steht so im Rechenweg und auf der Seite. Die Zeile geht nicht durch den eingefrorenen
  Stand (`closedItemsChanged` bleibt), nicht in `selfUsedShareCents` und steht im Steuer-ZIP ohne
  eigenen Beleg. Negativer Allgemeinstrom **ohne** Kennzeichnung bleibt, wie er ist (Gutschrift und
  Abzug sind nicht zu unterscheiden), die Seite weist nur darauf hin (`unmarkedPowerCredits`). Die
  Abrechnung an die Mieter bleibt unberührt. Zusicherungen in
  [calc-steuer-betriebsstrom.test.ts](server/test/calc-steuer-betriebsstrom.test.ts) und als
  Invariante in [invariant-betriebsstrom-steuer.test.ts](server/test/invariant-betriebsstrom-steuer.test.ts).

**Das Datenmodell steht in [shared/types.ts](shared/types.ts)** (Unit, Tenancy, Meter, Reading,
CostItem, Settings, Settlement …) und gilt für Server und Client gleichermaßen. Die Datei
enthält ausschließlich Typen und keinen Laufzeitanteil; beide Seiten importieren sie
unmittelbar, deshalb kann eine Änderung am Modell nicht mehr nur auf einer Seite ankommen.
Der Ordner hat bewusst **keine eigene `package.json`** (Vite sucht darüber die Wurzel des
Arbeitsbereichs); stattdessen trägt die Wurzel-`package.json` `"type": "module"`. Ohne dieses
Feld gälte `shared/types.ts` für den Übersetzer als CommonJS, und ein gemeinsamer Helfer neben
den Typen wäre dort gar nicht zu schreiben: `tsc` lehnte ihn mit TS1287 ab, und Node lüde die
Datei nur über einen Notpfad mit der Warnung `MODULE_TYPELESS_PACKAGE_JSON`.

Die Grenze zu [client/src/types.ts](client/src/types.ts) hängt an einer einzigen Frage:
**Brauchen beide Seiten dasselbe?** Nur dann gehört ein Typ, ein Feld oder ein Wert eines
Aufzählungstyps nach `shared/`, denn nur dann kauft man sich damit etwas ein, nämlich dass eine
Änderung nicht auf einer Seite ankommt und auf der anderen nicht. Was nur eine Seite kennt,
bleibt bei ihr, und zwar auch dann, wenn es über die Leitung geht: `Db` und `ComputedSettlement`
im Server, die Formularzustände im Client, und ebenso `ClientSettings` in server/testing/api.ts, das genau
die Antwort von `GET /api/settings` beschreibt und trotzdem nur den Server etwas angeht, weil
der Client sie nie so liest.

Beim Client bleibt deshalb auch alles, was die Oberfläche aus dem Modell macht: die
Beschriftungen (`UNIT_USAGE_LABELS`, `METER_TYPE_LABELS`, `CATEGORIES`) und die Helfer
(`usageOf`, `matchCategory`, `defaultKeyFor`). Seine Datei reicht das gemeinsame Modell per
`export type *` weiter, sodass die Importe der Seiten unverändert auf `../types` zeigen; der
Server importiert `shared/types.ts` unmittelbar.

Die `KEY_LABELS` existieren bewusst doppelt: calc.ts liefert die Beschriftung, die auf der
fertigen Abrechnung steht, client/src/types.ts eine eigene für die Eingabe-Oberfläche.

**KI-Belegauswertung**: optional, gegen **Ollama** oder einen **OpenAI-kompatiblen Dienst**
(#18). Die KI macht nur Vorschläge, übernommen wird erst nach manueller Prüfung. Aufgeteilt in:
- [server/src/extract.ts](server/src/extract.ts): das Fachliche, also Prompts, JSON-Schemas,
  Ablauf (Auswertung, zweiter Durchgang nur für Kostenarten, Belegart, Zählerstand) und
  Zeitlimits je Schritt. Die Kategorie-Enums dort und `CATEGORIES`/`matchCategory` in
  client/src/types.ts müssen zusammenpassen.
- [server/src/ai/settings.ts](server/src/ai/settings.ts): das Datenmodell `settings.ai` mit den
  Plätzen `text` (Standard) und `images` (eigener Anbieter für Fotos und Scans), den
  Einstellungen für Fortgeschrittene, der Migration aus `ollamaUrl`/`ollamaModel`, den
  Umgebungsvariablen und der Regel, was als extern gilt (`isExternalUrl`, `consentProblem`).
- [server/src/ai/presets.ts](server/src/ai/presets.ts): die Vorlagen (Ollama lokal, entfernt,
  Cloud, OpenAI, IONOS, Mistral, LM Studio, eigener Dienst) mit Adresse, Bedarf an einem
  Schlüssel, Feldname für die Antwortlänge, Temperatur, `json_object` und Links. Sie belegen
  nur vor, geändert werden darf alles.
- [server/src/ai/index.ts](server/src/ai/index.ts): die Schnittstelle der Anbieter,
  `json({ prompt, images, schema, timeoutMs, signal, onProgress }) → { data, stats }`, dazu die
  Wahl des Platzes je Beleg (Bilder → `images`, falls eingerichtet) und die Durchsetzung der
  Bestätigung vor jeder Anfrage.
- [server/src/ai/openai.ts](server/src/ai/openai.ts): Chat-Completions-Schnittstelle als
  SSE-Strom. Schickt immer eine Antwortlänge (IONOS nimmt sonst 16 Token), Temperatur 0 außer
  bei OpenAI, und JSON in Stufen: striktes Schema, Schema ohne `strict`, `json_object` mit
  Schema im Prompt (nicht bei LM Studio), nur Prompt. Lehnt ein Dienst etwas ab, probiert das
  Modul die nächste Möglichkeit und merkt sie sich je Adresse und Modell. Fehlerformate von
  OpenAI, Mistral, IONOS und Ollama werden gleich gelesen, ein Schlüssel erscheint nie in einer
  Meldung.
- [server/src/secrets.ts](server/src/secrets.ts): API-Schlüssel je Platz in `data/secrets.json`
  (unter Unix 0600), nie in `GET /api/settings` und nicht im Backup. `NKA_AI_API_KEY` oder
  `NKA_AI_API_KEY_FILE` (Docker-Secret) haben Vorrang.
- [server/src/ai/ollama.ts](server/src/ai/ollama.ts): Transport und Eigenheiten von Ollama.
  Streamt `/api/chat`, setzt `think: false` und einen festen Kontext (`num_ctx` 16384, sonst
  kürzt Ollama bei unter 24 GB Grafikspeicher auf 4096 Token; ein wechselnder Wert lädt das
  Modell neu). Lehnt ein Modell `think: false` ab, wie manche bei Ollama Cloud, geht die
  Anfrage einmal ohne das Feld. Prüft über `/api/show`, ob das Modell Bilder versteht und ob
  Ollama es an einen Cloud-Dienst weiterreicht (eine Minute gemerkt), und übersetzt Fehler in
  Meldungen für die Oberfläche (nicht erreichbar, nicht installiert, Schlüssel, Zeitlimit,
  abgeschnittene Antwort). Dazu Modellliste und Suche nach Ollama unter üblichen Adressen.
- [server/src/ai/http.ts](server/src/ai/http.ts): Verbindung ohne die 300-Sekunden-Grenze von
  `fetch` (Node und Bun brechen ab, wenn so lange keine Antwort-Header kommen, Ollama schickt
  sie erst mit dem ersten Token). Unter Node über `node:http(s)`, unter Bun über `fetch` mit
  `timeout: false`. Für KI-Anfragen deshalb nicht `fetch` direkt nehmen.
- [server/src/extractHeating.ts](server/src/extractHeating.ts) (Heizung PR 20, #103): Messdienstabrechnung
  und Lieferantenrechnung, über `POST /api/heating-plants/:id/service-statement` (nur bei `method:
  'service'`) und `…/fuel-invoice`, als derselbe Strom wie `/api/extract`; Text und Seitenbilder stellt
  `documentMaterial` aus extract.ts zusammen, für jede Belegart gleich. Je Belegart **ein** Ausgang
  (`toServiceExtraction`, `toFuelExtraction`) und kein eigener Eingang, denn dazwischen rechnet Mietfuchs
  nur Netto-Teilmengen hoch, mit derselben Prüfung `vatExplainsGap` wie #34; die beiden Felder, die Mietfuchs
  selbst setzt (`amountsAdjusted`, `amountsNetUnadjusted`), liest der Ausgang nie aus der Antwort. Die
  Abzugszeile steht oft mit typografischem Minus da und wird als Betrag gelesen. **Gespeichert wird nichts außer
  dem Beleg** (mit Objekt und Jahr aus dem Formular im Posteingang, bis er an eine Position kommt; eine
  Lieferung hat keinen Beleg), und es entsteht keine Auswertung der Belegbuchung, denn Nutzerzeilen und
  Lieferungen sind keine Rechnungspositionen. Die Seite Heizkosten zeigt den Vorschlag und schreibt über die
  bestehenden Routen, wenn der Vermieter übernimmt: die Karte „Messdienstabrechnung auslesen“
  (`client/src/serviceImport.ts`, `ServiceImportReview.tsx`) und „Rechnung mit KI auslesen“ in der Karte
  „Lieferungen“ (`client/src/fuelImport.ts`). Eine Nutzerzeile wird nur bei genau einem Treffer zugeordnet
  (Name unter den Mietverhältnissen, die den Zeitraum berühren, bei mehreren die Lage; „Leerstand“ und
  „Eigentümer“ an ihren Wörtern). Der Betrag der Heizposition ist S plus Abzugszeile (Entwurf 7.1). Die gefundene
  Abzugszeile steht als Satz neben der Frage, gewählt wird nichts vor (Entwurf 7.2); widerspricht die Antwort
  („nur ausgewiesen“, „gar nicht aufgeteilt“), warnt die Karte. Die CO₂-Angaben werden vorbelegt, nie mit leeren
  Werten überschrieben, und mit der eben angelegten Heizposition verknüpft. Kalte Blöcke einer Komplettabrechnung
  nur, wenn die Heizperiode dem Objektzeitraum gleicht (Festlegung, Leistungsprinzip; Einzelbeträge lassen sich
  nicht nach Tagen teilen). Reicht der Zeitraum über zwei Kalenderjahre, fragt die Karte je Block nach dem Jahr
  der Zahlung, wie `requireTaxYear` es verlangt. Bei der Lieferantenrechnung übernimmt das Formular den
  Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG nur, wo der Server ihn annimmt (`bioAccepted`: Heizung
  nach § 43 Abs. 1 GModG, nicht aus dem Vorrat, nicht ab der Grenze von § 5a Abs. 3 Nr. 3), und nennt sonst den
  Grund; beim Vorrat bleiben Rechnungszeitraum und Teilmengen leer. Bei freien Schlüsseln nimmt eine Lieferung
  keinen Betrag an, dann nennt die Karte ihn als Satz. Vorbelegt wird nur, was die Karte zeigt (CO₂-Angaben
  nach `asksCo2Facts`, Bezug der kWh nur bei Gas, Heizwert nur beim Vorrat); was gelesen, aber nicht
  übernommen wird, nennt `fuelChecks` als Satz, sonst ginge ein ungesehener CO₂-Betrag in den Rumpf und
  löste eine Aufteilung aus. Den Energiegehalt einer Lieferung aus dem Vorrat übernimmt das Formular nicht,
  denn dort rechnet Mietfuchs mit verbrauchter Menge × Heizwert (§ 9 Abs. 3 HeizkostenV); der Satz dazu
  prüft Menge × Heizwert gegen den Energiegehalt (mehr als 1 % Abstand). Erneut ausgelesene Abrechnungen:
  Heizblock und kalte Blöcke mit vorhandenen Einzelbeträgen sind nicht vorgehakt, und Anlegen fragt nach.
  `PUT …/hot-water` ohne `dhwUnmeasurable` lässt die Bestätigung derselben Formel stehen.

**Rohe Antwort und Zusage: zwei Beschreibungen, eine Grenze** (#63). Die Auswertung eines Belegs
durchläuft zwei Stadien, und jedes hat seinen eigenen Typ. `RawExtraction` und `RawPosition` in
[server/src/invoiceAmounts.ts](server/src/invoiceAmounts.ts) beschreiben die rohe Antwort des
Modells: Dort ist alles `unknown`, denn ein Modell kann statt einer Zahl auch „neunzehn“
schicken, und ein engerer Typ wäre eine Behauptung, die niemand einlöst. `Extraction` in
[shared/types.ts](shared/types.ts) beschreibt, was der Browser bekommt, mit engen Typen. Was der
Server selbst rechnet (`amountsAdjusted`, `laborFromTotal`), nimmt seinen Typ von dort, damit das
Paar nicht auseinanderlaufen kann.

Überschritten wird die Grenze nur an zwei benannten Stellen in
[server/src/extract.ts](server/src/extract.ts). `rawFromAnswer` ist der Eingang: Es nimmt dem
Modell die beiden Felder aus der Hand, die Mietfuchs selbst rechnet, und liest Beträge, die als
Text dastehen, mit `numberFromModel` (dieselbe Funktion wie beim Zählerstand, deutsche wie
technische Schreibweise, und was mehrdeutig ist, bleibt ungelesen). `toExtraction` ist der
Ausgang und die einzige Stelle, an der die Zusage entsteht. Geprüft wird dort bewusst nur, was
die Oberfläche wirklich braucht; eine vollständige Prüfung der Modellantwort gehört ausdrücklich
nicht dazu, denn die KI schlägt vor und ein Mensch prüft jede Position, bevor sie übernommen
wird. Verworfen wird nur, was niemand gebrauchen kann: Ein Betrag, der keine Zahl ist, fehlt
danach, und das leere Feld füllt der Mensch aus. Vorher stand dort ein `as Extraction`, und diese
Behauptung brach: Fehlte ein Betrag, rief die Oberfläche `toLocaleString` auf einem `undefined`
auf und zeigte statt des Vorschlags einen Fehler. Erreichbar ist das, obwohl das Schema den
Betrag verlangt, weil die Anbindung bei Ablehnung stufenweise bis auf „nur Prompt“ zurückfällt.

Dass ein Betrag fehlen darf, hat eine Folge für das Geraderücken in
[server/src/invoiceAmounts.ts](server/src/invoiceAmounts.ts). Fehlt eine Position, liegt die
Positionssumme unter dem Rechnungsbetrag, und die Bedingung zum Hochrechnen griffe erst recht;
verteilt würde dann der ganze Rechnungsbetrag auf die übrigen Positionen. Das Ergebnis wäre das
gefährlichste, das hier entstehen kann: Die Summe passt zum Beleg, jede einzelne Position ist zu
hoch, und beim Prüfen fällt nichts auf.

Die Antwort darauf ist `vatExplainsGap`, eine Prüfung mit einem Namen: **Lässt sich der Abstand
zwischen Positionssumme und Rechnungsbetrag durch Umsatzsteuer erklären?** Gemessen wird gegen
den Regelsatz von 19 Prozent plus eine halbe Prozentstelle für Rundung, nicht gegen eine
großzügige Obergrenze, denn eine Nettorechnung hat genau diesen Abstand und keinen beliebigen.
Nach unten ist alles bis 0 möglich, weil eine Rechnung ermäßigte und steuerfreie Anteile mischen
kann, und ein Rechnungsbetrag unter der Positionssumme ist eine Abschlagszahlung, kein fehlender
Posten. Eine Obergrenze von 30 Prozent ließe bei 19 Prozent Steuer eine fehlende Position von 9
Prozent durch und bei 7 Prozent eine von 21; gegen den Regelsatz gemessen fällt bei 19 Prozent
schon ein fehlendes halbes Prozent auf. Nötig ist die Prüfung, weil das Schema den Betrag als
Pflichtzahl verlangt: Ein Modell, das ihn nicht lesen kann, schreibt eher eine 0 oder lässt die
Position weg, als eine Lücke zu lassen. Der Rest des Bandes bleibt offen: Bei 7 Prozent Steuer
kann eine fehlende Position von bis zu 10 Prozent durchgehen, weil sich der Abstand dann immer
noch wie eine Steuer liest.

Dazu muss jeder Betrag gelesen sein (`null` aus `toCents` heißt „nicht gelesen“ und ist etwas
anderes als 0: Eine Position kann laut Rechnung nichts kosten). Beides gilt für das Hochrechnen
wie für den §35a-Lohnanteil aus einem Gesamtbetrag, denn auch er gehört zur ganzen Rechnung; sonst
bekämen die vorhandenen Positionen den Anteil der fehlenden mit dazu, und weil eine Position ohne
Betrag nicht übernommen wird, stünde am Ende zu viel §35a in der Steuerübersicht. Zu streng darf
es dort aber nicht sein, denn ein ausbleibender Lohnanteil kostet denselben Nutzer dieselbe
Steuer. Hochgerechnet wird immer anteilig auf den Rechnungsbetrag und nie mit einem genannten
Steuersatz: Bei richtigem Satz kommt dasselbe heraus, bei falschem verteilt das Restverfahren die
Differenz reihum, bis hin zu einem negativen Betrag. `vatRatePercent` wird deshalb nirgends mehr
gelesen. Jede dieser Bedingungen hat einen Test, der rot wird, wenn genau sie fehlt.

PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
([client/src/pdfIntake.ts](client/src/pdfIntake.ts)) und schickt die Textebene im Feld
`pdfText` mit, bei Scans ohne brauchbare Textebene (unter 80 Zeichen) bis zu vier Seiten als
JPEG im Feld `pages`. Die Seitenbilder bleiben im Arbeitsspeicher (gemischter multer-Speicher
in index.ts) und landen nicht im Belegordner. So braucht der Server kein natives Modul:
`pdf-to-img` scheiterte in der Bun-Programmdatei, weil pdf.js dort `@napi-rs/canvas` nicht
findet (#21). Intern laufen Bilder als `{ mimeType, data }`.

`/api/extract` und `/api/intake` antworten mit `Accept: application/x-ndjson` als Strom: Header
sofort, dann Zeilen mit `progress`, `heartbeat` (alle zehn Sekunden) und zuletzt `result` oder
`error`. Grund: Firefox wartet höchstens 300 Sekunden auf Header. Ohne diesen Accept-Wert gibt
es die JSON-Antwort wie früher. Bricht der Browser ab, stoppt der Server die Anfrage an den
Anbieter und löscht den gerade hochgeladenen Beleg wieder. Den Abbruch erfährt er über
`POST /api/ai/cancel/<requestId>` (die Kennung schickt der Browser im Formularfeld `requestId`
mit, beim Schließen des Tabs per `sendBeacon`) und zusätzlich über das Schließen der
Verbindung. Die Kennung ist der verlässliche Weg, denn unter Bun 1.3 kam das Schließen nicht bei
Express an (unter Bun 1.4.2 schon), und ein Proxy kann die Verbindung zum Server offen halten.
Der Smoke-Test prüft die Kennung auf jeder Programmdatei und berichtet zusätzlich, ob das bloße
Schließen ankommt. Im Client liest
[client/src/aiRequest.ts](client/src/aiRequest.ts) den Strom und kümmert sich um den Abbruch,
die Karte der Einstellungen ist [AiSettings.tsx](client/src/components/AiSettings.tsx) mit der
Logik in [client/src/aiForm.ts](client/src/aiForm.ts) und
[client/src/modelForm.ts](client/src/modelForm.ts).

**Bestätigung externer Dienste**: Zeigt die Adresse eines Platzes aus dem Haus, oder reicht ein
lokales Ollama das Modell an einen Cloud-Dienst weiter, schickt der Server erst nach einer
Bestätigung Belege dorthin (`POST`/`DELETE /api/ai/consent`, gespeichert in `ai.consent`). Als
lokal gelten dieser Rechner, private und Link-local-Adressen, Namen ohne Punkt sowie `.local`,
`.lan`, `.home.arpa`, `.internal`, `.intern` und `fritz.box`. Was extern ist, entscheidet allein
der Server; die Oberfläche bekommt es als `aiExternal` in den Einstellungen und zeigt es auch
auf Kosten und Schnellerfassung an.

Routen: `/api/ai/presets` (Vorlagen), `/api/ai/status?slot=text|images` (Modelle des Anbieters,
bei Ollama mit Adresssuche), `PUT /api/ai/key` und `DELETE /api/ai/key/:slot`,
`POST /api/ai/consent` und `DELETE /api/ai/consent/:slot`. `/api/ollama/status` bleibt für Tabs
von vor dem Update und liefert in `models` nur Namen, die Einzelheiten in `modelDetails`. Die
Adresssuche fragt je nach Betriebsart nur Sinnvolles (Docker: Host und Compose-Dienst, sonst
dieser Rechner) und nur, wenn die eingestellte Adresse gar nicht erreichbar war.

Umgebungsvariablen (die Einstellungen zeigen betroffene Felder gesperrt, `fixedByEnv`, in die
db.json gelangen die Werte nicht): `NKA_AI_PROVIDER`, `NKA_AI_URL`, `NKA_AI_MODEL`,
`NKA_AI_API_KEY` bzw. `NKA_AI_API_KEY_FILE`, `NKA_AI_TIMEOUT`, `NKA_AI_MAX_TOKENS`,
`NKA_AI_IMAGE_EDGE`; dazu
`NKA_OLLAMA_URL`, `NKA_OLLAMA_MODEL` und `NKA_OLLAMA_NUM_CTX`, die weiter gelten, solange
Ollama der Anbieter ist. Ein ungültiger Wert verhindert den Start mit klarer Meldung. Einzige
Ausnahme vom Grundsatz, dass Werte aus der Umgebung nicht in die db.json gelangen: Die
Bestätigung merkt sich die Adresse, für die sie gilt, auch wenn diese aus der Umgebung stammt.
Sonst ließe sich später nicht prüfen, wofür sie erteilt wurde. Den Schlüssel des
Bilder-Anbieters gibt es bewusst nur in der Oberfläche, die Umgebung legt nur den Standard fest.
`NKA_OLLAMA_CANDIDATES` ersetzt die Adressen der Suche und ist für Tests gedacht. Das
Compose-Profil `ki` startet Ollama als Dienst `ollama` mit und lädt das Modell über den Dienst
`ollama-pull`.

**Modelle laden und Empfehlungen** (#33): [server/src/ai/recommendations.ts](server/src/ai/recommendations.ts)
hält die Empfehlungsliste. Jede Version bringt eine Kopie mit (`BUILT_IN`, muss mit
[ki-modelle.json](ki-modelle.json) übereinstimmen, ein Test vergleicht beide). Nachgeladen wird
die Datei aus dem Repo nur mit derselben Zustimmung wie beim Update-Hinweis
(`settings.updateCheck === 'on'`), höchstens einmal am Tag, und streng geprüft; unbekannte
Felder fallen weg, eine kaputte Datei ändert nichts. `NKA_MODELS_URL` lenkt die Abfrage auf
einen nachgebauten Server. `GET /api/ai/recommendations` liefert `{ models, updated, source }`.
`POST /api/ai/pull` lädt ein Modell über Ollamas `/api/pull` und antwortet als derselbe Strom
wie die Auswertung (Fortschritt, Lebenszeichen, Abbruch über die Kennung). Nur für ein Ollama
auf diesem Rechner oder im Heimnetz: Dienste im Internet bringen ihre Modelle mit. Vor dem
Download fragt die Oberfläche nach, denn Mietfuchs ist im Heimnetz ohne Anmeldung erreichbar.

**Größe der Seitenbilder** (#35): Ein Scan geht mit `INTAKE_EDGE` Bildpunkten an der langen
Kante an das Modell ([client/src/pdf.ts](client/src/pdf.ts)), der Druck weiter mit Faktor 2 bis
`MAX_EDGE`. Der Wert stammt aus dem KI-Prüflauf, der vier Größen an denselben Belegen verglichen
hat (`--page-edge`, mehrere Werte im Workflow ergeben je Modell einen Lauf pro Größe): Bis 1200
bleibt die Trefferquote gleich, bei 1000 bricht sie bei beiden geprüften Modellen ein, und mehr
als 1200 bringt nichts, kostet aber rund 40 Prozent mehr Eingabe-Token. Dasselbe Band nutzen die
großen Dienste von sich aus: OpenAI stutzt die kurze Kante auf 768 Bildpunkte, Anthropic
rechnet oberhalb von 1568 Token herunter. Wer ein Modell mit anderem Bedarf hat, stellt
`ai.pageImageEdge` unter „Erweitert“ oder per `NKA_AI_IMAGE_EDGE` um (600 bis 2600); die
Oberfläche zeigt dazu den dpi-Wert bei A4.

**KI-Prüflauf** ([.github/workflows/ai-eval.yml](.github/workflows/ai-eval.yml),
[scripts/ai-eval.mjs](scripts/ai-eval.mjs)): vergleicht echte Ollama-Modelle auf GitHub-Runnern
ohne Grafikkarte an erfundenen Belegen in [scripts/ai-eval/](scripts/ai-eval/), je als PDF mit
Textebene, Scan und Foto. Start von Hand oder per Label `ai-eval` an einem PR. Neue
Beispielbelege nur erfunden, nie echte Rechnungen. Die Belege `metering-service`, `gas-supplier`
und `heating-oil` (`kind` in cases.json) laufen über die Routen einer Heizanlage, die der Lauf
anlegt; bewertet wird in [scripts/ai-eval/score.mjs](scripts/ai-eval/score.mjs) mit gepflegter
`score.d.mts` daneben (getestet ohne Modell in `server/test/ai-eval-score.test.ts`), denn
ai-eval.mjs startet beim Laden den Lauf. Das nachgebaute Ollama
([scripts/fake-ollama.mjs](scripts/fake-ollama.mjs)) beantwortet die drei Belege richtig, erkannt am
Schema; so lässt sich die Verdrahtung ohne Modell prüfen.

**Update-Hinweis** ([server/src/update.ts](server/src/update.ts)): Nur mit Zustimmung
(`settings.updateCheck === 'on'`, beim ersten Start im Cockpit gefragt) fragt der Server
`releases/latest` bei GitHub ab, höchstens einmal am Tag je laufender Instanz. Ohne Zustimmung
geht keine Anfrage hinaus, `/api/update` liefert dann nur die installierte Version. Nach einem
Fehler wartet er eine Stunde, bei einem Rate-Limit bis `retry-after` bzw. `x-ratelimit-reset`
(höchstens einen Tag), dann auch für „Jetzt prüfen". „Jetzt prüfen" fragt ohnehin höchstens
einmal pro Minute, gleichzeitige Aufrufe teilen sich eine Anfrage, und Links aus der Antwort
werden nur übernommen, wenn sie ins eigene Repo zeigen. Ein Selbst-Update gibt es nicht: Der
Hinweis führt zu einer Anleitung, bei der Programmdatei mit dem Download der passenden Datei
und Schritten je System, bei Docker und npm mit Befehlen. Die Entscheidungslogik der
Oberfläche liegt in [client/src/update.ts](client/src/update.ts). Ob später ein Updater
dazukommt, ist offen (Issue #20). Die eigene Version liest
[server/src/version.ts](server/src/version.ts) per JSON-Import aus `server/package.json`, den
Bun beim Kompilieren einbettet. Die Betriebsart ergibt sich aus `globalThis.Bun`
(Programmdatei, an einem Systemort `package`, siehe Linux-Pakete) bzw. `NKA_RUNTIME=docker`
(setzt das Dockerfile), sonst `npm`.
`NKA_UPDATE_URL` lenkt die Abfrage auf einen nachgebauten Server. Verglichen wird nach SemVer
mit Vorabversionen (#166): `0.9.0-rc.2` liegt vor `0.9.0`, `rc.2` vor `rc.10`. Ein Tag mit
Vorabversion wird nie angeboten, auch ohne das Kennzeichen `prerelease`; läuft dagegen selbst
ein Kandidat, ist die fertige Version gleicher Nummer ein Update, und die Oberfläche nennt ihn
„Vorabversion“ statt „aktuelle Version“.

**Client** ([client/src/](client/src/)): React ohne Router — `App.tsx` schaltet per State
zwischen den Seiten (`pages/`: Cockpit, Schnellerfassung, Zaehler, Kosten, Mietkonto,
Abrechnung, Uebersicht/Kostenvergleich, Steuer, Stammdaten, Belege, Einstellungen), gruppiert
nach Arbeitsphase in der Sidebar (das Abrechnungsjahr liegt zentral im `YearProvider`,
[client/src/year.tsx](client/src/year.tsx)). Dark Mode über `data-theme` auf `<html>` + CSS-Variablen (Umschalter in der
Sidebar, Druck ist immer hell); PWA-Manifest und Icons liegen in `client/public/` (Icons
erzeugt `server/scripts/make-icons.mjs`).

**Mobile Navigation** (#346, Schritt 9, [MobileNav.tsx](client/src/components/MobileNav.tsx)): Unter
900 px (`MOBILE_QUERY`, dieselbe Grenze wie in index.css) zeichnet App.tsx statt der Seitenleiste einen
angehefteten Kopf (☰, Seitentitel, „Objekt · Zeitraum“, ⇅), ein Menüblatt als `<dialog>` mit
`showModal()` und eine untere Leiste (`BOTTOM_TABS` in nav.ts, kurze Beschriftung `short`). Das Blatt
zeigt **denselben Inhalt wie die Seitenleiste** (`sidebar(close)` in App.tsx), ⇅ öffnet es mit dem Fokus
auf der Objektwahl. Die Wahl einer Seite schließt es; Objekt und Zeitraum wechseln darin **ohne** zu
schließen, wie in der Seitenleiste, denn ein Auswahlfeld sendet bei jeder Pfeiltaste `change`. Eine
Rückfrage (offenes Formular, Beenden) liegt seit Schritt 1 im Top-Layer über dem Blatt; es bleibt dafür
offen, und eine Seite schließt es erst, wenn der Wechsel feststeht. Ein Seitenfenster ist
modal; solange es offen ist, sind Kopf und untere Leiste inert, das Blatt lässt sich darüber nicht öffnen. Der Fokus geht an den Knopf zurück, der es geöffnet hat,
und nach einem Wechsel über die Grenze an die aktuelle Seite bzw. ☰. Gezeichnet wird nach
`matchMedia` und nicht nur per CSS, damit kein Eintrag doppelt im Baum steht; Tests stellen den Query
samt `change` nach (mobileNav.test.tsx) und nehmen für `showModal` den Nachbau aus
[client/src/testing/dialog.ts](client/src/testing/dialog.ts). Tabellen mit Datensätzen werden unter
640 px zu Karten (`<Table className="stacked">`, jede Zelle mit `data-label`), Zahlenraster heften die
erste Spalte an (`sticky-first`), beides nur am Bildschirm. Sicherheitsränder (Kerbe, Home-Indikator) über
`viewport-fit=cover` in index.html und `env(safe-area-inset-*)`, auch an Seitenfenster, Rückfrage, Toasts und
Fuß der Seitenleiste. Wächter in uiRules.test.ts: S24 (was am Fensterrand steht, nimmt die Sicherheitsränder),
S12 (Dialoge nur in erlaubten Bausteinen), S22 (Navigation nur aus nav.ts), S23 (Karten mit `data-label`).

Zentraler Fetch-Wrapper `api()` und Geld-/Datums-Helfer (`parseEuro`, `fmtEuro`, `fmtDate`) in
[client/src/api.ts](client/src/api.ts). Druck/PDF läuft über die Browser-Druckfunktion;
hochgeladene Belege werden für den Druck per **pdf.js** auf Canvas gerendert
([client/src/pdfPreview.ts](client/src/pdfPreview.ts)) — die zugehörigen pdf.js-WASM/Font-
Assets werden im Build via `vite-plugin-static-copy` nach `dist/pdfjs/` kopiert. pdf.js wird
für Druck und Upload über [client/src/pdf.ts](client/src/pdf.ts) geladen, bewusst in der
legacy-Fassung (`pdfjs-dist/legacy/build`): Die moderne setzt die allerneuesten Browser voraus.
Ein Test mit echtem pdf.js ([pdfIntake.pdfjs.test.ts](client/src/pdfIntake.pdfjs.test.ts))
schlägt fehl, wenn jemand auf die moderne Fassung zurückwechselt.

**Stile: Tailwind v4 neben index.css** (#346): Einstieg ist [client/src/tw.css](client/src/tw.css),
eingebunden in main.tsx über `@tailwindcss/vite` (nur Bauzeit, das native `@tailwindcss/oxide`
läuft unter Node beim `vite build`; die Programmdatei bettet fertiges CSS ein). index.css steht
dort vollständig in der Schicht `legacy`, Utilities liegen darüber und gewinnen gegen jede alte
Regel. Weiteres CSS kommt nur über tw.css in eine Schicht; ungeschichtet gewönne es gegen alle.
`!important` in `legacy` gewinnt dagegen gegen jede Utility, auch gegen `!flex` oder `print:`
(bei wichtigen Deklarationen kehrt sich die Reihenfolge der Schichten um); das ist für
`.no-print` und die Ausblendungen im Druck gewollt. `dark:` gilt nur am Bildschirm, denn der
Druck ist immer hell. **Die Tokens in index.css bleiben die einzige Quelle**: `@theme inline` macht sie als
`bg-card`, `text-muted`, `border-line` … benutzbar und wechselt so mit `data-theme` von selbst;
die Standardpalette ist abgeschaltet (`--color-*: initial`). **Kein Preflight**, solange index.css
lebt, denn das bisherige Aussehen beruht auf den Vorgaben des Browsers. Tailwind erzeugt eine
Utility für jedes passende Wort in client/src (Tests ausgenommen), auch in Kommentaren; wo das mit
einer Klasse aus index.css zusammenfällt (`sr-only`, `grow`, `grow-2`), nimmt tw.css sie mit
`@source not inline` heraus, und Animationen in index.css heißen nicht wie eine aus dem Theme
(deshalb `spinner-spin`). Wächter in [uiRules.test.ts](client/src/uiRules.test.ts), die Tailwind
selbst fragen: S4 nimmt Utilities als Regel an, S17 verbietet beliebige Werte (`p-[13px]`) und
die Standardpalette in jedem Wort, das Tailwinds Scanner in .ts und .tsx findet (nicht nur in
`className`), S20 verbietet eine neue Klasse oder Animation in index.css mit
einem Namen aus Tailwind und hält die Zahl der Regelzeilen von index.css als Obergrenze (nur kleiner; Token-Deklarationen zählen nicht, neue Farben gehören als Token-Paar dorthin).
Schritt 0 hat nichts sichtbar geändert: Pixelvergleich alt gegen neu in Chromium, Firefox und
WebKit, hell und dunkel, 1440 und 390 Bildpunkte und im Druck.

**Gestaltung „Mittelweg“ und Tokens** (#346, Schritt 4; Werte und Kontraste in Abschnitt 1 von
[docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md](docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md)):
neutrale zinc-Flächen, weiße Karten mit feiner Linie, helle Seitenleiste; Indigo nur für
Primärknopf, Links, Fortschritt, Fokus, aktiven Menüpunkt und Objekt-Marke. Drei Knopfarten:
`.btn` (primär), `.btn.secondary` und `.btn.ghost` (beide weiß mit Rahmen), `.btn.danger`. Neben
den Farben stehen in `:root` Abstand (`--space-N` = N × 4 px), Schrift (`--text-xs … --text-2xl`),
Gewicht (`--weight-*`), Radius (`--radius-s/m/l/xl`), `--target` (36 px, 44 px bei Finger oder
< 640 px) und `--focus-ring`; tw.css bildet sie mit `@theme inline reference` auf `p-N`, `text-s`,
`font-strong`, `rounded-l`, `shadow-1` ab und entfernt die Standardskalen (auch die Schatten, die feste Farben tragen). Die dunklen Tokens stehen in
`@media not print`, gedruckt wird also immer mit den hellen. **Farben nur in Blöcken mit dem
Selektor `:root`**: S17 verbietet Hex- und rgba-Werte in jeder anderen Regel von index.css und
tw.css, eine neue Farbe kommt als Token-Paar hell/dunkel, und S6 rechnet die Kontraste der
Paare nach (Text, Nebentext, Links, Knöpfe, aktiver Menüpunkt, Hover-Fläche, Hinweise, Feldrand mit 3:1).
Kästchen und Optionsfelder haben eine eigene Fokusregel (Wächter), kleine Knöpfe am Handy eine
Tippfläche von `--target` über `::after`, und printCss.test.ts verlangt den dunklen Block in `@media not print`.

## Konventionen & Fallstricke

- **Sprache im Code.** Bezeichner sind englisch: Variablen, Funktionen, Typen, Datei- und
  Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`,
  `rentLedger`, `buildCostItemBody`). Deutsch bleiben Kommentare, Oberflächentexte,
  Fehlermeldungen, Testnamen, Commit-Nachrichten und gespeicherte Fachwerte (`'vermietet'`,
  `'kaltwasser'`, die Kostenarten). Seitenkomponenten heißen wie die Seite (`Kosten.tsx`).
- **Nutzertexte siezen; README und Entwicklerdoku duzen** (#142). Das gilt für Oberfläche,
  Lexikon, Meldungen des Servers, Konsole und Startmenü, auch für MIGRATION.md, die sich an
  Vermieter richtet. Die Prompts an das Modell sind davon ausgenommen. Ein Wächter
  ([anrede.test.ts](server/test/anrede.test.ts)) sucht im Quelltext nach Du-Formen.
- **Geld immer in Cent als Integer.** Eingabe-Parsing (deutsche + technische Schreibweise) über
  `parseEuro`; Ausgabe über `fmtEuro`.
- **Datums-Logik** rechnet in UTC mit inklusiven Grenzen — beim Anfassen von calc.ts die
  bestehende Konvention beibehalten und gegen [server/test/calc.test.ts](server/test/calc.test.ts)
  prüfen.
- **Nichts in calc.ts hängt an der Locale der Laufzeit** (#70). Ein blankes `localeCompare()`
  liest die Einstellung des Rechners, und dieselben Daten ergäben auf zwei Rechnern zwei
  Reihenfolgen; bei `largestRemainder` entscheidet sie, wer den Rest-Cent bekommt.
  Abgeschafft wird die Sprache deshalb aber nicht, sondern festgenagelt, wie beim Formatieren
  mit `'de-DE'` in derselben Datei. Es gibt zwei benannte Funktionen, und welche gilt, entscheidet
  der Zweck: `compareText` vergleicht Zeichen für Zeichen, wo die Reihenfolge eine Bedeutung
  trägt (Kennungen, ISO-Daten, Staffeln); `compareName` sortiert mit fest eingestelltem Deutsch,
  wo ein Mensch die Liste liest, sonst stünde „Älter" hinter „Zaun". Ein Test prüft den
  Quelltext, denn auf einem einzelnen Rechner sagen beide Ordnungen dasselbe. Wer eine weitere
  Stelle anfasst, die eine Staffel oder Ablesungen sortiert, nimmt `compareText` von hier und
  schreibt den Vergleich nicht noch einmal hin.
- **Eine Meldung steht am Feld und in der Sammelmeldung** (#341, #346 Schritt 3, nach GOV.UK). Eine
  Fehler-API: `useFormError<F>()` mit `<ErrorSummary errors>`
  ([client/src/components/ErrorSummary.tsx](client/src/components/ErrorSummary.tsx)) und `<Field>`
  ([client/src/components/Field.tsx](client/src/components/Field.tsx)); `FormError` aus #343 ist darin
  aufgegangen. Die Prüfungen der umgestellten Formulare liefern `Problem`e
  ([client/src/formProblems.ts](client/src/formProblems.ts)): Feld, kurze Fassung für das Feld („Datum
  fehlt“) und Satz mit Ort für die Sammelmeldung, **alle auf einmal und je mit Feld**, kein Sammelsatz für
  mehrere Felder (M5). So arbeiten `paymentBody`, `buildReadingBody`, `buildUnitBody`, `tenancyRequired`,
  `meterBody`/`meterPlantId`, `propertyBody` und `selfSetupBody` (die letzten drei nennen zusätzlich die
  erste Meldung als `error`, für ältere Aufrufer). Die Kostenposition meldet ihre Felder (Beschreibung,
  Betrag, §35a-Lohn, Ziel) zusammen über `costFieldProblems` in costForm.ts; die übrigen Regeln der
  gemeinsamen Prüfung in shared/costItem.ts geben weiter die erste Meldung, als Satz mit Ort und ohne Feld.
  Die Staffeln des Mietverhältnisses ebenso. `report(problems)` meldet, `show(text)` eine Meldung ohne Feld (die
  Ablehnung durch den Server), `set(text)` ersetzt das frühere `setError`. Jedes Melden setzt den Fokus auf
  die Sammelmeldung und rollt sie ins Bild, auch beim selben Text (`seq`); ein Ladefehler nimmt mit
  `{ focus: false }` keinen Fokus. `role="alert"` sitzt **innen**, der Fokus außen; ein `aria-labelledby`
  trägt das äußere `<div>` nicht (ohne Rolle untersagt, axe `aria-prohibited-attr`). Ihre Zeilen sind Links
  aufs Feld (`idFor`), die einen zugeklappten `<details>` aufklappen. **`<Field label hint optional width>`**
  ist ein `<label class="field">` wie bisher (Raster und Seitenfenster setzen es unverändert) und vergibt
  `id`, `aria-labelledby` (nur die Beschriftung, sonst gehörten Hinweis und Fehler zum Namen),
  `aria-describedby` (Hinweis, Fehler) und `aria-invalid` selbst; `{...errors.field('date')}` reicht `id`,
  Meldung und `onFix` hinein, und `onFix` nimmt die Meldung beim Ändern des Felds an beiden Stellen weg.
  **Pflichtfelder tragen `required`**: ein Sternchen hinter der Beschriftung (für Vorleser ausgeblendet,
  außerhalb des Namens) und das HTML-Attribut `required` am Eingabefeld (Semantik für Vorleser, Browser,
  Autofill). Das Sternchen ist das bekannte Muster für die Zielgruppe; erklärt wird es durch die Legende
  „* Pflichtangabe“ (WCAG 3.3.2). Pflicht sind genau die Felder, deren Fehlen die Prüfung meldet
  (pages/requiredFields.test.tsx: „… fehlt“ ⇔ `required`); wo ein Feld als optional erklärt wird, heißt es
  „optional“. Die Legende zeigt der Drawer von selbst, sobald ein `<Field required>` darin steht
  (`RequiredScope`); außerhalb eines Seitenfensters setzt die Datei `<RequiredLegend />` (Wächter S25). Die
  Prüfung des Browsers greift nie vor: Ein `<form>` trägt immer `noValidate` (S25), ohne `<form>` prüft er
  nicht; gestaltet wird nie über `:invalid`/`:required` (S25), markiert nur über `aria-invalid`.
  Die Breitenstufen (`width`) und das Raster `field-grid` stehen unter „Felder in Stufen“. Die Fehlermeldung am Feld trägt ⚠ (für Vorleser ausgeblendet) und „Fehler:“
  (nur für Vorleser). **Im Seitenfenster** bekommt der Drawer die API (`errors`) und zeigt die
  Sammelmeldung im festen Fuß über den Knöpfen, höchstens 40 % der Höhe; **in einer Karte** steht sie oben
  in der Karte. Ein Eingabefeld mitten im Text (Entwurf am Feld, „✎ anpassen“) nimmt `FieldMessage`.
  **Aktionen ohne Formular** (Löschen) melden einen Fehler als Mitteilung (`toast(text, 'error')`, 8 s
  statt 3,2 s). Die Meldung oben auf der Seite bleibt für Ladefehler. Wächter S15 (uiRules.test.ts):
  `className="error"` und `role="alert"` nur in Field, ErrorSummary, feedback.tsx (Mitteilung, Ansage der
  Rückfrage) und DraftActions; was heute noch so steht (Ladefehler, Befunde einer Vorschau, die Ergebnisse
  der Belegauswertung), steht dort mit Anzahl und Grund und darf nur weniger werden.
- **Rückfragen** (`useConfirm`, [client/src/components/feedback.tsx](client/src/components/feedback.tsx),
  #341, #346 Schritt 1): ein `<dialog role="alertdialog">` mit `showModal()`, benannt durch den Titel
  (`aria-labelledby`) und beschrieben durch die Nachricht (`aria-describedby`). Er liegt im Top-Layer, auch
  über dem Menüblatt am Handy oder einem Seitenfenster; das Blatt muss deshalb vor einer Rückfrage nicht
  mehr schließen und bleibt nach „Abbrechen“ offen. **Es gibt keinen Abfänger für Enter** (Wächter S13):
  Enter wirkt auf den Knopf mit dem Fokus, das tut der Browser; auf einem anderen Element (etwa einem
  Begriff) erreicht es dieses. Bei `danger` steht der Startfokus auf „Abbrechen“, `defaultChoice:
  'confirm'` überstimmt das, `cancel` setzt ihn auch sonst dorthin; gesetzt wird er nach `showModal()`
  selbst, denn `autoFocus` griffe vor dem Öffnen. **Tab lenkt kein Baustein selbst**: `showModal()` macht
  den Rest inert, der Browser hält Tab im Dialog (nach dem letzten Element über die Bedienleiste zurück); ein
  eigener Ring sperrte einmal die Tastatur vor einem geschlossenen `<details>` ein. Esc bricht ab, schon am
  `keydown` (verhindert, damit Chrome ein zweites `cancel` ohne Nutzeraktion nicht durchlässt), außer ein
  Element darin hat Esc schon verhindert; ein Klick daneben auch, wenn er dort begann. Ein `close`, das
  ankommt, wenn der Dialog schon wieder offen ist, zählt nicht (der Browser sendet es als eigene Aufgabe).
  Beim Schließen geht der Fokus an den Auslöser zurück (`focusBack` in
  [dialogKeys.ts](client/src/components/dialogKeys.ts)); ist der ausgehängt und lag er in der Navigation,
  an die aktuelle Seite bzw. ☰. Eine zweite Rückfrage beantwortet eine offene mit „nein“; die dritte Wahl
  (`onAlternative`) läuft erst nach dem Schließen, damit eine Rückfrage daraus offen bleibt. **Mitteilungen**
  (`useToast`) sind ein `popover="manual"` und liegen damit über offenen Dialogen; weil alles außerhalb des
  obersten modalen Dialogs inert ist und nicht angesagt würde, steht jede Mitteilung dann zusätzlich in einer
  Ansage (`role="status"`, bei Fehlern `alert`, `sr-only`) in diesem Dialog.
  Safari fokussiert einen Knopf beim Mausklick nicht; dort greift die Rückgabe nur über die Tastatur. In
  jsdom bildet [testing/dialog.ts](client/src/testing/dialog.ts) `showModal()` nach (für jede Datei mit
  jsdom in vitestSetup.ts installiert, Esc erst nach einem nicht verhinderten `keydown`, `close` wie der
  Browser als eigene Aufgabe, `:modal`), und [testing/keys.ts](client/src/testing/keys.ts) (`press`) drückt
  eine Taste wie der Browser: Enter auf einem Knopf als Klick, Tab zum nächsten bedienbaren Element im
  obersten modalen Dialog (ohne Felder in geschlossenem `<details>`, mit `<summary>`). Tests suchen die Rückfrage mit `getByRole('alertdialog')`.
- **Seitenfenster** (`Drawer`, [client/src/components/Drawer.tsx](client/src/components/Drawer.tsx), #346
  Schritt 2): ein `<dialog>` mit `showModal()` von rechts, im Top-Layer, Hintergrund inert. Kopf mit Titel
  (`h2`) und ✕, scrollender Körper, fester Fuß mit Hinweis (`hint`), **„Abbrechen“ aus dem Baustein**
  (`cancelLabel`, `busy` sperrt alle Wege zum Schließen) und den Knöpfen des Formulars (`actions`).
  **Schließen mit Änderungen** (Esc, ✕, Klick daneben, „Abbrechen“) fragt „Änderungen verwerfen?“ mit
  Startfokus „Abbrechen“; ohne Änderungen schließt es sofort. Erkannt wird die Änderung am Pflicht-Prop
  `value` (der Stand des Formulars): verglichen mit `sameDraft` gegen den Stand vor der ersten Eingabe oder
  dem ersten Klick im Körper, gemerkt in der Einfangphase, also bevor React die Änderung verarbeitet. Nicht
  beim Öffnen, sonst gälte ein Formular, das nach dem Öffnen Vorgaben nachträgt, als geändert;
  zurückgesetzt gilt nicht als Änderung. **Nur ein geändertes Fenster meldet sich bei `useOpenForm` an**:
  Seite, Objekt und Zeitraum fragen bei einem unveränderten nicht nach. **`value` umfasst jeden Zustand,
  den das Fenster bearbeitet**, auch wenn er neben dem Formularobjekt liegt (Kosten: `{ form,
  heatingPlantId, heatingPeriod }`), aber nichts, was das Fenster nachlädt (Kesseltausch: `swap.form`, nicht
  die Zähler) und keine bloße Hilfe ohne Speicherwert (Zähler: die Jahreszahl für den Vorschlag der
  Eichfrist); was ein Feld nur umschreibt, wird vorher normalisiert (IBAN). **Zeigt ein offenes Fenster einen
  anderen Datensatz** („Stattdessen … bearbeiten“, „Hier beheben →“), ist das ein neues Formular: Die
  Aufrufer setzen `key` auf die Kennung (`form.id ?? 'neu'`). Esc wird am `keydown` verhindert (sonst ließe
  Chrome ein zweites `cancel` ohne Nutzeraktion nicht abbrechen), gilt aber nicht dem Fenster, wenn es zuerst
  etwas darin schließt: ein Element, das Esc schon verhindert hat (ein offener Begriff), ein offenes Popover,
  eine IME-Eingabe. `cancel` und `close` zählen nur am Fenster selbst (`e.target === e.currentTarget`), denn
  React reicht sie aus verschachtelten Dialogen weiter, und ein `close`, das ankommt, wenn das Fenster schon
  wieder offen ist, zählt nicht (StrictMode baut den Effekt ab und wieder auf, der Browser sendet `close` als
  eigene Aufgabe; sonst schloss im Entwicklungsbetrieb jedes Fenster sofort). Schließt der Browser es doch
  selbst, öffnet es mit Änderungen wieder und fragt. Tab lenkt der Browser (dialogKeys.ts). Das erste Feld bekommt den
  Fokus nach `showModal()` und, falls der Inhalt nachlädt, nach 60 ms noch einmal, wenn er noch auf ✕ steht
  (#352). Beim Aushängen geht der Fokus an den Auslöser zurück (`focusBack` in dialogKeys.ts). Mitteilungen
  liegen als `popover="manual"` über offenen Dialogen und werden im obersten angesagt (siehe Rückfragen). Wächter
  S12b in uiRules.test.ts: jedes `<Drawer>` hat `value` (kein fester Wert, auch kein `{}`), kein `footer`,
  und in `actions` keinen eigenen Weg zum Schließen (die Wörter des Bausteins, der Schließer des Aufrufers,
  kein `set…(null)`). Grenze: Ob `value` den ganzen Zustand umfasst, sieht der Wächter nicht; das prüft die
  Durchsicht. **Gespeichert wird über `useSaving`** ([client/src/useSaving.ts](client/src/useSaving.ts), Durchsicht S1 zu Schritt 7): `run(save)` lässt einen zweiten Aufruf fallen, solange der erste läuft (Sperre über eine Referenz), `busy` geht an den Drawer (dann sperrt er alle Wege zum Schließen und ruft bei Strg+S kein `onSubmit`) und an den Knopf; vorher legte ein Doppelklick die Ablesung zweimal an (doubleSave.test.tsx und je Aufrufer). **`changedFrom`** gibt einen Vergleichsstand von Anfang an vor: Ein vorbelegt geöffnetes Fenster (Lieferung mit KI-Vorschlag) gilt sofort als geändert und fragt auch bei Esc. Tests: `<dialog>` hat die Rolle `dialog`, die Rückfrage `alertdialog`;
  wer in einem Test mit Eingabe „Abbrechen“ klickt, bestätigt danach „Verwerfen“.
- **Feste Verben auf Knöpfen** (#346 Schritt 7, #341 N3 und M19). Im Seitenfenster heißt der Primärknopf
  „Anlegen“ (neu) oder „Speichern“ (bearbeiten), „Abbrechen“ kommt aus dem Baustein und ist nie primär. Kein
  „OK“, „Übernehmen“, „Hinzufügen“ oder „Umstellen“ als Primärknopf; eine Rückfrage nennt immer ihr Verb
  (`confirmLabel` ist Pflicht). Ein Knopf mit „+“ öffnet ein Fenster („+ Zähler anlegen“) oder fügt eine Zeile an
  („+ weitere Teilmenge“, „+ Erhöhung ab Monat …“); „… hinzufügen“ gibt es nicht. Ein Entwurf am Feld hat
  „Speichern“ und „Verwerfen“. Fachliche Verben bleiben, wo sie eine Handlung mit Folgen benennen und kein
  Seitenfenster speichern: „… abschließen“, „Buchen“, „Positionen anlegen“, „Zuordnen“, in Rückfragen auch
  „Umstellen“. Die eine Ausnahme im Seitenfenster ist „Anlegen und zu … wechseln“ (`createButtonLabel`): Es
  beginnt mit dem Verb und nennt die Folge. **Gefahrknöpfe** (`btn ghost danger-ghost`, rot beim Überfahren)
  tragen „…“, wenn eine Rückfrage folgt („Objekt löschen …“, „Wieder öffnen …“), und stehen mit `ml-auto` von
  einem „Speichern“ derselben Zeile ab. Wächter S16 in uiRules.test.ts; die Gefahrknöpfe ohne Rückfrage stehen
  dort mit Grund. Wer einen Knopf umbenennt, zieht die Anleitungen (shared/guides.ts, geprüft von
  guides.test.ts) und die Meldungen des Servers (ui-labels.test.ts) mit.
- **Etwas anlegen oder bearbeiten heißt Seitenfenster** (#346 Schritt 7, #341 M18, N16, N16a). Auch Ablesung
  (Zähler-Seite, „+ Ablesung anlegen“ im aufgeklappten Zähler), Lieferung (FuelCard, „+ Lieferung anlegen“ und „Ändern“),
  Mieterwechsel (`TenantChangeDrawer` in Stammdaten.tsx) und Zeitraumwechsel (PeriodCard, „Abrechnungszeitraum ändern“
  und „Wechsel ab … entfernen …“) sind `<Drawer>` mit `Field`, Sammelmeldung im Fuß und `required`. **Die Anfragen und
  Rümpfe sind dieselben wie vorher**, festgehalten mit `toEqual` in Zaehler.test.tsx, FuelCard.test.tsx,
  tenantChange.test.tsx und PeriodCard.flow.test.tsx (vor dem Umbau gegen die alte Oberfläche gelaufen). Der
  Mieterwechsel ist ein Formular statt dreier Schritte: `tenantChangeProblems` (tenantChange.ts) meldet alles auf einmal
  je Feld, danach baut `buildTenantChange` unverändert den Rumpf für `POST /api/tenancies/:id/change`; der Einzug folgt
  dem Auszug, bis er selbst geändert wird. Scheitert nach dem Speichern nur das Neuladen, ist das Fenster zu und die
  Karte „Mietverhältnisse“ sagt es. Beim Zeitraumwechsel bleibt die Vorschau mit `token` unverändert; „Speichern“ ist bis
  zur Vorschau gesperrt (mit Satz), bei abgelaufener Frist bis zur Bestätigung, und **jede Änderung des Formulars nach der
  Vorschau verwirft sie** samt Antworten und Bestätigung (Durchsicht M2: vorher wurde die alte Vorschau gespeichert). Die Lieferung prüft zuerst die
  Pflichtangaben je Feld (`fuelRequiredProblems` in fuelForm.ts), dann wie bisher `fuelBody`/`stockFuelBody`; eine mit der
  KI gelesene Rechnung meldet sich schon beim Öffnen bei `useOpenForm` an, ein von Hand geöffnetes Fenster erst mit der
  ersten Eingabe.
- **Eine Karte, ein Speichern; der Kopf ist der Baustein `Card`** (#346 Schritt 7, #341 N8, M18;
  [client/src/components/Card.tsx](client/src/components/Card.tsx)). `Card` setzt `section.card` mit `CardHeader`
  (Titel samt Begriff, höchstens eine Aktion rechts); Karten unter einem Abschnittstitel wie „Heizanlage, Heizperiode
  2025“ sind `level={3}` und sehen trotzdem aus wie jede Karte, ohne die Heizperiode im Titel zu wiederholen (außer
  „Ableseergebnis · …“, das gedruckt wird und dort ohne Abschnittstitel steht). Trägt eine
  Karte ein Formular, ist es ein Entwurf (`useDraft`) mit **einem** `<DraftActions layout="card">` am Fuß; die Prüfung
  meldet über die Sammelmeldung oben in der Karte und gibt `keepDraft` zurück (Co2FactsCard, HalfSplitCard, der Anteil
  in SelfHeatingCards). Was je Zeile einer Liste gespeichert wird, ist ein Entwurf am Feld in einer eigenen kleinen
  Komponente (`NoticeRow`, `MonthRow`, `TempField`, `GapReason`, `SlotGroup` in LawOverridesCard): `DraftActions` ohne
  `layout`, eine Meldung der Prüfung als geworfener Fehler, der am Feld steht. Wächter S19 in uiRules.test.ts: je Karte
  (`className="card…"` oder `<Card>`, verschachtelte Karten und Seitenfenster für sich) höchstens ein Speichern (ein
  Knopf „… speichern“, `type="submit"`, `layout="card"`); ein Knopf in einer Schleife zählt mehrfach. Und eine Karte,
  die ein Seitenfenster öffnet, speichert ihr Formular dort (Ausnahme mit Grund: PropertyCard). **Grenze**: Der Wächter
  liest den Quelltext; ein Speichern, das eine Unterkomponente in derselben Karte zeichnet, sieht er nicht.
- **Felder in Stufen, Neues anlegen oben rechts** (#346 Schritt 7b, nach einer Rückmeldung zur Objekt-Karte und zur
  Zähler-Seite). Die Breite gehört dem Eingabefeld: `<Field width>` mit `s` (`--field-s`, 15ch: Betrag, Datum, Monat
  samt ▦, PLZ, Fläche, Personen, Zählerstand), `m` (24ch, kurze Freitexte), `l` (38ch: Adresse, Name, Bezeichnung,
  IBAN) und `full` (Textfelder); ein Auswahlfeld ist so breit wie sein längster Eintrag, die Stufe ist dort nur
  die Mindestbreite. **Ohne Angabe gilt die Vorgabe nach Feldart** (`widthOf` in Field.tsx): Datum, Uhrzeit,
  `inputMode` decimal/numeric und Monat kurz, `<textarea>` voll, Auswahl nach Inhalt, sonst lang; dieselbe Regel steht
  per `:has()` in [client/src/fields.css](client/src/fields.css) und gilt damit auch für ein `label.field` von Hand.
  Ein Betrag oder eine Zahl braucht deshalb `inputMode`, sonst ist das Feld lang. fields.css hängt in tw.css als
  Schicht `components` (über index.css, unter den Utilities `width-s` … `width-full`, die nur `--field-w` und
  `--select-min` setzen); eine eigene Datei, weil Tailwind Regeln in tw.css für Utilities hielte (S20). Die Hülle
  ist `fit-content`, Hinweis und Meldung brechen darin um (`contain: inline-size`, mindestens `--field-hint`, 30ch;
  `hint-wide` 72ch für eine lange Frage). `field-grid` ist eine Zeile mit Umbruch, jedes Feld in seiner Breite, die
  Eingabefelder auf einer Linie; die frühere Spaltenteilung (`auto-fit, minmax(220px, 1fr)`) streckte und schnitt
  ab. Am Handy (bis 640 px) ist jedes Feld voll breit. `grow` und `wide` an Feldern und die px-Breiten `input-xs`
  usw. sind entfallen. **Aktionen:** Neues anlegen steht oben rechts, für die ganze Seite im Seitenkopf
  (`PageHeader actions`: Kosten, Zähler, Mietkonto), für eine Liste oder Karte im Kartenkopf (`Card`/`CardHeader
  aside`: Objekt, Wohnungen, Mietverhältnisse, Heizung, Lieferungen, Ablesungen im aufgeklappten Zähler); im Fuß
  einer Karte nur „Speichern“ links und Gefahrknöpfe rechts. Wächter S27 (jedes „+ … anlegen“ in einer dieser
  Props) und S28 (`<Field>` mit Funktion nennt `width`, keine Breite als Inline-Stil an Feldern, keine px-Breite an
  Eingabefeldern in index.css). **Der Browserlauf misst abgeschnittene Felder** je Seite und in jedem Seitenfenster
  (`clippedFields` in browser-check.mjs: Eingabefeld `scrollWidth` > `clientWidth` + 1 beim gesetzten Wert,
  Auswahlfeld gegen einen Klon mit nur dem gewählten Eintrag; die Fenster öffnet `checkDrawers` über „+ … anlegen“,
  „… bearbeiten“ und die Knöpfe zum Ändern). Ein Feld, das schon die ganze verfügbare Breite nimmt (am Handy, im
  Seitenfenster), zählt nicht: Ein langer Eintrag eines Auswahlfelds darf dort abgeschnitten sein, die Liste des
  Systems zeigt ihn ganz. Eine Selbstprobe mit zwei absichtlich zu schmalen Feldern läuft bei jedem Aufruf mit.
- **Ein Monat ist ein Monatsfeld** (`MonthField`, [client/src/components/MonthField.tsx](client/src/components/MonthField.tsx),
  #287, #346 Schritt 5): ein Textfeld in `Field`, das „3.2025“, „03/25“, „2025-03“, „März 2025“ und „Mrz 27“ liest
  (`parseMonthText` in [client/src/monthText.ts](client/src/monthText.ts), ohne DOM: ein Tag nur als Erster,
  zweistellige Jahre wie POSIX, Jahre 1900 bis 2100, ein Punkt am Ende zählt nicht; „1.10“ oder „01.12“ sind mehrdeutig,
  Tag.Monat ohne Jahr oder Monat.Jahr, und ergeben eine Meldung statt Januar 2010), dazu ▦ mit einem Raster als Popover (APG-Grid: Pfeile, Pos1/Ende,
  Bild auf/ab fürs Jahr, die Zellen sind Knöpfe mit `role="gridcell"`, Esc schließt nur das Raster, der Fokus geht an
  ▦ zurück; am Handy ein Blatt unten). Der Wert ist 'JJJJ-MM', ist der Text kein Monat, der Text selbst: Er wird nie
  verworfen, beim Verlassen steht die Meldung am Feld, und die Prüfung des Formulars meldet sie mit Ort (Staffeln je
  Zeile und Feld, `buildSchedule` mit `scheduleField`). Das Popover (`usePopover`,
  [client/src/components/popover.tsx](client/src/components/popover.tsx)) hängt über ein Portal im nächsten
  `<dialog>` bzw. in `body` und nicht im `<label>`, positioniert sich am Auslöser und gibt den Fokus selbst zurück.
  **Die Personenstaffel bleibt ein Datum**, denn `personDaysInPeriod` rechnet tagesgenau. Wächter S14 (kein
  `type="month"`, kein `type="number"`, kein zweites Monatsfeld, Monatsnamen nur in monthText.ts) und S12 (Popover nur
  in popover.tsx und den Mitteilungen; `usePopover` nehmen nur MonthField und Term). Den Inhalt zeichnet das Popover
  nur, solange es offen ist; sonst fände eine Abfrage nach Beschriftung auch die geschlossene Erklärung. In jsdom
  bildet testing/dialog.ts `beforetoggle`/`toggle` nach und macht ein offenes Popover sichtbar, damit Abfragen nach
  Rolle es finden. **Bekannte Grenze:** Ohne `showPopover` (Safari vor 17, Firefox
  vor 125) steht das Popover `position: fixed` über `hidden`; ist der umgebende `<dialog>` transformiert (Einfahren
  des Seitenfensters), bezieht sich `fixed` auf ihn, und die Lage aus `getBoundingClientRect` stimmt dann nicht. Nicht
  geprüft, kein alter Browser zur Hand (Durchsicht K6).
- **Objekt und Abrechnungszeitraum wählt nur die Seitenleiste** (#346 Schritt 8, #341 M13 und N1), am Handy
  das Menüblatt mit demselben Inhalt. Beide sind ein Baustein, `Switcher`
  ([client/src/components/Switcher.tsx](client/src/components/Switcher.tsx), Utility `switcher` in tw.css): der
  gewählte Eintrag als umbrechender Text mit ▾, das echte Auswahlfeld unsichtbar darüber, gleiche Höhe und Schrift.
  Jede Seite zeigt beides im Seitenkopf als **Kontextzeile** an („Lindenweg 12 · Abrechnungsjahr 2025“,
  `pageContextLine` in client/src/propertyView.ts; `PageHeader` mit `context`: `period` als Vorgabe, `calendar` für
  Mietkonto und Steuer, `property` für Stammdaten, `none` für Einstellungen und Hilfe). Am Bildschirm des Handys entfällt die
  Zeile, dort steht dieselbe Angabe im angehefteten Kopf; gedruckt wird sie immer. Der Fuß der Seitenleiste ist
  Teil der Scrollfläche und nicht angeheftet (#341 M15). Auf einer Seite bleiben nur andere Größen: das Kalenderjahr von
  Mietkonto und Steuer bei abweichendem Zeitraum (`CalendarYearSelect`), die Heizperiode, das „Jahr der Buchung“
  einer Auswertung, Objekt und Jahr eines Belegs im Posteingang und das Jahr der Zahlung einer Position. Der Wächter
  S18 (uiRules.test.ts) lässt die Bausteine der Seitenleiste nur in App.tsx zu und kein `<select>` in `pages/` oder
  `components/`, das Objekte, Jahre oder Zeiträume anbietet, außer den benannten Ausnahmen; Tests einer Seite, die
  den Zeitraum wechseln, stellen dafür `<PeriodSelect />` daneben wie die Seitenleiste.
- **Auswahlfelder und Häkchen speichern nicht beim Anklicken** (#309). Sofort gespeichert wird nur,
  was keine Daten ändert: der Wechsel von Zeitraum, Objekt oder Design und die Antwort auf die
  Frage nach der Update-Prüfung im Cockpit. Alles andere ist zuerst ein Entwurf: `useDraft(saved,
  { scope })` ([client/src/useDraft.ts](client/src/useDraft.ts), Logik ohne React in
  [client/src/draft.ts](client/src/draft.ts)) hält angezeigten Wert, `set`, `dirty`, `discard` und
  `save(fn)` (Doppelklick-Sperre, ein Fehler lässt den Entwurf stehen), übernimmt einen neuen
  gespeicherten Wert nur ohne offenen Entwurf und meldet sich, solange etwas geändert ist, bei
  `useOpenForm` an, damit ein Wechsel von Objekt oder Zeitraum nachfragt. `<DraftActions>`
  ([DraftActions.tsx](client/src/components/DraftActions.tsx)) zeigt „Speichern“ und „Verwerfen“
  nur bei einer Änderung, hinter dem Feld; `what` steht unsichtbar **hinter** dem sichtbaren Text
  („Speichern (Versanddatum)“) und nicht als `aria-label`, damit der Name mit dem beginnt, was auf
  dem Knopf steht (WCAG 2.5.3), auch bei „Speichert …“. Ein anderer `scope` verwirft den Entwurf;
  wechselt die Seite ihn selbst (der Reiter zwischen Betriebs- und Heizkostenabrechnung), fragt sie
  vorher mit `useConfirmDiscard` („Ungespeicherte Änderung verwerfen?“, Startfokus „Abbrechen“).
  **Auch der Seitenwechsel fragt** (#346, Schritt 7a): Jeder Wechsel der Seite geht über `navigate` in
  App.tsx, aus der Navigation (Seitenleiste, Menüblatt, untere Leiste) wie aus einer Seite („Hier
  beheben →“, „Position öffnen“, „Weiter prüfen“, Anleitung zum Update). Bei offenem Formular fragt es
  „Ungespeicherte Änderungen verwerfen?“ (Startfokus „Abbrechen“; das Menüblatt schließt vorher);
  wechselt dabei auch das Objekt, fragt nur dessen Rückfrage (`goViaProperty`). Mit offenem Formular
  fragt der Browser beim Schließen oder Neuladen des Tabs (`beforeunload`), und das Blatt „CO₂-Angaben
  für den Messdienst“, das die Seite Heizkosten ersetzt, fragt vor dem Öffnen. **Karten mit eigenem
  Formularzustand melden sich an**: mit `useOpenWhenDiffers(gezeigt, gespeichert)`, verglichen mit dem
  aus Props oder dem geladenen Stand abgeleiteten Wert in derselben Gestalt und ohne verborgene Felder;
  das zurückgegebene `markSaved()` nach dem Speichern aufrufen, dann fällt die Marke auch, wenn die Seite
  die Karte nicht neu einhängt oder der Server die Zahl anders schreibt. Ein Formular, das nur offen
  oder zu ist, nimmt `useOpenForm(offen)` und muss beim Abbrechen und Speichern wirklich zugehen. Schließt
  ein Knopf ein Formular und springt zugleich weg, schließt er es mit `flushSync` vorher (Belege, „Betrag
  prüfen“), sonst fände der Sprung die Marke noch. Der Wächter
  [openFormGuard.test.ts](client/src/openFormGuard.test.ts) findet Karten mit Eingaben und `api(` ohne
  Anmeldung (Ausnahmen mit Grund); Karten prüfen ihre Anmeldung mit `OpenFormScope` und `hasOpenForm`
  aus client/src/testing/openForm.tsx (Ändern, Speichern, Abbrechen). **Ein Auswahlfeld
  gibt `isValid` mit** (`useDraft(saved, { isValid })`): Fällt der Wert eines Entwurfs aus den
  Optionen (die Liste folgt einem anderen Feld, eine Position ist weg), ist der Entwurf verworfen;
  sonst zeigte der Browser den ersten Eintrag, und „Speichern“ schickte einen unsichtbaren Wert. Für
  eine Karte mit mehreren solchen Feldern gibt es **ein** „Speichern“ am Fuß (`<DraftActions
  layout="card">`, mit „Ungespeicherte Änderungen“; Muster „Karte mit einem Speichern“ der
  Spezifikation zu #346); der Entwurf ist dann ein Objekt, und gesendet wird nur, was sich geändert
  hat, damit eine geerbte Angabe nicht als eigene gespeichert wird (HeatingRulesCard, `rulesBody`).
  Kommt vor dem Speichern eine Rückfrage, ergibt `onSave` bei „Abbrechen“ `keepDraft`: Der Entwurf
  bleibt ohne Fehlermeldung stehen. Der Wächter
  [saveOnChange.test.ts](client/src/saveOnChange.test.ts) liest den Quelltext: Ein `<select>` oder
  ein `<input>` vom Typ checkbox, radio oder date, dessen `onChange` speichert (`api(`, eine
  Methode PUT/POST/PATCH/DELETE, ein Name mit save/persist/submit, auch über Funktionen derselben
  Datei und relativ importierte Helfer), ist verboten. Die Ausnahmeliste dort nennt Grund und
  Anzahl und enthält nur noch die Art einer Zahlung im Mietkonto (`changeKind`), deren Umstellung
  mit #281 kommt; Neues kommt nicht hinzu. Rückrufe aus den Props mit anderem Namen sieht er nicht.
  Eine Auswahl, die eine Aktion auslöst (Beleg einer Position zuordnen), ist ebenso ein Entwurf mit
  leerem gespeichertem Wert (`AttachPicker` in Belege.tsx). Im Posteingang sind Objekt und Jahr ein
  Entwurf mit einem „Speichern“; die Positionen zum Zuordnen folgen schon dem Entwurf, und eine
  gewählte Position, die dabei aus der Liste fällt, ist verworfen (`isValid`). **Was an einem
  gespeicherten Wert vorbei handelt, wartet auf den Entwurf daneben**: Das Jahr der Buchung einer
  Auswertung sperrt, solange es ungespeichert ist, Vorschau und Buchen der Karte, und „Alle grünen
  übernehmen“ lässt diese Auswertung aus (die Leiste nennt sie; `onYearDraft`), denn gebucht würde
  im gespeicherten Jahr, während die Karte das neue zeigt. Ebenso sind „Per KI auswerten“ und
  „Weiter prüfen“ im Posteingang gesperrt, solange Objekt oder Jahr des Belegs einen Entwurf haben
  („Erst Objekt und Jahr speichern oder verwerfen.“).
- **Wer nach Plattform unterscheidet, bekommt sie hineingereicht**, wie `systemLocation` und
  `chooseDataDir` in paths.ts und store.ts und `networkLocation` in db/open.ts. Dazu gehört, mit
  `path.win32` beziehungsweise `path.posix` zu rechnen statt mit der Voreinstellung, und ebenso
  das hineinzureichen, was die Funktion sonst noch vom Rechner erfragt (Schreibrecht,
  Einhängepunkte, der wirkliche Ort einer Datei). Sonst prüft jeder Zweig nur dort, wo zufällig
  jemand entwickelt, und die CI wirft den anderen um. Das ist in diesem Projekt schon zweimal
  passiert, beide Male auf dem Linux-Runner. Ein Test unter `if (process.platform === …)` zu
  überspringen ist dafür kein Ausweg, sondern die Aufgabe der Prüfung.
- **Im Server tragen Importe die Endung `.ts`** (`import { load } from './store.ts'`). Node
  führt die Dateien unmittelbar aus und löst den Pfad auf, wie er dasteht; eine Endung `.js`
  oder gar keine zeigt ins Leere. Der Übersetzer erlaubt das über `allowImportingTsExtensions`.
  Im Client gilt die Regel nicht, dort bündelt Vite: Seine Importe bleiben endungslos
  (`from './types'`). Nur sein Import aus `shared/` trägt die Endung
  (`from '../../shared/types.ts'`), weil dieselbe Datei auch der Server unmittelbar lädt.
- **Reine Typimporte brauchen `import type`** (`verbatimModuleSyntax`). Sonst bliebe der Import
  beim Ausführen stehen und Node suchte nach einer Datei, die nur Typen enthält.
- **Kein Konstrukt, das erst beim Übersetzen entsteht** (`erasableSyntaxOnly`): keine `enum`,
  keine `namespace`, keine Parameter-Eigenschaften im Konstruktor (`constructor(private x)`),
  kein `declare` in einer Klasse. Node streift Typen nur ab, es übersetzt nicht; was Code
  erzeugen würde, wäre nach dem Abstreifen verschwunden. Statt `enum` ein Vereinigungstyp aus
  Zeichenketten, wie ihn `UnitUsage` oder `CostKey` in shared/types.ts zeigen.
- **Beide Pakete fahren dieselbe Compiler-Fassung und dieselben strengen Einstellungen** (#64):
  `typescript ^7.0.2` in `server/package.json` und `client/package.json`, `erasableSyntaxOnly`
  und `verbatimModuleSyntax` in beiden `tsconfig.json`. Die beiden Regeln oben gelten deshalb
  im ganzen Projekt. Der Grund ist `shared/types.ts`: Beide Seiten prüfen dieselbe Datei, und
  mit verschiedenen Regeln ginge auf einer Seite etwas durch, das Node ohne Bauschritt nicht
  ausführen kann. Der Client merkte nichts davon, weil Vite es für ihn übersetzt; auffallen
  würde es erst beim Start des Servers. Für sich genommen bräuchte der Client die Einschränkung
  nicht, sein Bündler könnte mehr — dass er trotzdem auf `enum` und auf stehenbleibende
  Typimporte verzichtet, ist der Preis für diese eine Zusage. Wird eine der beiden Fassungen
  angehoben, die andere mitziehen; sonst sagen die Prüfer wieder Verschiedenes über dieselbe
  Datei.
- **`npm run typecheck` ist die einzige Prüfung.** Es gibt keinen Linter, und weil der Server
  ohne Build-Schritt läuft, merkt niemand sonst einen Typfehler. Vor jedem Commit also einmal
  laufen lassen (`npm run build` schließt dieselbe Prüfung für den Client ein). Sie umfasst auch
  `client/vite.config.ts`, `scripts/*.mjs` und `server/scripts/*.mjs` (siehe Commands).
- Der Server nutzt bewusst **`NKA_PORT`** statt `PORT` (generische `PORT`-Variablen von
  Preview-Tools kollidieren sonst mit Vite).
- **Zielbild ist jede gelebte Form privater Vermietung** (#91): mehrere Mehrfamilienhäuser,
  vermietete Eigentumswohnungen, Gebäude, die gemeinsam abrechnen oder sich Kosten teilen,
  Pauschalen und Warmmieten, die fertige Abrechnung eines Messdienstes. Was gelebt wird, aber
  rechtlich angreifbar ist, wird unterstützt, mit Warnung und beziffertem Kürzungsbetrag, statt
  verweigert; abgelehnt wird nur, was keine Kürzung heilt. Nicht dazu gehört die Verwaltung für
  Dritte (Mandanten, Erlaubnis nach § 34c GewO). Der Weg dorthin steht in den Teil-Issues #92 bis
  #99, jedes einzeln auslieferbar. Stand heute: mehrere Objekte (#92), erweiterte Verteilbasis
  (#94) und das Mietmodell mit Pauschale und Inklusivmiete (#93); eine eigene Heizkostenabrechnung
  nach HeizkostenV fehlt noch (#97, #99), eine fertige des Messdienstes lässt sich über
  Einzelbeträge übernehmen. **Wer ein Haus vermietet, merkt von der Breite nichts**: Jede neue
  Angabe hat eine Voreinstellung, die das bisherige Verhalten ergibt, es gibt keine neuen
  Pflichtfelder, und die Golden-Tests bleiben centgenau grün. Die eine bewusste Ausnahme ist eine
  Behebung und keine Erweiterung: der Hauptzähler bei einer Wohnung ohne Zähler (#116).
- **Maßstab für Erweiterungen** (siehe [CONTRIBUTING.md](CONTRIBUTING.md)): Mietfuchs muss für
  Vermieter ohne technische Vorkenntnisse nutzbar und einfach einzurichten bleiben. Die Technik
  darunter darf wachsen (Datenbank, Serverbetrieb), solange Skripte, Installer und
  Voreinstellungen die Einrichtung übernehmen. Architekturentscheidungen also nicht pauschal
  ausschließen, sondern daran messen, was beim Nutzer ankommt.
