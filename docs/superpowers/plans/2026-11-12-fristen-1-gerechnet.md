# Fristen (1/2), gerechnete Fristen und Einwendungen: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Cockpit zeigt eine Karte „Demnächst fällig“ mit Abrechnungsfrist, Einwendungsfrist, Verjährung nach Auszug, Kaution nach Auszug und Eichfrist über alle Objekte; an der versendeten Abrechnung lassen sich Einwendungen erfassen.

**Architecture:** Eine reine Funktion `remindersOf` im Server rechnet die Liste aus einem zusammengestellten Eingang; die Route liefert sie fertig mit Texten, der Client ordnet nur an. Einwendungen sind eine kleine Tabelle mit eigenen Routen. Die Fristregeln stehen im Rechtsregister.

**Tech Stack:** TypeScript (Node 24 ohne Build), drizzle (SQLite), Express 5, React 19, node:test, vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-12-fristen-design.md` (Issue #190). Vor jeder Aufgabe lesen.

## Global Constraints

- Worktree `/home/agent/projects/mietfuchs-fristen`, Zweig `feat/fristen-gerechnet` von `main`. Commits deutsch mit `Refs #190`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Commit nur nach grünem Exit-Status von Test **und** `npm run typecheck`.
- Bezeichner englisch; Kommentare, Oberfläche, Testnamen deutsch; Oberfläche siezt. Kein Geviertstrich, keine fremden Namen.
- Daten in UTC, `'JJJJ-MM-TT'`, inklusive Grenzen; Monatsrechnung nach § 188 Abs. 2 und 3 BGB (fehlender Tag → Monatsletzter). Ordnung mit `compareText`/`compareName`.
- **Zur sicheren Seite** (Spec, Abschnitt Recht): Abrechnungsfrist und Ersatzansprüche ohne § 193; Einwendungsfrist als Monatsletzter des zwölften Monats nach dem Versand, mit § 193 über `deadlineOnWorkday(date, property.state)`.
- Wer mit Feiertagen rechnet, steht mit Grund in `HOLIDAY_USERS` (holidays.test.ts); vor 1995 und wo `holidaysCheckedOn` falsch ist, wird nicht nach § 193 verschoben, und die Zeile sagt „ohne Feiertage gerechnet“.
- `Reminder.title` trägt nie den Namen einer Person, `detail` darf es.
- Schwellen: `soon` bis 60 Tage, Eichfrist ab 18 Monaten vorher, Abrechnungsfrist höchstens drei Jahre alt, Ersatzansprüche sechs Monate.
- Migration nur mit `db:generate`. Golden-Tests bleiben unverändert grün.

## Review Focus

1. **Versand am 29.02.2024, 31.01. und 30.11.**: Einwendungsende ist der Monatsletzte ein Jahr später, bei Samstag, Sonntag oder Feiertag des Landes der nächste Werktag (Task 1 Test).
2. **Abgeschlossen ohne Versanddatum, Frist abgelaufen**: bleibt `overdue` in der Liste, bis das Datum gesetzt ist (Task 2 Test).
3. **Mieterwechsel im Zeitraum**: zwei Mietverhältnisse derselben Wohnung bekommen je eine Einwendungsfrist; die Kennungen unterscheiden sich (Task 2 Test).
4. **Mehrere Objekte, eines ohne Land**: Die Liste trägt das Objekt an der Zeile; ohne Land zählen nur bundesweite Feiertage (Task 2, Task 4 Test).
5. **Abrechnung wiedergeöffnet und neu versendet**: Die Frist rechnet ab dem neuen Versanddatum, erfasste Einwendungen bleiben (Task 3 Test).

---

### Task 1: Fristregeln im Register und Rechenhelfer

**Files:**
- Modify: `shared/law/bgb-betrkv.ts`, `shared/law/practice.ts`, `shared/deadlines.ts`
- Test: `server/test/deadlines.test.ts` (vorhandene Datei des Moduls), der Wächter des Registers

**Interfaces:**
- Produces:
  - Register: `bgbObjectionMonths` (`bgb.objection-months`, 12, `checked`, § 556 Abs. 3 Satz 5 BGB, gelesen am 12.11.2026), `bgbDamageClaimMonths` (`bgb.damage-claim-months`, 6, `checked`, § 548 Abs. 1 BGB), `practiceObjectionEndOfMonth` (`practice.objection-end-of-month`, `true`, `adopted`, mit dem Satz „Rechenweise nicht an einer Entscheidung gelesen; gewählt ist das späteste vertretbare Ende.“)
  - `export function addMonths(date: string, months: number): string` (§ 188 Abs. 2 und 3)
  - `export function endOfMonth(date: string): string`
  - `export function objectionDeadline(sentAt: string, state: FederalState | null): { date: string; shifted: boolean; holidaysChecked: boolean }`
  - `export function damageClaimDeadline(tenancyEnd: string): string`

- [ ] **Step 1: Failing tests**: `addMonths`: 31.08.2025 + 6 → 28.02.2026; 31.08.2027 + 6 → 29.02.2028; 15.03. + 12 → 15.03.; 29.02.2024 + 12 → 28.02.2025. `objectionDeadline`: Versand 15.03.2025 → 31.03.2026; Versand 20.01.2025, Land BY → 31.01.2026 ist Samstag → 02.02.2026, `shifted` true; ein Fall, dessen Monatsletzter auf einen Feiertag nur eines Landes fällt (31.10. Reformationstag: Versand im Oktober, Land BB verschiebt, Land BY nicht); ohne Land nur bundesweite Feiertage; Versand 1993 → nicht verschoben, `holidaysChecked` false. `damageClaimDeadline('2025-08-31')` → `2026-02-28`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren; `objectionDeadline` in `HOLIDAY_USERS` eintragen. **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Fristen: Einwendungsfrist und Verjährung nach Auszug im Register (Refs #190)`.

---

### Task 2: `remindersOf` und Route

**Files:**
- Create: `server/src/reminders.ts`
- Modify: `shared/types.ts` (`Reminder`, `ReminderKind`), `server/src/index.ts` (`GET /api/reminders`)
- Test: `server/test/reminders.test.ts`, `server/test/api-fristen.test.ts`

**Interfaces:**
- Consumes: `settlementDeadline` (shared/period.ts), `calibrationEnd` (shared/calibration.ts), Helfer aus Task 1; `depositsAfterMoveOut` nur, wenn #228 Teil 2 in `main` ist (dann die reine Funktion nach `shared/` ziehen statt sie zu verdoppeln), sonst leere Liste.
- Produces:
  - `export type ReminderInput = { properties: { id: string; name: string; state: FederalState | null; periods: BillingPeriod[]; closed: { period: PeriodKey; sentAt: string | null; tenancyIds: string[] }[]; tenancies: Tenancy[]; units: Unit[]; meters: Meter[] }[]; objections: SettlementObjection[]; deposits: { tenancyId: string; balanceCents: number }[]; custom: CustomReminderRow[] }` (`objections` und `custom` in diesem Task als leere Listen, die Typen als Platzhalter-Alias auf `never[]` bis Task 3 bzw. Plan 2)
  - `export function remindersOf(input: ReminderInput, today: string): Reminder[]`
  - `export async function reminderInput(db: Database): Promise<ReminderInput>` (liest über die vorhandenen Lesewege)
  - `GET /api/reminders?property=` → `Reminder[]`

- [ ] **Step 1: Failing tests** reminders.test.ts (Testdaten über die Typen des Modells):
  - `Abrechnungsfrist`: Zeitraum 2025 nicht abgeschlossen, heute 01.10.2026 → Zeile mit `dueOn` 2026-12-31, `level` `later`; heute 15.11.2026 → `soon`; heute 05.01.2027 → `overdue`; abgeschlossen ohne Versand → bleibt; abgeschlossen und versendet → keine; Zeitraum 2022 heute 2026 → keine; Zeitraum vor dem ersten Mietverhältnis → keine; abweichender Zeitraum (01.05. bis 30.04.) rechnet mit `settlementDeadline`.
  - `Einwendungsfrist je Mieter`: versendet 15.03.2026, zwei Mietverhältnisse in der Abrechnung → zwei Zeilen, Titel „Einwendungsfrist Abrechnung 2025, EG links“, `detail` mit Namen und „frühestens ausgeschlossen ab 01.04.2027. Das Versanddatum ist nur ein Näherungswert für den Zugang.“; nach Ablauf keine.
  - `Ersatzansprüche`: Mietende 31.08.2026, heute 01.10.2026 → `dueOn` 2027-02-28, `detail` „gerechnet ab dem Mietende; maßgeblich ist der Tag, an dem Sie die Wohnung zurückerhalten haben (§ 548 Abs. 1 BGB)“; Mietende in der Zukunft oder älter als sechs Monate → keine.
  - `Eichfrist`: Eichjahr so, dass das Ende in 17 Monaten liegt → Zeile; in 19 Monaten → keine; ohne Eichjahr → keine; abgelaufen → `overdue`.
  - `Kaution nach Auszug` ohne Tag steht vor den datierten Zeilen.
  - `Ordnung und Kennungen`: nach `dueOn`, Objekt, Titel; jede `id` eindeutig; zweiter Lauf liefert dieselben `id`.
  - Invariante über 100 zufällige Bestände (fester Startwert): kein `title` enthält einen `tenantName`; jede Einwendungsfrist ≥ `addMonths(sentAt, 12)`.
- [ ] **Step 2: Failing test** api-fristen.test.ts: `die Liste über zwei Objekte`, `mit ?property gefiltert`, `leerer Bestand liefert []`.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren. **Step 5:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Fristen: Liste der gerechneten Fristen (Refs #190)`.

---

### Task 3: Einwendungen

**Files:**
- Modify: `server/src/db/schema.ts` (`settlementObjections`, `OBJECTION_STATUS = ['open', 'done']`), `server/src/db/journal.ts` (`TABLE_KINDS`: `settlements`), `server/src/db/errors.ts`, `server/src/journalRoutes.ts`, `server/src/index.ts`, `server/src/reminders.ts` (Regel 3)
- Create: `server/src/db/objections.ts`, Migration
- Modify: `client/src/pages/Abrechnung.tsx`, `client/src/api.ts`, `client/src/journalView.ts`; Create: `client/src/objectionForm.ts`
- Test: `server/test/api-fristen.test.ts`, `client/src/objectionForm.test.ts`, `client/src/pages/Abrechnung.test.tsx`

**Interfaces:**
- Produces: `SettlementObjection = { id: string; propertyId: string; period: PeriodKey; tenancyId: string; receivedOn: string; status: 'open' | 'done'; note?: string }`; `listObjections`, `createObjection`, `updateObjection`, `removeObjection`; Routen `GET/POST /api/settlement-objections`, `PUT/DELETE /api/settlement-objections/:id`; Sätze „Einwendung erfasst/geändert/gelöscht“.

- [ ] **Step 1: Failing tests** Server: anlegen, ändern, löschen; 400 bei Datum in der Zukunft („Eine Einwendung kann nicht in der Zukunft eingegangen sein.“), bei Mietverhältnis, das in der Abrechnung nicht vorkommt, bei nicht abgeschlossener oder nicht versendeter Abrechnung („Einwendungen lassen sich erst an einer versendeten Abrechnung erfassen.“); offene Einwendung erscheint in `GET /api/reminders` als `openObjection` ohne Tag und verschwindet mit `done`; Wiederöffnen und neu Abschließen lässt die Einwendung stehen; Löschen des Mietverhältnisses nimmt sie mit; Verlauf.
- [ ] **Step 2: Failing tests** Client: an der versendeten Abrechnung je Mieter „Einwendungen bis frühestens TT.MM.JJJJ möglich“ (Datum aus der Liste des Servers, nicht im Client gerechnet); „Einwendung erfassen“ mit Datum, Notiz, Stand (Auswahlfeld aus fester Liste „offen“, „erledigt“); Hinweis bei Eingang nach dem gerechneten Ende mit dem Satz der Spec; an einer nicht versendeten Abrechnung fehlt der Abschnitt.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren, `db:generate`, SQL lesen. **Step 5:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Fristen: Einwendungen an der versendeten Abrechnung erfassen (Refs #190)`.

---

### Task 4: Karte „Demnächst fällig“

**Files:**
- Create: `client/src/reminderView.ts`, `client/src/components/RemindersCard.tsx`
- Modify: `client/src/pages/Cockpit.tsx`, `client/src/jumpTargets.ts`, `shared/glossary.ts` („Einwendungsfrist“, „Verjährung nach Auszug“), `CHANGELOG.md`, `server/src/CLAUDE.md` (Abschnitt „Fristen und Feiertage“), `client/CLAUDE.md`
- Test: `client/src/reminderView.test.ts`, `client/src/components/RemindersCard.test.tsx`, `client/src/pages/cockpitSprungziele.test.tsx`

**Interfaces:**
- Produces: `export function visibleReminders(all: readonly Reminder[], expanded: boolean): { shown: Reminder[]; hidden: number }` (zugeklappt: `overdue` und `soon` und alle ohne Tag, höchstens acht); `export function dueText(r: Reminder, today: string): string` („überfällig seit 5 Tagen“, „heute“, „in 12 Tagen“, „am 31.12.2026“).

- [ ] **Step 1: Failing tests**: `zugeklappt höchstens acht, überfällige zuerst`; `Alle Termine (n) klappt auf`; `Texte zum Tag` für die vier Fälle und Einzahl („seit 1 Tag“, „in 1 Tag“ → „morgen“); `leere Liste: keine Karte`; `bei zwei Objekten steht das Objekt an der Zeile, bei einem nicht`; `jede Zeile springt` (Abrechnung des Zeitraums, Zähler, Mietverhältnis); die Stufe steht als Wort da, nicht nur als Farbe.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren (Karte über der Checkliste, Bausteine `Card`, Tokens). **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0.
- [ ] **Step 5: Commit** `Cockpit: Karte „Demnächst fällig“ (Refs #190)`.

---

## Self-Review (vor dem PR)

Spec: Regeln 1 bis 6 → Tasks 1 bis 3; Einwendungen → Task 3; Cockpit und Lexikon → Task 4. Eigene Termine und Kalenderdatei sind Teil 2. Durchsicht mit frischem Kontext vor dem PR.
