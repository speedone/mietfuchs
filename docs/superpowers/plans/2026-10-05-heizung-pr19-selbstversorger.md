# Heizung PR 19: Erstattung an Selbstversorger (#97, #85) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heizt ein Mieter selbst (Gastherme oder Ölofen auf eigenen Vertrag), erfasst der Vermieter dessen
Erstattungsanspruch nach § 6 Abs. 2 CO2KostAufG; Mietfuchs rechnet zur Kontrolle nach (Stufe, gekürzte
Tabelle, § 8 Abs. 2, § 9, −5 % bei eigenen Geräten zu anderen Zwecken, Ausschluss bei ungemessener
gewerblicher Nutzung, ab 2028 § 5a), verrechnet den Betrag als Gutschriftzeile in der Betriebskostenabrechnung,
nennt die drei Fristen (Anzeige, nächste Abrechnung, Auszahlung) und lässt die Steuer allein an den Zahlungen
hängen.

**Architecture:** Eine neue Tabelle `co2_refunds` (ein erzeugter Schritt, `0042`) am Mietverhältnis, mit Betrag
laut Anzeige, Fristdaten, Verrechnungszeitraum oder Auszahlungstag und den Grundlagen aus der Rechnung des
Lieferanten. Rechtswerte im Register (`co2.self-supply`), die Nachrechnung als reine Funktionen in
`server/src/co2Refund.ts`, Lesen und Schreiben samt Prüfungen in `server/src/db/co2Refunds.ts` mit vier
Routen. `computeSettlement` bucht die verrechnete Erstattung als Zeile `co2Refund` beim Mieter und als
Gegenzeile beim Vermieter, meldet `co2.refund-late`, `co2.refund-not-next` und `co2.refund-due` und lässt
Erstattungen aus dem Vorschlag nach § 560 Abs. 4 BGB heraus. Die Oberfläche bekommt auf der Seite Kosten die
Karte „CO₂-Erstattung an Mieter mit eigener Heizung“ und in der Einrichtung der Heizung die Erklärung des
Anspruchs.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM 0.45 über
`sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(G-B10), 3.10 (Steuer), 4.3 (`co2.self-supply`, eventDate, PR 19), 4.4, 4.6, 5.1 (`co2_refunds`, PR 19), 5.5
(„`co2_refunds` (PR 19) ist aus dem CO₂-Entwurf übernommen“), 5.7 (`LandlordReason` + `'co2Refund'`,
`SettlementRow.kind` + `'co2Refund'`), **6.4 Nr. 3** (Steuer liest nur Zahlungen; Testfall 50 €/950 €), 10.1
(`co2.refund-late`, `co2.refund-not-next` hint; `co2.refund-due` warning; PR 19), 10.2 (`co2-self-supply`),
10.3 (`co2Refund`), 11.2 Schritt 1 („Vertrag beim Mieter: Selbstversorger … der Erstattungsanspruch nach § 6
CO2KostAufG wird erklärt (PR 19)“), 12.2 (G-B10), 13 (Zeile PR 19), 14.1 („Etagenheizung, Vertrag beim
Mieter | Erstattung | 19“), 14.2. Übernommen aus dem CO₂-Entwurf, 3. Fassung
(`origin/feat/co2-kostenaufteilung:docs/superpowers/specs/2026-10-04-co2-kostenaufteilung-design.md`): 4.5
(`co2_refunds`), 5.8 (Gutschriftzeile, drei Hinweise, Rechenhilfe mit § 8 und § 9, Steuer), Gegenprüfung A15,
A16.

**Baut auf:** PR 1 und PR 2 (Code auf `feat/heizung`), PR 3 bis PR 18 nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3..18}-*.md`. Gearbeitet wird auf
`feat/heizung-pr19-selbstversorger`, abgezweigt von der Spitze von PR 18; gestapelt auf PR 18 gestellt und
nach dessen Merge auf `main` umgestellt (`git rebase --onto`).

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1): Ohne Eintrag in `co2_refunds` ist jede Zahl,
  jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 18. `co2.self-supply` wird nur abgefragt, wenn
  eine Erstattung das Mietverhältnis eines Statements betrifft. Golden F01–F18 bleiben wortgleich.
- **Die Regel `co2-self-supply` steht ab 2023 im Rechtsstand jeder Abrechnung** (10.2; `rulesFor` nennt jede
  Regel, die den Zeitraum berührt). Die Golden-Tests vergleichen `legalBasis` nicht; `calc-notices.test.ts` und
  `api.test.ts` prüfen den Rechtsstand mit `some`/Mustern (bei einem Vergleich der ganzen Liste dort die Regel
  ergänzen).
- **Rechtswerte nur aus dem Register** (4.3, 4.7): zwölf Monate (§ 6 Abs. 2 Satz 3 und 5), 5 % (§ 6 Abs. 3
  Satz 2), 50 % (§ 8 Abs. 2) stehen nur in `shared/law/co2kostaufg.ts`. `server/src/co2Refund.ts` kommt in
  `ENGINE_FILES` von `law-literals.test.ts`.
- **Steuer nur über Zahlungen** (6.4 Nr. 3, G-B10): `taxReport` liest keine Erstattung. Verrechnet der
  Vermieter mit der Miete, steckt sie in der kleineren Zahlung; zahlt er aus, erfasst er eine negative Zahlung.
- **Die Erstattung ist keine Kostenposition**: Sie verändert weder Werbungskosten noch Eigenanteil, nur den
  Saldo des Mieters. Σ aller Zeilen bleibt Σ der Positionen (Zeile und Gegenzeile heben sich auf).
- **Fassungen nie ändern** (4.4); eine Zeile je neuer Fassung in `law-history.test.ts`.
- **Stufe hängt am Code** (#112): `co2.refund-late`, `co2.refund-not-next` sind `hint`, `co2.refund-due` ist
  `warning` (10.1); jeder trägt den Begriff `co2Refund`.
- **Migration:** nur mit `npm --prefix server run db:generate -- --name co2_erstattung`; eine neue Tabelle
  samt ihren Bedingungen in einem Schritt (README: nur geänderte Bedingungen an bestehenden Tabellen gehen in
  einen eigenen Schritt). Nach den Plänen `0042`. Marke in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang** unverändert; die db.json kennt keine Erstattungen.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch; Nutzertexte
  siezen. Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Auswahlfelder** aus Optionslisten, je eines ein jsdom-Test (angezeigter = gespeicherter Wert).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR`, `CI=1`, `NKA_UPDATE_URL`; in api.test.ts `startServer`.
- **Commit nur bei Grün** (`npm test`, `npm run typecheck`, Exit-Status 0). Commit-Nachrichten deutsch, mit
  `Refs #97` und `Refs #85` und den Attribution-Zeilen der ausführenden Sitzung; nie `Fixes`/`Closes`.
- **Aufgaben** nur in GitHub-Issues (vor dem Anlegen nachfragen), nie in Beads.

## Review Focus

1. **Der Vermieter verrechnet 50 € Erstattung mit der Miete (Zahlung 950 € statt 1.000 €) und bucht sie
   zusätzlich als Gutschriftzeile** (G-B10). Erwartet: Die Einnahmen der Steuer sinken um genau 50 € (die
   kleinere Zahlung), nicht um 100 €; Werbungskosten und Eigenanteil bleiben gleich. Test in Task 5.
2. **Die Erstattung wird in der Abrechnung eines Zeitraums verrechnet, in dem der Mieter nicht mehr wohnte,
   oder in einer schon abgeschlossenen.** Erwartet: 400 bzw. 409 mit einem Satz beim Speichern, statt einer
   Zeile, die in keinem Statement auftaucht, oder eines geänderten Archivstücks. Test in Task 4.
3. **Die Erstattung wird verrechnet, und der Vorschlag nach § 560 Abs. 4 BGB sinkt mit ihr.** Erwartet: Der
   Vorschlag bleibt, wie er ohne Erstattung wäre; eine Erstattung fällt nicht wieder an. Test in Task 5.
4. **Eine Erstattung bleibt offen, und die Abrechnungen der Folgejahre kommen.** Erwartet: Ab dem Zeitraum,
   in dem die Frist von zwölf Monaten nach der Anzeige endet, warnt jede Abrechnung (`co2.refund-due`), bis
   die Erstattung verrechnet oder ihre Auszahlung eingetragen ist. Test in Task 5.
5. **Der Mieter nutzt das Gas auch gewerblich (etwa eine Backstube) ohne getrennte Messung, oder er kocht mit
   Gas.** Erwartet: Bei gewerblicher Nutzung ohne Nachweis schlägt die Nachrechnung 0 € vor und nennt § 6
   Abs. 3 Satz 1; beim Gasherd kürzt sie um 5 % (Satz 2). Test in Task 3.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts` | Parameter `co2.self-supply`, Regel `co2-self-supply`, Begriff `co2Refund` | 1 |
| `shared/types.ts`, `server/src/db/schema.ts`, `server/drizzle/00xx_co2_erstattung.sql` (erzeugt), `server/src/db/read.ts`, `server/src/db/repository.ts` | Tabelle, Typen, Lesen, Wiederherstellen | 2 |
| `server/src/co2Refund.ts` (neu) | Nachrechnung, Fristen, nächste Abrechnung | 3 |
| `server/src/db/co2Refunds.ts` (neu), `server/src/index.ts` | Lesen mit Nachrechnung, Schreiben mit Prüfungen, Routen | 4 |
| `server/src/snapshot.ts`, `server/src/calc.ts` | Gutschriftzeile, Hinweise, § 560 ohne Erstattung | 5 |
| `client/src/co2RefundForm.ts` (neu), `client/src/components/Co2RefundsCard.tsx` (neu), `client/src/pages/Kosten.tsx`, `client/src/heatingForm.ts`, `client/src/landlordReasons.ts` | Oberfläche | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `law.test.ts`, `law-history.test.ts`, `rules.test.ts`, `glossary.test.ts`, `law-literals.test.ts`, `schema.test.ts`, `migrations.test.ts`, `db-co2-refunds.test.ts` (neu), `co2Refund.test.ts` (neu), `api.test.ts`, `calc-co2refund.test.ts` (neu), `client/src/co2RefundForm.test.ts` (neu), `client/src/components/Co2RefundsCard.test.tsx` (neu), `client/src/heatingForm.test.ts`, `client/src/landlordReasons.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- PR 1, PR 17, PR 18 (`shared/law/register.ts`): `law` (mit `eventDate`, `periodStart`, `incurred`),
  `valueAt`, `versionAt`, `coversDate`, `germanDate`, `createLawLog`, `LAW_AS_OF`, `daysIn`, `dayBefore`,
  `shiftMonths`, `eventPeriodEnd`, `versionsIn`, `IncurredSegment`.
- PR 2/3 (Code bzw. Plan): `shared/period.ts` `periodOfKey`, `periodsBetween`, `periodLabel`, `parsePeriodKey`,
  `settlementDeadline`; repository.ts `rulesForProperty` (exportiert seit PR 3), `PeriodError`,
  `findClosedSettlement(db, propertyId, period)`, `merged`, `has`, `raw`, `asNullableFilled`, `ISO_DATE`,
  `oneOfOrUndefined`; `orphanPeriodKeys(db)`; schema.ts `periodKeyCheck`, `notNegative`, `oneOf`.
- PR 3: `shared/degreeDays.ts` `DayRange`, `degreeDayPermille`; `hkvDegreeDays`; der Vorschlag nach § 560
  Abs. 4 BGB in `computeSettlement` (Zuweisung an `st.suggestedMonthlyCents`).
- PR 4: `HeatingError`; Client `heatingForm.ts` mit der Konstante `SELF_SUPPLY` und `heatingPlantBody`
  (Rückgabe `{ none: SELF_SUPPLY }` bei „Der Mieter hat den Vertrag“).
- PR 6/7: `shared/law/co2kostaufg.ts` `ENACTED`, `checked`, `co2ApplicableFrom`, `co2StageTable`,
  `co2RoundingDecimals`, `co2Restriction`, `co2FirstPeriodStart`; `server/src/co2.ts` `roundSpecific`,
  `tableFactor`, `stageRanges`, `stageOf`, `Co2StageRange`; `Co2Restriction`, `CO2_RESTRICTIONS`; Client
  `RESTRICTION_OPTIONS` (fuelForm.ts), `landlordReasons.ts` `LABELS`.
- PR 18: `co2HalfSplit`, `halfSplitFirstDay`, `halfSplitBioFirstDay`, `HalfSplitValue`;
  `server/src/halfSplit.ts` `termsFromPieces`, `termsWeight`, `blendedPermille`, `Piece`, `HalfSplitTerm`.
- Code auf `feat/heizung`: `Statement` (`rows`, `totalShareCents`, `prepaymentCents`, `balanceCents`,
  `suggestedMonthlyCents`); calc.ts `computeSettlement` mit `statements`, `landlordRows`, `warn`, `lawLog`,
  `period`, `objectRules` (PR 5), `fmtCents`, `fmtDay`, `andList`; der Abschnitt `law(bgbMaxPeriodMonths, …)`
  vor `const result: ComputedSettlement = {`; `taxReport(snapshot)` mit `income.paidCents`; `snapshotFor`,
  `snapshotOf`, `narrowToProperty`; Stock aus `readStock` mit `closedSettlements[].sentAt`.

Weicht ein Name beim Ausführen ab, gilt die genannte Rolle; die Abweichung wird hier vermerkt.

## Rechtsquellen, am 05.10.2026 im Wortlaut gelesen

CO2KostAufG (gesetze-im-internet.de, gegengelesen am Regelungstext BGBl. 2026 I Nr. 226, Art. 5 Nr. 6, in
Kraft seit 29.07.2026):

- § 5 Abs. 3: Versorgt sich der Mieter selbst, „ermittelt der Mieter im Zuge der jährlichen
  Betriebskostenabrechnung den Kohlendioxidausstoß der gemieteten Wohnung“; „Aus der Tabelle ergibt sich das
  Verhältnis der Aufteilung der im Abrechnungszeitraum des Wärmeversorgers angefallenen Kohlendioxidkosten.
  Absatz 1 Satz 4 und 5 gilt entsprechend.“
- § 6 Abs. 2 (Fassung seit 29.07.2026): Satz 1 „Versorgt sich der Mieter selbst …, so hat der Vermieter dem
  Mieter den Anteil der Kosten zu erstatten, den der Vermieter nach § 5 Absatz 3, § 5a Absatz 3 oder § 5b zu
  tragen hat.“ Satz 2 „§ 5 Absatz 1 Satz 5 gilt entsprechend.“ Satz 3 „Der Mieter muss den Erstattungsanspruch
  … innerhalb von zwölf Monaten ab dem Zeitpunkt, in dem der Lieferant … die Lieferung gegenüber dem Mieter
  abgerechnet hat, in Textform geltend machen.“ Satz 4 „Haben die Parteien eine Vorauszahlung auf
  Betriebskosten vereinbart, so kann der Vermieter einen … geltend gemachten Erstattungsbetrag im Rahmen der
  nächsten auf die Anzeige folgenden jährlichen Betriebskostenabrechnung verrechnen.“ Satz 5 „Erfolgt keine
  Betriebskostenabrechnung oder findet keine Verrechnung statt, so hat der Vermieter dem Mieter den Betrag
  spätestens zwölf Monate nach Anzeige zu erstatten.“ Satz 6 (neu) Hinweispflicht in Textform bei
  Vertragsschluss und bei Einbau einer Heizung nach § 43 GModG.
- § 6 Abs. 3 Satz 1: gewerbliche Nutzung des Brennstoffs → Anspruch „nur …, wenn der Verbrauch für die
  Erzeugung von Wärme … mit einer Messeinrichtung separat erfasst wird und der Mieter diesen … nachweist“;
  Satz 2: Nutzung „zum Betrieb eigener Geräte zu anderen Zwecken“ → Anspruch „um 5 Prozent zu kürzen“.
- § 8 Abs. 2: im Nichtwohngebäude „50 Prozent der Kohlendioxidkosten zu erstatten; § 6 Absatz 2 Satz 2 bis 4
  und Absatz 3 gilt entsprechend.“ (Art. 5 Nr. 8 des Änderungsgesetzes ändert in § 8 nur Abs. 1.)
- § 9 Abs. 1 (Anteil „nach § 5, 6, 7 oder 8“ halbiert), Abs. 2, Abs. 3 (Nachweis).
- § 11 Abs. 2 (Zeiträume ab 01.01.2023; Brennstoff vor 2023 in Rechnung gestellt: keine CO₂-Kosten).
- BGB §§ 186, 187 Abs. 1, 188 Abs. 2, 3 (Frist ab einem Ereignis); § 556 Abs. 3 Satz 2 (Frist der Abrechnung,
  über `settlementDeadline`); § 560 Abs. 4 (Vorschlag).

## Abweichungen vom Entwurf und Festlegungen dieses Plans

1. **`settle_year` wird `settle_period` (Folge von W3, Entwurf 1.1).** Der CO₂-Entwurf kennt nur
   Kalenderjahre; seit PR 2 ist der Abrechnungszeitraum ein `PeriodKey`.
2. **Neue Spalte `paid_out_on` (Festlegung).** Zahlt der Vermieter aus (§ 6 Abs. 2 Satz 5), erfasst er eine
   negative Zahlung (6.4 Nr. 3); ohne Vermerk an der Erstattung warnte `co2.refund-due` für immer. Verrechnet
   und ausgezahlt schließen sich aus.
3. **Grundlagen der Nachrechnung (Festlegung zu „Optional die Grundlagen aus der Mieterrechnung“).** Dazu
   kommen gegenüber dem CO₂-Entwurf: `billed_from`/`billed_to` (der Zeitraum des Lieferanten, für § 11 Abs. 2,
   die gekürzte Tabelle nach § 5 Abs. 3 Satz 4 und § 5a), `commercial_use`/`commercial_metered` (§ 6 Abs. 3
   Satz 1, Review Focus 5) sowie `half_split_from`, `grid_fee_cents`, `bio_cost_cents` (§ 6 Abs. 2 Satz 1 in
   der Fassung seit 29.07.2026 verweist auf § 5a Abs. 3 und § 5b). `half_split_from` ist der Tag, ab dem § 5a
   für die Heizung des Mieters gilt; die Merkmale aus PR 18 (Einbau, Notfalleinbau, Neubau) trägt hier keine
   Heizanlage, weil ein Selbstversorger keine hat (Entwurf 11.2), und die Oberfläche erklärt, wie der Tag
   bestimmt wird.
4. **Gebucht wird der angezeigte Betrag (Festlegung).** Nach § 5 Abs. 3 ermittelt der Mieter; der Vermieter
   erstattet, was geltend gemacht und zutreffend ist. Die Nachrechnung ist eine Kontrolle und steht im
   Rechenweg der Zeile, wenn die Grundlagen eingetragen sind; ein eigener Hinweis bei Abweichung wäre nicht
   im Entwurf und unterbleibt.
5. **„Nächste auf die Anzeige folgende Abrechnung“ (Festlegung zu § 6 Abs. 2 Satz 4).** Mietfuchs nimmt den
   frühesten Zeitraum des Objekts, in dem das Mietverhältnis wohnte, dessen Frist (§ 556 Abs. 3 Satz 2 BGB) am
   Tag der Anzeige noch nicht abgelaufen war und dessen Abrechnung nicht vor der Anzeige versandt wurde
   (`sentAt`). Das entspricht dem Wortlaut „auf die Anzeige folgend“ für eine Abrechnung, die noch erstellt
   werden kann; nur ein Hinweis.
6. **`co2.refund-due` in jeder späteren Abrechnung (Festlegung).** Die Warnung erscheint in jedem Zeitraum,
   der den Tag der Fälligkeit enthält oder danach liegt, solange die Erstattung weder verrechnet noch
   ausgezahlt ist.
7. **§ 8 Abs. 2 und die Frist zur Auszahlung (offene Rechtsfrage, Vorschlag 15.1 Nr. 25).** § 8 Abs. 2 verweist
   auf „§ 6 Absatz 2 Satz 2 bis 4“. Vor dem 29.07.2026 waren das Anzeigefrist, Verrechnung und Auszahlungsfrist;
   seit Satz 1 durch zwei Sätze ersetzt ist, sind es Umrechnung, Anzeigefrist und Verrechnung, und die
   Auszahlungsfrist (jetzt Satz 5) fiele aus dem Verweis. Mietfuchs warnt trotzdem und nennt die Frage im
   Text: zulasten des Vermieters vorsichtig, wie 15.1 Nr. 20.
8. **§ 9 kürzt nur den Teil nach Stufen (wie PR 18, Abweichung 5).** § 9 Abs. 1 nennt § 6; der Teil nach § 5a
   wird nicht gekürzt.
9. **Umrechnung nach Gradtagen (Festlegung zu § 6 Abs. 2 Satz 2).** Die Anteile ab dem 01.01.2028 bzw.
   01.01.2029 in einer Rechnung des Lieferanten über den Jahreswechsel rechnet die Nachrechnung nach der
   Gradtagstabelle (Stufe 5 aus 3.2); eine Zwischenrechnung des Lieferanten ist eine eigene Erstattung.
10. **Verrechnen nur in einem Zeitraum, in dem der Mieter wohnte, und nicht in einem abgeschlossenen
    (Festlegung, Review Focus 2).** Sonst stünde die Zeile in keinem Statement oder änderte ein Archivstück.
11. **Erstattungen gehen nicht in den Vorschlag nach § 560 Abs. 4 BGB ein (Festlegung, Review Focus 3).**
    Angemessen sind die voraussichtlichen Kosten ([R] VIII ZR 294/10); eine Erstattung fällt nicht wieder an.
12. **Eigene Kostenart der Zeile `CO₂-Erstattung` und Routen `/api/co2-refunds` (Festlegung).** Die Zeile ist
    keine Heizkostenzeile (ein Selbstversorger hat keine) und darf nicht in die Grundlage der Kürzungen nach
    6.5 fallen. Die generischen Routen der sechs Sammlungen bleiben unberührt.
13. **Die Karte steht auf der Seite Kosten (Festlegung).** Die Seite Heizkosten gibt es nur mit Heizanlage;
    ein Selbstversorger hat keine (11.2).

---
### Task 1: Register: `co2.self-supply`, Regel `co2-self-supply`, Lexikon `co2Refund`

**Files:**
- Modify: `shared/law/co2kostaufg.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/rules.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes: `LawParam`, `ENACTED`, `checked`, `co2FirstPeriodStart` (PR 6); `germanDate`, `valueAt`, `LAW_AS_OF`; `co2StageTable`.
- Produces: `type SelfSupply = { readonly claimMonths: number; readonly refundMonths: number; readonly ownAppliancesCutPercent: number; readonly nonResidentialPermille: number }`; `co2SelfSupply: LawParam<SelfSupply, 'eventDate'>` (`'co2.self-supply'`); `halfSplitEnactedOn(): string` (`'2026-07-29'`); Regel `co2-self-supply` (`validFrom` = `co2FirstPeriodStart()`); `TermId` + `'co2Refund'`.

- [ ] **Step 1: Write the failing tests**

`server/test/law.test.ts`: Import `co2SelfSupply, halfSplitEnactedOn` aus `'../../shared/law/co2kostaufg.ts'`,
`modules` um `co2SelfSupply` erweitern. Anhängen:

```ts
test('Stichtag co2.self-supply: ab 2023 zwölf Monate für Anzeige und Erstattung, 5 % bei eigenen Geräten, 50 % im Nichtwohngebäude', () => {
  const log = createLawLog()
  assert.deepEqual(law(co2SelfSupply, { date: '2025-01-20' }, log), { claimMonths: 12, refundMonths: 12, ownAppliancesCutPercent: 5, nonResidentialPermille: 500 })
  assert.throws(() => valueAt(co2SelfSupply, '2022-12-31'), /Kein Rechtswert/)
  assert.equal(versionAt(co2SelfSupply, '2025-01-20').source.url, 'https://www.gesetze-im-internet.de/co2kostaufg/__6.html')
  assert.equal(log.values.length, 1)
  assert.equal(halfSplitEnactedOn(), '2026-07-29')
})
```

`server/test/law-history.test.ts`, in `SHIPPED` hinter den Zeilen von PR 18:

```ts
  // 0.11.0 (Heizung PR 19, #97, #85)
  'co2.self-supply|2023-01-01||{"claimMonths":12,"refundMonths":12,"ownAppliancesCutPercent":5,"nonResidentialPermille":500}',
```

`server/test/rules.test.ts` anhängen:

```ts
test('§ 6 Abs. 2: die Regel co2-self-supply gilt ab 2023 (Heizung PR 19)', () => {
  assert.equal(ruleCoverage('co2-self-supply', '2022-01-01', '2022-12-31'), 'none')
  assert.equal(ruleCoverage('co2-self-supply', '2023-01-01', '2023-12-31'), 'full')
})
```

`server/test/glossary.test.ts` anhängen:

```ts
test('Lexikon: CO₂-Erstattung an Mieter mit eigener Heizung, Beispiel nachgerechnet (Heizung PR 19)', () => {
  const t = GLOSSARY.co2Refund
  for (const n of [/§ 6 Abs\. 2/, /§ 6 Abs\. 3/, /§ 8 Abs\. 2/, /§ 5 Abs\. 3/]) assert.match(t.norm ?? '', n)
  // 2.400 kg auf 80 m² = 30,0 kg/m² → Vermieter 40 %; 600 € × 40 % = 240,00 €; mit Gasherd − 5 % = 228,00 €.
  assert.equal(2400 / 80, 30)
  assert.equal(Math.round(60000 * 0.4), 24000)
  assert.equal(Math.round(24000 * 0.95), 22800)
  assert.match(t.example, /240,00 €.*228,00 €/s)
  assert.match(t.needed, /zwölf Monaten|12 Monaten/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/rules.test.ts test/glossary.test.ts`
Expected: FAIL, fehlender Export `co2SelfSupply`.

- [ ] **Step 3: Parameter (`shared/law/co2kostaufg.ts`)**

Ans Dateiende:

```ts
// ---------- Erstattung an Selbstversorger (Heizung PR 19, #97, #85) ----------
// § 6 Abs. 2 Satz 3: Anzeige in Textform „innerhalb von zwölf Monaten ab dem Zeitpunkt, in dem der
// Lieferant … die Lieferung gegenüber dem Mieter abgerechnet hat“; Satz 5: Erstattung „spätestens zwölf
// Monate nach Anzeige“, wenn nicht verrechnet; § 6 Abs. 3 Satz 2: „um 5 Prozent zu kürzen“ bei eigenen
// Geräten zu anderen Zwecken; § 8 Abs. 2: im Nichtwohngebäude „50 Prozent der Kohlendioxidkosten zu
// erstatten“. `eventDate`: die Abrechnung des Lieferanten gegenüber dem Mieter. Die Zahlen sind seit dem
// 01.01.2023 dieselben; das Gesetz vom 23.07.2026 hat in § 6 Abs. 2 nur Satz 1 ersetzt (Verweis auf § 5a)
// und Satz 6 angefügt.
export type SelfSupply = { readonly claimMonths: number; readonly refundMonths: number; readonly ownAppliancesCutPercent: number; readonly nonResidentialPermille: number }
export const co2SelfSupply: LawParam<SelfSupply, 'eventDate'> = {
  id: 'co2.self-supply',
  title: 'Erstattung an Mieter mit eigener Heizung',
  norm: '§ 6 Abs. 2, 3, § 8 Abs. 2 CO2KostAufG',
  timing: 'eventDate',
  versions: [{
    validFrom: '2023-01-01',
    value: { claimMonths: 12, refundMonths: 12, ownAppliancesCutPercent: 5, nonResidentialPermille: 500 },
    source: checked('§ 6 Abs. 2 Satz 3, 5, Abs. 3 Satz 2, § 8 Abs. 2 CO2KostAufG', '__6.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `Anzeige binnen ${v.claimMonths} Monaten nach der Abrechnung des Lieferanten; Erstattung spätestens ${v.refundMonths} Monate nach der Anzeige; ${v.ownAppliancesCutPercent} % weniger bei eigenen Geräten zu anderen Zwecken; im Nichtwohngebäude ${v.nonResidentialPermille / 10} %`,
}
```

Dahinter, für Texte, die den Tag der Neufassung nennen (ohne Datumsliteral in den Dateien der Berechnung):

```ts
// Der Tag, an dem §§ 5a bis 5d und die Neufassung von § 6 Abs. 2 in Kraft traten (Art. 9 Abs. 1 G v. 23.07.2026:
// am Tag nach der Verkündung vom 28.07.2026).
export const halfSplitEnactedOn = (): string => '2026-07-29'
```

`shared/law/params.ts`: `co2SelfSupply` importieren und in `LAW_PARAMS` nach der Ordnung der Kennungen
einfügen (hinter `co2.restriction`, vor `co2.stage-table`).

- [ ] **Step 4: Regel (`shared/law/rules.ts`)**

Import `co2SelfSupply` (und `co2FirstPeriodStart`, falls nicht vorhanden) aus `'./co2kostaufg.ts'`. Oben:

```ts
const SELF = valueAt(co2SelfSupply, LAW_AS_OF)
```

In `RULES` hinter `co2-half-split`:

```ts
  {
    code: 'co2-self-supply',
    title: 'CO₂-Erstattung an Mieter mit eigener Heizung',
    norm: '§ 6 Abs. 2, 3, § 8 Abs. 2 CO2KostAufG',
    summary:
      'Heizt ein Mieter selbst mit eigenem Vertrag, erstattet ihm der Vermieter den Anteil der CO₂-Kosten, den er nach dem Stufenmodell zu tragen hätte, ' +
      `ab 2028 bei einer Heizung nach § 43 GModG die Hälfte samt Netzentgelten. Der Mieter muss den Anspruch binnen ${SELF.claimMonths} Monaten nach der Abrechnung seines Lieferanten in Textform anzeigen; ` +
      `der Vermieter verrechnet ihn in der nächsten Betriebskostenabrechnung oder zahlt binnen ${SELF.refundMonths} Monaten. Nutzt der Mieter den Brennstoff auch für eigene Geräte, etwa einen Gasherd, sinkt der Anspruch um ${SELF.ownAppliancesCutPercent} %.`,
    validFrom: co2FirstPeriodStart(),
  },
```

- [ ] **Step 5: Lexikon (`shared/glossary.ts`)**

Import `co2SelfSupply` aus `'./law/co2kostaufg.ts'`; oben `const SELF = valueAt(co2SelfSupply, LAW_AS_OF)`. In
`GLOSSARY` hinter `co2HalfSplit` (PR 18):

```ts
  // Heizung PR 19 (#97, #85). Wortlaut §§ 5 Abs. 3, 6 Abs. 2, 3, 8 Abs. 2, 9 CO2KostAufG am 05.10.2026 gelesen.
  co2Refund: {
    title: 'CO₂-Erstattung bei eigener Heizung des Mieters',
    short: `Hat der Mieter einen eigenen Vertrag für Gas oder Öl (etwa eine Gastherme in der Wohnung), trägt er die CO₂-Kosten zunächst selbst. Den Anteil, den nach dem Stufenmodell der Vermieter trüge, kann er binnen ${SELF.claimMonths} Monaten nach der Abrechnung seines Lieferanten in Textform von Ihnen verlangen.`,
    example: 'Gasrechnung 2025 des Mieters: 2.400 kg CO₂, Wohnung 80 m², also 30,0 kg je m² und Jahr; das ist die Stufe, in der der Vermieter 40 % trägt. CO₂-Kosten 600 €: Sie erstatten 240,00 €. Kocht der Mieter auch mit Gas, sind es 228,00 €.',
    norm: '§ 5 Abs. 3, § 6 Abs. 2, 3, § 8 Abs. 2, § 9 CO2KostAufG',
    needed: `Nur wenn ein Mieter selbst heizt und den Anspruch anzeigt. Zahlt er Betriebskostenvorauszahlungen, verrechnen Sie den Betrag in der nächsten Abrechnung nach der Anzeige; sonst zahlen Sie spätestens ${SELF.refundMonths} Monate nach der Anzeige aus und erfassen die Auszahlung als negative Zahlung. Auf den Anspruch und, bei einer Heizung nach § 43 GModG, auf die Pflicht zum Biobrennstoff müssen Sie den Mieter bei Vertragsschluss in Textform hinweisen (§ 6 Abs. 2 Satz 6).`,
  },
```

(Der Test erlaubt „zwölf Monaten“ oder „12 Monaten“; der Text setzt die Zahl aus dem Register ein.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/rules.test.ts test/glossary.test.ts test/law-literals.test.ts test/law-release.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/law shared/glossary.ts server/test/law.test.ts server/test/law-history.test.ts server/test/rules.test.ts server/test/glossary.test.ts
git commit -m "Rechtsregister: Erstattung an Selbstversorger (§ 6 Abs. 2, 3, § 8 Abs. 2 CO2KostAufG)

Refs #97
Refs #85"
```

---

### Task 2: Datenmodell und Migration `co2_refunds`

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/test/migrations.test.ts`, `server/test/schema.test.ts`
- Create: `server/drizzle/00xx_co2_erstattung.sql` (erzeugt)
- Test: `server/test/db-co2-refunds.test.ts` (neu)

**Interfaces:**
- Consumes: `tenancies`, `units`, `CO2_RESTRICTIONS`, `periodKeyCheck`, `notNegative`, `oneOf` (schema.ts); `Co2Restriction`, `PeriodKey`; `orphanPeriodKeys` (repository.ts).
- Produces:
  - `shared/types.ts`: `type Co2Refund = { id: string; tenancyId: string; supplierBilledAt: string; claimedAt: string; amountCents: number; settlePeriod: PeriodKey | null; paidOutOn: string | null; billedFrom: string | null; billedTo: string | null; emissionsKg: number | null; co2CostCents: number | null; areaM2: number | null; ownAppliances: boolean; commercialUse: boolean; commercialMetered: boolean; nonResidential: boolean; restriction: Co2Restriction; halfSplitFrom: string | null; gridFeeCents: number | null; bioCostCents: number | null }`; `SettlementRow.kind` + `'co2Refund'`; `LandlordReason` + `'co2Refund'`
  - schema.ts: `co2Refunds`
  - read.ts: `readCo2Refunds(db: Database): Promise<Co2Refund[]>`; `Stock.co2Refunds: Co2Refund[]`
  - repository.ts: `orphanPeriodKeys` prüft `co2_refunds.settle_period`

- [ ] **Step 1: Write the failing tests**

`server/test/db-co2-refunds.test.ts`:

```ts
// Erstattung an Selbstversorger (Heizung PR 19, #97, #85): Tabelle, Bedingungen, Lesen, Wiederherstellen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-erstattung-'))
function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

test('Tabelle co2_refunds: Bedingungen und CASCADE am Mietverhältnis', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('w', 'objekt-1', 'EG', 80, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'w', 'Meier', 1, '2020-01-01')`)
    const ins = (id: string, cols: string, vals: string) =>
      `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents${cols}) VALUES ('${id}', 't', '2025-01-20', '2025-03-01', 24000${vals})`
    assert.equal(rejects(c, ins('a', ', settle_period', ", '2025-01'")), null)
    assert.match(rejects(c, ins('b', ', settle_period, paid_out_on', ", '2025-01', '2025-04-01'")) ?? '', /co2_refunds_settled_or_paid/)
    assert.match(rejects(c, ins('c', ', settle_period', ", '2025-13'")) ?? '', /co2_refunds_settle_period_valid/)
    assert.match(rejects(c, `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents) VALUES ('d', 't', '2025-01-20', '2025-03-01', -1)`) ?? '', /co2_refunds_amount_not_negative/)
    assert.match(rejects(c, ins('e', ', billed_from, billed_to', ", '2025-12-31', '2025-01-01'")) ?? '', /co2_refunds_billed_order/)
    assert.match(rejects(c, ins('f', ', area_m2', ', 0')) ?? '', /co2_refunds_area_positive/)
    assert.match(rejects(c, ins('g', ', restriction', ", 'denkmal'")) ?? '', /co2_refunds_restriction_known/)
    assert.match(rejects(c, ins('h', ', commercial_metered', ', 1')) ?? '', /co2_refunds_metered_needs_commercial/)
    assert.match(rejects(c, "INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents) VALUES ('i', 't', '2025-01-20', '01.03.2025', 0)") ?? '', /co2_refunds_claimed_date/)
    c.exec(`DELETE FROM tenancies WHERE id = 't'`)
    assert.deepEqual(c.rows('SELECT COUNT(*) FROM co2_refunds'), [[0]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

`server/test/schema.test.ts`: Typimport um `Co2Refund` ergänzen und bei den Paaren der Ebene 1 nach dem Muster
der übrigen Tabellen anhängen:

```ts
type Co2RefundRow = typeof schema.co2Refunds.$inferSelect
type _Co2RefundValues = Assert<ValuesFit<Co2RefundRow, Co2Refund>>
type _Co2RefundNull = Assert<NullabilityFits<Co2RefundRow, Co2Refund>>
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-co2-refunds.test.ts && npm run typecheck`
Expected: FAIL, `no such table: co2_refunds` bzw. fehlender Typ `Co2Refund`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter `Co2Statement`:

```ts
// Ein Erstattungsanspruch eines Mieters, der selbst heizt (Heizung PR 19, #97, #85; § 6 Abs. 2, 3, § 8 Abs. 2
// CO2KostAufG). `amountCents`: der angezeigte Betrag; `settlePeriod`: der Abrechnungszeitraum des Objekts, in
// dem er verrechnet wird; `paidOutOn`: ausgezahlt am (die Auszahlung selbst steht als negative Zahlung im
// Mietkonto). Die übrigen Felder sind die Grundlagen aus der Rechnung des Lieferanten für die Nachrechnung;
// `halfSplitFrom` ist der Tag, ab dem § 5a für die Heizung des Mieters gilt.
export type Co2Refund = {
  id: string
  tenancyId: string
  supplierBilledAt: string
  claimedAt: string
  amountCents: number
  settlePeriod: PeriodKey | null
  paidOutOn: string | null
  billedFrom: string | null
  billedTo: string | null
  emissionsKg: number | null
  co2CostCents: number | null
  areaM2: number | null
  ownAppliances: boolean
  commercialUse: boolean
  commercialMetered: boolean
  nonResidential: boolean
  restriction: Co2Restriction
  halfSplitFrom: string | null
  gridFeeCents: number | null
  bioCostCents: number | null
}
```

`SettlementRow.kind` um `| 'co2Refund'` erweitern, im Kommentar „`co2Refund`: Erstattung an einen Mieter mit
eigener Heizung (Heizung PR 19), ohne Kostenposition“. `LandlordReason` um `| 'co2Refund'`, im Kommentar der
Gründe „`co2Refund` Erstattung nach § 6 Abs. 2 CO2KostAufG, mit der Abrechnung verrechnet“.

- [ ] **Step 4: Schema (`server/src/db/schema.ts`)**

Typimport um `Co2Refund` ist nicht nötig; hinter `co2TenantReliefs` (PR 6):

```ts
// Erstattung an Selbstversorger (Heizung PR 19, #97, #85). Hängt am Mietverhältnis und fällt mit ihm.
// Verrechnet (`settle_period`) und ausgezahlt (`paid_out_on`) schließen sich aus (Abweichung 2).
export const co2Refunds = sqliteTable(
  'co2_refunds',
  {
    id: text('id').primaryKey().notNull(),
    tenancyId: text('tenancy_id').notNull().references(() => tenancies.id, { onDelete: 'cascade' }),
    supplierBilledAt: text('supplier_billed_at').notNull(),
    claimedAt: text('claimed_at').notNull(),
    amountCents: integer('amount_cents').notNull(),
    settlePeriod: text('settle_period').$type<PeriodKey>(),
    paidOutOn: text('paid_out_on'),
    billedFrom: text('billed_from'),
    billedTo: text('billed_to'),
    emissionsKg: real('emissions_kg'),
    co2CostCents: integer('co2_cost_cents'),
    areaM2: real('area_m2'),
    ownAppliances: integer('own_appliances', { mode: 'boolean' }).notNull().default(false),
    commercialUse: integer('commercial_use', { mode: 'boolean' }).notNull().default(false),
    commercialMetered: integer('commercial_metered', { mode: 'boolean' }).notNull().default(false),
    nonResidential: integer('non_residential', { mode: 'boolean' }).notNull().default(false),
    restriction: text('restriction', { enum: CO2_RESTRICTIONS }).notNull().default('none'),
    halfSplitFrom: text('half_split_from'),
    gridFeeCents: integer('grid_fee_cents'),
    bioCostCents: integer('bio_cost_cents'),
  },
  (t) => [
    index('co2_refunds_tenancy_idx').on(t.tenancyId),
    notNegative('co2_refunds_amount_not_negative', 'amount_cents'),
    notNegative('co2_refunds_co2_cost_not_negative', 'co2_cost_cents'),
    notNegative('co2_refunds_emissions_not_negative', 'emissions_kg'),
    notNegative('co2_refunds_grid_fee_not_negative', 'grid_fee_cents'),
    notNegative('co2_refunds_bio_not_negative', 'bio_cost_cents'),
    check('co2_refunds_area_positive', sql.raw('"area_m2" > 0')),
    periodKeyCheck('co2_refunds_settle_period_valid', 'settle_period'),
    check('co2_refunds_settled_or_paid', sql.raw('"settle_period" IS NULL OR "paid_out_on" IS NULL')),
    check('co2_refunds_billed_order', sql.raw('"billed_from" IS NULL OR "billed_to" IS NULL OR "billed_from" <= "billed_to"')),
    check('co2_refunds_metered_needs_commercial', sql.raw('"commercial_metered" = 0 OR "commercial_use" = 1')),
    oneOf('co2_refunds_restriction_known', 'restriction', CO2_RESTRICTIONS),
    check('co2_refunds_billed_at_date', sql.raw(`"supplier_billed_at" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('co2_refunds_claimed_date', sql.raw(`"claimed_at" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('co2_refunds_paid_out_date', sql.raw(`"paid_out_on" IS NULL OR "paid_out_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('co2_refunds_billed_from_date', sql.raw(`"billed_from" IS NULL OR "billed_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('co2_refunds_billed_to_date', sql.raw(`"billed_to" IS NULL OR "billed_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('co2_refunds_half_split_date', sql.raw(`"half_split_from" IS NULL OR "half_split_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
  ],
)
```

(`index` und `real` sind in schema.ts importiert; sonst aus `drizzle-orm/sqlite-core` ergänzen.)

Run: `npm --prefix server run db:generate -- --name co2_erstattung`
Expected: eine neue Datei mit genau einem `CREATE TABLE \`co2_refunds\`` und dem Index, kein `__new_`.

Run (Marke):

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('co2_erstattung')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` hinter den Marken von PR 18 einfügen, darüber
`// Heizung PR 19 (#97, #85). Wird PR 18 vor dem Push neu erzeugt, hier neu eintragen.`

- [ ] **Step 5: Lesen (`server/src/db/read.ts`) und Wiederherstellen (`repository.ts`)**

`co2Refunds` aus `'./schema.ts'` und `Co2Refund` als Typ importieren. Hinter `readCo2Statements` (PR 6):

```ts
// Erstattungen an Selbstversorger (Heizung PR 19), in der Reihenfolge der Anlage.
export async function readCo2Refunds(db: Database): Promise<Co2Refund[]> {
  const rows = await db.select().from(co2Refunds).orderBy(INSERTION_ORDER)
  return rows.map((r) => ({
    id: r.id, tenancyId: r.tenancyId, supplierBilledAt: r.supplierBilledAt, claimedAt: r.claimedAt, amountCents: r.amountCents,
    settlePeriod: r.settlePeriod ?? null, paidOutOn: r.paidOutOn ?? null, billedFrom: r.billedFrom ?? null, billedTo: r.billedTo ?? null,
    emissionsKg: r.emissionsKg ?? null, co2CostCents: r.co2CostCents ?? null, areaM2: r.areaM2 ?? null,
    ownAppliances: r.ownAppliances, commercialUse: r.commercialUse, commercialMetered: r.commercialMetered, nonResidential: r.nonResidential,
    restriction: r.restriction, halfSplitFrom: r.halfSplitFrom ?? null, gridFeeCents: r.gridFeeCents ?? null, bioCostCents: r.bioCostCents ?? null,
  }))
}
```

`Stock` um `co2Refunds: Co2Refund[]`, in `readStock` `co2Refunds: await readCo2Refunds(db),`.

In `orphanPeriodKeys` (repository.ts) vor `return befunde`:

```ts
  // Heizung PR 19: der Verrechnungszeitraum einer Erstattung gehört zum Objekt des Mietverhältnisses.
  const erstattungen = await db
    .select({ propertyId: units.propertyId, period: co2Refunds.settlePeriod, tenantName: tenancies.tenantName })
    .from(co2Refunds)
    .innerJoin(tenancies, eq(co2Refunds.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
  for (const e of erstattungen) if (e.period !== null) pruefe(e.propertyId, e.period, `Die CO₂-Erstattung von „${e.tenantName}“`)
```

(Import `co2Refunds` aus `'./schema.ts'`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-co2-refunds.test.ts test/migrations.test.ts test/schema.test.ts test/db-stock.test.ts test/db-golden.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS. (Prüft `db-stock.test.ts` die Schlüssel von `Stock` als Liste, dort `co2Refunds` ergänzen.)

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle server/src/db/read.ts server/src/db/repository.ts server/test
git commit -m "Datenmodell: Erstattungen an Selbstversorger (co2_refunds)

Refs #97
Refs #85"
```

---
### Task 3: Reine Rechnung: Nachrechnung, Fristen, nächste Abrechnung (`server/src/co2Refund.ts`)

**Files:**
- Create: `server/src/co2Refund.ts`
- Modify: `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/co2Refund.test.ts` (neu)

**Interfaces:**
- Consumes: `Co2Refund`, `Co2StageRange`, `PeriodKey` (Task 2, PR 6); `roundSpecific`, `stageOf` (co2.ts); `termsFromPieces`, `blendedPermille`, `Piece` (halfSplit.ts, PR 18); `eventPeriodEnd` (register.ts, PR 18); `DayRange` (PR 3).
- Produces (co2Refund.ts):
  - `type RefundBasis = Pick<Co2Refund, 'billedFrom' | 'billedTo' | 'emissionsKg' | 'co2CostCents' | 'areaM2' | 'ownAppliances' | 'commercialUse' | 'commercialMetered' | 'nonResidential' | 'restriction' | 'halfSplitFrom' | 'gridFeeCents' | 'bioCostCents'>`
  - `type RefundLaw = { applicable: boolean; ranges: readonly Co2StageRange[]; decimals: number; nonResidentialPermille: number; restriction: { factor: number; bothSplit: boolean } | null; cutPercent: number; pieces: readonly Piece[]; weigh: (r: DayRange) => number }`
  - `type RefundProposal = { cents: number; raw: number; excluded: 'notApplicable' | 'commercialUnmetered' | null; value: number | null; stagePercent: number | null; permille: number | null; co2Raw: number; gridFeeRaw: number; bioRaw: number; cutRaw: number }`
  - `refundProposal(b: RefundBasis, l: RefundLaw): RefundProposal | null`
  - `type RefundStepText = { euro: (cents: number) => string; exact: (cents: number) => string; num: (n: number) => string; applicableFrom: string; cutPercent: number }`
  - `refundSteps(p: RefundProposal | null, b: RefundBasis, amountCents: number, t: RefundStepText): { label: string; value: string }[]`
  - `claimDeadline(supplierBilledAt: string, months: number): string`, `refundDueDate(claimedAt: string, months: number): string`
  - `type SettlementCandidate = { key: PeriodKey; from: string; deadline: string; sentAt: string | null }`, `nextSettlement(claimedAt: string, candidates: readonly SettlementCandidate[]): PeriodKey | null`
  - `type LawAsk` (Abfrage des Registers mit oder ohne Protokoll) und `refundLawAt(b: RefundBasis & { supplierBilledAt: string }, ask: LawAsk): RefundLaw | null`

- [ ] **Step 1: Write the failing tests**

`server/test/co2Refund.test.ts`:

```ts
// Erstattung an Selbstversorger (Heizung PR 19, #97, #85): Nachrechnung nach § 5 Abs. 3, § 6 Abs. 2, 3,
// § 8 Abs. 2, § 9 und ab 2028 § 5a CO2KostAufG; Fristen nach § 6 Abs. 2 Satz 3–5.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimDeadline, nextSettlement, refundDueDate, refundProposal, refundSteps, type RefundBasis, type RefundLaw } from '../src/co2Refund.ts'
import { stageRanges, tableFactor } from '../src/co2.ts'
import { co2HalfSplit, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { valueAt, versionsIn } from '../../shared/law/register.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { periodKey } from '../../shared/period.ts'

const TABLE = valueAt(hkvDegreeDays, '2025-01-01')
const lawFor = (from: string, to: string, short = false, over: Partial<RefundLaw> = {}): RefundLaw => ({
  applicable: from >= '2023-01-01',
  ranges: from >= '2023-01-01' ? stageRanges(valueAt(co2StageTable, from), tableFactor({ from, to, short })) : [],
  decimals: 1, nonResidentialPermille: 500, restriction: null, cutPercent: 5,
  pieces: versionsIn(co2HalfSplit, { from, to }),
  weigh: (r) => degreeDayPermille([r], TABLE),
  ...over,
})
const basis = (over: Partial<RefundBasis> = {}): RefundBasis => ({
  billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: 2400, co2CostCents: 60000, areaM2: 80, ownAppliances: false,
  commercialUse: false, commercialMetered: false, nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null, ...over,
})
const cents = (b: RefundBasis, l: RefundLaw = lawFor(b.billedFrom ?? '', b.billedTo ?? '')): number | null => refundProposal(b, l)?.cents ?? null

test('30,0 kg/m² → Stufe 40 %: 600 € → 240,00 €; Gasherd −5 % → 228,00 € (Review Focus 5)', () => {
  const p = refundProposal(basis(), lawFor('2025-01-01', '2025-12-31')) ?? assert.fail('keine Nachrechnung')
  assert.deepEqual([p.value, p.stagePercent, p.permille, p.cents], [30, 40, 400, 24000])
  assert.equal(cents(basis({ ownAppliances: true })), 22800)
})

test('§ 6 Abs. 3 Satz 1: gewerbliche Nutzung ohne getrennte Messung → kein Anspruch; mit Messung wie sonst', () => {
  const ohne = refundProposal(basis({ commercialUse: true }), lawFor('2025-01-01', '2025-12-31'))
  assert.deepEqual([ohne?.cents, ohne?.excluded], [0, 'commercialUnmetered'])
  assert.equal(cents(basis({ commercialUse: true, commercialMetered: true })), 24000)
})

test('§ 8 Abs. 2: im Nichtwohngebäude 50 %; § 9 halbiert, bei beiden Vorgaben nichts', () => {
  assert.equal(cents(basis({ nonResidential: true })), 30000)
  const halb = lawFor('2025-01-01', '2025-12-31', false, { restriction: { factor: 0.5, bothSplit: false } })
  assert.equal(refundProposal(basis({ restriction: 'building' }), halb)?.cents, 12000)
  assert.equal(refundProposal(basis({ restriction: 'both' }), halb)?.cents, 0)
  assert.equal(refundProposal(basis({ nonResidential: true, restriction: 'supply' }), halb)?.cents, 15000)
})

test('Zeitraum des Lieferanten unter einem Jahr: Tabelle gekürzt (§ 5 Abs. 3 Satz 4 i. V. m. Abs. 1 Satz 4)', () => {
  const b = basis({ billedFrom: '2025-01-01', billedTo: '2025-06-30', emissionsKg: 1200, co2CostCents: 30000 })
  assert.equal(refundProposal(b, lawFor('2025-01-01', '2025-06-30', true))?.cents, 12000)
  assert.equal(refundProposal(b, lawFor('2025-01-01', '2025-06-30', false))?.cents, 3000, 'ungekürzt läge 15,0 in der Stufe 10 %')
})

test('§ 11 Abs. 2: ein Zeitraum des Lieferanten vor 2023 ergibt keinen Anspruch', () => {
  const p = refundProposal(basis({ billedFrom: '2022-07-01', billedTo: '2023-06-30' }), lawFor('2022-07-01', '2023-06-30'))
  assert.deepEqual([p?.cents, p?.excluded], [0, 'notApplicable'])
})

test('§ 6 Abs. 2 Satz 1 n. F. mit § 5a: ab 01.01.2028 hälftig nach Anfall, Netzentgelte hälftig (Abweichung 3, 9)', () => {
  const b = basis({ billedFrom: '2027-07-01', billedTo: '2028-06-30', halfSplitFrom: '2028-01-01', gridFeeCents: 30000 })
  const p = refundProposal(b, lawFor('2027-07-01', '2028-06-30')) ?? assert.fail('keine Nachrechnung')
  const w = degreeDayPermille([{ from: '2028-01-01', to: '2028-06-30' }], TABLE) / degreeDayPermille([{ from: '2027-07-01', to: '2028-06-30' }], TABLE)
  assert.ok(Math.abs((p.permille ?? 0) - (400 * (1 - w) + 500 * w)) < 1e-9)
  assert.ok(Math.abs(p.gridFeeRaw - 30000 * w * 0.5) < 1e-9)
  assert.equal(p.cents, Math.round(60000 * (400 * (1 - w) + 500 * w) / 1000 + 30000 * w * 0.5))
})

test('Ohne Zeitraum oder CO₂-Kosten keine Nachrechnung; ohne Fläche nur, wenn alles hälftig ist', () => {
  assert.equal(refundProposal(basis({ billedFrom: null }), lawFor('2025-01-01', '2025-12-31')), null)
  assert.equal(refundProposal(basis({ co2CostCents: null }), lawFor('2025-01-01', '2025-12-31')), null)
  assert.equal(refundProposal(basis({ areaM2: null }), lawFor('2025-01-01', '2025-12-31')), null)
})

test('Fristen nach §§ 187 Abs. 1, 188 Abs. 2 BGB: Anzeige bis 20.01.2026, Erstattung bis 01.03.2026', () => {
  assert.equal(claimDeadline('2025-01-20', 12), '2026-01-20')
  assert.equal(refundDueDate('2025-03-01', 12), '2026-03-01')
  assert.equal(refundDueDate('2024-02-29', 12), '2025-02-28')
})

test('Nächste Abrechnung nach der Anzeige: die früheste, die am Tag der Anzeige noch erstellt werden darf und nicht versandt war (Abweichung 5)', () => {
  const p = (y: number, sentAt: string | null = null) => ({ key: periodKey(`${y}-01`), from: `${y}-01-01`, deadline: `${y + 1}-12-31`, sentAt })
  // Anzeige am 01.03.2025: Die Abrechnung 2024 (Frist 31.12.2025) ist noch offen → sie ist die nächste.
  assert.equal(nextSettlement('2025-03-01', [p(2023), p(2024), p(2025)]), '2024-01')
  // Schon am 15.02.2025 versandt → 2025.
  assert.equal(nextSettlement('2025-03-01', [p(2023), p(2024, '2025-02-15'), p(2025)]), '2025-01')
  assert.equal(nextSettlement('2025-03-01', []), null)
})

test('Rechenweg der Zeile', () => {
  const b = basis({ ownAppliances: true })
  const p = refundProposal(b, lawFor('2025-01-01', '2025-12-31'))
  const t = { euro: (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`, exact: (c: number) => `${(c / 100).toFixed(3).replace('.', ',')} €`, num: (n: number) => String(n).replace('.', ','), applicableFrom: '01.01.2023', cutPercent: 5 }
  const steps = refundSteps(p, b, 22800, t)
  assert.deepEqual(steps.map((s) => s.label), ['CO₂-Ausstoß je m² und Jahr', 'Anteil des Vermieters', 'CO₂-Kosten des Vermieters', 'Eigene Geräte zu anderen Zwecken', 'Nachgerechnet', 'Betrag laut Anzeige'])
  assert.equal(steps.at(-2)?.value, '228,00 €')
  assert.equal(refundSteps(null, b, 22800, t).map((s) => s.label).join(), 'Betrag laut Anzeige')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/co2Refund.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/co2Refund.ts`.

- [ ] **Step 3: Implementierung (`server/src/co2Refund.ts`)**

```ts
// Erstattung an Selbstversorger (Heizung PR 19, #97, #85; § 5 Abs. 3, § 6 Abs. 2, 3, § 8 Abs. 2, § 9 und ab 2028
// § 5a CO2KostAufG). Reine Funktionen. Rechtswerte reicht der Aufrufer herein; hier steht kein Datum und keine
// Rechtszahl (law-literals.test.ts).
//
// Den Betrag ermittelt nach § 5 Abs. 3 der Mieter; gebucht wird, was er angezeigt hat (Abweichung 4). Die
// Nachrechnung prüft ihn.
import type { DayRange } from '../../shared/degreeDays.ts'
import type { Co2Refund, Co2StageRange, PeriodKey } from '../../shared/types.ts'
import { dayBefore, eventPeriodEnd, shiftMonths } from '../../shared/law/register.ts'
import type { Co2Stage } from '../../shared/law/co2kostaufg.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { roundSpecific, stageOf, stageRanges, tableFactor } from './co2.ts'
import { blendedPermille, termsFromPieces, type Piece } from './halfSplit.ts'

export type RefundBasis = Pick<Co2Refund, 'billedFrom' | 'billedTo' | 'emissionsKg' | 'co2CostCents' | 'areaM2' | 'ownAppliances' | 'commercialUse' | 'commercialMetered' | 'nonResidential' | 'restriction' | 'halfSplitFrom' | 'gridFeeCents' | 'bioCostCents'>

// `applicable`: § 11 Abs. 2 für den Zeitraum des Lieferanten; `ranges`: Stufentabelle, bei einem Zeitraum unter
// einem Jahr gekürzt (§ 5 Abs. 3 Satz 4); `restriction`: § 9 aus dem Register, `null` ohne Vorgabe; `pieces`:
// die Fassungen von `co2.half-split` über den Zeitraum des Lieferanten; `weigh`: Gradtage (Abweichung 9).
export type RefundLaw = {
  applicable: boolean
  ranges: readonly Co2StageRange[]
  decimals: number
  nonResidentialPermille: number
  restriction: { factor: number; bothSplit: boolean } | null
  cutPercent: number
  pieces: readonly Piece[]
  weigh: (r: DayRange) => number
}

// Die Rechtswerte für die Nachrechnung. `ask` fragt das Register: in der Abrechnung mit Protokoll (`law`), in der
// Liste der Erstattungen ohne (`valueAt`, Werte zum Erklären außerhalb einer Abrechnung). `null`: Zeitraum des
// Lieferanten fehlt.
export type LawAsk = {
  applicable: (period: { from: string; to: string }) => boolean
  stageTable: (period: { from: string; to: string }) => readonly Co2Stage[]
  decimals: (period: { from: string; to: string }) => number
  restriction: (period: { from: string; to: string }) => { factor: number; bothSplit: boolean }
  selfSupply: (date: string) => { nonResidentialPermille: number; ownAppliancesCutPercent: number }
  pieces: (period: { from: string; to: string }) => RefundLaw['pieces']
  degreeDays: (period: { from: string; to: string }) => DegreeDayTable
}

export function refundLawAt(b: RefundBasis & { supplierBilledAt: string }, ask: LawAsk): RefundLaw | null {
  if (b.billedFrom === null || b.billedTo === null) return null
  const period = { from: b.billedFrom, to: b.billedTo }
  const applicable = ask.applicable(period)
  if (!applicable) return { applicable, ranges: [], decimals: 1, nonResidentialPermille: 0, restriction: null, cutPercent: 0, pieces: [], weigh: () => 0 }
  // § 5 Abs. 3 Satz 4 i. V. m. Abs. 1 Satz 4: Zeitraum des Lieferanten unter einem Jahr.
  const short = period.to < dayBefore(shiftMonths(period.from, 12))
  const self = ask.selfSupply(b.supplierBilledAt)
  const table = ask.degreeDays(period)
  return {
    applicable,
    ranges: stageRanges(ask.stageTable(period), tableFactor({ ...period, short })),
    decimals: ask.decimals(period),
    nonResidentialPermille: self.nonResidentialPermille,
    restriction: b.restriction === 'none' ? null : ask.restriction(period),
    cutPercent: self.ownAppliancesCutPercent,
    pieces: b.halfSplitFrom !== null ? ask.pieces(period) : [],
    weigh: (r) => degreeDayPermille([r], table),
  }
}

export type RefundProposal = {
  cents: number
  raw: number
  excluded: 'notApplicable' | 'commercialUnmetered' | null
  value: number | null
  stagePercent: number | null
  permille: number | null
  co2Raw: number
  gridFeeRaw: number
  bioRaw: number
  cutRaw: number
}

export function refundProposal(b: RefundBasis, l: RefundLaw): RefundProposal | null {
  if (b.billedFrom === null || b.billedTo === null || b.co2CostCents === null) return null
  const none = (excluded: 'notApplicable' | 'commercialUnmetered'): RefundProposal =>
    ({ cents: 0, raw: 0, excluded, value: null, stagePercent: null, permille: null, co2Raw: 0, gridFeeRaw: 0, bioRaw: 0, cutRaw: 0 })
  if (!l.applicable) return none('notApplicable')
  // § 6 Abs. 3 Satz 1: bei gewerblicher Nutzung nur mit getrennter Messung und Nachweis.
  if (b.commercialUse && !b.commercialMetered) return none('commercialUnmetered')
  const value = b.emissionsKg !== null && b.areaM2 !== null && b.areaM2 > 0 ? roundSpecific(b.emissionsKg / b.areaM2, l.decimals) : null
  const stage = value === null ? null : stageOf(value, l.ranges)
  // § 8 Abs. 2 statt der Stufe; § 9 Abs. 1 halbiert den Anteil „nach § 5, 6, 7 oder 8“, Abs. 2 hebt ihn auf.
  let base: number | null = b.nonResidential ? l.nonResidentialPermille : stage ? stage.landlordPercent * 10 : null
  if (base !== null && l.restriction !== null && b.restriction !== 'none') {
    base = b.restriction === 'both' ? (l.restriction.bothSplit ? base * l.restriction.factor : 0) : base * l.restriction.factor
  }
  // § 6 Abs. 2 Satz 1 n. F. mit § 5a Abs. 3: ab dem Tag, der für die Heizung des Mieters gilt (Abweichung 3);
  // § 9 kürzt diesen Teil nicht (wie PR 18, Abweichung 8).
  const span = { from: b.billedFrom, to: b.billedTo }
  const applicable: DayRange[] = b.halfSplitFrom !== null && b.halfSplitFrom <= span.to
    ? [{ from: b.halfSplitFrom > span.from ? b.halfSplitFrom : span.from, to: span.to }]
    : []
  const permille = blendedPermille(base, termsFromPieces(l.pieces, applicable, l.weigh, (v) => v.co2Permille))
  if (permille === null) return null
  const half = (pick: (v: Piece['value']) => number | null): number =>
    termsFromPieces(l.pieces, applicable, l.weigh, pick).reduce((a, t) => a + (t.weight * t.permille) / 1000, 0)
  const co2Raw = (b.co2CostCents * permille) / 1000
  const gridFeeRaw = (b.gridFeeCents ?? 0) * half((v) => v.gridFeePermille)
  const bioRaw = (b.bioCostCents ?? 0) * half((v) => v.bioPermille)
  const before = co2Raw + gridFeeRaw + bioRaw
  // § 6 Abs. 3 Satz 2: der ganze Anspruch nach Abs. 2 um den Satz gekürzt.
  const cutRaw = b.ownAppliances ? (before * l.cutPercent) / 100 : 0
  const raw = before - cutRaw
  return { cents: Math.round(raw), raw, excluded: null, value, stagePercent: stage?.landlordPercent ?? null, permille, co2Raw, gridFeeRaw, bioRaw, cutRaw }
}

export type RefundStepText = { euro: (cents: number) => string; exact: (cents: number) => string; num: (n: number) => string; applicableFrom: string; cutPercent: number }

// Der Rechenweg der Gutschriftzeile (#114): die Nachrechnung, soweit die Grundlagen eingetragen sind, und der
// angezeigte Betrag, wenn er abweicht oder keine Nachrechnung möglich ist.
export function refundSteps(p: RefundProposal | null, b: RefundBasis, amountCents: number, t: RefundStepText): { label: string; value: string }[] {
  const shown = { label: 'Betrag laut Anzeige', value: t.euro(amountCents) }
  if (!p) return [shown]
  if (p.excluded === 'notApplicable') return [{ label: 'Nachgerechnet', value: `kein Anspruch: Der Zeitraum des Lieferanten beginnt vor dem ${t.applicableFrom} (§ 11 Abs. 2 CO2KostAufG)` }, shown]
  if (p.excluded === 'commercialUnmetered') return [{ label: 'Nachgerechnet', value: 'kein Anspruch ohne getrennte Messung des Wärmeverbrauchs bei gewerblicher Nutzung (§ 6 Abs. 3 Satz 1 CO2KostAufG)' }, shown]
  const steps: { label: string; value: string }[] = []
  if (p.value !== null && b.emissionsKg !== null && b.areaM2 !== null) {
    steps.push({ label: 'CO₂-Ausstoß je m² und Jahr', value: `${t.num(b.emissionsKg)} kg ÷ ${t.num(b.areaM2)} m² = ${t.num(p.value)} kg` })
  }
  steps.push({ label: 'Anteil des Vermieters', value: `${t.num((p.permille ?? 0) / 10)} %` })
  steps.push({ label: 'CO₂-Kosten des Vermieters', value: `${t.euro(b.co2CostCents ?? 0)} × ${t.num((p.permille ?? 0) / 10)} % = ${t.exact(p.co2Raw)}` })
  if (p.gridFeeRaw > 0) steps.push({ label: 'Netzentgelte nach § 5a', value: t.exact(p.gridFeeRaw) })
  if (p.bioRaw > 0) steps.push({ label: 'Biobrennstoff nach § 5a', value: t.exact(p.bioRaw) })
  if (p.cutRaw > 0) steps.push({ label: 'Eigene Geräte zu anderen Zwecken', value: `− ${t.cutPercent} %: − ${t.exact(p.cutRaw)} (§ 6 Abs. 3 Satz 2 CO2KostAufG)` })
  steps.push({ label: 'Nachgerechnet', value: t.euro(p.cents) })
  steps.push(shown)
  return steps
}

// § 6 Abs. 2 Satz 3: Anzeige binnen der Frist ab der Abrechnung des Lieferanten; Satz 5: Erstattung spätestens
// so lange nach der Anzeige. Fristende nach §§ 187 Abs. 1, 188 Abs. 2, 3 BGB.
export const claimDeadline = (supplierBilledAt: string, months: number): string => eventPeriodEnd(supplierBilledAt, months)
export const refundDueDate = (claimedAt: string, months: number): string => eventPeriodEnd(claimedAt, months)

export type SettlementCandidate = { key: PeriodKey; from: string; deadline: string; sentAt: string | null }

// „Die nächste auf die Anzeige folgende jährliche Betriebskostenabrechnung“ (§ 6 Abs. 2 Satz 4; Abweichung 5):
// die früheste, deren Frist am Tag der Anzeige noch läuft und die nicht vorher versandt wurde.
export function nextSettlement(claimedAt: string, candidates: readonly SettlementCandidate[]): PeriodKey | null {
  const open = candidates.filter((c) => c.deadline >= claimedAt && !(c.sentAt !== null && c.sentAt.slice(0, 10) < claimedAt))
  let first: SettlementCandidate | null = null
  for (const c of open) if (first === null || c.from < first.from) first = c
  return first?.key ?? null
}
```

`server/test/law-literals.test.ts`: `'server/src/co2Refund.ts'` an `ENGINE_FILES` anhängen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/co2Refund.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS. Rechnungen: 600 € × 40 % = 240,00 €; × 0,95 = 228,00 €; § 8 Abs. 2: 300,00 €; § 9 einfach: 120,00 €;
§ 8 mit § 9: 150,00 €. Gekürzte Tabelle bei 181 von 365 Tagen: Grenzen × 0,4959, 15,0 kg liegt über 27 × 0,4959 =
13,39 und unter 32 × 0,4959 = 15,87, also Stufe 40 %: 300 € × 40 % = 120,00 €; ungekürzt Stufe 10 %: 30,00 €.

- [ ] **Step 5: Commit**

```bash
git add server/src/co2Refund.ts server/test/co2Refund.test.ts server/test/law-literals.test.ts
git commit -m "Erstattung an Selbstversorger: Nachrechnung, Fristen, nächste Abrechnung

Stufe mit gekürzter Tabelle, § 8 Abs. 2, § 9, § 6 Abs. 3 (gewerblich ohne Messung,
−5 % bei eigenen Geräten) und ab 2028 § 5a; Fristen nach §§ 187, 188 BGB.

Refs #97
Refs #85"
```

---

### Task 4: Lesen und Schreiben, Prüfungen, Routen

**Files:**
- Create: `server/src/db/co2Refunds.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/db-co2-refunds.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes: Task 1–3 (samt `refundLawAt`, `LawAsk`); `co2Refunds`, `tenancies`, `units` (schema.ts); `HeatingError`, `PeriodError`, `merged`, `has`, `asNullableFilled`, `ISO_DATE`, `oneOfOrUndefined`, `rulesForProperty`, `findClosedSettlement` (repository.ts); `readCo2Refunds` (read.ts); `periodOfKey`, `parsePeriodKey`, `periodLabel` (shared/period.ts); `halfSplitFirstDay` (PR 18); `co2ApplicableFrom`, `co2StageTable`, `co2RoundingDecimals`, `co2Restriction`, `co2SelfSupply`, `co2HalfSplit`, `hkvDegreeDays`, `valueAt`, `versionsIn`, `coversDate`, `germanDate`; in index.ts `readData`, `writeData`, `bodyObject`, `newId`, `propertyOf`.
- Produces:
  - db/co2Refunds.ts: `type Co2RefundView = Co2Refund & { tenantName: string; unitName: string; settleLabel: string | null; claimDeadline: string | null; refundDue: string | null; proposalCents: number | null; proposalExcluded: 'notApplicable' | 'commercialUnmetered' | null }`; `listRefunds(db, propertyId): Promise<Co2RefundView[]>`; `createRefund(db, id, body): Promise<Co2Refund>`; `updateRefund(db, id, body): Promise<Co2Refund | null>`; `removeRefund(db, id): Promise<boolean>`
  - Routen: `GET /api/co2-refunds?property=` → `Co2RefundView[]`; `POST /api/co2-refunds` → 201 `Co2Refund`; `PUT /api/co2-refunds/:id` → `Co2Refund` (404); `DELETE /api/co2-refunds/:id` → `{ ok: true }` (404)

- [ ] **Step 1: Write the failing tests**

An `server/test/db-co2-refunds.test.ts` anhängen (Importe ergänzen: `openDatabase, type OpenedDatabase` aus
`'../src/db/open.ts'`, `createEntity, closeSettlement, HeatingError, PeriodError` aus `'../src/db/repository.ts'`,
`createRefund, listRefunds, removeRefund, updateRefund` aus `'../src/db/co2Refunds.ts'`, `periodKey` aus `'../../shared/period.ts'`):

```ts
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
const rejectsWith = (status: number, text: RegExp) => (e: unknown) =>
  (e instanceof HeatingError || e instanceof PeriodError) && e.status === status && text.test(e.message)
const anzeige = { tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: 2400, co2CostCents: 60000, areaM2: 80 }

async function seed(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'w', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
    await createEntity(db, 'tenancies', 't', { unitId: 'w', tenantName: 'Meier', persons: 1, start: '2020-01-01', end: '2025-06-30', prepayments: [{ from: '2020-01', monthlyCents: 10000 }] })
  })
}

test('Anlegen, Lesen mit Nachrechnung und Fristen, Ändern, Löschen', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    const r = await opened.write((db) => createRefund(db, 'e1', { ...anzeige, settlePeriod: '2025-01' }))
    assert.deepEqual([r.amountCents, r.settlePeriod, r.restriction, r.ownAppliances], [24000, '2025-01', 'none', false])
    const [v] = await opened.read((db) => listRefunds(db, 'objekt-1'))
    assert.deepEqual([v?.tenantName, v?.settleLabel, v?.claimDeadline, v?.refundDue, v?.proposalCents], ['Meier', '2025', '2026-01-20', '2026-03-01', 24000])
    const neu = await opened.write((db) => updateRefund(db, 'e1', { ownAppliances: true, amountCents: 22800 }))
    assert.deepEqual([neu?.ownAppliances, neu?.amountCents, neu?.settlePeriod], [true, 22800, '2025-01'])
    assert.equal(await opened.write((db) => removeRefund(db, 'e1')), true)
    assert.equal(await opened.write((db) => removeRefund(db, 'e1')), false)
  })
})

test('Review Focus 2: kein Verrechnen in einem Zeitraum ohne Mietzeit oder in einem abgeschlossenen', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    await assert.rejects(opened.write((db) => createRefund(db, 'x', { ...anzeige, settlePeriod: '2026-01' })), rejectsWith(400, /wohnte im Zeitraum 2026 nicht/))
    await assert.rejects(opened.write((db) => createRefund(db, 'x', { ...anzeige, settlePeriod: '2031-13' })), rejectsWith(400, /Zeitraum/))
    await opened.write((db) => closeSettlement(db, { id: 'c', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => createRefund(db, 'y', { ...anzeige, settlePeriod: '2025-01' })), rejectsWith(409, /abgeschlossen/))
    const offen = await opened.write((db) => createRefund(db, 'z', anzeige))
    assert.equal(offen.settlePeriod, null)
  })
})

test('Prüfungen: Anzeige vor der Abrechnung des Lieferanten, verrechnet und ausgezahlt, § 5a vor 2028', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    await assert.rejects(opened.write((db) => createRefund(db, 'a', { ...anzeige, claimedAt: '2025-01-10' })), rejectsWith(400, /vor der Abrechnung des Lieferanten/))
    await assert.rejects(opened.write((db) => createRefund(db, 'b', { ...anzeige, settlePeriod: '2025-01', paidOutOn: '2025-04-01' })), rejectsWith(400, /verrechnet oder ausgezahlt/))
    await assert.rejects(opened.write((db) => createRefund(db, 'c', { ...anzeige, halfSplitFrom: '2027-06-01' })), rejectsWith(400, /01\.01\.2028/))
    await assert.rejects(opened.write((db) => createRefund(db, 'd', { ...anzeige, gridFeeCents: 100 })), rejectsWith(400, /§ 5a/))
    await assert.rejects(opened.write((db) => createRefund(db, 'e', { ...anzeige, tenancyId: 'gibt-es-nicht' })), rejectsWith(400, /Mietverhältnis/))
    const m = await opened.write((db) => createRefund(db, 'f', { ...anzeige, commercialMetered: true }))
    assert.equal(m.commercialMetered, false, 'ohne gewerbliche Nutzung keine getrennte Messung')
  })
})
```

(`closeSettlement` nimmt seit PR 7 einen `Executor`; der Rumpf des Eintrags ist der aus dem Code auf
`feat/heizung`.)

`server/test/api.test.ts` anhängen (ein eigener Server mit genau einem Objekt, nach dem Muster `const s = await startServer()` … `s.stop()` der vorhandenen Tests; `s.api<T>(pfad, init)` und `s.base`):

```ts
test('CO₂-Erstattung: Routen anlegen, lesen, ändern, löschen (Heizung PR 19)', async () => {
  const s = await startServer()
  try {
    const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
    const unit = await s.api<{ id: string }>('/api/units', post({ name: 'EG Erstattung', areaM2: 80, participates: true }))
    const tenancy = await s.api<{ id: string }>('/api/tenancies', post({ unitId: unit.id, tenantName: 'Meier', persons: 1, start: '2020-01-01', prepayments: [] }))
    const created = await fetch(`${s.base}/api/co2-refunds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenancyId: tenancy.id, supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000 }) })
    assert.equal(created.status, 201)
    const r = (await created.json()) as { id: string }
    const list = await s.api<{ id: string; tenantName: string }[]>('/api/co2-refunds')
    assert.deepEqual(list.filter((x) => x.id === r.id).map((x) => x.tenantName), ['Meier'])
    const changed = await s.api<{ amountCents: number }>(`/api/co2-refunds/${r.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 20000 }) })
    assert.equal(changed.amountCents, 20000)
    const missing = await fetch(`${s.base}/api/co2-refunds/gibt-es-nicht`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountCents: 1 }) })
    assert.equal(missing.status, 404)
    assert.equal((await fetch(`${s.base}/api/co2-refunds/${r.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await fetch(`${s.base}/api/co2-refunds/${r.id}`, { method: 'DELETE' })).status, 404)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-co2-refunds.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/db/co2Refunds.ts`.

- [ ] **Step 3: `server/src/db/co2Refunds.ts`**

```ts
// Erstattungen an Selbstversorger lesen und schreiben (Heizung PR 19, #97, #85). Die Prüfungen stehen hier, vor
// jedem Schreiben: Verrechnet wird nur in einem Zeitraum des Objekts, in dem der Mieter wohnte, und nie in einem
// abgeschlossenen (Abweichung 10).
import { eq } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import { co2Refunds, tenancies, units, CO2_RESTRICTIONS } from './schema.ts'
import { asNullableFilled, findClosedSettlement, HeatingError, ISO_DATE, merged, oneOfOrUndefined, PeriodError, rulesForProperty } from './repository.ts'
import { readCo2Refunds } from './read.ts'
import { parsePeriodKey, periodLabel, periodOfKey } from '../../../shared/period.ts'
import type { Co2Refund, PeriodKey } from '../../../shared/types.ts'
import { claimDeadline, refundDueDate, refundLawAt, refundProposal, type LawAsk } from '../co2Refund.ts'
import { co2ApplicableFrom, co2HalfSplit, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable, halfSplitFirstDay } from '../../../shared/law/co2kostaufg.ts'
import { hkvDegreeDays } from '../../../shared/law/heizkostenv.ts'
import { coversDate, germanDate, valueAt, versionsIn } from '../../../shared/law/register.ts'

export type Co2RefundView = Co2Refund & {
  tenantName: string
  unitName: string
  settleLabel: string | null
  claimDeadline: string | null
  refundDue: string | null
  proposalCents: number | null
  proposalExcluded: 'notApplicable' | 'commercialUnmetered' | null
}

// Ohne Protokoll, für die Liste.
const plainAsk: LawAsk = {
  applicable: (p) => valueAt(co2ApplicableFrom, p.from),
  stageTable: (p) => valueAt(co2StageTable, p.from),
  decimals: (p) => valueAt(co2RoundingDecimals, p.from),
  restriction: (p) => valueAt(co2Restriction, p.from),
  selfSupply: (d) => valueAt(co2SelfSupply, d),
  pieces: (p) => versionsIn(co2HalfSplit, p),
  degreeDays: (p) => valueAt(hkvDegreeDays, p.from),
}

async function tenancyInfo(db: Executor, tenancyId: string) {
  const [row] = await db
    .select({ tenantName: tenancies.tenantName, start: tenancies.start, end: tenancies.end, unitName: units.name, propertyId: units.propertyId })
    .from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(eq(tenancies.id, tenancyId))
  return row
}

export async function listRefunds(db: Database, propertyId: string): Promise<Co2RefundView[]> {
  const rules = await rulesForProperty(db, propertyId)
  const out: Co2RefundView[] = []
  for (const r of await readCo2Refunds(db)) {
    const t = await tenancyInfo(db, r.tenancyId)
    if (!t || t.propertyId !== propertyId) continue
    const covered = coversDate(co2SelfSupply, r.supplierBilledAt)
    const self = covered ? valueAt(co2SelfSupply, r.supplierBilledAt) : null
    const law = refundLawAt(r, plainAsk)
    const proposal = law ? refundProposal(r, law) : null
    const p = r.settlePeriod === null ? null : periodOfKey(rules, r.settlePeriod)
    out.push({
      ...r,
      tenantName: t.tenantName,
      unitName: t.unitName,
      settleLabel: p ? periodLabel(p) : null,
      claimDeadline: self ? claimDeadline(r.supplierBilledAt, self.claimMonths) : null,
      refundDue: self ? refundDueDate(r.claimedAt, self.refundMonths) : null,
      proposalCents: proposal?.cents ?? null,
      proposalExcluded: proposal?.excluded ?? null,
    })
  }
  return out
}

const emptyRefund = (id: string): Co2Refund => ({
  id, tenancyId: '', supplierBilledAt: '', claimedAt: '', amountCents: 0, settlePeriod: null, paidOutOn: null, billedFrom: null, billedTo: null,
  emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false, commercialUse: false, commercialMetered: false, nonResidential: false,
  restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
})
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

function mergeRefund(current: Co2Refund, body: unknown): Co2Refund {
  const next: Co2Refund = {
    id: current.id,
    tenancyId: merged(body, 'tenancyId', current.tenancyId, (v) => asNullableFilled(v) ?? ''),
    supplierBilledAt: merged(body, 'supplierBilledAt', current.supplierBilledAt, (v) => asNullableFilled(v) ?? ''),
    claimedAt: merged(body, 'claimedAt', current.claimedAt, (v) => asNullableFilled(v) ?? ''),
    amountCents: merged(body, 'amountCents', current.amountCents, (v) => nullableInt(v) ?? -1),
    settlePeriod: merged(body, 'settlePeriod', current.settlePeriod, (v) => {
      const text = asNullableFilled(v)
      return text === null ? null : parsePeriodKey(text) ?? (text as PeriodKey)
    }),
    paidOutOn: merged(body, 'paidOutOn', current.paidOutOn, asNullableFilled),
    billedFrom: merged(body, 'billedFrom', current.billedFrom, asNullableFilled),
    billedTo: merged(body, 'billedTo', current.billedTo, asNullableFilled),
    emissionsKg: merged(body, 'emissionsKg', current.emissionsKg, nullableNumber),
    co2CostCents: merged(body, 'co2CostCents', current.co2CostCents, nullableInt),
    areaM2: merged(body, 'areaM2', current.areaM2, nullableNumber),
    ownAppliances: merged(body, 'ownAppliances', current.ownAppliances, (v) => v === true),
    commercialUse: merged(body, 'commercialUse', current.commercialUse, (v) => v === true),
    commercialMetered: merged(body, 'commercialMetered', current.commercialMetered, (v) => v === true),
    nonResidential: merged(body, 'nonResidential', current.nonResidential, (v) => v === true),
    restriction: merged(body, 'restriction', current.restriction, (v) => oneOfOrUndefined(CO2_RESTRICTIONS, v) ?? 'none'),
    halfSplitFrom: merged(body, 'halfSplitFrom', current.halfSplitFrom, asNullableFilled),
    gridFeeCents: merged(body, 'gridFeeCents', current.gridFeeCents, nullableInt),
    bioCostCents: merged(body, 'bioCostCents', current.bioCostCents, nullableInt),
  }
  if (!next.commercialUse) next.commercialMetered = false
  return next
}
```

Der Wert `text as PeriodKey` bei einem ungültigen Schlüssel ist bewusst: Die Prüfung unten lehnt ihn mit einem
Satz ab (`PeriodError`), statt ihn still zu verwerfen. Weiter in derselben Datei:

```ts
async function guardRefund(db: Executor, before: Co2Refund | null, after: Co2Refund): Promise<void> {
  const t = await tenancyInfo(db, after.tenancyId)
  if (!t) throw new HeatingError(400, 'Bitte wählen Sie das Mietverhältnis, dessen Mieter die Erstattung verlangt.')
  for (const [value, what] of [[after.supplierBilledAt, 'Der Tag der Abrechnung des Lieferanten'], [after.claimedAt, 'Der Tag der Anzeige']] as const) {
    if (!ISO_DATE.test(value)) throw new HeatingError(400, `${what} fehlt oder ist kein Datum. Bitte wählen Sie ihn im Kalender.`)
  }
  for (const [value, what] of [[after.paidOutOn, 'Der Tag der Auszahlung'], [after.billedFrom, 'Der Beginn des Zeitraums'], [after.billedTo, 'Das Ende des Zeitraums'], [after.halfSplitFrom, 'Der Tag, ab dem § 5a gilt,']] as const) {
    if (value !== null && !ISO_DATE.test(value)) throw new HeatingError(400, `${what} ist kein Datum. Bitte wählen Sie ihn im Kalender.`)
  }
  if (after.claimedAt < after.supplierBilledAt) throw new HeatingError(400, 'Die Anzeige des Mieters kann nicht vor der Abrechnung des Lieferanten liegen.')
  if ((after.billedFrom === null) !== (after.billedTo === null)) throw new HeatingError(400, 'Bitte geben Sie Beginn und Ende des Zeitraums des Lieferanten an, oder keines von beiden.')
  if (after.amountCents < 0) throw new HeatingError(400, 'Der Betrag ist ein Betrag in Euro, 0 oder mehr.')
  if (after.settlePeriod !== null && after.paidOutOn !== null) throw new HeatingError(400, 'Eine Erstattung wird entweder verrechnet oder ausgezahlt, nicht beides.')
  if (after.halfSplitFrom !== null && after.halfSplitFrom < halfSplitFirstDay()) {
    throw new HeatingError(400, `Die hälftige Teilung nach § 5a CO2KostAufG gilt frühestens ab dem ${germanDate(halfSplitFirstDay())}.`)
  }
  if ((after.gridFeeCents !== null || after.bioCostCents !== null) && after.halfSplitFrom === null) {
    throw new HeatingError(400, 'Netzentgelte und Biobrennstoff zählen nur bei einer Heizung, für die § 5a CO2KostAufG gilt; tragen Sie dazu den Tag ein, ab dem er gilt.')
  }
  const rules = await rulesForProperty(db, t.propertyId)
  const closedIn = async (key: PeriodKey | null): Promise<boolean> => key !== null && (await findClosedSettlement(db as Database, t.propertyId, key)) !== undefined
  if (before && before.settlePeriod !== after.settlePeriod && (await closedIn(before.settlePeriod))) {
    throw new HeatingError(409, 'Diese Erstattung ist in einer abgeschlossenen Abrechnung verrechnet. Öffnen Sie die Abrechnung wieder, wenn Sie sie ändern wollen.')
  }
  if (after.settlePeriod !== null) {
    const key = parsePeriodKey(after.settlePeriod)
    const p = key === null ? null : periodOfKey(rules, key)
    if (!p) throw new PeriodError(`Den Zeitraum ${after.settlePeriod} gibt es für dieses Objekt nicht. Bitte wählen Sie einen Abrechnungszeitraum des Objekts.`)
    if (t.start > p.to || (t.end !== null && t.end < p.from)) {
      throw new HeatingError(400, `${t.tenantName} wohnte im Zeitraum ${periodLabel(p)} nicht und bekommt dafür keine Abrechnung. Verrechnen Sie die Erstattung in einer Abrechnung, die ${t.tenantName} bekommt, oder zahlen Sie sie aus.`)
    }
    if (await closedIn(after.settlePeriod)) {
      throw new HeatingError(409, `Die Abrechnung ${periodLabel(p)} ist abgeschlossen. Öffnen Sie sie wieder, wenn Sie die Erstattung dort verrechnen wollen.`)
    }
  }
}

export async function createRefund(db: Database, id: string, body: unknown): Promise<Co2Refund> {
  const after = mergeRefund(emptyRefund(id), body)
  await guardRefund(db, null, after)
  await db.insert(co2Refunds).values(after)
  return after
}

export async function updateRefund(db: Database, id: string, body: unknown): Promise<Co2Refund | null> {
  const before = (await readCo2Refunds(db)).find((r) => r.id === id)
  if (!before) return null
  const after = mergeRefund(before, body)
  await guardRefund(db, before, after)
  const { id: _id, ...rest } = after
  await db.update(co2Refunds).set(rest).where(eq(co2Refunds.id, id))
  return after
}

export async function removeRefund(db: Database, id: string): Promise<boolean> {
  const before = (await readCo2Refunds(db)).find((r) => r.id === id)
  if (!before) return false
  if (before.settlePeriod !== null) {
    const t = await tenancyInfo(db, before.tenancyId)
    if (t && (await findClosedSettlement(db, t.propertyId, before.settlePeriod)) !== undefined) {
      throw new HeatingError(409, 'Diese Erstattung ist in einer abgeschlossenen Abrechnung verrechnet. Öffnen Sie die Abrechnung wieder, wenn Sie sie löschen wollen.')
    }
  }
  await db.delete(co2Refunds).where(eq(co2Refunds.id, id))
  return true
}
```

(`asNullableFilled`, `merged`, `oneOfOrUndefined`, `ISO_DATE`, `HeatingError`, `PeriodError`, `rulesForProperty`,
`findClosedSettlement` sind seit PR 2–4 aus repository.ts exportiert; fehlt bei `oneOfOrUndefined` das `export`,
es ergänzen. Nimmt `findClosedSettlement` seit PR 7 einen `Executor`, entfällt `db as Database`.)

- [ ] **Step 4: Routen (`server/src/index.ts`)**

Import `createRefund, listRefunds, removeRefund, updateRefund` aus `'./db/co2Refunds.ts'`. Hinter den Routen der
Lieferungen (PR 7):

```ts
// Erstattungen an Selbstversorger (Heizung PR 19, #97, #85). Das Objekt ergibt sich beim Schreiben aus dem
// Mietverhältnis; gelistet wird je Objekt.
app.get('/api/co2-refunds', async (req, res) => {
  res.json(await readData(async (db) => listRefunds(db, await propertyOf(db, req))))
})
app.post('/api/co2-refunds', async (req, res) => {
  res.status(201).json(await writeData((db) => createRefund(db, newId(), bodyObject(req))))
})
app.put('/api/co2-refunds/:id', async (req, res) => {
  const r = await writeData((db) => updateRefund(db, req.params.id, bodyObject(req)))
  if (!r) return res.status(404).json({ error: 'Diese Erstattung gibt es nicht (mehr).' })
  res.json(r)
})
app.delete('/api/co2-refunds/:id', async (req, res) => {
  const removed = await writeData((db) => removeRefund(db, req.params.id))
  if (!removed) return res.status(404).json({ error: 'Diese Erstattung gibt es nicht (mehr).' })
  res.json({ ok: true })
})
```

`HeatingError` und `PeriodError` gibt die Fehlerbehandlung seit PR 2/4 mit ihrem Status weiter.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-co2-refunds.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/co2Refunds.ts server/src/index.ts server/test/db-co2-refunds.test.ts server/test/api.test.ts
git commit -m "Erstattungen an Selbstversorger: Lesen mit Nachrechnung, Schreiben mit Prüfungen, Routen

Verrechnet wird nur in einem Zeitraum, in dem der Mieter wohnte, und nie in einem
abgeschlossenen; verrechnet und ausgezahlt schließen sich aus.

Refs #97
Refs #85"
```

---
### Task 5: Berechnung: Gutschriftzeile, Fristhinweise, § 560 ohne Erstattung, Steuer nur über Zahlungen

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`
- Test: `server/test/calc-co2refund.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1–3 (`co2SelfSupply`, `halfSplitEnactedOn`, `Co2Refund`, `refundProposal`, `refundSteps`, `refundLawAt`, `LawAsk`, `claimDeadline`, `refundDueDate`, `nextSettlement`); `co2ApplicableFrom`, `co2StageTable`, `co2RoundingDecimals`, `co2Restriction`, `co2HalfSplit`, `co2FirstPeriodStart`, `hkvDegreeDays`, `bgbDeadlineMonths`; `law`, `coversDate`, `germanDate`; `periodsBetween`, `periodLabel`, `settlementDeadline`; in `computeSettlement` `snapshot`, `period`, `objectRules`, `statements`, `landlordRows`, `warn`, `lawLog`, `lawPeriod`, `fmtCents`, `fmtExactEuro`, `fmtNum`, `fmtDay`.
- Produces:
  - snapshot.ts: `Snapshot.co2Refunds?: Co2Refund[]`, `Snapshot.settlementsSent?: { period: PeriodKey; sentAt: string | null }[]` (beide nur gesetzt, wenn es Erstattungen gibt); Quelle von `snapshotFor` um `co2Refunds?: Co2Refund[]`
  - calc.ts: `CO2_REFUND_CATEGORY = 'CO₂-Erstattung'`, `CO2_REFUND_LABEL = 'CO₂-Erstattung bei eigener Heizung (§ 6 Abs. 2 CO2KostAufG)'`; `recurringShareCents(st: Pick<Statement, 'rows' | 'totalShareCents'>): number` (exportiert); Zeilen `kind: 'co2Refund'` unter `co2refund:<Kennung>`, Gegenzeile mit Grund `co2Refund`; Codes `co2.refund-late`, `co2.refund-not-next` (hint), `co2.refund-due` (warning), Regel `co2-self-supply`, Begriff `co2Refund`

- [ ] **Step 1: Write the failing tests**

`server/test/calc-co2refund.test.ts`:

```ts
// Erstattung an Selbstversorger in der Abrechnung (Heizung PR 19, #97, #85; Entwurf 6.4 Nr. 3, 10.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, recurringShareCents, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotSource } from '../src/snapshot.ts'
import { periodKey } from '../../shared/period.ts'
import type { Co2Refund } from '../../shared/types.ts'

const refund = (over: Partial<Co2Refund> = {}): Co2Refund => ({
  id: 'e1', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 5000, settlePeriod: periodKey('2025-01'), paidOutOn: null,
  billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false, commercialUse: false,
  commercialMetered: false, nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null, ...over,
})
// Eine Wohnung mit 80 m², Mieter seit 2020 mit 100 € Vorauszahlung, Grundsteuer 600 €; Miete 1.000 € je Monat,
// im Dezember wegen der Verrechnung nur 950 € gezahlt (G-B10).
const source = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [{ id: 'w', name: 'EG', areaM2: 80, participates: true }],
  tenancies: [{
    id: 't', unitId: 'w', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
    prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 90000 }],
  }],
  costItems: [{ id: 'gs', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }],
  meters: [], readings: [],
  payments: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, tenancyId: 't', date: `2025-${String(i + 1).padStart(2, '0')}-01`, amountCents: i === 11 ? 95000 : 100000 })),
  closedSettlements: [],
  ...over,
})
const snap = (refunds: Co2Refund[], sent: { period: string; sentAt: string | null }[] = [], over: Partial<SnapshotSource> = {}): Snapshot => ({
  ...snapshotOf(source(over), 2025),
  co2Refunds: refunds,
  settlementsSent: sent.map((x) => ({ period: periodKey(x.period), sentAt: x.sentAt })),
})
const statementOf = (r: ComputedSettlement) => r.statements.find((s) => s.tenancyId === 't') ?? assert.fail('kein Statement')
const codes = (r: ComputedSettlement) => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string => r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}`)
const VERSANDT_2024 = [{ period: '2024-01', sentAt: '2025-02-15' }]

test('Verrechnet: Gutschriftzeile beim Mieter, Gegenzeile beim Vermieter, Σ der Zeilen bleibt Σ der Positionen', () => {
  const r = computeSettlement(snap([refund()], VERSANDT_2024))
  const st = statementOf(r)
  const zeile = st.rows.find((row) => row.kind === 'co2Refund') ?? assert.fail('keine Gutschriftzeile')
  assert.deepEqual([zeile.costItemId, zeile.shareCents, zeile.category, zeile.description], ['co2refund:e1', -5000, 'CO₂-Erstattung', 'CO₂-Erstattung bei eigener Heizung (§ 6 Abs. 2 CO2KostAufG)'])
  assert.equal(st.totalShareCents, 55000)
  assert.equal(st.balanceCents, 120000 - 55000)
  const gegen = r.landlord.rows.find((row) => row.costItemId === 'co2refund:e1') ?? assert.fail('keine Gegenzeile')
  assert.deepEqual(gegen.landlordParts, [{ reason: 'co2Refund', cents: 5000 }])
  const summe = r.statements.reduce((a, s) => a + s.rows.reduce((b, row) => b + row.shareCents, 0), 0) + r.landlord.rows.reduce((a, row) => a + row.shareCents, 0)
  assert.equal(summe, 60000)
  assert.ok(!codes(r).some((c) => c.startsWith('co2.refund')), codes(r).join())
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.self-supply'))
})

test('Review Focus 3: der Vorschlag nach § 560 Abs. 4 BGB bleibt ohne die Erstattung', () => {
  const ohne = statementOf(computeSettlement(snap([])))
  const mit = statementOf(computeSettlement(snap([refund()], VERSANDT_2024)))
  assert.equal(mit.suggestedMonthlyCents, ohne.suggestedMonthlyCents)
  assert.equal(recurringShareCents(mit), 60000)
})

test('Review Focus 1 (G-B10): Die Steuer liest nur die Zahlungen; 950 € statt 1.000 € senkt das Ist um 50 €, nicht um 100 €', () => {
  const mit = taxReport(snap([refund()], VERSANDT_2024))
  const ohne = taxReport(snap([]))
  assert.equal(mit.income.paidCents, 11 * 100000 + 95000)
  assert.equal(mit.income.paidCents, ohne.income.paidCents)
  assert.deepEqual(mit.expenses, ohne.expenses)
})

test('co2.refund-late: Anzeige mehr als zwölf Monate nach der Abrechnung des Lieferanten', () => {
  const r = computeSettlement(snap([refund({ supplierBilledAt: '2023-11-01', claimedAt: '2025-03-01' })], VERSANDT_2024))
  assert.match(textOf(r, 'co2.refund-late'), /endete am 01\.11\.2024/)
  assert.equal(r.notices.find((n) => n.code === 'co2.refund-late')?.level, 'hint')
})

test('co2.refund-not-next: Die Abrechnung 2024 war bei der Anzeige noch offen; ohne Vorauszahlung kein Verrechnen', () => {
  assert.match(textOf(computeSettlement(snap([refund()])), 'co2.refund-not-next'), /die für 2024/)
  const ohneVZ = computeSettlement(snap([refund()], VERSANDT_2024, {
    tenancies: [{ id: 't', unitId: 'w', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  }))
  assert.match(textOf(ohneVZ, 'co2.refund-not-next'), /keine Vorauszahlung/)
})

test('Review Focus 4: co2.refund-due in jeder Abrechnung ab der Fälligkeit, bis verrechnet oder ausgezahlt', () => {
  const offen = refund({ claimedAt: '2024-02-10', supplierBilledAt: '2024-01-15', settlePeriod: null })
  const r = computeSettlement(snap([offen]))
  const n = r.notices.find((x) => x.code === 'co2.refund-due') ?? assert.fail('keine Warnung')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /spätestens am 10\.02\.2025/)
  assert.ok(!codes(computeSettlement(snap([{ ...offen, paidOutOn: '2025-01-15' }]))).includes('co2.refund-due'))
  assert.ok(!codes(computeSettlement(snap([refund({ settlePeriod: null })]))).includes('co2.refund-due'), 'erst am 01.03.2026 fällig')
  const gewerbe = computeSettlement(snap([{ ...offen, nonResidential: true }]))
  assert.match(textOf(gewerbe, 'co2.refund-due'), /§ 8 Abs\. 2/)
})

test('Wer nichts einstellt, merkt nichts: ohne Erstattung kein Wert co2.self-supply', () => {
  const r = computeSettlement(snap([]))
  assert.ok(!(r.legalBasis.values ?? []).some((v) => v.id === 'co2.self-supply'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-co2refund.test.ts`
Expected: FAIL, fehlender Export `recurringShareCents`.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

`Snapshot` hinter den Feldern von PR 17/18:

```ts
  // Erstattungen an Selbstversorger der Mietverhältnisse des Objekts (Heizung PR 19) und wann welche
  // abgeschlossene Abrechnung versandt wurde (für „die nächste auf die Anzeige folgende Abrechnung“, § 6 Abs. 2
  // Satz 4). Nur gesetzt, wenn es Erstattungen gibt.
  co2Refunds?: Co2Refund[]
  settlementsSent?: { period: PeriodKey; sentAt: string | null }[]
```

Die Quelle von `snapshotFor` bekommt `co2Refunds?: Co2Refund[]`; die abgeschlossenen Abrechnungen tragen dort
`sentAt` schon (Stock aus read.ts). In `snapshotFor` nach dem Eingrenzen auf das Objekt:

```ts
  const tenancyIds = new Set(narrowed.tenancies.map((t) => t.id))
  const refunds = (source.co2Refunds ?? []).filter((r) => tenancyIds.has(r.tenancyId))
  const refundPart = refunds.length > 0
    ? {
      co2Refunds: refunds,
      settlementsSent: narrowed.closedSettlements.map((c) => ({ period: c.period, sentAt: 'sentAt' in c && typeof c.sentAt === 'string' ? c.sentAt : null })),
    }
    : {}
```

und `...refundPart` in das zurückgegebene Objekt (heißt das eingegrenzte Ergebnis anders als `narrowed`, das
dortige nehmen; `Co2Refund` als Typ aus `'../../shared/types.ts'`).

- [ ] **Step 4: Berechnung (`server/src/calc.ts`)**

Importe: `co2SelfSupply` (zu den Importen aus `'../../shared/law/co2kostaufg.ts'`, dazu `co2FirstPeriodStart`,
falls nicht vorhanden); aus `'./co2Refund.ts'` `claimDeadline, nextSettlement, refundDueDate, refundProposal,
refundSteps`. Bei den Konstanten oben:

```ts
// Erstattung an Selbstversorger (Heizung PR 19, #97, #85).
const CO2_REFUND_CATEGORY = 'CO₂-Erstattung'
const CO2_REFUND_LABEL = 'CO₂-Erstattung bei eigener Heizung (§ 6 Abs. 2 CO2KostAufG)'

// Was ein Mieter im Zeitraum an wiederkehrenden Kosten trägt: ohne Erstattungen, denn eine Erstattung fällt nicht
// wieder an (§ 560 Abs. 4 BGB: angemessen sind die voraussichtlichen Kosten, BGH VIII ZR 294/10; Abweichung 11).
export const recurringShareCents = (st: Pick<Statement, 'rows' | 'totalShareCents'>): number =>
  st.totalShareCents - st.rows.filter((r) => r.kind === 'co2Refund').reduce((a, r) => a + r.shareCents, 0)
```

`noticeKinds` hinter den Codes von PR 18:

```ts
  // Heizung PR 19: Erstattung an Selbstversorger (Entwurf 10.1).
  'co2.refund-late': { level: 'hint', title: 'CO₂-Erstattung nach Ablauf der Frist angezeigt', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-not-next': { level: 'hint', title: 'CO₂-Erstattung nicht in der nächsten Abrechnung', rule: 'co2-self-supply', terms: ['co2Refund'] },
  'co2.refund-due': { level: 'warning', title: 'CO₂-Erstattung fällig', rule: 'co2-self-supply', terms: ['co2Refund'] },
```

In `computeSettlement` direkt vor `// Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.`:

```ts
  // ---------- Erstattung an Selbstversorger (§ 6 Abs. 2 CO2KostAufG, Heizung PR 19) ----------
  // Verrechnet in diesem Zeitraum: eine Gutschriftzeile beim Mieter und die Gegenzeile beim Vermieter; die
  // Summe aller Zeilen bleibt die der Positionen. Nicht verrechnet und nicht ausgezahlt: ab der Fälligkeit
  // eine Warnung in jeder Abrechnung (Abweichung 6). Die Steuer liest nichts davon (6.4 Nr. 3).
  for (const r of snapshot.co2Refunds ?? []) {
    const t = snapshot.tenancies.find((x) => x.id === r.tenancyId)
    if (!t || !coversDate(co2SelfSupply, r.supplierBilledAt)) continue
    const self = law(co2SelfSupply, { date: r.supplierBilledAt }, lawLog)
    const due = refundDueDate(r.claimedAt, self.refundMonths)
    const st = statements.get(r.tenancyId)
    const tenancySubject: NoticeSubject = { kind: 'tenancy', id: r.tenancyId }
    if (r.settlePeriod === period.key && st) {
      const ask: LawAsk = {
        applicable: (p) => coversDate(co2ApplicableFrom, p.from) && law(co2ApplicableFrom, { period: p }, lawLog),
        stageTable: (p) => law(co2StageTable, { period: p }, lawLog),
        decimals: (p) => law(co2RoundingDecimals, { period: p }, lawLog),
        restriction: (p) => law(co2Restriction, { period: p }, lawLog),
        selfSupply: () => self,
        pieces: (p) => law(co2HalfSplit, { period: p, weights: (x) => degreeDayPermille([x], law(hkvDegreeDays, { period: p }, lawLog)) }, lawLog).map(({ from, to, value }) => ({ from, to, value })),
        degreeDays: (p) => law(hkvDegreeDays, { period: p }, lawLog),
      }
      const rl = refundLawAt(r, ask)
      const proposal = rl ? refundProposal(r, rl) : null
      const steps = refundSteps(proposal, r, r.amountCents, {
        euro: fmtCents, exact: fmtExactEuro, num: fmtNum, applicableFrom: fmtDay(co2FirstPeriodStart()), cutPercent: self.ownAppliancesCutPercent,
      })
      st.rows.push({
        costItemId: `co2refund:${r.id}`, kind: 'co2Refund', category: CO2_REFUND_CATEGORY, description: CO2_REFUND_LABEL, totalCents: -r.amountCents,
        keyLabel: 'Erstattung', basisText: `Anzeige vom ${fmtDay(r.claimedAt)}`, shareCents: -r.amountCents, labor35aCents: 0, steps,
      })
      st.totalShareCents -= r.amountCents
      landlordRows.push({
        costItemId: `co2refund:${r.id}`, category: CO2_REFUND_CATEGORY, description: CO2_REFUND_LABEL, totalCents: 0,
        keyLabel: 'Erstattung', shareCents: r.amountCents, landlordParts: [{ reason: 'co2Refund', cents: r.amountCents }],
      })
      const deadline = claimDeadline(r.supplierBilledAt, self.claimMonths)
      if (r.claimedAt > deadline) {
        warn('co2.refund-late',
          `${t.tenantName} hat die CO₂-Erstattung am ${fmtDay(r.claimedAt)} geltend gemacht; die Abrechnung des Lieferanten stammt vom ${fmtDay(r.supplierBilledAt)}. ` +
            `Die Frist von ${self.claimMonths} Monaten (§ 6 Abs. 2 Satz 3 CO2KostAufG) endete am ${fmtDay(deadline)}; Sie müssen die Erstattung dann nicht leisten. Mietfuchs verrechnet sie, weil Sie sie eingetragen haben.`,
          tenancySubject)
      }
      const months = law(bgbDeadlineMonths, { period: lawPeriod }, lawLog)
      const lived = periodsBetween(objectRules, t.start, period.to).filter((p) => t.start <= p.to && (t.end === null || t.end >= p.from))
      const candidates = lived.map((p) => ({ key: p.key, from: p.from, deadline: settlementDeadline(p, months), sentAt: snapshot.settlementsSent?.find((s) => s.period === p.key)?.sentAt ?? null }))
      const next = nextSettlement(r.claimedAt, candidates)
      const nextPeriod = lived.find((p) => p.key === next)
      if (st.prepaymentCents <= 0) {
        warn('co2.refund-not-next',
          `${t.tenantName} zahlt keine Vorauszahlung auf Betriebskosten. Verrechnen dürfen Sie die CO₂-Erstattung nach § 6 Abs. 2 Satz 4 CO2KostAufG nur bei vereinbarter Vorauszahlung; ` +
            `zahlen Sie sie spätestens am ${fmtDay(due)} aus (Satz 5) und tragen Sie die Auszahlung ein.`,
          tenancySubject)
      } else if (next !== period.key) {
        warn('co2.refund-not-next',
          `${t.tenantName} hat die CO₂-Erstattung am ${fmtDay(r.claimedAt)} geltend gemacht. Verrechnen dürfen Sie sie nach § 6 Abs. 2 Satz 4 CO2KostAufG in der nächsten Betriebskostenabrechnung nach der Anzeige` +
            (nextPeriod ? `, das ist die für ${periodLabel(nextPeriod)}` : '') +
            `. Sonst ist sie spätestens am ${fmtDay(due)} auszuzahlen (Satz 5).`,
          tenancySubject)
      }
      continue
    }
    const open = r.paidOutOn === null && (r.settlePeriod === null || (r.settlePeriod === period.key && !st))
    if (open && r.claimedAt <= period.to && due <= period.to) {
      warn('co2.refund-due',
        `${t.tenantName} hat am ${fmtDay(r.claimedAt)} eine CO₂-Erstattung von ${fmtCents(r.amountCents)} geltend gemacht. Sie war spätestens am ${fmtDay(due)} zu erstatten (§ 6 Abs. 2 Satz 5 CO2KostAufG). ` +
          'Verrechnen Sie sie in dieser Abrechnung oder zahlen Sie sie aus, tragen Sie den Tag der Auszahlung ein und erfassen Sie die Auszahlung als negative Zahlung im Mietkonto.' +
          (r.nonResidential
            ? ` Ob diese Frist auch im Nichtwohngebäude gilt, ist nicht geklärt: § 8 Abs. 2 verweist auf § 6 Abs. 2 Satz 2 bis 4, und seit dem ${fmtDay(halfSplitEnactedOn())} steht die Frist in Satz 5. Mietfuchs warnt vorsichtshalber.`
            : ''),
        tenancySubject)
    }
  }
```

Den Vorschlag nach § 560 Abs. 4 BGB (Zuweisung an `st.suggestedMonthlyCents` hinter `const result =`, in der
Fassung von PR 3 die Rechnung des Vorschlags) so ändern, dass jede Verwendung von `st.totalShareCents` dort
`recurringShareCents(st)` liest.

Importe ergänzen, soweit nicht vorhanden: `type NoticeSubject` aus `'../../shared/types.ts'`; `refundLawAt,
type LawAsk` aus `'./co2Refund.ts'`; `degreeDayPermille` aus `'../../shared/degreeDays.ts'`; `hkvDegreeDays` aus
`'../../shared/law/heizkostenv.ts'`; `co2HalfSplit, halfSplitEnactedOn` aus `'../../shared/law/co2kostaufg.ts'`;
`periodsBetween, periodLabel, settlementDeadline` aus `'../../shared/period.ts'`; `bgbDeadlineMonths` aus
`'../../shared/law/bgb-betrkv.ts'`; `coversDate` aus `'../../shared/law/register.ts'`. calc.ts importiert nichts
aus `db/`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-co2refund.test.ts test/calc.test.ts test/settlement-golden.test.ts test/law-literals.test.ts test/glossary.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS; Golden unverändert.

```bash
git add server/src/snapshot.ts server/src/calc.ts server/test/calc-co2refund.test.ts
git commit -m "CO₂-Erstattung in der Abrechnung: Gutschriftzeile, Fristhinweise, § 560 ohne Erstattung

Die Steuer liest nur die Zahlungen (G-B10: 950 € statt 1.000 € senkt das Ist um 50 €).

Refs #97
Refs #85"
```

---
### Task 6: Oberfläche: Karte „CO₂-Erstattung“, Erklärung in der Einrichtung, Grund beim Vermieter

**Files:**
- Create: `client/src/co2RefundForm.ts`, `client/src/components/Co2RefundsCard.tsx`
- Modify: `client/src/pages/Kosten.tsx`, `client/src/heatingForm.ts`, `client/src/landlordReasons.ts`
- Test: `client/src/co2RefundForm.test.ts` (neu), `client/src/components/Co2RefundsCard.test.tsx` (neu), `client/src/heatingForm.test.ts`, `client/src/landlordReasons.test.ts`

**Interfaces:**
- Consumes: `Co2Refund`, `Co2Restriction`, `PeriodKey` (Task 2); `Co2RefundView` (Task 4, als Typ über die Route); `RESTRICTION_OPTIONS` (fuelForm.ts, PR 7); `api`, `errorText`, `fmtEuro`, `fmtDate`, `parseEuro`; `withProperty`; `parseDecimal` (co2Form.ts, PR 6); `Term`, `useToast`, `useConfirm`; `usePeriod()` (PR 3: `key`, `label`), `useProperty()`.
- Produces:
  - `co2RefundForm.ts`: `type SettleChoice = 'open' | 'here' | 'paid'`, `SETTLE_OPTIONS`, `type Co2RefundForm`, `emptyRefundForm(tenancyId: string, areaM2: number | null): Co2RefundForm`, `refundToForm(r: Co2Refund, period: PeriodKey): Co2RefundForm`, `refundBody(form: Co2RefundForm, period: PeriodKey): { body: Record<string, unknown> } | { error: string }`, `refundStatus(r: RefundRow, period: PeriodKey): string`, `type RefundRow`
  - Komponente `Co2RefundsCard({ propertyId, period })` mit `period: { key: PeriodKey; label: string }`

- [ ] **Step 1: Write the failing tests**

`client/src/co2RefundForm.test.ts`:

```ts
// Die Karte „CO₂-Erstattung“ (Heizung PR 19): Was aus dem Formular in den Rumpf der Erstattung wird.
import { expect, test } from 'vitest'
import { emptyRefundForm, refundBody, refundStatus, refundToForm, type Co2RefundForm } from './co2RefundForm'
import { periodKey } from '../../shared/period.ts'

const P = periodKey('2025-01')
const form = (over: Partial<Co2RefundForm>): Co2RefundForm => ({ ...emptyRefundForm('t', 80), supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amount: '240,00', ...over })

test('Pflichtangaben und Betrag', () => {
  expect(refundBody(form({ claimedAt: '' }), P)).toEqual({ error: 'Bitte geben Sie den Tag der Anzeige des Mieters an.' })
  expect(refundBody(form({ amount: 'zwei' }), P)).toEqual({ error: 'Der Betrag laut Anzeige ist kein Betrag.' })
  expect(refundBody(form({}), P)).toMatchObject({ body: { tenancyId: 't', amountCents: 24000, settlePeriod: null, paidOutOn: null, areaM2: 80 } })
})

test('Verrechnen in dieser Abrechnung oder ausgezahlt', () => {
  expect(refundBody(form({ settle: 'here' }), P)).toMatchObject({ body: { settlePeriod: '2025-01', paidOutOn: null } })
  expect(refundBody(form({ settle: 'paid', paidOutOn: '' }), P)).toEqual({ error: 'Bitte geben Sie den Tag der Auszahlung an.' })
  expect(refundBody(form({ settle: 'paid', paidOutOn: '2025-04-01' }), P)).toMatchObject({ body: { settlePeriod: null, paidOutOn: '2025-04-01' } })
})

test('Grundlagen: leer heißt keine Angabe; gewerbliche Messung nur mit gewerblicher Nutzung', () => {
  const b = refundBody(form({ emissionsKg: '2400', co2Cost: '600,00', commercialUse: false, commercialMetered: true, gridFee: '', halfSplitFrom: '' }), P)
  expect(b).toMatchObject({ body: { emissionsKg: 2400, co2CostCents: 60000, commercialMetered: false, gridFeeCents: null, halfSplitFrom: null } })
})

test('Hin und zurück, und der Stand in der Liste', () => {
  const r = {
    id: 'e', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: P, paidOutOn: null,
    billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: 80, ownAppliances: true, commercialUse: false, commercialMetered: false,
    nonResidential: false, restriction: 'none' as const, halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
  }
  expect(refundToForm(r, P)).toMatchObject({ settle: 'here', amount: '240,00', ownAppliances: true })
  expect(refundStatus({ ...r, settleLabel: '2025', refundDue: '2026-03-01' }, P)).toBe('in dieser Abrechnung verrechnet')
  expect(refundStatus({ ...r, settlePeriod: periodKey('2026-01'), settleLabel: '2026', refundDue: '2026-03-01' }, P)).toBe('verrechnet in der Abrechnung 2026')
  expect(refundStatus({ ...r, settlePeriod: null, settleLabel: null, refundDue: '2026-03-01' }, P)).toBe('offen, spätestens am 01.03.2026 zu erstatten')
  expect(refundStatus({ ...r, settlePeriod: null, paidOutOn: '2025-04-01', settleLabel: null, refundDue: '2026-03-01' }, P)).toBe('ausgezahlt am 01.04.2025')
})
```

`client/src/components/Co2RefundsCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „CO₂-Erstattung“ (Heizung PR 19): Auswahlfelder zeigen den gespeicherten Wert, Speichern schickt die
// Erstattung an den Server.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2RefundsCard from './Co2RefundsCard'
import { periodKey } from '../../../shared/period.ts'

const stored = {
  id: 'e', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: '2025-01', paidOutOn: null,
  billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: 80, ownAppliances: false, commercialUse: false, commercialMetered: false,
  nonResidential: false, restriction: 'building', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
  tenantName: 'Meier', unitName: 'EG', settleLabel: '2025', claimDeadline: '2026-01-20', refundDue: '2026-03-01', proposalCents: null, proposalExcluded: null,
}
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    const data = url.startsWith('/api/co2-refunds') && method === 'GET' ? [stored]
      : url.startsWith('/api/tenancies') ? [{ id: 't', unitId: 'w', tenantName: 'Meier' }]
        : url.startsWith('/api/units') ? [{ id: 'w', name: 'EG', areaM2: 80 }]
          : { ...stored }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Bearbeiten: Auswahl „verrechnen“ und § 9 zeigen die gespeicherten Werte; Speichern schickt PUT', async () => {
  render(<Co2RefundsCard propertyId="objekt-1" period={{ key: periodKey('2025-01'), label: '2025' }} />)
  fireEvent.click(await screen.findByText('Bearbeiten'))
  const settle = screen.getByLabelText('Verrechnung')
  const restriction = screen.getByLabelText('Beschränkungen (§ 9 CO2KostAufG)')
  if (!(settle instanceof HTMLSelectElement) || !(restriction instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([settle.value, restriction.value]).toEqual(['here', 'building'])
  fireEvent.click(screen.getByText('Erstattung speichern'))
  await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/co2-refunds/e'))
  expect(sent.at(-1)?.method).toBe('PUT')
  expect(sent.at(-1)?.body).toMatchObject({ settlePeriod: '2025-01', restriction: 'building', amountCents: 24000 })
})
```

`client/src/heatingForm.test.ts`: Die Zusicherung zum Text bei „Der Mieter hat den Vertrag“ (PR 4/9) auf

```ts
  expect(heatingPlantBody(selbst, units)).toEqual({ none: expect.stringMatching(/Seite Kosten unter „CO₂-Erstattung“/) })
```

umstellen (der Name der Formularvariable wie im vorhandenen Test).

`client/src/landlordReasons.test.ts` anhängen:

```ts
test('Erstattung an Selbstversorger (Heizung PR 19)', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'co2Refund', cents: 5000 }] }))).toBe('CO₂-Erstattung an den Mieter (§ 6 Abs. 2 CO2KostAufG)')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- co2RefundForm Co2RefundsCard heatingForm landlordReasons`
Expected: FAIL, fehlende Module.

- [ ] **Step 3: `client/src/co2RefundForm.ts`**

```ts
// Die Entscheidungslogik der Karte „CO₂-Erstattung“ (Heizung PR 19, #97, #85), ohne DOM prüfbar.
import { fmtDate, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import type { Co2Refund, Co2Restriction, PeriodKey } from './types'

export type SettleChoice = 'open' | 'here' | 'paid'
export const SETTLE_OPTIONS: { value: SettleChoice; label: string }[] = [
  { value: 'open', label: 'noch offen' },
  { value: 'here', label: 'in dieser Abrechnung verrechnen' },
  { value: 'paid', label: 'ausgezahlt' },
]

export type Co2RefundForm = {
  tenancyId: string
  supplierBilledAt: string
  claimedAt: string
  amount: string
  settle: SettleChoice
  paidOutOn: string
  billedFrom: string
  billedTo: string
  emissionsKg: string
  co2Cost: string
  areaM2: string
  ownAppliances: boolean
  commercialUse: boolean
  commercialMetered: boolean
  nonResidential: boolean
  restriction: Co2Restriction
  halfSplitFrom: string
  gridFee: string
  bioCost: string
}

const centsText = (cents: number | null): string => (cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false }))

export function emptyRefundForm(tenancyId: string, areaM2: number | null): Co2RefundForm {
  return {
    tenancyId, supplierBilledAt: '', claimedAt: '', amount: '', settle: 'open', paidOutOn: '', billedFrom: '', billedTo: '', emissionsKg: '', co2Cost: '',
    areaM2: numberText(areaM2), ownAppliances: false, commercialUse: false, commercialMetered: false, nonResidential: false, restriction: 'none',
    halfSplitFrom: '', gridFee: '', bioCost: '',
  }
}

export function refundToForm(r: Co2Refund, period: PeriodKey): Co2RefundForm {
  return {
    tenancyId: r.tenancyId, supplierBilledAt: r.supplierBilledAt, claimedAt: r.claimedAt, amount: centsText(r.amountCents),
    settle: r.paidOutOn !== null ? 'paid' : r.settlePeriod === period ? 'here' : 'open',
    paidOutOn: r.paidOutOn ?? '', billedFrom: r.billedFrom ?? '', billedTo: r.billedTo ?? '', emissionsKg: numberText(r.emissionsKg),
    co2Cost: centsText(r.co2CostCents), areaM2: numberText(r.areaM2), ownAppliances: r.ownAppliances, commercialUse: r.commercialUse,
    commercialMetered: r.commercialMetered, nonResidential: r.nonResidential, restriction: r.restriction, halfSplitFrom: r.halfSplitFrom ?? '',
    gridFee: centsText(r.gridFeeCents), bioCost: centsText(r.bioCostCents),
  }
}

export function refundBody(f: Co2RefundForm, period: PeriodKey): { body: Record<string, unknown> } | { error: string } {
  if (f.tenancyId === '') return { error: 'Bitte wählen Sie den Mieter.' }
  if (f.supplierBilledAt === '') return { error: 'Bitte geben Sie den Tag an, an dem der Lieferant gegenüber dem Mieter abgerechnet hat.' }
  if (f.claimedAt === '') return { error: 'Bitte geben Sie den Tag der Anzeige des Mieters an.' }
  const amount = parseEuro(f.amount)
  if (amount === null || amount < 0) return { error: 'Der Betrag laut Anzeige ist kein Betrag.' }
  if (f.settle === 'paid' && f.paidOutOn === '') return { error: 'Bitte geben Sie den Tag der Auszahlung an.' }
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
  const co2 = euro(f.co2Cost, 'Die Angabe der CO₂-Kosten')
  const grid = euro(f.gridFee, 'Die Angabe zu den Netzentgelten')
  const bio = euro(f.bioCost, 'Die Angabe zum Biobrennstoff')
  const kg = decimal(f.emissionsKg, 'Der CO₂-Ausstoß')
  const area = decimal(f.areaM2, 'Die Wohnfläche')
  for (const v of [co2, grid, bio, kg, area]) if (v !== null && typeof v === 'object') return v
  const num = (v: number | null | { error: string }): number | null => (typeof v === 'number' ? v : null)
  return {
    body: {
      tenancyId: f.tenancyId, supplierBilledAt: f.supplierBilledAt, claimedAt: f.claimedAt, amountCents: amount,
      settlePeriod: f.settle === 'here' ? period : null, paidOutOn: f.settle === 'paid' ? f.paidOutOn : null,
      billedFrom: f.billedFrom === '' ? null : f.billedFrom, billedTo: f.billedTo === '' ? null : f.billedTo,
      emissionsKg: num(kg), co2CostCents: num(co2), areaM2: num(area), ownAppliances: f.ownAppliances, commercialUse: f.commercialUse,
      commercialMetered: f.commercialUse && f.commercialMetered, nonResidential: f.nonResidential, restriction: f.restriction,
      halfSplitFrom: f.halfSplitFrom === '' ? null : f.halfSplitFrom, gridFeeCents: num(grid), bioCostCents: num(bio),
    },
  }
}

export type RefundRow = Co2Refund & { settleLabel: string | null; refundDue: string | null }

// Der Stand einer Erstattung in der Liste.
export function refundStatus(r: RefundRow, period: PeriodKey): string {
  if (r.paidOutOn !== null) return `ausgezahlt am ${fmtDate(r.paidOutOn)}`
  if (r.settlePeriod === period) return 'in dieser Abrechnung verrechnet'
  if (r.settlePeriod !== null) return `verrechnet in der Abrechnung ${r.settleLabel ?? r.settlePeriod}`
  return r.refundDue ? `offen, spätestens am ${fmtDate(r.refundDue)} zu erstatten` : 'offen'
}
```

- [ ] **Step 4: `client/src/components/Co2RefundsCard.tsx`**

```tsx
// Die Karte „CO₂-Erstattung an Mieter mit eigener Heizung“ auf der Seite Kosten (Heizung PR 19, #97, #85;
// Abweichung 13). Liste je Objekt, Erfassen und Bearbeiten; verrechnet wird im gewählten Zeitraum.
import { useCallback, useEffect, useState } from 'react'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { withProperty } from '../property'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { RESTRICTION_OPTIONS } from '../fuelForm'
import { emptyRefundForm, refundBody, refundStatus, refundToForm, SETTLE_OPTIONS, type Co2RefundForm, type RefundRow } from '../co2RefundForm'
import type { PeriodKey } from '../types'

type View = RefundRow & { tenantName: string; unitName: string; claimDeadline: string | null; proposalCents: number | null; proposalExcluded: 'notApplicable' | 'commercialUnmetered' | null }
type TenancyInfo = { id: string; unitId: string; tenantName: string }
type UnitInfo = { id: string; name: string; areaM2: number }

export default function Co2RefundsCard({ propertyId, period }: { propertyId: string | null; period: { key: PeriodKey; label: string } }) {
  const [rows, setRows] = useState<View[]>([])
  const [tenancies, setTenancies] = useState<TenancyInfo[]>([])
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [editing, setEditing] = useState<{ id: string | null; form: Co2RefundForm } | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(async () => {
    try {
      setRows(await api<View[]>(withProperty('/api/co2-refunds', propertyId)))
      setTenancies(await api<TenancyInfo[]>(withProperty('/api/tenancies', propertyId)))
      setUnits(await api<UnitInfo[]>(withProperty('/api/units', propertyId)))
    } catch (e) {
      setError(errorText(e))
    }
  }, [propertyId])
  useEffect(() => { void load() }, [load])

  const areaOf = (tenancyId: string): number | null => {
    const t = tenancies.find((x) => x.id === tenancyId)
    return units.find((u) => u.id === t?.unitId)?.areaM2 ?? null
  }

  async function save() {
    if (!editing) return
    const result = refundBody(editing.form, period.key)
    if ('error' in result) {
      setError(result.error)
      return
    }
    try {
      if (editing.id) await api(`/api/co2-refunds/${editing.id}`, { method: 'PUT', body: JSON.stringify(result.body) })
      else await api('/api/co2-refunds', { method: 'POST', body: JSON.stringify(result.body) })
      setEditing(null)
      setError('')
      toast('Erstattung gespeichert.')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Erstattung löschen?', message: 'Die Erstattung wird gelöscht; eine Gutschrift in einer offenen Abrechnung entfällt.', confirmLabel: 'Löschen', cancelLabel: 'Abbrechen' }))) return
    try {
      await api(`/api/co2-refunds/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const set = (patch: Partial<Co2RefundForm>) => setEditing((x) => (x ? { ...x, form: { ...x.form, ...patch } } : x))
  const f = editing?.form

  return (
    <details className="card">
      <summary><h2>CO₂-Erstattung an Mieter mit eigener Heizung <Term id="co2Refund" /></h2></summary>
      <p className="muted">Heizt ein Mieter mit eigenem Vertrag (Gastherme, Ölofen), kann er einen Teil seiner CO₂-Kosten von Ihnen verlangen. Erfassen Sie hier seine Anzeige; verrechnet wird in der Abrechnung, die Sie wählen.</p>
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {`${r.tenantName} (${r.unitName}): ${fmtEuro(r.amountCents)}, angezeigt am ${fmtDate(r.claimedAt)}, ${refundStatus(r, period.key)}`}
              {r.proposalCents !== null && r.proposalCents !== r.amountCents && <span className="muted">{` · nach den Angaben gerechnet: ${fmtEuro(r.proposalCents)}`}</span>}
              {(r.settlePeriod === null || r.settlePeriod === period.key) && (
                <>
                  {' '}<button className="btn link" onClick={() => setEditing({ id: r.id, form: refundToForm(r, period.key) })}>Bearbeiten</button>
                  {' '}<button className="btn link" onClick={() => void remove(r.id)}>Löschen</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editing && <button className="btn secondary" onClick={() => setEditing({ id: null, form: emptyRefundForm(tenancies[0]?.id ?? '', areaOf(tenancies[0]?.id ?? '')) })}>Erstattung erfassen</button>}
      {f && (
        <div className="field-group">
          <label className="field">
            Mieter
            <select aria-label="Mieter" value={f.tenancyId} onChange={(e) => set({ tenancyId: e.target.value, areaM2: String(areaOf(e.target.value) ?? '') })}>
              {tenancies.map((t) => <option key={t.id} value={t.id}>{t.tenantName}</option>)}
            </select>
          </label>
          <label className="field">Abrechnung des Lieferanten vom<input type="date" value={f.supplierBilledAt} onChange={(e) => set({ supplierBilledAt: e.target.value })} /></label>
          <label className="field">Anzeige des Mieters in Textform am<input type="date" value={f.claimedAt} onChange={(e) => set({ claimedAt: e.target.value })} /></label>
          <label className="field">Betrag laut Anzeige (€)<input value={f.amount} inputMode="decimal" onChange={(e) => set({ amount: e.target.value })} /></label>
          <label className="field">
            Verrechnung
            <select aria-label="Verrechnung" value={f.settle} onChange={(e) => set({ settle: SETTLE_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'open' })}>
              {SETTLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === 'here' ? `in der Abrechnung ${period.label} verrechnen` : o.label}</option>)}
            </select>
          </label>
          {f.settle === 'paid' && <label className="field">Ausgezahlt am<input type="date" value={f.paidOutOn} onChange={(e) => set({ paidOutOn: e.target.value })} /></label>}
          <details>
            <summary>Zum Nachrechnen: Angaben aus der Rechnung des Lieferanten</summary>
            <label className="field">Zeitraum von<input type="date" value={f.billedFrom} onChange={(e) => set({ billedFrom: e.target.value })} /></label>
            <label className="field">bis<input type="date" value={f.billedTo} onChange={(e) => set({ billedTo: e.target.value })} /></label>
            <label className="field">CO₂-Ausstoß (kg)<input value={f.emissionsKg} inputMode="decimal" onChange={(e) => set({ emissionsKg: e.target.value })} /></label>
            <label className="field">CO₂-Kosten (€)<input value={f.co2Cost} inputMode="decimal" onChange={(e) => set({ co2Cost: e.target.value })} /></label>
            <label className="field">Wohnfläche (m²)<input value={f.areaM2} inputMode="decimal" onChange={(e) => set({ areaM2: e.target.value })} /></label>
            <label className="field checkline"><input type="checkbox" checked={f.ownAppliances} onChange={(e) => set({ ownAppliances: e.target.checked })} />Der Mieter nutzt den Brennstoff auch für eigene Geräte, etwa einen Gasherd (§ 6 Abs. 3 Satz 2)</label>
            <label className="field checkline"><input type="checkbox" checked={f.commercialUse} onChange={(e) => set({ commercialUse: e.target.checked })} />Der Brennstoff wird auch gewerblich genutzt (§ 6 Abs. 3 Satz 1)</label>
            {f.commercialUse && <label className="field checkline"><input type="checkbox" checked={f.commercialMetered} onChange={(e) => set({ commercialMetered: e.target.checked })} />Der Wärmeverbrauch wird getrennt gemessen und ist nachgewiesen</label>}
            <label className="field checkline"><input type="checkbox" checked={f.nonResidential} onChange={(e) => set({ nonResidential: e.target.checked })} />Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 Abs. 2)</label>
            <label className="field">
              Beschränkungen (§ 9 CO2KostAufG)
              <select aria-label="Beschränkungen (§ 9 CO2KostAufG)" value={f.restriction} onChange={(e) => set({ restriction: RESTRICTION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'none' })}>
                {RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">Hälftige Teilung nach § 5a gilt ab (nur bei einer Heizung nach § 43 GModG)<input type="date" value={f.halfSplitFrom} onChange={(e) => set({ halfSplitFrom: e.target.value })} /></label>
            {f.halfSplitFrom !== '' && (
              <>
                <label className="field">Netzentgelte laut Rechnung (€)<input value={f.gridFee} inputMode="decimal" onChange={(e) => set({ gridFee: e.target.value })} /></label>
                <label className="field">Biobrennstoff, Preisbestandteil (€)<input value={f.bioCost} inputMode="decimal" onChange={(e) => set({ bioCost: e.target.value })} /></label>
              </>
            )}
          </details>
          <button className="btn" onClick={() => void save()}>Erstattung speichern</button>
          {' '}<button className="btn secondary" onClick={() => setEditing(null)}>Abbrechen</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </details>
  )
}
```

(Im Test ist die Karte zugeklappt; `findByText('Bearbeiten')` findet die Schaltfläche trotzdem, weil `details`
seinen Inhalt im DOM hält.)

`client/src/pages/Kosten.tsx`: am Ende der Seite, hinter der Liste der Positionen,

```tsx
      <Co2RefundsCard propertyId={property?.id ?? null} period={{ key: periodView.key, label: periodView.label }} />
```

einfügen, mit `const periodView = usePeriod()` (PR 3; heißt die Variable der Seite schon anders, die vorhandene
nehmen) und `const { property } = useProperty()` (vorhanden). Import `Co2RefundsCard`.

- [ ] **Step 5: Einrichtung und Grund (`client/src/heatingForm.ts`, `landlordReasons.ts`)**

`heatingForm.ts`: `SELF_SUPPLY` ersetzen durch:

```ts
// Selbstversorger (Entwurf 11.2 Schritt 1, Heizung PR 19): keine Heizanlage; der Anspruch des Mieters nach § 6
// Abs. 2 CO2KostAufG wird erklärt und auf der Seite Kosten erfasst.
const SELF_SUPPLY = 'Hat jeder Mieter einen eigenen Vertrag für seine Heizung, gibt es keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. Der Mieter kann dann einen Teil seiner CO₂-Kosten von Ihnen verlangen (§ 6 Abs. 2 CO2KostAufG); Sie erfassen seine Anzeige auf der Seite Kosten unter „CO₂-Erstattung“ und verrechnen sie in der Betriebskostenabrechnung. Weisen Sie neue Mieter bei Vertragsschluss in Textform auf den Anspruch hin (§ 6 Abs. 2 Satz 6).'
```

`landlordReasons.ts`, in `LABELS`: `co2Refund: 'CO₂-Erstattung an den Mieter (§ 6 Abs. 2 CO2KostAufG)',`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- co2RefundForm Co2RefundsCard heatingForm landlordReasons && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add client/src
git commit -m "Oberfläche: CO₂-Erstattung an Mieter mit eigener Heizung erfassen und verrechnen

Refs #97
Refs #85"
```

---

### Task 7: Doku und Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks.
- Produces: Doku.

- [ ] **Step 1: CHANGELOG (`CHANGELOG.md`, „Unveröffentlicht“)**

```markdown
### Hinzugefügt

- **CO₂-Erstattung an Mieter mit eigener Heizung** ([#97](https://github.com/speedone/mietfuchs/issues/97),
  [#85](https://github.com/speedone/mietfuchs/issues/85)): Heizt ein Mieter mit eigenem Vertrag, erfassen Sie auf
  der Seite Kosten seine Anzeige nach § 6 Abs. 2 CO2KostAufG. Mietfuchs rechnet nach (Stufe, gekürzte Tabelle bei
  kürzerem Zeitraum des Lieferanten, Nichtwohngebäude, Beschränkungen nach § 9, 5 % weniger bei eigenen Geräten
  wie einem Gasherd, kein Anspruch bei gewerblicher Nutzung ohne getrennte Messung, ab 2028 die hälftige
  Teilung), verrechnet den Betrag als Gutschrift in der Betriebskostenabrechnung und nennt die Fristen für
  Anzeige, Verrechnung und Auszahlung. In der Steuerübersicht zählen nur die Zahlungen.
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt **Berechnungs-Engine** hinter dem Absatz zu § 5a (PR 18):

```markdown
- **Erstattung an Selbstversorger** (Heizung PR 19, #97, #85): `co2_refunds` am Mietverhältnis. Gebucht wird der
  angezeigte Betrag als Zeile `co2Refund` (Kostenart `CO₂-Erstattung`, ohne Position) mit Gegenzeile beim
  Vermieter; die Nachrechnung (`server/src/co2Refund.ts`) steht nur im Rechenweg. Verrechnet wird nur in einem
  Zeitraum, in dem der Mieter wohnte, und nie in einem abgeschlossenen. **Die Steuer liest nur die Zahlungen**
  (G-B10), und der Vorschlag nach § 560 Abs. 4 BGB rechnet mit `recurringShareCents` ohne Erstattungen. Offen ist,
  ob § 8 Abs. 2 seit der Neufassung von § 6 Abs. 2 noch auf die Auszahlungsfrist verweist; Mietfuchs warnt.
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, Exit-Status 0.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle grün (neue Tabelle, leer).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: CO₂-Erstattung an Selbstversorger

Refs #97
Refs #85"
```

- [ ] **Step 5: Durchsicht vor dem PR (CLAUDE.md)**

Eine Durchsicht mit frischem Kontext über `feat/heizung-pr18-ab-2028..feat/heizung-pr19-selbstversorger`; Befunde
mit einem Test beheben, der vorher rot war, und in der PR-Beschreibung nennen. Die PR-Beschreibung nennt
`Refs #97`, `Refs #85` (nie `Fixes`), die Abweichungen 1–13 und den Vorschlag für die offene Frage 15.1 Nr. 25
(§ 8 Abs. 2 und die Auszahlungsfrist). #97 und #85 werden erst beim Release geschlossen.

---

## Selbstprüfung

**Abdeckung des Entwurfs:**

| Entwurf | Task |
|---|---|
| 13 PR 19: `co2_refunds` (5.1, 5.5; CO₂-Entwurf 4.5) | 2 |
| Gutschriftzeile (5.7 `SettlementRow.kind` `co2Refund`, `LandlordReason` `co2Refund`; CO₂-Entwurf 5.8) | 2, 5 |
| Fristhinweise, 12 Monate (`co2.refund-late`, `co2.refund-not-next`, `co2.refund-due`, 10.1; `co2.self-supply`, 4.3) | 1, 3, 5 |
| § 8 (Abs. 2), § 9 in der Rechenhilfe (CO₂-Entwurf A15) | 3 |
| −5 % (§ 6 Abs. 3 Satz 2) | 1, 3 |
| Steuer nur über Zahlungen (6.4 Nr. 3, G-B10, Testfall 50 €/950 €) | 5 |
| Regel `co2-self-supply` (10.2), Begriff `co2Refund` (10.3) | 1 |
| Erklärung in der Einrichtung (11.2 Schritt 1) | 6 |
| 14.1 „Etagenheizung, Vertrag beim Mieter → Erstattung“ | 2–6 |

**Platzhalter:** keine. Wo ein Name eines noch nicht umgesetzten Vorgängers steht, ist die Rolle genannt.

**Typen und Namen:** `Co2Refund` (Task 2) in co2Refund.ts (`RefundBasis`, Task 3), db/co2Refunds.ts (Task 4),
snapshot.ts und calc.ts (Task 5), co2RefundForm.ts (Task 6); `refundLawAt`/`LawAsk` stehen in co2Refund.ts (Task 3)
und werden in Task 4 (ohne Protokoll) und Task 5 (mit Protokoll) benutzt; `co2SelfSupply` und
`halfSplitEnactedOn` (Task 1) in Task 4 und 5; `recurringShareCents` (Task 5) im Test von Task 5.

**Review Focus:** 1 → Task 5 („Review Focus 1 (G-B10) …“); 2 → Task 4 („Review Focus 2 …“); 3 → Task 5 („Review
Focus 3 …“); 4 → Task 5 („Review Focus 4 …“); 5 → Task 3 („30,0 kg/m² … Gasherd“, „§ 6 Abs. 3 Satz 1 …“).
