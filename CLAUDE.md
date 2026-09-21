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
x64-Dateien bleiben fest, der Update-Hinweis älterer Versionen sucht sie darunter.

**Artefakt-Tests** (#22): Vor dem Anhängen startet jede Programmdatei auf einem GitHub-Runner
ihres Systems (Linux, Windows und macOS jeweils x64 und ARM64), die Linux-Dateien zusätzlich in
Containern von 15 Distributionen (CentOS 7 mit glibc 2.17 bis Ubuntu 26.04). Das Docker-Image
wird für amd64 und arm64 ebenso geprüft, bevor es veröffentlicht wird, und die CI prüft den
Start aus dem Quellcode. Alle nutzen [scripts/smoke-test.mjs](scripts/smoke-test.mjs): Es
prüft eine laufende Instanz von außen (Oberfläche mit allen Skriptteilen und pdf.js-Dateien,
KI-Auswertung gegen ein eigenes nachgebautes Ollama, Belege, Abrechnung, Backup und
Wiederherstellung, dazu die beim Start angelegte Datenbank aus `/healthz`) und braucht einen
leeren Datenordner. Lokal:
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
Pull Request das Label `volle-pruefung` an, wie beim KI-Prüflauf das Label `ki-pruefung`; das
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

**Persistenz**: eine einzige JSON-Datei `server/data/db.json`, atomar geschrieben (Temp +
rename) über [server/src/store.ts](server/src/store.ts). `NKA_DATA_DIR` verlegt den Ordner
(Tests, abweichende Ablage). Belege liegen in `server/data/uploads/`, API-Schlüssel externer
KI-Dienste getrennt davon in `server/data/secrets.json` (siehe secrets.ts; nicht im Backup).
Backup = diesen Ordner kopieren. Keine Datenbank, keine Migrationen-Tooling — Schema-Migrationen
älterer `db.json` passieren imperativ in `load()` in store.ts (z. B. fester Monatsbetrag →
Vorauszahlungs-Staffel). Beim Erweitern des Datenmodells dort die Migration ergänzen.

**Die Datenbank** (#55, im Entstehen): Die JSON-Datei wird durch SQLite abgelöst, später soll
auch PostgreSQL möglich sein. Die Grenze dafür zog der Schnappschuss (siehe unten); das Schema
dahinter steht in [server/src/db/schema.ts](server/src/db/schema.ts). Geöffnet wird sie
inzwischen beim Start ([server/src/db/open.ts](server/src/db/open.ts)), **gelesen und geschrieben
wird darin aber noch nichts**; das kommt in den nächsten Schritten, ebenso der Umstieg
vorhandener Bestände. Im Datenordner liegt deshalb eine noch leere `mietfuchs.sqlite` neben der
`db.json`.

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
  `/proc/self/mounts` und unter Windows am UNC-Pfad. Es gewinnt der längste passende
  Einhängepunkt, bei gleicher Länge der spätere: Gleich lang und beide im Pfad heißt derselbe
  Einhängepunkt, also ein Dateisystem über einem anderen, und wirksam ist dann das obere. Nicht
  erkannt werden ein verbundenes Netzlaufwerk unter Windows (Z:), alles unter macOS und die
  Freigaben einer virtuellen Maschine; gewarnt wird dann nicht, falsch gewarnt aber auch niemand.
- **Scheitert das Öffnen, startet der Server trotzdem** und arbeitet mit der db.json weiter, mit
  einer Meldung auf der Konsole und `database.open === false` in `/healthz`. An diesem Stand
  braucht niemand die Datenbank. **Mit dem Umstieg der Bestände kehrt sich das um**: Dann sind
  die Daten dort, ein Start ohne sie wäre ein Start ohne Daten, und der Eintrag gehört unter
  `checks`, damit ein Container den Fehler sieht.
- **Alle Schreibvorgänge laufen nacheinander**, durch die Schlange in open.ts
  (`createWriteQueue`, benutzt als `opened.write(...)`). Express bedient nebenläufig, und alle
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
  zu warten.
- **Verschachtelte Listen wurden Tabellen**: die drei Staffeln (`person_history`, `prepayments`,
  `base_rents`), die Jahreskorrektur (`prepayment_overrides`, nach Jahr geschlüsselt statt nach
  Datum) und die vereinbarten Anteile (`cost_item_shares`). In einer Spalte mit JSON ließe sich
  nichts zusichern: kein negativer Betrag, kein zweiter Eintrag zum selben Stichtag, kein
  Eintrag ohne Mietverhältnis. Bei `cost_item_shares` am deutlichsten, weil seine Schlüssel
  Wohnungs-Kennungen sind — index.ts geht sie beim Löschen einer Wohnung heute von Hand durch,
  und genau das erledigt jetzt `ON DELETE CASCADE`.
- **Die Einstellungen haben echte Spalten** (#60). Ein JSON-Klumpen hätte den Befund unverändert
  mitgenommen: `PUT /api/settings` übernimmt heute jeden Schlüssel des Rumpfes, auch einen
  erfundenen. Mit Spalten gibt es für ein unbekanntes Feld keinen Ort mehr. Die beiden Plätze
  der KI sind Zeilen in `ai_slots` und keine Spalten mit Präfix, weil `text` und `images`
  dieselbe Gestalt haben; die Bestätigung steht in derselben Zeile wie die Adresse, für die sie
  gilt. **Kein Feld für den API-Schlüssel**, der bleibt in `data/secrets.json`.
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

**API** ([server/src/index.ts](server/src/index.ts)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Löschen einer `unit` bzw. `meter` kaskadiert manuell auf abhängige Datensätze (auch `payments`
beim Löschen einer `unit`/`tenancy`). Daneben Spezialrouten:
`/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract` und `/api/intake` (KI-Auswertung, auf Wunsch als Strom, siehe
unten), die KI-Einstellungen `/api/ai/presets`, `/api/ai/status`, `/api/ai/key` und
`/api/ai/consent` sowie `/api/ollama/status` für ältere Tabs (alles siehe
KI-Belegauswertung), `/api/update` und `POST /api/update/check`
(Update-Hinweis, siehe unten), `/api/uploads` (Belegarchiv: Liste +
Löschen unverknüpfter Dateien), `/api/backup`/`/api/restore` (ZIP via adm-zip) sowie
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
Textebene, Scan und Foto. Start von Hand oder per Label `ki-pruefung` an einem PR. Neue
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
