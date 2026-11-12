# Kontoauszug (1/3), Schema und Import: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Auszug (camt, MT940, ZIP) lässt sich über zwei Routen planen und übernehmen; gespeichert werden Konten, Importe, Tagessummen und die Umsätze der Vermietung, zweimaliges Einlesen ändert nichts.

**Architecture:** Der vorhandene Leser (`readBankFile`) bleibt unberührt. Eine reine Funktion `planBankImport` entscheidet aus Leseergebnis, Bestand und Antworten, was geschrieben wird; die Ausführung plant in der Schreibschlange neu und vergleicht die Prüfmarke (Muster `markPaid.ts`). Die Datei wird nie abgelegt (multer im Speicher).

**Tech Stack:** TypeScript (Node 24 ohne Build), drizzle (SQLite), Express 5, multer (memoryStorage), node:test.

**Spec:** `docs/superpowers/specs/2026-11-12-kontoauszug-design.md` (Issue #188), Abschnitte „Datenmodell“ und „Import“. Vor jeder Aufgabe lesen.

## Global Constraints

- Worktree `/home/agent/projects/mietfuchs-kontoauszug`, Zweig `feat/kontoauszug-import` von `main`. Commits deutsch mit `Refs #188`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Commit nur nach grünem Exit-Status von Test **und** `npm run typecheck`.
- Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Meldungen siezen. Kein Geviertstrich, keine Namen fremder Software, keine Banknamen in Fixtures außer erfundenen.
- Geld in Cent als Integer. Server-Importe mit `.ts`; `import type`; kein `enum`.
- Migration nur mit `db:generate`, nächste freie Nummer; sechs neue Tabellen, keine Änderung an bestehenden.
- **Privates nie einzeln**: Auf einem Konto `mixed` wird ein Umsatz nur gespeichert, wenn seine Gegenseite Mieter oder Zahler ist oder eine Antwort ihn der Vermietung zuordnet. Kein Hash, kein Zweck, kein Name privater Umsätze in irgendeiner Tabelle.
- `server/src/bank/**` importiert nichts aus `server/src/ai/**` (Wächter in Task 2).
- Voreinstellung der Kontoart `mixed`. Wortlaute der Spec wörtlich („Konto lückenlos eingelesen“, nie „Einnahmen vollständig“).
- Beispielauszüge nur erfunden, unter `server/test/fixtures/camt/` und `…/mt940/`.
- Golden-Tests bleiben unverändert grün.

## Review Focus

1. **Zwei überlappende Auszüge in umgekehrter Reihenfolge** (erst März, dann Februar bis März): derselbe Bestand wie in zeitlicher Reihenfolge (Task 2 Invariante).
2. **Datei mit zwei Konten**, eines bekannt, eines neu und abgelehnt: das bekannte wird übernommen, vom anderen nichts (Task 2 Test).
3. **Zwei gleiche Überweisungen am selben Tag** (gleicher Fingerabdruck): beide gespeichert, beim zweiten Einlesen keine dritte (Task 2 Test).
4. **Mieter überweist von neuem Konto** (unbekannte IBAN, Mischkonto): Rückfrage statt stillem Verwerfen; Antwort „privat“ speichert nichts außer der Tagessumme (Task 2, Task 3 Test).
5. **Ausführen mit veralteter Marke** (zwischen Plan und Ausführen wurde eine Mieter-IBAN geändert): 409 mit neuer Vorschau, nichts geschrieben (Task 3 Test).

---

### Task 1: Tabellen

**Files:**
- Modify: `server/src/db/schema.ts` (neuer Abschnitt „Kontoauszug“ nach den Zahlungen), `server/src/db/journal.ts` (`TABLE_KINDS`: sechs Tabellen → `payments`), `server/src/db/errors.ts`
- Create: `server/src/db/bank.ts` (nur Lesen), Migration
- Test: `server/test/db-kontoauszug.test.ts`, `server/test/migrations.test.ts`

**Interfaces:**
- Produces: drizzle-Tabellen `bankAccounts`, `bankImports`, `bankDays`, `bankTransactions`, `bankTransactionLinks`, `tenancyPayers` mit den Spalten der Spec; `BANK_ACCOUNT_KINDS = ['mixed', 'rental']`, `BANK_SET_ASIDE = ['transfer', 'notRental', 'other']`; Typen `BankAccount`, `BankImport`, `BankDay`, `BankTransaction`, `BankLink`, `TenancyPayer` in `server/src/bank/model.ts` (nur der Server braucht sie; was die Seite später braucht, zieht PR 3 nach `shared/`); `readBankStock(db): Promise<BankStock>`.

- [ ] **Step 1: Failing test** `Kontoauszug: Bedingungen der Tabellen` (`openFreshDatabase`): `amount_cents` 0 scheitert; `kind` `rental` ohne `rental_confirmed_at` scheitert; zweiter Tag mit gleichem (`account_id`, `date`) scheitert; Link mit beiden oder keinem Ziel scheitert; zweiter Link auf dieselbe Zahlung scheitert; der Link hat keine Betragsspalte (Spec, „Der Link trägt keinen Betrag“) (`deposit_entry_id` nur, wenn die Tabelle aus #228 da ist: sonst die Spalte in diesem PR weglassen und in PR 2 ergänzen, im PR-Text vermerken); negative Tagessummen scheitern; Löschen des Kontos löscht Importe, Tage, Umsätze, Links, **nicht** die Zahlung; Löschen der Zahlung löscht den Link; Löschen des Mietverhältnisses löscht seine Zahler.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementieren**, `db:generate`, SQL lesen (nur `CREATE TABLE` und Indizes: `bank_transactions(account_id, booking_date)`, `bank_transactions(fingerprint)`, `tenancy_payers(iban)`).
- [ ] **Step 4:** `npm run test:server` → Exit 0 (journal.test.ts verlangt die Bereiche); `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Tabellen für Konten, Importe, Tage, Umsätze, Verknüpfungen und Zahler (Refs #188)`.

---

### Task 2: `planBankImport`

**Files:**
- Create: `server/src/bank/importPlan.ts`, `server/src/bank/coverage.ts`
- Modify: `server/src/bank/read.ts` (Export `looksLikeBankFile(data: Buffer, name: string): boolean`, ohne den Auszug zu lesen: ZIP-Kennung mit passendem Eintrag, camt-Wurzel, MT940-Kopf)
- Create: Fixtures (erfunden): `camt/zwei-monate-ueberlappend-a.xml`, `…-b.xml`, `camt/zwei-konten.xml`, `camt/doppelte-ueberweisung.xml`, `camt/camt052-laufender-tag.xml`, `camt/camt054-sammler.xml`, `camt/camt053-mit-sammler.xml`
- Test: `server/test/bank-import-plan.test.ts`, `server/test/bank-coverage.test.ts`, `server/test/bank-waechter.test.ts`

**Interfaces:**
- Consumes: `BankReadResult`, `BankStatement`, `BankEntry` aus `bank/statement.ts`; `BankStock` aus Task 1.
- Produces:
  - `export type ImportDecision = { type: 'account'; iban: string; accept: boolean } | { type: 'entry'; key: string; as: 'rent' | 'deposit' | 'private'; tenancyId?: string; rememberPayer?: boolean }` (`key` = Auszug, Tag, laufende Nummer im Tag; kein Hash über Inhalt)
  - `export type ImportQuestion = { type: 'account'; iban: string | null; otherId: string | null } | { type: 'entry'; key: string; bookingDate: string; amountCents: number; counterpartyName: string | null; counterpartyIban: string | null; purpose: string }`
  - `export type ImportWrite = { accounts: BankAccount[]; imports: BankImport[]; days: BankDay[]; transactions: BankTransaction[]; replaced: { removeId: string; parts: BankTransaction[] }[]; payers: TenancyPayer[] }`
  - `export type ImportPlan = { writes: ImportWrite; questions: ImportQuestion[]; findings: { where: string; message: string }[]; summary: { stored: number; knownDays: number; pending: number }; sentence: string; ready: boolean }` (`ready`: keine offene Rückfrage)
  - `export function planBankImport(read: BankReadResult, stock: BankStock, decisions: readonly ImportDecision[], file: { sha256: string; name: string }, newId: () => string, now: string): ImportPlan`
  - `export function importToken(plan: ImportPlan, decisions: readonly ImportDecision[]): string` (SHA-256, ohne die erzeugten Kennungen)
  - `export function coverageOf(imports: readonly BankImport[]): { from: string; to: string } | { gapAfter: string; gapBefore: string } | null`

- [ ] **Step 1: Failing tests**, je Regel der Spec ein Test mit ihrer Nummer im Namen:
  - `1 Auszug mit gescheiterter Saldenprobe wird nicht übernommen`, die übrigen Auszüge der Datei schon.
  - `2 schon eingelesen`: gleiche `sha256` am Konto → keine Schreibvorgänge, Satz mit Datum.
  - `3 unbekanntes Konto ist eine Rückfrage`: ohne Antwort `ready` false; `accept: true` → Konto `mixed`; `accept: false` → nichts von diesem Konto.
  - `4 camt.052`: Umsätze des Tages von `createdAt` zählen in `summary.pending`, nicht in `writes`; ohne `createdAt` alle.
  - `5 camt.054 zerlegt eine gespeicherte Sammelbuchung`: `replaced` trägt die Kennung und drei Teile mit Summe gleich; verknüpft → kein `replaced`, Befund; ohne Treffer → Befund „Zu dieser Aufschlüsselung fehlt der Tagesauszug.“; nie ein Eintrag in `days`.
  - `6 Tagesabgleich`: bekannt und gleich → übersprungen (`knownDays`); bekannt und abweichend → Befund mit dem Wortlaut der Spec, kein Schreibvorgang für den Tag.
  - `7 Mischkonto`: Eingang von Mieter-IBAN und von Zahler-IBAN gespeichert; Rücklastschrift dazu gespeichert; Ausgang an Mieter gespeichert; Ausgang an Unbekannt nicht gespeichert, aber in `debit_cents` und `entry_count`; Eingang von Unbekannt → Rückfrage, Antwort `rent` mit `tenancyId` speichert und legt bei `rememberPayer` einen Zahler an, Antwort `private` speichert nichts.
  - `7 Mietkonto speichert jeden Umsatz`.
  - `zwei gleiche Überweisungen am selben Tag bleiben zwei`.
  - `Satz zum Ergebnis`: „12 Umsätze übernommen, 3 Tage schon eingelesen, 2 Umsätze kommen mit dem Tagesauszug.“; Einzahl richtig („1 Umsatz“, „1 Tag“).
  - `Marke`: gleich bei gleichem Bestand und gleichen Antworten trotz anderer `newId`; anders nach geänderter Mieter-IBAN.
  - Invariante `Einlesen in jeder Reihenfolge ergibt denselben Bestand`: sechs erfundene, überlappende Monatsauszüge, 50 Permutationen mit festem Startwert, auch doppelt; verglichen werden die Mengen der Umsätze (ohne Kennung) und der Tage.
  - Invariante `auf dem Mischkonto steht nichts Privates`: nach jedem Plan hat jeder Umsatz in `writes.transactions` eine Mieter- oder Zahler-IBAN als Gegenseite oder eine Antwort `rent`/`deposit`.
  - `coverageOf`: anschließend → `{ from, to }`; Lücke von einem Tag → `gapAfter`/`gapBefore`; Salden passen nicht → Lücke; ohne Salden → `null`.
  - Wächter `Bankdaten und KI sind getrennt`: liest die Quelltexte unter `server/src/bank/` und `server/src/ai/` und verlangt, dass kein Import die Grenze überschreitet außer `looksLikeBankFile`.
  - `looksLikeBankFile`: wahr für jede Datei unter `fixtures/camt` und `fixtures/mt940` und ein ZIP damit; falsch für ein PDF, ein ZIP mit PDFs, eine XRechnung aus `fixtures/e-invoice`.
- [ ] **Step 2:** `npm --prefix server test -- --test-name-pattern "Auszug|Konto|Tagesabgleich|Mischkonto|Marke|coverageOf|Bankdaten"` → FAIL.
- [ ] **Step 3: Implementieren.** Tagessummen aus allen Umsätzen des Tages laut Auszug (eine zerlegte Sammelbuchung zählt einmal mit `batch.totalCents`). Ordnung überall mit `compareText`.
- [ ] **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Import planen, Tagesabgleich und Mischkonto (Refs #188)`.

---

### Task 3: Routen und Konten

**Files:**
- Modify: `server/src/db/bank.ts` (`applyBankImport`, `updateBankAccount`, `removeBankImport`), `server/src/index.ts` (multer-Feld `statement` in `IN_MEMORY_FIELDS`), `server/src/journalRoutes.ts`
- Test: `server/test/api-kontoauszug.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/bank/import/plan` (multipart, Feld `statement`, Feld `decisions` als JSON) → `{ questions, findings, summary, sentence, ready, token }`
  - `POST /api/bank/import` (dazu `token`) → 200 `{ ok: true, sentence }`; 409 `{ preview }` bei anderer Marke; 400 bei `ready` false („Bitte beantworten Sie zuerst die Rückfragen.“)
  - `GET /api/bank/accounts` → Konten mit `coverage` und Importen
  - `PUT /api/bank/accounts/:id` (`label`, `kind`; `rental` nur mit `confirm: true`, sonst 400 mit dem Satz der Spec)
  - `DELETE /api/bank/imports/:id` (nimmt einen Import zurück; 409 „Zu diesem Auszug sind schon Zahlungen gebucht. Lösen Sie zuerst die Zuordnungen.“, wenn einer seiner Umsätze einen Link hat)
  - Sätze im Verlauf: „Kontoauszug eingelesen“, „Konto geändert“, „Import zurückgenommen“; die Planroute steht in `DRY_RUN_ROUTES`.

- [ ] **Step 1: Failing tests**: `Plan schreibt nichts` (Bestand vorher gleich nachher, kein Eintrag im Verlauf, keine Datei im Datenordner: Verzeichnis vor und nach dem Aufruf vergleichen); `Übernehmen schreibt in einem Zug` (Konto, Import, Tage, Umsätze; ein Eintrag im Verlauf); `zweimal dieselbe Datei` (zweite Antwort „schon eingelesen“, Bestand gleich); `veraltete Marke` (PUT der Mieter-IBAN zwischen Plan und Ausführen → 409, Bestand unverändert); `zu große Datei` → 413 mit deutschem Satz; `keine Bankdatei` (PDF) → 400 mit dem Text des Lesers; `Konto nur für die Vermietung braucht die Bestätigung`; `Import zurücknehmen` (Tage und Umsätze weg, erneutes Einlesen möglich); `Rücksprung über den Import` (Helfer aus api-ruecksprung.test.ts); `Backup und Wiederherstellen tragen die Tabellen` (Helfer aus api-backup.test.ts).
- [ ] **Step 2:** `npm --prefix server test -- --test-name-pattern "Plan schreibt nichts|Übernehmen|veraltete Marke|Import zurücknehmen"` → FAIL.
- [ ] **Step 3: Implementieren.** Beide Routen lesen die Datei mit `readBankFile`, bilden `sha256` aus dem Rumpf, planen mit `readBankStock`; die zweite innerhalb von `writeData`.
- [ ] **Step 4:** `npm run test:server` → Exit 0 (journal-routes.test.ts, api-start.test.ts); `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Routen zum Planen und Übernehmen, Konten (Refs #188)`. Eintrag im CHANGELOG erst mit PR 3 (bis dahin sieht kein Nutzer etwas).

---

## Self-Review (vor dem PR)

Spec „Datenmodell“ → Task 1; „Import“ Regeln 1 bis 9, Lückenlosigkeit, Kontoart → Tasks 2 und 3; „Sicherheit“ (Wächter, keine Datei auf der Platte) → Tasks 2 und 3. Zuordnen, Buchen und Oberfläche sind PR 2 und 3. Durchsicht mit frischem Kontext vor dem PR.
