# Heizung PR 14: Pflichtangaben und Ausnahmen (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die eigene Heizkostenabrechnung enthält die Informationen nach § 6a Abs. 3 HeizkostenV
(Energieträger und bei Fernwärme Treibhausgasemissionen und Primärenergiefaktor, Steuern und Abgaben,
Entgelte der Erfassung, Kontaktinformationen, Streitbeilegung beim Verbrauchervertrag, Vergleich mit dem
Hausdurchschnitt, witterungsbereinigter Vergleich mit dem Vorzeitraum mit dem Klimafaktor des DWD je
Postleitzahl, grafisch); jede fehlende Nummer nennt die Kürzung um 3 % je Mieter. Dazu die Warnung zur
monatlichen Verbrauchsinformation bei fernablesbaren Geräten, die Ausnahmen des § 11 (keine
Kürzungshinweise, CO₂ nach § 2 Abs. 7 CO2KostAufG), die Vereinbarung nach § 2 im Zweifamilienhaus, der
Hinweis zu § 7 Abs. 1 Satz 2 und mehr als 70 % nach Verbrauch nur mit Vereinbarung (§ 10).

**Architecture:** Vier Spalten an `heating_plants` (`exemption`, `exemption_billing_agreed`,
`agreed_otherwise`, `monthly_info_elsewhere`) in zwei erzeugten Schritten `0033_pflichtangaben` und
`0034_pflichtangaben_bedingungen`; die Spalten des § 6a an `heating_periods` gibt es seit PR 4. Die
Rechnung der Angaben steht als reine Funktion in der neuen Datei `server/src/heatingInfo.ts`
(`heatingInfoOf`); `computeSettlement` hängt das Ergebnis je Anlage und Heizperiode an
`Settlement.heating[].info`, meldet `heating.info-incomplete`, `heating.monthly-info`,
`heating.exemption` und `heating.insulation-rule-unknown` und nennt für Anlagen mit Ausnahme oder
wirksamer Vereinbarung an keiner Stelle eine Kürzung nach § 12 (`suspendedBy`). Die Seite Heizkosten
bekommt die Karte „Angaben zur Abrechnung (§ 6a)“, die Stammdaten der Heizung die Fragen zu § 11, § 2 und
zur monatlichen Information, die Abrechnung den Druckblock mit Balken.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
**8.8 ganz** (§ 6a Abs. 3, fehlende Angaben, monatliche Information, Abs. 5), **8.9** (Zweifamilienhaus,
§ 11), 8.5 (§ 7 Abs. 1 Satz 2, § 10), 0.5 (R-A17), 4.3 (`hkv.cut.information`), 4.8 Nr. 4
(Kontaktadressen jährlich prüfen), 5.3 (`exemption`, `agreed_otherwise`, `heating_periods` Gruppe
„§ 6a Abs. 3“, `above_70_agreed`, `insulation_rule`), 6.5 (Zeile „Informationen § 6a“), 10.1
(`heating.info-incomplete`, `heating.monthly-info`, `heating.insulation-rule-unknown`,
`heating.exemption`), 10.2 (`heating-info`), 10.3 (`billingInfo`, `climateFactor`), 11.2 Schritt 7,
13 (PR 14, PR 22), 14.1 (Zeilen „Pflichtangaben § 6a Abs. 3“, „Monatliche Verbrauchsinformation“,
„Zweifamilienhaus mit Eigennutzung“, „Ausnahmen § 11“), **15.1 Nr. 8 und 14**, **15.2 F5**, **15.3**
(Zeile „Durchschnittsnutzer und Witterungsbereinigung“, ⟨Norm offen: DIN 94680⟩).

**Baut auf:** PR 1 und PR 2 (Code auf `feat/heizung`), PR 3 bis PR 13 nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3..13}-*.md`, maßgeblich PR 10 (Commit `81828af`) und
PR 13 (Vorperiode `SelfPlantPlan.prev`). Gearbeitet wird auf `feat/heizung-pr14-pflichtangaben`,
abgezweigt von der Spitze von PR 13; gestapelt auf PR 13, nach dessen Merge auf `main` umgestellt.

**Norm ⟨Norm offen: DIN 94680⟩:** Vor PR 14 soll DIN 94680:2024-05 vorliegen (Entwurf 13 Phase C, 15.3).
Fehlt sie, wird dieser Plan unverändert gebaut; die Marke steht dann im Druckblock (Nr. 4 und 5), im
Lexikon (`climateFactor`) und im Code an `heatingInfoOf`. Weicht die Norm ab, ist das ein Befund für die
Durchsicht, kein stiller Umbau.

**Wortlaut, gelesen am 05.10.2026 auf gesetze-im-internet.de** (HeizkostenV in der Fassung Art. 3 G v.
16.10.2023; CO2KostAufG und BGB in der geltenden Fassung):

- § 6a Abs. 1 HeizkostenV: „Wenn fernablesbare Ausstattungen zur Verbrauchserfassung installiert
  wurden, hat der Gebäudeeigentümer den Nutzern Abrechnungs- oder Verbrauchsinformationen … mitzuteilen:
  1. für alle Abrechnungszeiträume, die ab dem 1. Dezember 2021 beginnen a) auf Verlangen des Nutzers …
  mindestens vierteljährlich und b) ansonsten mindestens zweimal im Jahr, 2. ab dem 1. Januar 2022
  monatlich.“ Abs. 2: Mindestinhalt (Verbrauch des letzten Monats in Kilowattstunden, Vergleich mit
  Vormonat und Vorjahresmonat, Vergleich mit einem Durchschnittsnutzer).
- § 6a Abs. 3 Satz 1: „Wenn die Abrechnungen auf dem tatsächlichen Verbrauch oder auf den Ablesewerten
  von Heizkostenverteilern beruhen, muss der Gebäudeeigentümer den Nutzern für Abrechnungszeiträume, die
  ab dem 1. Dezember 2021 beginnen, zusammen mit den Abrechnungen folgende Informationen zugänglich
  machen: 1. Informationen über a) den Anteil der eingesetzten Energieträger und bei Nutzern, die mit
  Fernwärme aus Fernwärmesystemen versorgt werden, auch über die damit verbundenen jährlichen
  Treibhausgasemissionen und den Primärenergiefaktor des Fernwärmenetzes, bei Fernwärmesystemen mit
  einer thermischen Gesamtleistung unter 20 Megawatt jedoch erst ab dem 1. Januar 2022, b) die erhobenen
  Steuern, Abgaben und Zölle, c) die Entgelte für die Gebrauchsüberlassung und Verwendung der
  Ausstattungen zur Verbrauchserfassung, einschließlich der Eichung, sowie für die Ablesung und
  Abrechnung, 2. Kontaktinformationen, darunter Internetadressen von Verbraucherorganisationen,
  Energieagenturen oder ähnlichen Einrichtungen, bei denen Informationen über angebotene Maßnahmen zur
  Energieeffizienzverbesserung, Endnutzer-Vergleichsprofile und objektive technische Spezifikationen
  für energiebetriebene Geräte eingeholt werden können, 3. im Falle eines Verbrauchervertrags nach § 310
  Absatz 3 des Bürgerlichen Gesetzbuches die Information über die Möglichkeit der Durchführung von
  Streitbeilegungsverfahren nach dem Verbraucherstreitbeilegungsgesetz, wobei die §§ 36 und 37 des
  Verbraucherstreitbeilegungsgesetzes unberührt bleiben, 4. Vergleiche mit dem Verbrauch eines
  normierten oder durch Vergleichstests ermittelten Durchschnittsnutzers derselben Nutzerkategorie, …
  5. einen Vergleich des witterungsbereinigten Energieverbrauchs des jüngsten Abrechnungszeitraums des
  Nutzers mit seinem witterungsbereinigten Energieverbrauch im vorhergehenden Abrechnungszeitraum in
  grafischer Form.“ Sätze 2 bis 4: Der Energieverbrauch nach Nr. 5 umfasst Wärme- und
  Warmwasserverbrauch; der Wärmeverbrauch ist nach den anerkannten Regeln der Technik
  witterungszubereinigen; vermutet wird das bei Vereinfachungen, die BMWi und BMI gemeinsam im
  Bundesanzeiger bekannt gemacht haben.
- § 6a Abs. 5: „Abrechnungen, die nicht auf dem tatsächlichen Verbrauch oder auf den Ablesewerten von
  Heizkostenverteilern beruhen, müssen mindestens die Informationen gemäß Absatz 3 Satz 1 Nummer 2 und 3
  enthalten.“
- § 12 Abs. 1 Satz 3: „Dasselbe ist anzuwenden, wenn der Gebäudeeigentümer die Informationen nach § 6a
  nicht oder nicht vollständig mitteilt.“ (Satz 2: 3 vom Hundert.)
- § 2: „Außer bei Gebäuden mit nicht mehr als zwei Wohnungen, von denen eine der Vermieter selbst
  bewohnt, gehen die Vorschriften dieser Verordnung rechtsgeschäftlichen Bestimmungen vor.“
- § 7 Abs. 1 Satz 2: „In Gebäuden, die das Anforderungsniveau der Wärmeschutzverordnung vom 16. August
  1994 (BGBl. I S. 2121) nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt werden und in denen
  die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt sind, sind von den Kosten des
  Betriebs der zentralen Heizungsanlage 70 vom Hundert nach dem erfassten Wärmeverbrauch der Nutzer zu
  verteilen.“ § 7 Abs. 3: Für Wärmelieferung gilt Abs. 1 Satz 1 und 3 bis 5 entsprechend.
- § 10: „Rechtsgeschäftliche Bestimmungen, die höhere als die in § 7 Absatz 1 und § 8 Absatz 1
  genannten Höchstsätze von 70 vom Hundert vorsehen, bleiben unberührt.“
- § 11 Abs. 1: Soweit sich §§ 3 bis 7 auf die Versorgung mit Wärme beziehen, sind sie nicht anzuwenden
  „1. auf Räume, a) in Gebäuden, die einen Heizwärmebedarf von weniger als 15 kWh/(m²·a) aufweisen,
  b) bei denen das Anbringen der Ausstattung zur Verbrauchserfassung, die Erfassung des Wärmeverbrauchs
  oder die Verteilung der Kosten des Wärmeverbrauchs nicht oder nur mit unverhältnismäßig hohen Kosten
  möglich ist; unverhältnismäßig hohe Kosten liegen vor, wenn diese nicht durch die Einsparungen, die in
  der Regel innerhalb von zehn Jahren erzielt werden können, erwirtschaftet werden können; oder c) die
  vor dem 1. Juli 1981 bezugsfertig geworden sind und in denen der Nutzer den Wärmeverbrauch nicht
  beeinflussen kann; 2. a) auf Alters- und Pflegeheime, Studenten- und Lehrlingsheime, b) …; 3. auf Räume
  in Gebäuden, die überwiegend versorgt werden a) mit Wärme aus Anlagen zur Rückgewinnung von Wärme oder
  aus Solaranlagen oder b) mit Wärme aus Anlagen der Kraft-Wärme-Kopplung oder aus Anlagen zur Verwertung
  von Abwärme, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird; 4. auf die Kosten des Betriebs
  der zugehörigen Hausanlagen, soweit diese Kosten in den Fällen des § 1 Absatz 3 nicht in den Kosten der
  Wärmelieferung enthalten sind, sondern vom Gebäudeeigentümer gesondert abgerechnet werden; 5. in
  sonstigen Einzelfällen, in denen die nach Landesrecht zuständige Stelle wegen besonderer Umstände von
  den Anforderungen dieser Verordnung befreit hat, um einen unangemessenen Aufwand oder sonstige unbillige
  Härten zu vermeiden.“ Abs. 2: Für Warmwasser (§§ 3 bis 6 und 8) gilt Abs. 1 entsprechend.
- § 2 Abs. 7 CO2KostAufG: „In den Fällen von § 11 der Verordnung über Heizkostenabrechnung ist dieses
  Gesetz nicht anzuwenden, es sei denn, die Vertragsparteien haben eine Abrechnung der Heiz- und
  Warmwasserkosten vereinbart.“
- § 556a Abs. 1 BGB: „Haben die Vertragsparteien nichts anderes vereinbart, sind die Betriebskosten
  vorbehaltlich anderweitiger Vorschriften nach dem Anteil der Wohnfläche umzulegen. Betriebskosten, die
  von einem erfassten Verbrauch oder einer erfassten Verursachung durch die Mieter abhängen, sind nach
  einem Maßstab umzulegen, der dem unterschiedlichen Verbrauch oder der unterschiedlichen Verursachung
  Rechnung trägt.“
- § 310 Abs. 3 BGB: „Bei Verträgen zwischen einem Unternehmer und einem Verbraucher
  (Verbraucherverträge) …“

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Heizanlage ist jede Zahl, jeder
  Hinweis und `legalBasis.values` gleich dem Stand nach PR 13. Golden F01–F11 bleiben wortgleich.
  **Angekündigte Änderungen** (CHANGELOG): Bei einer Anlage mit eigener Abrechnung erscheint
  `heating.info-incomplete`, solange die Angaben fehlen (Golden F16 und F17 bekommen den Hinweis; keine
  Zahl ändert sich); bei jeder Anlage, deren Geräte fernablesbar sind oder deren Fernablesbarkeit
  unbekannt ist, erscheint `heating.monthly-info` (Entwurf 8.8: `devices_remote` „nicht `none`“), bis
  der Vermieter bestätigt, dass die Mieter die Information anders bekommen. Golden F12 bis F15 bekommen
  den Hinweis, wenn ihre Anlage `devices_remote` nicht auf `none` hat; die README nennt den Grund.
- **Kürzungen nie automatisch**, je Mieter beziffert, nie summiert (Entwurf 6.5, 15.1 Nr. 4); Grundlage
  die gedruckten Zeilen nach CO₂-Abzug. Der Satz `hkv.cut.information` (3) aus dem Register.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): fünf neue Parameter, `hkv.cut.information`,
  `hkv.info.applicable-from`, `hkv.info.district-emissions`, `hkv.monthly-info`, `hkv.exemptions`
  (Abweichung 1). Keine Zahl des § 11 und kein Stichtag des § 6a steht außerhalb von `shared/law/`.
- **Fassungen nie ändern** (4.4): sieben neue Zeilen in `law-history.test.ts`, keine geänderte.
- **Stufe hängt am Code** (#112): vier Codes, je mit genau einer Stufe und mindestens einem Begriff.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte hinter `0032_schaetzung` (PR 13): `pflichtangaben` (vier `ALTER TABLE heating_plants ADD`)
  und `pflichtangaben_bedingungen` (Bedingungen an `heating_plants`, Neubau). Die Nummern vergibt
  drizzle-kit: `0033_…` und `0034_…`. Keine Datenanweisung. Marken in `migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` unverändert.
- **Sprache, Importe, Auswahlfelder, Serverstart, Commit nur bei Grün:** wie in den Plänen PR 10 bis
  PR 13 (Global Constraints dort): Bezeichner englisch, Texte deutsch und gesiezt; Server-Importe mit
  `.ts`, `import type`, `erasableSyntaxOnly`; jedes neue Auswahlfeld mit jsdom-Test; `NKA_DATA_DIR`,
  `CI=1`, `NKA_UPDATE_URL`; `npm test` und `npm run typecheck` mit Exit-Status 0; Commit deutsch mit
  `Refs #99` und den Attribution-Zeilen der ausführenden Sitzung; Aufgaben nur in GitHub-Issues.

## Review Focus

1. **Ein Mieter zieht in der Heizperiode ein; für ihn gibt es keinen Verbrauch im vorhergehenden
   Zeitraum.** Erwartet: Nr. 5 fehlt nur für ihn, als „bis zu 3 %“ mit dem Satz, dass die Verordnung
   keine Ausnahme nennt (Entwurf 15.1 Nr. 14, Auslegung); die übrigen Mieter bekommen ihren Vergleich.
   Test in Task 3 und Task 5.
2. **Der Klimafaktor des laufenden Zeitraums ist eingetragen, der des Vorzeitraums nicht.** Erwartet:
   Nr. 5 fehlt für alle Mieter mit Vorjahreswert (3 % je Mieter), und es gibt keinen halben Vergleich
   (unbereinigt gegen bereinigt). Ist der Faktor in der Zeile der vorigen Heizperiode eingetragen, gilt
   er. Test in Task 3.
3. **Zweifamilienhaus mit Vereinbarung nach § 2, später kommt eine dritte Wohnung dazu.** Erwartet:
   Setzen lässt sich die Vereinbarung nur, solange das Haus höchstens zwei Wohnungen hat und der
   Vermieter eine selbst bewohnt (400 sonst); wird das Haus größer, wirkt die gespeicherte Vereinbarung
   nicht mehr, und die Kürzungshinweise kommen zurück. Test in Task 4 und Task 5.
4. **Ausnahme nach § 11 bei einer Anlage mit CO₂-Angaben.** Erwartet: keine Kürzungshinweise nach § 12,
   keine Angaben nach § 6a gefordert (§ 6a liegt in §§ 3 bis 7), keine CO₂-Aufteilung, außer eine
   Abrechnung der Heiz- und Warmwasserkosten ist vereinbart (§ 2 Abs. 7 CO2KostAufG); der Hinweis
   `heating.exemption` sagt beides. Test in Task 5.
5. **80 % nach Verbrauch.** Erwartet: ohne Häkchen „vereinbart“ 400 mit Satz zu § 10; mit Häkchen
   gespeichert und verteilt; über 100 % nie; bei Öl- und Gasheizung nach § 7 Abs. 1 Satz 2 nie unter dem
   Pflichtanteil. Test in Task 4 und Task 5.

---

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/heizkostenv.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`, `shared/heatingInfo.ts` (neu) | fünf Parameter, Regeln `heating-info`, `heating-exemption`, Begriffe `billingInfo`, `climateFactor`, Kontaktinformationen | 1 |
| `shared/types.ts`, `server/src/db/schema.ts`, `server/drizzle/0033_pflichtangaben.sql`, `0034_pflichtangaben_bedingungen.sql`, `meta/*` (erzeugt), `server/src/db/read.ts`, `server/src/db/heating.ts`, `server/src/snapshot.ts` | Spalten, Typen, lesen, verschmelzen, Schnappschuss | 2 |
| `server/src/heatingInfo.ts` (neu), `server/src/heating.ts` | Angaben nach § 6a; § 10 und § 7 Abs. 1 Satz 2 im Anteil | 3 |
| `server/src/db/heatingInfo.ts` (neu), `server/src/db/heatingSelf.ts`, `server/src/db/heating.ts`, `server/src/db/co2.ts`, `server/src/index.ts` | speichern, prüfen, Ansicht, Route | 4 |
| `server/src/calc.ts`, `server/src/co2.ts` (nur Aufruf) | Ausweis, vier Hinweise, keine Kürzung bei Ausnahme oder Vereinbarung, CO₂ nach § 2 Abs. 7 | 5 |
| `client/src/heatingRulesForm.ts` (neu), `client/src/heatingInfoForm.ts` (neu), `client/src/heatingInfoView.ts` (neu), `client/src/components/HeatingRulesFields.tsx` (neu), `client/src/components/HeatingInfoCard.tsx` (neu), `client/src/components/HeatingInfoBlock.tsx` (neu), `client/src/components/HeatingCard.tsx`, `client/src/components/SelfHeatingCards.tsx`, `client/src/components/HeatingSelfSetup.tsx`, `client/src/heatingSelfForm.ts`, `client/src/components/SelfHeatingBlock.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/index.css` | Oberfläche | 6 |
| `CHANGELOG.md`, `CLAUDE.md`, `server/test/fixtures/heating/*/expected.json` und `README.md` | Doku, Golden | 7 |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon anders umgesetzt hat, zieht ihn hier nach, bevor Task 1 beginnt.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 | `LawParam`, `law` (Überladungen `periodStart`, `eventDate`, `overlap`), `valueAt`, `onlyVersion`, `createLawLog`, `LAW_AS_OF`, `germanDate`; `heizkostenv.ts` mit `ENACTED`, `checked`, `hkvConsumptionShare`, `hkvCutNotByConsumption`; Tests `law.test.ts` (`modules`), `law-history.test.ts` (`SHIPPED`), `law-literals.test.ts` | Code |
| Bestand calc.ts | `heatingAgreeable` (`mayAgreeOtherwise(snapshot.units, isDwelling)`), die Schleife `for (const { item, rows } of heatingCuts)`, die Schleife `for (const g of heating.shareOutside)`, der Block `heating.flat-rate` mit `heatingFlat` | Code |
| Bestand `shared/heating.ts` | `mayAgreeOtherwise(units, isDwelling)`, `HEATING_CATEGORY` | Code |
| PR 4 | `HeatingPlant` (`devicesRemote`, `units`, `energy`, `method`, `propertyId`), `HeatingPeriodData` mit `above70Agreed`, `insulationRule`, `infoTaxesText`, `infoDistrictGhg`, `infoDistrictPef`, `climateFactor`, `climateFactorPrev`, `consumerContract`, `infoContactsConfirmed`; schema.ts `heatingPlants`, `heatingPeriods`, `exactly`, `oneOf`; db/heating.ts `mergeHeatingPlant`, `emptyHeatingPlant`, `plantRow`, `guardHeatingPlant(db, before, after)`, `readHeatingPlants`; repository.ts `HeatingError`, `raw`, `has`, `merged`, `oneOfOrUndefined`; read.ts `readUnits`, `readTenancies`; calc.ts (Task 8 von PR 4) `remoteReadingVerdict(plants, meters, units, period, log)` mit `remote` und `retrofit`; Client `HeatingCard.tsx`, `heatingForm.ts` (`HeatingForm`, `heatingPlantBody`, `heatingToForm`) | Plan PR 4 |
| PR 6, 7, 11 | im CO₂-Block `co2Pots` (`pot.plantId`, `pot.items`, `pot.reliefKey`, `pot.period`), `report`, `heatingStatements`, `cutsOn(ids, pct)`, `applicable` mit `etsExempt` (PR 7), `co2DeductionsOf(pots, units, applicable)`; die Bedingung von `heating.dhw-not-metered` (PR 6, PR 11); `HeatingStatement`, `HeatingPeriodView`; db/co2.ts `heatingPeriodViews(db, plantId, periodParam, today)` mit `rows`, `h`, `ctx`; db/heatingPeriodContext.ts `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText` | Plan PR 6, 7, 8, 11 |
| PR 10 | heating.ts `ShareRow`, `ConsumptionShares`, `consumptionSharesOf(rows, key, energy, forced)`, `OIL_OR_GAS`, `SelfPlan`; db/heatingSelf.ts `checkShares`, `shareRows`, `saveDistribution`, `setUpSelf`, `distributionOf`; calc.ts `selfPlans`, `SelfPlantPlan`, `selfStatementOf`, `cutOf`, `nameOf`, `POT_UNIT`, im Block des Plans `rows` (Zeilen der Heizperioden der Anlage), `shares`, `blocked`, `where`; die Hinweisschleife mit `notYet`, `list`, `unmeasured`; `HeatingDistribution`, `SelfHeatingStatement` (`shares`); Client `heatingSelfForm.ts` (`SelfSetupForm`, `SelfSetupBody`, `emptySelfSetup`, `selfSetupBody`, `shareBounds`, `forcedShare`), `HeatingSelfSetup.tsx`, `SelfHeatingCards.tsx`, `SelfHeatingBlock.tsx`, `heatingSelfView.ts` (`distributionLines`, `shareEditable`) | Plan PR 10 |
| PR 13 | `SelfPlantPlan.prev: SelfPlan \| null`, `SelfPlantPlan.prevSameLength`; `SelfPlan['totals'][pot].overThreshold`; `server/testing/selfHeating.ts` `selfSnapshot()` | Plan PR 13 |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung.

1. **Vier Parameter mehr als der Entwurf** (4.3 nennt für PR 14 nur `hkv.cut.information`):
   `hkv.info.applicable-from` (Zeiträume ab dem 01.12.2021, § 6a Abs. 3 Satz 1), `hkv.monthly-info`
   (monatlich ab dem 01.01.2022, § 6a Abs. 1 Nr. 2), `hkv.info.district-emissions` (Fernwärmesysteme
   unter 20 MW erst ab dem 01.01.2022) und `hkv.exemptions` (15 kWh/(m²·a), 01.07.1981, zehn Jahre des
   § 11). Grund: „Rechtswerte nur aus dem Register“; sonst stünden diese Stichtage und Zahlen in Texten
   und Bedingungen.
2. **Zeitregel `periodStart` für die 20-MW-Grenze ist eine Auslegung.** Der Wortlaut sagt „jedoch erst
   ab dem 1. Januar 2022“ und lässt offen, ob der Beginn des Zeitraums oder das Zugänglichmachen gemeint
   ist. Mietfuchs kennt die Leistung des Netzes nicht. Für einen Zeitraum, der vor dem 01.01.2022 beginnt
   (also im Dezember 2021), nennt Mietfuchs fehlende Emissionen und Primärenergiefaktor nur als „bis zu“;
   ab dann als sicher fehlend.
3. **Neue Spalte `heating_plants.exemption_billing_agreed`.** Der Entwurf (8.9) übernimmt § 2 Abs. 7
   CO2KostAufG („keine Aufteilung, außer eine Abrechnung ist vereinbart“), nennt aber keinen Ort für die
   Antwort.
4. **Neue Spalte `heating_plants.monthly_info_elsewhere`** für die Bestätigung, dass die Mieter die
   monatliche Information anders bekommen (Entwurf 8.8, 13 PR 22: „bestätigt das an der Anlage“; der
   Entwurf nennt keinen Spaltennamen).
5. **Ausnahme nach § 11: Mietfuchs verteilt, wie erfasst, statt zwangsweise nach Fläche.** Der Entwurf
   (8.9) sagt „Eine gewählte Ausnahme führt zur Verteilung nach Fläche“. Ohne die Verordnung gilt der
   Mietvertrag; nur wenn er nichts anderes regelt, die Wohnfläche, und Kosten mit erfasstem Verbrauch
   nach einem Maßstab, der dem Verbrauch Rechnung trägt (§ 556a Abs. 1 BGB, Wortlaut oben). Ein Zwang zur
   Fläche träfe eine vereinbarte Verteilung. Der Hinweis `heating.exemption` sagt die Regel des § 556a.
6. **§ 11 Abs. 1 Nr. 2 (Heime) und Nr. 4 (Hausanlagen bei Wärmelieferung) stehen nicht zur Wahl.** Der
   Entwurf (5.3) zählt sie nicht auf; Heime gehören nicht zum Zielbild (#91), Nr. 4 betrifft
   Contracting (PR 16). Nr. 3 a und b sind eine Wahl („überwiegend aus Wärmerückgewinnung, Solar, KWK
   oder Abwärme, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird“), Nr. 1 a, b, c je eine.
7. **Unter § 11 fordert Mietfuchs keine Angaben nach § 6a**, denn § 6a liegt in den §§ 3 bis 7, die
   § 11 Abs. 1 (und für Warmwasser Abs. 2) ausnimmt. Gedruckt wird der Block nicht.
8. **Vereinbarung nach § 2:** wirksam nur, solange `mayAgreeOtherwise` im Zeitraum gilt; dann nennt
   Mietfuchs für diese Anlage keine Kürzung nach § 12 (Entwurf 8.9: „gibt keinen § 12-Hinweis“), auch
   nicht nach Satz 2 und 3. Der Server prüft beim Setzen mit einer eigenen Fassung von „Wohnung“ (Fläche,
   Eigennutzung oder je ein Mietverhältnis), denn `isDwelling` in calc.ts kennt nur den Zeitraum der
   Berechnung; calc.ts prüft im Zeitraum erneut. Eine Vereinbarung über die Verteilung lässt das
   CO2KostAufG unberührt (§ 2 Abs. 5 CO2KostAufG: dessen Bestimmungen gehen rechtsgeschäftlichen
   Bestimmungen vor).
9. **§ 10 bei Pflichtanteil nach § 7 Abs. 1 Satz 2 (Auslegung):** § 10 lässt „höhere als die in § 7
   Absatz 1 … genannten Höchstsätze von 70 vom Hundert“ unberührt und nennt § 7 Abs. 1 als Ganzes. Mit
   Vereinbarung darf der Anteil deshalb auch beim Pflichtanteil darüber liegen, nie darunter. Über 100 %
   gibt es nicht.
10. **`heating.insulation-rule-unknown` nur, wenn der Anteil nicht schon dem Pflichtanteil entspricht.**
    Verteilt der Vermieter ohnehin 70 % bei einer Öl- oder Gasheizung, ist die Frage ohne Folge.
11. **Kontaktinformationen (Nr. 2) als fester Text in `shared/heatingInfo.ts`** mit Datum der Prüfung:
    Verbraucherzentrale (Energieberatung), Deutsche Energie-Agentur, Bundesstelle für Energieeffizienz
    beim BAFA, Europäische Produktdatenbank EPREL (technische Spezifikationen, Energielabel); alle
    Adressen am 05.10.2026 aufgerufen. Kein Rechtswert; die jährliche Durchsicht (4.8 Nr. 4) prüft sie.
    `info_contacts_confirmed` (PR 4) bleibt ungenutzt, denn Mietfuchs druckt die Angaben selbst.
12. **Nr. 3 Streitbeilegung:** `consumer_contract` hält `'none'` (kein Verbrauchervertrag), einen Text
    (die Information nach § 6a Abs. 3 Nr. 3, die der Vermieter selbst formuliert) oder `null`
    (unbeantwortet, dann „bis zu 3 %“). Eine Schlichtungsstelle schlägt Mietfuchs nicht vor: welche
    zuständig ist und ob der Vermieter teilnimmt (§§ 36, 37 VSBG), entscheidet er.
13. **Nr. 1 b Steuern, Abgaben und Zölle** als Freitext laut Rechnung des Versorgers; **Nr. 1 c**
    automatisch aus den Positionen mit Teil „Erfassung“ (`heating_part = 'metering'`); **Nr. 1 a** aus der
    Anlage (eine Anlage, ein Energieträger: 100 %), bei Fernwärme mit den eingetragenen Werten.
    `info_district_ghg` beschriftet die Oberfläche als „Treibhausgasemissionen laut Versorger
    (g CO₂-Äquivalent je kWh)“; **Festlegung ohne Quelle**, denn der Wortlaut nennt „die damit
    verbundenen jährlichen Treibhausgasemissionen“ ohne Einheit. Der Druck nennt die Einheit.
14. **Nr. 4: Hausdurchschnitt je m², so benannt** (Entwurf 8.8, 15.2 F5) als Ersatz für den
    „normierten oder durch Vergleichstests ermittelten Durchschnittsnutzer“; ⟨Norm offen: DIN 94680⟩.
15. **Nr. 5: Klimafaktor des DWD je Postleitzahl, abgefragt** (Entwurf 8.8, 15.2 F5): witterungsbereinigt
    ist der Wärmeverbrauch mal dem Klimafaktor; der Warmwasserverbrauch wird nicht bereinigt (Satz 3
    bereinigt nur den Wärmeverbrauch) und steht daneben (Satz 2: „umfasst den Wärmeverbrauch und den
    Warmwasserverbrauch“). Die Bekanntmachung nach Satz 4 hat der Entwurf nicht gefunden (15.2 F5);
    ⟨Norm offen: DIN 94680⟩. Der Vorjahreswert des Nutzers wird aus den Ablesungen der vorigen
    Heizperiode neu gerechnet (PR 13, `prev`), nicht aus einer abgeschlossenen Abrechnung gelesen
    (**Festlegung**: eine Information, keine Abrechnungszahl). Bei Heizkostenverteilern wird in
    Einheiten verglichen.
16. **Bei `method = 'manual'` druckt Mietfuchs Nr. 2 und 3** (das Mindeste nach Abs. 5, zugleich Teil
    von Abs. 3) **ohne Hinweis**; ob eine solche Abrechnung „auf dem tatsächlichen Verbrauch beruht“,
    entscheiden die Schlüssel, und die Hinweise aus #140 behandeln die Verteilung ohne Verbrauch schon.
    Bei `service` liefert der Messdienst die Angaben.

---

### Task 1: Rechtsregister, Regeln, Lexikon, Kontaktinformationen

**Files:**
- Modify: `shared/law/heizkostenv.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`, `shared/types.ts` (nur `InfoContact`)
- Create: `shared/heatingInfo.ts`
- Test: `server/test/law-pflichtangaben.test.ts` (neu); Modify: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Produces:
  - `hkvCutInformation: LawParam<number, 'periodStart'>` (`'hkv.cut.information'`, 3)
  - `hkvInfoApplicable: LawParam<boolean, 'periodStart'>` (`'hkv.info.applicable-from'`)
  - `type DistrictEmissions = { readonly scope: 'largeOnly' | 'all'; readonly thresholdMw: number }`, `hkvInfoDistrict: LawParam<DistrictEmissions, 'periodStart'>` (`'hkv.info.district-emissions'`)
  - `hkvMonthlyInfo: LawParam<{ readonly interval: string }, 'overlap'>` (`'hkv.monthly-info'`)
  - `type Exemptions = { readonly lowDemandKwhPerM2Year: number; readonly readyBefore: string; readonly paybackYears: number }`, `hkvExemptions: LawParam<Exemptions, 'periodStart'>` (`'hkv.exemptions'`)
  - Regeln `heating-info`, `heating-exemption`; `TermId` + `'billingInfo' | 'climateFactor'`
  - `shared/types.ts`: `type InfoContact = { name: string; url: string; what: string }`
  - `shared/heatingInfo.ts`: `INFO_CONTACTS: readonly InfoContact[]`, `INFO_CONTACTS_CHECKED: string`, `CONSUMER_CONTRACT_NONE = 'none'`

- [ ] **Step 1: Write the failing tests**

`server/test/law-pflichtangaben.test.ts`:

```ts
// Rechtsregister für Pflichtangaben und Ausnahmen (Heizung PR 14, Entwurf 4.3, 8.8, 8.9, 10.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvCutInformation, hkvExemptions, hkvInfoApplicable, hkvInfoDistrict, hkvMonthlyInfo } from '../../shared/law/heizkostenv.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'
import { INFO_CONTACTS, INFO_CONTACTS_CHECKED } from '../../shared/heatingInfo.ts'

const year = (from: string, to: string) => ({ period: { from, to } })

test('§ 12 Abs. 1 Satz 3: 3 %, nach dem Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(hkvCutInformation, year('2025-01-01', '2025-12-31'), log), 3)
  assert.equal(hkvCutInformation.norm, '§ 12 Abs. 1 Satz 3 HeizkostenV')
  assert.deepEqual(log.values.map((v) => v.text), ['3 %'])
})

test('§ 6a Abs. 3: Zeiträume, die ab dem 01.12.2021 beginnen (Stichtag nach Monaten)', () => {
  const log = createLawLog()
  assert.equal(law(hkvInfoApplicable, year('2021-11-01', '2022-10-31'), log), false)
  assert.equal(law(hkvInfoApplicable, year('2021-12-01', '2022-11-30'), log), true)
})

test('Fernwärme unter 20 MW erst ab 01.01.2022 (Auslegung nach Beginn des Zeitraums, Abweichung 2)', () => {
  const log = createLawLog()
  assert.deepEqual(law(hkvInfoDistrict, year('2021-12-01', '2022-11-30'), log), { scope: 'largeOnly', thresholdMw: 20 })
  assert.deepEqual(law(hkvInfoDistrict, year('2022-01-01', '2022-12-31'), log), { scope: 'all', thresholdMw: 20 })
  assert.equal(hkvInfoDistrict.versions[0]?.source.rank, 'interpretation')
})

test('§ 6a Abs. 1 Nr. 2: monatlich ab 01.01.2022, Zeitregel overlap', () => {
  const log = createLawLog()
  assert.equal(law(hkvMonthlyInfo, year('2021-01-01', '2021-12-31'), log).coverage, 'none')
  assert.equal(law(hkvMonthlyInfo, year('2021-05-01', '2022-04-30'), log).coverage, 'partial')
  assert.equal(law(hkvMonthlyInfo, year('2025-01-01', '2025-12-31'), log).coverage, 'full')
})

test('§ 11: 15 kWh/(m²·a), 01.07.1981, zehn Jahre', () => {
  assert.deepEqual(onlyVersion(hkvExemptions).value, { lowDemandKwhPerM2Year: 15, readyBefore: '1981-07-01', paybackYears: 10 })
})

test('Register: die fünf Parameter in LAW_PARAMS, mit Quelle', () => {
  const ids = LAW_PARAMS.map((p) => p.id)
  for (const id of ['hkv.cut.information', 'hkv.info.applicable-from', 'hkv.info.district-emissions', 'hkv.monthly-info', 'hkv.exemptions']) assert.ok(ids.includes(id), id)
})

test('Regeln heating-info und heating-exemption, Zahlen aus dem Register', () => {
  const info = RULES.find((r) => r.code === 'heating-info') ?? assert.fail('heating-info fehlt')
  assert.match(info.norm, /§ 6a Abs\. 3, 5 HeizkostenV; § 12 Abs\. 1 Satz 3 HeizkostenV/)
  assert.match(info.summary, /um 3 % kürzen/)
  assert.match(info.summary, /mindestens die Kontaktinformationen und die Information zur Streitbeilegung/)
  const ex = RULES.find((r) => r.code === 'heating-exemption') ?? assert.fail('heating-exemption fehlt')
  assert.match(ex.norm, /§ 11 HeizkostenV; § 2 Abs\. 7 CO2KostAufG; § 556a Abs\. 1 BGB/)
  assert.match(ex.summary, /15 kWh je m² und Jahr.*10 Jahren.*01\.07\.1981/s)
  for (const code of ['heating-info', 'heating-exemption']) assert.equal(ruleCoverage(code, '2025-01-01', '2025-12-31'), 'full')
})

test('Kontaktinformationen (§ 6a Abs. 3 Nr. 2): Verbraucherorganisation, Energieagentur, https, mit Prüfdatum', () => {
  assert.ok(INFO_CONTACTS.length >= 3)
  assert.ok(INFO_CONTACTS.every((c) => c.url.startsWith('https://') && c.name.trim() !== '' && c.what.trim() !== ''))
  assert.ok(INFO_CONTACTS.some((c) => /Verbraucherzentrale/.test(c.name)))
  assert.ok(INFO_CONTACTS.some((c) => /Energie-Agentur/.test(c.name)))
  assert.match(INFO_CONTACTS_CHECKED, /^\d{4}-\d{2}-\d{2}$/)
})
```

In `server/test/law-history.test.ts` am Ende von `SHIPPED` (hinter PR 13):

```ts
  // 0.11.0 (Heizung PR 14, #99)
  'hkv.cut.information|||3',
  'hkv.info.applicable-from||2021-11-30|false',
  'hkv.info.applicable-from|2021-12-01||true',
  'hkv.info.district-emissions||2021-12-31|{"scope":"largeOnly","thresholdMw":20}',
  'hkv.info.district-emissions|2022-01-01||{"scope":"all","thresholdMw":20}',
  'hkv.monthly-info|2022-01-01||{"interval":"monthly"}',
  'hkv.exemptions|||{"lowDemandKwhPerM2Year":15,"readyBefore":"1981-07-01","paybackYears":10}',
```

In `server/test/law.test.ts` das Objekt `modules` um `hkvCutInformation, hkvExemptions,
hkvInfoApplicable, hkvInfoDistrict, hkvMonthlyInfo` ergänzen (Import aus `heizkostenv.ts`).

An `server/test/glossary.test.ts` anhängen:

```ts
test('Angaben zur Abrechnung und Klimafaktor (Heizung PR 14): Beispiele nachgerechnet', () => {
  // 3 % von 1.200 € = 36 €.
  assert.equal((1200 * 3) / 100, 36)
  assert.match(GLOSSARY.billingInfo.example, /1\.200 €.*36 €/s)
  assert.match(GLOSSARY.billingInfo.norm, /§ 6a HeizkostenV/)
  // 12.000 kWh × 1,08 = 12.960 kWh; 11.500 kWh × 1,15 = 13.225 kWh.
  assert.equal(Math.round(12000 * 1.08), 12960)
  assert.equal(Math.round(11500 * 1.15), 13225)
  assert.match(GLOSSARY.climateFactor.example, /12\.000 kWh.*1,08.*12\.960 kWh.*11\.500 kWh.*1,15.*13\.225 kWh/s)
  assert.match(GLOSSARY.climateFactor.needed, /Norm offen: DIN 94680/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law-pflichtangaben.test.ts test/law-history.test.ts test/law.test.ts test/glossary.test.ts`
Expected: FAIL mit `does not provide an export named 'hkvCutInformation'`.

- [ ] **Step 3: Parameter (`shared/law/heizkostenv.ts`)**

Ans Dateiende:

```ts
// § 12 Abs. 1 Satz 3 HeizkostenV (Heizung PR 14): Teilt der Gebäudeeigentümer die Informationen nach
// § 6a nicht oder nicht vollständig mit, darf der Nutzer seinen Anteil um 3 % kürzen (Satz 2, „Dasselbe
// ist anzuwenden“). Eine eigene Fassung neben `hkv.cut.remote-reading`, denn sie kann sich getrennt
// ändern.
export const hkvCutInformation: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.information',
  title: 'Kürzung bei fehlenden Informationen nach § 6a',
  norm: '§ 12 Abs. 1 Satz 3 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: 3, source: checked('§ 12 Abs. 1 Satz 2, 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'), enacted: ENACTED }],
  describe: (v) => `${v} %`,
}

// § 6a Abs. 3 Satz 1 (Heizung PR 14): Pflicht für Abrechnungszeiträume, die ab dem 01.12.2021 beginnen.
export const hkvInfoApplicable: LawParam<boolean, 'periodStart'> = {
  id: 'hkv.info.applicable-from',
  title: 'Informationen nach § 6a Abs. 3 Pflicht',
  norm: '§ 6a Abs. 3 Satz 1 HeizkostenV',
  timing: 'periodStart',
  versions: [
    { validTo: '2021-11-30', value: false, source: checked('§ 6a Abs. 3 Satz 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'), enacted: ENACTED },
    { validFrom: '2021-12-01', value: true, source: checked('§ 6a Abs. 3 Satz 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'), enacted: ENACTED },
  ],
  describe: (v) => (v ? 'Informationen nach § 6a Abs. 3 sind Pflicht' : 'noch keine Pflicht'),
}

// § 6a Abs. 3 Satz 1 Nr. 1 a (Heizung PR 14): Treibhausgasemissionen und Primärenergiefaktor des
// Fernwärmenetzes, „bei Fernwärmesystemen mit einer thermischen Gesamtleistung unter 20 Megawatt jedoch
// erst ab dem 1. Januar 2022“. Ob der Beginn des Zeitraums gemeint ist, sagt der Wortlaut nicht; Mietfuchs
// liest es so und nennt das fehlende Datum davor nur als „bis zu“ (Auslegung, Abweichung 2 des Plans).
export type DistrictEmissions = { readonly scope: 'largeOnly' | 'all'; readonly thresholdMw: number }
const districtSource = (): Source => ({ rank: 'interpretation', cite: '§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a HeizkostenV', url: 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html', retrieved: '2026-10-05', checked: 'checked' })
export const hkvInfoDistrict: LawParam<DistrictEmissions, 'periodStart'> = {
  id: 'hkv.info.district-emissions',
  title: 'Treibhausgasemissionen und Primärenergiefaktor der Fernwärme',
  norm: '§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a HeizkostenV',
  timing: 'periodStart',
  versions: [
    { validTo: '2021-12-31', value: { scope: 'largeOnly', thresholdMw: 20 }, source: districtSource(), enacted: `${ENACTED}; Zeitregel nach dem Beginn des Zeitraums als Auslegung von Mietfuchs` },
    { validFrom: '2022-01-01', value: { scope: 'all', thresholdMw: 20 }, source: districtSource(), enacted: `${ENACTED}; Zeitregel nach dem Beginn des Zeitraums als Auslegung von Mietfuchs` },
  ],
  describe: (v) => (v.scope === 'all' ? 'für jedes Fernwärmesystem' : `nur für Fernwärmesysteme ab ${v.thresholdMw} MW`),
}

// § 6a Abs. 1 Satz 1 Nr. 2, Abs. 2 (Heizung PR 14): Bei fernablesbaren Geräten monatliche Abrechnungs-
// oder Verbrauchsinformationen ab dem 01.01.2022. `overlap`: Ein Zeitraum, der das Jahr 2022 berührt, ist
// betroffen. Die Information selbst erzeugt Mietfuchs mit PR 22.
export const hkvMonthlyInfo: LawParam<{ readonly interval: string }, 'overlap'> = {
  id: 'hkv.monthly-info',
  title: 'Monatliche Verbrauchsinformation',
  norm: '§ 6a Abs. 1 Satz 1 Nr. 2, Abs. 2 HeizkostenV',
  timing: 'overlap',
  versions: [{ validFrom: '2022-01-01', value: { interval: 'monthly' }, source: checked('§ 6a Abs. 1, 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'), enacted: ENACTED }],
  describe: () => 'monatlich bei fernablesbaren Geräten',
}

// § 11 Abs. 1 Nr. 1 HeizkostenV (Heizung PR 14): die Zahlen der Ausnahmen, für die Auswahl in der
// Oberfläche, das Lexikon und die Regel. Mietfuchs prüft keine dieser Voraussetzungen; der Vermieter
// wählt und bewahrt den Nachweis auf.
export type Exemptions = { readonly lowDemandKwhPerM2Year: number; readonly readyBefore: string; readonly paybackYears: number }
export const hkvExemptions: LawParam<Exemptions, 'periodStart'> = {
  id: 'hkv.exemptions',
  title: 'Ausnahmen von der Heizkostenverordnung',
  norm: '§ 11 Abs. 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { lowDemandKwhPerM2Year: 15, readyBefore: '1981-07-01', paybackYears: 10 }, source: checked('§ 11 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__11.html'), enacted: ENACTED }],
  describe: (v) => `Heizwärmebedarf unter ${v.lowDemandKwhPerM2Year} kWh je m² und Jahr; bezugsfertig vor ${germanDate(v.readyBefore)}; Einsparung in ${v.paybackYears} Jahren`,
}
```

- [ ] **Step 4: In die Liste (`shared/law/params.ts`)**

Die fünf Namen in den Import aus `'./heizkostenv.ts'` und alphabetisch nach Kennung in `LAW_PARAMS`
(`hkv.cut.information` hinter `hkv.consumption-share-forced`, `hkv.exemptions` hinter
`hkv.estimate-threshold`, `hkv.info.applicable-from` und `hkv.info.district-emissions` hinter
`hkv.heat-pump.capture`, `hkv.monthly-info` hinter diesen; gelten andere Reihenfolgen der
Vorgänger, deren).

- [ ] **Step 5: Regeln (`shared/law/rules.ts`)**

Die fünf Namen in den Import aus `'./heizkostenv.ts'`; hinter den Konstanten von PR 13:

```ts
const infoCut = valueAt(hkvCutInformation, LAW_AS_OF)
const exemptions = valueAt(hkvExemptions, LAW_AS_OF)
```

Ans Ende von `RULES`:

```ts
  // Heizung PR 14 (#99, Entwurf 10.2): Informationen nach § 6a und Ausnahmen nach § 11. Wortlaut gelesen
  // am 05.10.2026 auf gesetze-im-internet.de.
  {
    code: 'heating-info',
    title: 'Informationen zur Heizkostenabrechnung',
    norm: '§ 6a Abs. 3, 5 HeizkostenV; § 12 Abs. 1 Satz 3 HeizkostenV',
    summary:
      'Beruht die Abrechnung auf dem erfassten Verbrauch, gehören zu ihr Angaben über die Energieträger (bei Fernwärme auch Treibhausgasemissionen und Primärenergiefaktor), die erhobenen Steuern, Abgaben und Zölle, die Entgelte für Erfassung, Ablesung und Abrechnung, Kontaktinformationen, beim Verbrauchervertrag die Information zur Streitbeilegung, ein Vergleich mit einem Durchschnittsnutzer und ein grafischer Vergleich des witterungsbereinigten Verbrauchs mit dem vorhergehenden Zeitraum. ' +
      'Beruht sie nicht auf dem Verbrauch, enthält sie mindestens die Kontaktinformationen und die Information zur Streitbeilegung. ' +
      `Fehlt eine Angabe ganz oder teilweise, darf der Mieter seinen Anteil um ${infoCut} % kürzen; ebenso, wenn bei fernablesbaren Geräten die monatliche Verbrauchsinformation fehlt.`,
  },
  {
    code: 'heating-exemption',
    title: 'Ausnahmen von der Heizkostenverordnung',
    norm: '§ 11 HeizkostenV; § 2 Abs. 7 CO2KostAufG; § 556a Abs. 1 BGB',
    summary:
      `Die Vorschriften zur Verbrauchserfassung und Kostenverteilung gelten unter anderem nicht für Räume in Gebäuden mit einem Heizwärmebedarf unter ${exemptions.lowDemandKwhPerM2Year} kWh je m² und Jahr, bei denen die Erfassung nur mit Kosten möglich ist, die sich nicht in der Regel innerhalb von ${exemptions.paybackYears} Jahren durch Einsparungen erwirtschaften lassen, ` +
      `die vor dem ${germanDate(exemptions.readyBefore)} bezugsfertig wurden und in denen der Nutzer den Verbrauch nicht beeinflussen kann, in Gebäuden, die überwiegend mit Wärme aus Wärmerückgewinnung, Solaranlagen, Kraft-Wärme-Kopplung oder Abwärme versorgt werden, sofern der Verbrauch des Gebäudes nicht erfasst wird, und bei einer Befreiung durch die zuständige Stelle. ` +
      'Dann gilt der Mietvertrag, ohne Vereinbarung die Wohnfläche und für erfassten Verbrauch ein Maßstab, der ihm Rechnung trägt. Die CO₂-Kosten werden dann nicht nach dem CO2KostAufG aufgeteilt, außer eine Abrechnung der Heiz- und Warmwasserkosten ist vereinbart.',
  },
```

(Die Zahl der Jahre steht im Register; der Satz setzt sie ein.)

- [ ] **Step 6: Kontaktinformationen (`shared/heatingInfo.ts`, `shared/types.ts`)**

`shared/types.ts`, ans Dateiende:

```ts
// ---------- Informationen nach § 6a HeizkostenV (Heizung PR 14) ----------

export type InfoContact = { name: string; url: string; what: string }
```

`shared/heatingInfo.ts` (neu):

```ts
// Kontaktinformationen nach § 6a Abs. 3 Satz 1 Nr. 2 HeizkostenV (Heizung PR 14, Entwurf 8.8): „darunter
// Internetadressen von Verbraucherorganisationen, Energieagenturen oder ähnlichen Einrichtungen, bei
// denen Informationen über angebotene Maßnahmen zur Energieeffizienzverbesserung,
// Endnutzer-Vergleichsprofile und objektive technische Spezifikationen für energiebetriebene Geräte
// eingeholt werden können“. Kein Rechtswert, deshalb nicht im Register; die jährliche Durchsicht
// (Entwurf 4.8 Nr. 4) ruft jede Adresse auf und setzt das Datum.
import type { InfoContact } from './types.ts'

export const INFO_CONTACTS_CHECKED = '2026-10-05'
export const INFO_CONTACTS: readonly InfoContact[] = [
  { name: 'Verbraucherzentrale, Energieberatung', url: 'https://verbraucherzentrale-energieberatung.de', what: 'Verbraucherorganisation: Beratung zu Maßnahmen, die Energie sparen' },
  { name: 'Deutsche Energie-Agentur (dena)', url: 'https://www.dena.de', what: 'Energieagentur: Informationen zur Energieeffizienz von Gebäuden' },
  { name: 'Bundesstelle für Energieeffizienz beim BAFA', url: 'https://www.bfee-online.de', what: 'Informationen über angebotene Maßnahmen zur Energieeffizienzverbesserung und ihre Anbieter' },
  { name: 'Europäische Produktdatenbank für die Energieverbrauchskennzeichnung (EPREL)', url: 'https://eprel.ec.europa.eu', what: 'Technische Angaben und Energielabel energiebetriebener Geräte' },
]

// Kein Verbrauchervertrag (§ 310 Abs. 3 BGB) in `heating_periods.consumer_contract` (Abweichung 12).
export const CONSUMER_CONTRACT_NONE = 'none'
```

- [ ] **Step 7: Lexikon (`shared/glossary.ts`)**

`hkvCutInformation` in den Import aus `'./law/heizkostenv.ts'`; bei den Konstanten:

```ts
const INFO_CUT = valueAt(hkvCutInformation, LAW_AS_OF)
```

Hinter `heatingEstimate` (PR 13):

```ts
  // Heizung PR 14 (#99, Entwurf 10.3). Die Zahlen sind Beispielzahlen.
  billingInfo: {
    title: 'Angaben zur Heizkostenabrechnung',
    short: 'Zur eigenen Heizkostenabrechnung gehören Angaben über Energieträger, Steuern und Abgaben, die Kosten der Zähler und der Ablesung, Kontaktadressen zum Energiesparen, beim Verbrauchervertrag die Streitbeilegung, ein Vergleich mit dem Durchschnitt und ein grafischer Vergleich mit dem Vorjahr.',
    example: `Fehlt eine dieser Angaben, darf der Mieter seinen Anteil an den Heizkosten um ${INFO_CUT} % kürzen: bei 1.200 € Heizkosten um ${(1200 * INFO_CUT) / 100} €.`,
    norm: '§ 6a HeizkostenV; § 12 Abs. 1 Satz 3 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst nach Verbrauch abrechnen. Mietfuchs rechnet die meisten Angaben aus Ihren Daten; Steuern und Abgaben, bei Fernwärme die Werte des Netzes und den Klimafaktor tragen Sie auf der Seite Heizkosten ein.',
  },
  climateFactor: {
    title: 'Klimafaktor',
    short: 'Eine Zahl des Deutschen Wetterdienstes je Postleitzahl und Zeitraum, mit der ein Heizwärmeverbrauch auf ein durchschnittliches Klima umgerechnet wird; so lassen sich ein milder und ein kalter Winter vergleichen.',
    example: 'Ein Mieter verbrauchte 12.000 kWh, der Klimafaktor für seinen Ort ist 1,08: witterungsbereinigt 12.960 kWh. Im Vorjahr waren es 11.500 kWh bei einem Faktor von 1,15, witterungsbereinigt 13.225 kWh. Bereinigt hat er also weniger geheizt.',
    norm: '§ 6a Abs. 3 Satz 1 Nr. 5, Satz 2 bis 4 HeizkostenV',
    needed: 'Ja, für den Vergleich mit dem Vorjahr. Die Faktoren finden Sie beim Deutschen Wetterdienst unter „Klimafaktoren“ zu Ihrer Postleitzahl. Ein Verfahren, das die Verordnung vermuten lässt, ist nicht bekannt gemacht; Mietfuchs folgt der Praxis der Messdienste (⟨Norm offen: DIN 94680⟩). Das Warmwasser wird nicht bereinigt.',
  },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law-pflichtangaben.test.ts test/law-history.test.ts test/law.test.ts test/law-literals.test.ts test/glossary.test.ts test/rules.test.ts test/law-wording.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared server/test/law-pflichtangaben.test.ts server/test/law-history.test.ts server/test/law.test.ts server/test/glossary.test.ts
git commit -m "Pflichtangaben: § 6a, monatliche Information und Ausnahmen des § 11 im Rechtsregister

Fünf Parameter, zwei Regeln, zwei Begriffe und die Kontaktinformationen nach § 6a Abs. 3 Nr. 2
mit Datum der Prüfung.

Refs #99"
```

---

### Task 2: Datenmodell und Migrationen 0033/0034

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/db/heating.ts`, `server/src/snapshot.ts`
- Create (erzeugt): `server/drizzle/0033_pflichtangaben.sql`, `server/drizzle/0034_pflichtangaben_bedingungen.sql`, `meta/*`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`

**Interfaces:**
- Produces:
  - `shared/types.ts`: `type HeatingExemption = 'none' | 'lowDemand' | 'disproportionate' | 'pre1981' | 'renewable' | 'authority'`; `type AgreedOtherwise = 'area' | 'fixedPercent' | 'consumption'`; `HeatingPlant.exemption: HeatingExemption`, `.exemptionBillingAgreed: boolean | null`, `.agreedOtherwise: AgreedOtherwise | null`, `.monthlyInfoElsewhere: boolean`; `type InfoItem = '1a' | '1b' | '1c' | '2' | '3' | '4' | '5'`; `type InfoComparison`; `type HeatingInfoStatement`; `HeatingStatement.info?: HeatingInfoStatement`; `HeatingPeriodView.info: HeatingInfoInputs`; `type HeatingInfoInputs`; `HeatingDistribution.own.above70Agreed?`, `.effective.above70Agreed?`; `SelfHeatingStatement['shares']` + `above70Agreed?: boolean`
  - schema.ts: `HEATING_EXEMPTIONS`, `AGREED_OTHERWISE`, Spalten `heatingPlants.exemption`, `.exemptionBillingAgreed`, `.agreedOtherwise`, `.monthlyInfoElsewhere`
  - `SnapshotHeatingPlant` pickt zusätzlich `'exemption' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere'` (optional); `SnapshotHeatingPeriodRow` + `'above70Agreed' | 'infoTaxesText' | 'infoDistrictGhg' | 'infoDistrictPef' | 'climateFactor' | 'climateFactorPrev' | 'consumerContract'` (optional)

- [ ] **Step 1: Write the failing tests**

`server/test/schema.test.ts` ans Ende:

```ts
// ---------- Pflichtangaben und Ausnahmen (Heizung PR 14) ----------

test('Heizanlage: Ausnahme nach § 11 mit Vorgabe none, Vereinbarung nach § 2, monatliche Information', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'gas')")
    assert.deepEqual(connection.rows('SELECT exemption, exemption_billing_agreed, agreed_otherwise, monthly_info_elsewhere FROM heating_plants')[0], ['none', null, null, 0])
    assert.ok(rejects(connection, "UPDATE heating_plants SET exemption = 'heim' WHERE id = 'hp1'"), 'unbekannte Ausnahme')
    assert.ok(rejects(connection, "UPDATE heating_plants SET agreed_otherwise = 'pauschal' WHERE id = 'hp1'"), 'unbekannte Vereinbarung')
    assert.ok(rejects(connection, "UPDATE heating_plants SET exemption_billing_agreed = 1 WHERE id = 'hp1'"), 'Abrechnung vereinbart ohne Ausnahme')
    assert.equal(rejects(connection, "UPDATE heating_plants SET exemption = 'lowDemand', exemption_billing_agreed = 1, agreed_otherwise = 'area' WHERE id = 'hp1'"), null)
  } finally {
    cleanup()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/schema.test.ts`
Expected: FAIL mit `no such column: exemption`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

`HeatingPlant` als letzte Felder:

```ts
  // Heizung PR 14 (Entwurf 5.3, 8.8, 8.9). Ausnahme nach § 11 HeizkostenV (`none`: keine); bei einer
  // Ausnahme, ob mit den Mietern eine Abrechnung der Heiz- und Warmwasserkosten vereinbart ist
  // (§ 2 Abs. 7 CO2KostAufG, Abweichung 3); die Vereinbarung nach § 2 HeizkostenV im Gebäude mit höchstens
  // zwei Wohnungen, eine selbst bewohnt; und ob die Mieter die monatliche Verbrauchsinformation anders
  // bekommen (§ 6a Abs. 1, Abweichung 4).
  exemption: HeatingExemption
  exemptionBillingAgreed: boolean | null
  agreedOtherwise: AgreedOtherwise | null
  monthlyInfoElsewhere: boolean
```

`HeatingDistribution` (PR 10): in `own` und `effective` je das optionale Feld `above70Agreed?: boolean`
ergänzen. `SelfHeatingStatement['shares']` bekommt `above70Agreed?: boolean`. `HeatingStatement`
bekommt als letztes Feld:

```ts
  // Informationen nach § 6a (Heizung PR 14), bei eigener Abrechnung und bei freien Schlüsseln (dort nur
  // Nr. 2 und 3); fehlt bei einer Ausnahme nach § 11 und beim Messdienst.
  info?: HeatingInfoStatement
```

`HeatingPeriodView` bekommt als letztes Feld:

```ts
  // Eingaben zu § 6a dieser Heizperiode und die Postleitzahl des Objekts für den Klimafaktor (PR 14).
  info: HeatingInfoInputs
```

Ans Dateiende (hinter `InfoContact` aus Task 1):

```ts
export type HeatingExemption = 'none' | 'lowDemand' | 'disproportionate' | 'pre1981' | 'renewable' | 'authority'
export type AgreedOtherwise = 'area' | 'fixedPercent' | 'consumption'
// Die Nummern des § 6a Abs. 3 Satz 1.
export type InfoItem = '1a' | '1b' | '1c' | '2' | '3' | '4' | '5'
export type HeatingInfoInputs = Pick<HeatingPeriodData, 'infoTaxesText' | 'infoDistrictGhg' | 'infoDistrictPef' | 'climateFactor' | 'climateFactorPrev' | 'consumerContract'> & { postalCode: string | null }
// Vergleich je Mieter (Nr. 4, 5). Verbrauch in der Einheit des Topfs; `null`: nicht erfasst.
export type InfoComparison = {
  tenancyId: string
  label: string
  days: number
  prevDays: number | null
  heating: { now: number | null; perM2: number | null; houseAvgPerM2: number | null; prev: number | null; nowAdjusted: number | null; prevAdjusted: number | null } | null
  water: { now: number | null; perM2: number | null; houseAvgPerM2: number | null; prev: number | null } | null
  // Kein Verbrauch dieses Mieters im vorhergehenden Zeitraum (Entwurf 15.1 Nr. 14).
  firstPeriod: boolean
}
export type HeatingInfoStatement = {
  // `full`: § 6a Abs. 3; `minimal`: Abs. 5, nur Nr. 2 und 3.
  scope: 'full' | 'minimal'
  energy: HeatingEnergy
  district: { ghg: number | null; pef: number | null } | null
  taxesText: string | null
  meteringCents: number
  contacts: InfoContact[]
  contactsChecked: string
  // Nr. 3: `none` kein Verbrauchervertrag, `text` die Information, `unknown` unbeantwortet.
  dispute: { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'unknown' }
  climate: { factor: number | null; factorPrev: number | null }
  units: { heating: string; water: string }
  users: InfoComparison[]
  // Sicher fehlend, und vielleicht fehlend (Fernwärme vor 2022, Verbrauchervertrag unbeantwortet).
  missing: InfoItem[]
  uncertain: InfoItem[]
}
```

(`HeatingEnergy`, `HeatingPeriodData` stehen in shared/types.ts seit PR 4.)

- [ ] **Step 4: Erster Schritt (`server/src/db/schema.ts`)**

Den Typimport um `AgreedOtherwise, HeatingExemption` ergänzen; bei den Listen der Heizanlage:

```ts
export const HEATING_EXEMPTIONS = exactly<HeatingExemption>()(['none', 'lowDemand', 'disproportionate', 'pre1981', 'renewable', 'authority'] as const)
export const AGREED_OTHERWISE = exactly<AgreedOtherwise>()(['area', 'fixedPercent', 'consumption'] as const)
```

In `heatingPlants` als letzte Spalten:

```ts
    // Ausnahmen und Vereinbarungen (Heizung PR 14). Bedingungen im zweiten Schritt.
    exemption: text('exemption', { enum: HEATING_EXEMPTIONS }).notNull().default('none'),
    exemptionBillingAgreed: integer('exemption_billing_agreed', { mode: 'boolean' }),
    agreedOtherwise: text('agreed_otherwise', { enum: AGREED_OTHERWISE }),
    monthlyInfoElsewhere: integer('monthly_info_elsewhere', { mode: 'boolean' }).notNull().default(false),
```

Run: `npm --prefix server run db:generate -- --name pflichtangaben`

Expected: `server/drizzle/0033_pflichtangaben.sql` mit genau vier `ALTER TABLE \`heating_plants\` ADD`.
Kein `__new_`.

- [ ] **Step 5: Zweiter Schritt**

In den Bedingungen von `heatingPlants` hinter denen von PR 10:

```ts
    oneOf('heating_plants_exemption_known', 'exemption', HEATING_EXEMPTIONS),
    oneOf('heating_plants_agreed_otherwise_known', 'agreed_otherwise', AGREED_OTHERWISE),
    // Die Frage nach der vereinbarten Abrechnung gibt es nur bei einer Ausnahme (§ 2 Abs. 7 CO2KostAufG).
    check('heating_plants_billing_agreed_with_exemption', sql.raw(`"exemption_billing_agreed" IS NULL OR "exemption" <> 'none'`)),
```

Run: `npm --prefix server run db:generate -- --name pflichtangaben_bedingungen`

Expected: `server/drizzle/0034_pflichtangaben_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, einem
Neubau `__new_heating_plants` samt `INSERT INTO … SELECT`, `DROP TABLE`, `RENAME`, `PRAGMA
foreign_keys=ON`. Kein `ALTER TABLE … ADD`.

- [ ] **Step 6: Marken (`server/test/migrations.test.ts`)**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('pflichtangaben')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `VEROEFFENTLICHT` hinter `'0032_schaetzung'` die beiden Zeilen, darüber
`// Heizung PR 14. Wird ein Schritt von PR 13 neu erzeugt, werden diese beiden neu erzeugt.`

- [ ] **Step 7: Lesen, Verschmelzen, Schnappschuss**

`server/src/db/read.ts`, in `readHeatingPlants` im Objekt jeder Anlage hinter den Feldern von PR 10:

```ts
    exemption: p.exemption,
    exemptionBillingAgreed: p.exemptionBillingAgreed,
    agreedOtherwise: p.agreedOtherwise,
    monthlyInfoElsewhere: p.monthlyInfoElsewhere,
```

`server/src/db/heating.ts`: Importe `AGREED_OTHERWISE, HEATING_EXEMPTIONS` aus `'./schema.ts'`. In
`mergeHeatingPlant` hinter den Feldern von PR 10:

```ts
    exemption: merged(body, 'exemption', current.exemption, (v) => oneOfOrUndefined(HEATING_EXEMPTIONS, v) ?? current.exemption),
    exemptionBillingAgreed: merged(body, 'exemptionBillingAgreed', current.exemptionBillingAgreed, (v) => (v === null ? null : typeof v === 'boolean' ? v : current.exemptionBillingAgreed)),
    agreedOtherwise: merged(body, 'agreedOtherwise', current.agreedOtherwise, (v) => (v === null ? null : oneOfOrUndefined(AGREED_OTHERWISE, v) ?? current.agreedOtherwise)),
    monthlyInfoElsewhere: merged(body, 'monthlyInfoElsewhere', current.monthlyInfoElsewhere, (v) => (typeof v === 'boolean' ? v : current.monthlyInfoElsewhere)),
```

und direkt danach, im zurückgegebenen Objekt oder als Nachbearbeitung (je nach Gestalt von
`mergeHeatingPlant`): Ist `exemption` `'none'`, ist `exemptionBillingAgreed` `null` (die Frage gibt es
dann nicht). In `emptyHeatingPlant` als letzte Felder `exemption: 'none', exemptionBillingAgreed: null,
agreedOtherwise: null, monthlyInfoElsewhere: false,`; in `plantRow` dieselben vier Felder.

`server/src/snapshot.ts`: `SnapshotHeatingPlant` als weiteren Teil der Schnittmenge

```ts
  // Ausnahmen und Vereinbarungen (Heizung PR 14); fehlt ein Feld, gilt die Vorgabe der Spalte.
  & Partial<Pick<HeatingPlant, 'exemption' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere'>>
```

und `SnapshotHeatingPeriodRow`:

```ts
  // § 10 und § 6a (Heizung PR 14).
  & Partial<Pick<HeatingPeriodData, 'above70Agreed' | 'infoTaxesText' | 'infoDistrictGhg' | 'infoDistrictPef' | 'climateFactor' | 'climateFactorPrev' | 'consumerContract'>>
```

(Reicht `snapshotFor` Anlagen und Zeilen als ganze Datensätze durch, kommen die Felder von selbst.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-heizanlage.test.ts test/db-golden.test.ts && npm run typecheck`
Expected: PASS. Der Übersetzer verlangt `info` an `HeatingPeriodView` in `heatingPeriodViews` (db/co2.ts);
bis Task 4 steht dort
`info: { infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: null, climateFactorPrev: null, consumerContract: null, postalCode: null },`
mit dem Kommentar „Heizung PR 14, gefüllt in Task 4“; ebenso in Testdaten des Clients.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db server/drizzle server/src/snapshot.ts client/src server/test/schema.test.ts server/test/migrations.test.ts
git commit -m "Pflichtangaben: Ausnahme nach § 11, Vereinbarung nach § 2 und monatliche Information an der Heizanlage

Zwei erzeugte Schritte, erst die Spalten, dann die Bedingungen.

Refs #99"
```

---

### Task 3: Reine Rechnung: Angaben nach § 6a, § 10 und § 7 Abs. 1 Satz 2 im Anteil

**Files:**
- Create: `server/src/heatingInfo.ts`
- Modify: `server/src/heating.ts`, `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/heating-info.test.ts` (neu), `server/test/heating.test.ts`

**Interfaces:**
- Consumes: `SelfPlan` (PR 10, PR 13: `units[].measured`, `totals[].overThreshold`); `HeatingInfoStatement`, `InfoComparison`, `InfoItem`, `InfoContact`, `HeatingEnergy`, `SelfPot`; `CONSUMER_CONTRACT_NONE`.
- Produces:
  - `heatingInfo.ts`: `type InfoRow`, `type InfoInput`, `byConsumption(plan: SelfPlan | null): boolean`, `heatingInfoOf(i: InfoInput): HeatingInfoStatement`
  - `heating.ts`: `ShareRow.above70Agreed?: boolean | null`; `ConsumptionShares.above70Agreed: boolean`, `ConsumptionShares.insulationRule: InsulationRule | null`

- [ ] **Step 1: Write the failing tests**

`server/test/heating-info.test.ts`:

```ts
// Informationen nach § 6a HeizkostenV als reine Rechnung (Heizung PR 14, Entwurf 8.8, 15.1 Nr. 14,
// 15.2 F5). Grundlage ist Beispiel A aus heating.test.ts (PR 10): A 12.000 kWh auf 60 m², B 16.000 kWh
// auf 80 m², C1 7.200 kWh und C2 4.800 kWh auf 60 m².
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byConsumption, heatingInfoOf, type InfoInput } from '../src/heatingInfo.ts'
import { planSelf, type SelfInput, type SelfPlan } from '../src/heating.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { INFO_CONTACTS } from '../../shared/heatingInfo.ts'

const table = onlyVersion(hkvDegreeDays).value
const offRule = onlyVersion(practiceReadingOffWarning).value
const near = (a: number | null | undefined, b: number, what: string) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${what}: ${a} statt ${b}`)

// Beispiel A ohne Warmwasser, damit die Rechnung kurz bleibt; 2024 als Vorperiode.
const base = (h: { from: string; to: string }, readings: SelfInput['readings']): SelfInput => ({
  h, neighbors: { before: '2022-12-31', after: '2026-12-31' }, changeSplit: 'degreeDays', hotWater: 'none', areaBasisHeat: 'area',
  units: [
    { id: 'a', name: 'A', areaM2: 60, heatedAreaM2: null, role: 'rented' },
    { id: 'b', name: 'B', areaM2: 80, heatedAreaM2: null, role: 'rented' },
    { id: 'c', name: 'C', areaM2: 60, heatedAreaM2: null, role: 'rented' },
  ],
  tenancies: [
    { id: 'A', unitId: 'a', tenantName: 'Mieter A', start: '2020-01-01', end: null },
    { id: 'B', unitId: 'b', tenantName: 'Mieter B', start: '2020-01-01', end: null },
    { id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-09-30' },
    { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-10-01', end: null },
  ],
  meters: [{ id: 'wa', name: 'Wärme A', unitId: 'a', type: 'waerme' }, { id: 'wb', name: 'Wärme B', unitId: 'b', type: 'waerme' }, { id: 'wc', name: 'Wärme C', unitId: 'c', type: 'waerme' }],
  readings, gaps: [], table, offRule: () => offRule,
})
const R = (meterId: string, date: string, value: number) => ({ meterId, date, value })
const READINGS = [
  R('wa', '2023-12-31', 0), R('wa', '2024-12-31', 1000), R('wa', '2025-12-31', 13000),
  R('wb', '2023-12-31', 0), R('wb', '2024-12-31', 0), R('wb', '2025-12-31', 16000),
  R('wc', '2023-12-31', 0), R('wc', '2024-12-31', 500), R('wc', '2025-09-30', 7700), R('wc', '2025-12-31', 12500),
]
const plan: SelfPlan = planSelf(base({ from: '2025-01-01', to: '2025-12-31' }, READINGS))
const prev: SelfPlan = planSelf(base({ from: '2024-01-01', to: '2024-12-31' }, READINGS))
const row = { infoTaxesText: 'Energiesteuer 312,00 €, Umsatzsteuer 19 %', infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15, consumerContract: 'none' }
const input = (over: Partial<InfoInput> = {}): InfoInput => ({
  byConsumption: true, energy: 'gas', districtRequired: 'yes', row, prevClimateFactor: null, meteringCents: 18000, contacts: INFO_CONTACTS, plan, prev,
  units: { heating: 'kWh', water: 'm³' }, ...over,
})

test('vollständig: nichts fehlt; Vergleich je Mieter mit Hausdurchschnitt und Witterungsbereinigung', () => {
  const info = heatingInfoOf(input())
  assert.deepEqual([info.scope, info.missing, info.uncertain], ['full', [], []])
  assert.deepEqual(info.dispute, { kind: 'none' })
  const a = info.users.find((u) => u.tenancyId === 'A') ?? assert.fail('A')
  near(a.heating?.now, 12000, 'A jetzt')
  near(a.heating?.perM2, 200, 'A je m²')
  near(a.heating?.houseAvgPerM2, 40000 / 200, 'Haus je m²')
  near(a.heating?.prev, 1000, 'A Vorjahr')
  near(a.heating?.nowAdjusted, 12960, 'A bereinigt')
  near(a.heating?.prevAdjusted, 1150, 'A Vorjahr bereinigt')
  assert.equal(a.firstPeriod, false)
})

test('Review Focus 1: C2 ohne Vorjahr ist erstes Jahr, nur für ihn; die anderen vergleichen', () => {
  const info = heatingInfoOf(input())
  assert.deepEqual(info.users.filter((u) => u.firstPeriod).map((u) => u.tenancyId), ['C2'])
  assert.equal(info.missing.includes('5'), false)
})

test('Review Focus 2: Vorjahresfaktor fehlt → Nr. 5 fehlt, kein halber Vergleich; Faktor der vorigen Zeile gilt', () => {
  const ohne = heatingInfoOf(input({ row: { ...row, climateFactorPrev: null } }))
  assert.ok(ohne.missing.includes('5'))
  assert.equal(ohne.users.find((u) => u.tenancyId === 'A')?.heating?.prevAdjusted, null)
  assert.equal(ohne.users.find((u) => u.tenancyId === 'A')?.heating?.nowAdjusted, null)
  const vorige = heatingInfoOf(input({ row: { ...row, climateFactorPrev: null }, prevClimateFactor: 1.15 }))
  assert.equal(vorige.missing.includes('5'), false)
})

test('Steuern fehlen (1 b), Fernwärme ohne Emissionen (1 a), Verbrauchervertrag unbeantwortet (3, vielleicht)', () => {
  const info = heatingInfoOf(input({ energy: 'districtHeating', row: { ...row, infoTaxesText: '  ', consumerContract: null } }))
  assert.deepEqual(info.missing, ['1a', '1b'])
  assert.deepEqual(info.uncertain, ['3'])
  const frueh = heatingInfoOf(input({ energy: 'districtHeating', districtRequired: 'maybe' }))
  assert.deepEqual([frueh.missing, frueh.uncertain], [[], ['1a']])
  const mit = heatingInfoOf(input({ energy: 'districtHeating', row: { ...row, infoDistrictGhg: 180, infoDistrictPef: 0.7, consumerContract: 'Wir nehmen an Streitbeilegungsverfahren nicht teil.' } }))
  assert.deepEqual([mit.missing, mit.district, mit.dispute], [[], { ghg: 180, pef: 0.7 }, { kind: 'text', text: 'Wir nehmen an Streitbeilegungsverfahren nicht teil.' }])
})

test('Ohne Vorperiode: alle Mieter im ersten Jahr, Nr. 5 nicht „sicher fehlend“', () => {
  const info = heatingInfoOf(input({ prev: null, row: { ...row, climateFactorPrev: null } }))
  assert.equal(info.missing.includes('5'), false)
  assert.ok(info.users.every((u) => u.firstPeriod))
})

test('Abs. 5: ohne Verteilung nach Verbrauch nur Nr. 2 und 3', () => {
  const info = heatingInfoOf(input({ byConsumption: false, plan: null, prev: null, row: { ...row, infoTaxesText: null, climateFactor: null } }))
  assert.deepEqual([info.scope, info.missing, info.users], ['minimal', [], []])
  assert.ok(info.contacts.length >= 3)
  assert.equal(byConsumption(null), false)
  assert.equal(byConsumption(plan), true)
})
```

An `server/test/heating.test.ts` anhängen (Abschnitt von PR 10 „Anteil nach Verbrauch“):

```ts
test('§ 10: mehr als 70 % nach Vereinbarung erbt mit dem Anteil; § 7 Abs. 1 Satz 2 bleibt Mindestanteil', () => {
  const rows = [{ period: '2024-01', heatConsumptionPct: 80, waterConsumptionPct: 80, insulationRule: 'notApplies' as const, above70Agreed: true }]
  const geerbt = consumptionSharesOf(rows, '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([geerbt.heating, geerbt.above70Agreed, geerbt.insulationRule], [80, true, 'notApplies'])
  const eigen = consumptionSharesOf([...rows, { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'unknown' as const, above70Agreed: null }], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([eigen.heating, eigen.above70Agreed, eigen.insulationRule], [70, false, 'unknown'])
  // Pflichtanteil mit Vereinbarung darüber (Abweichung 9): der vereinbarte höhere Wert gilt.
  const pflicht = consumptionSharesOf([{ period: '2025-01', heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies' as const, above70Agreed: true }], '2025-01', 'oil', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([pflicht.heating, pflicht.forced], [85, true])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/heating-info.test.ts test/heating.test.ts`
Expected: FAIL; `ERR_MODULE_NOT_FOUND` für `src/heatingInfo.ts`, `above70Agreed` ist `undefined`.

- [ ] **Step 3: § 10 und § 7 Abs. 1 Satz 2 im Anteil (`server/src/heating.ts`)**

`ShareRow` und `ConsumptionShares` ersetzen durch:

```ts
export type ShareRow = { period: string; heatConsumptionPct: number | null; waterConsumptionPct: number | null; insulationRule: InsulationRule | null; above70Agreed?: boolean | null }
export type ConsumptionShares = {
  heating: number
  water: number | null
  forced: boolean
  previous: { heating: number; water: number | null } | null
  own: boolean
  changed: boolean
  // Heizung PR 14: mehr als 70 % mit Vereinbarung (§ 10), mit dem Anteil geerbt; die geltende Angabe zu
  // § 7 Abs. 1 Satz 2 (für `heating.insulation-rule-unknown`).
  above70Agreed: boolean
  insulationRule: InsulationRule | null
}
```

In `consumptionSharesOf` die Rückgabe ersetzen durch:

```ts
  // § 10 (Heizung PR 14): Die Vereinbarung gehört zum Anteil; geerbt wird sie mit ihm. Ein vereinbarter
  // Anteil über dem Pflichtanteil des § 7 Abs. 1 Satz 2 bleibt (Abweichung 9 des Plans, Auslegung).
  const agreed = ownHeat !== null ? own?.above70Agreed === true : prevShare?.above70Agreed === true
  const pflicht = isForced ? forced() : null
  return {
    heating: pflicht !== null && !(agreed && heat > pflicht) ? pflicht : heat,
    water,
    forced: isForced,
    previous,
    own: ownHeat !== null,
    changed: ownHeat !== null && previous !== null && (ownHeat !== previous.heating || water !== previous.water),
    above70Agreed: agreed,
    insulationRule: insulation,
  }
```

(`prevShare`, `own`, `ownHeat`, `heat`, `insulation`, `isForced` sind die Namen in `consumptionSharesOf`
aus PR 10. Die Tests von PR 10 vergleichen einzelne Felder, nicht das ganze Objekt; vergleicht einer das
ganze Objekt mit `assert.deepEqual`, kommen die beiden neuen Felder in seine Erwartung.)

- [ ] **Step 4: Angaben nach § 6a (`server/src/heatingInfo.ts`, neu)**

```ts
// Die Informationen nach § 6a Abs. 3 und 5 HeizkostenV (Heizung PR 14, Entwurf 8.8) als reine Funktion.
// Kein Geld außer Nr. 1 c, keine Uhr, keine Locale. Was fehlt, sagt `missing` (sicher) und `uncertain`
// (vielleicht: Fernwärme vor 2022, Verbrauchervertrag unbeantwortet); das erste Jahr eines Mieters steht
// je Mieter (`firstPeriod`, Entwurf 15.1 Nr. 14).
//
// Nr. 4: Hausdurchschnitt je m², so benannt, als Ersatz für den normierten Durchschnittsnutzer
// (15.2 F5). Nr. 5: Wärmeverbrauch mal Klimafaktor des DWD, Warmwasser unbereinigt daneben (Satz 2, 3).
// Beides ⟨Norm offen: DIN 94680⟩.
import type { HeatingEnergy, HeatingInfoStatement, InfoComparison, InfoContact, InfoItem, SelfPot } from '../../shared/types.ts'
import { CONSUMER_CONTRACT_NONE } from '../../shared/heatingInfo.ts'
import type { SelfPlan, SelfUnitPlan } from './heating.ts'

export type InfoRow = {
  infoTaxesText: string | null
  infoDistrictGhg: number | null
  infoDistrictPef: number | null
  climateFactor: number | null
  climateFactorPrev: number | null
  consumerContract: string | null
}
export type InfoInput = {
  // § 6a Abs. 3 (beruht auf dem Verbrauch) oder Abs. 5
  byConsumption: boolean
  energy: HeatingEnergy
  // `hkv.info.district-emissions`: `maybe` bei einem Zeitraum vor dem 01.01.2022 (Abweichung 2)
  districtRequired: 'yes' | 'maybe'
  row: InfoRow | null
  // Klimafaktor aus der Zeile der vorigen Heizperiode, falls in dieser kein Vorjahresfaktor steht
  prevClimateFactor: number | null
  meteringCents: number
  contacts: readonly InfoContact[]
  contactsChecked?: string
  plan: SelfPlan | null
  prev: SelfPlan | null
  units: { heating: string; water: string }
}

// Beruht die Abrechnung auf dem Verbrauch? Ja, sobald ein Topf nach Verbrauch verteilt wird; ein Topf nur
// nach Fläche (nicht erfasst oder § 9a Abs. 2) zählt nicht.
export function byConsumption(plan: SelfPlan | null): boolean {
  return plan !== null && plan.pots.some((p) => plan.totals[p].measured && !plan.totals[p].overThreshold)
}

const potArea = (u: SelfUnitPlan, p: SelfPot): number => (p === 'heating' ? u.heatArea : u.unit.areaM2 || 0)
const filled = (t: string | null): boolean => t !== null && t.trim() !== ''

function sumFor(plan: SelfPlan | null, tenancyId: string, p: SelfPot): { value: number | null; days: number } {
  if (!plan) return { value: null, days: 0 }
  let value: number | null = null
  let days = 0
  for (const u of plan.units) {
    for (const x of u.users) {
      if (x.tenancyId !== tenancyId) continue
      days += x.days
      const v = x.pots[p].value
      if (v !== null && u.measured[p] !== false) value = (value ?? 0) + v
    }
  }
  return { value, days }
}

export function heatingInfoOf(i: InfoInput): HeatingInfoStatement {
  const missing: InfoItem[] = []
  const uncertain: InfoItem[] = []
  const row = i.row
  const contract = row?.consumerContract ?? null
  const dispute: HeatingInfoStatement['dispute'] = contract === null ? { kind: 'unknown' } : contract === CONSUMER_CONTRACT_NONE ? { kind: 'none' } : filled(contract) ? { kind: 'text', text: contract.trim() } : { kind: 'unknown' }
  if (dispute.kind === 'unknown') uncertain.push('3')
  const factor = row?.climateFactor ?? null
  const factorPrev = row?.climateFactorPrev ?? i.prevClimateFactor
  const base = {
    energy: i.energy,
    contacts: [...i.contacts],
    contactsChecked: i.contactsChecked ?? '',
    dispute,
    units: i.units,
    climate: { factor, factorPrev },
  }
  if (!i.byConsumption || !i.plan) {
    return { ...base, scope: 'minimal', district: null, taxesText: null, meteringCents: 0, users: [], missing, uncertain }
  }
  const plan = i.plan
  // Nr. 1 a: Fernwärme mit Emissionen und Primärenergiefaktor des Netzes.
  const district = i.energy === 'districtHeating' ? { ghg: row?.infoDistrictGhg ?? null, pef: row?.infoDistrictPef ?? null } : null
  if (district && (district.ghg === null || district.pef === null)) (i.districtRequired === 'yes' ? missing : uncertain).push('1a')
  // Nr. 1 b: Steuern, Abgaben, Zölle laut Rechnung.
  const taxesText = row && filled(row.infoTaxesText) ? (row.infoTaxesText ?? '').trim() : null
  if (taxesText === null) missing.push('1b')
  // Nr. 4 und 5 je Mieter.
  const avg = (p: SelfPot): number | null => {
    const t = plan.totals[p]
    return plan.pots.includes(p) && t.measured && !t.overThreshold && t.area > 0 ? t.consumption / t.area : null
  }
  const tenancyIds = [...new Set(plan.units.flatMap((u) => u.users.flatMap((x) => (x.role === 'tenancy' && x.tenancyId ? [x.tenancyId] : []))))]
  const users: InfoComparison[] = tenancyIds.map((id) => {
    const unit = plan.units.find((u) => u.users.some((x) => x.tenancyId === id))
    const label = unit?.users.find((x) => x.tenancyId === id)?.label ?? id
    const now = { heating: sumFor(plan, id, 'heating'), water: sumFor(plan, id, 'water') }
    const before = { heating: sumFor(i.prev, id, 'heating'), water: sumFor(i.prev, id, 'water') }
    const area = (p: SelfPot) => (unit ? potArea(unit, p) : 0)
    const perM2 = (v: number | null, p: SelfPot) => (v !== null && area(p) > 0 ? v / area(p) : null)
    const firstPeriod = before.heating.value === null
    const adjusted = factor !== null && factorPrev !== null && !firstPeriod
    return {
      tenancyId: id,
      label,
      days: now.heating.days,
      prevDays: firstPeriod ? null : before.heating.days,
      heating: avg('heating') === null && now.heating.value === null ? null : {
        now: now.heating.value,
        perM2: perM2(now.heating.value, 'heating'),
        houseAvgPerM2: avg('heating'),
        prev: before.heating.value,
        nowAdjusted: adjusted && now.heating.value !== null ? now.heating.value * factor : null,
        prevAdjusted: adjusted && before.heating.value !== null ? before.heating.value * factorPrev : null,
      },
      water: !plan.pots.includes('water') ? null : {
        now: now.water.value,
        perM2: perM2(now.water.value, 'water'),
        houseAvgPerM2: avg('water'),
        prev: before.water.value,
      },
      firstPeriod,
    }
  })
  // Nr. 5 sicher fehlend, wenn es Mieter mit Vorjahr gibt und ein Klimafaktor fehlt.
  if (users.some((u) => !u.firstPeriod) && (factor === null || factorPrev === null)) missing.push('5')
  return { ...base, scope: 'full', district, taxesText, meteringCents: i.meteringCents, users, missing, uncertain }
}
```

`server/test/law-literals.test.ts`: `'server/src/heatingInfo.ts'` in `ENGINE_FILES` aufnehmen.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heating-info.test.ts test/heating.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS. Die Werte: A 2025 13.000 − 1.000 = 12.000 kWh, 2024 1.000 − 0 = 1.000; 12.000 · 1,08 =
12.960; 1.000 · 1,15 = 1.150; Haus 40.000 kWh auf 200 m² = 200 kWh je m².

- [ ] **Step 6: Commit**

```bash
git add server/src/heatingInfo.ts server/src/heating.ts server/test/heating-info.test.ts server/test/heating.test.ts server/test/law-literals.test.ts
git commit -m "Pflichtangaben nach § 6a als reine Rechnung; § 10 erbt mit dem Anteil

Hausdurchschnitt je m² und witterungsbereinigter Vergleich je Mieter, das erste Jahr je Mieter;
sicher und vielleicht fehlende Angaben getrennt.

Refs #99"
```

---

### Task 4: Speichern und prüfen: Angaben je Heizperiode, § 10, § 2, § 11, Routen

**Files:**
- Create: `server/src/db/heatingInfo.ts`
- Modify: `server/src/db/heatingSelf.ts`, `server/src/db/heating.ts`, `server/src/db/co2.ts`, `server/src/index.ts`
- Test: `server/test/db-pflichtangaben.test.ts` (neu), `server/test/db-heizkosten.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes: Task 1–3; PR 4 `guardHeatingPlant`, `updateHeatingPlant`, `createHeatingPlant`, `readUnits`, `readTenancies`, `readProperties`; PR 6/8 `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`, `heatingPeriodViews`; PR 10 `checkShares`, `shareRows`, `saveDistribution`, `setUpSelf`, `distributionOf`; `mayAgreeOtherwise`.
- Produces:
  - `saveHeatingInfo(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingInfoInputs | null>`
  - `postalCodeOf(address: string | null | undefined): string | null` (in `shared/heatingInfo.ts`)
  - `PUT /api/heating-plants/:id/periods/:period/info` → 200 `HeatingInfoInputs`; 400; 404; 409
  - `saveDistribution` und `setUpSelf` nehmen `above70Agreed`; `HeatingDistribution.own.above70Agreed`, `.effective.above70Agreed`
  - `guardHeatingPlant` prüft `agreedOtherwise` gegen § 2

- [ ] **Step 1: Write the failing tests**

`server/test/db-pflichtangaben.test.ts`:

```ts
// Pflichtangaben und Ausnahmen in der Datenbank (Heizung PR 14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity } from '../src/db/repository.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { saveDistribution, setUpSelf } from '../src/db/heatingSelf.ts'
import { saveHeatingInfo } from '../src/db/heatingInfo.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { periodKey } from '../../shared/period.ts'
import { postalCodeOf } from '../../shared/heatingInfo.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-pflichtangaben-'))
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
const newId = () => `m-${++ids}`

// Drei Wohnungen, eigene Abrechnung (wie PR 10, db-heizkosten.test.ts).
async function haus(opened: Opened, wohnungen: readonly (readonly [string, number, boolean])[] = [['a', 60, false], ['b', 80, false], ['c', 60, false]]): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area, selbst] of wohnungen) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: !selbst, selfUsed: selbst })
      if (!selbst) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}
const SETUP = { period: '2026-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }

test('Angaben nach § 6a speichern; Klimafaktor über 0; Verbrauchervertrag none, Text oder offen; abgeschlossen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', SETUP, '2025-12-01', newId))
    const save = (body: Record<string, unknown>) => opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', body))
    const saved = await save({ infoTaxesText: ' Energiesteuer 312,00 € ', climateFactor: 1.08, climateFactorPrev: 1.15, consumerContract: 'none' })
    assert.deepEqual(saved, { infoTaxesText: 'Energiesteuer 312,00 €', infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15, consumerContract: 'none', postalCode: null })
    await assert.rejects(save({ climateFactor: 0 }), status(400, /Klimafaktor.*größer als 0/))
    await assert.rejects(save({ infoDistrictPef: -1 }), status(400, /Primärenergiefaktor.*ab 0/))
    await assert.rejects(save({ consumerContract: '   ' }), status(400, /Streitbeilegung/))
    assert.equal((await save({ consumerContract: null }))?.consumerContract, null)
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2026-01'), closedAt: '2027-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(save({ climateFactor: 1 }), status(409, /abgeschlossen/))
    assert.equal(await opened.write((db) => saveHeatingInfo(db, 'gibt-es-nicht', '2026-01', {})), null)
  })
})

test('Angaben beim Messdienst: 400, denn er liefert sie mit seiner Abrechnung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'service' }))
    await assert.rejects(opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', { climateFactor: 1 })), status(400, /Messdienst/))
  })
})

test('Postleitzahl aus der Adresse', () => {
  assert.equal(postalCodeOf('Lindenweg 3, 79100 Freiburg'), '79100')
  assert.equal(postalCodeOf('Lindenweg 3'), null)
  assert.equal(postalCodeOf(null), null)
})

test('Review Focus 5: § 10 – mehr als 70 % nur mit Vereinbarung, nie über 100 %, beim Pflichtanteil nie darunter', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 80 }, '2025-12-01', newId)), status(400, /§ 10 HeizkostenV.*vereinbart/))
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 80, above70Agreed: true }, '2025-12-01', newId))
    assert.equal(ok?.plant.method, 'self')
    const row = (await opened.read(readStock)).heatingPeriodRows.find((r) => r.plantId === 'hp' && r.period === '2026-01')
    assert.deepEqual([row?.heatConsumptionPct, row?.above70Agreed], [80, true])
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 101, waterConsumptionPct: 70, insulationRule: 'notApplies', above70Agreed: true }, '2026-11-01')), status(400, /höchstens 100 %/))
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 60, waterConsumptionPct: 70, insulationRule: 'applies' }, '2026-11-01')), status(400, /§ 7 Abs\. 1 Satz 2/))
    const pflichtMehr = await opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies', above70Agreed: true }, '2026-11-01'))
    assert.deepEqual([pflichtMehr?.effective?.heating, pflichtMehr?.effective?.above70Agreed], [85, true])
  })
})

test('Review Focus 3: Vereinbarung nach § 2 nur im Haus mit höchstens zwei Wohnungen, eine selbst bewohnt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { agreedOtherwise: 'area' })), status(400, /§ 2 HeizkostenV.*höchstens zwei Wohnungen/))
  })
  await withDatabase(async (opened) => {
    await haus(opened, [['a', 90, true], ['b', 70, false]])
    const p = await opened.write((db) => updateHeatingPlant(db, 'hp', { agreedOtherwise: 'area' }))
    assert.equal(p?.agreedOtherwise, 'area')
    // Zurücknehmen geht immer.
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp', { agreedOtherwise: null })))?.agreedOtherwise, null)
  })
})

test('Ausnahme nach § 11: Abrechnung vereinbart nur mit Ausnahme; ohne Ausnahme wird die Antwort verworfen', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const mit = await opened.write((db) => updateHeatingPlant(db, 'hp', { exemption: 'pre1981', exemptionBillingAgreed: true }))
    assert.deepEqual([mit?.exemption, mit?.exemptionBillingAgreed], ['pre1981', true])
    const ohne = await opened.write((db) => updateHeatingPlant(db, 'hp', { exemption: 'none' }))
    assert.deepEqual([ohne?.exemption, ohne?.exemptionBillingAgreed], ['none', null])
    const monat = await opened.write((db) => updateHeatingPlant(db, 'hp', { monthlyInfoElsewhere: true }))
    assert.equal(monat?.monthlyInfoElsewhere, true)
  })
})

test('Ansicht je Heizperiode: Eingaben zu § 6a und die Postleitzahl des Objekts', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => db.run(sql`UPDATE properties SET address = 'Lindenweg 3, 79100 Freiburg' WHERE id = 'objekt-1'`))
    await opened.write((db) => setUpSelf(db, 'hp', SETUP, '2025-12-01', newId))
    await opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', { climateFactor: 1.08 }))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026', '2025-12-01')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.info.climateFactor, view?.info.postalCode], [1.08, '79100'])
  })
})
```

(`sql` aus `'drizzle-orm'`. Heißt die Spalte der Objektadresse anders als `address` (#92), gilt deren
Name; gibt es eine Schreibfunktion für Objekte (`updateProperty`), wird sie statt der SQL-Zeile benutzt.)

In `server/test/db-heizkosten.test.ts` (PR 10) im Test „Einrichtung: Anteil 50 bis 70 % …“ die Erwartung
`status(400, /§ 10 HeizkostenV.*späteren Version/)` ersetzen durch `status(400, /§ 10 HeizkostenV.*vereinbart/)`.

`server/test/api.test.ts`, hinter dem Test von PR 13:

```ts
test('Angaben nach § 6a über die Route (Heizung PR 14)', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const ok = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/info`, { climateFactor: 1.08, consumerContract: 'none' })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<{ climateFactor: number }>(ok)).climateFactor, 1.08)
    const falsch = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/info`, { climateFactor: -2 })
    assert.equal(falsch.status, 400)
    assert.equal((await send('PUT', '/api/heating-plants/gibt-es-nicht/periods/2025-01/info', {})).status, 404)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-pflichtangaben.test.ts test/db-heizkosten.test.ts test/api.test.ts`
Expected: FAIL; `ERR_MODULE_NOT_FOUND` für `src/db/heatingInfo.ts`.

- [ ] **Step 3: Postleitzahl (`shared/heatingInfo.ts`)**

Ans Dateiende:

```ts
// Die Postleitzahl aus der Adresse des Objekts, für den Klimafaktor des DWD (Heizung PR 14). Fünf Ziffern
// als eigenes Wort; ohne eine solche Folge `null`.
export function postalCodeOf(address: string | null | undefined): string | null {
  const m = /(?:^|\D)(\d{5})(?!\d)/.exec(address ?? '')
  return m?.[1] ?? null
}
```

- [ ] **Step 4: Speichern (`server/src/db/heatingInfo.ts`, neu)**

```ts
// Eingaben zu den Informationen nach § 6a Abs. 3 HeizkostenV je Heizperiode (Heizung PR 14, Entwurf 8.8).
// Die Spalten stehen seit PR 4 in `heating_periods`. Bei eigener Abrechnung und bei freien Schlüsseln;
// beim Messdienst liefert dieser die Angaben mit seiner Abrechnung.
import { eq } from 'drizzle-orm'
import type { HeatingInfoInputs } from '../../../shared/types.ts'
import { CONSUMER_CONTRACT_NONE, postalCodeOf } from '../../../shared/heatingInfo.ts'
import type { Database } from './client.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readProperties } from './read.ts'
import { has, HeatingError, raw } from './repository.ts'
import { heatingPeriods } from './schema.ts'

type Inputs = Omit<HeatingInfoInputs, 'postalCode'>

const numberOrNull = (v: unknown, name: string, positive: boolean): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive ? v <= 0 : v < 0)) {
    throw new HeatingError(400, positive ? `Der ${name} ist eine Zahl größer als 0.` : `Der ${name} ist eine Zahl ab 0.`)
  }
  return v
}

// `null`, wenn es die Anlage nicht gibt. Nur die Felder des Rumpfs ändern sich; die übrigen bleiben.
export async function saveHeatingInfo(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingInfoInputs | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method === 'service') {
    throw new HeatingError(400, 'Rechnet ein Messdienst oder die Gemeinschaft ab, stehen die Angaben nach § 6a HeizkostenV in deren Abrechnung; hier tragen Sie nichts ein.')
  }
  const h = heatingPeriodOf(ctx, period)
  const next: Partial<Inputs> = {}
  if (has(body, 'infoTaxesText')) {
    const t = raw(body, 'infoTaxesText')
    next.infoTaxesText = typeof t === 'string' && t.trim() !== '' ? t.trim() : null
  }
  if (has(body, 'infoDistrictGhg')) next.infoDistrictGhg = numberOrNull(raw(body, 'infoDistrictGhg'), 'Wert der Treibhausgasemissionen', false)
  if (has(body, 'infoDistrictPef')) next.infoDistrictPef = numberOrNull(raw(body, 'infoDistrictPef'), 'Primärenergiefaktor', false)
  if (has(body, 'climateFactor')) next.climateFactor = numberOrNull(raw(body, 'climateFactor'), 'Klimafaktor', true)
  if (has(body, 'climateFactorPrev')) next.climateFactorPrev = numberOrNull(raw(body, 'climateFactorPrev'), 'Klimafaktor des Vorzeitraums', true)
  if (has(body, 'consumerContract')) {
    const c = raw(body, 'consumerContract')
    if (c === null) next.consumerContract = null
    else if (c === CONSUMER_CONTRACT_NONE) next.consumerContract = CONSUMER_CONTRACT_NONE
    else if (typeof c === 'string' && c.trim() !== '') next.consumerContract = c.trim()
    else throw new HeatingError(400, 'Bei einem Verbrauchervertrag tragen Sie die Information zur Streitbeilegung ein (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV); sonst wählen Sie „kein Verbrauchervertrag“.')
  }
  let saved: Inputs | null = null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    if (Object.keys(next).length > 0) await tx.update(heatingPeriods).set(next).where(eq(heatingPeriods.id, id))
    const [r] = await tx.select().from(heatingPeriods).where(eq(heatingPeriods.id, id))
    saved = {
      infoTaxesText: r?.infoTaxesText ?? null, infoDistrictGhg: r?.infoDistrictGhg ?? null, infoDistrictPef: r?.infoDistrictPef ?? null,
      climateFactor: r?.climateFactor ?? null, climateFactorPrev: r?.climateFactorPrev ?? null, consumerContract: r?.consumerContract ?? null,
    }
  })
  const property = (await readProperties(db)).find((p) => p.id === ctx.plant.propertyId)
  if (!saved) throw new Error('Die Heizperiode ist nach dem Speichern nicht auffindbar.')
  return { ...(saved as Inputs), postalCode: postalCodeOf(property?.address ?? null) }
}
```

(`readProperties` liest die Objekte (#92); heißt die Lesefunktion anders, gilt deren Name. `Database`
aus `'./client.ts'` wie in db/heatingSelf.ts.)

- [ ] **Step 5: Ansicht (`server/src/db/co2.ts`)**

In `heatingPeriodViews` die Zeile aus Task 2 Step 8 ersetzen durch:

```ts
      // Eingaben zu § 6a (Heizung PR 14) und die Postleitzahl des Objekts für den Klimafaktor.
      info: {
        infoTaxesText: row?.infoTaxesText ?? null, infoDistrictGhg: row?.infoDistrictGhg ?? null, infoDistrictPef: row?.infoDistrictPef ?? null,
        climateFactor: row?.climateFactor ?? null, climateFactorPrev: row?.climateFactorPrev ?? null, consumerContract: row?.consumerContract ?? null,
        postalCode,
      },
```

mit der Zeile vor der Schleife
`const postalCode = postalCodeOf((await readProperties(db)).find((p) => p.id === ctx.plant.propertyId)?.address ?? null)`
(Importe `postalCodeOf` aus `'../../../shared/heatingInfo.ts'`, `readProperties` aus `'./read.ts'`).

- [ ] **Step 6: § 10 beim Anteil (`server/src/db/heatingSelf.ts`)**

In `checkShares` die Rückgabe um `above70Agreed` erweitern und die Prüfungen ersetzen. Der Rumpf ab
`const { min, max } = valueAt(hkvConsumptionShare, h.from)` bis vor den Block „§ 6 Abs. 4“ wird:

```ts
  const above70Agreed = raw(body, 'above70Agreed') === true
  const { min, max } = valueAt(hkvConsumptionShare, h.from)
  for (const v of withWater ? [heating, water] : [heating]) {
    if (v === null) throw new HeatingError(400, 'Bitte geben Sie an, welcher Anteil der Kosten nach Verbrauch verteilt wird.')
    if (v > 100) throw new HeatingError(400, 'Nach Verbrauch verteilt werden höchstens 100 % der Kosten.')
    if (v > max && !above70Agreed) {
      throw new HeatingError(400, `Mehr als ${max} % nach Verbrauch gehen nur, wenn es mit den Mietern vereinbart ist (§ 10 HeizkostenV). Ist es vereinbart, setzen Sie das Häkchen „vereinbart“.`)
    }
    if (v < min) throw new HeatingError(400, `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).`)
  }
  if (heating === null) throw new HeatingError(400, 'Bitte geben Sie den Anteil an.')
  if (insulationRule === 'applies' && OIL_OR_GAS.includes(plant.energy)) {
    const forced = valueAt(hkvConsumptionShareForced, h.from)
    // Pflichtanteil (§ 7 Abs. 1 Satz 2); darüber nur mit Vereinbarung (§ 10, Abweichung 9 des Plans).
    if (heating < forced || (heating > forced && !above70Agreed)) {
      throw new HeatingError(400, `Bei Öl- oder Gasheizung, Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen sind von den Heizkosten ${forced} % nach Verbrauch zu verteilen (§ 7 Abs. 1 Satz 2 HeizkostenV); mehr nur mit Vereinbarung (§ 10).`)
    }
  }
```

Die Signatur wird
`function checkShares(…): { heating: number; water: number | null; insulationRule: InsulationRule; above70Agreed: boolean }`
und das `return` `{ heating, water, insulationRule, above70Agreed }`. In `saveDistribution` und `setUpSelf`
das `set({ … })` der Zeile der Heizperiode um `above70Agreed: next.above70Agreed` bzw.
`above70Agreed: shares.above70Agreed` ergänzen. `shareRows` liest zusätzlich
`above70Agreed: heatingPeriods.above70Agreed`. In `distributionOf` `own` und `effective` um
`above70Agreed: own?.above70Agreed === true` bzw. `above70Agreed: shares.above70Agreed` ergänzen.

- [ ] **Step 7: § 2 und § 11 an der Anlage (`server/src/db/heating.ts`)**

In `guardHeatingPlant` hinter den Prüfungen von PR 10:

```ts
  // § 2 HeizkostenV (Heizung PR 14, Abweichung 8): eine abweichende Vereinbarung nur im Gebäude mit
  // höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt. Wohnung ist hier, was Fläche
  // hat, selbst genutzt wird oder ein Mietverhältnis hat; calc.ts prüft im Zeitraum erneut.
  if (after.agreedOtherwise !== null && (before === null || before.agreedOtherwise !== after.agreedOtherwise)) {
    const propertyUnits = (await readUnits(db)).filter((u) => u.propertyId === after.propertyId)
    const tenancies = await readTenancies(db)
    const dwelling = (u: (typeof propertyUnits)[number]) => (u.areaM2 || 0) > 0 || u.selfUsed === true || tenancies.some((t) => t.unitId === u.id)
    if (!mayAgreeOtherwise(propertyUnits, dwelling)) {
      throw new HeatingError(400, 'Eine abweichende Vereinbarung nach § 2 HeizkostenV gibt es nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Legen Sie Ihre eigene Wohnung als selbstgenutzt an, wenn das zutrifft.')
    }
  }
```

(Importe `readTenancies`, `readUnits` aus `'./read.ts'`, `mayAgreeOtherwise` aus
`'../../../shared/heating.ts'`. Heißt `before` in `guardHeatingPlant` anders, gilt dessen Name; beim
Anlegen ist es `null`.) In `mergeHeatingPlant` steht seit Task 2, dass `exemptionBillingAgreed` ohne
Ausnahme `null` wird.

- [ ] **Step 8: Route (`server/src/index.ts`)**

Import `import { saveHeatingInfo } from './db/heatingInfo.ts'`; hinter den Routen von PR 13:

```ts
// Eingaben zu den Informationen nach § 6a Abs. 3 HeizkostenV je Heizperiode (Heizung PR 14).
app.put('/api/heating-plants/:id/periods/:period/info', async (req, res) => {
  const result = await writeData((db) => saveHeatingInfo(db, req.params.id, req.params.period, bodyObject(req)))
  if (!result) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-pflichtangaben.test.ts test/db-heizkosten.test.ts test/db-heizanlage.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/heatingInfo.ts server/src/db server/src/index.ts server/test/db-pflichtangaben.test.ts server/test/db-heizkosten.test.ts server/test/api.test.ts
git commit -m "Pflichtangaben speichern; mehr als 70 % nur mit Vereinbarung, § 2 nur im Zweifamilienhaus

Refs #99"
```

---

### Task 5: Berechnung: Ausweis nach § 6a, vier Hinweise, keine Kürzung bei Ausnahme oder Vereinbarung

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-pflichtangaben.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1–4; im Bestand `heatingAgreeable`, `heatingCuts`, `heating.shareOutside`, Block `heating.flat-rate`; PR 4 `remoteReadingVerdict`; PR 6/7 CO₂-Block (`co2Pots`, `applicable`, `etsExempt`, `co2DeductionsOf`, `report`, `cutsOn`); PR 6/11 Bedingung `heating.dhw-not-metered`; PR 10 `selfPlans`, Hinweisschleife (`notYet`, `list`, `unmeasured`), `cutOf`, `nameOf`, `POT_UNIT`, Block des Plans (`rows`, `shares`, `blocked`); PR 13 `SelfPlantPlan.prev`.
- Produces:
  - Codes `heating.info-incomplete` (warning), `heating.monthly-info` (warning), `heating.exemption` (hint), `heating.insulation-rule-unknown` (hint)
  - `suspendedBy(plantId): 'exemption' | 'agreement' | null` in `computeSettlement`
  - `HeatingStatement.info`; `SelfHeatingStatement.shares.above70Agreed`; `SelfPlantPlan.prevKey`

- [ ] **Step 1: Write the failing test**

`server/test/calc-pflichtangaben.test.ts`:

```ts
// Pflichtangaben und Ausnahmen in der Abrechnung (Heizung PR 14). Grundlage ist Beispiel A (Entwurf 8.6)
// aus server/testing/selfHeating.ts, ergänzt um Stände am 31.12.2023, damit es eine Vorperiode gibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const textOf = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const plantOf = (s: Snapshot) => s.heatingPlants?.[0] ?? assert.fail('keine Anlage')

// Stände am 31.12.2023: alle Wohnungszähler auf 0, damit 2024 einen Verbrauch hat (A 1.000, C 500 kWh).
function mitVorperiode(s: Snapshot): Snapshot {
  const extra = s.meters.filter((m) => m.unitId !== null).map((m) => ({ meterId: m.id, date: '2023-12-31', value: 0 }))
  return { ...s, readings: [...s.readings, ...extra] }
}
function mitAngaben(s: Snapshot, over: Record<string, unknown> = {}): Snapshot {
  const rows = (s.heatingPeriodRows ?? []).map((r) => (r.period === s.period.key
    ? { ...r, infoTaxesText: 'Energiesteuer 312,00 €', climateFactor: 1.08, climateFactorPrev: 1.15, consumerContract: 'none', ...over }
    : r))
  return { ...s, heatingPeriodRows: rows }
}
const mitAnlage = (s: Snapshot, over: Record<string, unknown>): Snapshot => ({ ...s, heatingPlants: (s.heatingPlants ?? []).map((p) => ({ ...p, ...over })) })

test('Ohne Angaben: Nr. 1 b und 5 fehlen sicher (3 % je Mieter), Nr. 3 vielleicht', () => {
  const s = computeSettlement(mitVorperiode(selfSnapshot()))
  const n = s.notices.find((x) => x.code === 'heating.info-incomplete') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Es fehlen: die erhobenen Steuern, Abgaben und Zölle \(Nr\. 1 b\) und der witterungsbereinigte Vergleich mit dem Vorzeitraum \(Nr\. 5\)/)
  assert.match(n.text, /um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\)/)
  assert.match(n.text, /Verbrauchervertrag.*bis zu 3 %/s)
  assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.cut.information'))
})

test('Vollständig: kein Hinweis außer dem ersten Jahr von C2 („bis zu“, Auslegung); Ausweis mit Vergleich', () => {
  const s = computeSettlement(mitAngaben(mitVorperiode(selfSnapshot())))
  const text = textOf(s, 'heating.info-incomplete')
  assert.match(text, /Mieter C2.*keinen Verbrauch im vorhergehenden Abrechnungszeitraum.*bis zu 3 %.*Auslegung/s)
  assert.doesNotMatch(text, /Es fehlen/)
  const info = s.heating?.find((h) => h.info)?.info ?? assert.fail('kein Ausweis')
  assert.deepEqual([info.scope, info.missing, info.taxesText], ['full', [], 'Energiesteuer 312,00 €'])
  const a = info.users.find((u) => u.label === 'Mieter A') ?? assert.fail('A')
  assert.ok(a.heating && Math.abs((a.heating.nowAdjusted ?? 0) - 12000 * 1.08) < 1e-6)
  assert.ok(info.meteringCents > 0)
})

test('Monatliche Information: bei fernablesbarem Zähler eine Warnung „bis zu 3 %“, nicht mit Bestätigung', () => {
  const base = mitAngaben(mitVorperiode(selfSnapshot()))
  const erster = base.meters.find((m) => m.unitId !== null) ?? assert.fail('kein Wohnungszähler')
  const fern: Snapshot = { ...base, meters: base.meters.map((m) => (m.id === erster.id ? { ...m, remoteReadable: true } : m)) }
  const n = computeSettlement(fern).notices.find((x) => x.code === 'heating.monthly-info') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /monatliche Verbrauchsinformationen.*seit dem 01\.01\.2022.*bis zu 3 %.*Portal des Messdienstes/s)
  assert.ok(!codes(computeSettlement(mitAnlage(fern, { monthlyInfoElsewhere: true }))).includes('heating.monthly-info'))
  assert.ok(!codes(computeSettlement(base)).includes('heating.monthly-info'), 'ohne fernablesbaren Zähler keine Warnung')
})

test('Review Focus 4: Ausnahme nach § 11 – keine § 6a-Angaben, keine Kürzung, CO₂ nur mit vereinbarter Abrechnung', () => {
  const base = mitVorperiode(selfSnapshot())
  const relief = (s: ComputedSettlement) => s.statements.flatMap((st) => st.rows).filter((r) => r.kind === 'co2Relief').length
  assert.ok(relief(computeSettlement(base)) > 0, 'Beispiel A hat CO₂-Abzüge')
  const ex = computeSettlement(mitAnlage(base, { exemption: 'lowDemand', exemptionBillingAgreed: null }))
  assert.match(textOf(ex, 'heating.exemption'), /§ 11.*Heizwärmebedarf von weniger als 15 kWh.*§ 556a Abs\. 1 BGB.*nicht nach dem CO2KostAufG aufgeteilt \(§ 2 Abs\. 7 CO2KostAufG\)/s)
  for (const c of ['heating.info-incomplete', 'heating.monthly-info', 'heating.no-consumption']) assert.ok(!codes(ex).includes(c), c)
  assert.equal(relief(ex), 0)
  assert.equal(ex.heating?.find((h) => h.info), undefined)
  const vereinbart = computeSettlement(mitAnlage(base, { exemption: 'lowDemand', exemptionBillingAgreed: true }))
  assert.ok(relief(vereinbart) > 0)
  assert.match(textOf(vereinbart, 'heating.exemption'), /vereinbart.*teilt Mietfuchs die CO₂-Kosten/s)
})

test('Review Focus 3: Vereinbarung nach § 2 wirkt nur im Zweifamilienhaus mit Eigennutzung', () => {
  const base = mitVorperiode(selfSnapshot())
  // Drei Wohnungen: die Vereinbarung wirkt nicht, die Angaben werden weiter verlangt.
  assert.ok(codes(computeSettlement(mitAnlage(base, { agreedOtherwise: 'area' }))).includes('heating.info-incomplete'))
  // Zweifamilienhaus: a selbst bewohnt, nur b vermietet.
  const zfh: Snapshot = {
    ...base,
    units: base.units.filter((u) => u.id !== 'c').map((u) => (u.id === 'a' ? { ...u, participates: false, selfUsed: true } : u)),
    tenancies: base.tenancies.filter((t) => t.unitId === 'b'),
    meters: base.meters.filter((m) => m.unitId !== 'c'),
  }
  const ohne = computeSettlement(zfh)
  const mit = computeSettlement(mitAnlage(zfh, { agreedOtherwise: 'area' }))
  assert.ok(codes(ohne).includes('heating.info-incomplete'))
  for (const c of ['heating.info-incomplete', 'heating.monthly-info']) assert.ok(!codes(mit).includes(c), c)
})

test('Review Focus 5: 80 % nach Verbrauch nur mit Vereinbarung; sonst nicht verteilbar', () => {
  const base = mitAngaben(mitVorperiode(selfSnapshot()), { heatConsumptionPct: 80 })
  assert.ok(codes(computeSettlement(base)).includes('heating.self-incomplete'))
  const mit = computeSettlement(mitAngaben(mitVorperiode(selfSnapshot()), { heatConsumptionPct: 80, above70Agreed: true }))
  assert.ok(!codes(mit).includes('heating.self-incomplete'))
  assert.equal(mit.heating?.find((h) => h.self)?.self?.shares?.above70Agreed, true)
})

test('§ 7 Abs. 1 Satz 2 unbekannt bei Gas und 60 %: Hinweis; bei 70 % ohne Folge kein Hinweis', () => {
  const unklar = computeSettlement(mitAngaben(mitVorperiode(selfSnapshot()), { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'unknown' }))
  assert.match(textOf(unklar, 'heating.insulation-rule-unknown'), /70 %.*Wärmeschutzverordnung vom 16\. August 1994.*überwiegend gedämmt.*§ 7 Abs\. 1 Satz 2/s)
  const siebzig = computeSettlement(mitAngaben(mitVorperiode(selfSnapshot()), { insulationRule: 'unknown' }))
  assert.ok(!codes(siebzig).includes('heating.insulation-rule-unknown'))
})
```

(Beispiel A hat Gas, 70/70 % und eine Lieferung mit CO₂-Angaben, sodass Abzugszeilen entstehen
(PR 10 Task 8). Hat `selfSnapshot` die Wohnungszähler unter anderen Namen, findet `mitVorperiode` sie
über `unitId`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-pflichtangaben.test.ts`
Expected: FAIL; die Codes fehlen, `info` ist `undefined`.

- [ ] **Step 3: Codes und Importe (`server/src/calc.ts`)**

Importe: `hkvCutInformation, hkvExemptions, hkvInfoApplicable, hkvInfoDistrict, hkvMonthlyInfo` aus
`'../../shared/law/heizkostenv.ts'`; `heatingInfoOf, byConsumption` aus `'./heatingInfo.ts'`;
`INFO_CONTACTS, INFO_CONTACTS_CHECKED` aus `'../../shared/heatingInfo.ts'`; `OIL_OR_GAS` aus
`'./heating.ts'`; `HeatingExemption, InfoItem` in den Typimport aus `'../../shared/types.ts'`.

In `noticeKinds` hinter den Codes von PR 13:

```ts
  // Heizung PR 14 (#99, Entwurf 8.8, 8.9, 10.1).
  'heating.info-incomplete': { level: 'warning', title: 'Angaben zur Heizkostenabrechnung unvollständig', rule: 'heating-info', terms: ['billingInfo'] },
  'heating.monthly-info': { level: 'warning', title: 'Monatliche Verbrauchsinformation', rule: 'heating-info', terms: ['billingInfo'] },
  'heating.exemption': { level: 'hint', title: 'Ausnahme von der Heizkostenverordnung', rule: 'heating-exemption', terms: ['heatingCostOrdinance'] },
  'heating.insulation-rule-unknown': { level: 'hint', title: 'Pflichtanteil nach § 7 Abs. 1 Satz 2 ungeklärt', rule: 'heating-own-settlement', terms: ['consumptionCosts'] },
```

- [ ] **Step 4: Ausnahme und Vereinbarung (`server/src/calc.ts`)**

Direkt hinter `const heatingAgreeable = mayAgreeOtherwise(snapshot.units, isDwelling)`:

```ts
  // Heizung PR 14 (Entwurf 8.9): Für eine Anlage mit Ausnahme nach § 11 oder mit wirksamer Vereinbarung
  // nach § 2 nennt Mietfuchs keine Kürzung nach § 12 HeizkostenV. Die Vereinbarung wirkt nur, solange das
  // Haus im Zeitraum die Voraussetzung des § 2 erfüllt (Abweichung 8). Ohne Anlage: null, wie bisher.
  const plantById = new Map((snapshot.heatingPlants ?? []).map((p) => [p.id, p]))
  const suspendedBy = (plantId: string | null | undefined): 'exemption' | 'agreement' | null => {
    const p = plantId ? plantById.get(plantId) : undefined
    if (!p) return null
    if ((p.exemption ?? 'none') !== 'none') return 'exemption'
    if ((p.agreedOtherwise ?? null) !== null && heatingAgreeable) return 'agreement'
    return null
  }
  // § 2 Abs. 7 CO2KostAufG: bei einer Ausnahme nach § 11 keine CO₂-Aufteilung, außer eine Abrechnung der
  // Heiz- und Warmwasserkosten ist vereinbart.
  const co2OffByExemption = (plantId: string): boolean => {
    const p = plantById.get(plantId)
    return p !== undefined && (p.exemption ?? 'none') !== 'none' && p.exemptionBillingAgreed !== true
  }
```

Dann an diesen Stellen (jede mit einem Kommentar „Heizung PR 14: keine Kürzung bei Ausnahme oder
Vereinbarung“):

(a) Schleife `for (const { item, rows } of heatingCuts) {` (Bestand #140): als erste Zeile des Rumpfs
`if (suspendedBy(item.heatingPlantId) !== null) continue`.

(b) Schleife `for (const g of heating.shareOutside) {` (Bestand): als erste Zeile
`if (g.itemIds.every((id) => suspendedBy(items.find((c) => c.id === id)?.heatingPlantId) !== null)) continue`.

(c) Block `heating.flat-rate` (Bestand): in der Bedingung
`items.some((c) => c.category === HEATING_CATEGORY)` ersetzen durch
`items.some((c) => c.category === HEATING_CATEGORY && suspendedBy(c.heatingPlantId) === null)`.

(d) Fernablesbarkeit (PR 4 Task 8): im Aufruf
`remoteReadingVerdict(snapshot.heatingPlants ?? [], …)` die Liste durch
`(snapshot.heatingPlants ?? []).filter((p) => suspendedBy(p.id) === null)` ersetzen; hat das Objekt
Anlagen und sind alle ausgenommen, gibt es weder `remote` noch `retrofit`:

```ts
  const allSuspended = (snapshot.heatingPlants ?? []).length > 0 && (snapshot.heatingPlants ?? []).every((p) => suspendedBy(p.id) !== null)
```

und in beiden Zeilen von PR 4 `heatingBilledItem ?` durch `heatingBilledItem && !allSuspended ?`.

(e) `heating.dhw-not-metered` (PR 6, PR 11): in jeder der Bedingungen, die den Hinweis melden,
`&& suspendedBy(pot.plantId) === null` anhängen.

(f) CO₂-Block (PR 6, PR 7): die Zeile
`const applicable = !etsExempt && (st !== null || heatingSettled) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)`
ersetzen durch
`const applicable = !etsExempt && !co2OffByExemption(pot.plantId) && (st !== null || heatingSettled) && law(co2ApplicableFrom, { period: hPeriod }, lawLog)`;
im Aufruf `co2DeductionsOf(co2Pots, …)` die Töpfe durch `co2Pots.filter((p) => !co2OffByExemption(p.plantId))`
ersetzen.

(g) Hinweisschleife der eigenen Abrechnung (PR 10 Task 9 Step 8): hinter `const notYet = …`

```ts
    const noCut = notYet || suspendedBy(plant.id) !== null
```

und `notYet` in `const list = notYet ? [] : …` sowie in `if (unmeasured.length > 0 && !notYet)` durch
`noCut` ersetzen. Im Text von `heating.no-interim-reading-missed` den Ausdruck
`(list.length > 0 ? … : …)` ersetzen durch:

```ts
            (noCut
              ? 'Eine Kürzung nach der Heizkostenverordnung nennt Mietfuchs hier nicht, weil sie für diese Anlage nicht gilt oder etwas anderes vereinbart ist. '
              : list.length > 0 ? `Bis zu ${cut} % der Heizkosten von ${andList(list)} können gekürzt werden (LG Hamburg, 11 S 202/87); ` : `Bis zu ${cut} % können gekürzt werden (LG Hamburg, 11 S 202/87); `) +
            (noCut ? '' : 'nach AG Schöneberg, 104a C 226/05, ist die Umlage des Verbrauchsanteils angreifbar. ') +
            'Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären.',
```

(Der Satz „nach AG Schöneberg …“ stand in PR 10 im selben String; er zieht hier in die Bedingung.)

- [ ] **Step 5: § 10 und Vorperiode im Block des Plans (`server/src/calc.ts`)**

Im Block des Plans (PR 10 Task 8 Step 7) beim Lesen der Zeilen
`rows.map((r) => ({ period: String(r.period), heatConsumptionPct: …, insulationRule: r.insulationRule ?? null }))`
das Feld `above70Agreed: r.above70Agreed ?? null` ergänzen. Die Grenzprüfung

```ts
      if ([shares.heating, ...(hotWater !== 'none' && shares.water !== null ? [shares.water] : [])].some((v) => v < min || v > max)) {
```

ersetzen durch

```ts
      // § 10 (Heizung PR 14): über dem Höchstsatz nur mit Vereinbarung, nie über 100 %.
      if ([shares.heating, ...(hotWater !== 'none' && shares.water !== null ? [shares.water] : [])].some((v) => v < min || v > 100 || (v > max && !shares.above70Agreed))) {
```

und den Text darin um `Mehr als ${max} % gehen nur mit einer Vereinbarung (§ 10 HeizkostenV). ` vor
„Korrigieren Sie ihn …“ ergänzen. `type SelfPlantPlan` bekommt `prevKey: string`; im Objekt von
`selfPlans.set` `prevKey: prev.key,`. In `selfStatementOf` im Objekt `shares` das Feld
`above70Agreed: sp.shares.above70Agreed` ergänzen.

- [ ] **Step 6: Ausweis nach § 6a (`server/src/calc.ts`, CO₂-Block)**

Vor der Schleife `for (const pot of co2Pots)`:

```ts
  // Informationen nach § 6a (Heizung PR 14, Entwurf 8.8): bei eigener Abrechnung nach Abs. 3 oder 5, bei
  // freien Schlüsseln nur Nr. 2 und 3 (Abweichung 16), nicht beim Messdienst und nicht unter § 11
  // (Abweichung 7). Gilt erst für Zeiträume ab dem 01.12.2021 (`hkv.info.applicable-from`).
  const infoOf = (plantId: string, potItems: readonly SnapshotCostItem[], h: { key: string; from: string; to: string }): HeatingInfoStatement | null => {
    const hPeriod = { from: h.from, to: h.to }
    const p = plantById.get(plantId)
    if (!p || p.method === 'service' || suspendedBy(plantId) === 'exemption') return null
    if (!law(hkvInfoApplicable, { period: hPeriod }, lawLog)) return null
    const sp = selfPlans.get(plantId)
    const rowsOfPlant = (snapshot.heatingPeriodRows ?? []).filter((r) => r.plantId === plantId)
    const own = rowsOfPlant.find((r) => r.period === h.key)
    const prevRow = sp ? rowsOfPlant.find((r) => r.period === sp.prevKey) : undefined
    const full = sp !== undefined && byConsumption(sp.plan)
    const district = full && p.energy === 'districtHeating' ? law(hkvInfoDistrict, { period: hPeriod }, lawLog) : null
    return heatingInfoOf({
      byConsumption: full,
      energy: p.energy,
      districtRequired: district?.scope === 'largeOnly' ? 'maybe' : 'yes',
      row: own ? {
        infoTaxesText: own.infoTaxesText ?? null, infoDistrictGhg: own.infoDistrictGhg ?? null, infoDistrictPef: own.infoDistrictPef ?? null,
        climateFactor: own.climateFactor ?? null, climateFactorPrev: own.climateFactorPrev ?? null, consumerContract: own.consumerContract ?? null,
      } : null,
      prevClimateFactor: prevRow?.climateFactor ?? null,
      meteringCents: potItems.filter((c) => c.heatingPart === 'metering').reduce((a, c) => a + c.amountCents, 0),
      contacts: INFO_CONTACTS,
      contactsChecked: INFO_CONTACTS_CHECKED,
      plan: full && sp ? sp.plan : null,
      prev: full && sp ? sp.prev : null,
      units: { heating: POT_UNIT.heating, water: POT_UNIT.water },
    })
  }
```

(`HeatingInfoStatement` und `SnapshotCostItem` in den Typimport; `pot.period` ist die Heizperiode des
Topfs (`BillingPeriod` mit `key`, `from`, `to`, PR 6).) In der Schleife hinter
`if (selfOf) report.self = selfStatementOf(…)` (PR 10):

```ts
    // Informationen nach § 6a (Heizung PR 14).
    const info = infoOf(pot.plantId, pot.items, pot.period)
    if (info) report.info = info
```

- [ ] **Step 7: Hinweise (`server/src/calc.ts`)**

Direkt hinter der Hinweisschleife der eigenen Abrechnung (PR 10) und dem Block von PR 13:

```ts
  // ---------- Pflichtangaben und Ausnahmen (Heizung PR 14, Entwurf 8.8, 8.9) ----------
  const ITEM_TEXT: Record<InfoItem, string> = {
    '1a': 'bei Fernwärme die Treibhausgasemissionen und der Primärenergiefaktor des Netzes (Nr. 1 a)',
    '1b': 'die erhobenen Steuern, Abgaben und Zölle (Nr. 1 b)',
    '1c': 'die Entgelte für Erfassung, Ablesung und Abrechnung (Nr. 1 c)',
    '2': 'die Kontaktinformationen (Nr. 2)',
    '3': 'beim Verbrauchervertrag die Information zur Streitbeilegung (Nr. 3)',
    '4': 'der Vergleich mit einem Durchschnittsnutzer (Nr. 4)',
    '5': 'der witterungsbereinigte Vergleich mit dem Vorzeitraum (Nr. 5)',
  }
  const EXEMPTION_TEXT = (e: HeatingExemption): string => {
    const v = law(hkvExemptions, { period: lawPeriod }, lawLog)
    switch (e) {
      case 'lowDemand': return `Räume in einem Gebäude mit einem Heizwärmebedarf von weniger als ${v.lowDemandKwhPerM2Year} kWh je m² und Jahr (§ 11 Abs. 1 Nr. 1 Buchst. a HeizkostenV)`
      case 'disproportionate': return `Räume, bei denen Erfassung oder Verteilung nur mit unverhältnismäßig hohen Kosten möglich ist, die sich nicht in der Regel innerhalb von ${v.paybackYears} Jahren durch Einsparungen erwirtschaften lassen (§ 11 Abs. 1 Nr. 1 Buchst. b)`
      case 'pre1981': return `Räume, die vor dem ${fmtDay(v.readyBefore)} bezugsfertig geworden sind und in denen der Nutzer den Wärmeverbrauch nicht beeinflussen kann (§ 11 Abs. 1 Nr. 1 Buchst. c)`
      case 'renewable': return 'Räume in einem Gebäude, das überwiegend mit Wärme aus Wärmerückgewinnung, Solaranlagen, Kraft-Wärme-Kopplung oder Abwärme versorgt wird, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird (§ 11 Abs. 1 Nr. 3)'
      case 'authority': return 'eine Befreiung durch die nach Landesrecht zuständige Stelle (§ 11 Abs. 1 Nr. 5)'
      case 'none': return ''
    }
  }
  for (const pot of co2Pots) {
    const plant = plantById.get(pot.plantId)
    if (!plant) continue
    const hPeriod = { from: pot.period.from, to: pot.period.to }
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${periodLabel(pot.period)}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    const ids = new Set<string>([...pot.items.map((c) => c.id), pot.reliefKey])
    const suspended = suspendedBy(plant.id)
    // § 11 (Abweichung 5, 7): Hinweis mit § 556a BGB und § 2 Abs. 7 CO2KostAufG.
    if (suspended === 'exemption') {
      warn('heating.exemption',
        `${where}: Sie haben angegeben, dass die Heizkostenverordnung für diese Anlage nach § 11 HeizkostenV nicht gilt: ${EXEMPTION_TEXT(plant.exemption ?? 'none')}. ` +
          'Dann gelten ihre Vorschriften zur Erfassung, zur Verteilung und zu den Informationen nicht, und Mietfuchs nennt keine Kürzung nach § 12 HeizkostenV. ' +
          'Verteilt wird nach dem Mietvertrag; ist dort nichts anderes vereinbart, nach der Wohnfläche, und Kosten mit erfasstem Verbrauch nach einem Maßstab, der dem Verbrauch Rechnung trägt (§ 556a Abs. 1 BGB). Mietfuchs verteilt, wie Sie die Positionen erfasst haben. Bewahren Sie den Nachweis für die Ausnahme auf. ' +
          (plant.exemptionBillingAgreed === true
            ? 'Weil Sie mit den Mietern eine Abrechnung der Heiz- und Warmwasserkosten vereinbart haben, teilt Mietfuchs die CO₂-Kosten nach dem CO2KostAufG auf (§ 2 Abs. 7 CO2KostAufG).'
            : 'Die CO₂-Kosten werden in diesem Fall nicht nach dem CO2KostAufG aufgeteilt (§ 2 Abs. 7 CO2KostAufG), außer Sie haben mit den Mietern eine Abrechnung der Heiz- und Warmwasserkosten vereinbart; dann geben Sie das unter Stammdaten bei der Heizung an.'),
        subject)
    }
    if (suspended !== null) continue
    // Monatliche Verbrauchsinformation (§ 6a Abs. 1, 2; Entwurf 8.8): fernablesbar oder unbekannt. Das
    // Register wird erst gefragt, wenn ein Gerät in Frage kommt; so steht der Wert nur dann im Rechtsstand.
    const spOfPlant = selfPlans.get(plant.id)
    const servedIds = new Set(spOfPlant ? spOfPlant.plan.units.map((u) => u.unit.id) : [])
    const remote = plant.monthlyInfoElsewhere !== true && (spOfPlant
      ? snapshot.meters.some((m) => m.unitId !== null && servedIds.has(m.unitId) && m.remoteReadable === true)
      : (plant.devicesRemote ?? 'unknown') !== 'none')
    const monthly = remote ? law(hkvMonthlyInfo, { period: hPeriod }, lawLog) : null
    if (monthly && monthly.coverage !== 'none') {
      const cut = law(hkvCutInformation, { period: hPeriod }, lawLog)
      const unknown = !spOfPlant && (plant.devicesRemote ?? 'unknown') === 'unknown'
      warn('heating.monthly-info',
        `${where}: ${unknown ? 'Ob Zähler und Heizkostenverteiler fernablesbar sind, ist an der Anlage nicht angegeben. ' : ''}Sind sie fernablesbar, stehen den Mietern seit dem ${fmtDay(monthly.validFrom ?? '')} monatliche Verbrauchsinformationen zu: der Verbrauch des letzten Monats in Kilowattstunden, der Vergleich mit dem Vormonat und dem Vorjahresmonat und mit einem Durchschnittsnutzer (§ 6a Abs. 1 und 2 HeizkostenV). ` +
          `Fehlen sie, darf jeder Mieter seinen Anteil an den Heizkosten um bis zu ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${cutsOn(ids, cut)}. ` +
          'Mietfuchs erstellt diese Informationen noch nicht. Bekommen Ihre Mieter sie anders, etwa über das Portal des Messdienstes, bestätigen Sie das unter Stammdaten bei der Heizung.',
        subject)
    }
    // Angaben nach § 6a Abs. 3 (Entwurf 8.8, 15.1 Nr. 14): je fehlende Nummer 3 % je Mieter.
    const info = infoOf(plant.id, pot.items, pot.period)
    if (info && info.scope === 'full') {
      const cut = law(hkvCutInformation, { period: hPeriod }, lawLog)
      const firsts = info.users.filter((u) => u.firstPeriod)
      const parts: string[] = []
      if (info.missing.length > 0) {
        parts.push(`Es fehlen: ${andList(info.missing.map((x) => ITEM_TEXT[x]))}. Fehlt eine Angabe ganz oder teilweise, darf jeder Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${cutsOn(ids, cut)}.`)
      }
      if (info.uncertain.includes('1a')) parts.push(`Bei einem Fernwärmesystem ab ${law(hkvInfoDistrict, { period: hPeriod }, lawLog).thresholdMw} MW gehören Treibhausgasemissionen und Primärenergiefaktor schon in diese Abrechnung; dann bis zu ${cut} %.`)
      if (info.uncertain.includes('3')) parts.push(`Ist Ihr Mietvertrag ein Verbrauchervertrag (§ 310 Abs. 3 BGB: Sie vermieten als Unternehmer), gehört die Information zur Streitbeilegung dazu; geben Sie auf der Seite Heizkosten an, ob das zutrifft. Sonst bis zu ${cut} %.`)
      if (firsts.length > 0) {
        const list = firsts.flatMap((u) => {
          const c = cutOf(u.tenancyId, ids, cut)
          return c === null ? [] : [`${nameOf(u.tenancyId)} ${fmtCents(c)}`]
        })
        parts.push(`Für ${andList(firsts.map((u) => nameOf(u.tenancyId)))} gibt es keinen Verbrauch im vorhergehenden Abrechnungszeitraum, mit dem der Vergleich nach Nr. 5 möglich wäre. Eine Ausnahme dafür nennt die Verordnung nicht; Mietfuchs nennt deshalb bis zu ${cut} % (Auslegung)${list.length > 0 ? `: ${andList(list)}` : ''}.`)
      }
      if (parts.length > 0) {
        warn('heating.info-incomplete',
          `${where}: Zur Heizkostenabrechnung gehören die Informationen nach § 6a Abs. 3 HeizkostenV. ${parts.join(' ')} Tragen Sie die Angaben auf der Seite Heizkosten in der Karte „Angaben zur Abrechnung“ ein.`,
          subject)
      }
    }
    // § 7 Abs. 1 Satz 2 ungeklärt (Abweichung 10): nur bei Öl und Gas und wenn der Anteil nicht schon dem
    // Pflichtanteil entspricht.
    const sp = spOfPlant
    if (sp?.shares && OIL_OR_GAS.includes(plant.energy) && (sp.shares.insulationRule ?? 'unknown') === 'unknown') {
      const forced = law(hkvConsumptionShareForced, { period: hPeriod }, lawLog)
      if (sp.shares.heating !== forced) {
        warn('heating.insulation-rule-unknown',
          `${where}: Ob bei der Heizung ${forced} % nach Verbrauch vorgeschrieben sind, ist nicht angegeben. Das ist der Fall in Gebäuden, die das Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994 nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt werden und in denen die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt sind (§ 7 Abs. 1 Satz 2 HeizkostenV). ` +
            'Wurde das Haus vor 1995 gebaut und seither nicht mindestens auf diesen Stand gedämmt, trifft die erste Bedingung meist zu. Beantworten Sie die Frage auf der Seite Heizkosten; einen anderen Anteil tragen Sie für die nächste Heizperiode ein (§ 6 Abs. 4 HeizkostenV).',
          subject)
      }
    }
  }
```

(`cutsOn` stammt aus dem CO₂-Block von PR 6 und gibt die Beträge je Mieter als „, hier: …“ zurück;
`cutOf` und `nameOf` aus PR 10. Die Fernablesbarkeit je Zähler (`remoteReadable`) liest `SnapshotMeter`
seit PR 4. `periodLabel` ist aus `'../../shared/period.ts'` importiert.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-pflichtangaben.test.ts test/calc-heizkosten.test.ts test/calc-schaetzung.test.ts test/calc-co2.test.ts test/calc-heizanlage.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts test/calc.test.ts test/settlement-golden.test.ts test/calc-wortlaut.test.ts && npm run typecheck`
Expected: PASS (calc-pflichtangaben.test.ts: 7 Tests).

- [ ] **Step 9: Golden nachziehen (`server/test/heating-golden.test.ts`, Fixtures F12–F17)**

Run: `npm --prefix server test -- test/heating-golden.test.ts`
Expected: FAIL nur in `warnings`/`notices` von F16 und F17 (`heating.info-incomplete`) und bei F12 bis F15,
deren Anlage `devices_remote` nicht `none` hat (`heating.monthly-info`). In jedem dieser Fixtures die
Erwartung um genau diese Hinweise ergänzen und im README den Absatz anhängen: „Ab Heizung PR 14 steht hier
`heating.info-incomplete` bzw. `heating.monthly-info` (Entwurf 8.8, R-A17); keine Zahl ändert sich.“
Ändert sich eine Zahl oder ein anderer Hinweis, ist das ein Befund. F01–F11 bleiben wortgleich (ohne
Anlage gibt es keinen der neuen Hinweise).

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calc.ts server/test/calc-pflichtangaben.test.ts server/test/heating-golden.test.ts server/test/fixtures
git commit -m "Pflichtangaben in der Abrechnung: § 6a je Nummer mit 3 %, monatliche Information, § 11, § 2, § 10

Ausnahme und wirksame Vereinbarung nennen an keiner Stelle eine Kürzung nach § 12; unter § 11 keine
CO₂-Aufteilung ohne vereinbarte Abrechnung (§ 2 Abs. 7 CO2KostAufG).

Refs #99"
```

---

### Task 6: Oberfläche: Stammdaten der Heizung, Karte „Angaben zur Abrechnung“, Anteil, Druckblock

**Files:**
- Create: `client/src/heatingRulesForm.ts`, `client/src/heatingRulesForm.test.ts`, `client/src/heatingInfoForm.ts`, `client/src/heatingInfoForm.test.ts`, `client/src/heatingInfoView.ts`, `client/src/heatingInfoView.test.ts`, `client/src/components/HeatingRulesFields.tsx`, `client/src/components/HeatingRulesFields.test.tsx`, `client/src/components/HeatingInfoCard.tsx`, `client/src/components/HeatingInfoBlock.tsx`
- Modify: `client/src/components/HeatingCard.tsx`, `client/src/components/SelfHeatingCards.tsx`, `client/src/components/HeatingSelfSetup.tsx`, `client/src/heatingSelfForm.ts`, `client/src/heatingSelfForm.test.ts`, `client/src/components/SelfHeatingBlock.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/index.css`

**Interfaces:**
- Produces:
  - `heatingRulesForm.ts`: `EXEMPTION_OPTIONS`, `AGREED_OPTIONS`, `type Answer = 'yes' | 'no' | 'unknown' | ''`, `ANSWER_OPTIONS`, `INSULATION_QUESTIONS`, `insulationFrom(old: Answer, pipes: Answer): InsulationRule | ''`
  - `heatingInfoForm.ts`: `type InfoForm`, `infoToForm(info)`, `infoBody(form)`, `dwdHint(postalCode, from, to)`, `CONTRACT_OPTIONS`
  - `heatingInfoView.ts`: `infoLines(info)`, `comparisonOf(info, tenancyId)`, `barWidths(values)`
  - `HeatingRulesFields({ plant, onSaved })`, `HeatingInfoCard({ plant, view, onChanged })`, `HeatingInfoBlock({ info, tenancyId, plantName })`
  - `SelfSetupForm.above70Agreed: boolean`, `SelfSetupBody.above70Agreed: boolean`

- [ ] **Step 1: Write the failing tests**

`client/src/heatingRulesForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AGREED_OPTIONS, EXEMPTION_OPTIONS, insulationFrom } from './heatingRulesForm'

describe('§ 7 Abs. 1 Satz 2 in zwei Fragen (Entwurf 11.2 Schritt 7, A10)', () => {
  it('beides ja → trifft zu; eines nein → trifft nicht zu; sonst weiß nicht', () => {
    expect(insulationFrom('yes', 'yes')).toBe('applies')
    expect(insulationFrom('no', 'yes')).toBe('notApplies')
    expect(insulationFrom('yes', 'no')).toBe('notApplies')
    expect(insulationFrom('unknown', 'yes')).toBe('unknown')
    expect(insulationFrom('', 'yes')).toBe('')
  })
})

describe('§ 11 und § 2 (Entwurf 8.9)', () => {
  it('Ausnahmen mit den Zahlen des Registers, ohne Heime und Hausanlagen (Abweichung 6)', () => {
    expect(EXEMPTION_OPTIONS.map((o) => o.value)).toEqual(['none', 'lowDemand', 'disproportionate', 'pre1981', 'renewable', 'authority'])
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'lowDemand')?.label).toMatch(/weniger als 15 kWh je m² und Jahr/)
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'pre1981')?.label).toMatch(/vor dem 01\.07\.1981 bezugsfertig/)
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'disproportionate')?.label).toMatch(/10 Jahren/)
  })
  it('Vereinbarungen nach § 2', () => {
    expect(AGREED_OPTIONS.map((o) => o.value)).toEqual(['', 'area', 'fixedPercent', 'consumption'])
  })
})
```

`client/src/heatingInfoForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dwdHint, infoBody, infoToForm } from './heatingInfoForm'

const info = { infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: null, consumerContract: 'none', postalCode: '79100' }

describe('Angaben nach § 6a (Heizung PR 14)', () => {
  it('Formular aus der Ansicht und zurück; Komma als Dezimalzeichen', () => {
    const f = infoToForm(info)
    expect([f.climateFactor, f.contract]).toEqual(['1,08', 'none'])
    expect(infoBody({ ...f, climateFactorPrev: '1,15', taxes: 'Energiesteuer 312,00 €' })).toEqual({ body: {
      infoTaxesText: 'Energiesteuer 312,00 €', infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15, consumerContract: 'none',
    } })
  })
  it('Verbrauchervertrag: Text Pflicht, wenn „ja“', () => {
    expect(infoBody({ ...infoToForm(info), contract: 'yes', disputeText: ' ' })).toEqual({ error: expect.stringMatching(/Streitbeilegung/) })
    expect(infoBody({ ...infoToForm(info), contract: '' })).toMatchObject({ body: { consumerContract: null } })
  })
  it('Klimafaktor größer als 0', () => {
    expect(infoBody({ ...infoToForm(info), climateFactor: '0' })).toEqual({ error: expect.stringMatching(/Klimafaktor.*größer als 0/) })
  })
  it('Hinweis zum DWD mit Postleitzahl und Zeitraum', () => {
    expect(dwdHint('79100', '2025-01-01', '2025-12-31')).toBe('Klimafaktor des Deutschen Wetterdienstes für die Postleitzahl 79100 und den Zeitraum 01.01.2025 bis 31.12.2025: dwd.de, „Klimafaktoren“.')
    expect(dwdHint(null, '2025-01-01', '2025-12-31')).toMatch(/Postleitzahl Ihres Objekts/)
  })
})
```

`client/src/heatingInfoView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { barWidths, comparisonOf, infoLines } from './heatingInfoView'
import { fmtEuro } from './api'
import type { HeatingInfoStatement } from './types'

const info: HeatingInfoStatement = {
  scope: 'full', energy: 'gas', district: null, taxesText: 'Energiesteuer 312,00 €', meteringCents: 18000,
  contacts: [{ name: 'Deutsche Energie-Agentur (dena)', url: 'https://www.dena.de', what: 'Energieagentur' }], contactsChecked: '2026-10-05',
  dispute: { kind: 'none' }, climate: { factor: 1.08, factorPrev: 1.15 }, units: { heating: 'kWh', water: 'm³' },
  users: [{ tenancyId: 'A', label: 'Mieter A', days: 365, prevDays: 366, heating: { now: 12000, perM2: 200, houseAvgPerM2: 200, prev: 1000, nowAdjusted: 12960, prevAdjusted: 1150 }, water: null, firstPeriod: false }],
  missing: [], uncertain: [],
}

describe('Druckblock § 6a (Heizung PR 14)', () => {
  it('Nr. 1 bis 3 als Zeilen', () => {
    expect(infoLines(info)).toEqual([
      'Energieträger: Erdgas 100 %',
      'Steuern, Abgaben und Zölle laut Rechnung: Energiesteuer 312,00 €',
      `Entgelte für Erfassungsgeräte, Eichung, Ablesung und Abrechnung: ${fmtEuro(18000)}`,
      'Kontakt für Informationen zum Energiesparen (Stand 05.10.2026): Deutsche Energie-Agentur (dena), https://www.dena.de – Energieagentur',
    ])
  })
  it('Vergleich je Mieter: Hausdurchschnitt je m² (so benannt) und witterungsbereinigt', () => {
    const c = comparisonOf(info, 'A') ?? expect.unreachable()
    expect(c.lines).toEqual([
      'Ihr Verbrauch Heizung: 200 kWh je m²; Durchschnitt aller Wohnungen dieses Hauses: 200 kWh je m² (Vergleichsmaßstab nach DIN 94680 noch offen)',
      'Heizung witterungsbereinigt (Klimafaktor des DWD): dieser Zeitraum 12.960 kWh, vorhergehender Zeitraum 1.150 kWh',
    ])
    const [jetzt, vorher] = barWidths([12960, 1150])
    expect(jetzt).toBe(100)
    expect(vorher).toBeCloseTo((1150 / 12960) * 100, 10)
  })
})
```

`client/src/components/HeatingRulesFields.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import HeatingRulesFields from './HeatingRulesFields'
import type { HeatingPlant } from '../types'

afterEach(cleanup)

test('die Auswahlfelder zeigen die gespeicherten Werte', () => {
  const plant = { id: 'hp', exemption: 'pre1981', exemptionBillingAgreed: true, agreedOtherwise: 'fixedPercent', monthlyInfoElsewhere: true } as HeatingPlant
  render(<HeatingRulesFields plant={plant} onSaved={() => {}} />)
  expect((screen.getByLabelText(/Ausnahme nach § 11/) as HTMLSelectElement).value).toBe('pre1981')
  expect((screen.getByLabelText(/Vereinbarung nach § 2/) as HTMLSelectElement).value).toBe('fixedPercent')
  expect((screen.getByLabelText(/Abrechnung der Heiz- und Warmwasserkosten vereinbart/) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(true)
})
```

In `client/src/heatingSelfForm.test.ts` (PR 10) die Erwartung
`expect(selfSetupBody(filled({ share: '80' }), 'gas')).toEqual({ error: expect.stringMatching(/§ 10 HeizkostenV.*späteren Version/) })`
ersetzen durch:

```ts
    expect(selfSetupBody(filled({ share: '80' }), 'gas')).toEqual({ error: expect.stringMatching(/§ 10 HeizkostenV.*vereinbart/) })
    const vereinbart = selfSetupBody(filled({ share: '80', above70Agreed: true }), 'gas')
    expect('body' in vereinbart && [vereinbart.body.heatConsumptionPct, vereinbart.body.above70Agreed]).toEqual([80, true])
    expect(selfSetupBody(filled({ share: '101', above70Agreed: true }), 'gas')).toEqual({ error: expect.stringMatching(/höchstens 100 %/) })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingRulesForm heatingInfoForm heatingInfoView HeatingRulesFields heatingSelfForm`
Expected: FAIL; die Module fehlen.

- [ ] **Step 3: Logik (`client/src/heatingRulesForm.ts`)**

```ts
// Stammdaten der Heizung zu § 11, § 2 und § 7 Abs. 1 Satz 2 (Heizung PR 14, Entwurf 8.9, 11.2), ohne DOM
// prüfbar. Die Zahlen des § 11 kommen aus dem Register.
import type { AgreedOtherwise, HeatingExemption, InsulationRule } from './types'
import { hkvExemptions } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

const EX = valueAt(hkvExemptions, LAW_AS_OF)
export const EXEMPTION_OPTIONS: { value: HeatingExemption; label: string }[] = [
  { value: 'none', label: 'Keine Ausnahme: die Heizkostenverordnung gilt' },
  { value: 'lowDemand', label: `Gebäude mit einem Heizwärmebedarf von weniger als ${EX.lowDemandKwhPerM2Year} kWh je m² und Jahr (§ 11 Abs. 1 Nr. 1 a)` },
  { value: 'disproportionate', label: `Erfassung nur mit Kosten möglich, die sich nicht in der Regel innerhalb von ${EX.paybackYears} Jahren durch Einsparungen erwirtschaften lassen (§ 11 Abs. 1 Nr. 1 b)` },
  { value: 'pre1981', label: `Räume, die vor dem ${germanDate(EX.readyBefore)} bezugsfertig wurden und in denen der Mieter den Verbrauch nicht beeinflussen kann (§ 11 Abs. 1 Nr. 1 c)` },
  { value: 'renewable', label: 'Überwiegend Wärme aus Wärmerückgewinnung, Solaranlagen, Kraft-Wärme-Kopplung oder Abwärme, und der Verbrauch des Gebäudes wird nicht erfasst (§ 11 Abs. 1 Nr. 3)' },
  { value: 'authority', label: 'Befreiung durch die zuständige Stelle des Landes (§ 11 Abs. 1 Nr. 5)' },
]
export const AGREED_OPTIONS: { value: AgreedOtherwise | ''; label: string }[] = [
  { value: '', label: 'Keine abweichende Vereinbarung: die Heizkostenverordnung gilt' },
  { value: 'area', label: 'Vereinbart: nach Wohnfläche' },
  { value: 'fixedPercent', label: 'Vereinbart: feste Anteile' },
  { value: 'consumption', label: 'Vereinbart: nach Verbrauch, abweichend von der Verordnung' },
]

export type Answer = 'yes' | 'no' | 'unknown' | ''
export const ANSWER_OPTIONS: { value: Answer; label: string }[] = [
  { value: '', label: 'Bitte wählen' }, { value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }, { value: 'unknown', label: 'Weiß ich nicht' },
]
// Die Frage nach § 7 Abs. 1 Satz 2 in zwei Teilen (Entwurf 11.2 Schritt 7, A10, D-H5). Die erste steht für
// „erfüllt das Anforderungsniveau der Wärmeschutzverordnung vom 16.08.1994 nicht“.
export const INSULATION_QUESTIONS = {
  old: 'Wurde das Haus vor 1995 gebaut und seither nicht mindestens auf den Stand von 1995 gedämmt?',
  pipes: 'Sind die frei liegenden Heizungsrohre überwiegend gedämmt?',
}
export function insulationFrom(old: Answer, pipes: Answer): InsulationRule | '' {
  if (old === 'no' || pipes === 'no') return 'notApplies'
  if (old === 'yes' && pipes === 'yes') return 'applies'
  if (old === '' || pipes === '') return ''
  return 'unknown'
}
```

- [ ] **Step 4: Logik (`client/src/heatingInfoForm.ts`, `client/src/heatingInfoView.ts`)**

`client/src/heatingInfoForm.ts`:

```ts
// Karte „Angaben zur Abrechnung (§ 6a)“ der Seite Heizkosten (Heizung PR 14), ohne DOM prüfbar.
import type { HeatingInfoInputs } from './types'
import { CONSUMER_CONTRACT_NONE } from '../../shared/heatingInfo.ts'
import { germanDate } from '../../shared/law/register.ts'

export type InfoForm = { taxes: string; ghg: string; pef: string; climateFactor: string; climateFactorPrev: string; contract: 'none' | 'yes' | ''; disputeText: string }
export const CONTRACT_OPTIONS: { value: InfoForm['contract']; label: string }[] = [
  { value: '', label: 'Bitte wählen' },
  { value: 'none', label: 'Nein, ich vermiete nicht als Unternehmer (kein Verbrauchervertrag)' },
  { value: 'yes', label: 'Ja, ich vermiete als Unternehmer (Verbrauchervertrag nach § 310 Abs. 3 BGB)' },
]
const text = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','))
const num = (t: string): number | null | 'bad' => {
  if (t.trim() === '') return null
  const n = Number(t.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 'bad'
}

export function infoToForm(i: HeatingInfoInputs): InfoForm {
  const c = i.consumerContract
  return {
    taxes: i.infoTaxesText ?? '', ghg: text(i.infoDistrictGhg), pef: text(i.infoDistrictPef),
    climateFactor: text(i.climateFactor), climateFactorPrev: text(i.climateFactorPrev),
    contract: c === null ? '' : c === CONSUMER_CONTRACT_NONE ? 'none' : 'yes', disputeText: c !== null && c !== CONSUMER_CONTRACT_NONE ? c : '',
  }
}

export function infoBody(f: InfoForm): { body: Omit<HeatingInfoInputs, 'postalCode'> } | { error: string } {
  const factor = num(f.climateFactor)
  const prev = num(f.climateFactorPrev)
  if (factor === 'bad' || prev === 'bad' || (factor !== null && factor <= 0) || (prev !== null && prev <= 0)) return { error: 'Der Klimafaktor ist eine Zahl größer als 0.' }
  const ghg = num(f.ghg)
  const pef = num(f.pef)
  if (ghg === 'bad' || pef === 'bad' || (ghg !== null && ghg < 0) || (pef !== null && pef < 0)) return { error: 'Treibhausgasemissionen und Primärenergiefaktor sind Zahlen ab 0.' }
  if (f.contract === 'yes' && f.disputeText.trim() === '') return { error: 'Bei einem Verbrauchervertrag tragen Sie die Information zur Streitbeilegung ein (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV).' }
  return { body: {
    infoTaxesText: f.taxes.trim() === '' ? null : f.taxes.trim(), infoDistrictGhg: ghg, infoDistrictPef: pef, climateFactor: factor, climateFactorPrev: prev,
    consumerContract: f.contract === '' ? null : f.contract === 'none' ? CONSUMER_CONTRACT_NONE : f.disputeText.trim(),
  } }
}

export function dwdHint(postalCode: string | null, from: string, to: string): string {
  return postalCode
    ? `Klimafaktor des Deutschen Wetterdienstes für die Postleitzahl ${postalCode} und den Zeitraum ${germanDate(from)} bis ${germanDate(to)}: dwd.de, „Klimafaktoren“.`
    : `Klimafaktor des Deutschen Wetterdienstes für die Postleitzahl Ihres Objekts und den Zeitraum ${germanDate(from)} bis ${germanDate(to)}: dwd.de, „Klimafaktoren“. Tragen Sie die Adresse des Objekts mit Postleitzahl ein, dann steht sie hier.`
}
```

`client/src/heatingInfoView.ts`:

```ts
// Druckblock der Informationen nach § 6a (Heizung PR 14): Sätze und Balken, ohne DOM prüfbar.
import type { HeatingEnergy, HeatingInfoStatement } from './types'
import { fmtEuro } from './api'
import { germanDate } from '../../shared/law/register.ts'

const ENERGY_TEXT: Record<HeatingEnergy, string> = {
  gas: 'Erdgas', oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Holzpellets', wood: 'Holz', districtHeating: 'Fernwärme', heatPump: 'Strom für die Wärmepumpe', electric: 'Strom', coal: 'Kohle', other: 'sonstiger Energieträger',
}
const n = (v: number): string => v.toLocaleString('de-DE', { maximumFractionDigits: 2 })

export function infoLines(info: HeatingInfoStatement): string[] {
  const lines: string[] = []
  if (info.scope === 'full') {
    lines.push(`Energieträger: ${ENERGY_TEXT[info.energy]} 100 %`)
    if (info.district) lines.push(`Fernwärme: Treibhausgasemissionen ${info.district.ghg === null ? 'nicht angegeben' : `${n(info.district.ghg)} g CO₂-Äquivalent je kWh`}, Primärenergiefaktor ${info.district.pef === null ? 'nicht angegeben' : n(info.district.pef)} (laut Versorger)`)
    lines.push(`Steuern, Abgaben und Zölle laut Rechnung: ${info.taxesText ?? 'nicht angegeben'}`)
    lines.push(`Entgelte für Erfassungsgeräte, Eichung, Ablesung und Abrechnung: ${fmtEuro(info.meteringCents)}`)
  }
  for (const c of info.contacts) lines.push(`Kontakt für Informationen zum Energiesparen (Stand ${germanDate(info.contactsChecked)}): ${c.name}, ${c.url} – ${c.what}`)
  if (info.dispute.kind === 'text') lines.push(`Streitbeilegung: ${info.dispute.text}`)
  return lines
}

export function comparisonOf(info: HeatingInfoStatement, tenancyId: string): { lines: string[]; bars: { label: string; values: [number, number] }[] } | null {
  const u = info.users.find((x) => x.tenancyId === tenancyId)
  if (!u) return null
  const lines: string[] = []
  const bars: { label: string; values: [number, number] }[] = []
  const h = u.heating
  if (h && h.perM2 !== null && h.houseAvgPerM2 !== null) {
    lines.push(`Ihr Verbrauch Heizung: ${n(h.perM2)} ${info.units.heating} je m²; Durchschnitt aller Wohnungen dieses Hauses: ${n(h.houseAvgPerM2)} ${info.units.heating} je m² (Vergleichsmaßstab nach DIN 94680 noch offen)`)
  }
  if (h && h.nowAdjusted !== null && h.prevAdjusted !== null) {
    lines.push(`Heizung witterungsbereinigt (Klimafaktor des DWD): dieser Zeitraum ${n(h.nowAdjusted)} ${info.units.heating}, vorhergehender Zeitraum ${n(h.prevAdjusted)} ${info.units.heating}`)
    bars.push({ label: 'Heizung, witterungsbereinigt', values: [h.nowAdjusted, h.prevAdjusted] })
  }
  const w = u.water
  if (w && w.now !== null && w.prev !== null) {
    lines.push(`Warmwasser: dieser Zeitraum ${n(w.now)} ${info.units.water}, vorhergehender Zeitraum ${n(w.prev)} ${info.units.water}`)
    bars.push({ label: 'Warmwasser', values: [w.now, w.prev] })
  }
  if (u.firstPeriod) lines.push('Für den vorhergehenden Zeitraum liegt kein Verbrauch für Sie vor.')
  return { lines, bars }
}

// Breiten in Prozent des größten Werts, für die Balken (§ 6a Abs. 3 Satz 1 Nr. 5: „in grafischer Form“).
export function barWidths(values: readonly number[]): number[] {
  const max = Math.max(...values, 0)
  return values.map((v) => (max > 0 ? (v / max) * 100 : 0))
}
```

(„Vergleichsmaßstab nach DIN 94680 noch offen“ ist die Marke ⟨Norm offen: DIN 94680⟩ in Worten für den
Mieter.)

- [ ] **Step 5: Komponenten**

`client/src/components/HeatingRulesFields.tsx`:

```tsx
import { useState } from 'react'
import type { AgreedOtherwise, HeatingExemption, HeatingPlant } from '../types'
import { api, errorText } from '../api'
import Term from './Term'
import { AGREED_OPTIONS, EXEMPTION_OPTIONS } from '../heatingRulesForm'

// Stammdaten der Heizung (Heizung PR 14, Entwurf 8.8, 8.9): Ausnahme nach § 11, Vereinbarung nach § 2,
// monatliche Verbrauchsinformation. Jede Änderung geht sofort an den Server.
export default function HeatingRulesFields({ plant, onSaved }: { plant: HeatingPlant; onSaved: (p: HeatingPlant) => void }) {
  const [error, setError] = useState('')
  async function save(body: Partial<Pick<HeatingPlant, 'exemption' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere'>>) {
    try {
      const p = await api<HeatingPlant>(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify(body) })
      setError('')
      onSaved(p)
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <fieldset>
      <legend><Term id="heatingCostOrdinance">Ausnahmen und Vereinbarungen</Term></legend>
      {error && <div className="error">{error}</div>}
      <label className="field grow">Ausnahme nach § 11 HeizkostenV
        <select value={plant.exemption} onChange={(e) => save({ exemption: e.target.value as HeatingExemption })}>
          {EXEMPTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {plant.exemption !== 'none' && (
        <label className="check">
          <input type="checkbox" checked={plant.exemptionBillingAgreed === true} onChange={(e) => save({ exemptionBillingAgreed: e.target.checked })} />
          Mit den Mietern ist eine Abrechnung der Heiz- und Warmwasserkosten vereinbart (§ 2 Abs. 7 CO2KostAufG: dann werden die CO₂-Kosten aufgeteilt)
        </label>
      )}
      <label className="field grow">Vereinbarung nach § 2 HeizkostenV (nur im Haus mit höchstens zwei Wohnungen, eine davon selbst bewohnt)
        <select value={plant.agreedOtherwise ?? ''} onChange={(e) => save({ agreedOtherwise: e.target.value === '' ? null : (e.target.value as AgreedOtherwise) })}>
          {AGREED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={plant.monthlyInfoElsewhere} onChange={(e) => save({ monthlyInfoElsewhere: e.target.checked })} />
        Die Mieter bekommen die monatliche Verbrauchsinformation anders, etwa über das Portal des Messdienstes (§ 6a Abs. 1 HeizkostenV)
      </label>
    </fieldset>
  )
}
```

In `client/src/components/HeatingCard.tsx` (PR 4) unterhalb der Angaben zur Fernablesbarkeit, nur für eine
gespeicherte Anlage: `{plant && <HeatingRulesFields plant={plant} onSaved={onSaved} />}` (Import; `onSaved`
ist der Rückruf, mit dem HeatingCard nach dem Speichern neu lädt; heißt er anders, dessen Name).

`client/src/components/HeatingInfoCard.tsx`:

```tsx
import { useState } from 'react'
import type { HeatingPeriodView, HeatingPlant } from '../types'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { CONTRACT_OPTIONS, dwdHint, infoBody, infoToForm, type InfoForm } from '../heatingInfoForm'

// Karte „Angaben zur Abrechnung (§ 6a)“ (Heizung PR 14): was Mietfuchs nicht selbst kennt.
export default function HeatingInfoCard({ plant, view, onChanged }: { plant: HeatingPlant; view: HeatingPeriodView; onChanged: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<InfoForm>(() => infoToForm(view.info))
  const [error, setError] = useState('')
  const self = plant.method === 'self'
  async function save() {
    const r = infoBody(form)
    if ('error' in r) return setError(r.error)
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/info`, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('Angaben gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="card no-print">
      <h3><Term id="billingInfo">Angaben zur Abrechnung (§ 6a)</Term> · {view.label}</h3>
      {error && <div className="error">{error}</div>}
      {self && (
        <>
          <label className="field grow">Steuern, Abgaben und Zölle laut Rechnung des Versorgers<input value={form.taxes} onChange={(e) => setForm({ ...form, taxes: e.target.value })} /></label>
          {plant.energy === 'districtHeating' && (
            <div className="row">
              <label className="field">Treibhausgasemissionen laut Versorger (g CO₂-Äquivalent je kWh)<input inputMode="decimal" value={form.ghg} onChange={(e) => setForm({ ...form, ghg: e.target.value })} /></label>
              <label className="field">Primärenergiefaktor des Netzes<input inputMode="decimal" value={form.pef} onChange={(e) => setForm({ ...form, pef: e.target.value })} /></label>
            </div>
          )}
          <p className="muted"><Term id="climateFactor">{dwdHint(view.info.postalCode, view.from, view.to)}</Term></p>
          <div className="row">
            <label className="field">Klimafaktor dieser Heizperiode<input inputMode="decimal" value={form.climateFactor} onChange={(e) => setForm({ ...form, climateFactor: e.target.value })} /></label>
            <label className="field">Klimafaktor der vorigen Heizperiode<input inputMode="decimal" value={form.climateFactorPrev} onChange={(e) => setForm({ ...form, climateFactorPrev: e.target.value })} /></label>
          </div>
        </>
      )}
      <label className="field grow">Vermieten Sie als Unternehmer?
        <select value={form.contract} onChange={(e) => setForm({ ...form, contract: e.target.value as InfoForm['contract'] })}>
          {CONTRACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {form.contract === 'yes' && (
        <label className="field grow">Information zur Streitbeilegung nach dem Verbraucherstreitbeilegungsgesetz (§§ 36, 37 VSBG)<input value={form.disputeText} onChange={(e) => setForm({ ...form, disputeText: e.target.value })} /></label>
      )}
      <button className="btn secondary" onClick={save}>Speichern</button>
    </div>
  )
}
```

`client/src/components/HeatingInfoBlock.tsx`:

```tsx
import type { HeatingInfoStatement } from '../types'
import { barWidths, comparisonOf, infoLines } from '../heatingInfoView'

// Druckblock „Informationen nach § 6a HeizkostenV“ je Mieter (Heizung PR 14, Entwurf 8.8).
export default function HeatingInfoBlock({ info, tenancyId, plantName }: { info: HeatingInfoStatement; tenancyId: string; plantName: string }) {
  const c = comparisonOf(info, tenancyId)
  return (
    <div className="heating-info-block">
      <h4>Informationen nach § 6a HeizkostenV{plantName ? ` · ${plantName}` : ''}</h4>
      {infoLines(info).map((l) => <p key={l}>{l}</p>)}
      {c && c.lines.map((l) => <p key={l}>{l}</p>)}
      {c && c.bars.map((b) => {
        const [now, prev] = barWidths(b.values)
        return (
          <div key={b.label} className="info-bars" aria-label={b.label}>
            <div className="info-bar-row"><span>{b.label}, dieser Zeitraum</span><div className="info-bar" style={{ width: `${now}%` }} /></div>
            <div className="info-bar-row"><span>{b.label}, vorhergehender Zeitraum</span><div className="info-bar prev" style={{ width: `${prev}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}
```

`client/src/index.css`: `.info-bars { margin: .5rem 0 } .info-bar-row { display: grid; grid-template-columns: 16rem 1fr; align-items: center; gap: .5rem } .info-bar { height: .8rem; background: var(--accent) } .info-bar.prev { background: var(--muted) }` (mit `print-color-adjust: exact`, damit die Balken gedruckt werden).

`client/src/pages/Abrechnung.tsx` beim Mieter unter dem Druckblock der eigenen Abrechnung (PR 10):

```tsx
          {(settlement.heating ?? [])
            .filter((h): h is HeatingStatement & { info: HeatingInfoStatement } => h.info !== undefined)
            .map((h) => <HeatingInfoBlock key={`info-${h.plantId}@${h.period}`} info={h.info} tenancyId={st.tenancyId} plantName={h.plantName ?? ''} />)}
```

`client/src/pages/Heizkosten.tsx` hinter `SelfHeatingCards` (PR 10):

```tsx
      {plant && plant.method !== 'service' && plant.exemption === 'none' && view && (
        <HeatingInfoCard key={view.period} plant={plant} view={view} onChanged={reload} />
      )}
```

- [ ] **Step 6: Anteil und Einrichtung (§ 10, § 7 Abs. 1 Satz 2)**

`client/src/heatingSelfForm.ts`: `SelfSetupForm` bekommt `above70Agreed: boolean` (in `emptySelfSetup`
`false`), `SelfSetupBody` bekommt `above70Agreed: boolean`. In `selfSetupBody` die Schleife der Grenzen
ersetzen durch:

```ts
  for (const v of water === null ? [share] : [share, water]) {
    if (v < min) return { error: `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).` }
    if (v > 100) return { error: 'Nach Verbrauch verteilt werden höchstens 100 % der Kosten.' }
    if (v > max && !form.above70Agreed) return { error: `Mehr als ${max} % nach Verbrauch gehen nur, wenn es mit den Mietern vereinbart ist (§ 10 HeizkostenV). Ist es vereinbart, setzen Sie das Häkchen „vereinbart“.` }
  }
```

und den Pflichtanteil so, dass ein vereinbarter höherer Anteil gilt:
`const share = forced !== null && !(form.above70Agreed && (percent(form.share) ?? 0) > forced) ? forced : percent(form.share)`;
im Rumpf `above70Agreed: form.above70Agreed`.

`client/src/components/HeatingSelfSetup.tsx`: das Auswahlfeld „Hat das Haus einen Wärmeschutz …“ ersetzen
durch die beiden Fragen aus `INSULATION_QUESTIONS` (je ein `<select>` mit `ANSWER_OPTIONS`, lokaler Zustand
`old`, `pipes`), und bei jeder Änderung `setForm({ ...form, insulation: insulationFrom(old, pipes) })`. Unter
den Anteilen:

```tsx
      <label className="check">
        <input type="checkbox" checked={form.above70Agreed} onChange={(e) => setForm({ ...form, above70Agreed: e.target.checked })} />
        Mehr als {max} % nach Verbrauch sind mit den Mietern vereinbart (§ 10 HeizkostenV)
      </label>
```

Das Feld „Heizung in %“ ist bei Pflichtanteil nur gesperrt, solange `above70Agreed` falsch ist.

`client/src/components/SelfHeatingCards.tsx`, Karte „Anteil nach Verbrauch“: dieselben beiden Fragen und
dasselbe Häkchen (lokaler Zustand `agreed`), und im Rumpf von `saveShare` `insulationRule:
insulationFrom(old, pipes) || (d?.effective?.insulationRule ?? 'unknown')` und `above70Agreed: agreed`. In
`distributionLines` (heatingSelfView.ts) eine Zeile, wenn `d.effective?.above70Agreed`:
`Mehr als ${shareBounds().max} % nach Verbrauch mit den Mietern vereinbart (§ 10 HeizkostenV).`

`client/src/components/SelfHeatingBlock.tsx`: unter der Zeile zum Warmwasseranteil, wenn
`self.shares?.above70Agreed`: `<p>Anteil nach Verbrauch über {shareBounds().max} % nach Vereinbarung (§ 10 HeizkostenV).</p>`.

Für jedes neue Auswahlfeld (Ausnahme, Vereinbarung, Verbrauchervertrag, die beiden Fragen zu § 7) gilt der
jsdom-Test aus Step 1 (`HeatingRulesFields.test.tsx`); für `HeatingInfoCard` und die beiden Fragen kommt je
ein Test dazu, der den gespeicherten Wert rendert und den angezeigten prüft (Muster wie
`HeatingRulesFields.test.tsx`; bei den Fragen ist der angezeigte Wert nach dem Laden „Bitte wählen“, und
die Zeile „Vorgeschrieben: …“ bzw. „trifft zu“ steht darunter).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingRulesForm heatingInfoForm heatingInfoView HeatingRulesFields heatingSelfForm HeatingSelfSetup SelfHeatingCards heatingSelfView && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "Oberfläche: Ausnahmen und Vereinbarungen, Angaben nach § 6a, Anteil über 70 % mit Vereinbarung, Druckblock mit Balken

Refs #99"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG**

Unter „Hinzugefügt“:

```markdown
- Eigene Heizkostenabrechnung: die Informationen nach § 6a HeizkostenV im Ausdruck (Energieträger,
  Steuern und Abgaben, Entgelte der Erfassung, Kontaktadressen, Streitbeilegung beim
  Verbrauchervertrag, Vergleich mit dem Hausdurchschnitt, witterungsbereinigter Vergleich mit dem
  Vorjahr als Balken mit dem Klimafaktor des DWD). Fehlt eine Angabe, nennt Mietfuchs die Kürzung um
  3 % je Mieter. Mehr als 70 % nach Verbrauch mit Vereinbarung (§ 10). ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Heizung in den Stammdaten: Ausnahme nach § 11 HeizkostenV und abweichende Vereinbarung im
  Zweifamilienhaus (§ 2); dann nennt Mietfuchs keine Kürzungen nach § 12, und unter § 11 werden die
  CO₂-Kosten nur bei vereinbarter Abrechnung aufgeteilt (§ 2 Abs. 7 CO2KostAufG). ([#99](https://github.com/speedone/mietfuchs/issues/99))
```

Unter „Geändert“:

```markdown
- Neue Warnung „Monatliche Verbrauchsinformation“ bei jeder Heizanlage, deren Geräte fernablesbar sind
  oder deren Fernablesbarkeit nicht angegeben ist: Seit 2022 stehen den Mietern dann monatliche
  Informationen zu, sonst bis zu 3 % Kürzung. Bekommen Ihre Mieter sie über den Messdienst, bestätigen Sie
  das unter Stammdaten bei der Heizung. ([#99](https://github.com/speedone/mietfuchs/issues/99))
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt der Berechnungs-Engine hinter dem Absatz zur Schätzung (PR 13):

```markdown
- **Pflichtangaben und Ausnahmen** (Heizung PR 14): `heatingInfoOf` (server/src/heatingInfo.ts) rechnet
  die Informationen nach § 6a Abs. 3 bzw. Abs. 5 je Anlage und Heizperiode (`Settlement.heating[].info`);
  Nr. 4 als Hausdurchschnitt je m², Nr. 5 Wärme mal Klimafaktor des DWD, Warmwasser unbereinigt, der
  Vorjahreswert aus der neu gerechneten Vorperiode; ⟨Norm offen: DIN 94680⟩. Jede sicher fehlende Nummer
  ergibt `heating.info-incomplete` mit 3 % je Mieter, das erste Jahr eines Mieters „bis zu“ (Auslegung).
  `suspendedBy` in computeSettlement: Unter einer Ausnahme nach § 11 oder einer wirksamen Vereinbarung
  nach § 2 nennt Mietfuchs an keiner Stelle eine Kürzung nach § 12; unter § 11 keine CO₂-Aufteilung ohne
  vereinbarte Abrechnung (§ 2 Abs. 7 CO2KostAufG). Mehr als 70 % nur mit `above_70_agreed` (§ 10), auch
  über dem Pflichtanteil des § 7 Abs. 1 Satz 2 (Auslegung). Kontaktadressen in `shared/heatingInfo.ts`,
  jährlich prüfen.
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, Exit-Status 0.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle bestanden.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Pflichtangaben und Ausnahmen in CHANGELOG und CLAUDE.md

Refs #99"
```

- [ ] **Step 5: Durchsicht mit frischem Kontext vor dem PR**; Integrationsdurchsicht der Phase C (PR 10
  bis PR 14) mit Praxislauf und Label `full-check` an der obersten PR (CLAUDE.md); Abweichungen 1 bis 16
  in die PR-Beschreibung.

---

## Selbstprüfung

**Abdeckung des Entwurfs:**

| Anforderung | Task |
|---|---|
| 8.8 § 6a Abs. 3 Nr. 1 a–c, 2, 3, 4, 5, je Nummer mit 3 % | 1, 3, 5, 6 |
| 8.8 erstes Jahr ohne Vorjahr „bis zu 3 %“ (15.1 Nr. 14) | 3, 5 |
| 8.8 Klimafaktor des DWD je Postleitzahl, abgefragt (15.2 F5) | 2, 4, 6 |
| 8.8 Vergleich mit Durchschnittsnutzer, ⟨Norm offen: DIN 94680⟩ | 3, 6 |
| 8.8 `heating.monthly-info` bei `remote_readable = true` bzw. `devices_remote` nicht `none`, bis PR 22 oder Bestätigung | 2, 5, 6 |
| 8.8 Abs. 5: ohne Verbrauch nur Nr. 2 und 3 | 3, 5 |
| 8.9 § 11: Hinweis, kein § 12-Hinweis, § 2 Abs. 7 CO2KostAufG | 2, 5, 6; Abweichung 5 zur Verteilung |
| 8.9 § 2: nur bei `mayAgreeOtherwise`, kein § 12-Hinweis, ohne Vereinbarung gilt die Verordnung (15.1 Nr. 8) | 4, 5, 6 |
| 8.5 § 7 Abs. 1 Satz 2 zwingend 70 % (PR 10), Frage in zwei Teilen, `heating.insulation-rule-unknown` | 3, 5, 6 |
| 8.5 § 10 über 70 % mit `above_70_agreed` | 3, 4, 5, 6 |
| 6.5 Zeile „Informationen § 6a“: Grundlage gedruckte Zeilen nach Abzug | 5 (`cutsOn`, `cutOf`) |
| 4.3 `hkv.cut.information`; 4.8 Nr. 4 Kontaktadressen | 1 |
| 10.1 vier Codes, 10.2 `heating-info`, 10.3 `billingInfo`, `climateFactor` | 1, 5 |
| 14.1 Pflichtangaben, Monatliche Verbrauchsinformation, Zweifamilienhaus, Ausnahmen § 11 | alle |

**Platzhalter:** keine; Stellen, an denen ein Vorgänger einen anderen Namen haben könnte, nennen die
Regel („heißt er anders, gilt dessen Name“) und den Namen aus dessen Plan.

**Namen:** `heatingInfoOf`, `byConsumption`, `InfoInput`, `InfoRow`, `HeatingInfoStatement`,
`InfoComparison`, `InfoItem`, `HeatingInfoInputs`, `saveHeatingInfo`, `postalCodeOf`, `suspendedBy`,
`co2OffByExemption`, `infoOf`, `INFO_CONTACTS`, `CONSUMER_CONTRACT_NONE`, `insulationFrom`,
`EXEMPTION_OPTIONS`, `AGREED_OPTIONS`, `infoToForm`, `infoBody`, `dwdHint`, `infoLines`, `comparisonOf`,
`barWidths` durchgehend gleich; `ConsumptionShares.above70Agreed` und `.insulationRule` in Task 3
eingeführt, in Task 4 und 5 gelesen.

**Review Focus:** jede der fünf Zeilen hat ihren Test (Task 3, 4, 5).

**Nicht in diesem Plan:** die monatliche Verbrauchsinformation selbst (PR 22), Contracting und § 11 Abs. 1
Nr. 4 (PR 16), Heime nach § 11 Abs. 1 Nr. 2 (nicht im Zielbild), Vorerfassung (#218).
