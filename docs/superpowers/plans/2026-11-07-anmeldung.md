# Anmeldung, wenn der Server von außen erreichbar ist: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lauscht Mietfuchs nicht nur auf 127.0.0.1, schützt ein Passwort den Bestand. Neue Datenordner verlangen es von Anfang an (sichere Voreinstellung für Docker, #447), bestehende sehen einen Hinweis und folgen mit Stufe B. Das Programmfenster gilt über einen Fensterschlüssel als angemeldet. Wer lokal arbeitet, merkt nichts.

**Architecture:** Neues reines Modul `server/src/access.ts` (Zustand aus Lausch-Adresse, `NKA_AUTH`, `zugang.json`, Bestand; Hash, Code, Sitzungen, Bremse, Entscheidung je Anfrage), eingehängt in index.ts als Vorschaltung nach der Host-Prüfung und vor dem Vermerk „umgezogen“, Routen unter `/api/auth`. Dateien `zugang.json` und `einrichtungscode.txt` im Datenordner, nie in der Datenbank. Client: Zustand aus `GET /api/auth`, Anmeldeseite, Einrichtung, Dialog bei 401, Karte in den Einstellungen.

**Tech Stack:** TypeScript, Express, `node:crypto`, React 19, node:test, vitest, Electron (desktop/).

**Spec:** `docs/superpowers/specs/2026-11-07-anmeldung-design.md`

## Global Constraints

- `reachable` folgt nur der Lausch-Adresse (`NKA_HOST` Loopback = `local`); Proxy-Kopfzeilen und `NKA_AUTH=on` machen nur strenger, nie lockerer.
- Ohne `NKA_HOST`-Änderung und ohne Netz (Fenster, Store) ändert sich nichts: kein Hinweis, keine Datei, alle bestehenden Tests grün ohne Anpassung außer api-fenster.test.ts (`0.0.0.0`).
- Stufe A: neuer Datenordner + `network` → `setup`; Bestand ohne `zugang.json` → Übergang (nichts geschrieben). Stufe B nur als eigene PR.
- Hash und Code nie in der Datenbank, im Backup, in Vorversionen, im Umzug; Dateien 0600 über Zwischendatei.
- scrypt N=2^17, r=8, p=1, Salz 16 B, Schlüssel 32 B, `maxmem` 256 MiB, höchstens eine Berechnung zugleich, `timingSafeEqual`.
- Passwort 15 bis 128 Zeichen, NFC, keine Zeichenregeln. Code 12 Zeichen aus 32, 60 Bit.
- Sitzung 32 B, nur SHA-256 im Speicher, Leerlauf 30 min, absolut 8 h, höchstens 50; Cookie `mietfuchs_<instance>` HttpOnly, SameSite=Strict, Path=/, Secure nur bei HTTPS-Angabe.
- Bremse verlangsamt, sperrt nie: erst buchen, dann rechnen; je Adresse ein laufender Versuch, Schlange zwei Plätze; je Adresse ab 5 Fehlversuchen 1 s verdoppelt bis 15 min; Konto ab 20 in 15 min nur +1 s; eigene Zähler für den Code; Zurücksetzen und Neustart leeren alles; 429 mit `Retry-After`.
- Pfade wie Express: ohne Groß/Klein, Schrägstrich am Ende egal (`/^\/(api|uploads|healthz)(\/|$)/i`).
- Origin bei Schreibzugriffen: `Sec-Fetch-Site` vorhanden → nur `same-origin`; sonst `Origin` gegen Host, `X-Forwarded-Host`, `NKA_ALLOWED_HOSTS` (`null` abgelehnt); beides fehlt → Sitzung allein.
- `POST /api/quit` von Loopback ohne Proxy-Kopfzeilen geht ohne Sitzung.
- Fensterschlüssel nur bei `IN_WINDOW`, nur über Loopback, zeitkonstant; `serverEnv` ersetzt eine geerbte Angabe immer; `NKA_AUTH` nur mit Testgriff-Schranken ans Fenster.
- Keine neue Abhängigkeit. Server-Importe mit `.ts`, `import type`, kein `enum`. Nutzertexte siezen, Doku duzen, kein Geviertstrich, keine Namen fremder Software. Jeder Serverstart: `NKA_DATA_DIR` Wegwerf, `CI=1`, `NKA_UPDATE_URL` geschlossen.
- Commits `Refs #528` (und `Refs #447`), nie `Fixes`. Gestapelte Zweige ab `feat/anmeldung-1-kern`, je PR Durchsicht mit frischem Kontext, am Ende Integrationsdurchsicht (Geld entfällt; Daten und Sicherheit) mit `full-check`.

## Review Focus

1. **Umgehung der Vorschaltung**: `/API/backup`, `/Uploads/x.pdf`, `/HEALTHZ`, `/healthz/`, `/api/backup/`, `HEAD /api/backup`, `/api/auth/../units` bekommen 401 bzw. den gekürzten Bericht (Tests in Aufgabe 2); `/API/QUIT` und `/api/quit/` vom Handy im Fenster 403 (Aufgabe 0).
2. **Reverse-Proxy auf demselben Rechner**: `NKA_HOST` fehlt, Anfrage über 127.0.0.1 → 401 ohne Sitzung; `NKA_HOST=127.0.0.1` mit `X-Forwarded-For` und Passwort → 401 (Aufgabe 2).
3. **Niemand ausgesperrt**: Bestand aus 0.16 mit `0.0.0.0` → Übergang, alles geht, Code im Protokoll; `passwort-zuruecksetzen` → `setup` mit neuem Code, alle Sitzungen weg (Aufgaben 1, 3, Praxislauf in 6).
4. **Aussperren durch Dritte**: in Übergang und `off` setzt niemand ohne Code oder Fensterschlüssel ein Passwort (Aufgabe 2).
5. **Bremse unter Last**: 50 gleichzeitige Anmeldeversuche ergeben höchstens 2 Berechnungen, der Rest 429; ein Angreifer mit vielen Fehlversuchen verzögert die richtige Anmeldung nur (Aufgabe 2).
6. **Fensterschlüssel**: geerbtes `NKA_WINDOW_KEY` wird ersetzt; Schlüssel über die Adresse der Netzwerkkarte wirkungslos; fremde Seite im Fenster bekommt die Kopfzeile nicht (Aufgabe 4).

---

### Aufgabe 0: Lücke in `AT_THIS_COMPUTER` schließen (vorbereitende PR, Aufwand S, etwa 1 Stunde)

Bestehender Fehler, unabhängig von der Anmeldung; als eigenes Issue anlegen (vorher beim Projektinhaber nachfragen, Issues sind öffentlich) und mit `Refs #<neu>` beheben.

**Files:**
- Modify: `server/src/index.ts:384-386` (Muster mit `/i` und `(\/|$)`: `/^\/api\/quit(\/|$)/i`, `/^\/api\/ai\/(key|consent)(\/|$)/i`); prüfen, ob die Prüfung von `updateCheck` (Zeile 400) und die Umzugssperre (`app.use('/api/relocation', …)`, Zeile 3360, Express-Abgleich, also schon ohne Groß/Klein) betroffen sind
- Test: `server/test/api-fenster.test.ts`

- [ ] **Step 1: Failing tests**: Fenster nachgestellt (`NKA_RUNTIME: 'desktop'`, `NKA_HOST: '0.0.0.0'`), über die Adresse der Netzwerkkarte: `POST /API/QUIT`, `POST /api/quit/`, `PUT /API/ai/key/text`, `POST /api/AI/consent` → 403 mit Satz; Server läuft danach weiter.
- [ ] **Step 2-4:** rot, Muster ändern, grün, typecheck.
- [ ] **Step 5:** Commit „Im Fenster nur vom eigenen Rechner: auch bei Groß/Klein und Schrägstrich am Ende (Refs #<neu>)“.

### Aufgabe 1: Kern `access.ts` ohne Server (PR 1, Aufwand M, etwa 1 Tag)

**Files:**
- Create: `server/src/access.ts` (Typen `AccessMode = 'setup' | 'password' | 'off'`, `Reachable = 'local' | 'network'`, `AccessState`; Funktionen `reachableOf(host)`, `authSetting(env)` → `'auto' | 'on' | 'off'` oder Fehlersatz, `initialAccess({ reachable, setting, file, hasStock, stage })`, `hashPassword`, `verifyPassword`, `passwordProblem`, `newSetupCode`, `normalizeCode`, `readAccessFile`/`writeAccessFile` (Zwischendatei, 0600, verdorben = `setup`), `createSessions({ now, idleMs, maxMs, max })`, `createBrake({ now })`)
- Test: `server/test/access.test.ts` (neu)

**Interfaces:**
- Produces:
  ```ts
  export type AccessMode = 'setup' | 'password' | 'off'
  export type AccessState = { reachable: Reachable, setting: 'auto' | 'on' | 'off', mode: AccessMode | 'transition', required: boolean }
  export function reachableOf(host: string | undefined): Reachable
  export function initialAccess(input: { reachable: Reachable, setting: 'auto' | 'on' | 'off', file: AccessFile | null, hasStock: boolean, stage: 'A' | 'B' }): { state: AccessState, write: AccessFile | null }
  export async function hashPassword(password: string): Promise<string>
  export async function verifyPassword(password: string, stored: string): Promise<boolean>
  ```

- [ ] **Step 1: Failing tests** in `access.test.ts`:
  - `reachableOf`: `undefined`, `0.0.0.0`, `::`, `192.168.1.5` → `network`; `127.0.0.1`, `127.1.2.3`, `::1`, `::ffff:127.0.0.1` → `local`.
  - `authSetting`: leer → `auto`; `on`/`off`; `ja` → Satz „NKA_AUTH „ja“ …“.
  - `initialAccess` als Tabelle: local/auto → nicht nötig, nichts geschrieben; network ohne Datei ohne Bestand (A) → `setup`, schreibt Datei mit `instance`; network ohne Datei mit Bestand (A) → `transition`, schreibt nichts; dasselbe in B → `setup`; Datei `off` bleibt `off` in A und B; `NKA_AUTH=off` schlägt alles; `on` bei local mit Datei `password` → nötig.
  - `hashPassword`/`verifyPassword`: Rundweg, falsches Passwort false, Format `scrypt$17$8$1$…`, zwei Hashes desselben Passworts verschieden; verdorbener Wert → false ohne Wurf; NFC: „Mü“ zusammengesetzt und zerlegt gleich.
  - `passwordProblem`: 14 Zeichen Satz, 15 ok, 129 Satz, „aaaaaaaaaaaaaaa“ Satz, „MeinMietfuchs2026!!“ Satz.
  - `newSetupCode`: 12 Zeichen aus dem Alphabet, `normalizeCode('k7qm 4xpa-9trw')` gleich `K7QM4XPA9TRW`.
  - Datei: geschrieben 0600 (nur Unix, über `fs.statSync`, Plattform hineingereicht), verdorbenes JSON → `setup` mit Problem.
  - Sitzungen (Uhr hineingereicht): neue Kennung je Anmeldung, nach 30 min Leerlauf ungültig, nach 8 h trotz Nutzung ungültig, die 51. verdrängt die älteste, `revokeAllExcept`.
  - Bremse (Uhr hineingereicht): Versuch wird vor dem Ergebnis gebucht und bei Erfolg zurückgenommen; zweiter gleichzeitiger Versuch derselben Adresse → abgelehnt; dritter Platz in der Schlange → abgelehnt; 4 Fehlversuche frei, 5. → Wartezeit 1 s, verdoppelt bis 900 s; ab 20 Fehlversuchen in 15 min über viele Adressen nur +1 s, nie gesperrt; Code und Passwort zählen getrennt; `reset()` leert alles; Erfolg setzt den Zähler der Adresse zurück.
- [ ] **Step 2:** Tests laufen lassen, rot (`npm --prefix server test -- --test-name-pattern "Zugang"`).
- [ ] **Step 3:** Umsetzen, minimal.
- [ ] **Step 4:** Tests grün, `npm run typecheck` grün.
- [ ] **Step 5:** Commit „Zugang: Zustand, Hash, Code, Sitzungen, Bremse (Refs #528)“.

### Aufgabe 2: Vorschaltung und Routen im Server (PR 2, Aufwand L, etwa 2 Tage)

**Files:**
- Modify: `server/src/index.ts` (Zustand beim Start nach dem Binden und vor dem Öffnen der Datenbank berechnen; Vorschaltung `accessGate` nach der Host-Prüfung Zeile ~158, vor dem Vermerk Zeile ~160; Routen `/api/auth*` mit eigenem `express.json({ limit: '4kb' })` davor; `/healthz` gekürzt ohne Sitzung und ohne Loopback; `Cache-Control: no-store`; Origin-Prüfung bei Schreibzugriffen; Protokollzeilen für Fehlversuche)
- Modify: `server/src/access.ts` (`decide(request, state)` als reine Funktion: Pfad klein geschrieben und normalisiert, wie Express ihn sieht)
- Modify: `server/testing/api.ts` (`startServerIn`/`startServerRaw`: `NKA_HOST: '127.0.0.1'` und `NKA_AUTH: ''` vor `...env`; neuer Helfer `signIn(server, password = 'ein langes Testpasswort')` liest `einrichtungscode.txt`, ruft `/api/auth/setup`, gibt `{ fetch, cookie }` zurück)
- Modify: `server/test/api-fenster.test.ts` (Tests mit `0.0.0.0`: `NKA_AUTH: 'off'`, wo sie die Loopback-Sperre prüfen)
- Test: `server/test/api-anmeldung.test.ts` (neu), `server/test/requestGuard.test.ts` unverändert grün

- [ ] **Step 1: Failing tests** in `api-anmeldung.test.ts` (alle mit `NKA_HOST: '0.0.0.0'`, frischer Ordner, aufgerufen über 127.0.0.1):
  - frischer Ordner: `GET /api/auth` → `{ mode: 'setup', required: true }`; `einrichtungscode.txt` existiert (0600 unter Unix); Protokoll nennt Code und Pfad.
  - ohne Sitzung 401 mit `setup: true`: `GET /api/units`, `/API/units`, `/api/Units`, `/API/backup`, `/api/backup/`, `/uploads/x.pdf`, `/UPLOADS/x.pdf`, `/Uploads/x.pdf`, `HEAD /api/backup`, `GET /api/update`, `/api/auth/../units`, `/api/%61uth/x`; `/HEALTHZ` und `/healthz/` über die Netzwerkkarte nur gekürzt.
  - `POST /api/quit` (`NKA_RUNTIME: 'binary'`) über 127.0.0.1 ohne Sitzung → 200; mit `X-Forwarded-For` → 401; über die Netzwerkkarte → 401. Oberfläche `GET /` und `/assets/…` → 200 (nur gebaut; sonst 404 wie heute, nicht 401).
  - `/healthz` von 127.0.0.1 → voller Bericht; mit Kopfzeile `X-Forwarded-For` (Proxy auf demselben Rechner) ebenfalls voll (hingenommen, Spec); über die Adresse der Netzwerkkarte (wie api-fenster.test.ts:33, Test übersprungen ohne Karte) → nur `app`, `status`.
  - Einrichtung: falscher Code 400 „Der Code stimmt nicht.“; zu kurzes Passwort 400 mit Satz; richtiger Code → 200, `Set-Cookie` mit `HttpOnly`, `SameSite=Strict`, `Path=/`, ohne `Secure`; danach `GET /api/units` mit Cookie 200; Code-Datei weg; zweiter Versuch mit demselben Code 409.
  - `Secure` mit `X-Forwarded-Proto: https`.
  - Anmeldung: falsch 401 „Das Passwort stimmt nicht.“, richtig 200 mit neuer Kennung (anders als die der Einrichtung); Abmelden → altes Cookie 401.
  - Bremse über die Route: 5. Fehlversuch 429 mit `Retry-After`; richtiges Passwort während der Wartezeit ebenfalls 429; 50 gleichzeitige falsche Anmeldungen → höchstens 2 nicht 429; danach von einer anderen Adresse (über die Netzwerkkarte, sonst übersprungen) richtige Anmeldung nach höchstens wenigen Sekunden 200; `passwort-zuruecksetzen` leert die Zähler; `PUT /api/auth/password` mit falschem `current` zählt mit.
  - Origin: `POST /api/units` mit Cookie und `Origin: http://evil.example` ohne `Sec-Fetch-Site` → 403, auch mit `NKA_RUNTIME: 'docker'` (Host-Prüfung dort aus); `Sec-Fetch-Site: same-site` oder `cross-site` → 403 unabhängig von Origin; `Sec-Fetch-Site: same-origin` mit umgeschriebenem Host (`Host: mietfuchs:3001`, `Origin: https://mietfuchs.example.org`, ohne `X-Forwarded-Host`) → 200, ebenso `POST /api/auth/login`; ohne `Sec-Fetch-Site`: `Origin` gleich Host → 200, `X-Forwarded-Host` gleich Origin → 200, `Origin: null` → 403; ohne beides → 200 mit Cookie.
  - Login-Route selbst mit fremdem `Origin` → 403.
  - `PUT /api/auth/password` ohne `current` 400, mit falschem 403, richtig → andere Sitzung 401, eigene gilt weiter (neue Kennung).
  - `POST /api/auth/off` mit `current` → `mode: 'off'`, alles ohne Cookie offen; danach `POST /api/auth/setup` ohne Code 403, mit Code (neu erzeugt beim Ausschalten) 200.
  - Übergang: Ordner mit Bestand (über `openFreshDatabase` und einem Objekt angelegt, dann Start mit `0.0.0.0`) → `mode: 'transition'`, `required: false`, `GET /api/units` ohne Cookie 200, keine `zugang.json` geschrieben, Code-Datei vorhanden; `POST /api/auth/setup` ohne Code 403.
  - `local` (`NKA_HOST: '127.0.0.1'`): `GET /api/auth` → `required: false`, keine Datei; mit `password` aus einer vorher geschriebenen `zugang.json` und `X-Forwarded-For` → 401.
  - `NKA_AUTH: 'off'` bei `0.0.0.0` → offen, `envFixed: true`; `NKA_AUTH: 'on'` bei `127.0.0.1` frisch → `setup`; `NKA_AUTH: 'ja'` → kein Start, Satz.
  - Backup und Wiederherstellen ändern `zugang.json` nicht (Backup-ZIP enthält keinen Eintrag `zugang.json`/`einrichtungscode.txt`).
  - Umgezogener Ordner (Vermerk): Anmeldung geht trotz 423-Regel.
- [ ] **Step 2:** rot.
- [ ] **Step 3:** Umsetzen. Geschützt ist, was auf `/^\/(api|uploads|healthz)(\/|$)/i` passt; Freiliste über `req.path.toLowerCase()` ohne Schrägstrich am Ende (`/api/auth`, `/api/auth/login`, `/api/auth/setup`, `/api/auth/logout`, `/healthz`); die Oberfläche nur für `GET`/`HEAD`.
- [ ] **Step 4:** `npm run test:server` und `npm run typecheck` grün (Exit-Status prüfen, nicht hinter grep).
- [ ] **Step 5:** Commit „Anmeldung im Server: Vorschaltung, Routen, Bremse, Origin (Refs #528, #447)“.

### Aufgabe 3: Betrieb: Zurücksetzen, Protokoll, Browser mit Code, Docker (PR 3, Aufwand S, etwa ½ Tag)

**Files:**
- Modify: `server/src/index.ts` (Startausgabe mit Code bei `setup`/Übergang; `openBrowser(url + '#einrichtung=' + code)` bei `setup`; Prüfung auf `passwort-zuruecksetzen` beim Start und vor jeder Anmeldung/Einrichtung; Zeile bei Proxy-Kopfzeilen an lokalem Server einmal je Start)
- Modify: `server/package.json` (`dev`: `node --env-file=dev.env --watch-path=src src/index.ts`), Create: `server/dev.env` (`NKA_HOST=127.0.0.1`; `--env-file` überschreibt keine gesetzte Variable, plattformneutral)
- Test: `server/test/api-anmeldung.test.ts`, `server/test/api-start.test.ts`

- [ ] **Step 1: Failing tests**:
  - Datei `passwort-zuruecksetzen` bei laufendem Server mit `password` angelegt → nächste Anmeldung 401 mit `setup: true`, neue `einrichtungscode.txt`, alte Sitzung 401, Datei gelöscht, Protokoll nennt neuen Code.
  - Dasselbe beim Start.
  - `NKA_RUNTIME: 'binary'` mit `CI` gesetzt: Protokoll nennt die Adresse mit `#einrichtung=` nicht (kein Browser), aber den Code; ohne `CI` geprüft nur über die reine Funktion `browserUrl(url, state, code)`.
  - Proxy-Zeile: `127.0.0.1`, ohne Passwort, zwei Anfragen mit `X-Forwarded-For` → genau eine Zeile im Protokoll.
- [ ] **Step 2-4:** rot, umsetzen, grün, typecheck.
- [ ] **Step 5:** Commit „Anmeldung: Zurücksetzen über Datei, Code im Protokoll (Refs #528)“.

### Aufgabe 4: Programmfenster: Fensterschlüssel und Heimnetz-Karte (PR 4, Aufwand M, etwa 1 Tag)

**Files:**
- Modify: `desktop/src/server.js` (`serverEnv(base, { …, windowKey })`: `NKA_WINDOW_KEY` immer neu gesetzt, geerbtes ersetzt; `NKA_AUTH` in die Liste der Testgriffe, Zeile ~79)
- Modify: `desktop/src/main.js` (Helfer `serverFetch(path, init)` mit Kopfzeile für alle Abrufe des Hauptprozesses: `readConsent` Zeile ~595, `stopServer` Zeile ~252; Schlüssel je `startServer` mit `crypto.randomBytes(32)`; `session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, …)` setzt `X-Mietfuchs-Window`; bei Neustart für den Heimnetz-Schalter neuer Schlüssel; nie für andere Adressen)
- Modify: `server/src/access.ts`, `server/src/index.ts` (Schlüssel aus der Umgebung nur bei `IN_WINDOW`, nur mit `fromThisComputer`, Vergleich über SHA-256 und `timingSafeEqual`; zählt als angemeldet und als „am Rechner“ für die Einrichtung ohne Code)
- Modify: `client/src/components/NetworkCard.tsx`, `client/src/desktopNetwork.ts` (beim Einschalten ohne Passwort: Felder oder „Ohne Passwort“, ein Entwurf; Satz statt „Mietfuchs hat kein Passwort“)
- Test: `desktop/test/server.test.js` (oder die vorhandene Datei zu `serverEnv`), `server/test/api-fenster.test.ts`, `client/src/pages/Einstellungen.heimnetz.test.tsx`, `client/src/desktopNetwork.test.ts`

- [ ] **Step 1: Failing tests**:
  - `serverEnv`: setzt `NKA_WINDOW_KEY` aus der Angabe, ersetzt ein geerbtes; ausgeliefert ohne Testgriffe kein `NKA_AUTH`.
  - Wächter in desktop/test: main.js ruft den Server nur über `serverFetch` (kein anderes `fetch(` mit `origin`).
  - api-fenster: mit gesetztem Passwort liest `GET /api/settings` mit Kopfzeile (wie `readConsent`) 200; `POST /api/quit` von 127.0.0.1 ohne Kopfzeile beendet trotzdem.
  - api-fenster: `NKA_RUNTIME: 'desktop'`, `NKA_HOST: '0.0.0.0'`, `NKA_WINDOW_KEY` gesetzt, frischer Ordner: über 127.0.0.1 mit Kopfzeile → 200 ohne Cookie; falscher Schlüssel → 401; richtiger Schlüssel über die Adresse der Netzwerkkarte → 401; ohne `IN_WINDOW` (`NKA_RUNTIME: ''`) wirkt die Kopfzeile nicht; Einrichtung mit Kopfzeile ohne Code → 200.
  - Client: Karte, Häkchen an, `/api/auth` meldet keine Einrichtung → Passwortfelder sichtbar; „Speichern“ ruft erst `/api/auth/setup`, dann `network.set(true)`; „Ohne Passwort“ mit Rückfrage → `withoutPassword: true`.
- [ ] **Step 2-4:** rot, umsetzen, grün, `npm run typecheck` (inkl. typecheck-desktop).
- [ ] **Step 5:** `scripts/desktop-check.mjs` um einen Schritt ergänzen: Heimnetz an, Seite lädt im Fenster ohne Anmeldung, Abruf über die Adresse der Netzwerkkarte → 401 (unter Windows und macOS im Release-Lauf).
- [ ] **Step 6:** Commit „Programmfenster gilt als angemeldet, Passwort beim Einschalten des Heimnetzes (Refs #528)“.

### Aufgabe 5: Oberfläche (PR 5, Aufwand L, etwa 2 Tage)

**Files:**
- Create: `client/src/access.ts` (Zustand, Ereignis `mietfuchs:anmeldung`, `appFetch`), `client/src/accessView.ts` (reine Entscheidungen: welche Seite, welche Sätze, Code aus `location.hash`), `client/src/pages/Anmeldung.tsx`, `client/src/pages/Einrichtung.tsx`, `client/src/components/LoginDialog.tsx`, `client/src/components/AccessCard.tsx`, `client/src/components/AccessHint.tsx`
- Modify: `client/src/api.ts` (401 mit `login`/`setup` löst das Ereignis aus), rohe `fetch` in `letterPaper.ts`, `evaluationQueue.ts`, `aiRequest.ts`, `pages/Abrechnung.tsx`, `pages/BelegeEingang.tsx`, `pages/BelegeOrdner.tsx` auf `appFetch`; `client/src/App.tsx` (vor der Schale `GET /api/auth`; Seite oder Dialog), Seitenleiste (Abmelden, Hinweis im Übergang), `pages/Einstellungen.tsx` (Karte)
- Modify: `shared/glossary.ts` (Begriffe „Anmeldung“, „Einrichtungscode“), `shared/guides.ts` (Schritte zum Passwort)
- Test: `client/src/accessView.test.ts`, `client/src/pages/Anmeldung.test.tsx`, `client/src/pages/Einrichtung.test.tsx`, `client/src/components/AccessCard.test.tsx`, `client/src/api.test.ts`, `server/test/guides.test.ts`, `server/test/glossary.test.ts`, `server/test/anrede.test.ts`

- [ ] **Step 1: Failing tests**:
  - `accessView`: `required && !signedIn && mode === 'setup'` → Einrichtung; `password` → Anmeldung; Übergang → App mit Hinweis; `#einrichtung=K7QM-4XPA-9TRW` vorbelegt und danach aus der Adresse entfernt (`history.replaceState`).
  - api.test: 401 mit `login: true` löst das Ereignis aus und wirft weiter `ApiError`.
  - Wächter: außerhalb von `api.ts`/`access.ts` kein `fetch(` in `client/src/**/*.{ts,tsx}` ohne Tests.
  - Anmeldung: Fehlversuch zeigt den Satz des Servers in `role="alert"`, Fokus bleibt im Feld; 429 zeigt Wartezeit.
  - Dialog bei 401 mitten in einem Formular: Formularwerte bleiben, nach Anmeldung Fokus zurück auf den Auslöser.
  - Einrichtung: zwei Felder ungleich → Satz, kein Abruf; zu kurz → Satz mit Mindestlänge; „Ohne Passwort weiter“ fragt zurück.
  - Karte: Passwort ändern verlangt das bisherige; „Anmeldung ausschalten“ mit Rückfrage; bei `envFixed` nur Anzeige.
  - Anleitungen: jede Beschriftung in „…“ wörtlich in der Oberfläche (guides.test.ts); Anrede gesiezt (anrede.test.ts).
- [ ] **Step 2-4:** rot, umsetzen, grün; `npm run test:client`, `npm run typecheck`, `npm run build`.
- [ ] **Step 5:** Commit „Oberfläche: Anmeldung, Einrichtung, Abmelden, Karte in den Einstellungen (Refs #528)“.

### Aufgabe 6: Prüfungen, Doku, Changelog (PR 6, Aufwand M, etwa 1 Tag)

**Files:**
- Modify: `scripts/smoke-test.mjs` (`--code-file`; alle Abrufe über einen Helfer mit Cookie, auch Zeilen 135, 179, 360; Prüfung, dass ohne Cookie `GET /api/units` 401 ist, wenn eingerichtet wurde)
- Modify: `.github/workflows/docker.yml` (nach dem Start auf die Datei warten, `docker exec … cat /app/server/data/einrichtungscode.txt` in eine Datei, `--code-file`), `.github/workflows/ci.yml` (npm, Pfad im Wegwerf-Ordner), `.github/workflows/release.yml` (Programmdateien, Pakete; Pfad im Wegwerf-Ordner)
- Modify: `scripts/umstieg-praxislauf.mjs` (`NKA_HOST=127.0.0.1`; dazu ein Lauf mit `0.0.0.0`: Bestand einer alten Fassung → Übergang, ohne Cookie lesbar; frischer Ordner → `setup`), `scripts/screenshots.mjs`, `scripts/browser-check.mjs` (zweiter Server mit `0.0.0.0`: Anmeldeseite und Einrichtung mit axe in drei Browsern), `scripts/perf-check.mjs` (`NKA_HOST=127.0.0.1`)
- Modify: `docs/docker.md`, `docs/installation.md`, `docs/datenschutz.md`, `docs/entwickeln.md`, `README.md`, `MIGRATION.md`, `deploy/compose.yml`, `deploy/compose.caddy.yml`, `deploy/compose.ollama.yml`, `deploy/Caddyfile` (Kommentar zum Passwort davor: dann `NKA_AUTH=off`), `CHANGELOG.md` („Unveröffentlicht“, Link auf #528), `CLAUDE.md` (Regel für Serverstarts), `server/src/CLAUDE.md` (Abschnitt „Anmeldung“), `scripts/CLAUDE.md` (Fensterschlüssel, Prüfungen), `client/CLAUDE.md` (Anmeldedialog)
- Test: Lauf der Skripte lokal; `server/test/anrede.test.ts` (MIGRATION.md siezen), Wächter gegen Geviertstrich

- [ ] **Step 1:** smoke-test zuerst gegen einen lokal gestarteten Server mit `0.0.0.0` und frischem Ordner laufen lassen: rot (401), dann `--code-file` umsetzen: grün. Ebenso gegen `127.0.0.1`: grün ohne Code.
- [ ] **Step 2:** Praxislauf mit den alten Fassungen (0.13, 0.15, 0.16): Bestand anlegen mit alter Fassung, neue Fassung mit `0.0.0.0` → Übergang, Daten unverändert lesbar, Code im Protokoll; danach Einrichtung mit Code, Anmeldung, Backup ohne `zugang.json`, Wiederherstellen auf frischem Ordner → dort `setup` mit eigenem Code.
- [ ] **Step 3:** Browserlauf (`npm run browser-check`) mit den neuen Seiten grün, axe ohne Befund; Bildschirmfotos neu.
- [ ] **Step 4:** Doku schreiben; `npm test`, `npm run typecheck` grün.
- [ ] **Step 5:** Commit „Anmeldung: Prüfungen und Doku (Refs #528, #447)“.

### Später: Stufe B (eigene PR vor 1.0.0-rc.1, Aufwand S)

- `stage` in `initialAccess` auf `'B'`; Tests der Tabelle aus Aufgabe 1 und der Übergangsfall aus Aufgabe 2 umgestellt (Bestand ohne Datei → `setup`); Hinweistext ohne „ab Version“; Release-Notes und MIGRATION.md.

## Nach den Aufgaben

- [ ] Integrationsdurchsicht `main..Spitze` mit frischem Kontext unter den Blickwinkeln Daten (Backup, Umzug, Vorversionen, Rücksprung ändern den Zugang nicht; Praxislauf) und Sicherheit (Review Focus oben), Label `full-check`.
- [ ] Release-Notes von Stufe A: „Neue Installationen im Netz fragen nach einem Passwort; bestehende sehen einen Hinweis und brauchen es ab 1.0.0-rc.1. Für bestehende Daten ist nichts zu tun.“
- [ ] Website und Texte mitziehen (Funktionen, Docker-Anleitung).
