# Heizung PR 10: Kernrechnung der eigenen Heizkostenabrechnung (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Vermieter mit Wärme- und Warmwasserzählern rechnet die Heizkosten seiner Anlage selbst
nach der Heizkostenverordnung ab: Mietfuchs teilt jede Position nach Teil und Ziel in die Töpfe
Heizung und Warmwasser (Warmwasseranteil gemessen), verteilt je Topf Grund- und Verbrauchskosten
mit dem Anteil der Vorperiode (§ 6 Abs. 4), teilt bei Nutzerwechsel nach der Zwischenablesung bzw.
nach § 9b Abs. 3 und nach Gradtagen, nimmt Ablesungen neben dem Stichtag wie abgelesen, führt
Leerstand, Eigennutzung und Pauschale als Nutzer, verteilt jede Position genau einmal über exakte
Gewichte (#202), rechnet Vorrat und Überträge auch hier, prüft Wärmepumpen nach § 12 Abs. 3 und
druckt Heizkostenabrechnung und Ableseergebnis.

**Architecture:** Die Rechnung steht als reine Funktionen in `server/src/heating.ts`: Nutzer je
Wohnung, Ablesung je Grenze (die beim Wechsel gebundene, sonst die nächste in ihrer Zelle über die
Nachbarperioden, ohne Rückrechnung), Gruppen nach § 9b
Abs. 3, Bruchteile je Topf, Warmwasseranteil, Anteile mit Vorgabe aus der Vorperiode und das Urteil
über Wärmepumpen. `computeSettlement` baut daraus je Anlage mit `method = 'self'` einen Plan, verteilt
jede Position mit dem neuen Schlüssel `heatingSystem` über `distributeCents` mit den Rohwerten
Betrag × Gewicht, nimmt die Überträge aus PR 7 und PR 8 (`fuelCarry`) mit denselben Gewichten mit,
teilt die CO₂-Kosten nach dem Anteil am Brennstoff (PR 7) und schreibt den Ausweis in
`Settlement.heating[].self`. Zwei erzeugte Migrationen (`0026_heizkostenabrechnung`,
`0027_heizkostenabrechnung_bedingungen`) bringen Warmwasser, Erfassung, Flächenbasis und Einbau der
Wärmepumpe an der Anlage, das Ziel an der Kostenposition und die Antworten zu fehlenden
Zwischenablesungen. Die Einrichtung (Schritt 7) läuft über eine eigene Route in einer Transaktion,
die Seite Heizkosten bekommt Verteilung, Ablesungen und Ableseergebnis, die Abrechnung den Druckblock
„Heizkostenabrechnung“.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
**8 ganz** (8.1 Erfassung, 8.2 Vorrat und Überträge bei `self`, 8.3 Warmwasseranteil, 8.4
Nutzerwechsel, 8.5 Grund- und Verbrauchskosten samt § 6 Abs. 4, 8.6 Gewichte und Rundung, 8.7 nur
als Grenze zu PR 13, 8.8 Ausweis ohne § 6a, 8.9 Zeile Zweifamilienhaus), 0.5–0.11 (R-A7, R-A14,
R-A15, R-A21, Z-B1–Z-B3, G-B1, A2, B7, F1, F5, N2, N8), 1.2 Nr. 1, 3.0, **3.5 ganz**, 3.12 (Wechsel
ohne Endstand), 3.13 (`eventDate` bei § 12 Abs. 3), 4.3 (`hkv.consumption-share-forced`,
`hkv.heat-pump.capture`, `practice.reading-off-warning`), 4.7 (Stichtage `hkv.heat-pump.capture`),
5.1, 5.3 (`hot_water`, `capture`, `area_basis_heat`, `change_split`, `heated_area_m2`,
`heating_periods` Verteilung und Warmwasser), 5.7, 5.8, **6.1–6.5**, 9.4 (x_t bei `self`), 10.1
(Codes mit PR 10), 10.2, 10.3, 11.2 Schritt 6 und 7, 11.4 (Seite Heizkosten, Mieterwechsel,
Abrechnung, Anleitung), 12.1 (F16, F17), 12.2 (Beispiel A, Gegenproben, Z-B1–Z-B3, R4/B5, R-A7,
R-A21, A2, A8, F5, G-C5/N8 bei `self`, N2/A7), 12.3 Nr. 1, 2, 7, 10, 14, 12.4, 13 (PR 10), 14.1,
15.1 Nr. 5, 9, 22, 15.2 F2, F3, 15.3 (Zeilen „PR 10“).

**Baut auf:** PR 1 (Code auf `feat/heizung`), PR 2 (Code auf `feat/heizung-pr2-zeitraum`, Stand
`5293190`), PR 3 bis PR 9 nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3..9}-*.md`. Gearbeitet wird auf
`feat/heizung-pr10-kernrechnung`, abgezweigt von der Spitze von PR 9; der PR wird gestapelt auf PR 9
gestellt und nach dessen Merge auf `main` umgestellt (`git rebase --onto`).

**Normen ⟨Norm offen⟩:** Vor PR 10 sollen VDI 2077 und DIN 94680 vorliegen (Entwurf 13 Phase C,
15.3). Fehlen sie beim Beginn der Arbeit, wird dieser Plan unverändert mit den Regeln aus der Praxis
der Messdienste gebaut; die Marken ⟨Norm offen: VDI 2077⟩ und ⟨Norm offen: DIN 94680⟩ stehen dann an
den Stellen in Code, Lexikon und Ausweis, die dieser Plan nennt (Warngrenze der Ablesung, Ablesung
neben dem Wechsel, gemessene Wärme gegen Brennwert, Gradtagstabelle). Liegt eine Norm vor und weicht
sie ab, ist das ein Befund für die Durchsicht, kein stiller Umbau.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Anlage mit
  `method = 'self'` ist jede Zahl, jeder Hinweis, jedes Feld der Abrechnung und
  `legalBasis.values` gleich dem Stand nach PR 9, mit genau einer angekündigten Ausnahme: der Hinweis
  `heating.change-fee` an einer Heizposition, deren Beschreibung „Zwischenablesung“ oder
  „Nutzerwechsel“ enthält (Entwurf 10.1). Golden F01–F15 bleiben wortgleich; ein Golden mit einer
  solchen Beschreibung gibt es nicht (Step „Golden unverändert“ in Task 9 prüft das).
- **Freie Schlüssel nur auf Wunsch anders** (Entwurf 5.3 `change_split`, A2, B7): Bei `manual`
  wirken die Gradtage nur auf Positionen mit `heating_target = 'heating'`; eine kombinierte
  Position „Heizung und Warmwasser“ geht nach Tagen wie bisher. Keine bestehende Position hat ein
  Ziel, also ändert sich keine Zahl, bis der Vermieter eines setzt.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): 50–70 % (`hkv.consumption-share`, PR 1), 70 %
  bei § 7 Abs. 1 Satz 2 (`hkv.consumption-share-forced`, neu), 15 % (`hkv.cut.not-by-consumption`,
  PR 1), Gradtage (`hkv.degree-days`, PR 3), die Stichtage des § 12 Abs. 3
  (`hkv.heat-pump.capture`, neu) und die Warngrenze der Ablesung (`practice.reading-off-warning`,
  neu). `server/src/heating.ts` kommt in `ENGINE_FILES` von `law-literals.test.ts`. Ein Parameter
  kommt mit der PR, die ihn nutzt (G-C7): hier genau diese drei.
- **Fassungen nie ändern** (4.4): Die drei neuen Fassungen bekommen je eine Zeile in
  `law-history.test.ts`; keine bestehende Zeile ändert sich.
- **Eine Verteilung je Position** (6.2, #202): Jede Position mit `heatingSystem` bekommt je Empfänger
  den Rohwert Betrag × g_r(Ziel) und wird mit `distributeCents` genau einmal verteilt; der Eigenanteil
  ist exakt (`selfRaw`, nie über `take()`), der Leerstand ist der Rest. Summe centgenau, jede Zeile
  höchstens 1 ct neben ihrem exakten Wert.
- **Keine lineare Interpolation eines Zählerstands** (8.4): Verbrauch ist immer die Differenz zweier
  wirklicher Ablesungen. Ein Test wird rot, sobald jemand interpoliert.
- **Ablesungen wie abgelesen** (3.5, 15.2 F2, F3): Je Grenze gilt die Ablesung, die ihr am nächsten
  liegt, ohne Rückrechnung; ein Hinweis nennt Tage und Gradtagsanteil dazwischen, ab einem Monat
  Abweichung mit einem Monat von Oktober bis April dazwischen eine Warnung.
- **§ 9b Abs. 3 nur ohne Zwischenablesung** (3.5): dann die gesamten Kosten der Wohnung der
  betroffenen Nutzer nach Gradtagen (bei `change_split = 'time'` nach Tagen), Warmwasser nach Tagen.
  „Nicht möglich“ ist ein Hinweis, „nicht durchgeführt“ und eine fehlende Antwort sind eine Warnung
  mit „bis zu“ 15 % der Heizkosten des Mieters; nie wird etwas abgezogen.
- **§ 9a kommt mit PR 13** (13): Fehlt ein Wert zu Beginn oder Ende der Heizperiode, fehlt ein Zähler
  einer Wohnung mit Fläche, liegt ein Zählerwechsel ohne Endstand oder negativer Verbrauch vor, wird
  die Anlage nicht verteilt (Fehler `heating.self-incomplete`, Betrag beim Vermieter), denn ohne
  Schätzung gäbe es nur eine falsche Zahl. Der Satz nennt, was einzutragen ist.
- **Sperren bis zu späteren PRs, 400 mit einem Satz** (13, W7): Heizkostenverteiler und Werte eines
  Ablesedienstes (`capture = 'hca' | 'serviceValues'`, PR 12); Warmwasser nach Formel
  (`dhw_method = 'volumeFormula' | 'areaFormula'` bei `self`, PR 11); Warmwasseranteil bei Energien,
  die nicht in kWh abgerechnet werden (Heizöl, Flüssiggas, Pellets, Holz, Kohle, Sonstiges mit
  `hot_water = 'combined'`; Heizwert und Tabelle des § 9 Abs. 3, PR 11); mehr als 70 % nach Verbrauch
  (§ 10, PR 14). Jeder Satz sagt, was bis dahin geht.
- **Stufe hängt am Code** (#112): Wo der Entwurf einem Code zwei Stufen gibt
  (`heating.interim-reading-off`, `heating.no-interim-reading`, `heating.reading-dates-differ`,
  `fuel.stock-missing`), bekommt die zweite Stufe einen eigenen Code (Abweichungen 2 bis 4). Jeder neue
  Code steht mit genau einer Stufe in `noticeKinds` und trägt mindestens einen Begriff des Lexikons.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte in genau dieser Reihenfolge hinter `0025_vorrat_bedingungen` (PR 8; PR 9 hat keinen
  Schritt): `heizkostenabrechnung` (neue Spalten und die neue Tabelle, keine geänderte Bedingung an
  einer bestehenden Tabelle) und `heizkostenabrechnung_bedingungen` (Bedingungen an
  `heating_plants` und `cost_items`, Neubau). Die Nummern vergibt drizzle-kit: `0026_…` und `0027_…`.
  Keine Datenanweisung. Die Marken kommen in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben
  unverändert; die db.json kennt keinen Schlüssel `heatingSystem`. `legacy/read.ts` braucht keine
  Änderung: Alle neuen Felder im Schnappschuss sind optional.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch;
  Nutzertexte siezen (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`). Im Client endungslose Importe,
  nur aus `shared/` mit `.ts`.
- **Auswahlfelder** werden aus Optionslisten gespeist; je neuem Auswahlfeld ein jsdom-Test, dass der
  angezeigte Wert dem gespeicherten entspricht.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`/`startServerIn`, beim Smoke-Test
  der Aufruf von Hand (Task 14).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #99` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung. Aufgaben stehen nur in den GitHub-Issues des Repos,
  nie in Beads (CLAUDE.md).

## Review Focus

1. **Der Nachmieter zieht nicht am Tag nach dem Auszug ein, sondern zwei Wochen später, und für den
   Beginn des Leerstands gibt es keine Ablesung, für das Ende schon.** Der Vermieter erwartet, dass
   nur die Grenze ohne Ablesung nach § 9b Abs. 3 geteilt wird und der Nachmieter seinen eigenen
   gemessenen Verbrauch trägt. Erwartet: Vormieter und Leerstand bilden eine Gruppe (Gradtage bzw.
   Tage), der Nachmieter rechnet ab seiner Ablesung; Σ der Nutzer der Wohnung bleibt der Verbrauch
   der Wohnung. Test in Task 3.
2. **Ein Mieter liest am 03.10. ab, gewechselt wurde zum 30.09., und am 15.10. wird noch einmal
   abgelesen; keine der beiden ist beim Mieterwechsel erfasst.** Erwartet: Es gilt die Ablesung, die
   dem Wechsel am nächsten liegt (03.10.), nicht die spätere; die Grenze zwischen den Nutzern liegt am
   03.10., und der Hinweis nennt 3 Tage und den Gradtagsanteil. Ist eine davon beim Mieterwechsel
   erfasst, gilt diese, auch wenn die andere näher liegt (Abweichung 9). Test in Task 3.
3. **Die Anlage wird von „Niemand“ auf „Ich selbst“ umgestellt, während im offenen Zeitraum schon
   Heizpositionen mit Schlüssel „nach Wohnfläche“ stehen.** Erwartet: 409 mit der Liste dieser
   Positionen; erst mit Teil und Ziel für jede wird umgestellt, in einer Transaktion mit Anteil und
   Zählern; nie bleibt eine Position nach Fläche an einer Anlage mit eigener Abrechnung stehen.
   Test in Task 5.
4. **Eine Wohnung hat nur einen Warmwasserzähler, aber keinen Wärmezähler, die anderen haben
   beides.** Erwartet: Fehler `heating.self-incomplete` mit Wohnung und Zählertyp, die Positionen
   der Anlage beim Vermieter, kein stilles Verteilen, bei dem diese Wohnung keine Verbrauchskosten
   Heizung trägt. Test in Task 3 und Task 8.
5. **Gas mit eigener Abrechnung, die Rechnung des Versorgers reicht von März bis März, und beim
   Abschluss fehlt die Folgerechnung.** Erwartet: Solange eine Lücke besteht, lässt sich der
   Warmwasseranteil nicht bestimmen (`heating.dhw-share-invalid` mit beiden Wegen: Folgerechnung
   eintragen oder mit Schätzung abschließen); mit der Schätzung beim Abschluss trägt die geschätzte
   Lieferung ihre kWh, und α wird gerechnet. Test in Task 4 und Task 8.

---

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/heizkostenv.ts`, `shared/law/practice.ts`, `shared/law/params.ts`, `shared/law/rules.ts` | `hkv.consumption-share-forced`, `hkv.heat-pump.capture`, `practice.reading-off-warning`; Regeln `heating-own-settlement`, `heating-tenant-change`, `heating-reading-date`, `heating-key-change` | 1 |
| `shared/glossary.ts` | Begriffe `baseCosts`, `consumptionCosts`, `interimReading`, `heatMeter`; `hotWaterShare` mit beiden Lesarten | 1 |
| `shared/types.ts` | `CostKey` + `'heatingSystem'`, `HeatingTarget`, `HotWater`, `CaptureMethod`, `AreaBasisHeat`, `InterimGap`, `HeatingDistribution`, Ausweis `SelfHeatingStatement` samt Teilen; Felder an `HeatingPlant`, `CostItem`, `HeatingStatement`, `HeatingPeriodView` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/0026_heizkostenabrechnung.sql`, `0027_heizkostenabrechnung_bedingungen.sql`, `meta/*` (erzeugt) | Spalten, Tabelle `interim_reading_gaps`, Bedingungen | 2 |
| `server/src/calc.ts` (`KEY_LABELS`, `KEY_PHRASES`), `server/src/bookingPlan.ts`, `server/src/store.ts`, `client/src/types.ts`, `client/src/costForm.ts` | neuen Schlüssel beschriften, aus Auswahl und Belegbuchung heraushalten | 2 |
| `server/src/heating.ts` (neu) | Nutzer, Grenzablesungen, § 9b, Bruchteile je Topf, Gewichte, Warmwasseranteil, Anteile, Wärmepumpe, Ziel | 3, 4 |
| `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts`, `server/src/db/heatingSelf.ts` (neu), `server/src/db/co2.ts` | Lesen und Schreiben, Schreibprüfungen, Einrichtung, Verteilung, Antworten zu Zwischenablesungen, Mieterwechsel, Ansicht je Heizperiode | 5 |
| `server/src/index.ts` | Routen | 6 |
| `server/src/snapshot.ts` | neue Felder der Anlage, der Heizperiode und der Kostenposition; Antworten zu Zwischenablesungen | 7 |
| `server/src/fuel.ts`, `server/src/db/fuel.ts`, `server/src/db/fuelStock.ts`, `server/src/db/co2.ts`, `server/src/db/heating.ts` | Nähte zu PR 7 und PR 8: Lieferungen, Überträge und Vorrat bei `self` | 8 |
| `server/src/calc.ts`, `shared/heating.ts` | Verteilung nach Heizkostenverordnung, Überträge, CO₂ nach Brennstoffanteil, Hinweise, Ausweis, „nur Heizung“ bei freien Schlüsseln | 8, 9 |
| `server/test/fixtures/heating/F16-*/README.md`, `F17-*/README.md` (neu), `server/test/heating-golden.test.ts` | Golden F16, F17 | 10 |
| `client/src/heatingSelfForm.ts` (neu), `client/src/heatingForm.ts`, `client/src/components/HeatingSelfSetup.tsx` (neu), `client/src/components/HeatingCard.tsx` | Einrichtung Schritt 6 (Wärmepumpe) und 7 | 11 |
| `shared/costItem.ts`, `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`, `client/src/tenantChange.ts`, `client/src/pages/Stammdaten.tsx` | Kostenformular (Schlüssel, Teil, Ziel), Mieterwechsel (Ablesedatum, keine Zwischenablesung) | 12 |
| `client/src/heatingSelfView.ts` (neu), `client/src/components/SelfHeatingCards.tsx` (neu), `client/src/components/SelfHeatingBlock.tsx` (neu), `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/notices.ts` | Seite Heizkosten (Verteilung, Ablesungen, Ableseergebnis), Druckblock | 13 |
| `shared/guides.ts`, `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Anleitung, Prüfung der Programmdateien, Doku | 14 |
| Tests: `law-heizkosten.test.ts` (neu), `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `schema.test.ts`, `migrations.test.ts`, `heating.test.ts` (neu), `db-heizkosten.test.ts` (neu), `api.test.ts`, `calc-heizkosten.test.ts` (neu), `fuel.test.ts`, `heating-golden.test.ts`, `guides.test.ts`, `client/src/heatingSelfForm.test.ts` (neu), `client/src/components/HeatingSelfSetup.test.tsx` (neu), `client/src/costForm.test.ts`, `client/src/pages/Kosten.test.tsx`, `client/src/tenantChange.test.ts`, `client/src/heatingSelfView.test.ts` (neu), `client/src/components/SelfHeatingCards.test.tsx` (neu) | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 9 anders umsetzt, zieht ihn hier nach, bevor Task 1
beginnt. Code gibt es heute für PR 1 und PR 2; PR 3 bis PR 9 liegen als Pläne vor.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 `shared/law/register.ts` | `LawParam<T, M>` mit `describe`, `Source`, `law(param, ctx, log)` (Überladungen `periodStart` → `T`, `eventDate` → `T`, `overlap`), `valueAt`, `onlyVersion`, `germanDate`, `dayBefore`, `dayAfter`, `createLawLog`, `LawLog`, `Period`, `LAW_AS_OF` | Code |
| PR 1 `shared/law/heizkostenv.ts` | `ENACTED`, `checked(cite, url)`, `hkvConsumptionShare` (`{ min, max }`), `hkvCutNotByConsumption` (15) | Code |
| PR 1 `server/test/law-history.test.ts`, `law-literals.test.ts` | `SHIPPED`, `ENGINE_FILES` | Code, ergänzt von PR 2–9 |
| PR 2 `shared/period.ts` | `PeriodKey`, `BillingPeriod` (`key`, `from`, `to`, `short`), `PeriodRules`, `periodKey`, `parsePeriodKey`, `periodOfKey`, `periodContaining`, `previousPeriod`, `periodLabel`, `periodDays`, `CALENDAR_RULES`, `rulesOf` | Code |
| PR 2 `server/src/calc.ts` | `distributeCents`, `Recipient`, `cleanRaw`, `landlordRecipients`, `fmtCents`, `fmtExactEuro`, `fmtNum`, `fmtPercent`, `fmtDay`, `andList`, `itemSubject`, `KEY_LABELS`, `noticeKinds`, `NoticeCode`; in `computeSettlement`: `period`, `yFrom`, `yTo`, `diy`, `label`, `lawLog`, `lawPeriod`, `tenancies` (`TenancyWithUnit[]`), `statements`, `landlordRows`, `warn`, `items`, `selfUnits`, `outsideHeating`, `heatingCovered`, die Schleife `for (const item of …)` mit `targets`, `selfRaw`, `outsideRaw`, `forced`, `booked`, `bookable`, `modelFor`, `const steps: CalcStep[] = [`, `type Target` | Code |
| PR 2 `server/src/db/repository.ts` | `changeTenant(db, propertyId, tenancyId, body, nextId)`, `TenantChangeError`, `mergeReading`, `emptyReading`, `readingCollection`, `tenancyCollection`, `guardTenancy`, `mergeCostItem`, `costItemRow`, `isPeriodClosed`, `createEntity` | Code |
| PR 3 | `hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'>`, `DegreeDayTable`; `shared/degreeDays.ts`: `DayRange`, `degreeDayPermille(ranges, table)`; `CostItem.heatingPart?: HeatingPart`, `HEATING_PARTS`, Bedingung `cost_items_heating_part_category`; `SnapshotCostItem` mit `heatingPart`, `serviceFrom`, `serviceTo`, `taxYear`; `CostItemDraft`/`CostItemBody` mit `heatingPart`; `ItemForm.heatingFuel` | Plan PR 3 |
| PR 4 | `HeatingPlant` (`id`, `propertyId`, `name`, `energy`, `supply`, `method`, `source`, `devicesRemote`, `devicesInstalledAfter2021`, `captureInstalledOn`, `capturedOnOct2024`, `warmRentAverageCents`, `changeSplit`, `periodStartMonth`, `units`), `HeatingPlantUnit` (`unitId`, `heatedAreaM2`), `HeatingPeriodData` (`heatConsumptionPct`, `waterConsumptionPct`, `above70Agreed`, `insulationRule`, `dhwMethod`, `dhwHeatKwh`, `totalHeatKwh`, …), `ChangeSplit`, `InsulationRule`, `DhwMethod`, `HeatingRole`, `MeterType` mit `'warmwasser' | 'hkv'`; schema.ts `heatingPlants`, `heatingPlantUnits`, `heatingPeriods`, `exactly`, `oneOf`, `notNegative`, `units`; db/heating.ts `LATER`, `mergeHeatingPlant`, `emptyHeatingPlant`, `guardHeatingPlant(db, before, after)`, `plantRow`, `readPlantUnits`, `createHeatingPlant`, `updateHeatingPlant`, `heatingPlantViolations`; repository.ts `HeatingError(status, message)`, `has`, `raw`, `merged`, `asText`, `asNullableFilled`, `oneOfOrUndefined`, `ISO_DATE`, `guardCostItemHeating(db, before, after)`, `plantOf`; read.ts `readHeatingPlants`, `Stock.heatingPlants`; Client `heatingForm.ts` (`HeatingForm`, `heatingPlantBody`, `heatingToForm`, `emptyHeatingForm`, `CAPTURE_OPTIONS`, `CaptureAnswer`, `whoHint`, `LATER_SELF`), `HeatingCard`; `meterForm.ts` | Plan PR 4 |
| PR 5 | `shared/heatingPeriod.ts`: `plantRules(plant, objectRules)`, `servesUnit(plant, unit)`, `settledSeparately`, `PlantWay`; snapshot.ts `wayOf`, `SnapshotHeatingPlant`, `Snapshot.objectRules`, `Snapshot.scope`, `heatingSnapshotFor`; in `computeSettlement` `scope`, `objectRules`, `plants`; Client `usePeriod()` | Plan PR 5 |
| PR 6 | `HeatingStatement` (`plantId`, `plantName`, `energy`, `period`, `from`, `to`, `co2`), `HeatingPeriodView` (`plantId`, `period`, `label`, `from`, `to`, `short`, `closed`, `hotWater`, `co2`, `items`), `NoticeSubject` + `'heatingCosts'`; snapshot.ts `SnapshotHeatingPeriodRow`, `Snapshot.heatingPeriodRows`; read.ts `readHeatingPeriodRows`; co2.ts `Co2Pot`, `co2PotsOf`; db/co2.ts `heatingPeriodViews`, `saveHotWater`; im CO₂-Block `co2Pots`, `heatingStatements`, `report`, `cutsOn(ids, pct)`, `plantSubject`; Seite `client/src/pages/Heizkosten.tsx`; `withoutCo2` (`server/testing/co2.ts`); heating-golden.test.ts `withDatabase`, `FIXTURES`, `euro` | Plan PR 6 |
| PR 7 | `FuelDelivery` (mit `energyKwh`), `FuelDeliveryLine`, `FuelEstimateProposal`, `FuelGap`; fuel.ts `plantFuel`, `FuelPlantInput`, `FuelDeliveryInput`, `FuelResult`; db/fuel.ts `createDelivery`, `createEstimates`, `guardDelivery`, die Verknüpfungsprüfung; in `computeSettlement` `fuelPlants`, `fuelResults`, `fuelSynthetic`, `fuelCarryOf`, der Block „Heizrechnung über die Heizperiode“ mit `fuel.manual-beyond-period`, im CO₂-Block `ownSplit`, `fuelOf`; db/co2.ts `guardCo2`, `ensureHeatingPeriod`; Seite Heizkosten mit `FuelCard`, `DegreeDaysCard`, `Co2FactsCard` | Plan PR 7 |
| PR 8 | `shared/fuelStock.ts` `isStockEnergy`; `server/src/db/heatingPeriodContext.ts` `PlantContext`, `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`; db/fuelStock.ts `stockOptionsFor`, `saveStock`; in `computeSettlement` `stockOfPlant`, `stockCarry`, `stockCarryNet`, `stockManualNotes`, `FUEL_KEYS`; Codes `fuel.stock-missing`, `fuel.stock-invalid`, `fuel.before-2023`; `stockCarrySelfCents` | Plan PR 8 |
| PR 9 | `guardPlantsOfProperty`, `plantForNewItem`, `exactByItem` (exakte Anteile je Position und Mietverhältnis), `SnapshotHeatingPlant.supply` | Plan PR 9 |

## Nähte zu PR 7 und PR 8

PR 7 und PR 8 sperren die Methode `self` an genau den folgenden Stellen oder behandeln sie dort
anders als `manual`. Dieser Plan hebt jede Sperre auf und behandelt `self` beim Brennstoff wie
`manual` (Entwurf 8.2: „gilt für jede Methode mit eigenen Brennstoffrechnungen, also für `self` und
`manual`“). **Vor Task 1** sucht die ausführende Sitzung mit
`grep -n "'manual'\|'self'" server/src/fuel.ts server/src/fuelStock.ts server/src/calc.ts server/src/db/fuel.ts server/src/db/fuelStock.ts server/src/db/co2.ts server/src/db/heating.ts client/src/pages/Heizkosten.tsx`
und gleicht jede Fundstelle mit dieser Tabelle ab; eine Stelle, die hier fehlt, entscheidet sie nach
derselben Regel (beim Brennstoff wie `manual`, beim Messdienst bleibt `service` allein) und nennt sie
in der PR-Beschreibung. Geändert werden die Stellen in Task 8.

| Nr. | Datei, Stelle (Plan) | heute | nach PR 10 |
|---|---|---|---|
| N1 | `server/src/fuel.ts`, `plantFuel` (PR 7 Task 3) | `const withItems = input.method === 'manual'` | `const withItems = input.method === 'manual' \|\| input.method === 'self'` |
| N2 | `server/src/db/fuel.ts`, Verknüpfung einer Position (PR 7 Task 4) | `if (plant?.method !== 'manual') {` | `if (plant?.method === 'service') {` |
| N3 | `server/src/db/fuel.ts`, `guardDelivery` (PR 7 Task 4) | `if (plant.method === 'self') throw new HeatingError(400, LATER.self)` | Zeile entfällt |
| N4 | `server/src/db/fuel.ts`, `guardDelivery` (PR 7 Task 4) | `if (plant.method === 'manual' && after.amountCents !== null && !after.estimated) {` | `if (plant.method !== 'service' && after.amountCents !== null && !after.estimated) {` |
| N5 | `server/src/db/fuel.ts`, `guardFuelDelivery` Vorrat (PR 8 Task 5) | `if (plant.method === 'self') throw new HeatingError(400, 'Den Vorrat bei der eigenen Heizkostenabrechnung …')` | Zeile entfällt |
| N6 | `server/src/db/heating.ts`, Methodenwechsel mit verknüpften Positionen (PR 7 Task 4) | `if (before.method === 'manual' && after.method !== 'manual' && (verknuepft?.n ?? 0) > 0) {` | `if (before.method !== 'service' && after.method === 'service' && (verknuepft?.n ?? 0) > 0) {` |
| N7 | `server/src/db/co2.ts`, `guardCo2` (PR 7 Task 4) | `ctx.plant.method === 'manual'` / `ctx.plant.method !== 'manual'` | `ctx.plant.method !== 'service'` / `ctx.plant.method === 'service'` |
| N8 | `server/src/db/fuelStock.ts`, `saveStock` (PR 8 Task 5) | `if (ctx.plant.method === 'self') throw new HeatingError(400, LATER_SELF)` | Zeile entfällt |
| N9 | `server/src/db/fuelStock.ts`, `stockOptionsFor` (PR 8 Task 5) | `needCost: plant.method === 'manual',` | `needCost: plant.method !== 'service',` |
| N10 | `server/src/calc.ts`, Bestandsrechnung (PR 8 Task 6) | `needCost: plant.method === 'manual',` | `needCost: plant.method !== 'service',` |
| N11 | `server/src/calc.ts`, Block „Heizrechnung über die Heizperiode“ (PR 7 Task 7 Step 4) | `if (plants.find((p) => p.id === item.heatingPlantId)?.method === 'manual') {` | `if ((plants.find((p) => p.id === item.heatingPlantId)?.method ?? 'service') !== 'service') {` |
| N12 | `server/src/calc.ts`, Überträge (PR 7 Task 7 Step 5) | `if (plant.method === 'self') continue` | Zeile entfällt |
| N13 | `server/src/calc.ts`, CO₂-Block (PR 7 Task 8 Step 7) | `(pot.method === 'manual' && (st === null \|\| st.method === 'self') && fuelOf.lines.length > 0) \|\|` | `(pot.method !== 'service' && (st === null \|\| st.method === 'self') && fuelOf.lines.length > 0) \|\|` |
| N14 | `server/src/calc.ts`, Übertragsposten des Vorrats (PR 8 Task 7 Step 3) | `if (entry.plant.method !== 'manual') continue` | `if (entry.plant.method === 'service') continue`, dazu die Vorlage nach Task 8 Step 6 |
| N15 | `client/src/pages/Heizkosten.tsx` (PR 7 Task 11) | `{plant.method === 'manual' && (` (Fläche der Einstufung) | `{plant.method !== 'service' && (` |
| N16 | `client/src/pages/Heizkosten.tsx` (PR 6/7) | `{plant.method === 'self' ? (<div className="card"><p>Die eigene Heizkostenabrechnung kommt mit einer späteren Version.</p></div>) : (…Karten…)}` | nur noch die Karten, dahinter `SelfHeatingCards` (Task 13) |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **Neue Spalte `heating_plants.heat_pump_installed_on`.** Der Entwurf (5.3) kennt nur
   `captured_on_2024_10_01` und `capture_installed_on`. Damit lässt sich eine Wärmepumpe, die nach
   dem 01.10.2024 mit Erfassung eingebaut wurde (Test F5 in 12.2 und 4.7: „anwendbar“), nicht von
   einer bestehenden unterscheiden, deren Erfassung später nachgerüstet wurde („ab dem Zeitraum nach
   der Installation“). § 12 Abs. 3 Satz 1 HeizkostenV betrifft nur Wärmepumpen, deren Verbrauch „am
   1. Oktober 2024 noch nicht erfasst wird“; eine danach eingebaute fällt nicht darunter.
2. **`heating.no-interim-reading-missed`** (warning) neben `heating.no-interim-reading` (hint). Der
   Entwurf (10.1) gibt einem Code zwei Stufen; eine Stufe hängt am Code (#112). Ohne Antwort gilt der
   Fall als nicht durchgeführt, mit derselben Warnung und der Bitte um die Antwort.
3. **`heating.interim-reading-far`** und **`heating.reading-dates-far`** (warning) neben
   `heating.interim-reading-off` und `heating.reading-dates-differ` (hint), aus demselben Grund.
4. **`fuel.stock-missing-self`** (error) neben `fuel.stock-missing` (warning, PR 8), wie im Plan von
   PR 8 (Abweichung 2) angekündigt.
5. **`heating.self-incomplete`** (error) für alles, was die Anlage nicht verteilbar macht und keinen
   eigenen Code hat: fehlender Zähler oder Wert zu Beginn oder Ende der Heizperiode, Zählerwechsel
   ohne Endstand, negativer Verbrauch (die Fälle des § 9a, PR 13), fehlender Anteil nach Verbrauch,
   keine Fläche. Der Entwurf weist diese Fälle § 9a zu (8.7, 3.12), das kommt mit PR 13; bis dahin wird
   nicht verteilt, statt eine falsche Zahl zu drucken.
6. **`heating.heat-pump-dhw-basis` kommt mit PR 10** (Entwurf 10.1: PR 11). Der Fall entsteht schon
   beim gemessenen Warmwasseranteil einer Wärmepumpe ohne Gesamtwärmezähler (8.3, Test A8), und den
   rechnet PR 10.
7. **`heating.heat-pump-capture`** (hint): Der Entwurf nennt keinen Code für eine Wärmepumpe, für die
   die Verordnung im Zeitraum noch nicht gilt (§ 12 Abs. 3 Satz 2). Dann gibt es keine
   Kürzungshinweise nach § 12, und der Hinweis sagt, ab wann sie gilt: „ab dem Abrechnungszeitraum,
   der nach dem TT.MM.JJJJ beginnt“ („nach“ streng gelesen).
8. **Tabelle `interim_reading_gaps`** (Wohnung, Datum der Grenze, „nicht möglich“ oder „nicht
   durchgeführt“, Grund). Der Entwurf (3.5) lässt Mietfuchs fragen, nennt aber keinen Ort für die
   Antwort. Die Grenze ist der letzte Tag des bisherigen Nutzers; so passt dieselbe Antwort zum
   Mieterwechsel (#150) und zum Beginn oder Ende eines Leerstands.
9. **Welche Ablesung zu einer Grenze gehört** (nach der rechtlichen Prüfung neu gefasst). Weder
   HeizkostenV noch BGH regeln das; belegt ist nur, dass nicht zurückgerechnet wird (Entwurf 3.5).
   Die Regel hat deshalb vier Teile, jeder mit Grund:
   - **Gebunden vor nah.** Eine Ablesung, die beim Mieterwechsel erfasst wird (#150, Task 5 und 12),
     trägt ihre Grenze (`readings.interim_for`, der letzte Tag des bisherigen Nutzers) und gehört
     fest zu ihr, wie bei den Messdiensten, die eine Zwischenablesung beauftragen und kennzeichnen.
   - **Nähe nur als Rückfall** für Ablesungen ohne Bindung (Stichtag, nachgetragene Werte): die
     nächste in der Zelle der Grenze; liegt eine Ablesung genau in der Mitte, gehört sie zur früheren
     Grenze, und von zwei gleich weit entfernten gilt die frühere. Das ist eine **Festlegung nach der
     Praxis der Messdienste ohne Quelle** (ista nimmt Monatsendwerte, Brunata führt Wechsel- und
     Ablesedatum getrennt); sie ist deterministisch und keiner Norm zuwider.
   - **Zwei verschiedene Werte eines Zählers am selben Tag** sind ein Befund
     (`heating.self-incomplete`, Grund `sameDay`), keine Wahl; welcher stimmt, weiß nur der Vermieter
     (dieselbe Regel wie #69). Gleiche Werte stören nicht.
   - **Über die Heizperioden stetig.** Die Zellen werden über alle Grenzen der Wohnung in H−1, H und
     H+1 gebildet (`outerChanges`), sodass H−1 und H einer Ablesung dieselbe Grenze geben. Ist H−1
     abgeschlossen, ist ihr eingefrorener Endstand der Anfangsstand von H (`opening`, aus dem
     abgeschlossenen Ausweis); sonst zählte Verbrauch, der nach dem Abschluss nachgetragen wurde,
     doppelt oder gar nicht.
10. **Warmwasseranteil nur bei Abrechnung in kWh** (Gas, Fernwärme, Wärmepumpe, Strom). Bei Heizöl,
    Flüssiggas, Pellets, Holz und Kohle braucht § 9 Abs. 3 den Heizwert laut Rechnung, hilfsweise die
    Tabelle; beides kommt mit PR 11 (Entwurf 13). Bis dahin ist `hot_water = 'combined'` dort gesperrt
    (400), und eine Anlage ohne Warmwasser oder mit getrennter Bereitung rechnet.
11. **Der Warmwasseranteil braucht die ganze Heizperiode** an Rechnungen oder Gesamtwärme. Eine Lücke
    hochzurechnen wäre eine Schätzung (W4: hochgerechnet wird nur der Ausstoß); bis die Folgerechnung
    oder die Schätzung beim Abschluss da ist, gilt `heating.dhw-share-invalid`. Die Schätzung beim
    Abschluss (PR 7) bekommt dafür die kWh im selben Verhältnis wie kg und CO₂-Kosten (8.2 Nr. 2:
    „kg und CO₂-€ im selben Verhältnis“, hier auch für die Menge); das ist eine **Festlegung ohne
    Quelle**. Weil die Schätzung damit auch den Nenner von α bestimmt, sagt der Hinweis
    `heating.dhw-share-estimated` (hint, neu), dass α auf der geschätzten Energie beruht und sich mit
    der Folgerechnung ändern kann.
12. **Gemessene Warmwasserwärme:** der eingetragene Wert der Heizperiode (`dhw_heat_kwh`), sonst der
    Zähler mit der Rolle `dhwHeat`; ebenso die Gesamtwärme (`total_heat_kwh`, Rolle `totalHeat`).
13. **§ 7 Abs. 1 Satz 2 bei Flüssiggas** (Auslegung, im Lexikon unter „Verbrauchskosten“ so
    gekennzeichnet). Der Wortlaut sagt „Öl- oder Gasheizung“ ohne Einschränkung; wo die Verordnung
    Erdgas meint, sagt sie es (§ 9 Abs. 2 Satz 6, Tabelle in § 9 Abs. 3 trennt Erdgas und Flüssiggas).
    Die Begründung (BR-Drs. 570/08, S. 13) spricht von „Öl- und Gasheizungen“ und grenzt nur gegen
    Versorgungsarten mit hohem Grundkostenanteil wie Fernwärme ab. Der Pflichtanteil ist unter beiden
    Lesarten zulässig, denn er liegt im Rahmen des Satzes 1; eine ausdrückliche Quelle gibt es
    nicht.
14. **Anteil ohne Angabe:** Fehlt der Anteil nach Verbrauch (weder eigene Zeile noch Vorperiode),
    wird nicht verteilt (`heating.self-incomplete`); die Einrichtung (Schritt 7) schreibt ihn immer.
    **Je Topf eigen** (§ 8 Abs. 1 verlangt beim Warmwasser eine eigene Wahl): Der Anteil beim
    Warmwasser kommt aus der eigenen Zeile oder dem Warmwasserwert der Vorperiode, nie still aus dem
    Anteil der Heizung; fehlt er, ist das `heating.self-incomplete`. Einrichtung und Seite Heizkosten
    fragen beide Werte, vorbelegt mit demselben, sodass der Vermieter wählt. Mehr als 70 % nur mit
    Vereinbarung (§ 10) kommt mit PR 14 und ist bis dahin gesperrt; unter 50 % bleibt hart.
15. **Kürzungsbetrag bei nur einem unerfassten Topf:** „Soweit“ in § 12 Abs. 1 Satz 1 begrenzt die
    Kürzung auf den unerfassten Teil. Fehlt der Verbrauch nur für Heizung oder nur für Warmwasser,
    rechnet `heating.no-consumption` deshalb auf den Anteil des Mieters an diesem Topf, und zwar **nach
    CO₂-Abzug** wie 6.5: vom Topfanteil geht der Teil seines Abzugs ab, der auf diesen Topf entfällt
    (sein Brennstoff in diesem Topf durch seinen Brennstoff insgesamt; beim Ziel „beides“ teilt α).
    Weil es keine gedruckte Zeile je Topf gibt, druckt der Ausweis den Topfbetrag je Mieter vor und
    nach Abzug; das ist die Grundlage, die der Mieter nachrechnen kann. Sind alle Töpfe unerfasst,
    gilt die Summe der gedruckten Zeilen nach Abzug wie überall.
16. **„Nur Heizung“ bei freien Schlüsseln:** § 9b Abs. 2 teilt die übrigen Wärmekosten beim
    Nutzerwechsel „nach der Gradtagszahl oder zeitanteilig“. Bei Wohnfläche, Wohneinheiten,
    vereinbarten Anteilen und Direktzuordnung ist der Tagesanteil des Mietverhältnisses genau dieser
    zeitanteilige Faktor; an seine Stelle tritt der Gradtagsanteil, die übrige Rechnung bleibt.
    Personen bleiben zeitanteilig: Personentage sind zeitanteilig und damit nach § 9b Abs. 2 ebenso
    zulässig, und die Verordnung kennt für Heizkosten keinen Personenschlüssel (§ 7 Abs. 1 Satz 5).
    Verbrauch, Einzelbeträge und Gemeinschaft teilen nicht nach Tagen. Fällt die Anlage gar nicht
    unter die Verordnung (§ 2, § 11), ist die Wahl eine Festlegung von Mietfuchs; einstellbar bleibt
    sie über `change_split`.
17. **Eine Anlage wird nur über die Einrichtung zur eigenen Heizkostenabrechnung** (`PUT
    /api/heating-plants/:id/self`), damit Anteil, Zähler und Umstellung der Positionen in einer
    Transaktion entstehen. Wer zurück auf „Niemand“ stellt, bestätigt, dass die Positionen des offenen
    Zeitraums nach Wohnfläche verteilt werden (409 mit Liste, sonst `convertItems: 'area'`). Der
    Satz der 409 nennt die Folgen: Fällt die Anlage unter die Verordnung, darf jeder Mieter um den
    Kürzungssatz kürzen (§ 12 Abs. 1 Satz 1), und ein anderer Maßstab gilt nur für künftige Zeiträume,
    nach Erklärung gegenüber den Mietern (§ 6 Abs. 4).
18. **Positionen einer Anlage mit eigener Abrechnung haben immer den Schlüssel `heatingSystem`**
    (400 sonst), und Brennstoff hat bei verbundener Warmwasserbereitung das Ziel „Heizung und
    Warmwasser“ (§ 9 Abs. 1 Satz 1: die einheitlich entstandenen Kosten sind aufzuteilen).
19. **`heating.change-fee`** (hint) erscheint an jeder Heizposition, deren Beschreibung
    „Zwischenablesung“ oder „Nutzerwechsel“ enthält, nicht nur bei eigener Abrechnung (der Entwurf
    nennt nur den Code). Das ist die eine angekündigte Änderung für Bestandsnutzer. Der Text gibt den
    Leitsatz von BGH VIII ZR 19/07 wieder und lässt die Wirksamkeit einer Formularklausel offen; das
    AG Berlin-Hohenschönhausen (16 C 205/07) hält eine solche Klausel für unwirksam, zitiert als
    Instanzgericht. Eine wirksame Vereinbarung begründet einen Anspruch gegen den ausziehenden Mieter
    und macht die Gebühr nicht zu einer Position, die nach Schlüssel auf alle umgelegt wird. Derselbe
    Leitsatz gilt für die Nutzerwechselgebühr der Kaltwasserzähler; die Ausweitung ist eine weitere
    Änderung für Bestandsnutzer und wird nach Rückfrage als eigenes Issue vorgeschlagen (CLAUDE.md:
    Issues sind öffentlich), nicht in PR 10 gebaut.
20. **Golden F17 legt fest, was der Entwurf offenlässt:** drei Wohnungen à 100 m² mit Wärmezählern
    10.000 / 12.000 / 8.000 kWh und ohne Warmwasser (8.2 nennt nur Rechnungen und Bestand); für die
    Variante mit ⅓ Eigennutzung zeigen alle drei 10.000 kWh, damit das Gewicht genau ⅓ ist. Der
    Entwurf nennt 1.916,67 € als exakten Eigenanteil (8.2, 12.2 N8). Gedruckt wird je Zeile nach #202
    gerundet, je Zeile höchstens 1 ct daneben (6.2); die README leitet den gedruckten Wert von Hand
    her (**1.916,68 €**: der Restcent der Rechnung 2.500 € und des Übertrags „aus dem Vorrat“ geht bei
    Gleichstand an den Vermieter), und der Test nagelt ihn mit `assert.equal` fest, damit ein Fehler
    bei der Zuteilung des Restcents auffällt.
21. **Einrichtung über eine angelegte Anlage:** Wer „Ich selbst“ wählt, legt die Anlage zunächst mit
    `method = 'manual'` an (an keiner Zahl ändert sich etwas) und beantwortet danach Schritt 7, der sie
    über `PUT …/self` umstellt. Bricht er dort ab, bleibt die Anlage bei „Niemand“, und die Karte sagt
    das. Der Entwurf (11.2) beschreibt die Fragen, nicht ihre Speicherung in zwei Schritten.
22. **Zwischenablesung ab der Warngrenze: der Vermieter wählt.** § 9b Abs. 3 Alt. 2 sieht Gradtage
    bzw. Tage vor, wenn eine Ablesung „wegen des Zeitpunktes“ keine hinreichend genaue Ermittlung
    zulässt. Liegt eine Zwischenablesung ab `practice.reading-off-warning` neben dem Wechsel, legt
    Mietfuchs das nicht selbst fest: Ohne Antwort ist die Anlage nicht verteilbar
    (`heating.self-incomplete`, Grund `farInterim`), und auf der Seite Heizkosten wählt der Vermieter
    „Ablesung verwenden“ (`useReading`, Warnung `heating.interim-reading-far`) oder „Nach § 9b Abs. 3“
    (`imprecise`, dann wie ohne Zwischenablesung, Hinweis ohne Kürzung). Beide Antworten stehen in
    `interim_reading_gaps` neben „nicht möglich“ und „nicht durchgeführt“.
23. **Neue Spalte `readings.interim_for`** (Datum der Grenze, nur bei Ablesungen aus dem
    Mieterwechsel): die Bindung aus Nr. 9. Ältere Ablesungen haben keine und fallen unter die
    Nähe-Regel; an keiner Zahl ohne eigene Abrechnung ändert sich etwas.

---

### Task 1: Rechtsregister, Regeln und Lexikon

Drei Parameter (Entwurf 4.3, Spalte „PR 10“), vier Regeln (10.2) und vier Begriffe (10.3). Wortlaut
am 05.10.2026 gelesen: § 7 Abs. 1 Satz 2, Abs. 3, § 9 Abs. 2 Satz 6, Abs. 3, § 9b, § 12 Abs. 3
HeizkostenV (gesetze-im-internet.de, Fassung Art. 3 G v. 16.10.2023); BT-Drs. 20/7619 zu § 12 Abs. 3
(Installation der Ausstattung); Haufe-Kommentar „Ablesezeitpunkt“ (Entwurf 15.2 F2).

**Files:**
- Modify: `shared/law/heizkostenv.ts`, `shared/law/practice.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law-heizkosten.test.ts` (neu); Modify: `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes (PR 1, PR 3, PR 6): `LawParam`, `Source`, `germanDate`, `valueAt`, `onlyVersion`, `LAW_AS_OF`, `law`, `createLawLog`; in `heizkostenv.ts` `ENACTED`, `checked`, `hkvConsumptionShare`, `hkvCutNotByConsumption`; `GLOSSARY.hotWaterShare` (PR 6).
- Produces:
  - `hkvConsumptionShareForced: LawParam<number, 'periodStart'>` (`'hkv.consumption-share-forced'`, 70)
  - `type HeatPumpCapture = { readonly capturedBy: string; readonly installBy: string }`, `hkvHeatPumpCapture: LawParam<HeatPumpCapture, 'eventDate'>` (`'hkv.heat-pump.capture'`)
  - `type ReadingOffWarning = { readonly months: number; readonly winterMonths: readonly string[] }`, `practiceReadingOffWarning: LawParam<ReadingOffWarning, 'periodStart'>` (`'practice.reading-off-warning'`)
  - Regeln `heating-own-settlement`, `heating-tenant-change`, `heating-reading-date`, `heating-key-change` in `RULES`
  - `TermId` + `'baseCosts' | 'consumptionCosts' | 'interimReading' | 'heatMeter'`

- [ ] **Step 1: Write the failing tests**

`server/test/law-heizkosten.test.ts`:

```ts
// Rechtsregister für die eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 4.3, 10.2): drei
// Parameter, vier Regeln. Die Zahlen stehen nur hier im Register; die Berechnung fragt sie mit law().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvConsumptionShareForced, hkvHeatPumpCapture } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'

test('§ 7 Abs. 1 Satz 2 HeizkostenV: 70 % nach Verbrauch, nach dem Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(hkvConsumptionShareForced, { period: { from: '2025-01-01', to: '2025-12-31' } }, log), 70)
  assert.deepEqual(log.values.map((v) => [v.id, v.text]), [['hkv.consumption-share-forced', '70 %']])
  assert.equal(hkvConsumptionShareForced.norm, '§ 7 Abs. 1 Satz 2 HeizkostenV')
})

test('§ 12 Abs. 3 HeizkostenV: Erfassung am 01.10.2024, sonst Einbau bis 30.09.2025, Zeitregel nach Ereignis', () => {
  assert.equal(hkvHeatPumpCapture.timing, 'eventDate')
  const v = onlyVersion(hkvHeatPumpCapture)
  assert.deepEqual(v.value, { capturedBy: '2024-10-01', installBy: '2025-09-30' })
  assert.equal(v.source.checked, 'checked')
  assert.match(hkvHeatPumpCapture.describe(v.value), /01\.10\.2024.*30\.09\.2025/)
})

test('Warngrenze der Ablesung: ein Monat, Oktober bis April, als Praxis gekennzeichnet', () => {
  const v = onlyVersion(practiceReadingOffWarning)
  assert.deepEqual(v.value, { months: 1, winterMonths: ['10', '11', '12', '01', '02', '03', '04'] })
  assert.equal(v.source.rank, 'interpretation')
  assert.match(v.enacted, /Norm offen: VDI 2077/)
})

test('Register: die drei Parameter stehen in LAW_PARAMS', () => {
  const ids = LAW_PARAMS.map((p) => p.id)
  for (const id of ['hkv.consumption-share-forced', 'hkv.heat-pump.capture', 'practice.reading-off-warning']) assert.ok(ids.includes(id), id)
})

test('Regeln der eigenen Heizkostenabrechnung: unbefristet, mit Norm, die Zahlen aus dem Register', () => {
  for (const code of ['heating-own-settlement', 'heating-tenant-change', 'heating-reading-date', 'heating-key-change']) {
    const rule = RULES.find((r) => r.code === code) ?? assert.fail(`Regel ${code} fehlt`)
    assert.ok(rule.norm.trim() && rule.summary.trim(), code)
    assert.equal(ruleCoverage(code, '2025-01-01', '2025-12-31'), 'full', code)
  }
  const own = RULES.find((r) => r.code === 'heating-own-settlement')?.summary ?? ''
  assert.match(own, /mindestens 50 und höchstens 70 %/)
  assert.match(own, /bei der Heizung 70 %/)
  assert.match(RULES.find((r) => r.code === 'heating-tenant-change')?.norm ?? '', /VIII ZR 19\/07/)
  assert.match(RULES.find((r) => r.code === 'heating-reading-date')?.norm ?? '', /4 RE-Miet 1\/88/)
  assert.match(RULES.find((r) => r.code === 'heating-key-change')?.norm ?? '', /§ 6 Abs\. 4 HeizkostenV/)
})
```

In `server/test/law-history.test.ts` am Ende von `SHIPPED` ergänzen:

```ts
  // 0.11.0 (Heizung PR 10, #99)
  'hkv.consumption-share-forced|||70',
  'hkv.heat-pump.capture|||{"capturedBy":"2024-10-01","installBy":"2025-09-30"}',
  'practice.reading-off-warning|||{"months":1,"winterMonths":["10","11","12","01","02","03","04"]}',
```

An `server/test/glossary.test.ts` anhängen:

```ts
test('Eigene Heizkostenabrechnung: vier Begriffe mit nachgerechneten Beispielen (Heizung PR 10, Entwurf 10.3)', () => {
  // Beispiel A aus 8.6: Topf Heizung 5.628 €, davon 30 % Grundkosten, Wohnung mit 60 von 200 m².
  assert.match(GLOSSARY.baseCosts.example, /5\.628,00 €.*1\.688,40 €.*506,52 €/s)
  assert.equal(Math.round(562800 * 0.3), 168840)
  assert.equal(Math.round((168840 * 60) / 200), 50652)
  // 70 % = 3.939,60 €, davon 12.000 von 40.000 kWh = 1.181,88 €.
  assert.match(GLOSSARY.consumptionCosts.example, /3\.939,60 €.*12\.000 von 40\.000 kWh.*1\.181,88 €/s)
  assert.equal(Math.round(562800 * 0.7), 393960)
  assert.equal(Math.round((393960 * 12000) / 40000), 118188)
  // Wechsel zum 30.09.: 640 ‰ und 360 ‰ Gradtage, zeitanteilig 273 und 92 Tage.
  assert.match(GLOSSARY.interimReading.example, /324,17 €.*182,35 €.*378,85 €.*127,67 €/s)
  assert.equal(Math.round(50652 * 0.64), 32417)
  assert.equal(Math.round(50652 * 0.36), 18235)
  assert.equal(Math.round((50652 * 273) / 365), 37885)
  assert.equal(Math.round((50652 * 92) / 365), 12767)
  assert.match(GLOSSARY.interimReading.norm, /§ 9b HeizkostenV/)
  assert.match(GLOSSARY.interimReading.needed, /VIII ZR 19\/07/)
  assert.match(GLOSSARY.heatMeter.example, /13\.000 kWh.*12\.000 kWh/s)
  // Beide Lesarten beim gemessenen Warmwasseranteil (15.1 Nr. 9), mit beiden Werten.
  assert.match(GLOSSARY.hotWaterShare.example, /15,0 %.*16,65 %/s)
  assert.match(GLOSSARY.hotWaterShare.example, /Norm offen: VDI 2077/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law-heizkosten.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL. `law-heizkosten.test.ts` mit `does not provide an export named 'hkvConsumptionShareForced'`,
`law-history.test.ts` mit „ausgelieferte Fassung geändert oder entfernt: hkv.consumption-share-forced…“,
`glossary.test.ts` mit `Cannot read properties of undefined (reading 'example')`.

- [ ] **Step 3: Parameter (`shared/law/heizkostenv.ts`)**

Ans Dateiende:

```ts
// § 7 Abs. 1 Satz 2 HeizkostenV (Heizung PR 10): In Gebäuden, die das Anforderungsniveau der
// Wärmeschutzverordnung vom 16.08.1994 nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt
// werden und deren freiliegende Leitungen der Wärmeverteilung überwiegend gedämmt sind, sind 70 % der
// Kosten des Betriebs der zentralen Heizungsanlage nach Verbrauch zu verteilen. Bei Wärmelieferung
// nicht: § 7 Abs. 3 verweist nur auf Abs. 1 Satz 1 und 3 bis 5 (R-A2). Welche Energieträger eine
// Öl- oder Gasheizung sind, entscheidet server/src/heating.ts (`OIL_OR_GAS`).
export const hkvConsumptionShareForced: LawParam<number, 'periodStart'> = {
  id: 'hkv.consumption-share-forced',
  title: 'Pflichtanteil nach Verbrauch bei gedämmten Leitungen',
  norm: '§ 7 Abs. 1 Satz 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 70,
    source: checked('§ 7 Abs. 1 Satz 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__7.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// § 12 Abs. 3 HeizkostenV (Heizung PR 10): Wird der Verbrauch der von Wärmepumpen versorgten Nutzer am
// 01.10.2024 noch nicht erfasst, ist bis zum Ablauf des 30.09.2025 eine Ausstattung zur
// Verbrauchserfassung zu installieren; die Verordnung gilt dann ab dem Abrechnungszeitraum, der nach
// der Installation beginnt (Satz 2; BT-Drs. 20/7619: Installation der Ausstattung). Zeitregel nach
// dem Ereignis (Entwurf 3.13). Ohne Erfassung nach dem 30.09.2025 rechnet Mietfuchs mit 15 % nach
// § 12 Abs. 1 Satz 1, als Auslegung (Entwurf 15.1 Nr. 22, `heatPumpVerdict` in heating.ts).
export type HeatPumpCapture = { readonly capturedBy: string; readonly installBy: string }
export const hkvHeatPumpCapture: LawParam<HeatPumpCapture, 'eventDate'> = {
  id: 'hkv.heat-pump.capture',
  title: 'Verbrauchserfassung bei Wärmepumpen',
  norm: '§ 12 Abs. 3 HeizkostenV',
  timing: 'eventDate',
  versions: [{
    value: { capturedBy: '2024-10-01', installBy: '2025-09-30' },
    source: checked('§ 12 Abs. 3 HeizkostenV; BT-Drs. 20/7619', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `Verbrauch am ${germanDate(v.capturedBy)} erfasst, sonst Erfassung bis ${germanDate(v.installBy)}; die Verordnung gilt ab dem Zeitraum nach dem Einbau`,
}
```

- [ ] **Step 4: Warngrenze (`shared/law/practice.ts`)**

Ans Dateiende:

```ts
// **Ablesung neben dem Stichtag oder dem Wechsel** (Heizung PR 10, Entwurf 3.5, 15.2 F2 und F3).
// Gerechnet wird mit dem abgelesenen Wert, wie er ist (OLG Schleswig, RE vom 04.10.1990, 4 RE-Miet
// 1/88: unschädlich, wenn in der Zwischenzeit wenig verbraucht wird; LG Osnabrück, NZM 2004, 95: keine
// Rückrechnung nach Gradtagen; beide sekundär über Haufe und mietrecht.org). Wie weit daneben noch
// zulässig ist, sagt weder die Verordnung noch die Rechtsprechung; AG Nordhorn, 3 C 15/03, hielt eine
// Ablesung am 20.02. für zu spät. Der Kommentar bei Haufe: „In den Wintermonaten ist eine Abweichung
// von einem Monat grundsätzlich als nicht zulässig anzusehen.“ Daraus die Warngrenze: ab einem Monat
// Abweichung, wenn ein Monat von Oktober bis April dazwischen liegt. Literatur, keine Rechtsquelle;
// ⟨Norm offen: VDI 2077⟩.
export type ReadingOffWarning = { readonly months: number; readonly winterMonths: readonly string[] }
export const practiceReadingOffWarning: LawParam<ReadingOffWarning, 'periodStart'> = {
  id: 'practice.reading-off-warning',
  title: 'Warngrenze für Ablesungen neben dem Stichtag',
  norm: 'Kommentar zum Ablesezeitpunkt (Haufe); OLG Schleswig, RE vom 04.10.1990, 4 RE-Miet 1/88',
  timing: 'periodStart',
  versions: [{
    value: { months: 1, winterMonths: ['10', '11', '12', '01', '02', '03', '04'] },
    source: {
      rank: 'interpretation',
      cite: 'Haufe, HeizKV: Ablesung und Abrechnungs- und Verbrauchsinformation, 3 Ablesezeitpunkt',
      url: 'https://www.haufe.de/id/beitrag/heizkv-ablesung-und-abrechnungs-und-verbrauchsinformat-3-ablesezeitpunkt-HI14901091.html',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Festlegung von Mietfuchs (Entwurf 15.2 F2, F3); ⟨Norm offen: VDI 2077⟩',
  }],
  describe: (v) => `Warnung ab ${v.months === 1 ? 'einem Monat' : `${v.months} Monaten`} Abweichung, wenn ein Monat von Oktober bis April dazwischen liegt`,
}
```

- [ ] **Step 5: In die Liste (`shared/law/params.ts`)**

Den Import aus `./heizkostenv.ts` um `hkvConsumptionShareForced, hkvHeatPumpCapture` ergänzen, den aus
`./practice.ts` um `practiceReadingOffWarning`, und in `LAW_PARAMS` einreihen:

```ts
  hkvConsumptionShare,
  hkvConsumptionShareForced,
```

```ts
  hkvDegreeDays,
  hkvHeatPumpCapture,
```

```ts
  practiceReadingOffWarning,
  practiceVacancyPersons,
```

(Die Reihenfolge ist alphabetisch nach Kennung, wie in PR 1; wo PR 3 bis PR 9 anders einreihen, gilt
deren Reihenfolge.)

In `server/test/law.test.ts` im Test „Register: jede Konstante vom Typ LawParam in shared/law/ steht in
LAW_PARAMS“ das Objekt `modules` um `hkvConsumptionShareForced, hkvHeatPumpCapture,
practiceReadingOffWarning` ergänzen und die drei Namen in die Importe aus
`'../../shared/law/heizkostenv.ts'` und `'../../shared/law/practice.ts'` aufnehmen; sonst meldet der
Test „hkvConsumptionShareForced fehlt in diesem Test“.

- [ ] **Step 6: Regeln (`shared/law/rules.ts`)**

Hinter `const remoteCut = valueAt(hkvCutRemoteReading, LAW_AS_OF)`:

```ts
const forcedShare = valueAt(hkvConsumptionShareForced, LAW_AS_OF)
```

(`hkvConsumptionShareForced` in den Import aus `./heizkostenv.ts` aufnehmen.) Ans Ende von `RULES`
(vor `]`):

```ts
  // Heizung PR 10 (#99, Entwurf 10.2): die eigene Heizkostenabrechnung. Wortlaut gelesen am
  // 05.10.2026 auf gesetze-im-internet.de (HeizkostenV §§ 6 bis 9b in der Fassung Art. 3 G v.
  // 16.10.2023).
  {
    code: 'heating-own-settlement',
    title: 'Eigene Heizkostenabrechnung nach der Heizkostenverordnung',
    norm: '§§ 6 bis 9 HeizkostenV',
    summary:
      `Von den Kosten der Heizung und des Warmwassers sind mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, der Rest bei der Heizung nach Wohn- oder Nutzfläche oder der beheizten Fläche, beim Warmwasser nach Wohn- oder Nutzfläche. ` +
      'Bereitet die Heizung auch das Warmwasser, wird der Anteil des Warmwassers mit einem Wärmezähler gemessen. ' +
      `In Gebäuden mit Öl- oder Gasheizung, die das Niveau der Wärmeschutzverordnung von 1994 nicht erreichen und deren freiliegende Leitungen überwiegend gedämmt sind, sind es bei der Heizung ${forcedShare} %. ` +
      'Umgelegt werden die Kosten des verbrauchten Brennstoffs, nicht der gelieferte.',
  },
  {
    code: 'heating-tenant-change',
    title: 'Mieterwechsel bei Heizung und Warmwasser',
    norm: '§ 9b HeizkostenV; BGH, Urteil vom 14.11.2007, VIII ZR 19/07',
    summary:
      'Zieht ein Mieter während des Abrechnungszeitraums aus, ist eine Zwischenablesung vorzunehmen. Die Verbrauchskosten werden nach ihr aufgeteilt, die übrigen Heizkosten nach Gradtagszahlen oder zeitanteilig, die übrigen Warmwasserkosten zeitanteilig. ' +
      'Ist die Zwischenablesung nicht möglich, werden die gesamten Kosten so aufgeteilt. Abweichende Vereinbarungen bleiben unberührt. ' +
      'Die Kosten der Zwischenablesung trägt der Vermieter, soweit nichts anderes vereinbart ist.',
  },
  {
    code: 'heating-reading-date',
    title: 'Ablesung neben dem Stichtag',
    norm: 'OLG Schleswig, Rechtsentscheid vom 04.10.1990, 4 RE-Miet 1/88; § 9a HeizkostenV; BGH, Urteil vom 16.11.2005, VIII ZR 373/04',
    summary:
      'Abgelesen wird zum Ende des Abrechnungszeitraums oder zum Wechsel. Eine Ablesung einige Tage daneben ist unschädlich, wenn in der Zwischenzeit wenig verbraucht wird; zurückgerechnet wird nicht. ' +
      'Geschätzt werden darf nur, wenn ein Gerät ausfällt oder ein anderer zwingender Grund vorliegt, und zwingend ist ein Grund erst, wenn sich der Fehler nicht mehr beheben lässt.',
  },
  {
    code: 'heating-key-change',
    title: 'Wechsel des Anteils nach Verbrauch',
    norm: '§ 6 Abs. 4 HeizkostenV',
    summary:
      'Den Anteil nach Verbrauch und die übrigen Maßstäbe wählt der Gebäudeeigentümer. Ändern darf er sie nach der ersten Festlegung nur bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen, ' +
      'durch Erklärung gegenüber den Nutzern und nur mit Wirkung zum Beginn eines Abrechnungszeitraums.',
  },
```

Prüft `server/test/rules.test.ts` irgendwo eine vollständige Liste der Codes (etwa in „rulesFor nennt
nur Regeln, deren Gültigkeit den Zeitraum berührt“), kommen die vier Codes dort in derselben
Reihenfolge dazu; sonst bleibt der Test unverändert.

- [ ] **Step 7: Lexikon (`shared/glossary.ts`)**

`hkvCutNotByConsumption` steht dort schon (PR 1). Im Eintrag `hotWaterShare` (PR 6) `example`
ersetzen durch:

```ts
    example:
      'Gasrechnung 60.000 kWh nach Brennwert, der Wärmezähler am Warmwasserspeicher zeigt 9.000 kWh: Mietfuchs rechnet nach dem Wortlaut der Verordnung 9.000 ÷ 60.000 = 15,0 %. ' +
      'Wer die gemessene Wärme wie einen Formelwert auf den Brennwert umrechnet, käme auf 16,65 %; welche Lesart die technische Regel meint, ist nicht geklärt (⟨Norm offen: VDI 2077⟩). ' +
      `Hat der Messdienst die Wärme ohne zwingenden Grund mit einer Formel bestimmt, darf der Mieter seinen Anteil um ${CUT} % kürzen; bei 1.000 € Heiz- und Warmwasserkosten um ${(1000 * CUT) / 100} €.`,
```

Hinter `hotWaterShare` einfügen:

```ts
  // Heizung PR 10 (#99, Entwurf 10.3): die eigene Heizkostenabrechnung. Zahlen aus Beispiel A (8.6).
  baseCosts: {
    title: 'Grundkosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nicht nach Verbrauch, sondern nach der Fläche verteilt wird; bei der Heizung auch nach der beheizten Fläche.',
    example: 'Topf Heizung 5.628,00 €, davon 30 % Grundkosten = 1.688,40 €. Eine Wohnung mit 60 von 200 m² trägt davon 506,52 €.',
    norm: '§ 7 Abs. 1 Satz 5, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Mietfuchs rechnet sie aus dem Anteil, den Sie nach Verbrauch verteilen.',
  },
  consumptionCosts: {
    title: 'Verbrauchskosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nach dem gemessenen Verbrauch verteilt wird, bei der Heizung nach Kilowattstunden, beim Warmwasser nach Kubikmetern.',
    example: 'Topf Heizung 5.628,00 €, davon 70 % nach Verbrauch = 3.939,60 €. Eine Wohnung mit 12.000 von 40.000 kWh trägt davon 1.181,88 €.',
    norm: '§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Ohne Zähler darf jeder Mieter seinen Anteil kürzen. Bei einer Öl- oder Gasheizung in einem Haus mit Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen ist der Anteil vorgeschrieben (§ 7 Abs. 1 Satz 2 HeizkostenV). Dass eine Flüssiggasheizung dazu zählt, ist eine Auslegung von Mietfuchs: Der Wortlaut sagt „Gasheizung“ ohne Einschränkung, wo die Verordnung Erdgas meint, sagt sie es (§ 9 Abs. 2 Satz 6 und die Tabelle in § 9 Abs. 3), und die Begründung (BR-Drs. 570/08) nennt Öl- und Gasheizungen und grenzt nur gegen Fernwärme ab. Der vorgeschriebene Anteil ist unter beiden Lesarten zulässig.',
  },
  interimReading: {
    title: 'Zwischenablesung',
    short: 'Die Ablesung der Wärme- und Warmwasserzähler, wenn ein Mieter mitten im Abrechnungszeitraum aus- oder einzieht. Nach ihr werden die Verbrauchskosten aufgeteilt; die übrigen Heizkosten nach Gradtagszahlen oder zeitanteilig, die übrigen Warmwasserkosten zeitanteilig.',
    example: 'Wechsel zum 30.09.: Grundkosten Heizung der Wohnung 506,52 €. Nach Gradtagen (Januar bis September 640 Promille) trägt der Vormieter 324,17 € und der Nachmieter 182,35 €; zeitanteilig wären es 378,85 € und 127,67 €.',
    norm: '§ 9b HeizkostenV',
    needed: 'Ja, bei jedem Mieterwechsel. Ist sie nicht möglich, werden die gesamten Kosten der Wohnung nach Gradtagen bzw. Tagen geteilt. Die Kosten der Zwischenablesung trägt der Vermieter, soweit nichts anderes vereinbart ist (BGH, Urteil vom 14.11.2007, VIII ZR 19/07); ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden. Das AG Berlin-Hohenschönhausen (16 C 205/07) hält sie für unwirksam; das ist die Entscheidung eines Amtsgerichts.',
  },
  heatMeter: {
    title: 'Wärmezähler',
    short: 'Ein geeichtes Messgerät, das die Wärme in Kilowattstunden misst, etwa an der Leitung einer Wohnung oder am Warmwasserspeicher.',
    example: 'Der Wärmezähler der Wohnung zeigt am 31.12.2024 1.000 kWh und am 31.12.2025 13.000 kWh: verbraucht sind 12.000 kWh.',
    norm: '§ 5 Abs. 1 HeizkostenV',
    needed: 'Wenn Sie die Heizkosten selbst abrechnen. Ein Wärmezähler am Warmwasserspeicher misst den Anteil des Warmwassers; ohne ihn ist eine Formel nur bei unzumutbar hohem Aufwand erlaubt.',
  },
```

(`CUT` ist die Konstante aus PR 1 für `hkvCutNotByConsumption`.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law-heizkosten.test.ts test/law-history.test.ts test/law.test.ts test/law-literals.test.ts test/glossary.test.ts test/rules.test.ts test/law-wording.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. `law.test.ts` findet die drei Parameter in `LAW_PARAMS` und prüft Quelle, URL und
Abruf; `law-wording.test.ts` bleibt grün, weil keine bestehende Regel ihren Text ändert.

- [ ] **Step 9: Commit**

```bash
git add shared/law shared/glossary.ts server/test/law-heizkosten.test.ts server/test/law-history.test.ts server/test/law.test.ts server/test/glossary.test.ts server/test/rules.test.ts
git commit -m "Heizkostenabrechnung: Pflichtanteil, Wärmepumpen und Warngrenze der Ablesung im Rechtsregister

Vier Regeln (eigene Abrechnung, Mieterwechsel, Ablesezeitpunkt, Wechsel des Maßstabs) und vier
Begriffe; der Warmwasseranteil nennt beide Lesarten beim gemessenen Wert.

Refs #99"
```

---

### Task 2: Datenmodell und Migrationen 0026/0027

Vier Spalten an `heating_plants` (Warmwasser, Erfassung, Flächenbasis der Heizung, Einbau der
Wärmepumpe), das Ziel an `cost_items`, die Grenze einer Ablesung aus dem Mieterwechsel an `readings`
(`interim_for`, Abweichung 23), der Schlüssel `heatingSystem` und die Tabelle
`interim_reading_gaps`. Zwei erzeugte Schritte, weil drizzle-kit beim Neubau einer Tabelle die neuen
Spalten aus der alten kopieren wollte (README „Neue Spalten und geänderte Bedingungen nie in einem
Schritt“). Dazu die Typen des Ausweises, die Task 9 füllt.

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/calc.ts` (nur `KEY_LABELS`, `KEY_PHRASES`), `server/src/bookingPlan.ts`, `server/src/store.ts`, `client/src/types.ts`, `client/src/costForm.ts`
- Create (erzeugt): `server/drizzle/0026_heizkostenabrechnung.sql`, `server/drizzle/0027_heizkostenabrechnung_bedingungen.sql`, `server/drizzle/meta/0026_snapshot.json`, `server/drizzle/meta/0027_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `client/src/costForm.test.ts`

**Interfaces:**
- Consumes (PR 3, 4, 6, 7): `HeatingPart`, `HEATING_PARTS`, `HeatingPlant`, `HeatingPeriodData`, `ChangeSplit`, `InsulationRule`, `HeatingStatement`, `HeatingPeriodView`, `heatingPlants`, `costItems`, `units`, `exactly`, `oneOf`, `COST_KEYS`.
- Produces:
  - `shared/types.ts`: `CostKey` + `'heatingSystem'`; `HeatingTarget = 'both' | 'heating' | 'water'`; `HotWater = 'combined' | 'separate' | 'none'`; `CaptureMethod = 'heatMeter' | 'hca' | 'serviceValues'`; `AreaBasisHeat = 'area' | 'heatedArea'`; `InterimGapStatus = 'impossible' | 'missed' | 'imprecise' | 'useReading'`; `Reading.interimFor?: string`; `InterimGap = { unitId: string; date: string; status: InterimGapStatus; reason: string }`; `HeatingDistribution`; `SelfPot`, `SelfRole`, `SelfPotView`, `SelfReadingView`, `SelfBoundaryView`, `SelfUserView`, `SelfUnitView`, `SelfHeatingStatement` (Felder in Step 3); `HeatingPlant.hotWater: HotWater`, `.capture: CaptureMethod | null`, `.areaBasisHeat: AreaBasisHeat`, `.heatPumpInstalledOn: string | null`; `CostItem.heatingTarget?: HeatingTarget`; `HeatingStatement.self?: SelfHeatingStatement`; `HeatingPeriodView.distribution?: HeatingDistribution | null`
  - schema.ts: `HEATING_TARGETS`, `HOT_WATER`, `CAPTURE_METHODS`, `AREA_BASES_HEAT`, `INTERIM_GAP_STATUS`, `interimReadingGaps`; Spalten `heatingPlants.hotWater`, `.capture`, `.areaBasisHeat`, `.heatPumpInstalledOn`, `costItems.heatingTarget`, `readings.interimFor`
  - `KEY_LABELS.heatingSystem` (Server: `'nach Heizkostenverordnung'`, Client: `'nach Heizkostenverordnung (eigene Heizkostenabrechnung)'`)

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um `InterimGap`
ergänzen und hinter den Zeilen der Heizanlage (PR 4) einfügen:

```ts
// --- Eigene Heizkostenabrechnung (Heizung PR 10) ---
type _InterimGaps = Assert<Matches<typeof schema.interimReadingGaps.$inferSelect, InterimGap>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ in die erwartete Liste hinter
`'heating_plants',` (alphabetisch, wie die Liste geführt wird) einfügen:

```ts
      'interim_reading_gaps',
```

Ans Ende anhängen:

```ts
// ---------- Eigene Heizkostenabrechnung (Heizung PR 10) ----------

test('Heizkostenabrechnung: Vorgaben an der Anlage, Erfassung Pflicht bei eigener Abrechnung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'gas')")
    assert.deepEqual(connection.rows('SELECT hot_water, capture, area_basis_heat, heat_pump_installed_on FROM heating_plants')[0], ['combined', null, 'area', null])
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp2', 'objekt-1', 'gas', 'self')"), 'eigene Abrechnung ohne Erfassung')
    assert.equal(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, method, capture) VALUES ('hp3', 'objekt-1', 'gas', 'self', 'heatMeter')"), null)
    assert.ok(rejects(connection, "UPDATE heating_plants SET hot_water = 'zentral' WHERE id = 'hp1'"), 'unbekannte Warmwasserbereitung')
    assert.ok(rejects(connection, "UPDATE heating_plants SET capture = 'verdunster' WHERE id = 'hp1'"), 'unbekannte Erfassung')
    assert.ok(rejects(connection, "UPDATE heating_plants SET area_basis_heat = 'raum' WHERE id = 'hp1'"), 'unbekannte Flächenbasis')
  } finally {
    cleanup()
  }
})

test('Heizkostenabrechnung: Schlüssel heatingSystem nur mit Ziel, Teil und Anlage; Ziel nur bei Heizkosten', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO heating_plants (id, property_id, energy, method, capture) VALUES ('hp1', 'objekt-1', 'gas', 'self', 'heatMeter')")
    const insert = (id: string, cols: string, vals: string) =>
      rejects(connection, `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${cols}) VALUES ('${id}', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Gas', 600000, ${vals})`)
    assert.equal(insert('c1', ', heating_plant_id, heating_part, heating_target', "'heatingSystem', 'hp1', 'fuel', 'both'"), null)
    assert.ok(insert('c2', ', heating_plant_id, heating_part', "'heatingSystem', 'hp1', 'fuel'"), 'ohne Ziel')
    assert.ok(insert('c3', ', heating_plant_id, heating_target', "'heatingSystem', 'hp1', 'both'"), 'ohne Teil')
    assert.ok(insert('c4', ', heating_part, heating_target', "'heatingSystem', 'fuel', 'both'"), 'ohne Anlage')
    assert.ok(insert('c5', ', heating_plant_id, heating_part, heating_target', "'heatingSystem', 'hp1', 'fuel', 'kalt'"), 'unbekanntes Ziel')
    // „Nur Heizung“ bei freien Schlüsseln (A2, B7): ein Ziel ohne den neuen Schlüssel ist erlaubt.
    assert.equal(insert('c6', ', heating_target', "'area', 'heating'"), null)
    assert.ok(
      rejects(connection, "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_target) VALUES ('c7', 'objekt-1', '2025-01', 'Grundsteuer', 'Grundsteuer', 48000, 'area', 'heating')"),
      'Ziel bei einer anderen Kostenart',
    )
  } finally {
    cleanup()
  }
})

test('Heizkostenabrechnung: Antworten zu fehlenden Zwischenablesungen fallen mit der Wohnung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    assert.equal(rejects(connection, "INSERT INTO interim_reading_gaps (unit_id, date, status, reason) VALUES ('u1', '2025-09-30', 'impossible', 'Mieter verreist')"), null)
    assert.ok(rejects(connection, "INSERT INTO interim_reading_gaps (unit_id, date, status) VALUES ('u1', '2025-09-30', 'missed')"), 'dieselbe Grenze zweimal')
    assert.ok(rejects(connection, "INSERT INTO interim_reading_gaps (unit_id, date, status) VALUES ('u1', '2025-10-31', 'vergessen')"), 'unbekannte Antwort')
    assert.ok(rejects(connection, "INSERT INTO interim_reading_gaps (unit_id, date, status) VALUES ('u1', '30.09.2025', 'missed')"), 'kein ISO-Datum')
    connection.exec("DELETE FROM units WHERE id = 'u1'")
    assert.equal(Number(connection.rows('SELECT count(*) FROM interim_reading_gaps')[0]?.[0]), 0)
  } finally {
    cleanup()
  }
})
```

(b) `client/src/costForm.test.ts` anhängen (den Import aus `'./costForm'` um `costKeyOptions` ergänzen,
falls nicht da):

```ts
test('Der Schlüssel „nach Heizkostenverordnung“ steht nur bei einer Position, die ihn schon hat (Heizung PR 10, bis Task 12)', () => {
  expect(costKeyOptions([], 'area')).not.toContain('heatingSystem')
  expect(costKeyOptions([], 'heatingSystem')).toContain('heatingSystem')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'interimReadingGaps' does not exist` in schema.test.ts und
`Argument of type '"heatingSystem"' is not assignable to parameter of type 'CostKey'` in
costForm.test.ts.

- [ ] **Step 3: Typen (`shared/types.ts`)**

`CostItem` bekommt hinter `heatingPart?: HeatingPart` (PR 3):

```ts
  // Wohin die Position bei der eigenen Heizkostenabrechnung gehört (Heizung PR 10, Entwurf 5.3):
  // Heizung und Warmwasser zusammen, nur Heizung oder nur Warmwasser. Pflicht beim Schlüssel
  // `heatingSystem`; bei freien Schlüsseln heißt „nur Heizung“, dass beim Mieterwechsel die Gradtage
  // gelten (§ 9b Abs. 2, A2, B7). Nur bei der Kostenart „Heizung und Warmwasser“. Wie `heatingPart`
  // (PR 3): fehlt, wenn nicht gesetzt.
  heatingTarget?: HeatingTarget
```

`HeatingPlant` (PR 4) bekommt als letzte Felder:

```ts
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3). Wird das Warmwasser mit derselben
  // Anlage bereitet (`combined`, dann wird nach § 9 aufgeteilt), getrennt (`separate`) oder gar nicht
  // (`none`)? Womit wird erfasst (bei `self` Pflicht; Heizkostenverteiler und Werte eines
  // Ablesedienstes kommen mit PR 12)? Grundkosten Heizung nach Wohnfläche oder beheizter Fläche
  // (§ 7 Abs. 1 Satz 5; Warmwasser immer nach Wohnfläche, § 8 Abs. 1). Und bei einer Wärmepumpe, wann
  // sie eingebaut wurde (§ 12 Abs. 3, Abweichung 1 des Plans).
  hotWater: HotWater
  capture: CaptureMethod | null
  areaBasisHeat: AreaBasisHeat
  heatPumpInstalledOn: string | null
```

`HeatingStatement` (PR 6) bekommt als letztes Feld:

```ts
  // Die eigene Heizkostenabrechnung dieser Heizperiode (Heizung PR 10), nur bei `method = 'self'`.
  self?: SelfHeatingStatement
```

`HeatingPeriodView` (PR 6) bekommt als letztes Feld:

```ts
  // Anteil nach Verbrauch dieser Heizperiode (Heizung PR 10), nur bei `method = 'self'`.
  distribution?: HeatingDistribution | null
```

`Reading` bekommt als letztes Feld (Abweichung 23):

```ts
  // Bei einer Ablesung aus dem Mieterwechsel (#150) die Grenze, zu der sie gehört: der letzte Tag des
  // bisherigen Nutzers (Heizung PR 10). Fehlt bei allen übrigen Ablesungen.
  interimFor?: string
```

`CostKey`:

```ts
export type CostKey = 'area' | 'persons' | 'units' | 'direct' | 'meter' | 'custom' | 'external' | 'amounts' | 'heatingSystem'
```

Ans Dateiende:

```ts
// ---------- Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3, 8) ----------

export type HeatingTarget = 'both' | 'heating' | 'water'
export type HotWater = 'combined' | 'separate' | 'none'
export type CaptureMethod = 'heatMeter' | 'hca' | 'serviceValues'
export type AreaBasisHeat = 'area' | 'heatedArea'

// Antwort des Vermieters zur Zwischenablesung an einer Grenze (Entwurf 3.5): keine, weil „nicht
// möglich“ (§ 9b Abs. 3 Alt. 1) oder „nicht durchgeführt“; oder eine Ablesung ab der Warngrenze, die
// er nach § 9b Abs. 3 Alt. 2 als ungenau behandelt (`imprecise`) oder bewusst verwendet
// (`useReading`). `date` ist der letzte Tag des bisherigen Nutzers (Abweichungen 8 und 22 des Plans).
export type InterimGapStatus = 'impossible' | 'missed' | 'imprecise' | 'useReading'
export type InterimGap = { unitId: string; date: string; status: InterimGapStatus; reason: string }

// Der Anteil nach Verbrauch einer Heizperiode, wie ihn die Seite Heizkosten zeigt (§ 6 Abs. 4, § 7
// Abs. 1 Satz 2). `own`: eigene Zeile dieser Heizperiode; `effective`: was gilt, eigen oder aus der
// Vorperiode; `begun`: die Heizperiode hat begonnen, ein anderer Anteil ist gesperrt; `first`: es
// gibt noch keinen Anteil.
export type HeatingDistribution = {
  own: { heating: number | null; water: number | null; insulationRule: InsulationRule | null }
  // `water` ist null, wenn es kein zentrales Warmwasser gibt oder der Wert fehlt (§ 8 Abs. 1 verlangt
  // eine eigene Wahl, Abweichung 14).
  effective: { heating: number; water: number | null; insulationRule: InsulationRule | null } | null
  inherited: boolean
  begun: boolean
  first: boolean
  forcedPercent: number | null
}

export type SelfPot = 'heating' | 'water'
export type SelfRole = 'tenancy' | 'vacancy' | 'self' | 'outside'
// Ein Topf im Ausweis (Entwurf 8.8): Kosten, Anteil nach Verbrauch, Gesamteinheiten, Preis je
// Einheit. `byAreaOnly`: kein Verbrauch erfasst, nur nach Fläche verteilt.
export type SelfPotView = {
  pot: SelfPot
  costCents: number
  consumptionPct: number
  byAreaOnly: boolean
  areaM2: number
  consumption: number
  consumptionUnit: 'kWh' | 'm³'
  baseCentsPerM2: number
  consumptionCentsPerUnit: number | null
}
// Eine Ablesung an einer Grenze: `date` null heißt, es gibt keine.
export type SelfReadingView = { meterId: string; meterName: string; pot: SelfPot; boundary: string; date: string | null; value: number | null }
// Eine Grenze einer Wohnung für die Ampel der Seite Heizkosten.
export type SelfBoundaryView = {
  date: string
  kind: 'start' | 'end' | 'change'
  status: 'read' | 'off' | 'missing'
  offDays: number
  // ab der Warngrenze neben dem Wechsel (`practice.reading-off-warning`); dann wählt der Vermieter
  far: boolean
  gap: InterimGapStatus | null
}
// Ein Nutzer einer Wohnung (Mieter, Leerstand, Eigennutzung, außerhalb) mit seinen Werten.
export type SelfUserView = {
  key: string
  role: SelfRole
  tenancyId: string | null
  label: string
  from: string
  to: string
  days: number
  degreeDayPermille: number
  heatingConsumption: number | null
  waterConsumption: number | null
  heatingGroup: boolean
  waterGroup: boolean
  heatingCents: number
  waterCents: number
  // Der Teil seines CO₂-Abzugs, der auf den Topf entfällt (Abweichung 15): Topfbetrag nach Abzug =
  // heatingCents − heatingCo2Cents. 0 ohne Abzug.
  heatingCo2Cents: number
  waterCo2Cents: number
}
export type SelfUnitView = {
  unitId: string
  unitName: string
  areaM2: number
  heatAreaM2: number
  readings: SelfReadingView[]
  boundaries: SelfBoundaryView[]
  users: SelfUserView[]
}
export type SelfHeatingStatement = {
  ok: boolean
  heatPump: 'applies' | 'notYet' | 'missing' | null
  changeSplit: ChangeSplit
  areaBasisHeat: AreaBasisHeat
  hotWater: HotWater
  alpha: { percent: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean } | null
  shares: { heating: number; water: number | null; forced: boolean; previous: { heating: number; water: number | null } | null } | null
  pots: SelfPotView[]
  units: SelfUnitView[]
}
```

- [ ] **Step 4: Erster Schritt: Spalten und Tabelle (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `AreaBasisHeat, CaptureMethod, HeatingTarget,
HotWater, InterimGapStatus` ergänzen. Bei den Listen der Heizanlage (PR 4) ergänzen:

```ts
export const HEATING_TARGETS = exactly<HeatingTarget>()(['both', 'heating', 'water'] as const)
export const HOT_WATER = exactly<HotWater>()(['combined', 'separate', 'none'] as const)
export const CAPTURE_METHODS = exactly<CaptureMethod>()(['heatMeter', 'hca', 'serviceValues'] as const)
export const AREA_BASES_HEAT = exactly<AreaBasisHeat>()(['area', 'heatedArea'] as const)
export const INTERIM_GAP_STATUS = exactly<InterimGapStatus>()(['impossible', 'missed', 'imprecise', 'useReading'] as const)
```

In `heatingPlants` als letzte Spalten (hinter denen von PR 7):

```ts
    // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3). Bedingungen im zweiten Schritt.
    hotWater: text('hot_water', { enum: HOT_WATER }).notNull().default('combined'),
    capture: text('capture', { enum: CAPTURE_METHODS }),
    areaBasisHeat: text('area_basis_heat', { enum: AREA_BASES_HEAT }).notNull().default('area'),
    heatPumpInstalledOn: text('heat_pump_installed_on'),
```

In `costItems` als letzte Spalte (hinter `fuelDeliveryId` aus PR 7):

```ts
    // Ziel bei Heizung und Warmwasser (Heizung PR 10): beides, nur Heizung, nur Warmwasser.
    heatingTarget: text('heating_target', { enum: HEATING_TARGETS }),
```

In `readings` als letzte Spalte (Abweichung 23; keine Bedingung, sonst baute drizzle-kit die Tabelle
neu):

```ts
    // Grenze einer Ablesung aus dem Mieterwechsel (Heizung PR 10): letzter Tag des bisherigen Nutzers.
    interimFor: text('interim_for'),
```

Hinter der Tabelle `heatingPeriods` (PR 4):

```ts
// Keine Zwischenablesung an einer Grenze einer Wohnung (Heizung PR 10, Entwurf 3.5, Abweichung 8):
// „nicht möglich“ oder „nicht durchgeführt“, mit Grund. Die Grenze ist der letzte Tag des
// bisherigen Nutzers. Fällt mit der Wohnung.
export const interimReadingGaps = sqliteTable(
  'interim_reading_gaps',
  {
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    status: text('status', { enum: INTERIM_GAP_STATUS }).notNull(),
    reason: text('reason').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.date] }),
    oneOf('interim_reading_gaps_status_known', 'status', INTERIM_GAP_STATUS),
    check('interim_reading_gaps_date_valid', sql.raw(`"date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
  ],
)
```

Run: `npm --prefix server run db:generate -- --name heizkostenabrechnung`

Expected: `server/drizzle/0026_heizkostenabrechnung.sql` mit genau einem `CREATE TABLE
interim_reading_gaps` (samt Primärschlüssel, Fremdschlüssel und beiden Bedingungen), vier
`ALTER TABLE heating_plants ADD`, einem `ALTER TABLE cost_items ADD` und einem
`ALTER TABLE readings ADD`. **Kein** `__new_`. Steht
ein Neubau darin, ist eine Bedingung an einer bestehenden Tabelle mitgekommen: Datei,
Journal-Eintrag und Momentaufnahme löschen, Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach
einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Schlüssel und Bedingungen**

`COST_KEYS`:

```ts
export const COST_KEYS = exactly<CostKey>()(['area', 'persons', 'units', 'direct', 'meter', 'custom', 'external', 'amounts', 'heatingSystem'] as const)
```

In den Bedingungen von `heatingPlants` hinter denen von PR 7:

```ts
    oneOf('heating_plants_hot_water_known', 'hot_water', HOT_WATER),
    oneOf('heating_plants_capture_known', 'capture', CAPTURE_METHODS),
    oneOf('heating_plants_area_basis_heat_known', 'area_basis_heat', AREA_BASES_HEAT),
    // Die eigene Heizkostenabrechnung braucht die Art der Erfassung (Entwurf 5.3).
    check('heating_plants_self_capture', sql.raw(`"method" <> 'self' OR "capture" IS NOT NULL`)),
```

In den Bedingungen von `costItems` hinter der Bedingung `cost_items_heating_part_category_valid` (PR 3):

```ts
    oneOf('cost_items_heating_target_known', 'heating_target', HEATING_TARGETS),
    // Ein Ziel gibt es nur bei Heizung und Warmwasser, wie den Teil (PR 3).
    check('cost_items_heating_target_category', sql.raw(`"heating_target" IS NULL OR "category" = 'Heizung und Warmwasser'`)),
    // Nach Heizkostenverordnung verteilt nur eine Position mit Anlage, Teil und Ziel (Entwurf 5.3).
    check(
      'cost_items_heating_system_complete',
      sql.raw(`"key" <> 'heatingSystem' OR ("heating_target" IS NOT NULL AND "heating_part" IS NOT NULL AND "heating_plant_id" IS NOT NULL)`),
    ),
```

Run: `npm --prefix server run db:generate -- --name heizkostenabrechnung_bedingungen`

Expected: `server/drizzle/0027_heizkostenabrechnung_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`,
je einem Neubau `__new_heating_plants` und `__new_cost_items` samt `INSERT INTO … SELECT`,
`DROP TABLE`, `RENAME` und `PRAGMA foreign_keys=ON`. Kein `ALTER TABLE … ADD`. Steht ein weiterer
Neubau darin (eine Tabelle, die auf `cost_items` oder `heating_plants` zeigt, wird von drizzle-kit
nicht neu gebaut), ist das ein Befund: Datei verwerfen, Schema prüfen.

- [ ] **Step 6: Den Schlüssel beschriften und aus Auswahl und Belegbuchung heraushalten**

`server/src/calc.ts`, in `KEY_LABELS` als letzter Eintrag:

```ts
  heatingSystem: 'nach Heizkostenverordnung',
```

und in `KEY_PHRASES`:

```ts
  heatingSystem: 'nach der Heizkostenverordnung',
```

`server/src/bookingPlan.ts`:

```ts
const KEYS: Record<CostKey, true> = { area: true, persons: true, units: true, direct: true, meter: true, custom: true, external: true, amounts: true, heatingSystem: true }
```

`server/src/store.ts` (die db.json kennt den Schlüssel nicht):

```ts
export type LegacyCostKey = Exclude<CostKey, 'external' | 'amounts' | 'heatingSystem'>
```

`client/src/types.ts`, in `KEY_LABELS` als letzter Eintrag:

```ts
  heatingSystem: 'nach Heizkostenverordnung (eigene Heizkostenabrechnung)',
```

`client/src/costForm.ts`, in `costKeyOptions` die Bedingung der Liste ergänzen, sodass sie lautet
(PR 3 und PR 4 haben weitere Bedingungen ergänzt; diese kommt mit `&&` dazu):

```ts
    (k) => (k !== 'meter' || unitMeterTypes.length > 0 || stored === 'meter') &&
      // Nach Heizkostenverordnung verteilt nur eine Anlage mit eigener Abrechnung; angeboten wird der
      // Schlüssel ab Task 12 dort. Bis dahin nur bei einer Position, die ihn schon hat.
      (k !== 'heatingSystem' || stored === 'heatingSystem'),
```

- [ ] **Step 7: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('heizkostenabrechnung')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter `'0025_vorrat_bedingungen'` (PR 8) die
beiden ausgegebenen Zeilen einfügen, darüber:

```ts
  // Heizung PR 10. Wird ein Schritt von PR 8 vor dem Push neu erzeugt, werden diese beiden Schritte
  // neu erzeugt und die Marken hier ersetzt.
```

Die beiden Werte sind die Prüfsummen der in Step 4 und Step 5 erzeugten Dateien; erst die Ausgabe des
Befehls nennt sie.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-golden.test.ts test/db-objekte.test.ts test/db-changeover.test.ts && npm --prefix client test -- costForm && npm run typecheck`
Expected: PASS. Der Übersetzer verlangt `heatingSystem` an jeder `Record<CostKey, …>`; weitere
Stellen als die in Step 6 genannten meldet er mit Datei und Zeile, sie bekommen denselben Eintrag.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle server/src/calc.ts server/src/bookingPlan.ts server/src/store.ts client/src/types.ts client/src/costForm.ts server/test/schema.test.ts server/test/migrations.test.ts client/src/costForm.test.ts
git commit -m "Heizkostenabrechnung: Warmwasser, Erfassung, Flächenbasis und Ziel; Schlüssel nach Heizkostenverordnung

Zwei erzeugte Schritte: erst Spalten und die Tabelle der fehlenden Zwischenablesungen, dann die
Bedingungen.

Refs #99"
```

---

### Task 3: Reine Rechnung: Nutzer, Ablesungen, § 9b, Gewichte (`server/src/heating.ts`)

Je Wohnung die Nutzer der Heizperiode (Mieter, Leerstand, Eigennutzung, außerhalb), je Zähler die
Ablesung an jeder Grenze, je Topf die Bruchteile an Grund- und Verbrauchskosten, die Gruppen nach
§ 9b Abs. 3 und daraus die exakten Gewichte g_r(heating), g_r(water), g_r(both) (Entwurf 3.5, 8.4,
8.5, 8.6). Nichts davon kennt Geld: Ein Gewicht ist ein Bruchteil eines Topfs, und eine Position mit
Betrag A bekommt in Task 8 die Rohwerte A · g_r(Ziel).

**Files:**
- Create: `server/src/heating.ts`
- Modify: `server/test/law-literals.test.ts`
- Test: `server/test/heating.test.ts` (neu)

**Interfaces:**
- Consumes: `degreeDayPermille`, `DayRange` (`shared/degreeDays.ts`, PR 3); `DegreeDayTable` (PR 3); `ReadingOffWarning` (Task 1); `dayAfter`, `dayBefore` (PR 1); `AreaBasisHeat`, `ChangeSplit`, `HotWater`, `HeatingPart`, `HeatingTarget`, `InterimGap`, `InterimGapStatus`, `MeterType`, `SelfPot`, `SelfRole` (Task 2); `distributeCents` (nur im Test).
- Produces (`server/src/heating.ts`):
  - `type SelfUnit = { id: string; name: string; areaM2: number; heatedAreaM2: number | null; role: 'rented' | 'self' | 'outside' }`
  - `type SelfTenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null }`
  - `type SelfMeter = { id: string; name: string; unitId: string; type: MeterType }`
  - `type SelfReading = { meterId: string; date: string; value: number; replacement?: boolean; oldEndValue?: number | null; boundFor?: string | null }`
  - `type SelfInput = { h: { from: string; to: string }; neighbors: { before: string; after: string }; outerChanges?: ReadonlyMap<string, readonly string[]>; opening?: ReadonlyMap<string, SelfReading>; changeSplit: ChangeSplit; hotWater: HotWater; areaBasisHeat: AreaBasisHeat; units: readonly SelfUnit[]; tenancies: readonly SelfTenancy[]; meters: readonly SelfMeter[]; readings: readonly SelfReading[]; gaps: readonly InterimGap[]; table: DegreeDayTable; offRule: () => ReadingOffWarning }` (die Warngrenze wird nur gefragt, wenn eine Ablesung neben ihrer Grenze liegt; so steht sie nur dann im Rechtsstand)
  - `type SelfUser = { key: string; role: SelfRole; tenancyId: string | null; unitId: string; label: string; from: string; to: string; days: number; degreeDayPermille: number }`
  - `type SelfUserPot = { base: number; consumption: number; value: number | null; group: boolean }`, `type SelfUserPlan = SelfUser & { pots: Record<SelfPot, SelfUserPot> }`
  - `type SelfBoundary = { date: string; kind: 'start' | 'end' | 'change'; readingDates: (string | null)[]; gap: InterimGapStatus | null; far: boolean }`
  - `type SelfUnitPlan = { unit: SelfUnit; heatArea: number; users: SelfUserPlan[]; boundaries: SelfBoundary[]; readings: SelfReadingView[]; consumption: Record<SelfPot, number> }`
  - `type SelfProblem = { kind: 'noArea'; pot: SelfPot } | { kind: 'missing'; pot: SelfPot; unitId: string; unitName: string; boundary: string | null; reason: 'noMeter' | 'noReading' | 'replacement' | 'negative' | 'sameDay'; meterName: string | null } | { kind: 'farInterim'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number }`
  - `type SelfFinding = { kind: 'datesDiffer'; boundary: string; readingDate: string; unitName: string; days: number; permille: number; far: boolean } | { kind: 'interimOff'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number; permille: number; far: boolean } | { kind: 'noInterim'; unitId: string; unitName: string; boundary: string; pots: SelfPot[]; status: InterimGapStatus | null; reason: string; tenancyIds: string[] }`
  - `type SelfPlan = { pots: SelfPot[]; units: SelfUnitPlan[]; totals: Record<SelfPot, { area: number; consumption: number; measured: boolean }>; problems: SelfProblem[]; findings: SelfFinding[] }`
  - `type SelfWeights = { heating: number; water: number; both: number }`
  - `POT_METER: Record<SelfPot, MeterType>`, `usersOf(unit, tenancies, h): SelfUser[]`, `boundaryReadingsOf(readings, boundaries, cells): Map<string, SelfReading | null>`, `measuredBetween(sorted, a, b): { value: number } | { problem: 'replacement' | 'negative' }`, `sortReadings(readings): SelfReading[]`, `addMonths(iso, n): string`, `readingOff(boundary, date, table, rule): { days: number; permille: number; far: boolean }`, `planSelf(input): SelfPlan`, `weightsOf(plan, shares: { heating: number; water: number }, alpha: number | null): Map<string, SelfWeights>`, `targetProblem(hotWater, part, target): string | null`

- [ ] **Step 1: Write the failing tests**

`server/test/heating.test.ts`:

```ts
// Die eigene Heizkostenabrechnung als reine Rechnung (Heizung PR 10, Entwurf 3.5, 8.4–8.6, 12.2
// „heating.test.ts“): Beispiel A centgenau, die Gegenproben, Ablesungen neben Stichtag und Wechsel,
// § 9b Abs. 3, keine lineare Interpolation, Leerstand, Eigennutzung, beheizte Fläche.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundaryReadingsOf, planSelf, readingOff, targetProblem, usersOf, weightsOf,
  type SelfInput, type SelfMeter, type SelfPlan, type SelfReading, type SelfTenancy, type SelfUnit,
} from '../src/heating.ts'
import { distributeCents } from '../src/calc.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { onlyVersion } from '../../shared/law/register.ts'

const table = onlyVersion(hkvDegreeDays).value
const offRule = onlyVersion(practiceReadingOffWarning).value
const near = (a: number, b: number, what: string, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} statt ${b}`)

// Beispiel A (Entwurf 8.6, 3.5): drei Wohnungen, Wechsel in C zum 30.09.2025, Zwischenablesung am 30.09.
const UNITS: SelfUnit[] = [
  { id: 'a', name: 'A', areaM2: 60, heatedAreaM2: null, role: 'rented' },
  { id: 'b', name: 'B', areaM2: 80, heatedAreaM2: null, role: 'rented' },
  { id: 'c', name: 'C', areaM2: 60, heatedAreaM2: null, role: 'rented' },
]
const TENANCIES: SelfTenancy[] = [
  { id: 'A', unitId: 'a', tenantName: 'Mieter A', start: '2020-01-01', end: null },
  { id: 'B', unitId: 'b', tenantName: 'Mieter B', start: '2020-01-01', end: null },
  { id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-09-30' },
  { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-10-01', end: null },
]
const METERS: SelfMeter[] = [
  { id: 'wa', name: 'Wärme A', unitId: 'a', type: 'waerme' }, { id: 'wb', name: 'Wärme B', unitId: 'b', type: 'waerme' }, { id: 'wc', name: 'Wärme C', unitId: 'c', type: 'waerme' },
  { id: 'xa', name: 'Warmwasser A', unitId: 'a', type: 'warmwasser' }, { id: 'xb', name: 'Warmwasser B', unitId: 'b', type: 'warmwasser' }, { id: 'xc', name: 'Warmwasser C', unitId: 'c', type: 'warmwasser' },
]
const r = (meterId: string, date: string, value: number, extra: Partial<SelfReading> = {}): SelfReading => ({ meterId, date, value, ...extra })
const READINGS: SelfReading[] = [
  r('wa', '2024-12-31', 1000), r('wa', '2025-12-31', 13000),
  r('wb', '2024-12-31', 0), r('wb', '2025-12-31', 16000),
  r('wc', '2024-12-31', 500), r('wc', '2025-09-30', 7700), r('wc', '2025-12-31', 12500),
  r('xa', '2024-12-31', 10), r('xa', '2025-12-31', 40),
  r('xb', '2024-12-31', 0), r('xb', '2025-12-31', 40),
  r('xc', '2024-12-31', 5), r('xc', '2025-09-30', 43), r('xc', '2025-12-31', 55),
]
const input = (over: Partial<SelfInput> = {}): SelfInput => ({
  h: { from: '2025-01-01', to: '2025-12-31' },
  neighbors: { before: '2023-12-31', after: '2026-12-31' },
  changeSplit: 'degreeDays', hotWater: 'combined', areaBasisHeat: 'area',
  units: UNITS, tenancies: TENANCIES, meters: METERS, readings: READINGS, gaps: [], table, offRule: () => offRule, ...over,
})
const without = (date: string, meterIds: string[]) => READINGS.filter((x) => !(x.date === date && meterIds.includes(x.meterId)))
const userOf = (plan: SelfPlan, key: string) => plan.units.flatMap((u) => u.users).find((u) => u.key === key) ?? assert.fail(`kein Nutzer ${key}`)

// Die Positionen aus Beispiel A und ihre Verteilung nach #202, in Cent.
const ITEMS: [string, number, 'both' | 'heating' | 'water'][] = [
  ['Erdgas', 600000, 'both'], ['Betriebsstrom', 18000, 'both'], ['Wartung', 24000, 'both'], ['Immissionsmessung', 6000, 'both'],
  ['Miete Wärmezähler', 12000, 'heating'], ['Miete Warmwasserzähler', 6000, 'water'],
]
function distribute(plan: SelfPlan, alpha: number): Record<string, number> {
  const w = weightsOf(plan, { heating: 70, water: 70 }, alpha)
  const keys = ['A', 'B', 'C1', 'C2']
  const sum: Record<string, number> = { A: 0, B: 0, C1: 0, C2: 0 }
  for (const [, amount, target] of ITEMS) {
    const cents = distributeCents(amount, keys.map((k) => ({ key: k, landlord: false, raw: amount * (w.get(k)?.[target] ?? assert.fail(`kein Gewicht ${k}`)) })))
    keys.forEach((k, i) => { sum[k] = (sum[k] ?? 0) + (cents[i] ?? 0) })
  }
  return sum
}
// Exakt je Nutzer: K_H · g(heating) + K_W · g(water), K_H = 5.628 €, K_W = 1.032 € (α = 15 %).
const exact = (plan: SelfPlan, key: string, alpha: number) => {
  const w = weightsOf(plan, { heating: 70, water: 70 }, alpha).get(key) ?? assert.fail(key)
  return 562800 * w.heating + 103200 * w.water
}

test('Beispiel A: 1.961,89 / 2.615,84 / 1.331,52 / 750,75 €, exakt 1.331,52995 und 750,75005 €', () => {
  const plan = planSelf(input())
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(distribute(plan, 0.15), { A: 196189, B: 261584, C1: 133152, C2: 75075 })
  near(exact(plan, 'C1', 0.15), 133152.995, 'C1 exakt', 1e-4)
  near(exact(plan, 'C2', 0.15), 75075.005, 'C2 exakt', 1e-4)
  near(exact(plan, 'A', 0.15), 196188, 'A exakt', 1e-6)
  // Gewichte summieren sich je Topf zu 1: kein Leerstand, nichts verloren.
  const w = weightsOf(plan, { heating: 70, water: 70 }, 0.15)
  near([...w.values()].reduce((a, x) => a + x.heating, 0), 1, 'Σ heating')
  near([...w.values()].reduce((a, x) => a + x.water, 0), 1, 'Σ water')
  // Gemessen, nicht zurückgerechnet: C1 hat 7.200 kWh und 38 m³, C2 4.800 kWh und 12 m³.
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7200, 4800])
  assert.deepEqual([userOf(plan, 'C1').pots.water.value, userOf(plan, 'C2').pots.water.value], [38, 12])
  near(userOf(plan, 'C1').degreeDayPermille, 640, 'Gradtage Januar bis September')
})

test('Gegenprobe zeitanteilig: Grundkosten Heizung C1 378,85 € statt 324,17 €', () => {
  const zeit = planSelf(input({ changeSplit: 'time' }))
  near(562800 * 0.3 * userOf(zeit, 'C1').pots.heating.base, 37884.92, 'zeitanteilig', 0.01)
  const grad = planSelf(input())
  near(562800 * 0.3 * userOf(grad, 'C1').pots.heating.base, 32417.28, 'nach Gradtagen', 0.01)
  // Warmwasser geht immer nach Tagen (§ 9b Abs. 2).
  near(userOf(grad, 'C1').pots.water.base, userOf(zeit, 'C1').pots.water.base, 'Warmwasser gleich')
})

test('§ 9b Abs. 3: ohne Zwischenablesung trägt C1 1.375,18 € (exakt 1.375,17666 €), und Mietfuchs fragt', () => {
  const plan = planSelf(input({ readings: without('2025-09-30', ['wc', 'xc']) }))
  assert.deepEqual(plan.problems, [])
  near(exact(plan, 'C1', 0.15), 137517.666, 'C1', 1e-3)
  near(exact(plan, 'C2', 0.15), 70710.334, 'C2', 1e-3)
  assert.deepEqual(distribute(plan, 0.15), { A: 196189, B: 261584, C1: 137517, C2: 70710 })
  assert.equal(userOf(plan, 'C1').pots.heating.group, true)
  const f = plan.findings.find((x) => x.kind === 'noInterim') ?? assert.fail('kein Befund')
  assert.deepEqual(f, { kind: 'noInterim', unitId: 'c', unitName: 'C', boundary: '2025-09-30', pots: ['heating', 'water'], status: null, reason: '', tenancyIds: ['C1', 'C2'] })
  const answered = planSelf(input({ readings: without('2025-09-30', ['wc', 'xc']), gaps: [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }] }))
  assert.equal(answered.findings.find((x) => x.kind === 'noInterim')?.kind === 'noInterim' ? (answered.findings.find((x) => x.kind === 'noInterim') as { status: string | null }).status : null, 'impossible')
})

test('Keine lineare Interpolation: eine Ablesung im Juni gilt am Wechsel, wie sie ist, und wird nicht hochgerechnet', () => {
  const juni = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-06-30', 6500), r('xc', '2025-06-30', 30)]
  const plan = planSelf(input({ readings: juni }))
  // Die Ablesung vom 30.06. liegt dem Wechsel am 30.09. näher als dem 31.12.2024; sie gilt, wie sie ist
  // (Entwurf 3.5 Nr. 2), und die Grenze zwischen C1 und C2 liegt am 30.06.
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [6000, 6000])
  // Eine Interpolation bis zum 30.09. hätte 9.000 kWh ergeben; dieser Wert darf nie entstehen.
  assert.notEqual(userOf(plan, 'C1').pots.heating.value, 9000)
  const f = plan.findings.find((x) => x.kind === 'interimOff') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'interimOff')
  // 92 Tage daneben, aber kein Monat von Oktober bis April dazwischen: ein Hinweis, keine Warnung.
  assert.deepEqual([f.readingDate, f.days, f.far], ['2025-06-30', 92, false])
})

test('Z-B3: Ablesung am 03.10. statt am 30.09. gilt, wie sie ist; die Grenze liegt am 03.10., Hinweis mit 3 Tagen', () => {
  const okt = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-03', 7800), r('xc', '2025-10-03', 44)]
  const plan = planSelf(input({ readings: okt }))
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7300, 4700])
  assert.equal(userOf(plan, 'C1').pots.heating.group, false)
  const f = plan.findings.find((x) => x.kind === 'interimOff') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'interimOff')
  assert.deepEqual([f.boundary, f.readingDate, f.days, f.far], ['2025-09-30', '2025-10-03', 3, false])
  near(f.permille, (3 * 80) / 31, 'Gradtage 01.–03.10.')
})

test('Zwei Ablesungen neben dem Wechsel (03.10. und 15.10.): es gilt die nähere', () => {
  const zwei = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-03', 7800), r('wc', '2025-10-15', 8100), r('xc', '2025-10-03', 44), r('xc', '2025-10-15', 45)]
  const plan = planSelf(input({ readings: zwei }))
  assert.equal(userOf(plan, 'C1').pots.heating.value, 7300)
})

test('Z-B1: Stichtag 31.12., Ablesungen am 02.01. und 05.01. gelten wie abgelesen, Hinweis mit 5 Tagen und 27,4 ‰', () => {
  const jan = READINGS.map((x) => (x.meterId === 'wa' && x.date === '2024-12-31' ? { ...x, date: '2025-01-02' } : x.meterId === 'wb' && x.date === '2024-12-31' ? { ...x, date: '2025-01-05' } : x))
  const plan = planSelf(input({ readings: jan }))
  assert.deepEqual(plan.problems, [])
  assert.equal(userOf(plan, 'A').pots.heating.value, 12000)
  const f = plan.findings.find((x) => x.kind === 'datesDiffer') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'datesDiffer')
  assert.deepEqual([f.boundary, f.readingDate, f.days, f.far], ['2024-12-31', '2025-01-05', 5, false])
  assert.equal(f.permille.toFixed(1), '27.4')
})

test('Warngrenze: ein Monat Abweichung mit einem Wintermonat dazwischen', () => {
  const zero = { from: '2025-01-01', to: '2025-12-31' }
  void zero
  assert.equal(readingOff('2024-12-31', '2025-02-10', table, offRule).far, true)
  assert.equal(readingOff('2024-12-31', '2025-01-30', table, offRule).far, false)
  assert.equal(readingOff('2024-12-31', '2025-01-31', table, offRule).far, true, 'genau ein Monat')
  assert.equal(readingOff('2025-06-30', '2025-08-15', table, offRule).far, false, 'Sommer')
  assert.equal(readingOff('2025-09-30', '2025-08-25', table, offRule).far, false, 'vorher, ohne Wintermonat')
  assert.equal(readingOff('2025-09-30', '2025-11-05', table, offRule).far, true, 'Oktober dazwischen')
})

test('Abweichung 9: eine Ablesung aus dem Mieterwechsel gehört fest zu ihrer Grenze, auch wenn eine ungebundene näher liegt', () => {
  const gebunden = [
    ...without('2025-09-30', ['wc', 'xc']),
    r('wc', '2025-09-29', 7650), r('xc', '2025-09-29', 42),
    r('wc', '2025-10-10', 7900, { boundFor: '2025-09-30' }), r('xc', '2025-10-10', 44, { boundFor: '2025-09-30' }),
  ]
  const plan = planSelf(input({ readings: gebunden }))
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7400, 4600])
  // Ohne Bindung gilt die Nähe-Regel: der 29.09. liegt näher.
  const frei = planSelf(input({ readings: gebunden.map((x) => ({ ...x, boundFor: null })) }))
  assert.equal(userOf(frei, 'C1').pots.heating.value, 7150)
  // Mitte zwischen zwei Grenzen: zur früheren.
  const at = boundaryReadingsOf([r('m', '2025-02-15', 1)], ['2025-01-31', '2025-03-02'], ['2024-12-31', '2025-01-31', '2025-03-02', '2025-12-31'])
  assert.deepEqual([at.get('2025-01-31')?.date ?? null, at.get('2025-03-02')?.date ?? null], ['2025-02-15', null])
})

test('Abweichung 9: zwei verschiedene Werte eines Zählers am selben Tag sind ein Befund, gleiche Werte nicht (#69)', () => {
  const doppelt = planSelf(input({ readings: [...READINGS, r('wa', '2025-12-31', 13050)] }))
  assert.deepEqual(doppelt.problems.map((p) => (p.kind === 'missing' ? [p.reason, p.boundary, p.meterName] : p.kind)), [['sameDay', '2025-12-31', 'Wärme A']])
  assert.deepEqual(planSelf(input({ readings: [...READINGS, r('wa', '2025-12-31', 13000)] })).problems, [])
})

test('Abweichung 9: Zellen über H−1, H und H+1; der eingefrorene Endstand der Vorperiode ist der Anfangsstand', () => {
  // H = 2024, in H+1 zieht C1 am 31.01.2025 aus; die einzige Ablesung um den Jahreswechsel ist vom 20.01.2025.
  const nurC = (outerChanges?: ReadonlyMap<string, readonly string[]>) => planSelf(input({
    h: { from: '2024-01-01', to: '2024-12-31' }, neighbors: { before: '2022-12-31', after: '2025-12-31' }, hotWater: 'none',
    units: UNITS.filter((u) => u.id === 'c'), meters: METERS.filter((m) => m.id === 'wc'),
    tenancies: [{ id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-01-31' }, { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-02-01', end: null }],
    readings: [r('wc', '2023-12-31', 0), r('wc', '2025-01-20', 600)], ...(outerChanges ? { outerChanges } : {}),
  }))
  // Ohne die Grenzen von H+1 nähme H den 20.01. als Endstand, H+1 aber als Zwischenablesung: doppelt.
  assert.deepEqual(nurC().problems, [])
  assert.deepEqual(nurC(new Map([['c', ['2025-01-31']]])).problems.map((p) => (p.kind === 'missing' ? [p.reason, p.boundary] : p.kind)), [['noReading', '2024-12-31']])
  // Eingefroren: H−1 endete mit 1.000 am 31.12.2024; nachgetragen ist nur ein Stand vom 05.01.2025.
  const nachgetragen = READINGS.map((x) => (x.meterId === 'wa' && x.date === '2024-12-31' ? r('wa', '2025-01-05', 1100) : x))
  assert.equal(userOf(planSelf(input({ readings: nachgetragen })), 'A').pots.heating.value, 11900)
  assert.equal(userOf(planSelf(input({ readings: nachgetragen, opening: new Map([['wa', r('wa', '2024-12-31', 1000)]]) })), 'A').pots.heating.value, 12000)
})

test('Abweichung 22: Zwischenablesung ab der Warngrenze; ohne Wahl nicht verteilbar, sonst Ablesung oder § 9b Abs. 3', () => {
  const nov = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-11-05', 8200), r('xc', '2025-11-05', 46)]
  const ohne = planSelf(input({ readings: nov }))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'farInterim' ? [p.kind, p.boundary, p.readingDate, p.days] : p.kind)), [['farInterim', '2025-09-30', '2025-11-05', 36]])
  const gap = (status: 'imprecise' | 'useReading') => [{ unitId: 'c', date: '2025-09-30', status, reason: '' }]
  const ablesung = planSelf(input({ readings: nov, gaps: gap('useReading') }))
  assert.deepEqual([ablesung.problems, userOf(ablesung, 'C1').pots.heating.value], [[], 7700])
  assert.ok(ablesung.findings.some((f) => f.kind === 'interimOff' && f.far))
  const ungenau = planSelf(input({ readings: nov, gaps: gap('imprecise') }))
  assert.deepEqual([ungenau.problems, userOf(ungenau, 'C1').pots.heating.group], [[], true])
  assert.ok(ungenau.findings.some((f) => f.kind === 'noInterim' && f.status === 'imprecise'))
  assert.equal(ungenau.units.find((u) => u.unit.id === 'c')?.boundaries.find((b) => b.kind === 'change')?.far, true)
})

test('Review Focus 1: Leerstand zwischen zwei Mietern, Ablesung nur am Ende des Leerstands', () => {
  const tenancies = TENANCIES.map((t) => (t.id === 'C2' ? { ...t, start: '2025-10-15' } : t))
  const readings = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-14', 7900), r('xc', '2025-10-14', 44)]
  const plan = planSelf(input({ tenancies, readings }))
  const unit = plan.units.find((u) => u.unit.id === 'c') ?? assert.fail('C')
  assert.deepEqual(unit.users.map((u) => [u.key, u.role, u.from, u.to]), [
    ['C1', 'tenancy', '2025-01-01', '2025-09-30'], ['vacancy:c:2025-10-01', 'vacancy', '2025-10-01', '2025-10-14'], ['C2', 'tenancy', '2025-10-15', '2025-12-31'],
  ])
  assert.equal(userOf(plan, 'C1').pots.heating.group, true)
  assert.equal(userOf(plan, 'vacancy:c:2025-10-01').pots.heating.group, true)
  assert.deepEqual([userOf(plan, 'C2').pots.heating.group, userOf(plan, 'C2').pots.heating.value], [false, 4600])
  // Σ der Nutzer der Wohnung bleibt der Verbrauch der Wohnung.
  const sum = unit.users.reduce((a, u) => a + u.pots.heating.consumption, 0)
  near(sum * plan.totals.heating.consumption, 12000, 'Verbrauch der Wohnung')
  assert.deepEqual(plan.findings.filter((x) => x.kind === 'noInterim').map((x) => x.kind === 'noInterim' ? x.tenancyIds : []), [['C1']])
})

test('Leerstand und Eigennutzung sind Nutzer: Grundkosten und gemessener Verbrauch', () => {
  const units = UNITS.map((u) => (u.id === 'a' ? { ...u, role: 'self' as const } : u))
  const tenancies = TENANCIES.filter((t) => t.id !== 'A' && t.id !== 'B')
  const plan = planSelf(input({ units, tenancies }))
  assert.deepEqual(plan.units.find((u) => u.unit.id === 'a')?.users.map((u) => [u.key, u.role]), [['self:a:2025-01-01', 'self']])
  assert.deepEqual(plan.units.find((u) => u.unit.id === 'b')?.users.map((u) => [u.key, u.role]), [['vacancy:b:2025-01-01', 'vacancy']])
  near(userOf(plan, 'vacancy:b:2025-01-01').pots.heating.consumption, 16000 / 40000, 'Leerstand trägt seinen Verbrauch')
  near(userOf(plan, 'vacancy:b:2025-01-01').pots.heating.base, 80 / 200, 'und seine Grundkosten')
})

test('R-A21: beheizte Fläche nur im Topf Heizung, Warmwasser nach Wohnfläche', () => {
  const units = UNITS.map((u) => (u.id === 'c' ? { ...u, heatedAreaM2: 40 } : u))
  const plan = planSelf(input({ units, areaBasisHeat: 'heatedArea' }))
  near(plan.totals.heating.area, 180, 'Heizung: 60 + 80 + 40 m²')
  near(plan.totals.water.area, 200, 'Warmwasser: Wohnfläche')
  near(userOf(plan, 'A').pots.heating.base, 60 / 180, 'A Heizung')
  near(userOf(plan, 'A').pots.water.base, 60 / 200, 'A Warmwasser')
})

test('Review Focus 4: eine Wohnung ohne Wärmezähler ist ein Fehler, nicht eine Wohnung ohne Verbrauch', () => {
  const plan = planSelf(input({ meters: METERS.filter((m) => m.id !== 'wb') }))
  assert.deepEqual(plan.problems, [{ kind: 'missing', pot: 'heating', unitId: 'b', unitName: 'B', boundary: null, reason: 'noMeter', meterName: null }])
})

test('Fehlender Stand am Ende, Zählerwechsel ohne Endstand und negativer Verbrauch sind Fehler (§ 9a kommt mit PR 13)', () => {
  const ohneEnde = planSelf(input({ readings: READINGS.filter((x) => !(x.meterId === 'wa' && x.date === '2025-12-31')) }))
  assert.deepEqual(ohneEnde.problems, [{ kind: 'missing', pot: 'heating', unitId: 'a', unitName: 'A', boundary: '2025-12-31', reason: 'noReading', meterName: 'Wärme A' }])
  const wechsel = planSelf(input({ readings: [...READINGS, r('wa', '2025-06-30', 0, { replacement: true, oldEndValue: null })] }))
  assert.equal(wechsel.problems[0]?.kind === 'missing' ? wechsel.problems[0].reason : null, 'replacement')
  const rueckwaerts = planSelf(input({ readings: READINGS.map((x) => (x.meterId === 'wa' && x.date === '2025-12-31' ? { ...x, value: 500 } : x)) }))
  assert.equal(rueckwaerts.problems[0]?.kind === 'missing' ? rueckwaerts.problems[0].reason : null, 'negative')
})

test('Ohne einen einzigen Wärmezähler ist der Topf nicht erfasst und wird nur nach Fläche verteilt', () => {
  const plan = planSelf(input({ meters: METERS.filter((m) => m.type !== 'waerme') }))
  assert.deepEqual(plan.problems, [])
  assert.equal(plan.totals.heating.measured, false)
  const w = weightsOf(plan, { heating: 70, water: 70 }, 0.15)
  near(w.get('A')?.heating ?? 0, 60 / 200, 'A nur nach Fläche')
})

test('Ohne Warmwasser gibt es nur den Topf Heizung', () => {
  const plan = planSelf(input({ hotWater: 'none', meters: METERS.filter((m) => m.type === 'waerme') }))
  assert.deepEqual(plan.pots, ['heating'])
  assert.deepEqual(plan.problems, [])
})

test('Nutzer einer Wohnung: Mieter, Lücken als Leerstand, Eigennutzung, außerhalb', () => {
  const h = { from: '2025-01-01', to: '2025-12-31' }
  const t = (id: string, start: string, end: string | null): SelfTenancy => ({ id, unitId: 'u', tenantName: id, start, end })
  const unit = (role: SelfUnit['role']): SelfUnit => ({ id: 'u', name: 'U', areaM2: 50, heatedAreaM2: null, role })
  assert.deepEqual(usersOf(unit('rented'), [t('x', '2024-01-01', '2025-03-31'), t('y', '2025-05-01', null)], h).map((u) => [u.key, u.from, u.to, u.days]), [
    ['x', '2025-01-01', '2025-03-31', 90], ['vacancy:u:2025-04-01', '2025-04-01', '2025-04-30', 30], ['y', '2025-05-01', '2025-12-31', 245],
  ])
  assert.deepEqual(usersOf(unit('self'), [], h).map((u) => [u.role, u.label]), [['self', 'Eigennutzung']])
  assert.deepEqual(usersOf(unit('outside'), [], h).map((u) => [u.role, u.label]), [['outside', 'außerhalb der Abrechnungseinheit']])
})

test('Ziel einer Position: passt zur Warmwasserbereitung, Brennstoff bei verbundener Anlage zu beidem', () => {
  assert.equal(targetProblem('combined', 'fuel', 'both'), null)
  assert.match(targetProblem('combined', 'fuel', 'heating') ?? '', /§ 9 Abs\. 1 HeizkostenV/)
  assert.equal(targetProblem('combined', 'metering', 'water'), null)
  assert.match(targetProblem('none', 'operating', 'both') ?? '', /kein Warmwasser/)
  assert.match(targetProblem('separate', 'operating', 'both') ?? '', /getrennt/)
  assert.match(targetProblem('combined', null, 'both') ?? '', /Teil/)
  assert.match(targetProblem('combined', 'fuel', null) ?? '', /Ziel/)
})
```

In `server/test/law-literals.test.ts` `server/src/heating.ts` in `ENGINE_FILES` aufnehmen (hinter den
Dateien von PR 2 bis PR 9):

```ts
  'server/src/heating.ts',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/heating.test.ts test/law-literals.test.ts`
Expected: FAIL. `heating.test.ts` mit `ERR_MODULE_NOT_FOUND` für `src/heating.ts`,
`law-literals.test.ts` mit „server/src/heating.ts gibt es nicht; die Liste ist veraltet“.

- [ ] **Step 3: Implementierung (`server/src/heating.ts`)**

```ts
// Die eigene Heizkostenabrechnung nach der Heizkostenverordnung (Heizung PR 10, Entwurf 8), als
// reine Funktionen. Kein Geld, keine Uhr, keine Locale: Die Gewichte sind Bruchteile der Töpfe
// Heizung und Warmwasser, und eine Position mit Betrag A bekommt in calc.ts die Rohwerte A · g_r(Ziel),
// verteilt mit `distributeCents` (#202).
//
// **Nutzer.** Je Wohnung die Mieter der Heizperiode und dazwischen die Zeiten ohne Mietverhältnis:
// Leerstand, bei einer selbstgenutzten Wohnung die Eigennutzung, bei einer Wohnung außerhalb der
// Abrechnungseinheit „außerhalb“. Der Vermieter ist Nutzer der leeren Räume, sein Eintritt ist ein
// Nutzerwechsel (§ 9b Abs. 1, §§ 6, 7 Abs. 1 Satz 5 HeizkostenV; Entwurf 3.5).
//
// **Ablesung an einer Grenze** (Entwurf 3.5, Abweichung 9 des Plans). Grenzen sind das Ende des Tages
// vor der Heizperiode, ihr letzter Tag und der letzte Tag jedes Nutzers. Eine Ablesung aus dem
// Mieterwechsel gehört fest zu ihrer Grenze. Sonst, als Festlegung nach der Praxis der Messdienste
// ohne Quelle, die Ablesung, die der Grenze am nächsten liegt, aus denen, die ihr näher liegen als
// jeder anderen Grenze der Wohnung über H−1, H und H+1 (genau in der Mitte: zur früheren Grenze; zwei
// gleich weit: die frühere). Zwei verschiedene Werte am selben Tag sind ein Befund. Ist die Vorperiode
// abgeschlossen, ist ihr eingefrorener Endstand der Anfangsstand. Gerechnet wird mit dem Wert, wie er
// abgelesen ist: ohne Rückrechnung (LG Osnabrück, NZM 2004, 95) und **ohne lineare Interpolation**
// (Entwurf 8.4). Ab der Warngrenze neben einem Wechsel wählt der Vermieter (§ 9b Abs. 3 Alt. 2).
//
// **§ 9b.** Verbrauch nach der Zwischenablesung; übrige Wärmekosten nach Gradtagen oder Tagen
// (`change_split`), übrige Warmwasserkosten nach Tagen (Abs. 2). Fehlt die Ablesung an einer Grenze
// zwischen zwei Nutzern, bilden sie eine Gruppe, deren gesamte Kosten so geteilt werden (Abs. 3).
// Fehlt sie zu Beginn oder Ende der Heizperiode, ist das ein Fall des § 9a (PR 13); bis dahin ein
// Fehler, und die Anlage wird nicht verteilt (Abweichung 5).
//
// Die Gradtagstabelle und die Warngrenze kommen als Argument herein (Register, `law()` in calc.ts).
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import type { ReadingOffWarning } from '../../shared/law/practice.ts'
import { dayAfter, dayBefore } from '../../shared/law/register.ts'
import type {
  AreaBasisHeat, ChangeSplit, HeatingPart, HeatingTarget, HotWater, InterimGap, InterimGapStatus, MeterType, SelfPot, SelfReadingView, SelfRole,
} from '../../shared/types.ts'

export type SelfUnit = { id: string; name: string; areaM2: number; heatedAreaM2: number | null; role: 'rented' | 'self' | 'outside' }
export type SelfTenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null }
export type SelfMeter = { id: string; name: string; unitId: string; type: MeterType }
// `boundFor`: Grenze einer Ablesung aus dem Mieterwechsel (`readings.interim_for`, Abweichung 9, 23).
export type SelfReading = { meterId: string; date: string; value: number; replacement?: boolean; oldEndValue?: number | null; boundFor?: string | null }
export type SelfInput = {
  h: { from: string; to: string }
  // Beginn der vorigen und Ende der folgenden Heizperiode als äußerste Grenzen der Zellen.
  neighbors: { before: string; after: string }
  // Je Wohnung die Wechselgrenzen in H−1 und H+1, damit H−1, H und H+1 einer Ablesung dieselbe Grenze
  // geben (Abweichung 9). Fehlt der Eintrag, gibt es dort keinen Wechsel.
  outerChanges?: ReadonlyMap<string, readonly string[]>
  // Je Zähler der eingefrorene Endstand der abgeschlossenen Vorperiode; er ist der Anfangsstand.
  opening?: ReadonlyMap<string, SelfReading>
  changeSplit: ChangeSplit
  hotWater: HotWater
  areaBasisHeat: AreaBasisHeat
  units: readonly SelfUnit[]
  tenancies: readonly SelfTenancy[]
  meters: readonly SelfMeter[]
  readings: readonly SelfReading[]
  gaps: readonly InterimGap[]
  table: DegreeDayTable
  // Nur gefragt, wenn eine Ablesung neben ihrer Grenze liegt; so steht die Warngrenze nur dann im
  // Rechtsstand der Abrechnung.
  offRule: () => ReadingOffWarning
}

export type SelfUser = {
  key: string
  role: SelfRole
  tenancyId: string | null
  unitId: string
  label: string
  from: string
  to: string
  days: number
  degreeDayPermille: number
}
// Je Topf: der Bruchteil an den Grundkosten und an den Verbrauchskosten des Topfs (ohne den Anteil
// nach Verbrauch), der gemessene Verbrauch (bei einer Gruppe der rechnerische Teil) und ob der Nutzer
// in einer Gruppe nach § 9b Abs. 3 steht.
export type SelfUserPot = { base: number; consumption: number; value: number | null; group: boolean }
export type SelfUserPlan = SelfUser & { pots: Record<SelfPot, SelfUserPot> }
export type SelfBoundary = { date: string; kind: 'start' | 'end' | 'change'; readingDates: (string | null)[]; gap: InterimGapStatus | null; far: boolean }
export type SelfUnitPlan = {
  unit: SelfUnit
  heatArea: number
  users: SelfUserPlan[]
  boundaries: SelfBoundary[]
  readings: SelfReadingView[]
  consumption: Record<SelfPot, number>
}
export type SelfProblem =
  | { kind: 'noArea'; pot: SelfPot }
  | { kind: 'missing'; pot: SelfPot; unitId: string; unitName: string; boundary: string | null; reason: 'noMeter' | 'noReading' | 'replacement' | 'negative' | 'sameDay'; meterName: string | null }
  // Zwischenablesung ab der Warngrenze ohne Wahl des Vermieters (§ 9b Abs. 3 Alt. 2, Abweichung 22).
  | { kind: 'farInterim'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number }
export type SelfFinding =
  | { kind: 'datesDiffer'; boundary: string; readingDate: string; unitName: string; days: number; permille: number; far: boolean }
  | { kind: 'interimOff'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number; permille: number; far: boolean }
  | { kind: 'noInterim'; unitId: string; unitName: string; boundary: string; pots: SelfPot[]; status: InterimGapStatus | null; reason: string; tenancyIds: string[] }
export type SelfPlan = {
  pots: SelfPot[]
  units: SelfUnitPlan[]
  totals: Record<SelfPot, { area: number; consumption: number; measured: boolean }>
  problems: SelfProblem[]
  findings: SelfFinding[]
}
export type SelfWeights = { heating: number; water: number; both: number }

export const POT_METER: Record<SelfPot, MeterType> = { heating: 'waerme', water: 'warmwasser' }

const MS_DAY = 86400000
const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_DAY)
const spanDays = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1
const maxText = (a: string, b: string): string => (a > b ? a : b)
const minText = (a: string, b: string): string => (a < b ? a : b)
const degreeDays = (from: string, to: string, table: DegreeDayTable): number => (from <= to ? degreeDayPermille([{ from, to }], table) : 0)

// ---------- Nutzer ----------

const GAP_LABEL: Record<Exclude<SelfRole, 'tenancy'>, string> = { vacancy: 'Leerstand', self: 'Eigennutzung', outside: 'außerhalb der Abrechnungseinheit' }

// Die Nutzer einer Wohnung in der Heizperiode, nach Beginn. Überschneiden sich zwei Mietverhältnisse
// (#204), behält jedes seine Tage; eine Lücke gibt es dann nicht, und die Zeile des Vermieters wird in
// calc.ts negativ, wie bei jeder Überschneidung.
export function usersOf(unit: SelfUnit, tenancies: readonly SelfTenancy[], h: { from: string; to: string }): SelfUser[] {
  const gapRole: Exclude<SelfRole, 'tenancy'> = unit.role === 'self' ? 'self' : unit.role === 'outside' ? 'outside' : 'vacancy'
  const own = tenancies
    .filter((t) => t.unitId === unit.id && t.start <= h.to && (t.end === null || t.end >= h.from))
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
  const users: SelfUser[] = []
  const gap = (from: string, to: string) => {
    users.push({ key: `${gapRole}:${unit.id}:${from}`, role: gapRole, tenancyId: null, unitId: unit.id, label: GAP_LABEL[gapRole], from, to, days: spanDays(from, to), degreeDayPermille: 0 })
  }
  let cursor = h.from
  for (const t of own) {
    const from = maxText(t.start, h.from)
    const to = minText(t.end ?? h.to, h.to)
    if (from > cursor) gap(cursor, dayBefore(from))
    users.push({ key: t.id, role: 'tenancy', tenancyId: t.id, unitId: unit.id, label: t.tenantName, from, to, days: spanDays(from, to), degreeDayPermille: 0 })
    cursor = maxText(cursor, dayAfter(to))
  }
  if (cursor <= h.to) gap(cursor, h.to)
  return users
}

// ---------- Ablesungen ----------

// Nach Datum; am selben Tag in der Reihenfolge der Erfassung.
export function sortReadings(readings: readonly SelfReading[]): SelfReading[] {
  return readings.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r)
}

// Je Grenze die Ablesung eines Zählers (`null`, wenn keine passt; Abweichung 9). `cells` ist die
// aufsteigende Liste aller Grenzen der Wohnung über H−1, H und H+1 samt den äußeren Nachbarn und
// enthält `boundaries`.
// 1. Gebunden vor nah: eine Ablesung aus dem Mieterwechsel gehört zu ihrer Grenze (bei mehreren die
//    nächste, bei gleichem Abstand die frühere).
// 2. Rückfall, Festlegung nach der Praxis der Messdienste ohne Quelle: die nächste ungebundene in der
//    Zelle der Grenze; genau in der Mitte gehört sie zur früheren Grenze, von zwei gleich weit
//    entfernten gilt die frühere. Eine an eine andere Grenze der Zellen gebundene zählt nicht mit.
// Zwei verschiedene Werte am selben Tag wählt diese Funktion nicht aus; das meldet `sameDayConflict`.
export function boundaryReadingsOf(sorted: readonly SelfReading[], boundaries: readonly string[], cells: readonly string[]): Map<string, SelfReading | null> {
  const nums = cells.map(dayNumber)
  const cellSet = new Set(cells)
  const nearest = (candidates: readonly SelfReading[], bn: number): SelfReading | null => {
    let best: SelfReading | null = null
    let bestDist = Number.POSITIVE_INFINITY
    let bestDay = 0
    for (const r of candidates) {
      const d = dayNumber(r.date)
      const dist = Math.abs(d - bn)
      if (dist < bestDist || (dist === bestDist && d < bestDay)) {
        best = r
        bestDist = dist
        bestDay = d
      }
    }
    return best
  }
  const out = new Map<string, SelfReading | null>()
  for (const b of boundaries) {
    const k = cells.indexOf(b)
    const bn = nums[k] ?? dayNumber(b)
    const tied = sorted.filter((r) => r.boundFor === b)
    if (tied.length > 0) {
      out.set(b, nearest(tied, bn))
      continue
    }
    const lo = nums[k - 1] ?? Number.NEGATIVE_INFINITY
    const hi = nums[k + 1] ?? Number.POSITIVE_INFINITY
    // Näher an dieser Grenze als an der früheren (strikt) und nicht ferner als an der späteren.
    out.set(b, nearest(sorted.filter((r) => {
      if (r.boundFor && cellSet.has(r.boundFor)) return false
      const d = dayNumber(r.date)
      return d - lo > bn - d && hi - d >= d - bn
    }), bn))
  }
  return out
}

// Ein anderer Wert desselben Zählers am selben Tag (ohne Zählerwechsel): ein Befund, keine Wahl (#69).
export function sameDayConflict(sorted: readonly SelfReading[], chosen: SelfReading): boolean {
  return !chosen.replacement && sorted.some((x) => x !== chosen && x.date === chosen.date && !x.replacement && x.value !== chosen.value)
}

// Verbrauch zwischen zwei Ablesungen desselben Zählers: Differenz der Stände, über Zählerwechsel
// hinweg mit dem Endstand des alten Geräts. Ein Wechsel ohne Endstand oder ein negativer Verbrauch
// ist ein Fall des § 9a (PR 13).
export function measuredBetween(sorted: readonly SelfReading[], a: SelfReading, b: SelfReading): { value: number } | { problem: 'replacement' | 'negative' } {
  const ia = sorted.indexOf(a)
  const ib = sorted.indexOf(b)
  if (ia < 0 || ib < 0 || ib <= ia) return { value: 0 }
  let sum = 0
  for (let k = ia + 1; k <= ib; k++) {
    const prev = sorted[k - 1]
    const cur = sorted[k]
    if (!prev || !cur) continue
    if (cur.replacement) {
      if (cur.oldEndValue === null || cur.oldEndValue === undefined) return { problem: 'replacement' }
      sum += cur.oldEndValue - prev.value
    } else {
      sum += cur.value - prev.value
    }
  }
  return sum < 0 ? { problem: 'negative' } : { value: sum }
}

// Ein Datum n Monate später (n negativ: früher), am Monatsende abgeschnitten (31.01. + 1 Monat =
// 28.02.).
export function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + n
  const ty = y + Math.floor(m / 12)
  const tm = ((m % 12) + 12) % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const d = Math.min(Number(iso.slice(8, 10)), last)
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Wie weit eine Ablesung neben ihrer Grenze liegt: Tage, Gradtagsanteil der Tage dazwischen (ohne
// den früheren der beiden Tage, denn eine Ablesung gilt zum Tagesende) und ob die Warngrenze erreicht
// ist (`practice.reading-off-warning`: mindestens die Monate der Regel und ein Wintermonat
// dazwischen).
export function readingOff(boundary: string, date: string, table: DegreeDayTable, rule: ReadingOffWarning): { days: number; permille: number; far: boolean } {
  const early = minText(boundary, date)
  const late = maxText(boundary, date)
  const days = dayNumber(late) - dayNumber(early)
  if (days === 0) return { days: 0, permille: 0, far: false }
  const permille = degreeDays(dayAfter(early), late, table)
  const monthAway = date > boundary ? date >= addMonths(boundary, rule.months) : date <= addMonths(boundary, -rule.months)
  let winter = false
  for (let t = dayNumber(dayAfter(early)); t <= dayNumber(late) && !winter; t++) {
    winter = rule.winterMonths.includes(new Date(t * MS_DAY).toISOString().slice(5, 7))
  }
  return { days, permille, far: monthAway && winter }
}

// ---------- Plan ----------

const POTS_OF: Record<HotWater, SelfPot[]> = { combined: ['heating', 'water'], separate: ['heating', 'water'], none: ['heating'] }
const emptyPot = (): SelfUserPot => ({ base: 0, consumption: 0, value: null, group: false })

export function planSelf(input: SelfInput): SelfPlan {
  const { h, table } = input
  const pots = POTS_OF[input.hotWater]
  const problems: SelfProblem[] = []
  const findings: SelfFinding[] = []
  const hDays = spanDays(h.from, h.to)
  const hDegree = degreeDays(h.from, h.to, table)
  const heatSplit = (u: SelfUser): number => (input.changeSplit === 'degreeDays' ? u.degreeDayPermille : u.days)
  const heatSplitTotal = input.changeSplit === 'degreeDays' ? hDegree : hDays
  const splitOf = (pot: SelfPot, u: SelfUser): number => (pot === 'heating' ? heatSplit(u) : u.days)
  const splitTotal = (pot: SelfPot): number => (pot === 'heating' ? heatSplitTotal : hDays)
  const heatAreaOf = (u: SelfUnit): number => (input.areaBasisHeat === 'heatedArea' ? (u.heatedAreaM2 ?? u.areaM2) : u.areaM2) || 0
  const areaOf = (pot: SelfPot, u: SelfUnit): number => (pot === 'heating' ? heatAreaOf(u) : u.areaM2 || 0)
  const metersOf = (unitId: string, pot: SelfPot) => input.meters.filter((m) => m.unitId === unitId && m.type === POT_METER[pot])
  const startBoundary = dayBefore(h.from)
  // Der eingefrorene Endstand der abgeschlossenen Vorperiode steht in der Liste, auch wenn die
  // Ablesung seither geändert wurde; er gilt (er steht in der zugestellten Abrechnung).
  const openingOf = (meterId: string): SelfReading | null => input.opening?.get(meterId) ?? null
  const sortedOf = new Map(input.meters.map((m) => {
    const own = input.readings.filter((r) => r.meterId === m.id)
    const o = openingOf(m.id)
    const same = o ? own.find((x) => x.date === o.date && x.value === o.value) : undefined
    return [m.id, sortReadings(o && !same ? [...own, { ...o, boundFor: null }] : own)]
  }))

  const totals = Object.fromEntries(pots.map((p) => [p, { area: input.units.reduce((a, u) => a + areaOf(p, u), 0), consumption: 0, measured: false }])) as SelfPlan['totals']
  // Ein Topf ohne einen einzigen Zähler ist nicht erfasst (nur nach Fläche, `heating.no-consumption`);
  // ein Topf mit Zählern verlangt einen an jeder Wohnung mit Fläche.
  const potHasMeters = Object.fromEntries(pots.map((p) => [p, input.units.some((u) => metersOf(u.id, p).length > 0)])) as Record<SelfPot, boolean>
  for (const p of pots) if (!(totals[p].area > 0)) problems.push({ kind: 'noArea', pot: p })

  const units: SelfUnitPlan[] = input.units.map((unit) => {
    const users: SelfUserPlan[] = usersOf(unit, input.tenancies, h).map((u) => ({
      ...u,
      degreeDayPermille: degreeDays(u.from, u.to, table),
      pots: { heating: emptyPot(), water: emptyPot() },
    }))
    const boundarySet = new Set<string>([startBoundary, h.to])
    for (const u of users) {
      boundarySet.add(dayBefore(u.from))
      boundarySet.add(u.to)
    }
    const boundaries = [...boundarySet].sort()
    const cells = [...new Set([input.neighbors.before, ...(input.outerChanges?.get(unit.id) ?? []), ...boundaries, input.neighbors.after])].sort()
    const readingAt = new Map<string, Map<string, SelfReading | null>>()
    for (const p of pots) {
      for (const m of metersOf(unit.id, p)) {
        const sorted = sortedOf.get(m.id) ?? []
        const at = boundaryReadingsOf(sorted, boundaries, cells)
        const o = openingOf(m.id)
        if (o) at.set(startBoundary, sorted.find((x) => x.date === o.date && x.value === o.value) ?? null)
        readingAt.set(m.id, at)
        // Zwei verschiedene Werte am selben Tag (Abweichung 9); der eingefrorene Anfangsstand gilt.
        for (const b of boundaries) {
          const chosen = at.get(b) ?? null
          if (chosen && !(o && b === startBoundary) && sameDayConflict(sorted, chosen)) {
            problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: b, reason: 'sameDay', meterName: m.name })
          }
        }
      }
    }
    const consumption: Record<SelfPot, number> = { heating: 0, water: 0 }
    const answerAt = (b: string): InterimGapStatus | null => input.gaps.find((x) => x.unitId === unit.id && x.date === b)?.status ?? null
    const isChange = (b: string): boolean => users.some((u, i) => i < users.length - 1 && u.to === b && users[i + 1]?.from === dayAfter(b))
    // Wie weit die Ablesungen einer Grenze daneben liegen (die fernste über alle Zähler).
    const offAt = new Map<string, { date: string; days: number; permille: number; far: boolean }>()
    for (const b of boundaries) {
      const dates = pots.flatMap((p) => metersOf(unit.id, p)).map((m) => readingAt.get(m.id)?.get(b)?.date ?? null)
      if (dates.length === 0 || dates.some((d) => d === null)) continue
      const farthest = (dates as string[]).filter((d) => d !== b).reduce<string | null>((a, d) => (a === null || Math.abs(dayNumber(d) - dayNumber(b)) > Math.abs(dayNumber(a) - dayNumber(b)) ? d : a), null)
      if (farthest !== null) offAt.set(b, { date: farthest, ...readingOff(b, farthest, table, input.offRule()) })
    }
    // Ab der Warngrenze neben einem Wechsel wählt der Vermieter (§ 9b Abs. 3 Alt. 2, Abweichung 22).
    for (const b of boundaries.filter(isChange)) {
      const off = offAt.get(b)
      const answer = answerAt(b)
      if (off?.far && answer !== 'imprecise' && answer !== 'useReading') {
        problems.push({ kind: 'farInterim', unitId: unit.id, unitName: unit.name, boundary: b, readingDate: off.date, days: off.days })
      }
    }

    // Grundkosten: Fläche der Wohnung im Topf mal Anteil an Gradtagen bzw. Tagen der Heizperiode.
    for (const p of pots) {
      for (const u of users) u.pots[p].base = (totals[p].area > 0 ? areaOf(p, unit) / totals[p].area : 0) * (splitOf(p, u) / splitTotal(p))
    }

    for (const p of pots) {
      const meters = metersOf(unit.id, p)
      if (meters.length === 0) {
        if (potHasMeters[p] && areaOf(p, unit) > 0) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: null, reason: 'noMeter', meterName: null })
        continue
      }
      // „Nach § 9b Abs. 3“ gewählt: die Ablesung gilt als nicht hinreichend genau (Abweichung 22).
      const has = (b: string): boolean => answerAt(b) !== 'imprecise' && meters.every((m) => (readingAt.get(m.id)?.get(b) ?? null) !== null)
      for (const b of [startBoundary, h.to]) {
        for (const m of meters) {
          if ((readingAt.get(m.id)?.get(b) ?? null) === null) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: b, reason: 'noReading', meterName: m.name })
        }
      }
      // Gruppen: Nutzer, zwischen denen die Ablesung fehlt (§ 9b Abs. 3).
      const groups: SelfUserPlan[][] = []
      users.forEach((u, i) => {
        const prev = users[i - 1]
        const clean = prev !== undefined && prev.to === dayBefore(u.from)
        const last = groups[groups.length - 1]
        if (prev && clean && !has(prev.to) && last) last.push(u)
        else groups.push([u])
      })
      // Verbrauch je Gruppe zwischen ihren äußeren Grenzen.
      for (const g of groups) {
        const first = g[0]
        const lastUser = g[g.length - 1]
        if (!first || !lastUser) continue
        const from = dayBefore(first.from)
        const to = lastUser.to
        let v = 0
        let ok = true
        for (const m of meters) {
          const a = readingAt.get(m.id)?.get(from) ?? null
          const b = readingAt.get(m.id)?.get(to) ?? null
          if (a === null || b === null) {
            ok = false
            if (from !== startBoundary && to !== h.to) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: a === null ? from : to, reason: 'noReading', meterName: m.name })
            continue
          }
          const result = measuredBetween(sortedOf.get(m.id) ?? [], a, b)
          if ('problem' in result) {
            ok = false
            problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: to, reason: result.problem, meterName: m.name })
            continue
          }
          v += result.value
        }
        if (!ok) continue
        consumption[p] += v
        const splitSum = g.reduce((a, u) => a + splitOf(p, u), 0)
        for (const u of g) {
          u.pots[p].value = g.length === 1 ? v : splitSum > 0 ? (v * splitOf(p, u)) / splitSum : 0
          u.pots[p].group = g.length > 1
        }
      }
    }

    // Die Grenzen der Wohnung mit ihren Ablesungen (Ausweis, Ampel, Hinweise).
    const bounds: SelfBoundary[] = boundaries
      .filter((b) => b === startBoundary || b === h.to || isChange(b))
      .map((b) => {
        const all = pots.flatMap((p) => metersOf(unit.id, p)).map((m) => readingAt.get(m.id)?.get(b)?.date ?? null)
        const kind = b === startBoundary ? 'start' : b === h.to ? 'end' : 'change'
        const gap = kind === 'change' ? answerAt(b) : null
        return { date: b, kind, readingDates: all, gap, far: offAt.get(b)?.far ?? false }
      })
    // Hinweise an den Wechseln: Ablesung daneben, oder keine (dann mit der Antwort des Vermieters).
    for (const bd of bounds.filter((x) => x.kind === 'change')) {
      const answer = input.gaps.find((x) => x.unitId === unit.id && x.date === bd.date)
      const imprecise = answer?.status === 'imprecise'
      const missingPots = imprecise
        ? pots.filter((p) => metersOf(unit.id, p).length > 0)
        : pots.filter((p) => metersOf(unit.id, p).length > 0 && metersOf(unit.id, p).some((m) => (readingAt.get(m.id)?.get(bd.date) ?? null) === null))
      if (missingPots.length > 0) {
        const around = users.filter((u) => u.to === bd.date || u.from === dayAfter(bd.date))
        // „Ablesung verwenden“ passt nicht zu einer fehlenden Ablesung und zählt dann nicht als Antwort.
        const status = answer && answer.status !== 'useReading' ? answer.status : null
        findings.push({
          kind: 'noInterim', unitId: unit.id, unitName: unit.name, boundary: bd.date, pots: missingPots,
          status, reason: answer?.reason ?? '', tenancyIds: around.flatMap((u) => (u.tenancyId ? [u.tenancyId] : [])),
        })
        continue
      }
      const off = offAt.get(bd.date)
      if (off) findings.push({ kind: 'interimOff', unitId: unit.id, unitName: unit.name, boundary: bd.date, readingDate: off.date, days: off.days, permille: off.permille, far: off.far })
    }

    const readings: SelfReadingView[] = pots.flatMap((p) => metersOf(unit.id, p).flatMap((m) => bounds.map((bd) => {
      const r = readingAt.get(m.id)?.get(bd.date) ?? null
      return { meterId: m.id, meterName: m.name, pot: p, boundary: bd.date, date: r?.date ?? null, value: r?.value ?? null }
    })))
    return { unit, heatArea: heatAreaOf(unit), users, boundaries: bounds, readings, consumption }
  })

  // Summe des Verbrauchs je Topf, dann die Bruchteile.
  for (const p of pots) {
    totals[p].consumption = units.reduce((a, u) => a + u.consumption[p], 0)
    totals[p].measured = potHasMeters[p] && totals[p].consumption > 0
    for (const u of units) {
      for (const user of u.users) {
        const v = user.pots[p].value
        user.pots[p].consumption = totals[p].measured && v !== null ? v / totals[p].consumption : 0
      }
    }
  }

  // Ablesung neben dem Stichtag (Facette 5): je äußerer Grenze die größte Abweichung über alle Zähler.
  for (const b of [startBoundary, h.to]) {
    let worst: { date: string; unitName: string } | null = null
    for (const u of units) {
      for (const d of u.boundaries.find((x) => x.date === b)?.readingDates ?? []) {
        if (d === null || d === b) continue
        if (worst === null || Math.abs(dayNumber(d) - dayNumber(b)) > Math.abs(dayNumber(worst.date) - dayNumber(b))) worst = { date: d, unitName: u.unit.name }
      }
    }
    if (worst) {
      const off = readingOff(b, worst.date, table, input.offRule())
      findings.push({ kind: 'datesDiffer', boundary: b, readingDate: worst.date, unitName: worst.unitName, days: off.days, permille: off.permille, far: off.far })
    }
  }

  return { pots, units, totals, problems, findings }
}

// ---------- Gewichte (Entwurf 8.5, 8.6) ----------

// g_r(T) = (1 − p_T) · Grundanteil + p_T · Verbrauchsanteil; ohne erfassten Verbrauch nur der
// Grundanteil (`heating.no-consumption`). g_r(both) = (1 − α) · g_r(heating) + α · g_r(water).
// `shares` in Prozent, `alpha` als Bruchteil (`null`: keine verbundene Warmwasserbereitung).
export function weightsOf(plan: SelfPlan, shares: { heating: number; water: number }, alpha: number | null): Map<string, SelfWeights> {
  const out = new Map<string, SelfWeights>()
  for (const u of plan.units) {
    for (const user of u.users) {
      const g = (p: SelfPot): number => {
        if (!plan.pots.includes(p)) return 0
        const share = plan.totals[p].measured ? shares[p] / 100 : 0
        return (1 - share) * user.pots[p].base + share * user.pots[p].consumption
      }
      const heating = g('heating')
      const water = g('water')
      out.set(user.key, { heating, water, both: alpha === null ? heating : (1 - alpha) * heating + alpha * water })
    }
  }
  return out
}

// ---------- Ziel einer Position ----------

// Passt das Ziel zur Warmwasserbereitung der Anlage? `null` heißt ja, sonst der Satz für den Hinweis
// `heating.target-invalid` (Abweichung 18 des Plans).
export function targetProblem(hotWater: HotWater, part: HeatingPart | null, target: HeatingTarget | null): string | null {
  if (part === null) return 'Bei der eigenen Heizkostenabrechnung braucht jede Position einen Teil (Brennstoff, Betrieb oder Messung)'
  if (target === null) return 'Bei der eigenen Heizkostenabrechnung braucht jede Position ein Ziel (Heizung und Warmwasser, nur Heizung oder nur Warmwasser)'
  if (hotWater === 'none' && target !== 'heating') return 'Die Heizanlage bereitet kein Warmwasser; die Position gehört zur Heizung'
  if (hotWater === 'separate' && target === 'both') return 'Das Warmwasser wird getrennt bereitet; ordnen Sie die Position der Heizung oder dem Warmwasser zu'
  if (hotWater === 'combined' && part === 'fuel' && target !== 'both') {
    return 'Bereitet die Anlage auch das Warmwasser, gehört der Brennstoff zu beidem und wird nach dem Warmwasseranteil aufgeteilt (§ 9 Abs. 1 HeizkostenV)'
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heating.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (heating.test.ts: 21 Tests). Scheitert Beispiel A um einen Cent, ist die Verteilung
falsch und nicht die Erwartung: Die Zahlen stehen in Entwurf 8.6 und sind dort nachgerechnet.

- [ ] **Step 5: Commit**

```bash
git add server/src/heating.ts server/test/heating.test.ts server/test/law-literals.test.ts
git commit -m "Heizkostenabrechnung: Nutzer, Ablesungen wie abgelesen, § 9b und exakte Gewichte als reine Rechnung

Beispiel A centgenau (1.961,89 / 2.615,84 / 1.331,52 / 750,75 €), Gegenproben zeitanteilig und
nach § 9b Abs. 3, Ablesungen neben Stichtag und Wechsel mit Hinweis, keine Interpolation.

Refs #99"
```

---

### Task 4: Reine Rechnung: Warmwasseranteil, Anteil nach Verbrauch, Wärmepumpe

Der Warmwasseranteil α gemessen (Entwurf 8.3), der Anteil nach Verbrauch mit Vorgabe aus der
Vorperiode und dem Pflichtanteil des § 7 Abs. 1 Satz 2 (8.5, R-A7) und das Urteil, ob die Verordnung
für eine Wärmepumpe im Zeitraum gilt (§ 12 Abs. 3, F5, 4.7). Alle drei als reine Funktionen in
`server/src/heating.ts`; die Rechtswerte kommen als Argument.

**Files:**
- Modify: `server/src/heating.ts`
- Test: `server/test/heating.test.ts`

**Interfaces:**
- Consumes (Task 1, 3): `HeatPumpCapture` (`shared/law/heizkostenv.ts`); `DhwMethod`, `HeatingEnergy`, `HotWater`, `InsulationRule` (`shared/types.ts`).
- Produces (`server/src/heating.ts`):
  - `KWH_ENERGIES: readonly HeatingEnergy[]` (`gas`, `districtHeating`, `heatPump`, `electric`), `OIL_OR_GAS: readonly HeatingEnergy[]` (`gas`, `oil`, `lpg`)
  - `type AlphaInput = { hotWater: HotWater; dhwMethod: DhwMethod | null; energy: HeatingEnergy; dhwHeatKwh: number | null; totalHeatKwh: number | null; fuelKwh: number | null; fuelCoveragePermille: number | null; fuelEstimated?: boolean }`
  - `type AlphaProblem = 'formulaLater' | 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'heatingValueLater' | 'outOfRange'`
  - `type Alpha = { value: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean }`
  - `hotWaterShareOf(i: AlphaInput): { ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem }`
  - `type ShareRow = { period: string; heatConsumptionPct: number | null; waterConsumptionPct: number | null; insulationRule: InsulationRule | null }`
  - `type ConsumptionShares = { heating: number; water: number | null; forced: boolean; previous: { heating: number; water: number | null } | null; own: boolean; changed: boolean }`
  - `consumptionSharesOf(rows: readonly ShareRow[], key: string, energy: HeatingEnergy, forced: () => number): ConsumptionShares | null`
  - `type HeatPumpVerdict = { kind: 'applies' } | { kind: 'notYet'; captureInstalledOn: string | null } | { kind: 'missing' }`
  - `heatPumpVerdict(plant: { energy: HeatingEnergy; capturedOnOct2024: boolean | null; captureInstalledOn: string | null; heatPumpInstalledOn: string | null }, hFrom: string, rule: HeatPumpCapture): HeatPumpVerdict | null`

- [ ] **Step 1: Write the failing tests**

Den Import aus `'../src/heating.ts'` in `server/test/heating.test.ts` um `consumptionSharesOf,
heatPumpVerdict, hotWaterShareOf, type AlphaInput` ergänzen, dazu
`import { hkvHeatPumpCapture } from '../../shared/law/heizkostenv.ts'` (in den vorhandenen Import
aufnehmen). Anhängen:

```ts
// ---------- Warmwasseranteil (Entwurf 8.3) ----------

const gas = (over: Partial<AlphaInput> = {}): AlphaInput => ({
  hotWater: 'combined', dhwMethod: 'heatMeter', energy: 'gas', dhwHeatKwh: 9000, totalHeatKwh: null, fuelKwh: 60000, fuelCoveragePermille: 1000, ...over,
})

test('α gemessen: 9.000 von 60.000 kWh nach Brennwert = 15,0 % (Wortlaut, G-B1 abgelehnt)', () => {
  const r = hotWaterShareOf(gas())
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.15, 'α')
  assert.deepEqual([r.alpha.reference, r.alpha.referenceKwh, r.alpha.dhwHeatKwh, r.alpha.estimated], ['fuel', 60000, 9000, false])
  // Mit der Schätzung beim Abschluss beruht α auf geschätzter Energie (Abweichung 11).
  const geschaetzt = hotWaterShareOf(gas({ fuelEstimated: true }))
  assert.ok(geschaetzt.ok && geschaetzt.alpha?.estimated === true)
})

test('α bei Fernwärme: Gesamtwärme, wenn gemessen, sonst die gelieferten kWh laut Rechnung', () => {
  const mitZaehler = hotWaterShareOf(gas({ energy: 'districtHeating', totalHeatKwh: 45000 }))
  assert.ok(mitZaehler.ok && mitZaehler.alpha)
  near(mitZaehler.alpha.value, 0.2, 'Q / Gesamtwärme')
  assert.equal(mitZaehler.alpha.reference, 'totalHeat')
  const ohne = hotWaterShareOf(gas({ energy: 'districtHeating' }))
  assert.ok(ohne.ok && ohne.alpha)
  near(ohne.alpha.value, 0.15, 'Q / Lieferung')
})

test('α bei Wärmepumpe: nur gegen die gemessene Gesamtwärme; ohne Gesamtwärmezähler ein Fehler (A8)', () => {
  const r = hotWaterShareOf(gas({ energy: 'heatPump', dhwHeatKwh: 4500, totalHeatKwh: 36000, fuelKwh: 12000 }))
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.125, 'Q / Wärme, nicht Q / Strom')
  // Gemessene Wärme geteilt durch Strom ergäbe etwa das Dreifache (37,5 %); das rechnet Mietfuchs nicht.
  assert.deepEqual(hotWaterShareOf(gas({ energy: 'heatPump', dhwHeatKwh: 4500, fuelKwh: 12000 })), { ok: false, problem: 'heatPumpBasis' })
})

test('α: Formeln, Heizöl und Lücken sind gesperrt oder Fehler, ohne Warmwasser gibt es kein α', () => {
  assert.deepEqual(hotWaterShareOf(gas({ dhwMethod: 'volumeFormula' })), { ok: false, problem: 'formulaLater' })
  assert.deepEqual(hotWaterShareOf(gas({ energy: 'oil' })), { ok: false, problem: 'heatingValueLater' })
  assert.deepEqual(hotWaterShareOf(gas({ fuelCoveragePermille: 848.71 })), { ok: false, problem: 'fuelGap' })
  assert.deepEqual(hotWaterShareOf(gas({ fuelKwh: null })), { ok: false, problem: 'noFuelEnergy' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: null })), { ok: false, problem: 'noDhwHeat' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: 60000 })), { ok: false, problem: 'outOfRange' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: 0 })), { ok: false, problem: 'outOfRange' })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'none' })), { ok: true, alpha: null })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'separate', energy: 'oil' })), { ok: true, alpha: null })
})

// ---------- Anteil nach Verbrauch (Entwurf 8.5, R-A7) ----------

const row = (period: string, heat: number | null, water: number | null = heat, insulationRule: 'applies' | 'notApplies' | 'unknown' | null = null) =>
  ({ period, heatConsumptionPct: heat, waterConsumptionPct: water, insulationRule })
const seventy = () => 70

test('R-A7: Vorgabe ist der Anteil der Vorperiode; ein neuer Anteil ist ein Wechsel', () => {
  const geerbt = consumptionSharesOf([row('2024-01', 50)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([geerbt.heating, geerbt.water, geerbt.own, geerbt.changed], [50, 50, false, false])
  const neu = consumptionSharesOf([row('2024-01', 50), row('2025-01', 70)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([neu.heating, neu.own, neu.changed, neu.previous], [70, true, true, { heating: 50, water: 50 }])
  // Eine spätere Heizperiode zählt nicht als Vorperiode.
  // § 8 Abs. 1: ohne eigenen Wert beim Warmwasser kein Ersatz aus der Heizung (Abweichung 14).
  const ohneWasser = consumptionSharesOf([row('2025-01', 60, null)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([ohneWasser.heating, ohneWasser.water], [60, null])
  const geerbtOhneWasser = consumptionSharesOf([row('2024-01', 60, null)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.equal(geerbtOhneWasser.water, null)
  const vorher = consumptionSharesOf([row('2026-01', 60)], '2025-01', 'gas', seventy)
  assert.equal(vorher, null)
  assert.equal(consumptionSharesOf([], '2025-01', 'gas', seventy), null)
})

test('§ 7 Abs. 1 Satz 2: bei Öl und Gas zwingend 70 % für die Heizung, nicht bei Fernwärme (§ 7 Abs. 3)', () => {
  const gasHaus = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'gas', seventy) ?? assert.fail('Gas')
  assert.deepEqual([gasHaus.heating, gasHaus.water, gasHaus.forced], [70, 60, true])
  const fern = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'districtHeating', seventy) ?? assert.fail('Fernwärme')
  assert.deepEqual([fern.heating, fern.forced], [60, false])
  const lpg = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'lpg', seventy) ?? assert.fail('Flüssiggas')
  assert.equal(lpg.heating, 70, 'Flüssiggas zählt als Gasheizung (Abweichung 13)')
  // Die Angabe zur Dämmung erbt wie der Anteil.
  const geerbt = consumptionSharesOf([row('2024-01', 60, 60, 'applies'), row('2025-01', null, null, null)], '2025-01', 'oil', seventy) ?? assert.fail('Öl')
  assert.deepEqual([geerbt.heating, geerbt.forced], [70, true])
})

// ---------- Wärmepumpen (§ 12 Abs. 3, Entwurf 4.7, F5) ----------

const rule = onlyVersion(hkvHeatPumpCapture).value
const wp = (capturedOnOct2024: boolean | null, captureInstalledOn: string | null, heatPumpInstalledOn: string | null = null) =>
  ({ energy: 'heatPump' as const, capturedOnOct2024, captureInstalledOn, heatPumpInstalledOn })

test('Wärmepumpe: die vier Stichtagsfälle aus 4.7 und F5', () => {
  assert.deepEqual(heatPumpVerdict(wp(true, null), '2025-01-01', rule), { kind: 'applies' }, 'schon am 01.10.2024 erfasst')
  assert.deepEqual(heatPumpVerdict(wp(false, '2025-06-01'), '2025-01-01', rule), { kind: 'notYet', captureInstalledOn: '2025-06-01' }, 'nachgerüstet im Zeitraum')
  assert.deepEqual(heatPumpVerdict(wp(false, '2025-06-01'), '2026-01-01', rule), { kind: 'applies' }, 'Zeitraum nach dem Einbau')
  assert.deepEqual(heatPumpVerdict(wp(null, null, '2025-02-01'), '2025-01-01', rule), { kind: 'applies' }, 'F5: neu eingebaut mit Erfassung')
  assert.deepEqual(heatPumpVerdict(wp(false, null), '2026-01-01', rule), { kind: 'missing' }, '15 % als Auslegung (15.1 Nr. 22)')
  assert.deepEqual(heatPumpVerdict(wp(false, null), '2025-01-01', rule), { kind: 'notYet', captureInstalledOn: null }, 'Frist noch offen')
  assert.equal(heatPumpVerdict({ ...wp(null, null), energy: 'gas' }, '2025-01-01', rule), null)
  // Unbekannt: Mietfuchs rechnet nach der Verordnung, die Einrichtung fragt.
  assert.deepEqual(heatPumpVerdict(wp(null, null), '2025-01-01', rule), { kind: 'applies' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/heating.test.ts`
Expected: FAIL mit `does not provide an export named 'consumptionSharesOf'`.

- [ ] **Step 3: Implementierung (`server/src/heating.ts`)**

Den Typimport aus `'../../shared/types.ts'` um `DhwMethod, HeatingEnergy, InsulationRule` ergänzen
und `import type { HeatPumpCapture } from '../../shared/law/heizkostenv.ts'` aufnehmen (zu
`DegreeDayTable` in denselben Import). Ans Dateiende:

```ts
// ---------- Warmwasseranteil (Entwurf 8.3) ----------

// Energien, die in Kilowattstunden abgerechnet werden. Nur bei ihnen ist α = Q / E ohne Heizwert zu
// rechnen (§ 9 Abs. 3 letzter Satz: „Soweit die Abrechnung über Kilowattstunden-Werte erfolgt, ist
// eine Umrechnung in Brennstoffverbrauch nicht erforderlich“). Heizöl, Flüssiggas, Pellets, Holz und
// Kohle brauchen den Heizwert laut Rechnung, hilfsweise die Tabelle; das kommt mit PR 11
// (Abweichung 10 des Plans).
export const KWH_ENERGIES: readonly HeatingEnergy[] = ['gas', 'districtHeating', 'heatPump', 'electric']

export type AlphaInput = {
  hotWater: HotWater
  dhwMethod: DhwMethod | null
  energy: HeatingEnergy
  // gemessene Wärme des Warmwassers und Gesamtwärme in kWh (eingetragen oder vom Zähler, Abweichung 12)
  dhwHeatKwh: number | null
  totalHeatKwh: number | null
  // Energie der in der Heizperiode verbrauchten Lieferungen in kWh, wie abgerechnet, und ihre Abdeckung
  fuelKwh: number | null
  fuelCoveragePermille: number | null
  // Eine der verbrauchten Lieferungen ist die Schätzung beim Abschluss (PR 7, Abweichung 11).
  fuelEstimated?: boolean
}
export type AlphaProblem = 'formulaLater' | 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'heatingValueLater' | 'outOfRange'
export type Alpha = { value: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean }

const COVERAGE_FULL = 1000

// α nach § 9 Abs. 1 Satz 2 und Abs. 2 HeizkostenV. Bei Heizkesseln nach dem Anteil am Energieverbrauch:
// gemessene Wärme Q durch die Energie des verbrauchten Brennstoffs, wie abgerechnet. Mietfuchs rechnet
// nach dem Wortlaut: Der Faktor für Erdgas nach Brennwert gilt nur für Formelwerte (Abs. 2 Satz 6), und
// bei kWh ist keine Umrechnung nötig (Abs. 3); die Gegenlesung steht im Lexikon (15.1 Nr. 9,
// ⟨Norm offen: VDI 2077⟩). Bei Wärmepumpen und Wärmelieferung nach dem Anteil am Wärmeverbrauch:
// Q durch die gemessene Gesamtwärme; bei Fernwärme ohne Gesamtwärmezähler durch die gelieferten kWh
// laut Rechnung, die Wärme sind. Eine Wärmepumpe ohne Gesamtwärme ergäbe Wärme durch Strom, rund das
// Dreifache; dann ein Fehler (A8). Ohne verbundene Warmwasserbereitung gibt es kein α.
export function hotWaterShareOf(i: AlphaInput): { ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem } {
  if (i.hotWater !== 'combined') return { ok: true, alpha: null }
  if (i.dhwMethod === 'volumeFormula' || i.dhwMethod === 'areaFormula') return { ok: false, problem: 'formulaLater' }
  if (!KWH_ENERGIES.includes(i.energy)) return { ok: false, problem: 'heatingValueLater' }
  if (i.dhwHeatKwh === null) return { ok: false, problem: 'noDhwHeat' }
  let referenceKwh: number
  let reference: Alpha['reference']
  if (i.energy === 'heatPump') {
    if (i.totalHeatKwh === null) return { ok: false, problem: 'heatPumpBasis' }
    referenceKwh = i.totalHeatKwh
    reference = 'totalHeat'
  } else if (i.energy === 'districtHeating' && i.totalHeatKwh !== null) {
    referenceKwh = i.totalHeatKwh
    reference = 'totalHeat'
  } else {
    if (i.fuelKwh === null) return { ok: false, problem: 'noFuelEnergy' }
    // Eine Lücke hochzurechnen wäre eine Schätzung (W4); α braucht die ganze Heizperiode (Abweichung 11).
    if (i.fuelCoveragePermille === null || i.fuelCoveragePermille < COVERAGE_FULL - 1e-6) return { ok: false, problem: 'fuelGap' }
    referenceKwh = i.fuelKwh
    reference = 'fuel'
  }
  const value = referenceKwh > 0 ? i.dhwHeatKwh / referenceKwh : Number.NaN
  if (!(value > 0 && value < 1)) return { ok: false, problem: 'outOfRange' }
  return { ok: true, alpha: { value, dhwHeatKwh: i.dhwHeatKwh, referenceKwh, reference, estimated: reference === 'fuel' && i.fuelEstimated === true } }
}

// ---------- Anteil nach Verbrauch (Entwurf 8.5, R-A7) ----------

// „Öl- oder Gasheizung“ im Sinne des § 7 Abs. 1 Satz 2. Flüssiggas zählt als Gas (Abweichung 13 des
// Plans); Wärmelieferung nicht (§ 7 Abs. 3), Wärmepumpe und Strom nicht.
export const OIL_OR_GAS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg']

export type ShareRow = { period: string; heatConsumptionPct: number | null; waterConsumptionPct: number | null; insulationRule: InsulationRule | null }
export type ConsumptionShares = {
  heating: number
  // null: kein eigener Wert für das Warmwasser (§ 8 Abs. 1); bei verbundener oder getrennter
  // Warmwasserbereitung ist das `heating.self-incomplete` (Abweichung 14).
  water: number | null
  forced: boolean
  previous: { heating: number; water: number | null } | null
  own: boolean
  changed: boolean
}

// Der Anteil nach Verbrauch einer Heizperiode, in Prozent. **Vorgabe ist der Anteil der vorigen
// Heizperiode** (§ 6 Abs. 4: der Gebäudeeigentümer wählt, ändern nur für künftige Zeiträume durch
// Erklärung); die eigene Zeile gilt, wenn sie einen Wert hat. Ohne beides `null` (Abweichung 14). Das
// Warmwasser hat seinen eigenen Wert aus der eigenen Zeile oder der Vorperiode und bekommt nie still den
// der Heizung (§ 8 Abs. 1 verlangt eine eigene Wahl); fehlt er, ist `water` null. Bei Öl und Gas
// mit `insulationRule = 'applies'` zwingend `forced()` für die Heizung (§ 7 Abs. 1 Satz 2); das
// Warmwasser regelt § 8 und bleibt, wie es ist.
export function consumptionSharesOf(rows: readonly ShareRow[], key: string, energy: HeatingEnergy, forced: () => number): ConsumptionShares | null {
  const own = rows.find((r) => r.period === key)
  const earlier = rows.filter((r) => r.period < key).slice().sort((a, b) => (a.period < b.period ? 1 : -1))
  const prevShare = earlier.find((r) => r.heatConsumptionPct !== null)
  const previous = prevShare && prevShare.heatConsumptionPct !== null
    ? { heating: prevShare.heatConsumptionPct, water: prevShare.waterConsumptionPct }
    : null
  const ownHeat = own?.heatConsumptionPct ?? null
  const heat = ownHeat ?? previous?.heating ?? null
  if (heat === null) return null
  const water = ownHeat !== null ? (own?.waterConsumptionPct ?? null) : (previous?.water ?? null)
  const insulation = own?.insulationRule ?? earlier.find((r) => r.insulationRule !== null)?.insulationRule ?? null
  const isForced = insulation === 'applies' && OIL_OR_GAS.includes(energy)
  return {
    heating: isForced ? forced() : heat,
    water,
    forced: isForced,
    previous,
    own: ownHeat !== null,
    changed: ownHeat !== null && previous !== null && (ownHeat !== previous.heating || water !== previous.water),
  }
}

// ---------- Wärmepumpen (§ 12 Abs. 3 HeizkostenV, Entwurf 4.3, 4.7) ----------

export type HeatPumpVerdict = { kind: 'applies' } | { kind: 'notYet'; captureInstalledOn: string | null } | { kind: 'missing' }

// Gilt die Verordnung im Zeitraum, der am `hFrom` beginnt? `null` bei einer anderen Energie.
// - Am 01.10.2024 schon erfasst: ja.
// - Nach dem 01.10.2024 eingebaut: ja, Abs. 3 betrifft nur Wärmepumpen, deren Verbrauch an diesem Tag
//   „noch nicht erfasst“ wird (F5, Abweichung 1).
// - Am 01.10.2024 nicht erfasst und die Erfassung später eingebaut: ab dem Zeitraum, der danach
//   beginnt (Satz 2).
// - Ohne Erfassung: bis zur Frist noch nicht; danach ist die Pflicht aus Satz 1 verletzt, und Mietfuchs
//   rechnet mit 15 % nach § 12 Abs. 1 Satz 1, als Auslegung (15.1 Nr. 22).
// - Unbekannt: nach der Verordnung; die Einrichtung fragt (Schritt 6).
export function heatPumpVerdict(
  plant: { energy: HeatingEnergy; capturedOnOct2024: boolean | null; captureInstalledOn: string | null; heatPumpInstalledOn: string | null },
  hFrom: string,
  rule: HeatPumpCapture,
): HeatPumpVerdict | null {
  if (plant.energy !== 'heatPump') return null
  if (plant.capturedOnOct2024 === true) return { kind: 'applies' }
  if (plant.heatPumpInstalledOn !== null && plant.heatPumpInstalledOn > rule.capturedBy) return { kind: 'applies' }
  if (plant.capturedOnOct2024 === false) {
    if (plant.captureInstalledOn !== null) return hFrom > plant.captureInstalledOn ? { kind: 'applies' } : { kind: 'notYet', captureInstalledOn: plant.captureInstalledOn }
    return hFrom > rule.installBy ? { kind: 'missing' } : { kind: 'notYet', captureInstalledOn: null }
  }
  return { kind: 'applies' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heating.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (heating.test.ts: 28 Tests). `law-literals.test.ts` bleibt grün: heating.ts enthält
weder ein Datum noch eine Rechtszahl, nur die Promille eines vollen Jahres (`COVERAGE_FULL`).

- [ ] **Step 5: Commit**

```bash
git add server/src/heating.ts server/test/heating.test.ts
git commit -m "Heizkostenabrechnung: Warmwasseranteil gemessen, Anteil aus der Vorperiode, Wärmepumpen nach § 12 Abs. 3

α nach dem Wortlaut (15,0 %), Wärmepumpe nur gegen die Gesamtwärme; Pflichtanteil bei Öl und Gas,
nicht bei Fernwärme; die Stichtagsfälle der Wärmepumpe samt Neubau mit Erfassung.

Refs #99"
```

---

### Task 5: Lesen und Schreiben: Einrichtung, Anteil, Ziel, fehlende Zwischenablesungen, Mieterwechsel

Die neuen Felder werden gelesen und geschrieben; die Schreibprüfungen halten Schlüssel, Ziel und
Anlage zusammen (Abweichung 18); die Einrichtung (Schritt 7) stellt eine Anlage in einer Transaktion
auf die eigene Abrechnung um, samt Anteil, Zählern und Umstellung der offenen Positionen (Abweichung
17, Review Focus 3); der Anteil einer Heizperiode lässt sich nur vor ihrem Beginn ändern (§ 6 Abs. 4,
R-A7); die Antwort „nicht möglich / nicht durchgeführt“ wird gespeichert (Abweichung 8), auch beim
Mieterwechsel, der dazu ein eigenes Ablesedatum kennt (Entwurf 3.5, 11.4).

**Files:**
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts`, `server/src/db/co2.ts`
- Create: `server/src/db/heatingSelf.ts`
- Test: `server/test/db-heizkosten.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2–4; PR 2, 4, 5, 6, 8): `heatingPlants`, `heatingPeriods`, `costItems`, `meters`, `units`, `interimReadingGaps`, `HEATING_TARGETS`, `HOT_WATER`, `CAPTURE_METHODS`, `AREA_BASES_HEAT`, `INTERIM_GAP_STATUS`, `HEATING_PARTS`; `targetProblem`, `consumptionSharesOf`, `KWH_ENERGIES`, `OIL_OR_GAS`, `POT_METER`; `hkvConsumptionShare`, `hkvConsumptionShareForced`, `valueAt`; `servesUnit` (`shared/heatingPeriod.ts`); `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`, `PlantContext` (`server/src/db/heatingPeriodContext.ts`, PR 8); `readHeatingPlants`, `readCostItems`, `readMeters`, `readUnits`, `readClosedSettlements`, `Stock`, `readStock`; `HeatingError`, `has`, `raw`, `merged`, `oneOfOrUndefined`, `asNullableFilled`, `ISO_DATE`, `mergeCostItem`, `costItemRow`, `patchCostItemIn`, `withCollection`, `guardCostItemHeating`, `changeTenant`, `TenantChangeError`, `isIsoDate`; db/heating.ts `mergeHeatingPlant`, `emptyHeatingPlant`, `guardHeatingPlant`, `plantRow`, `updateHeatingPlant`, `createHeatingPlant`, `LATER`, `heatingPlantViolations`; db/co2.ts `heatingPeriodViews`.
- Produces:
  - read.ts: `readInterimGaps(db: Database): Promise<InterimGap[]>`, `Stock.interimGaps: InterimGap[]`; `HeatingPlant` mit `hotWater`, `capture`, `areaBasisHeat`, `heatPumpInstalledOn`; `CostItem.heatingTarget`
  - repository.ts: `insertEntityIn(tx: Executor, coll: CollectionName, id: string, body: unknown): Promise<void>`; `guardHeatingSystem(db: Executor, after: CostItem): Promise<void>` (aufgerufen aus `guardCostItemHeating`); `changeTenant` nimmt je Ablesung `date?` und `interimGap?: { status, reason }`
  - heatingSelf.ts: `type SelfConvertItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents' | 'key'> & { heatingPart: HeatingPart | null }`, `class SelfItemsError extends Error { status: 409; items: SelfConvertItem[] }`, `SELF_VIA_SETUP: string`, `distributionOf(rows: readonly ShareRow[], energy: HeatingEnergy, h: Pick<BillingPeriod, 'key' | 'from'>, today: string): HeatingDistribution`, `setUpSelf(db: Database, plantId: string, body: unknown, today: string, newId: () => string): Promise<{ plant: HeatingPlant; created: Meter[]; converted: number } | null>`, `saveDistribution(db: Database, plantId: string, period: string, body: unknown, today: string): Promise<HeatingDistribution | null>`, `saveInterimGap(db: Database, unitId: string, date: string, body: unknown): Promise<InterimGap | null>`, `removeInterimGap(db: Database, unitId: string, date: string): Promise<boolean>`, `selfItemsOf(db: Executor, plantId: string, keyNot: CostKey | null, keyIs: CostKey | null): Promise<SelfConvertItem[]>`
  - db/co2.ts: `heatingPeriodViews(db, plantId, periodParam, today = '')` füllt `distribution` bei `method = 'self'`

- [ ] **Step 1: Write the failing tests**

`server/test/db-heizkosten.test.ts`:

```ts
// Lesen und Schreiben der eigenen Heizkostenabrechnung (Heizung PR 10): Einrichtung in einer
// Transaktion, Anteil nur vor Beginn der Heizperiode änderbar (§ 6 Abs. 4), Schlüssel und Ziel
// passen zur Anlage, Antworten zu fehlenden Zwischenablesungen, Mieterwechsel mit eigenem Ablesedatum.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { changeTenant, createEntity } from '../src/db/repository.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { removeInterimGap, saveDistribution, saveInterimGap, SelfItemsError, setUpSelf } from '../src/db/heatingSelf.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizkosten-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)

let ids = 0
const newId = () => `neu-${++ids}`

// Drei Wohnungen, je ein Mieter, Gasheizung mit freien Schlüsseln und eine Heizposition nach Fläche.
async function haus(opened: Opened, energy = 'gas'): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
    await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 600000, key: 'area' })
  })
}
const SETUP = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }

test('Review Focus 3: Umstellen auf die eigene Abrechnung nennt erst die offenen Positionen, dann alles in einer Transaktion', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const erst = opened.write((db) => setUpSelf(db, 'hp', SETUP, '2026-02-01', newId))
    await assert.rejects(erst, (e: unknown) => e instanceof SelfItemsError && e.status === 409 && e.items.map((i) => [i.id, i.key]).join() === 'gas,area')
    let stock = await opened.read(readStock)
    assert.equal(stock.heatingPlants.find((p) => p.id === 'hp')?.method, 'manual', 'nichts geschrieben')
    assert.equal(stock.meters.length, 0)
    const done = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    assert.ok(done)
    assert.deepEqual([done.plant.method, done.plant.capture, done.plant.hotWater, done.converted], ['self', 'heatMeter', 'combined', 1])
    stock = await opened.read(readStock)
    const gas = stock.costItems.find((c) => c.id === 'gas')
    assert.deepEqual([gas?.key, gas?.heatingPart, gas?.heatingTarget], ['heatingSystem', 'fuel', 'both'])
    // Je Wohnung ein Wärme- und ein Warmwasserzähler, dazu der Wärmezähler am Speicher.
    assert.deepEqual(stock.meters.map((m) => [m.unitId, m.type, m.heatingRole ?? null]).sort(), [
      ['a', 'waerme', null], ['a', 'warmwasser', null], ['b', 'waerme', null], ['b', 'warmwasser', null], ['c', 'waerme', null], ['c', 'warmwasser', null], [null, 'waerme', 'dhwHeat'],
    ].sort())
    const row = stock.heatingPeriodRows.find((r) => r.plantId === 'hp' && r.period === '2025-01')
    assert.deepEqual([row?.heatConsumptionPct, row?.waterConsumptionPct, row?.insulationRule, row?.dhwMethod], [70, 70, 'notApplies', 'heatMeter'])
  })
})

test('Einrichtung: Anteil 50 bis 70 %, Pflichtanteil bei gedämmten Leitungen, Warmwasseranteil bei Heizöl erst später', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const items = [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }]
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 75 }, '2026-02-01', newId)), status(400, /§ 10 HeizkostenV.*späteren Version/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 45 }, '2026-02-01', newId)), status(400, /mindestens 50/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 60, insulationRule: 'applies' }, '2026-02-01', newId)), status(400, /70 %.*§ 7 Abs\. 1 Satz 2/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, capture: 'hca' }, '2026-02-01', newId)), status(400, /späteren Version/))
    // § 8 Abs. 1: Der Anteil beim Warmwasser ist eine eigene Wahl, nie still der der Heizung (Abweichung 14).
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, waterConsumptionPct: undefined }, '2026-02-01', newId)), status(400, /Warmwasser.*§ 8 Abs\. 1/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2026-02-01', newId)), status(400, /§ 9 Abs\. 1/))
  })
  await withDatabase(async (opened) => {
    await haus(opened, 'oil')
    await assert.rejects(
      opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId)),
      status(400, /späteren Version.*Heizwert/),
    )
    const ohneWarmwasser = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, hotWater: 'none', dhwHeatMeter: false, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2026-02-01', newId))
    assert.equal(ohneWarmwasser?.plant.hotWater, 'none')
  })
})

test('Eigene Abrechnung nur über die Einrichtung; zurück auf freie Schlüssel nur mit Bestätigung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'self', capture: 'heatMeter' })), status(400, /Einrichtung/))
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' })), (e: unknown) => e instanceof SelfItemsError && e.items.length === 1)
    const back = await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    assert.equal(back?.method, 'manual')
    const gas = (await opened.read(readStock)).costItems.find((c) => c.id === 'gas')
    assert.deepEqual([gas?.key, gas?.heatingTarget ?? null], ['area', null])
  })
})

test('Schlüssel und Ziel: nach Heizkostenverordnung nur bei eigener Abrechnung, dort nur so, und das Ziel passt zum Warmwasser', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const neu = (id: string, body: Record<string, unknown>) => opened.write((db) => createEntity(db, 'costItems', id, {
      propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Wartung', amountCents: 24000, ...body,
    }))
    await assert.rejects(neu('w1', { key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'operating', heatingTarget: 'both' }), status(400, /eigener Heizkostenabrechnung/))
    // „Nur Heizung“ bei freien Schlüsseln (A2, B7) ist erlaubt.
    await neu('w2', { key: 'area', heatingTarget: 'heating' })
    await assert.rejects(
      opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48000, key: 'area', heatingTarget: 'heating' })),
      status(400, /Heizung und Warmwasser/),
    )
    await opened.write((db) => setUpSelf(db, 'hp', {
      ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }, { id: 'w2', heatingPart: 'operating', heatingTarget: 'heating' }],
    }, '2026-02-01', newId))
    await assert.rejects(neu('w3', { key: 'area' }), status(400, /nach Heizkostenverordnung/))
    await assert.rejects(neu('w4', { key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: 'water' }), status(400, /§ 9 Abs\. 1/))
    await neu('w5', { key: 'heatingSystem', heatingPart: 'metering', heatingTarget: 'water' })
    const w2 = (await opened.read(readStock)).costItems.find((c) => c.id === 'w2')
    assert.deepEqual([w2?.key, w2?.heatingTarget], ['heatingSystem', 'heating'])
  })
})

test('R-A7: der Anteil einer begonnenen Heizperiode bleibt; ein neuer gilt ab der nächsten und ist ein Wechsel', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 50, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2025-03-01', newId))
    // 2025 hat am 01.01. begonnen: Die Einrichtung hat den bisherigen Anteil festgehalten, ändern geht nicht mehr.
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2025-01', { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }, '2025-03-01')), status(400, /§ 6 Abs\. 4/))
    const next = await opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }, '2025-11-15'))
    assert.deepEqual([next?.own.heating, next?.effective?.heating, next?.inherited, next?.begun], [70, 70, false, false])
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025', '2025-03-01')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.distribution?.effective?.heating, view?.distribution?.begun, view?.distribution?.first], [50, true, false])
  })
})

test('Fehlende Zwischenablesung: Antwort speichern, ändern, entfernen', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const gap = await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'missed', reason: '' }))
    assert.deepEqual(gap, { unitId: 'c', date: '2025-09-30', status: 'missed', reason: '' })
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    assert.deepEqual((await opened.read(readStock)).interimGaps, [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }])
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'vergessen' })), status(400, /nicht möglich/))
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'c', '30.09.2025', { status: 'missed' })), status(400, /Datum/))
    assert.equal(await opened.write((db) => saveInterimGap(db, 'zz', '2025-09-30', { status: 'missed' })), null)
    assert.equal(await opened.write((db) => removeInterimGap(db, 'c', '2025-09-30')), true)
    assert.deepEqual((await opened.read(readStock)).interimGaps, [])
  })
})

test('Mieterwechsel: Ablesung mit eigenem Datum neben dem Auszug, und die Antwort ohne Zwischenablesung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => createEntity(db, 'meters', 'wc', { propertyId: 'objekt-1', name: 'Wärme C', unitId: 'c', type: 'waerme', unit: 'kWh' }))
    await opened.write((db) => createEntity(db, 'meters', 'xc', { propertyId: 'objekt-1', name: 'Warmwasser C', unitId: 'c', type: 'warmwasser', unit: 'm³' }))
    await opened.write((db) => createEntity(db, 'meters', 'wb', { propertyId: 'objekt-1', name: 'Wärme B', unitId: 'b', type: 'waerme', unit: 'kWh' }))
    const r = await opened.write((db) => changeTenant(db, 'objekt-1', 'tc', {
      end: '2025-09-30',
      readings: [{ meterId: 'wc', value: 7800, date: '2025-10-03' }],
      interimGap: null,
      newTenancy: { tenantName: 'Mieter C2', persons: 1, personHistory: [{ from: '2025-10-01', persons: 1 }], start: '2025-10-01', baseRents: [], prepayments: [], prepaymentOverrides: {} },
    }, newId))
    assert.deepEqual(r?.readings.map((x) => [x.meterId, x.date, x.value, x.interimFor]), [['wc', '2025-10-03', 7800, '2025-09-30']])
    await assert.rejects(
      opened.write((db) => changeTenant(db, 'objekt-1', 'tb', { end: '2025-06-30', readings: [{ meterId: 'wb', value: 1, date: '30.06.2025' }], newTenancy: null }, newId)),
      status(400, /Ablesedatum/),
    )
    await opened.write((db) => changeTenant(db, 'objekt-1', 'ta', { end: '2025-06-30', readings: [], interimGap: { status: 'impossible', reason: 'Mieter verreist' }, newTenancy: null }, newId))
    assert.deepEqual((await opened.read(readStock)).interimGaps, [{ unitId: 'a', date: '2025-06-30', status: 'impossible', reason: 'Mieter verreist' }])
  })
})

test('Beheizte Fläche: bei Grundkosten nach beheizter Fläche braucht jede angeschlossene Wohnung eine', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const items = [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }]
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, areaBasisHeat: 'heatedArea' }, '2026-02-01', newId)), status(400, /beheizte Fläche/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a', heatedAreaM2: 50 }, { unitId: 'b', heatedAreaM2: 70 }, { unitId: 'c', heatedAreaM2: 55 }] }))
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, areaBasisHeat: 'heatedArea' }, '2026-02-01', newId))
    assert.equal(ok?.plant.areaBasisHeat, 'heatedArea')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-heizkosten.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `src/db/heatingSelf.ts`.

- [ ] **Step 3: Lesen (`server/src/db/read.ts`)**

In `readHeatingPlants` (PR 4) im Objekt jeder Anlage hinter den Feldern von PR 7:

```ts
    hotWater: p.hotWater,
    capture: p.capture,
    areaBasisHeat: p.areaBasisHeat,
    heatPumpInstalledOn: p.heatPumpInstalledOn,
```

In `readCostItems` hinter der Zeile, die `heatingPart` übernimmt (PR 3), in derselben Schreibweise:

```ts
      ...(c.heatingTarget !== null ? { heatingTarget: c.heatingTarget } : {}),
``` Hinter `readHeatingPeriodRows` (PR 6):

```ts
// Die Antworten zu fehlenden Zwischenablesungen (Heizung PR 10, Abweichung 8), nach Wohnung und Datum.
export async function readInterimGaps(db: Database): Promise<InterimGap[]> {
  const rows = await db.select().from(interimReadingGaps).orderBy(interimReadingGaps.unitId, interimReadingGaps.date)
  return rows.map((r) => ({ unitId: r.unitId, date: r.date, status: r.status, reason: r.reason }))
}
```

`Stock` bekommt `interimGaps: InterimGap[]`, `readStock` die Zeile
`    interimGaps: await readInterimGaps(db),` hinter `heatingPeriodRows`. Importe: `interimReadingGaps`
aus `'./schema.ts'`, `InterimGap` in den Typimport aus `'../../../shared/types.ts'`.

- [ ] **Step 4: Schreiben der Kostenposition und Prüfung (`server/src/db/repository.ts`)**

`mergeCostItem`: hinter der Zeile, die `heatingPart` verschmilzt (PR 3), ergänzen:

```ts
    heatingTarget: merged(body, 'heatingTarget', current.heatingTarget, (v) => oneOfOrUndefined(HEATING_TARGETS, v)),
```

In der Zeile der Tabelle aus einem `CostItem` (dort, wo `heatingPart: orNull(c.heatingPart)` steht)
dahinter `heatingTarget: orNull(c.heatingTarget),`. Importe: `HEATING_TARGETS` aus `'./schema.ts'`,
`targetProblem` aus `'../heating.ts'`.

Hinter `guardCostItemHeating` (PR 4, ergänzt von PR 5, 7, 9) die neue Prüfung, und als letzte
Anweisung im Rumpf von `guardCostItemHeating` ihr Aufruf `await guardHeatingSystem(db, after)`:

```ts
// Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3, Abweichung 18): Nach Heizkostenverordnung
// verteilt nur eine Position einer Anlage mit `method = 'self'`, mit Teil und Ziel, und deren
// Positionen verteilen nur so. Das Ziel passt zur Warmwasserbereitung (heating.ts, `targetProblem`).
// „Nur Heizung“ bei freien Schlüsseln bleibt erlaubt (A2, B7).
export async function guardHeatingSystem(db: Executor, after: CostItem): Promise<void> {
  const target = after.heatingTarget ?? null
  if (target !== null && after.category !== HEATING_CATEGORY) {
    throw new HeatingError(400, 'Ein Ziel (Heizung, Warmwasser) gibt es nur bei der Kostenart „Heizung und Warmwasser“.')
  }
  const plantId = after.heatingPlantId ?? null
  const [plant] = plantId === null ? [] : await db.select({ method: heatingPlants.method, hotWater: heatingPlants.hotWater }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (after.key === 'heatingSystem') {
    if (after.category !== HEATING_CATEGORY || !plant || plant.method !== 'self') {
      throw new HeatingError(400,
        'Nach der Heizkostenverordnung verteilt Mietfuchs nur Positionen einer Heizanlage mit eigener Heizkostenabrechnung. Richten Sie sie in den Stammdaten unter „Heizung“ ein oder wählen Sie einen anderen Schlüssel.')
    }
    const problem = targetProblem(plant.hotWater, after.heatingPart ?? null, target)
    if (problem !== null) throw new HeatingError(400, `${problem}.`)
    return
  }
  if (plant?.method === 'self' && after.category === HEATING_CATEGORY) {
    throw new HeatingError(400,
      'Diese Heizanlage rechnet die Heizkosten selbst nach der Heizkostenverordnung ab. Wählen Sie den Schlüssel „nach Heizkostenverordnung“ mit Teil und Ziel.')
  }
}

// Für die Einrichtung der eigenen Heizkostenabrechnung (Heizung PR 10): innerhalb einer fremden
// Transaktion anlegen, durch dieselbe Verschmelzung und denselben Wächter wie die Routen (wie
// `insertCostItemIn` für die Belegbuchung).
export async function insertEntityIn(tx: Executor, coll: CollectionName, id: string, body: unknown): Promise<void> {
  await withCollection<Promise<void>>(coll, async (c) => {
    const entity = c.merge(c.empty(id), body)
    await c.guard(tx, null, entity, body)
    await c.insert(tx, entity)
  })
}
```

(`heatingPlants` und `HEATING_CATEGORY` stehen in repository.ts seit PR 4.)

- [ ] **Step 5: Mieterwechsel (`server/src/db/repository.ts`, `changeTenant`)**

Den Typimport aus `'../../../shared/types.ts'` um `InterimGapStatus` ergänzen, `interimReadingGaps` und
`INTERIM_GAP_STATUS` in den Import aus `'./schema.ts'`. Im Kommentar über `changeTenant` ergänzen:

```ts
// **Heizung PR 10 (Entwurf 3.5, 11.4):** Eine Ablesung darf ein eigenes Datum tragen, wenn sie neben
// dem Auszug liegt (Brunata erfasst Wechsel- und Ablesedatum getrennt); gerechnet wird mit dem Wert,
// wie er ist. Gibt es keine Zwischenablesung, sagt `interimGap`, ob sie nicht möglich war oder nicht
// durchgeführt wurde (§ 9b Abs. 3); gespeichert für die Grenze am Auszugstag.
```

In der Schleife über die Angaben der Ablesungen die Zeilen ab `ablesungen.push(` ersetzen durch:

```ts
    const datum = raw(angabe, 'date')
    if (datum !== undefined && datum !== null && !isIsoDate(datum)) {
      throw new TenantChangeError(400, `Das Ablesedatum für „${meter.name}“ ist kein Datum. Bitte wählen Sie es im Kalender.`)
    }
    ablesungen.push(mergeReading(emptyReading(nextId()), {
      meterId: meter.id, date: typeof datum === 'string' ? datum : end, value, note: `Zwischenablesung Mieterwechsel ${current.tenantName}`, interimFor: end,
    }))
```

Hinter der Schleife:

```ts
  // Keine Zwischenablesung: nicht möglich oder nicht durchgeführt (Heizung PR 10, Abweichung 8).
  const lueckeRumpf = raw(body, 'interimGap')
  let luecke: { status: InterimGapStatus; reason: string } | null = null
  if (lueckeRumpf !== null && lueckeRumpf !== undefined) {
    const s = oneOfOrUndefined(INTERIM_GAP_STATUS, raw(lueckeRumpf, 'status'))
    if (s === undefined) throw new TenantChangeError(400, 'Bitte wählen Sie, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.')
    const grund = raw(lueckeRumpf, 'reason')
    luecke = { status: s, reason: typeof grund === 'string' ? grund.trim() : '' }
  }
```

Die Ablesung trägt ihre Grenze (`interimFor: end`, Abweichung 9 und 23): Sie gehört fest zum
Wechsel, auch wenn eine andere Ablesung näher läge. Dafür in `repository.ts`: `mergeReading` übernimmt
`interimFor: merged(body, 'interimFor', current.interimFor, (v) => (typeof v === 'string' && ISO_DATE.test(v) ? v : undefined))`,
die Zeile von `readingCollection` schreibt `interimFor: orNull(r.interimFor)`, und `read.ts` liest
`...(r.interimFor !== null ? { interimFor: r.interimFor } : {})` (dasselbe Muster wie `heatingPart`,
PR 3); der Test oben prüft die Grenze an der Ablesung.

In der Transaktion hinter `for (const ablesung of ablesungen) await readingCollection.insert(tx, ablesung)`:

```ts
    if (luecke) {
      await tx.delete(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, current.unitId), eq(interimReadingGaps.date, end)))
      await tx.insert(interimReadingGaps).values({ unitId: current.unitId, date: end, status: luecke.status, reason: luecke.reason })
    }
```

(`and` in den Import aus `'drizzle-orm'` aufnehmen, falls nicht da.)

- [ ] **Step 6: Anlage (`server/src/db/heating.ts`)**

In `mergeHeatingPlant` hinter den Feldern von PR 7:

```ts
    hotWater: merged(body, 'hotWater', current.hotWater, (v) => oneOfOrUndefined(HOT_WATER, v) ?? current.hotWater),
    capture: merged(body, 'capture', current.capture, (v) => (v === null ? null : oneOfOrUndefined(CAPTURE_METHODS, v) ?? current.capture)),
    areaBasisHeat: merged(body, 'areaBasisHeat', current.areaBasisHeat, (v) => oneOfOrUndefined(AREA_BASES_HEAT, v) ?? current.areaBasisHeat),
    heatPumpInstalledOn: merged(body, 'heatPumpInstalledOn', current.heatPumpInstalledOn, asNullableFilled),
```

In `emptyHeatingPlant` als letzte Felder: `hotWater: 'combined', capture: null, areaBasisHeat: 'area',
heatPumpInstalledOn: null,`. In `plantRow` dieselben vier Felder:
`hotWater: p.hotWater, capture: p.capture, areaBasisHeat: p.areaBasisHeat, heatPumpInstalledOn: p.heatPumpInstalledOn,`.
Importe: `AREA_BASES_HEAT, CAPTURE_METHODS, HOT_WATER` aus `'./schema.ts'`, `KWH_ENERGIES` aus
`'../heating.ts'`, `SELF_VIA_SETUP`, `SelfItemsError`, `selfItemsOf` aus `'./heatingSelf.ts'`.

In `LATER` (PR 4) den Eintrag `self` und `heatedArea` entfernen und ergänzen:

```ts
  capture: 'Heizkostenverteiler und die Werte eines Ablesedienstes wertet Mietfuchs mit einer späteren Version aus. Bis dahin rechnen Sie mit Wärmezählern ab oder übernehmen die Abrechnung des Messdienstes als Einzelbeträge.',
  dhwHeatingValue: 'Den Warmwasseranteil bei Heizöl, Flüssiggas, Pellets, Holz und Kohle rechnet Mietfuchs mit einer späteren Version; dafür braucht es den Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV). Bis dahin geht die eigene Abrechnung, wenn das Warmwasser getrennt oder gar nicht bereitet wird.',
```

In `guardHeatingPlant` die Zeilen `if (after.method === 'self') throw new HeatingError(400, LATER.self)` und
`if ((after.units ?? []).some((u) => u.heatedAreaM2 !== null)) throw new HeatingError(400, LATER.heatedArea)`
ersetzen durch:

```ts
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3, 8.1, 8.3, Abweichungen 10 und 17).
  if (after.method === 'self') {
    if (after.capture === null) throw new HeatingError(400, 'Bitte wählen Sie, womit der Verbrauch erfasst wird.')
    if (after.capture !== 'heatMeter') throw new HeatingError(400, LATER.capture)
    if (after.hotWater === 'combined' && !KWH_ENERGIES.includes(after.energy)) throw new HeatingError(400, LATER.dhwHeatingValue)
    if (after.areaBasisHeat === 'heatedArea' && (after.units === null || after.units.some((u) => u.heatedAreaM2 === null))) {
      throw new HeatingError(400, 'Für Grundkosten nach der beheizten Fläche nennen Sie die angeschlossenen Wohnungen und tragen bei jeder die beheizte Fläche ein.')
    }
  }
  if (after.heatPumpInstalledOn !== null && !ISO_DATE.test(after.heatPumpInstalledOn)) {
    throw new HeatingError(400, 'Das Einbaudatum der Wärmepumpe ist kein Datum. Bitte wählen Sie es im Kalender.')
  }
```

In `createHeatingPlant` vor dem Schreiben (hinter dem Verschmelzen des Rumpfs) und in
`updateHeatingPlant` hinter `const after = mergeHeatingPlant(current, body)`:

```ts
  // Zur eigenen Heizkostenabrechnung nur über die Einrichtung (Abweichung 17): Anteil, Zähler und
  // Umstellung der Positionen entstehen dort in einer Transaktion.
  if (after.method === 'self' && (before === null || before.method !== 'self')) throw new HeatingError(400, SELF_VIA_SETUP)
```

(in `createHeatingPlant` heißt `before` dort `null`; der Ausdruck lautet dann `if (after.method === 'self') throw new HeatingError(400, SELF_VIA_SETUP)`.)

In `updateHeatingPlant` direkt danach, vor dem Schreiben:

```ts
  // Zurück von der eigenen Abrechnung: Die Positionen offener Zeiträume brauchen einen anderen
  // Schlüssel. Ohne Bestätigung 409 mit der Liste und den Folgen (§ 12 Abs. 1, § 6 Abs. 4); mit
  // `convertItems: 'area'` werden sie in derselben Transaktion nach Wohnfläche verteilt (Abweichung 17).
  // (`hkvCutNotByConsumption` und `valueAt`, `LAW_AS_OF` in die Importe aus shared/law aufnehmen.)
  const zurueck = before.method === 'self' && after.method !== 'self'
  const offen = zurueck ? await selfItemsOf(db, after.id, null, 'heatingSystem') : []
  if (offen.length > 0 && raw(body, 'convertItems') !== 'area') {
    throw new SelfItemsError(
      `Diese Heizanlage hat ${offen.length === 1 ? 'eine Position' : `${offen.length} Positionen`} in offenen Zeiträumen, die nach der Heizkostenverordnung verteilt ${offen.length === 1 ? 'wird' : 'werden'}. Bestätigen Sie, dass sie künftig nach Wohnfläche verteilt ${offen.length === 1 ? 'wird' : 'werden'}; prüfen Sie danach die Schlüssel. ` +
        `Fällt die Anlage unter die Heizkostenverordnung, verteilen Sie damit nicht nach Verbrauch, und jeder Mieter darf seinen Anteil um ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen (§ 12 Abs. 1 Satz 1 HeizkostenV). ` +
        'Einen anderen Abrechnungsmaßstab dürfen Sie nur für künftige Abrechnungszeiträume und zu ihrem Beginn wählen, durch Erklärung gegenüber den Mietern (§ 6 Abs. 4 HeizkostenV).',
      offen,
    )
  }
```

und in derselben Transaktion, in der `updateHeatingPlant` die Anlage schreibt, hinter dem Schreiben der
Zeile:

```ts
    for (const c of offen) {
      await tx.update(costItems).set({ key: 'area', heatingTarget: null }).where(eq(costItems.id, c.id))
    }
```

(Benennt `updateHeatingPlant` das Gegenstück zu `current` anders als `before`, gilt dessen Name; schreibt
es ohne eigene Transaktion, kommt eine um das Schreiben der Anlage und diese Schleife.)

In `heatingPlantViolations` (PR 4) vor `return` ergänzen:

```ts
  // Heizung PR 10: Positionen nach Heizkostenverordnung gehören zu einer Anlage mit eigener Abrechnung.
  const eigene = new Set((await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.method, 'self'))).map((p) => p.id))
  for (const c of await db.select({ id: costItems.id, description: costItems.description, plantId: costItems.heatingPlantId }).from(costItems).where(eq(costItems.key, 'heatingSystem'))) {
    if (c.plantId === null || !eigene.has(c.plantId)) {
      problems.push(`Die Position „${c.description}“ wird nach der Heizkostenverordnung verteilt, ihre Heizanlage rechnet aber nicht selbst ab.`)
    }
  }
```

(`problems` ist die Liste, die `heatingPlantViolations` zurückgibt; heißt sie dort anders, gilt deren
Name.)

- [ ] **Step 7: Einrichtung, Anteil, Zwischenablesungen (`server/src/db/heatingSelf.ts`)**

```ts
// Die eigene Heizkostenabrechnung in der Datenbank (Heizung PR 10, Entwurf 5.3, 8.5, 11.2 Schritt 7).
//
// **Einrichtung** (`setUpSelf`): Eine Anlage wird nur hier zur eigenen Heizkostenabrechnung, in einer
// Transaktion mit dem Anteil nach Verbrauch der Heizperiode, an der der Vermieter arbeitet, den
// Zählern, die fehlen, und der Umstellung der Heizpositionen offener Zeiträume (Abweichung 17). Fehlt
// für eine dieser Positionen die Angabe von Teil und Ziel, entsteht nichts, und die Antwort nennt sie
// (409, Review Focus 3).
//
// **Anteil nach Verbrauch** (§ 6 Abs. 4, R-A7): Vorgabe ist der Anteil der Vorperiode. Eine Änderung
// gilt nur für eine Heizperiode, die noch nicht begonnen hat; der erste Anteil darf jederzeit gesetzt
// werden („Mit welchem Anteil haben Sie bisher abgerechnet?“). 50 bis 70 % (§ 7 Abs. 1, § 8 Abs. 1),
// bei Öl und Gas mit gedämmten Leitungen 70 % für die Heizung (§ 7 Abs. 1 Satz 2); mehr als 70 % nur
// mit Vereinbarung (§ 10), das kommt mit PR 14.
//
// **Fehlende Zwischenablesung** (Abweichung 8): die Antwort je Wohnung und Grenze.
import { and, eq, ne } from 'drizzle-orm'
import { hkvConsumptionShare, hkvConsumptionShareForced } from '../../../shared/law/heizkostenv.ts'
import { germanDate, valueAt } from '../../../shared/law/register.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import type {
  BillingPeriod, CostItem, CostKey, HeatingDistribution, HeatingEnergy, HeatingPart, HeatingPlant, InterimGap, InsulationRule, Meter,
} from '../../../shared/types.ts'
import { consumptionSharesOf, OIL_OR_GAS, POT_METER, targetProblem, type ShareRow } from '../heating.ts'
import type { Database, Executor } from './client.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readCostItems, readHeatingPlants, readMeters, readUnits } from './read.ts'
import { guardHeatingPlant, plantRow } from './heating.ts'
import { HeatingError, insertEntityIn, ISO_DATE, oneOfOrUndefined, patchCostItemIn, raw } from './repository.ts'
import { costItems, heatingPeriods, heatingPlants, INSULATION_RULES, INTERIM_GAP_STATUS, interimReadingGaps, units } from './schema.ts'

export const SELF_VIA_SETUP =
  'Die eigene Heizkostenabrechnung richten Sie in den Stammdaten unter „Heizung“ mit den Fragen der Einrichtung ein; dort entstehen Anteil, Zähler und die Umstellung der Positionen gemeinsam.'

export type SelfConvertItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents' | 'key'> & { heatingPart: HeatingPart | null }

// Ablehnung mit der Liste der Positionen, die umzustellen sind (409).
export class SelfItemsError extends Error {
  status = 409 as const
  items: SelfConvertItem[]
  constructor(message: string, items: SelfConvertItem[]) {
    super(message)
    this.items = items
  }
}

// Heizpositionen der Anlage in offenen Zeiträumen, mit einem anderen Schlüssel als `keyNot` bzw. genau
// dem Schlüssel `keyIs`. Offen heißt: weder der Zeitraum des Objekts noch die Heizperiode ist
// abgeschlossen; abgeschlossene bleiben, wie sie sind.
export async function selfItemsOf(db: Executor, plantId: string, keyNot: CostKey | null, keyIs: CostKey | null): Promise<SelfConvertItem[]> {
  const conds = [eq(costItems.heatingPlantId, plantId), eq(costItems.category, HEATING_CATEGORY)]
  if (keyNot !== null) conds.push(ne(costItems.key, keyNot))
  if (keyIs !== null) conds.push(eq(costItems.key, keyIs))
  const rows = await db.select({ id: costItems.id, period: costItems.period, description: costItems.description, amountCents: costItems.amountCents, key: costItems.key, heatingPart: costItems.heatingPart, propertyId: costItems.propertyId })
    .from(costItems).where(and(...conds)).orderBy(costItems.period, costItems.description)
  const ctx = await plantContext(db, plantId)
  const out: SelfConvertItem[] = []
  for (const r of rows) {
    const h = ctx ? heatingPeriodOf(ctx, String(r.period)) : null
    if (h && (await heatingPeriodClosed(db, ctx, h))) continue
    out.push({ id: r.id, period: r.period, description: r.description, amountCents: r.amountCents, key: r.key, heatingPart: r.heatingPart ?? null })
  }
  return out
}

// Der Anteil einer Heizperiode für die Seite Heizkosten.
export function distributionOf(rows: readonly ShareRow[], energy: HeatingEnergy, h: Pick<BillingPeriod, 'key' | 'from'>, today: string): HeatingDistribution {
  const own = rows.find((r) => r.period === h.key)
  const shares = consumptionSharesOf(rows, h.key, energy, () => valueAt(hkvConsumptionShareForced, h.from))
  const earlier = rows.some((r) => r.period < h.key && r.heatConsumptionPct !== null)
  return {
    own: { heating: own?.heatConsumptionPct ?? null, water: own?.waterConsumptionPct ?? null, insulationRule: own?.insulationRule ?? null },
    effective: shares ? { heating: shares.heating, water: shares.water, insulationRule: own?.insulationRule ?? null } : null,
    inherited: shares !== null && !shares.own,
    begun: today !== '' && today >= h.from,
    first: shares === null || (!earlier && !shares.own),
    forcedPercent: shares?.forced ? shares.heating : null,
  }
}

const pctOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Prüft einen neuen Anteil (Prozent) und gibt Heizung und Warmwasser zurück.
function checkShares(body: unknown, plant: HeatingPlant, h: BillingPeriod, rows: readonly ShareRow[], today: string): { heating: number; water: number | null; insulationRule: InsulationRule } {
  const heating = pctOf(raw(body, 'heatConsumptionPct'))
  // § 8 Abs. 1: eigene Wahl beim Warmwasser (Abweichung 14); ohne zentrales Warmwasser gibt es keinen.
  const withWater = plant.hotWater !== 'none'
  const water = withWater ? pctOf(raw(body, 'waterConsumptionPct')) : null
  if (withWater && water === null) {
    throw new HeatingError(400, 'Bitte geben Sie auch den Anteil nach Verbrauch beim Warmwasser an (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen.')
  }
  const insulationRule = oneOfOrUndefined(INSULATION_RULES, raw(body, 'insulationRule')) ?? 'unknown'
  const { min, max } = valueAt(hkvConsumptionShare, h.from)
  for (const v of withWater ? [heating, water] : [heating]) {
    if (v === null) throw new HeatingError(400, 'Bitte geben Sie an, welcher Anteil der Kosten nach Verbrauch verteilt wird.')
    if (v > max) throw new HeatingError(400, `Mehr als ${max} % nach Verbrauch gehen nur mit einer Vereinbarung (§ 10 HeizkostenV); das kommt mit einer späteren Version.`)
    if (v < min) throw new HeatingError(400, `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).`)
  }
  if (heating === null) throw new HeatingError(400, 'Bitte geben Sie den Anteil an.')
  if (insulationRule === 'applies' && OIL_OR_GAS.includes(plant.energy)) {
    const forced = valueAt(hkvConsumptionShareForced, h.from)
    if (heating !== forced) {
      throw new HeatingError(400, `Bei Öl- oder Gasheizung, Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen sind von den Heizkosten ${forced} % nach Verbrauch zu verteilen (§ 7 Abs. 1 Satz 2 HeizkostenV).`)
    }
  }
  // § 6 Abs. 4: nur für künftige Zeiträume; der erste Anteil darf jederzeit gesetzt werden.
  const before = consumptionSharesOf(rows, h.key, plant.energy, () => valueAt(hkvConsumptionShareForced, h.from))
  if (before !== null && today >= h.from && (before.heating !== heating || before.water !== water) && !(insulationRule === 'applies' && before.forced)) {
    throw new HeatingError(400,
      `Die Heizperiode hat am ${germanDate(h.from)} begonnen. Den Anteil nach Verbrauch ändern Sie nur für künftige Abrechnungszeiträume, durch Erklärung gegenüber den Mietern und mit Wirkung zum Beginn eines Zeitraums (§ 6 Abs. 4 HeizkostenV). Tragen Sie ihn bei der nächsten Heizperiode ein.`)
  }
  return { heating, water, insulationRule }
}

async function shareRows(db: Executor, plantId: string): Promise<ShareRow[]> {
  return (await db.select({ period: heatingPeriods.period, heatConsumptionPct: heatingPeriods.heatConsumptionPct, waterConsumptionPct: heatingPeriods.waterConsumptionPct, insulationRule: heatingPeriods.insulationRule })
    .from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))).map((r) => ({ ...r, period: String(r.period) }))
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveDistribution(db: Database, plantId: string, period: string, body: unknown, today: string): Promise<HeatingDistribution | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'self') throw new HeatingError(400, 'Den Anteil nach Verbrauch legen Sie nur bei einer eigenen Heizkostenabrechnung fest.')
  const h = heatingPeriodOf(ctx, period)
  if (await heatingPeriodClosed(db, ctx, h)) throw new HeatingError(409, closedText(h))
  const rows = await shareRows(db, plantId)
  const next = checkShares(body, ctx.plant, h, rows, today)
  await db.transaction(async (tx) => {
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({ heatConsumptionPct: next.heating, waterConsumptionPct: next.water, insulationRule: next.insulationRule }).where(eq(heatingPeriods.id, id))
  })
  return distributionOf(await shareRows(db, plantId), ctx.plant.energy, h, today)
}

type ItemAnswer = { id: string; heatingPart: HeatingPart; heatingTarget: CostItem['heatingTarget'] }
function readItemAnswers(value: unknown): ItemAnswer[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((x) => {
    const id = raw(x, 'id')
    const part = raw(x, 'heatingPart')
    const target = raw(x, 'heatingTarget')
    return typeof id === 'string' && (part === 'fuel' || part === 'operating' || part === 'metering') && (target === 'both' || target === 'heating' || target === 'water')
      ? [{ id, heatingPart: part, heatingTarget: target }]
      : []
  })
}

// `null`, wenn es die Anlage nicht gibt.
export async function setUpSelf(db: Database, plantId: string, body: unknown, today: string, newId: () => string): Promise<{ plant: HeatingPlant; created: Meter[]; converted: number } | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const current = ctx.plant
  const periodText = raw(body, 'period')
  const h = heatingPeriodOf(ctx, typeof periodText === 'string' ? periodText : '')
  if (await heatingPeriodClosed(db, ctx, h)) throw new HeatingError(409, closedText(h))
  const capture = raw(body, 'capture')
  const after: HeatingPlant = {
    ...current,
    method: 'self',
    hotWater: raw(body, 'hotWater') === 'separate' ? 'separate' : raw(body, 'hotWater') === 'none' ? 'none' : 'combined',
    capture: capture === 'heatMeter' || capture === 'hca' || capture === 'serviceValues' ? capture : null,
    areaBasisHeat: raw(body, 'areaBasisHeat') === 'heatedArea' ? 'heatedArea' : 'area',
  }
  await guardHeatingPlant(db, current, after)
  const rows = await shareRows(db, plantId)
  const shares = checkShares(body, after, h, rows, today)

  // Positionen offener Zeiträume mit anderem Schlüssel: jede braucht Teil und Ziel (Review Focus 3).
  const offen = await selfItemsOf(db, plantId, 'heatingSystem', null)
  const answers = readItemAnswers(raw(body, 'items'))
  const missing = offen.filter((c) => !answers.some((a) => a.id === c.id))
  if (missing.length > 0) {
    throw new SelfItemsError(
      `Für ${missing.length === 1 ? 'diese Heizposition' : `diese ${missing.length} Heizpositionen`} in offenen Zeiträumen braucht die eigene Abrechnung Teil und Ziel: ${missing.map((c) => `„${c.description}“`).join(', ')}.`,
      missing,
    )
  }
  for (const a of answers) {
    const problem = targetProblem(after.hotWater, a.heatingPart, a.heatingTarget ?? null)
    if (problem !== null) throw new HeatingError(400, `„${offen.find((c) => c.id === a.id)?.description ?? a.id}“: ${problem}.`)
  }
  const currentItems = await readCostItems(db)

  // Zähler, die fehlen: je angeschlossener Wohnung Wärme, bei Warmwasser auch Warmwasser; an der Anlage
  // der Wärmezähler am Speicher und der Gesamtwärmezähler, wenn gewünscht.
  const allUnits = (await readUnits(db)).filter((u) => u.propertyId === current.propertyId && servesUnit(after, u))
  const allMeters = await readMeters(db)
  const pots = after.hotWater === 'none' ? (['heating'] as const) : (['heating', 'water'] as const)
  const plans: Record<string, unknown>[] = []
  for (const u of allUnits) {
    for (const pot of pots) {
      const type = POT_METER[pot]
      if (allMeters.some((m) => m.unitId === u.id && m.type === type)) continue
      plans.push({ propertyId: current.propertyId, name: `${type === 'waerme' ? 'Wärme' : 'Warmwasser'} ${u.name}`, unitId: u.id, type, unit: type === 'waerme' ? 'kWh' : 'm³' })
    }
  }
  const plantMeter = (role: 'dhwHeat' | 'totalHeat', name: string) => {
    if (allMeters.some((m) => m.heatingPlantId === plantId && m.heatingRole === role)) return
    plans.push({ propertyId: current.propertyId, name, unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: plantId, heatingRole: role })
  }
  if (raw(body, 'dhwHeatMeter') === true && after.hotWater === 'combined') plantMeter('dhwHeat', 'Wärmezähler Warmwasserspeicher')
  if (raw(body, 'totalHeatMeter') === true) plantMeter('totalHeat', 'Gesamtwärmezähler')

  const createdIds: string[] = []
  await db.transaction(async (tx) => {
    await tx.update(heatingPlants).set(plantRow(after)).where(eq(heatingPlants.id, plantId))
    for (const a of answers) {
      const item = currentItems.find((c) => c.id === a.id)
      if (!item) continue
      await patchCostItemIn(tx, item, {
        key: 'heatingSystem', heatingPart: a.heatingPart, heatingTarget: a.heatingTarget,
        directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null, selfAmounts: null,
      })
    }
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({
      heatConsumptionPct: shares.heating, waterConsumptionPct: shares.water, insulationRule: shares.insulationRule,
      dhwMethod: after.hotWater === 'combined' ? 'heatMeter' : null,
    }).where(eq(heatingPeriods.id, id))
    for (const p of plans) {
      const meterId = newId()
      await insertEntityIn(tx, 'meters', meterId, p)
      createdIds.push(meterId)
    }
  })
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) throw new Error('Die Heizanlage ist nach der Einrichtung nicht auffindbar.')
  const created = (await readMeters(db)).filter((m) => createdIds.includes(m.id))
  return { plant, created, converted: answers.length }
}

// `null`, wenn es die Wohnung nicht gibt.
export async function saveInterimGap(db: Database, unitId: string, date: string, body: unknown): Promise<InterimGap | null> {
  if (!ISO_DATE.test(date)) throw new HeatingError(400, 'Das Datum der Grenze ist kein Datum.')
  const status = oneOfOrUndefined(INTERIM_GAP_STATUS, raw(body, 'status'))
  if (status === undefined) throw new HeatingError(400, 'Bitte wählen Sie, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.')
  const [unit] = await db.select({ id: units.id }).from(units).where(eq(units.id, unitId))
  if (!unit) return null
  const reasonRaw = raw(body, 'reason')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : ''
  await db.transaction(async (tx) => {
    await tx.delete(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
    await tx.insert(interimReadingGaps).values({ unitId, date, status, reason })
  })
  return { unitId, date, status, reason }
}

export async function removeInterimGap(db: Database, unitId: string, date: string): Promise<boolean> {
  const before = await db.select({ unitId: interimReadingGaps.unitId }).from(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
  if (before.length === 0) return false
  await db.delete(interimReadingGaps).where(and(eq(interimReadingGaps.unitId, unitId), eq(interimReadingGaps.date, date)))
  return true
}
```

- [ ] **Step 8: Ansicht je Heizperiode (`server/src/db/co2.ts`)**

`heatingPeriodViews` bekommt als letzten Parameter `today = ''`; im Objekt jeder Ansicht hinter den
Feldern von PR 6 bis PR 8:

```ts
      // Anteil nach Verbrauch (Heizung PR 10), nur bei eigener Abrechnung.
      distribution: ctx.plant.method === 'self'
        ? distributionOf(rows.map((r) => ({ period: String(r.period), heatConsumptionPct: r.heatConsumptionPct, waterConsumptionPct: r.waterConsumptionPct, insulationRule: r.insulationRule })), ctx.plant.energy, h, today)
        : null,
```

(`distributionOf` aus `'./heatingSelf.ts'` importieren; `rows` und `h` sind die Namen aus PR 6.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizkosten.test.ts test/db-heizanlage.test.ts test/db-repository.test.ts test/db-backup.test.ts test/db-co2.test.ts test/db-fuel.test.ts && npm run typecheck`
Expected: PASS (db-heizkosten.test.ts: 8 Tests). Tests aus PR 4, die `method: 'self'` mit „späteren
Version“ erwarten (`db-heizanlage.test.ts` „Sperren: was spätere Versionen rechnen …“), erwarten jetzt
den Satz `SELF_VIA_SETUP` (/Einrichtung/); die Sperre der beheizten Fläche entfällt aus diesem Test.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db server/test/db-heizkosten.test.ts server/test/db-heizanlage.test.ts
git commit -m "Heizkostenabrechnung: Einrichtung in einer Transaktion, Anteil nur vor Beginn änderbar, Schlüssel und Ziel geprüft

Offene Heizpositionen werden mit Teil und Ziel umgestellt oder genannt (409); Zähler entstehen,
wo sie fehlen. Antworten zu fehlenden Zwischenablesungen und Ablesedatum beim Mieterwechsel.

Refs #99"
```

---

### Task 6: Routen

Die Einrichtung, der Anteil einer Heizperiode und die Antworten zu fehlenden Zwischenablesungen
bekommen Routen; die Fehlerbehandlung gibt bei 409 die Liste der umzustellenden Positionen mit. Die
Ansicht je Heizperiode bekommt das heutige Datum, damit sie sagen kann, ob die Heizperiode begonnen
hat.

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 5; PR 4, PR 6): `setUpSelf`, `saveDistribution`, `saveInterimGap`, `removeInterimGap`, `SelfItemsError`, `heatingPeriodViews`; in index.ts `readData`, `writeData`, `bodyObject`, `newId`, `today`, die Fehlerbehandlung mit `HeatingError` (PR 4).
- Produces:
  - `PUT /api/heating-plants/:id/self` → 200 `{ plant: HeatingPlant; created: Meter[]; converted: number }`; 400; 404; 409 `{ error, items: SelfConvertItem[] }`
  - `PUT /api/heating-plants/:id/periods/:period/distribution` → 200 `HeatingDistribution`; 400; 404; 409
  - `PUT /api/units/:id/interim-gaps/:date` → 200 `InterimGap`; 400; 404
  - `DELETE /api/units/:id/interim-gaps/:date` → 200 `{ ok: true; removed: boolean }`
  - `PUT /api/heating-plants/:id` mit `convertItems: 'area'` (Task 5) → 409 `{ error, items }` ohne Bestätigung
  - `GET /api/heating-plants/:id/periods?period=` liefert `distribution`

- [ ] **Step 1: Write the failing test**

An `server/test/api.test.ts` anhängen (den Typimport aus `'../../shared/types.ts'` um `HeatingDistribution,
HeatingPeriodView, HeatingPlant, InterimGap, Meter` ergänzen, soweit nicht da):

```ts
test('Eigene Heizkostenabrechnung über die Routen: Einrichtung mit Liste, Anteil, Zwischenablesung (Heizung PR 10)', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const item = await s.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 600000, key: 'area' }) })
    // Über die allgemeine Route geht es nicht.
    const allgemein = await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'self', capture: 'heatMeter' })
    assert.equal(allgemein.status, 400)
    assert.match(await errorFrom(allgemein), /Einrichtung/)
    const setup = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
    const liste = await send('PUT', `/api/heating-plants/${plant.id}/self`, setup)
    assert.equal(liste.status, 409)
    const body409 = await jsonOf<{ error: string; items: { id: string }[] }>(liste)
    assert.deepEqual(body409.items.map((i) => i.id), [item.id])
    const ok = await send('PUT', `/api/heating-plants/${plant.id}/self`, { ...setup, items: [{ id: item.id, heatingPart: 'fuel', heatingTarget: 'both' }] })
    assert.equal(ok.status, 200)
    const result = await jsonOf<{ plant: HeatingPlant; created: Meter[]; converted: number }>(ok)
    assert.deepEqual([result.plant.method, result.converted, result.created.length], ['self', 1, 3])
    // Der Anteil: 2025 hat begonnen, ein anderer Wert ist gesperrt; derselbe geht.
    const anders = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/distribution`, { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'notApplies' })
    assert.equal(anders.status, 400)
    assert.match(await errorFrom(anders), /§ 6 Abs\. 4/)
    const gleich = await jsonOf<HeatingDistribution>(await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/distribution`, { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }))
    assert.equal(gleich.effective?.heating, 70)
    const [view] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.deepEqual([view?.distribution?.effective?.heating, view?.distribution?.begun], [70, true])
    // Zwischenablesung
    const gap = await jsonOf<InterimGap>(await send('PUT', `/api/units/${unit.id}/interim-gaps/2025-09-30`, { status: 'missed', reason: '' }))
    assert.equal(gap.status, 'missed')
    assert.equal((await send('PUT', `/api/units/${unit.id}/interim-gaps/2025-09-30`, { status: 'egal' })).status, 400)
    assert.equal((await send('PUT', '/api/units/gibt-es-nicht/interim-gaps/2025-09-30', { status: 'missed' })).status, 404)
    assert.deepEqual(await jsonOf<{ ok: boolean; removed: boolean }>(await send('DELETE', `/api/units/${unit.id}/interim-gaps/2025-09-30`)), { ok: true, removed: true })
    // Zurück auf freie Schlüssel: erst die Liste, dann mit Bestätigung.
    const zurueck = await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'manual' })
    assert.equal(zurueck.status, 409)
    assert.equal((await jsonOf<{ items: unknown[] }>(zurueck)).items.length, 1)
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'manual', convertItems: 'area' })).status, 200)
    assert.equal((await send('PUT', '/api/heating-plants/gibt-es-nicht/self', setup)).status, 404)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/api.test.ts --test-name-pattern "Heizung PR 10"`
Expected: FAIL; `PUT /api/heating-plants/:id/self` antwortet 404 (Route fehlt), die Zusicherung auf 409
schlägt fehl.

- [ ] **Step 3: Routen (`server/src/index.ts`)**

Importe: `removeInterimGap, saveDistribution, saveInterimGap, SelfItemsError, setUpSelf` aus
`'./db/heatingSelf.ts'`. Hinter den Routen der Heizperioden (PR 6 bis PR 8):

```ts
// ---------- Eigene Heizkostenabrechnung (Heizung PR 10) ----------

// Einrichtung Schritt 7 (Entwurf 11.2): Umstellung auf die eigene Abrechnung in einer Transaktion,
// samt Anteil, Zählern und Positionen (db/heatingSelf.ts). 409 mit der Liste offener Positionen, die
// Teil und Ziel brauchen.
app.put('/api/heating-plants/:id/self', async (req, res) => {
  const result = await writeData((db) => setUpSelf(db, req.params.id, bodyObject(req), today(), newId))
  if (!result) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})

// Anteil nach Verbrauch einer Heizperiode (§ 6 Abs. 4, § 7 Abs. 1 Satz 2).
app.put('/api/heating-plants/:id/periods/:period/distribution', async (req, res) => {
  const result = await writeData((db) => saveDistribution(db, req.params.id, req.params.period, bodyObject(req), today()))
  if (!result) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})

// Keine Zwischenablesung an einer Grenze: nicht möglich oder nicht durchgeführt (Entwurf 3.5).
app.put('/api/units/:id/interim-gaps/:date', async (req, res) => {
  const result = await writeData((db) => saveInterimGap(db, req.params.id, req.params.date, bodyObject(req)))
  if (!result) return res.status(404).json({ error: 'Diese Wohnung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})
app.delete('/api/units/:id/interim-gaps/:date', async (req, res) => {
  res.json({ ok: true, removed: await writeData((db) => removeInterimGap(db, req.params.id, req.params.date)) })
})
```

In der Route `GET /api/heating-plants/:id/periods` (PR 6) den Aufruf
`heatingPeriodViews(db, req.params.id, …)` um das vierte Argument `today()` ergänzen.

In der Fehlerbehandlung vor der Zeile mit `err instanceof RouteProblem || …`:

```ts
  // Eigene Heizkostenabrechnung (Heizung PR 10): die Liste der Positionen, die umzustellen sind.
  if (err instanceof SelfItemsError) return res.status(409).json({ error: err.message, items: err.items })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/test/api.test.ts
git commit -m "Heizkostenabrechnung: Routen für Einrichtung, Anteil und fehlende Zwischenablesungen

Refs #99"
```

---

### Task 7: Schnappschuss

Die Berechnung bekommt, was sie für die eigene Abrechnung braucht: Warmwasser, Erfassung,
Flächenbasis, Nutzerwechsel und Wärmepumpe an der Anlage, Anteil und gemessene Wärme an der
Heizperiode, das Ziel an der Position und die Antworten zu fehlenden Zwischenablesungen (Entwurf 5.8).
Alles optional, damit `legacy/read.ts` und bestehende Tests unverändert bleiben.

**Files:**
- Modify: `server/src/snapshot.ts`
- Test: `server/test/db-heizkosten.test.ts`

**Interfaces:**
- Consumes (Task 2, 5; PR 4–8): `HeatingPlant`, `HeatingPeriodData`, `CostItem`, `InterimGap`; `SnapshotHeatingPlant`, `SnapshotHeatingPeriodRow`, `SnapshotCostItem`, `SnapshotSource`, `snapshotFor`, `heatingSnapshotFor`; `Stock.interimGaps`.
- Produces:
  - `SnapshotHeatingPlant` + optional `changeSplit`, `hotWater`, `capture`, `areaBasisHeat`, `capturedOnOct2024`, `captureInstalledOn`, `heatPumpInstalledOn`
  - `SnapshotHeatingPeriodRow` + `heatConsumptionPct`, `waterConsumptionPct`, `insulationRule`, `dhwHeatKwh`, `totalHeatKwh` (optional)
  - `SnapshotCostItem` pickt zusätzlich `'heatingTarget'`
  - `Snapshot.interimGaps?: InterimGap[]`; `SnapshotSource.interimGaps?: InterimGap[]`; `snapshotFor` und `heatingSnapshotFor` füllen sie mit den Antworten zu Wohnungen des Objekts
  - `type SelfClosedEnd = { plantId: string; boundary: string; meterId: string; date: string; value: number }`, `Snapshot.selfClosedEnds?: SelfClosedEnd[]`, `selfClosedEndsOf(settlement: unknown): SelfClosedEnd[]` (Abweichung 9: eingefrorene Endstände abgeschlossener Heizperioden)
  - Ablesungen im Schnappschuss mit `interimFor` (Abweichung 23)

- [ ] **Step 1: Write the failing test**

An `server/test/db-heizkosten.test.ts` anhängen (Importe: `snapshotFor` aus `'../src/snapshot.ts'`,
`periodKey, periodOfKey, CALENDAR_RULES` aus `'../../shared/period.ts'`):

```ts
test('Schnappschuss: Anlage, Heizperiode, Ziel und Antworten zu Zwischenablesungen (Entwurf 5.8)', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = snapshotFor(await opened.read(readStock), 'objekt-1', p)
    const plant = s.heatingPlants?.find((x) => x.id === 'hp') ?? assert.fail('keine Anlage')
    assert.deepEqual([plant.method, plant.hotWater, plant.capture, plant.areaBasisHeat, plant.changeSplit], ['self', 'combined', 'heatMeter', 'area', 'degreeDays'])
    const row = s.heatingPeriodRows?.find((r) => r.plantId === 'hp' && r.period === '2025-01') ?? assert.fail('keine Zeile')
    assert.deepEqual([row.heatConsumptionPct, row.waterConsumptionPct, row.insulationRule, row.dhwMethod], [70, 70, 'notApplies', 'heatMeter'])
    assert.equal(s.costItems.find((c) => c.id === 'gas')?.heatingTarget, 'both')
    assert.deepEqual(s.interimGaps, [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }])
  })
})

test('Schnappschuss: der eingefrorene Endstand einer abgeschlossenen Heizperiode (Abweichung 9)', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const frozen = { heating: [{ plantId: 'hp', period: '2024-01', to: '2024-12-31', self: { units: [{ readings: [
      { meterId: 'wa', meterName: 'Wärme A', pot: 'heating', boundary: '2024-12-31', date: '2024-12-31', value: 1000 },
      { meterId: 'wa', meterName: 'Wärme A', pot: 'heating', boundary: '2023-12-31', date: '2023-12-31', value: 0 },
      { meterId: 'wb', meterName: 'Wärme B', pot: 'heating', boundary: '2024-12-31', date: null, value: null },
    ] }] } }] }
    await opened.write((db) => closeSettlement(db, { id: 's24', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: frozen }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = snapshotFor(await opened.read(readStock), 'objekt-1', p)
    assert.deepEqual(s.selfClosedEnds, [{ plantId: 'hp', boundary: '2024-12-31', meterId: 'wa', date: '2024-12-31', value: 1000 }])
    // Ein eingefrorener Stand ohne den Ausweis der eigenen Abrechnung ergibt nichts.
    assert.deepEqual(selfClosedEndsOf({ heating: [{ plantId: 'hp' }] }), [])
    assert.deepEqual(selfClosedEndsOf(null), [])
  })
})
```

(`closeSettlement` in den Import aus `'../src/db/repository.ts'`, `selfClosedEndsOf` in den aus
`'../src/snapshot.ts'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-heizkosten.test.ts`
Expected: FAIL; der Übersetzer kennt `hotWater` an `SnapshotHeatingPlant` nicht, zur Laufzeit ist
`s.interimGaps` `undefined`.

- [ ] **Step 3: Implementierung (`server/src/snapshot.ts`)**

`SnapshotHeatingPlant` (PR 4, erweitert von PR 5 bis PR 9) bekommt als weiteren Teil der Schnittmenge:

```ts
  // Eigene Heizkostenabrechnung (Heizung PR 10). Fehlt ein Feld, gilt die Vorgabe der Spalte
  // (`combined`, `area`, `degreeDays`); `capture` und die Angaben zur Wärmepumpe fehlen dann.
  & Partial<Pick<HeatingPlant, 'changeSplit' | 'hotWater' | 'capture' | 'areaBasisHeat' | 'capturedOnOct2024' | 'captureInstalledOn' | 'heatPumpInstalledOn'>>
```

`SnapshotHeatingPeriodRow` (PR 6, erweitert von PR 8) ebenso:

```ts
  // Anteil nach Verbrauch und gemessene Wärme (Heizung PR 10).
  & Partial<Pick<HeatingPeriodData, 'heatConsumptionPct' | 'waterConsumptionPct' | 'insulationRule' | 'dhwHeatKwh' | 'totalHeatKwh'>>
```

`SnapshotCostItem`: in die Liste der gepickten Felder `'heatingTarget'` aufnehmen.

`Snapshot` bekommt hinter den Feldern von PR 8:

```ts
  // Antworten zu fehlenden Zwischenablesungen (Heizung PR 10, Abweichung 8): Wohnungen des Objekts.
  interimGaps?: InterimGap[]
```

`SnapshotSource` bekommt `interimGaps?: InterimGap[]`. In `snapshotFor` im zurückgegebenen Objekt
hinter den Feldern der Heizung (PR 6 bis PR 8):

```ts
    // Nur, wenn es Antworten gibt: Ein Schnappschuss ohne sie bleibt Feld für Feld, wie er war (der
    // Gleichheitstest zwischen `snapshotFor` und `snapshotOf` aus PR 2 vergleicht ganze Objekte).
    ...(gaps.length > 0 ? { interimGaps: gaps } : {}),
```

mit der Zeile davor (vor dem `return`):

```ts
  const gaps = (source.interimGaps ?? []).filter((g) => units.some((u) => u.id === g.unitId))
```

(`units` ist dort die auf das Objekt eingegrenzte Liste der Wohnungen; heißt sie anders, gilt deren
Name.) Baut `heatingSnapshotFor` (PR 5) sein Ergebnis nicht aus `snapshotFor`, bekommt es dieselbe
Zeile. `snapshotFor` und `heatingSnapshotFor` reichen die Anlagen, die Zeilen der Heizperioden und die
Positionen als ganze Datensätze durch (PR 4, PR 6); die neuen Felder kommen damit von selbst. Wo eine
der beiden Funktionen Felder einzeln abbildet, kommen die neuen dort dazu.

Den Typimport aus `'../../shared/types.ts'` um `HeatingPeriodData, InterimGap` ergänzen, soweit nicht da.

Pickt der Schnappschuss Felder der Ablesung (`SnapshotReading`), kommt `'interimFor'` dazu; reicht er
die Datensätze durch, kommt das Feld von selbst (Abweichung 23).

Die eingefrorenen Endstände (Abweichung 9). Die abgeschlossene Abrechnung ist JSON aus einer älteren
Fassung und wird deshalb Feld für Feld geprüft, nie behauptet:

```ts
// Der eingefrorene Endstand einer abgeschlossenen Heizperiode mit eigener Abrechnung (Heizung PR 10,
// Abweichung 9): Er ist der Anfangsstand der folgenden, auch wenn die Ablesung seither geändert wurde,
// denn er steht in der zugestellten Abrechnung.
export type SelfClosedEnd = { plantId: string; boundary: string; meterId: string; date: string; value: number }

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function selfClosedEndsOf(settlement: unknown): SelfClosedEnd[] {
  return list(record(settlement)?.heating).flatMap((h) => {
    const st = record(h)
    const self = record(st?.self)
    const plantId = st?.plantId
    const end = st?.to
    if (!st || !self || typeof plantId !== 'string' || typeof end !== 'string') return []
    return list(self.units).flatMap((u) => list(record(u)?.readings).flatMap((r): SelfClosedEnd[] => {
      const x = record(r)
      return x && x.boundary === end && typeof x.meterId === 'string' && typeof x.date === 'string' && typeof x.value === 'number'
        ? [{ plantId, boundary: end, meterId: x.meterId, date: x.date, value: x.value }]
        : []
    }))
  })
}
```

`Snapshot` bekommt `selfClosedEnds?: SelfClosedEnd[]`; in `snapshotFor` vor dem `return`:

```ts
  const selfClosedEnds = source.closedSettlements.filter((c) => c.propertyId === propertyId).flatMap((c) => selfClosedEndsOf(c.settlement))
```

und im Objekt `...(selfClosedEnds.length > 0 ? { selfClosedEnds } : {}),` (wie `interimGaps`; heißen
`closedSettlements` oder `propertyId` in `snapshotFor` anders, gelten deren Namen).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizkosten.test.ts test/calc.test.ts test/settlement-golden.test.ts test/db-golden.test.ts && npm run typecheck`
Expected: PASS; ohne Antworten zu Zwischenablesungen ändert sich am Schnappschuss nichts.

- [ ] **Step 5: Commit**

```bash
git add server/src/snapshot.ts server/test/db-heizkosten.test.ts
git commit -m "Heizkostenabrechnung: Anlage, Heizperiode, Ziel und Zwischenablesungen im Schnappschuss

Refs #99"
```

---

### Task 8: Berechnung: Verteilung nach Heizkostenverordnung, Überträge, Vorrat, CO₂

`computeSettlement` baut je Anlage mit eigener Abrechnung den Plan (Task 3, 4), verteilt jede Position
mit dem Schlüssel `heatingSystem` über die Gewichte ihres Ziels (Entwurf 6.1 Nr. 4.3, 6.2, 8.6),
nimmt die Überträge der Lieferungen (PR 7) und des Vorrats (PR 8) mit denselben Gewichten mit (8.2:
„bei `self` mit den Gewichten des Ziels `both`“), teilt die CO₂-Kosten nach dem Anteil am Brennstoff
(9.4: x_t bei `self`) und verteilt eine Anlage, die nicht verteilbar ist, gar nicht (Abweichung 5).
Dazu die Nähte N1 bis N14.

**Files:**
- Modify: `server/src/fuel.ts`, `server/src/snapshot.ts`, `server/src/db/fuel.ts`, `server/src/db/fuelStock.ts`, `server/src/db/co2.ts`, `server/src/db/heating.ts`, `server/src/calc.ts`, `shared/heating.ts`, `shared/types.ts`
- Test: `server/test/calc-heizkosten.test.ts` (neu), `server/test/fuel.test.ts`

**Interfaces:**
- Consumes (Task 3–7; PR 5–9): `planSelf`, `weightsOf`, `hotWaterShareOf`, `consumptionSharesOf`, `heatPumpVerdict`, `targetProblem`, `sortReadings`, `boundaryReadingsOf`, `measuredBetween`, `SelfPlan`, `SelfProblem`, `SelfUserPlan`, `SelfWeights`, `Alpha`, `AlphaProblem`, `ConsumptionShares`, `HeatPumpVerdict`; `hkvConsumptionShare`, `hkvConsumptionShareForced`, `hkvHeatPumpCapture`, `hkvDegreeDays`, `practiceReadingOffWarning`; `plantRules`, `wayOf`, `servesUnit`, `previousPeriod`, `periodContaining`, `dayAfter`, `dayBefore`; in `computeSettlement` `fuelPlants`, `fuelResults`, `stockOfPlant`, `stockCarry`, `objectRules`, `period`, `label`, `lawLog`, `lawPeriod`, `tenancies`, `warn`, `itemSubject`, die Schleife über die Positionen, `type Target`, `landlordRecipients`; `problemText` (PR 8).
- Produces:
  - `FuelDeliveryInput` und `SnapshotFuelDelivery` mit `'energyKwh'`; `FuelDeliveryLine.energyKwh: number | null`; `FuelEstimateProposal.energyKwh: number | null`
  - calc.ts: `type SelfPlantPlan`, `selfPlans: Map<string, SelfPlantPlan>`, `selfSteps(sp, key, target)`, `selfBasisText(sp, key, target)`, `selfProblemText(p, areaBasisHeat)`, `alphaProblemText(problem)`; `Target.heating?: CalcStep[]`; Codes `heating.self-incomplete`, `heating.dhw-share-invalid`, `heating.heat-pump-dhw-basis`, `heating.target-invalid`, `fuel.stock-missing-self` (error)
  - shared/heating.ts: `heatingByConsumption('heatingSystem') === true`

- [ ] **Step 1: Write the failing tests**

`server/test/calc-heizkosten.test.ts`:

```ts
// Die eigene Heizkostenabrechnung in der Abrechnung (Heizung PR 10, Entwurf 6.1, 6.2, 8): Beispiel A
// über die Datenbank, Leerstand, Eigennutzung und Pauschale als Nutzer, eine nicht verteilbare Anlage,
// ein Ziel, das nicht passt, der Warmwasseranteil mit Lücke und bei der Wärmepumpe, der fehlende Vorrat,
// und der CO₂-Abzug nach dem Anteil am Brennstoff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { snapshotFor, type Snapshot } from '../src/snapshot.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-calc-heizkosten-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
let ids = 0
const newId = () => `m-${++ids}`

type Options = {
  energy?: string
  tenantsB?: boolean
  selfA?: boolean
  flatRateB?: boolean
  skip?: string[]
  delivery?: { from: string; to: string; energyKwh: number; link: boolean }
}
// Beispiel A (Entwurf 8.6) in der Datenbank: drei Wohnungen, Wechsel in C zum 30.09.2025 mit
// Zwischenablesung, Gas mit eigener Abrechnung, Wärme- und Warmwasserzähler, Wärmezähler am Speicher.
// `skip` nennt Ablesungen als `Zähler@Datum`, die fehlen sollen.
async function beispielA(opened: Opened, o: Options = {}): Promise<Snapshot> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: !(o.selfA && u === 'a'), selfUsed: o.selfA === true && u === 'a' })
    }
    if (!o.selfA) await createEntity(db, 'tenancies', 'A', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    if (o.tenantsB !== false) await createEntity(db, 'tenancies', 'B', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01', heatingModel: o.flatRateB ? 'flatRate' : 'settlement' })
    await createEntity(db, 'tenancies', 'C1', { unitId: 'c', tenantName: 'Mieter C1', persons: 1, start: '2020-01-01', end: '2025-09-30' })
    await createEntity(db, 'tenancies', 'C2', { unitId: 'c', tenantName: 'Mieter C2', persons: 1, start: '2025-10-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: o.energy ?? 'gas', method: 'manual' })
    await setUpSelf(db, 'hp', {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false,
    }, '2026-02-01', newId)
  })
  const meters = (await opened.read(readStock)).meters
  const meterOf = (unitId: string | null, type: string, role: string | null = null) =>
    meters.find((m) => m.unitId === unitId && m.type === type && (m.heatingRole ?? null) === role)?.id ?? assert.fail(`kein Zähler ${unitId} ${type}`)
  const readings: [string, string, string, number][] = [
    ['wa', meterOf('a', 'waerme'), '2024-12-31', 1000], ['wa', meterOf('a', 'waerme'), '2025-12-31', 13000],
    ['wb', meterOf('b', 'waerme'), '2024-12-31', 0], ['wb', meterOf('b', 'waerme'), '2025-12-31', 16000],
    ['wc', meterOf('c', 'waerme'), '2024-12-31', 500], ['wc', meterOf('c', 'waerme'), '2025-09-30', 7700], ['wc', meterOf('c', 'waerme'), '2025-12-31', 12500],
    ['xa', meterOf('a', 'warmwasser'), '2024-12-31', 10], ['xa', meterOf('a', 'warmwasser'), '2025-12-31', 40],
    ['xb', meterOf('b', 'warmwasser'), '2024-12-31', 0], ['xb', meterOf('b', 'warmwasser'), '2025-12-31', 40],
    ['xc', meterOf('c', 'warmwasser'), '2024-12-31', 5], ['xc', meterOf('c', 'warmwasser'), '2025-09-30', 43], ['xc', meterOf('c', 'warmwasser'), '2025-12-31', 55],
    ['ww', meterOf(null, 'waerme', 'dhwHeat'), '2024-12-31', 0], ['ww', meterOf(null, 'waerme', 'dhwHeat'), '2025-12-31', 9000],
  ]
  const d = o.delivery ?? { from: '2025-01-01', to: '2025-12-31', energyKwh: 60000, link: true }
  await opened.write(async (db) => {
    for (const [name, meterId, date, value] of readings) {
      if ((o.skip ?? []).includes(`${name}@${date}`)) continue
      await createEntity(db, 'readings', `${name}-${date}`, { meterId, date, value })
    }
    await createDelivery(db, 'd1', 'hp', {
      label: 'Erdgas', invoiceDate: '2026-01-15', invoiceFrom: d.from, invoiceTo: d.to, energyKwh: d.energyKwh, fixedCents: 0,
      emissionsKg: 10883.4, co2CostCents: 59859,
    })
    const item = (id: string, description: string, amountCents: number, heatingPart: string, heatingTarget: string, extra: Record<string, unknown> = {}) =>
      createEntity(db, 'costItems', id, {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
      })
    await item('gas', 'Erdgas', 600000, 'fuel', 'both', d.link ? { fuelDeliveryId: 'd1' } : {})
    await item('strom', 'Betriebsstrom', 18000, 'operating', 'both')
    await item('wartung', 'Wartung', 24000, 'operating', 'both')
    await item('imm', 'Immissionsmessung', 6000, 'operating', 'both')
    await item('wz', 'Miete Wärmezähler', 12000, 'metering', 'heating')
    await item('wwz', 'Miete Warmwasserzähler', 6000, 'metering', 'water')
  })
  const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  return snapshotFor(await opened.read(readStock), 'objekt-1', p)
}
const ITEMS = ['gas', 'strom', 'wartung', 'imm', 'wz', 'wwz']
const shareOf = (s: ComputedSettlement, tenancyId: string, itemId: string): number =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((r) => r.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const sumOf = (s: ComputedSettlement, tenancyId: string): number => ITEMS.reduce((a, id) => a + shareOf(s, tenancyId, id), 0)
const errors = (s: ComputedSettlement) => s.notices.filter((n) => n.level === 'error').map((n) => n.code)
const partsOf = (s: ComputedSettlement, itemId: string) => s.landlord.rows.find((r) => r.costItemId === itemId)?.landlordParts ?? []

test('Beispiel A über die Datenbank: je Position nach #202, zusammen 1.961,89 / 2.615,84 / 1.331,52 / 750,75 €', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    assert.deepEqual(errors(s), [])
    const table: Record<string, [number, number, number, number]> = {
      gas: [176850, 235800, 119644, 67706], strom: [5306, 7074, 3589, 2031], wartung: [7074, 9432, 4786, 2708],
      imm: [1769, 2358, 1196, 677], wz: [3600, 4800, 2203, 1397], wwz: [1590, 2120, 1734, 556],
    }
    for (const [id, cents] of Object.entries(table)) {
      assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => shareOf(s, t, id)), cents, id)
      assert.equal(s.landlord.rows.find((r) => r.costItemId === id), undefined, `${id}: nichts beim Vermieter`)
    }
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => sumOf(s, t)), [196189, 261584, 133152, 75075])
    // Der Rechenweg nennt Grund- und Verbrauchskosten, den Warmwasseranteil und den Anteil.
    const steps = s.statements.find((st) => st.tenancyId === 'C1')?.rows.find((r) => r.costItemId === 'gas')?.steps ?? []
    assert.ok(steps.some((x) => x.label === 'Grundkosten Heizung' && /640 von 1\.000 ‰ Gradtage/.test(x.value)), JSON.stringify(steps))
    assert.ok(steps.some((x) => x.label === 'Verbrauchskosten Heizung' && /7\.200 von 40\.000 kWh/.test(x.value)))
    assert.ok(steps.some((x) => x.label === 'Warmwasseranteil' && /^15 %/.test(x.value)))
  })
})

test('CO₂ bei eigener Abrechnung: Abzug nach dem Anteil am Brennstoff (9.4), R = 568,66 €', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    const relief = (t: string) => s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.kind === 'co2Relief')?.shareCents ?? 0
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map(relief), [-16761, -22348, -11340, -6417])
    assert.equal(s.heating?.[0]?.co2?.landlordPermille, 950)
  })
})

test('Leerstand ist Nutzer: der Anteil der leeren Wohnung B bleibt exakt als Leerstand beim Vermieter', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { tenantsB: false }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'vacancy', cents: 235800 }])
    assert.equal(shareOf(s, 'A', 'gas'), 176850, 'A trägt dasselbe wie mit vermieteter Wohnung B')
  })
})

test('Eigennutzung ist Nutzer: Eigenanteil exakt, und er zählt in den Eigenanteil der Abrechnung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { selfA: true }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'selfUse', cents: 176850 }])
    assert.ok(Math.abs(s.selfUsedShareCents - 196188) <= ITEMS.length, `Eigenanteil ${s.selfUsedShareCents}`)
  })
})

test('Pauschale: der Anteil nach der Verordnung fällt dem Vermieter zu, als Pauschale', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { flatRateB: true }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'flatRate', cents: 235800 }])
  })
})

test('Review Focus 4: fehlt ein Stand am Ende der Heizperiode, wird die Anlage nicht verteilt, mit einem Fehler', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { skip: ['wc@2025-12-31'] }))
    assert.deepEqual(errors(s), ['heating.self-incomplete'])
    assert.match(s.notices.find((n) => n.code === 'heating.self-incomplete')?.text ?? '', /Wärme C.*31\.12\.2025.*§ 9a/s)
    for (const id of ITEMS) {
      const row = s.landlord.rows.find((r) => r.costItemId === id) ?? assert.fail(id)
      assert.deepEqual(row.landlordParts, [{ reason: 'noBasis', cents: row.totalCents }], id)
    }
  })
})

test('Ein Ziel, das nicht zur Warmwasserbereitung passt, wird nicht verteilt', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, costItems: snap.costItems.map((c) => (c.id === 'gas' ? { ...c, heatingTarget: 'heating' } : c)) })
    assert.ok(errors(s).includes('heating.target-invalid'))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
    assert.equal(shareOf(s, 'A', 'strom'), 5306, 'die übrigen Positionen bleiben')
  })
})

test('Review Focus 5: deckt die Gasrechnung die Heizperiode nicht ab, ist der Warmwasseranteil nicht bestimmbar', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { delivery: { from: '2025-03-15', to: '2025-12-31', energyKwh: 50000, link: true } }))
    assert.ok(errors(s).includes('heating.dhw-share-invalid'))
    assert.match(s.notices.find((n) => n.code === 'heating.dhw-share-invalid')?.text ?? '', /Folgerechnung.*Schätzung/s)
  })
})

test('A8: Wärmepumpe mit Wärmezähler am Warmwasser, aber ohne Gesamtwärmezähler: keine Verteilung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { energy: 'heatPump' }))
    assert.ok(errors(s).includes('heating.heat-pump-dhw-basis'))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
  })
})
```

In `server/test/fuel.test.ts` an den Tests aus PR 7, die einen Schätzvorschlag mit `assert.deepEqual`
ganz vergleichen (der Fall „Lücke“ mit `{ from: '2025-03-15', to: '2025-04-30', amountCents: 90774, …,
byMeter: false }`), in die Erwartung `energyKwh: null` aufnehmen (die Vorlage dort hat keine kWh), und
anhängen:

```ts
test('Heizung PR 10: der Schätzvorschlag trägt die kWh im Verhältnis des verbrauchsabhängigen Teils, die Bewertung je Lieferung die kWh in der Heizperiode', () => {
  const mitKwh = plantFuel(input({ h: H1, deliveries: [{ ...VORJAHR, energyKwh: 30000 }], items: [] }))
  const gap = mitKwh?.gaps[0]?.estimate
  if (gap) assert.equal(typeof gap.energyKwh, 'number')
  const line = plantFuel(input({ deliveries: [{ ...GAS, energyKwh: 60000 }] }))?.lines[0] ?? assert.fail('keine Zeile')
  assert.ok(line.energyKwh !== null && Math.abs(line.energyKwh - 60000 * (line.sharePermille / 1000)) < 1e-6)
})
```

(`input`, `H1`, `VORJAHR`, `GAS` sind die Namen der Datei aus PR 7; heißen sie anders, gelten deren Namen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-heizkosten.test.ts test/fuel.test.ts`
Expected: FAIL. `createDelivery` lehnt die Lieferung an einer Anlage mit eigener Abrechnung ab
(`LATER.self`), und `computeSettlement` kennt den Schlüssel `heatingSystem` nicht (alle Positionen ohne
Zeile bei den Mietern).

- [ ] **Step 3: Nähte N1 bis N9 (Lieferungen, Vorrat, Prüfungen)**

**N1** `server/src/fuel.ts`, in `plantFuel`:

```ts
  // Überträge und Schätzvorschläge gibt es, wo die Rechnungen Positionen sind: bei freien Schlüsseln
  // und bei der eigenen Heizkostenabrechnung (Heizung PR 10, Entwurf 8.2).
  const withItems = input.method === 'manual' || input.method === 'self'
```

Dazu `FuelDeliveryInput` um `'energyKwh'` erweitern (in die Liste des `Pick` aufnehmen) und im Objekt,
das `lines.push({ … })` schreibt, hinter `co2Cents: …`:

```ts
      // Energie dieser Lieferung in der Heizperiode, wie abgerechnet (Heizung PR 10, Warmwasseranteil).
      energyKwh: d.energyKwh === null ? null : d.energyKwh * s.kgShare,
```

Im Schätzvorschlag (Lücken, `estimate = { … }`) hinter `co2CostCents: …`:

```ts
        energyKwh: t.energyKwh === null ? null : Math.round(t.energyKwh * factor),
```

`shared/types.ts`: `FuelDeliveryLine` bekommt `energyKwh: number | null`, `FuelEstimateProposal`
bekommt `energyKwh: number | null`. `server/src/snapshot.ts`: `SnapshotFuelDelivery` pickt zusätzlich
`'energyKwh'`.

**N2–N4** `server/src/db/fuel.ts`: die Zeilen nach der Tabelle „Nähte zu PR 7 und PR 8“ ersetzen bzw.
streichen. In `createEstimates` (PR 7 Task 9) im Objekt der geschätzten Lieferung hinter
`co2CostCents: e.co2CostCents,`:

```ts
        energyKwh: e.energyKwh,
```

**N5** `server/src/db/fuel.ts`, `guardFuelDelivery` (PR 8): die Zeile mit „Den Vorrat bei der eigenen
Heizkostenabrechnung …“ streichen.

**N6** `server/src/db/heating.ts`, **N7** `server/src/db/co2.ts`, **N8** und **N9**
`server/src/db/fuelStock.ts`: nach der Tabelle.

- [ ] **Step 4: Verbrauch nach Heizkostenverordnung zählt als Verbrauch (`shared/heating.ts`)**

```ts
// Gilt eine Position als nach Verbrauch verteilt? Nach Zählern (`meter`), als Einzelbeträge aus
// der fertigen Abrechnung eines Messdienstes (`amounts`), laut Gemeinschaftsabrechnung (`external`)
// oder nach der eigenen Heizkostenabrechnung (`heatingSystem`, Heizung PR 10), deren Grund- und
// Verbrauchsanteil die Verordnung selbst festlegt.
export function heatingByConsumption(key: CostKey): boolean {
  return key === 'meter' || key === 'amounts' || key === 'external' || key === 'heatingSystem'
}
```

In `heatingFindings` die Zeile
`if (metered.length === 0 || other.length === 0 || own.some((c) => c.key === 'amounts' || c.key === 'external')) continue`
ersetzen durch:

```ts
    if (metered.length === 0 || other.length === 0 || own.some((c) => c.key === 'amounts' || c.key === 'external' || c.key === 'heatingSystem')) continue
```

- [ ] **Step 5: Codes und Importe (`server/src/calc.ts`)**

Importe ergänzen:

```ts
import {
  boundaryReadingsOf, consumptionSharesOf, heatPumpVerdict, hotWaterShareOf, measuredBetween, planSelf, sortReadings, targetProblem, weightsOf,
  type Alpha, type AlphaProblem, type ConsumptionShares, type HeatPumpVerdict, type SelfPlan, type SelfProblem, type SelfUserPlan, type SelfWeights,
} from './heating.ts'
```

`hkvConsumptionShareForced, hkvHeatPumpCapture` in den Import aus `'../../shared/law/heizkostenv.ts'`,
`practiceReadingOffWarning` in den aus `'../../shared/law/practice.ts'`, `dayAfter` (neben `dayBefore`)
in den aus `'../../shared/law/register.ts'`, `periodContaining, previousPeriod` in den aus
`'../../shared/period.ts'`, `HeatingTarget, HotWater, MeterType, SelfPot` in den Typimport aus
`'../../shared/types.ts'` aufnehmen, soweit nicht da.

In `noticeKinds` hinter den Codes von PR 9:

```ts
  // Heizung PR 10 (#99): eigene Heizkostenabrechnung (Entwurf 8, 10.1; Abweichungen 4 bis 6). Ein
  // Fehler heißt hier: Die Anlage wird nicht verteilt, ihre Positionen stehen beim Vermieter.
  'heating.self-incomplete': { level: 'error', title: 'Heizkostenabrechnung unvollständig', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatMeter'] },
  'heating.dhw-share-invalid': { level: 'error', title: 'Warmwasseranteil nicht bestimmbar', rule: 'heating-dhw-split', terms: ['hotWaterShare'] },
  'heating.heat-pump-dhw-basis': { level: 'error', title: 'Wärmepumpe ohne Gesamtwärmezähler', rule: 'heating-dhw-split', terms: ['hotWaterShare', 'heatMeter'] },
  'heating.target-invalid': { level: 'error', title: 'Ziel der Heizposition passt nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'hotWaterShare'] },
  'fuel.stock-missing-self': { level: 'error', title: 'Vorrat fehlt bei der eigenen Heizkostenabrechnung', rule: 'heating-consumed-fuel', terms: ['fuelStock', 'heatingSystem'] },
```

`type Target` bekommt ein Feld:

```ts
// `heating`: bei der eigenen Heizkostenabrechnung (Heizung PR 10) die Schritte über Grund- und
// Verbrauchskosten, Warmwasseranteil und Anteil, statt der Verteilbasis.
type Target = { t: TenancyWithUnit, raw: number, basisText: string, community?: CommunitySteps, heating?: CalcStep[] }
```

- [ ] **Step 6: Nähte N10 bis N14 (`server/src/calc.ts`)**

**N10** in der Bestandsrechnung (PR 8 Task 6) `needCost: plant.method === 'manual',` ersetzen durch
`needCost: plant.method !== 'service',`.

**N11** und **N12** nach der Tabelle.

**N13** im CO₂-Block die Zeile
`(pot.method === 'manual' && (st === null || st.method === 'self') && fuelOf.lines.length > 0) ||`
ersetzen durch:

```ts
      // Bei freien Schlüsseln und bei der eigenen Heizkostenabrechnung teilt Mietfuchs selbst auf
      // (Heizung PR 10, Entwurf 9.4: x_t aus den Positionen mit `heating_part = 'fuel'`).
      (pot.method !== 'service' && (st === null || st.method === 'self') && fuelOf.lines.length > 0) ||
```

Hat PR 8 die Entscheidung für Vorratsenergien vor diese Zeile gesetzt
(`const ownSplit = isStockEnergy(pot.energy) ? stockFigures !== null : ownSplitByDeliveries`), gilt sie
bei `self` ebenso; `stockFigures` ist dort bei `self` mit fehlendem oder ungültigem Bestand `null`,
also wird nicht aufgeteilt, und den Fehler meldet die eigene Abrechnung (`fuel.stock-missing-self`).
In der Bedingung von PR 8, unter der `fuelFromDeliveries` als Ersatz dient
(`: pot.method === 'manual' ? fuelFromDeliveries(…) : null`), bleibt `'manual'`: Bei der eigenen
Abrechnung gibt es ohne Bestand keine Verteilung.

**N14** Die Schleife der Übertragsposten des Vorrats (PR 8 Task 7 Step 3) bekommt diese Gestalt (nur die
markierten Zeilen ändern sich; der Rest bleibt, wie PR 8 ihn schreibt):

```ts
  for (const [plantId, entry] of stockOfPlant) {
    if (entry.plant.method === 'service') continue                                  // N14
    const ownSettlement = entry.plant.method === 'self'                              // Heizung PR 10
    const isFuel = (c: SnapshotCostItem): boolean =>
      c.category === HEATING_CATEGORY && c.heatingPlantId === plantId && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null) &&
      (ownSettlement ? c.key === 'heatingSystem' : FUEL_KEYS.includes(c.key))         // Heizung PR 10
    const mine = items.filter((c) => c.category === HEATING_CATEGORY && c.heatingPlantId === plantId)
    if (!entry.result.ok) {
      // Bei der eigenen Abrechnung meldet der Plan den Fehler (`fuel.stock-missing-self`).
      if (!ownSettlement && (stockTouched(entry.chain) || mine.length > 0)) {        // Heizung PR 10
        stockManualNotes.push({ plant: entry.plant, text: problemText(entry.result.problem), invalid: entry.result.problem.kind === 'invalid' })
      }
      continue
    }
    const largest = items.filter(isFuel).reduce<SnapshotCostItem | null>((a, c) => (a === null || c.amountCents > a.amountCents ? c : a), null)
    const template = largest ?? (snapshot.previousCostItems ?? []).filter(isFuel).at(-1) ?? null
    if (!template) {
      if (ownSettlement) stockWithoutTemplate.add(plantId)                            // Heizung PR 10
      else stockManualNotes.push({ plant: entry.plant, text: 'Für den Verbrauch aus dem Vorrat gibt es keinen Schlüssel: In dieser Heizperiode und der vorigen steht keine Brennstoffposition dieser Heizanlage.', invalid: false })
      continue
    }
```

mit der Zeile `const stockWithoutTemplate = new Set<string>()` vor der Schleife. Die Übertragsposten
kopieren die Vorlage samt `key: 'heatingSystem'`, `heatingPart: 'fuel'` und ihrem Ziel; bei
verbundener Warmwasserbereitung ist das Ziel des Brennstoffs immer „Heizung und Warmwasser“ (Task 5,
`targetProblem`), ohne Warmwasser „Heizung“. Damit werden sie mit den Gewichten des Ziels verteilt
(Entwurf 8.2).

- [ ] **Step 7: Der Plan je Anlage (`server/src/calc.ts`)**

Direkt hinter der Schleife der Übertragsposten des Vorrats (PR 8) und vor der Zeile
`const co2Pots = co2PotsOf(…)`:

```ts
  // ---------- Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 6.1 Nr. 4.3, 8) ----------
  // Je Anlage mit `method = 'self'`, deren Heizperiode der Zeitraum dieser Berechnung ist (dieselben
  // Anlagen wie bei den Lieferungen, `fuelPlants`), der Plan: Nutzer, Ablesungen, Gruppen und Bruchteile
  // (heating.ts), Anteil nach Verbrauch, Warmwasseranteil und das Urteil zur Wärmepumpe. Daraus die
  // Gewichte, mit denen jede Position mit `heatingSystem` und jeder Übertrag der Anlage verteilt wird.
  // Was die Anlage nicht verteilbar macht, steht in `blocked`; dann gehen ihre Positionen an den
  // Vermieter (`noBasis`), und je Grund nennt ein Fehler, was zu tun ist (Abweichung 5).
  type SelfBlock = { code: 'heating.self-incomplete' | 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis' | 'fuel.stock-missing-self' | 'fuel.stock-invalid'; text: string }
  type SelfPlantPlan = {
    plant: SnapshotHeatingPlant
    plan: SelfPlan
    shares: ConsumptionShares | null
    alpha: Alpha | null
    weights: Map<string, SelfWeights> | null
    blocked: SelfBlock[]
    verdict: HeatPumpVerdict | null
    hotWater: HotWater
    changeSplit: 'degreeDays' | 'time'
    hDays: number
    hDegree: number
    userByKey: Map<string, SelfUserPlan>
  }
  const POT_NAME: Record<SelfPot, string> = { heating: 'Heizung', water: 'Warmwasser' }
  const POT_UNIT: Record<SelfPot, string> = { heating: 'kWh', water: 'm³' }
  const selfProblemText = (p: SelfProblem, areaBasisHeat: string): string => {
    if (p.kind === 'farInterim') {
      return `Beim Wechsel in ${p.unitName} zum ${fmtDay(p.boundary)} wurde erst am ${fmtDay(p.readingDate)} abgelesen, ${p.days} Tage daneben und über einen Wintermonat. Lässt die Ablesung wegen des Zeitpunkts keine hinreichend genaue Ermittlung zu, wird nach Gradtagen bzw. Tagen geteilt (§ 9b Abs. 3 HeizkostenV). Ob das so ist, entscheiden Sie: Wählen Sie auf der Seite Heizkosten „Ablesung verwenden“ oder „Nach § 9b Abs. 3“.`
    }
    if (p.kind === 'noArea') {
      return `Für den Topf ${POT_NAME[p.pot]} ist keine Fläche hinterlegt, und die Grundkosten lassen sich nicht verteilen. Tragen Sie die Wohnfläche${p.pot === 'heating' && areaBasisHeat === 'heatedArea' ? ' bzw. die beheizte Fläche' : ''} der Wohnungen ein.`
    }
    const meter = p.meterName ? `„${p.meterName}“ (${p.unitName})` : p.unitName
    if (p.reason === 'noMeter') return `${p.unitName} hat keinen ${p.pot === 'heating' ? 'Wärmezähler' : 'Warmwasserzähler'}, die übrigen Wohnungen schon. Legen Sie den Zähler an und tragen Sie die Stände ein.`
    if (p.reason === 'noReading') return `Für ${meter} fehlt ein Stand zum ${fmtDay(p.boundary ?? yTo)}. Tragen Sie die Ablesung ein; liegt sie einige Tage daneben, gilt sie, wie sie ist.`
    if (p.reason === 'replacement') return `Beim Zähler ${meter} fehlt zu einem Zählerwechsel der Endstand des alten Geräts. Tragen Sie ihn nach.`
    if (p.reason === 'sameDay') return `Für ${meter} stehen am ${fmtDay(p.boundary ?? yTo)} zwei verschiedene Stände. Welcher stimmt, wissen nur Sie; löschen oder berichtigen Sie den falschen auf der Seite Zähler.`
    return `Der Zähler ${meter} zeigt bis zum ${fmtDay(p.boundary ?? yTo)} weniger als vorher. Prüfen Sie die Stände oder markieren Sie einen Zählerwechsel.`
  }
  const ALPHA_TEXT: Record<AlphaProblem, string> = {
    formulaLater: 'Den Warmwasseranteil nach einer Formel rechnet Mietfuchs mit einer späteren Version; die Verordnung verlangt ohnehin einen Wärmezähler (§ 9 Abs. 2 HeizkostenV). Tragen Sie die Stände des Wärmezählers am Warmwasserspeicher ein.',
    noDhwHeat: 'Für den Warmwasseranteil fehlt die gemessene Wärme des Warmwassers. Tragen Sie die Stände des Wärmezählers am Warmwasserspeicher zu Beginn und Ende der Heizperiode ein.',
    noFuelEnergy: 'Für den Warmwasseranteil fehlt die Energie des Brennstoffs in kWh. Tragen Sie die Rechnungen Ihres Versorgers als Lieferungen mit den kWh laut Rechnung ein.',
    fuelGap: 'Die Rechnungen des Versorgers decken die Heizperiode nicht ganz ab, und der Warmwasseranteil braucht den Verbrauch der ganzen Heizperiode. Tragen Sie die Folgerechnung ein oder schließen Sie die Abrechnung mit einer Schätzung der fehlenden Rechnung ab.',
    heatingValueLater: 'Den Warmwasseranteil bei Heizöl, Flüssiggas, Pellets, Holz und Kohle rechnet Mietfuchs mit einer späteren Version; dafür braucht es den Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV).',
    outOfRange: 'Die gemessene Wärme des Warmwassers ist null oder nicht kleiner als die Energie des Brennstoffs; das passt nicht zusammen. Prüfen Sie die Stände des Wärmezählers am Speicher und die kWh der Rechnungen.',
    heatPumpBasis: 'Bei einer Wärmepumpe wird der Warmwasseranteil gegen die gemessene Gesamtwärme gerechnet; gegen den Strom ergäbe sich etwa das Dreifache (§ 9 Abs. 1 Satz 2 HeizkostenV: nach dem Anteil am Wärmeverbrauch). Legen Sie einen Gesamtwärmezähler an (Rolle „Gesamtwärme“) oder tragen Sie die Gesamtwärme der Heizperiode auf der Seite Heizkosten ein.',
  }
  const selfPlans = new Map<string, SelfPlantPlan>()
  for (const plant of fuelPlants.filter((p) => p.method === 'self')) {
    const rules = plantRules(wayOf(plant), objectRules)
    const prev = previousPeriod(rules, period)
    const next = periodContaining(rules, dayAfter(period.to))
    const hotWater: HotWater = plant.hotWater ?? 'combined'
    const potTypes: MeterType[] = hotWater === 'none' ? ['waerme'] : ['waerme', 'warmwasser']
    const unitMeters = snapshot.meters.flatMap((m) => (m.unitId !== null && (m.heatingPlantId ?? null) === null && potTypes.includes(m.type) ? [{ ...m, unitId: m.unitId }] : []))
    const served = snapshot.units.filter((u) => servesUnit(plant, u) && ((u.areaM2 || 0) > 0 || unitMeters.some((m) => m.unitId === u.id)))
    const servedIds = new Set(served.map((u) => u.id))
    const table = law(hkvDegreeDays, { period: lawPeriod }, lawLog)
    const neighbors = { before: dayBefore(prev.from), after: next.to }
    // Abweichung 9: die Wechselgrenzen der Nachbarperioden und der eingefrorene Endstand der vorigen.
    const selfUnits: SelfUnit[] = served.map((u) => ({
      id: u.id, name: u.name, areaM2: u.areaM2 || 0,
      heatedAreaM2: plant.units?.find((x) => x.unitId === u.id)?.heatedAreaM2 ?? null,
      role: u.participates ? 'rented' : u.selfUsed ? 'self' : 'outside',
    }))
    const selfTenancies: SelfTenancy[] = snapshot.tenancies.filter((t) => servedIds.has(t.unitId)).map((t) => ({ id: t.id, unitId: t.unitId, tenantName: t.tenantName, start: t.start, end: t.end }))
    const changesIn = (unit: SelfUnit, hh: { from: string; to: string }): string[] => usersOf(unit, selfTenancies, hh).slice(0, -1).map((u) => u.to)
    const outerChanges = new Map(selfUnits.map((u) => [u.id, [...changesIn(u, prev), ...changesIn(u, next)]]))
    const opening = new Map((snapshot.selfClosedEnds ?? [])
      .filter((e) => e.plantId === plant.id && e.boundary === dayBefore(period.from))
      .map((e): [string, SelfReading] => [e.meterId, { meterId: e.meterId, date: e.date, value: e.value }]))
    const plan = planSelf({
      h: { from: period.from, to: period.to },
      neighbors,
      outerChanges,
      opening,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hotWater,
      areaBasisHeat: plant.areaBasisHeat ?? 'area',
      units: selfUnits,
      tenancies: selfTenancies,
      meters: unitMeters.filter((m) => servedIds.has(m.unitId)).map((m) => ({ id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type })),
      readings: snapshot.readings.map((r) => ({ ...r, boundFor: r.interimFor ?? null })),
      gaps: snapshot.interimGaps ?? [],
      table,
      offRule: () => law(practiceReadingOffWarning, { period: lawPeriod }, lawLog),
    })
    const rows = (snapshot.heatingPeriodRows ?? []).filter((r) => r.plantId === plant.id)
    const shares = consumptionSharesOf(
      rows.map((r) => ({ period: String(r.period), heatConsumptionPct: r.heatConsumptionPct ?? null, waterConsumptionPct: r.waterConsumptionPct ?? null, insulationRule: r.insulationRule ?? null })),
      period.key, plant.energy, () => law(hkvConsumptionShareForced, { period: lawPeriod }, lawLog),
    )
    const own = rows.find((r) => r.period === period.key)
    // Gemessene Wärme am Zähler der Anlage mit dieser Rolle über die Heizperiode (Abweichung 12).
    const plantMeterKwh = (role: 'dhwHeat' | 'totalHeat'): number | null => {
      const ms = snapshot.meters.filter((m) => m.heatingPlantId === plant.id && m.heatingRole === role)
      if (ms.length === 0) return null
      let sum = 0
      for (const m of ms) {
        const sorted = sortReadings(snapshot.readings.filter((r) => r.meterId === m.id))
        const at = boundaryReadingsOf(sorted, [dayBefore(period.from), period.to], [neighbors.before, dayBefore(period.from), period.to, neighbors.after])
        const a = at.get(dayBefore(period.from)) ?? null
        const b = at.get(period.to) ?? null
        if (a === null || b === null) return null
        const v = measuredBetween(sorted, a, b)
        if ('problem' in v) return null
        sum += v.value
      }
      return sum
    }
    const fuelOfPlant = fuelResults.get(plant.id)?.result
    const fuelKwh = fuelOfPlant && fuelOfPlant.lines.length > 0 && fuelOfPlant.lines.every((l) => l.energyKwh !== null)
      ? fuelOfPlant.lines.reduce((a, l) => a + (l.energyKwh ?? 0), 0)
      : null
    const alphaResult = hotWaterShareOf({
      hotWater, dhwMethod: own?.dhwMethod ?? null, energy: plant.energy,
      dhwHeatKwh: own?.dhwHeatKwh ?? plantMeterKwh('dhwHeat'),
      totalHeatKwh: own?.totalHeatKwh ?? plantMeterKwh('totalHeat'),
      fuelKwh, fuelCoveragePermille: fuelOfPlant?.coveragePermille ?? null,
      // Die Schätzung beim Abschluss (PR 7) trägt bei der Lieferung `estimated` (Abweichung 11).
      fuelEstimated: fuelOfPlant?.lines.some((l) => l.estimated) ?? false,
    })
    const verdict = plant.energy === 'heatPump'
      ? heatPumpVerdict(
        { energy: plant.energy, capturedOnOct2024: plant.capturedOnOct2024 ?? null, captureInstalledOn: plant.captureInstalledOn ?? null, heatPumpInstalledOn: plant.heatPumpInstalledOn ?? null },
        period.from, law(hkvHeatPumpCapture, { date: period.from }, lawLog),
      )
      : null
    const blocked: SelfBlock[] = []
    for (const p of plan.problems) blocked.push({ code: 'heating.self-incomplete', text: `${selfProblemText(p, plant.areaBasisHeat ?? 'area')}${p.kind === 'missing' && p.reason !== 'sameDay' ? ' Lässt sich ein Wert nicht mehr ablesen, ist er zu schätzen (§ 9a HeizkostenV); das rechnet Mietfuchs mit einer späteren Version.' : ''}` })
    if (shares === null) {
      blocked.push({ code: 'heating.self-incomplete', text: 'Für diese Heizperiode ist kein Anteil nach Verbrauch festgelegt. Tragen Sie auf der Seite Heizkosten ein, mit welchem Anteil Sie bisher abgerechnet haben.' })
    } else {
      const { min, max } = law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
      // § 8 Abs. 1: beim Warmwasser eine eigene Wahl, nie still die der Heizung (Abweichung 14).
      if (hotWater !== 'none' && shares.water === null) {
        blocked.push({ code: 'heating.self-incomplete', text: 'Für das Warmwasser ist kein Anteil nach Verbrauch festgelegt (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen. Tragen Sie ihn auf der Seite Heizkosten ein.' })
      }
      if ([shares.heating, ...(hotWater !== 'none' && shares.water !== null ? [shares.water] : [])].some((v) => v < min || v > max)) {
        blocked.push({ code: 'heating.self-incomplete', text: `Der Anteil nach Verbrauch liegt außerhalb von ${hkvConsumptionShare.describe({ min, max })}. Korrigieren Sie ihn auf der Seite Heizkosten.` })
      }
    }
    if (!alphaResult.ok) blocked.push({ code: alphaResult.problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', text: ALPHA_TEXT[alphaResult.problem] })
    const stocked = stockOfPlant.get(plant.id)
    if (stocked && !stocked.result.ok) {
      const kind = stocked.result.problem.kind
      blocked.push({
        code: kind === 'missing' ? 'fuel.stock-missing-self' : 'fuel.stock-invalid',
        text: `${problemText(stocked.result.problem)} Umzulegen sind die Kosten des verbrauchten Brennstoffs (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR 156/11); ohne Bestandsrechnung verteilt Mietfuchs die Anlage nicht. Tragen Sie Anfangs- und Endbestand auf der Seite Heizkosten in der Karte „Vorrat“ ein.`,
      })
    }
    if (stockWithoutTemplate.has(plant.id)) {
      blocked.push({ code: 'heating.self-incomplete', text: 'Für den Verbrauch aus dem Vorrat fehlt eine Brennstoffposition dieser Heizanlage, in dieser Heizperiode und in der vorigen. Erfassen Sie die Brennstoffrechnung als Position nach Heizkostenverordnung.' })
    }
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    for (const b of blocked) warn(b.code, `${where}: ${b.text} Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.`, { kind: 'heatingCosts', id: plant.id })
    const weights = blocked.length === 0 && shares !== null && alphaResult.ok
      ? weightsOf(plan, { heating: shares.heating, water: shares.water ?? 0 }, alphaResult.alpha?.value ?? null)
      : null
    selfPlans.set(plant.id, {
      plant, plan, shares, alpha: alphaResult.ok ? alphaResult.alpha : null, weights, blocked, verdict, hotWater,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hDays: periodDays(period),
      hDegree: degreeDayPermille([{ from: period.from, to: period.to }], table),
      userByKey: new Map(plan.units.flatMap((u) => u.users.map((x): [string, SelfUserPlan] => [x.key, x]))),
    })
  }
  // Der Rechenweg einer Zeile nach Heizkostenverordnung (#114): Grund- und Verbrauchskosten je Topf,
  // Anteil nach Verbrauch, Warmwasseranteil und der Anteil des Nutzers, aus denselben Zahlen.
  const selfSteps = (sp: SelfPlantPlan, key: string, target: HeatingTarget): CalcStep[] => {
    const u = sp.userByKey.get(key)
    const unit = u ? sp.plan.units.find((x) => x.unit.id === u.unitId) : undefined
    if (!u || !unit || !sp.shares || !sp.weights) return []
    const pots: SelfPot[] = target === 'both' ? ['heating', 'water'] : [target]
    const steps: CalcStep[] = []
    for (const p of pots) {
      const total = sp.plan.totals[p]
      const area = p === 'heating' ? unit.heatArea : unit.unit.areaM2
      const byDegree = p === 'heating' && sp.changeSplit === 'degreeDays'
      const part = u.days < sp.hDays
        ? byDegree ? ` · ${fmtNum(Math.round(u.degreeDayPermille * 10) / 10)} von ${fmtNum(Math.round(sp.hDegree * 10) / 10)} ‰ Gradtage` : ` · ${u.days}/${sp.hDays} Tage`
        : ''
      steps.push({ label: `Grundkosten ${POT_NAME[p]}`, value: `${fmtNum(area)} von ${fmtNum(total.area)} m²${part}`, term: 'baseCosts' })
      const v = u.pots[p].value
      steps.push(total.measured && v !== null
        ? {
          label: `Verbrauchskosten ${POT_NAME[p]}`,
          value: `${fmtNum(Math.round(v * 1000) / 1000)} von ${fmtNum(Math.round(total.consumption * 1000) / 1000)} ${POT_UNIT[p]}${u.pots[p].group ? ' (ohne Zwischenablesung nach § 9b Abs. 3 HeizkostenV geteilt)' : ''}`,
          term: 'consumptionCosts',
        }
        : { label: `Verbrauchskosten ${POT_NAME[p]}`, value: 'kein Verbrauch erfasst, nur nach Fläche verteilt', term: 'consumptionCosts' })
      steps.push({ label: `Anteil nach Verbrauch ${POT_NAME[p]}`, value: `${fmtNum(total.measured ? sp.shares[p] : 0)} %`, term: 'consumptionCosts' })
    }
    if (target === 'both' && sp.alpha) steps.push({ label: 'Warmwasseranteil', value: `${fmtPercent(sp.alpha.value * 100)} % (gemessen)`, term: 'hotWaterShare' })
    steps.push({ label: 'Ihr Anteil nach Heizkostenverordnung', value: `${fmtPercent((sp.weights.get(key)?.[target] ?? 0) * 100)} %`, term: 'heatingSystem' })
    return steps
  }
  const TARGET_TEXT: Record<HeatingTarget, string> = { both: 'Heizung und Warmwasser', heating: 'Heizung', water: 'Warmwasser' }
  const selfBasisText = (sp: SelfPlantPlan, key: string, target: HeatingTarget): string =>
    `nach Heizkostenverordnung, ${TARGET_TEXT[target]} ${fmtPercent((sp.weights?.get(key)?.[target] ?? 0) * 100)} %`
```

(`periodDays` aus `'../../shared/period.ts'`, `degreeDayPermille` aus `'../../shared/degreeDays.ts'`
importieren, soweit nicht da; `SnapshotHeatingPlant` steht im Typimport aus `'./snapshot.ts'` seit
PR 6.)

- [ ] **Step 8: Die Verteilung je Position (`server/src/calc.ts`)**

In der Schleife über die Positionen vor dem Zweig `} else if (item.key === 'direct') {`:

```ts
    } else if (item.key === 'heatingSystem') {
      // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 6.2, 8.6): je Nutzer der Rohwert Betrag ×
      // Gewicht des Ziels. Mieter sind Ziele (bei Pauschale oder Inklusivmiete nicht zugebucht, wie
      // überall), die Eigennutzung ist der Eigenanteil (exakt, nie über `take()`), eine Wohnung
      // außerhalb ein eigener Grund; der Leerstand bleibt als Rest (`vacancy`).
      const sp = item.heatingPlantId ? selfPlans.get(item.heatingPlantId) : undefined
      const target = item.heatingTarget ?? null
      const problem = sp ? targetProblem(sp.hotWater, item.heatingPart ?? null, target) : null
      if (!sp) {
        forced = 'noBasis'
        warn('heating.target-invalid',
          `„${item.description}“: Die Position wird nach der Heizkostenverordnung verteilt, gehört aber in ${label} zu keiner Heizanlage mit eigener Heizkostenabrechnung — Betrag geht an den Vermieter. Wählen Sie im Kostenformular die Heizanlage oder einen anderen Schlüssel.`,
          itemSubject(item))
      } else if (problem !== null || target === null) {
        forced = 'noBasis'
        warn('heating.target-invalid', `„${item.description}“: ${problem ?? 'Das Ziel fehlt'} — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (sp.weights === null) {
        // Die Anlage ist nicht verteilbar; der Fehler steht einmal je Anlage (Plan oben).
        forced = 'noBasis'
      } else {
        for (const u of sp.plan.units.flatMap((x) => x.users)) {
          const raw = item.amountCents * (sp.weights.get(u.key)?.[target] ?? 0)
          if (u.role === 'tenancy') {
            const t = tenancies.find((x) => x.id === u.tenancyId)
            if (t) targets.push({ t, raw, basisText: selfBasisText(sp, u.key, target), heating: selfSteps(sp, u.key, target) })
            else outsideRaw += raw
          } else if (u.role === 'self') {
            selfRaw += raw
          } else if (u.role === 'outside') {
            outsideRaw += raw
          }
        }
      }
```

Im Rechenweg der Zeile (`const steps: CalcStep[] = [ … ]` und die Zweige danach) vor dem letzten
`} else {` (dem Zweig mit „Anteil an der Verteilbasis“):

```ts
      } else if (x.heating) {
        // Eigene Heizkostenabrechnung (Heizung PR 10): der Weg über Grund- und Verbrauchskosten.
        steps.push(...x.heating)
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-heizkosten.test.ts test/fuel.test.ts test/calc-fuel.test.ts test/calc-vorrat.test.ts test/calc-co2.test.ts test/calc-anlagen.test.ts test/calc.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (calc-heizkosten.test.ts: 9 Tests). Golden F01–F15 unverändert: Ohne Anlage mit
eigener Abrechnung entsteht kein Plan, und `heatingByConsumption` ändert nur das Ergebnis für den
neuen Schlüssel.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS. Tests aus PR 7 und PR 8, die eine Sperre von `self` erwarten (Lieferung an einer
Anlage mit eigener Abrechnung, Vorrat bei `self`), erwarten jetzt Erfolg; sie werden an dieser Stelle
auf die neue Zusage umgestellt (die Lieferung entsteht, der Vorrat wird gespeichert). Jede andere rote
Stelle ist ein Befund.

```bash
git add server/src shared server/test
git commit -m "Heizkostenabrechnung: Verteilung nach Heizkostenverordnung über exakte Gewichte, Überträge, Vorrat und CO₂

Jede Position mit heatingSystem wird einmal verteilt (Beispiel A centgenau); Leerstand, Eigennutzung,
Pauschale und Wohnungen außerhalb sind Nutzer. Eine nicht verteilbare Anlage steht mit einem Fehler
beim Vermieter. Lieferungen und Vorrat wie bei freien Schlüsseln, CO₂ nach dem Brennstoffanteil.

Refs #99"
```

---

### Task 9: Berechnung: Hinweise, Ausweis, „nur Heizung“ bei freien Schlüsseln

Die Hinweise der eigenen Abrechnung (Entwurf 10.1, Zeilen „PR 10“; Abweichungen 2, 3, 7, 15, 19), der
Ausweis je Anlage und Heizperiode (`Settlement.heating[].self`, Entwurf 8.8 ohne § 6a) und die
Gradtage bei freien Schlüsseln für Positionen „nur Heizung“ (Entwurf 5.3 `change_split`, A2, B7,
R4/B5). Die Kürzungsbeträge rechnen auf den gedruckten Zeilen nach der Abzugszeile (6.5), deshalb nach
dem CO₂-Block.

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-heizkosten.test.ts`

**Interfaces:**
- Consumes (Task 3–8; PR 6–8): `selfPlans`, `SelfPlantPlan`, `planSelf`, `weightsOf`, `SelfInput`, `POT_NAME`; im CO₂-Block `co2Pots`, `report`, `cutsOn`, `heatingStatements`; `hkvCutNotByConsumption`, `hkvConsumptionShare`, `hkvHeatPumpCapture`, `hkvDegreeDays`; `statements`, `warn`, `andList`, `fmtCents`, `fmtNum`, `fmtDay`, `toUTC`, `MS_DAY`, `plants`, `targets`, `booked`, der Block `heating.flat-rate`.
- Produces:
  - Codes `heating.interim-reading-off`, `heating.no-interim-reading`, `heating.reading-dates-differ`, `heating.key-change`, `heating.change-split-time`, `heating.change-fee`, `heating.heat-pump-capture`, `heating.dhw-share-estimated` (hint), `heating.interim-reading-far`, `heating.no-interim-reading-missed`, `heating.reading-dates-far`, `heating.no-consumption` (warning)
  - `SelfPlantPlan.input: SelfInput`; `potCostOf(sp, items, pot): number`; `selfStatementOf(sp, items): SelfHeatingStatement`; `HeatingStatement.self` gefüllt

- [ ] **Step 1: Write the failing tests**

An `server/test/calc-heizkosten.test.ts` anhängen (Importe: `saveInterimGap` in den Import aus
`'../src/db/heatingSelf.ts'`, `updateHeatingPlant` in den aus `'../src/db/heating.ts'`):

```ts
// ---------- Hinweise und Ausweis (Heizung PR 10, Entwurf 3.5, 8.5, 8.8, 10.1) ----------

const textOf = (s: ComputedSettlement, code: string): string => s.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${s.notices.map((n) => n.code).join(', ')}`)
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)

test('Ausweis: Töpfe mit Preisen je Einheit, Warmwasseranteil, Nutzer mit Gradtagen, Grenzen der Ablesung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    const self = s.heating?.[0]?.self ?? assert.fail('kein Ausweis')
    assert.equal(self.ok, true)
    assert.deepEqual(self.alpha && [Math.round(self.alpha.percent * 1000) / 1000, self.alpha.dhwHeatKwh, self.alpha.referenceKwh, self.alpha.reference], [15, 9000, 60000, 'fuel'])
    const heating = self.pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
    assert.deepEqual([heating.costCents, heating.consumptionPct, heating.areaM2, heating.consumption, heating.consumptionUnit], [562800, 70, 200, 40000, 'kWh'])
    assert.ok(Math.abs(heating.baseCentsPerM2 - 844.2) < 1e-9 && Math.abs((heating.consumptionCentsPerUnit ?? 0) - 9.849) < 1e-9)
    const water = self.pots.find((p) => p.pot === 'water') ?? assert.fail('Topf Warmwasser')
    assert.deepEqual([water.costCents, water.consumption, water.consumptionUnit], [103200, 120, 'm³'])
    const c = self.units.find((u) => u.unitId === 'c') ?? assert.fail('Wohnung C')
    assert.deepEqual(c.users.map((u) => [u.tenancyId, u.heatingConsumption, u.waterConsumption, u.heatingCents, u.waterCents]), [
      ['C1', 7200, 38, 103330, 29823], ['C2', 4800, 12, 59099, 15252],
    ])
    assert.deepEqual(c.boundaries.map((b) => [b.date, b.kind, b.status]), [['2024-12-31', 'start', 'read'], ['2025-09-30', 'change', 'read'], ['2025-12-31', 'end', 'read']])
  })
})

test('Z-B2: Wechsel ohne Zwischenablesung, „nicht durchgeführt“: § 9b Abs. 3 und bis zu 15 % auf die Heizkosten nach Abzug', async () => {
  await withDatabase(async (opened) => {
    await beispielA(opened, { skip: ['wc@2025-09-30', 'xc@2025-09-30'] })
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'missed', reason: '' }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    // Exakt 1.375,17666 € und 707,10334 € (heating.test.ts, Task 3); je Position nach #202 gerundet.
    assert.ok(Math.abs(sumOf(s, 'C1') - 137517.666) < 2 && Math.abs(sumOf(s, 'C2') - 70710.334) < 2, `${sumOf(s, 'C1')} / ${sumOf(s, 'C2')}`)
    const text = textOf(s, 'heating.no-interim-reading-missed')
    assert.match(text, /§ 9b Abs\. 1/)
    assert.match(text, /Bis zu 15 % der Heizkosten von Mieter C1 \(C\) 188,70 € und Mieter C2 \(C\) 97,00 €/)
    assert.match(text, /11 S 202\/87.*104a C 226\/05/s)
    assert.ok(!codes(s).includes('heating.no-interim-reading'))
  })
})

test('Zwischenablesung nicht möglich: ein Hinweis ohne Betrag; ohne Antwort die Warnung mit der Bitte um Antwort', async () => {
  await withDatabase(async (opened) => {
    await beispielA(opened, { skip: ['wc@2025-09-30', 'xc@2025-09-30'] })
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const ohne = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.match(textOf(ohne, 'heating.no-interim-reading-missed'), /bitte geben Sie auf der Seite Heizkosten an/)
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    const mit = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.match(textOf(mit, 'heating.no-interim-reading'), /nicht möglich: Wohnung nicht zugänglich.*§ 9b Abs\. 3/s)
    assert.ok(!codes(mit).includes('heating.no-interim-reading-missed'))
  })
})

test('Z-B3 und Z-B1: Ablesung neben Wechsel und Stichtag gilt, wie sie ist, mit Tagen und Gradtagsanteil', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const verschoben = snap.readings.map((r) => {
      if (r.date === '2025-09-30') return { ...r, date: '2025-10-03' }
      if (r.date === '2024-12-31' && snap.meters.find((m) => m.id === r.meterId)?.unitId === 'b') return { ...r, date: '2025-01-05' }
      return r
    })
    const s = computeSettlement({ ...snap, readings: verschoben })
    assert.match(textOf(s, 'heating.interim-reading-off'), /C zum 30\.09\.2025 wurde am 03\.10\.2025 abgelesen \(3 Tage daneben, 7,7 ‰ der Gradtage\).*Vormieter/s)
    assert.match(textOf(s, 'heating.reading-dates-differ'), /31\.12\.2024.*B mit 5 Tagen.*27,4 ‰/s)
    assert.ok(!codes(s).includes('heating.reading-dates-far'))
  })
})

test('Kein Verbrauch erfasst: nur nach Fläche, 15 % auf den Anteil am unerfassten Topf nach CO₂-Abzug (Abweichung 15)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, meters: snap.meters.filter((m) => !(m.type === 'waerme' && m.unitId !== null)) })
    const text = textOf(s, 'heating.no-consumption')
    assert.match(text, /Für Heizung ist kein Verbrauch erfasst/)
    // 15 % auf den Topf Heizung nach CO₂-Abzug: A 1.688,40 € − 145,01 €, B 2.251,20 € − 193,34 €,
    // C1 1.080,58 € − 92,81 €, C2 607,82 € − 52,20 € (Abzüge 167,61 / 223,48 / 117,46 / 60,11 € nach dem
    // Anteil am Brennstoff im Topf Heizung; Herleitung im Kommentar der Abweichung 15).
    assert.match(text, /um 15 % kürzen \(§ 12 Abs\. 1 Satz 1 HeizkostenV\), hier vom Topf Heizung nach CO₂-Abzug laut Ausweis: Mieter A \(A\) 231,51 €, Mieter B \(B\) 308,68 €, Mieter C1 \(C\) 148,17 € und Mieter C2 \(C\) 83,34 €/)
  })
})

test('R-A7: ein anderer Anteil als in der Vorperiode ist ein Wechsel nach § 6 Abs. 4 (Hinweis)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const vorher = { ...(snap.heatingPeriodRows?.[0] ?? assert.fail('keine Zeile')), period: periodKey('2024-01'), heatConsumptionPct: 50, waterConsumptionPct: 50 }
    const s = computeSettlement({ ...snap, heatingPeriodRows: [...(snap.heatingPeriodRows ?? []), vorher] })
    assert.match(textOf(s, 'heating.key-change'), /50 % bei der Heizung.*jetzt 70 %.*§ 6 Abs\. 4 HeizkostenV/s)
  })
})

test('Pauschale: die Warnung nennt den Betrag nach der Heizkostenverordnung (Entwurf 6.3)', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { flatRateB: true }))
    assert.match(textOf(s, 'heating.flat-rate'), /Nach der Heizkostenverordnung entfielen auf Mieter B \(B\) 2\.615,84 €/)
  })
})

test('Wärmepumpe, deren Erfassung erst im Zeitraum eingebaut wurde: Hinweis, keine Kürzung (§ 12 Abs. 3 Satz 2)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const plants = (snap.heatingPlants ?? []).map((p) => ({ ...p, energy: 'heatPump' as const, hotWater: 'none' as const, capturedOnOct2024: false, captureInstalledOn: '2025-06-01' }))
    const items = snap.costItems.map((c) => (c.heatingTarget === 'both' || c.heatingTarget === 'water' ? { ...c, heatingTarget: 'heating' as const } : c))
    const s = computeSettlement({ ...snap, heatingPlants: plants, costItems: items, meters: snap.meters.filter((m) => !(m.type === 'waerme' && m.unitId !== null)) })
    assert.match(textOf(s, 'heating.heat-pump-capture'), /01\.10\.2024.*§ 12 Abs\. 3 HeizkostenV.*nach dem 01\.06\.2025 beginnt/s)
    assert.ok(!codes(s).includes('heating.no-consumption'), 'keine Kürzung, solange die Verordnung nicht gilt')
  })
})

test('Abweichung 11: beruht der Warmwasseranteil auf der Schätzung beim Abschluss, sagt ein Hinweis das', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const fuel = snap.fuel ?? assert.fail('keine Lieferungen im Schnappschuss')
    const s = computeSettlement({ ...snap, fuel: { ...fuel, deliveries: fuel.deliveries.map((d) => ({ ...d, estimated: true })) } })
    assert.match(textOf(s, 'heating.dhw-share-estimated'), /15 %.*geschätzten Energie.*Folgerechnung/s)
    assert.ok(!codes(computeSettlement(snap)).includes('heating.dhw-share-estimated'))
  })
})

test('Zeitanteilig statt nach Gradtagen: Hinweis mit beiden Beträgen (C1 1.386,21 € gegen 1.331,53 €)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const plants = (snap.heatingPlants ?? []).map((p) => ({ ...p, changeSplit: 'time' as const }))
    const s = computeSettlement({ ...snap, heatingPlants: plants })
    assert.match(textOf(s, 'heating.change-split-time'), /Mieter C1 \(C\): zeitanteilig 1\.386,21 €, nach Gradtagen 1\.331,53 €/)
  })
})

test('Kosten der Zwischenablesung an einer Heizposition: Hinweis auf BGH VIII ZR 19/07', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, costItems: snap.costItems.map((c) => (c.id === 'imm' ? { ...c, description: 'Zwischenablesung Mieterwechsel' } : c)) })
    assert.match(textOf(s, 'heating.change-fee'), /VIII ZR 19\/07.*nicht entschieden.*AG Berlin-Hohenschönhausen/s)
  })
})

test('R4/B5: freie Schlüssel, Position „nur Heizung“: Mieter April bis Oktober trägt 270 ‰, die kombinierte Position 214/365', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'W1', areaM2: 50, participates: true })
      await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'W2', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'T1', { unitId: 'u1', tenantName: 'Sommer', persons: 1, start: '2025-04-01', end: '2025-10-31' })
      await createEntity(db, 'tenancies', 'T2', { unitId: 'u2', tenantName: 'Ganzjahr', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      for (const [id, target] of [['nur', 'heating'], ['beides', null]] as const) {
        await createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', heatingTarget: target })
      }
    })
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.equal(shareOf(s, 'T1', 'nur'), 13500, '100.000 ct × 50 % × 270 ‰')
    assert.equal(shareOf(s, 'T1', 'beides'), 29315, '100.000 ct × 50 % × 214/365, wie vor dem Anlegen der Anlage (A2)')
    assert.deepEqual(partsOf(s, 'nur'), [{ reason: 'vacancy', cents: 36500 }])
    // Zeitanteilig eingestellt: dann auch „nur Heizung“ nach Tagen, und der Hinweis nennt beide Beträge.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { changeSplit: 'time' }))
    const t = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.equal(shareOf(t, 'T1', 'nur'), 29315)
    assert.match(textOf(t, 'heating.change-split-time'), /Sommer \(W1\): zeitanteilig 293,15 €, nach Gradtagen 135,00 €/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-heizkosten.test.ts`
Expected: FAIL; `s.heating[0].self` ist `undefined`, die Codes fehlen, und R4/B5 ergibt für „nur“ 29315.

- [ ] **Step 3: Codes (`server/src/calc.ts`)**

In `noticeKinds` hinter den Codes aus Task 8:

```ts
  // Ablesungen und Nutzerwechsel (Entwurf 3.5, 15.2 F2, F3); eine Stufe je Code (Abweichungen 2, 3).
  'heating.interim-reading-off': { level: 'hint', title: 'Zwischenablesung neben dem Wechsel', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.interim-reading-far': { level: 'warning', title: 'Zwischenablesung weit neben dem Wechsel', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.no-interim-reading': { level: 'hint', title: 'Zwischenablesung nicht möglich', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.no-interim-reading-missed': { level: 'warning', title: 'Zwischenablesung nicht durchgeführt', rule: 'heating-tenant-change', terms: ['interimReading'] },
  'heating.reading-dates-differ': { level: 'hint', title: 'Ablesung neben dem Stichtag', rule: 'heating-reading-date', terms: ['heatMeter', 'degreeDays'] },
  'heating.reading-dates-far': { level: 'warning', title: 'Ablesung weit neben dem Stichtag', rule: 'heating-reading-date', terms: ['heatMeter', 'degreeDays'] },
  'heating.no-consumption': { level: 'warning', title: 'Kein Verbrauch erfasst', rule: 'heating-consumption', terms: ['consumptionCosts', 'heatMeter'] },
  'heating.key-change': { level: 'hint', title: 'Anteil nach Verbrauch geändert', rule: 'heating-key-change', terms: ['consumptionCosts', 'keyChange'] },
  'heating.change-split-time': { level: 'hint', title: 'Mieterwechsel zeitanteilig statt nach Gradtagen', rule: 'heating-tenant-change', terms: ['interimReading', 'degreeDays'] },
  'heating.change-fee': { level: 'hint', title: 'Kosten der Zwischenablesung', rule: 'heating-tenant-change', terms: ['interimReading'] },
  'heating.heat-pump-capture': { level: 'hint', title: 'Wärmepumpe: Heizkostenverordnung gilt noch nicht', rule: 'heating-own-settlement', terms: ['heatingSystem', 'heatMeter'] },
  // Warmwasseranteil auf der Schätzung beim Abschluss (Abweichung 11).
  'heating.dhw-share-estimated': { level: 'hint', title: 'Warmwasseranteil aus geschätzter Energie', rule: 'heating-own-settlement', terms: ['hotWaterShare'] },
```

- [ ] **Step 4: Der Plan merkt sich seine Eingabe (`server/src/calc.ts`)**

In `type SelfPlantPlan` (Task 8) als Feld `input: SelfInput` ergänzen (`type SelfInput` in den Import aus
`'./heating.ts'`). Im Block des Plans den Aufruf `const plan = planSelf({ … })` umstellen auf

```ts
    const input: SelfInput = {
      h: { from: period.from, to: period.to },
      neighbors,
      outerChanges,
      opening,
      changeSplit: plant.changeSplit ?? 'degreeDays',
      hotWater,
      areaBasisHeat: plant.areaBasisHeat ?? 'area',
      units: selfUnits,
      tenancies: selfTenancies,
      meters: unitMeters.filter((m) => servedIds.has(m.unitId)).map((m) => ({ id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type })),
      readings: snapshot.readings.map((r) => ({ ...r, boundFor: r.interimFor ?? null })),
      gaps: snapshot.interimGaps ?? [],
      table,
      offRule: () => law(practiceReadingOffWarning, { period: lawPeriod }, lawLog),
    }
    const plan = planSelf(input)
```

und im Objekt von `selfPlans.set(plant.id, { … })` `input,` ergänzen.

- [ ] **Step 5: „Nur Heizung“ bei freien Schlüsseln (`server/src/calc.ts`)**

In der Schleife über die Positionen die Zeile
`const partOfYear = (t: TenancyWithUnit) => (t.days < diy ? \` · ${t.days}/${diy} Tage\` : '')`
ersetzen durch:

```ts
    // „Nur Heizung“ bei freien Schlüsseln (Heizung PR 10, Entwurf 5.3 `change_split`, A2, B7): Beim
    // Mieterwechsel teilen die übrigen Wärmekosten nach Gradtagszahlen (§ 9b Abs. 2), wenn die Anlage
    // es so eingestellt hat (Vorgabe). Eine kombinierte Position „Heizung und Warmwasser“ geht nach
    // Tagen wie bisher; ohne Ziel ändert sich keine Zahl. § 9b Abs. 2 lässt Gradtage oder Zeitanteil zu:
    // Bei Fläche, Einheiten, vereinbarten Anteilen und Direktzuordnung ist der Tagesanteil genau der
    // zeitanteilige Faktor, und an seine Stelle tritt der Gradtagsanteil. Personentage bleiben; sie sind
    // ebenso zeitanteilig, und die Verordnung kennt für Heizkosten keinen Personenschlüssel
    // (§ 7 Abs. 1 Satz 5; Abweichung 16).
    const manualPlant = item.category === HEATING_CATEGORY && item.heatingTarget === 'heating'
      ? plants.find((p) => p.id === item.heatingPlantId && p.method === 'manual')
      : undefined
    const degreeTable = manualPlant && (manualPlant.changeSplit ?? 'degreeDays') === 'degreeDays' ? law(hkvDegreeDays, { period: lawPeriod }, lawLog) : null
    const fullDegree = degreeTable ? degreeDayPermille([{ from: yFrom, to: yTo }], degreeTable) : 0
    const degreeOf = (t: TenancyWithUnit, table: DegreeDayTable): number =>
      degreeDayPermille([{ from: t.start > yFrom ? t.start : yFrom, to: t.end !== null && t.end < yTo ? t.end : yTo }], table)
    const dayShare = (t: TenancyWithUnit): number => (degreeTable && fullDegree > 0 ? degreeOf(t, degreeTable) / fullDegree : t.days / diy)
    const partOfYear = (t: TenancyWithUnit) => (t.days >= diy ? ''
      : degreeTable ? ` · ${fmtNum(Math.round(degreeOf(t, degreeTable) * 10) / 10)} von ${fmtNum(Math.round(fullDegree * 10) / 10)} ‰ Gradtage`
        : ` · ${t.days}/${diy} Tage`)
```

(`DegreeDayTable` in den Typimport aus `'../../shared/law/heizkostenv.ts'`.) In den Zweigen
`item.key === 'area'`, `item.key === 'units'`, `item.key === 'custom'` und `item.key === 'direct'` den
Faktor `(t.days / diy)` jeweils durch `dayShare(t)` ersetzen; im Zweig `custom` den Text
`${t.days < diy ? \` · ${t.days}/${diy} Tage\` : ''}` durch `${partOfYear(t)}`, im Zweig `direct`
`${t.days < diy ? \` · ${t.days}/${diy} Tage\` : ''}` ebenso. Im Zweig `direct` wird der Eigenanteil
aus den Rohwerten der Mieter gerechnet und folgt damit von selbst.

Direkt hinter dem letzten Zweig (vor `const booked = targets.map(…)`):

```ts
    // „Nur Heizung“ zeitanteilig (Heizung PR 10, `heating.change-split-time`): was die Gradtage ergäben.
    if (manualPlant && degreeTable === null && ['area', 'units', 'custom', 'direct'].includes(item.key)) {
      const table = law(hkvDegreeDays, { period: lawPeriod }, lawLog)
      const full = degreeDayPermille([{ from: yFrom, to: yTo }], table)
      for (const x of targets) {
        if (x.t.days >= diy || full <= 0) continue
        const byPlant = manualSplitTime.get(manualPlant.id) ?? new Map<string, { now: number, alt: number }>()
        const e = byPlant.get(x.t.id) ?? { now: 0, alt: 0 }
        e.now += x.raw
        e.alt += (x.raw * (degreeOf(x.t, table) / full)) / (x.t.days / diy)
        byPlant.set(x.t.id, e)
        manualSplitTime.set(manualPlant.id, byPlant)
      }
    }
```

mit `const manualSplitTime = new Map<string, Map<string, { now: number, alt: number }>>()` vor der
Schleife über die Positionen.

Hinter `const booked = targets.map((x) => bookable(x.t))`:

```ts
    // Pauschale und Inklusivmiete bei der eigenen Heizkostenabrechnung (Entwurf 6.3): Den Betrag nach der
    // Verordnung nennt `heating.flat-rate`.
    if (item.key === 'heatingSystem') targets.forEach((x, i) => { if (!booked[i] && statements.has(x.t.id)) selfFlat.set(x.t.id, (selfFlat.get(x.t.id) ?? 0) + x.raw) })
```

mit `const selfFlat = new Map<string, number>()` vor der Schleife. Hinter der Zeile, die
`keyChange` meldet:

```ts
    // Kosten der Zwischenablesung (BGH VIII ZR 19/07, Entwurf 10.1, Abweichung 19). Nicht an den
    // Übertragszeilen der Lieferungen und des Vorrats.
    if (item.category === HEATING_CATEGORY && !item.id.startsWith('fuel:') && !item.id.startsWith('stock:') && /zwischenablesung|nutzerwechsel/i.test(item.description)) {
      warn('heating.change-fee',
        `„${item.description}“: Kosten der Verbrauchserfassung, die wegen des Auszugs eines Mieters vor Ablauf des Abrechnungszeitraums entstehen, sind keine umlagefähigen Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist (BGH VIII ZR 19/07). ` +
          'Ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden; ein Amtsgericht hält sie für unwirksam (AG Berlin-Hohenschönhausen; das Aktenzeichen steht im Lexikon unter „Zwischenablesung“). Eine wirksame Vereinbarung gibt einen Anspruch gegen den ausziehenden Mieter, keine Position für alle. ' +
          'Gehört die Position dazu, erfassen Sie sie unter „Nicht umlagefähig“.',
        itemSubject(item))
    }
```

- [ ] **Step 6: Pauschale mit Betrag (`server/src/calc.ts`)**

Im Block `heating.flat-rate` (vor dem `warn`):

```ts
    // Bei der eigenen Heizkostenabrechnung kennt Mietfuchs den Betrag nach der Verordnung (Entwurf 6.3).
    const selfFlatList = heatingFlat.flatMap((t) => {
      const raw = selfFlat.get(t.id)
      return raw === undefined ? [] : [`${t.tenantName} (${t.unit.name}) ${fmtCents(Math.round(raw))}`]
    })
    const selfFlatText = selfFlatList.length > 0 ? ` Nach der Heizkostenverordnung entfielen auf ${andList(selfFlatList)}.` : ''
```

und im Text der Warnung hinter dem Satz mit der Kürzung (`… (§ 12 Abs. 1 HeizkostenV).`) `+ selfFlatText`
einfügen, vor dem Zusatz zur Einliegerwohnung.

- [ ] **Step 7: Ausweis (`server/src/calc.ts`)**

Hinter `selfBasisText` (Task 8):

```ts
  // Die Kosten eines Topfs: jede Position der Anlage nach ihrem Ziel, „Heizung und Warmwasser“ nach dem
  // Warmwasseranteil geteilt (Entwurf 8.3, 8.5). Ohne α (kein verbundenes Warmwasser) gibt es kein
  // Ziel „beides“.
  const partOf = (sp: SelfPlantPlan, c: SnapshotCostItem, p: SelfPot): number => {
    const a = sp.alpha?.value ?? null
    const tg = c.heatingTarget ?? null
    return tg === p ? 1 : tg === 'both' ? (a === null ? (p === 'heating' ? 1 : 0) : p === 'heating' ? 1 - a : a) : 0
  }
  const potCostOf = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], p: SelfPot): number =>
    potItems.filter((c) => c.key === 'heatingSystem').reduce((sum, c) => sum + c.amountCents * partOf(sp, c, p), 0)
  // Der Teil des CO₂-Abzugs eines Mieters, der auf jeden Topf entfällt (Abweichung 15, Entwurf 6.5): sein
  // gedruckter Abzug (positiv) im Verhältnis seines Brennstoffs in diesem Topf zu seinem Brennstoff
  // insgesamt. Beim Ziel „beides“ teilt α.
  const potCo2Of = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], reliefKey: string | null, tenancyId: string | null, w: SelfWeights | undefined): Record<SelfPot, number> => {
    const st = tenancyId ? statements.get(tenancyId) : undefined
    const relief = st && reliefKey ? -st.rows.filter((r) => r.costItemId === reliefKey).reduce((a, r) => a + r.shareCents, 0) : 0
    if (!w || relief === 0) return { heating: 0, water: 0 }
    const fuel = potItems.filter((c) => c.key === 'heatingSystem' && c.heatingPart === 'fuel')
    const inPot = (p: SelfPot) => fuel.reduce((a, c) => a + c.amountCents * partOf(sp, c, p) * w[p], 0)
    const h = inPot('heating')
    const wa = inPot('water')
    return h + wa > 0 ? { heating: (relief * h) / (h + wa), water: (relief * wa) / (h + wa) } : { heating: 0, water: 0 }
  }
  // Der Ausweis je Anlage und Heizperiode (Entwurf 8.8 ohne § 6a, der mit PR 14 kommt).
  const selfStatementOf = (sp: SelfPlantPlan, potItems: readonly SnapshotCostItem[], reliefKey: string | null): SelfHeatingStatement => {
    const cost = { heating: potCostOf(sp, potItems, 'heating'), water: potCostOf(sp, potItems, 'water') }
    const offDays = (d: string, b: string): number => Math.abs(Math.round((toUTC(d) - toUTC(b)) / MS_DAY))
    return {
      ok: sp.weights !== null,
      heatPump: sp.verdict?.kind ?? null,
      changeSplit: sp.changeSplit,
      areaBasisHeat: sp.plant.areaBasisHeat ?? 'area',
      hotWater: sp.hotWater,
      alpha: sp.alpha ? { percent: sp.alpha.value * 100, dhwHeatKwh: sp.alpha.dhwHeatKwh, referenceKwh: sp.alpha.referenceKwh, reference: sp.alpha.reference, estimated: sp.alpha.estimated } : null,
      shares: sp.shares ? { heating: sp.shares.heating, water: sp.shares.water, forced: sp.shares.forced, previous: sp.shares.previous } : null,
      pots: sp.plan.pots.map((p): SelfPotView => {
        const t = sp.plan.totals[p]
        const pct = t.measured && sp.shares ? (sp.shares[p] ?? 0) : 0
        return {
          pot: p, costCents: Math.round(cost[p]), consumptionPct: pct, byAreaOnly: !t.measured, areaM2: t.area, consumption: t.consumption,
          consumptionUnit: p === 'heating' ? 'kWh' : 'm³',
          baseCentsPerM2: t.area > 0 ? (cost[p] * (1 - pct / 100)) / t.area : 0,
          consumptionCentsPerUnit: t.measured && t.consumption > 0 ? (cost[p] * pct / 100) / t.consumption : null,
        }
      }),
      units: sp.plan.units.map((u): SelfUnitView => ({
        unitId: u.unit.id,
        unitName: u.unit.name,
        areaM2: u.unit.areaM2,
        heatAreaM2: u.heatArea,
        readings: u.readings,
        boundaries: u.boundaries.map((b) => {
          const dated = b.readingDates.filter((d): d is string => d !== null)
          return {
            date: b.date, kind: b.kind, gap: b.gap, far: b.far,
            status: dated.length < b.readingDates.length ? 'missing' : dated.some((d) => d !== b.date) ? 'off' : 'read',
            offDays: dated.reduce((m, d) => Math.max(m, offDays(d, b.date)), 0),
          }
        }),
        users: u.users.map((x): SelfUserView => {
          const w = sp.weights?.get(x.key)
          const co2 = potCo2Of(sp, potItems, reliefKey, x.tenancyId, w)
          return {
            key: x.key, role: x.role, tenancyId: x.tenancyId, label: x.label, from: x.from, to: x.to, days: x.days, degreeDayPermille: x.degreeDayPermille,
            heatingConsumption: x.pots.heating.value,
            waterConsumption: sp.plan.pots.includes('water') ? x.pots.water.value : null,
            heatingGroup: x.pots.heating.group,
            waterGroup: x.pots.water.group,
            heatingCents: w ? Math.round(cost.heating * w.heating) : 0,
            waterCents: w ? Math.round(cost.water * w.water) : 0,
            heatingCo2Cents: Math.round(co2.heating),
            waterCo2Cents: Math.round(co2.water),
          }
        }),
      })),
    }
  }
```

(`SelfHeatingStatement, SelfPotView, SelfUnitView, SelfUserView` in den Typimport aus
`'../../shared/types.ts'`.) Im CO₂-Block hinter `heatingStatements.push(report)` (und hinter dem Block
`report.fuel` aus PR 7):

```ts
    // Die eigene Heizkostenabrechnung dieser Heizperiode (Heizung PR 10).
    const selfOf = selfPlans.get(pot.plantId)
    if (selfOf) report.self = selfStatementOf(selfOf, pot.items, pot.reliefKey)
```

- [ ] **Step 8: Hinweise (`server/src/calc.ts`)**

Direkt hinter der Schleife `for (const pot of co2Pots)` (dem CO₂-Block):

```ts
  // ---------- Hinweise der eigenen Heizkostenabrechnung (Heizung PR 10, Entwurf 3.5, 8.5, 10.1) ----------
  // Nach dem CO₂-Block, denn die Kürzungsbeträge rechnen auf den gedruckten Zeilen nach der
  // Abzugszeile (Entwurf 6.5). Ist eine Anlage nicht verteilbar, steht dort schon ein Fehler, und ein
  // Hinweis auf leere Zeilen sagte nichts.
  const cutOf = (tenancyId: string, ids: ReadonlySet<string>, pct: number): number | null => {
    const st = statements.get(tenancyId)
    if (!st) return null
    const sum = st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
    return sum > 0 ? Math.round((sum * pct) / 100) : null
  }
  const nameOf = (tenancyId: string): string => {
    const st = statements.get(tenancyId)
    return st ? `${st.tenantName} (${st.unitName})` : tenancyId
  }
  const permilleText = (p: number): string => `${fmtNum(Math.round(p * 10) / 10)} ‰`
  for (const sp of selfPlans.values()) {
    if (sp.weights === null || !sp.shares) continue
    const plant = sp.plant
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const pot = co2Pots.find((x) => x.plantId === plant.id)
    const ids = new Set<string>([...(pot?.items ?? []).map((c) => c.id), ...(pot ? [pot.reliefKey] : [])])
    const notYet = sp.verdict?.kind === 'notYet'
    const farText = ' Liegt im Winter ein Monat oder mehr dazwischen, gilt eine solche Abweichung nach der Kommentarliteratur grundsätzlich als nicht zulässig; lesen Sie künftig zum Stichtag ab oder nutzen Sie den Stichtagswert des Geräts (⟨Norm offen: VDI 2077⟩).'
    for (const f of sp.plan.findings) {
      if (f.kind === 'datesDiffer') {
        warn(f.far ? 'heating.reading-dates-far' : 'heating.reading-dates-differ',
          `${where}: Die Zähler wurden nicht genau zum ${fmtDay(f.boundary)} abgelesen; die größte Abweichung hat ${f.unitName} mit ${f.days} ${f.days === 1 ? 'Tag' : 'Tagen'} (Ablesung am ${fmtDay(f.readingDate)}, ${permilleText(f.permille)} der Gradtage dazwischen). ` +
            'Mietfuchs rechnet mit den Werten, wie sie abgelesen sind, ohne Rückrechnung; das ist unschädlich, wenn in der Zwischenzeit wenig verbraucht wird.' + (f.far ? farText : ''),
          subject)
      } else if (f.kind === 'interimOff') {
        warn(f.far ? 'heating.interim-reading-far' : 'heating.interim-reading-off',
          `${where}: Beim Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} wurde am ${fmtDay(f.readingDate)} abgelesen (${f.days} ${f.days === 1 ? 'Tag' : 'Tage'} daneben, ${permilleText(f.permille)} der Gradtage). ` +
            `Der Verbrauch dazwischen zählt zum ${f.readingDate > f.boundary ? 'Vormieter' : 'Nachmieter'}; zurückgerechnet wird nicht.` +
            (f.far ? ' Sie haben gewählt, diese Ablesung zu verwenden, statt nach § 9b Abs. 3 HeizkostenV zu teilen.' + farText : ''),
          subject)
      } else if (f.status === 'impossible' || f.status === 'imprecise') {
        warn('heating.no-interim-reading',
          f.status === 'impossible'
            ? `${where}: Für den Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} gibt es keine Zwischenablesung (nicht möglich${f.reason ? `: ${f.reason}` : ''}). ` +
              'Die gesamten Kosten der Wohnung werden deshalb aufgeteilt, die Heizkosten nach Gradtagen bzw. Tagen, die Warmwasserkosten nach Tagen (§ 9b Abs. 3 HeizkostenV).'
            : `${where}: Die Zwischenablesung zum Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} lässt nach Ihrer Angabe wegen ihres Zeitpunkts keine hinreichend genaue Ermittlung zu. ` +
              'Die gesamten Kosten der Wohnung werden deshalb aufgeteilt, die Heizkosten nach Gradtagen bzw. Tagen, die Warmwasserkosten nach Tagen (§ 9b Abs. 3 HeizkostenV).',
          subject)
      } else {
        const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
        const list = notYet ? [] : f.tenancyIds.flatMap((id) => {
          const c = cutOf(id, ids, cut)
          return c === null ? [] : [`${nameOf(id)} ${fmtCents(c)}`]
        })
        warn('heating.no-interim-reading-missed',
          `${where}: Für den Wechsel in ${f.unitName} zum ${fmtDay(f.boundary)} gibt es keine Zwischenablesung` +
            `${f.status === null ? '; bitte geben Sie auf der Seite Heizkosten an, ob sie nicht möglich war oder nicht durchgeführt wurde' : ''}. ` +
            'Gerechnet wird nach § 9b Abs. 3 HeizkostenV, denn eine andere Rechnung gibt es nicht. Die Zwischenablesung war Pflicht (§ 9b Abs. 1). ' +
            (list.length > 0 ? `Bis zu ${cut} % der Heizkosten von ${andList(list)} können gekürzt werden (LG Hamburg, 11 S 202/87); ` : `Bis zu ${cut} % können gekürzt werden (LG Hamburg, 11 S 202/87); `) +
            'nach AG Schöneberg, 104a C 226/05, ist die Umlage des Verbrauchsanteils angreifbar. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.',
          subject)
      }
    }
    // Kein Verbrauch erfasst (Entwurf 8.5): nur nach Fläche, 15 % (Abweichung 15 zur Grundlage).
    const unmeasured = sp.plan.pots.filter((p) => !sp.plan.totals[p].measured)
    if (unmeasured.length > 0 && !notYet) {
      const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
      const share = law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
      let amounts = ''
      if (unmeasured.length === sp.plan.pots.length) {
        amounts = cutsOn(ids, cut)
      } else {
        // „Soweit“ (§ 12 Abs. 1 Satz 1): nur der unerfasste Topf, sein Anteil nach CO₂-Abzug (6.5); der
        // Ausweis druckt beide Beträge je Mieter (Abweichung 15).
        const p = unmeasured[0] ?? 'heating'
        const K = potCostOf(sp, pot?.items ?? [], p)
        const list = sp.plan.units.flatMap((u) => u.users).flatMap((u) => {
          const w = sp.weights?.get(u.key)
          if (u.role !== 'tenancy' || !u.tenancyId || !statements.has(u.tenancyId) || !w) return []
          const net = K * w[p] - potCo2Of(sp, pot?.items ?? [], pot?.reliefKey ?? null, u.tenancyId, w)[p]
          const c = Math.round((net * cut) / 100)
          return c > 0 ? [`${nameOf(u.tenancyId)} ${fmtCents(c)}`] : []
        })
        amounts = list.length > 0 ? `, hier vom Topf ${POT_NAME[p]} nach CO₂-Abzug laut Ausweis: ${andList(list)}` : ''
      }
      const missingCapture = sp.verdict?.kind === 'missing'
        ? ` Die Wärmepumpe hat keine Verbrauchserfassung, obwohl sie bis zum ${fmtDay(law(hkvHeatPumpCapture, { date: period.from }, lawLog).installBy)} einzubauen war (§ 12 Abs. 3 HeizkostenV). Dass die Mieter dann nach § 12 Abs. 1 Satz 1 kürzen dürfen, ist eine Auslegung; entschieden ist es nicht.`
        : ''
      warn('heating.no-consumption',
        `${where}: Für ${unmeasured.map((p) => POT_NAME[p]).join(' und ')} ist kein Verbrauch erfasst; Mietfuchs verteilt ${unmeasured.length === 1 ? 'diesen Teil' : 'die Kosten'} nur nach Fläche. ` +
          `Die Heizkostenverordnung verlangt, ${hkvConsumptionShare.describe(share)} nach dem erfassten Verbrauch zu verteilen; sonst darf jeder Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 Satz 1 HeizkostenV)${amounts}.${missingCapture}`,
        subject)
    }
    // Anteil anders als in der Vorperiode (§ 6 Abs. 4, R-A7).
    const prev = sp.shares.previous
    if (sp.shares.changed && prev) {
      warn('heating.key-change',
        `${where}: Der Anteil nach Verbrauch war in der vorigen Heizperiode ${fmtNum(prev.heating)} % bei der Heizung${prev.water !== null ? ` und ${fmtNum(prev.water)} % beim Warmwasser` : ''}, jetzt ${fmtNum(sp.shares.heating)} %${sp.shares.water !== null ? ` und ${fmtNum(sp.shares.water)} %` : ''}. ` +
          'Den Abrechnungsmaßstab ändern Sie nach der ersten Festlegung nur bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen, durch Erklärung gegenüber den Mietern und nur mit Wirkung zum Beginn eines Abrechnungszeitraums (§ 6 Abs. 4 HeizkostenV). Ist das so geschehen, ist nichts zu tun.',
        subject)
    }
    // Warmwasseranteil auf der Schätzung beim Abschluss (Abweichung 11).
    if (sp.alpha?.estimated) {
      warn('heating.dhw-share-estimated',
        `${where}: Der Warmwasseranteil von ${fmtNum(Math.round(sp.alpha.value * 1000) / 10)} % beruht auf der geschätzten Energie der fehlenden Rechnung, die Sie beim Abschluss eingetragen haben. Mit der Folgerechnung kann er sich ändern; die abgeschlossene Abrechnung bleibt, wie sie ist.`,
        subject)
    }
    // Wärmepumpe, für die die Verordnung noch nicht gilt (§ 12 Abs. 3 Satz 2, Abweichung 7).
    if (sp.verdict?.kind === 'notYet') {
      const rule = law(hkvHeatPumpCapture, { date: period.from }, lawLog)
      const on = sp.verdict.captureInstalledOn
      warn('heating.heat-pump-capture',
        `${where}: Bei dieser Wärmepumpe wurde der Verbrauch am ${fmtDay(rule.capturedBy)} noch nicht erfasst. Die Heizkostenverordnung gilt für sie erst ab dem Abrechnungszeitraum, der nach dem Einbau der Erfassung beginnt (§ 12 Abs. 3 HeizkostenV)` +
          `${on ? `, also ab dem Abrechnungszeitraum, der nach dem ${fmtDay(on)} beginnt` : `; einzubauen ist sie bis zum ${fmtDay(rule.installBy)}`}. ` +
          'Bis dahin gilt die Verteilung laut Mietvertrag, und Kürzungen nach § 12 Abs. 1 HeizkostenV entfallen. Mietfuchs verteilt nach den erfassten Werten, wie Sie es eingerichtet haben; prüfen Sie, ob der Mietvertrag das deckt.',
        subject)
    }
    // Zeitanteilig statt nach Gradtagen (§ 9b Abs. 2): beide Beträge.
    if (sp.changeSplit === 'time' && sp.plan.units.some((u) => u.users.length > 1)) {
      const alt = weightsOf(planSelf({ ...sp.input, changeSplit: 'degreeDays' }), { heating: sp.shares.heating, water: sp.shares.water ?? 0 }, sp.alpha?.value ?? null)
      const own = (pot?.items ?? []).filter((c) => c.key === 'heatingSystem')
      const sumFor = (w: Map<string, SelfWeights>, key: string): number => own.reduce((a, c) => a + c.amountCents * (w.get(key)?.[c.heatingTarget ?? 'both'] ?? 0), 0)
      const list = sp.plan.units.filter((u) => u.users.length > 1).flatMap((u) => u.users).flatMap((u) => (u.role === 'tenancy' && u.tenancyId && sp.weights
        ? [`${nameOf(u.tenancyId)}: zeitanteilig ${fmtCents(Math.round(sumFor(sp.weights, u.key)))}, nach Gradtagen ${fmtCents(Math.round(sumFor(alt, u.key)))}`]
        : []))
      if (list.length > 0) {
        warn('heating.change-split-time',
          `${where}: Beim Mieterwechsel teilen Sie die übrigen Heizkosten zeitanteilig. Die Heizkostenverordnung lässt auch die Gradtagszahlen zu, nach denen ein Wintermonat mehr wiegt als ein Sommermonat (§ 9b Abs. 2 HeizkostenV); beides ist zulässig. ${andList(list)}.`,
          subject)
      }
    }
  }
  // Dasselbe bei freien Schlüsseln mit Positionen „nur Heizung“ (Heizung PR 10, A2).
  for (const [plantId, byTenancy] of manualSplitTime) {
    const plant = plants.find((p) => p.id === plantId)
    const list = [...byTenancy].map(([id, e]) => `${nameOf(id)}: zeitanteilig ${fmtCents(Math.round(e.now))}, nach Gradtagen ${fmtCents(Math.round(e.alt))}`)
    if (!plant || list.length === 0) continue
    warn('heating.change-split-time',
      `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}: Beim Mieterwechsel teilen Sie die Positionen „nur Heizung“ zeitanteilig. Die Heizkostenverordnung lässt auch die Gradtagszahlen zu, nach denen ein Wintermonat mehr wiegt als ein Sommermonat (§ 9b Abs. 2 HeizkostenV); beides ist zulässig. ${andList(list)}.`,
      { kind: 'heatingCosts', id: plantId })
  }
```

(`nameOf` setzt den Namen aus der Abrechnung des Mieters; `statements` enthält dort alle
abgerechneten Mietverhältnisse. Hat PR 8 eine Funktion gleichen Namens in `computeSettlement`, heißt
diese hier `tenantLabelOf`.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-heizkosten.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts test/calc.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts test/calc-wortlaut.test.ts && npm run typecheck`
Expected: PASS (calc-heizkosten.test.ts: 21 Tests). `glossary.test.ts` prüft, dass jeder neue Code einen
Begriff hat; `law-literals.test.ts`, dass die Urteile ohne Datum genannt sind und keine Rechtszahl im
Text steht; `anrede.test.ts` das Siezen.

- [ ] **Step 10: Golden unverändert und Ankündigung prüfen**

Run: `grep -rn "Zwischenablesung\|Nutzerwechsel" server/test/fixtures | head`
Expected: keine Beschreibung einer Kostenposition in den Golden-Fixtures (die einzige angekündigte
Änderung für Bestandsnutzer, `heating.change-fee`, trifft dort keine). Trifft eine, kommt der Hinweis in
deren Erwartung, und das README nennt den Grund.

- [ ] **Step 11: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calc.ts server/test/calc-heizkosten.test.ts
git commit -m "Heizkostenabrechnung: Hinweise zu Ablesung, Zwischenablesung, Verbrauch, Anteil und Wärmepumpe; Ausweis je Heizperiode

Versäumte Zwischenablesung mit bis zu 15 % auf die Heizkosten nach Abzug, Ablesungen neben Stichtag
und Wechsel mit Tagen und Gradtagen. Bei freien Schlüsseln teilen Positionen „nur Heizung“ nach
Gradtagen (R4/B5); kombinierte Positionen bleiben nach Tagen.

Refs #99"
```

---

### Task 10: Golden F16 und F17

Die beiden Golden-Fixtures des Entwurfs (12.1) für PR 10: F16 „Eigene Heizkostenabrechnung“ (Beispiel
A aus 8.6) und F17 „Heizöl mit Vorrat“ (Beispiel 8.2) samt der Variante mit ⅓ Eigennutzung (G-C5,
N8). Jede Zahl steht in der README mit ihrer Herleitung; der Bestand entsteht über denselben Weg wie
beim Nutzer (Einrichtung, Zähler, Ablesungen, Lieferungen, Positionen).

**Files:**
- Create: `server/test/fixtures/heating/F16-eigene-heizkostenabrechnung/README.md`, `server/test/fixtures/heating/F17-heizoel-mit-vorrat/README.md`
- Modify: `server/test/heating-golden.test.ts`

**Interfaces:**
- Consumes (Task 5, 8, 9; PR 6–8): `setUpSelf`, `createHeatingPlant`, `createDelivery`, `saveStock`, `createEntity`, `readStock`, `snapshotFor`, `computeSettlement`, `taxReport`, `stockCarrySelfCents`; in heating-golden.test.ts `withDatabase`, `FIXTURES`, `euro` (PR 6).
- Produces: keine neuen Schnittstellen.

- [ ] **Step 1: F16 (Herleitung)**

`server/test/fixtures/heating/F16-eigene-heizkostenabrechnung/README.md`:

```markdown
# F16 Eigene Heizkostenabrechnung

Beispiel A des Entwurfs (8.6). Drei Wohnungen: A 60 m², B 80 m², C 60 m², zusammen 200 m². Mieter A
und B seit 2020; in C zieht Mieter C1 zum 30.09.2025 aus, C2 zum 01.10.2025 ein, mit
Zwischenablesung am 30.09.2025. Gasheizung, die auch das Warmwasser bereitet; der Vermieter rechnet
selbst ab, Kalenderjahr 2025, 70 % nach Verbrauch bei Heizung und Warmwasser (§ 7 Abs. 1, § 8 Abs. 1
HeizkostenV). Je Wohnung ein Wärmezähler (kWh) und ein Warmwasserzähler (m³), am Speicher ein
Wärmezähler für das Warmwasser.

| Zähler | 31.12.2024 | 30.09.2025 | 31.12.2025 | Verbrauch |
|---|---|---|---|---|
| Wärme A | 1.000 | | 13.000 | 12.000 kWh |
| Wärme B | 0 | | 16.000 | 16.000 kWh |
| Wärme C | 500 | 7.700 | 12.500 | C1 7.200, C2 4.800 kWh |
| Warmwasser A | 10 | | 40 | 30 m³ |
| Warmwasser B | 0 | | 40 | 40 m³ |
| Warmwasser C | 5 | 43 | 55 | C1 38, C2 12 m³ |
| Wärme am Speicher | 0 | | 9.000 | 9.000 kWh |

Positionen: Erdgas 6.000,00 € (Brennstoff, Heizung und Warmwasser; Rechnung über das Jahr, 60.000 kWh,
10.883,4 kg CO₂, CO₂-Kosten 598,59 €), Betriebsstrom 180,00 €, Wartung 240,00 €, Immissionsmessung
60,00 € (Betrieb, Heizung und Warmwasser), Miete Wärmezähler 120,00 € (Erfassung, nur Heizung), Miete
Warmwasserzähler 60,00 € (Erfassung, nur Warmwasser). Zusammen 6.660,00 €.

## Herleitung

**Warmwasseranteil** (§ 9 Abs. 2 Satz 1, Entwurf 8.3): α = 9.000 kWh / 60.000 kWh = 15,0 %. Die kWh der
Gasrechnung bleiben, wie abgerechnet (§ 9 Abs. 3 letzter Satz; G-B1 abgelehnt).

**Töpfe.** Positionen „Heizung und Warmwasser“ 6.480,00 € → Heizung 85 % = 5.508,00 €, Warmwasser
15 % = 972,00 €. Dazu Wärmezähler 120,00 € zur Heizung, Warmwasserzähler 60,00 € zum Warmwasser:
K_H = 5.628,00 €, K_W = 1.032,00 €.

**Preise.** Heizung: Grundkosten 30 % = 1.688,40 € / 200 m² = 8,442 €/m²; Verbrauchskosten 70 % =
3.939,60 € / 40.000 kWh = 0,09849 €/kWh. Warmwasser: Grundkosten 309,60 € / 200 m² = 1,548 €/m²;
Verbrauchskosten 722,40 € / 120 m³ = 6,02 €/m³.

**Wechsel in C** (§ 9b Abs. 1, 2). Die Verbrauchskosten folgen der Zwischenablesung; die Grundkosten
Heizung nach Gradtagen (Januar bis September 640 ‰, Oktober bis Dezember 360 ‰), die Grundkosten
Warmwasser nach Tagen (273 / 92 von 365).

| Nutzer | Heizung | Warmwasser | zusammen |
|---|---|---|---|
| A | 60 · 8,442 + 12.000 · 0,09849 = 1.688,40 € | 60 · 1,548 + 30 · 6,02 = 273,48 € | 1.961,88 € |
| B | 675,36 + 1.575,84 = 2.251,20 € | 123,84 + 240,80 = 364,64 € | 2.615,84 € |
| C1 | 506,52 · 0,64 + 709,128 = 1.033,3008 € | 92,88 · 273/365 + 228,76 = 298,2285 € | 1.331,5293 € |
| C2 | 506,52 · 0,36 + 472,752 = 655,0992 € | 92,88 · 92/365 + 72,24 = 95,6507 € | 750,7499 € |

Gerundet wird je Position nach #202 (größter Rest, bei Gleichstand an den Vermieter); die Summen der
Zeilen sind **1.961,89 / 2.615,84 / 1.331,52 / 750,75 €** (zusammen 6.660,00 €). A bekommt bei der
Rundung der sechs Positionen einen Cent mehr als die exakte Summe; die Zeilen stehen im Test.

**CO₂** (Entwurf 9.4). 10.883,4 kg / 200 m² = 54,4 kg je m²; ab 52 kg trägt der Vermieter 95 %
(letzte Stufe der Anlage zum CO2KostAufG). L = 598,59 € · 95 % = 568,6605 €. Abgezogen wird nach dem Anteil
jedes Mieters an der Brennstoffposition (Erdgas): A 1.768,50 € / 6.000,00 € · 568,6605 € = 167,61 €,
B 223,48 €, C1 113,40 €, C2 64,17 €, zusammen R = 568,66 €.

**Ohne Hinweis** außer dem CO₂-Ausweis: keine Lücke, alle Grenzen abgelesen, Anteil wie im ersten
Jahr.
```

- [ ] **Step 2: F17 (Herleitung)**

`server/test/fixtures/heating/F17-heizoel-mit-vorrat/README.md`:

```markdown
# F17 Heizöl mit Vorrat

Beispiel 8.2 des Entwurfs mit eigener Heizkostenabrechnung. Drei Wohnungen à 100 m², je ein Mieter
seit 2020, Ölheizung ohne Warmwasser (`hotWater = none`), Kalenderjahr 2025, 70 % nach Verbrauch.
Wärmezähler: A 10.000 kWh, B 12.000 kWh, C 8.000 kWh, zusammen 30.000 kWh.

| Posten | Menge | kg CO₂ | Kosten | CO₂-Kosten |
|---|---|---|---|---|
| Anfangsbestand (Rechnung 2022) | 2.000 l | 5.352,6 | 1.900,00 € | 0 € |
| Lieferung 15.03.2025 | 3.000 l | 8.028,9 | 3.150,00 € | 525,49 € |
| Lieferung 10.10.2025 | 2.500 l | 6.690,75 | 2.500,00 € | 437,91 € |
| Endbestand | 1.800 l | aus der Lieferung vom 10.10. | 1.800,00 € | |

## Herleitung

**Bestandsrechnung** (8.2, aus PR 8 unverändert). Kosten 5.750,00 €, bezahlt 5.650,00 €; Überträge
„aus dem Vorrat“ +1.900,00 € und „im Vorrat“ −1.800,00 €, Gegenzeile beim Vermieter −100,00 €
(`fuelCarry`). Bei `self` gehen die Überträge durch die Heizkostenverordnung wie die Rechnungen
(Entwurf 8.2, Naht N14 des Plans).

**Verteilung.** Grundkosten 30 % nach Fläche (je ⅓), Verbrauchskosten 70 % nach kWh:

| Mieter | Gewicht | Anteil an 5.750,00 € |
|---|---|---|
| A | 0,1 + 0,7 · 10/30 = 0,33333 | 1.916,67 € exakt |
| B | 0,1 + 0,7 · 12/30 = 0,38 | 2.185,00 € |
| C | 0,1 + 0,7 · 8/30 = 0,28667 | 1.648,33 € exakt |

Je Position und Übertrag nach #202 gerundet: **1.916,66 / 2.185,00 / 1.648,34 €**, zusammen 5.750,00 €.

**CO₂.** E = 15.254,91 kg / 300 m² = 50,8 kg je m² → 80 % (Stufe 47 bis unter 52 kg der Anlage zum CO2KostAufG). C = 648,10 €,
L = 518,48 € (8.2). Abgezogen nach dem Anteil am Brennstoff, also an den Rechnungen und Überträgen:
A 172,83 €, B 197,02 €, C 148,63 €, zusammen 518,48 €.

## Variante ⅓ Eigennutzung (G-C5, N8)

Wohnung C bewohnt der Vermieter selbst; damit das Gewicht der Eigennutzung genau ⅓ ist, zeigen alle
drei Wärmezähler 10.000 kWh (Festlegung des Plans, der Entwurf nennt keine Zählerstände).

- Abrechnung: Eigenanteil (`selfUsedShareCents`) exakt 5.750,00 € / 3 = 1.916,666… €. Gedruckt wird
  je Zeile nach #202 (größter Rest, bei Gleichstand an den Vermieter, also an die Eigennutzung):

  | Zeile | je Nutzer exakt | Eigennutzung gedruckt |
  |---|---|---|
  | Heizöl l1 3.150,00 € | 1.050,00 € | 1.050,00 € |
  | Heizöl l2 2.500,00 € | 833,333… € | 833,34 € (Restcent, Gleichstand dreier Nutzer) |
  | Heizöl aus dem Vorrat 1.900,00 € | 633,333… € | 633,34 € (ebenso) |
  | Heizöl im Vorrat −1.800,00 € | −600,00 € | −600,00 € |
  | zusammen | 1.916,666… € | **1.916,68 €** |

  Vier Zeilen, je höchstens 1 ct daneben (6.2); der Test nagelt 1.916,68 € fest, damit ein Fehler bei
  der Zuteilung des Restcents auffällt. Stimmt die Regel von #202 in `distributeCents` (PR 2) anders,
  ist das ein Befund für die Durchsicht und nicht eine neue Erwartung.
- Steuer: privat = Bezahltes mal Gewicht = 5.650,00 € / 3 = 1.883,33 € (6.4).
- Der Abstand 1.916,68 € − 1.883,33 € = 33,35 € ist der Eigenanteil an den Überträgen (gedruckt
  633,34 € − 600,00 € = 33,34 €), bis auf einen Cent aus der Rundung der Rechnung l2; die Steuerseite
  erklärt ihn (`stockCarrySelfCents`, PR 8).
```

- [ ] **Step 3: Write the tests**

An `server/test/heating-golden.test.ts` anhängen (Importe ergänzen: `setUpSelf` aus
`'../src/db/heatingSelf.ts'`, `createDelivery` aus `'../src/db/fuel.ts'`, `saveStock` aus
`'../src/db/fuelStock.ts'`, `stockCarrySelfCents` aus `'../src/calc.ts'`, `CALENDAR_RULES` aus
`'../../shared/period.ts'`):

```ts
// ---------- F16, F17: eigene Heizkostenabrechnung (Heizung PR 10) ----------

let meterIds = 0
const meterId = () => `gm-${++meterIds}`
const P2025 = () => periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
const zeile = (s: ReturnType<typeof computeSettlement>, t: string, id: string): number =>
  s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.costItemId === id)?.shareCents ?? assert.fail(`keine Zeile ${id} bei ${t}`)
const summe = (s: ReturnType<typeof computeSettlement>, t: string): number =>
  (s.statements.find((st) => st.tenancyId === t) ?? assert.fail(`keine Abrechnung ${t}`)).rows.filter((r) => r.kind !== 'co2Relief').reduce((a, r) => a + r.shareCents, 0)
const entlastung = (s: ReturnType<typeof computeSettlement>, t: string): number =>
  s.statements.find((st) => st.tenancyId === t)?.rows.filter((r) => r.kind === 'co2Relief').reduce((a, r) => a + r.shareCents, 0) ?? 0
async function ablesen(opened: Opened, rows: [string | null, string, string | null, string, number][]): Promise<void> {
  const meters = (await opened.read(readStock)).meters
  await opened.write(async (db) => {
    for (const [unitId, type, role, date, value] of rows) {
      const m = meters.find((x) => x.unitId === unitId && x.type === type && (x.heatingRole ?? null) === role) ?? assert.fail(`kein Zähler ${unitId} ${type}`)
      await createEntity(db, 'readings', `${m.id}@${date}`, { meterId: m.id, date, value })
    }
  })
}

test('F16 Eigene Heizkostenabrechnung: 1.961,89 / 2.615,84 / 1.331,52 / 750,75 €, R = 568,66 €', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', 'A', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'tenancies', 'B', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'tenancies', 'C1', { unitId: 'c', tenantName: 'Mieter C1', persons: 1, start: '2020-01-01', end: '2025-09-30' })
      await createEntity(db, 'tenancies', 'C2', { unitId: 'c', tenantName: 'Mieter C2', persons: 1, start: '2025-10-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await setUpSelf(db, 'hp', { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }, '2026-02-01', meterId)
    })
    await ablesen(opened, [
      ['a', 'waerme', null, '2024-12-31', 1000], ['a', 'waerme', null, '2025-12-31', 13000],
      ['b', 'waerme', null, '2024-12-31', 0], ['b', 'waerme', null, '2025-12-31', 16000],
      ['c', 'waerme', null, '2024-12-31', 500], ['c', 'waerme', null, '2025-09-30', 7700], ['c', 'waerme', null, '2025-12-31', 12500],
      ['a', 'warmwasser', null, '2024-12-31', 10], ['a', 'warmwasser', null, '2025-12-31', 40],
      ['b', 'warmwasser', null, '2024-12-31', 0], ['b', 'warmwasser', null, '2025-12-31', 40],
      ['c', 'warmwasser', null, '2024-12-31', 5], ['c', 'warmwasser', null, '2025-09-30', 43], ['c', 'warmwasser', null, '2025-12-31', 55],
      [null, 'waerme', 'dhwHeat', '2024-12-31', 0], [null, 'waerme', 'dhwHeat', '2025-12-31', 9000],
    ])
    await opened.write(async (db) => {
      await createDelivery(db, 'd1', 'hp', { label: 'Erdgas', invoiceDate: '2026-01-15', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 60000, fixedCents: 0, emissionsKg: 10883.4, co2CostCents: 59859 })
      const item = (id: string, description: string, amountCents: number, heatingPart: string, heatingTarget: string, extra: Record<string, unknown> = {}) =>
        createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra })
      await item('gas', 'Erdgas', 600000, 'fuel', 'both', { fuelDeliveryId: 'd1' })
      await item('strom', 'Betriebsstrom', 18000, 'operating', 'both')
      await item('wartung', 'Wartung', 24000, 'operating', 'both')
      await item('imm', 'Immissionsmessung', 6000, 'operating', 'both')
      await item('wz', 'Miete Wärmezähler', 12000, 'metering', 'heating')
      await item('wwz', 'Miete Warmwasserzähler', 6000, 'metering', 'water')
    })
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', P2025()))
    assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    // Keiner der Hinweise der eigenen Abrechnung: alle Grenzen abgelesen, Anteil wie im ersten Jahr.
    const PR10 = ['heating.interim-reading-off', 'heating.interim-reading-far', 'heating.no-interim-reading', 'heating.no-interim-reading-missed', 'heating.reading-dates-differ', 'heating.reading-dates-far', 'heating.no-consumption', 'heating.key-change', 'heating.change-split-time', 'heating.change-fee', 'heating.heat-pump-capture']
    assert.deepEqual(s.notices.filter((n) => PR10.includes(n.code)).map((n) => n.code), [])
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => euro(summe(s, t))), ['1.961,89 €', '2.615,84 €', '1.331,52 €', '750,75 €'])
    assert.equal(['A', 'B', 'C1', 'C2'].reduce((a, t) => a + summe(s, t), 0), 666000)
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => zeile(s, t, 'gas')), [176850, 235800, 119644, 67706])
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => entlastung(s, t)), [-16761, -22348, -11340, -6417])
    const self = s.heating?.[0]?.self ?? assert.fail('kein Ausweis')
    assert.equal(Math.round((self.alpha?.percent ?? 0) * 10) / 10, 15)
    assert.deepEqual(self.pots.map((p) => [p.pot, p.costCents]), [['heating', 562800], ['water', 103200]])
  })
})

// F17: drei Wohnungen à 100 m², Öl mit Vorrat, kein Warmwasser. `heat` sind die kWh der Wärmezähler.
async function f17(opened: Opened, selfC: boolean, heat: [number, number, number]): Promise<ReturnType<typeof snapshotFor>> {
  await opened.write(async (db) => {
    for (const u of ['a', 'b', 'c']) {
      const self = selfC && u === 'c'
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 100, participates: !self, selfUsed: self, ...(self ? { selfPersons: 1 } : {}) })
      if (!self) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
    await setUpSelf(db, 'hp', { period: '2025-01', heatConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'heatMeter' }, '2026-02-01', meterId)
    await saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' })
    // Lieferungen von Vorratsenergien mit den Feldern aus PR 8 Task 5.
    await createDelivery(db, 'd1', 'hp', { label: 'Heizöl März', invoiceDate: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 })
    await createDelivery(db, 'd2', 'hp', { label: 'Heizöl Oktober', invoiceDate: '2025-10-10', quantity: 2500, quantityUnit: 'l', emissionsKg: 6690.75, co2CostCents: 43791 })
    for (const [id, amountCents, d] of [['l1', 315000, 'd1'], ['l2', 250000, 'd2']] as const) {
      await createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: `Heizöl ${id}`, amountCents, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: 'heating', fuelDeliveryId: d })
    }
  })
  await ablesen(opened, (['a', 'b', 'c'] as const).flatMap((u, i): [string, string, null, string, number][] => [[u, 'waerme', null, '2024-12-31', 0], [u, 'waerme', null, '2025-12-31', heat[i] ?? 0]]))
  return snapshotFor(await opened.read(readStock), 'objekt-1', P2025())
}

test('F17 Heizöl mit Vorrat: 5.750,00 € nach Verbrauch, Überträge durch die Verordnung, L = 518,48 €', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await f17(opened, false, [10000, 12000, 8000]))
    assert.ok(!s.notices.some((n) => n.level === 'error'), s.notices.map((n) => n.code).join(', '))
    assert.deepEqual(['ta', 'tb', 'tc'].map((t) => summe(s, t)), [191666, 218500, 164834])
    const key = `stock:hp:${periodKey('2025-01')}`
    assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === key)?.landlordParts, [{ reason: 'fuelCarry', cents: -10000 }])
    assert.deepEqual(['ta', 'tb', 'tc'].map((t) => entlastung(s, t)), [-17283, -19702, -14863])
    assert.equal(s.totalCostsCents, 565000)
  })
})

test('F17 mit ⅓ Eigennutzung (N8): Abrechnung 1.916,68 € (exakt 1.916,67 €), Steuer 1.883,33 €, Abstand = Eigenanteil an den Überträgen', async () => {
  await withDatabase(async (opened) => {
    const snap = await f17(opened, true, [10000, 10000, 10000])
    const s = computeSettlement(snap)
    // Je Zeile nach #202 gerundet, Restcent bei Gleichstand an den Vermieter (README, Abweichung 20).
    assert.equal(s.selfUsedShareCents, 191668)
    const tax = taxReport(snap)
    const privat = tax.expenses.items.filter((x) => x.costItemId === 'l1' || x.costItemId === 'l2').reduce((a, x) => a + x.privateCents, 0)
    assert.equal(privat, 188333)
    assert.equal(stockCarrySelfCents(s), 3334)
    assert.equal(tax.expenses.stockCarrySelfCents, 3334)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix server test -- test/heating-golden.test.ts`
Expected: PASS (die Tests aus PR 6 bis PR 9 und die drei neuen). Weicht eine Zahl ab, wird nicht die
Erwartung angepasst: Die README rechnet von Hand, auch die Rundung je Zeile, und die Abweichung ist
ein Befund, der in Task 3, 4, 8 oder 9 (oder in `distributeCents`, PR 2) zu suchen ist.

- [ ] **Step 5: Commit**

```bash
git add server/test/heating-golden.test.ts server/test/fixtures/heating/F16-eigene-heizkostenabrechnung server/test/fixtures/heating/F17-heizoel-mit-vorrat
git commit -m "Heizkostenabrechnung: Golden F16 (Beispiel A) und F17 (Heizöl mit Vorrat, ⅓ Eigennutzung)

Refs #99"
```

---

### Task 11: Oberfläche: Einrichtung Schritt 6 (Wärmepumpe) und Schritt 7 (eigene Abrechnung)

„Ich selbst, mit Zählern oder Heizkostenverteilern“ wird wählbar (Entwurf 11.2, Abweichung 21). Schritt 6
fragt bei einer Wärmepumpe zusätzlich, ob sie erst nach dem Stichtag eingebaut wurde (Abweichung 1),
Schritt 7 fragt Warmwasser, Erfassung, Anteil mit § 7 Abs. 1 Satz 2, Grundkosten nach Wohnfläche oder
beheizter Fläche, Zähler an der Anlage und, wenn der Server sie mit 409 nennt, Teil und Ziel jeder
offenen Heizposition.

**Files:**
- Create: `client/src/heatingSelfForm.ts`, `client/src/heatingSelfForm.test.ts`, `client/src/components/HeatingSelfSetup.tsx`, `client/src/components/HeatingSelfSetup.test.tsx`
- Modify: `client/src/heatingForm.ts`, `client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.tsx`

**Interfaces:**
- Consumes (Task 1, 2, 6; PR 4): `hkvConsumptionShare`, `hkvConsumptionShareForced`, `hkvHeatPumpCapture`, `valueAt`, `germanDate`, `LAW_AS_OF`; Typen `HotWater`, `CaptureMethod`, `AreaBasisHeat`, `HeatingTarget`, `HeatingPart`, `InsulationRule`, `HeatingEnergy`, `HeatingPlant`; `PUT /api/heating-plants/:id/self` (200, 400, 409 `{ error, items }`); `ApiError` (`client/src/api.ts`, #170); `HeatingForm`, `heatingPlantBody`, `heatingToForm`, `whoHint`, `CAPTURE_OPTIONS`, `CaptureAnswer` (PR 4).
- Produces:
  - `heatingSelfForm.ts`: `SelfItemRow`, `SelfSetupForm`, `SelfSetupBody`, `HOT_WATER_OPTIONS`, `CAPTURE_SELF_OPTIONS`, `PART_OPTIONS`, `targetOptions(hotWater, part)`, `kwhEnergy(energy)`, `shareBounds()`, `forcedShare(energy, insulation)`, `emptySelfSetup(plant, period)`, `itemsFromConflict(data)`, `selfSetupBody(form, energy)`
  - `HeatingSelfSetup({ plant, period, onDone, onCancel })`
  - heatingForm.ts: `CaptureAnswer` + `'newer'`, `HeatingForm.heatPumpInstalledOn`, `HeatingResult` `{ body, setUpSelf: boolean }`, `NEWER_THAN`

- [ ] **Step 1: Write the failing tests**

`client/src/heatingSelfForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptySelfSetup, forcedShare, itemsFromConflict, selfSetupBody, shareBounds, targetOptions, type SelfSetupForm } from './heatingSelfForm'
import type { HeatingPlant } from './types'

const plant = { id: 'hp', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' } as Pick<HeatingPlant, 'id' | 'energy' | 'hotWater' | 'capture' | 'areaBasisHeat'>
const filled = (over: Partial<SelfSetupForm> = {}): SelfSetupForm => ({ ...emptySelfSetup(plant, '2025-01'), share: '70', waterShare: '70', insulation: 'notApplies', ...over })

describe('Einrichtung Schritt 7 (Heizung PR 10)', () => {
  it('Vorgaben: Warmwasser über die Anlage, Wärmezähler, Wohnfläche, Wärmezähler am Speicher', () => {
    const f = emptySelfSetup(plant, '2025-01')
    expect([f.hotWater, f.capture, f.areaBasisHeat, f.dhwHeatMeter, f.totalHeatMeter, f.share, f.waterShare]).toEqual(['combined', 'heatMeter', 'area', true, false, '', ''])
  })
  it('Anteil: Grenzen aus dem Register, mit Satz', () => {
    const { min, max } = shareBounds()
    expect([min, max]).toEqual([50, 70])
    expect(selfSetupBody(filled({ share: '' }), 'gas')).toEqual({ error: expect.stringMatching(/zwischen 50 und 70 %/) })
    expect(selfSetupBody(filled({ share: '45' }), 'gas')).toEqual({ error: expect.stringMatching(/mindestens 50 %/) })
    expect(selfSetupBody(filled({ share: '80' }), 'gas')).toEqual({ error: expect.stringMatching(/§ 10 HeizkostenV.*späteren Version/) })
  })
  it('§ 7 Abs. 1 Satz 2: bei Öl oder Gas und Wärmeschutz vor 1994 sind es 70 %, sonst gilt die Wahl', () => {
    expect(forcedShare('gas', 'applies')).toBe(70)
    expect(forcedShare('lpg', 'applies')).toBe(70)
    expect(forcedShare('districtHeating', 'applies')).toBeNull()
    expect(forcedShare('gas', 'unknown')).toBeNull()
    // Vorgeschrieben: das Feld zeigt den Pflichtanteil und sendet ihn, auch wenn nichts eingetippt ist.
    const pflicht = selfSetupBody(filled({ share: '', insulation: 'applies' }), 'gas')
    expect('body' in pflicht && pflicht.body.heatConsumptionPct).toBe(70)
  })
  it('§ 8 Abs. 1: der Anteil beim Warmwasser ist eine eigene Angabe (Abweichung 14)', () => {
    expect(selfSetupBody(filled({ waterShare: '' }), 'gas')).toEqual({ error: expect.stringMatching(/Warmwasser.*§ 8 Abs\. 1/) })
    const anders = selfSetupBody(filled({ waterShare: '50' }), 'gas')
    expect('body' in anders && [anders.body.heatConsumptionPct, anders.body.waterConsumptionPct]).toEqual([70, 50])
    const ohne = selfSetupBody(filled({ hotWater: 'none', waterShare: '' }), 'gas')
    expect('body' in ohne && ohne.body.waterConsumptionPct).toBeNull()
  })
  it('Warmwasser über die Anlage nur bei Abrechnung in kWh (Abweichung 10)', () => {
    expect(selfSetupBody(filled(), 'oil')).toEqual({ error: expect.stringMatching(/Heizwert.*späteren Version/) })
    expect(emptySelfSetup({ ...plant, energy: 'oil' }, '2025-01').hotWater).toBe('')
    expect('body' in selfSetupBody(filled({ hotWater: 'none' }), 'oil')).toBe(true)
  })
  it('Erfassung mit Heizkostenverteilern oder Werten eines Ablesedienstes: noch gesperrt', () => {
    expect(selfSetupBody(filled({ capture: 'hca' }), 'gas')).toEqual({ error: expect.stringMatching(/späteren Version/) })
  })
  it('Ziel passt zur Warmwasserbereitung; Brennstoff bei verbundener Bereitung nur „beides“', () => {
    expect(targetOptions('combined', 'fuel').map((o) => o.value)).toEqual(['both'])
    expect(targetOptions('combined', 'metering').map((o) => o.value)).toEqual(['both', 'heating', 'water'])
    expect(targetOptions('separate', 'operating').map((o) => o.value)).toEqual(['heating', 'water'])
    expect(targetOptions('none', 'fuel').map((o) => o.value)).toEqual(['heating'])
  })
  it('Positionen aus der 409-Antwort: Teil vorbelegt, Ziel nach der Warmwasserbereitung', () => {
    const items = itemsFromConflict({ error: 'x', items: [{ id: 'c1', period: '2025-01', description: 'Gas', amountCents: 600000, key: 'area', heatingPart: 'fuel' }, { id: 'c2', period: '2025-01', description: 'Wartung', amountCents: 24000, key: 'area', heatingPart: null }] })
    expect(items).toEqual([
      { id: 'c1', description: 'Gas', amountCents: 600000, heatingPart: 'fuel', heatingTarget: '' },
      { id: 'c2', description: 'Wartung', amountCents: 24000, heatingPart: '', heatingTarget: '' },
    ])
    expect(itemsFromConflict({ error: 'x' })).toBeNull()
    const form = filled({ items: items ?? [] })
    expect(selfSetupBody(form, 'gas')).toEqual({ error: expect.stringMatching(/„Gas“.*Ziel/) })
    const [gas, wartung] = form.items
    if (!gas || !wartung) throw new Error('zwei Positionen erwartet')
    const done = selfSetupBody({ ...form, items: [{ ...gas, heatingTarget: 'both' }, { ...wartung, heatingPart: 'operating', heatingTarget: 'both' }] }, 'gas')
    expect(done).toEqual({ body: {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area',
      dhwHeatMeter: true, totalHeatMeter: false,
      items: [{ id: 'c1', heatingPart: 'fuel', heatingTarget: 'both' }, { id: 'c2', heatingPart: 'operating', heatingTarget: 'both' }],
    } })
  })
})
```

In `client/src/heatingForm.test.ts` die beiden Zusicherungen zu `'self'` (PR 4: `whoHint('self', 'mfh')`
mit `/späteren Version/` und `heatingPlantBody` mit `who: 'self'` als Fehler) ersetzen durch:

```ts
  it('„Ich selbst“: die Anlage entsteht zunächst bei „Niemand“, Schritt 7 stellt sie um (Abweichung 21)', () => {
    expect(whoHint('self', 'mfh')).toMatch(/Wärmezähler und Warmwasserzähler/)
    expect(whoHint('self', 'mfh')).not.toMatch(/späteren Version/)
    const r = heatingPlantBody({ ...emptyHeatingForm(units), energy: 'gas', who: 'self' }, units)
    expect(r).toEqual({ body: expect.objectContaining({ method: 'manual' }), setUpSelf: true })
  })
  it('Wärmepumpe erst nach dem Stichtag eingebaut: Einbaudatum statt Erfassung (§ 12 Abs. 3, Abweichung 1)', () => {
    const base = { ...emptyHeatingForm(units), energy: 'heatPump' as const, who: 'manual' as const, captured: 'newer' as const }
    expect(heatingPlantBody(base, units)).toEqual({ error: expect.stringMatching(/Einbaudatum/) })
    expect(heatingPlantBody({ ...base, heatPumpInstalledOn: '2024-09-01' }, units)).toEqual({ error: expect.stringMatching(/nach dem 01\.10\.2024/) })
    const ok = heatingPlantBody({ ...base, heatPumpInstalledOn: '2025-03-01' }, units)
    expect(ok).toEqual({ body: expect.objectContaining({ capturedOnOct2024: null, captureInstalledOn: null, heatPumpInstalledOn: '2025-03-01' }), setUpSelf: false })
  })
```

`client/src/components/HeatingSelfSetup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingSelfSetup from './HeatingSelfSetup'
import type { HeatingPlant } from '../types'

const plant = { id: 'hp', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' } as HeatingPlant
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('HeatingSelfSetup', () => {
  it('nennt bei 409 die Positionen und schickt Teil und Ziel beim zweiten Versuch mit', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return new Response(JSON.stringify({ error: 'Für diese Heizposition braucht die eigene Abrechnung Teil und Ziel: „Gas“.', items: [{ id: 'c1', period: '2025-01', description: 'Gas', amountCents: 600000, key: 'area', heatingPart: 'fuel' }] }), { status: 409 })
      }
      return new Response(JSON.stringify({ plant: { ...plant, method: 'self' }, created: [], converted: 1 }), { status: 200 })
    })
    const onDone = vi.fn()
    render(<HeatingSelfSetup plant={plant} period="2025-01" onDone={onDone} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Warmwasser in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Wärmeschutz/), { target: { value: 'notApplies' } })
    fireEvent.click(screen.getByRole('button', { name: 'Umstellen' }))
    await screen.findByText(/„Gas“/)
    const ziel = screen.getByLabelText(/Ziel für „Gas“/) as HTMLSelectElement
    // Der angezeigte Wert entspricht dem gespeicherten: bei verbundener Bereitung nur „beides“.
    expect([...ziel.options].map((o) => o.value)).toEqual(['', 'both'])
    fireEvent.change(ziel, { target: { value: 'both' } })
    fireEvent.click(screen.getByRole('button', { name: 'Umstellen' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toMatchObject({ items: [{ id: 'c1', heatingPart: 'fuel', heatingTarget: 'both' }] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingSelfForm heatingForm HeatingSelfSetup`
Expected: FAIL; `heatingSelfForm` und `HeatingSelfSetup` fehlen, `whoHint('self')` nennt die spätere
Version.

- [ ] **Step 3: Logik (`client/src/heatingSelfForm.ts`)**

```ts
// Einrichtung Schritt 7: eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 11.2), ohne DOM prüfbar
// (heatingSelfForm.test.ts). Was der Server prüft, prüft er weiter; hier stehen die Sätze, bevor
// gesendet wird, und die Auswahl, die zum Gespeicherten passt.
import type { AreaBasisHeat, CaptureMethod, HeatingEnergy, HeatingPart, HeatingPlant, HeatingTarget, HotWater, InsulationRule } from './types'
import { hkvConsumptionShare, hkvConsumptionShareForced } from '../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

export type SelfItemRow = { id: string; description: string; amountCents: number; heatingPart: HeatingPart | ''; heatingTarget: HeatingTarget | '' }
export type SelfSetupForm = {
  period: string
  hotWater: HotWater | ''
  capture: CaptureMethod
  share: string
  // Anteil beim Warmwasser, eine eigene Wahl (§ 8 Abs. 1, Abweichung 14)
  waterShare: string
  insulation: InsulationRule | ''
  areaBasisHeat: AreaBasisHeat
  dhwHeatMeter: boolean
  totalHeatMeter: boolean
  items: SelfItemRow[]
}
export type SelfSetupBody = {
  period: string
  heatConsumptionPct: number
  waterConsumptionPct: number | null
  insulationRule: InsulationRule
  hotWater: HotWater
  capture: CaptureMethod
  areaBasisHeat: AreaBasisHeat
  dhwHeatMeter: boolean
  totalHeatMeter: boolean
  items: { id: string; heatingPart: HeatingPart; heatingTarget: HeatingTarget }[]
}

export const HOT_WATER_OPTIONS: { value: HotWater; label: string }[] = [
  { value: 'combined', label: 'Ja, die Heizung bereitet auch das Warmwasser' },
  { value: 'separate', label: 'Nein, das Warmwasser hat eine eigene Anlage, deren Kosten getrennt erfasst sind' },
  { value: 'none', label: 'Es gibt kein zentrales Warmwasser' },
]
export const CAPTURE_SELF_OPTIONS: { value: CaptureMethod; label: string; later: boolean }[] = [
  { value: 'heatMeter', label: 'Wärmezähler und Warmwasserzähler je Wohnung', later: false },
  { value: 'hca', label: 'Heizkostenverteiler an den Heizkörpern (kommt mit einer späteren Version)', later: true },
  { value: 'serviceValues', label: 'Werte eines Ablesedienstes (kommt mit einer späteren Version)', later: true },
]
export const PART_OPTIONS: { value: HeatingPart; label: string }[] = [
  { value: 'fuel', label: 'Brennstoff' },
  { value: 'operating', label: 'Betrieb (Strom, Wartung, Reinigung, Messung der Abgase)' },
  { value: 'metering', label: 'Erfassung (Miete der Zähler, Ablesung)' },
]
const TARGET_LABELS: Record<HeatingTarget, string> = { both: 'Heizung und Warmwasser', heating: 'nur Heizung', water: 'nur Warmwasser' }

// Die Ziele, die zur Warmwasserbereitung passen (dieselbe Regel wie `targetProblem` im Server).
export function targetOptions(hotWater: HotWater | '', part: HeatingPart | ''): { value: HeatingTarget; label: string }[] {
  const values: HeatingTarget[] = hotWater === '' ? []
    : hotWater === 'none' ? ['heating']
    : hotWater === 'separate' ? ['heating', 'water']
      : part === 'fuel' ? ['both'] : ['both', 'heating', 'water']
  return values.map((value) => ({ value, label: TARGET_LABELS[value] }))
}

// Abweichung 10: Warmwasser über die Anlage nur, wenn die Energie in kWh abgerechnet wird.
export const kwhEnergy = (energy: HeatingEnergy): boolean => ['gas', 'districtHeating', 'heatPump', 'electric'].includes(energy)
export const shareBounds = (): { min: number; max: number } => valueAt(hkvConsumptionShare, LAW_AS_OF)
// § 7 Abs. 1 Satz 2 (Abweichung 13: Flüssiggas zählt als Gas).
export function forcedShare(energy: HeatingEnergy, insulation: InsulationRule | ''): number | null {
  return insulation === 'applies' && ['oil', 'gas', 'lpg'].includes(energy) ? valueAt(hkvConsumptionShareForced, LAW_AS_OF) : null
}

export function emptySelfSetup(plant: Pick<HeatingPlant, 'energy' | 'hotWater' | 'capture' | 'areaBasisHeat'>, period: string): SelfSetupForm {
  return {
    period,
    // Ohne Abrechnung in kWh ist „verbunden“ gesperrt (Abweichung 10); dann fragt die Einrichtung, statt
    // still etwas anderes vorzubelegen.
    hotWater: kwhEnergy(plant.energy) ? (plant.hotWater ?? 'combined') : plant.hotWater === 'combined' ? '' : plant.hotWater,
    capture: plant.capture ?? 'heatMeter',
    share: '',
    waterShare: '',
    insulation: '',
    areaBasisHeat: plant.areaBasisHeat ?? 'area',
    dhwHeatMeter: true,
    totalHeatMeter: plant.energy === 'heatPump' || plant.energy === 'districtHeating',
    items: [],
  }
}

// Die Liste aus der Antwort 409 (`{ error, items }`), oder null, wenn die Antwort keine hat.
export function itemsFromConflict(data: Record<string, unknown>): SelfItemRow[] | null {
  if (!Array.isArray(data.items)) return null
  return data.items.flatMap((x: unknown): SelfItemRow[] => {
    if (x === null || typeof x !== 'object') return []
    const r = x as Record<string, unknown>
    if (typeof r.id !== 'string') return []
    const part = r.heatingPart === 'fuel' || r.heatingPart === 'operating' || r.heatingPart === 'metering' ? r.heatingPart : ''
    return [{ id: r.id, description: typeof r.description === 'string' ? r.description : r.id, amountCents: typeof r.amountCents === 'number' ? r.amountCents : 0, heatingPart: part, heatingTarget: '' }]
  })
}

export function selfSetupBody(form: SelfSetupForm, energy: HeatingEnergy): { body: SelfSetupBody } | { error: string } {
  const { min, max } = shareBounds()
  if (CAPTURE_SELF_OPTIONS.find((o) => o.value === form.capture)?.later) {
    return { error: 'Heizkostenverteiler und Werte eines Ablesedienstes kommen mit einer späteren Version. Bis dahin rechnet Mietfuchs mit Wärmezählern und Warmwasserzählern.' }
  }
  if (form.hotWater === '') return { error: 'Bitte beantworten Sie, ob die Heizung auch das Warmwasser bereitet.' }
  if (form.hotWater === 'combined' && !kwhEnergy(energy)) {
    return { error: 'Bereitet die Heizung auch das Warmwasser, braucht die Aufteilung den Heizwert des Brennstoffs laut Rechnung (§ 9 Abs. 3 HeizkostenV); das kommt mit einer späteren Version. Bis dahin geht es mit getrennter Warmwasserbereitung oder ohne zentrales Warmwasser.' }
  }
  if (form.insulation === '') return { error: 'Bitte beantworten Sie die Frage zum Wärmeschutz; „Weiß ich nicht“ ist eine Antwort.' }
  // Vorgeschrieben (§ 7 Abs. 1 Satz 2): das Feld zeigt den Pflichtanteil und ist gesperrt; gesendet
  // wird, was angezeigt ist.
  const forced = forcedShare(energy, form.insulation)
  const percent = (text: string): number | null => (text.trim() === '' ? null : Number(text.replace(',', '.')))
  const share = forced ?? percent(form.share)
  if (share === null || !Number.isFinite(share)) return { error: `Bitte geben Sie den Anteil nach Verbrauch an, zwischen ${min} und ${max} %.` }
  // § 8 Abs. 1: beim Warmwasser eine eigene Wahl; ohne zentrales Warmwasser keine (Abweichung 14).
  const water = form.hotWater === 'none' ? null : percent(form.waterShare)
  if (form.hotWater !== 'none' && (water === null || !Number.isFinite(water))) {
    return { error: `Bitte geben Sie auch den Anteil nach Verbrauch beim Warmwasser an, zwischen ${min} und ${max} % (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen.` }
  }
  for (const v of water === null ? [share] : [share, water]) {
    if (v < min) return { error: `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).` }
    if (v > max) return { error: `Mehr als ${max} % nach Verbrauch gehen nur mit einer Vereinbarung (§ 10 HeizkostenV); das kommt mit einer späteren Version.` }
  }
  const items: SelfSetupBody['items'] = []
  for (const row of form.items) {
    if (row.heatingPart === '') return { error: `„${row.description}“: Bitte wählen Sie den Teil (Brennstoff, Betrieb oder Erfassung).` }
    if (row.heatingTarget === '' || !targetOptions(form.hotWater, row.heatingPart).some((o) => o.value === row.heatingTarget)) {
      return { error: `„${row.description}“: Bitte wählen Sie das Ziel (Heizung und Warmwasser, nur Heizung oder nur Warmwasser).` }
    }
    items.push({ id: row.id, heatingPart: row.heatingPart, heatingTarget: row.heatingTarget })
  }
  return {
    body: {
      period: form.period, heatConsumptionPct: share, waterConsumptionPct: water, insulationRule: form.insulation, hotWater: form.hotWater, capture: form.capture,
      areaBasisHeat: form.areaBasisHeat, dhwHeatMeter: form.hotWater === 'combined' && form.dhwHeatMeter, totalHeatMeter: form.totalHeatMeter, items,
    },
  }
}
```

(Im Test zur 409-Liste steht `dhwHeatMeter: true`, denn dort ist das Warmwasser verbunden.)

- [ ] **Step 4: Schritt 2 und 6 (`client/src/heatingForm.ts`)**

`LATER_SELF` und seine beiden Verwendungen ersetzen:

```ts
const SELF_HINT = 'Sie lesen Wärmezähler und Warmwasserzähler jeder Wohnung ab, und Mietfuchs verteilt nach der Heizkostenverordnung. Nach dem Anlegen fragt Mietfuchs nach Warmwasser, Erfassung und dem Anteil nach Verbrauch; bis dahin ändert sich an keiner Zahl etwas.'
```

In `whoHint`: `if (who === 'self') return SELF_HINT`. In `heatingPlantBody` die Zeile
`if (who === 'self') return { error: LATER_SELF }` streichen. `CaptureAnswer` wird
`'unknown' | 'yes' | 'no' | 'newer'`, `HeatingForm` bekommt `heatPumpInstalledOn: string` (in
`emptyHeatingForm` `''`, in `heatingToForm` `plant.heatPumpInstalledOn ?? ''` und
`captured: plant.heatPumpInstalledOn !== null ? 'newer' : …`), `HeatingPlantBody` nimmt
`'heatPumpInstalledOn'` in sein `Pick` auf, und `HeatingResult` wird
`{ body: HeatingPlantBody; setUpSelf: boolean } | { error: string } | { none: string }`.

```ts
// Abweichung 1: der Stichtag aus dem Register (§ 12 Abs. 3 Satz 1 HeizkostenV).
export const NEWER_THAN = germanDate(valueAt(hkvHeatPumpCapture, LAW_AS_OF).capturedBy)
```

`CAPTURE_OPTIONS` bekommt als letzten Eintrag
`{ value: 'newer', label: \`Die Wärmepumpe ist erst nach dem ${NEWER_THAN} eingebaut worden\` }`
(`hkvHeatPumpCapture` in den Import aus `'../../shared/law/heizkostenv.ts'`). In `heatingPlantBody` vor
dem `return { body: … }`:

```ts
  const installedText = heatPump && form.captured === 'newer' ? form.heatPumpInstalledOn : ''
  if (heatPump && form.captured === 'newer') {
    if (installedText === '') return { error: 'Bitte geben Sie das Einbaudatum der Wärmepumpe an.' }
    if (installedText <= valueAt(hkvHeatPumpCapture, LAW_AS_OF).capturedBy) {
      return { error: `Eine Wärmepumpe, die bis zum ${NEWER_THAN} eingebaut wurde, beantworten Sie mit „Ja“ oder „Nein“.` }
    }
  }
```

Im Rumpf: `method: who === 'homeowners' || who === 'self' ? (who === 'self' ? 'manual' : 'service') : who`,
`capturedOnOct2024: heatPump && (form.captured === 'yes' || form.captured === 'no') ? form.captured === 'yes' : null`,
`heatPumpInstalledOn: installedText === '' ? null : installedText`, und das Ergebnis
`return { body: { … }, setUpSelf: who === 'self' }`. `heatingToForm` setzt bei `plant.method === 'self'`
`who: 'self'`, wie bisher aus `plant.method`.

- [ ] **Step 5: Komponente (`client/src/components/HeatingSelfSetup.tsx`)**

```tsx
import { useState } from 'react'
import type { HeatingPlant, HotWater, InsulationRule, AreaBasisHeat, CaptureMethod, HeatingPart, HeatingTarget } from '../types'
import { api, ApiError, errorText, fmtEuro } from '../api'
import Term from './Term'
import {
  CAPTURE_SELF_OPTIONS, HOT_WATER_OPTIONS, PART_OPTIONS, emptySelfSetup, forcedShare, itemsFromConflict, kwhEnergy, selfSetupBody, shareBounds, targetOptions,
} from '../heatingSelfForm'

// Einrichtung Schritt 7 (Heizung PR 10, Entwurf 11.2). Antwortet der Server mit 409, nennt er die
// Heizpositionen offener Zeiträume, die Teil und Ziel brauchen; sie erscheinen unter den Fragen, und
// der zweite Versuch schickt sie mit. Bricht der Vermieter ab, bleibt die Anlage bei „Niemand“.
export default function HeatingSelfSetup({ plant, period, onDone, onCancel }: {
  plant: HeatingPlant; period: string; onDone: (p: HeatingPlant) => void; onCancel: () => void
}) {
  const [form, setForm] = useState(() => emptySelfSetup(plant, period))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { min, max } = shareBounds()
  const forced = forcedShare(plant.energy, form.insulation)

  async function submit() {
    const result = selfSetupBody(form, plant.energy)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setBusy(true)
    try {
      const done = await api<{ plant: HeatingPlant; created: unknown[]; converted: number }>(`/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify(result.body) })
      setError('')
      onDone(done.plant)
    } catch (e) {
      const items = e instanceof ApiError && e.status === 409 ? itemsFromConflict(e.data) : null
      if (items) setForm({ ...form, items: items.map((x) => form.items.find((y) => y.id === x.id) ?? x) })
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3><Term id="heatingSystem">Heizkosten selbst abrechnen</Term></h3>
      {error && <div className="error">{error}</div>}
      <label className="field grow">
        Bereitet diese Heizung auch das Warmwasser?
        <select value={form.hotWater} onChange={(e) => setForm({ ...form, hotWater: e.target.value as HotWater | '' })}>
          {form.hotWater === '' && <option value="">Bitte wählen</option>}
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={o.value === 'combined' && !kwhEnergy(plant.energy)}>{o.label}</option>)}
        </select>
      </label>
      <label className="field grow">
        Womit wird der Verbrauch erfasst?
        <select value={form.capture} onChange={(e) => setForm({ ...form, capture: e.target.value as CaptureMethod })}>
          {CAPTURE_SELF_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={o.later}>{o.label}</option>)}
        </select>
      </label>
      <label className="field grow">
        Hat das Haus einen Wärmeschutz unter dem Niveau von 1994, und sind die Leitungen überwiegend gedämmt?
        <select value={form.insulation} onChange={(e) => setForm({ ...form, insulation: e.target.value as InsulationRule | '' })}>
          <option value="">Bitte wählen</option>
          <option value="applies">Ja, beides</option>
          <option value="notApplies">Nein</option>
          <option value="unknown">Weiß ich nicht</option>
        </select>
      </label>
      <p><Term id="consumptionCosts">Anteil nach Verbrauch</Term> ({min} bis {max} %), für Heizung und Warmwasser je eine Wahl:</p>
      <label className="field">
        Heizung in %
        <input inputMode="decimal" value={forced !== null ? String(forced) : form.share} disabled={forced !== null}
          onChange={(e) => setForm({ ...form, share: e.target.value, waterShare: form.waterShare === '' || form.waterShare === form.share ? e.target.value : form.waterShare })} />
      </label>
      {form.hotWater !== 'none' && (
        <label className="field">
          Warmwasser in %
          <input inputMode="decimal" value={form.waterShare} onChange={(e) => setForm({ ...form, waterShare: e.target.value })} />
        </label>
      )}
      {forced !== null && <p className="muted">Bei Öl- oder Gasheizung in diesem Fall sind es {forced} % (§ 7 Abs. 1 Satz 2 HeizkostenV).</p>}
      <label className="field grow">
        <Term id="baseCosts">Grundkosten</Term> der Heizung verteilen nach
        <select value={form.areaBasisHeat} onChange={(e) => setForm({ ...form, areaBasisHeat: e.target.value as AreaBasisHeat })}>
          <option value="area">Wohnfläche</option>
          <option value="heatedArea">beheizter Fläche (je Wohnung in der Heizanlage einzutragen)</option>
        </select>
      </label>
      {form.hotWater === 'combined' && (
        <label className="check">
          <input type="checkbox" checked={form.dhwHeatMeter} onChange={(e) => setForm({ ...form, dhwHeatMeter: e.target.checked })} />
          Am Warmwasserspeicher misst ein Wärmezähler die Wärme für das Warmwasser
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={form.totalHeatMeter} onChange={(e) => setForm({ ...form, totalHeatMeter: e.target.checked })} />
        Ein Wärmezähler misst die gesamte Wärme der Anlage (bei Wärmepumpe und Fernwärme üblich)
      </label>
      {form.items.length > 0 && (
        <>
          <p>Diese Heizpositionen offener Zeiträume brauchen Teil und Ziel:</p>
          {form.items.map((row, i) => {
            const set = (patch: Partial<typeof row>) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            const targets = targetOptions(form.hotWater, row.heatingPart)
            return (
              <div className="row" key={row.id}>
                <span className="grow">„{row.description}“ · {fmtEuro(row.amountCents)}</span>
                <label className="field">
                  Teil für „{row.description}“
                  <select value={row.heatingPart} onChange={(e) => set({ heatingPart: e.target.value as HeatingPart | '', heatingTarget: '' })}>
                    <option value="">Bitte wählen</option>
                    {PART_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  Ziel für „{row.description}“
                  <select value={targets.some((o) => o.value === row.heatingTarget) ? row.heatingTarget : ''} onChange={(e) => set({ heatingTarget: e.target.value as HeatingTarget | '' })}>
                    <option value="">Bitte wählen</option>
                    {targets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            )
          })}
        </>
      )}
      <p className="muted">Mietfuchs legt fehlende Zähler an (Wärme und, wenn es zentrales Warmwasser gibt, Warmwasser je Wohnung). Die Stände tragen Sie auf der Seite Zähler ein.</p>
      <div className="row">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Später</button>
        <span className="spacer" />
        <button className="btn" onClick={submit} disabled={busy}>Umstellen</button>
      </div>
    </div>
  )
}
```

(`HeatingPlant.energy` ist bei `perUnit` nie gesetzt; der Typ `HeatingEnergy` passt für
`kwhEnergy`.)

- [ ] **Step 6: Karte (`client/src/components/HeatingCard.tsx`)**

Zustand `const [selfFor, setSelfFor] = useState<HeatingPlant | null>(null)` und die Periode des
Objekts aus `usePeriod()` (PR 5). In `save()`:

```ts
    let saved: HeatingPlant
    try {
      saved = editingId
        ? await api<HeatingPlant>(`/api/heating-plants/${editingId}`, { method: 'PUT', body: JSON.stringify(result.body) })
        : (await api<{ plant: HeatingPlant }>(withProperty('/api/heating-plants', propertyId), {
          method: 'POST', body: JSON.stringify({ ...result.body, assignItemIds: assignable.map((i) => i.id) }),
        })).plant
    } catch (e) {
      setError(errorText(e))
      return
    }
    const created = editingId === null
    close()
    await load()
    if (result.setUpSelf && saved.method !== 'self') {
      setSelfFor(saved)
      return
    }
    toast(created ? 'Heizung eingerichtet. An Ihren Beträgen ändert sich nichts.' : 'Heizung gespeichert.')
```

(Die Antwort von `POST` hat PR 4 als `{ plant, assigned }` festgelegt, die von `PUT` als die Anlage;
die ausführende Sitzung gleicht das mit dem Code von PR 4 ab.) Beim Speichern einer Anlage mit
`method = 'self'` schickt die Karte `method` nicht mit (der Server lehnt `self` über die allgemeine
Route ab, Abweichung 17): in `save()` vor dem `PUT`
`const body = editingId && result.setUpSelf ? (({ method: _m, ...rest }) => rest)(result.body) : result.body`.
Wird von „Ich selbst“ auf „Niemand“ umgestellt und antwortet der Server mit 409, fragt die Karte:

```ts
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.data.items)) {
        const ok = await confirm({
          title: 'Positionen nach Wohnfläche verteilen?',
          message: `${errorText(e)} Ohne eigene Heizkostenabrechnung verteilt Mietfuchs diese Positionen nach Wohnfläche; Sie können den Schlüssel danach auf der Seite Kosten ändern.`,
          confirmLabel: 'Umstellen',
        })
        if (!ok) return
        await api(`/api/heating-plants/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...body, convertItems: 'area' }) })
      }
```

Unter der Zusammenfassung einer Anlage:

```tsx
          {selfFor?.id === p.id && (
            <HeatingSelfSetup plant={p} period={period.key} onCancel={() => setSelfFor(null)}
              onDone={async () => { setSelfFor(null); await load(); toast('Eigene Heizkostenabrechnung eingerichtet. Tragen Sie die Zählerstände auf der Seite Zähler ein.') }} />
          )}
```

Jede Anlage mit `method = 'manual'` neben „Ändern“ den
Knopf `<button className="btn ghost" onClick={() => setSelfFor(p)}>Selbst abrechnen</button>`, damit
ein abgebrochener Schritt 7 wieder erreichbar ist. In der Schrittfolge der Einrichtung bekommt Schritt
6 bei `form.captured === 'newer'` ein Datumsfeld „Einbaudatum der Wärmepumpe“
(`<input type="date" value={form.heatPumpInstalledOn} …>`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingSelfForm heatingForm HeatingSelfSetup HeatingCard && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/heatingSelfForm.ts client/src/heatingSelfForm.test.ts client/src/heatingForm.ts client/src/heatingForm.test.ts client/src/components/HeatingSelfSetup.tsx client/src/components/HeatingSelfSetup.test.tsx client/src/components/HeatingCard.tsx
git commit -m "Heizkostenabrechnung: Einrichtung Schritt 7 und Einbaudatum der Wärmepumpe

Die Anlage entsteht bei „Niemand“, Schritt 7 stellt sie in einer Transaktion um, mit Teil und Ziel
jeder offenen Heizposition, die der Server nennt.

Refs #99"
```

---

### Task 12: Oberfläche: Kostenformular (Schlüssel, Teil, Ziel) und Mieterwechsel (Ablesedatum, keine Zwischenablesung)

Eine Heizposition einer Anlage mit eigener Abrechnung hat immer den Schlüssel „nach
Heizkostenverordnung“, einen Teil und ein Ziel (Abweichung 18); bei freien Schlüsseln kann sie „nur
Heizung“ sein, dann teilen die Gradtage beim Mieterwechsel (Abweichung 16). Der Mieterwechsel fragt
bei Wohnungen einer solchen Anlage das Ablesedatum je Zähler und, wenn ein Stand fehlt, warum
(Entwurf 3.5, Abweichung 8).

**Files:**
- Modify: `shared/costItem.ts`, `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`, `client/src/tenantChange.ts`, `client/src/pages/Stammdaten.tsx`
- Test: `client/src/costForm.test.ts`, `client/src/pages/Kosten.test.tsx`, `client/src/tenantChange.test.ts`

**Interfaces:**
- Consumes (Task 2, 6, 11): `HeatingTarget`, `HeatingPart`, `InterimGapStatus`, `HeatingPlant.method`, `targetOptions`, `PART_OPTIONS` (heatingSelfForm.ts); `CostItemDraft`, `CostItemBody`, `costItemBody` (shared/costItem.ts, PR 3); `ItemForm`, `itemToForm`, `draftOf`, `costKeyOptions`, `defaultKeyFor`, `EMPTY_ITEM_FORM` (costForm.ts); `buildTenantChange`, `TenantChangeBody` (tenantChange.ts, #150); `POST /api/tenancies/:id/change` mit `readings[].date` und `interimGap` (Task 5).
- Produces:
  - `CostItemDraft.heatingTarget: HeatingTarget | null`, `CostItemBody.heatingTarget: HeatingTarget | null`
  - `ItemForm.heatingPartSelf: HeatingPart | ''`, `ItemForm.heatingTarget: HeatingTarget | ''`
  - `costKeyOptions(unitMeterTypes, stored, selfPlant = false)`; `defaultKeyFor(…, selfPlant)` liefert bei Heizkosten einer Anlage mit eigener Abrechnung `'heatingSystem'`
  - `heatingTargetOptions(selfPlant, hotWater, part)`
  - tenantChange.ts: `TenantChangeBody.readings[].date?`, `TenantChangeBody.interimGap?`, `INTERIM_FEE_HINT`, Eingaben `meterDates`, `heatMeterIds`, `interimGap`

- [ ] **Step 1: Write the failing tests**

An `client/src/costForm.test.ts` anhängen (Importe ergänzen: `heatingTargetOptions`, `draftOf`,
`itemToForm`, `EMPTY_ITEM_FORM`, soweit nicht da; `costItemBody` aus `'../../shared/costItem.ts'`):

```ts
describe('Eigene Heizkostenabrechnung im Kostenformular (Heizung PR 10)', () => {
  it('bei einer Anlage mit eigener Abrechnung gibt es nur den Schlüssel nach Heizkostenverordnung', () => {
    expect(costKeyOptions([], 'area', true)).toEqual(['heatingSystem'])
    expect(costKeyOptions([], 'area', false)).not.toContain('heatingSystem')
    expect(costKeyOptions(['waerme'], 'heatingSystem', false)).toContain('heatingSystem')
  })
  it('Ziel: bei eigener Abrechnung nach der Warmwasserbereitung, bei freien Schlüsseln „beides“ oder „nur Heizung“', () => {
    expect(heatingTargetOptions(true, 'combined', 'fuel').map((o) => o.value)).toEqual(['both'])
    expect(heatingTargetOptions(true, 'separate', 'metering').map((o) => o.value)).toEqual(['heating', 'water'])
    expect(heatingTargetOptions(false, 'combined', '').map((o) => o.value)).toEqual(['', 'heating'])
  })
  it('Teil und Ziel gehen in den Rumpf, nur bei Heizkosten; eine kalte Position verliert beides', () => {
    const heiz = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', description: 'Wartung', amount: '240,00', key: 'heatingSystem' as const, heatingPartSelf: 'operating' as const, heatingTarget: 'both' as const }
    const r = costItemBody(draftOf(heiz))
    expect('body' in r && [r.body.key, r.body.heatingPart, r.body.heatingTarget]).toEqual(['heatingSystem', 'operating', 'both'])
    const kalt = costItemBody(draftOf({ ...heiz, category: 'Müllabfuhr', key: 'area' }))
    expect('body' in kalt && [kalt.body.heatingPart, kalt.body.heatingTarget]).toEqual([null, null])
    const nurHeizung = costItemBody(draftOf({ ...heiz, key: 'area', heatingPartSelf: '', heatingFuel: true, heatingTarget: 'heating' }))
    expect('body' in nurHeizung && [nurHeizung.body.heatingPart, nurHeizung.body.heatingTarget]).toEqual(['fuel', 'heating'])
  })
  it('itemToForm liest Teil und Ziel zurück', () => {
    const f = itemToForm({ id: 'c', propertyId: 'p', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 1, key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: 'both' } as Parameters<typeof itemToForm>[0])
    expect([f.heatingPartSelf, f.heatingTarget, f.heatingFuel]).toEqual(['fuel', 'both', true])
  })
})
```

An `client/src/pages/Kosten.test.tsx` anhängen (Muster der vorhandenen Tests zu Auswahlfeldern):

```tsx
test('Ziel einer Heizposition: der angezeigte Wert entspricht dem gespeicherten (Heizung PR 10)', async () => {
  // Anlage mit eigener Abrechnung, verbundene Warmwasserbereitung; gespeichert ist Brennstoff mit „beides“.
  mockApi({
    '/api/heating-plants': [{ id: 'hp', propertyId: 'objekt-1', method: 'self', hotWater: 'combined', energy: 'gas', units: null }],
    '/api/costItems': [{ id: 'c1', propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 600000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: 'both' }],
  })
  await openItem('Gas')
  const ziel = screen.getByLabelText('Ziel') as HTMLSelectElement
  expect(ziel.value).toBe('both')
  expect([...ziel.options].map((o) => o.value)).toEqual(['both'])
  const schluessel = screen.getByLabelText('Schlüssel') as HTMLSelectElement
  expect(schluessel.value).toBe('heatingSystem')
  expect([...schluessel.options].map((o) => o.value)).toEqual(['heatingSystem'])
})
```

(`mockApi` und `openItem` sind die Helfer der Datei; heißen sie dort anders, die vorhandenen nehmen.)

An `client/src/tenantChange.test.ts` anhängen:

```ts
describe('Mieterwechsel bei eigener Heizkostenabrechnung (Heizung PR 10)', () => {
  const heat = { heatMeterIds: ['m1'], meterDates: {}, interimGap: null }
  test('Ablesedatum je Zähler geht mit, leer heißt Auszugstag', () => {
    const r = buildTenantChange({ ...input(), ...heat, meterDates: { m1: '2025-07-03' } })
    expect('body' in r && r.body.readings).toEqual([{ meterId: 'm1', value: 123.5, date: '2025-07-03' }])
  })
  test('fehlt ein Stand eines Wärme- oder Warmwasserzählers, braucht es den Grund', () => {
    const ohne = { ...input({ meterValues: { m1: '', m2: '' } }), ...heat }
    expect(buildTenantChange(ohne)).toEqual({ error: expect.stringMatching(/nicht möglich.*nicht durchgeführt/) })
    const mit = buildTenantChange({ ...ohne, interimGap: { status: 'impossible', reason: 'Mieter nicht erreichbar' } })
    expect('body' in mit && mit.body.interimGap).toEqual({ status: 'impossible', reason: 'Mieter nicht erreichbar' })
  })
  test('ohne eigene Heizkostenabrechnung bleibt alles wie bisher', () => {
    const r = buildTenantChange(input({ meterValues: { m1: '', m2: '' } }))
    expect('body' in r && r.body).not.toHaveProperty('interimGap')
  })
  test('der Hinweis zu den Kosten der Zwischenablesung nennt das Urteil', () => {
    expect(INTERIM_FEE_HINT).toMatch(/VIII ZR 19\/07/)
  })
})
```

(`INTERIM_FEE_HINT` in den Import aus `'./tenantChange'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- costForm Kosten tenantChange`
Expected: FAIL; `heatingTargetOptions`, `heatingPartSelf` und `INTERIM_FEE_HINT` fehlen,
`costKeyOptions` nimmt kein drittes Argument.

- [ ] **Step 3: `shared/costItem.ts`**

`HeatingTarget` in den Typimport aus `'./types.ts'`. In `CostItemDraft` und `CostItemBody` hinter
`heatingPart`:

```ts
  // Ziel bei Heizkosten (Heizung PR 10): Heizung und Warmwasser, nur Heizung oder nur Warmwasser.
  heatingTarget: HeatingTarget | null
```

In `costItemBody`, in `common` hinter `heatingPart`:

```ts
    heatingTarget: d.category === HEATING_CATEGORY ? d.heatingTarget : null,
```

und die Teil-Regel von PR 3 erweitern: `heatingPart: d.category === HEATING_CATEGORY ? d.heatingPart : null`
bleibt; bei `d.key === 'heatingSystem'` vor `const common = {`:

```ts
  // Nach Heizkostenverordnung: Teil und Ziel sind Pflicht (dieselbe Regel wie `targetProblem` im Server).
  if (d.key === 'heatingSystem' && (d.heatingPart === null || d.heatingTarget === null)) {
    return { error: `Für „${d.description.trim()}“ fehlt ${d.heatingPart === null ? 'der Teil (Brennstoff, Betrieb oder Erfassung)' : 'das Ziel (Heizung und Warmwasser, nur Heizung oder nur Warmwasser)'}.` }
  }
```

`server/src/assessment.ts`, `lineDraft`: `heatingTarget: null` neben `heatingPart: null`.

- [ ] **Step 4: `client/src/costForm.ts`**

In `ItemForm` hinter `heatingFuel`:

```ts
  // Teil bei eigener Heizkostenabrechnung (Brennstoff, Betrieb, Erfassung) und Ziel (Heizung PR 10).
  // Leer heißt keine Angabe; bei freien Schlüsseln bleibt „Brennstoff/Energie“ das Merkmal von PR 3.
  heatingPartSelf: HeatingPart | ''
  heatingTarget: HeatingTarget | ''
```

`EMPTY_ITEM_FORM`: `heatingPartSelf: '', heatingTarget: ''`. `itemToForm`:
`heatingPartSelf: i.key === 'heatingSystem' ? (i.heatingPart ?? '') : '', heatingTarget: i.heatingTarget ?? '',`.
`draftOf`:

```ts
    heatingPart: form.key === 'heatingSystem' ? (form.heatingPartSelf || null) : form.heatingFuel ? 'fuel' : null,
    heatingTarget: form.heatingTarget || null,
```

`costKeyOptions` bekommt den dritten Parameter `selfPlant = false` und beginnt mit
`if (selfPlant) return ['heatingSystem']`; die Bedingung aus Task 2 wird
`(k !== 'heatingSystem' || stored === 'heatingSystem')` (unverändert, denn bei `selfPlant` ist die
Funktion schon zurückgekehrt). `defaultKeyFor` bekommt denselben Parameter und liefert bei
`category === HEATING_CATEGORY && selfPlant` `'heatingSystem'`.

```ts
// Ziel einer Heizposition (Heizung PR 10). Bei eigener Abrechnung nach der Warmwasserbereitung
// (targetOptions aus heatingSelfForm.ts); bei freien Schlüsseln „Heizung und Warmwasser“ (leer, wie
// bisher) oder „nur Heizung“, dann gelten beim Mieterwechsel die Gradtage (Abweichung 16).
export function heatingTargetOptions(selfPlant: boolean, hotWater: HotWater, part: HeatingPart | ''): { value: HeatingTarget | ''; label: string }[] {
  if (selfPlant) return targetOptions(hotWater, part)
  return [{ value: '', label: 'Heizung und Warmwasser' }, { value: 'heating', label: 'nur Heizung' }]
}
```

(`targetOptions` aus `'./heatingSelfForm'`, `HotWater`, `HeatingTarget`, `HeatingPart` als Typen aus
`'./types'`.)

- [ ] **Step 5: `client/src/pages/Kosten.tsx`**

Die Seite kennt die Heizanlagen des Objekts schon (PR 4/9: Wahl der Anlage). Daraus:

```tsx
  const plantOfForm = plants.find((p) => p.id === form.heatingPlantId) ?? null
  const selfPlant = form.category === HEATING_CATEGORY && plantOfForm?.method === 'self'
```

Die Auswahl des Schlüssels nimmt `costKeyOptions(unitMeterTypes, form.key, selfPlant)`; wechselt die
Anlage oder die Kostenart, setzt die Seite bei `selfPlant` `key: 'heatingSystem'`. Unter der Auswahl
der Anlage bei Heizkosten:

```tsx
      {form.category === HEATING_CATEGORY && plantOfForm && (
        <div className="row">
          {selfPlant && (
            <label className="field">
              Teil
              <select value={form.heatingPartSelf} onChange={(e) => setForm({ ...form, heatingPartSelf: e.target.value as HeatingPart | '', heatingTarget: '' })}>
                <option value="">Bitte wählen</option>
                {PART_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          {(() => {
            const options = heatingTargetOptions(selfPlant, plantOfForm.hotWater, form.heatingPartSelf)
            const value = options.some((o) => o.value === form.heatingTarget) ? form.heatingTarget : (options.length === 1 ? (options[0]?.value ?? '') : '')
            return (
              <label className="field">
                Ziel
                <select value={value} onChange={(e) => setForm({ ...form, heatingTarget: e.target.value as HeatingTarget | '' })}>
                  {selfPlant && options.length > 1 && <option value="">Bitte wählen</option>}
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )
          })()}
        </div>
      )}
```

Bei nur einer Option übernimmt `save()` sie in den Entwurf (`heatingTarget: value`), damit gespeichert
wird, was angezeigt ist. Die Checkbox „Brennstoff/Energie“ (PR 3) erscheint nur, wenn `!selfPlant`.

- [ ] **Step 6: `client/src/tenantChange.ts`**

```ts
// Kosten der Zwischenablesung (BGH VIII ZR 19/07), als Satz unter den Zählerständen.
export const INTERIM_FEE_HINT = 'Die Kosten einer Zwischenablesung beim Mieterwechsel sind keine Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist (BGH VIII ZR 19/07).'
```

`TenantChangeBody.readings` wird `{ meterId: string; value: number; date?: string }[]`, dazu
`interimGap?: { status: InterimGapStatus; reason: string }`. Die Eingaben von `buildTenantChange`
bekommen optional `meterDates?: Record<string, string>`, `heatMeterIds?: string[]` (Wärme- und
Warmwasserzähler der Wohnung, wenn eine Anlage mit eigener Abrechnung sie versorgt) und
`interimGap?: { status: InterimGapStatus | ''; reason: string } | null`. In der Schleife über die
Zähler:

```ts
    const date = input.meterDates?.[m.id] ?? ''
    if (date !== '' && !ISO_DATE.test(date)) return { error: `Das Ablesedatum für „${m.name}“ ist kein Datum.` }
    if (value !== null) readings.push({ meterId: m.id, value, ...(date !== '' ? { date } : {}) })
```

Hinter der Schleife:

```ts
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 3.5): fehlt ein Stand, sagt der Vermieter warum.
  const heatIds = input.heatMeterIds ?? []
  const missingHeat = heatIds.some((id) => parseMeterValue(meterValues[id] ?? '') === null)
  let interimGap: TenantChangeBody['interimGap']
  if (heatIds.length > 0 && missingHeat) {
    const g = input.interimGap
    if (!g || g.status === '') {
      return { error: 'Für die Heizkostenabrechnung fehlt ein Zählerstand. Bitte tragen Sie ihn ein oder geben Sie an, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.' }
    }
    interimGap = { status: g.status, reason: g.reason.trim() }
  }
```

und in beiden Rümpfen `...(interimGap ? { interimGap } : {})`.

- [ ] **Step 7: `client/src/pages/Stammdaten.tsx`**

Im Assistenten (Schritt 2, Zählerstände) neben jedem Zählerstand ein Datumsfeld
`<input type="date" aria-label={\`Ablesedatum ${m.name}\`} …>` (leer heißt Auszugstag), aber nur für
Zähler einer Wohnung, die eine Anlage mit `method = 'self'` versorgt (`servesUnit`, PR 5); dieselben
Zähler vom Typ `waerme` oder `warmwasser` gehen als `heatMeterIds` an `buildTenantChange`. Fehlt bei
einem davon der Stand, erscheint die Frage

```tsx
        <label className="field grow">
          Warum gibt es keine Zwischenablesung?
          <select value={gap.status} onChange={(e) => setGap({ ...gap, status: e.target.value as InterimGapStatus | '' })}>
            <option value="">Bitte wählen</option>
            <option value="impossible">Sie war nicht möglich (etwa: Wohnung nicht zugänglich)</option>
            <option value="missed">Sie wurde nicht durchgeführt</option>
          </select>
        </label>
        {gap.status === 'impossible' && <input value={gap.reason} placeholder="Grund (wird in der Abrechnung genannt)" onChange={(e) => setGap({ ...gap, reason: e.target.value })} />}
        {gap.status === 'missed' && <p className="muted">Dann rechnet Mietfuchs nach § 9b Abs. 3 HeizkostenV, und die Mieter können ihren Anteil kürzen; die Abrechnung nennt die Beträge.</p>}
```

Unter den Zählerständen steht `INTERIM_FEE_HINT` als `<p className="muted">`, sobald einer der
Zähler zu einer Anlage mit eigener Abrechnung gehört.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix client test -- costForm Kosten tenantChange Stammdaten && npm --prefix server test -- test/assessment.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/costItem.ts server/src/assessment.ts client/src/costForm.ts client/src/costForm.test.ts client/src/pages/Kosten.tsx client/src/pages/Kosten.test.tsx client/src/tenantChange.ts client/src/tenantChange.test.ts client/src/pages/Stammdaten.tsx
git commit -m "Heizkostenabrechnung: Teil und Ziel im Kostenformular, Ablesedatum und fehlende Zwischenablesung beim Mieterwechsel

Refs #99"
```

---

### Task 13: Oberfläche: Seite Heizkosten (Verteilung, Ablesungen, Ableseergebnis) und Druckblock

Die Seite Heizkosten bekommt bei `method = 'self'` drei Karten: den Anteil nach Verbrauch der
Heizperiode (§ 6 Abs. 4 gesperrt, sobald sie begonnen hat), die Ablesungen je Wohnung als Ampel mit der
Antwort zu fehlenden Zwischenablesungen und das Ableseergebnis je Wohnung zum Ausdrucken (§ 6 Abs. 1
Satz 2). Die Abrechnung druckt den Block „Heizkostenabrechnung“ (Entwurf 8.8 ohne § 6a, der mit PR 14
kommt). Die Logik steht in `heatingSelfView.ts`, damit sie ohne DOM prüfbar ist.

**Files:**
- Create: `client/src/heatingSelfView.ts`, `client/src/heatingSelfView.test.ts`, `client/src/components/SelfHeatingCards.tsx`, `client/src/components/SelfHeatingCards.test.tsx`, `client/src/components/SelfHeatingBlock.tsx`
- Modify: `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/notices.ts`

**Interfaces:**
- Consumes (Task 2, 6, 9): `HeatingDistribution`, `HeatingPeriodView.distribution`, `SelfHeatingStatement`, `SelfUnitView`, `SelfBoundaryView`, `SelfUserView`, `SelfPotView`, `InterimGap`; Routen `PUT …/periods/:period/distribution`, `PUT`/`DELETE /api/units/:id/interim-gaps/:date`, `GET /api/settlement/:period` (`heating[].self`); `shareBounds`, `forcedShare` (Task 11); `fmtEuro`, `fmtDate`, `api`, `errorText`, `withProperty`, `usePeriod`, `useToast`; `INFORMATIONAL` (notices.ts).
- Produces:
  - `heatingSelfView.ts`: `Light = 'green' | 'yellow' | 'red'`, `boundaryLight(b)`, `boundaryText(b, unitName)`, `distributionLines(d)`, `shareEditable(d)`, `potLines(pot)`, `userLine(u, self)`, `readingResult(unit, boundary)`
  - `SelfHeatingCards({ plant, view, self, onChanged })`, `SelfHeatingBlock({ self, tenancyId })`

- [ ] **Step 1: Write the failing tests**

`client/src/heatingSelfView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { boundaryLight, boundaryText, distributionLines, potLines, readingResult, shareEditable, userLine } from './heatingSelfView'
import { fmtEuro } from './api'
import type { HeatingDistribution, SelfBoundaryView, SelfHeatingStatement, SelfUnitView } from './types'

const b = (over: Partial<SelfBoundaryView> = {}): SelfBoundaryView => ({ date: '2025-09-30', kind: 'change', status: 'read', offDays: 0, far: false, gap: null, ...over })
const dist = (over: Partial<HeatingDistribution> = {}): HeatingDistribution => ({
  own: { heating: 70, water: 70, insulationRule: 'notApplies' }, effective: { heating: 70, water: 70, insulationRule: 'notApplies' },
  inherited: false, begun: true, first: false, forcedPercent: null, ...over,
})

describe('Ampel der Ablesungen (Heizung PR 10, Entwurf 3.5)', () => {
  it('abgelesen grün, daneben gelb, fehlend rot; eine Antwort macht „nicht möglich“ gelb, „versäumt“ bleibt rot', () => {
    expect(boundaryLight(b())).toBe('green')
    expect(boundaryLight(b({ status: 'off', offDays: 3 }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'missing' }))).toBe('red')
    expect(boundaryLight(b({ status: 'missing', gap: 'impossible' }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'missing', gap: 'missed' }))).toBe('red')
    // Ab der Warngrenze rot, bis der Vermieter gewählt hat (Abweichung 22).
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true }))).toBe('red')
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true, gap: 'useReading' }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true, gap: 'imprecise' }))).toBe('yellow')
  })
  it('der Satz nennt Grenze und Tage', () => {
    expect(boundaryText(b({ status: 'off', offDays: 3 }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 3 Tage daneben')
    expect(boundaryText(b({ status: 'off', offDays: 36, far: true }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 36 Tage daneben, über einen Wintermonat; bitte wählen')
    expect(boundaryText(b({ status: 'off', offDays: 36, far: true, gap: 'imprecise' }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 36 Tage daneben, über einen Wintermonat (geteilt nach § 9b Abs. 3)')
    expect(boundaryText(b({ status: 'missing', kind: 'end', date: '2025-12-31' }), 'B')).toBe('B, Ende der Heizperiode am 31.12.2025: keine Ablesung')
  })
})

describe('Anteil nach Verbrauch (§ 6 Abs. 4)', () => {
  it('nach Beginn nur noch zu sehen, vorher und beim ersten Mal änderbar', () => {
    expect(shareEditable(dist())).toBe(false)
    expect(shareEditable(dist({ begun: false }))).toBe(true)
    expect(shareEditable(dist({ first: true }))).toBe(true)
    expect(distributionLines(dist({ inherited: true, own: { heating: null, water: null, insulationRule: null } }))).toContain('Heizung 70 %, Warmwasser 70 % nach Verbrauch, übernommen aus der vorigen Heizperiode')
    expect(distributionLines(dist({ forcedPercent: 70 })).join(' ')).toMatch(/§ 7 Abs\. 1 Satz 2/)
  })
})

const self: SelfHeatingStatement = {
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'combined',
  alpha: { percent: 15, dhwHeatKwh: 9000, referenceKwh: 60000, reference: 'fuel' },
  shares: { heating: 70, water: 70, forced: false, previous: null },
  pots: [
    { pot: 'heating', costCents: 562800, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 40000, consumptionUnit: 'kWh', baseCentsPerM2: 844.2, consumptionCentsPerUnit: 9.849 },
    { pot: 'water', costCents: 103200, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 120, consumptionUnit: 'm³', baseCentsPerM2: 154.8, consumptionCentsPerUnit: 602 },
  ],
  units: [],
}
const unitC: SelfUnitView = {
  unitId: 'c', unitName: 'C', areaM2: 60, heatAreaM2: 60,
  readings: [
    { meterId: 'wc', meterName: 'Wärme C', pot: 'heating', boundary: '2025-09-30', date: '2025-09-30', value: 7700 },
    { meterId: 'xc', meterName: 'Warmwasser C', pot: 'water', boundary: '2025-09-30', date: null, value: null },
  ],
  boundaries: [], users: [],
}

describe('Ausweis und Ableseergebnis (Entwurf 8.8, § 6 Abs. 1 Satz 2)', () => {
  it('Topf mit Kosten, Anteil und Preisen je Einheit', () => {
    // fmtEuro setzt ein geschütztes Leerzeichen vor „€“, die Preise je Einheit ebenso.
    const [pot] = self.pots
    if (!pot) throw new Error('kein Topf im Ausweis')
    expect(potLines(pot)).toEqual([
      `Heizung: ${fmtEuro(562800)}`,
      `Grundkosten 30 %: ${fmtEuro(168840)} für 200 m², 8,4420\u00a0€ je m²`,
      `Verbrauchskosten 70 %: ${fmtEuro(393960)} für 40.000 kWh, 0,098490\u00a0€ je kWh`,
    ])
  })
  it('Nutzerzeile mit Verbrauch, Gradtagen und Betrag', () => {
    const c1 = { key: 'C1', role: 'tenancy' as const, tenancyId: 'C1', label: 'Mieter C1', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640, heatingConsumption: 7200, waterConsumption: 38, heatingGroup: false, waterGroup: false, heatingCents: 103330, waterCents: 29823, heatingCo2Cents: 0, waterCo2Cents: 0 }
    expect(userLine({ ...c1, heatingCo2Cents: 9281 }, self)).toContain(`Heizung 7.200 kWh, ${fmtEuro(103330)}, nach CO₂-Abzug ${fmtEuro(94049)}`)
    expect(userLine(c1, self))
      .toBe(`Mieter C1, 01.01.2025 bis 30.09.2025 (273 Tage, 640 ‰ der Gradtage): Heizung 7.200 kWh, ${fmtEuro(103330)}; Warmwasser 38 m³, ${fmtEuro(29823)}`)
  })
  it('Ableseergebnis je Wohnung: Zähler, Datum, Stand; fehlend als solcher benannt', () => {
    expect(readingResult(unitC, '2025-09-30')).toEqual(['Wärme C: 7.700 kWh am 30.09.2025', 'Warmwasser C: nicht abgelesen'])
  })
})
```

`client/src/components/SelfHeatingCards.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfHeatingCards from './SelfHeatingCards'
import type { HeatingPeriodView, HeatingPlant, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('fehlende Zwischenablesung: die Antwort geht an den Server, die Seite lädt neu', async () => {
  const calls: [string, string | undefined][] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push([String(url), init?.method])
    return new Response(JSON.stringify({ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: '' }), { status: 200 })
  })
  const self = {
    ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: { heating: 70, water: 70, forced: false, previous: null }, pots: [],
    units: [{ unitId: 'c', unitName: 'C', areaM2: 60, heatAreaM2: 60, readings: [], users: [], boundaries: [{ date: '2025-09-30', kind: 'change', status: 'missing', offDays: 0, far: false, gap: null }] }],
  } as SelfHeatingStatement
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/C, Mieterwechsel zum 30\.09\.2025: keine Ablesung/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/units/c/interim-gaps/2025-09-30', 'PUT']])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingSelfView SelfHeatingCards`
Expected: FAIL; die Module fehlen.

- [ ] **Step 3: Logik (`client/src/heatingSelfView.ts`)**

```ts
// Die eigene Heizkostenabrechnung auf der Seite Heizkosten und im Druck (Heizung PR 10, Entwurf 3.5,
// 8.8), ohne DOM prüfbar (heatingSelfView.test.ts). Die Zahlen rechnet der Server; hier stehen nur
// Sätze und die Ampel.
import type { HeatingDistribution, SelfBoundaryView, SelfHeatingStatement, SelfPotView, SelfUnitView, SelfUserView } from './types'
import { fmtDate, fmtEuro } from './api'

export type Light = 'green' | 'yellow' | 'red'

// Rot ist, was die Abrechnung nach § 9b Abs. 3 rechnen lässt und eine Kürzung erlaubt; gelb, was
// zulässig ist, aber hingesehen werden sollte (daneben abgelesen, Zwischenablesung nicht möglich).
export function boundaryLight(b: SelfBoundaryView): Light {
  if (b.status === 'read') return 'green'
  // Ab der Warngrenze neben dem Wechsel wählt der Vermieter; bis dahin wird nicht verteilt (Abweichung 22).
  if (b.status === 'off') return b.far && b.kind === 'change' && b.gap !== 'useReading' && b.gap !== 'imprecise' ? 'red' : 'yellow'
  return b.gap === 'impossible' ? 'yellow' : 'red'
}

const KIND_TEXT: Record<SelfBoundaryView['kind'], string> = { start: 'Beginn der Heizperiode am', end: 'Ende der Heizperiode am', change: 'Mieterwechsel zum' }
export function boundaryText(b: SelfBoundaryView, unitName: string): string {
  const head = `${unitName}, ${KIND_TEXT[b.kind]} ${fmtDate(b.date)}`
  if (b.status === 'read') return `${head}: abgelesen`
  if (b.status === 'off') {
    const choice = b.far && b.kind === 'change'
      ? (b.gap === 'imprecise' ? ' (geteilt nach § 9b Abs. 3)' : b.gap === 'useReading' ? ' (Ablesung verwendet)' : '; bitte wählen')
      : ''
    return `${head}: abgelesen ${b.offDays} ${b.offDays === 1 ? 'Tag' : 'Tage'} daneben${b.far ? ', über einen Wintermonat' : ''}${choice}`
  }
  const answer = b.gap === 'impossible' ? ' (nicht möglich)' : b.gap === 'missed' ? ' (nicht durchgeführt)' : ''
  return `${head}: keine Ablesung${answer}`
}

// § 6 Abs. 4: nach Beginn der Heizperiode gilt der Anteil; vorher und beim ersten Mal ist er frei.
export const shareEditable = (d: HeatingDistribution): boolean => d.first || !d.begun

export function distributionLines(d: HeatingDistribution): string[] {
  if (!d.effective) return ['Noch kein Anteil nach Verbrauch festgelegt.']
  const water = d.effective.water === null ? '' : `, Warmwasser ${d.effective.water} %`
  const lines = [`Heizung ${d.effective.heating} %${water} nach Verbrauch${d.inherited ? ', übernommen aus der vorigen Heizperiode' : ''}`]
  if (d.forcedPercent !== null) lines.push(`Vorgeschrieben: ${d.forcedPercent} % bei den Heizkosten (§ 7 Abs. 1 Satz 2 HeizkostenV).`)
  if (!shareEditable(d)) lines.push('Die Heizperiode hat begonnen; einen anderen Anteil tragen Sie für die nächste ein (§ 6 Abs. 4 HeizkostenV).')
  return lines
}

const POT_LABEL = { heating: 'Heizung', water: 'Warmwasser' } as const
const num = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const perUnit = (cents: number, digits: number) => `${num(cents / 100, digits)}\u00a0€`

export function potLines(p: SelfPotView): string[] {
  const base = p.costCents * (1 - p.consumptionPct / 100)
  const lines = [`${POT_LABEL[p.pot]}: ${fmtEuro(p.costCents)}`]
  lines.push(`Grundkosten ${num(100 - p.consumptionPct)} %: ${fmtEuro(Math.round(base))} für ${num(p.areaM2)} m², ${perUnit(p.baseCentsPerM2, 4)} je m²`)
  if (p.byAreaOnly) lines.push('Kein Verbrauch erfasst: nur nach Fläche verteilt.')
  else if (p.consumptionCentsPerUnit !== null) {
    lines.push(`Verbrauchskosten ${num(p.consumptionPct)} %: ${fmtEuro(Math.round(p.costCents - base))} für ${num(p.consumption)} ${p.consumptionUnit}, ${perUnit(p.consumptionCentsPerUnit, 6)} je ${p.consumptionUnit}`)
  }
  return lines
}

export function userLine(u: SelfUserView, self: Pick<SelfHeatingStatement, 'pots'>): string {
  const time = `${fmtDate(u.from)} bis ${fmtDate(u.to)} (${u.days} Tage, ${num(u.degreeDayPermille)} ‰ der Gradtage)`
  // Der Topfbetrag je Mieter, mit Abzug auch nach CO₂-Abzug: die Grundlage einer Kürzung (Abweichung 15).
  const net = (cents: number, co2: number) => `${fmtEuro(cents)}${co2 > 0 ? `, nach CO₂-Abzug ${fmtEuro(cents - co2)}` : ''}`
  const parts = [`Heizung ${u.heatingConsumption === null ? 'nicht erfasst' : `${num(u.heatingConsumption)} kWh${u.heatingGroup ? ' (gemeinsam nach § 9b Abs. 3)' : ''}`}, ${net(u.heatingCents, u.heatingCo2Cents)}`]
  if (self.pots.some((p) => p.pot === 'water')) {
    parts.push(`Warmwasser ${u.waterConsumption === null ? 'nicht erfasst' : `${num(u.waterConsumption)} m³${u.waterGroup ? ' (gemeinsam nach § 9b Abs. 3)' : ''}`}, ${net(u.waterCents, u.waterCo2Cents)}`)
  }
  return `${u.label}, ${time}: ${parts.join('; ')}`
}

// Das Ableseergebnis einer Wohnung zu einer Grenze (§ 6 Abs. 1 Satz 2 HeizkostenV).
export function readingResult(unit: SelfUnitView, boundary: string): string[] {
  return unit.readings.filter((r) => r.boundary === boundary).map((r) => (r.date === null || r.value === null
    ? `${r.meterName}: nicht abgelesen`
    : `${r.meterName}: ${num(r.value)} ${r.pot === 'heating' ? 'kWh' : 'm³'} am ${fmtDate(r.date)}`))
}
```


- [ ] **Step 4: Karten (`client/src/components/SelfHeatingCards.tsx`)**

```tsx
import { useState } from 'react'
import type { HeatingPeriodView, HeatingPlant, InterimGapStatus, SelfHeatingStatement } from '../types'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { boundaryLight, boundaryText, distributionLines, potLines, readingResult, shareEditable, userLine } from '../heatingSelfView'
import { shareBounds } from '../heatingSelfForm'

// Die eigene Heizkostenabrechnung auf der Seite Heizkosten (Heizung PR 10). `self` kommt aus der
// Abrechnung des Zeitraums (`heating[].self`), `view` aus der Ansicht der Heizperiode.
export default function SelfHeatingCards({ plant, view, self, onChanged }: {
  plant: HeatingPlant; view: HeatingPeriodView; self: SelfHeatingStatement | null; onChanged: () => void
}) {
  const toast = useToast()
  const [error, setError] = useState('')
  const [share, setShare] = useState('')
  const [waterShare, setWaterShare] = useState('')
  const { min, max } = shareBounds()
  const d = view.distribution ?? null

  async function saveShare() {
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/distribution`, {
        method: 'PUT',
        // § 8 Abs. 1: beide Werte, das Warmwasser nur bei zentralem Warmwasser (Abweichung 14).
        body: JSON.stringify({
          heatConsumptionPct: Number(share.replace(',', '.')),
          waterConsumptionPct: plant.hotWater === 'none' ? null : Number(waterShare.replace(',', '.')),
          insulationRule: d?.effective?.insulationRule ?? 'unknown',
        }),
      })
      setError('')
      toast('Anteil gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function answer(unitId: string, date: string, status: InterimGapStatus | null) {
    try {
      const url = `/api/units/${unitId}/interim-gaps/${date}`
      if (status === null) await api(url, { method: 'DELETE' })
      else await api(url, { method: 'PUT', body: JSON.stringify({ status, reason: '' }) })
      setError('')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h3><Term id="consumptionCosts">Anteil nach Verbrauch</Term> · {view.label}</h3>
        {d ? distributionLines(d).map((l) => <p key={l}>{l}</p>) : <p className="muted">Noch kein Anteil festgelegt.</p>}
        {(!d || shareEditable(d)) && (
          <div className="row no-print">
            {/* Das Warmwasser übernimmt den Wert der Heizung sichtbar, bis der Vermieter ihn ändert. */}
            <label className="field">Heizung in % ({min} bis {max})<input inputMode="decimal" value={share} onChange={(e) => { if (waterShare === '' || waterShare === share) setWaterShare(e.target.value); setShare(e.target.value) }} /></label>
            {plant.hotWater !== 'none' && (
              <label className="field">Warmwasser in %<input inputMode="decimal" value={waterShare} onChange={(e) => setWaterShare(e.target.value)} /></label>
            )}
            <button className="btn secondary" onClick={saveShare}>Speichern</button>
          </div>
        )}
      </div>
      {self && (
        <div className="card">
          <h3><Term id="interimReading">Ablesungen</Term></h3>
          <ul>
            {self.units.flatMap((u) => u.boundaries.map((b) => {
              const light = boundaryLight(b)
              return (
                <li key={`${u.unitId}@${b.date}`} className={`light-${light}`}>
                  {boundaryText(b, u.unitName)}
                  {b.status === 'off' && b.kind === 'change' && b.far && (
                    <span className="no-print">
                      {' '}
                      <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'useReading')}>Ablesung verwenden</button>
                      <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'imprecise')}>Nach § 9b Abs. 3</button>
                      {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
                    </span>
                  )}
                  {b.status === 'missing' && b.kind === 'change' && (
                    <span className="no-print">
                      {' '}
                      <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'impossible')}>Nicht möglich</button>
                      <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'missed')}>Nicht durchgeführt</button>
                      {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
                    </span>
                  )}
                </li>
              )
            }))}
          </ul>
        </div>
      )}
      {self && self.ok && (
        <div className="card">
          <h3>Verteilung</h3>
          {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
          {self.units.flatMap((u) => u.users).map((u) => <p key={u.key}>{userLine(u, self)}</p>)}
        </div>
      )}
      {self && (
        <div className="card print-each">
          <h3>Ableseergebnis</h3>
          <p className="muted no-print">Das Ergebnis der Ablesung teilen Sie jedem Mieter in der Regel innerhalb eines Monats mit (§ 6 Abs. 1 Satz 2 HeizkostenV). Drucken Sie diese Karte, je Wohnung eine Seite.</p>
          {self.units.map((u) => (
            <section key={u.unitId} className="page-break">
              <h4>{u.unitName}</h4>
              {[...new Set(u.readings.map((r) => r.boundary))].map((date) => (
                <div key={date}><strong>{date.slice(8, 10)}.{date.slice(5, 7)}.{date.slice(0, 4)}</strong>{readingResult(u, date).map((l) => <p key={l}>{l}</p>)}</div>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  )
}
```

(Die Klassen `light-green`, `light-yellow`, `light-red`, `print-each` und `page-break` kommen in
`client/src/index.css` neben die Ampel des Cockpits; `page-break` setzt `break-before: page` außer
beim ersten.)

- [ ] **Step 5: Seite (`client/src/pages/Heizkosten.tsx`)**

Naht N15 und N16 (Task 8 hat den Server umgestellt): `{plant.method === 'manual' && (` wird
`{plant.method !== 'service' && (`; der Zweig `plant.method === 'self' ? (<div className="card"><p>Die
eigene Heizkostenabrechnung kommt mit einer späteren Version.</p></div>) : (…)` entfällt, die Karten
gelten für alle Methoden. Dahinter:

```tsx
      {plant.method === 'self' && view && (
        <SelfHeatingCards plant={plant} view={view} self={selfStatement} onChanged={reload} />
      )}
```

mit `selfStatement` aus der Abrechnung des Zeitraums:

```tsx
  const [selfStatement, setSelfStatement] = useState<SelfHeatingStatement | null>(null)
  useEffect(() => {
    if (plant?.method !== 'self') { setSelfStatement(null); return }
    api<{ heating?: HeatingStatement[] }>(withProperty(`/api/settlement/${period.key}`, propertyId))
      .then((s) => setSelfStatement(s.heating?.find((h) => h.plantId === plant.id && h.period === view?.period)?.self ?? null))
      .catch((e) => setError(errorText(e)))
  }, [plant?.id, plant?.method, period.key, propertyId, view?.period, version])
```

(`version` ist der Zähler, den `reload` hochsetzt; heißt er in PR 6/7 anders, den vorhandenen nehmen.)

- [ ] **Step 6: Druckblock (`client/src/components/SelfHeatingBlock.tsx`, `client/src/pages/Abrechnung.tsx`)**

```tsx
import type { SelfHeatingStatement } from '../types'
import { potLines, userLine } from '../heatingSelfView'

// Druckblock „Heizkostenabrechnung“ je Anlage und Heizperiode (Entwurf 8.8 ohne § 6a, PR 14): Töpfe
// mit Preisen je Einheit, Warmwasseranteil mit Methode, die Zeilen des Mieters. Der CO₂-Block (PR 6)
// steht darunter wie bisher.
export default function SelfHeatingBlock({ self, tenancyId, plantName }: { self: SelfHeatingStatement; tenancyId: string; plantName: string }) {
  const mine = self.units.flatMap((u) => u.users).filter((u) => u.tenancyId === tenancyId)
  if (!self.ok || mine.length === 0) return null
  return (
    <div className="heating-self-block">
      <h4>Heizkostenabrechnung{plantName ? ` · ${plantName}` : ''}</h4>
      {self.alpha && (
        <p>
          Warmwasseranteil {self.alpha.percent.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %: gemessen {self.alpha.dhwHeatKwh.toLocaleString('de-DE')} kWh von {self.alpha.referenceKwh.toLocaleString('de-DE')} kWh
          {self.alpha.reference === 'fuel' ? ' laut Brennstoffrechnung' : ' laut Gesamtwärmezähler'} (§ 9 Abs. 2 HeizkostenV)
        </p>
      )}
      {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
      {mine.map((u) => <p key={u.key}><strong>{userLine(u, self)}</strong></p>)}
    </div>
  )
}
```

In `Abrechnung.tsx` beim Mieter unter dem CO₂-Block (PR 6):

```tsx
          {(settlement.heating ?? [])
            .filter((h): h is HeatingStatement & { self: SelfHeatingStatement } => h.self !== undefined)
            .map((h) => <SelfHeatingBlock key={`${h.plantId}@${h.period}`} self={h.self} tenancyId={st.tenancyId} plantName={h.plantName ?? ''} />)}
```

- [ ] **Step 7: Hinweise (`client/src/notices.ts`)**

In `INFORMATIONAL` (färbt die Ampel des Cockpits nicht) die Hinweise ohne Handlungsbedarf aufnehmen:
`'heating.interim-reading-off'`, `'heating.reading-dates-differ'`, `'heating.change-split-time'`,
`'heating.heat-pump-capture'`. Die übrigen neuen Codes färben wie ihre Stufe.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingSelfView SelfHeatingCards Heizkosten Abrechnung notices && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/heatingSelfView.ts client/src/heatingSelfView.test.ts client/src/components/SelfHeatingCards.tsx client/src/components/SelfHeatingCards.test.tsx client/src/components/SelfHeatingBlock.tsx client/src/pages/Heizkosten.tsx client/src/pages/Abrechnung.tsx client/src/notices.ts client/src/index.css
git commit -m "Heizkostenabrechnung: Seite Heizkosten mit Anteil, Ablesungen und Ableseergebnis; Druckblock

Refs #99"
```

---

### Task 14: Anleitung, Smoke-Test, CHANGELOG, CLAUDE.md, Gesamtprüfung

Die Anleitung „Heizkosten selbst abrechnen“ (Entwurf 11.4) mit einem nachgerechneten Beispiel; die
Lücken der übrigen Anleitungen nennen nur noch, was nach PR 10 fehlt. Der Smoke-Test prüft die
eigene Abrechnung auf jeder Programmdatei.

**Files:**
- Modify: `shared/guides.ts`, `server/test/guides.test.ts`, `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks; `hkvConsumptionShare`, `hkvCutNotByConsumption`, `valueAt`, `LAW_AS_OF` (shared/law); Beschriftungen „Ich selbst, mit Zählern oder Heizkostenverteilern“, „Selbst abrechnen“, „Umstellen“, „Anteil nach Verbrauch“, „Nicht möglich“, „Nicht durchgeführt“, „Ableseergebnis“ (Task 11, 13).
- Produces: `GuideId` + `'heatingSelf'`.

- [ ] **Step 1: Write the failing tests**

In `server/test/guides.test.ts`:

(a) In der erwarteten Liste der Kennungen (erster Test) `'heatingSelf'` direkt hinter `'co2Costs'`
(PR 6) ergänzen.

(b) Die Probe wird asynchron, weil die eigene Abrechnung über die Datenbank entsteht: Der Typ von
`checks` wird `Record<GuideId, () => void | Promise<void>>`, und die Schleife am Ende ruft
`async () => checks[id]()`. Importe: `fs`, `os`, `path` aus Node, `openDatabase` aus
`'../src/db/open.ts'`, `readStock` aus `'../src/db/read.ts'`, `createEntity` aus
`'../src/db/repository.ts'`, `createHeatingPlant` aus `'../src/db/heating.ts'`, `setUpSelf` aus
`'../src/db/heatingSelf.ts'`, `snapshotFor` aus `'../src/snapshot.ts'`, `CALENDAR_RULES`, `periodKey`,
`periodOfKey` aus `'../../shared/period.ts'`. In `checks` hinter `co2Costs`:

```ts
  heatingSelf: async () => {
    // Zwei Wohnungen à 50 m², Fernwärme ohne zentrales Warmwasser, 70 % nach Verbrauch (Heizung PR 10).
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-guide-heating-'))
    const opened = await openDatabase({ dataDir })
    try {
      let n = 0
      await opened.write(async (db) => {
        for (const u of ['a', 'b']) {
          await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
          await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
        }
        await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'districtHeating', method: 'manual' })
        await setUpSelf(db, 'hp', { period: '2025-01', heatConsumptionPct: 70, insulationRule: 'unknown', hotWater: 'none', capture: 'heatMeter' }, '2026-02-01', () => `gm-${++n}`)
      })
      const meters = (await opened.read(readStock)).meters
      await opened.write(async (db) => {
        for (const [u, kwh] of [['a', 4000], ['b', 6000]] as const) {
          const m = meters.find((x) => x.unitId === u && x.type === 'waerme') ?? assert.fail(`kein Wärmezähler ${u}`)
          await createEntity(db, 'readings', `${u}0`, { meterId: m.id, date: '2024-12-31', value: 0 })
          await createEntity(db, 'readings', `${u}1`, { meterId: m.id, date: '2025-12-31', value: kwh })
        }
        await createEntity(db, 'costItems', 'fw', {
          propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Fernwärme', amountCents: 300000,
          key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: 'heating',
        })
      })
      const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
      const r = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
      assert.ok(!r.notices.some((x) => x.level === 'error'), r.notices.map((x) => x.code).join(', '))
      assert.deepEqual([share(r, 'ta', 'fw'), share(r, 'tb', 'fw')], [129000, 171000])
      inOrder(GUIDES.heatingSelf.example, [eur(300000), eur(90000), eur(45000), eur(210000), '4.000 kWh', eur(84000), eur(129000), '6.000 kWh', eur(171000)], 'heatingSelf')
    } finally {
      opened.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  },
```

(c) Ans Ende:

```ts
test('Heizkosten selbst abrechnen (Heizung PR 10): Pflichten mit Norm, Lücken mit Issue, und die übrigen Anleitungen sagen nicht mehr „noch nicht“', () => {
  const g = GUIDES.heatingSelf
  const hinweise = g.caveats.map((c) => `${c.text} ${c.norm ?? ''}`).join(' ')
  for (const norm of [/§ 6 Abs\. 4/, /§ 7 Abs\. 1/, /§ 9b/, /§ 12 Abs\. 1/, /§ 6 Abs\. 1/]) assert.match(hinweise, norm)
  assert.match(hinweise, /VIII ZR 19\/07/)
  assert.ok(g.steps.some((s) => s.page === 'heizkosten' && s.text.includes('„Ableseergebnis“')))
  assert.ok(g.gaps.some((x) => x.issue === 99 && /Heizkostenverteiler/.test(x.text)))
  for (const id of ids.filter((x) => x !== 'heatingSelf')) {
    assert.doesNotMatch(JSON.stringify(GUIDES[id].gaps), /eigene Heizkostenabrechnung (nach Grund- und Verbrauchskosten rechnet Mietfuchs noch nicht|mit Wärmemengenzählern)/, id)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/guides.test.ts`
Expected: FAIL; `GUIDES.heatingSelf` fehlt, und `multiFamily` nennt die eigene Abrechnung noch als
Lücke.

- [ ] **Step 3: Anleitung (`shared/guides.ts`)**

Importe: `hkvConsumptionShare` in den Import aus `'./law/heizkostenv.ts'` (neben `hkvCutNotByConsumption`,
PR 1), dazu unter `const CUT = …`:

```ts
// Heizung PR 10: der Spielraum nach § 7 Abs. 1 und § 8 Abs. 1 HeizkostenV, aus dem Register.
const HKV_SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
```

In `GUIDE_DATA` hinter `co2Costs`:

```ts
  heatingSelf: {
    title: 'Heizkosten selbst abrechnen',
    applies: 'Ihr Haus hat eine Zentralheizung, und Sie lesen die Wärmezähler (und, wenn die Heizung auch das Warmwasser bereitet, die Warmwasserzähler) jeder Wohnung selbst ab, ohne Messdienst. Mietfuchs verteilt dann nach der Heizkostenverordnung in Grund- und Verbrauchskosten.',
    steps: [
      { page: 'stammdaten', text: 'Klicken Sie in der Karte „Heizung“ auf „Heizung einrichten“, wählen Sie die Energie und bei der Frage, wer abrechnet, „Ich selbst, mit Zählern oder Heizkostenverteilern“.' },
      { page: 'stammdaten', text: 'Beantworten Sie danach die Fragen zu Warmwasser, Erfassung, Wärmeschutz und dem „Anteil nach Verbrauch“ und klicken Sie auf „Umstellen“. Nennt Mietfuchs Heizpositionen, wählen Sie für jede Teil und Ziel. Später erreichen Sie die Fragen über „Selbst abrechnen“.' },
      { page: 'zaehler', text: 'Tragen Sie die Stände der angelegten Zähler zu Beginn und Ende der Heizperiode ein, beim Mieterwechsel zum Auszugstag.' },
      { page: 'kosten', text: 'Erfassen Sie Brennstoff, Betriebsstrom, Wartung und Zählermiete als Position „Heizung und Warmwasser“; der Schlüssel ist „nach Heizkostenverordnung“, dazu Teil und Ziel.' },
      { page: 'heizkosten', text: 'Prüfen Sie auf der Seite Heizkosten die Ablesungen. Fehlt beim Mieterwechsel eine Zwischenablesung, antworten Sie mit „Nicht möglich“ oder „Nicht durchgeführt“. Das „Ableseergebnis“ drucken Sie für jede Wohnung aus.' },
    ],
    result: [
      'Die Kosten jedes Topfs (Heizung, Warmwasser) gehen zum gewählten Anteil nach Verbrauch, der Rest nach Wohnfläche; bei verbundener Warmwasserbereitung teilt Mietfuchs die gemeinsamen Kosten nach der gemessenen Wärme am Warmwasserspeicher.',
      'Beim Mieterwechsel trägt jeder seinen abgelesenen Verbrauch; die Grundkosten der Heizung teilen sich nach Gradtagen, die des Warmwassers nach Tagen.',
      'Leerstand und Eigennutzung sind Nutzer wie Mieter; ihren Anteil tragen Sie. Die Abrechnung druckt den Block „Heizkostenabrechnung“ mit den Preisen je m², kWh und m³.',
    ],
    example: 'Zwei Wohnungen à 50 m², Fernwärme 3.000,00 €, kein zentrales Warmwasser, 70 % nach Verbrauch. Grundkosten 30 %: 900,00 €, je Wohnung 450,00 €. Verbrauchskosten 70 %: 2.100,00 € für 10.000 kWh. Wohnung A: 4.000 kWh, 840,00 €, zusammen 1.290,00 €. Wohnung B: 6.000 kWh, zusammen 1.710,00 €.',
    caveats: [
      { text: `Zwischen ${HKV_SHARE.min} und ${HKV_SHARE.max} Prozent der Kosten sind nach Verbrauch zu verteilen; bei Öl- oder Gasheizung in einem Haus mit Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen genau ${HKV_SHARE.max} Prozent der Heizkosten.`, norm: '§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV' },
      { text: 'Den Anteil ändern Sie nach der ersten Festlegung nur aus den dort genannten Gründen, durch Erklärung gegenüber den Mietern und nur für künftige Abrechnungszeiträume.', norm: '§ 6 Abs. 4 HeizkostenV' },
      { text: 'Beim Mieterwechsel ist eine Zwischenablesung Pflicht. Wird sie nicht durchgeführt, rechnet Mietfuchs ersatzweise nach Gradtagen und Tagen, und der Mieter kann seinen Anteil kürzen; die Abrechnung nennt die Beträge.', norm: '§ 9b HeizkostenV' },
      { text: 'Die Kosten der Zwischenablesung sind keine Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist.', norm: 'BGH VIII ZR 19/07' },
      { text: `Wird nicht nach Verbrauch verteilt, etwa weil Zählerstände fehlen, darf jeder Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 12 Abs. 1 HeizkostenV' },
      { text: 'Das Ergebnis der Ablesung teilen Sie jedem Mieter in der Regel innerhalb eines Monats mit.', norm: '§ 6 Abs. 1 HeizkostenV' },
    ],
    gaps: [
      { text: 'Heizkostenverteiler an den Heizkörpern und die Werte eines Ablesedienstes, der Warmwasseranteil bei Heizöl, Flüssiggas, Pellets und Holz und die Angaben nach § 6a HeizkostenV kommen mit späteren Versionen.', issue: 99 },
    ],
    terms: ['heatingCostOrdinance', 'baseCosts', 'consumptionCosts', 'interimReading', 'heatMeter', 'hotWaterShare', 'degreeDays'],
  },
```

Die Lücken der übrigen Anleitungen, die die eigene Abrechnung als fehlend nennen, werden auf den Stand
nach PR 10 gebracht (Issue bleibt #99):

- `multiFamily`: „Eine eigene Heizkostenabrechnung nach Grund- und Verbrauchskosten rechnet Mietfuchs
  noch nicht. …“ → „Eine eigene Heizkostenabrechnung mit Heizkostenverteilern an den Heizkörpern rechnet
  Mietfuchs noch nicht; mit Wärme- und Warmwasserzählern siehe die Anleitung „Heizkosten selbst
  abrechnen“. Liegt eine Abrechnung eines Messdienstes vor, übernehmen Sie sie als Einzelbeträge (siehe
  die Anleitung zum Messdienst).“
- `condo` (bzw. die Anleitung mit „mit Wärmemengenzählern“): → „Eine eigene Heizkostenabrechnung mit
  Heizkostenverteilern; mit Wärme- und Warmwasserzählern siehe „Heizkosten selbst abrechnen“.“
- `flatRate` und `meteringService` bleiben, denn sie sagen nicht „noch nicht“, sondern nennen die
  eigene Abrechnung als Weg; `meteringService` bekommt den Satz „(siehe „Heizkosten selbst
  abrechnen“)“ angehängt.

Der Test „jede zitierte Beschriftung steht so in der Oberfläche“ findet „Selbst abrechnen“,
„Umstellen“, „Nicht möglich“, „Nicht durchgeführt“ und „Ableseergebnis“ in den Komponenten aus Task 11
und 13.

- [ ] **Step 4: Smoke-Test (`scripts/smoke-test.mjs`)**

Vor `async function main()`:

```js
// Eigene Heizkostenabrechnung (Heizung PR 10), in einem eigenen Objekt wie die Prüfung aus PR 9.
async function selfHeating() {
  const objekt = (await request('/api/properties', json('POST', { name: 'Prüfhaus Heizkosten', kind: 'mfh', address: '' }))).body
  const q = `?property=${encodeURIComponent(objekt.id)}`
  const ids = []
  for (const name of ['A', 'B']) {
    const u = (await request(`/api/units${q}`, json('POST', { name, areaM2: 50, participates: true }))).body
    ids.push(u.id)
    await request(`/api/tenancies${q}`, json('POST', {
      unitId: u.id, tenantName: `Mieter ${name}`, personHistory: [{ from: '2020-01-01', persons: 1 }],
      start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
  }
  const plant = (await request(`/api/heating-plants${q}`, json('POST', { energy: 'districtHeating', method: 'manual', assignItemIds: [] }))).body.plant
  const setup = await request(`/api/heating-plants/${plant.id}/self`, json('PUT', { period: '2025-01', heatConsumptionPct: 70, insulationRule: 'unknown', hotWater: 'none', capture: 'heatMeter' }))
  assert(setup.status === 200 && setup.body.plant.method === 'self', 'eigene Heizkostenabrechnung einrichten', setup.body)
  for (const [i, m] of setup.body.created.entries()) {
    await request(`/api/readings${q}`, json('POST', { meterId: m.id, date: '2024-12-31', value: 0 }))
    await request(`/api/readings${q}`, json('POST', { meterId: m.id, date: '2025-12-31', value: m.unitId === ids[0] ? 4000 : 6000 }))
    assert(m.type === 'waerme', `Zähler ${i + 1} ist ein Wärmezähler`, m)
  }
  await request(`/api/costItems${q}`, json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Fernwärme', amountCents: 300000,
    key: 'heatingSystem', heatingPlantId: plant.id, heatingPart: 'fuel', heatingTarget: 'heating',
  }))
  const abrechnung = (await request(`/api/settlement/2025${q}`)).body
  const summen = abrechnung.statements.map((s) => s.totalShareCents).sort((a, b) => a - b)
  assert(JSON.stringify(summen) === JSON.stringify([129000, 171000]), 'nach Heizkostenverordnung verteilt: 1.290,00 € und 1.710,00 €', summen)
  assert(abrechnung.heating?.some((h) => h.self?.ok), 'die Abrechnung trägt den Ausweis der Heizkostenabrechnung', abrechnung.heating)
}
```

In `main` hinter `await plantsOfProperty()` (PR 9):

```js
  await selfHeating()
```

- [ ] **Step 5: Smoke-Test gegen eine laufende Instanz**

Run:

```bash
npm run build
D=$(mktemp -d)
CI=1 NKA_DATA_DIR="$D" NKA_UPDATE_URL=http://127.0.0.1:9/kein-internet NKA_PORT=3999 npm start > "$D.log" 2>&1 &
SERVER=$!
node scripts/smoke-test.mjs --url http://127.0.0.1:3999 --mode npm; echo "Exit $?"
kill $SERVER
```

Expected: „Alle … Prüfungen bestanden.“, `Exit 0`, darunter „✓ nach Heizkostenverordnung verteilt:
1.290,00 € und 1.710,00 €“.

- [ ] **Step 6: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]` → `### Hinzugefügt`:

```md
- **Heizkosten selbst abrechnen.** Wer Wärme- und Warmwasserzähler jeder Wohnung selbst abliest, wählt in
  den Stammdaten bei der Heizung „Ich selbst, mit Zählern oder Heizkostenverteilern“. Mietfuchs verteilt
  dann nach der Heizkostenverordnung: Grund- und Verbrauchskosten je Topf, den Warmwasseranteil aus der
  gemessenen Wärme am Speicher, beim Mieterwechsel den abgelesenen Verbrauch und die Grundkosten nach
  Gradtagen; Leerstand, Eigennutzung und Pauschale als eigene Nutzer. Die Abrechnung druckt die Preise je
  m², kWh und m³. Fehlt eine Zwischenablesung, sagt die Abrechnung, um wie viel die Mieter kürzen dürfen.
  Die Seite Heizkosten zeigt die Ablesungen als Ampel und druckt das Ableseergebnis je Wohnung
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Bei einer Wärmepumpe fragt die Einrichtung auch, ob sie erst nach dem Stichtag der Verordnung
  eingebaut wurde.

### Geändert

- Bei freien Schlüsseln kann eine Heizposition „nur Heizung“ sein; beim Mieterwechsel teilt sie sich
  dann nach Gradtagen statt nach Tagen. Positionen „Heizung und Warmwasser“ bleiben, wie sie sind.
- Eine Heizposition, deren Beschreibung „Zwischenablesung“ oder „Nutzerwechsel“ enthält, bekommt einen
  Hinweis: Diese Kosten trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist.
```

- [ ] **Step 7: CLAUDE.md**

Im Abschnitt „Architektur“ hinter dem Absatz **Mehrere Heizanlagen und Etagenheizung** (PR 9):

```md
**Eigene Heizkostenabrechnung** (Heizung PR 10, #99): Bei `method = 'self'` verteilt Mietfuchs nach
der Heizkostenverordnung. Die reine Rechnung steht in [server/src/heating.ts](server/src/heating.ts):
Nutzer je Wohnung (Mietverhältnisse, Leerstand, Eigennutzung, außerhalb), die Ablesung je Grenze (die
beim Mieterwechsel erfasste fest, `readings.interim_for`; sonst die nächste in der Zelle über H−1, H und
H+1; zwei Werte am selben Tag sind ein Befund; der eingefrorene Endstand der Vorperiode ist der
Anfangsstand; ohne Rückrechnung, Entwurf 3.5),
§ 9b Abs. 3 als Gruppe über die Grenzen ohne Ablesung, Bruchteile je Topf und daraus **ein Gewicht je
Nutzer und Ziel** (`weightsOf`). calc.ts verteilt jede Position mit `key = 'heatingSystem'` mit diesen
Gewichten durch `distributeCents` (#202), wie jede andere Position; Leerstand und Eigennutzung gehen
über `landlordRecipients`.

- **Teil und Ziel** stehen an der Position (`heatingPart`, `heatingTarget`); bei verbundener
  Warmwasserbereitung teilt der gemessene Warmwasseranteil α (`hotWaterShareOf`, nur bei Abrechnung in
  kWh) die Ziele „beides“. Der Anteil nach Verbrauch gilt aus der Heizperiode oder der vorigen
  (`consumptionSharesOf`, § 6 Abs. 4); § 7 Abs. 1 Satz 2 ist `hkv.consumption-share-forced`.
- **Umgestellt wird nur über die Einrichtung** (`PUT /api/heating-plants/:id/self`,
  [server/src/db/heatingSelf.ts](server/src/db/heatingSelf.ts)): Anlage, Anteil, Zähler und die
  Positionen offener Zeiträume in einer Transaktion; fehlen Teil und Ziel, antwortet sie 409 mit der
  Liste. Zurück auf „Niemand“ verlangt `convertItems: 'area'`.
- **Nicht verteilbar** (fehlender Stand, fehlender Zähler, kein Anteil, α unbestimmbar) heißt Fehler an
  der Anlage und alle Positionen beim Vermieter; geraten wird nie. Die Hinweise zu Ablesung und
  Zwischenablesung rechnen nach dem CO₂-Block, weil ihre Kürzungsbeträge auf den gedruckten Zeilen
  stehen; fehlende Zwischenablesungen beantwortet der Vermieter in `interim_reading_gaps`.
- **Wärmepumpe**: Ob die Verordnung gilt, entscheidet `heatPumpVerdict` aus dem Datum der Erfassung
  oder des Einbaus (§ 12 Abs. 3, `hkv.heat-pump.capture`).
- **„Nur Heizung“ bei freien Schlüsseln** nimmt beim Mieterwechsel die Gradtage statt der Tage
  (Fläche, Einheiten, vereinbarte Anteile, Direktzuordnung); eine kombinierte Position bleibt nach
  Tagen, deshalb ändert sich für Bestandsnutzer keine Zahl.
- **Golden F16, F17** in `server/test/fixtures/heating/` rechnen Beispiel A und das Heizöl mit Vorrat von
  Hand nach; Heizkostenverteiler, Werte eines Ablesedienstes und § 6a kommen mit PR 12 und PR 14.
```

Im Absatz `**API**` hinter den Routen der Heizanlagen: „`PUT /api/heating-plants/:id/self` (Einrichtung
der eigenen Abrechnung, 409 mit Positionen), `PUT …/periods/:period/distribution` (Anteil nach
Verbrauch), `PUT`/`DELETE /api/units/:id/interim-gaps/:date` (fehlende Zwischenablesung)“.

- [ ] **Step 8: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden. Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement server/test/fixtures/heating/F1[0-5]* server/test/fixtures/heating/F0*
```

Expected: keine Ausgabe (Golden F01 bis F15 unverändert; neu sind nur F16 und F17).

- [ ] **Step 9: Commit**

```bash
git add shared/guides.ts server/test/guides.test.ts scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "Heizkostenabrechnung: Anleitung, Smoke-Test, CHANGELOG, Architekturabschnitt

Refs #99"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“). Sie prüft ausdrücklich
die Abweichungen 1 bis 23, die Nähte N1 bis N16 gegen den Code von PR 7 und PR 8 und die fünf Punkte
des Review Focus. Befunde mit einem vorher roten Test beheben; PR gestapelt auf PR 9 mit `Refs #99` und
den Befunden in der Beschreibung. Vor dem Merge der Kette folgt die Integrationsdurchsicht des
Endstands (`main..Spitze`) mit den Blickwinkeln Geld und Daten, der Praxislauf auf der Spitze und das
Label `full-check` an der obersten PR.

---

## Selbstprüfung

**Abdeckung des Entwurfs (13, Zeile PR 10).**

| Entwurf | Task |
|---|---|
| `heatingSystem`, Teil und Ziel (5.3, 8.1) | 2, 5, 8, 12 |
| Wärme- und Warmwasserzähler, Zähler bei der Einrichtung (5.3, 11.2) | 3, 5, 11 |
| α gemessen (8.3, G-B1 abgelehnt), nur in kWh (Abweichung 10), ganze Heizperiode (Abweichung 11) | 4, 8 |
| Anteil mit Vorgabe aus der Vorperiode (§ 6 Abs. 4), § 7 Abs. 1 Satz 2 | 1, 4, 5, 9 |
| `heatedArea` nur Heizung (§ 7 Abs. 1 Satz 5, § 8 Abs. 1) | 3, 11 |
| § 9b mit Wert laut Gerät, Ablesung daneben, „nicht möglich / versäumt“ (3.5) | 3, 5, 9, 12, 13 |
| Ablesung neben dem Stichtag wie abgelesen (3.5, `practice.reading-off-warning`) | 1, 3, 9 |
| Leerstand, Eigennutzung, Pauschale (6.2, 6.3) | 3, 8, 9 |
| Gewichte und #202 (6.1) | 3, 8 |
| Vorrat und `fuelCarry` bei `self` (8.2, N1–N14) | 8, 10 |
| Wärmepumpe nach § 12 Abs. 3 mit Datum der Erfassung (F5, Abweichungen 1, 7) | 1, 4, 9, 11 |
| CO₂ nach Brennstoffanteil (9.4) | 8, 10 |
| Druckblock, Ableseergebnis (8.8 ohne § 6a, § 6 Abs. 1 Satz 2) | 9, 13 |
| Seite Heizkosten, Einrichtung Schritt 7 (11.2) | 11, 13 |
| Hinweise 10.1, Zeilen PR 10 | 8, 9 |
| F16, F17 (12.1) samt G-C5/N8 | 10 |
| Anleitung (11.4) | 14 |

Nicht in PR 10, mit Grund: Heizkostenverteiler und Werte eines Ablesedienstes (PR 12), Warmwasseranteil
nach Formel und Heizwert laut Rechnung (PR 11), mehr als 70 % nach Vereinbarung und § 6a (PR 14),
monatliche Verbrauchsinformation (PR 22). Jede Stelle sperrt mit einem Satz, der die spätere Version
nennt, und kein Test erwartet dort eine Zahl.

**Platzhalter.** Kein „TBD“, kein „später ergänzen“. ⟨Norm offen⟩ steht nur dort, wo der Entwurf
(15.1 bis 15.3) es vorgibt und der Kopf dieses Plans es aufzählt: Warngrenze der Ablesung
(`practice.reading-off-warning`, VDI 2077), Ablesung neben dem Wechsel, die zweite Lesart des
Warmwasseranteils im Lexikon und die Gradtagstabelle (`hkv.degree-days`, PR 3). Drei Stellen verlangen von der
ausführenden Sitzung einen Abgleich mit dem Code der Vorgänger, jede mit Regel: die Nähte N1 bis N16
(Abschnitt „Nähte zu PR 7 und PR 8“), die Antwortgestalt von `POST /api/heating-plants` (Task 11
Step 6) und die Namen der Testhelfer in `Kosten.test.tsx` (Task 12 Step 1).

**Typen.** `SelfWeights` (`heating`, `water`, `both`) aus Task 3 nutzen Task 8 und 9; `SelfInput` merkt
sich der Plan einer Anlage (Task 9 Step 4), damit `heating.change-split-time` mit denselben Daten nach
Gradtagen nachrechnet. `HeatingTarget` ist überall optional ohne `null` (wie `heatingPart`, PR 3) außer im
Rumpf des Formulars (`CostItemBody.heatingTarget: HeatingTarget | null`, wie `heatingPart`). Die
Routen aus Task 6 und die Rümpfe aus Task 11, 12 und 14 benutzen dieselben Feldnamen wie `setUpSelf`
(`period`, `heatConsumptionPct`, `insulationRule`, `hotWater`, `capture`, `areaBasisHeat`,
`dhwHeatMeter`, `totalHeatMeter`, `items[].heatingPart`, `items[].heatingTarget`).

**Review Focus ↔ Tests.**

| Punkt | Test |
|---|---|
| 1 Leerstand zwischen Mietern, Ablesung nur am Ende | heating.test.ts (Task 3), „Review Focus 1: Leerstand zwischen zwei Mietern …“ |
| 2 Ablesung 03.10. und 15.10. | heating.test.ts (Task 3), „Zwei Ablesungen neben dem Wechsel (03.10. und 15.10.) …“ und „Z-B3 …“; calc-heizkosten.test.ts (Task 9), „Z-B3 und Z-B1 …“ |
| 3 Umstellung mit Flächenpositionen | db-heizkosten.test.ts (Task 5), „Review Focus 3 …“; api.test.ts (Task 6); HeatingSelfSetup.test.tsx (Task 11) |
| 4 Wohnung ohne Wärmezähler | heating.test.ts (Task 3), „Review Focus 4 …“; calc-heizkosten.test.ts (Task 8), „Review Focus 4 …“ |
| 5 Gasrechnung mit Lücke | heating.test.ts (Task 4), „α: Formeln, Heizöl und Lücken …“; calc-heizkosten.test.ts (Task 8), „Review Focus 5 …“ |

**Rechtliche Prüfung der Abweichungen** (05.10.2026, nach dem ersten Stand dieses Plans eingearbeitet):

| Nr. | Befund der Prüfung | eingearbeitet in |
|---|---|---|
| 9 | gleicher Tag ist ein Befund (#69); Stetigkeit über H−1/H/H+1 und eingefrorener Anfangsstand; Bindung der Ablesung aus dem Mieterwechsel, Nähe nur als Rückfall (Festlegung nach Messdienst-Praxis); ab der Warngrenze wählt der Vermieter | Abweichungen 9, 22, 23; Task 2, 3, 5, 7, 8, 9, 13 |
| 15 | Kürzung bei einem Topf nach CO₂-Abzug; Ausweis druckt den Topfbetrag je Mieter vor und nach Abzug | Task 2 (`heatingCo2Cents`, `waterCo2Cents`), Task 9, Task 13 |
| 14 | Warmwasser nie still mit dem Anteil der Heizung (§ 8 Abs. 1) | Task 4, 5, 8, 11, 13 |
| 13 | Flüssiggas als Auslegung im Lexikon, mit Wortlaut, Systematik und BR-Drs. 570/08 | Abweichung 13, Task 1 (`consumptionCosts`) |
| 16 | Begründung über „oder zeitanteilig“ (§ 9b Abs. 2); Personen bleiben zeitanteilig | Abweichung 16, Task 9 Step 5 |
| 10/11 | Hinweis, dass α auf der Schätzung beruht | `heating.dhw-share-estimated`, Task 4, 8, 9 |
| 17 | 409 nennt die Kürzung nach § 12 Abs. 1 und § 6 Abs. 4 | Task 5 |
| 19 | Leitsatz, AGB-Frage offen, AG Berlin-Hohenschönhausen als Instanzgericht; Wasser als eigenes Issue nach Rückfrage | Abweichung 19, Task 9 |
| 20 | gerundeten Wert festnageln (1.916,68 €) | Abweichung 20, Task 10 |
| 7 | „ab dem Zeitraum, der nach dem TT.MM.JJJJ beginnt“ | Task 9 |

Offen für die Durchsicht (Hinweise der Prüfung, nicht gebaut): ein Erzeugerwechsel mitten in der
Heizperiode (Kessel durch Wärmepumpe, Nr. 1); ein Hinweis, wenn eingetragene und gemessene
Warmwasserwärme voneinander abweichen (Nr. 12); α auf Brennwertbasis ohne Faktor 1,11 bleibt
⟨Norm offen: VDI 2077⟩ (Nr. 10).

**Rechtszahlen.** 50, 70 und 15 % kommen aus `hkv.consumption-share`, `hkv.consumption-share-forced` und
`hkv.cut-not-by-consumption`; die Stichtage der Wärmepumpe aus `hkv.heat-pump.capture`; die Gradtage aus
`hkv.degree-days`. In `ENGINE_FILES` steht keine dieser Zahlen und kein Datum als Literal
(`law-literals.test.ts` in Task 1, 4, 9). Urteile stehen ohne Datum (LG Hamburg 11 S 202/87,
AG Schöneberg 104a C 226/05, BGH VIII ZR 19/07). Jede Festlegung ohne Grundlage im Entwurf steht unter
„Abweichungen“ (1 bis 23).
