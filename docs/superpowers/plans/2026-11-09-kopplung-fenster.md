# Kopplung des Programmfensters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Programmfenster verbindet sich verschlüsselt und dauerhaft gekoppelt mit einem Mietfuchs im Heimnetz (#528, Schritt 2).

**Architecture:** Der Server spricht auf seinem Port HTTP und HTTPS (eigenes ECDSA-Zertifikat, Erkennung am ersten Byte). Ein Kopplungscode beweist beim ersten Verbinden das Zertifikat (HMAC), der Server gibt einen Geräteschlüssel aus, der nur über TLS als angemeldet gilt. Das Fenster pinnt das Zertifikat, schickt den Schlüssel nur an den gekoppelten Ursprung und startet dann keinen eigenen Server.

**Tech Stack:** Node 24 (TypeScript ohne Build), Bun für die Programmdatei, Express 5, React 19, Electron, `selfsigned` 5.5.0.

**Spec:** docs/superpowers/specs/2026-11-09-kopplung-fenster-design.md (Entscheidungen dort sind bindend).

## Global Constraints

- Nutzertexte gesiezt, keine Geviertstriche, keine festen Rechtsdaten in Oberflächentexten (Wächter anrede, geviertstrich, uiRules).
- `index.css` wächst nicht (uiRules S20); Gestaltung über vorhandene Klassen und Tailwind-Utilities.
- Server-Importe mit Endung `.ts`, Typimporte mit `import type`, kein `enum`; `npm run typecheck` grün vor jedem Commit.
- Kein Geheimnis (Code, Schlüssel, Beweis) im Protokoll, in `/api/auth` oder in Fehlermeldungen.
- Wer nichts koppelt, merkt nichts: alle bestehenden Tests unverändert grün, kein Unterschied in Startausgabe außer einer Zeile bei fehlendem HTTPS.
- Jede PR: `Refs #528`, Durchsicht mit frischem Kontext vor dem PR, Befunde mit vorher rotem Test; gestapelt, Integrationsdurchsicht des Endstands, Label `full-check`.
- `tls/` und `zugang.json` nie in Backup, Vorversion, Umzug.

## Review Focus

1. Ein HTTP-Client schickt den Geräteschlüssel (Kopfzeile ohne TLS) → 401, als wäre keine Kopfzeile da. (Task 4)
2. Ein Client öffnet den Port und schweigt oder schickt nur ein Byte → keine hängende Verbindung über das Timeout des HTTP-Servers hinaus, kein Absturz. (Task 2)
3. Zwei Kopplungen gleichzeitig mit demselben Code → genau eine gelingt. (Task 4)
4. Das Fenster ist gekoppelt, der Server wurde neu aufgesetzt (neues Zertifikat) → Meldung „anderes Zertifikat“, kein stilles Annehmen, Geräteschlüssel nicht gesendet. (Task 7)
5. `zugang.json` von 0.16 ohne `devices` und eine mit kaputtem `devices` → lesbar bzw. `corrupt` (streng), nie offen. (Task 3)

---

## PR 1: HTTPS auf demselben Port (Zweig `feat/kopplung-1-https`)

### Task 1: Zertifikat im Datenordner

**Files:** Create `server/src/tls.ts`; Modify `server/package.json` (Abhängigkeit `selfsigned` 5.5.0, exakt gepinnt); Test `server/test/tls.test.ts`.

**Interfaces:** Produces
`ensureCertificate(dataDir: string, now?: Date): Promise<{ key: string, cert: string, certSha256: string } | { problem: string }>`;
`certSha256(certPem: string): string` (SHA-256 des DER, Kleinbuchstaben-Hex, über `new crypto.X509Certificate(pem).raw`);
Konstanten `TLS_DIR = 'tls'`, Dateien `mietfuchs.key` (0600), `mietfuchs.crt`.

- [ ] Test: frischer Ordner erzeugt beide Dateien, Schlüssel 0600 (nicht unter Windows), `X509Certificate.publicKey.asymmetricKeyType === 'ec'`, `validTo` mindestens 29 Jahre nach `now`; zweiter Aufruf liefert denselben `certSha256`; nicht beschreibbarer Ordner ergibt `{ problem }` mit Satz, wirft nicht; kaputte Datei (unlesbares PEM) wird neu erzeugt, die Rückgabe trägt das neue Zertifikat.
- [ ] Rot laufen lassen (`cd server && node --test test/tls.test.ts`).
- [ ] Umsetzen mit `selfsigned.generate([{ name: 'commonName', value: 'Mietfuchs' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate })`, Schreiben über Zwischendatei und Umbenennen.
- [ ] Test: Backup-ZIP enthält keinen Eintrag unter `tls/` (in `server/test/api-backup.test.ts`, Server mit TLS-Ordner).
- [ ] Grün, typecheck, Commit.

### Task 2: Ein Port für HTTP und HTTPS

**Files:** Create `server/src/dualPort.ts`; Modify `server/src/index.ts` (Stelle `const server = http.createServer(...)` ~4814 und Start: Zertifikat vor dem Binden laden), `server/src/access.ts` (`viaHttps` nimmt zusätzlich `encrypted?: boolean`), `server/src/health.ts` bzw. die `/healthz`-Antwort (`tls: boolean`); Test `server/test/dualPort.test.ts`, `server/test/api-https.test.ts`; Modify `server/testing/api.ts` (Helfer `httpsFetch`).

**Interfaces:** Produces
`createDualServer(listener: http.RequestListener, tls: { key: string, cert: string } | null): { server: net.Server, http: http.Server }` (`server` ist das, was index.ts heute `server` nennt: listen, close, address);
`httpsFetch(base: string, path: string, init?: { method?: string, headers?: Record<string,string>, body?: string }): Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string, certSha256: string }>` in server/testing/api.ts (Node `https.request`, `rejectUnauthorized: false`, Zertifikat aus `socket.getPeerCertificate(true).raw`).

- [ ] Test (dualPort): auf einem Port antwortet `http.get` und `https.get` (ohne Prüfung der Kette) mit demselben Handler; `req.socket.encrypted` ist nur bei TLS wahr; Verbindung, die nichts schickt, wird nach `http.Server.requestTimeout`/eigenem Timeout (10 s, im Test kürzer einstellbar) geschlossen; ein Byte und Ende führt zu keinem Fehler auf dem Server; `tls === null`: TLS-Verbindung wird geschlossen.
- [ ] Rot, umsetzen: `net.createServer` mit `pauseOnConnect: false`, erstes Byte über `socket.once('data')`, `socket.unshift(chunk)`, bei `0x16` `new tls.TLSSocket(socket, { isServer: true, key, cert })` und `http.emit('connection', tlsSocket)`, sonst `http.emit('connection', socket)`. Nicht `https.Server` (scheitert unter Bun 1.4.4).
- [ ] Test (api-https): echter Server (`startServerIn` mit `NKA_HOST: '0.0.0.0'`) antwortet über `httpsFetch` auf `/healthz` mit `tls: true`; über HTTPS gesetztes Sitzungs-Cookie trägt `Secure`; `certSha256` bleibt über einen Neustart gleich; nicht beschreibbarer Datenordner für `tls/` startet mit Zeile auf der Fehlerausgabe „HTTPS ist nicht verfügbar …“ und `tls: false`.
- [ ] index.ts umstellen, alle `server.*` bleiben am äußeren Server; Testgriff für die Prüfung der Programmdatei: scripts/smoke-test.mjs fragt zusätzlich `/healthz` über HTTPS (läuft unter Bun in ci/release).
- [ ] Gesamter Servertest grün, typecheck, Commit. Durchsicht, PR 1.

## PR 2: Kopplung und Geräte (Zweig `feat/kopplung-2-geraete`, auf PR 1)

### Task 3: Geräte im Kern

**Files:** Modify `server/src/access.ts`; Test `server/test/access.test.ts`.

**Interfaces:** Produces
`type Device = { id: string, name: string, keyHash: string, pairedAt: string, lastSeen: string | null }`;
`AccessFile.devices?: Device[]` (fehlend = leer; `isAccessFile` prüft jedes Gerät, ein ungültiges macht die Datei `corrupt`);
`pairingProof(code: string, certSha256: string): string` = HMAC-SHA256(Schlüssel `normalizeCode(code)`, Nachricht `mietfuchs-kopplung:` + certSha256), hex;
`newDeviceKey(): string` (32 Bytes base64url); `deviceKeyHash(key: string): string` (SHA-256 hex);
`matchDevice(devices: Device[], header: string | undefined): Device | null` (Kopfzeile `<id>.<key>`, zeitkonstant);
`MAX_DEVICES = 20`, `PAIRING_MINUTES = 10`, `DEVICE_HEADER = 'x-mietfuchs-device'`.

- [ ] Tests: Beweis deterministisch und abhängig von Code und Zertifikat; Code in anderer Schreibweise (klein, ohne Bindestriche) ergibt denselben Beweis; `matchDevice` mit falschem Schlüssel, unbekannter id, fehlendem Punkt, leerem Wert → null; `zugang.json` ohne `devices` gültig, mit `devices: [{}]` `corrupt`.
- [ ] Rot, umsetzen, grün, Commit.

### Task 4: Routen und Anmeldung mit Geräteschlüssel

**Files:** Modify `server/src/accessServer.ts`, `server/src/access.ts` (`gate`: Pfad `/api/auth/pair` frei wie login; `GateRequest.signedIn` kommt weiter von außen); Test `server/test/api-kopplung.test.ts`.

**Interfaces:** Consumes Task 1–3. Produces Routen:
`POST /api/auth/pairing` → `{ code, expiresAt }` (angemeldet, nur `password`, sonst 409 „Legen Sie zuerst ein Passwort fest.“); `DELETE /api/auth/pairing`;
`POST /api/auth/pair` `{ name, proof }` → `{ id, deviceKey, version }` (nur TLS, sonst 400 „Koppeln geht nur über eine verschlüsselte Verbindung.“; falsch/abgelaufen 400 „Der Code stimmt nicht oder ist abgelaufen.“; Bremse Art `pair`; mehr als 20 Geräte 409);
`GET /api/auth/devices` → `{ devices: Array<Omit<Device,'keyHash'> & { current: boolean }> }`; `DELETE /api/auth/devices/:id`;
`GET /api/auth` zusätzlich `pairing: { available: boolean, devices: number }`.
`createAccess` bekommt `tls: { certSha256: string } | null`.

- [ ] Tests (über `httpsFetch`): Koppeln mit richtigem Beweis ergibt Schlüssel; mit dem Schlüssel über HTTPS `GET /api/units` 200, über HTTP 401 (Review Focus 1); Beweis für ein anderes Zertifikat 400; Code ein zweites Mal 400; zwei gleichzeitige `pair` mit demselben Code: genau ein 200 (Review Focus 3); abgelaufen (Testgriff `NKA_TEST_PAIRING_SECONDS` verkürzt die Gültigkeit, genannt in server/src/CLAUDE.md „Testgriffe“); ohne Passwort `pairing` 409; Gerät entfernen → 401; `passwort-zuruecksetzen` → alle Geräte weg; Ausschalten → weg; Passwort ändern und logout-all → Geräte bleiben; `zugang.json` behält `devices` beim Passwortwechsel; kein Code, Schlüssel oder Beweis in stdout/stderr; `lastSeen` gesetzt.
- [ ] Rot, umsetzen (`fileOf` trägt `devices`; `signedIn(req)` zusätzlich `req.socket.encrypted && state.mode === 'password' && matchDevice(...)`; Code nur im Speicher), grün, typecheck, Commit.

### Task 5: Karte „Programmfenster koppeln“

**Files:** Create `client/src/pairingView.ts`, `client/src/components/PairingSection.tsx`; Modify `client/src/components/AccessCard.tsx`, `client/src/access.ts` (Typ `AccessInfo.pairing`); Test `client/src/components/PairingSection.test.tsx`, `client/src/pairingView.test.ts`.

**Interfaces:** Consumes Task 4. Produces `PairingSection({ info }: { info: AccessInfo })`; `pairingView.ts`: `expiresText(expiresAt: string, now: Date): string` („gültig bis 10:42 Uhr“), `deviceLine(d): string` („gekoppelt am 09.11.2026, zuletzt 09.11.2026“).

- [ ] Tests: ohne Passwort ein Satz und kein Knopf; „Code anzeigen“ zeigt den Code groß und den Ablauf; Liste mit „Entfernen“ fragt nach und ruft DELETE; das eigene Gerät ist markiert.
- [ ] Rot, umsetzen im Stil der Karte (Abschnitt unter den Knöpfen, `stack`), grün, uiRules grün, Commit. Durchsicht, PR 2.

## PR 3: Fenster verbindet sich (Zweig `feat/kopplung-3-fenster`, auf PR 2)

### Task 6: Koppeln im Hauptprozess (reines Modul)

**Files:** Create `desktop/src/pairing.js`; Test `desktop/test/pairing.test.js` (startet einen echten Server über `server/testing/api.ts`, `NKA_HOST: '0.0.0.0'`, Passwort, Code über die Route).

**Interfaces:** Produces
`normalizeAddress(input: string): { host: string, port: number, origin: string } | { problem: string }` (Schema egal, Vorgabe-Port 3001, immer `https://`);
`pair({ address, code, name }): Promise<{ origin, certSha256, deviceId, deviceKey, version } | { problem: string }>`;
`pinDecision(hostname: string, certSha256: string, remote: { origin: string, certSha256: string } | null): 'accept' | 'reject' | 'default'`;
`versionHint(windowVersion: string, serverVersion: string): string | null` (anderes `major.minor` → Satz);
`certSha256FromPem(pem: string): string`.

- [ ] Tests: Adressen `nas`, `nas:3001`, `http://192.168.1.5:3001/`, `https://[fd00::1]:3001` normalisiert, Unsinn → Satz; Koppeln gegen echten Server gelingt; falscher Code → „Der Code stimmt nicht oder ist abgelaufen.“; Server ohne Passwort → Satz; nichts lauscht → „nicht erreichbar“; kein Mietfuchs (fremder HTTPS-Server im Test) → Satz; `pinDecision`: gleicher Host mit gemerktem Zertifikat accept, anderes reject, anderer Host default, ohne Kopplung default; `versionHint('0.17.0','0.17.3')` null, `('0.17.0','0.18.0')` Satz.
- [ ] Rot, umsetzen (Node `https`, `rejectUnauthorized: false`, Rechnername über `os.hostname()` als Vorgabe von `name`), grün, Commit.

### Task 7: Fenster im Betrieb

**Files:** Modify `desktop/src/main.js`, `desktop/src/preload.cjs`; Create `desktop/src/bridgePolicy.js`; Test `desktop/test/bridgePolicy.test.js`, `desktop/test/server.test.js` (Einstellungen lesen/schreiben).

**Interfaces:** Consumes Task 6. Produces Brücke `mietfuchsDesktop.remote = { get(): Promise<{ connected: boolean, origin?: string, version?: string }>, connect({ address, code }): Promise<{ ok: true } | { problem: string }>, disconnect(): Promise<void> }`; `network.get()` ergibt verbunden `{ remote: true }`;
`allowed(channel: string, { remote: boolean, ownPage: boolean }): boolean` in bridgePolicy.js (verbunden: nur `print`, `updater-*`, `remote-get`, `remote-disconnect`; `remote-connect` nur lokal);
`fenster.json` Feld `remote: { origin, certSha256, deviceId, deviceKey, version }`, Datei 0600.

- [ ] Tests: Matrix aller Kanäle lokal/verbunden; Lesen von `fenster.json` mit kaputtem `remote` ergibt keine Kopplung.
- [ ] Umsetzen: Start mit `remote` → kein `startServer`, `origin = remote.origin`, `setCertificateVerifyProc` mit `pinDecision`, `onBeforeSendHeaders` setzt `x-mietfuchs-device` nur für `${origin}/*`; Laden scheitert (`did-fail-load`, Zertifikat abgelehnt, 401 auf `/api/auth`) → `dialog.showMessageBox` mit „Erneut versuchen“, „Verbindung trennen“, „Beenden“ und dem Satz aus der Spec bei geändertem Zertifikat (Review Focus 4); Menüeintrag „Verbindung trennen“; `connect` → `pair`, speichern, eigenen Server stoppen, `origin` wechseln, laden; `disconnect` → beste Mühe `DELETE /api/auth/devices/<id>`, `remote` löschen, eigenen Server starten, laden; Versionshinweis einmal je Start.
- [ ] desktop-Tests grün, Commit.

### Task 8: Karte „Mietfuchs im Heimnetz“

**Files:** Create `client/src/desktopRemote.ts`, `client/src/components/RemoteCard.tsx`; Modify `client/src/desktopNetwork.ts` (Typ `DesktopBridge.remote`, `NetworkState.remote?`), `client/src/pages/Einstellungen.tsx`, `client/src/components/NetworkCard.tsx` (ausblenden bei `remote`); Test `client/src/components/RemoteCard.test.tsx`.

**Interfaces:** Consumes Task 7 (Brücke). Produces `remoteBridge(w?): RemoteBridge | null` wie `networkBridge`.

- [ ] Tests: lokal Formular (Adresse, Code, „Verbinden“), Fehlersatz der Brücke am Feld; verbunden „Verbunden mit nas:3001 (Mietfuchs 0.17.0)“ und „Verbindung trennen“ mit Rückfrage; ohne Brücke keine Karte; NetworkCard verbunden ausgeblendet.
- [ ] Rot, umsetzen, grün, uiRules grün, Commit. Durchsicht, PR 3.

## PR 4: Doku und Prüfung (Zweig `feat/kopplung-4-doku`, auf PR 3)

### Task 9: Doku, Website, Prüfläufe

**Files:** Modify `docs/installation.md` (Abschnitt „Programmfenster mit Mietfuchs im Heimnetz verbinden“), `docs/docker.md` (Port direkt, nicht über Caddy), `docs/datenschutz.md` (`fenster.json` mit Geräteschlüssel, `tls/`), `docs/daten-backup.md` (`tls/` nicht im Backup), `MIGRATION.md` falls nötig, `CHANGELOG.md` (0.17.0, Hinzugefügt), `server/src/CLAUDE.md` (Anmeldung: Geräte, HTTPS; Testgriffe), `scripts/CLAUDE.md` (Programmfenster, Prüfungen), `shared/guides.ts` (Anleitung „Programmfenster mit einem Mietfuchs im Heimnetz verbinden“), `scripts/desktop-check.mjs` (Schritt Kopplung: Server aus dem Test mit Passwort, koppeln über die Brücke, Seite über HTTPS geladen, Neustart verbunden, Trennen startet eigenen Server), Website-PR (Funktion „Heimnetz“), Release-Notes im Scratchpad, Kommentar c528 (schließen, completed).

- [ ] Texte schreiben, Wächter grün (anrede, geviertstrich, Sprungmarken).
- [ ] desktop-check lokal unter Linux mit `NKA_RUNTIME=desktop` soweit möglich, auf Windows und macOS über die CI (`full-check`).
- [ ] Integrationsdurchsicht des Endstands (Sicherheit, Daten), Praxislauf, Merge der Reihe nach.
