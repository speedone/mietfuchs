# Heizung PR 11: Warmwasser ohne Zähler (#211, #99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei der eigenen Heizkostenabrechnung (`method = 'self'`) bestimmt Mietfuchs den
Warmwasseranteil α auch ohne Wärmezähler, nach den beiden Zahlenwertgleichungen des § 9 Abs. 2
HeizkostenV, wendet die Faktoren des § 9 Abs. 2 Satz 6 nur auf diese Formelwerte an, rechnet bei
Brennstoff in Litern, Kubikmetern oder Kilogramm mit dem Heizwert laut Rechnung und nur hilfsweise mit
der Tabelle des § 9 Abs. 3 (nur bei Heizkesseln), meldet die Formel ohne bestätigten unzumutbaren
Aufwand mit der Kürzung von 15 % (`heating.dhw-not-metered`, BGH VIII ZR 151/20) und nennt einen
ungewöhnlichen Anteil als Hinweis.

**Architecture:** Die ganze Rechnung steht als reine Funktionen in der neuen Datei
`server/src/dhw.ts` (`formulaHeat`, `formulaFactor`, `heatingValueOf`, `generatorEnergyOf`,
`dhwShareOf`). `hotWaterShareOf` (PR 10, heating.ts) bleibt die eine Stelle für α und ruft sie auf;
für alle drei Verfahren entsteht ein `DhwStatement` mit Rechenweg, das als `self.dhw` neben `self.alpha`
(PR 10) im Ausweis steht und im Druckblock erscheint. Die Rechtswerte (zwei Formeln, drei Faktoren,
Heizwerttabelle, die Ausnahme des § 11 Abs. 1 Nr. 3 Buchst. a in zwei Fassungen) kommen als fünf Parameter
in `shared/law/heizkostenv.ts`. Zwei neue Spalten, beide
nullbar: `fuel_deliveries.fuel_grade` (welche Zeile der Heizwerttabelle) und
`heating_plants.heat_generation` (ein Erzeuger oder mehrere, § 9 Abs. 1 Satz 5). Die Karte
„Warmwasser“ auf der Seite Heizkosten bekommt bei `self` die Eingaben der Formeln.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.5 (R-A13, G-B1), 0.6 (D-F1, N zu 15.1 Nr. 9), 0.7 (A8), 4.3 (Zeilen `hkv.dhw.volume-formula`,
`hkv.dhw.area-formula`, `hkv.dhw.factors`, `hkv.heating-values`), 4.7, 5.1, 5.3 (Gruppe Warmwasser),
5.4 (`heating_value`, `gas_basis`), 6.5 (Zeile „Warmwasser ohne Wärmezähler“), **8.3 ganz**, 8.8 („α
mit Methode“), 10.1 (`heating.dhw-not-metered`, `heating.heat-pump-dhw-basis`,
`heating.dhw-share-implausible`, `heating.heating-value-from-table`), 10.2 (`heating-dhw-split`), 10.3
(`hotWaterShare`), 12.2 (`heating.test.ts`: α 15,0 / 27,75 / 11,84 %, Heizwert laut Rechnung vor
Tabelle, Tabelle nur bei Kessel; F1 37,5 %; A8), 13 (PR 11), 14.1 (Zeilen „Warmwasser ohne
Wärmezähler“, „Fernwärme … α ÷ 1,15“, „Wärmepumpe … α × 0,30“, „Gemischte Anlage“), 15.1 Nr. 9,
15.2 F6, 15.3 (Zeile „Gemessenes Q gegen Brennwert-kWh“).

**Baut auf:** PR 1 bis PR 9 (Pläne `docs/superpowers/plans/2026-10-05-heizung-pr{1..9}-*.md`) und
PR 10 (Plan `…-pr10-kernrechnung.md`; lag beim Schreiben dieses Plans **nicht** vor, siehe
„Annahmen über PR 10“). Gearbeitet wird auf `feat/heizung-pr11-warmwasser`, abgezweigt von der Spitze
von PR 10; der PR wird gestapelt auf PR 10 gestellt und nach dessen Merge auf `main` umgestellt.

## Änderungen nach Prüfung vom 05.10.2026

Der Prüfbericht vom 05.10.2026 (Rechtsrichtigkeit der Abweichungen und Schnittstellen zu PR 10 in der
Fassung von Commit `81828af`) hat diesen Plan an sieben Stellen geändert. Jede Änderung steht im Task an
ihrer Stelle; diese Liste sagt, wo, damit die Durchsicht sie findet.

1. **Abgleich mit PR 10 statt Annahmen.** Der Plan benutzt die Namen von PR 10 unmittelbar:
   `hotWaterShareOf(i: AlphaInput)` bleibt die eine Stelle für α (heating.ts) und ruft jetzt
   `dhwShareOf(dhwInputOf(i), i.log)`; das Ergebnis behält die Gestalt von PR 10
   (`{ ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem; … }`), `Alpha` bekommt den
   Rechenweg als `statement: DhwStatement`, `ALPHA_TEXT` weicht `dhwProblemText` (dhw.ts). Der Ausweis
   führt α weiter als `self.alpha` (Prozent, PR 10) und den Rechenweg als `self.dhw`; eine zweite
   Stelle für α (`HeatingStatement.dhw`) gibt es nicht. Task 4 ist danach neu gefasst.
2. **Regeln aus PR 10 bleiben** (Task 3): Rechnungen müssen die Heizperiode ganz abdecken (`fuelGap`),
   α auf der Schätzung beim Abschluss heißt `estimated` (für `heating.dhw-share-estimated`), und α
   außerhalb von (0, 1) ist `outOfRange`. Alle drei stehen jetzt in dhw.ts, mit den Tests aus PR 10.
3. **Die vier Sperren von PR 10 fallen**, und zwar die, die es dort wirklich gibt: `formulaLater` und
   `heatingValueLater` in heating.ts (Task 4), `LATER.dhwHeatingValue` samt Zeile und
   `KWH_ENERGIES`-Abfrage in `guardHeatingPlant` (Task 4), die Sperre `kwhEnergy` in
   `heatingSelfForm.ts` (`HOT_WATER_OPTIONS`, `emptySelfSetup`, `selfSetupBody`, Task 6). Dazu die Sperre
   von PR 6 in `saveHotWater` (`method !== 'service'`, Task 5). Eine Sperre `LATER.dhwFormula` gibt es
   nicht; der Plan nennt sie nicht mehr.
4. **Schnappschuss vollständig** (Task 2 Step 7): Lieferungen picken zusätzlich `invoiceDate`,
   `quantity`, `quantityUnit`, `gasBasis`, `heatingValue`, `fuelGrade`, Zeilen der Heizperiode
   `dhwVolumeM3`, `dhwTempC`, die Anlage `heatGeneration`; ein Typtest in schema.test.ts hält es fest.
5. **Testhelfer `server/testing/selfHeating.ts`** (Task 4 Step 1): reiner Builder von Beispiel A mit
   festen Kennungen über `snapshotFor`, ohne Datenbank, mit einem Gleichheitstest gegen `beispielA` aus
   PR 10. PR 12 bis PR 14 bauen darauf.
6. **Stromheizung (`electric`)** (Abweichung 7 neu, Prüfbericht A6): gemessen rechnet Mietfuchs wie in
   PR 10 gegen die kWh laut Rechnung; gesperrt sind nur die Formeln. Eine Anlage, die nach PR 10
   abrechenbar war, bleibt es.
7. **Wärmepumpe vor dem 01.10.2024** (Abweichung 9 neu, Review Focus 5, Prüfbericht A3): § 11 Abs. 1
   Nr. 3 Buchst. a a. F. nahm überwiegend mit Wärmepumpen versorgte Gebäude von den §§ 3 bis 7 aus.
   Statt `heating.dhw-share-invalid` gibt es den Hinweis `heating.heat-pump-old-exemption`, keine
   Kürzungsbeträge, und ohne bestimmbares α wird nicht gesperrt; nur bei `heatGeneration = 'mixed'`
   bleibt es beim Fehler. Der Parameter `hkv.exemption.renewable` hat dafür zwei Fassungen (Task 1);
   PR 14 benutzt ihn für die Ausnahme `renewable`.
8. **Rumpf-Flächenformel begründet** (Abweichung 3): nach Tagen, weil § 9b Abs. 2 die Kosten des
   Warmwasserverbrauchs zeitanteilig teilt; als Festlegung F7 im Entwurf 15.2 geführt, ⟨Norm offen:
   VDI 2077⟩.
9. **`andList` aus `shared/wording.ts`** statt einer zweiten Fassung in dhw.ts (eine Quelle).
10. **Nachtrag aus der Prüfung der Schnittstellen für PR 15 bis 22 (05.10.2026):** Die Karte der
   Lieferungen heißt nach PR 7 Task 11 `FuelCard` (`client/src/components/FuelCard.tsx`), nicht
   `FuelDeliveriesCard` (Schnittstellen PR 7, Files, Task 6 Step 5, `git add`). Ihre Prop `plant`
   bekommt `energy` dazu, weil die Felder des Heizwerts am Energieträger hängen.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Anlage mit `self`, und bei
  `self` mit Wärmezähler und Brennstoff in kWh, ist jede Zahl, jeder Hinweis und
  `legalBasis.values` gleich dem Stand nach PR 10. Golden F01–F17 bleiben wortgleich: F16 (Beispiel A,
  α = 15 %) rechnet gemessen mit Gas in kWh, F17 (Heizöl mit Vorrat) hat kein Warmwasser (PR 10
  Abweichung 20). Eine Anlage, die nach PR 10 abrechenbar war, bleibt es; das gilt ausdrücklich für die
  Stromheizung (Abweichung 7).
- **Wortlaut des § 9 HeizkostenV**, gelesen am 05.10.2026 auf
  https://www.gesetze-im-internet.de/heizkostenv/__9.html (Fassung Art. 3 G v. 16.10.2023, BGBl. 2023
  I Nr. 280, in Kraft am 01.10.2024; die Gleichung in Abs. 3 ist dort als Bild
  `normengrafiken/bgbl1_2021/j4964-1_0010.jpg` hinterlegt und lautet „B = Q / Hᵢ“):
  - Abs. 2 Satz 2: „Q = 2,5 x V x (tw-10)“, Ergebnis „in Kilowattstunden pro Jahr“, V „das gemessene
    Volumen des verbrauchten Warmwassers … in Kubikmetern“, tw „die gemessene oder geschätzte mittlere
    Temperatur des Warmwassers … in Grad Celsius“, 10 „die übliche Kaltwassereintrittstemperatur“.
  - Abs. 2 Satz 4: „Q = 32 x A Wohn“, A „die durch die zentrale Anlage mit Warmwasser versorgte Wohn-
    oder Nutzfläche … in Quadratmeter“, nur „wenn in Ausnahmefällen weder die Wärmemenge noch das
    Volumen des verbrauchten Warmwassers gemessen werden können“.
  - Abs. 2 Satz 6: „Die nach den Zahlenwertgleichungen in Satz 2 oder 4 bestimmte Wärmemenge (Q) ist
    1. bei brennwertbezogener Abrechnung von Erdgas mit 1,11 zu multiplizieren, 2. bei eigenständiger
    gewerblicher Wärmelieferung durch 1,15 zu dividieren und 3. bei dem Betrieb einer monovalenten
    Wärmepumpe mit 0,30 zu multiplizieren.“
  - Abs. 3: „Bei Anlagen mit Heizkesseln ist der Brennstoffverbrauch der zentralen
    Warmwasserversorgungsanlage (B) in Litern, Kubikmetern oder Kilogramm nach folgender Gleichung zu
    bestimmen: B = Q / Hᵢ“; „Als Heizwerte … sind die in den Abrechnungsunterlagen des
    Energieversorgungsunternehmens oder Brennstofflieferanten angegebenen Heizwerte zu verwenden. Wenn
    diese … nicht angegeben werden, können hilfsweise folgende Werte verwendet werden“ (Tabelle);
    „Soweit die Abrechnung über Kilowattstunden-Werte erfolgt, ist eine Umrechnung in
    Brennstoffverbrauch nicht erforderlich.“
  - Abs. 1 Satz 2: „bei Anlagen mit Heizkesseln nach den Anteilen am Brennstoffverbrauch oder am
    Energieverbrauch, bei Wärmepumpen oder und bei eigenständiger gewerblicher Wärmelieferung nach den
    Anteilen am Wärmeverbrauch“ (das „oder und“ steht so im Text); Satz 5: Bei Anlagen, „die nicht
    ausschließlich durch Heizkessel, durch Wärmepumpen oder durch eigenständige gewerbliche
    Wärmelieferung mit Wärme versorgt werden, können anerkannte Regeln der Technik zur Aufteilung der
    Kosten verwendet werden“.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): 2,5, 10, 32, 1,11, 1,15, 0,30, jeder Heizwert
  der Tabelle und der Stichtag der Ausnahme für Wärmepumpen (`hkv.exemption.renewable`, Abweichung 9)
  stehen nur in `shared/law/heizkostenv.ts`. `server/src/dhw.ts` kommt in
  `ENGINE_FILES` von `law-literals.test.ts`. Die Plausibilitätsgrenze (5 und 50 %) ist **kein**
  Rechtswert (15.2 F6) und steht als benannte Konstante `DHW_PLAUSIBLE` in dhw.ts; Texte setzen sie
  über `${…}` ein.
- **Faktoren nur für Formelwerte** (8.3, G-B1 abgelehnt): Der gemessene Wert Q wird nie mit 1,11,
  1,15 oder 0,30 umgerechnet. Ein Test hält 15,0 % für das Beispiel aus 8.3 fest.
- **Heizwert laut Rechnung vor Tabelle, Tabelle nur bei Heizkesseln** (R-A13): `heating_value` der
  Lieferung geht vor; die Tabelle gilt nur, wenn die Rechnung keinen nennt, nur bei den Energien
  `gas`, `oil`, `lpg`, `pellets`, `wood`, `coal`, nur mit gewählter Tabellenzeile (`fuel_grade`) und nur
  in der Einheit der Tabellenzeile. Jede Verwendung der Tabelle ergibt
  `heating.heating-value-from-table` (hint).
- **Fassungen nie ändern** (4.4): Die neuen Fassungen bekommen je eine Zeile in
  `law-history.test.ts`; keine bestehende Zeile ändert sich.
- **Stufe hängt am Code** (#112): Jeder neue Code steht mit genau einer Stufe in `noticeKinds` und
  trägt mindestens einen Begriff (`hotWaterShare`).
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte in genau dieser Reihenfolge hinter dem letzten Schritt von PR 10: `warmwasser` (zwei neue
  Spalten, keine geänderte Bedingung) und `warmwasser_bedingungen` (Bedingungen, Neubau). Die Nummer
  vergibt drizzle-kit; mit zwei Schritten in PR 10 (Annahme B9) sind es `0028_warmwasser` und
  `0029_warmwasser_bedingungen`. Die Marken kommen in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben unverändert.
  `legacy/read.ts` braucht keine Änderung, die neuen Felder im Schnappschuss sind optional.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein `namespace`,
  keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter `grep`
  prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #99` und `Refs #211` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung. Aufgaben stehen nur in den GitHub-Issues des Repos, nie in
  Beads (CLAUDE.md).

## Review Focus

1. **Ölheizung mit Vorrat, Rechnung ohne Heizwert, Tabellenzeile nicht gewählt.** Der Vermieter
   erwartet keinen stillen Wert, sondern den Satz, was fehlt. Erwartet: `heating.dhw-share-invalid`
   (error, PR 10) mit dem Satz, dass Heizwert laut Rechnung oder die Zeile der Tabelle fehlt, und
   keine Verteilung des Topfs; nach Wahl von „Leichtes Heizöl extra leichtflüssig“ 10 kWh/l mit
   `heating.heating-value-from-table`. Test in Task 3 (`dhw.test.ts`) und Task 4.
2. **Flüssiggas in Litern, Rechnung ohne Heizwert.** Die Tabelle nennt Flüssiggas nur je Kilogramm.
   Erwartet: keine erfundene Dichte, sondern der Satz, dass die Tabelle keinen Wert je Liter hat und
   der Heizwert laut Rechnung einzutragen ist. Test in Task 3.
3. **Holzhackschnitzel in Schüttraummetern** (häufige Liefereinheit). Bis 30.11.2021 kannte die
   Tabelle 650 kWh/SRm, seit 01.12.2021 nur noch 4 kWh/kg, und Abs. 3 bestimmt B nur noch in Litern,
   Kubikmetern oder Kilogramm. Erwartet: Heizperiode ab Dezember 2021 in SRm → Satz mit beiden
   Auswegen (Kilogramm oder kWh laut Rechnung), Heizperiode 2021 → 650 kWh/SRm. Test in Task 3.
4. **Heizperiode kürzer als zwölf Monate (Rumpf) mit der Flächenformel.** 32 · A ist ein Wert „pro
   Jahr“. Erwartet: zeitanteilig nach Tagen gekürzt und im Rechenweg genannt (Abweichung 3), nicht der
   volle Jahreswert gegen die Energie von vier Monaten. Test in Task 3.
5. **Wärmepumpe in einer Heizperiode, die vor dem 01.10.2024 beginnt, mit Formel.** Der Faktor 0,30
   steht erst seit 01.10.2024 im Gesetz, und bis dahin nahm § 11 Abs. 1 Nr. 3 Buchst. a a. F. Gebäude,
   die überwiegend mit Wärme aus Wärmepumpen versorgt werden, von den §§ 3 bis 7 ganz aus (Prüfbericht
   vom 05.10.2026, A3). Erwartet: kein Faktor erfunden und kein Fehler, der die Kosten beim Vermieter
   lässt, sondern der Hinweis `heating.heat-pump-old-exemption` ohne Kürzungsbeträge; die Kosten von
   Heizung und Warmwasser gehen gemeinsam nach dem Heizschlüssel (Abweichung 9). Erzeugt die Anlage
   die Wärme mit einem weiteren Erzeuger (`heatGeneration = 'mixed'`), bleibt `heating.dhw-share-invalid`
   mit dem Satz, dass nur gemessen oder nach anerkannten Regeln der Technik aufgeteilt werden kann (§ 9
   Abs. 1 Satz 5 a. F.). Test in Task 1 (Register), Task 3 (`dhw.test.ts`, kein Faktor) und Task 4
   (`calc-warmwasser.test.ts`).

---

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/types.ts` | `FuelGrade`, `HeatGeneration`, `HeatingValueUnit`, `HeatingValueTable`, `DhwHeatingValue`, `DhwFactorKind`, `DhwDenominator`, `DhwStatement`; Felder an `FuelDelivery`, `HeatingPlant`, `SelfHeatingStatement` (`dhw`), `HeatingPeriodView` | 1, 2, 3, 4, 5 |
| `shared/fuelGrades.ts` (neu) | Tabellenzeilen, Beschriftungen nach dem Wortlaut, Heizkessel, Zeilen je Energie | 1 |
| `shared/law/heizkostenv.ts`, `shared/law/params.ts` | fünf Parameter (vier zu § 9, `hkv.exemption.renewable`) | 1 |
| `shared/glossary.ts` | `hotWaterShare` mit Formeln, Faktoren, Tabelle und beiden Lesarten zu Q | 1 |
| `server/src/db/schema.ts`, `server/drizzle/00xx_warmwasser.sql`, `00xx_warmwasser_bedingungen.sql`, `meta/*` (erzeugt) | zwei Spalten, Bedingungen | 2 |
| `server/src/db/fuel.ts`, `server/src/db/heating.ts`, `server/src/snapshot.ts` | Felder schreiben, prüfen, in den Schnappschuss | 2 |
| `server/src/dhw.ts` (neu) | Formeln, Faktoren, Heizwert, Energie des Erzeugers, α mit Rechenweg | 3 |
| `server/testing/selfHeating.ts` (neu) | Beispiel A als Schnappschuss ohne Datenbank, für PR 11 bis PR 14 | 4 |
| `server/src/heating.ts`, `server/src/calc.ts`, `server/src/db/heating.ts` | `hotWaterShareOf` über dhw.ts, Sperren von PR 10 fallen, Hinweise, `self.dhw` | 4 |
| `server/src/db/co2.ts` | Warmwasser bei `self` speichern (Sperre von PR 6 fällt), Ansicht | 5 |
| `client/src/heatingForm.ts`, `client/src/components/HotWaterCard.tsx`, `client/src/fuelForm.ts`, `client/src/components/FuelCard.tsx`, `client/src/dhwView.ts` (neu), `client/src/components/DhwBlock.tsx` (neu), `client/src/pages/Abrechnung.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/heatingSelfForm.ts`, `client/src/components/HeatingSelfSetup.tsx` | Eingaben, Sperre der Einrichtung fällt, Druckblock | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `schema.test.ts`, `migrations.test.ts`, `dhw.test.ts` (neu), `db-warmwasser.test.ts` (neu), `calc-warmwasser.test.ts` (neu), `heating.test.ts`, `calc-heizkosten.test.ts`, `db-heizkosten.test.ts` (Tests von PR 10), `api.test.ts`, `client/src/heatingForm.test.ts`, `client/src/fuelForm.test.ts`, `client/src/heatingSelfForm.test.ts`, `client/src/components/HotWaterCard.test.tsx` (neu), `client/src/dhwView.test.ts` (neu) | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 9 anders umgesetzt hat, zieht ihn hier nach, bevor
Task 1 beginnt.

- **PR 1** `shared/law/register.ts`: `LawParam<T, M>` mit `describe(value)`, `law(param, { period },
  log)` für `periodStart`, `valueAt(param, date)`, `versionAt(param, date)`, `germanDate(iso)`,
  `dayBefore(iso)`, `LAW_AS_OF`, `Source`, `Period`, `LawLog`, `createLawLog()`.
  `shared/law/heizkostenv.ts` mit den Konstanten `ENACTED` und `checked(cite, url)`;
  `shared/law/params.ts`: `LAW_PARAMS`. `server/test/law.test.ts` mit dem Objekt `modules` im Test
  „jede Konstante vom Typ LawParam in shared/law/ steht in LAW_PARAMS“; `law-literals.test.ts`:
  `ENGINE_FILES`; `law-history.test.ts`: `SHIPPED`.
- **PR 4** `shared/types.ts`: `HeatingPlant`, `HeatingEnergy`, `HeatingPeriodData` (mit `dhwMethod`,
  `dhwHeatKwh`, `totalHeatKwh`, `dhwVolumeM3`, `dhwTempC`, `dhwUnmeasurable`), `DhwMethod`; schema.ts
  `heatingPlants`, `heatingPeriods`, `oneOf`, `exactly`, `DHW_METHODS`; db/heating.ts `mergeHeatingPlant`,
  `emptyHeatingPlant`, `plantRow`, `guardHeatingPlant`, `createHeatingPlant(db, id, propertyId, body)`;
  repository.ts `HeatingError`, `has`, `raw`, `merged`, `oneOfOrUndefined`.
- **PR 6** `HeatingPeriodView` (mit `hotWater`), `HeatingStatement`; db/co2.ts `saveHotWater`,
  `heatingPeriodViews`, `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`,
  `ensureHeatingPeriod`, `closedText`; snapshot.ts `SnapshotHeatingPlant`, `SnapshotHeatingPeriodRow`,
  `Snapshot.heatingPeriodRows?`, `Snapshot.heatingPlants?`; im CO₂-Block von `computeSettlement` der
  Hinweis `heating.dhw-not-metered` mit `pot.hotWater`, `FORMULA_METHODS`, `cutsOn(ids, cut)`,
  `where`, `plantSubject`, `hPeriod`, `warn`; `client/src/components/HotWaterCard.tsx`, `heatingForm.ts`
  mit `HOT_WATER_OPTIONS`, `isFormula`, `hotWaterBody`; Lexikon `hotWaterShare`.
- **PR 7** `FuelDelivery` (mit `energyKwh`, `quantity`, `quantityUnit`, `gasBasis`, `heatingValue`),
  `FuelQuantityUnit`, `GasBasis`, `FuelAssessment`, `FuelDeliveryLine` (`deliveryId`, `sharePermille`);
  schema.ts `fuelDeliveries`, `FUEL_QUANTITY_UNITS`; db/fuel.ts `mergeDelivery`, `emptyDelivery`,
  `guardDelivery(db, plant, before, after)`, `createDelivery(db, id, plantId, body)`,
  `updateDelivery(db, id, body)`, `PlantFacts`; read.ts `readFuelDeliveries` (übernimmt jede Spalte über
  `...d`); snapshot.ts `SnapshotFuelDelivery`, `SnapshotFuel` (`snapshot.fuel.deliveries`), `FuelSource`
  (`fuelDeliveries`); `FuelResult` (`lines`, `coveragePermille`); `client/src/fuelForm.ts` mit `FuelForm`,
  `fuelToForm`, `fuelBody`; `client/src/components/FuelCard.tsx`.
- **PR 8** `HeatingStockStatement` (`unit`, `consumed.quantity`), `StockUnit`, `StockResult`; in
  `computeSettlement` `stockOfPlant`; `shared/fuelStock.ts` `STOCK_ENERGIES`, `isStockEnergy`.
- **PR 10** (Plan, Commit `81828af`): siehe „Annahmen über PR 10“, Abschnitt „Auflösung“, und Task 4.

## Annahmen über PR 10

**Stand nach der Prüfung vom 05.10.2026: abgeglichen.** Die Tasks benutzen die Namen von PR 10 (Plan
`2026-10-05-heizung-pr10-kernrechnung.md`, Commit `81828af`) unmittelbar. Die Tabelle B1–B10 und der
Vermerk bleiben als Herkunft stehen; wo sie einem Task widersprechen, gilt der Task. Die Auflösung je
Annahme steht unter dem Vermerk.

Der Plan von PR 10 lag beim Schreiben dieses Plans nicht vor; er entstand parallel. Die folgenden
Namen sind aus dem Entwurf (5.3, 6.1 Nr. 4.3, 8.3 bis 8.6, 10.1, 13 PR 10) und den Gewohnheiten der
Pläne PR 4 bis PR 9 abgeleitet. **Vor Task 1** gleicht die ausführende Sitzung jede Zeile mit dem
Plan bzw. Code von PR 10 ab und ersetzt in diesem Plan jeden abweichenden Namen, bevor sie beginnt; die
Spalte „Wo benutzt“ nennt jede Stelle. Weicht PR 10 in der Sache ab (nicht nur im Namen), entscheidet
die Durchsicht, bevor gebaut wird.

**Vermerk nach Erscheinen des Plans von PR 10** (`2026-10-05-heizung-pr10-kernrechnung.md`): Die
tatsächlichen Namen dort, die die Annahmen ersetzen:

- **B2/B3:** α bestimmt `hotWaterShareOf(i: AlphaInput)` in `server/src/heating.ts` (Task 4), Ergebnis
  `{ ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem }`, mit
  `type Alpha = { value; dhwHeatKwh; referenceKwh; reference: 'fuel' | 'totalHeat'; estimated }` und
  `AlphaProblem = 'formulaLater' | 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'heatingValueLater' | 'outOfRange'`.
  `AlphaInput` hat `hotWater`, `dhwMethod`, `energy`, `dhwHeatKwh`, `totalHeatKwh`, `fuelKwh`,
  `fuelCoveragePermille`, `fuelEstimated?`; kein `plant`/`row`/`stock`. Der Aufruf steht einmal in
  `computeSettlement` (Task 8, `alphaResult`); die Texte zu den Problemen in `ALPHA_TEXT`, Codes
  `heating.dhw-share-invalid` und `heating.heat-pump-dhw-basis`. Die Naht N1 dieses Plans ersetzt
  `hotWaterShareOf` und `ALPHA_TEXT`, nicht eine Funktion `dhwShare`.
- **B4:** `formulaLater` und `heatingValueLater` sind die beiden Sperren; die Einrichtung lehnt
  `hotWater = 'combined'` bei Öl, Flüssiggas, Pellets, Holz und Kohle mit 400 ab (Abweichung 10 dort).
- **B6:** `SnapshotFuelDelivery` bekommt in PR 10 nur `energyKwh`; `SnapshotHeatingPeriodRow` pickt
  `heatConsumptionPct`, `waterConsumptionPct`, `insulationRule`, `dhwHeatKwh`, `totalHeatKwh`.
- **B7:** Der Ausweis ist `HeatingStatement.self?: SelfHeatingStatement`; α steht dort als **Objekt**
  `self.alpha = { percent, dhwHeatKwh, referenceKwh, reference, estimated } | null` (Prozent, nicht
  Bruchteil), nicht als `alpha?: number`. Der Druckblock heißt `client/src/components/SelfHeatingBlock.tsx`.
- **B8:** Einen Helfer `server/testing/selfHeating.ts` gibt es nicht. Beispiel A baut
  `beispielA(opened, options)` in `server/test/calc-heizkosten.test.ts` über die Datenbank
  (`setUpSelf`, Zähler, Ablesungen, `createDelivery`, Positionen) und gibt einen `Snapshot` zurück;
  wer ihn in PR 11 braucht, zieht ihn nach `server/testing/` um.
- **B9:** zwei Schritte, `0026_heizkostenabrechnung` und `0027_heizkostenabrechnung_bedingungen`.
- **B10:** `HeatingPeriodView` bekommt in PR 10 nur `distribution`; `HotWaterCard` bleibt von PR 6.

**Auflösung (Prüfung vom 05.10.2026):**

- **B2/B3:** Task 4 fasst `hotWaterShareOf` neu: `AlphaInput = DhwContext & { hotWater; log }`, das
  Ergebnis bleibt in der Gestalt von PR 10 und trägt in `Alpha.statement` den Rechenweg; `ALPHA_TEXT`
  weicht `dhwProblemText`. Die Regeln von PR 10 (`fuelGap`, `estimated`, `outOfRange`) stehen in dhw.ts
  (Task 3).
- **B4:** Die tatsächlichen Sperren sind `formulaLater` und `heatingValueLater` (heating.ts),
  `LATER.dhwHeatingValue` samt Zeile in `guardHeatingPlant` (Task 4), `kwhEnergy` in
  `heatingSelfForm.ts` (Task 6) und die Sperre von PR 6 in `saveHotWater` (`method !== 'service'`,
  Task 5). Eine Sperre `LATER.dhwFormula` gibt es nicht.
- **B6:** Task 2 Step 7 ergänzt alle Felder, die dhw.ts liest, mit Typtest.
- **B7:** α bleibt `self.alpha` (Prozent); der Rechenweg ist `self.dhw` (`SelfHeatingStatement`), kein
  `HeatingStatement.dhw`. `DhwBlock` liest `self.dhw`.
- **B8:** Task 4 Step 1 legt `server/testing/selfHeating.ts` an, mit Gleichheitstest gegen `beispielA`.
- **B10:** Task 5 und 6 ergänzen die Felder der Ansicht selbst; die Karte wird bei `self` eingebunden.

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| B1 | `HeatingPlant` hat `hotWater: 'combined' \| 'separate' \| 'none'` (Spalte `hot_water`) und `capture: 'heatMeter' \| 'hca' \| 'serviceValues' \| null`; `SnapshotHeatingPlant` pickt `energy`, `method`, `hotWater`, `units`, `name` | Task 2, 4 |
| B2 | **Naht N1:** PR 10 bestimmt α an genau einer Stelle, `export function dhwShare(i: DhwShareInput): DhwShare` in `server/src/heating.ts`, mit `type DhwShare = { ok: true; alpha: number } \| { ok: false; code: NoticeCode; text: string }`. `computeSettlement` meldet bei `ok: false` den Code mit dem Text und verteilt den Topf der Anlage in dieser Heizperiode nicht (Entwurf 10.1: `error` heißt „wird gar nicht verteilt“). | Task 4 |
| B3 | `DhwShareInput` enthält `plant: SnapshotHeatingPlant`, `row: SnapshotHeatingPeriodRow \| null`, `h: BillingPeriod`, `fuel: FuelAssessment \| null`, `stock: HeatingStockStatement \| null`, `deliveries: readonly SnapshotFuelDelivery[]`, `units: readonly SnapshotUnit[]` (die angeschlossenen Wohnungen), `measured: { dhwKwh: number \| null; totalKwh: number \| null }` (Wärme des Warmwassers und Gesamtwärme, gemessen am Zähler mit Rolle `dhwHeat` bzw. `totalHeat` oder eingetragen) und `log: LawLog` | Task 4 |
| B4 | PR 10 sperrt bei `self` die Formeln mit 400 (`LATER.dhwFormula` in `saveHotWater`) und meldet bei Brennstoff ohne kWh (Liter, Kilogramm, Kubikmeter) `heating.dhw-share-invalid` mit „…kommt mit einer späteren Version“ | Task 4, 5 |
| B5 | `noticeKinds` kennt `'heating.dhw-share-invalid'` (error, Regel `heating-dhw-split`, Begriff `hotWaterShare`) | Task 4 |
| B6 | `SnapshotHeatingPeriodRow` pickt zusätzlich `dhwHeatKwh`, `totalHeatKwh`; `SnapshotFuelDelivery` pickt zusätzlich `energyKwh`, `quantity`, `quantityUnit`, `gasBasis`, `heatingValue`, `invoiceDate` | Task 2 |
| B7 | `HeatingStatement` (PR 6) bekommt in PR 10 je Anlage und Heizperiode den Teil der eigenen Abrechnung; dort steht α als `alpha?: number`. Der Druckblock der eigenen Abrechnung ist `client/src/components/SelfHeatingBlock.tsx` und wird in `Abrechnung.tsx` je `HeatingStatement` gerendert | Task 4, 6 |
| B8 | Test-Helfer `server/testing/selfHeating.ts` mit `selfSnapshot(o?: SelfSnapshotOptions): Snapshot` (Beispiel A aus 8.6, Gas in kWh nach Brennwert, Anlage `hp`, Heizperiode `'2025-01'`) und `type SelfSnapshotOptions = { plant?: Partial<SnapshotHeatingPlant>; row?: Partial<SnapshotHeatingPeriodRow>; deliveries?: SnapshotFuelDelivery[]; stock?: HeatingStockStatement \| null; units?: SnapshotUnit[] }` | Task 4 |
| B9 | PR 10 erzeugt zwei Migrationsschritte, der letzte ist `0027_…` | Task 2 |
| B10 | `HeatingPeriodView.hotWater` pickt nach PR 10 `dhwMethod`, `dhwUnmeasurable`, `dhwHeatKwh`, `totalHeatKwh`; `HotWaterCard` zeigt bei `self` die Felder des Wärmezählers | Task 5, 6 |

Fehlt B2 so, dass α an mehreren Stellen bestimmt wird, wird zuerst (als eigener Schritt vor Task 4
Step 3) eine Funktion daraus; alles andere ist eine Umbenennung.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **Zwei Fassungen bei `hkv.dhw.factors`** (4.3 nennt eine). Der Faktor 0,30 für die monovalente
   Wärmepumpe (§ 9 Abs. 2 Satz 6 Nr. 3) kam mit Art. 3 G v. 16.10.2023 (BGBl. 2023 I Nr. 280) und gilt
   seit 01.10.2024 (buzer.de, „Frühere Fassungen von § 9 HeizkostenV“: „m.W.v. 1. Oktober 2024“,
   gelesen 05.10.2026). Für Heizperioden, die davor beginnen, ist `heatPump: null`: Die Formel rechnet
   bei einer Wärmepumpe dann nicht. Eine Wärmepumpe ohne weiteren Erzeuger fiel in diesen Zeiträumen
   ohnehin nicht unter die Verordnung (Abweichung 9); nur bei `heatGeneration = 'mixed'` bleibt es bei
   `heating.dhw-share-invalid`, und Satz 5 a. F. („nicht ausschließlich durch Heizkessel oder durch
   eigenständige gewerbliche Wärmelieferung“) verweist auf die anerkannten Regeln der Technik. Offen und
   vor dem Bau zu lesen (Prüfbericht A.2): ob Q · 0,30 gegen den Strom oder gegen die Gesamtwärme zu
   setzen ist; der Plan folgt dem Entwurf (Strom, F1), die Begründung zum Gesetz vom 16.10.2023 steht als
   Prüfpunkt in der PR-Beschreibung.
2. **Holzhackschnitzel geklärt, zwei Fassungen bei `hkv.heating-values`** (4.3: „welche
   Hackschnitzelangabe gilt, ungeprüft (BGBl. 2021 I S. 4964 vor PR 11 lesen)“). Gelesen am 05.10.2026
   in der Wiedergabe von buzer.de (Art. 1 Nr. 5 Buchst. c der Verordnung vom 24.11.2021, BGBl. I
   S. 4964, in Kraft am 01.12.2021): „aa) Satz 1 wird wie folgt gefasst: ‚… (B) in Litern, Kubikmetern
   oder Kilogramm …‘“, „bb) Satz 2 Nummer 2 wird wie folgt gefasst: ‚2. der Heizwert des verbrauchten
   Brennstoffes (Hᵢ) in Kilowattstunden je Liter, Kubikmeter oder Kilogramm.‘“, „cc) Nach Satz 2 werden
   folgende Sätze eingefügt: ‚Als Heizwerte nach Satz 2 Nummer 2 …‘“ mit der neuen Tabelle
   (Holzhackschnitzel (lufttrocken) 4 kWh/kg). Die alte Tabelle mit 650 kWh/SRm war Teil der alten
   Nummer 2 („… oder Schüttraummeter (SRm). Als Hᵢ-Werte können verwendet werden für …“) und ist mit
   deren Neufassung **entfallen**. Dass gesetze-im-internet.de sie hinter Satz 5 weiter abdruckt, ist
   ein Versehen der Konsolidierung; stehen geblieben sind dort auch die alten Sätze 3 und 4 („Enthalten
   die Abrechnungsunterlagen …“, „Soweit die Abrechnung über kWh-Werte erfolgt …“), die inhaltlich den
   neuen Sätzen 3 und 5 entsprechen. Folge: bis 30.11.2021 650 kWh/SRm und Schüttraummeter als Einheit
   von B, ab 01.12.2021 4 kWh/kg und keine Schüttraummeter. **Vor dem Merge** liest die Durchsicht die
   Seite im amtlichen BGBl.-PDF (bgbl.de, 2021 Teil I S. 4964) gegen; das steht als Punkt in der
   PR-Beschreibung.
3. **Flächenformel im Rumpf zeitanteilig, nach Tagen (Festlegung F7 im Entwurf 15.2).** § 9 Abs. 2
   Satz 4 liefert kWh „pro Jahr“; für eine Heizperiode unter zwölf Monaten rechnet Mietfuchs
   32 · A · Tage / Tage des Jahres ab Beginn, denn sonst stimmt das Verhältnis zur Energie des Zeitraums
   nicht (ein Jahreswert gegen vier Monate Energie verdreifachte α). **Begründung für Tage:** § 9b Abs. 2
   HeizkostenV teilt die Kosten des Warmwasserverbrauchs beim Nutzerwechsel „zeitanteilig“; Warmwasser
   hängt nicht an der Witterung, Gradtage wären falsch. Eine Regel eines Messdienstes oder der VDI 2077
   dazu ist nicht bekannt (⟨Norm offen: VDI 2077⟩, Prüfbericht A.2). Die Volumenformel braucht das nicht,
   denn V ist das gemessene Volumen des Zeitraums. Rechenweg und Lexikon nennen § 9b Abs. 2.
4. **Neue Spalte `fuel_deliveries.fuel_grade`** (in 5.4 nicht genannt). Die Tabelle unterscheidet
   Erdgas H und L, leichtes und schweres Heizöl, Koks, Braun- und Steinkohle, Brennholz und
   Hackschnitzel; der Energieträger der Anlage (`gas`, `oil`, `coal`, `wood`) gibt das nicht her. Ohne
   gewählte Zeile wird nicht geraten; vorbelegt wird in der Oberfläche nur, wo es genau eine Zeile gibt
   (Flüssiggas, Pellets).
5. **Neue Spalte `heating_plants.heat_generation`** (`single | mixed`, in 5.3 nicht genannt). Satz 6
   Nr. 3 setzt eine **monovalente** Wärmepumpe voraus, und 8.3 lässt bei Mischanlagen nur `heatMeter`
   mit gemessener Gesamtwärme zu. Ohne Antwort rechnet die Formel nicht (`heating.dhw-share-invalid` mit
   der Frage); eine Vorgabe „ein Erzeuger“ wäre eine Annahme. Eine Wärmepumpe mit Heizstab gilt als
   `mixed` (nicht monovalent).
6. **Mittlerer Heizwert bei mehreren Rechnungen.** Nennen die Rechnungen einer Heizperiode verschiedene
   Heizwerte, rechnet Mietfuchs mit dem mengengewichteten Mittel Σ (Menge · Hᵢ) / Σ Menge; das ist die
   Energie der gelieferten Mengen geteilt durch ihre Menge. Liegt in der Heizperiode keine Lieferung (nur
   Vorrat), gilt der Heizwert der jüngsten früheren Lieferung derselben Einheit. Keine Quelle; physikalisch
   die Energie des Brennstoffs.
7. **Strom-Direktheizung (`electric`): gemessen wie PR 10, Formeln gesperrt; `other` nur gegen
   gemessene Gesamtwärme** (Prüfbericht A6, neu gefasst). PR 10 stellt bei `electric` die gemessene
   Wärme gegen die kWh laut Rechnung (`KWH_ENERGIES`); das bleibt, denn eine Anlage, die nach PR 10
   abrechenbar war, darf durch PR 11 nicht gesperrt werden. Rechtlich ist ein Elektrokessel als
   Heizkessel mit „Energieverbrauch“ (§ 9 Abs. 1 Satz 2 HeizkostenV) gut vertretbar; wer ihn nicht so
   liest, landet bei Satz 5 (anerkannte Regeln der Technik), und Wärme gegen Strom ist bei einem
   Wirkungsgrad nahe 1 eine solche Regel. Eine Quelle für eine strengere Lesart gibt es nicht. Gesperrt
   sind bei `electric` nur die Formeln: Satz 6 nennt für sie keinen Faktor, und Mietfuchs erfindet keinen
   (**Festlegung**). Die Tabelle des § 9 Abs. 3 gilt bei `electric` ohnehin nicht (kein Heizkessel im
   Sinne der Tabelle, `BOILER_ENERGIES`). Bei `other` (unbekannter Energieträger) rechnet Mietfuchs nur
   gemessen gegen gemessene Gesamtwärme (§ 9 Abs. 1 Satz 5).
8. **Wiederverwendung von `heating.dhw-share-invalid`** (PR 10) für jede fehlende oder widersprüchliche
   Eingabe der Formeln und des Heizwerts, statt eines neuen Codes. Der Text nennt je Fall, was fehlt.
9. **Wärmepumpe in Zeiträumen vor dem 01.10.2024: Hinweis statt Fehler** (Prüfbericht A3). § 11 Abs. 1
   Nr. 3 Buchst. a HeizkostenV in der Fassung bis 30.09.2024 nahm Räume in Gebäuden aus, „die überwiegend
   versorgt werden a) mit Wärme aus Anlagen zur Rückgewinnung von Wärme oder aus Wärmepumpen- oder
   Solaranlagen“; Art. 3 G v. 16.10.2023 hat die Wärmepumpe dort gestrichen (Wortlaut beider Fassungen
   bei buzer.de, `gesetz/3769/al206559-0`, gelesen 05.10.2026). Der neue Parameter
   `hkv.exemption.renewable` hält beide Fassungen (`{ heatPump: true }` bis 30.09.2024, danach
   `false`); PR 14 benutzt ihn für die Ausnahme `renewable`. Mietfuchs fragt ihn bei einer Wärmepumpe,
   deren Anlage die Wärme nicht mit einem weiteren Erzeuger teilt (`heatGeneration` nicht `mixed`, also
   auch ohne Antwort), und meldet dann `heating.heat-pump-old-exemption` (hint): keine Kürzungsbeträge
   nach § 12 (wie bei `notYet`, PR 10), und ist α nicht bestimmbar (etwa Formel ohne Faktor 0,30), kein
   Fehler. Die Positionen „Heizung und Warmwasser“ gehen dann ganz in den Topf Heizung (**Festlegung**:
   Die Verordnung bindet in diesem Fall nicht, und die gemeinsame Verteilung nach dem Heizschlüssel
   trägt dem erfassten Verbrauch Rechnung, § 556a Abs. 1 Satz 2 BGB). `mixed` liest Mietfuchs als
   „nicht überwiegend“ (Prüfbericht A3); dann bleibt § 9 Abs. 1 Satz 5 a. F. und der Fehler. Ob der
   Nachsatz „sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird“ auch Buchst. a betrifft, lässt
   der Satzbau offen (ungeprüft); der Hinweis nennt die Bedingung „überwiegend“ und lässt die
   Entscheidung beim Vermieter.
10. **Regeln von PR 10 in dhw.ts** (Prüfbericht B.1): Die Rechnungen müssen die Heizperiode ganz
    abdecken (`fuelGap`; nicht beim Vorrat, dort zählt die verbrauchte Menge), α auf der Schätzung beim
    Abschluss ist `estimated` (Hinweis `heating.dhw-share-estimated`, PR 10), und α außerhalb von (0, 1)
    ist `outOfRange`. Die harte Grenze (0, 1) bleibt ein Fehler neben dem Plausibilitätshinweis
    5–50 %.


---
### Task 1: Rechtsregister, Tabellenzeilen und Lexikon

Vier Parameter (Entwurf 4.3, Spalte „PR 11“) mit den Fassungen aus Abweichung 1 und 2, dazu
`hkv.exemption.renewable` mit zwei Fassungen (Abweichung 9, Prüfbericht A3), die
Tabellenzeilen als gemeinsamer Laufzeitanteil in `shared/` und der Lexikoneintrag `hotWaterShare` mit
Formeln, Faktoren und den beiden Lesarten zu Q (15.1 Nr. 9, „beide Lesarten gleichwertig“).

**Files:**
- Modify: `shared/types.ts`, `shared/law/heizkostenv.ts`, `shared/law/params.ts`, `shared/glossary.ts`
- Create: `shared/fuelGrades.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes: PR 1 `LawParam`, `law`, `valueAt`, `versionAt`, `createLawLog`, `LAW_AS_OF`, `ENACTED`,
  `checked`; PR 1 `CUT` in glossary.ts; PR 4 `HeatingEnergy`.
- Produces:
  - `shared/types.ts`: `type FuelGrade = 'heatingOilEL' | 'heavyFuelOil' | 'naturalGasH' | 'naturalGasL' | 'lpg' | 'coke' | 'lignite' | 'hardCoal' | 'firewood' | 'woodPellets' | 'woodChips'`, `type HeatGeneration = 'single' | 'mixed'`, `type HeatingValueUnit = 'l' | 'm3' | 'kg' | 'srm'`, `type HeatingValueRow = { readonly kwh: number; readonly per: HeatingValueUnit }`, `type HeatingValueTable = { readonly units: readonly HeatingValueUnit[]; readonly values: { readonly [grade: string]: HeatingValueRow } }`
  - `shared/fuelGrades.ts`: `FUEL_GRADES: readonly FuelGrade[]`, `FUEL_GRADE_LABELS: Record<FuelGrade, string>`, `BOILER_ENERGIES: readonly HeatingEnergy[]`, `GRADES_BY_ENERGY: Readonly<Record<HeatingEnergy, readonly FuelGrade[]>>`, `HEATING_VALUE_UNIT_TEXT: Record<HeatingValueUnit, string>`, `isBoiler(energy): boolean`
  - `shared/law/heizkostenv.ts`: `hkvDhwVolumeFormula: LawParam<{ readonly effort: number; readonly coldWaterC: number }, 'periodStart'>`, `hkvDhwAreaFormula: LawParam<{ readonly kwhPerM2: number }, 'periodStart'>`, `hkvDhwFactors: LawParam<{ readonly gasCalorific: number; readonly heatSupplyDivisor: number; readonly heatPump: number | null }, 'periodStart'>`, `hkvHeatingValues: LawParam<HeatingValueTable, 'periodStart'>`, `hkvRenewableExemption: LawParam<{ readonly heatPump: boolean }, 'periodStart'>` (`'hkv.exemption.renewable'`)

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/law.test.ts`: Den Import aus `'../../shared/law/heizkostenv.ts'` um
`hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvHeatingValues, hkvRenewableExemption`
ergänzen und dieselben fünf Namen in das Objekt `modules` des Tests „jede Konstante vom Typ LawParam in
shared/law/ steht in LAW_PARAMS“ aufnehmen. Ans Dateiende:

```ts
// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 4.3, 8.3) ----------

test('Stichtag: die Zahlenwertgleichungen des § 9 Abs. 2 gelten 2015 wie 2030', () => {
  for (const y of [2015, 2021, 2025, 2030]) {
    const log = createLawLog()
    assert.deepEqual(law(hkvDhwVolumeFormula, year(y), log), { effort: 2.5, coldWaterC: 10 })
    assert.deepEqual(law(hkvDhwAreaFormula, year(y), log), { kwhPerM2: 32 })
  }
})

test('Stichtag hkv.dhw.factors: 0,30 für die monovalente Wärmepumpe erst für Zeiträume ab 01.10.2024', () => {
  const log = createLawLog()
  const vorher = { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: null }
  const nachher = { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: 0.3 }
  assert.deepEqual(law(hkvDhwFactors, year(2024), log), vorher)
  assert.deepEqual(law(hkvDhwFactors, { period: { from: '2024-09-01', to: '2025-08-31' } }, log), vorher)
  assert.deepEqual(law(hkvDhwFactors, { period: { from: '2024-10-01', to: '2025-09-30' } }, log), nachher)
  assert.deepEqual(law(hkvDhwFactors, year(2025), log), nachher)
  assert.deepEqual(log.values.map((v) => v.text), [
    'Erdgas nach Brennwert · 1,11; Wärmelieferung ÷ 1,15',
    'Erdgas nach Brennwert · 1,11; Wärmelieferung ÷ 1,15; monovalente Wärmepumpe · 0,30',
  ])
})

test('Stichtag hkv.heating-values: Hackschnitzel bis 30.11.2021 650 kWh/SRm, ab 01.12.2021 4 kWh/kg, und B ohne Schüttraummeter', () => {
  const alt = law(hkvHeatingValues, year(2021), createLawLog())
  assert.deepEqual(alt.values.woodChips, { kwh: 650, per: 'srm' })
  assert.deepEqual(alt.units, ['l', 'm3', 'kg', 'srm'])
  const neu = law(hkvHeatingValues, { period: { from: '2021-12-01', to: '2022-11-30' } }, createLawLog())
  assert.deepEqual(neu.values.woodChips, { kwh: 4, per: 'kg' })
  assert.deepEqual(neu.units, ['l', 'm3', 'kg'])
  // Die übrigen Zeilen sind in beiden Fassungen gleich.
  const rest = (t: typeof alt) => ['heatingOilEL', 'heavyFuelOil', 'naturalGasH', 'naturalGasL', 'lpg', 'coke', 'lignite', 'hardCoal', 'firewood', 'woodPellets'].map((g) => t.values[g])
  assert.deepEqual(rest(alt), rest(neu))
  assert.deepEqual(rest(neu), [
    { kwh: 10, per: 'l' }, { kwh: 10.9, per: 'l' }, { kwh: 10, per: 'm3' }, { kwh: 9, per: 'm3' }, { kwh: 13, per: 'kg' },
    { kwh: 8, per: 'kg' }, { kwh: 5.5, per: 'kg' }, { kwh: 8, per: 'kg' }, { kwh: 4.1, per: 'kg' }, { kwh: 5, per: 'kg' },
  ])
})

test('Stichtag hkv.exemption.renewable: Wärmepumpen bis 30.09.2024 in der Ausnahme des § 11 Abs. 1 Nr. 3 Buchst. a, danach nicht (Abweichung 9)', () => {
  const log = createLawLog()
  assert.deepEqual(law(hkvRenewableExemption, year(2024), log), { heatPump: true })
  assert.deepEqual(law(hkvRenewableExemption, { period: { from: '2024-09-01', to: '2025-08-31' } }, log), { heatPump: true })
  assert.deepEqual(law(hkvRenewableExemption, { period: { from: '2024-10-01', to: '2025-09-30' } }, log), { heatPump: false })
  assert.deepEqual(law(hkvRenewableExemption, year(2025), log), { heatPump: false })
  assert.match(hkvRenewableExemption.describe({ heatPump: true }), /Wärmepumpen.*in der Fassung bis 30\.09\.2024/)
  assert.doesNotMatch(hkvRenewableExemption.describe({ heatPump: false }), /Wärmepumpe/)
})
```

(b) `server/test/law-history.test.ts`: in `SHIPPED` hinter den Zeilen von PR 10 anhängen:

```ts
  // 0.11.0 (Heizung PR 11)
  'hkv.dhw.volume-formula|||{"effort":2.5,"coldWaterC":10}',
  'hkv.dhw.area-formula|||{"kwhPerM2":32}',
  'hkv.dhw.factors||2024-09-30|{"gasCalorific":1.11,"heatSupplyDivisor":1.15,"heatPump":null}',
  'hkv.dhw.factors|2024-10-01||{"gasCalorific":1.11,"heatSupplyDivisor":1.15,"heatPump":0.3}',
  'hkv.heating-values||2021-11-30|{"units":["l","m3","kg","srm"],"values":{"heatingOilEL":{"kwh":10,"per":"l"},"heavyFuelOil":{"kwh":10.9,"per":"l"},"naturalGasH":{"kwh":10,"per":"m3"},"naturalGasL":{"kwh":9,"per":"m3"},"lpg":{"kwh":13,"per":"kg"},"coke":{"kwh":8,"per":"kg"},"lignite":{"kwh":5.5,"per":"kg"},"hardCoal":{"kwh":8,"per":"kg"},"firewood":{"kwh":4.1,"per":"kg"},"woodPellets":{"kwh":5,"per":"kg"},"woodChips":{"kwh":650,"per":"srm"}}}',
  'hkv.heating-values|2021-12-01||{"units":["l","m3","kg"],"values":{"heatingOilEL":{"kwh":10,"per":"l"},"heavyFuelOil":{"kwh":10.9,"per":"l"},"naturalGasH":{"kwh":10,"per":"m3"},"naturalGasL":{"kwh":9,"per":"m3"},"lpg":{"kwh":13,"per":"kg"},"coke":{"kwh":8,"per":"kg"},"lignite":{"kwh":5.5,"per":"kg"},"hardCoal":{"kwh":8,"per":"kg"},"firewood":{"kwh":4.1,"per":"kg"},"woodPellets":{"kwh":5,"per":"kg"},"woodChips":{"kwh":4,"per":"kg"}}}',
  'hkv.exemption.renewable||2024-09-30|{"heatPump":true}',
  'hkv.exemption.renewable|2024-10-01||{"heatPump":false}',
```

(c) `server/test/glossary.test.ts` ans Dateiende (der Test von PR 6 zu `hotWaterShare` bleibt und muss
grün bleiben; er prüft das Kürzungsbeispiel):

```ts
test('Warmwasseranteil (Heizung PR 11): Beispiel aus dem Entwurf 8.3 nachgerechnet, beide Lesarten zu Q gleichwertig', () => {
  const e = GLOSSARY.hotWaterShare.example
  assert.match(e, /Q = 2,5 · 120 · \(60 − 10\) = 15\.000 kWh/)
  assert.match(e, /mal 1,11 = 16\.650 kWh, Anteil 27,75 %/)
  assert.match(e, /32 · 200 = 6\.400 kWh, mal 1,11 = 7\.104 kWh, Anteil 11,84 %/)
  assert.match(e, /9\.000 \/ 60\.000 = 15,00 %/)
  assert.match(e, /9\.000 · 1,11 \/ 60\.000 = 16,65 %/)
  assert.match(e, /um 15 % kürzen, also um 150 €/)
  assert.match(GLOSSARY.hotWaterShare.short, /Heizwert laut Rechnung/)
  assert.equal(GLOSSARY.hotWaterShare.norm, '§ 9 Abs. 2, 3 HeizkostenV; BGH VIII ZR 151/20')
})
```

PR 6 hielt `norm` als `'§ 9 Abs. 2 HeizkostenV; BGH VIII ZR 151/20'` fest. In dessen Test die Zeile
`assert.equal(GLOSSARY.hotWaterShare.norm, '§ 9 Abs. 2 HeizkostenV; BGH VIII ZR 151/20')` ersetzen durch
`assert.equal(GLOSSARY.hotWaterShare.norm, '§ 9 Abs. 2, 3 HeizkostenV; BGH VIII ZR 151/20')` (der
Eintrag nennt jetzt auch Abs. 3); die Musterzeile zum Kürzungsbetrag bleibt, wie sie ist.

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL; `law.test.ts` mit „does not provide an export named 'hkvDhwAreaFormula'“.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter dem Typ `HeatingPeriodData` (PR 4) einfügen:

```ts
// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 8.3, #211) ----------

// Die Zeile der Heizwerttabelle des § 9 Abs. 3 HeizkostenV, nach der ein Brennstoff ohne Heizwert auf
// der Rechnung hilfsweise bewertet wird. Die Tabelle unterscheidet feiner als der Energieträger der
// Anlage (Erdgas H oder L, leichtes oder schweres Heizöl, drei Kohlen, Brennholz oder Hackschnitzel);
// deshalb wählt der Vermieter die Zeile an der Lieferung.
export type FuelGrade =
  | 'heatingOilEL' | 'heavyFuelOil' | 'naturalGasH' | 'naturalGasL' | 'lpg' | 'coke' | 'lignite' | 'hardCoal'
  | 'firewood' | 'woodPellets' | 'woodChips'
// Erzeugt die Anlage die Wärme allein (ein Kessel, eine Wärmepumpe, Fernwärme) oder zusammen mit einem
// zweiten Erzeuger (Solaranlage, Heizstab, zweiter Kessel)? § 9 Abs. 1 Satz 5 und Abs. 2 Satz 6 Nr. 3
// HeizkostenV („monovalente Wärmepumpe“). `null` heißt: nicht beantwortet.
export type HeatGeneration = 'single' | 'mixed'
// Die Einheit eines Heizwerts und einer Brennstoffmenge im Sinne des § 9 Abs. 3.
export type HeatingValueUnit = 'l' | 'm3' | 'kg' | 'srm'
export type HeatingValueRow = { readonly kwh: number; readonly per: HeatingValueUnit }
// Die Heizwerttabelle einer Fassung: die Einheiten, in denen § 9 Abs. 3 Satz 1 den
// Brennstoffverbrauch bestimmt, und je Zeile Heizwert und Einheit. Schlüssel sind `FuelGrade`.
export type HeatingValueTable = {
  readonly units: readonly HeatingValueUnit[]
  readonly values: { readonly [grade: string]: HeatingValueRow }
}
```

- [ ] **Step 4: Tabellenzeilen (`shared/fuelGrades.ts`, neu)**

```ts
// Die Zeilen der Heizwerttabelle des § 9 Abs. 3 HeizkostenV (Heizung PR 11), für Server und
// Oberfläche. Die Heizwerte selbst stehen nur im Rechtsregister (`hkvHeatingValues` in
// shared/law/heizkostenv.ts); hier stehen nur Namen und Zuordnungen.
import type { FuelGrade, HeatingEnergy, HeatingValueUnit } from './types.ts'

export const FUEL_GRADES: readonly FuelGrade[] = [
  'heatingOilEL', 'heavyFuelOil', 'naturalGasH', 'naturalGasL', 'lpg', 'coke', 'lignite', 'hardCoal', 'firewood', 'woodPellets', 'woodChips',
]

// Die Zeilen im Wortlaut der Fassung seit 01.12.2021.
export const FUEL_GRADE_LABELS: Record<FuelGrade, string> = {
  heatingOilEL: 'Leichtes Heizöl extra leichtflüssig',
  heavyFuelOil: 'Schweres Heizöl',
  naturalGasH: 'Erdgas H',
  naturalGasL: 'Erdgas L',
  lpg: 'Flüssiggas',
  coke: 'Koks',
  lignite: 'Braunkohle',
  hardCoal: 'Steinkohle',
  firewood: 'Brennholz (lufttrocken)',
  woodPellets: 'Holzpellets',
  woodChips: 'Holzhackschnitzel (lufttrocken)',
}

// Anlagen mit Heizkesseln im Sinne des § 9 Abs. 1 Satz 2 und Abs. 3 HeizkostenV. Nur für sie gilt die
// Tabelle hilfsweise (Entwurf R-A13). Fernwärme, Wärmepumpe und Strom rechnen in Kilowattstunden;
// „Sonstiges“ ist unbekannt (Abweichung 7 des Plans PR 11).
export const BOILER_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'pellets', 'wood', 'coal']
export const isBoiler = (energy: HeatingEnergy): boolean => BOILER_ENERGIES.includes(energy)

// Welche Zeilen zu welchem Energieträger der Anlage passen.
export const GRADES_BY_ENERGY: Readonly<Record<HeatingEnergy, readonly FuelGrade[]>> = {
  gas: ['naturalGasH', 'naturalGasL'],
  oil: ['heatingOilEL', 'heavyFuelOil'],
  lpg: ['lpg'],
  pellets: ['woodPellets'],
  wood: ['firewood', 'woodChips'],
  coal: ['coke', 'lignite', 'hardCoal'],
  districtHeating: [],
  heatPump: [],
  electric: [],
  other: [],
}

export const HEATING_VALUE_UNIT_TEXT: Record<HeatingValueUnit, string> = { l: 'Liter', m3: 'Kubikmeter', kg: 'Kilogramm', srm: 'Schüttraummeter' }
```

- [ ] **Step 5: Parameter (`shared/law/heizkostenv.ts`)**

Den Typimport aus `'../types.ts'` um `HeatingValueTable` ergänzen (fehlt er, als
`import type { HeatingValueTable } from '../types.ts'` anlegen). Ans Dateiende:

```ts
// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 4.3, 8.3) ----------

const URL_9 = 'https://www.gesetze-im-internet.de/heizkostenv/__9.html'
// Zahlen deutsch geschrieben, mit so vielen Nachkommastellen, wie das Gesetz sie nennt.
const de = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 1) })

// § 9 Abs. 2 Satz 2 und 3: Kann die Wärme für das Warmwasser nur mit unzumutbar hohem Aufwand gemessen
// werden, Q = 2,5 · V · (t_w − 10) in kWh je Jahr, V gemessen in m³, t_w gemessen oder geschätzt in °C.
// Seit der Bekanntmachung vom 05.10.2009 unverändert (2021 nur „Zahlenwertgleichung“ statt
// „Gleichung“).
export const hkvDhwVolumeFormula: LawParam<{ readonly effort: number; readonly coldWaterC: number }, 'periodStart'> = {
  id: 'hkv.dhw.volume-formula',
  title: 'Wärme für Warmwasser aus dem gemessenen Volumen',
  norm: '§ 9 Abs. 2 Satz 2 und 3 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { effort: 2.5, coldWaterC: 10 }, source: checked('§ 9 Abs. 2 Satz 2 und 3 HeizkostenV', URL_9), enacted: ENACTED }],
  describe: (v) => `Q = ${de(v.effort)} · V · (t_w − ${de(v.coldWaterC)})`,
}

// § 9 Abs. 2 Satz 4 und 5: Können weder die Wärme noch das Volumen gemessen werden, Q = 32 · A in kWh je
// Jahr, A die mit Warmwasser versorgte Wohn- oder Nutzfläche in m².
export const hkvDhwAreaFormula: LawParam<{ readonly kwhPerM2: number }, 'periodStart'> = {
  id: 'hkv.dhw.area-formula',
  title: 'Wärme für Warmwasser aus der Wohnfläche',
  norm: '§ 9 Abs. 2 Satz 4 und 5 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { kwhPerM2: 32 }, source: checked('§ 9 Abs. 2 Satz 4 und 5 HeizkostenV', URL_9), enacted: ENACTED }],
  describe: (v) => `Q = ${de(v.kwhPerM2)} · A`,
}

// § 9 Abs. 2 Satz 6: nur für die nach den Zahlenwertgleichungen bestimmte Wärme, nie für gemessene
// (Entwurf 8.3, G-B1). Nr. 3 (monovalente Wärmepumpe, 0,30) kam mit Art. 3 G v. 16.10.2023 und gilt
// seit 01.10.2024; davor `null` (Abweichung 1 des Plans PR 11). Die Zahl 0,30 rechnet auf den Strom um
// (BT-Drs. 20/7619: Jahresarbeitszahl 2,7, Nutzungsgrad 0,8; Entwurf 8.3, F1).
export const hkvDhwFactors: LawParam<{ readonly gasCalorific: number; readonly heatSupplyDivisor: number; readonly heatPump: number | null }, 'periodStart'> = {
  id: 'hkv.dhw.factors',
  title: 'Umrechnung der Formelwerte für Warmwasser',
  norm: '§ 9 Abs. 2 Satz 6 HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2024-09-30',
      value: { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: null },
      source: {
        rank: 'law', cite: '§ 9 Abs. 2 Satz 6 HeizkostenV in der Fassung bis 30.09.2024 (Wortlaut über buzer.de)',
        url: 'https://www.buzer.de/gesetz/3769/al206558-0.htm', retrieved: '2026-10-05', checked: 'checked',
      },
      enacted: 'HeizkostenV i. d. F. der Bekanntmachung vom 05.10.2009 (BGBl. I S. 3250), zuletzt geändert durch VO v. 24.11.2021 (BGBl. I S. 4964)',
    },
    {
      validFrom: '2024-10-01',
      value: { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: 0.3 },
      source: checked('§ 9 Abs. 2 Satz 6 Nr. 1 bis 3 HeizkostenV', URL_9),
      enacted: ENACTED,
    },
  ],
  describe: (v) =>
    `Erdgas nach Brennwert · ${de(v.gasCalorific, 2)}; Wärmelieferung ÷ ${de(v.heatSupplyDivisor, 2)}` +
    (v.heatPump !== null ? `; monovalente Wärmepumpe · ${de(v.heatPump, 2)}` : ''),
}

// § 9 Abs. 3: Heizwerte, „hilfsweise“, wenn die Rechnung keinen nennt, und nur „bei Anlagen mit
// Heizkesseln“ (Entwurf R-A13). Die Fassung ab 01.12.2021 (VO v. 24.11.2021, BGBl. I S. 4964, Art. 1
// Nr. 5 Buchst. c) hat Satz 1 und Satz 2 Nr. 2 neu gefasst: B in Litern, Kubikmetern oder Kilogramm,
// Hackschnitzel 4 kWh/kg. Die alte Tabelle (650 kWh/SRm) stand in der alten Nummer 2 und ist mit ihr
// entfallen, auch wenn gesetze-im-internet.de sie weiter abdruckt (Abweichung 2 des Plans PR 11).
const OLD_TABLE: HeatingValueTable = {
  units: ['l', 'm3', 'kg', 'srm'],
  values: {
    heatingOilEL: { kwh: 10, per: 'l' },
    heavyFuelOil: { kwh: 10.9, per: 'l' },
    naturalGasH: { kwh: 10, per: 'm3' },
    naturalGasL: { kwh: 9, per: 'm3' },
    lpg: { kwh: 13, per: 'kg' },
    coke: { kwh: 8, per: 'kg' },
    lignite: { kwh: 5.5, per: 'kg' },
    hardCoal: { kwh: 8, per: 'kg' },
    firewood: { kwh: 4.1, per: 'kg' },
    woodPellets: { kwh: 5, per: 'kg' },
    woodChips: { kwh: 650, per: 'srm' },
  },
}
const TABLE_2021: HeatingValueTable = {
  units: ['l', 'm3', 'kg'],
  values: { ...OLD_TABLE.values, woodChips: { kwh: 4, per: 'kg' } },
}
export const hkvHeatingValues: LawParam<HeatingValueTable, 'periodStart'> = {
  id: 'hkv.heating-values',
  title: 'Heizwerte, wenn die Rechnung keinen nennt',
  norm: '§ 9 Abs. 3 HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2021-11-30',
      value: OLD_TABLE,
      source: {
        rank: 'law', cite: '§ 9 Abs. 3 Satz 1 und 2 HeizkostenV in der Fassung bis 30.11.2021 (Wortlaut über buzer.de)',
        url: 'https://www.buzer.de/gesetz/3769/al162401-0.htm', retrieved: '2026-10-05', checked: 'checked',
      },
      enacted: 'HeizkostenV i. d. F. der Bekanntmachung vom 05.10.2009 (BGBl. I S. 3250)',
    },
    {
      validFrom: '2021-12-01',
      value: TABLE_2021,
      source: checked('§ 9 Abs. 3 Satz 1 bis 5 HeizkostenV; Änderungsbefehl Art. 1 Nr. 5 Buchst. c VO v. 24.11.2021 (BGBl. I S. 4964)', URL_9),
      enacted: ENACTED,
    },
  ],
  describe: (v) =>
    `Heizwerte für ${Object.keys(v.values).length} Brennstoffe; Brennstoffverbrauch in ${v.units.map((u) => ({ l: 'Litern', m3: 'Kubikmetern', kg: 'Kilogramm', srm: 'Schüttraummetern' })[u]).join(', ')}`,
}

// § 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV (Heizung PR 11, Abweichung 9; Prüfbericht vom 05.10.2026, A3):
// Ausgenommen sind Räume in Gebäuden, die überwiegend mit Wärme aus Anlagen zur Rückgewinnung von Wärme
// oder aus Solaranlagen versorgt werden. Bis 30.09.2024 stand dort auch „aus Wärmepumpen- … anlagen“;
// Art. 3 G v. 16.10.2023 (BGBl. 2023 I Nr. 280) hat die Wärmepumpe gestrichen und in § 12 Abs. 3 neu
// geregelt. PR 11 fragt den Parameter bei Wärmepumpen, PR 14 für die Ausnahme `renewable`.
const URL_11 = 'https://www.gesetze-im-internet.de/heizkostenv/__11.html'
export const hkvRenewableExemption: LawParam<{ readonly heatPump: boolean }, 'periodStart'> = {
  id: 'hkv.exemption.renewable',
  title: 'Ausnahme für Gebäude mit Wärme aus Rückgewinnung, Solaranlagen oder Wärmepumpen',
  norm: '§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2024-09-30',
      value: { heatPump: true },
      source: {
        rank: 'law', cite: '§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis 30.09.2024 (Wortlaut über buzer.de)',
        url: 'https://www.buzer.de/gesetz/3769/al206559-0.htm', retrieved: '2026-10-05', checked: 'checked',
      },
      enacted: 'HeizkostenV i. d. F. der Bekanntmachung vom 05.10.2009 (BGBl. I S. 3250), zuletzt geändert durch VO v. 24.11.2021 (BGBl. I S. 4964)',
    },
    {
      validFrom: '2024-10-01',
      value: { heatPump: false },
      source: checked('§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV', URL_11),
      enacted: ENACTED,
    },
  ],
  describe: (v) => (v.heatPump
    ? 'Wärmerückgewinnung, Wärmepumpen oder Solaranlagen (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis 30.09.2024)'
    : 'Wärmerückgewinnung oder Solaranlagen (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV)'),
}
```

`TABLE_2021.values` übernimmt die zehn unveränderten Zeilen mit Spread; die Reihenfolge der Schlüssel
bleibt dabei die von `OLD_TABLE` (JavaScript ersetzt den Wert von `woodChips` an seiner Stelle), so dass
`JSON.stringify` die Zeile in `law-history.test.ts` genau trifft.

- [ ] **Step 6: Parameterliste (`shared/law/params.ts`)**

Den Import aus `'./heizkostenv.ts'` um `hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula,
hkvHeatingValues, hkvRenewableExemption` ergänzen und dieselben fünf Namen ans Ende von `LAW_PARAMS`
anhängen.

- [ ] **Step 7: Lexikon (`shared/glossary.ts`)**

Den Import aus `'./law/heizkostenv.ts'` um `hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula`
ergänzen. Unter `const CUT = …` (PR 1):

```ts
// Warmwasseranteil (Heizung PR 11): das Beispiel aus dem Entwurf 8.3, gerechnet mit den Werten des
// Registers. Die Mengen des Hauses sind Beispielzahlen und keine Rechtswerte.
const DHW_VOLUME = valueAt(hkvDhwVolumeFormula, LAW_AS_OF)
const DHW_AREA = valueAt(hkvDhwAreaFormula, LAW_AS_OF)
const DHW_FACTORS = valueAt(hkvDhwFactors, LAW_AS_OF)
const dhwDe = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const dhwPct = (part: number, whole: number) => `${dhwDe((part / whole) * 100, 2)} %`
const DHW_EXAMPLE = /* Beispiel */ { areaM2: 200, volumeM3: 120, tempC: 60, gasKwh: 60000, measuredKwh: 9000, shareCents: 100000 }
const DHW_Q_VOLUME = DHW_VOLUME.effort * DHW_EXAMPLE.volumeM3 * (DHW_EXAMPLE.tempC - DHW_VOLUME.coldWaterC)
const DHW_Q_AREA = DHW_AREA.kwhPerM2 * DHW_EXAMPLE.areaM2
```

Den Eintrag `hotWaterShare` (PR 6) ganz ersetzen durch:

```ts
  hotWaterShare: {
    title: 'Warmwasseranteil',
    short:
      'Bereitet die Heizung auch das Warmwasser, wird ein Teil ihrer Kosten dem Warmwasser zugerechnet. Die Wärme dafür ist mit einem Wärmezähler zu messen. ' +
      'Nur wenn das unzumutbar aufwendig wäre, darf sie aus dem gemessenen Warmwasser berechnet werden, und nur wenn auch das nicht gemessen werden kann, aus der Wohnfläche. ' +
      'Wird Brennstoff in Litern, Kilogramm oder Kubikmetern abgerechnet, gilt der Heizwert laut Rechnung; die Werte der Heizkostenverordnung nur, wenn die Rechnung keinen nennt.',
    example:
      `Ein Haus mit ${dhwDe(DHW_EXAMPLE.areaM2)} m² heizt mit Erdgas, abgerechnet nach Brennwert: ${dhwDe(DHW_EXAMPLE.gasKwh)} kWh. Verbraucht wurden ${dhwDe(DHW_EXAMPLE.volumeM3)} m³ Warmwasser zu ${dhwDe(DHW_EXAMPLE.tempC)} °C. ` +
      `Aus dem Volumen: Q = ${dhwDe(DHW_VOLUME.effort, 1)} · ${dhwDe(DHW_EXAMPLE.volumeM3)} · (${dhwDe(DHW_EXAMPLE.tempC)} − ${dhwDe(DHW_VOLUME.coldWaterC)}) = ${dhwDe(DHW_Q_VOLUME)} kWh, ` +
      `wegen der Abrechnung nach Brennwert mal ${dhwDe(DHW_FACTORS.gasCalorific, 2)} = ${dhwDe(DHW_Q_VOLUME * DHW_FACTORS.gasCalorific)} kWh, Anteil ${dhwPct(DHW_Q_VOLUME * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}. ` +
      `Aus der Fläche: ${dhwDe(DHW_AREA.kwhPerM2)} · ${dhwDe(DHW_EXAMPLE.areaM2)} = ${dhwDe(DHW_Q_AREA)} kWh, mal ${dhwDe(DHW_FACTORS.gasCalorific, 2)} = ${dhwDe(DHW_Q_AREA * DHW_FACTORS.gasCalorific)} kWh, Anteil ${dhwPct(DHW_Q_AREA * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}. ` +
      `Mit einem Wärmezähler gemessen ${dhwDe(DHW_EXAMPLE.measuredKwh)} kWh: Nach dem Wortlaut gilt der Faktor nur für die Formeln, also ${dhwDe(DHW_EXAMPLE.measuredKwh)} / ${dhwDe(DHW_EXAMPLE.gasKwh)} = ${dhwPct(DHW_EXAMPLE.measuredKwh, DHW_EXAMPLE.gasKwh)}; ` +
      `wer die gemessene Wärme auf den Heizwert des Gases bezieht, rechnet ${dhwDe(DHW_EXAMPLE.measuredKwh)} · ${dhwDe(DHW_FACTORS.gasCalorific, 2)} / ${dhwDe(DHW_EXAMPLE.gasKwh)} = ${dhwPct(DHW_EXAMPLE.measuredKwh * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}. ` +
      'Beide Lesarten werden vertreten; Mietfuchs rechnet nach dem Wortlaut, und die technische Regel dazu (VDI 2077) ist noch nicht ausgewertet. ' +
      `Wird ohne zulässigen Grund nach einer Formel abgerechnet, darf ein Mieter mit ${dhwDe(DHW_EXAMPLE.shareCents / 100)} € Heiz- und Warmwasserkosten seinen Anteil um ${CUT} % kürzen, also um ${dhwDe((DHW_EXAMPLE.shareCents / 100) * CUT / 100)} €.`,
    norm: '§ 9 Abs. 2, 3 HeizkostenV; BGH VIII ZR 151/20',
    needed:
      'Wenn Ihre Heizung auch das Warmwasser bereitet. Rechnet ein Messdienst ab, tragen Sie auf der Seite Heizkosten ein, wie er die Wärme für das Warmwasser bestimmt hat. ' +
      'Rechnen Sie selbst ab, tragen Sie dort den gemessenen Wert ein oder, wenn kein Wärmezähler da ist, das Warmwasser in m³ und seine Temperatur. ' +
      'Ist die Heizperiode kürzer als ein Jahr, kürzt Mietfuchs den Jahreswert der Flächenformel nach Tagen, so wie die Verordnung Warmwasserkosten beim Nutzerwechsel zeitanteilig teilt (§ 9b Abs. 2 HeizkostenV).',
  },
```

Der Test von PR 6 prüft `/1\.000 €.*um 15 % kürzen, also um 150 €/s`; das trifft der neue Satz am Ende.
`law-literals.test.ts` findet keine Rechtszahl als Literal: Alle Prozentangaben laufen über `${…}`.

- [ ] **Step 8: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Alle Tests und Commit**

Run: `npm test`
Expected: PASS, Golden unverändert (kein Parameter wird von einer Abrechnung abgefragt).

```bash
git add shared/types.ts shared/fuelGrades.ts shared/law/heizkostenv.ts shared/law/params.ts shared/glossary.ts server/test/law.test.ts server/test/law-history.test.ts server/test/glossary.test.ts
git commit -m "Rechtsregister: Formeln, Faktoren und Heizwerte des § 9 HeizkostenV

Zwei Zahlenwertgleichungen, die Faktoren nur für Formelwerte (0,30 der Wärmepumpe erst für
Zeiträume ab 01.10.2024) und die Heizwerttabelle in zwei Fassungen: Hackschnitzel bis 30.11.2021
650 kWh/SRm, seither 4 kWh/kg. Dazu die Ausnahme des § 11 Abs. 1 Nr. 3 Buchst. a, bis 30.09.2024
mit Wärmepumpen. Lexikon nennt beide Lesarten zur gemessenen Wärme.

Refs #99
Refs #211"
```

---

### Task 2: Datenmodell: Tabellenzeile an der Lieferung, Erzeuger an der Anlage

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/fuel.ts`, `server/src/db/heating.ts`, `server/src/snapshot.ts`
- Create (erzeugt): `server/drizzle/0028_warmwasser.sql`, `server/drizzle/0029_warmwasser_bedingungen.sql`, `server/drizzle/meta/*`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `server/test/db-warmwasser.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1 `FuelGrade`, `HeatGeneration`, `FUEL_GRADES`, `GRADES_BY_ENERGY`, `FUEL_GRADE_LABELS`; PR 4 `mergeHeatingPlant`, `emptyHeatingPlant`, `plantRow`, `createHeatingPlant`, `updateHeatingPlant`; PR 7 `mergeDelivery`, `emptyDelivery`, `guardDelivery(db, plant, before, after)`, `PlantFacts`, `createDelivery(db, id, plantId, body)`, `updateDelivery(db, id, body)`.
- Produces:
  - `FuelDelivery.fuelGrade: FuelGrade | null`, `HeatingPlant.heatGeneration: HeatGeneration | null`
  - schema.ts: `FUEL_GRADE_VALUES = exactly<FuelGrade>()([...])`, `HEAT_GENERATIONS = exactly<HeatGeneration>()(['single', 'mixed'] as const)`, Spalten `fuelDeliveries.fuelGrade` (`fuel_grade`), `heatingPlants.heatGeneration` (`heat_generation`)
  - `SnapshotHeatingPlant` pickt zusätzlich `'heatGeneration'` (optional); `SnapshotFuelDelivery` zusätzlich `'invoiceDate' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'`; `SnapshotHeatingPeriodRow` zusätzlich `'dhwVolumeM3' | 'dhwTempC'` (optional) — alles, was dhw.ts liest (Prüfbericht B.1, Zeile B6)

`createDelivery`, `updateDelivery` und `guardDelivery` (db/fuel.ts) sind die Namen von PR 7 (PR 10 ruft
`createDelivery(db, 'd1', 'hp', …)` so auf); `updateHeatingPlant` (db/heating.ts) der von PR 4.

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/schema.test.ts`: Der Test, der `shared/types.ts` gegen das Schema hält (PR 4), deckt
neue Felder ab, sobald die Typen sie haben; zusätzlich ans Dateiende:

```ts
test('Heizung PR 11: Tabellenzeile an der Lieferung, Erzeuger an der Anlage, beide nur mit bekannten Werten', async () => {
  const { connection, close } = await openMigrated()
  try {
    connection.exec("INSERT INTO properties (id, name) VALUES ('objekt-1', 'Haus')")
    connection.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'oil')")
    assert.equal(rejects(connection, "UPDATE heating_plants SET heat_generation = 'single'"), null)
    assert.equal(rejects(connection, "UPDATE heating_plants SET heat_generation = NULL"), null)
    assert.ok(rejects(connection, "UPDATE heating_plants SET heat_generation = 'bivalent'"), 'unbekannter Erzeuger')
    connection.exec("INSERT INTO fuel_deliveries (id, plant_id, label) VALUES ('d1', 'hp1', 'Öl')")
    assert.equal(rejects(connection, "UPDATE fuel_deliveries SET fuel_grade = 'heatingOilEL'"), null)
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET fuel_grade = 'diesel'"), 'unbekannte Zeile')
  } finally {
    close()
  }
})
```

`openMigrated` und `rejects` sind die Helfer, die PR 4 in schema.test.ts für die Bedingungen angelegt
hat (Plan PR 4, Task 1); fehlen Spalten mit Vorgabe in `fuel_deliveries` (PR 7), ergänzt das
`INSERT` sie mit deren Vorgaben, wie es die Tests von PR 7 dort tun.

Dazu, ebenfalls in schema.test.ts (Import `type SnapshotFuelDelivery, type SnapshotHeatingPeriodRow,
type SnapshotHeatingPlant` aus `'../src/snapshot.ts'`), ein Test, der beim Übersetzen prüft, dass der
Schnappschuss führt, was dhw.ts liest: `Pick` mit einem Schlüssel, den der Typ nicht hat, ist ein
Typfehler, und `npm run typecheck` prüft die Tests mit.

```ts
test('Heizung PR 11: Der Schnappschuss führt, was der Warmwasseranteil liest (Prüfbericht B.1, B6)', () => {
  const lieferung = {
    invoiceDate: null, energyKwh: null, quantity: 3000, quantityUnit: 'l', gasBasis: null, heatingValue: 9.8, fuelGrade: 'heatingOilEL',
  } satisfies Pick<SnapshotFuelDelivery, 'invoiceDate' | 'energyKwh' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'>
  const zeile = { dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 } satisfies Pick<SnapshotHeatingPeriodRow, 'dhwMethod' | 'dhwVolumeM3' | 'dhwTempC'>
  const anlage = { heatGeneration: 'single' } satisfies Pick<SnapshotHeatingPlant, 'heatGeneration'>
  assert.deepEqual([lieferung.fuelGrade, zeile.dhwTempC, anlage.heatGeneration], ['heatingOilEL', 60, 'single'])
})
```

(b) `server/test/migrations.test.ts`: in der Liste der Marken je Schritt die beiden neuen Schritte
ergänzen. Die Marke ist die Prüfsumme, die der Test beim ersten Lauf in seiner Meldung nennt; sie wird
nach dem Erzeugen in Step 5 aus der Meldung übernommen, nicht geraten.

(c) Datei `server/test/db-warmwasser.test.ts`:

```ts
// Tabellenzeile an der Lieferung und Erzeuger an der Anlage in der Datenbank (Heizung PR 11,
// Abweichungen 4 und 5 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, updateDelivery } from '../src/db/fuel.ts'
import { openDatabase } from '../src/db/open.ts'
import { readFuelDeliveries, readHeatingPlants } from '../src/db/read.ts'
import { createEntity, HeatingError } from '../src/db/repository.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-warmwasser-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const heatingError = (status: 400 | 409, text: RegExp) => (err: unknown) =>
  err instanceof HeatingError && err.status === status && text.test(err.message)

async function oelheizung(opened: Opened, energy: 'oil' | 'gas' | 'districtHeating' = 'oil'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
  })
}

test('Erzeuger der Anlage: ohne Angabe null, „allein“ und „mit weiterem Erzeuger“ werden gespeichert, Unbekanntes ergibt null', async () => {
  await withDatabase(async (opened) => {
    await oelheizung(opened)
    const plant = async () => (await opened.read(readHeatingPlants)).find((p) => p.id === 'hp') ?? assert.fail('keine Anlage')
    assert.equal((await plant()).heatGeneration, null)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
    assert.equal((await plant()).heatGeneration, 'single')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'mixed' }))
    assert.equal((await plant()).heatGeneration, 'mixed')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'bivalent' }))
    assert.equal((await plant()).heatGeneration, null)
    // Ein Teilrumpf ohne das Feld lässt es stehen (repository.ts: zusammengeführt nach Anwesenheit).
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { name: 'Keller' }))
    assert.equal((await plant()).heatGeneration, 'single')
  })
})

test('Tabellenzeile an der Lieferung: nur eine Zeile, die zum Energieträger passt; leer heißt keine', async () => {
  await withDatabase(async (opened) => {
    await oelheizung(opened)
    const lieferung = { label: 'Öl Oktober', deliveredAt: '2025-10-12', quantity: 3000, quantityUnit: 'l' }
    const d = await opened.write((db) => createDelivery(db, 'o1', 'hp', { ...lieferung, fuelGrade: 'heatingOilEL' })) ?? assert.fail('keine Anlage')
    assert.equal(d.fuelGrade, 'heatingOilEL')
    await assert.rejects(
      opened.write((db) => updateDelivery(db, d.id, { fuelGrade: 'naturalGasH' })),
      heatingError(400, /Erdgas H.*passt nicht zu einer Heizung mit Heizöl.*Leichtes Heizöl extra leichtflüssig oder Schweres Heizöl/),
    )
    await opened.write((db) => updateDelivery(db, d.id, { fuelGrade: '' }))
    assert.equal((await opened.read(readFuelDeliveries)).find((x) => x.id === d.id)?.fuelGrade, null)
  })
})

test('Tabellenzeile an der Lieferung: bei Fernwärme gibt es keine, denn die Tabelle gilt nur für Heizkessel', async () => {
  await withDatabase(async (opened) => {
    await oelheizung(opened, 'districtHeating')
    await assert.rejects(
      opened.write((db) => createDelivery(db, 'f1', 'hp', { label: 'Fernwärme', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 40000, fuelGrade: 'naturalGasH' })),
      heatingError(400, /nur bei Heizkesseln/),
    )
  })
})
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/schema.test.ts test/db-warmwasser.test.ts`
Expected: FAIL; schema.test.ts mit „no such column: heat_generation“ (und beim Übersetzen mit den
fehlenden Schlüsseln im Typtest), db-warmwasser.test.ts mit `undefined` statt `null` bei
`heatGeneration`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

In `HeatingPlant` (PR 4) als letztes Feld:

```ts
  // Erzeugt die Anlage die Wärme allein oder mit einem weiteren Erzeuger? (Heizung PR 11, § 9 Abs. 1
  // Satz 5 und Abs. 2 Satz 6 Nr. 3 HeizkostenV). Nur für den Warmwasseranteil nach einer Formel gefragt.
  heatGeneration: HeatGeneration | null
```

In `FuelDelivery` (PR 7) hinter `heatingValue: number | null`:

```ts
  // Die Zeile der Heizwerttabelle (§ 9 Abs. 3 HeizkostenV), falls die Rechnung keinen Heizwert nennt
  // (Heizung PR 11). Der Heizwert laut Rechnung geht vor.
  fuelGrade: FuelGrade | null
```

- [ ] **Step 4: Erster Schritt: Spalten (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `FuelGrade, HeatGeneration` ergänzen. Hinter
`DHW_METHODS` (PR 4):

```ts
// Heizung PR 11
export const FUEL_GRADE_VALUES = exactly<FuelGrade>()(['heatingOilEL', 'heavyFuelOil', 'naturalGasH', 'naturalGasL', 'lpg', 'coke', 'lignite', 'hardCoal', 'firewood', 'woodPellets', 'woodChips'] as const)
export const HEAT_GENERATIONS = exactly<HeatGeneration>()(['single', 'mixed'] as const)
```

In `heatingPlants` als letzte Spalte (die Bedingungen der Tabelle bleiben in diesem Step, wie sie sind):

```ts
    // Ein Erzeuger oder mehrere (Heizung PR 11); null heißt: nicht beantwortet.
    heatGeneration: text('heat_generation', { enum: HEAT_GENERATIONS }),
```

In `fuelDeliveries` hinter `heatingValue: real('heating_value'),` (die Bedingungen bleiben in diesem
Step, wie sie sind):

```ts
    // Zeile der Heizwerttabelle, falls die Rechnung keinen Heizwert nennt (Heizung PR 11).
    fuelGrade: text('fuel_grade', { enum: FUEL_GRADE_VALUES }),
```

Run: `npm --prefix server run db:generate -- --name warmwasser`

Expected: eine neue Datei `server/drizzle/0028_warmwasser.sql` mit genau zwei
`ALTER TABLE … ADD` (`heating_plants.heat_generation`, `fuel_deliveries.fuel_grade`), **kein**
`__new_`. Steht ein Neubau darin, ist eine Bedingung mitgekommen: Datei, Journal-Eintrag und
Momentaufnahme löschen, Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach einer Umbenennung,
ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In den Bedingungen von `heatingPlants` ergänzen:

```ts
    oneOf('heating_plants_heat_generation_known', 'heat_generation', HEAT_GENERATIONS),
```

und in denen von `fuelDeliveries`:

```ts
    oneOf('fuel_deliveries_fuel_grade_known', 'fuel_grade', FUEL_GRADE_VALUES),
```

Run: `npm --prefix server run db:generate -- --name warmwasser_bedingungen`

Expected: `server/drizzle/0029_warmwasser_bedingungen.sql` mit dem Neubau von `heating_plants` und
`fuel_deliveries` (`__new_…`, `INSERT INTO … SELECT`, `DROP`, `RENAME`), sonst nichts. Dann die Marken
beider Schritte in `migrations.test.ts` aus der Meldung des Tests übernehmen:

Run: `npm --prefix server test -- test/migrations.test.ts`
Expected: zuerst FAIL mit den beiden neuen Prüfsummen in der Meldung; nach dem Eintragen PASS.

`oneOf` lässt `NULL` durch (Bedingung `… IS NULL OR … IN (…)`, PR 4); geprüft durch Step 1 (a).

- [ ] **Step 6: Schreiben und prüfen (`server/src/db/heating.ts`, `server/src/db/fuel.ts`)**

`server/src/db/heating.ts`: Import aus `'./schema.ts'` um `HEAT_GENERATIONS` ergänzen. In
`mergeHeatingPlant` als letztes Feld:

```ts
    heatGeneration: merged(body, 'heatGeneration', current.heatGeneration, (v) => oneOfOrUndefined(HEAT_GENERATIONS, v) ?? null),
```

In `emptyHeatingPlant` `heatGeneration: null` und in `plantRow` `heatGeneration: p.heatGeneration`
ergänzen. `readHeatingPlants` (read.ts, PR 4) liest die Zeile mit allen Spalten; liest es die Felder
einzeln, dort `heatGeneration: p.heatGeneration ?? null` ergänzen.

`server/src/db/fuel.ts`: Import aus `'./schema.ts'` um `FUEL_GRADE_VALUES`, aus
`'../../../shared/fuelGrades.ts'` `FUEL_GRADE_LABELS, GRADES_BY_ENERGY, isBoiler`. In `mergeDelivery`
hinter `heatingValue: …`:

```ts
    fuelGrade: merged(body, 'fuelGrade', current.fuelGrade, (v) => oneOfOrUndefined(FUEL_GRADE_VALUES, v) ?? null),
```

In `emptyDelivery` `fuelGrade: null` hinter `heatingValue: null`. Die Zeile, die `fuel_deliveries`
schreibt, übernimmt das Feld (schreibt PR 7 mit `...d`, ist nichts zu tun; sonst
`fuelGrade: d.fuelGrade` ergänzen). In `guardDelivery(db, plant, before, after)` (PR 7) als letzte
Prüfung:

```ts
  // Die Zeile der Heizwerttabelle (Heizung PR 11): nur bei Heizkesseln (§ 9 Abs. 3 HeizkostenV) und nur
  // eine, die zum Energieträger der Anlage passt.
  if (after.fuelGrade !== null) {
    const what = `„${after.label || 'ohne Bezeichnung'}“`
    if (!isBoiler(plant.energy)) {
      throw new HeatingError(400, `Die Tabelle der Heizwerte gilt nur bei Heizkesseln (§ 9 Abs. 3 HeizkostenV). Bei dieser Heizung zählen die Kilowattstunden laut Rechnung; lassen Sie die Tabellenzeile bei ${what} leer.`)
    }
    const fitting = GRADES_BY_ENERGY[plant.energy]
    if (!fitting.includes(after.fuelGrade)) {
      throw new HeatingError(400,
        `Die Tabellenzeile „${FUEL_GRADE_LABELS[after.fuelGrade]}“ passt nicht zu einer Heizung mit ${ENERGY_WORDS[plant.energy]}. Passend sind ${fitting.map((g) => FUEL_GRADE_LABELS[g]).join(' oder ')}.`)
    }
  }
```

`plant` ist `PlantFacts` (PR 7: `id`, `energy`, `method`). Als Konstante in fuel.ts über
`guardDelivery`:

```ts
// Der Energieträger im Satz („einer Heizung mit Heizöl“).
const ENERGY_WORDS: Record<HeatingEnergy, string> = {
  gas: 'Gas', oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Pellets', wood: 'Holz', coal: 'Kohle',
  districtHeating: 'Fernwärme', heatPump: 'Wärmepumpe', electric: 'Strom', other: 'unbekanntem Energieträger',
}
```

(`HeatingEnergy` zum Typimport aus `'../../../shared/types.ts'` ergänzen, falls nicht vorhanden.)

- [ ] **Step 7: Schnappschuss (`server/src/snapshot.ts`)**

PR 10 holt von der Lieferung nur `energyKwh` und von der Zeile der Heizperiode nur Anteil, Dämmung und
gemessene Wärme in den Schnappschuss (Prüfbericht B.1, Zeile B6). dhw.ts liest mehr; ergänzt wird alles,
was es liest:

- `SnapshotHeatingPlant`: in den optionalen Teil `Partial<Pick<HeatingPlant, …>>` von PR 10
  `'heatGeneration'` aufnehmen.
- `SnapshotFuelDelivery` (PR 7, nach PR 10 mit `'energyKwh'`): in die Liste des `Pick`
  `'invoiceDate' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'` aufnehmen
  (`deliveredAt` und `invoiceTo` pickt PR 7 schon). Steht eines davon schon darin (PR 8 nimmt
  `invoiceDate` für den Vorrat), bleibt es einmal.
- `SnapshotHeatingPeriodRow` (PR 6, PR 8, PR 10) bekommt als weiteren Teil der Schnittmenge:

```ts
  // Eingaben der Volumenformel (Heizung PR 11).
  & Partial<Pick<HeatingPeriodData, 'dhwVolumeM3' | 'dhwTempC'>>
```

`readHeatingPeriodRows` (PR 6) und `readFuelDeliveries` (PR 7) lesen ganze Zeilen; `snapshotFor`,
`heatingSnapshotFor` und `fuelSnapshotOf` (PR 5, PR 7) reichen Anlagen, Zeilen und Lieferungen als
Datensätze durch. Bildet eine dieser Stellen Felder einzeln ab, kommen die neuen dort dazu
(`heatGeneration: p.heatGeneration`, `fuelGrade: d.fuelGrade`, `quantity: d.quantity` und so fort). Der
Typtest aus Step 1 (a) hält die Liste fest.

- [ ] **Step 8: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-warmwasser.test.ts && npm run typecheck`
Expected: PASS (`db-warmwasser.test.ts`: 3 Tests; der Typtest in schema.test.ts übersetzt).

- [ ] **Step 9: Alle Tests und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle server/src/db/heating.ts server/src/db/fuel.ts server/src/db/read.ts server/src/snapshot.ts server/test/schema.test.ts server/test/migrations.test.ts server/test/db-warmwasser.test.ts
git commit -m "Heizwerttabelle an der Lieferung, Erzeuger an der Anlage

Zwei nullbare Spalten in zwei erzeugten Schritten: die Zeile der Tabelle des § 9 Abs. 3
HeizkostenV (nur bei Heizkesseln, passend zum Energieträger) und ob die Anlage die Wärme allein
erzeugt (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3). Der Schnappschuss führt alles, was der
Warmwasseranteil liest.

Refs #99
Refs #211"
```

---
### Task 3: Die Rechnung (`server/src/dhw.ts`)

Reine Funktionen ohne Datenbank und ohne Schnappschuss; sie bekommen fertige Zahlen hineingereicht. So
prüft `dhw.test.ts` jede Regel des § 9 einzeln, und die Naht zu PR 10 (Task 4) bleibt eine Zeile.

**Files:**
- Create: `server/src/dhw.ts`
- Modify: `shared/types.ts` (Typen `DhwHeatingValue`, `DhwFactorKind`, `DhwDenominator`, `DhwStatement`), `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/dhw.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1 `hkvDhwVolumeFormula`, `hkvDhwAreaFormula`, `hkvDhwFactors`, `hkvHeatingValues`, `FUEL_GRADE_LABELS`, `HEATING_VALUE_UNIT_TEXT`, `isBoiler`, `HeatingValueTable`, `HeatGeneration`, `HeatingValueUnit`, `FuelGrade`; PR 1 `law`, `LawLog`, `Period`; PR 4 `DhwMethod`, `HeatingEnergy`; PR 7 `FuelDelivery`, `GasBasis`; `SnapshotUnit` (snapshot.ts); `andList` (`shared/wording.ts`, Bestand).
- Produces:
  - `shared/types.ts`: `type DhwHeatingValue = { label: string; kwh: number; per: HeatingValueUnit; source: 'invoice' | 'table'; grade: FuelGrade | null }`, `type DhwFactorKind = 'gasCalorific' | 'heatSupply' | 'heatPump'`, `type DhwDenominator = 'fuelKwh' | 'fuelQuantity' | 'deliveredHeat' | 'electricity' | 'measuredTotalHeat'`, `type DhwStatement = { method: DhwMethod; alpha: number; heatKwh: number; formulaKwh: number | null; factor: { kind: DhwFactorKind; value: number } | null; denominator: { kind: DhwDenominator; value: number; unit: 'kWh' | HeatingValueUnit }; energyKwh: number; fuelForDhw: { quantity: number; unit: HeatingValueUnit; heatingValue: number } | null; heatingValues: DhwHeatingValue[]; estimated: boolean; steps: string[] }`
  - `server/src/dhw.ts`:
    - `DHW_PLAUSIBLE = { min: 0.05, max: 0.5 }`, `fmtShare(alpha: number): string`
    - `type EnergyDelivery = Pick<FuelDelivery, 'id' | 'label' | 'invoiceTo' | 'deliveredAt' | 'invoiceDate' | 'energyKwh' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'> & { share: number }`
    - `type GeneratorInput = { deliveries: readonly EnergyDelivery[]; stock: { unit: HeatingValueUnit; consumed: number } | null; earlier: EnergyDelivery | null }`
    - `type DhwProblem = 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'outOfRange' | 'formulaInput' | 'totalHeatMissing'` (die ersten fünf aus PR 10 `AlphaProblem`)
    - `type DhwInput = { energy: HeatingEnergy; heatGeneration: HeatGeneration | null; h: Period; method: DhwMethod; measured: { dhwKwh: number | null; totalKwh: number | null }; volumeM3: number | null; tempC: number | null; suppliedAreaM2: number; generator: GeneratorInput; fuelCoveragePermille: number | null; fuelEstimated: boolean }`
    - `type DhwOutcome = { ok: true; statement: DhwStatement } | { ok: false; code: 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis'; problem: DhwProblem; reasons: string[] }`
    - `yearShare(h: Period): { share: number; days: number; yearDays: number }`
    - `type Failure = { ok: false; reasons: string[] }`, `type Energy = { ok: true; kind: 'kwh'; kwh: number; basis: 'hs' | 'hi' | null } | { ok: true; kind: 'quantity'; kwh: number; quantity: number; unit: HeatingValueUnit; heatingValue: number; values: DhwHeatingValue[] }`
    - `formulaHeat(i: FormulaInput, log: LawLog)`, `generatorEnergyOf(energy: HeatingEnergy, h: Period, g: GeneratorInput, log: LawLog): Energy | Failure`, `dhwShareOf(i: DhwInput, log: LawLog): DhwOutcome`
    - `suppliedAreaOf(units: readonly Pick<SnapshotUnit, 'areaM2' | 'noConnection'>[]): number`
    - `deliveryDate(d)`, `deliveriesInPeriod(ds, h)`, `latestBefore(ds, h, unit)`
    - kein eigenes `andList`: dhw.ts nimmt das aus `shared/wording.ts` (eine Quelle, Prüfbericht B.1)

- [ ] **Step 1: Failing test schreiben**

Datei `server/test/dhw.test.ts`:

```ts
// Warmwasseranteil α nach § 9 HeizkostenV (Heizung PR 11, Entwurf 8.3, 12.2). Jede Zahl ist von Hand
// nachgerechnet; der Kommentar am Test nennt die Rechnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog } from '../../shared/law/register.ts'
import { dhwShareOf, suppliedAreaOf, yearShare, type DhwInput, type DhwOutcome, type EnergyDelivery } from '../src/dhw.ts'

const H2025 = { from: '2025-01-01', to: '2025-12-31' }
const delivery = (over: Partial<EnergyDelivery>): EnergyDelivery => ({
  id: 'g', label: 'Gas 2025', invoiceTo: '2025-12-31', deliveredAt: null, invoiceDate: '2026-01-15',
  energyKwh: null, quantity: null, quantityUnit: null, gasBasis: null, heatingValue: null, fuelGrade: null, share: 1, ...over,
})
const gasKwh = (kwh: number, basis: 'hs' | 'hi' | null = 'hs', over: Partial<EnergyDelivery> = {}) => delivery({ energyKwh: kwh, gasBasis: basis, ...over })
const input = (over: Partial<DhwInput> = {}): DhwInput => ({
  energy: 'gas', heatGeneration: 'single', h: H2025, method: 'heatMeter',
  measured: { dhwKwh: 9000, totalKwh: null }, volumeM3: 120, tempC: 60, suppliedAreaM2: 200,
  generator: { deliveries: [gasKwh(60000)], stock: null, earlier: null },
  fuelCoveragePermille: 1000, fuelEstimated: false,
  ...over,
})
const share = (over: Partial<DhwInput> = {}, log = createLawLog()) => {
  const o: DhwOutcome = dhwShareOf(input(over), log)
  if (!o.ok) assert.fail(`kein Anteil: ${o.code} ${o.reasons.join('; ')}`)
  return o.statement
}
const failure = (over: Partial<DhwInput>) => {
  const o = dhwShareOf(input(over), createLawLog())
  if (o.ok) assert.fail(`erwartet: kein Anteil, bekommen: ${o.statement.alpha}`)
  return o
}
const reasons = (over: Partial<DhwInput>) => failure(over).reasons.join(' | ')
const pct = (alpha: number) => Math.round(alpha * 10000) / 100
const oil = (over: Partial<EnergyDelivery> = {}) => delivery({ id: 'o1', label: 'Öl Oktober', invoiceTo: null, deliveredAt: '2025-10-12', quantity: 3000, quantityUnit: 'l', heatingValue: 9.8, fuelGrade: 'heatingOilEL', ...over })
const oilInput = (over: Partial<DhwInput> = {}, d: EnergyDelivery[] = [oil()]): Partial<DhwInput> => ({
  energy: 'oil', method: 'volumeFormula', generator: { deliveries: d, stock: { unit: 'l', consumed: 6000 }, earlier: null }, ...over,
})

test('Beispiel 8.3: gemessen 15,0 %, Volumenformel 27,75 %, Flächenformel 11,84 %; der Faktor 1,11 nur bei den Formeln (G-B1)', () => {
  // 60.000 kWh Gas nach Brennwert. Gemessen 9.000 / 60.000. Volumen: 2,5 · 120 · 50 = 15.000 · 1,11 = 16.650.
  // Fläche: 32 · 200 = 6.400 · 1,11 = 7.104.
  const gemessen = share()
  assert.equal(gemessen.alpha, 0.15)
  assert.equal(gemessen.factor, null)
  assert.equal(gemessen.heatKwh, 9000)
  assert.deepEqual(gemessen.denominator, { kind: 'fuelKwh', value: 60000, unit: 'kWh' })
  const volumen = share({ method: 'volumeFormula' })
  assert.equal(pct(volumen.alpha), 27.75)
  assert.equal(volumen.formulaKwh, 15000)
  assert.deepEqual(volumen.factor, { kind: 'gasCalorific', value: 1.11 })
  assert.equal(Math.round(volumen.heatKwh), 16650)
  assert.deepEqual(volumen.steps, [
    'Q = 2,5 · 120 m³ · (60 °C − 10 °C) = 15.000 kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)',
    'Erdgas nach Brennwert abgerechnet: 15.000 kWh · 1,11 = 16.650 kWh (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)',
    'Warmwasseranteil = 16.650 kWh / 60.000 kWh Brennstoff laut Rechnung = 27,75 %',
  ])
  assert.equal(pct(share({ method: 'areaFormula' }).alpha), 11.84)
})

test('15.1 Nr. 9: dasselbe Gas in kWh nach Brennwert 13,51 %, in m³ mit Heizwert 15,00 %; gemessen ohne Faktor', () => {
  // 6.000 m³ · 10 kWh/m³ = 60.000 kWh nach Heizwert = 66.600 kWh nach Brennwert (· 1,11).
  assert.equal(pct(share({ generator: { deliveries: [gasKwh(66600)], stock: null, earlier: null } }).alpha), 13.51)
  const m3 = { deliveries: [gasKwh(0, null, { energyKwh: null, quantity: 6000, quantityUnit: 'm3', heatingValue: 10 })], stock: null, earlier: null }
  const gemessen = share({ generator: m3 })
  assert.equal(gemessen.alpha, 0.15)
  assert.deepEqual(gemessen.fuelForDhw, { quantity: 900, unit: 'm3', heatingValue: 10 })
  assert.deepEqual(gemessen.denominator, { kind: 'fuelQuantity', value: 6000, unit: 'm3' })
  // Abgerechnet nach Heizwert in m³: kein Faktor 1,11, auch nicht bei der Formel. B = 15.000 / 10 = 1.500 m³.
  const formel = share({ method: 'volumeFormula', generator: m3 })
  assert.equal(formel.factor, null)
  assert.equal(formel.alpha, 0.25)
})

test('Wärmepumpe (F1): Volumenformel · 0,30 gegen den Strom 37,5 %; vor 10/2024 kein Faktor; mehrere Erzeuger oder ohne Antwort keine Formel', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 12000 })], stock: null, earlier: null }
  const wp = share({ energy: 'heatPump', method: 'volumeFormula', generator: strom })
  assert.equal(pct(wp.alpha), 37.5)
  assert.deepEqual(wp.factor, { kind: 'heatPump', value: 0.3 })
  assert.equal(wp.denominator.kind, 'electricity')
  assert.match(reasons({ energy: 'heatPump', method: 'volumeFormula', generator: strom, h: { from: '2024-01-01', to: '2024-12-31' } }), /keinen Faktor für die Wärmepumpe/)
  assert.match(reasons({ method: 'volumeFormula', heatGeneration: 'mixed' }), /nicht allein/)
  assert.match(reasons({ method: 'areaFormula', heatGeneration: null }), /ob die Anlage die Wärme allein erzeugt/)
})

test('Wärmepumpe mit Wärmezähler am Warmwasser (A8): ohne Gesamtwärme heat-pump-dhw-basis, mit Gesamtwärme Q / Wärme', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 12000 })], stock: null, earlier: null }
  const o = failure({ energy: 'heatPump', measured: { dhwKwh: 4500, totalKwh: null }, generator: strom })
  assert.equal(o.code, 'heating.heat-pump-dhw-basis')
  const mit = share({ energy: 'heatPump', measured: { dhwKwh: 4500, totalKwh: 36000 }, generator: strom })
  assert.equal(mit.alpha, 0.125)
  assert.deepEqual(mit.denominator, { kind: 'measuredTotalHeat', value: 36000, unit: 'kWh' })
  // Mehrere Erzeuger: gemessen nur gegen die gemessene Gesamtwärme (§ 9 Abs. 1 Satz 5).
  assert.match(reasons({ heatGeneration: 'mixed' }), /Gesamtwärme/)
  assert.equal(share({ heatGeneration: 'mixed', measured: { dhwKwh: 9000, totalKwh: 45000 } }).alpha, 0.2)
})

test('Fernwärme: Formelwert ÷ 1,15; gemessen gegen die gelieferte Wärme oder den Gesamtwärmezähler', () => {
  const fw = { deliveries: [delivery({ label: 'Fernwärme 2025', energyKwh: 40000 })], stock: null, earlier: null }
  // 6.400 / 1,15 = 5.565,22 kWh; / 40.000 = 13,91 %.
  const flaeche = share({ energy: 'districtHeating', method: 'areaFormula', generator: fw })
  assert.equal(pct(flaeche.alpha), 13.91)
  assert.deepEqual(flaeche.factor, { kind: 'heatSupply', value: 1.15 })
  assert.equal(flaeche.denominator.kind, 'deliveredHeat')
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: null }, generator: fw }).alpha, 0.15)
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: 30000 }, generator: fw }).alpha, 0.2)
})

test('Heizwert laut Rechnung vor Tabelle (R-A13): Heizöl aus dem Vorrat 25,51 % mit 9,8 kWh/l, 25,00 % mit der Tabelle; ohne beides kein Anteil', () => {
  // B = 15.000 / 9,8 = 1.530,61 l; / 6.000 l = 25,51 %. Tabelle: 15.000 / 10 = 1.500 l; 25,00 %.
  const rechnung = share(oilInput())
  assert.equal(pct(rechnung.alpha), 25.51)
  assert.deepEqual(rechnung.heatingValues, [{ label: 'Öl Oktober', kwh: 9.8, per: 'l', source: 'invoice', grade: 'heatingOilEL' }])
  assert.equal(rechnung.factor, null)
  const tabelle = share(oilInput({}, [oil({ heatingValue: null })]))
  assert.equal(tabelle.alpha, 0.25)
  assert.deepEqual(tabelle.heatingValues, [{ label: 'Öl Oktober', kwh: 10, per: 'l', source: 'table', grade: 'heatingOilEL' }])
  assert.match(reasons(oilInput({}, [oil({ heatingValue: null, fuelGrade: null })])), /„Öl Oktober“ nennt keinen Heizwert.*Zeile der Tabelle/)
  // Gemessen: B = 9.000 / 9,8 = 918,37 l; / 6.000 l = 15,31 %, ohne Faktor.
  assert.equal(pct(share(oilInput({ method: 'heatMeter' })).alpha), 15.31)
})

test('Mehrere Rechnungen: Heizwert mengengewichtet (Abweichung 6); ohne Lieferung in der Heizperiode der Heizwert der jüngsten früheren', () => {
  // (3.000 · 9,8 + 1.000 · 10,6) / 4.000 = 10,0 kWh/l; 15.000 / 10 / 6.000 = 25 %.
  assert.equal(share(oilInput({}, [oil(), oil({ id: 'o2', label: 'Öl Dezember', quantity: 1000, heatingValue: 10.6 })])).alpha, 0.25)
  const frueher = { deliveries: [], stock: { unit: 'l' as const, consumed: 6000 }, earlier: oil() }
  assert.equal(pct(share({ energy: 'oil', method: 'volumeFormula', generator: frueher }).alpha), 25.51)
  assert.match(reasons({ energy: 'oil', method: 'volumeFormula', generator: { ...frueher, earlier: null } }), /kein Heizwert bekannt/)
})

test('Flüssiggas in Litern: Die Tabelle nennt nur Kilogramm, und eine Dichte wird nicht erfunden', () => {
  const liter = { deliveries: [delivery({ label: 'Flüssiggas', quantity: 5000, quantityUnit: 'l', fuelGrade: 'lpg' })], stock: { unit: 'l' as const, consumed: 5000 }, earlier: null }
  assert.match(reasons({ energy: 'lpg', method: 'areaFormula', suppliedAreaM2: 150, generator: liter }), /nur je Kilogramm/)
  // 32 · 150 = 4.800 kWh; / 13 kWh/kg = 369,23 kg; / 2.000 kg = 18,46 %.
  const kg = { deliveries: [delivery({ label: 'Flüssiggas', quantity: 2000, quantityUnit: 'kg', fuelGrade: 'lpg' })], stock: { unit: 'kg' as const, consumed: 2000 }, earlier: null }
  assert.equal(pct(share({ energy: 'lpg', method: 'areaFormula', suppliedAreaM2: 150, generator: kg }).alpha), 18.46)
})

test('Tabelle nur bei Heizkesseln: Fernwärme ohne Kilowattstunden rechnet nicht', () => {
  const ohne = { deliveries: [delivery({ label: 'Fernwärme 2025' })], stock: null, earlier: null }
  assert.match(reasons({ energy: 'districtHeating', generator: ohne }), /„Fernwärme 2025“ nennt keine Kilowattstunden/)
})

test('Holzhackschnitzel (Abweichung 2): 2021 in Schüttraummetern mit 650 kWh/SRm, ab 12/2021 nur in Kilogramm mit 4 kWh/kg', () => {
  const srm = { deliveries: [delivery({ label: 'Hackschnitzel', quantity: 40, quantityUnit: 'srm', fuelGrade: 'woodChips' })], stock: { unit: 'srm' as const, consumed: 40 }, earlier: null }
  // 32 · 200 = 6.400 kWh; / 650 = 9,85 SRm; / 40 = 24,62 %.
  assert.equal(pct(share({ energy: 'wood', method: 'areaFormula', h: { from: '2021-01-01', to: '2021-12-31' }, generator: srm }).alpha), 24.62)
  assert.match(reasons({ energy: 'wood', method: 'areaFormula', h: { from: '2022-01-01', to: '2022-12-31' }, generator: srm }), /Litern, Kubikmetern oder Kilogramm/)
  // 6.400 / 4 = 1.600 kg; / 8.000 kg = 20 %.
  const kg = { deliveries: [delivery({ label: 'Hackschnitzel', quantity: 8000, quantityUnit: 'kg', fuelGrade: 'woodChips' })], stock: { unit: 'kg' as const, consumed: 8000 }, earlier: null }
  assert.equal(share({ energy: 'wood', method: 'areaFormula', h: { from: '2022-01-01', to: '2022-12-31' }, generator: kg }).alpha, 0.2)
})

test('Rumpf (Abweichung 3): Flächenformel nach Tagen gekürzt, Volumenformel nicht', () => {
  const rumpf = { from: '2025-01-01', to: '2025-04-30' }
  assert.deepEqual(yearShare(rumpf), { share: 120 / 365, days: 120, yearDays: 365 })
  assert.deepEqual(yearShare({ from: '2025-05-01', to: '2026-04-30' }), { share: 1, days: 365, yearDays: 365 })
  const gas = { deliveries: [gasKwh(20000)], stock: null, earlier: null }
  // 6.400 · 120 / 365 = 2.104,11 kWh · 1,11 = 2.335,56 kWh; / 20.000 = 11,68 %.
  const flaeche = share({ method: 'areaFormula', h: rumpf, generator: gas })
  assert.equal(pct(flaeche.alpha), 11.68)
  assert.ok(flaeche.steps.some((s) => /120 von 365 Tagen.*§ 9b Abs\. 2/.test(s)), flaeche.steps.join('\n'))
  // 2,5 · 40 · 50 = 5.000 · 1,11 = 5.550; / 20.000 = 27,75 %.
  assert.equal(pct(share({ method: 'volumeFormula', volumeM3: 40, h: rumpf, generator: gas }).alpha), 27.75)
})

test('Was fehlt oder nicht passt, wird gesagt, und es wird nicht gerechnet', () => {
  assert.match(reasons({ method: 'volumeFormula', volumeM3: null }), /gemessene Volumen des Warmwassers/)
  assert.match(reasons({ method: 'volumeFormula', tempC: 10 }), /nicht über der Kaltwassertemperatur von 10 °C/)
  assert.match(reasons({ method: 'areaFormula', suppliedAreaM2: 0 }), /0 m²/)
  assert.match(reasons({ method: 'volumeFormula', generator: { deliveries: [gasKwh(60000, null)], stock: null, earlier: null } }), /nach Brennwert oder nach Heizwert.*1,11/)
  const gemischt = { deliveries: [gasKwh(30000, 'hs', { id: 'a', label: 'Gas I' }), gasKwh(30000, 'hi', { id: 'b', label: 'Gas II' })], stock: null, earlier: null }
  assert.match(reasons({ generator: gemischt }), /teils nach Brennwert, teils nach Heizwert/)
  assert.match(reasons({ measured: { dhwKwh: 61000, totalKwh: null } }), /ganze Energie/)
  assert.match(reasons({ energy: 'electric', method: 'areaFormula', generator: { deliveries: [delivery({ label: 'Strom', energyKwh: 20000 })], stock: null, earlier: null } }), /Strom/)
  assert.match(reasons({ measured: { dhwKwh: null, totalKwh: null } }), /gemessene Wärme für das Warmwasser fehlt/)
})

test('Protokoll: nur die Rechtswerte, mit denen gerechnet wurde', () => {
  const gemessen = createLawLog()
  share({}, gemessen)
  assert.deepEqual(gemessen.values, [])
  const formel = createLawLog()
  share({ method: 'volumeFormula' }, formel)
  assert.deepEqual(formel.values.map((v) => v.id).sort(), ['hkv.dhw.factors', 'hkv.dhw.volume-formula'])
  const tabelle = createLawLog()
  share(oilInput({}, [oil({ heatingValue: null })]), tabelle)
  assert.ok(tabelle.values.some((v) => v.id === 'hkv.heating-values'))
})

test('Versorgte Fläche: angeschlossene Wohnungen ohne „kein Anschluss: Warmwasser“', () => {
  assert.equal(suppliedAreaOf([{ areaM2: 80 }, { areaM2: 60, noConnection: ['warmwasser'] }, { areaM2: 45, noConnection: ['kaltwasser'] }]), 125)
})

test('Aus PR 10 übernommen: Lücke in den Rechnungen, Schätzung beim Abschluss, Anteil außerhalb von 0 bis 100 %', () => {
  // PR 10 Abweichung 11: Der Anteil braucht Rechnungen über die ganze Heizperiode.
  const luecke = failure({ fuelCoveragePermille: 848.71 })
  assert.deepEqual([luecke.code, luecke.problem], ['heating.dhw-share-invalid', 'fuelGap'])
  assert.match(luecke.reasons.join(' '), /Folgerechnung.*Schätzung/)
  assert.equal(failure({ fuelCoveragePermille: null }).problem, 'fuelGap')
  // Beim Vorrat zählt die verbrauchte Menge; die Abdeckung der Rechnungen spielt dort keine Rolle.
  assert.equal(pct(share(oilInput({ fuelCoveragePermille: null })).alpha), 25.51)
  // Die Schätzung beim Abschluss trägt die kWh der fehlenden Rechnung; α beruht dann auf ihr.
  assert.equal(share({ fuelEstimated: true }).estimated, true)
  assert.equal(share().estimated, false)
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: 30000 }, fuelEstimated: true }).estimated, false, 'gegen gemessene Gesamtwärme')
  // α außerhalb von (0, 1) ist ein Widerspruch, kein Anteil.
  assert.deepEqual([failure({ measured: { dhwKwh: 0, totalKwh: null } }).problem, failure({ measured: { dhwKwh: 60000, totalKwh: null } }).problem], ['outOfRange', 'outOfRange'])
  assert.equal(failure({ measured: { dhwKwh: null, totalKwh: null } }).problem, 'noDhwHeat')
  assert.equal(failure({ generator: { deliveries: [delivery({ label: 'Gas' })], stock: null, earlier: null } }).problem, 'noFuelEnergy')
  // Die Energie des Nenners in kWh, auch bei Brennstoff als Menge: 6.000 l · 9,8 kWh/l = 58.800 kWh.
  assert.equal(share().energyKwh, 60000)
  assert.equal(Math.round(share(oilInput()).energyKwh), 58800)
})

test('Stromheizung (Abweichung 7, Prüfbericht A6): gemessen gegen den Strom laut Rechnung wie in PR 10; die Formeln rechnen nicht', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 30000 })], stock: null, earlier: null }
  // 4.500 kWh am Wärmezähler des Speichers gegen 30.000 kWh Strom: 15 %. Ein Elektrokessel setzt Strom
  // nahezu ohne Verlust in Wärme um; das ist der Fall des § 9 Abs. 1 Satz 2 („Energieverbrauch“).
  const gemessen = share({ energy: 'electric', measured: { dhwKwh: 4500, totalKwh: null }, generator: strom })
  assert.equal(gemessen.alpha, 0.15)
  assert.deepEqual(gemessen.denominator, { kind: 'electricity', value: 30000, unit: 'kWh' })
  const formel = failure({ energy: 'electric', method: 'volumeFormula', generator: strom })
  assert.equal(formel.problem, 'formulaInput')
  assert.match(formel.reasons.join(' '), /Stromheizung.*keinen Faktor.*Wärmezähler am Warmwasserspeicher/)
})
```

- [ ] **Step 2: Test ausführen, er muss scheitern**

Run: `npm --prefix server test -- test/dhw.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `server/src/dhw.ts`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter `HeatingValueTable` (Task 1):

```ts
// Ein Heizwert, mit dem der Warmwasseranteil gerechnet wurde: laut Rechnung oder hilfsweise aus der
// Tabelle des § 9 Abs. 3 HeizkostenV.
export type DhwHeatingValue = { label: string; kwh: number; per: HeatingValueUnit; source: 'invoice' | 'table'; grade: FuelGrade | null }
// Womit ein Formelwert umgerechnet wurde (§ 9 Abs. 2 Satz 6 Nr. 1 bis 3).
export type DhwFactorKind = 'gasCalorific' | 'heatSupply' | 'heatPump'
// Wogegen die Wärme für das Warmwasser gestellt wurde: Brennstoff in kWh laut Rechnung, Brennstoff als
// Menge (B = Q / Hᵢ), gelieferte Wärme (Fernwärme), Strom (Wärmepumpe mit Formel), gemessene Gesamtwärme.
export type DhwDenominator = 'fuelKwh' | 'fuelQuantity' | 'deliveredHeat' | 'electricity' | 'measuredTotalHeat'
// Der Warmwasseranteil α einer Anlage in einer Heizperiode samt Rechenweg (Entwurf 8.3, 8.8 „α mit
// Methode“). `heatKwh` ist Q, wie es in den Bruch eingeht (bei einer Formel nach dem Faktor),
// `formulaKwh` das Ergebnis der Zahlenwertgleichung davor.
export type DhwStatement = {
  method: DhwMethod
  alpha: number
  heatKwh: number
  formulaKwh: number | null
  factor: { kind: DhwFactorKind; value: number } | null
  denominator: { kind: DhwDenominator; value: number; unit: 'kWh' | HeatingValueUnit }
  // Die Energie des Nenners in kWh, auch bei Brennstoff als Menge (Menge · Heizwert); für `self.alpha`
  // (PR 10: `referenceKwh`).
  energyKwh: number
  fuelForDhw: { quantity: number; unit: HeatingValueUnit; heatingValue: number } | null
  heatingValues: DhwHeatingValue[]
  // α beruht auf der Schätzung beim Abschluss (PR 7, PR 10 Abweichung 11).
  estimated: boolean
  steps: string[]
}
```

- [ ] **Step 4: `server/src/dhw.ts` anlegen**

```ts
// Der Warmwasseranteil α nach § 9 HeizkostenV (Heizung PR 11, Entwurf 8.3, #211), als reine Funktionen.
//
// α ist der Anteil der Wärme für das Warmwasser an der Energie, die die Anlage in der Heizperiode
// verbraucht hat. Die Wärme Q wird gemessen (§ 9 Abs. 2 Satz 1) oder, nur bei unzumutbar hohem Aufwand,
// nach einer der beiden Zahlenwertgleichungen bestimmt (Satz 2 und 4). Die Faktoren des Satzes 6 gelten
// **nur für die Formelwerte** (Entwurf G-B1 abgelehnt, 15.1 Nr. 9). Wogegen Q gestellt wird, hängt am
// Erzeuger: bei Heizkesseln der Brennstoff (in kWh laut Rechnung oder als Menge mit B = Q / Hᵢ nach
// Abs. 3), bei Fernwärme die gelieferte Wärme, bei der Wärmepumpe mit Formel der Strom (der Faktor 0,30
// rechnet auf den Strom um, Entwurf 8.3, F1), bei der Stromheizung gemessen der Strom (wie PR 10,
// Abweichung 7) und gemessen bei Wärmepumpe und Mischanlage die gemessene Gesamtwärme (Abs. 1 Satz 2
// und 5, A8).
//
// Aus PR 10 übernommen (Abgleich nach der Prüfung vom 05.10.2026): Die Rechnungen müssen die Heizperiode
// ganz abdecken (`fuelGap`, PR 10 Abweichung 11), α auf der Schätzung beim Abschluss heißt `estimated`,
// und α außerhalb von (0, 1) ist `outOfRange`.
//
// Alle Rechtswerte kommen aus dem Register; diese Datei steht in `ENGINE_FILES` des Wächters
// (law-literals.test.ts). Fehlt eine Angabe, wird nicht geraten, sondern gesagt, was fehlt.
import type {
  DhwFactorKind, DhwHeatingValue, DhwMethod, DhwStatement, FuelDelivery, HeatGeneration, HeatingEnergy, HeatingValueTable, HeatingValueUnit,
} from '../../shared/types.ts'
import { law, type LawLog, type Period } from '../../shared/law/register.ts'
import { hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvHeatingValues } from '../../shared/law/heizkostenv.ts'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT, isBoiler } from '../../shared/fuelGrades.ts'
import { andList } from '../../shared/wording.ts'
import type { SnapshotUnit } from './snapshot.ts'

// Plausibilität (Entwurf 15.2 F6): keine Rechtsgrenze, nur ein Anlass zu prüfen.
export const DHW_PLAUSIBLE = { min: 0.05, max: 0.5 } as const
// Volle Abdeckung der Heizperiode durch Rechnungen, in Promille (PR 10, `COVERAGE_FULL`).
const COVERAGE_FULL = 1000

const fmt = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const fmtUpTo = (n: number, digits = 2) => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
export const fmtShare = (alpha: number): string => `${fmt(alpha * 100, 2)} %`

// Was den Warmwasseranteil verhindert. Die ersten fünf stammen aus PR 10 (`AlphaProblem` dort, ohne die
// beiden Sperren `formulaLater` und `heatingValueLater`, die mit dieser PR fallen); `formulaInput` ist
// eine fehlende oder widersprüchliche Eingabe einer Formel oder des Erzeugers, `totalHeatMissing` eine
// Anlage, die nur gegen gemessene Gesamtwärme rechnen darf und keine hat.
export type DhwProblem = 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'outOfRange' | 'formulaInput' | 'totalHeatMissing'

// ---------- Tage (UTC, inklusive Grenzen, wie calc.ts) ----------

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}
const daysInclusive = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1
// Der letzte Tag des Jahres, das an `from` beginnt (aus 2025-05-01 wird 2026-04-30).
function yearEndFrom(from: string): string {
  const [y, m, d] = from.split('-').map(Number)
  return new Date(Date.UTC((y ?? 0) + 1, (m ?? 1) - 1, (d ?? 1) - 1)).toISOString().slice(0, 10)
}

// Welcher Teil eines Jahres die Heizperiode ist. Eine Heizperiode von zwölf Monaten ist genau ein Jahr,
// auch im Schaltjahr; nur ein Rumpf ist kürzer. Nach Tagen und nicht nach Gradtagen, weil § 9b Abs. 2
// HeizkostenV die Kosten des Warmwasserverbrauchs zeitanteilig teilt: Warmwasser hängt nicht an der
// Witterung (Abweichung 3, Festlegung F7 im Entwurf 15.2, ⟨Norm offen: VDI 2077⟩).
export function yearShare(h: Period): { share: number; days: number; yearDays: number } {
  const end = yearEndFrom(h.from)
  const yearDays = daysInclusive(h.from, end)
  if (h.to >= end) return { share: 1, days: yearDays, yearDays }
  const days = daysInclusive(h.from, h.to)
  return { share: days / yearDays, days, yearDays }
}

// ---------- Lieferungen der Heizperiode ----------

export type EnergyDelivery = Pick<
  FuelDelivery,
  'id' | 'label' | 'invoiceTo' | 'deliveredAt' | 'invoiceDate' | 'energyKwh' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'
> & {
  // Anteil des verbrauchsabhängigen Teils dieser Rechnung an der Heizperiode, 0 bis 1 (PR 7,
  // `FuelDeliveryLine.sharePermille` / 1000). Bei Vorrat 1: Dort zählt die verbrauchte Menge.
  share: number
}

// Zu welcher Heizperiode eine Lieferung gehört: der, die das Ende des Rechnungszeitraums bzw. das
// Lieferdatum enthält (Entwurf 5.4).
export const deliveryDate = (d: Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate'>): string | null => d.invoiceTo ?? d.deliveredAt ?? d.invoiceDate
export function deliveriesInPeriod<T extends Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate'>>(ds: readonly T[], h: Period): T[] {
  return ds.filter((d) => {
    const date = deliveryDate(d)
    return date !== null && date >= h.from && date <= h.to
  })
}
// Die jüngste Lieferung vor der Heizperiode in einer Einheit: Ihr Brennstoff liegt im Vorrat, wenn in der
// Heizperiode keine kam (Abweichung 6).
export function latestBefore<T extends Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate' | 'quantityUnit'>>(ds: readonly T[], h: Period, unit: HeatingValueUnit): T | null {
  const earlier = ds
    .filter((d) => d.quantityUnit === unit)
    .map((d) => ({ d, date: deliveryDate(d) }))
    .filter((x): x is { d: T; date: string } => x.date !== null && x.date < h.from)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return earlier.at(-1)?.d ?? null
}

// Die mit Warmwasser versorgte Wohn- oder Nutzfläche der angeschlossenen Wohnungen (§ 9 Abs. 2 Satz 5
// Nr. 2): ohne die mit „kein Anschluss: Warmwasser“ (#117).
export function suppliedAreaOf(units: readonly Pick<SnapshotUnit, 'areaM2' | 'noConnection'>[]): number {
  return units.filter((u) => !(u.noConnection ?? []).includes('warmwasser')).reduce((a, u) => a + (u.areaM2 || 0), 0)
}

// ---------- Formeln (§ 9 Abs. 2 Satz 2 bis 5) ----------

export type Failure = { ok: false; reasons: string[] }
const fail = (...reasons: string[]): Failure => ({ ok: false, reasons })

export type FormulaInput = { method: 'volumeFormula' | 'areaFormula'; volumeM3: number | null; tempC: number | null; areaM2: number; h: Period }

export function formulaHeat(i: FormulaInput, log: LawLog): { ok: true; kwh: number; steps: string[] } | Failure {
  if (i.method === 'volumeFormula') {
    const p = law(hkvDhwVolumeFormula, { period: i.h }, log)
    const reasons: string[] = []
    if (i.volumeM3 === null || !(i.volumeM3 > 0)) reasons.push('das gemessene Volumen des Warmwassers in m³ fehlt')
    if (i.tempC === null) reasons.push('die mittlere Temperatur des Warmwassers in °C fehlt (gemessen oder geschätzt)')
    else if (!(i.tempC > p.coldWaterC)) reasons.push(`die Temperatur des Warmwassers (${fmtUpTo(i.tempC, 1)} °C) liegt nicht über der Kaltwassertemperatur von ${fmtUpTo(p.coldWaterC)} °C, die die Formel ansetzt`)
    if (reasons.length > 0 || i.volumeM3 === null || i.tempC === null) return { ok: false, reasons }
    const kwh = p.effort * i.volumeM3 * (i.tempC - p.coldWaterC)
    return {
      ok: true,
      kwh,
      steps: [`Q = ${fmtUpTo(p.effort)} · ${fmtUpTo(i.volumeM3, 3)} m³ · (${fmtUpTo(i.tempC, 1)} °C − ${fmtUpTo(p.coldWaterC)} °C) = ${fmtUpTo(kwh)} kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)`],
    }
  }
  const p = law(hkvDhwAreaFormula, { period: i.h }, log)
  if (!(i.areaM2 > 0)) return fail('die mit Warmwasser versorgte Wohn- oder Nutzfläche ist 0 m²; tragen Sie die Wohnflächen der angeschlossenen Wohnungen ein')
  const year = p.kwhPerM2 * i.areaM2
  const steps = [`Q = ${fmtUpTo(p.kwhPerM2)} · ${fmtUpTo(i.areaM2)} m² = ${fmtUpTo(year)} kWh je Jahr (§ 9 Abs. 2 Satz 4 HeizkostenV)`]
  const ys = yearShare(i.h)
  if (ys.share === 1) return { ok: true, kwh: year, steps }
  const kwh = year * ys.share
  steps.push(`Die Heizperiode umfasst ${ys.days} von ${ys.yearDays} Tagen; Warmwasser wird wie in § 9b Abs. 2 HeizkostenV zeitanteilig gerechnet: ${fmtUpTo(year)} kWh · ${ys.days} / ${ys.yearDays} = ${fmtUpTo(kwh)} kWh`)
  return { ok: true, kwh, steps }
}

// ---------- Energie des Erzeugers in der Heizperiode ----------

export type GeneratorInput = {
  deliveries: readonly EnergyDelivery[]
  // Vorrat (PR 8): die in der Heizperiode verbrauchte Menge; null ohne Vorrat.
  stock: { unit: HeatingValueUnit; consumed: number } | null
  // Nur bei Vorrat ohne Lieferung in der Heizperiode: die jüngste frühere Lieferung derselben Einheit.
  earlier: EnergyDelivery | null
}

export type Energy =
  | { ok: true; kind: 'kwh'; kwh: number; basis: 'hs' | 'hi' | null }
  | { ok: true; kind: 'quantity'; kwh: number; quantity: number; unit: HeatingValueUnit; heatingValue: number; values: DhwHeatingValue[] }

const UNIT_IN: Record<HeatingValueUnit, string> = { l: 'Litern', m3: 'Kubikmetern', kg: 'Kilogramm', srm: 'Schüttraummetern' }
const kwhOf = (d: EnergyDelivery): number | null => d.energyKwh ?? (d.quantityUnit === 'kWh' ? d.quantity : null)
const isValueUnit = (u: FuelDelivery['quantityUnit']): u is HeatingValueUnit => u === 'l' || u === 'm3' || u === 'kg' || u === 'srm'

// Der Heizwert einer Lieferung: laut Rechnung, sonst hilfsweise aus der Tabelle, und die nur bei
// Heizkesseln, mit gewählter Zeile und in deren Einheit (§ 9 Abs. 3, Entwurf R-A13). Ein Satz, wenn es
// keinen gibt.
function heatingValueOf(d: EnergyDelivery, energy: HeatingEnergy, unit: HeatingValueUnit, table: HeatingValueTable): DhwHeatingValue | string {
  if (d.heatingValue !== null) return { label: d.label, kwh: d.heatingValue, per: unit, source: 'invoice', grade: d.fuelGrade }
  if (!isBoiler(energy)) return `„${d.label}“ nennt keinen Heizwert, und die Werte der Heizkostenverordnung gelten nur bei Heizkesseln`
  if (d.fuelGrade === null) {
    return `„${d.label}“ nennt keinen Heizwert; tragen Sie den Heizwert laut Rechnung ein oder wählen Sie, wenn keiner darauf steht, die Zeile der Tabelle der Heizkostenverordnung`
  }
  const row = table.values[d.fuelGrade]
  if (!row) return `für „${FUEL_GRADE_LABELS[d.fuelGrade]}“ nennt die geltende Tabelle der Heizkostenverordnung keinen Wert; tragen Sie den Heizwert laut Rechnung ein`
  if (row.per !== unit) {
    return `für „${d.label}“ in ${UNIT_IN[unit]} nennt die Tabelle der Heizkostenverordnung keinen Wert, sie führt ${FUEL_GRADE_LABELS[d.fuelGrade]} nur je ${HEATING_VALUE_UNIT_TEXT[row.per]}; tragen Sie den Heizwert laut Rechnung ein`
  }
  return { label: d.label, kwh: row.kwh, per: row.per, source: 'table', grade: d.fuelGrade }
}

// Brennstoff als Menge: B = Q / Hᵢ nach § 9 Abs. 3; nur in den Einheiten der geltenden Fassung (seit
// 01.12.2021 Liter, Kubikmeter, Kilogramm; Abweichung 2). Mehrere Heizwerte mengengewichtet (Abweichung 6).
function quantityEnergy(energy: HeatingEnergy, h: Period, unit: HeatingValueUnit, quantity: number, weighted: readonly { d: EnergyDelivery; weight: number }[], log: LawLog): Energy | Failure {
  const table = law(hkvHeatingValues, { period: h }, log)
  if (!table.units.includes(unit)) {
    return fail(`§ 9 Abs. 3 Satz 1 HeizkostenV bestimmt den Brennstoffverbrauch in der geltenden Fassung nur in ${andList(table.units.map((u) => UNIT_IN[u])).replace(/ und ([^ ]+)$/, ' oder $1')}; ${UNIT_IN[unit]} sieht er nicht vor. Erfassen Sie Vorrat und Lieferungen in Kilogramm`)
  }
  const values: DhwHeatingValue[] = []
  const reasons: string[] = []
  for (const { d } of weighted) {
    const v = heatingValueOf(d, energy, unit, table)
    if (typeof v === 'string') reasons.push(v)
    else values.push(v)
  }
  if (reasons.length > 0) return { ok: false, reasons }
  const totalWeight = weighted.reduce((a, w) => a + w.weight, 0)
  const meanHi = weighted.reduce((a, w, k) => a + w.weight * (values[k]?.kwh ?? 0), 0) / totalWeight
  return { ok: true, kind: 'quantity', kwh: quantity * meanHi, quantity, unit, heatingValue: meanHi, values }
}

export function generatorEnergyOf(energy: HeatingEnergy, h: Period, g: GeneratorInput, log: LawLog): Energy | Failure {
  if (g.stock !== null) {
    const own = g.deliveries.filter((d) => d.quantityUnit === g.stock?.unit && d.quantity !== null && d.quantity > 0)
    const basis = own.length > 0 ? own.map((d) => ({ d, weight: d.quantity ?? 0 })) : g.earlier ? [{ d: g.earlier, weight: 1 }] : []
    if (basis.length === 0) {
      return fail('für den Brennstoff aus dem Vorrat ist kein Heizwert bekannt: In dieser Heizperiode gibt es keine Lieferung, und eine frühere ist nicht erfasst; erfassen Sie die letzte Lieferung mit ihrem Heizwert oder der Zeile der Tabelle')
    }
    return quantityEnergy(energy, h, g.stock.unit, g.stock.consumed, basis, log)
  }
  const used = g.deliveries.filter((d) => d.share > 0)
  if (used.length === 0) return fail('in dieser Heizperiode gibt es keine Rechnung des Versorgers mit einem Anteil an ihr; erfassen Sie die Rechnungen als Lieferungen')
  if (used.every((d) => kwhOf(d) !== null)) {
    const kwh = used.reduce((a, d) => a + d.share * (kwhOf(d) ?? 0), 0)
    const bases = new Set(used.map((d) => d.gasBasis))
    if (bases.has('hs') && bases.has('hi')) {
      return fail('die Rechnungen nennen die Kilowattstunden teils nach Brennwert, teils nach Heizwert; so lassen sie sich nicht zusammenzählen. Bitte prüfen Sie die Angabe an den Lieferungen')
    }
    const basis = bases.size === 1 ? ([...bases][0] ?? null) : null
    return { ok: true, kind: 'kwh', kwh, basis }
  }
  const missing = used.filter((d) => kwhOf(d) === null)
  if (!isBoiler(energy)) return fail(`${andList(missing.map((d) => `„${d.label}“`))} ${missing.length === 1 ? 'nennt' : 'nennen'} keine Kilowattstunden; bei dieser Heizung zählen die Kilowattstunden laut Rechnung`)
  const units = new Set(used.map((d) => d.quantityUnit))
  const first = used[0]?.quantityUnit ?? null
  if (used.some((d) => d.quantity === null || !(d.quantity > 0)) || units.size !== 1 || first === null || !isValueUnit(first)) {
    return fail('die Rechnungen nennen weder alle Kilowattstunden noch alle eine Menge in derselben Einheit; erfassen Sie bei allen Rechnungen der Heizperiode die Kilowattstunden oder bei allen die Menge')
  }
  const quantity = used.reduce((a, d) => a + d.share * (d.quantity ?? 0), 0)
  return quantityEnergy(energy, h, first, quantity, used.map((d) => ({ d, weight: d.share * (d.quantity ?? 0) })), log)
}

// ---------- Faktor nach § 9 Abs. 2 Satz 6, nur für Formelwerte ----------

type Factor = { kind: DhwFactorKind; value: number; q: (kwh: number) => number; step: (from: number, to: number) => string }

function formulaFactor(energy: HeatingEnergy, e: Energy, h: Period, log: LawLog): { ok: true; factor: Factor | null } | Failure {
  // Stromheizung: Satz 6 nennt keinen Faktor, und eine Formelwärme gegen Strom zu stellen wäre eine eigene
  // Regel. Gemessen rechnet sie wie in PR 10 (Abweichung 7). Unbekannter Energieträger: nur gemessen
  // gegen gemessen (§ 9 Abs. 1 Satz 5).
  if (energy === 'electric') {
    return fail('für eine Stromheizung nennt § 9 Abs. 2 Satz 6 HeizkostenV keinen Faktor; bestimmen Sie den Warmwasseranteil mit einem Wärmezähler am Warmwasserspeicher, er wird dann gegen den Strom laut Rechnung gestellt')
  }
  if (energy === 'other') {
    return fail('bei einem unbekannten Energieträger regelt § 9 HeizkostenV keine Formel; der Anteil lässt sich nur mit gemessener Gesamtwärme bestimmen (§ 9 Abs. 1 Satz 5)')
  }
  const f = law(hkvDhwFactors, { period: h }, log)
  if (energy === 'gas' && e.kind === 'kwh') {
    if (e.basis === null) {
      return fail(`bei den Gasrechnungen fehlt die Angabe, ob nach Brennwert oder nach Heizwert abgerechnet wurde; davon hängt der Faktor ${fmt(f.gasCalorific, 2)} ab (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)`)
    }
    if (e.basis === 'hi') return { ok: true, factor: null }
    return {
      ok: true,
      factor: {
        kind: 'gasCalorific', value: f.gasCalorific, q: (k) => k * f.gasCalorific,
        step: (a, b) => `Erdgas nach Brennwert abgerechnet: ${fmtUpTo(a)} kWh · ${fmt(f.gasCalorific, 2)} = ${fmtUpTo(b)} kWh (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)`,
      },
    }
  }
  if (energy === 'districtHeating') {
    return {
      ok: true,
      factor: {
        kind: 'heatSupply', value: f.heatSupplyDivisor, q: (k) => k / f.heatSupplyDivisor,
        step: (a, b) => `Wärmelieferung: ${fmtUpTo(a)} kWh ÷ ${fmt(f.heatSupplyDivisor, 2)} = ${fmtUpTo(b)} kWh (§ 9 Abs. 2 Satz 6 Nr. 2 HeizkostenV)`,
      },
    }
  }
  if (energy === 'heatPump') {
    const hp = f.heatPump
    if (hp === null) {
      return fail('für Zeiträume, die vor dem Inkrafttreten der Nr. 3 beginnen, sieht § 9 Abs. 2 Satz 6 HeizkostenV keinen Faktor für die Wärmepumpe vor; der Anteil lässt sich dann nur gemessen oder nach anerkannten Regeln der Technik bestimmen (§ 9 Abs. 1 Satz 5)')
    }
    return {
      ok: true,
      factor: {
        kind: 'heatPump', value: hp, q: (k) => k * hp,
        step: (a, b) => `Monovalente Wärmepumpe: ${fmtUpTo(a)} kWh · ${fmt(hp, 2)} = ${fmtUpTo(b)} kWh Strom (§ 9 Abs. 2 Satz 6 Nr. 3 HeizkostenV)`,
      },
    }
  }
  // Heizöl, Flüssiggas, Pellets, Holz, Kohle, und Erdgas als Menge mit Heizwert: kein Faktor.
  return { ok: true, factor: null }
}

// ---------- α ----------

export type DhwInput = {
  energy: HeatingEnergy
  heatGeneration: HeatGeneration | null
  h: Period
  method: DhwMethod
  // Gemessen: Wärme für das Warmwasser und Gesamtwärme der Anlage in kWh (Zähler mit Rolle `dhwHeat`
  // bzw. `totalHeat` oder eingetragen, PR 10 Abweichung 12).
  measured: { dhwKwh: number | null; totalKwh: number | null }
  volumeM3: number | null
  tempC: number | null
  suppliedAreaM2: number
  generator: GeneratorInput
  // Aus der Bewertung der Lieferungen (PR 7): wie viel der Heizperiode die Rechnungen abdecken, in
  // Promille, und ob eine davon die Schätzung beim Abschluss ist (PR 10 Abweichung 11).
  fuelCoveragePermille: number | null
  fuelEstimated: boolean
}

export type DhwOutcome =
  | { ok: true; statement: DhwStatement }
  | { ok: false; code: 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis'; problem: DhwProblem; reasons: string[] }

const failed = (problem: DhwProblem, reasons: string[]): DhwOutcome =>
  ({ ok: false, code: problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', problem, reasons })

// α außerhalb von (0, 1) ist ein Widerspruch in den Angaben (PR 10, `outOfRange`).
const outOfRange = (alpha: number): DhwOutcome => failed('outOfRange', [alpha > 0
  ? `der Warmwasseranteil ergäbe ${fmtShare(alpha)}, also mindestens die ganze Energie der Anlage; bitte prüfen Sie die Werte`
  : 'die Wärme für das Warmwasser ist 0 kWh; das passt nicht zu einer Anlage, die das Warmwasser bereitet. Bitte prüfen Sie die Stände und Werte'])

// Die Rechnungen müssen die ganze Heizperiode abdecken; eine Lücke hochzurechnen wäre eine Schätzung
// (PR 10 Abweichung 11). Beim Vorrat zählt die verbrauchte Menge, dort gibt es diese Frage nicht.
function gapOf(i: DhwInput): DhwOutcome | null {
  if (i.generator.stock !== null) return null
  if (i.fuelCoveragePermille !== null && i.fuelCoveragePermille >= COVERAGE_FULL - 1e-6) return null
  return failed('fuelGap', ['die Rechnungen des Versorgers decken die Heizperiode nicht ganz ab, und der Warmwasseranteil braucht den Verbrauch der ganzen Heizperiode; tragen Sie die Folgerechnung ein oder schließen Sie die Abrechnung mit einer Schätzung der fehlenden Rechnung ab'])
}

const DENOMINATOR_WORDS: Record<'fuelKwh' | 'deliveredHeat' | 'electricity', string> = {
  fuelKwh: 'Brennstoff laut Rechnung', deliveredHeat: 'gelieferte Wärme laut Rechnung', electricity: 'Strom laut Rechnung',
}

// Q gegen die Energie stellen und α prüfen. `formula` ist null bei gemessenem Q.
function finish(i: DhwInput, method: DhwMethod, q: number, formula: { kwh: number; factor: Factor | null } | null, e: Energy, steps: string[]): DhwOutcome {
  const factor = formula?.factor ? { kind: formula.factor.kind, value: formula.factor.value } : null
  const values = e.kind === 'quantity' ? e.values : []
  const estimated = i.generator.stock === null && i.fuelEstimated
  if (e.kind === 'kwh') {
    if (!(e.kwh > 0)) return failed('noFuelEnergy', ['die Rechnungen der Heizperiode ergeben 0 kWh'])
    const kind = i.energy === 'districtHeating' ? 'deliveredHeat' : i.energy === 'heatPump' || i.energy === 'electric' ? 'electricity' : 'fuelKwh'
    const alpha = q / e.kwh
    if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
    steps.push(`Warmwasseranteil = ${fmtUpTo(q)} kWh / ${fmtUpTo(e.kwh)} kWh ${DENOMINATOR_WORDS[kind]} = ${fmtShare(alpha)}`)
    return {
      ok: true,
      statement: { method, alpha, heatKwh: q, formulaKwh: formula?.kwh ?? null, factor, denominator: { kind, value: e.kwh, unit: 'kWh' }, energyKwh: e.kwh, fuelForDhw: null, heatingValues: values, estimated, steps },
    }
  }
  if (!(e.quantity > 0) || !(e.heatingValue > 0)) return failed('noFuelEnergy', ['in der Heizperiode wurde kein Brennstoff verbraucht'])
  const b = q / e.heatingValue
  const alpha = b / e.quantity
  if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
  const unit = HEATING_VALUE_UNIT_TEXT[e.unit]
  steps.push(`Heizwert: ${fmtUpTo(e.heatingValue, 3)} kWh je ${unit}${e.values.length > 1 ? ' (Mittel der Rechnungen nach Menge)' : ''}${e.values.some((v) => v.source === 'table') ? ' (Tabelle des § 9 Abs. 3 HeizkostenV, weil die Rechnung keinen nennt)' : ''}`)
  steps.push(`B = Q / Hᵢ = ${fmtUpTo(q)} kWh / ${fmtUpTo(e.heatingValue, 3)} kWh je ${unit} = ${fmtUpTo(b)} ${unit} (§ 9 Abs. 3 HeizkostenV)`)
  steps.push(`Warmwasseranteil = ${fmtUpTo(b)} / ${fmtUpTo(e.quantity)} ${unit} verbrauchter Brennstoff = ${fmtShare(alpha)}`)
  return {
    ok: true,
    statement: {
      method, alpha, heatKwh: q, formulaKwh: formula?.kwh ?? null, factor,
      denominator: { kind: 'fuelQuantity', value: e.quantity, unit: e.unit },
      energyKwh: e.kwh,
      fuelForDhw: { quantity: b, unit: e.unit, heatingValue: e.heatingValue },
      heatingValues: values, estimated, steps,
    },
  }
}

function measuredShare(i: DhwInput, log: LawLog): DhwOutcome {
  const q = i.measured.dhwKwh
  if (q === null || q < 0) {
    return failed('noDhwHeat', ['die gemessene Wärme für das Warmwasser fehlt; tragen Sie die Stände des Wärmezählers am Warmwasserspeicher zu Beginn und Ende der Heizperiode ein'])
  }
  const steps = [`Gemessene Wärme für das Warmwasser: ${fmtUpTo(q)} kWh (§ 9 Abs. 2 Satz 1 HeizkostenV)`]
  const total = i.measured.totalKwh
  // Wärmepumpe: Anteil am Wärmeverbrauch (§ 9 Abs. 1 Satz 2). Gemessene Wärme durch Strom ergäbe etwa
  // das Dreifache (Entwurf 8.3, A8).
  if (i.energy === 'heatPump' && total === null) return failed('heatPumpBasis', [])
  // Nur gegen gemessene Gesamtwärme: Wärmepumpe, unbekannter Energieträger und eine Anlage mit weiterem
  // Erzeuger (§ 9 Abs. 1 Satz 5). Die Stromheizung nicht: Sie rechnet wie in PR 10 gegen den Strom laut
  // Rechnung (Abweichung 7).
  const needsTotal = i.energy === 'heatPump' || i.energy === 'other' || i.heatGeneration === 'mixed'
  if (total !== null && (needsTotal || i.energy === 'districtHeating')) {
    if (!(total > 0)) return failed('totalHeatMissing', ['die gemessene Gesamtwärme ist 0 kWh; bitte prüfen Sie die Stände des Gesamtwärmezählers'])
    const alpha = q / total
    if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
    steps.push(`Warmwasseranteil = ${fmtUpTo(q)} kWh / ${fmtUpTo(total)} kWh gemessene Gesamtwärme = ${fmtShare(alpha)} (§ 9 Abs. 1 Satz 2 HeizkostenV)`)
    return {
      ok: true,
      statement: {
        method: 'heatMeter', alpha, heatKwh: q, formulaKwh: null, factor: null, denominator: { kind: 'measuredTotalHeat', value: total, unit: 'kWh' },
        energyKwh: total, fuelForDhw: null, heatingValues: [], estimated: false, steps,
      },
    }
  }
  if (needsTotal) {
    return failed('totalHeatMissing', [i.heatGeneration === 'mixed'
      ? 'die Anlage erzeugt die Wärme nicht allein; dann braucht es die gemessene Gesamtwärme (Gesamtwärmezähler), und die fehlt (§ 9 Abs. 1 Satz 5 HeizkostenV)'
      : 'bei einem unbekannten Energieträger braucht es die gemessene Gesamtwärme (Gesamtwärmezähler), und die fehlt (§ 9 Abs. 1 Satz 5 HeizkostenV)'])
  }
  const e = generatorEnergyOf(i.energy, i.h, i.generator, log)
  if (!e.ok) return failed('noFuelEnergy', e.reasons)
  const gap = gapOf(i)
  if (gap) return gap
  return finish(i, 'heatMeter', q, null, e, steps)
}

function formulaShare(i: DhwInput, method: 'volumeFormula' | 'areaFormula', log: LawLog): DhwOutcome {
  if (i.heatGeneration === null) {
    return failed('formulaInput', ['es fehlt die Antwort, ob die Anlage die Wärme allein erzeugt; sie entscheidet, ob eine Formel zulässig ist (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3 HeizkostenV)'])
  }
  if (i.heatGeneration === 'mixed') {
    return failed('formulaInput', ['die Anlage erzeugt die Wärme nicht allein (etwa mit Solaranlage, Heizstab oder zweitem Kessel); dann lässt sich der Anteil nur mit gemessener Gesamtwärme bestimmen (§ 9 Abs. 1 Satz 5 HeizkostenV) und nicht nach einer Formel'])
  }
  const formula = formulaHeat({ method, volumeM3: i.volumeM3, tempC: i.tempC, areaM2: i.suppliedAreaM2, h: i.h }, log)
  if (!formula.ok) return failed('formulaInput', formula.reasons)
  const e = generatorEnergyOf(i.energy, i.h, i.generator, log)
  if (!e.ok) return failed('noFuelEnergy', e.reasons)
  const gap = gapOf(i)
  if (gap) return gap
  const f = formulaFactor(i.energy, e, i.h, log)
  if (!f.ok) return failed('formulaInput', f.reasons)
  const steps = [...formula.steps]
  const q = f.factor ? f.factor.q(formula.kwh) : formula.kwh
  if (f.factor) steps.push(f.factor.step(formula.kwh, q))
  return finish(i, method, q, { kwh: formula.kwh, factor: f.factor }, e, steps)
}

export function dhwShareOf(i: DhwInput, log: LawLog): DhwOutcome {
  return i.method === 'heatMeter' ? measuredShare(i, log) : formulaShare(i, i.method, log)
}
```

Hinweis zu `quantityEnergy`: `andList(['Litern', 'Kubikmetern', 'Kilogramm'])` ergibt „Litern,
Kubikmetern und Kilogramm“; das `replace` macht aus dem letzten „und“ ein „oder“, so wie § 9 Abs. 3
Satz 1 es sagt.

- [ ] **Step 5: Wächter (`server/test/law-literals.test.ts`)**

`'server/src/dhw.ts'` in `ENGINE_FILES` aufnehmen.

- [ ] **Step 6: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/dhw.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (`dhw.test.ts`: 16 Tests). Der Wächter findet in dhw.ts kein Datum und keine
Prozentangabe einer Rechtsfolge; `COVERAGE_FULL` (1000 ‰) ist wie in PR 10 kein Rechtswert.

- [ ] **Step 7: Commit**

Run: `npm test`
Expected: PASS (dhw.ts wird noch von niemandem aufgerufen).

```bash
git add shared/types.ts server/src/dhw.ts server/test/dhw.test.ts server/test/law-literals.test.ts
git commit -m "Warmwasseranteil nach § 9 HeizkostenV als reine Funktionen

Gemessen gegen Brennstoff, gelieferte Wärme, Strom oder gemessene Gesamtwärme; nach Volumen- und
Flächenformel mit den Faktoren nur für Formelwerte; Brennstoff als Menge mit B = Q / Hi, Heizwert
laut Rechnung vor der Tabelle, die nur bei Heizkesseln gilt. Die Regeln von PR 10 (Lücke,
Schätzung, Anteil außerhalb von 0 bis 100 %) bleiben. Was fehlt, wird gesagt.

Refs #99
Refs #211"
```

---
### Task 4: Naht zu PR 10: Testhelfer, α aus dhw.ts, Sperren, Hinweise, Ausweis

Neu gefasst nach der Prüfung vom 05.10.2026 (Abgleich mit PR 10, Commit `81828af`). Die Stelle, an der
PR 10 α bestimmt, ist `hotWaterShareOf(i: AlphaInput)` in heating.ts mit dem einen Aufruf `alphaResult`
im Block des Plans von `computeSettlement` (PR 10 Task 8 Step 7). Sie bleibt die eine Stelle und ruft
jetzt dhw.ts; Gestalt und Namen von PR 10 bleiben (`Alpha`, `AlphaProblem`, `self.alpha`), dazu kommt
der Rechenweg. Die Sperren `formulaLater`, `heatingValueLater` und `LATER.dhwHeatingValue` fallen. Neu
sind die Hinweise `heating.heating-value-from-table` (hint), `heating.dhw-share-implausible` (hint) und
`heating.heat-pump-old-exemption` (hint, Abweichung 9) und `heating.dhw-not-metered` auch bei `self`
(warning, 15 % auf den ganzen Anteil an Heiz- und Warmwasserkosten, Entwurf 6.5, R-A6).
`heating.heat-pump-dhw-basis` gibt es seit PR 10 (dort Abweichung 6); diese PR legt den Code nicht noch
einmal an.

**Files:**
- Create: `server/testing/selfHeating.ts`
- Modify: `server/src/dhw.ts` (Naht), `server/src/heating.ts`, `server/src/calc.ts`, `server/src/db/heating.ts`, `shared/types.ts` (`SelfHeatingStatement.dhw`)
- Test: `server/test/dhw.test.ts` (ergänzen), `server/test/heating.test.ts` (Tests von PR 10 zum Warmwasseranteil ersetzen), `server/test/calc-heizkosten.test.ts` (ergänzen), `server/test/db-heizkosten.test.ts` (ein Test von PR 10 ändert sich), `server/test/calc-warmwasser.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1 `hkvRenewableExemption`; Task 3 `dhwShareOf`, `DhwInput`, `DhwOutcome`, `DhwProblem`, `EnergyDelivery`, `GeneratorInput`, `suppliedAreaOf`, `deliveriesInPeriod`, `latestBefore`, `DHW_PLAUSIBLE`, `fmtShare`; Task 1 `FUEL_GRADE_LABELS`, `HEATING_VALUE_UNIT_TEXT`; `andList` (`shared/wording.ts`).
  PR 10 (Plan, Commit `81828af`): heating.ts `hotWaterShareOf`, `AlphaInput`, `AlphaProblem`, `Alpha`, `KWH_ENERGIES`; calc.ts im Block des Plans `plant`, `own`, `served`, `hotWater`, `plantMeterKwh`, `fuelOfPlant`, `alphaResult`, `ALPHA_TEXT`, `blocked`, `where`, `weights`, `selfPlans.set(…)`, `type SelfPlantPlan`, `stockOfPlant`; `selfStatementOf`; in der Hinweisschleife `const notYet = sp.verdict?.kind === 'notYet'`; db/heating.ts `LATER.dhwHeatingValue`, `guardHeatingPlant`; Test `server/test/calc-heizkosten.test.ts` mit `withDatabase`, `beispielA`, `ITEMS`, `shareOf`, `sumOf`; `server/test/db-heizkosten.test.ts` mit `haus`, `SETUP`, `setUpSelf`, `status`, `newId`.
  PR 6/7: CO₂-Block `pot`, `hw`, `FORMULA_METHODS`, `cutsOn`, `where`, `ids`, `hPeriod`, `lawLog`, `hkvCutNotByConsumption`; `snapshot.fuel?.deliveries` (`SnapshotFuel`, PR 7); `FuelResult.lines` (`deliveryId`, `sharePermille`, `estimated`), `FuelResult.coveragePermille`; PR 8 `stockOfPlant.get(id)?.result` (`StockResult`, `statement.unit`, `statement.consumed.quantity`).
- Produces:
  - `server/testing/selfHeating.ts`: `SELF_ITEMS`, `type SelfSnapshotOptions = { year?: number; plant?: Partial<HeatingPlant>; row?: Partial<HeatingPeriodData>; rows?: HeatingPeriodData[]; units?: Unit[]; tenancies?: Tenancy[]; meters?: Meter[]; readings?: Reading[]; deliveries?: FuelDelivery[]; costItems?: CostItem[] }`, `selfRow(over?, year?): HeatingPeriodData`, `selfDelivery(over?, year?): FuelDelivery`, `selfSnapshot(o?: SelfSnapshotOptions): Snapshot`. Feste Kennungen: Objekt `objekt-1`, Wohnungen `a`, `b`, `c`; Mietverhältnisse `A`, `B`, `C1` (bis 30.09.), `C2`; Anlage `hp`; Wärmezähler `wz-a`, `wz-b`, `wz-c`; Warmwasserzähler `xw-a`, `xw-b`, `xw-c`; Wärmezähler am Speicher `ww` (Rolle `dhwHeat`); Lieferung `d1`; Positionen `gas`, `strom`, `wartung`, `imm`, `wz`, `wwz`.
  - `dhw.ts`: `type DhwContext = { plant: { energy: HeatingEnergy; heatGeneration?: HeatGeneration | null }; row: { dhwMethod: DhwMethod | null; dhwVolumeM3?: number | null; dhwTempC?: number | null } | null; h: Period; fuelLines: readonly { deliveryId: string; sharePermille: number }[]; stock: { unit: HeatingValueUnit; consumedQuantity: number } | null; deliveries: readonly Omit<EnergyDelivery, 'share'>[]; units: readonly Pick<SnapshotUnit, 'areaM2' | 'noConnection'>[]; measured: { dhwKwh: number | null; totalKwh: number | null }; fuelCoveragePermille: number | null; fuelEstimated: boolean }`, `dhwInputOf(c: DhwContext): DhwInput`, `dhwProblemText(o: { problem: DhwProblem; reasons: readonly string[] }): string`
  - `heating.ts`: `type AlphaInput = DhwContext & { hotWater: HotWater; log: LawLog }`, `type AlphaProblem = DhwProblem`, `type Alpha = { value: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean; statement: DhwStatement }`, `hotWaterShareOf(i: AlphaInput): { ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem; reasons: string[] }`; `KWH_ENERGIES` entfällt.
  - `shared/types.ts`: `SelfHeatingStatement.dhw?: DhwStatement`
  - calc.ts: `SelfPlantPlan.oldHeatPumpExemption: boolean`; `noticeKinds` + `'heating.heating-value-from-table'` (hint), `'heating.dhw-share-implausible'` (hint), `'heating.heat-pump-old-exemption'` (hint)

- [ ] **Step 1: Testhelfer und Gleichheitstest gegen Beispiel A über die Datenbank**

Datei `server/testing/selfHeating.ts` (Helfer der Tests liegen in `server/testing/`, CLAUDE.md):

```ts
// Beispiel A (Entwurf 8.6) als Schnappschuss ohne Datenbank, für die Tests der eigenen
// Heizkostenabrechnung ab Heizung PR 11 (Prüfbericht vom 05.10.2026, B.1). Dieselben Zahlen wie
// `beispielA` in server/test/calc-heizkosten.test.ts (PR 10), das dieselbe Lage über die Datenbank baut;
// ein Test dort hält beide gleich. Feste Kennungen, damit Tests einzelne Datensätze treffen: Wohnungen
// `a`, `b`, `c`; Mietverhältnisse `A`, `B`, `C1` (bis 30.09.), `C2`; Anlage `hp`; Wärmezähler `wz-a`,
// `wz-b`, `wz-c`; Warmwasserzähler `xw-a`, `xw-b`, `xw-c`; Wärmezähler am Speicher `ww`; Lieferung `d1`;
// Positionen `gas`, `strom`, `wartung`, `imm`, `wz`, `wwz`.
//
// Gebaut wird über `snapshotFor`, damit jedes abgeleitete Feld (Lieferungen, Zeilen der Heizperiode,
// Zwischenablesungen, eingefrorene Stände) so entsteht wie im Betrieb. Die Datensätze sind vollständig
// nach den Typen des Modells gebaut, nicht als freies Objektliteral (CLAUDE.md). Bekommt ein Typ in einer
// späteren PR ein Pflichtfeld, nennt der Übersetzer die Stelle hier; die PR ergänzt es mit dem Wert, den
// ihre Vorgabe (`emptyHeatingPlant`, `emptyDelivery`, Spaltenvorgabe) setzt.
import type {
  CostItem, FuelDelivery, HeatingPart, HeatingPeriodData, HeatingPlant, HeatingTarget, Meter, MeterType, Reading, Tenancy, Unit,
} from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { snapshotFor, type Snapshot } from '../src/snapshot.ts'

export const SELF_ITEMS = ['gas', 'strom', 'wartung', 'imm', 'wz', 'wwz'] as const

export type SelfSnapshotOptions = {
  // Das Kalenderjahr der Heizperiode; alle Daten verschieben sich mit. Vorgabe 2025.
  year?: number
  plant?: Partial<HeatingPlant>
  // Felder der Zeile dieser Heizperiode (Vorgabe: 70/70 %, Dämmung „trifft nicht zu“, gemessen).
  row?: Partial<HeatingPeriodData>
  // Weitere Zeilen, etwa die der Vorperiode.
  rows?: HeatingPeriodData[]
  units?: Unit[]
  tenancies?: Tenancy[]
  meters?: Meter[]
  readings?: Reading[]
  deliveries?: FuelDelivery[]
  costItems?: CostItem[]
}

const P = 'objekt-1'

// Die Anlage nach der Einrichtung (PR 10 `setUpSelf`): Gas, eigene Abrechnung, verbundenes Warmwasser,
// Wärmezähler, Grundkosten nach Wohnfläche, Wechsel nach Gradtagen.
const PLANT: HeatingPlant = {
  id: 'hp', propertyId: P, name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null,
  heatGeneration: null,
}

// Die Zeile einer Heizperiode, wie `setUpSelf` (PR 10) sie schreibt; alle übrigen Spalten leer.
export function selfRow(over: Partial<HeatingPeriodData> = {}, year = 2025): HeatingPeriodData {
  return {
    id: `hp-${year}`, plantId: 'hp', period: periodKey(`${year}-01`),
    heatConsumptionPct: 70, waterConsumptionPct: 70, above70Agreed: null, insulationRule: 'notApplies',
    dhwMethod: 'heatMeter', dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null, dhwUnmeasurable: null,
    infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: null, climateFactorPrev: null, consumerContract: null, infoContactsConfirmed: null,
    stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null,
    closingQuantity: null, closingMeasuredOn: null,
    ...over,
  }
}

// Die Gasrechnung von Beispiel A: 60.000 kWh über das ganze Jahr, mit CO₂-Angaben (PR 7). Ob nach
// Brennwert oder Heizwert, lässt Beispiel A offen (`gasBasis: null`); für eine Formel setzt der Test es.
export function selfDelivery(over: Partial<FuelDelivery> = {}, year = 2025): FuelDelivery {
  return {
    id: 'd1', plantId: 'hp', label: 'Erdgas', invoiceDate: `${year + 1}-01-15`, deliveredAt: null, invoiceFrom: `${year}-01-01`, invoiceTo: `${year}-12-31`,
    unitId: null, amountCents: null, quantity: null, quantityUnit: null, energyKwh: 60000, gasBasis: null, heatingValue: null,
    emissionsKg: 10883.4, co2CostCents: 59859, emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: 0,
    estimated: false, usedByService: true, parts: [], fuelGrade: null,
    ...over,
  }
}

const unit = (id: string, areaM2: number): Unit => ({ id, propertyId: P, name: id.toUpperCase(), areaM2, participates: true, selfUsed: false })
const tenancy = (id: string, unitId: string, start: string, end: string | null): Tenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], costModel: 'settlement', heatingModel: 'settlement',
})
const meter = (id: string, unitId: string | null, name: string, type: MeterType, over: Partial<Meter> = {}): Meter =>
  ({ id, propertyId: P, name, unitId, type, unit: type === 'warmwasser' ? 'm³' : 'kWh', ...over })
const reading = (meterId: string, date: string, value: number): Reading => ({ id: `${meterId}@${date}`, meterId, date, value })

export function selfSnapshot(o: SelfSnapshotOptions = {}): Snapshot {
  const year = o.year ?? 2025
  const key = periodKey(`${year}-01`)
  const period = periodOfKey(CALENDAR_RULES, key)
  if (!period) throw new Error(`Den Zeitraum ${key} gibt es im Kalenderjahr nicht.`)
  const start = `${year - 1}-12-31`
  const change = `${year}-09-30`
  const end = `${year}-12-31`
  const units = o.units ?? [unit('a', 60), unit('b', 80), unit('c', 60)]
  const tenancies = o.tenancies ?? [
    tenancy('A', 'a', '2020-01-01', null),
    tenancy('B', 'b', '2020-01-01', null),
    tenancy('C1', 'c', '2020-01-01', change),
    tenancy('C2', 'c', `${year}-10-01`, null),
  ]
  const meters = o.meters ?? [
    meter('wz-a', 'a', 'Wärme A', 'waerme'), meter('xw-a', 'a', 'Warmwasser A', 'warmwasser'),
    meter('wz-b', 'b', 'Wärme B', 'waerme'), meter('xw-b', 'b', 'Warmwasser B', 'warmwasser'),
    meter('wz-c', 'c', 'Wärme C', 'waerme'), meter('xw-c', 'c', 'Warmwasser C', 'warmwasser'),
    meter('ww', null, 'Wärmezähler Warmwasserspeicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' }),
  ]
  const readings = o.readings ?? [
    reading('wz-a', start, 1000), reading('wz-a', end, 13000),
    reading('wz-b', start, 0), reading('wz-b', end, 16000),
    reading('wz-c', start, 500), reading('wz-c', change, 7700), reading('wz-c', end, 12500),
    reading('xw-a', start, 10), reading('xw-a', end, 40),
    reading('xw-b', start, 0), reading('xw-b', end, 40),
    reading('xw-c', start, 5), reading('xw-c', change, 43), reading('xw-c', end, 55),
    reading('ww', start, 0), reading('ww', end, 9000),
  ]
  const item = (id: string, description: string, amountCents: number, heatingPart: HeatingPart, heatingTarget: HeatingTarget, extra: Partial<CostItem> = {}): CostItem => ({
    id, propertyId: P, period: key, category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem',
    heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
  })
  const costItems = o.costItems ?? [
    item('gas', 'Erdgas', 600000, 'fuel', 'both', { fuelDeliveryId: 'd1' }),
    item('strom', 'Betriebsstrom', 18000, 'operating', 'both'),
    item('wartung', 'Wartung', 24000, 'operating', 'both'),
    item('imm', 'Immissionsmessung', 6000, 'operating', 'both'),
    item('wz', 'Miete Wärmezähler', 12000, 'metering', 'heating'),
    item('wwz', 'Miete Warmwasserzähler', 6000, 'metering', 'water'),
  ]
  const plant: HeatingPlant = { ...PLANT, ...o.plant }
  const rows: HeatingPeriodData[] = [selfRow(o.row, year), ...(o.rows ?? [])]
  const deliveries = o.deliveries ?? [selfDelivery({}, year)]
  const source: Parameters<typeof snapshotFor>[0] = {
    units, tenancies, costItems, meters, readings, payments: [], closedSettlements: [],
    heatingPlants: [plant], heatingPeriodRows: rows, fuelDeliveries: deliveries,
  }
  return snapshotFor(source, P, period)
}
```

Die Felder von `HeatingPlant` sind die von PR 4 (Plan Task 2), PR 5 (`periodChanges`, `separateSpans`),
PR 7 (`nonResidential`, `restriction`, `districtEtsNew`), PR 10 (`hotWater`, `capture`, `areaBasisHeat`,
`heatPumpInstalledOn`) und Task 2 dieses Plans (`heatGeneration`); `HeatingPeriodData` die von PR 4 und
PR 8 (Vorrat); `FuelDelivery` die von PR 7, PR 10 (`energyKwh`) und Task 2 (`fuelGrade`). Heißt das Feld
des Bestands für die Lieferungen in `snapshotFor` nicht `fuelDeliveries` (PR 7, `FuelSource`), gilt
dessen Name.

In `server/test/calc-heizkosten.test.ts` (PR 10) den Import `import { selfSnapshot } from '../testing/selfHeating.ts'`
ergänzen und anhängen:

```ts
test('Testhelfer selfSnapshot (server/testing/selfHeating.ts) rechnet wie Beispiel A über die Datenbank', async () => {
  await withDatabase(async (opened) => {
    const ueberDb = computeSettlement(await beispielA(opened))
    const rein = computeSettlement(selfSnapshot())
    for (const t of ['A', 'B', 'C1', 'C2']) {
      for (const id of ITEMS) assert.equal(shareOf(rein, t, id), shareOf(ueberDb, t, id), `${t} ${id}`)
    }
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => sumOf(rein, t)), [196189, 261584, 133152, 75075])
    const relief = (s: ComputedSettlement, t: string) => s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.kind === 'co2Relief')?.shareCents ?? 0
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => relief(rein, t)), [-16761, -22348, -11340, -6417])
    assert.deepEqual(rein.heating?.[0]?.self?.alpha, ueberDb.heating?.[0]?.self?.alpha)
    assert.deepEqual(rein.notices.map((n) => n.code).sort(), ueberDb.notices.map((n) => n.code).sort())
  })
})
```

Weicht eine Zahl ab, ist der Helfer falsch und nicht Beispiel A: Die Zahlen stehen im Entwurf 8.6 und in
PR 10 Task 8.

- [ ] **Step 2: Failing tests schreiben**

(a) `server/test/dhw.test.ts`: Import um `dhwInputOf, dhwProblemText` ergänzen; ans Dateiende:

```ts
test('Naht zu PR 10: Anteile der Rechnungen aus der Bewertung, beim Vorrat die Lieferungen der Heizperiode oder die jüngste frühere', () => {
  const lieferung = { id: 'g', label: 'Gas', invoiceTo: '2025-12-31', deliveredAt: null, invoiceDate: null, energyKwh: 60000, quantity: null, quantityUnit: null, gasBasis: 'hs' as const, heatingValue: null, fuelGrade: null }
  const ctx = {
    plant: { energy: 'gas' as const }, row: null, h: H2025, fuelLines: [{ deliveryId: 'g', sharePermille: 500 }], stock: null,
    deliveries: [lieferung], units: [{ areaM2: 80 }, { areaM2: 70 }], measured: { dhwKwh: 9000, totalKwh: null },
    fuelCoveragePermille: 1000, fuelEstimated: false,
  }
  const i = dhwInputOf(ctx)
  assert.equal(i.method, 'heatMeter')
  assert.equal(i.heatGeneration, null)
  assert.equal(i.suppliedAreaM2, 150)
  assert.deepEqual([i.fuelCoveragePermille, i.fuelEstimated], [1000, false])
  assert.deepEqual(i.generator.deliveries.map((d) => [d.id, d.share]), [['g', 0.5]])
  const oel = (id: string, date: string) => ({ ...lieferung, id, label: id, invoiceTo: null, deliveredAt: date, energyKwh: null, gasBasis: null, quantity: 1000, quantityUnit: 'l' as const, heatingValue: 10 })
  const vorrat = { ...ctx, plant: { energy: 'oil' as const }, fuelLines: [], stock: { unit: 'l' as const, consumedQuantity: 6000 } }
  const mit = dhwInputOf({ ...vorrat, deliveries: [oel('alt', '2024-10-01'), oel('neu', '2025-10-01')] })
  assert.deepEqual([mit.generator.deliveries.map((d) => d.id), mit.generator.earlier], [['neu'], null])
  const ohne = dhwInputOf({ ...vorrat, deliveries: [oel('alt', '2024-10-01'), oel('aelter', '2023-10-01'), oel('spaeter', '2026-02-01')] })
  assert.deepEqual([ohne.generator.deliveries, ohne.generator.earlier?.id], [[], 'alt'])
  assert.deepEqual(ohne.generator.stock, { unit: 'l', consumed: 6000 })
})

test('Satz ohne Anteil: nennt, was fehlt; die Wärmepumpe ohne Gesamtwärme mit eigenem Satz', () => {
  assert.equal(
    dhwProblemText({ problem: 'formulaInput', reasons: ['a fehlt', 'b fehlt'] }),
    'Mietfuchs kann den Warmwasseranteil nicht bestimmen, denn a fehlt und b fehlt (§ 9 HeizkostenV).',
  )
  assert.match(dhwProblemText({ problem: 'heatPumpBasis', reasons: [] }), /Gesamtwärmezähler.*§ 9 Abs\. 1 Satz 2/s)
  assert.match(dhwProblemText(failure({ fuelCoveragePermille: 848.71 })), /Folgerechnung.*Schätzung/s)
})
```

(b) `server/test/heating.test.ts`: Die vier Tests von PR 10 zum Warmwasseranteil („α gemessen: 9.000 von
60.000 kWh …“, „α bei Fernwärme …“, „α bei Wärmepumpe …“, „α: Formeln, Heizöl und Lücken …“) samt
ihrem Helfer `gas` ersetzen durch die folgenden; der Import von `AlphaInput` bleibt,
`import { createLawLog } from '../../shared/law/register.ts'` kommt dazu (in den vorhandenen Import aus
register.ts aufnehmen):

```ts
// ---------- Warmwasseranteil (Entwurf 8.3; ab Heizung PR 11 über dhw.ts) ----------

const gasRechnung = {
  id: 'g', label: 'Gas 2025', invoiceTo: '2025-12-31', deliveredAt: null, invoiceDate: '2026-01-15', energyKwh: 60000,
  quantity: null, quantityUnit: null, gasBasis: 'hs' as const, heatingValue: null, fuelGrade: null,
}
const gas = (over: Partial<AlphaInput> = {}): AlphaInput => ({
  hotWater: 'combined', log: createLawLog(), plant: { energy: 'gas', heatGeneration: null }, row: { dhwMethod: 'heatMeter' },
  h: { from: '2025-01-01', to: '2025-12-31' }, fuelLines: [{ deliveryId: 'g', sharePermille: 1000 }], stock: null, deliveries: [gasRechnung],
  units: [{ areaM2: 200 }], measured: { dhwKwh: 9000, totalKwh: null }, fuelCoveragePermille: 1000, fuelEstimated: false, ...over,
})
const problemOf = (r: ReturnType<typeof hotWaterShareOf>): string => (r.ok ? 'ok' : r.problem)

test('α gemessen (PR 10, ab PR 11 über dhw.ts): 9.000 von 60.000 kWh = 15,0 %, ohne Faktor (Wortlaut, G-B1 abgelehnt)', () => {
  const r = hotWaterShareOf(gas())
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.15, 'α')
  assert.deepEqual([r.alpha.reference, r.alpha.referenceKwh, r.alpha.dhwHeatKwh, r.alpha.estimated], ['fuel', 60000, 9000, false])
  assert.deepEqual([r.alpha.statement.method, r.alpha.statement.factor], ['heatMeter', null])
  // Mit der Schätzung beim Abschluss beruht α auf geschätzter Energie (PR 10 Abweichung 11).
  const geschaetzt = hotWaterShareOf(gas({ fuelEstimated: true }))
  assert.ok(geschaetzt.ok && geschaetzt.alpha?.estimated === true)
})

test('α bei Fernwärme und Wärmepumpe wie in PR 10: Gesamtwärme, wenn gemessen; Wärmepumpe nur gegen sie (A8)', () => {
  const mitZaehler = hotWaterShareOf(gas({ plant: { energy: 'districtHeating' }, measured: { dhwKwh: 9000, totalKwh: 45000 } }))
  assert.ok(mitZaehler.ok && mitZaehler.alpha)
  near(mitZaehler.alpha.value, 0.2, 'Q / Gesamtwärme')
  assert.equal(mitZaehler.alpha.reference, 'totalHeat')
  const ohne = hotWaterShareOf(gas({ plant: { energy: 'districtHeating' } }))
  assert.ok(ohne.ok && ohne.alpha)
  near(ohne.alpha.value, 0.15, 'Q / Lieferung')
  const strom = [{ ...gasRechnung, label: 'Strom 2025', energyKwh: 12000, gasBasis: null }]
  const wp = hotWaterShareOf(gas({ plant: { energy: 'heatPump' }, deliveries: strom, measured: { dhwKwh: 4500, totalKwh: 36000 } }))
  assert.ok(wp.ok && wp.alpha)
  near(wp.alpha.value, 0.125, 'Q / Wärme, nicht Q / Strom')
  assert.equal(problemOf(hotWaterShareOf(gas({ plant: { energy: 'heatPump' }, deliveries: strom, measured: { dhwKwh: 4500, totalKwh: null } }))), 'heatPumpBasis')
})

test('α: Lücke, fehlende Werte und Werte außerhalb sind Fehler wie in PR 10; Formel und Heizöl rechnen ab PR 11; ohne verbundenes Warmwasser kein α', () => {
  assert.equal(problemOf(hotWaterShareOf(gas({ fuelCoveragePermille: 848.71 }))), 'fuelGap')
  assert.equal(problemOf(hotWaterShareOf(gas({ deliveries: [{ ...gasRechnung, energyKwh: null }] }))), 'noFuelEnergy')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: null, totalKwh: null } }))), 'noDhwHeat')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: 60000, totalKwh: null } }))), 'outOfRange')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: 0, totalKwh: null } }))), 'outOfRange')
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'none' })), { ok: true, alpha: null })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'separate', plant: { energy: 'oil' } })), { ok: true, alpha: null })
  // Die Sperren `formulaLater` und `heatingValueLater` aus PR 10 fallen: 15.000 · 1,11 / 60.000 = 27,75 %.
  const formel = hotWaterShareOf(gas({ plant: { energy: 'gas', heatGeneration: 'single' }, row: { dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 } }))
  assert.ok(formel.ok && formel.alpha)
  near(formel.alpha.value, 0.2775, 'Volumenformel')
  assert.deepEqual(formel.alpha.statement.factor, { kind: 'gasCalorific', value: 1.11 })
  // Heizöl aus dem Vorrat: 9.000 kWh / 9,8 kWh/l = 918,37 l von 6.000 l = 15,31 %; Energie 58.800 kWh.
  const oel = { ...gasRechnung, id: 'o1', label: 'Öl Oktober', invoiceTo: null, deliveredAt: '2025-10-12', invoiceDate: null, energyKwh: null, gasBasis: null, quantity: 3000, quantityUnit: 'l' as const, heatingValue: 9.8 }
  const heizoel = hotWaterShareOf(gas({ plant: { energy: 'oil' }, fuelLines: [], stock: { unit: 'l', consumedQuantity: 6000 }, deliveries: [oel] }))
  assert.ok(heizoel.ok && heizoel.alpha)
  near(heizoel.alpha.value, 9000 / 58800, 'B / verbrauchte Menge')
  assert.equal(Math.round(heizoel.alpha.referenceKwh), 58800)
})
```

(c) `server/test/db-heizkosten.test.ts` (PR 10): Im Test „Einrichtung: …“ den zweiten Block
`await withDatabase(async (opened) => { await haus(opened, 'oil') … })` ganz ersetzen durch (die Sperre aus
PR 10 Abweichung 10 fällt):

```ts
  await withDatabase(async (opened) => {
    await haus(opened, 'oil')
    // Heizung PR 11: Warmwasseranteil mit dem Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV); die Sperre
    // aus PR 10 (Abweichung 10) fällt.
    const verbunden = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    assert.deepEqual([verbunden?.plant.method, verbunden?.plant.hotWater], ['self', 'combined'])
  })
```

(d) Datei `server/test/calc-warmwasser.test.ts`:

```ts
// Warmwasser ohne Zähler in der eigenen Heizkostenabrechnung (Heizung PR 11): die Hinweise und der
// Ausweis. Die Zahlen von α prüft dhw.test.ts; hier geht es um die Naht zu PR 10 und um das, was der
// Vermieter liest. Grundlage ist Beispiel A aus dem Entwurf 8.6 (server/testing/selfHeating.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfDelivery, selfSnapshot } from '../testing/selfHeating.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const partsOf = (s: ComputedSettlement, itemId: string) => s.landlord.rows.find((r) => r.costItemId === itemId)?.landlordParts ?? []
// `self.alpha.percent` ist α · 100 (PR 10); 0,15 · 100 ergibt im Gleitkomma 15,000000000000002.
const percentOf = (s: ComputedSettlement) => Math.round((selfOf(s).alpha?.percent ?? -1) * 100) / 100
const formel = { dhwMethod: 'volumeFormula' as const, dhwVolumeM3: 120, dhwTempC: 60, dhwUnmeasurable: null }
const brennwert = [selfDelivery({ gasBasis: 'hs' })]

test('Wärmezähler und Gas in kWh (Beispiel A, F16): α 15 % mit Rechenweg, keine neuen Hinweise, keine neuen Rechtswerte', () => {
  const s = computeSettlement(selfSnapshot())
  const self = selfOf(s)
  assert.equal(percentOf(s), 15)
  const dhw = self.dhw ?? assert.fail('kein Rechenweg')
  assert.deepEqual([dhw.alpha, dhw.factor, dhw.method], [0.15, null, 'heatMeter'])
  assert.ok(!(s.legalBasis.values ?? []).some((v) => v.id.startsWith('hkv.dhw.') || v.id === 'hkv.heating-values' || v.id === 'hkv.exemption.renewable'))
  for (const c of ['heating.dhw-not-metered', 'heating.dhw-share-implausible', 'heating.heating-value-from-table', 'heating.heat-pump-dhw-basis', 'heating.heat-pump-old-exemption']) {
    assert.ok(!codes(s).includes(c), c)
  }
})

test('Formel ohne bestätigten Aufwand bei eigener Abrechnung: 15 % auf den ganzen Anteil, je Mieter beziffert (BGH VIII ZR 151/20)', () => {
  const s = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: formel, deliveries: brennwert }))
  assert.equal(selfOf(s).dhw?.method, 'volumeFormula')
  const n = s.notices.find((x) => x.code === 'heating.dhw-not-metered') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Die Wärme für das Warmwasser ist mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen/)
  assert.match(n.text, /um 15 % kürzen \(BGH VIII ZR 151\/20\), hier: /)
  assert.ok((s.legalBasis.values ?? []).some((v) => v.id === 'hkv.dhw.volume-formula'))
  const bestaetigt = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: { ...formel, dhwUnmeasurable: true }, deliveries: brennwert }))
  assert.ok(!codes(bestaetigt).includes('heating.dhw-not-metered'))
})

test('Formel ohne Antwort zum Erzeuger: kein Anteil, Anlage nicht verteilt, Satz mit der Frage', () => {
  const s = computeSettlement(selfSnapshot({ row: formel, deliveries: brennwert }))
  const n = s.notices.find((x) => x.code === 'heating.dhw-share-invalid') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /ob die Anlage die Wärme allein erzeugt.*Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht/s)
  assert.equal(selfOf(s).dhw, undefined)
  assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
})

test('Ungewöhnlicher Anteil: Hinweis ohne Rechtsfolge', () => {
  // 2,5 · 2 · 50 · 1,11 = 277,5 kWh gegen 60.000 kWh: weit unter 5 %.
  const s = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: { ...formel, dhwVolumeM3: 2, dhwUnmeasurable: true }, deliveries: brennwert }))
  const n = s.notices.find((x) => x.code === 'heating.dhw-share-implausible') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Üblich sind Werte zwischen 5,00 % und 50,00 %; das ist keine Grenze des Gesetzes/)
})

test('Gas in m³ ohne Heizwert auf der Rechnung: Wert der Tabelle (Erdgas H) mit Hinweis; die frühere Sperre aus PR 10 fällt', () => {
  const m3 = selfDelivery({ label: 'Gas 2025 in m³', energyKwh: null, quantity: 6000, quantityUnit: 'm3', fuelGrade: 'naturalGasH' })
  const s = computeSettlement(selfSnapshot({ deliveries: [m3] }))
  const n = s.notices.find((x) => x.code === 'heating.heating-value-from-table') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /„Gas 2025 in m³“ nennt keinen Heizwert.*Erdgas H: 10 kWh je Kubikmeter \(§ 9 Abs\. 3 HeizkostenV, hilfsweise\)/)
  // 9.000 kWh / 10 kWh je m³ = 900 m³ von 6.000 m³ = 15 %.
  assert.equal(percentOf(s), 15)
})

test('Wärmepumpe mit Wärmezähler am Warmwasser ohne Gesamtwärme (A8, PR 10): Fehler, keine Verteilung', () => {
  const strom = selfDelivery({ label: 'Strom 2025', energyKwh: 12000, emissionsKg: null, co2CostCents: null })
  const s = computeSettlement(selfSnapshot({ plant: { energy: 'heatPump' }, deliveries: [strom], row: { dhwHeatKwh: 4500, totalHeatKwh: null } }))
  const n = s.notices.find((x) => x.code === 'heating.heat-pump-dhw-basis') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /etwa dreimal zu großen Warmwasseranteil/)
  assert.equal(selfOf(s).dhw, undefined)
})

test('Review Focus 5: Wärmepumpe 2024 (§ 11 Abs. 1 Nr. 3 Buchst. a a. F.): Hinweis statt Fehler, ohne Kürzung; mit weiterem Erzeuger bleibt der Fehler', () => {
  const strom = selfDelivery({ label: 'Strom 2024', energyKwh: 12000, emissionsKg: null, co2CostCents: null }, 2024)
  const wp = { energy: 'heatPump' as const, heatGeneration: 'single' as const }
  const s = computeSettlement(selfSnapshot({ year: 2024, plant: wp, deliveries: [strom], row: formel }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  const n = s.notices.find((x) => x.code === 'heating.heat-pump-old-exemption') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /überwiegend mit Wärme aus Wärmerückgewinnung, Wärmepumpen oder Solaranlagen \(§ 11 Abs\. 1 Nr\. 3 Buchst\. a HeizkostenV in der Fassung bis 30\.09\.2024\).*Kürzungen nach § 12 HeizkostenV entfallen/s)
  assert.match(n.text, /gemeinsam wie die Heizkosten \(Festlegung von Mietfuchs\)/)
  assert.equal(selfOf(s).alpha, null)
  assert.deepEqual(partsOf(s, 'gas'), [], 'verteilt, nichts beim Vermieter')
  assert.ok(!codes(s).includes('heating.dhw-not-metered'), 'keine Kürzung')
  assert.ok((s.legalBasis.values ?? []).some((v) => v.id === 'hkv.exemption.renewable'))
  const gemischt = computeSettlement(selfSnapshot({ year: 2024, plant: { ...wp, heatGeneration: 'mixed' }, deliveries: [strom], row: formel }))
  assert.ok(codes(gemischt).includes('heating.dhw-share-invalid'))
  assert.ok(!codes(gemischt).includes('heating.heat-pump-old-exemption'))
  // Ab dem 01.10.2024 gilt die Ausnahme nicht mehr: 2025 rechnet die Formel mit 0,30.
  const neu = computeSettlement(selfSnapshot({ plant: wp, deliveries: [selfDelivery({ label: 'Strom 2025', energyKwh: 12000, emissionsKg: null, co2CostCents: null })], row: formel }))
  assert.ok(!codes(neu).includes('heating.heat-pump-old-exemption'))
  assert.equal(selfOf(neu).dhw?.factor?.kind, 'heatPump')
})

test('Stromheizung gemessen (Abweichung 7): rechnet wie in PR 10 gegen den Strom laut Rechnung', () => {
  const strom = selfDelivery({ label: 'Strom 2025', energyKwh: 60000, emissionsKg: null, co2CostCents: null })
  const s = computeSettlement(selfSnapshot({ plant: { energy: 'electric' }, deliveries: [strom] }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(percentOf(s), 15)
  assert.equal(selfOf(s).dhw?.denominator.kind, 'electricity')
})
```

Die Zahlen der Wärmepumpe 2024 (Review Focus 5): Ohne Faktor gibt es kein α; die Positionen „Heizung und
Warmwasser“ gehen ganz in den Topf Heizung (Abweichung 9), die Miete der Warmwasserzähler in den Topf
Warmwasser. Ein Betrag wird hier nicht festgehalten, weil er an den Gradtagen von 2024 hängt; der Test hält
fest, dass nichts beim Vermieter bleibt.

- [ ] **Step 3: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/dhw.test.ts test/heating.test.ts test/calc-heizkosten.test.ts test/db-heizkosten.test.ts test/calc-warmwasser.test.ts`
Expected: FAIL; dhw.test.ts mit „does not provide an export named 'dhwInputOf'“, heating.test.ts mit
Typfehlern an `AlphaInput` (zur Laufzeit `problem: 'formulaLater'`), db-heizkosten.test.ts mit 400
„…späteren Version…Heizwert“, calc-warmwasser.test.ts mit `heating.dhw-share-invalid` statt
`heating.dhw-not-metered`. Der Gleichheitstest in calc-heizkosten.test.ts ist schon grün (er prüft nur
den Helfer).

- [ ] **Step 4: Naht in `server/src/dhw.ts`**

Den Typimport prüfen (`HeatGeneration`, `DhwMethod`, `HeatingValueUnit` sind seit Task 3 da). Ans
Dateiende:

```ts
// ---------- Naht zur eigenen Heizkostenabrechnung (PR 10) ----------

// Was die eigene Heizkostenabrechnung an der Stelle hat, an der sie α bestimmt (`hotWaterShareOf` in
// heating.ts, aufgerufen im Block des Plans von `computeSettlement`). Ohne Vorrat kommen die Anteile der
// Rechnungen aus der Bewertung von PR 7 (`sharePermille`); mit Vorrat zählt die verbrauchte Menge (PR 8),
// und der Heizwert kommt von den Lieferungen der Heizperiode oder, ohne sie, von der jüngsten früheren
// (Abweichung 6).
export type DhwContext = {
  plant: { energy: HeatingEnergy; heatGeneration?: HeatGeneration | null }
  row: { dhwMethod: DhwMethod | null; dhwVolumeM3?: number | null; dhwTempC?: number | null } | null
  h: Period
  fuelLines: readonly { deliveryId: string; sharePermille: number }[]
  stock: { unit: HeatingValueUnit; consumedQuantity: number } | null
  deliveries: readonly Omit<EnergyDelivery, 'share'>[]
  units: readonly Pick<SnapshotUnit, 'areaM2' | 'noConnection'>[]
  measured: { dhwKwh: number | null; totalKwh: number | null }
  fuelCoveragePermille: number | null
  fuelEstimated: boolean
}

export function dhwInputOf(c: DhwContext): DhwInput {
  let generator: GeneratorInput
  if (c.stock !== null) {
    const own = deliveriesInPeriod(c.deliveries, c.h).map((d) => ({ ...d, share: 1 }))
    const earlier = own.length > 0 ? null : latestBefore(c.deliveries, c.h, c.stock.unit)
    generator = { deliveries: own, stock: { unit: c.stock.unit, consumed: c.stock.consumedQuantity }, earlier: earlier ? { ...earlier, share: 1 } : null }
  } else {
    const byId = new Map(c.deliveries.map((d) => [d.id, d]))
    generator = {
      deliveries: c.fuelLines.flatMap((l) => {
        const d = byId.get(l.deliveryId)
        return d ? [{ ...d, share: l.sharePermille / 1000 }] : []
      }),
      stock: null,
      earlier: null,
    }
  }
  return {
    energy: c.plant.energy,
    heatGeneration: c.plant.heatGeneration ?? null,
    h: c.h,
    // Ohne Angabe gilt die Regel des § 9 Abs. 2 Satz 1: gemessen (wie PR 10).
    method: c.row?.dhwMethod ?? 'heatMeter',
    measured: c.measured,
    volumeM3: c.row?.dhwVolumeM3 ?? null,
    tempC: c.row?.dhwTempC ?? null,
    suppliedAreaM2: suppliedAreaOf(c.units),
    generator,
    fuelCoveragePermille: c.fuelCoveragePermille,
    fuelEstimated: c.fuelEstimated,
  }
}

// Der Satz zu einem Anteil, den Mietfuchs nicht bestimmen kann. Ohne Ort und ohne Folge: Beides setzt
// `computeSettlement` davor bzw. dahinter („Bis dahin verteilt Mietfuchs …“, PR 10 Task 8).
export function dhwProblemText(o: { problem: DhwProblem; reasons: readonly string[] }): string {
  if (o.problem === 'heatPumpBasis') {
    return 'Der Wärmezähler misst die Wärme für das Warmwasser, aber die gesamte Wärme der Wärmepumpe kennt Mietfuchs nicht. ' +
      'Geteilt durch den Strom ergäbe das einen etwa dreimal zu großen Warmwasseranteil, denn die Wärmepumpe macht aus einer Kilowattstunde Strom mehrere Kilowattstunden Wärme; ' +
      'bei Wärmepumpen richtet sich die Aufteilung nach dem Wärmeverbrauch (§ 9 Abs. 1 Satz 2 HeizkostenV). ' +
      'Legen Sie einen Gesamtwärmezähler an (Rolle „Gesamtwärme“) oder tragen Sie die gemessene Gesamtwärme der Heizperiode auf der Seite Heizkosten ein, oder wählen Sie eine Formel nach § 9 Abs. 2 HeizkostenV.'
  }
  return `Mietfuchs kann den Warmwasseranteil nicht bestimmen, denn ${andList(o.reasons)} (§ 9 HeizkostenV).`
}
```

- [ ] **Step 5: Naht in `server/src/heating.ts` und die Sperren von PR 10**

`server/src/heating.ts`: Importe `import { dhwInputOf, dhwShareOf, type DhwContext, type DhwProblem } from './dhw.ts'`;
`DhwStatement` zum Typimport aus `'../../shared/types.ts'`; `type LawLog` in den Import aus
`'../../shared/law/register.ts'`. Im Abschnitt „Warmwasseranteil“ von PR 10 (Task 4) alles von
`export const KWH_ENERGIES` bis zum Ende von `hotWaterShareOf` (also `KWH_ENERGIES`, `AlphaInput`,
`AlphaProblem`, `Alpha`, `COVERAGE_FULL` und `hotWaterShareOf`) ersetzen durch:

```ts
// ---------- Warmwasseranteil (Entwurf 8.3; ab Heizung PR 11 aus dhw.ts) ----------

// Was die eigene Heizkostenabrechnung zum Warmwasseranteil hineinreicht (dhw.ts `DhwContext`), dazu die
// Warmwasserbereitung der Anlage und das Protokoll der Rechtswerte, denn die Formeln fragen das Register.
// Die Sperren `formulaLater` und `heatingValueLater` aus PR 10 (Abweichung 10 dort) fallen: dhw.ts rechnet
// alle drei Verfahren des § 9 Abs. 2 und Brennstoff als Menge mit dem Heizwert (Abs. 3).
export type AlphaInput = DhwContext & { hotWater: HotWater; log: LawLog }
export type AlphaProblem = DhwProblem
// α mit dem Rechenweg aus dhw.ts. `referenceKwh` ist die Energie des Nenners in kWh, auch bei Brennstoff
// als Menge: B / Menge = Q / (Menge · Hᵢ).
export type Alpha = { value: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean; statement: DhwStatement }

// α nach § 9 Abs. 1 Satz 2, Abs. 2 und 3 HeizkostenV. Ohne verbundene Warmwasserbereitung gibt es kein α.
export function hotWaterShareOf(i: AlphaInput): { ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem; reasons: string[] } {
  if (i.hotWater !== 'combined') return { ok: true, alpha: null }
  const o = dhwShareOf(dhwInputOf(i), i.log)
  if (!o.ok) return { ok: false, problem: o.problem, reasons: o.reasons }
  const st = o.statement
  return {
    ok: true,
    alpha: {
      value: st.alpha, dhwHeatKwh: st.heatKwh, referenceKwh: st.energyKwh,
      reference: st.denominator.kind === 'measuredTotalHeat' ? 'totalHeat' : 'fuel',
      estimated: st.estimated, statement: st,
    },
  }
}
```

`DhwMethod` und `HeatingEnergy` bleiben im Typimport, solange heating.ts sie sonst braucht (`OIL_OR_GAS`,
`consumptionSharesOf`); `grep -n "KWH_ENERGIES" server client shared` muss danach nur noch die Stelle in
db/heating.ts finden, die der nächste Absatz löscht.

`server/src/db/heating.ts` (PR 10 Task 5): In `guardHeatingPlant` die Zeile
`if (after.hotWater === 'combined' && !KWH_ENERGIES.includes(after.energy)) throw new HeatingError(400, LATER.dhwHeatingValue)`
löschen, in `LATER` den Eintrag `dhwHeatingValue` löschen und `KWH_ENERGIES` aus dem Import von
`'../heating.ts'` nehmen (steht danach nichts mehr in dem Import, fällt er ganz).

- [ ] **Step 6: Hinweise und Ausweis (`server/src/calc.ts`, `shared/types.ts`)**

`shared/types.ts`, in `SelfHeatingStatement` (PR 10) hinter `alpha`:

```ts
  // Der Rechenweg zum Warmwasseranteil (Heizung PR 11, Entwurf 8.8 „α mit Methode“); fehlt ohne α.
  dhw?: DhwStatement
```

`server/src/calc.ts`, Importe: `import { DHW_PLAUSIBLE, dhwProblemText, fmtShare } from './dhw.ts'`,
`import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'`,
`hkvRenewableExemption` in den Import aus `'../../shared/law/heizkostenv.ts'`. `AlphaProblem` aus dem
Import aus `'./heating.ts'` nehmen, wenn es danach nicht mehr gebraucht wird.

In `noticeKinds` hinter den Codes von PR 10:

```ts
  // Heizung PR 11 (Entwurf 8.3, 10.1; Abweichung 9)
  'heating.heating-value-from-table': { level: 'hint', title: 'Heizwert aus der Tabelle der Heizkostenverordnung', rule: 'heating-dhw-split', terms: ['hotWaterShare'] },
  // Plausibilität ohne Rechtsfolge (Entwurf 15.2 F6), deshalb ohne Regel.
  'heating.dhw-share-implausible': { level: 'hint', title: 'Warmwasseranteil ungewöhnlich', terms: ['hotWaterShare'] },
  'heating.heat-pump-old-exemption': { level: 'hint', title: 'Wärmepumpe: Heizkostenverordnung galt in diesem Zeitraum nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatMeter'] },
```

`type SelfPlantPlan` (PR 10 Task 8) bekommt als letztes Feld:

```ts
    // § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11, Abweichung 9): Wärmepumpe ohne weiteren Erzeuger in
    // einem Zeitraum, der vor dem 01.10.2024 beginnt. Dann keine Kürzungsbeträge und kein Fehler zu α.
    oldHeatPumpExemption: boolean
```

`ALPHA_TEXT` (PR 10 Task 8 Step 7) löschen. Im Block des Plans die Zeilen von
`const fuelKwh = fuelOfPlant && …` bis zum Ende des Aufrufs `const alphaResult = hotWaterShareOf({ … })`
ersetzen durch:

```ts
    // Heizung PR 11: der Warmwasseranteil nach allen drei Verfahren des § 9 Abs. 2 (dhw.ts). Beim Vorrat
    // (PR 8) zählt die verbrauchte Menge, sonst die Bewertung der Rechnungen (PR 7).
    const stockOfThis = stockOfPlant.get(plant.id)?.result
    const alphaResult = hotWaterShareOf({
      hotWater,
      log: lawLog,
      plant: { energy: plant.energy, heatGeneration: plant.heatGeneration ?? null },
      row: own ? { dhwMethod: own.dhwMethod ?? null, dhwVolumeM3: own.dhwVolumeM3 ?? null, dhwTempC: own.dhwTempC ?? null } : null,
      h: { from: period.from, to: period.to },
      fuelLines: fuelOfPlant?.lines ?? [],
      stock: stockOfThis?.ok ? { unit: stockOfThis.statement.unit, consumedQuantity: stockOfThis.statement.consumed.quantity } : null,
      deliveries: (snapshot.fuel?.deliveries ?? []).filter((d) => d.plantId === plant.id),
      units: served,
      measured: { dhwKwh: own?.dhwHeatKwh ?? plantMeterKwh('dhwHeat'), totalKwh: own?.totalHeatKwh ?? plantMeterKwh('totalHeat') },
      fuelCoveragePermille: fuelOfPlant?.coveragePermille ?? null,
      // Die Schätzung beim Abschluss (PR 7) trägt bei der Lieferung `estimated` (PR 10 Abweichung 11).
      fuelEstimated: fuelOfPlant?.lines.some((l) => l.estimated) ?? false,
    })
    // § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Abweichung 9): Das Register wird nur bei einer Wärmepumpe ohne
    // weiteren Erzeuger gefragt; so steht der Wert nur dann im Rechtsstand.
    const renewable = plant.energy === 'heatPump' && (plant.heatGeneration ?? null) !== 'mixed'
      ? law(hkvRenewableExemption, { period: lawPeriod }, lawLog)
      : null
    const oldHeatPumpExemption = renewable?.heatPump === true
    // Unter dieser Ausnahme bindet § 9 nicht: Ohne bestimmbares α gehen „Heizung und Warmwasser“ ganz in
    // den Topf Heizung (Festlegung, Abweichung 9), und es gibt keinen Fehler.
    const alpha = alphaResult.ok ? alphaResult.alpha : null
```

Die Zeile
`if (!alphaResult.ok) blocked.push({ code: alphaResult.problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', text: ALPHA_TEXT[alphaResult.problem] })`
ersetzen durch:

```ts
    if (!alphaResult.ok && !oldHeatPumpExemption) {
      blocked.push({ code: alphaResult.problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', text: dhwProblemText(alphaResult) })
    }
```

Direkt hinter der Zeile `for (const b of blocked) warn(b.code, …)`:

```ts
    const plantSubjectSelf: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    if (renewable && oldHeatPumpExemption) {
      warn('heating.heat-pump-old-exemption',
        `${where}: Für diesen Abrechnungszeitraum galten die Vorschriften der Heizkostenverordnung zur Erfassung und Verteilung nicht für Räume in Gebäuden, die überwiegend mit Wärme aus ${hkvRenewableExemption.describe(renewable)} versorgt werden. ` +
          'Dann gilt die Verteilung laut Mietvertrag, und Kürzungen nach § 12 HeizkostenV entfallen. Mietfuchs verteilt nach den erfassten Werten, wie Sie es eingerichtet haben' +
          (alpha === null && hotWater === 'combined'
            ? '; einen Warmwasseranteil nach § 9 HeizkostenV verlangt die Verordnung dann nicht, und die Kosten von Heizung und Warmwasser verteilt Mietfuchs gemeinsam wie die Heizkosten (Festlegung von Mietfuchs)'
            : '') +
          '. Erzeugt ein weiterer Erzeuger einen erheblichen Teil der Wärme, wählen Sie bei der Anlage „mit einem weiteren Erzeuger“; dann galt die Verordnung.',
        plantSubjectSelf)
    }
    if (alpha) {
      // Heizwert hilfsweise aus der Tabelle (§ 9 Abs. 3 HeizkostenV, Entwurf R-A13).
      for (const v of alpha.statement.heatingValues.filter((x) => x.source === 'table')) {
        warn('heating.heating-value-from-table',
          `${where}: Die Rechnung „${v.label}“ nennt keinen Heizwert. Mietfuchs rechnet deshalb mit dem Wert der Heizkostenverordnung für ` +
            `${v.grade ? FUEL_GRADE_LABELS[v.grade] : 'diesen Brennstoff'}: ${v.kwh.toLocaleString('de-DE')} kWh je ${HEATING_VALUE_UNIT_TEXT[v.per]} (§ 9 Abs. 3 HeizkostenV, hilfsweise). ` +
            'Steht ein Heizwert auf der Rechnung, tragen Sie ihn an der Lieferung ein; er geht vor.',
          plantSubjectSelf)
      }
      // Plausibilität (Entwurf 15.2 F6): kein Recht, nur ein Anlass zu prüfen.
      if (alpha.value < DHW_PLAUSIBLE.min || alpha.value > DHW_PLAUSIBLE.max) {
        warn('heating.dhw-share-implausible',
          `${where}: Der Warmwasseranteil liegt bei ${fmtShare(alpha.value)}. Üblich sind Werte zwischen ${fmtShare(DHW_PLAUSIBLE.min)} und ${fmtShare(DHW_PLAUSIBLE.max)}; das ist keine Grenze des Gesetzes, ` +
            'sondern nur ein Anlass, die Angaben zu prüfen: die Wärme oder das Warmwasser und seine Temperatur, die Wohnflächen und die Energie der Rechnungen.',
          plantSubjectSelf)
      }
    }
```

Die Gewichte: In `const weights = blocked.length === 0 && shares !== null && alphaResult.ok ? weightsOf(…, alphaResult.alpha?.value ?? null) : null`
die Bedingung `alphaResult.ok` durch `(alphaResult.ok || oldHeatPumpExemption)` und
`alphaResult.alpha?.value ?? null` durch `alpha?.value ?? null` ersetzen. Im Objekt von
`selfPlans.set(plant.id, { … })` `alpha: alphaResult.ok ? alphaResult.alpha : null` durch `alpha` ersetzen
und `oldHeatPumpExemption,` anhängen.

Die Ausnahme wirkt wie eine Wärmepumpe, für die die Verordnung noch nicht gilt (PR 10, `notYet`): In der
Hinweisschleife der eigenen Abrechnung (PR 10 Task 9 Step 8) die Zeile
`const notYet = sp.verdict?.kind === 'notYet'` ersetzen durch

```ts
    // § 12 Abs. 3 (PR 10) oder § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11): keine Kürzungsbeträge.
    const notYet = sp.verdict?.kind === 'notYet' || sp.oldHeatPumpExemption
```

In `selfStatementOf` (PR 10 Task 9 Step 7) im zurückgegebenen Objekt hinter `alpha: …`:

```ts
      ...(sp.alpha ? { dhw: sp.alpha.statement } : {}),
```

Im CO₂-Block (PR 6) die Bedingung des Hinweises `heating.dhw-not-metered` und seinen ersten Satz ersetzen.
Bisher:

```ts
    if (pot.method === 'service' && hw && hw.dhwMethod !== null && FORMULA_METHODS.includes(hw.dhwMethod) && hw.dhwUnmeasurable !== true) {
      const cut = law(hkvCutNotByConsumption, { period: hPeriod }, lawLog)
      warn('heating.dhw-not-metered',
        `${where}: Laut Abrechnung wurde die Wärme für das Warmwasser mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen. ` +
```

Neu:

```ts
    // Bei eigener Abrechnung nur, wenn Mietfuchs den Anteil nach einer Formel gerechnet hat, und nicht unter
    // der Ausnahme des § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Heizung PR 11, Entwurf 8.3, Abweichung 9).
    const selfOfPot = selfPlans.get(pot.plantId)
    const formulaHere = pot.method === 'service' ||
      (pot.method === 'self' && selfOfPot !== undefined && !selfOfPot.oldHeatPumpExemption && (selfOfPot.alpha?.statement.method ?? 'heatMeter') !== 'heatMeter')
    if (formulaHere && hw && hw.dhwMethod !== null && FORMULA_METHODS.includes(hw.dhwMethod) && hw.dhwUnmeasurable !== true) {
      const cut = law(hkvCutNotByConsumption, { period: hPeriod }, lawLog)
      warn('heating.dhw-not-metered',
        `${where}: ${pot.method === 'self' ? 'Die Wärme für das Warmwasser ist' : 'Laut Abrechnung wurde die Wärme für das Warmwasser'} mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen. ` +
```

Der Rest des Aufrufs bleibt wortgleich (der Satz zum Wortlaut, „um ${cut} % kürzen (BGH VIII ZR
151/20)${cutsOn(ids, cut)}“, die Bestätigung). `ids` sind die Positionen des Topfs der Anlage in der
Heizperiode: der ganze Anteil an Heiz- und Warmwasserkosten (Entwurf 6.5, R-A6). Der Satz für den
Messdienst bleibt Wort für Wort; die Tests von PR 6 bleiben grün. `selfPlans` steht vor dem CO₂-Block
(PR 10 Task 8 Step 7: „vor der Zeile `const co2Pots = co2PotsOf(…)`“).

`NoticeSubject` steht im Typimport von calc.ts seit #112. Heißt das Feld mit den Lieferungen im
Schnappschuss nicht `snapshot.fuel?.deliveries` (PR 7, `SnapshotFuel`), gilt dessen Name.

- [ ] **Step 7: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/dhw.test.ts test/heating.test.ts test/calc-heizkosten.test.ts test/db-heizkosten.test.ts test/calc-warmwasser.test.ts test/law-literals.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS (`dhw.test.ts`: 18, `calc-warmwasser.test.ts`: 8). Der Test von PR 10 „Review Focus 5:
deckt die Gasrechnung die Heizperiode nicht ab …“ prüft `/Folgerechnung.*Schätzung/s` und bleibt grün:
Der Satz kommt jetzt aus `gapOf` in dhw.ts. Ebenso „A8: Wärmepumpe mit Wärmezähler am Warmwasser …“
(`heating.heat-pump-dhw-basis`).

- [ ] **Step 8: Alle Tests, Golden und Commit**

Run: `npm test`
Expected: PASS; `settlement-golden.test.ts`, `db-golden.test.ts` und `heating-golden.test.ts`
unverändert: F16 rechnet gemessen mit Gas in kWh und fragt kein neues Register, F17 hat kein Warmwasser
(PR 10 Abweichung 20).

```bash
git add server/testing/selfHeating.ts server/src/dhw.ts server/src/heating.ts server/src/calc.ts server/src/db/heating.ts shared/types.ts server/test/dhw.test.ts server/test/heating.test.ts server/test/calc-heizkosten.test.ts server/test/db-heizkosten.test.ts server/test/calc-warmwasser.test.ts
git commit -m "Eigene Heizkostenabrechnung: Warmwasseranteil auch nach Formel und mit Heizwert

Die Stelle, an der PR 10 den Anteil bestimmt, rechnet jetzt alle drei Verfahren des § 9 Abs. 2
HeizkostenV; die Sperren für Formel und Heizwert fallen. Neue Hinweise: Heizwert aus der Tabelle,
ungewöhnlicher Anteil, Wärmepumpe vor dem 01.10.2024 (§ 11 Abs. 1 Nr. 3 a. F.); die Kürzung um
15 % bei einer Formel ohne Grund gilt jetzt auch bei eigener Abrechnung. Testhelfer selfSnapshot
mit Gleichheitstest gegen Beispiel A über die Datenbank.

Refs #99
Refs #211"
```

---

### Task 5: Warmwasser bei eigener Abrechnung speichern und anzeigen

**Files:**
- Modify: `server/src/db/co2.ts` (`saveHotWater`, `heatingPeriodViews`), `shared/types.ts` (`HeatingPeriodView`)
- Test: `server/test/db-warmwasser.test.ts` (ergänzen), `server/test/api.test.ts` (ergänzen), `server/test/db-co2.test.ts` (ein Test von PR 6, falls er `self` prüft)

**Interfaces:**
- Consumes: Task 3 `suppliedAreaOf`; PR 6 `saveHotWater`, `heatingPeriodViews`, `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`; repository.ts `has`, `raw`, `nullableNumber`, `HeatingError`; read.ts `readUnits`, `readMeters`, `readReadings`; calc.ts `consumptionInPeriod`; PR 5 `servesUnit(plant, unit)` (shared/heatingPeriod.ts); PR 10 `setUpSelf(db, plantId, body, today, newId)` (db/heatingSelf.ts) und die Route `PUT /api/heating-plants/:id/self` (eine Anlage wird nur über die Einrichtung zur eigenen Abrechnung, PR 10 Abweichung 17).
- Produces:
  - `HeatingPeriodView.hotWater: Pick<HeatingPeriodData, 'dhwMethod' | 'dhwUnmeasurable' | 'dhwHeatKwh' | 'totalHeatKwh' | 'dhwVolumeM3' | 'dhwTempC'>`
  - `HeatingPeriodView.hotWaterBasis: { volumeFromMetersM3: number | null; suppliedAreaM2: number }`
  - `saveHotWater` nimmt bei `self` zusätzlich `dhwVolumeM3`, `dhwTempC` (ergänzend: was fehlt, bleibt)

`readUnits`, `readMeters`, `readReadings` sind die Lesefunktionen in read.ts, aus denen `Stock`
entsteht; heißen sie anders, hier anpassen. `servesUnit` ist die Frage „versorgt diese Anlage diese
Wohnung?“ aus PR 5 (Plan PR 7, Zeile „PR 5“); hat sie eine andere Signatur, wird die Liste der
angeschlossenen Wohnungen so gebildet, wie PR 10 sie für die Verteilung bildet.

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/db-warmwasser.test.ts`: Importe um `heatingPeriodViews, saveHotWater` aus
`'../src/db/co2.ts'` und `setUpSelf` aus `'../src/db/heatingSelf.ts'` ergänzen; ans Dateiende:

```ts
let ids = 0
const newId = () => `m-${++ids}`
// Eine Anlage wird nur über die Einrichtung zur eigenen Abrechnung (PR 10 Abweichung 17): erst „Niemand“,
// dann Schritt 7. Die Einrichtung legt die fehlenden Zähler an; der Warmwasserzähler von A steht schon da.
async function eigeneAnlage(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 60, participates: true, noConnection: ['warmwasser'] })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await createEntity(db, 'meters', 'ww-a', { propertyId: 'objekt-1', unitId: 'a', name: 'WW A', type: 'warmwasser', unit: 'm³' })
    await createEntity(db, 'readings', 'r1', { meterId: 'ww-a', date: '2024-12-31', value: 100 })
    await createEntity(db, 'readings', 'r2', { meterId: 'ww-a', date: '2025-12-31', value: 132.5 })
  })
  await opened.write((db) => setUpSelf(db, 'hp', {
    period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter',
    dhwHeatMeter: false, totalHeatMeter: false,
  }, '2026-02-01', newId))
}

test('Warmwasser bei eigener Abrechnung: Formel mit Volumen und Temperatur; ergänzend gespeichert; Vorschlag aus den Zählern und versorgte Fläche', async () => {
  await withDatabase(async (opened) => {
    await eigeneAnlage(opened)
    const speichern = (body: unknown) => opened.write((db) => saveHotWater(db, 'hp', '2025-01', body))
    const a = await speichern({ dhwMethod: 'volumeFormula', dhwVolumeM3: 32.5, dhwTempC: 55 }) ?? assert.fail('keine Anlage')
    assert.deepEqual([a.dhwMethod, a.dhwVolumeM3, a.dhwTempC, a.dhwUnmeasurable], ['volumeFormula', 32.5, 55, null])
    // Ein Teilrumpf lässt die übrigen Werte stehen.
    const b = await speichern({ dhwMethod: 'volumeFormula', dhwUnmeasurable: true }) ?? assert.fail('keine Anlage')
    assert.deepEqual([b.dhwVolumeM3, b.dhwTempC, b.dhwUnmeasurable], [32.5, 55, true])
    await assert.rejects(speichern({ dhwVolumeM3: -1 }), heatingError(400, /ab 0 m³/))
    await assert.rejects(speichern({ dhwTempC: 120 }), heatingError(400, /zwischen 0 und 100 °C/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    // Zähler der Wohnung A: 132,5 − 100 = 32,5 m³; Fläche nur A (B hat kein Warmwasser).
    assert.deepEqual(view?.hotWaterBasis, { volumeFromMetersM3: 32.5, suppliedAreaM2: 80 })
    assert.equal(view?.hotWater.dhwVolumeM3, 32.5)
  })
})

test('Warmwasser beim Messdienst: Volumen und Temperatur werden nicht gespeichert, die Angabe zum Verfahren wie bisher', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
    })
    const r = await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'areaFormula', dhwVolumeM3: 10, dhwTempC: 55 })) ?? assert.fail('keine Anlage')
    assert.deepEqual([r.dhwMethod, r.dhwVolumeM3, r.dhwTempC], ['areaFormula', null, null])
  })
})
```

Der Rumpf von `setUpSelf` ist der von PR 10 (`SETUP` in db-heizkosten.test.ts) ohne Zähler an der
Anlage. Die Einrichtung legt für B einen Warmwasserzähler ohne Ablesung an; er trägt 0 m³ bei und ändert
die Summe 32,5 m³ nicht.

(b) `server/test/api.test.ts`, im Block der Heizanlagen (PR 6: „Routen für CO₂-Angaben und
Warmwasser“) ergänzen:

```ts
test('Warmwasser (Heizung PR 11): PUT nimmt bei eigener Abrechnung Volumen und Temperatur, GET der Heizperioden zeigt sie', async () => {
  await withServer(async (base, send) => {
    // POST liefert `{ plant, assigned }` (PR 4); zur eigenen Abrechnung über die Einrichtung (PR 10).
    const { plant } = await jsonOf<{ plant: { id: string } }>(await send(`${base}/api/heating-plants`, { method: 'POST', body: JSON.stringify({ energy: 'gas', method: 'manual' }) }))
    const setup = await send(`${base}/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify({
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: false, totalHeatMeter: false,
    }) })
    assert.equal(setup.status, 200)
    const put = await send(`${base}/api/heating-plants/${plant.id}/periods/2025-01/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 }) })
    assert.equal(put.status, 200)
    assert.deepEqual(pick(await jsonOf<Record<string, unknown>>(put), ['dhwMethod', 'dhwVolumeM3', 'dhwTempC']), { dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 })
    const views = await jsonOf<{ hotWater: { dhwTempC: number | null } }[]>(await send(`${base}/api/heating-plants/${plant.id}/periods?period=2025`))
    assert.equal(views[0]?.hotWater.dhwTempC, 60)
  })
})
```

`withServer`, `send`, `jsonOf` sind die Helfer, die PR 6 im Test der Routen benutzt; `pick` ist dort
oder wird hier als `const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]))`
angelegt. Die Route der Heizperioden heißt so, wie PR 6 sie angelegt hat (`GET
/api/heating-plants/:id/periods`); heißt sie anders, hier anpassen.

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/db-warmwasser.test.ts test/api.test.ts`
Expected: FAIL; mit 400 aus `saveHotWater` (PR 6 lässt die Angabe nur bei `method = 'service'` zu:
„… gibt es hier nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet …“) bzw.
`undefined` bei `dhwVolumeM3`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

In `HeatingPeriodView` (PR 6, nach PR 10 mit den Feldern aus B10) `hotWater` ersetzen und
`hotWaterBasis` anhängen:

```ts
  hotWater: Pick<HeatingPeriodData, 'dhwMethod' | 'dhwUnmeasurable' | 'dhwHeatKwh' | 'totalHeatKwh' | 'dhwVolumeM3' | 'dhwTempC'>
  // Für die Formeln (Heizung PR 11): Σ der Warmwasserzähler der angeschlossenen Wohnungen in der
  // Heizperiode als Vorschlag für V (null ohne solche Zähler) und die mit Warmwasser versorgte Fläche.
  hotWaterBasis: { volumeFromMetersM3: number | null; suppliedAreaM2: number }
```

- [ ] **Step 4: Speichern (`server/src/db/co2.ts`)**

Importe: `nullableNumber` aus `'./repository.ts'` (neben `has`, `raw`), `suppliedAreaOf` aus
`'../dhw.ts'`, `consumptionInPeriod` aus `'../calc.ts'`, `servesUnit` aus
`'../../../shared/heatingPeriod.ts'`, `readMeters, readReadings, readUnits` aus `'./read.ts'`.

Über `saveHotWater`:

```ts
// Eingaben der Formeln (Heizung PR 11, § 9 Abs. 2 Satz 2 HeizkostenV): das gemessene Volumen und die
// gemessene oder geschätzte mittlere Temperatur. Ergänzend wie die Sammlungen in repository.ts: Was im
// Rumpf steht, ersetzt; was fehlt, bleibt.
function readFormulaInputs(body: unknown): { dhwVolumeM3?: number | null; dhwTempC?: number | null } {
  const out: { dhwVolumeM3?: number | null; dhwTempC?: number | null } = {}
  if (has(body, 'dhwVolumeM3')) {
    const v = nullableNumber(raw(body, 'dhwVolumeM3'))
    if (v !== null && !(v >= 0)) throw new HeatingError(400, 'Das Volumen des Warmwassers ist eine Zahl ab 0 m³.')
    out.dhwVolumeM3 = v
  }
  if (has(body, 'dhwTempC')) {
    const t = nullableNumber(raw(body, 'dhwTempC'))
    if (t !== null && !(t > 0 && t < 100)) throw new HeatingError(400, 'Die mittlere Temperatur des Warmwassers liegt zwischen 0 und 100 °C.')
    out.dhwTempC = t
  }
  return out
}
```

In `saveHotWater` (Fassung PR 10):

1. Die Sperre von PR 6 fällt für `self` (Prüfbericht B.1, Zeile B4): Die Zeile
   `if (ctx.plant.method !== 'service') {` wird zu `if (ctx.plant.method === 'manual') {`, und ihr Satz
   wird zu: `'Die Angaben zum Warmwasser gibt es nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet, oder bei eigener Heizkostenabrechnung. Bei freien Schlüsseln verteilen die Positionen selbst.'`
   Der Test von PR 6 prüft `/Messdienst oder die Gemeinschaft/` und bleibt grün. Prüft ein Test von PR 6
   die Ablehnung bei `self` (`/späteren Version selbst/`), wird er auf `method: 'manual'` umgestellt.
2. Vor `await db.transaction(…)`:

```ts
  // Beim Messdienst steht das Ergebnis in seiner Abrechnung; Volumen und Temperatur gibt es nur bei
  // eigener Abrechnung (Heizung PR 11).
  const formulaInputs = ctx.plant.method === 'self' ? readFormulaInputs(body) : { dhwVolumeM3: null, dhwTempC: null }
```

3. Im `tx.update(heatingPeriods).set({ … })` der Transaktion `...formulaInputs` ergänzen.
4. Den Rückgabewert aus der Zeile nach dem Schreiben bilden. Ersetzt `return { … }` am Ende durch:

```ts
  const [row] = await db.select().from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
  if (!row) throw new HeatingError(400, 'Die Heizperiode konnte nicht angelegt werden. Bitte laden Sie die Seite neu.')
  return {
    dhwMethod: row.dhwMethod, dhwUnmeasurable: row.dhwUnmeasurable, dhwHeatKwh: row.dhwHeatKwh, totalHeatKwh: row.totalHeatKwh,
    dhwVolumeM3: row.dhwVolumeM3, dhwTempC: row.dhwTempC,
  }
```

(`and` zum Import aus `'drizzle-orm'` ergänzen, falls nicht vorhanden.)

- [ ] **Step 5: Ansicht (`heatingPeriodViews` in `server/src/db/co2.ts`)**

In `heatingPeriodViews` (PR 6) vor der Schleife über die Heizperioden:

```ts
  // Für die Formeln (Heizung PR 11): angeschlossene Wohnungen, ihre Warmwasserzähler und Ablesungen.
  const units = (await readUnits(db)).filter((u) => u.propertyId === ctx.plant.propertyId && servesUnit(ctx.plant, u))
  const unitIds = new Set(units.map((u) => u.id))
  const waterMeters = (await readMeters(db)).filter((m) => m.type === 'warmwasser' && m.unitId !== null && unitIds.has(m.unitId))
  const readings = await readReadings(db)
```

und im Objekt je Heizperiode `hotWater` und `hotWaterBasis`:

```ts
      hotWater: {
        dhwMethod: row?.dhwMethod ?? null, dhwUnmeasurable: row?.dhwUnmeasurable ?? null,
        dhwHeatKwh: row?.dhwHeatKwh ?? null, totalHeatKwh: row?.totalHeatKwh ?? null,
        dhwVolumeM3: row?.dhwVolumeM3 ?? null, dhwTempC: row?.dhwTempC ?? null,
      },
      hotWaterBasis: {
        volumeFromMetersM3: waterMeters.length === 0 ? null
          : Math.round(waterMeters.reduce((a, m) => a + consumptionInPeriod(readings.filter((r) => r.meterId === m.id), period.from, period.to), 0) * 1000) / 1000,
        suppliedAreaM2: suppliedAreaOf(units),
      },
```

`period` ist die Heizperiode der Schleife (`{ key, from, to, … }`, PR 5/6). Gerundet wird auf Liter
(drei Stellen), wie ein Wasserzähler sie zeigt.

- [ ] **Step 6: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/db-warmwasser.test.ts test/db-co2.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Alle Tests und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/co2.ts server/test/db-warmwasser.test.ts server/test/api.test.ts
git commit -m "Warmwasser bei eigener Abrechnung: Volumen und Temperatur speichern

Die Sperre aus PR 6 fällt für die eigene Abrechnung. Die Ansicht der Heizperiode schlägt das
Volumen aus den Warmwasserzählern der Wohnungen vor und nennt die versorgte Fläche.

Refs #99
Refs #211"
```

---
### Task 6: Oberfläche: Eingaben der Formeln, Heizwert an der Lieferung, Druckblock

**Files:**
- Modify: `client/src/heatingForm.ts`, `client/src/components/HotWaterCard.tsx`, `client/src/fuelForm.ts`, `client/src/components/FuelCard.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/heatingSelfForm.ts` (PR 10), `client/src/components/HeatingSelfSetup.tsx` (PR 10)
- Create: `client/src/dhwView.ts`, `client/src/components/DhwBlock.tsx`
- Test: `client/src/heatingForm.test.ts`, `client/src/fuelForm.test.ts`, `client/src/heatingSelfForm.test.ts` (ein Test von PR 10 ändert sich), `client/src/dhwView.test.ts` (neu), `client/src/components/HotWaterCard.test.tsx` (neu)

**Interfaces:**
- Consumes: Task 1 `FUEL_GRADE_LABELS`, `GRADES_BY_ENERGY`, `isBoiler`, `HEATING_VALUE_UNIT_TEXT`; Task 2 `HeatGeneration`, `FuelGrade`, `HeatingPlant.heatGeneration`, `FuelDelivery.fuelGrade`; Task 3 `DhwStatement`; Task 5 `HeatingPeriodView.hotWater`, `hotWaterBasis`; PR 6 `HOT_WATER_OPTIONS`, `hotWaterBody`, `isFormula`, `HotWaterChoice`; PR 7 `FuelForm`, `fuelToForm`, `fuelBody`; PR 10 `SelfHeatingBlock`, `heatingSelfForm.ts` (`HOT_WATER_OPTIONS`, `kwhEnergy`, `emptySelfSetup`, `selfSetupBody`), `HeatingSelfSetup.tsx`; PR 6 `HotWaterCard` (bekommt hier die Prop `plant: HeatingPlant`, falls sie fehlt) und ihre Einbindung in `Heizkosten.tsx`.
- Produces:
  - `heatingForm.ts`: `HEAT_GENERATION_OPTIONS`, `type FormulaForm = { volume: string; temp: string }`, `formulaFormOf(hw)`, `selfFormulaBody(choice, form): { body: { dhwVolumeM3?: number | null; dhwTempC?: number | null } } | { error: string }`, `numberText(n)`, `parseDecimal(s)`
  - `fuelForm.ts`: `FuelForm.heatingValue: string`, `FuelForm.grade: FuelGrade | ''`, `gradeOptions(energy)`, `defaultGrade(energy)`, `unitWordFor(unit: string): string`
  - `dhwView.ts`: `DHW_METHOD_TEXT`, `type DhwBlockView = { title: string; method: string; steps: string[]; values: string[] }`, `dhwBlock(d: DhwStatement | undefined): DhwBlockView | null` (liest `self.dhw`, Prüfbericht B.1)
  - `heatingSelfForm.ts`: `kwhEnergy` entfällt (Sperre von PR 10, Abweichung 10 dort)

- [ ] **Step 1: Failing tests schreiben**

(a) `client/src/heatingForm.test.ts` anhängen (Import um `HEAT_GENERATION_OPTIONS, formulaFormOf, parseDecimal, selfFormulaBody` ergänzen):

```ts
test('Warmwasser nach Formel (Heizung PR 11): Volumen und Temperatur deutsch und technisch, leer heißt keine Angabe', () => {
  expect(parseDecimal('32,5')).toBe(32.5)
  expect(parseDecimal('32.5')).toBe(32.5)
  expect(parseDecimal('1.234,5')).toBe(1234.5)
  expect(parseDecimal('')).toBe(null)
  expect(parseDecimal('viel')).toBe(undefined)
  expect(selfFormulaBody('volumeFormula', { volume: '120', temp: '60' })).toEqual({ body: { dhwVolumeM3: 120, dhwTempC: 60 } })
  expect(selfFormulaBody('volumeFormula', { volume: 'x', temp: '60' })).toEqual({ error: 'Das Volumen des Warmwassers ist keine Zahl.' })
  expect(selfFormulaBody('areaFormula', { volume: '120', temp: '60' })).toEqual({ body: {} })
  expect(formulaFormOf({ dhwMethod: 'volumeFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: 32.5, dhwTempC: null })).toEqual({ volume: '32,5', temp: '' })
  expect(HEAT_GENERATION_OPTIONS.map((o) => o.value)).toEqual(['', 'single', 'mixed'])
})
```

(b) `client/src/fuelForm.test.ts` anhängen (Import um `defaultGrade, gradeOptions` ergänzen; `delivery` ist die
vollständige Lieferung, mit der PR 7 seine Formulartests baut, um `fuelGrade: null` ergänzt):

```ts
test('Heizwert und Zeile der Tabelle (Heizung PR 11): nur bei Heizkesseln, vorbelegt nur bei genau einer Zeile', () => {
  expect(gradeOptions('oil').map((o) => o.value)).toEqual(['', 'heatingOilEL', 'heavyFuelOil'])
  expect(gradeOptions('oil')[0]?.label).toBe('keine (Heizwert laut Rechnung)')
  expect(gradeOptions('districtHeating')).toEqual([])
  expect(defaultGrade('pellets')).toBe('woodPellets')
  expect(defaultGrade('oil')).toBe('')
  const form = { ...fuelToForm({ ...delivery, heatingValue: 9.8, fuelGrade: 'heatingOilEL' }) }
  expect([form.heatingValue, form.grade]).toEqual(['9,8', 'heatingOilEL'])
  const ok = fuelBody({ ...form, heatingValue: '10,2', grade: '' }, 'self')
  expect('body' in ok && [ok.body.heatingValue, ok.body.fuelGrade]).toEqual([10.2, null])
  expect(fuelBody({ ...form, heatingValue: 'zehn' }, 'self')).toEqual({ error: 'Der Heizwert laut Rechnung ist keine Zahl.' })
})
```

(c) Datei `client/src/dhwView.test.ts`:

```ts
import { expect, test } from 'vitest'
import { dhwBlock } from './dhwView'
import type { DhwStatement } from './types'

const formel: DhwStatement = {
  method: 'volumeFormula', alpha: 0.255102, heatKwh: 15000, formulaKwh: 15000, factor: null,
  denominator: { kind: 'fuelQuantity', value: 6000, unit: 'l' }, energyKwh: 58800, estimated: false,
  fuelForDhw: { quantity: 1530.61, unit: 'l', heatingValue: 9.8 },
  heatingValues: [
    { label: 'Öl Oktober', kwh: 9.8, per: 'l', source: 'invoice', grade: 'heatingOilEL' },
    { label: 'Öl Dezember', kwh: 10, per: 'l', source: 'table', grade: 'heatingOilEL' },
  ],
  steps: ['Q = 2,5 · 120 m³ · (60 °C − 10 °C) = 15.000 kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)'],
}

test('Druckblock Warmwasseranteil: α mit Methode, Rechenweg und Heizwerte samt Herkunft (Entwurf 8.8)', () => {
  expect(dhwBlock(formel)).toEqual({
    title: 'Warmwasseranteil 25,51 %',
    method: 'aus dem gemessenen Warmwasser berechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
    steps: formel.steps,
    values: [
      'Heizwert „Öl Oktober“: 9,8 kWh je Liter laut Rechnung',
      'Heizwert „Öl Dezember“: 10 kWh je Liter aus der Tabelle der Heizkostenverordnung (Leichtes Heizöl extra leichtflüssig), weil die Rechnung keinen nennt',
    ],
  })
  expect(dhwBlock(undefined)).toBe(null)
})
```

(d) Datei `client/src/components/HotWaterCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „Warmwasser“ bei eigener Abrechnung (Heizung PR 11): Die Auswahl zum Erzeuger zeigt den
// gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), der Vorschlag aus den Zählern füllt das Volumen, und
// Speichern schickt Volumen und Temperatur.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HotWaterCard from './HotWaterCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from '../types'

const view = (over: Partial<HeatingPeriodView> = {}): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: 'volumeFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: 55 },
  hotWaterBasis: { volumeFromMetersM3: 118.25, suppliedAreaM2: 200 },
  co2: null, items: [],
  ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: 'mixed',
  ...over,
})

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Erzeuger zeigt den gespeicherten Wert; Vorschlag aus den Zählern; Speichern schickt Volumen und Temperatur', async () => {
  render(<HotWaterCard view={view()} plant={plant()} onSaved={() => {}} />)
  const generation = screen.getByLabelText(/Erzeugt diese Heizung die Wärme allein/) as HTMLSelectElement
  expect(generation.value).toBe('mixed')
  expect((screen.getByLabelText(/Mittlere Temperatur des Warmwassers/) as HTMLInputElement).value).toBe('55')
  fireEvent.click(screen.getByRole('button', { name: /Aus den Warmwasserzählern übernehmen: 118,25 m³/ }))
  expect((screen.getByLabelText(/Warmwasser in der Heizperiode/) as HTMLInputElement).value).toBe('118,25')
  fireEvent.change(generation, { target: { value: 'single' } })
  fireEvent.click(screen.getByRole('button', { name: 'Angabe speichern' }))
  await waitFor(() => expect(sent.length).toBe(2), { timeout: 5000 })
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/hot-water')
  expect(sent[0]?.body).toMatchObject({ dhwMethod: 'volumeFormula', dhwVolumeM3: 118.25, dhwTempC: 55 })
  expect(sent[1]).toMatchObject({ url: '/api/heating-plants/hp', method: 'PUT', body: { heatGeneration: 'single' } })
})

test('Ohne Antwort zum Erzeuger steht „bitte wählen“, und nichts wird vorgegeben', () => {
  render(<HotWaterCard view={view()} plant={plant({ heatGeneration: null })} onSaved={() => {}} />)
  expect((screen.getByLabelText(/Erzeugt diese Heizung die Wärme allein/) as HTMLSelectElement).value).toBe('')
})
```

Das Literal von `HeatingPlant` hat die Felder von PR 4, 5, 7, 10 und Task 2 (wie
`server/testing/selfHeating.ts`); das von `HeatingPeriodView` die von PR 6 und Task 5. Führt die Ansicht
nach PR 7 bis PR 10 weitere Pflichtfelder (Lieferungen, Vorrat, `distribution`), bekommen sie ihre leeren
Werte; der Übersetzer nennt jedes. Kein `as`: Die Testdaten folgen dem Modell (CLAUDE.md).

(e) `client/src/heatingSelfForm.test.ts` (PR 10): den Test „Warmwasser über die Anlage nur bei Abrechnung in
kWh (Abweichung 10)“ ersetzen durch (die Sperre fällt, Prüfbericht B.1, Zeile B4):

```ts
  it('Warmwasser über die Anlage auch bei Heizöl (Heizung PR 11: Heizwert laut Rechnung, § 9 Abs. 3 HeizkostenV)', () => {
    expect('body' in selfSetupBody(filled(), 'oil')).toBe(true)
    expect(emptySelfSetup({ ...plant, energy: 'oil', hotWater: 'combined' }, '2025-01').hotWater).toBe('combined')
    expect('body' in selfSetupBody(filled({ hotWater: 'none' }), 'oil')).toBe(true)
  })
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix client test -- heatingForm fuelForm dhwView HotWaterCard`
Expected: FAIL (fehlende Exporte, fehlende Felder).

- [ ] **Step 3: `client/src/heatingForm.ts`**

Typimport um `HeatGeneration`, `HeatingPeriodView` ergänzen. Anhängen:

```ts
// ---------- Warmwasser bei eigener Abrechnung (Heizung PR 11, Entwurf 8.3) ----------

// Ob die Anlage die Wärme allein erzeugt (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3 HeizkostenV). Ohne
// Vorgabe: Eine falsche Vorgabe ergäbe still einen falschen Anteil (Abweichung 5 des Plans PR 11).
export const HEAT_GENERATION_OPTIONS: readonly { value: HeatGeneration | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'single', label: 'allein (ein Kessel, eine Wärmepumpe oder Fernwärme)' },
  { value: 'mixed', label: 'mit einem weiteren Erzeuger (Solaranlage, Heizstab, zweiter Kessel)' },
]

// Eine Zahl deutsch oder technisch geschrieben; leer heißt keine Angabe, `undefined` keine Zahl.
export function parseDecimal(text: string): number | null | undefined {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : undefined
}
export const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }))

export type FormulaForm = { volume: string; temp: string }
export const formulaFormOf = (hw: HeatingPeriodView['hotWater']): FormulaForm => ({ volume: numberText(hw.dhwVolumeM3), temp: numberText(hw.dhwTempC) })

// Der Teil des Rumpfs, den nur die Volumenformel braucht.
export function selfFormulaBody(choice: HotWaterChoice, form: FormulaForm): { body: { dhwVolumeM3?: number | null; dhwTempC?: number | null } } | { error: string } {
  if (choice !== 'volumeFormula') return { body: {} }
  const volume = parseDecimal(form.volume)
  if (volume === undefined) return { error: 'Das Volumen des Warmwassers ist keine Zahl.' }
  const temp = parseDecimal(form.temp)
  if (temp === undefined) return { error: 'Die Temperatur des Warmwassers ist keine Zahl.' }
  return { body: { dhwVolumeM3: volume, dhwTempC: temp } }
}
```

- [ ] **Step 4: `client/src/components/HotWaterCard.tsx`**

Importe um `HEAT_GENERATION_OPTIONS, formulaFormOf, numberText, selfFormulaBody, type FormulaForm` aus
`'../heatingForm'` und `HeatGeneration` aus `'../types'` ergänzen. In der Komponente (Fassung PR 10, mit
Prop `plant`) unter den vorhandenen `useState`:

```tsx
  const self = plant.method === 'self'
  const [formula, setFormula] = useState<FormulaForm>(formulaFormOf(view.hotWater))
  const [generation, setGeneration] = useState<HeatGeneration | ''>(plant.heatGeneration ?? '')
```

In `save()` den Rumpf so bilden (die Felder, die PR 10 bei `self` schon schickt, bleiben im Objekt):

```tsx
    const extra = self ? selfFormulaBody(choice, formula) : { body: {} }
    if ('error' in extra) {
      setError(extra.error)
      return
    }
```

und `...extra.body` in das Objekt aufnehmen, das als `body` an
`/api/heating-plants/${view.plantId}/periods/${view.period}/hot-water` geht. Hinter diesem Aufruf, vor
`setError('')`:

```tsx
      // Die Antwort zum Erzeuger gehört zur Anlage, nicht zur Heizperiode.
      if (self && isFormula(choice) && generation !== (plant.heatGeneration ?? '')) {
        await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ heatGeneration: generation === '' ? null : generation }) })
      }
```

Im JSX hinter dem Kästchen zur Bestätigung des Aufwands:

```tsx
      {self && isFormula(choice) && (
        <>
          <label className="field">
            Erzeugt diese Heizung die Wärme allein?
            <select value={generation} disabled={view.closed} onChange={(e) => setGeneration(HEAT_GENERATION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
              {HEAT_GENERATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {choice === 'volumeFormula' && (
            <>
              <label className="field">
                Warmwasser in der Heizperiode (m³, gemessen)
                <input inputMode="decimal" value={formula.volume} disabled={view.closed} onChange={(e) => setFormula({ ...formula, volume: e.target.value })} />
              </label>
              {view.hotWaterBasis.volumeFromMetersM3 !== null && !view.closed && (
                <button type="button" className="btn-link" onClick={() => setFormula({ ...formula, volume: numberText(view.hotWaterBasis.volumeFromMetersM3) })}>
                  Aus den Warmwasserzählern übernehmen: {numberText(view.hotWaterBasis.volumeFromMetersM3)} m³
                </button>
              )}
              <label className="field">
                Mittlere Temperatur des Warmwassers (°C, gemessen oder geschätzt)
                <input inputMode="decimal" value={formula.temp} disabled={view.closed} onChange={(e) => setFormula({ ...formula, temp: e.target.value })} />
              </label>
            </>
          )}
          {choice === 'areaFormula' && (
            <p className="muted">
              Mietfuchs rechnet mit der Wohnfläche der Wohnungen mit Warmwasser: {numberText(view.hotWaterBasis.suppliedAreaM2)} m². Die Fläche ist nur erlaubt,
              wenn auch das Warmwasser nicht gemessen werden kann (§ 9 Abs. 2 Satz 4 HeizkostenV).
            </p>
          )}
        </>
      )}
```

Die Beschriftung der Auswahl „Wie hat der Messdienst …“ lautet bei `self` „Wie wird die Wärme für das
Warmwasser bestimmt?“ (`self ? … : …` am Label).

`client/src/pages/Heizkosten.tsx`: Die Karte „Warmwasser“ steht nach PR 6 nur bei `plant.method ===
'service'` (Prüfbericht B.1, Zeile B10). Die Bedingung wird zu `plant.method !== 'manual'`, und die Karte
bekommt `plant={plant}`. Hat `HotWaterCard` die Prop `plant` noch nicht, kommt sie mit dieser PR dazu:
`{ view, plant, onSaved }: { view: HeatingPeriodView; plant: HeatingPlant; onSaved: () => void }`.

- [ ] **Step 5: `client/src/fuelForm.ts` und `FuelCard.tsx`**

`fuelForm.ts`: Importe `FUEL_GRADE_LABELS, GRADES_BY_ENERGY, HEATING_VALUE_UNIT_TEXT` aus `'../../shared/fuelGrades.ts'`,
`parseDecimal, numberText` aus `'./heatingForm'`, Typen `FuelGrade`, `HeatingEnergy` aus `'./types'`.
In `FuelForm` zwei Felder:

```ts
  // Heizung PR 11: Heizwert laut Rechnung (kWh je Einheit der Menge) und, falls keiner darauf steht, die
  // Zeile der Tabelle des § 9 Abs. 3 HeizkostenV.
  heatingValue: string
  grade: FuelGrade | ''
```

In `fuelToForm` `heatingValue: numberText(d.heatingValue), grade: d.fuelGrade ?? ''`, im leeren
Formular (dort, wo PR 7 die Vorgaben einer neuen Lieferung setzt) `heatingValue: ''` und `grade: ''`. In
`fuelBody` vor dem `return { body: … }`:

```ts
  const heatingValue = parseDecimal(form.heatingValue)
  if (heatingValue === undefined) return { error: 'Der Heizwert laut Rechnung ist keine Zahl.' }
```

und im Rumpf `heatingValue, fuelGrade: form.grade === '' ? null : form.grade`. Anhängen:

```ts
// Die Zeilen der Tabelle zum Energieträger der Anlage; leer bei Fernwärme, Wärmepumpe und Strom, denn
// die Tabelle gilt nur bei Heizkesseln (Entwurf R-A13).
export function gradeOptions(energy: HeatingEnergy): { value: FuelGrade | ''; label: string }[] {
  const grades = GRADES_BY_ENERGY[energy]
  return grades.length === 0 ? [] : [{ value: '', label: 'keine (Heizwert laut Rechnung)' }, ...grades.map((g) => ({ value: g, label: FUEL_GRADE_LABELS[g] }))]
}
// Die Einheit der Menge im Satz „kWh je …“; ohne bekannte Einheit „Einheit“.
export const unitWordFor = (unit: string): string =>
  unit === 'l' || unit === 'm3' || unit === 'kg' || unit === 'srm' ? HEATING_VALUE_UNIT_TEXT[unit] : 'Einheit'

// Vorbelegt wird nur, wo es genau eine Zeile gibt (Flüssiggas, Pellets); sonst wird nicht geraten
// (Abweichung 4 des Plans PR 11).
export function defaultGrade(energy: HeatingEnergy): FuelGrade | '' {
  const grades = GRADES_BY_ENERGY[energy]
  return grades.length === 1 ? (grades[0] ?? '') : ''
}
```

`FuelCard.tsx` (PR 7, Name nach Task 11 von PR 7): Die Prop `plant` bekommt zusätzlich `energy`
(nach PR 9 `Pick<HeatingPlant, 'id' | 'method' | 'supply' | 'units' | 'energy'>`; die Seite Heizkosten
reicht den ganzen `HeatingPlant` herein). Wo eine neue Lieferung ihr leeres Formular bekommt (in
`open(null)`: `emptyFuelForm()`), `grade: defaultGrade(plant.energy)` setzen. Im Formular hinter dem Feld der Menge:

```tsx
          {isBoiler(plant.energy) && (
            <>
              <label className="field">
                Heizwert laut Rechnung (kWh je {unitWordFor(form.quantityUnit)})
                <input inputMode="decimal" value={form.heatingValue} onChange={(e) => setForm({ ...form, heatingValue: e.target.value })} />
              </label>
              {form.heatingValue.trim() === '' && (
                <label className="field">
                  Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung
                  <select value={form.grade} onChange={(e) => setForm({ ...form, grade: gradeOptions(plant.energy).find((o) => o.value === e.target.value)?.value ?? '' })}>
                    {gradeOptions(plant.energy).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
```

(Importe: `isBoiler` aus `'../../../shared/fuelGrades.ts'`, `gradeOptions`, `defaultGrade`,
`unitWordFor` aus `'../fuelForm'`. Heißt das Feld der Einheit in der Form von PR 7/8 nicht
`quantityUnit`, hier anpassen; fehlt es, `unitWordFor('')`, also „Einheit“.)

- [ ] **Step 6: Druckblock (`client/src/dhwView.ts`, `client/src/components/DhwBlock.tsx`, `Abrechnung.tsx`)**

`client/src/dhwView.ts`:

```ts
// Der Druckblock „Warmwasseranteil“ (Heizung PR 11, Entwurf 8.8: „α mit Methode“). Logik ohne DOM.
import type { DhwMethod, DhwStatement } from './types'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'

export const DHW_METHOD_TEXT: Record<DhwMethod, string> = {
  heatMeter: 'mit einem Wärmezähler gemessen (§ 9 Abs. 2 Satz 1 HeizkostenV)',
  volumeFormula: 'aus dem gemessenen Warmwasser berechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
  areaFormula: 'aus der Wohnfläche berechnet (§ 9 Abs. 2 Satz 4 HeizkostenV)',
}

export type DhwBlockView = { title: string; method: string; steps: string[]; values: string[] }

const pct = (alpha: number) => `${(alpha * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`

// Liest den Rechenweg der eigenen Abrechnung (`HeatingStatement.self.dhw`, Prüfbericht B.1).
export function dhwBlock(d: DhwStatement | undefined): DhwBlockView | null {
  if (!d) return null
  return {
    title: `Warmwasseranteil ${pct(d.alpha)}`,
    method: DHW_METHOD_TEXT[d.method],
    steps: d.steps,
    values: d.heatingValues.map((v) =>
      `Heizwert „${v.label}“: ${v.kwh.toLocaleString('de-DE')} kWh je ${HEATING_VALUE_UNIT_TEXT[v.per]} ` +
        (v.source === 'invoice' ? 'laut Rechnung' : `aus der Tabelle der Heizkostenverordnung${v.grade ? ` (${FUEL_GRADE_LABELS[v.grade]})` : ''}, weil die Rechnung keinen nennt`)),
  }
}
```

`client/src/components/DhwBlock.tsx`:

```tsx
// Druckblock „Warmwasseranteil“ je Heizanlage (Heizung PR 11).
import { dhwBlock } from '../dhwView'
import Term from './Term'
import type { HeatingStatement } from '../types'

export default function DhwBlock({ heating }: { heating: HeatingStatement }) {
  const b = dhwBlock(heating.self?.dhw)
  if (!b) return null
  return (
    <div className="print-block">
      <h4>{b.title} <Term id="hotWaterShare" /></h4>
      <p>Bestimmt {b.method}.</p>
      <ul>
        {b.steps.map((s) => <li key={s}>{s}</li>)}
        {b.values.map((s) => <li key={s}>{s}</li>)}
      </ul>
    </div>
  )
}
```

`client/src/pages/Abrechnung.tsx`: `import DhwBlock from '../components/DhwBlock'`; unmittelbar hinter
`<SelfHeatingBlock … />` (PR 10 Task 13) `<DhwBlock heating={h} />` einfügen, mit derselben Variablen `h`
für die `HeatingStatement` der Schleife.

- [ ] **Step 7: Sperre der Einrichtung fällt (`client/src/heatingSelfForm.ts`, `HeatingSelfSetup.tsx`)**

PR 10 (Abweichung 10 dort) sperrt „verbundenes Warmwasser“ bei Energien, die nicht in kWh abgerechnet
werden. Mit dem Heizwert laut Rechnung (Task 3) fällt das. In `client/src/heatingSelfForm.ts` die
Konstante `kwhEnergy` samt Kommentar löschen; in `emptySelfSetup` die Zeile `hotWater: …` ersetzen durch

```ts
    hotWater: plant.hotWater ?? 'combined',
```

und in `selfSetupBody` den Block

```ts
  if (form.hotWater === 'combined' && !kwhEnergy(energy)) {
    return { error: 'Bereitet die Heizung auch das Warmwasser, braucht die Aufteilung den Heizwert des Brennstoffs laut Rechnung (§ 9 Abs. 3 HeizkostenV); das kommt mit einer späteren Version. Bis dahin geht es mit getrennter Warmwasserbereitung oder ohne zentrales Warmwasser.' }
  }
```

löschen. In `client/src/components/HeatingSelfSetup.tsx` `kwhEnergy` aus dem Import nehmen und die
Auswahl der Warmwasserbereitung ohne Sperre rendern:

```tsx
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
```

`grep -rn "kwhEnergy" client/src` findet danach nichts mehr.

- [ ] **Step 8: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix client test -- heatingForm fuelForm heatingSelfForm HeatingSelfSetup dhwView HotWaterCard && npm run typecheck && npm run build`
Expected: PASS; der Build bündelt `shared/fuelGrades.ts`.

- [ ] **Step 9: Alle Tests und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add client/src/heatingForm.ts client/src/heatingForm.test.ts client/src/components/HotWaterCard.tsx client/src/components/HotWaterCard.test.tsx client/src/fuelForm.ts client/src/fuelForm.test.ts client/src/components/FuelCard.tsx client/src/dhwView.ts client/src/dhwView.test.ts client/src/components/DhwBlock.tsx client/src/pages/Abrechnung.tsx client/src/pages/Heizkosten.tsx client/src/heatingSelfForm.ts client/src/heatingSelfForm.test.ts client/src/components/HeatingSelfSetup.tsx
git commit -m "Oberfläche: Warmwasser nach Formel, Heizwert an der Lieferung, Druckblock

Volumen (mit Vorschlag aus den Zählern) und Temperatur, die Frage nach dem Erzeuger ohne Vorgabe,
der Heizwert laut Rechnung und sonst die Zeile der Tabelle; der Ausweis nennt Anteil, Verfahren,
Rechenweg und die Herkunft jedes Heizwerts. Die Einrichtung lässt verbundenes Warmwasser jetzt
auch bei Heizöl, Flüssiggas, Pellets, Holz und Kohle zu.

Refs #99
Refs #211"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG**

Im Abschnitt „Unveröffentlicht“ unter „Hinzugefügt“:

```markdown
- Eigene Heizkostenabrechnung: Warmwasseranteil auch ohne Wärmezähler, nach den beiden Formeln des
  § 9 Abs. 2 HeizkostenV (aus dem gemessenen Warmwasser oder aus der Wohnfläche). Die Faktoren 1,11
  (Erdgas nach Brennwert), 1,15 (Wärmelieferung) und 0,30 (monovalente Wärmepumpe, für Zeiträume ab
  01.10.2024) gelten nur für diese Formelwerte. Brennstoff in Litern, Kubikmetern oder Kilogramm wird
  mit dem Heizwert laut Rechnung umgerechnet, hilfsweise und nur bei Heizkesseln mit der Tabelle der
  Verordnung. Wird ohne zulässigen Grund nach einer Formel abgerechnet, nennt die Abrechnung die
  Kürzung um 15 % je Mieter ([#211](https://github.com/speedone/mietfuchs/issues/211),
  [#99](https://github.com/speedone/mietfuchs/issues/99)).
- Hinweise, wenn der Heizwert aus der Tabelle stammt und wenn der Warmwasseranteil ungewöhnlich ist
  (unter 5 oder über 50 %, nur zur Prüfung).
- Wärmepumpe in Abrechnungszeiträumen, die vor dem 01.10.2024 beginnen: ein Hinweis, dass die
  Heizkostenverordnung für überwiegend mit Wärmepumpen versorgte Gebäude damals nicht galt (§ 11 Abs. 1
  Nr. 3 Buchst. a in der alten Fassung); keine Kürzungsbeträge, und Heizung und Warmwasser werden dann
  gemeinsam nach dem Heizschlüssel verteilt.
```

Unter „Geändert“:

```markdown
- Holzhackschnitzel: Seit 01.12.2021 nennt die Heizkostenverordnung 4 kWh je Kilogramm; die frühere
  Angabe 650 kWh je Schüttraummeter gilt nur für Zeiträume davor, und den Brennstoffverbrauch bestimmt
  die Verordnung seither in Litern, Kubikmetern oder Kilogramm.
- Eigene Heizkostenabrechnung: Die Heizung darf jetzt auch bei Heizöl, Flüssiggas, Pellets, Holz und
  Kohle das Warmwasser bereiten; die Einrichtung sperrt das nicht mehr.
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt „Berechnungs-Engine“ hinter dem Punkt zum Leerstand beim Personenschlüssel (bzw. hinter dem
Punkt, den PR 10 zur eigenen Heizkostenabrechnung angelegt hat) einfügen:

```markdown
- **Warmwasseranteil α** (Heizung PR 11, #211, [server/src/dhw.ts](server/src/dhw.ts)): eine Stelle
  für alle drei Verfahren des § 9 Abs. 2 HeizkostenV, als reine Funktionen. Die Faktoren 1,11, 1,15
  und 0,30 gelten **nur für Formelwerte**, nie für gemessene Wärme (Entwurf G-B1 abgelehnt, 15.1 Nr. 9;
  das Lexikon nennt beide Lesarten). Wogegen Q gestellt wird, hängt am Erzeuger: Brennstoff in kWh
  laut Rechnung, sonst als Menge mit B = Q / Hᵢ (§ 9 Abs. 3), Fernwärme die gelieferte Wärme, die
  Wärmepumpe mit Formel den Strom, gemessen die gemessene Gesamtwärme. Der **Heizwert laut Rechnung**
  geht vor; die Tabelle nur hilfsweise, nur bei Heizkesseln und nur mit der Zeile, die der Vermieter
  an der Lieferung wählt (`fuel_grade`): Die Tabelle unterscheidet Erdgas H und L, leichtes und
  schweres Heizöl und drei Kohlen, der Energieträger der Anlage nicht. **Holzhackschnitzel**: Die
  Verordnung vom 24.11.2021 hat § 9 Abs. 3 Satz 2 Nr. 2 neu gefasst, und mit der alten Nummer ist die
  Angabe 650 kWh/SRm entfallen; seit 01.12.2021 gelten 4 kWh/kg und B nur in Litern, Kubikmetern oder
  Kilogramm. gesetze-im-internet.de druckt die alte Tabelle hinter Satz 5 noch ab; das ist ein Versehen
  der Konsolidierung, nachzulesen am Änderungsbefehl (BGBl. 2021 I S. 4964, Art. 1 Nr. 5 Buchst. c).
  Eine Formel verlangt die Antwort, ob die Anlage die Wärme **allein** erzeugt (`heat_generation`); ohne
  sie und bei mehreren Erzeugern rechnet sie nicht, denn Satz 6 Nr. 3 meint die monovalente Wärmepumpe,
  und Satz 5 lässt bei Mischanlagen nur gemessen gegen gemessen. Die Flächenformel liefert kWh „pro
  Jahr“ und wird im Rumpf nach Tagen gekürzt, wie § 9b Abs. 2 Warmwasser zeitanteilig teilt (Festlegung
  F7, Entwurf 15.2). Was fehlt, ergibt `heating.dhw-share-invalid` mit dem Satz, was fehlt, und die
  Anlage wird in dieser Heizperiode nicht verteilt. **Eine Stelle für α** bleibt `hotWaterShareOf`
  (heating.ts, PR 10); sie ruft dhw.ts, und der Ausweis führt α als `self.alpha`, den Rechenweg als
  `self.dhw`. Die **Stromheizung** rechnet gemessen gegen den Strom laut Rechnung wie in PR 10, nur die
  Formeln sind dort gesperrt: Eine Anlage, die vorher abrechenbar war, darf eine spätere PR nicht
  sperren. Die **Wärmepumpe vor dem 01.10.2024** fiel nach § 11 Abs. 1 Nr. 3 Buchst. a a. F. nicht
  unter die Verordnung (`hkv.exemption.renewable`, zwei Fassungen): Hinweis statt Fehler, keine
  Kürzungsbeträge. Tests der eigenen Abrechnung bauen Beispiel A mit `selfSnapshot()`
  ([server/testing/selfHeating.ts](server/testing/selfHeating.ts)); ein Test hält den Helfer gleich mit
  dem Weg über die Datenbank.
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0 bei allen drei.

Run: `npm --prefix server test -- --test-name-pattern "Golden|golden"`
Expected: PASS, Golden F01–F17 unverändert.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Warmwasser ohne Zähler, Heizwerte und Hackschnitzel

Refs #99
Refs #211"
```

- [ ] **Step 5: PR-Beschreibung**

Die Beschreibung des Pull Requests (gestapelt auf PR 10) nennt `Refs #99` und `Refs #211`, die
Abweichungen 1 bis 10 dieses Plans, den Abschnitt „Änderungen nach Prüfung vom 05.10.2026“ und als
Prüfpunkte der Durchsicht:

- § 9 Abs. 3 im amtlichen BGBl.-PDF (2021 Teil I S. 4964, Art. 1 Nr. 5 Buchst. c) gegen Abweichung 2
  lesen; bis dahin stützt sich die Fassung auf die Wiedergabe bei buzer.de.
- Inkrafttreten von Art. 3 G v. 16.10.2023 (01.10.2024) im BGBl. 2023 I Nr. 280 gegen Abweichung 1
  lesen.
- ⟨Norm offen: VDI 2077⟩ für die Frage, ob gemessene Wärme gegen Brennwert- oder Heizwert-kWh steht
  (15.1 Nr. 9, 15.3); bis dahin nach Wortlaut. Ebenso für die Rumpf-Flächenformel nach Tagen (F7).
- Begründung zum Gesetz vom 16.10.2023 (BT-Drs. 20/7619) zu § 9 Abs. 2 Satz 6 Nr. 3: ob Q · 0,30 gegen den
  Strom oder gegen die Gesamtwärme zu setzen ist (Prüfbericht A.2, Abweichung 1).
- § 11 Abs. 1 Nr. 3 HeizkostenV a. F.: ob der Nachsatz „sofern der Wärmeverbrauch des Gebäudes nicht
  erfasst wird“ auch Buchst. a betrifft (Abweichung 9).

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Stelle |
|---|---|
| `hkv.dhw.volume-formula`, `hkv.dhw.area-formula`, `hkv.dhw.factors`, `hkv.heating-values` mit Fundstelle, Zeitregel `periodStart` (4.3) | Task 1 |
| Formeln exakt nach Wortlaut § 9 Abs. 2 Satz 2, 4, Faktoren Satz 6 Nr. 1–3 | Global Constraints, Task 1, Task 3 |
| Faktoren nur für Formelwerte (8.3, G-B1) | Task 3 (Test „Beispiel 8.3“, „15.1 Nr. 9“) |
| α = Q / abgerechnete Energie des Erzeugers, Wärmepumpe gegen Strom (8.3, D-F1, F1 37,5 %) | Task 3 |
| Regeln von PR 10 bleiben: Lücke der Rechnungen, Schätzung beim Abschluss, α außerhalb von (0, 1) | Task 3 (Test „Aus PR 10 übernommen“), Task 4 |
| Stromheizung gemessen wie PR 10 (Prüfbericht A6) | Task 3, Task 4 |
| Wärmepumpe vor dem 01.10.2024: § 11 Abs. 1 Nr. 3 Buchst. a a. F. (Prüfbericht A3) | Task 1, Task 4 |
| Sperren von PR 10 und PR 6 fallen | Task 4 (heating.ts, db/heating.ts), Task 5 (`saveHotWater`), Task 6 (Einrichtung) |
| Wärmepumpe mit Warmwasserzähler ohne Gesamtwärmezähler → `heating.heat-pump-dhw-basis` (A8) | Task 3, Task 4 |
| Mischanlagen nur `heatMeter` mit gemessener Gesamtwärme (8.3) | Task 3 (Abweichung 5) |
| Heizwert laut Rechnung vor Tabelle, Tabelle nur bei Kesseln, `heating.heating-value-from-table` (R-A13, 8.3) | Task 3, Task 4 |
| Hackschnitzel geklärt (4.3 „ungeprüft“) | Abweichung 2, Task 1 |
| Formel ohne `dhw_unmeasurable` → `heating.dhw-not-metered` mit 15 % auf den ganzen Anteil bei `self` (6.5, 8.3, 7.7) | Task 4 |
| Plausibilität `heating.dhw-share-implausible` unter 5 / über 50 % (10.1, 15.2 F6) | Task 4 |
| 15.1 Nr. 9 m³ gegen kWh: nach Wortlaut, Lexikon nennt beide Lesarten | Task 1 (Lexikon), Task 3 (Test 13,51 % / 15,00 %) |
| Ausweis „α mit Methode“ (8.8) | Task 4 (`self.dhw` neben `self.alpha`), Task 6 (Druckblock) |
| Beispiele 15,0 / 27,75 / 11,84 % (12.2) | Task 3 Test 1, Task 1 Lexikon |
| Rechtsstand und benutzte Werte (4.4) | Task 3 Test „Protokoll“ |
| Wer nichts einstellt, merkt nichts (1.2 Nr. 1) | Task 4 Step 8, Task 7 Step 3 |

Nicht in diesem Plan, weil eine andere PR sie trägt: § 9a Schätzung (PR 13), § 6a-Angaben (PR 14),
Wärmelieferung als Merkmal für Contracting (PR 16; die ÷ 1,15 greift hier für `districtHeating`, und
PR 16 muss sein Merkmal an dieselbe Stelle in `formulaFactor` anschließen), Warmwasser beim Messdienst
(PR 6, unverändert bis auf den gemeinsamen Hinweis).

**2. Platzhalter.** Keine „TBD“, kein „wie Task N“. Die Namen von PR 10 sind nach der Prüfung vom
05.10.2026 abgeglichen (Commit `81828af`); Tasks benutzen sie unmittelbar.

**3. Typen.** `DhwStatement`, `DhwHeatingValue`, `EnergyDelivery`, `GeneratorInput`, `DhwInput`,
`DhwOutcome`, `DhwProblem`, `DhwContext` werden in Task 3/4 definiert und in Task 4–6 mit denselben
Feldnamen benutzt (`alpha`, `heatKwh`, `formulaKwh`, `factor`, `denominator`, `energyKwh`, `fuelForDhw`,
`heatingValues`, `estimated`, `steps`; `share`, `stock.consumed` in `GeneratorInput`,
`stock.consumedQuantity` in `DhwContext`; `fuelCoveragePermille`, `fuelEstimated` in beiden). In
heating.ts bleiben die Namen von PR 10: `AlphaInput = DhwContext & { hotWater; log }`,
`AlphaProblem = DhwProblem`, `Alpha` mit `statement`. `FuelGrade`, `HeatGeneration`, `fuelGrade`,
`heatGeneration` durchgehend gleich. `selfSnapshot`, `selfDelivery`, `selfRow` (Task 4) sind die Namen,
die PR 12 bis PR 14 benutzen.

**4. Review Focus.** Jede der fünf Zeilen hat ihren Test: 1 → `dhw.test.ts` „Heizwert laut Rechnung vor
Tabelle“ (ohne Zeile) und calc-Test „Gas in m³“; 2 → „Flüssiggas in Litern“; 3 → „Holzhackschnitzel“;
4 → „Rumpf“; 5 → „Wärmepumpe (F1)“ mit dem Zeitraum 2024 (kein Faktor), law.test.ts „Stichtag
hkv.dhw.factors“ und „Stichtag hkv.exemption.renewable“, calc-warmwasser.test.ts „Review Focus 5“.
