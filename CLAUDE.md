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
npm run typecheck  # nur Typprüfung: Server + Client (tsc --noEmit), ohne Build
npm --prefix server run db:generate # neue Migration aus server/src/db/schema.ts erzeugen
npm start          # Produktivbetrieb: Server liefert App + API auf Port 3001
npm run package    # baut eigenständige Binaries nach dist-bin/ (braucht Bun)
npm run package:linux # baut daraus .deb/.rpm/Arch-Pakete (braucht nFPM oder Docker)
```

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
ein zweiter Klick im Menü nur die Oberfläche nach vorn holt; und scheitert der Start aus einem
anderen Grund, geht unter Linux zusätzlich eine Meldung über `notify-send` hinaus. Für Tests
gibt `NKA_RUNTIME=binary` die Programmdatei vor, ohne eine zu sein; die Auslieferung des
Frontends hängt weiterhin an `globalThis.Bun`. Den Klick im Menü selbst prüft kein Test, das
bleibt eine Probe auf einem echten Desktop.

**Docker-Image**: [.github/workflows/docker.yml](.github/workflows/docker.yml) baut das
[Dockerfile](Dockerfile) bei `v*`-Tags und Pushes auf `main` für `linux/amd64` + `linux/arm64`
und pusht nach `ghcr.io/speedone/mietfuchs` (Tags: `X.Y.Z`, `X.Y`, `latest`, `main`). Damit
läuft die App ohne Clone des Repos. Bei PRs, die Dockerfile, Abhängigkeiten oder den Workflow
ändern, baut er nur zur Probe (ohne Login und Push). Die Laufzeit-Stufe übernimmt `server`,
`client/dist` **und `shared`**. Der Ordner mit dem gemeinsamen Datenmodell wird heute nur für
Typen gebraucht, die beim Ausführen verschwinden; sobald dort ein Helfer für die Laufzeit läge,
startete das Image ohne ihn nicht mehr, und kein Prüflauf bemerkte es, weil alle gegen den Start
aus dem Quellcode laufen.

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
Vorabversion von sich aus nicht.

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
`node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm`. Mit `--slow-ai 320`
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
lange Wartezeit auf Linux x64, Windows x64 und Apple Silicon. Denselben vollen Umfang fährt
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
auf einem ARM-Runner. Am selben Umfang hängt die lange KI-Antwort, damit Zeitplan und Label
alles abdecken, was ein PR auslässt. Eine leere Liste wäre die gefährlichste Lücke, weil eine
Matrix ohne Einträge keinen Job erzeugt und GitHub das nicht als Fehler meldet, sondern
überspringt; der Job
„Prüfumfang festlegen“ bricht deshalb ab, wenn eine der beiden Listen leer ist.

Einzelnen Test ausführen:

```powershell
npm --prefix server test -- --test-name-pattern "Flächenschlüssel"
npm --prefix client test -- costForm
```

Es gibt **keinen Linter**; `npm run typecheck` prüft Server und Client per `tsc --noEmit`,
`npm run build` schließt dieselbe Prüfung für den Client mit ein und baut zusätzlich das Frontend.

**Tests, drei Ebenen** — beim Erweitern der Verteilung oder der Formulare jeweils mitdenken:

1. [server/test/calc.test.ts](server/test/calc.test.ts) — Engine (node:test, kein Framework).
   Neben Beispielfällen prüfen drei Tests Invarianten über zufällig erzeugte Datenbestände
   (fester Startwert, also reproduzierbar): Mieteranteile + Vermieteranteil = Gesamtkosten,
   keine negativen Anteile, Eigenanteil ≤ Vermieteranteil. Einzelfall-Tests übersehen genau
   die schiefen Konstellationen — ein Geldverlust bei der Direktzuordnung fiel erst hier auf.
2. [server/test/api.test.ts](server/test/api.test.ts) — Integration: startet den Server als
   eigenen Prozess mit `NKA_DATA_DIR` auf einem Wegwerf-Ordner (deshalb gibt es diese
   Variable) und prüft die Routen. Berührt nie eine vorhandene `db.json`. `NKA_UPDATE_URL`
   zeigt dort standardmäßig auf einen geschlossenen Port, damit kein Test GitHub erreicht.
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

- `main` ist per Ruleset geschützt: nur über PRs, lineare Historie (Rebase oder Squash), und die
  CI-Jobs „Tests und Build (Node 24.15)“ und „(Node 24)“ müssen grün sein. Kein Löschen, kein
  Force-Push. Admins können im Notfall umgehen. Benennt man diese Jobs um, das Ruleset
  mitziehen, sonst wartet jeder PR auf einen Check, den es nicht mehr gibt.
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
[server/src/legacy.ts](server/src/legacy.ts) (z. B. fester Monatsbetrag zur
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
  [server/src/schedule.ts](server/src/schedule.ts), und legacy.ts wie repository.ts holen sie von
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
  Summe einer bereits abgerechneten Vergangenheit.
- **Prüfbedingungen je Feld entschieden.** Ohne Bedingung bleiben bewusst
  `cost_items.amount_cents` (eine Gutschrift ist negativ), `labor_35a_cents` (calc.ts meldet
  einen ungültigen Lohnanteil als Warnung und rechnet weiter; eine Bedingung nähme dem Nutzer
  genau diese Erklärung) und `payments.amount_cents` (Rücklastschrift). Dazu Bedingungen auf die
  Aufzählungen, denn `text({ enum })` bindet nur den Übersetzer und hinterlässt im SQL nichts.
- **Zwei Indizes, beide aus snapshot.ts abgelesen**: `cost_items(year)` ist der einzige Filter,
  den der Schnappschuss wirklich setzt, und `closed_settlements(year)` ist eindeutig und damit
  zugleich die Zusicherung, dass es je Jahr höchstens eine abgeschlossene Abrechnung gibt. Alle
  übrigen Sammlungen gehen vollständig in den Schnappschuss; dort wäre ein Index auf Verdacht.
- **Der eingefrorene Berechnungsstand bleibt JSON.** Er ist ein Archivstück, das wortgleich
  erhalten bleiben soll, auch wenn spätere Versionen anders rechnen. In Spalten zerlegt hinge er
  am heutigen Ergebnisformat, und eine Programmänderung veränderte rückwirkend, was dem Mieter
  zugestellt wurde.
- **Migrationen**: erzeugt mit `npm --prefix server run db:generate`, nie von Hand geschrieben.
  Es gilt die Regel aus [server/drizzle/README.md](server/drizzle/README.md): **Ein Schritt wird
  nie gelöscht und nie geändert**, sonst hält die Zusage nicht mehr, dass man von jeder alten
  Version auf die neueste kommt. Ein Fehler wird mit einem neuen Schritt geradegerückt. Ein Test
  hält die Marke jedes veröffentlichten Schrittes fest. Für die Programmdatei bettet
  [scripts/embed-migrations.mjs](scripts/embed-migrations.mjs) sie in ein gitignoriertes Modul
  ein, nach demselben Muster wie `embed-client.mjs` (erzeugte `.js`, gepflegte `.d.ts` daneben);
  ein Test hält beide Wege gegeneinander. Zeilenenden werden dabei vereinheitlicht, weil Git
  Textdateien unter Windows auf CRLF umstellt und die Marke sonst vom Rechner abhinge.
- **Schema und Datenmodell hält [server/test/schema.test.ts](server/test/schema.test.ts)
  zusammen**, zur Übersetzungszeit. `shared/types.ts` bleibt von Hand geschrieben, weil der
  Browser es benutzt und von Drizzle nichts wissen darf; der Test schlägt fehl, sobald jemand
  nur eine Seite ändert.
- **Der Validator** ([server/src/db/validate.ts](server/src/db/validate.ts), #59) prüft einen
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
  dabei immer einer Regel, die schon in calc.ts oder legacy.ts steht, und erfindet nie eine
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
  und Zahl. **Ausgenommen sind genau fünf Angaben** (`unitName`, `tenantName`, `description`,
  `basisText`, `warnings`), jede eine, die das Geraderücken ausdrücklich verändern darf; sie
  stehen benannt in regression.ts. Verglichen wird gegen den Bestand, wie Mietfuchs ihn **heute**
  rechnet, und nicht gegen den schon geradegerückten: Sonst prüfte die Regression das
  Geraderücken gegen sich selbst. Die eine Ausnahme davon ist der feste Monatsbetrag neben einer
  leeren Staffel, und sie steht als `standToCompare` sichtbar da.
- **Das Geraderücken steht als Funktion in legacy.ts** (`straightenForDatabase`), nicht im
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
  gescheitert eine Erklärung samt der Zusage, dass unverändert weitergearbeitet wird.

**API** ([server/src/index.ts](server/src/index.ts)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Sie gehen durch [server/src/db/repository.ts](server/src/db/repository.ts); das Kaskadieren beim
Löschen erledigen die Fremdschlüssel und nicht mehr index.ts. Daneben Spezialrouten:
`/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract` und `/api/intake` (KI-Auswertung, auf Wunsch als Strom, siehe
unten), die KI-Einstellungen `/api/ai/presets`, `/api/ai/status`, `/api/ai/key` und
`/api/ai/consent` sowie `/api/ollama/status` für ältere Tabs (alles siehe
KI-Belegauswertung), `/api/update` und `POST /api/update/check`
(Update-Hinweis, siehe unten), `/api/uploads` (Belegarchiv: Liste +
Löschen unverknüpfter Dateien), `/api/backup`/`/api/restore` (ZIP via adm-zip; das
Wiederherstellen prüft die `db.json` im Archiv erst mit dem Validator und lehnt sie ab, bevor
irgendetwas überschrieben wird, siehe Die Datenbank. Es setzt dabei **keinen vorhandenen Stand
voraus**: Auf einem frischen Rechner gibt es noch keine `db.json`, denn die entsteht erst beim
ersten Speichern, und genau dort wird am häufigsten wiederhergestellt. Die Sicherheitskopie
`db.json.vor-restore` entsteht deshalb nur, wenn es etwas zu sichern gab, und den Belegordner
legt die Route selbst an, statt sich darauf zu verlassen, dass multer ihn beim Laden des Moduls
angelegt hat. Beides spricht seit Aufgabe 7a auch die Datenbank, siehe Backup und
Wiederherstellen) sowie
`/api/settlement/:year/close` (POST/PUT/DELETE): friert die Abrechnung als Snapshot in der
Collection `closedSettlements` ein (inkl. `sentAt` für die §556-Frist) — `GET
/api/settlement/:year` liefert dann den Snapshot statt der Live-Berechnung; ebenso nimmt
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
nichts an ihm. Aufgefangen wird dort nichts: Ist eine Sammlung in der Datei `null` (#59), soll
es krachen. Ein `?? []` an der Grenze ergäbe eine leere Abrechnung ohne Kosten und ohne
Warnung, in der jeder Mieter seine Vorauszahlung voll erstattet bekommt. Sie sähe stimmig aus
und wäre falsch, und das ist der schlimmere der beiden Ausgänge.

**Berechnungs-Engine** ([server/src/calc.ts](server/src/calc.ts)) — das Herzstück, hier liegt
die ganze fachliche Komplexität:
- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats — Gleitkomma-Fehler vermeiden.
- Centgenaue Verteilung per **Hare/largest-remainder** (`largestRemainder`). Schöpfen die
  Rohanteile die Summe nahezu voll aus, wird centgenau auf Mieter verteilt; sonst trägt der
  **Vermieter** die Differenz (Leerstand, Eigenanteil, Rundungsrest, „Nicht umlagefähig").
- **Umlageschlüssel** (`item.key`): `area` (Wohnfläche), `persons` (personentagesgenau),
  `units` (Wohneinheiten), `meter` (Verbrauch nach Zählertyp), `direct` (Direktzuordnung),
  `custom` (vereinbarte Prozentanteile je Wohnung in `item.customShares`, absolut gerechnet —
  was unter 100 % fehlt, trägt der Vermieter).
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`) und Vorauszahlung
  (`prepayments`, `from: YYYY-MM`) werden als „ab Datum gilt Wert" geführt. Tatsächlich
  gezahlte Vorauszahlungen pro Jahr können via `prepaymentOverrides` überschrieben werden
  (haben Vorrang — rechtlich zählt das tatsächlich Gezahlte).
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen, in UTC gerechnet; Tagesanteile zählen
  für Teiljahre. `end: null` = offenes Mietverhältnis.
- **Zähler**: Ablesungen → Verbrauchssegmente (`meterSegments`), tagesanteilig interpoliert
  (`consumptionInPeriod`). Zählerwechsel über `replacement: true` + `oldEndValue`. Negativer
  Verbrauch erzeugt eine Warnung.
- **Beteiligung je Wohnung** (drei Zustände, siehe `UnitUsage` in shared/types.ts): `participates:
  true` = vermietet, Anteil trägt der Mieter · `selfUsed: true` = selbstgenutzt, zählt in die
  Verteilbasis von `area`/`units`/`persons` (dort mit `selfPersons`), Anteil fällt in den
  Vermieteranteil · beides `false` = außerhalb der Abrechnungseinheit, bleibt ganz außen vor.
  Grund für die Basis-Zugehörigkeit: Kosten einer Rechnung über das ganze Haus dürfen nur
  anteilig auf die Mieter umgelegt werden. Beim `meter`-Schlüssel bilden **alle**
  Wohnungszähler die Basis, unabhängig vom Kennzeichen — ein Zählerstand belegt Verbrauch
  innerhalb der abgerechneten Menge. `computeSettlement` liefert den auf `selfUsed`-Wohnungen
  entfallenden Teil separat als `selfUsedShareCents` (für die Anlage V privat, nicht
  abziehbar); `load()` migriert bewusst **nicht** automatisch, weil ein gesetztes Kennzeichen
  die Verteilung bereits abgerechneter Jahre verändern würde.
- **Mietkonto** (`rentLedger`): Kaltmiete-Staffel (`baseRents`) + Vorauszahlung ergeben das
  monatliche Soll (Bruttomiete); Zahlungseingänge (`payments`) werden Jan→Dez FIFO auf die
  Monate verteilt (Status bezahlt/teilweise/offen).
- **Steuer/Anlage V** (`taxReport`): aggregiert Einnahmen (aus `rentLedger`, Soll + Ist) und
  Werbungskosten (Kostenpositionen nach `ANLAGE_V_GROUP`-Mapping), liefert §35a-Summe,
  vermieteten Flächenanteil und Überschuss. Bewusst beschreibende Gruppen statt fester
  Anlage-V-Zeilennummern; keine automatische Eigennutzungs-Aufteilung (nur Hinweis).
  **Maßgeblich ist das Ist** (#70): § 11 Abs. 1 Satz 1 EStG setzt Einnahmen im Jahr des Zuflusses
  an, ein vereinbartes, nicht gezahltes Soll ist keine Einnahme. Das Soll bleibt umschaltbar, denn
  zum Abgleich taugt es, ist aber nicht mehr die Vorgabe; die Entscheidungslogik samt Hinweisen
  steht in [client/src/taxView.ts](client/src/taxView.ts). Dass die Vorgabe früher das Soll war,
  hatte einen ehrlichen Grund, nämlich eine Zahl auch ohne erfasste Zahlungen — und war genau
  deshalb der schlimmere Ausgang: 0 € sind sichtbar falsch und führen ins Mietkonto, eine
  Soll-Summe ist unsichtbar falsch und wandert in die Steuererklärung. Dieselbe Abwägung wie beim
  `?? []` an der Schnappschuss-Grenze.
  **Drei Sichten, drei Zahlen, und nur die Steuerübersicht war falsch.** Die Abrechnung setzt die
  tatsächlich geleisteten Vorauszahlungen an (`prepaymentOverrides` hat Vorrang), weil sie es
  muss: Nach ständiger Rechtsprechung des BGH ist eine Abrechnung auf Soll-Basis materiell falsch
  und trägt nach Ablauf der Frist des § 556 Abs. 3 BGB keinen Nachforderungsanspruch mehr. Das
  Mietkonto führt das monatliche Soll, denn eine Jahreszahl auf zwölf Monate zu verteilen wäre
  erfunden. `taxReport` führt beide nebeneinander (`prepaymentSollCents` und
  `prepaymentSettlementCents` samt `prepaymentOverridden`) und **entnimmt die zweite der
  Abrechnung**, statt die Staffel ein zweites Mal auszulegen. Die Zehn-Tage-Regel des § 11 Abs. 1
  Satz 2 EStG bleibt ein Hinweis in der Oberfläche und wird nicht gerechnet: Sie hängt an der
  vertraglichen Fälligkeit, die Mietfuchs nicht kennt, und ein Feld dafür machte eine Zahl der
  Steuererklärung davon abhängig, dass jeder Nutzer es richtig ausfüllt.

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
im Server, die Formularzustände im Client, und ebenso `ClientSettings` in api.test.ts, das genau
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
in index.ts) und landen nicht im Belegarchiv. So braucht der Server kein natives Modul:
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
Beispielbelege nur erfunden, nie echte Rechnungen.

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
`NKA_UPDATE_URL` lenkt die Abfrage auf einen nachgebauten Server.

**Client** ([client/src/](client/src/)): React ohne Router — `App.tsx` schaltet per State
zwischen den Seiten (`pages/`: Cockpit, Schnellerfassung, Zaehler, Kosten, Mietkonto,
Abrechnung, Uebersicht/Kostenvergleich, Steuer, Stammdaten, Belege, Einstellungen), gruppiert
nach Arbeitsphase in der Sidebar (das Abrechnungsjahr liegt zentral im `YearProvider`,
[client/src/year.tsx](client/src/year.tsx)). Dark Mode über `data-theme` auf `<html>` + CSS-Variablen (Umschalter in der
Sidebar, Druck ist immer hell); PWA-Manifest und Icons liegen in `client/public/` (Icons
erzeugt `server/scripts/make-icons.mjs`).
Zentraler Fetch-Wrapper `api()` und Geld-/Datums-Helfer (`parseEuro`, `fmtEuro`, `fmtDate`) in
[client/src/api.ts](client/src/api.ts). Druck/PDF läuft über die Browser-Druckfunktion;
hochgeladene Belege werden für den Druck per **pdf.js** auf Canvas gerendert
([client/src/pdfPreview.ts](client/src/pdfPreview.ts)) — die zugehörigen pdf.js-WASM/Font-
Assets werden im Build via `vite-plugin-static-copy` nach `dist/pdfjs/` kopiert. pdf.js wird
für Druck und Upload über [client/src/pdf.ts](client/src/pdf.ts) geladen, bewusst in der
legacy-Fassung (`pdfjs-dist/legacy/build`): Die moderne setzt die allerneuesten Browser voraus.
Ein Test mit echtem pdf.js ([pdfIntake.pdfjs.test.ts](client/src/pdfIntake.pdfjs.test.ts))
schlägt fehl, wenn jemand auf die moderne Fassung zurückwechselt.

## Konventionen & Fallstricke

- **Sprache im Code.** Bezeichner sind englisch: Variablen, Funktionen, Typen, Datei- und
  Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`,
  `rentLedger`, `buildCostItemBody`). Deutsch bleiben Kommentare, Oberflächentexte,
  Fehlermeldungen, Testnamen, Commit-Nachrichten und gespeicherte Fachwerte (`'vermietet'`,
  `'kaltwasser'`, die Kostenarten). Seitenkomponenten heißen wie die Seite (`Kosten.tsx`).
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
  laufen lassen (`npm run build` schließt dieselbe Prüfung für den Client ein).
- Der Server nutzt bewusst **`NKA_PORT`** statt `PORT` (generische `PORT`-Variablen von
  Preview-Tools kollidieren sonst mit Vite).
- Zielbild ist das kleine Mehrfamilienhaus in Eigenverwaltung: wenige Wohnungen, davon
  gegebenenfalls eine selbstgenutzte, kalte Betriebskosten. Heizung/Warmwasser nach HeizkostenV
  deckt das Tool derzeit nicht ab — Energie rechnen die Mieter direkt mit ihrem Versorger ab.
- **Maßstab für Erweiterungen** (siehe [CONTRIBUTING.md](CONTRIBUTING.md)): Mietfuchs muss für
  Vermieter ohne technische Vorkenntnisse nutzbar und einfach einzurichten bleiben. Die Technik
  darunter darf wachsen (Datenbank, Serverbetrieb), solange Skripte, Installer und
  Voreinstellungen die Einrichtung übernehmen. Architekturentscheidungen also nicht pauschal
  ausschließen, sondern daran messen, was beim Nutzer ankommt.
