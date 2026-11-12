# Kaution (2/2), Verrechnung und Auszug: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kaution lässt sich mit Mietrückstand oder Nachzahlung verrechnen (als gebundene Zahlung), eine als Miete gebuchte Kaution umbuchen, und nach dem Auszug zeigt eine druckbare Aufstellung, was auszuzahlen bleibt.

**Architecture:** `applied` mit Zweck `rent` oder `settlement` schreibt in einer Transaktion Buchung und Zahlung; `guardPayment` schützt die gebundene Zahlung. Mietkonto und Steuer rechnen über den vorhandenen Weg der Zahlungen, ohne neue Regel. Aufstellung, Cockpit-Zeile und Steuer-Hinweis sind reine Client-Logik über `depositState`.

**Tech Stack:** wie Teil 1.

**Spec:** `docs/superpowers/specs/2026-11-12-kaution-design.md` (Issue #228), Abschnitte „Verrechnung mit Miete oder Abrechnung erzeugt eine Zahlung“ und „Oberfläche“. Baut auf `docs/superpowers/plans/2026-11-12-kaution-1-buchungen.md` auf.

## Global Constraints

- Zweig `feat/kaution-verrechnung`, gestapelt auf `feat/kaution-buchungen`; nach dessen Merge mit `git rebase --onto main` umstellen. Commits mit `Refs #228`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Alle Regeln aus Teil 1 gelten weiter (Sprache, Cent, kein Geviertstrich, keine fremden Namen, Commit nur bei Grün, `db:generate`).
- Notiz der erzeugten Zahlung wörtlich: `Aus der Kaution verrechnet`.
- Meldung an der gebundenen Zahlung wörtlich: „Diese Zahlung stammt aus der Kaution. Ändern Sie sie bitte dort.“ (409).
- **Vor Task 1 lesen und im PR festhalten** (Spec, Abschnitt Recht): BGH VIII ZR 71/05 im Original; die Anleitung bzw. ELSTER-Hilfe zur Anlage V des jüngsten Jahres zur verrechneten Kaution. Was nicht gelesen ist, wird nicht geschrieben: dann kein Lexikon-Eintrag „Einbehalt“ mit Rechtsaussage, und die Abrechnungszahlung bleibt in der Zeile der Abrechnung.
- Zeilennummern der Anlage V nur über `anlageVLines(year)`.
- Golden-Tests bleiben unverändert grün; als Integrationsdurchsicht des Stapels gelten die Blickwinkel Geld und Daten aus CLAUDE.md, dazu Praxislauf und Label `full-check`.

## Review Focus

1. **Verrechnung mit Rückstand aus dem Vorjahr**: Die Steuer führt den Betrag im Jahr der Verrechnung bei „Mieten für frühere Jahre“, das Mietkonto zeigt den alten Monat bezahlt (Task 1 Test).
2. **Gebundene Zahlung über die Mietkonto-Seite löschen**: Buchung fällt mit, der Stand der Kaution steigt wieder; scheitert die Probe „nie negativ“ nicht daran (Task 1 Test).
3. **Rücksprung über eine Verrechnung**: Buchung und Zahlung kommen gemeinsam zurück bzw. gehen gemeinsam (Task 1 Test).
4. **Umbuchen einer Mietzahlung, die schon Monate getilgt hat**: Die Monate sind danach wieder offen, die Vorschau sagt das vorher (Task 2 Test).
5. **Auszug in der Zukunft oder ohne Mietende**: keine Aufstellung zum Auszug, keine Cockpit-Zeile (Task 3, Task 4 Test).

---

### Task 1: Verrechnung als gebundene Zahlung

**Files:**
- Modify: `server/src/db/deposits.ts`, `server/src/db/repository.ts` (`guardPayment` Zeile ~759; Löschen einer Zahlung)
- Modify: `client/src/depositForm.ts` (`DEPOSIT_PURPOSE_OPTIONS` um „Mietrückstand“ `rent`, „Nachzahlung aus der Abrechnung“ `settlement`), `client/src/pages/Mietkonto.tsx` (gebundene Zahlung: Betrag, Datum, Art nur lesbar, Vermerk „aus der Kaution“)
- Test: `server/test/api-kaution.test.ts`, `server/test/invariant-steuer-zufluss.test.ts`, `client/src/pages/mietkontoZahlungsart.test.tsx`

**Interfaces:**
- Consumes: `createDepositEntry`, `updateDepositEntry`, `removeDepositEntry`, `insertPayments` bzw. der Einfügeweg einer Zahlung im Repository.
- Produces: `DepositEntry.paymentId` gesetzt bei `rent`/`settlement`; `Payment.fromDeposit?: true` in der Antwort von `GET /api/payments` (aus dem Verweis gelesen, keine Spalte), damit der Client sperren kann.

- [ ] **Step 1: Failing tests** api-kaution.test.ts:
  - `Verrechnung mit Mietrückstand legt eine Mietzahlung an`: Mieter zahlt Januar bis November 2025, Dezember offen; Kaution 2.400 € eingegangen; POST `applied`/`rent` 800 € am 2026-02-10 → Zahlung `kind: 'rent'`, Datum, Betrag, Notiz wie oben; `GET /api/rentledger/2025` zeigt Dezember `paid` mit `paidLaterOn` 2026-02-10; Steuer 2026: `income.received.formerYearsCents` enthält 80000; Steuer 2025 unverändert; Stand der Kaution 1.600 €.
  - `Verrechnung mit der Nachzahlung legt eine Abrechnungszahlung an`: `kind: 'settlement'`, `settlementBackPaymentsCents` 2026 steigt um den Betrag.
  - `die gebundene Zahlung ist geschützt`: PUT Betrag, Datum, `kind` oder `tenancyId` → 409 mit dem Satz; PUT `note` und `designatedMonth` → 200.
  - `Löschen in beide Richtungen`: DELETE der Zahlung entfernt die Buchung; DELETE der Buchung entfernt die Zahlung.
  - `Ändern der Buchung zieht die Zahlung mit`: Betrag und Datum; Wechsel des Zwecks von `rent` auf `damage` löscht die Zahlung, zurück legt sie neu an.
  - `Rücksprung`: vor die Verrechnung springen entfernt beide, wieder vor springen bringt beide.
  - `Schaden und Sonstiges legen keine Zahlung an` (bleibt aus Teil 1).
- [ ] **Step 2: Failing test** invariant-steuer-zufluss.test.ts, `eine Verrechnung zählt genau einmal`: Über 100 zufällige Bestände mit festem Startwert je eine Verrechnung `rent`: `received.totalCents` und `paidCents` des Jahres steigen genau um den Betrag, kein anderes Jahr ändert seine Summe um mehr als die Verschiebung der Tilgung (Summe über alle Jahre steigt genau um den Betrag).
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4: Implementieren.** Reihenfolge in der Transaktion: Zahlung einfügen (durch denselben Weg wie `POST /api/payments`, also mit `guardPayment`), dann Buchung mit `payment_id`. `guardPayment` fragt, ob `before.id` in `deposit_entries.payment_id` steht; der Weg aus deposits.ts reicht eine Erlaubnis herein (Parameter, kein globaler Schalter). Die Sperre aus Teil 1 für `rent`/`settlement` entfällt.
- [ ] **Step 5:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Kaution: Verrechnung mit Miete oder Abrechnung als gebundene Zahlung (Refs #228)`.

---

### Task 2: Mietzahlung als Kaution umbuchen

**Files:**
- Modify: `server/src/db/deposits.ts`, `server/src/index.ts`, `server/src/journalRoutes.ts`
- Modify: `client/src/taxIncome.ts`, `client/src/pages/Steuer.tsx` (Hinweis `possibleDeposit` mit Knopf)
- Test: `server/test/api-kaution.test.ts`, `client/src/pages/Steuer.test.tsx`

**Interfaces:**
- Produces: `moveToDeposit(db, paymentId: string, newId: () => string): Promise<DepositEntry>`; Route `POST /api/deposit-entries/from-payment/:paymentId`, Satz „Mietzahlung als Kaution umgebucht“.

- [ ] **Step 1: Failing tests**: `Umbuchen macht aus der Mietzahlung einen Kautionseingang` (Zahlung weg, `received` mit gleichem Datum und Betrag, Notiz übernommen, ein Eintrag im Verlauf, `possibleDeposits` danach leer, `paidCents` des Jahres um den Betrag kleiner); `nur Mietzahlungen`: `settlement`, negative und gebundene Zahlung → 400 „Umbuchen lässt sich nur ein Mieteingang.“; unbekannte Zahlung → 404. Client: Knopf „Als Kaution umbuchen“ je Zeile des Hinweises, Rückfrage nennt Betrag, Datum, Mieter und „Die Zahlung zählt danach nicht mehr als Miete; Monate, die sie gedeckt hat, sind wieder offen.“
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implementieren** (eine Transaktion, `writeData`).
- [ ] **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: als Miete gebuchte Kaution umbuchen (Refs #228)`.

---

### Task 3: Aufstellung zum Auszug

**Files:**
- Create: `client/src/depositSettlement.ts`
- Modify: `server/src/db/schema.ts` (`deposit_hold_cents`, `deposit_hold_note` an `tenancies`, beide NULL erlaubt; Migration über `db:generate`, SQL lesen, bei einem Neubau von `tenancies` nach dem Muster 0092/0093 teilen), `shared/types.ts` (`Tenancy.depositHoldCents?: number`, `Tenancy.depositHoldNote?: string`), Lese- und Schreibweg des Mietverhältnisses in `server/src/db/read.ts` und `repository.ts` (Betrag ganzzahlig und größer 0, Grund bis 200 Zeichen, Betrag nur mit Grund: 400 „Bitte nennen Sie den Grund für den Einbehalt.“), `client/src/components/DepositDrawer.tsx` (zwei Felder „Einbehalt“ und „Grund“ über der Aufstellung, speichern über `PUT /api/tenancies/:id`), Druckregeln neben den vorhandenen (`client/src/printJob.ts`, client/CLAUDE.md lesen)
- Test: `server/test/api-kaution.test.ts`, `server/test/migrations.test.ts`, `client/src/depositSettlement.test.ts`, `client/src/components/DepositDrawer.test.tsx`

**Interfaces:**
- Consumes: `depositState`; die abgeschlossenen Abrechnungen des Objekts, wie `settlementHistory.ts` sie liest.
- Produces:
  - `export type DepositSettlement = { rows: { label: string; cents: number; date?: string; note?: string }[]; balanceCents: number; hold: { cents: number; note: string } | null; payoutCents: number; lastStatement: { label: string; balanceCents: number } | null; pendingPeriods: string[] }`
  - `export function depositSettlement(tenancy: Tenancy, entries: readonly DepositEntry[], statements: readonly ClosedStatementOfTenancy[], today: string): DepositSettlement | null` (`null`, solange das Mietende fehlt oder nach `today` liegt, oder ohne Buchung)

- [ ] **Step 1: Failing tests**: `bleibt auszuzahlen ist Stand minus Einbehalt` (2.412,34 € Stand, `depositHoldCents` 30000 mit Grund „Nebenkosten 2025“ → 2.112,34 €; Einbehalt 9.999,00 € → `hold.cents` gleich dem Stand, `payoutCents` 0); Server: Einbehalt ohne Grund 400, Betrag 0 oder negativ 400, Bestand von vorher liest sich ohne die Felder; `Zeilen in der Reihenfolge Eingänge, Erträge, Verrechnungen, Rückzahlungen`; `letzte Abrechnung als Orientierung` („Nebenkostenabrechnung 2024: Nachzahlung 180,00 €“ bzw. „Guthaben 95,00 €“); `ausstehende Zeiträume` (bewohnt, nicht abgeschlossen → „Abrechnung für 2025 steht noch aus“); `null` bei Mietende morgen, ohne Mietende, ohne Buchung; Stand 0 → `payoutCents` 0 und `hold` `null`. Drawer: Abschnitt „Aufstellung zum Auszug“ nur mit Ergebnis; Knopf „Drucken“ druckt nur den Abschnitt; kein Wort „Vorschlag“, keine Prozentzahl.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** `npm --prefix client test` → Exit 0 (auch `printCss.test.ts`); `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: Aufstellung zum Auszug mit Druck (Refs #228)`.

---

### Task 4: Cockpit, Steuer-Hinweis, Lexikon, Doku, Praxislauf

**Files:**
- Modify: `client/src/cockpitChecks.ts`, `client/src/pages/Cockpit.tsx`, `client/src/jumpTargets.ts` (Sprung ins Seitenfenster)
- Modify: `client/src/taxView.ts` (Hinweis `depositApplied` in der Liste der Hinweise), `client/src/taxIncome.ts`, `client/src/pages/Steuer.tsx`
- Modify: `shared/glossary.ts`, `CHANGELOG.md`, `server/src/CLAUDE.md` (Abschnitte „Kaution“, „Mietkonto“, „Steuer“), `docs/funktionsweise.md`, `scripts/umstieg-praxislauf.mjs`
- Test: `client/src/cockpitChecks.test.ts`, `client/src/taxIncome.test.ts`, `client/src/pages/cockpitSprungziele.test.tsx`

**Interfaces:**
- Produces:
  - `export function depositsAfterMoveOut(tenancies: readonly Tenancy[], entries: readonly DepositEntry[], today: string): { tenancyId: string; tenantName: string; end: string; balanceCents: number }[]`
  - `export function depositAppliedText(entries: readonly DepositEntry[], tenancies: readonly Tenancy[], year: number): string | null`

- [ ] **Step 1: Failing tests**: Cockpit `Kaution nach Auszug`: ausgezogen gestern, Stand 1.600 € → Zeile „Bei Ihnen liegen noch 1.600,00 € von Erika Mustermann (ausgezogen am …).“; ohne Buchungen, Stand 0, Mietende morgen → keine Zeile; der Sprung öffnet das Seitenfenster des Mietverhältnisses. Steuer: `damage` 350 € in 2026 → „Aus Kautionen einbehalten, nicht in den Einnahmen enthalten: 350,00 €. Ob und wo das anzugeben ist, hängt vom Grund ab.“; nur `rent`/`settlement` → `null`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implementieren.** Lexikon „Einbehalt“ nur mit gelesener Quelle (Global Constraints). Praxislauf: Fall mit drei Buchungen, eine davon Verrechnung mit Zahlung; nach Backup und Wiederherstellen sind Buchungen, Zahlung und Stand gleich.
- [ ] **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0; `node scripts/umstieg-praxislauf.mjs` → Exit 0.
- [ ] **Step 5: Commit** `Kaution: Cockpit, Steuer-Hinweis, Lexikon und Doku (Refs #228)`.

---

## Self-Review (vor dem PR)

Alle Abschnitte der Spec sind nach Teil 1 und 2 belegt: Verrechnung (Task 1), Umbuchen (Task 2), Aufstellung (Task 3), Cockpit, Steuer, Doku, Praxislauf (Task 4). Offen bleibt bewusst das Anschreiben zur Kautionsabrechnung (Nicht-Ziel). Integrationsdurchsicht `main..feat/kaution-verrechnung` unter Geld und Daten vor dem Merge.
