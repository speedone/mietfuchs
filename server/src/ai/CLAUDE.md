# KI-Belegauswertung

Optional, gegen **Ollama** oder einen **OpenAI-kompatiblen Dienst** (#18). **Die KI macht nur
Vorschläge**, übernommen wird erst nach Prüfung durch den Menschen. Gilt auch für
[../extract.ts](../extract.ts), [../extractHeating.ts](../extractHeating.ts) und
[../invoiceAmounts.ts](../invoiceAmounts.ts).

## Aufbau

- [../extract.ts](../extract.ts): das Fachliche (Prompts, JSON-Schemas, Ablauf, Zeitlimits je
  Schritt). Die Kategorie-Enums dort und `CATEGORIES`/`matchCategory` im Client müssen
  zusammenpassen (categories.test.ts).
- [settings.ts](settings.ts): `settings.ai` mit den Plätzen `text` (Standard) und `images` (eigener
  Anbieter für Fotos und Scans), Migration aus `ollamaUrl`/`ollamaModel`, Umgebungsvariablen, und
  was als extern gilt (`isExternalUrl`, `consentProblem`).
- [presets.ts](presets.ts): Vorlagen (Ollama lokal/entfernt/Cloud, OpenAI, IONOS, Mistral, LM Studio,
  eigener Dienst); sie belegen nur vor.
- [index.ts](index.ts): Schnittstelle `json({ prompt, images, schema, timeoutMs, signal, onProgress })
  → { data, stats }`, Wahl des Platzes je Beleg, **Durchsetzung der Bestätigung vor jeder Anfrage**.
- [openai.ts](openai.ts): Chat Completions als SSE-Strom; immer eine Antwortlänge (IONOS nimmt sonst
  16 Token), Temperatur 0 außer bei OpenAI, JSON in Stufen (striktes Schema, Schema ohne `strict`,
  `json_object` mit Schema im Prompt, nur Prompt); was ein Dienst ablehnt, wird je Adresse und
  Modell gemerkt. **Ein Schlüssel erscheint nie in einer Meldung.**
- [ollama.ts](ollama.ts): streamt `/api/chat`, `think: false` (bei Ablehnung einmal ohne), fester
  `num_ctx` 16384 (sonst kürzt Ollama auf 4096; ein wechselnder Wert lädt das Modell neu). Prüft per
  `/api/show` Bildfähigkeit und Weiterleitung an die Cloud; übersetzt Fehler; sucht Ollama unter
  üblichen Adressen (je Betriebsart, nur wenn die eingestellte gar nicht erreichbar war).
- [http.ts](http.ts): **Für KI-Anfragen nie `fetch` direkt**: Node und Bun brechen nach 300 Sekunden
  ohne Antwort-Header ab, und Ollama schickt sie erst mit dem ersten Token.
- [../secrets.ts](../secrets.ts): API-Schlüssel je Platz in `data/secrets.json` (Unix 0600), nie in
  `GET /api/settings`, nicht im Backup; `NKA_AI_API_KEY`/`NKA_AI_API_KEY_FILE` haben Vorrang.

## Rohe Antwort und Zusage (#63)

- **Zwei Typen, eine Grenze**: `RawExtraction`/`RawPosition` in invoiceAmounts.ts sind `unknown`
  (ein Modell kann „neunzehn“ schicken); `Extraction` in shared/types.ts ist die Zusage an den
  Browser. Überschritten wird die Grenze nur in extract.ts: **`rawFromAnswer`** (Eingang; nimmt dem
  Modell die Felder, die Mietfuchs selbst rechnet, und liest Zahlen mit `numberFromModel`) und
  **`toExtraction`** (Ausgang). Dort wird nur geprüft, was die Oberfläche braucht; ein Betrag, der
  keine Zahl ist, fehlt danach, und der Mensch füllt ihn. Kein `as Extraction`: Das Schema verlangt
  den Betrag zwar, aber die Anbindung fällt bis auf „nur Prompt“ zurück.
- **Hochrechnen netto → brutto nur, wenn `vatExplainsGap`**: Der Abstand zwischen Positionssumme und
  Rechnungsbetrag muss sich durch Umsatzsteuer erklären lassen (gegen 19 % plus eine halbe
  Prozentstelle, nach unten bis 0; ein Betrag unter der Summe ist eine Abschlagszahlung). Sonst
  verteilte eine fehlende Position ihren Betrag unbemerkt auf die übrigen, und die Summe passte
  trotzdem. **Und jeder Betrag muss gelesen sein** (`null` aus `toCents` ≠ 0). Dasselbe gilt für den
  §35a-Lohnanteil aus einem Gesamtbetrag. Hochgerechnet wird anteilig auf den Rechnungsbetrag, nie
  mit einem genannten Steuersatz (`vatRatePercent` wird nicht gelesen). Bekannte Grenze: Bei 7 %
  Steuer kann eine fehlende Position bis 10 % durchgehen. Jede Bedingung hat einen Test.

## Belege, Ströme, Abbruch

- **PDFs öffnet der Server nicht**: Der Browser liest sie mit pdf.js
  ([client/src/pdfIntake.ts](../../../client/src/pdfIntake.ts)) und schickt `pdfText`, bei Scans
  (unter 80 Zeichen Text) bis zu vier Seiten als JPEG in `pages`. Seitenbilder bleiben im
  Arbeitsspeicher. So braucht der Server kein natives Modul (#21).
- **Seitenbilder**: `INTAKE_EDGE` Bildpunkte an der langen Kante (client/src/pdf.ts), gemessen im
  KI-Prüflauf (darunter bricht die Trefferquote ein, darüber nur mehr Token); einstellbar über
  `ai.pageImageEdge` bzw. `NKA_AI_IMAGE_EDGE` (600–2600).
- **`/api/extract` und `/api/intake` streamen** bei `Accept: application/x-ndjson`: Header sofort,
  dann `progress`, `heartbeat` (alle 10 s), zuletzt `result` oder `error` (Firefox wartet höchstens
  300 s auf Header). **Abbruch** über `POST /api/ai/cancel/<requestId>` (Feld `requestId`, beim
  Schließen des Tabs per `sendBeacon`) und zusätzlich über das Schließen der Verbindung; die Kennung
  ist der verlässliche Weg (Proxys, ältere Bun). Ein Abbruch stoppt die Anfrage und löscht den eben
  hochgeladenen Beleg. Client: [client/src/aiRequest.ts](../../../client/src/aiRequest.ts).
- **Fehler mit Ausweg** (#487): Scheitert die KI, bleibt der Beleg gespeichert; die Fehlerantwort aller vier Routen
  (`failureOf` in index.ts) trägt `reason` (`AiFailureReason` in shared/types.ts), `kept: true`, `file` und bei
  fehlender Bestätigung `service`, bei „nicht erreichbar“ `provider` (der Satz nennt Ollama nur bei Ollama), im
  Schuhkarton nach einem erkannten Zählerfoto `meterPhoto` („Von Hand erfassen“ führt dann zur Seite Zähler). Erkennt
  ein neuer Versuch eine Rechnung, wird ein als Zählerfoto gekennzeichneter Beleg wieder einer (`unmarkMeterPhoto`).
  Schickt die Meldung in die Einstellungen (Adresse, Kontext, Höchstlänge, Kontingent), trägt sie einen Grund, bei dem
  die Oberfläche „KI-Einstellungen öffnen“ anbietet (`offersAiSettings`). Den Grund setzt, wer die Meldung schreibt (`providerError(…, { reason })` in
  openai.ts, ollama.ts, index.ts; `reasonOf` in errors.ts, ohne Angabe `unreachable` bzw. `other`). Wer eine neue
  Meldung übersetzt, gibt ihr den passenden Grund. Ein neuer Versuch schickt `existingFile`, ohne Kopie. Die
  Oberfläche: client/src/aiFailure.ts, components/KeptReceipt.tsx, Status `gespeichert` in evaluationQueue.ts; in den
  Heizkosten FuelCard („Von Hand erfassen“ öffnet eine neue Lieferung) und ServiceImportCard (kein eigenes Formular,
  also in den Belegordner, der den Beleg kurz hervorhebt), neuer Versuch über `asStored` (aiUpload.ts).
- **Messdienst- und Lieferantenrechnung** ([../extractHeating.ts](../extractHeating.ts), #103):
  `POST /api/heating-plants/:id/service-statement` (nur bei Messdienst) und `…/fuel-invoice`, derselbe
  Strom. Je Belegart **ein** Ausgang (`toServiceExtraction`, `toFuelExtraction`), Netto-Teilmengen mit
  `vatExplainsGap`. **Gespeichert wird nur der Beleg**, keine Auswertung der Belegbuchung; die Seite
  Heizkosten schreibt erst beim Übernehmen über die bestehenden Routen (`serviceImport.ts`,
  `fuelImport.ts`). Eine Nutzerzeile wird nur bei genau einem Treffer zugeordnet. Die Abzugszeile
  wird als Satz genannt, gewählt wird nichts vor. Vorbelegt wird nur, was die Karte zeigt; was
  gelesen, aber nicht übernommen wird, nennt `fuelChecks` als Satz (sonst ginge ein ungesehener
  CO₂-Betrag in den Rumpf). Kalte Blöcke nur, wenn die Heizperiode dem Objektzeitraum gleicht. Erneut
  ausgelesene Abrechnungen sind nicht vorgehakt.

## Bestätigung externer Dienste

Zeigt ein Platz aus dem Haus oder reicht ein lokales Ollama an die Cloud weiter, gehen Belege erst
nach einer Bestätigung hinaus (`POST`/`DELETE /api/ai/consent`, gespeichert mit der Adresse, für die
sie gilt, auch wenn sie aus der Umgebung stammt). Lokal sind dieser Rechner, private und Link-local-
Adressen, Namen ohne Punkt sowie `.local`, `.lan`, `.home.arpa`, `.internal`, `.intern`, `fritz.box`.
**Was extern ist, entscheidet allein der Server** (`aiExternal` in den Einstellungen).

## Umgebung, Modelle, Prüflauf

- **Umgebungsvariablen** `NKA_AI_PROVIDER`, `NKA_AI_URL`, `NKA_AI_MODEL`, `NKA_AI_API_KEY(_FILE)`,
  `NKA_AI_TIMEOUT`, `NKA_AI_MAX_TOKENS`, `NKA_AI_IMAGE_EDGE`, für Ollama auch `NKA_OLLAMA_URL`,
  `NKA_OLLAMA_MODEL`, `NKA_OLLAMA_NUM_CTX`: Die Oberfläche zeigt betroffene Felder gesperrt
  (`fixedByEnv`), gespeichert werden sie nicht; ein ungültiger Wert verhindert den Start mit Meldung.
  Den Schlüssel des Bilder-Anbieters gibt es nur in der Oberfläche. `NKA_OLLAMA_CANDIDATES` ersetzt
  die Suchadressen (Tests). Compose-Profil `ki` startet Ollama mit.
- **Empfehlungen** ([recommendations.ts](recommendations.ts), #33): `BUILT_IN` muss mit
  [ki-modelle.json](../../../ki-modelle.json) übereinstimmen (Test). Nachgeladen nur mit der
  Zustimmung zur Update-Prüfung, höchstens täglich, streng geprüft (`NKA_MODELS_URL` für Tests).
  `POST /api/ai/pull` lädt ein Modell (derselbe Strom), nur für ein Ollama auf diesem Rechner oder im
  Heimnetz, mit Rückfrage in der Oberfläche.
- Routen für ältere Tabs: `/api/ollama/status` (`models` nur Namen, Einzelheiten in `modelDetails`).
- **KI-Prüflauf** ([ai-eval.yml](../../../.github/workflows/ai-eval.yml),
  [scripts/ai-eval.mjs](../../../scripts/ai-eval.mjs)): echte Ollama-Modelle auf Runnern ohne GPU an
  **erfundenen** Belegen (PDF, Scan, Foto; nie echte Rechnungen). Start von Hand oder per Label
  `ai-eval`. Bewertung in [scripts/ai-eval/score.mjs](../../../scripts/ai-eval/score.mjs) (mit
  `score.d.mts`, getestet ohne Modell). [scripts/fake-ollama.mjs](../../../scripts/fake-ollama.mjs)
  beantwortet die Abnahmefälle richtig, so lässt sich die Verdrahtung ohne Modell prüfen.
