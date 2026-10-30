# Quellrechnung (#455) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine aufgeteilte Rechnung bekommt eine Quelle (`cost_sources`), jeder Teil verweist darauf (`cost_items.source_id`). Die Heuristik `splitFamilyKey` entfällt, ohne dass sich je Zeitraum ein Cent ändert.

**Architecture:** Drei aufeinander aufbauende PRs. (1) Schema, Datenschritt in TypeScript, Mitführen des Verweises. (2) Eine Ableitungsfunktion für alle Wege des Aufteilens, der Wechsel des Rhythmus nach Quelle. (3) Die Verbraucher (Hinweis, Formular, Doppelte, Belegabdeckung) nach Quelle, Doku.

**Tech Stack:** Node 24 (TypeScript ohne Build), drizzle-orm/sqlite-proxy, drizzle-kit, node:test, React 19 + vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-quellrechnung-design.md`. Lies ihn vor jeder Aufgabe ganz.

## Global Constraints

- Lies CLAUDE.md, server/src/CLAUDE.md, server/src/db/CLAUDE.md und server/drizzle/README.md. Halte dich an deren Regeln: Bezeichner englisch, Kommentare, Texte und Testnamen deutsch, Geld in Cent, `.ts`-Endungen im Server, `import type`, kein `enum`.
- `npm run typecheck` ist vor jedem Commit grün.
- Migrationen nur mit `npm --prefix server run db:generate`. Spalten und Bedingungen kommen nie in einen Schritt.
- Golden-Tests (`period-golden`, `settlement-golden`, `db-golden`, `heating-*golden`) und `outflow.test.ts` (tax-golden.json) bleiben unverändert grün. Ändere nie eine Fixture, um sie grün zu machen.
- Wer einen Server startet, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL` auf einen geschlossenen Port.
- Die Commit-Nachricht ist deutsch, endet mit `Refs #455` und mit den zwei Zeilen
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_01RpbUrvcMmecqEgSBZNdT9L`.
- Kein `Fixes`/`Closes`. Changelog-Einträge unter „Unveröffentlicht“, mit Link
  `([#455](https://github.com/speedone/mietfuchs/issues/455))`.
- Testdaten über die Typen des Modells bauen (`emptyDb`, `tenancy` …), frische Datenbanken mit `openFreshDatabase`. Tests der Migrationskette nutzen die echte Kette.

## Review Focus

1. **Bestand von vor dieser Version mit mehreren Wechseln, Berichtigungen und abgeschlossenen Zeiträumen.** Nach dem Update ändert sich keine Zahl, und ein weiterer Wechsel verschiebt je Zeitraum keinen Cent gegenüber dem Code vor dem Umbau (Task 6, vorher erzeugte Golden-Datei).
2. **Backup aus 0.13.x wird eingespielt** (Kette samt Datenschritt über `archiveDatabaseProblem`). Es geht ohne Fehler, und die Teile haben danach ihre Quelle (Task 3).
3. **Rücksprung über ein Aufteilen, einen Wechsel und das Löschen des letzten Teils.** Danach stehen Quelle und Teile wie vorher, ohne Verstoß gegen einen Fremdschlüssel (Task 5, Task 6).
4. **Ein alter Tab schickt `sourceId` im Rumpf** von `POST`/`PUT /api/costItems`. Der Wert wird nicht übernommen (Task 2).
5. **Zwei verschiedene Rechnungen im selben Zeitraum mit gleichem `splitFamilyKey`, aber anderen Teilnehmern.** Sie bekommen keine gemeinsame Quelle und werden nie zusammengefasst (Task 3, Task 6).

---

## PR 1: Schema und Datenschritt (Zweig `quellrechnung-455`, PR gegen `main`)

### Task 1: Datenschritte in TypeScript

**Files:**
- Modify: `server/src/db/client.ts` (`applyMigrations`)
- Create: `server/src/db/dataSteps/index.ts` (Registry)
- Test: `server/test/data-steps.test.ts`
- Modify: `server/drizzle/README.md`, `server/src/db/CLAUDE.md` (Abschnitt „Migrationen“)

**Interfaces:**
- Produces: `export type DataStep = (connection: Connection) => void` und `export const DATA_STEPS: Readonly<Record<string, DataStep>>` (Schlüssel = `Migration.tag`) in `server/src/db/dataSteps/index.ts`. `applyMigrations` ruft `DATA_STEPS[migration.tag]?.(connection)` nach den Anweisungen des Schrittes und vor `INSERT INTO __drizzle_migrations`, in derselben Transaktion.
- `applyMigrations(connection, migrations, dataSteps = DATA_STEPS)`: dritter Parameter nur für Tests.

- [ ] **Step 1: Failing tests** in `data-steps.test.ts`:
  - „Ein Datenschritt läuft nach seinem Schritt in derselben Transaktion“: Lege mit einer nachgebauten Kette (zwei Migrationen, `CREATE TABLE t(x)`) einen Datenschritt an, der `INSERT INTO t VALUES (1)` schreibt. Erwarte danach eine Zeile.
  - „Wirft der Datenschritt, rollt sein Schritt zurück“: Erwarte, dass die Marke nicht in `__drizzle_migrations` steht und die Tabelle des Schrittes fehlt.
  - „Wächter: Datenschritte importieren nichts außer ihrem Ordner und `../client.ts` (nur `import type`)“: Lies jede Datei unter `server/src/db/dataSteps/`, verbiete `from '../schema.ts'`, `shared/` und jeden anderen relativen Import, der den Ordner verlässt.
  - „Wächter: jeder Datenschritt gehört zu einer Migration“: jeder Schlüssel aus `DATA_STEPS` ist ein `tag` aus `loadMigrations()`.
- [ ] **Step 2:** Run `npm --prefix server test -- --test-name-pattern "Datenschritt"`. Erwartet: FAIL.
- [ ] **Step 3:** Implementiere. Halte den vorhandenen Kommentar zu Fremdschlüsseln intakt und ergänze einen Absatz.
- [ ] **Step 4:** Run the tests again. Erwartet: PASS. Dann `npm run typecheck`.
- [ ] **Step 5:** Doku in README und db/CLAUDE.md nachziehen: Wann ein Datenschritt in TypeScript statt SQL, eingefroren wie SQL, rohes SQL über `connection`, keine Importe. Commit.

### Task 2: Schema, Typ, Lesen, Schreiben, Wächter fürs Wiederherstellen

**Files:**
- Modify: `server/src/db/schema.ts` (neue Tabelle `costSources` = `cost_sources`, Spalte `sourceId` an `costItems`, Index `cost_items_source_idx`)
- Generate: `server/drizzle/0077_*.sql` (+ ggf. `0078_*` für die Bedingung `rule IN ('days')`, wenn drizzle-kit Spalte und Bedingung sonst in einem Schritt mischt), meta-Dateien
- Modify: `shared/types.ts` (`CostItem.sourceId?: string`, Kommentar), `shared/splitPart.ts` (`SPLIT_FIELDS.sourceId: 'same'`), `server/src/db/read.ts`, `server/src/db/repository.ts` (`costItemRow`, `mergeCostItem`, `costItemCollection.remove`, `crossPropertyViolations`), `server/src/snapshot.ts` (`SnapshotCostItem`), `server/src/db/journal.ts` (`TABLE_KINDS`: `cost_sources: 'costs'`, Titel der Zeile), `client/src/journalView.ts` (Feldnamen), `server/test/schema.test.ts`
- Test: `server/test/db-quelle.test.ts` (neu), `server/test/api-ruecksprung.test.ts` (Ergänzung)

**Interfaces:**
- Produces: Drizzle-Tabelle `costSources` mit `id`, `propertyId` (`propertyRef()`), `rule: text('rule', { enum: SOURCE_RULES })`, dazu `export const SOURCE_RULES = ['days'] as const` in schema.ts und `export type SourceRule = 'days'` in shared/types.ts. `costItems.sourceId: text('source_id').references(() => costSources.id, { onDelete: 'restrict' })`.
- Produces: `export async function insertCostSource(tx: Executor, propertyId: string, id: string): Promise<void>` und `export async function dropEmptySource(tx: Executor, sourceId: string | undefined): Promise<void>` in repository.ts.
- Produces: Die Schreibwege der Teile setzen `sourceId` ausdrücklich. `mergeCostItem` übernimmt den Schlüssel `sourceId` aus einem Rumpf **nie** (er behält den von `current`).

- [ ] **Step 1: Failing tests** in `db-quelle.test.ts`:
  - „Eine Position liest und schreibt ihre Quelle“: Quelle einfügen, Position mit `sourceId` über den Schreibweg der Teile, `readCostItems` gibt `sourceId` zurück.
  - „Ein Rumpf setzt keine Quelle“ (Review Focus 4): `POST` und `PUT /api/costItems` mit `sourceId: 'fremd'`. Gespeichert wird ohne bzw. mit der bisherigen Quelle, kein 400.
  - „Mit dem letzten Teil fällt die Quelle weg“: zwei Teile, ersten löschen → Quelle bleibt; zweiten löschen → `cost_sources` leer.
  - „Wiederherstellen lehnt eine Quelle eines anderen Objekts ab“: `crossPropertyViolations` nennt die Position.
  - In `api-ruecksprung.test.ts`: „Rücksprung über das Löschen des letzten Teils stellt Quelle und Teil wieder her“.
- [ ] **Step 2:** Run. Erwartet: FAIL.
- [ ] **Step 3:** Schema ändern, `npm --prefix server run db:generate`, Typen und Abbildungen nachziehen. `schema.test.ts` und der Wächter in journal.test.ts sagen dir, was fehlt.
- [ ] **Step 4:** Run `npm run test:server` ganz (die Kette läuft in jedem Test) und `npm run typecheck`. Erwartet: PASS, Goldens unverändert.
- [ ] **Step 5:** Commit.

### Task 3: Der eingefrorene Datenschritt für bestehende Teile

**Files:**
- Create: `server/src/db/dataSteps/0077_quellrechnung.ts` (Name = Marke des Schrittes aus Task 2, der `source_id` anlegt)
- Modify: `server/src/db/dataSteps/index.ts`
- Test: `server/test/data-step-quellrechnung.test.ts`, Prüfsumme in `server/test/data-steps.test.ts`

**Interfaces:**
- Consumes: `DataStep`, `Connection.rows`, `Connection.exec` (Task 1); Spalten aus Task 2.
- Produces: `export const assignSources: DataStep`.

Regel (Spec, „Datenschritt“): Kandidat = `category <> 'Heizung und Warmwasser'`, `service_from`/`service_to` gesetzt, `key <> 'amounts'`, `operating_power IS NOT 'deduction'` und ein Leistungszeitraum, der mehr als einen Zeitraum des Objekts berührt. Familie = gleicher `property_id` und gleiche eingefrorene Familienregel (Kostenart, Basisbeschreibung ohne `/ \(anteilig [^)]*\)$/`, Leistungszeitraum, `vendor ?? ''`, `invoice_file ?? ''`, `key`). Mitglieder in verschiedenen Zeiträumen (≥ 2) → Quelle. Liegen zwei im selben Zeitraum → nur wenn alle Spalten außer `id, period, amount_cents, labor_35a_cents, description, tax_year` (per `PRAGMA table_info(cost_items)`) und die sortierten Zeilen der fünf Unterlisten gleich sind. Kennung der Quelle = kleinste Kennung der Mitglieder, `rule = 'days'`. Einziger Eingriff: `INSERT INTO cost_sources`, `UPDATE cost_items SET source_id`.

Die Zeiträume eines Objekts rechnet der Schritt selbst aus `properties.period_start_month` und der Tabelle der Wechsel (`period_changes`, Spalten zur Zeit des Schrittes nachsehen). Kopiere dazu die nötige Logik aus shared/period.ts (`periodsBetween` samt Rumpf vor jedem Wechsel, höchstens zwölf Monate) mit einem Kommentar „eingefroren, Stand 0.13.1“.

- [ ] **Step 1: Failing tests** in `data-step-quellrechnung.test.ts`. Baue die Bestände über die echte Kette bis zum Schritt davor, schreibe rohe Zeilen und wende den Rest an. Dafür einen Helfer `migrateUpTo(dataDir, tag)` in `server/testing/` anlegen, falls es keinen gibt (in migrations.test.ts nachsehen).
  - „Fall aus #455 nach Schritt 2: zwei Teile im selben Zeitraum, eine Quelle“: Grundsteuer 36500 ct, Leistungszeitraum 2025, Zeilen 12000 und 24500 in `2025-01` bei Kalenderobjekt. Erwartet: beide haben dieselbe `source_id` = kleinere Kennung.
  - „Schritt 4: vier Zeilen in drei Zeiträumen, eine Quelle“ (Wechsel 03/2025 und 05/2025; Zeilen 1940/3960 in `2025-01`, 2005/4095 in `2025-03`, 8055/16445 in `2025-05`).
  - „Verschiedene Teilnehmer im selben Zeitraum: keine Quelle“ (Review Focus 5).
  - „Familie in verschiedenen Zeiträumen mit verschiedenen Teilnehmern: eine Quelle wie heute“.
  - „Ein Teil allein, Heizung, Einzelbeträge, Abzug: keine Quelle“.
  - „Der Schritt ändert keinen Betrag“: Regression über alle Zeiträume, Abrechnung, Mietkonto, Steuer, Verbrauch vor und nach dem Schritt gleich. Nutze die Vergleichsfunktionen aus `server/src/db/regression.ts`, auf einem Zufallsbestand mit festem Startwert. Er hat Rechnungen mit Leistungszeitraum über mehrere Wechsel, erzeugt mit dem Code von heute über die Routen, dazu einen abgeschlossenen Zeitraum.
  - „Backup aus 0.13.1 einspielen“ (Review Focus 2): Ein Archiv eines Bestands mit aufgeteilter Rechnung, erzeugt vor dem Schritt, über `/api/restore`. Danach tragen die Teile die Quelle.
  - Prüfsumme der Datei in `data-steps.test.ts` festhalten (Muster legacy-schema.test.ts).
- [ ] **Step 2:** Run. Erwartet: FAIL.
- [ ] **Step 3:** Implementiere `assignSources`.
- [ ] **Step 4:** `npm run test:server`, `npm run typecheck`. Erwartet: PASS.
- [ ] **Step 5:** CHANGELOG-Eintrag (Abschnitt „Geändert“: eine aufgeteilte Rechnung trägt intern eine Kennung, keine Zahl ändert sich) und Commit. Danach Durchsicht mit frischem Kontext, Befunde mit vorher rotem Test beheben, PR 1 öffnen.

## PR 2: Ableitung (Zweig `quellrechnung-455-ableitung` auf PR 1)

### Task 4: `deriveSourceParts`

**Files:**
- Modify: `server/src/serviceSplit.ts`
- Test: `server/test/service-split.test.ts`

**Interfaces:**
- Produces: `export type SourceInvoice = { tieId: string; description: string; amountCents: number; labor35aCents?: number; spans: readonly { from: string; to: string }[]; marked: boolean }` und `export function deriveSourceParts(rules: PeriodRules, invoice: SourceInvoice): ServicePart[]`. `splitByService(rules, item)` bleibt erhalten und ruft `deriveSourceParts` mit einem Span und `marked: false`.

- [ ] **Step 1: Failing tests:**
  - „Ein Span ergibt genau splitByService“: Grundsteuer F18 (157,81/322,19 €) und 300 Zufallsfälle mit festem Startwert. Vergleiche jedes Feld.
  - „Spannen mit Lücke: die Lücke bekommt nichts“: Leistungszeitraum 2025, Spannen 01.01.–30.04. und 01.09.–31.12., Regeln Kalender mit Wechsel 05/2025 und 09/2025. Der Zeitraum `2025-05` fehlt im Ergebnis, die Summe stimmt.
  - „`marked` trägt den Zusatz auch an einem einzigen Ergebnis“.
  - „Gutschrift und Lohnanteil wie splitByService“.
- [ ] **Step 2:** Run `npm --prefix server test -- --test-name-pattern "deriveSourceParts|splitByService"`. Erwartet: FAIL.
- [ ] **Step 3:** Implementiere. Gewichte = Tage je Zeitraum über alle Spannen, Entscheid `${tieId}|${period.key}`.
- [ ] **Step 4:** Run. PASS, `period-golden` grün.
- [ ] **Step 5:** Commit.

### Task 5: Aufteilen beim Speichern legt eine Quelle an, Wächter für Teile mit Quelle

**Files:**
- Modify: `server/src/db/repository.ts` (`writeCostItemParts` bekommt `sourceId: string | null`, `saveCostItemSplit`, `requireServiceAndTax` oder `guardCostItem`)
- Test: `server/test/db-aufteilen.test.ts`, `server/test/api-ruecksprung.test.ts`

**Interfaces:**
- Consumes: `insertCostSource`, `dropEmptySource` (Task 2).
- Produces: `writeCostItemParts(tx, base, parts, newId, keepId, guardOptions, sourceId: string | null)`. Bei `null` bleibt der Verweis von `base`.

- [ ] **Step 1: Failing tests:**
  - „Aufteilen legt eine Quelle an, alle Teile verweisen darauf“.
  - „An einem Teil mit Quelle lehnt der Wächter ab: andere Kostenart, Schlüssel Einzelbeträge, Betriebsstrom“. Drei Fälle, je `PeriodError` mit Satz. Der Satz für Einzelbeträge kommt aus `splitBlocker`.
  - „Betrag, Rechnungssteller, Beleg und Schlüssel (nicht Einzelbeträge) lassen sich je Teil berichtigen“.
  - „Rücksprung über ein Aufteilen entfernt Quelle und Teile“ (Review Focus 3).
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implementiere.
- [ ] **Step 4:** `npm run test:server`. PASS.
- [ ] **Step 5:** Commit.

### Task 6: Der Wechsel des Rhythmus nach Quelle

**Files:**
- Modify: `server/src/db/periodChange.ts` (`planPeriodChange`, `writeChangeIn`, Vorschau), `server/src/db/repository.ts` (`rewriteCostItemFamily` setzt `sourceId`), `shared/types.ts` (`PeriodChangePreview.moves[]` bekommt `mergedInto?: string`, die Beschreibung des stehenden Teils), `client/src/components/PeriodCard.tsx` (den Satz „wird mit dem Teil … zusammengefasst“ anzeigen)
- Create: `server/test/fixtures/period/quellrechnung-vorher.json` (vor dem Umbau erzeugt), `server/testing/periodChangeFlows.ts` (Generator)
- Test: `server/test/db-wechsel-quelle.test.ts` (neu), bestehende `db-wechsel.test.ts`, `db-betriebsstrom-folgt.test.ts`, `api-belegbuchung.test.ts`, `client/src/components/PeriodCard.test.tsx`

**Interfaces:**
- Consumes: `deriveSourceParts` (Task 4), `writeCostItemParts(…, sourceId)` (Task 5), `insertCostSource`, `dropEmptySource`.

Ablauf je Quelle, wie im Spec beschrieben: Familie = gleiche `sourceId`. **Stehend** sind Teile in Zeiträumen `same` oder `grows`, **bewegt** die in `shrinks`/`gone`. `deriveSourceParts` bekommt die Summe der bewegten Teile, ihre Spannen (Leistungszeitraum geschnitten mit dem bisherigen Zeitraum), `tieId` = kleinste Kennung der Familie und `marked` = es gibt stehende Teile. Fällt ein Ergebnis in den Zeitraum eines stehenden Teils mit gleichem `paidOn` und gleichem Jahr der Zahlung nach dem Wechsel, wird es dort addiert (Betrag und Lohnanteil, Beschreibung bleibt). Sonst schreibt es `rewriteCostItemFamily` über die bewegten Teile. Bleibt danach ein einziger Teil, entfällt die Quelle (`source_id = NULL`, `dropEmptySource`). Ein Teil **ohne** Quelle und eine gewöhnliche Position mit Leistungszeitraum, die geteilt wird, und die Gruppen nach Laienprobe B2 (`writeChangeIn`, Teilen über den bisherigen Zeitraum) bekommen bei mehr als einem Teil eine neue Quelle. Abzüge (`follows`, Gruppen mit Abzügen) bekommen keine. `splitFamilyKey`, `familyOf`, `wholeInvoice` werden aus periodChange.ts entfernt.

- [ ] **Step 1: Golden vorher erzeugen (noch mit dem alten Code).** Lege `server/testing/periodChangeFlows.ts` an. Der Generator baut mit festem Startwert 200 Abläufe über die Routen: Objekt, ein bis drei kalte Rechnungen mit Leistungszeitraum (davon einige mit gleichem `splitFamilyKey` und anderen Teilnehmern), Aufteilen, dann zwei bis fünf Wechsel des Rhythmus mit Antworten aus der Vorschau, dazu manchmal ein berichtigter Betrag eines Teils. Er hält nach jedem Wechsel fest: je Zeitraum, je Basisbeschreibung die Summe der Beträge und des Lohnanteils, und die Summe je Steuerjahr. Schreibe ein Skript-Testfall, der die Datei `quellrechnung-vorher.json` mit `NKA_WRITE_GOLDEN=1` schreibt, erzeuge sie **auf dem Stand vor Task 6** und committe sie allein.
- [ ] **Step 2: Failing tests** in `db-wechsel-quelle.test.ts`:
  - „Golden: je Zeitraum dieselben Summen wie vor dem Umbau“ gegen `quellrechnung-vorher.json` (Review Focus 1). Erwartet gleich bis auf die zusammengefassten Zeilen, deren Summe gleich bleibt.
  - „Fall aus #455“: Kalenderobjekt, Grundsteuer 36500 ct über 2025 aufgeteilt. Wechsel 05/2025 → 12000/24500. Wechsel entfernt → **eine** Zeile 36500 in `2025-01`. Wieder 05/2025 → je Zeitraum eine Zeile, 12000/24500. Dann 03/2025 und 05/2025 → `2025-01` 5900, `2025-03` 6100, `2025-05` 24500, je eine Zeile. Jede Zeile trägt dieselbe Quelle.
  - „Bestand mit zwei Teilen im selben Zeitraum (nach dem Datenschritt): Der nächste Wechsel fasst sie zusammen“.
  - „Zusammenfassen nur bei gleichem Jahr der Zahlung“: ein Zeitraum über zwei Kalenderjahre, stehender Teil mit `taxYear` 2025, Antwort für den bewegten Anteil 2026 → zwei Zeilen.
  - „Verschiedene Teilnehmer im selben Zeitraum werden nie zusammengefasst“ (zwei Quellen).
  - „Liegt der Leistungszeitraum nach dem Wechsel in einem Zeitraum, entfällt die Quelle“.
  - „Laienprobe B2: eine Jahresrechnung ohne Leistungszeitraum, beim Wechsel nach Tagen geteilt, bekommt eine Quelle“.
  - „Teil ohne Quelle: der bisherige Weg, danach eine Quelle“.
  - „Rücksprung über einen Wechsel stellt Quellen und Teile wieder her“ (Review Focus 3).
  - Client: `PeriodCard.test.tsx` „zeigt, mit welchem Teil zusammengefasst wird“.
- [ ] **Step 3:** Run. FAIL.
- [ ] **Step 4:** Implementiere. Bestehende Tests, die die frühere zweite Zeile festhalten (db-wechsel, db-betriebsstrom-folgt H2), stellst du nur dort um, wo die Zeile jetzt zusammengefasst wird. Die Summe je Zeitraum muss gleich bleiben. Nenne jede solche Änderung in der Commit-Nachricht.
- [ ] **Step 5:** `npm test`, `npm run typecheck`. PASS, Goldens unverändert.
- [ ] **Step 6:** CHANGELOG („Behoben“: Nach mehreren Wechseln des Abrechnungszeitraums stand eine Rechnung mehrfach im selben Zeitraum, jetzt eine Zeile je Zeitraum) und Commit. Durchsicht mit frischem Kontext, Befunde mit vorher rotem Test, PR 2 gegen den Zweig von PR 1.

## PR 3: Verbraucher (Zweig `quellrechnung-455-verbraucher` auf PR 2)

### Task 7: Hinweis und Formular nach Quelle, `splitFamilyKey` entfernen

**Files:**
- Modify: `server/src/calc.ts` (~Z. 5058, `external.amount-mismatch`), `client/src/pages/Kosten.tsx` (~Z. 194–202), `client/src/costForm.ts` (falls `othersCents` dort berechnet wird), `shared/splitPart.ts` (`splitFamilyKey` entfernen)
- Test: `server/test/calc-aufgeteilt.test.ts`, `client/src/costForm.test.ts`, `server/test/split-family-key-guard.test.ts` (neu)

- [ ] **Step 1: Failing tests:**
  - calc: „zwei Teile derselben Quelle im selben Zeitraum werden zusammen gemessen“ (vorhandener Test, umgestellt auf `sourceId`). Neu: „zwei Positionen mit gleichem Familienschlüssel ohne gemeinsame Quelle werden einzeln gemessen“.
  - client: dasselbe für den Anteil im Formular.
  - Wächter: „`splitFamilyKey` kommt im Quelltext nicht mehr vor“ (server/src, shared, client/src, ohne dataSteps/).
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implementiere. Der Datenschritt behält seine eingefrorene Kopie.
- [ ] **Step 4:** `npm test`, `npm run typecheck`. PASS.
- [ ] **Step 5:** Commit.

### Task 8: Doppelte Positionen und Belegabdeckung je Rechnung, Anzeige „Teil von N“

**Files:**
- Modify: `shared/duplicates.ts` (`possibleDuplicates`, `sameCostCandidates`), `client/src/receipts.ts` (`coverage`, `isItemCovered`), `client/src/pages/Kosten.tsx` (Kostenliste), reines Modul für den Satz, etwa `client/src/costSource.ts`
- Test: `shared` bzw. `server/test/duplicates.test.ts` (vorhandene Datei suchen), `client/src/receipts.test.ts`, `client/src/costSource.test.ts`, jsdom-Test in `client/src/pages/Kosten.test.tsx`

**Interfaces:**
- Produces: `export function sourceSummary(item: CostItem, all: readonly CostItem[]): { parts: number; totalCents: number } | null` in `client/src/costSource.ts` (`null` ohne Quelle oder mit nur einem Teil).

- [ ] **Step 1: Failing tests:**
  - duplicates: „Teile derselben Quelle im selben Zeitraum melden einander nicht und zählen im Vergleich mit dem Vorjahr als eine“. `alreadyCarried` bleibt unverändert: Ein vorhandener Test bleibt grün.
  - receipts: „Belegabdeckung zählt eine aufgeteilte Rechnung einmal, belegt, wenn ein Teil den Beleg trägt“, mit Cent-Summe aller Teile.
  - costSource: „Teil 1 von 2, Rechnung gesamt 365,00 €“ aus zwei Teilen 12000 + 24500.
  - Kosten.test.tsx: Die Zeile eines Teils zeigt „Teil von 2 · Rechnung gesamt 365,00 €“.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implementiere. Der Text siezt nicht, weil er nur beschreibt. Prüf ihn trotzdem gegen anrede.test.ts.
- [ ] **Step 4:** `npm test`, `npm run typecheck`. PASS. Wenn die Browser vorhanden sind, zusätzlich `npm run browser-check`.
- [ ] **Step 5:** Commit.

### Task 9: Doku und Abschluss

**Files:**
- Modify: `server/src/CLAUDE.md` (Abschnitt Abrechnungszeitraum: aufgeteilte Rechnungen, Quelle, Wechsel; Abschnitt „Doppelte Kostenpositionen“; Belegordner), `server/src/db/CLAUDE.md` (Schema, Löschverhalten `source_id` RESTRICT, Datenschritte), `shared/splitPart.ts` (Kommentare, die auf #455 als Zukunft verweisen), `CHANGELOG.md`

- [ ] **Step 1:** Doku nachziehen, veraltete Sätze mit `familyKey` oder „Heuristik“ entfernen (`grep -rn "familyKey\|Heuristik" server/src shared client/src docs/*.md`).
- [ ] **Step 2:** `npm test`, `npm run typecheck`, `npm run build`. PASS.
- [ ] **Step 3:** Commit. Durchsicht mit frischem Kontext, dann PR 3.

## Nach PR 3

- Integrationsdurchsicht des Endstands `main..quellrechnung-455-verbraucher` unter zwei Blickwinkeln: Geld (Features gemeinsam, Invarianten) und Daten (Kette, Umstieg, Backup, Routen je Objekt, Doku).
- Praxislauf auf der Spitze (`scripts/umstieg-praxislauf.mjs`, siehe scripts/CLAUDE.md), Label `full-check` an PR 3.
- Gemergt wird nicht ohne den Vermieter. Die PR-Beschreibungen nennen die Befunde der Durchsichten.
