# Heizung PR 8: Vorrat für CO₂ (`selfAfterService`) und freie Schlüssel (#97, #99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wer mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle heizt, trägt je Heizperiode Anfangs- und
Endbestand des Vorrats ein; Mietfuchs rechnet daraus den verbrauchten Brennstoff (Anfangsbestand +
Lieferungen − Endbestand, Endbestand zu den jüngsten Lieferungen bewertet), teilt die CO₂-Kosten nach
dem verbrauchten statt dem gelieferten Brennstoff auf (Messdienst ohne Aufteilung und freie
Schlüssel) und verteilt bei freien Schlüsseln die Heizkosten nach Verbrauch, mit den Zeilen „aus dem
Vorrat“ und „im Vorrat“ und ihrer Gegenzeile beim Vermieter.

**Architecture:** Acht neue Spalten an `heating_periods` in zwei erzeugten Schritten (erst Spalten,
dann Bedingungen). Die Bestandsrechnung steht als reine Funktion in `server/src/fuelStock.ts`; der
Schnappschuss reicht je Anlage und Heizperiode die Kette der Vorperioden bis zur letzten mit
eingefrorenem Endbestand herein (`stockChainsOf` in snapshot.ts), und der eingefrorene Endbestand
steht im abgeschlossenen Stand (`Settlement.heating[].stock`), gelesen über `frozenSettlementOf`.
`computeSettlement` setzt bei `selfAfterService` und bei freien Schlüsseln E und C des Topfs aus dem
Bestand ein (Naht N1 zu PR 7) und legt bei freien Schlüsseln zwei Übertragsposten an, die mit dem
Schlüssel der Brennstoffposition verteilt werden. Lesen und Schreiben stehen in
`server/src/db/fuelStock.ts`, die Oberfläche bekommt auf der Seite Heizkosten die Karte „Vorrat“ und
in der Abrechnung den Druckblock „Bestandsrechnung“.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.5 (R-A26, G-A3, G-A4, G-B4, G-C5, G-C10), 0.6 (N8, N9, D-R2, D-L2, D-H6), 0.7 (A6), 1.1 (W2, W5),
1.2 Nr. 1, 3.2 („Wofür die Abgrenzung gilt“), 3.3, 3.9 (Zeile „Brennstoff vor 2023“), 4.3
(`co2.costs-before`), 4.7, 5.1, 5.3 (Gruppe „Vorrat“, Sperre nach Abschluss), 5.4 (Zuordnung einer
Lieferung zur Heizperiode, Sperren), 5.7, 5.8, 6.1 Nr. 4.2 und 4.3, 6.2 (`fuelCarry`, Vorzeichen,
k), 6.4 Nr. 1, 7.6, **8.2 ganz** (Bestandsrechnung, Peildatum, Rundung, „Ohne Bestand“, „Wie das in
die Abrechnung kommt“, „Einfrieren und Sperren“, Beispiel Heizöl, Eigenanteil N8), 9.1, 9.4 (x_t bei
`manual`), 9.5 (Bestandsrechnung im Ausweis), 10.1 (Codes mit PR 8), 10.2 (`heating-consumed-fuel`),
10.3 (`fuelStock`), 11.4, 12.2 (R2, G-C5, N8, `fuel.test.ts` zum Öl), 12.3 Nr. 1, 2, 5, 10,
13 (PR 8), 14.1 (Zeile „Öl, Flüssiggas, Pellets, Holz“), 15.1 Nr. 10, 15.2.

**Baut auf:** PR 1 bis PR 6 (Pläne `docs/superpowers/plans/2026-10-05-heizung-pr{1..6}-*.md`) und
PR 7 (Plan `docs/superpowers/plans/2026-10-05-heizung-pr7-lieferungen.md`; entstand parallel zu
diesem Plan, siehe „Annahmen über PR 7“). Gearbeitet wird auf `feat/heizung-pr8-vorrat`, abgezweigt
von der Spitze von PR 7; der PR wird gestapelt auf PR 7 gestellt und nach dessen Merge auf `main`
umgestellt.

## Änderungen nach Prüfung vom 05.10.2026

Die Prüfung der Schnittstellen für PR 15 bis 22 vom 05.10.2026 hat diesen Plan an zwei Stellen
geändert. Jede Änderung steht im Task an ihrer Stelle; diese Liste sagt, wo.

1. **Kohle ist wieder Vorratsenergie** (Festlegung 8, Annahme A5, Task 3 Step 3, Goal, Global
   Constraints, Lexikon, Meldungen, CHANGELOG). PR 7 führt `STOCK_ENERGIES` mit
   `['oil', 'lpg', 'pellets', 'wood', 'coal']`; dieser Plan hatte beim Verlegen nach
   `shared/fuelStock.ts` `coal` verloren. Damit entfiele für Kohle die Sperre der Lieferungen aus
   PR 7, ohne dass eine Bestandsrechnung an ihre Stelle träte. Die Liste bleibt beim Verlegen
   unverändert; alle Texte nennen Kohle mit („Heizöl, Flüssiggas, Pellets, Holz und Kohle“), und
   `FUEL_NAMES` bekommt `coal: 'Kohle'`. Golden F01–F15 berührt das nicht: Keine hat eine
   Kohleanlage, und nach PR 7 konnte eine Kohleanlage keine Lieferungen haben.
2. **Name der Karte** (Annahme A10): Die Karte der Lieferungen heißt nach PR 7 Task 11 `FuelCard`
   (`client/src/components/FuelCard.tsx`), nicht `FuelDeliveriesCard`.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Heizanlage, bei Gas,
  Fernwärme, Wärmepumpe, Strom und „Sonstiges“ und bei jeder Anlage mit `serviceDeducted` oder
  `serviceShown` ist jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 7.
  Golden F01–F15 bleiben wortgleich.
- **Neu und angekündigt** (CHANGELOG): Eine Anlage mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle und
  freien Schlüsseln (`manual`) bekommt ohne Bestand die Warnung `fuel.manual-by-delivery`; an ihren
  Zahlen ändert sich nichts, bis ein Bestand eingetragen ist.
- **Rechtswerte nur aus dem Register** (Entwurf 4.3, 4.7): Der Stichtag des § 11 Abs. 2 Satz 2
  CO2KostAufG steht nur in `co2.costs-before` (`shared/law/co2kostaufg.ts`), die 3 % nur in
  `co2.cut.missing` (PR 6). `server/src/fuelStock.ts` kommt in `ENGINE_FILES` von
  `law-literals.test.ts`. Ein Parameter kommt mit der PR, die ihn nutzt (G-C7): hier genau
  `co2.costs-before`.
- **Fassungen nie ändern** (4.4): Die neuen Fassungen bekommen je eine Zeile in
  `law-history.test.ts`; keine bestehende Zeile ändert sich.
- **Bestandsrechnung** (8.2): Verbraucht = Anfangsbestand + Lieferungen − Endbestand, ebenso kg und
  CO₂-€. Verbraucht wird das Älteste zuerst; der Endbestand besteht aus den jüngsten Lieferungen und
  wird zu deren Preisen, kg und CO₂-Kosten bewertet ([M] Minol, Restbewertung). Gerundet wird je
  Posten: Beträge auf den Cent, kg auf das Hundertstel (Abweichung 1).
- **§ 11 Abs. 2 Satz 2 CO2KostAufG:** Brennstoff, der vor dem 01.01.2023 in Rechnung gestellt wurde,
  zählt mit seinen kg für die Einstufung, mit seinen CO₂-Kosten nicht (Entwurf 3.9).
- **Ohne Bestand** (8.2, G-B4): `selfAfterService` → `fuel.stock-missing` (warning, 3 % je Mieter),
  keine CO₂-Aufteilung; `manual` → `fuel.manual-by-delivery` (warning), verteilt wird nach Lieferung
  wie heute, und der Text nennt beide Folgen. `self` rechnet erst PR 10 (Methode bleibt gesperrt).
- **Σ aller Zeilen = Σ Kostenpositionen** (6.2, 12.3 Nr. 1): Die Übertragsposten verteilen sich wie
  jede Position; ihre Gegenzeile beim Vermieter (`fuelCarry`) gleicht die Summe aus. Mieterzeilen der
  Übertragsposten dürfen negativ sein (12.3 Nr. 2).
- **Steuer nach Bezahltem** (6.4 Nr. 1, G-C5, N8): Die Übertragsposten sind keine Positionen; die
  Steuerübersicht kennt sie nicht. Abrechnung und Steuer dürfen beim Eigenanteil genau um den
  Eigenanteil am Übertrag auseinanderliegen; die Steuerseite erklärt den Abstand.
- **Einfrieren und Sperren** (5.3, 8.2, G-A4): Ist eine Heizperiode abgeschlossen, sind ihre
  Vorratswerte gesperrt (409), und ihr bewerteter Endbestand gilt eingefroren für die Folgeperiode.
- **Stufe hängt am Code** (#112): Jeder neue Code steht mit genau einer Stufe in `noticeKinds` und
  trägt mindestens einen Begriff des Lexikons.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte in genau dieser Reihenfolge hinter dem letzten Schritt von PR 7: `vorrat` (acht neue
  Spalten, keine geänderte Bedingung) und `vorrat_bedingungen` (Bedingungen an `heating_periods`,
  Neubau). Die Nummer vergibt drizzle-kit; mit zwei Schritten in PR 7 (Annahme A3) sind es
  `0024_vorrat` und `0025_vorrat_bedingungen`. Die Marken kommen in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben
  unverändert; die db.json kennt keinen Vorrat. `legacy/read.ts` braucht keine Änderung, alle neuen
  Felder im Schnappschuss sind optional.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`, beim Smoke-Test der Aufruf von
  Hand (Task 9).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #97, #99` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung. Aufgaben stehen nur in den GitHub-Issues des Repos,
  nie in Beads (CLAUDE.md).

## Review Focus

1. **Zwischen der Peilung des Tanks und dem Ende der Heizperiode liegt eine Lieferung** (gepeilt am
   20.12., geliefert am 28.12.; oder gepeilt am 05.01., geliefert am 02.01. der Folgeperiode). Der
   Vermieter erwartet, dass Mietfuchs ihm das sagt, statt die Lieferung still als verbraucht zu
   buchen. Erwartet: Gerechnet wird mit dem Wert wie gepeilt (8.2), der Hinweis
   `fuel.stock-date-differs` nennt Tage, Gradtagsanteil **und** die Lieferung samt Satz, dass die
   Peilung sie nicht enthält bzw. schon enthält. Über die Heizperioden bleibt die Summe gleich. Test in
   Task 3 und Task 6.
2. **Die Lieferung ist in Kilogramm erfasst, der Vorrat in Litern** (Flüssiggas wird in beiden
   Einheiten abgerechnet). Erwartet: `fuel.stock-invalid` (error) mit beiden Einheiten im Satz, keine
   Bestandsrechnung, bei freien Schlüsseln Verteilung nach Lieferung wie bisher; nie eine Umrechnung
   mit einer erfundenen Dichte. Test in Task 3 und Task 7.
3. **Die Vorperiode wird wieder geöffnet, nachdem die Folgeperiode ihren eingefrorenen Endbestand
   gelesen hat, und dort ändert sich der Endbestand.** Erwartet: Solange die Vorperiode offen ist, liest
   die Folgeperiode den lebenden Endbestand; nach dem erneuten Abschluss den neu eingefrorenen. Kein
   Wert bleibt aus dem alten Abschluss hängen. Test in Task 4.
4. **Ein Jahr ohne Öllieferung bei freien Schlüsseln.** In der Heizperiode steht keine
   Brennstoffposition, verbraucht wird nur aus dem Vorrat. Erwartet: Die Mieter tragen den
   Verbrauch aus dem Vorrat nach dem Schlüssel der jüngsten Brennstoffposition der Vorperiode; gibt es
   gar keine, `fuel.manual-by-delivery` mit dem Satz, dass ein Schlüssel fehlt. Test in Task 7.
5. **Vorratswerte einer abgeschlossenen Heizperiode werden geändert**, oder der Anfangsbestand einer
   Heizperiode wird eingetragen, deren Vorperiode schon einen Endbestand hat. Erwartet: 409 bzw. 400
   mit einem Satz, nichts geschrieben; der Anfangsbestand ergibt sich aus der Vorperiode. Test in
   Task 5.

---
## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts` | Parameter `co2.costs-before`, Regel `heating-consumed-fuel` | 1 |
| `shared/glossary.ts` | Begriff `fuelStock` | 1 |
| `shared/types.ts` | `StockUnit`, `StockLayer`, `StockValue`, `HeatingStockStatement`, `StockView`; Felder an `HeatingPeriodData`, `HeatingStatement`, `HeatingPeriodView`, `TaxReport` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/0024_vorrat.sql`, `0025_vorrat_bedingungen.sql`, `meta/*` (erzeugt) | acht Spalten, Bedingungen | 2 |
| `shared/fuelStock.ts` (neu) | `STOCK_ENERGIES`, `STOCK_UNITS_TEXT`, `isStockEnergy` für Server und Oberfläche | 3 |
| `server/src/fuelStock.ts` (neu) | Bestandsrechnung, Bewertung, Kette, Lesen eines eingefrorenen Endbestands | 3 |
| `server/src/snapshot.ts`, `server/src/db/read.ts` | `stockChainsOf`, `Snapshot.stockChains`, `frozenSettlementOf` liest den Endbestand | 4 |
| `server/src/db/fuelStock.ts` (neu), `server/src/db/co2.ts`, `server/src/db/fuel.ts`, `server/src/index.ts` | Vorrat speichern und entfernen, Ansicht je Heizperiode, Lieferungen von Vorratsenergien, Routen | 5 |
| `server/src/calc.ts`, `server/src/co2.ts` | Naht N1, Hinweise, Ausweis, Übertragsposten, Gegenzeile, Steuer | 6, 7 |
| `client/src/stockForm.ts` (neu), `client/src/components/StockCard.tsx` (neu), `client/src/stockView.ts` (neu), `client/src/components/StockBlock.tsx` (neu), `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/taxView.ts`, `client/src/pages/Steuer.tsx`, `client/src/notices.ts` | Karte Vorrat, Druckblock, Steuerseite | 8 |
| `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung, Doku | 9 |
| Tests: `server/test/law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `schema.test.ts`, `migrations.test.ts`, `fuel-stock.test.ts` (neu), `snapshot-vorrat.test.ts` (neu), `db-vorrat.test.ts` (neu), `api.test.ts`, `calc-vorrat.test.ts` (neu), `client/src/stockForm.test.ts` (neu), `client/src/components/StockCard.test.tsx` (neu), `client/src/stockView.test.ts` (neu), `client/src/taxView.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 6 anders umsetzt, zieht ihn hier nach, bevor Task 1
beginnt.

- **PR 1** `shared/law/register.ts`: `LawParam<T, M>` mit `describe(value)`, `law(param, ctx, log)` mit
  den Überladungen `periodStart` (`{ period: { from, to } }` → `T`) und `eventDate` (`{ date }` →
  `T`), `createLawLog()`, `valueAt(param, date)`, `germanDate(iso)`, `LAW_AS_OF`, `Source`.
  `shared/law/params.ts`: `LAW_PARAMS`. `shared/law/rules.ts`: `RULES`, `RULES_AS_OF`.
  `server/test/law-literals.test.ts`: `ENGINE_FILES`, `ALLOWED`. `law-history.test.ts`: `SHIPPED` mit
  Zeilen `id|validFrom|validTo|valueJSON`.
- **PR 2** `shared/period.ts`: `PeriodKey`, `BillingPeriod` (`key`, `from`, `to`, `short`),
  `PeriodRules`, `periodKey`, `parsePeriodKey`, `periodOfKey`, `periodContaining`, `previousPeriod`,
  `periodLabel`, `calendarPeriod`, `rulesOf`, `resolvePeriodParam`. `snapshotOf(source, year)`,
  `snapshotFor(source, propertyId, period)`, `frozenSettlementOf(settlement)`,
  `SnapshotClosedSettlement`, `SnapshotCostItem`, `SnapshotSource`; `closedSettlements` mit `period`;
  `closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`,
  `reopenSettlement(db, propertyId, period, historyId)`; `StoredClosedSettlement` in read.ts.
- **PR 3** `shared/degreeDays.ts`: `DayRange`, `degreeDayPermille(ranges, table)`;
  `shared/law/heizkostenv.ts`: `hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'>`;
  `CostItem.heatingPart?: HeatingPart` (`'fuel' | 'operating' | 'metering'`).
- **PR 4** `shared/types.ts`: `HeatingPlant`, `HeatingEnergy`, `HeatingPeriodData`; schema.ts
  `heatingPlants`, `heatingPeriods`, `oneOf`, `notNegative`, `exactly`; repository.ts `HeatingError`,
  `has`, `raw`, `merged`, `oneOfOrUndefined`, `ISO_DATE`; `HEATING_CATEGORY` (`shared/heating.ts`).
- **PR 5** `shared/heatingPeriod.ts`: `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`,
  `hasOwnRhythm`; snapshot.ts `wayOf`, `SnapshotHeatingPart`, `Snapshot.heatingParts`,
  `Snapshot.scope`, `Snapshot.objectRules`, `heatingSnapshotFor(source, propertyId, plantId, h)`,
  `SnapshotSource.closedHeatingSettlements?`; `db/heatingSettlements.ts`: `closeHeatingSettlement`,
  `reopenHeatingSettlement`; read.ts `StoredClosedHeatingSettlement`, `readClosedHeatingSettlements`.
- **PR 6** `shared/types.ts`: `Co2Statement`, `HeatingStatement`, `HeatingPeriodView`,
  `SettlementRow.kind`, `NoticeSubject` + `'heatingCosts'`; schema.ts `co2Statements`; snapshot.ts
  `SnapshotHeatingPlant` (mit `energy`), `SnapshotHeatingPeriodRow`, `Snapshot.co2Statements?`,
  `Snapshot.heatingPeriodRows?`; read.ts `readHeatingPeriodRows`; `server/src/co2.ts` `Co2Pot`,
  `co2PotsOf(snapshot, items)`, `CO2_FUELS`; `server/src/db/co2.ts` mit den modulinternen Helfern
  `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`,
  `PlantContext` und der Funktion `heatingPeriodViews`; im CO₂-Block von `computeSettlement`
  `co2Pots`, `heatingStatements`, `report`, `heatingSettled`, `cutsOn(ids, pct)`, `where`, `ids`,
  `plantSubject`, `hPeriod`, `st`, `applicable`, `service`; `warn`, `fmtCents`, `fmtDay`, `andList`,
  `itemSubject`, `lawLog`, `landlordRows`, `statements`; die Seite `client/src/pages/Heizkosten.tsx`
  mit der Schleife je Heizperiode; `client/src/co2View.ts` und `Co2Block`; `server/testing/co2.ts`
  mit `withoutCo2`.

## Annahmen über PR 7

Der Plan von PR 7 lag beim Schreiben dieses Plans nicht vor. Die folgenden Namen sind aus dem Entwurf
(5.4, 5.7, 9.4, 13 PR 7) und den Gewohnheiten der Pläne PR 4 bis PR 6 abgeleitet. **Vor Task 1**
gleicht die ausführende Sitzung jede Zeile mit dem Plan bzw. Code von PR 7 ab und ersetzt in diesem
Plan jeden abweichenden Namen, bevor sie beginnt; die Zeile „Wo benutzt“ nennt jede Stelle.

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| A1 | `shared/types.ts`: `FuelDelivery` mit den Feldern des Entwurfs 5.4 in camelCase (`id`, `plantId`, `amountCents`, `label`, `invoiceDate`, `deliveredAt`, `invoiceFrom`, `invoiceTo`, `unitId`, `quantity`, `quantityUnit`, `emissionsKg`, `co2CostCents`, `sharePermille`, `fixedCents`, `estimated`, `usedByService`, …); `QuantityUnit = 'l' \| 'kg' \| 'm3' \| 'kWh' \| 'srm'`; `CostItem.fuelDeliveryId?: string \| null` | Task 3, 4, 5, 7 |
| A2 | `SettlementRow.kind` kennt `'fuelCarry'`; `LandlordReason` kennt `'fuelCarry'` mit einer Beschriftung in `client/src/landlordReasons.ts` | Task 7 |
| A3 | PR 7 erzeugt zwei Schritte, der letzte ist `0023_…`; `fuel_deliveries` verweist nicht auf `heating_periods` neu | Task 2 |
| A4 | read.ts: `readFuelDeliveries(db)`, `Stock.fuelDeliveries`; snapshot.ts: `SnapshotFuelDelivery`, `Snapshot.fuelDeliveries?`, der Quellparameter von `snapshotFor` und `heatingSnapshotFor` nimmt `fuelDeliveries?`; `SnapshotCostItem` enthält `fuelDeliveryId` | Task 4 |
| A5 | `server/src/fuel.ts` exportiert `STOCK_ENERGIES` (`['oil', 'lpg', 'pellets', 'wood', 'coal']`, PR 7 Task 3) | Task 3 (wird nach `shared/fuelStock.ts` verlegt) |
| A6 | `server/src/db/fuel.ts`: `guardFuelDelivery(db, plant, after)` lehnt eine Lieferung an einer Anlage mit Vorratsenergie ab: `if (STOCK_ENERGIES.includes(plant.energy)) throw new HeatingError(400, LATER.stock)` | Task 5 |
| A7 | **Naht N1:** Im CO₂-Block entscheidet PR 7 je Topf mit `const ownSplitByDeliveries = …`, ob selbst aufgeteilt wird (Anlage `manual`, oder CO₂-Methode `selfAfterService` mit Lieferungen), und bestimmt dafür vor der Einstufung `const fuel = fuelTotals(pot, snapshot, lawLog)` mit `{ emissionsKg: number; co2Cents: number; grossCents: number \| null; coveragePermille: number }`; danach liest es nur noch `fuel.*`, bei `selfAfterService` meldet es aus `fuel.grossCents` `co2.service-fuel-mismatch` | Task 6, 7 |
| A8 | Die Regel `heating-consumed-fuel` (Entwurf 10.2) steht nach PR 7 noch nicht in `RULES` | Task 1 Step 4 |
| A9 | x_t bei `manual` ist der exakte Anteil an den Topfpositionen mit `fuelDeliveryId` oder `heatingPart === 'fuel'` (Entwurf 9.4, B8) | Task 7 (Übertragsposten tragen `heatingPart: 'fuel'`) |
| A10 | Die Seite Heizkosten zeigt je Anlage und Heizperiode seit PR 7 auch für `manual` Karten; die Lieferungen stehen in der Karte `FuelCard` (`client/src/components/FuelCard.tsx`, PR 7 Task 11); `HeatingPeriodView` hat `deliveries` | Task 8 |
| A11 | Route der Lieferungen: `POST /api/heating-plants/:id/fuel-deliveries` → 201 mit der Lieferung, Rumpf mit den Feldern aus A1 | Task 5 (api-Test) |

Weicht PR 7 in A6 so ab, dass gar keine Sperre der Vorratsenergien besteht, entfällt Task 5 Step 6;
fehlt A8 nicht, sondern steht die Regel schon, entfällt Task 1 Step 4, und die Tests nehmen ihre
Fassung. Jede andere Abweichung ist eine Umbenennung.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **kg auf das Hundertstel statt auf 0,1 kg** (8.2: „Gerundet wird je Posten auf den Cent bzw.
   0,1 kg“). Die Zahlen desselben Abschnitts und der Tests (12.2: E 15.254,91 kg, Endbestand
   4.817,34 kg; G-D2: „kg der Lieferung vom 10.10. exakt 6.690,75“) haben zwei Nachkommastellen; mit
   0,1 kg ergäben sich 4.817,3 kg und E = 15.254,95 kg. Der Plan folgt den nachgerechneten Zahlen.
   An der Einstufung ändert das nichts, gerundet wird der spezifische Wert (§ 5 Abs. 1 Satz 3).
2. **`fuel.stock-missing` ist in PR 8 eine Warnung** (10.1: „error bei `self`, warning (3 %) bei
   `selfAfterService`“). Weil eine Stufe am Code hängt (#112), bekommt der Fehler bei `self` mit PR 10
   einen eigenen Code. Der Entwurf weist den Fehler PR 10 zu (G-B4); hier entsteht nur die Warnung.
3. **Der eingefrorene Endbestand steht im abgeschlossenen Stand**, als `Settlement.heating[].stock`
   (5.7: `Settlement.heating` „mit … Werten“), und nicht in einer neuen Spalte. `frozenSettlementOf`
   liest ihn wie Eigenanteil und Vorauszahlung; ein Wiederöffnen hebt ihn ohne Zutun auf (Review
   Focus 3). Ein Abschluss von vor dieser Version kennt ihn nicht; dann gilt der Anfangsbestand, den
   der Vermieter in der Folgeperiode einträgt.
4. **Der Anfangsbestand ist nur in der ersten Heizperiode mit Vorrat einzutragen.** Hat die
   Vorperiode einen Endbestand, ist er der Anfangsbestand (derselbe Tank, dieselbe Peilung); eine
   eigene Eingabe lehnt der Server ab (400), sonst ginge Geld zwischen den Perioden verloren. Das ist
   die „Vorbelegung“ aus 8.2, ohne Überschreiben.
5. **Schlüssel der Übertragsposten bei `manual`** (8.2: „mit dem Schlüssel der Brennstoffposition“):
   die Brennstoffposition der Heizperiode mit dem größten Betrag, sonst die jüngste der Vorperiode;
   Einzelbeträge und „laut Gemeinschaftsabrechnung“ taugen nicht als Schlüssel. Gibt es keine, gilt
   „ohne Bestand“ (`fuel.manual-by-delivery`) mit eigenem Satz.
6. **Kosten einer Vorratslieferung:** Σ der verknüpften Positionen (`fuelDeliveryId`), sonst
   `amountCents` der Lieferung (5.4). Bei `selfAfterService` darf der Betrag fehlen; dann prüft
   Mietfuchs G gegen V nicht.
7. **Bei `selfAfterService` zählen beim Vorrat alle Lieferungen der Heizperiode**, nicht nur die mit
   `usedByService`: Der Messdienst verteilt bei Vorratsenergien den Verbrauch aus seiner eigenen
   Bestandsrechnung, also Anfangsbestand, alle Lieferungen und Endbestand. G ist dann der verbrauchte
   Betrag.
8. **Vorratsenergien sind die vier des Entwurfs und Kohle** (8.2, 14.1; PR 7 Task 3): Heizöl,
   Flüssiggas, Pellets, Holz und Kohle. Der Entwurf nennt Kohle nicht, PR 7 führt sie aber in
   `STOCK_ENERGIES`, und fachlich ist sie Vorrat: Sie liegt im Lager, wird in Kilogramm geliefert und
   nicht im selben Zeitraum verbraucht, und seit 2023 trägt sie CO₂-Kosten nach dem BEHG. Ließe PR 8
   sie aus der Liste fallen, wären Lieferungen an einer Kohleanlage nach PR 8 ohne Bestandsrechnung
   erlaubt, und die CO₂-Aufteilung liefe nach dem gelieferten statt dem verbrauchten Brennstoff
   (Prüfung vom 05.10.2026, Schnittstellen `STOCK_ENERGIES`).
9. **VIII ZR 298/80** (Minol beruft sich darauf) ist im Entwurf „ungeprüft, vor PR 8 lesen“. Task 9
   Step 5 liest es vor dem Merge und hält das Ergebnis in der PR-Beschreibung fest; die Regel stützt
   sich bis dahin auf [M] Minol, und daran hängt keine Zahl, die eine Rechtsquelle braucht.

---
### Task 1: Rechtsregister, Regel und Lexikon

Der Parameter, den der Entwurf PR 8 zuweist (4.3): `co2.costs-before`, Zeitregel `eventDate`
(Rechnungsdatum). Wortlaut § 11 Abs. 2 CO2KostAufG am 05.10.2026 gelesen: „Kohlendioxidkosten, die
aufgrund des Verbrauchs von Brennstoffmengen anfallen, die vor dem 1. Januar 2023 in Rechnung gestellt
worden sind, bleiben unberücksichtigt.“ Dazu die Regel `heating-consumed-fuel` (10.2; § 7 Abs. 2
HeizkostenV im Wortlaut: „die Kosten … der verbrauchten Brennstoffe und ihrer Lieferung“; BGH
01.02.2012, VIII ZR 156/11) und der Begriff `fuelStock` (10.3), den jeder neue Code trägt.

**Files:**
- Modify: `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes (PR 1, PR 6): `LawParam`, `Source`, `law`, `createLawLog`, `valueAt`, `germanDate`, `LAW_AS_OF`; in `co2kostaufg.ts` die Konstanten `ENACTED`, `BASE` und die Funktion `checked(cite, page)`.
- Produces:
  - `co2CostsBefore: LawParam<boolean, 'eventDate'>` (`'co2.costs-before'`; `true` heißt „unberücksichtigt“)
  - `co2CostsExcludedUntil(): string` (`'2022-12-31'`), `co2CostsCountedFrom(): string` (`'2023-01-01'`)
  - Regel `heating-consumed-fuel` in `RULES`
  - `TermId` + `'fuelStock'`

- [ ] **Step 1: Write the failing tests**

In `server/test/law.test.ts` den Import aus `'../../shared/law/co2kostaufg.ts'` um
`co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil` ergänzen und anhängen:

```ts
// ---------- Brennstoff vor 2023 (Heizung PR 8) ----------

test('co2.costs-before: Rechnung bis 31.12.2022 unberücksichtigt, ab 01.01.2023 berücksichtigt (§ 11 Abs. 2 Satz 2, Entwurf 4.3)', () => {
  const log = createLawLog()
  assert.equal(law(co2CostsBefore, { date: '2022-12-31' }, log), true)
  assert.equal(law(co2CostsBefore, { date: '2023-01-01' }, log), false)
  assert.equal(co2CostsExcludedUntil(), '2022-12-31')
  assert.equal(co2CostsCountedFrom(), '2023-01-01')
  assert.equal(co2CostsBefore.timing, 'eventDate')
  assert.equal(co2CostsBefore.norm, '§ 11 Abs. 2 Satz 2 CO2KostAufG')
  assert.deepEqual(log.values.map((v) => [v.id, v.value]), [['co2.costs-before', true], ['co2.costs-before', false]])
})

test('Regel heating-consumed-fuel: verbrauchte statt gelieferte Brennstoffe (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR 156/11)', () => {
  const r = RULES.find((x) => x.code === 'heating-consumed-fuel') ?? assert.fail('Regel heating-consumed-fuel fehlt')
  assert.equal(r.norm, '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11')
  assert.match(r.summary, /Kosten der verbrauchten Brennstoffe/)
  assert.match(r.summary, /Anfangsbestand \+ Lieferungen − Endbestand/)
  assert.equal(r.validFrom, undefined)
})
```

In `server/test/law-history.test.ts` in `SHIPPED` hinter den Zeilen von PR 7 einfügen:

```ts
  // 0.11.0 (Heizung PR 8)
  'co2.costs-before||2022-12-31|true',
  'co2.costs-before|2023-01-01||false',
```

In `server/test/glossary.test.ts` anhängen:

```ts
test('Brennstoffvorrat (Heizung PR 8): Beispiel nachgerechnet', () => {
  // Anfangsbestand 2.000 l / 1.900 €, Lieferungen 3.000 l / 3.150 € und 2.500 l / 2.500 €,
  // Endbestand 1.800 l aus der jüngsten Lieferung: 1.800 / 2.500 × 2.500 € = 1.800 €.
  assert.equal(2000 + 3000 + 2500 - 1800, 5700)
  assert.equal((1800 / 2500) * 250000, 180000)
  assert.equal(190000 + 315000 + 250000 - 180000, 575000)
  assert.equal(315000 + 250000, 565000)
  const t = GLOSSARY.fuelStock
  assert.match(t.example, /Endbestand 1\.800 l.*1\.800 €.*5\.700 l.*5\.750 €.*5\.650 €.*100 €/s)
  assert.equal(t.norm, '§ 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11')
  assert.match(t.short, /jüngsten Lieferungen/)
  assert.match(t.needed, /Heizöl, Flüssiggas, Pellets, Holz oder Kohle/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL mit `SyntaxError: The requested module '…/co2kostaufg.ts' does not provide an export
named 'co2CostsBefore'` und in glossary.test.ts mit `Cannot read properties of undefined (reading
'example')`.

- [ ] **Step 3: Parameter (`shared/law/co2kostaufg.ts`)**

Ans Dateiende:

```ts
// CO₂-Kosten aus Brennstoff, der vor dem 01.01.2023 in Rechnung gestellt wurde, bleiben
// unberücksichtigt (§ 11 Abs. 2 Satz 2); seine kg zählen für die Einstufung (Entwurf 3.9). Zeitregel
// `eventDate`: Es zählt das Datum der Rechnung. `true` heißt „unberücksichtigt“. Heizung PR 8, für den
// Vorrat: Altbestand trägt keine CO₂-Kosten.
export const co2CostsBefore: LawParam<boolean, 'eventDate'> = {
  id: 'co2.costs-before',
  title: 'CO₂-Kosten aus Rechnungen vor 2023',
  norm: '§ 11 Abs. 2 Satz 2 CO2KostAufG',
  timing: 'eventDate',
  versions: [
    { validTo: '2022-12-31', value: true, source: checked('§ 11 Abs. 2 Satz 2 CO2KostAufG', '__11.html'), enacted: ENACTED },
    { validFrom: '2023-01-01', value: false, source: checked('§ 11 Abs. 2 Satz 2 CO2KostAufG', '__11.html'), enacted: ENACTED },
  ],
  describe: (v) => (v ? 'unberücksichtigt (in Rechnung gestellt vor dem 01.01.2023)' : 'berücksichtigt'),
}

// Die beiden Grenztage aus den Fassungen, für einen Altbestand, dessen Rechnung Mietfuchs nur als
// „vor dem 01.01.2023“ kennt, und für Texte. Gerechnet wird mit `law(co2CostsBefore, …)`.
export function co2CostsExcludedUntil(): string {
  const last = co2CostsBefore.versions.find((v) => v.value)?.validTo
  if (!last) throw new Error('Rechtsregister: Ende des § 11 Abs. 2 Satz 2 fehlt')
  return last
}
export function co2CostsCountedFrom(): string {
  const first = co2CostsBefore.versions.find((v) => !v.value)?.validFrom
  if (!first) throw new Error('Rechtsregister: Beginn der berücksichtigten CO₂-Kosten fehlt')
  return first
}
```

`shared/law/params.ts`: den Import aus `'./co2kostaufg.ts'` um `co2CostsBefore` ergänzen und in
`LAW_PARAMS` (nach Kennung geordnet) direkt vor `co2CutMissing` einfügen:

```ts
  co2CostsBefore,
```

- [ ] **Step 4: Regel (`shared/law/rules.ts`)**

In `RULES` hinter der Regel `heating-dhw-split` (PR 6) anhängen:

```ts
  {
    // Heizung PR 8 (#97, #99): § 7 Abs. 2 HeizkostenV im Wortlaut geprüft am 05.10.2026; BGH VIII ZR
    // 156/11: kein Abflussprinzip bei Heizkosten. Die Bewertung des Endbestands ist Praxis der
    // Messdienste ([M] Minol) und steht deshalb als „wie die Messdienste“ da.
    code: 'heating-consumed-fuel',
    title: 'Kosten der verbrauchten Brennstoffe',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    summary:
      'Umgelegt werden die Kosten der verbrauchten Brennstoffe des Abrechnungszeitraums, nicht die der gelieferten oder bezahlten. ' +
      'Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle ergibt sich der Verbrauch aus Anfangsbestand + Lieferungen − Endbestand; ' +
      'den Endbestand bewertet Mietfuchs wie die Messdienste zu den Preisen der jüngsten Lieferungen.',
  },
```

Prüft `law-wording.test.ts` oder `rechtstexte.test.ts` die Liste der Regelcodes wörtlich, dort
`'heating-consumed-fuel'` hinter `'heating-dhw-split'` ergänzen. Steht die Regel nach PR 7 schon
(Annahme A8), entfällt dieser Step, und der Test aus Step 1 prüft deren Fassung; weicht sie im
Wortlaut ab, wird der Test an ihren Wortlaut angeglichen, nicht umgekehrt.

- [ ] **Step 5: Begriff (`shared/glossary.ts`)**

In `GLOSSARY` hinter `co2Split` (PR 6):

```ts
  fuelStock: {
    title: 'Brennstoffvorrat (Bestandsrechnung)',
    short: 'Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle liegt der Brennstoff im Tank oder Lager, und nicht jede Lieferung wird im selben Abrechnungszeitraum verbraucht. Umgelegt werden die Kosten des verbrauchten Brennstoffs: Anfangsbestand plus Lieferungen minus Endbestand. Verbraucht wird das Älteste zuerst; den Endbestand bewertet Mietfuchs deshalb wie die Messdienste zu den Preisen der jüngsten Lieferungen.',
    example: 'Anfangsbestand 2.000 l für 1.900 €, Lieferungen 3.000 l für 3.150 € und 2.500 l für 2.500 €, Endbestand 1.800 l. Der Endbestand stammt aus der jüngsten Lieferung und ist 1.800 € wert. Verbraucht wurden 5.700 l für 1.900 € + 3.150 € + 2.500 € − 1.800 € = 5.750 €; bezahlt haben Sie in diesem Zeitraum 5.650 €. Die 100 € Unterschied stehen in der Abrechnung als „aus dem Vorrat“ und „im Vorrat“.',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11',
    needed: 'Ja, wenn Sie mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle heizen und die Heizkosten selbst nach Schlüsseln verteilen, oder wenn der Messdienst die CO₂-Kosten nicht aufgeteilt hat. Dann tragen Sie auf der Seite Heizkosten in der Karte „Vorrat“ Anfangs- und Endbestand ein.',
  },
```

`TermId` ist der Schlüsseltyp von `GLOSSARY`; ist er als eigene Vereinigung geschrieben, dort
`| 'fuelStock'` ergänzen.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-literals.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Die Beträge im Beispiel sind Beispielzahlen und keine Rechtswerte; kein Muster des
Wächters trifft sie.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS. Ein Test, der `legalBasis.rules` einer Abrechnung wörtlich vergleicht, bekommt die
Regel `heating-consumed-fuel` an der Stelle, an der `rulesFor` sie liefert; andere Erwartungen ändern
sich nicht.

```bash
git add shared/law/co2kostaufg.ts shared/law/params.ts shared/law/rules.ts shared/glossary.ts server/test
git commit -m "Rechtsregister: CO₂-Kosten aus Rechnungen vor 2023, Regel zu verbrauchten Brennstoffen, Lexikon Vorrat

co2.costs-before (§ 11 Abs. 2 Satz 2 CO2KostAufG, Rechnungsdatum), heating-consumed-fuel (§ 7 Abs. 2
HeizkostenV, BGH VIII ZR 156/11) und der Begriff fuelStock.

Refs #97, #99"
```

---
### Task 2: Datenmodell und Migrationen

Acht Spalten für den Vorrat an `heating_periods` (Entwurf 5.3, Gruppe „Vorrat“) und die Typen, die
Berechnung, Routen, Ausweis und Oberfläche teilen. Zwei erzeugte Schritte, weil eine neue Bedingung an
einer bestehenden Tabelle einen Neubau verlangt (server/drizzle/README.md, „Neue Spalten und
geänderte Bedingungen nie in einem Schritt“).

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`
- Create (erzeugt): `server/drizzle/0024_vorrat.sql`, `server/drizzle/0025_vorrat_bedingungen.sql`, `server/drizzle/meta/0024_snapshot.json`, `server/drizzle/meta/0025_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`

**Interfaces:**
- Consumes (PR 4, PR 6): `heatingPeriods`, `exactly`, `oneOf`, `notNegative`, `check`, `sql`; `HeatingPeriodData`, `HeatingStatement`, `HeatingPeriodView`, `PeriodKey`, `TaxReport`.
- Produces:
  - `StockUnit = 'l' | 'kg' | 'srm'`
  - `StockLayer = { label: string; date: string | null; quantity: number; costCents: number | null; emissionsKg: number; co2Cents: number; co2Counted: boolean }`
  - `StockValue = { quantity: number; costCents: number | null; emissionsKg: number; co2Cents: number; layers: StockLayer[] }`
  - `HeatingStockStatement` (Felder in Step 3)
  - `StockRow = Pick<HeatingPeriodData, 'stockUnit' | 'openingQuantity' | 'openingCostCents' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'closingQuantity' | 'closingMeasuredOn'>`
  - `StockView = { row: StockRow; derived: { value: StockValue; period: PeriodKey; label: string; frozen: boolean } | null; statement: HeatingStockStatement | null; problem: string | null }`
  - `HeatingPeriodData` + die acht Felder von `StockRow`; `HeatingStatement.stock?: HeatingStockStatement | null`; `HeatingPeriodView.stock: StockView | null`; `TaxReport['expenses'].stockCarrySelfCents?: number`
  - schema.ts: `STOCK_UNITS`; Spalten `stockUnit`, `openingQuantity`, `openingCostCents`, `openingEmissionsKg`, `openingCo2Cents`, `openingInvoicedBefore2023`, `closingQuantity`, `closingMeasuredOn`

- [ ] **Step 1: Write the failing tests**

`server/test/schema.test.ts` anhängen (die Zusicherung `_HeatingPeriods` aus PR 4 deckt die neuen
Spalten über `HeatingPeriodData` mit ab):

```ts
// ---------- Vorrat (Heizung PR 8) ----------

test('Vorrat: Einheit aus der Liste, Mengen, Beträge und kg ab 0, Peildatum als Datum', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'oil', 'manual')")
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')")
    assert.deepEqual(
      connection.rows('SELECT stock_unit, opening_quantity, opening_cost_cents, opening_emissions_kg, opening_co2_cents, opening_invoiced_before_2023, closing_quantity, closing_measured_on FROM heating_periods')[0],
      [null, null, null, null, null, null, null, null],
    )
    assert.equal(
      rejects(connection, "UPDATE heating_periods SET stock_unit = 'l', opening_quantity = 2000, opening_cost_cents = 190000, opening_emissions_kg = 5352.6, opening_co2_cents = 0, opening_invoiced_before_2023 = 1, closing_quantity = 1800, closing_measured_on = '2025-12-31'"),
      null,
    )
    assert.ok(rejects(connection, "UPDATE heating_periods SET stock_unit = 'm3'"), 'Einheit m³ gibt es beim Vorrat nicht')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_quantity = -1'), 'negative Menge')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_cost_cents = -1'), 'negativer Betrag')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_emissions_kg = -0.1'), 'negative kg')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_co2_cents = -1'), 'negative CO₂-Kosten')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET closing_quantity = -5'), 'negativer Endbestand')
    assert.ok(rejects(connection, "UPDATE heating_periods SET closing_measured_on = '31.12.2025'"), 'Peildatum kein ISO-Datum')
  } finally {
    cleanup()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/schema.test.ts`
Expected: FAIL mit `no such column: stock_unit`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

`HeatingPeriodData` (PR 4) bekommt als letzte Felder:

```ts
  // Vorrat (Heizung PR 8, Entwurf 5.3, 8.2): Einheit, Anfangsbestand mit Wert, kg und CO₂-Kosten, ob
  // er vor dem 01.01.2023 in Rechnung gestellt wurde, Endbestand und Tag der Peilung. Eingetragen wird
  // der Anfangsbestand nur in der ersten Heizperiode mit Vorrat; danach ist er der Endbestand der
  // Vorperiode.
  stockUnit: StockUnit | null
  openingQuantity: number | null
  openingCostCents: number | null
  openingEmissionsKg: number | null
  openingCo2Cents: number | null
  openingInvoicedBefore2023: boolean | null
  closingQuantity: number | null
  closingMeasuredOn: string | null
```

`HeatingStatement` (PR 6) bekommt als letztes Feld:

```ts
  // Die Bestandsrechnung dieser Heizperiode (Heizung PR 8). Sie friert mit dem Abschluss ein; die
  // Folgeperiode liest daraus ihren Anfangsbestand (G-A4). Fehlt sie, gibt es keinen Vorrat oder er
  // ließ sich nicht rechnen.
  stock?: HeatingStockStatement | null
```

`HeatingPeriodView` (PR 6, PR 7) bekommt als letztes Feld:

```ts
  // Der Vorrat dieser Heizperiode (Heizung PR 8); `null` bei einer Anlage ohne Vorratsenergie.
  stock: StockView | null
```

In `TaxReport['expenses']` hinter `labor35aCents`:

```ts
    // Heizung PR 8: Eigenanteil am Übertrag aus dem Brennstoffvorrat in den Abrechnungen dieses Jahres.
    // Die Abrechnung zeigt den Verbrauch, die Steuerübersicht das Bezahlte (Entwurf 8.2, N8); um diesen
    // Betrag liegen beide beim Eigenanteil auseinander. Fehlt das Feld, gibt es keinen Übertrag.
    stockCarrySelfCents?: number
```

Ans Dateiende:

```ts
// ---------- Brennstoffvorrat (Heizung PR 8, Entwurf 5.3, 8.2) ----------

// Die Einheit eines Vorrats: Liter (Heizöl, Flüssiggas), Kilogramm (Flüssiggas, Pellets, Holz, Kohle),
// Schüttraummeter (Holzhackschnitzel).
export type StockUnit = 'l' | 'kg' | 'srm'

// Ein Teil eines Vorrats mit seiner Herkunft. `costCents` null: Der Betrag ist unbekannt (Messdienst
// ohne Rechnungsbetrag). `co2Counted` false: in Rechnung gestellt vor dem 01.01.2023; die kg zählen,
// die CO₂-Kosten nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG). `co2Cents` ist der Betrag laut Rechnung.
export type StockLayer = {
  label: string
  date: string | null
  quantity: number
  costCents: number | null
  emissionsKg: number
  co2Cents: number
  co2Counted: boolean
}

// Ein bewerteter Bestand, zusammen und je Teil. `co2Cents` zählt nur die berücksichtigten CO₂-Kosten;
// `costCents` ist null, wenn ein Teil keinen Betrag hat.
export type StockValue = {
  quantity: number
  costCents: number | null
  emissionsKg: number
  co2Cents: number
  layers: StockLayer[]
}

// Die Bestandsrechnung einer Heizperiode.
export type HeatingStockStatement = {
  unit: StockUnit
  opening: StockValue
  // Woher der Anfangsbestand kommt: eingetragen (erste Heizperiode mit Vorrat), aus dem Endbestand
  // der offenen Vorperiode oder aus dem eingefrorenen einer abgeschlossenen.
  openingSource: 'own' | 'previous' | 'frozen'
  deliveries: StockLayer[]
  closing: StockValue
  closingMeasuredOn: string | null
  consumed: { quantity: number; costCents: number | null; emissionsKg: number; co2Cents: number }
  // Σ der Lieferungen dieser Heizperiode; null, wenn eine keinen Betrag hat.
  paidCents: number | null
  // kg aus Brennstoff mit Rechnung vor dem 01.01.2023, die in dieser Heizperiode verbraucht wurden.
  oldStockKg: number
}

// Was die Karte „Vorrat“ zu einer Heizperiode lädt.
export type StockRow = Pick<
  HeatingPeriodData,
  'stockUnit' | 'openingQuantity' | 'openingCostCents' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'closingQuantity' | 'closingMeasuredOn'
>
export type StockView = {
  row: StockRow
  // Der Anfangsbestand aus der Vorperiode; dann ist keiner einzutragen. `frozen`: aus einer
  // abgeschlossenen Vorperiode.
  derived: { value: StockValue; period: PeriodKey; label: string; frozen: boolean } | null
  statement: HeatingStockStatement | null
  // Was fehlt oder nicht passt, als Satz für die Karte.
  problem: string | null
}
```

- [ ] **Step 4: Erster Schritt: Spalten (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `StockUnit` ergänzen. Direkt vor
`export const heatingPeriods = …` (PR 4):

```ts
// Einheiten eines Vorrats (Heizung PR 8, Entwurf 5.3).
export const STOCK_UNITS = exactly<StockUnit>()(['l', 'kg', 'srm'] as const)
```

In `heatingPeriods` hinter `infoContactsConfirmed: …` (die Bedingungen bleiben in diesem Step, wie
sie sind):

```ts
    // Vorrat (Heizung PR 8, Entwurf 5.3, 8.2). Eingetragen wird der Anfangsbestand nur in der ersten
    // Heizperiode mit Vorrat; danach ist er der Endbestand der Vorperiode (db/fuelStock.ts).
    stockUnit: text('stock_unit', { enum: STOCK_UNITS }),
    openingQuantity: real('opening_quantity'),
    openingCostCents: integer('opening_cost_cents'),
    openingEmissionsKg: real('opening_emissions_kg'),
    openingCo2Cents: integer('opening_co2_cents'),
    openingInvoicedBefore2023: integer('opening_invoiced_before_2023', { mode: 'boolean' }),
    closingQuantity: real('closing_quantity'),
    closingMeasuredOn: text('closing_measured_on'),
```

Run: `npm --prefix server run db:generate -- --name vorrat`

Expected: eine neue Datei `server/drizzle/0024_vorrat.sql` hinter dem letzten Schritt von PR 7 mit
genau acht `ALTER TABLE \`heating_periods\` ADD …`. **Kein** `__new_`, kein `CREATE TABLE`. Steht ein
Neubau darin, ist eine Bedingung mitgekommen: Datei, Journal-Eintrag und Momentaufnahme löschen,
Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In den Bedingungen von `heatingPeriods` (das zweite Argument von `sqliteTable('heating_periods', …)`)
hinter `notNegative('heating_periods_dhw_volume_not_negative', 'dhw_volume_m3'),`:

```ts
    // Vorrat (Heizung PR 8)
    oneOf('heating_periods_stock_unit_known', 'stock_unit', STOCK_UNITS),
    notNegative('heating_periods_opening_quantity_not_negative', 'opening_quantity'),
    notNegative('heating_periods_opening_cost_not_negative', 'opening_cost_cents'),
    notNegative('heating_periods_opening_emissions_not_negative', 'opening_emissions_kg'),
    notNegative('heating_periods_opening_co2_not_negative', 'opening_co2_cents'),
    notNegative('heating_periods_closing_quantity_not_negative', 'closing_quantity'),
    check('heating_periods_closing_measured_on_valid', sql.raw(`"closing_measured_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
```

Run: `npm --prefix server run db:generate -- --name vorrat_bedingungen`

Expected: `server/drizzle/0025_vorrat_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, genau einem
Neubau `__new_heating_periods` samt `INSERT INTO … SELECT`, `DROP TABLE`, `RENAME` und dem eindeutigen
Index `heating_periods_plant_period_idx`, dann `PRAGMA foreign_keys=ON`. Kein `ALTER TABLE … ADD`.
Die Tabellen, die auf `heating_periods` zeigen (`co2_statements` aus PR 6, die Überträge aus PR 7),
werden nicht neu gebaut; ihre Fremdschlüssel überstehen den Neubau, weil `applyMigrations` ihn mit
abgeschalteter Prüfung und anschließendem `PRAGMA foreign_key_check` fährt (client.ts).

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('vorrat')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter der letzten Marke von PR 7 die beiden
ausgegebenen Zeilen einfügen, darüber:

```ts
  // Heizung PR 8. Wird PR 7 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt und die
  // Marken hier ersetzt.
```

Die Prüfsummen sind keine offenen Stellen: Erst die Ausgabe des Befehls nennt sie.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-golden.test.ts test/db-objekte.test.ts test/db-changeover.test.ts test/db-co2.test.ts && npm run typecheck`
Expected: PASS. `npm run typecheck` meldet jede Stelle, die ein `HeatingPeriodData` oder einen
`HeatingPeriodView` als Literal baut (Tests aus PR 4 bis PR 7, `heatingPeriodViews` in db/co2.ts).
Die Literale in Tests bekommen die acht Felder mit `null`; in `heatingPeriodViews` kommt
`stock: null` hinzu, bis Task 5 die Ansicht füllt.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/src/db/co2.ts server/drizzle server/test
git commit -m "Vorrat: acht Spalten an den Heizperioden, Typen für Bestandsrechnung und Ansicht

Zwei erzeugte Schritte: erst die Spalten, dann die Bedingungen.

Refs #97, #99"
```

---
### Task 3: Die Bestandsrechnung (`server/src/fuelStock.ts`)

Alles, was ohne Abrechnung prüfbar ist: Bewertung des Endbestands nach Minol mit Rundung je Posten,
Verbrauch, Altbestand vor 2023, Prüfungen, die Kette über Vorperioden mit eingefrorenem Endbestand,
das Peildatum und das Lesen eines eingefrorenen Endbestands. Dazu die gemeinsame Liste der
Vorratsenergien in `shared/`, weil die Oberfläche sie braucht.

**Files:**
- Create: `shared/fuelStock.ts`, `server/src/fuelStock.ts`
- Modify: `server/src/fuel.ts` (PR 7), `server/test/law-literals.test.ts`
- Test: `server/test/fuel-stock.test.ts` (neu)

**Interfaces:**
- Consumes (Task 1, 2): `StockUnit`, `StockLayer`, `StockValue`, `HeatingStockStatement`, `PeriodKey`, `HeatingEnergy`; `germanDate` (PR 1); `compareText` (calc.ts).
- Produces:
  - `shared/fuelStock.ts`: `STOCK_ENERGIES: readonly HeatingEnergy[]`, `isStockEnergy(e)`, `STOCK_UNIT_TEXT: Record<StockUnit, string>`, `STOCK_UNIT_LABELS: Record<StockUnit, string>`
  - `server/src/fuelStock.ts`: `type StockDeliveryInput`, `type StockOpeningInput`, `type StockPeriodInput`, `type StockProblem`, `type StockResult`, `type StockOptions`, `roundKg(kg)`, `valueOf(layers)`, `closingOf(layers, quantity)`, `stockOf(chain, opts): StockResult`, `measuredOffset(p)`, `readFrozenStock(value): StockValue | null`, `fmtQuantity(q, unit)`, `problemText(problem): string`

- [ ] **Step 1: Write the failing tests**

`server/test/fuel-stock.test.ts`:

```ts
// Brennstoffvorrat (Heizung PR 8, Entwurf 8.2, 12.2 „fuel.test.ts“ zum Öl, 12.3 Nr. 5): Bewertung nach
// Minol, Rundung je Posten, Altbestand vor 2023, Prüfungen, Kette und eingefrorener Endbestand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measuredOffset, problemText, readFrozenStock, stockOf, type StockDeliveryInput, type StockOptions, type StockPeriodInput } from '../src/fuelStock.ts'
import { periodKey } from '../../shared/period.ts'
import type { StockValue } from '../../shared/types.ts'

// § 11 Abs. 2 Satz 2 CO2KostAufG wie im Register: Rechnungen bis 31.12.2022 zählen nicht.
const OPTS: StockOptions = {
  needCost: true, needCo2: true, countedAt: (d) => d >= '2023-01-01', excludedUntil: '2022-12-31', countedFrom: '2023-01-01',
}
const lieferung = (over: Partial<StockDeliveryInput> & Pick<StockDeliveryInput, 'id' | 'date'>): StockDeliveryInput => ({
  label: `Lieferung ${over.date}`, invoiceDate: over.date, quantity: null, quantityUnit: 'l', costCents: null, emissionsKg: null, co2Cents: null, ...over,
})
// Beispiel Heizöl (Entwurf 8.2): kg der Lieferung vom 10.10. exakt 6.690,75 (G-D2).
const M = lieferung({ id: 'd1', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549 })
const O = lieferung({ id: 'd2', date: '2025-10-10', quantity: 2500, costCents: 250000, emissionsKg: 6690.75, co2Cents: 43791 })
const periode = (over: Partial<StockPeriodInput> = {}): StockPeriodInput => ({
  key: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', unit: 'l',
  ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: true },
  closingQuantity: 1800, closingMeasuredOn: '2025-12-31', deliveries: [M, O], laterDeliveries: [], frozenClosing: null, ...over,
})
const ok = (r: ReturnType<typeof stockOf>) => (r.ok ? r.statement : assert.fail(`kein Ergebnis: ${problemText(r.problem)}`))

test('Heizöl (Entwurf 8.2): 5.750,00 € verbraucht, 5.650,00 € bezahlt, E 15.254,91 kg, C 648,10 €, Endbestand 1.800 € / 4.817,34 kg / 315,30 €', () => {
  const s = ok(stockOf([periode()], OPTS))
  assert.deepEqual(s.consumed, { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 })
  assert.equal(s.paidCents, 565000)
  assert.deepEqual([s.closing.quantity, s.closing.costCents, s.closing.emissionsKg, s.closing.co2Cents], [1800, 180000, 4817.34, 31530])
  // Der Endbestand stammt ganz aus der jüngsten Lieferung ([M] Minol).
  assert.deepEqual(s.closing.layers.map((l) => l.label), ['Lieferung 2025-10-10'])
  // Der Altbestand (Rechnung 2022) hebt mit seinen kg die Stufe, trägt aber keine CO₂-Kosten.
  assert.equal(s.oldStockKg, 5352.6)
  assert.equal(s.openingSource, 'own')
  // Spezifischer Wert bei 300 m²: 50,8497 → 50,8 (Einstufung in co2.ts, § 5 Abs. 1 Satz 3).
  assert.equal(Math.round((s.consumed.emissionsKg / 300) * 10) / 10, 50.8)
})

test('Älteste zuerst: Ein Endbestand größer als die jüngste Lieferung reicht in die vorige, je Teil gerundet', () => {
  const s = ok(stockOf([periode({ closingQuantity: 3000 })], OPTS))
  // 2.500 l aus der Lieferung vom 10.10. ganz, 500 l aus der vom 15.03.: 1/6 von 3.150 € / 8.028,9 kg / 525,49 €.
  assert.deepEqual(s.closing.layers.map((l) => [l.label, l.quantity, l.costCents, l.emissionsKg, l.co2Cents]), [
    ['Lieferung 2025-03-15', 500, 52500, 1338.15, 8758],
    ['Lieferung 2025-10-10', 2500, 250000, 6690.75, 43791],
  ])
  assert.equal(s.consumed.costCents, 755000 - 302500)
  assert.equal(s.consumed.co2Cents, 52549 + 43791 - 8758 - 43791)
})

test('Jahr ohne Lieferung: Verbrauch nur aus dem Vorrat, bezahlt 0 €', () => {
  const vorrat: StockPeriodInput = periode({ key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900, closingMeasuredOn: '2026-12-31' })
  const s = ok(stockOf([periode(), vorrat], OPTS))
  assert.equal(s.openingSource, 'previous')
  assert.deepEqual(s.consumed, { quantity: 900, costCents: 90000, emissionsKg: 2408.67, co2Cents: 15765 })
  assert.equal(s.paidCents, 0)
})

test('Prüfungen: Endbestand zu groß, andere Einheit, fehlende Angaben, jeweils mit Satz', () => {
  const zuGross = stockOf([periode({ closingQuantity: 7600 })], OPTS)
  assert.ok(!zuGross.ok && zuGross.problem.kind === 'invalid')
  assert.match(problemText(zuGross.problem), /Endbestand von 7\.600 l ist größer als Anfangsbestand und Lieferungen zusammen \(7\.500 l\)/)
  const kg = stockOf([periode({ deliveries: [M, { ...O, quantityUnit: 'kg' }] })], OPTS)
  assert.ok(!kg.ok && kg.problem.kind === 'invalid')
  assert.match(problemText(kg.problem), /Lieferung „Lieferung 2025-10-10“ ist in kg erfasst, der Vorrat in l/)
  const ohneEnde = stockOf([periode({ closingQuantity: null })], OPTS)
  assert.ok(!ohneEnde.ok && ohneEnde.problem.kind === 'missing')
  assert.deepEqual(ohneEnde.problem.what, ['der Endbestand'])
  const ohneFrage = stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: null } })], OPTS)
  assert.ok(!ohneFrage.ok)
  assert.match(problemText(ohneFrage.problem), /ob der Anfangsbestand vor dem 01\.01\.2023 in Rechnung gestellt wurde/)
  const ohneBetrag = stockOf([periode({ deliveries: [M, { ...O, costCents: null }] })], OPTS)
  assert.ok(!ohneBetrag.ok)
  assert.match(problemText(ohneBetrag.problem), /hat keinen Betrag/)
  // Messdienst ohne Aufteilung: Beträge dürfen fehlen, dann ist auch das Bezahlte unbekannt.
  const messdienst = ok(stockOf([periode({ deliveries: [M, { ...O, costCents: null }] })], { ...OPTS, needCost: false }))
  assert.deepEqual([messdienst.paidCents, messdienst.consumed.costCents, messdienst.consumed.co2Cents], [null, null, 64810])
  // Pellets: keine CO₂-Aufteilung, kg und CO₂-Kosten dürfen fehlen.
  const pellets = ok(stockOf([periode({ unit: 'kg', ownOpening: { quantity: 1000, costCents: 30000, emissionsKg: null, co2Cents: null, invoicedBefore2023: null }, deliveries: [lieferung({ id: 'p', date: '2025-09-01', quantity: 4000, quantityUnit: 'kg', costCents: 120000 })], closingQuantity: 1500 })], { ...OPTS, needCo2: false }))
  assert.deepEqual([pellets.consumed.quantity, pellets.consumed.costCents], [3500, 105000])
})

test('Bestand aus 2022: CO₂-Kosten 0 € trotz Betrag laut Rechnung, kg zählen (§ 11 Abs. 2 Satz 2)', () => {
  const s = ok(stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 6000, invoicedBefore2023: true }, deliveries: [], closingQuantity: 500 })], OPTS))
  assert.equal(s.consumed.co2Cents, 0)
  assert.equal(s.consumed.emissionsKg, 4014.45)
  assert.equal(s.oldStockKg, 4014.45)
  // Dieselbe Menge mit Rechnung ab 2023: CO₂-Kosten zählen anteilig.
  const neu = ok(stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 6000, invoicedBefore2023: false }, deliveries: [], closingQuantity: 500 })], OPTS))
  assert.equal(neu.consumed.co2Cents, 4500)
})

test('Kette: eingefrorener Endbestand der Vorperiode gilt, ein Fehler der Vorperiode nennt die Vorperiode', () => {
  const vorher = ok(stockOf([periode()], OPTS)).closing
  const eingefroren: StockValue = JSON.parse(JSON.stringify(vorher))
  const folge = periode({ key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900 })
  const s = ok(stockOf([periode({ frozenClosing: eingefroren }), folge], OPTS))
  assert.equal(s.openingSource, 'frozen')
  assert.deepEqual(s.opening, vorher)
  const kaputt = stockOf([periode({ closingQuantity: 9000 }), folge], OPTS)
  assert.ok(!kaputt.ok && kaputt.problem.period === '2025')
  // Die Einheit wechselt zwischen den Perioden: kein stilles Umrechnen.
  const wechsel = stockOf([periode(), { ...folge, unit: 'kg' }], OPTS)
  assert.ok(!wechsel.ok)
  assert.match(problemText(wechsel.problem), /Vorrat der Vorperiode ist in l geführt, dieser in kg/)
})

test('Eingefrorener Endbestand: gelesen, wie er geschrieben wurde; Krummes ist keiner', () => {
  const closing = ok(stockOf([periode()], OPTS)).closing
  assert.deepEqual(readFrozenStock(JSON.parse(JSON.stringify(closing))), closing)
  assert.equal(readFrozenStock(null), null)
  assert.equal(readFrozenStock({ layers: 'x' }), null)
  assert.equal(readFrozenStock({ layers: [{ label: 'a', date: null, quantity: '1', costCents: 1, emissionsKg: 1, co2Cents: 1, co2Counted: true }] }), null)
})

test('Peilung neben dem Ende (Review Focus 1): Tage und Lieferungen, die die Peilung nicht oder schon enthält', () => {
  const frueh = measuredOffset(periode({ closingMeasuredOn: '2025-12-20', deliveries: [M, O, lieferung({ id: 'd3', date: '2025-12-28', quantity: 1000 })] }))
  assert.deepEqual(frueh, { days: 11, range: { from: '2025-12-21', to: '2025-12-31' }, after: false, deliveries: [{ label: 'Lieferung 2025-12-28', date: '2025-12-28' }] })
  const spaet = measuredOffset(periode({ closingMeasuredOn: '2026-01-05', laterDeliveries: [{ label: 'Lieferung 2026-01-02', date: '2026-01-02' }] }))
  assert.deepEqual(spaet, { days: 5, range: { from: '2026-01-01', to: '2026-01-05' }, after: true, deliveries: [{ label: 'Lieferung 2026-01-02', date: '2026-01-02' }] })
  assert.equal(measuredOffset(periode()), null)
  assert.equal(measuredOffset(periode({ closingMeasuredOn: null })), null)
})

// Fester Startwert: jeder Lauf prüft dieselben Ketten.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invariante (Entwurf 12.3 Nr. 5): Über eine Folge eingefrorener und offener Perioden wird jede Lieferung genau einmal verbraucht', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 200; lauf++) {
    const n = int(1, 4)
    let vorrat = int(0, 3000)
    const start = { quantity: vorrat, costCents: vorrat * int(80, 120), emissionsKg: Math.round(vorrat * 267.6) / 100, co2Cents: int(0, 30000), invoicedBefore2023: rnd() < 0.5 }
    const perioden: StockPeriodInput[] = []
    let rein = { q: start.quantity, cost: start.costCents, kg: start.emissionsKg, co2: start.invoicedBefore2023 ? 0 : start.co2Cents }
    for (let i = 0; i < n; i++) {
      const jahr = 2023 + i
      const deliveries = Array.from({ length: int(0, 2) }, (_, k) => {
        const q = int(500, 4000)
        const d = lieferung({ id: `d${i}-${k}`, date: `${jahr}-0${k + 3}-15`, quantity: q, costCents: q * int(80, 130), emissionsKg: Math.round(q * 267.63) / 100, co2Cents: int(5000, 60000) })
        rein = { q: rein.q + q, cost: rein.cost + (d.costCents ?? 0), kg: rein.kg + (d.emissionsKg ?? 0), co2: rein.co2 + (d.co2Cents ?? 0) }
        return d
      })
      vorrat = vorrat + deliveries.reduce((a, d) => a + (d.quantity ?? 0), 0)
      const ende = int(0, vorrat)
      vorrat = ende
      perioden.push(periode({ key: periodKey(`${jahr}-01`), label: String(jahr), from: `${jahr}-01-01`, to: `${jahr}-12-31`, ownOpening: i === 0 ? start : null, deliveries, closingQuantity: ende }))
    }
    // Jede Periode einzeln rechnen; eine zufällig gewählte davor einfrieren, wie nach einem Abschluss.
    let verbraucht = { q: 0, cost: 0, kg: 0, co2: 0 }
    let letzter: StockValue | null = null
    for (let i = 0; i < n; i++) {
      const kette = perioden.slice(0, i + 1).map((p, k) => (k < i && rnd() < 0.5 && k === i - 1 && letzter ? { ...p, frozenClosing: JSON.parse(JSON.stringify(letzter)) } : p))
      const s = ok(stockOf(kette, OPTS))
      verbraucht = { q: verbraucht.q + s.consumed.quantity, cost: verbraucht.cost + (s.consumed.costCents ?? 0), kg: verbraucht.kg + s.consumed.emissionsKg, co2: verbraucht.co2 + s.consumed.co2Cents }
      letzter = s.closing
    }
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, start })}`
    if (!letzter) assert.fail(fall)
    assert.ok(Math.abs(verbraucht.q + letzter.quantity - rein.q) < 1e-6, `${fall}: Menge`)
    assert.equal(verbraucht.cost + (letzter.costCents ?? 0), rein.cost, `${fall}: Betrag`)
    assert.ok(Math.abs(verbraucht.kg + letzter.emissionsKg - rein.kg) < 0.005 * (n + 1), `${fall}: kg`)
    assert.equal(verbraucht.co2 + letzter.co2Cents, rein.co2, `${fall}: CO₂-Kosten`)
  }
})
```

In `server/test/law-literals.test.ts` die Liste `ENGINE_FILES` um `'server/src/fuelStock.ts'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/fuel-stock.test.ts test/law-literals.test.ts`
Expected: FAIL mit `Cannot find module '…/src/fuelStock.ts'` und „server/src/fuelStock.ts gibt es
nicht; die Liste ist veraltet“.

- [ ] **Step 3: Die gemeinsame Liste (`shared/fuelStock.ts`)**

```ts
// Vorratsenergien (Heizung PR 8, Entwurf 8.2, 14.1): Brennstoffe, die im Tank oder Lager liegen und
// nicht im selben Zeitraum verbraucht werden müssen, in dem sie geliefert werden. Der Server
// (Bestandsrechnung, Sperren) und die Oberfläche (Karte „Vorrat“) lesen dieselbe Liste.
import type { HeatingEnergy, StockUnit } from './types.ts'

export const STOCK_ENERGIES: readonly HeatingEnergy[] = ['oil', 'lpg', 'pellets', 'wood', 'coal']
export const isStockEnergy = (energy: HeatingEnergy): boolean => STOCK_ENERGIES.includes(energy)

// Die Einheit im Satz („2.000 l“) und als Wort in der Auswahl.
export const STOCK_UNIT_TEXT: Record<StockUnit, string> = { l: 'l', kg: 'kg', srm: 'SRm' }
export const STOCK_UNIT_LABELS: Record<StockUnit, string> = { l: 'Liter', kg: 'Kilogramm', srm: 'Schüttraummeter' }
```

`server/src/fuel.ts` (PR 7, Annahme A5): die Zeile `export const STOCK_ENERGIES … = ['oil', 'lpg',
'pellets', 'wood', 'coal']` ersetzen durch (die Liste bleibt dieselbe, nur ihr Ort wechselt)

```ts
// Seit Heizung PR 8 in shared/fuelStock.ts, weil die Oberfläche sie braucht.
export { STOCK_ENERGIES } from '../../shared/fuelStock.ts'
```

- [ ] **Step 4: Die Bestandsrechnung (`server/src/fuelStock.ts`)**

```ts
// Brennstoffvorrat (Heizung PR 8, #97, #99; Entwurf 8.2). Reine Funktionen.
//
// Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle wird nicht jede Lieferung im selben Zeitraum verbraucht.
// Umgelegt werden die Kosten der verbrauchten Brennstoffe (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR
// 156/11), und die CO₂-Aufteilung braucht Ausstoß und CO₂-Kosten des verbrauchten Brennstoffs. Beides
// ergibt die Bestandsrechnung: Anfangsbestand + Lieferungen − Endbestand.
//
// **Bewertung** ([M] Minol, Restbewertung): „Der zuerst gelieferte Brennstoff wird als erstes
// verbraucht“. Der Endbestand besteht also aus den jüngsten Teilen und wird zu deren Preisen, kg und
// CO₂-Kosten bewertet. Jeder Teil wird für sich gerundet, Beträge auf den Cent, kg auf das Hundertstel
// (Abweichung 1 des Plans: Die Zahlen des Entwurfs haben zwei Nachkommastellen).
//
// **Die Kette** (Entwurf 8.2 „Der Anfangsbestand ist vorbelegt aus dem bewerteten Endbestand von
// H−1. Ist H−1 abgeschlossen, gilt der eingefrorene Wert.“): Eingetragen wird ein Anfangsbestand nur
// in der ersten Heizperiode mit Vorrat. Jede weitere übernimmt den Endbestand ihrer Vorperiode, und
// zwar ganz, mit seinen Teilen; ist die Vorperiode abgeschlossen, den eingefrorenen.
//
// **Kein Datum, keine Rechtszahl hier** (law-literals.test.ts). Ob die CO₂-Kosten einer Rechnung
// zählen (§ 11 Abs. 2 Satz 2 CO2KostAufG), fragt der Aufrufer das Register und reicht es herein.
import { germanDate } from '../../shared/law/register.ts'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import type { HeatingStockStatement, PeriodKey, StockLayer, StockUnit, StockValue } from '../../shared/types.ts'
import { compareText } from './calc.ts'

// Eine Lieferung in der Bestandsrechnung. `costCents`: Σ der verknüpften Kostenpositionen, sonst der
// Betrag an der Lieferung, sonst null. `date` ordnet sie der Heizperiode zu (Lieferdatum, Entwurf
// 5.4), `invoiceDate` entscheidet über § 11 Abs. 2 Satz 2.
export type StockDeliveryInput = {
  id: string
  label: string
  date: string
  invoiceDate: string
  quantity: number | null
  quantityUnit: string | null
  costCents: number | null
  emissionsKg: number | null
  co2Cents: number | null
}

// Der eingetragene Anfangsbestand (Spalten `opening_*`).
export type StockOpeningInput = { quantity: number; costCents: number | null; emissionsKg: number | null; co2Cents: number | null; invoicedBefore2023: boolean | null }

// Eine Heizperiode der Kette; snapshot.ts baut sie (`stockChainsOf`).
export type StockPeriodInput = {
  key: PeriodKey
  label: string
  from: string
  to: string
  unit: StockUnit | null
  ownOpening: StockOpeningInput | null
  closingQuantity: number | null
  closingMeasuredOn: string | null
  deliveries: StockDeliveryInput[]
  // Lieferungen der Folgeperiode bis zur Peilung, wenn erst nach dem Ende gepeilt wurde; nur für
  // den Hinweis, gerechnet wird mit ihnen hier nicht.
  laterDeliveries: { label: string; date: string }[]
  // Der eingefrorene Endbestand, wenn diese Heizperiode abgeschlossen ist und ihr Stand ihn kennt.
  frozenClosing: StockValue | null
}

export type StockProblem =
  | { kind: 'missing'; period: string; what: string[] }
  | { kind: 'invalid'; period: string; reasons: string[] }
export type StockResult = { ok: true; statement: HeatingStockStatement } | { ok: false; problem: StockProblem }

// Was die Rechnung verlangt: Beträge nur, wenn nach Verbrauch verteilt wird (freie Schlüssel); kg
// und CO₂-Kosten nur bei Brennstoffen, deren CO₂-Kosten aufzuteilen sind (Heizöl, Flüssiggas).
// `countedAt(Rechnungsdatum)` ist `!law(co2CostsBefore, …)`; die beiden Tage stammen aus denselben
// Fassungen (`co2CostsExcludedUntil`, `co2CostsCountedFrom`).
export type StockOptions = {
  needCost: boolean
  needCo2: boolean
  countedAt: (invoiceDate: string) => boolean
  excludedUntil: string
  countedFrom: string
}

const EPS = 1e-9
const KG_PER_STEP = 100
const DAY_MS = 86400000

export const roundKg = (kg: number): number => Math.round(kg * KG_PER_STEP + EPS) / KG_PER_STEP
const roundCents = (cents: number): number => Math.round(cents + EPS)

export const fmtQuantity = (q: number, unit: StockUnit): string =>
  `${q.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[unit]}`
const unitWord = (u: string | null): string => (u === 'l' || u === 'kg' || u === 'srm' ? STOCK_UNIT_TEXT[u] : u === null || u === '' ? 'keiner Einheit' : u)

const sumCost = (layers: readonly StockLayer[]): number | null =>
  layers.every((l) => l.costCents !== null) ? layers.reduce((a, l) => a + (l.costCents ?? 0), 0) : null
const sumKg = (layers: readonly StockLayer[]): number => layers.reduce((a, l) => a + l.emissionsKg, 0)
const countedCo2 = (layers: readonly StockLayer[]): number => layers.reduce((a, l) => a + (l.co2Counted ? l.co2Cents : 0), 0)

export function valueOf(layers: readonly StockLayer[]): StockValue {
  return {
    quantity: layers.reduce((a, l) => a + l.quantity, 0),
    costCents: sumCost(layers),
    emissionsKg: roundKg(sumKg(layers)),
    co2Cents: countedCo2(layers),
    layers: [...layers],
  }
}

// Der Endbestand aus den jüngsten Teilen, je Teil gerundet. Ein ganzer Teil bleibt, wie er ist.
export function closingOf(layers: readonly StockLayer[], quantity: number): StockLayer[] {
  const out: StockLayer[] = []
  let rest = quantity
  for (let i = layers.length - 1; i >= 0 && rest > EPS; i--) {
    const l = layers[i]
    if (!l || l.quantity <= 0) continue
    const take = Math.min(rest, l.quantity)
    const f = take / l.quantity
    out.unshift(f >= 1 - EPS
      ? { ...l }
      : {
        ...l,
        quantity: take,
        costCents: l.costCents === null ? null : roundCents(l.costCents * f),
        emissionsKg: roundKg(l.emissionsKg * f),
        co2Cents: roundCents(l.co2Cents * f),
      })
    rest -= take
  }
  return out
}

// Der eingetragene Anfangsbestand als bewerteter Bestand, oder was dafür fehlt.
function openingValue(o: StockOpeningInput, opts: StockOptions): StockValue | string[] {
  const missing: string[] = []
  if (opts.needCost && o.costCents === null) missing.push('der Wert des Anfangsbestands')
  if (opts.needCo2 && o.emissionsKg === null) missing.push('der CO₂-Ausstoß des Anfangsbestands in kg')
  if (opts.needCo2 && o.invoicedBefore2023 === null) missing.push(`ob der Anfangsbestand vor dem ${germanDate(opts.countedFrom)} in Rechnung gestellt wurde`)
  if (opts.needCo2 && o.invoicedBefore2023 === false && o.co2Cents === null) missing.push('die CO₂-Kosten des Anfangsbestands')
  if (missing.length > 0) return missing
  const counted = opts.needCo2 ? opts.countedAt(o.invoicedBefore2023 ? opts.excludedUntil : opts.countedFrom) : true
  return valueOf([{ label: 'Anfangsbestand', date: null, quantity: o.quantity, costCents: o.costCents, emissionsKg: o.emissionsKg ?? 0, co2Cents: o.co2Cents ?? 0, co2Counted: counted }])
}

type Balance = Omit<HeatingStockStatement, 'openingSource'>

function balance(p: StockPeriodInput, unit: StockUnit, closingQuantity: number, opening: StockValue, opts: StockOptions): { ok: true; balance: Balance } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  const sorted = [...p.deliveries].sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id))
  for (const d of sorted) {
    const name = `„${d.label}“`
    if (d.quantityUnit !== unit) reasons.push(`die Lieferung ${name} ist in ${unitWord(d.quantityUnit)} erfasst, der Vorrat in ${STOCK_UNIT_TEXT[unit]}`)
    if (d.quantity === null || !(d.quantity > 0)) reasons.push(`die Lieferung ${name} hat keine Menge`)
    if (opts.needCost && d.costCents === null) reasons.push(`die Lieferung ${name} hat keinen Betrag; verknüpfen Sie ihre Rechnung oder tragen Sie den Betrag an der Lieferung ein`)
    if (opts.needCo2 && (d.emissionsKg === null || d.co2Cents === null)) reasons.push(`bei der Lieferung ${name} fehlen der CO₂-Ausstoß in kg oder die CO₂-Kosten laut Rechnung`)
  }
  const total = opening.quantity + sorted.reduce((a, d) => a + (d.quantity ?? 0), 0)
  if (closingQuantity > total + EPS) {
    reasons.push(`der Endbestand von ${fmtQuantity(closingQuantity, unit)} ist größer als Anfangsbestand und Lieferungen zusammen (${fmtQuantity(total, unit)})`)
  }
  if (reasons.length > 0) return { ok: false, reasons }
  const deliveries: StockLayer[] = sorted.map((d) => ({
    label: d.label,
    date: d.date,
    quantity: d.quantity ?? 0,
    costCents: d.costCents,
    emissionsKg: d.emissionsKg ?? 0,
    co2Cents: d.co2Cents ?? 0,
    co2Counted: opts.needCo2 ? opts.countedAt(d.invoiceDate) : true,
  }))
  const all = [...opening.layers, ...deliveries]
  const closing = valueOf(closingOf(all, closingQuantity))
  const inCost = sumCost(all)
  const oldIn = sumKg(all.filter((l) => !l.co2Counted))
  const oldOut = sumKg(closing.layers.filter((l) => !l.co2Counted))
  return {
    ok: true,
    balance: {
      unit,
      opening,
      deliveries,
      closing,
      closingMeasuredOn: p.closingMeasuredOn,
      consumed: {
        quantity: total - closingQuantity,
        costCents: inCost === null || closing.costCents === null ? null : inCost - closing.costCents,
        emissionsKg: roundKg(sumKg(all) - closing.emissionsKg),
        co2Cents: countedCo2(all) - closing.co2Cents,
      },
      paidCents: sumCost(deliveries),
      oldStockKg: roundKg(oldIn - oldOut),
    },
  }
}

// Die Bestandsrechnung der letzten Heizperiode der Kette (älteste zuerst). Jede Periode davor ist
// entweder eingefroren (ihr Endbestand gilt, wie er beim Abschluss war) oder wird gerechnet.
export function stockOf(chain: readonly StockPeriodInput[], opts: StockOptions): StockResult {
  const last = chain.length - 1
  let opening: StockValue | null = null
  let source: HeatingStockStatement['openingSource'] = 'own'
  let previousUnit: StockUnit | null = null
  for (let i = 0; i <= last; i++) {
    const p = chain[i]
    if (!p) break
    if (i < last && p.frozenClosing) {
      opening = p.frozenClosing
      source = 'frozen'
      previousUnit = p.unit
      continue
    }
    const missing: string[] = []
    if (p.unit === null) missing.push('die Einheit des Vorrats')
    let open: StockValue | null = opening
    if (open === null) {
      if (!p.ownOpening) missing.push('der Anfangsbestand')
      else {
        const v = openingValue(p.ownOpening, opts)
        if (Array.isArray(v)) missing.push(...v)
        else open = v
      }
    }
    if (p.closingQuantity === null) missing.push('der Endbestand')
    if (missing.length > 0 || open === null || p.unit === null || p.closingQuantity === null) {
      return { ok: false, problem: { kind: 'missing', period: p.label, what: missing } }
    }
    if (opening !== null && previousUnit !== null && previousUnit !== p.unit) {
      return { ok: false, problem: { kind: 'invalid', period: p.label, reasons: [`der Vorrat der Vorperiode ist in ${STOCK_UNIT_TEXT[previousUnit]} geführt, dieser in ${STOCK_UNIT_TEXT[p.unit]}`] } }
    }
    const r = balance(p, p.unit, p.closingQuantity, open, opts)
    if (!r.ok) return { ok: false, problem: { kind: 'invalid', period: p.label, reasons: r.reasons } }
    if (i === last) return { ok: true, statement: { ...r.balance, openingSource: i === 0 ? 'own' : source } }
    opening = r.balance.closing
    source = 'previous'
    previousUnit = p.unit
  }
  return { ok: false, problem: { kind: 'missing', period: '', what: ['der Anfangsbestand'] } }
}

// Was fehlt oder nicht passt, als ein Satz.
export function problemText(problem: StockProblem): string {
  const where = problem.period ? ` (Heizperiode ${problem.period})` : ''
  const list = problem.kind === 'missing' ? problem.what : problem.reasons
  const joined = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} und ${list.at(-1) ?? ''}`
  return problem.kind === 'missing'
    ? `Für die Bestandsrechnung${where} fehlt: ${joined}.`
    : `Die Bestandsrechnung${where} geht nicht auf: ${joined}.`
}

const nextDay = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
const daysFromTo = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1

// Wurde nicht am letzten Tag der Heizperiode gepeilt, gilt der Wert wie gepeilt (Entwurf 8.2, wie
// 3.5). Für den Hinweis: die Tage dazwischen und die Lieferungen, die die Peilung nicht enthält
// (gepeilt vor dem Ende) bzw. schon enthält (gepeilt danach). `null`: am Ende oder ohne Tag gepeilt.
export function measuredOffset(p: StockPeriodInput): { days: number; range: { from: string; to: string }; after: boolean; deliveries: { label: string; date: string }[] } | null {
  const d = p.closingMeasuredOn
  if (d === null || d === p.to) return null
  const after = d > p.to
  const range = after ? { from: nextDay(p.to), to: d } : { from: nextDay(d), to: p.to }
  const deliveries = after ? p.laterDeliveries : p.deliveries.filter((x) => x.date > d).map((x) => ({ label: x.label, date: x.date }))
  return { days: daysFromTo(range.from, range.to), range, after, deliveries }
}

// ---------- Eingefrorener Endbestand (G-A4) ----------

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function layerOf(v: unknown): StockLayer | null {
  if (v === null || typeof v !== 'object') return null
  const label: unknown = Reflect.get(v, 'label')
  const date: unknown = Reflect.get(v, 'date')
  const quantity: unknown = Reflect.get(v, 'quantity')
  const costCents: unknown = Reflect.get(v, 'costCents')
  const emissionsKg: unknown = Reflect.get(v, 'emissionsKg')
  const co2Cents: unknown = Reflect.get(v, 'co2Cents')
  const co2Counted: unknown = Reflect.get(v, 'co2Counted')
  if (typeof label !== 'string' || !(date === null || typeof date === 'string') || !isNumber(quantity) || !(costCents === null || isNumber(costCents))) return null
  if (!isNumber(emissionsKg) || !isNumber(co2Cents) || typeof co2Counted !== 'boolean') return null
  return { label, date, quantity, costCents, emissionsKg, co2Cents, co2Counted }
}

// Ein Endbestand aus einem abgeschlossenen Stand. Gelesen werden die Teile; die Summen rechnet
// `valueOf` daraus neu, damit ein von Hand bearbeitetes Archivstück nicht in sich widersprüchlich
// gelesen wird. Ist ein Teil krumm, gibt es keinen eingefrorenen Endbestand.
export function readFrozenStock(value: unknown): StockValue | null {
  if (value === null || typeof value !== 'object') return null
  const layers: unknown = Reflect.get(value, 'layers')
  if (!Array.isArray(layers)) return null
  const read = layers.flatMap((x: unknown) => {
    const l = layerOf(x)
    return l ? [l] : []
  })
  return read.length === layers.length ? valueOf(read) : null
}
```

`compareText` steht in calc.ts, und calc.ts importiert diese Datei; der gegenseitige Import ist
unschädlich, weil keine der beiden Dateien beim Laden eine Funktion der anderen aufruft (CLAUDE.md:
„nimmt `compareText` von hier und schreibt den Vergleich nicht noch einmal hin“).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/fuel-stock.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (`fuel-stock.test.ts`: 9 Tests).

- [ ] **Step 6: Commit**

```bash
git add shared/fuelStock.ts server/src/fuelStock.ts server/src/fuel.ts server/test/fuel-stock.test.ts server/test/law-literals.test.ts
git commit -m "Vorrat: Bestandsrechnung mit Bewertung nach Minol, Altbestand vor 2023 und Kette

Verbraucht wird das Älteste zuerst, der Endbestand ist zu den jüngsten Lieferungen bewertet, je Teil
gerundet. Ein eingefrorener Endbestand der Vorperiode gilt, wie er war.

Refs #97, #99"
```

---
### Task 4: Schnappschuss: die Kette des Vorrats und der eingefrorene Endbestand

Der Schnappschuss reicht je Anlage mit Vorratsenergie und Heizperiode dieser Berechnung die Kette
der Heizperioden herein (Entwurf 5.8: „die `heating_periods`-Zeilen dieser H und der Vorperiode
(Vorbelegung des Bestands)“, hier bis zur letzten eingefrorenen). Der eingefrorene Endbestand steht im
abgeschlossenen Stand unter `heating[].stock.closing` und wird wie Eigenanteil und Vorauszahlung von
`frozenSettlementOf` gelesen; so hebt ein Wiederöffnen ihn ohne Zutun auf (Review Focus 3).

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/db/read.ts`
- Test: `server/test/snapshot-vorrat.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2, 3; PR 2, PR 5, PR 6, A1, A4): `StockPeriodInput`, `readFrozenStock`, `isStockEnergy`, `StockValue`; `frozenSettlementOf`, `SnapshotClosedSettlement`, `SnapshotCostItem`, `SnapshotHeatingPlant`, `SnapshotHeatingPeriodRow`, `SnapshotFuelDelivery`, `wayOf`, `narrowToProperty`; `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`, `hasOwnRhythm`; `periodContaining`, `previousPeriod`, `periodLabel`, `rulesOf`; `germanDate`.
- Produces:
  - `SnapshotClosedSettlement.stockClosings?: Record<string, StockValue> | null` (Schlüssel `Anlage:Heizperiode`); `frozenSettlementOf` liefert `stockClosings`; `StoredClosedSettlement.stockClosings`
  - `type SnapshotStockChain = { plantId: string; period: PeriodKey; chain: StockPeriodInput[] }`
  - `stockChainsOf(source: StockChainSource, plant: SnapshotHeatingPlant, objectRules: PeriodRules, hs: readonly BillingPeriod[]): SnapshotStockChain[]`
  - `Snapshot.stockChains?: SnapshotStockChain[]`, gefüllt von `snapshotFor` und `heatingSnapshotFor`

- [ ] **Step 1: Write the failing tests**

`server/test/snapshot-vorrat.test.ts`:

```ts
// Die Kette des Vorrats im Schnappschuss (Heizung PR 8, Entwurf 5.8, 8.2, G-A4): Vorperioden mit
// Endbestand, der eingefrorene Endbestand einer abgeschlossenen, Lieferungen nach Lieferdatum, Beträge
// aus verknüpften Positionen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frozenSettlementOf, stockChainsOf, type SnapshotCostItem, type SnapshotFuelDelivery, type SnapshotHeatingPeriodRow, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey } from '../../shared/period.ts'
import type { StockValue } from '../../shared/types.ts'

const OEL: SnapshotHeatingPlant = {
  id: 'hp', name: 'Öl', energy: 'oil', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null,
}
// Eine Zeile der Heizperiode mit den Feldern des Vorrats (die übrigen Felder braucht die Kette nicht).
const zeile = (period: string, over: Partial<SnapshotHeatingPeriodRow> = {}): SnapshotHeatingPeriodRow => ({
  plantId: 'hp', period: periodKey(period), dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: null, openingCostCents: null,
  openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, closingQuantity: null, closingMeasuredOn: null, ...over,
})
// Eine Lieferung mit den Feldern des Entwurfs 5.4 (Annahme A1); fehlt PR 7 ein Feld, ergänzt der
// Übersetzer es hier mit null.
const lieferung = (id: string, deliveredAt: string, over: Partial<SnapshotFuelDelivery> = {}): SnapshotFuelDelivery => ({
  id, plantId: 'hp', amountCents: null, label: '', invoiceDate: deliveredAt, deliveredAt, invoiceFrom: null, invoiceTo: null, unitId: null,
  quantity: 1000, quantityUnit: 'l', energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: 2676.3, co2CostCents: 17500,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (id: string, period: string, amountCents: number, fuelDeliveryId: string): SnapshotCostItem => ({
  id, period: periodKey(period), category: HEATING_CATEGORY, description: id, amountCents, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId,
})
const P2025 = calendarPeriod(2025)
const leer = { costItems: [] as SnapshotCostItem[], closedSettlements: [] }

test('Kette: die Heizperiode und davor jede mit Endbestand; die erste mit eingetragenem Anfangsbestand', () => {
  const [kette] = stockChainsOf({
    ...leer,
    heatingPeriodRows: [
      zeile('2023-01', { openingQuantity: 500, openingCostCents: 50000, closingQuantity: 1200 }),
      zeile('2024-01', { closingQuantity: 800 }),
      zeile('2025-01', { closingQuantity: 300 }),
    ],
    fuelDeliveries: [lieferung('a', '2024-02-10'), lieferung('b', '2025-11-03'), lieferung('c', '2026-01-04')],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain.map((p) => [p.key, p.closingQuantity, p.deliveries.map((d) => d.id)]), [['2023-01', 1200, []], ['2024-01', 800, ['a']], ['2025-01', 300, ['b']]])
  assert.equal(kette?.chain[0]?.ownOpening?.quantity, 500)
  assert.equal(kette?.chain[2]?.deliveries[0]?.label, 'Lieferung vom 03.11.2025')
  // Eine Vorperiode ohne Endbestand beendet die Kette; dann zählt der eigene Anfangsbestand.
  const [kurz] = stockChainsOf({ ...leer, heatingPeriodRows: [zeile('2024-01'), zeile('2025-01', { openingQuantity: 800, closingQuantity: 300 })] }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kurz?.chain.map((p) => p.key), ['2025-01'])
})

test('Betrag einer Lieferung: Σ der verknüpften Positionen, sonst der an der Lieferung; geschätzte fallen weg', () => {
  const [kette] = stockChainsOf({
    costItems: [position('r1', '2025-01', 120000, 'b'), position('r2', '2025-01', -5000, 'b')],
    closedSettlements: [],
    heatingPeriodRows: [zeile('2025-01', { openingQuantity: 0, closingQuantity: 0 })],
    fuelDeliveries: [lieferung('b', '2025-03-01', { amountCents: 999 }), lieferung('m', '2025-04-01', { amountCents: 70000 }), lieferung('s', '2025-05-01', { estimated: true })],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain[0]?.deliveries.map((d) => [d.id, d.costCents]), [['b', 115000], ['m', 70000]])
})

test('Eingefroren (G-A4): Der Endbestand einer abgeschlossenen Vorperiode steht im Stand und beendet die Kette; wieder geöffnet zählt der lebende', () => {
  const closing: StockValue = { quantity: 800, costCents: 80000, emissionsKg: 2141.04, co2Cents: 14000, layers: [{ label: 'Lieferung vom 10.02.2024', date: '2024-02-10', quantity: 800, costCents: 80000, emissionsKg: 2141.04, co2Cents: 14000, co2Counted: true }] }
  const stand = { heating: [{ plantId: 'hp', period: '2024-01', energy: 'oil', stock: { closing } }] }
  const frozen = frozenSettlementOf(stand)
  assert.deepEqual(frozen.stockClosings, { 'hp:2024-01': closing })
  assert.equal(frozenSettlementOf({}).stockClosings, null)
  const quelle = {
    ...leer,
    heatingPeriodRows: [zeile('2023-01', { openingQuantity: 500, openingCostCents: 50000, closingQuantity: 1200 }), zeile('2024-01', { closingQuantity: 700 }), zeile('2025-01', { closingQuantity: 300 })],
  }
  const [zu] = stockChainsOf({ ...quelle, closedSettlements: [{ ...frozen, period: periodKey('2024-01') }] }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(zu?.chain.map((p) => p.key), ['2024-01', '2025-01'])
  assert.deepEqual(zu?.chain[0]?.frozenClosing, closing)
  // Wieder geöffnet: Der Stand ist weg, die Kette reicht bis zum eingetragenen Anfangsbestand, und
  // der Endbestand von 2024 ist der eingetragene (700 l), nicht der eingefrorene (800 l).
  const [offen] = stockChainsOf(quelle, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(offen?.chain.map((p) => [p.key, p.frozenClosing === null, p.closingQuantity]), [['2023-01', true, 1200], ['2024-01', true, 700], ['2025-01', true, 300]])
})

test('Peilung nach dem Ende: die Lieferungen der Folgeperiode bis zur Peilung stehen dabei', () => {
  const [kette] = stockChainsOf({
    ...leer,
    heatingPeriodRows: [zeile('2025-01', { openingQuantity: 500, closingQuantity: 300, closingMeasuredOn: '2026-01-05' })],
    fuelDeliveries: [lieferung('spaet', '2026-01-02'), lieferung('noch-spaeter', '2026-01-09')],
  }, OEL, CALENDAR_RULES, [P2025])
  assert.deepEqual(kette?.chain[0]?.laterDeliveries, [{ label: 'Lieferung vom 02.01.2026', date: '2026-01-02' }])
})

test('Ohne Vorratsenergie gibt es keine Kette', () => {
  assert.deepEqual(stockChainsOf({ ...leer, heatingPeriodRows: [zeile('2025-01', { closingQuantity: 1 })] }, { ...OEL, energy: 'gas' }, CALENDAR_RULES, [P2025]), [])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/snapshot-vorrat.test.ts`
Expected: FAIL mit `The requested module '../src/snapshot.ts' does not provide an export named
'stockChainsOf'`.

- [ ] **Step 3: Der eingefrorene Endbestand (`server/src/snapshot.ts`, `server/src/db/read.ts`)**

In snapshot.ts importieren: `import { readFrozenStock, type StockPeriodInput } from './fuelStock.ts'`,
`import { isStockEnergy } from '../../shared/fuelStock.ts'`, `germanDate` aus
`'../../shared/law/register.ts'`, `StockValue` in den Typimport aus `'../../shared/types.ts'`.

`SnapshotHeatingPeriodRow` (PR 6) ersetzen, damit die Kette die Spalten des Vorrats liest:

```ts
// Die Angaben je Heizperiode, die die Berechnung liest: Warmwasser laut Messdienst (Heizung PR 6) und
// der Vorrat (Heizung PR 8).
export type SnapshotHeatingPeriodRow = Pick<
  HeatingPeriodData,
  | 'plantId' | 'period' | 'dhwMethod' | 'dhwUnmeasurable' | 'stockUnit' | 'openingQuantity' | 'openingCostCents' | 'openingEmissionsKg'
  | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'closingQuantity' | 'closingMeasuredOn'
>
```

`readHeatingPeriodRows` (PR 6) liest ganze Zeilen und erfüllt den Typ ohne Änderung. Tests aus PR 6,
die eine `SnapshotHeatingPeriodRow` als Literal bauen (`calc-co2.test.ts`, „Warmwasser beim
Messdienst“), bekommen die acht Felder mit `null`; der Übersetzer nennt sie.

`SnapshotClosedSettlement` bekommt als letztes Feld:

```ts
  // Die eingefrorenen Endbestände des Vorrats (Heizung PR 8, G-A4), je `Anlage:Heizperiode`. Die
  // Folgeperiode liest daraus ihren Anfangsbestand. `null` oder fehlend: Der Stand kennt keinen.
  stockClosings?: Record<string, StockValue> | null
```

Über `frozenSettlementOf`:

```ts
// Die Endbestände des Vorrats aus `heating` eines Stands (Heizung PR 8). Ein Eintrag, der sich nicht
// lesen lässt, fehlt; dann gilt in der Folgeperiode der eingetragene Anfangsbestand.
function stockClosingsOf(heating: unknown): Record<string, StockValue> | null {
  if (!Array.isArray(heating)) return null
  const out: Record<string, StockValue> = {}
  for (const h of heating) {
    if (h === null || typeof h !== 'object') continue
    const plantId: unknown = Reflect.get(h, 'plantId')
    const period: unknown = Reflect.get(h, 'period')
    const stock: unknown = Reflect.get(h, 'stock')
    if (typeof plantId !== 'string' || typeof period !== 'string' || stock === null || typeof stock !== 'object') continue
    const closing = readFrozenStock(Reflect.get(stock, 'closing'))
    if (closing) out[`${plantId}:${period}`] = closing
  }
  return Object.keys(out).length > 0 ? out : null
}
```

In `frozenSettlementOf`: im Rückgabetyp `& { … }` um `stockClosings: Record<string, StockValue> |
null` ergänzen, in `leer` `stockClosings: null` und in `auszug` hinter `itemTotals: …`:

```ts
    stockClosings: stockClosingsOf(Reflect.get(settlement, 'heating')),
```

`server/src/db/read.ts`: `StoredClosedSettlement` bekommt hinter `itemTotals`:

```ts
  // Eingefrorene Endbestände des Vorrats (Heizung PR 8), ebenfalls aus `frozenSettlementOf`
  stockClosings: Record<string, StockValue> | null
```

(`StockValue` in den Typimport aus `'../../../shared/types.ts'`.) `StoredClosedHeatingSettlement`
(PR 5) leitet sich davon ab und bekommt das Feld mit.

- [ ] **Step 4: Die Kette (`server/src/snapshot.ts`)**

Hinter `heatingSnapshotFor` (PR 5) bzw. am Dateiende:

```ts
// ---------- Brennstoffvorrat (Heizung PR 8, Entwurf 5.8, 8.2) ----------

// Je Anlage mit Vorratsenergie und Heizperiode dieser Berechnung die Kette der Heizperioden für die
// Bestandsrechnung (fuelStock.ts): die Heizperiode selbst und davor jede Vorperiode mit eingetragenem
// Endbestand, bis zur ersten, deren Endbestand eingefroren ist. Lieferungen gehören zur Heizperiode
// ihres Lieferdatums (Entwurf 5.4); geschätzte Lieferungen (PR 7) gibt es beim Vorrat nicht. Der Betrag
// einer Lieferung ist Σ ihrer Positionen, über alle Zeiträume, sonst der an der Lieferung (5.4).
export type SnapshotStockChain = { plantId: string; period: PeriodKey; chain: StockPeriodInput[] }

export type StockChainSource = {
  costItems: readonly SnapshotCostItem[]
  closedSettlements: readonly (SnapshotClosedSettlement & { period: PeriodKey })[]
  closedHeatingSettlements?: readonly (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
  heatingPeriodRows?: readonly SnapshotHeatingPeriodRow[]
  fuelDeliveries?: readonly SnapshotFuelDelivery[]
}

// Mehr Vorperioden liest niemand; eine längere Kette ohne eingefrorenen Endbestand gibt es nur bei
// einem Bestand, der hundert Heizperioden nie abgeschlossen hat.
const STOCK_CHAIN_LIMIT = 100

export function stockChainsOf(source: StockChainSource, plant: SnapshotHeatingPlant, objectRules: PeriodRules, hs: readonly BillingPeriod[]): SnapshotStockChain[] {
  if (!isStockEnergy(plant.energy)) return []
  const way = wayOf(plant)
  const rules = plantRules(way, objectRules)
  const rows = new Map((source.heatingPeriodRows ?? []).filter((r) => r.plantId === plant.id).map((r) => [String(r.period), r]))
  const deliveries = (source.fuelDeliveries ?? []).filter((d) => d.plantId === plant.id && !d.estimated)
  const linked = new Map<string, number>()
  for (const c of source.costItems) {
    if (c.fuelDeliveryId) linked.set(c.fuelDeliveryId, (linked.get(c.fuelDeliveryId) ?? 0) + c.amountCents)
  }
  const dateOf = (d: SnapshotFuelDelivery): string | null => d.deliveredAt ?? d.invoiceDate
  const labelOf = (d: SnapshotFuelDelivery, date: string): string => d.label || `Lieferung vom ${germanDate(date)}`
  const frozenOf = (p: BillingPeriod): StockValue | null => {
    const key = `${plant.id}:${p.key}`
    if (settledSeparately(way, objectRules, p)) {
      return source.closedHeatingSettlements?.find((c) => c.plantId === plant.id && c.period === p.key)?.stockClosings?.[key] ?? null
    }
    const owner = periodContaining(objectRules, p.to)
    return source.closedSettlements.find((c) => c.period === owner.key)?.stockClosings?.[key] ?? null
  }
  const inputOf = (p: BillingPeriod): StockPeriodInput => {
    const row = rows.get(p.key)
    const measured = row?.closingMeasuredOn ?? null
    return {
      key: p.key,
      label: periodLabel(p),
      from: p.from,
      to: p.to,
      unit: row?.stockUnit ?? null,
      ownOpening: row && row.openingQuantity !== null
        ? { quantity: row.openingQuantity, costCents: row.openingCostCents, emissionsKg: row.openingEmissionsKg, co2Cents: row.openingCo2Cents, invoicedBefore2023: row.openingInvoicedBefore2023 }
        : null,
      closingQuantity: row?.closingQuantity ?? null,
      closingMeasuredOn: measured,
      deliveries: deliveries.flatMap((d) => {
        const date = dateOf(d)
        if (date === null || date < p.from || date > p.to) return []
        return [{
          id: d.id, label: labelOf(d, date), date, invoiceDate: d.invoiceDate ?? date, quantity: d.quantity, quantityUnit: d.quantityUnit,
          costCents: linked.get(d.id) ?? d.amountCents, emissionsKg: d.emissionsKg, co2Cents: d.co2CostCents,
        }]
      }),
      laterDeliveries: measured !== null && measured > p.to
        ? deliveries.flatMap((d) => {
          const date = dateOf(d)
          return date !== null && date > p.to && date <= measured ? [{ label: labelOf(d, date), date }] : []
        })
        : [],
      frozenClosing: frozenOf(p),
    }
  }
  return hs.map((h) => {
    const chain = [inputOf(h)]
    let cur = h
    for (let i = 0; i < STOCK_CHAIN_LIMIT; i++) {
      const prev = previousPeriod(rules, cur)
      const input = inputOf(prev)
      if (!input.frozenClosing && input.closingQuantity === null) break
      chain.unshift(input)
      if (input.frozenClosing) break
      cur = prev
    }
    return { plantId: plant.id, period: h.key, chain }
  })
}
```

Die Vergleiche `date < p.from` sind Vergleiche von ISO-Daten Zeichen für Zeichen, wie `compareText`.

In `Snapshot` hinter `heatingPeriodRows?` (PR 6):

```ts
  // Je Anlage mit Vorratsenergie und Heizperiode dieser Berechnung die Kette für die
  // Bestandsrechnung (Heizung PR 8). Fehlt sie, gibt es keinen Vorrat.
  stockChains?: SnapshotStockChain[]
```

`snapshotFor`: Fehlt `closedHeatingSettlements?` noch im Typ seines ersten Parameters (PR 5 nahm es
in `SnapshotSource` auf), dort ergänzen:
`closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string, period: PeriodKey })[]`.
Im Rumpf vor dem `return`:

```ts
  // Brennstoffvorrat (Heizung PR 8): je Anlage mit Vorratsenergie die Kette ihrer Heizperioden in P.
  // Eine Anlage mit eigener Heizperiode rechnet in jeder Heizperiode, die in P endet.
  const stockSource: StockChainSource = {
    costItems: narrowed.costItems,
    closedSettlements: narrowed.closedSettlements,
    closedHeatingSettlements: source.closedHeatingSettlements,
    heatingPeriodRows: source.heatingPeriodRows,
    fuelDeliveries: source.fuelDeliveries,
  }
  const stockChains = plants.flatMap((p) =>
    stockChainsOf(stockSource, p, objectRules, hasOwnRhythm(wayOf(p)) ? heatingPeriodsEndingIn(plantRules(wayOf(p), objectRules), period) : [period]))
```

und im zurückgegebenen Objekt hinter den Feldern von PR 6:

```ts
    ...(stockChains.length > 0 ? { stockChains } : {}),
```

`heatingSnapshotFor` (PR 5): vor dem `return` des Schnappschusses

```ts
  // Heizung PR 8: die Kette des Vorrats für diese eine Heizperiode.
  const stockPlant = (source.heatingPlants ?? []).find((p) => p.id === plantId)
  const stockScoped = narrowToProperty(source, propertyId)
  const stockChains = stockPlant
    ? stockChainsOf({
      costItems: stockScoped.costItems,
      closedSettlements: stockScoped.closedSettlements,
      closedHeatingSettlements: source.closedHeatingSettlements,
      heatingPeriodRows: source.heatingPeriodRows,
      fuelDeliveries: source.fuelDeliveries,
    }, stockPlant, rulesOf(source.properties?.find((p) => p.id === propertyId)), [h])
    : []
```

und im zurückgegebenen Objekt `...(stockChains.length > 0 ? { stockChains } : {}),`. Die
Teilabrechnung nach Weg b (`scope: 'heatingPart'`) baut ihren Schnappschuss mit `...snapshot` aus
dem von P und bekommt die Ketten damit von selbst.

`hasOwnRhythm`, `heatingPeriodsEndingIn`, `plantRules`, `settledSeparately` aus
`'../../shared/heatingPeriod.ts'` und `periodContaining`, `previousPeriod`, `periodLabel` aus
`'../../shared/period.ts'` importiert snapshot.ts seit PR 5 zum Teil schon; fehlende ergänzen.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/snapshot-vorrat.test.ts test/calc.test.ts test/settlement-golden.test.ts test/db-golden.test.ts test/db-changeover.test.ts && npm run typecheck`
Expected: PASS (`snapshot-vorrat.test.ts`: 5 Tests). Golden unverändert: Ohne Anlage mit
Vorratsenergie entsteht kein Feld `stockChains`, und `frozenSettlementOf` liefert für jeden
bisherigen Stand `stockClosings: null`. Vergleicht ein Test des Umstiegs oder der Regression den
Auszug von `frozenSettlementOf` wörtlich, bekommt er `stockClosings: null` in seine Erwartung.

- [ ] **Step 6: Commit**

```bash
git add server/src/snapshot.ts server/src/db/read.ts server/test/snapshot-vorrat.test.ts server/test
git commit -m "Vorrat im Schnappschuss: Kette der Heizperioden und eingefrorener Endbestand

Der Endbestand einer abgeschlossenen Heizperiode steht im abgeschlossenen Stand und gilt für die
Folgeperiode; nach dem Wiederöffnen zählt wieder der lebende.

Refs #97, #99"
```

---
### Task 5: Vorrat speichern und lesen, Lieferungen von Vorratsenergien, Routen

Der Vorrat einer Heizperiode wird in ihrer Zeile gespeichert (`ensureHeatingPeriod`, PR 6). Die
Karte „Vorrat“ lädt mit den Heizperioden eine Ansicht: was eingetragen ist, den Anfangsbestand aus
der Vorperiode, die Bestandsrechnung und was fehlt. Dazu werden Lieferungen von Heizöl, Flüssiggas,
Pellets, Holz und Kohle angenommen (Sperre aus PR 7 aufgehoben), mit Lieferdatum und Menge in der Einheit
des Vorrats.

Damit `db/co2.ts` (Ansicht) und `db/fuelStock.ts` (Vorrat) dieselben Helfer nutzen, ohne sich
gegenseitig zu importieren, ziehen die Helfer der Heizperioden in eine eigene Datei.

**Files:**
- Create: `server/src/db/heatingPeriodContext.ts`, `server/src/db/fuelStock.ts`
- Modify: `server/src/db/co2.ts`, `server/src/db/fuel.ts` (PR 7), `server/src/index.ts`
- Test: `server/test/db-vorrat.test.ts` (neu), `server/test/api.test.ts`, der Test von PR 7, der die Sperre der Vorratsenergien prüft

**Interfaces:**
- Consumes (Task 2–4; PR 6, PR 7): `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`, `PlantContext` (bisher modulintern in db/co2.ts); `readStock`; `stockChainsOf`; `stockOf`, `problemText`, `StockOptions`; `isStockEnergy`, `STOCK_ENERGIES`; `CO2_FUELS`; `co2CostsBefore`, `co2CostsExcludedUntil`, `co2CostsCountedFrom`, `valueAt`; `has`, `raw`, `HeatingError`, `ISO_DATE`; `heatingPeriods`; A6 `guardFuelDelivery`.
- Produces:
  - `server/src/db/heatingPeriodContext.ts`: `type PlantContext`, `plantContext(db, plantId)`, `heatingPeriodOf(ctx, text)`, `heatingPeriodClosed(db, ctx, h)`, `ensureHeatingPeriod(db, plantId, key)`, `closedText(h)` (unverändert umgezogen)
  - `server/src/db/fuelStock.ts`: `stockOptionsFor(plant: Pick<HeatingPlant, 'energy' | 'method'>): StockOptions`, `stockViewFor(stock: Stock, ctx: PlantContext, h: BillingPeriod): StockView`, `saveStock(db, plantId, period, body): Promise<StockView | null>`, `removeStock(db, plantId, period): Promise<boolean | null>`
  - `heatingPeriodViews` füllt `stock` für Anlagen mit Vorratsenergie
  - Routen `PUT /api/heating-plants/:id/periods/:period/stock` → `StockView`, `DELETE …/stock` → `{ ok: true; removed: boolean }`

- [ ] **Step 1: Write the failing tests**

`server/test/db-vorrat.test.ts`:

```ts
// Der Vorrat je Heizperiode in der Datenbank (Heizung PR 8, Entwurf 5.3, 8.2, G-A4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { removeStock, saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, HeatingError, reopenSettlement } from '../src/db/repository.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorrat-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const heatingError = (status: 400 | 409, text: RegExp) => (err: unknown) => err instanceof HeatingError && err.status === status && text.test(err.message)

// Ein Haus mit einer Ölheizung, die Heizkosten nach Fläche verteilt.
async function oelhaus(opened: Opened, energy: 'oil' | 'gas' = 'oil'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 100, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
  })
}
const anfang = { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' }

test('Vorrat: erste Heizperiode mit Anfangsbestand; die Folgeperiode übernimmt den Endbestand und nimmt keinen eigenen', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const erste = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    assert.equal(erste.row.openingQuantity, 2000)
    assert.equal(erste.derived, null)
    assert.equal(erste.statement?.consumed.quantity, 200)
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2026-01', { openingQuantity: 1800 })), heatingError(400, /ergibt sich aus dem Endbestand der Heizperiode 2025/))
    const zweite = await opened.write((db) => saveStock(db, 'hp', '2026-01', { stockUnit: 'l', closingQuantity: 900 })) ?? assert.fail('keine Anlage')
    assert.deepEqual([zweite.derived?.label, zweite.derived?.frozen, zweite.derived?.value.costCents], ['2025', false, 171000])
    assert.equal(zweite.statement?.openingSource, 'previous')
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.equal(ansicht?.stock?.statement?.consumed.quantity, 900)
  })
})

test('Vorrat: ungültige Angaben, keine Vorratsenergie, je mit Satz', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const speichern = (body: unknown) => opened.write((db) => saveStock(db, 'hp', '2025-01', body))
    await assert.rejects(speichern({ ...anfang, openingQuantity: -1 }), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern({ ...anfang, openingCostCents: 1.5 }), heatingError(400, /ganze Cent/))
    await assert.rejects(speichern({ ...anfang, closingQuantity: 'viel' }), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern({ ...anfang, stockUnit: 'm3' }), heatingError(400, /Liter, Kilogramm oder Schüttraummeter/))
    await assert.rejects(speichern({ ...anfang, stockUnit: null }), heatingError(400, /Einheit/))
    await assert.rejects(speichern({ ...anfang, closingMeasuredOn: '31.12.2025' }), heatingError(400, /Peilung.*kein Datum/))
    // Felder, die fehlen, bleiben; ein leeres Feld leert.
    await speichern(anfang)
    const geleert = await speichern({ closingMeasuredOn: '' }) ?? assert.fail('keine Anlage')
    assert.deepEqual([geleert.row.closingMeasuredOn, geleert.row.closingQuantity], [null, 1800])
  })
  await withDatabase(async (opened) => {
    await oelhaus(opened, 'gas')
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)), heatingError(400, /nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle/))
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.equal(ansicht?.stock, null)
  })
})

test('Abgeschlossen (G-A4): Vorrat gesperrt, die Folgeperiode liest den eingefrorenen Endbestand; wieder geöffnet den lebenden', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const erste = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    const closing = erste.statement?.closing ?? assert.fail('keine Bestandsrechnung')
    // Der abgeschlossene Stand trägt den Endbestand, wie ihn die Abrechnung einfriert (Task 6).
    await opened.write((db) => closeSettlement(db, {
      id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null,
      settlement: { heating: [{ plantId: 'hp', period: '2025-01', energy: 'oil', stock: { closing: { ...closing, layers: closing.layers.map((l) => ({ ...l, costCents: 175000 })) } } }] },
    }))
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { closingQuantity: 1700 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeStock(db, 'hp', '2025-01')), heatingError(409, /abgeschlossen/))
    const zweite = await opened.write((db) => saveStock(db, 'hp', '2026-01', { stockUnit: 'l', closingQuantity: 900 })) ?? assert.fail('keine Anlage')
    assert.deepEqual([zweite.derived?.frozen, zweite.derived?.value.costCents], [true, 175000])
    await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey('2025-01'), 'h1'))
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.deepEqual([ansicht?.stock?.derived?.frozen, ansicht?.stock?.derived?.value.costCents], [false, 171000])
  })
})

test('Vorrat entfernen: die acht Felder werden leer, die Zeile der Heizperiode bleibt', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang))
    assert.equal(await opened.write((db) => removeStock(db, 'hp', '2025-01')), true)
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(ansicht?.stock?.row, {
      stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null,
      openingInvoicedBefore2023: null, closingQuantity: null, closingMeasuredOn: null,
    })
    assert.equal(await opened.write((db) => removeStock(db, 'gibt-es-nicht', '2025-01')), null)
  })
})
```

Die 171.000 ct im ersten Test sind der Endbestand der ersten Heizperiode: 1.800 von 2.000 l
Anfangsbestand ohne Lieferung, also 1.800 / 2.000 × 1.900 € = 1.710 €.

In `server/test/api.test.ts` anhängen:

```ts
// ---------- Vorrat (Heizung PR 8) ----------

test('Vorrat über die Routen: speichern, entfernen, 404 ohne Anlage; Öllieferung mit Lieferdatum und Menge', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'oil', method: 'manual' })))
    const base = `/api/heating-plants/${plant.id}/periods/2025-01/stock`
    const gespeichert = await send(base, { method: 'PUT', body: JSON.stringify({ stockUnit: 'l', openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 400 }) })
    assert.equal(gespeichert.status, 200)
    assert.equal((await jsonOf<StockView>(gespeichert)).statement?.consumed.costCents, 57000)
    assert.deepEqual(await jsonOf<unknown>(await send(base, { method: 'DELETE' })), { ok: true, removed: true })
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/stock', { method: 'PUT', body: '{}' })).status, 404)
    // Annahme A11 (Route der Lieferungen aus PR 7): Eine Öllieferung braucht Lieferdatum und Menge.
    const ohneDatum = await send(`/api/heating-plants/${plant.id}/fuel-deliveries`, postJson({ quantity: 1000, quantityUnit: 'l', emissionsKg: 2676.3, co2CostCents: 17500 }))
    assert.equal(ohneDatum.status, 400)
    assert.match(await errorFrom(ohneDatum), /Lieferdatum/)
    const mitDatum = await send(`/api/heating-plants/${plant.id}/fuel-deliveries`, postJson({ deliveredAt: '2025-03-15', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676.3, co2CostCents: 17500 }))
    assert.equal(mitDatum.status, 201)
  } finally {
    s.stop()
  }
})
```

(`StockView` in den Typimport aus `'../../shared/types.ts'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-vorrat.test.ts`
Expected: FAIL mit `Cannot find module '…/src/db/fuelStock.ts'`.

- [ ] **Step 3: Die Helfer ziehen um (`server/src/db/heatingPeriodContext.ts`)**

Die Funktionen `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, die
Konstante `closedText` und den Typ `PlantContext` aus `server/src/db/co2.ts` **wörtlich** in die
neue Datei verschieben, je mit `export`, samt den Importen, die sie brauchen; darüber:

```ts
// Die Heizperioden einer Anlage in der Datenbank (Heizung PR 6, ausgelagert mit PR 8): die Anlage mit
// den Regeln ihres Objekts und ihren eigenen, eine Heizperiode aus ihrem Schlüssel, ob sie
// abgeschlossen ist, und ihre Zeile in `heating_periods`, angelegt beim ersten Speichern. db/co2.ts
// (CO₂ und Warmwasser) und db/fuelStock.ts (Vorrat) importieren von hier, nie umgekehrt.
```

In db/co2.ts die verschobenen Teile löschen und
`import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext, type PlantContext } from './heatingPeriodContext.ts'`
ergänzen; nicht mehr gebrauchte Importe dort entfernen (der Übersetzer nennt sie nicht, `npm run
typecheck` bleibt grün; ein Blick auf die Importzeile genügt).

- [ ] **Step 4: Vorrat (`server/src/db/fuelStock.ts`)**

```ts
// Der Vorrat je Heizperiode (Heizung PR 8, #97, #99; Entwurf 5.3, 8.2): speichern, entfernen und die
// Ansicht der Karte „Vorrat“. Die Bestandsrechnung steht in ../fuelStock.ts, die Kette der Vorperioden
// baut snapshot.ts (`stockChainsOf`); Ansicht und Abrechnung rechnen also dasselbe.
//
// **Der Anfangsbestand** wird nur in der ersten Heizperiode mit Vorrat eingetragen. Hat die
// Vorperiode einen Endbestand, ist er der Anfangsbestand (derselbe Tank, dieselbe Peilung); eine
// eigene Eingabe wird abgelehnt, und eine frühere wird beim Speichern geleert, damit kein Wert gilt,
// den niemand mehr sieht.
import { and, eq } from 'drizzle-orm'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import { co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil } from '../../../shared/law/co2kostaufg.ts'
import { valueAt } from '../../../shared/law/register.ts'
import type { BillingPeriod, HeatingPlant, StockRow, StockView } from '../../../shared/types.ts'
import { CO2_FUELS } from '../co2.ts'
import { problemText, stockOf, type StockOptions, type StockPeriodInput } from '../fuelStock.ts'
import { stockChainsOf } from '../snapshot.ts'
import type { Database } from './client.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext, type PlantContext } from './heatingPeriodContext.ts'
import { readStock, type Stock } from './read.ts'
import { has, HeatingError, ISO_DATE, raw } from './repository.ts'
import { heatingPeriods, STOCK_UNITS } from './schema.ts'

const NOT_STOCK = 'Einen Vorrat gibt es nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle.'
const LATER_SELF = 'Den Vorrat bei der eigenen Heizkostenabrechnung rechnet Mietfuchs mit einer späteren Version.'
const NUMBER = 'Mengen und kg sind je eine Zahl ab 0, zum Beispiel 1800 oder 5352,6.'
const CENTS = 'Beträge sind ganze Cent ab 0.'
const UNIT = 'Bitte wählen Sie die Einheit des Vorrats: Liter, Kilogramm oder Schüttraummeter.'
const DATE = 'Der Tag der Peilung ist kein Datum. Bitte wählen Sie ihn im Kalender oder lassen Sie das Feld leer.'
const derivedText = (label: string) => `Der Anfangsbestand ergibt sich aus dem Endbestand der Heizperiode ${label}. Ändern Sie ihn dort; hier ist er nicht einzutragen.`

const EMPTY: StockRow = {
  stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null,
  openingInvoicedBefore2023: null, closingQuantity: null, closingMeasuredOn: null,
}
const OPENING_KEYS = ['openingQuantity', 'openingCostCents', 'openingEmissionsKg', 'openingCo2Cents', 'openingInvoicedBefore2023'] as const

// Was die Bestandsrechnung einer Anlage verlangt (fuelStock.ts): Beträge, wenn nach Verbrauch verteilt
// wird (freie Schlüssel), kg und CO₂-Kosten bei Heizöl und Flüssiggas. Das Register beantwortet § 11
// Abs. 2 Satz 2 hier ohne Protokoll; in der Abrechnung protokolliert `law()`.
export function stockOptionsFor(plant: Pick<HeatingPlant, 'energy' | 'method'>): StockOptions {
  return {
    needCost: plant.method === 'manual',
    needCo2: CO2_FUELS.includes(plant.energy),
    countedAt: (date) => !valueAt(co2CostsBefore, date),
    excludedUntil: co2CostsExcludedUntil(),
    countedFrom: co2CostsCountedFrom(),
  }
}

const rowOf = (r: StockRow | undefined): StockRow => (r ? {
  stockUnit: r.stockUnit, openingQuantity: r.openingQuantity, openingCostCents: r.openingCostCents, openingEmissionsKg: r.openingEmissionsKg,
  openingCo2Cents: r.openingCo2Cents, openingInvoicedBefore2023: r.openingInvoicedBefore2023, closingQuantity: r.closingQuantity, closingMeasuredOn: r.closingMeasuredOn,
} : { ...EMPTY })

// Die Kette dieser Heizperiode, wie die Abrechnung sie bekommt (snapshot.ts). Abgeschlossene
// Abrechnungen nur des eigenen Objekts, denn Zeitraumschlüssel wiederholen sich zwischen Objekten.
function chainOf(stock: Stock, ctx: PlantContext, h: BillingPeriod): StockPeriodInput[] {
  const [entry] = stockChainsOf({
    costItems: stock.costItems,
    closedSettlements: stock.closedSettlements.filter((c) => c.propertyId === ctx.plant.propertyId),
    closedHeatingSettlements: stock.closedHeatingSettlements,
    heatingPeriodRows: stock.heatingPeriodRows,
    fuelDeliveries: stock.fuelDeliveries,
  }, ctx.plant, ctx.objectRules, [h])
  return entry?.chain ?? []
}

// Die Ansicht einer Heizperiode: eingetragen, Anfangsbestand aus der Vorperiode, Bestandsrechnung, was
// fehlt.
export function stockViewFor(stock: Stock, ctx: PlantContext, h: BillingPeriod): StockView {
  const opts = stockOptionsFor(ctx.plant)
  const chain = chainOf(stock, ctx, h)
  const prev = chain.length > 1 ? chain[chain.length - 2] : undefined
  let derived: StockView['derived'] = null
  if (prev?.frozenClosing) derived = { value: prev.frozenClosing, period: prev.key, label: prev.label, frozen: true }
  else if (prev) {
    const before = stockOf(chain.slice(0, -1), opts)
    if (before.ok) derived = { value: before.statement.closing, period: prev.key, label: prev.label, frozen: false }
  }
  const result = stockOf(chain, opts)
  return {
    row: rowOf(stock.heatingPeriodRows.find((r) => r.plantId === ctx.plant.id && r.period === h.key)),
    derived,
    statement: result.ok ? result.statement : null,
    problem: result.ok ? null : problemText(result.problem),
  }
}

// Eine Zahl aus dem Rumpf: fehlt der Schlüssel, bleibt der bisherige Wert; leer heißt null; alles
// andere muss eine Zahl ab 0 sein, bei Beträgen ganze Cent. Ein ungültiger Wert ist ein Fehler mit
// Satz, kein stilles Weglassen.
function numberField(body: unknown, key: keyof StockRow, current: number | null, cents: boolean): number | null {
  if (!has(body, key)) return current
  const v = raw(body, key)
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new HeatingError(400, cents ? CENTS : NUMBER)
  if (cents && !Number.isInteger(v)) throw new HeatingError(400, CENTS)
  return v
}

function mergeStock(current: StockRow, body: unknown): StockRow {
  const unitRaw = has(body, 'stockUnit') ? raw(body, 'stockUnit') : current.stockUnit
  const stockUnit = unitRaw === null || unitRaw === undefined || unitRaw === '' ? null : STOCK_UNITS.find((u) => u === unitRaw)
  if (stockUnit === undefined) throw new HeatingError(400, UNIT)
  const before = has(body, 'openingInvoicedBefore2023') ? raw(body, 'openingInvoicedBefore2023') : current.openingInvoicedBefore2023
  const measuredRaw = has(body, 'closingMeasuredOn') ? raw(body, 'closingMeasuredOn') : current.closingMeasuredOn
  const closingMeasuredOn = measuredRaw === null || measuredRaw === undefined || measuredRaw === '' ? null : String(measuredRaw)
  if (closingMeasuredOn !== null && !ISO_DATE.test(closingMeasuredOn)) throw new HeatingError(400, DATE)
  const next: StockRow = {
    stockUnit,
    openingQuantity: numberField(body, 'openingQuantity', current.openingQuantity, false),
    openingCostCents: numberField(body, 'openingCostCents', current.openingCostCents, true),
    openingEmissionsKg: numberField(body, 'openingEmissionsKg', current.openingEmissionsKg, false),
    openingCo2Cents: numberField(body, 'openingCo2Cents', current.openingCo2Cents, true),
    openingInvoicedBefore2023: typeof before === 'boolean' ? before : null,
    closingQuantity: numberField(body, 'closingQuantity', current.closingQuantity, false),
    closingMeasuredOn,
  }
  if ((next.openingQuantity !== null || next.closingQuantity !== null) && next.stockUnit === null) throw new HeatingError(400, UNIT)
  return next
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveStock(db: Database, plantId: string, period: string, body: unknown): Promise<StockView | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (!isStockEnergy(ctx.plant.energy)) throw new HeatingError(400, NOT_STOCK)
  if (ctx.plant.method === 'self') throw new HeatingError(400, LATER_SELF)
  const h = heatingPeriodOf(ctx, period)
  const stock = await readStock(db)
  const next = mergeStock(rowOf(stock.heatingPeriodRows.find((r) => r.plantId === plantId && r.period === h.key)), body)
  const chain = chainOf(stock, ctx, h)
  const prev = chain.length > 1 ? chain[chain.length - 2] : undefined
  if (prev) {
    if (OPENING_KEYS.some((k) => has(body, k) && raw(body, k) !== null && raw(body, k) !== '')) throw new HeatingError(400, derivedText(prev.label))
    for (const k of OPENING_KEYS) next[k] = null
  }
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set(next).where(eq(heatingPeriods.id, id))
  })
  return stockViewFor(await readStock(db), ctx, h)
}

// `true` geleert, `false` gab es keinen Vorrat, `null` keine Anlage. Die Zeile der Heizperiode
// bleibt, denn an ihr hängen auch Warmwasser und CO₂-Angaben.
export async function removeStock(db: Database, plantId: string, period: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const [own] = await db.select().from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
  if (!own || (own.stockUnit === null && own.openingQuantity === null && own.closingQuantity === null)) return false
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    await tx.update(heatingPeriods).set({ ...EMPTY }).where(eq(heatingPeriods.id, own.id))
  })
  return true
}
```

`Stock` (read.ts) führt seit PR 6 `heatingPeriodRows`, seit PR 7 `fuelDeliveries` (A4) und seit PR 5
`closedHeatingSettlements`; fehlt eines davon in `Stock`, nennt es der Übersetzer, und es wird in
`readStock` ergänzt wie die übrigen.

- [ ] **Step 5: Die Ansicht (`server/src/db/co2.ts`)**

`import { stockViewFor } from './fuelStock.ts'`, `import { isStockEnergy } from '../../../shared/fuelStock.ts'`
und `readStock` aus `'./read.ts'` ergänzen. In `heatingPeriodViews` vor der Schleife über die
Heizperioden:

```ts
  // Der Vorrat (Heizung PR 8) nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle.
  const stockData = isStockEnergy(ctx.plant.energy) ? await readStock(db) : null
```

und im Objekt je Heizperiode `stock: null` (aus Task 2) ersetzen durch:

```ts
      stock: stockData ? stockViewFor(stockData, ctx, h) : null,
```

- [ ] **Step 6: Lieferungen von Vorratsenergien (`server/src/db/fuel.ts`, PR 7)**

`import { STOCK_ENERGIES } from '../../../shared/fuelStock.ts'` (statt aus `../fuel.ts`, falls dort
importiert) und `ISO_DATE` aus `'./repository.ts'`, falls noch nicht da. In `guardFuelDelivery`
(Annahme A6) die Zeile `if (STOCK_ENERGIES.includes(plant.energy)) throw new HeatingError(400,
LATER.stock)` ersetzen durch:

```ts
  // Vorratsenergien (Heizung PR 8, Entwurf 5.4, 8.2): Die Lieferung gehört zur Heizperiode ihres
  // Lieferdatums; ihre Menge braucht die Einheit des Vorrats. Bei der eigenen Heizkostenabrechnung
  // rechnet Mietfuchs den Vorrat erst mit einer späteren Version.
  if (STOCK_ENERGIES.includes(plant.energy)) {
    if (plant.method === 'self') throw new HeatingError(400, 'Den Vorrat bei der eigenen Heizkostenabrechnung rechnet Mietfuchs mit einer späteren Version.')
    if (!after.deliveredAt || !ISO_DATE.test(after.deliveredAt)) {
      throw new HeatingError(400, 'Bitte tragen Sie das Lieferdatum ein. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.')
    }
    if (after.quantity === null || !(after.quantity > 0) || (after.quantityUnit !== 'l' && after.quantityUnit !== 'kg' && after.quantityUnit !== 'srm')) {
      throw new HeatingError(400, 'Bitte tragen Sie die gelieferte Menge in Litern, Kilogramm oder Schüttraummetern ein, wie auf der Rechnung.')
    }
  }
```

Den Eintrag `stock` in `LATER` entfernen, wenn ihn sonst niemand liest. Der Test von PR 7, der die
Sperre prüft (etwa „Lieferung bei Öl: kommt mit einer späteren Version“), wird umgestellt: Eine
Öllieferung mit Lieferdatum und Menge wird angenommen, ohne Lieferdatum mit dem Satz oben abgelehnt.
Annahme A11 nennt die Route `POST /api/heating-plants/:id/fuel-deliveries` (201); heißt sie in PR 7
anders, gilt deren Pfad im api-Test aus Step 1.

- [ ] **Step 7: Routen (`server/src/index.ts`)**

`import { removeStock, saveStock } from './db/fuelStock.ts'`. Hinter den Routen
`…/periods/:period/hot-water` (PR 6):

```ts
// Vorrat je Heizperiode (Heizung PR 8): Was gespeichert wird, steht in db/fuelStock.ts.
app.put('/api/heating-plants/:id/periods/:period/stock', async (req, res) => {
  const saved = await writeData((db) => saveStock(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.delete('/api/heating-plants/:id/periods/:period/stock', async (req, res) => {
  const removed = await writeData((db) => removeStock(db, req.params.id, req.params.period))
  if (removed === null) return res.status(404).json({ error: NO_PLANT })
  res.json({ ok: true, removed })
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-vorrat.test.ts test/db-co2.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS (`db-vorrat.test.ts`: 4 Tests).

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/heatingPeriodContext.ts server/src/db/fuelStock.ts server/src/db/co2.ts server/src/db/fuel.ts server/src/index.ts server/test
git commit -m "Vorrat je Heizperiode speichern, Ansicht mit Anfangsbestand aus der Vorperiode, Lieferungen von Heizöl, Flüssiggas, Pellets, Holz und Kohle

Der Anfangsbestand ist nur in der ersten Heizperiode mit Vorrat einzutragen; danach ist er der
Endbestand der Vorperiode, eingefroren, wenn sie abgeschlossen ist.

Refs #97, #99"
```

---
### Task 6: Berechnung: Messdienst ohne Aufteilung mit Vorrat

Hat der Messdienst die CO₂-Kosten nicht aufgeteilt (`selfAfterService`) und heizt die Anlage mit
einer Vorratsenergie, teilt Mietfuchs die CO₂-Kosten aus dem **verbrauchten** Brennstoff auf: E und C
kommen aus der Bestandsrechnung (Naht N1, Annahme A7). Fehlt der Bestand oder geht er nicht auf, wird
nicht aufgeteilt, und der Hinweis nennt die 3 % je Mieter (Entwurf 8.2 „Ohne Bestand“, G-B4). Dazu die
Hinweise zum Altbestand vor 2023 und zum Peildatum, und der Ausweis bekommt die Bestandsrechnung
(`HeatingStatement.stock`), die mit dem Abschluss einfriert.

**Files:**
- Modify: `server/src/fuelStock.ts`, `server/src/calc.ts`
- Test: `server/test/calc-vorrat.test.ts` (neu)

**Interfaces:**
- Consumes (Task 1–5; PR 3, PR 5, PR 6, A7): `co2CostsBefore`, `co2CostsExcludedUntil`, `co2CostsCountedFrom`, `co2CutMissing`, `co2ApplicableFrom`, `hkvDegreeDays`, `degreeDayPermille`; `stockOf`, `problemText`, `measuredOffset`, `StockPeriodInput`, `StockResult`; `isStockEnergy`; `hasOwnRhythm`, `wayOf`; `CO2_FUELS`; im CO₂-Block `co2Pots`, `report`, `where`, `plantSubject`, `ids`, `cutsOn`, `hPeriod`, `st`, `applicable`; A7 `fuelTotals`.
- Produces:
  - fuelStock.ts: `type FuelFigures = { emissionsKg: number; co2Cents: number; grossCents: number | null; coveragePermille: number }`, `fuelFromStock(s: HeatingStockStatement): FuelFigures`, `fuelFromDeliveries(p: StockPeriodInput, countedAt): FuelFigures`, `stockTouched(chain): boolean`
  - calc.ts: `stockOfPlant: Map<string, { plant: SnapshotHeatingPlant; result: StockResult; chain: StockPeriodInput[]; last: StockPeriodInput }>`, `stockCountedAt(date)`; Codes `fuel.stock-missing` (warning), `fuel.stock-invalid` (error), `fuel.before-2023` (hint), `fuel.stock-date-differs` (hint); `HeatingStatement.stock` gefüllt

- [ ] **Step 1: Write the failing tests**

`server/test/calc-vorrat.test.ts`:

```ts
// Brennstoffvorrat in der Abrechnung (Heizung PR 8, #97, #99; Entwurf 8.2, 12.2 R2, G-C5, N8, 12.3
// Nr. 1, 2, 10). Beispiel Heizöl: 300 m², drei Wohnungen à 100 m².
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import type { StockDeliveryInput, StockPeriodInput } from '../src/fuelStock.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod, periodKey } from '../../shared/period.ts'
import type { Co2Statement } from '../../shared/types.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 100, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s })
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Öl', energy: 'oil', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})
const co2 = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: P, method: 'selfAfterService', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const lieferung = (id: string, date: string, quantity: number, costCents: number | null, emissionsKg: number, co2Cents: number): StockDeliveryInput => ({
  id, label: `Lieferung vom ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`, date, invoiceDate: date, quantity, quantityUnit: 'l', costCents, emissionsKg, co2Cents,
})
// Beispiel Heizöl (Entwurf 8.2).
const VORRAT = (over: Partial<StockPeriodInput> = {}, cost = true): StockPeriodInput => ({
  key: P.key, label: '2025', from: P.from, to: P.to, unit: 'l',
  ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: true },
  closingQuantity: 1800, closingMeasuredOn: '2025-12-31',
  deliveries: [lieferung('d1', '2025-03-15', 3000, cost ? 315000 : null, 8028.9, 52549), lieferung('d2', '2025-10-10', 2500, cost ? 250000 : null, 6690.75, 43791)],
  laterDeliveries: [], frozenClosing: null, ...over,
})
const drei = { units: ['a', 'b', 'c'].map((u) => unit(u)), tenancies: ['a', 'b', 'c'].map((u) => tenancy(`t${u}`, u)) }
const snap = (s: Partial<SnapshotSource>, p: SnapshotHeatingPlant, chain: StockPeriodInput[], statements: Co2Statement[] = []): Snapshot =>
  ({ ...snapshotOf(source(s), 2025), heatingPlants: [p], co2Statements: statements, stockChains: [{ plantId: 'hp', period: P.key, chain }] })
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const reliefRows = (r: ComputedSettlement): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
const co2ShareOf = (r: ComputedSettlement): number =>
  r.landlord.rows.flatMap((row) => row.landlordParts ?? []).filter((p) => p.reason === 'co2Share').reduce((a, p) => a + p.cents, 0)

// Der Messdienst hat aus seiner Bestandsrechnung 5.750 € Brennstoff verteilt; die Einzelbeträge der
// Mieter sind erfunden, ihre Summe stammt aus dem Beispiel.
const MESSDIENST: SnapshotCostItem = {
  id: 'hz', period: P.key, category: HEATING_CATEGORY, description: 'Heizung laut Messdienst', amountCents: 575000, key: 'amounts',
  tenancyAmounts: { ta: 230000, tb: 172500, tc: 172500 }, heatingPlantId: 'hp',
}
const service = plant({ method: 'service' })
const nichtAufgeteilt = [co2({ method: 'selfAfterService' })]

test('Messdienst ohne Aufteilung, Heizöl mit Vorrat (Entwurf 8.2, 7.6): E 15.254,91 kg → 50,8 → 80 %, C 648,10 €, L 518,48 € nach dem Anteil an den Messdienstbeträgen', () => {
  const r = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({}, false)], nichtAufgeteilt))
  assert.ok(!codes(r).some((c) => c.startsWith('fuel.stock')), codes(r).join(', '))
  assert.ok(!codes(r).includes('co2.service-unsplit'))
  // 518,48 € × Betrag / 5.750 €: 207,392 / 155,544 / 155,544; der Restcent geht an tb (Gleichstand, Kennung).
  assert.deepEqual(reliefRows(r), [['ta', -20739], ['tb', -15555], ['tc', -15554]])
  assert.equal(co2ShareOf(r), 51848)
  const h = r.heating?.[0] ?? assert.fail('keine Heizanlage in der Abrechnung')
  assert.deepEqual([h.co2?.kgPerM2, h.co2?.stage?.landlordPercent, h.co2?.landlordCents], [50.8, 80, 51848])
  assert.deepEqual([h.stock?.consumed.emissionsKg, h.stock?.consumed.co2Cents, h.stock?.closing.co2Cents], [15254.91, 64810, 31530])
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.costs-before'), 'der Stichtag des § 11 Abs. 2 Satz 2 friert mit ein')
  // Altbestand mit Rechnung 2022 hebt die Stufe ohne CO₂-Kosten (D-H6).
  assert.match(textOf(r, 'fuel.before-2023'), /5\.352,6 kg CO₂ des verbrauchten Brennstoffs stammen aus Brennstoff, der vor dem 01\.01\.2023 in Rechnung gestellt wurde/)
})

test('Messdienst ohne Aufteilung: Vorrat fehlt → fuel.stock-missing mit 3 % je Mieter statt co2.service-unsplit; geht nicht auf → fuel.stock-invalid', () => {
  const fehlt = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingQuantity: null }, false)], nichtAufgeteilt))
  const n = fehlt.notices.find((x) => x.code === 'fuel.stock-missing') ?? assert.fail(codes(fehlt).join(', '))
  assert.deepEqual([n.level, n.subject], ['warning', { kind: 'heatingCosts', id: 'hp' }])
  assert.match(n.text, /Für die Bestandsrechnung \(Heizperiode 2025\) fehlt: der Endbestand\./)
  assert.match(n.text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 69,00 €, tb \(b\) 51,75 € und tc \(c\) 51,75 €/)
  assert.ok(!codes(fehlt).includes('co2.service-unsplit'))
  assert.deepEqual(reliefRows(fehlt), [])
  const kaputt = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingQuantity: 9000 }, false)], nichtAufgeteilt))
  assert.equal(kaputt.notices.find((x) => x.code === 'fuel.stock-invalid')?.level, 'error')
  assert.deepEqual(reliefRows(kaputt), [])
})

test('Wer nichts zum Vorrat erfasst hat, merkt nichts: ohne Zeile und ohne Lieferung wie vor PR 8 (co2.service-unsplit)', () => {
  const leer: StockPeriodInput = { ...VORRAT(), unit: null, ownOpening: null, closingQuantity: null, closingMeasuredOn: null, deliveries: [] }
  const r = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [leer], nichtAufgeteilt))
  assert.ok(codes(r).includes('co2.service-unsplit'))
  assert.ok(!codes(r).some((c) => c.startsWith('fuel.')))
  assert.ok(!r.legalBasis.values?.some((v) => v.id === 'co2.costs-before'))
})

test('Peilung neben dem Ende (Review Focus 1): Hinweis mit Tagen, Gradtagsanteil und Lieferung; gerechnet wie gepeilt', () => {
  const spaet = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingMeasuredOn: '2026-01-05', laterDeliveries: [{ label: 'Lieferung vom 02.01.2026', date: '2026-01-02' }] }, false)], nichtAufgeteilt))
  const t = textOf(spaet, 'fuel.stock-date-differs')
  // 5 Tage im Januar: 5 × 170 / 31 = 27,4 ‰ (Entwurf 3.5).
  assert.match(t, /Der Tank wurde am 05\.01\.2026 gepeilt, die Heizperiode endete am 31\.12\.2025: 5 Tage, 27,4 ‰ der Gradtage dazwischen\. Mietfuchs rechnet mit dem Wert wie gepeilt\./)
  assert.match(t, /„Lieferung vom 02\.01\.2026“ ist im gepeilten Endbestand schon enthalten/)
  assert.equal(spaet.heating?.[0]?.stock?.consumed.quantity, 5700)
  const frueh = computeSettlement(snap({ ...drei, costItems: [MESSDIENST] }, service, [VORRAT({ closingMeasuredOn: '2025-12-20' }, false)], nichtAufgeteilt))
  assert.match(textOf(frueh, 'fuel.stock-date-differs'), /am 20\.12\.2025 gepeilt, die Heizperiode endet am 31\.12\.2025: 11 Tage/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-vorrat.test.ts`
Expected: FAIL. Bei Heizöl nimmt PR 7 keine Lieferung an (Sperre), und die Berechnung kennt
`stockChains` nicht: Es gibt keine Abzugszeilen, `heating[0].stock` fehlt, die Codes `fuel.*` fehlen,
und der Test ohne Vorrat ist schon grün.

- [ ] **Step 3: Zahlen für die CO₂-Aufteilung (`server/src/fuelStock.ts`)**

Ans Dateiende:

```ts
// ---------- Für die CO₂-Aufteilung (Naht N1 zu PR 7) ----------

// E, C und der Betrag des verbrauchten Brennstoffs, in der Gestalt, die die eigene Aufteilung (PR 7)
// liest. Der Vorrat deckt die ganze Heizperiode ab.
export type FuelFigures = { emissionsKg: number; co2Cents: number; grossCents: number | null; coveragePermille: number }

export const fuelFromStock = (s: HeatingStockStatement): FuelFigures => ({
  emissionsKg: s.consumed.emissionsKg,
  co2Cents: s.consumed.co2Cents,
  grossCents: s.consumed.costCents,
  coveragePermille: 1000,
})

// Ohne Bestand bei freien Schlüsseln: wie geliefert (Entwurf 8.2: „Verteilt wird nach Lieferung wie
// heute“). Der Hinweis `fuel.manual-by-delivery` sagt, dass die Einstufung dann auf gelieferten statt
// verbrauchten kg beruht.
export function fuelFromDeliveries(p: StockPeriodInput, countedAt: (invoiceDate: string) => boolean): FuelFigures {
  const known = p.deliveries.every((d) => d.costCents !== null)
  return {
    emissionsKg: roundKg(p.deliveries.reduce((a, d) => a + (d.emissionsKg ?? 0), 0)),
    co2Cents: p.deliveries.reduce((a, d) => a + (d.co2Cents !== null && countedAt(d.invoiceDate) ? d.co2Cents : 0), 0),
    grossCents: known ? p.deliveries.reduce((a, d) => a + (d.costCents ?? 0), 0) : null,
    coveragePermille: 1000,
  }
}

// Hat der Vermieter zum Vorrat dieser Heizperiode etwas erfasst? Sonst rechnet die Abrechnung wie ohne
// Vorrat (Entwurf 1.2 Nr. 1).
export function stockTouched(chain: readonly StockPeriodInput[]): boolean {
  const last = chain.at(-1)
  if (!last) return false
  return chain.length > 1 || last.unit !== null || last.ownOpening !== null || last.closingQuantity !== null || last.deliveries.length > 0
}
```

- [ ] **Step 4: Codes und Bestandsrechnung (`server/src/calc.ts`)**

Importe ergänzen:

```ts
import { co2CostsBefore, co2CostsCountedFrom, co2CostsExcludedUntil } from '../../shared/law/co2kostaufg.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { isStockEnergy } from '../../shared/fuelStock.ts'
import { fuelFromDeliveries, fuelFromStock, measuredOffset, problemText, stockOf, stockTouched, type FuelFigures, type StockPeriodInput, type StockResult } from './fuelStock.ts'
```

(`hkvDegreeDays` aus `'../../shared/law/heizkostenv.ts'`, `hasOwnRhythm` aus
`'../../shared/heatingPeriod.ts'` und `wayOf` aus `'./snapshot.ts'` importiert calc.ts seit PR 3 und
PR 5 zum Teil schon; fehlende ergänzen. `CO2_FUELS` steht im Import aus `'./co2.ts'` seit PR 6.)

In `noticeKinds` hinter den Codes von PR 7:

```ts
  // Heizung PR 8 (#97, #99): Brennstoffvorrat (Entwurf 8.2, 10.1). `fuel.stock-missing` ist hier eine
  // Warnung (Messdienst ohne Aufteilung, 3 %); den Fehler bei der eigenen Heizkostenabrechnung bringt
  // PR 10 mit eigenem Code, denn eine Stufe hängt am Code (#112).
  'fuel.stock-missing': { level: 'warning', title: 'Vorrat fehlt für die CO₂-Aufteilung', rule: 'co2-split', terms: ['fuelStock', 'co2Split'] },
  'fuel.stock-invalid': { level: 'error', title: 'Bestandsrechnung geht nicht auf', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
  'fuel.before-2023': { level: 'hint', title: 'Altbestand mit Rechnung vor 2023', rule: 'co2-split', terms: ['fuelStock', 'co2Split'] },
  'fuel.stock-date-differs': { level: 'hint', title: 'Tank nicht am Ende der Heizperiode gepeilt', rule: 'heating-consumed-fuel', terms: ['fuelStock'] },
```

In `computeSettlement` direkt vor der Zeile `const co2Pots = co2PotsOf(snapshot, items)` (PR 6), also
hinter der Zeile, die `items` anlegt:

```ts
  // ---------- Brennstoffvorrat (Heizung PR 8, Entwurf 8.2) ----------
  // Die Bestandsrechnung je Anlage mit Vorratsenergie für die Heizperiode dieser Berechnung, bevor
  // verteilt wird: Bei freien Schlüsseln entstehen daraus die Übertragsposten, beim Messdienst ohne
  // Aufteilung E und C (Naht N1). Eine Anlage mit eigener Heizperiode rechnet ihre Teilabrechnung
  // (PR 5), nicht P. Beim Messdienst mit Abzugszeile oder Ausweis führt der Messdienst den Bestand.
  // Ob die CO₂-Kosten einer Rechnung zählen, fragt das Register; `law()` protokolliert nur, wenn
  // wirklich gerechnet wird, eine Anlage ohne Vorrat ändert `legalBasis.values` also nicht.
  const stockCountedAt = (date: string): boolean => !law(co2CostsBefore, { date }, lawLog)
  const stockOfPlant = new Map<string, { plant: SnapshotHeatingPlant; result: StockResult; chain: StockPeriodInput[]; last: StockPeriodInput }>()
  for (const plant of snapshot.heatingPlants ?? []) {
    if (!isStockEnergy(plant.energy)) continue
    if (hasOwnRhythm(wayOf(plant)) && snapshot.scope?.plant.id !== plant.id) continue
    const statement = (snapshot.co2Statements ?? []).find((s) => s.plantId === plant.id && s.period === snapshot.period.key)
    if (plant.method !== 'manual' && !(plant.method === 'service' && statement?.method === 'selfAfterService')) continue
    const chain = (snapshot.stockChains ?? []).find((c) => c.plantId === plant.id && c.period === snapshot.period.key)?.chain ?? []
    const last = chain.at(-1)
    if (!last) continue
    const result = stockOf(chain, {
      needCost: plant.method === 'manual',
      needCo2: CO2_FUELS.includes(plant.energy),
      countedAt: stockCountedAt,
      excludedUntil: co2CostsExcludedUntil(),
      countedFrom: co2CostsCountedFrom(),
    })
    stockOfPlant.set(plant.id, { plant, result, chain, last })
  }
```

`SnapshotHeatingPlant` in den Typimport aus `'./snapshot.ts'` aufnehmen, falls noch nicht da.

- [ ] **Step 5: Naht N1 und Hinweise im CO₂-Block (`server/src/calc.ts`)**

**(a) Messdienst ohne Aufteilung.** PR 7 entscheidet im CO₂-Block, ob ein Topf mit
`selfAfterService` selbst aufgeteilt wird, an seinen Lieferungen, und bestimmt dafür
`const fuel = fuelTotals(pot, snapshot, lawLog)` (Annahme A7). Für eine Vorratsenergie entscheidet
ab jetzt die Bestandsrechnung. Direkt vor dieser Entscheidung im Zweig des Topfs (dort sind `st`,
`where`, `ids`, `cutsOn`, `hPeriod` und `plantSubject` aus PR 6 bekannt):

```ts
      // Vorratsenergien (Heizung PR 8, Entwurf 8.2): E und C des verbrauchten Brennstoffs aus der
      // Bestandsrechnung. Beim Messdienst ohne Aufteilung wird ohne sie nicht aufgeteilt (G-B4); hat
      // der Vermieter zum Vorrat nichts erfasst, bleibt es beim Hinweis aus PR 6.
      const stockEntry = stockOfPlant.get(pot.plantId)
      const stockHandled = stockEntry !== undefined && stockTouched(stockEntry.chain)
      const stockFigures: FuelFigures | null = !stockEntry
        ? null
        : stockEntry.result.ok
          ? fuelFromStock(stockEntry.result.statement)
          : pot.method === 'manual'
            ? fuelFromDeliveries(stockEntry.last, stockCountedAt)
            : null
      if (stockEntry && stockHandled && !stockEntry.result.ok && pot.method === 'service') {
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        const problem = stockEntry.result.problem
        const tail = ` Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}.`
        if (problem.kind === 'missing') {
          warn('fuel.stock-missing',
            `${where}: ${problemText(problem)} Ohne Bestandsrechnung teilt Mietfuchs die CO₂-Kosten nicht selbst auf, denn aufzuteilen sind die Kosten des im Abrechnungszeitraum verursachten Ausstoßes (§ 7 Abs. 1 CO2KostAufG), also des verbrauchten und nicht des gelieferten Brennstoffs.${tail} ` +
              'Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein; die Abrechnung des Messdienstes nennt beide.',
            plantSubject)
        } else {
          warn('fuel.stock-invalid',
            `${where}: ${problemText(problem)} Bis das geklärt ist, teilt Mietfuchs die CO₂-Kosten nicht auf.${tail} Bitte prüfen Sie den Vorrat und die Lieferungen auf der Seite Heizkosten.`,
            plantSubject)
        }
      }
```

Die Bedingung, unter der PR 7 selbst aufteilt (Annahme A7: `const ownSplitByDeliveries = …`), bekommt
dahinter für Vorratsenergien den Vorrang der Bestandsrechnung:

```ts
      const ownSplit = isStockEnergy(pot.energy) ? stockFigures !== null : ownSplitByDeliveries
```

und PR 7 liest ab hier `ownSplit` statt `ownSplitByDeliveries`. Die Zeile
`const fuel = fuelTotals(pot, snapshot, lawLog)` wird

```ts
      const fuel: FuelFigures = isStockEnergy(pot.energy) && stockFigures !== null ? stockFigures : fuelTotals(pot, snapshot, lawLog)
```

Liefert `fuelTotals` einen Typ mit weiteren Feldern als `FuelFigures`, bekommt `FuelFigures` diese
Felder mit den Werten, die bei vollem Vorrat gelten (Abdeckung 1.000 ‰, keine Lücke).

Wo PR 7 (oder PR 6) `co2.service-unsplit` meldet, kommt in dessen Bedingung `&& !stockHandled` dazu:
Bei erfasstem Vorrat meldet `fuel.stock-missing` bzw. `fuel.stock-invalid` die Kürzung, nie beide.

**(b) Ausweis und Hinweise.** Direkt hinter `heatingStatements.push(report)` (PR 6):

```ts
    // Die Bestandsrechnung im Ausweis (Entwurf 9.5) und im abgeschlossenen Stand (G-A4); dazu die
    // Hinweise zum Altbestand vor 2023 (D-H6) und zur Peilung (8.2, wie 3.5).
    const stocked = stockOfPlant.get(pot.plantId)
    if (stocked?.result.ok) {
      const s = stocked.result.statement
      report.stock = s
      if (CO2_FUELS.includes(pot.energy) && s.oldStockKg > 0 && law(co2ApplicableFrom, { period: hPeriod }, lawLog)) {
        warn('fuel.before-2023',
          `${where}: ${fmtKg(s.oldStockKg)} kg CO₂ des verbrauchten Brennstoffs stammen aus Brennstoff, der vor dem ${fmtDay(co2CostsCountedFrom())} in Rechnung gestellt wurde. ` +
            'Sie zählen für die Einstufung des Gebäudes, CO₂-Kosten tragen sie nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG); die Stufe kann deshalb höher liegen, als die CO₂-Kosten allein vermuten lassen.',
          plantSubject)
      }
      const off = measuredOffset(stocked.last)
      if (off && s.closingMeasuredOn) {
        const permille = degreeDayPermille([off.range], law(hkvDegreeDays, { period: hPeriod }, lawLog))
        const names = andList(off.deliveries.map((d) => `„${d.label}“`))
        const deliveryText = off.deliveries.length === 0
          ? ''
          : off.after
            ? ` ${names} ${off.deliveries.length === 1 ? 'ist' : 'sind'} im gepeilten Endbestand schon enthalten, obwohl ${off.deliveries.length === 1 ? 'sie' : 'sie alle'} zur nächsten Heizperiode ${off.deliveries.length === 1 ? 'gehört' : 'gehören'}; ziehen Sie ${off.deliveries.length === 1 ? 'ihre Menge' : 'ihre Mengen'} vom gepeilten Wert ab.`
            : ` ${names} nach der Peilung ${off.deliveries.length === 1 ? 'ist' : 'sind'} im gepeilten Endbestand nicht enthalten und ${off.deliveries.length === 1 ? 'zählt' : 'zählen'} in dieser Heizperiode als verbraucht; ändern Sie den Endbestand, wenn Sie zum Ende neu gepeilt haben.`
        warn('fuel.stock-date-differs',
          `${where}: Der Tank wurde am ${fmtDay(s.closingMeasuredOn)} gepeilt, die Heizperiode ${off.after ? 'endete' : 'endet'} am ${fmtDay(pot.period.to)}: ${off.days} Tage, ${fmtPermille(permille)} ‰ der Gradtage dazwischen. Mietfuchs rechnet mit dem Wert wie gepeilt.${deliveryText}`,
          plantSubject)
      }
    }
```

Hinter `fmtCents` (Modulebene von calc.ts) zwei Formate mit fester Sprache wie die übrigen:

```ts
// kg mit bis zu zwei, Promille mit einer Nachkommastelle (Heizung PR 8; Entwurf 3.5 „27,4 ‰“).
const fmtKg = (kg: number): string => kg.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const fmtPermille = (pm: number): string => (Math.round(pm * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
```

Steht schon ein gleichnamiges Format in calc.ts, wird dieses genommen.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-vorrat.test.ts test/calc-co2.test.ts test/calc.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts && npm run typecheck`
Expected: PASS (`calc-vorrat.test.ts`: 4 Tests). Golden F01–F15 unverändert.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/fuelStock.ts server/src/calc.ts server/test/calc-vorrat.test.ts
git commit -m "CO₂ beim Messdienst ohne Aufteilung: Vorrat für Heizöl, Flüssiggas, Pellets, Holz und Kohle

E und C kommen aus der Bestandsrechnung; ohne Bestand wird nicht aufgeteilt und die Kürzung von 3 %
genannt. Hinweise zum Altbestand vor 2023 und zur Peilung, Bestandsrechnung im Ausweis.

Refs #97"
```

---
### Task 7: Berechnung: freie Schlüssel, Kosten nach Verbrauch

Bei freien Schlüsseln (`manual`) werden die Heizkosten nach Verbrauch umgelegt (§ 7 Abs. 2
HeizkostenV, R2 der dritten Prüfung, A6): Die Rechnungen bleiben Positionen in voller Höhe; dazu
kommen zwei Übertragsposten, „aus dem Vorrat“ (Wert des Anfangsbestands) und „im Vorrat“ (Wert des
Endbestands, negativ), verteilt mit dem Schlüssel der Brennstoffposition (Entwurf 8.2), und ihre
Gegenzeile beim Vermieter (`fuelCarry`). Ohne Bestand wird nach Lieferung verteilt wie bisher, mit
`fuel.manual-by-delivery`. Die Steuerübersicht bleibt beim Bezahlten und erklärt den Abstand beim
Eigenanteil (N8, G-C5).

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-vorrat.test.ts`

**Interfaces:**
- Consumes (Task 6; PR 3, PR 7): `stockOfPlant`, `stockTouched`, `problemText`; `SnapshotCostItem` mit `heatingPart`, `fuelDeliveryId`, `serviceFrom`, `serviceTo`, `labor35aCents`; A2 `kind: 'fuelCarry'` und `LandlordReason` `'fuelCarry'`; `taxReport` mit `settled` (PR 3).
- Produces: Übertragsposten mit Kennung `stock:<Anlage>:<Heizperiode>:in|out`, Zeilen `kind: 'fuelCarry'`; Gegenzeile beim Vermieter unter `stock:<Anlage>:<Heizperiode>` mit `landlordParts: [{ reason: 'fuelCarry', … }]`; Code `fuel.manual-by-delivery` (warning); `stockCarrySelfCents(settlement): number`; `TaxReport['expenses'].stockCarrySelfCents`

- [ ] **Step 1: Write the failing tests**

An `server/test/calc-vorrat.test.ts` anhängen (den Import aus `'../src/calc.ts'` um
`stockCarrySelfCents` ergänzen):

```ts
// ---------- Freie Schlüssel: Kosten nach Verbrauch (R2, Entwurf 8.2) ----------

const oel = plant()
const rechnung = (id: string, amountCents: number, fuelDeliveryId: string | null, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id, period: P.key, category: HEATING_CATEGORY, description: id, amountCents, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId, ...over,
})
const RECHNUNGEN = [rechnung('r1', 315000, 'd1'), rechnung('r2', 250000, 'd2')]
const shareOf = (r: ComputedSettlement, tenancyId: string, itemId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const KEY = `stock:hp:${P.key}`

test('R2: Mieter tragen 5.750 € nach Verbrauch, Übertrag „aus dem Vorrat“ +1.900 € und „im Vorrat“ −1.800 €, Gegenzeile beim Vermieter −100 €', () => {
  const r = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT()]))
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0), 575000)
  for (const t of ['ta', 'tb', 'tc']) {
    assert.equal(shareOf(r, t, `${KEY}:in`), 63333 + (t === 'ta' ? 1 : 0))
    assert.equal(shareOf(r, t, `${KEY}:out`), -60000)
  }
  const zeile = r.statements[0]?.rows.find((row) => row.costItemId === `${KEY}:in`) ?? assert.fail('kein Übertrag')
  assert.deepEqual([zeile.kind, zeile.description, zeile.category], ['fuelCarry', 'Heizöl aus dem Vorrat', HEATING_CATEGORY])
  assert.equal(r.statements[0]?.rows.find((row) => row.costItemId === `${KEY}:out`)?.description, 'Heizöl im Vorrat')
  const gegen = r.landlord.rows.find((row) => row.costItemId === KEY) ?? assert.fail('keine Gegenzeile')
  assert.deepEqual([gegen.shareCents, gegen.landlordParts], [-10000, [{ reason: 'fuelCarry', cents: -10000 }]])
  // Σ aller Zeilen = Σ der Positionen (Entwurf 12.3 Nr. 1); die Gesamtkosten sind die Rechnungen.
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 565000)
  assert.equal(r.totalCostsCents, 565000)
  // CO₂ nach dem verbrauchten Brennstoff: x_t aus Rechnungen und Überträgen, L = 518,48 €.
  assert.equal(co2ShareOf(r), 51848)
  assert.deepEqual(reliefRows(r).map(([, c]) => c).reduce((a, c) => a + c, 0), -51848)
  assert.ok(!codes(r).some((c) => c === 'fuel.manual-by-delivery' || c === 'cost.possible-duplicate'))
})

test('Steuer (G-C5, N8): privat nach Bezahltem 1.883,33 €, Abrechnung mit Übertrag rund 1.916,67 €; die Steuerseite kennt den Abstand', () => {
  const s = snap({ units: [unit('a'), unit('b'), unit('c', { participates: false, selfUsed: true, selfPersons: 1 })], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: RECHNUNGEN }, oel, [VORRAT()])
  const r = computeSettlement(s)
  // Exakt (5.650 + 100) / 3 = 1.916,67 €; je Position gerundet, Restcent bei Gleichstand an den Vermieter (#202).
  assert.ok(Math.abs(r.selfUsedShareCents - 191666.67) < 2, String(r.selfUsedShareCents))
  const tax = taxReport(s)
  const privat = tax.expenses.items.filter((x) => x.costItemId === 'r1' || x.costItemId === 'r2').reduce((a, x) => a + x.privateCents, 0)
  assert.ok(Math.abs(privat - 188333.33) < 1, String(privat))
  assert.ok(!tax.expenses.items.some((x) => x.costItemId.startsWith('stock:')), 'Überträge sind keine Werbungskosten (12.3 Nr. 10)')
  assert.equal(tax.expenses.stockCarrySelfCents, stockCarrySelfCents(r))
  // Der Abstand ist der Eigenanteil an den Überträgen, bis auf die Rundung der Positionen.
  assert.ok(Math.abs(stockCarrySelfCents(r) - (r.selfUsedShareCents - privat)) <= 1)
})

test('Ohne Bestand: nach Lieferung wie bisher, fuel.manual-by-delivery nennt beide Folgen; ohne Vorratsenergie nichts', () => {
  const ohne = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT({ closingQuantity: null })]))
  const n = ohne.notices.find((x) => x.code === 'fuel.manual-by-delivery') ?? assert.fail(codes(ohne).join(', '))
  assert.equal(n.level, 'warning')
  assert.match(n.text, /fehlt: der Endbestand\. Mietfuchs verteilt die Brennstoffrechnungen deshalb, wie sie sind, nach ihrem Schlüssel\./)
  assert.match(n.text, /eine Abrechnung nach Lieferungen ist angreifbar \(BGH VIII ZR 156\/11\)/)
  assert.match(n.text, /Auch die CO₂-Einstufung beruht dann auf den gelieferten statt den verbrauchten kg \(§ 5 Abs\. 1 CO2KostAufG\)/)
  assert.equal(ohne.statements.reduce((a, st) => a + st.totalShareCents, 0), 565000)
  assert.ok(!ohne.statements.some((st) => st.rows.some((row) => row.kind === 'fuelCarry')))
  // Pellets: keine CO₂-Aufteilung, also auch kein Satz zur Einstufung.
  assert.doesNotMatch(textOf(computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, plant({ energy: 'pellets' }), [VORRAT({ closingQuantity: null })])), 'fuel.manual-by-delivery'), /CO₂-Einstufung/)
  // Endbestand größer als alles: ein Fehler, verteilt wird wie geliefert.
  const kaputt = computeSettlement(snap({ ...drei, costItems: RECHNUNGEN }, oel, [VORRAT({ closingQuantity: 9000 })]))
  assert.equal(kaputt.notices.find((x) => x.code === 'fuel.stock-invalid')?.level, 'error')
  assert.equal(kaputt.statements.reduce((a, st) => a + st.totalShareCents, 0), 565000)
})

test('Jahr ohne Lieferung (Review Focus 4): Verbrauch aus dem Vorrat nach dem Schlüssel der Brennstoffposition der Vorperiode; ohne jede Brennstoffposition fuel.manual-by-delivery', () => {
  const vorjahr = VORRAT()
  const jahr: StockPeriodInput = { ...VORRAT(), key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900, closingMeasuredOn: '2026-12-31' }
  const P26 = calendarPeriod(2026)
  const basis = snapshotOf(source({ ...drei, costItems: [] }), 2026)
  const mitVorjahr = computeSettlement({
    ...basis, heatingPlants: [oel], co2Statements: [], stockChains: [{ plantId: 'hp', period: P26.key, chain: [vorjahr, jahr] }],
    previousCostItems: [rechnung('r2', 250000, 'd2', { key: 'persons' })],
  })
  const ta = mitVorjahr.statements.find((st) => st.tenancyId === 'ta')?.rows.find((row) => row.costItemId === `stock:hp:${P26.key}:in`)
  assert.deepEqual([ta?.key, ta?.totalCents], ['persons', 180000])
  assert.equal(mitVorjahr.statements.reduce((a, st) => a + st.totalShareCents, 0), 90000)
  const ohneSchluessel = computeSettlement({ ...basis, heatingPlants: [oel], co2Statements: [], stockChains: [{ plantId: 'hp', period: P26.key, chain: [vorjahr, jahr] }] })
  assert.match(textOf(ohneSchluessel, 'fuel.manual-by-delivery'), /gibt es keinen Schlüssel: In dieser Heizperiode und der vorigen steht keine Brennstoffposition/)
})

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invarianten (Entwurf 12.3 Nr. 1, 2, 10): Summe über die Gegenzeile, je Zeile ≤ 1 ct, Überträge nie in der Steuer', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 200; lauf++) {
    const n = int(1, 4)
    const units = Array.from({ length: n }, (_, i) => unit(`u${i}`, { areaM2: int(30, 120) }))
    if (rnd() < 0.4) units.push(unit('eigen', { participates: false, selfUsed: true, selfPersons: 1, areaM2: int(30, 120) }))
    if (rnd() < 0.4) units.push(unit('leer', { areaM2: int(30, 120) }))
    const tenancies = units.filter((u) => u.participates && u.id !== 'leer').map((u) => tenancy(`t-${u.id}`, u.id))
    const q0 = int(0, 3000)
    const deliveries = Array.from({ length: int(0, 2) }, (_, k) => {
      const q = int(500, 4000)
      return lieferung(`d${k}`, `2025-0${k + 3}-15`, q, q * int(80, 130), Math.round(q * 267.63) / 100, int(5000, 60000))
    })
    const total = q0 + deliveries.reduce((a, d) => a + (d.quantity ?? 0), 0)
    const chain = [VORRAT({ ownOpening: { quantity: q0, costCents: q0 * int(80, 120), emissionsKg: Math.round(q0 * 267.6) / 100, co2Cents: 0, invoicedBefore2023: true }, deliveries, closingQuantity: int(0, total) })]
    const items = deliveries.map((d) => rechnung(`r-${d.id}`, d.costCents ?? 0, d.id))
    const s = snap({ units, tenancies, costItems: items }, oel, chain)
    const r = computeSettlement(s)
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, q0, total })}`
    const positions = items.reduce((a, c) => a + c.amountCents, 0)
    // Nr. 1: Σ aller Zeilen = Σ der Positionen, über die Gegenzeile fuelCarry.
    assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, positions, fall)
    // Nr. 2: Mieterzeilen der Überträge dürfen negativ sein; alle übrigen nicht bei positiven Kosten.
    for (const st of r.statements) for (const row of st.rows) if (row.kind !== 'fuelCarry' && row.kind !== 'co2Relief') assert.ok(row.shareCents >= 0, `${fall}: ${row.costItemId}`)
    // Nr. 10: Überträge nie in der Steuerübersicht, jede Position genau einmal.
    const tax = taxReport(s)
    assert.ok(!tax.expenses.items.some((x) => x.costItemId.startsWith('stock:')), fall)
    assert.deepEqual(tax.expenses.items.map((x) => x.costItemId).filter((id) => id.startsWith('r-')).sort(), items.map((c) => c.id).sort(), fall)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-vorrat.test.ts`
Expected: FAIL. Es gibt keine Zeilen `stock:…`, keine Gegenzeile, `stockCarrySelfCents` ist nicht
exportiert, und `fuel.manual-by-delivery` fehlt.

- [ ] **Step 3: Code und Übertragsposten (`server/src/calc.ts`)**

In `noticeKinds` hinter `'fuel.stock-date-differs'`:

```ts
  'fuel.manual-by-delivery': { level: 'warning', title: 'Heizkosten nach Lieferung statt nach Verbrauch', rule: 'heating-consumed-fuel', terms: ['fuelStock', 'co2Stage'] },
```

Direkt hinter dem Block „Brennstoffvorrat“ aus Task 6 (hinter der Schleife, die `stockOfPlant`
füllt):

```ts
  // Übertragsposten bei freien Schlüsseln (Heizung PR 8, Entwurf 8.2 „Wie das in die Abrechnung
  // kommt“). Die Rechnungen bleiben Positionen in voller Höhe, Steuer und Belegarchiv stimmen damit.
  // Den Unterschied zum Verbrauch tragen zwei Posten, „aus dem Vorrat“ (+ Wert des Anfangsbestands) und
  // „im Vorrat“ (− Wert des Endbestands), verteilt mit dem Schlüssel der Brennstoffposition; ihre
  // Gegenzeile beim Vermieter (`fuelCarry`) gleicht die Summe aus. Sie sind keine Positionen: nicht in
  // den Gesamtkosten, nicht in der Steuerübersicht, nicht beim Hinweis auf doppelte Rechnungen.
  //
  // Der Schlüssel (Festlegung 5 des Plans): die Brennstoffposition dieser Heizperiode mit dem größten
  // Betrag, sonst die jüngste der Vorperiode; Einzelbeträge und „laut Gemeinschaftsabrechnung“ taugen
  // nicht, denn sie nennen feste Beträge. Ohne Schlüssel gilt „ohne Bestand“.
  const FUEL_KEYS: readonly CostKey[] = ['area', 'persons', 'units', 'meter', 'direct', 'custom']
  const FUEL_NAMES: Partial<Record<HeatingEnergy, string>> = { oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Pellets', wood: 'Holz', coal: 'Kohle' }
  const stockCarry: SnapshotCostItem[] = []
  const stockCarryNet = new Map<string, number>()
  const stockManualNotes: { plant: SnapshotHeatingPlant; text: string; invalid: boolean }[] = []
  for (const [plantId, entry] of stockOfPlant) {
    if (entry.plant.method !== 'manual') continue
    const isFuel = (c: SnapshotCostItem): boolean =>
      c.category === HEATING_CATEGORY && c.heatingPlantId === plantId && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null) && FUEL_KEYS.includes(c.key)
    const mine = items.filter((c) => c.category === HEATING_CATEGORY && c.heatingPlantId === plantId)
    if (!entry.result.ok) {
      if (stockTouched(entry.chain) || mine.length > 0) {
        stockManualNotes.push({ plant: entry.plant, text: problemText(entry.result.problem), invalid: entry.result.problem.kind === 'invalid' })
      }
      continue
    }
    const largest = items.filter(isFuel).reduce<SnapshotCostItem | null>((a, c) => (a === null || c.amountCents > a.amountCents ? c : a), null)
    const template = largest ?? (snapshot.previousCostItems ?? []).filter(isFuel).at(-1) ?? null
    if (!template) {
      stockManualNotes.push({ plant: entry.plant, text: 'Für den Verbrauch aus dem Vorrat gibt es keinen Schlüssel: In dieser Heizperiode und der vorigen steht keine Brennstoffposition dieser Heizanlage.', invalid: false })
      continue
    }
    const s = entry.result.statement
    const opening = s.opening.costCents ?? 0
    const closing = s.closing.costCents ?? 0
    const name = FUEL_NAMES[entry.plant.energy] ?? 'Brennstoff'
    const make = (suffix: 'in' | 'out', description: string, cents: number): SnapshotCostItem => ({
      ...template,
      id: `stock:${plantId}:${snapshot.period.key}:${suffix}`,
      period: snapshot.period.key,
      description,
      amountCents: cents,
      labor35aCents: null,
      heatingPlantId: plantId,
      heatingPart: 'fuel',
      fuelDeliveryId: null,
      serviceFrom: null,
      serviceTo: null,
    })
    if (opening !== 0) stockCarry.push(make('in', `${name} aus dem Vorrat`, opening))
    if (closing !== 0) stockCarry.push(make('out', `${name} im Vorrat`, -closing))
    stockCarryNet.set(plantId, opening - closing)
  }
  const stockCarryIds = new Set(stockCarry.map((c) => c.id))
```

(`CostKey`, `HeatingEnergy` in den Typimport aus `'../../shared/types.ts'` aufnehmen, falls nicht
da.) Fehlt eines der Felder `labor35aCents`, `serviceFrom`, `serviceTo` in `SnapshotCostItem`, meldet
der Übersetzer es als überzählig; dann fällt genau diese Zeile in `make` weg.

`co2PotsOf(snapshot, items)` (PR 6) wird `co2PotsOf(snapshot, [...items, ...stockCarry])`: Die
Überträge gehören zum Topf ihrer Anlage und zählen mit `heatingPart: 'fuel'` zu den
Brennstoffpositionen, nach denen x_t bei freien Schlüsseln gerechnet wird (9.4, A9).

In der Schleife über die Positionen:

- `for (const item of items)` wird `for (const item of [...items, ...stockCarry])`;
- direkt am Anfang des Rumpfs `const carry = stockCarryIds.has(item.id)`;
- `totalCostsCents += item.amountCents` wird `if (!carry) totalCostsCents += item.amountCents`;
- `const keyChange = keyChangeText(…)` wird `const keyChange = carry ? null : keyChangeText(…)`
  (Argumente unverändert);
- im Objekt, das `st.rows.push({ … })` schreibt, hinter `steps,`: `...(carry ? { kind: 'fuelCarry' as const } : {}),`.

Direkt hinter der Schleife, vor `notices.splice(tvAt, 0, ...tvNotices())`:

```ts
  // Die Gegenzeile der Überträge beim Vermieter (Heizung PR 8): Sie gleicht aus, was die Überträge den
  // Mietern und den übrigen Gründen beim Vermieter zugerechnet haben. Ohne Position, Betrag 0.
  for (const [plantId, net] of stockCarryNet) {
    if (net === 0) continue
    landlordRows.push({
      costItemId: `stock:${plantId}:${snapshot.period.key}`,
      category: HEATING_CATEGORY,
      description: 'Übertrag aus dem Brennstoffvorrat',
      totalCents: 0,
      keyLabel: 'Bestandsrechnung',
      shareCents: -net,
      landlordParts: [{ reason: 'fuelCarry', cents: -net }],
    })
  }
  // Ohne Bestand oder ohne Schlüssel (Entwurf 8.2 „Ohne Bestand“, N9): verteilt wird nach Lieferung wie
  // bisher; der Text nennt beide Folgen.
  for (const n of stockManualNotes) {
    const where = `${n.plant.name ? `Heizanlage „${n.plant.name}“` : 'Heizanlage'}, Heizperiode ${periodLabel(snapshot.period)}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: n.plant.id }
    const co2 = CO2_FUELS.includes(n.plant.energy) ? ' Auch die CO₂-Einstufung beruht dann auf den gelieferten statt den verbrauchten kg (§ 5 Abs. 1 CO2KostAufG).' : ''
    if (n.invalid) {
      warn('fuel.stock-invalid',
        `${where}: ${n.text} Bis das geklärt ist, verteilt Mietfuchs die Brennstoffrechnungen, wie sie sind, nach ihrem Schlüssel; umzulegen sind aber die Kosten des verbrauchten Brennstoffs (§ 7 Abs. 2 HeizkostenV).${co2} Bitte prüfen Sie den Vorrat und die Lieferungen auf der Seite Heizkosten.`,
        subject)
    } else {
      warn('fuel.manual-by-delivery',
        `${where}: ${n.text} Mietfuchs verteilt die Brennstoffrechnungen deshalb, wie sie sind, nach ihrem Schlüssel. Umzulegen sind aber die Kosten des verbrauchten Brennstoffs (§ 7 Abs. 2 HeizkostenV); eine Abrechnung nach Lieferungen ist angreifbar (BGH VIII ZR 156/11).${co2} ` +
          'Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein.',
        subject)
    }
  }
```

(`periodLabel` und `NoticeSubject` importiert calc.ts seit PR 6.)

- [ ] **Step 4: Steuer (`server/src/calc.ts`)**

Vor `export function taxReport`:

```ts
// Eigenanteil an den Überträgen aus dem Brennstoffvorrat einer Abrechnung (Heizung PR 8, N8). Die
// Überträge sind keine Positionen; die Steuerübersicht nimmt das Bezahlte (6.4 Nr. 1, G-C5), die
// Abrechnung den Verbrauch, und um diesen Betrag liegen beide beim Eigenanteil auseinander.
export function stockCarrySelfCents(settlement: Pick<ComputedSettlement, 'landlord'>): number {
  return settlement.landlord.rows
    .filter((r) => r.costItemId.startsWith('stock:'))
    .reduce((a, r) => a + (r.landlordParts ?? []).filter((p) => p.reason === 'selfUse').reduce((b, p) => b + p.cents, 0), 0)
}
```

In `taxReport` hinter `const settled = used.map(…)` (PR 3):

```ts
  const stockCarrySelf = settled.reduce((a, { settlement }) => a + stockCarrySelfCents(settlement), 0)
```

und im zurückgegebenen `expenses` hinter `labor35aCents: …,`:

```ts
      ...(stockCarrySelf !== 0 ? { stockCarrySelfCents: stockCarrySelf } : {}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-vorrat.test.ts test/calc.test.ts test/calc-co2.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS (`calc-vorrat.test.ts`: 9 Tests).

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS. Ein bestehender Test, der eine Anlage mit `energy: 'oil'`, `'lpg'`, `'pellets'`,
`'wood'` oder `'coal'` und `method: 'manual'` samt Heizposition über das ganze Ergebnis vergleicht (PR 4 bis PR 7),
sieht jetzt `fuel.manual-by-delivery`. Er bekommt den Code in seine Erwartung bzw. vergleicht mit
`withoutCo2` und filtert zusätzlich `fuel.manual-by-delivery`; jede andere Abweichung ist ein Befund.

```bash
git add server/src/calc.ts server/test/calc-vorrat.test.ts server/test
git commit -m "Freie Schlüssel mit Vorrat: Heizkosten nach Verbrauch mit Übertrag aus dem und in den Vorrat

Die Rechnungen bleiben Positionen, die Überträge werden mit dem Schlüssel der Brennstoffposition
verteilt, ihre Gegenzeile steht beim Vermieter. Ohne Bestand wie bisher mit fuel.manual-by-delivery.
Die Steuerübersicht bleibt beim Bezahlten und nennt den Abstand beim Eigenanteil.

Refs #97, #99"
```

---
### Task 8: Oberfläche: Karte „Vorrat“, Druckblock „Bestandsrechnung“, Steuerseite

Die Karte „Vorrat“ auf der Seite Heizkosten (Entwurf 11.4: „Kosten und Brennstoff (mit Lieferungen,
Abgrenzung je Stufe, Vorrat)“) für Anlagen mit Vorratsenergie, bei freien Schlüsseln und beim
Messdienst ohne Aufteilung. Der Druckblock „Bestandsrechnung“ gehört zu den Grundlagen des Ausweises
(9.5) und erklärt die Zeilen „aus dem Vorrat“ und „im Vorrat“; er ist nicht `no-print`. Die
Steuerseite nennt den Abstand beim Eigenanteil (N8). Die Logik liegt DOM-frei in `stockForm.ts`,
`stockView.ts` und `taxView.ts`; ein jsdom-Test prüft, dass die Auswahl den gespeicherten Wert zeigt.

**Files:**
- Create: `client/src/stockForm.ts`, `client/src/components/StockCard.tsx`, `client/src/stockView.ts`, `client/src/components/StockBlock.tsx`
- Modify: `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/taxView.ts`, `client/src/pages/Steuer.tsx`
- Test: `client/src/stockForm.test.ts` (neu), `client/src/components/StockCard.test.tsx` (neu), `client/src/stockView.test.ts` (neu), `client/src/taxView.test.ts`

**Interfaces:**
- Consumes (Task 1–7): `StockView`, `StockUnit`, `HeatingStockStatement`, `HeatingStatement`, `HeatingPeriodView`, `TaxReport`; `STOCK_UNIT_LABELS`, `STOCK_UNIT_TEXT`, `isStockEnergy`; `co2CostsCountedFrom`, `germanDate`; Routen `…/periods/:period/stock`; `parseDecimal` (co2Form.ts, PR 6); `api`, `errorText`, `fmtEuro`, `fmtDate`, `parseEuro`; `Term`, `useToast`, `useConfirm`.
- Produces:
  - `stockForm.ts`: `STOCK_UNIT_OPTIONS`, `type Before2023 = '' | 'yes' | 'no'`, `BEFORE_2023_OPTIONS`, `type StockForm`, `stockToForm(view)`, `stockBody(form, view)`, `stockSummary(view): string[]`, `showsStockCard(plant, view): boolean`
  - `stockView.ts`: `type StockBlockView = { title: string; lines: { label: string; value: string }[]; notes: string[] }`, `stockBlock(h): StockBlockView | null`, `showsStock(h, st): boolean`
  - `taxView.ts`: `stockCarryNote(report): string | null`
  - Komponenten `StockCard({ view, onSaved })`, `StockBlock({ view })`

- [ ] **Step 1: Write the failing tests**

`client/src/stockForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { BEFORE_2023_OPTIONS, STOCK_UNIT_OPTIONS, showsStockCard, stockBody, stockSummary, stockToForm } from './stockForm'
import { periodKey } from '../../shared/period.ts'
import type { HeatingStockStatement, StockView } from './types'

const leer: StockView = {
  row: { stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, closingQuantity: null, closingMeasuredOn: null },
  derived: null, statement: null, problem: 'Für die Bestandsrechnung (Heizperiode 2025) fehlt: die Einheit des Vorrats, der Anfangsbestand und der Endbestand.',
}
const BESTAND: HeatingStockStatement = {
  unit: 'l', openingSource: 'own', closingMeasuredOn: '2025-12-31', paidCents: 565000, oldStockKg: 5352.6,
  opening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, layers: [] },
  deliveries: [{ label: 'Lieferung vom 15.03.2025', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549, co2Counted: true }],
  closing: { quantity: 1800, costCents: 180000, emissionsKg: 4817.34, co2Cents: 31530, layers: [] },
  consumed: { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 },
}

test('Leere Heizperiode: keine Vorauswahl; Einheit Pflicht, sobald eine Menge dasteht', () => {
  const f = stockToForm(leer)
  expect([f.unit, f.openingQuantity, f.before2023, f.closingQuantity, f.measuredOn]).toEqual(['', '', '', '', ''])
  expect(STOCK_UNIT_OPTIONS.map((o) => o.value)).toEqual(['', 'l', 'kg', 'srm'])
  expect(BEFORE_2023_OPTIONS[1]?.label).toBe('Ja, vor dem 01.01.2023 in Rechnung gestellt')
  expect(stockBody({ ...f, closingQuantity: '1800' }, leer)).toEqual({ error: 'Bitte wählen Sie die Einheit des Vorrats.' })
})

test('Erste Heizperiode: Anfangsbestand mit Wert, kg, CO₂-Kosten und Frage nach 2023; deutsche Schreibweise', () => {
  const f = { ...stockToForm(leer), unit: 'l' as const, openingQuantity: '2000', openingCost: '1.900,00', openingKg: '5352,6', openingCo2: '0', before2023: 'yes' as const, closingQuantity: '1800', measuredOn: '2025-12-31' }
  expect(stockBody(f, leer)).toEqual({
    body: {
      stockUnit: 'l', closingQuantity: 1800, closingMeasuredOn: '2025-12-31', openingQuantity: 2000, openingCostCents: 190000,
      openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true,
    },
  })
  expect(stockBody({ ...f, openingQuantity: 'viel' }, leer)).toEqual({ error: 'Bitte prüfen Sie „Anfangsbestand“: keine Zahl ab 0.' })
})

test('Folgeperiode: Der Anfangsbestand kommt aus der Vorperiode und wird nicht geschickt', () => {
  const folge: StockView = { ...leer, derived: { value: BESTAND.closing, period: periodKey('2025-01'), label: '2025', frozen: true } }
  const r = stockBody({ ...stockToForm(folge), unit: 'l', closingQuantity: '900' }, folge)
  expect(r).toEqual({ body: { stockUnit: 'l', closingQuantity: 900, closingMeasuredOn: null } })
})

test('Zusammenfassung und wann die Karte erscheint', () => {
  expect(stockSummary({ ...leer, statement: BESTAND })).toEqual([
    `Anfangsbestand 2.000 l · ${fmtEuro(190000)}`,
    `Lieferung vom 15.03.2025: 3.000 l · ${fmtEuro(315000)}`,
    `Endbestand 1.800 l · ${fmtEuro(180000)} (zu den jüngsten Lieferungen bewertet)`,
    `Verbraucht 5.700 l · ${fmtEuro(575000)} · 15.254,91 kg CO₂ · CO₂-Kosten ${fmtEuro(64810)}`,
  ])
  // Gespeicherte Mengen gehen ohne Tausenderpunkt ins Formular, damit sie unverändert zurückkommen.
  expect(stockToForm({ ...leer, row: { ...leer.row, openingQuantity: 2000, openingEmissionsKg: 5352.6 } })).toMatchObject({ openingQuantity: '2000', openingKg: '5352,6' })
  const v = (co2Method: 'selfAfterService' | 'serviceDeducted' | null) => ({ stock: leer, co2: co2Method === null ? null : { method: co2Method } })
  expect(showsStockCard({ method: 'manual' }, v(null))).toBe(true)
  expect(showsStockCard({ method: 'service' }, v('selfAfterService'))).toBe(true)
  expect(showsStockCard({ method: 'service' }, v('serviceDeducted'))).toBe(false)
  expect(showsStockCard({ method: 'manual' }, { stock: null, co2: null })).toBe(false)
})
```

`client/src/components/StockCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „Vorrat“ (Heizung PR 8): Die Auswahl zeigt den gespeicherten Wert, eine Folgeperiode zeigt
// den Anfangsbestand aus der Vorperiode statt Eingabefeldern, und Speichern schickt die Felder.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import StockCard from './StockCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, StockView } from '../types'

const STOCK: StockView = {
  row: { stockUnit: 'kg', openingQuantity: 1000, openingCostCents: 30000, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, closingQuantity: 400, closingMeasuredOn: null },
  derived: null, statement: null, problem: null,
}
const view = (stock: StockView): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null, items: [], deliveries: [], stock,
})
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(STOCK), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const einheit = (): HTMLSelectElement => {
  const el = screen.getByLabelText('Einheit des Vorrats')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl zeigt die gespeicherte Einheit; Speichern schickt sie an die Heizperiode', async () => {
  const saved = vi.fn()
  render(<StockCard view={view(STOCK)} onSaved={saved} />)
  expect(einheit().value).toBe('kg')
  expect(einheit().selectedOptions[0]?.textContent).toBe('Kilogramm')
  fireEvent.click(screen.getByText('Vorrat speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/stock')
  expect(sent[0]?.body).toMatchObject({ stockUnit: 'kg', openingQuantity: 1000, closingQuantity: 400 })
})

test('Folgeperiode: Anfangsbestand aus der Vorperiode, keine Eingabefelder dafür', () => {
  render(<StockCard view={view({ ...STOCK, derived: { value: { quantity: 400, costCents: 12000, emissionsKg: 0, co2Cents: 0, layers: [] }, period: periodKey('2024-01'), label: '2024', frozen: true } })} onSaved={() => {}} />)
  expect(screen.getByText(/Anfangsbestand aus dem Endbestand der Heizperiode 2024 \(abgeschlossen\)/)).toBeTruthy()
  expect(screen.queryByLabelText('Anfangsbestand (Menge)')).toBeNull()
})
```

`client/src/stockView.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { showsStock, stockBlock } from './stockView'
import { periodKey } from '../../shared/period.ts'
import type { HeatingStatement, Statement } from './types'

const anlage = (stock: HeatingStatement['stock']): HeatingStatement => ({
  plantId: 'hp', plantName: 'Öl', energy: 'oil', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2: null, stock,
})
const BESTAND: NonNullable<HeatingStatement['stock']> = {
  unit: 'l', openingSource: 'frozen', closingMeasuredOn: '2026-01-05', paidCents: 565000, oldStockKg: 5352.6,
  opening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, layers: [] },
  deliveries: [{ label: 'Lieferung vom 15.03.2025', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549, co2Counted: true }],
  closing: { quantity: 1800, costCents: 180000, emissionsKg: 4817.34, co2Cents: 31530, layers: [] },
  consumed: { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 },
}

test('Druckblock Bestandsrechnung (Entwurf 9.5, 8.2): Anfang, Lieferungen, Ende, Verbrauch, Bewertung und Altbestand', () => {
  const v = stockBlock(anlage(BESTAND)) ?? (() => { throw new Error('kein Block') })()
  expect(v.title).toBe('Bestandsrechnung Brennstoff')
  expect(v.lines.map((l) => l.label)).toEqual(['Anfangsbestand', 'Lieferung vom 15.03.2025', 'Endbestand (gepeilt am 05.01.2026)', 'Verbraucht'])
  expect(v.lines[3]?.value).toBe(`5.700 l · ${fmtEuro(575000)} · 15.254,91 kg CO₂ · CO₂-Kosten ${fmtEuro(64810)}`)
  expect(v.notes).toContain('Verbraucht wird das Älteste zuerst; den Endbestand bewertet Mietfuchs wie die Messdienste zu den Preisen der jüngsten Lieferungen.')
  expect(v.notes).toContain('Davon 5.352,6 kg CO₂ aus Brennstoff mit Rechnung vor dem 01.01.2023: Sie zählen für die Einstufung, CO₂-Kosten trägt er nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG).')
  expect(v.notes).toContain('Der Anfangsbestand ist der eingefrorene Endbestand der abgeschlossenen Vorperiode.')
  expect(stockBlock(anlage(null))).toBeNull()
})

test('Der Block steht beim Mieter, der einen Übertrag oder einen CO₂-Abzug dieser Anlage hat', () => {
  const st = (ids: string[]): Pick<Statement, 'tenancyId' | 'rows'> => ({
    tenancyId: 'ta',
    rows: ids.map((costItemId) => ({ costItemId, category: 'Heizung und Warmwasser', description: '', totalCents: 0, keyLabel: '', shareCents: 0 })),
  })
  expect(showsStock(anlage(BESTAND), st(['stock:hp:2025-01:in']))).toBe(true)
  expect(showsStock(anlage(BESTAND), st(['r1']))).toBe(false)
  const bewertung: NonNullable<HeatingStatement['co2']> = {
    method: 'selfAfterService', booked: true, deducted: false, totalCents: null, landlordCents: null, landlordPermille: null, kgPerM2: null,
    emissionsKg: null, areaM2: null, stage: null, table: [], shortened: false, selfLandlordCents: null, selfApproximated: false,
    tenants: [{ tenancyId: 'ta', landlordCents: 1, tenantCents: null, approximated: true }],
  }
  expect(showsStock({ ...anlage(BESTAND), co2: bewertung }, st([]))).toBe(true)
})
```

Hat PR 7 `Co2Assessment` um Felder ergänzt, nennt der Übersetzer sie in `bewertung`; sie kommen mit
`null` dazu.

`client/src/taxView.test.ts`: den Import aus `'./taxView'` um `stockCarryNote` ergänzen,
`import { fmtEuro } from './api'` ergänzen und anhängen (der Helfer `report(income, rest)` steht am
Anfang der Datei, sein Jahr ist 2025):

```ts
describe('Vorrat (Heizung PR 8, N8)', () => {
  it('erklärt den Abstand beim Eigenanteil in beide Richtungen', () => {
    const mit = (cents: number) => report({}, { expenses: { ...report({}).expenses, stockCarrySelfCents: cents } })
    const tail = 'Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.'
    expect(stockCarryNote(mit(3333))).toBe(`${fmtEuro(3333)} Unterschied zum Eigenanteil der Abrechnung: Brennstoff aus dem Vorrat, steuerlich bereits 2024 oder früher abgeflossen. ${tail}`)
    expect(stockCarryNote(mit(-500))).toBe(`${fmtEuro(500)} Unterschied zum Eigenanteil der Abrechnung: Brennstoff, der im Vorrat bleibt, steuerlich 2025 abgeflossen und erst später verbraucht. ${tail}`)
    expect(stockCarryNote(report({}))).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- stockForm StockCard stockView taxView`
Expected: FAIL mit `Failed to resolve import "./stockForm"`, `"./StockCard"`, `"./stockView"` und
`stockCarryNote is not a function`.

- [ ] **Step 3: Logik (`client/src/stockForm.ts`, `client/src/stockView.ts`, `client/src/taxView.ts`)**

`client/src/stockForm.ts`:

```ts
// Die Karte „Vorrat“ der Seite Heizkosten (Heizung PR 8, Entwurf 8.2, 11.4), ohne DOM. Den
// Anfangsbestand fragt sie nur in der ersten Heizperiode mit Vorrat; danach ist er der Endbestand der
// Vorperiode, und die Karte zeigt ihn nur an.
import { fmtEuro, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { STOCK_UNIT_LABELS, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { Co2Method, HeatingMethod, StockUnit, StockView } from './types'

export const STOCK_UNIT_OPTIONS: readonly { value: StockUnit | ''; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'l', label: STOCK_UNIT_LABELS.l },
  { value: 'kg', label: STOCK_UNIT_LABELS.kg },
  { value: 'srm', label: STOCK_UNIT_LABELS.srm },
]
export type Before2023 = '' | 'yes' | 'no'
const FROM = germanDate(co2CostsCountedFrom())
export const BEFORE_2023_OPTIONS: readonly { value: Before2023; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'yes', label: `Ja, vor dem ${FROM} in Rechnung gestellt` },
  { value: 'no', label: `Nein, ab dem ${FROM} in Rechnung gestellt` },
]

export type StockForm = {
  unit: StockUnit | ''
  openingQuantity: string
  openingCost: string
  openingKg: string
  openingCo2: string
  before2023: Before2023
  closingQuantity: string
  measuredOn: string
}

// Ohne Tausenderpunkt: `parseDecimal` liest „1.000“ als technische Schreibweise (1), und eine
// gespeicherte Menge muss unverändert zurückkommen.
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }))
const centsText = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function stockToForm(view: StockView): StockForm {
  const r = view.row
  return {
    unit: r.stockUnit ?? '',
    openingQuantity: numberText(r.openingQuantity),
    openingCost: centsText(r.openingCostCents),
    openingKg: numberText(r.openingEmissionsKg),
    openingCo2: centsText(r.openingCo2Cents),
    before2023: r.openingInvoicedBefore2023 === null ? '' : r.openingInvoicedBefore2023 ? 'yes' : 'no',
    closingQuantity: numberText(r.closingQuantity),
    measuredOn: r.closingMeasuredOn ?? '',
  }
}

export function stockBody(form: StockForm, view: StockView): { body: Record<string, unknown> } | { error: string } {
  const errors: string[] = []
  const quantity = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    if (n === null || n < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: keine Zahl ab 0.`)
      return null
    }
    return n
  }
  const money = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    if (c === null || c < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: kein Betrag ab 0 €.`)
      return null
    }
    return c
  }
  const body: Record<string, unknown> = {
    stockUnit: form.unit === '' ? null : form.unit,
    closingQuantity: quantity(form.closingQuantity, 'Endbestand'),
    closingMeasuredOn: form.measuredOn === '' ? null : form.measuredOn,
  }
  if (view.derived === null) {
    body.openingQuantity = quantity(form.openingQuantity, 'Anfangsbestand')
    body.openingCostCents = money(form.openingCost, 'Wert des Anfangsbestands')
    body.openingEmissionsKg = quantity(form.openingKg, 'CO₂ des Anfangsbestands (kg)')
    body.openingCo2Cents = money(form.openingCo2, 'CO₂-Kosten des Anfangsbestands')
    body.openingInvoicedBefore2023 = form.before2023 === '' ? null : form.before2023 === 'yes'
  }
  const first = errors[0]
  if (first) return { error: first }
  if (form.unit === '' && (body.closingQuantity !== null || (body.openingQuantity ?? null) !== null)) return { error: 'Bitte wählen Sie die Einheit des Vorrats.' }
  return { body }
}

// Die Zeilen unter der Karte: was da war, was kam, was übrig ist und was verbraucht wurde.
export function stockSummary(view: StockView): string[] {
  const s = view.statement
  if (!s) return []
  const q = (n: number): string => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[s.unit]}`
  const euro = (c: number | null): string => (c === null ? 'Betrag unbekannt' : fmtEuro(c))
  const kg = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
  return [
    `Anfangsbestand ${q(s.opening.quantity)} · ${euro(s.opening.costCents)}`,
    ...s.deliveries.map((d) => `${d.label}: ${q(d.quantity)} · ${euro(d.costCents)}`),
    `Endbestand ${q(s.closing.quantity)} · ${euro(s.closing.costCents)} (zu den jüngsten Lieferungen bewertet)`,
    `Verbraucht ${q(s.consumed.quantity)} · ${euro(s.consumed.costCents)} · ${kg(s.consumed.emissionsKg)} kg CO₂ · CO₂-Kosten ${fmtEuro(s.consumed.co2Cents)}`,
  ]
}

// Die Karte erscheint bei freien Schlüsseln und beim Messdienst ohne Aufteilung; mit Abzugszeile oder
// Ausweis führt der Messdienst den Bestand selbst (Entwurf 8.2).
export function showsStockCard(plant: { method: HeatingMethod }, view: { stock: StockView | null; co2: { method: Co2Method } | null }): boolean {
  if (view.stock === null) return false
  return plant.method === 'manual' || (plant.method === 'service' && view.co2?.method === 'selfAfterService')
}
```

`client/src/stockView.ts`:

```ts
// Der Druckblock „Bestandsrechnung Brennstoff“ (Heizung PR 8, Entwurf 8.2, 9.5). Er gehört zu den
// Berechnungsgrundlagen des Ausweises nach § 7 Abs. 3 CO2KostAufG und erklärt die Zeilen „aus dem
// Vorrat“ und „im Vorrat“; gedruckt wird er mit.
import { fmtDate, fmtEuro } from './api'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { HeatingStatement, Statement } from './types'

export type StockBlockView = { title: string; lines: { label: string; value: string }[]; notes: string[] }

const amount = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

export function stockBlock(h: HeatingStatement): StockBlockView | null {
  const s = h.stock
  if (!s) return null
  const q = (n: number): string => `${amount(n)} ${STOCK_UNIT_TEXT[s.unit]}`
  const euro = (c: number | null): string => (c === null ? 'Betrag unbekannt' : fmtEuro(c))
  const lines = [
    { label: 'Anfangsbestand', value: `${q(s.opening.quantity)} · ${euro(s.opening.costCents)}` },
    ...s.deliveries.map((d) => ({ label: d.label, value: `${q(d.quantity)} · ${euro(d.costCents)}` })),
    {
      label: s.closingMeasuredOn && s.closingMeasuredOn !== h.to ? `Endbestand (gepeilt am ${fmtDate(s.closingMeasuredOn)})` : 'Endbestand',
      value: `${q(s.closing.quantity)} · ${euro(s.closing.costCents)}`,
    },
    { label: 'Verbraucht', value: `${q(s.consumed.quantity)} · ${euro(s.consumed.costCents)} · ${amount(s.consumed.emissionsKg)} kg CO₂ · CO₂-Kosten ${fmtEuro(s.consumed.co2Cents)}` },
  ]
  const notes = ['Verbraucht wird das Älteste zuerst; den Endbestand bewertet Mietfuchs wie die Messdienste zu den Preisen der jüngsten Lieferungen.']
  if (s.oldStockKg > 0) {
    notes.push(`Davon ${amount(s.oldStockKg)} kg CO₂ aus Brennstoff mit Rechnung vor dem ${germanDate(co2CostsCountedFrom())}: Sie zählen für die Einstufung, CO₂-Kosten trägt er nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG).`)
  }
  if (s.openingSource === 'frozen') notes.push('Der Anfangsbestand ist der eingefrorene Endbestand der abgeschlossenen Vorperiode.')
  return { title: 'Bestandsrechnung Brennstoff', lines, notes }
}

// Beim Mieter steht der Block, wenn er einen Übertrag dieser Anlage trägt oder einen CO₂-Abzug aus ihr.
export function showsStock(h: HeatingStatement, st: Pick<Statement, 'tenancyId' | 'rows'>): boolean {
  if (!h.stock) return false
  const prefix = `stock:${h.plantId}:${h.period}:`
  return st.rows.some((r) => r.costItemId.startsWith(prefix)) || (h.co2?.tenants.some((t) => t.tenancyId === st.tenancyId) ?? false)
}
```

`client/src/taxView.ts` anhängen:

```ts
// Heizung PR 8 (N8): Die Abrechnung rechnet den Brennstoff nach Verbrauch, die Steuerübersicht nach
// Bezahltem. Beim Eigenanteil liegen beide genau um den Eigenanteil am Übertrag aus dem Vorrat
// auseinander; der Satz erklärt die Richtung.
export function stockCarryNote(report: TaxReport): string | null {
  const c = report.expenses.stockCarrySelfCents ?? 0
  if (c === 0) return null
  const tail = 'Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.'
  return c > 0
    ? `${fmtEuro(c)} Unterschied zum Eigenanteil der Abrechnung: Brennstoff aus dem Vorrat, steuerlich bereits ${report.year - 1} oder früher abgeflossen. ${tail}`
    : `${fmtEuro(-c)} Unterschied zum Eigenanteil der Abrechnung: Brennstoff, der im Vorrat bleibt, steuerlich ${report.year} abgeflossen und erst später verbraucht. ${tail}`
}
```

(`fmtEuro` importiert taxView.ts aus `'./api'`, falls noch nicht.)

- [ ] **Step 4: Komponenten**

`client/src/components/StockCard.tsx`:

```tsx
// Die Karte „Vorrat“ einer Heizperiode (Heizung PR 8, Entwurf 8.2, 11.4). Die Logik steht in
// stockForm.ts; hier wird nur gezeigt und gespeichert.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { BEFORE_2023_OPTIONS, STOCK_UNIT_OPTIONS, stockBody, stockSummary, stockToForm, type StockForm } from '../stockForm'
import type { HeatingPeriodView } from '../types'

type TextKey = 'openingQuantity' | 'openingCost' | 'openingKg' | 'openingCo2' | 'closingQuantity'

export default function StockCard({ view, onSaved }: { view: HeatingPeriodView; onSaved: () => void }) {
  const stock = view.stock
  const [form, setForm] = useState<StockForm | null>(() => (stock ? stockToForm(stock) : null))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  if (!stock || !form) return null
  const set = <K extends keyof StockForm>(key: K, value: StockForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const url = `/api/heating-plants/${view.plantId}/periods/${view.period}/stock`

  async function save() {
    if (!stock || !form) return
    const r = stockBody(form, stock)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setBusy(true)
    try {
      await api(url, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('Vorrat gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({ title: 'Vorrat entfernen?', message: 'Die Abrechnung rechnet diese Heizperiode dann wieder nach Lieferungen.', confirmLabel: 'Entfernen', danger: true })
    if (!ok) return
    try {
      await api(url, { method: 'DELETE' })
      toast('Vorrat entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const text = (key: TextKey, label: string) => (
    <label className="field">
      {label}
      <input aria-label={label} value={form[key]} inputMode="decimal" disabled={view.closed} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2>Vorrat <Term id="fuelStock" /></h2>
      {view.closed && <p className="muted">Diese Heizperiode ist abgeschlossen; der Vorrat lässt sich nicht mehr ändern.</p>}
      <label className="field">
        Einheit
        <select aria-label="Einheit des Vorrats" value={form.unit} disabled={view.closed} onChange={(e) => set('unit', STOCK_UNIT_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
          {STOCK_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {stock.derived ? (
        <p className="muted">
          Anfangsbestand aus dem Endbestand der Heizperiode {stock.derived.label}{stock.derived.frozen ? ' (abgeschlossen)' : ''}: {stock.derived.value.quantity.toLocaleString('de-DE', { maximumFractionDigits: 2 })} · {stock.derived.value.costCents === null ? 'Betrag unbekannt' : fmtEuro(stock.derived.value.costCents)}
        </p>
      ) : (
        <div className="row">
          {text('openingQuantity', 'Anfangsbestand (Menge)')}
          {text('openingCost', 'Wert des Anfangsbestands')}
          {text('openingKg', 'CO₂ des Anfangsbestands (kg)')}
          {text('openingCo2', 'CO₂-Kosten des Anfangsbestands')}
          <label className="field">
            In Rechnung gestellt
            <select aria-label="Anfangsbestand in Rechnung gestellt" value={form.before2023} disabled={view.closed} onChange={(e) => set('before2023', BEFORE_2023_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
              {BEFORE_2023_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="row">
        {text('closingQuantity', 'Endbestand (Menge)')}
        <label className="field">
          Gepeilt am (leer: am letzten Tag der Heizperiode)
          <input type="date" value={form.measuredOn} disabled={view.closed} onChange={(e) => set('measuredOn', e.target.value)} />
        </label>
      </div>
      {stockSummary(stock).length > 0 && <ul>{stockSummary(stock).map((l) => <li key={l}>{l}</li>)}</ul>}
      {stock.problem && <div className="notice">{stock.problem}</div>}
      {error && <div className="error">{error}</div>}
      {!view.closed && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void save()}>Vorrat speichern</button>
          {(stock.row.stockUnit !== null || stock.row.closingQuantity !== null) && <button className="btn secondary" onClick={() => void remove()}>Vorrat entfernen</button>}
        </div>
      )}
    </div>
  )
}
```

`client/src/components/StockBlock.tsx`:

```tsx
// Der Druckblock „Bestandsrechnung Brennstoff“ in der Abrechnung eines Mieters (Heizung PR 8).
import type { StockBlockView } from '../stockView'

export default function StockBlock({ view }: { view: StockBlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <table>
        <tbody>
          {view.lines.map((l) => <tr key={l.label}><td>{l.label}</td><td className="num">{l.value}</td></tr>)}
        </tbody>
      </table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
```

- [ ] **Step 5: Seiten einbinden**

`client/src/pages/Heizkosten.tsx`: `import StockCard from '../components/StockCard'` und
`import { showsStockCard } from '../stockForm'`. In der Schleife je Heizperiode (`views[plant.id] …
.map((v) => …)`) hinter der Karte der Lieferungen (Annahme A10) bzw. hinter `HotWaterCard`:

```tsx
                {showsStockCard(plant, v) && <StockCard key={`stock:${v.period}`} view={v} onSaved={() => void load()} />}
```

Zeigt die Seite für eine Anlage mit freien Schlüsseln seit PR 7 eine eigene Schleife, kommt dieselbe
Zeile dort hinein.

`client/src/pages/Abrechnung.tsx`: `import StockBlock from '../components/StockBlock'` und
`import { showsStock, stockBlock } from '../stockView'`; direkt hinter der Zeile mit `Co2Block` (PR 6):

```tsx
              {(data.heating ?? []).filter((h) => showsStock(h, st)).map((h) => <StockBlock key={`stock:${h.plantId}:${h.period}`} view={stockBlock(h)} />)}
```

`client/src/pages/Steuer.tsx`: `import { stockCarryNote } from '../taxView'` (zum bestehenden Import)
und direkt unter dem Absatz, der die Aufteilung privat/abziehbar erklärt (dort, wo `showsSplit(report)`
gilt):

```tsx
          {stockCarryNote(report) && <p className="muted">{stockCarryNote(report)}</p>}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- stockForm StockCard stockView taxView && npm run typecheck && npm run build`
Expected: PASS; der Build übersetzt die neuen Komponenten. Prüft `guides.test.ts` „jede zitierte
Beschriftung steht so in der Oberfläche“, findet er „Vorrat“ in `StockCard.tsx` (der Begriff
`fuelStock` nennt die Karte so).

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS. `anrede.test.ts` findet keine Du-Form.

```bash
git add client/src shared
git commit -m "Oberfläche: Karte Vorrat, Druckblock Bestandsrechnung, Abstand beim Eigenanteil auf der Steuerseite

Refs #97, #99"
```

---
### Task 9: Smoke-Test, CHANGELOG, CLAUDE.md, Quellen, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks.
- Produces: Prüfung der Programmdateien mit der Route des Vorrats, CHANGELOG mit Ankündigung, Architekturabschnitt.

- [ ] **Step 1: Smoke-Test (`scripts/smoke-test.mjs`)**

Hinter `co2Statement` (PR 6):

```js
// Vorrat (Heizung PR 8): Die Route gibt es, und bei einer Gasheizung lehnt sie mit einem Satz ab.
// Rechnen prüfen calc-vorrat.test.ts und api.test.ts; die Anlage der Prüfung heizt mit Gas.
async function stockRoute() {
  const [anlage] = (await request('/api/heating-plants')).body
  const antwort = await request(`/api/heating-plants/${anlage.id}/periods/2025-01/stock`, json('PUT', { stockUnit: 'l', closingQuantity: 100 }))
  assert(antwort.status === 400 && /Heizöl, Flüssiggas, Pellets, Holz und Kohle/.test(antwort.body?.error ?? ''), 'Vorrat nur bei Vorratsenergien', antwort.body)
}
```

In `main` hinter `await co2Statement()`:

```js
  await stockRoute()
```

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

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ Vorrat nur bei Vorratsenergien“.
`$D` ist ein Wegwerf-Ordner, `CI=1` verhindert das Browserfenster, `NKA_UPDATE_URL` zeigt auf einen
geschlossenen Port.

- [ ] **Step 3: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]` (neben den Einträgen von PR 1 bis PR 7):

```md
### Hinzugefügt

- **Brennstoffvorrat bei Heizöl, Flüssiggas, Pellets, Holz und Kohle.** Auf der Seite „Heizkosten“ tragen Sie
  je Heizperiode Anfangs- und Endbestand ein, den Anfangsbestand nur in der ersten Heizperiode; danach
  ist er der Endbestand der Vorperiode. Mietfuchs rechnet daraus den verbrauchten Brennstoff
  (Anfangsbestand + Lieferungen − Endbestand) und bewertet den Endbestand wie die Messdienste zu den
  Preisen der jüngsten Lieferungen. Verteilen Sie die Heizkosten selbst nach Schlüsseln, tragen die
  Mieter den Verbrauch, mit den Zeilen „aus dem Vorrat“ und „im Vorrat“ (§ 7 Abs. 2 HeizkostenV,
  BGH VIII ZR 156/11); hat der Messdienst die CO₂-Kosten nicht aufgeteilt, teilt Mietfuchs sie nach dem
  verbrauchten Brennstoff auf. Brennstoff mit Rechnung vor dem 01.01.2023 zählt für die Einstufung,
  trägt aber keine CO₂-Kosten (§ 11 Abs. 2 Satz 2 CO2KostAufG). Die Abrechnung druckt die
  Bestandsrechnung mit ([#97](https://github.com/speedone/mietfuchs/issues/97),
  [#99](https://github.com/speedone/mietfuchs/issues/99)).
- Lieferungen von Heizöl, Flüssiggas, Pellets, Holz und Kohle lassen sich erfassen, mit Lieferdatum und Menge.
- Lexikon-Eintrag „Brennstoffvorrat“.

### Geändert

- **Angekündigt: Hinweis bei Heizöl, Flüssiggas, Pellets, Holz und Kohle mit freien Schlüsseln.** Ohne
  Anfangs- und Endbestand sagt die Abrechnung, dass die Heizkosten nach Lieferung statt nach Verbrauch
  verteilt sind und das angreifbar ist; an den Zahlen ändert sich nichts, bis Sie den Vorrat eintragen
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Die Steuerübersicht nennt den Unterschied zum Eigenanteil der Abrechnung, der aus dem Vorrat kommt:
  Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.
```

- [ ] **Step 4: CLAUDE.md**

Im Abschnitt „Architektur“ direkt hinter dem Absatz **Lieferungen** (PR 7) bzw. hinter **CO₂ beim
Messdienst** (PR 6) einfügen:

```md
**Brennstoffvorrat** (Heizung PR 8, #97, #99): Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle
(`STOCK_ENERGIES` in [shared/fuelStock.ts](shared/fuelStock.ts)) rechnet
[server/src/fuelStock.ts](server/src/fuelStock.ts) den verbrauchten Brennstoff: Anfangsbestand +
Lieferungen − Endbestand, für Menge, Betrag, kg und CO₂-Kosten. Die acht Spalten des Vorrats stehen an
`heating_periods`; gelesen und geschrieben in [server/src/db/fuelStock.ts](server/src/db/fuelStock.ts).

- **Bewertung nach Minol:** Verbraucht wird das Älteste zuerst; der Endbestand besteht aus den
  jüngsten Teilen und wird zu deren Preisen, kg und CO₂-Kosten bewertet, je Teil gerundet (Cent,
  kg auf das Hundertstel, nicht 0,1 kg wie im Entwurf, weil dessen Zahlen zwei Stellen haben).
- **Die Kette:** Den Anfangsbestand trägt der Vermieter nur in der ersten Heizperiode mit Vorrat ein;
  jede weitere übernimmt den Endbestand der Vorperiode mit seinen Teilen (der Server lehnt einen
  eigenen ab). `stockChainsOf` in snapshot.ts baut die Kette bis zur ersten abgeschlossenen
  Vorperiode; deren Endbestand ist eingefroren und steht im abgeschlossenen Stand unter
  `heating[].stock.closing`, gelesen über `frozenSettlementOf` (G-A4). Ein Wiederöffnen hebt ihn auf.
- **§ 11 Abs. 2 Satz 2 CO2KostAufG** (`co2.costs-before`, Rechnungsdatum): Brennstoff mit Rechnung vor
  dem 01.01.2023 zählt mit seinen kg, nicht mit seinen CO₂-Kosten; `fuel.before-2023` sagt, dass er die
  Stufe hebt.
- **Messdienst ohne Aufteilung** (`selfAfterService`): E und C aus dem Bestand (Naht N1 zur eigenen
  Aufteilung von PR 7); ohne Bestand keine Aufteilung und `fuel.stock-missing` mit 3 % je Mieter,
  statt `co2.service-unsplit`. Wer zum Vorrat nichts erfasst hat, sieht den Hinweis von PR 6.
- **Freie Schlüssel** (`manual`): Die Rechnungen bleiben Positionen; zwei Übertragsposten
  `stock:<Anlage>:<Heizperiode>:in|out` („aus dem Vorrat“, „im Vorrat“) laufen durch die Verteilung
  mit dem Schlüssel der größten Brennstoffposition (sonst der jüngsten der Vorperiode), Zeilen
  `kind: 'fuelCarry'`, Gegenzeile beim Vermieter `fuelCarry` unter `stock:<Anlage>:<Heizperiode>`. Sie
  zählen nicht in die Gesamtkosten, nicht in die Steuer und nicht zum Hinweis auf doppelte Rechnungen.
  Ohne Bestand oder ohne Schlüssel `fuel.manual-by-delivery` und Verteilung nach Lieferung wie bisher.
- **Steuer nach Bezahltem:** Der Eigenanteil der Abrechnung enthält den Anteil am Übertrag, die
  Steuerübersicht nicht; `TaxReport.expenses.stockCarrySelfCents` nennt den Abstand, die Steuerseite
  erklärt ihn (N8).
- **Peildatum:** gerechnet wird mit dem Wert wie gepeilt; `fuel.stock-date-differs` nennt Tage,
  Gradtagsanteil und Lieferungen dazwischen.
- `fuel.stock-missing` ist eine Warnung; den Fehler bei der eigenen Heizkostenabrechnung bringt PR 10
  mit eigenem Code, denn eine Stufe hängt am Code.
```

Im Absatz `**API**` hinter `` `/api/heating-plants/:id/periods` … `` ergänzen:
`` `…/periods/:period/stock` (PUT/DELETE, Vorrat, siehe Brennstoffvorrat), ``.

- [ ] **Step 5: Quellen vor dem Merge**

Der Entwurf führt BGH 23.11.1981, VIII ZR 298/80 (auf das sich Minol für die Bewertung des Vorrats
beruft) als „ungeprüft, vor PR 8 lesen“ (2., 8.2). Vor dem Merge den Volltext oder Leitsatz an einer
freien Quelle lesen (etwa über die Fundstelle bei Minol, „Restbewertung“, oder eine Urteilsdatenbank)
und in der PR-Beschreibung festhalten: Fundstelle, Datum des Lesens, Kernaussage zur Bewertung von
Heizölvorräten, und ob sie die Regel „Älteste zuerst, Endbestand zu den jüngsten Preisen“ trägt,
offenlässt oder ihr widerspricht. Widerspricht sie, wird nicht gemergt; die Regel geht dann mit dem
Befund zurück an den Entwurf. Trägt sie die Regel oder lässt sie sie offen, bleibt die Stützung auf
[M] Minol; der Prüfstand im Register und im Kommentar von `fuelStock.ts` wird entsprechend ergänzt.

- [ ] **Step 6: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden (Wegwerf-Ordner, `CI`,
geschlossener Update-Port). Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement server/test/fixtures/heating
```

Expected: keine Ausgabe (Golden F01–F15 unverändert).

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "Vorrat: Smoke-Test, CHANGELOG mit Ankündigung, Architekturabschnitt

Refs #97, #99"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“). Sie prüft
ausdrücklich die Abweichungen 1 bis 9, die Annahmen A1 bis A11 gegen den Code von PR 7 und das
Ergebnis aus Step 5. Befunde mit einem vorher roten Test beheben; PR gestapelt auf PR 7 mit
`Refs #97, #99` und den Befunden in der Beschreibung.

---

## Selbstprüfung

**1. Abdeckung des Entwurfs (Zeile PR 8 in Abschnitt 13 und die genannten Abschnitte):**

| Anforderung | Task |
|---|---|
| Bestand in `heating_periods` mit Peildatum (5.3, D-L2) | 2, 5 |
| Bewertung nach Minol, älteste zuerst, Endbestand zu den jüngsten Lieferungen (8.2, R-A26) | 3 |
| Rundung je Posten (8.2) | 3 (Abweichung 1: kg auf das Hundertstel) |
| Vorbelegung aus H−1, eingefroren bei abgeschlossener H−1 (8.2, G-A4) | 3, 4, 5 (Abweichung 3, 4) |
| Sperre nach Abschluss (5.3, G-A4) | 5 |
| `selfAfterService`: E, C aus dem Bestand; ohne Bestand warning mit 3 %, keine Aufteilung (7.6, 8.2, G-B4) | 6 |
| `manual`: Kosten nach Verbrauch mit `fuelCarry`, C nach Verbrauch (R2, D-R2, A6) | 7 |
| `fuel.manual-by-delivery` mit beiden Folgen und Einstufungshinweis (8.2, N9) | 7 |
| `fuel.stock-invalid` (Q₁ > Q₀ + Σq) (8.2) | 3, 6, 7 |
| `fuel.stock-missing` (10.1, G-B4) | 6 (Abweichung 2) |
| `fuel.before-2023`, Altbestand hebt die Stufe (3.9, D-H6) | 1 (`co2.costs-before`), 3, 6 |
| `fuel.stock-date-differs` (8.2, 10.1) | 3, 6 |
| `co2.costs-before` im Register mit Stichtagstest (4.3, 4.7) | 1 |
| Regel `heating-consumed-fuel` (10.2) | 1 |
| Lexikon `fuelStock` (10.3) | 1 |
| Ausweis: Bestandsrechnung in den Grundlagen (9.5) | 6 (`HeatingStatement.stock`), 8 (Druckblock) |
| Σ aller Zeilen = Σ Kostenpositionen, Vorzeichen der Übertragszeilen (6.2, 12.3 Nr. 1, 2) | 7 |
| Steuer: Eigenanteil nach Bezahltem, Übertrag außen vor, Erklärung (6.4 Nr. 1, G-C5, N8, 12.3 Nr. 10) | 7, 8 |
| Jede Lieferung genau einmal verbraucht über eingefrorene und offene H (12.3 Nr. 5) | 3 |
| Testfälle 12.2: R2, G-C5, N8; `fuel.test.ts` zum Öl (Beispiel, Jahr ohne Lieferung, Endbestand zu groß, Bestand aus 2022, `fuel.stock-missing` je Methode) | 3, 6, 7 |
| Oberfläche (11.4, Karte im Brennstoffbereich der Seite Heizkosten) | 8 |
| Bei `self` folgt der Vorrat mit PR 10 (13) | 5 (Satz bei `method = 'self'`) |
| CHANGELOG mit Ankündigung | 9 |
| VIII ZR 298/80 vor PR 8 lesen (2., 8.2) | 9 Step 5 |

**2. Platzhalter:** Keine offenen Stellen im Code. Zwei Werte entstehen erst bei der Ausführung und
sind benannt: die Prüfsummen der beiden Migrationen (Task 2 Step 6) und das Leseergebnis zu VIII ZR
298/80 (Task 9 Step 5). Die Namen aus PR 7 sind als Annahmen A1–A11 benannt und vor Task 1 abzugleichen;
an genau einer Stelle (Task 6 Step 5, `ownSplitByDeliveries`, `fuelTotals`) hängt der Wortlaut vom Code
von PR 7.

**3. Typen und Namen:** `StockValue`, `StockLayer`, `HeatingStockStatement`, `StockView`, `StockRow`
(Task 2) sind in fuelStock.ts, snapshot.ts, db/fuelStock.ts, calc.ts und der Oberfläche dieselben;
`StockPeriodInput` (Task 3) baut `stockChainsOf` (Task 4) und liest `stockOf` (Task 3, 5, 6);
`stockOfPlant` (Task 6) liest Task 7; die Kennungen `stock:<Anlage>:<Heizperiode>:in|out` und
`stock:<Anlage>:<Heizperiode>` stehen gleich in calc.ts, `stockCarrySelfCents`, `showsStock` und den
Tests; `stockCountedAt` und `stockOptionsFor` fragen dasselbe Register; `FuelFigures` (Task 6) ist die
Gestalt von A7.

**4. Review Focus:** alle fünf Punkte mit Test: 1 in Task 3 und 6, 2 in Task 3 und 7, 3 in Task 4 und 5,
4 in Task 7, 5 in Task 5.
