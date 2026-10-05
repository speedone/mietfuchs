# Heizung PR 12: Heizkostenverteiler und Ablesedienst (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die eigene Heizkostenabrechnung (`method = 'self'`) verteilt die Kosten nach Verbrauch auch
nach selbst abgelesenen elektronischen Heizkostenverteilern, mit Skala und Bewertungsfaktor je Gerät
und dem Stichtagswert des Geräts, und nach den Werten eines Ablesedienstes je Wohnung und
Nutzungszeitraum (deckt Verdunster und Funk-Heizkostenverteiler ab). Ein fehlender Faktor, gemischte
Geräte in einer Anlage (§ 5 Abs. 7 HeizkostenV, Vorerfassung, #218) und ein Gerätestichtag neben dem
Beginn der Heizperiode werden gemeldet; der Ausweis nennt je Gerät Skala, Faktor und Einheiten.

**Architecture:** Zwei nullbare Spalten an `meters` (`rating_factor`, `hca_scale`), `hca_model` an der
Anlage und die Tabelle `heating_service_values` (Entwurf 5.6) in zwei erzeugten Schritten. Die eigene
Heizkostenabrechnung von PR 10 rechnet im **Grenzmodell** (`planSelf`: je Zähler eine Ablesung an jeder
Grenze, Verbrauch als Differenz, `metersOf` je Wohnung und Topf); diese PR bringt die neuen Erfassungen
in genau diese Gestalt: Heizkostenverteiler sind Zähler vom Typ `hkv` mit einem Faktor am Zähler
(`SelfMeter.factor`, `meterFactor` in der neuen Datei `server/src/hca.ts`), `metersOf` wählt den Typ nach
der Erfassung, und Werte eines Ablesedienstes werden je Wohnung ein gedachter Zähler mit kumulierten
Ständen (`serviceMeters`). So bleiben Zwischenablesung, Gradtage und „keine Interpolation“ aus PR 10
unverändert zuständig. Was die Verteilung verhindert (`mixedCapture`, `missingRatings`), kommt in die
Liste `blocked` von PR 10. Der Stichtagswert ist kein neues Datenfeld: Er wird wie ein Zählerwechsel
erfasst (`replacement: true`, `oldEndValue` = Stichtagswert, `value` = 0, Entwurf 8.1).

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
3.5 (Stichtagswert aus dem Gerätespeicher, Verdunster, ARGE-Fenster), 3.12 (HKV nicht eichpflichtig),
4.3 (`practice.evaporator-window`, PR 12), 5.1 (`meters.rating_factor`, `hca_scale`,
`heating_service_values`), 5.3 (`capture`, `hca_model`, Zähler PR 12), **5.6**, 5.8 (Ablesedienstwerte
im Schnappschuss), 5.9 (Wiederherstellen), **8.1 ganz**, 8.6 (Gewichte), 8.8 („eigene Werte samt
Ablesungen und Faktoren (bei HKV je Gerät; bei der Einheitsskala muss der Faktor in der Abrechnung
stehen …)“), 10.1 (`heating.device-cutoff`, `heating.mixed-capture`, `heating.hca-factor-missing`),
10.3 (`heatCostAllocator`), 11.4 (Seite Heizkosten: „Ablesungen … ‚Stichtagswert‘“), 12.2
(`heating.test.ts`: „HKV mit Faktoren 0,8 und 1,25“), 13 (PR 12), 14.1 (Zeilen „Selbstabrechnung mit
elektronischen HKV“, „Verdunster“, „Gemischte Ausstattung“), 15.3 (Zeile „Selbst abgelesene
elektronische HKV, Skalen und Bewertungsfaktoren“, ⟨Norm offen: VDI 2077; DIN EN 834⟩), 16
(Nicht-Ziele: Verdunster selbst auswerten, Vorerfassung).

**Baut auf:** PR 1 bis PR 11 (Pläne `docs/superpowers/plans/2026-10-05-heizung-pr{1..11}-*.md`),
maßgeblich PR 10 in der Fassung von Commit `81828af` (abgeglichen, siehe „Abgleich mit PR 10“) und der
Testhelfer `server/testing/selfHeating.ts` aus PR 11. Gearbeitet wird auf `feat/heizung-pr12-hkv`,
abgezweigt von der Spitze von PR 11; der PR wird gestapelt auf PR 11 gestellt und nach dessen Merge auf
`main` umgestellt.

## Änderungen nach Prüfung vom 05.10.2026

Der Prüfbericht vom 05.10.2026 (Teil B, Schnittstellen zu PR 10 in der Fassung von Commit `81828af`) hat
gezeigt, dass dieser Plan an PR 10 vorbeigeplant war: PR 10 hat kein Segmentmodell je Gerät
(`heatDevicesOf`, `HeatSegment`), sondern das Grenzmodell in `planSelf`. Geändert ist:

1. **Abgleich mit PR 10** (Abschnitt „Abgleich mit PR 10“ unter den Annahmen): Liste `CAPTURE_METHODS`
   statt `HEAT_CAPTURES`, die eine Sperre `LATER.capture` statt `LATER.hca`/`LATER.serviceValues`,
   Fehler über `blocked: SelfBlock[]` mit geschlossener Code-Vereinigung statt `blockers`, Auswahl
   `CAPTURE_SELF_OPTIONS` in `heatingSelfForm.ts` statt `CAPTURE_OPTIONS`. `hca_model` fehlt in PR 10
   und kommt in Task 2 fest dazu.
2. **Task 3 und Task 4 neu gefasst auf das Grenzmodell:** Der Faktor steht am Zähler
   (`SelfMeter.factor`), `metersOf` in `planSelf` wählt bei `capture = 'hca'` den Typ `hkv`, jede
   Differenz zählt mal Faktor. Werte eines Ablesedienstes werden je Wohnung ein gedachter Zähler mit
   kumulierten Ständen (0 am Tag vor der ersten Zeile, die Summe am Ende jeder Zeile); eine Lücke ergibt
   eine fehlende Grenzablesung und damit den Weg von PR 10. `heatDevicesOf`, `HeatSegment`,
   `UnitHeatDevices`, `serviceSegments` entfallen; `hca.ts` behält `mixedCapture`, `missingRatings`,
   `deviceCutoffs`, `deviceLines`. Damit setzt PR 13 an `metersOf` an, wie es dort steht.
3. **Ausweis an `self`:** Geräte und Werte des Ablesedienstes stehen in `SelfHeatingStatement.devices`
   bzw. `.serviceValues` (über `SelfPlantPlan`), nicht in einem `report` des CO₂-Blocks. Die Einheit des
   Topfs Heizung heißt bei Heizkostenverteilern und Ablesedienst „Einheiten“ statt „kWh“
   (`potUnitOf`, Abweichung 9).
4. **Tests auf den Testhelfer von PR 11** (`server/testing/selfHeating.ts`, feste Kennungen `wz-a`…;
   Option `serviceValues` kommt hier dazu) und auf die Wege von PR 10: Eine Anlage wird nur über die
   Einrichtung zur eigenen Abrechnung (`setUpSelf`, PR 10 Abweichung 17), `POST /api/heating-plants`
   liefert `{ plant, assigned }`.
5. **Einrichtung legt bei Heizkostenverteilern und Ablesedienst keine Wärmezähler an** (Abweichung 8):
   sonst meldete die eigene Prüfung gemischte Geräte.
6. **`andList` aus `shared/wording.ts`**, Importe aus `db/heatingPeriodContext.ts` und `db/client.ts`
   wie in PR 10 und PR 14.

Nicht in diesem Durchgang: Den Hinweis auf gemischte Skalen (Einheits- neben Produktskala in einer Anlage,
Prüfbericht A.2 „hält mit Vorbehalt“) baut dieser Plan nicht; er steht als Prüfpunkt in der
PR-Beschreibung (⟨Norm offen: VDI 2077; DIN EN 834⟩).

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Bei `capture = 'heatMeter'` und
  bei jeder Anlage ohne `self` ist jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand
  nach PR 11. Golden F01–F17 bleiben wortgleich.
- **Wortlaut, gelesen am 05.10.2026 auf gesetze-im-internet.de:**
  - § 5 Abs. 1 Satz 1 HeizkostenV: „Zur Erfassung des anteiligen Wärmeverbrauchs sind Wärmezähler oder
    Heizkostenverteiler, zur Erfassung des anteiligen Warmwasserverbrauchs Warmwasserzähler zu
    verwenden.“ Wärmezähler und Heizkostenverteiler sind gleichrangig.
  - § 5 Abs. 7 Satz 1: „Wird der Verbrauch der von einer Anlage im Sinne des § 1 Absatz 1 versorgten
    Nutzer nicht mit gleichen Ausstattungen erfasst, so sind zunächst durch Vorerfassung vom
    Gesamtverbrauch die Anteile der Gruppen von Nutzern zu erfassen, deren Verbrauch mit gleichen
    Ausstattungen erfasst wird.“ Die Vorerfassung rechnet Mietfuchs nicht (Entwurf 8.1, 16; #218);
    gemischte Geräte ergeben `heating.mixed-capture` (error) und keine Verteilung.
- **Skalen und Bewertungsfaktoren** (Entwurf 8.1, [M] Haufe HeizKV § 5.3 und Berliner Mieterverein,
  übernommen; ⟨Norm offen: VDI 2077; DIN EN 834⟩, Entwurf 15.3): Bei der **Einheitsskala** zählt der
  Ablesewert mal dem Bewertungsfaktor des Heizkörpers, und der Faktor muss in der Abrechnung stehen;
  bei der **Produktskala** ist er im Ablesewert schon enthalten. Ohne Skala oder bei Einheitsskala ohne
  Faktor: `heating.hca-factor-missing` (error), keine Verteilung. Mietfuchs prüft nicht, ob ein Faktor
  „richtig“ ist (Entwurf 16: keine Rechtsberatung zu Bewertungsfaktoren).
- **Stichtagswert** (3.5 Facette 5, 8.1): Elektronische Heizkostenverteiler setzen am Stichtag zurück
  und speichern den Stichtagswert ([M] ista-Gerätebeschreibung). Erfasst wird das wie ein
  Zählerwechsel; weicht der Stichtag des Geräts vom Beginn der Heizperiode ab, gibt es
  `heating.device-cutoff` (warning). Es wird nichts interpoliert (Entwurf 8.4, PR 10).
- **Verdunster wertet Mietfuchs nicht selbst aus** (8.1, 16): Skala, Kaltverdunstungsvorgabe,
  Ampullentausch und das Fenster für Zwischenablesungen liegen beim Ablesedienst; dessen Werte kommen
  über `heating_service_values`. `hca_scale` und `rating_factor` gibt es nur an Zählern vom Typ `hkv`
  (Prüfbedingung).
- **Heizkostenverteiler sind keine eichpflichtigen Messgeräte** (3.12, Z-B10): kein Eichdatum, kein
  Eichhinweis (das bleibt PR 21).
- **Rechtswerte nur aus dem Register** (4.3, 4.7): Dieser Plan bringt genau einen Parameter,
  `practice.evaporator-window` (400–800 ‰, [M] ARGE, „nur Lexikon“). `server/src/hca.ts` kommt in
  `ENGINE_FILES` von `law-literals.test.ts`.
- **Fassungen nie ändern** (4.4): eine neue Zeile in `law-history.test.ts`, keine geänderte.
- **Stufe hängt am Code** (#112): Jeder neue Code steht mit genau einer Stufe in `noticeKinds` und
  trägt mindestens einen Begriff (`heatCostAllocator`).
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei
  Schritte in genau dieser Reihenfolge hinter dem letzten Schritt von PR 11: `hkv` (zwei Spalten an
  `meters`, neue Tabelle `heating_service_values` samt ihrer eigenen Bedingungen) und `hkv_bedingungen`
  (Bedingungen an `meters`, Neubau). Mit den Schritten von PR 11 (`0028`, `0029`) sind es `0030_hkv` und
  `0031_hkv_bedingungen`; die Nummer vergibt drizzle-kit. Die Marken kommen in
  `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben unverändert;
  die db.json kennt keine Heizkostenverteiler mit Faktor. `legacy/read.ts` braucht keine Änderung.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein `namespace`,
  keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter `grep`
  prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #99` und endet mit den Attribution-Zeilen der
  ausführenden Sitzung. #218 wird in Kommentaren und im CHANGELOG genannt, nicht mit `Refs`, denn diese
  PR behebt es nicht. Aufgaben stehen nur in den GitHub-Issues des Repos, nie in Beads (CLAUDE.md).

## Review Focus

1. **Ein Gerät wird mitten in der Heizperiode getauscht** (defekter Heizkostenverteiler) und das neue
   hat einen anderen Faktor oder eine andere Skala. Der Vermieter erwartet, dass alter und neuer Teil je
   mit ihrem Faktor zählen. Erwartet: Ein Tausch ist ein **neuer Zähler** (eigenes Gerät, eigener
   Faktor); der alte endet mit seiner letzten Ablesung. Ein Zählerwechsel an demselben Zähler
   (`replacement`) übernimmt Skala und Faktor des Zählers, und der Ausweis nennt sie; der Hinweistext
   von `heating.hca-factor-missing` und die Anleitung am Formular sagen, dass ein Gerät mit anderem
   Faktor als neuer Zähler anzulegen ist. Test in Task 3 („Tausch“).
2. **Die Werte des Ablesedienstes decken die Heizperiode nicht lückenlos** (Wohnung mit Zeilen
   01.01.–30.09. und 15.10.–31.12.). Erwartet: kein stilles Auffüllen; die Lücke ist für PR 10 eine
   fehlende Zwischenablesung bzw. ein fehlender Wert (Wechsel- oder § 9a-Pfad), nichts wird geschätzt.
   Test in Task 3 (`serviceSegments` mit Lücke) und Task 5 (Schreibprüfung lehnt nur Überschneidungen ab,
   nicht Lücken).
3. **Ein Teil der Zeilen hat Warmwasserwerte, ein Teil nicht.** Erwartet: 400 beim Speichern mit einem
   Satz („alle oder keine“), nichts geschrieben; sonst käme das Warmwasser teils vom Dienst, teils von
   den Zählern. Test in Task 5.
4. **Ein Wärmezähler an der Wohnung bei Erfassung „Heizkostenverteiler“** (oder umgekehrt), etwa weil
   ein Altgerät in der Liste steht. Erwartet: `heating.mixed-capture` nennt die Wohnungen beider
   Gruppen, die Anlage wird nicht verteilt; Zähler der Anlage selbst (`heating_plant_id`, Rolle) und
   Warmwasserzähler zählen nicht als gemischt. Test in Task 3.
5. **Ein Heizkostenverteiler ohne Wohnung** (Hauptzähler) oder ein Faktor an einem Wasserzähler.
   Erwartet: 400 mit Satz beim Speichern (PR 4 lehnt den HKV ohne Wohnung schon ab; neu: Skala und
   Faktor nur am HKV, Faktor über 0). Test in Task 2.

---

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/practice.ts`, `shared/law/params.ts` | `practice.evaporator-window` | 1 |
| `shared/glossary.ts` | `heatCostAllocator` neu gefasst (Skalen, Faktor, Stichtag, Verdunster, Ablesedienst) | 1 |
| `shared/types.ts` | `HcaScale`, `Meter.ratingFactor`, `Meter.hcaScale`, `HeatingServiceValue`, `HcaDeviceLine`, `HeatingStatement.devices`, `HeatingPeriodView.serviceValues` | 2, 4, 5 |
| `server/src/db/schema.ts`, `server/drizzle/0030_hkv.sql`, `0031_hkv_bedingungen.sql`, `meta/*` (erzeugt) | Spalten, Tabelle, Bedingungen | 2 |
| `server/src/db/repository.ts`, `server/src/db/read.ts` | Zähler schreiben und prüfen, Ablesedienstwerte lesen, `crossPropertyViolations` | 2, 5 |
| `server/src/hca.ts` (neu) | Faktor am Zähler, Ablesedienst als gedachter Zähler, Ausweis je Gerät, gemischte Geräte, fehlende Faktoren, Gerätestichtag | 3 |
| `server/src/heating.ts`, `server/src/calc.ts`, `server/testing/selfHeating.ts` | Naht im Grenzmodell (`metersOf`, Faktor), `blocked`, Hinweis, Ausweis an `self` | 4 |
| `server/src/db/serviceValues.ts` (neu), `server/src/db/heating.ts`, `server/src/db/heatingSelf.ts`, `server/src/index.ts` | Werte des Ablesedienstes speichern, Sperre `LATER.capture` fällt, Einrichtung ohne Wärmezähler bei HKV und Ablesedienst, Route | 5 |
| `client/src/meterForm.ts` (PR 4), `client/src/hcaForm.ts` (neu), `client/src/components/CutoffReadingForm.tsx` (neu), `client/src/components/ServiceValuesCard.tsx` (neu), `client/src/hcaView.ts` (neu), `client/src/components/HcaBlock.tsx` (neu), `client/src/pages/Zaehler.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/heatingSelfForm.ts` (PR 10) | Formulare, Karte, Druckblock, Erfassung in der Einrichtung frei | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `schema.test.ts`, `migrations.test.ts`, `hca.test.ts` (neu), `db-hkv.test.ts` (neu), `calc-hkv.test.ts` (neu), `api.test.ts`, `client/src/hcaForm.test.ts` (neu), `client/src/meterForm.test.ts`, `client/src/hcaView.test.ts` (neu), `client/src/components/CutoffReadingForm.test.tsx` (neu), `client/src/components/ServiceValuesCard.test.tsx` (neu) | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 11 anders umgesetzt hat, zieht ihn hier nach, bevor
Task 1 beginnt.

- **PR 1** `shared/law/register.ts`: `LawParam`, `law`, `valueAt`, `createLawLog`, `dayBefore`,
  `germanDate`, `LAW_AS_OF`, `Source`, `Period`; `shared/law/practice.ts` mit `practiceVacancyPersons`;
  `shared/law/params.ts` `LAW_PARAMS`; Tests `law.test.ts` (Objekt `modules`), `law-history.test.ts`
  (`SHIPPED`), `law-literals.test.ts` (`ENGINE_FILES`).
- **PR 2** `shared/period.ts`: `PeriodKey`, `periodKey`, `BillingPeriod`.
- **PR 4** `Meter` mit `heatingPlantId`, `heatingRole`, `remoteReadable`, `installedOn`; `MeterType` mit
  `'hkv'`, `'waerme'`, `'warmwasser'`; schema.ts `meters`, `oneOf`, `exactly`, `notNegative`;
  repository.ts `mergeMeter`, `meterRow`, `guardMeter`, `HeatingError`, `has`, `raw`, `merged`,
  `oneOfOrUndefined`, `nullableNumber`, `sameProperty`, `ISO_DATE`, `HKV_KEY`; read.ts `readMeters`;
  `client/src/meterForm.ts` (bzw. die Datei, in der PR 4 `MeterForm`, `meterToForm`, `meterBody`
  anlegt); Lexikon `heatCostAllocator`.
- **PR 5** `shared/heatingPeriod.ts` `servesUnit(plant, unit)`; snapshot.ts `SnapshotHeatingPart`.
- **PR 6** db/co2.ts `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`,
  `closedText`, `heatingPeriodViews`, `PlantContext`; `HeatingPeriodView`, `HeatingStatement`;
  `client/src/pages/Heizkosten.tsx`.
- **PR 10** (Plan, Commit `81828af`): siehe „Abgleich mit PR 10“.
- **PR 11** `server/testing/selfHeating.ts` (`selfSnapshot`, `SelfSnapshotOptions`, `PLANT`, feste
  Kennungen `wz-a`, `wz-b`, `wz-c`, `ww`, Anlage `hp`); `client/src/heatingForm.ts` `parseDecimal`,
  `numberText`. `andList` kommt aus `shared/wording.ts` (Bestand), nicht aus dhw.ts.
- **calc.ts (Bestand)** `meterSegments(readings: SnapshotReading[]): { segments: { from; to; delta; days }[]; notices; warnings }`;
  Konvention: Eine Ablesung gilt zum Tagesende ihres Datums, ein Segment reicht vom Datum der früheren
  zum Datum der späteren Ablesung, `days` ist der Abstand in Tagen.

## Annahmen über PR 10

Der Plan von PR 10 lag beim Schreiben dieses Plans nicht vor; er entstand parallel. Die folgenden
Namen sind aus dem Entwurf (5.3, 6.1 Nr. 4.3, 8.1, 8.4 bis 8.6, 13 PR 10) und den Gewohnheiten der
Pläne PR 4 bis PR 9 abgeleitet. **Vor Task 1** gleicht die ausführende Sitzung jede Zeile mit dem
Plan bzw. Code von PR 10 ab und ersetzt in diesem Plan jeden abweichenden Namen, bevor sie beginnt.
Weicht PR 10 in der Sache ab (nicht nur im Namen), entscheidet die Durchsicht, bevor gebaut wird.

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| C1 | `HeatingPlant.capture: 'heatMeter' \| 'hca' \| 'serviceValues' \| null` (Spalte `capture`, Liste `HEAT_CAPTURES` in schema.ts) und `HeatingPlant.hcaModel: string \| null` (Spalte `hca_model`) legt PR 10 an. `guardHeatingPlant` lehnt `'hca'` und `'serviceValues'` mit 400 ab (`LATER.hca`, `LATER.serviceValues`). Fehlt `hca_model`, kommt die Spalte in Task 2 Step 4 dazu (Code dort). | Task 2, 5 |
| C2 | **Naht N1:** PR 10 bildet den Verbrauch der Wohnungen an genau einer Stelle, `export function heatDevicesOf(i: HeatDevicesInput): UnitHeatDevices[]` in `server/src/heating.ts`, mit `type HeatSegment = { from: string; to: string; delta: number; days: number }` (Gestalt von `meterSegments`) und `type UnitHeatDevices = { unitId: string; devices: { id: string; segments: HeatSegment[] }[] }`; daraus rechnet PR 10 Zwischenablesung, Gradtage und Leerstand, ohne zu interpolieren. Dasselbe für Warmwasser: `waterDevicesOf(i): UnitHeatDevices[]` aus den Warmwasserzählern der Wohnungen. | Task 4 |
| C3 | `HeatDevicesInput` enthält `plant: SnapshotHeatingPlant` (mit `capture`), `units: readonly SnapshotUnit[]` (die angeschlossenen), `meters: readonly SnapshotMeter[]`, `readings: readonly SnapshotReading[]`, `h: BillingPeriod` | Task 4 |
| C4 | Ein Fehler, der die Verteilung einer Anlage verhindert, läuft in PR 10 über eine Liste `blockers: { code: NoticeCode; text: string }[]` je Anlage und Heizperiode: Ist sie nicht leer, meldet `computeSettlement` jeden Eintrag und verteilt den Topf nicht (Entwurf 10.1: `error` heißt „wird gar nicht verteilt“). | Task 4 |
| C5 | `SnapshotMeter` pickt nach PR 10 `id`, `unitId`, `type`, `name`, `heatingPlantId`, `heatingRole` | Task 2, 4 |
| C6 | Test-Helfer `server/testing/selfHeating.ts` (wie in PR 11, Annahme B8) mit `selfSnapshot(o?: SelfSnapshotOptions)`; `SelfSnapshotOptions` hat zusätzlich `meters?: SnapshotMeter[]`, `readings?: SnapshotReading[]`; Beispiel A hat die Wohnungen `a`, `b`, `c` mit je einem Wärmezähler `wz-a`, `wz-b`, `wz-c` | Task 4 |
| C7 | Die Oberfläche der Einrichtung (Schritt 7) bietet die Erfassung aus `CAPTURE_OPTIONS` in `client/src/heatingForm.ts`; `'hca'` und `'serviceValues'` stehen dort mit `disabled: true` und dem Zusatz „(kommt mit einer späteren Version)“ | Task 6 |
| C8 | PR 10 bringt die Regel `heating-own-settlement` (§§ 6–8 HeizkostenV, Entwurf 10.2) in `RULES` | Task 4 |

Fehlt C2 so, dass der Verbrauch an mehreren Stellen gebildet wird, wird zuerst (als eigener Schritt vor
Task 4 Step 3) eine Funktion daraus; alles andere ist eine Umbenennung.

### Abgleich mit PR 10 (Prüfung vom 05.10.2026)

Der Plan von PR 10 liegt vor (`2026-10-05-heizung-pr10-kernrechnung.md`, Commit `81828af`). Die Annahmen
C1 bis C8 sind damit aufgelöst; die Tasks benutzen die Namen der rechten Spalte. Wo die Tabelle oben
einem Task widerspricht, gilt der Task.

| Nr. | In PR 10 tatsächlich | Folge in diesem Plan |
|---|---|---|
| C1 | Liste `CAPTURE_METHODS` (schema.ts); `HeatingPlant.capture: CaptureMethod \| null`; eine Sperre in `guardHeatingPlant`: `if (after.capture !== 'heatMeter') throw new HeatingError(400, LATER.capture)`; keine Spalte `hca_model` | Task 2 nimmt `CAPTURE_METHODS` und legt `hca_model` fest an; Task 5 löscht die Zeile und `LATER.capture` |
| C2, C3 | Kein `heatDevicesOf`: Der Verbrauch entsteht in `planSelf` über den inneren Helfer `metersOf(unitId, pot)` (Typ aus `POT_METER`, nur `waerme`/`warmwasser`), `boundaryReadingsOf` je Grenze und `measuredBetween` je Grenzpaar, `v += result.value` je Wohnung; Eingabe `SelfInput` mit `meters: SelfMeter[]` (`{ id, name, unitId, type }`) und `readings: SelfReading[]` | Task 3/4 neu: `SelfMeter.factor`, `SelfInput.capture`, `meterTypeOf` in `planSelf`, `v += result.value * (m.factor ?? 1)`; Ablesedienst als gedachter `SelfMeter` mit kumulierten `SelfReading`s |
| C4 | `blocked: SelfBlock[]` je Anlage im Block des Plans von `computeSettlement`, `type SelfBlock = { code: … }` mit geschlossener Vereinigung; gemeldet über `warn(b.code, …)` mit dem Ort davor und „Bis dahin verteilt Mietfuchs …“ dahinter | Task 4 erweitert die Vereinigung um `'heating.mixed-capture' \| 'heating.hca-factor-missing'`; die Sätze aus hca.ts tragen weder Ort noch „Bis dahin“ |
| C5 | `SnapshotMeter` mit `name`, `heatingPlantId`, `heatingRole` (PR 4) | Task 2 ergänzt `hcaScale`, `ratingFactor` |
| C6 | Kein Testhelfer in PR 10 (`beispielA` baut über die Datenbank); PR 11 legt `server/testing/selfHeating.ts` an | Task 4 benutzt `selfSnapshot()` mit den festen Kennungen und ergänzt die Option `serviceValues` |
| C7 | Client: `CAPTURE_SELF_OPTIONS: { value; label; later: boolean }[]` in `client/src/heatingSelfForm.ts` (PR 4 hat ein anderes `CAPTURE_OPTIONS`); `selfSetupBody` lehnt `later` ab | Task 6 setzt `later: false` und nimmt den Zusatz aus den Beschriftungen |
| C8 | Regel `heating-own-settlement` (PR 10 Task 1) | wie angenommen |

Dazu, was keine Annahme war, aber an PR 10 hängt: Eine Anlage wird nur über die Einrichtung zur eigenen
Abrechnung (`setUpSelf`, `PUT /api/heating-plants/:id/self`, PR 10 Abweichung 17); `createHeatingPlant`
mit `method: 'self'` lehnt PR 10 ab. `setUpSelf` legt je angeschlossener Wohnung Wärme- und
Warmwasserzähler an; bei Heizkostenverteilern und Ablesedienst darf es die Wärmezähler nicht anlegen
(Abweichung 8, Task 5). `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`,
`closedText` stehen seit PR 8 in `server/src/db/heatingPeriodContext.ts`, `Database` in
`server/src/db/client.ts`.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **Gemischt heißt verschiedene Gerätearten für die Raumwärme.** § 5 Abs. 7 sagt „nicht mit gleichen
   Ausstattungen“. Mietfuchs wertet als gemischt: Wärmezähler an Wohnungen neben Heizkostenverteilern in
   derselben Anlage, und bei Erfassung „Wärmezähler“ ein Heizkostenverteiler an einer Wohnung (und
   umgekehrt). Warmwasserzähler (§ 5 Abs. 1: eigene Erfassung des Warmwassers) und Zähler der Anlage
   selbst zählen nicht. Heizkostenverteiler mit Einheits- und mit Produktskala gelten als gleiche
   Ausstattung, denn beide ergeben bewertete Einheiten; Verdunster und elektronische Geräte kann
   Mietfuchs nicht unterscheiden (ein Ablesedienst liefert dafür Werte). ⟨Norm offen: VDI 2077⟩.
2. **Gerätestichtag „am Beginn der Heizperiode“** heißt: Die Ablesung mit `replacement` und `value = 0`
   liegt am Tag vor dem Beginn (Tagesende, Konvention von `meterSegments`) oder am letzten Tag der
   Heizperiode. Jede Rücksetzung an einem Tag dazwischen ergibt `heating.device-cutoff`. Keine Quelle für
   eine Toleranz; die Ablesung neben dem Stichtag regelt PR 10 (`heating.reading-dates-differ`).
3. **Werte des Ablesedienstes:** `heat_value` ist Pflicht (ab 0), `water_value` freiwillig, aber in einer
   Heizperiode für alle Zeilen oder für keine (Review Focus 3). Ohne Warmwasserwerte kommt das
   Warmwasser von den Warmwasserzählern wie bei PR 10. Zeilen einer Wohnung dürfen sich nicht
   überschneiden und müssen in der Heizperiode liegen; Lücken sind erlaubt und bleiben Lücken.
4. **Der Hinweis aus PR 4 bei Verteilung nach Heizkostenverteilern mit freien Schlüsseln** (`HKV_KEY`)
   bleibt eine Ablehnung, bekommt aber einen neuen Satz: Er verweist jetzt auf die eigene
   Heizkostenabrechnung mit Erfassung „Heizkostenverteiler“ statt auf „eine spätere Version“. Mit freien
   Schlüsseln fehlten Faktor und Skala im Schlüssel. Der Entwurf sagt dazu nichts.
5. **Der Stichtagswert ist kein eigenes Feld**, sondern eine Ablesung mit `replacement` (Entwurf 8.1
   sagt genau das); das Formular „Stichtagswert laut Anzeige“ erzeugt sie. Ein Gerät mit
   **anderem Faktor** ist ein neuer Zähler (Review Focus 1).
6. **`heating.hca-factor-missing` auch bei fehlender Skala.** Der Entwurf nennt den Code für den
   fehlenden Faktor; ohne Skala ist unbekannt, ob ein Faktor nötig ist, und geraten wird nicht.
7. **Werte eines Ablesedienstes als gedachter Zähler** (nach der Prüfung vom 05.10.2026): je Wohnung ein
   Zähler mit kumulierten Ständen, 0 am Tag vor dem Beginn der ersten Zeile und die Summe am Ende jeder
   Zeile. Am Beginn einer Zeile nach einer Lücke steht **kein** Stand: Läge dort einer, zählte die Lücke
   still als Verbrauch 0. So findet eine Grenze in der Lücke keine eigene Ablesung, und PR 10 nimmt die
   nächste in ihrer Zelle wie abgelesen (mit Hinweis) oder geht den Weg der fehlenden Zwischenablesung.
   Nichts wird aufgefüllt (Abweichung 3, Review Focus 2).
8. **Die Einrichtung legt bei Heizkostenverteilern und Ablesedienst keine Wärmezähler an.** `setUpSelf`
   (PR 10) legt je angeschlossener Wohnung die fehlenden Zähler des Topfs an; bei `capture = 'hca'` wären
   das Wärmezähler neben den Heizkostenverteilern, und `mixedCapture` meldete gemischte Geräte. Die
   Heizkostenverteiler legt der Vermieter je Heizkörper selbst an (mit Skala und Faktor), beim
   Ablesedienst gibt es keine Geräte in Mietfuchs. Warmwasserzähler legt die Einrichtung weiter an.
9. **Einheit des Topfs Heizung bei Heizkostenverteilern und Ablesedienst: „Einheiten“** statt „kWh“
   (`potUnitOf`, `SelfPotView.consumptionUnit`). Heizkostenverteiler messen keine Wärmemenge; „785 von
   7.850 kWh“ stünde falsch auf der Abrechnung.

---
### Task 1: Register und Lexikon

`practice.evaporator-window` (Entwurf 4.3: „400–800 ‰ … [M] ARGE (Berliner Mieterverein, ista) …
geprüft 05.10.; nur Lexikon … PR 12“) und der Begriff `heatCostAllocator`, neu gefasst: Skalen,
Bewertungsfaktor, Stichtag, Verdunster und Ablesedienst. Die Sätze von PR 4 zur Fernablesbarkeit
bleiben Wort für Wort darin.

**Files:**
- Modify: `shared/law/practice.ts`, `shared/law/params.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes: PR 1 `LawParam`, `law`, `createLawLog`, `valueAt`, `LAW_AS_OF`; PR 4 in glossary.ts `NEW_DEVICES_AFTER`, `RETROFIT_FROM`, `REMOTE_CUT`.
- Produces: `practiceEvaporatorWindow: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'>`.

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/law.test.ts`: Den Import aus `'../../shared/law/practice.ts'` um
`practiceEvaporatorWindow` ergänzen und den Namen in das Objekt `modules` des Tests „jede Konstante vom
Typ LawParam in shared/law/ steht in LAW_PARAMS“ aufnehmen. Ans Dateiende:

```ts
test('Stichtag practice.evaporator-window: 400 bis 800 ‰ seit der Hauptablesung, 2015 wie 2030, als Praxis gekennzeichnet', () => {
  for (const y of [2015, 2025, 2030]) assert.deepEqual(law(practiceEvaporatorWindow, year(y), createLawLog()), { min: 400, max: 800 })
  const [v] = practiceEvaporatorWindow.versions
  assert.equal(v?.source.rank, 'practice')
  assert.match(practiceEvaporatorWindow.norm, /keine Rechtsnorm/)
})
```

(b) `server/test/law-history.test.ts`, in `SHIPPED` hinter den Zeilen von PR 11:

```ts
  // 0.11.0 (Heizung PR 12)
  'practice.evaporator-window|||{"min":400,"max":800}',
```

(c) `server/test/glossary.test.ts` ans Dateiende:

```ts
test('Heizkostenverteiler (Heizung PR 12): Skalen, Faktoren 1,25 und 0,8 nachgerechnet, Stichtag, Verdunster', () => {
  const g = GLOSSARY.heatCostAllocator
  assert.match(g.short, /Einheitsskala.*Bewertungsfaktor.*in der Abrechnung stehen/s)
  assert.match(g.short, /Produktskala.*schon eingerechnet/s)
  assert.match(g.short, /Stichtag/)
  assert.match(g.example, /Einheitsskala 500, sein Bewertungsfaktor ist 1,25: das sind 625 Einheiten/)
  assert.match(g.example, /200 bei Faktor 0,8: 160 Einheiten/)
  assert.match(g.example, /785 von 7\.850 Einheiten/)
  assert.match(g.example, /ein Zehntel der Kosten nach Verbrauch, bei 2\.100 € also 210 €/)
  assert.match(g.needed, /400 bis 800 ‰ der Gradtagszahlen/)
  assert.doesNotMatch(g.needed, /noch nicht selbst aus/)
})
```

Prüft ein Test von PR 4 den alten Satz „Mietfuchs wertet ihre Einheiten noch nicht selbst aus“, wird er
ersetzt durch `assert.match(GLOSSARY.heatCostAllocator.needed, /Skala und Bewertungsfaktor/)`; die
Prüfungen von PR 4 zur Fernablesbarkeit bleiben.

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL; `law.test.ts` mit „does not provide an export named 'practiceEvaporatorWindow'“.

- [ ] **Step 3: Parameter (`shared/law/practice.ts`, `shared/law/params.ts`)**

`shared/law/practice.ts` ans Dateiende:

```ts
// Verdunster (Heizung PR 12, Entwurf 3.5, 4.3, 8.1): Eine Zwischenablesung empfiehlt die
// Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung nur, wenn seit der Hauptablesung 400 bis 800 ‰
// der Gradtagszahlen vergangen sind; sonst wird nach Gradtagen geteilt. Kein Rechtswert und keine
// Rechnung in Mietfuchs: Verdunster wertet der Ablesedienst aus, und Mietfuchs nennt die Regel nur im
// Lexikon.
export const practiceEvaporatorWindow: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'> = {
  id: 'practice.evaporator-window',
  title: 'Zwischenablesung bei Verdunstern',
  norm: 'Empfehlung der Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung (keine Rechtsnorm)',
  timing: 'periodStart',
  versions: [{
    value: { min: 400, max: 800 },
    source: {
      rank: 'practice',
      cite: 'Berliner Mieterverein, Info 73 (Wiedergabe der Empfehlung der ARGE); ista, Fachwissen Zwischenablesung',
      url: 'https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Empfehlung der ARGE Heiz- und Wasserkostenverteilung, wiedergegeben 2026',
  }],
  describe: (v) => `${v.min} bis ${v.max} ‰ der Gradtagszahlen seit der Hauptablesung`,
}
```

`shared/law/params.ts`: Import aus `'./practice.ts'` um `practiceEvaporatorWindow` ergänzen und den
Namen ans Ende von `LAW_PARAMS` anhängen.

- [ ] **Step 4: Lexikon (`shared/glossary.ts`)**

Import aus `'./law/practice.ts'` um `practiceEvaporatorWindow` ergänzen. Unter den Konstanten von PR 4
(`NEW_DEVICES_AFTER`, `RETROFIT_FROM`):

```ts
// Heizkostenverteiler (Heizung PR 12): Beispiel mit zwei Bewertungsfaktoren. Die Zahlen des Hauses
// sind Beispielzahlen und keine Rechtswerte.
const EVAPORATOR = valueAt(practiceEvaporatorWindow, LAW_AS_OF)
const HCA = /* Beispiel */ { livingRaw: 500, livingFactor: 1.25, bathRaw: 200, bathFactor: 0.8, houseUnits: 7850, consumptionEuro: 2100 }
const hcaDe = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const HCA_LIVING = HCA.livingRaw * HCA.livingFactor
const HCA_BATH = Math.round(HCA.bathRaw * HCA.bathFactor * 100) / 100
const HCA_FLAT = HCA_LIVING + HCA_BATH
```

Den Eintrag `heatCostAllocator` (PR 4) ganz ersetzen durch:

```ts
  heatCostAllocator: {
    title: 'Heizkostenverteiler',
    short:
      'Ein kleines Gerät am Heizkörper, das anzeigt, wie viel dieser Heizkörper im Verhältnis zu den übrigen geheizt hat. Seine Werte sind keine Kilowattstunden, sondern Einheiten, die erst mit den Werten aller Geräte des Hauses etwas bedeuten. ' +
      'Bei der Einheitsskala zählt der Ablesewert erst mal dem Bewertungsfaktor des Heizkörpers, und dieser Faktor muss in der Abrechnung stehen; bei der Produktskala ist er schon eingerechnet. ' +
      'Elektronische Geräte setzen am Stichtag auf null und speichern den Wert des Stichtags. ' +
      `Geräte, die nach dem ${NEW_DEVICES_AFTER} eingebaut wurden, müssen aus der Ferne ablesbar sein, alle übrigen ab dem ${RETROFIT_FROM}.`,
    example:
      `Im Wohnzimmer zeigt ein Verteiler mit Einheitsskala ${hcaDe(HCA.livingRaw)}, sein Bewertungsfaktor ist ${hcaDe(HCA.livingFactor)}: das sind ${hcaDe(HCA_LIVING)} Einheiten. ` +
      `Im Bad zeigt einer ${hcaDe(HCA.bathRaw)} bei Faktor ${hcaDe(HCA.bathFactor)}: ${hcaDe(HCA_BATH)} Einheiten. ` +
      `Die Wohnung hat damit ${hcaDe(HCA_FLAT)} von ${hcaDe(HCA.houseUnits)} Einheiten des Hauses, also ein Zehntel der Kosten nach Verbrauch, bei ${hcaDe(HCA.consumptionEuro)} € also ${hcaDe((HCA.consumptionEuro * HCA_FLAT) / HCA.houseUnits)} €. ` +
      `Ist das Gerät nicht fernablesbar, obwohl es das sein müsste, darf der Mieter seinen Anteil an den Heizkosten um ${REMOTE_CUT} % kürzen.`,
    norm: '§§ 5, 12 HeizkostenV',
    needed:
      'Wenn Ihr Haus Heizkostenverteiler hat. Rechnet ein Messdienst ab, übernehmen Sie seine Beträge als Einzelbeträge. ' +
      'Rechnen Sie selbst ab und lesen elektronische Geräte selbst ab, tragen Sie an jedem Gerät Skala und Bewertungsfaktor ein, und zum Stichtag den Stichtagswert laut Anzeige. Ein Gerät mit anderem Faktor ist ein neues Gerät. ' +
      'Verdunster wertet Mietfuchs nicht selbst aus; übernehmen Sie dafür die Werte des Ablesedienstes je Wohnung und Nutzungszeitraum. ' +
      `Eine Zwischenablesung bei Verdunstern empfiehlt die Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung nur, wenn seit der Hauptablesung ${EVAPORATOR.min} bis ${EVAPORATOR.max} ‰ der Gradtagszahlen vergangen sind; das wendet der Ablesedienst an.`,
  },
```

Die Rechnung im Beispiel: 500 · 1,25 = 625, 200 · 0,8 = 160, zusammen 785; 785 / 7.850 = ein Zehntel;
2.100 · 785 / 7.850 = 210. Das letzte Satzglied mit `REMOTE_CUT` ist der Satz von PR 4, unverändert.

- [ ] **Step 5: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Alle Tests und Commit**

Run: `npm test`
Expected: PASS, Golden unverändert.

```bash
git add shared/law/practice.ts shared/law/params.ts shared/glossary.ts server/test/law.test.ts server/test/law-history.test.ts server/test/glossary.test.ts
git commit -m "Lexikon: Heizkostenverteiler mit Skala, Bewertungsfaktor und Stichtag

Dazu die Empfehlung der ARGE zur Zwischenablesung bei Verdunstern (400 bis 800 ‰) als
Praxiswert im Register, nur für das Lexikon.

Refs #99"
```

---

### Task 2: Datenmodell: Skala und Faktor am Zähler, Werte des Ablesedienstes

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/repository.ts`, `server/src/db/read.ts`, `server/src/snapshot.ts`
- Create (erzeugt): `server/drizzle/0030_hkv.sql`, `server/drizzle/0031_hkv_bedingungen.sql`, `server/drizzle/meta/*`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `server/test/db-hkv.test.ts` (neu)

**Interfaces:**
- Consumes: PR 4 `meters`, `mergeMeter`, `meterRow`, `guardMeter`, `readMeters`, `oneOf`, `exactly`, `notNegative`, `heatingPeriods`, `heatingPlants`, `units`; PR 2 `PeriodKey`, `periodKey`; PR 10 `CAPTURE_METHODS`, `HeatingPlant.capture`; PR 11 `server/testing/selfHeating.ts` (`PLANT`).
- Produces:
  - `shared/types.ts`: `type HcaScale = 'unit' | 'product'`; `Meter.ratingFactor?: number | null`, `Meter.hcaScale?: HcaScale | null`; `type HeatingServiceValue = { plantId: string; period: PeriodKey; unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }`
  - schema.ts: `HCA_SCALES`, Spalten `meters.ratingFactor` (`rating_factor`), `meters.hcaScale` (`hca_scale`), `heatingPlants.hcaModel` (`hca_model`), Tabelle `heatingServiceValues` (`heating_service_values`: `heatingPeriodId`, `unitId`, `from`, `to`, `heatValue`, `waterValue`)
  - `HeatingPlant.hcaModel: string | null`
  - read.ts: `readHeatingServiceValues(db: Database): Promise<HeatingServiceValue[]>`, `Stock.heatingServiceValues`
  - snapshot.ts: `SnapshotMeter` pickt zusätzlich `'ratingFactor' | 'hcaScale'`; `Snapshot.heatingServiceValues?: HeatingServiceValue[]`; `SnapshotSource.heatingServiceValues?: HeatingServiceValue[]`

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/schema.test.ts` ans Dateiende (Helfer `openMigrated` und `rejects` aus PR 4):

```ts
test('Heizung PR 12: Skala und Faktor nur am Heizkostenverteiler, Faktor über 0; Werte des Ablesedienstes ab 0 und mit Datum', async () => {
  const { connection, close } = await openMigrated()
  try {
    connection.exec("INSERT INTO properties (id, name) VALUES ('objekt-1', 'Haus')")
    connection.exec("INSERT INTO units (id, property_id, name) VALUES ('a', 'objekt-1', 'A')")
    connection.exec("INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('h1', 'objekt-1', 'Wohnzimmer', 'a', 'hkv', 'Einheiten')")
    connection.exec("INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('k1', 'objekt-1', 'Kaltwasser', 'a', 'kaltwasser', 'm³')")
    assert.equal(rejects(connection, "UPDATE meters SET hca_scale = 'unit', rating_factor = 1.25 WHERE id = 'h1'"), null)
    assert.ok(rejects(connection, "UPDATE meters SET rating_factor = 0 WHERE id = 'h1'"), 'Faktor 0')
    assert.ok(rejects(connection, "UPDATE meters SET hca_scale = 'linear' WHERE id = 'h1'"), 'unbekannte Skala')
    assert.ok(rejects(connection, "UPDATE meters SET rating_factor = 1.0 WHERE id = 'k1'"), 'Faktor am Wasserzähler')
    connection.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')")
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h2025', 'hp', '2025-01')")
    const insert = (from: string, to: string, heat: number, water: string) =>
      rejects(connection, `INSERT INTO heating_service_values (heating_period_id, unit_id, "from", "to", heat_value, water_value) VALUES ('h2025', 'a', '${from}', '${to}', ${heat}, ${water})`)
    assert.equal(insert('2025-01-01', '2025-09-30', 340, '12'), null)
    assert.ok(insert('2025-10-01', '2025-09-30', 10, 'NULL'), 'Ende vor Beginn')
    assert.ok(insert('2025-10-01', '2025-12-31', -1, 'NULL'), 'negativ')
    assert.ok(insert('01.10.2025', '2025-12-31', 1, 'NULL'), 'kein ISO-Datum')
    assert.ok(insert('2025-01-01', '2025-12-31', 1, 'NULL'), 'gleicher Schlüssel')
  } finally {
    close()
  }
})
```

Verlangen `units` oder `meters` nach PR 4 bis PR 11 weitere Spalten ohne Vorgabe, ergänzt das `INSERT`
sie so, wie die Bedingungstests von PR 4 in derselben Datei es tun.

(b) `server/test/migrations.test.ts`: die beiden neuen Schritte in die Liste der Marken; die Prüfsummen
kommen in Step 5 aus der Meldung des Tests.

(c) Datei `server/test/db-hkv.test.ts`:

```ts
// Heizkostenverteiler mit Skala und Faktor in der Datenbank (Heizung PR 12, Entwurf 8.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readMeters } from '../src/db/read.ts'
import { createEntity, HeatingError, updateEntity } from '../src/db/repository.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-hkv-'))
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

test('Heizkostenverteiler: Skala und Faktor werden gespeichert und ergänzend geändert; Unbekanntes ergibt null', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'meters', 'h1', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer', type: 'hkv', unit: 'Einheiten', hcaScale: 'unit', ratingFactor: 1.25 })
    })
    const meter = async () => (await opened.read(readMeters)).find((m) => m.id === 'h1') ?? assert.fail('kein Zähler')
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor], ['unit', 1.25])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { name: 'Wohnzimmer links' }))
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor], ['unit', 1.25])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { hcaScale: 'product', ratingFactor: null }))
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor], ['product', null])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { hcaScale: 'linear' }))
    assert.equal((await meter()).hcaScale, null)
  })
})

test('Heizkostenverteiler: Faktor über 0, Skala und Faktor nur am Heizkostenverteiler, je mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'meters', 'h1', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer', type: 'hkv', unit: 'Einheiten' })
      await createEntity(db, 'meters', 'k1', { propertyId: 'objekt-1', unitId: 'a', name: 'Kaltwasser', type: 'kaltwasser', unit: 'm³' })
    })
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: 0 })), heatingError(400, /Zahl über 0, etwa 0,8 oder 1,25/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'k1', { ratingFactor: 1 })), heatingError(400, /nur bei einem Heizkostenverteiler/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'k1', { hcaScale: 'unit' })), heatingError(400, /nur bei einem Heizkostenverteiler/))
  })
})
```

`updateEntity(db, collection, id, body)` ist die Schreibfunktion der Sammlungen in repository.ts
(Bestand); heißt sie anders, hier anpassen.

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/schema.test.ts test/db-hkv.test.ts`
Expected: FAIL; „no such column: hca_scale“ bzw. `undefined` statt `'unit'`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Über dem Typ `Meter`:

```ts
// Die Skala eines Heizkostenverteilers (Heizung PR 12, Entwurf 8.1): Einheitsskala, der Ablesewert zählt
// mal dem Bewertungsfaktor des Heizkörpers; Produktskala, der Faktor ist eingerechnet.
export type HcaScale = 'unit' | 'product'
```

In `Meter` als letzte Felder (hinter `installedOn` von PR 4):

```ts
  // Nur beim Heizkostenverteiler (Heizung PR 12): Skala und Bewertungsfaktor des Heizkörpers.
  hcaScale?: HcaScale | null
  ratingFactor?: number | null
```

Hinter `HeatingPeriodData`:

```ts
// Ein Wert eines Ablesedienstes für eine Wohnung und einen Nutzungszeitraum (Heizung PR 12, Entwurf
// 5.6). `heatValue` sind bewertete Einheiten für die Heizung, `waterValue` für das Warmwasser (optional:
// ohne ihn zählen die Warmwasserzähler). Die Grenzen gelten einschließlich.
export type HeatingServiceValue = { plantId: string; period: PeriodKey; unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }
```

- [ ] **Step 4: Erster Schritt: Spalten und Tabelle (`server/src/db/schema.ts`)**

Typimport um `HcaScale` ergänzen. Hinter `HEATING_ROLES` (PR 4):

```ts
// Heizung PR 12
export const HCA_SCALES = exactly<HcaScale>()(['unit', 'product'] as const)
```

In `meters` als letzte Spalten (die Bedingungen der Tabelle bleiben in diesem Step, wie sie sind):

```ts
    // Skala und Bewertungsfaktor eines Heizkostenverteilers (Heizung PR 12); nur bei `hkv`.
    hcaScale: text('hca_scale', { enum: HCA_SCALES }),
    ratingFactor: real('rating_factor'),
```

Hinter `heatingPeriods` (PR 4):

```ts
// Die Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum (Heizung PR 12, Entwurf 5.6). Eine
// gelöschte Wohnung oder Heizperiode nimmt ihre Werte mit.
export const heatingServiceValues = sqliteTable(
  'heating_service_values',
  {
    heatingPeriodId: text('heating_period_id')
      .notNull()
      .references(() => heatingPeriods.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    to: text('to').notNull(),
    heatValue: real('heat_value').notNull(),
    waterValue: real('water_value'),
  },
  (t) => [
    primaryKey({ columns: [t.heatingPeriodId, t.unitId, t.from] }),
    check('heating_service_values_dates_valid', sql.raw(`"from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND "to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND "from" <= "to"`)),
    notNegative('heating_service_values_heat_not_negative', 'heat_value'),
    notNegative('heating_service_values_water_not_negative', 'water_value'),
  ],
)
```

PR 10 hat die Spalte `hca_model` nicht (Abgleich C1). In diesem Step kommt sie als letzte Spalte an
`heatingPlants`, mit `hcaModel: string | null` in `HeatingPlant`, `mergeHeatingPlant`
(`merged(body, 'hcaModel', current.hcaModel, asNullableFilled)`), `emptyHeatingPlant` (`null`), `plantRow`
und `readHeatingPlants` (`hcaModel: p.hcaModel`). Jedes vollständige Literal von `HeatingPlant` bekommt
`hcaModel: null`: in `server/testing/selfHeating.ts` (PR 11, `PLANT`, hinter `heatGeneration: null,`) und
in den Testdaten des Clients (PR 11 `HotWaterCard.test.tsx`, PR 4/10 `heatingForm.test.ts`,
`HeatingCard.test.tsx`, `heatingSelfForm.test.ts`); der Übersetzer nennt jedes.

```ts
    // Bauart der Heizkostenverteiler (Entwurf 5.3), nur zur Beschreibung im Ausweis.
    hcaModel: text('hca_model'),
```

Run: `npm --prefix server run db:generate -- --name hkv`

Expected: `server/drizzle/0030_hkv.sql` mit genau einem `CREATE TABLE \`heating_service_values\``
(samt seiner drei Bedingungen und Fremdschlüssel), zwei `ALTER TABLE \`meters\` ADD` und einem
`ALTER TABLE \`heating_plants\` ADD` (`hca_model`), **kein** `__new_`. Sonst: Datei, Journal-Eintrag und
Momentaufnahme löschen, Schema berichtigen, neu erzeugen. Bei einer Frage nach Umbenennung: „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen an `meters`**

In den Bedingungen von `meters` ergänzen:

```ts
    oneOf('meters_hca_scale_known', 'hca_scale', HCA_SCALES),
    check('meters_rating_factor_positive', sql.raw('"rating_factor" > 0')),
    // Skala und Faktor gibt es nur am Heizkostenverteiler (Heizung PR 12).
    check('meters_hca_fields_only_hkv', sql.raw(`"type" = 'hkv' OR ("rating_factor" IS NULL AND "hca_scale" IS NULL)`)),
```

Run: `npm --prefix server run db:generate -- --name hkv_bedingungen`

Expected: `server/drizzle/0031_hkv_bedingungen.sql` mit dem Neubau von `meters`, sonst nichts. Dann:

Run: `npm --prefix server test -- test/migrations.test.ts`
Expected: zuerst FAIL mit den beiden neuen Prüfsummen in der Meldung; nach dem Eintragen PASS.

Hinweis: Der Neubau von `meters` läuft mit `PRAGMA foreign_keys=OFF` in der Transaktion von
`applyMigrations` (client.ts, PR 2); Ablesungen, die auf Zähler zeigen, bleiben erhalten. Praxislauf
Fall 16 (PR 3) prüft das an einer Datenbank von 0.10.1 und wird in Task 7 gefahren.

- [ ] **Step 6: Schreiben, prüfen, lesen (`repository.ts`, `read.ts`)**

`server/src/db/repository.ts`: Import aus `'./schema.ts'` um `HCA_SCALES`. In `mergeMeter` (Fassung PR 4)
als letzte Felder:

```ts
    // Skala und Bewertungsfaktor eines Heizkostenverteilers (Heizung PR 12, Entwurf 8.1).
    hcaScale: merged(body, 'hcaScale', current.hcaScale ?? null, (v) => oneOfOrUndefined(HCA_SCALES, v) ?? null),
    ratingFactor: merged(body, 'ratingFactor', current.ratingFactor ?? null, nullableNumber),
```

`meterRow` bekommt `hcaScale: m.hcaScale ?? null, ratingFactor: m.ratingFactor ?? null`. In `guardMeter`
(Fassung PR 4) als erste Zeilen hinter `await sameProperty(…)`:

```ts
  // Skala und Faktor nur am Heizkostenverteiler; sonst lehnte die Prüfbedingung ohne Satz ab.
  if (after.type !== 'hkv' && ((after.hcaScale ?? null) !== null || (after.ratingFactor ?? null) !== null)) {
    throw new HeatingError(400, 'Skala und Bewertungsfaktor gibt es nur bei einem Heizkostenverteiler. Lassen Sie beide Felder leer oder wählen Sie die Sparte „Heizkostenverteiler“.')
  }
  if (after.ratingFactor !== undefined && after.ratingFactor !== null && !(after.ratingFactor > 0)) {
    throw new HeatingError(400, 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25. Er steht auf dem Gerät oder in den Unterlagen des Herstellers oder Messdienstes.')
  }
```

`server/src/db/read.ts`: In `readMeters` hinter `installedOn: …` (PR 4):

```ts
    hcaScale: orUndefined(m.hcaScale),
    ratingFactor: orUndefined(m.ratingFactor),
```

Und als neue Funktion, mit dem Feld `heatingServiceValues: await readHeatingServiceValues(db)` in der
Funktion, die `Stock` zusammensetzt:

```ts
// Die Werte der Ablesedienste (Heizung PR 12), mit Anlage und Heizperiode aus `heating_periods`, in der
// Reihenfolge, in der sie angelegt wurden.
export async function readHeatingServiceValues(db: Database): Promise<HeatingServiceValue[]> {
  const rows = await db
    .select({ v: heatingServiceValues, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(heatingServiceValues)
    .innerJoin(heatingPeriods, eq(heatingServiceValues.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"heating_service_values".rowid`)
  return rows.map(({ v, plantId, period }) => ({
    plantId, period: periodKey(String(period)), unitId: v.unitId, from: v.from, to: v.to, heatValue: v.heatValue, waterValue: v.waterValue,
  }))
}
```

(Importe: `heatingServiceValues` aus `'./schema.ts'`, `HeatingServiceValue` aus den Typen, `periodKey`
aus `'../../../shared/period.ts'`, `eq`, `sql` aus `'drizzle-orm'`, soweit nicht vorhanden. `Stock`
bekommt `heatingServiceValues: HeatingServiceValue[]`.)

- [ ] **Step 7: Schnappschuss (`server/src/snapshot.ts`)**

`SnapshotMeter` um `'ratingFactor' | 'hcaScale'` erweitern. In `Snapshot` und `SnapshotSource` hinter den
Feldern der Lieferungen (PR 7):

```ts
  // Werte der Ablesedienste (Heizung PR 12). Fehlt die Angabe (db.json, Regression), gibt es keine.
  heatingServiceValues?: HeatingServiceValue[]
```

`snapshotFor` (und `heatingSnapshotFor`, PR 5) übernehmen die Werte der Anlagen des Objekts:

```ts
    heatingServiceValues: (source.heatingServiceValues ?? []).filter((v) => plantIds.has(v.plantId)),
```

`plantIds` ist die Menge der Kennungen der Anlagen des Objekts, die beide Funktionen für die
Lieferungen (PR 7) schon bilden; heißt sie anders, hier anpassen. Die Zähler reicht `snapshotFor`
durch; pickt es Felder einzeln, `ratingFactor` und `hcaScale` ergänzen.

- [ ] **Step 8: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-hkv.test.ts test/db-repository.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Alle Tests und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle server/src/db/repository.ts server/src/db/read.ts server/src/db/heating.ts server/src/snapshot.ts server/testing/selfHeating.ts client/src server/test/schema.test.ts server/test/migrations.test.ts server/test/db-hkv.test.ts
git commit -m "Heizkostenverteiler: Skala und Bewertungsfaktor; Tabelle für Werte des Ablesedienstes

Zwei Spalten an den Zählern, nur beim Heizkostenverteiler, und die Tabelle der Werte je Wohnung
und Nutzungszeitraum (Entwurf 5.6), in zwei erzeugten Schritten.

Refs #99"
```

---
### Task 3: Die Rechnung (`server/src/hca.ts`)

Neu gefasst nach der Prüfung vom 05.10.2026 (Abgleich mit PR 10, Commit `81828af`). PR 10 rechnet nicht
mit Segmenten je Gerät, sondern mit dem **Grenzmodell**: je Zähler eine Ablesung an jeder Grenze (Beginn,
Wechsel, Ende, `boundaryReadingsOf`), Verbrauch ist die Differenz zweier wirklicher Ablesungen
(`measuredBetween`), summiert je Wohnung in `planSelf`. Die neuen Erfassungen werden in diese Gestalt
gebracht, statt eine zweite daneben zu stellen: Ein Heizkostenverteiler ist ein Zähler vom Typ `hkv` mit
einem Faktor, die Werte eines Ablesedienstes sind je Wohnung ein gedachter Zähler mit kumulierten
Ständen. Diese Datei hält die reinen Funktionen dafür und die Prüfungen, die die Verteilung verhindern
oder einen Hinweis brauchen; die Naht in `planSelf` und `computeSettlement` ist Task 4.

**Files:**
- Create: `server/src/hca.ts`
- Modify: `shared/types.ts` (`HcaDeviceLine`), `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/hca.test.ts` (neu)

**Interfaces:**
- Consumes: Task 2 `HcaScale`, `HeatingServiceValue`, `SnapshotMeter` (mit `ratingFactor`, `hcaScale`), `SnapshotReading`; calc.ts `meterSegments`; PR 1 `dayBefore`, `germanDate`, `Period`; `andList` (`shared/wording.ts`); PR 10 `CaptureMethod` (`shared/types.ts`), `SelfMeter`, `SelfReading` (heating.ts; `SelfMeter` bekommt in Task 4 das Feld `factor`).
- Produces:
  - `shared/types.ts`: `type HcaDeviceLine = { unitId: string; meterId: string; name: string; scale: HcaScale; factor: number; raw: number; rated: number }`
  - `server/src/hca.ts`:
    - `type HcaMeter = Pick<SnapshotMeter, 'id' | 'unitId' | 'type'> & { name?: string; hcaScale?: HcaScale | null; ratingFactor?: number | null; heatingPlantId?: string | null }`
    - `ratingOf(m: HcaMeter): { ok: true; factor: number; scale: HcaScale } | { ok: false; missing: 'scale' | 'factor' }`
    - `meterFactor(m: HcaMeter): number`
    - `serviceMeters(rows: readonly HeatingServiceValue[], units: readonly { id: string; name: string }[], part: 'heat' | 'water'): { meters: SelfMeter[]; readings: SelfReading[] } | null`
    - `type DevicesInput = { capture: CaptureMethod; unitIds: readonly string[]; meters: readonly HcaMeter[]; readings: readonly SnapshotReading[] }`, `deviceLines(i: DevicesInput, h: Period): HcaDeviceLine[]`
    - `type MixedCapture = { heatMeterUnits: string[]; hcaUnits: string[] }`, `mixedCapture(capture, unitIds, meters): MixedCapture | null`
    - `type MissingRating = { meterId: string; name: string; unitId: string; missing: 'scale' | 'factor' }`, `missingRatings(capture, unitIds, meters): MissingRating[]`
    - `type DeviceCutoff = { meterId: string; name: string; unitId: string; date: string }`, `deviceCutoffs(meters, readings, unitIds, h): DeviceCutoff[]`
    - `mixedCaptureText(capture, m, nameOf)`, `missingRatingsText(list, nameOf)` (je `string`, ohne Ort und ohne „Bis dahin …“, beides setzt `computeSettlement` wie bei jedem `SelfBlock` dazu), `deviceCutoffText(where, c, h, nameOf)` (`string`, ein eigener Hinweis)
  - Entfällt gegenüber der ersten Fassung: `HeatSegment`, `UnitHeatDevices`, `heatDevicesOf`, `serviceSegments`, `serviceWaterDevicesOf`, `ratedSegments` (Prüfbericht B.1, Zeile C2/C3).

- [ ] **Step 1: Failing test schreiben**

Datei `server/test/hca.test.ts`:

```ts
// Heizkostenverteiler und Werte eines Ablesedienstes (Heizung PR 12, Entwurf 8.1, 12.2). Jede Zahl ist
// von Hand nachgerechnet; der Kommentar am Test nennt die Rechnung. Die Verteilung über planSelf prüft
// heating.test.ts (Task 4), die Abrechnung calc-hkv.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deviceCutoffs, deviceCutoffText, deviceLines, meterFactor, missingRatings, missingRatingsText, mixedCapture, mixedCaptureText,
  ratingOf, serviceMeters, type HcaMeter,
} from '../src/hca.ts'
import type { SnapshotReading } from '../src/snapshot.ts'
import type { HeatingServiceValue } from '../../shared/types.ts'
import { periodKey } from '../../shared/period.ts'

const H = { from: '2025-01-01', to: '2025-12-31' }
const hkv = (id: string, unitId: string, over: Partial<HcaMeter> = {}): HcaMeter =>
  ({ id, unitId, type: 'hkv', name: id, hcaScale: 'unit', ratingFactor: 1, heatingPlantId: null, ...over })
const read = (meterId: string, date: string, value: number, over: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId, date, value, ...over })
const nameOf = (id: string) => `Wohnung ${id.toUpperCase()}`
const rated = (lines: ReturnType<typeof deviceLines>, unitId: string) =>
  Math.round(lines.filter((l) => l.unitId === unitId).reduce((a, l) => a + l.rated, 0) * 1000) / 1000

test('Skala und Faktor: Produktskala zählt wie abgelesen, Einheitsskala mal Faktor; ohne Skala oder Faktor kein Wert', () => {
  assert.deepEqual(ratingOf(hkv('x', 'a', { hcaScale: 'product', ratingFactor: null })), { ok: true, factor: 1, scale: 'product' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { ratingFactor: 1.25 })), { ok: true, factor: 1.25, scale: 'unit' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { ratingFactor: null })), { ok: false, missing: 'factor' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { hcaScale: null })), { ok: false, missing: 'scale' })
  // Der Faktor am Zähler für planSelf: Wärmezähler und Wasserzähler 1, fehlende Angaben 1 (dann verteilt
  // die Anlage ohnehin nicht, `missingRatings`).
  assert.deepEqual([meterFactor(hkv('x', 'a', { ratingFactor: 0.8 })), meterFactor(hkv('x', 'a', { hcaScale: 'product' })), meterFactor(hkv('x', 'a', { ratingFactor: null }))], [0.8, 1, 1])
  assert.equal(meterFactor({ id: 'w', unitId: 'a', type: 'waerme' }), 1)
})

test('HKV mit Faktoren 0,8 und 1,25 (Entwurf 12.2): 500 · 1,25 + 200 · 0,8 = 785 von 7.850 Einheiten, also ein Zehntel', () => {
  const meters = [hkv('a1', 'a', { ratingFactor: 1.25 }), hkv('a2', 'a', { ratingFactor: 0.8 }), hkv('b1', 'b', { hcaScale: 'product', ratingFactor: null })]
  const readings = [
    read('a1', '2024-12-31', 0), read('a1', '2025-12-31', 500),
    read('a2', '2024-12-31', 0), read('a2', '2025-12-31', 200),
    read('b1', '2024-12-31', 0), read('b1', '2025-12-31', 7065),
  ]
  const lines = deviceLines({ capture: 'hca', unitIds: ['a', 'b'], meters, readings }, H)
  assert.deepEqual(lines.map((l) => [l.meterId, l.scale, l.factor, l.raw, Math.round(l.rated * 1000) / 1000]), [
    ['a1', 'unit', 1.25, 500, 625], ['a2', 'unit', 0.8, 200, 160], ['b1', 'product', 1, 7065, 7065],
  ])
  assert.deepEqual([rated(lines, 'a'), rated(lines, 'b')], [785, 7065])
  assert.equal(rated(lines, 'a') / (rated(lines, 'a') + rated(lines, 'b')), 0.1)
  assert.deepEqual(deviceLines({ capture: 'heatMeter', unitIds: ['a', 'b'], meters, readings }, H), [])
})

test('Tausch eines Geräts mit anderem Faktor (Review Focus 1): altes und neues Gerät je mit ihrem Faktor', () => {
  // 300 · 1,25 = 375 bis zum Tausch, danach 250 · 0,8 = 200; zusammen 575.
  const meters = [hkv('d-alt', 'd', { ratingFactor: 1.25 }), hkv('d-neu', 'd', { ratingFactor: 0.8 })]
  const readings = [read('d-alt', '2024-12-31', 0), read('d-alt', '2025-06-15', 300), read('d-neu', '2025-06-15', 0), read('d-neu', '2025-12-31', 250)]
  assert.equal(rated(deviceLines({ capture: 'hca', unitIds: ['d'], meters, readings }, H), 'd'), 575)
})

test('Stichtagswert (Entwurf 8.1): Rücksetzen wie ein Zählerwechsel; mitten in der Heizperiode ein Hinweis, am Beginn oder Ende nicht', () => {
  // Bis 30.06. 420 Einheiten (Stichtagswert), danach 180; zusammen 600.
  const meters = [hkv('c1', 'c', { hcaScale: 'product', ratingFactor: null })]
  const mitte = [read('c1', '2024-12-31', 0), read('c1', '2025-06-30', 0, { replacement: true, oldEndValue: 420 }), read('c1', '2025-12-31', 180)]
  assert.equal(rated(deviceLines({ capture: 'hca', unitIds: ['c'], meters, readings: mitte }, H), 'c'), 600)
  const cut = deviceCutoffs(meters, mitte, ['c'], H)
  assert.deepEqual(cut, [{ meterId: 'c1', name: 'c1', unitId: 'c', date: '2025-06-30' }])
  const first = cut[0] ?? assert.fail('kein Stichtag')
  assert.match(deviceCutoffText('Heizung, Heizperiode 2025', first, H, nameOf), /„c1“ \(Wohnung C\) hat am 30\.06\.2025 auf null zurückgesetzt; die Heizperiode beginnt aber am 01\.01\.2025/)
  // Am Tag vor dem Beginn und am letzten Tag: kein Hinweis; in der Heizperiode zählen 650 Einheiten.
  const amRand = [read('c1', '2023-12-31', 0), read('c1', '2024-12-31', 0, { replacement: true, oldEndValue: 900 }), read('c1', '2025-12-31', 0, { replacement: true, oldEndValue: 650 })]
  assert.deepEqual(deviceCutoffs(meters, amRand, ['c'], H), [])
  assert.equal(rated(deviceLines({ capture: 'hca', unitIds: ['c'], meters, readings: amRand }, H), 'c'), 650)
})

test('Gemischte Geräte (§ 5 Abs. 7, Review Focus 4): Wärmezähler neben Heizkostenverteilern; Warmwasserzähler und Zähler der Anlage zählen nicht', () => {
  const wz = (id: string, unitId: string): HcaMeter => ({ id, unitId, type: 'waerme', name: id, heatingPlantId: null })
  const ww: HcaMeter = { id: 'ww-a', unitId: 'a', type: 'warmwasser', name: 'ww-a', heatingPlantId: null }
  const anlage: HcaMeter = { id: 'speicher', unitId: null, type: 'waerme', name: 'Speicher', heatingPlantId: 'hp' }
  assert.equal(mixedCapture('hca', ['a', 'b'], [hkv('a1', 'a'), hkv('b1', 'b'), ww, anlage]), null)
  assert.equal(mixedCapture('heatMeter', ['a', 'b'], [wz('wa', 'a'), wz('wb', 'b'), ww, anlage]), null)
  const m = mixedCapture('hca', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')])
  assert.deepEqual(m, { heatMeterUnits: ['a'], hcaUnits: ['b'] })
  assert.deepEqual(mixedCapture('heatMeter', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')]), { heatMeterUnits: ['a'], hcaUnits: ['b'] })
  // Ein Gerät an einer Wohnung, die nicht an der Anlage hängt, zählt nicht.
  assert.equal(mixedCapture('hca', ['b'], [wz('wa', 'a'), hkv('b1', 'b')]), null)
  assert.equal(mixedCapture('serviceValues', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')]), null)
  const t = mixedCaptureText('hca', m ?? assert.fail('nicht gemischt'), nameOf)
  assert.match(t, /^Eingestellt ist die Erfassung mit Heizkostenverteilern, an den Wohnungen hängen aber Wärmezähler bei Wohnung A und Heizkostenverteiler bei Wohnung B/)
  assert.match(t, /§ 5 Abs\. 7 HeizkostenV.*Vorerfassung.*Messdienst/s)
  assert.doesNotMatch(t, /Bis dahin/)
})

test('Fehlende Skala oder fehlender Faktor (hca-factor-missing): je Gerät benannt, nur bei Erfassung mit Heizkostenverteilern', () => {
  const meters = [hkv('a1', 'a', { name: 'Wohnzimmer', ratingFactor: null }), hkv('b1', 'b', { name: 'Bad', hcaScale: null }), hkv('b2', 'b', { ratingFactor: 0.9 })]
  const list = missingRatings('hca', ['a', 'b'], meters)
  assert.deepEqual(list, [
    { meterId: 'a1', name: 'Wohnzimmer', unitId: 'a', missing: 'factor' },
    { meterId: 'b1', name: 'Bad', unitId: 'b', missing: 'scale' },
  ])
  assert.deepEqual(missingRatings('heatMeter', ['a', 'b'], meters), [])
  assert.match(missingRatingsText(list, nameOf), /^Bei diesen Heizkostenverteilern fehlt „Wohnzimmer“ \(Wohnung A\): der Bewertungsfaktor und „Bad“ \(Wohnung B\): die Skala.*als neuen Zähler an/s)
})

test('Werte des Ablesedienstes als gedachter Zähler je Wohnung: kumulierte Stände, Lücken bleiben Lücken (Review Focus 2)', () => {
  const p = periodKey('2025-01')
  const rows: HeatingServiceValue[] = [
    { plantId: 'hp', period: p, unitId: 'a', from: '2025-10-15', to: '2025-12-31', heatValue: 100, waterValue: 3 },
    { plantId: 'hp', period: p, unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: 12 },
    { plantId: 'hp', period: p, unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800, waterValue: 20 },
  ]
  const units = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  const heat = serviceMeters(rows, units, 'heat') ?? assert.fail('keine Werte')
  assert.deepEqual(heat.meters.map((m) => [m.id, m.unitId, m.type, m.factor]), [
    ['ablesedienst-heizung:a', 'a', 'waerme', 1], ['ablesedienst-heizung:b', 'b', 'waerme', 1],
  ])
  // A: 0 am 31.12.2024, 340 am 30.09.2025, 440 am 31.12.2025. Am 14.10. (Tag vor der zweiten Zeile)
  // steht kein Stand: Eine Grenze in der Lücke findet keine Ablesung, und PR 10 geht den Weg der
  // fehlenden Zwischenablesung bzw. des fehlenden Werts. C hat keine Zeile und keinen Zähler.
  assert.deepEqual(heat.readings.filter((r) => r.meterId === 'ablesedienst-heizung:a').map((r) => [r.date, r.value]), [
    ['2024-12-31', 0], ['2025-09-30', 340], ['2025-12-31', 440],
  ])
  const water = serviceMeters(rows, units, 'water') ?? assert.fail('kein Warmwasser')
  assert.deepEqual(water.readings.filter((r) => r.meterId === 'ablesedienst-warmwasser:b').map((r) => [r.date, r.value]), [['2024-12-31', 0], ['2025-12-31', 20]])
  assert.equal(serviceMeters(rows.map((r) => ({ ...r, waterValue: null })), units, 'water'), null)
})
```

- [ ] **Step 2: Test ausführen, er muss scheitern**

Run: `npm --prefix server test -- test/hca.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `server/src/hca.ts`.

- [ ] **Step 3: Typ (`shared/types.ts`)**

Hinter `HeatingServiceValue` (Task 2):

```ts
// Ein Heizkostenverteiler im Ausweis (Heizung PR 12, Entwurf 8.8): abgelesene Einheiten in der
// Heizperiode, Skala, Faktor und die bewerteten Einheiten, mit denen verteilt wird.
export type HcaDeviceLine = { unitId: string; meterId: string; name: string; scale: HcaScale; factor: number; raw: number; rated: number }
```

- [ ] **Step 4: `server/src/hca.ts` anlegen**

```ts
// Heizkostenverteiler und Werte eines Ablesedienstes (Heizung PR 12, Entwurf 8.1), als reine Funktionen.
//
// § 5 Abs. 1 Satz 1 HeizkostenV lässt Wärmezähler und Heizkostenverteiler gleichrangig zu. Die eigene
// Heizkostenabrechnung (PR 10) rechnet mit dem Grenzmodell: je Zähler eine Ablesung an jeder Grenze
// (Beginn, Wechsel, Ende), Verbrauch ist die Differenz zweier wirklicher Ablesungen (`measuredBetween`),
// summiert je Wohnung in `planSelf`. Diese Datei bringt die beiden neuen Erfassungen in diese Gestalt
// (Abgleich mit PR 10 nach der Prüfung vom 05.10.2026):
//
// - Heizkostenverteiler sind Zähler vom Typ `hkv`; jeder trägt seinen Faktor (`meterFactor`): bei der
//   Einheitsskala den Bewertungsfaktor des Heizkörpers, bei der Produktskala 1. `planSelf` multipliziert
//   die Differenz damit. Der Stichtagswert ist eine Ablesung mit `replacement` (Entwurf 8.1).
// - Werte eines Ablesedienstes werden je Wohnung ein gedachter Zähler (`serviceMeters`) mit kumulierten
//   Ständen: 0 am Tag vor dem Beginn der ersten Zeile und die Summe am Ende jeder Zeile. Eine Lücke
//   zwischen zwei Zeilen ergibt keinen Stand an ihrem Beginn; eine Grenze darin findet keine Ablesung,
//   und PR 10 geht den Weg der fehlenden Zwischenablesung bzw. des fehlenden Werts. Nichts wird
//   interpoliert (Entwurf 8.4).
//
// Skalen und Faktoren nach [M] Haufe HeizKV § 5.3 und Berliner Mieterverein (übernommen);
// ⟨Norm offen: VDI 2077; DIN EN 834⟩ (Entwurf 15.3). Ob ein Faktor stimmt, prüft Mietfuchs nicht
// (Entwurf 16). Diese Datei steht in `ENGINE_FILES` des Wächters (law-literals.test.ts).
import type { CaptureMethod, HcaDeviceLine, HcaScale, HeatingServiceValue } from '../../shared/types.ts'
import { dayBefore, germanDate, type Period } from '../../shared/law/register.ts'
import { andList } from '../../shared/wording.ts'
import { meterSegments } from './calc.ts'
import type { SelfMeter, SelfReading } from './heating.ts'
import type { SnapshotMeter, SnapshotReading } from './snapshot.ts'

export type HcaMeter = Pick<SnapshotMeter, 'id' | 'unitId' | 'type'> & {
  name?: string
  hcaScale?: HcaScale | null
  ratingFactor?: number | null
  heatingPlantId?: string | null
}

const byFrom = <T extends { from: string }>(a: T, b: T): number => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)

// ---------- Faktor ----------

export function ratingOf(m: HcaMeter): { ok: true; factor: number; scale: HcaScale } | { ok: false; missing: 'scale' | 'factor' } {
  const scale = m.hcaScale ?? null
  if (scale === null) return { ok: false, missing: 'scale' }
  if (scale === 'product') return { ok: true, factor: 1, scale }
  const factor = m.ratingFactor ?? null
  return factor !== null && factor > 0 ? { ok: true, factor, scale } : { ok: false, missing: 'factor' }
}

// Der Faktor am Zähler für `planSelf` (`SelfMeter.factor`): beim Heizkostenverteiler der der Skala, sonst
// 1. Fehlt Skala oder Faktor, ebenfalls 1; die Anlage wird dann nicht verteilt (`missingRatings`,
// `heating.hca-factor-missing`), die Zahl also nie benutzt.
export function meterFactor(m: HcaMeter): number {
  if (m.type !== 'hkv') return 1
  const r = ratingOf(m)
  return r.ok ? r.factor : 1
}

// Zähler, die an einer Wohnung der Anlage die Raumwärme erfassen: Wärmezähler und
// Heizkostenverteiler. Warmwasserzähler erfassen das Warmwasser (§ 5 Abs. 1 Satz 1, eigene
// Erfassung), Zähler mit `heatingPlantId` gehören zur Anlage selbst (PR 4).
const isRoomHeat = (m: HcaMeter, ids: ReadonlySet<string>): boolean =>
  m.unitId !== null && ids.has(m.unitId) && (m.heatingPlantId ?? null) === null && (m.type === 'waerme' || m.type === 'hkv')

// ---------- Ablesedienst ----------

// Je Wohnung mit Zeilen ein gedachter Zähler (`ablesedienst-heizung:<Wohnung>` bzw.
// `ablesedienst-warmwasser:<Wohnung>`, Faktor 1) und seine kumulierten Stände. Beim Warmwasser `null`,
// wenn keine Zeile einen Wert dafür hat: Dann zählen die Warmwasserzähler (Abweichung 3).
export function serviceMeters(rows: readonly HeatingServiceValue[], units: readonly { id: string; name: string }[], part: 'heat' | 'water'): { meters: SelfMeter[]; readings: SelfReading[] } | null {
  if (part === 'water' && rows.every((r) => r.waterValue === null)) return null
  const meters: SelfMeter[] = []
  const readings: SelfReading[] = []
  for (const u of units) {
    const own = rows.filter((r) => r.unitId === u.id).slice().sort(byFrom)
    const first = own[0]
    if (!first) continue
    const id = `ablesedienst-${part === 'heat' ? 'heizung' : 'warmwasser'}:${u.id}`
    meters.push({ id, name: `Ablesedienst ${u.name}`, unitId: u.id, type: part === 'heat' ? 'waerme' : 'warmwasser', factor: 1 })
    readings.push({ meterId: id, date: dayBefore(first.from), value: 0 })
    let sum = 0
    for (const r of own) {
      sum += part === 'heat' ? r.heatValue : (r.waterValue ?? 0)
      readings.push({ meterId: id, date: r.to, value: sum })
    }
  }
  return { meters, readings }
}

// ---------- Ausweis je Gerät ----------

export type DevicesInput = {
  capture: CaptureMethod
  unitIds: readonly string[]
  meters: readonly HcaMeter[]
  readings: readonly SnapshotReading[]
}

// Je Heizkostenverteiler die Einheiten der Heizperiode für den Ausweis (Entwurf 8.8: „bei HKV je Gerät;
// bei der Einheitsskala muss der Faktor in der Abrechnung stehen“). Gezählt werden die Segmente ganz in
// der Heizperiode; die Verteilung auf Nutzer macht `planSelf` (PR 10).
export function deviceLines(i: DevicesInput, h: Period): HcaDeviceLine[] {
  if (i.capture !== 'hca') return []
  const ids = new Set(i.unitIds)
  const start = dayBefore(h.from)
  return i.meters
    .filter((m) => isRoomHeat(m, ids) && m.type === 'hkv')
    .flatMap((m) => {
      const rating = ratingOf(m)
      if (!rating.ok) return []
      const raw = meterSegments(i.readings.filter((r) => r.meterId === m.id))
        .segments.filter((s) => s.from >= start && s.to <= h.to)
        .reduce((a, s) => a + s.delta, 0)
      return [{ unitId: m.unitId ?? '', meterId: m.id, name: m.name ?? '', scale: rating.scale, factor: rating.factor, raw, rated: raw * rating.factor }]
    })
}

// ---------- Was die Verteilung verhindert oder einen Hinweis braucht ----------

export type MixedCapture = { heatMeterUnits: string[]; hcaUnits: string[] }

// § 5 Abs. 7 HeizkostenV: nicht mit gleichen Ausstattungen erfasst. Gemischt heißt hier: Wärmezähler und
// Heizkostenverteiler an Wohnungen derselben Anlage, oder ein Gerät, das nicht zur eingestellten
// Erfassung passt (Abweichung 1 des Plans PR 12). Beim Ablesedienst liefert der Dienst die Werte.
export function mixedCapture(capture: CaptureMethod, unitIds: readonly string[], meters: readonly HcaMeter[]): MixedCapture | null {
  if (capture === 'serviceValues') return null
  const ids = new Set(unitIds)
  const room = meters.filter((m) => isRoomHeat(m, ids))
  const unitsWith = (type: 'waerme' | 'hkv'): string[] => [...new Set(room.filter((m) => m.type === type).flatMap((m) => (m.unitId !== null ? [m.unitId] : [])))]
  const heatMeterUnits = unitsWith('waerme')
  const hcaUnits = unitsWith('hkv')
  const foreign = capture === 'hca' ? heatMeterUnits : hcaUnits
  return foreign.length > 0 ? { heatMeterUnits, hcaUnits } : null
}

export type MissingRating = { meterId: string; name: string; unitId: string; missing: 'scale' | 'factor' }

export function missingRatings(capture: CaptureMethod, unitIds: readonly string[], meters: readonly HcaMeter[]): MissingRating[] {
  if (capture !== 'hca') return []
  const ids = new Set(unitIds)
  return meters
    .filter((m) => isRoomHeat(m, ids) && m.type === 'hkv')
    .flatMap((m) => {
      const r = ratingOf(m)
      return r.ok ? [] : [{ meterId: m.id, name: m.name ?? '', unitId: m.unitId ?? '', missing: r.missing }]
    })
}

export type DeviceCutoff = { meterId: string; name: string; unitId: string; date: string }

// Ein Heizkostenverteiler, der innerhalb der Heizperiode auf null zurücksetzt (Ablesung mit
// `replacement` und Wert 0). Am Tag vor dem Beginn oder am letzten Tag ist der Stichtag des Geräts der der
// Heizperiode (Abweichung 2 des Plans PR 12).
export function deviceCutoffs(meters: readonly HcaMeter[], readings: readonly SnapshotReading[], unitIds: readonly string[], h: Period): DeviceCutoff[] {
  const ids = new Set(unitIds)
  return meters
    .filter((m) => isRoomHeat(m, ids) && m.type === 'hkv')
    .flatMap((m) =>
      readings
        .filter((r) => r.meterId === m.id && r.replacement === true && r.value === 0 && r.date >= h.from && r.date < h.to)
        .map((r) => ({ meterId: m.id, name: m.name ?? '', unitId: m.unitId ?? '', date: r.date })))
}

// ---------- Sätze ----------

const CAPTURE_WORDS: Record<CaptureMethod, string> = {
  heatMeter: 'Wärmezählern',
  hca: 'Heizkostenverteilern',
  serviceValues: 'Werten eines Ablesedienstes',
}

// Ohne Ort und ohne Folge: `computeSettlement` setzt beides wie bei jedem Grund, der die Anlage nicht
// verteilbar macht, davor bzw. dahinter (PR 10 Task 8: „Bis dahin verteilt Mietfuchs …“).
export function mixedCaptureText(capture: CaptureMethod, m: MixedCapture, nameOf: (unitId: string) => string): string {
  const parts = [
    ...(m.heatMeterUnits.length > 0 ? [`Wärmezähler bei ${andList(m.heatMeterUnits.map(nameOf))}`] : []),
    ...(m.hcaUnits.length > 0 ? [`Heizkostenverteiler bei ${andList(m.hcaUnits.map(nameOf))}`] : []),
  ]
  // #218: Vorerfassung nach Nutzergruppen kommt mit einer eigenen Erweiterung.
  return `Eingestellt ist die Erfassung mit ${CAPTURE_WORDS[capture]}, an den Wohnungen hängen aber ${andList(parts)}. ` +
    'Wird der Verbrauch nicht mit gleichen Geräten erfasst, ist nach § 5 Abs. 7 HeizkostenV zuerst der Anteil jeder Gruppe am Gesamtverbrauch vorab zu erfassen (Vorerfassung). Das rechnet Mietfuchs noch nicht. ' +
    'Lassen Sie diese Heizkosten von einem Messdienst abrechnen und übernehmen Sie dessen Beträge als Einzelbeträge; steht ein Gerät nur noch in der Liste, weil es ausgebaut ist, nehmen Sie es dort heraus.'
}

export function missingRatingsText(list: readonly MissingRating[], nameOf: (unitId: string) => string): string {
  const items = list.map((x) => `„${x.name || 'ohne Namen'}“ (${nameOf(x.unitId)}): ${x.missing === 'scale' ? 'die Skala' : 'der Bewertungsfaktor'}`)
  return `Bei ${list.length === 1 ? 'diesem Heizkostenverteiler' : 'diesen Heizkostenverteilern'} fehlt ${andList(items)}. ` +
    'Bei der Einheitsskala zählt der Ablesewert erst mal dem Bewertungsfaktor des Heizkörpers, und der Faktor muss in der Abrechnung stehen; bei der Produktskala ist er eingerechnet. ' +
    'Skala und Faktor stehen auf dem Gerät oder in den Unterlagen des Herstellers oder Messdienstes. Ein Gerät mit anderem Faktor, etwa nach einem Tausch, legen Sie als neuen Zähler an.'
}

export function deviceCutoffText(where: string, c: DeviceCutoff, h: Period, nameOf: (unitId: string) => string): string {
  return `${where}: Der Heizkostenverteiler „${c.name || 'ohne Namen'}“ (${nameOf(c.unitId)}) hat am ${germanDate(c.date)} auf null zurückgesetzt; die Heizperiode beginnt aber am ${germanDate(h.from)}. ` +
    'Mietfuchs rechnet mit den abgelesenen Werten, wie sie sind, und schätzt nichts dazwischen; für den Verbrauch der Heizperiode braucht es deshalb Werte zu ihrem Beginn und Ende. ' +
    'Lassen Sie den Stichtag der Geräte auf den Beginn der Heizperiode stellen, oder tragen Sie zu Beginn und Ende die Werte laut Gerätespeicher ein.'
}
```

`hca.ts` importiert `meterSegments` aus calc.ts, und calc.ts importiert hca.ts (Task 4). Der Kreis ist
harmlos, denn keine der beiden Dateien ruft beim Laden etwas aus der anderen auf; es sind nur
Funktionsdeklarationen. Ein Test, der hca.ts allein lädt (Step 1), zeigt es. Aus heating.ts kommen nur
Typen (`import type`).

- [ ] **Step 5: Wächter (`server/test/law-literals.test.ts`)**

`'server/src/hca.ts'` in `ENGINE_FILES` aufnehmen.

- [ ] **Step 6: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/hca.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (`hca.test.ts`: 7 Tests). Der Typfehler „`factor` does not exist in type `SelfMeter`“
in `serviceMeters` verschwindet erst mit Task 4 Step 3; deshalb kommt die Zeile `factor?: number` an
`SelfMeter` schon in diesem Step (heating.ts, Code in Task 4 Step 3, erster Block).

- [ ] **Step 7: Commit**

Run: `npm test`
Expected: PASS (hca.ts wird noch nicht aufgerufen).

```bash
git add shared/types.ts server/src/hca.ts server/src/heating.ts server/test/hca.test.ts server/test/law-literals.test.ts
git commit -m "Heizkostenverteiler und Ablesedienst als reine Funktionen

Faktor am Zähler (Einheitsskala mit Bewertungsfaktor, Produktskala 1), Werte eines
Ablesedienstes als gedachter Zähler mit kumulierten Ständen, Ausweis je Gerät, gemischte Geräte
nach § 5 Abs. 7 HeizkostenV, fehlende Faktoren und Rücksetzungen mitten in der Heizperiode.

Refs #99"
```

---
### Task 4: Naht zu PR 10: Faktor am Zähler, Gerätetyp nach Erfassung, Ablesedienst, Fehler, Ausweis

Neu gefasst nach der Prüfung vom 05.10.2026. Die Stelle, an der PR 10 den Verbrauch je Wohnung bildet, ist
`planSelf` mit dem inneren Helfer `metersOf(unitId, pot)` (Typ aus `POT_METER`) und der Summe
`v += result.value` je Grenzpaar. Dort setzt diese PR an: Der Gerätetyp der Heizung folgt der Erfassung
(`hkv` bei Heizkostenverteilern), jede Differenz zählt mit dem Faktor ihres Zählers, und die Werte eines
Ablesedienstes kommen als gedachte Zähler (Task 3) in die Eingabe von `planSelf`. Was die Verteilung
verhindert, kommt in die Liste `blocked: SelfBlock[]` von PR 10; deren Code-Vereinigung wird um zwei Codes
erweitert. Der Ausweis je Gerät und die Werte des Ablesedienstes hängen an `self`.

**Files:**
- Modify: `server/src/heating.ts`, `server/src/calc.ts`, `shared/types.ts` (`SelfHeatingStatement.devices`, `.serviceValues`, `SelfPotView.consumptionUnit`), `server/testing/selfHeating.ts` (Option `serviceValues`)
- Test: `server/test/heating.test.ts` (ergänzen), `server/test/calc-hkv.test.ts` (neu)

**Interfaces:**
- Consumes: Task 3 `meterFactor`, `serviceMeters`, `mixedCapture`, `mixedCaptureText`, `missingRatings`, `missingRatingsText`, `deviceCutoffs`, `deviceCutoffText`, `deviceLines`, `HcaDeviceLine`; Task 2 `Snapshot.heatingServiceValues`, `SnapshotMeter.hcaScale`, `.ratingFactor`.
  PR 10 (Plan, Commit `81828af`): heating.ts `SelfMeter`, `SelfInput`, `planSelf` mit `metersOf`, `POT_METER`, `measuredBetween`; calc.ts im Block des Plans `hotWater`, `potTypes`, `unitMeters`, `served`, `servedIds`, `input` (PR 10 Task 9 Step 4: `const input: SelfInput = { … }`), `plan`, `blocked`, `where`, `selfProblemText(p, areaBasisHeat)`, `type SelfBlock`, `type SelfPlantPlan`, `selfPlans.set(…)`, `POT_UNIT`, `selfSteps`, `selfStatementOf`; Testhelfer `input`, `r`, `userOf`, `near`, `UNITS`, `TENANCIES` (heating.test.ts).
  PR 11: `server/testing/selfHeating.ts` (`selfSnapshot`, `SelfSnapshotOptions`), Kennungen `wz-a`, `wz-b`, `wz-c`, `ww`, Anlage `hp`.
- Produces:
  - `heating.ts`: `SelfMeter.factor?: number` (fehlt: 1), `SelfInput.capture?: CaptureMethod` (fehlt: `heatMeter`); in `planSelf` `meterTypeOf(pot)`
  - calc.ts: `SelfBlock['code']` + `'heating.mixed-capture' | 'heating.hca-factor-missing'`; `SelfPlantPlan.capture: CaptureMethod`, `.devices: HcaDeviceLine[]`, `.serviceValues: HeatingServiceValue[]`; `potUnitOf(sp, pot): 'kWh' | 'm³' | 'Einheiten'`; `selfProblemText(p, areaBasisHeat, capture = 'heatMeter')`
  - `shared/types.ts`: `SelfHeatingStatement.devices?: HcaDeviceLine[]`, `SelfHeatingStatement.serviceValues?: HeatingServiceValue[]`; `SelfPotView.consumptionUnit: 'kWh' | 'm³' | 'Einheiten'`
  - `noticeKinds` + `'heating.device-cutoff'` (warning), `'heating.mixed-capture'` (error), `'heating.hca-factor-missing'` (error)
  - `server/testing/selfHeating.ts`: `SelfSnapshotOptions.serviceValues?: HeatingServiceValue[]`

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/heating.test.ts` (PR 10): anhängen.

```ts
// ---------- Heizkostenverteiler und Ablesedienst im Grenzmodell (Heizung PR 12) ----------

// Beispiel A ohne Warmwasser, mit Heizkostenverteilern statt Wärmezählern: A zwei Geräte mit Einheitsskala
// (Faktor 1,25 und 0,8), B eins mit Produktskala, C eins mit Faktor 2 und dem Wechsel am 30.09.
const HKV: SelfMeter[] = [
  { id: 'a1', name: 'A Wohnzimmer', unitId: 'a', type: 'hkv', factor: 1.25 }, { id: 'a2', name: 'A Bad', unitId: 'a', type: 'hkv', factor: 0.8 },
  { id: 'b1', name: 'B', unitId: 'b', type: 'hkv', factor: 1 }, { id: 'c1', name: 'C', unitId: 'c', type: 'hkv', factor: 2 },
]
const HKV_READINGS: SelfReading[] = [
  r('a1', '2024-12-31', 0), r('a1', '2025-12-31', 500), r('a2', '2024-12-31', 0), r('a2', '2025-12-31', 200),
  r('b1', '2024-12-31', 0), r('b1', '2025-12-31', 7065),
  r('c1', '2024-12-31', 0), r('c1', '2025-09-30', 300), r('c1', '2025-12-31', 500),
]

test('HKV im Grenzmodell: Differenz mal Faktor des Geräts; Zwischenablesung je Gerät wie bei Wärmezählern', () => {
  const plan = planSelf(input({ hotWater: 'none', capture: 'hca', meters: HKV, readings: HKV_READINGS }))
  assert.deepEqual(plan.problems, [])
  // A: 500 · 1,25 + 200 · 0,8 = 785; B: 7.065; C1: 300 · 2 = 600; C2: 200 · 2 = 400.
  near(userOf(plan, 'A').pots.heating.value ?? -1, 785, 'A')
  near(userOf(plan, 'B').pots.heating.value ?? -1, 7065, 'B')
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 600, 'C1')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 400, 'C2')
  near(plan.totals.heating.consumption, 8850, 'Summe')
  // Wärmezähler an einer Wohnung zählen bei Erfassung mit Heizkostenverteilern nicht (das meldet
  // `mixedCapture` in calc.ts); ohne Gerät des richtigen Typs fehlt der Wert.
  const ohne = planSelf(input({ hotWater: 'none', capture: 'hca', meters: HKV.filter((m) => m.unitId !== 'b'), readings: HKV_READINGS }))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'missing' ? [p.unitId, p.reason] : p.kind)), [['b', 'noMeter']])
  // Ohne `capture` rechnet planSelf wie in PR 10 mit Wärmezählern; die Geräte vom Typ `hkv` zählen dann nicht.
  assert.equal(planSelf(input({ hotWater: 'none', meters: HKV, readings: HKV_READINGS })).totals.heating.measured, false)
})

test('Ablesedienst als gedachter Zähler: Zeilen je Nutzungszeitraum ergeben dieselben Werte; eine Lücke an einem Wechsel ist eine fehlende Zwischenablesung', () => {
  const svc = (unitId: string, values: [string, string, number][]) => {
    const id = `ablesedienst-heizung:${unitId}`
    const first = values[0] ?? assert.fail('keine Zeile')
    const readings: SelfReading[] = [r(id, '2024-12-31', 0)]
    let sum = 0
    for (const [, to, v] of values) {
      sum += v
      readings.push(r(id, to, sum))
    }
    return { meter: { id, name: `Ablesedienst ${unitId}`, unitId, type: 'waerme' as const, factor: 1 }, readings, first }
  }
  const a = svc('a', [['2025-01-01', '2025-12-31', 12000]])
  const b = svc('b', [['2025-01-01', '2025-12-31', 16000]])
  const c = svc('c', [['2025-01-01', '2025-09-30', 7200], ['2025-10-01', '2025-12-31', 4800]])
  const plan = planSelf(input({ hotWater: 'none', capture: 'serviceValues', meters: [a.meter, b.meter, c.meter], readings: [...a.readings, ...b.readings, ...c.readings] }))
  assert.deepEqual(plan.problems, [])
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 7200, 'C1 wie mit Wärmezähler')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 4800, 'C2')
  // Lücke: C hat nur eine Zeile bis 15.09., dann ab 01.10. Am 30.09. (Wechsel) steht kein eigener Stand;
  // die Ablesung vom 15.09. liegt 15 Tage daneben und gilt wie abgelesen (PR 10, Abweichung 9), es wird
  // nichts aufgefüllt.
  const luecke = svc('c', [['2025-01-01', '2025-09-15', 7000], ['2025-10-01', '2025-12-31', 4800]])
  const mitLuecke = planSelf(input({ hotWater: 'none', capture: 'serviceValues', meters: [a.meter, b.meter, luecke.meter], readings: [...a.readings, ...b.readings, ...luecke.readings] }))
  near(userOf(mitLuecke, 'C1').pots.heating.value ?? -1, 7000, 'C1 bis zur letzten Zeile')
  near(userOf(mitLuecke, 'C2').pots.heating.value ?? -1, 4800, 'C2')
  assert.ok(mitLuecke.findings.some((f) => f.kind === 'interimOff' && f.boundary === '2025-09-30' && f.readingDate === '2025-09-15'))
})
```

Den Typimport aus `'../src/heating.ts'` um `type SelfMeter, type SelfReading` ergänzen, soweit nicht
schon da.

(b) Datei `server/test/calc-hkv.test.ts`:

```ts
// Heizkostenverteiler und Ablesedienst in der eigenen Heizkostenabrechnung (Heizung PR 12). Kern ist
// die Gleichrangigkeit nach § 5 Abs. 1 Satz 1 HeizkostenV: Dieselben bewerteten Einheiten ergeben
// dieselben Beträge, ob sie von Wärmezählern, Heizkostenverteilern oder einem Ablesedienst kommen.
// Grundlage ist Beispiel A aus server/testing/selfHeating.ts (PR 11): Wärmezähler `wz-a`, `wz-b`,
// `wz-c`, Anlage `hp`, Heizperiode 2025.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, meterSegments, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import type { HeatingServiceValue } from '../../shared/types.ts'
import { dayAfter } from '../../shared/law/register.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const amounts = (s: ComputedSettlement) => s.statements.map((st) => [st.tenancyId, st.totalShareCents, st.rows.map((r) => [r.costItemId, r.shareCents])])
const HEAT = ['wz-a', 'wz-b', 'wz-c']
const withCapture = (s: Snapshot, capture: 'heatMeter' | 'hca' | 'serviceValues'): Snapshot => ({
  ...s, heatingPlants: (s.heatingPlants ?? []).map((p) => (p.id === 'hp' ? { ...p, capture } : p)),
})

// Die Wärmezähler von Beispiel A als Heizkostenverteiler mit Einheitsskala und Faktor 2, die Ablesungen
// halbiert: dieselben bewerteten Einheiten.
function asHca(s: Snapshot, factor: number | null = 2): Snapshot {
  return {
    ...withCapture(s, 'hca'),
    meters: s.meters.map((m) => (HEAT.includes(m.id) ? { ...m, type: 'hkv' as const, hcaScale: 'unit' as const, ratingFactor: factor } : m)),
    readings: s.readings.map((r): SnapshotReading => (HEAT.includes(r.meterId)
      ? { ...r, value: r.value / 2, ...(r.oldEndValue !== undefined ? { oldEndValue: r.oldEndValue / 2 } : {}) }
      : r)),
  }
}

// Dieselben Werte als Zeilen eines Ablesedienstes: je Segment eines Wärmezählers eine Zeile; die
// Wärmezähler der Wohnungen fallen weg.
function asService(): Snapshot {
  const base = selfSnapshot()
  const rows: HeatingServiceValue[] = base.meters.filter((m) => HEAT.includes(m.id)).flatMap((m) =>
    meterSegments(base.readings.filter((r) => r.meterId === m.id)).segments
      .filter((seg) => seg.from >= '2024-12-31' && seg.to <= '2025-12-31')
      .map((seg) => ({ plantId: 'hp', period: base.period.key, unitId: m.unitId ?? '', from: dayAfter(seg.from), to: seg.to, heatValue: seg.delta, waterValue: null })))
  return withCapture(selfSnapshot({ serviceValues: rows, meters: base.meters.filter((m) => !HEAT.includes(m.id)) }), 'serviceValues')
}

test('Wärmezähler wie bisher (Beispiel A, F16): keine neuen Hinweise, kein Geräteausweis', () => {
  const s = computeSettlement(selfSnapshot())
  for (const c of ['heating.device-cutoff', 'heating.mixed-capture', 'heating.hca-factor-missing']) assert.ok(!codes(s).includes(c), c)
  assert.equal(selfOf(s).devices, undefined)
  assert.equal(selfOf(s).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'kWh')
})

test('§ 5 Abs. 1 Satz 1: Heizkostenverteiler mit denselben bewerteten Einheiten ergeben dieselben Beträge wie Wärmezähler', () => {
  const base = selfSnapshot()
  const hca = computeSettlement(asHca(base))
  assert.deepEqual(amounts(hca), amounts(computeSettlement(base)))
  assert.ok(!codes(hca).some((c) => c === 'heating.hca-factor-missing' || c === 'heating.mixed-capture'), codes(hca).join(', '))
  const lines = selfOf(hca).devices ?? assert.fail('kein Geräteausweis')
  assert.deepEqual(lines.map((l) => l.meterId), HEAT)
  assert.ok(lines.every((l) => l.scale === 'unit' && l.factor === 2 && l.rated === l.raw * 2))
  assert.equal(selfOf(hca).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'Einheiten')
})

test('Ablesedienst mit denselben Einheiten: dieselben Beträge; die Zeilen stehen im Ausweis', () => {
  const service = computeSettlement(asService())
  assert.deepEqual(amounts(service), amounts(computeSettlement(selfSnapshot())))
  assert.equal((selfOf(service).serviceValues ?? []).length, 4)
})

test('Fehlender Faktor (hca-factor-missing) und gemischte Geräte (mixed-capture): Fehler mit Satz, Anlage nicht verteilt', () => {
  const ohneFaktor = computeSettlement(asHca(selfSnapshot(), null))
  const n = ohneFaktor.notices.find((x) => x.code === 'heating.hca-factor-missing') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /fehlt .*der Bewertungsfaktor.*Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht/s)
  const gemischt = asHca(selfSnapshot())
  const zurueck: Snapshot = { ...gemischt, meters: gemischt.meters.map((m) => (m.id === 'wz-a' ? { ...m, type: 'waerme' as const, hcaScale: null, ratingFactor: null } : m)) }
  const m = computeSettlement(zurueck).notices.find((x) => x.code === 'heating.mixed-capture') ?? assert.fail('kein Fehler')
  assert.equal(m.level, 'error')
  assert.match(m.text, /Vorerfassung/)
})

test('Gerätestichtag mitten in der Heizperiode: Hinweis am Gerät, gerechnet wird mit den Werten, wie sie sind', () => {
  const base = asHca(selfSnapshot())
  const mitReset: Snapshot = { ...base, readings: [...base.readings, { meterId: 'wz-a', date: '2025-06-30', value: 0, replacement: true, oldEndValue: 3000 }] }
  const n = computeSettlement(mitReset).notices.find((x) => x.code === 'heating.device-cutoff') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'wz-a' })
  assert.match(n.text, /hat am 30\.06\.2025 auf null zurückgesetzt/)
})
```

`wz-a` ist nach `asHca` ein Heizkostenverteiler mit 500 Einheiten am 31.12.2024 (1.000 / 2); der
Rücksetzwert 3.000 liegt darüber, der Verbrauch bleibt also nicht negativ.

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/heating.test.ts test/calc-hkv.test.ts`
Expected: FAIL; heating.test.ts mit `capture` und `factor` unbekannt bzw. ohne Verbrauch bei `hkv`,
calc-hkv.test.ts mit `heatingServiceValues` unbekannt an `selfSnapshot` und ohne die drei Codes.

- [ ] **Step 3: Naht in `server/src/heating.ts`**

`SelfMeter` (PR 10 Task 3) ersetzen durch (in Task 3 Step 6 schon geschehen; dann bleibt es):

```ts
// `factor` (Heizung PR 12): Die Differenz zweier Ablesungen zählt mal diesem Faktor; beim
// Heizkostenverteiler mit Einheitsskala der Bewertungsfaktor, sonst 1 (hca.ts `meterFactor`). Fehlt: 1.
export type SelfMeter = { id: string; name: string; unitId: string; type: MeterType; factor?: number }
```

In `SelfInput` als letztes Feld:

```ts
  // Womit die Heizung erfasst wird (Heizung PR 12): bei `hca` die Zähler vom Typ `hkv`; Werte eines
  // Ablesedienstes kommen als gedachte Zähler vom Typ `waerme`/`warmwasser` (hca.ts `serviceMeters`).
  // Fehlt: Wärmezähler wie in PR 10.
  capture?: CaptureMethod
```

(`CaptureMethod` zum Typimport aus `'../../shared/types.ts'`.) In `planSelf` die Zeile
`const metersOf = (unitId: string, pot: SelfPot) => input.meters.filter((m) => m.unitId === unitId && m.type === POT_METER[pot])`
ersetzen durch:

```ts
  const meterTypeOf = (pot: SelfPot): MeterType => (pot === 'heating' && input.capture === 'hca' ? 'hkv' : POT_METER[pot])
  const metersOf = (unitId: string, pot: SelfPot) => input.meters.filter((m) => m.unitId === unitId && m.type === meterTypeOf(pot))
```

und in der Schleife „Verbrauch je Gruppe zwischen ihren äußeren Grenzen“ die Zeile `v += result.value`
durch

```ts
          v += result.value * (m.factor ?? 1)
```

Sonst ändert sich in heating.ts nichts: Grenzen, Zellen, Gruppen nach § 9b Abs. 3, Hinweise neben dem
Stichtag und „keine Interpolation“ gelten für alle drei Erfassungen gleich.

- [ ] **Step 4: Fehler, Hinweis, Ausweis (`server/src/calc.ts`, `shared/types.ts`, Testhelfer)**

`shared/types.ts`: in `SelfHeatingStatement` (PR 10, nach PR 11 mit `dhw`) als letzte Felder

```ts
  // Heizkostenverteiler je Gerät mit Skala und Faktor (Heizung PR 12, Entwurf 8.8) bzw. die Werte des
  // Ablesedienstes; nur bei dieser Erfassung.
  devices?: HcaDeviceLine[]
  serviceValues?: HeatingServiceValue[]
```

und in `SelfPotView` `consumptionUnit: 'kWh' | 'm³'` durch `consumptionUnit: 'kWh' | 'm³' | 'Einheiten'`
ersetzen (Heizkostenverteiler und Ablesedienste zählen Einheiten, keine Kilowattstunden).

`server/src/calc.ts`: Import

```ts
import { deviceCutoffs, deviceCutoffText, deviceLines, meterFactor, missingRatings, missingRatingsText, mixedCapture, mixedCaptureText, serviceMeters } from './hca.ts'
```

und `CaptureMethod, HcaDeviceLine, HeatingServiceValue` in den Typimport aus `'../../shared/types.ts'`.
In `noticeKinds` hinter den Codes von PR 11:

```ts
  // Heizung PR 12 (Entwurf 8.1, 10.1)
  'heating.device-cutoff': { level: 'warning', title: 'Stichtag eines Heizkostenverteilers mitten in der Heizperiode', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  'heating.mixed-capture': { level: 'error', title: 'Verschiedene Geräte in einer Heizanlage', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
  'heating.hca-factor-missing': { level: 'error', title: 'Skala oder Bewertungsfaktor fehlt', rule: 'heating-own-settlement', terms: ['heatCostAllocator'] },
```

`type SelfBlock` (PR 10 Task 8 Step 7) bekommt die beiden Codes:

```ts
  type SelfBlock = {
    code: 'heating.self-incomplete' | 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis' | 'fuel.stock-missing-self' | 'fuel.stock-invalid'
      | 'heating.mixed-capture' | 'heating.hca-factor-missing'
    text: string
  }
```

`type SelfPlantPlan` bekommt als letzte Felder:

```ts
    // Heizung PR 12: die Erfassung, je Heizkostenverteiler die Einheiten und die Werte des Ablesedienstes
    // dieser Heizperiode (für den Ausweis).
    capture: CaptureMethod
    devices: HcaDeviceLine[]
    serviceValues: HeatingServiceValue[]
```

Hinter `POT_UNIT` (PR 10):

```ts
  // Die Einheit des Verbrauchs eines Topfs (Heizung PR 12): Heizkostenverteiler und Ablesedienst zählen
  // Einheiten.
  const potUnitOf = (sp: Pick<SelfPlantPlan, 'capture'>, p: SelfPot): 'kWh' | 'm³' | 'Einheiten' =>
    p === 'water' ? 'm³' : sp.capture === 'heatMeter' ? 'kWh' : 'Einheiten'
```

`selfProblemText` (PR 10) bekommt einen dritten Parameter mit Vorgabe und nennt das Gerät nach der
Erfassung. Die Signatur wird `(p: SelfProblem, areaBasisHeat: string, capture: CaptureMethod = 'heatMeter'): string`,
und die Zeile für `noMeter` wird:

```ts
    if (p.reason === 'noMeter') {
      const device = p.pot === 'water' ? 'Warmwasserzähler' : capture === 'hca' ? 'Heizkostenverteiler' : capture === 'serviceValues' ? 'Wert des Ablesedienstes' : 'Wärmezähler'
      return capture === 'serviceValues' && p.pot === 'heating'
        ? `Für ${p.unitName} fehlen die Werte des Ablesedienstes, die übrigen Wohnungen haben welche. Tragen Sie sie auf der Seite Heizkosten in der Karte „Ablesedienst“ ein.`
        : `${p.unitName} hat keinen ${device}, die übrigen Wohnungen schon. Legen Sie ${p.pot === 'water' || capture === 'heatMeter' ? 'den Zähler' : 'das Gerät'} an und tragen Sie die Stände ein.`
    }
```

Im Block des Plans (PR 10 Task 8 Step 7) die beiden Zeilen

```ts
    const potTypes: MeterType[] = hotWater === 'none' ? ['waerme'] : ['waerme', 'warmwasser']
    const unitMeters = snapshot.meters.flatMap((m) => (m.unitId !== null && (m.heatingPlantId ?? null) === null && potTypes.includes(m.type) ? [{ ...m, unitId: m.unitId }] : []))
```

ersetzen durch:

```ts
    // Heizung PR 12: Die Heizung erfasst je nach Einstellung der Typ `waerme` oder `hkv`; Werte eines
    // Ablesedienstes ersetzen die Zähler der Wohnungen (beim Warmwasser nur, wenn er es liefert).
    const capture: CaptureMethod = plant.capture ?? 'heatMeter'
    const potTypes: MeterType[] = [capture === 'hca' ? 'hkv' : 'waerme', ...(hotWater === 'none' ? [] : ['warmwasser' as const])]
    const unitMeters = snapshot.meters.flatMap((m) => (m.unitId !== null && (m.heatingPlantId ?? null) === null && potTypes.includes(m.type) ? [{ ...m, unitId: m.unitId }] : []))
    const serviceRows = capture === 'serviceValues' ? (snapshot.heatingServiceValues ?? []).filter((v) => v.plantId === plant.id && v.period === period.key) : []
```

Hinter `const servedIds = …`:

```ts
    const svcHeat = capture === 'serviceValues' ? serviceMeters(serviceRows, served, 'heat') : null
    const svcWater = capture === 'serviceValues' && hotWater !== 'none' ? serviceMeters(serviceRows, served, 'water') : null
```

Im Objekt `const input: SelfInput = { … }` (PR 10 Task 9 Step 4) die Felder `meters` und `readings`
ersetzen und `capture` anhängen:

```ts
      meters: [
        ...unitMeters
          .filter((m) => servedIds.has(m.unitId) && !(svcHeat && m.type === 'waerme') && !(svcWater && m.type === 'warmwasser'))
          .map((m) => ({ id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type, factor: meterFactor(m) })),
        ...(svcHeat?.meters ?? []),
        ...(svcWater?.meters ?? []),
      ],
      readings: [
        ...snapshot.readings.map((r) => ({ ...r, boundFor: r.interimFor ?? null })),
        ...(svcHeat?.readings ?? []),
        ...(svcWater?.readings ?? []),
      ],
      capture,
```

Den Text der Fehler aus dem Plan: Im Aufruf `selfProblemText(p, plant.areaBasisHeat ?? 'area')` das dritte
Argument `capture` ergänzen. Unmittelbar vor `const where = …`:

```ts
    // Heizkostenverteiler und Ablesedienst (Heizung PR 12, Entwurf 8.1).
    const unitNameOf = (id: string) => snapshot.units.find((u) => u.id === id)?.name ?? id
    const mixed = mixedCapture(capture, [...servedIds], snapshot.meters)
    if (mixed) blocked.push({ code: 'heating.mixed-capture', text: mixedCaptureText(capture, mixed, unitNameOf) })
    const unrated = missingRatings(capture, [...servedIds], snapshot.meters)
    if (unrated.length > 0) blocked.push({ code: 'heating.hca-factor-missing', text: missingRatingsText(unrated, unitNameOf) })
```

Direkt hinter der Zeile `for (const b of blocked) warn(b.code, …)`:

```ts
    for (const c of deviceCutoffs(snapshot.meters, snapshot.readings, [...servedIds], { from: period.from, to: period.to })) {
      warn('heating.device-cutoff', deviceCutoffText(where, c, { from: period.from, to: period.to }, unitNameOf), { kind: 'meter', id: c.meterId })
    }
```

Im Objekt von `selfPlans.set(plant.id, { … })` als letzte Felder:

```ts
      capture,
      devices: deviceLines({ capture, unitIds: [...servedIds], meters: snapshot.meters, readings: snapshot.readings }, { from: period.from, to: period.to }),
      serviceValues: serviceRows,
```

In `selfSteps` und `selfStatementOf` (PR 10 Task 9) jedes `POT_UNIT[p]` durch `potUnitOf(sp, p)`
ersetzen; in `selfStatementOf` die Zeile `consumptionUnit: p === 'heating' ? 'kWh' : 'm³',` durch
`consumptionUnit: potUnitOf(sp, p),` und im zurückgegebenen Objekt als letzte Felder:

```ts
      ...(sp.devices.length > 0 ? { devices: sp.devices } : {}),
      ...(sp.serviceValues.length > 0 ? { serviceValues: sp.serviceValues } : {}),
```

`snapshot.meters` erfüllt `HcaMeter`, weil `SnapshotMeter` nach Task 2 und PR 4 `name`,
`heatingPlantId`, `hcaScale` und `ratingFactor` führt. `served` sind die angeschlossenen Wohnungen aus
dem Block von PR 10 (`{ id, name, … }`).

`server/testing/selfHeating.ts` (PR 11): `HeatingServiceValue` zum Typimport; in
`SelfSnapshotOptions` als letztes Feld `serviceValues?: HeatingServiceValue[]`; im Objekt `source` von
`selfSnapshot` `heatingServiceValues: o.serviceValues ?? [],` (das Feld `hcaModel` hat `PLANT` seit Task 2).

- [ ] **Step 5: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/heating.test.ts test/calc-hkv.test.ts test/hca.test.ts test/calc-heizkosten.test.ts test/calc-warmwasser.test.ts && npm run typecheck`
Expected: PASS (`calc-hkv.test.ts`: 5 Tests). Der Gleichheitstest von PR 11 (`selfSnapshot` gegen
`beispielA`) bleibt grün: Bei `capture = 'heatMeter'` sind alle Faktoren 1 und die Zähler dieselben.

- [ ] **Step 6: Alle Tests, Golden und Commit**

Run: `npm test`
Expected: PASS; `settlement-golden.test.ts`, `db-golden.test.ts` und `heating-golden.test.ts`
unverändert.

```bash
git add server/src/heating.ts server/src/calc.ts shared/types.ts server/testing/selfHeating.ts server/test/heating.test.ts server/test/calc-hkv.test.ts
git commit -m "Eigene Heizkostenabrechnung nach Heizkostenverteilern und Werten eines Ablesedienstes

Im Grenzmodell von PR 10: Der Gerätetyp der Heizung folgt der Erfassung, jede Differenz zählt mit
dem Faktor ihres Geräts, die Werte des Ablesedienstes kommen als gedachte Zähler mit kumulierten
Ständen. Dieselben Einheiten ergeben dieselben Beträge. Gemischte Geräte und fehlende Faktoren
verhindern die Verteilung mit einem Satz; ein Gerätestichtag mitten in der Heizperiode ergibt
einen Hinweis.

Refs #99"
```

---

### Task 5: Werte des Ablesedienstes speichern, Sperre der Erfassungen fällt, Route

**Files:**
- Create: `server/src/db/serviceValues.ts`
- Modify: `server/src/db/heating.ts` (`guardHeatingPlant`, `LATER`), `server/src/db/heatingSelf.ts` (`setUpSelf`), `server/src/db/repository.ts` (`HKV_KEY`, `crossPropertyViolations`), `server/src/db/co2.ts` (`heatingPeriodViews`), `server/src/index.ts`, `shared/types.ts` (`HeatingPeriodView.serviceValues`)
- Test: `server/test/db-hkv.test.ts` (ergänzen), `server/test/api.test.ts` (ergänzen), `server/test/db-heizkosten.test.ts` (eine Zeile von PR 10 fällt)

**Interfaces:**
- Consumes: Task 2 `heatingServiceValues`, `readHeatingServiceValues`, `HeatingServiceValue`; PR 8 `server/src/db/heatingPeriodContext.ts` (`plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`); PR 6 `heatingPeriodViews`; PR 5 `servesUnit`; repository.ts `HeatingError`, `raw`, `nullableNumber`, `ISO_DATE`; read.ts `readUnits`; `Database` (`server/src/db/client.ts`); index.ts `writeData`, `bodyObject`; PR 2 `closeSettlement`; PR 10 `setUpSelf(db, plantId, body, today, newId)` mit der Schleife über `pots`, die `plans` für fehlende Zähler füllt, `LATER.capture`, Route `PUT /api/heating-plants/:id/self`.
- Produces:
  - `db/serviceValues.ts`: `saveServiceValues(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingServiceValue[] | null>` (`null` heißt: Anlage gibt es nicht)
  - `HeatingPeriodView.serviceValues: HeatingServiceValue[]`
  - Route `PUT /api/heating-plants/:id/periods/:period/service-values` mit Rumpf `{ values: [{ unitId, from, to, heatValue, waterValue }] }` → 200 mit der Liste

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/db-hkv.test.ts`: Importe ergänzen:

```ts
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { saveServiceValues } from '../src/db/serviceValues.ts'
import { closeSettlement, createProperty, crossPropertyViolations } from '../src/db/repository.ts'
import { heatingServiceValues } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
```

und ans Dateiende:

```ts
let ids = 0
const newId = () => `m-${++ids}`
// Die Einrichtung von PR 10 (Schritt 7) mit der Erfassung als Parameter; eine Anlage wird nur über sie
// zur eigenen Abrechnung (PR 10 Abweichung 17).
const einrichtung = (capture: 'hca' | 'serviceValues') => ({
  period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture,
  dhwHeatMeter: false, totalHeatMeter: false,
})
async function ablesedienst(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
  await opened.write((db) => setUpSelf(db, 'hp', einrichtung('serviceValues'), '2026-02-01', newId))
}

test('Einrichtung mit Heizkostenverteilern oder Ablesedienst: keine Wärmezähler, die Warmwasserzähler schon (Abweichung 8)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    })
    const done = await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca'), '2026-02-01', newId)) ?? assert.fail('keine Anlage')
    assert.equal(done.plant.capture, 'hca')
    assert.deepEqual(done.created.map((m) => m.type).sort(), ['warmwasser', 'warmwasser'])
  })
})
const zeile = (unitId: string, from: string, to: string, heatValue: number, waterValue: number | null = null) => ({ unitId, from, to, heatValue, waterValue })

test('Ablesedienst: speichern ersetzt alle Zeilen der Heizperiode; die Ansicht zeigt sie', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    const speichern = (values: unknown[]) => opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values }))
    const a = await speichern([zeile('a', '2025-01-01', '2025-09-30', 340), zeile('a', '2025-10-01', '2025-12-31', 210), zeile('b', '2025-01-01', '2025-12-31', 800)]) ?? assert.fail('keine Anlage')
    assert.equal(a.length, 3)
    assert.deepEqual(a[0], { plantId: 'hp', period: periodKey('2025-01'), unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: null })
    await speichern([zeile('b', '2025-01-01', '2025-12-31', 810)])
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.serviceValues.map((v) => [v.unitId, v.heatValue]), [['b', 810]])
    assert.equal(await opened.write((db) => saveServiceValues(db, 'gibt-es-nicht', '2025-01', { values: [] })), null)
  })
})

test('Ablesedienst: Prüfungen je mit einem Satz, nichts geschrieben', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    const speichern = (values: unknown[]) => opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values }))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-06-30', 1), zeile('a', '2025-06-30', '2025-12-31', 1)]), heatingError(400, /überschneiden sich/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', 1, 5), zeile('b', '2025-01-01', '2025-12-31', 1)]), heatingError(400, /für alle Zeilen ein oder für keine/))
    await assert.rejects(speichern([zeile('a', '2024-12-01', '2025-12-31', 1)]), heatingError(400, /nicht ganz in der Heizperiode/))
    await assert.rejects(speichern([zeile('a', '2025-03-01', '2025-02-01', 1)]), heatingError(400, /kein gültiger Zeitraum/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', -1)]), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern([zeile('x', '2025-01-01', '2025-12-31', 1)]), heatingError(400, /gibt es in diesem Objekt nicht/))
    // Eine Lücke ist erlaubt und bleibt eine Lücke (Review Focus 2).
    assert.equal((await speichern([zeile('a', '2025-01-01', '2025-09-30', 1), zeile('a', '2025-10-15', '2025-12-31', 1)]))?.length, 2)
  })
})

test('Ablesedienst: nur bei eigener Abrechnung mit dieser Erfassung; nur angeschlossene Wohnungen; abgeschlossen gesperrt (409)', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a', heatedAreaM2: null }] }))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [zeile('b', '2025-01-01', '2025-12-31', 1)] })), heatingError(400, /hängt nicht an dieser Heizanlage/))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [] })), heatingError(409, /abgeschlossen/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { capture: 'heatMeter' }))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2026-01', { values: [] })), heatingError(400, /Erfassung „Werte eines Ablesedienstes“/))
  })
})

test('Wiederherstellen: ein Wert des Ablesedienstes an einer Wohnung eines anderen Objekts wird gefunden', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus' })
      await createEntity(db, 'units', 'n', { propertyId: 'objekt-2', name: 'N', areaM2: 40, participates: true })
    })
    await opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [zeile('a', '2025-01-01', '2025-12-31', 1)] }))
    await opened.write(async (db) => {
      const [hp] = await db.select({ id: heatingServiceValues.heatingPeriodId }).from(heatingServiceValues)
      await db.insert(heatingServiceValues).values({ heatingPeriodId: hp?.id ?? '', unitId: 'n', from: '2025-01-01', to: '2025-12-31', heatValue: 1, waterValue: null })
    })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /Wert des Ablesedienstes.*„N“.*anderen Objekts/.test(b)), befunde.join('\n'))
  })
})
```

`createProperty(db, id, body)` und `closeSettlement(db, entry)` sind die Funktionen von PR 2 bzw. #92
(Plan PR 6 benutzt beide in db-co2.test.ts); `updateHeatingPlant` ist die Schreibfunktion von PR 4.

(b) `server/test/api.test.ts`, im Block der Heizanlagen:

```ts
test('Ablesedienst (Heizung PR 12): PUT speichert die Werte, eine Überschneidung ergibt 400 mit Satz', async () => {
  await withServer(async (base, send) => {
    const unit = await jsonOf<{ id: string }>(await send(`${base}/api/units`, { method: 'POST', body: JSON.stringify({ name: 'A', areaM2: 50, participates: true }) }))
    // POST liefert `{ plant, assigned }` (PR 4); zur eigenen Abrechnung über die Einrichtung (PR 10).
    const { plant } = await jsonOf<{ plant: { id: string } }>(await send(`${base}/api/heating-plants`, { method: 'POST', body: JSON.stringify({ energy: 'gas', method: 'manual' }) }))
    const setup = await send(`${base}/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify({
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'serviceValues', dhwHeatMeter: false, totalHeatMeter: false,
    }) })
    assert.equal(setup.status, 200)
    const url = `${base}/api/heating-plants/${plant.id}/periods/2025-01/service-values`
    const ok = await send(url, { method: 'PUT', body: JSON.stringify({ values: [{ unitId: unit.id, from: '2025-01-01', to: '2025-12-31', heatValue: 800, waterValue: null }] }) })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<unknown[]>(ok)).length, 1)
    const doppelt = await send(url, { method: 'PUT', body: JSON.stringify({ values: [
      { unitId: unit.id, from: '2025-01-01', to: '2025-06-30', heatValue: 1, waterValue: null },
      { unitId: unit.id, from: '2025-06-01', to: '2025-12-31', heatValue: 1, waterValue: null },
    ] }) })
    assert.equal(doppelt.status, 400)
    assert.match((await jsonOf<{ error: string }>(doppelt)).error, /überschneiden sich/)
  })
})
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/db-hkv.test.ts test/api.test.ts`
Expected: FAIL; `ERR_MODULE_NOT_FOUND` für `db/serviceValues.ts` bzw. 400 `LATER.capture` bei der
Einrichtung mit `capture: 'serviceValues'`.

- [ ] **Step 3: Sperre fällt, Satz zu freien Schlüsseln (`db/heating.ts`, `repository.ts`)**

`server/src/db/heating.ts`, `guardHeatingPlant`: die Zeile von PR 10
`if (after.capture !== 'heatMeter') throw new HeatingError(400, LATER.capture)` löschen (Abgleich C1), ebenso
den Eintrag `capture` in `LATER`. Die Zeile davor (`capture === null` → „Bitte wählen Sie, womit der
Verbrauch erfasst wird.“) bleibt.

`server/src/db/heatingSelf.ts`, `setUpSelf` (PR 10 Task 5): In der Schleife, die je angeschlossener
Wohnung die fehlenden Zähler plant (`for (const pot of pots) { const type = POT_METER[pot] … }`), als
erste Zeile des inneren Rumpfs (Abweichung 8):

```ts
      // Heizung PR 12: Heizkostenverteiler legt der Vermieter je Heizkörper selbst an, beim Ablesedienst gibt
      // es keine Geräte; ein Wärmezähler daneben wäre eine gemischte Ausstattung (§ 5 Abs. 7).
      if (pot === 'heating' && after.capture !== 'heatMeter') continue
```

`server/test/db-heizkosten.test.ts` (PR 10): Im Test „Einrichtung: Anteil 50 bis 70 % …“ die Zeile
`await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, capture: 'hca' }, '2026-02-01', newId)), status(400, /späteren Version/))`
löschen; die Einrichtung mit Heizkostenverteilern prüft jetzt db-hkv.test.ts.

`server/src/db/repository.ts`: `HKV_KEY` (PR 4) ersetzen durch (Abweichung 4):

```ts
// Nach Heizkostenverteilern verteilt Mietfuchs nur in der eigenen Heizkostenabrechnung, denn dort stehen
// Skala und Bewertungsfaktor jedes Geräts (Heizung PR 12). Ein Schlüssel „nach Verbrauch“ hätte sie
// nicht; rohe Einheiten verschiedener Heizkörper sind nicht vergleichbar.
const HKV_KEY =
  'Nach Heizkostenverteilern verteilt Mietfuchs in der eigenen Heizkostenabrechnung, denn dort stehen Skala und Bewertungsfaktor jedes Geräts. ' +
  'Richten Sie dafür unter Stammdaten bei der Heizung „Ich selbst“ mit der Erfassung „Heizkostenverteiler“ ein, oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge (Schlüssel „Einzelbeträge“).'
```

Prüft ein Test von PR 4 den alten Satz (`/Bewertungsfaktoren der Geräte/` oder `/späteren Version/`),
wird sein Muster zu `/in der eigenen Heizkostenabrechnung/`.

In `crossPropertyViolations` vor `return befunde`:

```ts
  // Werte eines Ablesedienstes gehören zu einer Wohnung im Objekt ihrer Heizanlage (Heizung PR 12).
  const ablesedienst = await db
    .select({ unitName: units.name })
    .from(heatingServiceValues)
    .innerJoin(heatingPeriods, eq(heatingServiceValues.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(units, eq(heatingServiceValues.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const v of ablesedienst) befunde.push(`Ein Wert des Ablesedienstes gehört zur Wohnung „${v.unitName}“ eines anderen Objekts als seine Heizanlage.`)
```

(Importe `heatingServiceValues`, `heatingPeriods`, `heatingPlants` aus `'./schema.ts'`, soweit nicht
vorhanden.)

- [ ] **Step 4: Speichern (`server/src/db/serviceValues.ts`, neu)**

```ts
// Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum (Heizung PR 12, Entwurf 5.6, 8.1). Der
// Rumpf ersetzt alle Zeilen der Heizperiode in einer Transaktion: Die Karte zeigt und schickt immer die
// ganze Liste.
import { eq } from 'drizzle-orm'
import type { HeatingPlant, HeatingServiceValue, Unit } from '../../../shared/types.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { germanDate } from '../../../shared/law/register.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import type { Database } from './client.ts'
import { readUnits } from './read.ts'
import { HeatingError, ISO_DATE, nullableNumber, raw } from './repository.ts'
import { heatingServiceValues } from './schema.ts'

type Row = Omit<HeatingServiceValue, 'plantId' | 'period'>
type Span = { from: string; to: string }

function readRow(item: unknown, h: Span, propertyUnits: readonly Unit[], plant: HeatingPlant): Row {
  const unitId = raw(item, 'unitId')
  const unit = typeof unitId === 'string' ? propertyUnits.find((u) => u.id === unitId) : undefined
  if (!unit) throw new HeatingError(400, 'Diese Wohnung gibt es in diesem Objekt nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  if (!servesUnit(plant, unit)) throw new HeatingError(400, `Die Wohnung „${unit.name}“ hängt nicht an dieser Heizanlage.`)
  const from = raw(item, 'from')
  const to = raw(item, 'to')
  if (typeof from !== 'string' || typeof to !== 'string' || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    throw new HeatingError(400, `Bei „${unit.name}“ ist der Zeitraum kein gültiger Zeitraum: Beginn und Ende sind Daten, und das Ende liegt nicht vor dem Beginn.`)
  }
  if (from < h.from || to > h.to) {
    throw new HeatingError(400, `Die Zeile für „${unit.name}“ vom ${germanDate(from)} bis ${germanDate(to)} liegt nicht ganz in der Heizperiode (${germanDate(h.from)} bis ${germanDate(h.to)}).`)
  }
  const heatValue = nullableNumber(raw(item, 'heatValue'))
  if (heatValue === null || !(heatValue >= 0)) throw new HeatingError(400, `Der Wert für die Heizung bei „${unit.name}“ ist eine Zahl ab 0.`)
  const waterValue = nullableNumber(raw(item, 'waterValue'))
  if (waterValue !== null && !(waterValue >= 0)) throw new HeatingError(400, `Der Wert für das Warmwasser bei „${unit.name}“ ist eine Zahl ab 0 oder leer.`)
  return { unitId: unit.id, from, to, heatValue, waterValue }
}

// Warmwasser für alle Zeilen oder für keine (Abweichung 3); je Wohnung kein Tag doppelt. Lücken bleiben
// Lücken: Was fehlt, behandelt die Abrechnung wie eine fehlende Ablesung (Review Focus 2).
function checkRows(rows: readonly Row[], propertyUnits: readonly Unit[]): void {
  const withWater = rows.filter((r) => r.waterValue !== null).length
  if (withWater > 0 && withWater < rows.length) {
    throw new HeatingError(400, 'Tragen Sie die Werte für das Warmwasser bitte für alle Zeilen ein oder für keine; sonst käme das Warmwasser teils vom Ablesedienst und teils von den Warmwasserzählern.')
  }
  for (const unit of propertyUnits) {
    const own = rows.filter((r) => r.unitId === unit.id).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1]
      const next = own[i]
      if (prev && next && next.from <= prev.to) {
        throw new HeatingError(400,
          `Die Zeilen für „${unit.name}“ überschneiden sich (${germanDate(prev.from)} bis ${germanDate(prev.to)} und ${germanDate(next.from)} bis ${germanDate(next.to)}). Jeder Tag einer Wohnung zählt nur einmal.`)
      }
    }
  }
}

export async function saveServiceValues(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingServiceValue[] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'self' || ctx.plant.capture !== 'serviceValues') {
    throw new HeatingError(400, 'Werte eines Ablesedienstes gibt es nur bei eigener Heizkostenabrechnung mit der Erfassung „Werte eines Ablesedienstes“. Stellen Sie das unter Stammdaten bei der Heizung ein.')
  }
  const h = heatingPeriodOf(ctx, period)
  const list = raw(body, 'values')
  if (!Array.isArray(list)) throw new HeatingError(400, 'Bitte schicken Sie die Werte des Ablesedienstes als Liste.')
  const propertyUnits = (await readUnits(db)).filter((u) => u.propertyId === ctx.plant.propertyId)
  const rows = list.map((item) => readRow(item, h, propertyUnits, ctx.plant))
  checkRows(rows, propertyUnits)
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.delete(heatingServiceValues).where(eq(heatingServiceValues.heatingPeriodId, heatingPeriodId))
    if (rows.length > 0) await tx.insert(heatingServiceValues).values(rows.map((r) => ({ heatingPeriodId, ...r })))
  })
  return rows.map((r) => ({ plantId, period: h.key, ...r }))
}
```

`Database` aus `'./client.ts'` und der Kontext der Heizperiode aus `'./heatingPeriodContext.ts'`, wie in
db/heatingSelf.ts (PR 10) und db/heatingInfo.ts (PR 14). `ctx.plant` ist eine `HeatingPlant` (PR 8,
`PlantContext`).

- [ ] **Step 5: Ansicht und Route (`db/co2.ts`, `shared/types.ts`, `index.ts`)**

`shared/types.ts`, in `HeatingPeriodView` als letztes Feld:

```ts
  // Werte des Ablesedienstes dieser Heizperiode (Heizung PR 12); leer bei anderer Erfassung.
  serviceValues: HeatingServiceValue[]
```

`server/src/db/co2.ts`, `heatingPeriodViews`: vor der Schleife
`const serviceValues = (await readHeatingServiceValues(db)).filter((v) => v.plantId === plantId)` (Import
aus `'./read.ts'`), und im Objekt je Heizperiode
`serviceValues: serviceValues.filter((v) => v.period === period.key),`.

`server/src/index.ts`: Import `import { saveServiceValues } from './db/serviceValues.ts'`; hinter der Route
`PUT /api/heating-plants/:id/periods/:period/hot-water` (PR 6) dieselbe Gestalt:

```ts
// Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum (Heizung PR 12).
app.put('/api/heating-plants/:id/periods/:period/service-values', async (req, res) => {
  const saved = await writeData((db) => saveServiceValues(db, req.params.id, req.params.period, bodyObject(req)))
  if (saved === null) {
    res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
    return
  }
  res.json(saved)
})
```

Fängt die Route von PR 6 Fehler anders ab (eigener `try`/`next`), übernimmt diese Route dieselbe Form;
`HeatingError` und die 503 bei fehlender Datenbank laufen über die Fehlerbehandlung von index.ts.

- [ ] **Step 6: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix server test -- test/db-hkv.test.ts test/db-co2.test.ts test/db-heizanlage.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Alle Tests und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/serviceValues.ts server/src/db/heating.ts server/src/db/heatingSelf.ts server/src/db/repository.ts server/src/db/co2.ts server/src/index.ts shared/types.ts server/test/db-hkv.test.ts server/test/db-heizkosten.test.ts server/test/api.test.ts
git commit -m "Werte des Ablesedienstes speichern; Erfassung mit Heizkostenverteilern freigegeben

Die Zeilen einer Heizperiode werden in einer Transaktion ersetzt, mit Prüfung je Zeile, ohne
Überschneidung und mit Warmwasser für alle oder keine. Das Wiederherstellen findet Werte an
Wohnungen fremder Objekte.

Refs #99"
```

---
### Task 6: Oberfläche: Skala und Faktor, Stichtagswert, Karte „Ablesedienst“, Druckblock

**Files:**
- Create: `client/src/hcaForm.ts`, `client/src/components/HcaFields.tsx`, `client/src/components/CutoffReadingForm.tsx`, `client/src/components/ServiceValuesCard.tsx`, `client/src/hcaView.ts`, `client/src/components/HcaBlock.tsx`
- Modify: `client/src/meterForm.ts` (PR 4), das Zählerformular, in dem PR 4 `meterBody` aufruft, `client/src/pages/Zaehler.tsx`, `client/src/pages/Heizkosten.tsx`, `client/src/pages/Abrechnung.tsx`, `client/src/heatingSelfForm.ts` (PR 10, `CAPTURE_SELF_OPTIONS`)
- Test: `client/src/hcaForm.test.ts` (neu), `client/src/hcaView.test.ts` (neu), `client/src/components/HcaFields.test.tsx` (neu), `client/src/components/CutoffReadingForm.test.tsx` (neu), `client/src/components/ServiceValuesCard.test.tsx` (neu), `client/src/heatingSelfForm.test.ts` (ein Test von PR 10 ändert sich), `client/src/heatingSelfView.test.ts` (ergänzen)
- Modify (dazu): `client/src/heatingSelfView.ts`, `client/src/components/SelfHeatingCards.tsx`, `client/src/components/SelfHeatingBlock.tsx` (Einheit „Einheiten“, Abweichung 9)

**Interfaces:**
- Consumes: Task 2 `HcaScale`, `Meter.hcaScale`, `Meter.ratingFactor`, `HeatingServiceValue`; Task 4 `SelfHeatingStatement.devices`, `.serviceValues`, `HcaDeviceLine`; Task 5 `HeatingPeriodView.serviceValues`, Route `service-values`; PR 11 `parseDecimal`, `numberText` (heatingForm.ts); PR 4 `MeterForm`, `meterToForm`, `meterBody`; PR 10 `CAPTURE_SELF_OPTIONS`, `selfSetupBody`, `filled` (Testhelfer in heatingSelfForm.test.ts).
- Produces:
  - `hcaForm.ts`: `HCA_SCALE_OPTIONS`, `type HcaFieldsForm = { scale: HcaScale | ''; factor: string }`, `hcaFieldsOf(m: Pick<Meter, 'hcaScale' | 'ratingFactor'>): HcaFieldsForm`, `hcaFieldsBody(type: MeterType, f: HcaFieldsForm): { body: { hcaScale: HcaScale | null; ratingFactor: number | null } } | { error: string }`, `type CutoffForm = { date: string; value: string }`, `cutoffReadingBody(meterId: string, f: CutoffForm): { body: { meterId: string; date: string; value: number; replacement: true; oldEndValue: number } } | { error: string }`, `type ServiceRowForm = { unitId: string; from: string; to: string; heat: string; water: string }`, `serviceRowsOf(values: readonly HeatingServiceValue[]): ServiceRowForm[]`, `serviceValuesBody(rows: readonly ServiceRowForm[]): { body: { values: { unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }[] } } | { error: string }`
  - `hcaView.ts`: `hcaLines(self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'> | undefined, unitName: (id: string) => string): string[]`

- [ ] **Step 1: Failing tests schreiben**

(a) Datei `client/src/hcaForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { cutoffReadingBody, hcaFieldsBody, hcaFieldsOf, HCA_SCALE_OPTIONS, serviceRowsOf, serviceValuesBody } from './hcaForm'
import { periodKey } from '../../shared/period.ts'

test('Skala und Faktor: nur am Heizkostenverteiler, Faktor deutsch oder technisch, über 0', () => {
  expect(HCA_SCALE_OPTIONS.map((o) => o.value)).toEqual(['', 'unit', 'product'])
  expect(hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 1.25 })).toEqual({ scale: 'unit', factor: '1,25' })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '0,8' })).toEqual({ body: { hcaScale: 'unit', ratingFactor: 0.8 } })
  expect(hcaFieldsBody('hkv', { scale: 'product', factor: '' })).toEqual({ body: { hcaScale: 'product', ratingFactor: null } })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '0' })).toEqual({ error: 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25.' })
  expect(hcaFieldsBody('waerme', { scale: 'unit', factor: '1,25' })).toEqual({ body: { hcaScale: null, ratingFactor: null } })
})

test('Stichtagswert: eine Ablesung mit Wechsel, Wert danach 0', () => {
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '842' })).toEqual({ body: { meterId: 'h1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 842 } })
  expect(cutoffReadingBody('h1', { date: '', value: '842' })).toEqual({ error: 'Bitte wählen Sie den Stichtag des Geräts.' })
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '' })).toEqual({ error: 'Bitte tragen Sie den Stichtagswert laut Anzeige ein.' })
})

test('Ablesedienst: Zeilen ins Formular und zurück; leere Zeilen fallen weg; Warmwasser leer heißt keiner', () => {
  const p = periodKey('2025-01')
  const rows = serviceRowsOf([{ plantId: 'hp', period: p, unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340.5, waterValue: null }])
  expect(rows).toEqual([{ unitId: 'a', from: '2025-01-01', to: '2025-09-30', heat: '340,5', water: '' }])
  expect(serviceValuesBody([...rows, { unitId: '', from: '', to: '', heat: '', water: '' }])).toEqual({
    body: { values: [{ unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340.5, waterValue: null }] },
  })
  expect(serviceValuesBody([{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heat: 'viel', water: '' }])).toEqual({ error: 'Der Wert für die Heizung in Zeile 1 ist keine Zahl.' })
})
```

(b) Datei `client/src/hcaView.test.ts`:

```ts
import { expect, test } from 'vitest'
import { hcaLines } from './hcaView'
import { periodKey } from '../../shared/period.ts'

test('Druckblock: je Gerät Einheiten, Skala und Faktor (Entwurf 8.8); Werte des Ablesedienstes je Zeile', () => {
  const name = (id: string) => (id === 'a' ? 'Wohnung A' : id)
  expect(hcaLines({
    devices: [
      { unitId: 'a', meterId: 'a1', name: 'Wohnzimmer', scale: 'unit', factor: 1.25, raw: 500, rated: 625 },
      { unitId: 'a', meterId: 'a2', name: 'Bad', scale: 'product', factor: 1, raw: 160, rated: 160 },
    ],
  }, name)).toEqual([
    'Wohnung A, „Wohnzimmer“: 500 Einheiten × Bewertungsfaktor 1,25 = 625 Einheiten (Einheitsskala)',
    'Wohnung A, „Bad“: 160 Einheiten (Produktskala, Faktor im Wert enthalten)',
  ])
  expect(hcaLines({
    serviceValues: [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: 12 }],
  }, name)).toEqual(['Wohnung A, 01.01.2025 bis 30.09.2025: Heizung 340 Einheiten, Warmwasser 12 (laut Ablesedienst)'])
  expect(hcaLines({}, name)).toEqual([])
  expect(hcaLines(undefined, name)).toEqual([])
})
```

(b2) `client/src/heatingSelfForm.test.ts` (PR 10): den Test „Erfassung mit Heizkostenverteilern oder Werten
eines Ablesedienstes: noch gesperrt“ ersetzen durch:

```ts
  it('Erfassung mit Heizkostenverteilern oder Werten eines Ablesedienstes (Heizung PR 12): wählbar, ohne Zusatz', () => {
    expect('body' in selfSetupBody(filled({ capture: 'hca' }), 'gas')).toBe(true)
    expect('body' in selfSetupBody(filled({ capture: 'serviceValues' }), 'gas')).toBe(true)
    expect(CAPTURE_SELF_OPTIONS.every((o) => !o.later && !/späteren Version/.test(o.label))).toBe(true)
  })
```

(`CAPTURE_SELF_OPTIONS` in den Import aus `'./heatingSelfForm'` aufnehmen, falls nicht da.)

(b3) `client/src/heatingSelfView.test.ts` (PR 10) anhängen (Abweichung 9):

```ts
test('Heizung PR 12: bei Heizkostenverteilern und Ablesedienst Einheiten statt kWh', () => {
  const u = {
    key: 'A', role: 'tenancy' as const, tenancyId: 'A', label: 'Mieter A', from: '2025-01-01', to: '2025-12-31', days: 365, degreeDayPermille: 1000,
    heatingConsumption: 785, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0,
  }
  const pot = { pot: 'heating' as const, costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 7850, consumptionUnit: 'Einheiten' as const, baseCentsPerM2: 0, consumptionCentsPerUnit: null }
  expect(userLine(u, { pots: [pot] })).toContain('Heizung 785 Einheiten')
  const unit = {
    unitId: 'a', unitName: 'A', areaM2: 60, heatAreaM2: 60, boundaries: [], users: [],
    readings: [{ meterId: 'a1', meterName: 'Wohnzimmer', pot: 'heating' as const, boundary: '2025-12-31', date: '2025-12-31', value: 500 }],
  }
  expect(readingResult(unit, '2025-12-31', 'Einheiten')).toEqual(['Wohnzimmer: 500 Einheiten am 31.12.2025'])
  expect(readingResult(unit, '2025-12-31')).toEqual(['Wohnzimmer: 500 kWh am 31.12.2025'])
})
```

(`readingResult` in den Import aus `'./heatingSelfView'` aufnehmen, falls nicht da.)

(c) Datei `client/src/components/HcaFields.test.tsx`:

```tsx
// @vitest-environment jsdom
// Skala und Faktor am Heizkostenverteiler (Heizung PR 12): Die Auswahl zeigt den gespeicherten Wert
// (CLAUDE.md, Kosten.test.tsx); ohne Skala steht „bitte wählen“.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import HcaFields from './HcaFields'
import type { HcaFieldsForm } from '../hcaForm'

afterEach(() => cleanup())

function Probe({ start }: { start: HcaFieldsForm }) {
  const [form, setForm] = useState(start)
  return <><HcaFields form={form} onChange={setForm} /><output data-testid="stand">{JSON.stringify(form)}</output></>
}

test('Die Skala zeigt den gespeicherten Wert, der Faktor steht nur bei der Einheitsskala', () => {
  render(<Probe start={{ scale: 'product', factor: '' }} />)
  const scale = screen.getByLabelText(/Skala/) as HTMLSelectElement
  expect(scale.value).toBe('product')
  expect(screen.queryByLabelText(/Bewertungsfaktor/)).toBeNull()
  fireEvent.change(scale, { target: { value: 'unit' } })
  fireEvent.change(screen.getByLabelText(/Bewertungsfaktor/), { target: { value: '1,25' } })
  expect(screen.getByTestId('stand').textContent).toBe('{"scale":"unit","factor":"1,25"}')
})

test('Ohne Skala steht „bitte wählen“', () => {
  render(<Probe start={{ scale: '', factor: '' }} />)
  expect((screen.getByLabelText(/Skala/) as HTMLSelectElement).value).toBe('')
})
```

(d) Datei `client/src/components/CutoffReadingForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CutoffReadingForm from './CutoffReadingForm'

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Stichtagswert laut Anzeige wird als Ablesung mit Wechsel gespeichert', async () => {
  const saved = vi.fn()
  render(<CutoffReadingForm meterId="h1" onSaved={saved} />)
  fireEvent.change(screen.getByLabelText(/Stichtag des Geräts/), { target: { value: '2025-12-31' } })
  fireEvent.change(screen.getByLabelText(/Stichtagswert laut Anzeige/), { target: { value: '842' } })
  fireEvent.click(screen.getByRole('button', { name: 'Stichtagswert speichern' }))
  await waitFor(() => expect(saved).toHaveBeenCalled(), { timeout: 5000 })
  expect(sent).toEqual([{ url: '/api/readings', method: 'POST', body: { meterId: 'h1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 842 } }])
})
```

(e) Datei `client/src/components/ServiceValuesCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ServiceValuesCard from './ServiceValuesCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingServiceValue } from '../types'

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const UNITS = [{ id: 'a', name: 'Wohnung A' }, { id: 'b', name: 'Wohnung B' }]
const values: HeatingServiceValue[] = [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800, waterValue: null }]

test('Die Wohnung einer Zeile zeigt den gespeicherten Wert; Speichern schickt die ganze Liste', async () => {
  render(<ServiceValuesCard plantId="hp" period={periodKey('2025-01')} from="2025-01-01" to="2025-12-31" closed={false} units={UNITS} values={values} onSaved={() => {}} />)
  const [unit] = screen.getAllByLabelText(/Wohnung/) as HTMLSelectElement[]
  expect(unit?.value).toBe('b')
  fireEvent.click(screen.getByRole('button', { name: 'Werte speichern' }))
  await waitFor(() => expect(sent.length).toBe(1), { timeout: 5000 })
  expect(sent[0]).toEqual({
    url: '/api/heating-plants/hp/periods/2025-01/service-values', method: 'PUT',
    body: { values: [{ unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800, waterValue: null }] },
  })
})
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix client test -- hcaForm hcaView HcaFields CutoffReadingForm ServiceValuesCard`
Expected: FAIL (Module fehlen).

- [ ] **Step 3: `client/src/hcaForm.ts`**

```ts
// Formularlogik zu Heizkostenverteilern und Ablesedienst (Heizung PR 12, Entwurf 8.1), ohne DOM.
import type { HcaScale, HeatingServiceValue, Meter, MeterType } from './types'
import { numberText, parseDecimal } from './heatingForm'

export const HCA_SCALE_OPTIONS: readonly { value: HcaScale | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'unit', label: 'Einheitsskala (Wert mal Bewertungsfaktor)' },
  { value: 'product', label: 'Produktskala (Faktor im Wert enthalten)' },
]

export type HcaFieldsForm = { scale: HcaScale | ''; factor: string }

export const hcaFieldsOf = (m: Pick<Meter, 'hcaScale' | 'ratingFactor'>): HcaFieldsForm => ({ scale: m.hcaScale ?? '', factor: numberText(m.ratingFactor ?? null) })

// Skala und Faktor gibt es nur am Heizkostenverteiler; bei jeder anderen Sparte schickt das Formular
// `null`, sonst lehnte der Server ab.
export function hcaFieldsBody(type: MeterType, f: HcaFieldsForm): { body: { hcaScale: HcaScale | null; ratingFactor: number | null } } | { error: string } {
  if (type !== 'hkv') return { body: { hcaScale: null, ratingFactor: null } }
  const factor = parseDecimal(f.factor)
  if (factor === undefined || (factor !== null && !(factor > 0))) return { error: 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25.' }
  return { body: { hcaScale: f.scale === '' ? null : f.scale, ratingFactor: factor } }
}

// Der Stichtagswert laut Anzeige (Entwurf 8.1): Das Gerät hat am Stichtag auf null zurückgesetzt; erfasst
// wird das wie ein Zählerwechsel.
export type CutoffForm = { date: string; value: string }
export function cutoffReadingBody(meterId: string, f: CutoffForm): { body: { meterId: string; date: string; value: number; replacement: true; oldEndValue: number } } | { error: string } {
  if (f.date === '') return { error: 'Bitte wählen Sie den Stichtag des Geräts.' }
  const value = parseDecimal(f.value)
  if (value === null) return { error: 'Bitte tragen Sie den Stichtagswert laut Anzeige ein.' }
  if (value === undefined || value < 0) return { error: 'Der Stichtagswert ist eine Zahl ab 0.' }
  return { body: { meterId, date: f.date, value: 0, replacement: true, oldEndValue: value } }
}

// Werte des Ablesedienstes (Entwurf 5.6).
export type ServiceRowForm = { unitId: string; from: string; to: string; heat: string; water: string }
export const serviceRowsOf = (values: readonly HeatingServiceValue[]): ServiceRowForm[] =>
  values.map((v) => ({ unitId: v.unitId, from: v.from, to: v.to, heat: numberText(v.heatValue), water: numberText(v.waterValue) }))
export const emptyServiceRow = (from: string, to: string): ServiceRowForm => ({ unitId: '', from, to, heat: '', water: '' })

export function serviceValuesBody(rows: readonly ServiceRowForm[]): { body: { values: { unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }[] } } | { error: string } {
  const values: { unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }[] = []
  for (const [i, r] of rows.entries()) {
    if (r.unitId === '' && r.heat.trim() === '' && r.water.trim() === '') continue
    const heat = parseDecimal(r.heat)
    if (heat === null || heat === undefined) return { error: `Der Wert für die Heizung in Zeile ${i + 1} ist keine Zahl.` }
    const water = parseDecimal(r.water)
    if (water === undefined) return { error: `Der Wert für das Warmwasser in Zeile ${i + 1} ist keine Zahl.` }
    values.push({ unitId: r.unitId, from: r.from, to: r.to, heatValue: heat, waterValue: water })
  }
  return { body: { values } }
}
```

- [ ] **Step 4: Komponenten**

`client/src/components/HcaFields.tsx`:

```tsx
// Skala und Bewertungsfaktor eines Heizkostenverteilers (Heizung PR 12, Entwurf 8.1).
import Term from './Term'
import { HCA_SCALE_OPTIONS, type HcaFieldsForm } from '../hcaForm'

export default function HcaFields({ form, onChange, disabled = false }: { form: HcaFieldsForm; onChange: (f: HcaFieldsForm) => void; disabled?: boolean }) {
  return (
    <>
      <label className="field">
        Skala des Heizkostenverteilers <Term id="heatCostAllocator" />
        <select value={form.scale} disabled={disabled} onChange={(e) => onChange({ ...form, scale: HCA_SCALE_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
          {HCA_SCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {form.scale === 'unit' && (
        <label className="field">
          Bewertungsfaktor des Heizkörpers (steht auf dem Gerät oder in den Unterlagen)
          <input inputMode="decimal" value={form.factor} disabled={disabled} onChange={(e) => onChange({ ...form, factor: e.target.value })} />
        </label>
      )}
    </>
  )
}
```

`client/src/components/CutoffReadingForm.tsx`:

```tsx
// Stichtagswert laut Anzeige eines elektronischen Heizkostenverteilers (Heizung PR 12, Entwurf 3.5, 8.1).
import { useState } from 'react'
import { api, errorText } from '../api'
import { cutoffReadingBody, type CutoffForm } from '../hcaForm'

export default function CutoffReadingForm({ meterId, onSaved }: { meterId: string; onSaved: () => void }) {
  const [form, setForm] = useState<CutoffForm>({ date: '', value: '' })
  const [error, setError] = useState('')
  async function save() {
    const r = cutoffReadingBody(meterId, form)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api('/api/readings', { method: 'POST', body: JSON.stringify(r.body) })
      setError('')
      setForm({ date: '', value: '' })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="subform">
      <p className="muted">Elektronische Heizkostenverteiler setzen am Stichtag auf null und zeigen den Wert davor als Stichtagswert. Tragen Sie ihn hier ein; Mietfuchs erfasst das wie einen Zählerwechsel.</p>
      <label className="field">
        Stichtag des Geräts
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </label>
      <label className="field">
        Stichtagswert laut Anzeige
        <input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="btn" onClick={() => void save()}>Stichtagswert speichern</button>
    </div>
  )
}
```

`client/src/components/ServiceValuesCard.tsx`:

```tsx
// Die Karte „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 5.6, 8.1): je Wohnung und
// Nutzungszeitraum die Einheiten für Heizung und, wenn der Dienst sie nennt, Warmwasser.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { emptyServiceRow, serviceRowsOf, serviceValuesBody, type ServiceRowForm } from '../hcaForm'
import type { HeatingServiceValue, PeriodKey } from '../types'

type Props = {
  plantId: string
  period: PeriodKey
  from: string
  to: string
  closed: boolean
  units: readonly { id: string; name: string }[]
  values: readonly HeatingServiceValue[]
  onSaved: () => void
}

export default function ServiceValuesCard({ plantId, period, from, to, closed, units, values, onSaved }: Props) {
  const [rows, setRows] = useState<ServiceRowForm[]>(() => (values.length > 0 ? serviceRowsOf(values) : [emptyServiceRow(from, to)]))
  const [error, setError] = useState('')
  const toast = useToast()
  const set = (i: number, patch: Partial<ServiceRowForm>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  async function save() {
    const b = serviceValuesBody(rows)
    if ('error' in b) {
      setError(b.error)
      return
    }
    try {
      await api(`/api/heating-plants/${plantId}/periods/${period}/service-values`, { method: 'PUT', body: JSON.stringify(b.body) })
      setError('')
      toast('Werte des Ablesedienstes gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Werte des Ablesedienstes <Term id="heatCostAllocator" /></h2>
      <p className="muted">Je Wohnung und Nutzungszeitraum, so wie sie in der Ablesung des Dienstes stehen. Zieht ein Mieter aus, sind es zwei Zeilen.</p>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <label className="field">
            Wohnung
            <select value={r.unitId} disabled={closed} onChange={(e) => set(i, { unitId: units.find((u) => u.id === e.target.value)?.id ?? '' })}>
              <option value="">bitte wählen</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="field">von<input type="date" value={r.from} disabled={closed} onChange={(e) => set(i, { from: e.target.value })} /></label>
          <label className="field">bis<input type="date" value={r.to} disabled={closed} onChange={(e) => set(i, { to: e.target.value })} /></label>
          <label className="field">Heizung (Einheiten)<input inputMode="decimal" value={r.heat} disabled={closed} onChange={(e) => set(i, { heat: e.target.value })} /></label>
          <label className="field">Warmwasser (falls genannt)<input inputMode="decimal" value={r.water} disabled={closed} onChange={(e) => set(i, { water: e.target.value })} /></label>
        </div>
      ))}
      {error && <div className="error">{error}</div>}
      {!closed && (
        <>
          <button type="button" className="btn-link" onClick={() => setRows([...rows, emptyServiceRow(from, to)])}>+ weitere Zeile</button>
          <button className="btn" onClick={() => void save()}>Werte speichern</button>
        </>
      )}
    </div>
  )
}
```

Die Felder einer Zeile heißen „Wohnung“, „von“, „bis“, „Heizung (Einheiten)“ und „Warmwasser (falls
genannt)“; nur die Auswahl trägt „Wohnung“ in der Beschriftung, `getAllByLabelText(/Wohnung/)` im Test (e)
findet je Zeile also genau sie.

`client/src/hcaView.ts`:

```ts
// Druckblock „Heizkostenverteiler“ bzw. „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 8.8): bei
// der Einheitsskala muss der Faktor in der Abrechnung stehen.
import type { SelfHeatingStatement } from './types'

const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const day = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// Liest den Ausweis der eigenen Abrechnung (`HeatingStatement.self`, Prüfbericht B.1).
export function hcaLines(self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'> | undefined, unitName: (id: string) => string): string[] {
  const devices = (self?.devices ?? []).map((d) =>
    d.scale === 'unit'
      ? `${unitName(d.unitId)}, „${d.name}“: ${num(d.raw)} Einheiten × Bewertungsfaktor ${num(d.factor)} = ${num(d.rated)} Einheiten (Einheitsskala)`
      : `${unitName(d.unitId)}, „${d.name}“: ${num(d.raw)} Einheiten (Produktskala, Faktor im Wert enthalten)`)
  const service = (self?.serviceValues ?? []).map((v) =>
    `${unitName(v.unitId)}, ${day(v.from)} bis ${day(v.to)}: Heizung ${num(v.heatValue)} Einheiten${v.waterValue !== null ? `, Warmwasser ${num(v.waterValue)}` : ''} (laut Ablesedienst)`)
  return [...devices, ...service]
}
```

`client/src/components/HcaBlock.tsx`:

```tsx
// Druckblock je Heizanlage (Heizung PR 12): Geräte mit Skala und Faktor bzw. Werte des Ablesedienstes.
import { hcaLines } from '../hcaView'
import type { HeatingStatement } from '../types'

export default function HcaBlock({ heating, unitName }: { heating: HeatingStatement; unitName: (id: string) => string }) {
  const lines = hcaLines(heating.self, unitName)
  if (lines.length === 0) return null
  return (
    <div className="print-block">
      <h4>{(heating.self?.devices ?? []).length > 0 ? 'Heizkostenverteiler' : 'Werte des Ablesedienstes'}</h4>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  )
}
```

- [ ] **Step 5: Einbau (`meterForm.ts`, Zählerformular, `Zaehler.tsx`, `Heizkosten.tsx`, `Abrechnung.tsx`, `heatingForm.ts`)**

`client/src/meterForm.ts` (PR 4): `MeterForm` um `hca: HcaFieldsForm` erweitern; `meterToForm` setzt
`hca: hcaFieldsOf(m)`, das leere Formular `hca: { scale: '', factor: '' }`. In `meterBody` vor dem
`return { body: … }`:

```ts
  const hca = hcaFieldsBody(form.type, form.hca)
  if ('error' in hca) return { error: hca.error }
```

und `...hca.body` in den Rumpf. (`MeterBody` bekommt `hcaScale: HcaScale | null; ratingFactor: number |
null`.) Die bestehenden Tests von `meterBody` (PR 4) vergleichen ganze Rümpfe; dort `hcaScale: null,
ratingFactor: null` ergänzen.

Im Zählerformular (dort, wo PR 4 `meterBody` aufruft und die Felder für Rolle und Fernablesbarkeit
zeigt) unter der Auswahl der Sparte:

```tsx
          {form.type === 'hkv' && <HcaFields form={form.hca} onChange={(hca) => setForm({ ...form, hca })} />}
```

`client/src/pages/Zaehler.tsx`: Dort, wo je Zähler die Ablesungen und das Formular für eine neue
Ablesung stehen, für Heizkostenverteiler darunter:

```tsx
            {m.type === 'hkv' && <CutoffReadingForm meterId={m.id} onSaved={reload} />}
```

(`reload` ist die Funktion, mit der die Seite nach dem Speichern einer Ablesung neu lädt; heißt sie
anders, diese nehmen.)

`client/src/pages/Heizkosten.tsx`: In der Schleife je Anlage und Heizperiode (PR 6), hinter der Karte
„Warmwasser“:

```tsx
              {plant.method === 'self' && plant.capture === 'serviceValues' && (
                <ServiceValuesCard
                  plantId={plant.id} period={v.period} from={v.from} to={v.to} closed={v.closed}
                  units={units.filter((u) => servesUnit(plant, u)).map((u) => ({ id: u.id, name: u.name }))}
                  values={v.serviceValues} onSaved={() => void load()}
                />
              )}
```

(Importe: `ServiceValuesCard`, `servesUnit` aus `'../../../shared/heatingPeriod.ts'`; `v` ist die
`HeatingPeriodView` der Schleife, `load` die Ladefunktion der Seite.)

`client/src/pages/Abrechnung.tsx`: hinter `<DhwBlock heating={h} />` (PR 11)
`<HcaBlock heating={h} unitName={(id) => units.find((u) => u.id === id)?.name ?? id} />`, mit den
Wohnungen, die die Seite schon hat.

`client/src/heatingSelfForm.ts` (PR 10), `CAPTURE_SELF_OPTIONS` (Abgleich C7) ersetzen durch:

```ts
export const CAPTURE_SELF_OPTIONS: { value: CaptureMethod; label: string; later: boolean }[] = [
  { value: 'heatMeter', label: 'Wärmezähler und Warmwasserzähler je Wohnung', later: false },
  { value: 'hca', label: 'Heizkostenverteiler an den Heizkörpern, die ich selbst ablese', later: false },
  { value: 'serviceValues', label: 'Werte eines Ablesedienstes (auch Verdunster und Funk)', later: false },
]
```

Die Prüfung `CAPTURE_SELF_OPTIONS.find(…)?.later` in `selfSetupBody` bleibt; sie greift nicht mehr. Das
`CAPTURE_OPTIONS` von PR 4 in `heatingForm.ts` (Frage „Wer rechnet ab?“) bleibt unverändert.

`client/src/heatingSelfView.ts` (PR 10), Einheit der Heizung (Abweichung 9): In `userLine` vor
`const parts = …`

```ts
  // Heizkostenverteiler und Ablesedienst zählen Einheiten (Heizung PR 12).
  const heatUnit = self.pots.find((p) => p.pot === 'heating')?.consumptionUnit ?? 'kWh'
```

und im Ausdruck für die Heizung `${num(u.heatingConsumption)} kWh` durch
`${num(u.heatingConsumption)} ${heatUnit}` ersetzen. `readingResult` bekommt einen dritten Parameter:

```ts
export function readingResult(unit: SelfUnitView, boundary: string, heatUnit: 'kWh' | 'Einheiten' = 'kWh'): string[] {
  return unit.readings.filter((r) => r.boundary === boundary).map((r) => (r.date === null || r.value === null
    ? `${r.meterName}: nicht abgelesen`
    : `${r.meterName}: ${num(r.value)} ${r.pot === 'heating' ? heatUnit : 'm³'} am ${fmtDate(r.date)}`))
}
```

Die Aufrufer in `SelfHeatingCards.tsx` und `SelfHeatingBlock.tsx` (PR 10 Task 13) übergeben
`self.pots.find((p) => p.pot === 'heating')?.consumptionUnit === 'Einheiten' ? 'Einheiten' : 'kWh'`.

- [ ] **Step 6: Tests ausführen, sie müssen bestehen**

Run: `npm --prefix client test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

Run: `npm test`
Expected: PASS.

```bash
git add client/src/hcaForm.ts client/src/hcaForm.test.ts client/src/hcaView.ts client/src/hcaView.test.ts client/src/components/HcaFields.tsx client/src/components/HcaFields.test.tsx client/src/components/CutoffReadingForm.tsx client/src/components/CutoffReadingForm.test.tsx client/src/components/ServiceValuesCard.tsx client/src/components/ServiceValuesCard.test.tsx client/src/components/HcaBlock.tsx client/src/meterForm.ts client/src/meterForm.test.ts client/src/pages client/src/heatingSelfForm.ts client/src/heatingSelfForm.test.ts client/src/heatingSelfView.ts client/src/heatingSelfView.test.ts client/src/components/SelfHeatingCards.tsx client/src/components/SelfHeatingBlock.tsx
git commit -m "Oberfläche: Skala und Faktor am Heizkostenverteiler, Stichtagswert, Werte des Ablesedienstes

Skala und Bewertungsfaktor im Zählerformular, der Stichtagswert laut Anzeige als Ablesung mit
Wechsel, die Karte für die Werte des Ablesedienstes auf der Seite Heizkosten und im Ausweis je
Gerät Einheiten, Skala und Faktor.

Refs #99"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Praxislauf, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG**

Unter „Unveröffentlicht“ / „Hinzugefügt“:

```markdown
- Eigene Heizkostenabrechnung nach Heizkostenverteilern: je Gerät Skala (Einheits- oder Produktskala)
  und Bewertungsfaktor, der Stichtagswert laut Anzeige; die Abrechnung nennt je Gerät Einheiten und
  Faktor. Dazu Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum, womit auch Verdunster und
  Funk-Heizkostenverteiler abgedeckt sind ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Hinweise: Bewertungsfaktor oder Skala fehlt (die Anlage wird dann nicht verteilt), Stichtag eines
  Geräts mitten in der Heizperiode, und verschiedene Geräte in einer Anlage. Die dafür nötige
  Vorerfassung nach § 5 Abs. 7 HeizkostenV kommt später
  ([#218](https://github.com/speedone/mietfuchs/issues/218)); bis dahin bleibt der Weg über den
  Messdienst.
```

Unter „Geändert“:

```markdown
- Die Ablehnung einer Verteilung „nach Verbrauch“ mit Heizkostenverteilern bei freien Schlüsseln
  verweist jetzt auf die eigene Heizkostenabrechnung mit Erfassung „Heizkostenverteiler“.
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt „Berechnungs-Engine“ hinter dem Punkt zum Warmwasseranteil (PR 11):

```markdown
- **Heizkostenverteiler und Ablesedienst** (Heizung PR 12, [server/src/hca.ts](server/src/hca.ts)):
  § 5 Abs. 1 HeizkostenV lässt Wärmezähler und Heizkostenverteiler gleichrangig zu, und Mietfuchs
  bringt alle drei Erfassungen in **das Grenzmodell von PR 10**: Ein Heizkostenverteiler ist ein Zähler
  vom Typ `hkv` mit einem Faktor am Zähler (`SelfMeter.factor`), `planSelf` wählt den Gerätetyp nach der
  Erfassung, und die Werte eines Ablesedienstes sind je Wohnung ein gedachter Zähler mit kumulierten
  Ständen (ohne Stand am Beginn einer Zeile nach einer Lücke, sonst zählte die Lücke still als 0).
  Zwischenablesung, Gradtage und „keine Interpolation“ bleiben damit an einer Stelle, und ein Test hält
  fest, dass dieselben bewerteten Einheiten dieselben Beträge ergeben, gleich woher sie kommen. Die
  Einheit des Topfs Heizung heißt dann „Einheiten“. Bei der **Einheitsskala**
  zählt der Ablesewert mal dem Bewertungsfaktor, bei der **Produktskala** wie abgelesen; ohne Skala
  oder Faktor `heating.hca-factor-missing` und keine Verteilung. Der **Stichtagswert** ist kein eigenes
  Feld, sondern eine Ablesung mit `replacement` und Wert 0; eine Rücksetzung mitten in der Heizperiode
  ergibt `heating.device-cutoff`. Ein Gerät mit anderem Faktor ist ein neuer Zähler. **Gemischte
  Geräte** (Wärmezähler neben Heizkostenverteilern in einer Anlage) verlangen nach § 5 Abs. 7 eine
  Vorerfassung, die Mietfuchs nicht rechnet (#218): `heating.mixed-capture`, keine Verteilung.
  **Verdunster** wertet Mietfuchs nicht aus; ihre Werte kommen wie alle eines Ablesedienstes über
  `heating_service_values` (je Wohnung und Nutzungszeitraum, Warmwasser für alle Zeilen oder keine,
  Lücken bleiben Lücken). Skala und Faktor gibt es nur am Zähler vom Typ `hkv` (Prüfbedingung).
```

- [ ] **Step 3: Praxislauf und Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0 bei allen drei.

Run: `node scripts/umstieg-praxislauf.mjs --nur 16`
Expected: Fall 16 grün (Datenbank 0.10.1 → Stand dieser PR; der Neubau von `meters` in
`0031_hkv_bedingungen` lässt jede Ablesung und jede Zahl, wie sie war).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Heizkostenverteiler, Stichtagswert und Werte des Ablesedienstes

Refs #99"
```

- [ ] **Step 5: PR-Beschreibung**

Gestapelt auf PR 11, mit `Refs #99`, den Abweichungen 1 bis 9, dem Abschnitt „Änderungen nach Prüfung
vom 05.10.2026“, der Tabelle „Abgleich mit PR 10“ und dem Hinweis, dass #218 die Vorerfassung trägt und
offen bleibt. ⟨Norm offen: VDI 2077; DIN EN 834⟩ für Skalen, Bewertungsfaktoren und die Grenze „gleiche
Ausstattung“ (Abweichung 1) steht als Prüfpunkt darin, ebenso die Frage, ob Einheits- und Produktskala
in einer Anlage einen Hinweis brauchen (Prüfbericht A.2).

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Stelle |
|---|---|
| `meters.rating_factor`, `hca_scale` (5.1, 5.3 „PR 12“) | Task 2 |
| `heating_service_values` `(heating_period_id, unit_id, from)`, `to`, `heat_value`, `water_value` (5.6) | Task 2, Task 5 |
| Elektronische HKV mit Bewertungsfaktor je Gerät, Produkt- oder Einheitsskala (8.1) | Task 3, Task 4, Task 6 |
| „HKV mit Faktoren 0,8 und 1,25“ (12.2) | Task 3 Test, Task 1 Lexikon |
| Stichtagswert wie Zählerwechsel; `heating.device-cutoff` (8.1, 3.5, 10.1) | Task 3, Task 4, Task 6 (`CutoffReadingForm`) |
| `heating.hca-factor-missing` (error) (10.1) | Task 3, Task 4 |
| `heating.mixed-capture` (error) mit Verweis auf den Messdienst (8.1, 14.1, #218) | Task 3, Task 4, Task 7 |
| Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum, deckt Verdunster und Funk ab (8.1) | Task 3, Task 4, Task 5, Task 6 |
| Verdunster nicht selbst auswerten; ARGE-Fenster 400–800 ‰ nur im Lexikon (8.1, 4.3, 16) | Task 1 |
| HKV nicht eichpflichtig (3.12) | Global Constraints (keine Änderung an PR 21) |
| Ausweis „bei HKV je Gerät; bei der Einheitsskala muss der Faktor in der Abrechnung stehen“ (8.8) | Task 3 `deviceLines`, Task 4 (`self.devices`), Task 6 `HcaBlock` |
| Naht im Grenzmodell von PR 10 (Prüfbericht B.1, C2–C4) | Task 4 (`metersOf`, `factor`, `blocked`), heating.test.ts |
| Schnappschuss mit Ablesedienstwerten (5.8) | Task 2 |
| Wiederherstellen: Objektgrenzen (5.9) | Task 5 |
| ⟨Norm offen: VDI 2077; DIN EN 834⟩ sichtbar (15.3) | Kopf von hca.ts, Abweichung 1, PR-Beschreibung |
| Wer nichts einstellt, merkt nichts (1.2 Nr. 1) | Task 4 Test „Wärmezähler wie bisher“, Golden |

Nicht in diesem Plan: Schätzung nach § 9a bei fehlenden Werten (PR 13; Lücken bleiben hier Lücken),
§ 6a-Angaben (PR 14), monatliche Verbrauchsinformation aus Funkwerten (PR 22), Vorerfassung (#218).

**2. Platzhalter.** Keine „TBD“, kein „wie Task N“. Die Namen von PR 10 sind abgeglichen (Abschnitt
„Abgleich mit PR 10“, Commit `81828af`).

**3. Typen.** `HcaScale`, `hcaScale`, `ratingFactor`, `HeatingServiceValue` (`heatValue`,
`waterValue`), `HcaDeviceLine` (`raw`, `rated`, `factor`, `scale`), `HcaMeter`, `DevicesInput`,
`MixedCapture`, `MissingRating`, `DeviceCutoff` sind in Task 2/3 definiert und in Task 4–6 mit denselben
Namen benutzt. Aus PR 10: `SelfMeter` (+ `factor`), `SelfInput` (+ `capture`), `SelfBlock` (+ zwei
Codes), `SelfPlantPlan` (+ `capture`, `devices`, `serviceValues`), `CaptureMethod`,
`CAPTURE_METHODS`, `CAPTURE_SELF_OPTIONS`, `LATER.capture`. `serviceMeters` liefert `SelfMeter` und
`SelfReading` in der Gestalt von PR 10.

**4. Review Focus.** 1 → `hca.test.ts` „Tausch eines Geräts“; 2 → „Werte des Ablesedienstes … Lücken“
und `db-hkv.test.ts` (Lücke erlaubt); 3 → `db-hkv.test.ts` „für alle Zeilen ein oder für keine“; 4 →
„Gemischte Geräte“ (Warmwasserzähler und Zähler der Anlage zählen nicht); 5 → `db-hkv.test.ts`
„Faktor über 0, Skala und Faktor nur am Heizkostenverteiler“.
