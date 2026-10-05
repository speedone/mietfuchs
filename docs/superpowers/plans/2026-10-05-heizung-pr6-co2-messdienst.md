# Heizung PR 6: CO₂ beim Messdienst (#97, #209, #211) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Vermieter mit Messdienst oder Eigentümergemeinschaft trägt die CO₂-Angaben der
Heizkostenabrechnung ein; Mietfuchs prüft sie gegen seine Positionen, bucht den CO₂-Anteil des
Vermieters richtig (beim Vorwegabzug in der Position, beim reinen Ausweis als Abzugszeile je Mieter),
hält den privaten Teil exakt, druckt den Ausweis nach § 7 Abs. 3 CO2KostAufG und beziffert jede
Kürzung (3 % nach § 7 Abs. 4 CO2KostAufG, 15 % bei Warmwasser ohne Wärmezähler) je Mieter.

**Architecture:** Zwei neue Tabellen (`co2_statements` je Heizperiode, `co2_tenant_reliefs` je
Mietverhältnis) in einem erzeugten Schritt. Die Rechtswerte (Anwendbarkeit, Stufentabelle, Rundung,
3 %) kommen ins Rechtsregister (`shared/law/co2kostaufg.ts`). Die Probe steht einmal in
`shared/co2Probe.ts` (Server und Oberfläche), die übrige reine Rechnung in `server/src/co2.ts`;
`computeSettlement` bildet je Anlage und Heizperiode einen Topf, zerlegt beim Vorwegabzug den
Vermieterrest in `landlordRecipients` (L_self exakt in `selfUse`, `co2Share` über `take()`), legt
beim reinen Ausweis Zeilen `co2Relief` an und schreibt Hinweise und die Bewertung
(`Settlement.heating`). Lesen und Schreiben stehen in `server/src/db/co2.ts`, die Oberfläche bekommt
die Seite „Heizkosten“ mit den Karten „CO₂-Kosten“ und „Warmwasser“ und einen Druckblock.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.4, 0.5 (R-A5, R-A6, R-A8, R-A28, G-A3, G-A5, G-B2, G-B3, G-B5, G-B9), 0.6 (D-F2, D-F3, D-R6),
0.8 (B8), 0.9 (R3), 0.10 (R-b), 1.1 (W5, W9, W10), 1.2 Nr. 1, 2.1 (Rechtsgrundlagen), 3.9, 3.13,
4.2, 4.3 (`co2.applicable-from`, `co2.stage-table`, `co2.rounding-decimals`, `co2.cut.missing`), 4.4,
4.7, 5.1, 5.5, 5.7, 5.8, 5.9, 6.1 Nr. 4.3–4.5, 6.2, 6.4 Nr. 2, 6.5, **7 ganz**, 8.9 (Eigentumswohnung),
9.1, 9.2 (Nachstufung `service*`), 9.4 (Formel und Rechenbeispiele), 9.5, 10.1 (Codes mit PR 6), 10.2
(`co2-split`, `heating-dhw-split`), 10.3 (CO₂), 11.1, 11.3, 11.4, 12.1 (F06, F12, F15), 12.2 (G-B2,
G-B3, G-B5, B8, F2/F3, `co2.test.ts`), 12.3 Nr. 1, 8, 9, 14, 12.4, 13 (PR 0, PR 6), 14.1, 14.2,
15.1 Nr. 1, 3, 4, 15.2 F6, 16.

**Baut auf:** PR 1 (Code auf `feat/heizung-pr1-rechtsregister`, Plan
`docs/superpowers/plans/2026-10-05-heizung-pr1-rechtsregister.md`), PR 2 (Code teilweise auf
`feat/heizung-pr2-zeitraum`, Plan `…-pr2-zeitraum-kern.md`), PR 3 (`…-pr3-zeitraum-bedienung.md`),
PR 4 (`…-pr4-heizanlage.md`) und PR 5 (`…-pr5-heizperiode.md`, Commit `7a3d9b0`; seine Schnittstellen
stehen unten). Gearbeitet wird auf `feat/heizung-pr6-co2`,
abgezweigt von der Spitze von PR 5; der PR wird gestapelt auf PR 5 gestellt und nach dessen Merge
auf `main` umgestellt.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Heizanlage, ohne
  CO₂-Datensatz und mit Kalenderjahr bleibt jede Zahl centgenau gleich. Neu sind nur die
  angekündigten Hinweise `co2.fuel-unknown` und `co2.missing-first-year` (ohne Anlage) bzw.
  `co2.missing` (mit Anlage) bei Heizpositionen in Zeiträumen ab dem 01.01.2023, mit dem Knopf
  „Heizung einrichten →“.
- **Golden:** F01–F11 bleiben wortgleich, **auch F06** (Abweichung vom Entwurf 12.1, G-A5): Seine
  Position trägt die Kostenart „Heizung“ und ist für die Berechnung keine Heizposition
  (`HEATING_CATEGORY` ist „Heizung und Warmwasser“). Den angekündigten Hinweis halten Tests wörtlich
  fest (Task 9). Keine Zahl ändert sich.
- **Rechtswerte nur aus dem Register** (Entwurf 4.3, 4.7): Die Stufentabelle der Anlage, der
  01.01.2023, die Rundung auf eine Nachkommastelle und die 3 % stehen nur in
  `shared/law/co2kostaufg.ts`. `server/src/co2.ts` kommt in `ENGINE_FILES` von
  `law-literals.test.ts`; die erlaubte Stelle `shared/guides.ts` „3 Prozent“ entfällt (der Text liest
  `co2.cut.missing`). Ein Parameter kommt mit der PR, die ihn nutzt (G-C7): hier genau
  `co2.applicable-from`, `co2.stage-table`, `co2.rounding-decimals`, `co2.cut.missing`.
- **Fassungen nie ändern** (4.4): Die neuen Fassungen bekommen je eine Zeile in
  `law-history.test.ts`; keine bestehende Zeile ändert sich.
- **Sperren, 400 mit einem Satz** (13 PR 6, W7): CO₂-Methode `self` (eigene Aufteilung, PR 7) und
  jede CO₂-Angabe an einer Anlage mit freien Schlüsseln (`manual`) werden abgelehnt; Lieferungen
  gibt es in dieser PR nicht (keine Route, kein Feld). Jeder Satz sagt, was bis dahin geht.
- **Messdienst-Probe** (7.3): nur über die Messdienstpositionen des Topfs (Schlüssel `amounts`);
  `serviceDeducted`: Σ = S + L ± 1 ct; `serviceShown`: Σ = S; beide: Σ eingetragene Einzel- und
  Eigenbeträge ≤ S + NE · 2 ct. Scheitert sie, wird für diese Heizperiode **nichts** gebucht.
- **L_self exakt, `co2Share` über `take()`** (7.4, G-B2, #203): Der private Teil steht in `selfUse`
  und wird nie gekürzt; nur `co2Share` wird durch den Rest begrenzt.
- **Kürzungsbeträge** (6.5): je Mieter einzeln, nie summiert, `round(Satz × Summe der gedruckten
  Zeilen des Mieters im Topf nach der Abzugszeile)`, kaufmännisch. Kein Betrag wird abgezogen.
- **Stufe hängt am Code** (#112): Jeder neue Code steht mit genau einer Stufe in `noticeKinds` und
  trägt mindestens einen Begriff des Lexikons.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name co2_messdienst`, nie von
  Hand. Ein Schritt, denn es entstehen nur neue Tabellen (keine geänderte Bedingung an einer
  bestehenden Tabelle; README „Neue Spalten und geänderte Bedingungen nie in einem Schritt“). Er
  folgt auf `0020_heizperiode` (PR 5, ein Schritt) und heißt deshalb `0021_co2_messdienst` (die Nummer
  vergibt drizzle-kit).
  Die Marke kommt in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben
  unverändert; die db.json kennt keine CO₂-Angaben.
- **Objektgrenze:** Ein Betrag „vom Vermieter übernommen“ gehört zu einem Mietverhältnis desselben
  Objekts wie die Anlage; sonst `CrossPropertyError` (400), beim Wiederherstellen ein Befund.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und
  `NKA_UPDATE_URL` (geschlossener Port); in api.test.ts erledigt das `startServer`, beim Smoke-Test
  der Aufruf von Hand (Task 14).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #97` (dazu `#209` beim
  Vorwegabzug, `#211` beim Warmwasser) und endet mit den Attribution-Zeilen der ausführenden
  Sitzung.

## Review Focus

1. **Der Vermieter folgt der alten Anleitung und trägt den CO₂-Anteil seiner eigenen Wohnung schon
   in deren Eigenbetrag ein (620,69 € statt 600 €) und füllt dann die CO₂-Karte aus.** Erwartet:
   Die Probe sieht Einzel- und Eigenbeträge über S und meldet `co2.sum-check`, statt den Anteil ein
   zweites Mal privat zu buchen. Test in Task 7.
2. **Eine Gutschrift des Versorgers oder eine Wartung steht mit anderem Schlüssel im Topf der
   Heizanlage.** Erwartet: Die Probe zählt sie nicht mit, sie wird wie bisher verteilt, und es gibt
   nur den Hinweis `co2.pool-foreign-item`. Test in Task 7.
3. **Ein Mieter hat eine Heizpauschale oder Warmmiete, ein anderer wird abgerechnet, und der
   Messdienst weist die CO₂-Kosten nur aus.** Erwartet: Nur wer eine Heizzeile hat, bekommt eine
   Abzugszeile; der Teil des Pauschalmieters bleibt beim Vermieter, und Σ aller Zeilen bleibt gleich
   Σ der Positionen. Test in Task 8.
4. **Ein Mietverhältnis mit eingetragenem Betrag „vom Vermieter übernommen“ wird gelöscht, wechselt
   in ein anderes Objekt, oder ein Archiv bringt einen solchen Betrag für ein Mietverhältnis eines
   fremden Objekts.** Erwartet: Löschen nimmt den Betrag mit (CASCADE), der Wechsel wird mit einem
   Satz abgelehnt, das Archiv vor dem Ersetzen. Tests in Task 5.
5. **Die Heizanlage soll entfernt werden, nachdem CO₂-Angaben erfasst sind.** Erwartet: 409 mit den
   Heizperioden, statt die Angaben still mitzulöschen (CASCADE über `heating_periods`). Test in
   Task 5.

---
## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/co2kostaufg.ts` (neu), `shared/law/params.ts`, `shared/law/rules.ts` | Parameter des CO2KostAufG, Regeln `co2-split` und `heating-dhw-split` | 1 |
| `shared/types.ts` | `Co2Method`, `Co2Statement`, `Co2TenantRelief`, `Co2Assessment`, `Co2TenantLine`, `HeatingStatement`, `HeatingPeriodView`; `SettlementRow.kind`, `LandlordReason` + `co2Share`, `NoticeSubject` + `heatingCosts`, `Settlement.heating` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/0021_co2_messdienst.sql`, `meta/*` (erzeugt) | Tabellen `co2_statements`, `co2_tenant_reliefs` | 2 |
| `client/src/landlordReasons.ts`, `client/src/notices.ts` | Beschriftung `co2Share`, Ziele `heatingCosts` und „Heizung einrichten →“ | 2 |
| `shared/glossary.ts` | Begriffe `co2Split`, `co2Stage`, `co2Area`, `co2Deducted`, `hotWaterShare` | 3 |
| `shared/co2Probe.ts` (neu) | Die Probe nach 7.3, für Server und Oberfläche | 4 |
| `server/src/co2.ts` (neu) | Einstufung, Nachstufung, Eigenanteil, Abzugsbeträge, Töpfe | 4, 7 |
| `server/src/db/read.ts` | `readCo2Statements`, `readHeatingPeriodRows`, `Stock` | 5 |
| `server/src/db/co2.ts` (neu) | Heizperioden einer Anlage, CO₂-Angaben und Warmwasser lesen und schreiben | 5 |
| `server/src/db/repository.ts`, `server/src/db/heating.ts` | Objektgrenze der Beträge, Entfernen einer Anlage mit CO₂-Angaben | 5 |
| `server/src/index.ts` | Routen unter `/api/heating-plants/:id/periods` | 6 |
| `server/src/snapshot.ts`, `server/src/calc.ts` | Schnappschuss, Töpfe, Vorwegabzug, Abzugszeilen, Hinweise, `Settlement.heating` | 7, 8, 9 |
| `server/testing/co2.ts` (neu) | `withoutCo2` für Tests, die „ändert sonst nichts“ prüfen | 9 |
| `server/test/fixtures/heating/F12-…/`, `…/F15-…/README.md` (neu), `server/test/heating-golden.test.ts` (neu) | Golden F12 und F15 | 10 |
| `client/src/co2Form.ts` (neu), `client/src/heatingForm.ts`, `client/src/components/Co2Card.tsx` (neu), `client/src/components/HotWaterCard.tsx` (neu), `client/src/pages/Heizkosten.tsx` (neu), `client/src/nav.ts`, `client/src/App.tsx`, `shared/guides.ts` (`GUIDE_PAGES`) | Seite Heizkosten | 11 |
| `client/src/co2View.ts` (neu), `client/src/components/Co2Block.tsx` (neu), `client/src/pages/Abrechnung.tsx`, `client/src/tenantFolder.ts` | Druckblock, Zeilen ohne Position | 12 |
| `shared/guides.ts`, `server/test/guides.test.ts` | Anleitung `meteringService` (#216) passend zu Text und Probe, neue Anleitung „CO₂-Kosten aufteilen“ | 13 |
| `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung der Programmdateien, Doku | 14 |
| Tests: `server/test/law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `schema.test.ts`, `migrations.test.ts`, `glossary.test.ts`, `co2.test.ts` (neu), `db-co2.test.ts` (neu), `api.test.ts`, `calc-co2.test.ts` (neu), `calc-heizanlage.test.ts`, `db-stock.test.ts`, `client/src/co2Form.test.ts` (neu), `client/src/heatingForm.test.ts`, `client/src/co2View.test.ts` (neu), `client/src/components/Co2Card.test.tsx` (neu), `client/src/nav.test.ts` (neu), `client/src/notices.test.ts`, `client/src/landlordReasons.test.ts`, `client/src/tenantFolder.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Aus dem Code von PR 1 (`feat/heizung-pr1-rechtsregister`, Stand `4486950`) und den Plänen von PR 2
bis PR 4; Namen genau so:

- `shared/law/register.ts`: `LawParam<T, M>` mit `describe(value)`, `law(param, ctx, log)` mit den
  Überladungen `periodStart` (`{ period: { from, to } }` → `T`), `eventDate`, `overlap`;
  `createLawLog()`, `LawLog`, `valueAt(param, date)`, `versionAt`, `onlyVersion`, `germanDate`,
  `LAW_AS_OF`; `Source`. `shared/law/params.ts`: `LAW_PARAMS` (ein Test verlangt jede
  `LawParam`-Konstante dort). `shared/law/heizkostenv.ts`: `hkvCutNotByConsumption`
  (`LawParam<number, 'periodStart'>`, 15). `shared/law/rules.ts`: `RULES`, `RULES_AS_OF`,
  `rulesFor`, `Rule`.
- `server/test/law-literals.test.ts`: `ENGINE_FILES`, `ALLOWED` (mit dem Eintrag
  `shared/guides.ts` „3 Prozent“, Grund „`co2.cut.missing` kommt mit PR 6“).
- In `computeSettlement` (PR 1, PR 2): `lawLog`, `lawPeriod`, `yFrom`, `yTo`, `items`,
  `statements` (`Map<string, Statement>`), `landlordRows`, `partTenancies`, `outsideHeating(unit)`,
  `warn(code, text, subject?)`, `itemSubject`, `fmtCents`, `fmtDay`, `fmtNum`, `fmtExactEuro`,
  `andList`, `notices`, der Satz `notices.splice(tvAt, 0, ...tvNotices())` hinter der Schleife über
  die Positionen, der Zweig `} else if (item.key === 'amounts') {` mit `selfRaw = selfSum`, die
  Funktion `landlordRecipients(item, p)` mit `take()`, `distributeCents(totalCents, recipients)`
  (exportiert), `HEATING_CATEGORY` (aus `shared/heating.ts`). `snapshot.period` ist ein
  `BillingPeriod` (PR 2).
- `shared/period.ts` (PR 2): `PeriodKey`, `BillingPeriod`, `PeriodRules`, `periodKey`,
  `parsePeriodKey`, `periodOfKey`, `periodContaining`, `periodsBetween`, `periodLabel`, `periodDays`,
  `rulesOf`, `resolvePeriodParam(rules, text)`; `snapshotOf(source, year)`,
  `snapshotFor(source, propertyId, period)`; `closedSettlements.period`; `properties.periodStartMonth`.
- PR 3: `CostItem.heatingPart?: HeatingPart`; `usePeriod(): PeriodView` mit `key`, `label`,
  `param`, `period` (`client/src/period.tsx`); `applyPeriodChange` wird hier nicht gebraucht.
- PR 4: Tabellen `heatingPlants`, `heatingPlantUnits`, `heatingPeriods` (mit `dhwMethod`,
  `dhwUnmeasurable`), Liste `DHW_METHODS`; Typen `HeatingPlant` (mit `name`, `energy`, `method`,
  `source`, `periodStartMonth`, `units`), `HeatingPeriodData`, `HeatingEnergy`, `HeatingMethod`,
  `HeatingSource`, `DhwMethod`; in repository.ts `HeatingError(status, message)`, `has`, `raw`,
  `merged`, `oneOfOrUndefined`, `asNullableFilled`, `sameProperty`, `CrossPropertyError`,
  `crossPropertyViolations`, `guardTenancy`; in read.ts `readHeatingPlants`, `Stock.heatingPlants`;
  in `server/src/db/heating.ts` `createHeatingPlant(db, id, propertyId, body)`,
  `removeHeatingPlant(db, id): Promise<PlantRemoval>`; Route `DELETE /api/heating-plants/:id`;
  `SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'method' | 'source' | 'devicesRemote' |
  'devicesInstalledAfter2021' | 'units'>`, `Snapshot.heatingPlants?`; im Client `heatingForm.ts`
  mit `ENERGY_OPTIONS: { value: HeatingEnergy; label: string }[]`, Komponente `HeatingCard` in den
  Stammdaten; Tests `calc-heizanlage.test.ts` (Helfer `plant()`, Test „Anlage mit Vorgaben: jede
  Abrechnung bleibt gleich, über das ganze Ergebnis“) und in `api.test.ts` „Heizanlage: anlegen samt
  Zuordnung offener Heizpositionen, und die Abrechnung bleibt gleich“; im Smoke-Test
  `heatingPlant()`.

**Aus dem Plan von PR 5** (`docs/superpowers/plans/2026-10-05-heizung-pr5-heizperiode.md`, Commit
`7a3d9b0`); die früheren Annahmen A1–A6 dieses Plans sind damit ersetzt:

- **Schnappschuss (statt A1, A5):** `snapshotFor` legt die Positionen einer Anlage **mit eigener
  Heizperiode** nicht in `costItems`, sondern je Heizperiode, die in P endet, in
  `Snapshot.heatingParts?: SnapshotHeatingPart[]` (`{ plantId, period, previous, items, previousItems,
  separate }`). `computeSettlement` rechnet jede nicht getrennte davon für sich, mit
  `scope: { kind: 'heatingPart', plant }`, `period: part.period` und `costItems: part.items`, und
  führt das Ergebnis mit `mergeHeatingPart(sub, part)` in P zusammen; eine Heizperiode mit
  `separate: true` (Weg d) steht nicht in P, sondern hat ihren eigenen Schnappschuss
  `heatingSnapshotFor(source, propertyId, plantId, h)` mit `scope: { kind: 'heating', plant }`.
  `Snapshot.scope?: SnapshotScope`, `Snapshot.objectRules?: PeriodRules`. **Folge für diesen Plan:**
  In jeder Berechnung ist die Heizperiode der Zeitraum der Berechnung (`snapshot.period`), und der Topf
  einer Anlage sind die Positionen in `items` mit ihrer Kennung und dem Schlüssel dieses Zeitraums. Die
  CO₂-Rechnung braucht deshalb keine eigene Liste von Heizperioden; sie läuft in P, in der
  Teilabrechnung nach Weg b und in der Heizkostenabrechnung nach Weg d gleich. Was sie in einer
  Teilabrechnung erzeugt (Zeilen, Hinweise, Rechtswerte), führt `mergeHeatingPart` zusammen; nur
  `heating` ergänzt Task 7 dort.
- **`SnapshotCostItem` enthält `heatingPlantId`** (A2, erfüllt).
- **`SnapshotHeatingPlant`** ist `Pick<HeatingPlant, 'id' | 'method' | 'source' | 'devicesRemote' |
  'devicesInstalledAfter2021' | 'units'> & Partial<Pick<HeatingPlant, 'name' | 'periodStartMonth' |
  'periodChanges' | 'separateSpans' | 'separateSettlement'>>`; dieser Plan nimmt `energy` in den
  Pflichtteil auf.
- **Rhythmus der Anlage (statt A3):** `HeatingPlant.periodChanges: string[]` (aus
  `heating_period_changes`, `readHeatingPlants` füllt es) und `HeatingPlant.separateSpans`
  (`heating_separate_spans`); in `shared/heatingPeriod.ts` `plantRules(plant, objectRules)`,
  `heatingPeriodsEndingIn(rules, p)` und `settledSeparately(way, objectRules, h)`; `wayOf(p)` in
  snapshot.ts.
- **Abschluss nach Weg d (statt A4):** Tabelle `closedHeatingSettlements` (`closed_heating_settlements`,
  `plantId`, `period`). Eine getrennt abgerechnete Heizperiode schließt **nur** über sie, der Abschluss
  von P friert sie nicht ein (B3); die übrigen über die Abrechnung von P, die ihr Ende enthält.
- **Hinweisziel:** PR 5 hat `NoticeSubject['kind']` schon um `'heatingPlant'` ergänzt und
  `TARGETS.heatingPlant` auf die Stammdaten gesetzt (für `period.no-heating-period` u. a., deren
  Behebung dort liegt). Dieser Plan lässt das so und gibt den CO₂-Hinweisen ein eigenes Ziel
  `'heatingCosts'` (Seite Heizkosten).
- **Migration (statt A6):** PR 5 erzeugt nur `0020_heizperiode`; der Schritt hier ist `0021`.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **F06 bleibt wortgleich** (Entwurf 1.2 Nr. 1, 12.1, G-A5 erwarten `co2.fuel-unknown`): Die Position
   von F06 hat die Kostenart „Heizung“, nicht „Heizung und Warmwasser“, und ist deshalb für die
   Berechnung keine Heizposition, wie schon für die Regeln aus #140 (Task 9 Step 6).
2. **Spalte `service_users_total_approx`** an `co2_statements`: Der Rückfall „Ich finde diese Zeile
   nicht“ (7.3, R6) muss gespeichert sein, sonst wüsste die Berechnung nicht, ob die Probe ein Fehler
   oder ein Hinweis ist; die Spaltenliste in 5.5 nennt sie nicht.
3. **Abzug nach Brennstoffanteil (9.4, B8, G-B5)** kommt hier als reine Funktion `reliefsByShare` mit
   den Rechenbeispielen 232,14 / 139,28 / 92,85 € und B1 (Task 4); beim reinen Ausweis rechnet sie den
   Rückfall L · x / S. Für `manual` und `self` (x aus den Brennstoffpositionen) braucht es C aus den
   Lieferungen, also PR 7.
4. **Anlage mit CO₂-Angaben entfernen:** 409 statt stillem Mitlöschen über CASCADE (Entwurf schweigt;
   „nie Daten verlieren“, CLAUDE.md).
5. **Ausweis „in Ihren Heizkosten enthalten“** (7.4): (C − L) · x / S, im Druck als Näherung nach dem
   Anteil an den Heizkosten benannt; „vom Vermieter übernommen“ laut Messdienst, sonst L · x / S.
6. **Hinweise ohne Angaben nur, wenn jemand über die Heizung abgerechnet wird:** Bei Pauschale und
   Warmmiete gibt es keine Heizkostenabrechnung, die der Mieter kürzen könnte (15.1 Nr. 15).
7. **Nachstufung bei § 9:** Der Techem-Anteil von 35 % ist nach § 9 CO2KostAufG halbiert; bis PR 7 die
   Einschränkungen kennt, meldet `co2.stage-mismatch` das als Hinweis und nennt § 8 und § 9.
8. **Musterabrechnungen:** Nur das Techem-Muster liegt vor; ista, Brunata, Minol und KALO nennt die
   Anleitung ohne Muster, wie der Entwurf (7.3) es für diesen Fall vorsieht.
9. **Ein Migrationsschritt statt zwei** (`0021_co2_messdienst`): Es entstehen nur neue Tabellen.
10. **Smoke-Test liest `2025`** statt `2025-05` (12.4), weil sein Objekt im Kalenderjahr rechnet; Mai
    bis April prüfen F12 und api.test.ts.

---
### Task 1: Rechtsregister: CO2KostAufG und zwei Regeln

Vier Parameter (Entwurf 4.3, Spalte „PR 6“) und die Regeln `co2-split` und `heating-dhw-split`
(10.2). Wortlaut am 05.10.2026 gelesen: § 5 Abs. 1, § 7 Abs. 1, 3, 4, § 11 Abs. 2 und die Anlage
CO2KostAufG auf gesetze-im-internet.de; Vollzitat: Gesetz vom 05.12.2022 (BGBl. I S. 2154), geändert
durch Art. 5 G v. 23.07.2026 (BGBl. 2026 I Nr. 226); Fundstelle der Anlage BGBl. I 2022, 2159.

**Files:**
- Create: `shared/law/co2kostaufg.ts`
- Modify: `shared/law/params.ts`, `shared/law/rules.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`

**Interfaces:**
- Consumes (PR 1): `LawParam`, `Source`, `germanDate`, `valueAt`, `LAW_AS_OF`, `hkvCutNotByConsumption`.
- Produces:
  - `type Co2Stage = { readonly from: number; readonly landlordPercent: number }`
  - `co2ApplicableFrom: LawParam<boolean, 'periodStart'>` (`'co2.applicable-from'`), `co2StageTable: LawParam<readonly Co2Stage[], 'periodStart'>` (`'co2.stage-table'`), `co2RoundingDecimals: LawParam<number, 'periodStart'>` (`'co2.rounding-decimals'`), `co2CutMissing: LawParam<number, 'periodStart'>` (`'co2.cut.missing'`)
  - `co2FirstPeriodStart(): string` (`'2023-01-01'`)
  - Regeln `co2-split` (`validFrom` = `co2FirstPeriodStart()`) und `heating-dhw-split` in `RULES`; `RULES_AS_OF = '2026-10-05'`

- [ ] **Step 1: Write the failing tests**

In `server/test/law.test.ts` die Importe ergänzen:

```ts
import { co2ApplicableFrom, co2CutMissing, co2FirstPeriodStart, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { RULES } from '../../shared/law/rules.ts'
```

(`RULES_AS_OF` steht schon im Import aus `rules.ts`; dann nur `RULES` dazunehmen.) Ans Ende anhängen:

```ts
// ---------- CO2KostAufG (Heizung PR 6) ----------

test('co2.applicable-from: Zeitraum ab Dezember 2022 nicht anwendbar, ab Januar 2023 schon (§ 11 Abs. 2 Satz 1, Entwurf 4.7)', () => {
  const log = createLawLog()
  // Zeiträume beginnen am Monatsersten; deshalb `2022-12` gegen `2023-01` (G-F).
  assert.equal(law(co2ApplicableFrom, { period: { from: '2022-12-01', to: '2023-11-30' } }, log), false)
  assert.equal(law(co2ApplicableFrom, { period: { from: '2023-01-01', to: '2023-12-31' } }, log), true)
  assert.equal(co2FirstPeriodStart(), '2023-01-01')
  assert.deepEqual(log.values.map((v) => [v.id, v.value]), [['co2.applicable-from', false], ['co2.applicable-from', true]])
})

test('co2.stage-table: zehn Stufen, unten einschließend, Vermieteranteil 0 bis 95 % (Anlage CO2KostAufG)', () => {
  const table = valueAt(co2StageTable, LAW_AS_OF)
  assert.deepEqual(table.map((s) => [s.from, s.landlordPercent]), [
    [0, 0], [12, 10], [17, 20], [22, 30], [27, 40], [32, 50], [37, 60], [42, 70], [47, 80], [52, 95],
  ])
  assert.equal(valueAt(co2RoundingDecimals, LAW_AS_OF), 1)
  assert.equal(valueAt(co2CutMissing, LAW_AS_OF), 3)
  assert.equal(co2StageTable.describe(table), '10 Stufen, Vermieteranteil 0 bis 95 %')
})

test('Regeln: CO₂-Aufteilung ab dem Beginn der Anwendbarkeit, Warmwasser mit Wärmezähler ohne Grenze', () => {
  const co2 = RULES.find((r) => r.code === 'co2-split') ?? assert.fail('Regel co2-split fehlt')
  assert.equal(co2.validFrom, co2FirstPeriodStart())
  assert.equal(co2.norm, '§§ 5, 7, 11 CO2KostAufG')
  assert.match(co2.summary, /am oder nach dem 01\.01\.2023 beginnen/)
  assert.match(co2.summary, /um 3 % kürzen/)
  const dhw = RULES.find((r) => r.code === 'heating-dhw-split') ?? assert.fail('Regel heating-dhw-split fehlt')
  assert.equal(dhw.norm, '§ 9 Abs. 2 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20')
  assert.match(dhw.summary, /um 15 % kürzen/)
  assert.equal(dhw.validFrom, undefined)
  assert.equal(RULES_AS_OF, '2026-10-05')
})
```

In `server/test/law-history.test.ts` in `SHIPPED` hinter der letzten Zeile von PR 1 (bzw. der von
PR 3 und PR 4, wenn sie dort schon stehen) einfügen:

```ts
  // 0.11.0 (Heizung PR 6)
  'co2.applicable-from||2022-12-31|false',
  'co2.applicable-from|2023-01-01||true',
  'co2.cut.missing|||3',
  'co2.rounding-decimals|||1',
  'co2.stage-table|||[{"from":0,"landlordPercent":0},{"from":12,"landlordPercent":10},{"from":17,"landlordPercent":20},{"from":22,"landlordPercent":30},{"from":27,"landlordPercent":40},{"from":32,"landlordPercent":50},{"from":37,"landlordPercent":60},{"from":42,"landlordPercent":70},{"from":47,"landlordPercent":80},{"from":52,"landlordPercent":95}]',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts`
Expected: FAIL mit `Cannot find module '…/shared/law/co2kostaufg.ts'`.

- [ ] **Step 3: Parameter (`shared/law/co2kostaufg.ts`)**

```ts
// Parameter des CO2KostAufG (Heizung PR 6, Entwurf 4.3). Wortlaut geprüft am 05.10.2026 auf
// gesetze-im-internet.de: Gesetz vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v.
// 23.07.2026 (BGBl. 2026 I Nr. 226). Die übrigen Parameter des Gesetzes kommen mit der PR, die sie
// nutzt (G-C7): § 8 und § 9 mit PR 7, Preise mit PR 17, §§ 5a, 5b, 5d mit PR 18, § 6 mit PR 19.
import type { LawParam, Source } from './register.ts'

const ENACTED = 'CO2KostAufG vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v. 23.07.2026 (BGBl. 2026 I Nr. 226)'
const BASE = 'https://www.gesetze-im-internet.de/co2kostaufg/'
const checked = (cite: string, page: string): Source => ({ rank: 'law', cite, url: `${BASE}${page}`, retrieved: '2026-10-05', checked: 'checked' })

// Die Aufteilung gilt für Abrechnungszeiträume der Wärme- und Warmwasserkosten, die am oder nach
// dem 01.01.2023 beginnen (§ 11 Abs. 2 Satz 1). `periodStart`: Es zählt der Beginn der
// Heizperiode. Die Fassung davor sagt „nicht anwendbar“, damit die Fassungen lückenlos sind und ein
// Zeitraum von 2022 eine Antwort bekommt statt eines Programmfehlers.
export const co2ApplicableFrom: LawParam<boolean, 'periodStart'> = {
  id: 'co2.applicable-from',
  title: 'Aufteilung der CO₂-Kosten anwendbar',
  norm: '§ 11 Abs. 2 Satz 1 CO2KostAufG',
  timing: 'periodStart',
  versions: [
    { validTo: '2022-12-31', value: false, source: checked('§ 11 Abs. 2 Satz 1 CO2KostAufG', '__11.html'), enacted: ENACTED },
    { validFrom: '2023-01-01', value: true, source: checked('§ 11 Abs. 2 Satz 1 CO2KostAufG', '__11.html'), enacted: ENACTED },
  ],
  describe: (v) => (v ? 'anwendbar (Zeitraum beginnt am oder nach dem 01.01.2023)' : 'nicht anwendbar (Zeitraum beginnt vor dem 01.01.2023)'),
}

// Der erste Tag, an dem ein Zeitraum beginnen kann, für den die Aufteilung gilt. Für Texte und für
// den Hinweis zum ersten Jahr; gerechnet wird mit `law(co2ApplicableFrom, …)`.
export function co2FirstPeriodStart(): string {
  const first = co2ApplicableFrom.versions.find((v) => v.value)?.validFrom
  if (!first) throw new Error('Rechtsregister: Beginn der CO₂-Aufteilung fehlt')
  return first
}

// Eine Stufe der Einstufungstabelle: ab `from` kg CO₂ je m² Wohnfläche und Jahr (einschließlich)
// bis zur nächsten Stufe (ausschließlich), mit dem Anteil des Vermieters in Prozent; der Anteil des
// Mieters ist der Rest auf 100.
export type Co2Stage = { readonly from: number; readonly landlordPercent: number }

// Anlage zu §§ 5 bis 7 (BGBl. I 2022, 2159): „< 12“ 100/0, „12 bis < 17“ 90/10 … „> = 52“ 5/95.
export const co2StageTable: LawParam<readonly Co2Stage[], 'periodStart'> = {
  id: 'co2.stage-table',
  title: 'Stufentabelle der CO₂-Kosten',
  norm: 'Anlage zu §§ 5 bis 7 CO2KostAufG',
  timing: 'periodStart',
  versions: [{
    value: [
      { from: 0, landlordPercent: 0 },
      { from: 12, landlordPercent: 10 },
      { from: 17, landlordPercent: 20 },
      { from: 22, landlordPercent: 30 },
      { from: 27, landlordPercent: 40 },
      { from: 32, landlordPercent: 50 },
      { from: 37, landlordPercent: 60 },
      { from: 42, landlordPercent: 70 },
      { from: 47, landlordPercent: 80 },
      { from: 52, landlordPercent: 95 },
    ],
    source: checked('Anlage CO2KostAufG (BGBl. I 2022, 2159)', 'anlage.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v.length} Stufen, Vermieteranteil ${v[0]?.landlordPercent ?? 0} bis ${v.at(-1)?.landlordPercent ?? 0} %`,
}

// Der spezifische Ausstoß ist auf die erste Nachkommastelle zu runden (§ 5 Abs. 1 Satz 3).
export const co2RoundingDecimals: LawParam<number, 'periodStart'> = {
  id: 'co2.rounding-decimals',
  title: 'Rundung des CO₂-Ausstoßes je m²',
  norm: '§ 5 Abs. 1 Satz 3 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 1, source: checked('§ 5 Abs. 1 Satz 3 CO2KostAufG', '__5.html'), enacted: ENACTED }],
  describe: (v) => `auf ${v} Nachkommastelle${v === 1 ? '' : 'n'}`,
}

// Bestimmt der Vermieter den Anteil des Mieters nicht oder weist er die Angaben nach Abs. 3 nicht
// aus, darf der Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 7 Abs. 4).
export const co2CutMissing: LawParam<number, 'periodStart'> = {
  id: 'co2.cut.missing',
  title: 'Kürzung bei fehlender CO₂-Aufteilung',
  norm: '§ 7 Abs. 4 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 3, source: checked('§ 7 Abs. 4 CO2KostAufG', '__7.html'), enacted: ENACTED }],
  describe: (v) => `${v} %`,
}
```

`shared/law/params.ts`: importieren

```ts
import { co2ApplicableFrom, co2CutMissing, co2RoundingDecimals, co2StageTable } from './co2kostaufg.ts'
```

und in `LAW_PARAMS` (die Liste ist nach Kennung geordnet) hinter `betrkvTvSignal` einfügen:

```ts
  co2ApplicableFrom,
  co2CutMissing,
  co2RoundingDecimals,
  co2StageTable,
```

- [ ] **Step 4: Regeln (`shared/law/rules.ts`)**

Importe ergänzen:

```ts
import { co2CutMissing, co2FirstPeriodStart } from './co2kostaufg.ts'
```

Unter `const remoteCut = …`:

```ts
const CO2_FROM = co2FirstPeriodStart()
const co2Cut = valueAt(co2CutMissing, LAW_AS_OF)
```

`RULES_AS_OF` auf `'2026-10-05'` setzen. In `RULES` hinter der Regel `heating-remote-reading`
anhängen:

```ts
  {
    // Heizung PR 6 (#97): Wortlaut §§ 5, 7, 11 und Anlage CO2KostAufG geprüft am 05.10.2026. Bei
    // Nichtwohngebäuden (§ 8) und Einschränkungen (§ 9) gelten eigene Regeln; sie kommen mit PR 7.
    code: 'co2-split',
    title: 'Aufteilung der CO₂-Kosten',
    norm: '§§ 5, 7, 11 CO2KostAufG',
    summary:
      `Für Abrechnungszeiträume, die am oder nach dem ${germanDate(CO2_FROM)} beginnen, werden bei Wohngebäuden die CO₂-Kosten der Heizung zwischen Vermieter und Mieter aufgeteilt, ` +
      'und zwar nach dem CO₂-Ausstoß des Gebäudes je Quadratmeter Wohnfläche und Jahr: Je höher der Ausstoß, desto größer der Anteil des Vermieters (Stufentabelle in der Anlage des Gesetzes). ' +
      `Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um ${co2Cut} % kürzen.`,
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 6 (#211): § 9 Abs. 2 HeizkostenV im Wortlaut geprüft am 05.10.2026; das Urteil
    // kürzt den gesamten Anteil an Heiz- und Warmwasserkosten (Entwurf R-A6, G-B9).
    code: 'heating-dhw-split',
    title: 'Warmwasser mit Wärmezähler',
    norm: '§ 9 Abs. 2 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20',
    summary:
      'Versorgt die Heizung auch das Warmwasser, ist die Wärme für das Warmwasser mit einem Wärmezähler zu messen. ' +
      'Eine Formel darf nur verwenden, wer sie nur mit unzumutbar hohem Aufwand messen könnte. ' +
      `Wird ohne diesen Grund nach einer Formel abgerechnet, darf der Mieter seinen gesamten Anteil an den Heiz- und Warmwasserkosten um ${cut} % kürzen.`,
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-literals.test.ts test/law-wording.test.ts test/rechtstexte.test.ts test/law-release.test.ts && npm run typecheck`
Expected: PASS. Prüft `law-wording.test.ts` oder `rechtstexte.test.ts` die Liste der Regelcodes
wörtlich (`RULES.map((r) => r.code)`), dort `'co2-split', 'heating-dhw-split'` am Ende ergänzen; der
Wortlaut der bestehenden Regeln ändert sich nicht.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS. Ein Test, der `legalBasis.rules` einer Abrechnung ab 2023 wörtlich vergleicht
(etwa in `calc-notices.test.ts`), bekommt die Regel `co2-split` hinter `heating-remote-reading`
bzw. an der Stelle, an der `rulesFor` sie liefert, in seine Erwartung: Der Rechtsstand nennt jede
Regel, die im Zeitraum gilt, und diese gilt ab 2023. Andere Erwartungen ändern sich nicht.

```bash
git add shared/law/co2kostaufg.ts shared/law/params.ts shared/law/rules.ts server/test/law.test.ts server/test/law-history.test.ts server/test
git commit -m "Rechtsregister: CO2KostAufG mit Anwendbarkeit, Stufentabelle, Rundung und 3 %

Dazu die Regeln co2-split (§§ 5, 7, 11 CO2KostAufG) und heating-dhw-split (§ 9 Abs. 2
HeizkostenV, BGH VIII ZR 151/20).

Refs #97, #211"
```

---

### Task 2: Datenmodell und Migration

Zwei neue Tabellen in einem erzeugten Schritt (nur neue Tabellen, keine geänderte Bedingung) und
die Typen, die Berechnung, Routen und Oberfläche teilen.

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `client/src/landlordReasons.ts`, `client/src/notices.ts`
- Create (erzeugt): `server/drizzle/0021_co2_messdienst.sql`, `server/drizzle/meta/0021_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `client/src/landlordReasons.test.ts`, `client/src/notices.test.ts`

**Interfaces:**
- Consumes (PR 4): `heatingPeriods`, `costItems`, `tenancies`, `exactly`, `oneOf`, `notNegative`, `HeatingEnergy`, `HeatingPeriodData`, `PeriodKey`, `CostItem`.
- Produces:
  - `Co2Method = 'serviceDeducted' | 'serviceShown' | 'selfAfterService' | 'self'`
  - `Co2TenantRelief = { tenancyId: string; cents: number }`
  - `Co2Statement` (Felder in Step 3), `Co2TenantLine`, `Co2Assessment`, `HeatingStatement`, `HeatingPeriodView`
  - `SettlementRow.kind?: 'co2Relief'`; `LandlordReason` + `'co2Share'`; `NoticeSubject['kind']` + `'heatingCosts'` (`'heatingPlant'` kommt aus PR 5); `Settlement.heating?: HeatingStatement[]`
  - schema.ts: `CO2_METHODS`, `co2Statements`, `co2TenantReliefs`
  - Client: `noticeTarget({ kind: 'heatingPlant', id: '' })` → Stammdaten, „Heizung einrichten →“; `heatingCosts` bis Task 11 Stammdaten, danach Heizkosten

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um `Co2Statement,
Co2TenantRelief` ergänzen. Hinter den Zusicherungen der Heizanlage (PR 4) einfügen:

```ts
// --- CO₂ (Heizung PR 6) ---
// Anlage und Heizperiode liest die Datenbank über `heating_period_id`; die Beträge je
// Mietverhältnis stehen in einer eigenen Tabelle.
type Co2StatementColumns = Omit<Co2Statement, 'plantId' | 'period' | 'reliefs'>
type _Co2Statements = Assert<Matches<typeof schema.co2Statements.$inferSelect, Co2StatementColumns>>
type _Co2Reliefs = Assert<Matches<Omit<typeof schema.co2TenantReliefs.$inferSelect, 'statementId'>, Co2TenantRelief>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ in die erwartete Liste hinter
`'closed_settlements',` einfügen:

```ts
      'co2_statements',
      'co2_tenant_reliefs',
```

Ans Ende anhängen:

```ts
// ---------- CO₂ (Heizung PR 6) ----------

const eineHeizperiode = [
  "INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'gas', 'service')",
  "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')",
]

test('CO₂: eine Zeile je Heizperiode, Summen beim Messdienst Pflicht, Grenzen der Werte', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineHeizperiode) connection.exec(sql)
    assert.ok(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method) VALUES ('h1', 'serviceDeducted')"), 'Vorwegabzug ohne S, L und NE')
    assert.equal(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method, service_users_total_cents, service_landlord_cents, service_units_count) VALUES ('h1', 'serviceDeducted', 384551, 8750, 4)"), null)
    assert.ok(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method) VALUES ('h1', 'selfAfterService')"), 'eine zweite Zeile für dieselbe Heizperiode')
    assert.deepEqual(connection.rows("SELECT service_users_total_approx FROM co2_statements")[0], [0])
    assert.ok(rejects(connection, "UPDATE co2_statements SET method = 'geschaetzt'"), 'unbekannte Methode')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_landlord_permille = 1001'), 'über 1000 ‰')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_units_count = 0'), 'keine Nutzeinheit')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_landlord_cents = -1'), 'negativer CO₂-Anteil')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET area_m2 = 0'), 'Fläche 0')
    assert.equal(rejects(connection, "UPDATE co2_statements SET method = 'selfAfterService', service_users_total_cents = NULL, service_landlord_cents = NULL, service_units_count = NULL"), null)
  } finally {
    cleanup()
  }
})

test('CO₂: Beträge je Mietverhältnis fallen mit Mietverhältnis und Datensatz, die Position wird nur gelöst', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    for (const sql of eineHeizperiode) connection.exec(sql)
    connection.exec(
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Messdienst', 100000, 'amounts', 'hp1')",
    )
    connection.exec("INSERT INTO co2_statements (heating_period_id, method, service_users_total_cents, service_landlord_cents, service_units_count, service_cost_item_id) VALUES ('h1', 'serviceShown', 100000, 5000, 1, 'c1')")
    connection.exec("INSERT INTO co2_tenant_reliefs (statement_id, tenancy_id, cents) VALUES ('h1', 't1', 2500)")
    assert.ok(rejects(connection, "INSERT INTO co2_tenant_reliefs (statement_id, tenancy_id, cents) VALUES ('h1', 't1', 100)"), 'derselbe Mieter zweimal')
    assert.ok(rejects(connection, "UPDATE co2_tenant_reliefs SET cents = -1"), 'negativer Betrag')
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    assert.deepEqual(connection.rows('SELECT service_cost_item_id FROM co2_statements')[0], [null])
    connection.exec("DELETE FROM tenancies WHERE id = 't1'")
    assert.equal(zahl('co2_tenant_reliefs'), 0, 'der Betrag fällt mit dem Mietverhältnis')
    connection.exec("DELETE FROM heating_periods WHERE id = 'h1'")
    assert.equal(zahl('co2_statements'), 0, 'der Datensatz fällt mit der Heizperiode')
  } finally {
    cleanup()
  }
})
```

(b) `client/src/landlordReasons.test.ts`: In der Liste `reasons` des Tests „jeder Grund hat eine
Beschriftung“ `'co2Share'` vor `'rounding'` einfügen und anhängen:

```ts
test('CO₂-Anteil des Vermieters beim Vorwegabzug (Heizung PR 6)', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'co2Share', cents: 8750 }] }))).toBe('CO₂-Anteil des Vermieters')
})
```

(c) `client/src/notices.test.ts` anhängen (Importe `noticeTarget` aus `'./notices'` ergänzen, falls
nicht vorhanden):

```ts
test('Heizanlage als Ziel: ohne Anlage zur Einrichtung, CO₂-Angaben vorerst in den Stammdaten (Heizung PR 6)', () => {
  expect(noticeTarget({ kind: 'heatingPlant', id: '' })).toEqual({ tab: 'stammdaten', label: 'Heizung einrichten →', focus: { kind: 'heatingPlant', id: '' } })
  // Mit Anlage bleibt das Ziel aus PR 5 (Zeitraum der Heizung in den Stammdaten).
  expect(noticeTarget({ kind: 'heatingPlant', id: 'hp1' })?.tab).toBe('stammdaten')
  // Bis es die Seite Heizkosten gibt (Task 11), führen die CO₂-Hinweise ebenfalls zur Karte „Heizung“.
  expect(noticeTarget({ kind: 'heatingCosts', id: 'hp1' })).toEqual({ tab: 'stammdaten', label: 'Hier beheben → Stammdaten', focus: { kind: 'heatingCosts', id: 'hp1' } })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'co2Statements' does not exist` (schema.test.ts), `Type '"co2Share"' is
not assignable to type 'LandlordReason'` (landlordReasons.test.ts) und `Type '"heatingCosts"' is not
assignable` (notices.test.ts).

- [ ] **Step 3: Typen (`shared/types.ts`)**

In `SettlementRow` hinter `landlordParts?: LandlordPart[]`:

```ts
  // Eine Zeile ohne Kostenposition (Heizung PR 6): `co2Relief` ist der CO₂-Anteil des Vermieters,
  // der dem Mieter als eigene Zeile abgezogen wird (Entwurf 7.5, 9.4). `costItemId` trägt dann die
  // Kennung des Topfs (`co2:<Anlage>:<Heizperiode>`), die keiner Position gehört. Spätere PRs
  // ergänzen `fuelCarry` und `co2Refund`.
  kind?: 'co2Relief'
```

`LandlordReason` (samt Kommentar darüber, eine Zeile ergänzt):

```ts
//   `co2Share`      CO₂-Anteil des Vermieters (Heizung PR 6): beim Vorwegabzug der abziehbare Teil
//                   in der Position des Messdienstes, beim reinen Ausweis die Summe der Abzugszeilen
export type LandlordReason =
  | 'notAllocable' | 'noBasis' | 'selfUse' | 'vacancy' | 'flatRate' | 'inclusive'
  | 'outsideUnit' | 'amountsRest' | 'customRest' | 'mainMeterRest' | 'co2Share' | 'rounding'
```

`NoticeSubject`:

(PR 5 hat `'heatingPlant'` ergänzt.) Ersetzen durch:

```ts
// `heatingPlant` (Heizung PR 5): die Heizanlage in den Stammdaten; `id` leer heißt, es gibt noch keine,
// und der Knopf führt zur Einrichtung (PR 6). `heatingCosts` (Heizung PR 6): die CO₂-Angaben und das
// Warmwasser einer Anlage auf der Seite Heizkosten; `id` ist die Anlage.
export type NoticeSubject = { kind: 'costItem' | 'unit' | 'tenancy' | 'meter' | 'rentLedger' | 'heatingPlant' | 'heatingCosts'; id: string }
```

In `Settlement` hinter `garageLikeUnitIds?: string[]`:

```ts
  // Je Heizanlage und Heizperiode dieser Abrechnung, was der Druckblock braucht (Heizung PR 6,
  // Entwurf 5.7, 9.5). Optional, weil eine vorher abgeschlossene Abrechnung es nicht kennt und eine
  // Abrechnung ohne Heizanlage es nicht hat.
  heating?: HeatingStatement[]
```

Ans Dateiende:

```ts
// ---------- CO₂ (Heizung PR 6, Entwurf 5.5, 7, 9.5) ----------

// Wie die CO₂-Kosten in der Heizkostenabrechnung stehen. `serviceDeducted`: Der Messdienst hat den
// Anteil des Vermieters in der Kostenaufstellung abgezogen („Abzüglich CO₂-Kosten Vermieter“);
// `serviceShown`: nur ausgewiesen; `selfAfterService`: gar nicht aufgeteilt; `self`: Mietfuchs teilt
// selbst auf (PR 7).
export type Co2Method = 'serviceDeducted' | 'serviceShown' | 'selfAfterService' | 'self'

// Ein Betrag „vom Vermieter übernommen“ laut Messdienst, je Mietverhältnis.
export type Co2TenantRelief = { tenancyId: string; cents: number }

// Die CO₂-Angaben einer Heizperiode. Die Felder `service*` stehen so in der Abrechnung des
// Messdienstes oder der Gemeinschaft. S (`serviceUsersTotalCents`) ist die gedruckte Zeile der zu
// verteilenden Kosten Heizung und Warmwasser, beim Vorwegabzug also nach dem Abzug (G-B3);
// `serviceUsersTotalApprox`: Die Zeile war nicht zu finden, S ist die Summe der Einzelbeträge
// aller Nutzeinheiten (Entwurf 7.3, R6). L ist `serviceLandlordCents`, L_self
// `serviceSelfLandlordCents`, G und V `serviceFuelGrossCents` und `serviceFuelNetCents`.
export type Co2Statement = {
  heatingPeriodId: string
  plantId: string
  period: PeriodKey
  method: Co2Method
  areaM2: number | null
  serviceEmissionsKg: number | null
  serviceAreaM2: number | null
  serviceKgPerM2: number | null
  serviceLandlordPermille: number | null
  serviceTotalCents: number | null
  serviceLandlordCents: number | null
  serviceUsersTotalCents: number | null
  serviceUsersTotalApprox: boolean
  serviceUnitsCount: number | null
  serviceCostItemId: string | null
  serviceSelfLandlordCents: number | null
  serviceFuelGrossCents: number | null
  serviceFuelNetCents: number | null
  reliefs: Co2TenantRelief[]
}

// Eine Zeile des Ausweises je Mieter: „vom Vermieter übernommen“ und „in Ihren Heizkosten
// enthalten“. `approximated`: nach dem Anteil an den Messdienstbeträgen gerechnet, weil die
// Abrechnung keinen Wert je Mieter nennt; `tenantCents` ist null ohne die CO₂-Kosten insgesamt.
export type Co2TenantLine = { tenancyId: string; landlordCents: number; tenantCents: number | null; approximated: boolean }

// Die Stufe als Spanne, für den Druckblock: von `from` bis unter `to` kg je m² (ohne `to`: ab).
export type Co2StageRange = { from: number; to: number | null; landlordPercent: number }

// Was die Abrechnung zur CO₂-Aufteilung einer Heizperiode weiß (Entwurf 9.5). `booked`: die
// Aufteilung ist gebucht (Probe bestanden oder S geschätzt); `deducted`: beim Messdienst schon
// abgezogen. `stage` ist die Stufe, in die Mietfuchs den Wert laut Messdienst einordnet, `table`
// die Tabelle (bei kurzer Heizperiode mit gekürzten Grenzen, `shortened`).
export type Co2Assessment = {
  method: Co2Method
  booked: boolean
  deducted: boolean
  totalCents: number | null
  landlordCents: number | null
  landlordPermille: number | null
  kgPerM2: number | null
  emissionsKg: number | null
  areaM2: number | null
  stage: Co2StageRange | null
  table: Co2StageRange[]
  shortened: boolean
  selfLandlordCents: number | null
  selfApproximated: boolean
  tenants: Co2TenantLine[]
}

// Eine Heizanlage in einer Abrechnung, mit der Heizperiode, die darin abgerechnet wird.
export type HeatingStatement = {
  plantId: string
  plantName: string
  energy: HeatingEnergy
  period: PeriodKey
  from: string
  to: string
  co2: Co2Assessment | null
}

// Was die Seite Heizkosten zu einer Heizperiode lädt (Heizung PR 6): die Angabe zum Warmwasser, die
// CO₂-Angaben und die Positionen der Anlage in dieser Heizperiode für die Probe.
export type HeatingPeriodView = {
  plantId: string
  period: PeriodKey
  label: string
  from: string
  to: string
  short: boolean
  closed: boolean
  hotWater: Pick<HeatingPeriodData, 'dhwMethod' | 'dhwUnmeasurable'>
  co2: Co2Statement | null
  items: Pick<CostItem, 'id' | 'description' | 'amountCents' | 'key' | 'tenancyAmounts' | 'selfAmounts'>[]
}
```

- [ ] **Step 4: Schema (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `Co2Method` ergänzen. Ans Dateiende:

```ts
// ---------- CO₂ (Heizung PR 6, Entwurf 5.5) ----------

export const CO2_METHODS = exactly<Co2Method>()(['serviceDeducted', 'serviceShown', 'selfAfterService', 'self'] as const)

// Die CO₂-Angaben einer Heizperiode, eine Zeile je Heizperiode (Primärschlüssel ist die
// Heizperiode). Die Methode hat keine Vorgabe: Der Vermieter beantwortet die Frage nach der
// Abzugszeile selbst (Entwurf 7.2). Beim Messdienst sind S, L und die Zahl der Nutzeinheiten
// Pflicht, denn ohne sie gibt es keine Probe (7.3).
export const co2Statements = sqliteTable(
  'co2_statements',
  {
    heatingPeriodId: text('heating_period_id')
      .primaryKey()
      .notNull()
      .references(() => heatingPeriods.id, { onDelete: 'cascade' }),
    method: text('method', { enum: CO2_METHODS }).notNull(),
    areaM2: real('area_m2'),
    serviceEmissionsKg: real('service_emissions_kg'),
    serviceAreaM2: real('service_area_m2'),
    serviceKgPerM2: real('service_kg_per_m2'),
    serviceLandlordPermille: integer('service_landlord_permille'),
    serviceTotalCents: integer('service_total_cents'),
    serviceLandlordCents: integer('service_landlord_cents'),
    serviceUsersTotalCents: integer('service_users_total_cents'),
    serviceUsersTotalApprox: integer('service_users_total_approx', { mode: 'boolean' }).notNull().default(false),
    serviceUnitsCount: integer('service_units_count'),
    // Die Position, in der L steckt. `SET NULL`: Wird sie gelöscht, bleibt der Datensatz, und die
    // Berechnung nimmt die größte Messdienstposition des Topfs.
    serviceCostItemId: text('service_cost_item_id').references(() => costItems.id, { onDelete: 'set null' }),
    serviceSelfLandlordCents: integer('service_self_landlord_cents'),
    serviceFuelGrossCents: integer('service_fuel_gross_cents'),
    serviceFuelNetCents: integer('service_fuel_net_cents'),
  },
  () => [
    oneOf('co2_statements_method_known', 'method', CO2_METHODS),
    check(
      'co2_statements_service_sums',
      sql.raw(`"method" NOT IN ('serviceDeducted', 'serviceShown') OR ("service_users_total_cents" IS NOT NULL AND "service_landlord_cents" IS NOT NULL AND "service_units_count" IS NOT NULL)`),
    ),
    notNegative('co2_statements_users_total_not_negative', 'service_users_total_cents'),
    notNegative('co2_statements_landlord_not_negative', 'service_landlord_cents'),
    notNegative('co2_statements_total_not_negative', 'service_total_cents'),
    notNegative('co2_statements_self_landlord_not_negative', 'service_self_landlord_cents'),
    notNegative('co2_statements_fuel_gross_not_negative', 'service_fuel_gross_cents'),
    notNegative('co2_statements_fuel_net_not_negative', 'service_fuel_net_cents'),
    notNegative('co2_statements_emissions_not_negative', 'service_emissions_kg'),
    notNegative('co2_statements_kg_per_m2_not_negative', 'service_kg_per_m2'),
    check('co2_statements_permille_valid', sql.raw('"service_landlord_permille" BETWEEN 0 AND 1000')),
    check('co2_statements_units_positive', sql.raw('"service_units_count" > 0')),
    check('co2_statements_area_positive', sql.raw('"area_m2" > 0')),
    check('co2_statements_service_area_positive', sql.raw('"service_area_m2" > 0')),
  ],
)

// „Vom Vermieter übernommen“ je Mietverhältnis, laut Messdienst. Fällt mit dem Datensatz und mit
// dem Mietverhältnis; die Objektgrenze prüft repository.ts (`guardTenancy`,
// `crossPropertyViolations`).
export const co2TenantReliefs = sqliteTable(
  'co2_tenant_reliefs',
  {
    statementId: text('statement_id')
      .notNull()
      .references(() => co2Statements.heatingPeriodId, { onDelete: 'cascade' }),
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    cents: integer('cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.statementId, t.tenancyId] }), notNegative('co2_tenant_reliefs_cents_not_negative', 'cents')],
)
```

Run: `npm --prefix server run db:generate -- --name co2_messdienst`

Expected: eine neue Datei `server/drizzle/0021_co2_messdienst.sql` (hinter `0020_heizperiode` aus
PR 5) mit genau zwei `CREATE TABLE` (`co2_statements`, `co2_tenant_reliefs`) samt
ihren Bedingungen und Fremdschlüsseln. **Kein** `__new_`, kein `ALTER TABLE`. Steht ein Neubau
darin, ist eine Bedingung an einer bestehenden Tabelle mitgekommen: Datei, Journal-Eintrag und
Momentaufnahme löschen, Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach einer Umbenennung,
ist die Antwort „create“.

- [ ] **Step 5: Marke eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('co2_messdienst')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter der Marke `0020_heizperiode` (PR 5) die
ausgegebene Zeile einfügen, darüber:

```ts
  // Heizung PR 6. Wird PR 5 vor dem Push neu erzeugt, wird dieser Schritt neu erzeugt und die
  // Marke hier ersetzt.
```

Die Prüfsumme ist keine offene Stelle: Erst die Ausgabe des Befehls nennt sie.

- [ ] **Step 6: Client (`client/src/landlordReasons.ts`, `client/src/notices.ts`)**

In `LABELS` von `landlordReasons.ts` vor `rounding`:

```ts
  co2Share: 'CO₂-Anteil des Vermieters',
```

`client/src/notices.ts`: in `TARGETS` hinter der Zeile `heatingPlant` (PR 5) ergänzen und
`noticeTarget` um den Sonderfall erweitern:

```ts
  // Heizung PR 6: die CO₂-Angaben; vorerst die Karte „Heizung“ in den Stammdaten, mit Task 11 die
  // Seite Heizkosten.
  heatingCosts: { tab: 'stammdaten', page: 'Stammdaten' },
```

In `noticeTarget` direkt hinter `if (!subject) return null`:

```ts
  // Noch keine Heizanlage (Heizung PR 6, Entwurf 11.1): Der Knopf führt zur Einrichtung in den
  // Stammdaten und heißt so.
  if (subject.kind === 'heatingPlant' && subject.id === '') {
    return { tab: 'stammdaten', label: 'Heizung einrichten →', focus: { kind: subject.kind, id: subject.id } }
  }
```

`NoticeTab` bleibt in diesem Task, wie er ist; die Seite Heizkosten kommt mit Task 11.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-golden.test.ts test/db-changeover.test.ts && npm --prefix client test -- landlordReasons notices && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle client/src/landlordReasons.ts client/src/notices.ts server/test/schema.test.ts server/test/migrations.test.ts client/src/landlordReasons.test.ts client/src/notices.test.ts
git commit -m "CO₂: Tabellen für die Angaben je Heizperiode und die Beträge je Mieter

Ein erzeugter Schritt mit zwei neuen Tabellen; dazu die gemeinsamen Typen und der Grund
„CO₂-Anteil des Vermieters“.

Refs #97, #209"
```

---
### Task 3: Lexikon: CO₂ und Warmwasseranteil

Fünf Begriffe (Entwurf 10.3, Gruppe CO₂, dazu `hotWaterShare` für #211). Sie kommen vor den
Hinweisen, weil jeder Code in `noticeKinds` mindestens einen Begriff trägt. Die Rechtszahlen kommen
aus dem Register, die Beispielzahlen sind gewählt und werden im Test nachgerechnet.

**Files:**
- Modify: `shared/glossary.ts`
- Test: `server/test/glossary.test.ts`

**Interfaces:**
- Consumes (Task 1): `co2CutMissing`, `co2FirstPeriodStart`, `co2RoundingDecimals`, `co2StageTable`; (PR 1) `hkvCutNotByConsumption`, `germanDate`, `valueAt`, `LAW_AS_OF`.
- Produces: `TermId` + `'co2Split' | 'co2Stage' | 'co2Area' | 'co2Deducted' | 'hotWaterShare'`.

- [ ] **Step 1: Write the failing test**

In `server/test/glossary.test.ts` anhängen:

```ts
test('CO₂ und Warmwasser (Heizung PR 6): Beispiele nachgerechnet, Rechtszahlen aus dem Register', () => {
  // 24.105,6 kg bei 600 m²: 40,176 kg, auf eine Nachkommastelle 40,2 (§ 5 Abs. 1 Satz 3) → 37 bis
  // unter 42 kg, Vermieter 60 % (Anlage). 600 € CO₂-Kosten: 360 € Vermieter, 240 € Mieter.
  assert.equal(Math.round((24105.6 / 600) * 10) / 10, 40.2)
  const split = GLOSSARY.co2Split
  assert.match(split.example, /24\.105,6 kg CO₂ bei 600 m² Wohnfläche: 40,2 kg je m², Stufe 37 bis unter 42 kg/)
  assert.match(split.example, /trägt 60 % der CO₂-Kosten, also 360 €, die Mieter tragen 240 €/)
  assert.match(split.example, /um 3 % kürzen/)
  assert.match(split.needed, /am oder nach dem 01\.01\.2023 beginnt/)
  assert.equal(split.norm, '§§ 5, 7 CO2KostAufG')
  assert.match(GLOSSARY.co2Stage.short, /einer von 10 Stufen/)
  assert.match(GLOSSARY.co2Stage.short, /0 % unter 12 kg bis 95 % ab 52 kg/)
  assert.match(GLOSSARY.co2Stage.example, /40,176 kg je m², gerundet 40,2: Stufe 37 bis unter 42 kg, der Vermieter trägt 60 %/)
  // 5.421 kg bei 200,6 m²: 27,0239 kg, gerundet 27,0.
  assert.equal(Math.round((5421 / 200.6) * 100) / 100, 27.02)
  assert.match(GLOSSARY.co2Area.example, /5\.421 kg CO₂ bei 200,6 m² laut Messdienst ergeben 27,02 kg je m², gerundet 27,0/)
  // Techem-Muster (Entwurf 7.2, 7.4): 3.540,00 − 87,50 = 3.452,50; 3.845,51 + 87,50 = 3.933,01.
  assert.equal(354000 - 8750, 345250)
  assert.equal(384551 + 8750, 393301)
  assert.match(GLOSSARY.co2Deducted.example, /3\.540,00 €.*87,50 €.*3\.452,50 €.*3\.845,51 €.*3\.933,01 €/s)
  // 15 % von 1.000 € (BGH VIII ZR 151/20, Entwurf R-A6).
  assert.match(GLOSSARY.hotWaterShare.example, /1\.000 €.*um 15 % kürzen, also um 150 €/s)
  assert.equal(GLOSSARY.hotWaterShare.norm, '§ 9 Abs. 2 HeizkostenV; BGH VIII ZR 151/20')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/glossary.test.ts`
Expected: FAIL mit `Cannot read properties of undefined (reading 'example')`.

- [ ] **Step 3: Begriffe (`shared/glossary.ts`)**

Importe ergänzen:

```ts
import { co2CutMissing, co2FirstPeriodStart, co2RoundingDecimals, co2StageTable } from './law/co2kostaufg.ts'
```

und aus `'./law/register.ts'` zusätzlich `germanDate`. Unter `const REMOTE_CUT = …`:

```ts
// CO₂ (Heizung PR 6): die Stufentabelle, die Rundung und die 3 % aus dem Register. Die Stufe eines
// Beispielwerts wird hier nachgeschlagen wie in server/src/co2.ts (unten einschließend), damit das
// Beispiel dieselbe Stufe nennt wie die Rechnung.
const CO2_CUT = valueAt(co2CutMissing, LAW_AS_OF)
const CO2_FROM = germanDate(co2FirstPeriodStart())
const CO2_DECIMALS = valueAt(co2RoundingDecimals, LAW_AS_OF)
const STAGES = valueAt(co2StageTable, LAW_AS_OF)
function stageText(value: number): { range: string; percent: number } {
  let i = 0
  for (let k = 0; k < STAGES.length; k++) if (value >= (STAGES[k]?.from ?? Infinity)) i = k
  const stage = STAGES[i]
  const next = STAGES[i + 1]
  if (!stage) throw new Error('Stufentabelle leer')
  return { range: next ? `${stage.from} bis unter ${next.from} kg` : `ab ${stage.from} kg`, percent: stage.landlordPercent }
}
const B1 = stageText(40.2)
const FIRST = STAGES[0]
const SECOND = STAGES[1]
const LAST = STAGES[STAGES.length - 1]
if (!FIRST || !SECOND || !LAST) throw new Error('Stufentabelle unvollständig')
```

In `GLOSSARY` hinter `heatingCostOrdinance` (bzw. hinter `heatCostAllocator` aus PR 4):

```ts
  co2Split: {
    title: 'CO₂-Kostenaufteilung',
    short: 'Seit 2023 tragen Vermieter einen Teil der CO₂-Kosten der Heizung, und zwar umso mehr, je mehr CO₂ das Gebäude je Quadratmeter Wohnfläche ausstößt. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen.',
    example: `600 € CO₂-Kosten in der Gasrechnung, 24.105,6 kg CO₂ bei 600 m² Wohnfläche: 40,2 kg je m², Stufe ${B1.range}. Der Vermieter trägt ${B1.percent} % der CO₂-Kosten, also ${(600 * B1.percent) / 100} €, die Mieter tragen ${600 - (600 * B1.percent) / 100} €. Fehlt die Aufteilung in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} % kürzen.`,
    norm: '§§ 5, 7 CO2KostAufG',
    needed: `Ja, wenn Sie mit Gas, Heizöl, Flüssiggas oder Kohle heizen oder Ihr Wärmelieferant CO₂-Kosten ausweist, für jeden Abrechnungszeitraum, der am oder nach dem ${CO2_FROM} beginnt. Rechnet ein Messdienst oder die Gemeinschaft ab, übernehmen Sie deren Angaben auf der Seite Heizkosten.`,
  },
  co2Stage: {
    title: 'Einstufung (CO₂-Stufe)',
    short: `Der CO₂-Ausstoß des Gebäudes in Kilogramm je Quadratmeter Wohnfläche und Jahr, auf ${CO2_DECIMALS === 1 ? 'eine Nachkommastelle' : `${CO2_DECIMALS} Nachkommastellen`} gerundet, ordnet das Gebäude einer von ${STAGES.length} Stufen zu. Die Stufe sagt, welchen Anteil der CO₂-Kosten der Vermieter trägt: von ${FIRST.landlordPercent} % unter ${SECOND.from} kg bis ${LAST.landlordPercent} % ab ${LAST.from} kg.`,
    example: `24.105,6 kg CO₂ bei 600 m² ergeben 40,176 kg je m², gerundet 40,2: Stufe ${B1.range}, der Vermieter trägt ${B1.percent} %. Ist ein Abrechnungszeitraum von unter einem Jahr vereinbart, werden die Grenzen der Tabelle anteilig gekürzt.`,
    norm: '§ 5 Abs. 1 und 2, Anlage CO2KostAufG',
    needed: 'Nur zum Prüfen: Die Stufe steht in der Abrechnung des Messdienstes. Mietfuchs ordnet den Wert nach und meldet, wenn der Anteil des Vermieters nicht zur Tabelle passt.',
  },
  co2Area: {
    title: 'Fläche der CO₂-Einstufung',
    short: 'Die Wohnfläche, durch die der CO₂-Ausstoß des Gebäudes geteilt wird. Das Gesetz sagt nicht, nach welcher Berechnung sie zu bestimmen ist; Mietfuchs nimmt im Zweifel die Fläche aus der Abrechnung des Messdienstes, damit beide Angaben übereinstimmen.',
    example: '5.421 kg CO₂ bei 200,6 m² laut Messdienst ergeben 27,02 kg je m², gerundet 27,0.',
    norm: '§ 5 Abs. 1 CO2KostAufG',
    needed: 'Nur, wenn Sie die Einstufung prüfen oder die Fläche des Messdienstes von Ihrer abweicht.',
  },
  co2Deducted: {
    title: 'Abzugszeile (Vorwegabzug)',
    short: 'Manche Messdienste ziehen den CO₂-Anteil des Vermieters schon in der Kostenaufstellung ab, mit einer Zeile wie „Abzüglich CO₂-Kosten Vermieter“. Die Beträge der Mieter sind dann schon entlastet, und bezahlt haben Sie die Summe der Nutzerkosten plus diesen Anteil.',
    example: 'Die Kostenaufstellung nennt „Anlieferung Brennstoff“ 3.540,00 €, darunter „Abzüglich CO₂-Kosten Vermieter“ 87,50 €, und verteilt 3.452,50 €. Die Kosten aller Nutzer ergeben 3.845,51 €; bezahlt haben Sie 3.845,51 € + 87,50 € = 3.933,01 €, und das ist der Betrag Ihrer Position.',
    norm: '§ 7 Abs. 1 CO2KostAufG',
    needed: 'Ja, wenn Ihre Abrechnung eine solche Zeile hat: Dann beantworten Sie die Frage in der Karte „CO₂-Kosten“ auf der Seite Heizkosten mit „Ja“.',
  },
  hotWaterShare: {
    title: 'Warmwasseranteil',
    short: 'Bereitet die Heizung auch das Warmwasser, wird ein Teil ihrer Kosten dem Warmwasser zugerechnet. Die Wärme dafür ist mit einem Wärmezähler zu messen; eine Formel ist nur erlaubt, wenn das Messen nur mit unzumutbar hohem Aufwand möglich wäre.',
    example: `Ein Mieter trägt 1.000 € Heiz- und Warmwasserkosten. Hat der Messdienst die Wärme für das Warmwasser ohne diesen Grund mit einer Formel bestimmt, darf der Mieter seinen Anteil um ${CUT} % kürzen, also um ${(1000 * CUT) / 100} €.`,
    norm: '§ 9 Abs. 2 HeizkostenV; BGH VIII ZR 151/20',
    needed: 'Nur, wenn die Abrechnung des Messdienstes sagt, dass die Wärme für das Warmwasser nach einer Formel bestimmt wurde. Dann tragen Sie das auf der Seite Heizkosten ein.',
  },
```

(`CUT` ist die Konstante aus PR 1 für `hkvCutNotByConsumption`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Die Prozentangaben laufen über `${…}`; „40,2 kg“ und „37 bis unter 42 kg“ trifft
kein Muster des Wächters.

- [ ] **Step 5: Commit**

```bash
git add shared/glossary.ts server/test/glossary.test.ts
git commit -m "Lexikon: CO₂-Aufteilung, Einstufung, Fläche, Abzugszeile und Warmwasseranteil

Refs #97, #211"
```

---

### Task 4: Reine Rechnung: Probe, Einstufung, Eigenanteil, Abzugsbeträge

Alles, was ohne Abrechnung prüfbar ist: die Probe (7.3) in `shared/`, weil die Oberfläche sie live
zeigt, und in `server/src/co2.ts` die Einstufung mit Rundung und gekürzter Tabelle (9.2, 3.9), die
Nachstufung der Werte laut Messdienst (9.2), L_self (7.4), die Abzugsbeträge beim reinen Ausweis
(7.5) und die Formel des Abzugs nach Anteil (9.4) mit den Rechenbeispielen des Entwurfs.

**Files:**
- Create: `shared/co2Probe.ts`, `server/src/co2.ts`
- Modify: `server/test/law-literals.test.ts`
- Test: `server/test/co2.test.ts` (neu)

**Interfaces:**
- Consumes (Task 1, 2): `Co2Stage`, `co2StageTable`, `Co2Statement`, `Co2TenantRelief`, `Co2StageRange`, `HeatingEnergy`, `DhwMethod`; (PR 1) `distributeCents` nur im Test.
- Produces:
  - `shared/co2Probe.ts`: `type ProbeItem = { amountCents: number; tenancyAmounts?: Readonly<Record<string, number>> | null; selfAmounts?: Readonly<Record<string, number>> | null }`, `type ProbeInput = { deducted: boolean; items: readonly ProbeItem[]; usersTotalCents: number; landlordCents: number; unitsCount: number; approx: boolean }`, `type ProbeResult = { ok: boolean; itemsCents: number; expectedCents: number; itemsOk: boolean; enteredCents: number; enteredOk: boolean; toleranceCents: number }`, `itemsCentsOf(items)`, `enteredCentsOf(items)`, `serviceProbe(input): ProbeResult`, `CO2_RELIEF_LABEL = 'CO₂-Kosten: Anteil des Vermieters'`
  - `server/src/co2.ts`: `CO2_FUELS`, `FORMULA_METHODS`, `L_TOLERANCE_CENTS = 1.5`, `roundSpecific(value, decimals)`, `tableFactor(period)`, `stageRanges(table, factor): Co2StageRange[]`, `stageOf(value, ranges): Co2StageRange`, `type Restage = { value: number | null; stage: Co2StageRange | null; percentOk: boolean | null; sumOk: boolean | null }`, `restage(st, ranges, decimals): Restage`, `ausweisGaps(st): string[]`, `selfLandlordRaw(landlordCents, usersTotalCents, selfNetCents, givenCents): { raw: number; approximated: boolean }`, `type ReliefShare = { tenancyId: string; cents: number }`, `reliefsByShare(landlordCents, shares, totalCents): { tenancyId: string; raw: number }[]`, `type ReliefProblem`, `shownReliefs(landlordCents, usersTotalCents, shares, given): { raws: { tenancyId: string; raw: number; approximated: boolean }[]; problem: ReliefProblem | null; missing: string[] }`

- [ ] **Step 1: Write the failing tests**

`server/test/co2.test.ts`:

```ts
// CO₂-Aufteilung ohne Abrechnung (Heizung PR 6, Entwurf 7.3, 7.4, 7.5, 9.2, 9.4, 12.2 „co2.test.ts“):
// Grenzen der Tabelle mit Rundung, gekürzte Tabelle, Nachstufung, Probe, Eigenanteil und
// Abzugsbeträge, je mit den Zahlen des Entwurfs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeCents } from '../src/calc.ts'
import {
  ausweisGaps, reliefsByShare, restage, roundSpecific, selfLandlordRaw, shownReliefs, stageOf, stageRanges, tableFactor,
} from '../src/co2.ts'
import { serviceProbe } from '../../shared/co2Probe.ts'
import { co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { periodKey } from '../../shared/period.ts'
import type { Co2Statement } from '../../shared/types.ts'

const RANGES = stageRanges(valueAt(co2StageTable, LAW_AS_OF), 1)
const percentOf = (value: number) => stageOf(roundSpecific(value, 1), RANGES).landlordPercent
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

const statement = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceDeducted', areaM2: null,
  serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null,
  serviceLandlordCents: null, serviceUsersTotalCents: null, serviceUsersTotalApprox: false, serviceUnitsCount: null,
  serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [], ...over,
})
```

Weiter in derselben Datei:

```ts
test('Einstufung: Grenzen 11,9 · 11,95 · 12,0 · 51,9 · 52,0 nach Rundung auf eine Nachkommastelle (Entwurf 9.2, 12.2)', () => {
  assert.deepEqual([11.9, 11.95, 12.0, 51.9, 52.0].map(percentOf), [0, 10, 10, 80, 95])
  // Der BMWK-Rechner rundet nicht und stuft 12,0 bei 0 % ein; Mietfuchs folgt dem Gesetz (9.2).
  assert.equal(roundSpecific(11.95, 1), 12)
  // Gleitkomma: 24.105,6 / 600 = 40,17599… wird 40,2 (B1).
  assert.equal(roundSpecific(24105.6 / 600, 1), 40.2)
  assert.equal(percentOf(24105.6 / 600), 60)
  // Kippen an der Grenze 27 (F13, Entwurf 12.1): 26,94 → 30 %, 26,95 → 40 %.
  assert.deepEqual([percentOf(26.94), percentOf(26.95)], [30, 40])
})

test('Rumpf: Grenzen anteilig gekürzt, 5,0 kg in 120 von 365 Tagen → 10 % (§ 5 Abs. 1 Satz 4, Entwurf 3.9, 12.2)', () => {
  const rumpf = { from: '2025-01-01', to: '2025-04-30', short: true }
  assert.equal(tableFactor(rumpf), 120 / 365)
  assert.equal(tableFactor({ from: '2025-05-01', to: '2026-04-30', short: false }), 1)
  // Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage, ein Rumpf 01.05.–31.12.2027 245 von 366.
  assert.equal(tableFactor({ from: '2027-05-01', to: '2027-12-31', short: true }), 245 / 366)
  const gekuerzt = stageRanges(valueAt(co2StageTable, LAW_AS_OF), tableFactor(rumpf))
  assert.equal(stageOf(5.0, gekuerzt).landlordPercent, 10)
  assert.equal(stageOf(5.0, RANGES).landlordPercent, 0)
  assert.ok(near(gekuerzt[1]?.from ?? 0, (12 * 120) / 365))
})

test('Nachstufung (Entwurf 9.2): Techem 46,4 kg mit 35 % passt nicht zur Tabelle (70 %), ein ganzzahliger Wert gilt als Spanne', () => {
  const techem = statement({ serviceKgPerM2: 46.4, serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceLandlordCents: 8750 })
  const r = restage(techem, RANGES, 1)
  assert.deepEqual([r.value, r.stage?.landlordPercent, r.percentOk, r.sumOk], [46.4, 70, false, true])
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17500 }, RANGES, 1).percentOk, true)
  // 27 gedruckt: 26,5 bis unter 27,5, also 30 % oder 40 %.
  for (const permille of [300, 400]) assert.equal(restage(statement({ serviceKgPerM2: 27, serviceLandlordPermille: permille }), RANGES, 1).percentOk, true)
  assert.equal(restage(statement({ serviceKgPerM2: 27, serviceLandlordPermille: 500 }), RANGES, 1).percentOk, false)
  // L muss zu C · ‰ passen, bis auf einen Cent und die Rundung von L.
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17501 }, RANGES, 1).sumOk, true)
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17502 }, RANGES, 1).sumOk, false)
  // Ausstoß und Fläche statt kg je m²: 5.421 kg / 200,6 m² → 27,0 → 40 %.
  const ausFlaeche = restage(statement({ serviceEmissionsKg: 5421, serviceAreaM2: 200.6, serviceLandlordPermille: 400 }), RANGES, 1)
  assert.deepEqual([ausFlaeche.value, ausFlaeche.stage?.landlordPercent, ausFlaeche.percentOk], [27, 40, true])
  assert.deepEqual(restage(statement({}), RANGES, 1), { value: null, stage: null, percentOk: null, sumOk: null })
})

test('Ausweis (§ 7 Abs. 3): was für Einstufung und Grundlagen fehlt', () => {
  assert.deepEqual(ausweisGaps(statement({})), [
    'der CO₂-Ausstoß je Quadratmeter (oder Ausstoß und Fläche)', 'der Anteil des Vermieters in Prozent', 'die CO₂-Kosten insgesamt',
  ])
  assert.deepEqual(ausweisGaps(statement({ serviceEmissionsKg: 5421, serviceAreaM2: 200.6, serviceLandlordPermille: 400, serviceTotalCents: 60000 })), [])
})

test('Probe G-B3 (Entwurf 7.3): Betrag = S + L ± 1 ct; Einzelbeträge bis S + NE · 2 ct', () => {
  const items = (entered: number, amount = 393301) => [{ amountCents: amount, tenancyAmounts: { t: entered } }]
  const probe = (entered: number, amount?: number, approx = false) =>
    serviceProbe({ deducted: true, items: items(entered, amount), usersTotalCents: 384551, landlordCents: 8750, unitsCount: 4, approx })
  assert.equal(probe(384551).ok, true)
  assert.equal(probe(384559).ok, true)
  assert.deepEqual([probe(384560).ok, probe(384560).enteredOk, probe(384560).toleranceCents], [false, false, 8])
  assert.equal(probe(384551, 393302).ok, true)
  assert.equal(probe(384551, 393303).itemsOk, false)
  // Nur ausgewiesen: Betrag = S, ohne Spielraum.
  const shown = (amount: number) => serviceProbe({ deducted: false, items: [{ amountCents: amount, tenancyAmounts: { t: 384551 } }], usersTotalCents: 384551, landlordCents: 8750, unitsCount: 4, approx: false })
  assert.equal(shown(384551).ok, true)
  assert.equal(shown(384552).ok, false)
  // S geschätzt („Ich finde diese Zeile nicht“): Spielraum NE · 2 ct auch beim Betrag.
  assert.equal(probe(384551, 393310, true).itemsOk, true)
  assert.equal(probe(384551, 393311, true).itemsOk, false)
  // Eigenbeträge zählen mit, negative Einträge nicht.
  assert.equal(serviceProbe({ deducted: false, items: [{ amountCents: 100000, tenancyAmounts: { t: 60000, u: -5 }, selfAmounts: { c: 40000 } }], usersTotalCents: 100000, landlordCents: 0, unitsCount: 2, approx: false }).enteredCents, 100000)
})

test('L_self (Entwurf 7.4, Beispiel B): Näherung L · Eigenbeträge / S, sonst der Wert laut Messdienst', () => {
  const naehe = selfLandlordRaw(10000, 290000, 60000, null)
  assert.ok(near(naehe.raw, (10000 * 60000) / 290000))
  assert.equal(Math.round(naehe.raw), 2069)
  assert.equal(naehe.approximated, true)
  assert.deepEqual(selfLandlordRaw(10000, 290000, 60000, 2500), { raw: 2500, approximated: false })
  assert.deepEqual(selfLandlordRaw(10000, 290000, 0, null), { raw: 0, approximated: false })
})

test('Abzug nach Anteil (Entwurf 9.4, B8, G-B5): 232,14 / 139,28 / 92,85 €, nicht 224,40 € nach dem ganzen Topf', () => {
  const shares = [{ tenancyId: 'A', cents: 450000 }, { tenancyId: 'B', cents: 270000 }, { tenancyId: 'C', cents: 180000 }]
  const r = reliefsByShare(46427, shares, 900000)
  assert.ok(near(r[0]?.raw ?? 0, 23213.5) && near(r[1]?.raw ?? 0, 13928.1) && near(r[2]?.raw ?? 0, 9285.4))
  const total = Math.round(r.reduce((a, x) => a + x.raw, 0))
  // Der eine Restcent geht an A (Rest 0,5 > 0,4 > 0,1; R-b).
  assert.deepEqual(distributeCents(total, r.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [23214, 13928, 9285])
  // Die erste Fassung nahm den ganzen Topf: Brennstoff 9.000 € nach Verbrauch und Messkosten 1.000 €
  // je ⅓, A also 4.833,33 von 10.000 €.
  const topf = reliefsByShare(46427, [{ tenancyId: 'A', cents: 450000 + 100000 / 3 }], 1000000)
  assert.equal(Math.round(topf[0]?.raw ?? 0), 22440)
})

test('Beispiel B1 (Entwurf 9.4): 40,2 kg → 60 %, L 464,27 €, verteilt 185,71 / 154,76 / 123,80 €', () => {
  assert.equal(percentOf(24105.6 / 600), 60)
  const L = (77379 * 600) / 1000
  assert.ok(near(L, 46427.4))
  const r = reliefsByShare(L, [{ tenancyId: 'a', cents: 360000 }, { tenancyId: 'b', cents: 300000 }, { tenancyId: 'c', cents: 240000 }], 900000)
  const total = Math.round(r.reduce((a, x) => a + x.raw, 0))
  assert.deepEqual(distributeCents(total, r.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [18571, 15476, 12380])
})

test('Nur ausgewiesen (Entwurf 7.5): Werte laut Messdienst geprüft, sonst nach Anteil; ein fehlender wird ergänzt', () => {
  const shares = [{ tenancyId: 'A', cents: 60000 }, { tenancyId: 'B', cents: 30000 }]
  const ok = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 6000 }, { tenancyId: 'B', cents: 3000 }])
  assert.deepEqual(ok, { raws: [{ tenancyId: 'A', raw: 6000, approximated: false }, { tenancyId: 'B', raw: 3000, approximated: false }], problem: null, missing: [] })
  const einer = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 6000 }])
  assert.deepEqual(einer.missing, ['B'])
  assert.deepEqual(einer.raws[1], { tenancyId: 'B', raw: 3000, approximated: true })
  const zuviel = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 7000 }, { tenancyId: 'B', cents: 3500 }])
  assert.deepEqual(zuviel.problem, { kind: 'sum', givenCents: 10500 })
  assert.deepEqual(zuviel.raws.map((x) => [x.raw, x.approximated]), [[6000, true], [3000, true]])
  // Über dem eigenen Anteil, bei einem L, das die Summe noch zuließe.
  assert.deepEqual(shownReliefs(40000, 100000, shares, [{ tenancyId: 'B', cents: 30001 }]).problem, { kind: 'tenancy', tenancyId: 'B', givenCents: 30001, shareCents: 30000 })
  assert.deepEqual(shownReliefs(10000, 100000, shares, [{ tenancyId: 'X', cents: 1 }]).problem, { kind: 'tenancy', tenancyId: 'X', givenCents: 1, shareCents: 0 })
})
```

In `server/test/law-literals.test.ts` die Liste `ENGINE_FILES` um `'server/src/co2.ts'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/co2.test.ts test/law-literals.test.ts`
Expected: FAIL mit `Cannot find module '…/src/co2.ts'` und „server/src/co2.ts gibt es nicht; die
Liste ist veraltet“.

- [ ] **Step 3: Die Probe (`shared/co2Probe.ts`)**

```ts
// Die Probe der CO₂-Angaben beim Messdienst (Heizung PR 6, Entwurf 7.3, G-B3, W9). Server
// (Berechnung) und Oberfläche (Probe in der Karte „CO₂-Kosten“) rechnen mit derselben Funktion.
//
// S ist die gedruckte Kostensumme der Nutzer, also sind der Betrag der Positionen und S + L beide
// Kostensummen, ohne Rundung der Nutzerzeilen dazwischen. Spielraum gibt es deshalb nur für die
// Rundung von L (1 ct) und, bei den eingetragenen Einzel- und Eigenbeträgen, für die Rundung der
// Nutzerzeilen: vier je Nutzeinheit, weil Messdienste Grund- und Verbrauchsanteil je Heizung und
// Warmwasser getrennt ausweisen, je höchstens ein halber Cent (NE · 2 ct). Ist S geschätzt („Ich
// finde diese Zeile nicht“, R6), gilt dieser Spielraum auch für den Betrag.
//
// Geprüft werden nur die Messdienstpositionen des Topfs, also die mit Einzelbeträgen; eine
// Gutschrift des Versorgers oder eine Wartung daneben gehört nicht zur Abrechnung des Messdienstes.

export type ProbeItem = { amountCents: number; tenancyAmounts?: Readonly<Record<string, number>> | null; selfAmounts?: Readonly<Record<string, number>> | null }
export type ProbeInput = { deducted: boolean; items: readonly ProbeItem[]; usersTotalCents: number; landlordCents: number; unitsCount: number; approx: boolean }
export type ProbeResult = { ok: boolean; itemsCents: number; expectedCents: number; itemsOk: boolean; enteredCents: number; enteredOk: boolean; toleranceCents: number }

const L_ROUNDING_CENTS = 1
const ROUNDINGS_PER_UNIT = 4
const HALF_CENT = 0.5

// Die Beschriftung der Abzugszeile je Mieter beim reinen Ausweis (Entwurf 7.5); die Berechnung
// schreibt sie, Anleitung und Oberfläche nennen sie.
export const CO2_RELIEF_LABEL = 'CO₂-Kosten: Anteil des Vermieters'

const positive = (amounts: Readonly<Record<string, number>> | null | undefined): number =>
  Object.values(amounts ?? {}).reduce((a, c) => a + Math.max(0, c), 0)

export const itemsCentsOf = (items: readonly ProbeItem[]): number => items.reduce((a, c) => a + c.amountCents, 0)
export const enteredCentsOf = (items: readonly ProbeItem[]): number =>
  items.reduce((a, c) => a + positive(c.tenancyAmounts) + positive(c.selfAmounts), 0)

export function serviceProbe(p: ProbeInput): ProbeResult {
  const toleranceCents = p.unitsCount * ROUNDINGS_PER_UNIT * HALF_CENT
  const expectedCents = p.deducted ? p.usersTotalCents + p.landlordCents : p.usersTotalCents
  const itemsCents = itemsCentsOf(p.items)
  const itemsTolerance = (p.deducted ? L_ROUNDING_CENTS : 0) + (p.approx ? toleranceCents : 0)
  const itemsOk = Math.abs(itemsCents - expectedCents) <= itemsTolerance
  const enteredCents = enteredCentsOf(p.items)
  const enteredOk = enteredCents <= p.usersTotalCents + toleranceCents
  return { ok: itemsOk && enteredOk, itemsCents, expectedCents, itemsOk, enteredCents, enteredOk, toleranceCents }
}
```

- [ ] **Step 4: Die reine Rechnung (`server/src/co2.ts`)**

```ts
// CO₂-Kostenaufteilung (Heizung PR 6, #97, #209; Entwurf 7, 9.2, 9.4). Reine Funktionen. Die
// Rechtswerte reicht der Aufrufer aus dem Register herein (`law()` protokolliert sie); hier steht
// keine Zahl der Stufentabelle und kein Datum (law-literals.test.ts).
import type { Co2Stage } from '../../shared/law/co2kostaufg.ts'
import type { Co2StageRange, Co2Statement, Co2TenantRelief, DhwMethod, HeatingEnergy } from '../../shared/types.ts'

// Brennstoffe mit Standardwert für den Emissionsfaktor nach der EBeV, die das Gesetz erfasst (§ 2
// Abs. 1 Satz 1 CO2KostAufG, Entwurf 5.3). Die Wärmelieferung erfasst Satz 2 „hinsichtlich der für
// die Wärmeerzeugung eingesetzten Brennstoffe“; ob CO₂-Kosten anfallen, weist erst der Lieferant
// aus (§ 3 Abs. 4), deshalb steht sie nicht hier (R-A28). Holz und Pellets liest die CO₂-Rechnung
// als „nicht erfasst“ (W8).
export const CO2_FUELS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal']

// Warmwasser ohne Wärmezähler (§ 9 Abs. 2 Satz 2 und 4 HeizkostenV).
export const FORMULA_METHODS: readonly DhwMethod[] = ['volumeFormula', 'areaFormula']

// Ein Cent und die Rundung von L (ein halber Cent): so weit darf L neben C · ‰ liegen (Entwurf 9.2,
// 7.4 „|G − V − L| ≤ 1 ct + Rundung von L“).
export const L_TOLERANCE_CENTS = 1.5

// Gleitkomma-Rauschen an Grenzen (Entwurf 9.2: „kaufmännisch mit 1e-9 Toleranz“).
const EPS = 1e-9
const DAY_MS = 86400000

// Kaufmännisch auf `decimals` Nachkommastellen (§ 5 Abs. 1 Satz 3). Die Werte sind nie negativ.
export function roundSpecific(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f + EPS) / f
}

// Der Faktor, mit dem die Grenzen der Tabelle bei einem Zeitraum unter einem Jahr gekürzt werden
// (§ 5 Abs. 1 Satz 4): Tage des Zeitraums durch die Tage der zwölf Monate ab seinem Beginn. Ob ein
// einseitig gesetzter Rumpf „vereinbart“ ist, ist offen (Entwurf 15.1 Nr. 11); gekürzt wird wie bei
// den Messdiensten, die auf ihren Zeitraum rechnen.
export function tableFactor(period: { from: string; to: string; short: boolean }): number {
  if (!period.short) return 1
  const [y, m, d] = period.from.split('-').map(Number)
  const start = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)
  const yearLater = Date.UTC((y ?? 0) + 1, (m ?? 1) - 1, d ?? 1)
  const days = (Date.parse(`${period.to}T00:00:00Z`) - start) / DAY_MS + 1
  return days / ((yearLater - start) / DAY_MS)
}

// Die Tabelle als Spannen, mit gekürzten Grenzen.
export function stageRanges(table: readonly Co2Stage[], factor: number): Co2StageRange[] {
  return table.map((s, i) => {
    const next = table[i + 1]
    return { from: s.from * factor, to: next ? next.from * factor : null, landlordPercent: s.landlordPercent }
  })
}

// Die Stufe eines schon gerundeten Werts, unten einschließend (Anlage CO2KostAufG: „12 bis < 17“).
export function stageOf(value: number, ranges: readonly Co2StageRange[]): Co2StageRange {
  let found = ranges[0]
  for (const r of ranges) if (value >= r.from - EPS) found = r
  if (!found) throw new Error('Stufentabelle ohne Stufe')
  return found
}

export type Restage = { value: number | null; stage: Co2StageRange | null; percentOk: boolean | null; sumOk: boolean | null }

type ServiceValues = Pick<Co2Statement, 'serviceKgPerM2' | 'serviceEmissionsKg' | 'serviceAreaM2' | 'areaM2' | 'serviceLandlordPermille' | 'serviceTotalCents' | 'serviceLandlordCents'>

// Nachstufung der Angaben laut Messdienst (Entwurf 9.2): Mietfuchs ordnet den gedruckten Wert in
// die Tabelle ein. Ein ganzzahlig gedruckter Wert kann jeder Wert in [w − 0,5; w + 0,5) gewesen
// sein; passt der Anteil laut Messdienst zu einer Stufe darin, ist er stimmig. Dazu muss L zu C · ‰
// passen. `null` heißt: nicht zu prüfen, weil eine Angabe fehlt.
export function restage(st: ServiceValues, ranges: readonly Co2StageRange[], decimals: number): Restage {
  const area = st.serviceAreaM2 ?? st.areaM2
  const printed = st.serviceKgPerM2 ?? (st.serviceEmissionsKg !== null && area !== null && area > 0 ? st.serviceEmissionsKg / area : null)
  if (printed === null) return { value: null, stage: null, percentOk: null, sumOk: null }
  const value = roundSpecific(printed, decimals)
  const stage = stageOf(value, ranges)
  const permille = st.serviceLandlordPermille
  if (permille === null) return { value, stage, percentOk: null, sumOk: null }
  const candidates = st.serviceKgPerM2 !== null && Number.isInteger(st.serviceKgPerM2)
    ? ranges.filter((r) => r.from < value + 0.5 && (r.to === null || r.to > value - 0.5))
    : [stage]
  const percentOk = candidates.some((r) => r.landlordPercent * 10 === permille)
  const sumOk = st.serviceTotalCents === null || st.serviceLandlordCents === null
    ? null
    : Math.abs(st.serviceLandlordCents - (st.serviceTotalCents * permille) / 1000) <= L_TOLERANCE_CENTS
  return { value, stage, percentOk, sumOk }
}

// Was für den Ausweis nach § 7 Abs. 3 fehlt (Einstufung und Berechnungsgrundlagen), als Satzteile.
export function ausweisGaps(st: ServiceValues): string[] {
  const gaps: string[] = []
  const area = st.serviceAreaM2 ?? st.areaM2
  if (st.serviceKgPerM2 === null && (st.serviceEmissionsKg === null || area === null)) gaps.push('der CO₂-Ausstoß je Quadratmeter (oder Ausstoß und Fläche)')
  if (st.serviceLandlordPermille === null) gaps.push('der Anteil des Vermieters in Prozent')
  if (st.serviceTotalCents === null) gaps.push('die CO₂-Kosten insgesamt')
  return gaps
}

// L_self (Entwurf 7.4): der Wert laut Messdienst, sonst die Näherung L · Eigenbeträge / S. Exakt ist
// die Näherung nur bei einem linearen Schlüssel; der Ausweis nennt sie so.
export function selfLandlordRaw(landlordCents: number, usersTotalCents: number, selfNetCents: number, givenCents: number | null): { raw: number; approximated: boolean } {
  if (givenCents !== null) return { raw: givenCents, approximated: false }
  if (selfNetCents <= 0 || usersTotalCents <= 0) return { raw: 0, approximated: false }
  return { raw: (landlordCents * selfNetCents) / usersTotalCents, approximated: true }
}

// Der Anteil eines Mieters an einer Bezugsgröße: beim reinen Ausweis seine Messdienstbeträge im
// Topf, bei der eigenen Aufteilung (PR 7) sein Anteil an den Brennstoffpositionen.
export type ReliefShare = { tenancyId: string; cents: number }

// Abzug je Mieter nach Anteil (Entwurf 9.4, R-A5): r = L · x / F. Gerundet wird beim Aufrufer, als
// eine Verteilung von R = round(Σ r) mit `distributeCents`.
export function reliefsByShare(landlordCents: number, shares: readonly ReliefShare[], totalCents: number): { tenancyId: string; raw: number }[] {
  return shares.map((s) => ({ tenancyId: s.tenancyId, raw: totalCents > 0 ? (landlordCents * s.cents) / totalCents : 0 }))
}

export type ReliefProblem = { kind: 'sum'; givenCents: number } | { kind: 'tenancy'; tenancyId: string; givenCents: number; shareCents: number }

// Abzugsbeträge beim reinen Ausweis (Entwurf 7.5): die Werte laut Messdienst, geprüft auf
// Σ r ≤ L und r ≤ x. Ist das verletzt, rechnet Mietfuchs alle nach Anteil (L · x / S); fehlt nur
// ein Wert, wird nur er so ergänzt.
export function shownReliefs(
  landlordCents: number,
  usersTotalCents: number,
  shares: readonly ReliefShare[],
  given: readonly Co2TenantRelief[],
): { raws: { tenancyId: string; raw: number; approximated: boolean }[]; problem: ReliefProblem | null; missing: string[] } {
  const proportional = reliefsByShare(landlordCents, shares, usersTotalCents)
  const byId = new Map(given.map((g) => [g.tenancyId, g.cents]))
  const shareOf = new Map(shares.map((s) => [s.tenancyId, s.cents]))
  const givenCents = given.reduce((a, g) => a + g.cents, 0)
  const over = given.find((g) => g.cents > (shareOf.get(g.tenancyId) ?? 0))
  const problem: ReliefProblem | null = givenCents > landlordCents
    ? { kind: 'sum', givenCents }
    : over ? { kind: 'tenancy', tenancyId: over.tenancyId, givenCents: over.cents, shareCents: shareOf.get(over.tenancyId) ?? 0 } : null
  if (problem) return { raws: proportional.map((p) => ({ ...p, approximated: true })), problem, missing: [] }
  const missing: string[] = []
  const raws = proportional.map((p) => {
    const g = byId.get(p.tenancyId)
    if (g !== undefined) return { tenancyId: p.tenancyId, raw: g, approximated: false }
    missing.push(p.tenancyId)
    return { ...p, approximated: true }
  })
  return { raws, problem: null, missing }
}
```

Hinweis zu `over`: Ein Betrag für ein Mietverhältnis ohne Messdienstbetrag im Topf hat den Anteil 0;
jeder positive Betrag ist dann zu viel (der letzte Fall im Test).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/co2.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (co2.test.ts: 9 Tests).

- [ ] **Step 6: Commit**

```bash
git add shared/co2Probe.ts server/src/co2.ts server/test/co2.test.ts server/test/law-literals.test.ts
git commit -m "CO₂: Probe, Einstufung mit Rundung und gekürzter Tabelle, Nachstufung, Eigenanteil und Abzugsbeträge

Reine Funktionen mit den Rechenbeispielen des Entwurfs (G-B3, B1, B8, G-B5, Beispiel B).

Refs #97, #209"
```

---
### Task 5: CO₂-Angaben und Warmwasser lesen und schreiben

Eine Heizperiode bekommt ihre Zeile in `heating_periods`, sobald etwas zu ihr gespeichert wird.
Gespeichert wird nur, was in dieser Version gerechnet wird: CO₂-Angaben bei einer Anlage, die ein
Messdienst oder die Gemeinschaft abrechnet, und die Angabe zum Warmwasser. Dazu die Objektgrenze der
Beträge je Mietverhältnis und das Entfernen einer Anlage mit CO₂-Angaben.

**Files:**
- Create: `server/src/db/co2.ts`
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts`
- Test: `server/test/db-co2.test.ts` (neu), `server/test/db-stock.test.ts`

**Interfaces:**
- Consumes (Task 1, 2; PR 2, PR 4, PR 5): `co2Statements`, `co2TenantReliefs`, `CO2_METHODS`, `DHW_METHODS`, `heatingPeriods`, `heatingPlants`, `closedSettlements`, `closedHeatingSettlements`; aus `shared/heatingPeriod.ts` `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`; `HeatingPlant.periodChanges`, `HeatingPlant.separateSpans`; `costItems`, `tenancies`, `units`; `readHeatingPlants`, `readProperties`, `readCostItems`; `HeatingError`, `CrossPropertyError`, `has`, `raw`, `merged`, `oneOfOrUndefined`, `asNullableFilled`; `newId` (store.ts); `co2ApplicableFrom`, `co2FirstPeriodStart`, `germanDate`, `valueAt`; aus shared/period.ts `parsePeriodKey`, `periodContaining`, `periodLabel`, `periodOfKey`, `periodsBetween`, `resolvePeriodParam`, `rulesOf`, `periodKey`.
- Produces:
  - read.ts: `readCo2Statements(db: Database): Promise<Co2Statement[]>`, `readHeatingPeriodRows(db: Database): Promise<HeatingPeriodData[]>`; `Stock.co2Statements`, `Stock.heatingPeriodRows`
  - db/co2.ts: `heatingPeriodViews(db: Database, plantId: string, periodParam: string): Promise<HeatingPeriodView[] | null>`, `saveCo2Statement(db: Database, plantId: string, period: string, body: unknown): Promise<Co2Statement | null>`, `removeCo2Statement(db: Database, plantId: string, period: string): Promise<boolean | null>`, `saveHotWater(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingPeriodView['hotWater'] | null>` (`null` heißt: Anlage gibt es nicht)
  - heating.ts: `PlantRemoval` + `{ removed: false; reason: 'co2'; periods: string[] }`

- [ ] **Step 1: Write the failing tests**

`server/test/db-co2.test.ts`:

```ts
// CO₂-Angaben und Warmwasser je Heizperiode in der Datenbank (Heizung PR 6, Entwurf 5.5, 7, 11.3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { heatingPeriodViews, removeCo2Statement, saveCo2Statement, saveHotWater } from '../src/db/co2.ts'
import { createHeatingPlant, removeHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readCo2Statements } from '../src/db/read.ts'
import { closeSettlement, createEntity, createProperty, crossPropertyViolations, CrossPropertyError, HeatingError, updateEntity } from '../src/db/repository.ts'
import { units } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-co2-'))
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

// Ein Haus mit zwei Wohnungen, je einem Mieter, einer Gasheizung beim Messdienst und der
// Messdienstposition 2025.
async function bestand(opened: Opened, method: 'service' | 'manual' = 'service'): Promise<void> {
  await opened.write(async (db) => {
    for (const u of ['a', 'b']) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method })
    await createEntity(db, 'costItems', 'hz', {
      propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Messdienst', amountCents: 100500, key: 'amounts',
      tenancyAmounts: { ta: 60000, tb: 40000 },
    })
  })
}

const vorwegabzug = { method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2, reliefs: [{ tenancyId: 'ta', cents: 300 }] }

test('CO₂-Angaben: speichern legt die Heizperiode an, ein zweites Speichern ergänzt, Beträge je Mieter werden ersetzt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const gespeichert = await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug)) ?? assert.fail('keine Anlage')
    assert.deepEqual([gespeichert.plantId, gespeichert.period, gespeichert.method, gespeichert.serviceUsersTotalCents, gespeichert.reliefs], ['hp', '2025-01', 'serviceDeducted', 100000, [{ tenancyId: 'ta', cents: 300 }]])
    const ergaenzt = await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { serviceTotalCents: 1250, reliefs: [{ tenancyId: 'tb', cents: 200 }] })) ?? assert.fail('keine Anlage')
    assert.deepEqual([ergaenzt.serviceUsersTotalCents, ergaenzt.serviceTotalCents, ergaenzt.reliefs], [100000, 1250, [{ tenancyId: 'tb', cents: 200 }]])
    assert.equal((await opened.read(readCo2Statements)).length, 1)
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.period, view?.label, view?.closed, view?.co2?.serviceTotalCents, view?.items.map((i) => i.id)], ['2025-01', '2025', false, 1250, ['hz']])
    assert.equal(await opened.read((db) => heatingPeriodViews(db, 'gibt-es-nicht', '2025')), null)
    assert.equal(await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), true)
    assert.equal(await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), false)
  })
})

test('CO₂-Angaben: Sperren und Pflichtangaben, jede mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const speichern = (body: unknown, period = '2025-01') => opened.write((db) => saveCo2Statement(db, 'hp', period, body))
    await assert.rejects(speichern({}), heatingError(400, /Frage, ob die Kostenaufstellung/))
    await assert.rejects(speichern({ method: 'self' }), heatingError(400, /späteren Version/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceLandlordCents: 500, serviceUnitsCount: 2 }), heatingError(400, /Summe der Kosten aller Nutzer/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceUsersTotalCents: 100000, serviceUnitsCount: 2 }), heatingError(400, /CO₂-Anteil des Vermieters/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 0 }), heatingError(400, /Nutzeinheiten/))
    await assert.rejects(speichern({ ...vorwegabzug, reliefs: [{ tenancyId: 'ta', cents: -1 }] }), heatingError(400, /ab 0 €/))
    await assert.rejects(speichern({ ...vorwegabzug, serviceCostItemId: 'gibt-es-nicht' }), heatingError(400, /Einzelbeträge des Messdienstes/))
    await assert.rejects(speichern(vorwegabzug, '2025-02'), heatingError(400, /gibt es für diese Heizanlage nicht/))
    // Vor 2023 gibt es keine Aufteilung (§ 11 Abs. 2 Satz 1 CO2KostAufG).
    await assert.rejects(speichern(vorwegabzug, '2022-01'), heatingError(400, /01\.01\.2023/))
    // Der Messdienst hat nicht aufgeteilt: ohne Summen zulässig.
    assert.equal((await speichern({ method: 'selfAfterService' }))?.method, 'selfAfterService')
  })
})

test('CO₂-Angaben: nur bei einer Anlage mit Messdienst; abgeschlossene Heizperiode gesperrt (409)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'manual')
    await assert.rejects(opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug)), heatingError(400, /freien Schlüsseln/))
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'volumeFormula' })), heatingError(400, /Messdienst oder die Gemeinschaft/))
  })
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    await opened.write((db) => closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { serviceTotalCents: 1 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter' })), heatingError(409, /abgeschlossen/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.equal(view?.closed, true)
  })
})

test('Warmwasser laut Messdienst: Formel mit oder ohne bestätigten Aufwand, Wärmezähler ohne Bestätigung', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'volumeFormula', dhwUnmeasurable: true })), { dhwMethod: 'volumeFormula', dhwUnmeasurable: true })
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter', dhwUnmeasurable: true })), { dhwMethod: 'heatMeter', dhwUnmeasurable: null })
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: null })), { dhwMethod: null, dhwUnmeasurable: null })
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'schaetzung' })), heatingError(400, /Verfahren/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.hotWater, { dhwMethod: null, dhwUnmeasurable: null })
  })
})

test('Objektgrenze: Beträge nur für Mietverhältnisse desselben Objekts; Wechsel und Archiv werden abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      // Ein drittes Mietverhältnis ohne Einzelbetrag: Nur der CO₂-Betrag hält es im Objekt.
      await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieter c', persons: 1, start: '2020-01-01' })
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createEntity(db, 'units', 'x', { propertyId: 'objekt-2', name: 'X', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'tx', { unitId: 'x', tenantName: 'Fremd', persons: 1, start: '2020-01-01' })
    })
    await assert.rejects(
      opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { ...vorwegabzug, reliefs: [{ tenancyId: 'tx', cents: 100 }] })),
      (err: unknown) => err instanceof CrossPropertyError && /anderen Objekts/.test(err.message),
    )
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { ...vorwegabzug, reliefs: [{ tenancyId: 'tc', cents: 100 }] }))
    await assert.rejects(
      opened.write((db) => updateEntity(db, 'tenancies', 'tc', { unitId: 'x' })),
      (err: unknown) => err instanceof CrossPropertyError && /CO₂-Angaben/.test(err.message),
    )
    // Ein von Hand bearbeitetes Archiv: die Wohnung des Mietverhältnisses steht jetzt im anderen
    // Objekt. Geändert wird an repository.ts vorbei, so wie es eine Datei von außen täte.
    await opened.write(async (db) => { await db.update(units).set({ propertyId: 'objekt-2' }).where(eq(units.id, 'c')) })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /CO₂-Betrag „vom Vermieter übernommen“ für Mieter c/.test(b)), befunde.join('\n'))
  })
})

test('Heizanlage entfernen: mit CO₂-Angaben 409 statt stillem Löschen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp')), { removed: false, reason: 'co2', periods: ['2025-01'] })
    await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01'))
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp'))).removed, true)
  })
})
```

In `server/test/db-stock.test.ts`: Prüft ein Test die Schlüssel von `Stock` wörtlich, dort
`'co2Statements'` und `'heatingPeriodRows'` hinter `'heatingPlants'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-co2.test.ts`
Expected: FAIL mit `Cannot find module '…/src/db/co2.ts'`.

- [ ] **Step 3: Lesen (`server/src/db/read.ts`)**

Aus `'./schema.ts'` zusätzlich `co2Statements`, `co2TenantReliefs` importieren (und `heatingPeriods`,
falls noch nicht), als Typen `Co2Statement`, `HeatingPeriodData`; aus `'../../../shared/period.ts'`
`periodKey`, falls noch nicht. Hinter `readHeatingPlants` (PR 4):

```ts
// Die CO₂-Angaben je Heizperiode (Heizung PR 6), mit Anlage und Heizperiode aus `heating_periods`
// und den Beträgen „vom Vermieter übernommen“ je Mietverhältnis.
export async function readCo2Statements(db: Database): Promise<Co2Statement[]> {
  const rows = await db
    .select({ statement: co2Statements, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(co2Statements)
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"co2_statements".rowid`)
  const reliefs = await db.select().from(co2TenantReliefs).orderBy(INSERTION_ORDER)
  const byStatement = groupBy(reliefs, (r) => r.statementId, (r) => ({ tenancyId: r.tenancyId, cents: r.cents }))
  return rows.map(({ statement, plantId, period }) => ({
    ...statement,
    plantId,
    period: periodKey(String(period)),
    reliefs: byStatement.get(statement.heatingPeriodId) ?? [],
  }))
}

// Die Zeilen der Heizperioden (PR 4), für die Angaben zum Warmwasser im Schnappschuss.
export async function readHeatingPeriodRows(db: Database): Promise<HeatingPeriodData[]> {
  return await db.select().from(heatingPeriods).orderBy(INSERTION_ORDER)
}
```

(`eq` und `sql` stehen in read.ts schon im Import aus `'drizzle-orm'`; sonst ergänzen.) In
`Stock` hinter `heatingPlants` (PR 4):

```ts
  // CO₂-Angaben und Zeilen der Heizperioden (Heizung PR 6)
  co2Statements: Co2Statement[]
  heatingPeriodRows: HeatingPeriodData[]
```

und in `readStock` hinter `heatingPlants: await readHeatingPlants(db),`:

```ts
    co2Statements: await readCo2Statements(db),
    heatingPeriodRows: await readHeatingPeriodRows(db),
```

- [ ] **Step 4: Schreiben (`server/src/db/co2.ts`)**

```ts
// CO₂-Angaben und Warmwasser je Heizperiode (Heizung PR 6, #97, #209, #211; Entwurf 5.5, 7, 11.3).
//
// Eine Heizperiode bekommt ihre Zeile in `heating_periods` (PR 4), sobald jemand etwas zu ihr
// speichert. Daran hängen die CO₂-Angaben (`co2_statements`, eine Zeile je Heizperiode) und die
// Beträge „vom Vermieter übernommen“ je Mietverhältnis (`co2_tenant_reliefs`).
//
// Welche Heizperioden es gibt, rechnet shared/period.ts aus dem Rhythmus der Anlage (eigene
// Heizperiode, PR 5) oder, ohne eigenen, aus dem des Objekts. Eine Heizperiode gehört in die
// Abrechnung des Objektzeitraums, der ihr Ende enthält (Entwurf 3.0, W1).
//
// Gespeichert wird nur, was diese Version rechnet: Angaben eines Messdienstes oder der Gemeinschaft
// (Methode der Anlage `service`). Die eigene Aufteilung (`self`, freie Schlüssel) kommt mit PR 7.
//
// Diese Datei importiert aus repository.ts und read.ts, nie umgekehrt.
import { and, count, eq, inArray } from 'drizzle-orm'
import type { BillingPeriod, Co2Statement, Co2TenantRelief, HeatingPeriodView, HeatingPlant, PeriodKey, PeriodRules } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { co2ApplicableFrom, co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, valueAt } from '../../../shared/law/register.ts'
import { heatingPeriodsEndingIn, plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { parsePeriodKey, periodContaining, periodLabel, periodOfKey, resolvePeriodParam, rulesOf } from '../../../shared/period.ts'
import { newId } from '../store.ts'
import type { Database, Executor } from './client.ts'
import { readCo2Statements, readCostItems, readHeatingPlants, readProperties } from './read.ts'
import { asNullableFilled, CrossPropertyError, has, HeatingError, merged, oneOfOrUndefined, raw } from './repository.ts'
import {
  closedHeatingSettlements, closedSettlements, CO2_METHODS, co2Statements, co2TenantReliefs, costItems, DHW_METHODS, heatingPeriods, tenancies,
  units,
} from './schema.ts'

const ASK_METHOD = 'Bitte beantworten Sie zuerst die Frage, ob die Kostenaufstellung eine Zeile wie „Abzüglich CO₂-Kosten Vermieter“ enthält.'
const LATER_SELF = 'Die eigene Aufteilung der CO₂-Kosten aus der Brennstoffrechnung kommt mit einer späteren Version. Übernehmen Sie bis dahin die Angaben Ihres Messdienstes.'
const LATER_MANUAL = 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf. CO₂-Angaben eines Messdienstes gehören zu einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet.'
const closedText = (h: BillingPeriod) =>
  `Die Heizperiode ${periodLabel(h)} ist abgeschlossen; ihre Angaben bleiben, wie sie beim Abschluss waren. Öffnen Sie die Abrechnung wieder, um etwas zu ändern.`

type PlantContext = { plant: HeatingPlant; objectRules: PeriodRules; plantRules: PeriodRules }

// Die Anlage mit dem Rhythmus ihres Objekts und ihrem eigenen. Ohne eigenen Beginnmonat folgt die
// Heizperiode dem Objekt samt seinen Wechseln (Entwurf 3.0); mit eigenem gelten Beginnmonat und
// Wechsel der Anlage (`plantRules`, PR 5; `periodChanges` füllt `readHeatingPlants`).
async function plantContext(db: Database, plantId: string): Promise<PlantContext | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  return { plant, objectRules, plantRules: plantRules(plant, objectRules) }
}

function heatingPeriodOf(ctx: PlantContext, text: string): BillingPeriod {
  const key = parsePeriodKey(text)
  const h = key === null ? null : periodOfKey(ctx.plantRules, key)
  if (!h) throw new HeatingError(400, `Eine Heizperiode „${text}“ gibt es für diese Heizanlage nicht. Bitte laden Sie die Seite neu.`)
  return h
}

// Abgeschlossen ist eine Heizperiode nach Weg d mit ihrer eigenen Heizkostenabrechnung
// (`closed_heating_settlements`, PR 5); der Abschluss von P friert sie nicht ein (B3). Jede andere mit
// der Abrechnung des Objektzeitraums, der ihr Ende enthält (W1).
async function heatingPeriodClosed(db: Executor, ctx: PlantContext, h: BillingPeriod): Promise<boolean> {
  if (settledSeparately(ctx.plant, ctx.objectRules, h)) {
    const [heizung] = await db
      .select({ n: count() })
      .from(closedHeatingSettlements)
      .where(and(eq(closedHeatingSettlements.plantId, ctx.plant.id), eq(closedHeatingSettlements.period, h.key)))
    return (heizung?.n ?? 0) > 0
  }
  const p = periodContaining(ctx.objectRules, h.to)
  const [gesamt] = await db
    .select({ n: count() })
    .from(closedSettlements)
    .where(and(eq(closedSettlements.propertyId, ctx.plant.propertyId), eq(closedSettlements.period, p.key)))
  return (gesamt?.n ?? 0) > 0
}

async function ensureHeatingPeriod(db: Executor, plantId: string, key: PeriodKey): Promise<string> {
  const [row] = await db.select({ id: heatingPeriods.id }).from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, key)))
  if (row) return row.id
  const id = newId()
  await db.insert(heatingPeriods).values({ id, plantId, period: key })
  return id
}

// ---------- Lesen ----------

// Die Heizperioden der Anlage, die im Abrechnungszeitraum P enden, mit ihren Angaben und den
// Positionen der Anlage in dieser Heizperiode (für die Probe der Oberfläche). Ohne eigenen Rhythmus
// genau P.
export async function heatingPeriodViews(db: Database, plantId: string, periodParam: string): Promise<HeatingPeriodView[] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const resolved = resolvePeriodParam(ctx.objectRules, periodParam)
  if ('error' in resolved) throw new HeatingError(400, resolved.error)
  const p = resolved.period
  const hs = heatingPeriodsEndingIn(ctx.plantRules, p)
  const statements = (await readCo2Statements(db)).filter((s) => s.plantId === plantId)
  const rows = await db.select().from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const items = (await readCostItems(db)).filter((c) => c.heatingPlantId === plantId && c.category === HEATING_CATEGORY)
  const views: HeatingPeriodView[] = []
  for (const h of hs) {
    const row = rows.find((r) => r.period === h.key)
    views.push({
      plantId,
      period: h.key,
      label: periodLabel(h),
      from: h.from,
      to: h.to,
      short: h.short,
      closed: await heatingPeriodClosed(db, ctx, h),
      hotWater: { dhwMethod: row?.dhwMethod ?? null, dhwUnmeasurable: row?.dhwUnmeasurable ?? null },
      co2: statements.find((s) => s.period === h.key) ?? null,
      items: items
        .filter((c) => c.period === h.key)
        .map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, key: c.key, tenancyAmounts: c.tenancyAmounts, selfAmounts: c.selfAmounts })),
    })
  }
  return views
}

// ---------- CO₂-Angaben ----------

const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Beträge je Mietverhältnis aus dem Rumpf: jede Kennung einmal, ganze Cent ab 0. Ein leerer Betrag
// ist keine Angabe; ein ungültiger ist ein Fehler mit Satz, kein stilles Weglassen.
function readReliefs(value: unknown): Co2TenantRelief[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Co2TenantRelief[] = []
  for (const row of value) {
    const tenancyId = asNullableFilled(raw(row, 'tenancyId'))
    const cents = raw(row, 'cents')
    if (tenancyId === null || seen.has(tenancyId) || cents === null || cents === undefined || cents === '') continue
    if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) {
      throw new HeatingError(400, 'Ein Betrag „vom Vermieter übernommen“ ist ein Betrag ab 0 €.')
    }
    seen.add(tenancyId)
    result.push({ tenancyId, cents })
  }
  return result
}

// Ein neuer Datensatz braucht die Antwort auf die Frage nach der Abzugszeile; eine Vorgabe gibt es
// bewusst nicht (Entwurf 7.2).
function newStatement(plantId: string, period: PeriodKey, body: unknown): Co2Statement {
  const method = oneOfOrUndefined(CO2_METHODS, raw(body, 'method'))
  if (method === undefined) throw new HeatingError(400, ASK_METHOD)
  return {
    heatingPeriodId: '', plantId, period, method, areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null,
    serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
    serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null,
    serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
  }
}

// Ergänzt, wie die Sammlungen in repository.ts: Was im Rumpf steht, ersetzt; was fehlt, bleibt.
function mergeCo2(current: Co2Statement, body: unknown): Co2Statement {
  return {
    ...current,
    method: merged(body, 'method', current.method, (v) => oneOfOrUndefined(CO2_METHODS, v) ?? current.method),
    areaM2: merged(body, 'areaM2', current.areaM2, nullableNumber),
    serviceEmissionsKg: merged(body, 'serviceEmissionsKg', current.serviceEmissionsKg, nullableNumber),
    serviceAreaM2: merged(body, 'serviceAreaM2', current.serviceAreaM2, nullableNumber),
    serviceKgPerM2: merged(body, 'serviceKgPerM2', current.serviceKgPerM2, nullableNumber),
    serviceLandlordPermille: merged(body, 'serviceLandlordPermille', current.serviceLandlordPermille, nullableInt),
    serviceTotalCents: merged(body, 'serviceTotalCents', current.serviceTotalCents, nullableInt),
    serviceLandlordCents: merged(body, 'serviceLandlordCents', current.serviceLandlordCents, nullableInt),
    serviceUsersTotalCents: merged(body, 'serviceUsersTotalCents', current.serviceUsersTotalCents, nullableInt),
    serviceUsersTotalApprox: merged(body, 'serviceUsersTotalApprox', current.serviceUsersTotalApprox, (v) => v === true),
    serviceUnitsCount: merged(body, 'serviceUnitsCount', current.serviceUnitsCount, nullableInt),
    serviceCostItemId: merged(body, 'serviceCostItemId', current.serviceCostItemId, asNullableFilled),
    serviceSelfLandlordCents: merged(body, 'serviceSelfLandlordCents', current.serviceSelfLandlordCents, nullableInt),
    serviceFuelGrossCents: merged(body, 'serviceFuelGrossCents', current.serviceFuelGrossCents, nullableInt),
    serviceFuelNetCents: merged(body, 'serviceFuelNetCents', current.serviceFuelNetCents, nullableInt),
    reliefs: merged(body, 'reliefs', current.reliefs, readReliefs),
  }
}

async function guardCo2(db: Executor, ctx: PlantContext, h: BillingPeriod, st: Co2Statement): Promise<void> {
  if (st.method === 'self') throw new HeatingError(400, LATER_SELF)
  if (ctx.plant.method !== 'service') throw new HeatingError(400, LATER_MANUAL)
  if (!valueAt(co2ApplicableFrom, h.from)) {
    throw new HeatingError(400, `Die CO₂-Kosten sind erst für Abrechnungszeiträume aufzuteilen, die am oder nach dem ${germanDate(co2FirstPeriodStart())} beginnen (§ 11 Abs. 2 Satz 1 CO2KostAufG); diese Heizperiode beginnt früher.`)
  }
  if (st.method === 'serviceDeducted' || st.method === 'serviceShown') {
    if (st.serviceUsersTotalCents === null || st.serviceUsersTotalCents < 0) {
      throw new HeatingError(400, 'Bitte tragen Sie die Summe der Kosten aller Nutzer für Heizung und Warmwasser ein, so wie sie in der Kostenaufstellung steht, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.')
    }
    if (st.serviceLandlordCents === null || st.serviceLandlordCents < 0) {
      throw new HeatingError(400, 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein, wie ihn die Abrechnung nennt.')
    }
    if (st.serviceUnitsCount === null || st.serviceUnitsCount < 1) {
      throw new HeatingError(400, 'Bitte tragen Sie die Zahl der Nutzeinheiten laut Abrechnung ein, mindestens 1.')
    }
  }
  if (st.serviceCostItemId !== null) {
    const [c] = await db.select({ plantId: costItems.heatingPlantId, period: costItems.period, key: costItems.key }).from(costItems).where(eq(costItems.id, st.serviceCostItemId))
    if (!c || c.plantId !== ctx.plant.id || String(c.period) !== h.key || c.key !== 'amounts') {
      throw new HeatingError(400, 'Die gewählte Position gehört nicht zu den Einzelbeträgen des Messdienstes dieser Heizperiode. Bitte wählen Sie eine Position der Heizanlage mit dem Schlüssel Einzelbeträge.')
    }
  }
  // Beträge je Mietverhältnis nur für Mietverhältnisse desselben Objekts (Objektgrenze, #92).
  const ids = st.reliefs.map((r) => r.tenancyId)
  if (ids.length > 0) {
    const rows = await db.select({ id: tenancies.id, propertyId: units.propertyId }).from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(inArray(tenancies.id, ids))
    if (rows.some((r) => r.propertyId !== ctx.plant.propertyId)) {
      throw new CrossPropertyError('Ein Betrag „vom Vermieter übernommen“ gehört zu einem Mietverhältnis eines anderen Objekts als die Heizanlage. Bitte wählen Sie ein Mietverhältnis desselben Objekts.')
    }
    if (rows.length < ids.length) {
      throw new HeatingError(400, 'Ein Mietverhältnis, für das ein Betrag „vom Vermieter übernommen“ eingetragen ist, gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    }
  }
}

const co2Row = (st: Co2Statement, heatingPeriodId: string) => ({
  heatingPeriodId, method: st.method, areaM2: st.areaM2, serviceEmissionsKg: st.serviceEmissionsKg, serviceAreaM2: st.serviceAreaM2,
  serviceKgPerM2: st.serviceKgPerM2, serviceLandlordPermille: st.serviceLandlordPermille, serviceTotalCents: st.serviceTotalCents,
  serviceLandlordCents: st.serviceLandlordCents, serviceUsersTotalCents: st.serviceUsersTotalCents, serviceUsersTotalApprox: st.serviceUsersTotalApprox,
  serviceUnitsCount: st.serviceUnitsCount, serviceCostItemId: st.serviceCostItemId, serviceSelfLandlordCents: st.serviceSelfLandlordCents,
  serviceFuelGrossCents: st.serviceFuelGrossCents, serviceFuelNetCents: st.serviceFuelNetCents,
})

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveCo2Statement(db: Database, plantId: string, period: string, body: unknown): Promise<Co2Statement | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const current = (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key) ?? null
  const next = mergeCo2(current ?? newStatement(plantId, h.key, body), body)
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    await guardCo2(tx, ctx, h, next)
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    const { heatingPeriodId: _id, ...rest } = co2Row(next, heatingPeriodId)
    if (current) await tx.update(co2Statements).set(rest).where(eq(co2Statements.heatingPeriodId, heatingPeriodId))
    else await tx.insert(co2Statements).values(co2Row(next, heatingPeriodId))
    await tx.delete(co2TenantReliefs).where(eq(co2TenantReliefs.statementId, heatingPeriodId))
    if (next.reliefs.length > 0) {
      await tx.insert(co2TenantReliefs).values(next.reliefs.map((r) => ({ statementId: heatingPeriodId, tenancyId: r.tenancyId, cents: r.cents })))
    }
  })
  return (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key) ?? null
}

// `true` entfernt, `false` gab es nicht, `null` keine Anlage.
export async function removeCo2Statement(db: Database, plantId: string, period: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const current = (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key)
  if (!current) return false
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    await tx.delete(co2Statements).where(eq(co2Statements.heatingPeriodId, current.heatingPeriodId))
  })
  return true
}

// ---------- Warmwasser laut Messdienst (#211, Entwurf 7.7) ----------

// Wie der Messdienst die Wärme für das Warmwasser ermittelt hat, und bei einer Formel, ob das Messen
// nur mit unzumutbar hohem Aufwand möglich wäre (§ 9 Abs. 2 Satz 2 HeizkostenV). Die Bestätigung
// gibt es nur zu einer Formel.
export async function saveHotWater(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingPeriodView['hotWater'] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'service') {
    throw new HeatingError(400, 'Die Angabe, wie die Wärme für das Warmwasser ermittelt wurde, gibt es hier nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet. Bei eigener Abrechnung rechnet Mietfuchs den Warmwasseranteil mit einer späteren Version selbst.')
  }
  const h = heatingPeriodOf(ctx, period)
  const text = raw(body, 'dhwMethod')
  const dhwMethod = text === null || text === undefined || text === '' ? null : oneOfOrUndefined(DHW_METHODS, text)
  if (dhwMethod === undefined) throw new HeatingError(400, 'Dieses Verfahren für das Warmwasser kennt Mietfuchs nicht. Bitte wählen Sie aus der Liste.')
  const formula = dhwMethod === 'volumeFormula' || dhwMethod === 'areaFormula'
  const answer = raw(body, 'dhwUnmeasurable')
  const dhwUnmeasurable = formula && has(body, 'dhwUnmeasurable') && typeof answer === 'boolean' ? answer : null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({ dhwMethod, dhwUnmeasurable }).where(eq(heatingPeriods.id, heatingPeriodId))
  })
  return { dhwMethod, dhwUnmeasurable }
}
```

`resolvePeriodParam` liefert `{ period }` oder `{ status, error }` (PR 2); die Unterscheidung über
`'error' in resolved` hält beide Fälle auseinander. Rhythmus, Heizperioden in P und Weg d kommen aus
`shared/heatingPeriod.ts` (PR 5); `HeatingPlant` erfüllt dort `PlantWay` (Beginnmonat, Wechsel,
Spannen nach Weg d).

- [ ] **Step 5: Objektgrenze (`server/src/db/repository.ts`)**

Aus `'./schema.ts'` zusätzlich `co2Statements`, `co2TenantReliefs` importieren (`heatingPeriods` und
`heatingPlants` sind seit PR 4 da; sonst ergänzen).

In `guardTenancy` die Zeilen ab `const betraege = …` bis zum Ende der Funktion ersetzen durch:

```ts
  const betraege = await db.select({ n: count() }).from(costItemAmounts).where(eq(costItemAmounts.tenancyId, after.id))
  // CO₂-Beträge „vom Vermieter übernommen“ (Heizung PR 6) gehören ebenso zur Heizanlage des alten Objekts.
  const co2 = await db.select({ n: count() }).from(co2TenantReliefs).where(eq(co2TenantReliefs.tenancyId, after.id))
  if ((betraege[0]?.n ?? 0) === 0 && (co2[0]?.n ?? 0) === 0) return
  throw new CrossPropertyError(
    `Das Mietverhältnis „${after.tenantName}“ kann nicht in eine Wohnung eines anderen Objekts wechseln, weil noch ` +
      'Einzelbeträge von Kostenpositionen oder CO₂-Angaben des bisherigen Objekts an ihm hängen. Bitte lösen Sie diese Verweise zuerst.',
  )
```

In `crossPropertyViolations` vor `return befunde`:

```ts
  // CO₂-Angaben (Heizung PR 6): Beträge für Mietverhältnisse und die Position mit L gehören zum
  // Objekt der Heizanlage.
  const co2 = await db
    .select({ tenantName: tenancies.tenantName })
    .from(co2TenantReliefs)
    .innerJoin(co2Statements, eq(co2TenantReliefs.statementId, co2Statements.heatingPeriodId))
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(tenancies, eq(co2TenantReliefs.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const c of co2) befunde.push(`Ein CO₂-Betrag „vom Vermieter übernommen“ für ${c.tenantName} gehört zu einer Heizanlage eines anderen Objekts.`)
  const co2Position = await db
    .select({ description: costItems.description })
    .from(co2Statements)
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(costItems, eq(co2Statements.serviceCostItemId, costItems.id))
    .where(ne(costItems.propertyId, heatingPlants.propertyId))
  for (const c of co2Position) befunde.push(`Die CO₂-Angaben einer Heizanlage verweisen auf die Kostenposition „${c.description}“ eines anderen Objekts.`)
```

- [ ] **Step 6: Anlage mit CO₂-Angaben (`server/src/db/heating.ts`)**

Aus `'./schema.ts'` zusätzlich `co2Statements` und `heatingPeriods` importieren. `PlantRemoval`
ersetzen:

```ts
export type PlantRemoval =
  | { removed: true; released: number }
  | { removed: false; reason: 'missing' }
  | { removed: false; reason: 'meters'; meters: string[] }
  | { removed: false; reason: 'co2'; periods: string[] }
```

In `removeHeatingPlant` direkt hinter `if (!plant) return { removed: false, reason: 'missing' }`:

```ts
  // CO₂-Angaben (Heizung PR 6) fielen mit den Heizperioden (CASCADE). Sie sind erfasste Arbeit des
  // Vermieters; entfernen soll er sie selbst, wenn die Anlage wirklich entfällt.
  const co2 = await db
    .select({ period: heatingPeriods.period })
    .from(co2Statements)
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .where(eq(heatingPeriods.plantId, id))
  if (co2.length > 0) return { removed: false, reason: 'co2', periods: co2.map((c) => String(c.period)) }
```

In `server/src/index.ts` in `app.delete('/api/heating-plants/:id', …)` hinter der Zeile mit
`result.reason === 'missing'`:

```ts
  if (result.reason === 'co2') {
    return res.status(409).json({
      error: `Zu dieser Heizanlage sind CO₂-Angaben erfasst (Heizperiode ${result.periods.join(', ')}). Entfernen Sie sie auf der Seite Heizkosten, ` +
        'wenn die Anlage wirklich entfallen soll; sonst gingen sie mit ihr verloren.',
    })
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-co2.test.ts test/db-heizanlage.test.ts test/db-repository.test.ts test/db-stock.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS (db-co2.test.ts: 6 Tests).

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/co2.ts server/src/db/read.ts server/src/db/repository.ts server/src/db/heating.ts server/src/index.ts server/test/db-co2.test.ts server/test/db-stock.test.ts
git commit -m "CO₂-Angaben und Warmwasser je Heizperiode speichern und lesen

Nur bei einer Anlage mit Messdienst oder Gemeinschaft, ab 2023, nicht in abgeschlossenen
Heizperioden; Beträge je Mieter nur im eigenen Objekt; eine Anlage mit CO₂-Angaben wird nicht
still mitgelöscht.

Refs #97, #209, #211"
```

---

### Task 6: Routen

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 5): `heatingPeriodViews`, `saveCo2Statement`, `removeCo2Statement`, `saveHotWater`; `readData`, `writeData`, `bodyObject` in index.ts; `HeatingError` und `CrossPropertyError` in der Fehlerbehandlung (PR 4).
- Produces:
  - `GET /api/heating-plants/:id/periods?period=<Zeitraum des Objekts>` → `HeatingPeriodView[]` (404 ohne Anlage)
  - `PUT /api/heating-plants/:id/periods/:period/co2` → `Co2Statement`
  - `DELETE /api/heating-plants/:id/periods/:period/co2` → `{ ok: true; removed: boolean }`
  - `PUT /api/heating-plants/:id/periods/:period/hot-water` → `{ dhwMethod; dhwUnmeasurable }`

- [ ] **Step 1: Write the failing test**

In `server/test/api.test.ts` den Typimport aus `'../../shared/types.ts'` um `Co2Statement,
HeatingPeriodView` ergänzen und anhängen:

```ts
// ---------- CO₂-Angaben (Heizung PR 6) ----------

test('CO₂-Angaben über die Routen: speichern, lesen, entfernen, Sperren und 404', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    const mieter = await s.api<Tenancy>('/api/tenancies', postJson({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'service' })))
    await s.api<CostItem>('/api/costItems', postJson({
      period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
    }))
    const base = `/api/heating-plants/${plant.id}/periods`
    const gespeichert = await send(`${base}/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1 }) })
    assert.equal(gespeichert.status, 200)
    assert.equal((await jsonOf<Co2Statement>(gespeichert)).serviceLandlordCents, 500)
    const [view] = await s.api<HeatingPeriodView[]>(`${base}?period=2025`)
    assert.deepEqual([view?.period, view?.co2?.method, view?.items.length], ['2025-01', 'serviceDeducted', 1])
    const selbst = await send(`${base}/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'self' }) })
    assert.equal(selbst.status, 400)
    assert.match(await errorFrom(selbst), /späteren Version/)
    const wasser = await send(`${base}/2025-01/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: 'areaFormula' }) })
    assert.deepEqual(await jsonOf<unknown>(wasser), { dhwMethod: 'areaFormula', dhwUnmeasurable: null })
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /CO₂-Angaben erfasst/)
    assert.deepEqual(await jsonOf<unknown>(await send(`${base}/2025-01/co2`, { method: 'DELETE' })), { ok: true, removed: true })
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods?period=2025', { method: 'GET' })).status, 404)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/co2', { method: 'PUT', body: '{}' })).status, 404)
  } finally {
    s.stop()
  }
})
```

`postJson`, `jsonOf`, `errorFrom` stehen seit PR 4 in api.test.ts; `Tenancy`, `CostItem`,
`HeatingPlant`, `Unit` im Typimport (sonst ergänzen). Für den `GET`-Aufruf ohne Rumpf setzt `send`
einen Kopf `content-type`; das stört Express nicht.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- --test-name-pattern "CO₂-Angaben über die Routen" test/api.test.ts`
Expected: FAIL: `PUT …/co2` antwortet mit 404 (die Route gibt es nicht).

- [ ] **Step 3: Routen (`server/src/index.ts`)**

Import: `import { heatingPeriodViews, removeCo2Statement, saveCo2Statement, saveHotWater } from './db/co2.ts'`.
Hinter dem Block `// ---------- Heizanlage (Heizung PR 4) ----------`:

```ts
// ---------- Heizperioden: CO₂ und Warmwasser (Heizung PR 6) ----------
// Was gespeichert wird und was nicht, steht in db/co2.ts. `:period` ist der Schlüssel der
// Heizperiode (JJJJ-MM), `?period=` beim Lesen der Zeitraum des Objekts wie bei den übrigen Routen.
const NO_PLANT = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.get('/api/heating-plants/:id/periods', async (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : ''
  const views = await readData((db) => heatingPeriodViews(db, req.params.id, period))
  if (!views) return res.status(404).json({ error: NO_PLANT })
  res.json(views)
})
app.put('/api/heating-plants/:id/periods/:period/co2', async (req, res) => {
  const saved = await writeData((db) => saveCo2Statement(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
app.delete('/api/heating-plants/:id/periods/:period/co2', async (req, res) => {
  const removed = await writeData((db) => removeCo2Statement(db, req.params.id, req.params.period))
  if (removed === null) return res.status(404).json({ error: NO_PLANT })
  res.json({ ok: true, removed })
})
app.put('/api/heating-plants/:id/periods/:period/hot-water', async (req, res) => {
  const saved = await writeData((db) => saveHotWater(db, req.params.id, req.params.period, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
```

Steht `NO_PLANT` schon als Konstante im Block von PR 4, diese nehmen statt eine zweite anzulegen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/test/api.test.ts
git commit -m "Routen für CO₂-Angaben und Warmwasser je Heizperiode

Refs #97, #211"
```

---
### Task 7: Berechnung: Töpfe, Probe und Vorwegabzug (#209)

Der Schnappschuss bekommt die CO₂-Angaben und die Zeilen der Heizperioden. `computeSettlement`
bildet vor der Verteilung je Anlage und Heizperiode den Topf (6.1 Nr. 4.1), prüft die Angaben des
Messdienstes (7.3) und zerlegt beim Vorwegabzug den Vermieterrest der Position, in der L steckt
(7.4): L_self exakt in `selfUse`, `co2Share` über `take()`. Hinter der Verteilung stehen die Hinweise
der Probe und die Bewertung für den Druckblock (`Settlement.heating`).

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/co2.ts`, `server/src/calc.ts`
- Create: `server/testing/co2.ts`
- Test: `server/test/calc-co2.test.ts` (neu), `server/test/calc-heizanlage.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 1–4; PR 4, PR 5): `co2ApplicableFrom`, `co2StageTable`, `co2RoundingDecimals`, `co2CutMissing`; `serviceProbe`, `ProbeResult`; `restage`, `stageRanges`, `tableFactor`, `selfLandlordRaw`, `ReliefShare`; `Snapshot.heatingPlants`, `SnapshotCostItem.heatingPlantId`, `snapshotFor` und `heatingSnapshotFor` (PR 5), `mergeHeatingPart` in `computeSettlement` (PR 5); in calc.ts `landlordRecipients`, `take`, `warn`, `itemSubject`, `fmtCents`, `statements`, `landlordRows`, `lawLog`.
- Produces:
  - snapshot.ts: `SnapshotHeatingPlant` + `'energy'` (Pflicht; `name` bleibt optional wie in PR 5); `SnapshotHeatingPeriodRow = Pick<HeatingPeriodData, 'plantId' | 'period' | 'dhwMethod' | 'dhwUnmeasurable'>`; `Snapshot.co2Statements?: Co2Statement[]`, `Snapshot.heatingPeriodRows?: SnapshotHeatingPeriodRow[]`; `snapshotFor` und `heatingSnapshotFor` füllen beide für die Anlagen des Objekts
  - co2.ts: `type Co2Pot`, `co2PotsOf(snapshot, items): Co2Pot[]` (ein Topf je Anlage im Zeitraum der Berechnung), `type Co2Deduction = { landlordCents: number; selfRaw: number; selfApproximated: boolean }`, `co2DeductionsOf(pots, units, applicable): Map<string, Co2Deduction>`, `tenantLines(st, shares, printed): Co2TenantLine[]`, `co2Assessment(st, re, p): Co2Assessment`
  - calc.ts: Codes `co2.sum-check` (error), `co2.sum-check-approx` (hint), `co2.pool-foreign-item` (hint); `landlordRecipients` mit `co2ShareRaw: number | null`; `Settlement.heating`
  - server/testing/co2.ts: `withoutCo2<T>(settlement: T): Omit<T, 'heating'>`

- [ ] **Step 1: Write the failing tests**

`server/test/calc-co2.test.ts`:

```ts
// CO₂ beim Messdienst in der Berechnung (Heizung PR 6, #97, #209; Entwurf 7, 12.2, 12.3). Die
// Beispiele A, B und C, die Rechenfehler der ersten Fassung (G-B2, G-B3), die Irrtümer der Probe
// (7.3), die benannte Lücke, eine Gutschrift im Topf und die Eigentumswohnung stehen je als Test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { Co2Statement, LandlordPart } from '../../shared/types.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const own = (id: string): SnapshotUnit => unit(id, { participates: false, selfUsed: true, selfPersons: 1 })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const messdienst = (amountCents: number, tenancyAmounts: Record<string, number>, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'hz', period: P, category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents, key: 'amounts', tenancyAmounts,
  heatingPlantId: 'hp', ...over,
})
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})
const co2 = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: P, method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const snap = (s: Partial<SnapshotSource>, statements: Co2Statement[], plants: SnapshotHeatingPlant[] = [plant()]): Snapshot =>
  ({ ...snapshotOf(source(s), 2025), heatingPlants: plants, co2Statements: statements })
const settle = (s: Partial<SnapshotSource>, statements: Co2Statement[], plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement(snap(s, statements, plants))
const shareOf = (r: ComputedSettlement, tenancyId: string, itemId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const partsOf = (r: ComputedSettlement, itemId = 'hz'): LandlordPart[] => r.landlord.rows.find((x) => x.costItemId === itemId)?.landlordParts ?? []
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const taxOf = (s: Snapshot, itemId = 'hz') =>
  taxReport(s).expenses.items.find((x) => x.costItemId === itemId) ?? assert.fail(`${itemId} fehlt in der Steuerübersicht`)

// Beispiel A (Entwurf 7.4, Techem-Muster): abzüglich CO₂-Kosten Vermieter 87,50 € (250,00 € · 35 %),
// S = 3.845,51 €, Betrag 3.933,01 €. Die Aufteilung auf vier Nutzer ist erfunden, die Summe stammt
// aus dem Muster.
const TECHEM = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
const vier = { units: ['a', 'b', 'c', 'd'].map((u) => unit(u)), tenancies: ['a', 'b', 'c', 'd'].map((u) => tenancy(`t${u}`, u)) }
const techem = (over: Partial<Co2Statement> = {}): Co2Statement => co2({
  serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4, serviceTotalCents: 25000, serviceLandlordPermille: 350, serviceKgPerM2: 46.4, ...over,
})

test('Beispiel A: Probe exakt, co2Share 87,50 €, kein Mieter gekürzt, Werbungskosten 3.933,01 €', () => {
  const s = { ...vier, costItems: [messdienst(393301, TECHEM)] }
  const r = settle(s, [techem()])
  for (const [t, c] of Object.entries(TECHEM)) assert.equal(shareOf(r, t, 'hz'), c)
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  assert.ok(!codes(r).includes('co2.sum-check'))
  assert.ok(r.statements.every((st) => st.rows.every((row) => row.kind !== 'co2Relief')), 'beim Vorwegabzug keine Abzugszeile')
  const tax = taxOf(snap(s, [techem()]))
  assert.deepEqual([tax.amountCents, tax.privateCents, tax.deductibleCents], [393301, 0, 393301])
  const h = r.heating?.[0] ?? assert.fail('keine Heizanlage in der Abrechnung')
  assert.deepEqual([h.plantId, h.period, h.co2?.booked, h.co2?.deducted, h.co2?.stage?.landlordPercent, h.co2?.landlordCents], ['hp', P, true, true, 70, 8750])
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.stage-table'), 'die Stufentabelle friert mit ein')
})

test('Beispiel B: Eigennutzung, L_self exakt im Eigenanteil (620,69 €), co2Share 79,31 €; laut Messdienst 625,00 / 75,00 €', () => {
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 }, { selfAmounts: { c: 60000 } })] }
  const st = co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })
  const r = settle(s, [st])
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 62069 }, { reason: 'co2Share', cents: 7931 }])
  assert.equal(r.selfUsedShareCents, 62069)
  assert.equal(taxOf(snap(s, [st])).privateCents, 62069)
  assert.deepEqual([r.heating?.[0]?.co2?.selfLandlordCents, r.heating?.[0]?.co2?.selfApproximated], [2069, true])
  const laut = settle(s, [{ ...st, serviceSelfLandlordCents: 2500 }])
  assert.deepEqual(partsOf(laut), [{ reason: 'selfUse', cents: 62500 }, { reason: 'co2Share', cents: 7500 }])
})

test('Beispiel C: die Wohnung mit 600 € steht leer statt selbstgenutzt: co2Share 100 €, Rest 600 € (G-D2)', () => {
  const s = { units: [unit('a'), unit('b'), unit('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 10000 }, { reason: 'amountsRest', cents: 60000 }])
})

test('G-B2: Rest 60 €, L_self 20 €, co2Share 80 € → L_self 20 €, co2Share 40 €, Rest 0 (erste Fassung: 12 / 48)', () => {
  // „Ich finde diese Zeile nicht“: S ist geschätzt, die Probe meldet nur einen Hinweis, gebucht wird.
  const s = { units: [unit('a'), own('c')], tenancies: [tenancy('ta', 'a')], costItems: [messdienst(300000, { ta: 294000 })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceUsersTotalApprox: true, serviceLandlordCents: 10000, serviceSelfLandlordCents: 2000, serviceUnitsCount: 2 })])
  assert.deepEqual(partsOf(r), [{ reason: 'selfUse', cents: 2000 }, { reason: 'co2Share', cents: 4000 }])
  assert.ok(codes(r).includes('co2.sum-check-approx'))
  assert.ok(!codes(r).includes('co2.sum-check'))
})

test('G-B3: Einzelbeträge bis S + NE · 2 ct, ein Cent mehr ist ein Fehler; Betrag ± 1 ct', () => {
  const knapp = settle({ ...vier, costItems: [messdienst(393301, { ...TECHEM, td: TECHEM.td + 8 })] }, [techem()])
  assert.ok(!codes(knapp).includes('co2.sum-check'))
  // Der Rest reicht um 8 ct nicht für L: `take` kappt den co2Share (Entwurf 7.4).
  assert.deepEqual(partsOf(knapp), [{ reason: 'co2Share', cents: 8742 }])
  const drueber = settle({ ...vier, costItems: [messdienst(393301, { ...TECHEM, td: TECHEM.td + 9 })] }, [techem()])
  assert.ok(codes(drueber).includes('co2.sum-check'))
  assert.deepEqual(partsOf(drueber), [{ reason: 'amountsRest', cents: 8741 }])
  assert.ok(!codes(settle({ ...vier, costItems: [messdienst(393302, TECHEM)] }, [techem()])).includes('co2.sum-check'))
  assert.ok(codes(settle({ ...vier, costItems: [messdienst(393303, TECHEM)] }, [techem()])).includes('co2.sum-check'))
})

test('Irrtümer der Probe (Entwurf 7.3): „Ja“ mit Betrag S, „Nein“ obwohl abgezogen; Leerstand spielt keine Rolle', () => {
  // „Ja“ bei Bruttobeträgen oder beim Nettobetrag der Position (#209): Betrag = S, verlangt S + L.
  const netto = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem()])
  const text = textOf(netto, 'co2.sum-check')
  assert.match(text, /Ihre Positionen ergeben 3\.845,51 €\. Mit Abzugszeile müssten es S \+ L = 3\.933,01 € sein, ohne Abzugszeile S = 3\.845,51 €\./)
  assert.match(text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 33,10 €, tb \(b\) 28,76 €, tc \(c\) 30,45 € und td \(d\) 23,06 €/)
  assert.deepEqual(netto.notices.find((n) => n.code === 'co2.sum-check')?.subject, { kind: 'heatingCosts', id: 'hp' })
  assert.deepEqual(partsOf(netto), [])
  // „Nein“, obwohl abgezogen, Betrag brutto: Betrag = S + L, verlangt S.
  assert.ok(codes(settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ method: 'serviceShown' })])).includes('co2.sum-check'))
  // Leerstand und fremde Einheiten: S umfasst ihre Beträge, eingetragen sind sie nicht.
  const leer = settle(
    { units: [...vier.units, unit('e')], tenancies: vier.tenancies, costItems: [messdienst(393301 + 50000, TECHEM)] },
    [techem({ serviceUsersTotalCents: 384551 + 50000, serviceUnitsCount: 5 })],
  )
  assert.ok(!codes(leer).includes('co2.sum-check'))
  assert.deepEqual(partsOf(leer), [{ reason: 'co2Share', cents: 8750 }, { reason: 'amountsRest', cents: 50000 }])
})

test('Die frühere Anleitung: CO₂-Anteil der eigenen Wohnung schon im Eigenbetrag → die Probe meldet es (Review Focus 1)', () => {
  const s = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')], costItems: [messdienst(300000, { ta: 120000, tb: 110000 }, { selfAmounts: { c: 62069 } })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 290000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.match(textOf(r, 'co2.sum-check'), /Einzel- und Eigenbeträge ergeben zusammen 2\.920,69 €/)
  // Nichts doppelt privat: ohne Buchung bleibt der Eigenbetrag, wie er eingetragen ist.
  assert.equal(r.selfUsedShareCents, 62069)
})

test('Die benannte Lücke (Entwurf 7.4): „Nein“, obwohl abgezogen, und Betrag = S ist an der Probe nicht zu erkennen', () => {
  const r = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem({ method: 'serviceShown' })])
  assert.ok(!codes(r).includes('co2.sum-check'))
})

test('Gutschrift im Topf: zählt nicht zur Probe, wird verteilt wie bisher, Hinweis co2.pool-foreign-item (W9)', () => {
  const gutschrift: SnapshotCostItem = { id: 'gs', period: P, category: HEATING_CATEGORY, description: 'Gutschrift Versorger', amountCents: -4000, key: 'area', heatingPlantId: 'hp' }
  const r = settle({ ...vier, costItems: [messdienst(393301, TECHEM), gutschrift] }, [techem()])
  assert.ok(!codes(r).includes('co2.sum-check'))
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  const n = r.notices.find((x) => x.code === 'co2.pool-foreign-item') ?? assert.fail('kein Hinweis zur Gutschrift')
  assert.deepEqual([n.level, n.subject], ['hint', { kind: 'costItem', id: 'gs' }])
  assert.equal(shareOf(r, 'ta', 'gs'), -1000)
})

test('Eigentumswohnung (F2/F3): Gemeinschaft mit Vorwegabzug, Betrag S + L, co2Share in den Werbungskosten', () => {
  const s = { units: [unit('w')], tenancies: [tenancy('tw', 'w')], costItems: [messdienst(123000, { tw: 120000 })] }
  const gemeinschaft = [plant({ source: 'homeowners' })]
  const st = co2({ serviceUsersTotalCents: 120000, serviceLandlordCents: 3000, serviceUnitsCount: 1 })
  const r = settle(s, [st], gemeinschaft)
  assert.equal(shareOf(r, 'tw', 'hz'), 120000)
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 3000 }])
  const tax = taxOf(snap(s, [st], gemeinschaft))
  assert.deepEqual([tax.privateCents, tax.deductibleCents], [0, 123000])
})

test('Vor 2023 gibt es keine Aufteilung, auch nicht mit Datensatz (§ 11 Abs. 2 Satz 1 CO2KostAufG)', () => {
  const alt = calendarPeriod(2022)
  const r = computeSettlement({
    ...snapshotOf(source({ ...vier, costItems: [messdienst(393301, TECHEM, { period: alt })] }), 2022),
    heatingPlants: [plant()],
    co2Statements: [techem({ period: alt })],
  })
  assert.deepEqual(partsOf(r), [{ reason: 'amountsRest', cents: 8750 }])
  assert.equal(r.heating?.[0]?.co2 ?? null, null)
})

test('Eigene Heizperiode nach Weg b (PR 5): die Teilabrechnung bucht den Vorwegabzug, die Bewertung kommt in P an', () => {
  // Objekt im Kalenderjahr, Anlage Mai bis April: Die Heizperiode 2025/2026 endet in P = 2026 (W1).
  const H = periodKey('2025-05')
  const quelle = {
    properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null }],
    units: vier.units.map((u) => ({ ...u, propertyId: 'objekt-1' })),
    tenancies: vier.tenancies,
    costItems: [{ ...messdienst(393301, TECHEM, { period: H }), propertyId: 'objekt-1' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [{ ...plant({ periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false }), propertyId: 'objekt-1' }],
    co2Statements: [techem({ period: H })],
  }
  const zeitraum = periodOfKey({ startMonth: 1, changes: [] }, periodKey('2026-01')) ?? assert.fail('kein Zeitraum 2026')
  const r = computeSettlement(snapshotFor(quelle, 'objekt-1', zeitraum))
  assert.deepEqual(partsOf(r), [{ reason: 'co2Share', cents: 8750 }])
  assert.deepEqual(r.heating?.map((h) => [h.period, h.co2?.booked]), [['2025-05', true]])
})
```

Für den letzten Test `snapshotFor` aus `'../src/snapshot.ts'` und `periodKey, periodOfKey` aus
`'../../shared/period.ts'` importieren. Verlangt der Quelltyp von `snapshotFor` (PR 2, PR 5) weitere
Felder, nennt sie der Übersetzer; sie werden ergänzt wie in `calc-heizperiode.test.ts` (PR 5).

`server/test/calc-heizanlage.test.ts` (PR 4): Der Helfer `plant()` bekommt die beiden neuen Felder
des Schnappschusses:

```ts
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp1', name: 'Heizung', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-co2.test.ts`
Expected: FAIL. `partsOf(r)` ist `[{ reason: 'amountsRest', cents: 8750 }]` statt `co2Share`, `r.heating`
ist `undefined`, die Hinweise fehlen; im Test zu Weg b fehlt `heating`, bis `mergeHeatingPart` es
übernimmt. Der Typfehler in `calc-heizanlage.test.ts` zeigt sich erst mit
`npm run typecheck` nach Step 3.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

Den Typimport um `Co2Statement` und `HeatingPeriodData` ergänzen. `SnapshotHeatingPlant` ersetzen:

```ts
// Die Heizanlagen des Objekts (Heizung PR 4), eingedampft auf das, was die Berechnung liest. Seit
// Heizung PR 5 dazu Name, eigene Heizperiode und die Spannen nach Weg d; fehlen sie (ein von Hand
// gebauter Schnappschuss), folgt die Anlage dem Objekt und rechnet nichts getrennt ab. Seit PR 6 der
// Energieträger, Pflicht: Von ihm hängt ab, ob CO₂-Kosten aufzuteilen sind.
export type SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'energy' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
  & Partial<Pick<HeatingPlant, 'name' | 'periodStartMonth' | 'periodChanges' | 'separateSpans' | 'separateSettlement'>>
// Die Angabe zum Warmwasser je Heizperiode (Heizung PR 6, #211).
export type SnapshotHeatingPeriodRow = Pick<HeatingPeriodData, 'plantId' | 'period' | 'dhwMethod' | 'dhwUnmeasurable'>
```

In `Snapshot` hinter `heatingPlants?`:

```ts
  // CO₂-Angaben und Warmwasser je Heizperiode (Heizung PR 6). Fehlt die Angabe, rechnet die
  // Berechnung wie ohne Angaben: Hinweise ja, Buchung nein.
  co2Statements?: Co2Statement[]
  heatingPeriodRows?: SnapshotHeatingPeriodRow[]
```

`snapshotFor`: im Typ des ersten Parameters neben `heatingPlants?` ergänzen

```ts
co2Statements?: Co2Statement[], heatingPeriodRows?: SnapshotHeatingPeriodRow[]
```

und im Rumpf (Fassung von PR 5) hinter `const plants = (source.heatingPlants ?? []).filter(…)`:

```ts
  // CO₂-Angaben und Heizperioden erben das Objekt über die Anlage.
  const plantIds = new Set(plants.map((p) => p.id))
```

sowie im zurückgegebenen Objekt hinter `heatingPlants: plants,`:

```ts
    co2Statements: (source.co2Statements ?? []).filter((c) => plantIds.has(c.plantId)),
    heatingPeriodRows: (source.heatingPeriodRows ?? []).filter((r) => plantIds.has(r.plantId)),
```

`heatingSnapshotFor` (PR 5, Heizkostenabrechnung nach Weg d) im zurückgegebenen Objekt hinter
`heatingPlants: plants,` ebenso, nur für die eine Anlage:

```ts
    co2Statements: (source.co2Statements ?? []).filter((c) => c.plantId === plantId),
    heatingPeriodRows: (source.heatingPeriodRows ?? []).filter((r) => r.plantId === plantId),
```

Die Teilabrechnung nach Weg b (`scope: 'heatingPart'`) baut ihren Schnappschuss mit `...snapshot`
aus dem von P und bekommt beide Felder damit von selbst.

- [ ] **Step 4: Töpfe und Zerlegung (`server/src/co2.ts`)**

Importe ergänzen:

```ts
import { serviceProbe, type ProbeResult } from '../../shared/co2Probe.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, Co2Assessment, Co2TenantLine, HeatingMethod, HeatingSource } from '../../shared/types.ts'
import type { Snapshot, SnapshotCostItem, SnapshotHeatingPeriodRow, SnapshotUnit } from './snapshot.ts'
```

(die Typen aus `shared/types.ts` in den vorhandenen Typimport aufnehmen). Ans Dateiende:

```ts
// ---------- Töpfe (Entwurf 6.1 Nr. 4) ----------

// Ein Topf: die Positionen einer Anlage in einer Heizperiode, mit den Angaben dazu. `serviceItems`
// sind die Messdienstpositionen (Schlüssel `amounts`), über die allein die Probe läuft (W9);
// `foreign` die übrigen. `carrierId` ist die Position, in der L steckt: die gewählte, sonst die
// größte Messdienstposition. Welche es ist, ändert nur, wie sich der Vermieteranteil zerlegt, nicht,
// was die Mieter tragen. `reliefKey` kennzeichnet die Zeilen ohne Position (Abzugszeilen).
export type Co2Pot = {
  plantId: string
  plantName: string
  energy: HeatingEnergy
  method: HeatingMethod
  source: HeatingSource
  period: BillingPeriod
  items: SnapshotCostItem[]
  serviceItems: SnapshotCostItem[]
  foreign: SnapshotCostItem[]
  statement: Co2Statement | null
  hotWater: SnapshotHeatingPeriodRow | null
  probe: ProbeResult | null
  carrierId: string | null
  reliefKey: string
}

// Ein Topf je Anlage im Zeitraum dieser Berechnung (Entwurf 6.1 Nr. 4.1). Seit Heizung PR 5 rechnet
// `computeSettlement` jede Heizperiode einer Anlage mit eigener Heizperiode für sich: nach Weg b als
// Teilabrechnung (`scope: 'heatingPart'`), nach Weg d als Heizkostenabrechnung (`heatingSnapshotFor`);
// der Zeitraum der Berechnung ist dann die Heizperiode, und ihre Positionen stehen in `items`. Ohne
// eigene Heizperiode ist die Heizperiode der Zeitraum des Objekts. In jedem Fall ist der Topf: die
// Positionen der Anlage mit dem Schlüssel des Zeitraums. In P ist der Topf einer Anlage mit eigener
// Heizperiode deshalb leer, denn ihre Positionen stehen in `heatingParts` (snapshot.ts).
export function co2PotsOf(snapshot: Snapshot, items: readonly SnapshotCostItem[]): Co2Pot[] {
  const period = snapshot.period
  return (snapshot.heatingPlants ?? []).map((plant): Co2Pot => {
      const pot = items.filter((c) => c.category === HEATING_CATEGORY && c.heatingPlantId === plant.id && c.period === period.key)
      const serviceItems = pot.filter((c) => c.key === 'amounts')
      const statement = (snapshot.co2Statements ?? []).find((s) => s.plantId === plant.id && s.period === period.key) ?? null
      let probe: ProbeResult | null = null
      if (
        statement && (statement.method === 'serviceDeducted' || statement.method === 'serviceShown') &&
        statement.serviceUsersTotalCents !== null && statement.serviceLandlordCents !== null && statement.serviceUnitsCount !== null
      ) {
        probe = serviceProbe({
          deducted: statement.method === 'serviceDeducted',
          items: serviceItems,
          usersTotalCents: statement.serviceUsersTotalCents,
          landlordCents: statement.serviceLandlordCents,
          unitsCount: statement.serviceUnitsCount,
          approx: statement.serviceUsersTotalApprox,
        })
      }
      const chosen = serviceItems.find((c) => c.id === statement?.serviceCostItemId)
      const largest = serviceItems.reduce<SnapshotCostItem | null>((a, c) => (a === null || c.amountCents > a.amountCents ? c : a), null)
      return {
        plantId: plant.id,
        plantName: plant.name ?? '',
        energy: plant.energy,
        method: plant.method,
        source: plant.source,
        period,
        items: pot,
        serviceItems,
        foreign: pot.filter((c) => c.key !== 'amounts'),
        statement,
        hotWater: (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === plant.id && r.period === period.key) ?? null,
        probe,
        carrierId: (chosen ?? largest)?.id ?? null,
        reliefKey: `co2:${plant.id}:${period.key}`,
      }
  })
}

// ---------- Vorwegabzug (Entwurf 7.4) ----------

export type Co2Deduction = { landlordCents: number; selfRaw: number; selfApproximated: boolean }

// Beim Vorwegabzug mit bestandener Probe, oder mit geschätztem S, die Zerlegung des Vermieterrests
// in der Position, in der L steckt: L_self (laut Messdienst, sonst L · Eigenbeträge / S) und den
// abziehbaren Rest. Die Eigenbeträge sind die der selbstgenutzten Wohnungen in den
// Messdienstpositionen des Topfs. `applicable` fragt das Register (`co2.applicable-from`), und nur
// für Töpfe mit einem solchen Datensatz.
export function co2DeductionsOf(pots: readonly Co2Pot[], units: readonly SnapshotUnit[], applicable: (period: BillingPeriod) => boolean): Map<string, Co2Deduction> {
  const selfUsed = new Set(units.filter((u) => u.selfUsed && !u.participates).map((u) => u.id))
  const out = new Map<string, Co2Deduction>()
  for (const pot of pots) {
    const st = pot.statement
    if (!st || st.method !== 'serviceDeducted' || !pot.probe || pot.carrierId === null) continue
    if (!pot.probe.ok && !st.serviceUsersTotalApprox) continue
    if (!applicable(pot.period)) continue
    const L = st.serviceLandlordCents ?? 0
    const S = st.serviceUsersTotalCents ?? 0
    const selfNet = pot.serviceItems.reduce(
      (a, c) => a + Object.entries(c.selfAmounts ?? {}).filter(([id]) => selfUsed.has(id)).reduce((b, [, x]) => b + Math.max(0, x), 0),
      0,
    )
    const self = selfLandlordRaw(L, S, selfNet, st.serviceSelfLandlordCents)
    out.set(pot.carrierId, { landlordCents: L, selfRaw: self.raw, selfApproximated: self.approximated })
  }
  return out
}

// ---------- Ausweis (Entwurf 7.4 „Ausweis“, 9.5) ----------

// Die Zeilen je Mieter: „vom Vermieter übernommen“ (beim reinen Ausweis die gebuchte Abzugszeile,
// sonst der Wert laut Messdienst oder L · x / S als Anzeige ohne Buchung) und „in Ihren Heizkosten
// enthalten“ als (C − L) · x / S, ohne C nicht. `shares` sind die Messdienstbeträge des Mieters im
// Topf.
export function tenantLines(st: Co2Statement, shares: readonly ReliefShare[], printed: ReadonlyMap<string, { cents: number; approximated: boolean }>): Co2TenantLine[] {
  const S = st.serviceUsersTotalCents ?? 0
  const L = st.serviceLandlordCents ?? 0
  const given = new Map(st.reliefs.map((r) => [r.tenancyId, r.cents]))
  return shares.map((s) => {
    const booked = printed.get(s.tenancyId)
    const g = given.get(s.tenancyId)
    const landlordCents = booked ? booked.cents : g ?? (S > 0 ? Math.round((L * s.cents) / S) : 0)
    const approximated = booked ? booked.approximated : g === undefined
    const tenantCents = st.serviceTotalCents !== null && S > 0 ? Math.round(((st.serviceTotalCents - L) * s.cents) / S) : null
    return { tenancyId: s.tenancyId, landlordCents, tenantCents, approximated }
  })
}

export function co2Assessment(
  st: Co2Statement,
  re: Restage,
  p: { booked: boolean; ranges: Co2StageRange[]; shortened: boolean; deduction: Co2Deduction | undefined; tenants: Co2TenantLine[] },
): Co2Assessment {
  return {
    method: st.method,
    booked: p.booked,
    deducted: st.method === 'serviceDeducted',
    totalCents: st.serviceTotalCents,
    landlordCents: st.serviceLandlordCents,
    landlordPermille: st.serviceLandlordPermille,
    kgPerM2: re.value,
    emissionsKg: st.serviceEmissionsKg,
    areaM2: st.serviceAreaM2 ?? st.areaM2,
    stage: re.stage,
    table: p.ranges,
    shortened: p.shortened,
    selfLandlordCents: p.deduction ? Math.round(p.deduction.selfRaw) : null,
    selfApproximated: p.deduction?.selfApproximated ?? false,
    tenants: p.tenants,
  }
}
```

Die Einrückung im Rumpf von `co2PotsOf` rückt beim Übernehmen um zwei Stellen nach links; am Inhalt
ändert das nichts.

- [ ] **Step 5: Berechnung (`server/src/calc.ts`)**

Importe ergänzen:

```ts
import { co2ApplicableFrom, co2CutMissing, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { co2Assessment, co2DeductionsOf, co2PotsOf, restage, stageRanges, tableFactor, tenantLines, type Co2Pot, type ReliefShare } from './co2.ts'
```

und `periodLabel` aus `'../../shared/period.ts'` (falls nicht schon da), `HeatingStatement` in den
Typimport aus `'../../shared/types.ts'`.

(a) In `noticeKinds` hinter `'heating.remote-reading-missing'` (PR 4):

```ts
  // Heizung PR 6 (#97, #209): CO₂ beim Messdienst (Entwurf 7.3, 10.1). Die Probe ist ein Fehler,
  // denn dann wird für die Heizperiode nichts gebucht; mit geschätztem S nur ein Hinweis (R6).
  'co2.sum-check': { level: 'error', title: 'CO₂-Angaben passen nicht zu den Positionen', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  'co2.sum-check-approx': { level: 'hint', title: 'CO₂-Angaben mit geschätzter Summe', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
  'co2.pool-foreign-item': { level: 'hint', title: 'Position ohne Einzelbeträge bei der Heizanlage', terms: ['individualAmounts', 'co2Split'] },
```

(b) `landlordRecipients`: im Typ von `p` hinter `selfRaw: number,` ergänzen `co2ShareRaw: number | null,`;
im Rumpf hinter `left -= self * sign`:

```ts
  // Der CO₂-Anteil des Vermieters beim Vorwegabzug (Heizung PR 6, Entwurf 7.4, W10): nach dem
  // exakten Eigenanteil und vor allen übrigen Gründen, durch den Rest begrenzt. Reicht der Rest nicht,
  // kappt `take` ihn; bei bestandener Probe um höchstens NE · 2 ct. Der Eigenanteil (darin L_self)
  // wird nie gekürzt (G-B2, #203).
  const co2 = p.co2ShareRaw === null ? null : take(p.co2ShareRaw)
```

und in der zurückgegebenen Liste hinter der Zeile `{ key: 'selfUse', landlord: true, raw: self },`:

```ts
    ...(co2 === null ? [] : [{ key: 'co2Share', landlord: true, raw: co2 }]),
```

Den Kommentar über `landlordRecipients` um einen Satz ergänzen: „Beim Vorwegabzug des Messdienstes
(Heizung PR 6) steht der CO₂-Anteil des Vermieters als eigener Grund `co2Share` direkt hinter dem
Eigenanteil; er gilt nur für die eine Position, in der L steckt.“

(c) Vor der Schleife über die Positionen, direkt hinter `const landlordRows: SettlementRow[] = []`
(und hinter der Zeile, die `items` anlegt, falls diese weiter unten steht):

```ts
  // CO₂ beim Messdienst (Heizung PR 6): je Anlage und Heizperiode der Topf, und beim Vorwegabzug die
  // Zerlegung des Vermieterrests in der Position, in der L steckt. Vor der Verteilung, denn
  // `landlordRecipients` braucht sie.
  const co2Pots = co2PotsOf(snapshot, items)
  const co2Deductions = co2DeductionsOf(co2Pots, snapshot.units, (p) => law(co2ApplicableFrom, { period: { from: p.from, to: p.to } }, lawLog))
```

(d) In der Schleife über die Positionen hinter `let mainRestRaw = 0`:

```ts
    // Der abziehbare CO₂-Anteil beim Vorwegabzug (Heizung PR 6); `null` bei jeder anderen Position.
    let co2ShareRaw: number | null = null
```

Im Zweig `} else if (item.key === 'amounts') {` direkt hinter `selfRaw = selfSum`:

```ts
        // Vorwegabzug beim Messdienst (Heizung PR 6, #209, Entwurf 7.4): In der Position, in der L
        // steckt, ist L_self exakt Eigenanteil (privat), der Rest von L der abziehbare `co2Share`.
        const co2 = co2Deductions.get(item.id)
        if (co2) {
          selfRaw += co2.selfRaw
          co2ShareRaw = co2.landlordCents - co2.selfRaw
        }
```

Im Aufruf `...landlordRecipients(item, { selfRaw, …` hinter `selfRaw,` ergänzen: `co2ShareRaw,`.

(e) Hinter der Schleife, direkt hinter `notices.splice(tvAt, 0, ...tvNotices())`:

```ts
  // ---------- CO₂ und Warmwasser je Heizanlage (Heizung PR 6, #97, #209, #211) ----------
  // Je Anlage und Heizperiode: die Probe der Angaben, beim reinen Ausweis die Abzugszeilen, die
  // Hinweise mit ihren Kürzungen und die Bewertung für den Druckblock. Die Zerlegung beim
  // Vorwegabzug ist in der Verteilung oben geschehen (`co2Deductions`). Gerechnet wird mit den
  // gedruckten Zeilen, deshalb erst hier und vor der Fernablesbarkeit, deren 3 % ebenfalls auf die
  // Zeilen nach dem Abzug gehen (Entwurf 6.5).
  const heatingStatements: HeatingStatement[] = []
  // Wird überhaupt jemand über die Heizung abgerechnet? Bei Pauschale und Warmmiete gibt es keine
  // Heizkostenabrechnung, die der Mieter kürzen könnte (Entwurf 15.1 Nr. 15).
  const heatingSettled = partTenancies.some((t) => (t.heatingModel ?? 'settlement') === 'settlement' && statements.has(t.id) && !outsideHeating(t.unit))
  // Die Kürzung je Mieter auf seine gedruckten Zeilen eines Topfs, nach der Abzugszeile, kaufmännisch
  // gerundet (Entwurf 6.5). Mietfuchs zieht nichts ab; erklären muss die Kürzung der Mieter.
  const cutsOn = (ids: ReadonlySet<string>, pct: number): string => {
    const list = [...statements.values()].flatMap((st) => {
      const sum = st.rows.filter((r) => ids.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      return sum > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((sum * pct) / 100))}`] : []
    })
    return list.length > 0 ? `, hier: ${andList(list)}` : ''
  }
  // Die Messdienstbeträge je Mieter im Topf, wie sie gedruckt sind (x beim reinen Ausweis, 7.5).
  const sharesOf = (pot: Co2Pot): ReliefShare[] => {
    const service = new Set(pot.serviceItems.map((c) => c.id))
    return [...statements.values()].flatMap((st) => {
      const cents = st.rows.filter((r) => service.has(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
      return cents > 0 ? [{ tenancyId: st.tenancyId, cents }] : []
    })
  }
  for (const pot of co2Pots) {
    if (pot.items.length === 0) continue
    const st = pot.statement
    const hPeriod = { from: pot.period.from, to: pot.period.to }
    const where = `${pot.plantName ? `Heizanlage „${pot.plantName}“` : 'Heizanlage'}, Heizperiode ${periodLabel(pot.period)}`
    const ids = new Set<string>([...pot.items.map((c) => c.id), pot.reliefKey])
    const plantSubject: NoticeSubject = { kind: 'heatingCosts', id: pot.plantId }
    const report: HeatingStatement = { plantId: pot.plantId, plantName: pot.plantName, energy: pot.energy, period: pot.period.key, from: pot.period.from, to: pot.period.to, co2: null }
    heatingStatements.push(report)
    const applicable = (st !== null || heatingSettled) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)
    if (st && applicable) {
      const ranges = stageRanges(law(co2StageTable, { period: hPeriod }, lawLog), tableFactor(pot.period))
      const re = restage(st, ranges, law(co2RoundingDecimals, { period: hPeriod }, lawLog))
      const S = st.serviceUsersTotalCents ?? 0
      const L = st.serviceLandlordCents ?? 0
      let booked = false
      const printed = new Map<string, { cents: number; approximated: boolean }>()
      if (pot.probe) {
        for (const c of pot.foreign) {
          warn('co2.pool-foreign-item',
            `${where}: „${c.description}“ gehört zur Heizanlage, ist aber keine Position mit Einzelbeträgen des Messdienstes. Die Probe der CO₂-Angaben zählt sie nicht mit; verteilt wird sie wie bisher nach ihrem Schlüssel. ` +
              'Eine Gutschrift des Versorgers oder eine Wartung darf so daneben stehen. Gehört sie zu den Kosten, die der Messdienst verteilt hat, übernehmen Sie sie als Einzelbeträge.',
            itemSubject(c))
        }
        if (!pot.probe.ok) {
          const lines = `Ihre Positionen ergeben ${fmtCents(pot.probe.itemsCents)}. Mit Abzugszeile müssten es S + L = ${fmtCents(S + L)} sein, ohne Abzugszeile S = ${fmtCents(S)}.`
          const entered = pot.probe.enteredOk
            ? ''
            : ` Die eingetragenen Einzel- und Eigenbeträge ergeben zusammen ${fmtCents(pot.probe.enteredCents)}, mehr als S und der Rundungsspielraum von ${fmtCents(pot.probe.toleranceCents)}; steht der CO₂-Anteil Ihrer Wohnung schon im Eigenbetrag, tragen Sie dort nur den Betrag der Abrechnung ein.`
          if (st.serviceUsersTotalApprox) {
            warn('co2.sum-check-approx',
              `${where}: S ist geschätzt als Summe der Einzelbeträge aller Nutzeinheiten. ${lines}${entered} Mietfuchs bucht die CO₂-Aufteilung trotzdem; bitte prüfen Sie die Beträge.`,
              plantSubject)
          } else {
            const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
            warn('co2.sum-check',
              `${where}: Die Probe der CO₂-Angaben geht nicht auf. ${lines}${entered} Bis das geklärt ist, bucht Mietfuchs keine CO₂-Aufteilung, und die Mieter tragen ihre Einzelbeträge wie eingetragen. ` +
                `Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
                'Prüfen Sie den Betrag der Position (bezahlt, also vor „Abzüglich CO₂-Kosten Vermieter“) und Ihre Antwort auf die Frage nach der Abzugszeile.',
              plantSubject)
          }
        }
        booked = pot.probe.ok || st.serviceUsersTotalApprox
      }
      const deduction = pot.carrierId === null ? undefined : co2Deductions.get(pot.carrierId)
      const service = st.method === 'serviceDeducted' || st.method === 'serviceShown'
      report.co2 = co2Assessment(st, re, {
        booked,
        ranges,
        shortened: pot.period.short,
        deduction,
        tenants: service ? tenantLines(st, sharesOf(pot), printed) : [],
      })
    }
  }
```

(f) In `mergeHeatingPart` (PR 5) hinter `landlordRows.push(...sub.landlord.rows)`:

```ts
    // Die Bewertung je Anlage aus der Teilabrechnung nach Weg b (Heizung PR 6).
    heatingStatements.push(...(sub.heating ?? []))
```

`heatingStatements` steht im CO₂-Block (e), der vor dem Block „Eigene Heizperiode“ von PR 5 liegt.

(g) Im Ergebnisobjekt `result` hinter `garageLikeUnitIds: …,`:

```ts
    // Je Heizanlage und Heizperiode, was der Druckblock braucht (Heizung PR 6, Entwurf 9.5); ohne
    // Heizanlage fehlt das Feld, und eine Abrechnung ohne Anlage bleibt wortgleich.
    ...(heatingStatements.length > 0 ? { heating: heatingStatements } : {}),
```

`NoticeSubject` und `HeatingStatement` sind Typen aus `'../../shared/types.ts'`; `andList`,
`fmtCents`, `outsideHeating`, `partTenancies` stehen in `computeSettlement` schon bereit. Die
Variable `S` wird in Task 8 auch beim reinen Ausweis gebraucht; bis dahin nutzt sie nur der Text der
Probe.

- [ ] **Step 6: Tests aus PR 4, die „ändert sonst nichts“ über das ganze Ergebnis prüfen**

Eine Heizanlage bringt jetzt das Feld `heating` mit, und ab Task 9 die Hinweise `co2.*` und die
Rechtswerte `co2.*`. Was eine Anlage sonst nicht ändern darf, prüfen zwei Tests aus PR 4 über das
ganze Ergebnis; sie vergleichen künftig ohne diese drei Dinge (Entwurf 12.1: „über das ganze Ergebnis
außer `legalBasis.values` und den neuen CO₂-Hinweisen“).

`server/testing/co2.ts` (neu; Helfer der Tests liegen in `server/testing/`, CLAUDE.md):

```ts
// Eine Abrechnung ohne das, was die CO₂-Aufteilung (Heizung PR 6) hinzufügt: die Hinweise `co2.*`
// samt ihren Texten in `warnings`, die Rechtswerte `co2.*` und die Bewertung je Heizanlage. Für
// Tests, die zeigen, dass eine Heizanlage sonst nichts ändert (Entwurf 11.2, 12.1).
import type { HeatingStatement, LegalBasis, Notice } from '../../shared/types.ts'

type WithCo2 = { notices?: Notice[]; warnings: string[]; legalBasis?: LegalBasis; heating?: HeatingStatement[] }

export function withoutCo2<T extends WithCo2>(s: T): Omit<T, 'heating'> {
  const co2Texts = new Set((s.notices ?? []).filter((n) => n.code.startsWith('co2.')).map((n) => n.text))
  const { heating: _heating, ...rest } = s
  return {
    ...rest,
    ...(s.notices ? { notices: s.notices.filter((n) => !n.code.startsWith('co2.')) } : {}),
    warnings: s.warnings.filter((w) => !co2Texts.has(w)),
    ...(s.legalBasis
      ? { legalBasis: { ...s.legalBasis, ...(s.legalBasis.values ? { values: s.legalBasis.values.filter((v) => !v.id.startsWith('co2.')) } : {}) } }
      : {}),
  }
}
```

`server/test/calc-heizanlage.test.ts`, Test „Anlage mit Vorgaben: jede Abrechnung bleibt gleich,
über das ganze Ergebnis“: `import { withoutCo2 } from '../testing/co2.ts'` ergänzen und die beiden
Zusicherungen ersetzen durch

```ts
    for (const p of anlagen) assert.deepEqual(withoutCo2(settle(s, y, [p])), withoutCo2(ohne), `${y}: ${JSON.stringify(p)}`)
    assert.deepEqual(withoutCo2(settle(s, y, [])), withoutCo2(ohne), `${y}: leere Liste`)
```

`server/test/api.test.ts`, Test „Heizanlage: anlegen samt Zuordnung offener Heizpositionen, und die
Abrechnung bleibt gleich“: `import { withoutCo2 } from '../testing/co2.ts'` ergänzen und
`assert.deepEqual(await s.api<Settlement>('/api/settlement/2025-01'), vorher)` ersetzen durch

```ts
    assert.deepEqual(withoutCo2(await s.api<Settlement>('/api/settlement/2025-01')), withoutCo2(vorher))
```

Weitere Tests, die eine Abrechnung mit und ohne Heizanlage über das ganze Ergebnis vergleichen (aus
PR 5, etwa zum Umschlüsseln), werden genauso umgestellt; der Lauf in Step 7 nennt sie.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-co2.test.ts test/co2.test.ts test/calc.test.ts test/calc-heizanlage.test.ts test/settlement-golden.test.ts test/calc-eigenbetrag.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS (`calc-co2.test.ts`: 12 Tests). Golden unverändert: Ohne Anlage entsteht weder ein
Topf noch das Feld `heating`.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/snapshot.ts server/src/co2.ts server/src/calc.ts server/test/calc-co2.test.ts server/test/calc-heizanlage.test.ts server/testing/co2.ts server/test/api.test.ts
git commit -m "CO₂ beim Messdienst: Probe und Vorwegabzug in der Abrechnung (#209)

Beim Vorwegabzug ist L_self exakt Eigenanteil und der übrige CO₂-Anteil ein eigener Grund
co2Share, durch den Rest begrenzt. Die Probe läuft nur über die Messdienstpositionen; scheitert
sie, wird nichts gebucht und die Kürzung von 3 % je Mieter genannt.

Refs #97, #209"
```

---
### Task 8: Berechnung: nur ausgewiesen, Abzugszeilen je Mieter

Weist der Messdienst die CO₂-Kosten nur aus (`serviceShown`), sind die Beträge der Mieter brutto, und
Mietfuchs zieht jedem seinen Teil von L als eigene Zeile ab (7.5): mit dem Wert laut Messdienst,
sonst nach seinem Anteil an den Messdienstbeträgen (9.4). R = round(Σ r) wird mit `distributeCents`
verteilt, der Vermieter trägt R als `co2Share` in einer Zeile ohne Position. Dazu die Absicherung
der Lücke über G und V (7.4, `co2.probably-deducted`).

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-co2.test.ts`

**Interfaces:**
- Consumes (Task 4, 7): `shownReliefs`, `L_TOLERANCE_CENTS`, `CO2_RELIEF_LABEL`, `distributeCents`; im CO₂-Block von Task 7 `pot`, `st`, `S`, `L`, `booked`, `printed`, `sharesOf`, `where`, `plantSubject`.
- Produces: Zeilen `kind: 'co2Relief'` mit `costItemId = pot.reliefKey`, eine Zeile des Vermieters mit `landlordParts: [{ reason: 'co2Share', … }]` unter derselben Kennung; Codes `co2.reliefs-invalid` (error), `co2.reliefs-missing` (warning), `co2.probably-deducted` (warning).

- [ ] **Step 1: Write the failing tests**

An `server/test/calc-co2.test.ts` anhängen:

```ts
// ---------- Nur ausgewiesen (Entwurf 7.5) ----------

// Dieselbe Abrechnung, die Beträge je Nutzer aber brutto: S = Betrag = 3.933,01 €.
const BRUTTO = { ta: 112837, tb: 98045, tc: 103794, td: 78625 }
const KEY = `co2:hp:${P}`
const reliefRows = (r: ComputedSettlement): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
const shownStatement = (over: Partial<Co2Statement> = {}) => techem({ method: 'serviceShown', serviceUsersTotalCents: 393301, ...over })

test('Nur ausgewiesen: eine Abzugszeile je Mieter nach seinem Anteil, zusammen 87,50 €; der Vermieter trägt sie als co2Share', () => {
  const r = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement()])
  // 87,50 € × Betrag / 3.933,01 €: 25,1035 / 21,8127 / 23,0917 / 17,4922; der Restcent geht an ta.
  assert.deepEqual(reliefRows(r), [['ta', -2511], ['tb', -2181], ['tc', -2309], ['td', -1749]])
  assert.ok(r.statements.every((st) => st.rows.filter((row) => row.kind === 'co2Relief').every((row) => row.costItemId === KEY)))
  assert.deepEqual(partsOf(r, KEY), [{ reason: 'co2Share', cents: 8750 }])
  assert.equal(r.statements.find((st) => st.tenancyId === 'ta')?.totalShareCents, 112837 - 2511)
  // Σ aller Zeilen = Σ der Positionen (Entwurf 12.3 Nr. 1).
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 393301)
  const zeile = r.statements[0]?.rows.find((row) => row.kind === 'co2Relief') ?? assert.fail('keine Abzugszeile')
  assert.deepEqual([zeile.description, zeile.category, zeile.basisText], ['CO₂-Kosten: Anteil des Vermieters', HEATING_CATEGORY, 'nach Ihrem Anteil an den Heizkosten'])
  assert.match(textOf(r, 'co2.reliefs-missing'), /ta \(a\) 25,11 €, tb \(b\) 21,81 €, tc \(c\) 23,09 € und td \(d\) 17,49 €/)
  const ausweis = r.heating?.[0]?.co2?.tenants.find((t) => t.tenancyId === 'ta')
  assert.deepEqual(ausweis, { tenancyId: 'ta', landlordCents: 2511, tenantCents: Math.round(((25000 - 8750) * 112837) / 393301), approximated: true })
})

test('Nur ausgewiesen: die Werte laut Messdienst gelten; zu viel heißt alle nach Anteil (co2.reliefs-invalid)', () => {
  const laut = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({
    reliefs: [{ tenancyId: 'ta', cents: 2500 }, { tenancyId: 'tb', cents: 2200 }, { tenancyId: 'tc', cents: 2300 }, { tenancyId: 'td', cents: 1750 }],
  })])
  assert.deepEqual(reliefRows(laut), [['ta', -2500], ['tb', -2200], ['tc', -2300], ['td', -1750]])
  assert.ok(!codes(laut).includes('co2.reliefs-missing'))
  assert.equal(laut.statements[0]?.rows.find((row) => row.kind === 'co2Relief')?.basisText, 'laut Abrechnung des Messdienstes')
  const zuviel = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({ reliefs: [{ tenancyId: 'ta', cents: 9000 }] })])
  assert.equal(zuviel.notices.find((n) => n.code === 'co2.reliefs-invalid')?.level, 'error')
  assert.deepEqual(reliefRows(zuviel), [['ta', -2511], ['tb', -2181], ['tc', -2309], ['td', -1749]])
})

test('Nur ausgewiesen mit Heizpauschale eines Mieters: nur wer eine Heizzeile hat, bekommt einen Abzug (Review Focus 3)', () => {
  const s = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b', { heatingModel: 'flatRate' })], costItems: [messdienst(300000, { ta: 200000, tb: 100000 })] }
  const r = settle(s, [co2({ method: 'serviceShown', serviceUsersTotalCents: 300000, serviceLandlordCents: 6000, serviceUnitsCount: 2 })])
  assert.deepEqual(reliefRows(r), [['ta', -4000]])
  assert.deepEqual(partsOf(r, KEY), [{ reason: 'co2Share', cents: 4000 }])
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 300000)
})

test('Lücke abgesichert über G und V (Entwurf 7.4): „Nein“, aber G − V = L → co2.probably-deducted', () => {
  const r = settle({ ...vier, costItems: [messdienst(384551, TECHEM)] }, [techem({ method: 'serviceShown', serviceFuelGrossCents: 354000, serviceFuelNetCents: 345250 })])
  const n = r.notices.find((x) => x.code === 'co2.probably-deducted') ?? assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.equal(n.level, 'warning')
  assert.match(n.text, /3\.540,00 €.*87,50 €.*3\.452,50 €/s)
  const ohne = settle({ ...vier, costItems: [messdienst(393301, BRUTTO)] }, [shownStatement({ serviceFuelGrossCents: 354000, serviceFuelNetCents: 354000 })])
  assert.ok(!codes(ohne).includes('co2.probably-deducted'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-co2.test.ts`
Expected: FAIL. `reliefRows(r)` ist `[]`, die Codes `co2.reliefs-*` und `co2.probably-deducted` fehlen.

- [ ] **Step 3: Implement (`server/src/calc.ts`)**

Importe: aus `'./co2.ts'` zusätzlich `L_TOLERANCE_CENTS, shownReliefs`; neu
`import { CO2_RELIEF_LABEL } from '../../shared/co2Probe.ts'`.

In `noticeKinds` hinter `'co2.pool-foreign-item'`:

```ts
  'co2.reliefs-invalid': { level: 'error', title: 'Beträge „vom Vermieter übernommen“ passen nicht', rule: 'co2-split', terms: ['co2Split'] },
  'co2.reliefs-missing': { level: 'warning', title: 'Betrag „vom Vermieter übernommen“ fehlt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.probably-deducted': { level: 'warning', title: 'CO₂-Anteil vermutlich schon abgezogen', rule: 'co2-split', terms: ['co2Deducted', 'co2Split'] },
```

Im CO₂-Block (Task 7) im Zweig `if (pot.probe) { … }` direkt hinter
`booked = pot.probe.ok || st.serviceUsersTotalApprox`:

```ts
        // Nur ausgewiesen (Entwurf 7.5): Abzugszeilen je Mieter, mit den Werten laut Messdienst oder
        // nach dem Anteil an den Messdienstbeträgen (9.4). R = round(Σ r) wird als eine Verteilung
        // gerundet; der Vermieter trägt R als `co2Share`. L − R entfällt auf Eigennutzung, Leerstand,
        // Pauschale und Wohnungen außerhalb, deren Beträge der Vermieter ohnehin trägt.
        if (booked && st.method === 'serviceShown') {
          const shares = sharesOf(pot)
          const reliefs = shownReliefs(L, S, shares, st.reliefs)
          const nameOf = (id: string): string => {
            const x = statements.get(id)
            return x ? `${x.tenantName} (${x.unitName})` : (snapshot.tenancies.find((t) => t.id === id)?.tenantName ?? 'ein Mietverhältnis')
          }
          const total = Math.round(reliefs.raws.reduce((a, x) => a + x.raw, 0))
          const cents = distributeCents(total, reliefs.raws.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw })))
          reliefs.raws.forEach((x, k) => {
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
              basisText: x.approximated ? 'nach Ihrem Anteil an den Heizkosten' : 'laut Abrechnung des Messdienstes',
              shareCents: -c,
              labor35aCents: 0,
              steps: [
                { label: 'CO₂-Anteil des Vermieters laut Abrechnung', value: fmtCents(L), term: 'co2Split' },
                x.approximated
                  ? { label: 'Ihr Teil davon', value: `${fmtCents(L)} × ${fmtCents(share)} ÷ ${fmtCents(S)} = ${fmtExactEuro(x.raw)}` }
                  : { label: 'Ihr Teil davon', value: `${fmtCents(c)} laut Abrechnung des Messdienstes` },
                { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(-c) },
              ],
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
          if (reliefs.problem) {
            const p = reliefs.problem
            const why = p.kind === 'sum'
              ? `Die eingetragenen Beträge „vom Vermieter übernommen“ ergeben zusammen ${fmtCents(p.givenCents)} und damit mehr als den CO₂-Anteil des Vermieters von ${fmtCents(L)}.`
              : `Für ${nameOf(p.tenancyId)} ist „vom Vermieter übernommen“ ${fmtCents(p.givenCents)} eingetragen, ${p.shareCents > 0 ? `mehr als die Heizkosten von ${fmtCents(p.shareCents)}` : 'aber in dieser Heizperiode kein Einzelbetrag'}.`
            warn('co2.reliefs-invalid',
              `${where}: ${why} Mietfuchs rechnet deshalb für alle Mieter nach ihrem Anteil an den Heizkosten (${fmtCents(L)} × Betrag des Mieters ÷ ${fmtCents(S)}). Bitte prüfen Sie die Beträge auf der Seite Heizkosten.`,
              plantSubject)
          }
          if (reliefs.missing.length > 0) {
            const list = reliefs.missing.map((id) => `${nameOf(id)} ${fmtCents(printed.get(id)?.cents ?? 0)}`)
            warn('co2.reliefs-missing',
              `${where}: Für ${andList(reliefs.missing.map(nameOf))} fehlt der Betrag „vom Vermieter übernommen“. Mietfuchs ergänzt ihn nach dem Anteil an den Heizkosten (${andList(list)}); ` +
                'steht er in der Abrechnung, tragen Sie ihn auf der Seite Heizkosten ein.',
              plantSubject)
          }
        }
        // Die Lücke „Nein, obwohl abgezogen, und Betrag = S“ sieht die Probe nicht (7.4). Liegen die
        // Brennstoffkosten der Abrechnung (G) genau um L über den verteilten (V), spricht das für
        // einen Vorwegabzug; dann würden die Mieter doppelt entlastet.
        const G = st.serviceFuelGrossCents
        const V = st.serviceFuelNetCents
        if (st.method === 'serviceShown' && L > 0 && G !== null && V !== null && Math.abs(G - V - L) <= L_TOLERANCE_CENTS) {
          warn('co2.probably-deducted',
            `${where}: Sie haben angegeben, dass die Abrechnung die CO₂-Kosten nur ausweist. Die Brennstoffkosten der Abrechnung (${fmtCents(G)}) liegen aber genau um den CO₂-Anteil des Vermieters (${fmtCents(L)}) über den verteilten Brennstoffkosten (${fmtCents(V)}); ` +
              'das spricht für einen Vorwegabzug. Dann würden die Mieter doppelt entlastet: einmal in der Kostenaufstellung und einmal mit der eigenen Zeile. ' +
              'Prüfen Sie, ob die Kostenaufstellung eine Zeile „Abzüglich CO₂-Kosten Vermieter“ enthält.',
            plantSubject)
        }
```

`HEATING_CATEGORY`, `fmtExactEuro`, `distributeCents`, `andList` und `snapshot` sind in
`computeSettlement` vorhanden.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-co2.test.ts test/calc.test.ts test/settlement-golden.test.ts && npm run typecheck`
Expected: PASS (`calc-co2.test.ts`: 16 Tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/calc.ts server/test/calc-co2.test.ts
git commit -m "CO₂ beim Messdienst: nur ausgewiesen, Abzugszeile je Mieter

Werte laut Messdienst geprüft, sonst nach dem Anteil an den Messdienstbeträgen; der Vermieter
trägt die Summe als co2Share. Liegen G und V um L auseinander, ein Hinweis auf einen
vermuteten Vorwegabzug.

Refs #97"
```

---

### Task 9: Hinweise ohne, mit unvollständigen oder abweichenden Angaben; Warmwasser (#211)

Was fehlt oder nicht passt, bekommt seinen Hinweis mit beziffertem Kürzungsbetrag (10.1): ohne
Angaben `co2.missing` (mit Anlage) bzw. `co2.fuel-unknown` und `co2.missing-first-year` (ohne Anlage),
`co2.service-unsplit`, `co2.incomplete`, `co2.stage-mismatch` und `heating.dhw-not-metered`. Dazu die
Invarianten über Zufallsbestände (12.3 Nr. 1, 8, 9, 14) und die Erwartungen bestehender Tests, die
die angekündigten Hinweise jetzt sehen.

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-co2.test.ts`, `server/test/api.test.ts`, bestehende Tests nach Step 7

**Interfaces:**
- Consumes (Task 1, 4, 7): `co2CutMissing`, `co2FirstPeriodStart`, `hkvCutNotByConsumption`, `CO2_FUELS`, `FORMULA_METHODS`, `ausweisGaps`; im CO₂-Block `pot`, `st`, `applicable`, `heatingSettled`, `service`, `booked`, `re`, `ids`, `where`, `plantSubject`, `cutsOn`, `hPeriod`.
- Produces: Codes `co2.missing` (warning), `co2.missing-first-year` (hint), `co2.fuel-unknown` (hint), `co2.service-unsplit` (warning), `co2.incomplete` (warning), `co2.stage-mismatch` (hint), `heating.dhw-not-metered` (warning, Regel `heating-dhw-split`).

- [ ] **Step 1: Write the failing tests**

An `server/test/calc-co2.test.ts` anhängen (Typimport aus `'../src/snapshot.ts'` um
`SnapshotHeatingPeriodRow` ergänzen):

```ts
// ---------- Hinweise (Entwurf 9.1, 10.1) ----------

const zwei = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')] }
const gas = (amountCents = 100000) => messdienst(amountCents, { ta: 60000, tb: 40000 })
const vollstaendig = co2({ serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2, serviceKgPerM2: 30, serviceLandlordPermille: 400, serviceTotalCents: 1250 })

test('co2.missing: Gasheizung ohne CO₂-Angaben, 3 % je Mieter auf seine Heizzeilen, Knopf zur Heizanlage', () => {
  const r = settle({ ...zwei, costItems: [gas()] }, [])
  const n = r.notices.find((x) => x.code === 'co2.missing') ?? assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.deepEqual([n.level, n.subject, n.rule], ['warning', { kind: 'heatingCosts', id: 'hp' }, 'co2-split'])
  assert.match(n.text, /^Heizanlage „Gas“, Heizperiode 2025: Bei Gas, Heizöl, Flüssiggas und Kohle sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen/)
  assert.match(n.text, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €\./)
  assert.match(n.text, /Tragen Sie auf der Seite Heizkosten die CO₂-Angaben aus der Abrechnung des Messdienstes ein\./)
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.cut.missing'))
  // Fernwärme nur, falls der Lieferant CO₂ ausweist (R-A28); Wärmepumpe: nichts aufzuteilen.
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'districtHeating' })]), 'co2.missing'), /Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie/)
  assert.ok(!codes(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'heatPump' })])).some((c) => c.startsWith('co2.')))
  assert.equal(settle({ ...zwei, costItems: [gas()] }, [], [plant({ energy: 'other' })]).notices.find((x) => x.code === 'co2.fuel-unknown')?.subject?.id, 'hp')
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ source: 'homeowners' })]), 'co2.missing'), /aus der Abrechnung der Gemeinschaft ein\./)
  assert.match(textOf(settle({ ...zwei, costItems: [gas()] }, [], [plant({ method: 'manual' })]), 'co2.missing'), /mit einer späteren Version/)
})

test('Ohne Heizanlage: co2.fuel-unknown, im ersten Jahr co2.missing-first-year, nichts vor 2023 und nichts bei Warmmiete', () => {
  const ohne = (year: number, over: Partial<SnapshotTenancy> = {}) => computeSettlement(snapshotOf(source({
    units: [unit('a')],
    tenancies: [tenancy('ta', 'a', over)],
    costItems: [{ id: 'hz', period: calendarPeriod(year), category: HEATING_CATEGORY, description: 'Heizung', amountCents: 100000, key: 'area' }],
  }), year))
  const n = ohne(2025).notices.find((x) => x.code === 'co2.fuel-unknown') ?? assert.fail('kein Hinweis')
  assert.deepEqual([n.level, n.subject], ['hint', { kind: 'heatingPlant', id: '' }])
  assert.equal(n.text,
    'Mietfuchs weiß nicht, womit das Haus geheizt wird. Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, ' +
    'sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen (§ 5 CO2KostAufG), und die Heizkostenabrechnung muss den Anteil der Mieter, ' +
    'die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG). Fehlt das, darf jeder Mieter seinen Anteil ' +
    'an den Heizkosten um 3 % kürzen (§ 7 Abs. 4 CO2KostAufG), hier: ta (a) 30,00 €. Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist.')
  assert.match(textOf(ohne(2023), 'co2.missing-first-year'), /^Für Abrechnungszeiträume, die am oder nach dem 01\.01\.2023 beginnen, sind die CO₂-Kosten der Heizung aufzuteilen \(§ 11 Abs\. 2 Satz 1 CO2KostAufG\); dieser Zeitraum ist der erste\. Mietfuchs weiß nicht/)
  assert.ok(!codes(ohne(2022)).some((c) => c.startsWith('co2.')))
  assert.ok(!codes(ohne(2025, { costModel: 'inclusive', heatingModel: 'inclusive' })).some((c) => c.startsWith('co2.')))
})

test('Der Messdienst hat nicht aufgeteilt (Entwurf 7.6, ohne Lieferung): co2.service-unsplit mit 3 % je Mieter', () => {
  const r = settle({ ...zwei, costItems: [gas()] }, [co2({ method: 'selfAfterService' })])
  const n = r.notices.find((x) => x.code === 'co2.service-unsplit') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €/)
  assert.ok(!codes(r).includes('co2.missing'))
  assert.deepEqual(partsOf(r), [])
})

test('Ausweis unvollständig (§ 7 Abs. 3): co2.incomplete nennt, was fehlt; nach gescheiterter Probe nicht ein zweites Mal', () => {
  const ohneAusweis = co2({ serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2 })
  const t = textOf(settle({ ...zwei, costItems: [gas(100500)] }, [ohneAusweis]), 'co2.incomplete')
  assert.match(t, /fehlen der CO₂-Ausstoß je Quadratmeter \(oder Ausstoß und Fläche\), der Anteil des Vermieters in Prozent und die CO₂-Kosten insgesamt/)
  assert.match(t, /hier: ta \(a\) 18,00 € und tb \(b\) 12,00 €/)
  assert.ok(!codes(settle({ ...zwei, costItems: [gas(100000)] }, [ohneAusweis])).includes('co2.incomplete'))
  const voll = settle({ ...zwei, costItems: [gas(100500)] }, [vollstaendig])
  assert.ok(!codes(voll).includes('co2.incomplete'))
  assert.ok(!codes(voll).includes('co2.stage-mismatch'))
})

test('Nachstufung (Entwurf 9.2): Techem 46,4 kg mit 35 % ergibt einen Hinweis, der § 8 und § 9 nennt', () => {
  const n = settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem()]).notices.find((x) => x.code === 'co2.stage-mismatch') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /bei 46,4 kg CO₂ je m² und der Anteil des Vermieters bei 35 %\. Nach der Stufentabelle des CO2KostAufG gehört dieser Wert zu 70 %\./)
  assert.match(n.text, /§ 8 CO2KostAufG.*§ 9 CO2KostAufG/s)
  const passend = settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ serviceLandlordPermille: 700, serviceTotalCents: 12500 })])
  assert.ok(!codes(passend).includes('co2.stage-mismatch'))
  // L passt nicht zu C · ‰.
  assert.match(textOf(settle({ ...vier, costItems: [messdienst(393301, TECHEM)] }, [techem({ serviceLandlordPermille: 700, serviceTotalCents: 20000 })]), 'co2.stage-mismatch'), /87,50 € sind nicht 70 % von 200,00 €/)
})

test('Warmwasser beim Messdienst (#211, Entwurf 7.7): Formel ohne bestätigten Aufwand → 15 % auf die Heizkosten im Topf', () => {
  const mit = (row: Partial<SnapshotHeatingPeriodRow>) => computeSettlement({
    ...snap({ ...zwei, costItems: [gas(100500)] }, [vollstaendig]),
    heatingPeriodRows: [{ plantId: 'hp', period: P, dhwMethod: null, dhwUnmeasurable: null, ...row }],
  })
  const r = mit({ dhwMethod: 'volumeFormula' })
  const n = r.notices.find((x) => x.code === 'heating.dhw-not-metered') ?? assert.fail('kein Hinweis')
  assert.deepEqual([n.level, n.rule, n.subject], ['warning', 'heating-dhw-split', { kind: 'heatingCosts', id: 'hp' }])
  assert.match(n.text, /um 15 % kürzen \(BGH VIII ZR 151\/20\), hier: ta \(a\) 90,00 € und tb \(b\) 60,00 €/)
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'hkv.cut.not-by-consumption'))
  const keine: Partial<SnapshotHeatingPeriodRow>[] = [{ dhwMethod: 'volumeFormula', dhwUnmeasurable: true }, { dhwMethod: 'heatMeter' }, { dhwMethod: null }]
  for (const row of keine) assert.ok(!codes(mit(row)).includes('heating.dhw-not-metered'), JSON.stringify(row))
})

// ---------- Invarianten über Zufallsbestände (Entwurf 12.3 Nr. 1, 8, 9, 14) ----------

// Fester Startwert: jeder Lauf prüft dieselben Bestände.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const euro = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

test('Invarianten: Summe, Vorwegabzug, Abzugszeilen und Kürzungen auf die gedruckten Zeilen', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 300; lauf++) {
    const n = int(1, 4)
    const mitEigen = rnd() < 0.4
    const mitLeer = rnd() < 0.4
    const units = Array.from({ length: n }, (_, i) => unit(`u${i}`))
    const tenancies = units.map((u, i) => tenancy(`t${i}`, u.id))
    const amounts: Record<string, number> = Object.fromEntries(tenancies.map((t) => [t.id, int(10000, 200000)]))
    const eigen = mitEigen ? int(10000, 200000) : 0
    const leer = mitLeer ? int(10000, 200000) : 0
    if (mitEigen) units.push(own('eigen'))
    if (mitLeer) units.push(unit('leer'))
    const S = Object.values(amounts).reduce((a, c) => a + c, 0) + eigen + leer
    const L = int(0, Math.floor(S / 10))
    const abzug = rnd() < 0.5
    const item = messdienst(abzug ? S + L : S, amounts, mitEigen ? { selfAmounts: { eigen } } : {})
    const st = co2({ method: abzug ? 'serviceDeducted' : 'serviceShown', serviceUsersTotalCents: S, serviceLandlordCents: L, serviceUnitsCount: units.length })
    const r = settle({ units, tenancies, costItems: [item] }, [st])
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, mitEigen, mitLeer, S, L, abzug })}`
    // Nr. 1: Σ aller Zeilen = Σ der Positionen.
    assert.equal(r.statements.reduce((a, s2) => a + s2.totalShareCents, 0) + r.landlord.totalCents, item.amountCents, fall)
    assert.ok(!codes(r).includes('co2.sum-check'), `${fall}: Probe`)
    const relief = new Map(r.statements.flatMap((s2) => s2.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [s2.tenancyId, -row.shareCents])))
    if (abzug) {
      // Nr. 8: kein Mieter zahlt anders als sein Einzelbetrag, nie eine Abzugszeile; L_self exakt;
      // kein negativer Rest bei bestandener Probe.
      for (const t of tenancies) assert.equal(shareOf(r, t.id, 'hz'), amounts[t.id], fall)
      assert.equal(relief.size, 0, fall)
      const parts = partsOf(r)
      const eigenExakt = eigen + (mitEigen ? (L * eigen) / S : 0)
      assert.ok(Math.abs((parts.find((p) => p.reason === 'selfUse')?.cents ?? 0) - eigenExakt) <= 1, `${fall}: L_self`)
      assert.ok((parts.find((p) => p.reason === 'amountsRest')?.cents ?? 0) >= 0, `${fall}: Rest`)
    } else {
      // Nr. 9: 0 ≤ r ≤ x; |R − L_vermietet| ≤ 0,5 ct (widerspruchsfreie Daten).
      for (const [t, c] of relief) assert.ok(c >= 0 && c <= (amounts[t] ?? 0), fall)
      const R = [...relief.values()].reduce((a, c) => a + c, 0)
      const exakt = Object.values(amounts).reduce((a, c) => a + (L * c) / S, 0)
      assert.ok(Math.abs(R - exakt) <= 0.5, `${fall}: R`)
    }
    // Nr. 14: die Kürzung je Mieter auf seine gedruckten Zeilen nach dem Abzug (co2.incomplete, denn
    // die Angaben für den Ausweis fehlen hier).
    const text = textOf(r, 'co2.incomplete')
    for (const t of tenancies) {
      const gedruckt = (amounts[t.id] ?? 0) - (relief.get(t.id) ?? 0)
      assert.ok(text.includes(`${t.id} (${t.unitId}) ${euro(Math.round((gedruckt * 3) / 100))}`), `${fall}: Kürzung ${t.id}`)
    }
  }
})
```

In `server/test/api.test.ts` anhängen:

```ts
test('Abrechnung mit CO₂ über die Routen: ohne Angaben co2.missing, mit Vorwegabzug co2Share (Heizung PR 6)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    const mieter = await s.api<Tenancy>('/api/tenancies', postJson({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'service' })))
    const pos = await s.api<CostItem>('/api/costItems', postJson({
      period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
    }))
    const ohne = await s.api<Settlement>('/api/settlement/2025-01')
    assert.equal(ohne.notices?.find((n) => n.code === 'co2.missing')?.subject?.id, plant.id)
    await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1 }) })
    const mit = await s.api<Settlement>('/api/settlement/2025-01')
    assert.ok(!mit.notices?.some((n) => n.code === 'co2.missing'))
    assert.deepEqual(mit.landlord.rows.find((r) => r.costItemId === pos.id)?.landlordParts, [{ reason: 'co2Share', cents: 500 }])
    assert.equal(mit.heating?.[0]?.co2?.booked, true)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-co2.test.ts`
Expected: FAIL. Die Codes `co2.missing`, `co2.fuel-unknown`, `co2.missing-first-year`,
`co2.service-unsplit`, `co2.incomplete`, `co2.stage-mismatch` und `heating.dhw-not-metered` fehlen; im
Invariantentest scheitert `textOf(r, 'co2.incomplete')`.

- [ ] **Step 3: Codes (`server/src/calc.ts`)**

Importe: aus `'./co2.ts'` zusätzlich `ausweisGaps, CO2_FUELS, FORMULA_METHODS`; aus
`'../../shared/law/co2kostaufg.ts'` zusätzlich `co2FirstPeriodStart`; `hkvCutNotByConsumption` ist
seit PR 1 importiert. In `noticeKinds` hinter `'co2.probably-deducted'`:

```ts
  // Ohne Angaben oder ohne Aufteilung (Entwurf 9.1, 10.1). `co2.missing` und `co2.fuel-unknown`
  // färben die Ampel; angekündigt im CHANGELOG.
  'co2.missing': { level: 'warning', title: 'CO₂-Kosten nicht aufgeteilt', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.missing-first-year': { level: 'hint', title: 'CO₂-Kosten im ersten Zeitraum der Aufteilung', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.fuel-unknown': { level: 'hint', title: 'Energieträger der Heizung unbekannt', rule: 'co2-split', terms: ['co2Split', 'heatingSystem'] },
  'co2.service-unsplit': { level: 'warning', title: 'Messdienst hat die CO₂-Kosten nicht aufgeteilt', rule: 'co2-split', terms: ['co2Split'] },
  'co2.incomplete': { level: 'warning', title: 'Angaben für den CO₂-Ausweis fehlen', rule: 'co2-split', terms: ['co2Split', 'co2Stage'] },
  'co2.stage-mismatch': { level: 'hint', title: 'Einstufung laut Abrechnung weicht ab', rule: 'co2-split', terms: ['co2Stage', 'co2Area'] },
  // #211, Entwurf 7.7: Warmwasser nach einer Formel ohne bestätigten unzumutbaren Aufwand.
  'heating.dhw-not-metered': { level: 'warning', title: 'Warmwasser ohne Wärmezähler abgerechnet', rule: 'heating-dhw-split', terms: ['hotWaterShare', 'heatingCostOrdinance'] },
```

- [ ] **Step 4: Hinweise im CO₂-Block (`server/src/calc.ts`)**

Über der Schleife `for (const pot of co2Pots)` (hinter `sharesOf`) einfügen:

```ts
  // Was das Gesetz verlangt, in einem Satz für alle Hinweise ohne Angaben.
  const co2Duty = (lead: string) =>
    `${lead} zwischen Ihnen und den Mietern aufzuteilen (§ 5 CO2KostAufG), und die Heizkostenabrechnung muss den Anteil der Mieter, ` +
    'die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG).'
  // Was der Vermieter tun kann, je nach Abrechnungsweg der Anlage.
  const nextStep = (pot: Co2Pot): string =>
    pot.method !== 'service'
      ? 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf.'
      : `Tragen Sie auf der Seite Heizkosten die CO₂-Angaben aus der Abrechnung ${pot.source === 'homeowners' ? 'der Gemeinschaft' : 'des Messdienstes'} ein.`
```

Im Zweig `if (st && applicable) { … }` hinter der Zuweisung `report.co2 = co2Assessment(…)`:

```ts
      if (heatingSettled && !service) {
        // Der Messdienst hat nicht aufgeteilt (Entwurf 7.6). Ohne die Brennstoffrechnung als
        // Lieferung (PR 7) ist die Kürzung sicher.
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.service-unsplit',
          `${where}: Der Messdienst hat die CO₂-Kosten nicht zwischen Ihnen und den Mietern aufgeteilt. Das Gesetz verlangt die Aufteilung und ihren Ausweis in der Heizkostenabrechnung (§§ 5, 7 Abs. 3 CO2KostAufG); ` +
            `ohne sie darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ` +
            'Bitten Sie den Messdienst um eine Abrechnung mit CO₂-Aufteilung; dafür braucht er die CO₂-Angaben Ihrer Brennstoffrechnung. Selbst aufteilen kann Mietfuchs mit einer späteren Version.',
          plantSubject)
      }
      if (heatingSettled && service && booked) {
        const gaps = ausweisGaps(st)
        if (gaps.length > 0) {
          const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
          warn('co2.incomplete',
            `${where}: Für den Ausweis der CO₂-Aufteilung fehlen ${andList(gaps)}. Die Heizkostenabrechnung muss den Anteil der Mieter, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG); ` +
              `fehlen sie auch in der Abrechnung des Messdienstes, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Tragen Sie die Angaben auf der Seite Heizkosten nach.`,
            plantSubject)
        }
      }
      // Nachstufung (Entwurf 9.2): Passt der Anteil laut Messdienst nicht zur Stufe des Werts, oder L
      // nicht zu C · ‰, ein Hinweis ohne Rechtsfolge.
      if (service && re.value !== null && re.stage !== null && st.serviceLandlordPermille !== null && (re.percentOk === false || re.sumOk === false)) {
        const laut = fmtNum(st.serviceLandlordPermille / 10)
        const stufe = re.percentOk === false ? ` Nach der Stufentabelle des CO2KostAufG gehört dieser Wert zu ${fmtNum(re.stage.landlordPercent)} %.` : ''
        const summe = re.sumOk === false && st.serviceTotalCents !== null ? ` ${fmtCents(L)} sind nicht ${laut} % von ${fmtCents(st.serviceTotalCents)}.` : ''
        warn('co2.stage-mismatch',
          `${where}: Laut Abrechnung liegt der Ausstoß bei ${fmtNum(re.value)} kg CO₂ je m² und der Anteil des Vermieters bei ${laut} %.${stufe}${summe} ` +
            'Eine Abweichung kann berechtigt sein, etwa bei einem Gebäude, das überwiegend nicht zum Wohnen dient (§ 8 CO2KostAufG), oder bei Einschränkungen nach § 9 CO2KostAufG; bitte prüfen Sie die Angaben.',
          plantSubject)
      }
```

Hinter dem Zweig `if (st && applicable) { … }`, noch in der Schleife:

```ts
    // Ohne Angaben (Entwurf 9.1): Gas, Öl, Flüssiggas und Kohle sind erfasst, Fernwärme nur, wenn der
    // Lieferant CO₂ ausweist (R-A28), Wärmepumpe, Strom, Holz und Pellets nicht (W8); unbekannt ist
    // „Sonstiges“.
    if (!st && applicable) {
      if (CO2_FUELS.includes(pot.energy) || pot.energy === 'districtHeating') {
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.missing',
          `${where}: ${co2Duty(pot.energy === 'districtHeating' ? 'Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie' : 'Bei Gas, Heizöl, Flüssiggas und Kohle sind die CO₂-Kosten')} ` +
            `Für diese Heizperiode kennt Mietfuchs keine CO₂-Angaben. Fehlen sie auch in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. ${nextStep(pot)}`,
          plantSubject)
      } else if (pot.energy === 'other') {
        const cut = law(co2CutMissing, { period: hPeriod }, lawLog)
        warn('co2.fuel-unknown',
          `${where}: Mietfuchs weiß nicht, womit diese Anlage heizt. ${co2Duty('Heizt sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
            `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(ids, cut)}. Tragen Sie unter Stammdaten bei der Heizung den Energieträger ein.`,
          plantSubject)
      }
    }
    // Warmwasser beim Messdienst (#211, Entwurf 7.7): Laut Abrechnung nach einer Formel bestimmt, ohne
    // bestätigten unzumutbaren Aufwand. 15 % auf den ganzen Anteil an Heiz- und Warmwasserkosten im
    // Topf (BGH VIII ZR 151/20, R-A6, G-B9). Ohne Angabe kein Hinweis.
    const hw = pot.hotWater
    if (pot.method === 'service' && hw && hw.dhwMethod !== null && FORMULA_METHODS.includes(hw.dhwMethod) && hw.dhwUnmeasurable !== true) {
      const cut = law(hkvCutNotByConsumption, { period: hPeriod }, lawLog)
      warn('heating.dhw-not-metered',
        `${where}: Laut Abrechnung wurde die Wärme für das Warmwasser mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen. ` +
          'Die Heizkostenverordnung verlangt den Wärmezähler; die Formel ist nur erlaubt, wenn das Messen nur mit unzumutbar hohem Aufwand möglich wäre (§ 9 Abs. 2 HeizkostenV). ' +
          `Sonst darf jeder Mieter seinen gesamten Anteil an den Heiz- und Warmwasserkosten um ${cut} % kürzen (BGH VIII ZR 151/20)${cutsOn(ids, cut)}. ` +
          'Ist das Messen bei Ihnen unzumutbar aufwendig, bestätigen Sie das auf der Seite Heizkosten und bewahren einen Nachweis auf.',
        plantSubject)
    }
```

Hinter der Schleife über `co2Pots`:

```ts
  // Heizpositionen ohne Heizanlage (Entwurf 9.1, 11.1): Mietfuchs kennt den Energieträger nicht und
  // sagt, was gälte. Im ersten Zeitraum der Aufteilung ein eigener Hinweis. Knopf: „Heizung
  // einrichten →“.
  const inPots = new Set(co2Pots.flatMap((p) => p.items.map((c) => c.id)))
  const loose = items.filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && !inPots.has(c.id))
  if (loose.length > 0 && heatingSettled && law(co2ApplicableFrom, { period: lawPeriod }, lawLog)) {
    const cut = law(co2CutMissing, { period: lawPeriod }, lawLog)
    const first = co2FirstPeriodStart()
    const what =
      `Mietfuchs weiß nicht, womit das Haus geheizt wird. ${co2Duty('Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten')} ` +
      `Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 7 Abs. 4 CO2KostAufG)${cutsOn(new Set(loose.map((c) => c.id)), cut)}. ` +
      'Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist.'
    const setUp: NoticeSubject = { kind: 'heatingPlant', id: '' }
    if (lawPeriod.from.slice(0, 4) === first.slice(0, 4)) {
      warn('co2.missing-first-year',
        `Für Abrechnungszeiträume, die am oder nach dem ${fmtDay(first)} beginnen, sind die CO₂-Kosten der Heizung aufzuteilen (§ 11 Abs. 2 Satz 1 CO2KostAufG); dieser Zeitraum ist der erste. ${what}`,
        setUp)
    } else {
      warn('co2.fuel-unknown', what, setUp)
    }
  }
```

Hinweis zu `lawPeriod`: Es ist der Zeitraum P der Abrechnung (PR 1, PR 2) mit `from` und `to`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-co2.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS (`calc-co2.test.ts`: 23 Tests).

- [ ] **Step 6: Golden bleibt wortgleich, auch F06**

Run: `npm --prefix server test -- test/settlement-golden.test.ts test/db-golden.test.ts`
Expected: PASS ohne Änderung an `server/test/fixtures/settlement/`. **F06 bekommt keinen Hinweis**,
anders als der Entwurf (1.2 Nr. 1, 12.1, G-A5) annimmt: Seine Position trägt die Kostenart „Heizung“,
nicht „Heizung und Warmwasser“ (`HEATING_CATEGORY`), und ist für die Berechnung deshalb keine
Heizposition, weder für die Regeln aus #140 noch für die CO₂-Hinweise. Eine Heizposition anders zu
erkennen als überall sonst in calc.ts, hieße eine zweite Wahrheit; die Fixture-Datei zu ändern hieße
eine Eingabe des Prüfkatalogs zu verbiegen. Den angekündigten Hinweis halten statt F06 die Tests
„Ohne Heizanlage …“ (calc-co2.test.ts) wörtlich fest. Die Abweichung steht in der PR-Beschreibung,
damit sie bei der Durchsicht entschieden wird.

- [ ] **Step 7: Bestehende Tests, die die angekündigten Hinweise jetzt sehen**

Run: `npm test`

Expected: Scheitern können nur Tests, die eine Abrechnung **mit einer Position der Kostenart „Heizung
und Warmwasser“ in einem Zeitraum ab 2023, ohne Heizanlage und mit einem über die Heizung
abgerechneten Mieter** vollständig vergleichen (Codes, `warnings` oder `legalBasis.values` wörtlich).
Für jeden solchen Test gilt dieselbe Regel, und keine andere Änderung ist erlaubt:

- vergleicht er die Liste der Codes, wird `'co2.fuel-unknown'` (für einen Zeitraum, der 2023
  beginnt, `'co2.missing-first-year'`) an der Stelle eingefügt, an der er im Ergebnis steht; der
  Fehlerbericht des Tests zeigt sie;
- vergleicht er `warnings` wörtlich, kommt der Text dazu, den der Test „Ohne Heizanlage …“ festhält,
  mit den Kürzungsbeträgen der Mieter dieses Tests;
- vergleicht er `legalBasis.values` wörtlich, kommen `co2.applicable-from` und `co2.cut.missing` dazu.

Ein Test, der aus einem anderen Grund scheitert, ist ein Befund und wird nicht angepasst. Nach der
Anpassung:

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/calc.ts server/test/calc-co2.test.ts server/test/api.test.ts server/test
git commit -m "CO₂: Hinweise ohne, mit unvollständigen oder abweichenden Angaben; Warmwasser ohne Wärmezähler

co2.missing, co2.fuel-unknown, co2.missing-first-year, co2.service-unsplit, co2.incomplete und
heating.dhw-not-metered nennen die Kürzung je Mieter auf seine gedruckten Heizzeilen;
co2.stage-mismatch ordnet die Werte laut Messdienst nach. Invarianten über Zufallsbestände.

Refs #97, #211"
```

---
### Task 10: Golden F15 und F12

Zwei Fixtures mit Herleitung von Hand (Entwurf 12.1), über denselben Weg wie beim Nutzer in einer
Wegwerf-Datenbank aufgebaut (Muster F18 aus PR 3): F15 ist Beispiel A (Techem-Muster mit
Vorwegabzug), F12 die anonymisierte reale Abrechnung Mai–April ohne CO₂-Aufteilung. Die Fixtures
F01–F11 stehen im Format der db.json und kennen keine Heizanlage; sie bleiben, wie sie sind.

**Files:**
- Create: `server/test/fixtures/heating/F15-techem-vorwegabzug/README.md`, `server/test/fixtures/heating/F12-messdienst-mai-april/README.md`, `server/test/fixtures/heating/F12-messdienst-mai-april/betraege.json`, `server/test/heating-golden.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `readStock`, `createEntity`, `createHeatingPlant`, `saveCo2Statement`, `snapshotFor`, `computeSettlement`, `taxReport`, `periodOfKey`, `periodKey`, `properties` (schema).
- Produces: keine neuen Schnittstellen.

- [ ] **Step 1: F15 (Herleitung)**

`server/test/fixtures/heating/F15-techem-vorwegabzug/README.md`:

```markdown
# F15 Techem-Muster mit Vorwegabzug

Beispiel A des Entwurfs (7.4). Ein Haus mit vier Wohnungen à 50 m², je ein Mieter seit 2020, eine
Gasheizung, abgerechnet von einem Messdienst im Kalenderjahr 2025. Die Kostenaufstellung nennt
„Anlieferung Brennstoff 3.540,00 €“, darunter „Abzüglich CO₂-Kosten Vermieter −87,50 €“ (250,00 € ·
35 %), und als Summe der Nutzerkosten Heizungsanlage S = 3.845,51 €. Die Summe und die CO₂-Zeilen
stammen aus dem Techem-Muster; die Aufteilung auf die vier Nutzer ist erfunden:

| Mieter | Einzelbetrag |
|---|---|
| Mieter 1 (W1) | 1.103,27 € |
| Mieter 2 (W2) | 958,64 € |
| Mieter 3 (W3) | 1.014,85 € |
| Mieter 4 (W4) | 768,75 € |
| zusammen | 3.845,51 € |

CO₂-Seite: 46,4 kg CO₂ je m², Anteil des Vermieters 35 %, CO₂-Kosten 250,00 €, davon Vermieter
87,50 €. Zahl der Nutzeinheiten 4.

## Herleitung

**Betrag der Position.** Bezahlt hat der Vermieter die Kosten vor dem Abzug: S + L = 3.845,51 € +
87,50 € = 3.933,01 € (Entwurf 7.1, #209).

**Probe** (7.3). Vorwegabzug: Betrag = S + L verlangt, 3.933,01 € = 3.933,01 €. Eingetragene
Einzelbeträge 3.845,51 € ≤ S + 4 · 2 ct. Bestanden.

**Verteilung.** Jeder Mieter trägt seinen Einzelbetrag unverändert; der Rest der Position, 87,50 €,
ist der CO₂-Anteil des Vermieters (`co2Share`). Keine selbstgenutzte Wohnung, also kein L_self.

**Steuer.** Werbungskosten 3.933,01 €, privat 0 €.

**Nachstufung** (9.2). 46,4 kg liegen in der Stufe 42 bis unter 47 kg mit 70 %. Der Messdienst nennt
35 %: Im Muster ist der Anteil nach § 9 CO2KostAufG halbiert. Mietfuchs kennt Einschränkungen nach
§ 9 erst mit PR 7 und meldet deshalb `co2.stage-mismatch` (Hinweis ohne Rechtsfolge), der § 8 und § 9
als mögliche Gründe nennt. Das ist erwartet und steht im Test.
```

- [ ] **Step 2: F12 (Herleitung und Belegwerte)**

Die vier Einzelbeträge der realen Abrechnung stehen nicht im Repository; der Entwurf (12.1) sagt: „Die
vier Einzelbeträge schreibt die Umsetzung aus dem Beleg ab.“ Den Beleg hat der Nutzer. **Liegt er
nicht vor, die Steps 2 bis 4 zu F12 zurückstellen, den Nutzer um die vier Beträge bitten und mit F15
weitermachen**; der Test zu F12 bricht ohne die Datei mit einer Ansage ab, nie mit einem erfundenen
Wert.

`server/test/fixtures/heating/F12-messdienst-mai-april/betraege.json`: ein Objekt mit den Feldern
`quelle` (Text: „Messdienst-Komplettabrechnung 01.05.2025–30.04.2026, anonymisiert, Einzelbeträge
Heizung + Warmwasser je Nutzer“), `einzelbetraege` (die vier Beträge „Ihre Heizkosten + Ihre
Warmwasserkosten“ in Cent, in der Reihenfolge der Nutzeinheiten der Abrechnung) und `kuerzungen` (je
Mieter 3 % seines Einzelbetrags in Cent, **von Hand** gerechnet und kaufmännisch gerundet, wie in der
README). Namen, Adressen, Nutzer- und Zählernummern kommen nicht hinein.

`server/test/fixtures/heating/F12-messdienst-mai-april/README.md`:

```markdown
# F12 Mai–April, Messdienst ohne CO₂-Aufteilung

Eine reale Abrechnung, anonymisiert (Entwurf 12.1): ein Haus mit vier Nutzeinheiten und 200,6 m²
Wohnfläche, Erdgas, Abrechnungszeitraum des Messdienstes 01.05.2025–30.04.2026. Eine Gasrechnung über
29.886 kWh und 3.117,47 €. Verteilt wird nach 30/70; Heizung 4.035,70 €, Warmwasser 240,81 €, zusammen
4.276,51 €. Eine CO₂-Aufteilung enthält die Abrechnung nicht.

Das Objekt rechnet von Mai bis April ab (Beginnmonat 5), alle vier Einheiten sind vermietet. Die
Position „Heizung und Warmwasser“ trägt 4.276,51 € als Einzelbeträge; die vier Beträge stehen in
`betraege.json`, aus dem Beleg abgeschrieben.

## Herleitung

**Zeitraum.** `2025-05`, 01.05.2025–30.04.2026, Bezeichnung „2025/2026“. Frist zwölf Monate nach dem
Ende: 30.04.2027 (§ 556 Abs. 3 Satz 2 BGB).

**CO₂.** Gas ist ein Brennstoff mit Standardwert nach der EBeV; die Heizperiode beginnt nach dem
01.01.2023, die Aufteilung gilt (§ 11 Abs. 2 Satz 1 CO2KostAufG). Der Messdienst hat nicht aufgeteilt
(Antwort „gar nicht aufgeteilt“). Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um
3 % kürzen (§ 7 Abs. 4 CO2KostAufG): je Mieter 3 % seines gedruckten Einzelbetrags, kaufmännisch
gerundet (Entwurf 6.5). Die Beträge stehen in `betraege.json` unter `kuerzungen`.

**Summe der Kürzungen.** 3 % · 4.276,51 € = 128,2953 €. Weil jeder Betrag für sich gerundet wird, liegt
die Summe der vier Kürzungen zwischen 128,28 € und 128,31 € (vier Rundungen von höchstens einem halben
Cent um 128,2953 €).

**Keine 15 %.** Einzelbeträge zählen als Verteilung nach Verbrauch. Ohne Angabe zum Warmwasseranteil
gibt es keinen Hinweis nach § 9 Abs. 2 HeizkostenV.
```

- [ ] **Step 3: Write the tests**

`server/test/heating-golden.test.ts`:

```ts
// Golden F15 und F12 (Heizung PR 6, Entwurf 12.1). Herleitung von Hand in
// fixtures/heating/<Fixture>/README.md; jede Zahl hier steht dort. Der Bestand entsteht über denselben
// Weg wie beim Nutzer: Wohnungen, Mietverhältnisse, Heizanlage, Position und CO₂-Angaben.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { saveCo2Statement } from '../src/db/co2.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'heating')
const euro = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
type Opened = Awaited<ReturnType<typeof openDatabase>>

async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heating-golden-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Vier Wohnungen à 50 m² mit je einem Mieter seit 2020 und eine Gasheizung beim Messdienst.
async function vierWohnungen(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [i, u] of ['a', 'b', 'c', 'd'].entries()) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: `W${i + 1}`, areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${i + 1}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
  })
}

test('F15 Techem-Muster mit Vorwegabzug: Probe exakt, co2Share 87,50 €, Werbungskosten 3.933,01 €', async () => {
  await withDatabase(async (opened) => {
    await vierWohnungen(opened)
    const betraege = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: 393301, key: 'amounts', tenancyAmounts: betraege,
      })
      await saveCo2Statement(db, 'hp', '2025-01', {
        method: 'serviceDeducted', serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4,
        serviceTotalCents: 25000, serviceLandlordPermille: 350, serviceKgPerM2: 46.4,
      })
    })
    const stock = await opened.read(readStock)
    const p = periodOfKey({ startMonth: 1, changes: [] }, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
    const snapshot = snapshotFor(stock, 'objekt-1', p)
    const s = computeSettlement(snapshot)
    assert.deepEqual(s.statements.map((st) => [st.tenancyId, st.rows.find((r) => r.costItemId === 'hz')?.shareCents]).sort(), Object.entries(betraege).sort())
    assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'hz')?.landlordParts, [{ reason: 'co2Share', cents: 8750 }])
    assert.ok(!s.notices.some((n) => n.code === 'co2.sum-check'), 'die Probe geht auf')
    assert.match(s.notices.find((n) => n.code === 'co2.stage-mismatch')?.text ?? '', /§ 9 CO2KostAufG/)
    const tax = taxReport(snapshot).expenses.items.find((x) => x.costItemId === 'hz') ?? assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.deepEqual([tax.amountCents, tax.privateCents, tax.deductibleCents], [393301, 0, 393301])
    assert.equal(s.heating?.[0]?.co2?.booked, true)
  })
})

test('F12 Mai–April, Messdienst ohne CO₂-Aufteilung: Frist 30.04.2027, co2.service-unsplit mit 3 % je Mieter', async () => {
  const datei = path.join(FIXTURES, 'F12-messdienst-mai-april', 'betraege.json')
  if (!fs.existsSync(datei)) return assert.fail(`${datei} fehlt: die vier Einzelbeträge aus dem Beleg (Entwurf 12.1) sind noch nicht eingetragen`)
  const daten: unknown = JSON.parse(fs.readFileSync(datei, 'utf8'))
  const liste = (key: string): number[] => {
    const v = typeof daten === 'object' && daten !== null ? Reflect.get(daten, key) : undefined
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isInteger(x) && x > 0)) return assert.fail(`${key} in betraege.json: vier ganze Cent-Beträge erwartet`)
    return v
  }
  const einzel = liste('einzelbetraege')
  const kuerzung = liste('kuerzungen')
  assert.equal(einzel.reduce((a, c) => a + c, 0), 427651, 'die vier Einzelbeträge ergeben 4.276,51 €')
  const summe = kuerzung.reduce((a, c) => a + c, 0)
  assert.ok(summe >= 12828 && summe <= 12831, `Summe der Kürzungen ${summe} liegt nicht zwischen 128,28 und 128,31 €`)
  await withDatabase(async (opened) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    await vierWohnungen(opened)
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: 427651, key: 'amounts',
        tenancyAmounts: { ta: einzel[0], tb: einzel[1], tc: einzel[2], td: einzel[3] },
      })
      await saveCo2Statement(db, 'hp', '2025-05', { method: 'selfAfterService' })
    })
    const regeln: PeriodRules = { startMonth: 5, changes: [] }
    const p = periodOfKey(regeln, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025/2026')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.deepEqual([s.period.label, s.deadline], ['2025/2026', '2027-04-30'])
    const text = s.notices.find((n) => n.code === 'co2.service-unsplit')?.text ?? assert.fail('kein Hinweis co2.service-unsplit')
    kuerzung.forEach((c, i) => assert.ok(text.includes(`Mieter ${i + 1} (W${i + 1}) ${euro(c)}`), `Kürzung Mieter ${i + 1}: ${text}`))
    assert.ok(!s.notices.some((n) => n.code === 'heating.dhw-not-metered' || n.code === 'heating.not-by-consumption'), 'keine 15 %')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix server test -- test/heating-golden.test.ts`
Expected: PASS, sobald `betraege.json` aus dem Beleg eingetragen ist. Scheitert eine Zahl, ist
entweder die Berechnung falsch oder die Herleitung; die Erwartung wird nie an das Ergebnis angepasst
(README des Prüfkatalogs). Fehlt die Datei noch, scheitert genau der Test F12 mit der Ansage aus
Step 3; dann nur F15 committen (Step 5 ohne den Ordner F12) und F12 nachholen, sobald die Beträge da
sind.

- [ ] **Step 5: Commit**

```bash
git add server/test/heating-golden.test.ts server/test/fixtures/heating
git commit -m "Golden F15 (Techem-Muster mit Vorwegabzug) und F12 (Mai bis April, Messdienst ohne CO₂)

Herleitung von Hand in den READMEs; die Einzelbeträge von F12 stammen aus dem Beleg.

Refs #97, #209"
```

---

### Task 11: Oberfläche: die Seite Heizkosten

Die Karten „CO₂-Kosten“ und „Warmwasser“ (Entwurf 11.3, 11.4) auf einer Seite, die erst ab einer
Heizanlage in der Navigation steht. Die Logik liegt DOM-frei in `client/src/co2Form.ts` und
`client/src/heatingForm.ts`; ein jsdom-Test prüft, dass die Auswahl den gespeicherten Wert zeigt.

**Files:**
- Create: `client/src/co2Form.ts`, `client/src/components/Co2Card.tsx`, `client/src/components/HotWaterCard.tsx`, `client/src/pages/Heizkosten.tsx`
- Modify: `client/src/heatingForm.ts`, `client/src/nav.ts`, `client/src/App.tsx`, `client/src/notices.ts`, `shared/guides.ts` (nur `GUIDE_PAGES`)
- Test: `client/src/co2Form.test.ts` (neu), `client/src/heatingForm.test.ts`, `client/src/components/Co2Card.test.tsx` (neu), `client/src/nav.test.ts` (neu), `client/src/notices.test.ts`

**Interfaces:**
- Consumes (Task 2, 4, 6): `HeatingPeriodView`, `Co2Statement`, `Co2Method`, `DhwMethod`; `serviceProbe`, `enteredCentsOf`; Routen unter `/api/heating-plants/:id/periods`; `usePeriod()` (PR 3) mit `param`, `label`; `useProperty`, `withProperty`; `api`, `errorText`, `fmtEuro`, `parseEuro`; `Term`, `PageHeader`, `useToast`, `useConfirm`.
- Produces:
  - `co2Form.ts`: `type Co2Answer = '' | 'deducted' | 'shown' | 'unsplit'`, `CO2_QUESTION`, `CO2_EXAMPLE`, `CO2_ANSWER_OPTIONS`, `type Co2Form`, `type Co2Context = { items: HeatingPeriodView['items']; unitsCount: number }`, `parseDecimal(text)`, `co2ToForm(st, ctx)`, `usersTotalOf(form, ctx)`, `co2Body(form, ctx): { body: Record<string, unknown> } | { error: string }`, `probeLine(form, ctx): { text: string; ok: boolean } | null`
  - `heatingForm.ts`: `type HotWaterChoice = DhwMethod | ''`, `HOT_WATER_OPTIONS`, `isFormula(choice)`, `hotWaterBody(choice, unmeasurable)`
  - `nav.ts`: `Tab` + `'heizkosten'`, `navFor(hasHeatingPlant: boolean)`; `GUIDE_PAGES` + `'heizkosten'`
  - `notices.ts`: `NoticeTab` + `'heizkosten'`; `heatingCosts` → Heizkosten (`heatingPlant` bleibt bei den Stammdaten, PR 5)

- [ ] **Step 1: Write the failing tests**

`client/src/co2Form.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { CO2_ANSWER_OPTIONS, co2Body, co2ToForm, parseDecimal, probeLine, usersTotalOf, type Co2Context } from './co2Form'
import { periodKey } from '../../shared/period.ts'
import type { Co2Statement } from './types'

const ctx: Co2Context = {
  unitsCount: 4,
  items: [
    { id: 'hz', description: 'Messdienst', amountCents: 393301, key: 'amounts', tenancyAmounts: { t1: 110327, t2: 95864, t3: 101485, t4: 76875 } },
    { id: 'gs', description: 'Gutschrift', amountCents: -4000, key: 'area' },
  ],
}
const gespeichert: Co2Statement = {
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null,
  serviceAreaM2: null, serviceKgPerM2: 46.4, serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceLandlordCents: 8750,
  serviceUsersTotalCents: 384551, serviceUsersTotalApprox: false, serviceUnitsCount: 4, serviceCostItemId: null, serviceSelfLandlordCents: null,
  serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [{ tenancyId: 't1', cents: 2500 }],
}

test('Eine neue Heizperiode beginnt ohne Antwort und ohne Beträge; die Zahl der Nutzeinheiten ist vorbelegt (Entwurf 7.2, 12.4)', () => {
  const f = co2ToForm(null, ctx)
  expect(f.answer).toBe('')
  expect([f.usersTotal, f.landlordCo2, f.totalCo2, f.kgPerM2, f.landlordPercent]).toEqual(['', '', '', '', ''])
  expect(f.unitsCount).toBe('4')
  expect(CO2_ANSWER_OPTIONS[0]?.value).toBe('')
  expect(co2Body(f, ctx)).toEqual({ error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' })
})

test('Gespeicherte Angaben zurück ins Formular und wieder in den Rumpf', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect([f.answer, f.usersTotal, f.landlordCo2, f.kgPerM2, f.landlordPercent, f.reliefs.t1]).toEqual(['deducted', '3.845,51', '87,50', '46,4', '35', '25,00'])
  const r = co2Body(f, ctx)
  if (!('body' in r)) throw new Error(r.error)
  expect(r.body).toMatchObject({
    method: 'serviceDeducted', serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4, serviceKgPerM2: 46.4,
    serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceCostItemId: null, reliefs: [{ tenancyId: 't1', cents: 2500 }],
  })
})

test('Probe live (Entwurf 11.3): „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“, nur über die Messdienstpositionen', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect(probeLine(f, ctx)).toEqual({ text: `Ihre Positionen: ${fmtEuro(393301)} · erwartet: ${fmtEuro(393301)} ✓`, ok: true })
  expect(probeLine({ ...f, answer: 'shown' }, ctx)?.ok).toBe(false)
  expect(probeLine({ ...f, answer: 'unsplit' }, ctx)).toBeNull()
  expect(probeLine({ ...f, landlordCo2: '' }, ctx)).toBeNull()
})

test('„Ich finde diese Zeile nicht“: S = eingetragene Einzelbeträge + Beträge der leeren Einheiten (Entwurf 7.3, R6)', () => {
  const f = { ...co2ToForm(gespeichert, ctx), usersTotal: '', usersTotalApprox: true, vacancyTotal: '500,00' }
  expect(usersTotalOf(f, ctx)).toBe(384551 + 50000)
  const r = co2Body(f, ctx)
  if (!('body' in r)) throw new Error(r.error)
  expect(r.body).toMatchObject({ serviceUsersTotalCents: 434551, serviceUsersTotalApprox: true })
  expect(usersTotalOf({ ...f, vacancyTotal: '' }, ctx)).toBe(384551)
})

test('Pflichtangaben und Zahlen: S, L, Nutzeinheiten; deutsche und technische Schreibweise', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect(co2Body({ ...f, usersTotal: '' }, ctx)).toEqual({ error: 'Bitte tragen Sie die Summe der Kosten aller Nutzer ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.' })
  expect(co2Body({ ...f, landlordCo2: '' }, ctx)).toEqual({ error: 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein.' })
  expect(co2Body({ ...f, unitsCount: '0' }, ctx)).toEqual({ error: 'Bitte tragen Sie die Zahl der Nutzeinheiten ein, mindestens 1.' })
  expect(co2Body({ ...f, kgPerM2: 'viel' }, ctx)).toEqual({ error: 'Bitte prüfen Sie „CO₂-Ausstoß je m² und Jahr (kg)“: keine Zahl ab 0.' })
  expect([parseDecimal('46,4'), parseDecimal('46.4'), parseDecimal('1.046,4'), parseDecimal(''), parseDecimal('x')]).toEqual([46.4, 46.4, 1046.4, null, null])
  // Hat der Messdienst nicht aufgeteilt, genügt die Antwort.
  expect(co2Body({ ...co2ToForm(null, ctx), answer: 'unsplit' }, ctx)).toMatchObject({ body: { method: 'selfAfterService' } })
})
```

`client/src/heatingForm.test.ts` anhängen (Import ergänzen: `HOT_WATER_OPTIONS, hotWaterBody, isFormula`):

```ts
test('Warmwasser laut Messdienst (Heizung PR 6): die Bestätigung des Aufwands gibt es nur zu einer Formel', () => {
  expect(HOT_WATER_OPTIONS.map((o) => o.value)).toEqual(['', 'heatMeter', 'volumeFormula', 'areaFormula'])
  expect([isFormula('volumeFormula'), isFormula('areaFormula'), isFormula('heatMeter'), isFormula('')]).toEqual([true, true, false, false])
  expect(hotWaterBody('areaFormula', true)).toEqual({ dhwMethod: 'areaFormula', dhwUnmeasurable: true })
  expect(hotWaterBody('heatMeter', true)).toEqual({ dhwMethod: 'heatMeter', dhwUnmeasurable: null })
  expect(hotWaterBody('', false)).toEqual({ dhwMethod: null, dhwUnmeasurable: null })
})
```

`client/src/components/Co2Card.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „CO₂-Kosten“ (Heizung PR 6). Geprüft wird die Eigenschaft, die die Logiktests nicht sehen:
// Die Auswahl zeigt den gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), eine neue Heizperiode zeigt
// keine Antwort, und Speichern schickt die gewählte Methode.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2Card from './Co2Card'
import { CO2_QUESTION } from '../co2Form'
import { periodKey } from '../../../shared/period.ts'
import type { Co2Statement, HeatingPeriodView, Tenancy } from '../types'

const view = (co2: Co2Statement | null): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2,
  items: [{ id: 'hz', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { t1: 100000 } }],
})
const shown: Co2Statement = {
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceShown', areaM2: null, serviceEmissionsKg: null,
  serviceAreaM2: null, serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: 500,
  serviceUsersTotalCents: 100500, serviceUsersTotalApprox: false, serviceUnitsCount: 1, serviceCostItemId: null, serviceSelfLandlordCents: null,
  serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
}
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'u1', tenantName: 'Mieter Eins', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]

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

// Die Frage steht als Beschriftung über der Auswahl; zum Finden trägt die Auswahl den kurzen Namen.
const frage = (): HTMLSelectElement => {
  const el = screen.getByLabelText('Abzugszeile')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl zeigt die gespeicherte Antwort; eine neue Heizperiode zeigt „Bitte wählen …“', () => {
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.getByText(CO2_QUESTION, { exact: false })).toBeTruthy()
  expect(frage().value).toBe('shown')
  expect(frage().selectedOptions[0]?.textContent).toBe('Nein, die CO₂-Kosten sind nur ausgewiesen')
  cleanup()
  render(<Co2Card view={view(null)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(frage().value).toBe('')
  expect(frage().selectedOptions[0]?.textContent).toBe('Bitte wählen …')
})

test('Speichern schickt die Methode und die Beträge an die Heizperiode', async () => {
  const saved = vi.fn()
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={saved} />)
  expect(screen.getByText(/^Probe:/).textContent).toMatch(/✓$/)
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/co2')
  expect(sent[0]?.body).toMatchObject({ method: 'serviceShown', serviceUsersTotalCents: 100500, serviceLandlordCents: 500, serviceUnitsCount: 1 })
})
```

`client/src/nav.test.ts`:

```ts
import { expect, test } from 'vitest'
import { NAV, navFor, pageLabel } from './nav'

test('Die Seite Heizkosten erscheint erst mit einer Heizanlage (Heizung PR 6, Entwurf 11.4)', () => {
  const ids = (hasPlant: boolean) => navFor(hasPlant).flatMap((g) => g.items.map((i) => i.id))
  expect(ids(false)).not.toContain('heizkosten')
  expect(ids(true)).toContain('heizkosten')
  expect(ids(false)).toEqual(NAV.flatMap((g) => g.items.map((i) => i.id)).filter((id) => id !== 'heizkosten'))
  expect(pageLabel('heizkosten')).toBe('Heizkosten')
})
```

`client/src/notices.test.ts`: im Test „Heizanlage als Ziel …“ (Task 2) die Erwartung zu `heatingCosts`
ersetzen durch

```ts
  expect(noticeTarget({ kind: 'heatingCosts', id: 'hp1' })).toEqual({ tab: 'heizkosten', label: 'Hier beheben → Heizkosten', focus: { kind: 'heatingCosts', id: 'hp1' } })
```

und den Kommentar darüber streichen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- co2Form heatingForm Co2Card nav notices`
Expected: FAIL mit `Failed to resolve import "./co2Form"`, `"./Co2Card"`, `navFor is not a function`
und der geänderten Erwartung in notices.test.ts.

- [ ] **Step 3: Logik (`client/src/co2Form.ts`, `client/src/heatingForm.ts`)**

`client/src/co2Form.ts`:

```ts
// Die Karte „CO₂-Kosten“ der Seite Heizkosten (Heizung PR 6, Entwurf 11.3): was der Vermieter aus
// der Abrechnung des Messdienstes oder der Gemeinschaft überträgt, ohne DOM, damit es ohne Browser
// prüfbar ist. Die Probe rechnet shared/co2Probe.ts, dieselbe Funktion wie die Abrechnung.
//
// Die Frage nach der Abzugszeile hat keine Vorgabe (Entwurf 7.2): Ob abgezogen wurde, steht nur auf
// dem Papier, und eine Vorgabe wäre bei einem Teil der Messdienste falsch.
import { fmtEuro, parseEuro } from './api'
import { enteredCentsOf, serviceProbe } from '../../shared/co2Probe.ts'
import type { Co2Method, Co2Statement, HeatingPeriodView } from './types'

export type Co2Answer = '' | 'deducted' | 'shown' | 'unsplit'
const METHOD_OF: Record<Exclude<Co2Answer, ''>, Co2Method> = { deducted: 'serviceDeducted', shown: 'serviceShown', unsplit: 'selfAfterService' }
const answerOf = (m: Co2Method): Co2Answer =>
  m === 'serviceDeducted' ? 'deducted' : m === 'serviceShown' ? 'shown' : m === 'selfAfterService' ? 'unsplit' : ''

export const CO2_QUESTION = 'Steht in der Kostenaufstellung eine Zeile wie „Abzüglich CO₂-Kosten Vermieter“, oder bei Ihren Mietern „vom Vermieter übernommen“?'
// Die Beispielzeile aus dem Techem-Muster (Entwurf 7.2).
export const CO2_EXAMPLE = 'Beispiel aus einer Musterabrechnung: Anlieferung Brennstoff 3.540,00 · Abzüglich CO₂-Kosten Vermieter −87,50 · Verbrauch 3.452,50'
export const CO2_ANSWER_OPTIONS: readonly { value: Co2Answer; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'deducted', label: 'Ja, es gibt eine Abzugszeile' },
  { value: 'shown', label: 'Nein, die CO₂-Kosten sind nur ausgewiesen' },
  { value: 'unsplit', label: 'Der Messdienst hat die CO₂-Kosten gar nicht aufgeteilt' },
]

export type Co2Form = {
  answer: Co2Answer
  usersTotal: string // S, wie gedruckt
  usersTotalApprox: boolean // „Ich finde diese Zeile nicht“
  vacancyTotal: string // Beträge leerer oder nicht eingetragener Einheiten (nur ohne S)
  kgPerM2: string
  landlordPercent: string
  totalCo2: string // C
  landlordCo2: string // L
  selfLandlord: string // L_self, wenn die Einzelabrechnung der eigenen Wohnung ihn nennt
  unitsCount: string // NE
  fuelGross: string // G
  fuelNet: string // V
  costItemId: string
  reliefs: Record<string, string> // „vom Vermieter übernommen“ je Mietverhältnis
}
export type Co2Context = { items: HeatingPeriodView['items']; unitsCount: number }

const centsText = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4 }))
const serviceItemsOf = (ctx: Co2Context) => ctx.items.filter((i) => i.key === 'amounts')

// Eine Zahl in deutscher („46,4“, „1.046,4“) oder technischer Schreibweise („46.4“).
export function parseDecimal(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

export function co2ToForm(st: Co2Statement | null, ctx: Co2Context): Co2Form {
  const permille = st?.serviceLandlordPermille ?? null
  const S = st?.serviceUsersTotalCents ?? null
  return {
    answer: st ? answerOf(st.method) : '',
    usersTotal: st?.serviceUsersTotalApprox ? '' : centsText(S),
    usersTotalApprox: st?.serviceUsersTotalApprox ?? false,
    vacancyTotal: st?.serviceUsersTotalApprox && S !== null ? centsText(Math.max(0, S - enteredCentsOf(serviceItemsOf(ctx)))) : '',
    kgPerM2: numberText(st?.serviceKgPerM2 ?? null),
    landlordPercent: permille === null ? '' : numberText(permille / 10),
    totalCo2: centsText(st?.serviceTotalCents ?? null),
    landlordCo2: centsText(st?.serviceLandlordCents ?? null),
    selfLandlord: centsText(st?.serviceSelfLandlordCents ?? null),
    unitsCount: String(st?.serviceUnitsCount ?? ctx.unitsCount),
    fuelGross: centsText(st?.serviceFuelGrossCents ?? null),
    fuelNet: centsText(st?.serviceFuelNetCents ?? null),
    costItemId: st?.serviceCostItemId ?? '',
    reliefs: Object.fromEntries((st?.reliefs ?? []).map((r) => [r.tenancyId, centsText(r.cents)])),
  }
}

// S: die gedruckte Summe, oder ohne sie die Einzelbeträge aller Nutzeinheiten laut Messdienst, also
// die eingetragenen und die der leeren oder nicht eingetragenen Einheiten (Entwurf 7.3, R6).
export function usersTotalOf(form: Co2Form, ctx: Co2Context): number | null {
  if (!form.usersTotalApprox) return form.usersTotal.trim() === '' ? null : parseEuro(form.usersTotal)
  const vacancy = form.vacancyTotal.trim() === '' ? 0 : parseEuro(form.vacancyTotal)
  return vacancy === null || vacancy < 0 ? null : enteredCentsOf(serviceItemsOf(ctx)) + vacancy
}

export function co2Body(form: Co2Form, ctx: Co2Context): { body: Record<string, unknown> } | { error: string } {
  if (form.answer === '') return { error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' }
  const method = METHOD_OF[form.answer]
  const errors: string[] = []
  const cents = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    if (c === null || c < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: kein Betrag ab 0 €.`)
      return null
    }
    return c
  }
  const decimal = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    if (n === null || n < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: keine Zahl ab 0.`)
      return null
    }
    return n
  }
  const S = usersTotalOf(form, ctx)
  const L = cents(form.landlordCo2, 'davon Vermieter')
  const percent = decimal(form.landlordPercent, 'Anteil des Vermieters (%)')
  const units = Number(form.unitsCount)
  const unitsCount = Number.isInteger(units) && units > 0 ? units : null
  const body = {
    method,
    serviceUsersTotalCents: S,
    serviceUsersTotalApprox: form.usersTotalApprox,
    serviceLandlordCents: L,
    serviceUnitsCount: unitsCount,
    serviceKgPerM2: decimal(form.kgPerM2, 'CO₂-Ausstoß je m² und Jahr (kg)'),
    serviceLandlordPermille: percent === null ? null : Math.round(percent * 10),
    serviceTotalCents: cents(form.totalCo2, 'CO₂-Kosten insgesamt'),
    serviceSelfLandlordCents: cents(form.selfLandlord, 'davon für Ihre Wohnung'),
    serviceFuelGrossCents: cents(form.fuelGross, 'Brennstoffkosten laut Abrechnung (vor Abzug)'),
    serviceFuelNetCents: cents(form.fuelNet, 'davon verteilt'),
    serviceCostItemId: form.costItemId === '' ? null : form.costItemId,
    reliefs: Object.entries(form.reliefs).flatMap(([tenancyId, text]) => {
      const c = cents(text, 'vom Vermieter übernommen')
      return c === null ? [] : [{ tenancyId, cents: c }]
    }),
  }
  const first = errors[0]
  if (first) return { error: first }
  if (method !== 'selfAfterService') {
    if (S === null) {
      return { error: form.usersTotalApprox
        ? 'Bitte tragen Sie die Beträge der leeren oder nicht eingetragenen Einheiten ein, 0, wenn es keine gibt.'
        : 'Bitte tragen Sie die Summe der Kosten aller Nutzer ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.' }
    }
    if (L === null) return { error: 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein.' }
    if (unitsCount === null) return { error: 'Bitte tragen Sie die Zahl der Nutzeinheiten ein, mindestens 1.' }
  }
  return { body }
}

// Die Probe unter der Karte (Entwurf 11.3): „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“.
export function probeLine(form: Co2Form, ctx: Co2Context): { text: string; ok: boolean } | null {
  if (form.answer !== 'deducted' && form.answer !== 'shown') return null
  const S = usersTotalOf(form, ctx)
  const L = form.landlordCo2.trim() === '' ? null : parseEuro(form.landlordCo2)
  const units = Number(form.unitsCount)
  if (S === null || L === null || !Number.isInteger(units) || units < 1) return null
  const p = serviceProbe({ deducted: form.answer === 'deducted', items: serviceItemsOf(ctx), usersTotalCents: S, landlordCents: L, unitsCount: units, approx: form.usersTotalApprox })
  const entered = p.enteredOk ? '' : ` · Einzel- und Eigenbeträge zusammen ${fmtEuro(p.enteredCents)}, mehr als S`
  return { text: `Ihre Positionen: ${fmtEuro(p.itemsCents)} · erwartet: ${fmtEuro(p.expectedCents)} ${p.ok ? '✓' : '✗'}${entered}`, ok: p.ok }
}
```

`client/src/heatingForm.ts` (PR 4) anhängen, `DhwMethod` in den Typimport aufnehmen:

```ts
// ---------- Warmwasser laut Messdienst (Heizung PR 6, #211, Entwurf 7.7) ----------

export type HotWaterChoice = DhwMethod | ''
export const HOT_WATER_OPTIONS: readonly { value: HotWaterChoice; label: string }[] = [
  { value: '', label: 'keine Angabe' },
  { value: 'heatMeter', label: 'mit einem Wärmezähler gemessen' },
  { value: 'volumeFormula', label: 'mit einer Formel aus dem Warmwasserverbrauch' },
  { value: 'areaFormula', label: 'mit einer Formel aus der Wohnfläche' },
]
export const isFormula = (choice: HotWaterChoice): boolean => choice === 'volumeFormula' || choice === 'areaFormula'
// Die Bestätigung des unzumutbaren Aufwands (§ 9 Abs. 2 Satz 2 HeizkostenV) gibt es nur zu einer Formel.
export function hotWaterBody(choice: HotWaterChoice, unmeasurable: boolean): { dhwMethod: DhwMethod | null; dhwUnmeasurable: boolean | null } {
  return { dhwMethod: choice === '' ? null : choice, dhwUnmeasurable: isFormula(choice) ? unmeasurable : null }
}
```

- [ ] **Step 4: Navigation und Hinweisziel (`client/src/nav.ts`, `shared/guides.ts`, `client/src/notices.ts`)**

`shared/guides.ts`: `GUIDE_PAGES` um `'heizkosten'` ergänzen (hinter `'mietkonto'`).

`client/src/nav.ts`: in `Tab` `| 'heizkosten'` ergänzen; im Abschnitt `'Abrechnen · Jahresende'`
vor dem Eintrag `abrechnung`:

```ts
      // Heizung PR 6 (Entwurf 11.4): erst ab einer Heizanlage sichtbar, siehe `navFor`.
      { id: 'heizkosten', label: 'Heizkosten', icon: '🔥' },
```

Ans Dateiende:

```ts
// Die Seite Heizkosten gibt es erst ab einer Heizanlage (Entwurf 11.1, 11.4): Wer keine hat, sieht
// keine neue Seite.
export function navFor(hasHeatingPlant: boolean): typeof NAV {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== 'heizkosten' || hasHeatingPlant) }))
}
```

`client/src/notices.ts`: `NoticeTab` um `| 'heizkosten'` ergänzen und in `TARGETS` die Zeile
`heatingCosts` (Task 2) ersetzen durch

```ts
  // Heizung PR 6: die CO₂-Angaben und das Warmwasser stehen auf der Seite Heizkosten.
  heatingCosts: { tab: 'heizkosten', page: 'Heizkosten' },
```

- [ ] **Step 5: Komponenten**

`client/src/components/Co2Card.tsx`:

```tsx
// Die Karte „CO₂-Kosten“ einer Heizperiode (Heizung PR 6, Entwurf 11.3). Die Logik steht in
// co2Form.ts; hier wird nur gezeigt und gespeichert.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_QUESTION, co2Body, co2ToForm, probeLine, type Co2Form } from '../co2Form'
import type { HeatingPeriodView, Tenancy } from '../types'

type TextKey = 'usersTotal' | 'vacancyTotal' | 'kgPerM2' | 'landlordPercent' | 'totalCo2' | 'landlordCo2' | 'selfLandlord' | 'unitsCount' | 'fuelGross' | 'fuelNet'

export default function Co2Card({ view, tenancies, unitsCount, onSaved }: { view: HeatingPeriodView; tenancies: Tenancy[]; unitsCount: number; onSaved: () => void }) {
  const ctx = { items: view.items, unitsCount }
  const [form, setForm] = useState<Co2Form>(() => co2ToForm(view.co2, ctx))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const set = <K extends keyof Co2Form>(key: K, value: Co2Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const probe = probeLine(form, ctx)
  const serviceItems = view.items.filter((i) => i.key === 'amounts')
  const billed = tenancies.filter((t) => serviceItems.some((i) => (i.tenancyAmounts?.[t.id] ?? 0) > 0))
  const service = form.answer === 'deducted' || form.answer === 'shown'
  const url = `/api/heating-plants/${view.plantId}/periods/${view.period}/co2`

  async function save() {
    const r = co2Body(form, ctx)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setBusy(true)
    try {
      await api(url, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('CO₂-Angaben gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'CO₂-Angaben entfernen?',
      message: 'Die Abrechnung rechnet diese Heizperiode dann wieder ohne CO₂-Aufteilung.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(url, { method: 'DELETE' })
      toast('CO₂-Angaben entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const text = (key: TextKey, label: string) => (
    <label className="field">
      {label}
      <input value={form[key]} inputMode="decimal" disabled={view.closed} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2>CO₂-Kosten <Term id="co2Split" /></h2>
      {view.closed && <p className="muted">Diese Heizperiode ist abgeschlossen; die Angaben lassen sich nicht mehr ändern.</p>}
      <label className="field">
        {CO2_QUESTION}
        <select
          aria-label="Abzugszeile"
          value={form.answer}
          disabled={view.closed}
          onChange={(e) => set('answer', CO2_ANSWER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}
        >
          {CO2_ANSWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <p className="muted">{CO2_EXAMPLE} <Term id="co2Deducted" /></p>
      {form.answer === 'unsplit' && (
        <p className="notice">Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten kürzen; die Abrechnung nennt die Beträge. Bitten Sie den Messdienst um eine Abrechnung mit CO₂-Aufteilung.</p>
      )}
      {service && (
        <>
          <div className="row">
            {form.usersTotalApprox ? text('vacancyTotal', 'Beträge leerer oder nicht eingetragener Einheiten') : text('usersTotal', 'Summe der Kosten aller Nutzer (S)')}
            <label className="field">
              <input type="checkbox" checked={form.usersTotalApprox} disabled={view.closed} onChange={(e) => set('usersTotalApprox', e.target.checked)} />
              Ich finde diese Zeile nicht
            </label>
            {text('unitsCount', 'Nutzeinheiten laut Abrechnung')}
          </div>
          <div className="row">
            {text('kgPerM2', 'CO₂-Ausstoß je m² und Jahr (kg)')}
            {text('landlordPercent', 'Anteil des Vermieters (%)')}
            {text('totalCo2', 'CO₂-Kosten insgesamt')}
            {text('landlordCo2', 'davon Vermieter')}
            {form.answer === 'deducted' && text('selfLandlord', 'davon für Ihre Wohnung')}
          </div>
          {serviceItems.length > 1 && (
            <label className="field">
              Position mit dem CO₂-Anteil
              <select value={form.costItemId} disabled={view.closed} onChange={(e) => set('costItemId', e.target.value)}>
                <option value="">die größte Position</option>
                {serviceItems.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}
              </select>
            </label>
          )}
          {billed.length > 0 && (
            <div className="field-group">
              <div className="field-group-label">vom Vermieter übernommen, je Mieter (wenn die Abrechnung es nennt)</div>
              {billed.map((t) => (
                <label className="field" key={t.id}>
                  {t.tenantName}
                  <input value={form.reliefs[t.id] ?? ''} inputMode="decimal" disabled={view.closed} onChange={(e) => set('reliefs', { ...form.reliefs, [t.id]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <details>
            <summary>Weitere Angaben</summary>
            <div className="row">
              {text('fuelGross', 'Brennstoffkosten laut Abrechnung (vor Abzug)')}
              {text('fuelNet', 'davon verteilt')}
            </div>
          </details>
          {probe && <div className={probe.ok ? 'hint' : 'error'}>Probe: {probe.text}</div>}
        </>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void save()}>CO₂-Angaben speichern</button>
          {view.co2 && <button className="btn secondary" onClick={() => void remove()}>CO₂-Angaben entfernen</button>}
        </div>
      )}
    </div>
  )
}
```

`client/src/components/HotWaterCard.tsx`:

```tsx
// Die Karte „Warmwasser“ einer Heizperiode (Heizung PR 6, #211, Entwurf 7.7): wie der Messdienst die
// Wärme für das Warmwasser ermittelt hat. Bei einer Formel ohne bestätigten Aufwand nennt die
// Abrechnung die Kürzung von 15 %.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { HOT_WATER_OPTIONS, hotWaterBody, isFormula, type HotWaterChoice } from '../heatingForm'
import type { HeatingPeriodView } from '../types'

export default function HotWaterCard({ view, onSaved }: { view: HeatingPeriodView; onSaved: () => void }) {
  const [choice, setChoice] = useState<HotWaterChoice>(view.hotWater.dhwMethod ?? '')
  const [unmeasurable, setUnmeasurable] = useState(view.hotWater.dhwUnmeasurable === true)
  const [error, setError] = useState('')
  const toast = useToast()

  async function save() {
    try {
      await api(`/api/heating-plants/${view.plantId}/periods/${view.period}/hot-water`, { method: 'PUT', body: JSON.stringify(hotWaterBody(choice, unmeasurable)) })
      setError('')
      toast('Angabe zum Warmwasser gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Warmwasser <Term id="hotWaterShare" /></h2>
      <label className="field">
        Wie hat der Messdienst die Wärme für das Warmwasser ermittelt?
        <select value={choice} disabled={view.closed} onChange={(e) => setChoice(HOT_WATER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {isFormula(choice) && (
        <label className="field">
          <input type="checkbox" checked={unmeasurable} disabled={view.closed} onChange={(e) => setUnmeasurable(e.target.checked)} />
          Messen wäre nur mit unzumutbar hohem Aufwand möglich (Nachweis aufbewahren)
        </label>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && <button className="btn" onClick={() => void save()}>Angabe speichern</button>}
    </div>
  )
}
```

`client/src/pages/Heizkosten.tsx`:

```tsx
// Die Seite „Heizkosten“ (Heizung PR 6, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“. Sie steht erst ab einer Heizanlage in der
// Navigation (`navFor`).
import { useCallback, useEffect, useState } from 'react'
import type { HeatingPeriodView, HeatingPlant, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import HotWaterCard from '../components/HotWaterCard'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../../shared/law/register.ts'

export default function Heizkosten({ units, tenancies }: { units: Unit[]; tenancies: Tenancy[] }) {
  const { property } = useProperty()
  const period = usePeriod()
  const [plants, setPlants] = useState<HeatingPlant[] | null>(null)
  const [views, setViews] = useState<Record<string, HeatingPeriodView[]>>({})
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const list = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const entries = await Promise.all(
        list.map(async (p): Promise<[string, HeatingPeriodView[]]> => [p.id, await api<HeatingPeriodView[]>(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`)]),
      )
      setPlants(list)
      setViews(Object.fromEntries(entries))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [property?.id, period.param])
  useEffect(() => { void load() }, [load])
  const first = co2FirstPeriodStart()

  return (
    <div>
      <PageHeader title={`Heizkosten ${period.label}`} />
      {error && <div className="error">{error}</div>}
      {plants !== null && plants.length === 0 && (
        <div className="card"><p>Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.</p></div>
      )}
      {(plants ?? []).map((plant) => (
        <div key={plant.id}>
          {plant.method !== 'service' ? (
            <div className="card">
              <p>Die Karten dieser Seite gelten für eine Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet. Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf.</p>
            </div>
          ) : (
            (views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2>{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {v.from >= first ? (
                  <Co2Card view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                )}
                <HotWaterCard view={v} onSaved={() => void load()} />
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  )
}
```

`client/src/App.tsx`:
- `import Heizkosten from './pages/Heizkosten'`, `import { navFor, type Tab } from './nav'` (statt
  `NAV`, falls `NAV` sonst nicht mehr gebraucht wird), `HeatingPlant` in den Typimport aus `'./types'`.
- In `Shell` hinter den übrigen `useState`:

```tsx
  // Die Seite Heizkosten erscheint erst mit einer Heizanlage (Heizung PR 6, Entwurf 11.4). Neu
  // gefragt wird bei jedem Seitenwechsel, so erscheint sie, sobald die Anlage in den Stammdaten
  // angelegt ist.
  const [hasHeatingPlant, setHasHeatingPlant] = useState(false)
  useEffect(() => {
    if (!propertyId) {
      setHasHeatingPlant(false)
      return
    }
    let current = true
    api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId))
      .then((list) => { if (current) setHasHeatingPlant(list.length > 0) })
      .catch(() => { if (current) setHasHeatingPlant(false) })
    return () => { current = false }
  }, [propertyId, tab])
```

- Wo die Seitenleiste `NAV.map(…)` durchläuft, `navFor(hasHeatingPlant).map(…)` einsetzen.
- Bei den Seiten hinter `{tab === 'abrechnung' && (…)}`:

```tsx
        {tab === 'heizkosten' && <Heizkosten units={units} tenancies={tenancies} />}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- co2Form heatingForm Co2Card nav notices && npm run typecheck && npm run build`
Expected: PASS; der Build übersetzt die neuen Seiten.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS. `law-literals.test.ts` sieht in der Oberfläche keine Rechtszahl (die 15 % nennt die
Abrechnung, die Karte nicht), `anrede.test.ts` keine Du-Form.

```bash
git add client/src shared/guides.ts
git commit -m "Seite Heizkosten: Karten CO₂-Kosten und Warmwasser, mit Probe

Die Frage nach der Abzugszeile hat keine Vorgabe; die Probe rechnet dieselbe Funktion wie die
Abrechnung. Die Seite erscheint erst mit einer Heizanlage.

Refs #97, #209, #211"
```

---
### Task 12: Ausdruck: Druckblock „CO₂-Kostenaufteilung“

Der Druckblock je Anlage (Entwurf 9.5) ist **nicht** `no-print`, denn er erfüllt § 7 Abs. 3
CO2KostAufG: Anteil des Mieters, Einstufung mit kompakter Stufentabelle und markierter Stufe (bei
kurzer Heizperiode mit gekürzten Grenzen) und die Grundlagen, „laut Messdienst“ bzw. „bereits
abgezogen“. Die Logik steht DOM-frei in `client/src/co2View.ts`.

**Files:**
- Create: `client/src/co2View.ts`, `client/src/components/Co2Block.tsx`
- Modify: `client/src/pages/Abrechnung.tsx`
- Test: `client/src/co2View.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2, 7, 11): `HeatingStatement`, `Co2Assessment`; `ENERGY_OPTIONS` (PR 4, heatingForm.ts); `fmtDate`, `fmtEuro`.
- Produces: `type Co2BlockView = { title: string; lines: { label: string; value: string }[]; table: { range: string; percent: string; marked: boolean }[]; notes: string[] }`, `co2Block(h: HeatingStatement, tenancyId: string): Co2BlockView | null`; Komponente `Co2Block({ view })`.

- [ ] **Step 1: Write the failing test**

`client/src/co2View.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { co2Block } from './co2View'
import { periodKey } from '../../shared/period.ts'
import type { Co2Assessment, HeatingStatement } from './types'

// `node:assert` gibt es im Client nicht; für die eine Stelle, die ohne Block abbrechen soll.
const assert = { fail: (text: string): never => { throw new Error(text) } }
const TABELLE = [[0, 12, 0], [12, 17, 10], [17, 22, 20], [22, 27, 30], [27, 32, 40], [32, 37, 50], [37, 42, 60], [42, 47, 70], [47, 52, 80], [52, null, 95]]
  .map(([from, to, landlordPercent]) => ({ from: from ?? 0, to: to ?? null, landlordPercent: landlordPercent ?? 0 }))
const bewertung = (over: Partial<Co2Assessment> = {}): Co2Assessment => ({
  method: 'serviceDeducted', booked: true, deducted: true, totalCents: 25000, landlordCents: 8750, landlordPermille: 350, kgPerM2: 46.4,
  emissionsKg: null, areaM2: null, stage: { from: 42, to: 47, landlordPercent: 70 }, table: TABELLE, shortened: false,
  selfLandlordCents: null, selfApproximated: false, tenants: [{ tenancyId: 'ta', landlordCents: 2511, tenantCents: 4662, approximated: true }], ...over,
})
const anlage = (co2: Co2Assessment | null): HeatingStatement => ({ plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2 })

test('Druckblock (§ 7 Abs. 3 CO2KostAufG): Anteil des Mieters, Einstufung mit markierter Stufe, Grundlagen laut Messdienst', () => {
  const v = co2Block(anlage(bewertung()), 'ta') ?? assert.fail('kein Block')
  expect(v.title).toBe('CO₂-Kostenaufteilung')
  expect(v.lines.map((l) => l.label)).toEqual([
    'Energieträger', 'Heizperiode', 'CO₂-Ausstoß je m² und Jahr', 'Anteil des Vermieters laut Abrechnung', 'CO₂-Kosten insgesamt',
    'davon trägt der Vermieter', 'Ihr Anteil an den CO₂-Kosten', 'vom Vermieter übernommen (bereits abgezogen)',
  ])
  expect(v.lines.find((l) => l.label === 'CO₂-Ausstoß je m² und Jahr')?.value).toBe('46,4 kg')
  expect(v.lines.find((l) => l.label === 'Anteil des Vermieters laut Abrechnung')?.value).toBe('35 %')
  expect(v.lines.find((l) => l.label === 'vom Vermieter übernommen (bereits abgezogen)')?.value).toBe(`${fmtEuro(2511)} (nach Ihrem Anteil an den Heizkosten)`)
  expect(v.table.filter((s) => s.marked)).toEqual([{ range: '42 bis unter 47 kg', percent: '70 %', marked: true }])
  expect(v.table.at(-1)).toEqual({ range: 'ab 52 kg', percent: '95 %', marked: false })
  expect(v.notes).toEqual(['Angaben laut Abrechnung des Messdienstes oder der Gemeinschaft (§ 7 Abs. 3 CO2KostAufG).'])
})

test('Kein Block ohne Buchung, ohne Angaben oder für einen Mieter ohne Heizkosten; kurze Heizperiode mit Hinweis', () => {
  expect(co2Block(anlage(null), 'ta')).toBeNull()
  expect(co2Block(anlage(bewertung({ booked: false })), 'ta')).toBeNull()
  expect(co2Block(anlage(bewertung()), 'tx')).toBeNull()
  const kurz = co2Block(anlage(bewertung({ shortened: true, deducted: false, method: 'serviceShown' })), 'ta') ?? assert.fail('kein Block')
  expect(kurz.notes).toContain('Die Heizperiode ist kürzer als ein Jahr; die Grenzen der Stufentabelle sind anteilig gekürzt (§ 5 Abs. 1 Satz 4 CO2KostAufG).')
  expect(kurz.lines.at(-1)?.label).toBe('vom Vermieter übernommen (eigene Zeile)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix client test -- co2View`
Expected: FAIL mit `Failed to resolve import "./co2View"`.

- [ ] **Step 3: Implement**

`client/src/co2View.ts`:

```ts
// Der Druckblock „CO₂-Kostenaufteilung“ (Heizung PR 6, Entwurf 9.5). Er ist nicht `no-print`,
// denn er erfüllt § 7 Abs. 3 CO2KostAufG: den Anteil des Mieters, die Einstufung und die
// Berechnungsgrundlagen. Beim Messdienst stehen die Werte laut dessen Abrechnung; die Stufe ordnet
// Mietfuchs nach (Entwurf 9.2).
import { fmtDate, fmtEuro } from './api'
import { ENERGY_OPTIONS } from './heatingForm'
import type { HeatingStatement } from './types'

export type Co2BlockView = { title: string; lines: { label: string; value: string }[]; table: { range: string; percent: string; marked: boolean }[]; notes: string[] }

const num = (n: number, digits = 1): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

// `null`: kein Block, weil nichts gebucht ist (Probe gescheitert, nicht aufgeteilt) oder der Mieter
// in dieser Heizperiode keine Heizkosten hat.
export function co2Block(h: HeatingStatement, tenancyId: string): Co2BlockView | null {
  const c = h.co2
  if (!c || !c.booked) return null
  const tenant = c.tenants.find((t) => t.tenancyId === tenancyId)
  if (!tenant) return null
  const lines: { label: string; value: string }[] = [
    { label: 'Energieträger', value: ENERGY_OPTIONS.find((o) => o.value === h.energy)?.label ?? h.energy },
    { label: 'Heizperiode', value: `${fmtDate(h.from)} – ${fmtDate(h.to)}` },
  ]
  if (c.emissionsKg !== null) lines.push({ label: 'CO₂-Ausstoß', value: `${num(c.emissionsKg)} kg` })
  if (c.areaM2 !== null) lines.push({ label: 'Wohnfläche der Einstufung', value: `${num(c.areaM2, 2)} m²` })
  if (c.kgPerM2 !== null) lines.push({ label: 'CO₂-Ausstoß je m² und Jahr', value: `${num(c.kgPerM2)} kg` })
  if (c.landlordPermille !== null) lines.push({ label: 'Anteil des Vermieters laut Abrechnung', value: `${num(c.landlordPermille / 10)} %` })
  if (c.totalCents !== null) lines.push({ label: 'CO₂-Kosten insgesamt', value: fmtEuro(c.totalCents) })
  if (c.landlordCents !== null) lines.push({ label: 'davon trägt der Vermieter', value: fmtEuro(c.landlordCents) })
  const approx = ' (nach Ihrem Anteil an den Heizkosten)'
  if (tenant.tenantCents !== null) lines.push({ label: 'Ihr Anteil an den CO₂-Kosten', value: `${fmtEuro(tenant.tenantCents)}${approx}` })
  lines.push({
    label: c.deducted ? 'vom Vermieter übernommen (bereits abgezogen)' : 'vom Vermieter übernommen (eigene Zeile)',
    value: `${fmtEuro(tenant.landlordCents)}${tenant.approximated ? approx : ''}`,
  })
  const table = c.table.map((s) => ({
    range: s.to === null ? `ab ${num(s.from)} kg` : `${num(s.from)} bis unter ${num(s.to)} kg`,
    percent: `${s.landlordPercent} %`,
    marked: c.stage !== null && s.from === c.stage.from,
  }))
  const notes = ['Angaben laut Abrechnung des Messdienstes oder der Gemeinschaft (§ 7 Abs. 3 CO2KostAufG).']
  if (c.shortened) notes.push('Die Heizperiode ist kürzer als ein Jahr; die Grenzen der Stufentabelle sind anteilig gekürzt (§ 5 Abs. 1 Satz 4 CO2KostAufG).')
  return { title: 'CO₂-Kostenaufteilung', lines, table, notes }
}
```

`client/src/components/Co2Block.tsx`:

```tsx
// Der Druckblock „CO₂-Kostenaufteilung“ in der Abrechnung eines Mieters (Heizung PR 6, Entwurf 9.5).
// Gedruckt wird er mit, denn er ist der Ausweis nach § 7 Abs. 3 CO2KostAufG.
import type { Co2BlockView } from '../co2View'

export default function Co2Block({ view }: { view: Co2BlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <table>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.label}><td>{l.label}</td><td className="num">{l.value}</td></tr>
          ))}
        </tbody>
      </table>
      <table>
        <thead>
          <tr><th>CO₂-Ausstoß je m² und Jahr</th><th className="num">Anteil Vermieter</th></tr>
        </thead>
        <tbody>
          {view.table.map((s) => (
            <tr key={s.range}><td>{s.marked ? <strong>{s.range} ◀</strong> : s.range}</td><td className="num">{s.marked ? <strong>{s.percent}</strong> : s.percent}</td></tr>
          ))}
        </tbody>
      </table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
```

`client/src/pages/Abrechnung.tsx`: Importe `import Co2Block from '../components/Co2Block'` und
`import { co2Block } from '../co2View'`. In der Karte jedes Mieters direkt hinter dem Ausdruck
`{st.rows.length === 0 ? ( … ) : ( <Table …> … </Table> )}`:

```tsx
              {(data.heating ?? []).map((h) => <Co2Block key={`${h.plantId}:${h.period}`} view={co2Block(h, st.tenancyId)} />)}
```

- [ ] **Step 4: Zeilen ohne Position prüfen**

Eine Abzugszeile trägt die Kennung `co2:<Anlage>:<Heizperiode>` und keine Kostenposition (Entwurf
5.7). Geprüft, kein Code nötig:

Run: `grep -n "costItemId" client/src/pages/Abrechnung.tsx client/src/tenantFolder.ts`
Expected: `Abrechnung.tsx` sucht Belege mit `costItems.find((c) => c.id === r.costItemId)?.invoiceFile`
und filtert, was fehlt; `CalcSteps key={r.costItemId}` ist je Mieter eindeutig, denn je Anlage und
Heizperiode gibt es höchstens eine Abzugszeile. `tenantFolder.ts` nimmt in `planTenantFolder` nur
Kennungen, die es in `items` gibt (`byId.get(id)` und `continue`). Zeigt `grep` eine weitere Stelle,
die zu einer `costItemId` eine Position verlangt, bekommt sie einen Test mit einer Zeile
`kind: 'co2Relief'` und die Abfrage `if (r.kind) continue` vor dem Zugriff.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix client test -- co2View && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/co2View.ts client/src/co2View.test.ts client/src/components/Co2Block.tsx client/src/pages/Abrechnung.tsx
git commit -m "Abrechnung: Druckblock CO₂-Kostenaufteilung mit Einstufung und Grundlagen

Der Ausweis nach § 7 Abs. 3 CO2KostAufG wird mitgedruckt.

Refs #97"
```

---

### Task 13: Anleitungen: Messdienst (#216) passend zu Text und Probe, CO₂-Kosten aufteilen

Die Anleitung `meteringService` (PR 0, #216) sagte bisher, den CO₂-Anteil der eigenen Wohnung in deren
Eigenbetrag zu schreiben. Mit der Karte „CO₂-Kosten“ wäre er dann doppelt privat, und die Probe meldet
genau das (Task 7). Die Anleitung sagt jetzt: Eigenbetrag wie in der Abrechnung, der CO₂-Teil der
eigenen Wohnung in die Karte. Dazu die neue Anleitung „CO₂-Kosten der Heizung aufteilen“ (Entwurf
11.4) mit dem Ort von S je Messdienst (7.3, R6). Die erlaubte Stelle „3 Prozent“ im Wächter entfällt.

Musterabrechnungen: Für Techem liegt das Muster vor („Summe der Nutzerkosten Heizungsanlage“). Für
ista, Brunata, Minol und KALO liegt Mietfuchs kein Muster vor; der Entwurf (7.3) sagt dann: „fehlt
eines, nennt die Anleitung den Messdienst ohne Muster.“ So steht es unten. Wer eines der vier Muster
beschafft, ergänzt den Ort der Zeile mit einer eigenen Änderung.

**Files:**
- Modify: `shared/guides.ts`, `server/test/guides.test.ts`, `server/test/law-literals.test.ts`

**Interfaces:**
- Consumes (Task 1, 2, 7, 11): `co2CutMissing`, `co2FirstPeriodStart`, `germanDate`; Beschriftungen „CO₂-Kosten“, „Ich finde diese Zeile nicht“, „davon für Ihre Wohnung“, „Probe“, „Abzugszeile“-Antworten, „CO₂-Anteil des Vermieters“, „CO₂-Kosten: Anteil des Vermieters“, „CO₂-Kostenaufteilung“; `computeSettlement`, `taxReport`, `snapshotOf`.
- Produces: `GuideId` + `'co2Costs'`.

- [ ] **Step 1: Write the failing tests**

In `server/test/guides.test.ts`:

(a) Importe ergänzen: `type SnapshotHeatingPlant` aus `'../src/snapshot.ts'`, `import { calendarPeriod } from '../../shared/period.ts'` (falls noch nicht da), `import type { Co2Statement } from '../../shared/types.ts'`.

(b) Im ersten Test die erwartete Liste der Kennungen um `'co2Costs'` direkt hinter `'meteringService'` ergänzen.

(c) Hinter den Helfern `landlordParts` und `inOrder`:

```ts
// Eine Gasheizung beim Messdienst und ihre CO₂-Angaben (Heizung PR 6).
const HP: SnapshotHeatingPlant = { id: 'hp', name: '', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null }
const co2Statement = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: calendarPeriod(2025), method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
```

(d) In `checks` den Eintrag `meteringService` ersetzen und `co2Costs` dahinter einfügen:

```ts
  meteringService: () => {
    // Vorwegabzug (#209) mit der Karte „CO₂-Kosten“ (Heizung PR 6): Der Betrag ist, was bezahlt
    // wurde; Einzel- und Eigenbeträge stehen wie in der Abrechnung; den CO₂-Anteil des Vermieters
    // zerlegt Mietfuchs aus den CO₂-Angaben.
    const net = { ta: 120000, tb: 110000, c: 60000 }
    const co2 = 10000
    const sumNet = net.ta + net.tb + net.c
    const gross = sumNet + co2
    const src = source({
      units: [rented('a', 70), rented('b', 60), own('c', 90)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
      costItems: [item('heiz', {
        category: 'Heizung und Warmwasser', amountCents: gross, key: 'amounts', tenancyAmounts: { ta: net.ta, tb: net.tb }, selfAmounts: { c: net.c }, heatingPlantId: 'hp',
      })],
    })
    const snap = { ...snapshotOf(src, 2025), heatingPlants: [HP], co2Statements: [co2Statement({ serviceUsersTotalCents: sumNet, serviceLandlordCents: co2, serviceUnitsCount: 3 })] }
    const r = computeSettlement(snap)
    const tax = taxReport(snap).expenses.items.find((x) => x.costItemId === 'heiz')
    if (!tax) return assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.equal(share(r, 'ta', 'heiz'), net.ta)
    assert.equal(share(r, 'tb', 'heiz'), net.tb)
    assert.ok(!r.notices.some((n) => n.code === 'co2.sum-check'), 'die Probe geht auf')
    const ownCo2 = Math.round((co2 * net.c) / sumNet)
    assert.equal(r.selfUsedShareCents, net.c + ownCo2)
    assert.equal(tax.privateCents, net.c + ownCo2)
    const parts = landlordParts(r, 'heiz')
    assert.deepEqual(parts.map((p) => p.reason), ['selfUse', 'co2Share'])
    const co2Share = parts.find((p) => p.reason === 'co2Share')?.cents ?? -1
    assert.equal(co2Share, co2 - ownCo2)
    // Wer den Anteil seiner Wohnung zusätzlich in den Eigenbetrag schreibt (die frühere Anleitung)
    // oder nur die Summe der Nutzerbeträge als Betrag (#209), dem meldet es die Probe.
    const mit = (over: Partial<SnapshotCostItem>) => computeSettlement({ ...snap, costItems: snap.costItems.map((c) => ({ ...c, ...over })) })
    assert.ok(mit({ selfAmounts: { c: net.c + ownCo2 } }).notices.some((n) => n.code === 'co2.sum-check'), 'doppelt privat')
    assert.ok(mit({ amountCents: sumNet }).notices.some((n) => n.code === 'co2.sum-check'), 'netto statt bezahlt')
    inOrder(GUIDES.meteringService.example, [
      eur(net.ta), eur(net.tb), eur(net.c), eur(sumNet), eur(co2), eur(gross),
      eur(share(r, 'ta', 'heiz')), eur(share(r, 'tb', 'heiz')), eur(net.c), eur(sumNet), eur(co2), eur(gross),
      eur(ownCo2), eur(r.selfUsedShareCents), eur(co2Share),
    ], 'meteringService')
  },
  co2Costs: () => {
    // Beispiel A (Techem-Muster, Entwurf 7.4).
    const betraege = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
    const S = 384551
    const L = 8750
    const src = source({
      units: ['a', 'b', 'c', 'd'].map((u) => rented(u, 50)),
      tenancies: ['a', 'b', 'c', 'd'].map((u) => tenancy(`t${u}`, u)),
      costItems: [item('heiz', { category: 'Heizung und Warmwasser', amountCents: S + L, key: 'amounts', tenancyAmounts: betraege, heatingPlantId: 'hp' })],
    })
    const snap = { ...snapshotOf(src, 2025), heatingPlants: [HP], co2Statements: [co2Statement({ serviceUsersTotalCents: S, serviceLandlordCents: L, serviceUnitsCount: 4 })] }
    const r = computeSettlement(snap)
    for (const [t, c] of Object.entries(betraege)) assert.equal(share(r, t, 'heiz'), c)
    assert.deepEqual(landlordParts(r, 'heiz'), [{ reason: 'co2Share', cents: L }])
    const tax = taxReport(snap).expenses.items.find((x) => x.costItemId === 'heiz')
    if (!tax) return assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.equal(tax.deductibleCents, S + L)
    inOrder(GUIDES.co2Costs.example, ['3.540,00 €', eur(L), eur(S), eur(S), eur(L), eur(S), eur(L), eur(S + L), eur(L), eur(S + L)], 'co2Costs')
  },
```

(`SnapshotCostItem` in den Typimport aus `'../src/snapshot.ts'` aufnehmen.)

(e) Im Test „Durchsicht: CO₂-Kosten mit belegter Norm beim Mehrfamilienhaus und beim Messdienst“
den Kommentar und die letzte Zusicherung ersetzen:

```ts
  // Beim Mehrfamilienhaus ohne Messdienst rechnet Mietfuchs die Aufteilung noch nicht selbst (#97);
  // beim Messdienst übernimmt die Karte „CO₂-Kosten“ dessen Angaben. Die eigene Aufteilung bleibt eine
  // Lücke mit Issue.
  assert.match(GUIDES.multiFamily.caveats.find((x) => /CO₂/.test(x.text))?.text ?? '', /#97/)
  assert.ok(GUIDES.meteringService.gaps.some((g) => g.issue === 97 && /selbst/.test(g.text)), 'die eigene Aufteilung bleibt eine Lücke')
```

(f) Im Test „Messdienst mit Vorwegabzug (#209) …“ die drei Zusicherungen zu Schritt 3 ersetzen:

```ts
  // Schritt 3: Eigenbetrag wie in der Abrechnung; der CO₂-Teil der eigenen Wohnung in die Karte.
  assert.match(own ?? '', /ohne etwas dazuzurechnen/)
  assert.match(own ?? '', /„davon für Ihre Wohnung“/)
  assert.match(own ?? '', /Steht auf der Einzelabrechnung Ihrer Wohnung ein vom Vermieter übernommener CO₂-Betrag, nehmen Sie diesen\./)
  assert.match(own ?? '', /tragen Sie 0 ein; dann gehört nichts davon ins Private\./)
  assert.match(own ?? '', /Nur wenn sie gar keine Beträge je Wohnung nennt, lassen Sie das Feld leer, und Mietfuchs rechnet näherungsweise: CO₂-Anteil × Betrag Ihrer Wohnung ÷ Summe aller Nutzerbeträge für Heizung und Warmwasser\./)
```

Die Zeilen zu `Nur wenn er fehlt`, zur Reihenfolge `['Einzelabrechnung', 'ins Private',
'näherungsweise']` und zum Ergebnis (`/CO₂-Anteil des Vermieters[^.]*Werbungskosten/`) bleiben.

(g) Ans Ende:

```ts
test('CO₂-Kosten aufteilen (Heizung PR 6): Ort von S je Messdienst, Muster nur bei Techem, keine Annahme je Messdienst (Entwurf 7.2, 7.3)', () => {
  const g = GUIDES.co2Costs
  const hinweise = g.caveats.map((c) => c.text).join(' ')
  assert.match(hinweise, /Bei Techem heißt die Zeile „Summe der Nutzerkosten Heizungsanlage“/)
  assert.match(hinweise, /Für ista, Brunata, Minol und KALO liegt Mietfuchs keine Musterabrechnung vor/)
  assert.ok(g.steps.some((s) => s.page === 'heizkosten' && s.text.includes('„Ich finde diese Zeile nicht“')))
  assert.ok(g.caveats.some((c) => /3 Prozent/.test(c.text) && c.norm === '§ 7 Abs. 3 und 4 CO2KostAufG'))
  assert.match(g.applies, /01\.01\.2023/)
  for (const n of [97, 210, 103]) assert.ok(g.gaps.some((x) => x.issue === n), `#${n} fehlt`)
})
```

In `server/test/law-literals.test.ts` aus `ALLOWED` die Zeile mit `file: 'shared/guides.ts', match:
'3 Prozent'` entfernen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/guides.test.ts test/law-literals.test.ts`
Expected: FAIL. `GUIDES.co2Costs` fehlt (Liste der Kennungen, `checks.co2Costs`); die Beispielrechnung
von `meteringService` findet die Beträge nicht in der neuen Reihenfolge; `law-literals.test.ts` meldet
„Rechtszahl als Literal … shared/guides.ts … „3 Prozent““, denn die erlaubte Stelle ist entfernt und
der Text liest das Register noch nicht.

- [ ] **Step 3: Anleitungen (`shared/guides.ts`)**

Importe ergänzen:

```ts
import { co2CutMissing, co2FirstPeriodStart } from './law/co2kostaufg.ts'
```

und aus `'./law/register.ts'` zusätzlich `germanDate`. Unter `const CUT = …`:

```ts
// Heizung PR 6: die Kürzung bei fehlender CO₂-Aufteilung (§ 7 Abs. 4 CO2KostAufG) und der Beginn der
// Aufteilung (§ 11 Abs. 2 Satz 1) aus dem Register.
const CO2_CUT = valueAt(co2CutMissing, LAW_AS_OF)
const CO2_FROM = germanDate(co2FirstPeriodStart())
```

Den Kommentar „Die CO₂-Kürzung von 3 Prozent folgt mit PR 6 …“ oben in der Datei streichen.

In `multiFamily` im Hinweis zu den CO₂-Kosten `um 3 Prozent kürzen` durch `um ${CO2_CUT} Prozent
kürzen` ersetzen (der Text wird dafür ein Template-Literal) und den Satz `Mietfuchs rechnet das noch
nicht (#97); nehmen Sie den Vermieteranteil aus der Abrechnung des Messdienstes.` durch `Selbst rechnet
Mietfuchs die Aufteilung noch nicht (#97); rechnet ein Messdienst ab, übernehmen Sie seine Angaben auf
der Seite Heizkosten.` ersetzen.

`meteringService` ganz ersetzen:

```ts
  meteringService: {
    title: 'Fertige Abrechnung eines Messdienstes übernehmen',
    applies: 'Ein Messdienst wie Techem, ista, Brunata oder Minol rechnet Heizung und Warmwasser ab und nennt für jede Wohnung oder jeden Nutzer einen Betrag.',
    steps: [
      { page: 'kosten', text: 'Legen Sie mit „+ Kostenposition manuell erfassen“ eine Position mit der Kostenart „Heizung und Warmwasser“ an. Unter „Betrag €“ tragen Sie ein, was Sie für Heizung und Warmwasser bezahlt haben, also die Kosten vor dem Abzug des CO₂-Anteils, den Sie als Vermieter tragen. Viele Messdienste ziehen diesen Anteil schon in der Kostenaufstellung ab; dann ist ihre Summe um ihn zu niedrig, und Sie rechnen: Summe aller Nutzerbeträge für Heizung und Warmwasser (einschließlich Leerstand) + CO₂-Anteil des Vermieters.' },
      { page: 'kosten', text: 'Wählen Sie den Umlageschlüssel „Einzelbeträge je Mieter (z. B. Messdienst)“ und füllen Sie bei jedem Mietverhältnis das Feld für Heizung und Warmwasser aus. Tragen Sie den Betrag ein, den der Mieter zahlen soll, also nach Abzug des CO₂-Anteils des Vermieters. Ist ein Mieter im Jahr ausgezogen, bekommen alter und neuer Mieter je ihren Betrag. Rechnet der Messdienst auch Kaltwasser oder weitere Nebenkosten ab, erfassen Sie diese als eigene Positionen mit ihrer Kostenart und ihren Einzelbeträgen.' },
      { page: 'kosten', text: 'Bewohnen Sie selbst eine Wohnung, tragen Sie in deren Feld den Betrag ein, den die Abrechnung für Ihre Wohnung nennt, ohne etwas dazuzurechnen. Den Teil des CO₂-Anteils, der auf Ihre Wohnung entfällt, tragen Sie auf der Seite Heizkosten in der Karte „CO₂-Kosten“ unter „davon für Ihre Wohnung“ ein: Steht auf der Einzelabrechnung Ihrer Wohnung ein vom Vermieter übernommener CO₂-Betrag, nehmen Sie diesen. Nennt die Abrechnung solche Beträge bei den Mietern, aber nicht bei Ihrer Wohnung, tragen Sie 0 ein; dann gehört nichts davon ins Private. Nur wenn sie gar keine Beträge je Wohnung nennt, lassen Sie das Feld leer, und Mietfuchs rechnet näherungsweise: CO₂-Anteil × Betrag Ihrer Wohnung ÷ Summe aller Nutzerbeträge für Heizung und Warmwasser.' },
      { page: 'kosten', text: 'Nennt die Abrechnung Arbeitskosten, tragen Sie sie unter „§35a-Lohn“ ein. Die Abrechnung selbst hängen Sie unter „Beleg (Rechnungskopie)“ an.' },
      { page: 'heizkosten', text: `Für Abrechnungszeiträume, die am oder nach dem ${CO2_FROM} beginnen, öffnen Sie die Seite Heizkosten und füllen die Karte „CO₂-Kosten“ aus: die Antwort auf die Frage nach der Abzugszeile, die Summe der Kosten aller Nutzer und die Zahlen der CO₂-Seite der Abrechnung. Die Zeile „Probe“ zeigt, ob der Betrag Ihrer Position dazu passt. Die Seite erscheint, sobald unter Stammdaten eine Heizanlage eingerichtet ist.` },
      { page: 'abrechnung', text: 'Prüfen Sie in der Abrechnung, ob für jeden Mieter ein Betrag eingetragen ist.' },
    ],
    result: [
      'Jeder Mieter trägt genau seinen Betrag, ohne Tagesanteil; bei einem Wechsel teilt der Messdienst selbst auf.',
      'Mit den CO₂-Angaben prüft Mietfuchs, ob der Betrag der Position zur Abrechnung passt. Beim Vorwegabzug steht der CO₂-Anteil des Vermieters für die vermieteten Wohnungen mit dem Grund „CO₂-Anteil des Vermieters“ beim Vermieter und in der Steuerübersicht als Werbungskosten; der Teil, der auf Ihre selbstgenutzte Wohnung entfällt, gehört zu Ihrem Eigenanteil und ist privat.',
      'Weist der Messdienst die CO₂-Kosten nur aus, ohne sie abzuziehen, bekommt jeder Mieter eine eigene Zeile „CO₂-Kosten: Anteil des Vermieters“.',
      'Fehlt für einen Mieter ein Betrag, sagt die Abrechnung es. Mehr als der Rechnungsbetrag lässt sich nicht verteilen, und eine Gutschrift nicht nach Einzelbeträgen.',
      'Für die Prüfung nach der Heizkostenverordnung zählen Einzelbeträge als Verteilung nach Verbrauch.',
    ],
    example: 'Die Heizkostenabrechnung nennt 1.200 € für Wohnung A, 1.100 € für Wohnung B und 600 € für Ihre eigene Wohnung, zusammen 2.900 €. Vorher abgezogen hat der Messdienst unter „abzüglich CO₂-Kosten Vermieter“ 100 €, die Sie als Vermieter tragen. Bezahlt haben Sie also 3.000 €, und das ist der Betrag der Position. Die Mieter tragen 1.200 € und 1.100 €; in das Feld Ihrer Wohnung kommen 600 €. In der Karte „CO₂-Kosten“ tragen Sie 2.900 € als Summe der Kosten aller Nutzer und 100 € als CO₂-Anteil des Vermieters ein; die Probe erwartet 3.000 € und findet sie. Die Einzelabrechnung Ihrer Wohnung nennt 20,69 € als vom Vermieter übernommen (die Näherung 100 × 600 ÷ 2.900 ergäbe dasselbe); Ihr Eigenanteil ist damit 620,69 €. Die übrigen 79,31 € stehen als CO₂-Anteil des Vermieters in der Steuerübersicht als Werbungskosten. Mit 2.900 € als Betrag fehlten sie dort.',
    caveats: [
      { text: `Bei einer Zentralheizung sind mindestens ${SHARE.min} und höchstens ${SHARE.max} Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um ${CUT} Prozent kürzen.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
      { text: 'Beim Mieterwechsel muss eine Zwischenablesung stattfinden; melden Sie dem Messdienst den Auszug rechtzeitig.', norm: '§ 9b HeizkostenV' },
      { text: `Fallen für die Heizung CO₂-Kosten an, sind sie zwischen Ihnen und dem Mieter nach dem CO₂-Ausstoß des Gebäudes aufzuteilen. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} Prozent kürzen. Die großen Messdienste teilen auf, wenn Sie ihnen die CO₂-Angaben Ihrer Brennstoffrechnung melden, und weisen die Angaben in ihrer Abrechnung aus; legen Sie sie dem Mieter mit Ihrer Abrechnung bei.`, norm: '§ 5 Abs. 2, § 7 Abs. 3 und 4 CO2KostAufG' },
      { text: 'Weist die Abrechnung keinen CO₂-Anteil des Vermieters aus, fragen Sie beim Messdienst nach, bevor Sie abrechnen; selbst rechnet Mietfuchs die Aufteilung noch nicht (#97).' },
      { text: 'Nicht jeder Messdienst setzt für eine selbstgenutzte Wohnung einen vom Vermieter übernommenen CO₂-Anteil an. Sehen Sie deshalb in die Einzelabrechnung Ihrer Wohnung, bevor Sie in der Karte „CO₂-Kosten“ etwas eintragen (Schritt 3).' },
      { text: 'Wo in der Abrechnung die Summe der Kosten aller Nutzer steht, beschreibt die Anleitung zum Aufteilen der CO₂-Kosten.' },
    ],
    gaps: [
      { text: 'Die Abrechnung des Messdienstes per KI auslesen und den Mietverhältnissen zuordnen; heute tragen Sie die Beträge von Hand ein.', issue: 103 },
      { text: 'Die CO₂-Kosten selbst aus der Brennstoffrechnung aufteilen, wenn der Messdienst es nicht tut.', issue: 97 },
      { text: 'Die Heizkosten ohne Messdienst selbst nach der Heizkostenverordnung abrechnen.', issue: 99 },
    ],
    terms: ['individualAmounts', 'heatingCostOrdinance', 'ownShare', 'labor35a', 'co2Deducted'],
  },
  co2Costs: {
    title: 'CO₂-Kosten der Heizung aufteilen',
    applies: `Sie heizen mit Gas, Heizöl, Flüssiggas oder Kohle, oder Ihr Wärmelieferant weist CO₂-Kosten aus, und ein Messdienst oder die Hausverwaltung erstellt die Heizkostenabrechnung. Für Abrechnungszeiträume, die am oder nach dem ${CO2_FROM} beginnen, sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen.`,
    steps: [
      { page: 'stammdaten', text: 'Richten Sie in der Karte „Heizung“ die Heizanlage ein, falls noch nicht geschehen: den Energieträger und bei der Frage, wer abrechnet, „Ein Messdienst oder die Hausverwaltung“.' },
      { page: 'kosten', text: 'Erfassen Sie die Abrechnung des Messdienstes wie in der Anleitung zur fertigen Abrechnung eines Messdienstes: als Betrag die Summe der Kosten aller Nutzer plus den CO₂-Anteil des Vermieters, als Einzelbeträge die Beträge der Mieter wie in der Abrechnung.' },
      { page: 'heizkosten', text: 'Öffnen Sie die Seite Heizkosten und beantworten Sie in der Karte „CO₂-Kosten“ die Frage nach der Abzugszeile. Darunter steht eine Beispielzeile, an der Sie die Zeile erkennen.' },
      { page: 'heizkosten', text: 'Tragen Sie die Summe der Kosten aller Nutzer für Heizung und Warmwasser ein, so wie sie gedruckt ist. Finden Sie diese Zeile nicht, setzen Sie den Haken „Ich finde diese Zeile nicht“ und tragen die Beträge der leeren oder nicht eingetragenen Einheiten ein; dann rechnet Mietfuchs die Summe aus den Einzelbeträgen.' },
      { page: 'heizkosten', text: 'Übertragen Sie von der CO₂-Seite der Abrechnung den Ausstoß je Quadratmeter, den Anteil des Vermieters in Prozent, die CO₂-Kosten insgesamt und den Anteil des Vermieters in Euro. Die Zeile „Probe“ zeigt, ob der Betrag Ihrer Position dazu passt.' },
      { page: 'heizkosten', text: 'Nennt die Abrechnung je Mieter einen Betrag „vom Vermieter übernommen“, tragen Sie ihn beim Mieter ein; sonst rechnet Mietfuchs ihn nach dem Anteil an den Heizkosten.' },
    ],
    result: [
      'Bei einer Abzugszeile bleibt jeder Mieter bei seinem Betrag; der CO₂-Anteil des Vermieters steht beim Vermieter mit dem Grund „CO₂-Anteil des Vermieters“ und in der Steuerübersicht als Werbungskosten, der Teil Ihrer eigenen Wohnung im Eigenanteil.',
      'Ohne Abzugszeile bekommt jeder Mieter eine eigene Zeile „CO₂-Kosten: Anteil des Vermieters“ mit seinem Abzug.',
      `Geht die Probe nicht auf, bucht Mietfuchs nichts und nennt die Kürzung von ${CO2_CUT} % je Mieter; ebenso, wenn der Messdienst gar nicht aufgeteilt hat.`,
      'Die Abrechnung jedes Mieters enthält den Block „CO₂-Kostenaufteilung“ mit Einstufung und Grundlagen.',
    ],
    example: 'Die Kostenaufstellung eines Messdienstes nennt „Anlieferung Brennstoff“ 3.540,00 €, darunter „Abzüglich CO₂-Kosten Vermieter“ 87,50 €; die Kosten aller Nutzer ergeben 3.845,51 €. Sie beantworten die Frage nach der Abzugszeile mit „Ja“ und tragen 3.845,51 € und 87,50 € ein. Der Betrag Ihrer Position ist 3.845,51 € + 87,50 € = 3.933,01 €, und die Probe geht auf. Die Mieter tragen ihre Beträge unverändert; die 87,50 € stehen beim Vermieter als CO₂-Anteil, und in der Steuerübersicht stehen 3.933,01 € als Werbungskosten.',
    caveats: [
      { text: `Fehlt die Aufteilung oder der Ausweis der CO₂-Kosten in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} Prozent kürzen.`, norm: '§ 7 Abs. 3 und 4 CO2KostAufG' },
      { text: 'Wo die Summe der Kosten aller Nutzer steht, ist je Messdienst verschieden. Bei Techem heißt die Zeile „Summe der Nutzerkosten Heizungsanlage“. Für ista, Brunata, Minol und KALO liegt Mietfuchs keine Musterabrechnung vor; suchen Sie die gedruckte Summe der Kosten aller Nutzer für Heizung und Warmwasser, bei einer Abzugszeile die Summe nach dem Abzug.' },
      { text: 'Ob ein Messdienst den Anteil des Vermieters vorab abzieht, ist nicht bei allen Messdiensten gleich; deshalb fragt Mietfuchs danach, statt es je Messdienst anzunehmen.' },
      { text: 'Ist ein Abrechnungszeitraum von unter einem Jahr vereinbart, werden die Grenzen der Stufentabelle anteilig gekürzt.', norm: '§ 5 Abs. 1 Satz 4 CO2KostAufG' },
    ],
    gaps: [
      { text: 'Die CO₂-Kosten selbst aus der Brennstoffrechnung aufteilen, auch ohne Messdienst.', issue: 97 },
      { text: 'Die CO₂-Angaben für den Messdienst ausdrucken.', issue: 210 },
      { text: 'Die Abrechnung des Messdienstes per KI auslesen.', issue: 103 },
    ],
    terms: ['co2Split', 'co2Stage', 'co2Deducted', 'co2Area'],
  },
```

Der Test „jede zitierte Beschriftung steht so in der Oberfläche“ prüft die Zitate in Schritten und
Ergebnis: „CO₂-Kosten“, „davon für Ihre Wohnung“, „Ich finde diese Zeile nicht“ und „Probe“ stehen in
`Co2Card.tsx`, „CO₂-Anteil des Vermieters“ in `landlordReasons.ts`, „CO₂-Kosten: Anteil des Vermieters“
in `shared/co2Probe.ts`, „CO₂-Kostenaufteilung“ in `co2View.ts`, „Heizung“ und „Ein Messdienst oder die
Hausverwaltung“ in der Karte der Heizanlage (PR 4). Fehlt eines, nennt der Test es; dann den Text der
Anleitung an die Oberfläche angleichen, nicht umgekehrt.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/guides.test.ts test/law-literals.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/guides.ts server/test/guides.test.ts server/test/law-literals.test.ts
git commit -m "Anleitungen: Messdienst passend zur Karte CO₂-Kosten und zur Probe, neue Anleitung CO₂-Kosten aufteilen

Der CO₂-Anteil der eigenen Wohnung gehört nicht mehr in den Eigenbetrag, sondern in die Karte;
sonst meldet die Probe ihn als doppelt. Die 3 % kommen aus dem Rechtsregister.

Refs #97, #209"
```

---

### Task 14: Smoke-Test, CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks.
- Produces: Prüfung der Programmdateien mit CO₂-Angaben (Entwurf 12.4), CHANGELOG mit Ankündigung (10.1), Architekturabschnitt.

- [ ] **Step 1: Smoke-Test (`scripts/smoke-test.mjs`)**

Hinter `heatingPlant` (PR 4):

```js
// CO₂ beim Messdienst (Heizung PR 6): ohne Angaben nennt die Abrechnung die Kürzung, mit Vorwegabzug
// bucht sie den CO₂-Anteil des Vermieters. Das Objekt der Prüfung rechnet im Kalenderjahr.
async function co2Statement() {
  const [anlage] = (await request('/api/heating-plants')).body
  const [mieter] = (await request('/api/tenancies')).body
  const posten = await request('/api/costItems', json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
  }))
  assert(posten.body.heatingPlantId === anlage?.id, 'die Messdienstposition gehört zur Heizanlage', posten.body)
  const ohne = (await request('/api/settlement/2025')).body
  assert(ohne.notices?.some((n) => n.code === 'co2.missing'), 'ohne CO₂-Angaben nennt die Abrechnung die Kürzung', ohne.notices)
  const gespeichert = await request(`/api/heating-plants/${anlage.id}/periods/2025-01/co2`, json('PUT', {
    method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1,
  }))
  assert(gespeichert.status === 200 && gespeichert.body.method === 'serviceDeducted', 'CO₂-Angaben speichern', gespeichert.body)
  const mit = (await request('/api/settlement/2025')).body
  const anteil = mit.landlord?.rows?.find((r) => r.costItemId === posten.body.id)?.landlordParts?.find((p) => p.reason === 'co2Share')?.cents
  assert(anteil === 500 && mit.heating?.[0]?.co2?.booked === true, 'die Abrechnung bucht den CO₂-Anteil des Vermieters', { anteil, heating: mit.heating })
}
```

In `backupAndRestore` hinter der Zusicherung „die Heizanlage ist nach der Wiederherstellung da“ (PR 4):

```js
  const perioden = (await request(`/api/heating-plants/${anlagen[0].id}/periods?period=2025`)).body
  assert(perioden?.[0]?.co2?.method === 'serviceDeducted', 'die CO₂-Angaben sind nach der Wiederherstellung da', perioden)
```

In `main` hinter `await heatingPlant()`:

```js
  await co2Statement()
```

Der Entwurf (12.4) nennt „Abrechnung `2025-05` lesen“; das Objekt des Smoke-Tests rechnet im
Kalenderjahr, deshalb `2025`. Den Zeitraum Mai bis April prüfen F12 und `api.test.ts`.

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

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ die Messdienstposition gehört zur
Heizanlage“, „✓ ohne CO₂-Angaben nennt die Abrechnung die Kürzung“, „✓ CO₂-Angaben speichern“, „✓ die
Abrechnung bucht den CO₂-Anteil des Vermieters“ und „✓ die CO₂-Angaben sind nach der Wiederherstellung
da“. `$D` ist ein Wegwerf-Ordner, `CI=1` verhindert das Browserfenster, `NKA_UPDATE_URL` zeigt auf einen
geschlossenen Port.

- [ ] **Step 3: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]` (neben den Einträgen von PR 1 bis PR 5):

```md
### Hinzugefügt

- **CO₂-Kosten beim Messdienst und bei der Eigentümergemeinschaft.** Auf der neuen Seite
  „Heizkosten“ (sichtbar ab einer Heizanlage) tragen Sie die CO₂-Angaben der Heizkostenabrechnung
  ein: ob es eine Zeile „Abzüglich CO₂-Kosten Vermieter“ gibt, die Summe der Kosten aller Nutzer und
  die Zahlen der CO₂-Seite. Eine Probe zeigt, ob der Betrag Ihrer Position dazu passt. Beim
  Vorwegabzug steht der CO₂-Anteil des Vermieters als eigener Grund beim Vermieter und in der
  Steuerübersicht als Werbungskosten, der Teil Ihrer eigenen Wohnung im Eigenanteil; weist der
  Messdienst die CO₂-Kosten nur aus, bekommt jeder Mieter eine eigene Abzugszeile. Die Abrechnung
  druckt die Einstufung und die Grundlagen mit (§ 7 Abs. 3 CO2KostAufG)
  ([#97](https://github.com/speedone/mietfuchs/issues/97), [#209](https://github.com/speedone/mietfuchs/issues/209)).
- **Warmwasser laut Messdienst.** Hat der Messdienst die Wärme für das Warmwasser mit einer Formel
  bestimmt, ohne dass das Messen unzumutbar wäre, nennt die Abrechnung die Kürzung von 15 % je Mieter
  auf seine Heiz- und Warmwasserkosten (§ 9 Abs. 2 HeizkostenV, BGH VIII ZR 151/20)
  ([#211](https://github.com/speedone/mietfuchs/issues/211)).
- Anleitung „CO₂-Kosten der Heizung aufteilen“ und Lexikon-Einträge zur CO₂-Aufteilung, Einstufung,
  Fläche, Abzugszeile und zum Warmwasseranteil.

### Geändert

- **Angekündigt: Hinweis zu den CO₂-Kosten bei Heizpositionen ab 2023.** Für Abrechnungszeiträume, die
  am oder nach dem 01.01.2023 beginnen, sagt die Abrechnung bei Positionen „Heizung und Warmwasser“,
  ob die CO₂-Kosten aufzuteilen sind, und nennt die Kürzung von 3 % je Mieter, wenn die Aufteilung
  fehlt. Ohne Heizanlage ist das ein Hinweis mit dem Knopf „Heizung einrichten →“, mit einer Gas-,
  Öl-, Flüssiggas- oder Kohleheizung ohne CO₂-Angaben eine Warnung; beide färben die Ampel im Cockpit.
  Keine Zahl ändert sich ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Anleitung „Fertige Abrechnung eines Messdienstes übernehmen“:** Der Betrag Ihrer selbstgenutzten
  Wohnung steht wie in der Abrechnung; den CO₂-Teil Ihrer Wohnung tragen Sie in der Karte „CO₂-Kosten“
  ein. Wer ihn nach der bisherigen Anleitung in den Eigenbetrag geschrieben hat, dem meldet die Probe
  das ([#209](https://github.com/speedone/mietfuchs/issues/209)).
- Eine Heizanlage mit erfassten CO₂-Angaben lässt sich erst entfernen, wenn die Angaben entfernt sind.
```

- [ ] **Step 4: CLAUDE.md**

Im Abschnitt „Architektur“ direkt hinter dem Absatz **Heizanlage** (PR 4) einfügen:

```md
**CO₂ beim Messdienst** (Heizung PR 6, #97, #209, #211): Die CO₂-Angaben einer Heizperiode stehen in
`co2_statements` (eine Zeile je Zeile in `heating_periods`), die Beträge „vom Vermieter übernommen“ je
Mietverhältnis in `co2_tenant_reliefs`. Lesen und Schreiben in
[server/src/db/co2.ts](server/src/db/co2.ts), gerechnet in [server/src/co2.ts](server/src/co2.ts) und im
CO₂-Block von `computeSettlement`; die Probe in [shared/co2Probe.ts](shared/co2Probe.ts), weil die
Oberfläche sie live zeigt.

- **Die Methode ist eine Antwort, keine Vorgabe** (Entwurf 7.2): `serviceDeducted` (Abzugszeile),
  `serviceShown` (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt); `self` kommt mit PR 7 und
  wird bis dahin abgelehnt, ebenso CO₂-Angaben an einer Anlage mit freien Schlüsseln.
- **S ist die gedruckte Kostensumme** (G-B3), nicht die Summe der gerundeten Nutzerzeilen. Die Probe
  läuft nur über die Messdienstpositionen (Schlüssel `amounts`, W9): Vorwegabzug Σ = S + L ± 1 ct, nur
  ausgewiesen Σ = S, beide Einzel- und Eigenbeträge ≤ S + NE · 2 ct. Scheitert sie, wird **nichts**
  gebucht (`co2.sum-check`, error); mit „Ich finde diese Zeile nicht“ ist S geschätzt, und es bleibt
  ein Hinweis.
- **Vorwegabzug:** In der Position, in der L steckt (`carrierId`: die gewählte, sonst die größte),
  steht L_self exakt in `selfUse` (#203: nie über `take()`), der Rest von L als eigener Grund
  `co2Share` direkt dahinter, durch den Rest begrenzt. Die Mieter zahlen ihre Einzelbeträge
  unverändert. Damit ist #209 behoben: Werbungskosten sind das Bezahlte, L_self privat.
- **Nur ausgewiesen:** Zeilen `kind: 'co2Relief'` ohne Kostenposition (`costItemId` =
  `co2:<Anlage>:<Heizperiode>`), je Mieter der Wert laut Messdienst oder L · x / S, als eine Verteilung
  von R = round(Σ r) mit `distributeCents`; der Vermieter trägt R in einer Zeile gleicher Kennung als
  `co2Share`. Σ aller Zeilen bleibt Σ der Positionen.
- **Kürzungen** (6.5) je Mieter auf seine gedruckten Zeilen im Topf nach der Abzugszeile, nie summiert:
  3 % nach § 7 Abs. 4 CO2KostAufG (`co2.missing`, `co2.service-unsplit`, `co2.incomplete`,
  `co2.sum-check`, ohne Anlage `co2.fuel-unknown` und `co2.missing-first-year`), 15 % bei Warmwasser
  nach Formel (`heating.dhw-not-metered`). Alle Rechtswerte aus `shared/law/co2kostaufg.ts`.
- **Nachstufung** (9.2): Mietfuchs ordnet den Wert laut Messdienst in die Stufentabelle ein (gerundet
  auf eine Nachkommastelle, bei kurzer Heizperiode mit gekürzten Grenzen, ein ganzzahlig gedruckter
  Wert als Spanne) und meldet eine Abweichung als Hinweis (`co2.stage-mismatch`); § 8 und § 9 kennt
  die Berechnung erst mit PR 7.
- **Ausweis:** `Settlement.heating` je Anlage und Heizperiode mit `Co2Assessment`; der Druckblock
  „CO₂-Kostenaufteilung“ ([client/src/co2View.ts](client/src/co2View.ts)) ist nicht `no-print`.
- **Oberfläche:** Seite „Heizkosten“, erst ab einer Heizanlage in der Navigation (`navFor`), mit den
  Karten „CO₂-Kosten“ (Logik in [client/src/co2Form.ts](client/src/co2Form.ts)) und „Warmwasser“.
- Eine Anlage mit CO₂-Angaben wird nicht still mitgelöscht (409); Beträge je Mietverhältnis gehören zum
  Objekt der Anlage (`guardTenancy`, `crossPropertyViolations`).
- **Kostenart „Heizung“ ist keine Heizposition.** CO₂-Hinweise erscheinen wie alle Heizregeln nur bei
  der Kostenart „Heizung und Warmwasser“ (`HEATING_CATEGORY`); deshalb bleibt Golden F06 (Kostenart
  „Heizung“) wortgleich, anders als im Entwurf (12.1) angenommen.
```

Im Absatz `**API**` hinter `` `/api/heating-plants` (Heizanlage, siehe dort), `` ergänzen:
`` `/api/heating-plants/:id/periods` (Heizperioden einer Anlage mit CO₂-Angaben und Warmwasser, siehe
CO₂ beim Messdienst), ``.

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden (Wegwerf-Ordner, `CI`,
geschlossener Update-Port). Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement
```

Expected: keine Ausgabe (Golden unverändert, siehe Task 9 Step 6).

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "CO₂ beim Messdienst: Smoke-Test, CHANGELOG mit Ankündigung, Architekturabschnitt

Refs #97, #209, #211"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“). Sie prüft ausdrücklich,
dass die Anleitung `meteringService` (#216) zu Text und Probe passt (Entwurf 13, PR 0), dass die
Schnittstellen aus PR 5 so umgesetzt sind wie im Plan von PR 5, und entscheidet über die Abweichung bei F06. Befunde mit einem vorher
roten Test beheben; PR gestapelt auf PR 5 mit `Refs #97, #209, #211` und den Befunden in der
Beschreibung. Vor PR 7 die Laienprobe der Formulare aus PR 4–6 (Entwurf 11.2, Hinweis 7).

---

## Selbstprüfung

**1. Abdeckung des Entwurfs (Zeile PR 6 in Abschnitt 13 und die genannten Abschnitte):**

| Anforderung | Task |
|---|---|
| `co2_statements`, `co2_tenant_reliefs` (5.1, 5.5) | 2, 5 |
| `serviceDeducted`, `serviceShown`, `selfAfterService` ohne Lieferung (7.2, 7.4–7.6) | 7, 8, 9 |
| S als gedruckte Kostensumme; Rückfall „Zeile nicht gefunden“ mit `co2.sum-check-approx` (7.3, R6) | 4, 7, 11 |
| Musterabrechnungen je Messdienst (7.3, D-R6) | 13 (Techem; übrige ohne Muster, wie der Entwurf es für diesen Fall vorsieht) |
| Probe nur über Messdienstpositionen, Toleranz NE · 2 ct, ± 1 ct (7.3, W9, G-B3) | 4, 7 |
| G/V-Absicherung `co2.probably-deducted` (7.4) | 8 |
| L_self exakt, `co2Share` über `take()` (7.4, G-B2, W10) | 7 |
| Beispiele A, B, C (7.4) | 7, 10 (F15) |
| Gutschrift im Topf, `co2.pool-foreign-item` (W9, 12.2) | 7 |
| Eigentumswohnung brutto mit L (8.9, F2/F3) | 7 |
| Abzug nach Anteil, 232,14 / 139,28 / 92,85 € (9.4, B8, G-B5, R-b), B1 | 4 (Formel und Rechenbeispiele); die Verwendung bei `manual` und `self` kommt mit PR 7 |
| Einzelwerte laut Messdienst geprüft, `co2.reliefs-invalid`, `co2.reliefs-missing` (7.5) | 4, 8 |
| Register `co2.applicable-from`, `co2.stage-table`, `co2.rounding-decimals`, `co2.cut.missing` (4.3, 4.7) | 1 |
| Stichtage `2022-12` / `2023-01`, Grenzen 11,9 · 11,95 · 12,0 · 51,9 · 52,0, Rumpf 5,0 → 10 % (12.2) | 1, 4 |
| Nachstufung, `co2.stage-mismatch` (9.2) | 4, 9 |
| `co2.missing`, `co2.missing-first-year`, `co2.fuel-unknown`, `co2.service-unsplit`, `co2.incomplete` mit bezifferten 3 % (9.1, 10.1, 6.5) | 9 |
| Warmwasser-Angabe mit 15 % (7.7, #211) | 5, 9, 11 |
| Ausweis, Druckblock (7.4 „Ausweis“, 9.5) | 7, 12 |
| `Settlement.heating`, `SettlementRow.kind`, `LandlordReason` + `co2Share` (5.7) | 2, 7, 8 |
| Schnappschuss (5.8) | 7 |
| Wiederherstellen, Objektgrenze (5.9) | 5 |
| Regeln `co2-split`, `heating-dhw-split` (10.2) | 1 |
| Lexikon `co2Split`, `co2Stage`, `co2Area`, `co2Deducted`, `hotWaterShare` (10.3) | 3 |
| Oberfläche: Karte „CO₂-Kosten“ ohne Vorgabe, Live-Probe, jsdom (11.3, 12.4) | 11 |
| Seite Heizkosten (11.4), Knopf „Heizung einrichten →“ (11.1) | 2, 11 |
| Anleitung `meteringService` passend zu Text und Probe (13 PR 0), neue Anleitung (11.4) | 13 |
| Steuer #209: Werbungskosten = Bezahltes, L_self privat (6.4 Nr. 2) | 7, 10, 13 |
| Invarianten Nr. 1, 8, 9, 14 (12.3) | 9 |
| Golden F12, F15 (12.1) | 10 |
| F06 (12.1, G-A5) | 9 Step 6: **bleibt wortgleich**, Abweichung begründet |
| Smoke-Test (12.4) | 14 |
| CHANGELOG mit Ankündigung (10.1) | 14 |
| Sperren: Lieferungen, Methode `self` (13 PR 6) | 5 |

**2. Platzhalter:** Keine offenen Stellen im Code. Zwei Werte entstehen erst bei der Ausführung und
sind benannt: die Prüfsumme der Migration (Task 2 Step 5, Ausgabe des Befehls) und die vier
Einzelbeträge von F12 samt Kürzungen (Task 10 Step 2, aus dem Beleg des Nutzers; ohne sie bricht der
Test mit Ansage ab).

**3. Typen und Namen:** `Co2Statement` (Task 2) ist in db/co2.ts, read.ts, snapshot.ts, co2.ts,
co2Form.ts und den Tests dieselbe; `ProbeResult` aus `shared/co2Probe.ts` in co2.ts und co2Form.ts;
`Co2Pot.reliefKey` = `co2:<Anlage>:<Heizperiode>` in calc.ts und in den Tests (`KEY`);
`co2DeductionsOf(pots, units, applicable)` in Task 7 definiert und aufgerufen; `landlordRecipients`
bekommt `co2ShareRaw: number | null` an seiner einen Aufrufstelle; `withoutCo2` (Task 7) in den Tests
aus PR 4; `HeatingPeriodView['hotWater']` in db/co2.ts, Routen und HotWaterCard; `navFor` in nav.ts,
App.tsx und nav.test.ts.

**4. Review Focus:** alle fünf Punkte mit Test: 1 und 2 in Task 7, 3 in Task 8, 4 und 5 in Task 5.
