# Heizung PR 9: Etagenheizung auf Vermietervertrag und mehrere Anlagen (#97) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Objekt kann mehrere Heizanlagen haben, jede mit Namen und eigenen Wohnungen, jede mit
eigener CO₂-Einstufung; eine Heizposition, deren Verteilbasis in zwei Anlagen reicht, meldet sich als
Fehler. Etagenheizungen, deren Gasvertrag der Vermieter hat (§ 5 Abs. 1 Satz 2 CO2KostAufG), werden
eine Anlage `perUnit`: die Rechnung jeder Wohnung direkt bei ihr, die Einstufung über Σ kg / Σ Fläche
der vermieteten Wohnungen mit Lieferung und der Abzug je Mietverhältnis r_t = ‰ · C_u · x_t / A_u, ohne
Normierung.

**Architecture:** Kein Migrationsschritt: `heating_plants.supply`, `heating_plant_units` und
`fuel_deliveries.unit_id` legen PR 4 und PR 7 an. Die Sperren aus PR 4 (zweite Anlage, `perUnit`) und
PR 7 (`unit_id`) fallen; an ihre Stelle treten Prüfungen über alle Anlagen des Objekts
(`guardPlantsOfProperty` in `server/src/db/heating.ts`, in derselben Transaktion wie das Schreiben), an
den Heizpositionen einer Etagenheizung (`guardCostItemHeating`) und an ihren Lieferungen
(`guardFuelDelivery`, PR 7). Die Rechnung steht als reine Funktionen in `server/src/co2.ts`
(`itemBasisUnits`, `spanningPlants`, `perUnitClassification`, `perUnitReliefs`, `perUnitExceeding`);
`computeSettlement` nimmt eine Position über zwei Anlagen aus jedem Topf und setzt bei `perUnit` E,
Fläche und Abzug der eigenen Aufteilung (Naht N2 zu PR 7). Die Oberfläche bekommt „+ weitere
Heizanlage“, die Etagenheizung in der Einrichtung und die Wahl der Anlage an Kostenposition, Zähler und
Lieferung.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
1.1 (W6, W7), 1.2 Nr. 1, 3.0 („Jede Heizposition trägt den Schlüssel einer Heizperiode ihrer
Anlage“), 5.3 (`supply`, `name` „ab der zweiten Anlage Pflicht“, `heating_plant_units` „Ab zwei Anlagen
müssen alle Zeilen haben und sich ausschließen (400, auch beim Wiederherstellen)“), 5.4 (`unit_id` „nur
bei `perUnit` (F8)“), 5.9, 6.1 Nr. 4, 9.1, **9.2 Nr. 1** („Bei `perUnit` nur vermietete Wohnungen mit
Lieferung ([G] § 5 Abs. 1 S. 2: ‚deren Gesamtwohnfläche‘)“), **9.3 ganz** (F9, F8), 9.4, 10.1
(`co2.item-spans-plants`, error, PR 9), 11.2 Schritt 1 („Vertrag beim Vermieter: `perUnit`,
Direktzuordnung je Wohnung“), 12.3 Nr. 9, 13, 12.4 („Überlappende Anlagen → 400“, „Sperren je PR“),
13 (PR 9: „`perUnit`, zweite Anlage, `co2.item-spans-plants`“), 14.1 (Zeilen „Etagenheizung, Vertrag
beim Vermieter“, „Mehrere Heizungen in einem Objekt“).

**Baut auf:** PR 1 bis PR 6 (Pläne `docs/superpowers/plans/2026-10-05-heizung-pr{1..6}-*.md`), PR 7
(Plan `…-pr7-lieferungen.md`, parallel entstanden, siehe „Annahmen über PR 7“) und PR 8 (Plan
`…-pr8-vorrat.md`). Gearbeitet wird auf `feat/heizung-pr9-etagenheizung`, abgezweigt von der Spitze
von PR 8; der PR wird gestapelt auf PR 8 gestellt und nach dessen Merge auf `main` umgestellt.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Mit einer Anlage (`central`) ist
  jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 8. Golden F01–F15
  bleiben wortgleich.
- **Kein neuer Migrationsschritt.** Alle Spalten bestehen (PR 4: `supply`, `name`, `heating_plant_units`;
  PR 7: `fuel_deliveries.unit_id`). Was über Tabellen hinweg gilt (Wohnungen schließen sich aus, Name ab
  der zweiten Anlage, `unit_id` nur bei `perUnit`), lässt sich nicht als Bedingung in SQL schreiben und
  steht in repository.ts, heating.ts und fuel.ts; das Wiederherstellen prüft es mit
  `heatingPlantViolations` (PR 4) und der Ergänzung in Task 1.
- **Rechtswerte nur aus dem Register:** Dieser Plan bringt keinen Parameter; § 5 Abs. 1 Satz 2
  CO2KostAufG ist eine Regel über die Fläche, keine Zahl. `server/src/co2.ts` steht seit PR 6 in
  `ENGINE_FILES`.
- **Ab zwei Anlagen** (5.3): jede mit Namen (nicht leer, im Objekt verschieden), jede mit ihrer Liste
  der Wohnungen, keine Wohnung an zweien. Verstößt ein Schreiben dagegen, 400 mit einem Satz, nichts
  geschrieben. Das Anlegen der zweiten Anlage darf die erste im selben Schritt benennen und eingrenzen
  (`adjust`), damit nie ein halber Stand entsteht.
- **Etagenheizung** (9.3, 11.2): `supply = 'perUnit'` nur mit `method = 'manual'` (Direktzuordnung je
  Wohnung) und nur ohne Vorrat (Festlegung 3); jede Heizposition der Anlage hat den Schlüssel
  „Direktzuordnung“ auf eine Wohnung der Anlage; jede Lieferung trägt eine Wohnung der Anlage; eine
  verknüpfte Lieferung gehört zur Wohnung ihrer Position. Eine zentrale Anlage nimmt keine Lieferung
  mit Wohnung.
- **Einstufung bei `perUnit`** (9.2 Nr. 1, § 5 Abs. 1 Satz 2 im Wortlaut am 05.10.2026 gelesen:
  „vermietet er in einem Gebäude mehrere Wohnungen mit gesonderter oder zentraler Versorgung mit Wärme
  oder mit Wärme und Warmwasser, ist deren Gesamtwohnfläche maßgeblich“): Σ kg / Σ Fläche über die
  vermieteten Wohnungen mit Lieferung in der Heizperiode; eine eingetragene Fläche der Einstufung
  (`co2_statements.area_m2`) geht vor.
- **Abzug bei `perUnit`** (9.3): r_t = ‰/1000 · C_u · x_t / A_u je Mietverhältnis, **ohne** Normierung;
  was in A_u auf Leerstand, Eigennutzung oder Pauschale fällt, bleibt ohne Abzug beim Vermieter. R =
  round(Σ r_t) als eine Verteilung (`distributeCents`). C_u > A_u oder C_u ohne Heizposition →
  `co2.exceeds-heating` (PR 7) für diese Wohnung, und sie bekommt keinen Abzug.
- **Position über zwei Anlagen** (9.3 F9, 10.1): `co2.item-spans-plants` (error); die Position wird
  weiter nach ihrem Schlüssel verteilt (keine Zahl der Kosten ändert sich), gehört aber zu keinem Topf
  und mindert keinen Abzug.
- **Zwei Anlagen rechnen unabhängig** (12.3 Nr. 13): Topf, Einstufung, Abzug und Hinweise einer Anlage
  hängen nicht von der anderen ab.
- **Stufe hängt am Code** (#112): `co2.item-spans-plants` steht mit genau einer Stufe in `noticeKinds`
  und trägt mindestens einen Begriff.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`, beim Smoke-Test der Aufruf von Hand
  (Task 6).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #97` (dazu `#99` bei der Anlage) und
  endet mit den Attribution-Zeilen der ausführenden Sitzung. Aufgaben stehen nur in den GitHub-Issues
  des Repos, nie in Beads (CLAUDE.md).

## Review Focus

1. **Eine zweite Anlage kommt zu einer ersten ohne Namen und ohne Liste der Wohnungen** (der
   häufigste Weg: erst eine Anlage für das ganze Haus, später die Etagenheizung der Einliegerwohnung).
   Der Vermieter erwartet, dass die Einrichtung das in einem Schritt erledigt und nicht mit einem Fehler
   über die erste Anlage endet. Erwartet: Das Anlegen nimmt Name und Wohnungen der ersten mit
   (`adjust`), alles in einer Transaktion; scheitert etwas, ist keine der beiden geändert. Test in
   Task 1 und Task 5.
2. **Eine Wohnung wechselt von der zentralen Anlage zur Etagenheizung**, während eine Heizposition der
   zentralen Anlage sie noch über Teilnehmer oder als Hauptbasis enthält. Erwartet: Speichern geht
   (die Anlagen schließen sich aus), die Position meldet `co2.item-spans-plants`, ihre Kosten werden wie
   bisher verteilt, und der Abzug der zentralen Anlage ändert sich nicht durch sie. Test in Task 4.
3. **Mieterwechsel in einer Wohnung mit Etagenheizung, mit Leerstand dazwischen.** Erwartet: Jeder
   Mieter bekommt seinen Abzug nach seinem Anteil an der Gasrechnung der Wohnung; der Teil des
   Leerstands bleibt ohne Abzug beim Vermieter, keine Normierung auf die beiden Mieter (9.3). Test in
   Task 3 und Task 4.
4. **Ein alter Tab oder die Belegbuchung legt eine Heizposition ohne Anlage an, während das Objekt
   zwei Anlagen hat.** Erwartet: Nennt die Position ihre Wohnungen (Direktzuordnung, Teilnehmer,
   Einzelbeträge) und hängen sie alle an genau einer Anlage, bekommt sie diese; sonst bleibt sie ohne
   Anlage, und die Abrechnung sagt an der Position, dass sie zu keiner Anlage gehört, statt „Richten Sie
   die Heizung ein“. Test in Task 1 und Task 4.
5. **Die Gasrechnung einer Etagenheizung wird mit der Wohnung A erfasst und mit der Position der
   Wohnung B verknüpft**, oder eine Lieferung der zentralen Anlage bekommt eine Wohnung. Erwartet: 400
   mit einem Satz beim Speichern; C_u und A_u einer Wohnung können nicht aus zwei Wohnungen stammen.
   Test in Task 2.

---
## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `server/src/db/heating.ts` | Sperren aufheben, Prüfung über alle Anlagen des Objekts, `adjust` beim Anlegen, `perUnit` nur mit `manual` und ohne Vorrat, Befund beim Wiederherstellen | 1, 2 |
| `server/src/db/repository.ts` | Anlage einer neuen Heizposition nach ihren Wohnungen; Heizpositionen einer Etagenheizung | 1, 2 |
| `server/src/db/fuel.ts` (PR 7) | Lieferungen mit Wohnung nur bei `perUnit` | 2 |
| `server/src/co2.ts` | `itemBasisUnits`, `spanningPlants`, `perUnitClassification`, `perUnitReliefs`, `perUnitExceeding` | 3 |
| `server/src/snapshot.ts`, `server/src/calc.ts` | `SnapshotHeatingPlant` mit `supply`; Positionen über zwei Anlagen; Naht N2; exakte Anteile; Hinweistexte | 4 |
| `shared/glossary.ts` | `co2Area` nennt § 5 Abs. 1 Satz 2 | 4 |
| `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx`, `client/src/pages/Kosten.tsx`, `client/src/pages/Zaehler.tsx`, `client/src/meterForm.ts`, Lieferungsformular aus PR 7 | Weitere Heizanlage, Etagenheizung, Wahl der Anlage | 5 |
| `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung, Doku | 6 |
| Tests: `server/test/db-heizanlage.test.ts`, `db-backup.test.ts`, `api.test.ts`, `co2-anlagen.test.ts` (neu), `calc-anlagen.test.ts` (neu), `glossary.test.ts`, `client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.test.tsx`, `client/src/meterForm.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 8 anders umsetzt, zieht ihn hier nach, bevor Task 1
beginnt.

- **PR 4** `shared/types.ts`: `HeatingPlant` (mit `name`, `energy`, `supply`, `method`, `source`,
  `units`), `HeatingSupply`, `HeatingPlantUnit`, `CostItem.heatingPlantId`; `server/src/db/heating.ts`:
  `LATER` (mit `perUnit`, `second`), `mergeHeatingPlant`, `emptyHeatingPlant`,
  `guardHeatingPlant(db, before, after)`, `plantRow`, `writePlantUnits`, `createHeatingPlant(db, id,
  propertyId, body)`, `updateHeatingPlant(db, id, body)`, `readIds`, `readPlantUnits`,
  `heatingPlantViolations(db)`, `plantName`; repository.ts: `HeatingError`, `PLANT_GONE`, `plantOf`,
  `isPeriodClosed`, `guardCostItemHeating(db, before, after)`, `sameProperty`, `raw`, `merged`,
  `asText`, `asNullableFilled`, `oneOfOrUndefined`; schema.ts `heatingPlants`, `heatingPlantUnits`,
  `unitNoConnection`, `units`, `tenancies`; die Tests „Sperren: was spätere Versionen rechnen …“ und
  „Zweite Anlage: im selben Objekt gesperrt, in einem anderen Objekt erlaubt“ in
  `db-heizanlage.test.ts` und „Heizanlage: Sperren, Objektgrenze, Ändern und Entfernen über die Routen“
  in `api.test.ts`; Client `heatingForm.ts` (`HeatingForm`, `heatingPlantBody(form, units)`,
  `heatingToForm`, `emptyHeatingForm`, `ENERGY_OPTIONS`, `CONTRACT_OPTIONS`, `LATER_PER_UNIT`,
  `defaultUnitIds`, `heatingSummary`), `HeatingCard({ units })`, `meterBody(form, plantId)`.
- **PR 5** repository.ts: `defaultHeatingPlant(db, c)` in der Fassung von PR 5, `heatingRulesOf`,
  `itemPeriodClosed`, `rulesForProperty`, `spansTwoYears`, `startYearOf`; `shared/heatingPeriod.ts`
  `servesUnit(plant, unit)`, `heatingPeriodsEndingIn`; Client `heatingItemPeriods(plants, objectRules,
  p)`, der Zustand `plants` und `ownPlant` in `Kosten.tsx`.
- **PR 6** `server/src/co2.ts`: `Co2Pot`, `co2PotsOf(snapshot, items)`, `ReliefShare`,
  `reliefsByShare`; im CO₂-Block von `computeSettlement` `co2Pots`, `heatingSettled`, `cutsOn`,
  `where`, `ids`, `plantSubject`, `hPeriod`, `st`; der Block „Heizpositionen ohne Heizanlage“ mit
  `inPots`, `loose`, `co2Duty`, `setUp`; `warn`, `itemSubject`, `andList`, `fmtCents`, `unitById`,
  `basisUnits`, `statements`, `distributeCents`; `server/testing/co2.ts`.
- **PR 8** calc.ts: `stockCarry` und die Zeile `co2PotsOf(snapshot, [...items, ...stockCarry])`;
  `shared/fuelStock.ts`: `STOCK_ENERGIES`, `isStockEnergy`.

## Annahmen über PR 7

Der Plan von PR 7 lag beim Schreiben nicht vor. Die Annahmen A1, A4, A6, A7 und A11 des Plans von PR 8
gelten hier ebenso; dazu:

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| B1 | `guardFuelDelivery(db, plant, after)` (A6) lehnt eine Lieferung mit Wohnung ab: `if (after.unitId !== null) throw new HeatingError(400, LATER.perUnit)`; `plant` ist der gelesene Datensatz (`HeatingPlant`) | Task 2 |
| B2 | Die eigene Aufteilung eines Topfs (Naht N2) rechnet in dieser Reihenfolge und unter diesen Namen: `fuel` (A7) → `areaM2` (Fläche der Einstufung) → `permille` (Anteil des Vermieters nach Stufe, § 8 und § 9) → `landlordCents` (L) → `const raws: { tenancyId: string; raw: number }[] = reliefsByShare(landlordCents, shares, fuelCents)` → Verteilung von R = round(Σ raw) mit `distributeCents`, Zeilen `co2Relief`, Gegenzeile `co2Share` | Task 4 |
| B3 | `fuelTotals(pot, snapshot, lawLog)` liest die Lieferungen aus `snapshot.fuelDeliveries`, eingegrenzt auf `pot.plantId` | Task 4 |
| B4 | Der Code `co2.exceeds-heating` (error) steht in `noticeKinds` (Entwurf 10.1, PR 7) | Task 4 |
| B5 | Das Formular der Lieferungen steht in `client/src/fuelForm.ts` (`FuelDeliveryForm`, `fuelDeliveryBody(form, plant)`) und der Karte `FuelDeliveriesCard` | Task 5 |

Vor Task 1 gleicht die ausführende Sitzung jede Zeile mit Plan und Code von PR 7 ab und ersetzt in
diesem Plan jeden abweichenden Namen. Nur an Naht N2 (Task 4 Step 6) und am Lieferungsformular (Task 5 Step 7) hängt der Wortlaut vom Code von
PR 7.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

1. **Kein Migrationsschritt.** Der Entwurf (13 PR 9) nennt keinen, und keiner ist nötig.
2. **Namen ab zwei Anlagen verschieden** (5.3 sagt nur „Pflicht“): Hinweise und Ausweis nennen die
   Anlage beim Namen; zwei gleiche Namen machten sie ununterscheidbar.
3. **`perUnit` nur mit freien Schlüsseln und ohne Vorratsenergie.** Der Entwurf (11.2) sagt
   „Direktzuordnung je Wohnung“, also `manual`; ein Messdienst je Wohnung rechnet keine Etagenheizung ab,
   und die eigene Heizkostenabrechnung (PR 10) setzt eine zentrale Anlage voraus. Vorratsenergien hätten
   je Wohnung einen eigenen Tank, und der Vorrat (PR 8) hängt an der Heizperiode der Anlage, nicht der
   Wohnung; der Entwurf spricht hier von der Gasetagenheizung.
4. **Eine neue Heizposition ohne Anlage bei mehreren Anlagen** bekommt die Anlage, an der alle ihre
   genannten Wohnungen hängen (Direktzuordnung, Teilnehmer, Einzelbeträge), sonst keine (PR 4 ließ
   die Entscheidung ausdrücklich bei mehreren Anlagen offen). So landet die Gasrechnung einer
   Etagenheizung, die ein alter Tab direkt der Wohnung zuordnet, im richtigen Topf.
5. **Position ohne Anlage, wenn das Objekt Anlagen hat:** Der Hinweis aus PR 6 („Mietfuchs weiß nicht,
   womit das Haus geheizt wird … Richten Sie die Heizung ein“) wäre falsch. Derselbe Code
   `co2.fuel-unknown` sagt dann an der Position, dass sie zu keiner Anlage gehört.
6. **Die Fläche der Einstufung bei `perUnit`** zählt die vermieteten Wohnungen mit Lieferung in der
   Heizperiode (9.2 Nr. 1); eine Wohnung mit Mieterwechsel und Leerstand bleibt vermietet im Sinne von
   `participates`. Die eingetragene Fläche (`area_m2`) geht wie bei der zentralen Anlage vor.

---
### Task 1: Mehrere Heizanlagen in einem Objekt

Die Sperre der zweiten Anlage fällt. An ihre Stelle tritt eine Prüfung über alle Anlagen des Objekts
nach jedem Schreiben (Entwurf 5.3): Namen, Listen der Wohnungen, keine Wohnung an zweien. Das
Anlegen nimmt Änderungen an den übrigen Anlagen mit (`adjust`), damit die erste beim Anlegen der zweiten
in derselben Transaktion Namen und Grenzen bekommt (Review Focus 1). Eine neue Heizposition ohne Anlage
bekommt bei mehreren Anlagen die, an der ihre genannten Wohnungen hängen (Festlegung 4).

**Files:**
- Modify: `server/src/db/heating.ts`, `server/src/db/repository.ts`
- Test: `server/test/db-heizanlage.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes (PR 4, PR 5): `LATER`, `mergeHeatingPlant`, `guardHeatingPlant`, `plantRow`, `writePlantUnits`, `readHeatingPlants`, `createHeatingPlant`, `updateHeatingPlant`; `defaultHeatingPlant` (Fassung PR 5), `heatingRulesOf`, `itemPeriodClosed`, `isPeriodClosed`, `rulesForProperty`, `spansTwoYears`, `startYearOf`, `heatingPeriodsEndingIn`, `periodOfKey`; `has`, `raw`, `asNullableFilled`, `HeatingError`; schema `heatingPlants`, `heatingPlantUnits`, `units`, `tenancies`.
- Produces:
  - heating.ts: `guardPlantsOfProperty(db: Executor, propertyId: string): Promise<void>`; `createHeatingPlant` nimmt im Rumpf `adjust: { id: string; name?: string; units?: HeatingPlantUnit[] | null }[]`
  - repository.ts: `plantForNewItem(db: Executor, c: CostItem): Promise<string | null>`; `defaultHeatingPlant` (Fassung PR 9)

- [ ] **Step 1: Write the failing tests**

In `server/test/db-heizanlage.test.ts`:

(a) Im Test „Sperren: was spätere Versionen rechnen, lehnt der Server mit einem Satz ab“ (PR 4) die
Zeile `[{ supply: 'perUnit' }, /Etagenheizungen .* kommen mit einer späteren Version/],` entfernen
(die Etagenheizung prüft Task 2).

(b) Den Test „Zweite Anlage: im selben Objekt gesperrt, in einem anderen Objekt erlaubt“ (PR 4)
ersetzen durch:

```ts
test('Zweite Anlage (Heizung PR 9): mit Namen und Wohnungen; die erste bekommt beides im selben Schritt (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    // Die erste hat weder Namen noch Liste: ohne Anpassung entsteht nichts, und die erste bleibt, wie sie war.
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })),
      refused(400, /braucht jede einen Namen/),
    )
    assert.deepEqual((await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).map((p) => [p.id, p.name, p.units]), [['hp1', '', null]])
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', {
      name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }],
      adjust: [{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }],
    }))
    assert.equal(plant.name, 'Gastherme DG')
    const erste = (await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).find((p) => p.id === 'hp1')
    assert.deepEqual([erste?.name, erste?.units?.map((u) => u.unitId)], ['Zentralheizung', ['eg', 'og']])
    // Eine Anpassung an einer Anlage eines anderen Objekts wird abgelehnt.
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' }))
    await opened.write((db) => createHeatingPlant(db, 'hpx', 'objekt-2', { energy: 'oil' }))
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp3', 'objekt-1', { name: 'Keller', energy: 'gas', units: [], adjust: [{ id: 'hpx', name: 'Fremd' }] })),
      refused(409, /gibt es nicht mehr/),
    )
  })
})

test('Zwei Anlagen: Wohnungen schließen sich aus, Namen verschieden, keine ohne Liste und ohne Namen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Zentralheizung', energy: 'gas', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] })
      await createHeatingPlant(db, 'hp2', 'objekt-1', { name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    })
    const aendern = (id: string, body: unknown) => opened.write((db) => updateHeatingPlant(db, id, body))
    await assert.rejects(() => aendern('hp2', { units: [{ unitId: 'dg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }), refused(400, /Die Wohnung „og“ hängt an „(Zentralheizung|Gastherme DG)“ und an „(Zentralheizung|Gastherme DG)“/))
    await assert.rejects(() => aendern('hp2', { name: 'zentralheizung' }), refused(400, /Zwei Heizanlagen heißen „[Zz]entralheizung“/))
    await assert.rejects(() => aendern('hp1', { units: null }), refused(400, /braucht jede ihre Wohnungen/))
    await assert.rejects(() => aendern('hp1', { name: ' ' }), refused(400, /braucht jede einen Namen/))
    // Nichts davon ist gespeichert.
    assert.deepEqual((await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).map((p) => [p.name, p.units?.map((u) => u.unitId)]), [['Zentralheizung', ['eg', 'og']], ['Gastherme DG', ['dg']]])
    // Ohne die zweite gilt wieder alles wie bei einer Anlage.
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp2'))).removed, true)
    assert.equal((await aendern('hp1', { name: '', units: null }))?.units, null)
  })
})

test('Neue Heizposition ohne Anlage bei zwei Anlagen: die Anlage ihrer Wohnungen, sonst keine (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createEntity(db, 'tenancies', 't-dg', { unitId: 'dg', tenantName: 'Mieter DG', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Zentralheizung', energy: 'gas', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] })
      await createHeatingPlant(db, 'hp2', 'objekt-1', { name: 'Haus B', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    })
    const anlage = async (id: string, extra: Record<string, unknown>) => fieldOf(await opened.write((db) => heizposition(db, id, '2025-01', extra)), 'heatingPlantId')
    assert.equal(await anlage('direkt', { key: 'direct', directUnitId: 'dg' }), 'hp2')
    assert.equal(await anlage('teilnehmer', { participantUnitIds: ['eg', 'og'] }), 'hp1')
    assert.equal(await anlage('einzel', { key: 'amounts', tenancyAmounts: { 't-dg': 50000 } }), 'hp2')
    assert.equal(await anlage('ganzes-haus', {}), undefined)
    assert.equal(await anlage('ueber-beide', { participantUnitIds: ['og', 'dg'] }), undefined)
  })
})
```

`createProperty`, `createEntity`, `updateEntity`, `removeHeatingPlant`, `updateHeatingPlant` stehen im
Import der Datei seit PR 4; fehlt einer, ergänzen.

In `server/test/api.test.ts` im Test „Heizanlage: Sperren, Objektgrenze, Ändern und Entfernen über die
Routen“ (PR 4) die drei Zeilen zur zweiten Anlage

```ts
    const zweite = await send('/api/heating-plants', postJson({ energy: 'gas' }))
    assert.equal(zweite.status, 400)
    assert.match(await errorFrom(zweite), /zweite Heizanlage/)
```

ersetzen durch:

```ts
    // Heizung PR 9: Eine zweite Anlage braucht Namen und Wohnungen, die erste ebenso.
    const zweite = await send('/api/heating-plants', postJson({ energy: 'gas' }))
    assert.equal(zweite.status, 400)
    assert.match(await errorFrom(zweite), /braucht jede einen Namen/)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/api.test.ts`
Expected: FAIL. Die zweite Anlage wird mit „Eine zweite Heizanlage im selben Objekt kommt mit einer
späteren Version“ abgelehnt, und die neue Heizposition bekommt bei zwei Anlagen keine.

- [ ] **Step 3: Die Anlagen eines Objekts (`server/src/db/heating.ts`)**

Importe ergänzen: `has` aus `'./repository.ts'` (falls nicht da), `units` aus `'./schema.ts'`,
`inArray` aus `'drizzle-orm'` (seit PR 4 vorhanden).

In `LATER` den Eintrag `second` streichen. In `guardHeatingPlant` den Block

```ts
  if (before === null) {
    const [schon] = await db.select({ n: count() }).from(heatingPlants).where(eq(heatingPlants.propertyId, after.propertyId))
    if ((schon?.n ?? 0) > 0) throw new HeatingError(400, LATER.second)
  }
```

ersatzlos streichen. Darunter, vor `const plantRow`:

```ts
const NAME_REQUIRED = 'Bei mehreren Heizanlagen braucht jede einen Namen, etwa „Haus A“ oder „Gastherme EG“.'

// Ab zwei Anlagen in einem Objekt (Heizung PR 9, Entwurf 5.3): jede mit Namen, verschieden im Objekt,
// jede mit ihrer Liste der Wohnungen, und keine Wohnung an zweien. Sonst verteilten zwei Anlagen
// dieselben Kosten auf dieselben Mieter, und Hinweise und Ausweis könnten sie nicht auseinanderhalten.
// Geprüft wird über alle Anlagen des Objekts **nach** dem Schreiben, in derselben Transaktion; scheitert
// die Prüfung, wird nichts gespeichert. Mit einer Anlage gilt nichts davon.
export async function guardPlantsOfProperty(db: Executor, propertyId: string): Promise<void> {
  const plants = await db
    .select({ id: heatingPlants.id, name: heatingPlants.name, unitsLimited: heatingPlants.unitsLimited })
    .from(heatingPlants)
    .where(eq(heatingPlants.propertyId, propertyId))
  if (plants.length < 2) return
  const seen = new Set<string>()
  for (const p of plants) {
    const name = p.name.trim()
    if (name === '') throw new HeatingError(400, NAME_REQUIRED)
    const key = name.toLocaleLowerCase('de-DE')
    if (seen.has(key)) throw new HeatingError(400, `Zwei Heizanlagen heißen „${name}“. Bitte geben Sie ihnen verschiedene Namen.`)
    seen.add(key)
    if (!p.unitsLimited) {
      throw new HeatingError(400, `Bei mehreren Heizanlagen braucht jede ihre Wohnungen. Wählen Sie bei „${name}“ aus, welche Wohnungen an ihr hängen.`)
    }
  }
  const rows = await db
    .select({ plantId: heatingPlantUnits.plantId, unitId: units.id, unitName: units.name })
    .from(heatingPlantUnits)
    .innerJoin(units, eq(heatingPlantUnits.unitId, units.id))
    .where(inArray(heatingPlantUnits.plantId, plants.map((p) => p.id)))
  const nameOf = new Map(plants.map((p) => [p.id, p.name.trim()]))
  const owner = new Map<string, string>()
  for (const r of rows) {
    const first = owner.get(r.unitId)
    if (first !== undefined && first !== r.plantId) {
      throw new HeatingError(400, `Die Wohnung „${r.unitName}“ hängt an „${nameOf.get(first) ?? ''}“ und an „${nameOf.get(r.plantId) ?? ''}“. Jede Wohnung hängt an genau einer Heizanlage.`)
    }
    owner.set(r.unitId, r.plantId)
  }
}

// Name und Wohnungen anderer Anlagen desselben Objekts, die mit dem Anlegen geändert werden (Heizung
// PR 9): So bekommt die erste Anlage beim Anlegen der zweiten Namen und Grenzen im selben Schritt.
// Andere Felder einer Anlage ändert nur `updateHeatingPlant`.
function readAdjust(value: unknown): { id: string; body: Record<string, unknown> }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row: unknown) => {
    const id = asNullableFilled(raw(row, 'id'))
    if (id === null) return []
    const body: Record<string, unknown> = {}
    if (has(row, 'name')) body.name = raw(row, 'name')
    if (has(row, 'units')) body.units = raw(row, 'units')
    return [{ id, body }]
  })
}
```

`createHeatingPlant` (Fassung PR 4/PR 5): vor `await db.transaction(` die Zeilen

```ts
  const adjust = readAdjust(raw(body, 'adjust'))
  const others = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
```

und im Rumpf der Transaktion vor `await guardHeatingPlant(tx, null, plant)`:

```ts
    // Heizung PR 9: erst die übrigen Anlagen des Objekts anpassen, dann die neue anlegen, dann alle
    // zusammen prüfen.
    for (const a of adjust) {
      const current = others.find((p) => p.id === a.id)
      if (!current) {
        throw new HeatingError(409, 'Eine andere Heizanlage dieses Objekts gibt es nicht mehr. Bitte öffnen Sie die Einrichtung erneut; angelegt wurde nichts.')
      }
      const next = mergeHeatingPlant(current, a.body)
      await guardHeatingPlant(tx, current, next)
      const { id: _id, ...rest } = plantRow(next)
      await tx.update(heatingPlants).set(rest).where(eq(heatingPlants.id, current.id))
      await writePlantUnits(tx, next)
    }
```

und am Ende des Rumpfs der Transaktion (hinter dem Zuordnen der Positionen):

```ts
    await guardPlantsOfProperty(tx, propertyId)
```

`updateHeatingPlant`: am Ende des Rumpfs der Transaktion (hinter `await writePlantUnits(tx, next)`):

```ts
    await guardPlantsOfProperty(tx, current.propertyId)
```

- [ ] **Step 4: Anlage einer neuen Heizposition (`server/src/db/repository.ts`)**

Hinter `isPeriodClosed` (PR 4):

```ts
// Die Wohnungen, die eine Position selbst nennt (Heizung PR 9): bei Direktzuordnung ihre Wohnung, mit
// Teilnehmern diese, bei Einzelbeträgen die Wohnungen der Mietverhältnisse und die eigenen Wohnungen
// mit Betrag. Ohne solche Angabe verteilt die Position über das ganze Haus und nennt keine.
async function namedUnitsOf(db: Executor, c: CostItem): Promise<string[]> {
  if (c.key === 'direct') return c.directUnitId ? [c.directUnitId] : []
  if (c.participantUnitIds) return [...new Set(c.participantUnitIds)]
  if (c.key === 'amounts') {
    const ids = Object.keys(c.tenancyAmounts ?? {})
    const rows = ids.length > 0 ? await db.select({ unitId: tenancies.unitId }).from(tenancies).where(inArray(tenancies.id, ids)) : []
    return [...new Set([...rows.map((r) => r.unitId), ...Object.keys(c.selfAmounts ?? {})])]
  }
  return []
}

// Die Anlage einer neuen Heizposition ohne Angabe (Heizung PR 9, Festlegung 4): die einzige des
// Objekts; bei mehreren die, an der alle von der Position genannten Wohnungen hängen. Nennt sie keine
// oder liegen sie an verschiedenen Anlagen, keine, und der Vermieter ordnet zu. Ab zwei Anlagen hat
// jede ihre Liste (heating.ts, `guardPlantsOfProperty`).
export async function plantForNewItem(db: Executor, c: CostItem): Promise<string | null> {
  const plants = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.propertyId, c.propertyId))
  const [first] = plants
  if (!first) return null
  if (plants.length === 1) return first.id
  const named = await namedUnitsOf(db, c)
  if (named.length === 0) return null
  const rows = await db.select({ plantId: heatingPlantUnits.plantId, unitId: heatingPlantUnits.unitId }).from(heatingPlantUnits)
    .where(inArray(heatingPlantUnits.plantId, plants.map((p) => p.id)))
  const fits = plants.filter((p) => named.every((u) => rows.some((r) => r.plantId === p.id && r.unitId === u)))
  return fits.length === 1 && fits[0] ? fits[0].id : null
}
```

`defaultHeatingPlant` (Fassung PR 5) ersetzen:

```ts
// Die Anlage, die eine neue Heizposition ohne Angabe bekommt (Heizung PR 4, PR 5, PR 9): die aus
// `plantForNewItem`, außer ihr Zeitraum ist abgeschlossen (Entwurf 3.0). Rechnet die Anlage in eigenen
// Heizperioden ab (PR 5), kommt die Position in die Heizperiode, die in ihrem Objektzeitraum endet, mit
// dem Jahr der Zahlung des Objektzeitraums, wenn die Heizperiode über zwei Kalenderjahre reicht. Endet
// dort keine oder mehr als eine Heizperiode, bleibt sie ohne Anlage, und der Vermieter ordnet sie zu.
async function defaultHeatingPlant(db: Executor, c: CostItem): Promise<Pick<CostItem, 'heatingPlantId' | 'period' | 'taxYear'>> {
  const none = { heatingPlantId: null, period: c.period, taxYear: c.taxYear }
  if (c.category !== HEATING_CATEGORY) return none
  const plantId = await plantForNewItem(db, c)
  if (plantId === null) return none
  if (await isPeriodClosed(db, c.propertyId, c.period)) return none
  const heating = await heatingRulesOf(db, plantId)
  if (!heating?.own) return { ...none, heatingPlantId: plantId }
  const p = periodOfKey(await rulesForProperty(db, c.propertyId), c.period)
  const enden = p === null ? [] : heatingPeriodsEndingIn(heating.rules, p)
  const h = enden.length === 1 ? enden[0] : undefined
  if (h === undefined) return none
  const neu = { heatingPlantId: plantId, period: h.key, taxYear: spansTwoYears(h) ? (c.taxYear ?? startYearOf(c.period)) : undefined }
  return (await itemPeriodClosed(db, { ...c, ...neu })) ? none : neu
}
```

`heatingPlantUnits`, `tenancies` aus `'./schema.ts'` und `inArray` aus `'drizzle-orm'` in repository.ts
importieren, soweit nicht vorhanden. `CostItem.participantUnitIds`, `tenancyAmounts`, `selfAmounts` und
`directUnitId` sind Felder des Datenmodells (#94, #142).

- [ ] **Step 5: Wiederherstellen (`server/src/db/heating.ts`)**

`heatingPlantViolations` (PR 4) prüft überlappende Anlagen und Anlagen ohne Liste schon. Dazu, vor
`return befunde`:

```ts
  // Heizung PR 9: Namen ab zwei Anlagen. Ohne sie ließen sich Hinweise und Ausweis nicht zuordnen.
  for (const propertyId of new Set(anlagen.map((p) => p.propertyId))) {
    const imObjekt = anlagen.filter((p) => p.propertyId === propertyId)
    if (imObjekt.length >= 2 && imObjekt.some((p) => p.name.trim() === '')) {
      befunde.push('Im Objekt stehen mehrere Heizanlagen, und eine davon hat keinen Namen.')
    }
  }
```

In `server/test/db-backup.test.ts` im Test „Heizanlagen über die Objektgrenze, überlappend oder mit
fremder Heizperiode werden beanstandet“ (PR 4) bleibt die Erwartung `/mehrere Heizanlagen/`; die
dritte Anlage dort (`hp3`, ohne Namen) erfüllt sie jetzt zusätzlich über den neuen Befund.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/db-backup.test.ts test/db-repository.test.ts test/booking.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS. `booking.test.ts` bleibt grün: Mit einer oder keiner Anlage gilt dieselbe Zuordnung
wie bisher.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/heating.ts server/src/db/repository.ts server/test
git commit -m "Mehrere Heizanlagen in einem Objekt: Namen, eigene Wohnungen, keine Wohnung an zweien

Die zweite Anlage passt die erste beim Anlegen im selben Schritt an. Eine neue Heizposition ohne
Anlage bekommt die Anlage, an der ihre Wohnungen hängen.

Refs #97, #99"
```

---
### Task 2: Etagenheizung auf Vermietervertrag (`perUnit`)

Die Sperre aus PR 4 fällt. Eine Etagenheizung hat freie Schlüssel und keinen Vorrat (Festlegung 3);
jede ihrer Heizpositionen ist einer Wohnung der Anlage direkt zugeordnet (Entwurf 11.2), jede ihrer
Lieferungen trägt eine Wohnung der Anlage (5.4 F8), und eine verknüpfte Lieferung gehört zur Wohnung
ihrer Position (Review Focus 5). Eine zentrale Anlage nimmt keine Lieferung mit Wohnung.

**Files:**
- Modify: `server/src/db/heating.ts`, `server/src/db/repository.ts`, `server/src/db/fuel.ts` (PR 7)
- Test: `server/test/db-heizanlage.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 1; PR 4, PR 7, PR 8): `guardHeatingPlant`, `LATER.perUnit`, `guardCostItemHeating`, `plantOf`, `PLANT_GONE`; `isStockEnergy`; schema `heatingPlants`, `heatingPlantUnits`, `units`, `unitNoConnection`, `costItems`, `fuelDeliveries` (A1); B1 `guardFuelDelivery`.
- Produces:
  - repository.ts: `plantServesUnit(db: Executor, plantId: string, unitId: string): Promise<boolean>`; `plantOf` liefert `{ propertyId, supply, name }`
  - heating.ts: `perUnit` nur mit `manual` und ohne Vorratsenergie
  - fuel.ts: `unitId` Pflicht bei `perUnit`, verboten sonst; Wohnung der Lieferung = Wohnung ihrer Positionen

- [ ] **Step 1: Write the failing tests**

In `server/test/db-heizanlage.test.ts` anhängen:

```ts
// ---------- Etagenheizung auf Vermietervertrag (Heizung PR 9) ----------

test('Etagenheizung: nur mit freien Schlüsseln und ohne Vorrat; sonst ein Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => wohnung(db, 'eg'))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'service' })), refused(400, /direkt dieser Wohnung zu/))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'oil', supply: 'perUnit', method: 'manual' })), refused(400, /eigenem Tank oder Lager/))
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'manual' }))
    assert.deepEqual([plant.supply, plant.method], ['perUnit', 'manual'])
  })
})

test('Etagenheizung: jede Heizposition direkt bei einer Wohnung der Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'manual', units: [{ unitId: 'eg', heatedAreaM2: null }] })
    })
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { heatingPlantId: 'hp1' })), refused(400, /genau einer Wohnung/))
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c2', '2025-01', { heatingPlantId: 'hp1', key: 'direct', directUnitId: 'og' })), refused(400, /hängt nicht an der Etagenheizung/))
    const ok = await opened.write((db) => heizposition(db, 'c3', '2025-01', { key: 'direct', directUnitId: 'eg' }))
    assert.equal(fieldOf(ok, 'heatingPlantId'), 'hp1')
  })
})
```

In `server/test/api.test.ts` anhängen:

```ts
// ---------- Etagenheizung (Heizung PR 9) ----------

test('Etagenheizung über die Routen: Lieferung nur mit Wohnung der Anlage, zentrale nur ohne; Position und Rechnung derselben Wohnung (Review Focus 5)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const eg = await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 60, participates: true }))
    const og = await s.api<Unit>('/api/units', postJson({ name: 'OG', areaM2: 40, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ name: 'Gasthermen', energy: 'gas', supply: 'perUnit', method: 'manual' })))
    const lieferung = (body: Record<string, unknown>) => send(`/api/heating-plants/${plant.id}/fuel-deliveries`, postJson({
      invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-15', energyKwh: 15000, quantityUnit: 'kWh', emissionsKg: 3013, co2CostCents: 16500, ...body,
    }))
    const ohne = await lieferung({})
    assert.equal(ohne.status, 400)
    assert.match(await errorFrom(ohne), /gehört jede Rechnung zu einer Wohnung/)
    const mitEg = await lieferung({ unitId: eg.id })
    assert.equal(mitEg.status, 201)
    const rechnung = await jsonOf<{ id: string }>(mitEg)
    // Die Position der Wohnung OG mit der Rechnung der Wohnung EG: abgelehnt.
    const falsch = await send('/api/costItems', postJson({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas OG', amountCents: 150000, key: 'direct', directUnitId: og.id, heatingPlantId: plant.id, fuelDeliveryId: rechnung.id }))
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /gehört zu einer anderen Wohnung/)
    const richtig = await send('/api/costItems', postJson({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas EG', amountCents: 150000, key: 'direct', directUnitId: eg.id, heatingPlantId: plant.id, fuelDeliveryId: rechnung.id }))
    assert.equal(richtig.status, 201)
    // Eine zentrale Anlage im zweiten Objekt nimmt keine Lieferung mit Wohnung.
    const objekt2 = await s.api<Property>('/api/properties', postJson({ name: 'Zweites Haus', kind: 'mfh', address: '' }))
    const fremdeWohnung = await s.api<Unit>(`/api/units?property=${objekt2.id}`, postJson({ name: 'X', areaM2: 50, participates: true }))
    const zentral = await jsonOf<{ plant: HeatingPlant }>(await send(`/api/heating-plants?property=${objekt2.id}`, postJson({ energy: 'gas', method: 'manual' })))
    const mitWohnung = await send(`/api/heating-plants/${zentral.plant.id}/fuel-deliveries`, postJson({ invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-15', energyKwh: 1, quantityUnit: 'kWh', emissionsKg: 1, co2CostCents: 1, unitId: fremdeWohnung.id }))
    assert.equal(mitWohnung.status, 400)
    assert.match(await errorFrom(mitWohnung), /zentralen Heizanlage gehört zu keiner einzelnen Wohnung/)
  } finally {
    s.stop()
  }
})
```

Der Rumpf der Lieferung nennt die Felder aus A1 für eine Gasrechnung mit Rechnungszeitraum (Entwurf
5.4: „Zeitraum Pflicht bei Gas“); verlangt PR 7 weitere Pflichtfelder, ergänzt sie der Test, wie PR 7
sie in seinem api-Test schickt.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/api.test.ts`
Expected: FAIL. `perUnit` wird mit „Etagenheizungen mit Vertrag auf den Vermieter kommen mit einer
späteren Version“ abgelehnt, eine Lieferung mit Wohnung mit dem Satz aus PR 7.

- [ ] **Step 3: Die Anlage (`server/src/db/heating.ts`)**

`import { isStockEnergy } from '../../../shared/fuelStock.ts'` ergänzen. In `LATER` den Eintrag
`perUnit` streichen; in `guardHeatingPlant` die Zeile
`if (after.supply === 'perUnit') throw new HeatingError(400, LATER.perUnit)` ersetzen durch:

```ts
  // Etagenheizung auf Vertrag des Vermieters (Heizung PR 9, Entwurf 9.3, 11.2): Die Rechnung jeder
  // Wohnung gehört direkt zu ihr, also freie Schlüssel mit Direktzuordnung. Vorratsenergien rechnet
  // Mietfuchs dafür nicht, denn der Vorrat hängt an der Anlage, nicht an der Wohnung (Festlegung 3).
  if (after.supply === 'perUnit') {
    if (after.method !== 'manual') {
      throw new HeatingError(400, 'Bei Etagenheizungen auf Ihren Namen ordnen Sie die Rechnung jeder Wohnung direkt dieser Wohnung zu; einen Messdienst oder eine eigene Heizkostenabrechnung gibt es dafür in Mietfuchs nicht.')
    }
    if (isStockEnergy(after.energy)) {
      throw new HeatingError(400, 'Etagenheizungen mit eigenem Tank oder Lager je Wohnung (Heizöl, Flüssiggas, Pellets, Holz) rechnet Mietfuchs nicht, denn der Vorrat wird je Heizanlage geführt. Erfassen Sie ihre Kosten wie bisher direkt bei der Wohnung.')
    }
  }
```

- [ ] **Step 4: Heizpositionen einer Etagenheizung (`server/src/db/repository.ts`)**

Importe ergänzen: `count` aus `'drizzle-orm'` (falls nicht da); `unitNoConnection`, `fuelDeliveries`
aus `'./schema.ts'`.

`plantOf` (PR 4) ersetzen:

```ts
async function plantOf(db: Executor, plantId: string): Promise<{ propertyId: string; supply: HeatingPlant['supply']; name: string } | undefined> {
  return (await db.select({ propertyId: heatingPlants.propertyId, supply: heatingPlants.supply, name: heatingPlants.name }).from(heatingPlants).where(eq(heatingPlants.id, plantId)))[0]
}
```

(`HeatingPlant` in den Typimport aus `'../../../shared/types.ts'`.) Dahinter:

```ts
// Hängt die Wohnung an der Anlage (Heizung PR 9)? Mit Liste, wenn sie darin steht; ohne Liste jede
// Wohnung des Objekts ohne „kein Anschluss: Wärme“ (#117), wie `servesUnit` in shared/heatingPeriod.ts.
export async function plantServesUnit(db: Executor, plantId: string, unitId: string): Promise<boolean> {
  const [p] = await db.select({ propertyId: heatingPlants.propertyId, limited: heatingPlants.unitsLimited }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (!p) return false
  if (p.limited) {
    const [n] = await db.select({ n: count() }).from(heatingPlantUnits).where(and(eq(heatingPlantUnits.plantId, plantId), eq(heatingPlantUnits.unitId, unitId)))
    return (n?.n ?? 0) > 0
  }
  const [u] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId))
  if (!u || u.propertyId !== p.propertyId) return false
  const [ohne] = await db.select({ n: count() }).from(unitNoConnection).where(and(eq(unitNoConnection.unitId, unitId), eq(unitNoConnection.meterType, 'waerme')))
  return (ohne?.n ?? 0) === 0
}

const PER_UNIT_DIRECT = 'Die Kosten einer Etagenheizung gehören zu genau einer Wohnung. Bitte wählen Sie den Schlüssel „Direktzuordnung“ und die Wohnung, deren Heizung die Rechnung betrifft.'
```

In `guardCostItemHeating` hinter der Prüfung der Objektgrenze (`if (plant.propertyId !==
after.propertyId) { … }`):

```ts
  // Etagenheizung (Heizung PR 9, Entwurf 11.2): jede Heizposition direkt bei einer Wohnung der Anlage;
  // eine verknüpfte Rechnung gehört zu derselben Wohnung, sonst stammten C_u und A_u aus zwei Wohnungen.
  if (plant.supply === 'perUnit') {
    if (after.key !== 'direct' || !after.directUnitId) throw new HeatingError(400, PER_UNIT_DIRECT)
    if (!(await plantServesUnit(db, plantId, after.directUnitId))) {
      throw new HeatingError(400, `Die Wohnung dieser Position hängt nicht an der Etagenheizung „${plant.name}“. Bitte wählen Sie eine Wohnung der Anlage oder ordnen Sie die Position einer anderen Heizanlage zu.`)
    }
    if (after.fuelDeliveryId) {
      const [d] = await db.select({ unitId: fuelDeliveries.unitId }).from(fuelDeliveries).where(eq(fuelDeliveries.id, after.fuelDeliveryId))
      if (d && d.unitId !== after.directUnitId) {
        throw new HeatingError(400, 'Die verknüpfte Rechnung gehört zu einer anderen Wohnung als die Position. Bitte verknüpfen Sie die Rechnung der Wohnung, der die Position zugeordnet ist.')
      }
    }
  }
```

- [ ] **Step 5: Lieferungen (`server/src/db/fuel.ts`, PR 7)**

`plantServesUnit` aus `'./repository.ts'` importieren, `costItems` aus `'./schema.ts'` (falls nicht
da). In `guardFuelDelivery` (Annahme B1) die Zeile
`if (after.unitId !== null) throw new HeatingError(400, LATER.perUnit)` ersetzen durch:

```ts
  // Lieferungen mit Wohnung (Heizung PR 9, Entwurf 5.4 F8): bei einer Etagenheizung immer, sonst nie.
  // Eine Rechnung, deren Positionen einer Wohnung zugeordnet sind, gehört zu dieser.
  if (plant.supply === 'perUnit') {
    if (!after.unitId) throw new HeatingError(400, 'Bei einer Etagenheizung gehört jede Rechnung zu einer Wohnung. Bitte wählen Sie die Wohnung, deren Heizung sie betrifft.')
    if (!(await plantServesUnit(db, plant.id, after.unitId))) throw new HeatingError(400, `Die gewählte Wohnung hängt nicht an der Etagenheizung „${plant.name}“.`)
    const verknuepft = await db.select({ unitId: costItems.directUnitId }).from(costItems).where(eq(costItems.fuelDeliveryId, after.id))
    if (verknuepft.some((c) => c.unitId !== after.unitId)) {
      throw new HeatingError(400, 'An dieser Rechnung hängen Positionen einer anderen Wohnung. Lösen Sie die Verknüpfung dort, bevor Sie die Wohnung der Rechnung ändern.')
    }
  } else if (after.unitId) {
    throw new HeatingError(400, 'Eine Rechnung einer zentralen Heizanlage gehört zu keiner einzelnen Wohnung. Lassen Sie die Wohnung leer.')
  }
```

Den Eintrag `perUnit` in dessen `LATER` entfernen, wenn ihn sonst niemand liest. Testet PR 7 die
Sperre (eine Lieferung mit Wohnung wird mit „späteren Version“ abgelehnt), wird die Erwartung auf den
Satz zur zentralen Anlage umgestellt.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/api.test.ts test/db-repository.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/heating.ts server/src/db/repository.ts server/src/db/fuel.ts server/test
git commit -m "Etagenheizung auf Vermietervertrag: Anlage perUnit mit Direktzuordnung je Wohnung

Jede Heizposition und jede Rechnung gehört zu einer Wohnung der Anlage, beide zu derselben. Eine
zentrale Anlage nimmt keine Rechnung mit Wohnung.

Refs #97"
```

---
### Task 3: Reine Rechnung: Verteilbasis über Anlagen, Einstufung und Abzug der Etagenheizung

Alles, was ohne Abrechnung prüfbar ist (Entwurf 9.3): welche Wohnungen eine Position erreicht und ob
sie in eine zweite Anlage reicht (F9), die Einstufung der Etagenheizung über die vermieteten Wohnungen
mit Lieferung (9.2 Nr. 1, F8), der Abzug r_t = ‰/1000 · C_u · x_t / A_u ohne Normierung und die
Wohnungen, deren CO₂-Kosten nicht in ihren Heizkosten aufgehen.

**Files:**
- Modify: `server/src/co2.ts`
- Test: `server/test/co2-anlagen.test.ts` (neu)

**Interfaces:**
- Consumes (PR 6): `SnapshotCostItem`; `roundSpecific`, `stageRanges`, `stageOf` (nur im Test); `distributeCents` (nur im Test); `co2StageTable`, `valueAt`, `LAW_AS_OF` (nur im Test).
- Produces:
  - `type BasisContext = { basisUnitIds: readonly string[]; unitOfTenancy: ReadonlyMap<string, string>; meterUnitIds: (type: string) => readonly string[] }`
  - `itemBasisUnits(item, ctx): string[]`
  - `type PlantServing = { id: string; name: string; serves: (unitId: string) => boolean }`, `spanningPlants(unitIds, ownPlantId, plants): { plantId: string; name: string; unitIds: string[] }[]`
  - `type PerUnitFuel = { unitId: string; rented: boolean; delivered: boolean; areaM2: number; emissionsKg: number; co2Cents: number; fuelCents: number; shares: { tenancyId: string; exact: number }[] }`
  - `perUnitClassification(list): { emissionsKg: number; areaM2: number; co2Cents: number }`, `perUnitExceeding(list): string[]`, `perUnitReliefs(permille, list): { tenancyId: string; unitId: string; raw: number }[]`

- [ ] **Step 1: Write the failing tests**

`server/test/co2-anlagen.test.ts`:

```ts
// Mehrere Anlagen und Etagenheizung ohne Abrechnung (Heizung PR 9, Entwurf 9.2 Nr. 1, 9.3, 12.3 Nr. 9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeCents } from '../src/calc.ts'
import { itemBasisUnits, perUnitClassification, perUnitExceeding, perUnitReliefs, roundSpecific, spanningPlants, stageOf, stageRanges, type BasisContext, type PerUnitFuel } from '../src/co2.ts'
import type { SnapshotCostItem } from '../src/snapshot.ts'
import { co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

const CTX: BasisContext = {
  basisUnitIds: ['eg', 'og', 'dg'],
  unitOfTenancy: new Map([['ta', 'eg'], ['tb', 'og'], ['tc', 'dg']]),
  meterUnitIds: (type) => (type === 'waerme' ? ['eg', 'og'] : []),
}
const posten = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id: 'c', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: 'c', amountCents: 100000, key: 'area', ...over,
})
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

test('Verteilbasis einer Position (F9): Direktzuordnung, Anteile, Einzelbeträge, Teilnehmer, Zähler, ganzes Haus', () => {
  assert.deepEqual(itemBasisUnits(posten({ key: 'direct', directUnitId: 'dg' }), CTX), ['dg'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'custom', customShares: { eg: 60, og: 0, dg: 40 } }), CTX), ['eg', 'dg'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'amounts', tenancyAmounts: { ta: 500, tc: 0 }, selfAmounts: { og: 100 } }), CTX), ['eg', 'dg', 'og'])
  assert.deepEqual(itemBasisUnits(posten({ participantUnitIds: ['og', 'og'] }), CTX), ['og'])
  assert.deepEqual(itemBasisUnits(posten({ key: 'meter', meterType: 'waerme' }), CTX), ['eg', 'og'])
  assert.deepEqual(itemBasisUnits(posten({}), CTX), ['eg', 'og', 'dg'])
})

test('Über zwei Anlagen: die übrigen Anlagen mit den Wohnungen, die an ihnen hängen', () => {
  const plants = [
    { id: 'hp1', name: 'Zentralheizung', serves: (u: string) => u === 'eg' || u === 'og' },
    { id: 'hp2', name: 'Gastherme DG', serves: (u: string) => u === 'dg' },
  ]
  assert.deepEqual(spanningPlants(['og', 'dg'], 'hp1', plants), [{ plantId: 'hp2', name: 'Gastherme DG', unitIds: ['dg'] }])
  assert.deepEqual(spanningPlants(['eg', 'og'], 'hp1', plants), [])
})

// F8: zwei Wohnungen mit eigener Gasrechnung. EG 60 m², ganzjährig vermietet; OG 40 m², Mieter bis
// 30.04.2025 (120 Tage), Leerstand Mai und Juni (61 Tage), neuer Mieter ab 01.07.2025 (184 Tage).
// Je Wohnung eine Gasrechnung als Direktzuordnung: EG 1.500 €, OG 1.000 €.
const EG: PerUnitFuel = { unitId: 'eg', rented: true, delivered: true, areaM2: 60, emissionsKg: 1800, co2Cents: 20000, fuelCents: 150000, shares: [{ tenancyId: 't1', exact: 150000 }] }
const OG: PerUnitFuel = {
  unitId: 'og', rented: true, delivered: true, areaM2: 40, emissionsKg: 1200, co2Cents: 12000, fuelCents: 100000,
  shares: [{ tenancyId: 't2', exact: (100000 * 120) / 365 }, { tenancyId: 't3', exact: (100000 * 184) / 365 }],
}

test('Einstufung bei Etagenheizungen (§ 5 Abs. 1 Satz 2, Entwurf 9.2 Nr. 1): Σ kg / Σ Fläche der vermieteten Wohnungen mit Lieferung', () => {
  assert.deepEqual(perUnitClassification([EG, OG]), { emissionsKg: 3000, areaM2: 100, co2Cents: 32000 })
  const ranges = stageRanges(valueAt(co2StageTable, LAW_AS_OF), 1)
  assert.equal(stageOf(roundSpecific(3000 / 100, 1), ranges).landlordPercent, 40)
  // Eine selbstgenutzte Wohnung und eine ohne Rechnung in der Heizperiode zählen nicht.
  const eigen: PerUnitFuel = { ...EG, unitId: 'eigen', rented: false, emissionsKg: 5000, co2Cents: 50000, areaM2: 80, shares: [] }
  const ohne: PerUnitFuel = { ...OG, unitId: 'ohne', delivered: false, emissionsKg: 0, co2Cents: 0, areaM2: 70, shares: [] }
  assert.deepEqual(perUnitClassification([EG, OG, eigen, ohne]), { emissionsKg: 3000, areaM2: 100, co2Cents: 32000 })
})

test('Abzug je Wohnung ohne Normierung (Entwurf 9.3, Review Focus 3): 80,00 / 15,78 / 24,20 €, der Leerstand bleibt beim Vermieter', () => {
  const raws = perUnitReliefs(400, [EG, OG])
  assert.ok(near(raws[0]?.raw ?? 0, 8000))
  assert.ok(near(raws[1]?.raw ?? 0, (0.4 * 12000 * 120) / 365))
  assert.ok(near(raws[2]?.raw ?? 0, (0.4 * 12000 * 184) / 365))
  const total = Math.round(raws.reduce((a, x) => a + x.raw, 0))
  assert.equal(total, 11998)
  assert.deepEqual(distributeCents(total, raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [8000, 1578, 2420])
  // Der Leerstand: 4.800 ct (40 % von 120 €) für das OG, davon 39,98 € an die Mieter, 8,02 € beim Vermieter.
  assert.ok(near(4800 - (raws[1]?.raw ?? 0) - (raws[2]?.raw ?? 0), (0.4 * 12000 * 61) / 365))
  // Mit Normierung (falsch) bekämen die beiden Mieter des OG die ganzen 48,00 €: 18,95 und 29,05 €.
  assert.notEqual(Math.round(raws[1]?.raw ?? 0), Math.round((4800 * 120) / 304))
})

test('CO₂-Kosten über den Heizkosten einer Wohnung: kein Abzug für sie, gemeldet (co2.exceeds-heating)', () => {
  const zuviel: PerUnitFuel = { ...OG, co2Cents: 120000 }
  assert.deepEqual(perUnitExceeding([EG, zuviel]), ['og'])
  assert.deepEqual(perUnitReliefs(400, [EG, zuviel]).map((x) => x.tenancyId), ['t1'])
  const ohnePosition: PerUnitFuel = { ...OG, fuelCents: 0, shares: [] }
  assert.deepEqual(perUnitExceeding([ohnePosition]), ['og'])
})

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invariante (Entwurf 12.3 Nr. 9): 0 ≤ r_t ≤ x_t, Σ r je Wohnung ≤ ‰ · C_u', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 300; lauf++) {
    const list: PerUnitFuel[] = Array.from({ length: int(1, 4) }, (_, i) => {
      const fuelCents = int(0, 300000)
      const n = int(0, 3)
      const parts = Array.from({ length: n }, () => rnd())
      const sum = parts.reduce((a, p) => a + p, 0) + rnd()
      return {
        unitId: `u${i}`, rented: rnd() < 0.8, delivered: rnd() < 0.9, areaM2: int(20, 120), emissionsKg: int(0, 8000), co2Cents: int(0, 40000), fuelCents,
        shares: parts.map((p, k) => ({ tenancyId: `t${i}-${k}`, exact: sum > 0 ? (fuelCents * p) / sum : 0 })),
      }
    })
    const permille = int(0, 950)
    const raws = perUnitReliefs(permille, list)
    for (const r of raws) {
      const u = list.find((x) => x.unitId === r.unitId)
      const x = u?.shares.find((s) => s.tenancyId === r.tenancyId)?.exact ?? -1
      assert.ok(r.raw >= 0 && r.raw <= x + 1e-9, `Lauf ${lauf}: ${JSON.stringify(r)}`)
    }
    for (const u of list) {
      const sum = raws.filter((r) => r.unitId === u.unitId).reduce((a, r) => a + r.raw, 0)
      assert.ok(sum <= (permille / 1000) * u.co2Cents + 1e-9, `Lauf ${lauf}: ${u.unitId}`)
    }
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/co2-anlagen.test.ts`
Expected: FAIL mit `The requested module '../src/co2.ts' does not provide an export named
'itemBasisUnits'`.

- [ ] **Step 3: Implement (`server/src/co2.ts`)**

Ans Dateiende:

```ts
// ---------- Mehrere Anlagen und Etagenheizung (Heizung PR 9, Entwurf 9.2, 9.3) ----------

// Was `itemBasisUnits` über den Bestand wissen muss: die Wohnungen der Abrechnungseinheit samt
// selbstgenutzten, die Wohnung jedes Mietverhältnisses und die Wohnungen mit Zählern eines Typs.
export type BasisContext = {
  basisUnitIds: readonly string[]
  unitOfTenancy: ReadonlyMap<string, string>
  meterUnitIds: (type: string) => readonly string[]
}

// Die Wohnungen, auf die eine Position verteilt wird (F9): bei Direktzuordnung ihre Wohnung, bei
// vereinbarten Anteilen die mit Anteil, bei Einzelbeträgen die Wohnungen der Mietverhältnisse und die
// eigenen mit Betrag, sonst die Teilnehmer (#94), und ohne Teilnehmer die Basis des Schlüssels: beim
// Verbrauch die Wohnungen mit Zählern des Typs (alle Wohnungszähler bilden die Basis), sonst die
// Wohnungen der Abrechnungseinheit samt selbstgenutzten.
export function itemBasisUnits(
  item: Pick<SnapshotCostItem, 'key' | 'participantUnitIds' | 'directUnitId' | 'customShares' | 'tenancyAmounts' | 'selfAmounts' | 'meterType'>,
  ctx: BasisContext,
): string[] {
  const unique = (ids: readonly string[]): string[] => [...new Set(ids)]
  if (item.key === 'direct') return item.directUnitId ? [item.directUnitId] : []
  if (item.key === 'custom') return unique(Object.entries(item.customShares ?? {}).filter(([, v]) => Number(v) > 0).map(([id]) => id))
  if (item.key === 'amounts') {
    const fromTenancies = Object.keys(item.tenancyAmounts ?? {}).flatMap((t) => {
      const u = ctx.unitOfTenancy.get(t)
      return u ? [u] : []
    })
    return unique([...fromTenancies, ...Object.keys(item.selfAmounts ?? {})])
  }
  if (item.participantUnitIds) return unique(item.participantUnitIds)
  if (item.key === 'meter') return unique(ctx.meterUnitIds(item.meterType ?? ''))
  return unique(ctx.basisUnitIds)
}

// Eine Anlage mit der Frage, ob eine Wohnung an ihr hängt (`servesUnit`, shared/heatingPeriod.ts).
export type PlantServing = { id: string; name: string; serves: (unitId: string) => boolean }

// Die übrigen Anlagen, an denen Wohnungen der Basis hängen, je mit diesen Wohnungen. Leer heißt: Die
// Position bleibt in ihrer Anlage.
export function spanningPlants(unitIds: readonly string[], ownPlantId: string, plants: readonly PlantServing[]): { plantId: string; name: string; unitIds: string[] }[] {
  return plants
    .filter((p) => p.id !== ownPlantId)
    .flatMap((p) => {
      const hit = unitIds.filter((u) => p.serves(u))
      return hit.length > 0 ? [{ plantId: p.id, name: p.name, unitIds: hit }] : []
    })
}

// Eine Wohnung einer Etagenheizung auf Vertrag des Vermieters (§ 5 Abs. 1 Satz 2 CO2KostAufG) in einer
// Heizperiode: Ausstoß und CO₂-Kosten aus ihren Rechnungen (auf die Heizperiode umgerechnet wie bei
// jeder Lieferung, PR 7), A_u (`fuelCents`) die Beträge ihrer Heizpositionen, je Mietverhältnis mit
// Abrechnung x_t sein exakter Anteil daran. `rented`: vermietet (`participates`); `delivered`: eine
// Rechnung berührt die Heizperiode.
export type PerUnitFuel = {
  unitId: string
  rented: boolean
  delivered: boolean
  areaM2: number
  emissionsKg: number
  co2Cents: number
  fuelCents: number
  shares: { tenancyId: string; exact: number }[]
}

// Die Einstufung (Entwurf 9.2 Nr. 1): „vermietet er in einem Gebäude mehrere Wohnungen mit gesonderter
// … Versorgung …, ist deren Gesamtwohnfläche maßgeblich“. Gezählt werden die vermieteten Wohnungen mit
// Lieferung, mit ihrem Ausstoß, ihrer Fläche und ihren CO₂-Kosten.
export function perUnitClassification(list: readonly PerUnitFuel[]): { emissionsKg: number; areaM2: number; co2Cents: number } {
  const counted = list.filter((u) => u.rented && u.delivered)
  return {
    emissionsKg: counted.reduce((a, u) => a + u.emissionsKg, 0),
    areaM2: counted.reduce((a, u) => a + u.areaM2, 0),
    co2Cents: counted.reduce((a, u) => a + u.co2Cents, 0),
  }
}

// Wohnungen, deren CO₂-Kosten nicht in ihren Heizkosten aufgehen: C_u über A_u, oder CO₂-Kosten ohne
// Heizposition. Sie bekommen keinen Abzug; der Aufrufer meldet `co2.exceeds-heating`.
export function perUnitExceeding(list: readonly PerUnitFuel[]): string[] {
  return list.filter((u) => u.co2Cents > 0 && (u.fuelCents <= 0 || u.co2Cents > u.fuelCents)).map((u) => u.unitId)
}

// Der Abzug je Mietverhältnis (Entwurf 9.3): r_t = ‰/1000 · C_u · x_t / A_u, **ohne** Normierung auf
// die Mietverhältnisse der Wohnung. Was in A_u auf Leerstand, Eigennutzung oder Pauschale fällt, hat
// kein x_t und bleibt ohne Abzug beim Vermieter, wie bei der zentralen Anlage. Gerundet wird beim
// Aufrufer als eine Verteilung von R = round(Σ r) mit `distributeCents`.
export function perUnitReliefs(permille: number, list: readonly PerUnitFuel[]): { tenancyId: string; unitId: string; raw: number }[] {
  const exceeding = new Set(perUnitExceeding(list))
  return list
    .filter((u) => u.rented && u.fuelCents > 0 && !exceeding.has(u.unitId))
    .flatMap((u) => u.shares.map((s) => ({ tenancyId: s.tenancyId, unitId: u.unitId, raw: ((permille / 1000) * u.co2Cents * s.exact) / u.fuelCents })))
}
```

(`SnapshotCostItem` steht im Typimport aus `'./snapshot.ts'` seit PR 6.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/co2-anlagen.test.ts test/co2.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (`co2-anlagen.test.ts`: 6 Tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/co2.ts server/test/co2-anlagen.test.ts
git commit -m "CO₂: Verteilbasis über Anlagen, Einstufung und Abzug der Etagenheizung ohne Normierung

Reine Funktionen mit den Zahlen von F8 (§ 5 Abs. 1 Satz 2 CO2KostAufG, Entwurf 9.3).

Refs #97"
```

---
### Task 4: Berechnung: Töpfe je Anlage, Position über zwei Anlagen, Etagenheizung

`computeSettlement` nimmt eine Heizposition, deren Verteilbasis in eine zweite Anlage reicht, aus
jedem Topf und meldet `co2.item-spans-plants` (error); verteilt wird sie weiter nach ihrem Schlüssel.
Eine Heizposition ohne Anlage in einem Objekt mit Anlagen bekommt einen Hinweis an der Position
(Festlegung 5). Bei einer Etagenheizung setzt die eigene Aufteilung (PR 7) E, Fläche und C aus den
Wohnungen ein und rechnet den Abzug je Wohnung (Naht N2). Dazu die Invarianten 12.3 Nr. 13 und das
Lexikon zur Fläche.

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`, `shared/glossary.ts`
- Test: `server/test/calc-anlagen.test.ts` (neu), `server/test/glossary.test.ts`

**Interfaces:**
- Consumes (Task 3; PR 5, PR 6, PR 7, PR 8): `itemBasisUnits`, `spanningPlants`, `perUnitClassification`, `perUnitReliefs`, `perUnitExceeding`, `PerUnitFuel`, `Co2Pot`; `servesUnit`; im CO₂-Block die Namen aus B2; `stockCarry`; `fuelTotals` (A7, B3); `co2.exceeds-heating` (B4).
- Produces:
  - snapshot.ts: `SnapshotHeatingPlant` + `supply` (optional; fehlt es, ist die Anlage zentral)
  - calc.ts: `exactByItem: Map<string, Map<string, number>>`, `spanning: Map<string, { plantId: string; name: string; unitIds: string[] }[]>`, `perUnitFuelOf(pot)`; Code `co2.item-spans-plants` (error)
  - `GLOSSARY.co2Area.short` nennt § 5 Abs. 1 Satz 2

- [ ] **Step 1: Write the failing tests**

`server/test/calc-anlagen.test.ts`:

```ts
// Mehrere Anlagen und Etagenheizung in der Abrechnung (Heizung PR 9, Entwurf 9.3, 12.3 Nr. 13).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotFuelDelivery, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { Co2Statement } from '../../shared/types.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s })
const plant = (id: string, name: string, unitIds: string[], over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id, name, energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
  units: unitIds.map((unitId) => ({ unitId, heatedAreaM2: null })), ...over,
})
const co2 = (plantId: string, over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: `h-${plantId}`, plantId, period: P.key, method: 'serviceShown', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const messdienst = (id: string, plantId: string, tenancyAmounts: Record<string, number>): SnapshotCostItem => ({
  id, period: P.key, category: HEATING_CATEGORY, description: id, amountCents: Object.values(tenancyAmounts).reduce((a, c) => a + c, 0), key: 'amounts', tenancyAmounts, heatingPlantId: plantId,
})
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const reliefRowsOf = (r: ComputedSettlement, plantId: string): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief' && row.costItemId === `co2:${plantId}:${P.key}`).map((row): [string, number] => [st.tenancyId, row.shareCents]))

// Zwei Häuser in einem Objekt: Zentralheizung für EG und OG, eine zweite Anlage für das DG.
const HAUS = { units: [unit('eg'), unit('og'), unit('dg')], tenancies: [tenancy('ta', 'eg'), tenancy('tb', 'og'), tenancy('tc', 'dg')] }
const ZENTRAL = plant('hp1', 'Zentralheizung', ['eg', 'og'])
const DG = plant('hp2', 'Haus B', ['dg'])
const M1 = messdienst('m1', 'hp1', { ta: 60000, tb: 40000 })
const M2 = messdienst('m2', 'hp2', { tc: 50000 })
const ST1 = co2('hp1', { serviceUsersTotalCents: 100000, serviceLandlordCents: 5000, serviceUnitsCount: 2 })
const ST2 = co2('hp2', { serviceUsersTotalCents: 50000, serviceLandlordCents: 3000, serviceUnitsCount: 1 })
const snap = (costItems: SnapshotCostItem[], plants: SnapshotHeatingPlant[], statements: Co2Statement[]): Snapshot =>
  ({ ...snapshotOf(source({ ...HAUS, costItems }), 2025), heatingPlants: plants, co2Statements: statements })

test('Zwei Anlagen rechnen unabhängig (Entwurf 12.3 Nr. 13): Abzug jeder Anlage wie allein', () => {
  const beide = computeSettlement(snap([M1, M2], [ZENTRAL, DG], [ST1, ST2]))
  const nurEins = computeSettlement(snap([M1], [ZENTRAL], [ST1]))
  const nurZwei = computeSettlement(snap([M2], [DG], [ST2]))
  assert.deepEqual(reliefRowsOf(beide, 'hp1'), reliefRowsOf(nurEins, 'hp1'))
  assert.deepEqual(reliefRowsOf(beide, 'hp2'), reliefRowsOf(nurZwei, 'hp2'))
  assert.deepEqual(reliefRowsOf(beide, 'hp1'), [['ta', -3000], ['tb', -2000]])
  assert.deepEqual(reliefRowsOf(beide, 'hp2'), [['tc', -3000]])
  assert.deepEqual(beide.heating?.map((h) => h.plantId), ['hp1', 'hp2'])
})

test('Position über zwei Anlagen (F9, Review Focus 2): co2.item-spans-plants, verteilt wie bisher, mindert keinen Abzug', () => {
  const wartung: SnapshotCostItem = { id: 'w', period: P.key, category: HEATING_CATEGORY, description: 'Wartung', amountCents: 30000, key: 'area', participantUnitIds: ['og', 'dg'], heatingPlantId: 'hp1' }
  const r = computeSettlement(snap([M1, M2, wartung], [ZENTRAL, DG], [ST1, ST2]))
  const n = r.notices.find((x) => x.code === 'co2.item-spans-plants') ?? assert.fail(codes(r).join(', '))
  assert.deepEqual([n.level, n.subject], ['error', { kind: 'costItem', id: 'w' }])
  assert.match(n.text, /„Wartung“ gehört zur Heizanlage „Zentralheizung“, wird aber auch auf Wohnungen verteilt, die an „Haus B“ hängen \(dg\)\./)
  assert.ok(!r.notices.some((x) => x.code === 'co2.pool-foreign-item' && x.subject?.id === 'w'))
  // Verteilt wird sie weiter nach ihrem Schlüssel (OG und DG je 150 €).
  const zeile = (t: string) => r.statements.find((st) => st.tenancyId === t)?.rows.find((row) => row.costItemId === 'w')?.shareCents
  assert.deepEqual([zeile('tb'), zeile('tc')], [15000, 15000])
  // Der Abzug der Zentralheizung bleibt, wie er ohne die Wartung wäre.
  assert.deepEqual(reliefRowsOf(r, 'hp1'), reliefRowsOf(computeSettlement(snap([M1, M2], [ZENTRAL, DG], [ST1, ST2])), 'hp1'))
})

test('Position ohne Anlage, wenn das Objekt Anlagen hat (Festlegung 5): Hinweis an der Position statt „Heizung einrichten“', () => {
  const lose: SnapshotCostItem = { id: 'lose', period: P.key, category: HEATING_CATEGORY, description: 'Schornsteinfeger', amountCents: 9000, key: 'units' }
  const r = computeSettlement(snap([M1, M2, lose], [ZENTRAL, DG], [ST1, ST2]))
  const n = r.notices.find((x) => x.code === 'co2.fuel-unknown') ?? assert.fail(codes(r).join(', '))
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'lose' })
  assert.match(n.text, /^„Schornsteinfeger“ gehört zu keiner Heizanlage\./)
  assert.match(n.text, /Ordnen Sie die Position unter Kosten einer Heizanlage zu\.$/)
})

// ---------- Etagenheizung (F8) ----------

// Annahme A1: die Felder einer Lieferung nach Entwurf 5.4.
const gasrechnung = (id: string, unitId: string, emissionsKg: number, co2CostCents: number): SnapshotFuelDelivery => ({
  id, plantId: 'hp', amountCents: null, label: '', invoiceDate: '2026-01-15', deliveredAt: null, invoiceFrom: P.from, invoiceTo: P.to, unitId,
  quantity: null, quantityUnit: 'kWh', energyKwh: Math.round(emissionsKg / 0.2), gasBasis: 'hs', heatingValue: null, emissionsKg, co2CostCents,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: false, parts: [],
})
const direkt = (id: string, unitId: string, amountCents: number, fuelDeliveryId: string): SnapshotCostItem => ({
  id, period: P.key, category: HEATING_CATEGORY, description: `Gas ${unitId}`, amountCents, key: 'direct', directUnitId: unitId, heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId,
})
const THERMEN = plant('hp', 'Gasthermen', ['eg', 'og'], { method: 'manual', supply: 'perUnit' })
const F8 = {
  units: [unit('eg', { areaM2: 60 }), unit('og', { areaM2: 40 })],
  tenancies: [tenancy('t1', 'eg'), tenancy('t2', 'og', { start: '2024-05-01', end: '2025-04-30' }), tenancy('t3', 'og', { start: '2025-07-01' })],
  costItems: [direkt('g-eg', 'eg', 150000, 'd-eg'), direkt('g-og', 'og', 100000, 'd-og')],
}
const f8 = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...snapshotOf(source(F8), 2025), heatingPlants: [THERMEN], co2Statements: [],
  fuelDeliveries: [gasrechnung('d-eg', 'eg', 1800, 20000), gasrechnung('d-og', 'og', 1200, 12000)], ...over,
})

test('Etagenheizung (F8, Review Focus 3): 30,0 kg/m² → 40 %, Abzug je Wohnung ohne Normierung, Leerstand beim Vermieter', () => {
  const r = computeSettlement(f8())
  const rows = r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
  assert.deepEqual(rows, [['t1', -8000], ['t2', -1578], ['t3', -2420]])
  const co2Share = r.landlord.rows.flatMap((row) => row.landlordParts ?? []).filter((p) => p.reason === 'co2Share').reduce((a, p) => a + p.cents, 0)
  assert.equal(co2Share, 11998)
  const h = r.heating?.[0] ?? assert.fail('keine Anlage in der Abrechnung')
  assert.deepEqual([h.co2?.kgPerM2, h.co2?.stage?.landlordPercent, h.co2?.areaM2], [30, 40, 100])
  // Die eingetragene Fläche der Einstufung geht vor (9.2 Nr. 1): 3.000 kg / 120 m² = 25,0 → 30 %.
  const flaeche = computeSettlement(f8({ co2Statements: [{ ...co2('hp', { method: 'self', areaM2: 120 }), period: P.key }] }))
  assert.equal(flaeche.heating?.[0]?.co2?.stage?.landlordPercent, 30)
})

test('Etagenheizung: CO₂-Kosten über der Gasrechnung einer Wohnung → co2.exceeds-heating, kein Abzug für sie', () => {
  const r = computeSettlement(f8({ fuelDeliveries: [gasrechnung('d-eg', 'eg', 1800, 20000), gasrechnung('d-og', 'og', 1200, 120000)] }))
  assert.ok(codes(r).includes('co2.exceeds-heating'), codes(r).join(', '))
  const tenanten = r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map(() => st.tenancyId))
  assert.deepEqual(tenanten, ['t1'])
})
```

In `server/test/glossary.test.ts` anhängen:

```ts
test('Fläche der CO₂-Einstufung bei Etagenheizungen (Heizung PR 9, § 5 Abs. 1 Satz 2 CO2KostAufG)', () => {
  assert.match(GLOSSARY.co2Area.short, /Etagenheizung.*Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung \(§ 5 Abs\. 1 Satz 2 CO2KostAufG\)/s)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-anlagen.test.ts test/glossary.test.ts`
Expected: FAIL. Der erste Test ist grün (PR 6 rechnet je Anlage), die übrigen nicht:
`co2.item-spans-plants` fehlt, die Wartung erscheint als `co2.pool-foreign-item`, die lose Position
bekommt den Text „Mietfuchs weiß nicht, womit das Haus geheizt wird“, und bei der Etagenheizung
verteilt die eigene Aufteilung nach dem Anteil am ganzen Topf.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

In `SnapshotHeatingPlant` (Fassung PR 6) die Liste in `Partial<Pick<HeatingPlant, …>>` um `'supply'`
ergänzen und den Kommentar um einen Satz: „Seit PR 9 die Versorgung (`supply`); fehlt sie, ist die
Anlage zentral.“ `snapshotFor` gibt ganze Anlagen weiter und braucht keine Änderung.

- [ ] **Step 4: Code, exakte Anteile, Positionen über zwei Anlagen (`server/src/calc.ts`)**

Importe: aus `'./co2.ts'` zusätzlich `itemBasisUnits, perUnitClassification, perUnitExceeding,
perUnitReliefs, spanningPlants, type PerUnitFuel`; `servesUnit` aus `'../../shared/heatingPeriod.ts'`
(falls nicht da).

In `noticeKinds` hinter den Codes von PR 8:

```ts
  // Heizung PR 9 (#97, Entwurf 9.3 F9): Eine Position, deren Verteilbasis in zwei Anlagen reicht,
  // gehört zu keinem Topf. Verteilt wird sie weiter; ein Fehler, weil ihre CO₂-Kosten sich keiner
  // Einstufung zuordnen lassen.
  'co2.item-spans-plants': { level: 'error', title: 'Heizposition über mehrere Heizanlagen', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
```

In `computeSettlement` direkt vor der Zeile `const co2Pots = co2PotsOf(snapshot, [...items, ...stockCarry])`
(PR 8):

```ts
  // Mehrere Heizanlagen (Heizung PR 9, Entwurf 9.3 F9): Je Anlage gibt es eine eigene Einstufung. Eine
  // Heizposition, deren Verteilbasis Wohnungen einer zweiten Anlage erreicht, gehört deshalb zu
  // keinem Topf: Sie mindert keinen Abzug und zählt in keiner Probe. Verteilt wird sie weiter nach
  // ihrem Schlüssel, an den Kosten ändert sich nichts. Mit einer Anlage gibt es das nicht.
  const plantsHere = snapshot.heatingPlants ?? []
  const spanning = new Map<string, { plantId: string; name: string; unitIds: string[] }[]>()
  if (plantsHere.length > 1) {
    const unitOfTenancy = new Map(snapshot.tenancies.map((t) => [t.id, t.unitId]))
    const meterUnitIds = (type: string): string[] => snapshot.meters.flatMap((m) => (m.unitId && m.type === type ? [m.unitId] : []))
    const ctx = { basisUnitIds: basisUnits.map((u) => u.id), unitOfTenancy, meterUnitIds }
    const serving = plantsHere.map((p) => ({
      id: p.id,
      name: p.name ?? '',
      serves: (unitId: string) => {
        const u = unitById.get(unitId)
        return u ? servesUnit(p, u) : false
      },
    }))
    for (const c of items) {
      if (c.category !== HEATING_CATEGORY || !c.heatingPlantId) continue
      const others = spanningPlants(itemBasisUnits(c, ctx), c.heatingPlantId, serving)
      if (others.length > 0) spanning.set(c.id, others)
    }
  }
```

und die Zeile selbst wird:

```ts
  const co2Pots = co2PotsOf(snapshot, [...items, ...stockCarry].filter((c) => !spanning.has(c.id)))
```

Hinter `const landlordRows: SettlementRow[] = []`:

```ts
  // Die exakten Anteile der Mietverhältnisse mit Abrechnung je Position (Heizung PR 9), für x_t der
  // Etagenheizung (Entwurf 9.3). Leerstand, Eigennutzung und Pauschale stehen nicht darin.
  const exactByItem = new Map<string, Map<string, number>>()
```

In der Schleife über die Positionen direkt hinter `tenantCentsOf.set(item.id, distributed)`:

```ts
    exactByItem.set(item.id, new Map(targets.flatMap((x, i): [string, number][] => (booked[i] && statements.has(x.t.id) ? [[x.t.id, x.raw]] : []))))
```

(`targets` und `booked` sind die Listen der Verteilung derselben Position, aus denen auch
`heatingReceived` liest. Sammelt PR 7 diese Anteile schon unter anderem Namen, wird dessen Sammlung
genommen und diese Zeile fällt weg.)

Im CO₂-Block (PR 6) hinter der Schleife `for (const pot of co2Pots) { … }`:

```ts
  // Positionen über zwei Anlagen (Heizung PR 9): ein Fehler an der Position, mit den Wohnungen der
  // anderen Anlage.
  for (const [itemId, others] of spanning) {
    const item = items.find((c) => c.id === itemId)
    if (!item) continue
    const own = plantsHere.find((p) => p.id === item.heatingPlantId)?.name ?? ''
    const named = (unitIds: string[]) => unitIds.map((id) => unitById.get(id)?.name ?? id).join(', ')
    warn('co2.item-spans-plants',
      `„${item.description}“ gehört zur Heizanlage „${own}“, wird aber auch auf Wohnungen verteilt, die an ${andList(others.map((o) => `„${o.name}“`))} hängen (${others.map((o) => named(o.unitIds)).join('; ')}). ` +
        'Mietfuchs stuft jede Heizanlage für sich ein (§ 5 CO2KostAufG); eine Position über zwei Anlagen gehört zu keiner, deshalb zählt sie bei der CO₂-Aufteilung nicht mit. ' +
        'Verteilt wird sie weiter nach ihrem Schlüssel. Teilen Sie die Position je Heizanlage auf, über die beteiligten Wohnungen, oder ordnen Sie sie der richtigen Anlage zu.',
      itemSubject(item))
  }
```

- [ ] **Step 5: Position ohne Anlage, wenn es Anlagen gibt (`server/src/calc.ts`)**

Im Block „Heizpositionen ohne Heizanlage“ (PR 6) die Zeile `const loose = …` um die Positionen über
zwei Anlagen ergänzen:

```ts
  const loose = items.filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && !inPots.has(c.id) && !spanning.has(c.id))
```

Den Rumpf von `if (loose.length > 0 && heatingSettled && law(co2ApplicableFrom, …)) { … }` so fassen,
dass vor dem bisherigen Rumpf (der zum `else`-Zweig wird) steht:

```ts
    if (plantsHere.length > 0) {
      // Heizung PR 9 (Festlegung 5): Das Objekt hat Anlagen, nur diese Position gehört zu keiner. Der
      // Satz „Richten Sie die Heizung ein“ wäre falsch; gesagt wird es an der Position.
      const cut = law(co2CutMissing, { period: lawPeriod }, lawLog)
      const firstYear = lawPeriod.from.slice(0, 4) === co2FirstPeriodStart().slice(0, 4)
      for (const c of loose) {
        warn(firstYear ? 'co2.missing-first-year' : 'co2.fuel-unknown',
          `„${c.description}“ gehört zu keiner Heizanlage. Mietfuchs weiß deshalb nicht, womit für diese Position geheizt wurde, und teilt ihre CO₂-Kosten nicht auf. ` +
            `${co2Duty('Heizt die Anlage mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
            `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(new Set([c.id]), cut)}. Ordnen Sie die Position unter Kosten einer Heizanlage zu.`,
          itemSubject(c))
      }
    } else {
```

und den bisherigen Rumpf mit `}` schließen. Ohne Anlage bleibt alles wie in PR 6.

- [ ] **Step 6: Naht N2: Etagenheizung in der eigenen Aufteilung (`server/src/calc.ts`)**

Vor der Schleife `for (const pot of co2Pots)` (hinter `sharesOf` aus PR 6):

```ts
  // Je Wohnung einer Etagenheizung die Zahlen für Einstufung und Abzug (Heizung PR 9, Entwurf 9.2,
  // 9.3 F8). Ausstoß und CO₂-Kosten rechnet die Abgrenzung der Lieferungen (PR 7, `fuelTotals`) je
  // Wohnung aus deren Rechnungen; A_u sind die Beträge ihrer Heizpositionen samt Überträgen, x_t die
  // exakten Anteile daran.
  const perUnitFuelOf = (pot: Co2Pot): PerUnitFuel[] => {
    const deliveries = (snapshot.fuelDeliveries ?? []).filter((d) => d.plantId === pot.plantId && !d.estimated)
    const unitIds = [...new Set([
      ...pot.items.flatMap((c) => (c.key === 'direct' && c.directUnitId ? [c.directUnitId] : [])),
      ...deliveries.flatMap((d) => (d.unitId ? [d.unitId] : [])),
    ])]
    return unitIds.map((unitId): PerUnitFuel => {
      const u = unitById.get(unitId)
      const own = deliveries.filter((d) => d.unitId === unitId)
      const totals = own.length > 0 ? fuelTotals(pot, { ...snapshot, fuelDeliveries: own }, lawLog) : null
      const mine = pot.items.filter((c) => c.key === 'direct' && c.directUnitId === unitId)
      const shares = new Map<string, number>()
      for (const c of mine) for (const [t, x] of exactByItem.get(c.id) ?? []) shares.set(t, (shares.get(t) ?? 0) + x)
      return {
        unitId,
        rented: u?.participates === true,
        delivered: (totals?.coveragePermille ?? 0) > 0,
        areaM2: u?.areaM2 ?? 0,
        emissionsKg: totals?.emissionsKg ?? 0,
        co2Cents: totals?.co2Cents ?? 0,
        fuelCents: mine.reduce((a, c) => a + c.amountCents, 0),
        shares: [...shares].map(([tenancyId, exact]) => ({ tenancyId, exact })),
      }
    })
  }
```

In der eigenen Aufteilung von PR 7 (Annahme B2) für einen Topf, direkt hinter der Bestimmung von
`fuel` (seit PR 8 `const fuel: FuelFigures = …`) und `areaM2`: Beide werden mit `let` deklariert, und
dahinter steht:

```ts
      // Etagenheizung (Heizung PR 9, Entwurf 9.2 Nr. 1): Einstufung über die vermieteten Wohnungen mit
      // Lieferung, eine eingetragene Fläche geht vor; C sind deren CO₂-Kosten.
      const perUnit = plantsHere.find((p) => p.id === pot.plantId)?.supply === 'perUnit' ? perUnitFuelOf(pot) : null
      if (perUnit) {
        const classified = perUnitClassification(perUnit)
        fuel = { ...fuel, emissionsKg: classified.emissionsKg, co2Cents: classified.co2Cents }
        areaM2 = st?.areaM2 ?? classified.areaM2
        for (const unitId of perUnitExceeding(perUnit)) {
          const name = unitById.get(unitId)?.name ?? unitId
          warn('co2.exceeds-heating',
            `${where}: Die CO₂-Kosten der Rechnungen für die Wohnung ${name} liegen über den Heizkosten, die ihr zugeordnet sind, oder es gibt keine Heizposition für sie. ` +
              'Für diese Wohnung zieht Mietfuchs deshalb nichts ab. Prüfen Sie die Rechnungen und die Positionen der Wohnung auf der Seite Kosten.',
            plantSubject)
        }
      }
```

und die Zeile, mit der PR 7 die Abzüge rechnet
(`const raws = reliefsByShare(landlordCents, shares, fuelCents)`), wird

```ts
      const raws = perUnit
        ? perUnitReliefs(permille, perUnit).map(({ tenancyId, raw }) => ({ tenancyId, raw }))
        : reliefsByShare(landlordCents, shares, fuelCents)
```

Alles danach (R, Verteilung, Zeilen `co2Relief`, `co2Share`, Ausweis) bleibt, wie PR 7 es rechnet.
Der Ausdruck `st?.areaM2` liest den CO₂-Datensatz des Topfs (`pot.statement`, in PR 6 `st`); gibt es
keinen, gilt die Fläche der Wohnungen. Steht `co2.exceeds-heating` in PR 7 nicht unter diesem Code
(B4), wird dessen Code genommen.

- [ ] **Step 7: Lexikon (`shared/glossary.ts`)**

In `co2Area` (PR 6) an `short` anhängen:

```ts
 + ' Bei Etagenheizungen, deren Gasvertrag der Vermieter hat, zählt die Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG).'
```

(`short` wird dafür zu einem Ausdruck mit `+`, oder der Satz wird in das bestehende Literal
geschrieben.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-anlagen.test.ts test/co2-anlagen.test.ts test/calc-co2.test.ts test/calc-vorrat.test.ts test/glossary.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts && npm run typecheck`
Expected: PASS (`calc-anlagen.test.ts`: 5 Tests). Golden F01–F15 unverändert: Mit einer oder keiner
Anlage entsteht `spanning` nicht, und die Etagenheizung gibt es dort nicht.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS. Ein Test aus PR 6, der bei einer Anlage eine Heizposition ohne Anlage prüft und den
Text „Mietfuchs weiß nicht, womit das Haus geheizt wird“ erwartet, bekommt den Text der Position aus
Step 5; der Fall ohne Anlage bleibt wörtlich.

```bash
git add server/src/snapshot.ts server/src/calc.ts shared/glossary.ts server/test
git commit -m "CO₂ je Heizanlage: Position über zwei Anlagen als Fehler, Etagenheizung mit Abzug je Wohnung

Eine Position, deren Verteilbasis in eine zweite Anlage reicht, gehört zu keinem Topf. Bei
Etagenheizungen auf Vermietervertrag Einstufung über die vermieteten Wohnungen mit Lieferung und
Abzug r = ‰ · C_u · x_t / A_u ohne Normierung.

Refs #97"
```

---
### Task 5: Oberfläche: weitere Heizanlage, Etagenheizung, Wahl der Anlage

Die Karte „Heizung“ bekommt „+ weitere Heizanlage“; die Einrichtung fragt ab der zweiten Anlage nach
dem Namen und, falls die erste noch keinen Namen oder keine Liste hat, nach deren Namen, und schickt
beides in einem Schritt (`adjust`, Review Focus 1). „Jede Wohnung hat eine eigene Heizung“ mit
„Ich habe den Vertrag“ legt jetzt eine Etagenheizung an. Kosten, Zähler und Lieferungen wählen ab zwei
Anlagen die Anlage.

**Files:**
- Modify: `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx`, `client/src/pages/Kosten.tsx`, `client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx`, `client/src/fuelForm.ts` (PR 7, Annahme B5), `client/src/components/FuelDeliveriesCard.tsx` (PR 7)
- Test: `client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.test.tsx`, `client/src/meterForm.test.ts`, `client/src/fuelForm.test.ts`

**Interfaces:**
- Consumes (Task 1, 2; PR 4, PR 5, PR 7, PR 8): Rumpf `adjust` an `POST /api/heating-plants`; `HeatingForm`, `heatingPlantBody`, `heatingToForm`, `emptyHeatingForm`, `defaultUnitIds`, `heatingSummary`, `ENERGY_OPTIONS`, `CONTRACT_OPTIONS`; `HeatingCard`; `heatingItemPeriods`; `MeterForm`, `meterToForm`, `meterBody`; `isStockEnergy`; B5 `FuelDeliveryForm`, `fuelDeliveryBody`.
- Produces:
  - heatingForm.ts: `HeatingForm` + `name`, `perUnitEnergy`, `otherNames`; `HeatingPlantBody` + `name`; `AdjustRow = { id: string; name: string; units: HeatingPlantUnit[] }`; `HeatingResult` mit `{ body; adjust: AdjustRow[] }`; `emptyHeatingForm(units, others?)`, `heatingToForm(plant, units, others?)`, `heatingPlantBody(form, units, others?, editingId?)`; `PER_UNIT_ENERGY_OPTIONS`; `plantOptions(plants)`
  - meterForm.ts: `MeterForm` + `heatingPlantId`; `meterPlantId(form, plants): { plantId: string | null } | { error: string }`
  - fuelForm.ts: `FuelDeliveryForm` + `unitId`; `deliveryUnitId(form, plant): { unitId: string | null } | { error: string }`

- [ ] **Step 1: Write the failing tests**

In `client/src/heatingForm.test.ts` (Vorlagen `UNITS` mit `eg`, `og`, `garage` ohne Wärmeanschluss und
`PLANT` aus PR 4):

```ts
describe('Mehrere Heizanlagen und Etagenheizung (Heizung PR 9)', () => {
  // Eine dritte Wohnung nur hier, damit die Vorgaben der Tests aus PR 4 bleiben.
  const UNITS3: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [...UNITS, { id: 'dg', name: 'DG' }]
  const ERSTE: HeatingPlant = { ...PLANT, id: 'hp1', name: '', units: null }

  test('Die zweite Anlage braucht einen Namen, und die erste bekommt Namen und die übrigen Wohnungen im selben Schritt', () => {
    const form = { ...emptyHeatingForm(UNITS3, [ERSTE]), energy: 'gas' as const, who: 'manual' as const, unitIds: ['dg'] }
    expect(form.otherNames).toEqual({ hp1: '' })
    expect(heatingPlantBody(form, UNITS3, [ERSTE])).toEqual({ error: 'Bitte geben Sie der neuen Heizanlage einen Namen, etwa „Haus B“ oder „Gastherme DG“.' })
    expect(heatingPlantBody({ ...form, name: 'Haus B' }, UNITS3, [ERSTE])).toEqual({ error: 'Bitte geben Sie auch der bisherigen Heizanlage einen Namen, etwa „Zentralheizung“.' })
    const result = heatingPlantBody({ ...form, name: 'Haus B', otherNames: { hp1: 'Zentralheizung' } }, UNITS3, [ERSTE])
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.body).toMatchObject({ name: 'Haus B', supply: 'central', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    expect(result.adjust).toEqual([{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }])
  })

  test('Die neue Anlage beginnt mit den Wohnungen, die noch an keiner hängen; nimmt sie der ersten alle, ein Satz', () => {
    const begrenzt: HeatingPlant = { ...ERSTE, name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }
    expect(emptyHeatingForm(UNITS3, [begrenzt]).unitIds).toEqual(['dg'])
    expect(emptyHeatingForm(UNITS3, [ERSTE]).unitIds).toEqual([])
    const alle = { ...emptyHeatingForm(UNITS3, [ERSTE]), energy: 'gas' as const, who: 'manual' as const, name: 'Neu', otherNames: { hp1: 'Alt' }, unitIds: ['eg', 'og', 'dg'] }
    expect(heatingPlantBody(alle, UNITS3, [ERSTE])).toEqual({ error: 'An „Alt“ hinge dann keine Wohnung mehr. Ändern Sie stattdessen die bisherige Heizanlage.' })
  })

  test('Etagenheizung mit Vertrag beim Vermieter: Anlage perUnit mit freien Schlüsseln, ohne Vorratsenergien', () => {
    expect(PER_UNIT_ENERGY_OPTIONS.map((o) => o.value)).toEqual(['gas', 'districtHeating', 'heatPump', 'electric', 'coal', 'other'])
    const form = { ...emptyHeatingForm(UNITS3), energy: 'perUnit' as const, contract: 'landlord' as const }
    expect(heatingPlantBody(form, UNITS3)).toEqual({ error: 'Womit heizen die Etagenheizungen?' })
    const result = heatingPlantBody({ ...form, perUnitEnergy: 'gas' }, UNITS3)
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.body).toMatchObject({ energy: 'gas', supply: 'perUnit', method: 'manual', source: 'building', units: null })
    expect(heatingPlantBody({ ...form, contract: 'tenant' }, UNITS3)).toHaveProperty('none')
    const zurueck = heatingToForm({ ...PLANT, supply: 'perUnit', method: 'manual', energy: 'gas' }, UNITS3)
    expect([zurueck.energy, zurueck.contract, zurueck.perUnitEnergy]).toEqual(['perUnit', 'landlord', 'gas'])
    expect(heatingSummary({ ...PLANT, name: 'Gasthermen', supply: 'perUnit', method: 'manual', energy: 'gas' }, UNITS3).slice(0, 3)).toEqual([
      'Name: Gasthermen', 'Energie: Gas, Etagenheizung je Wohnung (Vertrag bei Ihnen)', 'Abrechnung: Direktzuordnung der Rechnung jeder Wohnung',
    ])
  })

  test('Ändern einer Anlage: Name Pflicht, sobald es eine weitere gibt; keine Anpassung anderer Anlagen', () => {
    const zweite: HeatingPlant = { ...PLANT, id: 'hp2', name: 'Haus B', units: [{ unitId: 'dg', heatedAreaM2: null }] }
    const erste: HeatingPlant = { ...PLANT, id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }
    const form = heatingToForm(erste, UNITS3, [zweite])
    expect(form.name).toBe('Zentralheizung')
    expect(heatingPlantBody({ ...form, name: ' ' }, UNITS3, [zweite], 'hp1')).toEqual({ error: 'Bitte geben Sie der Heizanlage einen Namen.' })
    const result = heatingPlantBody(form, UNITS3, [zweite], 'hp1')
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.adjust).toEqual([])
    expect(result.body.units).toEqual([{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }])
  })

  test('Auswahl der Anlage erst ab zwei', () => {
    expect(plantOptions([{ ...PLANT, id: 'hp1', name: 'A' }])).toEqual([])
    expect(plantOptions([{ ...PLANT, id: 'hp1', name: 'A' }, { ...PLANT, id: 'hp2', name: 'B' }])).toEqual([{ value: 'hp1', label: 'A' }, { value: 'hp2', label: 'B' }])
  })
})
```

Importe dort um `PER_UNIT_ENERGY_OPTIONS, plantOptions` ergänzen. Zwei Tests aus PR 4 ändern ihre
Erwartung, weil der Rumpf jetzt `name` trägt und das Ergebnis `adjust`, und weil die Etagenheizung
nicht mehr gesperrt ist:

- „Vorgabe: alle Wohnungen außer denen ohne Wärmeanschluss …“: im erwarteten `body` `name: ''`
  ergänzen und neben `body` `adjust: []`.
- „Eigene Heizung je Wohnung: beim Mieter keine Anlage, beim Vermieter später“ heißt jetzt „… beim
  Vermieter eine Etagenheizung“, und die dritte Zeile erwartet
  `{ error: 'Womit heizen die Etagenheizungen?' }`.

In `client/src/components/HeatingCard.test.tsx` (Gerüst aus PR 4 mit `plants`, `sent`, `renderCard`,
`valueOf`; `UNITS` mit `EG` und `OG`, `PLANT` mit `units: null` und leerem Namen):

```tsx
test('„+ weitere Heizanlage“ legt die zweite an und benennt die erste im selben Schritt (Review Focus 1)', async () => {
  plants = [PLANT]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: '+ weitere Heizanlage' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '+ weitere Heizanlage' }))
  // Keine Vorschau der Zuordnung bei der zweiten Anlage.
  expect(screen.queryByText(/kommt zur Anlage/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'manual' } })
  fireEvent.change(screen.getByLabelText('Name der neuen Heizanlage'), { target: { value: 'Haus B' } })
  fireEvent.change(screen.getByLabelText('Name der bisherigen Heizanlage'), { target: { value: 'Zentralheizung' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'OG' }))
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({
    name: 'Haus B', units: [{ unitId: 'og', heatedAreaM2: null }], assignItemIds: [],
    adjust: [{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }] }],
  })
})
```

In `client/src/meterForm.test.ts`:

```ts
describe('Zähler an einer von mehreren Heizanlagen (Heizung PR 9)', () => {
  const A = { id: 'hp1' }
  const B = { id: 'hp2' }
  const form = { ...meterToForm({ id: 'm', name: 'Gaszähler', type: 'gas', unit: 'm³' } as Meter), heatingRole: 'supply' as const }
  test('eine Anlage: diese', () => expect(meterPlantId(form, [A])).toEqual({ plantId: 'hp1' }))
  test('zwei Anlagen: die gewählte, ohne Wahl ein Satz', () => {
    expect(meterPlantId({ ...form, heatingPlantId: 'hp2' }, [A, B])).toEqual({ plantId: 'hp2' })
    expect(meterPlantId(form, [A, B])).toEqual({ error: 'Bitte wählen Sie die Heizanlage, zu der der Zähler gehört.' })
    expect(meterPlantId({ ...form, heatingRole: '' }, [A, B])).toEqual({ plantId: null })
  })
})
```

(`describe` und `test` aus `vitest`, `Meter` in den Typimporten der Datei; `meterPlantId` ergänzen. Ist `meterToForm` mit einem
anderen Mindestumfang des Zählers aufgerufen, wird dessen Gestalt übernommen und das `as` entfällt.)

In `client/src/fuelForm.test.ts` (Annahme B5):

```ts
describe('Rechnung einer Etagenheizung (Heizung PR 9)', () => {
  test('bei perUnit Pflicht, bei zentraler Anlage leer', () => {
    expect(deliveryUnitId({ unitId: '' }, { supply: 'perUnit' })).toEqual({ error: 'Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft.' })
    expect(deliveryUnitId({ unitId: 'og' }, { supply: 'perUnit' })).toEqual({ unitId: 'og' })
    expect(deliveryUnitId({ unitId: 'og' }, { supply: 'central' })).toEqual({ unitId: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingForm HeatingCard meterForm fuelForm`
Expected: FAIL: `PER_UNIT_ENERGY_OPTIONS`, `plantOptions`, `meterPlantId`, `deliveryUnitId` werden
nicht exportiert; die Karte hat keinen Knopf „+ weitere Heizanlage“.

- [ ] **Step 3: Formularlogik (`client/src/heatingForm.ts`)**

Importe ergänzen: `HeatingPlantUnit` als Typ aus `'./types'`, `isStockEnergy` aus
`'../../shared/fuelStock.ts'`.

`HeatingForm` um drei Felder ergänzen:

```ts
  // Heizung PR 9: Name der Anlage (Pflicht ab der zweiten), Energie der Etagenheizungen und die Namen
  // der bisherigen Anlagen, die beim Anlegen der zweiten noch keinen haben.
  name: string
  perUnitEnergy: HeatingEnergy | ''
  otherNames: Record<string, string>
```

`HeatingPlantBody` um `'name'` in der `Pick`-Liste ergänzen. Darunter:

```ts
// Name und Wohnungen einer bisherigen Anlage, die mit dem Anlegen geändert werden (Heizung PR 9).
export type AdjustRow = { id: string; name: string; units: HeatingPlantUnit[] }
```

`HeatingResult` wird:

```ts
export type HeatingResult = { body: HeatingPlantBody; adjust: AdjustRow[] } | { error: string } | { none: string }
```

Hinter `CONTRACT_OPTIONS`:

```ts
// Womit Etagenheizungen auf Vertrag des Vermieters heizen können (Heizung PR 9). Ohne Vorratsenergien:
// Der Vorrat wird je Heizanlage geführt, nicht je Wohnung (Festlegung 3 des Plans).
export const PER_UNIT_ENERGY_OPTIONS: { value: HeatingEnergy; label: string }[] = ENERGY_OPTIONS.flatMap((o) =>
  o.value !== 'perUnit' && !isStockEnergy(o.value) ? [{ value: o.value, label: o.label }] : [],
)

// Die Auswahl der Anlage an Kosten, Zählern und Lieferungen: erst ab zwei Anlagen.
export const plantOptions = (plants: readonly Pick<HeatingPlant, 'id' | 'name'>[]): { value: string; label: string }[] =>
  plants.length < 2 ? [] : plants.map((p) => ({ value: p.id, label: p.name }))

// Die Wohnungen, an denen eine Anlage hängt; ohne Liste alle mit Anschluss an die Wärme.
const servedIds = (plant: Pick<HeatingPlant, 'units'>, units: readonly UnitInfo[]): string[] =>
  plant.units === null ? defaultUnitIds(units) : plant.units.map((u) => u.unitId)
```

(`HeatingEnergy` ist ein Vereinigungstyp ohne `perUnit`; die Prüfung `o.value !== 'perUnit'` engt den
Typ ein, bevor `isStockEnergy` ihn liest.)

Die Konstante `LATER_PER_UNIT` entfällt. `emptyHeatingForm` und `heatingToForm` werden:

```ts
export function emptyHeatingForm(units: readonly UnitInfo[], others: readonly HeatingPlant[] = []): HeatingForm {
  // Ab der zweiten Anlage beginnt die Liste mit den Wohnungen, die an keiner hängen (Heizung PR 9).
  const taken = new Set(others.flatMap((p) => servedIds(p, units)))
  return {
    energy: '', contract: '', who: '', unitIds: defaultUnitIds(units).filter((id) => !taken.has(id)), remote: 'unknown', installedAfter: 'unknown',
    captured: 'unknown', captureInstalledOn: '', warmRentAverage: '',
    name: '', perUnitEnergy: '', otherNames: Object.fromEntries(others.filter((p) => p.name.trim() === '' || p.units === null).map((p) => [p.id, p.name])),
  }
}

export function heatingToForm(plant: HeatingPlant, units: readonly UnitInfo[], _others: readonly HeatingPlant[] = []): HeatingForm {
  const perUnit = plant.supply === 'perUnit'
  return {
    energy: perUnit ? 'perUnit' : plant.energy,
    contract: perUnit ? 'landlord' : '',
    who: plant.source === 'homeowners' ? 'homeowners' : plant.method,
    unitIds: servedIds(plant, units),
    remote: plant.devicesRemote,
    installedAfter: plant.devicesInstalledAfter2021,
    captured: plant.capturedOnOct2024 === null ? 'unknown' : plant.capturedOnOct2024 ? 'yes' : 'no',
    captureInstalledOn: plant.captureInstalledOn ?? '',
    warmRentAverage: plant.warmRentAverageCents === null ? '' : centsText(plant.warmRentAverageCents),
    name: plant.name,
    perUnitEnergy: perUnit ? plant.energy : '',
    otherNames: {},
  }
}
```

(`_others` hält die Gestalt der Aufrufe gleich; die Karte reicht beim Ändern dieselbe Liste wie beim
Anlegen.)

`heatingPlantBody` wird:

```ts
// `others`: die übrigen Anlagen des Objekts; `editingId`: die Anlage, die geändert wird (dann gibt es
// keine Anpassung anderer Anlagen, Heizung PR 9).
export function heatingPlantBody(form: HeatingForm, units: readonly UnitInfo[], others: readonly HeatingPlant[] = [], editingId: string | null = null): HeatingResult {
  if (form.energy === '') return { error: 'Bitte wählen Sie, womit geheizt wird.' }
  const several = others.length > 0
  const name = form.name.trim()
  if (several && name === '') {
    return { error: editingId ? 'Bitte geben Sie der Heizanlage einen Namen.' : 'Bitte geben Sie der neuen Heizanlage einen Namen, etwa „Haus B“ oder „Gastherme DG“.' }
  }
  // Die bisherigen Anlagen ohne Namen oder ohne Liste bekommen beides mit dem Anlegen (Review Focus 1).
  const adjust: AdjustRow[] = []
  if (!editingId) {
    for (const p of others.filter((x) => x.name.trim() === '' || x.units === null)) {
      const otherName = (form.otherNames[p.id] ?? p.name).trim()
      if (otherName === '') return { error: 'Bitte geben Sie auch der bisherigen Heizanlage einen Namen, etwa „Zentralheizung“.' }
      const rest = servedIds(p, units).filter((id) => !form.unitIds.includes(id))
      if (rest.length === 0) return { error: `An „${otherName}“ hinge dann keine Wohnung mehr. Ändern Sie stattdessen die bisherige Heizanlage.` }
      adjust.push({ id: p.id, name: otherName, units: rest.map((unitId) => ({ unitId, heatedAreaM2: null })) })
    }
  }
  if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
  const all = defaultUnitIds(units)
  const allServed = !several && form.unitIds.length === all.length && all.every((id) => form.unitIds.includes(id))
  const unitList = allServed ? null : form.unitIds.map((unitId) => ({ unitId, heatedAreaM2: null }))
  if (form.energy === 'perUnit') {
    if (form.contract === '') return { error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' }
    if (form.contract === 'tenant') return { none: SELF_SUPPLY }
    // Etagenheizung auf Vertrag des Vermieters (Heizung PR 9, § 5 Abs. 1 Satz 2 CO2KostAufG): Die
    // Rechnung jeder Wohnung wird ihr direkt zugeordnet.
    if (form.perUnitEnergy === '') return { error: 'Womit heizen die Etagenheizungen?' }
    return {
      body: {
        name, energy: form.perUnitEnergy, supply: 'perUnit', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, units: unitList,
      },
      adjust,
    }
  }
  const energy: HeatingEnergy = form.energy
  const who = form.who
  if (who === '') return { error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' }
  if (who === 'self') return { error: LATER_SELF }
  const heatPump = energy === 'heatPump'
  const averageText = heatPump ? form.warmRentAverage.trim() : ''
  const average = averageText === '' ? null : parseEuro(averageText)
  if (averageText !== '' && (average === null || average < 0)) {
    return { error: 'Bitte geben Sie die durchschnittlichen Heizkosten als Betrag ein, etwa 1.234,56.' }
  }
  return {
    body: {
      name,
      energy,
      supply: 'central',
      method: who === 'homeowners' ? 'service' : who,
      source: who === 'homeowners' ? 'homeowners' : 'building',
      devicesRemote: form.remote,
      devicesInstalledAfter2021: form.installedAfter,
      capturedOnOct2024: heatPump && form.captured !== 'unknown' ? form.captured === 'yes' : null,
      captureInstalledOn: heatPump && form.captured === 'no' && form.captureInstalledOn !== '' ? form.captureInstalledOn : null,
      warmRentAverageCents: average,
      units: unitList,
    },
    adjust,
  }
}
```

Die Reihenfolge der Prüfungen verschiebt sich gegenüber PR 4: Die Wohnungsliste wird jetzt vor der
Frage nach dem Abrechnenden geprüft, weil auch die Etagenheizung sie braucht. Die Tests aus PR 4 merken
das nicht: Wo sie den Satz zu `who` erwarten, hat das Formular eine Liste (`emptyHeatingForm` füllt sie).

`heatingSummary` wird:

```ts
export function heatingSummary(plant: HeatingPlant, units: readonly Pick<Unit, 'id' | 'name'>[]): string[] {
  const energyLabel = ENERGY_OPTIONS.find((o) => o.value === plant.energy)?.label ?? plant.energy
  const perUnit = plant.supply === 'perUnit'
  const energy = perUnit ? `${energyLabel}, Etagenheizung je Wohnung (Vertrag bei Ihnen)` : energyLabel
  const who = perUnit
    ? 'Direktzuordnung der Rechnung jeder Wohnung'
    : plant.source === 'homeowners'
      ? 'Die Gemeinschaft (Hausverwaltung) rechnet ab'
      : (whoOptions('mfh').find((o) => o.value === plant.method)?.label ?? plant.method)
  const served = plant.units === null
    ? 'alle Wohnungen'
    : plant.units.length === 0
      ? 'keine Wohnung'
      : plant.units.map((u) => units.find((x) => x.id === u.unitId)?.name ?? u.unitId).join(', ')
  const remote = REMOTE_OPTIONS.find((o) => o.value === plant.devicesRemote)?.label ?? plant.devicesRemote
  const lines = [`Energie: ${energy}`, `Abrechnung: ${who}`, `Angeschlossen: ${served}`]
  return [...(plant.name.trim() ? [`Name: ${plant.name.trim()}`] : []), ...lines, ...(perUnit ? [] : [`Aus der Ferne ablesbar: ${remote}`])]
}
```

Ohne Namen sind die Zeilen wie in PR 4 (`PLANT` dort hat `name: ''`), deren Test bleibt grün.

- [ ] **Step 4: Karte (`client/src/components/HeatingCard.tsx`)**

Importe aus `'../heatingForm'` um `PER_UNIT_ENERGY_OPTIONS` ergänzen; `HeatingEnergy` als Typ aus
`'../types'`.

`openNew` wird:

```tsx
  async function openNew() {
    setError('')
    // Die Vorschau der Zuordnung gilt nur für die erste Anlage: Bei einer weiteren ordnet der Vermieter
    // jede Position selbst zu (Heizung PR 9), denn sonst kämen alle losen Positionen zur neuen.
    if (plants.length === 0) {
      try {
        setAssignable(await api<AssignableHeatingItem[]>(withProperty('/api/heating-plants/assignable', propertyId)))
      } catch (e) {
        setError(errorText(e))
        return
      }
    } else {
      setAssignable([])
    }
    setEditingId(null)
    setForm(emptyHeatingForm(units, plants))
  }
```

In `openEdit` wird `heatingToForm(p, units)` zu `heatingToForm(p, units, plants.filter((x) => x.id !== p.id))`.

In `save` die Zeile `const result = heatingPlantBody(form, units)` ersetzen durch:

```tsx
    const others = plants.filter((p) => p.id !== editingId)
    const result = heatingPlantBody(form, units, others, editingId)
```

und beim Anlegen den Rumpf `{ ...result.body, assignItemIds: assignable.map((i) => i.id) }` durch
`{ ...result.body, adjust: result.adjust, assignItemIds: assignable.map((i) => i.id) }`. Der Satz nach
dem Anlegen wird `created ? (plants.length === 0 ? 'Heizung eingerichtet. An Ihren Beträgen ändert sich nichts.' : 'Weitere Heizanlage angelegt. Ordnen Sie ihre Heizpositionen auf der Seite Kosten zu.') : 'Heizung gespeichert.'`;
dafür vor `close()` `const first = plants.length === 0` merken und statt `plants.length === 0` lesen.

Unter der Liste der Anlagen (hinter `{plants.map(…)}`):

```tsx
      {plants.length > 0 && (
        <button className="btn secondary" onClick={openNew}>+ weitere Heizanlage</button>
      )}
```

Im Drawer direkt hinter `{error && <div className="error">{error}</div>}`:

```tsx
          {(plants.length > (editingId ? 1 : 0)) && (
            <label className="field grow">
              {editingId ? 'Name der Heizanlage' : 'Name der neuen Heizanlage'}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="etwa „Haus B“ oder „Gastherme DG“" />
            </label>
          )}
          {!editingId && Object.keys(form.otherNames).length > 0 && (
            <>
              <p className="muted">
                Bei mehreren Heizanlagen braucht jede einen Namen und ihre Wohnungen. Die bisherige Heizanlage behält die Wohnungen, die Sie unten
                nicht für die neue anhaken.
              </p>
              {Object.entries(form.otherNames).map(([id, value]) => (
                <label key={id} className="field grow">
                  Name der bisherigen Heizanlage
                  <input value={value} onChange={(e) => setForm({ ...form, otherNames: { ...form.otherNames, [id]: e.target.value } })} placeholder="etwa „Zentralheizung“" />
                </label>
              ))}
            </>
          )}
```

Den Zweig `form.energy === 'perUnit' ? ( <label …>Wer hat den Vertrag …</label> ) : ( … )` so fassen,
dass bei `perUnit` auf die Vertragsfrage folgt:

```tsx
              {form.contract === 'landlord' && (
                <>
                  <label className="field grow">
                    Womit heizen die Etagenheizungen?
                    <select value={form.perUnitEnergy} onChange={(e) => setForm({ ...form, perUnitEnergy: e.target.value as HeatingEnergy | '' })}>
                      <option value="">— bitte wählen —</option>
                      {PER_UNIT_ENERGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <p className="muted">
                    Ordnen Sie die Rechnung jeder Wohnung auf der Seite Kosten direkt dieser Wohnung zu, mit der Kostenart „Heizung und
                    Warmwasser“. Für die CO₂-Aufteilung zählt die Wohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2
                    CO2KostAufG).
                  </p>
                </>
              )}
```

und die Auswahl der Wohnungen (`<fieldset className="field grow no-connection">…</fieldset>`) aus dem
`else`-Zweig herausgezogen hinter den ganzen Zweig gestellt wird, sichtbar bei
`form.energy !== '' && !(form.energy === 'perUnit' && form.contract !== 'landlord')`. Das Fragment des
Zweigs wird dafür zu `<>{…perUnit…}</>`/`<>{…zentral…}</>` wie bisher, nur ohne das Fieldset. Die
Beschriftung der Checkboxen bleibt `u.name`, damit `getByRole('checkbox', { name: 'DG' })` sie findet.

- [ ] **Step 5: Kosten (`client/src/pages/Kosten.tsx`)**

Importe: `plantOptions` aus `'../heatingForm'`.

Neben `heatingPeriod`:

```tsx
  // Heizung PR 9: ab zwei Anlagen wählt der Vermieter die Anlage einer Heizposition. Leer heißt: Der
  // Server ordnet nach den Wohnungen der Position zu (Festlegung 4).
  const [heatingPlantId, setHeatingPlantId] = useState('')
  const plantChoices = plantOptions(plants)
```

Die Zeile `const ownPlant = heatingOptions[0]` (PR 5) wird:

```tsx
  const ownPlant = plantChoices.length > 0 ? heatingOptions.find((h) => h.plantId === heatingPlantId) : heatingOptions[0]
```

Im Formular direkt vor der Auswahl der Heizperiode (`{form.category === HEATING_CATEGORY && ownPlant && …`):

```tsx
            {form.category === HEATING_CATEGORY && plantChoices.length > 0 && (
              <label className="field">
                Heizanlage
                <select value={heatingPlantId} onChange={(e) => setHeatingPlantId(e.target.value)}>
                  <option value="">— nach den Wohnungen der Position —</option>
                  {plantChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
```

Beim Bauen des Rumpfs wird `heating` (PR 5) zu:

```tsx
    const heating = form.category !== HEATING_CATEGORY
      ? {}
      : ownPlant && ownPlant.options.length > 0
        ? { period: heatingPeriod || (ownPlant.options[0]?.value ?? ''), heatingPlantId: ownPlant.plantId }
        : plantChoices.length > 0 && heatingPlantId !== ''
          ? { heatingPlantId }
          : {}
```

Beim Öffnen einer bestehenden Position `setHeatingPlantId(item.heatingPlantId ?? '')`, beim Anlegen
`setHeatingPlantId('')`.

- [ ] **Step 6: Zähler (`client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx`)**

In `meterForm.ts`: `MeterForm` bekommt `heatingPlantId: string`; `meterToForm` setzt
`heatingPlantId: m.heatingPlantId ?? ''`, die leere Vorlage `heatingPlantId: ''`. Hinter `meterBody`:

```ts
// Die Anlage eines Zählers mit Rolle an der Heizanlage (Heizung PR 9): bei einer Anlage diese, ab zwei
// die gewählte. Ohne Rolle gehört der Zähler zu keiner.
export function meterPlantId(form: MeterForm, plants: readonly { id: string }[]): { plantId: string | null } | { error: string } {
  if (form.unitId || form.heatingRole === '') return { plantId: null }
  if (plants.length === 1) return { plantId: plants[0]?.id ?? null }
  if (plants.some((p) => p.id === form.heatingPlantId)) return { plantId: form.heatingPlantId }
  return plants.length === 0 ? { plantId: null } : { error: 'Bitte wählen Sie die Heizanlage, zu der der Zähler gehört.' }
}
```

In `Zaehler.tsx` in `saveMeter` die Zeilen

```ts
    // Die Heizanlage des Objekts; in dieser Version gibt es höchstens eine (Heizung PR 4).
    const result = meterBody(meterForm, plants[0]?.id ?? null)
```

ersetzen durch:

```ts
    // Die Heizanlage des Zählers (Heizung PR 9): bei einer die des Objekts, ab zwei die gewählte.
    const plant = meterPlantId(meterForm, plants)
    if ('error' in plant) {
      setError(plant.error)
      return
    }
    const result = meterBody(meterForm, plant.plantId)
```

Im Formular hinter der Auswahl der Rolle an der Heizanlage (PR 4):

```tsx
            {!meterForm.unitId && meterForm.heatingRole !== '' && plantOptions(plants).length > 0 && (
              <label className="field">
                Heizanlage
                <select value={meterForm.heatingPlantId} onChange={(e) => setMeterForm({ ...meterForm, heatingPlantId: e.target.value })}>
                  <option value="">— bitte wählen —</option>
                  {plantOptions(plants).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
```

(`plantOptions` aus `'../heatingForm'`, `meterPlantId` aus `'../meterForm'` importieren. Die
Bedingung, unter der PR 4 die Rolle zeigt, liest bisher `plants.length > 0`; sie bleibt.)

- [ ] **Step 7: Lieferungen (`client/src/fuelForm.ts`, `client/src/components/FuelDeliveriesCard.tsx`, Annahme B5)**

In `fuelForm.ts`: `FuelDeliveryForm` bekommt `unitId: string` (leere Vorlage `''`, aus einer Lieferung
`d.unitId ?? ''`). Dazu:

```ts
// Die Wohnung einer Rechnung (Heizung PR 9, Entwurf 5.4 F8): bei einer Etagenheizung Pflicht, sonst nie.
export function deliveryUnitId(form: Pick<FuelDeliveryForm, 'unitId'>, plant: Pick<HeatingPlant, 'supply'>): { unitId: string | null } | { error: string } {
  if (plant.supply !== 'perUnit') return { unitId: null }
  return form.unitId ? { unitId: form.unitId } : { error: 'Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft.' }
}
```

In `fuelDeliveryBody(form, plant)` am Anfang:

```ts
  const unit = deliveryUnitId(form, plant)
  if ('error' in unit) return unit
```

und im Rumpf `unitId: unit.unitId` statt des festen `unitId: null` aus PR 7. In
`FuelDeliveriesCard.tsx` bekommt das Formular bei `plant.supply === 'perUnit'` als erstes Feld:

```tsx
          {plant.supply === 'perUnit' && (
            <label className="field grow">
              Wohnung
              <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                <option value="">— bitte wählen —</option>
                {units.filter((u) => plant.units === null || plant.units.some((x) => x.unitId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
```

(Hat die Karte die Wohnungen nicht als `units`, lädt sie sie mit `api<Unit[]>(withProperty('/api/units',
propertyId))` wie die Seite Zähler. Heißt das Formular in PR 7 anders, gilt B5 und der Name aus PR 7.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingForm HeatingCard meterForm fuelForm Kosten Zaehler && npm run typecheck && npm --prefix server test -- test/anrede.test.ts test/law-literals.test.ts`
Expected: PASS. `anrede.test.ts` findet keine Du-Form; `law-literals.test.ts` findet keine Rechtszahl
(die Karte nennt § 5 Abs. 1 Satz 2 als Fundstelle, keine Zahl).

- [ ] **Step 9: Run all tests and commit**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

```bash
git add client/src
git commit -m "Oberfläche: weitere Heizanlage, Etagenheizung und Wahl der Anlage

Die zweite Anlage benennt die erste im selben Schritt. Kosten, Zähler und Rechnungen wählen ab zwei
Anlagen die Anlage, Rechnungen einer Etagenheizung die Wohnung.

Refs #97"
```

---
### Task 6: Smoke-Test, CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks.
- Produces: Prüfung der Programmdateien mit zwei Anlagen in einem eigenen Objekt; CHANGELOG; Architekturabschnitt.

- [ ] **Step 1: Smoke-Test (`scripts/smoke-test.mjs`)**

Vor `async function main()`:

```js
// Mehrere Heizanlagen und Etagenheizung (Heizung PR 9). In einem eigenen Objekt und nach dem
// Wiederherstellen, denn `backupAndRestore` zählt die Wohnungen und fragt ohne Objekt; mit einem
// zweiten Objekt antworteten die Routen ohne `?property=` mit 400.
async function plantsOfProperty() {
  const objekt = (await request('/api/properties', json('POST', { name: 'Prüfhaus Etagenheizung', kind: 'mfh', address: '' }))).body
  const q = `?property=${encodeURIComponent(objekt.id)}`
  const eg = (await request(`/api/units${q}`, json('POST', { name: 'EG', areaM2: 60, participates: true }))).body
  const og = (await request(`/api/units${q}`, json('POST', { name: 'OG', areaM2: 40, participates: true }))).body
  for (const u of [eg, og]) {
    await request(`/api/tenancies${q}`, json('POST', {
      unitId: u.id, tenantName: `Mieter ${u.name}`, personHistory: [{ from: '2025-01-01', persons: 1 }],
      start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
  }
  const erste = (await request(`/api/heating-plants${q}`, json('POST', { energy: 'gas', method: 'manual', assignItemIds: [] }))).body.plant
  const zweite = await request(`/api/heating-plants${q}`, json('POST', {
    name: 'Gastherme OG', energy: 'gas', supply: 'perUnit', method: 'manual', units: [{ unitId: og.id, heatedAreaM2: null }], assignItemIds: [],
    adjust: [{ id: erste.id, name: 'Zentralheizung', units: [{ unitId: eg.id, heatedAreaM2: null }] }],
  }))
  assert(zweite.status === 201, 'zweite Heizanlage anlegen, die erste im selben Schritt benennen', zweite.body)
  const namen = (await request(`/api/heating-plants${q}`)).body.map((p) => p.name).sort()
  assert(JSON.stringify(namen) === JSON.stringify(['Gastherme OG', 'Zentralheizung']), 'beide Anlagen mit Namen', namen)
  const gas = (await request(`/api/costItems${q}`, json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas OG', amountCents: 100000, key: 'direct', directUnitId: og.id,
  }))).body
  assert(gas.heatingPlantId === zweite.body.plant.id, 'die Gasrechnung der Wohnung kommt zur Etagenheizung', gas)
  const ueber = await request(`/api/costItems${q}`, json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 20000, key: 'area',
    participantUnitIds: [eg.id, og.id], heatingPlantId: erste.id,
  }))
  assert(ueber.status === 201 || ueber.status === 200, 'eine Position über beide Anlagen lässt sich speichern', ueber.body)
  const abrechnung = (await request(`/api/settlement/2025${q}`)).body
  assert(abrechnung.notices?.some((n) => n.code === 'co2.item-spans-plants'), 'die Abrechnung meldet die Position über zwei Anlagen', abrechnung.notices?.map((n) => n.code))
}
```

In `main` hinter `await backupAndRestore(unit)`:

```js
  await plantsOfProperty()
```

(Antwortet `POST /api/costItems` in dieser Version mit 200 statt 201, deckt die Zusicherung beides ab.
Antwortet `POST /api/heating-plants` nicht mit 201, gilt der Status aus PR 4, Task 4.)

- [ ] **Step 2: Smoke-Test gegen eine laufende Instanz**

Run:

```bash
npm run build
D=$(mktemp -d)
CI=1 NKA_DATA_DIR="$D" NKA_UPDATE_URL=http://127.0.0.1:9/kein-internet NKA_PORT=3999 npm start > "$D.log" 2>&1 &
SERVER=$!
node scripts/smoke-test.mjs --url http://127.0.0.1:3999 --mode npm; echo "Exit $?"
kill $SERVER
```

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ die Abrechnung meldet die Position
über zwei Anlagen“. `$D` ist ein Wegwerf-Ordner, `CI=1` verhindert das Browserfenster, `NKA_UPDATE_URL`
zeigt auf einen geschlossenen Port.

- [ ] **Step 3: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]` (neben den Einträgen von PR 1 bis PR 8):

```md
### Hinzugefügt

- **Mehrere Heizanlagen in einem Objekt.** In den Stammdaten legen Sie mit „+ weitere Heizanlage“ eine
  zweite Anlage an, etwa für ein zweites Haus, das mit dem ersten abrechnet. Jede Anlage hat einen Namen
  und ihre Wohnungen; die bisherige bekommt beides im selben Schritt. Jede Anlage wird für die
  CO₂-Aufteilung für sich eingestuft. Verteilt eine Heizposition über Wohnungen beider Anlagen, sagt die
  Abrechnung das als Fehler an der Position; verteilt wird sie weiter wie bisher
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Etagenheizungen, deren Vertrag Sie haben.** Unter „Jede Wohnung hat eine eigene Heizung“ mit „Ich
  habe den Vertrag“ legt Mietfuchs eine Etagenheizung an. Die Rechnung jeder Wohnung ordnen Sie dieser
  Wohnung direkt zu. Die CO₂-Einstufung rechnet über die vermieteten Wohnungen mit eigener Heizung und
  deren Gesamtwohnfläche (§ 5 Abs. 1 Satz 2 CO2KostAufG); jeder Mieter bekommt den Anteil des Vermieters
  an den CO₂-Kosten seiner Wohnung nach seinem Anteil an deren Heizkosten, ein Leerstand bleibt beim
  Vermieter ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- Auf den Seiten Kosten und Zähler wählen Sie ab zwei Heizanlagen die Anlage, bei Rechnungen einer
  Etagenheizung die Wohnung.
```

- [ ] **Step 4: CLAUDE.md**

Im Abschnitt „Architektur“ hinter dem Absatz **Brennstoffvorrat** (PR 8):

```md
**Mehrere Heizanlagen und Etagenheizung** (Heizung PR 9, #97): Ein Objekt kann mehrere Anlagen haben.
Ab zwei braucht jede einen Namen (im Objekt verschieden) und ihre Liste der Wohnungen, und keine
Wohnung hängt an zweien; geprüft wird das nach jedem Schreiben über alle Anlagen des Objekts
(`guardPlantsOfProperty` in [server/src/db/heating.ts](server/src/db/heating.ts)), in derselben
Transaktion, und beim Wiederherstellen mit `heatingPlantViolations`. Das Anlegen nimmt Namen und
Wohnungen bisheriger Anlagen im Rumpf `adjust` mit, damit nie ein halber Stand entsteht.

- **Eine neue Heizposition ohne Anlage** bekommt bei mehreren Anlagen die, an der alle von ihr
  genannten Wohnungen hängen (Direktzuordnung, Teilnehmer, Einzelbeträge; `plantForNewItem` in
  repository.ts), sonst keine. Gehört eine Heizposition zu keiner Anlage, obwohl das Objekt welche hat,
  sagt `co2.fuel-unknown` das an der Position.
- **Position über zwei Anlagen** (`co2.item-spans-plants`, error): Reicht die Verteilbasis einer
  Heizposition (`itemBasisUnits` in [server/src/co2.ts](server/src/co2.ts)) in eine zweite Anlage,
  gehört sie zu keinem Topf und mindert keinen Abzug; verteilt wird sie weiter nach ihrem Schlüssel.
- **Etagenheizung auf Vertrag des Vermieters** (`supply = 'perUnit'`, § 5 Abs. 1 Satz 2
  CO2KostAufG): nur mit freien Schlüsseln und ohne Vorratsenergie; jede Heizposition direkt bei einer
  Wohnung der Anlage, jede Rechnung (`fuel_deliveries.unit_id`) mit dieser Wohnung. Eingestuft wird über
  Σ kg / Σ Fläche der vermieteten Wohnungen mit Rechnung in der Heizperiode (eine eingetragene Fläche geht
  vor). Der Abzug ist je Mietverhältnis r = ‰ · C_u · x_t / A_u, **ohne** Normierung auf die Mieter
  der Wohnung: Was in A_u auf Leerstand, Eigennutzung oder Pauschale fällt, bleibt beim Vermieter, wie
  bei der zentralen Anlage. C_u über A_u → `co2.exceeds-heating`, die Wohnung bekommt keinen Abzug.
  Die Rechnung steht in `perUnitClassification`, `perUnitReliefs`, `perUnitExceeding`; die eigene
  Aufteilung (PR 7) setzt sie über `perUnitFuelOf` in calc.ts ein.
```

Im Absatz `**API**` hinter der Route `/api/heating-plants` ergänzen: „(der Rumpf beim Anlegen nimmt
`adjust` für Name und Wohnungen bisheriger Anlagen)“.

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden (Wegwerf-Ordner, `CI`,
geschlossener Update-Port). Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement server/test/fixtures/heating
```

Expected: keine Ausgabe (Golden F01–F15 unverändert).

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "Mehrere Heizanlagen und Etagenheizung: Smoke-Test, CHANGELOG, Architekturabschnitt

Refs #97"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“). Sie prüft ausdrücklich
die Abweichungen 1 bis 6, die Annahmen B1 bis B5 gegen den Code von PR 7 und die fünf Punkte des Review
Focus. Befunde mit einem vorher roten Test beheben; PR gestapelt auf PR 8 mit `Refs #97` und den
Befunden in der Beschreibung. Da PR 1 bis PR 9 aufeinander aufbauen, folgt vor dem Merge die
Integrationsdurchsicht des Endstands (`main..Spitze`) mit den Blickwinkeln Geld und Daten, der Praxislauf
auf der Spitze und das Label `full-check` an der obersten PR.

---

## Selbstprüfung

**1. Abdeckung des Entwurfs (Zeile PR 9 in Abschnitt 13 und die genannten Abschnitte):**

| Anforderung | Task |
|---|---|
| Zweite Anlage, Sperre aus PR 4 aufheben (13, 12.4 „Sperren je PR“) | 1 |
| `name` ab der zweiten Anlage Pflicht; Wohnungen schließen sich aus, auch beim Wiederherstellen (5.3, 12.4) | 1 (Abweichung 2: Namen verschieden) |
| `perUnit`, Sperre aus PR 4 aufheben, Direktzuordnung je Wohnung (11.2 Schritt 1) | 2, 5 (Abweichung 3) |
| `fuel_deliveries.unit_id` nur bei `perUnit`, Sperre aus PR 7 aufheben (5.4 F8) | 2, 5 |
| Einstufung bei `perUnit` über vermietete Wohnungen mit Lieferung, § 5 Abs. 1 S. 2 (9.2 Nr. 1) | 3, 4 (Abweichung 6) |
| Abzug r_t = ‰ · C_u · x_t / A_u ohne Normierung, Leerstand beim Vermieter (9.3 F8) | 3, 4 |
| C_u > A_u → `co2.exceeds-heating` (9.3, 10.1) | 3, 4 |
| Position über zwei Anlagen → `co2.item-spans-plants` (error) (9.3 F9, 10.1) | 3, 4 |
| Zwei Anlagen rechnen unabhängig (12.3 Nr. 13) | 4 |
| Invariante 0 ≤ r_t ≤ x_t, Σ r ≤ ‰ · C_u (12.3 Nr. 9) | 3 |
| Lexikon: Fläche bei Etagenheizung (10.3) | 4 |
| Oberfläche: weitere Anlage, Etagenheizung, Wahl der Anlage (11.2, 14.1) | 5 |
| Heizposition ohne Anlage bei mehreren Anlagen (3.0) | 1, 4 (Abweichung 4, 5) |
| CHANGELOG, CLAUDE.md, Smoke-Test | 6 |

**2. Platzhalter:** Keine offenen Stellen im Code. Die Namen aus PR 7 sind als Annahmen B1 bis B5 (und
A1, A4, A6, A7, A11 aus dem Plan von PR 8) benannt und vor Task 1 abzugleichen; an genau einer Stelle
(Task 4 Step 6, Naht N2) hängt der Wortlaut vom Code von PR 7, an einer weiteren (Task 5 Step 7) der
Name des Lieferungsformulars.

**3. Typen und Namen:** `BasisContext`, `PlantServing`, `PerUnitFuel` (Task 3) sind in co2.ts, calc.ts
und den Tests dieselben; `perUnitReliefs` liefert `{ tenancyId, unitId, raw }`, calc.ts reicht
`{ tenancyId, raw }` an die Verteilung aus PR 7 (B2) weiter; `exactByItem` (Task 4) füttert
`PerUnitFuel.shares`; `adjust` hat auf dem Server (`readAdjust`, Task 1) und in der Oberfläche
(`AdjustRow`, Task 5) dieselben Felder `id`, `name`, `units`; `plantServesUnit` (Task 2) nutzen
`guardCostItemHeating` und `guardFuelDelivery`; `co2.item-spans-plants` steht mit einer Stufe in
`noticeKinds` und mit den Begriffen `co2Split`, `heatingSystem`.

**4. Review Focus:** alle fünf Punkte mit Test: 1 in Task 1 und 5, 2 in Task 4, 3 in Task 3 und 4,
4 in Task 1 und 4, 5 in Task 2.
