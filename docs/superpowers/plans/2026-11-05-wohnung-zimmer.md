# Wohnung und Zimmer: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Einheit lässt sich als Zimmer einer Wohnung anlegen; der Zähler der Wohnung geht auf ihre Zimmer, die Wohnung zählt bei Fläche, Einheiten und Wohnungszahl genau einmal, und die Abrechnung nennt „Zimmer 1 in der Wohnung 1. OG links“. Ohne Zimmer rechnet alles wie heute.

**Architecture:** Neue Spalte `units.parent_unit_id`, neue Spalte `cost_items.room_split`. Eine reine Funktion `roomView` in `shared/rooms.ts` leitet beim Bilden des Schnappschusses für jede Wohnung mit Zimmern die Sicht der Rechnung ab: Zimmer mit wirksamer Fläche und vollem Namen, die Wohnung selbst als ausgenommen mit Fläche 0. Damit erreichen Fläche, Name und Ausschluss jeden Leser des Schnappschusses ohne Umbau. In calc.ts teilt ein neuer Schritt den Verbrauch eines Wohnungszählers über `planMeterRest`/`keyRaws` aus #98 auf die Zimmer, bevor die Zimmer als gemessen in die Verteilung gehen; der Einheiten-Schlüssel bekommt ein Gewicht je Einheit; die Wohnungszahl sieht statt der Zimmer einen Eintrag je Wohnung.

**Tech Stack:** TypeScript, Express, SQLite über Drizzle (`npm --prefix server run db:generate`), React 19, node:test, vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-wohnung-zimmer-design.md`

## Global Constraints

- Ohne `parentUnitId` rechnet Mietfuchs wie heute; alle Golden-Tests (calc, tax-golden.json, tax-received-golden.json) bleiben centgenau grün.
- Eine Ebene; Wohnung und Zimmer im selben Objekt; die Wohnung mit Zimmern hat kein Mietverhältnis, keine Nutzungswechsel, ist nicht selbstgenutzt und nie Empfänger (`participantUnitIds`, `directUnitId`, `customShares`, `selfAmounts`, `meterRest.unitIds`, Zielgruppen von Zwischenzählern).
- Zähler an der Wohnung nur `kaltwasser`, `strom`, `sonstig`, nie mit `heatingPlantId`.
- `roomSplit` fehlend = `'area'`; gespeichert nur bei Schlüssel `meter`.
- Wirksame Fläche eines Zimmers = Wohnungsfläche × Zimmerfläche / Summe der Zimmerflächen; Wohnungsfläche 0 oder leer → Zimmerflächen wie eingetragen (Hinweis `unit.rooms-area`); alle Zimmerflächen 0 → zu gleichen Teilen.
- Geteilt wird immer auf alle Zimmer der Wohnung; der Teil eines leeren, ausgenommenen oder nicht beteiligten Zimmers geht an den Vermieter (abziehbar, Grund wie `outside` in #98), der eines selbstgenutzten Zimmers ist Eigenanteil (`selfUse`). Nie an die übrigen Zimmer.
- Eine Rundung je Position: Teilung des Wohnungszählers und Verteilung als Rohwerte, dann ein `distributeCents` (#202).
- Wohnungszahl (§ 2 HeizkostenV, § 5d Abs. 3 CO2KostAufG): Wohnung einmal; selbst bewohnt, wenn ein Zimmer im Zeitraum selbstgenutzt und keines vermietet ist; vermietet, sobald eines vermietet ist.
- Neue Hinweis-Codes: `unit.rooms-area`, `rooms.outside-basis` (mit Betrag), `rooms.household-cost`, je `warning`. Wortlaut von `rooms.household-cost` laut Spec.
- Name: `<Zimmer> in der Wohnung <Wohnung>`.
- server/src/legacy bleibt unangetastet. Neue Spalte mit CHECK in zwei Migrationsschritten (server/src/db/CLAUDE.md), Migration nur erzeugt.
- Server: Importe mit `.ts`, `import type`, kein `enum`. Nutzertexte siezen, kein Geviertstrich, keine Namen fremder Software.
- Commits: `Refs #573`, nie `Fixes`. Zweig `feat/wohnung-zimmer`, PR auf `main`.

## Review Focus

1. **WG-Zimmer ohne Anteil an Küche und Bad eingetragen** (Zimmer 3 × 12 m², Wohnung 80 m²): Die übrigen Mieter im Haus tragen bei Fläche und Grundkosten der Heizung genau so viel wie mit der WG als einer 80-m²-Wohnung (Orakel in Task 2).
2. **Ein Zimmer steht das halbe Jahr leer, Wasser nach Personentagen**: Der leere Teil geht an den Vermieter, die anderen Zimmer zahlen nicht mehr (Test in Task 3).
3. **Zimmer nicht in den Teilnehmern einer Position, Wohnungszähler verteilt**: Sein Teil geht an den Vermieter mit `rooms.outside-basis` und Betrag (Test in Task 3).
4. **Bestehender Umweg aus dem Kommentar zu #573** (Zimmer als Wohnungen „1. OG links, Zimmer 1“, Prozentschlüssel): bleibt ohne `parentUnitId` unverändert (Golden und Test in Task 2).
5. **Wiederherstellen eines Backups mit Zimmer in fremdem Objekt oder Wohnung mit Mietverhältnis**: abgelehnt mit Satz, Bestand unverändert (Test in Task 1).

---

### Task 1: Modell, Spalten, Lesen, Schreiben, Prüfen

**Files:**
- Modify: `shared/types.ts` (`Unit.parentUnitId`, `CostItem.roomSplit`, `UnitDependents.rooms`)
- Modify: `server/src/db/schema.ts` (`units.parent_unit_id` → `units.id` RESTRICT, CHECK ≠ `id`; `cost_items.room_split` CHECK in ('area','persons')), Migrationen 0088 und folgende per `db:generate`
- Modify: `server/src/db/read.ts` (`readUnits`, Kostenpositionen), `server/src/db/repository.ts` (`emptyUnit`, `mergeUnit`, Merge der Position, `guardUnit`, Prüfung von Mietverhältnis und Position, `crossPropertyViolations`, `unitDependents`, Löschsperre), Zählerprüfung (Sparten an der Wohnung), `server/src/snapshot.ts` (`SnapshotUnit` mit `parentUnitId`, `SnapshotCostItem` mit `roomSplit`)
- Test: `server/test/api-zimmer.test.ts` (neu), `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `server/test/db-backup.test.ts` (oder die Datei, die `crossPropertyViolations` beim Wiederherstellen prüft)

**Interfaces:**
- Produces:
  ```ts
  Unit.parentUnitId?: string | null
  CostItem.roomSplit?: 'area' | 'persons'
  UnitDependents.rooms: number
  ```

- [ ] **Step 1: Failing tests** in `api-zimmer.test.ts` (`startServerIn`):
  - Wohnung „1. OG links“, Zimmer „Zimmer 1“ mit `parentUnitId` anlegen; `GET` liefert es zurück.
  - 400 je mit Satz: Zimmer in fremdem Objekt; Zimmer eines Zimmers; Wohnung mit Zimmern in andere Wohnung; Mietverhältnis an der Wohnung mit Zimmern; Zimmer an eine Wohnung mit Mietverhältnis hängen; Wohnung selbstgenutzt oder mit Nutzungswechsel; Wohnung in `participantUnitIds`, `directUnitId`, `customShares`, `selfAmounts`, `meterRest.unitIds`, Zielgruppe eines Zwischenzählers; `waerme`-, `hkv`- oder `warmwasser`-Zähler an der Wohnung; Zimmer an eine Einheit hängen, die schon einen `waerme`-Zähler hat; `parentUnitId` = eigene Kennung.
  - `DELETE` der Wohnung mit Zimmern → 409 mit `/Zimmer/`; `GET /api/units/:id/dependents` → `rooms: 2`.
  - `roomSplit: 'persons'` an Position mit Schlüssel `meter` gespeichert und gelesen; an Schlüssel `area` nicht gespeichert.
  - Wiederherstellen eines Backups, in dem ein Zimmer auf eine Wohnung in einem anderen Objekt zeigt → abgelehnt, Bestand unverändert.
- [ ] **Step 2: Run** `node --test server/test/api-zimmer.test.ts` → FAIL.
- [ ] **Step 3:** Typen, Schema, Migrationen erzeugen, Lesen, Schreiben, Prüfungen (Satzfehler 400 im Stil von `CrossPropertyError`, `sameProperty`), `crossPropertyViolations` um Objektgrenze, Ebene und Mietverhältnis der Wohnung ergänzen, Snapshot-Felder durchreichen.
- [ ] **Step 4: Run** den Test, `node --test server/test/schema.test.ts server/test/migrations.test.ts server/test/db-repository.test.ts` → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(stammdaten): Zimmer einer Wohnung speichern und prüfen (Refs #573)`.

### Task 2: Sicht der Rechnung, wirksame Fläche, Name, Wohnungszahl

**Files:**
- Create: `shared/rooms.ts`
- Modify: `server/src/snapshot.ts` (alle drei Stellen, die Einheiten übernehmen, um Zeile 706, 1185, 1231), `shared/heating.ts` (`mayAgreeOtherwise`), `server/src/db/heatingInfo.ts` (`agreeableFor` auf dieselbe Regel), `server/src/calc.ts` (§ 5d Abs. 3 um Zeile 7315, `property.kind-mismatch`, Hinweis Einliegerwohnung, Hinweis `unit.rooms-area`), jeder Leser von `Unit.areaM2` oder `Unit.name` für die Abrechnung, der nicht über den Schnappschuss geht (vor Step 3 mit `grep -rn "areaM2\|\.name" server/src` prüfen und im Bericht auflisten)
- Test: `shared/rooms.test.ts` (über `npm run test:server` mitlaufend, wo die übrigen shared-Tests liegen), `server/test/calc-zimmer.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  // shared/rooms.ts
  export function roomName(room: { name: string }, flat: { name: string }): string  // "Zimmer 1 in der Wohnung 1. OG links"
  export function effectiveRoomAreas(flat: Unit, rooms: Unit[]): Map<string, number>
  // Sicht der Rechnung: Zimmer mit wirksamer Fläche und vollem Namen, Wohnung mit Zimmern als
  // participates:false, selfUsed:false, areaM2:0, usageChanges:[]; `flatOf` und `roomsOf` für calc.ts.
  export function roomView<U extends Unit>(units: U[]): { units: U[]; flatOf: Map<string, U>; roomsOf: Map<string, U[]>; rawArea: Map<string, number> }
  ```
  Die Wohnungszahl bekommt eine Liste je Wohnung: Einheiten ohne `parentUnitId` und ohne Zimmer wie heute, je Wohnung mit Zimmern ein Eintrag (Wohnung, wenn eines ihrer Zimmer `isDwelling` erfüllt; selbstgenutzt, wenn ein Zimmer im Zeitraum selbstgenutzt und keines vermietet ist).

- [ ] **Step 1: Failing tests:**
  - `effectiveRoomAreas`: Wohnung 80 m², Zimmer 12/12/16 → 24 / 24 / 32; Wohnung 0 → 12/12/16; alle Zimmer 0 → 26,67 je (Summe 80).
  - `roomName` wie oben.
  - calc-zimmer: Haus mit Wohnung A 60 m² (vermietet) und WG 80 m² mit drei Zimmern 12/12/16, Grundsteuer 1.000 € nach Fläche: A trägt 428,57 € wie im Bestand ohne Zimmer mit WG als 80-m²-Wohnung (Orakel, centgleich); Zimmer tragen 171,43 / 171,43 / 228,57.
  - Rechenweg des Zimmers nennt `/12,00 m²|24,00 m²/` und `/Anteil an 80/`; `Statement.unitName` = „Zimmer 1 in der Wohnung WG“.
  - Wohnungszahl: EG selbstgenutzt + WG mit zwei vermieteten Zimmern → `mayAgreeOtherwise` true (zwei Wohnungen); EG vermietet + WG, ein Zimmer selbstgenutzt, eines vermietet → false; dasselbe über `agreeableFor`.
  - Hinweis `unit.rooms-area` bei Wohnungsfläche 0.
  - Ohne `parentUnitId` (drei Zimmer als Wohnungen „WG, Zimmer 1“ …): Ergebnis wie vor dem Umbau (Vergleich mit Golden-Lauf, Review Focus 4).
- [ ] **Step 2: Run** `node --test server/test/calc-zimmer.test.ts` → FAIL.
- [ ] **Step 3:** `shared/rooms.ts`; `roomView` an allen Stellen anwenden, an denen der Schnappschuss Einheiten übernimmt; Rechenweg mit Rohfläche (`rawArea`) ergänzen; Wohnungszahl umstellen.
- [ ] **Step 4: Run** `npm run test:server` → nur der bekannte lokale Geviertstrich-Fehler (gitignorierte `server/src/embedded-client.js`); `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(abrechnung): Zimmer mit wirksamer Fläche und Namen, Wohnung zählt einmal (Refs #573)`.

### Task 3: Zähler der Wohnung auf die Zimmer, Einheiten-Gewicht, Hinweise

**Files:**
- Modify: `server/src/calc.ts` (`consumptionFor` um Zeile 3801, `perUnit`/`unitUse`, Zweig `meter` und `meterRest` um Zeile 5994-6200, `keyRaws` Zweig `units` um Zeile 5776), `server/src/meterRest.ts` nur falls nötig, `shared/noticeKinds.ts` (oder wo `noticeKinds` steht)
- Test: `server/test/calc-zimmer.test.ts`, `server/test/calc-invarianten.test.ts` (oder die Datei der Zufallsbestände)

**Interfaces:**
- Consumes: Task 2 (`roomView`, `flatOf`, `roomsOf`), `planMeterRest`, `keyRaws` aus #98.
- Produces: Rohwerte je Mietverhältnis und Vermieterteil für Zimmer aus dem Wohnungszähler; `keyRaws('units', …)` mit Gewicht je Einheit (`unitWeight(u) = 1`, für ein Zimmer Anteil an der Rohfläche der Zimmer seiner Wohnung, alle 0 → 1/n).

- [ ] **Step 1: Failing tests** (WG mit drei Zimmern 12/12/16 m², Wohnung 80 m², Wohnungszähler Kaltwasser 100 m³, Wohnung A mit eigenem Zähler 50 m³, Hauptzähler 150 m³, Wasser 600 €):
  - `roomSplit` fehlend: A 200 €; Zimmer 120 / 120 / 160 € (nach wirksamer Fläche × Tage).
  - `roomSplit: 'persons'`, Zimmer je 1 Person, Zimmer 3 nur 01.01.-30.06. vermietet: der leere Teil von Zimmer 3 geht an den Vermieter (Grund wie `outside`), die anderen Zimmer tragen nicht mehr als im ganzjährig vermieteten Fall (Review Focus 2).
  - Zimmer 2 nicht in `participantUnitIds`: sein Teil an den Vermieter, Hinweis `rooms.outside-basis` mit `/120,00 €/` (Review Focus 3).
  - Zimmer 1 selbstgenutzt: sein Teil als Eigenanteil (`selfUse`).
  - Zimmer 1 hat selbst einen Kaltwasserzähler: `meter.rest-mixed`, Position nicht verteilt.
  - Kein Hauptzähler-Rest (#116) entsteht durch die Zimmer: Hauptzähler 150 = A 50 + Wohnung 100, Rest 0.
  - `meterRest` mit Bezug Hauptzähler und `behindMeterIds` = [Zähler A, Wohnungszähler]: gleiche Beträge wie oben.
  - Einheiten-Schlüssel, Müll 300 € auf A und WG: A 150 €, Zimmer 45 / 45 / 60 €; ein leeres Zimmer → sein Teil an den Vermieter.
  - `rooms.household-cost` bei Position „Internet“ (Sonstige) mit Teilnehmern = Zimmer der WG und bei Stromzähler der Wohnung; nicht bei Wasser.
  - Invariante über Zufallsbestände mit Zimmern (fester Startwert): Mieteranteile + Vermieteranteil = Gesamtkosten, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil, Gutschrift mit Vorzeichen.
- [ ] **Step 2: Run** `node --test server/test/calc-zimmer.test.ts` → FAIL.
- [ ] **Step 3:** Teilung vor der Zählung der Zimmer als gemessen; Teile über `keyRaws` mit Gruppe = alle Zimmer, Nicht-Basis-Teile an den Vermieter; ein `distributeCents` je Position; Gewicht im Zweig `units`; Hinweise mit Betrag.
- [ ] **Step 4: Run** `npm run test:server` → nur der bekannte lokale Fehler; Golden unverändert; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(abrechnung): Zähler der Wohnung auf die Zimmer, Wohnung als eine Einheit (Refs #573)`.

### Task 4: Oberfläche, Lexikon, Doku

**Files:**
- Modify: `client/src/unitForm.ts`, `client/src/pages/Stammdaten.tsx` (Feld „Liegt als Zimmer in der Wohnung“, Liste eingerückt, „N Zimmer“, Nutzung/Personen/Nutzungswechsel an der Wohnung mit Zimmern ausgeblendet mit Satz), `client/src/costForm.ts` und Kostenformular (Auswahl „Zähler der Wohnung auf die Zimmer verteilen nach: Fläche / Personentagen“, nur wenn in der Basis eine Wohnung mit Zimmern und Zähler der Sparte liegt), `client/src/meterForm.ts` (nur die drei Sparten an der Wohnung), `unitDeleteMessage`/`unitDeleteBlocked` (Zimmer), `shared/glossary.ts` (Begriff „Zimmer einer Wohnung (WG)“ mit Beispiel, Wechsel zur WG, Heizung und § 12), `docs/` (Funktionsweise), `CHANGELOG.md` (Unveröffentlicht, Link auf #573), `server/src/CLAUDE.md` (Abschnitt Verteilung: Zimmer)
- Test: `client/src/unitForm.test.ts`, `client/src/costForm.test.ts`, jsdom-Test der neuen Auswahlfelder (angezeigter Wert = gespeicherter Wert)

- [ ] **Step 1: Failing tests:** `buildUnitBody` mit `parentUnitId`; Auswahl bietet nur Wohnungen desselben Objekts ohne eigenen Verweis und nicht die Einheit selbst; Wohnung mit Mietverhältnis nicht wählbar; `costForm` speichert `roomSplit` nur bei Schlüssel `meter`; Spartenliste am Zählerformular einer Wohnung mit Zimmern; jsdom: beide Auswahlfelder zeigen den gespeicherten Wert.
- [ ] **Step 2: Run** `npm --prefix client test -- unitForm costForm` → FAIL.
- [ ] **Step 3:** Umsetzen; Lexikon und Doku schreiben.
- [ ] **Step 4: Run** `npm run test:client` → PASS; `npm run typecheck` → PASS; `npm run browser-check` (Chromium) auf Stammdaten und Kosten ohne Befund.
- [ ] **Step 5: Commit** `feat(oberflaeche): Zimmer in den Stammdaten und an der Kostenposition (Refs #573)`.

## Nach den Aufgaben

Gesamtdurchsicht mit frischem Kontext unter den Blickwinkeln Geld und Daten; Befunde mit vorher rotem Test beheben; PR auf `main` mit `Refs #573`, Label `full-check`, Befunde in der Beschreibung. Vor dem Merge anhalten.
