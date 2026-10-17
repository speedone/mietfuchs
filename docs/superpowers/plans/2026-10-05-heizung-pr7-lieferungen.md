# Heizung PR 7: Lieferungen, eigene Aufteilung (Gas, Fernwärme, Strom) (#97) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Vermieter trägt die Rechnungen seines Versorgers (Gas, Fernwärme, Strom der Wärmepumpe)
als Lieferungen an der Heizanlage ein; Mietfuchs grenzt jede Rechnung auf die Heizperioden ab
(eingetragen, Zählerstand, Zwischenrechnung, Teilmengen, Ortswerte, Gradtagstabelle, feste
Preisbestandteile nach Tagen), bucht bei freien Schlüsseln den Teil einer anderen Heizperiode als
Übertrag (`fuelCarry`), schätzt beim Abschluss eine fehlende Rechnung mit Vorbehalt, friert die
Überträge ein und teilt die CO₂-Kosten selbst auf (Einstufung, gekürzte Tabelle, § 8, § 9, Wärme aus
dem Emissionshandel), bei freien Schlüsseln nach dem Anteil am Brennstoff, beim Messdienst ohne
Aufteilung nach dem Anteil an seinen Beträgen.

**Architecture:** Vier neue Tabellen (`fuel_deliveries`, `fuel_delivery_parts`, `fuel_carry_frozen`,
`degree_day_values`) und neue Spalten (`cost_items.fuel_delivery_id`, drei CO₂-Merkmale an
`heating_plants`) in zwei erzeugten Schritten (`0022_lieferungen`, `0023_lieferungen_bedingungen`).
Die Abgrenzung steht als reine Funktion in `server/src/fuel.ts` (`plantFuel`), die Gradtagstabelle
kommt aus dem Register (`hkv.degree-days`, PR 3), § 8 und § 9 CO2KostAufG kommen neu ins Register.
`computeSettlement` legt je Übertrag eine Zeile ohne Position bei den Mietern an (dieselbe Verteilung
wie die Brennstoffposition) und eine Gegenzeile beim Vermieter, ergänzt den CO₂-Block aus PR 6 um die
eigene Aufteilung und schreibt die Bewertung in `Settlement.heating[].fuel`. Lesen und Schreiben stehen
in `server/src/db/fuel.ts`, die Sperren in repository.ts, das Einfrieren läuft beim Abschluss in
derselben Transaktion. Die Oberfläche bekommt auf der Seite Heizkosten die Karten „Lieferungen“,
„Gradtagzahlen Ihres Orts“ und „CO₂: Angaben zum Gebäude“, den Druckblock „Brennstoff“ und die
Rückfrage zur Schätzung beim Abschließen.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.5 (G-A3, G-A4, G-B5, G-C4, G-C10), 0.6 (N1, D-R1, D-R2, D-L1), 0.7 (A4, A5, A6, A10, R1 Rest),
0.8 (B8, B9), 1.1 (W2, W4, W5, W7), 2 (GasGVV § 12, VIII ZR 156/11, VIII ZR 264/12), 3.0, **3.2**,
**3.3**, **3.M** (Zeile 2 und 9), 3.4 (`period.heating-mismatch` nur ohne Anlage), 3.9 (E umrechnen, C
wie 3.3, gekürzte Tabelle), 4.3 (`co2.non-residential`, `co2.restriction`), 4.7, **5.4**, 5.7, 5.8,
6.1 Nr. 4.2–4.5, 6.2 (`fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`, Vorzeichen), 6.4 Nr. 1, 7.6
(mit Lieferung), **8.2** (Gas, Fernwärme, Strom; abgeschlossene Heizperioden und fehlende Rechnungen,
Fälle a–f; Einfrieren und Sperren), **9.1–9.5**, 10.1 (Codes mit PR 7), 10.2 (`co2-non-residential`,
`co2-restriction`, `heating-consumed-fuel`), 11.3 Nr. 4, 11.4 (Seite Heizkosten), 12.1 (F13), 12.2
(G-A3, G-A4/N1 a–f, N1 Abschlussdialog, G-B5/B8, R1, A6, `fuel.test.ts`), 12.3 Nr. 1, 2, 5, 9, 12.4,
13 (PR 7), 14.1, 15.1 Nr. 1, 3, 10, 11, 17, 19, 15.2 F1, F6, 15.3 (Gradtage bei Versorgerrechnungen).

**Baut auf:** PR 1 (Code auf `feat/heizung-pr1-rechtsregister`, Stand `b26fede`), PR 2 (Code auf
`feat/heizung-pr2-zeitraum`, Stand `6a9d126`, Tasks 1–6), PR 3 bis PR 6 nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3,4,5,6}-*.md` (PR 6: Commit `ee42c7b`). Gearbeitet wird
auf `feat/heizung-pr7-lieferungen`, abgezweigt von der Spitze von PR 6; der PR wird gestapelt auf PR 6
gestellt und nach dessen Merge auf `main` umgestellt (`git rebase --onto`).

**Vor Task 1:** Die Laienprobe der Formulare aus PR 4–6 (Entwurf 11.2, Hinweis 7) ist gelaufen. Ihre
Befunde werden als GitHub-Issues erfasst (vorher beim Nutzer nachfragen, Issues sind öffentlich) und,
soweit sie die Seite Heizkosten betreffen, in Task 11 mitbedacht; dieser Plan setzt keinen Befund
voraus.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Lieferung ist jede Zahl, jeder
  Hinweis, jedes Feld der Abrechnung und `legalBasis.values` gleich dem Stand nach PR 6. Die
  Gradtagstabelle wird nur abgefragt (und damit protokolliert), wenn eine Anlage Lieferungen hat; § 8
  und § 9 nur, wenn ihr Merkmal gesetzt ist. Golden F01–F11 und F12, F14, F15 bleiben wortgleich.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): Gradtagstabelle (`hkv.degree-days`, PR 3),
  Stufentabelle, Rundung, 3 % (PR 6), neu `co2.non-residential` (Vermieter 500 ‰, § 8 Abs. 1),
  `co2.restriction` (× 0,5; beide Vorgaben: keine Aufteilung, § 9) und `co2.district-ets-new`
  (§ 2 Abs. 4 Satz 2, Anschluss nach dem 01.01.2023). `server/src/fuel.ts` kommt in `ENGINE_FILES` von
  `law-literals.test.ts`. Urteile werden in Texten mit Aktenzeichen ohne Datum genannt (kein
  Datumsliteral in den Dateien der Berechnung).
- **Abgrenzung in Stufen, tagesgenau gibt es nicht** (3.2): 0 eingetragen (nur der
  verbrauchsabhängige Teil), 1 gemessen (Versorgungszähler mit Ständen genau an den Grenzen), 2
  Zwischenrechnung (ganz drin: 1, ganz draußen: 0), 3 Teilmengen laut Rechnung (je Teilmenge 1, 4
  oder 5), 4 Ortswerte, 5 Tabelle, 6 Schätzung mit Vorbehalt. Feste Preisbestandteile (`fixed_cents`)
  immer nach Tagen; ohne Angabe die ganze Rechnung nach den Stufen und `fuel.fixed-unknown`.
- **Kosten und C abgegrenzt nur bei `manual` mit verknüpfter Lieferung** (A6, G-A3; `self` kommt mit
  PR 10), beim Messdienst gilt, was im Topf berechnet ist; **E immer umgerechnet**:
  E_H = Σ E_d · Anteil_d / Abdeckung (3.3).
- **Ein Teil außerhalb gehört immer in die frühere Heizperiode** (N1): Die Positionen einer Lieferung
  stehen in der Heizperiode, die das Ende des Rechnungszeitraums enthält; die übrigen Teile laufen über
  `fuelCarry`. Σ aller Zeilen = Σ Kostenpositionen, über die Zeiträume hinweg (12.3 Nr. 1, 5).
- **Abgeschlossenes bleibt, wie es war** (G-A4): Der Abschluss friert je Lieferung ein, was eine
  Heizperiode herein- oder hinausgebucht hat; spätere Heizperioden lesen das und rechnen es nicht neu.
  Eine Lieferung mit eingefrorenem Teil und Ablesungen des Versorgungszählers in einer abgeschlossenen
  Heizperiode sind gesperrt (409).
- **Schätzung nur mit Vorbehalt und nur auf Rückfrage** (N1, A4, A5, B9): Vorgabe im Dialog „Trotzdem
  abschließen?“ ist die Schätzung; ohne Antwort 409 mit den Lücken. Die echte Rechnung gibt später ihren
  tatsächlichen Teil heraus, die Differenz steht beim Vermieter (`fuelEstimateDiff`, mit Vorzeichen).
- **Sperren, 400 mit einem Satz** (13 PR 7, W7): Lieferungen mit Vorrat (Heizöl, Flüssiggas, Pellets,
  Holz, Kohle: PR 8), Lieferungen je Wohnung (Etagenheizung: PR 9), Netzentgelte und Biobrennstoff
  (PR 18), Methode `self` der Anlage (PR 10, schon von PR 4 gesperrt). Jeder Satz sagt, was bis dahin
  geht.
- **Stufe hängt am Code** (#112): Jeder neue Code steht mit genau einer Stufe in `noticeKinds` und
  trägt mindestens einen Begriff des Lexikons.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte hinter `0021_co2_messdienst` (PR 6): `0022_lieferungen` (neue Tabellen und neue Spalten,
  keine geänderte Bedingung an einer bestehenden Tabelle) und `0023_lieferungen_bedingungen`
  (Bedingungen an `cost_items` und `heating_plants`, Neubau). Keine Datenanweisung. Beide Marken in
  `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben unverändert;
  die db.json kennt keine Lieferungen. `legacy/read.ts` braucht keine Änderung (alle neuen Felder des
  Schnappschusses sind optional).
- **Objektgrenze:** Eine Kostenposition zeigt nur auf eine Lieferung ihrer eigenen Anlage; das
  Wiederherstellen meldet Abweichungen als Befund.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch;
  Nutzertexte siezen (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein `namespace`,
  keine Parameter-Eigenschaften (`erasableSyntaxOnly`). Im Client endungslose Importe, nur aus
  `shared/` mit `.ts`.
- **Auswahlfelder** werden aus Optionslisten gespeist; je neuem Auswahlfeld ein jsdom-Test, dass der
  angezeigte Wert dem gespeicherten entspricht.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`, beim Smoke-Test der Aufruf von Hand.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #97` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung.

## Review Focus

1. **Eine Gutschrift des Versorgers ist als zweite Position mit derselben Lieferung verknüpft** (Abschlag
   7.000 €, Gutschrift −500 €). Erwartet: Beide Positionen werden im selben Verhältnis abgegrenzt, der
   Übertrag ist der Anteil der Summe 6.500 €, und Σ aller Zeilen bleibt Σ der Positionen. Test in
   Task 7.
2. **Die Lieferung steht in einer anderen Heizperiode als ihre Positionen**, weil ein alter Tab eine
   Position unter dem Zeitraum des Rechnungsdatums anlegt. Erwartet: Die Verknüpfung wird mit einem Satz
   abgelehnt, der die richtige Heizperiode nennt, statt still in einer Heizperiode zu verteilen, in die
   die Rechnung nicht gehört. Test in Task 4.
3. **Die Schätzung wird beim Abschluss angenommen, und danach kommt die echte Rechnung, während die
   Heizperiode wieder geöffnet ist** (Fall f). Erwartet: Die Schätzung zählt nicht mehr, sobald die
   echte Rechnung ihre Tage abdeckt; nichts wird doppelt verteilt. Test in Task 7.
4. **Der Versorgungszähler hat zwei Ablesungen am Stichtag, oder ein Zählerwechsel ohne Endstand liegt
   im Rechnungszeitraum.** Erwartet: Stufe 1 gilt nur mit eindeutigen Ständen; sonst rechnet Mietfuchs
   mit der nächsten Stufe und sagt das, statt einen Zählerstand zu erfinden. Test in Task 3.
5. **Ein Mieter mit Heizpauschale, ein anderer wird abgerechnet, und Mietfuchs teilt die CO₂-Kosten
   selbst auf.** Erwartet: Nur wer eine Brennstoffzeile hat, bekommt einen Abzug; der Teil des
   Pauschalmieters bleibt beim Vermieter; Σ aller Zeilen bleibt gleich. Test in Task 8.

---
## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts` | § 8, § 9, § 2 Abs. 4 S. 2 im Register; Regeln `co2-non-residential`, `co2-restriction`, `heating-consumed-fuel`; Lexikon `degreeDays` | 1 |
| `shared/types.ts`, `server/src/db/schema.ts`, `server/drizzle/0022_*`, `0023_*`, `meta/*` (erzeugt), `client/src/landlordReasons.ts` | Datenmodell, Migration, Gründe beim Vermieter | 2 |
| `server/src/fuel.ts` (neu) | Abgrenzung, Abdeckung, Überträge, Schätzvorschlag | 3 |
| `server/src/db/read.ts`, `server/src/db/fuel.ts` (neu), `server/src/db/repository.ts`, `server/src/db/heating.ts`, `server/src/db/co2.ts` | Lesen, Schreiben, Sperren, Verknüpfung, Ablesungen | 4 |
| `server/src/index.ts` | Routen der Lieferungen und Ortswerte | 5 |
| `server/src/snapshot.ts` | Lieferungen, Überträge und Abschlüsse im Schnappschuss | 6 |
| `server/src/calc.ts` | Übertragszeilen, Gegenzeilen, Hinweise `fuel.*`, Bewertung | 7 |
| `shared/types.ts`, `server/src/co2.ts`, `server/src/calc.ts` | Eigene CO₂-Aufteilung, § 8, § 9, Wärme aus dem Emissionshandel | 8 |
| `server/src/db/fuel.ts`, `server/src/db/repository.ts`, `server/src/db/heatingSettlements.ts`, `server/src/index.ts` | Abschluss mit Rückfrage, Schätzung, Einfrieren, Wiederöffnen | 9 |
| `server/test/fixtures/heating/F13-*/README.md` (neu), `server/test/heating-golden.test.ts` | Golden F13 | 10 |
| `client/src/fuelForm.ts` (neu), `client/src/components/{FuelCard,DegreeDaysCard,Co2FactsCard}.tsx` (neu), `client/src/pages/Heizkosten.tsx` | Seite Heizkosten | 11 |
| `client/src/fuelClose.ts`, `client/src/fuelView.ts` (neu), `client/src/components/FuelBlock.tsx` (neu), `client/src/co2View.ts`, `client/src/pages/Abrechnung.tsx` | Rückfrage beim Abschluss, Druckblock | 12 |
| `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung, Doku | 13 |
| Tests: `law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `schema.test.ts`, `migrations.test.ts`, `fuel.test.ts` (neu), `db-fuel.test.ts` (neu), `api.test.ts`, `calc-fuel.test.ts` (neu), `calc-co2.test.ts`, `db-co2.test.ts`, `heating-golden.test.ts`, `client/src/fuelForm.test.ts` (neu), `client/src/components/FuelCard.test.tsx` (neu), `client/src/components/Co2FactsCard.test.tsx` (neu), `client/src/co2View.test.ts`, `server/test/co2.test.ts`, `server/test/calc-co2.test.ts`, `client/src/fuelView.test.ts` (neu), `client/src/fuelClose.test.ts` (neu), `client/src/landlordReasons.test.ts`, `client/src/co2View.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 6 anders umsetzt, zieht ihn hier nach, bevor Task 1
beginnt.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 `shared/law/register.ts` (Code `b26fede`) | `LawParam<T, M>` mit `describe`, `Source`, `law(param, ctx, log)`, `valueAt`, `onlyVersion`, `germanDate`, `dayBefore`, `dayAfter`, `LAW_AS_OF`, `LawLog` | Code |
| PR 1 `server/test/law-history.test.ts`, `law-literals.test.ts` | `SHIPPED`, `ENGINE_FILES`, `ALLOWED` | Code, ergänzt von PR 2–6 |
| PR 2 `shared/period.ts` (Code `6a9d126`) | `PeriodKey`, `periodKey`, `parsePeriodKey`, `periodContaining(rules, date)`, `periodOfKey(rules, key)`, `periodsBetween(rules, from, to)`, `previousPeriod`, `periodLabel`, `settlementDeadline`, `periodDays`, `CALENDAR_RULES`, `rulesOf` | Code |
| PR 2 `server/src/calc.ts` | in `computeSettlement`: `period`, `yFrom`, `yTo`, `label`, `items`, `statements`, `landlordRows`, `notices`, `warn`, `totalCostsCents`, `selfUsedShareCents`, die Schleife `for (const item of items)`, `const steps: CalcStep[] = [`, `st.rows.push({`, `const parts: LandlordPart[] = …`, `if (!forced) selfUsedShareCents += …`; `distributeCents`, `fmtCents`, `fmtExactEuro`, `fmtDay`, `fmtNum`, `andList`, `itemSubject` | Code |
| PR 2 `server/src/db/repository.ts` | `closeSettlement(db, entry)`, `reopenSettlement`, `findClosedSettlement`, `isPeriodClosed`, `readingCollection` mit `guard: noGuard`, `crossPropertyViolations`, `mergeCostItem`, `costItemRow`, `guardCostItem` | Code |
| PR 3 | `hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'>` (`shared/law/heizkostenv.ts`), `DegreeDayTable`, `shared/degreeDays.ts` mit `DayRange`, `unionOf`, `unionDays`, `degreeDayPermille`; `formatDayRange`, `spansTwoYears` (`shared/period.ts`); `CostItem.serviceFrom`, `serviceTo`, `heatingPart`; in calc.ts der Block „Zeitraum (#208)“ mit `warn('period.heating-mismatch', …)`; Begriffe `degreeDays`, `accrualPrinciple`, `settlementDeadline` | Plan PR 3 |
| PR 4 | `HeatingPlant` (`energy`, `method`, `units` …), `HEATING_ENERGIES`, `heatingPlants`, `heatingPeriods`, `meters.heatingPlantId`, `meters.heatingRole` (`'supply'`); `HeatingError(status, message)`, `has`, `raw`, `merged`, `asText`, `asNullableFilled`, `oneOfOrUndefined`, `ISO_DATE`; `mergeHeatingPlant`, `emptyHeatingPlant`, `guardHeatingPlant`, `plantRow`, `readHeatingPlants`, `removeHeatingPlant`, `PlantRemoval`; Route `DELETE /api/heating-plants/:id`; `SnapshotMeter` mit `heatingPlantId`, `heatingRole` | Plan PR 4 |
| PR 5 | `shared/heatingPeriod.ts`: `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`, `servesUnit`, `PlantWay`; snapshot.ts: `wayOf`, `SnapshotHeatingPart`, `SnapshotScope`, `Snapshot.objectRules`, `Snapshot.heatingParts`, `Snapshot.scope`, `heatingSnapshotFor`, `SnapshotSource.closedHeatingSettlements`; repository.ts: `heatingRulesOf`, `itemPeriodClosed`, `rulesForProperty`; schema: `heatingPeriodChanges`, `heatingSeparateSpans` (`from`, `until`), `closedHeatingSettlements`; `heatingSettlements.ts`: `closeHeatingSettlement`, `reopenHeatingSettlement`, `findClosedHeatingSettlement`; in `computeSettlement`: `scope`, `objectRules`, `plants`, `mergeHeatingPart` | Plan PR 5 |
| PR 6 | `shared/law/co2kostaufg.ts` (`co2ApplicableFrom`, `co2StageTable`, `co2RoundingDecimals`, `co2CutMissing`, `ENACTED`, `checked`); `Co2Statement`, `Co2Method`, `Co2Assessment`, `HeatingStatement`, `HeatingPeriodView`, `SettlementRow.kind`, `LandlordReason` + `co2Share`, `NoticeSubject` + `heatingCosts`; `server/src/co2.ts` (`CO2_FUELS`, `roundSpecific`, `tableFactor`, `stageRanges`, `stageOf`, `restage`, `reliefsByShare`, `ReliefShare`, `Co2Pot`, `co2PotsOf`, `co2Assessment`, `tenantLines`); `CO2_RELIEF_LABEL` (`shared/co2Probe.ts`); `server/src/db/co2.ts` (`saveCo2Statement`, `heatingPeriodViews`, `ensureHeatingPeriod` intern, `guardCo2`, `LATER_SELF`, `LATER_MANUAL`); im CO₂-Block von `computeSettlement`: `co2Pots`, `heatingStatements`, `heatingSettled`, `cutsOn`, `sharesOf`, `co2Duty`, `nextStep`, `report`, `applicable`, `service`, `booked`, `printed`, `where`, `ids`, `plantSubject`, `hPeriod`; `withoutCo2` (`server/testing/co2.ts`); Seite `client/src/pages/Heizkosten.tsx`, `co2View.ts`, `Co2Block.tsx`, `nav.ts` mit `navFor` | Plan PR 6 |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **Tabelle `degree_day_values`** (Ortswerte, Stufe 4): Der Entwurf (3.2) lässt den Vermieter die
   Gradtagzahlen des DWD für seinen Ort und die Monate eintragen, nennt aber keine Tabelle dafür. Je
   Objekt und Monat ein Wert; innerhalb eines Monats zählt jeder Tag gleich, wie bei der Tabelle (3.5).
2. **`fixed_cents` auch an Teilmengen** (`fuel_delivery_parts.fixed_cents`): 3.2 verlangt, dass „eine
   Lieferung (und jede Teilmenge)“ `fixed_cents` trägt; die Spaltenliste in 5.4 nennt ihn bei den
   Teilmengen nicht.
3. **Parameter `co2.district-ets-new`** (§ 2 Abs. 4 Satz 2 CO2KostAufG, Anschluss nach dem
   01.01.2023): Die Frage an der Anlage nennt den Stichtag; er gehört ins Register und steht nicht in
   4.3.
4. **„Ersetzt“ wird nicht gespeichert, sondern gerechnet:** Eine geschätzte Lieferung zählt nicht mehr,
   sobald echte Lieferungen ihre Tage abdecken (8.2: „als ersetzt markiert und nicht mehr gelesen“).
   Das gilt beim Wiederöffnen von selbst und auch, wenn die echte Rechnung kommt, während die
   Heizperiode offen ist; eine Spalte dafür könnte nur veralten.
5. **Eingetragener Anteil (`share_permille`)** ist der Anteil der Heizperiode, in der die Rechnung endet;
   der Rest gehört der davor. Eine Rechnung über mehr als zwei Heizperioden kann keinen eingetragenen
   Anteil haben (400).
6. **`amount_cents` an einer Lieferung** gibt es nur bei einer Anlage mit Messdienst (5.4: „nur, wenn
   keine Kostenposition auf die Lieferung zeigt“); bei freien Schlüsseln ist der Betrag die Summe der
   verknüpften Positionen, und eine Position verknüpft man nur dort (beim Messdienst steckt der
   Brennstoff in dessen Beträgen, W5).
7. **Einfrieren je Lieferung, Abschluss und Wiederöffnen:** `fuel_carry_frozen` hält je Lieferung und
   Heizperiode den Übertrag der Mieterseite (`cents`, + herein, − hinaus) und den Ausstoß und die
   CO₂-Kosten dieser Lieferung in der Heizperiode. Gelesen wird ein eingefrorener Wert nur für eine
   abgeschlossene Heizperiode; beim Wiederöffnen entfallen ihre Zeilen.
8. **Die Gutschrift je Mieter bei zu hoher Schätzung** (`fuel.estimate-overcharged`) rechnet Mietfuchs
   aus den Übertragszeilen der eingefrorenen Abrechnung (`fuelCarryRows`), im Verhältnis der zu viel
   geschätzten Summe.
9. **Die CO₂-Merkmale des Gebäudes** (§ 8, § 9, Emissionshandel) stehen auf der Seite Heizkosten in einer
   eigenen Karte und nicht in der Einrichtung (11.2 nennt sie dort nicht); gespeichert werden sie an der
   Anlage.
10. **Bei freien Schlüsseln braucht die eigene Aufteilung keinen CO₂-Datensatz:** Hat die Anlage
    Lieferungen, teilt Mietfuchs selbst auf (Methode `self`); ein Datensatz mit `method = 'self'` hält
    nur die Fläche der Einstufung, wenn sie von der Vorgabe abweicht (15.1 Nr. 1).
11. **Übertrag in eine Heizperiode, deren Rechnung in einer abgeschlossenen späteren steht:** Reicht die
    Rechnung über genau zwei Heizperioden, übernimmt die frühere den eingefrorenen Wert der späteren;
    über drei rechnet sie ihren Teil (der Fall verlangt, dass die spätere vor der früheren abgeschlossen
    wurde, und ist selten).
12. **Ortswerte und Zählerstand am Zähler der Anlage:** Stufe 1 gilt nur mit genau einem
    Versorgungszähler (Rolle `supply`) und Ablesungen genau am Tag vor dem Beginn und am letzten Tag
    jedes Abschnitts.
13. **`co2.pool-keys`** nennt der Entwurf (10.1) nur mit Stufe und PR. Festgelegt: Hinweis, wenn die
    Brennstoffpositionen einer Anlage bei der eigenen Aufteilung nach verschiedenen Schlüsseln verteilt
    werden; der Abzug folgt jeder Position mit ihrem Schlüssel (9.4), der Hinweis bittet um Prüfung.
14. **Schätzungen entstehen vor dem Abschluss in einer eigenen Transaktion** (Entwurf 8.2, N1):
    Die Berechnung liest den Bestand mit `readStock(db: Database)` und nicht in einer
    Transaktion. Alles läuft im selben Schreibvorgang der Schlange, dazwischen kommt keine Anfrage
    durch; scheitert der Abschluss danach, nimmt `removeEstimates` die Schätzungen zurück. Abschluss
    und Einfrieren laufen gemeinsam in einer Transaktion.
15. **Die Abgrenzung bei einer Anlage mit Messdienst** grenzt nur den Ausstoß ab und nicht Kosten oder
    C (G-A3); die Hinweise `fuel.share-by-degree-days`, `fuel.fixed-unknown` und `fuel.uncovered`
    erscheinen dort trotzdem, weil die Umrechnung von E an derselben Abgrenzung hängt.

---
### Task 1: Rechtsregister: § 8, § 9, § 2 Abs. 4 Satz 2 CO2KostAufG, drei Regeln, Lexikon

Drei Parameter (4.3 Spalte „PR 7“, dazu Abweichung 3) und die Regeln `co2-non-residential`,
`co2-restriction`, `heating-consumed-fuel` (10.2). Wortlaut am 05.10.2026 gelesen: § 2 Abs. 4, § 8
Abs. 1 bis 3, § 9 Abs. 1 bis 3 CO2KostAufG auf gesetze-im-internet.de, § 7 Abs. 2 HeizkostenV.

**Files:**
- Modify: `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes (PR 1, PR 6): `LawParam`, `Source`, `germanDate`, `valueAt`, `LAW_AS_OF`, `law`, `createLawLog`; in `co2kostaufg.ts` `ENACTED`, `checked`, `co2FirstPeriodStart`; in `glossary.ts` `GLOSSARY.degreeDays`.
- Produces:
  - `co2NonResidential: LawParam<number, 'periodStart'>` (`'co2.non-residential'`, 500 = Vermieter in ‰)
  - `co2Restriction: LawParam<{ readonly factor: number; readonly bothSplit: boolean }, 'periodStart'>` (`'co2.restriction'`)
  - `co2DistrictEtsNew: LawParam<{ readonly connectedAfter: string }, 'periodStart'>` (`'co2.district-ets-new'`)
  - Regeln `co2-non-residential`, `co2-restriction` (`validFrom` = `co2FirstPeriodStart()`), `heating-consumed-fuel`

- [ ] **Step 1: Write the failing tests**

In `server/test/law.test.ts` den Import aus `'../../shared/law/co2kostaufg.ts'` um
`co2DistrictEtsNew, co2NonResidential, co2Restriction` ergänzen und anhängen:

```ts
// ---------- CO2KostAufG § 2 Abs. 4, § 8, § 9 (Heizung PR 7) ----------

test('co2.non-residential, co2.restriction, co2.district-ets-new: Werte und Texte (§ 8 Abs. 1, § 9, § 2 Abs. 4 Satz 2)', () => {
  const log = createLawLog()
  const p = { period: { from: '2025-01-01', to: '2025-12-31' } }
  assert.equal(law(co2NonResidential, p, log), 500)
  assert.deepEqual(law(co2Restriction, p, log), { factor: 0.5, bothSplit: false })
  assert.deepEqual(law(co2DistrictEtsNew, p, log), { connectedAfter: '2023-01-01' })
  assert.equal(co2NonResidential.describe(500), 'Vermieter mindestens 500 ‰ (Mieter höchstens die Hälfte)')
  assert.equal(co2Restriction.describe({ factor: 0.5, bothSplit: false }), 'Anteil des Vermieters × 0,5; bei beiden Vorgaben keine Aufteilung')
  assert.equal(co2DistrictEtsNew.describe({ connectedAfter: '2023-01-01' }), 'nicht anzuwenden bei erstem Wärmeanschluss nach dem 01.01.2023')
  assert.deepEqual(log.values.map((v) => v.id), ['co2.non-residential', 'co2.restriction', 'co2.district-ets-new'])
})

test('Regeln: Nichtwohngebäude, Beschränkungen und verbrauchter Brennstoff', () => {
  const nonRes = RULES.find((r) => r.code === 'co2-non-residential') ?? assert.fail('Regel co2-non-residential fehlt')
  assert.equal(nonRes.norm, '§ 8 CO2KostAufG')
  assert.match(nonRes.summary, /nicht überwiegend dem Wohnen/)
  const restr = RULES.find((r) => r.code === 'co2-restriction') ?? assert.fail('Regel co2-restriction fehlt')
  assert.equal(restr.norm, '§ 9 CO2KostAufG')
  assert.match(restr.summary, /um die Hälfte/)
  assert.match(restr.summary, /nachweist/)
  const fuel = RULES.find((r) => r.code === 'heating-consumed-fuel') ?? assert.fail('Regel heating-consumed-fuel fehlt')
  assert.equal(fuel.norm, '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11')
  assert.match(fuel.summary, /verbrauchten Brennstoffe/)
  assert.equal(fuel.validFrom, undefined)
})
```

In `server/test/law-history.test.ts` in `SHIPPED` hinter den Zeilen von PR 6 einfügen:

```ts
  // 0.11.0 (Heizung PR 7)
  'co2.district-ets-new|||{"connectedAfter":"2023-01-01"}',
  'co2.non-residential|||500',
  'co2.restriction|||{"factor":0.5,"bothSplit":false}',
```

In `server/test/glossary.test.ts` anhängen:

```ts
test('Gradtagszahlen (Heizung PR 7): auch für die Abgrenzung einer Versorgerrechnung', () => {
  assert.match(GLOSSARY.degreeDays.needed, /Gas-, Fernwärme- oder Stromrechnung über das Ende der Heizperiode/)
  assert.match(GLOSSARY.degreeDays.needed, /Zählerstand zum Stichtag/)
  assert.match(GLOSSARY.degreeDays.needed, /DIN 94680/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL mit `does not provide an export named 'co2DistrictEtsNew'` und der Zusicherung zu
`degreeDays.needed`.

- [ ] **Step 3: Parameter (`shared/law/co2kostaufg.ts`)**

Ans Dateiende:

```ts
// ---------- Heizung PR 7 ----------

// Nichtwohngebäude (§ 8 Abs. 1 CO2KostAufG): Vereinbarungen, nach denen der Mieter mehr als 50 Prozent
// der CO₂-Kosten trägt, sind unwirksam; ein Nichtwohngebäude dient nach seiner Zweckbestimmung nicht
// überwiegend dem Wohnen (Satz 2). Der Wert ist der Anteil des Vermieters in Promille, wie
// `service_landlord_permille`.
export const co2NonResidential: LawParam<number, 'periodStart'> = {
  id: 'co2.non-residential',
  title: 'Anteil des Vermieters im Nichtwohngebäude',
  norm: '§ 8 Abs. 1 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 500, source: checked('§ 8 Abs. 1 CO2KostAufG', '__8.html'), enacted: ENACTED }],
  describe: (v) => `Vermieter mindestens ${v} ‰ (Mieter höchstens die Hälfte)`,
}

// Beschränkungen bei energetischen Verbesserungen (§ 9 CO2KostAufG): Stehen öffentlich-rechtliche
// Vorgaben einer wesentlichen energetischen Verbesserung des Gebäudes oder einer wesentlichen
// Verbesserung der Wärme- und Warmwasserversorgung entgegen, ist der prozentuale Anteil des Vermieters
// nach § 5, 6, 7 oder 8 um die Hälfte zu kürzen (Abs. 1); stehen sie beidem entgegen, erfolgt keine
// Aufteilung (Abs. 2). Berufen darf sich der Vermieter darauf nur mit Nachweis (Abs. 3); das sagt der
// Hinweis, gerechnet wird mit der Angabe an der Anlage.
export const co2Restriction: LawParam<{ readonly factor: number; readonly bothSplit: boolean }, 'periodStart'> = {
  id: 'co2.restriction',
  title: 'Beschränkung bei energetischen Verbesserungen',
  norm: '§ 9 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: { factor: 0.5, bothSplit: false }, source: checked('§ 9 CO2KostAufG', '__9.html'), enacted: ENACTED }],
  describe: (v) => `Anteil des Vermieters × ${String(v.factor).replace('.', ',')}; bei beiden Vorgaben ${v.bothSplit ? 'Aufteilung' : 'keine Aufteilung'}`,
}

// Wärme aus Anlagen im Europäischen Emissionshandel (§ 2 Abs. 4 CO2KostAufG): Das Gesetz gilt auch für
// sie (Satz 1), aber nicht für Gebäude, die erstmals nach dem 1. Januar 2023 einen Wärmeanschluss
// erhalten haben (Satz 2). Der Stichtag steht hier, weil die Frage an der Anlage ihn nennt.
export const co2DistrictEtsNew: LawParam<{ readonly connectedAfter: string }, 'periodStart'> = {
  id: 'co2.district-ets-new',
  title: 'Wärme aus dem Emissionshandel bei neuem Anschluss',
  norm: '§ 2 Abs. 4 Satz 2 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: { connectedAfter: '2023-01-01' }, source: checked('§ 2 Abs. 4 Satz 2 CO2KostAufG', '__2.html'), enacted: ENACTED }],
  describe: (v) => `nicht anzuwenden bei erstem Wärmeanschluss nach dem ${germanDate(v.connectedAfter)}`,
}
```

Den Import aus `'./register.ts'` um `germanDate` ergänzen, falls er dort noch fehlt (PR 6 importiert
nur Typen).

`shared/law/params.ts`: den Import aus `'./co2kostaufg.ts'` um `co2DistrictEtsNew, co2NonResidential,
co2Restriction` ergänzen und in `LAW_PARAMS` (nach Kennung geordnet) so einreihen:

```ts
  co2ApplicableFrom,
  co2CutMissing,
  co2DistrictEtsNew,
  co2NonResidential,
  co2Restriction,
  co2RoundingDecimals,
  co2StageTable,
```

- [ ] **Step 4: Regeln (`shared/law/rules.ts`)**

In `RULES` hinter `heating-dhw-split` (PR 6) anhängen:

```ts
  {
    // Heizung PR 7 (#97): § 8 CO2KostAufG im Wortlaut geprüft am 05.10.2026.
    code: 'co2-non-residential',
    title: 'CO₂-Kosten im Nichtwohngebäude',
    norm: '§ 8 CO2KostAufG',
    summary:
      'Dient ein Gebäude nach seiner Zweckbestimmung nicht überwiegend dem Wohnen, gilt keine Stufentabelle: ' +
      'Vereinbarungen, nach denen der Mieter mehr als die Hälfte der CO₂-Kosten trägt, sind unwirksam; der Vermieter trägt also mindestens die Hälfte.',
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 7 (#97): § 9 CO2KostAufG im Wortlaut geprüft am 05.10.2026.
    code: 'co2-restriction',
    title: 'CO₂-Kosten bei Beschränkungen',
    norm: '§ 9 CO2KostAufG',
    summary:
      'Stehen öffentlich-rechtliche Vorgaben (etwa Denkmalschutz, Anschluss- und Benutzungszwang, Erhaltungssatzung) einer wesentlichen energetischen Verbesserung des Gebäudes oder seiner Wärmeversorgung entgegen, ' +
      'wird der Anteil des Vermieters um die Hälfte gekürzt; stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt. ' +
      'Darauf berufen kann sich der Vermieter nur, wenn er dem Mieter die Umstände nachweist.',
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 7 (#97): § 7 Abs. 2 HeizkostenV im Wortlaut, BGH VIII ZR 156/11 Rn. 14 geprüft am
    // 05.10.2026 (Entwurf 2, 3.2, 8.2).
    code: 'heating-consumed-fuel',
    title: 'Kosten des verbrauchten Brennstoffs',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    summary:
      'Umgelegt werden die Kosten der im Abrechnungszeitraum verbrauchten Brennstoffe, nicht der bezahlten Rechnungen. ' +
      'Reicht eine Rechnung des Versorgers über das Ende des Zeitraums hinaus, ist sie abzugrenzen; eine sachgerechte Schätzung ist dabei zulässig.',
  },
```

(`CO2_FROM` steht seit PR 6 in rules.ts.)

`RULES_AS_OF` bleibt `'2026-10-05'`.

- [ ] **Step 5: Lexikon (`shared/glossary.ts`)**

In `GLOSSARY.degreeDays` (PR 3) `needed` ersetzen:

```ts
    needed: 'Im Rumpfzeitraum rechnet Mietfuchs damit den Vorschlag für die neue Vorauszahlung hoch. Reicht eine Gas-, Fernwärme- oder Stromrechnung über das Ende der Heizperiode hinaus, teilt es damit den Verbrauch auf die Heizperioden auf, wenn weder ein Zählerstand zum Stichtag noch eine Zwischenrechnung des Versorgers vorliegt. Die Werte stammen aus der Praxis der Messdienste; die Norm DIN 94680, in der sie heute stehen, hat Mietfuchs nicht gelesen.',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-literals.test.ts test/law-wording.test.ts test/rechtstexte.test.ts test/law-release.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Prüft `law-wording.test.ts` oder `rechtstexte.test.ts` die Liste der Regelcodes
wörtlich, dort `'co2-non-residential', 'co2-restriction', 'heating-consumed-fuel'` am Ende ergänzen;
der Wortlaut der bestehenden Regeln ändert sich nicht.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS. Ein Test, der `legalBasis.rules` einer Abrechnung ab 2023 wörtlich vergleicht (PR 6
hat ihn um `co2-split` ergänzt), bekommt `co2-non-residential` und `co2-restriction` an der Stelle, an
der `rulesFor` sie liefert, und `heating-consumed-fuel` (ohne Gültigkeitsgrenze, also in jedem Jahr).
Andere Erwartungen ändern sich nicht.

```bash
git add shared/law shared/glossary.ts server/test
git commit -m "Rechtsregister: Nichtwohngebäude (§ 8), Beschränkungen (§ 9) und Wärme aus dem Emissionshandel (§ 2 Abs. 4 CO2KostAufG)

Dazu die Regeln co2-non-residential, co2-restriction und heating-consumed-fuel; das Lexikon
nennt die Gradtage auch für die Abgrenzung einer Versorgerrechnung.

Refs #97"
```

---
### Task 2: Datenmodell und Migrationen 0022/0023

Vier neue Tabellen, eine Spalte an `cost_items`, drei an `heating_plants`; zwei erzeugte Schritte (erst
Tabellen und Spalten, dann die Bedingungen an den bestehenden Tabellen, README „Neue Spalten und
geänderte Bedingungen nie in einem Schritt“).

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `client/src/landlordReasons.ts`
- Create (erzeugt): `server/drizzle/0022_lieferungen.sql`, `server/drizzle/0023_lieferungen_bedingungen.sql`, `server/drizzle/meta/0022_snapshot.json`, `server/drizzle/meta/0023_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `client/src/landlordReasons.test.ts`

**Interfaces:**
- Consumes (PR 2–6): `exactly`, `oneOf`, `notNegative`, `periodKeyCheck`, `propertyRef`, `heatingPlants`, `heatingPeriods`, `units`, `properties`, `costItems`, `PeriodKey`, `HeatingPlant`, `CostItem`, `LandlordReason`, `SettlementRow`, `HeatingStatement`, `Co2Assessment`, `HeatingPeriodView`.
- Produces:
  - Typen: `FuelQuantityUnit = 'l' | 'kg' | 'm3' | 'kWh' | 'srm'`, `GasBasis = 'hs' | 'hi'`, `Co2Restriction = 'none' | 'building' | 'supply' | 'both'`, `FuelDeliveryPart`, `FuelDelivery`, `DegreeDayValue`, `FrozenFuelCarry`, `FuelMethod`, `FuelDeliveryLine`, `FuelCarryLine`, `FuelEstimateProposal`, `FuelGap`, `FuelAssessment`, `FuelGapQuestion` (Felder in Step 3)
  - `HeatingPlant.nonResidential: boolean`, `.restriction: Co2Restriction`, `.districtEtsNew: boolean`; `CostItem.fuelDeliveryId?: string | null`; `LandlordReason` + `'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff'`; `SettlementRow.kind?: 'co2Relief' | 'fuelCarry'`; `HeatingStatement.fuel?: FuelAssessment`; `Co2Assessment.basis?`, `.coveragePermille?`; `HeatingPeriodView['items']` mit `'fuelDeliveryId'`
  - schema.ts: `FUEL_QUANTITY_UNITS`, `GAS_BASES`, `CO2_RESTRICTIONS`, `fuelDeliveries`, `fuelDeliveryParts`, `fuelCarryFrozen`, `degreeDayValues`; Spalten `heatingPlants.nonResidential`, `.restriction`, `.districtEtsNew`, `costItems.fuelDeliveryId`

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um `DegreeDayValue,
FrozenFuelCarry, FuelDelivery, FuelDeliveryPart` ergänzen. Hinter den Zusicherungen von PR 6
(`_Co2Reliefs`) einfügen:

```ts
// --- Lieferungen (Heizung PR 7) ---
// Die Teilmengen stehen in einer eigenen Tabelle; eingefroren wird je Zeile in `heating_periods`.
type _FuelDeliveries = Assert<Matches<typeof schema.fuelDeliveries.$inferSelect, Omit<FuelDelivery, 'parts'>>>
type _FuelParts = Assert<Matches<Omit<typeof schema.fuelDeliveryParts.$inferSelect, 'deliveryId'>, FuelDeliveryPart>>
type _FuelFrozen = Assert<Matches<typeof schema.fuelCarryFrozen.$inferSelect, Omit<FrozenFuelCarry, 'plantId' | 'period'> & { heatingPeriodId: string }>>
type _DegreeDays = Assert<Matches<Omit<typeof schema.degreeDayValues.$inferSelect, 'propertyId'>, DegreeDayValue>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ in die erwartete (alphabetische)
Liste einfügen: `'degree_day_values',` vor `'flat_rates',` (bzw. an der alphabetisch richtigen Stelle),
`'fuel_carry_frozen', 'fuel_deliveries', 'fuel_delivery_parts',` hinter `'flat_rates',`.

Ans Ende anhängen:

```ts
// ---------- Lieferungen (Heizung PR 7) ----------

const eineGasanlage = [
  "INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'gas', 'manual')",
  "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')",
]

test('Lieferungen: Rechnungszeitraum paarweise und geordnet, Anteil bis 1000 ‰, Zahlen nicht negativ', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    assert.equal(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d1', 'hp1', '2025-03-15', '2026-03-14')"), null)
    assert.deepEqual(connection.rows("SELECT label, estimated, used_by_service FROM fuel_deliveries")[0], ['', 0, 1])
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from) VALUES ('d2', 'hp1', '2025-03-15')"), 'Beginn ohne Ende')
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d3', 'hp1', '2026-03-14', '2025-03-15')"), 'Ende vor Beginn')
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d4', 'hp1', '15.03.2025', '14.03.2026')"), 'kein ISO-Datum')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET share_permille = 1001"), 'über 1000 ‰')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET fixed_cents = -1"), 'negativer fester Teil')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET emissions_kg = -1"), 'negativer Ausstoß')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET quantity_unit = 'fass'"), 'unbekannte Einheit')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET heating_value = 0"), 'Heizwert 0')
    assert.equal(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-03-15', '2025-12-31', 500000)"), null)
    assert.ok(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-03-15', '2025-12-31', 1)"), 'dieselbe Teilmenge zweimal')
    assert.ok(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2026-01-02', '2026-01-01', 1)"), 'Teilmenge endet vor Beginn')
  } finally {
    cleanup()
  }
})

test('Lieferungen: die Anlage bleibt stehen, Teilmengen fallen mit, Positionen und Eingefrorenes halten die Lieferung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    connection.exec("INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d1', 'hp1', '2025-01-01', '2025-12-31')")
    connection.exec("INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-01-01', '2025-06-30', 100)")
    connection.exec("INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id, fuel_delivery_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Gas', 100000, 'area', 'hp1', 'd1')")
    assert.ok(rejects(connection, "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, fuel_delivery_id) VALUES ('c2', 'objekt-1', '2025-01', 'Grundsteuer', 'G', 1, 'area', 'd1')"), 'Lieferung an einer kalten Position')
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'die Lieferung hält die Anlage')
    assert.ok(rejects(connection, "DELETE FROM fuel_deliveries WHERE id = 'd1'"), 'die Position hält die Lieferung')
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    connection.exec("INSERT INTO fuel_carry_frozen (delivery_id, heating_period_id, cents) VALUES ('d1', 'h1', -98339)")
    assert.deepEqual(connection.rows('SELECT emissions_kg, co2_cents FROM fuel_carry_frozen')[0], [0, 0])
    assert.ok(rejects(connection, "DELETE FROM fuel_deliveries WHERE id = 'd1'"), 'das Eingefrorene hält die Lieferung')
    connection.exec('DELETE FROM fuel_carry_frozen')
    connection.exec("DELETE FROM fuel_deliveries WHERE id = 'd1'")
    assert.equal(Number(connection.rows('SELECT count(*) FROM fuel_delivery_parts')[0]?.[0]), 0, 'die Teilmengen fallen mit')
  } finally {
    cleanup()
  }
})

test('CO₂-Merkmale der Anlage und Ortswerte der Gradtage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    assert.deepEqual(connection.rows('SELECT non_residential, restriction, district_ets_new FROM heating_plants')[0], [0, 'none', 0])
    assert.ok(rejects(connection, "UPDATE heating_plants SET restriction = 'denkmal'"), 'unbekannte Beschränkung')
    assert.ok(rejects(connection, 'UPDATE heating_plants SET district_ets_new = 1'), 'Emissionshandel nur bei Fernwärme')
    assert.equal(rejects(connection, "UPDATE heating_plants SET energy = 'districtHeating', district_ets_new = 1"), null)
    assert.equal(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-01', 412.5)"), null)
    assert.ok(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-13', 1)"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-02', 0)"), 'Wert 0')
  } finally {
    cleanup()
  }
})
```

(b) `client/src/landlordReasons.test.ts`: In der Liste `reasons` des Tests „jeder Grund hat eine
Beschriftung“ `'fuelCarry', 'fuelClosedPeriod', 'fuelEstimateDiff'` vor `'rounding'` einfügen und
anhängen:

```ts
test('Brennstoff anderer Heizperioden (Heizung PR 7)', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelCarry', cents: 98339 }] }))).toBe('Brennstoff einer anderen Heizperiode (Abgrenzung)')
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelClosedPeriod', cents: 98339 }] }))).toBe('Brennstoff einer abgeschlossenen Heizperiode')
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelEstimateDiff', cents: -6661 }] }))).toBe('Abweichung von der Schätzung')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'fuelDeliveries' does not exist` (schema.test.ts) und `Type '"fuelCarry"'
is not assignable to type 'LandlordReason'` (landlordReasons.test.ts).

- [ ] **Step 3: Typen (`shared/types.ts`)**

`HeatingPlant` (PR 4, mit den Feldern aus PR 5) bekommt hinter `changeSplit`:

```ts
  // CO₂-Merkmale (Heizung PR 7, Entwurf 5.3): Nichtwohngebäude (§ 8 CO2KostAufG), Beschränkungen bei
  // energetischen Verbesserungen (§ 9) und Wärme aus dem Emissionshandel bei erstem Anschluss nach
  // dem Stichtag (§ 2 Abs. 4 Satz 2, nur bei Fernwärme).
  nonResidential: boolean
  restriction: Co2Restriction
  districtEtsNew: boolean
```

`CostItem` bekommt als letztes Feld:

```ts
  // Die Lieferung, deren Rechnung die Position ist (Heizung PR 7, Entwurf 5.4, G-C4): Abschläge,
  // Schlussrechnung und Gutschrift zeigen auf dieselbe Lieferung und werden im selben Verhältnis
  // abgegrenzt. Nur bei der Kostenart „Heizung und Warmwasser“ einer Anlage mit freien Schlüsseln.
  fuelDeliveryId?: string | null
```

`LandlordReason` (samt Kommentar darüber drei Zeilen ergänzt):

```ts
//   `fuelCarry`        Gegenzeile zu einem Übertrag (Heizung PR 7): der Teil einer Rechnung, der in
//                      eine andere Heizperiode gehört; über die Zeiträume hinweg null
//   `fuelClosedPeriod` der Teil für eine abgeschlossene Heizperiode, die ohne Schätzung abgeschlossen wurde
//   `fuelEstimateDiff` tatsächlicher Teil minus Schätzung einer abgeschlossenen Heizperiode, mit Vorzeichen
export type LandlordReason =
  | 'notAllocable' | 'noBasis' | 'selfUse' | 'vacancy' | 'flatRate' | 'inclusive'
  | 'outsideUnit' | 'amountsRest' | 'customRest' | 'mainMeterRest' | 'co2Share'
  | 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff' | 'rounding'
```

In `SettlementRow` die Zeile `kind?: 'co2Relief'` (PR 6) ersetzen:

```ts
  // `fuelCarry` (Heizung PR 7): der Teil einer Brennstoffrechnung aus einer anderen Heizperiode,
  // verteilt mit dem Schlüssel ihrer Position; `costItemId` ist `fuel:<Lieferung>:<Heizperiode>:<Position>`.
  kind?: 'co2Relief' | 'fuelCarry'
```

In `Co2Assessment` (PR 6) hinter `tenants: Co2TenantLine[]`:

```ts
  // Woher die Angaben stammen (Heizung PR 7): laut Messdienst oder von Mietfuchs aus den Lieferungen,
  // dann mit der Abdeckung der Heizperiode durch die Rechnungen in Promille der Gradtage. Fehlt das
  // Feld (vor PR 7 abgeschlossen), sind es Angaben laut Messdienst.
  basis?: 'service' | 'deliveries'
  coveragePermille?: number | null
```

In `HeatingStatement` (PR 6) hinter `co2: Co2Assessment | null`:

```ts
  // Lieferungen, Abgrenzung, Überträge und Lücken dieser Heizperiode (Heizung PR 7); fehlt ohne Lieferungen.
  fuel?: FuelAssessment
```

In `HeatingPeriodView['items']` (PR 6) die Liste der gepickten Felder um `'fuelDeliveryId'` ergänzen.

Ans Dateiende:

```ts
// ---------- Brennstofflieferungen (Heizung PR 7, Entwurf 5.4, 8.2) ----------

export type FuelQuantityUnit = 'l' | 'kg' | 'm3' | 'kWh' | 'srm'
// Gas nach Brennwert (Hₛ) oder Heizwert (Hᵢ) abgerechnet.
export type GasBasis = 'hs' | 'hi'
// § 9 CO2KostAufG: Vorgaben stehen einer Verbesserung des Gebäudes, der Wärmeversorgung oder beidem entgegen.
export type Co2Restriction = 'none' | 'building' | 'supply' | 'both'

// Eine Teilmenge laut Rechnung (Stufe 3 in 3.2): ein Teilzeitraum mit eigener Menge und eigenem Betrag,
// etwa bei einer Preisänderung. `fixedCents` ist sein fester Preisbestandteil.
export type FuelDeliveryPart = {
  from: string
  to: string
  energyKwh: number | null
  amountCents: number
  fixedCents: number | null
  emissionsKg: number | null
  co2CostCents: number | null
}

// Eine Rechnung des Versorgers an der Heizanlage. `amountCents` steht nur bei einer Anlage mit
// Messdienst (dort zeigt keine Position auf die Lieferung) und bei einer Schätzung; sonst ist der Betrag
// die Summe der verknüpften Positionen. `sharePermille` ist ein eingetragener Anteil des
// verbrauchsabhängigen Teils an der Heizperiode, in der die Rechnung endet (Stufe 0). `estimated`:
// beim Abschluss geschätzt, weil die Rechnung fehlte (8.2). `usedByService`: der Messdienst hat die
// Rechnung in seinen Brennstoffkosten angesetzt (7.6).
export type FuelDelivery = {
  id: string
  plantId: string
  label: string
  invoiceDate: string | null
  deliveredAt: string | null
  invoiceFrom: string | null
  invoiceTo: string | null
  unitId: string | null
  amountCents: number | null
  quantity: number | null
  quantityUnit: FuelQuantityUnit | null
  energyKwh: number | null
  gasBasis: GasBasis | null
  heatingValue: number | null
  emissionsKg: number | null
  co2CostCents: number | null
  emissionFactor: number | null
  gridFeeCents: number | null
  bioCostCents: number | null
  sharePermille: number | null
  fixedCents: number | null
  estimated: boolean
  usedByService: boolean
  parts: FuelDeliveryPart[]
}

// Eine Gradtagzahl des Deutschen Wetterdienstes für den Ort des Objekts und einen Monat ('JJJJ-MM').
export type DegreeDayValue = { month: string; value: number }

// Was eine abgeschlossene Heizperiode je Lieferung herein- (+) oder hinausgebucht (−) hat, dazu Ausstoß
// und CO₂-Kosten dieser Lieferung in der Heizperiode (G-A4).
export type FrozenFuelCarry = { deliveryId: string; plantId: string; period: PeriodKey; cents: number; emissionsKg: number; co2Cents: number }

// Wie der Teil einer Lieferung bestimmt ist (Stufen in 3.2).
export type FuelMethod = 'entered' | 'measured' | 'inside' | 'parts' | 'localDegreeDays' | 'degreeDays'

// Eine Lieferung in der Bewertung einer Heizperiode: ihr Anteil am Verbrauch (‰), ob sie geteilt ist,
// ihr Betrag und der Teil dieser Heizperiode, Ausstoß und CO₂-Kosten darin.
export type FuelDeliveryLine = {
  deliveryId: string
  label: string
  from: string | null
  to: string | null
  estimated: boolean
  method: FuelMethod
  sharePermille: number
  fixedKnown: boolean
  split: boolean
  amountCents: number | null
  inPeriodCents: number | null
  emissionsKg: number | null
  co2Cents: number | null
}

// Ein Übertrag der Mieterseite dieser Heizperiode aus oder in die Heizperiode `period`.
export type FuelCarryLine = { deliveryId: string; period: PeriodKey; cents: number }

// Der Vorschlag einer geschätzten Lieferung für eine Lücke (8.2 Nr. 2), aus der letzten Rechnung.
export type FuelEstimateProposal = {
  from: string
  to: string
  amountCents: number
  emissionsKg: number | null
  co2CostCents: number | null
  basedOn: string
  byMeter: boolean
}

export type FuelGap = { from: string; to: string; days: number; permille: number; estimate: FuelEstimateProposal | null }

export type FuelAssessment = {
  coveragePermille: number
  emissionsKg: number | null
  co2Cents: number | null
  deliveries: FuelDeliveryLine[]
  carries: FuelCarryLine[]
  gaps: FuelGap[]
}

// Die Rückfrage beim Abschluss (8.2, Dialog „Trotzdem abschließen?“).
export type FuelGapQuestion = { plantId: string; plantName: string; period: PeriodKey; from: string; to: string; amountCents: number }
```

- [ ] **Step 4: Erster Schritt: Tabellen und Spalten (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `Co2Restriction, FuelQuantityUnit, GasBasis`
ergänzen.

In `heatingPlants` (PR 4) hinter `unitsLimited`:

```ts
    // CO₂-Merkmale (Heizung PR 7): § 8, § 9 und § 2 Abs. 4 Satz 2 CO2KostAufG.
    nonResidential: integer('non_residential', { mode: 'boolean' }).notNull().default(false),
    restriction: text('restriction', { enum: CO2_RESTRICTIONS }).notNull().default('none'),
    districtEtsNew: integer('district_ets_new', { mode: 'boolean' }).notNull().default(false),
```

`CO2_RESTRICTIONS` steht dafür **vor** `heatingPlants`, bei den Listen der Heizanlage:

```ts
export const CO2_RESTRICTIONS = exactly<Co2Restriction>()(['none', 'building', 'supply', 'both'] as const)
export const FUEL_QUANTITY_UNITS = exactly<FuelQuantityUnit>()(['l', 'kg', 'm3', 'kWh', 'srm'] as const)
export const GAS_BASES = exactly<GasBasis>()(['hs', 'hi'] as const)
```

Hinter den Tabellen von PR 5 und vor `// ---------- Kostenpositionen ----------`:

```ts
// ---------- Brennstofflieferungen (Heizung PR 7, Entwurf 5.4) ----------

const isoDate = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" IS NULL OR "${column}" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`))

// Eine Rechnung des Versorgers an der Anlage. `RESTRICT` auf die Anlage: Eine Anlage mit Lieferungen
// wird nicht still mitgelöscht (removeHeatingPlant lehnt mit einem Satz ab). `unit_id` ist für
// Etagenheizungen (PR 9), Netzentgelte und Biobrennstoff für § 5a (PR 18); bis dahin lehnt der Server
// eine Angabe ab, die Spalten stehen schon hier, damit die Tabelle nicht neu gebaut wird.
export const fuelDeliveries = sqliteTable(
  'fuel_deliveries',
  {
    id: text('id').primaryKey().notNull(),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'restrict' }),
    label: text('label').notNull().default(''),
    invoiceDate: text('invoice_date'),
    deliveredAt: text('delivered_at'),
    invoiceFrom: text('invoice_from'),
    invoiceTo: text('invoice_to'),
    unitId: text('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents'),
    quantity: real('quantity'),
    quantityUnit: text('quantity_unit', { enum: FUEL_QUANTITY_UNITS }),
    energyKwh: real('energy_kwh'),
    gasBasis: text('gas_basis', { enum: GAS_BASES }),
    heatingValue: real('heating_value'),
    emissionsKg: real('emissions_kg'),
    co2CostCents: integer('co2_cost_cents'),
    emissionFactor: real('emission_factor'),
    gridFeeCents: integer('grid_fee_cents'),
    bioCostCents: integer('bio_cost_cents'),
    sharePermille: real('share_permille'),
    fixedCents: integer('fixed_cents'),
    estimated: integer('estimated', { mode: 'boolean' }).notNull().default(false),
    usedByService: integer('used_by_service', { mode: 'boolean' }).notNull().default(true),
  },
  () => [
    oneOf('fuel_deliveries_quantity_unit_known', 'quantity_unit', FUEL_QUANTITY_UNITS),
    oneOf('fuel_deliveries_gas_basis_known', 'gas_basis', GAS_BASES),
    check('fuel_deliveries_invoice_pair', sql.raw('("invoice_from" IS NULL) = ("invoice_to" IS NULL)')),
    isoDate('fuel_deliveries_invoice_from_date', 'invoice_from'),
    isoDate('fuel_deliveries_invoice_to_date', 'invoice_to'),
    isoDate('fuel_deliveries_invoice_date_date', 'invoice_date'),
    isoDate('fuel_deliveries_delivered_at_date', 'delivered_at'),
    check('fuel_deliveries_invoice_order', sql.raw('"invoice_from" IS NULL OR "invoice_from" <= "invoice_to"')),
    check('fuel_deliveries_share_valid', sql.raw('"share_permille" BETWEEN 0 AND 1000')),
    check('fuel_deliveries_heating_value_positive', sql.raw('"heating_value" > 0')),
    notNegative('fuel_deliveries_quantity_not_negative', 'quantity'),
    notNegative('fuel_deliveries_energy_not_negative', 'energy_kwh'),
    notNegative('fuel_deliveries_emissions_not_negative', 'emissions_kg'),
    notNegative('fuel_deliveries_co2_not_negative', 'co2_cost_cents'),
    notNegative('fuel_deliveries_factor_not_negative', 'emission_factor'),
    notNegative('fuel_deliveries_fixed_not_negative', 'fixed_cents'),
    notNegative('fuel_deliveries_grid_fee_not_negative', 'grid_fee_cents'),
    notNegative('fuel_deliveries_bio_not_negative', 'bio_cost_cents'),
  ],
)

// Die Teilmengen laut Rechnung (Stufe 3 in 3.2, Z-B4), eine Zeile je Teilzeitraum.
export const fuelDeliveryParts = sqliteTable(
  'fuel_delivery_parts',
  {
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => fuelDeliveries.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    to: text('to').notNull(),
    energyKwh: real('energy_kwh'),
    amountCents: integer('amount_cents').notNull(),
    fixedCents: integer('fixed_cents'),
    emissionsKg: real('emissions_kg'),
    co2CostCents: integer('co2_cost_cents'),
  },
  (t) => [
    primaryKey({ columns: [t.deliveryId, t.from] }),
    isoDate('fuel_delivery_parts_from_date', 'from'),
    isoDate('fuel_delivery_parts_to_date', 'to'),
    check('fuel_delivery_parts_order', sql.raw('"from" <= "to"')),
    notNegative('fuel_delivery_parts_energy_not_negative', 'energy_kwh'),
    notNegative('fuel_delivery_parts_fixed_not_negative', 'fixed_cents'),
    notNegative('fuel_delivery_parts_emissions_not_negative', 'emissions_kg'),
    notNegative('fuel_delivery_parts_co2_not_negative', 'co2_cost_cents'),
  ],
)

// Was eine abgeschlossene Heizperiode je Lieferung herein- oder hinausgebucht hat (G-A4). `RESTRICT` auf
// die Lieferung: Mit eingefrorenem Teil ist sie gesperrt; mit der Heizperiode (also der Anlage) fällt
// die Zeile.
export const fuelCarryFrozen = sqliteTable(
  'fuel_carry_frozen',
  {
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => fuelDeliveries.id, { onDelete: 'restrict' }),
    heatingPeriodId: text('heating_period_id')
      .notNull()
      .references(() => heatingPeriods.id, { onDelete: 'cascade' }),
    cents: integer('cents').notNull(),
    emissionsKg: real('emissions_kg').notNull().default(0),
    co2Cents: integer('co2_cents').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.heatingPeriodId] })],
)

// Die Gradtagzahlen des Deutschen Wetterdienstes für den Ort des Objekts (Stufe 4 in 3.2), je Monat.
// Mit dem Objekt fallen sie.
export const degreeDayValues = sqliteTable(
  'degree_day_values',
  {
    propertyId: text('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    value: real('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.month] }),
    periodKeyCheck('degree_day_values_month_valid', 'month'),
    check('degree_day_values_value_positive', sql.raw('"value" > 0')),
  ],
)
```

In `costItems` als letzte Spalte (hinter `heatingPlantId` aus PR 4):

```ts
    // Die Lieferung der Position (Heizung PR 7). `RESTRICT`: Eine Lieferung mit Positionen wird nicht
    // still gelöscht; removeDelivery verlangt vorher, die Verknüpfung zu lösen.
    fuelDeliveryId: text('fuel_delivery_id').references(() => fuelDeliveries.id, { onDelete: 'restrict' }),
```

(Liegt `periodKeyCheck` in schema.ts hinter den Kostenpositionen, rückt der Block der Lieferungen
hinter dessen Definition; `fuelDeliveries` muss vor `costItems` stehen, `periodKeyCheck` vor
`degreeDayValues`.)

Run: `npm --prefix server run db:generate -- --name lieferungen`

Expected: `server/drizzle/0022_lieferungen.sql` mit je einem `CREATE TABLE` für `degree_day_values`,
`fuel_carry_frozen`, `fuel_deliveries`, `fuel_delivery_parts` samt ihren Bedingungen und Fremdschlüsseln,
einem `ALTER TABLE \`cost_items\` ADD \`fuel_delivery_id\` text REFERENCES fuel_deliveries(id)` und drei
`ALTER TABLE \`heating_plants\` ADD` (`non_residential`, `restriction`, `district_ets_new`, jeweils mit
`DEFAULT … NOT NULL`). **Kein** `__new_`. Steht ein Neubau darin, ist eine Bedingung an einer bestehenden
Tabelle mitgekommen: Datei, Journal-Eintrag und Momentaufnahme löschen, Schema berichtigen, neu erzeugen.
Fragt drizzle-kit nach einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In der Bedingungsliste von `heatingPlants` anhängen:

```ts
    oneOf('heating_plants_restriction_known', 'restriction', CO2_RESTRICTIONS),
    // § 2 Abs. 4 Satz 2 CO2KostAufG betrifft nur Wärmelieferungen (Heizung PR 7).
    check('heating_plants_ets_only_district', sql.raw(`"district_ets_new" = 0 OR "energy" = 'districtHeating'`)),
```

In der Bedingungsliste von `costItems` hinter `cost_items_heating_part_category` (PR 3):

```ts
    // Eine Lieferung gehört nur zu einer Heizposition (Heizung PR 7).
    check('cost_items_fuel_delivery_category', sql.raw(`"fuel_delivery_id" IS NULL OR "category" = 'Heizung und Warmwasser'`)),
```

Run: `npm --prefix server run db:generate -- --name lieferungen_bedingungen`

Expected: `server/drizzle/0023_lieferungen_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, je einem
Neubau `__new_cost_items` und `__new_heating_plants` samt `INSERT INTO … SELECT` (mit den neuen
Spalten), `DROP TABLE`, `RENAME`, den Indizes und `PRAGMA foreign_keys=ON`. Kein `ALTER TABLE … ADD`.
Prüfen:

Run: `grep -c '__new_' server/drizzle/0023_lieferungen_bedingungen.sql && grep -c 'fuel_delivery_id' server/drizzle/0023_lieferungen_bedingungen.sql`
Expected: eine Zahl ≥ 4, dann eine Zahl ≥ 3.

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('lieferungen')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter `'0021_co2_messdienst'` (PR 6) die
beiden ausgegebenen Zeilen einfügen, darüber:

```ts
  // Heizung PR 7. Wird PR 6 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt und die
  // Marken hier ersetzt.
```

Die Prüfsummen sind keine offenen Stellen: Erst die Ausgabe des Befehls nennt sie.

- [ ] **Step 7: Beschriftungen (`client/src/landlordReasons.ts`)**

In `LABELS` vor `rounding`:

```ts
  fuelCarry: 'Brennstoff einer anderen Heizperiode (Abgrenzung)',
  fuelClosedPeriod: 'Brennstoff einer abgeschlossenen Heizperiode',
  fuelEstimateDiff: 'Abweichung von der Schätzung',
```

- [ ] **Step 8: Bestehende Stellen, die `HeatingPlant` vollständig bauen**

Run: `npm run typecheck`
Expected: Fehler nur an Stellen, die ein `HeatingPlant`-Objekt vollständig bauen (`emptyHeatingPlant`
in `server/src/db/heating.ts`, `readHeatingPlants` in `server/src/db/read.ts`, Testhelfer in
`client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.test.tsx` und in Server-Tests).
Dort jeweils ergänzen:

```ts
  nonResidential: false, restriction: 'none', districtEtsNew: false,
```

In `readHeatingPlants` die Felder aus der Zeile lesen: `nonResidential: p.nonResidential, restriction:
p.restriction, districtEtsNew: p.districtEtsNew,`. Gelesen und geschrieben werden sie mit Task 4.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-golden.test.ts test/db-changeover.test.ts test/db-heizanlage.test.ts && npm --prefix client test -- landlordReasons && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/src/db/heating.ts server/src/db/read.ts server/drizzle client/src server/test
git commit -m "Lieferungen: Tabellen, Verknüpfung der Positionen, CO₂-Merkmale der Anlage, Ortswerte

Zwei erzeugte Schritte: erst Tabellen und Spalten, dann die Bedingungen.

Refs #97"
```

---
### Task 3: Reine Rechnung: Abgrenzung, Abdeckung, Überträge, Schätzvorschlag (`server/src/fuel.ts`)

Alles, was ohne Abrechnung prüfbar ist: die Stufen der Abgrenzung (3.2) mit festen Bestandteilen nach
Tagen (R1), die Abdeckung und die Lücken einer Heizperiode (3.3), der umgerechnete Ausstoß und die
abgegrenzten CO₂-Kosten, die Überträge zwischen Heizperioden mit eingefrorenen Werten, Schätzungen und
abgeschlossenen Heizperioden (8.2, Fälle a–f), der Vorschlag einer Schätzung.

**Files:**
- Create: `server/src/fuel.ts`
- Modify: `server/test/law-literals.test.ts`
- Test: `server/test/fuel.test.ts` (neu)

**Interfaces:**
- Consumes: `DegreeDayTable`, `hkvDegreeDays` (PR 3), `degreeDayPermille`, `unionOf`, `DayRange` (`shared/degreeDays.ts`, PR 3), `dayAfter`, `dayBefore`, `onlyVersion` (PR 1), `periodContaining`, `periodOfKey`, `periodsBetween`, `formatDayRange` (PR 2, PR 3), `BillingPeriod`, `PeriodRules`, `HeatingMethod`, `FuelDelivery`, `FuelDeliveryLine`, `FuelGap`, `FuelMethod` (Task 2).
- Produces:
  - `STOCK_ENERGIES: readonly HeatingEnergy[]` (`oil`, `lpg`, `pellets`, `wood`, `coal`), `METERED_ENERGIES` (`gas`, `districtHeating`, `heatPump`, `electric`)
  - `type FuelReading = { date: string; value: number; replacement?: boolean; oldEndValue?: number | null }`
  - `type ShareContext = { table: DegreeDayTable; local: ReadonlyMap<string, number>; readings: readonly FuelReading[] | null }`
  - `type FuelDeliveryInput = Pick<FuelDelivery, 'id' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'>`
  - `rangeOf(d): DayRange | null`, `localDegreeDaySum(range, values): number | null`, `meterQuantity(readings, range): number | null`, `variableShare(seg, h, ctx): { share: number; method: FuelMethod }`, `dayShare(seg, h): number`, `deliveryShare(d, totalCents, h, ctx, entered): DeliveryShare`, `coverageOf(h, ranges, table): { permille: number; gaps: DayRange[] }`
  - `type DeliveryShare = { ratio: number; kgShare: number; method: FuelMethod; fixedKnown: boolean; split: boolean }`
  - `type FuelItem = { id: string; period: string; amountCents: number; fuelDeliveryId?: string | null }`, `type FuelFrozen = { deliveryId: string; period: string; cents: number; emissionsKg: number; co2Cents: number }`
  - `type FuelCarry = { deliveryId: string; kind: 'out' | 'in' | 'estimate'; other: BillingPeriod; cents: number; totalCents: number; ratio: number; method: FuelMethod; frozen: boolean; landlord: { reason: 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff'; cents: number }[]; templates: { itemId: string; raw: number }[]; estimate: { cents: number; ids: string[] } | null }`
  - `type FuelResult = { lines: FuelDeliveryLine[]; carries: FuelCarry[]; coveragePermille: number; gaps: FuelGap[]; emissionsKg: number | null; co2Cents: number | null; serviceCo2Cents: number | null; serviceGrossCents: number | null; missingCo2: string[] }`
  - `plantFuel(input: FuelPlantInput): FuelResult | null` mit `type FuelPlantInput = { method: HeatingMethod; h: BillingPeriod; rules: PeriodRules; deliveries: readonly FuelDeliveryInput[]; items: readonly FuelItem[]; frozen: readonly FuelFrozen[]; closed: ReadonlySet<string>; ctx: ShareContext }`

- [ ] **Step 1: Write the failing tests**

`server/test/fuel.test.ts`:

```ts
// Brennstofflieferungen ohne Abrechnung (Heizung PR 7, Entwurf 3.2, 3.3, 8.2, 12.2 „fuel.test.ts“):
// Stufen der Abgrenzung, feste Bestandteile nach Tagen, Abdeckung, Überträge in den Fällen a–f und der
// Vorschlag einer Schätzung, je mit den Zahlen des Entwurfs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coverageOf, deliveryShare, localDegreeDaySum, meterQuantity, plantFuel, variableShare,
  type FuelDeliveryInput, type FuelPlantInput, type ShareContext,
} from '../src/fuel.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const table = onlyVersion(hkvDegreeDays).value
const ctx: ShareContext = { table, local: new Map(), readings: null }
const near = (a: number, b: number, what: string, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} statt ${b}`)
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const period = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const H = period(MAI, '2025-05')
const H1 = period(MAI, '2024-05')
// Der Gradtagsanteil 15.03.–31.03. eines Jahres: 17 von 31 Märztagen mit 130 ‰.
const MAERZ_REST = (17 * 130) / 31

const delivery = (over: Partial<FuelDeliveryInput>): FuelDeliveryInput => ({
  id: 'd', label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', deliveredAt: null, amountCents: null, fixedCents: null,
  sharePermille: null, emissionsKg: null, co2CostCents: null, estimated: false, usedByService: true, parts: [], ...over,
})

test('Tabelle (Entwurf 3.2): 621,29 ‰ im Jahr 2025, 848,71 ‰ in Mai bis April, 530 ‰ Januar bis April', () => {
  const r = { from: '2025-03-15', to: '2026-03-14' }
  near(variableShare(r, { from: '2025-01-01', to: '2025-12-31' }, ctx).share * 1000, MAERZ_REST + 550, '2025')
  assert.equal((variableShare(r, H, ctx).share * 1000).toFixed(2), '848.71')
  assert.equal(variableShare(r, H, ctx).method, 'degreeDays')
  near(variableShare({ from: '2025-01-01', to: '2025-12-31' }, { from: '2025-01-01', to: '2025-04-30' }, ctx).share * 1000, 530, 'Winter-Rumpf')
  // Ganz drin oder ganz draußen ist die Zwischenrechnung (Stufe 2).
  assert.deepEqual(variableShare({ from: '2025-06-01', to: '2025-06-30' }, H, ctx), { share: 1, method: 'inside' })
  assert.deepEqual(variableShare({ from: '2024-06-01', to: '2024-06-30' }, H, ctx), { share: 0, method: 'inside' })
})

test('6.500 € nach Gradtagen: 4.038,39 € für 2025, tagesgenau wären es 5.200,00 € (verworfen)', () => {
  const s = deliveryShare(delivery({}), 650000, { from: '2025-01-01', to: '2025-12-31' }, ctx, null)
  assert.equal(Math.round(650000 * s.ratio), 403839)
  assert.equal(Math.round((650000 * 292) / 365), 520000)
  assert.deepEqual([s.method, s.fixedKnown, s.split], ['degreeDays', false, true])
})

test('R1: Grund- und Leistungspreis nach Tagen, 1.600,00 € statt 1.242,58 € nach Gradtagen', () => {
  const fern = delivery({ fixedCents: 200000 })
  const s = deliveryShare(fern, 200000, { from: '2025-01-01', to: '2025-12-31' }, ctx, null)
  assert.equal(Math.round(200000 * s.ratio), 160000)
  assert.equal(Math.round(200000 * (MAERZ_REST + 550) / 1000), 124258)
  assert.equal(s.fixedKnown, true)
  // CO₂ hängt nur an der Menge: Der Anteil für kg und C bleibt der verbrauchsabhängige.
  near(s.kgShare, (MAERZ_REST + 550) / 1000, 'kg')
})

test('Stufe 1 mit Preisabschnitten: Zählerstände genau an den Grenzen, je Abschnitt geteilt', () => {
  const readings = [{ date: '2025-03-14', value: 1000 }, { date: '2025-04-30', value: 3000 }, { date: '2025-12-31', value: 9000 }]
  const parts = [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: null, amountCents: 500000, fixedCents: null, emissionsKg: null, co2CostCents: null },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: null, amountCents: 150000, fixedCents: null, emissionsKg: null, co2CostCents: null },
  ]
  const s = deliveryShare(delivery({ parts }), 650000, H, { ...ctx, readings }, null)
  assert.equal(s.method, 'parts')
  // Abschnitt 1: 6.000 von 8.000 nach dem Zähler; Abschnitt 2 ganz in der Heizperiode.
  assert.equal(Math.round(650000 * s.ratio), 525000)
  assert.equal(variableShare({ from: '2025-03-15', to: '2025-12-31' }, H, { ...ctx, readings }).method, 'measured')
})

test('Stufe 3 mit zwei Teilmengen ohne Zähler: je Teilmenge nach Gradtagen', () => {
  const parts = [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: null, amountCents: 500000, fixedCents: null, emissionsKg: null, co2CostCents: null },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: null, amountCents: 150000, fixedCents: null, emissionsKg: null, co2CostCents: null },
  ]
  const s = deliveryShare(delivery({ parts }), 650000, H, ctx, null)
  assert.equal(Math.round(650000 * s.ratio), Math.round(500000 * (550 / (MAERZ_REST + 550)) + 150000))
})

test('Stufe 4 mit Ortswerten: geht der Tabelle vor, fehlt ein Monat, gilt die Tabelle', () => {
  // Je Monat so viele Gradtage wie Tage: Jeder Tag zählt gleich, der Anteil ist der der Tage.
  const local = new Map<string, number>()
  for (let m = 3; m <= 12; m++) local.set(`2025-${String(m).padStart(2, '0')}`, new Date(Date.UTC(2025, m, 0)).getUTCDate())
  for (const [m, d] of [['01', 31], ['02', 28], ['03', 31]] as const) local.set(`2026-${m}`, d)
  const s = variableShare({ from: '2025-03-15', to: '2026-03-14' }, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, local })
  assert.equal(s.method, 'localDegreeDays')
  near(s.share, 292 / 365, 'Ortswerte')
  assert.equal(localDegreeDaySum({ from: '2025-03-15', to: '2025-03-16' }, local), 2)
  local.delete('2025-07')
  assert.equal(variableShare({ from: '2025-03-15', to: '2026-03-14' }, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, local }).method, 'degreeDays')
})

test('Eingetragener Anteil schlägt alles, auch den Zählerstand (Stufe 0); feste Teile bleiben nach Tagen', () => {
  const readings = [{ date: '2025-03-14', value: 1000 }, { date: '2025-12-31', value: 9000 }, { date: '2026-03-14', value: 11000 }]
  const s = deliveryShare(delivery({ sharePermille: 900 }), 650000, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, readings }, 100)
  assert.deepEqual([s.method, s.kgShare], ['entered', 0.1])
  const mitFix = deliveryShare(delivery({ sharePermille: 900, fixedCents: 36500 }), 650000, { from: '2025-01-01', to: '2025-12-31' }, ctx, 100)
  assert.equal(Math.round(650000 * mitFix.ratio), Math.round(29200 + (650000 - 36500) * 0.1))
  // Über plantFuel: Der eingetragene Anteil gilt für die Heizperiode, in der die Rechnung endet.
  const r = plantFuel(input({ rules: CALENDAR_RULES, h: period(CALENDAR_RULES, '2026-01'), deliveries: [delivery({ sharePermille: 900 })], items: [{ id: 'gas', period: '2026-01', amountCents: 650000, fuelDeliveryId: 'd' }] })) ?? assert.fail('kein Ergebnis')
  assert.deepEqual([r.lines[0]?.method, r.lines[0]?.sharePermille], ['entered', 900])
})

test('Zählerstand: Wechsel mit Endstand zählt, ohne Endstand oder ohne Stand an der Grenze keine Menge (Review Focus 4)', () => {
  const r = { from: '2025-03-15', to: '2025-12-31' }
  const mitWechsel = [{ date: '2025-03-14', value: 1000 }, { date: '2025-06-30', value: 0, replacement: true, oldEndValue: 2500 }, { date: '2025-12-31', value: 3000 }]
  assert.equal(meterQuantity(mitWechsel, r), 4500)
  assert.equal(meterQuantity([{ date: '2025-03-14', value: 1000 }, { date: '2025-06-30', value: 0, replacement: true, oldEndValue: null }, { date: '2025-12-31', value: 3000 }], r), null)
  assert.equal(meterQuantity([{ date: '2025-03-13', value: 1000 }, { date: '2025-12-31', value: 3000 }], r), null)
  // Zwei Stände am Stichtag: Es gilt der letzte.
  assert.equal(meterQuantity([{ date: '2025-03-14', value: 900 }, { date: '2025-03-14', value: 1000 }, { date: '2025-12-31', value: 3000 }], r), 2000)
})

test('Abdeckung (Entwurf 3.3): 848,71 ‰, Lücke 15.03.–30.04.2026 mit 151,29 ‰', () => {
  const c = coverageOf(H, [{ from: '2025-03-15', to: '2026-03-14' }], table)
  assert.equal(c.permille.toFixed(2), '848.71')
  assert.deepEqual(c.gaps, [{ from: '2026-03-15', to: '2026-04-30' }])
  assert.deepEqual(coverageOf(H, [], table).gaps, [{ from: H.from, to: H.to }])
})

// ---------- Überträge (Entwurf 8.2, Fälle a–f; `fixed_cents = null`) ----------

const GAS = delivery({})
const gasItem = { id: 'gas', period: '2025-05', amountCents: 650000, fuelDeliveryId: 'd' }
const VORJAHR = delivery({ id: 'd0', label: 'Gas 2024/2025', invoiceFrom: '2024-03-15', invoiceTo: '2025-03-14', emissionsKg: 12000, co2CostCents: 60000 })
const vorjahrItem = { id: 'gas0', period: '2024-05', amountCents: 600000, fuelDeliveryId: 'd0' }
const schaetzung = (cents: number) => delivery({ id: 'e', label: 'Schätzung', invoiceFrom: '2025-03-15', invoiceTo: '2025-04-30', amountCents: cents, estimated: true })
function input(over: Partial<FuelPlantInput>): FuelPlantInput {
  return { method: 'manual', h: H, rules: MAI, deliveries: [GAS], items: [gasItem], frozen: [], closed: new Set(), ctx, ...over }
}
const carryOf = (r: ReturnType<typeof plantFuel>, id = 'd') => r?.carries.find((c) => c.deliveryId === id) ?? assert.fail(`kein Übertrag ${id}`)

test('Fall a: H−1 offen; H bucht 983,39 € hinaus, H−1 herein; die Summe bleibt 6.500,00 €', () => {
  const aus = carryOf(plantFuel(input({})))
  assert.deepEqual([aus.kind, aus.other.key, aus.cents, aus.landlord], ['out', '2024-05', -98339, [{ reason: 'fuelCarry', cents: 98339 }]])
  assert.equal(aus.templates.reduce((a, t) => a + t.raw, 0).toFixed(6), (-98339).toFixed(6))
  const herein = carryOf(plantFuel(input({ h: H1 })))
  assert.deepEqual([herein.kind, herein.cents, herein.landlord], ['in', 98339, [{ reason: 'fuelCarry', cents: -98339 }]])
  assert.equal(650000 + aus.cents + herein.cents, 650000)
})

test('Fall b: H−1 mit Schätzung 907,74 € abgeschlossen; H bucht 983,39 € hinaus, 75,65 € Differenz', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(90774)], closed: new Set(['2024-05']), frozen: [{ deliveryId: 'e', period: '2024-05', cents: 90774, emissionsKg: 0, co2Cents: 0 }] }))
  const aus = carryOf(r)
  assert.equal(aus.cents, -98339)
  assert.deepEqual(aus.landlord, [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: 7565 }])
  assert.deepEqual(aus.estimate, { cents: 90774, ids: ['e'] })
  assert.equal(551661 + 90774 + 7565, 650000, 'Summe 5.516,61 + 907,74 + 75,65 = 6.500,00 €')
})

test('Fall c: H−1 ohne Schätzung abgeschlossen; 983,39 € beim Vermieter', () => {
  const aus = carryOf(plantFuel(input({ closed: new Set(['2024-05']) })))
  assert.deepEqual(aus.landlord, [{ reason: 'fuelClosedPeriod', cents: 98339 }])
})

test('Fall d: eingefrorener Wert geht vor, auch wenn ein später erfasster Zählerstand 200 ‰ ergäbe', () => {
  const readings = [{ date: '2025-03-14', value: 0 }, { date: '2025-04-30', value: 200 }, { date: '2026-03-14', value: 1000 }]
  const offen = carryOf(plantFuel(input({ ctx: { ...ctx, readings } })))
  assert.equal(offen.cents, -130000)
  const zu = carryOf(plantFuel(input({ ctx: { ...ctx, readings }, closed: new Set(['2024-05']), frozen: [{ deliveryId: 'd', period: '2024-05', cents: 98339, emissionsKg: 0, co2Cents: 0 }] })))
  assert.deepEqual([zu.cents, zu.frozen, zu.landlord], [-98339, true, [{ reason: 'fuelCarry', cents: 98339 }]])
})

test('Fall e: Schätzung 1.050,00 € zu hoch; Differenz −66,61 €', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(105000)], closed: new Set(['2024-05']), frozen: [{ deliveryId: 'e', period: '2024-05', cents: 105000, emissionsKg: 0, co2Cents: 0 }] }))
  assert.deepEqual(carryOf(r).landlord, [{ reason: 'fuelCarry', cents: 105000 }, { reason: 'fuelEstimateDiff', cents: -6661 }])
})

test('Fall f: H−1 wieder offen; die Schätzung ist durch die echte Rechnung ersetzt und zählt nicht (Review Focus 3)', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(90774)] }))
  assert.deepEqual(carryOf(r).landlord, [{ reason: 'fuelCarry', cents: 98339 }])
  const vorher = plantFuel(input({ h: H1, deliveries: [GAS, schaetzung(90774)] }))
  assert.ok(!vorher?.carries.some((c) => c.deliveryId === 'e'), 'die ersetzte Schätzung bucht nichts')
  assert.equal(carryOf(vorher).cents, 98339)
})

test('Schätzvorschlag (Entwurf 8.2 Fall b): 6.000 € · 151,29 ‰ = 907,74 €, kg und CO₂ im selben Verhältnis', () => {
  const r = plantFuel(input({ h: H1, deliveries: [VORJAHR], items: [vorjahrItem] })) ?? assert.fail('kein Ergebnis')
  const lücke = r.gaps.find((g) => g.from === '2025-03-15') ?? assert.fail('keine Lücke')
  assert.deepEqual([lücke.to, lücke.days, lücke.permille.toFixed(2)], ['2025-04-30', 47, '151.29'])
  assert.deepEqual(lücke.estimate, { from: '2025-03-15', to: '2025-04-30', amountCents: 90774, emissionsKg: 1815.5, co2CostCents: 9077, basedOn: 'Gas 2024/2025', byMeter: false })
  // Beim Messdienst gibt es keinen Vorschlag: Seine Beträge sind schon da, geschätzt würde nur Geld,
  // das niemand verteilt.
  assert.equal(plantFuel(input({ method: 'service', h: H1, deliveries: [{ ...VORJAHR, amountCents: 600000 }], items: [] }))?.gaps[0]?.estimate, null)
})

test('Messdienst (G-A3): C ganz aus den angesetzten Rechnungen, E auf die Heizperiode umgerechnet', () => {
  const g = delivery({ amountCents: 311747, emissionsKg: 5406.17, co2CostCents: 60000 })
  const r = plantFuel(input({ method: 'service', deliveries: [g], items: [] })) ?? assert.fail('kein Ergebnis')
  assert.deepEqual([r.serviceCo2Cents, r.serviceGrossCents, r.carries.length], [60000, 311747, 0])
  near(r.emissionsKg ?? 0, 5406.17, 'E umgerechnet = E der Rechnung', 1e-6)
  // Abgegrenzt wären es nur 848,71 ‰; so rechnet die eigene Aufteilung bei freien Schlüsseln.
  assert.equal(r.co2Cents, 50923)
  assert.equal(r.coveragePermille.toFixed(2), '848.71')
  // Nicht angesetzt: kein C beim Messdienst.
  assert.equal(plantFuel(input({ method: 'service', deliveries: [{ ...g, usedByService: false }], items: [] }))?.serviceCo2Cents, null)
})

test('Ohne Lieferung, die die Heizperiode berührt, und ohne Übertrag gibt es kein Ergebnis', () => {
  assert.equal(plantFuel(input({ h: period(MAI, '2027-05') })), null)
})
```

In `server/test/law-literals.test.ts` die Liste `ENGINE_FILES` um `'server/src/fuel.ts'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/fuel.test.ts test/law-literals.test.ts`
Expected: FAIL mit `Cannot find module '…/src/fuel.ts'` und „server/src/fuel.ts gibt es nicht; die
Liste ist veraltet“.

- [ ] **Step 3: Implement (`server/src/fuel.ts`)**

```ts
// Brennstofflieferungen (Heizung PR 7, #97; Entwurf 3.2, 3.3, 5.4, 8.2): welcher Teil einer
// Versorgerrechnung in eine Heizperiode gehört, was eine Heizperiode deshalb herein- oder hinausbucht,
// wie viel CO₂ sie ausgestoßen hat und welche Lücken bleiben. Reine Funktionen. Die Gradtagstabelle
// reicht der Aufrufer aus dem Register herein (`law()` protokolliert sie); hier steht keine Zahl der
// Tabelle und kein Datum (law-literals.test.ts).
//
// **Die Stufen** (3.2), je Lieferung und Heizperiode die erste zutreffende: 0 eingetragen (nur für den
// verbrauchsabhängigen Teil), 1 gemessen (Versorgungszähler mit Ständen genau an den Grenzen), 2
// Zwischenrechnung (ganz drin oder ganz draußen), 3 Teilmengen laut Rechnung (jede für sich nach 1, 4
// oder 5), 4 Ortswerte, 5 Gradtagstabelle; 6, die Schätzung mit Vorbehalt, ist eine eigene Lieferung.
// Tagesgenau gibt es für den Verbrauch nicht, es verschöbe Winterverbrauch. **Feste
// Preisbestandteile** hängen an der Zeit und gehen immer nach Tagen (R1; § 12 Abs. 2 GasGVV betrifft
// nur die verbrauchsabhängigen Preise). CO₂ hängt nur an der Menge.
//
// **Überträge** (8.2): Die Positionen einer Lieferung stehen in der Heizperiode, die das Ende der
// Rechnung enthält. Sie bucht den Teil jeder anderen Heizperiode hinaus, die andere bucht ihn herein.
// Ist die andere abgeschlossen, gilt, was sie eingefroren hat; hat sie stattdessen eine Schätzung
// eingefroren, steht die Differenz beim Vermieter; hat sie nichts, trägt er den ganzen Teil.
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { dayAfter, dayBefore } from '../../shared/law/register.ts'
import { degreeDayPermille, unionOf, type DayRange } from '../../shared/degreeDays.ts'
import { formatDayRange, parsePeriodKey, periodContaining, periodOfKey, periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, FuelDelivery, FuelDeliveryLine, FuelGap, FuelMethod, HeatingEnergy, HeatingMethod, PeriodRules } from '../../shared/types.ts'

// Lieferungen mit Vorrat brauchen die Bestandsrechnung (PR 8); mit Rechnungszeitraum abgegrenzt werden
// Gas, Fernwärme und Strom.
export const STOCK_ENERGIES: readonly HeatingEnergy[] = ['oil', 'lpg', 'pellets', 'wood', 'coal']
export const METERED_ENERGIES: readonly HeatingEnergy[] = ['gas', 'districtHeating', 'heatPump', 'electric']

export type FuelReading = { date: string; value: number; replacement?: boolean; oldEndValue?: number | null }
export type ShareContext = { table: DegreeDayTable; local: ReadonlyMap<string, number>; readings: readonly FuelReading[] | null }
export type FuelDeliveryInput = Pick<
  FuelDelivery,
  'id' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'
>

const MS_DAY = 86400000
const toUTC = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)
const daysOf = (r: DayRange): number => (r.from > r.to ? 0 : Math.round((toUTC(r.to) - toUTC(r.from)) / MS_DAY) + 1)
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()
const intersect = (a: DayRange, b: DayRange): DayRange | null => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from <= to ? { from, to } : null
}
// Kaufmännisch, auch für negative Beträge (eine Gutschrift ist das Spiegelbild der Rechnung).
const roundHalf = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x))) || 0
const isRange = (r: DayRange | null): r is DayRange => r !== null

// Der Zeitraum einer Lieferung: der Rechnungszeitraum, sonst der Tag der Lieferung.
export function rangeOf(d: Pick<FuelDelivery, 'invoiceFrom' | 'invoiceTo' | 'deliveredAt'>): DayRange | null {
  if (d.invoiceFrom && d.invoiceTo) return { from: d.invoiceFrom, to: d.invoiceTo }
  return d.deliveredAt ? { from: d.deliveredAt, to: d.deliveredAt } : null
}

// Die Gradtagzahlen des Orts über eine Spanne (Stufe 4): je Tag der Monatswert ÷ Tage des Monats, wie
// bei der Tabelle (3.5). `null`, wenn ein Monat fehlt; dann gilt die Tabelle.
export function localDegreeDaySum(range: DayRange, values: ReadonlyMap<string, number>): number | null {
  if (values.size === 0) return null
  let sum = 0
  for (let t = toUTC(range.from); t <= toUTC(range.to); t += MS_DAY) {
    const iso = isoOf(t)
    const v = values.get(iso.slice(0, 7))
    if (v === undefined) return null
    sum += v / daysInMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))
  }
  return sum
}

// Die Menge am Versorgungszähler zwischen dem Ende des Tages vor `from` und dem Ende von `to` (Stufe 1).
// Nur mit Ablesungen genau an diesen beiden Tagen; je Tag gilt die letzte. Ein Zählerwechsel zählt mit
// seinem Endstand; ohne Endstand ist die Menge unbekannt, und erfunden wird nichts (wie #83).
export function meterQuantity(readings: readonly FuelReading[], range: DayRange): number | null {
  const start = dayBefore(range.from)
  const sorted = readings.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r)
  const lastOn = (date: string): FuelReading | undefined => sorted.filter((r) => r.date === date).at(-1)
  let prev = lastOn(start)
  if (!prev || !lastOn(range.to)) return null
  let sum = 0
  for (const r of sorted) {
    if (r.date <= start || r.date > range.to) continue
    if (r.replacement) {
      if (r.oldEndValue == null) return null
      sum += r.oldEndValue - prev.value
    } else {
      sum += r.value - prev.value
    }
    prev = r
  }
  return sum
}

export type VariableShare = { share: number; method: FuelMethod }

// Der verbrauchsabhängige Anteil eines Abschnitts an einer Heizperiode, Stufen 1, 2, 4 und 5.
export function variableShare(seg: DayRange, h: DayRange, ctx: ShareContext): VariableShare {
  const cut = intersect(seg, h)
  if (!cut) return { share: 0, method: 'inside' }
  if (cut.from === seg.from && cut.to === seg.to) return { share: 1, method: 'inside' }
  if (ctx.readings) {
    const all = meterQuantity(ctx.readings, seg)
    const part = meterQuantity(ctx.readings, cut)
    if (all !== null && part !== null && all > 0) return { share: part / all, method: 'measured' }
  }
  const localAll = localDegreeDaySum(seg, ctx.local)
  const localPart = localDegreeDaySum(cut, ctx.local)
  if (localAll !== null && localPart !== null && localAll > 0) return { share: localPart / localAll, method: 'localDegreeDays' }
  const all = degreeDayPermille([seg], ctx.table)
  return { share: all > 0 ? degreeDayPermille([cut], ctx.table) / all : daysOf(cut) / daysOf(seg), method: 'degreeDays' }
}

// Der Anteil nach Tagen, für feste Preisbestandteile (R1).
export function dayShare(seg: DayRange, h: DayRange): number {
  const cut = intersect(seg, h)
  return cut ? daysOf(cut) / daysOf(seg) : 0
}

// `ratio`: Anteil des Betrags an der Heizperiode, feste Teile nach Tagen; `kgShare`: Anteil von Menge,
// Ausstoß und CO₂-Kosten. `split`: Die Lieferung ist auf mehrere Heizperioden verteilt.
export type DeliveryShare = { ratio: number; kgShare: number; method: FuelMethod; fixedKnown: boolean; split: boolean }

// Der Teil einer Lieferung an einer Heizperiode. `entered`: der eingetragene Anteil des
// verbrauchsabhängigen Teils für diese Heizperiode in Promille (Stufe 0), oder `null`.
export function deliveryShare(d: FuelDeliveryInput, totalCents: number, h: DayRange, ctx: ShareContext, entered: number | null): DeliveryShare {
  const range = rangeOf(d)
  if (!range) return { ratio: 0, kgShare: 0, method: 'inside', fixedKnown: true, split: false }
  const money = (fixed: number, variable: number, ds: number, vs: number, total: number): number => (total !== 0 ? (fixed * ds + variable * vs) / total : vs)
  if (entered !== null) {
    const fixed = d.fixedCents ?? 0
    const v = entered / 1000
    return { ratio: money(fixed, totalCents - fixed, dayShare(range, h), v, totalCents), kgShare: v, method: 'entered', fixedKnown: d.fixedCents !== null, split: v > 0 && v < 1 }
  }
  if (d.parts.length > 0) {
    let moneyIn = 0, amounts = 0, kgIn = 0, kgAll = 0, varIn = 0, varAll = 0
    let split = false
    for (const p of d.parts) {
      const seg = { from: p.from, to: p.to }
      const vs = variableShare(seg, h, ctx)
      const fixed = p.fixedCents ?? 0
      moneyIn += fixed * dayShare(seg, h) + (p.amountCents - fixed) * vs.share
      amounts += p.amountCents
      varIn += (p.amountCents - fixed) * vs.share
      varAll += p.amountCents - fixed
      if (p.emissionsKg !== null) {
        kgIn += p.emissionsKg * vs.share
        kgAll += p.emissionsKg
      }
      if (vs.share > 0 && vs.share < 1) split = true
    }
    const ratio = amounts !== 0 ? moneyIn / amounts : 0
    const kgShare = kgAll > 0 ? kgIn / kgAll : varAll !== 0 ? varIn / varAll : ratio
    return { ratio, kgShare, method: 'parts', fixedKnown: d.parts.every((p) => p.fixedCents !== null), split }
  }
  const vs = variableShare(range, h, ctx)
  const fixed = d.fixedCents ?? 0
  return { ratio: money(fixed, totalCents - fixed, dayShare(range, h), vs.share, totalCents), kgShare: vs.share, method: vs.method, fixedKnown: d.fixedCents !== null, split: vs.share > 0 && vs.share < 1 }
}

// Abdeckung einer Heizperiode durch Rechnungen in Promille ihrer Gradtage, und die Lücken (3.3).
export function coverageOf(h: DayRange, ranges: readonly DayRange[], table: DegreeDayTable): { permille: number; gaps: DayRange[] } {
  const inside = unionOf(ranges.map((r) => intersect(r, h)).filter(isRange))
  const gaps: DayRange[] = []
  let cursor = h.from
  for (const r of inside) {
    if (r.from > cursor) gaps.push({ from: cursor, to: dayBefore(r.from) })
    if (r.to >= cursor) cursor = dayAfter(r.to)
  }
  if (cursor <= h.to) gaps.push({ from: cursor, to: h.to })
  const all = degreeDayPermille([h], table)
  return { permille: all > 0 ? (degreeDayPermille(inside, table) / all) * 1000 : 0, gaps }
}

export type FuelItem = { id: string; period: string; amountCents: number; fuelDeliveryId?: string | null }
export type FuelFrozen = { deliveryId: string; period: string; cents: number; emissionsKg: number; co2Cents: number }
export type FuelPlantInput = {
  method: HeatingMethod
  h: BillingPeriod
  rules: PeriodRules
  deliveries: readonly FuelDeliveryInput[]
  items: readonly FuelItem[]
  frozen: readonly FuelFrozen[]
  closed: ReadonlySet<string>
  ctx: ShareContext
}

// Ein Übertrag der Mieterseite dieser Heizperiode: `out` hinaus in die frühere (die Positionen stehen
// hier), `in` herein aus der Heizperiode der Positionen, `estimate` eine geschätzte Lieferung dieser
// Heizperiode. `landlord` ist die Gegenzeile beim Vermieter (Summe = −cents). `templates` verteilt den
// Übertrag auf die Positionen, deren Schlüssel er folgt.
export type FuelCarry = {
  deliveryId: string
  kind: 'out' | 'in' | 'estimate'
  other: BillingPeriod
  cents: number
  totalCents: number
  ratio: number
  method: FuelMethod
  frozen: boolean
  landlord: { reason: 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff'; cents: number }[]
  templates: { itemId: string; raw: number }[]
  estimate: { cents: number; ids: string[] } | null
}

export type FuelResult = {
  lines: FuelDeliveryLine[]
  carries: FuelCarry[]
  coveragePermille: number
  gaps: FuelGap[]
  emissionsKg: number | null
  co2Cents: number | null
  serviceCo2Cents: number | null
  serviceGrossCents: number | null
  missingCo2: string[]
}

// Die Lieferungen einer Anlage in einer Heizperiode. `null`, wenn keine die Heizperiode berührt und
// nichts übertragen wird: Dann gibt es nichts zu bewerten und keine Lücke zu melden.
export function plantFuel(input: FuelPlantInput): FuelResult | null {
  const { h, rules, ctx } = input
  const withItems = input.method === 'manual'
  const ranged = input.deliveries.filter((d) => rangeOf(d) !== null)
  const real = ranged.filter((d) => !d.estimated)
  const realUnion = unionOf(real.map(rangeOf).filter(isRange))
  const coveredByReal = (r: DayRange): boolean => realUnion.some((u) => u.from <= r.from && u.to >= r.to)
  // Eine Schätzung zählt, solange keine echte Rechnung ihre Tage abdeckt (8.2, Wiederöffnen).
  const effective = ranged.filter((d) => {
    const r = rangeOf(d)
    return r !== null && (!d.estimated || !coveredByReal(r))
  })
  const itemsOf = (id: string): FuelItem[] => input.items.filter((c) => c.fuelDeliveryId === id)
  const totalOf = (d: FuelDeliveryInput): number =>
    d.estimated || !withItems ? (d.amountCents ?? 0) : itemsOf(d.id).reduce((a, c) => a + c.amountCents, 0)
  // Ein eingefrorener Wert gilt nur für eine abgeschlossene Heizperiode (Abweichung 7).
  const frozenOf = (id: string, key: string): FuelFrozen | null =>
    input.closed.has(key) ? (input.frozen.find((f) => f.deliveryId === id && f.period === key) ?? null) : null
  const rangeFor = (d: FuelDeliveryInput): DayRange => rangeOf(d) ?? { from: h.from, to: h.from }
  const share = (d: FuelDeliveryInput, target: BillingPeriod): DeliveryShare => {
    const r = rangeFor(d)
    const touched = periodsBetween(rules, r.from, r.to)
    const end = periodContaining(rules, r.to)
    const entered = d.sharePermille !== null && touched.length === 2 ? (target.key === end.key ? d.sharePermille : 1000 - d.sharePermille) : null
    return deliveryShare(d, totalOf(d), target, ctx, entered)
  }
  const touchesH = (d: FuelDeliveryInput): boolean => intersect(rangeFor(d), h) !== null
  const labelOf = (d: FuelDeliveryInput): string => d.label || formatDayRange(rangeFor(d).from, rangeFor(d).to)

  // Bewertung: je Lieferung, die die Heizperiode berührt, Anteil, Ausstoß und CO₂-Kosten.
  const lines: FuelDeliveryLine[] = []
  let kg = 0
  let kgKnown = false
  let co2 = 0
  let co2Known = false
  const missingCo2: string[] = []
  for (const d of effective.filter(touchesH)) {
    const s = share(d, h)
    const f = frozenOf(d.id, h.key)
    const e = f ? f.emissionsKg : d.emissionsKg === null ? null : d.emissionsKg * s.kgShare
    const c = f ? f.co2Cents : d.co2CostCents === null ? null : d.co2CostCents * s.kgShare
    if (e !== null) {
      kg += e
      kgKnown = true
    }
    if (c !== null) {
      co2 += c
      co2Known = true
    }
    if (e === null || c === null) missingCo2.push(labelOf(d))
    const total = totalOf(d)
    const r = rangeFor(d)
    lines.push({
      deliveryId: d.id, label: d.label, from: r.from, to: r.to, estimated: d.estimated, method: s.method, sharePermille: s.kgShare * 1000,
      fixedKnown: s.fixedKnown, split: s.split, amountCents: total, inPeriodCents: withItems || d.estimated ? roundHalf(total * s.ratio) : null,
      emissionsKg: e, co2Cents: c === null ? null : roundHalf(c),
    })
  }
  const coverage = coverageOf(h, effective.map(rangeOf).filter(isRange), ctx.table)
  const emissionsKg = kgKnown ? (coverage.permille > 0 ? (kg * 1000) / coverage.permille : kg) : null

  // Messdienst (7.6, G-A3): C sind die CO₂-Kosten der Rechnungen, die er angesetzt hat, ganz; gezählt
  // in der Heizperiode, in der die Rechnung endet.
  const owned = real.filter((d) => d.usedByService && periodContaining(rules, rangeFor(d).to).key === h.key)
  const serviceCo2Cents = input.method === 'service' && owned.length > 0 && owned.every((d) => d.co2CostCents !== null)
    ? owned.reduce((a, d) => a + (d.co2CostCents ?? 0), 0)
    : null
  const serviceGrossCents = input.method === 'service' && owned.length > 0 && owned.every((d) => d.amountCents !== null)
    ? owned.reduce((a, d) => a + (d.amountCents ?? 0), 0)
    : null

  // Die Rechnung, aus der eine Schätzung verteilt wird oder die eine Lücke schätzt: die letzte echte
  // mit Positionen, die vorher endet, sonst die letzte überhaupt. Eine Regel für beides.
  const templateFor = (from: string): FuelDeliveryInput | null => {
    const candidates = real.filter((d) => itemsOf(d.id).length > 0 && totalOf(d) !== 0).sort((a, b) => (rangeFor(a).to < rangeFor(b).to ? -1 : 1))
    return candidates.filter((d) => rangeFor(d).to < from).at(-1) ?? candidates.at(-1) ?? null
  }

  // Überträge (8.2), nur bei freien Schlüsseln: Dort sind die Rechnungen Positionen.
  const carries: FuelCarry[] = []
  if (withItems) {
    // Die Schätzungen einer abgeschlossenen Heizperiode, die eine echte Rechnung ersetzt, mit ihrem
    // eingefrorenen Betrag im Verhältnis der Gradtage, die die Rechnung von ihnen abdeckt.
    const estimatesIn = (other: BillingPeriod, r: DayRange): { cents: number; ids: string[] } => {
      let cents = 0
      const ids: string[] = []
      for (const e of input.deliveries.filter((x) => x.estimated)) {
        const er = rangeOf(e)
        const f = frozenOf(e.id, other.key)
        if (!er || !f || er.from < other.from || er.to > other.to) continue
        const cut = intersect(er, r)
        if (!cut) continue
        const all = degreeDayPermille([er], ctx.table)
        cents += f.cents * (all > 0 ? degreeDayPermille([cut], ctx.table) / all : daysOf(cut) / daysOf(er))
        ids.push(e.id)
      }
      return { cents: roundHalf(cents), ids }
    }
    for (const d of effective) {
      const r = rangeFor(d)
      if (d.estimated) {
        if (!touchesH(d)) continue
        const template = templateFor(r.from)
        if (!template) continue
        const f = frozenOf(d.id, h.key)
        const cents = f ? f.cents : (d.amountCents ?? 0)
        const T = totalOf(template)
        if (cents === 0) continue
        carries.push({
          deliveryId: d.id, kind: 'estimate', other: h, cents, totalCents: d.amountCents ?? 0, ratio: 1, method: 'inside', frozen: f !== null,
          landlord: [{ reason: 'fuelCarry', cents: -cents }],
          templates: itemsOf(template.id).map((c) => ({ itemId: c.id, raw: (cents * c.amountCents) / T })),
          estimate: null,
        })
        continue
      }
      const items = itemsOf(d.id)
      const T = totalOf(d)
      if (items.length === 0 || T === 0) continue
      // Die Heizperiode der Positionen; die Schreibprüfung hält sie bei der, die das Ende enthält.
      const ownerKey = parsePeriodKey(items[0]?.period)
      const owner = (ownerKey && periodOfKey(rules, ownerKey)) ?? periodContaining(rules, r.to)
      const touched = periodsBetween(rules, r.from, r.to)
      if (owner.key === h.key) {
        for (const other of touched) {
          if (other.key === h.key) continue
          const s = share(d, other)
          const f = frozenOf(d.id, other.key)
          const X = f ? f.cents : roundHalf(T * s.ratio)
          if (X === 0) continue
          let landlord: FuelCarry['landlord'] = [{ reason: 'fuelCarry', cents: X }]
          let estimate: FuelCarry['estimate'] = null
          if (!f && input.closed.has(other.key)) {
            const est = estimatesIn(other, r)
            if (est.ids.length > 0) {
              estimate = est
              landlord = [{ reason: 'fuelCarry', cents: est.cents }, ...(X - est.cents !== 0 ? [{ reason: 'fuelEstimateDiff' as const, cents: X - est.cents }] : [])]
            } else {
              landlord = [{ reason: 'fuelClosedPeriod', cents: X }]
            }
          }
          carries.push({
            deliveryId: d.id, kind: 'out', other, cents: -X, totalCents: T, ratio: s.ratio, method: s.method, frozen: f !== null, landlord,
            templates: items.map((c) => ({ itemId: c.id, raw: (-X * c.amountCents) / T })), estimate,
          })
        }
      } else if (touchesH(d)) {
        const s = share(d, h)
        const f = frozenOf(d.id, h.key)
        const ownerFrozen = frozenOf(d.id, owner.key)
        const Y = f ? f.cents : ownerFrozen && touched.length === 2 ? -ownerFrozen.cents : roundHalf(T * s.ratio)
        if (Y === 0) continue
        carries.push({
          deliveryId: d.id, kind: 'in', other: owner, cents: Y, totalCents: T, ratio: s.ratio, method: s.method, frozen: f !== null || ownerFrozen !== null,
          landlord: [{ reason: 'fuelCarry', cents: -Y }],
          templates: items.map((c) => ({ itemId: c.id, raw: (Y * c.amountCents) / T })), estimate: null,
        })
      }
    }
  }

  if (lines.length === 0 && carries.length === 0) return null

  // Lücken (3.3) und, bei freien Schlüsseln, der Vorschlag einer Schätzung aus der letzten Rechnung
  // (8.2 Nr. 2): verbrauchsabhängiger Teil nach dem eigenen Zählerstand, sonst nach Gradtagen; fester
  // Teil nach Tagen; kg und CO₂-Kosten im Verhältnis des verbrauchsabhängigen Teils.
  const gaps: FuelGap[] = coverage.gaps.map((g) => {
    const permille = degreeDayPermille([g], ctx.table)
    let estimate: FuelGap['estimate'] = null
    const t = withItems ? templateFor(g.from) : null
    if (t) {
      const tr = rangeFor(t)
      const T = totalOf(t)
      const fixed = t.fixedCents ?? 0
      const qGap = ctx.readings ? meterQuantity(ctx.readings, g) : null
      const qT = ctx.readings ? meterQuantity(ctx.readings, tr) : null
      const byMeter = qGap !== null && qT !== null && qT > 0
      const tPermille = degreeDayPermille([tr], ctx.table)
      const factor = byMeter ? (qGap ?? 0) / (qT ?? 1) : tPermille > 0 ? permille / tPermille : daysOf(g) / daysOf(tr)
      estimate = {
        from: g.from, to: g.to,
        amountCents: roundHalf((T - fixed) * factor + (fixed * daysOf(g)) / daysOf(tr)),
        emissionsKg: t.emissionsKg === null ? null : Math.round(t.emissionsKg * factor * 10) / 10,
        co2CostCents: t.co2CostCents === null ? null : roundHalf(t.co2CostCents * factor),
        basedOn: labelOf(t), byMeter,
      }
    }
    return { from: g.from, to: g.to, days: daysOf(g), permille, estimate }
  })

  return {
    lines, carries, coveragePermille: coverage.permille, gaps, emissionsKg,
    co2Cents: co2Known ? roundHalf(co2) : null, serviceCo2Cents, serviceGrossCents, missingCo2,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/fuel.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (fuel.test.ts: 18 Tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/fuel.ts server/test/fuel.test.ts server/test/law-literals.test.ts
git commit -m "Lieferungen: Abgrenzung in Stufen, feste Teile nach Tagen, Abdeckung, Überträge und Schätzvorschlag

Reine Funktionen mit den Zahlen des Entwurfs (621,29 / 848,71 ‰, 4.038,39 €, 1.600,00 €,
983,39 €, 907,74 € und 75,65 €, −66,61 €).

Refs #97"
```

---
### Task 4: Lieferungen lesen und schreiben, Verknüpfung, Sperren

Lieferungen samt Teilmengen anlegen, ändern und entfernen, mit den Sperren dieser Version; die
Ortswerte der Gradtage; die Verknüpfung einer Position mit ihrer Lieferung; die Sperre der Ablesungen
des Versorgungszählers in einer abgeschlossenen Heizperiode; die CO₂-Merkmale an der Anlage; eine
Anlage mit Lieferungen wird nicht still entfernt.

**Files:**
- Create: `server/src/db/fuel.ts`
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts`, `server/src/db/co2.ts`
- Test: `server/test/db-fuel.test.ts` (neu), `server/test/db-stock.test.ts`, `server/test/db-co2.test.ts`

**Interfaces:**
- Consumes (Task 2, 3; PR 2–6): Tabellen und Listen aus schema.ts; `STOCK_ENERGIES`; `heatingRulesOf`, `rulesForProperty`, `isPeriodClosed`, `HeatingError`, `PeriodError`, `has`, `raw`, `merged`, `asText`, `asNullableFilled`, `oneOfOrUndefined`, `ISO_DATE` (repository.ts); `plantRules`, `settledSeparately`, `PlantWay` (`shared/heatingPeriod.ts`); `periodContaining`, `periodsBetween`, `periodLabel`, `formatDayRange`, `parsePeriodKey`; `groupBy`, `INSERTION_ORDER`, `orUndefined` (read.ts).
- Produces:
  - read.ts: `readFuelDeliveries(db: Database): Promise<FuelDelivery[]>`, `readFuelCarryFrozen(db: Database): Promise<FrozenFuelCarry[]>`, `readDegreeDayValues(db: Database): Promise<(DegreeDayValue & { propertyId: string })[]>`; `Stock.fuelDeliveries`, `Stock.fuelCarryFrozen`, `Stock.degreeDayValues`; `CostItem.fuelDeliveryId` beim Lesen
  - repository.ts: `heatingPeriodAt(db: Executor, plantId: string, date: string): Promise<{ period: BillingPeriod; closed: boolean } | null>`; `closeSettlement(db: Executor, entry)` (bisher `Database`)
  - db/fuel.ts: `listDeliveries(db, plantId): Promise<FuelDelivery[] | null>`, `createDelivery(db, id, plantId, body): Promise<FuelDelivery | null>`, `updateDelivery(db, id, body): Promise<FuelDelivery | null>`, `removeDelivery(db, id): Promise<boolean>`, `listDegreeDays(db, propertyId): Promise<DegreeDayValue[] | null>`, `saveDegreeDays(db, propertyId, body): Promise<DegreeDayValue[] | null>`
  - heating.ts: `PlantRemoval` + `{ removed: false; reason: 'deliveries'; count: number }`
  - db/co2.ts: `export async function ensureHeatingPeriod(db: Executor, plantId: string, key: PeriodKey): Promise<string>` (bisher intern)

- [ ] **Step 1: Write the failing tests**

`server/test/db-fuel.test.ts`:

```ts
// Brennstofflieferungen in der Datenbank (Heizung PR 7, Entwurf 5.4, 8.2, 13 PR 7): anlegen, ändern,
// entfernen, die Sperren dieser Version, die Verknüpfung der Positionen, die eingefrorenen Teile und
// die Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDelivery, listDegreeDays, listDeliveries, removeDelivery, saveDegreeDays, updateDelivery } from '../src/db/fuel.ts'
import { ensureHeatingPeriod } from '../src/db/co2.ts'
import { createHeatingPlant, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, createProperty, crossPropertyViolations, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'
import { costItems, fuelCarryFrozen, heatingPlants } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-'))
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

// Ein Haus mit einer Wohnung im Kalenderjahr und einer Gasheizung mit freien Schlüsseln.
async function bestand(opened: Opened, energy = 'gas', method = 'manual'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method })
  })
}
const gas = { label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', emissionsKg: 5406.17, co2CostCents: 60000 }

test('Lieferung: anlegen mit Teilmengen, ändern, lesen; „geschätzt“ setzt nur der Abschluss', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const d = await opened.write((db) => createDelivery(db, 'd1', 'hp', {
      ...gas, estimated: true,
      parts: [
        { from: '2026-01-01', to: '2026-03-14', amountCents: 150000 },
        { from: '2025-03-15', to: '2025-12-31', amountCents: 500000, fixedCents: 10000 },
      ],
    })) ?? assert.fail('keine Anlage')
    assert.deepEqual([d.label, d.estimated, d.usedByService, d.parts.map((p) => p.from)], ['Gas 2025/2026', false, true, ['2025-03-15', '2026-01-01']])
    const geaendert = await opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 20000, parts: [] })) ?? assert.fail('keine Lieferung')
    assert.deepEqual([geaendert.fixedCents, geaendert.parts, geaendert.emissionsKg], [20000, [], 5406.17])
    assert.equal((await opened.read((db) => listDeliveries(db, 'hp')))?.length, 1)
    assert.equal(await opened.read((db) => listDeliveries(db, 'gibt-es-nicht')), null)
    assert.equal(await opened.write((db) => removeDelivery(db, 'd1')), true)
    assert.equal(await opened.write((db) => removeDelivery(db, 'd1')), false)
  })
})

test('Lieferung: Sperren dieser Version und Pflichtangaben, jede mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'oil')
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', gas)), heatingError(400, /Bestandsrechnung/))
  })
  await withDatabase(async (opened) => {
    await bestand(opened)
    const anlegen = (body: Record<string, unknown>) => opened.write((db) => createDelivery(db, 'x', 'hp', body))
    await assert.rejects(anlegen({ ...gas, unitId: 'u1' }), heatingError(400, /späteren Version/))
    await assert.rejects(anlegen({ ...gas, gridFeeCents: 100 }), heatingError(400, /späteren Version/))
    await assert.rejects(anlegen({ label: 'ohne Zeitraum' }), heatingError(400, /Rechnungszeitraum/))
    await assert.rejects(anlegen({ ...gas, invoiceTo: '2025-03-01' }), heatingError(400, /endet vor seinem Beginn/))
    await assert.rejects(anlegen({ ...gas, amountCents: 650000 }), heatingError(400, /Kostenposition/))
    await assert.rejects(anlegen({ ...gas, invoiceFrom: '2024-12-15', invoiceTo: '2026-01-14', sharePermille: 900 }), heatingError(400, /mehr als zwei Heizperioden/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-01-01', to: '2025-06-30', amountCents: 1 }] }), heatingError(400, /außerhalb des Rechnungszeitraums/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-03-15', to: '2025-06-30', amountCents: 1 }, { from: '2025-06-30', to: '2025-12-31', amountCents: 1 }] }), heatingError(400, /überschneiden/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-03-15', to: '2025-06-30' }] }), heatingError(400, /Beginn, Ende und Betrag/))
    // Ein eingetragener Anteil bei einer Rechnung über zwei Heizperioden ist erlaubt.
    assert.equal((await anlegen({ ...gas, sharePermille: 900 }))?.sharePermille, 900)
  })
})

test('Lieferung beim Messdienst: Betrag erlaubt, Verknüpfung einer Position nicht', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'gas', 'service')
    const d = await opened.write((db) => createDelivery(db, 'd1', 'hp', { ...gas, amountCents: 311747, usedByService: false }))
    assert.deepEqual([d?.amountCents, d?.usedByService], [311747, false])
    await assert.rejects(
      opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' })),
      heatingError(400, /Messdienst/),
    )
  })
})

test('Verknüpfung: nur Heizkosten, nur in der Heizperiode, die das Ende der Rechnung enthält (Review Focus 2)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    const position = (id: string, over: Record<string, unknown>) =>
      opened.write((db) => createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1', ...over }))
    await assert.rejects(position('a', { period: '2025-01' }), heatingError(400, /endet am 14\.03\.2026 und gehört deshalb in die Heizperiode 2026/))
    await assert.rejects(position('b', { category: 'Grundsteuer' }), heatingError(400, /nur zu einer Position der Kostenart/))
    await assert.rejects(position('c', { fuelDeliveryId: 'gibt-es-nicht' }), heatingError(400, /gibt es nicht/))
    await assert.rejects(position('f', { key: 'amounts', tenancyAmounts: {} }), heatingError(400, /nicht als Einzelbeträge/))
    const ok = await position('d', {})
    assert.equal(Reflect.get(ok, 'fuelDeliveryId'), 'd1')
    // Abschlag und Gutschrift derselben Rechnung zeigen beide auf sie (G-C4).
    await position('e', { description: 'Gutschrift Gas', amountCents: -50000 })
    await assert.rejects(opened.write((db) => removeDelivery(db, 'd1')), heatingError(409, /2 Kostenpositionen/))
    // Die Verknüpfung wird mit null gelöst.
    await opened.write((db) => updateEntity(db, 'costItems', 'e', { fuelDeliveryId: null }))
    assert.equal(Reflect.get((await opened.read((db) => findEntity(db, 'costItems', 'e'))) ?? {}, 'fuelDeliveryId'), undefined)
  })
})

test('Eingefroren: Mengen, Zeiträume und Beträge gesperrt, die Bezeichnung nicht; Löschen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write(async (db) => {
      const h = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
      await db.insert(fuelCarryFrozen).values({ deliveryId: 'd1', heatingPeriodId: h, cents: 403839 })
    })
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { invoiceTo: '2026-03-31' })), heatingError(409, /eingefroren/))
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { emissionsKg: 1 })), heatingError(409, /eingefroren/))
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { label: 'Gas Stadtwerke' })))?.label, 'Gas Stadtwerke')
    await assert.rejects(opened.write((db) => removeDelivery(db, 'd1')), heatingError(409, /eingefroren/))
  })
})

test('Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode sind gesperrt (Entwurf 8.2 Fall d, A10)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'gz', { propertyId: 'objekt-1', unitId: null, name: 'Gaszähler', type: 'sonstig', unit: 'm³', heatingPlantId: 'hp', heatingRole: 'supply' })
      await createEntity(db, 'readings', 'r1', { meterId: 'gz', date: '2025-03-14', value: 1000 })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} })
    })
    await assert.rejects(opened.write((db) => createEntity(db, 'readings', 'r2', { meterId: 'gz', date: '2025-04-30', value: 1200 })), heatingError(409, /Heizperiode 2025 ist abgeschlossen/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'readings', 'r1', { value: 999 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeEntity(db, 'readings', 'r1')), heatingError(409, /abgeschlossen/))
    // Ein Stand im offenen Jahr geht, ebenso ein Stand an einem Zähler einer Wohnung.
    await opened.write((db) => createEntity(db, 'readings', 'r3', { meterId: 'gz', date: '2026-03-14', value: 9000 }))
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'wz', { propertyId: 'objekt-1', unitId: 'u1', name: 'Wasser', type: 'kaltwasser', unit: 'm³' })
      await createEntity(db, 'readings', 'r4', { meterId: 'wz', date: '2025-06-30', value: 10 })
    })
  })
})

test('Heizanlage: CO₂-Merkmale, keine stille Entfernung mit Lieferungen, kein Wechsel weg von freien Schlüsseln mit Verknüpfung', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const p = await opened.write((db) => updateHeatingPlant(db, 'hp', { nonResidential: true, restriction: 'building' }))
    assert.deepEqual([p?.nonResidential, p?.restriction, p?.districtEtsNew], [true, 'building', false])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { districtEtsNew: true })), heatingError(400, /Fernwärme/))
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'service' })), heatingError(400, /verknüpft/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'oil' })), heatingError(400, /Lieferungen/))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp')), { removed: false, reason: 'deliveries', count: 1 })
  })
})

test('Ortswerte der Gradtage: je Monat ein Wert über 0, ganz ersetzt; Objektgrenze der Verknüpfung beim Wiederherstellen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const gespeichert = await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-02', value: 380 }, { month: '2025-01', value: 412.5 }] }))
    assert.deepEqual(gespeichert, [{ month: '2025-01', value: 412.5 }, { month: '2025-02', value: 380 }])
    await assert.rejects(opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-13', value: 1 }] })), heatingError(400, /Monat/))
    await assert.rejects(opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-01', value: 0 }] })), heatingError(400, /über 0/))
    assert.deepEqual(await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [] })), [])
    assert.equal(await opened.read((db) => listDegreeDays(db, 'gibt-es-nicht')), null)
    // Ein von Hand bearbeitetes Archiv: Die Anlage gehört jetzt zu einem anderen Objekt als die Position.
    await opened.write(async (db) => {
      await createDelivery(db, 'd1', 'hp', gas)
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' })
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await db.update(heatingPlants).set({ propertyId: 'objekt-2' }).where(eq(heatingPlants.id, 'hp'))
      await db.update(costItems).set({ heatingPlantId: null }).where(eq(costItems.id, 'c1'))
    })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /„Gas“ zeigt auf eine Lieferung einer Heizanlage eines anderen Objekts/.test(b)), befunde.join('\n'))
  })
})
```

In `server/test/db-stock.test.ts`: Prüft ein Test die Schlüssel von `Stock` wörtlich, dort
`'fuelDeliveries', 'fuelCarryFrozen', 'degreeDayValues'` hinter `'heatingPeriodRows'` (PR 6) ergänzen;
`NOT_IN_DB_JSON` um `'fuelDeliveryId'` ergänzen.

In `server/test/db-co2.test.ts` (PR 6) im Test „CO₂-Angaben: Sperren und Pflichtangaben …“ die Zeile
`await assert.rejects(speichern({ method: 'self' }), heatingError(400, /späteren Version/))` ersetzen
durch

```ts
    await assert.rejects(speichern({ method: 'self' }), heatingError(400, /Frage nach der Abzugszeile/))
```

und im Test „CO₂-Angaben: nur bei einer Anlage mit Messdienst …“ die erste Zusicherung ersetzen durch

```ts
    await assert.rejects(opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug)), heatingError(400, /freien Schlüsseln teilt Mietfuchs/))
    // Bei freien Schlüsseln hält ein Datensatz nur die Fläche der Einstufung (Heizung PR 7).
    assert.equal((await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { method: 'self', areaM2: 412 })))?.areaM2, 412)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-fuel.test.ts test/db-co2.test.ts`
Expected: FAIL mit `Cannot find module '…/src/db/fuel.ts'`; in db-co2.test.ts die geänderten Sätze.

- [ ] **Step 3: Lesen (`server/src/db/read.ts`)**

Aus `'./schema.ts'` zusätzlich `degreeDayValues, fuelCarryFrozen, fuelDeliveries, fuelDeliveryParts`
importieren (`heatingPeriods` ist seit PR 6 da), als Typen `DegreeDayValue, FrozenFuelCarry,
FuelDelivery`. In `readCostItems` hinter `heatingPlantId: orUndefined(c.heatingPlantId),`:

```ts
      fuelDeliveryId: orUndefined(c.fuelDeliveryId),
```

Hinter `readHeatingPeriodRows` (PR 6):

```ts
// Die Brennstofflieferungen samt Teilmengen (Heizung PR 7), die Teilmengen nach Beginn.
export async function readFuelDeliveries(db: Database): Promise<FuelDelivery[]> {
  const rows = await db.select().from(fuelDeliveries).orderBy(INSERTION_ORDER)
  const parts = await db.select().from(fuelDeliveryParts).orderBy(fuelDeliveryParts.deliveryId, fuelDeliveryParts.from)
  const byDelivery = groupBy(parts, (p) => p.deliveryId, (p) => ({
    from: p.from, to: p.to, energyKwh: p.energyKwh, amountCents: p.amountCents, fixedCents: p.fixedCents, emissionsKg: p.emissionsKg, co2CostCents: p.co2CostCents,
  }))
  return rows.map((d) => ({ ...d, parts: byDelivery.get(d.id) ?? [] }))
}

// Was abgeschlossene Heizperioden je Lieferung eingefroren haben (Heizung PR 7, G-A4), mit Anlage und
// Heizperiode aus `heating_periods`.
export async function readFuelCarryFrozen(db: Database): Promise<FrozenFuelCarry[]> {
  const rows = await db
    .select({ f: fuelCarryFrozen, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(fuelCarryFrozen)
    .innerJoin(heatingPeriods, eq(fuelCarryFrozen.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"fuel_carry_frozen".rowid`)
  return rows.map(({ f, plantId, period }) => ({
    deliveryId: f.deliveryId, plantId, period: periodKey(String(period)), cents: f.cents, emissionsKg: f.emissionsKg, co2Cents: f.co2Cents,
  }))
}

// Die Gradtagzahlen der Orte (Heizung PR 7), je Objekt nach Monat.
export async function readDegreeDayValues(db: Database): Promise<(DegreeDayValue & { propertyId: string })[]> {
  return await db.select().from(degreeDayValues).orderBy(degreeDayValues.propertyId, degreeDayValues.month)
}
```

In `Stock` hinter `heatingPeriodRows`:

```ts
  // Lieferungen, eingefrorene Überträge, Ortswerte (Heizung PR 7)
  fuelDeliveries: FuelDelivery[]
  fuelCarryFrozen: FrozenFuelCarry[]
  degreeDayValues: (DegreeDayValue & { propertyId: string })[]
```

und in `readStock` hinter `heatingPeriodRows: await readHeatingPeriodRows(db),`:

```ts
    fuelDeliveries: await readFuelDeliveries(db),
    fuelCarryFrozen: await readFuelCarryFrozen(db),
    degreeDayValues: await readDegreeDayValues(db),
```

- [ ] **Step 4: Repository (`server/src/db/repository.ts`)**

Aus `'./schema.ts'` zusätzlich `fuelDeliveries` importieren (`heatingPlants`, `heatingPeriodChanges`,
`heatingSeparateSpans`, `closedHeatingSettlements`, `meters`, `readings` sind seit PR 2–5 da, sonst
ergänzen); aus `'../../../shared/heatingPeriod.ts'` zusätzlich `settledSeparately` und den Typ
`PlantWay`; `formatDayRange` aus `'../../../shared/period.ts'`; den Typ `Reading`.

`closeSettlement`: den Typ des ersten Parameters von `Database` auf `Executor` ändern (der Rumpf ist ein
einziges `insert`; der Abschluss läuft mit Task 9 in einer Transaktion mit dem Einfrieren).

In `mergeCostItem` hinter `heatingPlantId: …` (PR 4):

```ts
    // `null` löst die Verknüpfung (Heizung PR 7).
    fuelDeliveryId: merged(body, 'fuelDeliveryId', current.fuelDeliveryId, asNullableFilled),
```

In `costItemRow` hinter `heatingPlantId: …`:

```ts
  fuelDeliveryId: orNull(c.fuelDeliveryId),
```

Hinter `itemPeriodClosed` (PR 5):

```ts
// Die Heizperiode einer Anlage an einem Tag und ob sie abgeschlossen ist (Heizung PR 7): nach Weg d mit
// ihrer Heizkostenabrechnung, sonst mit der Abrechnung des Objektzeitraums, der ihr Ende enthält (W1,
// B3). Gefragt wird in der laufenden Transaktion, deshalb unmittelbar an den Tabellen.
export async function heatingPeriodAt(db: Executor, plantId: string, date: string): Promise<{ period: BillingPeriod; closed: boolean } | null> {
  const [plant] = await db.select({ propertyId: heatingPlants.propertyId, startMonth: heatingPlants.periodStartMonth }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (!plant) return null
  const objectRules = await rulesForProperty(db, plant.propertyId)
  const changes = await db.select({ fromMonth: heatingPeriodChanges.fromMonth }).from(heatingPeriodChanges).where(eq(heatingPeriodChanges.plantId, plantId)).orderBy(heatingPeriodChanges.fromMonth)
  const spans = await db.select({ from: heatingSeparateSpans.from, until: heatingSeparateSpans.until }).from(heatingSeparateSpans).where(eq(heatingSeparateSpans.plantId, plantId)).orderBy(heatingSeparateSpans.from)
  const way: PlantWay = { periodStartMonth: plant.startMonth, periodChanges: changes.map((c) => c.fromMonth), separateSpans: spans }
  const h = periodContaining(plantRules(way, objectRules), date)
  if (settledSeparately(way, objectRules, h)) {
    const zu = await db.select({ id: closedHeatingSettlements.id }).from(closedHeatingSettlements)
      .where(and(eq(closedHeatingSettlements.plantId, plantId), eq(closedHeatingSettlements.period, h.key)))
    return { period: h, closed: zu.length > 0 }
  }
  return { period: h, closed: await isPeriodClosed(db, plant.propertyId, periodContaining(objectRules, h.to).key) }
}

// Ablesungen des Versorgungszählers einer Heizanlage mit Datum in einer abgeschlossenen Heizperiode
// sind gesperrt (Heizung PR 7, A10): Die Abgrenzung der Lieferungen dieser Heizperiode ist
// eingefroren, und ein später erfasster Stand änderte nur noch die Rechnung danach (8.2 Fall d).
async function guardSupplyReading(db: Executor, reading: Pick<Reading, 'meterId' | 'date'>): Promise<void> {
  const [m] = await db.select({ plantId: meters.heatingPlantId, role: meters.heatingRole }).from(meters).where(eq(meters.id, reading.meterId))
  if (!m || m.plantId === null || m.role !== 'supply') return
  const at = await heatingPeriodAt(db, m.plantId, reading.date)
  if (at?.closed) {
    throw new HeatingError(409,
      `Die Heizperiode ${periodLabel(at.period)} ist abgeschlossen; Ablesungen des Versorgungszählers mit einem Datum darin lassen sich nicht mehr ändern, denn die Aufteilung der Rechnungen ist eingefroren. Öffnen Sie die Abrechnung wieder, um etwas zu ändern.`)
  }
}

async function guardReading(db: Executor, before: Reading | null, after: Reading): Promise<void> {
  if (before) await guardSupplyReading(db, before)
  await guardSupplyReading(db, after)
}

// Die Lieferung einer Position (Heizung PR 7, Entwurf 5.4): nur bei der Kostenart Heizung, nur eine
// echte Lieferung der eigenen Anlage mit freien Schlüsseln, und die Position steht in der
// Heizperiode, die das Ende der Rechnung enthält. Sonst stünde die Rechnung in einer Heizperiode, in
// die sie nicht gehört, und ihr Teil liefe in die falsche Richtung (N1).
async function guardFuelLink(db: Executor, after: CostItem): Promise<void> {
  if (!after.fuelDeliveryId) return
  if (after.category !== HEATING_CATEGORY) {
    throw new HeatingError(400, `Eine Lieferung gehört nur zu einer Position der Kostenart „${HEATING_CATEGORY}“.`)
  }
  // Der Teil einer anderen Heizperiode folgt dem Schlüssel der Position; Einzelbeträge gelten für die
  // ganze Position und kommen vom Messdienst, nicht aus der Rechnung des Versorgers.
  if (after.key === 'amounts') {
    throw new HeatingError(400, 'Eine Rechnung des Versorgers verteilen Sie nach einem Schlüssel, nicht als Einzelbeträge; Einzelbeträge kommen vom Messdienst.')
  }
  const [d] = await db
    .select({ plantId: fuelDeliveries.plantId, from: fuelDeliveries.invoiceFrom, to: fuelDeliveries.invoiceTo, deliveredAt: fuelDeliveries.deliveredAt, estimated: fuelDeliveries.estimated, label: fuelDeliveries.label })
    .from(fuelDeliveries).where(eq(fuelDeliveries.id, after.fuelDeliveryId))
  if (!d) throw new HeatingError(400, 'Die gewählte Lieferung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
  if (d.estimated) throw new HeatingError(400, 'Eine geschätzte Lieferung hat keine Kostenposition. Verknüpfen Sie die echte Rechnung, wenn sie da ist.')
  if (after.heatingPlantId != null && after.heatingPlantId !== d.plantId) {
    throw new HeatingError(400, 'Die Lieferung gehört zu einer anderen Heizanlage als die Position.')
  }
  const [plant] = await db.select({ method: heatingPlants.method }).from(heatingPlants).where(eq(heatingPlants.id, d.plantId))
  if (plant?.method !== 'manual') {
    throw new HeatingError(400,
      'Rechnet ein Messdienst oder die Gemeinschaft ab, steckt der Brennstoff in deren Einzelbeträgen; eine Lieferung wird dort mit keiner Position verknüpft. Tragen Sie die Rechnung nur als Lieferung ein.')
  }
  const end = d.to ?? d.deliveredAt
  const heating = await heatingRulesOf(db, d.plantId)
  if (end === null || heating === null) return
  const h = periodContaining(heating.rules, end)
  if (after.period !== h.key) {
    throw new HeatingError(400,
      `Die Rechnung „${d.label || formatDayRange(d.from ?? end, end)}“ endet am ${formatDayRange(end, end)} und gehört deshalb in die Heizperiode ${periodLabel(h)}. ` +
        'Bitte wählen Sie für die Position diesen Zeitraum; den Teil der Heizperiode davor bucht Mietfuchs selbst hinüber.')
  }
}
```

`guardCostItem` (Fassung von PR 5) bekommt als letzte Zeile:

```ts
  await guardFuelLink(db, after)
```

`readingCollection`: `guard: noGuard` ersetzen durch `guard: guardReading` und `remove` ersetzen durch

```ts
  remove: async (db, id) => {
    const [r] = await db.select({ meterId: readings.meterId, date: readings.date }).from(readings).where(eq(readings.id, id))
    if (r) await guardSupplyReading(db, r)
    await db.delete(readings).where(eq(readings.id, id))
  },
```

In `crossPropertyViolations` vor `return befunde`:

```ts
  // Lieferungen (Heizung PR 7): Eine Position zeigt nur auf eine Lieferung einer Anlage ihres Objekts.
  const lieferungen = await db
    .select({ description: costItems.description })
    .from(costItems)
    .innerJoin(fuelDeliveries, eq(costItems.fuelDeliveryId, fuelDeliveries.id))
    .innerJoin(heatingPlants, eq(fuelDeliveries.plantId, heatingPlants.id))
    .where(ne(heatingPlants.propertyId, costItems.propertyId))
  for (const c of lieferungen) befunde.push(`Die Kostenposition „${c.description}“ zeigt auf eine Lieferung einer Heizanlage eines anderen Objekts.`)
```

- [ ] **Step 5: Heizanlage (`server/src/db/heating.ts`)**

Aus `'./schema.ts'` zusätzlich `CO2_RESTRICTIONS, fuelDeliveries` importieren, `STOCK_ENERGIES` aus
`'../fuel.ts'`.

In `mergeHeatingPlant` hinter `changeSplit: …`:

```ts
    nonResidential: merged(body, 'nonResidential', current.nonResidential, (v) => v === true),
    restriction: merged(body, 'restriction', current.restriction, (v) => oneOfOrUndefined(CO2_RESTRICTIONS, v) ?? current.restriction),
    districtEtsNew: merged(body, 'districtEtsNew', current.districtEtsNew, (v) => v === true),
```

In `plantRow` hinter `changeSplit: p.changeSplit,`:

```ts
  nonResidential: p.nonResidential, restriction: p.restriction, districtEtsNew: p.districtEtsNew,
```

In `guardHeatingPlant` vor `await sameProperty(…)`:

```ts
  // § 2 Abs. 4 Satz 2 CO2KostAufG betrifft nur Wärmelieferungen (Heizung PR 7).
  if (after.districtEtsNew && after.energy !== 'districtHeating') {
    throw new HeatingError(400, 'Die Angabe zur Wärme aus dem Emissionshandel gibt es nur bei Fernwärme.')
  }
  if (before !== null) {
    // Verknüpfte Positionen gibt es nur bei freien Schlüsseln, Lieferungen mit Vorrat erst mit der
    // Bestandsrechnung (Heizung PR 7); ein Wechsel ließe sie sonst still anders rechnen.
    const [verknuepft] = await db.select({ n: count() }).from(costItems).innerJoin(fuelDeliveries, eq(costItems.fuelDeliveryId, fuelDeliveries.id)).where(eq(fuelDeliveries.plantId, after.id))
    if (before.method === 'manual' && after.method !== 'manual' && (verknuepft?.n ?? 0) > 0) {
      const n = verknuepft?.n ?? 0
      throw new HeatingError(400, `An dieser Anlage ${n === 1 ? 'ist eine Kostenposition' : `sind ${n} Kostenpositionen`} mit Lieferungen verknüpft. Lösen Sie die Verknüpfungen zuerst; ein Messdienst rechnet den Brennstoff in seinen eigenen Beträgen ab.`)
    }
    const [lieferungen] = await db.select({ n: count() }).from(fuelDeliveries).where(eq(fuelDeliveries.plantId, after.id))
    if (before.energy !== after.energy && STOCK_ENERGIES.includes(after.energy) && (lieferungen?.n ?? 0) > 0) {
      throw new HeatingError(400, 'An dieser Anlage stehen Lieferungen mit Rechnungszeitraum; Heizöl, Flüssiggas, Pellets, Holz und Kohle brauchen die Bestandsrechnung, die mit einer späteren Version kommt.')
    }
  }
```

`PlantRemoval` (Fassung von PR 6) um `| { removed: false; reason: 'deliveries'; count: number }`
ergänzen. In `removeHeatingPlant` direkt hinter der Abfrage der CO₂-Angaben (PR 6):

```ts
  // Lieferungen (Heizung PR 7) hält die Datenbank (RESTRICT); der Satz sagt, was zu tun ist.
  const [lieferungen] = await db.select({ n: count() }).from(fuelDeliveries).where(eq(fuelDeliveries.plantId, id))
  if ((lieferungen?.n ?? 0) > 0) return { removed: false, reason: 'deliveries', count: lieferungen?.n ?? 0 }
```

In `server/src/index.ts` in `app.delete('/api/heating-plants/:id', …)` hinter dem Zweig
`result.reason === 'co2'` (PR 6):

```ts
  if (result.reason === 'deliveries') {
    return res.status(409).json({
      error: `An dieser Heizanlage stehen ${result.count} Lieferungen. Entfernen Sie sie auf der Seite Heizkosten, wenn die Anlage wirklich entfallen soll.`,
    })
  }
```

- [ ] **Step 6: CO₂-Angaben bei freien Schlüsseln (`server/src/db/co2.ts`)**

`ensureHeatingPeriod` bekommt ein `export`.

`LATER_SELF` und `LATER_MANUAL` ersetzen:

```ts
const SERVICE_NOT_SELF = 'Rechnet ein Messdienst oder die Gemeinschaft ab, beantworten Sie die Frage nach der Abzugszeile. Hat der Messdienst die CO₂-Kosten nicht aufgeteilt, wählen Sie „gar nicht aufgeteilt“; mit der Brennstoffrechnung als Lieferung teilt Mietfuchs dann selbst auf.'
const MANUAL_SELF = 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten selbst auf, aus den Lieferungen des Versorgers. Angeben lässt sich hier nur die Fläche der Einstufung, wenn sie von der Wohnfläche der versorgten Wohnungen abweicht.'
```

In `guardCo2` die beiden ersten Zeilen ersetzen:

```ts
  if (ctx.plant.method === 'manual' && st.method !== 'self') throw new HeatingError(400, MANUAL_SELF)
  if (ctx.plant.method !== 'manual' && st.method === 'self') throw new HeatingError(400, SERVICE_NOT_SELF)
```

In `heatingPeriodViews` im Objekt jeder Position hinter `selfAmounts: c.selfAmounts` ergänzen:
`, fuelDeliveryId: c.fuelDeliveryId`.

- [ ] **Step 7: Lieferungen und Ortswerte (`server/src/db/fuel.ts`)**

```ts
// Brennstofflieferungen einer Heizanlage (Heizung PR 7, #97; Entwurf 5.4, 8.2): anlegen, ändern,
// entfernen; die Ortswerte der Gradtagzahlen. Mit Task 9 kommen hier die Schätzung beim Abschluss und
// das Einfrieren dazu.
//
// **Was eine Lieferung in dieser Version sein kann:** eine Rechnung über Gas, Fernwärme oder Strom
// einer Wärmepumpe mit Rechnungszeitraum. Lieferungen mit Vorrat brauchen die Bestandsrechnung (PR 8),
// Lieferungen je Wohnung die Etagenheizung (PR 9), Netzentgelte und Biobrennstoff § 5a (PR 18); der
// Server lehnt sie bis dahin mit einem Satz ab.
//
// **Gesperrt** ist eine Lieferung, von der eine abgeschlossene Heizperiode einen Teil eingefroren hat
// (8.2, G-A4): Mengen, Zeiträume und Beträge, nicht die Bezeichnung.
//
// Diese Datei importiert aus repository.ts und read.ts, nie umgekehrt.
import { count, eq } from 'drizzle-orm'
import { parsePeriodKey, periodsBetween } from '../../../shared/period.ts'
import type { DegreeDayValue, FuelDelivery, FuelDeliveryPart, HeatingEnergy, HeatingMethod } from '../../../shared/types.ts'
import { STOCK_ENERGIES } from '../fuel.ts'
import type { Database, Executor } from './client.ts'
import { readDegreeDayValues, readFuelDeliveries } from './read.ts'
import { asNullableFilled, asText, HeatingError, heatingRulesOf, ISO_DATE, merged, oneOfOrUndefined, raw } from './repository.ts'
import { costItems, degreeDayValues, FUEL_QUANTITY_UNITS, fuelCarryFrozen, fuelDeliveries, fuelDeliveryParts, GAS_BASES, heatingPlants, properties } from './schema.ts'

const LATER = {
  stock: 'Lieferungen von Heizöl, Flüssiggas, Pellets, Holz und Kohle brauchen die Bestandsrechnung mit Anfangs- und Endbestand; sie kommt mit einer späteren Version. Bis dahin verteilen Sie diese Rechnungen wie bisher als Kostenpositionen.',
  other: 'Tragen Sie zuerst bei der Heizanlage den Energieträger ein; Lieferungen gibt es für Gas, Fernwärme und Strom einer Wärmepumpe.',
  perUnit: 'Lieferungen je Wohnung (Etagenheizungen mit Vertrag auf den Vermieter) kommen mit einer späteren Version.',
  halfSplit: 'Netzentgelte und Biobrennstoff nach § 5a CO2KostAufG kommen mit einer späteren Version.',
  self: 'Die eigene Heizkostenabrechnung kommt mit einer späteren Version.',
}
const frozenText = (label: string): string =>
  `Ein Teil der Lieferung „${label}“ ist in einer abgeschlossenen Heizperiode eingefroren; Mengen, Zeiträume und Beträge lassen sich deshalb nicht mehr ändern. Öffnen Sie die Abrechnung dieser Heizperiode wieder, um etwas zu ändern.`

const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

// Die Teilmengen aus dem Rumpf, nach Beginn geordnet. Eine leere Zeile fällt weg; eine halbe ist ein
// Fehler mit Satz, kein stilles Weglassen.
function readParts(value: unknown): FuelDeliveryPart[] {
  if (!Array.isArray(value)) return []
  const parts: FuelDeliveryPart[] = []
  for (const row of value) {
    const from = asNullableFilled(raw(row, 'from'))
    const to = asNullableFilled(raw(row, 'to'))
    const amountCents = nullableInt(raw(row, 'amountCents'))
    if (from === null && to === null && amountCents === null) continue
    if (from === null || to === null || amountCents === null) throw new HeatingError(400, 'Eine Teilmenge braucht Beginn, Ende und Betrag.')
    parts.push({
      from, to, amountCents,
      energyKwh: nullableNumber(raw(row, 'energyKwh')),
      fixedCents: nullableInt(raw(row, 'fixedCents')),
      emissionsKg: nullableNumber(raw(row, 'emissionsKg')),
      co2CostCents: nullableInt(raw(row, 'co2CostCents')),
    })
  }
  return parts.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

// Ergänzt, wie die Sammlungen in repository.ts: Was im Rumpf steht, ersetzt; was fehlt, bleibt.
// `estimated` setzt nur der Abschluss (Task 9), nie der Rumpf.
function mergeDelivery(current: FuelDelivery, body: unknown): FuelDelivery {
  return {
    ...current,
    label: merged(body, 'label', current.label, (v) => asText(v, '')),
    invoiceDate: merged(body, 'invoiceDate', current.invoiceDate, asNullableFilled),
    deliveredAt: merged(body, 'deliveredAt', current.deliveredAt, asNullableFilled),
    invoiceFrom: merged(body, 'invoiceFrom', current.invoiceFrom, asNullableFilled),
    invoiceTo: merged(body, 'invoiceTo', current.invoiceTo, asNullableFilled),
    unitId: merged(body, 'unitId', current.unitId, asNullableFilled),
    amountCents: merged(body, 'amountCents', current.amountCents, nullableInt),
    quantity: merged(body, 'quantity', current.quantity, nullableNumber),
    quantityUnit: merged(body, 'quantityUnit', current.quantityUnit, (v) => oneOfOrUndefined(FUEL_QUANTITY_UNITS, v) ?? null),
    energyKwh: merged(body, 'energyKwh', current.energyKwh, nullableNumber),
    gasBasis: merged(body, 'gasBasis', current.gasBasis, (v) => oneOfOrUndefined(GAS_BASES, v) ?? null),
    heatingValue: merged(body, 'heatingValue', current.heatingValue, nullableNumber),
    emissionsKg: merged(body, 'emissionsKg', current.emissionsKg, nullableNumber),
    co2CostCents: merged(body, 'co2CostCents', current.co2CostCents, nullableInt),
    emissionFactor: merged(body, 'emissionFactor', current.emissionFactor, nullableNumber),
    gridFeeCents: merged(body, 'gridFeeCents', current.gridFeeCents, nullableInt),
    bioCostCents: merged(body, 'bioCostCents', current.bioCostCents, nullableInt),
    sharePermille: merged(body, 'sharePermille', current.sharePermille, nullableNumber),
    fixedCents: merged(body, 'fixedCents', current.fixedCents, nullableInt),
    usedByService: merged(body, 'usedByService', current.usedByService, (v) => v !== false),
    parts: merged(body, 'parts', current.parts, readParts),
  }
}

const emptyDelivery = (id: string, plantId: string): FuelDelivery => ({
  id, plantId, label: '', invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null, unitId: null, amountCents: null,
  quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
})

type PlantFacts = { id: string; energy: HeatingEnergy; method: HeatingMethod }

async function plantOf(db: Executor, plantId: string): Promise<PlantFacts | null> {
  const [p] = await db.select({ id: heatingPlants.id, energy: heatingPlants.energy, method: heatingPlants.method }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  return p ?? null
}

async function frozenCount(db: Executor, id: string): Promise<number> {
  const [n] = await db.select({ n: count() }).from(fuelCarryFrozen).where(eq(fuelCarryFrozen.deliveryId, id))
  return n?.n ?? 0
}

async function guardDelivery(db: Executor, plant: PlantFacts, before: FuelDelivery | null, after: FuelDelivery): Promise<void> {
  if (plant.method === 'self') throw new HeatingError(400, LATER.self)
  if (STOCK_ENERGIES.includes(plant.energy)) throw new HeatingError(400, LATER.stock)
  if (plant.energy === 'other') throw new HeatingError(400, LATER.other)
  if (after.unitId !== null) throw new HeatingError(400, LATER.perUnit)
  if (after.gridFeeCents !== null || after.bioCostCents !== null) throw new HeatingError(400, LATER.halfSplit)
  const what = `„${after.label || 'Lieferung'}“`
  const dates: [string | null, string][] = [
    [after.invoiceDate, 'Rechnungsdatum'], [after.invoiceFrom, 'Beginn des Rechnungszeitraums'], [after.invoiceTo, 'Ende des Rechnungszeitraums'], [after.deliveredAt, 'Lieferdatum'],
  ]
  for (const [v, name] of dates) {
    if (v !== null && !ISO_DATE.test(v)) throw new HeatingError(400, `${name} von ${what} ist kein Datum. Bitte wählen Sie es im Kalender.`)
  }
  if (after.invoiceFrom === null || after.invoiceTo === null) {
    throw new HeatingError(400, `Bei Gas, Fernwärme und Strom braucht ${what} den Rechnungszeitraum (Beginn und Ende laut Rechnung); nach ihm teilt Mietfuchs die Rechnung auf die Heizperioden auf.`)
  }
  if (after.invoiceFrom > after.invoiceTo) throw new HeatingError(400, `Der Rechnungszeitraum von ${what} endet vor seinem Beginn.`)
  if (plant.method === 'manual' && after.amountCents !== null && !after.estimated) {
    throw new HeatingError(400, `Bei freien Schlüsseln steht der Betrag in der Kostenposition: Verknüpfen Sie die Position mit ${what}, statt hier einen Betrag einzutragen.`)
  }
  const notNegative: [number | null, string][] = [
    [after.fixedCents, 'Der feste Preisbestandteil'], [after.emissionsKg, 'Der CO₂-Ausstoß'], [after.co2CostCents, 'Die CO₂-Kosten'],
    [after.energyKwh, 'Die Energie'], [after.quantity, 'Die Menge'], [after.emissionFactor, 'Der Emissionsfaktor'],
  ]
  for (const [v, name] of notNegative) if (v !== null && v < 0) throw new HeatingError(400, `${name} von ${what} ist eine Zahl ab 0.`)
  if (after.heatingValue !== null && !(after.heatingValue > 0)) throw new HeatingError(400, `Der Heizwert von ${what} ist eine Zahl über 0.`)
  if (after.sharePermille !== null) {
    if (after.sharePermille < 0 || after.sharePermille > 1000) throw new HeatingError(400, 'Ein eingetragener Anteil liegt zwischen 0 und 1000 ‰.')
    const heating = await heatingRulesOf(db, plant.id)
    if (heating && periodsBetween(heating.rules, after.invoiceFrom, after.invoiceTo).length > 2) {
      throw new HeatingError(400, `${what} reicht über mehr als zwei Heizperioden; einen eingetragenen Anteil gibt es nur für eine Rechnung, die zwei berührt. Lassen Sie Mietfuchs nach Zählerstand oder Gradtagen teilen, oder erfassen Sie Teilmengen.`)
    }
  }
  let last: string | null = null
  for (const p of after.parts) {
    if (!ISO_DATE.test(p.from) || !ISO_DATE.test(p.to) || p.from > p.to) throw new HeatingError(400, 'Eine Teilmenge braucht Beginn und Ende als Datum; das Ende liegt nicht vor dem Beginn.')
    if (p.from < after.invoiceFrom || p.to > after.invoiceTo) throw new HeatingError(400, 'Eine Teilmenge liegt außerhalb des Rechnungszeitraums.')
    if (last !== null && p.from <= last) throw new HeatingError(400, 'Teilmengen dürfen sich nicht überschneiden.')
    if ((p.fixedCents ?? 0) < 0 || (p.emissionsKg ?? 0) < 0 || (p.co2CostCents ?? 0) < 0 || (p.energyKwh ?? 0) < 0) throw new HeatingError(400, 'Die Zahlen einer Teilmenge sind Zahlen ab 0, nur der Betrag darf negativ sein.')
    last = p.to
  }
  if (before !== null && (await frozenCount(db, before.id)) > 0) {
    const same = (d: FuelDelivery) => JSON.stringify({ ...d, label: '', usedByService: true })
    if (same(before) !== same(after)) throw new HeatingError(409, frozenText(before.label || 'Lieferung'))
  }
}

const rowOf = (d: FuelDelivery) => {
  const { parts: _parts, ...row } = d
  return row
}

async function writeParts(db: Executor, d: FuelDelivery): Promise<void> {
  await db.delete(fuelDeliveryParts).where(eq(fuelDeliveryParts.deliveryId, d.id))
  if (d.parts.length > 0) await db.insert(fuelDeliveryParts).values(d.parts.map((p) => ({ deliveryId: d.id, ...p })))
}

// `null`: Diese Anlage gibt es nicht; die Route macht daraus ihre 404.
export async function listDeliveries(db: Database, plantId: string): Promise<FuelDelivery[] | null> {
  if (!(await plantOf(db, plantId))) return null
  return (await readFuelDeliveries(db)).filter((d) => d.plantId === plantId)
}

export async function createDelivery(db: Database, id: string, plantId: string, body: unknown): Promise<FuelDelivery | null> {
  const plant = await plantOf(db, plantId)
  if (!plant) return null
  const d = mergeDelivery(emptyDelivery(id, plantId), body)
  await db.transaction(async (tx) => {
    await guardDelivery(tx, plant, null, d)
    await tx.insert(fuelDeliveries).values(rowOf(d))
    await writeParts(tx, d)
  })
  return (await readFuelDeliveries(db)).find((x) => x.id === id) ?? null
}

export async function updateDelivery(db: Database, id: string, body: unknown): Promise<FuelDelivery | null> {
  const current = (await readFuelDeliveries(db)).find((x) => x.id === id)
  if (!current) return null
  const plant = await plantOf(db, current.plantId)
  if (!plant) return null
  const next = mergeDelivery(current, body)
  await db.transaction(async (tx) => {
    await guardDelivery(tx, plant, current, next)
    await tx.update(fuelDeliveries).set(rowOf(next)).where(eq(fuelDeliveries.id, id))
    await writeParts(tx, next)
  })
  return (await readFuelDeliveries(db)).find((x) => x.id === id) ?? null
}

// `false`: Diese Lieferung gibt es nicht. Eingefrorene Teile und verknüpfte Positionen halten sie.
export async function removeDelivery(db: Database, id: string): Promise<boolean> {
  const current = (await readFuelDeliveries(db)).find((x) => x.id === id)
  if (!current) return false
  if ((await frozenCount(db, id)) > 0) throw new HeatingError(409, frozenText(current.label || 'Lieferung'))
  const [linked] = await db.select({ n: count() }).from(costItems).where(eq(costItems.fuelDeliveryId, id))
  const n = linked?.n ?? 0
  if (n > 0) {
    throw new HeatingError(409, `An der Lieferung „${current.label || 'Lieferung'}“ hängen noch ${n} ${n === 1 ? 'Kostenposition' : 'Kostenpositionen'}. Lösen Sie zuerst die Verknüpfung oder löschen Sie die Positionen.`)
  }
  await db.transaction(async (tx) => { await tx.delete(fuelDeliveries).where(eq(fuelDeliveries.id, id)) })
  return true
}

// ---------- Ortswerte der Gradtagzahlen (Stufe 4 in 3.2) ----------

async function propertyExists(db: Executor, propertyId: string): Promise<boolean> {
  const [p] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId))
  return p !== undefined
}

// `null`: Dieses Objekt gibt es nicht.
export async function listDegreeDays(db: Database, propertyId: string): Promise<DegreeDayValue[] | null> {
  if (!(await propertyExists(db, propertyId))) return null
  return (await readDegreeDayValues(db)).filter((v) => v.propertyId === propertyId).map(({ month, value }) => ({ month, value }))
}

// Die Liste ersetzt alle Werte des Objekts; eine leere Liste löscht sie.
export async function saveDegreeDays(db: Database, propertyId: string, body: unknown): Promise<DegreeDayValue[] | null> {
  if (!(await propertyExists(db, propertyId))) return null
  const list = raw(body, 'values')
  if (!Array.isArray(list)) throw new HeatingError(400, 'Bitte schicken Sie die Gradtagzahlen als Liste von Monat und Wert.')
  const values: DegreeDayValue[] = []
  const seen = new Set<string>()
  for (const row of list) {
    const month = parsePeriodKey(raw(row, 'month'))
    const value = raw(row, 'value')
    if (month === null || seen.has(month)) throw new HeatingError(400, 'Jede Gradtagzahl braucht einen Monat (JJJJ-MM), jeder Monat einmal.')
    if (typeof value !== 'number' || !(value > 0)) throw new HeatingError(400, 'Eine Gradtagzahl ist eine Zahl über 0.')
    seen.add(month)
    values.push({ month, value })
  }
  await db.transaction(async (tx) => {
    await tx.delete(degreeDayValues).where(eq(degreeDayValues.propertyId, propertyId))
    if (values.length > 0) await tx.insert(degreeDayValues).values(values.map((v) => ({ propertyId, ...v })))
  })
  return listDegreeDays(db, propertyId)
}
```

Hinweis: `JSON.stringify` vergleicht zwei Objekte derselben Herkunft (`mergeDelivery` behält die
Reihenfolge der Schlüssel), deshalb ist der Vergleich eindeutig.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-fuel.test.ts test/db-co2.test.ts test/db-heizanlage.test.ts test/db-repository.test.ts test/db-stock.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS (db-fuel.test.ts: 8 Tests).

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db server/src/index.ts server/test
git commit -m "Lieferungen speichern und lesen; Verknüpfung, eingefrorene Teile und Ablesungen gesperrt

Nur Gas, Fernwärme und Strom mit Rechnungszeitraum; Vorrat, Etagenheizung und § 5a lehnt der
Server mit einem Satz ab. Eine Position steht in der Heizperiode, die das Ende ihrer Rechnung
enthält; eine Anlage mit Lieferungen wird nicht still entfernt.

Refs #97"
```

---
### Task 5: Routen der Lieferungen und Ortswerte

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 4): `listDeliveries`, `createDelivery`, `updateDelivery`, `removeDelivery`, `listDegreeDays`, `saveDegreeDays`; `readData`, `writeData`, `bodyObject`, `newId` in index.ts; `HeatingError` in der Fehlerbehandlung (PR 4).
- Produces:
  - `GET /api/heating-plants/:id/deliveries` → `FuelDelivery[]` (404 ohne Anlage)
  - `POST /api/heating-plants/:id/deliveries` → 201 `FuelDelivery`
  - `PUT /api/fuel-deliveries/:id` → `FuelDelivery`; `DELETE /api/fuel-deliveries/:id` → `{ ok: true }` (404 ohne Lieferung)
  - `GET /api/properties/:id/degree-days` → `DegreeDayValue[]`; `PUT /api/properties/:id/degree-days` mit `{ values: DegreeDayValue[] }` → `DegreeDayValue[]`

- [ ] **Step 1: Write the failing test**

In `server/test/api.test.ts` den Typimport aus `'../../shared/types.ts'` um `DegreeDayValue,
FuelDelivery` ergänzen und anhängen:

```ts
// ---------- Lieferungen (Heizung PR 7) ----------

test('Lieferungen über die Routen: anlegen, lesen, ändern, Sperre, entfernen; Ortswerte', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'manual' })))
    const angelegt = await send(`/api/heating-plants/${plant.id}/deliveries`, postJson({ label: 'Gas', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', emissionsKg: 5406.17 }))
    assert.equal(angelegt.status, 201)
    const d = await jsonOf<FuelDelivery>(angelegt)
    assert.deepEqual((await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)).map((x) => x.id), [d.id])
    const geaendert = await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 12000 }) })
    assert.equal((await jsonOf<FuelDelivery>(geaendert)).fixedCents, 12000)
    const etage = await send(`/api/heating-plants/${plant.id}/deliveries`, postJson({ label: 'x', unitId: 'egal', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }))
    assert.equal(etage.status, 400)
    assert.match(await errorFrom(etage), /späteren Version/)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/deliveries', { method: 'GET' })).status, 404)
    assert.equal((await send('/api/fuel-deliveries/gibt-es-nicht', { method: 'PUT', body: '{}' })).status, 404)
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /Lieferungen/)
    assert.deepEqual(await jsonOf<unknown>(await send(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })), { ok: true })
    assert.equal((await send(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })).status, 404)
    const ortswerte = await send(`/api/properties/${plant.propertyId}/degree-days`, { method: 'PUT', body: JSON.stringify({ values: [{ month: '2025-01', value: 412.5 }] }) })
    assert.deepEqual(await jsonOf<DegreeDayValue[]>(ortswerte), [{ month: '2025-01', value: 412.5 }])
    assert.deepEqual(await s.api<DegreeDayValue[]>(`/api/properties/${plant.propertyId}/degree-days`), [{ month: '2025-01', value: 412.5 }])
    assert.equal((await send('/api/properties/gibt-es-nicht/degree-days', { method: 'GET' })).status, 404)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- --test-name-pattern "Lieferungen über die Routen" test/api.test.ts`
Expected: FAIL: `POST …/deliveries` antwortet mit 404 (die Route gibt es nicht).

- [ ] **Step 3: Routen (`server/src/index.ts`)**

Import: `import { createDelivery, listDegreeDays, listDeliveries, removeDelivery, saveDegreeDays, updateDelivery } from './db/fuel.ts'`.
Hinter dem Block `// ---------- Heizperioden: CO₂ und Warmwasser (Heizung PR 6) ----------`:

```ts
// ---------- Brennstofflieferungen (Heizung PR 7) ----------
// Was gespeichert wird und was nicht, steht in db/fuel.ts; gerechnet wird in fuel.ts und calc.ts.
const NO_DELIVERY = 'Diese Lieferung gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/heating-plants/:id/deliveries', async (req, res) => {
  const list = await readData((db) => listDeliveries(db, req.params.id))
  if (!list) return res.status(404).json({ error: NO_PLANT })
  res.json(list)
})
app.post('/api/heating-plants/:id/deliveries', async (req, res) => {
  const created = await writeData((db) => createDelivery(db, newId(), req.params.id, bodyObject(req)))
  if (!created) return res.status(404).json({ error: NO_PLANT })
  res.status(201).json(created)
})
app.put('/api/fuel-deliveries/:id', async (req, res) => {
  const saved = await writeData((db) => updateDelivery(db, req.params.id, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_DELIVERY })
  res.json(saved)
})
app.delete('/api/fuel-deliveries/:id', async (req, res) => {
  const removed = await writeData((db) => removeDelivery(db, req.params.id))
  if (!removed) return res.status(404).json({ error: NO_DELIVERY })
  res.json({ ok: true })
})
// Die Gradtagzahlen des Orts (Stufe 4 in 3.2), je Objekt.
const NO_PROPERTY = 'Dieses Objekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/properties/:id/degree-days', async (req, res) => {
  const values = await readData((db) => listDegreeDays(db, req.params.id))
  if (!values) return res.status(404).json({ error: NO_PROPERTY })
  res.json(values)
})
app.put('/api/properties/:id/degree-days', async (req, res) => {
  const values = await writeData((db) => saveDegreeDays(db, req.params.id, bodyObject(req)))
  if (!values) return res.status(404).json({ error: NO_PROPERTY })
  res.json(values)
})
```

`NO_PLANT` steht seit PR 6 im Block der Heizperioden. Gibt es dort schon eine Konstante mit dem Satz
eines fehlenden Objekts, diese nehmen statt `NO_PROPERTY`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/test/api.test.ts
git commit -m "Routen für Lieferungen und die Gradtagzahlen des Orts

Refs #97"
```

---
### Task 6: Lieferungen im Schnappschuss

Der Schnappschuss eines Zeitraums bekommt die Lieferungen der Anlagen des Objekts, die Positionen, die
auf sie zeigen (über alle Zeiträume, denn der Teil einer Heizperiode folgt dem Schlüssel einer Position
aus einer anderen), die eingefrorenen Überträge, die abgeschlossenen Heizperioden samt Frist und den
Übertragszeilen ihres eingefrorenen Stands, und die Ortswerte der Gradtage (Entwurf 5.8).

**Files:**
- Modify: `server/src/snapshot.ts`
- Test: `server/test/calc-fuel.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2, 4; PR 5): `FuelDelivery`, `FrozenFuelCarry`, `DegreeDayValue`; `wayOf`, `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`; `periodOfKey`, `periodLabel`, `settlementDeadline`; `snapshotFor`, `heatingSnapshotFor`, `frozenSettlementOf`, `narrowToProperty`.
- Produces:
  - `SnapshotCostItem` pickt zusätzlich `'fuelDeliveryId'`; `SnapshotHeatingPlant` mit optionalen `'nonResidential' | 'restriction' | 'districtEtsNew'`
  - `type FrozenFuelRow = { costItemId: string; tenancyId: string; tenantName: string; unitName: string; shareCents: number }`, `frozenFuelRowsOf(settlement: unknown): FrozenFuelRow[]`; `SnapshotClosedSettlement.fuelCarryRows?: FrozenFuelRow[]` (gefüllt von `frozenSettlementOf`)
  - `type SnapshotFuelDelivery = Pick<FuelDelivery, 'id' | 'plantId' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'>`
  - `type SnapshotClosedHeating = { plantId: string; period: PeriodKey; label: string; deadline: string; fuelRows: FrozenFuelRow[] }`
  - `type SnapshotFuel = { deliveries: SnapshotFuelDelivery[]; items: SnapshotCostItem[]; frozen: FrozenFuelCarry[]; closed: SnapshotClosedHeating[]; degreeDays: DegreeDayValue[] }`, `Snapshot.fuel?: SnapshotFuel`
  - Quelle von `snapshotFor` (und damit `heatingSnapshotFor`): `fuelDeliveries?`, `fuelCarryFrozen?`, `degreeDayValues?`

- [ ] **Step 1: Write the failing test**

`server/test/calc-fuel.test.ts`:

```ts
// Brennstofflieferungen im Schnappschuss und in der Abrechnung (Heizung PR 7, Entwurf 5.8, 8.2, 12.2,
// 12.3). Ein Haus mit zwei Wohnungen, Objekt von Mai bis April, eine Gasheizung mit freien Schlüsseln;
// die Gasrechnung 15.03.2025–14.03.2026 über 6.500 € steht in der Heizperiode 2025/2026.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { frozenFuelRowsOf, snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, FuelDelivery, LandlordPart, PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const P = (key: string, rules: PeriodRules = MAI): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
type Quelle = Parameters<typeof snapshotFor>[0]

const anlage = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant & { propertyId: string } => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null,
  propertyId: 'objekt-1', ...over,
})
const lieferung = (over: Partial<FuelDelivery> = {}): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: periodKey('2025-05'), category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area',
  heatingPlantId: 'hp', fuelDeliveryId: 'd', ...over,
})
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: `Mieter ${unitId.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const abgeschlossen = (key: string, over: Record<string, unknown> = {}) => ({
  period: periodKey(key), propertyId: 'objekt-1', selfUsedShareCents: 0, prepaymentCents: 0, prepaymentOverridden: false, ...over,
})

function quelle(over: Partial<Quelle> = {}): Quelle {
  return {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: MAI }],
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: true, propertyId: 'objekt-1' },
    ],
    tenancies: [mieter('ta', 'a'), mieter('tb', 'b')],
    costItems: [position({ id: 'gas' })],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [anlage()],
    fuelDeliveries: [lieferung()],
    ...over,
  }
}
const snap = (key: string, over: Partial<Quelle> = {}, rules: PeriodRules = MAI) => snapshotFor(quelle(over), 'objekt-1', P(key, rules))
const settle = (key: string, over: Partial<Quelle> = {}, asOf?: string): ComputedSettlement =>
  computeSettlement(snap(key, over), asOf ? { asOf } : {})

test('Schnappschuss: ohne Lieferung kein Feld `fuel`; mit Lieferung ihre Positionen auch aus anderen Zeiträumen', () => {
  assert.equal(snap('2025-05', { fuelDeliveries: [] }).fuel, undefined)
  const s = snap('2024-05')
  assert.deepEqual(s.fuel?.deliveries.map((d) => d.id), ['d'])
  assert.deepEqual(s.fuel?.items.map((c) => c.id), ['gas'], 'die Position aus 2025/2026 trägt den Schlüssel der Übertragszeile in 2024/2025')
  assert.deepEqual(s.costItems.map((c) => c.id), [], 'verteilt wird in 2024/2025 nur der Übertrag')
})

test('Schnappschuss: abgeschlossene Heizperioden mit Frist und Übertragszeilen; eigene Heizperiode der Anlage', () => {
  const zeilen = { statements: [{ tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', rows: [{ kind: 'fuelCarry', costItemId: 'fuel:e:2024-05:gas0', shareCents: 54464 }, { costItemId: 'x', shareCents: 1 }] }] }
  assert.deepEqual(frozenFuelRowsOf(zeilen), [{ costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', shareCents: 54464 }])
  assert.deepEqual(frozenFuelRowsOf(null), [])
  const s = snap('2025-05', { closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(zeilen) })] })
  assert.deepEqual(s.fuel?.closed, [{ plantId: 'hp', period: '2024-05', label: '2024/2025', deadline: '2026-04-30', fuelRows: frozenFuelRowsOf(zeilen) }])
  // Objekt im Kalenderjahr, Anlage von Mai bis April: Mit P = 2025 ist die Heizperiode 2024/2025 abgeschlossen.
  const eigen = snapshotFor(quelle({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    heatingPlants: [anlage({ periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false })],
    closedSettlements: [abgeschlossen('2025-01')],
  }), 'objekt-1', P('2026-01', CALENDAR_RULES))
  assert.deepEqual(eigen.fuel?.closed.map((c) => [c.period, c.label, c.deadline]), [['2024-05', '2025', '2026-12-31']])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/calc-fuel.test.ts`
Expected: FAIL beim Import: `frozenFuelRowsOf` gibt es nicht; der Übersetzer meldet die unbekannten
Felder `fuelDeliveries` und `fuelDeliveryId`.

- [ ] **Step 3: Implement (`server/src/snapshot.ts`)**

Den Typimport aus `'../../shared/types.ts'` um `DegreeDayValue, FrozenFuelCarry, FuelDelivery`
ergänzen, aus `'../../shared/period.ts'` um `periodLabel, periodOfKey, settlementDeadline` (soweit
nicht da), aus `'../../shared/heatingPeriod.ts'` um `heatingPeriodsEndingIn, plantRules,
settledSeparately` (PR 5 importiert sie schon).

In `SnapshotCostItem` die Liste der gepickten Felder hinter `| 'heatingPlantId'` (PR 5) um
`| 'fuelDeliveryId'` ergänzen.

`SnapshotHeatingPlant` (Fassung von PR 6) ersetzen:

```ts
// Die Heizanlagen des Objekts (Heizung PR 4), eingedampft auf das, was die Berechnung liest. Seit
// Heizung PR 5 dazu Name, eigene Heizperiode und die Spannen nach Weg d, seit PR 6 der Energieträger,
// seit PR 7 die CO₂-Merkmale (§ 8, § 9, § 2 Abs. 4 Satz 2 CO2KostAufG). Fehlen die optionalen Felder
// (ein von Hand gebauter Schnappschuss), folgt die Anlage dem Objekt, rechnet nichts getrennt ab und
// hat keine Merkmale.
export type SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'energy' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
  & Partial<Pick<HeatingPlant, 'name' | 'periodStartMonth' | 'periodChanges' | 'separateSpans' | 'separateSettlement' | 'nonResidential' | 'restriction' | 'districtEtsNew'>>
```

In `SnapshotClosedSettlement` als letztes Feld:

```ts
  // Die Übertragszeilen der Mieter (Heizung PR 7), für die Gutschrift je Mieter bei einer zu hohen
  // Schätzung (8.2, A4). Fehlt das Feld, gibt es keine.
  fuelCarryRows?: FrozenFuelRow[]
```

Vor `frozenSettlementOf`:

```ts
// Eine Übertragszeile eines eingefrorenen Stands (Heizung PR 7): `costItemId` ist
// `fuel:<Lieferung>:<Heizperiode>:<Position>`.
export type FrozenFuelRow = { costItemId: string; tenancyId: string; tenantName: string; unitName: string; shareCents: number }

// Die Übertragszeilen aus einem Archivstück, wie `frozenSettlementOf` es liest: Was keine Zeile der Art
// `fuelCarry` ist oder nicht die erwartete Gestalt hat, fällt weg.
export function frozenFuelRowsOf(settlement: unknown): FrozenFuelRow[] {
  if (settlement === null || typeof settlement !== 'object') return []
  const statements: unknown = Reflect.get(settlement, 'statements')
  if (!Array.isArray(statements)) return []
  const rows: FrozenFuelRow[] = []
  for (const st of statements) {
    if (st === null || typeof st !== 'object') continue
    const tenancyId: unknown = Reflect.get(st, 'tenancyId')
    const tenantName: unknown = Reflect.get(st, 'tenantName')
    const unitName: unknown = Reflect.get(st, 'unitName')
    const list: unknown = Reflect.get(st, 'rows')
    if (typeof tenancyId !== 'string' || !Array.isArray(list)) continue
    for (const r of list) {
      if (r === null || typeof r !== 'object' || Reflect.get(r, 'kind') !== 'fuelCarry') continue
      const costItemId: unknown = Reflect.get(r, 'costItemId')
      const shareCents: unknown = Reflect.get(r, 'shareCents')
      if (typeof costItemId !== 'string' || typeof shareCents !== 'number') continue
      rows.push({ costItemId, tenancyId, tenantName: typeof tenantName === 'string' ? tenantName : '', unitName: typeof unitName === 'string' ? unitName : '', shareCents })
    }
  }
  return rows
}
```

`frozenSettlementOf`: im Rückgabetyp `& { … itemTotals: … }` um `fuelCarryRows: FrozenFuelRow[]`
ergänzen, in `leer` um `fuelCarryRows: []`, und im Objekt `auszug` hinter `itemTotals: itemTotalsOf(settlement),`:

```ts
    fuelCarryRows: frozenFuelRowsOf(settlement),
```

Hinter `SnapshotHeatingPeriodRow` (PR 6):

```ts
// Die Lieferungen im Schnappschuss (Heizung PR 7, Entwurf 5.8). Die Abgrenzung liest Zeitraum, Betrag,
// feste Bestandteile, Anteil, Ausstoß und CO₂-Kosten; Menge, Heizwert und Rechnungsdatum nicht.
export type SnapshotFuelDelivery = Pick<
  FuelDelivery,
  'id' | 'plantId' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'
>
// Eine abgeschlossene Heizperiode einer Anlage, mit der Bezeichnung und der Frist der Abrechnung, die
// sie abgeschlossen hat, und deren Übertragszeilen.
export type SnapshotClosedHeating = { plantId: string; period: PeriodKey; label: string; deadline: string; fuelRows: FrozenFuelRow[] }
export type SnapshotFuel = {
  deliveries: SnapshotFuelDelivery[]
  items: SnapshotCostItem[]
  frozen: FrozenFuelCarry[]
  closed: SnapshotClosedHeating[]
  degreeDays: DegreeDayValue[]
}

type FuelSource = {
  fuelDeliveries?: FuelDelivery[]
  fuelCarryFrozen?: FrozenFuelCarry[]
  degreeDayValues?: (DegreeDayValue & { propertyId: string })[]
  closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
}

// Die Lieferungen der Anlagen eines Objekts (Heizung PR 7): alle, mit den Positionen, die auf sie
// zeigen, über alle Zeiträume; die eingefrorenen Überträge; die abgeschlossenen Heizperioden. Eine
// Heizperiode ist abgeschlossen mit der Abrechnung des Objektzeitraums, in dem sie endet, oder nach
// Weg d mit ihrer Heizkostenabrechnung (W1, B3). Ohne Lieferung `undefined`: Dann bleibt der
// Schnappschuss, wie er war, und keine Abrechnung ändert sich.
function fuelSnapshotOf(
  source: FuelSource,
  propertyId: string,
  narrowed: { costItems: SnapshotCostItem[]; closedSettlements: (SnapshotClosedSettlement & { period: PeriodKey })[] },
  plants: readonly SnapshotHeatingPlant[],
  objectRules: PeriodRules,
): SnapshotFuel | undefined {
  const plantIds = new Set(plants.map((p) => p.id))
  const deliveries = (source.fuelDeliveries ?? []).filter((d) => plantIds.has(d.plantId))
  if (deliveries.length === 0) return undefined
  const ids = new Set(deliveries.map((d) => d.id))
  const closed: SnapshotClosedHeating[] = []
  for (const plant of plants) {
    const way = wayOf(plant)
    const rules = plantRules(way, objectRules)
    const own = (plant.periodStartMonth ?? null) !== null
    for (const c of narrowed.closedSettlements) {
      const p = periodOfKey(objectRules, c.period)
      if (!p) continue
      const hs = own ? heatingPeriodsEndingIn(rules, p).filter((h) => !settledSeparately(way, objectRules, h)) : [p]
      for (const h of hs) closed.push({ plantId: plant.id, period: h.key, label: periodLabel(p), deadline: settlementDeadline(p), fuelRows: c.fuelCarryRows ?? [] })
    }
    for (const c of (source.closedHeatingSettlements ?? []).filter((x) => x.plantId === plant.id)) {
      const h = periodOfKey(rules, c.period)
      if (h) closed.push({ plantId: plant.id, period: h.key, label: periodLabel(h), deadline: settlementDeadline(h), fuelRows: c.fuelCarryRows ?? [] })
    }
  }
  return {
    deliveries,
    items: narrowed.costItems.filter((c) => c.fuelDeliveryId != null && ids.has(c.fuelDeliveryId)),
    frozen: (source.fuelCarryFrozen ?? []).filter((f) => plantIds.has(f.plantId)),
    closed,
    degreeDays: (source.degreeDayValues ?? []).filter((v) => v.propertyId === propertyId).map(({ month, value }) => ({ month, value })),
  }
}
```

In `Snapshot` hinter `heatingPeriodRows?` (PR 6):

```ts
  // Lieferungen, Überträge und abgeschlossene Heizperioden (Heizung PR 7). Fehlt das Feld, gibt es
  // keine Lieferungen, und die Berechnung rechnet wie vorher.
  fuel?: SnapshotFuel
```

`snapshotFor`: den Typ des ersten Parameters um `& FuelSource` ergänzen (neben `heatingPlants?` und
den Feldern aus PR 6). Im Rumpf vor `return {`:

```ts
  const fuel = fuelSnapshotOf(source, propertyId, narrowed, plants, objectRules)
```

und im zurückgegebenen Objekt hinter `heatingPeriodRows: …` (PR 6):

```ts
    ...(fuel ? { fuel } : {}),
```

`heatingSnapshotFor` (PR 5, Heizkostenabrechnung nach Weg d) ebenso: vor `return {` dieselbe Zeile
`const fuel = fuelSnapshotOf(source, propertyId, narrowed, plants, objectRules)`, im Objekt
`...(fuel ? { fuel } : {}),`. Die Teilabrechnung nach Weg b (`scope: 'heatingPart'`) baut ihren
Schnappschuss mit `...snapshot` aus dem von P und bekommt `fuel` damit von selbst.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-fuel.test.ts test/calc.test.ts test/settlement-golden.test.ts test/db-golden.test.ts && npm run typecheck`
Expected: PASS (calc-fuel.test.ts: 2 Tests). Golden unverändert: Ohne Lieferung fehlt `fuel`.

- [ ] **Step 5: Commit**

```bash
git add server/src/snapshot.ts server/test/calc-fuel.test.ts
git commit -m "Schnappschuss: Lieferungen, eingefrorene Überträge und abgeschlossene Heizperioden

Refs #97"
```

---
### Task 7: Berechnung: Überträge, Gegenzeilen, Hinweise, Bewertung

`computeSettlement` rechnet je Anlage, deren Heizperiode der Zeitraum der Berechnung ist, die
Lieferungen mit `plantFuel` (Task 3). Jeder Übertrag wird zu Zeilen ohne Position bei den Mietern, mit
dem Schlüssel der Brennstoffposition verteilt (8.2), und zu einer Gegenzeile beim Vermieter; dazu die
Hinweise `fuel.*` (10.1) und die Bewertung `Settlement.heating[].fuel`. Die Warnung
`period.heating-mismatch` aus PR 3 gilt nur noch ohne Anlage; bei freien Schlüsseln ohne Verknüpfung
wird sie zu `fuel.manual-beyond-period` (3.2, 3.4).

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-fuel.test.ts`

**Interfaces:**
- Consumes (Task 3, 6; PR 3–6): `plantFuel`, `rangeOf`, `FuelCarry`, `FuelResult`; `Snapshot.fuel`, `SnapshotHeatingPlant`, `SnapshotCostItem`, `wayOf`; `plantRules`; `hkvDegreeDays`, `law`, `lawLog`, `lawPeriod`; `formatDayRange`, `periodLabel`, `dayBefore`; in `computeSettlement` `scope`, `objectRules`, `plants`, `period`, `label`, `yFrom`, `yTo`, `items`, `statements`, `landlordRows`, `warn`, `notices`, `totalCostsCents`, die Schleife über die Positionen, `heatingStatements`, `report`, `co2Pots`.
- Produces: Zeilen `kind: 'fuelCarry'` mit `costItemId = fuel:<Lieferung>:<Heizperiode>:<Position>`; Gegenzeilen des Vermieters unter `fuel:<Lieferung>:<Heizperiode>` mit den Gründen `fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`; Codes `fuel.share-by-degree-days`, `fuel.fixed-unknown`, `fuel.closed-period-part`, `fuel.estimated` (hint), `fuel.uncovered`, `fuel.manual-beyond-period`, `fuel.estimate-settled`, `fuel.estimate-overcharged` (warning); `HeatingStatement.fuel`.

- [ ] **Step 1: Write the failing tests**

An `server/test/calc-fuel.test.ts` anhängen (den Import aus `'../src/snapshot.ts'` ist da; aus
`'../../shared/period.ts'` zusätzlich `periodContaining`, aus `'../../shared/types.ts'` zusätzlich
`FrozenFuelCarry`):

```ts
// ---------- Überträge in der Abrechnung (Entwurf 8.2, Fälle a–f) ----------

const anteilVon = (r: ComputedSettlement, tenancyId: string, prefix: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.filter((row) => row.costItemId.startsWith(prefix)).reduce((a, row) => a + row.shareCents, 0) ?? 0
const teileVon = (r: ComputedSettlement, id: string): LandlordPart[] => r.landlord.rows.find((x) => x.costItemId === id)?.landlordParts ?? []
const summe = (r: ComputedSettlement): number => r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const schaetzung = (cents: number) => lieferung({ id: 'e', label: 'Schätzung', invoiceFrom: '2025-03-15', invoiceTo: '2025-04-30', amountCents: cents, estimated: true })
const eingefroren = (deliveryId: string, period: string, cents: number): FrozenFuelCarry => ({ deliveryId, plantId: 'hp', period: periodKey(period), cents, emissionsKg: 0, co2Cents: 0 })
const zeilenDerSchaetzung = (ta: number, tb: number) => [
  { costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', shareCents: ta },
  { costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'tb', tenantName: 'Mieter B', unitName: 'B', shareCents: tb },
]

test('Fall a: H trägt 5.516,61 €, H−1 983,39 €; je Mieter nach dem Schlüssel der Gasposition, Summe 6.500,00 €', () => {
  const h = settle('2025-05')
  assert.deepEqual([anteilVon(h, 'ta', 'gas'), anteilVon(h, 'tb', 'gas')], [390000, 260000])
  assert.deepEqual([anteilVon(h, 'ta', 'fuel:d:'), anteilVon(h, 'tb', 'fuel:d:')], [-59003, -39336])
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  assert.equal(summe(h), 650000)
  const zeile = h.statements[0]?.rows.find((row) => row.kind === 'fuelCarry') ?? assert.fail('keine Übertragszeile')
  assert.equal(zeile.description, 'Gas: Anteil für 2024/2025 (voriger Zeitraum)')
  assert.deepEqual(zeile.steps?.[0], { label: 'Anteil der Rechnung', value: '6.500,00 € × 151,29 ‰ (nach der Gradtagszahlentabelle) = 983,39 €', term: 'degreeDays' })
  const h1 = settle('2024-05')
  assert.deepEqual([anteilVon(h1, 'ta', 'fuel:d:'), anteilVon(h1, 'tb', 'fuel:d:')], [59003, 39336])
  assert.deepEqual(teileVon(h1, 'fuel:d:2024-05'), [{ reason: 'fuelCarry', cents: -98339 }])
  assert.equal(summe(h1), 0)
  assert.equal(h.statements.reduce((a, st) => a + st.totalShareCents, 0) + h1.statements.reduce((a, st) => a + st.totalShareCents, 0), 650000)
})

test('Fall b: Schätzung 907,74 € eingefroren; 75,65 € beim Vermieter, vor und nach Fristablauf benannt', () => {
  const ueber = {
    fuelDeliveries: [lieferung(), schaetzung(90774)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 90774)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(54464, 36310) })],
  }
  const vorher = settle('2025-05', ueber, '2026-03-20')
  assert.deepEqual(teileVon(vorher, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: 7565 }])
  assert.equal(summe(vorher), 650000)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /war 907,74 € geschätzt; tatsächlich entfallen 983,39 €\. Die Differenz von 75,65 € steht bei Ihnen\./)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /berichtigten Abrechnung 2024\/2025; sie muss den Mietern bis 30\.04\.2026 zugehen/)
  const nachher = settle('2025-05', ueber, '2026-06-01')
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /am 30\.04\.2026 abgelaufen\. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben/)
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /in der Regel binnen drei Monaten/)
})

test('Fall c: ohne Schätzung abgeschlossen; 983,39 € beim Vermieter mit Hinweis', () => {
  const h = settle('2025-05', { closedSettlements: [abgeschlossen('2024-05')] })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  assert.match(textOf(h, 'fuel.closed-period-part'), /für 2024\/2025 \(983,39 €\) gehört in die Abrechnung 2024\/2025, die ohne Schätzung abgeschlossen wurde\. Sie tragen ihn selbst\./)
  assert.equal(summe(h), 650000)
})

test('Fall e: Schätzung 1.050,00 € zu hoch; −66,61 € und die Gutschrift je Mieter', () => {
  const h = settle('2025-05', {
    fuelDeliveries: [lieferung(), schaetzung(105000)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 105000)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(63000, 42000) })],
  })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 105000 }, { reason: 'fuelEstimateDiff', cents: -6661 }])
  const n = h.notices.find((x) => x.code === 'fuel.estimate-overcharged') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /haben 66,61 € zu viel getragen, hier: Mieter A \(A\) 39,97 € und Mieter B \(B\) 26,64 €\. Eine Gutschrift ist jederzeit zulässig und wird empfohlen\./)
  assert.equal(summe(h), 650000)
})

test('Fall f: H−1 wieder offen; die Schätzung zählt nicht mehr, H−1 bucht die echte Rechnung herein (Review Focus 3)', () => {
  const ueber = { fuelDeliveries: [lieferung(), schaetzung(90774)] }
  assert.deepEqual(teileVon(settle('2025-05', ueber), 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  const h1 = settle('2024-05', ueber)
  assert.equal(anteilVon(h1, 'ta', 'fuel:e:'), 0)
  assert.equal(anteilVon(h1, 'ta', 'fuel:d:'), 59003)
  assert.ok(!codes(h1).includes('fuel.estimated'))
})

test('Gutschrift derselben Rechnung: beide Positionen im selben Verhältnis, Summe bleibt (Review Focus 1)', () => {
  const ueber = { costItems: [position({ id: 'gas', amountCents: 700000 }), position({ id: 'gs', description: 'Gutschrift Gas', amountCents: -50000 })] }
  const h = settle('2025-05', ueber)
  assert.equal(summe(h), 650000)
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  assert.equal(anteilVon(h, 'ta', 'fuel:d:') + anteilVon(h, 'tb', 'fuel:d:'), -98339)
  const h1 = settle('2024-05', ueber)
  assert.equal(anteilVon(h1, 'ta', 'fuel:d:') + anteilVon(h1, 'tb', 'fuel:d:'), 98339)
})

test('Eigennutzung: Der Eigenanteil der Abrechnung folgt dem Verbrauch, der Übertrag nimmt seinen Teil mit (Entwurf 8.2, N8)', () => {
  const ueber = {
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: false, selfUsed: true, selfPersons: 1, propertyId: 'objekt-1' },
    ],
    tenancies: [mieter('ta', 'a')],
  }
  const h = settle('2025-05', ueber)
  assert.equal(h.selfUsedShareCents, 260000 - 39336)
  assert.equal(summe(h), 650000)
})

test('Hinweise: Gradtage, fester Teil, Lücke; Bewertung mit Abdeckung und Überträgen; Gradtagstabelle im Rechtsstand', () => {
  const h = settle('2025-05')
  assert.equal(h.notices.find((n) => n.code === 'fuel.share-by-degree-days')?.level, 'hint')
  assert.match(textOf(h, 'fuel.share-by-degree-days'), /Den Teil für 2025\/2026 \(848,71 ‰ des Verbrauchs\) bestimmt Mietfuchs nach der Gradtagszahlentabelle/)
  assert.match(textOf(h, 'fuel.share-by-degree-days'), /Zählerstand des Versorgungszählers zum 30\.04\.2025/)
  assert.ok(codes(h).includes('fuel.fixed-unknown'))
  assert.equal(textOf(h, 'fuel.uncovered'), 'Heizanlage „Gas“, Heizperiode 2025/2026: Für 15.03.–30.04.2026 (47 Tage, 151,3 ‰ der Gradtage) fehlt eine Rechnung. Tragen Sie die Folgerechnung ein oder lesen Sie den Gaszähler zum 30.04.2026 ab.')
  assert.deepEqual(h.notices.find((n) => n.code === 'fuel.uncovered')?.subject, { kind: 'heatingCosts', id: 'hp' })
  const fuel = h.heating?.[0]?.fuel ?? assert.fail('keine Bewertung')
  assert.equal(fuel.coveragePermille.toFixed(2), '848.71')
  assert.deepEqual(fuel.carries, [{ deliveryId: 'd', period: '2024-05', cents: -98339 }])
  assert.deepEqual([fuel.deliveries[0]?.method, fuel.deliveries[0]?.inPeriodCents], ['degreeDays', 551661])
  assert.ok(h.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'))
})

test('Heizrechnung über die Heizperiode: verknüpft kein Hinweis, bei freien Schlüsseln ohne Verknüpfung fuel.manual-beyond-period', () => {
  const ueber = (over: Partial<SnapshotCostItem>) => ({ costItems: [position({ id: 'gas', serviceFrom: '2025-03-15', serviceTo: '2026-03-14', ...over })] })
  const verknuepft = settle('2025-05', ueber({}))
  assert.ok(!codes(verknuepft).includes('period.heating-mismatch') && !codes(verknuepft).includes('fuel.manual-beyond-period'))
  const lose = settle('2025-05', { ...ueber({ fuelDeliveryId: null }), fuelDeliveries: [] })
  assert.match(textOf(lose, 'fuel.manual-beyond-period'), /^„Gas“: Die Rechnung reicht über die Heizperiode 2025\/2026 hinaus/)
  assert.ok(!codes(lose).includes('period.heating-mismatch'))
})

test('Wer nichts einstellt, merkt nichts: ohne Lieferung dieselbe Abrechnung wie ohne Verknüpfung, keine Gradtage im Rechtsstand', () => {
  const ohne = settle('2025-05', { fuelDeliveries: [] })
  const ganzOhne = settle('2025-05', { fuelDeliveries: [], costItems: [position({ id: 'gas', fuelDeliveryId: null })] })
  assert.deepEqual(ohne, ganzOhne)
  assert.ok(!ohne.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'))
  assert.ok(!codes(ohne).some((c) => c.startsWith('fuel.')))
})

// ---------- Invarianten über Zufallsbestände (Entwurf 12.3 Nr. 1, 5) ----------

function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const DAY = 86400000
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

test('Invarianten: je Abrechnung Σ Zeilen = Σ Positionen; über alle Heizperioden ist jede Lieferung genau einmal verteilt, auch über einen Abschluss', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 60; lauf++) {
    const deliveries: FuelDelivery[] = []
    const items: (SnapshotCostItem & { propertyId: string })[] = []
    let start = isoOf(Date.UTC(2024, 1, 1) + int(0, 90) * DAY)
    const anzahl = int(2, 3)
    for (let k = 0; k < anzahl; k++) {
      const end = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 420) - 1) * DAY)
      deliveries.push(lieferung({ id: `d${k}`, label: `Rechnung ${k}`, invoiceFrom: start, invoiceTo: end, fixedCents: rnd() < 0.5 ? int(0, 20000) : null }))
      items.push(position({ id: `p${k}`, fuelDeliveryId: `d${k}`, period: periodContaining(MAI, end).key, amountCents: int(100000, 900000), key: rnd() < 0.5 ? 'area' : 'units' }))
      start = isoOf(Date.parse(`${end}T00:00:00Z`) + DAY)
    }
    const first = deliveries[0]?.invoiceFrom ?? assert.fail('keine Lieferung')
    const last = deliveries.at(-1)?.invoiceTo ?? assert.fail('keine Lieferung')
    const keys: string[] = []
    for (let p = periodContaining(MAI, first); p.from <= last; p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
    const fall = `Lauf ${lauf}: ${JSON.stringify(deliveries.map((d) => [d.invoiceFrom, d.invoiceTo, d.fixedCents]))}`
    // Die erste Heizperiode wird in der Hälfte der Läufe abgeschlossen: Was sie herein- und
    // hinausbucht, friert ein, wie beim Abschluss (Task 9).
    const base = { costItems: items, fuelDeliveries: deliveries }
    const erste = settle(keys[0] ?? assert.fail(fall), base)
    const zu = rnd() < 0.5
    const frozen: FrozenFuelCarry[] = []
    if (zu) {
      for (const d of deliveries) {
        const cents = (erste.heating?.[0]?.fuel?.carries ?? []).filter((c) => c.deliveryId === d.id).reduce((a, c) => a + c.cents, 0)
        if (cents !== 0) frozen.push(eingefroren(d.id, keys[0] ?? '', cents))
      }
    }
    const weiter = { ...base, fuelCarryFrozen: frozen, closedSettlements: zu ? [abgeschlossen(keys[0] ?? '', { fuelCarryRows: frozenFuelRowsOf(erste) })] : [] }
    const ergebnisse = [erste, ...keys.slice(1).map((key) => settle(key, weiter))]
    // Nr. 1: Σ aller Zeilen = Σ der Positionen dieses Zeitraums.
    ergebnisse.forEach((r, i) => {
      const positionen = items.filter((c) => c.period === keys[i]).reduce((a, c) => a + c.amountCents, 0)
      assert.equal(summe(r), positionen, `${fall}, ${keys[i]}`)
    })
    // Nr. 5: Je Lieferung heben sich die Überträge über alle Heizperioden auf.
    for (const d of deliveries) {
      const netto = ergebnisse.flatMap((r) => r.heating?.[0]?.fuel?.carries ?? []).filter((c) => c.deliveryId === d.id).reduce((a, c) => a + c.cents, 0)
      assert.equal(netto, 0, `${fall}, ${d.id}`)
    }
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-fuel.test.ts`
Expected: FAIL. Es gibt keine Zeilen `fuel:…`, `heating[0].fuel` fehlt, die Codes `fuel.*` fehlen.

- [ ] **Step 3: Codes und Importe (`server/src/calc.ts`)**

Importe ergänzen: `import { plantFuel, rangeOf, type FuelCarry, type FuelResult } from './fuel.ts'`;
aus `'./snapshot.ts'` den Typ `SnapshotHeatingPlant` (`wayOf` ist seit PR 5 da); aus
`'../../shared/types.ts'` den Typ `FuelMethod`.

In `noticeKinds` hinter den Codes von PR 6:

```ts
  // Heizung PR 7 (#97): Lieferungen (Entwurf 3.2, 3.3, 8.2, 10.1).
  'fuel.share-by-degree-days': { level: 'hint', title: 'Rechnung nach Gradtagen aufgeteilt', rule: 'heating-consumed-fuel', terms: ['degreeDays', 'accrualPrinciple'] },
  'fuel.fixed-unknown': { level: 'hint', title: 'Fester Preisbestandteil fehlt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.uncovered': { level: 'warning', title: 'Rechnung für einen Teil der Heizperiode fehlt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.manual-beyond-period': { level: 'warning', title: 'Heizrechnung reicht über die Heizperiode', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'heatingSystem'] },
  'fuel.closed-period-part': { level: 'hint', title: 'Teil einer abgeschlossenen Heizperiode beim Vermieter', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.estimated': { level: 'hint', title: 'Brennstoffkosten geschätzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'degreeDays'] },
  'fuel.estimate-settled': { level: 'warning', title: 'Schätzung durch die Rechnung ersetzt', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
  'fuel.estimate-overcharged': { level: 'warning', title: 'Schätzung war zu hoch', rule: 'heating-consumed-fuel', terms: ['accrualPrinciple', 'settlementDeadline'] },
```

- [ ] **Step 4: Heizrechnung über die Heizperiode (Block „Zeitraum (#208)“ aus PR 3)**

Im Block `// ---------- Zeitraum (#208, Entwurf 3.4, 3.6) ----------` die Zeile
`if (item.category === HEATING_CATEGORY) {` und den Kommentar darunter bis vor `warn('period.heating-mismatch',`
ersetzen durch:

```ts
    if (item.category === HEATING_CATEGORY) {
      // Heizkosten werden nie nach Tagen geteilt (G-C1). Heizung PR 7 (Entwurf 3.2, 3.4): Eine mit
      // einer Lieferung verknüpfte Position grenzt Mietfuchs über die Lieferung ab, dazu gibt es nichts
      // zu sagen. Bei einer Anlage mit freien Schlüsseln ohne Verknüpfung der Rat, die Rechnung als
      // Lieferung einzutragen; ohne Anlage wie bisher.
      if (item.fuelDeliveryId) continue
      if (plants.find((p) => p.id === item.heatingPlantId)?.method === 'manual') {
        warn('fuel.manual-beyond-period',
          `„${item.description}“: Die Rechnung reicht über die Heizperiode ${label} hinaus (Leistungszeitraum ${range}) und wird ganz verteilt. Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11). ` +
            'Tragen Sie die Rechnung auf der Seite Heizkosten als Lieferung ein und verknüpfen Sie die Position mit ihr; dann grenzt Mietfuchs sie ab.',
          itemSubject(item))
        continue
      }
```

(Der `warn('period.heating-mismatch', …)` darunter bleibt unverändert; `range` und `label` stehen im
Block, `plants` seit PR 5 im Kopf.)

- [ ] **Step 5: Überträge vor der Verteilung**

Direkt vor der Zeile `const co2Pots = co2PotsOf(snapshot, items)` (PR 6):

```ts
  // ---------- Brennstofflieferungen (Heizung PR 7, #97; Entwurf 3.2, 3.3, 5.4, 8.2) ----------
  // Je Anlage, deren Heizperiode der Zeitraum dieser Berechnung ist (in P die Anlagen ohne eigene
  // Heizperiode, in einer Teil- oder Heizkostenabrechnung die eine Anlage): welcher Teil jeder
  // Versorgerrechnung hierher gehört und was deshalb herein- oder hinausgebucht wird. Bei freien
  // Schlüsseln bleiben die Rechnungen Positionen in voller Höhe in der Heizperiode, in der sie enden;
  // der Teil einer anderen Heizperiode steht als Zeile „Anteil … aus der Rechnung …“ (+) bzw. „Anteil
  // für …“ (−) bei den Mietern, mit dem Schlüssel der Position verteilt, und als Gegenzeile beim
  // Vermieter (`fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`). Über die Zeiträume hinweg ist so
  // jede Rechnung genau einmal verteilt (12.3 Nr. 1, 5). Beim Messdienst gibt es keine Überträge: Für
  // Kosten und C gilt, was er berechnet hat (G-A3); bewertet wird nur der Ausstoß. Die
  // Gradtagstabelle wird nur gefragt, wenn eine Anlage Lieferungen hat, sonst stünde sie im
  // Rechtsstand jeder Abrechnung.
  const fuelPlants: SnapshotHeatingPlant[] = scope === 'all'
    ? plants.filter((p) => (p.periodStartMonth ?? null) === null)
    : snapshot.scope ? [snapshot.scope.plant] : []
  const fuelResults = new Map<string, { plant: SnapshotHeatingPlant; result: FuelResult }>()
  const fuelSynthetic: SnapshotCostItem[] = []
  const fuelCarryOf = new Map<string, { carry: FuelCarry; step: CalcStep }>()
  const fuelCounterRows: SettlementRow[] = []
  const FUEL_METHOD_TEXT: Record<FuelMethod, string> = {
    entered: 'eingetragener Anteil', measured: 'nach Zählerstand', inside: 'ganz in der Heizperiode', parts: 'nach Teilmengen laut Rechnung',
    localDegreeDays: 'nach den Gradtagzahlen des Orts', degreeDays: 'nach der Gradtagszahlentabelle',
  }
  const fuel = snapshot.fuel
  if (fuel) {
    for (const plant of fuelPlants) {
      if (plant.method === 'self') continue
      const deliveries = fuel.deliveries.filter((d) => d.plantId === plant.id)
      if (deliveries.length === 0) continue
      const deliveryIds = new Set(deliveries.map((d) => d.id))
      const supply = snapshot.meters.filter((m) => m.heatingPlantId === plant.id && m.heatingRole === 'supply')
      const supplyMeter = supply.length === 1 ? supply[0] : undefined
      const result = plantFuel({
        method: plant.method,
        h: period,
        rules: plantRules(wayOf(plant), objectRules),
        deliveries,
        items: fuel.items.filter((c) => c.fuelDeliveryId != null && deliveryIds.has(c.fuelDeliveryId)),
        frozen: fuel.frozen.filter((f) => f.plantId === plant.id),
        closed: new Set(fuel.closed.filter((c) => c.plantId === plant.id).map((c) => c.period)),
        ctx: {
          table: law(hkvDegreeDays, { period: lawPeriod }, lawLog),
          local: new Map(fuel.degreeDays.map((v) => [v.month, v.value])),
          readings: supplyMeter ? snapshot.readings.filter((r) => r.meterId === supplyMeter.id) : null,
        },
      })
      if (!result) continue
      fuelResults.set(plant.id, { plant, result })
      for (const carry of result.carries) {
        const d = deliveries.find((x) => x.id === carry.deliveryId)
        const r = d ? rangeOf(d) : null
        const range = r ? formatDayRange(r.from, r.to) : ''
        const carryKey = `fuel:${carry.deliveryId}:${period.key}`
        // Der erste Schritt des Rechenwegs je Übertragszeile: woher der Betrag kommt.
        const step: CalcStep = carry.frozen
          ? { label: 'Anteil der Rechnung', value: `${fmtCents(Math.abs(carry.cents))}, eingefroren mit der Abrechnung ${periodLabel(carry.other)}`, term: 'accrualPrinciple' }
          : carry.kind === 'estimate'
            ? { label: 'Geschätzte Brennstoffkosten', value: `${fmtCents(carry.cents)} für ${range}, Nachberechnung vorbehalten`, term: 'accrualPrinciple' }
            : {
                label: 'Anteil der Rechnung',
                value: `${fmtCents(carry.totalCents)} × ${fmtNum(Math.round(carry.ratio * 100000) / 100)} ‰ (${FUEL_METHOD_TEXT[carry.method]}) = ${fmtCents(Math.abs(carry.cents))}`,
                term: carry.method === 'degreeDays' || carry.method === 'localDegreeDays' ? 'degreeDays' : 'accrualPrinciple',
              }
        // Eine Zeile je Position der Rechnung, mit ihrem Schlüssel; der Betrag einer Lieferung mit
        // Abschlag und Gutschrift verteilt sich im Verhältnis ihrer Beträge.
        const shares = distributeCents(carry.cents, carry.templates.map((t) => ({ key: t.itemId, landlord: false, raw: t.raw })))
        carry.templates.forEach((t, k) => {
          const template = fuel.items.find((c) => c.id === t.itemId)
          const cents = shares[k] ?? 0
          if (!template || cents === 0) return
          const { labor35aCents: _labor, serviceFrom: _from, serviceTo: _to, ...rest } = template
          const id = `${carryKey}:${t.itemId}`
          fuelSynthetic.push({
            ...rest,
            id,
            period: period.key,
            amountCents: cents,
            description: carry.kind === 'estimate'
              ? `Brennstoff ${range} (geschätzt)`
              : carry.kind === 'out'
                ? `${template.description}: Anteil für ${periodLabel(carry.other)} (voriger Zeitraum)`
                : `${template.description}: Anteil ${label} aus der Rechnung ${range} (Rechnung des nächsten Zeitraums)`,
          })
          fuelCarryOf.set(id, { carry, step })
        })
        fuelCounterRows.push({
          costItemId: carryKey,
          category: HEATING_CATEGORY,
          description: carry.kind === 'out' ? `Gegenbuchung: Anteil der Rechnung ${range} für ${periodLabel(carry.other)}` : `Gegenbuchung: Brennstoff ${range} aus einem anderen Zeitraum`,
          totalCents: -carry.cents,
          keyLabel: 'Abgrenzung der Brennstoffkosten',
          shareCents: -carry.cents,
          landlordParts: carry.landlord.filter((p) => p.cents !== 0),
        })
      }
    }
  }
```

Dann die Zeile von PR 6 ersetzen durch:

```ts
  const co2Pots = co2PotsOf(snapshot, [...items, ...fuelSynthetic])
```

- [ ] **Step 6: Die Schleife über die Positionen**

- `for (const item of items) {` (die Verteilung, nicht der Block „Zeitraum“) ersetzen durch
  `for (const item of [...items, ...fuelSynthetic]) {`.
- Direkt hinter `const b = basisOf(item)`:

```ts
    // Eine Übertragszeile (Heizung PR 7) ist keine Position: Sie zählt nicht zu den Kosten des
    // Zeitraums, hat keinen Schlüsselwechsel und keine Überschneidung, und die Regeln aus #140
    // betreffen die Position, deren Teil sie ist.
    const carry = fuelCarryOf.get(item.id)
```

- `totalCostsCents += item.amountCents` → `if (!carry) totalCostsCents += item.amountCents`
- `const keyChange = keyChangeText(…)` → `const keyChange = carry ? null : keyChangeText(item, snapshot.previousCostItems ?? [], at, basisUnitIds)`
- `for (const o of overlaps) {` (in der Schleife) → `for (const o of carry ? [] : overlaps) {`
- Direkt hinter der Zuweisung `const steps: CalcStep[] = [ … ]`:

```ts
      if (carry) steps.unshift(carry.step)
```

- In `st.rows.push({` hinter `costItemId: item.id,`:

```ts
        ...(carry ? { kind: 'fuelCarry' as const } : {}),
```

- `const heatingReceived = item.category === HEATING_CATEGORY` → `const heatingReceived = item.category === HEATING_CATEGORY && !carry`
- `if (item.category === HEATING_CATEGORY && item.key !== 'direct') {` → `if (item.category === HEATING_CATEGORY && item.key !== 'direct' && !carry) {`

Direkt hinter der Schleife (vor `notices.splice(tvAt, 0, ...tvNotices())`):

```ts
  // Die Gegenzeilen der Überträge beim Vermieter (Heizung PR 7).
  landlordRows.push(...fuelCounterRows)
```

- [ ] **Step 7: Hinweise und Bewertung**

Direkt hinter `notices.splice(tvAt, 0, ...tvNotices())` und vor dem CO₂-Block von PR 6:

```ts
  // ---------- Hinweise zu den Lieferungen (Heizung PR 7, Entwurf 3.2, 3.3, 8.2, 10.1) ----------
  for (const { plant, result } of fuelResults.values()) {
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const closedOf = (key: string) => fuel?.closed.find((c) => c.plantId === plant.id && c.period === key)
    const nameOf = (id: string): string => {
      const l = result.lines.find((x) => x.deliveryId === id)
      const d = fuel?.deliveries.find((x) => x.id === id)
      return d?.label || (l?.from && l.to ? formatDayRange(l.from, l.to) : 'Lieferung')
    }
    for (const line of result.lines) {
      if (!line.split) continue
      const name = `„${nameOf(line.deliveryId)}“${line.from && line.to ? ` (${formatDayRange(line.from, line.to)})` : ''}`
      if (line.method === 'degreeDays' || line.method === 'localDegreeDays') {
        const stichtag = line.to !== null && line.to > yTo ? yTo : dayBefore(yFrom)
        warn('fuel.share-by-degree-days',
          `${where}: ${name} reicht über die Heizperiode hinaus. Den Teil für ${label} (${fmtNum(Math.round(line.sharePermille * 100) / 100)} ‰ des Verbrauchs) bestimmt Mietfuchs nach ${line.method === 'localDegreeDays' ? 'den Gradtagzahlen Ihres Orts' : 'der Gradtagszahlentabelle'}. ` +
            'Eine sachgerechte Schätzung ist zulässig (BGH VIII ZR 156/11); so grenzen auch die Versorger bei einer Preisänderung ab (§ 12 Abs. 2 GasGVV). ' +
            `Genauer sind ein Zählerstand des Versorgungszählers zum ${fmtDay(stichtag)} oder eine Zwischenrechnung des Versorgers; die Versorger selbst grenzen mit den Gradtagzahlen des Deutschen Wetterdienstes für den Ort ab.`,
          subject)
      }
      if (!line.fixedKnown) {
        warn('fuel.fixed-unknown',
          `${where}: Für ${name} ist kein fester Preisbestandteil eingetragen. Grund-, Leistungs-, Mess- und Verrechnungspreise hängen an der Zeit und werden nach Tagen geteilt; ohne Angabe teilt Mietfuchs die ganze Rechnung nach dem Verbrauch. ` +
            'Weist die Rechnung feste Bestandteile aus, tragen Sie ihre Summe bei der Lieferung ein.',
          subject)
      }
    }
    for (const g of result.gaps) {
      const zaehler = plant.energy === 'gas' ? 'den Gaszähler' : plant.energy === 'districtHeating' ? 'den Wärmezähler der Übergabestation' : 'den Stromzähler der Wärmepumpe'
      warn('fuel.uncovered',
        `${where}: Für ${formatDayRange(g.from, g.to)} (${g.days} ${g.days === 1 ? 'Tag' : 'Tage'}, ${fmtNum(Math.round(g.permille * 10) / 10)} ‰ der Gradtage) fehlt eine Rechnung. Tragen Sie die Folgerechnung ein oder lesen Sie ${zaehler} zum ${fmtDay(g.to)} ab.`,
        subject)
    }
    for (const line of result.lines.filter((l) => l.estimated)) {
      warn('fuel.estimated',
        `${where}: Die Brennstoffkosten vom ${fmtDay(line.from ?? yFrom)} bis ${fmtDay(line.to ?? yTo)} sind geschätzt (${fmtCents(line.inPeriodCents ?? line.amountCents ?? 0)}), weil die Rechnung des Versorgers noch nicht vorliegt. Eine Nachberechnung bleibt vorbehalten.`,
        subject)
    }
    for (const carry of result.carries) {
      if (carry.kind !== 'out') continue
      const other = closedOf(carry.other.key)
      if (!other) continue
      const X = -carry.cents
      const name = `„${nameOf(carry.deliveryId)}“`
      if (carry.landlord.some((p) => p.reason === 'fuelClosedPeriod')) {
        warn('fuel.closed-period-part',
          `${where}: Der Teil der Rechnung ${name} für ${periodLabel(carry.other)} (${fmtCents(X)}) gehört in die Abrechnung ${other.label}, die ohne Schätzung abgeschlossen wurde. Sie tragen ihn selbst. ` +
            `Solange die Frist dieser Abrechnung läuft (Zugang bis ${fmtDay(other.deadline)}), können Sie sie wieder öffnen und berichtigen.`,
          subject)
        continue
      }
      const diff = carry.landlord.find((p) => p.reason === 'fuelEstimateDiff')?.cents ?? 0
      if (!carry.estimate || diff === 0) continue
      const E = carry.estimate.cents
      if (diff > 0) {
        // § 556 Abs. 3 Satz 2 und 3 BGB: Vor Fristablauf ist eine Berichtigung möglich (Umkehrschluss
        // aus BGH VIII ZR 115/04); danach nur ohne Vertretenmüssen (BGH VIII ZR 264/12) und alsbald
        // (BGH VIII ZR 220/05). Ohne Stichtag (`asOf`) gilt die Frist als offen.
        const past = options.asOf !== undefined && options.asOf > other.deadline
        warn('fuel.estimate-settled',
          `${where}: Die Rechnung ${name} ist da. Für ${periodLabel(carry.other)} war ${fmtCents(E)} geschätzt; tatsächlich entfallen ${fmtCents(X)}. Die Differenz von ${fmtCents(diff)} steht bei Ihnen. ` +
            (past
              ? `Die Frist der Abrechnung ${other.label} ist am ${fmtDay(other.deadline)} abgelaufen. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB, BGH VIII ZR 264/12), und dann alsbald, in der Regel binnen drei Monaten nach Wegfall des Hindernisses (BGH VIII ZR 220/05). Wer freiwillig vor dem Ende der Frist abgeschlossen hat, war nicht daran gehindert.`
              : `Nachfordern können Sie mit einer berichtigten Abrechnung ${other.label}; sie muss den Mietern bis ${fmtDay(other.deadline)} zugehen (§ 556 Abs. 3 Satz 2 und 3 BGB). Öffnen Sie die Abrechnung dafür wieder.`),
          subject)
      } else {
        // Zu hoch geschätzt (A4, B9): Ein Rückzahlungsanspruch folgt daraus nicht sicher (Einwendungsfrist,
        // § 556 Abs. 3 Satz 5 und 6 BGB); eine Gutschrift ist jederzeit zulässig. Je Mieter im Verhältnis
        // seiner Übertragszeilen der Schätzung im eingefrorenen Stand.
        const factor = E !== 0 ? -diff / E : 0
        const byTenant = new Map<string, { name: string; cents: number }>()
        for (const row of other.fuelRows) {
          if (!carry.estimate.ids.some((id) => row.costItemId.startsWith(`fuel:${id}:`))) continue
          const entry = byTenant.get(row.tenancyId) ?? { name: `${row.tenantName} (${row.unitName})`, cents: 0 }
          entry.cents += row.shareCents
          byTenant.set(row.tenancyId, entry)
        }
        const list = [...byTenant.values()].map((e) => `${e.name} ${fmtCents(Math.round(e.cents * factor))}`)
        warn('fuel.estimate-overcharged',
          `${where}: Für ${periodLabel(carry.other)} war ${fmtCents(E)} geschätzt; tatsächlich entfallen nur ${fmtCents(X)}. Die Mieter dieser Heizperiode haben ${fmtCents(-diff)} zu viel getragen${list.length > 0 ? `, hier: ${andList(list)}` : ''}. ` +
            `Eine Gutschrift ist jederzeit zulässig und wird empfohlen. Öffnen Sie die Abrechnung ${other.label} wieder oder erfassen Sie die Gutschrift; bis dahin steht der Betrag bei Ihnen als Abweichung von der Schätzung.`,
          subject)
      }
    }
  }
```

Im CO₂-Block von PR 6, direkt hinter `heatingStatements.push(report)`:

```ts
    // Lieferungen, Abgrenzung, Überträge und Lücken dieser Heizperiode (Heizung PR 7).
    const fuelOf = fuelResults.get(pot.plantId)?.result
    if (fuelOf) {
      report.fuel = {
        coveragePermille: fuelOf.coveragePermille, emissionsKg: fuelOf.emissionsKg, co2Cents: fuelOf.co2Cents, deliveries: fuelOf.lines,
        carries: fuelOf.carries.map((c) => ({ deliveryId: c.deliveryId, period: c.other.key, cents: c.cents })), gaps: fuelOf.gaps,
      }
    }
```

`dayBefore`, `formatDayRange`, `fmtDay`, `fmtNum`, `fmtCents`, `andList`, `periodLabel`, `NoticeSubject`,
`options` stehen in calc.ts bereit (PR 1–6).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-fuel.test.ts test/calc-zeitraum-hinweise.test.ts test/calc-co2.test.ts test/calc-heizperiode.test.ts test/calc.test.ts test/settlement-golden.test.ts && npm run typecheck`
Expected: PASS (calc-fuel.test.ts: 13 Tests). Golden unverändert.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calc.ts server/test/calc-fuel.test.ts
git commit -m "Lieferungen in der Abrechnung: Überträge zwischen Heizperioden, Gegenzeilen, Hinweise

Der Teil einer Rechnung für eine frühere Heizperiode wird hinaus- und dort hereingebucht, mit
dem Schlüssel der Brennstoffposition; eingefrorene Werte, Schätzungen und abgeschlossene
Heizperioden ergeben fuelCarry, fuelEstimateDiff oder fuelClosedPeriod beim Vermieter.

Refs #97"
```

---
### Task 8: Eigene CO₂-Aufteilung: Einstufung, § 8, § 9, Emissionshandel, Abzug nach Brennstoffanteil

Mit Lieferungen teilt Mietfuchs die CO₂-Kosten selbst auf (Entwurf 7.6, 9): bei freien Schlüsseln aus
den abgegrenzten Lieferungen (C_H = Σ C_d · Anteil_d, Methode `self`), beim Messdienst ohne Aufteilung
aus den Rechnungen, die er angesetzt hat, ganz (G-A3, `selfAfterService`). E ist in beiden Fällen auf
die Heizperiode umgerechnet (3.3). Der Abzug je Mieter folgt dem Schlüssel des Brennstoffs (9.4, G-B5):
r_t = L · x_t / F. Die Buchung der Abzugszeilen aus PR 6 wird dafür zu einem Helfer `bookReliefs`.

**Files:**
- Modify: `shared/types.ts`, `server/src/co2.ts`, `server/src/calc.ts`
- Test: `server/test/co2.test.ts`, `server/test/calc-fuel.test.ts`, `server/test/calc-co2.test.ts`

**Interfaces:**
- Consumes (Task 1, 3, 7; PR 5, 6): `co2NonResidential`, `co2Restriction`, `co2DistrictEtsNew`; `FuelResult` (`co2Cents`, `serviceCo2Cents`, `serviceGrossCents`, `emissionsKg`, `coveragePermille`, `missingCo2`, `lines`); in `computeSettlement` `fuelResults` und im CO₂-Block (PR 6) `pot`, `st`, `hPeriod`, `where`, `ids`, `plantSubject`, `report`, `printed`, `cutsOn`, `sharesOf`, `co2Duty`, `nextStep`, `fuelOf` (Task 7); `servesUnit` (PR 5), `isDwelling`, `KEY_LABELS`, `reliefsByShare`, `stageRanges`, `stageOf`, `roundSpecific`, `tableFactor`.
- Produces:
  - `shared/types.ts`: `Co2Adjustment = 'nonResidential' | 'restrictionHalf' | 'restrictionNone'`; `Co2Assessment.adjustments?: Co2Adjustment[]`, `.areaSource?: 'entered' | 'served'`
  - co2.ts: `SERVICE_FUEL_TOLERANCE_CENTS = 100`, `type SelfSplitInput`, `type SelfSplit = { value: number | null; stage: Co2StageRange | null; permille: number | null; landlordRaw: number | null; adjustments: Co2Adjustment[] }`, `selfSplit(input): SelfSplit`
  - calc.ts: Codes `co2.service-unsplit-healed`, `co2.service-fuel-mismatch`, `co2.share-approximated`, `co2.pool-keys`, `co2.restriction`, `co2.non-residential`, `co2.short-period-agreed` (hint), `co2.exceeds-heating` (error); `report.co2` mit `method: 'self' | 'selfAfterService'`, `basis: 'deliveries'`

- [ ] **Step 1: Write the failing tests**

(a) `server/test/co2.test.ts`: Importe ergänzen, soweit sie fehlen: `selfSplit` aus `'../src/co2.ts'`,
`co2StageTable` aus `'../../shared/law/co2kostaufg.ts'`, `createLawLog, law` aus
`'../../shared/law/register.ts'`. Anhängen:

```ts
// ---------- Eigene Aufteilung (Heizung PR 7, Entwurf 9.2) ----------

const TABELLE = law(co2StageTable, { period: { from: '2025-05-01', to: '2026-04-30' } }, createLawLog())
const eigen = (over: Partial<Parameters<typeof selfSplit>[0]> = {}) => selfSplit({
  emissionsKg: 24105.6, co2Cents: 77379, areaM2: 600, ranges: stageRanges(TABELLE, 1), decimals: 1,
  nonResidentialPermille: null, restriction: null, ...over,
})

test('selfSplit: Beispiel B1 (24.105,6 kg auf 600 m² = 40,2 → 60 %, L = 464,27 €)', () => {
  const s = eigen()
  assert.deepEqual([s.value, s.stage?.landlordPercent, s.permille, s.adjustments], [40.2, 60, 600, []])
  near(s.landlordRaw ?? 0, 46427.4, 'L exakt, gerundet wird erst bei der Verteilung')
})

test('selfSplit: § 8 setzt 500 ‰, § 9 halbiert, beide Vorgaben heben die Aufteilung auf', () => {
  assert.deepEqual([eigen({ nonResidentialPermille: 500 }).permille, eigen({ nonResidentialPermille: 500 }).adjustments], [500, ['nonResidential']])
  const halb = eigen({ restriction: { factor: 0.5, bothSplit: false, both: false } })
  assert.deepEqual([halb.permille, halb.adjustments], [300, ['restrictionHalf']])
  const keine = eigen({ restriction: { factor: 0.5, bothSplit: false, both: true } })
  assert.deepEqual([keine.permille, keine.landlordRaw, keine.adjustments], [0, 0, ['restrictionNone']])
  // § 9 Abs. 1 kürzt auch den Anteil nach § 8.
  assert.equal(eigen({ nonResidentialPermille: 500, restriction: { factor: 0.5, bothSplit: false, both: false } }).permille, 250)
  // Ohne Einstufung (Fläche fehlt) kein Anteil; im Nichtwohngebäude braucht es keine.
  assert.equal(eigen({ areaM2: null }).permille, null)
  assert.equal(eigen({ areaM2: null, nonResidentialPermille: 500 }).permille, 500)
})

test('selfSplit: Rumpf 01.01.–30.04.2025 kürzt die Tabelle; 5,0 kg je m² → 10 % (Entwurf 12.2)', () => {
  const faktor = tableFactor({ from: '2025-01-01', to: '2025-04-30', short: true })
  const s = eigen({ emissionsKg: 3000, areaM2: 600, ranges: stageRanges(TABELLE, faktor) })
  assert.deepEqual([s.value, s.stage?.landlordPercent], [5, 10])
  assert.equal(eigen({ emissionsKg: 3000, areaM2: 600 }).stage?.landlordPercent, 0, 'ungekürzt läge 5,0 unter 12')
})
```

(`near`, `stageRanges` und `tableFactor` sind in co2.test.ts seit PR 6 importiert bzw. definiert; fehlt
`near`, die Hilfsfunktion aus `fuel.test.ts` übernehmen.)

(b) An `server/test/calc-fuel.test.ts` anhängen (Typimport aus `'../../shared/types.ts'` um
`Co2Statement` ergänzen):

```ts
// ---------- Eigene CO₂-Aufteilung (Entwurf 7.6, 9; G-A3, G-B5) ----------

// Drei Wohnungen mit 600 m², Gas 9.000 € nach Fläche (50/30/20 %), Messkosten 1.000 € nach Einheiten;
// die Gasrechnung liegt ganz in der Heizperiode: 24.105,6 kg, CO₂-Kosten 773,79 € (Beispiel B1).
const drei = (over: Partial<Quelle> = {}): Partial<Quelle> => ({
  units: [
    { id: 'a', name: 'A', areaM2: 300, participates: true, propertyId: 'objekt-1' },
    { id: 'b', name: 'B', areaM2: 180, participates: true, propertyId: 'objekt-1' },
    { id: 'c', name: 'C', areaM2: 120, participates: true, propertyId: 'objekt-1' },
  ],
  tenancies: [mieter('ta', 'a'), mieter('tb', 'b'), mieter('tc', 'c')],
  costItems: [position({ id: 'gas', amountCents: 900000 }), position({ id: 'mess', description: 'Messkosten', amountCents: 100000, key: 'units', fuelDeliveryId: null })],
  fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', emissionsKg: 24105.6, co2CostCents: 77379 })],
  ...over,
})
const abzugVon = (r: ComputedSettlement, tenancyId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.filter((row) => row.kind === 'co2Relief').reduce((a, row) => a + row.shareCents, 0) ?? 0
const aufteilung = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-05'), method: 'selfAfterService', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})

test('G-B5: Der Abzug folgt dem Schlüssel des Brennstoffs; A trägt 232,14 €, nicht 224,40 € wie nach dem ganzen Topf', () => {
  const r = settle('2025-05', drei())
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb'), abzugVon(r, 'tc')], [-23214, -13928, -9285])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 46427 }])
  assert.equal(summe(r), 1000000)
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.deepEqual([co2.method, co2.basis, co2.kgPerM2, co2.landlordPermille, co2.landlordCents, co2.totalCents, co2.areaM2, co2.areaSource, co2.coveragePermille], ['self', 'deliveries', 40.2, 600, 46427, 77379, 600, 'served', 1000])
  const zeile = r.statements[0]?.rows.find((row) => row.kind === 'co2Relief') ?? assert.fail('keine Abzugszeile')
  assert.equal(zeile.basisText, 'nach Ihrem Anteil an den Brennstoffkosten')
  assert.deepEqual(zeile.steps?.[1], { label: 'Ihr Teil davon', value: '464,274 € × 4.500,00 € ÷ 9.000,00 € = 232,137 €' })
  assert.ok(!codes(r).some((c) => c === 'co2.missing' || c === 'co2.share-approximated'))
})

test('§ 8 und § 9: 500 ‰ im Nichtwohngebäude, halber Anteil bei einer Vorgabe, keine Aufteilung bei beiden', () => {
  const nichtWohnen = settle('2025-05', drei({ heatingPlants: [anlage({ nonResidential: true })] }))
  assert.equal(abzugVon(nichtWohnen, 'ta'), -19345)
  assert.match(textOf(nichtWohnen, 'co2.non-residential'), /mindestens 50 % der CO₂-Kosten \(§ 8 Abs\. 1 CO2KostAufG\)/)
  assert.ok(nichtWohnen.legalBasis.values?.some((v) => v.id === 'co2.non-residential'))
  const gebaeude = settle('2025-05', drei({ heatingPlants: [anlage({ restriction: 'building' })] }))
  assert.equal(abzugVon(gebaeude, 'ta'), -11607)
  assert.match(textOf(gebaeude, 'co2.restriction'), /des Gebäudes entgegen\. Ihr Anteil an den CO₂-Kosten wird deshalb um 50 % gekürzt \(§ 9 Abs\. 1 CO2KostAufG\)\. Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen \(§ 9 Abs\. 3 CO2KostAufG\)/)
  const beides = settle('2025-05', drei({ heatingPlants: [anlage({ restriction: 'both' })] }))
  assert.equal(abzugVon(beides, 'ta'), 0)
  assert.match(textOf(beides, 'co2.restriction'), /werden die CO₂-Kosten nicht aufgeteilt \(§ 9 Abs\. 2 CO2KostAufG\)/)
  assert.equal(beides.heating?.[0]?.co2?.landlordCents, 0)
})

test('Review Focus 5: Heizpauschale bei B; nur wer Brennstoffzeilen hat, bekommt einen Abzug', () => {
  const r = settle('2025-05', drei({ tenancies: [mieter('ta', 'a'), { ...mieter('tb', 'b'), heatingModel: 'flatRate' as const }, mieter('tc', 'c')] }))
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb'), abzugVon(r, 'tc')], [-23214, 0, -9285])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 32499 }])
  assert.equal(summe(r), 1000000)
})

test('Ohne Verknüpfung: nach dem ganzen Topf und co2.share-approximated; ohne CO₂-Angaben co2.incomplete', () => {
  const lose = settle('2025-05', drei({ costItems: [position({ id: 'gas', amountCents: 900000, fuelDeliveryId: null }), position({ id: 'mess', description: 'Messkosten', amountCents: 100000, key: 'units', fuelDeliveryId: null })] }))
  assert.ok(Math.abs(abzugVon(lose, 'ta') + 22440) <= 1, `A: ${abzugVon(lose, 'ta')}`)
  assert.match(textOf(lose, 'co2.share-approximated'), /Keine Position der Heizanlage ist als Brennstoff gekennzeichnet/)
  const ohne = settle('2025-05', drei({ fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30' })] }))
  assert.match(textOf(ohne, 'co2.incomplete'), /die CO₂-Angaben der Rechnung „Gas 2025\/2026“/)
  assert.equal(abzugVon(ohne, 'ta'), 0)
  const zuViel = settle('2025-05', drei({ fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', emissionsKg: 24105.6, co2CostCents: 950000 })] }))
  assert.equal(zuViel.notices.find((n) => n.code === 'co2.exceeds-heating')?.level, 'error')
  assert.equal(abzugVon(zuViel, 'ta'), 0)
})

test('Ohne Lieferung bei freien Schlüsseln: co2.missing führt zu den Lieferungen; Emissionshandel ab 2023 ohne Hinweis', () => {
  assert.match(textOf(settle('2025-05', drei({ fuelDeliveries: [] })), 'co2.missing'), /als Lieferungen ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf/)
  const ets = settle('2025-05', drei({ fuelDeliveries: [], heatingPlants: [anlage({ energy: 'districtHeating', districtEtsNew: true })] }))
  assert.ok(!codes(ets).some((c) => c.startsWith('co2.')))
  assert.ok(ets.legalBasis.values?.some((v) => v.id === 'co2.district-ets-new'))
})

test('G-A3 (F13): Messdienst ohne Aufteilung, Gasrechnung als Lieferung; Entlastung 240,00 €, nicht 203,69 €', () => {
  const messdienst = { ...anlage({ method: 'service' }) }
  const ueber = (st: Partial<Co2Statement> = {}): Partial<Quelle> => ({
    heatingPlants: [messdienst],
    costItems: [position({ id: 'hz', description: 'Heizung und Warmwasser laut Messdienst', amountCents: 400000, key: 'amounts', tenancyAmounts: { ta: 240000, tb: 160000 }, fuelDeliveryId: null })],
    fuelDeliveries: [lieferung({ amountCents: 311747, emissionsKg: 2950, co2CostCents: 60000 })],
    co2Statements: [aufteilung({ serviceFuelGrossCents: 311747, ...st })],
  })
  const r = settle('2025-05', ueber())
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb')], [-14400, -9600])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 24000 }])
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.deepEqual([co2.method, co2.totalCents, co2.kgPerM2, co2.landlordPermille], ['selfAfterService', 60000, 29.5, 400])
  assert.ok(Math.abs((co2.emissionsKg ?? 0) - 2950) < 1e-6, 'E umgerechnet = E der Rechnung')
  assert.ok(!codes(r).includes('co2.service-unsplit'))
  assert.match(textOf(r, 'co2.service-unsplit-healed'), /bis zu 3 %/)
  assert.match(textOf(r, 'co2.share-approximated'), /weist den Brennstoffanteil je Nutzer nicht aus/)
  assert.ok(!codes(r).includes('co2.service-fuel-mismatch'))
  assert.match(textOf(settle('2025-05', ueber({ serviceFuelGrossCents: 320000 })), 'co2.service-fuel-mismatch'), /Brennstoffkosten von 3\.200,00 € angesetzt, die Rechnungen, die Sie als angesetzt gekennzeichnet haben, ergeben 3\.117,47 €/)
  // Ohne angesetzte Rechnung bleibt es bei der Warnung aus PR 6.
  const nicht = settle('2025-05', { ...ueber(), fuelDeliveries: [lieferung({ amountCents: 311747, emissionsKg: 2950, co2CostCents: 60000, usedByService: false })] })
  assert.ok(codes(nicht).includes('co2.service-unsplit'))
})
```

(c) In `server/test/calc-co2.test.ts` (PR 6) die Zusicherung zum Text bei freien Schlüsseln ersetzen:

```ts
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ method: 'manual' })]), 'co2.missing'), /mit einer späteren Version/)
```

durch

```ts
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ method: 'manual' })]), 'co2.missing'), /als Lieferungen ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf/)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/co2.test.ts test/calc-fuel.test.ts test/calc-co2.test.ts`
Expected: FAIL: `does not provide an export named 'selfSplit'`; danach fehlen die Abzugszeilen und
die Codes.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Über `Co2Assessment` einfügen:

```ts
// Was die Einstufung bei der eigenen Aufteilung verändert hat (Heizung PR 7): § 8 (Nichtwohngebäude,
// 500 ‰ statt der Stufe), § 9 Abs. 1 (halber Anteil) und § 9 Abs. 2 (keine Aufteilung).
export type Co2Adjustment = 'nonResidential' | 'restrictionHalf' | 'restrictionNone'
```

In `Co2Assessment` hinter `coveragePermille?: number | null` (Task 2):

```ts
  // Bei der eigenen Aufteilung: § 8 und § 9, und woher die Fläche der Einstufung stammt (eingetragen
  // oder die Wohnfläche der versorgten Wohnungen, Entwurf 9.2, 9.5).
  adjustments?: Co2Adjustment[]
  areaSource?: 'entered' | 'served'
```

- [ ] **Step 4: Reine Rechnung (`server/src/co2.ts`)**

Den Typimport aus `'../../shared/types.ts'` um `Co2Adjustment` ergänzen. Ans Dateiende:

```ts
// ---------- Eigene Aufteilung (Heizung PR 7, Entwurf 7.6, 9.2) ----------

// Wie weit die Brennstoffkosten laut Messdienst (V) neben den angesetzten Rechnungen (G) liegen dürfen,
// ohne dass Mietfuchs nachfragt. Eine Festlegung ohne Rechtsfolge (Entwurf 7.6, 15.2 F6).
export const SERVICE_FUEL_TOLERANCE_CENTS = 100

export type SelfSplitInput = {
  emissionsKg: number | null
  co2Cents: number
  areaM2: number | null
  ranges: readonly Co2StageRange[]
  decimals: number
  // § 8 Abs. 1: der Anteil des Vermieters im Nichtwohngebäude aus dem Register, sonst null.
  nonResidentialPermille: number | null
  // § 9: der Faktor aus dem Register; `both`, wenn Vorgaben beidem entgegenstehen.
  restriction: { factor: number; bothSplit: boolean; both: boolean } | null
}

export type SelfSplit = { value: number | null; stage: Co2StageRange | null; permille: number | null; landlordRaw: number | null; adjustments: Co2Adjustment[] }

// Einstufung und Anteil des Vermieters (Entwurf 9.2): Wert = round(E / Fläche), Stufe aus der
// (gekürzten) Tabelle, danach § 8 und § 9. § 9 Abs. 1 kürzt den Anteil „nach § 5, 6, 7 oder 8“, also
// auch den aus § 8. L = C · ‰ / 1000 exakt; gerundet wird erst bei der Verteilung.
export function selfSplit(i: SelfSplitInput): SelfSplit {
  const value = i.emissionsKg !== null && i.areaM2 !== null && i.areaM2 > 0 ? roundSpecific(i.emissionsKg / i.areaM2, i.decimals) : null
  const stage = value === null ? null : stageOf(value, i.ranges)
  const adjustments: Co2Adjustment[] = []
  let permille = stage ? stage.landlordPercent * 10 : null
  if (i.nonResidentialPermille !== null) {
    permille = i.nonResidentialPermille
    adjustments.push('nonResidential')
  }
  if (permille !== null && i.restriction) {
    if (i.restriction.both) {
      permille = i.restriction.bothSplit ? permille * i.restriction.factor : 0
      adjustments.push('restrictionNone')
    } else {
      permille = permille * i.restriction.factor
      adjustments.push('restrictionHalf')
    }
  }
  return { value, stage, permille, landlordRaw: permille === null ? null : (i.co2Cents * permille) / 1000, adjustments }
}
```

- [ ] **Step 5: Die Abzugszeilen als Helfer (`server/src/calc.ts`)**

Importe: aus `'./co2.ts'` zusätzlich `selfSplit, SERVICE_FUEL_TOLERANCE_CENTS`; aus
`'../../shared/law/co2kostaufg.ts'` zusätzlich `co2DistrictEtsNew, co2NonResidential, co2Restriction`;
aus `'../../shared/heatingPeriod.ts'` zusätzlich `servesUnit`; den Typimport aus
`'../../shared/types.ts'` um `CostKey` ergänzen, falls er fehlt.

Im CO₂-Block (PR 6) direkt hinter der Funktion `sharesOf` einfügen:

```ts
  // Bucht die Abzugszeilen eines Topfs (PR 6 beim reinen Ausweis, PR 7 bei der eigenen Aufteilung):
  // R = round(Σ r) als eine Verteilung gerundet, je Mieter eine Zeile −r, beim Vermieter `co2Share` R.
  // L − R entfällt auf Eigennutzung, Leerstand, Pauschale und Wohnungen außerhalb, deren Anteil der
  // Vermieter ohnehin trägt. Gibt R zurück.
  const bookReliefs = (
    pot: Co2Pot,
    raws: readonly { tenancyId: string; raw: number; approximated: boolean }[],
    shares: readonly ReliefShare[],
    printed: Map<string, { cents: number; approximated: boolean }>,
    text: { basis: (x: { approximated: boolean }) => string; steps: (x: { raw: number; approximated: boolean }, cents: number, share: number) => CalcStep[] },
  ): number => {
    const total = Math.round(raws.reduce((a, x) => a + x.raw, 0))
    const cents = distributeCents(total, raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw })))
    raws.forEach((x, k) => {
      const c = cents[k] ?? 0
      const target = statements.get(x.tenancyId)
      if (c === 0 || !target) return
      const share = shares.find((y) => y.tenancyId === x.tenancyId)?.cents ?? 0
      target.rows.push({
        costItemId: pot.reliefKey,
        kind: 'co2Relief',
        category: HEATING_CATEGORY,
        description: CO2_RELIEF_LABEL,
        totalCents: -total,
        keyLabel: 'CO₂-Kostenaufteilung',
        basisText: text.basis(x),
        shareCents: -c,
        labor35aCents: 0,
        steps: text.steps(x, c, share),
      })
      target.totalShareCents -= c
      printed.set(x.tenancyId, { cents: c, approximated: x.approximated })
    })
    if (total !== 0) {
      landlordRows.push({
        costItemId: pot.reliefKey, category: HEATING_CATEGORY, description: CO2_RELIEF_LABEL, totalCents: total,
        keyLabel: 'CO₂-Kostenaufteilung', shareCents: total, landlordParts: [{ reason: 'co2Share', cents: total }],
      })
    }
    return total
  }
```

Im Zweig `if (booked && st.method === 'serviceShown') {` (PR 6) den Abschnitt von
`const total = Math.round(reliefs.raws.reduce((a, x) => a + x.raw, 0))` bis einschließlich der
schließenden Klammer von `if (total !== 0) { landlordRows.push({ … }) }` ersetzen durch:

```ts
          bookReliefs(pot, reliefs.raws, shares, printed, {
            basis: (x) => (x.approximated ? 'nach Ihrem Anteil an den Heizkosten' : 'laut Abrechnung des Messdienstes'),
            steps: (x, c, share) => [
              { label: 'CO₂-Anteil des Vermieters laut Abrechnung', value: fmtCents(L), term: 'co2Split' },
              x.approximated
                ? { label: 'Ihr Teil davon', value: `${fmtCents(L)} × ${fmtCents(share)} ÷ ${fmtCents(S)} = ${fmtExactEuro(x.raw)}` }
                : { label: 'Ihr Teil davon', value: `${fmtCents(c)} laut Abrechnung des Messdienstes` },
              { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
            ],
          })
```

Die Tests von PR 6 (`calc-co2.test.ts`) bleiben dabei grün; das ist die Probe, dass der Helfer
dasselbe bucht.

- [ ] **Step 6: Codes und Texte**

In `noticeKinds` hinter den Codes `fuel.*` (Task 7):

```ts
  // Heizung PR 7: eigene CO₂-Aufteilung (Entwurf 7.6, 9, 10.1).
  'co2.service-unsplit-healed': { level: 'hint', title: 'CO₂-Kosten nachträglich aufgeteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.service-fuel-mismatch': { level: 'hint', title: 'Messdienst hat andere Brennstoffkosten angesetzt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.share-approximated': { level: 'hint', title: 'CO₂-Abzug nach einer Näherung verteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.exceeds-heating': { level: 'error', title: 'CO₂-Kosten höher als die Brennstoffkosten', rule: 'co2-split', terms: ['co2Split'] },
  'co2.pool-keys': { level: 'hint', title: 'Brennstoff nach verschiedenen Schlüsseln verteilt', rule: 'co2-split', terms: ['co2Split', 'allocationKey'] },
  'co2.restriction': { level: 'hint', title: 'CO₂-Anteil wegen Beschränkungen gekürzt', rule: 'co2-restriction', terms: ['co2Split', 'co2Stage'] },
  'co2.non-residential': { level: 'hint', title: 'CO₂-Kosten im Nichtwohngebäude', rule: 'co2-non-residential', terms: ['co2Split', 'co2Stage'] },
  'co2.short-period-agreed': { level: 'hint', title: 'Stufentabelle für einen kurzen Zeitraum gekürzt', rule: 'co2-split', terms: ['co2Stage'] },
```

In `nextStep` (PR 6) die Zeile

```ts
      ? 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf.'
```

ersetzen durch

```ts
      ? 'Tragen Sie auf der Seite Heizkosten die Rechnungen Ihres Versorgers als Lieferungen ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf.'
```

und im Text von `co2.service-unsplit` den letzten Satz `'Bitten Sie den Messdienst um eine Abrechnung
mit CO₂-Aufteilung; dafür braucht er die CO₂-Angaben Ihrer Brennstoffrechnung. Selbst aufteilen kann
Mietfuchs mit einer späteren Version.'` ersetzen durch:

```ts
            'Bitten Sie den Messdienst um eine Abrechnung mit CO₂-Aufteilung; dafür braucht er die CO₂-Angaben Ihrer Brennstoffrechnung. Oder tragen Sie die Rechnung des Versorgers auf der Seite Heizkosten als Lieferung ein; dann teilt Mietfuchs selbst auf.',
```

- [ ] **Step 7: Die eigene Aufteilung im CO₂-Block**

In der Schleife `for (const pot of co2Pots)` die Zeile

```ts
    const applicable = (st !== null || heatingSettled) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)
```

ersetzen durch:

```ts
    // Wärme aus dem Emissionshandel bei einem Anschluss nach dem Stichtag (§ 2 Abs. 4 Satz 2
    // CO2KostAufG, Heizung PR 7): Das Gesetz gilt nicht; der Stichtag steht im Rechtsstand.
    const plantOf = plants.find((p) => p.id === pot.plantId)
    let etsExempt = false
    if (pot.energy === 'districtHeating' && plantOf?.districtEtsNew === true) {
      law(co2DistrictEtsNew, { period: hPeriod }, lawLog)
      etsExempt = true
    }
    const applicable = !etsExempt && (st !== null || heatingSettled) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)
```

Direkt hinter dem Block `if (fuelOf) { report.fuel = … }` (Task 7):

```ts
    // Eigene Aufteilung (Heizung PR 7, Entwurf 7.6, 9): bei freien Schlüsseln aus den Lieferungen dieser
    // Heizperiode, beim Messdienst ohne Aufteilung aus den Rechnungen, die er angesetzt hat.
    const ownSplit = applicable && fuelOf !== undefined && (
      (pot.method === 'manual' && (st === null || st.method === 'self') && fuelOf.lines.length > 0) ||
      (st?.method === 'selfAfterService' && fuelOf.serviceCo2Cents !== null)
    )
```

Die Bedingungen `if (st && applicable) {` und `if (!st && applicable) {` (PR 6) ersetzen durch
`if (st && applicable && !ownSplit) {` und `if (!st && applicable && !ownSplit) {`.

Direkt vor dem Kommentar `// Warmwasser beim Messdienst (#211, Entwurf 7.7)` (PR 6) einfügen:

```ts
    if (ownSplit && fuelOf) {
      const afterService = st?.method === 'selfAfterService'
      const C = (afterService ? fuelOf.serviceCo2Cents : fuelOf.co2Cents) ?? 0
      const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
      const ranges = stageRanges(law(co2StageTable, { period: hPeriod }, lawLog), tableFactor(pot.period))
      // Fläche der Einstufung (9.2): eingetragen, sonst die Wohnfläche der versorgten Wohnungen.
      const served = snapshot.units.filter((u) => plantOf !== undefined && servesUnit(plantOf, u) && isDwelling(u)).reduce((a, u) => a + u.areaM2, 0)
      const area = st?.areaM2 ?? (served > 0 ? served : null)
      const restriction = plantOf?.restriction ?? 'none'
      const split = selfSplit({
        emissionsKg: fuelOf.emissionsKg,
        co2Cents: C,
        areaM2: area,
        ranges,
        decimals: law(co2RoundingDecimals, { period: hPeriod }, lawLog),
        nonResidentialPermille: plantOf?.nonResidential ? law(co2NonResidential, { period: hPeriod }, lawLog) : null,
        restriction: restriction === 'none' ? null : { ...law(co2Restriction, { period: hPeriod }, lawLog), both: restriction === 'both' },
      })
      // x_t (9.4): bei freien Schlüsseln der Anteil an den Positionen mit Lieferung oder als Brennstoff
      // gekennzeichnet, samt den Übertragszeilen (Task 7); fehlt beides, der ganze Topf. Beim Messdienst
      // der Anteil an seinen Beträgen.
      const marked = afterService ? pot.serviceItems : pot.items.filter((c) => c.fuelDeliveryId != null || c.heatingPart === 'fuel')
      const approx = afterService || marked.length === 0
      const base = marked.length === 0 ? pot.items : marked
      const F = base.reduce((a, c) => a + c.amountCents, 0)
      const baseIds = new Set(base.map((c) => c.id))
      const shares: ReliefShare[] = [...statements.values()].flatMap((s) => {
        const cents = s.rows.filter((r) => baseIds.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
        return cents > 0 ? [{ tenancyId: s.tenancyId, cents }] : []
      })
      const gaps: string[] = []
      if (!afterService && fuelOf.missingCo2.length > 0) gaps.push(`die CO₂-Angaben der Rechnung ${andList(fuelOf.missingCo2.map((l) => `„${l}“`))} (Ausstoß in kg und CO₂-Kosten)`)
      if (split.permille === null) {
        if (area === null) gaps.push('die Fläche der versorgten Wohnungen')
        else if (afterService || fuelOf.missingCo2.length === 0) gaps.push('der CO₂-Ausstoß laut Rechnung')
      }
      const printed = new Map<string, { cents: number; approximated: boolean }>()
      let booked = false
      if (gaps.length > 0) {
        warn('co2.incomplete',
          `${where}: Für die Aufteilung der CO₂-Kosten fehlen ${andList(gaps)}. Die Heizkostenabrechnung muss den Anteil der Mieter, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG); ` +
            `fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Tragen Sie die Angaben bei der Lieferung auf der Seite Heizkosten nach.`,
          plantSubject)
      } else if (F <= 0 || C > F) {
        warn('co2.exceeds-heating',
          `${where}: Die CO₂-Kosten der Lieferungen (${fmtCents(C)}) sind höher als die Brennstoffkosten, die verteilt werden (${fmtCents(F)}). Das passt nicht zusammen; Mietfuchs bucht keine CO₂-Aufteilung. ` +
            `Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Prüfen Sie die CO₂-Kosten und die Beträge der Lieferungen und Positionen.`,
          plantSubject)
      } else {
        booked = true
        const L = split.landlordRaw ?? 0
        const permille = split.permille ?? 0
        if (L > 0) {
          bookReliefs(pot, reliefsByShare(L, shares, F).map((x) => ({ ...x, approximated: approx })), shares, printed, {
            basis: () => (approx ? 'nach Ihrem Anteil an den Heizkosten' : 'nach Ihrem Anteil an den Brennstoffkosten'),
            steps: (x, c, share) => [
              { label: 'CO₂-Anteil des Vermieters', value: `${fmtCents(C)} × ${fmtNum(permille / 10)} % = ${fmtExactEuro(L)}`, term: 'co2Split' },
              { label: 'Ihr Teil davon', value: `${fmtExactEuro(L)} × ${fmtCents(share)} ÷ ${fmtCents(F)} = ${fmtExactEuro(x.raw)}` },
              { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
            ],
          })
        }
        if (afterService) {
          // 15.1 Nr. 3: Ob ein Ausweis neben der Abrechnung des Messdienstes die Kürzung heilt, ist offen.
          warn('co2.service-unsplit-healed',
            `${where}: Der Messdienst hat die CO₂-Kosten nicht aufgeteilt. Mietfuchs teilt sie aus den Rechnungen auf, die er angesetzt hat (CO₂-Kosten ${fmtCents(C)}), und zieht den Anteil des Vermieters von ${fmtExactEuro(L)} je Mieter als eigene Zeile ab. ` +
              `Ob das die Kürzung vermeidet, ist nicht entschieden: § 7 Abs. 3 CO2KostAufG verlangt den Ausweis „in der Heizkostenabrechnung“. Jeder Mieter könnte bis zu ${cut} % kürzen${cutsOn(ids, cut)}. Geben Sie die Aufstellung von Mietfuchs zusammen mit der Abrechnung des Messdienstes heraus.`,
            plantSubject)
          const G = fuelOf.serviceGrossCents
          const V = st?.serviceFuelNetCents ?? st?.serviceFuelGrossCents ?? null
          if (G !== null && V !== null && Math.abs(G - V) > SERVICE_FUEL_TOLERANCE_CENTS) {
            warn('co2.service-fuel-mismatch',
              `${where}: Der Messdienst hat Brennstoffkosten von ${fmtCents(V)} angesetzt, die Rechnungen, die Sie als angesetzt gekennzeichnet haben, ergeben ${fmtCents(G)}. ` +
                'Der Messdienst hat andere Brennstoffkosten angesetzt; prüfen Sie, welche Rechnungen er verwendet hat.',
              plantSubject)
          }
          warn('co2.share-approximated',
            `${where}: Der Messdienst weist den Brennstoffanteil je Nutzer nicht aus. Mietfuchs verteilt den CO₂-Anteil des Vermieters deshalb nach dem Anteil an den Heiz- und Warmwasserkosten des Messdienstes, wie es auch Messdienste tun; das bleibt eine Näherung.`,
            plantSubject)
        } else if (marked.length === 0) {
          warn('co2.share-approximated',
            `${where}: Keine Position der Heizanlage ist als Brennstoff gekennzeichnet oder mit einer Lieferung verknüpft. Mietfuchs verteilt den CO₂-Anteil des Vermieters deshalb nach dem Anteil an allen Heizkosten. ` +
              'Das ist eine Näherung, denn die CO₂-Kosten folgen dem Schlüssel des Brennstoffs (§ 7 Abs. 1 Satz 2 CO2KostAufG). Verknüpfen Sie die Positionen der Versorgerrechnung mit ihrer Lieferung.',
            plantSubject)
        } else {
          const keys = [...new Set(marked.filter((c) => !c.id.startsWith('fuel:')).map((c) => c.key))]
          if (keys.length > 1) {
            warn('co2.pool-keys',
              `${where}: Die Brennstoffpositionen werden nach verschiedenen Schlüsseln verteilt (${andList(keys.map((k: CostKey) => KEY_LABELS[k] || k))}). ` +
                'Der CO₂-Anteil des Vermieters folgt jeder Position mit ihrem Schlüssel, denn die CO₂-Kosten sind Teil der Brennstoffkosten (§ 7 Abs. 1 Satz 2 CO2KostAufG). Prüfen Sie, ob die Schlüssel so gewollt sind.',
              plantSubject)
          }
        }
      }
      if (split.adjustments.includes('nonResidential')) {
        warn('co2.non-residential',
          `${where}: Das Gebäude dient nach Ihrer Angabe überwiegend nicht dem Wohnen. Dann tragen Sie mindestens ${fmtNum(law(co2NonResidential, { period: hPeriod }, lawLog) / 10)} % der CO₂-Kosten (§ 8 Abs. 1 CO2KostAufG); Mietfuchs rechnet mit diesem Anteil statt mit der Stufentabelle.`,
          plantSubject)
      }
      if (restriction !== 'none') {
        const r = law(co2Restriction, { period: hPeriod }, lawLog)
        const what = restriction === 'building' ? 'des Gebäudes' : restriction === 'supply' ? 'der Wärme- und Warmwasserversorgung' : 'des Gebäudes und der Wärme- und Warmwasserversorgung'
        const effect = restriction === 'both'
          ? 'Stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt (§ 9 Abs. 2 CO2KostAufG), und die Mieter tragen sie ganz.'
          : `Ihr Anteil an den CO₂-Kosten wird deshalb um ${fmtNum((1 - r.factor) * 100)} % gekürzt (§ 9 Abs. 1 CO2KostAufG).`
        warn('co2.restriction',
          `${where}: Nach Ihrer Angabe stehen öffentlich-rechtliche Vorgaben einer wesentlichen energetischen Verbesserung ${what} entgegen. ${effect} ` +
            'Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG); legen Sie den Nachweis der Abrechnung bei.',
          plantSubject)
      }
      if (pot.period.short) {
        warn('co2.short-period-agreed',
          `${where}: Die Heizperiode ist kürzer als ein Jahr. Mietfuchs kürzt die Grenzen der Stufentabelle im Verhältnis der Tage (§ 5 Abs. 1 Satz 4 CO2KostAufG). ` +
            'Das Gesetz kürzt bei einem „vereinbarten“ Abrechnungszeitraum unter einem Jahr; ob ein Rumpf, den Sie selbst gesetzt haben, vereinbart ist, ist nicht geklärt. Prüfen Sie Ihren Mietvertrag.',
          plantSubject)
      }
      const L = split.landlordRaw
      report.co2 = {
        method: afterService ? 'selfAfterService' : 'self',
        booked,
        deducted: false,
        totalCents: C,
        landlordCents: L === null ? null : Math.round(L),
        landlordPermille: split.permille,
        kgPerM2: split.value,
        emissionsKg: fuelOf.emissionsKg,
        areaM2: area,
        stage: split.stage,
        table: ranges,
        shortened: pot.period.short,
        selfLandlordCents: null,
        selfApproximated: false,
        tenants: shares.map((s) => ({
          tenancyId: s.tenancyId,
          landlordCents: printed.get(s.tenancyId)?.cents ?? 0,
          tenantCents: F > 0 ? Math.round(((C - (L ?? 0)) * s.cents) / F) : null,
          approximated: approx,
        })),
        basis: 'deliveries',
        coveragePermille: fuelOf.coveragePermille,
        adjustments: split.adjustments,
        areaSource: st?.areaM2 != null ? 'entered' : 'served',
      }
    }
```

`statements`, `isDwelling`, `plants`, `snapshot`, `CO2_RELIEF_LABEL`, `HEATING_CATEGORY`, `fmtNum`,
`fmtExactEuro`, `fmtCents`, `andList` und `KEY_LABELS` stehen in `computeSettlement` bzw. calc.ts bereit.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/co2.test.ts test/calc-fuel.test.ts test/calc-co2.test.ts test/calc.test.ts test/settlement-golden.test.ts test/glossary.test.ts && npm run typecheck`
Expected: PASS (calc-fuel.test.ts: 19 Tests). `glossary.test.ts` prüft, dass die neuen Codes Begriffe
tragen, die es gibt (`allocationKey` aus #113, `co2Split`, `co2Stage` aus PR 6).

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/co2.ts server/src/calc.ts server/test/co2.test.ts server/test/calc-fuel.test.ts server/test/calc-co2.test.ts
git commit -m "Eigene CO₂-Aufteilung aus den Lieferungen: Einstufung, § 8, § 9, Abzug nach Brennstoffanteil

Bei freien Schlüsseln aus den abgegrenzten Lieferungen, beim Messdienst ohne Aufteilung aus den
angesetzten Rechnungen ganz (G-A3: 240,00 € statt 203,69 €). Der Abzug folgt dem Schlüssel des
Brennstoffs (G-B5: 232,14 € statt 224,40 €).

Refs #97"
```

---
### Task 9: Abschluss mit Rückfrage, Schätzung, Einfrieren, Wiederöffnen

Beim Abschluss einer Abrechnung (des Objekts oder einer Heizkostenabrechnung nach Weg d) fragt
Mietfuchs nach, wenn eine Heizperiode eine Lücke ohne Rechnung hat und eine Schätzung möglich ist
(8.2, N1): ohne Antwort 409 mit den Lücken, mit `fuelEstimates: 'estimate'` je Lücke eine geschätzte
Lieferung, mit `'none'` ohne. Danach friert derselbe Vorgang je Lieferung ein, was die Heizperioden der
Abrechnung herein- oder hinausgebucht haben (G-A4). Wiederöffnen gibt diese Zeilen frei.

**Files:**
- Modify: `server/src/db/fuel.ts`, `server/src/db/repository.ts`, `server/src/db/heatingSettlements.ts`, `server/src/index.ts`
- Test: `server/test/db-fuel.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 2, 4, 7; PR 2, 5, 6): `FuelGapQuestion`, `HeatingStatement.fuel`, `fuelCarryFrozen`, `fuelDeliveries`, `heatingPeriods`, `ensureHeatingPeriod`, `readFuelCarryFrozen`, `emptyDelivery`, `rowOf`; `closeSettlement(db: Executor, …)`, `reopenSettlement`, `closeHeatingSettlement`, `reopenHeatingSettlement`; in index.ts `sentAtOf`, `SENT_AT_INVALID`, `bodyObject`, `newId`, `today`, `readStock`, `snapshotFor`, `computeHeating`, `heatingTargetOf`.
- Produces:
  - db/fuel.ts: `fuelGapQuestions(s: { heating?: HeatingStatement[] }): FuelGapQuestion[]`, `createEstimates(db: Executor, s, newId: () => string): Promise<string[]>`, `removeEstimates(db: Executor, ids: readonly string[]): Promise<void>`, `freezeFuelCarries(db: Executor, s): Promise<void>`, `unfreezeFuelCarries(db: Executor, settlement: unknown): Promise<void>`
  - repository.ts: `reopenSettlement(db, propertyId, period, historyId, alsoInTransaction?)`; heatingSettlements.ts: `closeHeatingSettlement(db: Executor, …)`, `reopenHeatingSettlement(db, plantId, period, historyId, alsoInTransaction?)`
  - Routen: `POST /api/settlement/:period/close` und `POST /api/heating-settlement/:plant/:period/close` nehmen `fuelEstimates: 'estimate' | 'none'`; ohne Antwort und mit Lücken 409 `{ error, fuelGaps: FuelGapQuestion[] }`; ein anderer Wert 400

- [ ] **Step 1: Write the failing tests**

(a) `server/test/db-fuel.test.ts`: den Import aus `'../src/db/fuel.ts'` um `createEstimates,
freezeFuelCarries, fuelGapQuestions, removeEstimates, unfreezeFuelCarries` ergänzen, aus
`'../src/db/read.ts'` `readFuelCarryFrozen, readFuelDeliveries` importieren, den Typimport
`import type { HeatingStatement } from '../../shared/types.ts'` ergänzen. Anhängen:

```ts
// ---------- Abschluss (Entwurf 8.2, N1, G-A4) ----------

// Die Bewertung einer Heizperiode, wie computeSettlement sie liefert, mit den Zahlen von Fall a und der
// Lücke aus 3.3; die Heizperiode ist hier das Kalenderjahr des Bestands.
const bewertung = (over: Partial<NonNullable<HeatingStatement['fuel']>> = {}): { heating: HeatingStatement[] } => ({
  heating: [{
    plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2: null,
    fuel: {
      coveragePermille: 848.71, emissionsKg: 4588.3, co2Cents: 50923,
      deliveries: [{
        deliveryId: 'd1', label: 'Gas 2025/2026', from: '2025-03-15', to: '2026-03-14', estimated: false, method: 'degreeDays', sharePermille: 848.71,
        fixedKnown: false, split: true, amountCents: 650000, inPeriodCents: 551661, emissionsKg: 4588.3, co2Cents: 50923,
      }],
      carries: [{ deliveryId: 'd1', period: periodKey('2024-01'), cents: -98339 }],
      gaps: [{
        from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29,
        estimate: { from: '2026-03-15', to: '2026-04-30', amountCents: 90774, emissionsKg: 1815.5, co2CostCents: 9077, basedOn: 'Gas 2025/2026', byMeter: false },
      }],
      ...over,
    },
  }],
})

test('Abschluss: Rückfrage je Lücke mit Vorschlag, Schätzung anlegen und wieder entfernen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    assert.deepEqual(fuelGapQuestions(bewertung()), [{ plantId: 'hp', plantName: 'Gas', period: '2025-01', from: '2026-03-15', to: '2026-04-30', amountCents: 90774 }])
    assert.deepEqual(fuelGapQuestions({}), [])
    assert.deepEqual(fuelGapQuestions(bewertung({ gaps: [{ from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29, estimate: null }] })), [])
    let n = 0
    const ids = await opened.write((db) => createEstimates(db, bewertung(), () => `e${++n}`))
    assert.deepEqual(ids, ['e1'])
    const e = (await opened.read((db) => readFuelDeliveries(db))).find((d) => d.id === 'e1') ?? assert.fail('keine Schätzung')
    assert.deepEqual(
      [e.label, e.estimated, e.invoiceFrom, e.invoiceTo, e.amountCents, e.emissionsKg, e.co2CostCents],
      ['Schätzung 15.03.–30.04.2026', true, '2026-03-15', '2026-04-30', 90774, 1815.5, 9077],
    )
    await opened.write((db) => removeEstimates(db, ids))
    assert.deepEqual((await opened.read((db) => readFuelDeliveries(db))).map((d) => d.id), ['d1'])
  })
})

test('Einfrieren und Freigeben: je Lieferung Übertrag, Ausstoß und CO₂-Kosten der Heizperiode', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => freezeFuelCarries(db, bewertung()))
    assert.deepEqual(await opened.read((db) => readFuelCarryFrozen(db)), [{ deliveryId: 'd1', plantId: 'hp', period: '2025-01', cents: -98339, emissionsKg: 4588.3, co2Cents: 50923 }])
    // Ein zweites Einfrieren ersetzt, statt eine zweite Zeile anzulegen.
    await opened.write((db) => freezeFuelCarries(db, bewertung()))
    assert.equal((await opened.read((db) => readFuelCarryFrozen(db))).length, 1)
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 1 })), heatingError(409, /eingefroren/))
    // Freigegeben wird nach dem eingefrorenen Stand; ein unlesbarer Stand gibt nichts frei.
    await opened.write((db) => unfreezeFuelCarries(db, 'kaputt'))
    assert.equal((await opened.read((db) => readFuelCarryFrozen(db))).length, 1)
    await opened.write((db) => unfreezeFuelCarries(db, JSON.parse(JSON.stringify(bewertung()))))
    assert.deepEqual(await opened.read((db) => readFuelCarryFrozen(db)), [])
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 1 })))?.fixedCents, 1)
  })
})
```

(b) `server/test/api.test.ts`: anhängen:

```ts
test('Abschluss mit Lücke: Rückfrage (409), Schätzung, Sperre der eingefrorenen Lieferung, Wiederöffnen gibt frei', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'manual' })))
    // Die erste Rechnung des Jahres reicht bis Ende Juni; für das zweite Halbjahr fehlt sie.
    const d = await jsonOf<FuelDelivery>(await send(`/api/heating-plants/${plant.id}/deliveries`, postJson({ label: 'Gas 1. Halbjahr', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30' })))
    await s.api<CostItem>('/api/costItems', postJson({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area', heatingPlantId: plant.id, fuelDeliveryId: d.id }))
    const gefragt = await send('/api/settlement/2025/close', postJson({}))
    assert.equal(gefragt.status, 409)
    const body = await jsonOf<{ error: string; fuelGaps: FuelGapQuestion[] }>(gefragt)
    assert.match(body.error, /fehlt eine Rechnung/)
    assert.deepEqual(body.fuelGaps.map((g) => [g.plantId, g.period, g.from, g.to]), [[plant.id, '2025-01', '2025-07-01', '2025-12-31']])
    assert.ok((body.fuelGaps[0]?.amountCents ?? 0) > 0)
    assert.equal((await send('/api/settlement/2025/close', postJson({ fuelEstimates: 'vielleicht' }))).status, 400)
    assert.equal((await send('/api/settlement/2025/close', postJson({ fuelEstimates: 'estimate' }))).status, 201)
    const liste = await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)
    const schaetzung = liste.find((x) => x.estimated) ?? assert.fail('keine Schätzung angelegt')
    assert.deepEqual([schaetzung.label, schaetzung.amountCents], ['Schätzung 01.07.–31.12.2025', body.fuelGaps[0]?.amountCents])
    // Die Schätzung erscheint in der eingefrorenen Abrechnung mit ihrem Vorbehalt.
    const zu = await s.api<{ notices: Notice[] }>('/api/settlement/2025')
    assert.ok(zu.notices.some((n) => n.code === 'fuel.estimated'))
    const gesperrt = await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 100 }) })
    assert.equal(gesperrt.status, 409)
    assert.match(await errorFrom(gesperrt), /eingefroren/)
    await s.api('/api/settlement/2025/close', { method: 'DELETE' })
    assert.equal((await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 100 }) })).status, 200)
    // Erneut abschließen fragt nicht mehr: Die Schätzung deckt die Lücke.
    assert.equal((await send('/api/settlement/2025/close', postJson({}))).status, 201)
  } finally {
    s.stop()
  }
})
```

Den Typimport aus `'../../shared/types.ts'` um `FuelGapQuestion` ergänzen, dazu `Notice`, falls er fehlt
(`CostItem`, `HeatingPlant`, `FuelDelivery` und `Unit` sind seit PR 4 bzw. Task 5 da).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-fuel.test.ts && npm --prefix server test -- --test-name-pattern "Abschluss mit Lücke" test/api.test.ts`
Expected: FAIL: `does not provide an export named 'createEstimates'`; in api.test.ts antwortet der
Abschluss mit 201 statt 409.

- [ ] **Step 3: Abschluss in `server/src/db/fuel.ts`**

Importe ergänzen: aus `'drizzle-orm'` zusätzlich `and, inArray`; `formatDayRange` aus
`'../../../shared/period.ts'`; die Typen `FuelGapQuestion, HeatingStatement` aus
`'../../../shared/types.ts'`; `heatingPeriods` aus `'./schema.ts'`; `ensureHeatingPeriod` aus
`'./co2.ts'`. Ans Dateiende:

```ts
// ---------- Abschluss (Heizung PR 7, Entwurf 8.2, N1, G-A4) ----------

type WithHeating = { heating?: HeatingStatement[] }

// Die Lücken einer Berechnung, für die Mietfuchs eine Schätzung vorschlagen kann. Der Betrag ist
// zugleich, was der Vermieter ohne Schätzung trägt, wenn die Rechnung nach dem Abschluss kommt.
export function fuelGapQuestions(s: WithHeating): FuelGapQuestion[] {
  return (s.heating ?? []).flatMap((h) =>
    (h.fuel?.gaps ?? []).flatMap((g) =>
      g.estimate ? [{ plantId: h.plantId, plantName: h.plantName, period: h.period, from: g.from, to: g.to, amountCents: g.estimate.amountCents }] : []))
}

// Je Lücke mit Vorschlag eine geschätzte Lieferung, ohne Kostenposition: verteilt wird sie mit dem
// Schlüssel der Rechnung, aus der sie geschätzt ist (fuel.ts). Gibt die neuen Kennungen zurück.
export async function createEstimates(db: Executor, s: WithHeating, newId: () => string): Promise<string[]> {
  const ids: string[] = []
  for (const h of s.heating ?? []) {
    for (const g of h.fuel?.gaps ?? []) {
      const e = g.estimate
      if (!e) continue
      const id = newId()
      await db.insert(fuelDeliveries).values(rowOf({
        ...emptyDelivery(id, h.plantId),
        label: `Schätzung ${formatDayRange(e.from, e.to)}`,
        invoiceFrom: e.from,
        invoiceTo: e.to,
        amountCents: e.amountCents,
        emissionsKg: e.emissionsKg,
        co2CostCents: e.co2CostCents,
        estimated: true,
      }))
      ids.push(id)
    }
  }
  return ids
}

// Nimmt Schätzungen zurück, wenn der Abschluss danach scheitert: Ohne Abschluss soll keine stehen.
export async function removeEstimates(db: Executor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.delete(fuelDeliveries).where(and(inArray(fuelDeliveries.id, [...ids]), eq(fuelDeliveries.estimated, true)))
}

// Friert je Heizperiode der Abrechnung und je Lieferung ein, was sie herein- (+) oder hinausgebucht
// (−) hat, dazu Ausstoß und CO₂-Kosten dieser Lieferung in ihr (G-A4). Auch eine Lieferung ohne
// Übertrag bekommt ihre Zeile: Sie berührt eine abgeschlossene Heizperiode und ist damit gesperrt.
// Ein zweites Einfrieren derselben Heizperiode ersetzt.
export async function freezeFuelCarries(db: Executor, s: WithHeating): Promise<void> {
  for (const h of s.heating ?? []) {
    const fuel = h.fuel
    if (!fuel) continue
    const ids = [...new Set([...fuel.deliveries.map((d) => d.deliveryId), ...fuel.carries.map((c) => c.deliveryId)])]
    if (ids.length === 0) continue
    const heatingPeriodId = await ensureHeatingPeriod(db, h.plantId, h.period)
    await db.delete(fuelCarryFrozen).where(eq(fuelCarryFrozen.heatingPeriodId, heatingPeriodId))
    await db.insert(fuelCarryFrozen).values(ids.map((deliveryId) => {
      const line = fuel.deliveries.find((d) => d.deliveryId === deliveryId)
      return {
        deliveryId,
        heatingPeriodId,
        cents: fuel.carries.filter((c) => c.deliveryId === deliveryId).reduce((a, c) => a + c.cents, 0),
        emissionsKg: line?.emissionsKg ?? 0,
        co2Cents: line?.co2Cents ?? 0,
      }
    }))
  }
}

// Die Heizperioden, die ein eingefrorener Stand bewertet hat. Der Stand ist `unknown`, denn er kann
// aus einer früheren Version stammen; was nicht lesbar ist, gibt nichts frei.
function heatingKeysOf(settlement: unknown): { plantId: string; period: string }[] {
  if (settlement === null || typeof settlement !== 'object' || !('heating' in settlement) || !Array.isArray(settlement.heating)) return []
  return settlement.heating.flatMap((h: unknown) => {
    if (h === null || typeof h !== 'object' || !('plantId' in h) || !('period' in h)) return []
    return typeof h.plantId === 'string' && typeof h.period === 'string' ? [{ plantId: h.plantId, period: h.period }] : []
  })
}

// Wiederöffnen (8.2 Fall f): Die eingefrorenen Teile der Heizperioden dieses Stands entfallen; danach
// rechnen alle Zeiträume wieder mit dem, was die Lieferungen heute ergeben.
export async function unfreezeFuelCarries(db: Executor, settlement: unknown): Promise<void> {
  for (const k of heatingKeysOf(settlement)) {
    const rows = await db.select({ id: heatingPeriods.id }).from(heatingPeriods)
      .where(and(eq(heatingPeriods.plantId, k.plantId), eq(heatingPeriods.period, k.period)))
    for (const r of rows) await db.delete(fuelCarryFrozen).where(eq(fuelCarryFrozen.heatingPeriodId, r.id))
  }
}
```

Hinweis zu `heatingKeysOf`: Die Verengung über `'heating' in settlement` und `Array.isArray` kommt ohne
`as` aus; das Element ist `unknown` (Rückgabe von `Array.isArray` auf `unknown` ist `any[]`, deshalb die
ausdrückliche Annotation `(h: unknown)`).

- [ ] **Step 4: Wiederöffnen mit Freigabe (`repository.ts`, `heatingSettlements.ts`)**

In `server/src/db/repository.ts` `reopenSettlement` ersetzen:

```ts
// Wiederöffnen verschiebt den Stand in den Verlauf (#56, Teil 2), statt ihn zu löschen, und zwar
// in einer Transaktion: Scheiterte das Löschen nach dem Einfügen, stünde der Zeitraum sonst zugleich
// als abgeschlossen und im Verlauf da (Befund der Durchsicht). `alsoInTransaction` läuft im selben
// Vorgang mit dem eingefrorenen Stand (Heizung PR 7: die eingefrorenen Lieferungsteile freigeben);
// repository.ts kennt db/fuel.ts nicht, deshalb reicht die Route es herein.
export async function reopenSettlement(
  db: Database,
  propertyId: string,
  period: PeriodKey,
  historyId: string,
  alsoInTransaction: (tx: Executor, settlement: unknown) => Promise<void> = async () => {},
): Promise<boolean> {
  const eintrag = await findClosedSettlement(db, propertyId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedSettlementHistory).values({
      id: historyId, propertyId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedSettlements).where(closedOf(propertyId, period))
    await alsoInTransaction(tx, eintrag.settlement)
  })
  return true
}
```

In `server/src/db/heatingSettlements.ts`: den Import `import type { Database } from './client.ts'` zu
`import type { Database, Executor } from './client.ts'` erweitern; in `closeHeatingSettlement` den Typ
des ersten Parameters von `Database` auf `Executor` ändern; `reopenHeatingSettlement` ersetzen:

```ts
export async function reopenHeatingSettlement(
  db: Database,
  plantId: string,
  period: PeriodKey,
  historyId: string,
  alsoInTransaction: (tx: Executor, settlement: unknown) => Promise<void> = async () => {},
): Promise<boolean> {
  const eintrag = await findClosedHeatingSettlement(db, plantId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedHeatingSettlementHistory).values({
      id: historyId, plantId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedHeatingSettlements).where(closedOf(plantId, period))
    await alsoInTransaction(tx, eintrag.settlement)
  })
  return true
}
```

- [ ] **Step 5: Routen (`server/src/index.ts`)**

Importe: aus `'./db/fuel.ts'` zusätzlich `createEstimates, freezeFuelCarries, fuelGapQuestions,
removeEstimates, unfreezeFuelCarries`; den Typ `Executor` aus `'./db/client.ts'` (neben `Database`);
den Typ `FuelGapQuestion` aus `'../../shared/types.ts'`; `ComputedSettlement` ist seit PR 5 importiert.

Hinter `sentAtOf` einfügen:

```ts
// Die Antwort auf die Rückfrage zur Schätzung (Heizung PR 7, Entwurf 8.2, N1, A5): `estimate` legt je
// Lücke eine geschätzte Lieferung mit Vorbehalt an, `none` schließt ohne ab. `null`: keine Antwort,
// `false`: ein anderer Wert (400).
type FuelAnswer = 'estimate' | 'none'
const FUEL_ANSWER_INVALID = 'Die Antwort auf die Rückfrage zur Schätzung ist „estimate“ oder „none“.'
const FUEL_GAPS_TEXT =
  'Für einen Teil der Heizperiode fehlt eine Rechnung. Mietfuchs kann die Kosten bis dahin mit Vorbehalt schätzen; ohne Schätzung tragen Sie diesen Teil selbst, auch wenn die Rechnung später kommt.'
const fuelAnswerOf = (req: Request): FuelAnswer | null | false => {
  const value: unknown = bodyObject(req).fuelEstimates
  if (value === undefined || value === null) return null
  return value === 'estimate' || value === 'none' ? value : false
}

// Abschließen samt Lieferungen (Heizung PR 7): rechnen, bei Lücken ohne Antwort nachfragen, auf Wunsch
// Schätzungen anlegen und neu rechnen, dann Abschluss und Einfrieren in einer Transaktion. Die
// Schätzungen entstehen davor in einer eigenen, weil die Berechnung den Bestand außerhalb einer
// Transaktion liest; scheitert der Abschluss danach, werden sie zurückgenommen. Alles läuft im selben
// Schreibvorgang (`writeData`), dazwischen kommt keine andere Anfrage durch.
async function closeWithFuel(
  db: Database,
  answer: FuelAnswer | null,
  compute: () => Promise<ComputedSettlement>,
  close: (tx: Executor, settlement: ComputedSettlement) => Promise<void>,
): Promise<FuelGapQuestion[] | null> {
  let settlement = await compute()
  const gaps = fuelGapQuestions(settlement)
  if (gaps.length > 0 && answer === null) return gaps
  let created: string[] = []
  if (gaps.length > 0 && answer === 'estimate') {
    const stand = settlement
    created = await db.transaction((tx) => createEstimates(tx, stand, newId))
    settlement = await compute()
  }
  const final = settlement
  try {
    await db.transaction(async (tx) => {
      await close(tx, final)
      await freezeFuelCarries(tx, final)
    })
  } catch (err) {
    await removeEstimates(db, created)
    throw err
  }
  return null
}
```

`app.post('/api/settlement/:period/close', …)` ersetzen:

```ts
// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still. Mit
// Lieferungen fragt Mietfuchs bei einer Lücke nach (Heizung PR 7) und friert die Überträge mit ein.
app.post('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  // Rechnen und Einfrieren im selben Vorgang: Käme dazwischen eine Änderung an einer
  // Kostenposition durch, fröre Mietfuchs einen Stand ein, den es so nie gegeben hat.
  const ergebnis = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    const label = periodLabel(period)
    if (await findClosedSettlement(db, property, period.key)) return { schonDa: true, label, gaps: null }
    const gaps = await closeWithFuel(
      db,
      answer,
      async () => computeSettlement(snapshotFor(await readStock(db), property, period), { asOf: today() }),
      (tx, settlement) => closeSettlement(tx, { id: newId(), propertyId: property, period: period.key, closedAt: new Date().toISOString(), sentAt, settlement }),
    )
    return { schonDa: false, label, gaps }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Abrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.gaps) return res.status(409).json({ error: FUEL_GAPS_TEXT, fuelGaps: ergebnis.gaps })
  res.status(201).json({ ok: true })
})
```

In `app.delete('/api/settlement/:period/close', …)` den Aufruf
`reopenSettlement(db, property, (await periodOf(db, req, property)).key, newId())` ersetzen durch
`reopenSettlement(db, property, (await periodOf(db, req, property)).key, newId(), unfreezeFuelCarries)`.

`app.post('/api/heating-settlement/:plant/:period/close', …)` (PR 5) ersetzen:

```ts
app.post('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const answer = fuelAnswerOf(req)
  if (answer === false) return res.status(400).json({ error: FUEL_ANSWER_INVALID })
  // Rechnen und Einfrieren im selben Vorgang, wie bei der Abrechnung des Objekts.
  const ergebnis = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    const label = periodLabel(target.period)
    if (await findClosedHeatingSettlement(db, target.plant.id, target.period.key)) return { schonDa: true, label, gaps: null }
    const gaps = await closeWithFuel(
      db,
      answer,
      async () => computeHeating(await readStock(db), target.plant, target.period),
      (tx, settlement) => closeHeatingSettlement(tx, {
        id: newId(), plantId: target.plant.id, period: target.period.key, closedAt: new Date().toISOString(), sentAt, settlement,
      }),
    )
    return { schonDa: false, label, gaps }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Die Heizkostenabrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  if (ergebnis.gaps) return res.status(409).json({ error: FUEL_GAPS_TEXT, fuelGaps: ergebnis.gaps })
  res.status(201).json({ ok: true })
})
```

In `app.delete('/api/heating-settlement/:plant/:period/close', …)` den Aufruf
`reopenHeatingSettlement(db, target.plant.id, target.period.key, newId())` um `, unfreezeFuelCarries`
ergänzen.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-fuel.test.ts test/api.test.ts test/db-heizperiode.test.ts && npm run typecheck`
Expected: PASS. Die Tests von PR 2 und PR 5 zum Abschluss (`/api/settlement/2040/close` …) bleiben grün:
Ohne Lieferung gibt es keine Lücke und damit keine Rückfrage.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/fuel.ts server/src/db/repository.ts server/src/db/heatingSettlements.ts server/src/index.ts server/test/db-fuel.test.ts server/test/api.test.ts
git commit -m "Abschluss mit Rückfrage zur Schätzung, Einfrieren der Überträge, Freigabe beim Wiederöffnen

Fehlt für einen Teil der Heizperiode eine Rechnung, fragt der Abschluss nach (409 mit den
Lücken); geschätzt wird nur auf Antwort. Abschluss und Einfrieren laufen in einer Transaktion.

Refs #97"
```

---
### Task 10: Golden F13

F13 ist F12 (Mai–April, Messdienst ohne CO₂-Aufteilung) mit der Gasrechnung als Lieferung, vom
Messdienst angesetzt (Entwurf 12.1). Erwartet: E umgerechnet = E der Rechnung, C ganz (G-A3), Abzug
nach dem Anteil an den Messdienstbeträgen, Lücke 47 Tage mit 151,3 ‰. Die kg der Rechnung sind noch
nicht abgeschrieben (Gegenprüfung E.10); bis dahin sind sie erfunden, als solche gekennzeichnet, und
zwei Varianten halten das Kippen an der Grenze 27,0 fest.

**Files:**
- Create: `server/test/fixtures/heating/F13-eigene-aufteilung/README.md`
- Modify: `server/test/heating-golden.test.ts`

**Interfaces:**
- Consumes (Task 4, 8; PR 6): `createDelivery`, `saveCo2Statement`, `createHeatingPlant`, `readStock`, `snapshotFor`, `computeSettlement`; in heating-golden.test.ts `withDatabase`, `vierWohnungen`, `FIXTURES`, `euro`; `fixtures/heating/F12-messdienst-mai-april/betraege.json` (PR 6).
- Produces: Golden F13.

- [ ] **Step 1: Herleitung**

`server/test/fixtures/heating/F13-eigene-aufteilung/README.md`:

```markdown
# F13 Mai–April mit eigener Aufteilung

Wie F12: vier vermietete Einheiten, Objekt von Mai bis April, Heizperiode 01.05.2025–30.04.2026, die
Position „Heizung und Warmwasser“ mit den vier Einzelbeträgen aus `../F12-messdienst-mai-april/betraege.json`
(zusammen 4.276,51 €), Antwort „gar nicht aufgeteilt“. Dazu die Gasrechnung als Lieferung an der
Heizanlage: 15.03.2025–14.03.2026, 29.886 kWh, 3.117,47 €, CO₂-Kosten 600,00 €, „vom Messdienst
angesetzt“. Fläche der Einstufung: 200,6 m², wie die Wohnfläche laut Abrechnung (Entwurf 15.1 Nr. 1).

**Die kg sind erfunden.** Die Rechnung nennt den Ausstoß; bis er abgeschrieben ist (Gegenprüfung
E.10), stehen zwei Werte nahe der Grenze 27,0 da, die das Kippen festhalten. Wer den echten Wert
einträgt, ersetzt die Varianten durch ihn und rechnet Stufe und L hier neu.

## Herleitung

**Anteil der Rechnung an der Heizperiode.** Nach der Gradtagszahlentabelle (§ 9 Abs. 2 HeizkostenV,
Tabelle aus dem Register) entfallen auf 01.05.2025–14.03.2026 848,71 ‰ der Gradtage der Heizperiode.
Die Lücke 15.03.–30.04.2026 hat 47 Tage und 151,29 ‰ (gerundet 151,3 ‰); dafür gibt es die Warnung
`fuel.uncovered`. Eine Schätzung schlägt Mietfuchs beim Messdienst nicht vor: Seine Beträge stehen
fest.

**E umgerechnet** (§ 5 Abs. 1 Satz 5 CO2KostAufG, Entwurf 3.3): E_H = E · 848,71 ‰ / 848,71 ‰ = E. Eine
einzige Rechnung, die die Heizperiode zu 848,71 ‰ abdeckt, ergibt umgerechnet ihren eigenen Ausstoß.

**C ganz** (G-A3, Entwurf 7.6): Der Messdienst hat die Rechnung als Anlieferung voll verteilt, die
Mieter haben sie ganz bezahlt; C = 600,00 €, nicht 600,00 € · 848,71 ‰ = 509,23 €.

**Variante A:** E = 5.404,16 kg. 5.404,16 / 200,6 = 26,9400 → gerundet 26,9 (§ 5 Abs. 1 Satz 3) →
Stufe 22 bis unter 27: Vermieter 30 %. L = 600,00 € · 30 % = **180,00 €**.

**Variante B:** E = 5.406,17 kg. 5.406,17 / 200,6 = 26,9500 → gerundet 27,0 → Stufe 27 bis unter 32:
Vermieter 40 %. L = 600,00 € · 40 % = **240,00 €**. Die erste Fassung hätte 600,00 € · 0,84871 · 40 %
= 203,69 € gerechnet; den Mietern fehlten 36,31 €.

**Abzug je Mieter** (Entwurf 9.4): r_i = L · Einzelbetrag_i / 4.276,51 €. Gerundet wird R = round(Σ r_i)
= L als eine Verteilung nach dem größten Rest; jeder Abzug liegt deshalb weniger als einen Cent neben
r_i, und die vier ergeben zusammen genau L. Der Vermieter trägt L als `co2Share`.

**Hinweise.** `co2.service-unsplit` entfällt; stattdessen `co2.service-unsplit-healed` („bis zu 3 %“,
Entwurf 15.1 Nr. 3) und `co2.share-approximated` (der Messdienst weist den Brennstoffanteil je Nutzer
nicht aus).
```

- [ ] **Step 2: Write the test**

In `server/test/heating-golden.test.ts` den Import `import { createDelivery } from '../src/db/fuel.ts'`
ergänzen und anhängen:

```ts
// Die vier Einzelbeträge von F12 (aus dem Beleg); F13 baut darauf auf.
function einzelbetraegeF12(): number[] {
  const datei = path.join(FIXTURES, 'F12-messdienst-mai-april', 'betraege.json')
  if (!fs.existsSync(datei)) return assert.fail(`${datei} fehlt: die vier Einzelbeträge aus dem Beleg (Entwurf 12.1) sind noch nicht eingetragen`)
  const daten: unknown = JSON.parse(fs.readFileSync(datei, 'utf8'))
  const v = typeof daten === 'object' && daten !== null ? Reflect.get(daten, 'einzelbetraege') : undefined
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isInteger(x) && x > 0)) return assert.fail('einzelbetraege in betraege.json: vier ganze Cent-Beträge erwartet')
  return v
}

test('F13 Mai–April mit eigener Aufteilung: E umgerechnet, C ganz (G-A3), 26,94 → 30 % gegen 26,95 → 40 %', async () => {
  const einzel = einzelbetraegeF12()
  const S = einzel.reduce((a, c) => a + c, 0)
  const betragVon: Record<string, number | undefined> = { ta: einzel[0], tb: einzel[1], tc: einzel[2], td: einzel[3] }
  const varianten = [
    { kg: 5404.16, wert: 26.9, permille: 300, L: 18000 },
    { kg: 5406.17, wert: 27, permille: 400, L: 24000 },
  ]
  for (const v of varianten) {
    await withDatabase(async (opened) => {
      await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
      await vierWohnungen(opened)
      await opened.write(async (db) => {
        await createEntity(db, 'costItems', 'hz', {
          propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: S, key: 'amounts',
          tenancyAmounts: betragVon,
        })
        await saveCo2Statement(db, 'hp', '2025-05', { method: 'selfAfterService', areaM2: 200.6 })
        await createDelivery(db, 'gas', 'hp', {
          label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, energyKwh: 29886, emissionsKg: v.kg, co2CostCents: 60000,
        })
      })
      const p = periodOfKey({ startMonth: 5, changes: [] }, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025/2026')
      const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
      const fall = `${v.kg} kg`
      const h = s.heating?.[0] ?? assert.fail(`${fall}: keine Bewertung`)
      const co2 = h.co2 ?? assert.fail(`${fall}: keine CO₂-Bewertung`)
      assert.deepEqual([co2.method, co2.totalCents, co2.kgPerM2, co2.landlordPermille, co2.landlordCents, co2.areaM2, co2.areaSource], ['selfAfterService', 60000, v.wert, v.permille, v.L, 200.6, 'entered'], fall)
      assert.ok(Math.abs((co2.emissionsKg ?? 0) - v.kg) < 1e-6, `${fall}: E umgerechnet = E der Rechnung`)
      assert.equal(h.fuel?.coveragePermille.toFixed(2), '848.71', fall)
      // Abzug je Mieter: weniger als ein Cent neben L · Einzelbetrag / S, zusammen genau L.
      const abzuege = s.statements.map((st) => st.rows.filter((r) => r.kind === 'co2Relief').reduce((a, r) => a + r.shareCents, 0))
      assert.equal(abzuege.reduce((a, c) => a + c, 0), -v.L, fall)
      s.statements.forEach((st, i) => {
        const e = betragVon[st.tenancyId] ?? assert.fail(`unbekanntes Mietverhältnis ${st.tenancyId}`)
        assert.ok(Math.abs(-(abzuege[i] ?? 0) - (v.L * e) / S) < 1, `${fall}, ${st.tenancyId}: ${abzuege[i]}`)
      })
      assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'co2:hp:2025-05')?.landlordParts, [{ reason: 'co2Share', cents: v.L }], fall)
      const codes = s.notices.map((n) => n.code)
      assert.ok(!codes.includes('co2.service-unsplit'), fall)
      assert.ok(codes.includes('co2.service-unsplit-healed') && codes.includes('co2.share-approximated'), fall)
      assert.match(s.notices.find((n) => n.code === 'fuel.uncovered')?.text ?? '', /15\.03\.–30\.04\.2026 \(47 Tage, 151,3 ‰ der Gradtage\)/, fall)
      assert.ok(s.legalBasis.values?.some((x) => x.id === 'hkv.degree-days'), `${fall}: Gradtagstabelle im Rechtsstand`)
    })
  }
})
```

- [ ] **Step 3: Run tests**

Run: `npm --prefix server test -- test/heating-golden.test.ts test/settlement-golden.test.ts test/db-golden.test.ts`
Expected: PASS, sobald `betraege.json` von F12 eingetragen ist; sonst scheitern F12 und F13 mit der
Ansage, nie mit einem erfundenen Einzelbetrag. F15 und die Fixtures unter `fixtures/settlement/`
bleiben wortgleich (ohne Lieferung ändert sich nichts). Scheitert eine Zahl, ist entweder die
Berechnung falsch oder die Herleitung; die Erwartung wird nie an das Ergebnis angepasst.

- [ ] **Step 4: Commit**

```bash
git add server/test/heating-golden.test.ts server/test/fixtures/heating/F13-eigene-aufteilung
git commit -m "Golden F13: eigene CO₂-Aufteilung nach Messdienst mit der Gasrechnung als Lieferung

Zwei Varianten an der Grenze 27,0 (180,00 € gegen 240,00 €); die kg der Rechnung sind bis
zur Abschrift erfunden und als solche gekennzeichnet.

Refs #97"
```

---
### Task 11: Seite Heizkosten: Lieferungen, Gradtagzahlen des Orts, CO₂-Angaben zum Gebäude

Die Seite Heizkosten (PR 6) bekommt je Heizanlage und Heizperiode die Karte „Lieferungen“ (die
Rechnungen des Versorgers, die in dieser Heizperiode enden, und bei freien Schlüsseln die Verknüpfung
der Positionen), die Karte „CO₂: Angaben zum Gebäude“ (§ 8, § 9, Emissionshandel, bei freien
Schlüsseln die Fläche der Einstufung) und einmal je Seite „Gradtagzahlen Ihres Orts“. Die Logik liegt
DOM-frei in `client/src/fuelForm.ts`; je neuem Auswahlfeld ein jsdom-Test, dass der angezeigte Wert dem
gespeicherten entspricht.

**Files:**
- Create: `client/src/fuelForm.ts`, `client/src/components/FuelCard.tsx`, `client/src/components/DegreeDaysCard.tsx`, `client/src/components/Co2FactsCard.tsx`
- Modify: `client/src/pages/Heizkosten.tsx`
- Test: `client/src/fuelForm.test.ts` (neu), `client/src/components/FuelCard.test.tsx` (neu), `client/src/components/Co2FactsCard.test.tsx` (neu)

**Interfaces:**
- Consumes (Task 2, 5; PR 4, 6): `FuelDelivery`, `DegreeDayValue`, `Co2Restriction`, `HeatingPlant` (mit `nonResidential`, `restriction`, `districtEtsNew`), `HeatingPeriodView['items']` mit `fuelDeliveryId`; Routen `/api/heating-plants/:id/deliveries`, `/api/fuel-deliveries/:id`, `/api/properties/:id/degree-days`, `PUT /api/heating-plants/:id`, `PUT`/`DELETE /api/heating-plants/:id/periods/:period/co2`, `PUT /api/costItems/:id`; `api`, `errorText`, `fmtEuro`, `parseEuro`; `parseDecimal` (co2Form.ts, PR 6); `formatDayRange` (`shared/period.ts`); `Term`, `useToast`, `useConfirm`; `Co2Card`, `HotWaterCard`, `PageHeader`, `usePeriod`, `useProperty`, `withProperty`.
- Produces:
  - `fuelForm.ts`: `type FuelForm`, `emptyFuelForm()`, `fuelToForm(d)`, `fuelBody(form, method): { body: Record<string, unknown> } | { error: string }`, `deliveryLine(d): string`, `deliveryOptions(deliveries)`, `ownedBy(deliveries, view)`, `monthsOf(from, to)`, `degreeDaysToForm(values, months)`, `degreeDaysBody(form)`, `RESTRICTION_OPTIONS`
  - Komponenten `FuelCard`, `DegreeDaysCard`, `Co2FactsCard`

- [ ] **Step 1: Write the failing tests**

`client/src/fuelForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import {
  degreeDaysBody, degreeDaysToForm, deliveryLine, deliveryOptions, emptyFuelForm, fuelBody, fuelToForm, monthsOf, ownedBy, RESTRICTION_OPTIONS,
} from './fuelForm'
import type { FuelDelivery } from './types'

const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: 311747, quantity: null, quantityUnit: null, energyKwh: 29886, gasBasis: null, heatingValue: null, emissionsKg: 5406.17, co2CostCents: 60000,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: 900, fixedCents: 12000, estimated: false, usedByService: true, parts: [],
}

test('Lieferung ins Formular und zurück: Beträge, Zahlen, Anteil in Prozent', () => {
  const form = fuelToForm(gas)
  expect(form).toMatchObject({ label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amount: '3.117,47', fixed: '120,00', sharePercent: '90', emissionsKg: '5406,17', co2Cost: '600,00', energyKwh: '29886' })
  const r = fuelBody(form, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toEqual({
    label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, fixedCents: 12000, sharePermille: 900,
    emissionsKg: 5406.17, co2CostCents: 60000, energyKwh: 29886, usedByService: true,
  })
})

test('Bei freien Schlüsseln kein Betrag: Er steht in den verknüpften Positionen', () => {
  const r = fuelBody({ ...fuelToForm(gas), amount: '999,00' }, 'manual')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).not.toHaveProperty('amountCents')
  expect(r.body).not.toHaveProperty('usedByService')
})

test('Fehler mit einem Satz; leere Felder werden null', () => {
  expect(fuelBody(emptyFuelForm(), 'manual')).toEqual({ error: 'Bitte geben Sie den Rechnungszeitraum an (Beginn und Ende laut Rechnung).' })
  const zeitraum = { ...emptyFuelForm(), invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14' }
  expect(fuelBody({ ...zeitraum, fixed: 'zwölf' }, 'manual')).toEqual({ error: 'Der feste Preisbestandteil ist kein Betrag.' })
  expect(fuelBody({ ...zeitraum, sharePercent: '120' }, 'manual')).toEqual({ error: 'Der eingetragene Anteil liegt zwischen 0 und 100 %.' })
  expect(fuelBody({ ...zeitraum, emissionsKg: '-1' }, 'manual')).toEqual({ error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' })
  const leer = fuelBody(zeitraum, 'manual')
  if ('error' in leer) throw new Error(leer.error)
  expect(leer.body).toMatchObject({ fixedCents: null, sharePermille: null, emissionsKg: null, co2CostCents: null, energyKwh: null })
})

test('Zeile der Liste, Auswahl der Lieferungen, Lieferungen einer Heizperiode', () => {
  expect(deliveryLine(gas)).toBe(`15.03.2025–14.03.2026 · ${fmtEuro(311747)} · 5.406,17 kg CO₂ · CO₂-Kosten ${fmtEuro(60000)}`)
  expect(deliveryLine({ ...gas, estimated: true, amountCents: 90774, emissionsKg: null, co2CostCents: null })).toBe(`15.03.2025–14.03.2026 · ${fmtEuro(90774)} · geschätzt, Nachberechnung vorbehalten`)
  const schaetzung = { ...gas, id: 'e', estimated: true }
  expect(deliveryOptions([gas, schaetzung])).toEqual([{ value: '', label: 'keine Lieferung' }, { value: 'd', label: 'Gas 2025/2026' }])
  expect(ownedBy([gas], { from: '2025-05-01', to: '2026-04-30' }).map((d) => d.id)).toEqual(['d'])
  expect(ownedBy([gas], { from: '2024-05-01', to: '2025-04-30' })).toEqual([])
})

test('Gradtagzahlen: Monate des Zeitraums, Formular und Rumpf', () => {
  expect(monthsOf('2025-03-15', '2026-03-14')).toHaveLength(13)
  expect(monthsOf('2025-05-01', '2026-04-30')[0]).toBe('2025-05')
  const form = degreeDaysToForm([{ month: '2025-05', value: 102.5 }], ['2025-05', '2025-06'])
  expect(form).toEqual({ '2025-05': '102,5', '2025-06': '' })
  expect(degreeDaysBody({ ...form, '2025-06': '31' })).toEqual({ body: { values: [{ month: '2025-05', value: 102.5 }, { month: '2025-06', value: 31 }] } })
  expect(degreeDaysBody({ '2025-06': 'viel' })).toEqual({ error: 'Die Gradtagzahl für 06/2025 ist keine Zahl ab 0.' })
})

test('Beschränkungen nach § 9: vier Antworten, „keine“ zuerst', () => {
  expect(RESTRICTION_OPTIONS.map((o) => o.value)).toEqual(['none', 'building', 'supply', 'both'])
})
```

`client/src/components/FuelCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „Lieferungen“ (Heizung PR 7). Geprüft wird, was die Logiktests nicht sehen: Die Auswahl
// der Lieferung an einer Position zeigt die gespeicherte Verknüpfung (CLAUDE.md, Kosten.test.tsx), und
// eine Änderung schickt sie an die Position.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FuelCard from './FuelCard'
import { periodKey } from '../../../shared/period.ts'
import type { FuelDelivery, HeatingPeriodView } from '../types'

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null,
  items: [
    { id: 'gas', description: 'Gas Abschlussrechnung', amountCents: 650000, key: 'area', fuelDeliveryId: 'd' },
    { id: 'wart', description: 'Wartung', amountCents: 20000, key: 'area', fuelDeliveryId: null },
  ],
}
const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
}

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

const auswahl = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl an jeder Position zeigt die gespeicherte Lieferung', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(auswahl('Lieferung zu „Gas Abschlussrechnung“').value).toBe('d')
  expect(auswahl('Lieferung zu „Wartung“').value).toBe('')
  expect(screen.getByText(/15\.03\.2025–14\.03\.2026/)).toBeTruthy()
})

test('Eine Verknüpfung ändern schickt sie an die Position', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.change(auswahl('Lieferung zu „Wartung“'), { target: { value: 'd' } })
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/costItems/wart', method: 'PUT', body: { fuelDeliveryId: 'd' } }))
  fireEvent.change(auswahl('Lieferung zu „Gas Abschlussrechnung“'), { target: { value: '' } })
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/costItems/gas', method: 'PUT', body: { fuelDeliveryId: null } }))
})

test('Beim Messdienst gibt es keine Verknüpfung, aber den Betrag und „vom Messdienst angesetzt“', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'service' }} view={view} deliveries={[{ ...gas, amountCents: 311747 }]} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Lieferung zu „Wartung“')).toBeNull()
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  expect(screen.getByLabelText('Rechnungsbetrag')).toBeTruthy()
  expect(screen.getByLabelText('vom Messdienst angesetzt')).toBeTruthy()
})
```

`client/src/components/Co2FactsCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „CO₂: Angaben zum Gebäude“ (Heizung PR 7): Die Auswahl zu § 9 zeigt den gespeicherten Wert,
// Speichern schickt die Angaben an die Anlage, die Frage zum Emissionshandel nur bei Fernwärme.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2FactsCard from './Co2FactsCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView } from '../types'

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null, items: [],
}
const facts = { id: 'hp', energy: 'gas', method: 'manual', nonResidential: false, restriction: 'supply', districtEtsNew: false } as const

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

test('Die Auswahl zu § 9 zeigt den gespeicherten Wert; Speichern schickt die Angaben an die Anlage', async () => {
  render(<Co2FactsCard plant={facts} view={view} servedAreaM2={600} onSaved={() => {}} />)
  const el = screen.getByLabelText('Beschränkungen (§ 9 CO2KostAufG)')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(el.value).toBe('supply')
  expect(screen.queryByLabelText(/Emissionshandel/)).toBeNull()
  fireEvent.click(screen.getByLabelText('Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)'))
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/heating-plants/hp', method: 'PUT', body: { nonResidential: true, restriction: 'supply', districtEtsNew: false } }))
})

test('Fernwärme: die Frage zum ersten Anschluss nach dem Stichtag aus dem Register', () => {
  render(<Co2FactsCard plant={{ ...facts, energy: 'districtHeating' }} view={view} servedAreaM2={600} onSaved={() => {}} />)
  expect(screen.getByLabelText(/erstmals nach dem 01\.01\.2023 an ein Wärmenetz/)).toBeTruthy()
})

test('Bei freien Schlüsseln die Fläche der Einstufung; leer gilt die Wohnfläche der versorgten Wohnungen', async () => {
  render(<Co2FactsCard plant={facts} view={view} servedAreaM2={600} onSaved={() => {}} />)
  expect(screen.getByText(/Ohne Angabe: 600 m²/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Fläche der Einstufung (m²)'), { target: { value: '612,5' } })
  fireEvent.click(screen.getByText('Fläche speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/heating-plants/hp/periods/2025-05/co2', method: 'PUT', body: { method: 'self', areaM2: 612.5 } }))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- fuelForm FuelCard Co2FactsCard`
Expected: FAIL: `Failed to resolve import "./fuelForm"` bzw. der Komponenten.

- [ ] **Step 3: Logik (`client/src/fuelForm.ts`)**

```ts
// Die Formularlogik der Seite Heizkosten für Lieferungen, Gradtagzahlen des Orts und die CO₂-Angaben
// zum Gebäude (Heizung PR 7), ohne DOM prüfbar. Die Seite rendert nur.
import { fmtEuro, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { formatDayRange } from '../../shared/period.ts'
import type { Co2Restriction, DegreeDayValue, FuelDelivery, HeatingMethod } from './types'

export type FuelForm = {
  label: string
  invoiceFrom: string
  invoiceTo: string
  amount: string
  fixed: string
  sharePercent: string
  emissionsKg: string
  co2Cost: string
  energyKwh: string
  usedByService: boolean
}

export const emptyFuelForm = (): FuelForm => ({
  label: '', invoiceFrom: '', invoiceTo: '', amount: '', fixed: '', sharePercent: '', emissionsKg: '', co2Cost: '', energyKwh: '', usedByService: true,
})

const centsText = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numberText = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false })

export function fuelToForm(d: FuelDelivery): FuelForm {
  return {
    label: d.label,
    invoiceFrom: d.invoiceFrom ?? '',
    invoiceTo: d.invoiceTo ?? '',
    amount: centsText(d.amountCents),
    fixed: centsText(d.fixedCents),
    sharePercent: d.sharePermille === null ? '' : numberText(d.sharePermille / 10),
    emissionsKg: numberText(d.emissionsKg),
    co2Cost: centsText(d.co2CostCents),
    energyKwh: numberText(d.energyKwh),
    usedByService: d.usedByService,
  }
}

// Der Rumpf für POST und PUT. Ein leeres Feld ist `null`, ein unlesbares ein Fehler mit Satz. Den
// Betrag gibt es nur beim Messdienst (bei freien Schlüsseln steht er in den verknüpften Positionen),
// ebenso „vom Messdienst angesetzt“.
export function fuelBody(form: FuelForm, method: HeatingMethod): { body: Record<string, unknown> } | { error: string } {
  if (form.invoiceFrom === '' || form.invoiceTo === '') return { error: 'Bitte geben Sie den Rechnungszeitraum an (Beginn und Ende laut Rechnung).' }
  const euro = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    return c === null ? { error: `${name} ist kein Betrag.` } : c
  }
  const decimal = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    return n === null || n < 0 ? { error: `${name} ist eine Zahl ab 0.` } : n
  }
  const fixed = euro(form.fixed, 'Der feste Preisbestandteil')
  const co2 = euro(form.co2Cost, 'Die CO₂-Kosten')
  const amount = method === 'service' ? euro(form.amount, 'Der Rechnungsbetrag') : null
  const kg = decimal(form.emissionsKg, 'Der CO₂-Ausstoß')
  const kwh = decimal(form.energyKwh, 'Die Energie')
  const share = decimal(form.sharePercent, 'Der eingetragene Anteil')
  for (const v of [fixed, co2, amount, kg, kwh, share]) if (v !== null && typeof v === 'object') return v
  const num = (v: number | null | { error: string }): number | null => (typeof v === 'number' ? v : null)
  const sharePercent = num(share)
  if (sharePercent !== null && sharePercent > 100) return { error: 'Der eingetragene Anteil liegt zwischen 0 und 100 %.' }
  const body: Record<string, unknown> = {
    label: form.label.trim(),
    invoiceFrom: form.invoiceFrom,
    invoiceTo: form.invoiceTo,
    ...(method === 'service' ? { amountCents: num(amount) } : {}),
    fixedCents: num(fixed),
    sharePermille: sharePercent === null ? null : Math.round(sharePercent * 1000) / 100,
    emissionsKg: num(kg),
    co2CostCents: num(co2),
    energyKwh: num(kwh),
    ...(method === 'service' ? { usedByService: form.usedByService } : {}),
  }
  return { body }
}

// Eine Zeile der Liste: Zeitraum, Betrag, Ausstoß und CO₂-Kosten, bei einer Schätzung der Vorbehalt.
export function deliveryLine(d: FuelDelivery): string {
  const parts: string[] = []
  if (d.invoiceFrom && d.invoiceTo) parts.push(formatDayRange(d.invoiceFrom, d.invoiceTo))
  if (d.amountCents !== null) parts.push(fmtEuro(d.amountCents))
  if (d.emissionsKg !== null) parts.push(`${d.emissionsKg.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg CO₂`)
  if (d.co2CostCents !== null) parts.push(`CO₂-Kosten ${fmtEuro(d.co2CostCents)}`)
  if (d.estimated) parts.push('geschätzt, Nachberechnung vorbehalten')
  return parts.join(' · ')
}

// Die Auswahl an einer Position: keine oder eine echte Lieferung. Eine Schätzung hat keine Position.
export function deliveryOptions(deliveries: readonly FuelDelivery[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'keine Lieferung' },
    ...deliveries.filter((d) => !d.estimated).map((d) => ({ value: d.id, label: d.label || (d.invoiceFrom && d.invoiceTo ? formatDayRange(d.invoiceFrom, d.invoiceTo) : 'Lieferung') })),
  ]
}

// Die Lieferungen, die in einer Heizperiode enden: Ihre Positionen stehen dort (Entwurf 5.4).
export function ownedBy(deliveries: readonly FuelDelivery[], view: { from: string; to: string }): FuelDelivery[] {
  return deliveries.filter((d) => d.invoiceTo !== null && d.invoiceTo >= view.from && d.invoiceTo <= view.to)
}

// ---------- Gradtagzahlen des Orts (Stufe 4 in 3.2) ----------

// Die Monate ('JJJJ-MM') von `from` bis `to`, beide eingeschlossen.
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endY = Number(to.slice(0, 4))
  const endM = Number(to.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

export function degreeDaysToForm(values: readonly DegreeDayValue[], months: readonly string[]): Record<string, string> {
  return Object.fromEntries(months.map((month) => {
    const v = values.find((x) => x.month === month)
    return [month, v ? v.value.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : '']
  }))
}

export function degreeDaysBody(form: Record<string, string>): { body: { values: DegreeDayValue[] } } | { error: string } {
  const values: DegreeDayValue[] = []
  for (const [month, text] of Object.entries(form).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (text.trim() === '') continue
    const value = parseDecimal(text)
    if (value === null || value < 0) return { error: `Die Gradtagzahl für ${month.slice(5, 7)}/${month.slice(0, 4)} ist keine Zahl ab 0.` }
    values.push({ month, value })
  }
  return { body: { values } }
}

// ---------- CO₂: Angaben zum Gebäude (§ 8, § 9, § 2 Abs. 4 CO2KostAufG) ----------

export const RESTRICTION_OPTIONS: readonly { value: Co2Restriction; label: string }[] = [
  { value: 'none', label: 'Keine' },
  { value: 'building', label: 'Vorgaben stehen einer wesentlichen energetischen Verbesserung des Gebäudes entgegen (etwa Denkmalschutz)' },
  { value: 'supply', label: 'Vorgaben stehen einer wesentlichen Verbesserung der Wärme- und Warmwasserversorgung entgegen' },
  { value: 'both', label: 'Vorgaben stehen beidem entgegen' },
]
```

`Co2Restriction`, `DegreeDayValue` und `FuelDelivery` reicht `client/src/types.ts` über `export type *`
aus `shared/types.ts` weiter (Task 2).

- [ ] **Step 4: Komponenten**

`client/src/components/FuelCard.tsx`:

```tsx
// Die Karte „Lieferungen“ einer Heizperiode (Heizung PR 7, Entwurf 3.2, 5.4, 11.4): die Rechnungen des
// Versorgers, die in dieser Heizperiode enden, und bei freien Schlüsseln die Verknüpfung der Positionen.
// Mietfuchs teilt jede Rechnung auf die Heizperioden auf; die Abrechnung zeigt, wie.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { deliveryLine, deliveryOptions, emptyFuelForm, fuelBody, fuelToForm, type FuelForm } from '../fuelForm'
import type { FuelDelivery, HeatingMethod, HeatingPeriodView } from '../types'

type TextKey = Exclude<keyof FuelForm, 'usedByService'>

export default function FuelCard({ plant, view, deliveries, onSaved }: {
  plant: { id: string; method: HeatingMethod }
  view: HeatingPeriodView
  deliveries: FuelDelivery[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FuelForm>(emptyFuelForm)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const service = plant.method === 'service'
  const set = <K extends keyof FuelForm>(key: K, value: FuelForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const options = deliveryOptions(deliveries)

  function open(d: FuelDelivery | null) {
    setForm(d ? fuelToForm(d) : emptyFuelForm())
    setEditing(d ? d.id : 'neu')
    setError('')
  }

  async function save() {
    const r = fuelBody(form, plant.method)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      if (editing === 'neu') await api(`/api/heating-plants/${plant.id}/deliveries`, { method: 'POST', body: JSON.stringify(r.body) })
      else await api(`/api/fuel-deliveries/${editing}`, { method: 'PUT', body: JSON.stringify(r.body) })
      setEditing(null)
      setError('')
      toast('Lieferung gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(d: FuelDelivery) {
    const ok = await confirm({
      title: 'Lieferung entfernen?',
      message: d.estimated ? 'Die Schätzung entfällt; die Abrechnung rechnet ohne sie.' : 'Verknüpfte Positionen bleiben stehen und werden dann ohne Abgrenzung verteilt.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })
      toast('Lieferung entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function link(itemId: string, deliveryId: string) {
    try {
      await api(`/api/costItems/${itemId}`, { method: 'PUT', body: JSON.stringify({ fuelDeliveryId: deliveryId === '' ? null : deliveryId }) })
      setError('')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const text = (key: TextKey, label: string, mode: 'decimal' | 'text' = 'decimal') => (
    <label className="field">
      {label}
      <input value={form[key]} inputMode={mode === 'decimal' ? 'decimal' : undefined} type={key === 'invoiceFrom' || key === 'invoiceTo' ? 'date' : 'text'} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2>Lieferungen <Term id="accrualPrinciple" /></h2>
      <p className="muted">
        Tragen Sie jede Rechnung Ihres Versorgers mit ihrem Rechnungszeitraum ein. Reicht sie über die Heizperiode hinaus, teilt Mietfuchs sie
        auf: nach einem Zählerstand zum Stichtag, nach Teilmengen der Rechnung oder nach Gradtagen <Term id="degreeDays" />.
      </p>
      {deliveries.length === 0 && <p className="muted">Noch keine Lieferung, die in dieser Heizperiode endet.</p>}
      <ul className="plain">
        {deliveries.map((d) => (
          <li key={d.id}>
            <strong>{d.label || 'Lieferung'}</strong> {deliveryLine(d)}
            {!view.closed && (
              <span className="row">
                <button className="btn secondary" onClick={() => open(d)}>Ändern</button>
                <button className="btn secondary" onClick={() => void remove(d)}>Entfernen</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {!service && view.items.length > 0 && (
        <div className="field-group">
          <div className="field-group-label">Welche Position gehört zu welcher Rechnung? Abschläge, Schlussrechnung und Gutschrift einer Rechnung gehören zur selben Lieferung.</div>
          {view.items.map((i) => (
            <label className="field" key={i.id}>
              {i.description}
              <select aria-label={`Lieferung zu „${i.description}“`} value={i.fuelDeliveryId ?? ''} disabled={view.closed} onChange={(e) => void link(i.id, options.find((o) => o.value === e.target.value)?.value ?? '')}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {editing !== null && (
        <div className="field-group">
          {text('label', 'Bezeichnung', 'text')}
          <div className="row">
            {text('invoiceFrom', 'Rechnungszeitraum von')}
            {text('invoiceTo', 'bis')}
          </div>
          <div className="row">
            {service && text('amount', 'Rechnungsbetrag')}
            {text('fixed', 'davon fester Preisbestandteil (Grund-, Mess-, Verrechnungspreis)')}
            {text('energyKwh', 'Energie (kWh)')}
          </div>
          <div className="row">
            {text('emissionsKg', 'CO₂-Ausstoß laut Rechnung (kg)')}
            {text('co2Cost', 'CO₂-Kosten laut Rechnung')}
          </div>
          <details>
            <summary>Weitere Angaben</summary>
            {text('sharePercent', 'Anteil dieser Heizperiode am Verbrauch (%), wenn bekannt')}
          </details>
          {service && (
            <label className="field">
              <input type="checkbox" checked={form.usedByService} onChange={(e) => set('usedByService', e.target.checked)} />
              vom Messdienst angesetzt
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => void save()}>Lieferung speichern</button>
            <button className="btn secondary" onClick={() => setEditing(null)}>Abbrechen</button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && editing === null && <button className="btn" onClick={() => open(null)}>Lieferung eintragen</button>}
    </div>
  )
}
```

Hinweis zur Beschriftung des Betrags im Test: `getByLabelText('Rechnungsbetrag')` findet das Feld über
das umschließende `<label>`; das Kontrollkästchen „vom Messdienst angesetzt“ ebenso.

`client/src/components/DegreeDaysCard.tsx`:

```tsx
// Die Karte „Gradtagzahlen Ihres Orts“ (Heizung PR 7, Stufe 4 in 3.2): die Monatswerte des Deutschen
// Wetterdienstes für den Ort des Objekts. Fehlt ein Monat, rechnet Mietfuchs mit der Tabelle der
// Heizkostenverordnung.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { degreeDaysBody, degreeDaysToForm } from '../fuelForm'
import type { DegreeDayValue } from '../types'

export default function DegreeDaysCard({ propertyId, months, values, onSaved }: { propertyId: string; months: string[]; values: DegreeDayValue[]; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => degreeDaysToForm(values, months))
  const [error, setError] = useState('')
  const toast = useToast()

  async function save() {
    const r = degreeDaysBody(form)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api(`/api/properties/${propertyId}/degree-days`, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('Gradtagzahlen gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Gradtagzahlen Ihres Orts <Term id="degreeDays" /></h2>
      <p className="muted">
        Freiwillig. Mit den Monatswerten des Deutschen Wetterdienstes für Ihren Ort teilt Mietfuchs eine Rechnung genauer auf als mit der
        Tabelle der Heizkostenverordnung. Ein Zählerstand zum Stichtag ist noch genauer.
      </p>
      <div className="row wrap">
        {months.map((m) => (
          <label className="field" key={m}>
            {`${m.slice(5, 7)}/${m.slice(0, 4)}`}
            <input value={form[m] ?? ''} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, [m]: e.target.value }))} />
          </label>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn" onClick={() => void save()}>Gradtagzahlen speichern</button>
    </div>
  )
}
```

`client/src/components/Co2FactsCard.tsx`:

```tsx
// Die Karte „CO₂: Angaben zum Gebäude“ (Heizung PR 7, Entwurf 9.1, 9.2): § 8 (Nichtwohngebäude), § 9
// (Beschränkungen) und § 2 Abs. 4 Satz 2 CO2KostAufG (Wärme aus dem Emissionshandel), gespeichert an der
// Anlage. Bei freien Schlüsseln dazu die Fläche der Einstufung je Heizperiode, wenn sie von der
// Wohnfläche der versorgten Wohnungen abweicht.
import { useState } from 'react'
import { api, errorText } from '../api'
import { parseDecimal } from '../co2Form'
import { useToast } from './feedback'
import Term from './Term'
import { RESTRICTION_OPTIONS } from '../fuelForm'
import { co2DistrictEtsNew } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, onlyVersion } from '../../../shared/law/register.ts'
import type { Co2Restriction, HeatingEnergy, HeatingMethod, HeatingPeriodView } from '../types'

type Facts = { id: string; energy: HeatingEnergy; method: HeatingMethod; nonResidential: boolean; restriction: Co2Restriction; districtEtsNew: boolean }

export default function Co2FactsCard({ plant, view, servedAreaM2, onSaved }: { plant: Facts; view: HeatingPeriodView; servedAreaM2: number; onSaved: () => void }) {
  const [nonResidential, setNonResidential] = useState(plant.nonResidential)
  const [restriction, setRestriction] = useState<Co2Restriction>(plant.restriction)
  const [districtEtsNew, setDistrictEtsNew] = useState(plant.districtEtsNew)
  const [area, setArea] = useState(view.co2?.areaM2 == null ? '' : view.co2.areaM2.toLocaleString('de-DE', { useGrouping: false }))
  const [error, setError] = useState('')
  const toast = useToast()
  const stichtag = germanDate(onlyVersion(co2DistrictEtsNew).value.connectedAfter)

  async function saveFacts() {
    try {
      await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ nonResidential, restriction, districtEtsNew }) })
      setError('')
      toast('Angaben zum Gebäude gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveArea() {
    const url = `/api/heating-plants/${plant.id}/periods/${view.period}/co2`
    const value = parseDecimal(area)
    if (area.trim() !== '' && (value === null || value <= 0)) {
      setError('Die Fläche ist eine Zahl über 0.')
      return
    }
    try {
      if (value === null) await api(url, { method: 'DELETE' })
      else await api(url, { method: 'PUT', body: JSON.stringify({ method: 'self', areaM2: value }) })
      setError('')
      toast('Fläche gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>CO₂: Angaben zum Gebäude <Term id="co2Stage" /></h2>
      <p className="muted">Gilt für alle Heizperioden dieser Anlage.</p>
      <label className="field">
        <input type="checkbox" checked={nonResidential} disabled={view.closed} onChange={(e) => setNonResidential(e.target.checked)} />
        Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)
      </label>
      <label className="field">
        Beschränkungen (§ 9 CO2KostAufG)
        <select aria-label="Beschränkungen (§ 9 CO2KostAufG)" value={restriction} disabled={view.closed} onChange={(e) => setRestriction(RESTRICTION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'none')}>
          {RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {restriction !== 'none' && <p className="notice">Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG).</p>}
      {plant.energy === 'districtHeating' && (
        <label className="field">
          <input type="checkbox" checked={districtEtsNew} disabled={view.closed} onChange={(e) => setDistrictEtsNew(e.target.checked)} />
          {`Das Gebäude wurde erstmals nach dem ${stichtag} an ein Wärmenetz angeschlossen, dessen Wärme aus dem Emissionshandel stammt (§ 2 Abs. 4 Satz 2 CO2KostAufG)`}
        </label>
      )}
      {!view.closed && <button className="btn" onClick={() => void saveFacts()}>Angaben speichern</button>}
      {plant.method === 'manual' && (
        <div className="field-group">
          <label className="field">
            Fläche der Einstufung (m²)
            <input value={area} inputMode="decimal" disabled={view.closed} onChange={(e) => setArea(e.target.value)} />
          </label>
          <p className="muted">{`Ohne Angabe: ${servedAreaM2.toLocaleString('de-DE')} m², die Wohnfläche der versorgten Wohnungen. Weist die Abrechnung eine andere Fläche aus, tragen Sie diese ein.`}</p>
          {!view.closed && <button className="btn secondary" onClick={() => void saveArea()}>Fläche speichern</button>}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
```

`onlyVersion` und `germanDate` stehen in `shared/law/register.ts` (PR 1); `co2DistrictEtsNew` hat genau
eine Fassung (Task 1).

- [ ] **Step 5: Seite (`client/src/pages/Heizkosten.tsx`)**

Die Datei ersetzen:

```tsx
// Die Seite „Heizkosten“ (Heizung PR 6 und 7, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“ (beim Messdienst), „Lieferungen“ und „CO₂: Angaben
// zum Gebäude“, dazu einmal „Gradtagzahlen Ihres Orts“. Sie steht erst ab einer Heizanlage in der
// Navigation (`navFor`).
import { useCallback, useEffect, useState } from 'react'
import type { DegreeDayValue, FuelDelivery, HeatingPeriodView, HeatingPlant, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import Co2FactsCard from '../components/Co2FactsCard'
import DegreeDaysCard from '../components/DegreeDaysCard'
import FuelCard from '../components/FuelCard'
import HotWaterCard from '../components/HotWaterCard'
import { monthsOf, ownedBy } from '../fuelForm'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../../shared/law/register.ts'

type Loaded = { plants: HeatingPlant[]; views: Record<string, HeatingPeriodView[]>; deliveries: Record<string, FuelDelivery[]>; degreeDays: DegreeDayValue[] }

export default function Heizkosten({ units, tenancies }: { units: Unit[]; tenancies: Tenancy[] }) {
  const { property } = useProperty()
  const period = usePeriod()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const plants = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const views = await Promise.all(plants.map((p) => api<HeatingPeriodView[]>(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`)))
      const deliveries = await Promise.all(plants.map((p) => api<FuelDelivery[]>(`/api/heating-plants/${p.id}/deliveries`)))
      const degreeDays = property ? await api<DegreeDayValue[]>(`/api/properties/${property.id}/degree-days`) : []
      setData({
        plants,
        views: Object.fromEntries(plants.map((p, i) => [p.id, views[i] ?? []])),
        deliveries: Object.fromEntries(plants.map((p, i) => [p.id, deliveries[i] ?? []])),
        degreeDays,
      })
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [property, period.param])
  useEffect(() => { void load() }, [load])
  const first = co2FirstPeriodStart()
  // Die Monate, die die Lieferungen überdecken: Für sie fragt die Karte „Gradtagzahlen Ihres Orts“.
  const all = Object.values(data?.deliveries ?? {}).flat().filter((d) => d.invoiceFrom !== null && d.invoiceTo !== null)
  const from = all.reduce<string | null>((a, d) => (a === null || (d.invoiceFrom ?? a) < a ? d.invoiceFrom : a), null)
  const to = all.reduce<string | null>((a, d) => (a === null || (d.invoiceTo ?? a) > a ? d.invoiceTo : a), null)
  const servedArea = (plant: HeatingPlant): number =>
    units.filter((u) => (plant.units === null || plant.units.some((x) => x.unitId === u.id)) && !(u.noConnection ?? []).includes('waerme')).reduce((a, u) => a + (u.areaM2 || 0), 0)

  return (
    <div>
      <PageHeader title={`Heizkosten ${period.label}`} />
      {error && <div className="error">{error}</div>}
      {data !== null && data.plants.length === 0 && (
        <div className="card"><p>Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.</p></div>
      )}
      {(data?.plants ?? []).map((plant) => (
        <div key={plant.id}>
          {plant.method === 'self' ? (
            <div className="card"><p>Die eigene Heizkostenabrechnung kommt mit einer späteren Version.</p></div>
          ) : (
            (data?.views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2>{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {plant.method === 'service' && (v.from >= first ? (
                  <Co2Card view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                ))}
                {plant.method === 'service' && <HotWaterCard view={v} onSaved={() => void load()} />}
                <FuelCard plant={plant} view={v} deliveries={ownedBy(data?.deliveries[plant.id] ?? [], v)} onSaved={() => void load()} />
                {v.from >= first && <Co2FactsCard plant={plant} view={v} servedAreaM2={servedArea(plant)} onSaved={() => void load()} />}
              </div>
            ))
          )}
        </div>
      ))}
      {property && from !== null && to !== null && data !== null && (
        <DegreeDaysCard key={`${from}-${to}`} propertyId={property.id} months={monthsOf(from, to)} values={data.degreeDays} onSaved={() => void load()} />
      )}
    </div>
  )
}
```

Hinweise: `servedArea` ist dieselbe Regel wie `servesUnit` in `shared/heatingPeriod.ts` (PR 5); steht
dort eine exportierte Funktion, die der Client laden darf, diese nehmen statt der Zeile. `'waerme'`
ist der Zählertyp der Wärme (`MeterType`). Mit `FuelCard` je Heizperiode bleibt die Karte bei einem
Wechsel des Zeitraums an der richtigen Stelle; eine Lieferung erscheint in der Heizperiode, in der sie
endet.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- fuelForm FuelCard Co2FactsCard Co2Card && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/fuelForm.ts client/src/fuelForm.test.ts client/src/components/FuelCard.tsx client/src/components/FuelCard.test.tsx client/src/components/DegreeDaysCard.tsx client/src/components/Co2FactsCard.tsx client/src/components/Co2FactsCard.test.tsx client/src/pages/Heizkosten.tsx
git commit -m "Seite Heizkosten: Lieferungen, Gradtagzahlen des Orts, CO₂-Angaben zum Gebäude

Bei freien Schlüsseln verknüpft der Vermieter die Positionen mit ihrer Rechnung; beim
Messdienst trägt er den Betrag und „vom Messdienst angesetzt“ ein.

Refs #97"
```

---
### Task 12: Rückfrage beim Abschluss, Druckblock „Brennstoff“, Ausweis der eigenen Aufteilung

Beim Abschließen fragt die Oberfläche bei einer Lücke nach (Dialog „Trotzdem abschließen?“, Vorgabe
Schätzung; 8.2, N1). Die Abrechnung druckt je Heizperiode mit Lieferungen den Block „Brennstoff“
(Lieferungen mit Anteil und Verfahren, Ausstoß umgerechnet, Abdeckung, Vorbehalt der Schätzung; 9.5,
10.1 `fuel.estimated`), und der Druckblock „CO₂-Kostenaufteilung“ (PR 6) weist die eigene Aufteilung
aus: berechnet aus den Rechnungen, Fläche und ihre Herkunft, § 8 und § 9.

**Files:**
- Create: `client/src/fuelClose.ts`, `client/src/fuelView.ts`, `client/src/components/FuelBlock.tsx`
- Modify: `client/src/co2View.ts`, `client/src/pages/Abrechnung.tsx`
- Test: `client/src/fuelClose.test.ts` (neu), `client/src/fuelView.test.ts` (neu), `client/src/co2View.test.ts`

**Interfaces:**
- Consumes (Task 2, 8, 9; PR 2, 6): `FuelGapQuestion`, `HeatingStatement` (`fuel`, `co2.basis`, `co2.coveragePermille`, `co2.adjustments`, `co2.areaSource`), `FuelMethod`; `ApiError`, `api`, `fmtEuro`, `fmtDate`; `formatDayRange`; `useConfirm` (`title`, `message`, `confirmLabel`, `cancelLabel`); in Abrechnung.tsx `closeSettlement()`, `attempt`, `withProperty`, `Co2Block`.
- Produces:
  - `fuelClose.ts`: `type FuelQuestion = { title: string; message: string; confirmLabel: string; cancelLabel: string }`, `fuelGapsOf(e: unknown): FuelGapQuestion[] | null`, `estimateQuestion(gaps)`, `withoutEstimateQuestion(gaps)`, `closeWithFuelQuestion(post, ask): Promise<boolean>`
  - `fuelView.ts`: `type FuelBlockView = { title: string; rows: { label: string; value: string }[]; notes: string[] }`, `FUEL_METHOD_LABELS`, `fuelBlock(h: HeatingStatement): FuelBlockView | null`; Komponente `FuelBlock({ view })`

- [ ] **Step 1: Write the failing tests**

`client/src/fuelClose.test.ts`:

```ts
import { expect, test } from 'vitest'
import { ApiError, fmtEuro } from './api'
import { closeWithFuelQuestion, estimateQuestion, fuelGapsOf, withoutEstimateQuestion } from './fuelClose'
import { periodKey } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

const luecke: FuelGapQuestion = { plantId: 'hp', plantName: 'Gas', period: periodKey('2025-05'), from: '2026-03-15', to: '2026-04-30', amountCents: 90774 }
const abgelehnt = new ApiError('Für einen Teil der Heizperiode fehlt eine Rechnung.', 409, { fuelGaps: [luecke] })

test('Lücken aus der Antwort 409 lesen; jede andere Ablehnung ist keine Rückfrage', () => {
  expect(fuelGapsOf(abgelehnt)).toEqual([luecke])
  expect(fuelGapsOf(new ApiError('bereits abgeschlossen', 409, {}))).toBeNull()
  expect(fuelGapsOf(new Error('Netz weg'))).toBeNull()
  expect(fuelGapsOf(new ApiError('x', 409, { fuelGaps: [{ plantId: 1 }] }))).toEqual([])
})

test('Dialog: Vorgabe ist die Schätzung; ohne sie nennt er den Betrag, den der Vermieter trägt', () => {
  const q = estimateQuestion([luecke])
  expect(q).toMatchObject({ title: 'Trotzdem abschließen?', confirmLabel: 'Mit Schätzung abschließen', cancelLabel: 'Nicht schätzen' })
  expect(q.message).toContain(`Gas: 15.03.–30.04.2026 (${fmtEuro(90774)})`)
  expect(q.message).toContain('mit Vorbehalt')
  const ohne = withoutEstimateQuestion([luecke])
  expect(ohne).toMatchObject({ title: 'Ohne Schätzung abschließen?', confirmLabel: 'Ohne Schätzung abschließen', cancelLabel: 'Abbrechen' })
  expect(ohne.message).toContain(`tragen Sie ${fmtEuro(90774)} selbst`)
})

test('Ablauf: ohne Lücke einmal; mit Lücke Schätzung, ohne Schätzung oder Abbruch', async () => {
  const lauf = async (antworten: boolean[], ersteAntwort: 'ok' | 'luecke') => {
    const bodies: Record<string, unknown>[] = []
    const post = async (body: Record<string, unknown>) => {
      bodies.push(body)
      if (bodies.length === 1 && ersteAntwort === 'luecke') throw abgelehnt
    }
    const fragen = [...antworten]
    const ok = await closeWithFuelQuestion(post, async () => fragen.shift() ?? false)
    return { ok, bodies }
  }
  expect(await lauf([], 'ok')).toEqual({ ok: true, bodies: [{}] })
  expect(await lauf([true], 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'estimate' }] })
  expect(await lauf([false, true], 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'none' }] })
  expect(await lauf([false, false], 'luecke')).toEqual({ ok: false, bodies: [{}] })
  await expect(closeWithFuelQuestion(async () => { throw new Error('Netz weg') }, async () => true)).rejects.toThrow('Netz weg')
})
```

`client/src/fuelView.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { fuelBlock } from './fuelView'
import { periodKey } from '../../shared/period.ts'
import type { FuelAssessment, HeatingStatement } from './types'

const assert = { fail: (text: string): never => { throw new Error(text) } }
const brennstoff: FuelAssessment = {
  coveragePermille: 848.71, emissionsKg: 5406.17, co2Cents: 50923,
  deliveries: [
    { deliveryId: 'd', label: 'Gas 2025/2026', from: '2025-03-15', to: '2026-03-14', estimated: false, method: 'degreeDays', sharePermille: 848.71, fixedKnown: false, split: true, amountCents: 650000, inPeriodCents: 551661, emissionsKg: 4588.3, co2Cents: 50923 },
    { deliveryId: 'e', label: 'Schätzung 15.03.–30.04.2026', from: '2026-03-15', to: '2026-04-30', estimated: true, method: 'inside', sharePermille: 1000, fixedKnown: true, split: false, amountCents: 90774, inPeriodCents: 90774, emissionsKg: null, co2Cents: null },
  ],
  carries: [{ deliveryId: 'd', period: periodKey('2024-05'), cents: -98339 }],
  gaps: [],
}
const anlage = (fuel?: FuelAssessment): HeatingStatement => ({
  plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-05'), from: '2025-05-01', to: '2026-04-30', co2: null, ...(fuel ? { fuel } : {}),
})

test('Druckblock Brennstoff: je Rechnung Anteil, Verfahren und Teil der Heizperiode; Ausstoß umgerechnet; Vorbehalt der Schätzung', () => {
  const v = fuelBlock(anlage(brennstoff)) ?? assert.fail('kein Block')
  expect(v.title).toBe('Brennstoff Gas, Heizperiode 01.05.2025 – 30.04.2026')
  expect(v.rows[0]).toEqual({ label: 'Gas 2025/2026 (15.03.2025–14.03.2026)', value: `848,71 ‰ nach der Gradtagszahlentabelle = ${fmtEuro(551661)} von ${fmtEuro(650000)}, 4.588,3 kg CO₂` })
  expect(v.rows[1]).toEqual({ label: 'Schätzung 15.03.–30.04.2026 (15.03.–30.04.2026)', value: `geschätzt, ${fmtEuro(90774)}` })
  expect(v.rows.at(-1)).toEqual({ label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: '5.406,2 kg (die Rechnungen decken 848,7 ‰ der Gradtage ab)' })
  expect(v.notes).toEqual(['Die Brennstoffkosten vom 15.03.2026 bis 30.04.2026 sind geschätzt, weil die Rechnung des Versorgers noch nicht vorlag. Eine Nachberechnung bleibt vorbehalten.'])
})

test('Kein Block ohne Lieferungen; eine Lücke steht als Hinweis', () => {
  expect(fuelBlock(anlage())).toBeNull()
  expect(fuelBlock(anlage({ ...brennstoff, deliveries: [], carries: [] }))).toBeNull()
  const luecke = fuelBlock(anlage({ ...brennstoff, deliveries: brennstoff.deliveries.slice(0, 1), gaps: [{ from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29, estimate: null }] })) ?? assert.fail('kein Block')
  expect(luecke.notes).toEqual(['Für 15.03.–30.04.2026 lag keine Rechnung vor.'])
})
```

An `client/src/co2View.test.ts` (PR 6) anhängen:

```ts
test('Eigene Aufteilung: berechnet aus den Rechnungen, Ausstoß umgerechnet, Fläche mit Herkunft, § 8 und § 9', () => {
  const eigen = bewertung({
    method: 'self', deducted: false, basis: 'deliveries', coveragePermille: 848.71, emissionsKg: 24105.6, areaM2: 600, areaSource: 'served',
    kgPerM2: 40.2, landlordPermille: 300, totalCents: 77379, landlordCents: 23214, stage: { from: 37, to: 42, landlordPercent: 60 },
    adjustments: ['restrictionHalf'], tenants: [{ tenancyId: 'ta', landlordCents: 11607, tenantCents: 27083, approximated: false }],
  })
  const v = co2Block(anlage(eigen), 'ta') ?? assert.fail('kein Block')
  expect(v.lines.find((l) => l.label === 'CO₂-Ausstoß, umgerechnet auf die Heizperiode')?.value).toBe('24.105,6 kg (die Rechnungen decken 848,7 ‰ der Gradtage ab)')
  expect(v.lines.find((l) => l.label === 'Wohnfläche der Einstufung')?.value).toBe('600 m² (versorgte Wohnungen)')
  expect(v.lines.find((l) => l.label === 'Anteil des Vermieters')?.value).toBe('30 %')
  expect(v.lines.at(-1)).toEqual({ label: 'vom Vermieter übernommen (eigene Zeile)', value: `${fmtEuro(11607)} (nach Ihrem Anteil an den Brennstoffkosten)` })
  expect(v.notes).toEqual([
    'Berechnet von Mietfuchs aus den Rechnungen des Versorgers (§ 7 Abs. 3 CO2KostAufG); der Ausstoß ist auf die Heizperiode umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG).',
    'Der Anteil des Vermieters ist wegen öffentlich-rechtlicher Vorgaben um die Hälfte gekürzt (§ 9 Abs. 1 CO2KostAufG).',
  ])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- fuelClose fuelView co2View`
Expected: FAIL: `Failed to resolve import "./fuelClose"` bzw. `"./fuelView"`; in co2View.test.ts fehlen die
neuen Beschriftungen.

- [ ] **Step 3: Rückfrage (`client/src/fuelClose.ts`)**

```ts
// Die Rückfrage beim Abschließen (Heizung PR 7, Entwurf 8.2, N1): Fehlt für einen Teil der Heizperiode
// eine Rechnung, antwortet der Server mit 409 und den Lücken. Vorgabe ist die Schätzung mit Vorbehalt;
// lehnt der Vermieter ab, fragt ein zweiter Dialog, ob er ohne Schätzung abschließt und den Teil selbst
// trägt. Ohne DOM prüfbar; die Seite reicht `api` und `confirm` herein.
import { ApiError, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

export type FuelQuestion = { title: string; message: string; confirmLabel: string; cancelLabel: string }

const isGap = (g: unknown): g is FuelGapQuestion =>
  g !== null && typeof g === 'object' &&
  'plantId' in g && typeof g.plantId === 'string' && 'plantName' in g && typeof g.plantName === 'string' &&
  'period' in g && typeof g.period === 'string' && 'from' in g && typeof g.from === 'string' &&
  'to' in g && typeof g.to === 'string' && 'amountCents' in g && typeof g.amountCents === 'number'

// Die Lücken aus einer Ablehnung, `null` bei jeder anderen.
export function fuelGapsOf(e: unknown): FuelGapQuestion[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !Array.isArray(e.data.fuelGaps)) return null
  const list: unknown[] = e.data.fuelGaps
  return list.filter(isGap)
}

const listOf = (gaps: readonly FuelGapQuestion[]): string =>
  gaps.map((g) => `${g.plantName || 'Heizanlage'}: ${formatDayRange(g.from, g.to)} (${fmtEuro(g.amountCents)})`).join('; ')
const totalOf = (gaps: readonly FuelGapQuestion[]): number => gaps.reduce((a, g) => a + g.amountCents, 0)

export function estimateQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  return {
    title: 'Trotzdem abschließen?',
    message:
      `Für einen Teil der Heizperiode fehlt die Rechnung des Versorgers: ${listOf(gaps)}. Mietfuchs schätzt diese Kosten aus der letzten Rechnung ` +
      'und weist sie in der Abrechnung mit Vorbehalt aus. Kommt die Rechnung, zählt die Schätzung nicht mehr; eine Differenz steht bei Ihnen, ' +
      'und solange die Frist läuft, können Sie mit einer berichtigten Abrechnung nachfordern.',
    confirmLabel: 'Mit Schätzung abschließen',
    cancelLabel: 'Nicht schätzen',
  }
}

export function withoutEstimateQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  return {
    title: 'Ohne Schätzung abschließen?',
    message:
      `Ohne Schätzung tragen Sie ${fmtEuro(totalOf(gaps))} selbst, auch wenn die Rechnung später kommt: Ihr Teil für diese Heizperiode gehört dann ` +
      'in eine abgeschlossene Abrechnung. Solange deren Frist läuft, können Sie sie wieder öffnen.',
    confirmLabel: 'Ohne Schätzung abschließen',
    cancelLabel: 'Abbrechen',
  }
}

// Schließt ab und fragt bei einer Lücke nach. `true`, wenn abgeschlossen ist; `false` nach Abbruch.
// Jede andere Ablehnung geht unverändert an den Aufrufer.
export async function closeWithFuelQuestion(
  post: (body: Record<string, unknown>) => Promise<unknown>,
  ask: (q: FuelQuestion) => Promise<boolean>,
): Promise<boolean> {
  try {
    await post({})
    return true
  } catch (e) {
    const gaps = fuelGapsOf(e)
    if (gaps === null) throw e
    if (await ask(estimateQuestion(gaps))) {
      await post({ fuelEstimates: 'estimate' })
      return true
    }
    if (await ask(withoutEstimateQuestion(gaps))) {
      await post({ fuelEstimates: 'none' })
      return true
    }
    return false
  }
}
```

- [ ] **Step 4: Druckblock Brennstoff (`client/src/fuelView.ts`, `client/src/components/FuelBlock.tsx`)**

`client/src/fuelView.ts`:

```ts
// Der Druckblock „Brennstoff“ (Heizung PR 7, Entwurf 9.5, 10.1): je Rechnung ihr Anteil an der
// Heizperiode mit dem Verfahren, der Ausstoß umgerechnet und die Abdeckung, dazu der Vorbehalt einer
// Schätzung. Er wird mitgedruckt: Er erklärt die Zeilen „Anteil … aus der Rechnung …“ und ist Teil der
// Berechnungsgrundlagen nach § 7 Abs. 3 CO2KostAufG.
import { fmtDate, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelMethod, HeatingStatement } from './types'

export type FuelBlockView = { title: string; rows: { label: string; value: string }[]; notes: string[] }

export const FUEL_METHOD_LABELS: Record<FuelMethod, string> = {
  entered: 'eingetragener Anteil',
  measured: 'nach Zählerstand',
  inside: 'ganz in der Heizperiode',
  parts: 'nach Teilmengen laut Rechnung',
  localDegreeDays: 'nach den Gradtagzahlen des Orts',
  degreeDays: 'nach der Gradtagszahlentabelle',
}

const num = (n: number, digits: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

export function fuelBlock(h: HeatingStatement): FuelBlockView | null {
  const f = h.fuel
  if (!f || (f.deliveries.length === 0 && f.carries.length === 0)) return null
  const rows = f.deliveries.map((d) => {
    const range = d.from && d.to ? ` (${formatDayRange(d.from, d.to)})` : ''
    const label = `${d.label || 'Lieferung'}${range}`
    if (d.estimated) return { label, value: `geschätzt, ${fmtEuro(d.inPeriodCents ?? d.amountCents ?? 0)}` }
    const amount = d.inPeriodCents !== null && d.amountCents !== null ? ` = ${fmtEuro(d.inPeriodCents)} von ${fmtEuro(d.amountCents)}` : ''
    const kg = d.emissionsKg !== null ? `, ${num(d.emissionsKg, 1)} kg CO₂` : ''
    return { label, value: `${num(d.sharePermille, 2)} ‰ ${FUEL_METHOD_LABELS[d.method]}${amount}${kg}` }
  })
  if (f.emissionsKg !== null) {
    rows.push({ label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: `${num(f.emissionsKg, 1)} kg (die Rechnungen decken ${num(f.coveragePermille, 1)} ‰ der Gradtage ab)` })
  }
  const notes = [
    ...f.deliveries.filter((d) => d.estimated && d.from && d.to).map((d) =>
      `Die Brennstoffkosten vom ${fmtDate(d.from ?? '')} bis ${fmtDate(d.to ?? '')} sind geschätzt, weil die Rechnung des Versorgers noch nicht vorlag. Eine Nachberechnung bleibt vorbehalten.`),
    ...f.gaps.map((g) => `Für ${formatDayRange(g.from, g.to)} lag keine Rechnung vor.`),
  ]
  return { title: `Brennstoff ${h.plantName || 'Heizanlage'}, Heizperiode ${fmtDate(h.from)} – ${fmtDate(h.to)}`, rows, notes }
}
```

`client/src/components/FuelBlock.tsx`:

```tsx
// Der Druckblock „Brennstoff“ in der Abrechnung eines Mieters (Heizung PR 7). Gedruckt wird er mit.
import type { FuelBlockView } from '../fuelView'

export default function FuelBlock({ view }: { view: FuelBlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <table>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.label}><td>{r.label}</td><td className="num">{r.value}</td></tr>
          ))}
        </tbody>
      </table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
```

- [ ] **Step 5: Ausweis der eigenen Aufteilung (`client/src/co2View.ts`)**

`co2Block` ersetzen:

```ts
// `null`: kein Block, weil nichts gebucht ist (Probe gescheitert, nicht aufgeteilt) oder der Mieter
// in dieser Heizperiode keine Heizkosten hat. Bei der eigenen Aufteilung (Heizung PR 7, `basis:
// 'deliveries'`) stehen die Werte, wie Mietfuchs sie aus den Rechnungen gerechnet hat.
export function co2Block(h: HeatingStatement, tenancyId: string): Co2BlockView | null {
  const c = h.co2
  if (!c || !c.booked) return null
  const tenant = c.tenants.find((t) => t.tenancyId === tenancyId)
  if (!tenant) return null
  const own = c.basis === 'deliveries'
  const lines: { label: string; value: string }[] = [
    { label: 'Energieträger', value: ENERGY_OPTIONS.find((o) => o.value === h.energy)?.label ?? h.energy },
    { label: 'Heizperiode', value: `${fmtDate(h.from)} – ${fmtDate(h.to)}` },
  ]
  if (c.emissionsKg !== null) {
    lines.push(own
      ? { label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: `${num(c.emissionsKg)} kg${c.coveragePermille != null && c.coveragePermille < 1000 ? ` (die Rechnungen decken ${num(c.coveragePermille)} ‰ der Gradtage ab)` : ''}` }
      : { label: 'CO₂-Ausstoß', value: `${num(c.emissionsKg)} kg` })
  }
  if (c.areaM2 !== null) {
    const source = own ? (c.areaSource === 'entered' ? ' (eingetragen)' : ' (versorgte Wohnungen)') : ''
    lines.push({ label: 'Wohnfläche der Einstufung', value: `${num(c.areaM2, 2)} m²${source}` })
  }
  if (c.kgPerM2 !== null) lines.push({ label: 'CO₂-Ausstoß je m² und Jahr', value: `${num(c.kgPerM2)} kg` })
  if (c.landlordPermille !== null) lines.push({ label: own ? 'Anteil des Vermieters' : 'Anteil des Vermieters laut Abrechnung', value: `${num(c.landlordPermille / 10)} %` })
  if (c.totalCents !== null) lines.push({ label: 'CO₂-Kosten insgesamt', value: fmtEuro(c.totalCents) })
  if (c.landlordCents !== null) lines.push({ label: 'davon trägt der Vermieter', value: fmtEuro(c.landlordCents) })
  const approx = ' (nach Ihrem Anteil an den Heizkosten)'
  const basis = own && !tenant.approximated ? ' (nach Ihrem Anteil an den Brennstoffkosten)' : approx
  if (tenant.tenantCents !== null) lines.push({ label: 'Ihr Anteil an den CO₂-Kosten', value: `${fmtEuro(tenant.tenantCents)}${basis}` })
  lines.push({
    label: c.deducted ? 'vom Vermieter übernommen (bereits abgezogen)' : 'vom Vermieter übernommen (eigene Zeile)',
    value: `${fmtEuro(tenant.landlordCents)}${own ? basis : tenant.approximated ? approx : ''}`,
  })
  const table = c.table.map((s) => ({
    range: s.to === null ? `ab ${num(s.from)} kg` : `${num(s.from)} bis unter ${num(s.to)} kg`,
    percent: `${s.landlordPercent} %`,
    marked: c.stage !== null && s.from === c.stage.from,
  }))
  const notes = [own
    ? 'Berechnet von Mietfuchs aus den Rechnungen des Versorgers (§ 7 Abs. 3 CO2KostAufG); der Ausstoß ist auf die Heizperiode umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG).'
    : 'Angaben laut Abrechnung des Messdienstes oder der Gemeinschaft (§ 7 Abs. 3 CO2KostAufG).']
  if (c.shortened) notes.push('Die Heizperiode ist kürzer als ein Jahr; die Grenzen der Stufentabelle sind anteilig gekürzt (§ 5 Abs. 1 Satz 4 CO2KostAufG).')
  for (const a of c.adjustments ?? []) {
    notes.push(
      a === 'nonResidential'
        ? 'Das Gebäude dient überwiegend nicht dem Wohnen; der Anteil des Vermieters richtet sich nach § 8 Abs. 1 CO2KostAufG statt nach der Stufe.'
        : a === 'restrictionHalf'
          ? 'Der Anteil des Vermieters ist wegen öffentlich-rechtlicher Vorgaben um die Hälfte gekürzt (§ 9 Abs. 1 CO2KostAufG).'
          : 'Wegen öffentlich-rechtlicher Vorgaben werden die CO₂-Kosten nicht aufgeteilt (§ 9 Abs. 2 CO2KostAufG).',
    )
  }
  return { title: 'CO₂-Kostenaufteilung', lines, table, notes }
}
```

Die Tests von PR 6 in `co2View.test.ts` bleiben grün: Ohne `basis` sind Beschriftungen und Hinweise
wortgleich.

- [ ] **Step 6: Abrechnung (`client/src/pages/Abrechnung.tsx`)**

Importe: `import FuelBlock from '../components/FuelBlock'`, `import { fuelBlock } from '../fuelView'`,
`import { closeWithFuelQuestion } from '../fuelClose'`.

In `closeSettlement()` den Aufruf, der die Abrechnung abschließt,

```tsx
    if (!(await attempt(() => api(withProperty(`/api/settlement/${year}/close`, propertyId), { method: 'POST', body: JSON.stringify({}) })))) return
```

(nach PR 3 mit dem Parameter des Zeitraums statt `year`; die Adresse bleibt, wie sie dort steht)
ersetzen durch:

```tsx
    // Bei einer Lücke ohne Rechnung fragt der Server nach (Heizung PR 7, Entwurf 8.2); Vorgabe ist die
    // Schätzung mit Vorbehalt.
    let closed = false
    if (!(await attempt(async () => {
      closed = await closeWithFuelQuestion(
        (body) => api(withProperty(`/api/settlement/${year}/close`, propertyId), { method: 'POST', body: JSON.stringify(body) }),
        (q) => confirm(q),
      )
    }))) return
    if (!closed) return
```

Führt die Seite den Abschluss einer Heizkostenabrechnung nach Weg d mit eigenem Aufruf
(`/api/heating-settlement/…/close`, PR 5), denselben Ersatz dort.

In der Karte jedes Mieters hinter der Zeile mit `<Co2Block … />` (PR 6):

```tsx
              {(data.heating ?? []).map((h) => <FuelBlock key={`fuel:${h.plantId}:${h.period}`} view={fuelBlock(h)} />)}
```

Übertragszeilen (`kind: 'fuelCarry'`, Kennung `fuel:<Lieferung>:<Heizperiode>:<Position>`) haben keine
Kostenposition, wie die Abzugszeilen aus PR 6; die Prüfung aus PR 6 Task 12 Step 4 gilt für sie
unverändert:

Run: `grep -n "costItemId" client/src/pages/Abrechnung.tsx client/src/tenantFolder.ts`
Expected: dieselben Stellen wie dort, keine neue, die zu einer `costItemId` eine Position verlangt.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix client test -- fuelClose fuelView co2View && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/fuelClose.ts client/src/fuelClose.test.ts client/src/fuelView.ts client/src/fuelView.test.ts client/src/components/FuelBlock.tsx client/src/co2View.ts client/src/co2View.test.ts client/src/pages/Abrechnung.tsx
git commit -m "Abrechnung: Rückfrage zur Schätzung beim Abschließen, Druckblock Brennstoff, Ausweis der eigenen CO₂-Aufteilung

Refs #97"
```

---
### Task 13: Smoke-Test, CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks; im Smoke-Test `request`, `json`, `assert`, `heatingPlant()` (PR 4), `co2Statement()` (PR 6), `backupAndRestore`.
- Produces: Prüfung der Programmdateien mit einer Lieferung (Entwurf 12.4), CHANGELOG, Architekturabschnitt.

- [ ] **Step 1: Smoke-Test (`scripts/smoke-test.mjs`)**

Hinter `co2Statement` (PR 6):

```js
// Lieferungen (Heizung PR 7): Die Gasrechnung des Jahres als Lieferung an der Heizanlage des
// Messdienstes; die Abrechnung bewertet sie (Abdeckung der Heizperiode). Das Objekt der Prüfung
// rechnet im Kalenderjahr.
async function fuelDelivery() {
  const [anlage] = (await request('/api/heating-plants')).body
  const angelegt = await request(`/api/heating-plants/${anlage.id}/deliveries`, json('POST', {
    label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', amountCents: 311747, emissionsKg: 5406.17, co2CostCents: 60000,
  }))
  assert(angelegt.status === 201 && angelegt.body.usedByService === true, 'Lieferung anlegen', angelegt.body)
  const s = (await request('/api/settlement/2025')).body
  const fuel = s.heating?.[0]?.fuel
  assert(Math.abs((fuel?.coveragePermille ?? 0) - 1000) < 1e-6 && fuel.deliveries?.length === 1, 'die Abrechnung bewertet die Lieferung', s.heating)
  const orte = await request(`/api/properties/${anlage.propertyId}/degree-days`, json('PUT', { values: [{ month: '2025-01', value: 420 }] }))
  assert(orte.status === 200 && orte.body.length === 1, 'Gradtagzahlen des Orts speichern', orte.body)
}
```

In `backupAndRestore` hinter der Zusicherung „die CO₂-Angaben sind nach der Wiederherstellung da“
(PR 6):

```js
  const lieferungen = (await request(`/api/heating-plants/${anlagen[0].id}/deliveries`)).body
  assert(lieferungen?.[0]?.label === 'Gas 2025', 'die Lieferung ist nach der Wiederherstellung da', lieferungen)
```

In `main` hinter `await co2Statement()`:

```js
  await fuelDelivery()
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

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ Lieferung anlegen“, „✓ die
Abrechnung bewertet die Lieferung“, „✓ Gradtagzahlen des Orts speichern“ und „✓ die Lieferung ist nach
der Wiederherstellung da“. `$D` ist ein Wegwerf-Ordner, `CI=1` verhindert das Browserfenster,
`NKA_UPDATE_URL` zeigt auf einen geschlossenen Port.

- [ ] **Step 3: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]`, in `### Hinzugefügt` (neben den Einträgen von PR 1 bis PR 6):

```md
- **Rechnungen des Versorgers als Lieferungen.** Auf der Seite „Heizkosten“ tragen Sie Gas-,
  Fernwärme- und Stromrechnungen mit ihrem Rechnungszeitraum ein. Reicht eine Rechnung über die
  Heizperiode hinaus, teilt Mietfuchs sie auf: nach einem eingetragenen Anteil, einem Zählerstand
  zum Stichtag, einer Zwischenrechnung, Teilmengen der Rechnung, den Gradtagzahlen Ihres Orts oder
  der Gradtagszahlentabelle; feste Preisbestandteile nach Tagen. Bei freien Schlüsseln verknüpfen
  Sie die Positionen mit ihrer Rechnung; der Teil einer anderen Heizperiode steht dann als eigene
  Zeile bei den Mietern und als Gegenbuchung bei Ihnen, und jede Rechnung ist über die Jahre genau
  einmal verteilt. Heizkosten gehören in die Heizperiode, in der der Brennstoff verbraucht wurde
  (BGH VIII ZR 156/11) ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Schätzung mit Vorbehalt beim Abschließen.** Fehlt für einen Teil der Heizperiode noch eine
  Rechnung, fragt Mietfuchs beim Abschließen nach und schlägt eine Schätzung aus der letzten Rechnung
  vor. Kommt die Rechnung später, nennt die Abrechnung die Differenz, vor und nach Ablauf der Frist
  mit dem, was Sie tun können; bei zu hoher Schätzung die Gutschrift je Mieter
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **CO₂-Kosten selbst aufteilen.** Mit den Lieferungen teilt Mietfuchs die CO₂-Kosten bei freien
  Schlüsseln selbst auf, und auch dann, wenn der Messdienst nicht aufgeteilt hat: Einstufung nach
  dem auf die Heizperiode umgerechneten Ausstoß, § 8 (Nichtwohngebäude) und § 9 (Beschränkungen)
  CO2KostAufG, der Abzug je Mieter nach seinem Anteil am Brennstoff. Die Abrechnung druckt die
  Grundlagen und den Block „Brennstoff“ mit ([#97](https://github.com/speedone/mietfuchs/issues/97)).
```

In `### Geändert`:

```md
- Ohne Heizanlage bleibt der Hinweis zu einer Heizrechnung über die Heizperiode hinaus wie bisher;
  mit einer Anlage und freien Schlüsseln rät er, die Rechnung als Lieferung einzutragen.
- Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode und Lieferungen, von denen
  eine abgeschlossene Heizperiode einen Teil eingefroren hat, lassen sich erst nach dem Wiederöffnen
  ändern.
```

- [ ] **Step 4: CLAUDE.md**

Im Absatz **CO₂ beim Messdienst** (PR 6) den Punkt

```md
- **Die Methode ist eine Antwort, keine Vorgabe** (Entwurf 7.2): `serviceDeducted` (Abzugszeile),
  `serviceShown` (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt); `self` kommt mit PR 7 und
  wird bis dahin abgelehnt, ebenso CO₂-Angaben an einer Anlage mit freien Schlüsseln.
```

ersetzen durch

```md
- **Die Methode ist eine Antwort, keine Vorgabe** (Entwurf 7.2): `serviceDeducted` (Abzugszeile),
  `serviceShown` (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt). Bei freien Schlüsseln gibt
  es nur `self`, und der Datensatz hält nur die Fläche der Einstufung (Heizung PR 7).
```

und direkt hinter dem Absatz einfügen:

```md
**Lieferungen** (Heizung PR 7, #97): Rechnungen des Versorgers an der Heizanlage in `fuel_deliveries`
(Teilmengen in `fuel_delivery_parts`), Positionen zeigen über `cost_items.fuel_delivery_id` darauf,
mehrere je Lieferung (Abschlag, Schlussrechnung, Gutschrift). Abgegrenzt wird in
[server/src/fuel.ts](server/src/fuel.ts) (`plantFuel`), gelesen und geschrieben in
[server/src/db/fuel.ts](server/src/db/fuel.ts); die Gradtagzahlen des Orts je Objekt und Monat in
`degree_day_values`.

- **Stufen, tagesgenau gibt es nicht** (Entwurf 3.2): eingetragener Anteil, Zählerstand (genau ein
  Versorgungszähler, Stände genau an den Grenzen), Zwischenrechnung, Teilmengen, Ortswerte, Tabelle
  `hkv.degree-days`; feste Preisbestandteile (`fixed_cents`) immer nach Tagen. Die Tabelle wird nur
  gefragt, wenn eine Anlage Lieferungen hat; sonst stünde sie im Rechtsstand jeder Abrechnung.
- **Die Positionen stehen in der Heizperiode, die das Ende der Rechnung enthält** (die Verknüpfung
  wird sonst abgelehnt). Der Teil einer anderen Heizperiode ist eine Zeile ohne Position
  (`kind: 'fuelCarry'`, Kennung `fuel:<Lieferung>:<Heizperiode>:<Position>`), mit dem Schlüssel der
  Position verteilt, und eine Gegenzeile beim Vermieter (`fuelCarry`). Über die Zeiträume hinweg ist
  jede Rechnung genau einmal verteilt; eine Invariante in calc-fuel.test.ts prüft das an
  Zufallsbeständen, auch über einen Abschluss.
- **Abgeschlossenes bleibt** (G-A4): Der Abschluss friert je Lieferung und Heizperiode in
  `fuel_carry_frozen` ein, was sie herein- oder hinausgebucht hat; gelesen wird das nur für eine
  abgeschlossene Heizperiode, das Wiederöffnen gibt es frei. Kommt der Teil einer Rechnung in eine
  abgeschlossene Heizperiode, trägt ihn der Vermieter (`fuelClosedPeriod`), oder er ersetzt eine
  Schätzung (`fuelEstimateDiff` mit Vorzeichen). Eine Schätzung zählt, solange keine echte Rechnung
  ihre Tage abdeckt; gespeichert wird „ersetzt“ nicht.
- **Rückfrage beim Abschluss:** Bei einer Lücke mit Schätzvorschlag antwortet der Abschluss mit 409
  und `fuelGaps`; `fuelEstimates: 'estimate' | 'none'` entscheidet. Schätzungen entstehen in einer
  eigenen Transaktion vor dem Abschluss und werden zurückgenommen, wenn er scheitert.
- **Eigene CO₂-Aufteilung:** C bei freien Schlüsseln abgegrenzt, beim Messdienst ohne Aufteilung die
  angesetzten Rechnungen ganz (G-A3); E immer umgerechnet. Der Abzug folgt dem Schlüssel des
  Brennstoffs (G-B5), § 8 und § 9 aus dem Register (`co2.non-residential`, `co2.restriction`), Wärme
  aus dem Emissionshandel bei Anschluss nach dem Stichtag (`co2.district-ets-new`) ohne Aufteilung.
- **Gesperrt bis zu ihren PRs:** Vorratsenergien (PR 8), Lieferungen je Wohnung (PR 9), Netzentgelte
  und Biobrennstoff (PR 18), Methode `self` (PR 10); jeder Satz sagt, was bis dahin geht.
```

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0 (nicht hinter `grep` prüfen).

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle bestanden; die Migrationskette läuft über `0022_lieferungen` und
`0023_lieferungen_bedingungen` auf einer Datenbank der letzten Version (Fall 6 und 7).

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "Lieferungen: Smoke-Test, CHANGELOG, Architektur in CLAUDE.md

Refs #97"
```

- [ ] **Step 7: Durchsicht und PR**

Vor dem PR eine Durchsicht mit frischem Kontext über `feat/heizung-pr6-…..feat/heizung-pr7-lieferungen`
mit dem Review Focus dieses Plans; jeder Befund wird mit einem Test behoben, der vorher rot war, und
steht in der PR-Beschreibung, zusammen mit den Abweichungen 1 bis 15. PR gestapelt auf PR 6, Text mit
`Refs #97` (nicht `Fixes`), Label `full-check`. Gemergt wird erst nach dem Umstellen auf `main`
(`git rebase --onto`) und grüner CI; die Integrationsdurchsicht des Endstands läuft vor dem Merge des
Stapels (CLAUDE.md, „Durchsicht vor jedem PR und vor jedem Merge“).

---
## Selbstprüfung

**Abdeckung des Entwurfs (13, PR 7):**

| Verlangt | Task |
|---|---|
| `fuel_deliveries` mit `fixed_cents`, `estimated`, `used_by_service`; `fuel_delivery_parts`; `cost_items.fuel_delivery_id`; `fuel_carry_frozen` (5.4) | 2, 4 |
| Abgrenzung Stufen 0–6, feste Bestandteile nach Tagen (3.2, R1) | 3 |
| Abgrenzung auch bei `manual` mit verknüpfter Lieferung (A6) | 3, 7 |
| Teil einer Rechnung nach H−1, Fälle a–f (8.2, N1) | 3, 7 (a, b, c, e, f), 4 (d: Ablesung in abgeschlossener H → 409) |
| Schätzung mit Vorbehalt, Rückfrage beim Abschluss (N1, A5) | 3 (Vorschlag), 9, 12 |
| `fuelEstimateDiff` mit Vorzeichen, Hinweise vor und nach Fristablauf, Gutschrift je Mieter (A4, B9) | 7 |
| Wiederöffnen (Fall f) | 3, 7, 9 |
| Sperre von Ablesungen in abgeschlossener H und eingefrorener Lieferungen | 4, 9 |
| E umgerechnet, C nach Methode (3.3, G-A3) | 3, 8, 10 |
| Einstufung, gekürzte Tabelle, § 8, § 9, ETS (9.1, 9.2, 3.9) | 1, 8 |
| Abzug nach Brennstoffanteil (9.4, G-B5, B8) | 8 |
| `period.heating-mismatch` nur ohne Anlage, sonst `fuel.manual-beyond-period` (3.4) | 7 |
| Hinweise `fuel.*`, `co2.*` mit PR 7 (10.1), Regeln (10.2), Lexikon (`degreeDays`) | 1, 7, 8 |
| F13 (12.1), Testfälle 12.2 (G-A3, G-A4/N1 a–f, Abschlussdialog, G-B5/B8, R1, A6) | 3, 7, 8, 9, 10, 12 |
| Invarianten 12.3 Nr. 1 und 5 | 7 |
| Seite Heizkosten, Druckblöcke (11.4, 9.5) | 11, 12 |
| Smoke-Test 12.4, CHANGELOG, CLAUDE.md | 13 |
| Sperren bis PR 8, 9, 10, 18 (13 PR 7) | 4 |

**Platzhalter:** Keine „TBD“, „später“ ohne Ziel oder „wie oben“. Die kg der Gasrechnung in F13 sind
ausdrücklich erfunden und gekennzeichnet (Entwurf 12.1, Gegenprüfung E.10); die Einzelbeträge von F12
kommen aus PR 6 (`betraege.json`), und F13 bricht ohne sie mit einer Ansage ab statt mit einem
erfundenen Wert.

**Namen und Typen über die Tasks:**

- `FuelDelivery`, `FuelDeliveryPart`, `FrozenFuelCarry`, `FuelAssessment`, `FuelGapQuestion` (Task 2)
  sind dieselben in fuel.ts (Task 3, über `FuelDeliveryInput`), db/fuel.ts (Task 4, 9), snapshot.ts
  (Task 6, `SnapshotFuelDelivery` als `Pick`), calc.ts (Task 7, 8) und im Client (Task 11, 12).
- `FuelCarry.kind` `'out' | 'in' | 'estimate'`, `landlord[].reason` `'fuelCarry' | 'fuelClosedPeriod' |
  'fuelEstimateDiff'` sind die drei `LandlordReason` aus Task 2; die Gegenzeile trägt die Kennung
  `fuel:<Lieferung>:<Heizperiode>`, die Mieterzeilen `fuel:<Lieferung>:<Heizperiode>:<Position>`
  (Task 7), und `frozenFuelRowsOf` (Task 6) liest genau diese Zeilen.
- Vorzeichen des Einfrierens: `freezeFuelCarries` (Task 9) speichert je Lieferung Σ `carries.cents` der
  Heizperiode (+ herein, − hinaus); `plantFuel` (Task 3) liest `f.cents` für `in` und `estimate` direkt
  und für `out` als X der anderen Heizperiode, für `in` aus der Heizperiode der Positionen als
  −`ownerFrozen.cents`. Der Invariantentest in Task 7 friert genau so ein.
- `Co2Assessment.basis`, `coveragePermille` (Task 2), `adjustments`, `areaSource` (Task 8) werden in
  Task 8 geschrieben und in Task 12 (`co2Block`) gelesen.
- `reliefKey` `co2:<Anlage>:<Heizperiode>` (PR 6) trägt auch die Abzugszeilen der eigenen Aufteilung
  (`bookReliefs`, Task 8).
- Routen aus Task 5 und 9 sind dieselben, die Task 11, 12 und 13 aufrufen.

**Bekannte Grenzen dieses Plans:** Mengenangaben ohne kg (`quantity`, `heatingValue`,
`emissionFactor`) werden gespeichert, aber nicht in kg umgerechnet; das braucht die Bestandsrechnung
mit den Heizwerten des § 9 Abs. 3 und kommt mit PR 8. Ohne kg laut Rechnung meldet die eigene
Aufteilung `co2.incomplete` und bucht nichts.
