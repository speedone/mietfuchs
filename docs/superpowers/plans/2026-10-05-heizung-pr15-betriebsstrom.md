# Heizung PR 15: Betriebsstrom der Heizung (#212) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Betriebsstrom einer Zentralheizung (Brenner, Umwälzpumpe, Regelung) lässt sich als
Heizposition erfassen, die auch im Allgemeinstrom steckt; Mietfuchs erkennt, wenn er dort nicht in
gleicher Höhe abgezogen ist (`heating.operating-power-double`, mit Betrag), und legt Betriebsstrom und
Abzug auf Wunsch gemeinsam an, geschätzt nach Leistung der Geräte und Heiztagen oder gemessen mit
Zwischenzähler.

**Architecture:** Zwei Spalten an `cost_items` (`operating_power`, `operating_power_item_id` mit
`RESTRICT` auf die eigene Tabelle) in zwei erzeugten Migrationen. Die Rechnung der Schätzhilfe liegt
DOM-frei in `shared/operatingPower.ts`, damit Formular und Server dieselbe Zahl rechnen. Eine Route
legt Betriebsstrom und Abzug in **einer** Transaktion an (`server/src/db/operatingPower.ts`). Die
Abrechnung prüft in `computeSettlement` jede Position, die sie verteilt, gegen die Abzüge aus allen
Zeiträumen (`Snapshot.operatingPowerDeductions`), über eine reine Funktion in
`server/src/operatingPower.ts`.

**Tech Stack:** Node 24 (TypeScript ohne Build), Express 5, Drizzle ORM 0.45 über `sqlite-proxy`,
drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(R-A23), 2 (V ZR 166/15 „geprüft 05.10.“), 4.3 letzter Absatz (Spannen nicht im Register), 10.1
(`heating.operating-power-double`, warning, Betrag, PR 15), 10.3, 11.4 (Anleitungen:
„Betriebsstrom-Satz“), 13 PR 15, 14.1 („Betriebsstrom im Allgemeinstrom: Warnung mit Betrag“), 14.2
(#212), 16 („Prozentspanne als Rechenregel für den Betriebsstrom“ ist Nicht-Ziel).

**Baut auf:** PR 1 bis PR 14 (`docs/superpowers/plans/2026-10-05-heizung-pr{1..14}-*.md`). Gearbeitet
wird auf `feat/heizung-pr15-betriebsstrom`, abgezweigt von der Spitze von PR 14; der PR wird gestapelt
gestellt und nach dem Merge von PR 14 auf `main` umgestellt (CLAUDE.md, „Durchsicht vor jedem PR und
vor jedem Merge“). Die Pläne von PR 13 und PR 14 entstanden parallel; abgeglichen ist dieser Plan mit
ihrem Stand in `e46bc65` („Plan: Heizung PR 13 und PR 14“), siehe „Abgleich mit PR 13 und PR 14“.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne `operatingPower` an einer
  Position ist jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 14. Golden
  F01–F18, `db-golden`, `calc-wortlaut.test.ts` und `law-wording.test.ts` bleiben ohne Anpassung grün.
- **Keine Prozentspanne als Rechenregel** (Entwurf 4.3 letzter Absatz, 16): Die Spannen 3–6 % (Jennißen),
  4–10 % (Schmidt-Futterer/Lammel), 8–10 % (Wall) und „höchstens 5 %“ (Gies) stehen nur im Lexikon, als
  vom BGH referierte, nicht gebilligte Werte (V ZR 166/15 Rn. 14). Sie kommen nicht ins Register und in
  keine Rechnung.
- **Kein Betrag wird automatisch abgezogen** (6.5 sinngemäß): Mietfuchs legt den Abzug nur an, wenn der
  Vermieter es mit der Schätzhilfe ausdrücklich verlangt; die Abrechnung meldet eine Abweichung, sie
  korrigiert sie nicht.
- **Stufe hängt am Code** (CLAUDE.md, #112): `heating.operating-power-double` ist `warning` (10.1), mit
  dem Betrag im Text.
- **Migrationen:** nur `npm --prefix server run db:generate -- --name <name>`, zwei Schritte in dieser
  Reihenfolge: `betriebsstrom` (zwei neue Spalten) und `betriebsstrom_bedingungen` (Bedingungen, Neubau
  von `cost_items`). drizzle-kit vergibt die Nummer. Nach den Plänen von PR 12 (0030/0031), PR 13
  (`0032_schaetzung`) und PR 14 (`0033_pflichtangaben`, `0034_pflichtangaben_bedingungen`) entstehen
  `0035_betriebsstrom` und `0036_betriebsstrom_bedingungen`; die Tests nennen die Schritte nur über ihre
  Kennung (`tag`), nicht über die Nummer. Keine Datenanweisung.
- **Eingefrorener Eingang** (`server/src/legacy/{schema,write,migrate}.ts`) und `legacy/validate.ts`
  bleiben unverändert; die db.json kennt keinen Betriebsstrom.
- **Objektgrenze:** Ein Abzug zeigt nur auf eine Position desselben Objekts (`HeatingError` 400).
- **Rechtsaussagen:** Leitsatz und Rn. 14 von BGH, Urteil vom 03.06.2016, V ZR 166/15, am 05.10.2026 auf
  rewis.io gelesen: „Die Kosten des Betriebsstroms der zentralen Heizungsanlage müssen nach Maßgabe der
  Heizkostenverordnung verteilt werden; wird der Betriebsstrom nicht über einen Zwischenzähler, sondern
  über den allgemeinen Stromzähler erfasst, muss geschätzt werden, welcher Anteil an dem Allgemeinstrom
  hierauf entfällt.“ Rn. 14 nennt die Literaturspannen und eine Schätzung, „die auf dem
  Stromverbrauchswert der angeschlossenen Geräte und den (ggf. geschätzten) Heiztagen beruht“; die Wahl
  steht im Ermessen, „solange [kein] offenkundig ungeeigneter Maßstab“ gewählt wird. Die Pflicht folgt
  aus § 7 Abs. 2 HeizkostenV („die Kosten des Betriebsstromes“, Wortlaut am 05.10.2026 gelesen) und gilt
  damit für jeden Gebäudeeigentümer nach § 1 HeizkostenV, nicht nur in der WEG. § 2 Nr. 11 BetrKV
  (Beleuchtung) nennt nur Außenbeleuchtung und gemeinsam genutzte Gebäudeteile (gelesen 05.10.2026).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigen das `startServer`/`startServerIn`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Commit-Nachrichten deutsch, mit `Refs #212`, und mit den Attribution-Zeilen der
  ausführenden Sitzung.

## Review Focus

1. **Der Allgemeinstrom ist mit „Einzelbeträge“ oder „laut Gemeinschaftsabrechnung“ verteilt** (ETW mit
   Hausgeld). Einen Abzug in gleicher Verteilung gibt es dann nicht. Erwartet: Die Schätzhilfe lehnt mit
   einem Satz ab, der sagt, wo der Abzug stattdessen hingehört. Test in Task 4.
2. **Die Betriebsstrom-Position wird gelöscht, während ein Abzug auf sie zeigt.** Erwartet: 400 mit einem
   Satz, der den Abzug nennt, kein Datenbankfehler und kein stilles Mitlöschen (das änderte den
   Allgemeinstrom eines anderen Zeitraums). Test in Task 2.
3. **Der Abzug wird im Kostenformular bearbeitet** (Beschreibung oder Betrag). Der Client schickt bei
   „Beleuchtung/Allgemeinstrom“ kein Feld `operatingPower`. Erwartet: Die Kennzeichnung bleibt, der Abzug
   gehört weiter zu seinem Betriebsstrom. Test in Task 2 (Server) und Task 6 (Rumpf des Formulars).
4. **Die geschätzten kWh liegen über dem Verbrauch der Stromrechnung** (Leistung in kW statt W, 24 h für
   den Brenner). Erwartet: 400 mit den beiden kWh im Satz, keine Position. Test in Task 3 und Task 4.
5. **Betriebsstrom in der Heizperiode `2025-05`, Abzug beim Allgemeinstrom `2026-01`** (eigene
   Heizperiode, Weg b oder d). Erwartet: keine Warnung, weil der Abzug zu der Position gehört und nicht
   zum Zeitraum; wird der Abzug gelöscht, erscheint die Warnung in der Abrechnung, die den Betriebsstrom
   verteilt. Test in Task 5.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/glossary.ts`, `shared/guides.ts`, `server/test/law-literals.test.ts` | Begriff `operatingPower`, Satz in zwei Anleitungen, erlaubte Literaturspannen | 1 |
| `shared/types.ts` | `OperatingPower`, `OperatingPowerDevice`, `OperatingPowerDeduction`; `CostItem.operatingPower`, `.operatingPowerItemId` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/00xx_betriebsstrom*.sql`, `meta/*` (erzeugt) | Spalten, Bedingungen | 2 |
| `server/src/db/read.ts`, `server/src/db/repository.ts` | Lesen, Schreiben, Prüfen, Löschsperre | 2 |
| `shared/operatingPower.ts` (neu) | Schätzung nach Leistung und Heiztagen, Anteil an der Stromrechnung | 3 |
| `server/src/db/operatingPower.ts` (neu), `server/src/index.ts` | Betriebsstrom und Abzug anlegen, Route | 4 |
| `server/src/operatingPower.ts` (neu), `server/src/snapshot.ts`, `server/src/calc.ts` | Abzüge im Schnappschuss, Befund, Hinweis | 5 |
| `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`, `client/src/operatingPowerForm.ts` (neu), `client/src/components/OperatingPowerCard.tsx` (neu), `client/src/pages/Heizkosten.tsx` | Frage am Kostenformular, Karte „Betriebsstrom“ | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `server/test/glossary.test.ts`, `server/test/guides.test.ts`, `server/test/operating-power.test.ts` (neu), `server/test/db-betriebsstrom.test.ts` (neu), `server/test/migrations.test.ts`, `server/test/db-stock.test.ts`, `server/test/db-repository.test.ts`, `server/test/calc-betriebsstrom.test.ts` (neu), `server/test/api.test.ts`, `client/src/costForm.test.ts`, `client/src/operatingPowerForm.test.ts` (neu), `client/src/components/OperatingPowerCard.test.tsx` (neu) | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so, aus dem Code auf `feat/heizung` (PR 1, PR 2) und den Plänen von PR 3 bis PR 12:

- `shared/heating.ts`: `HEATING_CATEGORY` (`'Heizung und Warmwasser'`).
- `server/src/db/repository.ts` (Code und Pläne PR 3, 4, 10): `merged`, `raw`, `has`, `oneOfOrUndefined`,
  `orNull` (Datei-intern), `asOptionalText` (Datei-intern), `mergeCostItem`, `costItemRow`,
  `guardCostItem(db, before, after, body, options?)`, `costItemCollection`, `insertCostItemIn(tx, id,
  body)`, `HeatingError` (PR 4, `new HeatingError(status, message)`), `CrossPropertyError`; in index.ts
  sind `HeatingError` und `CrossPropertyError` in der Fehlerbehandlung (PR 4).
- `server/src/db/read.ts`: `readCostItems(db)`, `readHeatingPlants(db)` (PR 4), `Stock`, `readStock`.
- `server/src/db/heatingPeriodContext.ts` (PR 8): `plantContext(db, plantId)`, `heatingPeriodOf(ctx,
  key)`, `heatingPeriodClosed(db, ctx, h)`, `PlantContext`.
- `shared/types.ts`: `CostItem` mit `heatingPlantId` (PR 4), `heatingPart` (PR 3, `'fuel' | 'operating' |
  'metering'`), `heatingTarget` (PR 10, `'both' | 'heating' | 'water'`), `fuelDeliveryId` (PR 7);
  `CostKey` mit `'heatingSystem'` (PR 10); `HeatingPlant.method` (`'service' | 'self' | 'manual'`).
- `server/src/snapshot.ts`: `Snapshot`, `SnapshotCostItem` (Pick aus `CostItem`), `SnapshotSource`,
  `snapshotFor(source, propertyId, period)`, `heatingSnapshotFor(source, propertyId, plantId, h)` (PR 5),
  `snapshotOfPeriod(source, period, previous)`.
- `server/src/calc.ts`: in `computeSettlement` `items` (`snapshot.costItems.filter((c) => c.period ===
  period.key)`; bei Weg b rechnet ein Unteraufruf die Positionen der Heizperiode mit `costItems:
  part.items`, PR 5 Task 5), `warn(code, text, subject?)`, `notices`, `lawLog`; Modul-Helfer `fmtCents`,
  `itemSubject`; `noticeKinds`; die Zeile `// Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren
  wird sie hier.` vor `const result: ComputedSettlement = {`.
- Client: `api`, `errorText`, `fmtEuro`, `parseEuro` (`client/src/api.ts`); `useToast`; `Term`;
  `client/src/pages/Heizkosten.tsx` (PR 6 Task 11, PR 7 Task 11) mit den Karten je Anlage und
  Heizperiode (`view: HeatingPeriodView` mit `plantId`, `period`, `label`, `closed`, `items`); in
  `client/src/costForm.ts` `ItemForm`, `itemToForm`, `buildCostItemBody`.

### Abgleich mit PR 13 und PR 14

| Punkt | Stand in den Plänen von PR 13 und PR 14 (`e46bc65`) | Folge hier |
|---|---|---|
| Migrationen | PR 13 `0032_schaetzung`, PR 14 `0033_pflichtangaben`, `0034_pflichtangaben_bedingungen` | dieser Plan erzeugt 0035/0036 |
| `CostItem`, `guardCostItem`, `insertCostItemIn` | in beiden Plänen unverändert | Task 2, Task 4 wie geschrieben |
| Einfügestelle vor `// Die Höchstdauer hat P gebildet …` | in beiden Plänen unverändert | Task 5 wie geschrieben |

Weicht der Code bei der Umsetzung davon ab, gilt der Code; die Namen dieses Plans bleiben, nur die
Einfügestelle wandert.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Der Entwurf beschreibt PR 15 in drei Sätzen (13 PR 15) und nennt kein Datenmodell (5.1 hat keine Zeile
für PR 15). Jede der folgenden Festlegungen hat dort keine Grundlage und ist hier begründet:

1. **Datenmodell (Festlegung).** `cost_items.operating_power` (`'included' | 'deduction'`, nullbar) und
   `cost_items.operating_power_item_id` (nullbar, `RESTRICT` auf `cost_items`). Begründung: Mietfuchs kann
   einer Heizposition nicht ansehen, ob sie Betriebsstrom ist und ob er im Allgemeinstrom steckt; beides
   ist eine Tatsache, die nur der Vermieter kennt. Die Verknüpfung macht den Abzug unabhängig vom
   Zeitraum (Review Focus 5). Einen Wert „eigener Zähler mit eigener Rechnung“ gibt es nicht: Dann ist
   nichts doppelt, und `null` sagt dasselbe.
2. **„Ungekürzt“ wird als „nicht in gleicher Höhe abgezogen“ geprüft (Festlegung).** Der Entwurf nennt
   „der Allgemeinstrom ungekürzt umgelegt“. Geprüft wird je Betriebsstrom-Position mit `included`:
   Betrag + Σ der verknüpften Abzüge = 0. Ist der Abzug kleiner, verteilt die Abrechnung den Rest doppelt
   (der Text nennt den Betrag); ist er größer, trägt der Vermieter einen Teil des Allgemeinstroms selbst
   (zweiter Text desselben Codes, denn auch das ist „Geld landet anders als vermutlich gewollt“, die
   Stufe `warning` nach CLAUDE.md, #112). Ein Code, zwei Texte; die Stufe bleibt am Code.
3. **Euro-Betrag als Anteil an der Stromrechnung (Festlegung).** Der Leitsatz verlangt zu schätzen,
   „welcher Anteil an dem Allgemeinstrom hierauf entfällt“. Mietfuchs rechnet Betrag der
   Allgemeinstrom-Position × geschätzte kWh ÷ kWh laut Stromrechnung, also einschließlich eines
   anteiligen Grundpreises. Das ist ein Anteil am Allgemeinstrom im Wortsinn und braucht keinen
   Arbeitspreis, den die Position nicht kennt. kWh = Σ Leistung (W) × Laufzeit (h je Tag) × Heiztage ÷
   1.000 (Rn. 14: „Stromverbrauchswert der angeschlossenen Geräte und … Heiztage“). Laufzeit und Heiztage
   gibt der Vermieter ein; **es gibt keine Vorgabe**, denn jede Zahl wäre erfunden.
4. **Gemessen mit Zwischenzähler als zweiter Weg (Festlegung).** Der Leitsatz nennt den Zwischenzähler
   als den Fall ohne Schätzung. Steckt er hinter dem Hauszähler, ist der Strom trotzdem in der
   Stromrechnung und muss abgezogen werden. Die Hilfe nimmt dann die gemessenen kWh statt der Geräte.
5. **Schlüssel des Betriebsstroms (Festlegung).** `self`: `heatingSystem`, Teil `operating`, Ziel `both`
   (Entwurf 8.6: Ziel `both` verteilt mit den Gewichten der Anlage). `manual`: Schlüssel und Angaben der
   Brennstoffposition derselben Heizperiode (Betriebsstrom gehört zu den Kosten des § 7 Abs. 2
   HeizkostenV und wird wie der Brennstoff verteilt); ohne Brennstoffposition lehnt die Hilfe ab.
   `service`: keine Betriebsstrom-Position, denn der Messdienst verteilt ihn in seinen Beträgen; die Hilfe
   legt nur den Abzug an (ohne Verknüpfung) und sagt, dass der Betrag dem Messdienst zu melden ist.
6. **Abzug in der Verteilung des Allgemeinstroms (Festlegung).** Der Abzug übernimmt Schlüssel,
   Zählertyp, Direktzuordnung, vereinbarte Anteile und Teilnehmer der Allgemeinstrom-Position; so mindert
   er jeden Anteil genau im Verhältnis. Bei `amounts` und `external` lehnt die Hilfe ab (Review Focus 1).
7. **Löschen gesperrt statt kaskadiert (Festlegung).** `RESTRICT` und ein Satz in `costItemCollection.remove`.
8. **Nicht in diesem Plan:** Ein Hinweis, wenn eine Zentralheizung **gar keinen** Betriebsstrom hat und
   der Allgemeinstrom ungekürzt verteilt wird (der Fall des BGH). Der Entwurf verlangt ihn nicht (10.1
   kennt nur `heating.operating-power-double`), und ohne Angabe des Vermieters wäre er bei jeder Anlage mit
   eigenem Stromvertrag falsch. Vorschlag für ein neues Issue (öffentlich, vor dem Anlegen nachfragen):
   „Betriebsstrom fehlt: Hinweis bei Zentralheizung ohne Betriebsstrom-Position“.

---

### Task 1: Lexikon, Anleitungen und Wächter

Der Begriff `operatingPower` mit der Schätzung nach Leistung und Heiztagen als Beispiel und den
Literaturspannen als referierte Werte; je ein Satz in den Anleitungen „Mehrfamilienhaus“ und
„Messdienst“ (Entwurf 11.4). Die Spannen sind keine Rechtswerte, der Wächter bekommt sie als erlaubte
Stellen mit Grund.

**Files:**
- Modify: `shared/glossary.ts`, `shared/guides.ts`, `server/test/law-literals.test.ts`
- Test: `server/test/glossary.test.ts`, `server/test/guides.test.ts`

**Interfaces:**
- Consumes: `GLOSSARY`, `TermId`, `GUIDES`.
- Produces: `TermId` + `'operatingPower'`.

- [ ] **Step 1: Write the failing tests**

In `server/test/glossary.test.ts` anhängen:

```ts
// Heizung PR 15 (#212): Betriebsstrom, mit der Schätzung des BGH als Beispiel und den Spannen der
// Literatur nur als referierte Werte (Entwurf 4.3 letzter Absatz).
test('Lexikon: Betriebsstrom nennt § 7 Abs. 2 HeizkostenV, das Urteil und rechnet das Beispiel richtig', () => {
  const t = GLOSSARY.operatingPower
  assert.match(t.norm ?? '', /§ 7 Abs\. 2 HeizkostenV/)
  assert.match(t.norm ?? '', /V ZR 166\/15/)
  // 120 W × 6 h + 45 W × 24 h + 5 W × 24 h an 220 Tagen = 422,4 kWh; 422,4 / 3.000 von 1.050,00 €.
  assert.match(t.example, /422,4 kWh/)
  assert.match(t.example, /147,84 €/)
  assert.match(t.example, /nur wiedergegeben, nicht gebilligt/)
  assert.match(t.needed, /offenkundig ungeeignet/)
})
```

In `server/test/guides.test.ts` anhängen:

```ts
test('Anleitungen: Betriebsstrom steht bei Mehrfamilienhaus und Messdienst, mit Norm (Heizung PR 15)', () => {
  for (const id of ['multiFamily', 'meteringService'] as const) {
    const c = GUIDES[id].caveats.find((x) => x.text.includes('Betriebsstrom'))
    if (!c) return assert.fail(`${id}: kein Satz zum Betriebsstrom`)
    assert.match(c.norm ?? '', /§ 7 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/glossary.test.ts test/guides.test.ts`
Expected: FAIL, `Cannot read properties of undefined (reading 'norm')` bzw. „kein Satz zum Betriebsstrom“.

- [ ] **Step 3: Lexikon (`shared/glossary.ts`)**

In `GLOSSARY` hinter `heatingCostOrdinance` einfügen:

```ts
  // Heizung PR 15 (#212). Leitsatz und Rn. 14 von BGH, Urteil vom 03.06.2016, V ZR 166/15, am
  // 05.10.2026 gelesen (rewis.io). Die Spannen der Literatur sind keine Rechtswerte und stehen nur hier
  // (Entwurf 4.3 letzter Absatz); law-literals.test.ts nennt sie als erlaubte Stellen.
  operatingPower: {
    title: 'Betriebsstrom der Heizung',
    short: 'Der Strom für Brenner, Umwälzpumpe und Regelung einer Zentralheizung gehört zu den Heizkosten und wird mit ihnen nach der Heizkostenverordnung verteilt, nicht als Allgemeinstrom. Hat er keinen eigenen Stromvertrag, steckt er in der Stromrechnung des Hauses; dann ist er dort herauszurechnen und abzuziehen.',
    example: 'Brenner 120 W an 6 Stunden am Tag, Umwälzpumpe 45 W und Regelung 5 W rund um die Uhr, an 220 Heiztagen: 158,4 + 237,6 + 26,4 = 422,4 kWh. Die Stromrechnung des Hauses nennt 3.000 kWh für 1.050,00 €; auf die Heizung entfallen 422,4 von 3.000 kWh, also 147,84 €. Diese 147,84 € stehen als Betriebsstrom bei den Heizkosten und als Abzug beim Allgemeinstrom, und die Mieter zahlen den Strom nur einmal. In der Literatur werden auch pauschale Anteile an den Brennstoffkosten genannt (3–6 %, 4–10 %, 8–10 % oder höchstens 5 %); der Bundesgerichtshof hat sie nur wiedergegeben, nicht gebilligt.',
    norm: '§ 7 Abs. 2 HeizkostenV; § 2 Nr. 4 Buchst. a und Nr. 11 BetrKV; BGH, Urteil vom 03.06.2016, V ZR 166/15',
    needed: 'Ja, bei jeder Zentralheizung, deren Strom über den Zähler des Hauses läuft. Ohne Zwischenzähler muss der Anteil geschätzt werden. Welches Verfahren Sie wählen, liegt in Ihrem Ermessen, solange es nicht offenkundig ungeeignet ist; das Verfahren nach Leistung der Geräte und Heiztagen nennt der Bundesgerichtshof ausdrücklich. Entschieden hat er für eine Wohnungseigentümergemeinschaft; die Pflicht, den Betriebsstrom mit den Heizkosten zu verteilen, steht für jeden Vermieter in der Heizkostenverordnung.',
  },
```

- [ ] **Step 4: Anleitungen (`shared/guides.ts`)**

In `GUIDE_DATA.multiFamily.caveats` und `GUIDE_DATA.meteringService.caveats` je als letzten Eintrag:

`multiFamily`:

```ts
      { text: 'Den Strom für Brenner, Umwälzpumpe und Regelung der Zentralheizung (Betriebsstrom) verteilen Sie mit den Heizkosten, nicht als Allgemeinstrom. Läuft er über den Stromzähler des Hauses, schätzen Sie ihn und ziehen ihn beim Allgemeinstrom ab; die Karte „Betriebsstrom“ auf der Seite Heizkosten rechnet das nach Leistung und Heiztagen vor und legt beide Positionen an.', norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15' },
```

`meteringService`:

```ts
      { text: 'Melden Sie dem Messdienst auch den Betriebsstrom der Heizung (Brenner, Umwälzpumpe, Regelung), damit er ihn mit den Heizkosten verteilt. Läuft er über den Stromzähler des Hauses, ziehen Sie denselben Betrag beim Allgemeinstrom ab; die Karte „Betriebsstrom“ auf der Seite Heizkosten schätzt ihn nach Leistung und Heiztagen und legt den Abzug an.', norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15' },
```

(`terms` beider Anleitungen um `'operatingPower'` ergänzen.)

- [ ] **Step 5: Wächter (`server/test/law-literals.test.ts`)**

In `ALLOWED` anhängen:

```ts
  { file: 'shared/glossary.ts', match: '3–6 %', reason: 'Literaturwert (Jennißen), vom BGH in V ZR 166/15 Rn. 14 referiert, nicht gebilligt; kein Rechtswert (Entwurf 4.3)' },
  { file: 'shared/glossary.ts', match: '4–10 %', reason: 'Literaturwert (Schmidt-Futterer/Lammel), vom BGH in V ZR 166/15 Rn. 14 referiert; kein Rechtswert (Entwurf 4.3)' },
  { file: 'shared/glossary.ts', match: '8–10 %', reason: 'Literaturwert (Wall), vom BGH in V ZR 166/15 Rn. 14 referiert; kein Rechtswert (Entwurf 4.3)' },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/glossary.test.ts test/guides.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Prüft `guides.test.ts` zitierte Beschriftungen nur in Schritten und Ergebnis, nicht in
`caveats` (Stand PR 1); „Betriebsstrom“ in Anführungszeichen steht ab Task 6 als Überschrift der Karte
ohnehin in der Oberfläche.

- [ ] **Step 7: Commit**

```bash
git add shared/glossary.ts shared/guides.ts server/test/law-literals.test.ts server/test/glossary.test.ts server/test/guides.test.ts
git commit -m "Lexikon und Anleitungen: Betriebsstrom der Heizung

Schätzung nach Leistung und Heiztagen als Beispiel, die Spannen der
Literatur nur als vom BGH referierte Werte (V ZR 166/15 Rn. 14).

Refs #212"
```

---

### Task 2: Datenmodell, Migrationen, Lesen, Schreiben und Prüfen

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/test/migrations.test.ts`, `server/test/db-stock.test.ts`, `server/test/db-repository.test.ts`
- Create: `server/drizzle/00xx_betriebsstrom.sql`, `server/drizzle/00xx_betriebsstrom_bedingungen.sql` (erzeugt)
- Test: `server/test/db-betriebsstrom.test.ts` (neu)

**Interfaces:**
- Consumes: `costItems`, `oneOf`, `exactly` (schema.ts); `mergeCostItem`, `costItemRow`, `guardCostItem`, `costItemCollection`, `HeatingError`, `merged`, `oneOfOrUndefined`, `asOptionalText`, `orNull` (repository.ts); `HEATING_CATEGORY`.
- Produces:
  - `shared/types.ts`: `type OperatingPower = 'included' | 'deduction'`, `type OperatingPowerDevice = { label: string; watts: number; hoursPerDay: number }`, `type OperatingPowerDeduction = { id: string; itemId: string | null; period: PeriodKey; description: string; amountCents: number }`; `CostItem.operatingPower?: OperatingPower`, `CostItem.operatingPowerItemId?: string`
  - `server/src/db/schema.ts`: `OPERATING_POWER`, Spalten `costItems.operatingPower`, `costItems.operatingPowerItemId`
  - `shared/operatingPower.ts` (nur die Konstante, die Rechnung folgt in Task 3): `GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'`
  - repository.ts: `guardOperatingPower(db: Executor, before: CostItem | null, after: CostItem): Promise<void>` (Datei-intern, aufgerufen am Ende von `guardCostItem`)

- [ ] **Step 1: Write the failing tests**

`server/test/db-betriebsstrom.test.ts`:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die zwei Spalten an cost_items, ihre Bedingungen und
// die Prüfungen beim Schreiben und Löschen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-'))

function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)
const heizung = (over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung',
  amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included', ...over,
})
const abzug = (itemId: string | null, over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom Heizung',
  amountCents: -14784, key: 'area', operatingPower: 'deduction', operatingPowerItemId: itemId, ...over,
})

test('Kette: die Schritte betriebsstrom und betriebsstrom_bedingungen bringen zwei nullbare Spalten, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_betriebsstrom'))
    if (bis < 0) assert.fail('Schritt …_betriebsstrom fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('alt', 'objekt-1', '2025-01', 'Beleuchtung/Allgemeinstrom', 'Strom', 105000, 'area')`)
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT operating_power, operating_power_item_id FROM cost_items WHERE id = 'alt'"), [[null, null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Betriebsstrom nur an Heizkosten (Teil Betrieb), Abzug nur am Allgemeinstrom und negativ, Verweis nur am Abzug', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const insert = (id: string, category: string, amount: number, extra: string, values: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${extra}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'x', ${amount}, 'area'${values})`
    assert.equal(rejects(c, insert('bs', 'Heizung und Warmwasser', 14784, ', heating_part, operating_power', ", 'operating', 'included'")), null)
    assert.match(rejects(c, insert('a', 'Heizung und Warmwasser', 1, ', heating_part, operating_power', ", 'fuel', 'included'")) ?? '', /cost_items_operating_power_included/)
    assert.match(rejects(c, insert('b', 'Grundsteuer', 1, ', operating_power', ", 'included'")) ?? '', /cost_items_operating_power_included/)
    assert.match(rejects(c, insert('d', 'Beleuchtung/Allgemeinstrom', 100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction/)
    assert.match(rejects(c, insert('e', 'Gebäudereinigung', -100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction/)
    assert.match(rejects(c, insert('f', 'Beleuchtung/Allgemeinstrom', -100, ', operating_power_item_id', ", 'bs'")) ?? '', /cost_items_operating_power_link/)
    assert.match(rejects(c, insert('g', 'Heizung und Warmwasser', 1, ', operating_power', ", 'sonst'")) ?? '', /cost_items_operating_power_known/)
    assert.equal(rejects(c, insert('h', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id', ", 'deduction', 'bs'")), null)
    // RESTRICT: Der Betriebsstrom lässt sich nicht löschen, solange der Abzug auf ihn zeigt.
    assert.match(rejects(c, "DELETE FROM cost_items WHERE id = 'bs'") ?? '', /FOREIGN KEY/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: Betriebsstrom und Abzug werden gelesen, wie sie gespeichert sind', async () => {
  await withDatabase(async (opened) => {
    const bs = await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    assert.equal(fieldOf(bs, 'operatingPower'), 'included')
    const ab = await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId')], ['deduction', 'bs'])
    const ohne = await opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }))
    assert.deepEqual([fieldOf(ohne, 'operatingPower'), fieldOf(ohne, 'operatingPowerItemId')], [undefined, undefined])
  })
})

test('Review Focus 3: der Abzug bleibt gekennzeichnet, wenn das Formular ihn ohne das Feld speichert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await opened.write((db) => updateEntity(db, 'costItems', 'ab', { description: 'Abzug Betriebsstrom 2025', amountCents: -15000 }))
    const ab = await opened.read((db) => findEntity(db, 'costItems', 'ab'))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'amountCents')], ['deduction', 'bs', -15000])
  })
})

test('Prüfen: ein Abzug zeigt nur auf Betriebsstrom desselben Objekts, der Betriebsstrom verliert die Kennzeichnung nicht unter einem Abzug', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x1', abzug('gas'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /nicht als Betriebsstrom gekennzeichnet/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x2', abzug('fehlt'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /gibt es nicht/.test(e.message))
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x3', abzug('bs', { propertyId: 'objekt-2' }))),
      (e: unknown) => e instanceof CrossPropertyError && /gehört zu einem anderen Objekt/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPower: null })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Abzug „Abzug Betriebsstrom Heizung“/.test(e.message))
  })
})

test('Review Focus 2: Betriebsstrom mit Abzug lässt sich nicht löschen; mit einem Satz statt eines Datenbankfehlers', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'bs')),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Abzug Betriebsstrom Heizung“/.test(e.message) && /Löschen Sie zuerst den Abzug/.test(e.message))
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'ab')), true)
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'bs')), true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts`
Expected: FAIL, „Schritt …_betriebsstrom fehlt“ und Prüfungen, die nicht ablehnen.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Ans Dateiende:

```ts
// ---------- Betriebsstrom der Heizung (Heizung PR 15, #212) ----------

// An einer Position „Heizung und Warmwasser“ heißt `included`: Dieser Betriebsstrom (Brenner,
// Umwälzpumpe, Regelung) steckt auch in der Stromrechnung des Allgemeinstroms, weil er über den Zähler
// des Hauses läuft, gemessen mit Zwischenzähler oder geschätzt. An einer Position
// „Beleuchtung/Allgemeinstrom“ heißt `deduction`: der Abzug dieses Stroms. Ohne Angabe ist eine
// Position weder das eine noch das andere.
export type OperatingPower = 'included' | 'deduction'

// Ein Gerät der Heizung für die Schätzung nach Leistung und Heiztagen (BGH, Urteil vom 03.06.2016,
// V ZR 166/15, Rn. 14: „Stromverbrauchswert der angeschlossenen Geräte und … Heiztage“).
export type OperatingPowerDevice = { label: string; watts: number; hoursPerDay: number }

// Ein Abzug beim Allgemeinstrom, wie der Schnappschuss ihn führt: aus allen Zeiträumen des Objekts,
// denn er gehört zu der Betriebsstrom-Position, auf die er zeigt, und nicht zum Zeitraum. `itemId` ist
// null bei einer Anlage mit Messdienst, dessen Beträge den Betriebsstrom enthalten.
export type OperatingPowerDeduction = { id: string; itemId: string | null; period: PeriodKey; description: string; amountCents: number }
```

`CostItem` bekommt als letzte Felder:

```ts
  // Betriebsstrom der Heizung (Heizung PR 15): siehe `OperatingPower`. `operatingPowerItemId` nur am
  // Abzug: die Betriebsstrom-Position, zu der er gehört.
  operatingPower?: OperatingPower
  operatingPowerItemId?: string
```

- [ ] **Step 4: Erster Schritt: Spalten (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `OperatingPower` ergänzen und aus
`'drizzle-orm/sqlite-core'` um `type AnySQLiteColumn`. Neben `HEATING_PARTS` (PR 3):

```ts
export const OPERATING_POWER = exactly<OperatingPower>()(['included', 'deduction'] as const)
```

In `costItems` als letzte Spalten:

```ts
    // Betriebsstrom der Heizung (Heizung PR 15, #212). `RESTRICT` auf die eigene Tabelle: Ein
    // Betriebsstrom mit Abzug wird nicht still gelöscht, denn der Abzug mindert den Allgemeinstrom
    // eines womöglich anderen Zeitraums (repository.ts lehnt mit einem Satz ab).
    operatingPower: text('operating_power', { enum: OPERATING_POWER }),
    operatingPowerItemId: text('operating_power_item_id').references((): AnySQLiteColumn => costItems.id, { onDelete: 'restrict' }),
```

Run: `npm --prefix server run db:generate -- --name betriebsstrom`
Expected: `server/drizzle/00xx_betriebsstrom.sql` mit zwei Zeilen `ALTER TABLE \`cost_items\` ADD
\`operating_power\` text;` und `ALTER TABLE \`cost_items\` ADD \`operating_power_item_id\` text REFERENCES
cost_items(id);` **ohne** `__new_`. Steht ein Neubau darin, Datei, Journal-Eintrag und Momentaufnahme
löschen und nur die Spalten erzeugen. Fragt drizzle-kit nach einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In der Bedingungsliste von `costItems` hinter `cost_items_fuel_delivery_category` (PR 7):

```ts
    // Betriebsstrom (Heizung PR 15): nur an Heizkosten mit Teil „Betrieb“ oder ohne Teil; der Abzug nur
    // am Allgemeinstrom und als Gutschrift; ein Verweis nur am Abzug.
    oneOf('cost_items_operating_power_known', 'operating_power', OPERATING_POWER),
    check('cost_items_operating_power_included', sql.raw(`"operating_power" IS NOT 'included' OR ("category" = 'Heizung und Warmwasser' AND ("heating_part" IS NULL OR "heating_part" = 'operating'))`)),
    check('cost_items_operating_power_deduction', sql.raw(`"operating_power" IS NOT 'deduction' OR ("category" = 'Beleuchtung/Allgemeinstrom' AND "amount_cents" < 0)`)),
    check('cost_items_operating_power_link', sql.raw(`"operating_power_item_id" IS NULL OR "operating_power" = 'deduction'`)),
```

Run: `npm --prefix server run db:generate -- --name betriebsstrom_bedingungen`
Expected: `server/drizzle/00xx_betriebsstrom_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, Neubau
`__new_cost_items` samt `INSERT INTO … SELECT` mit beiden neuen Spalten, `DROP TABLE`, `RENAME`, den
Indizes, `PRAGMA foreign_keys=ON`. Prüfen:

Run: `grep -c '__new_cost_items' server/drizzle/*_betriebsstrom_bedingungen.sql && grep -c 'operating_power' server/drizzle/*_betriebsstrom_bedingungen.sql`
Expected: eine Zahl ≥ 3, dann eine Zahl ≥ 6.

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('betriebsstrom')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

Expected: zwei Zeilen. In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter den Schritten von
PR 14 einfügen, darüber:

```ts
  // Heizung PR 15 (#212). Wird PR 14 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt
  // und die Marken hier ersetzt.
```

- [ ] **Step 7: Konstante der Kostenart (`shared/operatingPower.ts`, neu)**

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe. Die Rechnung selbst folgt in Task 3.

// Die Kostenart des Allgemeinstroms (§ 2 Nr. 11 BetrKV, Beleuchtung). Dieselbe Zeichenkette wie in
// shared/categories.ts; categories.test.ts hält beide zusammen.
export const GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'
```

In `server/test/categories.test.ts` anhängen:

```ts
test('Betriebsstrom: die Kostenart des Abzugs steht in der Liste der Kostenarten (Heizung PR 15)', () => {
  assert.ok(CATEGORIES.includes(GENERAL_POWER_CATEGORY))
})
```

(Import `import { GENERAL_POWER_CATEGORY } from '../../shared/operatingPower.ts'`; `CATEGORIES` ist dort
schon importiert, sonst aus `'../../shared/categories.ts'`.)

- [ ] **Step 8: Lesen und Schreiben**

`server/src/db/read.ts`, in `readCostItems` hinter dem letzten optionalen Feld (`fuelDeliveryId`, PR 7):

```ts
      // Betriebsstrom (Heizung PR 15): nur, wenn es die Angabe gibt.
      operatingPower: orUndefined(c.operatingPower),
      operatingPowerItemId: orUndefined(c.operatingPowerItemId),
```

`server/src/db/repository.ts`: `OPERATING_POWER` aus `./schema.ts` importieren. In `mergeCostItem` hinter
dem letzten Feld:

```ts
    // Betriebsstrom (Heizung PR 15). `null` leert; fehlt das Feld, bleibt die Angabe (Review Focus 3):
    // Das Formular schickt sie nur bei Heizkosten.
    operatingPower: merged(body, 'operatingPower', current.operatingPower, (v) => oneOfOrUndefined(OPERATING_POWER, v)),
    operatingPowerItemId: merged(body, 'operatingPowerItemId', current.operatingPowerItemId, asOptionalText),
```

In `costItemRow` hinter dem letzten Feld:

```ts
  operatingPower: orNull(c.operatingPower), operatingPowerItemId: orNull(c.operatingPowerItemId),
```

- [ ] **Step 9: Prüfen beim Schreiben und Löschen (`server/src/db/repository.ts`)**

Importe: `GENERAL_POWER_CATEGORY` aus `'../../../shared/operatingPower.ts'`. Hinter `guardCostItem`:

```ts
// Betriebsstrom und Abzug (Heizung PR 15, #212). Ein Abzug gehört zu genau einer Betriebsstrom-Position
// desselben Objekts; ohne Verweis gehört er zu einer Anlage mit Messdienst (Abweichung 5). Die Datenbank
// prüft Kostenart und Vorzeichen (Bedingungen), hier steht, was an einer anderen Zeile hängt.
async function guardOperatingPower(db: Executor, before: CostItem | null, after: CostItem): Promise<void> {
  if (after.operatingPower === 'included' && after.category !== HEATING_CATEGORY) {
    throw new HeatingError(400, `Betriebsstrom gibt es nur bei der Kostenart „${HEATING_CATEGORY}“.`)
  }
  if (after.operatingPower === 'deduction') {
    if (after.category !== GENERAL_POWER_CATEGORY) {
      throw new HeatingError(400, `Ein Abzug des Betriebsstroms gehört zur Kostenart „${GENERAL_POWER_CATEGORY}“.`)
    }
    if (!(after.amountCents < 0)) {
      throw new HeatingError(400, `„${after.description}“ ist ein Abzug und braucht einen negativen Betrag.`)
    }
  }
  if (after.operatingPowerItemId !== undefined) {
    if (after.operatingPower !== 'deduction') {
      throw new HeatingError(400, 'Nur ein Abzug beim Allgemeinstrom zeigt auf eine Betriebsstrom-Position.')
    }
    const [target] = await db
      .select({ propertyId: costItems.propertyId, operatingPower: costItems.operatingPower, description: costItems.description })
      .from(costItems).where(eq(costItems.id, after.operatingPowerItemId))
    if (!target) throw new HeatingError(400, 'Die Betriebsstrom-Position, zu der dieser Abzug gehört, gibt es nicht (mehr).')
    if (target.propertyId !== after.propertyId) {
      throw new CrossPropertyError(`Der Abzug „${after.description}“ gehört zu einem anderen Objekt als der Betriebsstrom „${target.description}“.`)
    }
    if (target.operatingPower !== 'included') {
      throw new HeatingError(400, `„${target.description}“ ist nicht als Betriebsstrom gekennzeichnet, der auch im Allgemeinstrom steckt; ein Abzug kann nicht zu ihr gehören.`)
    }
  }
  if (before?.operatingPower === 'included' && after.operatingPower !== 'included') {
    const abzuege = await db.select({ description: costItems.description }).from(costItems).where(eq(costItems.operatingPowerItemId, after.id))
    if (abzuege.length > 0) {
      throw new HeatingError(400, `Zu „${after.description}“ gehört der Abzug ${abzuege.map((a) => `„${a.description}“`).join(', ')} beim Allgemeinstrom. Löschen Sie zuerst den Abzug, sonst stünde er ohne Betriebsstrom da.`)
    }
  }
}
```

Am Ende von `guardCostItem` (nach `await sameProperty(…)`):

```ts
  await guardOperatingPower(db, _before, after)
```

(Heißt der Parameter nach PR 3 `before` statt `_before`, diesen Namen nehmen.)

In `costItemCollection` die Zeile `remove: …` ersetzen:

```ts
  remove: async (db, id) => {
    // Heizung PR 15: ein Satz statt des Fremdschlüssels (Review Focus 2).
    const abzuege = await db.select({ description: costItems.description }).from(costItems).where(eq(costItems.operatingPowerItemId, id))
    if (abzuege.length > 0) {
      throw new HeatingError(400, `Zu dieser Position gehört ${abzuege.length === 1 ? 'der Abzug' : 'die Abzüge'} ${abzuege.map((a) => `„${a.description}“`).join(', ')} beim Allgemeinstrom. Löschen Sie zuerst den Abzug, damit der Allgemeinstrom nicht still gemindert bleibt.`)
    }
    await db.delete(costItems).where(eq(costItems.id, id))
  },
```

- [ ] **Step 10: Bestehende Wächter nachziehen**

`server/test/db-stock.test.ts`: `NOT_IN_DB_JSON` um `'operatingPower', 'operatingPowerItemId'` ergänzen.

`server/test/db-repository.test.ts`, Test „… jede Spalte …“ (Probe für `costItems`): Die Probe ist eine
Heizposition (PR 3); im Rumpf `operatingPower: 'included'` ergänzen und in der Erwartung derselbe Wert.
`operatingPowerItemId` bleibt dort leer: Ein Verweis braucht eine zweite Position, die Probe prüft ihn in
db-betriebsstrom.test.ts.

- [ ] **Step 11: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/migrations.test.ts test/schema.test.ts test/db-stock.test.ts test/db-repository.test.ts test/categories.test.ts test/db-golden.test.ts test/db-changeover.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts shared/operatingPower.ts server/src/db/schema.ts server/drizzle server/src/db/read.ts server/src/db/repository.ts server/test/db-betriebsstrom.test.ts server/test/migrations.test.ts server/test/db-stock.test.ts server/test/db-repository.test.ts server/test/categories.test.ts
git commit -m "Betriebsstrom: Kennzeichnung an Heizkosten und Abzug beim Allgemeinstrom

Zwei Spalten an cost_items, Bedingungen in einem eigenen Schritt, ein Abzug
zeigt auf seinen Betriebsstrom (RESTRICT, Löschen mit einem Satz gesperrt).

Refs #212"
```

---

### Task 3: Die Schätzhilfe (`shared/operatingPower.ts`)

Reine Rechnung, für Formular und Server dieselbe: kWh nach Leistung, Laufzeit und Heiztagen oder
gemessen, Anteil an der Stromrechnung, Euro auf den Cent, Rechenweg als Text.

**Files:**
- Modify: `shared/operatingPower.ts`
- Test: `server/test/operating-power.test.ts` (neu)

**Interfaces:**
- Consumes: `OperatingPowerDevice` (Task 2).
- Produces:
  - `type OperatingPowerInput = { devices: readonly OperatingPowerDevice[] | null; heatingDays: number | null; measuredKwh: number | null; billKwh: number; billCents: number }`
  - `type OperatingPowerShare = { kwh: number; measured: boolean; permille: number; cents: number; steps: string[] }`
  - `operatingPowerShare(i: OperatingPowerInput): OperatingPowerShare | { error: string }`

- [ ] **Step 1: Write the failing test**

`server/test/operating-power.test.ts`:

```ts
// Die Schätzhilfe für den Betriebsstrom (Heizung PR 15, #212): nach Leistung und Heiztagen (BGH V ZR
// 166/15 Rn. 14) oder gemessen, als Anteil an der Stromrechnung (Abweichung 3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { operatingPowerShare, type OperatingPowerInput } from '../../shared/operatingPower.ts'

const GERAETE = [
  { label: 'Brenner', watts: 120, hoursPerDay: 6 },
  { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 },
  { label: 'Regelung', watts: 5, hoursPerDay: 24 },
]
const geschaetzt = (over: Partial<OperatingPowerInput> = {}): OperatingPowerInput =>
  ({ devices: GERAETE, heatingDays: 220, measuredKwh: null, billKwh: 3000, billCents: 105000, ...over })

test('Schätzung: 120 W · 6 h + 45 W · 24 h + 5 W · 24 h an 220 Tagen = 422,4 kWh, 14,08 % von 1.050,00 € = 147,84 €', () => {
  const r = operatingPowerShare(geschaetzt())
  if ('error' in r) return assert.fail(r.error)
  assert.ok(Math.abs(r.kwh - 422.4) < 1e-9, String(r.kwh))
  assert.equal(r.measured, false)
  assert.ok(Math.abs(r.permille - 140.8) < 1e-9, String(r.permille))
  assert.equal(r.cents, 14784)
  assert.deepEqual(r.steps, [
    'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh',
    'Umwälzpumpe: 45 W × 24 h × 220 Tage = 237,6 kWh',
    'Regelung: 5 W × 24 h × 220 Tage = 26,4 kWh',
    'zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %',
    '14,08 % von 1.050,00 € = 147,84 €',
  ])
})

test('Gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh, Geräte und Heiztage zählen nicht', () => {
  const r = operatingPowerShare(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 500 }))
  if ('error' in r) return assert.fail(r.error)
  assert.equal(r.measured, true)
  assert.equal(r.cents, 17500)
  assert.equal(r.steps[0], 'gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh der Stromrechnung = 16,67 %')
})

test('Rundung kaufmännisch auf den Cent: 1 kWh von 3 kWh aus 1,00 € = 0,33 €; 2 von 3 = 0,67 €', () => {
  const a = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 1, billKwh: 3, billCents: 100 })
  const b = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 2, billKwh: 3, billCents: 100 })
  assert.deepEqual(['error' in a ? a.error : a.cents, 'error' in b ? b.error : b.cents], [33, 67])
})

test('Review Focus 4: mehr kWh als die Stromrechnung ist ein Fehler mit beiden Zahlen', () => {
  const r = operatingPowerShare(geschaetzt({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }))
  assert.ok('error' in r)
  assert.match(r.error, /158\.400 kWh/)
  assert.match(r.error, /3\.000 kWh/)
})

test('Eingaben: ohne Gerät, ohne Heiztage, Laufzeit über 24 h, Heiztage über 366, Leistung 0, Stromrechnung ohne kWh oder Betrag', () => {
  const fehler = (i: OperatingPowerInput): string => { const r = operatingPowerShare(i); return 'error' in r ? r.error : '' }
  assert.match(fehler(geschaetzt({ devices: [] })), /mindestens ein Gerät/)
  assert.match(fehler(geschaetzt({ heatingDays: null })), /Heiztage/)
  assert.match(fehler(geschaetzt({ heatingDays: 400 })), /Heiztage/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 45, hoursPerDay: 25 }] })), /höchstens 24 Stunden/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 0, hoursPerDay: 24 }] })), /Leistung/)
  assert.match(fehler(geschaetzt({ billKwh: 0 })), /kWh der Stromrechnung/)
  assert.match(fehler(geschaetzt({ billCents: 0 })), /Betrag der Stromrechnung/)
  assert.match(fehler(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 0 })), /gemessenen kWh/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/operating-power.test.ts`
Expected: FAIL, `operatingPowerShare is not a function` bzw. Exportfehler.

- [ ] **Step 3: Implementation (`shared/operatingPower.ts`)**

Die Datei aus Task 2 Step 7 vollständig ersetzen:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe.
import type { OperatingPowerDevice } from './types.ts'

// Die Kostenart des Allgemeinstroms (§ 2 Nr. 11 BetrKV, Beleuchtung). Dieselbe Zeichenkette wie in
// shared/categories.ts; categories.test.ts hält beide zusammen.
export const GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'

// Was die Hilfe braucht: entweder Geräte und Heiztage (geschätzt) oder gemessene kWh (Zwischenzähler),
// dazu kWh und Betrag der Stromrechnung des Allgemeinstroms.
export type OperatingPowerInput = {
  devices: readonly OperatingPowerDevice[] | null
  heatingDays: number | null
  measuredKwh: number | null
  billKwh: number
  billCents: number
}

// `permille` ist der Anteil an der Stromrechnung in Promille, ungerundet; `cents` auf den Cent gerundet.
export type OperatingPowerShare = { kwh: number; measured: boolean; permille: number; cents: number; steps: string[] }

const de = (n: number, digits: number): string => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const euro = (cents: number): string => `${de(cents / 100, 2)} €`
const kwhText = (kwh: number): string => `${kwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh`
const positive = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

// Der Anteil des Betriebsstroms am Allgemeinstrom (BGH, Urteil vom 03.06.2016, V ZR 166/15, Leitsatz:
// „welcher Anteil an dem Allgemeinstrom hierauf entfällt“). kWh nach Rn. 14 aus Leistung und Heiztagen,
// oder gemessen; Euro = Betrag der Stromrechnung × kWh ÷ kWh der Rechnung, also mit anteiligem
// Grundpreis (Abweichung 3). Laufzeit und Heiztage gibt der Vermieter ein, Mietfuchs schlägt keine vor.
export function operatingPowerShare(i: OperatingPowerInput): OperatingPowerShare | { error: string } {
  if (!positive(i.billKwh)) return { error: 'Bitte geben Sie die kWh der Stromrechnung des Allgemeinstroms an.' }
  if (!positive(i.billCents)) return { error: 'Der Betrag der Stromrechnung muss größer als 0 sein.' }
  const steps: string[] = []
  let kwh = 0
  const measured = i.measuredKwh !== null
  if (measured) {
    if (!positive(i.measuredKwh)) return { error: 'Bitte geben Sie die gemessenen kWh des Zwischenzählers an.' }
    kwh = i.measuredKwh
  } else {
    const devices = i.devices ?? []
    if (devices.length === 0) return { error: 'Bitte nennen Sie mindestens ein Gerät der Heizung mit Leistung und Laufzeit.' }
    const days = i.heatingDays
    if (days === null || !Number.isInteger(days) || days < 1 || days > 366) return { error: 'Bitte geben Sie die Heiztage an, als ganze Zahl von 1 bis 366.' }
    for (const d of devices) {
      if (!positive(d.watts)) return { error: `Bitte geben Sie die Leistung von „${d.label}“ in Watt an.` }
      if (!positive(d.hoursPerDay) || d.hoursPerDay > 24) return { error: `Die Laufzeit von „${d.label}“ ist höchstens 24 Stunden am Tag.` }
      const own = (d.watts * d.hoursPerDay * days) / 1000
      kwh += own
      steps.push(`${d.label}: ${d.watts.toLocaleString('de-DE')} W × ${d.hoursPerDay.toLocaleString('de-DE')} h × ${days} Tage = ${kwhText(own)}`)
    }
  }
  if (kwh > i.billKwh) {
    return { error: `Die ${measured ? 'gemessenen' : 'geschätzten'} ${kwhText(kwh)} liegen über dem Verbrauch der Stromrechnung (${kwhText(i.billKwh)}). Bitte prüfen Sie Leistung (in Watt) und Laufzeit.` }
  }
  const ratio = kwh / i.billKwh
  const percent = `${de(ratio * 100, 2)} %`
  steps.push(measured
    ? `gemessen mit Zwischenzähler: ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`
    : `zusammen ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`)
  const cents = Math.round(i.billCents * ratio)
  steps.push(`${percent} von ${euro(i.billCents)} = ${euro(cents)}`)
  return { kwh, measured, permille: ratio * 1000, cents, steps }
}
```

`toLocaleString('de-DE')` setzt die Tausenderpunkte selbst („158.400 kWh“, „3.000 kWh“), die der Test
in Review Focus 4 erwartet. Eine Gleitkommazahl wie 422,40000000000003 erscheint im Text als „422,4“,
weil `maximumFractionDigits: 1` rundet; gerechnet wird mit dem ungerundeten Wert.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- test/operating-power.test.ts && npm run typecheck`
Expected: PASS. Zur Rundung im ersten Test: 105.000 × 422,4 ÷ 3.000 = 14.784 genau; im dritten Test 33,33…
→ 33 und 66,66… → 67.

- [ ] **Step 5: Commit**

```bash
git add shared/operatingPower.ts server/test/operating-power.test.ts
git commit -m "Betriebsstrom: Schätzung nach Leistung und Heiztagen oder gemessen, als Anteil an der Stromrechnung

Refs #212"
```

---

### Task 4: Betriebsstrom und Abzug gemeinsam anlegen (Route)

**Files:**
- Create: `server/src/db/operatingPower.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/db-betriebsstrom.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes: `operatingPowerShare`, `GENERAL_POWER_CATEGORY` (Task 3); `readCostItems`, `readHeatingPlants`; `insertCostItemIn`, `HeatingError`, `raw` (repository.ts); `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed` (PR 8); `HEATING_CATEGORY`.
- Produces:
  - `type OperatingPowerBooking = { share: OperatingPowerShare; heatingItem: CostItem | null; deduction: CostItem }`
  - `bookOperatingPower(db: Database, plantId: string, body: unknown, newId: () => string): Promise<OperatingPowerBooking | null>` (`null`: keine Anlage)
  - Route `POST /api/heating-plants/:id/operating-power` → 201 `OperatingPowerBooking`, 404 ohne Anlage, 400/409 mit Satz

- [ ] **Step 1: Write the failing tests**

In `server/test/db-betriebsstrom.test.ts` den Import ergänzen:

```ts
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
```

und anhängen:

```ts
// ---------- Schätzhilfe: Betriebsstrom und Abzug in einer Transaktion (Task 4) ----------

const strom = { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' }
const schaetzung = (over: Record<string, unknown> = {}) => ({
  period: '2025-01', generalItemId: 'strom', billKwh: 3000,
  devices: [{ label: 'Brenner', watts: 120, hoursPerDay: 6 }, { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 }, { label: 'Regelung', watts: 5, hoursPerDay: 24 }],
  heatingDays: 220, ...over,
})
let n = 0
const ids = () => `neu-${++n}`

test('Schätzhilfe bei freien Schlüsseln: Betriebsstrom nach dem Schlüssel des Brennstoffs, Abzug nach dem des Allgemeinstroms', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, key: 'meter', meterType: 'waerme', heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, key: 'units' }))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    if (!b) return assert.fail('keine Anlage')
    assert.equal(b.share.cents, 14784)
    const h = b.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.category, h.amountCents, h.key, h.meterType, h.heatingPart, h.operatingPower, h.heatingPlantId, h.period],
      ['Heizung und Warmwasser', 14784, 'meter', 'waerme', 'operating', 'included', 'hp', '2025-01'])
    assert.match(h.description, /Betriebsstrom Heizung \(geschätzt\)/)
    assert.deepEqual([b.deduction.category, b.deduction.amountCents, b.deduction.key, b.deduction.operatingPower, b.deduction.operatingPowerItemId, b.deduction.period],
      ['Beleuchtung/Allgemeinstrom', -14784, 'units', 'deduction', h.id, '2025-01'])
  })
})

test('Schätzhilfe bei eigener Abrechnung: Schlüssel nach Heizkostenverordnung, Teil Betrieb, Ziel beides', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    // Die eigene Abrechnung richtet PR 10 über die Einrichtung ein; für diesen Test genügt die Methode.
    await opened.write((db) => db.update(heatingPlants).set({ method: 'self' }).where(eq(heatingPlants.id, 'hp')))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: null, heatingDays: null, measuredKwh: 500 }), ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.key, h.heatingPart, h.heatingTarget, h.amountCents], ['heatingSystem', 'operating', 'both', 17500])
    assert.match(h.description, /\(gemessen\)/)
  })
})

test('Schätzhilfe beim Messdienst: nur der Abzug, ohne Verweis', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    assert.equal(b?.heatingItem, null)
    assert.deepEqual([b?.deduction.amountCents, b?.deduction.operatingPowerItemId], [-14784, undefined])
  })
})

test('Schätzhilfe lehnt ab: Allgemeinstrom mit Einzelbeträgen (Review Focus 1), ohne Brennstoffposition, keine Stromposition, zu viele kWh (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Brennstoffposition/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ generalItemId: 'gas' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Beleuchtung\/Allgemeinstrom/.test(e.message))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /über dem Verbrauch der Stromrechnung/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'strom', { key: 'external', externalBasis: { measure: 'mea', total: 10000, totalCents: 1000000 } }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /ziehen Sie den Betriebsstrom/.test(e.message))
    // Nichts angelegt: weder Betriebsstrom noch Abzug.
    const alle = await opened.read((db) => readCostItems(db))
    assert.equal(alle.filter((c) => c.operatingPower !== undefined).length, 0)
  })
})

test('Schätzhilfe: abgeschlossene Heizperiode → 409, unbekannte Heizperiode → 400, unbekannte Anlage → null', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await opened.write((db) => bookOperatingPower(db, 'fehlt', schaetzung(), ids)), null)
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ period: '2025-13' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400)
    await opened.write((db) => closeSettlement(db, { id: 'a1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T00:00:00Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409)
  })
})
```

Dazu die Importe `import { eq } from 'drizzle-orm'`, `import { heatingPlants } from '../src/db/schema.ts'`,
`import { readCostItems } from '../src/db/read.ts'`, `import { periodKey } from '../../shared/period.ts'`
und `closeSettlement` aus `'../src/db/repository.ts'` (Signatur PR 2:
`closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`).

In `server/test/api.test.ts` anhängen:

```ts
// ---------- Betriebsstrom (Heizung PR 15) ----------

test('Betriebsstrom über die Route: 201 mit beiden Positionen, 404 ohne Anlage, 400 mit Satz', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'service' })))
    const strom = await s.api<CostItem>('/api/costItems', postJson({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    const body = { period: '2025-01', generalItemId: strom.id, billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24 }], heatingDays: 220 }
    const angelegt = await send(`/api/heating-plants/${plant.id}/operating-power`, postJson(body))
    assert.equal(angelegt.status, 201)
    const b = await jsonOf<{ share: { cents: number }; deduction: CostItem; heatingItem: CostItem | null }>(angelegt)
    // 45 W × 24 h × 220 Tage = 237,6 kWh; 237,6 / 3.000 × 1.050,00 € = 83,16 €
    assert.deepEqual([b.share.cents, b.deduction.amountCents, b.heatingItem], [8316, -8316, null])
    assert.equal((await send('/api/heating-plants/fehlt/operating-power', postJson(body))).status, 404)
    const falsch = await send(`/api/heating-plants/${plant.id}/operating-power`, postJson({ ...body, billKwh: 0 }))
    assert.equal(falsch.status, 400)
    assert.match((await jsonOf<{ error: string }>(falsch)).error, /kWh der Stromrechnung/)
  } finally {
    await s.stop()
  }
})
```

(`postJson`, `jsonOf`, `startServer`, `HeatingPlant`, `CostItem` sind seit PR 4/6 in api.test.ts
importiert; fehlt einer, aus den vorhandenen Helfern der Datei bzw. `'../../shared/types.ts'` ergänzen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/api.test.ts`
Expected: FAIL, `Cannot find module '…/src/db/operatingPower.ts'`.

- [ ] **Step 3: Implementation (`server/src/db/operatingPower.ts`)**

```ts
// Betriebsstrom und Abzug gemeinsam anlegen (Heizung PR 15, #212): die Schätzhilfe der Seite Heizkosten.
// Beide Positionen entstehen in **einer** Transaktion über denselben Weg wie jede andere Position
// (`insertCostItemIn`), damit kein Abzug ohne Betriebsstrom stehenbleibt und dieselben Prüfungen gelten.
//
// Welche Verteilung die beiden bekommen, steht als Abweichung 5 und 6 im Plan: Der Betriebsstrom geht
// wie der Brennstoff (bei eigener Abrechnung nach der Heizkostenverordnung, Ziel `both`), der Abzug wie
// der Allgemeinstrom. Beim Messdienst gibt es nur den Abzug, denn der Messdienst verteilt den
// Betriebsstrom in seinen Beträgen.
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { GENERAL_POWER_CATEGORY, operatingPowerShare, type OperatingPowerShare } from '../../../shared/operatingPower.ts'
import type { CostItem, OperatingPowerDevice } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readCostItems, readHeatingPlants } from './read.ts'
import { HeatingError, insertCostItemIn, raw } from './repository.ts'

export type OperatingPowerBooking = { share: OperatingPowerShare; heatingItem: CostItem | null; deduction: CostItem }

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function devicesOf(value: unknown): OperatingPowerDevice[] | null {
  if (!Array.isArray(value)) return null
  return value.map((d, i) => ({
    label: typeof raw(d, 'label') === 'string' && String(raw(d, 'label')).trim() ? String(raw(d, 'label')).trim() : `Gerät ${i + 1}`,
    watts: numberOrNull(raw(d, 'watts')) ?? 0,
    hoursPerDay: numberOrNull(raw(d, 'hoursPerDay')) ?? 0,
  }))
}

// Die Verteilung, die der Abzug vom Allgemeinstrom übernimmt (Abweichung 6), und die der Betriebsstrom
// von der Brennstoffposition übernimmt (Abweichung 5). Einzelbeträge und Gemeinschaftsabrechnung lassen
// sich nicht übertragen.
const UNCOPYABLE: readonly string[] = ['amounts', 'external']
const distributionOf = (c: CostItem) => ({
  key: c.key,
  ...(c.meterType ? { meterType: c.meterType } : {}),
  ...(c.directUnitId ? { directUnitId: c.directUnitId } : {}),
  ...(c.customShares ? { customShares: c.customShares } : {}),
  ...(c.participantUnitIds ? { participantUnitIds: c.participantUnitIds } : {}),
})

export async function bookOperatingPower(db: Database, plantId: string, body: unknown, newId: () => string): Promise<OperatingPowerBooking | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const ctx = await plantContext(db, plantId)
  const key = typeof raw(body, 'period') === 'string' ? String(raw(body, 'period')) : ''
  const h = ctx ? heatingPeriodOf(ctx, key) : null
  if (!ctx || !h) throw new HeatingError(400, 'Diese Heizperiode gibt es für die Heizanlage nicht. Bitte wählen Sie eine Heizperiode der Anlage.')
  if (await heatingPeriodClosed(db, ctx, h)) {
    throw new HeatingError(409, 'Die Abrechnung dieser Heizperiode ist abgeschlossen. Öffnen Sie sie wieder, bevor Sie den Betriebsstrom erfassen.')
  }
  const items = await readCostItems(db)
  const generalId = typeof raw(body, 'generalItemId') === 'string' ? String(raw(body, 'generalItemId')) : ''
  const general = items.find((c) => c.id === generalId && c.propertyId === plant.propertyId)
  if (!general || general.category !== GENERAL_POWER_CATEGORY || !(general.amountCents > 0) || general.operatingPower !== undefined) {
    throw new HeatingError(400, `Bitte wählen Sie die Stromrechnung des Hauses: eine Position der Kostenart „${GENERAL_POWER_CATEGORY}“ mit positivem Betrag.`)
  }
  if (UNCOPYABLE.includes(general.key)) {
    throw new HeatingError(400, 'Der Allgemeinstrom ist nach Einzelbeträgen oder laut Gemeinschaftsabrechnung verteilt; einen Abzug in derselben Verteilung gibt es nicht. Bei Einzelbeträgen ziehen Sie den Betriebsstrom bitte in den Beträgen selbst ab, bei einer Gemeinschaftsabrechnung tut das die Gemeinschaft.')
  }
  const measuredKwh = numberOrNull(raw(body, 'measuredKwh'))
  const share = operatingPowerShare({
    devices: measuredKwh === null ? devicesOf(raw(body, 'devices')) : null,
    heatingDays: measuredKwh === null ? numberOrNull(raw(body, 'heatingDays')) : null,
    measuredKwh,
    billKwh: numberOrNull(raw(body, 'billKwh')) ?? 0,
    billCents: general.amountCents,
  })
  if ('error' in share) throw new HeatingError(400, share.error)
  const how = share.measured ? 'gemessen' : 'geschätzt'

  let heatingBody: Record<string, unknown> | null = null
  if (plant.method !== 'service') {
    const base = {
      propertyId: plant.propertyId, period: h.key, category: HEATING_CATEGORY, description: `Betriebsstrom Heizung (${how})`,
      amountCents: share.cents, heatingPlantId: plant.id, heatingPart: 'operating', operatingPower: 'included',
    }
    if (plant.method === 'self') {
      heatingBody = { ...base, key: 'heatingSystem', heatingTarget: 'both' }
    } else {
      const fuel = items
        .filter((c) => c.heatingPlantId === plant.id && c.period === h.key && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null))
        .sort((a, b) => b.amountCents - a.amountCents)[0]
      if (!fuel) {
        throw new HeatingError(400, `Erfassen Sie zuerst die Brennstoffposition der Heizperiode; der Betriebsstrom wird nach ihrem Schlüssel verteilt (§ 7 Abs. 2 HeizkostenV).`)
      }
      if (UNCOPYABLE.includes(fuel.key)) {
        throw new HeatingError(400, `„${fuel.description}“ ist nach Einzelbeträgen oder laut Gemeinschaftsabrechnung verteilt; in diesem Fall ziehen Sie den Betriebsstrom bitte in den Beträgen selbst ab.`)
      }
      heatingBody = { ...base, ...distributionOf(fuel), ...(fuel.heatingTarget ? { heatingTarget: fuel.heatingTarget } : {}) }
    }
  }
  const heatingId = heatingBody ? newId() : null
  const deductionId = newId()
  const deductionBody = {
    propertyId: plant.propertyId, period: general.period, category: GENERAL_POWER_CATEGORY,
    description: `Abzug Betriebsstrom Heizung (${how})`, amountCents: -share.cents, ...distributionOf(general),
    operatingPower: 'deduction', ...(heatingId ? { operatingPowerItemId: heatingId } : {}),
  }
  await db.transaction(async (tx) => {
    if (heatingBody && heatingId) await insertCostItemIn(tx, heatingId, heatingBody)
    await insertCostItemIn(tx, deductionId, deductionBody)
  })
  const after = await readCostItems(db)
  const deduction = after.find((c) => c.id === deductionId)
  if (!deduction) throw new Error('Der Abzug ist nach dem Anlegen nicht auffindbar.')
  return { share, heatingItem: heatingId ? (after.find((c) => c.id === heatingId) ?? null) : null, deduction }
}
```

(`raw` ist seit PR 10 aus repository.ts exportiert; `heatingTarget` und `fuelDeliveryId` stehen seit
PR 10 bzw. PR 7 an `CostItem`.)

- [ ] **Step 4: Route (`server/src/index.ts`)**

Import `import { bookOperatingPower } from './db/operatingPower.ts'`. Bei den Routen der Heizanlage
(`/api/heating-plants`, PR 4 Task 6) anhängen:

```ts
// Betriebsstrom und Abzug beim Allgemeinstrom gemeinsam anlegen (Heizung PR 15, #212).
app.post('/api/heating-plants/:id/operating-power', async (req, res) => {
  const booked = await writeData((db) => bookOperatingPower(db, req.params.id, bodyObject(req), newId))
  if (!booked) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr).' })
  res.status(201).json(booked)
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS. Im Test zum Messdienst steht `operatingPowerItemId` als `undefined`, weil read.ts ein
fehlendes Feld weglässt.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/operatingPower.ts server/src/index.ts server/test/db-betriebsstrom.test.ts server/test/api.test.ts
git commit -m "Betriebsstrom: Schätzhilfe legt Betriebsstrom und Abzug in einer Transaktion an

Bei freien Schlüsseln nach dem Schlüssel des Brennstoffs, bei eigener
Abrechnung nach der Heizkostenverordnung, beim Messdienst nur der Abzug.

Refs #212"
```

---

### Task 5: Berechnung: `heating.operating-power-double`

**Files:**
- Create: `server/src/operatingPower.ts`
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`, `shared/glossary.ts` (nur, falls `TermId` den Begriff erst hier braucht; er steht seit Task 1)
- Test: `server/test/calc-betriebsstrom.test.ts` (neu)

**Interfaces:**
- Consumes: `OperatingPowerDeduction` (Task 2); `computeSettlement`, `warn`, `items`, `fmtCents`, `noticeKinds`; `snapshotFor`, `heatingSnapshotFor`, `SnapshotCostItem`, `snapshotOfPeriod`.
- Produces:
  - `server/src/operatingPower.ts`: `type OperatingPowerFinding = { itemId: string; description: string; amountCents: number; deductedCents: number; differenceCents: number }`, `operatingPowerFindings(distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[], deductions: readonly OperatingPowerDeduction[]): OperatingPowerFinding[]`, `operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string`
  - snapshot.ts: `SnapshotCostItem` pickt zusätzlich `'operatingPower' | 'operatingPowerItemId'`; `Snapshot.operatingPowerDeductions?: OperatingPowerDeduction[]`; `deductionsOf(items: readonly CostItem[], propertyId: string): OperatingPowerDeduction[]`
  - calc.ts: Code `heating.operating-power-double` (warning)

- [ ] **Step 1: Write the failing tests**

`server/test/calc-betriebsstrom.test.ts`:

```ts
// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1): Steckt der Betriebsstrom einer
// Heizposition auch in der Stromrechnung des Hauses, muss dort ein Abzug in gleicher Höhe stehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { operatingPowerFindings } from '../src/operatingPower.ts'
import { deductionsOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { CostItem, OperatingPowerDeduction } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2')],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const betriebsstrom: SnapshotCostItem = { id: 'bs', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung', amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included' }
const hausstrom: SnapshotCostItem = { id: 'strom', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }
const abzug = (cents: number, id = 'ab', period = '2025-01'): OperatingPowerDeduction => ({ id, itemId: 'bs', period: periodKey(period), description: 'Abzug Betriebsstrom Heizung', amountCents: -cents })
const settle = (items: SnapshotCostItem[], deductions: OperatingPowerDeduction[]) =>
  computeSettlement({ ...snapshotOfPeriod(haus(items), P, previousPeriod(CALENDAR_RULES, P)), operatingPowerDeductions: deductions })
const codes = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-double')

test('Ohne Abzug: warning mit Betrag, der doppelt verteilt wird', () => {
  const s = settle([betriebsstrom, hausstrom], [])
  const [n, ...rest] = codes(s)
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'bs' })
  assert.match(n.text, /„Betriebsstrom Heizung“/)
  assert.match(n.text, /abgezogen sind dort 0,00 € statt 147,84 €/)
  assert.match(n.text, /147,84 € werden damit doppelt verteilt/)
  assert.match(n.text, /V ZR 166\/15/)
})

test('Abzug in gleicher Höhe: kein Hinweis; jeder zahlt den Strom einmal', () => {
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug Betriebsstrom Heizung', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  const s = settle([betriebsstrom, hausstrom, ab], [abzug(14784)])
  assert.equal(codes(s).length, 0)
  // Summe der verteilten Kosten = Stromrechnung: 1.050,00 €
  assert.equal(s.totalCostsCents, 105000)
})

test('Abzug zu klein und zu groß: Text mit der Differenz, je in seiner Richtung', () => {
  const klein = codes(settle([betriebsstrom, hausstrom], [abzug(10000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(klein.text, /abgezogen sind dort 100,00 € statt 147,84 €; 47,84 € werden damit doppelt verteilt/)
  const gross = codes(settle([betriebsstrom, hausstrom], [abzug(20000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(gross.text, /abgezogen sind dort 200,00 €, 52,16 € mehr als der Betriebsstrom/)
})

test('Review Focus 5: Abzug in einem anderen Zeitraum zählt, denn er gehört zur Position', () => {
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2026-01')])).length, 0)
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(7392, 'a1', '2025-01'), abzug(7392, 'a2', '2026-01')])).length, 0)
})

test('Wer nichts einstellt, merkt nichts: ohne Kennzeichnung kein Hinweis und dieselbe Abrechnung', () => {
  const ohne = settle([{ ...betriebsstrom, operatingPower: undefined }, hausstrom], [])
  assert.equal(codes(ohne).length, 0)
  const ohneFeld = computeSettlement(snapshotOfPeriod(haus([{ ...betriebsstrom, operatingPower: undefined }, hausstrom]), P, previousPeriod(CALENDAR_RULES, P)))
  assert.deepEqual(ohne, ohneFeld)
})

test('Befund rein: nur Positionen mit „included“, Abzüge nur über ihren Verweis', () => {
  const items: Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[] = [
    { id: 'bs', description: 'B', amountCents: 100, operatingPower: 'included' },
    { id: 'x', description: 'X', amountCents: 100 },
  ]
  const fremd: OperatingPowerDeduction = { id: 'y', itemId: null, period: periodKey('2025-01'), description: 'Messdienst', amountCents: -50 }
  assert.deepEqual(operatingPowerFindings(items, [fremd]), [{ itemId: 'bs', description: 'B', amountCents: 100, deductedCents: 0, differenceCents: 100 }])
})

test('Schnappschuss: deductionsOf nimmt Abzüge des Objekts aus allen Zeiträumen', () => {
  const c = (id: string, propertyId: string, period: string, op?: 'deduction'): CostItem => ({
    id, propertyId, period: periodKey(period), category: 'Beleuchtung/Allgemeinstrom', description: id, amountCents: op ? -10 : 10, key: 'area',
    ...(op ? { operatingPower: op, operatingPowerItemId: 'bs' } : {}),
  })
  const list = deductionsOf([c('a', 'o1', '2024-01', 'deduction'), c('b', 'o1', '2026-01', 'deduction'), c('c', 'o2', '2025-01', 'deduction'), c('d', 'o1', '2025-01')], 'o1')
  assert.deepEqual(list.map((d) => [d.id, d.period, d.itemId]), [['a', '2024-01', 'bs'], ['b', '2026-01', 'bs']])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-betriebsstrom.test.ts`
Expected: FAIL, `Cannot find module '…/src/operatingPower.ts'`.

- [ ] **Step 3: Befund (`server/src/operatingPower.ts`, neu)**

```ts
// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1). Eine Position mit
// `operatingPower: 'included'` sagt: Dieser Strom steckt auch in der Stromrechnung des Hauses. Dann muss
// beim Allgemeinstrom ein Abzug in gleicher Höhe stehen, sonst zahlen die Mieter ihn doppelt
// (§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Die Abzüge zählen über ihren
// Verweis und aus jedem Zeitraum (Review Focus 5); geprüft werden nur die Positionen, die die
// Abrechnung verteilt, damit der Hinweis genau einmal erscheint, nämlich dort, wo der Betriebsstrom steht.
import type { CostItem, OperatingPowerDeduction } from '../../shared/types.ts'

export type OperatingPowerFinding = { itemId: string; description: string; amountCents: number; deductedCents: number; differenceCents: number }

export function operatingPowerFindings(
  distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[],
  deductions: readonly OperatingPowerDeduction[],
): OperatingPowerFinding[] {
  const out: OperatingPowerFinding[] = []
  for (const item of distributed) {
    if (item.operatingPower !== 'included') continue
    const deductedCents = -deductions.filter((d) => d.itemId === item.id).reduce((a, d) => a + d.amountCents, 0)
    const differenceCents = item.amountCents - deductedCents
    if (differenceCents !== 0) out.push({ itemId: item.id, description: item.description, amountCents: item.amountCents, deductedCents, differenceCents })
  }
  return out
}

// Zwei Texte, ein Code (Abweichung 2): zu wenig abgezogen heißt doppelt verteilt, zu viel heißt, der
// Vermieter trägt einen Teil des Allgemeinstroms selbst.
export function operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string {
  const head = `„${f.description}“: Dieser Betriebsstrom steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms`
  const law = '(§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15)'
  if (f.differenceCents > 0) {
    return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)} statt ${fmtCents(f.amountCents)}; ${fmtCents(f.differenceCents)} werden damit doppelt verteilt. ` +
      `Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten ${law}.`
  }
  return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)}, ${fmtCents(-f.differenceCents)} mehr als der Betriebsstrom. ` +
    `Diesen Teil des Allgemeinstroms tragen Sie damit selbst; passen Sie den Abzug an den Betriebsstrom an ${law}.`
}
```

Hinweis zum ersten Text: Der Test erwartet „abgezogen sind dort 0,00 € statt 147,84 €“ und „147,84 €
werden damit doppelt verteilt“; beides steht so darin (`fmtCents(0)` ergibt „0,00 €“).

- [ ] **Step 4: Schnappschuss (`server/src/snapshot.ts`)**

Importe: `CostItem`, `OperatingPowerDeduction` als Typen aus `'../../shared/types.ts'`. In
`SnapshotCostItem` die gepickten Felder um `| 'operatingPower' | 'operatingPowerItemId'` ergänzen. In
`Snapshot` als letztes Feld:

```ts
  // Abzüge des Betriebsstroms beim Allgemeinstrom aus allen Zeiträumen des Objekts (Heizung PR 15). Sie
  // gehören zu der Position, auf die sie zeigen, nicht zum Zeitraum (Review Focus 5). Fehlt das Feld
  // (ein von Hand gebauter Schnappschuss, der Umstieg), gibt es keine.
  operatingPowerDeductions?: OperatingPowerDeduction[]
```

Vor `snapshotFor`:

```ts
// Die Abzüge des Betriebsstroms eines Objekts (Heizung PR 15), in der Reihenfolge der Positionen.
export function deductionsOf(items: readonly CostItem[], propertyId: string): OperatingPowerDeduction[] {
  return items
    .filter((c) => c.propertyId === propertyId && c.operatingPower === 'deduction')
    .map((c) => ({ id: c.id, itemId: c.operatingPowerItemId ?? null, period: c.period, description: c.description, amountCents: c.amountCents }))
}
```

In `snapshotFor` und in `heatingSnapshotFor` (PR 5) im zurückgegebenen Objekt ergänzen:

```ts
    operatingPowerDeductions: deductionsOf(source.costItems, propertyId),
```

(`source.costItems` ist dort der ganze Bestand des Objekts vor dem Eingrenzen auf den Zeitraum; der
Typ der Quelle führt `propertyId` an den Positionen seit #92. `snapshotOf` für Umstieg und Regression
bekommt das Feld nicht: Die db.json kennt keinen Abzug.)

- [ ] **Step 5: Hinweis (`server/src/calc.ts`)**

Import `import { operatingPowerFindings, operatingPowerText } from './operatingPower.ts'`. In `noticeKinds`
hinter den Codes der Heizung:

```ts
  // Heizung PR 15 (#212): Betriebsstrom, der auch im Allgemeinstrom steckt, ohne Abzug in gleicher Höhe.
  'heating.operating-power-double': { level: 'warning', title: 'Betriebsstrom und Abzug beim Allgemeinstrom passen nicht zusammen', terms: ['operatingPower', 'heatingCostOrdinance'] },
```

In `computeSettlement` direkt vor `// Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.`:

```ts
  // Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212): geprüft werden die Positionen, die diese
  // Abrechnung verteilt (`items`); bei Weg b tut das der Unteraufruf der Heizperiode, und sein Hinweis
  // wird übernommen (PR 5). Die Abzüge kommen aus allen Zeiträumen.
  for (const f of operatingPowerFindings(items, snapshot.operatingPowerDeductions ?? [])) {
    warn('heating.operating-power-double', operatingPowerText(f, fmtCents), itemSubject({ id: f.itemId }))
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-betriebsstrom.test.ts test/calc-notices.test.ts test/glossary.test.ts test/settlement-golden.test.ts test/calc-wortlaut.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS. `calc-notices.test.ts` prüft, dass jeder Code einen Begriff hat und jede Stufe gültig ist;
`operatingPower` steht seit Task 1 im Lexikon.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/operatingPower.ts server/src/snapshot.ts server/src/calc.ts server/test/calc-betriebsstrom.test.ts
git commit -m "Abrechnung: Betriebsstrom ohne Abzug in gleicher Höhe beim Allgemeinstrom meldet den Betrag

heating.operating-power-double (warning) nennt, was doppelt verteilt wird
oder was der Vermieter zu viel selbst trägt; Abzüge zählen aus jedem Zeitraum.

Refs #212"
```

---

### Task 6: Oberfläche: Frage am Kostenformular und Karte „Betriebsstrom“

**Files:**
- Modify: `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`, `client/src/pages/Heizkosten.tsx`
- Create: `client/src/operatingPowerForm.ts`, `client/src/components/OperatingPowerCard.tsx`
- Test: `client/src/costForm.test.ts`, `client/src/operatingPowerForm.test.ts` (neu), `client/src/components/OperatingPowerCard.test.tsx` (neu)

**Interfaces:**
- Consumes: `operatingPowerShare`, `GENERAL_POWER_CATEGORY` (Task 3); Route aus Task 4; `ItemForm`, `itemToForm`, `buildCostItemBody` (costForm.ts); `HEATING_CATEGORY`; `api`, `errorText`, `fmtEuro`, `parseEuro`; `useToast`, `Term`; `HeatingPeriodView`, `HeatingPlant`.
- Produces:
  - costForm.ts: `ItemForm.operatingPower: '' | 'included'`; `OPERATING_POWER_OPTIONS`; `showsOperatingPower(form): boolean`; `withOperatingPower(body, form): Record<string, unknown>`
  - operatingPowerForm.ts: `type DeviceRow = { label: string; watts: string; hours: string }`, `type OperatingPowerForm = { generalItemId: string; mode: 'estimate' | 'measured'; devices: DeviceRow[]; heatingDays: string; measuredKwh: string; billKwh: string }`, `emptyOperatingPowerForm()`, `generalItemOptions(items)`, `operatingPowerPreview(form, items)`, `operatingPowerRequest(form, period)`
  - Komponente `OperatingPowerCard({ plant, view, items, onBooked })`

- [ ] **Step 1: Write the failing tests**

`client/src/operatingPowerForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest, type OperatingPowerForm } from './operatingPowerForm'
import type { CostItem } from './types'

const strom = { id: 'strom', propertyId: 'o', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' } as CostItem
const ausgefuellt = (over: Partial<OperatingPowerForm> = {}): OperatingPowerForm => ({
  ...emptyOperatingPowerForm(), generalItemId: 'strom', billKwh: '3.000', heatingDays: '220',
  devices: [{ label: 'Brenner', watts: '120', hours: '6' }, { label: 'Umwälzpumpe', watts: '45', hours: '24' }, { label: 'Regelung', watts: '5', hours: '24' }],
  ...over,
})

test('Auswahl: nur Allgemeinstrom mit positivem Betrag und ohne Kennzeichnung, mit leerem ersten Eintrag', () => {
  const abzug = { ...strom, id: 'ab', amountCents: -100, operatingPower: 'deduction' } as CostItem
  const grund = { ...strom, id: 'g', category: 'Grundsteuer' } as CostItem
  expect(generalItemOptions([strom, abzug, grund])).toEqual([
    { value: '', label: 'Bitte wählen …' },
    { value: 'strom', label: 'Hausstrom 2025 · 1.050,00 €' },
  ])
})

test('Vorschau: 147,84 € mit Rechenweg; ohne Stromrechnung ein Satz', () => {
  const v = operatingPowerPreview(ausgefuellt(), [strom])
  expect(v).toEqual({ ok: true, cents: 14784, lines: expect.arrayContaining(['zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %', '14,08 % von 1.050,00 € = 147,84 €']) })
  expect(operatingPowerPreview(ausgefuellt({ generalItemId: '' }), [strom])).toEqual({ ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' })
})

test('Gemessen: die Geräte zählen nicht', () => {
  const v = operatingPowerPreview(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), [strom])
  expect(v).toMatchObject({ ok: true, cents: 17500 })
})

test('Rumpf: Zahlen mit Komma, gemessen ohne Geräte', () => {
  expect(operatingPowerRequest(ausgefuellt({ devices: [{ label: 'Pumpe', watts: '45,5', hours: '24' }] }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45.5, hoursPerDay: 24 }], heatingDays: 220,
  })
  expect(operatingPowerRequest(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, measuredKwh: 500,
  })
})
```

In `client/src/costForm.test.ts` anhängen:

```ts
test('Betriebsstrom: Frage nur bei Heizkosten mit Teil Betrieb oder ohne Teil; der Rumpf trägt das Feld nur dort (Review Focus 3)', () => {
  const heiz = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', operatingPower: 'included' as const }
  expect(showsOperatingPower(heiz)).toBe(true)
  expect(showsOperatingPower({ ...heiz, heatingPart: 'fuel' })).toBe(false)
  expect(withOperatingPower({ a: 1 }, heiz)).toEqual({ a: 1, operatingPower: 'included' })
  expect(withOperatingPower({ a: 1 }, { ...heiz, operatingPower: '' })).toEqual({ a: 1, operatingPower: null })
  // Am Allgemeinstrom kein Feld: Ein gespeicherter Abzug behält seine Kennzeichnung.
  expect(withOperatingPower({ a: 1 }, { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom' })).toEqual({ a: 1 })
  expect(OPERATING_POWER_OPTIONS.map((o) => o.value)).toEqual(['', 'included'])
})
```

(`EMPTY_ITEM_FORM`, `OPERATING_POWER_OPTIONS`, `showsOperatingPower`, `withOperatingPower` aus `./costForm`
importieren. `heatingPart` steht seit PR 3 bzw. PR 10 in `ItemForm`; heißt das Feld dort anders, diesen
Namen nehmen.)

`client/src/components/OperatingPowerCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerCard from './OperatingPowerCard'
import type { CostItem, HeatingPeriodView, HeatingPlant } from '../types'

const strom = { id: 'strom', propertyId: 'o', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' } as CostItem
const view = { plantId: 'hp', period: '2025-01', label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false, hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null, items: [] } as unknown as HeatingPeriodView
const plant = { id: 'hp', method: 'manual', energy: 'gas' } as HeatingPlant

test('Die Auswahl der Stromrechnung zeigt den gewählten Wert (CLAUDE.md, angezeigter = gespeicherter Wert)', () => {
  render(<OperatingPowerCard plant={plant} view={view} items={[strom]} onBooked={vi.fn()} />)
  const select = screen.getByLabelText(/Stromrechnung des Hauses/) as HTMLSelectElement
  expect(select.value).toBe('')
  fireEvent.change(select, { target: { value: 'strom' } })
  expect(select.value).toBe('strom')
  expect(screen.getByText(/Betriebsstrom/)).toBeTruthy()
})
```

(Die Datei nutzt `HeatingPeriodView` und `HeatingPlant` nur als Requisiten; die Umwandlung über
`unknown` steht ausschließlich im Test, wo ein vollständiges Objekt nur Lärm wäre. Bauen PR 6/7 dafür
einen Helfer im Client-Testordner, den nehmen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- operatingPowerForm costForm OperatingPowerCard`
Expected: FAIL, fehlende Module bzw. Exporte.

- [ ] **Step 3: Kostenformular (`client/src/costForm.ts`)**

`ItemForm` bekommt als letztes Feld `operatingPower: '' | 'included'`; `EMPTY_ITEM_FORM` `operatingPower:
''`; `itemToForm` `operatingPower: i.operatingPower === 'included' ? 'included' : ''`. Anhängen:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Frage, ob dieser Strom auch im Allgemeinstrom
// steckt. Nur bei Heizkosten mit Teil „Betrieb“ oder ohne Teil, wie die Bedingung der Datenbank.
export const OPERATING_POWER_OPTIONS: { value: '' | 'included'; label: string }[] = [
  { value: '', label: 'Nein (eigener Stromvertrag, oder kein Betriebsstrom)' },
  { value: 'included', label: 'Ja, er läuft über den Stromzähler des Hauses' },
]
export const showsOperatingPower = (form: Pick<ItemForm, 'category' | 'heatingPart'>): boolean =>
  form.category === HEATING_CATEGORY && (form.heatingPart === '' || form.heatingPart === 'operating')
// Der Rumpf trägt das Feld nur bei Heizkosten (Review Focus 3): Ein Abzug am Allgemeinstrom behält so
// seine Kennzeichnung, auch wenn das Formular ihn bearbeitet.
export function withOperatingPower(body: Record<string, unknown>, form: Pick<ItemForm, 'category' | 'heatingPart' | 'operatingPower'>): Record<string, unknown> {
  if (form.category !== HEATING_CATEGORY) return body
  return { ...body, operatingPower: showsOperatingPower(form) && form.operatingPower === 'included' ? 'included' : null }
}
```

(`HEATING_CATEGORY` aus `'../../shared/heating.ts'` importieren, falls noch nicht da.) In
`buildCostItemBody` das Ergebnis durchreichen:

```ts
  const result = costItemBody(draftOf(form, units, tenancies, year), units, period)
  return 'body' in result ? { body: withOperatingPower(result.body, form) } : result
```

(Den Aufruf so umschreiben, wie er nach PR 3 lautet; nur die zweite Zeile ist neu.)

- [ ] **Step 4: Kostenformular (`client/src/pages/Kosten.tsx`)**

Im Formular direkt hinter der Auswahl „Teil“ (PR 10, `heatingPart`):

```tsx
            {showsOperatingPower(form) && (
              <label>
                Betriebsstrom, der auch im Allgemeinstrom steckt? <Term id="operatingPower" />
                <select value={form.operatingPower} onChange={(e) => setForm({ ...form, operatingPower: e.target.value === 'included' ? 'included' : '' })}>
                  {OPERATING_POWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
```

(`setForm` heißt so, wie das Formular den Zustand setzt; `Term`, `OPERATING_POWER_OPTIONS`,
`showsOperatingPower` importieren.)

- [ ] **Step 5: Formular der Karte (`client/src/operatingPowerForm.ts`)**

```ts
// Die Karte „Betriebsstrom“ der Seite Heizkosten (Heizung PR 15, #212), DOM-frei. Die Rechnung kommt aus
// shared/operatingPower.ts, dieselbe wie auf dem Server.
import { GENERAL_POWER_CATEGORY, operatingPowerShare } from '../../shared/operatingPower.ts'
import { fmtEuro } from './api'
import type { CostItem } from './types'

export type DeviceRow = { label: string; watts: string; hours: string }
export type OperatingPowerForm = {
  generalItemId: string
  mode: 'estimate' | 'measured'
  devices: DeviceRow[]
  heatingDays: string
  measuredKwh: string
  billKwh: string
}

export const emptyOperatingPowerForm = (): OperatingPowerForm => ({
  generalItemId: '', mode: 'estimate', devices: [{ label: 'Umwälzpumpe', watts: '', hours: '' }], heatingDays: '', measuredKwh: '', billKwh: '',
})

// „3.000“ und „45,5“ wie im übrigen Formular; leer oder unlesbar ist null.
function num(text: string): number | null {
  const t = text.trim().replace(/\./g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function generalItemOptions(items: readonly CostItem[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'Bitte wählen …' },
    ...items
      .filter((c) => c.category === GENERAL_POWER_CATEGORY && c.amountCents > 0 && c.operatingPower === undefined)
      .map((c) => ({ value: c.id, label: `${c.description} · ${fmtEuro(c.amountCents)}` })),
  ]
}

export function operatingPowerPreview(form: OperatingPowerForm, items: readonly CostItem[]): { ok: true; cents: number; lines: string[] } | { ok: false; text: string } {
  const general = items.find((c) => c.id === form.generalItemId)
  if (!general) return { ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' }
  const measured = form.mode === 'measured'
  const r = operatingPowerShare({
    devices: measured ? null : form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts) ?? 0, hoursPerDay: num(d.hours) ?? 0 })),
    heatingDays: measured ? null : num(form.heatingDays),
    measuredKwh: measured ? (num(form.measuredKwh) ?? 0) : null,
    billKwh: num(form.billKwh) ?? 0,
    billCents: general.amountCents,
  })
  return 'error' in r ? { ok: false, text: r.error } : { ok: true, cents: r.cents, lines: r.steps }
}

export function operatingPowerRequest(form: OperatingPowerForm, period: string): Record<string, unknown> {
  const base = { period, generalItemId: form.generalItemId, billKwh: num(form.billKwh) }
  if (form.mode === 'measured') return { ...base, measuredKwh: num(form.measuredKwh) }
  return {
    ...base,
    devices: form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts), hoursPerDay: num(d.hours) })),
    heatingDays: num(form.heatingDays),
  }
}
```

- [ ] **Step 6: Karte (`client/src/components/OperatingPowerCard.tsx`)**

```tsx
// Karte „Betriebsstrom“ auf der Seite Heizkosten (Heizung PR 15, #212): Schätzung nach Leistung und
// Heiztagen oder gemessen, Vorschau, und Betriebsstrom samt Abzug mit einem Klick.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest } from '../operatingPowerForm'
import { useToast } from './feedback'
import Term from './Term'
import type { CostItem, HeatingPeriodView, HeatingPlant } from '../types'

export default function OperatingPowerCard({ plant, view, items, onBooked }: {
  plant: Pick<HeatingPlant, 'id' | 'method'>; view: Pick<HeatingPeriodView, 'period' | 'label' | 'closed'>; items: readonly CostItem[]; onBooked: () => void
}) {
  const [form, setForm] = useState(emptyOperatingPowerForm)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const preview = operatingPowerPreview(form, items)
  const setDevice = (i: number, key: 'label' | 'watts' | 'hours', value: string) =>
    setForm({ ...form, devices: form.devices.map((d, k) => (k === i ? { ...d, [key]: value } : d)) })

  async function book() {
    setBusy(true)
    try {
      await api(`/api/heating-plants/${plant.id}/operating-power`, { method: 'POST', body: JSON.stringify(operatingPowerRequest(form, String(view.period))) })
      toast(plant.method === 'service'
        ? 'Der Abzug beim Allgemeinstrom ist angelegt. Melden Sie denselben Betrag Ihrem Messdienst als Betriebsstrom.'
        : 'Betriebsstrom und Abzug beim Allgemeinstrom sind angelegt.')
      setForm(emptyOperatingPowerForm())
      onBooked()
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Betriebsstrom <Term id="operatingPower" /></h3>
      <p>Läuft der Strom für Brenner, Umwälzpumpe und Regelung über den Stromzähler des Hauses, gehört er zu den Heizkosten und muss beim Allgemeinstrom abgezogen werden. Mietfuchs rechnet den Anteil an der Stromrechnung und legt beide Positionen an.</p>
      <label>
        Stromrechnung des Hauses
        <select value={form.generalItemId} disabled={view.closed} onChange={(e) => setForm({ ...form, generalItemId: e.target.value })}>
          {generalItemOptions(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label>kWh laut Stromrechnung <input inputMode="decimal" value={form.billKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, billKwh: e.target.value })} /></label>
      <fieldset>
        <legend>Wie bestimmen Sie den Betriebsstrom?</legend>
        <label><input type="radio" checked={form.mode === 'estimate'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'estimate' })} /> geschätzt nach Leistung und Heiztagen</label>
        <label><input type="radio" checked={form.mode === 'measured'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'measured' })} /> gemessen mit Zwischenzähler</label>
      </fieldset>
      {form.mode === 'estimate' ? (
        <>
          {form.devices.map((d, i) => (
            <div key={i} className="row">
              <label>Gerät <input value={d.label} disabled={view.closed} onChange={(e) => setDevice(i, 'label', e.target.value)} /></label>
              <label>Leistung (W) <input inputMode="decimal" value={d.watts} disabled={view.closed} onChange={(e) => setDevice(i, 'watts', e.target.value)} /></label>
              <label>Stunden je Tag <input inputMode="decimal" value={d.hours} disabled={view.closed} onChange={(e) => setDevice(i, 'hours', e.target.value)} /></label>
            </div>
          ))}
          <button type="button" disabled={view.closed} onClick={() => setForm({ ...form, devices: [...form.devices, { label: '', watts: '', hours: '' }] })}>+ Gerät</button>
          <label>Heiztage <input inputMode="numeric" value={form.heatingDays} disabled={view.closed} onChange={(e) => setForm({ ...form, heatingDays: e.target.value })} /></label>
          <p className="hint">Leistung steht auf dem Typenschild. Bereitet die Heizung auch das Warmwasser, läuft sie auch im Sommer; zählen Sie diese Tage mit.</p>
        </>
      ) : (
        <label>gemessene kWh <input inputMode="decimal" value={form.measuredKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, measuredKwh: e.target.value })} /></label>
      )}
      {preview.ok ? (
        <ul className="calc-steps">{preview.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        <p className="hint">{preview.text}</p>
      )}
      <button type="button" disabled={view.closed || busy || !preview.ok} onClick={book}>
        {preview.ok ? `${fmtEuro(preview.cents)} als Betriebsstrom und Abzug anlegen` : 'Betriebsstrom und Abzug anlegen'}
      </button>
    </section>
  )
}
```

(`useToast` liegt in `client/src/components/feedback.tsx`; ruft es dort anders, etwa `toast.show(...)`,
die beiden Aufrufe angleichen.)

- [ ] **Step 7: Seite Heizkosten (`client/src/pages/Heizkosten.tsx`)**

Je Anlage und Heizperiode hinter der Karte „Brennstoff“ (`FuelCard`, PR 7):

```tsx
          <OperatingPowerCard plant={plant} view={view} items={propertyItems} onBooked={reload} />
```

`propertyItems` sind alle Positionen des Objekts (`/api/costItems` mit `withProperty`, alle Zeiträume),
geladen beim Öffnen der Seite; `reload` lädt Seite und Positionen neu (der Name der Ladefunktion der
Seite nach PR 6/7). Fehlt eine Ladefunktion für alle Positionen, in `useEffect` ergänzen:

```tsx
  const [propertyItems, setPropertyItems] = useState<CostItem[]>([])
  useEffect(() => { api<CostItem[]>(withProperty('/api/costItems')).then(setPropertyItems).catch(() => setPropertyItems([])) }, [version])
```

(`version` ist der Zähler, mit dem die Seite neu lädt; `reload` erhöht ihn.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix client test -- operatingPowerForm costForm OperatingPowerCard Kosten && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/costForm.ts client/src/costForm.test.ts client/src/pages/Kosten.tsx client/src/operatingPowerForm.ts client/src/operatingPowerForm.test.ts client/src/components/OperatingPowerCard.tsx client/src/components/OperatingPowerCard.test.tsx client/src/pages/Heizkosten.tsx
git commit -m "Oberfläche: Betriebsstrom am Kostenformular und Karte mit Schätzhilfe

Refs #212"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG (Abschnitt „Unveröffentlicht“, „Hinzugefügt“)**

```markdown
- **Betriebsstrom der Heizung** ([#212](https://github.com/speedone/mietfuchs/issues/212)): Eine
  Heizposition lässt sich als Betriebsstrom kennzeichnen, der über den Stromzähler des Hauses läuft.
  Steht beim Allgemeinstrom kein Abzug in gleicher Höhe, nennt die Abrechnung den Betrag, der doppelt
  verteilt wird. Die Karte „Betriebsstrom“ auf der Seite Heizkosten schätzt ihn nach Leistung der Geräte
  und Heiztagen (BGH, Urteil vom 03.06.2016, V ZR 166/15) oder nimmt den Zwischenzähler und legt
  Betriebsstrom und Abzug gemeinsam an. Pauschale Prozentsätze nennt nur das Lexikon.
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt der Berechnungs-Engine hinter dem Absatz zum Leerstand beim Personenschlüssel einfügen:

```markdown
- **Betriebsstrom der Heizung** (#212, Heizung PR 15): `cost_items.operating_power` sagt an einer
  Heizposition `included` (der Strom läuft über den Zähler des Hauses und steckt im Allgemeinstrom), an
  einer Position „Beleuchtung/Allgemeinstrom“ `deduction` (der Abzug); der Abzug zeigt mit
  `operating_power_item_id` auf seinen Betriebsstrom (`RESTRICT`, Löschen mit einem Satz gesperrt). Die
  Abrechnung prüft jede Position, die sie verteilt, gegen die Abzüge **aus allen Zeiträumen**
  (`operatingPowerDeductions` im Schnappschuss), denn eine eigene Heizperiode und der Allgemeinstrom
  liegen oft in verschiedenen; `heating.operating-power-double` nennt die Differenz. Die Schätzhilfe
  (`shared/operatingPower.ts`, Route `POST /api/heating-plants/:id/operating-power`) rechnet kWh aus
  Leistung, Laufzeit und Heiztagen oder nimmt den Zwischenzähler, Euro als Anteil an der Stromrechnung
  samt Grundpreis, und legt beide Positionen in einer Transaktion an. Die Prozentspannen der Literatur
  stehen nur im Lexikon (BGH V ZR 166/15 Rn. 14 referiert sie, billigt sie nicht).
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run (Smoke-Test gegen eine laufende Instanz mit Wegwerf-Ordner):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Das Skript endet mit Exit-Status 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Betriebsstrom der Heizung in CHANGELOG und CLAUDE.md

Refs #212"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| `heating.operating-power-double` mit Betrag, warning (10.1, 13 PR 15, 14.1) | 5 |
| Betriebsstrom im Topf erkennen (13 PR 15) | 2 (Kennzeichnung), 5 |
| Allgemeinstrom ungekürzt erkennen | 5 (Abweichung 2) |
| Abzug beim Allgemeinstrom als zweite Position | 2, 4 |
| Schätzhilfe nach Anschlusswerten und Heiztagen (Rn. 14) | 3, 4, 6 |
| Spannen nur im Lexikon, nicht im Register, keine Rechenregel (4.3, 16) | 1 |
| Lexikon mit Beispiel und Rechtsgrundlage (10.3) | 1 |
| Anleitungen „Betriebsstrom-Satz“ (11.4) | 1 |
| Wer nichts einstellt, merkt nichts (1.2 Nr. 1) | 5 (Test „ohne Kennzeichnung“), 2 (Kette lässt Bestand NULL) |
| Migrationen erzeugt, zwei Schritte (5, W7) | 2 |
| CHANGELOG, CLAUDE.md (13 „Für jede PR gilt“) | 7 |

**2. Platzhalter.** Keine „TBD“. Wo ein Name aus PR 3–14 eingeht, steht er unter „Schnittstellen“ oder
„Abgleich mit PR 13 und PR 14“; die Nummern der Migrationen nennt drizzle-kit, die Tests greifen über die Kennung.

**3. Typen.** `OperatingPower`, `OperatingPowerDevice`, `OperatingPowerDeduction` (Task 2),
`OperatingPowerInput`, `OperatingPowerShare` (Task 3), `OperatingPowerBooking` (Task 4),
`OperatingPowerFinding` (Task 5), `OperatingPowerForm`, `DeviceRow` (Task 6) werden mit denselben Feldern
benutzt (`cents`, `steps`, `measured`, `itemId`, `amountCents`, `differenceCents`).

**4. Review Focus.** 1 → Task 4 „Schätzhilfe lehnt ab“; 2 → Task 2 „Review Focus 2“; 3 → Task 2
„Review Focus 3“ und Task 6 `withOperatingPower`; 4 → Task 3 und Task 4; 5 → Task 5 „Review Focus 5“.
