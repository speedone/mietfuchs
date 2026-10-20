# Betrieb, Pakete und Release

Aus der CLAUDE.md im Wurzelordner hierher verschoben: Bildschirmfotos, Browserlauf,
Programmdateien, Linux-Pakete, Startmenü, Docker, Node-Versionen, Release, Artefakt-Tests,
Praxislauf des Umstiegs und Prüfumfang je Anlass.

**Bildschirmfotos fürs README**: [scripts/screenshots.mjs](screenshots.mjs) (`npm run
screenshots`) erzeugt die Bilder in `docs/screenshots/` neu und gehört zu jedem Release. Es baut
die Oberfläche (`--skip-build` lässt das aus), startet den Server wie `npm start` mit den drei
Angaben jedes Prüfstarts (siehe unten) und das nachgebaute Ollama aus
[scripts/fake-ollama.mjs](fake-ollama.mjs), legt per API einen Beispielbestand an
([scripts/demo-stock.mjs](demo-stock.mjs), denselben nimmt der Browserlauf) und
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

**Browserlauf** (#340, Schritt 11 von #346): [scripts/browser-check.mjs](browser-check.mjs)
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
[scripts/browser-check-axe.json](browser-check-axe.json) und dürfen nur sinken: Mehr ist
ein Befund, weniger nach einem Lauf über alle drei Engines ebenfalls, bis die Zahl gesenkt ist
(`--merge` fasst die Läufe der CI zusammen). Heute ist die Liste leer. Zum Nachprüfen grenzen
`--engines`, `--views`, `--themes` und `--pages` ein (`--pages -` nur die Bedienproben); eine
unbekannte Seite in `--pages` oder ein Lauf ohne geprüfte Seite ist ein Befund, ebenso eine Seite aus
[client/src/nav.ts](../client/src/nav.ts), die in der Navigation fehlt. WebKit
braucht unter Linux GTK4; fehlt es, läuft er im Container `mcr.microsoft.com/playwright:v<Fassung
aus package-lock.json>-noble` (Befehl im Kopf des Skripts). In release.yml läuft er je Engine als
Job „Browserlauf“ im vollen Prüfumfang, nicht an jedem PR, und „Ans Release anhängen“ wartet auf
ihn. **Probe von Hand bleibt** „Als PDF sichern“ in Safari auf dem Mac (#286): WebKit unter Linux
druckt in Playwright nicht, und echtes Safari gibt es nur auf Apple-Geräten.

**Eigenständige Binaries** (für Endanwender ohne Node): [scripts/package-binaries.mjs](package-binaries.mjs)
kompiliert Server + eingebettetes Frontend per **Bun `--compile`** zu je einer Datei pro
Plattform (Windows/macOS-Intel/macOS-ARM/Linux) in `dist-bin/`. `node scripts/package-binaries.mjs win`
baut nur ein Ziel. Bun wird gewählt, weil der Server ESM ist, was pkg/SEA nicht bündeln
kann. Native Module lassen sich so nicht für alle Ziele einbetten, der Server kommt deshalb
bewusst ohne aus (siehe KI-Belegauswertung). Das Frontend wird beim Build über
[scripts/embed-client.mjs](embed-client.mjs) aus `client/dist` in das generierte
(gitignorierte) Modul `server/src/embedded-client.js` eingebettet (Bun-Importattribut
`with { type: 'file' }`) und im gepackten Betrieb daraus ausgeliefert. In der Binary erkennt der
Server den gepackten Modus an `globalThis.Bun`: Daten landen dann in `data/` **neben der
ausführbaren Datei** (nicht in `server/data`), und der Standard-Browser wird automatisch geöffnet.
Wo die Daten liegen, entscheidet `chooseDataDir` in [server/src/store.ts](../server/src/store.ts).

**Linux-Pakete** (#25): [scripts/package-linux.mjs](package-linux.mjs) (`npm run
package:linux`) baut aus denselben Linux-Programmdateien `.deb`, `.rpm` und das Arch-Paket, je
für x64 und ARM64. Gebaut wird mit **nFPM** nach [packaging/nfpm.yaml](../packaging/nfpm.yaml),
das alle Formate aus einer Vorschrift erzeugt; nFPM kommt von der Platte oder aus seinem
Container, mehr als Docker braucht der Rechner nicht. Das Paket legt die Programmdatei nach
`/usr/bin`, dazu [packaging/mietfuchs.desktop](../packaging/mietfuchs.desktop) (Startmenü,
`Terminal=false`, siehe unten) und das Symbol als SVG und PNG. Dort installiert, kann der Server nicht neben sich schreiben, deshalb liegen die Daten
dann in `~/.local/share/mietfuchs` (XDG; entsprechend unter Windows und macOS). Die Regel dafür
steht in `systemLocation` ([server/src/paths.ts](../server/src/paths.ts), gemeinsame Quelle für
Datenordner und Betriebsart): ein Systemort (`/usr`, `/opt`, `Program Files`) führt immer in den
Benutzerordner, auch mit Schreibrecht, sonst würde ein Start als Administrator die Daten dorthin
legen, wo der normale Benutzer sie nicht wiederfindet. Der Heimatordner wird erst gesucht, wenn
er gebraucht wird: `os.homedir()` wirft ohne `HOME` und ohne Eintrag in der Benutzerdatenbank
(Container mit `--user`), und das darf den Start nicht verhindern. Dieselbe Regel ergibt die
Betriebsart `package` ([server/src/version.ts](../server/src/version.ts)): Der Update-Hinweis
erklärt dann das Neuinstallieren des Pakets statt des Austauschens der Datei. Beim Start nennt
der Server den Datenordner in der zweiten Zeile. Vor dem Release wird jedes Format in einem
Container seiner Distribution installiert, als gewöhnlicher Benutzer gestartet und mit
[scripts/smoke-test.mjs](smoke-test.mjs) geprüft (`--mode package`).

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
jedem System exklusiv bindet, prüft [scripts/second-start.mjs](second-start.mjs) in
release.yml auf allen sechs Programmdateien und in jedem Prüfumfang: zweiter Start auf dem Port
der laufenden Instanz, mit einer `db.json`, die umsteigen will, erwartet Exit 0 und einen
byteweise unveränderten Datenordner. Und scheitert der Start aus einem
anderen Grund, geht unter Linux zusätzlich eine Meldung über `notify-send` hinaus. Für Tests
gibt `NKA_RUNTIME=binary` die Programmdatei vor, ohne eine zu sein; die Auslieferung des
Frontends hängt weiterhin an `globalThis.Bun`. Den Klick im Menü selbst prüft kein Test, das
bleibt eine Probe auf einem echten Desktop.

**Docker-Image**: [.github/workflows/docker.yml](../.github/workflows/docker.yml) baut das
[Dockerfile](../Dockerfile) bei `v*`-Tags und Pushes auf `main` für `linux/amd64` + `linux/arm64`
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
hält Dependabot aktuell ([.github/dependabot.yml](../.github/dependabot.yml), monatlich: Actions
in einem PR, kleine npm-Updates gebündelt je Ordner, Hauptversionen einzeln). Sicherheitswarnungen
und automatische Sicherheits-PRs sind im Repo eingeschaltet. Bei Hauptversionen die
Changelogs gegen unsere Nutzung prüfen; Express 5 etwa ruft den `listen`-Callback auch bei
Startfehlern auf, und `res.sendFile` braucht `root`, wenn der Installationspfad Punkt-Ordner hat.

Release-Automatik: [.github/workflows/release.yml](../.github/workflows/release.yml) baut bei einem
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
[scripts/set-version.mjs](set-version.mjs) sie in die drei package.json-Dateien (samt
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
Start aus dem Quellcode. Alle nutzen [scripts/smoke-test.mjs](smoke-test.mjs): Es
prüft eine laufende Instanz von außen (Oberfläche mit allen Skriptteilen und pdf.js-Dateien,
KI-Auswertung gegen ein eigenes nachgebautes Ollama, Belege, Abrechnung, Backup und
Wiederherstellung, dazu die beim Start angelegte Datenbank aus `/healthz`) und braucht einen
leeren Datenordner. Aus `/healthz` liest er auch, dass der Umstieg gelaufen ist und im leeren
Ordner nichts zu tun hatte; den **gelungenen** Umstieg prüft er nicht, dafür müsste dieselbe
Instanz mit einer vorhandenen `db.json` ein zweites Mal starten (siehe den Bericht zu #55). Lokal:
`node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm`.

**Den Umstieg selbst spielt [scripts/umstieg-praxislauf.mjs](umstieg-praxislauf.mjs)
durch** (`node scripts/umstieg-praxislauf.mjs`, ein Fall einzeln mit `--nur 6`). Es startet
echte Server mit Wegwerf-Datenordnern und geht die Lagen durch, die beim Vermieter vorkommen:
frischer Rechner, gewachsener Bestand, Altformate, ein zweiter Start nach gelungenem Umstieg,
ein abgelehnter Bestand, Backup und Wiederherstellen mit und ohne Datenbank. Fall 7 ist dabei der
wichtigste für die Zukunft, weil er am längsten vorkommt: Archive **von vor der Datenbank**, also
genau das, was heutige Nutzer liegen haben, einmal mit Belegen und einmal mit nichts als der
`db.json` darin. [MIGRATION.md](../MIGRATION.md) verweist sie auf beide Wege, und ohne den Fall
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
[ci.yml](../.github/workflows/ci.yml), das Bauen und Signieren, die sechs Betriebssysteme ohne die
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
festlegen“ in [release.yml](../.github/workflows/release.yml); seine Zusammenfassung nennt jeden
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
