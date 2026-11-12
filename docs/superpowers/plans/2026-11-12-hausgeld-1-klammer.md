# Hausgeld (1/2), die Hausgeldabrechnung als Klammer: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei einer Eigentumswohnung lässt sich die Hausgeldabrechnung als ein Blatt eingeben (Kopf einmal, je Kostenart eigener Anteil und Gesamtkosten) und im Folgejahr aus dem Vorjahr übernehmen.

**Architecture:** Eine Tabelle `housing_statements` und eine Spalte an `cost_items`. Der Maßstab steht nur am Kopf; die eine Lesestelle in `read.ts` setzt ihn in `externalBasis` der Position ein, die Engine merkt nichts davon. Eine Position mit gespeichertem Maßstab hat einen eigenen. Das Blatt wird in einem Zug gespeichert, jede Zeile läuft durch die Prüfungen einer gewöhnlichen Kostenposition. `calc.ts` bleibt unberührt.

**Tech Stack:** TypeScript (Node 24 ohne Build), drizzle (SQLite), Express 5, React 19, node:test, vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-12-hausgeld-design.md` (Issues #141, #102), Abschnitte bis „Oberfläche“. Vor jeder Aufgabe lesen, dazu `docs/superpowers/specs/2026-10-02-schluessel-merken-design.md`.

## Global Constraints

- Worktree `/home/agent/projects/mietfuchs-hausgeld`, Zweig `feat/hausgeld-klammer` von `main`. Commits deutsch mit `Refs #141`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Commit nur nach grünem Exit-Status von Test **und** `npm run typecheck`.
- Bezeichner englisch; Kommentare, Oberfläche, Testnamen deutsch; Oberfläche siezt. Kein Geviertstrich, keine fremden Namen.
- Geld in Cent als Integer. `calc.ts` wird nicht geändert; Golden-Tests bleiben unverändert grün.
- Migration nur mit `db:generate`, in zwei Schritten nach dem Muster 0085/0086 (server/src/db/CLAUDE.md, Schema): erst die neue Spalte `housing_statement_id` an `cost_items`, dann der Neubau der Tabelle mit der gelockerten Prüfbedingung (Spec, Datenmodell). Für den Neubau gilt, was server/src/db/CLAUDE.md zu Triggern beim Neubau sagt.
- Die Migration legt keine Klammer an und ändert keine Position.
- Die Klammer erscheint in der Oberfläche nur bei `property.kind === 'etw'`; der Server lehnt sie für andere Objektarten nicht ab (ein Haus mit einer zugekauften Einheit darf sie nutzen), bietet sie dort aber nicht an.
- Abgeschlossener Zeitraum: 409 mit dem vorhandenen Satz, über den vorhandenen Helfer (`findClosedSettlement`).

## Review Focus

1. **Kopf von 1.000 auf 10.000 Anteile geändert**, drei Positionen ohne und eine mit eigenem Maßstab: drei rechnen neu, die vierte bleibt, und keine Zeile in `cost_items` wurde geschrieben (Task 2 Test).
2. **Position mit Klammer über die Seite Kosten auf „nach Wohnfläche“ umgestellt**: Sie verlässt die Klammer (Verweis leer), statt mit fremdem Schlüssel darin zu stehen (Task 2 Test).
3. **Zwei Klammern im selben Zeitraum** (zwei Wohnungen einer Anlage in einem Objekt): beide speicherbar, Summen getrennt (Task 2, Task 3 Test).
4. **Vorjahr hatte lose Positionen ohne Klammer**: „Aus dem Vorjahr übernehmen“ füllt das Blatt trotzdem (Task 3 Test).
5. **Zeile mit Betrag 0 oder Gutschrift (negativ)**: speicherbar wie eine gewöhnliche Position, die Summe stimmt (Task 2 Test).

---

### Task 1: Tabelle, Spalte und Prüfbedingung

**Files:**
- Modify: `server/src/db/schema.ts` (`housingStatements` vor `costItems`, Spalte `housing_statement_id` und gelockerte Prüfbedingung an `cost_items`), `server/src/db/read.ts` (Maßstab des Kopfes in `externalBasis` einsetzen, ~339), `server/src/db/repository.ts` (Schreibweg der drei Spalten, ~2515: mit Klammer nur einen abweichenden Maßstab speichern), `server/src/db/journal.ts` (`TABLE_KINDS`: `costs`), `server/src/db/fileRefs.ts` (`FILE_COLUMNS.uploads.housing_statements = ['file']`), `server/src/db/errors.ts`, `shared/types.ts`
- Create: Migration(en)
- Test: `server/test/db-hausgeld.test.ts`, `server/test/migrations.test.ts`, `server/test/trash.test.ts` (Wächter läuft von selbst)

**Interfaces:**
- Produces: `HousingStatement = { id: string; propertyId: string; period: PeriodKey; file?: string; statementDate?: string; measure: ExternalMeasure; measureTotal: number; note?: string }`; `CostItem.housingStatementId?: string | null`; `readHousingStatements(db, propertyId): Promise<HousingStatement[]>`.

- [ ] **Step 1: Failing test** `Hausgeldabrechnung: Bedingungen`: `measure_total` 0 scheitert; unbekannter Maßstab scheitert; ungültiger Zeitraum scheitert; Löschen der Klammer mit Positionen scheitert (RESTRICT); Gesamtkosten ohne Maßstab scheitern ohne Klammer und gelingen mit; Maßstab ohne Summe scheitert; Maßstab ohne Gesamtkosten scheitert; eine Position mit Klammer und leerem Maßstab liest sich mit `externalBasis.measure` und `.total` des Kopfes, eine mit gespeichertem Maßstab mit ihrem eigenen, eine ohne Gesamtkosten ohne `externalBasis`; Löschen des Objekts mit Klammer scheitert (RESTRICT); ein Bestand vor dem Schritt liest sich nach dem Schritt mit denselben Positionen und ohne Klammer (über `openDatabaseWithStock`).
- [ ] **Step 2:** Test → FAIL. **Step 3:** Implementieren, `db:generate`, SQL lesen. **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: Tabelle der Hausgeldabrechnungen und Verweis an der Kostenposition (Refs #141)`.

---

### Task 2: Blatt-Routen

**Files:**
- Create: `server/src/db/housingStatements.ts`, `shared/housingSheet.ts` (Typ `HousingSheet` und reine Prüfungen, die beide Seiten brauchen)
- Modify: `server/src/index.ts`, `server/src/journalRoutes.ts`, `server/src/db/repository.ts` (im Schreibweg einer Kostenposition: Klammer verlassen)
- Test: `server/test/api-hausgeld.test.ts`

**Interfaces:**
- Consumes: der Schreibweg einer Kostenposition im Repository (Prüfungen, Vorschlag der Teilnehmer), `findClosedSettlement`.
- Produces:
  - `export type HousingSheet` und `HousingSheetRow` wie in der Spec
  - `export function sheetProblems(sheet: HousingSheet): { row: number | null; field: string; text: string }[]` (rein: Summe des Maßstabs größer 0, eigener Anteil ganzzahlig, Gesamtkosten ganzzahlig oder leer, Kostenart nicht leer, eigener Maßstab vollständig)
  - `listHousingSheets(db, propertyId, period)`, `saveHousingSheet(db, id: string | null, sheet: unknown, newId)`, `removeHousingStatement(db, id, withItems: boolean)`
  - `GET /api/housing-statements`, `POST /api/housing-statements/sheet`, `PUT /api/housing-statements/:id/sheet`, `DELETE /api/housing-statements/:id?items=keep|delete`; Sätze „Hausgeldabrechnung gespeichert“, „Hausgeldabrechnung gelöst“, „Hausgeldabrechnung gelöscht“.

- [ ] **Step 1: Failing tests** api-hausgeld.test.ts:
  - `Blatt anlegen`: Kopf `mea`/1000, drei Zeilen (Müllabfuhr 180,00 € von 2.068,97 €; Verwaltervergütung 300,00 €; Zuführung Erhaltungsrücklage 600,00 €) → drei Kostenpositionen mit Schlüssel `external`, `externalBasis` `{ measure: 'mea', total: 1000, totalCents }`, `housingStatementId` gesetzt; die Abrechnung des Jahres verteilt 180,00 € und führt die beiden anderen als nicht umlagefähig.
  - `Blatt ändern`: Betrag einer Zeile, neue Zeile, `remove` einer Zeile; `rowid` der bleibenden Positionen unverändert.
  - `Kopf ändern wirkt ohne Schreiben der Positionen` (Review Focus 1): `rowid` und Verlauf zeigen nur die Änderung am Kopf.
  - `eigener Maßstab`: Zeile mit `own: { measure: 'units', total: 12 }` → `externalBasis` der Position so; in der Datenbank stehen `external_measure` und `external_total` an ihr, bei den anderen Zeilen NULL.
  - `Position verlässt die Klammer`: `PUT /api/costItems/:id` mit `key: 'area'` → `housingStatementId` null; mit geändertem `externalBasis.total` → bleibt in der Klammer und trägt den Wert als eigenen Maßstab; zurück auf den Wert des Kopfes → die Spalten sind wieder NULL.
  - `400 je Prüfung` mit Zeile und Feld im Satz („Zeile 2: Bitte geben Sie den eigenen Anteil an.“).
  - `abgeschlossener Zeitraum` → 409 für Blatt, Lösen und Löschen.
  - `Lösen` schreibt den Maßstab des Kopfes in die Positionen, die erbten, und leert den Verweis: `GET /api/costItems` liefert vor und nach dem Lösen dieselbe `externalBasis` je Position; `items=delete` entfernt sie.
  - `Beleg`: `file` muss im Belegordner liegen (400 sonst, Satz wie `requireInvoiceFile`); nach dem Löschen einer anderen Position mit demselben Beleg liegt die Datei noch da.
  - `Verlauf`: ein Eintrag je Speichern; `Rücksprung` davor stellt Kopf und Positionen wieder her.
  - `gleich wie lose eingegeben`: Bestand A mit zwölf Positionen über `POST /api/costItems`, Bestand B über das Blatt → `GET` der Abrechnung, des Mietkontos und der Steuer `deepStrictEqual` ohne Kennungen und ohne `housingStatementId`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren (alles in einem `writeData`). **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: das Blatt der Hausgeldabrechnung speichern und lösen (Refs #141)`.

---

### Task 3: Blatt in der Oberfläche

**Files:**
- Create: `client/src/housingSheet.ts`, `client/src/components/HousingSheetDrawer.tsx`, `client/src/components/HousingStatementCard.tsx`
- Modify: `client/src/pages/Kosten.tsx`, `client/src/api.ts`, `client/src/carryOver.ts` (Vorjahr für das Blatt), `client/src/journalView.ts`
- Test: `client/src/housingSheet.test.ts`, `client/src/components/HousingSheetDrawer.test.tsx`, `client/src/pages/Kosten.vorjahr.test.tsx`, `client/src/pages/Kosten.test.tsx`

**Interfaces:**
- Consumes: `HousingSheet`, `sheetProblems` (Task 2); `costKeyOptions`, Kostenarten und `isNotAllocable` aus dem Bestand; `lastExternalBasis`.
- Produces:
  - `export type SheetForm` (Zeichenketten der Felder), `emptySheetForm(property, period, units, previous)`, `sheetFromStatement(statement, items)`, `sheetBody(form): { sheet: HousingSheet } | { problems: FormProblem[] }`
  - `export function computedShare(totalCents: number | null, ownMeasure: number | null, measureTotal: number | null): number | null`
  - `export function shareDeviation(ownCents: number, computedCents: number | null): string | null` (Text ab mehr als 1 € **und** 2 %)
  - `export function sheetTotals(form): { ownCents: number; allocableCents: number }`
  - `export function carryOverSheet(previousStatement, previousItems): SheetForm['rows']`
  - `export function looseExternalItems(items: readonly CostItem[]): CostItem[]`

- [ ] **Step 1: Failing tests** housingSheet.test.ts: `Rumpf des Blatts` (deutsche Beträge, leere Gesamtkosten → `null`, Zeile ganz leer wird ausgelassen, Zeile mit nur Kostenart → Problem); `rechnerischer Anteil` 2.068,97 € × 87 ÷ 1000 → 180,00 €; `Abweichung` erst über beiden Schwellen; `Summen` mit einer nicht umlagefähigen Zeile; `Vorjahr übernehmen` (Kostenarten, Beschreibungen, eigene Maßstäbe; keine Beträge, kein Beleg; aus Klammer und aus losen Positionen); `lose Positionen` (Schlüssel `external`, ohne Klammer).
- [ ] **Step 2: Failing tests** jsdom: Karte und Knopf nur bei Eigentumswohnung; Blatt zeigt „Ihre Wohnung: 87 von 1.000 Miteigentumsanteilen“; Maßstab und eigener Maßstab als Auswahlfelder, angezeigter Wert gleich gespeichertem; „umlagefähig“ folgt der Kostenart und ist nicht bedienbar; „eigener Maßstab“ klappt zwei Felder auf; Fußzeile mit Summen; Speichern schickt das Blatt, 400 des Servers steht an der Zeile; „3 Positionen dieses Jahres gehören noch zu keiner Hausgeldabrechnung. Aufnehmen?“ nimmt sie als Zeilen mit `costItemId` auf; Position der Liste trägt „Hausgeldabrechnung“, Bearbeiten öffnet das Blatt; abgeschlossener Zeitraum: Blatt nur lesbar.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren (Regeln aus client/CLAUDE.md für Seitenfenster, Felder, Rückfragen; Entwurf über `useDraft`). **Step 5:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Hausgeld: Blatt der Hausgeldabrechnung auf der Seite Kosten (Refs #141)`.

---

### Task 4: Stammdaten, Zähler, Doku

**Files:**
- Modify: `client/src/pages/Stammdaten.tsx`, `client/src/unitForm.ts`, `client/src/pages/Zaehler.tsx`, `shared/glossary.ts`, `shared/guides.ts`, `CHANGELOG.md`, `server/src/CLAUDE.md`, `server/src/db/CLAUDE.md`, `docs/funktionsweise.md`, `scripts/umstieg-praxislauf.mjs`
- Test: `client/src/unitForm.test.ts`, `client/src/pages/Stammdaten.test.tsx`, `client/src/pages/Zaehler.test.tsx`

- [ ] **Step 1:** Nachsehen, was davon schon so ist (Spec, letzter Punkt der Oberfläche), und im PR-Text festhalten. Für das Fehlende **failing tests**: Feld „Miteigentumsanteile“ im ersten Schritt beim Anlegen einer Wohnung in einem Objekt der Art Eigentumswohnung, bei anderen Objektarten am bisherigen Ort; Satz auf der Zähler-Seite bei Eigentumswohnung ohne Zähler wörtlich wie in der Spec, bei einem Haus der bisherige Leerzustand.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren; Praxislauf um eine Klammer mit Beleg erweitern (Backup, Wiederherstellen, Beleg und Verweise da). **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0; Praxislauf → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: Voreinstellungen für Eigentumswohnungen und Doku (Refs #141)`.

---

## Self-Review (vor dem PR)

Spec „Datenmodell“ → Task 1; „API“ → Task 2; „Oberfläche“ → Tasks 3 und 4; Regression → Task 2, Bedingungen der Datenbank → Task 1. Die KI-Belegart ist Teil 2. Durchsicht mit frischem Kontext vor dem PR.
