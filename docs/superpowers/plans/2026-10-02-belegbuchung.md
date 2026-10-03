# Belegbuchung auf dem Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Rechnung landet genau einmal in den Kosten: Die KI-Auswertung eines Belegs wird als
Gegenstand gespeichert, und der Server plant und bucht ihre Zeilen (anlegen, verknüpfen, verwerfen,
lösen) in einer Transaktion mit Summenregel, §35a-Regel und Schutz gegen Wiederholung.

**Architecture:** Zwei neue Tabellen (`assessments`, `assessment_lines`, Migration 0013) halten das
Ergebnis der KI und den Buchungsstand je Zeile; der Zustand einer Zeile wird abgeleitet
(`cost_item_id` mit `ON DELETE SET NULL`). Die fachlichen Prüfungen (`amountProblem`, Rumpf einer
Kostenposition, Ampel, gemerkter Schlüssel) ziehen nach `shared/`. Planen ist eine reine Funktion
(`server/src/bookingPlan.ts`), Buchen führt deren Schreibliste in einer Transaktion durch die
Schreibschlange aus; eine Prüfmarke (`token`) bindet die Buchung an die gezeigte Vorschau. Eine
Komponente „Auswertung prüfen“ ersetzt die doppelte Logik von Schnellerfassung und Kostenseite.

**Tech Stack:** Node 24 (TypeScript ohne Bauschritt), Express 5, drizzle-orm (sqlite-proxy) mit
drizzle-kit, node:test; React 19, Vite, vitest + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-02-belegbuchung-design.md` (verbindlich). Dazu
`CLAUDE.md` im Repo-Root, vor allem „Die Datenbank“, „Belegordner“ und „Doppelte Kostenpositionen“.

## Global Constraints

- Arbeitsverzeichnis: Worktree `/home/geoerger/projects/mietfuchs-buchung`, Zweig `feat/belegbuchung` (liegt auf `feat/belegordner`, PR #175). **Nicht pushen.**
- Jede Aufgabe endet mit `npm test` **und** `npm run typecheck`, beide mit Exit-Status 0, und erst dann mit dem Commit. Nie hinter einem `grep` committen; den Exit-Status selbst prüfen (`echo $?`).
- Commit-Nachrichten deutsch, mit der Zeile `Refs #170` (nie `Fixes`/`Closes`) und am Ende den zwei Zeilen
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb`.
- Keine Beads (`bd create`, `bd sync`): Aufgaben nur als GitHub-Issues, und die nur nach Rückfrage beim Nutzer.
- Bezeichner englisch; Kommentare, Oberflächentexte, Fehlermeldungen, Testnamen und Commits deutsch; Oberfläche in Sie-Anrede.
- Server-Importe tragen die Endung `.ts`; reine Typimporte mit `import type`; kein `enum`, kein `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- Geld immer in Cent als ganze Zahl; Datum als ISO-Zeichenkette, in UTC gerechnet.
- `shared/` bekommt Laufzeitanteil nur als `.ts`-Datei ohne eigene `package.json`; das Dockerfile übernimmt `shared/` schon.
- Migration nur mit `npm --prefix server run db:generate -- --name belegbuchung` erzeugen, nie von Hand schreiben; die Marke von 0013 kommt in `server/test/migrations.test.ts`.
- Namen von Prüfbedingungen enden auf `_not_negative`, `_known`, `_is_json`, `_positive` oder `_complete` (Wächter in `server/test/db-errors.test.ts`).
- `POST` und `PUT /api/costItems` bleiben **unverändert** (Spec, Entscheidung 5).
- Keine Zahl einer bestehenden Abrechnung ändert sich: Golden-Tests (`settlement-golden`, `db-golden`) bleiben unverändert grün.
- Jeder Schreibvorgang läuft durch `opened.write` (in index.ts `writeData`), jeder Lesevorgang durch `opened.read` (`readData`).
- Wer für eine Prüfung einen Server startet, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL` auf einen geschlossenen Port.
- Der eingefrorene Eingang (`server/src/legacy/`) bleibt unberührt; der Umstieg aus einer `db.json` kennt keine Auswertungen.

## Review Focus

1. **Gleichzeitige Buchung aus zwei Tabs:** Zwei `book`-Anfragen mit derselben Entscheidung, die
   zugleich ankommen, ergeben genau eine Position; die zweite antwortet „ohne Änderung“. Mit
   verschiedenen Entscheidungen für dieselbe Zeile antwortet die zweite mit 409 und dem Stand.
   Test: Task 3 (`zwei gleichzeitige Buchungen …`) und Task 4 (über die Route mit `Promise.all`).
2. **Löschen einer Position mit verknüpften Zeilen aus zwei Belegen:** Beide Zeilen werden wieder
   offen, beide Belege stehen wieder im Posteingang mit „Weiter prüfen“, keine andere Position
   ändert sich. Test: Task 2 (Datenbank) und Task 5 (`/api/uploads`).
3. **Objektwechsel während offener Auswertung:** Gebucht wird immer im Objekt der Auswertung, nie
   im gerade gewählten; ein Ziel aus einem anderen Objekt ist ein Fehler, und das Objekt einer
   Auswertung mit gebuchten Zeilen lässt sich nicht mehr ändern (409). Test: Task 3 (Ziel aus
   anderem Objekt) und Task 4 (`?property=` des anderen Objekts wird beim Buchen nicht beachtet,
   `PUT` mit gebuchter Zeile ergibt 409).
4. **Auswertung eines Belegs, dessen Datei inzwischen gelöscht wurde:** Sie erscheint nicht mehr
   in `GET /api/assessments`; `plan` und `book` antworten 404 mit einem Satz statt eine Position
   mit totem Beleg anzulegen; `DELETE /api/uploads/:file` nimmt die Auswertung mit und ist
   gesperrt, solange eine Zeile gebucht ist. Test: Task 3 (404), Task 5 (Löschen).
5. **Vorschau ≠ Buchung bei geändertem Stand zwischen `plan` und `book`:** Ändert jemand
   dazwischen den Betrag der Zielposition oder bucht eine zweite Zeile an sie, antwortet `book` mit
   409 und der neuen Vorschau, statt still etwas anderes zu buchen. Test: Task 3
   (`geänderter Stand zwischen Vorschau und Buchung …`) und Task 6 (die Komponente zeigt die neue
   Vorschau an).

## Entscheidungen, wo die Spezifikation offen ist

1. **Zusätzliche Spalten** neben der Tabelle der Spezifikation: `assessments.detected_year` (die Ampel braucht „Rechnungsjahr ≠ Zieljahr“, auch wenn das Zieljahr geändert wird), `amounts_adjusted` und `labor_from_total` (die Hinweise aus #34 sollen das Neuladen überleben), `assessment_lines.category_guessed` (gelb bei geratener Kostenart). Alle nullbar oder mit Vorgabe.
2. **Summenregel über alle Zeilen einer Position, angelegte wie verknüpfte.** Sonst verlöre eine angelegte Position ihren Betrag, sobald eine zweite Zeile mit ihr verknüpft wird.
3. **Vorschau ≠ Buchung:** Die Vorschau trägt eine Prüfmarke (`token`), `book` verlangt sie und antwortet bei geändertem Stand mit 409 und neuer Vorschau. Die Spezifikation sagt nur „die Vorschau stimmt wörtlich mit dem Ergebnis überein“.
4. **Bestätigte Rückfrage** als `despiteCandidates: true` an der Entscheidung `create`; ohne sie lehnt `book` eine Zeile mit Kandidaten ab (400 mit Vorschau).
5. **Verknüpfen mit Berichtigung:** `link` darf `amountCents`/`labor35aCents` mitschicken (falsch gelesener Betrag); die Zeile speichert den berichtigten Wert.
6. **Erneutes Auswerten:** neue Zeilen bekommen nie benutzte Nummern (nicht „nach der höchsten gebuchten“), und eine neue Zeile, die einer gebuchten gleicht (Betrag und Beschreibung oder Kostenart), wird nicht wieder offen; Jahr und Objekt folgen nur ohne gebuchte Zeile.
7. **Beleg gleichen Inhalts** (gleiche Prüfsumme, andere Datei): Zeilen sind rot und nicht vorab angehakt, Verknüpfen mit einer Position, an der der Zwilling schon hängt, ist ein Fehler. Die Spezifikation nennt nur „derselbe Beleg zweimal“.
8. **Objekt der Auswertung:** das des Belegs im Posteingang, sonst das mitgeschickte, sonst bei einem einzigen Objekt dieses; fest, sobald eine Zeile gebucht ist (409). Das Jahr bleibt änderbar (`PUT /api/assessments/:id`).
9. **Datei gelöscht:** Auswertung fehlt in der Liste, `plan`/`book` 404; `DELETE /api/uploads` nimmt die Auswertung mit und ist bei gebuchter Zeile gesperrt.
10. **Position mit Beleg, aber ohne ausgewertete Zeilen** (von Hand zugeordnet) als Verknüpfungsziel: erlaubt, Betrag wird ersetzt, die Vorschau warnt ausdrücklich.
11. **Dieselbe Entscheidung auf allen Wegen:** Die Kostenseite übernimmt die Ampel der Schnellerfassung; eine rote Zeile (z. B. ohne erkanntes Rechnungsjahr) ist dort nicht mehr vorab angehakt, und das Jahr aus dem Beleg geht vor dem gewählten.
12. **„Alle grünen übernehmen“** bucht nur Vorschläge des Servers, nicht ungespeicherte Eingaben in der Tabelle, und nacheinander je Auswertung.
13. **`release` einer angelegten Zeile** ist ein Fehler mit Hinweis auf das Löschen der Position (Spezifikation: „löst man, indem man die Position löscht“).
14. **jsdom-Tests rechnen mit dem echten Planer** (`client/src/testing/fakeBooking.ts` importiert die reinen Server-Module), statt Antworten des Servers von Hand nachzubauen.

---

## Dateien

Neu:

| Datei | Verantwortung |
| --- | --- |
| `shared/categories.ts` | Kostenarten, `NOT_ALLOCABLE`, `isNotAllocable`, `matchCategory`, `defaultKeyFor` (aus `client/src/types.ts`, dort weitergereicht) |
| `shared/costItem.ts` | `euro`, `amountProblem`, `CostItemDraft`, `costItemBody` (Prüfung und Rumpf einer Kostenposition in Cent) |
| `shared/assessment.ts` | Ampel (`scorePosition`), Vorauswahl, gemerkter Schlüssel für KI-Zeilen (`aiPositionDefaults`), `KeyContext`, `lastExternalBasis` |
| `server/src/assessment.ts` | reine Funktionen der Auswertung: Zeilen aus der KI, Zustand, Vorschläge (`describeAssessment`), Entwurf einer Zeile (`lineDraft`) |
| `server/src/bookingPlan.ts` | reiner Planer (`planBooking`), Entscheidung über das Buchen (`decide`), Lesen der Entscheidungen (`parseDecisions`) |
| `server/src/db/assessments.ts` | Tabellenzugriff: speichern, ersetzen offener Zeilen, lesen, Zeilen schreiben, Verweise für den Belegordner |
| `server/src/db/booking.ts` | Vorschau und Buchung über die Datenbank, Ansicht einer Auswertung |
| `server/drizzle/0013_belegbuchung.sql` + `meta/0013_snapshot.json` | Migration (erzeugt) |
| `client/src/assessment.ts` | Zeilenentwürfe, Entscheidungen, Abrufe `plan`/`book` |
| `client/src/components/AssessmentReview.tsx` | Komponente „Auswertung prüfen“ |
| `client/src/testing/fakeBooking.ts` | nachgebauter Server für jsdom-Tests, mit dem echten Planer |
| `scripts/fake-ollama.mjs` | nachgebautes Ollama für Praxislauf und Browserprobe |
| Tests: `server/test/shared-cost-item.test.ts`, `server/test/assessment.test.ts`, `server/test/db-assessments.test.ts`, `server/test/booking.test.ts`, `client/src/pages/booking.test.tsx`, `client/src/assessment.test.ts`, `client/src/pages/kostenKiZiel.test.tsx` | |

Geändert: `shared/types.ts`, `client/src/types.ts`, `client/src/costForm.ts`, `client/src/triage.ts`,
`client/src/receipts.ts`, `client/src/api.ts`, `client/src/App.tsx`, `client/src/components/AiKeyCell.tsx`,
`client/src/pages/{Schnellerfassung,Kosten,Belege,Cockpit}.tsx`, `server/src/db/schema.ts`,
`server/src/db/repository.ts`, `server/src/index.ts`, `server/test/{schema,migrations,api,db-backup}.test.ts`,
`scripts/umstieg-praxislauf.mjs`, `CHANGELOG.md`, `CLAUDE.md`.

Entfernt: `client/src/components/DuplicateNotices.tsx`; in `client/src/triage.ts` `AiRow`,
`LinkOffer`, `DuplicateGroup`, `linkOffer`, `duplicateGroups`; in `client/src/costForm.ts`
`AiPosition`, `aiPositionForm`, `aiPositionBody`, `aiPositionProblem`; die Testdateien
`client/src/pages/creditIntake.test.tsx` und `client/src/pages/aiAmount.test.tsx` (ersetzt durch
`booking.test.tsx`).

---

### Task 1: Prüfungen nach `shared/` (ohne Verhaltensänderung)

**Files:**
- Create: `shared/categories.ts`, `shared/costItem.ts`, `shared/assessment.ts`
- Modify: `shared/types.ts` (Typ `TrafficLight`), `client/src/types.ts:40-115`, `client/src/costForm.ts` (amountProblem, buildCostItemBody, KeyContext bis aiPositionPreselect), `client/src/triage.ts:1-110`
- Test: `server/test/shared-cost-item.test.ts` (neu); unverändert grün bleiben müssen `client/src/costForm.test.ts`, `client/src/costForm.memory.test.ts`, `client/src/triage.test.ts`, `client/src/carryOver.test.ts`, `server/test/categories.test.ts`

**Interfaces:**
- Consumes: `shared/allocation.ts` (`allocationOf`, `previousAllocation`, `PARTICIPANT_KEYS`, `Allocation`), `shared/duplicates.ts` (`sameCostCandidates`)
- Produces:
  - `shared/categories.ts`: `CATEGORIES: string[]`, `NOT_ALLOCABLE: readonly string[]`, `isNotAllocable(category: string): boolean`, `matchCategory(raw: string): string`, `defaultKeyFor(category: string): CostKey`
  - `shared/costItem.ts`: `euro(cents: number): string`, `amountProblem(amount: number | null, labor35a: number | null, category?: string): string | null`, `CREDIT_WITH_AMOUNTS: string`, `inBasis(u): boolean`, `type CostItemDraft`, `type CostItemBody`, `type BuildResult = { error: string } | { body: CostItemBody }`, `costItemBody(d: CostItemDraft, units: readonly Unit[], year: number): BuildResult`
  - `shared/assessment.ts`: `createScorer()`, `type PositionCtx`, `scorePosition(ctx: PositionCtx): { level: TrafficLight; reasons: string[] }`, `candidateText(i: CostItem): string`, `aiRowPreselected(r): boolean`, `categoryDeviationPct(items, category, year, amountCents): number | null`, `invoiceSumCheck(positionsSumCents, totalGrossCents): string | null`, `type KeyContext`, `lastExternalBasis(items)`, `etwByStatement(category, ctx?)`, `type AiPositionKey = { key: CostKey; allocation: Allocation | null }`, `aiPositionDefaults(category, units, meters, ctx?, description?): AiPositionKey`, `aiPositionPreselect(d: AiPositionKey): boolean`
  - `shared/types.ts`: `export type TrafficLight = 'gruen' | 'gelb' | 'rot'`

- [ ] **Step 1: Write the failing test**

`server/test/shared-cost-item.test.ts`:

```ts
// Die Prüfung einer Kostenposition in shared/ (Belegbuchung, #170). Formular und Server benutzen
// dieselbe Funktion; das Formular reicht Cent herein und formuliert selbst nichts mehr. Dass das
// Formular sich dabei nicht ändert, halten client/src/costForm.test.ts und costForm.memory.test.ts
// fest; hier steht die Schnittstelle in Cent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { amountProblem, costItemBody, euro, type CostItemDraft } from '../../shared/costItem.ts'
import { defaultKeyFor, isNotAllocable, matchCategory } from '../../shared/categories.ts'
import { aiPositionDefaults, aiRowPreselected, scorePosition } from '../../shared/assessment.ts'
import type { Unit } from '../../shared/types.ts'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true },
]
const draft = (patch: Partial<CostItemDraft> = {}): CostItemDraft => ({
  category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: '', invoiceFile: null,
  amountCents: 61240, labor35aCents: 0, key: 'area', directUnitId: null, meterType: null,
  customShares: {}, participants: null, external: { measure: 'mea', total: null, totalCents: null },
  tenancyAmounts: {}, selfAmounts: {}, ...patch,
})
const errorOf = (built: ReturnType<typeof costItemBody>): string => ('error' in built ? built.error : assert.fail('kein Fehler'))

test('Rumpf einer Kostenposition: dieselben Felder wie bisher im Formular', () => {
  const built = costItemBody(draft(), UNITS, 2025)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual(built.body, {
    year: 2025, category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: undefined, amountCents: 61240,
    labor35aCents: undefined, key: 'area', directUnitId: null, meterType: null, customShares: null,
    participantUnitIds: null, externalBasis: null, tenancyAmounts: null, selfAmounts: null, invoiceFile: null,
  })
})

test('Betrag und Lohnanteil: Gutschrift ja, 0 € nein, unlesbar nein', () => {
  assert.equal(amountProblem(-5000, 0), null)
  assert.match(amountProblem(0, 0) ?? '', /0 €/)
  assert.match(amountProblem(null, 0) ?? '', /Euro-Betrag/)
  assert.match(amountProblem(-5000, 100) ?? '', /Gutschrift/)
  assert.match(amountProblem(10000, null) ?? '', /§35a-Lohnanteil muss/)
  assert.match(amountProblem(10000, 20000) ?? '', /§35a-Lohnanteil muss/)
  assert.match(amountProblem(10000, 100, 'Zuführung Erhaltungsrücklage') ?? '', /Erhaltungsrücklage/)
  const credit = costItemBody(draft({ amountCents: -5000 }), UNITS, 2025)
  assert.ok('body' in credit && credit.body.amountCents === -5000)
})

test('Verteilung: Anteile, Teilnehmer, Gemeinschaft und Einzelbeträge in Cent geprüft', () => {
  assert.match(errorOf(costItemBody(draft({ key: 'custom', customShares: { u1: null } }), UNITS, 2025)), /Anteil für „EG"/)
  assert.match(errorOf(costItemBody(draft({ key: 'custom', customShares: { u1: 60, u2: 50 } }), UNITS, 2025)), /mehr als 100 %/)
  assert.match(errorOf(costItemBody(draft({ participants: [] }), UNITS, 2025)), /mindestens eine teilnehmende/)
  const alle = costItemBody(draft({ participants: ['u1', 'u2'] }), UNITS, 2025)
  assert.ok('body' in alle && alle.body.participantUnitIds === null, 'alle angehakt heißt alle')
  const eine = costItemBody(draft({ participants: ['u1'] }), UNITS, 2025)
  assert.ok('body' in eine && JSON.stringify(eine.body.participantUnitIds) === '["u1"]')
  assert.match(errorOf(costItemBody(draft({ key: 'external' }), UNITS, 2025)), /Gemeinschaftsabrechnung/)
  assert.match(errorOf(costItemBody(draft({ key: 'amounts', tenancyAmounts: { t1: 70000 } }), UNITS, 2025)), /mehr als der Rechnungsbetrag/)
  assert.match(errorOf(costItemBody(draft({ key: 'amounts', amountCents: -100 }), UNITS, 2025)), /Gutschrift/)
  assert.match(errorOf(costItemBody(draft({ key: 'direct' }), UNITS, 2025)), /Wohnung wählen/)
  assert.match(errorOf(costItemBody(draft({ key: 'meter' }), UNITS, 2025)), /Zählertyp/)
  assert.match(errorOf(costItemBody(draft({ description: '  ' }), UNITS, 2025)), /Beschreibung/)
})

test('Nicht umlagefähig: gespeichert wird die neutrale Vorgabe, eine stehengebliebene Zuordnung fällt weg', () => {
  const built = costItemBody(draft({ category: 'Nicht umlagefähig', key: 'direct', directUnitId: null }), UNITS, 2025)
  assert.ok('body' in built)
  assert.equal(built.body.key, 'area')
  assert.equal(built.body.directUnitId, null)
})

test('Kostenarten und Ampel stehen in shared/ und sagen dasselbe wie bisher', () => {
  assert.equal(matchCategory('Frischwasser'), 'Wasser/Abwasser')
  assert.equal(matchCategory('Heizungsreparatur'), 'Nicht umlagefähig')
  assert.equal(isNotAllocable('Zuführung Erhaltungsrücklage'), true)
  assert.equal(defaultKeyFor('Müllabfuhr'), 'persons')
  assert.equal(euro(61240), (612.4).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }))
  const credit = scorePosition({ category: 'Müllabfuhr', amountCents: -5000, labor35aCents: 0, matchedByDesc: false, vendor: 'Stadt', detectedYear: 2025, targetYear: 2025, existingItems: [] })
  assert.equal(credit.level, 'gelb')
  assert.deepEqual(aiPositionDefaults('Müllabfuhr', UNITS, []), { key: 'persons', allocation: null })
  assert.equal(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gruen', candidates: [] }), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/shared-cost-item.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `shared/costItem.ts`.

- [ ] **Step 3: `TrafficLight` in `shared/types.ts`**

Am Ende von `shared/types.ts` anfügen:

```ts
// Die Ampel einer ausgewerteten Rechnungsposition (Schnellerfassung, Belegbuchung #170): grün
// heißt sicher, gelb prüfen, rot fehlt etwas. Steht hier, weil Server und Browser sie zeigen.
export type TrafficLight = 'gruen' | 'gelb' | 'rot'
```

- [ ] **Step 4: `shared/categories.ts` anlegen**

Den Block aus `client/src/types.ts` von `export const CATEGORIES = [` bis zum Ende von
`defaultKeyFor` **wortgleich** hierher verschieben, mit diesem Kopf:

```ts
// Die Kostenarten und was an ihnen hängt (Belegbuchung, #170). Bis hierher standen sie in
// client/src/types.ts; seit der Server die KI-Zeilen selbst den Kostenarten zuordnet und ihren
// Schlüssel vorschlägt, braucht er dieselbe Liste und dieselbe Zuordnung. Die Oberfläche reicht
// sie weiter, ihre Importe bleiben unverändert. Dieselbe Menge wie NOT_ALLOCABLE_CATEGORIES in
// server/src/calc.ts; categories.test.ts hält beide zusammen.
import type { CostKey } from './types.ts'

export const CATEGORIES = [
  'Grundsteuer',
  'Wasser/Abwasser',
  'Niederschlagswasser',
  'Müllabfuhr',
  'Straßenreinigung',
  'Gebäudereinigung',
  'Gartenpflege',
  'Beleuchtung/Allgemeinstrom',
  'Schornsteinfeger',
  'Sach- und Haftpflichtversicherung',
  'Hauswart',
  'Aufzug',
  'Kabel/Antenne',
  'Heizung und Warmwasser',
  'Sonstige Betriebskosten',
  'Nicht umlagefähig',
  // #143: nicht umlagefähig und steuerlich erst bei Verwendung abziehbar
  'Zuführung Erhaltungsrücklage',
]

// Kostenarten, die nie auf Mieter verteilt werden.
export const NOT_ALLOCABLE: readonly string[] = ['Nicht umlagefähig', 'Zuführung Erhaltungsrücklage']
export const isNotAllocable = (category: string): boolean => NOT_ALLOCABLE.includes(category)

// Ordnet eine frei formulierte Kategorie (z. B. aus der KI-Auswertung) der
// nächstliegenden Betriebskostenart zu, statt hart auf „Sonstige" zu fallen.
export function matchCategory(raw: string): string {
  if (CATEGORIES.includes(raw)) return raw
  const s = raw.toLowerCase()
  if (/müll|abfall|restabfall|biotonne|wertstoff/.test(s)) return 'Müllabfuhr'
  // Vor „Instandhaltung“: Die Instandhaltungsrücklage ist die Zuführung zur Erhaltungsrücklage (#143).
  // Eine Entnahme oder eine Zahlung „aus der Rücklage“ ist keine Zuführung; dieselbe Regel wie
  // `looksLikeReserveContribution` in server/src/calc.ts.
  if (/r(ü|ue|u)cklage/.test(s) && (/zuf(ü|ue|u)hrung/.test(s) || !/entnahme|\baus\s+(der|dem)\b/.test(s))) return 'Zuführung Erhaltungsrücklage'
  // Eine Entnahme oder Zahlung aus der Rücklage ist eine bezahlte Erhaltungsmaßnahme: nicht
  // umlagefähig, aber Werbungskosten (zweite Browserabnahme).
  if (/r(ü|ue|u)cklage/.test(s)) return 'Nicht umlagefähig'
  // Reparaturen, Instandhaltung und Dämmung zuerst: „Heizungsreparatur“ ist nicht umlagefähig und
  // darf nicht über „heiz“ zur Heizkostenart werden.
  if (/instandhalt|reparatur|dämmung|verwaltung|nicht umlage/.test(s)) return 'Nicht umlagefähig'
  // Vor „Wasser“, sonst fiele „Warmwasser“ unter Wasser/Abwasser (#93). Die Messdienste mit
  // Wortgrenze, sonst träfe „ista“ auch „Distanz“.
  if (/heiz|warmwasser|wärme|pellet|\b(techem|ista|brunata|minol)\b/.test(s)) return 'Heizung und Warmwasser'
  if (/niederschlag|regenwasser|oberflächenwasser/.test(s)) return 'Niederschlagswasser'
  if (/wasser|abwasser|kanal/.test(s)) return 'Wasser/Abwasser'
  if (/grundsteuer|grundbesitz/.test(s)) return 'Grundsteuer'
  if (/versicherung|haftpflicht/.test(s)) return 'Sach- und Haftpflichtversicherung'
  if (/straßenreinigung|strassenreinigung|winterdienst/.test(s)) return 'Straßenreinigung'
  if (/schornstein|kamin|feuerstätte/.test(s)) return 'Schornsteinfeger'
  if (/garten|außenanlage|grünpflege/.test(s)) return 'Gartenpflege'
  if (/strom|beleuchtung/.test(s)) return 'Beleuchtung/Allgemeinstrom'
  if (/gebäudereinigung|hausreinigung|treppenhausreinigung/.test(s)) return 'Gebäudereinigung'
  if (/hauswart|hausmeister/.test(s)) return 'Hauswart'
  if (/aufzug|lift/.test(s)) return 'Aufzug'
  if (/kabel|antenne|breitband/.test(s)) return 'Kabel/Antenne'
  return 'Sonstige Betriebskosten'
}

// Sinnvolle Vorbelegung des Umlageschlüssels je Kostenart
export function defaultKeyFor(category: string): CostKey {
  if (category === 'Wasser/Abwasser' || category === 'Müllabfuhr') return 'persons'
  return 'area'
}
```

In `client/src/types.ts` den verschobenen Block löschen und an seiner Stelle weiterreichen:

```ts
// Kostenarten, Zuordnung und Vorbelegung stehen seit der Belegbuchung (#170) in shared/, weil
// der Server dieselbe Antwort braucht. Hier weitergereicht, damit die Importe der Seiten bleiben.
export { CATEGORIES, NOT_ALLOCABLE, defaultKeyFor, isNotAllocable, matchCategory } from '../../shared/categories.ts'
```

- [ ] **Step 5: `shared/costItem.ts` anlegen**

```ts
// Prüfung und Rumpf einer Kostenposition (Belegbuchung, #170). Bis hierher standen beide im
// Formular (client/src/costForm.ts, `amountProblem` und `buildCostItemBody`) und galten nur im
// Browser. Seit der Server KI-Zeilen selbst als Positionen anlegt, braucht er dieselbe Prüfung,
// sonst behandelte er eine Gutschrift oder einen §35a-Lohnanteil anders als das Formular.
//
// Die Funktionen nehmen **Cent und Codes** und keine Eingabetexte: Was „54,00“ heißt, liest die
// Oberfläche (parseEuro), und was sie nicht lesen konnte, kommt als `null` herein. Die Meldungen
// sind dieselben Sätze wie bisher im Formular; client/src/costForm.test.ts hält sie fest.
import type { CostKey, ExternalBasis, ExternalMeasure, MeterType, Unit } from './types.ts'
import { PARTICIPANT_KEYS } from './allocation.ts'
import { isNotAllocable } from './categories.ts'

// Ein Betrag wie in der Oberfläche (client/src/api.ts, fmtEuro): „612,40 €“.
export const euro = (cents: number): string => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const pct = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// Gehört die Wohnung zur Abrechnungseinheit? Vermietet oder selbstgenutzt; dieselbe Regel wie
// `basisUnitsOf` in client/src/costForm.ts (`usageOf(u) !== 'ausgenommen'`).
export const inBasis = (u: Pick<Unit, 'participates' | 'selfUsed'>): boolean => u.participates || u.selfUsed === true

export const CREDIT_WITH_AMOUNTS = 'Bei einer Gutschrift sind Einzelbeträge nicht möglich; verteilen Sie sie bitte nach einem anderen Schlüssel.'

// Betrag und §35a-Lohnanteil einer Kostenposition (#139). `null` bei einem Betrag heißt unlesbar.
// Eine Gutschrift hat einen negativen Betrag; Berechnung und Datenbank kennen sie. Nur 0 ist
// keine Kostenposition. Die Meldung nennt den Grund, statt „gültig“ offen zu lassen.
export function amountProblem(amount: number | null, labor35a: number | null, category?: string): string | null {
  if (amount === null) return 'Bitte den Betrag als Euro-Betrag angeben, z. B. 54,00 (eine Gutschrift mit Minus: -54,00).'
  if (amount === 0) return 'Ein Betrag von 0 € ist keine Kostenposition. Bitte den Rechnungsbetrag eintragen.'
  // § 35a EStG bescheinigt gezahlte Lohnkosten. Bei einer Gutschrift bescheinigte die Berechnung
  // ohnehin nichts (calc.ts meldet den Lohnanteil als ungültig), die Steuerübersicht zählte ihn
  // aber mit.
  if (amount < 0 && labor35a !== 0) return 'Bei einer Gutschrift gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  // Die Zuführung zur Erhaltungsrücklage ist keine bezahlte Arbeit, sondern angespartes Geld
  // (#143); einen Lohnanteil gibt es erst an der Rechnung, die die Gemeinschaft daraus bezahlt.
  if (category === 'Zuführung Erhaltungsrücklage' && labor35a !== 0) {
    return 'An der Zuführung zur Erhaltungsrücklage gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  }
  if (labor35a === null || labor35a < 0 || (amount > 0 && labor35a > amount)) {
    return 'Der §35a-Lohnanteil muss eine gültige Zahl zwischen 0 und dem Gesamtbetrag sein.'
  }
  return null
}

// Was eine Kostenposition werden soll, in Zahlen. `null` heißt jeweils „nicht lesbar“: Die
// Oberfläche reicht, was sie nicht lesen konnte, so herein, und die Prüfung sagt es in Worten.
export type CostItemDraft = {
  category: string
  description: string
  vendor: string
  invoiceFile: string | null
  amountCents: number | null
  // 0 heißt kein Lohnanteil, `null` unlesbar
  labor35aCents: number | null
  key: CostKey
  directUnitId: string | null
  meterType: MeterType | null
  // Prozent je Wohnung, nur eingetragene; `null` unlesbar. Ein negativer Wert bleibt negativ und
  // wird abgelehnt.
  customShares: Record<string, number | null>
  // `null` heißt alle Wohnungen, auch künftig angelegte
  participants: string[] | null
  external: { measure: ExternalMeasure; total: number | null; totalCents: number | null }
  // Nur die Beträge, deren Feld die Oberfläche zeigt; `null` unlesbar
  tenancyAmounts: Record<string, number | null>
  selfAmounts: Record<string, number | null>
}

// Der Rumpf, der an die Datenbank geht. Felder, die zum Schlüssel nicht gehören, stehen
// ausdrücklich auf `null`: Die generische PUT-Route übernimmt nur vorhandene Felder, sonst blieben
// alte Zuordnungen stehen.
export type CostItemBody = {
  year: number
  category: string
  description: string
  vendor: string | undefined
  amountCents: number
  labor35aCents: number | undefined
  key: CostKey
  directUnitId: string | null
  meterType: MeterType | null
  customShares: Record<string, number> | null
  participantUnitIds: string[] | null
  externalBasis: ExternalBasis | null
  tenancyAmounts: Record<string, number> | null
  selfAmounts: Record<string, number> | null
  invoiceFile: string | null
}

export type BuildResult = { error: string } | { body: CostItemBody }

// Liest eine Liste von Beträgen; `null`, wenn einer unlesbar oder negativ ist.
function amountsOf(m: Record<string, number | null>): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const [id, cents] of Object.entries(m)) {
    if (cents === null || cents < 0) return null
    out[id] = cents
  }
  return out
}

export function costItemBody(d: CostItemDraft, units: readonly Unit[], year: number): BuildResult {
  if (!d.description.trim()) return { error: 'Bitte eine Beschreibung angeben.' }
  const amount = d.amountCents
  const labor = d.labor35aCents
  const problem = amountProblem(amount, labor, d.category)
  if (problem !== null || amount === null) return { error: problem ?? 'Bitte einen Betrag angeben.' }
  const common = {
    year,
    category: d.category,
    description: d.description.trim(),
    vendor: d.vendor.trim() || undefined,
    amountCents: amount,
    labor35aCents: labor || undefined,
    invoiceFile: d.invoiceFile,
  }
  // Nicht umlagefähig (#142): Gespeichert wird die neutrale Vorgabe ohne jede Zuordnung. Die
  // Spalte verlangt einen Schlüssel, die Berechnung liest ihn hier aber nicht.
  if (isNotAllocable(d.category)) {
    return {
      body: {
        ...common, key: 'area', directUnitId: null, meterType: null, customShares: null, participantUnitIds: null,
        externalBasis: null, tenancyAmounts: null, selfAmounts: null,
      },
    }
  }
  if (amount < 0 && d.key === 'amounts') return { error: CREDIT_WITH_AMOUNTS }
  if (d.key === 'direct' && !d.directUnitId) return { error: 'Bei Direktzuordnung bitte eine Wohnung wählen.' }
  if (d.key === 'meter' && !d.meterType) return { error: 'Bei Verbrauchsumlage bitte einen Zählertyp wählen.' }

  const basis = units.filter(inBasis)
  let customShares: Record<string, number> | null = null
  if (d.key === 'custom') {
    customShares = {}
    for (const u of basis) {
      if (!Object.hasOwn(d.customShares, u.id)) continue
      const percent = d.customShares[u.id] ?? null
      if (percent === null || percent < 0) return { error: `Anteil für „${u.name}" bitte als Prozentzahl angeben (z. B. 33,33).` }
      if (percent > 0) customShares[u.id] = percent
    }
    const sum = Object.values(customShares).reduce((a, p) => a + p, 0)
    if (sum <= 0) return { error: 'Bitte mindestens einen Anteil größer 0 % angeben.' }
    if (sum > 100.0001) return { error: `Die Anteile ergeben ${pct(sum)} % — mehr als 100 % sind nicht möglich.` }
  }

  // Teilnehmer: alle angehakt heißt null, damit auch künftig angelegte Wohnungen dazugehören.
  let participantUnitIds: string[] | null = null
  if (PARTICIPANT_KEYS.includes(d.key) && d.participants !== null) {
    if (d.participants.length === 0) return { error: 'Bitte mindestens eine teilnehmende Wohnung wählen.' }
    const alle = basis.map((u) => u.id)
    participantUnitIds = alle.every((id) => d.participants?.includes(id)) ? null : d.participants
  }

  let externalBasis: ExternalBasis | null = null
  if (d.key === 'external') {
    const { measure, total, totalCents } = d.external
    if (total === null || !(total > 0) || totalCents === null) {
      return { error: 'Bitte aus der Gemeinschaftsabrechnung die Summe der Anteile in der Anlage und die Kosten der Gemeinschaft eintragen.' }
    }
    externalBasis = { measure, total, totalCents }
  }

  let tenancyAmounts: Record<string, number> | null = null
  let selfAmounts: Record<string, number> | null = null
  if (d.key === 'amounts') {
    tenancyAmounts = amountsOf(d.tenancyAmounts)
    selfAmounts = amountsOf(d.selfAmounts)
    if (!tenancyAmounts || !selfAmounts) return { error: 'Einzelbeträge bitte als Euro-Beträge angeben (z. B. 312,40).' }
    const sum = [...Object.values(tenancyAmounts), ...Object.values(selfAmounts)].reduce((a, c) => a + c, 0)
    if (sum > amount) return { error: 'Die Einzelbeträge ergeben zusammen mehr als der Rechnungsbetrag.' }
  }

  return {
    body: {
      ...common,
      key: d.key,
      directUnitId: d.key === 'direct' ? d.directUnitId : null,
      meterType: d.key === 'meter' ? d.meterType : null,
      customShares,
      participantUnitIds,
      externalBasis,
      tenancyAmounts,
      selfAmounts,
    },
  }
}
```

- [ ] **Step 6: `shared/assessment.ts` anlegen**

Die Ampel aus `client/src/triage.ts` (`scorer`, `scorePosition`, `candidateText`, `aiRowPreselected`,
`categoryDeviationPct`, `invoiceSumCheck`) und der Vorschlag aus `client/src/costForm.ts`
(`KeyContext`, `lastExternalBasis`, `etwByStatement`, `stillComplete`, `AiPositionKey`,
`aiPositionDefaults`, `aiPositionPreselect`) ziehen hierher; der Rumpf jeder Funktion bleibt,
nur `fmtEuro` wird `euro` und `duplicateCandidates` wird `sameCostCandidates`:

```ts
// Die Ampel einer ausgewerteten Rechnungsposition und der Vorschlag, mit dem sie in die Prüfung
// geht (Belegbuchung, #170). Bis hierher stand beides im Browser (client/src/triage.ts und
// client/src/costForm.ts); seit der Server die Auswertung speichert und ihre Vorschläge
// mitliefert, braucht er dieselbe Antwort. Reine Logik ohne Netz und DOM.
import type { CostItem, ExternalMeasure, Meter, PropertyKind, TrafficLight, Unit } from './types.ts'
import { allocationOf, previousAllocation, type Allocation } from './allocation.ts'
import { defaultKeyFor, isNotAllocable } from './categories.ts'
import { sameCostCandidates } from './duplicates.ts'
import { euro } from './costItem.ts'

const RANK: Record<TrafficLight, number> = { gruen: 0, gelb: 1, rot: 2 }

// Kleiner Sammler: hebt das Niveau nur an, nie ab, und merkt sich die Begründungen. Auch die
// Ampel der Zählerstände (client/src/triage.ts) benutzt ihn.
export function createScorer() {
  let level: TrafficLight = 'gruen'
  const reasons: string[] = []
  return {
    bump(l: TrafficLight, reason: string) {
      reasons.push(reason)
      if (RANK[l] > RANK[level]) level = l
    },
    result() {
      return { level, reasons }
    },
  }
}

export type PositionCtx = {
  category: string // bereits über matchCategory zugeordnete Kategorie
  amountCents: number // Betrag (0 = ungültig/fehlt, negativ = Gutschrift)
  labor35aCents: number
  matchedByDesc: boolean // Kategorie kam nur über den Beschreibungs-Fallback
  vendor: string
  detectedYear: number | null
  targetYear: number
  existingItems: readonly CostItem[]
  priorYearDeviationPct?: number | null // Abweichung der Kategorie-Summe ggü. Vorjahr in %
  description?: string // für die Frage, ob dieselbe Rechnung schon erfasst ist
}

export const candidateText = (i: CostItem): string => `„${i.description}“ (${euro(i.amountCents)}${i.invoiceFile ? '' : ', ohne Beleg'})`

export function scorePosition(ctx: PositionCtx): { level: TrafficLight; reasons: string[] } {
  const s = createScorer()

  if (ctx.amountCents === 0) s.bump('rot', 'Betrag fehlt oder ist 0')
  // Eine Gutschrift (#139) wird übernommen, aber nie ungesehen: Sie senkt die Kosten des Jahres.
  if (ctx.amountCents < 0) s.bump('gelb', 'Gutschrift — senkt die Kosten des Jahres')
  if (isNotAllocable(ctx.category)) s.bump('rot', 'nicht umlagefähig — trägt der Vermieter')
  if (ctx.category === 'Sonstige Betriebskosten') s.bump('rot', 'Kategorie unklar — bitte zuordnen')
  if (ctx.detectedYear == null) s.bump('rot', 'Rechnungsjahr nicht erkannt')

  const vendor = ctx.vendor.trim().toLowerCase()
  const year = ctx.detectedYear ?? ctx.targetYear
  if (vendor && ctx.amountCents !== 0) {
    const dupe = ctx.existingItems.some(
      (it) => it.year === year && it.amountCents === ctx.amountCents && (it.vendor ?? '').trim().toLowerCase() === vendor,
    )
    if (dupe) s.bump('rot', 'mögliche Dublette — gleicher Betrag, Steller und Jahr existiert bereits')
  }

  // Schon eine Position, die dieselbe Rechnung sein könnte, etwa aus dem Vorjahr übernommen
  // (shared/duplicates.ts)? Nie grün: verknüpfen oder bewusst als neue Position anlegen.
  const candidates = sameCostCandidates(ctx.existingItems, { category: ctx.category, description: ctx.description ?? '', vendor: ctx.vendor, year })
  if (candidates.length > 0) {
    s.bump('gelb', `schon erfasst: ${candidates.map(candidateText).join(', ')} — verknüpfen oder bewusst als neue Position anlegen`)
  }

  if (ctx.matchedByDesc) s.bump('gelb', 'Kategorie nur über die Beschreibung erraten')
  if (ctx.amountCents > 0 && ctx.labor35aCents > ctx.amountCents) s.bump('gelb', '§35a-Lohnanteil größer als der Betrag')
  if (ctx.detectedYear != null && ctx.detectedYear !== ctx.targetYear) {
    s.bump('gelb', `Rechnungsjahr ${ctx.detectedYear} ≠ Zieljahr ${ctx.targetYear}`)
  }
  if (ctx.priorYearDeviationPct != null && Math.abs(ctx.priorYearDeviationPct) > 25) {
    const sign = ctx.priorYearDeviationPct > 0 ? '+' : ''
    s.bump('gelb', `${sign}${Math.round(ctx.priorYearDeviationPct)} % gegenüber Vorjahr`)
  }

  return s.result()
}

// Vorab angehakt ist eine KI-Zeile nur, wenn nichts dagegen spricht: umlagefähig, mit Schlüssel für
// alle (aiPositionPreselect), übernehmbar, nicht rot und ohne eine Position, die dieselbe Rechnung
// sein könnte.
export function aiRowPreselected(r: { category: string; preselect: boolean; problem: string | null; level: TrafficLight; candidates: readonly unknown[] }): boolean {
  return !isNotAllocable(r.category) && r.preselect && r.problem === null && r.level !== 'rot' && r.candidates.length === 0
}

// Weicht die Summe der Kostenart im Jahr des Belegs, mit diesem Betrag, um wie viel Prozent vom
// Jahr davor ab? `null` ohne Vorjahr.
export function categoryDeviationPct(items: readonly CostItem[], category: string, year: number, amountCents: number): number | null {
  const sum = (y: number) => items.filter((i) => i.year === y && i.category === category).reduce((a, i) => a + i.amountCents, 0)
  const prior = sum(year - 1)
  return prior > 0 ? ((sum(year) + amountCents - prior) / prior) * 100 : null
}

// Weicht die Summe der erkannten Positionen von der Rechnungs-Gesamtsumme ab, ist meist eine
// Position übersehen oder doppelt. Toleranz: 2 % bzw. 50 ct (Rundung).
export function invoiceSumCheck(positionsSumCents: number, totalGrossCents: number | null): string | null {
  if (totalGrossCents == null || totalGrossCents <= 0) return null
  const diff = Math.abs(positionsSumCents - totalGrossCents)
  if (diff > Math.max(50, totalGrossCents * 0.02)) {
    const eur = (diff / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })
    return `Positionssumme weicht von der Rechnungssumme ab (Δ ${eur} €)`
  }
  return null
}

// ---------- Der gemerkte Schlüssel einer KI-Zeile (#141) ----------

// Woraus der Vorschlag für eine neue Position entsteht: die Positionen des Objekts (alle Jahre),
// das Abrechnungsjahr und die Art des Objekts.
export type KeyContext = { items: readonly CostItem[]; year: number; propertyKind?: PropertyKind | null }

// Maßstab und Summe der Anteile der zuletzt erfassten Position „laut Gemeinschaftsabrechnung“ im
// Objekt, jüngstes Jahr zuerst, sonst die zuletzt angelegte.
export function lastExternalBasis(items: readonly CostItem[]): { measure: ExternalMeasure, total: number } | null {
  let found: CostItem | null = null
  for (const i of items) if (i.key === 'external' && i.externalBasis && (!found || i.year >= found.year)) found = i
  return found?.externalBasis ? { measure: found.externalBasis.measure, total: found.externalBasis.total } : null
}

// Bei einer Eigentumswohnung verteilt die Gemeinschaft (#102); die Grundsteuer setzt dagegen die
// Gemeinde dem Eigentümer unmittelbar fest, sie steht nicht in der Hausgeldabrechnung.
export const etwByStatement = (category: string, ctx?: KeyContext): boolean =>
  ctx?.propertyKind === 'etw' && !isNotAllocable(category) && category !== 'Grundsteuer'

export type AiPositionKey = { key: CostItem['key']; allocation: Allocation | null }

// Ein gemerkter Schlüssel, dem inzwischen etwas fehlt (alle Teilnehmer gelöscht, die Wohnung der
// Direktzuordnung weg), gilt in der KI-Zeile nicht: Sie hat kein Feld, das ihn ergänzen ließe.
function stillComplete(a: Allocation, units: readonly Unit[]): boolean {
  const known = new Set(units.map((u) => u.id))
  if (a.participantUnitIds && !a.participantUnitIds.some((id) => known.has(id))) return false
  if (a.key === 'direct' && !(a.directUnitId && known.has(a.directUnitId))) return false
  return true
}

// KI-Übernahme (#141): der Schlüssel einer ausgewerteten Position. Einen gemerkten Schlüssel mit
// Einzelbeträgen übernimmt die Zeile nicht, denn die Beträge je Mieter sind Zahlen des Jahres.
// `meters` bleibt in der Unterschrift, damit die Aufrufer unverändert bleiben.
export function aiPositionDefaults(category: string, units: readonly Unit[], meters: readonly Meter[], ctx?: KeyContext, description?: string): AiPositionKey {
  void meters
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.year, description) : null
  if (remembered && remembered.key !== 'amounts' && stillComplete(remembered, units)) return { key: remembered.key, allocation: remembered }
  // Bei einer Eigentumswohnung nur, wenn die Summe der Anteile schon einmal erfasst ist: Ein Feld
  // dafür hat die Zeile nicht, sie bliebe sonst unübernehmbar.
  const last = ctx && etwByStatement(category, ctx) ? lastExternalBasis(ctx.items) : null
  if (last) return { key: 'external', allocation: allocationOf({ year: 0, category, description: '', key: 'external', externalBasis: { ...last, totalCents: 0 } }) }
  return { key: defaultKeyFor(category), allocation: null }
}

// Eine KI-Zeile, deren gemerkter Schlüssel nur bestimmte Wohnungen trifft (Teilnehmer oder
// Direktzuordnung), ist nie vorab angehakt.
export function aiPositionPreselect(d: AiPositionKey): boolean {
  return !(d.allocation && (d.allocation.participantUnitIds || d.allocation.key === 'direct'))
}
```

Prüfe vor dem Weitermachen mit `grep -n "meters" client/src/costForm.ts`, dass die bisherige
`aiPositionDefaults` `meters` wirklich nicht benutzt; benutzt sie es doch, den Rumpf wortgleich
übernehmen statt `void meters`.

- [ ] **Step 7: Client auf `shared/` umstellen**

In `client/src/costForm.ts`:

1. Die Funktionen `amountProblem`, `lastExternalBasis`, `etwByStatement`, `stillComplete`,
   `aiPositionDefaults`, `aiPositionPreselect`, die Typen `KeyContext`, `AiPositionKey`,
   `BuildResult` und die Konstante `CREDIT_WITH_AMOUNTS` löschen.
2. Oben einfügen:

```ts
import { CREDIT_WITH_AMOUNTS, costItemBody, type BuildResult, type CostItemDraft } from '../../shared/costItem.ts'
import { etwByStatement, lastExternalBasis, type KeyContext } from '../../shared/assessment.ts'
// Seit der Belegbuchung (#170) in shared/, weil der Server dieselben Prüfungen und Vorschläge braucht.
export { amountProblem, type BuildResult } from '../../shared/costItem.ts'
export { aiPositionDefaults, aiPositionPreselect, lastExternalBasis, type AiPositionKey, type KeyContext } from '../../shared/assessment.ts'
```

3. `buildCostItemBody` ersetzen durch das Lesen der Eingaben und den Aufruf der gemeinsamen Prüfung:

```ts
// Liest die Eingaben des Formulars in Cent und Prozent; was sich nicht lesen lässt, wird `null`,
// und die Prüfung in shared/costItem.ts sagt es in Worten.
function draftOf(form: ItemForm, units: Unit[], year: number, tenancies?: Tenancy[]): CostItemDraft {
  const parsed = (m: Record<string, string>): Record<string, number | null> =>
    Object.fromEntries(Object.entries(m).filter(([, raw]) => raw.trim()).map(([id, raw]) => [id, parseEuro(raw)]))
  const shares: Record<string, number | null> = {}
  for (const u of basisUnitsOf(units)) {
    const raw = form.customShares[u.id]?.trim()
    if (!raw) continue
    // Prozent in deutscher oder technischer Schreibweise; parseEuro liefert Hundertstel
    const hundredths = parseEuro(raw)
    shares[u.id] = hundredths === null ? null : hundredths / 100
  }
  return {
    category: form.category,
    description: form.description,
    vendor: form.vendor,
    invoiceFile: form.invoiceFile ?? null,
    amountCents: parseEuro(form.amount),
    labor35aCents: form.labor35a.trim() ? parseEuro(form.labor35a) : 0,
    key: form.key,
    directUnitId: form.directUnitId || null,
    meterType: form.meterType || null,
    customShares: shares,
    participants: form.participants,
    external: { measure: form.externalMeasure, total: parseAmountNumber(form.externalTotal), totalCents: parseEuro(form.externalTotalAmount) },
    tenancyAmounts: parsed(visibleTenancyAmounts(form, units, tenancies, year)),
    selfAmounts: parsed(visibleSelfAmounts(form, units)),
  }
}

// Validiert das Formular und baut den API-Rumpf, mit derselben Prüfung wie der Server
// (shared/costItem.ts).
export function buildCostItemBody(form: ItemForm, units: Unit[], year: number, tenancies?: Tenancy[]): BuildResult {
  return costItemBody(draftOf(form, units, year, tenancies), units, year)
}
```

`export { … } from` bringt die Namen nicht in den Geltungsbereich der Datei; deshalb stehen
`BuildResult`, `KeyContext`, `lastExternalBasis` und `etwByStatement` zusätzlich im Import oben.
Der Import von `defaultKeyFor`, `isNotAllocable` aus `./types` bleibt, solange `proposal`,
`suggestedKey` und `keyListText` sie benutzen.

In `client/src/triage.ts` die Zeilen 1–110 (Kopf bis einschließlich `categoryDeviationPct`)
ersetzen durch:

```ts
// Ampel-Triage für die Schnellerfassung. Die Ampel einer Rechnungsposition steht seit der
// Belegbuchung (#170) in shared/assessment.ts, weil der Server sie mitliefert; hier bleiben die
// Zählerstände und, bis Task 6 sie ablöst, die Gruppen zum Verknüpfen.
import type { CostItem, Meter, Reading, TrafficLight } from './types'
import { parseEuro, fmtEuro } from './api'
import { amountProblem } from './costForm'
import { sameCostCandidates } from '../../shared/duplicates.ts'
import { createScorer } from '../../shared/assessment.ts'
export { aiRowPreselected, candidateText, categoryDeviationPct, invoiceSumCheck, scorePosition, type PositionCtx } from '../../shared/assessment.ts'
export type { TrafficLight } from './types'

// Die Regel steht in shared/duplicates.ts. Das Jahr ist das des Belegs: Im Januar steht die
// Auswahl oft noch auf dem Vorjahr.
export function duplicateCandidates(items: readonly CostItem[], q: { category: string; description: string; vendor: string; year: number }): CostItem[] {
  return sameCostCandidates(items, q)
}
```

und am Ende der Datei die bisherige `invoiceSumCheck` löschen; in `scoreReading` `scorer()`
durch `createScorer()` ersetzen. `linkOffer` benutzt `candidateText` nicht; dort bleibt `fmtEuro`.
`TrafficLight` ist jetzt ein Typ aus `shared/types.ts` (über `./types` weitergereicht).

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/shared-cost-item.test.ts`
Expected: PASS (5 Tests).

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- costForm triage carryOver`
Expected: PASS, kein Test geändert.

- [ ] **Step 9: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add shared/categories.ts shared/costItem.ts shared/assessment.ts shared/types.ts client/src/types.ts client/src/costForm.ts client/src/triage.ts server/test/shared-cost-item.test.ts
git commit -m "$(cat <<'EOF'
Belegbuchung: Prüfung, Ampel und Vorschlag einer Kostenposition nach shared/

Betrag und §35a (amountProblem), der Rumpf einer Kostenposition samt
Prüfung der Verteilung, die Kostenarten, die Ampel und der gemerkte
Schlüssel einer KI-Zeile stehen jetzt in shared/, damit der Server beim
Buchen dieselbe Antwort gibt wie das Formular. Das Formular liest nur noch
die Eingaben in Cent; die Meldungen sind unverändert.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 2: Tabellen, Migration 0013 und Zugriff auf gespeicherte Auswertungen

**Files:**
- Modify: `shared/types.ts` (Typen der Auswertung), `server/src/db/schema.ts` (zwei Tabellen am Ende), `server/test/schema.test.ts` (Typvergleich, Tabellenliste), `server/test/migrations.test.ts` (Marke)
- Create: `server/src/assessment.ts` (erster Teil), `server/src/db/assessments.ts`, `server/drizzle/0013_belegbuchung.sql` und `server/drizzle/meta/0013_snapshot.json` (beide erzeugt), `server/test/assessment.test.ts`, `server/test/db-assessments.test.ts`

**Interfaces:**
- Consumes: `matchCategory` (`shared/categories.ts`), `normalizedText` (`shared/duplicates.ts`), `createEntity`/`removeEntity` (`server/src/db/repository.ts`)
- Produces:
  - `shared/types.ts`: `AssessmentBooking = 'created' | 'linked'`, `AssessmentLineState = 'open' | 'dismissed' | 'created' | 'linked'`, `StoredAssessment`, `StoredAssessmentLine` (Felder unten)
  - `server/src/assessment.ts`: `type NewLine`, `type BookedLine = StoredAssessmentLine & { file: string }`, `type LineChange`, `lineState(l)`, `ownItemIds(lines): string[]`, `changeOf(l): LineChange`, `linesFromExtraction(ex: Extraction): NewLine[]`, `detectedYear(ex): number | null`, `withoutBooked(fresh, booked): NewLine[]`
  - `server/src/db/assessments.ts`: `type AssessmentRecord = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }`, `type NewAssessment = Omit<StoredAssessment, 'id' | 'createdAt'> & { lines: NewLine[] }`, `saveAssessment(db: Database, input: NewAssessment, ids: { id: string; now: string }): Promise<AssessmentRecord>`, `readAssessment(db: Executor, id): Promise<AssessmentRecord | null>`, `readAssessmentOfFile(db: Executor, file): Promise<AssessmentRecord | null>`, `listAssessments(db: Executor, propertyId: string): Promise<AssessmentRecord[]>`, `writeLine(db: Executor, assessmentId, idx, change: LineChange): Promise<void>`, `bookedLines(db: Executor): Promise<BookedLine[]>`, `forgetAssessment(db: Executor, file): Promise<void>`, `placeAssessment(db: Database, id, change: { year?: number; propertyId?: string | null }): Promise<'ok' | 'missing' | 'booked'>`

- [ ] **Step 1: Typen in `shared/types.ts`**

Am Ende von `shared/types.ts` anfügen:

```ts
// ---------- Belegbuchung (#170) ----------
//
// Eine Auswertung ist das gespeicherte Ergebnis der KI zu einem Beleg, eine je Datei. Ihre Zeilen
// sind die Positionen der Rechnung. Ob eine Zeile gebucht ist, steht an ihr und nur dort; der
// Zustand wird abgeleitet (server/src/assessment.ts, `lineState`): ohne `costItemId` offen oder
// verworfen, mit ihr angelegt oder verknüpft. Löscht jemand die Position, macht der Fremdschlüssel
// (`ON DELETE SET NULL`) die Zeile von selbst wieder offen.
export type AssessmentBooking = 'created' | 'linked'
export type AssessmentLineState = 'open' | 'dismissed' | 'created' | 'linked'

export type StoredAssessment = {
  id: string
  file: string
  propertyId: string | null
  // Zieljahr der Buchung: das Jahr aus dem Beleg, sonst das gewählte; änderbar
  year: number
  // Das Jahr, das die KI aus dem Beleg gelesen hat (Leistungszeitraum, sonst Rechnungsdatum)
  detectedYear: number | null
  vendor: string | null
  invoiceDate: string | null
  totalGrossCents: number | null
  // Vom Server gerechnet (#34): Positionen ohne Umsatzsteuer hochgerechnet, Lohnanteil verteilt
  amountsAdjusted: 'netto' | null
  laborFromTotal: boolean
  createdAt: string
}

export type StoredAssessmentLine = {
  assessmentId: string
  idx: number
  description: string
  category: string
  // Die Kostenart kam nur über die Beschreibung zustande (Ampel gelb)
  categoryGuessed: boolean
  // `null` heißt „nicht gelesen“, 0 ist eine Angabe
  amountCents: number | null
  labor35aCents: number | null
  booking: AssessmentBooking | null
  costItemId: string | null
  dismissed: boolean
}
```

- [ ] **Step 2: Tabellen in `server/src/db/schema.ts`**

Den Typimport oben um `AssessmentBooking` und `StoredAssessment` ergänzen und am Ende anfügen:

```ts
// ---------- Belegbuchung (#170) ----------
//
// **Eine Auswertung je Beleg** (eindeutig über `file`). Wird derselbe Beleg erneut ausgewertet,
// ersetzt die neue Auswertung nur die offenen und verworfenen Zeilen (db/assessments.ts).
//
// **Der Zustand einer Zeile steht nicht in einer Spalte**, er wird aus `cost_item_id`, `booking`
// und `dismissed` abgeleitet. `cost_item_id` ist `SET NULL`: Löscht jemand die Position, ist die
// Zeile von selbst wieder offen, und kein zweites Feld müsste nachgezogen werden. `booking` bleibt
// dann stehen, sagt aber nichts mehr, denn ohne Position ist die Zeile offen.
//
// `property_id` ist `SET NULL` wie bei `uploads`: Ein Objekt wird nur leer gelöscht, und eine
// Auswertung ohne Objekt lässt sich nicht buchen, bis jemand eines wählt.
export const ASSESSMENT_BOOKINGS = exactly<AssessmentBooking>()(['created', 'linked'] as const)
const AMOUNTS_ADJUSTED = exactly<NonNullable<StoredAssessment['amountsAdjusted']>>()(['netto'] as const)

export const assessments = sqliteTable(
  'assessments',
  {
    id: text('id').primaryKey().notNull(),
    file: text('file').notNull(),
    propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
    year: integer('year').notNull(),
    detectedYear: integer('detected_year'),
    vendor: text('vendor'),
    invoiceDate: text('invoice_date'),
    totalGrossCents: integer('total_gross_cents'),
    amountsAdjusted: text('amounts_adjusted', { enum: AMOUNTS_ADJUSTED }),
    laborFromTotal: integer('labor_from_total', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('assessments_file_unique').on(t.file),
    // Posteingang und Schnellerfassung fragen die offenen Auswertungen eines Objekts ab.
    index('assessments_property_idx').on(t.propertyId),
    check('assessments_year_positive', sql.raw('"year" > 0')),
    oneOf('assessments_amounts_adjusted_known', 'amounts_adjusted', AMOUNTS_ADJUSTED),
  ],
)

export const assessmentLines = sqliteTable(
  'assessment_lines',
  {
    assessmentId: text('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    categoryGuessed: integer('category_guessed', { mode: 'boolean' }).notNull().default(false),
    // Ohne Vorzeichenbedingung: Eine Gutschrift ist negativ, wie bei `cost_items.amount_cents`.
    amountCents: integer('amount_cents'),
    labor35aCents: integer('labor_35a_cents'),
    booking: text('booking', { enum: ASSESSMENT_BOOKINGS }),
    costItemId: text('cost_item_id').references(() => costItems.id, { onDelete: 'set null' }),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.assessmentId, t.idx] }),
    // Die Summenregel fragt je Position alle Zeilen, die an ihr hängen.
    index('assessment_lines_cost_item_idx').on(t.costItemId),
    notNegative('assessment_lines_idx_not_negative', 'idx'),
    oneOf('assessment_lines_booking_known', 'booking', ASSESSMENT_BOOKINGS),
    // Eine gebuchte Zeile sagt, wie sie gebucht ist.
    check('assessment_lines_booking_complete', sql.raw('"cost_item_id" IS NULL OR "booking" IS NOT NULL')),
  ],
)
```

- [ ] **Step 3: Migration erzeugen und ansehen**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix server run db:generate -- --name belegbuchung`
Expected: neue Dateien `server/drizzle/0013_belegbuchung.sql`, `server/drizzle/meta/0013_snapshot.json`, Eintrag `0013_belegbuchung` in `meta/_journal.json`.

Run: `cat /home/geoerger/projects/mietfuchs-buchung/server/drizzle/0013_belegbuchung.sql`
Expected: genau zwei `CREATE TABLE` (`assessments`, `assessment_lines`) und drei `CREATE … INDEX`, **kein** `__new_`-Neubau einer bestehenden Tabelle. Steht dort ein Neubau, ist am Schema etwas Bestehendes verändert worden: zurücknehmen und neu erzeugen.

- [ ] **Step 4: Write the failing tests**

`server/test/assessment.test.ts`:

```ts
// Reine Regeln der gespeicherten Auswertung (Belegbuchung, #170): was aus der Antwort der KI an
// Zeilen wird und in welchem Zustand eine Zeile ist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectedYear, lineState, linesFromExtraction, withoutBooked, type NewLine } from '../src/assessment.ts'
import type { StoredAssessmentLine } from '../../shared/types.ts'

test('Zeilen aus der KI: Kostenart zugeordnet, Cent, nicht gelesener Lohnanteil bleibt null, 0 bleibt 0', () => {
  const lines = linesFromExtraction({
    vendor: 'Stadtwerke',
    positions: [
      { description: 'Frischwasser', category: 'Wasser', amountEur: 612.4, labor35aEur: null },
      { description: 'Kanalgebühr', category: 'Gebühren', amountEur: 80, labor35aEur: 0 },
      { description: 'Unlesbar', category: 'Wasser/Abwasser' },
    ],
  })
  assert.deepEqual(lines, [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 61240, labor35aCents: null },
    { description: 'Kanalgebühr', category: 'Wasser/Abwasser', categoryGuessed: true, amountCents: 8000, labor35aCents: 0 },
    { description: 'Unlesbar', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: null, labor35aCents: null },
  ])
})

test('Jahr aus dem Beleg: erst der Leistungszeitraum, dann das Rechnungsdatum, sonst keines', () => {
  assert.equal(detectedYear({ periodStart: '2025-01-01', invoiceDate: '2026-02-15' }), 2025)
  assert.equal(detectedYear({ invoiceDate: '2026-02-15' }), 2026)
  assert.equal(detectedYear({}), null)
})

const stored = (patch: Partial<StoredAssessmentLine>): StoredAssessmentLine => ({
  assessmentId: 'a1', idx: 0, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false,
  amountCents: 70000, labor35aCents: null, booking: null, costItemId: null, dismissed: false, ...patch,
})

test('Zustand einer Zeile: abgeleitet aus Position, Art und Verwerfen', () => {
  assert.equal(lineState(stored({})), 'open')
  assert.equal(lineState(stored({ dismissed: true })), 'dismissed')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'created' })), 'created')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'linked' })), 'linked')
  // Nach dem Löschen der Position bleibt `booking` stehen, die Zeile ist trotzdem offen.
  assert.equal(lineState(stored({ costItemId: null, booking: 'linked' })), 'open')
})

test('Erneut ausgewertet: eine Zeile, die einer gebuchten gleicht, kommt nicht noch einmal', () => {
  const fresh: NewLine[] = [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null },
    { description: 'Abwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 80000, labor35aCents: null },
  ]
  // Die gebuchte Zeile trägt eine von Hand geänderte Beschreibung; gleich sind Betrag und Kostenart.
  const booked = [stored({ description: 'Wasser 2025 (geändert)', costItemId: 'c1', booking: 'created' })]
  assert.deepEqual(withoutBooked(fresh, booked).map((l) => l.description), ['Abwasser'])
})
```

`server/test/db-assessments.test.ts`:

```ts
// Die gespeicherten Auswertungen in der Datenbank (Belegbuchung, #170): speichern, erneut
// auswerten, und was das Löschen einer Position mit ihren Zeilen macht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { createEntity, removeEntity } from '../src/db/repository.ts'
import {
  bookedLines, forgetAssessment, placeAssessment, readAssessmentOfFile, saveAssessment, writeLine, type AssessmentRecord, type NewAssessment,
} from '../src/db/assessments.ts'
import { changeOf, lineState, type NewLine } from '../src/assessment.ts'
import { assessmentLines } from '../src/db/schema.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-auswertung-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const line = (description: string, amountCents: number | null, extra: Partial<NewLine> = {}): NewLine =>
  ({ description, category: 'Wasser/Abwasser', categoryGuessed: false, amountCents, labor35aCents: null, ...extra })
const head = (file: string, lines: NewLine[], extra: Partial<NewAssessment> = {}): NewAssessment => ({
  file, propertyId: 'objekt-1', year: 2025, detectedYear: 2025, vendor: 'Stadtwerke', invoiceDate: '2026-02-15',
  totalGrossCents: 150000, amountsAdjusted: null, laborFromTotal: false, lines, ...extra,
})
let n = 0
const ids = () => ({ id: `a${++n}`, now: new Date(Date.UTC(2026, 9, 2, 0, 0, n)).toISOString() })
const item = (db: Database, id: string) => createEntity(db, 'costItems', id, {
  propertyId: 'objekt-1', year: 2025, category: 'Wasser/Abwasser', description: `Position ${id}`, amountCents: 150000, key: 'area',
})
const lineOf = (r: AssessmentRecord, idx: number) => r.lines.find((l) => l.idx === idx) ?? assert.fail(`keine Zeile ${idx}`)
const link = (db: Database, r: AssessmentRecord, idx: number, costItemId: string) =>
  writeLine(db, r.assessment.id, idx, { ...changeOf(lineOf(r, idx)), booking: 'linked', costItemId })
const reread = async (opened: OpenedDatabase, file: string) =>
  (await opened.read((db) => readAssessmentOfFile(db, file))) ?? assert.fail(`keine Auswertung zu ${file}`)
const causes = (err: unknown): string => {
  let all = ''
  for (let c: unknown = err; c instanceof Error; c = c.cause) all += ` ${c.message}`
  return all
}

test('Auswertung speichern: jede Zeile ist offen, ein nicht gelesener Betrag bleibt null, 0 bleibt 0', async () => {
  await withDatabase(async (opened) => {
    const saved = await opened.write((db) => saveAssessment(db, head('wasser.pdf', [line('Frischwasser', 70000), line('Abwasser', null, { labor35aCents: 0 })]), ids()))
    assert.equal(saved.assessment.file, 'wasser.pdf')
    assert.deepEqual(saved.lines.map((l) => [l.idx, l.amountCents, l.labor35aCents, lineState(l)]), [[0, 70000, null, 'open'], [1, null, 0, 'open']])
  })
})

test('Erneut auswerten ersetzt nur offene und verworfene Zeilen; gebuchte bleiben mit ihrer Nummer', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const first = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000), line('Abwasser', 80000), line('Gebühr', 500)]), ids()))
    await opened.write((db) => link(db, first, 0, 'c1'))
    await opened.write((db) => writeLine(db, first.assessment.id, 2, { ...changeOf(lineOf(first, 2)), dismissed: true }))
    const second = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000), line('Abwasser neu', 81000)], { year: 2024 }), ids()))
    assert.equal(second.assessment.id, first.assessment.id, 'eine Auswertung je Beleg')
    // Frischwasser ist gebucht und kommt nicht doppelt; die neue Zeile bekommt eine unbenutzte Nummer.
    assert.deepEqual(second.lines.map((l) => [l.idx, l.description, lineState(l)]), [[0, 'Frischwasser', 'linked'], [3, 'Abwasser neu', 'open']])
    assert.equal(second.assessment.year, 2025, 'mit gebuchter Zeile bleibt das Jahr')
  })
})

test('Löschen der Position setzt die Zeile wieder auf offen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await opened.write((db) => link(db, saved, 0, 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'w.pdf'), 0)), 'linked')
    await opened.write((db) => removeEntity(db, 'costItems', 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'w.pdf'), 0)), 'open')
  })
})

test('Position mit Zeilen aus zwei Belegen gelöscht: beide Zeilen offen, die übrigen bleiben gebucht', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    await opened.write((db) => item(db, 'c2'))
    const a = await opened.write((db) => saveAssessment(db, head('abschlag.pdf', [line('Abschlag', 50000)]), ids()))
    const b = await opened.write((db) => saveAssessment(db, head('rest.pdf', [line('Rest', 30000), line('Kanal', 9000)]), ids()))
    await opened.write((db) => link(db, a, 0, 'c1'))
    await opened.write((db) => link(db, b, 0, 'c1'))
    await opened.write((db) => link(db, b, 1, 'c2'))
    await opened.write((db) => removeEntity(db, 'costItems', 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'abschlag.pdf'), 0)), 'open')
    const rest = await reread(opened, 'rest.pdf')
    assert.deepEqual([lineState(lineOf(rest, 0)), lineState(lineOf(rest, 1))], ['open', 'linked'])
    assert.deepEqual((await opened.read(bookedLines)).map((l) => [l.file, l.costItemId]), [['rest.pdf', 'c2']])
  })
})

test('Beleg vergessen nimmt die Auswertung samt Zeilen mit', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await opened.write((db) => forgetAssessment(db, 'w.pdf'))
    assert.equal(await opened.read((db) => readAssessmentOfFile(db, 'w.pdf')), null)
    assert.equal((await opened.read((db) => db.select().from(assessmentLines))).length, 0)
  })
})

test('Objekt einer Auswertung: änderbar, solange nichts gebucht ist; das Jahr bleibt änderbar', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: null, year: 2024 })), 'ok')
    assert.equal(await opened.write((db) => placeAssessment(db, 'gibt-es-nicht', { year: 2024 })), 'missing')
    await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: 'objekt-1', year: 2025 }))
    await opened.write((db) => link(db, saved, 0, 'c1'))
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: null })), 'booked')
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { year: 2026 })), 'ok')
  })
})

test('Die Datenbank lehnt eine gebuchte Zeile ohne Art ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await assert.rejects(
      opened.write((db) => writeLine(db, saved.assessment.id, 0, { ...changeOf(lineOf(saved, 0)), booking: null, costItemId: 'c1' })),
      (err: unknown) => /assessment_lines_booking_complete/.test(causes(err)),
    )
  })
})
```

In `server/test/schema.test.ts`: den Typimport um `StoredAssessment, StoredAssessmentLine` ergänzen, nach `_Uploads` anfügen

```ts
// --- Belegbuchung (#170) ---
type _Assessments = Assert<Matches<typeof schema.assessments.$inferSelect, StoredAssessment>>
type _AssessmentLines = Assert<Matches<typeof schema.assessmentLines.$inferSelect, StoredAssessmentLine>>
```

und in der Tabellenliste des Tests „Migration lässt sich anwenden und legt alle Tabellen an“ nach
`'ai_slots',` die Zeilen `'assessment_lines',` und `'assessments',` einfügen.

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/assessment.test.ts test/db-assessments.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `src/assessment.ts` bzw. `src/db/assessments.ts`.

- [ ] **Step 6: `server/src/assessment.ts` (erster Teil)**

```ts
// Die gespeicherte Auswertung eines Belegs (Belegbuchung, #170) als reine Funktionen: was aus
// einer Antwort der KI an Zeilen wird, in welchem Zustand eine Zeile ist und welche Vorschläge die
// Prüfung zu ihr macht. Ohne Datenbank und Netz, damit der Server und die Tests des Browsers
// (client/src/testing/fakeBooking.ts) dieselben Regeln benutzen.
import type { AssessmentLineState, Extraction, StoredAssessmentLine } from '../../shared/types.ts'
import { matchCategory } from '../../shared/categories.ts'
import { normalizedText } from '../../shared/duplicates.ts'

// Eine Zeile, wie sie aus der KI kommt, noch ohne Nummer und ohne Buchung.
export type NewLine = Pick<StoredAssessmentLine, 'description' | 'category' | 'categoryGuessed' | 'amountCents' | 'labor35aCents'>
// Eine gebuchte Zeile samt dem Beleg, aus dem sie stammt (für die Summenregel über alle Belege).
export type BookedLine = StoredAssessmentLine & { file: string }
// Was eine Buchung an einer Zeile schreibt. Immer vollständig, damit nichts als `undefined` an
// die Datenbank geht (client.ts lehnt das ab).
export type LineChange = Pick<StoredAssessmentLine, 'booking' | 'costItemId' | 'dismissed' | 'description' | 'category' | 'amountCents' | 'labor35aCents'>

export function lineState(l: Pick<StoredAssessmentLine, 'costItemId' | 'booking' | 'dismissed'>): AssessmentLineState {
  if (l.costItemId === null) return l.dismissed ? 'dismissed' : 'open'
  return l.booking === 'linked' ? 'linked' : 'created'
}

export const changeOf = (l: StoredAssessmentLine): LineChange => ({
  booking: l.booking, costItemId: l.costItemId, dismissed: l.dismissed, description: l.description,
  category: l.category, amountCents: l.amountCents, labor35aCents: l.labor35aCents,
})

// Die Positionen, die aus dieser Auswertung gebucht sind. Sie sind für ihre übrigen Zeilen keine
// Doppelung: Frischwasser und Abwasser sind zwei Zeilen einer Rechnung.
export const ownItemIds = (lines: readonly StoredAssessmentLine[]): string[] =>
  [...new Set(lines.flatMap((l) => (l.costItemId ? [l.costItemId] : [])))]

const toCents = (eur: number | null | undefined): number | null =>
  typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null

// Die Zeilen einer Antwort. Die Kostenart wird den bekannten zugeordnet, notfalls über die
// Beschreibung; dann ist `categoryGuessed` gesetzt und die Ampel gelb. Ein Betrag, den das Modell
// nicht lesen konnte, bleibt `null` und ist etwas anderes als 0.
export function linesFromExtraction(ex: Extraction): NewLine[] {
  return (ex.positions ?? []).map((p) => {
    let category = matchCategory(p.category || '')
    let categoryGuessed = false
    if (category === 'Sonstige Betriebskosten') {
      const byDesc = matchCategory(p.description || '')
      if (byDesc !== 'Sonstige Betriebskosten') {
        category = byDesc
        categoryGuessed = true
      }
    }
    return { description: p.description, category, categoryGuessed, amountCents: toCents(p.amountEur), labor35aCents: toCents(p.labor35aEur) }
  })
}

// Das Jahr aus dem Beleg: bevorzugt der Leistungszeitraum, sonst das Rechnungsdatum.
export function detectedYear(ex: Pick<Extraction, 'periodStart' | 'invoiceDate'>): number | null {
  const src = (ex.periodStart && ex.periodStart.slice(0, 4)) || (ex.invoiceDate && ex.invoiceDate.slice(0, 4)) || ''
  const y = Number(src)
  return Number.isInteger(y) && y > 1990 && y < 2100 ? y : null
}

// Beim erneuten Auswerten: Zeilen, die einer schon gebuchten gleichen (gleicher Betrag und
// gleiche Beschreibung oder Kostenart), kommen nicht noch einmal als offene Zeile dazu. Sonst
// stünde dieselbe Rechnungszeile ein zweites Mal zum Buchen da, und weil Positionen dieser
// Auswertung für ihre eigenen Zeilen keine Doppelung sind, fiele es niemandem auf.
export function withoutBooked(fresh: readonly NewLine[], booked: readonly StoredAssessmentLine[]): NewLine[] {
  const left = [...booked]
  return fresh.filter((l) => {
    const i = left.findIndex((b) => b.amountCents === l.amountCents &&
      (normalizedText(b.description) === normalizedText(l.description) || b.category === l.category))
    if (i < 0) return true
    left.splice(i, 1)
    return false
  })
}
```

Hinweis zum Test „Kanalgebühr“: `matchCategory('Gebühren')` ergibt „Sonstige Betriebskosten“,
`matchCategory('Kanalgebühr')` „Wasser/Abwasser“; deshalb ist `categoryGuessed` dort gesetzt.

- [ ] **Step 7: `server/src/db/assessments.ts`**

```ts
// Die gespeicherten Auswertungen in der Datenbank (Belegbuchung, #170), Tabellen `assessments`
// und `assessment_lines` in schema.ts. Hier steht nur der Zugriff; was eine Buchung bedeutet,
// steht in bookingPlan.ts, und db/booking.ts verbindet beides.
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { StoredAssessment, StoredAssessmentLine } from '../../../shared/types.ts'
import { withoutBooked, type BookedLine, type LineChange, type NewLine } from '../assessment.ts'
import type { Database, Executor } from './client.ts'
import { assessmentLines, assessments } from './schema.ts'

export type AssessmentRecord = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }
export type NewAssessment = Omit<StoredAssessment, 'id' | 'createdAt'> & { lines: NewLine[] }

async function linesOf(db: Executor, assessmentId: string): Promise<StoredAssessmentLine[]> {
  return db.select().from(assessmentLines).where(eq(assessmentLines.assessmentId, assessmentId)).orderBy(asc(assessmentLines.idx))
}

export async function readAssessment(db: Executor, id: string): Promise<AssessmentRecord | null> {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.id, id))
  return assessment ? { assessment, lines: await linesOf(db, assessment.id) } : null
}

export async function readAssessmentOfFile(db: Executor, file: string): Promise<AssessmentRecord | null> {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.file, file))
  return assessment ? { assessment, lines: await linesOf(db, assessment.id) } : null
}

// Die Auswertungen eines Objekts, älteste zuerst.
export async function listAssessments(db: Executor, propertyId: string): Promise<AssessmentRecord[]> {
  const rows = await db.select().from(assessments).where(eq(assessments.propertyId, propertyId)).orderBy(asc(assessments.createdAt), asc(sql`rowid`))
  const out: AssessmentRecord[] = []
  for (const assessment of rows) out.push({ assessment, lines: await linesOf(db, assessment.id) })
  return out
}

async function insertLines(db: Executor, assessmentId: string, lines: readonly NewLine[], start: number): Promise<void> {
  if (lines.length === 0) return
  await db.insert(assessmentLines).values(lines.map((l, i) => ({
    ...l, assessmentId, idx: start + i, booking: null, costItemId: null, dismissed: false,
  })))
}

// Speichert eine Auswertung, und zwar **nur nach Erfolg** der KI (die Route ruft es erst dann).
// Gibt es zu dem Beleg schon eine, ersetzt die neue nur die offenen und verworfenen Zeilen.
// Gebuchte bleiben mit ihren Nummern; neue Zeilen bekommen Nummern, die es in dieser Auswertung
// noch nie gab, damit eine offene Vorschau in einem anderen Tab nicht still eine andere Zeile
// meint. Objekt und Jahr folgen der neuen Auswertung nur, solange nichts gebucht ist.
export async function saveAssessment(db: Database, input: NewAssessment, ids: { id: string; now: string }): Promise<AssessmentRecord> {
  const { lines, ...head } = input
  const current = await readAssessmentOfFile(db, input.file)
  await db.transaction(async (tx) => {
    if (!current) {
      await tx.insert(assessments).values({ ...head, id: ids.id, createdAt: ids.now })
      await insertLines(tx, ids.id, lines, 0)
      return
    }
    const id = current.assessment.id
    const booked = current.lines.filter((l) => l.costItemId !== null)
    const next = current.lines.reduce((max, l) => Math.max(max, l.idx + 1), 0)
    await tx.delete(assessmentLines).where(and(eq(assessmentLines.assessmentId, id), isNull(assessmentLines.costItemId)))
    await insertLines(tx, id, withoutBooked(lines, booked), next)
    const placement = booked.length > 0 ? {} : { propertyId: head.propertyId, year: head.year }
    await tx.update(assessments).set({
      detectedYear: head.detectedYear, vendor: head.vendor, invoiceDate: head.invoiceDate, totalGrossCents: head.totalGrossCents,
      amountsAdjusted: head.amountsAdjusted, laborFromTotal: head.laborFromTotal, createdAt: ids.now, ...placement,
    }).where(eq(assessments.id, id))
  })
  const saved = await readAssessmentOfFile(db, input.file)
  if (!saved) throw new Error('Die Auswertung ist nach dem Speichern nicht auffindbar.')
  return saved
}

export async function writeLine(db: Executor, assessmentId: string, idx: number, change: LineChange): Promise<void> {
  await db.update(assessmentLines).set(change).where(and(eq(assessmentLines.assessmentId, assessmentId), eq(assessmentLines.idx, idx)))
}

// Alle gebuchten Zeilen aller Auswertungen, mit ihrem Beleg. Die Summenregel rechnet über alle
// Belege, die an einer Position hängen.
export async function bookedLines(db: Executor): Promise<BookedLine[]> {
  const rows = await db.select({ line: assessmentLines, file: assessments.file })
    .from(assessmentLines)
    .innerJoin(assessments, eq(assessments.id, assessmentLines.assessmentId))
    .where(isNotNull(assessmentLines.costItemId))
    .orderBy(asc(assessments.createdAt), asc(assessmentLines.idx))
  return rows.map((r) => ({ ...r.line, file: r.file }))
}

export async function forgetAssessment(db: Executor, file: string): Promise<void> {
  await db.delete(assessments).where(eq(assessments.file, file))
}

// Objekt und Jahr ändern. Das Objekt nur, solange keine Zeile gebucht ist: Sonst hingen Zeilen
// einer Auswertung an Positionen zweier Objekte.
export async function placeAssessment(db: Database, id: string, change: { year?: number; propertyId?: string | null }): Promise<'ok' | 'missing' | 'booked'> {
  const current = await readAssessment(db, id)
  if (!current) return 'missing'
  const moves = change.propertyId !== undefined && change.propertyId !== current.assessment.propertyId
  if (moves && current.lines.some((l) => l.costItemId !== null)) return 'booked'
  if (change.year === undefined && change.propertyId === undefined) return 'ok'
  await db.update(assessments).set(change).where(eq(assessments.id, id))
  return 'ok'
}
```

Liefert drizzle bei `select({ line: assessmentLines, … })` die Spalte `dismissed` nicht als
Wahrheitswert, ist der Join falsch geschrieben; dann zuerst die Zeilen mit `select().from(assessmentLines)`
und die Dateien getrennt lesen und zusammenführen, statt umzuwandeln.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/assessment.test.ts test/db-assessments.test.ts test/schema.test.ts test/db-errors.test.ts`
Expected: PASS.

- [ ] **Step 9: Marke von 0013 festhalten**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --input-type=module -e "const { loadMigrations } = await import('./src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag === '0013_belegbuchung') console.log(m.hash)"`
Expected: eine Zeile mit 64 Hex-Zeichen.

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` nach `0012_belege` eintragen, mit der
Ausgabe von eben als Wert:

```ts
  // Belegbuchung (#170). Eingetragen vor dem Merge, wie 0001: Jeder Push auf main veröffentlicht
  // das Image, und ab dann haben Nutzer den Schritt angewendet. Wird 0013 vor dem Push neu
  // erzeugt, hier die neue Marke eintragen.
  '0013_belegbuchung': '…die 64 Zeichen aus Step 9…',
```

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/migrations.test.ts`
Expected: PASS (der Test erzeugt auch das eingebettete Modul neu und vergleicht beide Wege).

- [ ] **Step 10: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add shared/types.ts server/src/db/schema.ts server/drizzle/0013_belegbuchung.sql server/drizzle/meta/0013_snapshot.json server/drizzle/meta/_journal.json server/src/assessment.ts server/src/db/assessments.ts server/test/assessment.test.ts server/test/db-assessments.test.ts server/test/schema.test.ts server/test/migrations.test.ts
git commit -m "$(cat <<'EOF'
Belegbuchung: Auswertungen als gespeicherter Gegenstand (Migration 0013)

Zwei Tabellen halten das Ergebnis der KI je Beleg und den Buchungsstand je
Zeile. Der Zustand einer Zeile wird abgeleitet: Löscht jemand die Position,
macht ON DELETE SET NULL die Zeile von selbst wieder offen. Erneutes
Auswerten ersetzt nur offene und verworfene Zeilen.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 3: Planen und Buchen (reiner Planer, Transaktion, Vorschläge)

**Files:**
- Modify: `shared/types.ts` (Entscheidungen, Ansicht, Vorschau), `server/src/assessment.ts` (Entwurf einer Zeile, Vorschläge, Ansicht), `server/src/db/repository.ts` (zwei Schreibhelfer)
- Create: `server/src/bookingPlan.ts`, `server/src/db/booking.ts`, `server/test/booking.test.ts`

**Interfaces:**
- Consumes: Task 1 (`costItemBody`, `amountProblem`, `euro`, `scorePosition`, `aiPositionDefaults`, `aiPositionPreselect`, `aiRowPreselected`, `categoryDeviationPct`, `invoiceSumCheck`, `candidateText`), Task 2 (`lineState`, `ownItemIds`, `changeOf`, `BookedLine`, `LineChange`, `readAssessment`, `listAssessments`, `bookedLines`, `writeLine`, `AssessmentRecord`)
- Produces:
  - `shared/types.ts`: `LineFields`, `LineDecision`, `LineCandidate`, `LineSuggestion`, `AssessmentLine`, `AssessmentView`, `PreviewItem`, `PreviewProblem`, `BookingPreview` (Felder unten)
  - `server/src/assessment.ts`: `lineDraft(fields: LineFields, extra: { vendor: string; invoiceFile: string }, units: readonly Unit[]): CostItemDraft`, `type DescribeContext`, `describeAssessment(record, ctx: DescribeContext): AssessmentView`
  - `server/src/bookingPlan.ts`: `type PlanInput`, `type BookingWrite`, `type Planned = { preview: Omit<BookingPreview, 'token'>; writes: BookingWrite[]; unchanged: number[]; conflicts: string[] }`, `planBooking(input: PlanInput, decisions: readonly LineDecision[], newId: () => string): Planned`, `tokenSource(p: Planned): string`, `previewWith(p: Planned, token: string): BookingPreview`, `decide(p: Planned, decisionCount: number, token: string, expected: string): 'apply' | 'unchanged' | 'conflict' | 'refused' | 'stale'`, `parseDecisions(raw: unknown): { decisions: LineDecision[] } | { error: string }`
  - `server/src/db/booking.ts`: `class BookingRefusal extends Error { status: number }`, `viewAssessments(db, propertyId, openOnly, uploadDir): Promise<AssessmentView[]>`, `viewAssessment(db, id, uploadDir): Promise<AssessmentView>`, `viewRecord(db, record): Promise<AssessmentView>`, `previewBooking(db, id, decisions, uploadDir): Promise<BookingPreview>`, `type BookingOutcome`, `bookAssessment(db, id, decisions, token, options: { uploadDir: string; newId: () => string }): Promise<BookingOutcome>`
  - `server/src/db/repository.ts`: `insertCostItemIn(tx: Executor, id: string, body: unknown): Promise<void>`, `patchCostItemIn(tx: Executor, current: CostItem, body: unknown): Promise<void>`

- [ ] **Step 1: Typen in `shared/types.ts`**

Oben `import type { Allocation } from './allocation.ts'` ergänzen und im Abschnitt „Belegbuchung“ anfügen:

```ts
// Die Angaben, die der Nutzer an einer Zeile vor dem Anlegen ändern kann.
export type LineFields = {
  description: string
  category: string
  amountCents: number | null
  labor35aCents: number | null
  key: CostKey
  // Der gemerkte Schlüssel (shared/allocation.ts), wenn die Zeile ihn übernimmt
  allocation: Allocation | null
  // Kosten der Gemeinschaft bei „laut Gemeinschaftsabrechnung“
  externalTotalCents: number | null
}

// Was der Browser je Zeile entscheidet. `despiteCandidates`: angelegt, obwohl es eine Position
// gibt, die dieselbe Rechnung sein könnte; der Nutzer hat die Rückfrage bestätigt. Beim
// Verknüpfen darf er einen falsch gelesenen Betrag berichtigen.
export type LineDecision =
  | { idx: number; action: 'create'; fields: LineFields; despiteCandidates?: boolean }
  | { idx: number; action: 'link'; costItemId: string; amountCents?: number | null; labor35aCents?: number | null }
  | { idx: number; action: 'dismiss' }
  | { idx: number; action: 'release' }

// Eine Position, die dieselbe Rechnung sein könnte (shared/duplicates.ts). `formOnly`: Ihr Betrag
// hängt an weiteren Angaben (Einzelbeträge, Gemeinschaft), sie wird im Formular gepflegt.
export type LineCandidate = { id: string; description: string; amountCents: number; invoiceFile: string | null; key: CostKey; formOnly: boolean }

export type LineSuggestion = {
  fields: LineFields
  candidates: LineCandidate[]
  level: TrafficLight
  reasons: string[]
  preselected: boolean
}

// Eine Zeile, wie der Server sie zeigt: mit Zustand, der Beschreibung der Position, an der sie
// hängt, und für offene und verworfene Zeilen dem Vorschlag.
export type AssessmentLine = Omit<StoredAssessmentLine, 'assessmentId'> & {
  state: AssessmentLineState
  itemDescription: string | null
  suggestion: LineSuggestion | null
}

export type AssessmentView = StoredAssessment & {
  originalName: string
  lines: AssessmentLine[]
  // Hat die Auswertung noch offene Zeilen?
  open: boolean
  sumWarning: string | null
}

// Je Position, die eine Buchung anlegt (`costItemId: null`) oder ändert: Betrag und Lohnanteil
// vorher und nachher.
export type PreviewItem = {
  costItemId: string | null
  lines: number[]
  description: string
  category: string
  year: number
  beforeCents: number | null
  afterCents: number
  beforeLabor35aCents: number | null
  afterLabor35aCents: number | null
}
export type PreviewProblem = { idx: number | null; message: string; openItemId?: string }

// Die Vorschau des Servers. `token` bindet eine Buchung an genau diesen Stand: Hat er sich bis
// zum Buchen geändert, antwortet der Server mit 409 und einer neuen Vorschau.
export type BookingPreview = {
  items: PreviewItem[]
  notices: string[]
  errors: PreviewProblem[]
  confirm: PreviewProblem[]
  token: string
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/booking.test.ts`:

```ts
// Planen und Buchen einer Auswertung (Belegbuchung, #170) gegen eine echte Datenbank. Die vier
// Abnahmefälle aus den drei Durchsichten stehen hier als „Abnahme A“ bis „Abnahme D“; dieselben
// Fälle laufen in Task 8 noch einmal über die Routen und im Browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, LineDecision, LineFields } from '../../shared/types.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, createProperty, removeEntity, updateEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'
import { saveAssessment, type AssessmentRecord, type NewAssessment } from '../src/db/assessments.ts'
import { BookingRefusal, bookAssessment, previewBooking, viewAssessment, type BookingOutcome } from '../src/db/booking.ts'
import { recordUpload } from '../src/db/uploads.ts'
import type { NewLine } from '../src/assessment.ts'

type World = { opened: OpenedDatabase; uploadDir: string }

async function withWorld(work: (w: World) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-buchung-'))
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }))
    await work({ opened, uploadDir })
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

let seq = 0
const newId = () => `neu-${++seq}`
const line = (description: string, category: string, amountCents: number | null, labor35aCents: number | null = null): NewLine =>
  ({ description, category, categoryGuessed: false, amountCents, labor35aCents })
const fields = (description: string, category: string, amountCents: number | null, extra: Partial<LineFields> = {}): LineFields =>
  ({ description, category, amountCents, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null, ...extra })

async function receipt(w: World, file: string, lines: NewLine[], extra: Partial<NewAssessment> = {}): Promise<AssessmentRecord> {
  fs.writeFileSync(path.join(w.uploadDir, file), `%PDF ${file}`)
  return w.opened.write((db) => saveAssessment(db, {
    file, propertyId: 'objekt-1', year: 2025, detectedYear: 2025, vendor: 'Stadtwerke', invoiceDate: '2026-02-15',
    totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines, ...extra,
  }, { id: `a-${file}`, now: new Date(Date.UTC(2026, 9, 2, 0, 0, ++seq)).toISOString() }))
}
const estimate = (w: World, id: string, patch: Record<string, unknown> = {}) => w.opened.write((db) => createEntity(db, 'costItems', id, {
  propertyId: 'objekt-1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser/Abwasser 2025', amountCents: 150000, key: 'area', ...patch,
}))
const plan = (w: World, r: AssessmentRecord, decisions: LineDecision[]) =>
  w.opened.read((db) => previewBooking(db, r.assessment.id, decisions, w.uploadDir))
async function book(w: World, r: AssessmentRecord, decisions: LineDecision[], token?: string): Promise<BookingOutcome> {
  const t = token ?? (await plan(w, r, decisions)).token
  return w.opened.write((db) => bookAssessment(db, r.assessment.id, decisions, t, { uploadDir: w.uploadDir, newId }))
}
const items = async (w: World): Promise<CostItem[]> => (await w.opened.read(readStock)).costItems
const itemOf = async (w: World, id: string): Promise<CostItem> => (await items(w)).find((i) => i.id === id) ?? assert.fail(`keine Position ${id}`)
const view = (w: World, r: AssessmentRecord) => w.opened.read((db) => viewAssessment(db, r.assessment.id, w.uploadDir))
function done(o: BookingOutcome): { changed: boolean } {
  if (o.kind !== 'done') return assert.fail(`nicht gebucht: ${JSON.stringify(o)}`)
  return o
}
const link = (idx: number, costItemId: string): LineDecision => ({ idx, action: 'link', costItemId })

test('Abnahme A: Wasser 700 € + 800 € gegen eine Schätzung von 1.500 € ergibt eine Position über 1.500 €', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'wasser.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const decisions = [link(0, 'wa'), link(1, 'wa')]
    const preview = await plan(w, r, decisions)
    assert.deepEqual(preview.errors, [])
    assert.deepEqual(preview.items.map((i) => [i.costItemId, i.lines, i.beforeCents, i.afterCents]), [['wa', [0, 1], 150000, 150000]])
    done(await book(w, r, decisions, preview.token))
    const wasser = (await items(w)).filter((i) => i.category === 'Wasser/Abwasser')
    assert.deepEqual(wasser.map((i) => [i.id, i.amountCents, i.invoiceFile]), [['wa', 150000, 'wasser.pdf']])
  })
})

test('Summenregel: eine Schätzung, die nicht der Summe entspricht, wird mit Ansage ersetzt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'wasser.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const preview = await plan(w, r, [link(0, 'wa'), link(1, 'wa')])
    assert.ok(preview.notices.some((n) => /bisherige Betrag von 1\.400,00\s€ stammt aus keinem Beleg.*1\.500,00\s€/.test(n)), preview.notices.join('\n'))
  })
})

test('Abnahme B: Restmüll 700 € mit Gutschrift −50 € ergibt zwei Positionen; die Gutschrift wird nie verknüpft', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'muell.pdf', [line('Restmüll', 'Müllabfuhr', 70000), line('Gutschrift Tonnentausch', 'Müllabfuhr', -5000)])
    const decisions: LineDecision[] = [
      { idx: 0, action: 'create', fields: fields('Restmüll', 'Müllabfuhr', 70000) },
      { idx: 1, action: 'create', fields: fields('Gutschrift Tonnentausch', 'Müllabfuhr', -5000) },
    ]
    const preview = await plan(w, r, decisions)
    assert.deepEqual(preview.errors, [])
    assert.deepEqual(preview.confirm, [], 'Zeilen desselben Belegs sind keine Doppelung')
    done(await book(w, r, decisions, preview.token))
    const all = await items(w)
    assert.deepEqual(all.map((i) => i.amountCents).sort((a, b) => a - b), [-5000, 70000])
    const restmuell = all.find((i) => i.amountCents === 70000) ?? assert.fail('Restmüll fehlt')
    const zweite = await receipt(w, 'gutschrift.pdf', [line('Gutschrift', 'Müllabfuhr', -5000)])
    const p = await plan(w, zweite, [link(0, restmuell.id)])
    assert.match(p.errors[0]?.message ?? '', /Gutschrift.*nie mit einer Position verrechnet/)
  })
})

test('Verknüpfen, das eine Summe von 0 € ergäbe, ist ein Fehler', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    const p = await plan(w, r, [{ idx: 0, action: 'link', costItemId: 'wa', amountCents: 0 }])
    assert.match(p.errors.map((e) => e.message).join(' '), /Summe der Zeilen an „Wasser\/Abwasser 2025“ wäre 0,00\s€/)
  })
})

test('Abnahme C: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil: Der Lohnanteil wird mit Ansage entfernt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gp', { category: 'Gartenpflege', description: 'Gartenpflege 2025', amountCents: 150000, labor35aCents: 100000 })
    const r = await receipt(w, 'garten.pdf', [line('Gartenpflege Saison', 'Gartenpflege', 145000)])
    const preview = await plan(w, r, [link(0, 'gp')])
    assert.ok(preview.notices.some((n) => /Lohnanteil von 1\.000,00\s€ wird entfernt/.test(n)), preview.notices.join('\n'))
    assert.deepEqual(preview.items.map((i) => [i.afterCents, i.beforeLabor35aCents, i.afterLabor35aCents]), [[145000, 100000, null]])
    done(await book(w, r, [link(0, 'gp')], preview.token))
    const gp = await itemOf(w, 'gp')
    assert.equal(gp.amountCents, 145000)
    assert.equal(gp.labor35aCents ?? null, null)
  })
})

test('§35a: gelesene Lohnanteile gelten als Summe; eine ausdrückliche 0 setzt auf 0 mit Ansage', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'sf', { category: 'Schornsteinfeger', description: 'Schornsteinfeger 2025', amountCents: 20000, labor35aCents: 5000 })
    const r = await receipt(w, 'sf.pdf', [line('Kehren', 'Schornsteinfeger', 12000, 9000), line('Messung', 'Schornsteinfeger', 8000, null)])
    done(await book(w, r, [link(0, 'sf'), link(1, 'sf')]))
    assert.deepEqual([(await itemOf(w, 'sf')).amountCents, (await itemOf(w, 'sf')).labor35aCents], [20000, 9000])

    await estimate(w, 'sf2', { category: 'Schornsteinfeger', description: 'Kehren Nebengebäude', amountCents: 9000, labor35aCents: 5000 })
    const r2 = await receipt(w, 'sf2.pdf', [line('Kehren Nebengebäude', 'Schornsteinfeger', 9000, 0)])
    const p = await plan(w, r2, [link(0, 'sf2')])
    assert.ok(p.notices.some((n) => /Lohnanteil wird auf 0,00\s€ gesetzt/.test(n)), p.notices.join('\n'))
    assert.equal(p.items[0]?.afterLabor35aCents, 0)
  })
})

test('Abnahme D: zweimal hintereinander buchen ergibt eine Position', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]
    const token = (await plan(w, r, decisions)).token
    assert.equal(done(await book(w, r, decisions, token)).changed, true)
    assert.equal(done(await book(w, r, decisions, token)).changed, false)
    assert.equal((await items(w)).length, 1)
  })
})

test('zwei gleichzeitige Buchungen ergeben eine Position; eine andere Entscheidung für dieselbe Zeile ist ein Widerspruch', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]
    const token = (await plan(w, r, decisions)).token
    const [a, b] = await Promise.all([book(w, r, decisions, token), book(w, r, decisions, token)])
    assert.deepEqual([done(a).changed, done(b).changed].sort(), [false, true])
    assert.equal((await items(w)).length, 1)
    const anders = await book(w, r, [{ idx: 0, action: 'dismiss' }], 'egal')
    assert.equal(anders.kind, 'conflict')
  })
})

test('Summenregel über zwei Belege: Abschlag und Restrechnung ergeben die Summe, der Beleg der Position bleibt der erste', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'st', { category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom 2025', amountCents: 90000 })
    const a = await receipt(w, 'abschlag.pdf', [line('Abschlag', 'Beleuchtung/Allgemeinstrom', 50000)])
    done(await book(w, a, [link(0, 'st')]))
    const b = await receipt(w, 'rest.pdf', [line('Restrechnung', 'Beleuchtung/Allgemeinstrom', 30000)])
    const p = await plan(w, b, [link(0, 'st')])
    assert.deepEqual(p.items.map((i) => [i.beforeCents, i.afterCents]), [[50000, 80000]])
    done(await book(w, b, [link(0, 'st')], p.token))
    const st = await itemOf(w, 'st')
    assert.deepEqual([st.amountCents, st.invoiceFile], [80000, 'abschlag.pdf'])
  })
})

test('Von Hand geänderter Betrag einer verknüpften Position wird bei der nächsten Buchung mit Ansage ersetzt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    await w.opened.write((db) => updateEntity(db, 'costItems', 'wa', { amountCents: 75000 }))
    const b = await receipt(w, 'b.pdf', [line('Abwasser', 'Wasser/Abwasser', 80000)])
    const p = await plan(w, b, [link(0, 'wa')])
    assert.ok(p.notices.some((n) => /von Hand auf 750,00\s€ geändert.*1\.500,00\s€/.test(n)), p.notices.join('\n'))
  })
})

test('Gemeinschaftsabrechnung und Einzelbeträge sind keine Verknüpfungsziele; die Vorschau nennt die Position zum Öffnen', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'hg', { category: 'Hauswart', description: 'Hausgeld Hauswart', amountCents: 12000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1200000 } })
    await estimate(w, 'hz', { category: 'Heizung und Warmwasser', description: 'Heizung laut Messdienst', amountCents: 90000, key: 'amounts', tenancyAmounts: {} })
    const r = await receipt(w, 'x.pdf', [line('Hausmeister', 'Hauswart', 12000), line('Heizung', 'Heizung und Warmwasser', 90000)])
    const p = await plan(w, r, [link(0, 'hg'), link(1, 'hz')])
    assert.deepEqual(p.errors.map((e) => e.openItemId), ['hg', 'hz'])
  })
})

test('Ziel aus anderem Objekt oder Jahr ergibt einen Fehler, kein stilles Umbiegen', async () => {
  await withWorld(async (w) => {
    await w.opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await estimate(w, 'fremd', { propertyId: 'objekt-2' })
    await estimate(w, 'alt', { year: 2024 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    assert.match((await plan(w, r, [link(0, 'fremd')])).errors[0]?.message ?? '', /anderen Objekt/)
    assert.match((await plan(w, r, [link(0, 'alt')])).errors[0]?.message ?? '', /gehört zu 2024, der Beleg zu 2025/)
  })
})

test('release rechnet die Summe neu; bleibt keine Zeile, behält die Position ihren Betrag', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, r, [link(0, 'wa'), link(1, 'wa')]))
    const p = await plan(w, r, [{ idx: 1, action: 'release' }])
    assert.deepEqual(p.items.map((i) => [i.beforeCents, i.afterCents]), [[150000, 70000]])
    done(await book(w, r, [{ idx: 1, action: 'release' }], p.token))
    assert.equal((await itemOf(w, 'wa')).amountCents, 70000)
    const letzte = await plan(w, r, [{ idx: 0, action: 'release' }])
    assert.ok(letzte.notices.some((n) => /behält ihren Betrag von 700,00\s€/.test(n)), letzte.notices.join('\n'))
    done(await book(w, r, [{ idx: 0, action: 'release' }], letzte.token))
    assert.equal((await itemOf(w, 'wa')).amountCents, 70000)
    assert.deepEqual((await view(w, r)).lines.map((l) => l.state), ['open', 'open'])
  })
})

test('Eine angelegte Zeile löst man durch Löschen der Position; danach ist sie wieder offen', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    done(await book(w, r, [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]))
    assert.match((await plan(w, r, [{ idx: 0, action: 'release' }])).errors[0]?.message ?? '', /indem Sie die Position löschen/)
    const id = (await items(w))[0]?.id ?? assert.fail('keine Position')
    await w.opened.write((db) => removeEntity(db, 'costItems', id))
    assert.equal((await view(w, r)).lines[0]?.state, 'open')
  })
})

test('Geänderter Stand zwischen Vorschau und Buchung ergibt einen Widerspruch mit neuer Vorschau', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    const preview = await plan(w, r, [link(0, 'wa')])
    await w.opened.write((db) => updateEntity(db, 'costItems', 'wa', { amountCents: 145000 }))
    const stale = await book(w, r, [link(0, 'wa')], preview.token)
    if (stale.kind !== 'stale') return assert.fail(`erwartet stale, bekommen ${stale.kind}`)
    assert.equal(stale.preview.items[0]?.beforeCents, 145000)
    assert.equal((await itemOf(w, 'wa')).amountCents, 145000, 'nichts gebucht')
    done(await book(w, r, [link(0, 'wa')], stale.preview.token))
  })
})

test('Die Vorschau stimmt wörtlich mit dem Ergebnis der Buchung überein', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const decisions = [link(0, 'wa'), link(1, 'wa')]
    const preview = await plan(w, r, decisions)
    const outcome = await book(w, r, decisions, preview.token)
    if (outcome.kind !== 'done') return assert.fail(outcome.kind)
    assert.deepEqual(outcome.preview, preview)
  })
})

test('Zeile mit Kandidat: Anlegen nur nach ausdrücklicher Bestätigung', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gs', { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 61000 })
    const r = await receipt(w, 'gs.pdf', [line('Abgabenbescheid', 'Grundsteuer', 61240)])
    const ohne: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Abgabenbescheid', 'Grundsteuer', 61240) }]
    const p = await plan(w, r, ohne)
    assert.match(p.confirm[0]?.message ?? '', /„Grundsteuer 2025“ \(610,00\s€, ohne Beleg\)/)
    assert.equal((await book(w, r, ohne, p.token)).kind, 'refused')
    const mit: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Abgabenbescheid', 'Grundsteuer', 61240), despiteCandidates: true }]
    done(await book(w, r, mit))
    assert.equal((await items(w)).length, 2)
  })
})

test('Eine Auswertung ohne Objekt lässt sich nicht buchen', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)], { propertyId: null })
    const p = await plan(w, r, [{ idx: 0, action: 'create', fields: fields('Frischwasser', 'Wasser/Abwasser', 70000) }])
    assert.match(p.errors[0]?.message ?? '', /Zu welchem Objekt gehört dieser Beleg/)
  })
})

test('Ist die Datei des Belegs gelöscht, gibt es weder Vorschau noch Buchung', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'weg.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    fs.rmSync(path.join(w.uploadDir, 'weg.pdf'))
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Frischwasser', 'Wasser/Abwasser', 70000) }]
    const gone = (err: unknown) => err instanceof BookingRefusal && err.status === 404 && /gibt es im Belegordner nicht mehr/.test(err.message)
    await assert.rejects(plan(w, r, decisions), gone)
    await assert.rejects(book(w, r, decisions, 'egal'), gone)
    assert.equal((await items(w)).length, 0)
  })
})

test('Gleicher Inhalt als zweite Datei: rot, und Verknüpfen mit der Position, die ihn schon enthält, ist ein Fehler', async () => {
  await withWorld(async (w) => {
    const row = (file: string) => ({ file, originalName: file, mimeType: 'application/pdf', size: 10, sha256: 'gleich', uploadedAt: '2026-10-02T00:00:00.000Z', propertyId: null, year: null, invoiceDate: null, kind: 'receipt' as const })
    await w.opened.write((db) => recordUpload(db, row('a.pdf')))
    await w.opened.write((db) => recordUpload(db, row('b.pdf')))
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    const b = await receipt(w, 'b.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    assert.match((await plan(w, b, [link(0, 'wa')])).errors[0]?.message ?? '', /enthält diesen Beleg schon/)
    const shown = (await view(w, b)).lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.equal(shown.level, 'rot')
    assert.ok(shown.reasons.some((x) => /gleicher Inhalt wie „a\.pdf“/.test(x)))
    assert.equal(shown.preselected, false)
  })
})

test('Vorschläge: mit Kandidat nicht vorab angehakt, rot nicht, grün schon', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gs', { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 61000 })
    const r = await receipt(w, 'mix.pdf', [
      line('Abgabenbescheid', 'Grundsteuer', 61240), line('Hausmeister', 'Hauswart', 30000), line('Unklar', 'Sonstige Betriebskosten', 1000),
    ])
    const v = await view(w, r)
    assert.deepEqual(v.lines.map((l) => [l.suggestion?.preselected, l.suggestion?.candidates.map((c) => c.id)]), [[false, ['gs']], [true, []], [false, []]])
    assert.equal(v.lines[2]?.suggestion?.level, 'rot')
    assert.equal(v.open, true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/booking.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `src/db/booking.ts`.

- [ ] **Step 4: Schreibhelfer in `server/src/db/repository.ts`**

Nach `removeEntity` einfügen (die Funktionen stehen hinter `costItemCollection`, weil sie es benutzen):

```ts
// ---------- Für die Belegbuchung (#170) ----------
//
// Die Buchung legt Positionen an und ändert ihre Beträge **innerhalb ihrer eigenen Transaktion**
// (db/booking.ts). `createEntity` und `updateEntity` öffnen jeweils eine eigene; SQLite kennt
// keine geschachtelte. Deshalb hier dieselbe Verschmelzung, derselbe Wächter und dasselbe Schreiben,
// nur ohne Transaktion: Ein Weg mit eigenen Regeln wäre ein zweiter, der auseinanderläuft.
export async function insertCostItemIn(tx: Executor, id: string, body: unknown): Promise<void> {
  const entity = mergeCostItem(emptyCostItem(id), body)
  await guardCostItem(tx, null, entity)
  await costItemCollection.insert(tx, entity)
}

export async function patchCostItemIn(tx: Executor, current: CostItem, body: unknown): Promise<void> {
  const entity = mergeCostItem(current, body)
  await guardCostItem(tx, current, entity)
  await costItemCollection.replace(tx, entity)
}
```

- [ ] **Step 5: Entwurf, Vorschläge und Ansicht in `server/src/assessment.ts`**

Die Importe oben ersetzen durch:

```ts
import type {
  AssessmentLine, AssessmentLineState, AssessmentView, CostItem, Extraction, LineFields, LineSuggestion, Meter, PropertyKind,
  StoredAssessment, StoredAssessmentLine, Unit,
} from '../../shared/types.ts'
import { matchCategory } from '../../shared/categories.ts'
import { normalizedText, sameCostCandidates } from '../../shared/duplicates.ts'
import { costItemBody, type CostItemDraft } from '../../shared/costItem.ts'
import { aiPositionDefaults, aiPositionPreselect, aiRowPreselected, categoryDeviationPct, invoiceSumCheck, scorePosition } from '../../shared/assessment.ts'
```

und am Ende anfügen:

```ts
// ---------- Entwurf einer Position aus einer Zeile ----------

// Was aus den Angaben einer Zeile als Kostenposition würde, in der Gestalt der gemeinsamen
// Prüfung (shared/costItem.ts). Der gemerkte Schlüssel gilt nur, solange die Zeile ihn noch
// führt; Wohnungen, die es nicht mehr gibt, fallen heraus, wie bisher im Formular
// (`applyAllocation`). Einzelbeträge hat eine KI-Zeile nie.
export function lineDraft(fields: LineFields, extra: { vendor: string; invoiceFile: string }, units: readonly Unit[]): CostItemDraft {
  const known = new Set(units.map((u) => u.id))
  const a = fields.allocation && fields.allocation.key === fields.key ? fields.allocation : null
  return {
    category: fields.category,
    description: fields.description,
    vendor: extra.vendor,
    invoiceFile: extra.invoiceFile,
    amountCents: fields.amountCents,
    labor35aCents: fields.labor35aCents ?? 0,
    key: fields.key,
    directUnitId: a?.directUnitId && known.has(a.directUnitId) ? a.directUnitId : null,
    meterType: a?.meterType ?? null,
    customShares: Object.fromEntries(Object.entries(a?.customShares ?? {}).filter(([id]) => known.has(id))),
    participants: a?.participantUnitIds ? a.participantUnitIds.filter((id) => known.has(id)) : null,
    external: { measure: a?.externalBasis?.measure ?? 'mea', total: a?.externalBasis?.total ?? null, totalCents: fields.externalTotalCents },
    tenancyAmounts: {},
    selfAmounts: {},
  }
}

// ---------- Vorschläge und Ansicht ----------

export type DescribeContext = {
  // Die Positionen des Objekts der Auswertung, alle Jahre
  items: readonly CostItem[]
  units: readonly Unit[]
  meters: readonly Meter[]
  propertyKind: PropertyKind | null
  originalName: string
  // Name eines anderen Belegs mit gleichem Inhalt, der schon gebucht ist
  twinOf: string | null
}

// Der Vorschlag zu einer offenen oder verworfenen Zeile: Schlüssel aus dem Vorjahr, Kandidaten
// nach der Doppelungsregel, Ampel und ob die Zeile vorab angehakt ist. Dieselben Regeln wie
// bisher in der Schnellerfassung, jetzt für alle drei Wege.
function suggestLine(line: StoredAssessmentLine, a: StoredAssessment, others: readonly CostItem[], ctx: DescribeContext): LineSuggestion {
  const vendor = a.vendor ?? ''
  const defaults = aiPositionDefaults(line.category, ctx.units, ctx.meters, { items: ctx.items, year: a.year, propertyKind: ctx.propertyKind }, line.description)
  const fields: LineFields = {
    description: line.description, category: line.category, amountCents: line.amountCents, labor35aCents: line.labor35aCents,
    key: defaults.key, allocation: defaults.allocation, externalTotalCents: null,
  }
  const candidates = a.propertyId === null ? [] : sameCostCandidates(others, { propertyId: a.propertyId, year: a.year, category: line.category, description: line.description, vendor })
  const amount = line.amountCents ?? 0
  const score = scorePosition({
    category: line.category, description: line.description, amountCents: amount, labor35aCents: line.labor35aCents ?? 0,
    matchedByDesc: line.categoryGuessed, vendor, detectedYear: a.detectedYear, targetYear: a.year, existingItems: others,
    priorYearDeviationPct: categoryDeviationPct(ctx.items, line.category, a.year, amount),
  })
  const built = costItemBody(lineDraft(fields, { vendor, invoiceFile: a.file }, ctx.units), ctx.units, a.year)
  const problem = 'error' in built ? built.error : null
  let level = score.level
  const reasons = [...score.reasons]
  if (problem !== null) {
    level = 'rot'
    reasons.push(`Nicht übernehmbar: ${problem}`)
  } else if (!aiPositionPreselect(defaults) && level === 'gruen') {
    // Gemerkter Schlüssel nur für einzelne Wohnungen (Durchsicht zu #141): nie grün.
    level = 'gelb'
    reasons.push('Schlüssel aus dem Vorjahr nur für einzelne Wohnungen, bitte prüfen')
  }
  if (ctx.twinOf !== null) {
    level = 'rot'
    reasons.push(`gleicher Inhalt wie „${ctx.twinOf}“ — dieser Beleg ist schon gebucht`)
  }
  return {
    fields,
    candidates: candidates.map((c) => ({
      id: c.id, description: c.description, amountCents: c.amountCents, invoiceFile: c.invoiceFile ?? null, key: c.key,
      formOnly: c.key === 'amounts' || c.key === 'external',
    })),
    level,
    reasons,
    preselected: ctx.twinOf === null && aiRowPreselected({ category: line.category, preselect: aiPositionPreselect(defaults), problem, level, candidates }),
  }
}

export function describeAssessment(record: { assessment: StoredAssessment; lines: readonly StoredAssessmentLine[] }, ctx: DescribeContext): AssessmentView {
  const a = record.assessment
  const own = new Set(ownItemIds(record.lines))
  const others = ctx.items.filter((i) => !own.has(i.id))
  const lines: AssessmentLine[] = record.lines.map((l) => {
    const state = lineState(l)
    const { assessmentId: _assessmentId, ...rest } = l
    return {
      ...rest,
      state,
      itemDescription: l.costItemId ? ctx.items.find((i) => i.id === l.costItemId)?.description ?? null : null,
      suggestion: state === 'open' || state === 'dismissed' ? suggestLine(l, a, others, ctx) : null,
    }
  })
  const sum = record.lines.reduce((s, l) => s + (l.amountCents ?? 0), 0)
  return { ...a, originalName: ctx.originalName, lines, open: lines.some((l) => l.state === 'open'), sumWarning: invoiceSumCheck(sum, a.totalGrossCents) }
}
```

`_assessmentId` fällt bewusst weg (`AssessmentLine` hat das Feld nicht); `noUnusedLocals` ist in
beiden `tsconfig.json` nicht gesetzt.

- [ ] **Step 6: Der Planer `server/src/bookingPlan.ts`**

```ts
// Planen einer Buchung (Belegbuchung, #170), als reine Funktion: Aus dem gespeicherten Stand und
// den Entscheidungen des Browsers entstehen die Vorschau und die Liste dessen, was zu schreiben
// ist. Die Vorschau sagt wörtlich, was die Buchung danach tut; db/booking.ts führt genau diese
// Schreibliste aus und nichts anderes.
//
// **Die Summenregel** (Spec, Entscheidung 2): Der Betrag einer Position, an der Zeilen hängen,
// ist die Summe **aller** Zeilen an ihr, über alle Belege, aus dem gespeicherten Stand. Deshalb
// kann keine Zeile doppelt zählen, egal wie oft gebucht wird. Der §35a-Lohnanteil folgt derselben
// Regel; nennt keine Zeile einen, wird ein vorhandener entfernt, und die Vorschau sagt es.
//
// **Eine Zeile, die nicht offen ist, wird nie noch einmal gebucht.** Ist sie genau so gebucht,
// ist das ohne Änderung (Doppelklick, Wiederholung); anders gebucht ist ein Widerspruch.
import type {
  BookingPreview, CostItem, CostKey, ExternalMeasure, LineDecision, MeterType, PreviewItem, PreviewProblem, StoredAssessment, StoredAssessmentLine, Unit,
} from '../../shared/types.ts'
import type { Allocation } from '../../shared/allocation.ts'
import { amountProblem, costItemBody, euro, type CostItemBody } from '../../shared/costItem.ts'
import { candidateText } from '../../shared/assessment.ts'
import { sameCostCandidates } from '../../shared/duplicates.ts'
import { changeOf, lineDraft, lineState, ownItemIds, type BookedLine, type LineChange } from './assessment.ts'

export type PlanInput = {
  assessment: StoredAssessment
  lines: readonly StoredAssessmentLine[]
  // Alle Positionen aller Objekte: Ein Ziel aus einem anderen Objekt soll benannt werden können
  items: readonly CostItem[]
  // Alle gebuchten Zeilen aller Auswertungen
  booked: readonly BookedLine[]
  // Die Wohnungen des Objekts der Auswertung
  units: readonly Unit[]
  // Andere Belege mit gleichem Inhalt (Prüfsumme)
  twinFiles: readonly string[]
}

export type BookingWrite =
  | { kind: 'createItem'; id: string; body: CostItemBody & { propertyId: string } }
  | { kind: 'updateItem'; id: string; patch: { amountCents: number; labor35aCents: number | null; invoiceFile?: string } }
  | { kind: 'line'; idx: number; change: LineChange }

export type Planned = {
  preview: Omit<BookingPreview, 'token'>
  writes: BookingWrite[]
  // Entscheidungen, die schon genau so gebucht sind
  unchanged: number[]
  // Zeilen, die anders gebucht sind, als die Entscheidung verlangt (409)
  conflicts: string[]
}

const FORM_ONLY: readonly CostKey[] = ['amounts', 'external']
const quote = (s: string): string => `„${s}“`

type Link = { assessmentId: string; idx: number; amountCents: number | null; labor35aCents: number | null }

export function planBooking(input: PlanInput, decisions: readonly LineDecision[], newId: () => string): Planned {
  const a = input.assessment
  const errors: PreviewProblem[] = []
  const confirm: PreviewProblem[] = []
  const notices: string[] = []
  const conflicts: string[] = []
  const unchanged: number[] = []
  const after = new Map<number, LineChange>()
  const created: PreviewItem[] = []
  const createWrites: BookingWrite[] = []
  const touched: string[] = []
  const itemById = new Map(input.items.map((i) => [i.id, i]))
  const own = new Set(ownItemIds(input.lines))
  const others = input.items.filter((i) => i.propertyId === a.propertyId && !own.has(i.id))
  const twinBooked = input.booked.some((l) => input.twinFiles.includes(l.file))
  const seen = new Set<number>()
  const named = (l: StoredAssessmentLine): string => quote(l.description || 'ohne Beschreibung')
  const targetOf = (l: StoredAssessmentLine): string => {
    const t = l.costItemId ? itemById.get(l.costItemId) : undefined
    return t ? quote(t.description) : 'einer Position'
  }

  if (a.propertyId === null && decisions.some((d) => d.action === 'create' || d.action === 'link')) {
    errors.push({ idx: null, message: 'Zu welchem Objekt gehört dieser Beleg? Bitte wählen Sie es zuerst; gebucht wird nur innerhalb eines Objekts.' })
  }

  for (const d of decisions) {
    const line = input.lines.find((l) => l.idx === d.idx)
    if (!line) {
      errors.push({ idx: d.idx, message: 'Diese Zeile der Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
      continue
    }
    if (seen.has(d.idx)) {
      errors.push({ idx: d.idx, message: `${named(line)} steht zweimal in der Anfrage.` })
      continue
    }
    seen.add(d.idx)
    const state = lineState(line)

    if (d.action === 'create') {
      if (state === 'created') { unchanged.push(d.idx); continue }
      if (state === 'linked') { conflicts.push(`${named(line)} ist schon mit ${targetOf(line)} verknüpft.`); continue }
      if (a.propertyId === null) continue
      if (d.fields.key === 'amounts') {
        errors.push({ idx: d.idx, message: `${named(line)}: Einzelbeträge je Mieter tragen Sie bitte im Formular der Position ein.` })
        continue
      }
      const built = costItemBody(lineDraft(d.fields, { vendor: a.vendor ?? '', invoiceFile: a.file }, input.units), input.units, a.year)
      if ('error' in built) {
        errors.push({ idx: d.idx, message: `${quote(d.fields.description || line.description)}: ${built.error}` })
        continue
      }
      const body = built.body
      if (!d.despiteCandidates) {
        const candidates = sameCostCandidates(others, { propertyId: a.propertyId, year: a.year, category: body.category, description: body.description, vendor: a.vendor ?? '' })
        if (candidates.length > 0) {
          confirm.push({ idx: d.idx, message: `Für ${a.year} steht schon ${candidates.map(candidateText).join(', ')}, dieselbe Kostenart wie ${quote(body.description)}. Ist es dieselbe Rechnung, verknüpfen Sie den Beleg besser mit ihr, sonst wird sie zweimal verteilt. Ist es eine zweite Rechnung, legen Sie sie als neue Position an.` })
        } else if (twinBooked) {
          confirm.push({ idx: d.idx, message: `Ein Beleg mit gleichem Inhalt ist schon gebucht. Legen Sie ${quote(body.description)} nur an, wenn es wirklich eine zweite Rechnung ist.` })
        }
      }
      const id = newId()
      createWrites.push({ kind: 'createItem', id, body: { ...body, propertyId: a.propertyId } })
      after.set(d.idx, {
        booking: 'created', costItemId: id, dismissed: false, description: body.description, category: body.category,
        amountCents: body.amountCents, labor35aCents: d.fields.labor35aCents,
      })
      created.push({
        costItemId: null, lines: [d.idx], description: body.description, category: body.category, year: a.year,
        beforeCents: null, afterCents: body.amountCents, beforeLabor35aCents: null, afterLabor35aCents: body.labor35aCents ?? null,
      })
      continue
    }

    if (d.action === 'link') {
      if (state === 'linked' && line.costItemId === d.costItemId) { unchanged.push(d.idx); continue }
      if (state === 'linked') { conflicts.push(`${named(line)} ist schon mit ${targetOf(line)} verknüpft.`); continue }
      if (state === 'created') { conflicts.push(`${named(line)} ist schon als eigene Position ${targetOf(line)} angelegt.`); continue }
      const target = itemById.get(d.costItemId)
      if (!target) {
        errors.push({ idx: d.idx, message: 'Diese Position gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
        continue
      }
      if (target.propertyId !== a.propertyId) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} gehört zu einem anderen Objekt. Verknüpft wird nur innerhalb des Objekts dieses Belegs.` })
        continue
      }
      if (target.year !== a.year) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} gehört zu ${target.year}, der Beleg zu ${a.year}. Ändern Sie das Jahr des Belegs oder legen Sie eine neue Position an.` })
        continue
      }
      if (FORM_ONLY.includes(target.key)) {
        const how = target.key === 'amounts' ? 'mit Einzelbeträgen je Mieter' : 'laut Gemeinschaftsabrechnung'
        errors.push({ idx: d.idx, openItemId: target.id, message: `${quote(target.description)} wird ${how} verteilt; ihr Betrag hängt an weiteren Angaben. Öffnen Sie die Position und tragen Sie ihn dort ein.` })
        continue
      }
      const amount = d.amountCents !== undefined ? d.amountCents : line.amountCents
      const labor = d.labor35aCents !== undefined ? d.labor35aCents : line.labor35aCents
      if (amount === null) {
        errors.push({ idx: d.idx, message: `${named(line)}: Der Betrag ist nicht gelesen. Bitte tragen Sie ihn ein.` })
        continue
      }
      if (amount < 0) {
        errors.push({ idx: d.idx, message: `${named(line)} ist eine Gutschrift. Sie wird nie mit einer Position verrechnet, sondern als eigene Position angelegt, damit sie auf der Abrechnung sichtbar bleibt.` })
        continue
      }
      if (input.booked.some((l) => l.costItemId === target.id && input.twinFiles.includes(l.file))) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} enthält diesen Beleg schon: Ein Beleg mit gleichem Inhalt ist mit ihr verknüpft. Ein zweites Verknüpfen zählte die Rechnung doppelt.` })
        continue
      }
      after.set(d.idx, { ...changeOf(line), booking: 'linked', costItemId: target.id, dismissed: false, amountCents: amount, labor35aCents: labor })
      if (!touched.includes(target.id)) touched.push(target.id)
      continue
    }

    if (d.action === 'dismiss') {
      if (state === 'dismissed') { unchanged.push(d.idx); continue }
      if (state !== 'open') { conflicts.push(`${named(line)} ist schon gebucht. Lösen Sie die Zeile zuerst, wenn Sie sie verwerfen möchten.`); continue }
      after.set(d.idx, { ...changeOf(line), dismissed: true })
      continue
    }

    // release
    if (state === 'open' || state === 'dismissed') { unchanged.push(d.idx); continue }
    if (state === 'created') {
      errors.push({ idx: d.idx, message: `${named(line)} ist als eigene Position ${targetOf(line)} angelegt. Sie lösen sie, indem Sie die Position löschen; dann ist die Zeile wieder offen.` })
      continue
    }
    const from = line.costItemId
    after.set(d.idx, { ...changeOf(line), booking: null, costItemId: null, dismissed: false })
    if (from && !touched.includes(from)) touched.push(from)
  }

  // ---------- Die Summenregel je berührter Position ----------
  const updateWrites: BookingWrite[] = []
  const touchedItems: PreviewItem[] = []
  for (const id of touched) {
    const t = itemById.get(id)
    if (!t) continue
    const before = input.booked.filter((l) => l.costItemId === id)
    const links: Link[] = [
      ...before.filter((l) => !(l.assessmentId === a.id && after.has(l.idx))),
      ...[...after].filter(([, c]) => c.costItemId === id).map(([idx, c]) => ({ assessmentId: a.id, idx, amountCents: c.amountCents, labor35aCents: c.labor35aCents })),
    ]
    const beforeLabor = t.labor35aCents ?? 0
    const ownLines = links.filter((l) => l.assessmentId === a.id).map((l) => l.idx).sort((x, y) => x - y)
    if (links.length === 0) {
      notices.push(`${quote(t.description)} behält ihren Betrag von ${euro(t.amountCents)}; mit ihr ist keine Zeile eines Belegs mehr verknüpft.`)
      touchedItems.push({
        costItemId: id, lines: [], description: t.description, category: t.category, year: t.year, beforeCents: t.amountCents,
        afterCents: t.amountCents, beforeLabor35aCents: t.labor35aCents ?? null, afterLabor35aCents: t.labor35aCents ?? null,
      })
      continue
    }
    if (links.some((l) => l.amountCents === null)) {
      errors.push({ idx: null, message: `${quote(t.description)}: Mindestens eine verknüpfte Zeile hat keinen gelesenen Betrag.` })
      continue
    }
    const sum = links.reduce((s, l) => s + (l.amountCents ?? 0), 0)
    if (sum <= 0) {
      errors.push({ idx: null, message: `Die Summe der Zeilen an ${quote(t.description)} wäre ${euro(sum)}. Eine Gutschrift oder eine Summe von 0 € wird nicht verrechnet; legen Sie die Gutschrift als eigene Position an.` })
      continue
    }
    const read = links.filter((l) => l.labor35aCents !== null)
    const labor: number | null = read.length > 0
      ? read.reduce((s, l) => s + (l.labor35aCents ?? 0), 0)
      : beforeLabor > 0 ? null : t.labor35aCents ?? null
    const linkedBefore = before.reduce((s, l) => s + (l.amountCents ?? 0), 0)
    if (before.length === 0 && t.amountCents !== sum) {
      notices.push(`${quote(t.description)}: Der bisherige Betrag von ${euro(t.amountCents)} stammt aus keinem Beleg, etwa eine Schätzung aus dem Vorjahr. Er wird durch die Summe der Zeilen ersetzt, ${euro(sum)}.`)
    }
    if (before.length > 0 && t.amountCents !== linkedBefore) {
      notices.push(`${quote(t.description)}: Der Betrag wurde von Hand auf ${euro(t.amountCents)} geändert. Die Buchung setzt ihn auf die Summe der verknüpften Zeilen, ${euro(sum)}.`)
    }
    if (before.length === 0 && t.invoiceFile && t.invoiceFile !== a.file) {
      notices.push(`${quote(t.description)} trägt schon einen Beleg, dessen Zeilen nicht ausgewertet sind. Ihr Betrag wird trotzdem durch die Summe der Zeilen ersetzt; gehört die Rechnung nicht dazu, legen Sie sie besser als eigene Position an.`)
    }
    if (read.length === 0 && beforeLabor > 0) {
      notices.push(`${quote(t.description)}: Der bisherige §35a-Lohnanteil von ${euro(beforeLabor)} wird entfernt, denn keine verknüpfte Zeile nennt einen. Nennt die Rechnung einen, tragen Sie ihn im Formular ein.`)
    }
    if (read.length > 0 && labor === 0 && beforeLabor > 0) {
      notices.push(`${quote(t.description)}: Der §35a-Lohnanteil wird auf ${euro(0)} gesetzt, wie die Rechnung ihn nennt.`)
    }
    const problem = amountProblem(sum, labor ?? 0, t.category)
    if (problem !== null) {
      errors.push({ idx: null, message: `${quote(t.description)}: ${problem}` })
      continue
    }
    updateWrites.push({ kind: 'updateItem', id, patch: { amountCents: sum, labor35aCents: labor, ...(t.invoiceFile ? {} : { invoiceFile: a.file }) } })
    touchedItems.push({
      costItemId: id, lines: ownLines, description: t.description, category: t.category, year: t.year, beforeCents: t.amountCents,
      afterCents: sum, beforeLabor35aCents: t.labor35aCents ?? null, afterLabor35aCents: labor,
    })
  }

  const lineWrites: BookingWrite[] = [...after].map(([idx, change]) => ({ kind: 'line', idx, change }))
  return {
    preview: { items: [...created, ...touchedItems], notices, errors, confirm },
    writes: [...createWrites, ...updateWrites, ...lineWrites],
    unchanged,
    conflicts,
  }
}

// Woraus die Prüfmarke einer Vorschau entsteht: was sie zeigt und was sie an den Zeilen ändert,
// ohne die Kennungen neuer Positionen (die entstehen erst beim Buchen). Der Server bildet daraus
// eine SHA-256-Marke (db/booking.ts); ändert sich der Stand, ändert sich die Marke.
export function tokenSource(p: Planned): string {
  const lines = p.writes.flatMap((w) => w.kind === 'line'
    ? [[w.idx, w.change.booking, w.change.booking === 'created' ? null : w.change.costItemId, w.change.dismissed, w.change.amountCents, w.change.labor35aCents]]
    : [])
  return JSON.stringify({ items: p.preview.items, notices: p.preview.notices, lines })
}

// Die Vorschau, wie die Routen sie zeigen: Widersprüche stehen bei den Fehlern vorn.
export function previewWith(p: Planned, token: string): BookingPreview {
  return { ...p.preview, errors: [...p.conflicts.map((message) => ({ idx: null, message })), ...p.preview.errors], token }
}

// Ob gebucht wird. Die Reihenfolge ist die Zusage: Ein Widerspruch geht vor, eine ganz schon
// gebuchte Anfrage ist ein Erfolg ohne Änderung (Doppelklick), Fehler und offene Rückfragen
// verhindern das Buchen, und eine Vorschau auf einem anderen Stand auch.
export function decide(p: Planned, decisionCount: number, token: string, expected: string): 'apply' | 'unchanged' | 'conflict' | 'refused' | 'stale' {
  if (p.conflicts.length > 0) return 'conflict'
  if (p.unchanged.length === decisionCount) return 'unchanged'
  if (p.preview.errors.length > 0 || p.preview.confirm.length > 0) return 'refused'
  return token === expected ? 'apply' : 'stale'
}

// ---------- Die Entscheidungen aus dem Rumpf ----------
//
// Verengt wird mit `typeof` und `Reflect.get`, wie in repository.ts. Die Listen erlaubter Werte
// sind `Record<…, true>`: Kommt ein Schlüssel oder Zählertyp hinzu, verlangt der Übersetzer ihn
// hier, ohne dass diese Datei das Schema (und damit drizzle) laden muss; die Tests des Browsers
// importieren sie.
const KEYS: Record<CostKey, true> = { area: true, persons: true, units: true, direct: true, meter: true, custom: true, external: true, amounts: true }
const METER_TYPES: Record<MeterType, true> = { kaltwasser: true, strom: true, waerme: true, sonstig: true }
const MEASURES: Record<ExternalMeasure, true> = { mea: true, area: true, units: true }

const get = (v: unknown, key: string): unknown => (v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const centsOrNull = (v: unknown): number | null | false => (v === null ? null : isWhole(v) ? v : false)
function known<T extends string>(list: Record<T, true>, v: unknown): T | null {
  for (const k of Object.keys(list)) if (k === v) return v as T
  return null
}

function readAllocation(v: unknown): Allocation | null | false {
  if (v === null) return null
  const key = known(KEYS, get(v, 'key'))
  if (!key) return false
  const meterRaw = get(v, 'meterType')
  const meterType = meterRaw === null ? null : known(METER_TYPES, meterRaw)
  if (meterRaw !== null && meterType === null) return false
  const direct = get(v, 'directUnitId')
  if (direct !== null && typeof direct !== 'string') return false
  const sharesRaw = get(v, 'customShares')
  let customShares: Record<string, number> | null = null
  if (sharesRaw !== null) {
    if (typeof sharesRaw !== 'object' || Array.isArray(sharesRaw)) return false
    customShares = {}
    for (const [id, p] of Object.entries(sharesRaw)) {
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return false
      customShares[id] = p
    }
  }
  const partRaw = get(v, 'participantUnitIds')
  let participantUnitIds: string[] | null = null
  if (partRaw !== null) {
    if (!Array.isArray(partRaw)) return false
    participantUnitIds = partRaw.filter((x): x is string => typeof x === 'string')
    if (participantUnitIds.length !== partRaw.length) return false
  }
  const extRaw = get(v, 'externalBasis')
  let externalBasis: Allocation['externalBasis'] = null
  if (extRaw !== null) {
    const measure = known(MEASURES, get(extRaw, 'measure'))
    const total = get(extRaw, 'total')
    if (!measure || typeof total !== 'number' || !(total > 0)) return false
    externalBasis = { measure, total }
  }
  return { key, meterType, directUnitId: direct, customShares, participantUnitIds, externalBasis }
}

const UNREADABLE = 'Die Entscheidungen zu den Zeilen sind unlesbar. Bitte laden Sie die Seite neu.'

export function parseDecisions(raw: unknown): { decisions: LineDecision[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: UNREADABLE }
  const out: LineDecision[] = []
  for (const d of raw) {
    const idx = get(d, 'idx')
    if (!isWhole(idx) || idx < 0) return { error: UNREADABLE }
    const action = get(d, 'action')
    if (action === 'dismiss' || action === 'release') {
      out.push({ idx, action })
      continue
    }
    if (action === 'link') {
      const costItemId = get(d, 'costItemId')
      if (typeof costItemId !== 'string' || costItemId === '') return { error: UNREADABLE }
      const amountRaw = get(d, 'amountCents')
      const laborRaw = get(d, 'labor35aCents')
      const amount = amountRaw === undefined ? undefined : centsOrNull(amountRaw)
      const labor = laborRaw === undefined ? undefined : centsOrNull(laborRaw)
      if (amount === false || labor === false) return { error: UNREADABLE }
      out.push({ idx, action: 'link', costItemId, ...(amount !== undefined ? { amountCents: amount } : {}), ...(labor !== undefined ? { labor35aCents: labor } : {}) })
      continue
    }
    if (action === 'create') {
      const f = get(d, 'fields')
      const description = get(f, 'description')
      const category = get(f, 'category')
      const key = known(KEYS, get(f, 'key'))
      const amountCents = centsOrNull(get(f, 'amountCents'))
      const labor35aCents = centsOrNull(get(f, 'labor35aCents'))
      const externalTotalCents = centsOrNull(get(f, 'externalTotalCents'))
      const allocation = readAllocation(get(f, 'allocation'))
      const despite = get(d, 'despiteCandidates')
      if (typeof description !== 'string' || typeof category !== 'string' || !key || amountCents === false || labor35aCents === false ||
        externalTotalCents === false || allocation === false || (despite !== undefined && typeof despite !== 'boolean')) {
        return { error: UNREADABLE }
      }
      out.push({
        idx, action: 'create', fields: { description, category, amountCents, labor35aCents, key, allocation, externalTotalCents },
        ...(despite === true ? { despiteCandidates: true } : {}),
      })
      continue
    }
    return { error: UNREADABLE }
  }
  return { decisions: out }
}
```

`known` gibt `v as T` zurück, nachdem `k === v` für einen der Schlüssel gilt; die Behauptung ist
damit eingelöst.

- [ ] **Step 7: `server/src/db/booking.ts`**

```ts
// Vorschau und Buchung einer Auswertung über die Datenbank (Belegbuchung, #170). Das Fachliche
// steht in bookingPlan.ts; hier wird gelesen, was der Planer braucht, und seine Schreibliste in
// **einer** Transaktion ausgeführt.
//
// Die Route ruft `bookAssessment` durch die Schreibschlange (`opened.write`). Lesen, Planen und
// Schreiben geschehen damit, ohne dass eine andere Anfrage dazwischenkommt; zwei gleichzeitige
// Buchungen derselben Zeile sehen nacheinander den Stand der anderen. Die zweite ist dann ohne
// Änderung oder ein Widerspruch.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AssessmentView, BookingPreview, LineDecision } from '../../../shared/types.ts'
import { describeAssessment, type BookedLine } from '../assessment.ts'
import { decide, planBooking, previewWith, tokenSource, type Planned } from '../bookingPlan.ts'
import { narrowToProperty } from '../snapshot.ts'
import type { Database } from './client.ts'
import { bookedLines, listAssessments, readAssessment, writeLine, type AssessmentRecord } from './assessments.ts'
import { readStock, type Stock } from './read.ts'
import { insertCostItemIn, patchCostItemIn } from './repository.ts'
import { uploadRows, type UploadRow } from './uploads.ts'

// Eine Ablehnung mit einer Meldung für den Nutzer; die Fehlerbehandlung in index.ts gibt sie
// unverändert weiter.
export class BookingRefusal extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const NOT_FOUND = 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
const fileGone = (name: string): string =>
  `Den Beleg „${name}“ gibt es im Belegordner nicht mehr. Die Auswertung lässt sich deshalb nicht buchen; laden Sie den Beleg bitte erneut hoch.`

type Context = { stock: Stock; booked: BookedLine[]; uploads: Map<string, UploadRow> }

async function contextOf(db: Database): Promise<Context> {
  return { stock: await readStock(db), booked: await bookedLines(db), uploads: await uploadRows(db) }
}

const exists = (uploadDir: string, file: string): boolean => {
  const full = path.join(uploadDir, path.basename(file))
  return fs.existsSync(full) && fs.statSync(full).isFile()
}
const nameOf = (ctx: Context, file: string): string => ctx.uploads.get(file)?.originalName || file

// Andere Belege mit demselben Inhalt. Eine leere Prüfsumme (noch nicht nachgetragen) trifft nichts.
function twinFilesOf(ctx: Context, file: string): string[] {
  const sha = ctx.uploads.get(file)?.sha256
  if (!sha) return []
  return [...ctx.uploads.values()].filter((u) => u.file !== file && u.sha256 === sha).map((u) => u.file)
}

const scopeOf = (ctx: Context, propertyId: string | null) => (propertyId ? narrowToProperty(ctx.stock, propertyId) : null)

function viewOf(record: AssessmentRecord, ctx: Context): AssessmentView {
  const a = record.assessment
  const scoped = scopeOf(ctx, a.propertyId)
  const twins = twinFilesOf(ctx, a.file)
  const twin = ctx.booked.find((l) => twins.includes(l.file))
  return describeAssessment(record, {
    items: scoped?.costItems ?? [],
    units: scoped?.units ?? [],
    meters: scoped?.meters ?? [],
    propertyKind: ctx.stock.properties.find((p) => p.id === a.propertyId)?.kind ?? null,
    originalName: nameOf(ctx, a.file),
    twinOf: twin ? nameOf(ctx, twin.file) : null,
  })
}

// Die Auswertungen eines Objekts, ohne die, deren Datei nicht mehr im Belegordner liegt.
export async function viewAssessments(db: Database, propertyId: string, openOnly: boolean, uploadDir: string): Promise<AssessmentView[]> {
  const ctx = await contextOf(db)
  return (await listAssessments(db, propertyId))
    .filter((r) => exists(uploadDir, r.assessment.file))
    .map((r) => viewOf(r, ctx))
    .filter((v) => !openOnly || v.open)
}

export async function viewAssessment(db: Database, id: string, uploadDir: string): Promise<AssessmentView> {
  const record = await readAssessment(db, id)
  if (!record) throw new BookingRefusal(404, NOT_FOUND)
  const ctx = await contextOf(db)
  if (!exists(uploadDir, record.assessment.file)) throw new BookingRefusal(404, fileGone(nameOf(ctx, record.assessment.file)))
  return viewOf(record, ctx)
}

export async function viewRecord(db: Database, record: AssessmentRecord): Promise<AssessmentView> {
  return viewOf(record, await contextOf(db))
}

async function plannedFor(db: Database, id: string, decisions: readonly LineDecision[], uploadDir: string, newId: () => string) {
  const record = await readAssessment(db, id)
  if (!record) throw new BookingRefusal(404, NOT_FOUND)
  const ctx = await contextOf(db)
  if (!exists(uploadDir, record.assessment.file)) throw new BookingRefusal(404, fileGone(nameOf(ctx, record.assessment.file)))
  const scoped = scopeOf(ctx, record.assessment.propertyId)
  const planned = planBooking({
    assessment: record.assessment, lines: record.lines, items: ctx.stock.costItems, booked: ctx.booked,
    units: scoped?.units ?? [], twinFiles: twinFilesOf(ctx, record.assessment.file),
  }, decisions, newId)
  return { record, ctx, planned }
}

const tokenOf = (p: Planned): string => crypto.createHash('sha256').update(tokenSource(p)).digest('hex')

export async function previewBooking(db: Database, id: string, decisions: readonly LineDecision[], uploadDir: string): Promise<BookingPreview> {
  // Die Kennungen neuer Positionen gehen nicht in die Marke ein; hier entsteht keine.
  const { planned } = await plannedFor(db, id, decisions, uploadDir, () => 'vorschau')
  return previewWith(planned, tokenOf(planned))
}

export type BookingOutcome =
  | { kind: 'done'; changed: boolean; preview: BookingPreview }
  | { kind: 'refused'; preview: BookingPreview }
  | { kind: 'conflict'; message: string }
  | { kind: 'stale'; preview: BookingPreview }

export async function bookAssessment(
  db: Database, id: string, decisions: readonly LineDecision[], token: string, options: { uploadDir: string; newId: () => string },
): Promise<BookingOutcome> {
  const { record, ctx, planned } = await plannedFor(db, id, decisions, options.uploadDir, options.newId)
  const preview = previewWith(planned, tokenOf(planned))
  const decision = decide(planned, decisions.length, token, preview.token)
  if (decision === 'conflict') return { kind: 'conflict', message: planned.conflicts.join(' ') }
  if (decision === 'unchanged') return { kind: 'done', changed: false, preview }
  if (decision === 'refused') return { kind: 'refused', preview }
  if (decision === 'stale') return { kind: 'stale', preview }
  const items = new Map(ctx.stock.costItems.map((i) => [i.id, i]))
  await db.transaction(async (tx) => {
    for (const w of planned.writes) {
      if (w.kind === 'createItem') {
        await insertCostItemIn(tx, w.id, w.body)
      } else if (w.kind === 'updateItem') {
        const current = items.get(w.id)
        if (!current) throw new BookingRefusal(409, 'Eine Position ist während der Buchung verschwunden. Bitte laden Sie die Seite neu.')
        await patchCostItemIn(tx, current, w.patch)
      } else {
        await writeLine(tx, record.assessment.id, w.idx, w.change)
      }
    }
  })
  return { kind: 'done', changed: true, preview }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/booking.test.ts`
Expected: PASS (21 Tests).

- [ ] **Step 9: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add shared/types.ts server/src/assessment.ts server/src/bookingPlan.ts server/src/db/booking.ts server/src/db/repository.ts server/test/booking.test.ts
git commit -m "$(cat <<'EOF'
Belegbuchung: Planen und Buchen auf dem Server

Ein reiner Planer berechnet aus dem gespeicherten Stand die Vorschau und die
Schreibliste: Summenregel über alle Zeilen einer Position, §35a nach
derselben Regel, Gutschrift nie verrechnet, kein Ein-Klick-Verknüpfen bei
Einzelbeträgen und Gemeinschaftsabrechnung, Ziele nur in Objekt und Jahr der
Auswertung. Gebucht wird in einer Transaktion durch die Schreibschlange;
eine Zeile wird nie zweimal gebucht, und eine Prüfmarke bindet die Buchung
an die gezeigte Vorschau.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 4: Routen — Auswertung speichern, abrufen, planen, buchen

**Files:**
- Modify: `shared/types.ts` (`ExtractResult`, `IntakeResult`), `server/src/index.ts` (KI-Routen, neue Routen, Fehlerbehandlung), `client/src/pages/Kosten.tsx` (Objekt und Jahr an die KI), `client/src/pages/Schnellerfassung.tsx` (Objekt und Jahr immer mit)
- Modify (Test): `server/test/api.test.ts` (nachgebautes Ollama mit Belegen, neue Tests am Ende)
- Create (Test): `client/src/pages/kostenKiZiel.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`saveAssessment`, `placeAssessment`, `linesFromExtraction`, `detectedYear`), Task 3 (`parseDecisions`, `BookingRefusal`, `viewAssessments`, `viewAssessment`, `viewRecord`, `previewBooking`, `bookAssessment`)
- Produces (HTTP):
  - `POST /api/extract` → `{ file, extraction, assessment: AssessmentView | null, stats }`; `POST /api/intake` (Rechnung) → `{ file, kind: 'rechnung', extraction, assessment, stats }`
  - `GET /api/assessments?property=…&open=1` → `AssessmentView[]`
  - `GET /api/assessments/:id` → `AssessmentView` (404 mit Satz)
  - `PUT /api/assessments/:id` Rumpf `{ year?, propertyId? }` → `AssessmentView` (404, 409 bei gebuchter Zeile und Objektwechsel)
  - `POST /api/assessments/:id/plan` Rumpf `{ decisions: LineDecision[] }` → `BookingPreview`
  - `POST /api/assessments/:id/book` Rumpf `{ decisions, token }` → 200 `{ changed, assessment, preview }` | 400 `{ error, preview }` | 409 `{ error, assessment }` (anders gebucht) | 409 `{ error, preview }` (Stand geändert)
  - `shared/types.ts`: `type ExtractResult = { file: string; extraction: Extraction; assessment: AssessmentView | null }`; `IntakeResult` Rechnung um `assessment: AssessmentView | null`

- [ ] **Step 1: Nachgebautes Ollama mit Belegen und die failing tests**

In `server/test/api.test.ts`:

1. Den Typ der Optionen erweitern und eine Rechnung beschreiben:

```ts
// Eine erfundene Rechnung für die Belegbuchung (#170). Das nachgebaute Ollama wählt sie, wenn ihr
// Kennwort im Text der Anfrage steht, und beantwortet den Durchgang der Kostenarten mit ihren.
type FakeInvoice = {
  vendor: string
  invoiceDate?: string
  totalGrossEur?: number
  positions: { description: string, category: string, amountEur: number | null, labor35aEur?: number | null }[]
}
```

`FakeOllamaOptions` und `WithOllamaOptions` bekommen `invoices?: Record<string, FakeInvoice>`;
`fakeOllama({ …, invoices })` übernimmt es, `withOllama(fn, { …, invoices })` reicht es an
`fakeOllama({ models, chat, invoices })` weiter.

2. In `fakeOllama` vor `const content = JSON.stringify(` einfügen

```ts
      // Belegbuchung (#170): die Rechnung, deren Kennwort in der Anfrage steht. Der Durchgang
      // der Kostenarten nennt die Positionen nicht beim Kennwort, er bekommt die zuletzt gewählte.
      const chosen = invoices ? Object.entries(invoices).find(([marker]) => JSON.stringify(json.messages ?? []).includes(marker))?.[1] : undefined
      if (chosen) state.lastInvoice = chosen
```

mit `state` erweitert zu `const state: { closedEarly: number, lastInvoice: FakeInvoice | null } = { closedEarly: 0, lastInvoice: null }`,
und im Ausdruck für `content` die Zweige für Kostenarten und Rechnung so ändern:

```ts
        : json.format?.properties?.categories
          ? { categories: invoices && state.lastInvoice ? state.lastInvoice.positions.map((p) => p.category) : ['Wasser/Abwasser'] }
          : chosen
            ? chosen
            : chat === 'offSchema'
```

(der Rest des Ausdrucks bleibt).

3. Am Ende der Datei anfügen:

```ts
// ---------- Belegbuchung (#170): die Routen ----------

const RECHNUNGEN: Record<string, FakeInvoice> = {
  GRUNDSTEUER: { vendor: 'Stadt Musterstadt', invoiceDate: '2025-02-15', totalGrossEur: 612.4, positions: [{ description: 'Grundsteuer B 2025', category: 'Grundsteuer', amountEur: 612.4 }] },
  WASSER: {
    vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-02-01', totalGrossEur: 1500,
    positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }],
  },
}

type Evaluated = { file: string, assessment: AssessmentView | null }

// Wie der Browser: ein PDF mit Textebene an /api/extract, ohne Strom. `marker` wählt die Rechnung.
async function evaluate(s: Server, marker: string, extra: Record<string, string> = {}): Promise<Evaluated> {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
  fd.append('pdfText', `Rechnung ${marker}: Positionen wie aufgeführt, Betrag in Euro, zahlbar binnen 14 Tagen.`)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}
const postJson = (s: Server, urlPath: string, body: unknown): Promise<Response> =>
  fetch(`${s.base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const assessmentOf = (e: Evaluated): AssessmentView => e.assessment ?? assert.fail('keine Auswertung gespeichert')
const grundsteuer = (a: AssessmentView): LineDecision[] =>
  [{ idx: 0, action: 'create', fields: a.lines[0]?.suggestion?.fields ?? assert.fail('kein Vorschlag') }]

test('Belegbuchung: Auswerten speichert die Auswertung mit Vorschlag; nach dem Neuladen ist sie offen abrufbar', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.equal(a.year, 2026, 'das Jahr aus dem Beleg geht vor dem gewählten')
    assert.equal(a.propertyId, 'objekt-1', 'mit einem Objekt gilt dieses')
    assert.deepEqual(a.lines.map((l) => [l.description, l.amountCents, l.state, l.suggestion?.preselected]), [
      ['Frischwasser', 70000, 'open', true], ['Abwasser', 80000, 'open', true],
    ])
    const offen = await s.api<AssessmentView[]>('/api/assessments?open=1')
    assert.deepEqual(offen.map((x) => x.id), [a.id])
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).file, a.file)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: eine gescheiterte Auswertung speichert nichts', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'fehler.pdf')
    fd.append('pdfText', 'Rechnung WASSER')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
    assert.equal(res.status, 502)
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments'), [])
  }, { invoices: RECHNUNGEN, chat: 'error' })
})

test('Belegbuchung: Doppelklick und zwei Tabs zugleich ergeben eine Position', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.deepEqual(preview.errors, [])
    const [x, y] = await Promise.all([
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
    ])
    assert.deepEqual([x.status, y.status], [200, 200])
    const changed = [(await jsonOf<{ changed: boolean }>(x)).changed, (await jsonOf<{ changed: boolean }>(y)).changed].sort()
    assert.deepEqual(changed, [false, true])
    const again = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
    assert.equal((await jsonOf<{ changed: boolean }>(again)).changed, false, 'eine Wiederholung nach einem Netzfehler bucht nicht noch einmal')
    const items = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(items.map((i) => [i.amountCents, i.invoiceFile]), [[61240, a.file]])
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [], 'gebucht ist nicht mehr offen')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ohne Vorschau keine Buchung; anders gebucht ergibt 409 mit dem Stand; Unlesbares 400', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions })).status, 400)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: [{ idx: 0, action: 'zaubern' }] })).status, 400)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
    const anders = await postJson(s, `/api/assessments/${a.id}/book`, { decisions: [{ idx: 0, action: 'dismiss' }], token: 'egal' })
    assert.equal(anders.status, 409)
    const body = await jsonOf<{ error: string, assessment: AssessmentView }>(anders)
    assert.match(body.error, /schon gebucht/)
    assert.equal(body.assessment.lines[0]?.state, 'created')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: gebucht wird im Objekt der Auswertung, nicht im gewählten; ihr Objekt ist danach fest', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal(a.propertyId, 'objekt-1')
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan?property=${zweites.id}`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book?property=${zweites.id}`, { decisions, token: preview.token })).status, 200)
    assert.equal((await s.api<CostItem[]>('/api/costItems?property=objekt-1')).length, 1)
    assert.equal((await s.api<CostItem[]>(`/api/costItems?property=${zweites.id}`)).length, 0)
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: zweites.id }) })
    assert.equal(put.status, 409)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ist die Datei weg, fehlt die Auswertung in der Liste, und Vorschau wie Buchung antworten 404', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    fs.rmSync(path.join(s.dataDir, 'uploads', a.file))
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [])
    const plan = await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: grundsteuer(a) })
    assert.equal(plan.status, 404)
    assert.match((await jsonOf<{ error: string }>(plan)).error, /gibt es im Belegordner nicht mehr/)
  }, { invoices: RECHNUNGEN })
})
```

Die Typimporte oben in `api.test.ts` um `AssessmentView, BookingPreview, LineDecision, Property`
aus `../../shared/types.ts` ergänzen (`CostItem` ist schon da; sonst ebenfalls ergänzen).

`client/src/pages/kostenKiZiel.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die KI-Auswertung schickt Objekt und Jahr mit (Belegbuchung, #170). Ein nicht gebuchter Beleg
// steht dann im Posteingang des richtigen Objekts statt „ohne Objekt“, und die Auswertung bekommt
// ein Jahr, wenn der Beleg keines nennt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const YEAR = new Date().getFullYear() - 1
let sent: FormData[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/extract' || url === '/api/intake') {
      if (init?.body instanceof FormData) sent.push(init.body)
      return json({ file: 'beleg.jpg', kind: 'rechnung', extraction: { positions: [] }, assessment: null })
    }
    if (url.split('?')[0] === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function upload(container: HTMLElement) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'beleg.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(sent).toHaveLength(1))
}

test('Kosten: die KI-Auswertung schickt Objekt und Jahr mit', async () => {
  const { container } = render(<YearProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></YearProvider>)
  await upload(container)
  expect(sent[0]?.get('propertyId')).toBe('objekt-1')
  expect(sent[0]?.get('year')).toBe(String(YEAR))
})

test('Schnellerfassung: ebenso, auch für einen Beleg aus dem Posteingang', async () => {
  const { container } = render(<YearProvider><PropertyProvider><Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} /></PropertyProvider></YearProvider>)
  await upload(container)
  expect(sent[0]?.get('propertyId')).toBe('objekt-1')
  expect(sent[0]?.get('year')).toBe(String(YEAR))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "Belegbuchung" test/api.test.ts`
Expected: FAIL (`keine Auswertung gespeichert` bzw. 404 auf `/api/assessments`).

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- kostenKiZiel`
Expected: FAIL (`year` fehlt bei Kosten).

- [ ] **Step 3: Typen der Antworten in `shared/types.ts`**

`IntakeResult` ersetzen und `ExtractResult` daneben stellen:

```ts
// Antwort von /api/extract. `assessment` ist die gespeicherte Auswertung (Belegbuchung, #170);
// `null`, wenn sie sich nicht speichern ließ.
export type ExtractResult = { file: string; extraction: Extraction; assessment: AssessmentView | null }

// Antwort von /api/intake: erkennt automatisch Rechnung vs. Zählerfoto
export type IntakeResult = { file: string } & (
  | { kind: 'rechnung'; extraction: Extraction; assessment: AssessmentView | null }
  | { kind: 'zaehler'; reading: MeterReadingExtraction }
)
```

- [ ] **Step 4: Routen in `server/src/index.ts`**

Importe ergänzen:

```ts
import type { AiSettings, AiSlotName, AiStatus, AssessmentView, Extraction, Settings } from '../../shared/types.ts'
import { detectedYear, linesFromExtraction } from './assessment.ts'
import { parseDecisions } from './bookingPlan.ts'
import { placeAssessment, saveAssessment } from './db/assessments.ts'
import { BookingRefusal, bookAssessment, previewBooking, viewAssessment, viewAssessments, viewRecord } from './db/booking.ts'
```

Nach `markMeterPhoto` einfügen:

```ts
// Die Auswertung speichern (Belegbuchung, #170), erst nach Erfolg der KI; ein Abbruch speichert
// nichts. Objekt: das des Belegs im Posteingang, sonst das mitgeschickte, sonst bei einem einzigen
// Objekt dieses. Jahr: aus dem Beleg, sonst das mitgeschickte, sonst das des Belegs, sonst das
// laufende. Misslingt das Speichern, kommt das Ergebnis trotzdem an, nur ohne Auswertung; die
// Oberfläche sagt dann, dass sich nichts buchen lässt.
async function rememberAssessment(req: Request, file: DocumentSource, extraction: Extraction): Promise<AssessmentView | null> {
  const body = bodyObject(req)
  const sent = yearOf(body.year)
  try {
    return await writeData(async (db) => {
      const row = (await uploadRows(db)).get(file.filename)
      const properties = await listProperties(db)
      const asked = typeof body.propertyId === 'string' && properties.some((p) => p.id === body.propertyId) ? body.propertyId : null
      const [only, ...more] = properties
      const detected = detectedYear(extraction)
      const record = await saveAssessment(db, {
        file: file.filename,
        propertyId: row?.propertyId ?? asked ?? (only && more.length === 0 ? only.id : null),
        year: detected ?? (sent || null) ?? row?.year ?? new Date().getUTCFullYear(),
        detectedYear: detected,
        vendor: extraction.vendor ?? null,
        invoiceDate: isDateOnly(extraction.invoiceDate) ? extraction.invoiceDate : null,
        totalGrossCents: typeof extraction.totalGrossEur === 'number' ? Math.round(extraction.totalGrossEur * 100) : null,
        amountsAdjusted: extraction.amountsAdjusted ?? null,
        laborFromTotal: extraction.laborFromTotal === true,
        lines: linesFromExtraction(extraction),
      }, { id: newId(), now: new Date().toISOString() })
      return viewRecord(db, record)
    })
  } catch (err) {
    console.warn(`Die Auswertung zu ${file.filename} ließ sich nicht speichern: ${messageOf(err)}`)
    return null
  }
}
```

In `/api/extract` nach `await rememberInvoiceDate(…)`:

```ts
    const assessment = await rememberAssessment(req, file, result)
    answer.done({ file: file.filename, extraction: result, assessment, stats })
```

In `/api/intake` im Zweig Rechnung entsprechend:

```ts
      const assessment = await rememberAssessment(req, file, extraction)
      answer.done({ file: file.filename, kind: 'rechnung', extraction, assessment, stats })
```

Vor dem Abschnitt „Belegordner (#170)“ (`app.get('/api/uploads', …)`) einfügen:

```ts
// ---------- Belegbuchung (#170) ----------
//
// Vorschau und Buchung einer gespeicherten Auswertung. Gebucht wird **immer im Objekt der
// Auswertung**, nie im Objekt, das die Oberfläche gerade zeigt: Ein Tab, der noch auf einem
// anderen Objekt steht, bucht sonst ins falsche Haus. `?property=` gilt deshalb nur für die Liste.
const decisionsFrom = (req: Request) => {
  const parsed = parseDecisions(bodyObject(req).decisions)
  if ('error' in parsed) throw new RouteProblem(400, parsed.error)
  return parsed.decisions
}

app.get('/api/assessments', async (req, res) => {
  res.json(await readData(async (db) => viewAssessments(db, await propertyOf(db, req), req.query.open === '1', UPLOAD_DIR)))
})

app.get('/api/assessments/:id', async (req, res) => {
  res.json(await readData((db) => viewAssessment(db, req.params.id, UPLOAD_DIR)))
})

app.put('/api/assessments/:id', async (req, res) => {
  const body = bodyObject(req)
  res.json(await writeData(async (db) => {
    const change: { year?: number, propertyId?: string | null } = {}
    if (Object.hasOwn(body, 'year')) {
      const year = yearOf(body.year)
      if (year === false || year === null) throw new RouteProblem(400, 'Das Jahr muss eine ganze Zahl sein, etwa 2025.')
      change.year = year
    }
    if (Object.hasOwn(body, 'propertyId')) change.propertyId = await placementProperty(db, body.propertyId)
    const placed = await placeAssessment(db, req.params.id, change)
    if (placed === 'missing') throw new RouteProblem(404, 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    if (placed === 'booked') throw new RouteProblem(409, 'Zeilen dieses Belegs sind schon gebucht. Das Objekt lässt sich deshalb nicht mehr ändern; lösen Sie die Zeilen zuerst.')
    return viewAssessment(db, req.params.id, UPLOAD_DIR)
  }))
})

app.post('/api/assessments/:id/plan', async (req, res) => {
  const decisions = decisionsFrom(req)
  res.json(await readData((db) => previewBooking(db, req.params.id, decisions, UPLOAD_DIR)))
})

app.post('/api/assessments/:id/book', async (req, res) => {
  const decisions = decisionsFrom(req)
  const token: unknown = bodyObject(req).token
  if (typeof token !== 'string' || token === '') {
    throw new RouteProblem(400, 'Gebucht wird nur, was die Vorschau gezeigt hat. Bitte zeigen Sie zuerst die Vorschau an.')
  }
  const { outcome, assessment } = await writeData(async (db) => {
    const result = await bookAssessment(db, req.params.id, decisions, token, { uploadDir: UPLOAD_DIR, newId })
    return { outcome: result, assessment: await viewAssessment(db, req.params.id, UPLOAD_DIR) }
  })
  if (outcome.kind === 'done') return res.json({ changed: outcome.changed, assessment, preview: outcome.preview })
  if (outcome.kind === 'refused') {
    const message = [...outcome.preview.errors, ...outcome.preview.confirm].map((p) => p.message).join(' ')
    return res.status(400).json({ error: message, preview: outcome.preview })
  }
  if (outcome.kind === 'conflict') return res.status(409).json({ error: outcome.message, assessment })
  res.status(409).json({ error: 'Seit der Vorschau hat sich der Stand geändert. Bitte prüfen Sie die neue Vorschau und buchen Sie dann.', preview: outcome.preview })
})
```

In der Fehlerbehandlung die Zeile mit `RouteProblem || CrossPropertyError || TenantChangeError`
um `|| err instanceof BookingRefusal` ergänzen.

- [ ] **Step 5: Objekt und Jahr aus dem Browser**

`client/src/pages/Kosten.tsx`, im Effekt der Warteschlange nach `const fd = await buildUpload(…)`:

```ts
        // Bleibt der Beleg ungebucht, steht er im Posteingang dieses Objekts; nennt er kein Jahr,
        // gilt das gewählte (#170).
        if (propertyId) fd.append('propertyId', propertyId)
        fd.append('year', String(year))
```

`client/src/pages/Schnellerfassung.tsx`, dort den Block `if (existing) { … } else if (propertyId) { … }` ersetzen durch:

```ts
        if (existing) {
          // Schon im Belegordner: nur der Name, sonst läge er danach doppelt dort (#170)
          fd.delete('file')
          fd.append('existingFile', existing)
        }
        // Objekt und Jahr für die Auswertung (#170); ein neuer Beleg steht damit im Posteingang
        // dieses Objekts, falls er ungebucht bleibt.
        if (propertyId) fd.append('propertyId', propertyId)
        fd.append('year', String(year))
```

`year` steht in beiden Effekten noch nicht in der Abhängigkeitsliste; das ist hier unschädlich,
weil App.tsx die Seiten je Objekt **und Jahr** neu aufstellt.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "Belegbuchung" test/api.test.ts`
Expected: PASS (6 Tests).

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- kostenKiZiel intakeInbox aiCancel`
Expected: PASS.

- [ ] **Step 7: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add shared/types.ts server/src/index.ts server/test/api.test.ts client/src/pages/Kosten.tsx client/src/pages/Schnellerfassung.tsx client/src/pages/kostenKiZiel.test.tsx
git commit -m "$(cat <<'EOF'
Belegbuchung: Routen zum Speichern, Abrufen, Planen und Buchen

/api/extract und /api/intake speichern die Auswertung nach Erfolg und
liefern sie mit Vorschlägen zurück. Neu: GET /api/assessments (offene je
Objekt), GET/PUT /api/assessments/:id, POST …/plan und …/book. Gebucht wird
im Objekt der Auswertung; eine Buchung ohne Vorschau, auf geändertem Stand
oder für eine anders gebuchte Zeile wird abgelehnt. Kosten und
Schnellerfassung schicken Objekt und Jahr mit.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 5: Posteingang, Belegordner und Belegabdeckung kennen verknüpfte Zeilen

**Files:**
- Modify: `shared/types.ts` (`UploadLinks`, `UploadEntry`), `server/src/db/assessments.ts` (`uploadLinks`), `server/src/db/repository.ts` (`invoiceFilesInUse`), `server/src/index.ts` (`GET`/`DELETE /api/uploads`), `client/src/receipts.ts`, `client/src/pages/Belege.tsx`, `client/src/pages/Cockpit.tsx`, `client/src/App.tsx`
- Test: `server/test/api.test.ts` (ein Test am Ende), `client/src/receipts.test.ts` (neue `describe`), `client/src/pages/Belege.test.tsx` (ein Test)

**Interfaces:**
- Consumes: Task 2 (`assessments`, `assessmentLines`, `forgetAssessment`), Task 4 (Routen, `evaluate`, `postJson`, `RECHNUNGEN` in api.test.ts)
- Produces:
  - `shared/types.ts`: `type UploadLinks = { bookedItemIds: string[]; assessment: { id: string; propertyId: string | null; open: boolean } | null }`, `type UploadEntry = UploadInfo & UploadLinks`
  - `server/src/db/assessments.ts`: `uploadLinks(db: Executor): Promise<Map<string, UploadLinks>>`
  - `client/src/receipts.ts`: `type ReceiptUpload = UploadInfo & Partial<UploadLinks>`; `receiptCards(uploads: ReceiptUpload[], items)`, `buildFolder(uploads: ReceiptUpload[], …)`, `filesByItem(uploads: ReceiptUpload[]): Map<string, string[]>`, `coverage(items, filter, present, booked?: ReadonlyMap<string, readonly string[]>)`, `coverageCheck(yearItems, present?, booked?)`
  - `client/src/pages/Belege.tsx`: neue Eigenschaft `onContinue?: (upload: ReceiptUpload) => void`

- [ ] **Step 1: Write the failing tests**

In `server/test/api.test.ts` zu `RECHNUNGEN` hinzufügen:

```ts
  NACHTRAG: { vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-03-01', totalGrossEur: 120, positions: [{ description: 'Nachberechnung Abwasser', category: 'Wasser/Abwasser', amountEur: 120 }] },
```

und am Ende anfügen (Typimport um `UploadEntry` ergänzen):

```ts
test('Belegbuchung: der Belegordner kennt gebuchte Zeilen; Löschen der Position öffnet beide Belege wieder', async () => {
  await withOllama(async (s) => {
    const st = await jsonOf<CostItem>(await postJson(s, '/api/costItems', { year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' }))
    const a = assessmentOf(await evaluate(s, 'WASSER'))
    const b = assessmentOf(await evaluate(s, 'NACHTRAG'))
    const book = async (x: AssessmentView, decisions: LineDecision[]) => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${x.id}/plan`, { decisions }))
      const res = await postJson(s, `/api/assessments/${x.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
    }
    await book(a, [{ idx: 0, action: 'link', costItemId: st.id }, { idx: 1, action: 'link', costItemId: st.id }])
    await book(b, [{ idx: 0, action: 'link', costItemId: st.id }])
    const entry = async (file: string): Promise<UploadEntry> =>
      (await s.api<UploadEntry[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`kein Beleg ${file}`)
    assert.deepEqual([(await entry(b.file)).bookedItemIds, (await entry(b.file)).assessment?.open], [[st.id], false])
    const [position] = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual([position?.amountCents, position?.invoiceFile], [162000, a.file], 'Summe beider Belege, die Position trägt den ersten')
    const del = (file: string) => fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal((await del(b.file)).status, 409, 'ein Beleg mit gebuchter Zeile lässt sich nicht löschen')
    assert.equal((await fetch(`${s.base}/api/costItems/${st.id}`, { method: 'DELETE' })).status, 200)
    for (const f of [a.file, b.file]) {
      const e = await entry(f)
      assert.deepEqual([e.bookedItemIds, e.assessment?.open], [[], true], `${f} ist wieder offen`)
    }
    assert.equal((await del(b.file)).status, 200)
    assert.equal((await fetch(`${s.base}/api/assessments/${b.id}`)).status, 404, 'die Auswertung geht mit dem Beleg')
  }, { invoices: RECHNUNGEN })
})
```

In `client/src/receipts.test.ts` den Import um `filesByItem` ergänzen und anfügen:

```ts
describe('Belegbuchung (#170): Belege, die über eine verknüpfte Zeile an einer Position hängen', () => {
  const abschlag = upload('1_abschlag.pdf')
  const rest = { ...upload('2_rest.pdf'), bookedItemIds: ['st'], assessment: { id: 'a2', propertyId: 'p1', open: false } }
  const offen = { ...upload('3_offen.pdf'), bookedItemIds: [], assessment: { id: 'a3', propertyId: 'p1', open: true } }
  const st = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '1_abschlag.pdf', amountCents: 80000 })

  it('die Karte nennt die Position, und der Beleg steht nicht im Posteingang', () => {
    const cards = receiptCards([abschlag, rest, offen], [st])
    expect(cards.find((c) => c.upload.file === '2_rest.pdf')?.items.map((i) => i.id)).toEqual(['st'])
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).here.map((c) => c.upload.file)).toEqual(['3_offen.pdf'])
  })

  it('im Register stehen beide Belege der Position', () => {
    const folder = buildFolder([abschlag, rest], [st], { propertyId: 'all', year: 'all' }, '')
    expect(folder.groups[0]?.cards.map((c) => c.upload.file)).toEqual(['1_abschlag.pdf', '2_rest.pdf'])
    expect(folder.groups[0]?.missing).toEqual([])
  })

  it('zählt für die Belegabdeckung wie der Beleg der Position, auch wenn dessen Datei fehlt', () => {
    const ohneEigene = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '9_weg.pdf', amountCents: 80000 })
    const present = new Set(['2_rest.pdf'])
    expect(coverage([ohneEigene], { propertyId: 'all', year: 'all' }, present).covered).toBe(0)
    expect(coverage([ohneEigene], { propertyId: 'all', year: 'all' }, present, filesByItem([rest])).covered).toBe(1)
    expect(coverageCheck([ohneEigene], present, filesByItem([rest])).level).toBe('gruen')
  })
})
```

In `client/src/pages/Belege.test.tsx` anfügen:

```tsx
test('Posteingang (#170): ein Beleg mit offener Auswertung heißt „Weiter prüfen“ und führt zur Prüfung', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }]
  const onContinue = vi.fn()
  render(
    <YearProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} onEvaluate={() => {}} onContinue={onContinue} />
      </PropertyProvider>
    </YearProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'offen.pdf weiter prüfen' }))
  expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ file: '5_offen.pdf' }))
  expect(screen.queryByRole('button', { name: 'offen.pdf per KI auswerten' })).toBeNull()
})
```

Dafür oben in der Datei `let extraUploads: UploadInfo[]` zu `let extraUploads: ReceiptUpload[]` ändern
(`import type { ReceiptUpload } from '../receipts'`); die zusätzlichen Felder kommen über die
Antwort des nachgebauten Servers wie beim echten, ohne `as`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "Belegordner kennt gebuchte" test/api.test.ts`
Expected: FAIL (`bookedItemIds` fehlt in `/api/uploads`).

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- receipts Belege.test`
Expected: FAIL (`filesByItem` nicht exportiert; Knopf „weiter prüfen“ fehlt).

- [ ] **Step 3: Server**

`shared/types.ts`, nach `UploadKind`:

```ts
// Was ein Beleg mit der Belegbuchung (#170) zu tun hat: an welchen Positionen er über gebuchte
// Zeilen hängt (zusätzlich zu `cost_items.invoice_file`) und ob er eine Auswertung hat. Der
// Belegordner liest beides aus `GET /api/uploads`.
export type UploadLinks = {
  bookedItemIds: string[]
  assessment: { id: string; propertyId: string | null; open: boolean } | null
}
export type UploadEntry = UploadInfo & UploadLinks
```

`server/src/db/assessments.ts`, Import um `UploadLinks` ergänzen und anfügen:

```ts
// Je Beleg mit Auswertung: die Positionen, an denen gebuchte Zeilen hängen, und ob noch eine Zeile
// offen ist. Belege ohne Auswertung fehlen in der Liste; für sie gilt weiter `invoice_file`.
export async function uploadLinks(db: Executor): Promise<Map<string, UploadLinks>> {
  const all = await db.select().from(assessments)
  const lines = await db.select().from(assessmentLines)
  const links = new Map<string, UploadLinks>()
  for (const a of all) {
    const own = lines.filter((l) => l.assessmentId === a.id)
    links.set(a.file, {
      bookedItemIds: [...new Set(own.flatMap((l) => (l.costItemId ? [l.costItemId] : [])))],
      assessment: { id: a.id, propertyId: a.propertyId, open: own.some((l) => l.costItemId === null && !l.dismissed) },
    })
  }
  return links
}
```

`server/src/db/repository.ts`, `invoiceFilesInUse` ersetzen (Importe um `assessmentLines`, `assessments`, `isNotNull` ergänzen):

```ts
// Beim Löschen eines Belegs fragt die Route, ob er noch an einer Kostenposition hängt: über
// `invoice_file` oder über eine gebuchte Zeile seiner Auswertung (Belegbuchung, #170). Ein
// Beleg, der nur so an einer Position hängt, belegt sie genauso.
export async function invoiceFilesInUse(db: Database, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set()
  const direct = await db.select({ file: costItems.invoiceFile }).from(costItems).where(inArray(costItems.invoiceFile, files))
  const booked = await db.select({ file: assessments.file }).from(assessmentLines)
    .innerJoin(assessments, eq(assessments.id, assessmentLines.assessmentId))
    .where(and(inArray(assessments.file, files), isNotNull(assessmentLines.costItemId)))
  return new Set([...direct, ...booked].map((r) => r.file).filter((file) => file !== null))
}
```

`server/src/index.ts`, Import `forgetAssessment, uploadLinks` aus `./db/assessments.ts` ergänzen,
`UploadEntry`/`UploadLinks` aus den Typen, und `GET /api/uploads` ersetzen:

```ts
const NO_LINKS: UploadLinks = { bookedItemIds: [], assessment: null }

app.get('/api/uploads', async (req, res) => {
  const rows = await readData(uploadRows).catch(() => null)
  // Ohne Datenbank bleibt die Liste vollständig, nur ohne Posteingang und ohne Buchungen.
  const links = await readData(uploadLinks).catch(() => new Map<string, UploadLinks>())
  const list: UploadEntry[] = describeFolder(UPLOAD_DIR, rows ?? new Map<string, UploadRow>())
    .map((u) => ({ ...u, ...(links.get(u.file) ?? NO_LINKS) }))
  if (rows && list.some((u) => !u.sha256)) void backfillUploads()
  res.json(list)
})
```

In `DELETE /api/uploads/:file` die Zeile mit `forgetUpload` ersetzen durch:

```ts
  // Die Angaben und eine Auswertung gehen mit (#170); gebucht ist keine ihrer Zeilen, das hat
  // `invoiceFilesInUse` eben gesagt. Scheitert das, bleibt eine Zeile ohne Datei, und die zeigt
  // niemand an (`GET /api/assessments` übergeht Auswertungen ohne Datei).
  await writeData(async (db) => {
    await forgetUpload(db, name)
    await forgetAssessment(db, name)
  }).catch((err: unknown) => console.warn(`Angaben zu ${name} nicht entfernt: ${messageOf(err)}`))
```

- [ ] **Step 4: Client**

`client/src/receipts.ts`:

```ts
import type { CostItem, UploadInfo, UploadLinks } from './types'

// Ein Beleg, wie GET /api/uploads ihn liefert. Die Angaben der Belegbuchung (#170) fehlen bei
// einem älteren Server und in Tests, die sie nicht brauchen.
export type ReceiptUpload = UploadInfo & Partial<UploadLinks>
```

`ReceiptCard.upload` wird `ReceiptUpload`; `receiptCards(uploads: ReceiptUpload[], items)` sammelt
die Positionen über beide Wege:

```ts
  return uploads.map((upload) => {
    const linked = [...(byFile.get(upload.file) ?? [])]
    // Über gebuchte Zeilen der Auswertung (#170): Der zweite Beleg einer Position, etwa die
    // Restrechnung neben dem Abschlag, hängt an ihr, ohne ihr `invoiceFile` zu sein.
    for (const id of upload.bookedItemIds ?? []) {
      const c = items.find((i) => i.id === id)
      if (c && !linked.includes(c)) linked.push(c)
    }
    return {
      upload,
      items: linked,
      vendor: linked.find((c) => c.vendor)?.vendor ?? null,
      amountCents: linked.reduce((a, c) => a + c.amountCents, 0),
      propertyIds: [...new Set(linked.map((c) => c.propertyId))],
      years: [...new Set(linked.map((c) => c.year))].sort((a, b) => b - a),
    }
  })
```

`buildFolder(uploads: ReceiptUpload[], …)`: nach `const cardByFile = …` einfügen

```ts
  const cardsByItem = new Map<string, ReceiptCard[]>()
  for (const card of cards) for (const id of card.upload.bookedItemIds ?? []) cardsByItem.set(id, [...(cardsByItem.get(id) ?? []), card])
```

und in der Schleife über `items` den Block ab `const card = c.invoiceFile ? …` ersetzen durch:

```ts
    const own = c.invoiceFile ? cardByFile.get(c.invoiceFile) : undefined
    const all = [...(own ? [own] : []), ...(cardsByItem.get(c.id) ?? []).filter((x) => x !== own)]
    if (all.length === 0) {
      // Ohne Beleg, oder der verknüpfte Beleg liegt nicht mehr im Ordner: beides fehlt.
      if (itemMatchesQuery(c, query)) g.missing.push(c)
    } else {
      for (const card of all) if (!g.cards.includes(card) && matchesQuery(card, query)) g.cards.push(card)
    }
```

Belegabdeckung:

```ts
// Je Position die Belege, die über gebuchte Zeilen an ihr hängen (#170).
export function filesByItem(uploads: readonly ReceiptUpload[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const u of uploads) for (const id of u.bookedItemIds ?? []) out.set(id, [...(out.get(id) ?? []), u.file])
  return out
}
```

`coverage(items, filter, present, booked: ReadonlyMap<string, readonly string[]> = new Map())`
mit

```ts
  // Ein Beleg, der nur über eine verknüpfte Zeile an der Position hängt, deckt sie wie ihr eigener.
  const isCovered = (c: CostItem) => [c.invoiceFile, ...(booked.get(c.id) ?? [])].some((f) => !!f && (present === null || present.has(f)))
```

und `coverageCheck(yearItems, present = null, booked: ReadonlyMap<string, readonly string[]> = new Map())`,
das `booked` an `coverage` weiterreicht.

`client/src/pages/Belege.tsx`:
- `uploads` wird `UploadEntry[]` (`api<UploadEntry[]>('/api/uploads')`), die Eigenschaft `onContinue?: (upload: UploadEntry) => void` kommt neben `onEvaluate`.
- `const booked = useMemo(() => filesByItem(uploads), [uploads])` und `coverage(…, present, booked)` in `coverageRows`.
- Den Knopf „Per KI auswerten“ ersetzen durch:

```tsx
              {upload.assessment?.open && onContinue ? (
                <button className="btn small" aria-label={`${receiptName(upload)} weiter prüfen`} onClick={() => onContinue(upload)}>Weiter prüfen</button>
              ) : onEvaluate && (
                <button className="btn small" aria-label={`${receiptName(upload)} per KI auswerten`} onClick={() => onEvaluate([upload])}>Per KI auswerten</button>
              )}
```

(`renderCard` bekommt Karten mit `upload: ReceiptUpload`; wo die Seite `UploadEntry` braucht, ist
es dasselbe Objekt aus `uploads`. Für `onContinue(upload)` reicht `ReceiptUpload`: die Eigenschaft
deshalb als `(upload: ReceiptUpload) => void` tippen und `ReceiptUpload` aus `../receipts` importieren.)

`client/src/pages/Cockpit.tsx`: `uploadFiles` neben einem `bookedFiles`-Zustand füllen:

```tsx
  const [bookedFiles, setBookedFiles] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    api<UploadEntry[]>('/api/uploads').then((list) => { setUploadFiles(new Set(list.map((u) => u.file))); setBookedFiles(filesByItem(list)) }, () => setUploadFiles(null))
  }, [year, propertyId])
```

und `coverageCheck(yearItems, uploadFiles, bookedFiles)`; `bookedFiles` in die Abhängigkeitsliste
des `useMemo` (Zeile mit `uploadFiles]`) aufnehmen.

`client/src/App.tsx`: neben `evaluateFromInbox`

```tsx
  // „Weiter prüfen“ (#170): Die Schnellerfassung zeigt die offenen Auswertungen des Objekts; dazu
  // erst auf das Objekt der Auswertung umschalten, wie beim Auswerten.
  const continueAssessment = async (u: ReceiptUpload) => {
    const target = u.assessment?.propertyId
    if (target && target !== property?.id && !(await switchProperty(target))) return
    setTab('schnellerfassung')
  }
```

und `<Belege … onContinue={(u) => void continueAssessment(u)} />`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "Belegbuchung" test/api.test.ts`
Expected: PASS (7 Tests).

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- receipts Belege belegeOpen`
Expected: PASS.

- [ ] **Step 6: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add shared/types.ts server/src/db/assessments.ts server/src/db/repository.ts server/src/index.ts server/test/api.test.ts client/src/receipts.ts client/src/receipts.test.ts client/src/pages/Belege.tsx client/src/pages/Belege.test.tsx client/src/pages/Cockpit.tsx client/src/App.tsx
git commit -m "$(cat <<'EOF'
Belegbuchung: Belegordner und Posteingang kennen gebuchte Zeilen

Ein Beleg, der nur über eine gebuchte Zeile an einer Position hängt, steht
nicht mehr im Posteingang, zählt für die Belegabdeckung und nennt die
Position auf seiner Karte; löschen lässt er sich nicht. Ein Beleg mit
offener Auswertung heißt im Posteingang „Weiter prüfen“. Löschen der
Position macht die Zeilen beider Belege wieder offen.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 6: Komponente „Auswertung prüfen“ in Schnellerfassung, Kosten und Posteingang; alte Logik entfernen

**Files:**
- Create: `client/src/assessment.ts`, `client/src/components/AssessmentReview.tsx`, `client/src/testing/fakeBooking.ts`, `client/src/assessment.test.ts`, `client/src/pages/booking.test.tsx`
- Modify: `client/src/api.ts` (`ApiError`), `client/src/components/AiKeyCell.tsx`, `client/src/pages/Schnellerfassung.tsx`, `client/src/pages/Kosten.tsx`, `client/src/triage.ts`, `client/src/costForm.ts`, `server/test/assessment.test.ts` (übernommene Tests)
- Modify (Tests): `client/src/triage.test.ts`, `client/src/costForm.memory.test.ts`, `client/src/pages/duplicates.test.tsx`, `client/src/pages/intakeInbox.test.tsx`
- Delete: `client/src/components/DuplicateNotices.tsx`, `client/src/pages/creditIntake.test.tsx`, `client/src/pages/aiAmount.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`describeAssessment`, `linesFromExtraction`, `detectedYear`, `BookedLine`, `planBooking`, `previewWith`, `tokenSource`, `decide`, `parseDecisions`, `BookingWrite`, Typen aus `shared/types.ts`), Task 4 (Routen, `ExtractResult`, `IntakeResult` mit `assessment`), Task 5 (Posteingang führt mit „Weiter prüfen“ in die Schnellerfassung)
- Produces:
  - `client/src/api.ts`: `class ApiError extends Error { status: number; data: Record<string, unknown> }` (von `api()` geworfen)
  - `client/src/assessment.ts`: `type RowAction = '' | 'create' | 'dismiss' | 'release' | \`link:${string}\``, `type RowDraft`, `initialRow(line)`, `initialRows(view)`, `fieldsOf(row): LineFields`, `decisionsOf(view, rows): LineDecision[]`, `linkChoices(line, row): LineCandidate[]`, `withConfirmed(decisions, idxs): LineDecision[]`, `greenDecisions(view): LineDecision[]`, `previewLines(p: BookingPreview): string[]`, `loadOpenAssessments(propertyId)`, `planDecisions(id, decisions)`, `type BookResult`, `bookDecisions(id, decisions, token): Promise<BookResult>`, `changeAssessmentYear(id, year)`
  - `client/src/components/AssessmentReview.tsx`: `default function AssessmentReview(props: { assessment: AssessmentView; units: Unit[]; keyContext?: KeyContext; onChange: (next: AssessmentView) => void; onOpenItem?: (costItemId: string) => void })`
  - `client/src/components/AiKeyCell.tsx`: `type KeyCellValue = { category: string; key: CostKey; allocation: Allocation | null; externalTotalAmount: string }`
  - `client/src/testing/fakeBooking.ts`: `fakeBooking(start: { items: CostItem[]; units: Unit[]; meters?: Meter[]; propertyId?: string })` mit `items`, `requests`, `patchItem(id, patch)`, `evaluate(file, extraction, { year }): AssessmentView`, `handle(url, init): Promise<Response | null>`; `type FakeBooking`

- [ ] **Step 1: Write the failing tests (Logik)**

`client/src/assessment.test.ts`:

```ts
// Die Entscheidungen der Komponente „Auswertung prüfen“ (Belegbuchung, #170), ohne DOM.
import { describe, expect, it } from 'vitest'
import type { AssessmentLine, AssessmentView, BookingPreview, LineSuggestion } from './types'
import { decisionsOf, greenDecisions, initialRow, initialRows, linkChoices, previewLines, withConfirmed } from './assessment'

const suggestion = (patch: Partial<LineSuggestion> = {}): LineSuggestion => ({
  fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'persons', allocation: null, externalTotalCents: null },
  candidates: [], level: 'gruen', reasons: [], preselected: true, ...patch,
})
const line = (idx: number, patch: Partial<AssessmentLine> = {}): AssessmentLine => ({
  idx, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null,
  booking: null, costItemId: null, dismissed: false, state: 'open', itemDescription: null, suggestion: suggestion(), ...patch,
})
const view = (lines: AssessmentLine[]): AssessmentView => ({
  id: 'a1', file: 'w.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, vendor: 'Stadtwerke', invoiceDate: null,
  totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, createdAt: '2026-10-02T00:00:00.000Z',
  originalName: 'w.pdf', lines, open: true, sumWarning: null,
})
const KANDIDAT = { id: 'wa', description: 'Wasser 2025', amountCents: 150000, invoiceFile: null, key: 'area' as const, formOnly: false }

describe('Zeilenentwurf', () => {
  it('ein vorab angehakter Vorschlag wird angelegt, sonst bleibt die Zeile offen; Beträge in deutscher Schreibweise', () => {
    expect(initialRow(line(0))).toMatchObject({ action: 'create', amount: '700,00', labor35a: '', key: 'persons' })
    expect(initialRow(line(0, { suggestion: suggestion({ preselected: false }) })).action).toBe('')
    // 0 ist eine Angabe der Rechnung und steht deshalb da, „nicht gelesen“ bleibt leer.
    expect(initialRow(line(0, { suggestion: suggestion({ fields: { ...suggestion().fields, labor35aCents: 0 } }) })).labor35a).toBe('0,00')
  })

  it('Entscheidungen: anlegen mit Cent, verknüpfen mit berichtigtem Betrag, verwerfen; lösen nur verknüpfte Zeilen', () => {
    const v = view([line(0), line(1), line(2), line(3, { state: 'linked', costItemId: 'wa', booking: 'linked', suggestion: null }), line(4, { state: 'created', costItemId: 'x', booking: 'created', suggestion: null })])
    const rows = initialRows(v)
    rows[1] = { ...rows[1], action: 'link:wa', amount: '712,40' }
    rows[2] = { ...rows[2], action: 'dismiss' }
    rows[3] = { ...rows[3], action: 'release' }
    rows[4] = { ...rows[4], action: 'release' }
    expect(decisionsOf(v, rows)).toEqual([
      { idx: 0, action: 'create', fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'persons', allocation: null, externalTotalCents: null } },
      { idx: 1, action: 'link', costItemId: 'wa', amountCents: 71240, labor35aCents: null },
      { idx: 2, action: 'dismiss' },
      { idx: 3, action: 'release' },
    ])
  })

  it('verknüpfen nur mit Positionen, deren Betrag nicht an weiteren Angaben hängt, und nie eine Gutschrift', () => {
    const l = line(0, { suggestion: suggestion({ candidates: [KANDIDAT, { ...KANDIDAT, id: 'hg', key: 'external', formOnly: true }] }) })
    expect(linkChoices(l, initialRow(l)).map((c) => c.id)).toEqual(['wa'])
    expect(linkChoices(l, { ...initialRow(l), amount: '-50,00' })).toEqual([])
  })

  it('bestätigte Rückfrage und „Alle grünen“', () => {
    const v = view([line(0), line(1, { suggestion: suggestion({ level: 'gelb' }) }), line(2, { suggestion: suggestion({ preselected: false }) })])
    expect(greenDecisions(v).map((d) => d.idx)).toEqual([0])
    expect(withConfirmed(decisionsOf(v, initialRows(v)), [1])).toEqual([
      expect.objectContaining({ idx: 0, action: 'create' }),
      expect.objectContaining({ idx: 1, action: 'create', despiteCandidates: true }),
    ])
  })
})

it('Vorschau in Sätzen: neu, geändert, unverändert, mit Lohnanteil', () => {
  const p: BookingPreview = {
    items: [
      { costItemId: null, lines: [0], description: 'Restmüll', category: 'Müllabfuhr', year: 2025, beforeCents: null, afterCents: 70000, beforeLabor35aCents: null, afterLabor35aCents: null },
      { costItemId: 'gp', lines: [1], description: 'Gartenpflege 2025', category: 'Gartenpflege', year: 2025, beforeCents: 150000, afterCents: 145000, beforeLabor35aCents: 100000, afterLabor35aCents: null },
      { costItemId: 'wa', lines: [2], description: 'Wasser 2025', category: 'Wasser/Abwasser', year: 2025, beforeCents: 150000, afterCents: 150000, beforeLabor35aCents: null, afterLabor35aCents: null },
    ],
    notices: [], errors: [], confirm: [], token: 't',
  }
  const lines = previewLines(p)
  expect(lines[0]).toMatch(/^Neu: „Restmüll“ \(Müllabfuhr\) 700,00\s€$/)
  expect(lines[1]).toMatch(/^„Gartenpflege 2025“: 1\.500,00\s€ → 1\.450,00\s€; §35a 1\.000,00\s€ → keiner$/)
  expect(lines[2]).toMatch(/^„Wasser 2025“ bleibt bei 1\.500,00\s€$/)
})
```

(`rows` ist ein `Record<number, RowDraft>`; ohne `noUncheckedIndexedAccess` ist `rows[1]` kein
`undefined`, deshalb kein `!`.)

`server/test/assessment.test.ts` bekommt die drei Fälle, die bisher `aiPositionBody` in
`client/src/costForm.memory.test.ts` prüfte (Import `costItemBody` aus `../../shared/costItem.ts`,
`lineDraft` aus `../src/assessment.ts`, `type Allocation` aus `../../shared/allocation.ts`,
`type Unit` aus `../../shared/types.ts`):

```ts
const UNITS3: Unit[] = ['u1', 'u2', 'u3'].map((id) => ({ id, propertyId: 'objekt-1', name: id.toUpperCase(), areaM2: 50, participates: true }))
const fieldsOf = (description: string, category: string, amountCents: number, key: Allocation['key'], allocation: Allocation | null, externalTotalCents: number | null = null) =>
  ({ description, category, amountCents, labor35aCents: null, key, allocation, externalTotalCents })
const ALLOC = (patch: Partial<Allocation>): Allocation => ({ key: 'area', meterType: null, directUnitId: null, customShares: null, participantUnitIds: null, externalBasis: null, ...patch })

test('Entwurf einer KI-Zeile: Teilnehmer, Beleg und Rechnungssteller wie bisher bei der KI-Übernahme', () => {
  const draft = lineDraft(fieldsOf('Aufzugswartung', 'Aufzug', 48000, 'area', ALLOC({ participantUnitIds: ['u1', 'u2'] })), { vendor: 'Lift GmbH', invoiceFile: 'b.pdf' }, UNITS3)
  const built = costItemBody(draft, UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual([built.body.key, built.body.participantUnitIds, built.body.amountCents, built.body.vendor, built.body.invoiceFile, built.body.year], ['area', ['u1', 'u2'], 48000, 'Lift GmbH', 'b.pdf', 2026])
})

test('Entwurf einer KI-Zeile: die Gemeinschaftsabrechnung verlangt die Kosten der Gemeinschaft', () => {
  const alloc = ALLOC({ key: 'external', externalBasis: { measure: 'mea', total: 1000 } })
  const ohne = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in ohne ? ohne.error : '', /Gemeinschaft/)
  const mit = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc, 12000000), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.ok('body' in mit && JSON.stringify(mit.body.externalBasis) === JSON.stringify({ measure: 'mea', total: 1000, totalCents: 12000000 }))
})

test('Entwurf einer KI-Zeile ohne Gedächtnis: nur der Schlüssel, Nebenfelder leer; 0 € ist keine Position', () => {
  const built = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 6000, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual(built.body, {
    year: 2026, category: 'Müllabfuhr', description: 'Müll', vendor: 'Stadt', amountCents: 6000, labor35aCents: undefined, key: 'persons',
    directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null,
    selfAmounts: null, invoiceFile: 'm.pdf',
  })
  const null0 = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 0, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in null0 ? null0.error : '', /0 €/)
})
```

- [ ] **Step 2: Write the failing tests (Seiten, jsdom)**

`client/src/testing/fakeBooking.ts`:

```ts
// Ein nachgebauter Server für die Belegbuchung in jsdom-Tests (#170). Er rechnet mit denselben
// Funktionen wie der echte (server/src/assessment.ts und server/src/bookingPlan.ts), nur ohne
// Datenbank. Was die Vorschau verspricht und was gebucht wird, kommt so aus dem echten Planer,
// und ein Test der Oberfläche prüft keine Fassung der Regeln, die es nur im Test gibt.
// Bewusst kein `*.test.ts`: vitest führt diese Datei nicht als Test aus.
import type { AssessmentView, CostItem, Extraction, Meter, StoredAssessment, StoredAssessmentLine, Unit } from '../types'
import { describeAssessment, detectedYear, linesFromExtraction, type BookedLine } from '../../../server/src/assessment.ts'
import { decide, parseDecisions, planBooking, previewWith, tokenSource, type BookingWrite } from '../../../server/src/bookingPlan.ts'

type Stored = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }
const fieldOf = (v: unknown, key: string): unknown => (v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined)

export type FakeBooking = ReturnType<typeof fakeBooking>

export function fakeBooking(start: { items: CostItem[]; units: Unit[]; meters?: Meter[]; propertyId?: string }) {
  const propertyId = start.propertyId ?? 'objekt-1'
  let items = [...start.items]
  const records: Stored[] = []
  const requests: { path: string; body: unknown }[] = []
  let next = 0
  const booked = (): BookedLine[] =>
    records.flatMap((r) => r.lines.filter((l) => l.costItemId !== null).map((l) => ({ ...l, file: r.assessment.file })))
  const view = (r: Stored): AssessmentView => describeAssessment(r, {
    items: items.filter((i) => i.propertyId === propertyId), units: start.units, meters: start.meters ?? [], propertyKind: 'mfh',
    originalName: r.assessment.file, twinOf: null,
  })
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  function apply(r: Stored, writes: readonly BookingWrite[]): void {
    for (const w of writes) {
      if (w.kind === 'createItem') {
        const { invoiceFile, ...rest } = w.body
        items = [...items, { ...rest, id: w.id, ...(invoiceFile ? { invoiceFile } : {}) }]
      } else if (w.kind === 'updateItem') {
        items = items.map((i) => (i.id === w.id
          ? { ...i, amountCents: w.patch.amountCents, labor35aCents: w.patch.labor35aCents ?? undefined, invoiceFile: w.patch.invoiceFile ?? i.invoiceFile }
          : i))
      } else {
        r.lines = r.lines.map((l) => (l.idx === w.idx ? { ...l, ...w.change } : l))
      }
    }
  }

  return {
    get items(): CostItem[] { return items },
    requests,
    patchItem(id: string, patch: Partial<CostItem>): void {
      items = items.map((i) => (i.id === id ? { ...i, ...patch } : i))
    },
    // Wie die Route nach einer gelungenen Auswertung: speichern und mit Vorschlägen zurückgeben.
    evaluate(file: string, ex: Extraction, opts: { year: number }): AssessmentView {
      const id = `a${++next}`
      const detected = detectedYear(ex)
      const r: Stored = {
        assessment: {
          id, file, propertyId, year: detected ?? opts.year, detectedYear: detected, vendor: ex.vendor ?? null,
          invoiceDate: ex.invoiceDate ?? null, totalGrossCents: typeof ex.totalGrossEur === 'number' ? Math.round(ex.totalGrossEur * 100) : null,
          amountsAdjusted: ex.amountsAdjusted ?? null, laborFromTotal: ex.laborFromTotal === true,
          createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, next)).toISOString(),
        },
        lines: linesFromExtraction(ex).map((l, idx) => ({ ...l, assessmentId: id, idx, booking: null, costItemId: null, dismissed: false })),
      }
      records.push(r)
      return view(r)
    },
    // Beantwortet, was die Belegbuchung betrifft, sonst `null`.
    async handle(url: string, init?: RequestInit): Promise<Response | null> {
      const method = init?.method ?? 'GET'
      const path = url.split('?')[0] ?? url
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (path === '/api/costItems' && method === 'GET') return json(items.filter((i) => i.propertyId === propertyId))
      const item = path.match(/^\/api\/costItems\/([^/]+)$/)
      if (item && method === 'DELETE') {
        items = items.filter((i) => i.id !== item[1])
        for (const r of records) r.lines = r.lines.map((l) => (l.costItemId === item[1] ? { ...l, costItemId: null } : l))
        return json({ ok: true })
      }
      if (path === '/api/assessments' && method === 'GET') return json(records.map(view).filter((v) => !url.includes('open=1') || v.open))
      const m = path.match(/^\/api\/assessments\/([^/]+)(?:\/(plan|book))?$/)
      if (!m) return null
      const r = records.find((x) => x.assessment.id === m[1])
      if (!r) return json({ error: 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }, 404)
      if (!m[2]) {
        const year = fieldOf(body, 'year')
        if (method === 'PUT' && typeof year === 'number') r.assessment = { ...r.assessment, year }
        return json(view(r))
      }
      requests.push({ path, body })
      const parsed = parseDecisions(fieldOf(body, 'decisions'))
      if ('error' in parsed) return json({ error: parsed.error }, 400)
      const planned = planBooking({ assessment: r.assessment, lines: r.lines, items, booked: booked(), units: start.units, twinFiles: [] }, parsed.decisions, () => `neu-${++next}`)
      const preview = previewWith(planned, tokenSource(planned))
      if (m[2] === 'plan') return json(preview)
      const token = fieldOf(body, 'token')
      const decision = decide(planned, parsed.decisions.length, typeof token === 'string' ? token : '', preview.token)
      if (decision === 'conflict') return json({ error: planned.conflicts.join(' '), assessment: view(r) }, 409)
      if (decision === 'unchanged') return json({ changed: false, assessment: view(r), preview })
      if (decision === 'refused') return json({ error: [...preview.errors, ...preview.confirm].map((p) => p.message).join(' '), preview }, 400)
      if (decision === 'stale') return json({ error: 'Seit der Vorschau hat sich der Stand geändert. Bitte prüfen Sie die neue Vorschau und buchen Sie dann.', preview }, 409)
      apply(r, planned.writes)
      return json({ changed: true, assessment: view(r), preview })
    },
  }
}
```

`client/src/pages/booking.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Belegbuchung im Browser (#170): Schnellerfassung und Kosten benutzen dieselbe Komponente
// „Auswertung prüfen“, und die Zahlen kommen vom (nachgebauten) Server mit dem echten Planer.
// Die vier Abnahmefälle der Spezifikation stehen hier als „Abnahme A“ bis „Abnahme D“.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Extraction, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Schnellerfassung from './Schnellerfassung'
import Kosten from './Kosten'
import { fakeBooking, type FakeBooking } from '../testing/fakeBooking'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
// Die Seiten öffnen im Vorjahr des Kalenderjahres (year.tsx).
const YEAR = new Date().getFullYear() - 1

let fake: FakeBooking
let extraction: Extraction
let evaluated: number

const estimate = (id: string, category: string, amountCents: number, extra: Partial<CostItem> = {}): CostItem =>
  ({ id, propertyId: 'objekt-1', year: YEAR, category, description: `${category} ${YEAR}`, amountCents, key: 'area', ...extra })
const invoice = (positions: Extraction['positions'], vendor = 'Stadtwerke'): Extraction => ({ vendor, invoiceDate: `${YEAR}-12-31`, positions })

beforeEach(() => {
  evaluated = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/intake' || url === '/api/extract') {
      const file = `beleg-${++evaluated}.pdf`
      return json({ file, kind: 'rechnung', extraction, assessment: fake.evaluate(file, extraction, { year: YEAR }) })
    }
    const handled = await fake.handle(url, init)
    if (handled) return handled
    if (url.split('?')[0] === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    return json((init?.method ?? 'GET') === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const intake = () => render(<YearProvider><PropertyProvider><UIProvider><Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} /></UIProvider></PropertyProvider></YearProvider>)
const costs = () => render(<YearProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></YearProvider>)

async function upload(container: HTMLElement, count = 1) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  const files = Array.from({ length: count }, (_, i) => new File(['PDF'], `beleg-${i + 1}.pdf`, { type: 'application/pdf' }))
  fireEvent.change(input, { target: { files } })
}
const actionOf = async (description: string): Promise<HTMLSelectElement> => {
  const el = await screen.findByRole('combobox', { name: `Was geschieht mit „${description}“?` }, SLOW)
  if (!(el instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  return el
}
async function previewAndBook(): Promise<{ shown: string[] }> {
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  const panel = await screen.findByLabelText('Vorschau', {}, SLOW)
  const shown = within(panel).getAllByRole('listitem').map((li) => li.textContent ?? '')
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  return { shown }
}

test('Abnahme A im Browser: Wasser 700 € + 800 € an die Schätzung über 1.500 €; eine Position, Vorschau gleich Ergebnis', async () => {
  fake = fakeBooking({ items: [estimate('wa', 'Wasser/Abwasser', 150000)], units: UNITS })
  extraction = invoice([{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }])
  const { container } = intake()
  await upload(container)
  const frisch = await actionOf('Frischwasser')
  expect(frisch.value).toBe('') // Kandidat: nicht vorab angehakt
  fireEvent.change(frisch, { target: { value: 'link:wa' } })
  fireEvent.change(await actionOf('Abwasser'), { target: { value: 'link:wa' } })
  const { shown } = await previewAndBook()
  const done = await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(done.textContent).toContain(shown.join(' · '))
  expect(fake.items.filter((i) => i.category === 'Wasser/Abwasser').map((i) => [i.id, i.amountCents])).toEqual([['wa', 150000]])
})

test('Abnahme B im Browser: Restmüll 700 € mit Gutschrift −50 €; die Gutschrift bietet kein Verknüpfen, angelegt wird nach Rückfrage', async () => {
  fake = fakeBooking({ items: [estimate('mu', 'Müllabfuhr', 70000)], units: UNITS })
  extraction = invoice([{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonne', category: 'Müllabfuhr', amountEur: -50 }])
  const { container } = intake()
  await upload(container)
  const gutschrift = await actionOf('Gutschrift Tonne')
  expect([...gutschrift.options].map((o) => o.value).some((v) => v.startsWith('link:'))).toBe(false)
  fireEvent.change(await actionOf('Restmüll'), { target: { value: 'link:mu' } })
  fireEvent.change(gutschrift, { target: { value: 'create' } })
  await previewAndBook()
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem anlegen' }, SLOW))
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(fake.items.map((i) => i.amountCents).sort((a, b) => a - b)).toEqual([-5000, 70000])
})

test('Abnahme C im Browser: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil: die Vorschau sagt, dass er entfernt wird', async () => {
  fake = fakeBooking({ items: [estimate('gp', 'Gartenpflege', 150000, { labor35aCents: 100000 })], units: UNITS })
  extraction = invoice([{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450 }], 'Gärtnerei')
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Gartenpflege Saison'), { target: { value: 'link:gp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  expect((await screen.findByLabelText('Vorschau', {}, SLOW)).textContent).toMatch(/Lohnanteil von 1\.000,00\s€ wird entfernt/)
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  await screen.findByLabelText('Gebucht', {}, SLOW)
  const gp = fake.items.find((i) => i.id === 'gp')
  expect([gp?.amountCents, gp?.labor35aCents]).toEqual([145000, undefined])
})

test('Abnahme D im Browser: doppelt auf „Buchen“ ergibt eine Position', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  expect((await actionOf('Grundsteuer B')).value).toBe('create')
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByLabelText('Vorschau', {}, SLOW)
  const buchen = screen.getByRole('button', { name: 'Buchen' })
  fireEvent.click(buchen)
  fireEvent.click(buchen)
  await screen.findByLabelText('Gebucht', {}, SLOW)
  await waitFor(() => expect(fake.items).toHaveLength(1))
})

test('Weiter prüfen nach dem Neuladen: eine offene Auswertung steht ohne neue KI-Anfrage wieder da', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  fake.evaluate('alt.pdf', invoice([{ description: 'Hausmeister', category: 'Hauswart', amountEur: 300 }], 'Hausmeisterdienst'), { year: YEAR })
  intake()
  expect((await actionOf('Hausmeister')).value).toBe('create')
  expect(evaluated).toBe(0)
})

test('Geänderter Stand zwischen Vorschau und Buchung: die Seite zeigt die neue Vorschau und bucht nichts', async () => {
  fake = fakeBooking({ items: [estimate('wa', 'Wasser/Abwasser', 140000)], units: UNITS })
  extraction = invoice([{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }])
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Frischwasser'), { target: { value: 'link:wa' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByLabelText('Vorschau', {}, SLOW)
  fake.patchItem('wa', { amountCents: 145000 })
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  expect(await screen.findByText(/Seit der Vorschau hat sich der Stand geändert/, {}, SLOW)).toBeTruthy()
  expect((await screen.findByLabelText('Vorschau', {}, SLOW)).textContent).toMatch(/1\.450,00\s€ → 700,00\s€/)
  expect(fake.items.find((i) => i.id === 'wa')?.amountCents).toBe(145000)
})

test('Position ohne Betrag: Feld leer, rot, nicht vorab angehakt; nicht umlagefähig ohne Schlüssel', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Unlesbar', category: 'Grundsteuer' }, { description: 'Heizungsreparatur', category: 'Nicht umlagefähig', amountEur: 200 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  const unlesbar = await actionOf('Unlesbar')
  expect(unlesbar.value).toBe('')
  const row = unlesbar.closest('tr')
  expect(row?.querySelector('.ampel.rot')).toBeTruthy()
  expect((within(row ?? document.body).getByRole('textbox', { name: 'Betrag €' }) as HTMLInputElement).value).toBe('')
  expect(screen.getByText('— trägt der Vermieter')).toBeTruthy()
})

test('„Alle grünen übernehmen“: dieselbe Kostenart aus zwei Belegen wird nicht still zweimal angelegt', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container, 2)
  await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Was geschieht mit „Grundsteuer B“?' })).toHaveLength(2), SLOW)
  fireEvent.click(await screen.findByRole('button', { name: /Alle grünen übernehmen/ }, SLOW))
  expect(await screen.findByText(/Noch zu prüfen: „Grundsteuer B“/, {}, SLOW)).toBeTruthy()
  expect(fake.items).toHaveLength(1)
})

test('Kosten: dieselbe Komponente, die alte Übernahme gibt es nicht mehr', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = costs()
  await upload(container)
  expect((await actionOf('Grundsteuer B')).value).toBe('create')
  expect(screen.queryByRole('button', { name: /Ausgewählte Positionen/ })).toBeNull()
  await previewAndBook()
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(fake.items.map((i) => [i.amountCents, i.invoiceFile])).toEqual([[61240, 'beleg-1.pdf']])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- assessment booking`
Expected: FAIL (`./assessment` fehlt; die Seiten zeigen noch die alte Tabelle).

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test test/assessment.test.ts`
Expected: PASS (die übernommenen Tests prüfen Funktionen aus Task 3; sie stehen hier, weil ihr bisheriger Ort in Step 7 wegfällt).

- [ ] **Step 4: `ApiError` in `client/src/api.ts`**

```ts
// Eine Ablehnung des Servers mit Status und Rumpf (#170): Die Buchung braucht bei 409 den Stand
// oder die neue Vorschau aus der Antwort, nicht nur die Meldung. Für alle anderen Aufrufer bleibt
// es ein `Error` mit derselben Meldung wie bisher.
export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body && !(init.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : init?.headers
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    const data: Record<string, unknown> = raw !== null && typeof raw === 'object' ? { ...raw } : {}
    const message = typeof data.error === 'string' && data.error ? data.error : `${res.status} ${res.statusText}`
    throw new ApiError(message, res.status, data)
  }
  return res.json() as Promise<T>
}
```

- [ ] **Step 5: `client/src/assessment.ts`**

```ts
// Die Prüfung einer gespeicherten Auswertung im Browser (Belegbuchung, #170). Entschieden wird je
// Zeile hier, gerechnet und gebucht auf dem Server: Die Vorschau kommt von dort, und gebucht wird
// genau das, was sie zeigt. Ohne DOM prüfbar (assessment.test.ts); die Komponente
// components/AssessmentReview.tsx rendert nur.
import type { AssessmentLine, AssessmentView, BookingPreview, CostKey, LineCandidate, LineDecision, LineFields } from './types'
import type { Allocation } from '../../shared/allocation.ts'
import { api, ApiError, fmtEuro, parseEuro } from './api'
import { withProperty } from './property'

export type RowAction = '' | 'create' | 'dismiss' | 'release' | `link:${string}`

// Eine Zeile, wie der Nutzer sie gerade sieht: Texte statt Cent, damit er frei korrigieren kann.
export type RowDraft = {
  action: RowAction
  description: string
  category: string
  amount: string
  labor35a: string
  key: CostKey
  allocation: Allocation | null
  externalTotalAmount: string
}

const centsText = (c: number | null): string =>
  c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Ein leeres Feld heißt „nicht gelesen“; was sich nicht lesen lässt, ebenso. Der Server sagt dann,
// was fehlt.
const cents = (raw: string): number | null => (raw.trim() ? parseEuro(raw) : null)

// Vorab angehakt ist, was der Server vorschlägt (`preselected`); sonst entscheidet der Nutzer.
export function initialRow(line: AssessmentLine): RowDraft {
  const f = line.suggestion?.fields
  return {
    action: line.state === 'open' && line.suggestion?.preselected ? 'create' : '',
    description: f?.description ?? line.description,
    category: f?.category ?? line.category,
    amount: centsText(f ? f.amountCents : line.amountCents),
    labor35a: centsText(f ? f.labor35aCents : line.labor35aCents),
    key: f?.key ?? 'area',
    allocation: f?.allocation ?? null,
    externalTotalAmount: '',
  }
}

export const initialRows = (v: AssessmentView): Record<number, RowDraft> =>
  Object.fromEntries(v.lines.map((l) => [l.idx, initialRow(l)]))

export function fieldsOf(row: RowDraft): LineFields {
  return {
    description: row.description,
    category: row.category,
    amountCents: cents(row.amount),
    labor35aCents: cents(row.labor35a),
    key: row.key,
    // Wer den Schlüssel wechselt, verlässt den gemerkten (AiKeyCell setzt ihn dann auf null).
    allocation: row.allocation && row.allocation.key === row.key ? row.allocation : null,
    externalTotalCents: cents(row.externalTotalAmount),
  }
}

// Die Entscheidungen, die an den Server gehen. Eine Zeile ohne Wahl bleibt offen; gebuchte Zeilen
// lassen sich nur lösen, und das nur, wenn sie verknüpft sind (eine angelegte löst man durch
// Löschen der Position).
export function decisionsOf(view: AssessmentView, rows: Record<number, RowDraft>): LineDecision[] {
  const out: LineDecision[] = []
  for (const line of view.lines) {
    const row = rows[line.idx]
    if (!row || row.action === '') continue
    if (row.action === 'release') {
      if (line.state === 'linked') out.push({ idx: line.idx, action: 'release' })
      continue
    }
    if (line.state !== 'open' && line.state !== 'dismissed') continue
    if (row.action === 'create') out.push({ idx: line.idx, action: 'create', fields: fieldsOf(row) })
    else if (row.action === 'dismiss') out.push({ idx: line.idx, action: 'dismiss' })
    else out.push({ idx: line.idx, action: 'link', costItemId: row.action.slice('link:'.length), amountCents: cents(row.amount), labor35aCents: cents(row.labor35a) })
  }
  return out
}

// Womit eine Zeile verknüpft werden kann: Kandidaten, deren Betrag nicht an weiteren Angaben hängt
// (die öffnet man im Formular), und nie, wenn die Zeile eine Gutschrift ist.
export function linkChoices(line: AssessmentLine, row: RowDraft): LineCandidate[] {
  const amount = cents(row.amount)
  if (amount !== null && amount < 0) return []
  return (line.suggestion?.candidates ?? []).filter((c) => !c.formOnly)
}

// Nach „Trotzdem anlegen“: dieselben Entscheidungen, die bestätigten Zeilen ausdrücklich.
export function withConfirmed(decisions: readonly LineDecision[], idxs: readonly number[]): LineDecision[] {
  return decisions.map((d) => (d.action === 'create' && idxs.includes(d.idx) ? { ...d, despiteCandidates: true } : d))
}

// „Alle grünen übernehmen“: offene Zeilen, die der Server vorab anhakt und grün bewertet, mit
// seinem Vorschlag. Eingaben, die noch in einer Tabelle stehen, gelten dabei nicht; wer etwas
// geändert hat, bucht diese Zeile mit „Vorschau“ und „Buchen“.
export function greenDecisions(view: AssessmentView): LineDecision[] {
  return view.lines.flatMap((l): LineDecision[] =>
    l.state === 'open' && l.suggestion?.preselected && l.suggestion.level === 'gruen'
      ? [{ idx: l.idx, action: 'create', fields: l.suggestion.fields }]
      : [])
}

const laborText = (c: number | null): string => (c === null ? 'keiner' : fmtEuro(c))

// Die Vorschau in Sätzen, je Position eine Zeile.
export function previewLines(p: BookingPreview): string[] {
  return p.items.map((i) => {
    if (i.costItemId === null) {
      return `Neu: „${i.description}“ (${i.category}) ${fmtEuro(i.afterCents)}${i.afterLabor35aCents ? `, davon §35a ${fmtEuro(i.afterLabor35aCents)}` : ''}`
    }
    const labor = i.beforeLabor35aCents !== i.afterLabor35aCents ? `; §35a ${laborText(i.beforeLabor35aCents)} → ${laborText(i.afterLabor35aCents)}` : ''
    if (i.beforeCents === i.afterCents) return `„${i.description}“ bleibt bei ${fmtEuro(i.afterCents)}${labor}`
    return `„${i.description}“: ${fmtEuro(i.beforeCents ?? 0)} → ${fmtEuro(i.afterCents)}${labor}`
  })
}

// ---------- Abrufe ----------

export const loadOpenAssessments = (propertyId: string | null | undefined): Promise<AssessmentView[]> =>
  api<AssessmentView[]>(withProperty('/api/assessments?open=1', propertyId))

export const planDecisions = (id: string, decisions: readonly LineDecision[]): Promise<BookingPreview> =>
  api<BookingPreview>(`/api/assessments/${encodeURIComponent(id)}/plan`, { method: 'POST', body: JSON.stringify({ decisions }) })

export const changeAssessmentYear = (id: string, year: number): Promise<AssessmentView> =>
  api<AssessmentView>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ year }) })

export type BookResult =
  | { kind: 'done'; changed: boolean; assessment: AssessmentView; preview: BookingPreview }
  | { kind: 'refused' | 'stale'; message: string; preview: BookingPreview }
  | { kind: 'conflict'; message: string; assessment: AssessmentView }

// Bucht und übersetzt die Ablehnungen des Servers: 400 mit Vorschau (Fehler oder offene
// Rückfrage), 409 mit Vorschau (Stand geändert) und 409 mit Auswertung (anders gebucht). Alles
// andere wirft wie `api()`.
export async function bookDecisions(id: string, decisions: readonly LineDecision[], token: string): Promise<BookResult> {
  try {
    const r = await api<{ changed: boolean; assessment: AssessmentView; preview: BookingPreview }>(
      `/api/assessments/${encodeURIComponent(id)}/book`, { method: 'POST', body: JSON.stringify({ decisions, token }) })
    return { kind: 'done', ...r }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    // Die Antwort des Servers hat genau diese Gestalt (server/src/index.ts, Route …/book).
    const preview = e.data.preview as BookingPreview | undefined
    const assessment = e.data.assessment as AssessmentView | undefined
    if (e.status === 409 && assessment) return { kind: 'conflict', message: e.message, assessment }
    if (preview) return { kind: e.status === 409 ? 'stale' : 'refused', message: e.message, preview }
    throw e
  }
}
```

- [ ] **Step 6: `AiKeyCell` und `AssessmentReview`**

`client/src/components/AiKeyCell.tsx`: Import von `AiPosition` entfernen und die Eigenschaften so tippen
(der Rumpf bleibt):

```tsx
import type { Allocation } from '../../../shared/allocation.ts'
import { aiKeyOptions } from '../costForm'

// Was die Zelle von einer Zeile liest und ändert.
export type KeyCellValue = { category: string; key: CostKey; allocation: Allocation | null; externalTotalAmount: string }

type Props = {
  position: KeyCellValue
  units: Unit[]
  onChange: (patch: Partial<KeyCellValue>) => void
}
```

`client/src/components/AssessmentReview.tsx`:

```tsx
// „Auswertung prüfen“ (Belegbuchung, #170): die Zeilen eines ausgewerteten Belegs mit Ampel,
// Vorschlag und Kandidaten, die Vorschau des Servers und das Buchen genau dieser Vorschau.
// Schnellerfassung und KI auf der Kostenseite benutzen sie; der Posteingang führt mit „Weiter
// prüfen“ in die Schnellerfassung. Die Entscheidungslogik steht in client/src/assessment.ts.
import { Fragment, useEffect, useState } from 'react'
import type { AssessmentView, BookingPreview, Unit } from '../types'
import { CATEGORIES } from '../types'
import { errorText, fmtEuro } from '../api'
import {
  bookDecisions, changeAssessmentYear, decisionsOf, initialRows, linkChoices, planDecisions, previewLines, withConfirmed, type RowAction, type RowDraft,
} from '../assessment'
import { aiPositionDefaults, type KeyContext } from '../costForm'
import AiKeyCell from './AiKeyCell'
import Table from './Table'
import { useConfirm } from './feedback'

type Props = {
  assessment: AssessmentView
  units: Unit[]
  // Woraus der Schlüssel einer geänderten Kostenart vorgeschlagen wird (#141)
  keyContext?: KeyContext
  onChange: (next: AssessmentView) => void
  onOpenItem?: (costItemId: string) => void
}

const ACTIONS: readonly string[] = ['', 'create', 'dismiss', 'release']
const isAction = (v: string): v is RowAction => ACTIONS.includes(v) || v.startsWith('link:')

export default function AssessmentReview({ assessment: a, units, keyContext, onChange, onOpenItem }: Props) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<Record<number, RowDraft>>(() => initialRows(a))
  const [preview, setPreview] = useState<BookingPreview | null>(null)
  const [booked, setBooked] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Nach jeder Buchung kommt die Auswertung neu vom Server; die Zeilen beginnen dann von vorn.
  useEffect(() => { setRows(initialRows(a)); setPreview(null) }, [a])
  const decisions = decisionsOf(a, rows)

  const patch = (idx: number, p: Partial<RowDraft>) => {
    setRows((r) => {
      const current = r[idx]
      return current ? { ...r, [idx]: { ...current, ...p } } : r
    })
    // Eine Vorschau gilt nur für das, was sie gesehen hat.
    setPreview(null)
    setBooked(null)
  }

  async function showPreview() {
    setBusy(true)
    setError('')
    try {
      setPreview(await planDecisions(a.id, decisions))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function book() {
    if (!preview) return
    let toSend = decisions
    if (preview.confirm.length > 0) {
      const ok = await confirm({
        title: 'Schon erfasst?',
        message: preview.confirm.map((c) => c.message).join(' '),
        confirmLabel: 'Trotzdem anlegen',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return
      toSend = withConfirmed(decisions, preview.confirm.flatMap((c) => (c.idx === null ? [] : [c.idx])))
    }
    setBusy(true)
    setError('')
    try {
      const result = await bookDecisions(a.id, toSend, preview.token)
      if (result.kind === 'done') {
        setBooked(previewLines(result.preview))
        setPreview(null)
        onChange(result.assessment)
      } else if (result.kind === 'conflict') {
        setError(result.message)
        setPreview(null)
        onChange(result.assessment)
      } else {
        // Abgelehnt oder auf einem anderen Stand: die neue Vorschau zeigen, nichts ist gebucht.
        setError(result.message)
        setPreview(result.preview)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function changeYear(year: number) {
    try {
      onChange(await changeAssessmentYear(a.id, year))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const years = [a.year - 2, a.year - 1, a.year, a.year + 1]
  return (
    <div className="assessment-review">
      <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
        <label className="field">
          Jahr der Buchung
          <select aria-label="Jahr der Buchung" value={a.year} onChange={(e) => void changeYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      {a.propertyId === null && (
        <div className="warn">Zu welchem Objekt gehört dieser Beleg? Wählen Sie es bitte im Posteingang; gebucht wird nur innerhalb eines Objekts.</div>
      )}
      {a.sumWarning && <div className="warn" style={{ marginTop: 8 }}>⚠ {a.sumWarning}</div>}
      {a.amountsAdjusted === 'netto' && (
        <div className="notice" style={{ marginTop: 8 }}>
          Die Positionen standen ohne Umsatzsteuer auf der Rechnung. Mietfuchs hat sie auf den Rechnungsbetrag hochgerechnet. Bitte die Beträge kurz prüfen.
        </div>
      )}
      {a.laborFromTotal && (
        <div className="notice" style={{ marginTop: 8 }}>
          Der Arbeitskostenanteil nach §35a stand nur als ein Betrag auf der Rechnung. Mietfuchs hat ihn nach Beträgen auf die Positionen verteilt; Fahrtkosten und Material gehören streng genommen nicht dazu.
        </div>
      )}
      <Table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th><span className="sr-only">Ampel</span></th>
            <th>Was geschieht?</th>
            <th>Beschreibung</th>
            <th>Kostenart</th>
            <th>Umlageschlüssel</th>
            <th className="num">Betrag €</th>
            <th className="num">§35a €</th>
          </tr>
        </thead>
        <tbody>
          {a.lines.map((line) => {
            const row = rows[line.idx]
            if (!row) return null
            if (line.state === 'created' || line.state === 'linked') {
              return (
                <tr key={line.idx}>
                  <td><span className="ampel gruen" /></td>
                  <td>
                    {line.state === 'created' ? `✓ angelegt als „${line.itemDescription ?? '?'}“` : `✓ verknüpft mit „${line.itemDescription ?? '?'}“`}
                    {line.state === 'linked' && (
                      <label style={{ marginLeft: 8 }}>
                        <input type="checkbox" aria-label={`„${line.description}“ lösen`} checked={row.action === 'release'}
                          onChange={(e) => patch(line.idx, { action: e.target.checked ? 'release' : '' })} /> lösen
                      </label>
                    )}
                  </td>
                  <td>{line.description}</td>
                  <td>{line.category}</td>
                  <td />
                  <td className="num">{line.amountCents === null ? '—' : fmtEuro(line.amountCents)}</td>
                  <td className="num">{line.labor35aCents === null ? '—' : fmtEuro(line.labor35aCents)}</td>
                </tr>
              )
            }
            const s = line.suggestion
            return (
              <Fragment key={line.idx}>
                <tr>
                  <td><span className={`ampel ${s?.level ?? 'gruen'}`} title={s?.reasons.join('\n')} /></td>
                  <td>
                    <select aria-label={`Was geschieht mit „${line.description}“?`} value={row.action}
                      onChange={(e) => { if (isAction(e.target.value)) patch(line.idx, { action: e.target.value }) }}>
                      <option value="">— offen lassen —</option>
                      <option value="create">Neu anlegen</option>
                      {linkChoices(line, row).map((c) => (
                        <option key={c.id} value={`link:${c.id}`}>Mit „{c.description}“ ({fmtEuro(c.amountCents)}{c.invoiceFile ? '' : ', ohne Beleg'}) verknüpfen</option>
                      ))}
                      <option value="dismiss">Verwerfen</option>
                    </select>
                  </td>
                  <td><input aria-label="Beschreibung" value={row.description} onChange={(e) => patch(line.idx, { description: e.target.value })} style={{ width: '100%' }} /></td>
                  <td>
                    <select aria-label="Kostenart" value={row.category}
                      onChange={(e) => patch(line.idx, { category: e.target.value, externalTotalAmount: '', ...aiPositionDefaults(e.target.value, units, [], keyContext, row.description) })}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td><AiKeyCell position={row} units={units} onChange={(p) => patch(line.idx, p)} /></td>
                  <td className="num"><input aria-label="Betrag €" value={row.amount} onChange={(e) => patch(line.idx, { amount: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td className="num"><input aria-label="§35a €" value={row.labor35a} onChange={(e) => patch(line.idx, { labor35a: e.target.value })} style={{ width: 90, textAlign: 'right' }} placeholder="—" /></td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </Table>
      {/* Begründungen und Positionen, die im Formular gepflegt werden, stehen unter der Tabelle:
          in einer Zeile scrollten sie auf dem Handy mit (Durchsicht zu #170). */}
      <div style={{ marginTop: 6 }}>
        {a.lines.flatMap((l) => (l.state === 'open' && l.suggestion && l.suggestion.level !== 'gruen'
          ? l.suggestion.reasons.map((r) => <span key={`${l.idx}-${r}`} className={`chip ${l.suggestion?.level ?? 'gelb'}`}>{r}</span>)
          : []))}
      </div>
      {a.lines.flatMap((l) => (l.state === 'open' ? (l.suggestion?.candidates ?? []).filter((c) => c.formOnly).map((c) => (
        <div key={`${l.idx}-${c.id}`} className="warn" style={{ marginTop: 6 }}>
          „{l.description}“: „{c.description}“ wird {c.key === 'amounts' ? 'mit Einzelbeträgen je Mieter' : 'laut Gemeinschaftsabrechnung'} verteilt; ihren Betrag pflegen Sie im Formular.{' '}
          {onOpenItem && <button className="btn small" onClick={() => onOpenItem(c.id)}>Position öffnen</button>}
        </div>
      )) : []))}
      {preview && (
        <div className="card" aria-label="Vorschau" style={{ marginTop: 10 }}>
          <strong>Vorschau</strong>
          <ul>{previewLines(preview).map((t) => <li key={t}>{t}</li>)}</ul>
          {preview.notices.map((n) => <div key={n} className="notice">{n}</div>)}
          {preview.errors.map((e, i) => {
            const id = e.openItemId
            return (
              <div key={i} className="error">
                {e.message}{' '}
                {id && onOpenItem && <button className="btn small" onClick={() => onOpenItem(id)}>Position öffnen</button>}
              </div>
            )
          })}
        </div>
      )}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {booked && <div className="notice" aria-label="Gebucht" style={{ marginTop: 8 }}>✓ Gebucht: {booked.join(' · ')}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <a href={`/uploads/${encodeURIComponent(a.file)}`} target="_blank" rel="noreferrer">📎 Beleg ansehen</a>
        <div className="grow" />
        <button className="btn secondary" disabled={busy || decisions.length === 0} onClick={() => void showPreview()}>Vorschau</button>
        <button className="btn" disabled={busy || !preview || preview.errors.length > 0} onClick={() => void book()}>Buchen</button>
      </div>
    </div>
  )
}
```

`isAction` ist ein Typprädikat, das sein Versprechen prüft (feste Liste oder Präfix `link:`).

- [ ] **Step 7: Schnellerfassung und Kosten umbauen, alte Logik entfernen**

`client/src/pages/Schnellerfassung.tsx`:

1. Entfernen: den Typ `InvoicePosition`; aus `QueueEntry` die Felder `vendor`, `detectedYear`,
   `totalGrossCents`, `positions`, `createdIds`, `linkedIds`, `amountsAdjusted`, `laborFromTotal`;
   die Funktionen `positionProblem`, `updatePos`, `entryYear`, `itemsFor`, `receiptTaken`,
   `candidatesOf`, `postPosition`, `markCreated`, `adoptFailed`, `groupsOf`, `linkGroup`; den
   Zustand `linking`; die Importe von `DuplicateNotices`, `AiKeyCell`, `duplicateGroups`,
   `duplicateCandidates`, `aiRowPreselected`, `categoryDeviationPct`, `invoiceSumCheck`,
   `scorePosition`, `LinkOffer`, `DuplicateGroup`, `aiPositionBody`, `aiPositionDefaults`,
   `aiPositionPreselect`, `aiPositionProblem`, `AiPosition`, `matchCategory`, `CATEGORIES`, `parseEuro`
   und die Funktion `yearFrom`.
2. Neue Importe:

```tsx
import type { AssessmentView, CostItem, IntakeResult, Meter, NoticeSubject, Reading, Settings, Unit, UploadInfo } from '../types'
import { bookDecisions, greenDecisions, loadOpenAssessments, planDecisions } from '../assessment'
import AssessmentReview from '../components/AssessmentReview'
import { autoMatchMeter, scoreReading } from '../triage'
import { parseQuantity, type KeyContext } from '../costForm'
```

3. `QueueEntry` bekommt `assessmentId?: string`. Neuer Zustand und Laden:

```tsx
  // Gespeicherte Auswertungen dieses Objekts (#170): die offenen vom Server, dazu die in dieser
  // Sitzung gebuchten, damit „✓ übernommen“ stehen bleibt.
  const [assessments, setAssessments] = useState<AssessmentView[]>([])
  const upsert = (v: AssessmentView) =>
    setAssessments((list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v]))
```

In `loadData` in das `Promise.all` aufnehmen:

```tsx
      loadOpenAssessments(propertyId).then((open) =>
        setAssessments((list) => [...list.filter((x) => !x.open && !open.some((o) => o.id === x.id)), ...open])),
```

4. Im Effekt der Warteschlange den Zweig `else { const ex = res.extraction … }` ersetzen durch:

```tsx
        } else if (!res.assessment) {
          patchEntry(next.id, { status: 'fehler', error: 'Die Auswertung ließ sich nicht speichern. Bitte versuchen Sie es noch einmal; gebucht wurde nichts.' })
        } else {
          upsert(res.assessment)
          patchEntry(next.id, { status: 'fertig', kind: 'rechnung', serverFile: res.file, assessmentId: res.assessment.id })
        }
```

5. `scored` ersetzen durch die Ampel der Zählerstände und die Zählung über beide:

```tsx
  const readingScores = useMemo(() => {
    const map = new Map<number, ReturnType<typeof scoreReading>>()
    for (const entry of queue) {
      if (entry.status !== 'fertig' || entry.kind !== 'zaehler' || !entry.reading) continue
      const r = entry.reading
      map.set(entry.id, scoreReading({ meterNumber: r.meterNumber || null, value: parseNum(r.value), hasDate: r.hasDate, matchedMeterId: r.matchedMeterId || null, readings }))
    }
    return map
  }, [queue, readings])

  // Ampel-Zählung: offene Zeilen der Auswertungen (Vorschlag des Servers) und Zählerstände
  const tally = useMemo(() => {
    const t = { gruen: 0, gelb: 0, rot: 0 }
    for (const v of assessments) for (const l of v.lines) if (l.state === 'open' && l.suggestion) t[l.suggestion.level]++
    for (const rs of readingScores.values()) t[rs.level]++
    return t
  }, [assessments, readingScores])
```

6. `adoptEntry` heißt `adoptReading` und behält nur den Zweig des Zählerstands (Fehlerfall:
   `setError(\`Nicht übernommen: ${errorText(e)}\`)`). `adoptAllGreen` ersetzen durch:

```tsx
  // Übernimmt alle grünen Vorschläge: je Auswertung Vorschau und Buchung auf dem Server, dann
  // die grünen Zählerstände. Nacheinander, damit der zweite Beleg derselben Kostenart die eben
  // angelegte Position als Kandidaten sieht und stehen bleibt, statt still doppelt angelegt zu werden.
  async function adoptAllGreen() {
    setError('')
    setPending('')
    const left: string[] = []
    const named = (v: AssessmentView, idx: number) => `„${v.lines.find((l) => l.idx === idx)?.description ?? ''}“`
    for (const v of assessments) {
      const decisions = greenDecisions(v)
      if (decisions.length === 0) continue
      try {
        const preview = await planDecisions(v.id, decisions)
        if (preview.errors.length > 0 || preview.confirm.length > 0) {
          left.push(...decisions.map((d) => named(v, d.idx)))
          continue
        }
        const result = await bookDecisions(v.id, decisions, preview.token)
        if (result.kind === 'done' || result.kind === 'conflict') upsert(result.assessment)
        if (result.kind !== 'done') left.push(...decisions.map((d) => named(v, d.idx)))
      } catch (e) {
        setError(`Nicht übernommen: ${errorText(e)}`)
        await loadData()
        return
      }
    }
    for (const entry of queue) {
      if (entry.status !== 'fertig' || entry.kind !== 'zaehler' || !entry.reading?.checked) continue
      if (readingScores.get(entry.id)?.level !== 'gruen') continue
      try {
        if (await postReading(entry)) patchEntry(entry.id, { status: 'übernommen' })
      } catch (e) {
        setError(`Nicht übernommen: ${errorText(e)}`)
        break
      }
    }
    if (left.length > 0) setPending(`Übernommen ist, was grün war. Noch zu prüfen: ${left.join(', ')}. Bitte ansehen, „Vorschau“ und dann „Buchen“.`)
    await loadData()
  }
```

7. In der Darstellung: Einträge der Warteschlange mit `kind === 'rechnung' && status === 'fertig'`
   nicht mehr rendern (`if (entry.kind === 'rechnung' && entry.status === 'fertig') return null`
   am Anfang von `queue.map`), den ganzen Block `{/* ---------- Rechnung ---------- */}` löschen,
   beim Zählerstand `es?.readingScore` durch `readingScores.get(entry.id)` ersetzen und
   `adoptEntry(entry)` durch `adoptReading(entry)`. Nach `queue.map(…)` einfügen:

```tsx
      {assessments.map((v) => (
        <div className="card no-print" key={v.id}>
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>🧾 {v.vendor || v.originalName}</strong>
            {v.open
              ? <span className="badge green">{v.lines.filter((l) => l.state === 'open').length} offen — bitte prüfen</span>
              : <span className="badge green">✓ übernommen</span>}
            {v.detectedYear !== null && v.detectedYear !== year && <span className="badge gray">Jahr {v.detectedYear}</span>}
          </div>
          <AssessmentReview assessment={v} units={units} keyContext={keyCtx(v.year)}
            onChange={(next) => { upsert(next); void loadData() }}
            onOpenItem={(id) => onNavigate('kosten', { kind: 'costItem', id })} />
        </div>
      ))}
```

   und `hasAdopted` ersetzen durch
   `const hasAdopted = queue.some((x) => x.status === 'übernommen') || assessments.some((v) => v.lines.some((l) => l.state === 'created' || l.state === 'linked'))`.
   `useOpenForm` meldet nur noch wartende und laufende Einträge an
   (`queue.some((x) => x.status === 'wartend' || x.status === 'läuft')`): Eine ausgewertete
   Rechnung ist gespeichert und geht beim Objektwechsel nicht mehr verloren.

`client/src/pages/Kosten.tsx`:

1. Entfernen: `ExtractPos`; aus `QueueEntry` `vendor`, `positions`, `createdIds`, `amountsAdjusted`,
   `laborFromTotal`; `adoptPositions`, `itemsFor`, `candidatesOf`, `groupsOf`, `linkGroup`,
   `updatePos`, den Zustand `linking`, `itemsRef`/`loadingRef` (nur noch für die KI benutzt), und
   die Importe `aiPositionBody`, `aiPositionDefaults`, `aiPositionPreselect`, `aiPositionProblem`,
   `AiPosition`, `DuplicateNotices`, `AiKeyCell`, `aiRowPreselected`, `duplicateCandidates`,
   `duplicateGroups`, `DuplicateGroup`, `LinkOffer`. `candidateText` aus `../triage` und
   `sameCostCandidates` bleiben (Rückfrage im Kostenformular).
2. `QueueEntry` bekommt `assessment?: AssessmentView`; `addFiles` legt Einträge ohne `positions` an.
3. Im Effekt der Warteschlange ab `const res = await aiRequest…`:

```tsx
        const res = await aiRequest<ExtractResult>('/api/extract', fd, {
          signal: controller.signal,
          onProgress: (progress) => patchEntry(next.id, { progress }),
        })
        if (!res.assessment) {
          patchEntry(next.id, { status: 'fehler', error: 'Die Auswertung ließ sich nicht speichern. Bitte versuchen Sie es noch einmal; gebucht wurde nichts.' })
        } else {
          patchEntry(next.id, { status: res.assessment.open ? 'fertig' : 'übernommen', serverFile: res.file, assessment: res.assessment })
        }
```

4. In der Darstellung die Badge `{entry.positions.length} Position(en) erkannt` durch
   `{entry.assessment?.lines.length ?? 0} Position(en) erkannt — bitte prüfen` ersetzen und den
   Block `{entry.status === 'fertig' && ( <> … </> )}` durch:

```tsx
            {entry.assessment && (entry.status === 'fertig' || entry.status === 'übernommen') && (
              <AssessmentReview assessment={entry.assessment} units={units} keyContext={{ ...keyCtx, year: entry.assessment.year }}
                onChange={(next) => { patchEntry(entry.id, { assessment: next, status: next.open ? 'fertig' : 'übernommen' }); void load() }}
                onOpenItem={(id) => { const it = items.find((i) => i.id === id); if (it) { setError(''); setForm(itemToForm(it)) } }} />
            )}
```

   Importe: `import type { …, AssessmentView, ExtractResult } from '../types'` und
   `import AssessmentReview from '../components/AssessmentReview'`.

`client/src/triage.ts`: `AiRow`, `LinkOffer`, `DuplicateGroup`, `FORM_ONLY_KEYS`, `linkOffer`,
`duplicateGroups` und die dadurch unbenutzten Importe (`parseEuro`, `fmtEuro`, `amountProblem`)
löschen. `client/src/costForm.ts`: `AiPosition`, `aiPositionForm`, `aiPositionBody`,
`aiPositionProblem` löschen (`aiKeyOptions` bleibt, AiKeyCell benutzt es).
`client/src/components/DuplicateNotices.tsx` löschen.

Tests, die die entfernte Logik prüften:
- `client/src/triage.test.ts`: die Tests ab „mehrere KI-Zeilen derselben Kostenart aus einem Beleg“ bis einschließlich „L1: ausdrücklich 0 als Lohn …“ löschen und `duplicateGroups` aus dem Import nehmen. Die Regeln stehen jetzt in `server/test/booking.test.ts` (Summenregel, §35a, Gutschrift, Gemeinschaftsabrechnung, eigener Beleg).
- `client/src/costForm.memory.test.ts`: die Tests „der Rumpf trägt Teilnehmer, Beleg und Rechnungssteller“, „Gemeinschaftsabrechnung verlangt die Kosten der Gemeinschaft“ und „ohne Gedächtnis derselbe Rumpf wie bisher“ löschen (übernommen in `server/test/assessment.test.ts`, Step 1), `aiPositionBody`/`aiPositionProblem` aus dem Import nehmen.
- `client/src/pages/duplicates.test.tsx`: alle Tests, deren Name mit „Schnellerfassung:“ oder „Kostenseite:“ beginnt, löschen (ersetzt durch `booking.test.tsx`); die beiden Tests „Kostenformular: …“ bleiben, der Import von `Schnellerfassung` und `extraction` fällt weg.
- `client/src/pages/creditIntake.test.tsx` und `client/src/pages/aiAmount.test.tsx` löschen (Gutschrift, 0 €, fehlender Betrag und „trägt der Vermieter“ stehen in `booking.test.tsx` und `server/test/shared-cost-item.test.ts`).
- `client/src/pages/intakeInbox.test.tsx`: den zweiten Test löschen (ersetzt durch Abnahme A); im ersten Test den Rückgabewert für `/api/intake` um die Auswertung ergänzen:

```tsx
import { fakeBooking } from '../testing/fakeBooking'
// …
    if (url === '/api/intake') {
      intake.push(init?.body as FormData)
      const assessment = fakeBooking({ items, units: UNITS }).evaluate(IMAGE.file, EXTRACTION, { year: 2025 })
      return json({ file: IMAGE.file, kind: 'rechnung', extraction: EXTRACTION, assessment })
    }
```

Prüfen, dass nichts Entferntes mehr benutzt wird:

Run: `cd /home/geoerger/projects/mietfuchs-buchung && grep -rn "duplicateGroups\|linkOffer\|takenByReceipt\|DuplicateNotices\|aiPositionBody\|aiPositionProblem\|AiPosition\b\|createdIds\|linkedIds" client/src server/src shared`
Expected: keine Ausgabe.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm --prefix client test -- assessment booking intakeInbox duplicates triage costForm aiCancel kostenKiZiel Belege`
Expected: PASS.

- [ ] **Step 9: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"; npm run build; echo "Exit $?"`
Expected: alle drei `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add -A client/src server/test/assessment.test.ts
git status --short   # nur die Dateien dieser Aufgabe; nichts außerhalb von client/src und server/test
git commit -m "$(cat <<'EOF'
Belegbuchung: eine Komponente „Auswertung prüfen“ statt zweier Warteschlangen

Schnellerfassung und KI auf der Kostenseite zeigen gespeicherte Auswertungen
mit der Komponente „Auswertung prüfen“: je Zeile anlegen, verknüpfen oder
verwerfen, dann die Vorschau des Servers und „Buchen“ genau dieser Vorschau.
Offene Auswertungen stehen nach dem Neuladen wieder da. Die Gruppen, Angebote
und Summen zum Verknüpfen im Browser (duplicateGroups, linkOffer,
takenByReceipt) fallen weg; die Regeln stehen auf dem Server.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 7: Backup, Praxislauf, CHANGELOG und CLAUDE.md

**Files:**
- Create: `scripts/fake-ollama.mjs`
- Modify: `server/test/api.test.ts` (ein Test), `scripts/umstieg-praxislauf.mjs` (Fall 14), `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 4 (`evaluate`, `postJson`, `assessmentOf`, `grundsteuer`, `RECHNUNGEN`, `restore` in api.test.ts), Routen aus Task 4 und 5
- Produces: `scripts/fake-ollama.mjs`: `export const INVOICES`, `export function startFakeOllama(options?: { port?: number; sequence?: string[] }): Promise<{ url: string; stop: () => void }>`; aufrufbar als `node scripts/fake-ollama.mjs --port 11500 [--sequence WASSER,MUELL]`

- [ ] **Step 1: Write the failing test (Backup)**

In `server/test/api.test.ts` am Ende:

```ts
test('Belegbuchung: Backup und Wiederherstellen nehmen Auswertungen und gebuchte Zeilen mit', async () => {
  await withOllama(async (s) => {
    const g = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const w = assessmentOf(await evaluate(s, 'WASSER'))
    const decisions = grundsteuer(g)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${g.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${g.id}/book`, { decisions, token: preview.token })).status, 200)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    // Danach ändern, damit das Zurückspielen sichtbar wird: Die Position fällt weg, die Zeile wird offen.
    const [position] = await s.api<CostItem[]>('/api/costItems')
    assert.equal((await fetch(`${s.base}/api/costItems/${position?.id ?? ''}`, { method: 'DELETE' })).status, 200)
    assert.equal((await s.api<AssessmentView[]>('/api/assessments?open=1')).length, 2)
    assert.equal((await restore(s, backup)).status, 200)
    assert.deepEqual((await s.api<AssessmentView[]>('/api/assessments?open=1')).map((a) => a.id), [w.id])
    assert.deepEqual((await s.api<AssessmentView>(`/api/assessments/${g.id}`)).lines.map((l) => l.state), ['created'])
  }, { invoices: RECHNUNGEN })
})
```

- [ ] **Step 2: Run test**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "Backup und Wiederherstellen nehmen Auswertungen" test/api.test.ts`
Expected: PASS ohne Änderung am Code, denn das Archiv ist ein Schnappschuss der ganzen Datenbank (`VACUUM INTO`). Wird er rot, nimmt `server/src/db/backup.ts` die Tabellen nicht mit oder das Wiederherstellen öffnet die Datenbank nicht neu; dann dort beheben, nicht im Test.

- [ ] **Step 3: `scripts/fake-ollama.mjs`**

```js
// Ein nachgebautes Ollama für den Praxislauf und die Probe im Browser (Belegbuchung, #170).
// Es antwortet wie Ollama (zeilenweise JSON, zuletzt `done`) mit erfundenen Rechnungen: Steht das
// Kennwort einer Rechnung in der Anfrage (die Textebene eines PDFs), gilt sie; sonst die nächste
// aus der Reihenfolge, damit auch ein Foto ohne Text eine Antwort bekommt. Nur erfundene Belege.
//
//   node scripts/fake-ollama.mjs --port 11500
//   node scripts/fake-ollama.mjs --port 11500 --sequence WASSER,MUELL,GARTEN,GRUNDSTEUER
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const year = new Date().getUTCFullYear() - 1

// Die vier Abnahmefälle der Spezifikation (docs/superpowers/specs/2026-10-02-belegbuchung-design.md).
export const INVOICES = {
  WASSER: {
    vendor: 'Stadtwerke Musterstadt', invoiceDate: `${year}-12-31`, totalGrossEur: 1500,
    positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }],
  },
  MUELL: {
    vendor: 'Abfallwirtschaft Musterkreis', invoiceDate: `${year}-12-15`, totalGrossEur: 650,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonnentausch', category: 'Müllabfuhr', amountEur: -50 }],
  },
  GARTEN: {
    vendor: 'Gärtnerei Grün', invoiceDate: `${year}-11-30`, totalGrossEur: 1450,
    positions: [{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450, labor35aEur: null }],
  },
  GRUNDSTEUER: {
    vendor: 'Stadt Musterstadt', invoiceDate: `${year}-02-15`, totalGrossEur: 612.4,
    positions: [{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }],
  },
}

/**
 * @param {{ port?: number, sequence?: string[] }} [options]
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
export function startFakeOllama({ port = 0, sequence = Object.keys(INVOICES) } = {}) {
  let turn = 0
  /** @type {any} */
  let last = null
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const send = (obj) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.url === '/api/version') return send({ version: '0.34.2' })
      if (req.url === '/api/tags') return send({ models: [{ name: 'probe:latest', size: 1000 }] })
      if (req.url === '/api/show') return send({ capabilities: ['completion', 'vision'] })
      /** @type {any} */
      const j = body ? JSON.parse(body) : {}
      const props = j.format?.properties ?? {}
      let answer
      if (props.docType) answer = { docType: 'rechnung' }
      else if (props.categories) answer = { categories: (last?.positions ?? []).map((p) => p.category) }
      else {
        const text = JSON.stringify(j.messages ?? [])
        const marker = Object.keys(INVOICES).find((k) => text.includes(k)) ?? sequence[turn++ % sequence.length]
        last = INVOICES[marker]
        answer = last
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(answer) }, done: false })}\n`)
      res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20 })}\n`)
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const address = /** @type {import('node:net').AddressInfo} */ (server.address())
    resolve({ url: `http://127.0.0.1:${address.port}`, stop: () => server.close() })
  }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? undefined : process.argv[i + 1]
  }
  const fake = await startFakeOllama({ port: Number(arg('port') ?? 11500), sequence: arg('sequence')?.split(',') })
  console.log(`Nachgebautes Ollama läuft auf ${fake.url} (Modell „probe“). Beenden mit Strg+C.`)
}
```

- [ ] **Step 4: Praxislauf Fall 14**

In `scripts/umstieg-praxislauf.mjs` oben `import { startFakeOllama } from './fake-ollama.mjs'` ergänzen und
vor `// ---------- Lauf ----------` einfügen:

```js
fall(14, 'Backup mit offener und gebuchter Auswertung (#170)', async () => {
  // Seit der Belegbuchung steht das Ergebnis der KI in der Datenbank, mit dem Buchungsstand je
  // Zeile. Ein Backup muss beides zurückbringen, und zwar so, dass eine gebuchte Zeile gebucht und
  // eine offene offen bleibt; sonst böte die Schnellerfassung nach dem Wiederherstellen dieselbe
  // Rechnung ein zweites Mal zum Anlegen an.
  const ollama = await startFakeOllama()
  const dataDir = tempDir()
  const JSON_HEADERS = { 'content-type': 'application/json' }
  const post = (base, pfad, body) => fetch(`${base}${pfad}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
  let wasserId = ''
  try {
    await withServer(dataDir, async ({ base }) => {
      await fetch(`${base}/api/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ollamaUrl: ollama.url, ollamaModel: 'probe' }) })
      const auswerten = async (marker) => {
        const fd = new FormData()
        fd.append('file', new Blob(['%PDF-1.4 Probe'], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
        fd.append('pdfText', `Rechnung ${marker}`)
        return (await jsonOf(await fetch(`${base}/api/extract`, { method: 'POST', body: fd }))).assessment
      }
      const grund = await auswerten('GRUNDSTEUER')
      const wasser = await auswerten('WASSER')
      gleich([grund?.lines?.length, wasser?.lines?.length], [1, 2], 'zwei Auswertungen sind gespeichert')
      wasserId = wasser?.id ?? ''
      const decisions = [{ idx: 0, action: 'create', fields: grund?.lines?.[0]?.suggestion?.fields }]
      const vorschau = await jsonOf(await post(base, `/api/assessments/${grund?.id}/plan`, { decisions }))
      gleich((await post(base, `/api/assessments/${grund?.id}/book`, { decisions, token: vorschau.token })).status, 200, 'die Grundsteuer ist gebucht')
      const zip = await backupHolen(base)
      const [position] = await holen(base, '/api/costItems')
      await fetch(`${base}/api/costItems/${position?.id}`, { method: 'DELETE' })
      gleich((await holen(base, '/api/assessments?open=1')).length, 2, 'nach dem Löschen der Position sind beide Auswertungen offen')
      const antwort = await backupEinspielen(base, zip)
      gleich(antwort.status, 200, 'Wiederherstellen: die Route nimmt das Archiv an')
      gleich((await holen(base, '/api/assessments?open=1')).map((a) => a.id), [wasserId], 'Wiederherstellen: nur Wasser ist offen, wie im Archiv')
      gleich((await holen(base, `/api/assessments/${grund?.id}`)).lines?.map((l) => l.state), ['created'], 'Wiederherstellen: die Grundsteuer ist gebucht, wie im Archiv')
      gleich((await holen(base, '/api/costItems')).length, 1, 'Wiederherstellen: die Position ist wieder da, genau einmal')
    })
    await withServer(dataDir, async ({ base }) => {
      gleich((await holen(base, '/api/assessments?open=1')).map((a) => a.id), [wasserId], 'zweiter Start: die offene Auswertung steht unverändert da')
    })
  } finally {
    ollama.stop()
  }
})
```

Run: `cd /home/geoerger/projects/mietfuchs-buchung && node scripts/umstieg-praxislauf.mjs --nur 14; echo "Exit $?"`
Expected: alle Zeilen mit „✓“, `Exit 0`.

- [ ] **Step 5: CHANGELOG**

In `CHANGELOG.md` unter `## [Unveröffentlicht]` → `### Neu` als ersten Punkt:

```markdown
- **Belege werden auf dem Server gebucht, und eine Rechnung landet genau einmal in den Kosten.**
  Das Ergebnis einer KI-Auswertung wird gespeichert, mit Positionen, Beträgen und
  Rechnungssteller, und bleibt nach dem Neuladen erhalten: Der Posteingang zeigt „Weiter prüfen“,
  die Schnellerfassung die offenen Auswertungen des Objekts. Schnellerfassung, KI auf der
  Kostenseite und Posteingang benutzen dieselbe Prüfung: je Zeile neu anlegen, mit einer
  vorhandenen Position verknüpfen oder verwerfen, dann zeigt die Vorschau, was mit jeder Position
  geschieht, und „Buchen“ tut genau das. Eine verknüpfte Position trägt die Summe aller Zeilen,
  die an ihr hängen, auch aus zwei Belegen wie Abschlag und Restrechnung; eine Schätzung aus dem
  Vorjahr wird mit Ansage ersetzt, ebenso ein §35a-Lohnanteil, den die Rechnung nicht nennt.
  Eine Gutschrift wird nie verrechnet. Doppelt klicken, neu laden oder eine Anfrage wiederholen
  bucht nichts zweimal, und hat sich der Stand seit der Vorschau geändert, zeigt Mietfuchs die
  neue Vorschau, statt still anders zu buchen. Die KI auf der Kostenseite schickt Objekt und Jahr
  mit, ein nicht gebuchter Beleg steht dadurch im Posteingang des richtigen Objekts.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
```

Unter `### Hinweise zur Aktualisierung` anfügen:

```markdown
- Die Datenbank bekommt beim ersten Start zwei Tabellen für die gespeicherten Auswertungen
  (Migration 0013). Bestehende Positionen und Belege bleiben, wie sie sind; für sie gilt weiter
  der Beleg an der Position.
```

- [ ] **Step 6: CLAUDE.md**

Im Abschnitt **Doppelte Kostenpositionen** den Satz „Sie fragen: `alreadyCarried` …
(nicht vorab angehakt, Rückfrage „Trotzdem anlegen“), …“ ersetzen durch „Sie fragen:
`alreadyCarried` (carryOver.ts), der Vorschlag jeder Zeile einer Auswertung (`describeAssessment`
in server/src/assessment.ts, nicht vorab angehakt, Rückfrage „Trotzdem anlegen“ aus der Vorschau),
das Kostenformular beim Neuanlegen („Stattdessen … bearbeiten“) und der Hinweis
`cost.possible-duplicate` in calc.ts.“ und den Absatz ab „**Verknüpft wird je Gruppe**“ bis
„… in einer Zeile scrollten sie auf dem Handy mit.“ löschen. Direkt dahinter einen neuen Abschnitt
einfügen:

```markdown
**Belegbuchung** (#170, Entwurf in
[docs/superpowers/specs/2026-10-02-belegbuchung-design.md](docs/superpowers/specs/2026-10-02-belegbuchung-design.md)):
Eine Rechnung landet genau einmal in den Kosten, weil der **Server** bucht und nicht die Seite.

- **Eine Auswertung ist ein gespeicherter Gegenstand** (Tabellen `assessments` und
  `assessment_lines`, Migration 0013): eine je Beleg, gespeichert nur nach Erfolg der KI. Der
  Zustand einer Zeile wird **abgeleitet** (`lineState` in server/src/assessment.ts): ohne
  `cost_item_id` offen oder verworfen, mit ihr angelegt oder verknüpft. `cost_item_id` ist
  `ON DELETE SET NULL`, das Löschen einer Position macht ihre Zeilen von selbst wieder offen.
  Erneutes Auswerten ersetzt nur offene und verworfene Zeilen; gebuchte bleiben mit ihren Nummern,
  neue bekommen nie benutzte, und eine Zeile, die einer gebuchten gleicht, kommt nicht wieder.
  Neben den Spalten der Spezifikation stehen `detected_year` (Ampel „Rechnungsjahr ≠ Zieljahr“),
  `amounts_adjusted`/`labor_from_total` (die Hinweise #34 überleben das Neuladen) und
  `category_guessed` (gelb, wenn die Kostenart nur aus der Beschreibung kam).
- **Planen ist eine reine Funktion** (`planBooking` in server/src/bookingPlan.ts), Buchen führt
  ihre Schreibliste in einer Transaktion durch die Schreibschlange aus (server/src/db/booking.ts).
  **Summenregel**: Der Betrag einer Position mit Zeilen ist die Summe **aller** ihrer Zeilen,
  angelegter wie verknüpfter, über alle Belege, aus dem gespeicherten Stand; der §35a-Lohnanteil
  ist die Summe der gelesenen, und nennt keine einen, wird ein vorhandener entfernt. Eine
  Schätzung, ein von Hand geänderter Betrag und ein ungelesener Beleg an der Position werden
  ersetzt, die Vorschau sagt es in ganzen Sätzen vorher. Gutschriften werden nie verknüpft,
  `amounts` und `external` sind keine Ziele („Position öffnen“), Ziele nur im Objekt und Jahr der
  Auswertung, und ein Beleg gleichen Inhalts (Prüfsumme) kann nicht ein zweites Mal an dieselbe
  Position.
- **Eine Zeile wird nie zweimal gebucht**: genau so gebucht ist ein Erfolg ohne Änderung
  (Doppelklick, Wiederholung), anders gebucht 409. **Die Vorschau trägt eine Prüfmarke**
  (`token`, SHA-256 über `tokenSource`): Weicht der Stand beim Buchen ab, antwortet der Server mit
  409 und der neuen Vorschau. Gebucht wird immer im Objekt der Auswertung, `?property=` gilt nur
  für die Liste; ihr Objekt ist fest, sobald eine Zeile gebucht ist.
- **Prüfungen in shared/**: `amountProblem` und `costItemBody` (shared/costItem.ts, nimmt Cent,
  das Formular liest nur die Eingaben), Ampel, Vorauswahl und gemerkter Schlüssel einer KI-Zeile
  (shared/assessment.ts), die Kostenarten (shared/categories.ts, client/src/types.ts reicht sie
  weiter). `POST`/`PUT /api/costItems` prüfen bewusst noch nicht damit (eigener Schritt).
- **Routen**: `/api/extract` und `/api/intake` liefern `assessment` mit Vorschlag je Zeile;
  `GET /api/assessments?property=…&open=1`, `GET`/`PUT /api/assessments/:id`,
  `POST …/plan` und `POST …/book`. `GET /api/uploads` nennt je Beleg `bookedItemIds` und die
  Auswertung; ein Beleg, der nur über eine gebuchte Zeile an einer Position hängt, steht nicht im
  Posteingang, zählt für die Belegabdeckung und lässt sich nicht löschen. Eine Auswertung, deren
  Datei fehlt, erscheint nicht in der Liste, und `plan`/`book` antworten 404.
- **Oberfläche**: eine Komponente
  ([AssessmentReview.tsx](client/src/components/AssessmentReview.tsx), Logik in
  [client/src/assessment.ts](client/src/assessment.ts)) für Schnellerfassung und Kostenseite; der
  Posteingang führt mit „Weiter prüfen“ in die Schnellerfassung. „Alle grünen übernehmen“ bucht je
  Auswertung nacheinander, damit der zweite Beleg derselben Kostenart die eben angelegte Position
  sieht. Die jsdom-Tests rechnen mit dem echten Planer
  ([client/src/testing/fakeBooking.ts](client/src/testing/fakeBooking.ts)). Für Praxislauf (Fall
  14) und Browserprobe gibt es ein nachgebautes Ollama mit den Abnahmefällen
  ([scripts/fake-ollama.mjs](scripts/fake-ollama.mjs)).
```

Außerdem in der Liste der Routen im Abschnitt **API** nach `/api/uploads (Belegordner: …)` den
Einschub `, /api/assessments (Belegbuchung, siehe dort)` ergänzen.

- [ ] **Step 7: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0` (der Typcheck umfasst `scripts/*.mjs`).

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add scripts/fake-ollama.mjs scripts/umstieg-praxislauf.mjs server/test/api.test.ts CHANGELOG.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Belegbuchung: Backup, Praxislauf Fall 14, Changelog und Doku

Backup und Wiederherstellen nehmen Auswertungen samt Buchungsstand mit,
geprüft über die Route und im Praxislauf über zwei Starts. Ein
nachgebautes Ollama mit den vier Abnahmefällen dient Praxislauf und
Browserprobe.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

---

### Task 8: Abnahme — die vier Fälle über die Routen, praktische Prüfung im Browser

**Files:**
- Modify: `server/test/api.test.ts` (zwei Rechnungen, ein Test)
- Befunde der Browserprobe: Test und Behebung in der Datei der Aufgabe, zu der sie gehören

**Interfaces:**
- Consumes: alles Vorige; `scripts/fake-ollama.mjs` (Task 7)
- Produces: keine neuen Namen

- [ ] **Step 1: Write the test (Abnahme über die Routen)**

In `RECHNUNGEN` (api.test.ts) ergänzen:

```ts
  MUELL: {
    vendor: 'Abfallwirtschaft Musterkreis', invoiceDate: '2026-12-15', totalGrossEur: 650,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonnentausch', category: 'Müllabfuhr', amountEur: -50 }],
  },
  GARTEN: { vendor: 'Gärtnerei Grün', invoiceDate: '2026-11-30', totalGrossEur: 1450, positions: [{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450, labor35aEur: null }] },
```

und am Ende anfügen:

```ts
// Ein Beleg aus dem Posteingang noch einmal auswerten, wie „Per KI auswerten“ es tut.
async function evaluateAgain(s: Server, file: string, marker: string): Promise<Evaluated> {
  const fd = new FormData()
  fd.append('existingFile', file)
  fd.append('pdfText', `Rechnung ${marker}: Positionen wie aufgeführt.`)
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}

test('Belegbuchung: die vier Abnahmefälle der Spezifikation über die Routen', async () => {
  await withOllama(async (s) => {
    const book = async (a: AssessmentView, decisions: LineDecision[]): Promise<{ changed: boolean }> => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
      assert.deepEqual(preview.errors, [])
      const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
      return jsonOf<{ changed: boolean }>(res)
    }
    const fieldsAt = (a: AssessmentView, idx: number) => a.lines.find((l) => l.idx === idx)?.suggestion?.fields ?? assert.fail(`kein Vorschlag zu Zeile ${idx}`)
    const newItem = async (body: Record<string, unknown>) => jsonOf<CostItem>(await postJson(s, '/api/costItems', body))

    // A: Wasser 700 € + 800 € gegen eine Schätzung von 1.500 €
    const wa = await newItem({ year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' })
    const wasser = assessmentOf(await evaluate(s, 'WASSER'))
    const wasserDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: wa.id }, { idx: 1, action: 'link', costItemId: wa.id }]
    await book(wasser, wasserDecisions)

    // B: Restmüll 700 € mit Gutschrift −50 €
    const muell = assessmentOf(await evaluate(s, 'MUELL'))
    await book(muell, [{ idx: 0, action: 'create', fields: fieldsAt(muell, 0) }, { idx: 1, action: 'create', fields: fieldsAt(muell, 1) }])

    // C: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil
    const gp = await newItem({ year: 2026, category: 'Gartenpflege', description: 'Gartenpflege 2026', amountCents: 150000, labor35aCents: 100000, key: 'area' })
    const garten = assessmentOf(await evaluate(s, 'GARTEN'))
    const gartenDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: gp.id }]
    const c = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${garten.id}/plan`, { decisions: gartenDecisions }))
    assert.ok(c.notices.some((n) => /Lohnanteil von 1\.000,00\s€ wird entfernt/.test(n)), c.notices.join('\n'))
    await book(garten, gartenDecisions)

    // D: derselbe Beleg zweimal: wiederholte Buchung ohne Änderung, erneutes Auswerten ohne neue offene Zeile
    assert.equal((await book(wasser, wasserDecisions)).changed, false)
    const again = assessmentOf(await evaluateAgain(s, wasser.file, 'WASSER'))
    assert.deepEqual([again.id, again.open, again.lines.map((l) => l.state)], [wasser.id, false, ['linked', 'linked']])

    const items = await s.api<CostItem[]>('/api/costItems')
    const byDescription = (d: string) => items.filter((i) => i.description === d).map((i) => [i.amountCents, i.labor35aCents ?? null])
    assert.deepEqual(byDescription('Wasser 2026'), [[150000, null]], 'A: eine Position über 1.500 €')
    assert.deepEqual([...byDescription('Restmüll'), ...byDescription('Gutschrift Tonnentausch')], [[70000, null], [-5000, null]], 'B: zwei Positionen')
    assert.deepEqual(byDescription('Gartenpflege 2026'), [[145000, null]], 'C: Lohnanteil entfernt')
    assert.equal(items.length, 4, 'D: nichts doppelt')
  }, { invoices: RECHNUNGEN })
})
```

- [ ] **Step 2: Run test**

Run: `cd /home/geoerger/projects/mietfuchs-buchung/server && node --test --test-name-pattern "vier Abnahmefälle" test/api.test.ts`
Expected: PASS. Rot heißt ein Fehler in Task 2 bis 5; dort beheben, mit dem roten Test als Beleg.

- [ ] **Step 3: Volle Prüfung, Build, Praxislauf, Smoke-Test**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"; npm run build; echo "Exit $?"`
Expected: alle `Exit 0`.

Run: `cd /home/geoerger/projects/mietfuchs-buchung && node scripts/umstieg-praxislauf.mjs; echo "Exit $?"`
Expected: „Alle Prüfungen bestanden.“, `Exit 0` (Fall 1 bis 14).

Smoke-Test gegen den Start aus dem Quellcode (in einem eigenen Terminal bzw. im Hintergrund):

```bash
cd /home/geoerger/projects/mietfuchs-buchung
DATA=$(mktemp -d) && NKA_DATA_DIR="$DATA" CI=1 NKA_UPDATE_URL=http://127.0.0.1:9/nichts NKA_PORT=3311 npm start
# zweites Terminal:
node scripts/smoke-test.mjs --url http://127.0.0.1:3311 --mode npm; echo "Exit $?"
```

Expected: `Exit 0`. Danach den Server beenden und `$DATA` löschen.

- [ ] **Step 4: Praktische Prüfung im Browser**

Vorbereiten (zwei Hintergrundprozesse, danach beenden):

```bash
cd /home/geoerger/projects/mietfuchs-buchung
node scripts/fake-ollama.mjs --port 11500 --sequence WASSER,MUELL,GARTEN,GRUNDSTEUER
DATA=$(mktemp -d) && NKA_DATA_DIR="$DATA" CI=1 NKA_UPDATE_URL=http://127.0.0.1:9/nichts NKA_PORT=3301 npm start
```

Im Browser (Playwright, falls verfügbar, sonst von Hand) auf `http://127.0.0.1:3301`:

1. Einstellungen: Ollama-Adresse `http://127.0.0.1:11500`, Modell `probe`. Stammdaten: eine Wohnung (80 m², vermietet), ein Mietverhältnis. Kosten (Jahr = Vorjahr): „Wasser/Abwasser“ 1.500,00 € nach Personen und „Gartenpflege“ 1.500,00 € mit §35a 1.000,00 € anlegen.
2. Schnellerfassung: nacheinander vier beliebige Bilder hochladen (etwa `client/public/*.png`); das nachgebaute Ollama antwortet in der Reihenfolge Wasser, Müll, Garten, Grundsteuer.
   - **A:** Frischwasser und Abwasser stehen nicht angehakt; beide „Mit „Wasser/Abwasser …“ verknüpfen“, Vorschau zeigt „1.500,00 € bleibt“, Buchen; Kosten zeigt **eine** Wasserposition über 1.500,00 €.
   - **B:** Restmüll und Gutschrift anlegen; die Gutschrift bietet kein Verknüpfen; Kosten zeigt 700,00 € und −50,00 €.
   - **C:** Gartenpflege verknüpfen; die Vorschau sagt „Lohnanteil von 1.000,00 € wird entfernt“; danach hat die Position keinen Lohnanteil.
   - **D:** Grundsteuer: „Buchen“ zweimal schnell klicken; Kosten zeigt eine Position. Seite neu laden: keine offene Auswertung, keine Zeile doppelt.
   - Die Vorschau und die Zeile „✓ Gebucht: …“ nennen jeweils dieselben Sätze.
3. Zwei Objekte: ein zweites Objekt anlegen; einen Beleg im ersten auswerten und **nicht** buchen; auf das zweite Objekt umschalten: Die Auswertung erscheint dort nicht; zurück: Sie steht wieder da. Im Belegordner trägt der Beleg „Weiter prüfen“, und der Knopf schaltet auf das richtige Objekt und öffnet die Schnellerfassung.
4. Handy-Breite: Fenster auf 390 px Breite. Schnellerfassung und Kosten: kein waagerechtes Scrollen der ganzen Seite, die Tabelle scrollt in sich, Vorschau, Hinweise und Knöpfe „Vorschau“/„Buchen“ sind ohne Scrollen zur Seite erreichbar.

Jeder Befund bekommt einen Test, der vorher rot ist, in der Datei der zuständigen Aufgabe, und
wird dort behoben. Danach Server und nachgebautes Ollama beenden und `$DATA` löschen.

- [ ] **Step 5: Volle Prüfung und Commit**

Run: `cd /home/geoerger/projects/mietfuchs-buchung && npm test; echo "Exit $?"; npm run typecheck; echo "Exit $?"`
Expected: beide `Exit 0`.

```bash
cd /home/geoerger/projects/mietfuchs-buchung
git add server/test/api.test.ts   # dazu die Dateien etwaiger Befunde aus Step 4
git commit -m "$(cat <<'EOF'
Belegbuchung: Abnahmefälle über die Routen und Browserprobe

Die vier Abnahmefälle der Spezifikation (Wasser gegen Schätzung, Restmüll
mit Gutschrift, entfernter §35a-Schätzwert, derselbe Beleg zweimal) laufen
über die Routen gegen ein nachgebautes Ollama. Praxislauf, Smoke-Test und
die Probe im Browser mit zwei Objekten und auf 390 px Breite sind gelaufen.

Refs #170

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CpfxWFMq4CjsoL4V1Tpvqb
EOF
)"
```

Danach nicht pushen. Vor dem PR gilt die Projektregel: Durchsicht mit frischem Kontext, dazu vor dem
Merge die Integrationsdurchsicht `main..feat/belegbuchung` (Geld und Daten) und das Label
`full-check` an der obersten PR.
