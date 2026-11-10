# E-Rechnung in der Belegbuchung (PR 2 von 4): Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein ZUGFeRD-/Factur-X-PDF, das im Eingang oder auf der Seite Kosten hochgeladen wird, landet ohne KI als Auswertung in der Belegbuchung: Der Browser holt das eingebettete XML, der Server liest es mit `readEInvoice` (PR 1), speichert die Auswertung mit Herkunft, Rechnungsnummer und Notizen, und die Ampel zeigt Notizen rot und vorgeschlagene Lohnanteile gelb. Das gilt auch, wenn keine KI erreichbar ist.

**Architecture:** Neues Datei-Feld `eInvoiceXml` (Arbeitsspeicher, nie gespeichert) an `/api/intake` und `/api/extract`; der E-Rechnungs-Weg läuft vor `classifyDocType` und jeder Anfrage an ein Modell und mündet in dasselbe `rememberAssessment`. Neue Spalten an `assessments` und `assessment_lines` (Voreinstellungen ergeben das heutige Verhalten). Die Ampel (`suggestLine`) liest sie. Im Browser liest `pdfIntake.ts` die Anhänge mit pdf.js; der Eingang schickt E-Rechnungen auch ohne KI an die Auswertung. Reine XML-Dateien bleiben abgelehnt (PR 3).

**Tech Stack:** TypeScript, Express 5, multer, SQLite/Drizzle (`npm --prefix server run db:generate`), React 19, pdf.js 6, node:test, vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-09-e-rechnung-design.md` (Abschnitte „Wo gelesen wird“, „Wie die Angaben in die Belegbuchung kommen“, „Ohne KI“, Umsetzung Schritt 2)

## Global Constraints

- Voreinstellungen ergeben das bisherige Verhalten; Golden-Tests bleiben centgenau grün. Eine Auswertung ohne die neuen Angaben (Bestand, Backup, Umstieg) ist `source = 'ki'`, ohne Nummer, ohne Notizen, `labor_guessed = 0`.
- Migrationen nur erzeugt (`db:generate`), Spalte und Bedingung in zwei Schritten (server/src/db/CLAUDE.md, wie 0085/0086). Kein Schritt wird geändert.
- `eInvoiceXml` wird nie auf die Platte geschrieben und nie ausgeliefert; höchstens 25 MB (multer-Grenze). Nur dieses Feld darf XML sein; `file` bleibt wie heute (kein XML, `carriesScript`).
- Der E-Rechnungs-Weg fragt kein Modell, auch nicht zur Einordnung, und braucht keine Bestätigung externer Dienste.
- `refused`/`none` → bisheriger KI-Weg unverändert; der Ablehnungssatz kommt in der Antwort als `eInvoiceRefusal` mit (Erfolg und Fehler).
- Nutzertexte siezen, kein Geviertstrich, keine fremden Namen. Server-Importe mit `.ts`, `import type`. Tests ohne `!`/`as` für Anwesenheit.
- `npm run typecheck`, betroffene Tests und vor dem PR `npm test` grün. Commits deutsch mit `Refs #189`. CHANGELOG „Unveröffentlicht“ bekommt einen Eintrag (für Nutzer sichtbar).

## Review Focus

1. **Erneut auswerten aus dem Posteingang** (`existingFile`): Die Warteschlange baut den Upload aus der gespeicherten Datei neu, also kommt `eInvoiceXml` wieder mit; die zweite Auswertung ersetzt nur offene Zeilen und behält `source`/Notizen der neuen (Task 4, Test).
2. **KI nicht erreichbar, ZUGFeRD-PDF im Eingang**: wird ausgewertet statt nur abgelegt; ein gewöhnliches PDF daneben wird weiter nur abgelegt (Task 5).
3. **Abgelehnte E-Rechnung (Abschlagsrechnung 386) bei erreichbarer KI**: KI wertet wie bisher aus, die Antwort trägt den Satz; bei unerreichbarer KI bleibt der Beleg gespeichert mit Satz (Task 4).
4. **Dieselbe Rechnung zweimal** (ZUGFeRD-PDF und später dieselbe als anderes PDF mit gleicher Nummer und gleichem Steller): zweite Auswertung rot mit Satz (Task 3).
5. **Backup und Wiederherstellen mit neuen Spalten**: ein Backup von heute (ohne Spalten) läuft durch die Kette und ergibt die Voreinstellungen (Task 1 über die bestehenden Tests der Migrationskette).

---

### Task 1: Spalten und Typen

**Files:**
- Modify: `server/src/db/schema.ts` (`assessments`, `assessmentLines`), `shared/types.ts` (`StoredAssessment`, `StoredAssessmentLine`), `server/src/db/assessments.ts` (`saveAssessment`, Lesen), `server/drizzle/` (zwei erzeugte Schritte)
- Test: `server/test/db-assessments.test.ts`, `server/test/schema.test.ts` (Typabgleich), `server/test/migrations.test.ts` (Marken)

**Interfaces:**
- Produces:
  - `StoredAssessment.source: AssessmentSource` mit `type AssessmentSource = 'ki' | 'e-rechnung'` (shared/types.ts), `invoiceNumber: string | null`, `eInvoiceNotes: string[]`
  - `StoredAssessmentLine.laborGuessed: boolean`
  - Spalten: `assessments.source text NOT NULL DEFAULT 'ki'` (Bedingung `IN ('ki','e-rechnung')` im zweiten Schritt), `assessments.invoice_number text`, `assessments.e_invoice_notes text` (JSON-Liste, `NULL` = keine), `assessment_lines.labor_guessed integer NOT NULL DEFAULT 0` (Bedingung `IN (0,1)` im zweiten Schritt)
  - `saveAssessment(db, { …, source?, invoiceNumber?, eInvoiceNotes?, lines: NewLine[] })`, `NewLine.laborGuessed?: boolean`; fehlend = Voreinstellung. Erneutes Auswerten ersetzt `source`, Nummer und Notizen der Auswertung.

- [ ] Tests: speichern und lesen mit allen neuen Feldern; ohne Angabe Voreinstellungen; erneutes Auswerten (zweites `saveAssessment` für dieselbe Datei) ersetzt Herkunft und Notizen; Bedingung lehnt `source = 'x'` ab.
- [ ] Rot sehen, Schema ändern, `db:generate` zweimal (Spalten, dann Bedingungen), Repository, grün sehen. Bestehende Tests der Kette (db-open, migrations, db-changeover, legacy-guard) grün.
- [ ] Commit `Belegbuchung: Herkunft, Rechnungsnummer und Notizen einer Auswertung (Refs #189)`

### Task 2: Server-Weg in `/api/intake` und `/api/extract`

**Files:**
- Modify: `server/src/index.ts` (multer-Felder, `fileFilter`, beide Routen, `rememberAssessment`), `shared/types.ts` (`IntakeResult`/`ExtractResult`/`AiFailure` um `eInvoiceRefusal?: string`), `server/src/journalRoutes.ts` bzw. Aufruf `retitleCurrentGroup`
- Create: `server/test/api-e-rechnung.test.ts`
- Test-Helfer: `server/testing/api.ts` bekommt `uploadPdfWithEInvoice(s, route, xml, opts)` (Datei `PDF` plus Feld `eInvoiceXml`)

**Interfaces:**
- Consumes: `readEInvoice` (PR 1), `normalizeAmounts`, `toExtraction`, Task 1.
- Produces: Antwort wie heute (`{ file, kind: 'rechnung', extraction, assessment, stats }`), `assessment.source === 'e-rechnung'`; bei Ablehnung zusätzlich `eInvoiceRefusal`.

Ablauf in beiden Routen nach `documentOf`: `const xml = filesOf(req).eInvoiceXml?.[0]?.buffer`; ist es da, `readEInvoice(xml)`. Bei `read`: `extraction = toExtraction(normalizeAmounts(raw))`, `stats = []`, `rememberInvoiceDate`, `rememberAssessment(req, file, extraction, signal, { source: 'e-rechnung', invoiceNumber, eInvoiceNotes: notes, laborGuessed })`, Verlaufstitel „Beleg aus der E-Rechnung übernommen“ (`retitleCurrentGroup`), antworten. Sonst weiter wie heute, `eInvoiceRefusal` an `done` und `failureOf` anhängen. Das Feld läuft durch `upload.fields([... { name: 'eInvoiceXml', maxCount: 1 }])` in den Arbeitsspeicher (`storageFor`: auch `eInvoiceXml` → `memoryStore`) und ist im `fileFilter` von `carriesScript` ausgenommen.

- [ ] Tests (nachgebautes Ollama, das bei **jedem** Aufruf scheitert, und eines, das nicht erreichbar ist):
  - PDF + KoSIT 03.06a-CII als `eInvoiceXml` → 200, `assessment.source === 'e-rechnung'`, vier Zeilen, Summe 1.804,00 €, Ollama nie gerufen, Verlauf „Beleg aus der E-Rechnung übernommen“.
  - Dasselbe mit `existingFile` statt neuer Datei.
  - `eInvoiceXml` mit Abschlagsrechnung (386) und erreichbarem Ollama → KI-Weg, `eInvoiceRefusal` gesetzt; mit unerreichbarem → `kept: true`, `eInvoiceRefusal` gesetzt.
  - `eInvoiceXml` mit DOCTYPE → abgelehnt mit Satz, keine Ausnahme, kein 500.
  - `eInvoiceXml` wird nicht im Belegordner abgelegt (`GET /api/uploads` zeigt nur das PDF).
  - `/api/upload` mit `file` = XML bleibt 400 (unverändert).
- [ ] Rot, umsetzen, grün; `api-ki-beleg.test.ts`, `api-belege.test.ts` grün.
- [ ] Commit `E-Rechnung: Auswertung ohne KI beim Hochladen (Refs #189)`

### Task 3: Ampel und Vorauswahl

**Files:**
- Modify: `server/src/assessment.ts` (`linesFromExtraction` nimmt `laborGuessed`, `suggestLine`, `describeAssessment`, `DescribeContext` um die Rechnungsnummern anderer Auswertungen), Aufrufer von `describeAssessment` (`viewRecord`)
- Test: `server/test/assessment.test.ts`, `server/test/api-belegbuchung.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: In `suggestLine`:
  - jede Notiz aus `a.eInvoiceNotes` → `level = 'rot'`, Satz in `reasons` (alle offenen Zeilen der Auswertung)
  - `line.laborGuessed` → mindestens `gelb`, Satz „Lohnanteil aus der Position übernommen; prüfen Sie, ob der Stundensatz Material enthält.“, `preselected = false`
  - andere Auswertung mit gleicher `invoiceNumber` und gleichem `vendor` (getrimmt, klein) und anderer Datei → `rot`, „Rechnung Nr. {n} von {vendor} ist schon ausgewertet (Beleg {originalName})“
  - `source = 'ki'` und Auswertungen ohne Nummer: unverändert (Golden und bestehende Ampeltests grün)

- [ ] Tests je Regel; eine bestehende KI-Auswertung bleibt grün.
- [ ] Rot, umsetzen, grün.
- [ ] Commit `Belegbuchung: Notizen der E-Rechnung rot, vorgeschlagener Lohnanteil gelb (Refs #189)`

### Task 4: Browser liest das eingebettete XML

**Files:**
- Modify: `client/src/pdfIntake.ts` (`OpenedPdf.eInvoiceXml(): Promise<Blob | null>`, `buildUpload`), `client/src/pdf.ts` falls `openPdf` nichts durchreicht
- Test: `client/src/pdfIntake.pdfjs.test.ts` (echtes pdf.js; PDF mit Anhang erzeugt mit pdf-lib `attach`), `client/src/pdfIntake.test.ts` (Attrappe)

**Interfaces:**
- Produces: `buildUpload` hängt `eInvoiceXml` als Blob `application/xml` an, wenn ein Anhang mit Endung `.xml` existiert, dessen erste 4 KB nach `CrossIndustryInvoice` oder `urn:oasis:names:specification:ubl:schema:xsd:` aussehen; bei mehreren der erste in der Reihenfolge `factur-x.xml`, `xrechnung.xml`, `zugferd-invoice.xml`, `ZUGFeRD-invoice.xml`, dann alphabetisch. Inhalt erst laden, wenn es ihn gibt (`getAttachments`, `content` sonst `getAttachmentContent(id)`); über 25 MB nicht anhängen. Textebene und Seitenbilder kommen wie heute zusätzlich mit (der Server fällt bei Ablehnung auf die KI zurück).
- Produces: `hasEInvoice(file: File, reader?: PdfReader): Promise<boolean>` für Task 5.

- [ ] Tests: PDF mit `factur-x.xml` → Feld da, Inhalt gleich; PDF mit Anhang `notiz.xml` ohne passende Wurzel → kein Feld; PDF ohne Anhang → kein Feld; Bild → kein Feld.
- [ ] Rot, umsetzen, grün.
- [ ] Commit `Beleg hochladen: eingebettete E-Rechnung aus dem PDF mitschicken (Refs #189)`

### Task 5: Eingang ohne KI, Hinweise in der Prüfung

**Files:**
- Modify: `client/src/belegeView.ts` (`splitForStore(files, hasEInvoice): Promise<{ evaluate: File[], store: File[] }>`), `client/src/pages/BelegeEingang.tsx` (`storeOnly` gibt E-Rechnungen an die Warteschlange), `client/src/components/AssessmentReview.tsx` (bei `source === 'e-rechnung'` „Aus der E-Rechnung übernommen“ statt der KI-Sätze; Notizen als Liste), Anzeige von `eInvoiceRefusal` in der Warteschlange/KeptReceipt (`client/src/aiFailure.ts`)
- Test: `client/src/belegeView.test.ts`, jsdom-Test zu AssessmentReview, `client/src/aiFailure.test.ts`

- [ ] Tests: `splitForStore` trennt ZUGFeRD-PDF von gewöhnlichem PDF und Bild; AssessmentReview zeigt bei `source: 'e-rechnung'` den Satz und die Notizen und nicht „Mietfuchs hat …“; KeptReceipt zeigt `eInvoiceRefusal`.
- [ ] Rot, umsetzen, grün; `npm run test:client` grün.
- [ ] Commit `Eingang: E-Rechnungen auch ohne KI auswerten (Refs #189)`

### Task 6: Doku

- [ ] `server/src/CLAUDE.md` (Abschnitt Belegbuchung: Herkunft, Notizen, Feld `eInvoiceXml`), `server/src/ai/CLAUDE.md` (Hinweis: E-Rechnung vor jedem Modell), `docs/ki-belegauswertung.md` oder `docs/funktionsweise.md` (ein Absatz, duzen), `CHANGELOG.md` „Unveröffentlicht“ (`[#189](https://github.com/speedone/mietfuchs/issues/189)`).
- [ ] Commit `docs: E-Rechnung in der Belegbuchung (Refs #189)`

### Abschluss

- [ ] `npm test` und `npm run typecheck` grün; Durchsicht mit frischem Kontext, Befunde mit vorher rotem Test.
- [ ] PR gegen `main`: `E-Rechnung (2/4): ZUGFeRD-PDF ohne KI in die Belegbuchung (Refs #189)`.
