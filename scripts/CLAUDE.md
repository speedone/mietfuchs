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
  beibehalten, das README verlinkt sie. Browser einmalig: `npx playwright install chromium`.
- **[browser-check.mjs](browser-check.mjs)** (`npm run browser-check`): derselbe Bestand plus
  Heizanlage, jede Seite der Navigation in Chromium, Firefox und WebKit, bei 1440 × 900 und
  390 × 844, hell und dunkel. Je Seite: keine Konsolenfehler, keine sichtbare Fehlermeldung, kein
  seitliches Scrollen, kein abgeschnittenes Feld (auch in Seitenfenstern, siehe client/CLAUDE.md),
  axe-core ohne serious/critical. Dazu Bedienproben per Tastatur (Seitenfenster, Monatsfeld,
  Begriff, Sammelmeldung, Menüblatt am Handy), axe auch auf diesen Zuständen. Jeder Befund: Exit 1
  und eine Zeile in `<out>/bericht.md`; Fotos in `--out` (Temp, nie im Repo). Ausnahmen für axe in
  [browser-check-axe.json](browser-check-axe.json) mit Grund und Anzahl, nur sinkend (heute leer;
  `--merge` fasst CI-Läufe zusammen). Eingrenzen mit `--engines`, `--views`, `--themes`, `--pages`
  (`--pages -` nur Bedienproben); eine unbekannte Seite, ein Lauf ohne Seite oder eine Seite aus
  nav.ts, die in der Navigation fehlt, ist ein Befund. WebKit braucht unter Linux GTK4, sonst im
  Container `mcr.microsoft.com/playwright:v<Fassung>-noble` (Befehl im Kopf des Skripts). Läuft in
  release.yml je Engine im vollen Prüfumfang. **Von Hand bleibt** „Als PDF sichern“ in Safari auf
  dem Mac (#286).

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

## Release

- [release.yml](../.github/workflows/release.yml) baut beim `v*`-Tag alle Ziele und hängt sie an:
  macOS als Zip, Linux als tar.gz (Ausführungsbit), Windows roh. **Die Namen der x64-Dateien bleiben
  fest**, der Update-Hinweis älterer Versionen sucht sie.
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
  Nicht in der CI, sondern von Hand vor jedem Release. Eine unbekannte Fallnummer bricht ab.
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
