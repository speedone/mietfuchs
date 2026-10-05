# Heizung PR 22: Monatliche Verbrauchsinformation (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei einer eigenen Heizkostenabrechnung mit fernablesbaren Geräten erstellt Mietfuchs aus den
Monatsendständen der Zähler je Mieter und Monat die Verbrauchsinformation nach § 6a Abs. 1 Nr. 2, Abs. 2
HeizkostenV (Verbrauch in kWh, Vergleich mit Vormonat und Vorjahresmonat desselben Nutzers, Vergleich mit
einem Durchschnittsnutzer), druckt sie, hält fest, wann sie mitgeteilt wurde, und beziffert in
`heating.monthly-info` je Mieter die 3 % nach § 12 Abs. 1 Satz 3 HeizkostenV für jeden Monat, der fehlt
oder unvollständig ist. Wer die Information vom Messdienst bekommt, bestätigt das an der Anlage (PR 14).

**Architecture:** Eine neue Tabelle `heating_monthly_info` (je Anlage und Monat: Vergleichswert mit Quelle,
Tag der Mitteilung) in einem erzeugten Schritt. Die Rechnung steht als reine Funktion in
`server/src/monthlyInfo.ts` (`monthlyInfoMonths`, `openMonths`); sie liest nur Ablesungen, die genau an den
Monatsgrenzen liegen, und nie interpolierte Werte. `computeSettlement` ersetzt bei eigener Abrechnung den
pauschalen Hinweis von PR 14 durch die Auswertung je Monat; eine Route liefert die Monate einer Heizperiode
an die neue Karte „Monatliche Verbrauchsinformation“ der Seite Heizkosten, die das Blatt je Mieter druckt.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM 0.45 über
`sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(R-A17: „PR 22 ist nicht entbehrlich“), 1.2 Nr. 5 (Kürzungen einzeln), 3.5 (Monatsendwerte, [M] ista),
4.3 (`hkv.cut.information`), 5.3 (`remote_readable`, `installed_on`, `devices_remote`), 6.5
(„Informationen § 6a | `hkv.cut.information` | Anteil an den Heizkosten“; Rundung auf die gedruckten
Zeilen), **8.8** („Monatliche Verbrauchsinformation (§ 6a Abs. 1, 2)“), 10.1 (`heating.monthly-info`
warning, PR 14, 22), 10.2 (`heating-info`), 10.3 (`billingInfo`), 12.3 Nr. 14, **13 PR 22**, 14.1 Zeile
„Monatliche Verbrauchsinformation“, 14.2 (#99), 15.1 Nr. 4.

**Baut auf:** PR 1 bis PR 21. Gearbeitet wird auf `feat/heizung-pr22-verbrauchsinfo`, abgezweigt von der
Spitze von PR 21, gestapelt gestellt und nach dem Merge von PR 21 auf `main` umgestellt.

**Rechtsquellen, am 05.10.2026 gelesen:**

- § 6a Abs. 1 HeizkostenV (gesetze-im-internet.de, Fassung Art. 3 G v. 16.10.2023): „Wenn fernablesbare
  Ausstattungen zur Verbrauchserfassung installiert wurden, hat der Gebäudeeigentümer den Nutzern
  Abrechnungs- oder Verbrauchsinformationen für Heizung und Warmwasser auf der Grundlage des tatsächlichen
  Verbrauchs oder der Ablesewerte von Heizkostenverteilern in folgenden Zeitabständen mitzuteilen: 1. für
  alle Abrechnungszeiträume, die ab dem 1. Dezember 2021 beginnen a) auf Verlangen des Nutzers oder … b)
  ansonsten mindestens zweimal im Jahr, 2. ab dem 1. Januar 2022 monatlich.“
- § 6a Abs. 2: „Verbrauchsinformationen nach Absatz 1 Nummer 2 müssen mindestens folgende Informationen
  enthalten: 1. Verbrauch des Nutzers im letzten Monat in Kilowattstunden, 2. einen Vergleich dieses
  Verbrauchs mit dem Verbrauch des Vormonats desselben Nutzers sowie mit dem entsprechenden Monat des
  Vorjahres desselben Nutzers, soweit diese Daten erhoben worden sind, und 3. einen Vergleich mit dem
  Verbrauch eines normierten oder durch Vergleichstests ermittelten Durchschnittsnutzers derselben
  Nutzerkategorie.“
- § 12 Abs. 1 Satz 2, 3: Kürzung um „3 vom Hundert“ …; „Dasselbe ist anzuwenden, wenn der
  Gebäudeeigentümer die Informationen nach § 6a nicht oder nicht vollständig mitteilt.“
- **Amtliche Begründung, BR-Drs. 643/21 vom 04.08.2021** (dserver.bundestag.de/brd/2021/0643-21.pdf),
  S. 18–21, zu § 6a (Mitteilen und Erhebung S. 18, Abs. 2 S. 19, Abs. 3 Nr. 4 S. 21):
  - „Mitteilen der Informationen bedeutet, dass die Information den Nutzer unmittelbar erreicht, ohne dass
    er sie suchen muss. Dies kann in Papierform oder auf elektronischem Wege, etwa per E-Mail, geschehen.
    Informationen können auch über das Internet (und über Schnittstellen wie ein Webportal oder eine
    Smartphone-App) zur Verfügung gestellt werden, jedoch nur, wenn der Nutzer dann in irgendeiner Weise in
    den angegebenen Intervallen darüber unterrichtet wird, dass sie dort nun zur Verfügung stehen.“
  - „Die Verbrauchserhebung ist daher auf einmal im Monat zu begrenzen.“
  - Zu Abs. 2 Nr. 2: „Mit dem entsprechenden Monat des Vorjahres ist der Monat gemeint, der dem Namen nach
    dem Monat entspricht …“
  - Zu Abs. 2 Nr. 3: „Gemeint ist damit nicht ein Vergleich mit den Nutzern im selben Gebäude. Für den
    Vergleich sollen anonymisierte Verbraucher aus den Gebäudeportfolios der Ablesedienstleister dienen.“
    Kriterien: „derselbe Zeitraum, dieselbe Klimazone, ein vergleichbarer energetischer Zustand oder das
    Baualter des Gebäudes, der verwendete Energieträger oder die eingesetzte Anlagentechnik sowie die
    Gebäudegröße“. Zu Abs. 3 Nr. 4: „Zu dem Vergleich gilt das zu Absatz 2 Nummer 3 Ausgeführte
    entsprechend.“
  - Weitere Informationen „dürfen jedoch keine personenbezogenen Daten im Sinne des Art. 4 Nummer 1
    Datenschutz-Grundverordnung (DSGVO) enthalten“.
- Die Richtlinie verlangt monatlich „während der Heizperiode“ (Begründung S. 1, Anhang VIIa der
  Energieeffizienzrichtlinie); § 6a Abs. 1 Nr. 2 sagt nur „monatlich“. Mietfuchs folgt dem Wortlaut der
  Verordnung (alle Monate).

## Global Constraints

- **Nicht entbehrlich, nie automatisch abgezogen** (R-A17, 6.5): Die Kürzung wird je Mieter beziffert und
  einzeln genannt, nie summiert und nie abgezogen. Grundlage sind die gedruckten Heizzeilen des Mieters nach
  CO₂-Abzug (`cutOf` aus PR 10/14).
- **Wer nichts einstellt, merkt nichts** (1.2 Nr. 1): Ohne Anlage, ohne fernablesbares Gerät oder mit der
  Bestätigung „anders mitgeteilt“ ändert sich nichts gegenüber PR 21. Golden F01–F18 bleiben wortgleich
  (ihre Anlagen sind nicht `self` mit fernablesbaren Zählern, oder der Hinweis steht seit PR 14 schon so da;
  Task 4 Step 7 prüft das).
- **Nur erhobene Werte** (§ 6a Abs. 2 Nr. 2 „soweit diese Daten erhoben worden sind“; Begründung: einmal im
  Monat): Verbrauch entsteht nur aus Ablesungen genau am Ende des Vormonats und am Ende des Monats (bzw. am
  Tag vor Einzug und am Auszugstag). Kein interpolierter Wert, keine Gradtage, keine Schätzung.
- **Nur Daten desselben Nutzers** (Abs. 2 Nr. 2, DSGVO laut Begründung): Vormonat und Vorjahresmonat nur
  aus demselben Mietverhältnis; das Blatt eines Mieters nennt keinen anderen Nutzer.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): 3 % aus `hkv.cut.information`, der Beginn 01.01.2022 aus
  `hkv.monthly-info` (beide PR 14), die Formel für Warmwasser aus `hkv.dhw.volume-formula` (PR 11).
  `server/src/monthlyInfo.ts` kommt in `ENGINE_FILES` von `law-literals.test.ts`.
- **Stufe hängt am Code** (#112): `heating.monthly-info` bleibt `warning` (10.1); neuer Begriff
  `monthlyConsumptionInfo`.
- **Migration:** ein erzeugter Schritt `verbrauchsinfo` (eine neue Tabelle samt Bedingungen, keine geänderte
  Bedingung an einer bestehenden Tabelle) hinter PR 21; drizzle-kit vergibt die Nummer (Annahme B7).
- **Eingefrorener Eingang** bleibt unverändert; die db.json kennt keine Verbrauchsinformation.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0. Commit-Nachrichten
  deutsch, mit `Refs #99` und den Attribution-Zeilen der ausführenden Sitzung.

## Review Focus

1. **Mieterwechsel mitten im Monat.** Der Vornutzer und der Nachnutzer bekommen je ihren Teil des Monats,
   wenn am Auszugstag abgelesen wurde; der Nachnutzer bekommt keinen Vergleich mit dem Verbrauch des
   Vornutzers (Abs. 2 Nr. 2 „desselben Nutzers“). Test in Task 2.
2. **Ein Mieter sieht die Information nur im Portal des Messdienstes, ohne monatliche Nachricht.** Das ist
   nach der Begründung kein „Mitteilen“. Erwartet: Der Satz an der Bestätigung (PR 14) verlangt die
   Nachricht jeden Monat. Test in Task 5.
3. **Heizkostenverteiler statt Wärmezähler.** § 6a Abs. 2 Nr. 1 verlangt Kilowattstunden; eine Umrechnung
   von Einheiten in kWh kennt die Verordnung nicht. Erwartet: Monat „unvollständig“ mit dem Grund, Hinweis
   mit 3 %, kein erfundener kWh-Wert. Test in Task 2.
4. **Heizperiode Mai 2021 bis April 2022.** Monatlich gilt erst ab dem 01.01.2022. Erwartet: verlangt
   werden nur Januar bis April 2022. Test in Task 2.
5. **„Mitgeteilt am“ liegt vor dem Ende des Monats.** Die Information nennt den Verbrauch des abgelaufenen
   Monats. Erwartet: 400 mit einem Satz („frühestens am 01.12.2025“). Test in Task 3.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/types.ts`, `shared/monthlyInfo.ts` (neu), `shared/glossary.ts` | Typen, Monatsnamen und -spannen, Begriff | 1 |
| `server/src/monthlyInfo.ts` (neu) | Rechnung je Monat und Mieter | 2 |
| `server/src/db/schema.ts`, `server/drizzle/00xx_verbrauchsinfo.sql` (erzeugt), `server/src/db/read.ts`, `server/src/db/monthlyInfo.ts` (neu), `server/src/index.ts` | Tabelle, Lesen, Schreiben, Routen | 3 |
| `server/src/snapshot.ts`, `server/src/calc.ts` | Schnappschuss, Hinweis `heating.monthly-info` | 4 |
| `client/src/monthlyInfoForm.ts` (neu), `client/src/components/MonthlyInfoCard.tsx` (neu), `client/src/components/MonthlyInfoSheet.tsx` (neu), `client/src/pages/Heizkosten.tsx`, `client/src/heatingRulesForm.ts`, `client/src/components/HeatingRulesFields.tsx`, `client/src/index.css` | Karte, Blatt, Druck, Satz an der Bestätigung | 5 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 6 |
| Tests: `server/test/glossary.test.ts`, `monthly-info.test.ts` (neu), `db-verbrauchsinfo.test.ts` (neu), `migrations.test.ts`, `schema.test.ts`, `api.test.ts`, `calc-verbrauchsinfo.test.ts` (neu), `calc-pflichtangaben.test.ts` (PR 14), `law-literals.test.ts`, `client/src/monthlyInfoForm.test.ts` (neu), `client/src/components/MonthlyInfoCard.test.tsx` (neu), `client/src/heatingRulesForm.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- PR 1: `law`, `onlyVersion`, `createLawLog`, `dayBefore`, `dayAfter`, `germanDate`, `LawLog`.
- PR 4 (`server/src/remoteReading.ts`): `plantDevices(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[]): RemoteMeter[]`,
  `RemoteMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'>`,
  `RemotePlant`, `RemoteUnit`; `Meter.remoteReadable`, `installedOn`; `HeatingPlant.devicesRemote`.
- PR 5/6/8 (`server/src/db/heatingPeriodContext.ts`): `plantContext(db, plantId)`, `heatingPeriodOf(ctx, text)`
  (wirft 400 bei unbekanntem Schlüssel); `readStock(db)` mit `heatingPlants`, `units`, `tenancies`,
  `meters`, `readings`, `heatingPeriodRows`.
- PR 10: `selfPlans` (Map Anlage → Plan), `cutOf(tenancyId, ids, cut): number | null`, `nameOf(tenancyId)`,
  `fmtCents`, `andList` in calc.ts.
- PR 11 (`shared/law/heizkostenv.ts`): `hkvDhwVolumeFormula: LawParam<{ readonly effort: number; readonly coldWaterC: number }, 'periodStart'>`;
  `HeatingPeriodData.dhwTempC`.
- PR 14: `hkvMonthlyInfo: LawParam<{ readonly interval: string }, 'overlap'>` (`validFrom` 2022-01-01),
  `hkvCutInformation`; `HeatingPlant.monthlyInfoElsewhere: boolean`; `SnapshotHeatingPlant` pickt
  `monthlyInfoElsewhere`; in `computeSettlement` im Block `for (const pot of co2Pots)` die Größen `plant`,
  `hPeriod`, `where`, `subject`, `ids`, `suspended`, `spOfPlant`, `servedIds`, `remote`, `monthly`, `cut`,
  `cutsOn(ids, cut)`, `warn`; `noticeKinds['heating.monthly-info']`; Client `HeatingRulesFields.tsx`,
  `heatingRulesForm.ts`; im Test `calc-pflichtangaben.test.ts` (Name nach PR 14) der Test „Monatliche
  Information: bei fernablesbarem Zähler eine Warnung …“ mit `selfSnapshot`, `mitAngaben`, `mitVorperiode`,
  `mitAnlage`, `codes`.
- PR 13: `server/testing/selfHeating.ts` mit `selfSnapshot()` (Beispiel A, Heizperiode `'2025-01'`).

### Annahmen über PR 18 bis PR 21 und Namen der Vorgänger

**Vor Task 1** gleicht die ausführende Sitzung jede Zeile ab und ersetzt abweichende Namen:

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| B1 | `Stock` (read.ts) hat die Felder `heatingPlants`, `units`, `tenancies`, `meters`, `readings`, `heatingPeriodRows`, und `readStock` füllt sie (so benutzt PR 17 sie in der Route des CO₂-Blatts). | Task 3 |
| B2 | `SnapshotHeatingPeriodRow` pickt `dhwTempC` (PR 11 rechnet die Volumenformel daraus); fehlt das Feld, ergänzt Task 4 Step 3 es im `Pick`. `SnapshotUnit` hat `name`, `areaM2`, `noConnection`. | Task 4 |
| B3 | Der Block „Monatliche Verbrauchsinformation“ von PR 14 steht in calc.ts so, wie ihn der Plan von PR 14 (Task 6 Step 7) zeigt. | Task 4 |
| B4 | `RemotePlant` und `RemoteUnit` sind mit `SnapshotHeatingPlant` bzw. `SnapshotUnit` und mit `HeatingPlant` bzw. `Unit` verträglich (PR 4 ruft `remoteReadingVerdict` mit den Daten des Schnappschusses auf). | Task 2, 3, 4 |
| B5 | `heatingPeriodOf(ctx, text)` liefert `{ key, from, to, short }` (PR 6: `BillingPeriod`). | Task 3 |
| B6 | Die Seite `client/src/pages/Heizkosten.tsx` rendert je Anlage und Heizperiode Karten mit den Variablen `plant` (HeatingPlant) und `view` (HeatingPeriodView); der Satz der Bestätigung steht in `HeatingRulesFields.tsx` (PR 14) als Text am Kontrollkästchen. | Task 5 |
| B7 | Die letzte Migration vor diesem PR ist `…_eichfrist_bedingungen` (PR 21); dieser Schritt wäre dann `0045_verbrauchsinfo`. Tests sprechen ihn über `_verbrauchsinfo` an. | Task 3 |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung.

1. **Nur bei eigener Abrechnung (`self`) erstellt Mietfuchs die Information** (Entwurf 13 PR 22 nennt keine
   Methode): Nur dort kennt es die Geräte je Wohnung. Bei Messdienst und freien Schlüsseln bleibt der
   Hinweis von PR 14 mit der Bestätigung; sein Text sagt jetzt, wer die Information erstellt.
2. **Durchschnittsnutzer (Abs. 2 Nr. 3) als Vergleichswert mit Quelle, nicht als Hausdurchschnitt.** Die
   Begründung schließt den Vergleich mit den Nutzern desselben Gebäudes ausdrücklich aus. Mietfuchs hat keine
   Vergleichsdaten; der Vermieter trägt je Monat einen Wert in kWh je m² Wohnfläche mit Pflichtfeld „Quelle“
   ein (etwa vom Ablesedienst). Ohne Wert ist der Monat unvollständig. Gerechnet wird Wert × Wohnfläche ×
   Nutzungstage / Tage des Monats (Festlegung: die Verordnung nennt keine Rechenart). ⟨Norm offen: DIN 94680⟩,
   die laut Inhaltsangabe Vergleichswerte enthält (Entwurf 0.2).
   **Befund für PR 14 (nicht in diesem PR geändert):** Entwurf 8.8 Nr. 4 und der Plan von PR 14 nehmen für
   § 6a Abs. 3 Nr. 4 den „Hausdurchschnitt je m², so benannt“; nach der Begründung zu Abs. 3 Nr. 4 („gilt
   das zu Absatz 2 Nummer 3 Ausgeführte entsprechend“) ist das kein zulässiger Vergleich. Das gehört als
   eigener Befund vor den Merge von PR 14 (Rückfrage an den Nutzer, ob dafür ein GitHub-Issue angelegt wird).
3. **Warmwasser in kWh nach § 9 Abs. 2 Satz 2 HeizkostenV (Auslegung).** Abs. 2 Nr. 1 verlangt
   Kilowattstunden, Warmwasserzähler messen m³. Die einzige Umrechnung, die die Verordnung kennt, ist die
   Zahlenwertgleichung 2,5 · V · (t_w − 10) mit der mittleren Warmwassertemperatur der Heizperiode
   (`heating_periods.dhw_temp_c`). Sie ist für die Wärmemenge der Anlage geschrieben, nicht für den Monat
   eines Nutzers; das Blatt nennt deshalb m³ und kWh und die Formel. Ohne Temperatur ist der Monat
   unvollständig. Lehnt die Durchsicht die Auslegung ab, entfällt `dhwKwh`, und jeder Monat mit
   Warmwasserzähler bleibt unvollständig.
4. **Heizkostenverteiler ergeben keine kWh** (Review Focus 3): Mietfuchs rechnet Einheiten nicht in kWh um;
   ein Monat mit HKV ist unvollständig, und der Hinweis empfiehlt die Information des Ablesedienstes.
5. **Pflicht schon bei einem fernablesbaren Gerät der Anlage** (Wortlaut „Wenn fernablesbare Ausstattungen
   … installiert wurden“): Die Begründung verlangt bei gemischter Ausstattung eine „Einzelfallprüfung“;
   Mietfuchs wählt die vorsichtige Lesart und nennt die Information für jeden Mieter der Anlage, wie PR 14.
   Ein Gerät zählt ab dem Monat, an dessen Ende es eingebaut ist (`installed_on`), ohne Datum immer.
6. **„Mitgeteilt“ je Anlage und Monat, nicht je Mieter (Festlegung):** Der Vermieter vermerkt einen Tag für
   alle Blätter des Monats. Frühestens am Tag nach dem Monatsende (Review Focus 5).
7. **Fällig ist ein Monat ab dem Folgemonat** (`asOf` der Abrechnung): Ein Monat, der noch läuft oder in
   der Zukunft liegt, gilt nicht als fehlend. Ohne `asOf` (Golden, Regression) zählen alle Monate der
   Heizperiode.
8. **Kürzung „um 3 %“ statt „bis zu“**, wenn Mietfuchs die Geräte kennt und ein Monat fehlt oder
   unvollständig ist (PR 14 nannte „bis zu“, weil die Fernablesbarkeit offen war). Grundlage: § 12 Abs. 1
   Satz 3 („nicht oder nicht vollständig“). Ob jeder einzelne fehlende Monat das Recht auslöst, ist nicht
   entschieden (15.1 Nr. 4 betrifft nur das Zusammentreffen); der Text nennt die Monate.
9. **Alle Monate, nicht nur die Heizperiode der Richtlinie** (Rechtsquellen oben): Wortlaut der Verordnung.

---

### Task 1: Typen, Monatsnamen und Begriff

**Files:**
- Create: `shared/monthlyInfo.ts`
- Modify: `shared/types.ts`, `shared/glossary.ts`
- Test: `server/test/monthly-info.test.ts` (neu, erster Teil), `server/test/glossary.test.ts`

**Interfaces:**
- Produces:
  - `shared/types.ts`:
    `type MonthlyInfoRow = { plantId: string; month: string; referenceKwhPerM2: number | null; referenceSource: string | null; sentOn: string | null }`;
    `type MonthlyInfoGap = 'noReading' | 'negative' | 'hca' | 'dhwTemp' | 'reference'`;
    `type MonthlyInfoUser = { tenancyId: string; tenantName: string; unitName: string; areaM2: number; from: string; to: string; heatKwh: number | null; dhwM3: number | null; dhwKwh: number | null; totalKwh: number | null; previousMonthKwh: number | null; previousYearKwh: number | null; referenceKwh: number | null; gaps: MonthlyInfoGap[] }`;
    `type MonthlyInfoMonth = { month: string; due: boolean; row: MonthlyInfoRow | null; users: MonthlyInfoUser[]; complete: boolean; sent: boolean }`;
    `type MonthlyInfoView = { plantId: string; period: PeriodKey; managed: boolean; elsewhere: boolean; months: MonthlyInfoMonth[] }`.
  - `shared/monthlyInfo.ts`: `monthName(month: string): string` („November 2025“), `monthRanges(months: readonly string[]): string`
    („Januar bis Oktober 2025, Dezember 2025“), `monthBounds(month: string): { from: string; to: string }`,
    `monthsBetween(from: string, to: string): string[]`, `addMonths(month: string, n: number): string`.
  - Lexikon `monthlyConsumptionInfo`.

- [ ] **Step 1: Write the failing tests**

`server/test/monthly-info.test.ts` (wird in Task 2 fortgesetzt):

```ts
// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, monthBounds, monthName, monthRanges, monthsBetween } from '../../shared/monthlyInfo.ts'

test('Monate: Name, Grenzen, Spannen, Abstand', () => {
  assert.equal(monthName('2025-11'), 'November 2025')
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(monthBounds('2025-12'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.equal(addMonths('2025-01', -1), '2024-12')
  assert.equal(addMonths('2025-11', -12), '2024-11')
  assert.equal(monthRanges(['2025-01', '2025-02', '2025-03', '2025-05']), 'Januar bis März 2025, Mai 2025')
  assert.equal(monthRanges(['2024-11', '2024-12', '2025-01']), 'November 2024 bis Januar 2025')
  assert.equal(monthRanges([]), '')
})
```

`server/test/glossary.test.ts` ans Dateiende:

```ts
test('Lexikon monthlyConsumptionInfo: Mitteilen jeden Monat, kWh, Vergleichswert nicht aus dem Haus', () => {
  const t = GLOSSARY.monthlyConsumptionInfo
  assert.match(t.short, /fernablesbar/)
  assert.match(t.example, /kWh/)
  assert.match(t.norm ?? '', /§ 6a Abs\. 1 und 2.*§ 12 Abs\. 1 Satz 3 HeizkostenV/)
  assert.match(t.needed, /jeden Monat.*Nachricht/s)
  assert.match(t.needed, /nicht.*Nutzer.*desselben Hauses/s)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/monthly-info.test.ts test/glossary.test.ts`
Expected: FAIL: `Cannot find module '../../shared/monthlyInfo.ts'`; `GLOSSARY.monthlyConsumptionInfo` ist
`undefined`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Ans Dateiende:

```ts
// ---------- Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV) ----------

// Je Anlage und Monat ('JJJJ-MM'): der Vergleichswert eines Durchschnittsnutzers in kWh je m² Wohnfläche
// mit seiner Quelle (Abs. 2 Nr. 3; nicht aus dem eigenen Haus, BR-Drs. 643/21) und der Tag, an dem die
// Information den Mietern mitgeteilt wurde.
export type MonthlyInfoRow = { plantId: string; month: string; referenceKwhPerM2: number | null; referenceSource: string | null; sentOn: string | null }

// Warum eine Information unvollständig ist: keine Ablesung genau an den Monatsgrenzen, negativer
// Verbrauch, Heizkostenverteiler (keine kWh), Warmwasser ohne Temperatur für die Umrechnung, kein
// Vergleichswert.
export type MonthlyInfoGap = 'noReading' | 'negative' | 'hca' | 'dhwTemp' | 'reference'

// Die Information eines Mieters für einen Monat (`from`/`to`: seine Tage in diesem Monat). Vormonat und
// Vorjahresmonat nur aus demselben Mietverhältnis und nur, soweit erhoben (sonst null).
export type MonthlyInfoUser = {
  tenancyId: string
  tenantName: string
  unitName: string
  areaM2: number
  from: string
  to: string
  heatKwh: number | null
  dhwM3: number | null
  dhwKwh: number | null
  totalKwh: number | null
  previousMonthKwh: number | null
  previousYearKwh: number | null
  referenceKwh: number | null
  gaps: MonthlyInfoGap[]
}

// Ein Monat einer Heizperiode. `due`: der Monat ist abgelaufen (Folgemonat erreicht); `complete`: jede
// Information enthält alles nach Abs. 2; `sent`: als mitgeteilt vermerkt.
export type MonthlyInfoMonth = { month: string; due: boolean; row: MonthlyInfoRow | null; users: MonthlyInfoUser[]; complete: boolean; sent: boolean }

// Was die Karte der Seite Heizkosten zu einer Heizperiode lädt. `managed`: Mietfuchs erstellt die
// Information (eigene Abrechnung); `elsewhere`: der Vermieter hat bestätigt, dass die Mieter sie anders
// mitgeteilt bekommen (PR 14).
export type MonthlyInfoView = { plantId: string; period: PeriodKey; managed: boolean; elsewhere: boolean; months: MonthlyInfoMonth[] }
```

- [ ] **Step 4: Implement `shared/monthlyInfo.ts`**

```ts
// Monate für die monatliche Verbrauchsinformation (Heizung PR 22): Namen, Grenzen, Spannen. Gemeinsam für
// Server (Hinweistexte) und Oberfläche (Karte, Blatt). Gerechnet wird aus der Zeichenkette und in UTC, wie
// überall in Mietfuchs, damit keine Zeitzone einen Tag verschiebt.

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const parts = (month: string): [number, number] => [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
const fmt = (y: number, m: number): string => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`

export function monthName(month: string): string {
  const [y, m] = parts(month)
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`
}

export function addMonths(month: string, n: number): string {
  const [y, m] = parts(month)
  const index = y * 12 + (m - 1) + n
  return fmt(Math.floor(index / 12), (index % 12) + 1)
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = parts(month)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

// Alle Monate, die die Tage von `from` bis `to` (einschließlich) berühren.
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m)
  return out
}

// „Januar bis März 2025, Mai 2025“: aufeinanderfolgende Monate zu einer Spanne.
export function monthRanges(months: readonly string[]): string {
  const sorted = [...new Set(months)].sort()
  const runs: [string, string][] = []
  for (const m of sorted) {
    const last = runs.at(-1)
    if (last && addMonths(last[1], 1) === m) last[1] = m
    else runs.push([m, m])
  }
  return runs.map(([a, b]) => {
    if (a === b) return monthName(a)
    const [ya, ma] = parts(a)
    return ya === parts(b)[0] ? `${MONTH_NAMES[ma - 1]} bis ${monthName(b)}` : `${monthName(a)} bis ${monthName(b)}`
  }).join(', ')
}
```

- [ ] **Step 5: Lexikon (`shared/glossary.ts`)**

Import ergänzen (falls nicht schon da): `import { hkvCutInformation } from './law/heizkostenv.ts'` und unter
den Konstanten `const INFO_CUT = valueAt(hkvCutInformation, LAW_AS_OF)` (heißt die Konstante seit PR 14 schon
so, diese nehmen). In `GLOSSARY` hinter `billingInfo` (PR 14):

```ts
  // Heizung PR 22: § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV und die Begründung (BR-Drs. 643/21, S. 18 f.),
  // gelesen am 05.10.2026.
  monthlyConsumptionInfo: {
    title: 'Monatliche Verbrauchsinformation',
    short: 'Sind Zähler oder Heizkostenverteiler fernablesbar, bekommt jeder Mieter jeden Monat seinen Verbrauch für Heizung und Warmwasser in Kilowattstunden, verglichen mit dem Vormonat, dem Vorjahresmonat und einem Durchschnittsnutzer.',
    example: 'Im November verbraucht ein Haushalt mit 60 m² 700 kWh für die Heizung und 2,5 m³ Warmwasser (bei 55 °C rund 281 kWh), zusammen 981 kWh; im Oktober waren es 625 kWh, im November des Vorjahres 575 kWh; ein Durchschnittsnutzer mit 60 m² verbraucht laut Vergleichswert 600 kWh.',
    norm: '§ 6a Abs. 1 und 2, § 12 Abs. 1 Satz 3 HeizkostenV',
    needed: `Ja, sobald ein Gerät fernablesbar ist. Die Information muss den Mieter erreichen: als Brief oder E-Mail, oder in einem Portal oder einer App, wenn er jeden Monat eine Nachricht bekommt, dass sie dort steht. Der Vergleich mit einem Durchschnittsnutzer stammt nicht von den Nutzern desselben Hauses, sondern aus Vergleichsdaten, etwa des Ablesedienstes. Fehlt die Information oder ist sie unvollständig, darf der Mieter seinen Anteil an den Heizkosten um ${INFO_CUT} % kürzen.`,
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/monthly-info.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts shared/monthlyInfo.ts shared/glossary.ts server/test/monthly-info.test.ts server/test/glossary.test.ts
git commit -m "Verbrauchsinformation: Typen, Monatsspannen und Begriff im Lexikon

Refs #99"
```

---

### Task 2: Rechnung je Monat und Mieter (`server/src/monthlyInfo.ts`)

**Files:**
- Create: `server/src/monthlyInfo.ts`
- Modify: `server/test/monthly-info.test.ts`, `server/test/law-literals.test.ts`

**Interfaces:**
- Consumes: Task 1; `plantDevices`, `RemoteMeter`, `RemotePlant`, `RemoteUnit` (PR 4); `hkvMonthlyInfo`
  (PR 14), `hkvDhwVolumeFormula` (PR 11); `law`, `onlyVersion`, `dayBefore`, `LawLog` (PR 1);
  `SnapshotReading`.
- Produces:
  - `exactConsumption(readings: readonly SnapshotReading[], startDay: string, endDay: string): number | null`
  - `type MonthlyInfoInput = { plant: RemotePlant; meters: readonly RemoteMeter[]; units: readonly (RemoteUnit & { name: string; areaM2: number })[]; tenancies: readonly { id: string; unitId: string; tenantName: string; start: string; end: string | null }[]; readings: readonly SnapshotReading[]; rows: readonly MonthlyInfoRow[]; dhwTempC: number | null; h: { from: string; to: string }; asOf?: string }`
  - `monthlyInfoMonths(i: MonthlyInfoInput, log: LawLog): MonthlyInfoMonth[]`
  - `type OpenMonth = { month: string; tenancyIds: string[]; notSent: boolean; gaps: MonthlyInfoGap[] }`
  - `openMonths(months: readonly MonthlyInfoMonth[]): OpenMonth[]`

- [ ] **Step 1: Write the failing tests**

`server/test/monthly-info.test.ts` ergänzen (Importe oben ergänzen):

```ts
import { createLawLog } from '../../shared/law/register.ts'
import { exactConsumption, monthlyInfoMonths, openMonths, type MonthlyInfoInput } from '../src/monthlyInfo.ts'
import type { SnapshotReading } from '../src/snapshot.ts'

const r = (meterId: string, date: string, value: number, extra: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId, date, value, ...extra })

test('Verbrauch nur aus Ablesungen genau an beiden Grenzen; Wechsel über den Endstand; sonst null', () => {
  const rs = [r('w', '2025-10-31', 5400), r('w', '2025-11-15', 5800), r('w', '2025-11-30', 6100)]
  assert.equal(exactConsumption(rs, '2025-10-31', '2025-11-30'), 700)
  assert.equal(exactConsumption(rs, '2025-11-15', '2025-11-30'), 300)
  assert.equal(exactConsumption(rs, '2025-10-30', '2025-11-30'), null, 'keine Ablesung am Beginn')
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-12-02', 6200)], '2025-10-31', '2025-11-30'), null, 'nie interpoliert')
  const wechsel = [r('w', '2025-10-31', 5400), r('w', '2025-11-10', 0, { replacement: true, oldEndValue: 5600 }), r('w', '2025-11-30', 500)]
  assert.equal(exactConsumption(wechsel, '2025-10-31', '2025-11-30'), 700)
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-11-10', 0, { replacement: true }), r('w', '2025-11-30', 500)], '2025-10-31', '2025-11-30'), null, 'Wechsel ohne Endstand')
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-10-31', 5410), r('w', '2025-11-30', 6100)], '2025-10-31', '2025-11-30'), null, 'zwei Ablesungen am selben Tag')
})

const basis = (over: Partial<MonthlyInfoInput> = {}): MonthlyInfoInput => ({
  plant: { id: 'hp', units: null, devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown' } as MonthlyInfoInput['plant'],
  meters: [
    { id: 'wa', unitId: 'a', type: 'waerme', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: '2023-05-01' },
    { id: 'ww', unitId: 'a', type: 'warmwasser', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: '2023-05-01' },
  ],
  units: [{ id: 'a', name: 'EG', areaM2: 60, noConnection: [] }] as MonthlyInfoInput['units'],
  tenancies: [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2024-01-01', end: null }],
  readings: [
    r('wa', '2024-10-31', 1000), r('wa', '2024-11-30', 1350), r('wa', '2025-09-30', 5000), r('wa', '2025-10-31', 5400), r('wa', '2025-11-30', 6100),
    r('ww', '2024-10-31', 5), r('ww', '2024-11-30', 7), r('ww', '2025-09-30', 18), r('ww', '2025-10-31', 20), r('ww', '2025-11-30', 22.5),
  ],
  rows: [{ plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Vergleichswerte des Ablesedienstes Beispiel 2025', sentOn: '2025-12-05' }],
  dhwTempC: 55,
  h: { from: '2025-01-01', to: '2025-12-31' },
  asOf: '2025-12-10',
  ...over,
})

test('November: Wärme 700 kWh, Warmwasser 2,5 m³ = 281,25 kWh (§ 9 Abs. 2 Satz 2), Vormonat, Vorjahresmonat, Durchschnittsnutzer', () => {
  const months = monthlyInfoMonths(basis(), createLawLog())
  assert.deepEqual(months.map((m) => m.month), ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'])
  const nov = months.find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.due, nov.complete, nov.sent], [true, true, true])
  assert.deepEqual(nov.users, [{
    tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30',
    heatKwh: 700, dhwM3: 2.5, dhwKwh: 281.25, totalKwh: 981.25, previousMonthKwh: 625, previousYearKwh: 575, referenceKwh: 600, gaps: [],
  }])
  const dez = months.find((m) => m.month === '2025-12') ?? assert.fail('Dezember fehlt')
  assert.equal(dez.due, false, 'der laufende Monat ist noch nicht fällig')
  const okt = months.find((m) => m.month === '2025-10') ?? assert.fail('Oktober fehlt')
  assert.deepEqual([okt.complete, okt.sent, okt.users[0]?.gaps], [false, false, ['reference']])
  assert.deepEqual(openMonths(months).map((o) => o.month), ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10'])
  assert.deepEqual(openMonths(months).find((o) => o.month === '2025-10'), { month: '2025-10', tenancyIds: ['t1'], notSent: true, gaps: ['reference'] })
})

test('Review Focus 1: Wechsel am 15.11.: jeder Nutzer seinen Teil, der Nachnutzer ohne Vergleich mit dem Vornutzer', () => {
  const i = basis({
    tenancies: [
      { id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2024-01-01', end: '2025-11-15' },
      { id: 't2', unitId: 'a', tenantName: 'Max Beispiel', start: '2025-11-16', end: null },
    ],
    readings: [...basis().readings, r('wa', '2025-11-15', 5800), r('ww', '2025-11-15', 21)],
  })
  const nov = monthlyInfoMonths(i, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  const [a, b] = nov.users
  assert.deepEqual([a?.tenancyId, a?.from, a?.to, a?.heatKwh, a?.previousMonthKwh], ['t1', '2025-11-01', '2025-11-15', 400, 625])
  assert.deepEqual([b?.tenancyId, b?.from, b?.to, b?.heatKwh, b?.previousMonthKwh, b?.previousYearKwh], ['t2', '2025-11-16', '2025-11-30', 300, null, null])
  // Durchschnittsnutzer anteilig nach Tagen: 10 · 60 · 15/30 = 300 kWh
  assert.equal(b?.referenceKwh, 300)
})

test('Review Focus 3: Heizkostenverteiler ergeben keine kWh; Warmwasser ohne Temperatur auch nicht', () => {
  const hkv = basis({ meters: [{ id: 'h1', unitId: 'a', type: 'hkv', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: null }], readings: [r('h1', '2025-10-31', 100), r('h1', '2025-11-30', 160)] })
  const nov = monthlyInfoMonths(hkv, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.users[0]?.totalKwh, nov.users[0]?.gaps, nov.complete], [null, ['hca'], false])
  const ohneTemp = monthlyInfoMonths(basis({ dhwTempC: null }), createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([ohneTemp.users[0]?.heatKwh, ohneTemp.users[0]?.dhwKwh, ohneTemp.users[0]?.totalKwh, ohneTemp.users[0]?.gaps], [700, null, null, ['dhwTemp']])
})

test('Review Focus 4: Heizperiode Mai 2021 bis April 2022: verlangt erst ab Januar 2022', () => {
  // Geräte ohne Einbaudatum, damit nur der Beginn der Pflicht die Monate begrenzt.
  const ohneDatum = basis().meters.map((m) => ({ ...m, installedOn: null }))
  const months = monthlyInfoMonths(basis({ h: { from: '2021-05-01', to: '2022-04-30' }, asOf: undefined, meters: ohneDatum }), createLawLog())
  assert.deepEqual(months.map((m) => m.month), ['2022-01', '2022-02', '2022-03', '2022-04'])
})

test('Ohne fernablesbares Gerät keine Monate; ein Gerät zählt ab dem Monat, an dessen Ende es eingebaut ist', () => {
  const nichtFern = basis({ meters: basis().meters.map((m) => ({ ...m, remoteReadable: false })) })
  assert.deepEqual(monthlyInfoMonths(nichtFern, createLawLog()), [])
  const spaet = basis({ meters: basis().meters.map((m) => ({ ...m, installedOn: '2025-06-15' })) })
  assert.equal(monthlyInfoMonths(spaet, createLawLog())[0]?.month, '2025-06')
})

test('Leerstand braucht keine Mitteilung; negativer Verbrauch ist eine Lücke', () => {
  const leer = monthlyInfoMonths(basis({ tenancies: [] }), createLawLog())
  assert.deepEqual(openMonths(leer), [])
  const rueckwaerts = basis({ readings: [r('wa', '2025-10-31', 5400), r('wa', '2025-11-30', 5300), r('ww', '2025-10-31', 20), r('ww', '2025-11-30', 22.5)] })
  const nov = monthlyInfoMonths(rueckwaerts, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual(nov.users[0]?.gaps, ['negative'])
})
```

`server/test/law-literals.test.ts`: `ENGINE_FILES` um `'server/src/monthlyInfo.ts'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/monthly-info.test.ts test/law-literals.test.ts`
Expected: FAIL: `Cannot find module '../src/monthlyInfo.ts'`.

- [ ] **Step 3: Implement `server/src/monthlyInfo.ts`**

```ts
// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV). Reine Rechnung.
//
// Verbrauch entsteht nur aus erhobenen Werten: Ablesungen genau am Ende des Vormonats und am Ende des Monats
// (bei Ein- oder Auszug am Tag vor dem Einzug bzw. am Auszugstag). Nie interpoliert, nie geschätzt: Abs. 2
// Nr. 2 vergleicht nur, „soweit diese Daten erhoben worden sind“, und die Begründung beschränkt die
// Erhebung auf einmal im Monat (BR-Drs. 643/21, S. 18).
//
// Je Mieter: Wärme in kWh (Wärmezähler), Warmwasser in m³ und in kWh nach der Zahlenwertgleichung des § 9
// Abs. 2 Satz 2 (Auslegung, Plan PR 22, Abweichung 3), Vormonat und Vorjahresmonat desselben
// Mietverhältnisses, Durchschnittsnutzer aus dem eingetragenen Vergleichswert (Abweichung 2).
// Heizkostenverteiler ergeben keine kWh (Abweichung 4).
import type { MonthlyInfoGap, MonthlyInfoMonth, MonthlyInfoRow, MonthlyInfoUser } from '../../shared/types.ts'
import { hkvDhwVolumeFormula, hkvMonthlyInfo } from '../../shared/law/heizkostenv.ts'
import { dayBefore, law, onlyVersion, type LawLog } from '../../shared/law/register.ts'
import { addMonths, monthBounds, monthsBetween } from '../../shared/monthlyInfo.ts'
import { plantDevices, type RemoteMeter, type RemotePlant, type RemoteUnit } from './remoteReading.ts'
import type { SnapshotReading } from './snapshot.ts'

const byDate = (a: SnapshotReading, b: SnapshotReading): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Verbrauch zwischen zwei Tagesenden, nur aus Ablesungen genau an beiden; ein Zählerwechsel zählt über den
// Endstand des alten Geräts (wie meterSegments in calc.ts). Zwei Ablesungen am selben Tag sind
// widersprüchlich (#69): dann null.
export function exactConsumption(readings: readonly SnapshotReading[], startDay: string, endDay: string): number | null {
  const inside = readings.filter((x) => x.date >= startDay && x.date <= endDay).sort(byDate)
  const first = inside[0]
  const last = inside.at(-1)
  if (!first || !last || first.date !== startDay || last.date !== endDay) return null
  if (new Set(inside.map((x) => x.date)).size !== inside.length) return null
  let sum = 0
  for (let k = 1; k < inside.length; k++) {
    const a = inside[k - 1]
    const b = inside[k]
    if (!a || !b) return null
    if (b.replacement === true) {
      if (b.oldEndValue === undefined || b.oldEndValue === null) return null
      sum += b.oldEndValue - a.value
    } else sum += b.value - a.value
  }
  return sum
}

type Tenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null }
type InfoUnit = RemoteUnit & { name: string; areaM2: number }

export type MonthlyInfoInput = {
  plant: RemotePlant
  meters: readonly RemoteMeter[]
  units: readonly InfoUnit[]
  tenancies: readonly Tenancy[]
  readings: readonly SnapshotReading[]
  rows: readonly MonthlyInfoRow[]
  dhwTempC: number | null
  h: { from: string; to: string }
  asOf?: string
}

const daysOf = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

// Die Tage eines Mietverhältnisses in einem Monat, oder null.
function sliceOf(t: Tenancy, month: string): { from: string; to: string } | null {
  const b = monthBounds(month)
  const from = t.start > b.from ? t.start : b.from
  const to = t.end !== null && t.end < b.to ? t.end : b.to
  return from <= to ? { from, to } : null
}

type Measured = { heatKwh: number | null; dhwM3: number | null; dhwKwh: number | null; totalKwh: number | null; gaps: MonthlyInfoGap[] }

// Was die Geräte einer Wohnung zwischen zwei Tagesenden gemessen haben.
function measure(devices: readonly RemoteMeter[], readings: readonly SnapshotReading[], startDay: string, endDay: string, dhw: { effort: number; coldWaterC: number; tempC: number | null }): Measured {
  const gaps = new Set<MonthlyInfoGap>()
  let heat: number | null = null
  let m3: number | null = null
  for (const d of devices) {
    if (d.type === 'hkv') {
      gaps.add('hca')
      continue
    }
    const v = exactConsumption(readings.filter((x) => x.meterId === d.id), startDay, endDay)
    if (v === null) gaps.add('noReading')
    else if (v < 0) gaps.add('negative')
    else if (d.type === 'warmwasser') m3 = (m3 ?? 0) + v
    else heat = (heat ?? 0) + v
  }
  const hasDhw = devices.some((d) => d.type === 'warmwasser')
  let dhwKwh: number | null = null
  if (hasDhw && m3 !== null) {
    if (dhw.tempC === null || !(dhw.tempC > dhw.coldWaterC)) gaps.add('dhwTemp')
    else dhwKwh = dhw.effort * m3 * (dhw.tempC - dhw.coldWaterC)
  }
  const hasHeat = devices.some((d) => d.type === 'waerme')
  const ok = gaps.size === 0 && (!hasHeat || heat !== null) && (!hasDhw || dhwKwh !== null)
  const total = ok ? (heat ?? 0) + (dhwKwh ?? 0) : null
  return { heatKwh: heat, dhwM3: m3, dhwKwh, totalKwh: total, gaps: [...gaps] }
}

// Die Monate einer Heizperiode, für die die Information geschuldet ist: ab dem Beginn der Pflicht
// (`hkv.monthly-info`), in denen am Monatsende ein fernablesbares Gerät der Anlage eingebaut war.
export function monthlyInfoMonths(i: MonthlyInfoInput, log: LawLog): MonthlyInfoMonth[] {
  const startsAt = onlyVersion(hkvMonthlyInfo).validFrom ?? i.h.from
  const all = plantDevices(i.plant, i.meters, i.units).filter((m) => m.unitId !== null && m.unitId !== undefined)
  const formula = law(hkvDhwVolumeFormula, { period: i.h }, log)
  const dhw = { effort: formula.effort, coldWaterC: formula.coldWaterC, tempC: i.dhwTempC }
  const asOfMonth = i.asOf?.slice(0, 7)
  const months: MonthlyInfoMonth[] = []
  for (const month of monthsBetween(i.h.from, i.h.to)) {
    const bounds = monthBounds(month)
    if (bounds.to < startsAt) continue
    const remote = all.some((m) => m.remoteReadable === true && (m.installedOn === null || m.installedOn === undefined || m.installedOn <= bounds.to))
    if (!remote) continue
    const row = i.rows.find((x) => x.month === month) ?? null
    const users: MonthlyInfoUser[] = []
    for (const unit of i.units) {
      const devices = all.filter((m) => m.unitId === unit.id && (m.installedOn === null || m.installedOn === undefined || m.installedOn <= bounds.to))
      if (devices.length === 0) continue
      for (const t of i.tenancies.filter((x) => x.unitId === unit.id)) {
        const slice = sliceOf(t, month)
        if (!slice) continue
        const now = measure(devices, i.readings, dayBefore(slice.from), slice.to, dhw)
        // Vormonat und Vorjahresmonat: nur desselben Mietverhältnisses und nur, soweit erhoben.
        const earlier = (m: string): number | null => {
          const s = sliceOf(t, m)
          return s ? measure(devices, i.readings, dayBefore(s.from), s.to, dhw).totalKwh : null
        }
        const ref = row?.referenceKwhPerM2 ?? null
        const referenceKwh = ref === null ? null : Math.round(ref * unit.areaM2 * (daysOf(slice.from, slice.to) / daysOf(bounds.from, bounds.to)) * 100) / 100
        const gaps = [...now.gaps, ...(referenceKwh === null ? (['reference'] as const) : [])]
        users.push({
          tenancyId: t.id, tenantName: t.tenantName, unitName: unit.name, areaM2: unit.areaM2, from: slice.from, to: slice.to,
          heatKwh: now.heatKwh, dhwM3: now.dhwM3, dhwKwh: now.dhwKwh, totalKwh: now.totalKwh,
          previousMonthKwh: earlier(addMonths(month, -1)), previousYearKwh: earlier(addMonths(month, -12)),
          referenceKwh, gaps,
        })
      }
    }
    months.push({
      month,
      due: asOfMonth === undefined || month < asOfMonth,
      row,
      users,
      complete: users.every((u) => u.gaps.length === 0),
      sent: row?.sentOn !== null && row?.sentOn !== undefined,
    })
  }
  return months
}

export type OpenMonth = { month: string; tenancyIds: string[]; notSent: boolean; gaps: MonthlyInfoGap[] }

// Die fälligen Monate, deren Information fehlt (nicht als mitgeteilt vermerkt) oder unvollständig ist, mit
// den betroffenen Mietverhältnissen. Ein Monat ohne Mieter braucht keine Mitteilung.
export function openMonths(months: readonly MonthlyInfoMonth[]): OpenMonth[] {
  return months
    .filter((m) => m.due && m.users.length > 0 && (!m.sent || !m.complete))
    .map((m) => ({
      month: m.month,
      tenancyIds: [...new Set(m.users.filter((u) => !m.sent || u.gaps.length > 0).map((u) => u.tenancyId))],
      notSent: !m.sent,
      gaps: [...new Set(m.users.flatMap((u) => u.gaps))],
    }))
}
```

Hinweis: `previousMonthKwh` im Test „November“ ist 625 (Oktober: Wärme 400 + Warmwasser 2 m³ · 2,5 · 45 =
225), `previousYearKwh` 575 (November 2024: 350 + 225).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/monthly-info.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/monthlyInfo.ts server/test/monthly-info.test.ts server/test/law-literals.test.ts
git commit -m "Verbrauchsinformation: Rechnung je Monat und Mieter aus Monatsendständen

Nur erhobene Werte, nie interpoliert; Vergleiche nur desselben
Mietverhältnisses; Heizkostenverteiler ergeben keine kWh.

Refs #99"
```

---

### Task 3: Tabelle, Lesen, Schreiben und Routen

**Files:**
- Modify: `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/index.ts`, `server/test/migrations.test.ts`, `server/test/schema.test.ts`, `server/test/api.test.ts`
- Create: `server/drizzle/00xx_verbrauchsinfo.sql` (erzeugt), `server/src/db/monthlyInfo.ts`, `server/test/db-verbrauchsinfo.test.ts`

**Interfaces:**
- Consumes: Task 1, 2; `heatingPlants` (schema.ts), `readStock`, `plantContext`, `heatingPeriodOf`,
  `HeatingError`, `has`, `merged` (PR 4/6/8); `today()` in index.ts.
- Produces:
  - schema.ts `heatingMonthlyInfo` (`heating_monthly_info`).
  - read.ts `readMonthlyInfoRows(db): Promise<MonthlyInfoRow[]>`; `Stock.monthlyInfoRows: MonthlyInfoRow[]`.
  - db/monthlyInfo.ts `saveMonthlyInfoRow(db, plantId, month, body): Promise<MonthlyInfoRow | null>`,
    `monthlyInfoView(db, plantId, periodText, today): Promise<MonthlyInfoView | null>`.
  - Routen `GET /api/heating-plants/:id/periods/:period/monthly-info` → `MonthlyInfoView`,
    `PUT /api/heating-plants/:id/monthly-info/:month` → `MonthlyInfoRow`.

- [ ] **Step 1: Write the failing tests**

`server/test/db-verbrauchsinfo.test.ts`:

```ts
// Monatliche Verbrauchsinformation (Heizung PR 22): Tabelle heating_monthly_info, Bedingungen, Schreiben.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { saveMonthlyInfoRow } from '../src/db/monthlyInfo.ts'
import { HeatingError } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verbrauchsinfo-'))

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

test('Prüfbedingungen: Monat JJJJ-MM, Vergleichswert > 0 nur mit Quelle, Tag als Datum; fällt mit der Anlage', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    if (!migrations.some((m) => m.tag.endsWith('_verbrauchsinfo'))) assert.fail('Schritt …_verbrauchsinfo fehlt')
    applyMigrations(c, migrations)
    c.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')")
    const ins = (month: string, ref: string, source: string, sent: string) =>
      `INSERT INTO heating_monthly_info (plant_id, month, reference_kwh_per_m2, reference_source, sent_on) VALUES ('hp', '${month}', ${ref}, ${source}, ${sent})`
    assert.equal(rejects(c, ins('2025-11', '10', "'Ablesedienst'", "'2025-12-05'")), null)
    assert.equal(rejects(c, ins('2025-10', 'NULL', 'NULL', 'NULL')), null)
    assert.match(rejects(c, ins('2025-13', 'NULL', 'NULL', 'NULL')) ?? '', /heating_monthly_info_month/)
    assert.match(rejects(c, ins('2025-09', '0', "'x'", 'NULL')) ?? '', /heating_monthly_info_reference_positive/)
    assert.match(rejects(c, ins('2025-08', '10', 'NULL', 'NULL')) ?? '', /heating_monthly_info_reference_source/)
    assert.match(rejects(c, ins('2025-07', '10', "'  '", 'NULL')) ?? '', /heating_monthly_info_reference_source/)
    assert.match(rejects(c, ins('2025-06', 'NULL', 'NULL', "'5.12.2025'")) ?? '', /heating_monthly_info_sent_on/)
    assert.ok(rejects(c, ins('2025-11', 'NULL', 'NULL', 'NULL')), 'derselbe Monat zweimal')
    c.exec("DELETE FROM heating_plants WHERE id = 'hp'")
    assert.deepEqual(c.rows('SELECT count(*) FROM heating_monthly_info'), [[0]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: Teilrumpf ergänzt, leert mit null; ohne Anlage null', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'self' }))
    const a = await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel' }))
    assert.deepEqual(a, { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: null })
    const b = await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '2025-12-05' }))
    assert.deepEqual(b, { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' })
    const c = await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: null, referenceSource: null }))
    assert.equal(c?.referenceKwhPerM2, null)
    assert.equal(await opened.write((db) => saveMonthlyInfoRow(db, 'gibt-es-nicht', '2025-11', {})), null)
  })
})

test('Review Focus 5 und Prüfungen: Mitteilung frühestens nach Monatsende; Vergleichswert nur mit Quelle', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'self' }))
    const refused = (text: RegExp) => (e: unknown) => e instanceof HeatingError && e.status === 400 && text.test(e.message)
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '2025-11-30' })), refused(/frühestens am 01\.12\.2025/))
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '05.12.2025' })), refused(/kein Datum/))
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: 10 })), refused(/Quelle/))
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: 0, referenceSource: 'x' })), refused(/größer als 0/))
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-13', {})), refused(/Monat/))
  })
})
```

`server/test/api.test.ts` ans Dateiende (Hilfen `startServer`, `postJson`, `jsonOf`, `send` wie in den
Tests von PR 6 und PR 7):

```ts
test('Monatliche Verbrauchsinformation: Monate einer Heizperiode lesen, Vergleichswert und Mitteilung speichern', async () => {
  const s = await startServer()
  try {
    const send = (p: string, init: RequestInit) => fetch(`${s.base}${p}`, { headers: { 'content-type': 'application/json' }, ...init })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'self' })))
    const view = await jsonOf<MonthlyInfoView>(await send(`/api/heating-plants/${plant.id}/periods/2025-01/monthly-info`, { method: 'GET' }))
    assert.deepEqual([view.plantId, view.period, view.managed, view.elsewhere, view.months], [plant.id, '2025-01', true, false, []])
    const row = await jsonOf<MonthlyInfoRow>(await send(`/api/heating-plants/${plant.id}/monthly-info/2025-11`, { method: 'PUT', body: JSON.stringify({ referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }) }))
    assert.equal(row.sentOn, '2025-12-05')
    assert.equal((await send(`/api/heating-plants/${plant.id}/monthly-info/2025-11`, { method: 'PUT', body: JSON.stringify({ sentOn: '2025-11-02' }) })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/monthly-info', { method: 'GET' })).status, 404)
    assert.equal((await send(`/api/heating-plants/${plant.id}/periods/2025-13/monthly-info`, { method: 'GET' })).status, 400)
  } finally {
    s.stop()
  }
})
```

(`MonthlyInfoRow` und `MonthlyInfoView` zum Typimport aus `'../../shared/types.ts'` ergänzen. Heißt die
Hilfe zum Anlegen des JSON-Rumpfs dort anders, deren Namen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-verbrauchsinfo.test.ts test/api.test.ts`
Expected: FAIL: „Schritt …_verbrauchsinfo fehlt“, `Cannot find module '../src/db/monthlyInfo.ts'`, die Route
antwortet 404.

- [ ] **Step 3: Schema (`server/src/db/schema.ts`)**

Ans Dateiende (`primaryKey`, `check`, `sql`, `real`, `text` sind importiert):

```ts
// ---------- Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV) ----------

// Je Anlage und Monat: Vergleichswert eines Durchschnittsnutzers (kWh je m² Wohnfläche) mit Quelle und der
// Tag der Mitteilung. Fällt mit der Anlage.
export const heatingMonthlyInfo = sqliteTable(
  'heating_monthly_info',
  {
    plantId: text('plant_id').notNull().references(() => heatingPlants.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    referenceKwhPerM2: real('reference_kwh_per_m2'),
    referenceSource: text('reference_source'),
    sentOn: text('sent_on'),
  },
  (t) => [
    primaryKey({ columns: [t.plantId, t.month] }),
    check('heating_monthly_info_month', sql.raw(`"month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("month", 6, 2) AS INTEGER) BETWEEN 1 AND 12`)),
    check('heating_monthly_info_reference_positive', sql.raw('"reference_kwh_per_m2" IS NULL OR "reference_kwh_per_m2" > 0')),
    check('heating_monthly_info_reference_source', sql.raw(`"reference_kwh_per_m2" IS NULL OR length(trim(coalesce("reference_source", ''))) > 0`)),
    check('heating_monthly_info_sent_on', sql.raw(`"sent_on" IS NULL OR "sent_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
  ],
)
```

Run: `npm --prefix server run db:generate -- --name verbrauchsinfo`
Expected: `server/drizzle/00xx_verbrauchsinfo.sql` mit `CREATE TABLE \`heating_monthly_info\`` samt den vier
Bedingungen und dem Fremdschlüssel, **ohne** Neubau einer anderen Tabelle.

Run: `grep -c 'CREATE TABLE' server/drizzle/*_verbrauchsinfo.sql && grep -c '__new_' server/drizzle/*_verbrauchsinfo.sql`
Expected: `1`, dann `0` (der zweite Befehl endet mit Exit-Status 1, weil `grep -c` bei null Treffern 1
liefert; das ist hier das erwartete Ergebnis).

Marken eintragen:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('verbrauchsinfo')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

Expected: eine Zeile. Sie kommt in `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter die Schritte
von PR 21, darüber `// Heizung PR 22 (#99).`

`server/test/schema.test.ts`: Typimport um `MonthlyInfoRow` ergänzen und hinter den Zusicherungen der
Vorgänger:

```ts
type _MonthlyInfo = Assert<Matches<typeof schema.heatingMonthlyInfo.$inferSelect, MonthlyInfoRow>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ `'heating_monthly_info',` in alphabetischer
Reihenfolge ergänzen.

- [ ] **Step 4: Lesen (`server/src/db/read.ts`)**

Typimport um `MonthlyInfoRow` ergänzen, `heatingMonthlyInfo` aus `'./schema.ts'`.

```ts
// Monatliche Verbrauchsinformation (Heizung PR 22), in der Reihenfolge des Anlegens.
export async function readMonthlyInfoRows(db: Executor): Promise<MonthlyInfoRow[]> {
  const rows = await db.select().from(heatingMonthlyInfo).orderBy(sql`rowid`)
  return rows.map((x) => ({ plantId: x.plantId, month: x.month, referenceKwhPerM2: x.referenceKwhPerM2, referenceSource: x.referenceSource, sentOn: x.sentOn }))
}
```

`Stock` um `monthlyInfoRows: MonthlyInfoRow[]` ergänzen und in `readStock` `monthlyInfoRows: await
readMonthlyInfoRows(db),` setzen. (Liest `readStock` mit `Promise.all`, dort einreihen.)

- [ ] **Step 5: Schreiben und Ansicht (`server/src/db/monthlyInfo.ts`)**

```ts
// Monatliche Verbrauchsinformation (Heizung PR 22): Vergleichswert und Tag der Mitteilung je Anlage und
// Monat speichern; die Monate einer Heizperiode für die Seite Heizkosten zusammenstellen.
import { and, eq } from 'drizzle-orm'
import type { MonthlyInfoRow, MonthlyInfoView } from '../../../shared/types.ts'
import { createLawLog, dayAfter, germanDate } from '../../../shared/law/register.ts'
import { monthBounds, monthName } from '../../../shared/monthlyInfo.ts'
import { monthlyInfoMonths } from '../monthlyInfo.ts'
import type { Database, Executor } from './client.ts'
import { heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readStock } from './read.ts'
import { has, HeatingError } from './repository.ts'
import { heatingMonthlyInfo, heatingPlants } from './schema.ts'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

// Ein Teilrumpf ergänzt (wie PUT überall in Mietfuchs), `null` leert. Ohne Anlage null.
export async function saveMonthlyInfoRow(db: Executor, plantId: string, month: string, body: Record<string, unknown>): Promise<MonthlyInfoRow | null> {
  const [plant] = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (!plant) return null
  if (!MONTH.test(month)) throw new HeatingError(400, `„${month}“ ist kein Monat. Bitte laden Sie die Seite neu.`)
  const [current] = await db.select().from(heatingMonthlyInfo).where(and(eq(heatingMonthlyInfo.plantId, plantId), eq(heatingMonthlyInfo.month, month)))
  const next: MonthlyInfoRow = {
    plantId, month,
    referenceKwhPerM2: has(body, 'referenceKwhPerM2') ? (body.referenceKwhPerM2 as number | null) : current?.referenceKwhPerM2 ?? null,
    referenceSource: has(body, 'referenceSource') ? (typeof body.referenceSource === 'string' ? body.referenceSource.trim() || null : null) : current?.referenceSource ?? null,
    sentOn: has(body, 'sentOn') ? (body.sentOn as string | null) : current?.sentOn ?? null,
  }
  const ref = next.referenceKwhPerM2
  if (ref !== null && (typeof ref !== 'number' || !Number.isFinite(ref) || ref <= 0)) {
    throw new HeatingError(400, 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche im Monat).')
  }
  if (ref !== null && next.referenceSource === null) {
    throw new HeatingError(400, 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.')
  }
  if (next.sentOn !== null) {
    if (typeof next.sentOn !== 'string' || !DAY.test(next.sentOn)) throw new HeatingError(400, 'Der Tag der Mitteilung ist kein Datum. Bitte wählen Sie ihn im Kalender.')
    const earliest = dayAfter(monthBounds(month).to)
    if (next.sentOn < earliest) {
      throw new HeatingError(400, `Die Information für ${monthName(month)} nennt den Verbrauch des ganzen Monats und kann frühestens am ${germanDate(earliest)} mitgeteilt werden.`)
    }
  }
  if (current) {
    await db.update(heatingMonthlyInfo).set({ referenceKwhPerM2: next.referenceKwhPerM2, referenceSource: next.referenceSource, sentOn: next.sentOn })
      .where(and(eq(heatingMonthlyInfo.plantId, plantId), eq(heatingMonthlyInfo.month, month)))
  } else {
    await db.insert(heatingMonthlyInfo).values(next)
  }
  return next
}

// Die Monate einer Heizperiode mit den Informationen je Mieter. Null ohne Anlage; ein unbekannter Schlüssel
// ergibt 400 (heatingPeriodOf).
export async function monthlyInfoView(db: Database, plantId: string, periodText: string, today: string): Promise<MonthlyInfoView | null> {
  const stock = await readStock(db)
  const plant = stock.heatingPlants.find((p) => p.id === plantId)
  const ctx = plant ? await plantContext(db, plant.id) : null
  if (!plant || !ctx) return null
  const h = heatingPeriodOf(ctx, periodText)
  const units = stock.units.filter((u) => u.propertyId === plant.propertyId)
  const unitIds = new Set(units.map((u) => u.id))
  const meters = stock.meters.filter((m) => m.propertyId === plant.propertyId)
  const meterIds = new Set(meters.map((m) => m.id))
  const row = stock.heatingPeriodRows.find((r) => r.plantId === plant.id && r.period === h.key) ?? null
  const managed = plant.method === 'self'
  const months = managed
    ? monthlyInfoMonths({
        plant, meters, units,
        tenancies: stock.tenancies.filter((t) => unitIds.has(t.unitId)),
        readings: stock.readings.filter((r) => meterIds.has(r.meterId)),
        rows: stock.monthlyInfoRows.filter((r) => r.plantId === plant.id),
        dhwTempC: row?.dhwTempC ?? null,
        h: { from: h.from, to: h.to },
        asOf: today,
      }, createLawLog())
    : []
  return { plantId: plant.id, period: h.key, managed, elsewhere: plant.monthlyInfoElsewhere === true, months }
}
```

Hinweis zu den Zusicherungen im Merge: `body.referenceKwhPerM2 as number | null` reicht den Rohwert an die
Prüfung zwei Zeilen tiefer weiter; ein String oder `NaN` wird dort abgelehnt, bevor geschrieben wird.

- [ ] **Step 6: Routen (`server/src/index.ts`)**

Import: `import { monthlyInfoView, saveMonthlyInfoRow } from './db/monthlyInfo.ts'`. Hinter dem Block der
Pflichtangaben (PR 14):

```ts
// ---------- Monatliche Verbrauchsinformation (Heizung PR 22) ----------
app.get('/api/heating-plants/:id/periods/:period/monthly-info', async (req, res) => {
  const view = await readData((db) => monthlyInfoView(db, req.params.id, req.params.period, today()))
  if (!view) return res.status(404).json({ error: NO_PLANT })
  res.json(view)
})
app.put('/api/heating-plants/:id/monthly-info/:month', async (req, res) => {
  const saved = await writeData((db) => saveMonthlyInfoRow(db, req.params.id, req.params.month, bodyObject(req)))
  if (!saved) return res.status(404).json({ error: NO_PLANT })
  res.json(saved)
})
```

(`HeatingError` wird von der Fehlerbehandlung in index.ts schon als 400 mit Satz beantwortet, seit PR 4.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-verbrauchsinfo.test.ts test/api.test.ts test/migrations.test.ts test/schema.test.ts test/db-golden.test.ts test/db-changeover.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/schema.ts server/drizzle server/src/db/read.ts server/src/db/monthlyInfo.ts server/src/index.ts server/test/db-verbrauchsinfo.test.ts server/test/migrations.test.ts server/test/schema.test.ts server/test/api.test.ts
git commit -m "Verbrauchsinformation: Tabelle heating_monthly_info, Routen und Ansicht je Heizperiode

Vergleichswert nur mit Quelle, Mitteilung frühestens nach Monatsende.

Refs #99"
```

---

### Task 4: Hinweis `heating.monthly-info` aus den Monaten

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`, `server/test/calc-pflichtangaben.test.ts` (PR 14)
- Create: `server/test/calc-verbrauchsinfo.test.ts`

**Interfaces:**
- Consumes: Task 1–3; im Block von PR 14 die Größen aus „Schnittstellen“; `selfSnapshot()` (PR 13).
- Produces: `Snapshot.monthlyInfoRows?: MonthlyInfoRow[]`; `noticeKinds['heating.monthly-info'].terms`
  um `'monthlyConsumptionInfo'` ergänzt; neuer Text des Hinweises.

- [ ] **Step 1: Write the failing tests**

`server/test/calc-verbrauchsinfo.test.ts`:

```ts
// Monatliche Verbrauchsinformation in der Abrechnung (Heizung PR 22): Bei eigener Abrechnung mit
// fernablesbaren Zählern nennt `heating.monthly-info` die Monate, die fehlen oder unvollständig sind, und je
// betroffenem Mieter 3 % (§ 12 Abs. 1 Satz 3 HeizkostenV). Kein Betrag wird abgezogen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'
import { addMonths, monthBounds } from '../../shared/monthlyInfo.ts'

const fern = (s: Snapshot): Snapshot => ({ ...s, meters: s.meters.map((m) => (m.unitId !== null ? { ...m, remoteReadable: true, installedOn: null } : m)) })
const notice = (s: Snapshot, asOf = '2026-02-15') => computeSettlement(s, { asOf }).notices.find((n) => n.code === 'heating.monthly-info')

// Monatsendstände für jeden Wohnungszähler: linear zwischen den beiden benachbarten vorhandenen Ablesungen,
// an Tagen, an denen noch keine liegt, nie über einen Zählerwechsel hinweg. So bleiben die Stände an den
// Grenzen der Heizperiode und am Wechsel, mit denen die Abrechnung rechnet, unberührt.
function mitMonatsstaenden(s: Snapshot): Snapshot {
  const added: SnapshotReading[] = []
  for (const m of s.meters.filter((x) => x.unitId !== null)) {
    const own = s.readings.filter((r) => r.meterId === m.id).sort((a, b) => (a.date < b.date ? -1 : 1))
    const first = own[0]
    const last = own.at(-1)
    if (!first || !last) continue
    for (let month = first.date.slice(0, 7); month <= last.date.slice(0, 7); month = addMonths(month, 1)) {
      const end = monthBounds(month).to
      if (own.some((r) => r.date === end)) continue
      const prev = own.filter((r) => r.date < end).at(-1)
      const next = own.find((r) => r.date > end)
      if (!prev || !next || next.replacement === true) continue
      const share = (Date.parse(end) - Date.parse(prev.date)) / (Date.parse(next.date) - Date.parse(prev.date))
      added.push({ meterId: m.id, date: end, value: Math.round((prev.value + share * (next.value - prev.value)) * 1000) / 1000 })
    }
  }
  return { ...s, readings: [...s.readings, ...added] }
}

const alleMonate = (s: Snapshot, sentOn = true): Snapshot => {
  const plantId = s.heatingPlants?.[0]?.id ?? assert.fail('keine Anlage')
  return {
    ...s,
    heatingPeriodRows: (s.heatingPeriodRows ?? []).map((r) => ({ ...r, dhwTempC: 55 })),
    monthlyInfoRows: Array.from({ length: 12 }, (_, k) => {
      const month = `2025-${String(k + 1).padStart(2, '0')}`
      return { plantId, month, referenceKwhPerM2: 8, referenceSource: 'Vergleichsdaten des Ablesedienstes', sentOn: sentOn ? `${addMonths(month, 1)}-05` : null }
    }),
  }
}

test('Ohne fernablesbaren Zähler kein Hinweis', () => {
  assert.equal(notice(selfSnapshot()), undefined)
})

test('Fernablesbar, nichts erstellt: Warnung mit allen Monaten, je Mieter 3 %', () => {
  const n = notice(fern(selfSnapshot())) ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /seit dem 01\.01\.2022 jeden Monat eine Verbrauchsinformation zu \(§ 6a Abs\. 1 und 2 HeizkostenV\)/)
  assert.match(n.text, /Nicht als mitgeteilt vermerkt: Januar bis Dezember 2025/)
  assert.match(n.text, /darf jeder betroffene Mieter seinen Anteil an den Heizkosten um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\)/)
  assert.doesNotMatch(n.text, /bis zu 3 %/)
  assert.match(n.text, /Monatliche Verbrauchsinformation/)
  assert.match(n.text, /jeden Monat einer Nachricht/)
})

test('Alle Monate vollständig und mitgeteilt: kein Hinweis; ein Monat ohne Mitteilung: genau dieser', () => {
  const voll = alleMonate(mitMonatsstaenden(fern(selfSnapshot())))
  assert.equal(notice(voll), undefined)
  const rows = (voll.monthlyInfoRows ?? []).map((r) => (r.month === '2025-03' ? { ...r, sentOn: null } : r))
  const n = notice({ ...voll, monthlyInfoRows: rows }) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Nicht als mitgeteilt vermerkt: März 2025\./)
  assert.doesNotMatch(n.text, /Unvollständig/)
})

test('Ohne Vergleichswert unvollständig, mit Grund', () => {
  const voll = alleMonate(mitMonatsstaenden(fern(selfSnapshot())))
  const rows = (voll.monthlyInfoRows ?? []).map((r) => (r.month === '2025-07' ? { ...r, referenceKwhPerM2: null, referenceSource: null } : r))
  const n = notice({ ...voll, monthlyInfoRows: rows }) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Unvollständig: Juli 2025 \(Vergleich mit einem Durchschnittsnutzer fehlt\)/)
})

test('Bestätigt „anders mitgeteilt“: kein Hinweis; Monate nach asOf nicht fällig', () => {
  const s = fern(selfSnapshot())
  const anders: Snapshot = { ...s, heatingPlants: (s.heatingPlants ?? []).map((p) => ({ ...p, monthlyInfoElsewhere: true })) }
  assert.equal(notice(anders), undefined)
  const frueh = notice(s, '2025-03-10') ?? assert.fail('kein Hinweis')
  assert.match(frueh.text, /Nicht als mitgeteilt vermerkt: Januar bis Februar 2025\./)
})

test('Keine Zahl ändert sich durch die Information', () => {
  const s = fern(selfSnapshot())
  const ohne = computeSettlement(s, { asOf: '2026-02-15' })
  const mit = computeSettlement(alleMonate(mitMonatsstaenden(s)), { asOf: '2026-02-15' })
  // Monatsendstände verändern die Verteilung nicht: Die Stände an den Grenzen der Heizperiode und am Wechsel
  // von C liegen schon vor, und dazwischen liegen die neuen auf der Geraden.
  assert.deepEqual(mit.statements.map((x) => x.balanceCents), ohne.statements.map((x) => x.balanceCents))
})
```

In `server/test/calc-pflichtangaben.test.ts` (PR 14) den Test „Monatliche Information: bei fernablesbarem
Zähler eine Warnung „bis zu 3 %“, nicht mit Bestätigung“ umbenennen in „Monatliche Information: bei
fernablesbarem Zähler eine Warnung, nicht mit Bestätigung“ und die Zeile

```ts
  assert.match(n.text, /monatliche Verbrauchsinformationen.*seit dem 01\.01\.2022.*bis zu 3 %.*Portal des Messdienstes/s)
```

ersetzen durch

```ts
  // Seit Heizung PR 22 erstellt Mietfuchs die Information bei eigener Abrechnung selbst; der Text nennt die
  // fehlenden Monate und 3 % (Plan PR 22, Abweichung 8).
  assert.match(n.text, /jeden Monat eine Verbrauchsinformation.*seit dem 01\.01\.2022|seit dem 01\.01\.2022 jeden Monat eine Verbrauchsinformation/s)
  assert.match(n.text, /um 3 % kürzen.*Portal/s)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-verbrauchsinfo.test.ts test/calc-pflichtangaben.test.ts`
Expected: FAIL: Der Text von PR 14 enthält „Nicht als mitgeteilt vermerkt“ nicht; `monthlyInfoRows` ist im
Typ `Snapshot` unbekannt (Übersetzer).

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

Typimport um `MonthlyInfoRow` ergänzen. In `Snapshot`:

```ts
  // Monatliche Verbrauchsinformation (Heizung PR 22): die Zeilen der Anlagen dieses Objekts.
  monthlyInfoRows?: MonthlyInfoRow[]
```

In `snapshotFor` (dort, wo die Zeilen der Heizperioden je Anlage des Objekts eingegrenzt werden):

```ts
    monthlyInfoRows: (stock.monthlyInfoRows ?? []).filter((r) => plantIds.has(r.plantId)),
```

(`plantIds` ist die Menge der Anlagen des Objekts, die snapshotFor seit PR 4 bildet; heißt sie anders,
deren Namen.) Pickt `SnapshotHeatingPeriodRow` `dhwTempC` noch nicht (Annahme B2), dort ergänzen.
`snapshotOf` (Umstieg, Regression) setzt das Feld nicht.

- [ ] **Step 4: Hinweis (`server/src/calc.ts`)**

Importe: `import { monthlyInfoMonths, openMonths } from './monthlyInfo.ts'`,
`import { monthRanges } from '../../shared/monthlyInfo.ts'`, `import type { MonthlyInfoGap } from '../../shared/types.ts'`
(in den bestehenden Typimport einreihen).

In `noticeKinds` den Eintrag `'heating.monthly-info'` (PR 14) um den Begriff ergänzen:

```ts
  'heating.monthly-info': { level: 'warning', title: 'Monatliche Verbrauchsinformation', rule: 'heating-info', terms: ['billingInfo', 'monthlyConsumptionInfo'] },
```

Im Block von PR 14 (`for (const pot of co2Pots)`, Abschnitt „Monatliche Verbrauchsinformation“) den Teil von
`const spOfPlant = …` bis einschließlich des `warn('heating.monthly-info', …)` und seiner schließenden `}`
ersetzen durch:

```ts
    // Monatliche Verbrauchsinformation (§ 6a Abs. 1, 2; Entwurf 8.8, 13 PR 22). Bei eigener Abrechnung kennt
    // Mietfuchs die Geräte und erstellt die Information selbst: Der Hinweis nennt die Monate, die fehlen oder
    // unvollständig sind, und je betroffenem Mieter 3 % (Plan PR 22, Abweichung 8). Bei Messdienst und freien
    // Schlüsseln bleibt es beim Hinweis „bis zu“, bis der Vermieter bestätigt, dass die Mieter sie anders
    // mitgeteilt bekommen.
    const spOfPlant = selfPlans.get(plant.id)
    const GAP_TEXT: Record<MonthlyInfoGap, string> = {
      noReading: 'Ablesung am Monatsende fehlt',
      negative: 'negativer Verbrauch',
      hca: 'Heizkostenverteiler zeigen keine Kilowattstunden',
      dhwTemp: 'Warmwassertemperatur für die Umrechnung in kWh fehlt',
      reference: 'Vergleich mit einem Durchschnittsnutzer fehlt',
    }
    if (plant.monthlyInfoElsewhere !== true && spOfPlant) {
      const months = monthlyInfoMonths({
        plant,
        meters: snapshot.meters,
        units: snapshot.units,
        tenancies: snapshot.tenancies,
        readings: snapshot.readings,
        rows: (snapshot.monthlyInfoRows ?? []).filter((r) => r.plantId === plant.id),
        dhwTempC: (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === plant.id && r.period === pot.period.key)?.dhwTempC ?? null,
        h: hPeriod,
        asOf: options.asOf,
      }, lawLog)
      const open = openMonths(months)
      if (open.length > 0) {
        const monthly = law(hkvMonthlyInfo, { period: hPeriod }, lawLog)
        const cut = law(hkvCutInformation, { period: hPeriod }, lawLog)
        const notSent = open.filter((o) => o.notSent).map((o) => o.month)
        const incomplete = open.filter((o) => o.gaps.length > 0)
        const affected = [...new Set(open.flatMap((o) => o.tenancyIds))]
        const amounts = affected.flatMap((id) => {
          const c = cutOf(id, ids, cut)
          return c === null ? [] : [`${nameOf(id)} ${fmtCents(c)}`]
        })
        warn('heating.monthly-info',
          `${where}: Ihre Zähler sind fernablesbar; den Mietern steht seit dem ${fmtDay(monthly.validFrom ?? '')} jeden Monat eine Verbrauchsinformation zu (§ 6a Abs. 1 und 2 HeizkostenV): ihr Verbrauch des Monats in Kilowattstunden, der Vergleich mit dem Vormonat und dem Vorjahresmonat und mit einem Durchschnittsnutzer. ` +
            (notSent.length > 0 ? `Nicht als mitgeteilt vermerkt: ${monthRanges(notSent)}. ` : '') +
            (incomplete.length > 0 ? `Unvollständig: ${incomplete.map((o) => `${monthRanges([o.month])} (${o.gaps.map((g) => GAP_TEXT[g]).join(', ')})`).join('; ')}. ` : '') +
            `Fehlt die Information oder ist sie unvollständig, darf jeder betroffene Mieter seinen Anteil an den Heizkosten um ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${amounts.length > 0 ? `: ${andList(amounts)}` : ''}. ` +
            'Mietfuchs erstellt die Information auf der Seite Heizkosten unter „Monatliche Verbrauchsinformation“; zukommen lassen müssen Sie sie den Mietern selbst, als Brief oder E-Mail. ' +
            'Bekommen Ihre Mieter sie anders, etwa im Portal des Messdienstes mit jeden Monat einer Nachricht, dass sie dort steht, bestätigen Sie das unter Stammdaten bei der Heizung.',
          subject)
      }
    } else if (plant.monthlyInfoElsewhere !== true) {
      // Bei Messdienst und freien Schlüsseln kennt Mietfuchs die Geräte nicht und erstellt die Information
      // nicht; wie bisher „bis zu“, solange offen ist, ob die Geräte fernablesbar sind.
      const remote = (plant.devicesRemote ?? 'unknown') !== 'none'
      const monthly = remote ? law(hkvMonthlyInfo, { period: hPeriod }, lawLog) : null
      if (monthly && monthly.coverage !== 'none') {
        const cut = law(hkvCutInformation, { period: hPeriod }, lawLog)
        const unknown = (plant.devicesRemote ?? 'unknown') === 'unknown'
        warn('heating.monthly-info',
          `${where}: ${unknown ? 'Ob Zähler und Heizkostenverteiler fernablesbar sind, ist an der Anlage nicht angegeben. ' : ''}Sind sie fernablesbar, stehen den Mietern seit dem ${fmtDay(monthly.validFrom ?? '')} monatliche Verbrauchsinformationen zu: der Verbrauch des letzten Monats in Kilowattstunden, der Vergleich mit dem Vormonat und dem Vorjahresmonat und mit einem Durchschnittsnutzer (§ 6a Abs. 1 und 2 HeizkostenV). ` +
            `Fehlen sie, darf jeder Mieter seinen Anteil an den Heizkosten um bis zu ${cut} % kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV)${cutsOn(ids, cut)}. ` +
            'Erstellen kann Mietfuchs sie nur bei einer eigenen Heizkostenabrechnung; beim Messdienst erstellt sie dieser. Bekommen Ihre Mieter sie, etwa im Portal des Messdienstes mit jeden Monat einer Nachricht, dass sie dort steht, bestätigen Sie das unter Stammdaten bei der Heizung.',
          subject)
      }
    }
```

(`hkvMonthlyInfo`, `hkvCutInformation`, `fmtDay`, `cutOf`, `nameOf`, `fmtCents`, `andList`, `cutsOn`, `where`,
`subject`, `ids`, `hPeriod`, `lawLog`, `options` stehen seit PR 10/14 in diesem Gültigkeitsbereich, Annahme
B3. Benutzt der Block von PR 14 `servedIds` nur für die Bedingung oben, entfällt die Zeile mit ihm.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-verbrauchsinfo.test.ts test/calc-pflichtangaben.test.ts test/law-literals.test.ts test/glossary.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Golden und Invarianten**

Run: `npm --prefix server test -- test/settlement-golden.test.ts test/heating-golden.test.ts test/calc.test.ts test/db-golden.test.ts`
Expected: PASS ohne Änderung an einem `expected.json`. Ändert sich dort der Text von `heating.monthly-info`
(eine Anlage mit Messdienst oder freien Schlüsseln, deren `devices_remote` nicht `none` ist), ist das der neue
letzte Satz aus Step 4: Dann die betroffenen `expected.json` mit dem neuen Satz aktualisieren und im README des
Fixtures den Grund nennen („Heizung PR 22: Satz zur Erstellung und zum Mitteilen im Portal, keine Zahl
geändert“). Keine Zahl darf sich ändern.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/snapshot.ts server/src/calc.ts server/test/calc-verbrauchsinfo.test.ts server/test/calc-pflichtangaben.test.ts server/test/fixtures
git commit -m "Verbrauchsinformation: heating.monthly-info nennt fehlende und unvollständige Monate

Bei eigener Abrechnung mit fernablesbaren Zählern je betroffenem Mieter
3 % nach § 12 Abs. 1 Satz 3 HeizkostenV; Portal nur mit Nachricht jeden
Monat (BR-Drs. 643/21). Keine Zahl ändert sich.

Refs #99"
```

---

### Task 5: Karte, Blatt und Druck

**Files:**
- Create: `client/src/monthlyInfoForm.ts`, `client/src/components/MonthlyInfoCard.tsx`, `client/src/components/MonthlyInfoSheet.tsx`
- Modify: `client/src/pages/Heizkosten.tsx`, `client/src/heatingRulesForm.ts`, `client/src/components/HeatingRulesFields.tsx`, `client/src/index.css`
- Test: `client/src/monthlyInfoForm.test.ts` (neu), `client/src/components/MonthlyInfoCard.test.tsx` (neu), `client/src/heatingRulesForm.test.ts`

**Interfaces:**
- Consumes: Task 1, 3 (`MonthlyInfoView`, `MonthlyInfoMonth`, `MonthlyInfoUser`, `MonthlyInfoRow`, Routen);
  `monthName`, `monthRanges` (shared/monthlyInfo.ts); `api`, `errorText`, `fmtDate` (api.ts); `parseDecimal`
  (co2Form.ts, PR 6); `useToast`, `Term`.
- Produces:
  - `monthlyInfoForm.ts`: `type MonthlyRowForm = { reference: string; source: string; sentOn: string }`,
    `rowToForm(row: MonthlyInfoRow | null): MonthlyRowForm`,
    `rowBody(form: MonthlyRowForm): { body: { referenceKwhPerM2: number | null; referenceSource: string | null; sentOn: string | null } } | { error: string }`,
    `monthStatus(m: MonthlyInfoMonth): { text: string; tone: 'ok' | 'open' | 'warn' | 'none' }`,
    `gapText(g: MonthlyInfoGap): string`, `sheetLines(m: MonthlyInfoMonth, u: MonthlyInfoUser): string[]`.
  - `heatingRulesForm.ts`: `MONTHLY_ELSEWHERE_LABEL: string`.
  - Komponenten `MonthlyInfoCard`, `MonthlyInfoSheet`.

- [ ] **Step 1: Write the failing tests**

`client/src/monthlyInfoForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { gapText, monthStatus, rowBody, rowToForm, sheetLines } from './monthlyInfoForm'
import type { MonthlyInfoMonth, MonthlyInfoUser } from './types'

const user: MonthlyInfoUser = {
  tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30',
  heatKwh: 700, dhwM3: 2.5, dhwKwh: 281.25, totalKwh: 981.25, previousMonthKwh: 625, previousYearKwh: 575, referenceKwh: 600, gaps: [],
}
const nov: MonthlyInfoMonth = {
  month: '2025-11', due: true, complete: true, sent: true, users: [user],
  row: { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' },
}

test('Zeile ins Formular und zurück; leer ist null; Fehler mit einem Satz', () => {
  const form = rowToForm(nov.row)
  expect(form).toEqual({ reference: '10', source: 'Ablesedienst Beispiel', sentOn: '2025-12-05' })
  expect(rowBody(form)).toEqual({ body: { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' } })
  expect(rowBody({ reference: '', source: '', sentOn: '' })).toEqual({ body: { referenceKwhPerM2: null, referenceSource: null, sentOn: null } })
  expect(rowBody({ reference: '12,5', source: '', sentOn: '' })).toEqual({ error: 'Bitte nennen Sie die Quelle des Vergleichswerts.' })
  expect(rowBody({ reference: 'viel', source: 'x', sentOn: '' })).toEqual({ error: 'Der Vergleichswert ist eine Zahl größer als 0.' })
})

test('Status eines Monats', () => {
  expect(monthStatus(nov)).toEqual({ text: 'mitgeteilt am 05.12.2025', tone: 'ok' })
  expect(monthStatus({ ...nov, sent: false, row: null })).toEqual({ text: 'noch nicht mitgeteilt', tone: 'open' })
  expect(monthStatus({ ...nov, complete: false, users: [{ ...user, gaps: ['reference'] }] })).toEqual({ text: 'unvollständig: Vergleich mit einem Durchschnittsnutzer fehlt', tone: 'warn' })
  expect(monthStatus({ ...nov, due: false })).toEqual({ text: 'noch nicht fällig', tone: 'none' })
  expect(monthStatus({ ...nov, users: [] })).toEqual({ text: 'kein Mieter in diesem Monat', tone: 'none' })
  expect(gapText('hca')).toBe('Heizkostenverteiler zeigen keine Kilowattstunden; die Information erstellt Ihr Ablesedienst')
})

test('Blatt: Verbrauch, Warmwasser mit Formel, Vergleiche, Durchschnittsnutzer mit Quelle', () => {
  expect(sheetLines(nov, user)).toEqual([
    'Ihr Verbrauch im November 2025: 981 kWh',
    'davon Heizung 700 kWh und Warmwasser 281 kWh (2,5 m³, umgerechnet nach § 9 Abs. 2 Satz 2 HeizkostenV)',
    'Oktober 2025: 625 kWh',
    'November 2024: 575 kWh',
    'Ein Durchschnittsnutzer mit 60 m² Wohnfläche: 600 kWh (Quelle: Ablesedienst Beispiel)',
  ])
  expect(sheetLines(nov, { ...user, previousMonthKwh: null, previousYearKwh: null, dhwM3: null, dhwKwh: null, heatKwh: 981.25 })).toEqual([
    'Ihr Verbrauch im November 2025: 981 kWh',
    'davon Heizung 981 kWh',
    'Oktober 2025: nicht erhoben',
    'November 2024: nicht erhoben',
    'Ein Durchschnittsnutzer mit 60 m² Wohnfläche: 600 kWh (Quelle: Ablesedienst Beispiel)',
  ])
})
```

`client/src/components/MonthlyInfoCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „Monatliche Verbrauchsinformation“ (Heizung PR 22): lädt die Monate, speichert Vergleichswert und
// Mitteilung je Monat.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MonthlyInfoCard from './MonthlyInfoCard'
import type { MonthlyInfoView } from '../types'
import { periodKey } from '../../../shared/period.ts'

const view: MonthlyInfoView = {
  plantId: 'hp', period: periodKey('2025-01'), managed: true, elsewhere: false,
  months: [{
    month: '2025-11', due: true, complete: false, sent: false, row: null,
    users: [{ tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30', heatKwh: 700, dhwM3: null, dhwKwh: null, totalKwh: 700, previousMonthKwh: null, previousYearKwh: null, referenceKwh: null, gaps: ['reference'] }],
  }],
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    const data = (init?.method ?? 'GET') === 'GET' ? view : { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Monat mit Status; Speichern schickt Vergleichswert, Quelle und Tag', async () => {
  render(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  expect(await screen.findByText('November 2025')).toBeTruthy()
  expect(screen.getByText(/unvollständig: Vergleich mit einem Durchschnittsnutzer fehlt/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Vergleichswert November 2025 (kWh je m²)'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Quelle November 2025'), { target: { value: 'Ablesedienst' } })
  fireEvent.change(screen.getByLabelText('Mitgeteilt am November 2025'), { target: { value: '2025-12-05' } })
  fireEvent.click(screen.getByText('Speichern', { selector: 'button' }))
  await waitFor(() => expect(sent.find((x) => x.method === 'PUT')).toEqual({
    url: '/api/heating-plants/hp/monthly-info/2025-11', method: 'PUT', body: { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' },
  }))
})
```

`client/src/heatingRulesForm.test.ts` anhängen (Import um `MONTHLY_ELSEWHERE_LABEL` ergänzen):

```ts
test('Review Focus 2: Portal zählt nur mit einer Nachricht jeden Monat (BR-Drs. 643/21)', () => {
  expect(MONTHLY_ELSEWHERE_LABEL).toMatch(/jeden Monat.*Nachricht/)
  expect(MONTHLY_ELSEWHERE_LABEL).toMatch(/§ 6a Abs\. 1 HeizkostenV/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- monthlyInfoForm MonthlyInfoCard heatingRulesForm`
Expected: FAIL: Module und Export fehlen.

- [ ] **Step 3: Logik (`client/src/monthlyInfoForm.ts`)**

```ts
// Die Karte „Monatliche Verbrauchsinformation“ der Seite Heizkosten und das Blatt je Mieter (Heizung PR 22),
// ohne DOM. Die Komponenten rendern nur.
import { fmtDate } from './api'
import { parseDecimal } from './co2Form'
import { addMonths, monthName } from '../../shared/monthlyInfo.ts'
import type { MonthlyInfoGap, MonthlyInfoMonth, MonthlyInfoRow, MonthlyInfoUser } from './types'

export type MonthlyRowForm = { reference: string; source: string; sentOn: string }

const kwh = (n: number): string => `${Math.round(n).toLocaleString('de-DE')} kWh`

export function rowToForm(row: MonthlyInfoRow | null): MonthlyRowForm {
  return {
    reference: row?.referenceKwhPerM2 == null ? '' : row.referenceKwhPerM2.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }),
    source: row?.referenceSource ?? '',
    sentOn: row?.sentOn ?? '',
  }
}

export function rowBody(form: MonthlyRowForm): { body: { referenceKwhPerM2: number | null; referenceSource: string | null; sentOn: string | null } } | { error: string } {
  const text = form.reference.trim()
  const ref = text === '' ? null : parseDecimal(text)
  if (text !== '' && (ref === null || !(ref > 0))) return { error: 'Der Vergleichswert ist eine Zahl größer als 0.' }
  const source = form.source.trim() || null
  if (ref !== null && source === null) return { error: 'Bitte nennen Sie die Quelle des Vergleichswerts.' }
  return { body: { referenceKwhPerM2: ref, referenceSource: source, sentOn: form.sentOn || null } }
}

const GAPS: Record<MonthlyInfoGap, string> = {
  noReading: 'Ablesung am Monatsende fehlt',
  negative: 'negativer Verbrauch, bitte die Ablesungen prüfen',
  hca: 'Heizkostenverteiler zeigen keine Kilowattstunden; die Information erstellt Ihr Ablesedienst',
  dhwTemp: 'Warmwassertemperatur fehlt (Seite Heizkosten, Karte Warmwasser)',
  reference: 'Vergleich mit einem Durchschnittsnutzer fehlt',
}
export const gapText = (g: MonthlyInfoGap): string => GAPS[g]

export function monthStatus(m: MonthlyInfoMonth): { text: string; tone: 'ok' | 'open' | 'warn' | 'none' } {
  if (!m.due) return { text: 'noch nicht fällig', tone: 'none' }
  if (m.users.length === 0) return { text: 'kein Mieter in diesem Monat', tone: 'none' }
  if (!m.complete) {
    const gaps = [...new Set(m.users.flatMap((u) => u.gaps))]
    return { text: `unvollständig: ${gaps.map(gapText).join(', ')}`, tone: 'warn' }
  }
  if (!m.sent || !m.row?.sentOn) return { text: 'noch nicht mitgeteilt', tone: 'open' }
  return { text: `mitgeteilt am ${fmtDate(m.row.sentOn)}`, tone: 'ok' }
}

// Die Zeilen des Blatts eines Mieters (§ 6a Abs. 2 Nr. 1 bis 3). Es nennt keinen anderen Nutzer.
export function sheetLines(m: MonthlyInfoMonth, u: MonthlyInfoUser): string[] {
  const lines = [`Ihr Verbrauch im ${monthName(m.month)}: ${u.totalKwh === null ? 'nicht vollständig erhoben' : kwh(u.totalKwh)}`]
  const parts: string[] = []
  if (u.heatKwh !== null) parts.push(`Heizung ${kwh(u.heatKwh)}`)
  if (u.dhwKwh !== null && u.dhwM3 !== null) {
    parts.push(`Warmwasser ${kwh(u.dhwKwh)} (${u.dhwM3.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m³, umgerechnet nach § 9 Abs. 2 Satz 2 HeizkostenV)`)
  }
  if (parts.length > 0) lines.push(`davon ${parts.join(' und ')}`)
  lines.push(`${monthName(addMonths(m.month, -1))}: ${u.previousMonthKwh === null ? 'nicht erhoben' : kwh(u.previousMonthKwh)}`)
  lines.push(`${monthName(addMonths(m.month, -12))}: ${u.previousYearKwh === null ? 'nicht erhoben' : kwh(u.previousYearKwh)}`)
  if (u.referenceKwh !== null && m.row?.referenceSource) {
    lines.push(`Ein Durchschnittsnutzer mit ${u.areaM2.toLocaleString('de-DE')} m² Wohnfläche: ${kwh(u.referenceKwh)} (Quelle: ${m.row.referenceSource})`)
  }
  return lines
}
```

Ist `fmtDate('2025-12-05')` in api.ts nicht „05.12.2025“, im Test den Rückgabewert von `fmtDate` verwenden
statt der festen Zeichenkette.

- [ ] **Step 4: Satz an der Bestätigung (`client/src/heatingRulesForm.ts`, `HeatingRulesFields.tsx`)**

`heatingRulesForm.ts` anhängen:

```ts
// Heizung PR 22: „Mitteilen“ heißt, die Information erreicht den Mieter; in einem Portal oder einer App nur,
// wenn er in jedem Monat eine Nachricht bekommt, dass sie dort steht (BR-Drs. 643/21, S. 18 f.).
export const MONTHLY_ELSEWHERE_LABEL =
  'Die Mieter bekommen die monatliche Verbrauchsinformation anders mitgeteilt, etwa vom Messdienst als Brief oder E-Mail oder in einem Portal mit jeden Monat einer Nachricht, dass sie dort steht (§ 6a Abs. 1 HeizkostenV)'
```

In `HeatingRulesFields.tsx` (PR 14) den Text am Kontrollkästchen `monthlyInfoElsewhere` durch
`{MONTHLY_ELSEWHERE_LABEL}` ersetzen (Import aus `'../heatingRulesForm'`).

- [ ] **Step 5: Komponenten**

`client/src/components/MonthlyInfoSheet.tsx`:

```tsx
// Das Blatt „Ihre Verbrauchsinformation“ eines Mieters für einen Monat (Heizung PR 22). Gedruckt wird nur
// dieses Blatt (index.css, `print-monthly-info`).
import type { MonthlyInfoMonth } from '../types'
import { sheetLines } from '../monthlyInfoForm'
import { monthName } from '../../../shared/monthlyInfo.ts'

export default function MonthlyInfoSheet({ month, propertyName }: { month: MonthlyInfoMonth; propertyName: string }) {
  return (
    <div className="monthly-info-print">
      {month.users.map((u) => (
        <section key={u.tenancyId} className="monthly-info-page">
          <h2>Ihre Verbrauchsinformation für {monthName(month.month)}</h2>
          <p>{u.tenantName} · {propertyName} · {u.unitName}</p>
          <ul>{sheetLines(month, u).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="muted">Nach § 6a Abs. 1 und 2 HeizkostenV, weil die Zähler in Ihrer Wohnung aus der Ferne ablesbar sind. Die Zahlen beruhen auf den Zählerständen am Monatsende.</p>
        </section>
      ))}
    </div>
  )
}
```

`client/src/components/MonthlyInfoCard.tsx`:

```tsx
// Die Karte „Monatliche Verbrauchsinformation“ einer Heizperiode (Heizung PR 22, Entwurf 8.8, 13 PR 22).
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import MonthlyInfoSheet from './MonthlyInfoSheet'
import { monthStatus, rowBody, rowToForm, type MonthlyRowForm } from '../monthlyInfoForm'
import { monthName } from '../../../shared/monthlyInfo.ts'
import type { MonthlyInfoRow, MonthlyInfoView } from '../types'

export default function MonthlyInfoCard({ plantId, period, propertyName = '' }: { plantId: string; period: string; propertyName?: string }) {
  const [view, setView] = useState<MonthlyInfoView | null>(null)
  const [forms, setForms] = useState<Record<string, MonthlyRowForm>>({})
  const [printing, setPrinting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()

  async function load() {
    try {
      const v = await api<MonthlyInfoView>(`/api/heating-plants/${plantId}/periods/${period}/monthly-info`)
      setView(v)
      setForms(Object.fromEntries(v.months.map((m) => [m.month, rowToForm(m.row)])))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => { void load() }, [plantId, period])

  useEffect(() => {
    if (printing === null) return
    document.body.classList.add('print-monthly-info')
    window.print()
    document.body.classList.remove('print-monthly-info')
    setPrinting(null)
  }, [printing])

  async function save(month: string) {
    const r = rowBody(forms[month] ?? { reference: '', source: '', sentOn: '' })
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api<MonthlyInfoRow>(`/api/heating-plants/${plantId}/monthly-info/${month}`, { method: 'PUT', body: JSON.stringify(r.body) })
      toast('Gespeichert.')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!view || !view.managed || view.elsewhere || view.months.length === 0) return error ? <div className="error">{error}</div> : null
  const set = (month: string, key: keyof MonthlyRowForm, value: string) =>
    setForms((f) => ({ ...f, [month]: { ...(f[month] ?? { reference: '', source: '', sentOn: '' }), [key]: value } }))
  const toPrint = view.months.find((m) => m.month === printing)

  return (
    <div className="card">
      <h2>Monatliche Verbrauchsinformation <Term id="monthlyConsumptionInfo" /></h2>
      <p className="muted">
        Ihre Zähler sind aus der Ferne ablesbar. Dann steht jedem Mieter jeden Monat seine Verbrauchsinformation zu. Mietfuchs erstellt sie aus den
        Zählerständen am Monatsende; zukommen lassen müssen Sie sie selbst. Den Vergleichswert eines Durchschnittsnutzers nennt Ihnen etwa Ihr
        Ablesedienst; ein Durchschnitt aus Ihrem eigenen Haus genügt nicht.
      </p>
      {error && <div className="error">{error}</div>}
      <table className="table">
        <thead><tr><th>Monat</th><th>Stand</th><th>Vergleichswert</th><th>Quelle</th><th>Mitgeteilt am</th><th /></tr></thead>
        <tbody>
          {view.months.map((m) => {
            const status = monthStatus(m)
            const f = forms[m.month] ?? { reference: '', source: '', sentOn: '' }
            const label = monthName(m.month)
            return (
              <tr key={m.month}>
                <td>{label}</td>
                <td className={`tone-${status.tone}`}>{status.text}</td>
                <td><input aria-label={`Vergleichswert ${label} (kWh je m²)`} inputMode="decimal" value={f.reference} onChange={(e) => set(m.month, 'reference', e.target.value)} /></td>
                <td><input aria-label={`Quelle ${label}`} value={f.source} onChange={(e) => set(m.month, 'source', e.target.value)} /></td>
                <td><input aria-label={`Mitgeteilt am ${label}`} type="date" value={f.sentOn} onChange={(e) => set(m.month, 'sentOn', e.target.value)} /></td>
                <td className="row">
                  <button className="btn secondary" onClick={() => void save(m.month)}>Speichern</button>
                  {m.due && m.users.length > 0 && <button className="btn secondary" onClick={() => setPrinting(m.month)}>Drucken</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {toPrint && <MonthlyInfoSheet month={toPrint} propertyName={propertyName} />}
    </div>
  )
}
```

(`useToast` steht seit PR 6 in `./feedback`; heißt das Modul anders, dessen Namen. Im jsdom-Test ist
`window.print` nicht aufgerufen, weil nicht gedruckt wird.)

`client/src/index.css` ans Ende:

```css
/* Heizung PR 22: beim Drucken der monatlichen Verbrauchsinformation nur das Blatt, je Mieter eine Seite. */
.monthly-info-print { display: none; }
@media print {
  body.print-monthly-info * { visibility: hidden; }
  body.print-monthly-info .monthly-info-print,
  body.print-monthly-info .monthly-info-print * { visibility: visible; }
  body.print-monthly-info .monthly-info-print { display: block; position: absolute; left: 0; top: 0; width: 100%; }
  .monthly-info-page { break-after: page; }
}
```

`client/src/pages/Heizkosten.tsx` (Annahme B6): `import MonthlyInfoCard from '../components/MonthlyInfoCard'`
und je Anlage und Heizperiode hinter den Karten der eigenen Abrechnung (PR 10):

```tsx
{plant.method === 'self' && !plant.monthlyInfoElsewhere && (
  <MonthlyInfoCard plantId={plant.id} period={String(view.period)} propertyName={property?.name ?? ''} />
)}
```

(`property` ist das gewählte Objekt aus `useProperty()`; heißt die Variable dort anders, deren Namen.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- monthlyInfoForm MonthlyInfoCard heatingRulesForm HeatingRulesFields && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/monthlyInfoForm.ts client/src/monthlyInfoForm.test.ts client/src/components/MonthlyInfoCard.tsx client/src/components/MonthlyInfoCard.test.tsx client/src/components/MonthlyInfoSheet.tsx client/src/pages/Heizkosten.tsx client/src/heatingRulesForm.ts client/src/heatingRulesForm.test.ts client/src/components/HeatingRulesFields.tsx client/src/index.css
git commit -m "Verbrauchsinformation: Karte auf der Seite Heizkosten mit Blatt je Mieter

Vergleichswert mit Quelle und Tag der Mitteilung je Monat; die
Bestätigung an der Anlage verlangt bei einem Portal eine Nachricht
jeden Monat.

Refs #99"
```

---

### Task 6: Doku und Abschluss

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG**

Unter „Unveröffentlicht“, Abschnitt „Hinzugefügt“:

```markdown
- Monatliche Verbrauchsinformation: Bei eigener Heizkostenabrechnung mit fernablesbaren Zählern erstellt
  Mietfuchs aus den Zählerständen am Monatsende je Mieter die Information nach § 6a HeizkostenV (Verbrauch
  in kWh, Vergleich mit Vormonat, Vorjahresmonat und einem Durchschnittsnutzer), druckt sie und hält fest,
  wann sie mitgeteilt wurde. Fehlt ein Monat, nennt die Abrechnung die Kürzung um 3 % je Mieter
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
```

Unter „Geändert“:

```markdown
- Der Hinweis zur monatlichen Verbrauchsinformation sagt, dass eine Information im Portal des Messdienstes nur
  zählt, wenn die Mieter jeden Monat eine Nachricht bekommen
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt „Berechnungs-Engine“ hinter dem Punkt zur Steuer einen Punkt anfügen:

```markdown
- **Monatliche Verbrauchsinformation** (#99, Heizung PR 22, server/src/monthlyInfo.ts): nur bei eigener
  Abrechnung, nur aus Ablesungen genau an den Monatsgrenzen (nie interpoliert; § 6a Abs. 2 Nr. 2 „soweit
  erhoben“), Vergleiche nur desselben Mietverhältnisses. Der Durchschnittsnutzer kommt als Vergleichswert mit
  Quelle vom Vermieter, nicht aus dem eigenen Haus: Die Begründung (BR-Drs. 643/21) schließt den Vergleich mit
  Nutzern desselben Gebäudes aus. Warmwasser in kWh über § 9 Abs. 2 Satz 2 ist eine Auslegung,
  Heizkostenverteiler ergeben keine kWh. „Mitgeteilt“ heißt: Die Information erreicht den Mieter; ein Portal
  zählt nur mit Nachricht jeden Monat. Der Hinweis `heating.monthly-info` nennt die offenen Monate und 3 % je
  betroffenem Mieter; abgezogen wird nichts.
```

- [ ] **Step 3: Volle Prüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run: `MIETFUCHS_RELEASE=1 npm --prefix server test -- test/law-release.test.ts`
Expected: PASS.

Run (Smoke-Test mit Wegwerf-Ordner, `CI=1`, geschlossenem Update-Port):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Exit-Status 0.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle grün.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: monatliche Verbrauchsinformation

Refs #99"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| § 6a Abs. 1, 2 aus Monatswerten (13 PR 22, 8.8) | 2, 3, 5 |
| Nicht entbehrlich; 3 % je Mieter, einzeln, nie abgezogen (R-A17, 6.5, 1.2 Nr. 5) | 4 |
| Bestätigung an der Anlage, wenn über das Portal des Messdienstes (13 PR 22, 8.8) | 4 (Text), 5 (Satz an der Bestätigung) |
| `heating.monthly-info` warning (10.1), Regel `heating-info` (10.2) | 4 |
| Rechtswerte aus dem Register (`hkv.cut.information`, `hkv.monthly-info`, `hkv.dhw.volume-formula`) | 2, 4 |
| Lexikon (10.3) | 1 |
| Wer nichts einstellt, merkt nichts (1.2) | 4 Step 6 |
| Monatsendwerte als erhobene Werte (3.5, [M] ista) | 2 |

**2. Platzhalter.** Keine. Stellen, die an Namen der Vorgänger hängen, nennen die Annahme (B1–B7) und was zu tun
ist, wenn der Name anders lautet.

**3. Typen.** `MonthlyInfoRow`, `MonthlyInfoGap`, `MonthlyInfoUser`, `MonthlyInfoMonth`, `MonthlyInfoView` (Task 1)
werden in Task 2 (`monthlyInfoMonths`, `openMonths`), Task 3 (`saveMonthlyInfoRow`, `monthlyInfoView`), Task 4
(`Snapshot.monthlyInfoRows`) und Task 5 (Formular, Karte, Blatt) mit denselben Feldern benutzt.

**4. Review Focus.** 1 → Task 2 „Review Focus 1“; 2 → Task 5 „Review Focus 2“; 3 → Task 2 „Review Focus 3“;
4 → Task 2 „Review Focus 4“; 5 → Task 3 „Review Focus 5“.
