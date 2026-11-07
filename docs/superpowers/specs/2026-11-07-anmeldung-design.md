# Anmeldung, wenn der Server von außen erreichbar ist (#528, Schritt 1)

Stand: Entwurf vom 07.11.2026, nach einer Gegenprüfung mit Sicherheitsblick überarbeitet (Muss-Befunde eingearbeitet), noch nicht freigegeben.
Umsetzt „Schritt 1“ aus dem Kommentar in #528 und den Punkt „Zugriffsschutz“ der 1.0-Checkliste in #447 („mindestens
ein optionales Passwort, dazu eine sichere Voreinstellung für Docker“). Schritt 2 (Kopplung des Fensters, eigenes
Zertifikat) wird nur so weit bedacht, dass Schritt 1 ihn nicht verbaut.

## Vom Projektinhaber bestätigt (07.11.2026)

- Eigener schmaler Kern auf `node:crypto`, keine Bibliothek für die Anmeldung.
- Übergang in zwei Stufen: Stufe A in 0.17.0 (neue, von außen erreichbare Datenordner starten in der Einrichtung, bestehende bleiben offen mit Hinweis), Stufe B (Pflicht) ab 1.0.0-rc.1.
- Sitzung 30 Minuten ohne Aktivität, höchstens 8 Stunden.
- Passwort mindestens 15 Zeichen, mit Vorschlag für eine Passphrase.
- Docker mit `-p 127.0.0.1:…` bekommt die Anmeldung auch; `NKA_AUTH=off` steht in der Doku.
- Aufgabe 0 (Sperre am eigenen Rechner bei anderer Schreibweise des Pfads) ist #585 und kommt vorab als 0.16.1.

## Ziel

Wer Mietfuchs so betreibt, dass andere Geräte es erreichen (Docker, Programmdatei, Linux-Paket, `npm start`,
Programmfenster mit „Zugriff aus dem Heimnetz“), schützt seinen Bestand mit einem Passwort. Wer Mietfuchs nur auf dem
eigenen Rechner nutzt (Programmfenster, Store), merkt nichts. Ein frisch eingerichteter Docker-Container verlangt das
Passwort von Anfang an. Bestehende Installationen werden nicht ausgesperrt: Sie bekommen erst einen Hinweis, die
Pflicht folgt mit Vorwarnung.

## Ist-Stand

### Wo der Server lauscht

| Betriebsart (`RUNTIME`, server/src/version.ts:16, 61-77) | Lausch-Adresse | Quelle |
| --- | --- | --- |
| `desktop`, `store` (Programmfenster) | `127.0.0.1`, mit „Zugriff aus dem Heimnetz“ `0.0.0.0` | desktop/src/server.js:64 (`serverEnv`), Schalter desktop/src/main.js:283-290 |
| `binary`, `package` (Programmdatei, Linux-Paket) | alle Netzwerkkarten (`NKA_HOST` fehlt) | server/src/index.ts:4580, `server.listen(PORT, HOST)` 4818 |
| `docker` | alle Karten im Container; nach außen entscheidet `-p` (deploy/compose.yml: `"3001:3001"`, also alle Karten des Rechners) | Dockerfile (`EXPOSE 3001`, kein `NKA_HOST`), deploy/compose.yml:11-12 |
| `npm` (`npm start`, `npm run dev`) | alle Netzwerkkarten | server/src/index.ts:4580 |

`NKA_HOST` muss eine IP-Adresse sein (index.ts:4581-4583). Der Browser der Programmdatei öffnet
`http://127.0.0.1:<port>` (index.ts:5035, 5076), das Fenster lädt die Adresse, die `startServer` liefert, ebenfalls
auf 127.0.0.1 (desktop/src/main.js:532, 546).

### Was schon geprüft wird

1. **Content-Security-Policy** für alles außer `/uploads` (index.ts:136-144), `/uploads` mit `sandbox` und `nosniff`
   (index.ts:1762-1771).
2. **Host und Origin** (#517, server/src/requestGuard.ts, eingesetzt index.ts:146-158): Host nur als IP, `localhost`,
   Name ohne Punkt, Endungen des Heimnetzes (requestGuard.ts:32) oder aus `NKA_ALLOWED_HOSTS`; schreibende Anfragen nur
   mit passendem `Origin` bzw. ohne `Sec-Fetch-Site: cross-site` (requestGuard.ts:59-90). **In Docker und npm aus,
   solange `NKA_ALLOWED_HOSTS` fehlt** (requestGuard.ts:21-27), wegen Reverse-Proxys, die den Host umschreiben.
3. **Vermerk „umgezogen“**: Schreibendes außer `/api/quit` und `/api/update/check` bekommt 423 (index.ts:160-169).
4. **Nur vom eigenen Rechner** (`fromThisComputer`, index.ts:3356: Adresse der Verbindung ist 127.0.0.1, ::1 oder
   ::ffff:127.0.0.1):
   - alle Routen unter `/api/relocation` außer der schnellen Frage und dem Fortschritt (index.ts:3360-3365, 3412 ff.);
   - im Fenster (`IN_WINDOW`) `POST /api/quit`, Schreibendes an `/api/ai/key` und `/api/ai/consent`
     (`AT_THIS_COMPUTER`, index.ts:384-395) und das Ändern von `updateCheck` (index.ts:400-402);
   - der Update-Hinweis ohne Download für andere Geräte (`updateFor`, index.ts:4316).

   **Lücke (Durchsicht):** Die Muster in `AT_THIS_COMPUTER` (index.ts:385-386) unterscheiden Groß und Klein und
   verlangen das genaue Ende, Express 5 dagegen nicht (`caseSensitive: false`, `strict: false`). `POST /API/QUIT`,
   `/api/quit/` oder `/API/ai/key` vom Handy kommen im Fenster mit Heimnetz durch. Behoben wird das vor der Anmeldung
   (Aufgabe 0 im Plan), denn die Anmeldung baut darauf, dass eine Sitzung vom Handy diese Sperren nicht öffnet.
5. **Testgriffe im Fenster** nur mit `CI` und `MIETFUCHS_TESTGRIFFE=1`; `NKA_ALLOWED_HOSTS` erbt der Server des
   Fensters nicht (desktop/src/server.js:72-81, desktop/src/testGrips.js).

### Was ohne Prüfung offen ist

- **Alle Daten-Routen** (`/api/*`), Belege (`/uploads/*`), Backup (`GET /api/backup`), Wiederherstellen, Löschen,
  Einstellungen samt KI-Anbieter: für jedes Gerät, das den Port erreicht.
- **`POST /api/quit`** bei der Programmdatei und dem Paket (`STANDALONE`, index.ts:4365): Jedes Gerät im Heimnetz
  beendet Mietfuchs. Die Sperre aus `AT_THIS_COMPUTER` gilt nur im Fenster.
- **`/healthz`** (index.ts:4332-4338) nennt Version, Datenordner (`dataDir`), Datenbankdatei und Zustand. Es braucht
  der HEALTHCHECK im Dockerfile (über 127.0.0.1 im Container), `instanceGuard.ts` (über 127.0.0.1) und die Oberfläche
  (client/src/components/Database.tsx:106, client/src/pages/Einstellungen.tsx:60).
- **`/api/update`** (index.ts:4318-4324) nennt die Version.
- Die Oberfläche selbst (index.html, Skripte, Stile, Manifest; index.ts:4501-4529) enthält keine Daten.

Die Texte sagen das offen: „Mietfuchs hat kein Login“ (docs/docker.md:28, deploy/compose.yml:7,
deploy/compose.ollama.yml:9), „Mietfuchs hat kein Passwort“ (README.md:189, docs/installation.md:205,
docs/datenschutz.md:52-61, client/src/components/NetworkCard.tsx:39). Für Docker empfiehlt docs/docker.md:124-135
bisher ein Passwort im vorgeschalteten Proxy.

### Was nicht ins Backup geht

Das Backup-ZIP packt den Schnappschuss der Datenbank, `uploads/` und das Briefpapier, auf das eine Gestaltung verweist
(server/src/db/CLAUDE.md, „Backup“). `secrets.json` bleibt draußen (server/src/secrets.ts:1-4), ebenso die
Vorversionen. Einstellungen stehen in der Datenbank (`readSettings`, index.ts:335) und gehen damit ins Backup und in
jede Vorversion.

### Prüfungen, die heute einen Server starten

`startServerIn`/`startServerRaw` (server/testing/api.ts:298, 382; `NKA_PORT=0`, ohne `NKA_HOST`, also alle Karten),
scripts/smoke-test.mjs (gegen eine laufende Instanz: ci.yml:85 npm, docker.yml:124-127 Docker mit `--network host`,
release.yml:405-513 Programmdatei und Pakete), scripts/umstieg-praxislauf.mjs:51-52, scripts/fenster-umzug-praxislauf.mjs
(setzt `NKA_HOST=127.0.0.1`, Zeile 192), scripts/screenshots.mjs, scripts/browser-check.mjs, scripts/perf-check.mjs,
scripts/desktop-check.mjs. api-fenster.test.ts startet Server mit `NKA_HOST=0.0.0.0` und ruft sie über die Adresse der
Netzwerkkarte auf (Zeilen 33, 165, 206, 220).

## Bedrohungsmodell

Geschützt werden Mieterdaten (Namen, Anschriften, IBAN, Zahlungen), Belege und die Abrechnungen; dazu die
Verfügbarkeit (Beenden, Löschen, Wiederherstellen eines fremden Backups).

| Angreifer | Weg heute | Mit Schritt 1 |
| --- | --- | --- |
| **Mitbewohner, Familie** im selben WLAN | öffnet `http://<rechner>:3001` und liest oder ändert alles | braucht das Passwort; die Bremse macht Raten aussichtslos |
| **Gäste-WLAN**, das nicht vom Heimnetz getrennt ist | wie oben | wie oben |
| **Kompromittiertes Gerät im Netz** (Kamera, Fernseher, NAS-Dienst mit Lücke) | scannt das Netz und liest den Bestand automatisch | braucht das Passwort. Über HTTP kann ein Gerät, das den Verkehr mitschneidet (ARP-Spoofing), Passwort und Sitzung lesen; das schließt erst die Verschlüsselung in Schritt 2 |
| **Fremde Webseite im Browser des Vermieters: CSRF** | Formular oder `fetch` ohne CORS an Mietfuchs; in Docker und npm ohne `NKA_ALLOWED_HOSTS` ungeprüft | Sitzungscookie `SameSite=Strict` geht bei Anfragen von fremden Seiten nicht mit; zusätzlich Origin-Prüfung bei jeder schreibenden Anfrage, auch in Docker und npm (siehe „Origin“) |
| **Fremde Webseite: DNS-Rebinding** | der Name der fremden Seite zeigt auf 192.168.x.y, die Seite liest Mietfuchs als eigenen Ursprung; in Docker und npm ohne `NKA_ALLOWED_HOSTS` ungeprüft | das Cookie gehört zur Adresse von Mietfuchs, nicht zum fremden Namen: Die Seite bekommt 401. Raten über diesen Weg bremst die Bremse. Die Host-Prüfung bleibt wie sie ist |
| **Anderer Dienst auf demselben Rechner, anderer Port** (zweite Web-Oberfläche auf dem NAS) | wie jedes Gerät | Cookies trennen keine Ports: Der Browser schickt das Cookie auch an `http://nas:8080`. `HttpOnly` hält Skripte dort fern, aber der Server dort sieht das Cookie. Hingenommen und dokumentiert („alles auf einem Rechner gilt als eine Vertrauenszone“); Schritt 2 mit HTTPS und `__Host-` ändert daran nichts, das Ende ist der Port je Rechnername |
| **Reverse-Proxy auf demselben Rechner** (Proxy auf dem Host leitet an `127.0.0.1:3001`) | jede Anfrage kommt über 127.0.0.1 und sähe aus wie „vom Rechner selbst“ | deshalb entscheidet die **Lausch-Adresse**, nicht die Adresse der Anfrage (siehe unten). Lauscht Mietfuchs nur auf 127.0.0.1 und kommt eine Anfrage mit Kopfzeilen eines Proxys, gilt sie als von außen |
| **Wer auf dem Server-Rechner Programme ausführt oder den Datenordner liest** | liest die Datenbank direkt | außerhalb des Modells; er darf das Passwort zurücksetzen (das ist der Weg für „Passwort vergessen“) |
| **Internet** | nur bei Portfreigabe, wovon alle Texte abraten | weiter: nie ins Internet stellen. Schritt 1 ist kein Schutz für das offene Internet (kein HTTPS, kein zweiter Faktor) |

**Nicht-Ziele**: Benutzer und Rollen (eine Anmeldung je Bestand, Verwaltung für Dritte gehört nicht zum Zielbild #91),
E-Mail zum Zurücksetzen, zweiter Faktor, Verschlüsselung (Schritt 2), Schutz vor jemandem mit Zugriff auf den
Datenordner.

## Entscheidungen zu den offenen Fragen aus #528

### 1. Woran erkennt der Server „von außen erreichbar“?

**Entscheidung: an der Lausch-Adresse.** `reachable = 'local'`, wenn `NKA_HOST` eine Loopback-Adresse ist
(`127.0.0.0/8`, `::1`, `::ffff:127.x.y.z`), sonst `'network'` (fehlt, `0.0.0.0`, `::`, eine Adresse einer
Netzwerkkarte). Die Adresse der einzelnen Anfrage entscheidet **nicht**, ob eine Anmeldung nötig ist.

Begründung: Ein Reverse-Proxy auf demselben Rechner lässt jede Anfrage von 127.0.0.1 kommen; mit der Anfrage-Adresse
wäre jede solche Installation ohne Schutz, ohne dass es jemand merkt. Die Lausch-Adresse kann niemand von außen
fälschen. Im Container lauscht Mietfuchs immer auf allen Karten und weiß nicht, wie `-p` den Port freigibt; er gilt
deshalb immer als `network`. Wer Docker mit `-p 127.0.0.1:3001:3001` betreibt, setzt `NKA_AUTH=off`, wenn er die
Anmeldung nicht will.

Zwei Ergänzungen, beide machen nur strenger:

- **Proxy-Kopfzeilen bei `local`**: Trägt eine Anfrage an einen nur lokal lauschenden Server `Forwarded`,
  `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP` oder `Via`, gilt sie als von außen: mit eingerichtetem Passwort
  braucht sie eine Sitzung; ohne Passwort geht sie durch wie bisher, Mietfuchs schreibt aber einmal je Start eine Zeile
  ins Protokoll („Anfragen über einen Proxy erreichen Mietfuchs ohne Passwort …“) und die Oberfläche zeigt den Hinweis
  aus Abschnitt 2. Eine gefälschte Kopfzeile kann nur strenger machen, nie lockerer. Ein Proxy, der keine dieser
  Kopfzeilen setzt, bleibt unerkannt; dafür gibt es `NKA_AUTH=on`, die Doku zum Proxy nennt es.
- **`NKA_AUTH`**: `auto` (Voreinstellung, wie oben), `on` (Anmeldung auch bei `local`), `off` (nie; die Oberfläche
  sagt „von der Umgebung abgeschaltet“). Ein anderer Wert verhindert den Start mit Satz, wie bei `NKA_HOST`. Das Fenster
  reicht `NKA_AUTH` nur mit den Schranken der Testgriffe weiter (desktop/src/server.js:72-81), sonst schaltete eine
  geerbte Variable den Schutz still ab.

### 2. Bestehende Installationen: Pflicht nach dem Update oder freiwillig?

**Entscheidung: Übergang in zwei Stufen; neue Datenordner von Anfang an geschützt.**

Zustände des Zugangs (`AccessMode`), gespeichert in `zugang.json` im Datenordner (Abschnitt „Technik“):

| Zustand | Bedeutung | Wer kommt hinein |
| --- | --- | --- |
| `setup` | Passwort verlangt, noch keines gesetzt | niemand außer der Einrichtung (mit Einmal-Code) und dem Fenster |
| `password` | Passwort gesetzt | nur mit Sitzung (bzw. das Fenster) |
| `off` | bewusst ohne Passwort, mit Warnung bestätigt | jeder |
| *(keine Datei)* | noch nicht entschieden | siehe Stufen |

- **Stufe A (erste Fassung mit Anmeldung, Vorschlag 0.17.0):**
  - **Neuer Datenordner** (beim Start kein Bestand nach `hasStock`, server/src/dataLocations.ts:62, und keine
    `zugang.json`) und `network`: Mietfuchs legt sofort `zugang.json` mit `setup` an. Das ist die sichere
    Voreinstellung für Docker (#447) und gilt ebenso für Programmdatei, Paket und `npm start`.
  - **Bestehender Bestand ohne `zugang.json`** und `network`: **Übergang**. Alles geht wie bisher, ohne Anmeldung.
    Mietfuchs schreibt bei jedem Start ins Protokoll, dass es ohne Passwort im Netz erreichbar ist, samt Einmal-Code
    und Ort der Code-Datei; die Oberfläche zeigt auf jeder Seite einen ruhigen Hinweis (wie „Im Heimnetz erreichbar“)
    mit „Passwort festlegen“ und „Ohne Passwort weiter“ und nennt die Fassung, ab der das Passwort verlangt wird.
    Es wird nichts geschrieben, damit Stufe B greift.
  - `local` (Fenster ohne Heimnetz, Store, `NKA_HOST=127.0.0.1`): keine Anmeldung, kein Hinweis, keine Datei.
- **Stufe B (Vorschlag 1.0.0-rc.1, angekündigt in den Release-Notes von Stufe A und im Hinweis):** Eine fehlende
  `zugang.json` bei `network` heißt `setup`, auch mit Bestand. Wer in Stufe A „Ohne Passwort weiter“ gewählt hat
  (`off`), bleibt dabei.

Begründung: Das Zielbild sagt „wer nichts einstellt, merkt nichts“; gemeint ist der Vermieter am eigenen Rechner, und
der arbeitet seit 0.15 im Programmfenster auf 127.0.0.1: Er merkt in keiner Stufe etwas. Wer Mietfuchs heute im Netz
betreibt, hat sich für einen Server entschieden; ihm gegenüber wiegt #447 („sichere Voreinstellung für Docker“) und die
1.0-Zusage, dass sich der Betrieb in 1.x nicht ohne Vorwarnung ändert. Deshalb die Pflicht vor 1.0 und mit einer Fassung
Vorlauf. **Niemand wird ausgesperrt**: Der Code steht immer auf dem Server-Rechner (Konsole bzw. `docker logs` und
Datei), und das Zurücksetzen geht ohne Oberfläche (Abschnitt „Passwort vergessen“). Die Programmdatei öffnet ihren
Browser beim Start mit dem Code im Fragment (`http://127.0.0.1:3001/#einrichtung=<code>`), so ist die Einrichtung am
Rechner selbst ein Schritt. Das Fragment geht nicht an den Server und nicht in den Referer; es steht nur im Verlauf
des Browsers auf dem Server-Rechner und gilt nur bis zur Einrichtung.

Warum nicht Pflicht schon in Stufe A: Ein NAS ohne Bildschirm, das nach `docker compose pull` plötzlich nur noch eine
Einrichtungsseite zeigt, wirkt für Vermieter ohne Vorkenntnisse wie ein Datenverlust. Warum nicht dauerhaft freiwillig:
Dann bliebe jede bestehende Installation offen, und #447 verlangt die sichere Voreinstellung.

### 3. Programmfenster mit Zugriff aus dem Heimnetz (#531)

**Entscheidung: Das Fenster gilt als angemeldet, über einen Fensterschlüssel je Start.**

- Der Hauptprozess erzeugt je Serverstart 32 Zufallsbytes und gibt sie als `NKA_WINDOW_KEY` an den utilityProcess
  (`serverEnv`; eine geerbte Angabe wird immer ersetzt). Er hängt sie über
  `session.webRequest.onBeforeSendHeaders` mit dem Filter `<origin>/*` als Kopfzeile `X-Mietfuchs-Window` an jede
  Anfrage der eigenen Seite.
- Der Server erkennt den Schlüssel nur bei `IN_WINDOW` (oder nachgestellt mit `NKA_RUNTIME=desktop`), nur über eine
  Verbindung von 127.0.0.1/::1 (`fromThisComputer`) und vergleicht ihn zeitkonstant (`crypto.timingSafeEqual` über
  SHA-256 beider Werte). Dann gilt die Anfrage als angemeldet und als „am Rechner selbst“: Einrichtung ohne Code.
- Begründung: Wer vor dem Rechner sitzt, soll sich am eigenen Fenster nicht anmelden müssen; das wäre bei jedem Start
  eine Hürde ohne Schutzwert, denn wer auf diesem Rechner Programme ausführt, liest die Datenbank ohnehin. Eine
  Ausnahme nach Anfrage-Adresse allein schiede am Reverse-Proxy (Abschnitt 1). Der Schlüssel verlässt den Rechner nie
  (das Fenster spricht 127.0.0.1) und gilt nur bis zum nächsten Start.
- **Anfragen des Hauptprozesses** (Durchsicht): `session.webRequest` erfasst nur Anfragen der Seite. Wo der
  Hauptprozess selbst den Server fragt (`readConsent` mit `/api/settings`, desktop/src/main.js:595; `stopServer` mit
  `/api/quit`, Zeile 252), setzt er die Kopfzeile selbst über einen gemeinsamen Helfer `serverFetch`. Ein Test in
  desktop/test verlangt, dass main.js kein anderes `fetch(origin …` enthält.
- Umgebung statt `parentPort`: Die Nachricht käme erst nach dem Start an, eine Umgebungsvariable ist vor der ersten
  Anfrage da. Sie ist für Programme desselben Benutzers lesbar; die lesen die Datenbank auch.
- **Einschalten des Heimnetz-Zugriffs** (NetworkCard.tsx): Gibt es noch kein Passwort, fragt die Karte im selben
  Entwurf danach (zwei Felder) oder bietet „Ohne Passwort“ mit der bisherigen Warnung. Gespeichert wird erst beim
  Bestätigen; die Einrichtung läuft über den Fensterschlüssel, ohne Code. Wer den Zugriff schon heute an hat, ist im
  Übergang (Abschnitt 2) und sieht den Hinweis im Fenster.
- **„Im Browser öffnen“** (Menü des Fensters, desktop/src/main.js:394) öffnet den Standardbrowser ohne Schlüssel: Ist
  das Heimnetz an und ein Passwort gesetzt, fragt der Browser danach. Ohne Heimnetz lauscht der Server lokal, dann
  ohne Anmeldung wie heute.
- **Schritt 2** baut darauf auf: Ein gekoppeltes Fenster auf einem anderen Rechner bekommt statt des Fensterschlüssels
  einen dauerhaften Geräteschlüssel derselben Kopfzeile, über HTTPS und mit Liste in `zugang.json`.

### 4. Passwort-Hash und Einmal-Code im Backup?

**Entscheidung: nein.** Beides steht in eigenen Dateien im Datenordner (`zugang.json`, `einrichtungscode.txt`),
nicht in der Datenbank. Damit gehen sie weder ins Backup-ZIP noch in Vorversionen noch in den Schnappschuss; ein
Rücksprung im Verlauf ändert das Passwort nicht.

Begründung: Ein Backup landet schnell in einer Cloud oder auf einem USB-Stick (dieselbe Begründung wie bei
`secrets.json`, secrets.ts:1-4); ein Hash darin lädt zum Raten ohne Bremse ein. Nach dem Wiederherstellen auf einem
neuen Rechner gilt dessen Zustand (meist `setup` mit neuem Code); auf demselben Rechner bleibt das Passwort. Ein
eingespieltes Backup ändert den Zugang nie. Beim **Umzug ins Programmfenster** wird `zugang.json` nicht übernommen
(anders als `secrets.json`): Das Fenster lauscht zunächst lokal, und beim Einschalten des Heimnetzes richtet man das
Passwort im Fenster ohne Code ein. Für das Zertifikat aus Schritt 2 gilt dasselbe (eigene Datei, nicht im Backup).

### 5. Automatische Prüfungen einfach halten

**Entscheidung: Prüfungen laufen lokal ohne Anmeldung; wo die Voreinstellung geprüft werden soll, richtet das
Prüfskript das Passwort mit dem Code aus der Datei ein.**

- `startServerIn`/`startServerRaw` setzen `NKA_HOST: '127.0.0.1'` **vor** `...env` (ein Test, der das Netz braucht,
  setzt `0.0.0.0`) und `NKA_AUTH: ''`. Damit bleibt jeder heutige Test unverändert, und Tests öffnen keinen Port mehr
  im Netz des Entwicklers. Neuer Helfer `signIn(server, password?)` in server/testing/api.ts: liest den Code aus
  `einrichtungscode.txt`, richtet ein, gibt ein `fetch` mit Cookie zurück. api-fenster.test.ts (`0.0.0.0`) bekommt
  `NKA_AUTH: 'off'` oder `signIn`, je nachdem, ob der Test die Loopback-Sperre oder die Anmeldung prüft.
- scripts/smoke-test.mjs bekommt `--code-file <pfad>`: Meldet `GET /api/auth` `setup`, richtet es ein, sonst wie
  bisher; alle Aufrufe gehen über einen Helfer mit Cookie. docker.yml liest die Datei mit
  `docker exec pruefung-$arch cat /app/server/data/einrichtungscode.txt` und prüft damit **die Voreinstellung des
  Images**. ci.yml (npm) und release.yml (Programmdatei, Pakete) geben den Pfad im Wegwerf-Datenordner an.
- Bildschirmfotos, Browserlauf, Leistungsprüfung, Praxisläufe setzen `NKA_HOST=127.0.0.1` (wie fenster-umzug-praxislauf
  heute). Der Browserlauf startet zusätzlich einen Server mit `0.0.0.0` und prüft Anmelde- und Einrichtungsseite mit
  axe; die Bildschirmfotos nehmen die Anmeldeseite auf.
- Die Regel „NKA_DATA_DIR, CI, NKA_UPDATE_URL immer zusammen“ (CLAUDE.md) bekommt `NKA_HOST=127.0.0.1` als Empfehlung
  dazu; der Wächter in api-start.test.ts verlangt es nicht (Tests mit `0.0.0.0` sind erlaubt).

### 6. Passwort vergessen, zurücksetzen

**Entscheidung: nur vom Server-Rechner, über eine Datei im Datenordner.** Legt man im Datenordner eine Datei
`passwort-zuruecksetzen` an (Inhalt egal), setzt Mietfuchs beim nächsten Start oder spätestens bei der nächsten
Anmeldung den Zustand auf `setup`, erzeugt einen neuen Code, meldet alle Sitzungen ab, schreibt Code und Datei ins
Protokoll und löscht die Datei. Docker: `docker compose exec mietfuchs touch /app/server/data/passwort-zuruecksetzen`,
dann `docker compose logs mietfuchs`. Windows und Mac: Datei im Ordner anlegen, den die Einstellungen unter „Datenort“
nennen. Wer `zugang.json` löscht, landet ebenfalls wieder bei der Einrichtung (in Stufe A mit Bestand im Übergang).

Begründung: Ein Kommandozeilen-Schalter der Programmdatei ginge unter Windows nur mit Eingabeaufforderung, und im
Container liefe neben dem Server ein zweiter Prozess auf derselben Datenbank. Eine Datei kann jeder anlegen, der den
Ordner erreicht, und genau der darf zurücksetzen. Geprüft wird nur mit `fs.existsSync`, ohne Inhalt zu lesen.

## Technik

Quellen: OWASP Cheat Sheet Series, „Password Storage“, „Authentication“, „Session Management“
(https://cheatsheetseries.owasp.org/, abgerufen am 07.11.2026). Keine neue Abhängigkeit: `node:crypto` (`scrypt`,
`randomBytes`, `timingSafeEqual`, `createHash`), Cookies werden von Hand gelesen und gesetzt (ein Name, kein Parser
nötig). Unter Bun stehen dieselben Funktionen bereit; eine Prüfung der Programmdatei deckt es ab (Aufgabe 6).

### Dateien im Datenordner

- **`zugang.json`** (Unix 0600, über Zwischendatei und Umbenennen wie `secrets.json`):
  ```json
  { "version": 1, "mode": "password", "instance": "3f9a1c", "hash": "scrypt$17$8$1$<salz b64>$<schlüssel b64>",
    "changedAt": "2026-11-07T10:00:00.000Z" }
  ```
  `mode` ist `setup`, `password` oder `off`. `instance` (6 Hex-Zeichen, einmal erzeugt) macht den Cookie-Namen
  eindeutig, wenn zwei Mietfuchs auf einem Rechner laufen. Eine unlesbare oder verdorbene Datei gilt als `setup`
  (streng, nie offen) und wird im Protokoll genannt; sie verhindert den Start nicht. Platz für Schritt 2 (`devices`).
- **`einrichtungscode.txt`** (0600): der Einmal-Code, solange `setup` gilt oder der Übergang läuft; nach der
  Einrichtung gelöscht. Neu je Start, damit Datei und Protokoll übereinstimmen.
- **`passwort-zuruecksetzen`**: siehe oben.

### Passwort

- **Hash**: `crypto.scrypt` mit N = 2^17, r = 8, p = 1 (OWASP Password Storage, erste der empfohlenen
  Mindesteinstellungen, 128 MiB), Salz 16 Zufallsbytes je Passwort, Schlüssel 32 Bytes, `maxmem` 256 MiB. Die
  Parameter stehen im gespeicherten Wert, damit eine spätere Fassung sie anheben kann (bei der nächsten Anmeldung neu
  gehasht). Vergleich mit `timingSafeEqual`. **Höchstens eine Berechnung zugleich** (Schlange), damit parallele
  Anmeldeversuche einen Raspberry Pi nicht ins Speicherende treiben. Ohne Pepper: Er läge auf derselben Platte.
- **Regeln** (OWASP Authentication): mindestens 15 Zeichen, weil es keinen zweiten Faktor gibt; höchstens 128; keine
  Regeln für Zeichenarten; Leerzeichen erlaubt, Unicode als NFC. Abgelehnt werden nur Passwörter aus einem
  wiederholten Zeichen und solche, die „mietfuchs“ enthalten. Ein Abgleich mit bekannt gewordenen Passwörtern bräuchte
  das Internet oder eine große Liste; die Länge deckt den Zweck hier ab (bewusst ausgelassen). Die Oberfläche schlägt
  einen Satz aus drei, vier Wörtern vor.
- **Erneut bestätigen**: Passwort ändern, Anmeldung ausschalten und „Auf allen Geräten abmelden“ verlangen das
  bisherige Passwort (OWASP Authentication, „require the current credentials“). Nach einer Änderung sind alle anderen
  Sitzungen ungültig, die eigene wird erneuert.

### Einmal-Code

12 Zeichen aus 32 Zeichen ohne Verwechslung (ohne 0/O, 1/I/L), angezeigt in drei Vierergruppen (`K7QM-4XPA-9TRW`),
also 60 Bit; Eingabe ohne Rücksicht auf Groß/Klein, Bindestrich und Leerzeichen. Er gilt für `POST /api/auth/setup`
(Passwort setzen oder „ohne Passwort“), unterliegt derselben Bremse und ist nach Gebrauch verbraucht. Ausgegeben auf
der Konsole bzw. im Docker-Protokoll:

```
Mietfuchs ist im Netz erreichbar und noch ohne Passwort.
Einrichtungscode: K7QM-4XPA-9TRW  (auch in /app/server/data/einrichtungscode.txt)
```

### Sitzung

- **Kennung**: 32 Zufallsbytes, base64url (OWASP Session Management: mindestens 64 Bit Entropie, bevorzugt 160 und
  mehr). Der Server hält nur den SHA-256 der Kennung, im Arbeitsspeicher; ein Neustart meldet alle ab. Höchstens 50
  Sitzungen, die älteste fällt heraus. Bei jeder Anmeldung eine neue Kennung (gegen Session Fixation).
- **Cookie** `mietfuchs_<instance>`: `HttpOnly`, `SameSite=Strict`, `Path=/`, ohne `Domain`, ohne `Max-Age` (endet mit
  dem Browser). `Secure` nur, wenn die Seite über HTTPS kam: `X-Forwarded-Proto: https` bzw. `Forwarded: proto=https`
  oder ein `Origin` mit `https:`. Eine gefälschte Angabe schadet nicht: Über HTTP verwirft der Browser ein Cookie mit
  `Secure`, der Fälscher meldet nur sich selbst nicht an. `__Host-` geht erst mit HTTPS (Schritt 2).
- **Laufzeit**: 30 Minuten ohne Anfrage, höchstens 8 Stunden ab Anmeldung (OWASP Session Management: Leerlauf 15-30
  Minuten bei geringem Risiko, absolut 4-8 Stunden). Abgelaufen heißt 401; die Oberfläche zeigt die Anmeldung als
  Dialog über der Seite, Formulare bleiben stehen (Entwürfe #309 ohnehin im Browser). „Angemeldet bleiben“ kommt als
  Geräteschlüssel mit Schritt 2.
- **Abmelden**: `POST /api/auth/logout` löscht die Sitzung auf dem Server und das Cookie
  (OWASP: serverseitig ungültig machen).

### Vorschaltung (Reihenfolge in index.ts)

1. CSP (unverändert), 2. Host-Prüfung (unverändert), 3. **Zugangsprüfung** (neu, vor dem Vermerk „umgezogen“ und vor
`express.json()`, damit ungeprüfte Rümpfe nicht gelesen werden), 4. Vermerk, 5. `express.json()`, …

Die Zugangsprüfung (`accessGate`, reine Entscheidung in `server/src/access.ts`, wie `checkRequest`).
**Pfade vergleicht sie so, wie Express sie zuordnet**: ohne Rücksicht auf Groß und Klein und mit oder ohne
Schrägstrich am Ende (Express 5, `caseSensitive: false`, `strict: false`). Geschützt ist alles, was auf
`/^\/(api|uploads|healthz)(\/|$)/i` passt; die Freiliste vergleicht den klein geschriebenen Pfad ohne Schrägstrich am
Ende. Ein `startsWith('/api/')` oder `=== '/healthz'` gäbe `/API/backup`, `/Uploads/x.pdf`, `/HEALTHZ` und `/healthz/`
ohne Anmeldung frei (derselbe Fehler stand schon einmal in der CSP, Kommentar index.ts:136-140).

- **Nicht nötig**, wenn `reachable === 'local'` ohne Proxy-Kopfzeilen, `NKA_AUTH=off`, Zustand `off` oder Übergang.
- **Ohne Sitzung frei**: `GET`/`HEAD` auf Pfade außer `/api/*`, `/uploads/*` und `/healthz` (die Oberfläche, Skripte,
  Stile, Manifest, Symbole; enthalten keine Daten), `GET /api/auth`, `POST /api/auth/login`, `POST /api/auth/setup`,
  `POST /api/auth/logout`, `/healthz` (siehe unten).
- **Sonst** gültige Sitzung oder Fensterschlüssel, sonst 401 `{ error: 'Bitte melden Sie sich an.', login: true }`
  (bzw. `setup: true`). Gilt auch für `/uploads`, `/api/backup`, `/api/quit`, `/api/update`, die ND-JSON-Ströme der KI-Auswertung.
- **`Cache-Control: no-store`** auf `/api/*` und `/uploads/*`, solange die Anmeldung gilt (OWASP Session Management,
  Caching), damit auf einem geteilten Gerät nach dem Abmelden nichts im Zwischenspeicher steht.
- **`/healthz`**: voll für Verbindungen von 127.0.0.1/::1 (HEALTHCHECK, `instanceGuard`) und mit Sitzung; sonst nur
  `{ app: 'mietfuchs', status }` mit demselben Statuscode. Ein Proxy auf demselben Rechner bekommt dadurch den vollen
  Bericht (Datenordner, Version): hingenommen, er enthält keine Mieterdaten.
- Die bestehenden Sperren `fromThisComputer`, `AT_THIS_COMPUTER` und der Umzug bleiben **zusätzlich**; eine Sitzung
  vom Handy öffnet sie nicht.
- **`POST /api/quit` von 127.0.0.1/::1 ohne Proxy-Kopfzeilen geht ohne Sitzung** (Durchsicht): Das Fenster beendet
  seinen Server aus dem Hauptprozess (`stopServer`, desktop/src/main.js:252), der Umzug beendet eine alte Fassung
  (`quit-old`, index.ts:3509), und ein Server von einem früheren Start hat einen Schlüssel, den niemand mehr kennt.
  Ohne diese Ausnahme bekäme das Beenden 401, `busy` ginge verloren, und nach der Wartezeit folgte `child.kill()`
  mitten in einem Wiederherstellen. Mehr als ein Beenden erlaubt die Ausnahme nicht; der Rechner selbst gehört zur
  Vertrauenszone.

### Origin bei Schreibzugriffen

Solange die Anmeldung gilt, prüft die Zugangsprüfung jede Anfrage außer `GET`/`HEAD`/`OPTIONS` (auch `login`,
`setup`, `logout`) auch dann, wenn die Host-Prüfung aus ist (Docker, npm), in dieser Reihenfolge:

1. **`Sec-Fetch-Site` vorhanden**: nur `same-origin` geht durch (bzw. `none` bei einer Eingabe in die Adresszeile,
   für Schreibzugriffe ohne Bedeutung). Der Browser setzt die Kopfzeile selbst, keine Seite kann sie fälschen, und sie
   hängt nicht am Host. Damit bleiben Proxys nutzbar, die den Host umschreiben und kein `X-Forwarded-Host` setzen
   (die verbreitete Voreinstellung; der Grund, warum requestGuard.ts:13-15 die Host-Prüfung in Docker abschaltet).
2. **Sonst `Origin` vorhanden**: muss zum `Host`, zum ersten Wert von `X-Forwarded-Host` oder zu einem Namen aus
   `NKA_ALLOWED_HOSTS` passen; `Origin: null` wird abgelehnt.
3. **Beides fehlt**: kein Browser, also kein CSRF; es entscheidet allein die Sitzung.

Begründung: `SameSite=Strict` schützt vor fremden *Sites*, nicht vor anderen Ports desselben Rechners (gleiche Site,
`Sec-Fetch-Site: same-site`). Ältere Browser ohne `Sec-Fetch-Site` hinter einem Proxy, der den Host umschreibt und
kein `X-Forwarded-Host` setzt, scheitern an Schritt 2; die Doku zum Proxy nennt `NKA_ALLOWED_HOSTS`. Die vorhandene
Host-Prüfung (requestGuard.ts) bleibt unverändert.

### Bremse nach Fehlversuchen

OWASP Authentication rät, den Zähler am Konto statt an der Adresse zu führen und die Wartezeit exponentiell wachsen zu
lassen. Eine harte Sperre des einzigen Kontos wäre hier aber ein Weg, den Vermieter auszusperren (Durchsicht): Ein Gerät
im Netz schickte alle Viertelstunde genug Fehlversuche, und hinter einem Proxy oder dem Port-Weiterleiter von Docker
teilen sich alle Geräte eine Adresse. Deshalb **verlangsamen, nie sperren**, im Arbeitsspeicher:

- **Erst buchen, dann rechnen**: Jeder Versuch zählt als Fehlversuch, bevor scrypt läuft, und wird bei Erfolg
  zurückgenommen. Je Adresse der Verbindung höchstens **ein laufender Versuch**; die Schlange der Berechnungen hat
  höchstens **zwei Plätze**, was darüber hinausgeht, bekommt sofort 429 mit `Retry-After: 1`. So ergeben 1000
  gleichzeitige Anfragen nicht 1000 Rateversuche und keine Stunden Rechenlast auf einem Raspberry Pi.
- **Je Adresse**: ab dem 5. Fehlversuch Wartezeit 1 s, je weiterem verdoppelt bis 15 Minuten.
- **Für das Konto**: keine Sperre. Weil scrypt eine Berechnung nach der anderen rechnet (rund eine je Sekunde), sind
  es höchstens einige zehntausend Versuche am Tag; gegen 15 Zeichen ist das aussichtslos. Ab 20 Fehlversuchen in 15
  Minuten (alle Adressen) wartet jede weitere Berechnung zusätzlich 1 s, sonst nichts.
- **Eigene Zähler für den Einmal-Code**, getrennt von denen des Passworts. Die Datei `passwort-zuruecksetzen` und ein
  Neustart leeren alle Zähler; damit bleibt das Zurücksetzen auch während eines Angriffs nutzbar.
- **Dieselbe Bremse** für jede Route, die das bisherige Passwort prüft (`PUT /api/auth/password`, `POST /api/auth/off`,
  `POST /api/auth/logout-all`), sonst riete eine gestohlene Sitzung das Passwort ungebremst.

Antwort 429 mit `Retry-After` und „Zu viele Fehlversuche. Bitte versuchen Sie es in N Minuten erneut.“ Eine
Fehlmeldung für jeden Fall: „Das Passwort stimmt nicht.“ bzw. „Der Code stimmt nicht.“ (es gibt keinen Benutzernamen,
der sich verraten ließe). Fehlversuche stehen mit Adresse im Protokoll, die erste Anmeldung danach nennt
„N Fehlversuche seit Ihrer letzten Anmeldung“. Ein Gerät im Netz kann die Anmeldung anderer Geräte damit um Sekunden
bis Minuten verzögern, nicht verhindern (hingenommen, im Protokoll sichtbar). `trust proxy` bleibt aus.

### Schnittstelle

| Route | Wer | Wirkung |
| --- | --- | --- |
| `GET /api/auth` | jeder | `{ mode, required, signedIn, window, reachable, codeFile?, minLength, envFixed, failedAttempts? }` (`codeFile` nur bei `setup`/Übergang; der Pfad steht ohnehin im Protokoll) |
| `POST /api/auth/setup` | mit Code oder Fensterschlüssel | `{ code?, password }` oder `{ code?, withoutPassword: true }`; nur in `setup`, Übergang und `off`; setzt Sitzung |
| `POST /api/auth/login` | jeder, gebremst | `{ password }`; setzt Sitzung |
| `POST /api/auth/logout` | jeder | Sitzung weg, Cookie gelöscht |
| `PUT /api/auth/password` | angemeldet | `{ current, password }`; alle anderen Sitzungen weg |
| `POST /api/auth/off` | angemeldet | `{ current }`; Zustand `off` |
| `POST /api/auth/logout-all` | angemeldet | `{ current }`; alle Sitzungen weg außer der eigenen |

Aus `off` zurück zur Anmeldung geht nur mit Code oder Fensterschlüssel (`POST /api/auth/setup`): Sonst könnte in diesem
Zustand jedes Gerät im Netz ein Passwort setzen und den Vermieter aussperren. Aus demselben Grund verlangt die
Einrichtung im Übergang den Code. Die Routen sind unter `/api/auth` gebündelt und registriert vor dem Vermerk
„umgezogen“, mit eigenem `express.json({ limit: '4kb' })`.

## Oberfläche

Texte gesiezt, ohne Geviertstrich.

- **Anmeldeseite** (`pages/Anmeldung.tsx`, Logik in `accessView.ts`): Fuchs, „Mietfuchs“, ein Feld „Passwort“,
  „Anmelden“. Kein Seitenmenü. Darunter klein: „Passwort vergessen? Am Rechner, auf dem Mietfuchs läuft, lässt es sich
  zurücksetzen.“ mit Aufklapper (Datei `passwort-zuruecksetzen`, Docker-Befehl). Bei 401 während der Arbeit als
  Dialog über der Seite (`role="dialog"`, Fokus ins Feld, nach Erfolg zurück zum Auslöser).
- **Einrichtung** (`pages/Einrichtung.tsx`): „Mietfuchs ist von anderen Geräten in Ihrem Netz erreichbar. Legen Sie
  ein Passwort fest, damit nur Sie Ihre Daten sehen.“ Felder „Einrichtungscode“ (vorbelegt aus `#einrichtung=`;
  Erklärung, wo er steht: Konsolenfenster, `docker compose logs mietfuchs`, Datei mit vollem Pfad), „Passwort“,
  „Passwort wiederholen“; „Passwort festlegen“. Darunter „Ohne Passwort weiter“ mit Rückfrage (Warnung wie heute auf
  der Heimnetz-Karte). Im Fenster ohne Codefeld.
- **Hinweis im Übergang**: im Fuß der Seitenleiste wie NetworkHint.tsx („Ohne Passwort im Netz“), führt zur Karte
  „Anmeldung“; dort der Satz „Ab Version 1.0 verlangt Mietfuchs hier ein Passwort.“
- **Abmelden**: Eintrag in der Seitenleiste unten („Abmelden“), nur mit Sitzung.
- **Einstellungen, Karte „Anmeldung“** (`components/AccessCard.tsx`), sichtbar bei `network` oder vorhandenem Passwort:
  Zustand in Worten; „Passwort ändern“ (bisheriges, neues, wiederholen); „Auf allen Geräten abmelden“; „Anmeldung
  ausschalten“ mit Rückfrage und Warnung; bei `off` oder im Übergang „Passwort festlegen“ (mit Code bzw. im Fenster
  ohne). Bei `NKA_AUTH` fest: „Von der Umgebung festgelegt (NKA_AUTH)“, nur Anzeige.
- **Heimnetz-Karte im Fenster**: siehe Abschnitt 3; der Satz „Mietfuchs hat kein Passwort“ (NetworkCard.tsx:39) wird
  zu „Andere Geräte brauchen das Passwort, das Sie hier festlegen.“
- **Netzzugriff ohne Seite**: Alle `fetch`-Aufrufe der Oberfläche (api.ts und die rohen in letterPaper.ts,
  evaluationQueue.ts, aiRequest.ts, Abrechnung.tsx, BelegeEingang.tsx, BelegeOrdner.tsx) gehen über einen Helfer, der
  bei 401 mit `login`/`setup` das Ereignis für den Anmeldedialog auslöst. Ein Test verlangt, dass außerhalb von api.ts
  kein `fetch(` mehr steht.
- **Lexikon** (shared/glossary.ts): Begriffe „Anmeldung“ und „Einrichtungscode“. **Anleitung** (shared/guides.ts): in
  der Anleitung zum Zugriff vom Handy bzw. im Abschnitt Betrieb die Schritte „Passwort festlegen“ und „Passwort
  vergessen“; Beschriftungen wörtlich (guides.test.ts).

## Doku und Texte

- **docs/docker.md**: „Zuerst: Sicherheit“ neu: Mietfuchs fragt nach einem Passwort; erster Start mit Code aus
  `docker compose logs`; Zurücksetzen; `NKA_AUTH`; der Abschnitt „Ein Passwort davor“ wird zur Option für Proxy-Nutzer
  (dann `NKA_AUTH=off`). Bestehende Container: Übergang und Stufe B.
- **docs/installation.md**: Programmdatei/Paket (Code im Konsolenfenster, Browser öffnet mit Code), Fenster mit
  Heimnetz, Abschnitt zu `NKA_HOST`/`NKA_ALLOWED_HOSTS` um `NKA_AUTH` und Proxy-Kopfzeilen ergänzt.
- **docs/datenschutz.md**: „kein Passwort“ ersetzt; HTTP im Heimnetz ist mitlesbar (ehrlich, bis Schritt 2).
- **README**: Absatz „Zugriff vom Handy“ (README.md:189); Sprungmarken bleiben.
- **MIGRATION.md** (siezen): neuer Abschnitt „Nach dem Update fragt Mietfuchs nach einem Passwort“ (Code finden,
  ohne Passwort weiter, zurücksetzen).
- **deploy/compose*.yml**: Kopfkommentar „Mietfuchs hat kein Login“ ersetzen.
- **CHANGELOG**, **Release-Notes von Stufe A**: neue Funktion, neue Datenordner verlangen ein Passwort, bestehende
  Installationen im Netz sehen einen Hinweis, Pflicht ab 1.0.0-rc.1; für bestehende Daten: nichts zu tun außer dem
  Passwort. `docs/entwickeln.md`: `npm run dev` lauscht lokal.
- **CLAUDE.md**: Regel für Serverstarts um `NKA_HOST=127.0.0.1` ergänzt; server/src/CLAUDE.md neuer Abschnitt
  „Anmeldung“; scripts/CLAUDE.md (Fensterschlüssel, Prüfungen); client/CLAUDE.md (Anmeldedialog).

## Docker-Image

Am Image selbst ändert sich nichts an Port, Volume oder Umgebung; `NKA_AUTH` ist ungesetzt (`auto`). Die Voreinstellung
ändert sich durch die Regel „neuer Datenordner bei `network` heißt `setup`“: Ein frisches Volume verlangt das Passwort
vom ersten Start an. Der HEALTHCHECK bleibt gesund (127.0.0.1 im Container, `/healthz` voll). `npm run dev` setzt
`NKA_HOST=127.0.0.1` (über `node --env-file=dev.env` in server/package.json), damit Entwickler keine Anmeldung sehen.

## Was Schritt 2 vorfindet

- Kopfzeile `X-Mietfuchs-Window` als Weg für Schlüssel am Fenster; Geräteschlüssel werden eine zweite Art derselben
  Prüfung (`devices` in `zugang.json`, gehasht, mit Name und letzter Nutzung).
- `Secure` folgt schon heute dem Protokoll; mit eigenem Zertifikat wechselt der Cookie-Name zu `__Host-mietfuchs_<id>`.
- Der Einmal-Code ist der Baustein für den Kopplungscode.
- `/api/auth` meldet `reachable` und `mode`; das Fenster braucht später zusätzlich die Version (`/api/health`, #528).
- Keine Entscheidung hier bindet das Fenster an 127.0.0.1 als einzige Adresse; die Prüfung des Fensterschlüssels auf
  Loopback ist eine Zeile, die Schritt 2 für Geräteschlüssel über HTTPS lockert.

## Hingenommen

- Über HTTP lesen Geräte, die den Verkehr mitschneiden, Passwort und Cookie (bis Schritt 2).
- Andere Dienste auf demselben Rechner sehen das Cookie (Ports trennen keine Cookies).
- Ein Proxy ohne Proxy-Kopfzeilen vor einem lokal lauschenden Mietfuchs bleibt unerkannt (`NKA_AUTH=on`).
- Ein Gerät im Netz kann die Anmeldung über die Bremse verzögern, nicht verhindern.
- Ein Neustart meldet alle Sitzungen ab.

## Aus der Durchsicht offen (Verbesserungen, keine Muss-Befunde)

Die Gegenprüfung mit Sicherheitsblick nannte dazu, ohne dass der Entwurf sie verlangt; der Umsetzende entscheidet:
Fensterschlüssel zusätzlich am Ursprung im Callback prüfen und nach dem Lesen aus `process.env` löschen; Einrichtung
über den Fensterschlüssel schon vor dem Umschalten auf `0.0.0.0` (sonst ist der Server bis dahin im Übergang offen) und
neues Passwort im Fenster ohne `current`; einen Code auch im Zustand `off` (oder auf der Karte den Weg über
`passwort-zuruecksetzen` nennen); Code nicht über die Befehlszeile von `openBrowser` (für andere Benutzer in der
Prozessliste sichtbar), `codeFile` in `GET /api/auth` nur für Loopback und Fenster, Code zeitkonstant vergleichen;
andere Benutzerkonten desselben Rechners erreichen ein lokal lauschendes Mietfuchs ohne Anmeldung (als hingenommen
benennen oder `NKA_AUTH=on`); Bremse bei IPv6 je /64 und mit begrenzter Tabelle, Protokoll zusammengefasst;
Origin-Prüfung auch im Übergang und bei `off`; bei mehreren Cookies gleichen Namens jeden Wert prüfen (Cookie-Tossing
aus `*.fritz.box` oder anderem Port); Backup-Download, pdf.js und `<img>` laufen nicht über `appFetch` (Backup über
`fetch` und Blob).

## Zuschnitt

Eine vorbereitende und sechs PRs, siehe docs/superpowers/plans/2026-11-07-anmeldung.md. Stufe B ist eine eigene kleine PR vor 1.0.0-rc.1.
