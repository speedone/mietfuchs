# Kaution (1/2), Buchungen und Stand: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kautionsbuchungen je Mietverhältnis (Eingang, Ertrag, Verrechnung ohne Zahlung, Rückzahlung) mit abgeleitetem Stand, in einem Seitenfenster der Stammdaten.

**Architecture:** Eine Tabelle `deposit_entries` neben `payments`, eine reine Funktion `depositState` in `shared/deposit.ts` für Server und Client, Routen in `server/src/db/deposits.ts` nach dem Muster `db/co2Refunds.ts`. Ohne Buchung gilt der gespeicherte `depositStatus`; `taxReport` und `rentLedger` werden nicht angefasst.

**Tech Stack:** TypeScript (Node 24 ohne Build), drizzle (SQLite), Express 5, React 19, node:test, vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-12-kaution-design.md` (Issue #228). Vor jeder Aufgabe lesen.

## Global Constraints

- Worktree `/home/agent/projects/mietfuchs-kaution`, Zweig `feat/kaution-buchungen` von `main`. Commits deutsch mit `Refs #228`, nie `Fixes`/`Closes`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Commit nur nach grünem Exit-Status von Test **und** `npm run typecheck`.
- Bezeichner englisch; Kommentare, Oberfläche, Meldungen, Testnamen deutsch; Oberfläche siezt.
- **Kein Geviertstrich** im Repo; keine Namen fremder Software.
- Geld in Cent als Integer; `amount_cents` der Buchung ist immer größer 0.
- Server-Importe mit `.ts`, Client endungslos außer aus `shared/`; `import type`; kein `enum`.
- Migration nur mit `npm --prefix server run db:generate` (nächster Schritt 0097), erzeugtes SQL lesen.
- Server-Tests über `startServerIn`/`openFreshDatabase`; Testdaten über die Typen aus `shared/types.ts`.
- Arten: `received`, `interest`, `applied`, `refunded`; jede bewegt Geld. Der Einbehalt beim Auszug ist keine Buchung und kommt mit Teil 2 ans Mietverhältnis. Zwecke: `rent`, `settlement`, `damage`, `other`. **In diesem PR lehnt der Server `applied` mit `rent` oder `settlement` ab** (400, „Zweck der Verrechnung ist Schaden oder Sonstiges.“); die Oberfläche bietet die beiden Zwecke noch nicht an. Teil 2 hebt das auf.
- Rechtsaussagen nur, was die Spec als gelesen führt (§ 551 Abs. 1 bis 4 BGB).
- Golden-Tests bleiben unverändert grün.

## Review Focus

1. **Bestand ohne Buchung**: Stammdaten zeigen und speichern `depositStatus` wie vor dem PR (Task 1, Task 5 Test).
2. **Eingang löschen, nachdem zurückgezahlt wurde**: 400 mit Tag und Betrag, nichts gelöscht (Task 3 Test).
3. **Rückdatierte Rückzahlung vor dem Eingang**: 400, obwohl die Summe am Ende aufgeht (Task 3 Test).
4. **Vereinbarte Kaution fehlt** (`depositCents` leer), Eingang gebucht: Stand `erhalten`, nie `teilweise` (Task 1 Test).
5. **Mietverhältnis in ein anderes Objekt verschoben oder gelöscht**: Buchungen gehen mit bzw. fallen weg, `GET` des alten Objekts liefert sie nicht mehr (Task 3 Test).

---

### Task 1: Stand und Höchstgrenze `shared/deposit.ts`

**Files:**
- Create: `shared/deposit.ts`
- Modify: `shared/types.ts` (nach `DepositStatus`), `shared/law/bgb-betrkv.ts`
- Test: `server/test/deposit.test.ts`

**Interfaces:**
- Produces:
  - `export type DepositEntryKind = 'received' | 'interest' | 'applied' | 'refunded'`
  - `export type DepositPurpose = 'rent' | 'settlement' | 'damage' | 'other'`
  - `export type DepositForm = 'account' | 'pledged' | 'guarantee' | 'other'`
  - `export type DepositEntry = { id: string; tenancyId: string; date: string; kind: DepositEntryKind; amountCents: number; purpose?: DepositPurpose; paymentId?: string; note?: string }`
  - `Tenancy.depositForm?: DepositForm`
  - `export type DepositState` und `export function depositState(tenancy: Pick<Tenancy, 'depositCents' | 'depositStatus'>, entries: readonly DepositEntry[]): DepositState` (Felder wie in der Spec)
  - `export function depositProblem(entries: readonly DepositEntry[]): { date: string; balanceCents: number } | null` (erster Tag, an dem der Stand unter 0 fällt; Ordnung nach `date`, dann Reihenfolge der Liste)
  - `export function depositLimit(tenancy: Tenancy, at?: string): number | null`
  - `export const bgbDepositMaxMonths` im Register, Kennung `bgb.deposit-max-months`, Wert 3, `checked`, Quelle „§ 551 Abs. 1 BGB, gelesen am 12.11.2026“.

- [ ] **Step 1: Failing tests** (Namen deutsch):
  - `ohne Buchung gilt der gespeicherte Stand`: `depositState({ depositCents: 240000, depositStatus: 'erhalten' }, [])` → `{ derived: false, status: 'erhalten', balanceCents: 0, … }`; ohne `depositStatus` → `offen`.
  - `drei Raten ergeben erst teilweise, dann erhalten`: 80000 → `teilweise`, 160000 → `teilweise`, 240000 → `erhalten`, `balanceCents` 240000.
  - `ohne vereinbarte Kaution ist ein Eingang erhalten`.
  - `Ertrag erhöht den Stand`: 240000 + `interest` 1234 → `balanceCents` 241234, `status` `erhalten`.
  - `vollständig ausgezahlt ist zurückgezahlt`: danach `refunded` 241234 → `zurückgezahlt`, `balanceCents` 0.
  - `nur Ertrag ohne Eingang bleibt offen`.
  - `depositProblem`: Eingang 01.03. 1000, Rückzahlung 01.02. 1000 → `{ date: '2025-02-01', balanceCents: -1000 }`; richtige Reihenfolge → `null`.
  - `Höchstgrenze`: Kaltmiete 80000 am Beginn → 240000; spätere Staffel 90000 ändert nichts; Inklusivmiete 100000 → 300000; teilweise inklusiv → `null`; keine Kaltmiete am Beginn → `null`. Das Mietmodell über den vorhandenen Helfer lesen (`tenancyCostModel` bzw. was calc.ts dafür nutzt; liegt er nur im Server, den reinen Teil nach `shared/` ziehen statt zu verdoppeln).
  - Invariante `der Stand ist die Summe der Buchungen`: 200 zufällige Folgen (fester Startwert), `balance === received + interest − applied − refunded`.
- [ ] **Step 2:** `npm --prefix server test -- --test-name-pattern "Stand|Raten|Ertrag|Höchstgrenze|depositProblem"` → FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren** nach den fünf Regeln der Spec in ihrer Reihenfolge.
- [ ] **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0; der Wächter des Rechtsregisters (rules- bzw. law-Tests) grün.
- [ ] **Step 5: Commit** `Kaution: Stand aus den Buchungen und Höchstgrenze nach § 551 BGB (Refs #228)`.

---

### Task 2: Tabelle `deposit_entries` und `deposit_form`

**Files:**
- Modify: `server/src/db/schema.ts` (Listen bei `PAYMENT_KINDS` Zeile ~121, Spalte bei `depositStatus` Zeile ~323, Tabelle hinter `payments` Zeile ~1684)
- Modify: `server/src/db/read.ts` (`readDepositEntries`, `depositForm` am Mietverhältnis), `server/src/db/repository.ts` (`depositForm` in `tenancyValues` Zeilen ~502 und ~2501), `server/src/db/journal.ts` (`TABLE_KINDS`: `deposit_entries: 'payments'`), `server/src/db/errors.ts` (Spaltennamen deutsch)
- Create: Migration über `db:generate`
- Test: `server/test/migrations.test.ts`, `server/test/journal.test.ts` (Wächter läuft von selbst)

**Interfaces:**
- Consumes: Typen aus Task 1.
- Produces: `depositEntries` (drizzle), `DEPOSIT_ENTRY_KINDS`, `DEPOSIT_PURPOSES`, `DEPOSIT_FORMS`; `readDepositEntries(db): Promise<DepositEntry[]>` in Einfügereihenfolge.

- [ ] **Step 1: Failing test** `Kautionsbuchungen: Bedingungen der Tabelle` (eigene Datei `server/test/db-kaution.test.ts`, `openFreshDatabase`): Einfügen mit `amount_cents` 0 oder negativ scheitert; `kind` `foo` scheitert; `purpose` gesetzt bei `received` scheitert; `applied` ohne `purpose` scheitert; `payment_id` bei `damage` scheitert; Löschen des Mietverhältnisses löscht die Buchung; Löschen der verwiesenen Zahlung löscht die Buchung.
- [ ] **Step 2:** Test → FAIL (Tabelle fehlt).
- [ ] **Step 3: Implementieren.** CHECKs: `amount_cents > 0`; `oneOf` für `kind`, `purpose`; `(kind = 'applied') = (purpose IS NOT NULL)`; `payment_id IS NULL OR purpose IN ('rent','settlement')`; Datum mit dem vorhandenen Datums-CHECK-Helfer. Fremdschlüssel beide `cascade`. `deposit_form` mit `oneOf`, NULL erlaubt. `db:generate`, SQL lesen (nur `CREATE TABLE` und `ALTER TABLE … ADD`; baut drizzle `tenancies` neu, den Schritt nach dem Muster 0085/0086 in Spalte und Bedingung teilen, siehe server/src/db/CLAUDE.md).
- [ ] **Step 4:** `npm run test:server` → Exit 0 (migrations, journal, legacy-schema, golden); `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: Tabelle der Kautionsbuchungen und Form der Sicherheit (Refs #228)`.

---

### Task 3: Routen

**Files:**
- Create: `server/src/db/deposits.ts`
- Modify: `server/src/index.ts` (Routen bei den CO₂-Erstattungen Zeile ~1004), `server/src/journalRoutes.ts`
- Test: `server/test/api-kaution.test.ts`

**Interfaces:**
- Consumes: `depositProblem` (Task 1), `depositEntries`, `readDepositEntries` (Task 2).
- Produces:
  - `listDepositEntries(db, propertyId): Promise<DepositEntry[]>`
  - `createDepositEntry(db, body: unknown, newId: () => string): Promise<DepositEntry>`
  - `updateDepositEntry(db, id: string, body: unknown): Promise<DepositEntry>`
  - `removeDepositEntry(db, id: string): Promise<void>`
  - `insertDepositEntries(db, bodies: readonly unknown[], newId: () => string, title: string): Promise<string[]>` (eine Transaktion, ein Eintrag im Verlauf; für #188)
  - `export class DepositError extends Error { status: number }`
  - Routen `GET /api/deposit-entries?property=`, `POST /api/deposit-entries`, `PUT /api/deposit-entries/:id`, `DELETE /api/deposit-entries/:id`; Sätze „Kautionsbuchung angelegt“, „… geändert“, „… gelöscht“ mit Tabelle `deposit_entries`.

- [ ] **Step 1: Failing tests**:
  - `Kautionsbuchung anlegen, ändern, löschen`: POST `{ tenancyId, date: '2025-03-01', kind: 'received', amountCents: 240000 }` → 200 mit `id`; GET liefert sie; PUT Betrag 250000; DELETE; GET leer.
  - `abgelehnt wird`: Betrag 0, -1, 12.5, Text → 400 „Betrag der Kautionsbuchung ist ein Betrag größer als 0.“; Datum `2025-02-30` → 400; unbekannte Art → 400; `applied` ohne Zweck → 400 „Bitte geben Sie an, womit Sie verrechnen.“; Zweck bei `received` → 400; `applied` mit `rent` → 400 „Zweck der Verrechnung ist Schaden oder Sonstiges.“; fremdes Mietverhältnis → 404; `paymentId` im Rumpf wird ignoriert.
  - `der Stand fällt an keinem Tag unter null`: Eingang 01.03. 1000 €, Rückzahlung 01.02. 1000 € → 400 „Mehr als die Kaution hergibt: Am 01.02.2025 lägen -1.000,00 € bei Ihnen.“ (Betrag über `fmtEuro` des Servers); Eingang löschen, nachdem zurückgezahlt ist → 400, Buchung noch da; Eingang auf 500 € kürzen → 400.
  - `Mietverhältnis löschen nimmt die Buchungen mit`; `GET` eines anderen Objekts liefert sie nicht.
  - `Verlauf und Rücksprung`: Nach POST steht „Kautionsbuchung angelegt“ im Verlauf; Rücksprung davor entfernt die Buchung (Helfer aus api-ruecksprung.test.ts).
  - `Mietkonto und Steuer bleiben, wie sie sind`: `GET /api/rentledger/2025` und `GET /api/taxreport/2025` vor und nach vier Buchungen (Eingang, Ertrag, Verrechnung Schaden, Rückzahlung) `deepStrictEqual`.
- [ ] **Step 2:** `npm --prefix server test -- --test-name-pattern "Kautionsbuchung|Stand fällt|abgelehnt wird"` → FAIL.
- [ ] **Step 3: Implementieren.** Prüfen, dann in `writeData` schreiben; die Probe „nie negativ“ rechnet `depositProblem` über die Buchungen des Mietverhältnisses **nach** der gedachten Änderung. `DepositError` in der Fehlerbehandlung von index.ts wie `HeatingError` durchreichen.
- [ ] **Step 4:** `npm run test:server` → Exit 0 (journal-routes.test.ts verlangt die Sätze); `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: Routen für Kautionsbuchungen (Refs #228)`.

---

### Task 4: Formularlogik und Seitenfenster

**Files:**
- Create: `client/src/depositForm.ts`, `client/src/components/DepositDrawer.tsx`
- Modify: `client/src/api.ts` (vier Aufrufe), `client/src/types.ts` (`DEPOSIT_FORM_LABELS`), `client/src/journalView.ts` (Tabelle „Kautionsbuchung“, Spalten, Werte)
- Test: `client/src/depositForm.test.ts`, `client/src/components/DepositDrawer.test.tsx`, `client/src/journalView.test.ts`

**Interfaces:**
- Consumes: `depositState` (Task 1), Routen (Task 3).
- Produces:
  - `DEPOSIT_KIND_OPTIONS: readonly { value: DepositEntryKind; label: string }[]` mit „Eingang“, „Ertrag (Zinsen)“, „Verrechnung“, „Rückzahlung an den Mieter“
  - `DEPOSIT_PURPOSE_OPTIONS` in diesem PR nur „Schaden“ (`damage`), „Sonstiges“ (`other`)
  - `emptyDepositForm(today: string)`, `depositEntryBody(form): { body } | { problems: FormProblem[] }` (Betrag über `parseEuro`)
  - `depositStateText(state: DepositState, tenancy): string`, etwa „Vereinbart 2.400,00 €, eingegangen 1.600,00 €, bei Ihnen liegen 1.600,00 €.“; ohne Buchung „Noch keine Kautionsbuchung. Es gilt der Stand aus den Stammdaten: erhalten.“
  - `signedCents(entry): number` (Anzeige: `applied`/`refunded` negativ)
  - `export default function DepositDrawer(props: { tenancy: Tenancy; entries: DepositEntry[]; onChanged: () => void; onClose: () => void })`

- [ ] **Step 1: Failing tests** depositForm.test.ts: `Rumpf einer Buchung` (deutsche und technische Schreibweise des Betrags; leer → Problem „Kein Betrag“; Verrechnung ohne Zweck → Problem; Zweck wird bei anderer Art nicht gesendet); `Satz zum Stand` für die drei Fälle oben und „abgerechnet“ bei `appliedCents` > 0 und Stand 0.
- [ ] **Step 2: Failing tests** DepositDrawer.test.tsx: `zeigt Buchungen und Stand`; `das Feld Zweck erscheint nur bei Verrechnung, sein angezeigter Wert ist der gesendete`; `Speichern ruft POST und lädt neu`; `Fehler des Servers steht am Formular` (400-Text aus Task 3); `Löschen fragt nach` (Rückfrage nach client/CLAUDE.md).
- [ ] **Step 3:** `npm --prefix client test -- depositForm DepositDrawer` → FAIL.
- [ ] **Step 4: Implementieren** mit `Drawer`, `Field`, `Table`, `useSaving` und den Regeln aus client/CLAUDE.md (Seitenfenster, Rückfragen, Meldungen); nur Tokens, keine Farbwerte (`uiRules.test.ts`).
- [ ] **Step 5:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Kaution: Seitenfenster für Kautionsbuchungen (Refs #228)`.

---

### Task 5: Stammdaten, Hinweis zur Höhe, Doku

**Files:**
- Modify: `client/src/pages/Stammdaten.tsx` (Karte Zeilen ~460, Formular Zeilen ~899 bis 905, Rumpf Zeilen ~380), `client/src/tenancyModel.ts`
- Modify: `CHANGELOG.md`, `server/src/CLAUDE.md` (neuer Abschnitt „Kaution“), `server/src/db/CLAUDE.md` (Löschverhalten), `shared/glossary.ts` (Eintrag „Kaution“, nur § 551 BGB)
- Test: `client/src/pages/Stammdaten.test.tsx`, `client/src/tenancyModel.test.ts`

**Interfaces:**
- Consumes: `DepositDrawer`, `depositStateText`, `depositLimit`, `DEPOSIT_FORM_LABELS`.

- [ ] **Step 1: Failing tests**:
  - `ohne Kautionsbuchung bleibt alles wie bisher`: Auswahlfeld „Stand“ bedienbar, gespeichert wird der gewählte Wert; die Karte zeigt die bisherige Marke.
  - `mit Buchungen ergibt sich der Stand`: Auswahlfeld gesperrt mit Text „ergibt sich aus den Kautionsbuchungen“; beim Speichern des Mietverhältnisses wird `depositStatus` **nicht** gesendet; die Karte zeigt die Marke aus `depositState`.
  - `Knopf Kaution führen öffnet das Seitenfenster`.
  - `Form der Sicherheit`: Auswahlfeld mit „keine Angabe“, vier Formen; angezeigter Wert gleich gespeichertem; `null` leert.
  - `Hinweis über drei Monatsmieten`: Kaltmiete 800 €, Kaution 2.500 € → Text „Mehr als drei Monatsmieten ohne Betriebskosten (2.400,00 €). § 551 Abs. 1 BGB erlaubt höchstens das Dreifache.“; 2.400 € → kein Hinweis; teilweise inklusiv → kein Hinweis.
- [ ] **Step 2:** `npm --prefix client test -- Stammdaten tenancyModel` → FAIL.
- [ ] **Step 3: Implementieren.** Buchungen des Objekts einmal laden (`GET /api/deposit-entries`), je Mietverhältnis filtern.
- [ ] **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: Stand und Seitenfenster in den Stammdaten, Hinweis zur Höhe (Refs #228)`.

---

## Self-Review (vor dem PR)

Spec-Abschnitte „Datenmodell“, „Der Stand“, „Hinweis zur Höhe“, „API“ (ohne `from-payment`), Oberfläche Punkt 1 und Verlauf sind abgedeckt; „Verrechnung erzeugt eine Zahlung“, Aufstellung zum Auszug, Cockpit, Steuer und Praxislauf gehören zu Teil 2. Durchsicht mit frischem Kontext vor dem PR, Befunde mit vorher rotem Test.
