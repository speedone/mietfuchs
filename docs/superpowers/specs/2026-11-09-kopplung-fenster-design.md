# Programmfenster mit einem Mietfuchs im Heimnetz koppeln (#528, Schritt 2)

Stand 09.11.2026. Baut auf Schritt 1 auf (Anmeldung, [2026-11-07-anmeldung-design.md](2026-11-07-anmeldung-design.md),
Abschnitt „Was Schritt 2 vorfindet“). Entscheidung des Nutzers: kommt noch in 0.17.0, „nicht unnötig komplex, einfach
best practice“.

## Absicht

Wer Mietfuchs auf einem NAS, Raspberry Pi oder in Docker betreibt, bedient es heute nur im Browser, über HTTP. Das
Programmfenster (#517) startet immer seinen eigenen Server. Ziel: Das Fenster unter Windows und macOS verbindet sich
wahlweise mit einem Mietfuchs im Heimnetz, **verschlüsselt**, und bleibt dort angemeldet. Vorbild ist Syncthing: eigenes
Zertifikat des Servers, das Fenster merkt sich seinen Fingerabdruck, ein Code beweist beim ersten Verbinden, dass es
der richtige Server ist. Keine Domain, kein Let's Encrypt, nichts am Router, kein Import in den Zertifikatsspeicher.

## Ziele

1. Der Server spricht auf **demselben Port** HTTP und HTTPS (eigenes Zertifikat). An Docker, compose, Port und
   Firewall ändert sich nichts.
2. **Kopplung**: Einstellungen → Anmeldung → „Programmfenster koppeln“ zeigt einen Code (10 Minuten, einmal). Das
   Fenster nimmt Adresse und Code und bekommt einen dauerhaften **Geräteschlüssel**. Der Code wird nie über die Leitung
   geschickt; das Fenster beweist mit ihm, welches Zertifikat es sieht (Schutz gegen einen Mittelsmann beim ersten
   Verbinden).
3. **Geräteliste** am Server: Name, gekoppelt am, zuletzt gesehen, einzeln entfernen.
4. **Fenster**: verbindet sich statt mit dem eigenen Server mit dem gekoppelten, nimmt nur dessen Zertifikat an,
   schickt den Geräteschlüssel nur dorthin, sperrt die Brücke auf das Nötige. Nicht erreichbar oder Zertifikat
   geändert: klare Meldung mit Ausweg. Abweichende Version: Hinweis. „Verbindung trennen“ führt zurück zu den Daten auf
   diesem Rechner.

## Nicht-Ziele

- HTTPS für **Browser** ohne Proxy (ein eigenes Zertifikat ergibt dort nur eine Warnseite; dafür bleibt Caddy, docs/docker.md).
- Mehrere Benutzer oder Rollen (#91).
- Automatisches Finden des Servers im Netz (mDNS). Die Adresse wird eingetippt.
- Warnung bei gleichzeitigem Bearbeiten über das Heutige hinaus (betrifft schon zwei Browser, eigenes Thema).
- Stufe B (Passwort Pflicht), eigene kleine PR vor 1.0.0-rc.1.
- Linux-Fenster (es gibt keins).

## Anti-Ziele (wäre ein Fehlschlag, selbst wenn es läuft)

- Ein Weg, auf dem ein Gerät im Netz ohne Passwort oder Geräteschlüssel an die Daten kommt, auch über HTTPS.
- Ein Geräteschlüssel, der über HTTP gilt oder an eine andere Adresse geht als die gekoppelte.
- Eine Seite des entfernten Servers, die im Fenster Ordner wählen, umziehen, den lokalen Server ins Netz stellen oder
  das Fenster auf eine andere Adresse umlenken kann.
- Wer nichts koppelt, merkt etwas (Startzeit, Meldungen, Verhalten). Bestehende Tests, Docker, Browser bleiben gleich.
- Eine zweite Anmeldelogik neben access.ts.

## Entscheidungen

### 1. HTTPS auf demselben Port (Server)

- Beim Start (vor dem Binden) liest der Server `tls/mietfuchs.key` und `tls/mietfuchs.crt` im Datenordner oder erzeugt
  sie: ECDSA P-256, SHA-256, CN „Mietfuchs“, über die Bibliothek **`selfsigned`** (MIT, ohne Laufzeitdaten, prüft
  ECDSA in 25 ms; Node erzeugt keine Zertifikate selbst). Schlüssel 0600, über Zwischendatei und Umbenennen wie
  `zugang.json`. Lange Gültigkeit (das Fenster pinnt und prüft die Laufzeit nicht; die Option der Bibliothek dafür
  nachsehen, `days` wirkt in 5.5.0 nicht). **Nicht im Backup, nicht in Vorversionen, nicht im Umzug** (wie `zugang.json`):
  Nach dem Wiederherstellen auf einem neuen Rechner entsteht ein neues Zertifikat, gekoppelte Fenster koppeln neu.
- **Ein Port**: `net.createServer` liest das erste Byte jeder Verbindung (`0x16` = TLS-Handshake) und reicht die
  Verbindung an `https.Server` oder `http.Server` weiter (`emit('connection', socket)`, Byte zurück mit `unshift`).
  Beide nutzen denselben Handler wie heute (`startup`, `/healthz`, `app`). Alles, was heute `server` heißt (listen,
  close, Lauf-Datei, instanceGuard, Abschalten), bleibt am äußeren Server.
- `viaHttps` (Secure-Cookie) zählt zusätzlich `req.socket.encrypted`. Der Cookie-Name bleibt `mietfuchs_<id>` (`__Host-`
  nur bei Bedarf; über HTTP und HTTPS denselben Namen zu tragen ist einfacher, und das Fenster nutzt Geräteschlüssel).
- Fehlt der Ordner oder ist er nicht beschreibbar, startet der Server ohne HTTPS (Zeile auf der Fehlerausgabe), nie
  ein Abbruch. Verbindungen mit TLS werden dann geschlossen.
- Lauscht der Server nur lokal (Fenster, Store ohne Heimnetz), entsteht trotzdem ein Zertifikat (einfacher, schadet
  nicht); **entschieden vom Umsetzenden**, falls die Startzeit im Fenster leidet: dann erst bei `network`.
- `/healthz` nennt zusätzlich `tls: true|false` (das Fenster braucht es nicht, die Prüfungen schon).

### 2. Kopplung und Geräteschlüssel (Server, access.ts / accessServer.ts)

- **Nur mit Passwort**: Koppeln geht nur in `password` (sonst 409 „Legen Sie zuerst ein Passwort fest.“). Ohne
  Passwort braucht ein Fenster keinen Schlüssel; die Karte sagt es.
- `POST /api/auth/pairing` (angemeldet oder Fenster): neuer Code wie der Einrichtungscode (12 Zeichen, 31er-Alphabet,
  `formatCode`), gültig 10 Minuten, höchstens einer zugleich (ein neuer ersetzt den alten), nur im Speicher. Antwort
  `{ code, expiresAt }`. `DELETE` verwirft ihn.
- `POST /api/auth/pair` (frei wie `login`, mit **derselben Bremse**, Art `pair`): nur über TLS (`req.socket.encrypted`,
  sonst 400 „Koppeln geht nur über eine verschlüsselte Verbindung.“). Rumpf `{ name, proof }`. `proof` =
  HMAC-SHA256, Schlüssel = normalisierter Code (`normalizeCode`), Nachricht = `mietfuchs-kopplung:` + SHA-256 des
  DER-Zertifikats in Kleinbuchstaben-Hex, das der Server ausliefert; zeitkonstant verglichen. Erfolg: Code verbraucht,
  Gerät angelegt, Antwort `{ id, deviceKey }` (32 Zufallsbytes base64url), `Cache-Control: no-store`. Fehler: 400
  „Der Code stimmt nicht oder ist abgelaufen.“ (kein Unterschied zwischen beidem). Ein Mittelsmann, der ein eigenes
  Zertifikat zeigt, bekommt einen Beweis für sein Zertifikat und kann ihn ohne Code nicht auf das echte umrechnen.
- **Geräte** in `zugang.json` als `devices: [{ id, name, keyHash, pairedAt, lastSeen }]` (`keyHash` SHA-256 des
  Schlüssels, Vergleich zeitkonstant; Schlüssel mit 256 Bit brauchen kein scrypt). `fileOf`/`save` tragen `devices`
  mit (heute gehen unbekannte Felder verloren, ausdrücklich bedacht). Höchstens 20 Geräte (sonst 409). `name` 1 bis
  60 Zeichen, sonst „Programmfenster“.
- **Geräteschlüssel gilt als angemeldet** (`signedIn`), wenn: Kopfzeile `X-Mietfuchs-Device` = `<id>.<key>`, Gerät
  bekannt, Schlüssel passt, **Verbindung über TLS**, Modus `password`. Über HTTP nie. `lastSeen` im Speicher, höchstens
  einmal je Stunde geschrieben. Origin-Prüfung und Bremse unverändert (die Seite im Fenster schickt ihren eigenen
  Origin).
- `GET /api/auth/devices`, `DELETE /api/auth/devices/:id` (angemeldet): Liste ohne `keyHash`, dazu `current: true` für
  das anfragende Gerät.
- **Zurücksetzen** (`passwort-zuruecksetzen`) und Ausschalten der Anmeldung entfernen alle Geräte. Passwort ändern und
  „Auf allen Geräten abmelden“ lassen sie stehen (die Karte sagt: gekoppelte Fenster entfernen Sie in der Liste).
- `GET /api/auth` nennt `pairing: { available, devices: n }` für die Oberfläche.

### 3. Fenster (desktop/)

- **Einstieg**: In den Einstellungen des eigenen Fensters (lokale Seite) eine Karte „Mietfuchs im Heimnetz“: Adresse
  (`http://nas:3001`, `nas:3001` oder IP; Schema egal, das Fenster nimmt immer `https://` auf denselben Port), Code,
  „Verbinden“. Über die Brücke `remote.connect({ address, code })`.
- **Koppeln im Hauptprozess** (neues reines Modul `desktop/src/pairing.js`, Node `https`): TLS ohne Prüfung der Kette
  verbinden, Zertifikat lesen (`getPeerCertificate(true).raw` → SHA-256 hex), `/healthz` lesen (`app === 'mietfuchs'`,
  `version`), `proof` rechnen, `POST /api/auth/pair` mit Rechnername als `name`. Fehler als Sätze: nicht erreichbar,
  kein Mietfuchs, Mietfuchs ohne HTTPS (ältere Fassung), Code falsch oder abgelaufen, Server ohne Passwort.
- **Gespeichert** in `fenster.json`: `remote: { url, certSha256, deviceId, deviceKey, serverVersion }`; `deviceKey`
  über `safeStorage.encryptString` (Keychain, DPAPI), ohne verfügbares safeStorage wird nicht gekoppelt (Meldung).
- **Betrieb verbunden**: kein eigener Server. `origin` = `https://host:port`. `session.setCertificateVerifyProc`: für
  genau diesen Host und Port nur das gemerkte Zertifikat (SHA-256 des DER, aus `request.certificate.data` PEM
  gerechnet), sonst die normale Prüfung (`callback(-3)`). Geräteschlüssel per `onBeforeSendHeaders` nur an `${origin}/*`
  (wie heute der Fensterschlüssel). Navigation, Belegfenster, Rahmen über die vorhandenen Regeln mit dem neuen
  `origin`.
- **Brücke verbunden**: erlaubt `print`, `updater.*` (das Fenster selbst), `remote.get`, `remote.disconnect`; verboten
  `network.*` und `chooseFolder` (Fehler „Nicht erlaubt.“). `network.get` meldet dort `{ remote: true }`, damit die
  Oberfläche die Karte „Zugriff aus dem Heimnetz“ ausblendet. `remote.connect` nur von der lokalen Seite.
- **Seite des Servers im Fenster**: Karte „Mietfuchs im Heimnetz“ zeigt „Verbunden mit nas:3001 (Mietfuchs 0.17.0)“ und
  „Verbindung trennen“. Zusätzlich Menüeintrag „Verbindung trennen“ (falls die Seite nicht lädt).
- **Nicht erreichbar / Zertifikat geändert / Geräteschlüssel abgelehnt (401 nach Entfernen)**: native Rückfrage
  (`dialog.showMessageBox`) mit Grund und „Erneut versuchen“, „Verbindung trennen“ (zurück zum eigenen Server,
  Kopplung vergessen), „Beenden“. Zertifikat geändert sagt: „Der Server zeigt ein anderes Zertifikat als beim Koppeln.
  Wurde Mietfuchs dort neu eingerichtet, koppeln Sie neu; sonst verbinden Sie sich nicht.“
- **Version**: Weicht `major.minor` von `/healthz` von der des Fensters ab, einmal je Start ein Hinweis (verbunden wird
  trotzdem).
- **Trennen**: `remote` aus `fenster.json`, Server des Fensters starten, eigene Seite laden. Das Gerät bleibt in der
  Liste des Servers, bis es dort entfernt wird (der Hinweis sagt es); wenn erreichbar, ruft das Fenster vorher
  `DELETE /api/auth/devices/<eigene id>` (beste Mühe).
- Testgriff wie `MIETFUCHS_SERVER_URL` bleibt; die Kopplung ist ausgeliefert, kein Testgriff.

### 4. Oberfläche (client/)

- Einstellungen → Anmeldung: Abschnitt „Programmfenster koppeln“ (nur `password`): Knopf „Code anzeigen“ → Code groß,
  „gültig bis 10:42“, Anleitung in zwei Sätzen; Geräteliste mit „Entfernen“ (Rückfrage). Ohne Passwort ein Satz, warum
  nicht.
- Karte „Mietfuchs im Heimnetz“ nur im Fenster (Brücke `remote` vorhanden), lokal mit Formular, verbunden mit Stand und
  Trennen. Logik in einem reinen Modul (`desktopRemote.ts`) wie desktopNetwork.ts.

## Prüfungen

- Server: Port spricht HTTP und HTTPS (auch `/healthz` beim Starten), Zertifikat bleibt über Neustarts, fehlender
  Ordner startet ohne HTTPS; `pair` nur über TLS, falscher und abgelaufener Code, verbrauchter Code, Beweis für ein
  anderes Zertifikat scheitert, Bremse; Geräteschlüssel nur über TLS, nach Entfernen 401, nach Zurücksetzen 401,
  `zugang.json` behält `devices` beim Passwortwechsel; Backup enthält `tls/` nicht.
- Fenster (desktop/test): `pairing.js` gegen einen echten Server (`startServerIn` mit `NKA_HOST: '0.0.0.0'`), Pinning-
  Entscheidung als reine Funktion, Brückenmatrix lokal/verbunden, Version.
- Oberfläche: jsdom-Tests der Karten.
- desktop-check (Windows, macOS): koppeln mit einem Server aus dem Test, Seite lädt über HTTPS, Neustart bleibt
  verbunden, Trennen startet den eigenen Server.
- Integrationsdurchsicht des Endstands (Sicherheit, Daten), Label `full-check`.

## Reihenfolge (gestapelte PRs)

1. Server: HTTPS auf demselben Port.
2. Server + Oberfläche: Kopplung, Geräte, Karte in der Anmeldung.
3. Fenster + Oberfläche: Verbinden, Pinning, Brücke, Meldungen.
4. Doku (installation, docker, datenschutz, CLAUDE.md, Anleitung, CHANGELOG), Website, Bildschirmfotos, desktop-check.

## Dem Umsetzenden überlassen

Namen von Modulen und Funktionen, Wortlaut der Sätze (gesiezt, ohne Geviertstrich), Gestaltung der Karten im Stil der
vorhandenen, ob das Zertifikat schon bei lokalem Lauschen entsteht, Option der Gültigkeit in `selfsigned`, Art des
Throttlings von `lastSeen`.
