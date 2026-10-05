# Heizung PR 21: Eichfrist der Zähler (#98) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Vermieter trägt an jedem Zähler außer Heizkostenverteilern das Jahr ein, bis zu dem er
geeicht ist (`calibrated_until`); Mietfuchs schlägt es aus dem Jahr der Eichung oder Kennzeichnung vor,
wo das Recht eindeutig ist, und meldet auf der Zähler-Seite und im Cockpit `meter.calibration-overdue`
(warning), sobald eine Ablesung des Zeitraums aus der Zeit nach Ablauf der Eichfrist stammt, mit der
Beweislast nach BGH VIII ZR 112/10 und dem Hinweis auf die Verlängerung im Stichprobenverfahren (§ 35
MessEV). Die Werte verwendet Mietfuchs trotzdem.

**Architecture:** Ein Parameter `messev.calibration-years` (Eichfristen nach Anlage 7 MessEV, Zeitregel
`eventDate`) und eine Regel `meter-calibration` im Rechtsregister; eine nullbare Spalte
`meters.calibrated_until` mit zwei Prüfbedingungen (vierstellige Jahreszahl, nie bei `hkv`) in zwei
erzeugten Schritten; eine reine Prüfung in `server/src/calibration.ts`, die `consumptionOverview` je Zähler
aufruft; im Client ein Feld mit Vorschlag im Zählerformular (`client/src/meterForm.ts`, `Zaehler.tsx`).

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM 0.45 über
`sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(Z-B10, R-A27), 2 (MessEV Anlage 7, §§ 34, 35; BGH VIII ZR 112/10), 3.M Zeile 12, **3.12**, 4.3
(`messev.calibration-years`), 4.7, 5.1 (`meters.calibrated_until`), 5.3 (Zähler, PR 21: Bedingung
`type <> 'hkv'`), 8.1 (HKV ohne Eichdatum), 10.1 (`meter.calibration-overdue` warning, nicht für HKV),
10.2 (`meter-calibration`), 10.3 (`meterCalibration`), 13 PR 21, 14.1 Zeile „Eichfrist“, 14.2 (#98 in
den Meilenstein).

**Baut auf:** PR 1 bis PR 20 (Code von PR 1 und PR 2 auf `feat/heizung`, die übrigen nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3..20}-*.md`). Gearbeitet wird auf
`feat/heizung-pr21-eichfrist`, abgezweigt von der Spitze von PR 20, gestapelt gestellt und nach dem
Merge von PR 20 auf `main` umgestellt (`git rebase --onto`).

**Rechtsquellen, am 05.10.2026 im Wortlaut gelesen** (gesetze-im-internet.de, MessEV „zuletzt geändert
durch Art. 13 V v. 11.12.2024 I Nr. 411“):

- § 34 Abs. 1 MessEV: „Die Eichfrist eines Messgeräts beträgt zwei Jahre, soweit nicht etwas anderes
  bestimmt ist 1. in Anlage 7 oder 2. in einer bis zum Ablauf des 31. Dezember 2014 erteilten
  Bauartzulassung …“. Satz 2: „Soweit nicht die Eichfrist nach § 37 Absatz 1 Satz 2 des Mess- und
  Eichgesetzes beginnt, ist für den Fristbeginn auf den Tag der Eichung abzustellen.“ Satz 3: „Wird ein
  Messgerät nach Ablauf der Eichfrist geeicht, beginnt die neue Eichfrist mit Ablauf der vorausgegangenen
  Eichfrist.“ Satz 4: nach mehr als einem Jahr Nichtverwendung zählt wieder der Tag der Eichung.
- § 34 Abs. 2 MessEV: „Unabhängig von dem nach Absatz 1 sich ergebenden rechnerischen Ende der Eichfrist
  endet diese bei Eichfristen, die mindestens ein Jahr betragen, erst mit dem Ende des Jahres, in dem die
  Frist rechnerisch endet. Es wird vermutet, dass das Messgerät in dem Jahr in Verkehr gebracht wurde, in
  dem es nach § 14 gekennzeichnet wurde.“
- Anlage 7 Tabelle 1: Nr. 5.5.1 „Wasserzähler für Kaltwasser …“ **6**; Nr. 5.5.2 „Wasserzähler für
  Warmwasser …“ **6**; Nr. 7.1 „Wärmezähler und Kältezähler“ **6**.
- § 35 MessEV: Die zuständige Behörde „verlängert auf Antrag die Eichfrist derjenigen Messgeräte für
  Elektrizität, Gas, Wasser oder Wärme, die in einem Los zusammengefasst sind“, wenn eine Stichprobe
  nach anerkannten statistischen Grundsätzen erwarten lässt, dass mindestens 95 Prozent der Geräte die
  Anforderungen einhalten (Nr. 1 bis 7).
- § 37 Abs. 1 MessEG: „Messgeräte dürfen nicht ungeeicht verwendet werden, 1. nachdem die … bestimmte
  Eichfrist abgelaufen ist …“. Satz 2: „Für Messgeräte, die nach den Vorschriften des Abschnitts 2 in
  Verkehr gebracht wurden, beginnt die Eichfrist mit dem Inverkehrbringen …“.
- **Übergangsrecht 2021 (Entwurf 3.12: „vor PR 21 im BGBl. lesen“):** Die *Dritte Verordnung zur Änderung
  der Mess- und Eichverordnung* vom 26.10.2021 (BGBl. I Nr. 76 vom 02.11.2021, S. 4742) ersetzt in Anlage 7
  Nr. 5.5.2, 7.1 und 7.2 die Angabe „5“ durch „6“ und tritt nach Art. 2 „am Tag nach der Verkündung“, also
  am **03.11.2021**, in Kraft. Eine Übergangsvorschrift für schon geeichte Zähler enthält sie nicht; § 58
  MessEV (Übergangsvorschriften) nennt dazu nichts (Abs. 7 betrifft § 25). Gelesen über den Volltext bei
  umwelt-online (Fundstelle z21_4742) und die Änderungsliste bei buzer.de; das BGBl.-PDF selbst ließ sich
  nicht abrufen. Die Messdienstpraxis wendet die sechs Jahre auch auf zu diesem Tag noch laufende
  Fristen an ([M] Thermomess, KALO); das steht nicht im Wortlaut.
- Die Anlage 7 wurde **außerdem 2017 (BGBl. I S. 3098) und 2019 (BGBl. I S. 579)** geändert; ob dabei die
  Nummern 5.5.1, 5.5.2 und 7.1 berührt wurden, ist nicht gelesen. Deshalb beginnt die einzige Fassung des
  Parameters am 03.11.2021 (Abweichung 2).
- [R] BGH, Urteil vom 17.11.2010, VIII ZR 112/10 (über LTO, gelesen 05.10.2026): Bei geeichten Zählern
  spricht „eine tatsächliche Vermutung für deren Richtigkeit“; beim nicht geeichten muss der Vermieter
  „darlegen und beweisen, dass die abgelesenen Werte zutreffend sind“; im Fall gelang das mit der
  Prüfbescheinigung einer staatlich anerkannten Prüfstelle. Das Urteil betraf einen Wasserzähler.
- [M] Staatsbetrieb für Mess- und Eichwesen Sachsen (eichamt.sachsen.de, „Wohnungswirtschaft“, gelesen
  05.10.2026): „Heizkostenverteiler … unterliegen nicht der Eichpflicht“; die Eichfristen „wurden 2021 auf
  sechs Jahre (Wärme- und Warmwasserzähler bisher 5 Jahre) verlängert“.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne eingetragenes Eichjahr gibt es
  keinen Hinweis, keine Zahl ändert sich, kein Feld ist Pflicht. Golden F01–F18 bleiben wortgleich;
  `legalBasis.values` bekommt nichts Neues (der Parameter wird nur im Zählerformular und im Lexikon gelesen,
  nie in einer Abrechnung).
- **Die Werte werden trotzdem verwendet** (Entwurf 3.12, #91): `meter.calibration-overdue` ist eine
  Warnung, keine Sperre.
- **Heizkostenverteiler haben kein Eichjahr** (Z-B10, 3.12, 5.3): Prüfbedingung `type <> 'hkv'`, kein
  Feld im Formular, kein Hinweis.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): Die sechs Jahre und der 03.11.2021 stehen nur in
  `shared/law/messev.ts`. `server/src/calibration.ts` kommt in `ENGINE_FILES` von `law-literals.test.ts`.
  Urteile in Texten der Berechnung mit Aktenzeichen ohne Datum (kein Datumsliteral in calc.ts).
- **Fassungen nie ändern** (4.4): eine neue Zeile in `law-history.test.ts`.
- **Stufe hängt am Code** (#112): `meter.calibration-overdue` ist `warning`, Regel `meter-calibration`,
  Begriff `meterCalibration`.
- **Nicht auf der Abrechnung**: Der Hinweis gehört zu den Zählerhinweisen (`consumptionOverview`, Zähler-
  Seite, Cockpit-Ampel „Zählerstände“) wie `meter.negative` (CLAUDE.md, Abschnitt Zähler: „ein Hinweis auf
  einen Datenfehler des Vermieters gehört nicht“ auf das Dokument des Mieters).
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`, nie von Hand. Zwei Schritte
  hinter PR 19: `eichfrist` (eine Spalte) und `eichfrist_bedingungen` (Neubau mit Bedingungen); drizzle-kit
  vergibt die Nummern (Annahme A1). Keine Datenanweisung.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben unverändert; die
  db.json kennt kein Eichjahr.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter `grep`
  prüfen). Commit-Nachrichten deutsch, mit `Refs #98` und den Attribution-Zeilen der ausführenden Sitzung.

## Review Focus

1. **Ablesung genau am 31.12. des Eichjahres.** Die Frist endet „erst mit dem Ende des Jahres“ (§ 34 Abs. 2
   MessEV), und eine Ablesung gilt in Mietfuchs zum Tagesende. Erwartet: kein Hinweis für die Ablesung vom
   31.12.2025 bei „geeicht bis 2025“, ein Hinweis für eine vom 01.01.2026. Test in Task 3.
2. **Keine Ablesung am Ende des Zeitraums; die nächste stammt aus dem Januar nach Ablauf.** Der Stand zum
   31.12. wird dann aus dieser späteren Ablesung interpoliert, also mit einem ungeeichten Wert. Erwartet:
   Hinweis mit dem Datum dieser Ablesung. Test in Task 3.
3. **Zählerwechsel im Zeitraum.** Das Eichjahr gilt für das Gerät, das seit dem letzten Wechsel misst; die
   Stände des alten Geräts kennt Mietfuchs nicht. Erwartet: Ablesungen vor dem letzten Wechsel werden nicht
   geprüft; mit dem Eichjahr des neuen Geräts gibt es keinen Hinweis. Test in Task 3.
4. **Ein Zähler wird auf „Heizkostenverteiler“ umgestellt, nachdem ein Eichjahr eingetragen war.**
   Erwartet: Das Eichjahr fällt beim Speichern weg, statt dass die Prüfbedingung mit einem Datenbankfehler
   ablehnt; ein Rumpf, der ausdrücklich ein Eichjahr für einen Heizkostenverteiler schickt, bekommt 400 mit
   einem Satz. Test in Task 2.
5. **Kennzeichnung „M21“ auf einem Warmwasserzähler.** Für 2021 ist unklar, ob fünf oder sechs Jahre gelten
   (Inkrafttreten 03.11.2021, keine Übergangsregel). Erwartet: kein Vorschlag, ein Satz mit dem Grund;
   „M22“ ergibt 2028. Test in Task 4.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/messev.ts` (neu), `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts` | Parameter, Regel, Begriff | 1 |
| `shared/types.ts`, `server/src/db/schema.ts`, `server/drizzle/00xx_eichfrist.sql`, `00xx_eichfrist_bedingungen.sql` (erzeugt), `server/src/db/repository.ts`, `server/src/db/read.ts` | Spalte, Bedingungen, Schreiben, Lesen | 2 |
| `server/src/calibration.ts` (neu), `server/src/calc.ts`, `server/src/snapshot.ts` | Prüfung, Hinweis | 3 |
| `client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx` | Feld mit Vorschlag | 4 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 5 |
| Tests: `server/test/law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `db-eichfrist.test.ts` (neu), `migrations.test.ts`, `schema.test.ts`, `db-repository.test.ts`, `calibration.test.ts` (neu), `client/src/meterForm.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- PR 1 (`shared/law/register.ts`, Code auf `feat/heizung`): `LawParam<T, M>`, `Source`, `law`,
  `versionAt`, `valueAt`, `onlyVersion`, `createLawLog`, `germanDate`, `LAW_AS_OF`; `LAW_PARAMS` in
  `params.ts`; `RULES` in `rules.ts`; in `law.test.ts` die Hilfsfunktion des Tests „jede Konstante vom Typ
  LawParam … steht in LAW_PARAMS“ mit dem Objekt `modules`; `SHIPPED` in `law-history.test.ts`;
  `ENGINE_FILES` in `law-literals.test.ts`.
- PR 4 (Plan `…-pr4-heizanlage.md`): `MeterType` mit `'warmwasser' | 'hkv'`; `Meter.heatingPlantId`,
  `heatingRole`, `remoteReadable`, `installedOn`; repository.ts `mergeMeter`, `meterRow`, `guardMeter`,
  `HeatingError`, `merged`, `has`, `raw`; read.ts `readMeters` mit `orUndefined`; snapshot.ts
  `SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'> & Partial<Pick<Meter, 'name'>>`;
  client `meterForm.ts` mit `MeterForm`, `emptyMeterForm`, `meterToForm`, `meterBody(form, plantId)`,
  `asksRemote`; `Zaehler.tsx` mit `saveMeter` und dem Drawer des Zählers.
- `server/src/calc.ts` (Code auf `feat/heizung`): `noticeKinds`, `makeNotice`, `consumptionOverview`,
  `ConsumptionOverviewRow`, `fmtDay` (Datei-intern), `SnapshotReading`.
- `shared/law/rules.ts`: Regeln stehen in `RULES` mit `code`, `title`, `norm`, `summary`.

### Annahmen über PR 18 und PR 19

Die Pläne von PR 18 und PR 19 entstanden parallel und lagen beim Schreiben nicht vor. **Vor Task 1**
gleicht die ausführende Sitzung ab und ersetzt abweichende Angaben:

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| A1 | Die letzten Migrationen vor diesem PR sind die von PR 19; PR 18 legt zwei Schritte an, PR 19 einen (`co2_refunds`). Die Nummern dieses Plans wären dann `0043_eichfrist` und `0044_eichfrist_bedingungen`. Tests und Plan sprechen die Schritte nur über das Ende ihres Namens an (`_eichfrist`), die Nummer vergibt drizzle-kit. | Task 2 |
| A2 | Weder PR 18 noch PR 19 ändern `meters`, `mergeMeter` oder das Zählerformular. | Task 2, 4 |
| A3 | PR 20 (KI) ändert `meters` nicht. | Task 2 |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie entscheidet.

1. **Datum der Umstellung berichtigt.** Der Entwurf (3.12) nennt den 02.11.2021. Das ist der Tag der
   Verkündung; in Kraft trat die Änderung am 03.11.2021 (Art. 2: „am Tag nach der Verkündung“). Der
   Parameter beginnt am 03.11.2021.
2. **Eine Fassung ab dem 03.11.2021, keine frühere.** Für die Zeit davor ist belegt, dass Warmwasser- und
   Wärmezähler fünf Jahre hatten (die Änderungsverordnung ersetzt „5“ durch „6“); seit wann, ist nicht
   gelesen (Änderungen der Anlage 7 auch 2017 und 2019). Ein Wert ohne Primärquelle käme nur als
   `unchecked` ins Register und sperrte das Release (4.7). Wer vor dem 03.11.2021 geeicht wurde, bekommt
   deshalb **keinen Vorschlag** (Abweichung 3); `law()` wird für solche Tage nie gefragt.
3. **Vorschlag nur ab dem ersten vollen Jahr der Fassung (Festlegung).** Das Formular rechnet „geeicht
   bis“ = Jahr der Eichung oder Kennzeichnung + Eichfrist, wenn der 1. Januar dieses Jahres in der Fassung
   liegt (heute: ab 2022). Grund: Die Kennzeichnung nennt nur das Jahr (§ 34 Abs. 2 Satz 2 MessEV); für 2021
   ist unbekannt, ob der Tag vor oder nach dem 03.11. lag, und ob die sechs Jahre auf eine am 03.11.2021
   laufende Frist wirken, sagt der Wortlaut nicht (nur [M]). Davor fragt das Formular nach dem Jahr laut
   Messdienst oder Eichschein, wie der Entwurf es bis zum Lesen des Übergangsrechts vorsah.
4. **Der Vorschlag erklärt § 34 Abs. 1 Satz 3 MessEV** (wer nach Ablauf neu eicht, bekommt die neue Frist ab
   dem Ablauf der alten), statt ihn zu rechnen: Mietfuchs kennt das Ende der alten Frist nicht.
5. **Geprüft wird der Zeitraum der Abrechnung (P), nicht jede Heizperiode einzeln (Festlegung).** Eine
   Heizperiode endet in P (Entwurf 3.0), ihre Endablesung liegt also in P oder wird über die erste Ablesung
   danach interpoliert; weil „nach Ablauf“ mit dem Datum nur zunimmt, ist eine überfällige Ablesung der
   Heizperiode immer auch eine überfällige Ablesung in P. Ein eigener Durchlauf je Heizperiode fände nichts
   zusätzlich.
6. **Nur das Gerät seit dem letzten Wechsel wird geprüft (Festlegung, Review Focus 3).** Das Eichjahr ist
   eine Angabe zum heutigen Gerät; die Spalte gibt es einmal je Zähler, nicht je Gerät.
7. **Eichjahr für jede Sparte außer HKV**, auch Strom und „sonstig“ (Entwurf 3.12 nennt Kalt-, Warmwasser
   und Wärme): Auch Elektrizitäts- und Gaszähler sind eichpflichtig (§ 35 nennt sie); einen Vorschlag gibt es
   nur für die drei Sparten der Anlage 7, deren Frist das Register führt. Der Hinweistext überträgt das
   Urteil zum Wasserzähler ausdrücklich („für andere Zähler übertragen“).
8. **Vierstellige Jahreszahl als Prüfbedingung** (`BETWEEN 1000 AND 9999`), wie beim Schlüssel der
   Jahreskorrektur (CLAUDE.md, „vierstellige Jahreszahl“); eine engere Grenze hätte keine Quelle.

---

### Task 1: Rechtsregister, Regel und Lexikon

**Files:**
- Create: `shared/law/messev.ts`
- Modify: `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes: `LawParam`, `Source`, `germanDate`, `LAW_AS_OF`, `valueAt`, `onlyVersion` (register.ts).
- Produces:
  - `shared/law/messev.ts`: `type CalibrationYears = { readonly kaltwasser: number; readonly warmwasser: number; readonly waerme: number }`;
    `messevCalibrationYears: LawParam<CalibrationYears, 'eventDate'>` (id `messev.calibration-years`);
    `CALIBRATED_METER_TYPES: readonly ('kaltwasser' | 'warmwasser' | 'waerme')[]`.
  - Regel `meter-calibration` in `RULES`.
  - Lexikon `meterCalibration` (damit `TermId` den Begriff kennt).

- [ ] **Step 1: Write the failing tests**

`server/test/law.test.ts`: Import ergänzen

```ts
import { CALIBRATED_METER_TYPES, messevCalibrationYears } from '../../shared/law/messev.ts'
```

Im Test „jede Konstante vom Typ LawParam in shared/law/ steht in LAW_PARAMS“ im Objekt `modules` als letzten
Eintrag `messevCalibrationYears` ergänzen. Ans Dateiende:

```ts
// ---------- MessEV (Heizung PR 21) ----------

test('Stichtag messev.calibration-years: ab dem 03.11.2021 je 6 Jahre, davor keine Fassung', () => {
  const log = createLawLog()
  assert.deepEqual(law(messevCalibrationYears, { date: '2021-11-03' }, log), { kaltwasser: 6, warmwasser: 6, waerme: 6 })
  assert.deepEqual(law(messevCalibrationYears, { date: '2028-06-30' }, log), { kaltwasser: 6, warmwasser: 6, waerme: 6 })
  // Vor dem Inkrafttreten der Dritten Änderungsverordnung führt das Register keine Fassung (Abweichung 2).
  assert.throws(() => law(messevCalibrationYears, { date: '2021-11-02' }, createLawLog()), /Kein Rechtswert „messev.calibration-years“ am 2021-11-02/)
  assert.equal(log.values.length, 1, 'dieselbe Fassung zweimal abgefragt ist ein Eintrag')
  assert.equal(log.values[0]?.text, 'Kaltwasser-, Warmwasser- und Wärmezähler je 6 Jahre')
})

test('messev.calibration-years: Fundstelle Anlage 7 und Dritte Änderungsverordnung, geprüft', () => {
  const v = onlyVersion(messevCalibrationYears)
  assert.equal(v.validFrom, '2021-11-03')
  assert.equal(v.source.checked, 'checked')
  assert.match(v.source.cite, /Anlage 7 Nr\. 5\.5\.1, 5\.5\.2, 7\.1 MessEV/)
  assert.match(v.enacted, /BGBl\. I S\. 4742/)
  assert.deepEqual([...CALIBRATED_METER_TYPES], ['kaltwasser', 'warmwasser', 'waerme'])
})

test('Regel meter-calibration: nennt die Frist aus dem Register, § 37 MessEG, § 35 MessEV und das Urteil', () => {
  const rule = rulesModule.RULES.find((r) => r.code === 'meter-calibration') ?? assert.fail('Regel fehlt')
  assert.match(rule.norm, /§ 37 Abs\. 1 MessEG; § 34, § 35, Anlage 7 MessEV; BGH, Urteil vom 17\.11\.2010, VIII ZR 112\/10/)
  assert.match(rule.summary, /sechs Jahre|6 Jahre/)
  assert.match(rule.summary, /mit dem Ende des Jahres/)
  assert.match(rule.summary, /Heizkostenverteiler sind nicht eichpflichtig/)
  assert.equal(rule.validFrom, undefined)
})
```

`server/test/law-history.test.ts`: in `SHIPPED` hinter dem letzten Block (PR 20 legt keine Fassung an, also
hinter dem von PR 19) einfügen:

```ts
  // 0.11.0 (Heizung PR 21, #98)
  'messev.calibration-years|2021-11-03||{"kaltwasser":6,"warmwasser":6,"waerme":6}',
```

`server/test/glossary.test.ts` ans Dateiende:

```ts
test('Lexikon meterCalibration: Frist und Beispiel aus dem Register, HKV ohne Eichung, Beweislast', () => {
  const t = GLOSSARY.meterCalibration
  assert.match(t.short, /Heizkostenverteiler sind nicht eichpflichtig/)
  assert.match(t.example, /gekennzeichnet 2022.*bis Ende 2028.*31\.12\.2028.*31\.12\.2029/s)
  assert.match(t.norm ?? '', /Anlage 7 MessEV/)
  assert.match(t.needed, /müssen Sie beweisen/)
})
```

(Steht `GLOSSARY` dort nicht schon im Import aus `'../../shared/glossary.ts'`, ergänzen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL: `Cannot find module '../../shared/law/messev.ts'` bzw. „neue Fassung ohne Zeile“ und
`GLOSSARY.meterCalibration` ist `undefined`.

- [ ] **Step 3: Implement `shared/law/messev.ts`**

```ts
// Eichfristen nach der Mess- und Eichverordnung (Heizung PR 21, Entwurf 3.12, 4.3). Wortlaut gelesen am
// 05.10.2026 auf gesetze-im-internet.de (MessEV „zuletzt geändert durch Art. 13 V v. 11.12.2024
// I Nr. 411“); die Dritte Änderungsverordnung über den Volltext bei umwelt-online (z21_4742).
//
// § 34 Abs. 1 Nr. 1 MessEV verweist auf Anlage 7; dort stehen Kaltwasserzähler (Nr. 5.5.1),
// Warmwasserzähler (Nr. 5.5.2) und Wärmezähler (Nr. 7.1) mit je sechs Jahren. Für Warmwasser- und
// Wärmezähler gilt das seit dem 03.11.2021: Die Dritte Verordnung zur Änderung der Mess- und
// Eichverordnung vom 26.10.2021 (BGBl. I S. 4742, verkündet am 02.11.2021) ersetzte dort „5“ durch „6“
// und trat am Tag nach der Verkündung in Kraft. Eine Übergangsregel für schon geeichte Zähler enthält sie
// nicht. Eine frühere Fassung führt das Register nicht: Die Anlage wurde auch 2017 und 2019 geändert, und
// welche Werte davor galten, ist nicht an der Primärquelle gelesen (Plan PR 21, Abweichung 2).
//
// Zeitregel `eventDate`: Maßgeblich ist der Tag, an dem die Frist beginnt, also der Tag der Eichung oder
// des Inverkehrbringens (§ 34 Abs. 1 Satz 2 MessEV, § 37 Abs. 1 Satz 2 MessEG).
import type { LawParam, Source } from './register.ts'

const ENACTED = 'MessEV, Anlage 7 in der Fassung der Dritten Änderungsverordnung vom 26.10.2021 (BGBl. I S. 4742)'
const checked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'checked' })

export type CalibrationYears = { readonly kaltwasser: number; readonly warmwasser: number; readonly waerme: number }

// Die Sparten, für die das Register eine Eichfrist führt und das Formular ein Jahr vorschlägt.
export const CALIBRATED_METER_TYPES = ['kaltwasser', 'warmwasser', 'waerme'] as const

export const messevCalibrationYears: LawParam<CalibrationYears, 'eventDate'> = {
  id: 'messev.calibration-years',
  title: 'Eichfrist von Wasser- und Wärmezählern',
  norm: '§ 34 Abs. 1 Nr. 1 und Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV',
  timing: 'eventDate',
  versions: [{
    validFrom: '2021-11-03',
    value: { kaltwasser: 6, warmwasser: 6, waerme: 6 },
    source: checked('Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV', 'https://www.gesetze-im-internet.de/messev/anlage_7.html'),
    enacted: ENACTED,
  }],
  describe: (v) =>
    v.kaltwasser === v.warmwasser && v.warmwasser === v.waerme
      ? `Kaltwasser-, Warmwasser- und Wärmezähler je ${v.kaltwasser} Jahre`
      : `Kaltwasserzähler ${v.kaltwasser}, Warmwasserzähler ${v.warmwasser}, Wärmezähler ${v.waerme} Jahre`,
}
```

`shared/law/params.ts`: Import `import { messevCalibrationYears } from './messev.ts'` und in `LAW_PARAMS` in
alphabetischer Reihenfolge der Kennungen hinter den `hkv.*`-Einträgen `messevCalibrationYears,` einfügen.

- [ ] **Step 4: Regel (`shared/law/rules.ts`)**

Import ergänzen: `import { messevCalibrationYears } from './messev.ts'`. Unter den übrigen Konstanten:

```ts
// Eichfrist (Heizung PR 21): die Fassung von heute, wie im Lexikon.
const calibration = valueAt(messevCalibrationYears, LAW_AS_OF)
```

In `RULES` als letzten Eintrag:

```ts
  {
    // Heizung PR 21 (#98). Wortlaut § 34, § 35, Anlage 7 MessEV und § 37 MessEG gelesen am 05.10.2026; das
    // Urteil über LTO. Es betraf einen Wasserzähler; für Wärmezähler wird es übertragen (Entwurf 3.12).
    code: 'meter-calibration',
    title: 'Eichfrist der Zähler',
    norm: '§ 37 Abs. 1 MessEG; § 34, § 35, Anlage 7 MessEV; BGH, Urteil vom 17.11.2010, VIII ZR 112/10',
    summary:
      `Kaltwasser-, Warmwasser- und Wärmezähler müssen geeicht sein; die Eichfrist beträgt ${calibration.kaltwasser === calibration.warmwasser && calibration.warmwasser === calibration.waerme ? `je ${calibration.kaltwasser} Jahre` : 'nach Anlage 7 MessEV'} und endet erst mit dem Ende des Jahres, in dem sie rechnerisch abläuft. ` +
      'Danach darf ein Zähler nicht ungeeicht verwendet werden; auf Antrag kann die Behörde die Frist im Stichprobenverfahren verlängern. ' +
      'Ist ein Zähler nicht geeicht, muss der Vermieter im Streit beweisen, dass die abgelesenen Werte stimmen; beim geeichten Zähler spricht eine Vermutung für ihre Richtigkeit. ' +
      'Heizkostenverteiler sind nicht eichpflichtig.',
  },
```

- [ ] **Step 5: Lexikon (`shared/glossary.ts`)**

Import ergänzen: `import { messevCalibrationYears } from './law/messev.ts'`. Unter `REMOTE_CUT`:

```ts
const CALIBRATION = valueAt(messevCalibrationYears, LAW_AS_OF)
```

In `GLOSSARY` hinter `meterReading`:

```ts
  // Heizung PR 21 (#98): Eichfrist. Wortlaut § 34, Anlage 7 MessEV gelesen am 05.10.2026.
  meterCalibration: {
    title: 'Eichfrist',
    short: `Kalt- und Warmwasserzähler und Wärmezähler sind geeicht für ${CALIBRATION.kaltwasser} Jahre, gerechnet ab Eichung oder Kennzeichnung und bis zum Ende des Jahres, in dem die Frist abläuft; Heizkostenverteiler sind nicht eichpflichtig.`,
    example: `Ein Kaltwasserzähler, gekennzeichnet ${2022 /* Beispiel */} (Aufdruck „M22“), ist bis Ende ${2022 + CALIBRATION.kaltwasser} geeicht. Die Ablesung vom 31.12.${2022 + CALIBRATION.kaltwasser} zählt noch als geeicht, die vom 31.12.${2023 + CALIBRATION.kaltwasser} nicht mehr.`,
    norm: '§ 37 Abs. 1 MessEG; § 34, § 35 und Anlage 7 MessEV',
    needed: 'Ja, wenn Sie nach Zählern abrechnen. Nach Ablauf darf ein Zähler nicht ungeeicht verwendet werden. Bestreitet ein Mieter dann die Werte, müssen Sie beweisen, dass sie stimmen, etwa mit der Prüfung durch eine staatlich anerkannte Prüfstelle (Bundesgerichtshof, Urteil vom 17.11.2010, VIII ZR 112/10, zu einem Wasserzähler). Hat der Messdienst die Frist im Stichprobenverfahren verlängern lassen, gilt das verlängerte Jahr.',
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/law/messev.ts shared/law/params.ts shared/law/rules.ts shared/glossary.ts server/test/law.test.ts server/test/law-history.test.ts server/test/glossary.test.ts
git commit -m "Eichfrist: Fristen der MessEV und Regel im Rechtsregister

Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV mit je sechs Jahren ab dem
Inkrafttreten der Dritten Änderungsverordnung (03.11.2021). Eine frühere
Fassung führt das Register nicht, weil sie nicht an der Quelle gelesen ist.

Refs #98"
```

---

### Task 2: Datenmodell, Migrationen, Schreiben und Lesen

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/repository.ts`, `server/src/db/read.ts`, `server/test/migrations.test.ts`, `server/test/schema.test.ts` (nur falls er Zählerspalten einzeln führt), `server/test/db-repository.test.ts`
- Create: `server/drizzle/00xx_eichfrist.sql`, `server/drizzle/00xx_eichfrist_bedingungen.sql` (erzeugt), `server/test/db-eichfrist.test.ts`

**Interfaces:**
- Consumes: `meters` (schema.ts), `mergeMeter`, `meterRow`, `guardMeter`, `HeatingError`, `merged`, `has`,
  `raw` (repository.ts), `readMeters` mit `orUndefined` (read.ts).
- Produces: `Meter.calibratedUntil?: number | null`; Spalte `meters.calibratedUntil` (`calibrated_until`,
  integer, nullbar); Bedingungen `meters_calibrated_until_year`, `meters_calibrated_until_not_hca`.

- [ ] **Step 1: Write the failing tests**

`server/test/db-eichfrist.test.ts`:

```ts
// Eichfrist der Zähler (Heizung PR 21, #98): die Spalte meters.calibrated_until, ihre Bedingungen und das
// Schreiben über repository.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, findEntity, HeatingError, updateEntity } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-eichfrist-'))

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
const zaehler = (over: Record<string, unknown> = {}) => ({ propertyId: 'objekt-1', name: 'Kaltwasser Haus', unitId: null, type: 'kaltwasser', unit: 'm³', ...over })

test('Kette: die Schritte eichfrist und eichfrist_bedingungen bringen eine nullbare Spalte, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_eichfrist'))
    if (bis < 0) assert.fail('Schritt …_eichfrist fehlt')
    assert.ok(migrations[bis + 1]?.tag.endsWith('_eichfrist_bedingungen'), 'die Bedingungen folgen unmittelbar')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec("INSERT INTO meters (id, property_id, name, type, unit) VALUES ('alt', 'objekt-1', 'Alt', 'kaltwasser', 'm³')")
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT calibrated_until FROM meters WHERE id = 'alt'"), [[null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: vierstellige Jahreszahl, nie an einem Heizkostenverteiler', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 50, 1)")
    const insert = (id: string, type: string, unitId: string | null, until: string) =>
      `INSERT INTO meters (id, property_id, name, unit_id, type, unit, calibrated_until) VALUES ('${id}', 'objekt-1', '${id}', ${unitId === null ? 'NULL' : `'${unitId}'`}, '${type}', 'x', ${until})`
    assert.equal(rejects(c, insert('kw', 'kaltwasser', null, '2027')), null)
    assert.equal(rejects(c, insert('wz', 'waerme', 'u1', '2030')), null)
    assert.equal(rejects(c, insert('st', 'strom', null, '2031')), null)
    assert.equal(rejects(c, insert('leer', 'kaltwasser', null, 'NULL')), null)
    assert.match(rejects(c, insert('kurz', 'kaltwasser', null, '27')) ?? '', /meters_calibrated_until_year/)
    assert.match(rejects(c, insert('lang', 'kaltwasser', null, '20270')) ?? '', /meters_calibrated_until_year/)
    assert.match(rejects(c, insert('hkv', 'hkv', 'u1', '2027')) ?? '', /meters_calibrated_until_not_hca/)
    assert.equal(rejects(c, insert('hkv2', 'hkv', 'u1', 'NULL')), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: das Eichjahr wird gespeichert, geändert und geleert', async () => {
  await withDatabase(async (opened) => {
    const z = await opened.write((db) => createEntity(db, 'meters', 'm1', zaehler({ calibratedUntil: 2027 })))
    assert.equal(fieldOf(z, 'calibratedUntil'), 2027)
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { name: 'Kaltwasser Keller' }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'meters', 'm1')), 'calibratedUntil'), 2027, 'ein Teilrumpf ohne das Feld behält es')
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: 2033 }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'meters', 'm1')), 'calibratedUntil'), 2033)
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: null }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'meters', 'm1')), 'calibratedUntil'), undefined)
  })
})

test('Schreiben: unbrauchbare Jahreszahl wird mit einem Satz abgelehnt', async () => {
  await withDatabase(async (opened) => {
    for (const bad of [27, 2027.5, '2027', -2027]) {
      await assert.rejects(
        opened.write((db) => createEntity(db, 'meters', `m-${String(bad)}`, zaehler({ calibratedUntil: bad }))),
        (e: unknown) => e instanceof HeatingError && e.status === 400 && /Jahreszahl/.test(e.message),
        String(bad),
      )
    }
  })
})

test('Review Focus 4: Heizkostenverteiler ohne Eichjahr; beim Umstellen fällt es weg, ausdrücklich gesendet gibt es 400', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }))
    await opened.write((db) => createEntity(db, 'meters', 'm1', zaehler({ name: 'Wärme EG', unitId: 'u1', type: 'waerme', unit: 'kWh', calibratedUntil: 2027 })))
    const umgestellt = await opened.write((db) => updateEntity(db, 'meters', 'm1', { type: 'hkv', unit: 'Einheiten' }))
    assert.equal(fieldOf(umgestellt, 'calibratedUntil'), undefined)
    await assert.rejects(
      opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: 2030 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Heizkostenverteiler sind keine eichpflichtigen Messgeräte/.test(e.message),
    )
  })
})
```

`server/test/db-repository.test.ts`, Test „Die Verschmelzung erreicht jede Spalte“: im Rumpf der Probe
`meters` (seit PR 4 mit `installedOn: '2022-03-01'`) `calibratedUntil: 2028,` anhängen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-eichfrist.test.ts test/db-repository.test.ts`
Expected: FAIL: „Schritt …_eichfrist fehlt“, Prüfungen lehnen nicht ab, `db-repository.test.ts` meldet „Die
Spalte „calibratedUntil“ ist beim Verschmelzen verlorengegangen“.

- [ ] **Step 3: Typ (`shared/types.ts`)**

In `Meter` hinter `installedOn?: string | null` (PR 4):

```ts
  // Bis zu welchem Jahr der Zähler geeicht ist (Heizung PR 21, #98): Die Eichfrist endet mit dem Ende
  // dieses Jahres (§ 34 Abs. 2 MessEV). `null` oder fehlend: nicht angegeben. Nie bei `hkv`, denn
  // Heizkostenverteiler sind nicht eichpflichtig (Entwurf 3.12, Z-B10).
  calibratedUntil?: number | null
```

- [ ] **Step 4: Erster Schritt: Spalte (`server/src/db/schema.ts`)**

In `meters` hinter `installedOn: text('installed_on'),` (PR 4):

```ts
    // Geeicht bis Ende dieses Jahres (Heizung PR 21, #98, Entwurf 3.12).
    calibratedUntil: integer('calibrated_until'),
```

Run: `npm --prefix server run db:generate -- --name eichfrist`
Expected: `server/drizzle/00xx_eichfrist.sql` mit genau `ALTER TABLE \`meters\` ADD \`calibrated_until\`
integer;`, **ohne** `__new_`. Steht ein Neubau darin, Datei, Journal-Eintrag und Momentaufnahme löschen und
nur die Spalte erzeugen. Fragt drizzle-kit nach einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In der Bedingungsliste von `meters` (hinter den Bedingungen von PR 4) ergänzen; `check` und `sql` sind in
schema.ts schon importiert:

```ts
    // Eichjahr (Heizung PR 21): eine vierstellige Jahreszahl, wie der Schlüssel der Jahreskorrektur, und nie
    // an einem Heizkostenverteiler (nicht eichpflichtig, Entwurf 3.12).
    check('meters_calibrated_until_year', sql.raw('"calibrated_until" IS NULL OR "calibrated_until" BETWEEN 1000 AND 9999')),
    check('meters_calibrated_until_not_hca', sql.raw(`"calibrated_until" IS NULL OR "type" <> 'hkv'`)),
```

Run: `npm --prefix server run db:generate -- --name eichfrist_bedingungen`
Expected: `server/drizzle/00xx_eichfrist_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, Neubau
`__new_meters` samt `INSERT INTO … SELECT` mit `calibrated_until`, `DROP TABLE`, `RENAME`,
`PRAGMA foreign_keys=ON`. Prüfen:

Run: `grep -c '__new_meters' server/drizzle/*_eichfrist_bedingungen.sql && grep -c 'calibrated_until' server/drizzle/*_eichfrist_bedingungen.sql`
Expected: eine Zahl ≥ 3, dann eine Zahl ≥ 4.

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('eichfrist')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

Expected: zwei Zeilen. In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter den Schritten von
PR 19 einfügen, darüber:

```ts
  // Heizung PR 21 (#98). Wird ein Vorgänger vor dem Push neu erzeugt, werden diese beiden Schritte neu
  // erzeugt und die Marken hier ersetzt.
```

Danach `node scripts/embed-migrations.mjs` nicht von Hand aufrufen; der Test vergleicht beide Wege selbst.

- [ ] **Step 7: Schreiben (`server/src/db/repository.ts`)**

`mergeMeter`, vor dem `return` (hinter `const heatingPlantId = …` von PR 4):

```ts
  const type = merged(body, 'type', current.type, (v) => oneOfOrUndefined(METER_TYPES, v) ?? current.type)
```

Steht `type` in `mergeMeter` schon als eigene Konstante (Fassung von PR 4), diese verwenden und die Zeile
weglassen. `METER_TYPES` aus `'./schema.ts'` importieren, falls repository.ts es noch nicht tut. Im Objekt `type: merged(…),` durch `type,` ersetzen und hinter `installedOn: …` ergänzen:

```ts
    // Eichjahr (Heizung PR 21). Ein Heizkostenverteiler hat keins: Beim Umstellen der Sparte fällt es weg,
    // statt dass die Prüfbedingung ohne Satz ablehnt (Review Focus 4). Was kein Jahr ist, bleibt als
    // Rohwert stehen und lehnt `guardMeter` mit einem Satz ab.
    calibratedUntil: type === 'hkv' && !has(body, 'calibratedUntil')
      ? null
      : merged(body, 'calibratedUntil', current.calibratedUntil ?? null, (v) => (v === null || v === undefined ? null : (v as number))),
```

`meterRow` bekommt `calibratedUntil: m.calibratedUntil ?? null,`.

`guardMeter` (Fassung von PR 4) bekommt als erste Prüfungen hinter `sameProperty(…)`:

```ts
  const until = after.calibratedUntil ?? null
  if (until !== null && (typeof until !== 'number' || !Number.isInteger(until) || until < 1000 || until > 9999)) {
    throw new HeatingError(400, 'Das Eichjahr ist keine Jahreszahl. Bitte tragen Sie das Jahr vierstellig ein, etwa 2028, oder lassen Sie das Feld leer.')
  }
  if (until !== null && after.type === 'hkv') {
    throw new HeatingError(400, 'Heizkostenverteiler sind keine eichpflichtigen Messgeräte; ein Eichjahr gibt es für sie nicht. Bitte lassen Sie das Feld leer.')
  }
```

Hinweis zur Reihenfolge: Die Typzusicherung `(v as number)` im Merge ist keine Behauptung über den Wert,
sondern reicht den Rohwert an `guardMeter` weiter, das ihn prüft, bevor geschrieben wird; ein String „2027“
wird dort abgelehnt (Test oben). Kennt repository.ts für Rohwerte schon einen Helfer `raw` (PR 4), diesen
statt der Zusicherung nehmen: `merged(body, 'calibratedUntil', current.calibratedUntil ?? null, raw)`.

- [ ] **Step 8: Lesen (`server/src/db/read.ts`)**

In `readMeters` im Objekt je Zähler hinter `installedOn: orUndefined(m.installedOn),`:

```ts
    calibratedUntil: orUndefined(m.calibratedUntil),
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-eichfrist.test.ts test/db-repository.test.ts test/migrations.test.ts test/schema.test.ts test/db-heizanlage.test.ts test/db-golden.test.ts test/db-changeover.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS. `schema.test.ts` vergleicht `typeof schema.meters.$inferSelect` mit `Meter`; das neue Feld steht
auf beiden Seiten. Führt sein Test „Migration lässt sich anwenden …“ die Spalten von `meters` einzeln, dort
`calibrated_until` ergänzen.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle server/src/db/repository.ts server/src/db/read.ts server/test/db-eichfrist.test.ts server/test/migrations.test.ts server/test/db-repository.test.ts server/test/schema.test.ts
git commit -m "Eichfrist: Spalte meters.calibrated_until mit Bedingungen

Vierstellige Jahreszahl, nie an einem Heizkostenverteiler; beim Umstellen
der Sparte auf HKV fällt das Jahr weg, ausdrücklich gesendet gibt es 400.

Refs #98"
```

---

### Task 3: Prüfung und Hinweis `meter.calibration-overdue`

**Files:**
- Create: `server/src/calibration.ts`, `server/test/calibration.test.ts`
- Modify: `server/src/calc.ts`, `server/src/snapshot.ts`, `server/test/law-literals.test.ts`

**Interfaces:**
- Consumes: `SnapshotReading` (snapshot.ts), `dayBefore` (register.ts), `noticeKinds`, `makeNotice`,
  `consumptionOverview` (calc.ts), `Meter.calibratedUntil` (Task 2).
- Produces:
  - `server/src/calibration.ts`: `readingsUsedFor(readings: readonly SnapshotReading[], period: { from: string; to: string }): SnapshotReading[]`;
    `calibrationOverdue(calibratedUntil: number | null | undefined, readings: readonly SnapshotReading[], period: { from: string; to: string }): { lastDate: string } | null`.
  - `SnapshotMeter` pickt zusätzlich `'calibratedUntil'`.
  - Code `meter.calibration-overdue` (warning, Regel `meter-calibration`, Begriff `meterCalibration`).

- [ ] **Step 1: Write the failing tests**

`server/test/calibration.test.ts`:

```ts
// Eichfrist (Heizung PR 21, #98): welche Ablesungen ein Zeitraum benutzt und ob eine davon aus der Zeit nach
// Ablauf der Eichfrist stammt. Die Frist endet mit dem Ende des Jahres (§ 34 Abs. 2 MessEV); eine Ablesung
// gilt in Mietfuchs zum Tagesende ihres Datums (calc.ts, meterSegments).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrationOverdue, readingsUsedFor } from '../src/calibration.ts'
import { consumptionOverview } from '../src/calc.ts'
import { snapshotFromDb, type SnapshotReading } from '../src/snapshot.ts'
import type { Db } from '../src/store.ts'

const r = (date: string, value: number, extra: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId: 'm1', date, value, ...extra })
const year2025 = { from: '2025-01-01', to: '2025-12-31' }
const dates = (rs: readonly SnapshotReading[]) => rs.map((x) => x.date)

test('Benutzte Ablesungen: Stand vor Beginn, alle im Zeitraum; danach nur, wenn am letzten Tag keine liegt', () => {
  const rs = [r('2024-06-30', 1), r('2024-12-31', 2), r('2025-06-30', 3), r('2025-12-31', 4), r('2026-01-15', 5)]
  assert.deepEqual(dates(readingsUsedFor(rs, year2025)), ['2024-12-31', '2025-06-30', '2025-12-31'])
  const ohneEnde = [r('2024-12-31', 2), r('2025-11-30', 3), r('2026-01-15', 5), r('2026-02-15', 6)]
  assert.deepEqual(dates(readingsUsedFor(ohneEnde, year2025)), ['2024-12-31', '2025-11-30', '2026-01-15'])
  const ohneAnfang = [r('2024-11-30', 1), r('2025-01-15', 2), r('2025-12-31', 3)]
  assert.deepEqual(dates(readingsUsedFor(ohneAnfang, year2025)), ['2024-11-30', '2025-01-15', '2025-12-31'])
})

test('Review Focus 1: Die Ablesung am 31.12. des Eichjahres zählt noch, die am 01.01. danach nicht', () => {
  assert.equal(calibrationOverdue(2025, [r('2024-12-31', 1), r('2025-12-31', 2)], year2025), null)
  const naechstesJahr = { from: '2026-01-01', to: '2026-12-31' }
  assert.deepEqual(calibrationOverdue(2025, [r('2025-12-31', 2), r('2026-01-01', 3), r('2026-12-31', 9)], naechstesJahr), { lastDate: '2026-12-31' })
})

test('Review Focus 2: Ohne Ablesung am Ende zählt die erste danach, auch wenn sie nach Ablauf liegt', () => {
  assert.deepEqual(calibrationOverdue(2025, [r('2024-12-31', 1), r('2025-11-30', 2), r('2026-01-15', 3)], year2025), { lastDate: '2026-01-15' })
})

test('Review Focus 3: Nur das Gerät seit dem letzten Wechsel wird geprüft', () => {
  const rs = [
    r('2024-12-31', 100),
    r('2025-06-30', 0, { replacement: true, oldEndValue: 150 }),
    r('2025-12-31', 40),
  ]
  // Das neue Gerät ist bis 2031 geeicht; die Stände des alten Geräts kennt Mietfuchs nicht.
  assert.equal(calibrationOverdue(2031, rs, year2025), null)
  assert.deepEqual(calibrationOverdue(2024, rs, year2025), { lastDate: '2025-12-31' })
})

test('Ohne Eichjahr oder ohne Ablesung kein Befund', () => {
  assert.equal(calibrationOverdue(null, [r('2025-12-31', 1)], year2025), null)
  assert.equal(calibrationOverdue(undefined, [r('2025-12-31', 1)], year2025), null)
  assert.equal(calibrationOverdue(2020, [], year2025), null)
})

const emptyDb = (): Db => ({
  settings: { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: 'http://localhost:11434', ollamaModel: '' },
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Zähler-Seite: Warnung mit Jahr, Datum, MessEG, Beweislast und § 35; ohne Eichjahr nichts', () => {
  const db: Db = {
    ...emptyDb(),
    meters: [{ id: 'm1', name: 'Kaltwasser Haus', unitId: null, type: 'kaltwasser', unit: 'm³' }],
    readings: [
      { id: 'a', meterId: 'm1', date: '2024-12-31', value: 100 },
      { id: 'b', meterId: 'm1', date: '2025-12-31', value: 180 },
    ],
  }
  const base = snapshotFromDb(db, 2025)
  assert.deepEqual(consumptionOverview(base).flatMap((z) => z.notices.map((n) => n.code)), [])
  const ueberfaellig = { ...base, meters: base.meters.map((m) => ({ ...m, calibratedUntil: 2024 })) }
  const zeile = consumptionOverview(ueberfaellig).find((z) => z.meterId === 'm1') ?? assert.fail('Zähler fehlt')
  const n = zeile.notices.find((x) => x.code === 'meter.calibration-overdue') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.equal(n.rule, 'meter-calibration')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'm1' })
  assert.match(n.text, /„Kaltwasser Haus“.*bis Ende 2024 geeicht.*Ablesung vom 31\.12\.2025/s)
  assert.match(n.text, /§ 37 Abs\. 1 MessEG/)
  assert.match(n.text, /verwendet die Werte trotzdem/)
  assert.match(n.text, /müssen Sie beweisen.*VIII ZR 112\/10/s)
  assert.match(n.text, /§ 35 MessEV/)
  assert.ok(zeile.warnings.includes(n.text), 'die Textliste führt den Hinweis wie die übrigen')
  // Der Verbrauch selbst bleibt (die Werte werden verwendet).
  assert.equal(zeile.consumption, 80)
})
```

`server/test/law-literals.test.ts`: `ENGINE_FILES` um `'server/src/calibration.ts'` ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calibration.test.ts test/law-literals.test.ts`
Expected: FAIL: `Cannot find module '../src/calibration.ts'`; `law-literals.test.ts`: „server/src/calibration.ts gibt
es nicht; die Liste ist veraltet“.

- [ ] **Step 3: Implement `server/src/calibration.ts`**

```ts
// Eichfrist der Zähler (Heizung PR 21, #98, Entwurf 3.12). Reine Rechnung ohne Speicher.
//
// Die Eichfrist endet mit dem Ende des Jahres, in dem sie rechnerisch abläuft (§ 34 Abs. 2 MessEV); das
// gespeicherte Eichjahr ist dieses Jahr. Danach darf der Zähler nicht ungeeicht verwendet werden (§ 37
// Abs. 1 MessEG). Eine Ablesung gilt in Mietfuchs zum Tagesende ihres Datums; die vom 31.12. des
// Eichjahres stammt also noch aus der Frist.
//
// Geprüft werden die Ablesungen, die der Zeitraum benutzt (`readingsUsedFor`), und nur die des Geräts
// seit dem letzten Wechsel: Das Eichjahr ist eine Angabe zum heutigen Gerät (Plan PR 21, Abweichung 6).
// Weil „nach Ablauf“ mit dem Datum nur zunimmt, genügt die jüngste benutzte Ablesung.
import { dayBefore } from '../../shared/law/register.ts'
import type { SnapshotReading } from './snapshot.ts'

type Period = { from: string; to: string }

// Die Ablesungen, aus denen der Verbrauch eines Zeitraums entsteht (wie consumptionInPeriod in calc.ts):
// der letzte Stand bis zum Vortag des Beginns, jede Ablesung im Zeitraum und, wenn am letzten Tag keine
// liegt, die erste danach, denn aus ihr wird der Stand zum Ende interpoliert. Sortiert nach Datum,
// Zeichen für Zeichen wie compareText.
export function readingsUsedFor(readings: readonly SnapshotReading[], period: Period): SnapshotReading[] {
  const sorted = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const startDay = dayBefore(period.from)
  const before = sorted.filter((x) => x.date < startDay).at(-1)
  const inside = sorted.filter((x) => x.date >= startDay && x.date <= period.to)
  const endsOnLastDay = inside.some((x) => x.date === period.to)
  const after = endsOnLastDay ? undefined : sorted.find((x) => x.date > period.to)
  const startsOnFirstBoundary = inside.some((x) => x.date === startDay)
  return [...(startsOnFirstBoundary || !before ? [] : [before]), ...inside, ...(after ? [after] : [])]
}

// Stammt eine benutzte Ablesung des heutigen Geräts aus der Zeit nach dem Ende des Eichjahres? Dann die
// jüngste davon, für den Hinweis.
export function calibrationOverdue(
  calibratedUntil: number | null | undefined,
  readings: readonly SnapshotReading[],
  period: Period,
): { lastDate: string } | null {
  if (calibratedUntil === null || calibratedUntil === undefined) return null
  const used = readingsUsedFor(readings, period)
  const lastReplacement = used.filter((x) => x.replacement === true).at(-1)
  const ofDevice = lastReplacement ? used.filter((x) => x.date >= lastReplacement.date) : used
  const end = `${calibratedUntil}-12-31`
  const late = ofDevice.filter((x) => x.date > end).at(-1)
  return late ? { lastDate: late.date } : null
}
```

- [ ] **Step 4: Schnappschuss (`server/src/snapshot.ts`)**

`SnapshotMeter` (Fassung von PR 4) um `'calibratedUntil'` im `Pick` ergänzen:

```ts
export type SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn' | 'calibratedUntil'> & Partial<Pick<Meter, 'name'>>
```

Die Zähler gehen aus `readMeters` vollständig hinein (Task 2); ein Bestand aus der db.json hat das Feld nicht,
und `calibratedUntil` ist optional.

- [ ] **Step 5: Hinweis (`server/src/calc.ts`)**

Import: `import { calibrationOverdue } from './calibration.ts'`.

In `noticeKinds` hinter `'meter.same-day'`:

```ts
  // Heizung PR 21 (#98): eine Warnung, keine Sperre; die Werte werden verwendet (Entwurf 3.12, #91).
  'meter.calibration-overdue': { level: 'warning', title: 'Eichfrist abgelaufen', rule: 'meter-calibration', terms: ['meterCalibration', 'meterReading'] },
```

`consumptionOverview` ersetzen durch:

```ts
// Übersicht für die Zähler-Seite über den Zeitraum der Abrechnung (#208): Verbrauch pro Zähler + Warnungen.
// Dazu die Eichfrist (Heizung PR 21): Sie steht hier und nicht auf der Abrechnung, wie die übrigen
// Zählerhinweise; das Cockpit liest sie für die Ampel „Zählerstände“.
export function consumptionOverview(snapshot: Snapshot): ConsumptionOverviewRow[] {
  const { from, to } = snapshot.period
  return snapshot.meters.map((m) => {
    const readings = snapshot.readings.filter((r) => r.meterId === m.id)
    const { notices, warnings } = meterSegments(readings)
    const overdue = calibrationOverdue(m.calibratedUntil, readings, { from, to })
    if (overdue && m.calibratedUntil != null) {
      const n = makeNotice('meter.calibration-overdue',
        `Zähler „${m.name ?? m.id}“: laut Ihrer Angabe nur bis Ende ${m.calibratedUntil} geeicht; die Ablesung vom ${fmtDay(overdue.lastDate)} stammt aus der Zeit danach. ` +
          'Nach Ablauf der Eichfrist darf ein Zähler nicht ungeeicht verwendet werden (§ 37 Abs. 1 MessEG). Mietfuchs verwendet die Werte trotzdem. ' +
          'Bestreitet ein Mieter sie, müssen Sie beweisen, dass sie stimmen, etwa mit einer Prüfung bei einer staatlich anerkannten Prüfstelle; beim geeichten Zähler spräche eine Vermutung für ihre Richtigkeit (BGH VIII ZR 112/10, zu einem Wasserzähler, für andere Zähler übertragen). ' +
          'Lassen Sie den Zähler eichen oder tauschen. Hat der Messdienst die Eichfrist im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das Jahr ein, bis zu dem sie verlängert ist.',
        { kind: 'meter', id: m.id })
      notices.push(n)
      warnings.push(n.text)
    }
    return {
      meterId: m.id,
      consumption: Math.round(consumptionInPeriod(readings, from, to) * 100) / 100,
      readingCount: readings.length,
      notices,
      warnings,
    }
  })
}
```

(`meterSegments` gibt neue Arrays zurück; das Anhängen verändert nichts außerhalb.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calibration.test.ts test/law-literals.test.ts test/calc.test.ts test/settlement-golden.test.ts test/glossary.test.ts && npm run typecheck`
Expected: PASS. `glossary.test.ts` prüft, dass jeder Code in `noticeKinds` Begriffe trägt, die es gibt.

- [ ] **Step 7: Cockpit prüfen**

Run: `npm --prefix client test -- notices Cockpit`
Expected: PASS. Die Ampel „Zählerstände“ liest die `warning`-Hinweise aus `consumptionOverview`; ein neuer
Code braucht dort keine Zeile. Steht in `client/src/notices.ts` eine Liste der Zählercodes (etwa
`METER_CODES`), dort `'meter.calibration-overdue'` ergänzen und den Test dazu um einen Fall erweitern:

```ts
test('Eichfrist färbt die Ampel „Zählerstände“ (Heizung PR 21)', () => {
  expect(meterLevel([{ code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist abgelaufen', text: 'x' }])).toBe('warning')
})
```

(`meterLevel` steht für die Funktion, mit der `notices.ts` die Ampel der Zählerstände bildet; heißt sie
anders, deren Namen. Gibt es keine solche Liste, entfällt dieser Schritt.)

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calibration.ts server/test/calibration.test.ts server/src/calc.ts server/src/snapshot.ts server/test/law-literals.test.ts client/src/notices.ts client/src/notices.test.ts
git commit -m "Eichfrist: Hinweis meter.calibration-overdue auf der Zähler-Seite

Geprüft werden die Ablesungen, die der Zeitraum benutzt, und nur die des
Geräts seit dem letzten Wechsel. Die Werte werden trotzdem verwendet; der
Text nennt die Beweislast nach BGH VIII ZR 112/10 und § 35 MessEV.

Refs #98"
```

---

### Task 4: Zählerformular mit Vorschlag

**Files:**
- Modify: `client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx`
- Test: `client/src/meterForm.test.ts`

**Interfaces:**
- Consumes: `messevCalibrationYears`, `CALIBRATED_METER_TYPES` (Task 1); `valueAt`, `versionAt`,
  `germanDate` (register.ts); `MeterForm`, `meterToForm`, `meterBody`, `emptyMeterForm` (PR 4).
- Produces: `MeterForm.calibratedUntil: string`; `meterBody` liefert `calibratedUntil: number | null`;
  `calibrationSuggestion(type: MeterType, markedYear: string): { year: number; text: string } | { reason: string }`;
  `asksCalibration(form: MeterForm): boolean`.

- [ ] **Step 1: Write the failing tests**

`client/src/meterForm.test.ts` anhängen (Import aus `'./meterForm'` um `asksCalibration, calibrationSuggestion`
ergänzen):

```ts
describe('Eichfrist (Heizung PR 21)', () => {
  test('Eichjahr ins Formular und zurück; leer ist null; beim Heizkostenverteiler nie', () => {
    const m = { id: 'm1', propertyId: 'objekt-1', name: 'Kaltwasser', unitId: null, type: 'kaltwasser' as const, unit: 'm³', calibratedUntil: 2028 }
    const form = meterToForm(m)
    expect(form.calibratedUntil).toBe('2028')
    const r = meterBody(form, null)
    if ('error' in r) throw new Error(r.error)
    expect(r.body.calibratedUntil).toBe(2028)
    const leer = meterBody({ ...form, calibratedUntil: '' }, null)
    expect('body' in leer && leer.body.calibratedUntil).toBe(null)
    const hkv = meterBody({ ...emptyMeterForm(), name: 'HKV', type: 'hkv', unitId: 'u1', calibratedUntil: '2028' }, null)
    expect('body' in hkv && hkv.body.calibratedUntil).toBe(null)
    expect(asksCalibration({ ...emptyMeterForm(), type: 'hkv' })).toBe(false)
    expect(asksCalibration({ ...emptyMeterForm(), type: 'strom' })).toBe(true)
  })

  test('Eichjahr, das keine vierstellige Jahreszahl ist, ergibt einen Satz', () => {
    expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: '28' }, null)).toEqual({ error: 'Bitte tragen Sie das Eichjahr vierstellig ein, etwa 2028, oder lassen Sie das Feld leer.' })
    expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: '2028,5' }, null)).toEqual({ error: 'Bitte tragen Sie das Eichjahr vierstellig ein, etwa 2028, oder lassen Sie das Feld leer.' })
  })

  test('Review Focus 5: Vorschlag ab dem ersten vollen Jahr der Fassung, davor ein Satz mit dem Grund', () => {
    expect(calibrationSuggestion('warmwasser', '2022')).toEqual({ year: 2028, text: 'Vorschlag: geeicht bis Ende 2028 (Eichung oder Kennzeichnung 2022, Eichfrist 6 Jahre).' })
    expect(calibrationSuggestion('kaltwasser', '2025')).toEqual({ year: 2031, text: 'Vorschlag: geeicht bis Ende 2031 (Eichung oder Kennzeichnung 2025, Eichfrist 6 Jahre).' })
    const alt = calibrationSuggestion('warmwasser', '2021')
    expect('reason' in alt && alt.reason).toMatch(/vor 2022.*03\.11\.2021.*fünf auf sechs Jahre.*Übergangsregel.*Messdienst oder.*Eichschein/s)
    expect('reason' in calibrationSuggestion('strom', '2024') && calibrationSuggestion('strom', '2024')).toBeTruthy()
    expect(calibrationSuggestion('waerme', '22')).toEqual({ reason: 'Bitte nennen Sie das Jahr vierstellig, etwa 2022.' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- meterForm`
Expected: FAIL: `asksCalibration` und `calibrationSuggestion` sind keine Exporte; `form.calibratedUntil` ist
`undefined`.

- [ ] **Step 3: Implement (`client/src/meterForm.ts`)**

Importe ergänzen:

```ts
import { CALIBRATED_METER_TYPES, messevCalibrationYears } from '../../shared/law/messev.ts'
import { germanDate, versionAt } from '../../shared/law/register.ts'
```

In `MeterForm` hinter `installedOn: string`:

```ts
  // Geeicht bis Ende dieses Jahres (Heizung PR 21); leer heißt „nicht angegeben“.
  calibratedUntil: string
```

`emptyMeterForm`: `calibratedUntil: ''` ergänzen. `meterToForm`:
`calibratedUntil: m.calibratedUntil == null ? '' : String(m.calibratedUntil),`.

In `MeterBody` hinter `installedOn: string | null`: `calibratedUntil: number | null`.

In `meterBody` vor dem `return`:

```ts
  const untilText = form.calibratedUntil.trim()
  if (form.type !== 'hkv' && untilText !== '' && !/^\d{4}$/.test(untilText)) {
    return { error: 'Bitte tragen Sie das Eichjahr vierstellig ein, etwa 2028, oder lassen Sie das Feld leer.' }
  }
```

und im Rumpf hinter `installedOn: …`:

```ts
      // Heizkostenverteiler sind nicht eichpflichtig (Entwurf 3.12): nie ein Eichjahr.
      calibratedUntil: form.type === 'hkv' || untilText === '' ? null : Number(untilText),
```

Ans Dateiende:

```ts
// ---------- Eichfrist (Heizung PR 21, #98) ----------

// Das Feld gibt es für jede Sparte außer Heizkostenverteilern (Plan PR 21, Abweichung 7).
export const asksCalibration = (form: Pick<MeterForm, 'type'>): boolean => form.type !== 'hkv'

const isCalibrated = (t: MeterType): t is (typeof CALIBRATED_METER_TYPES)[number] =>
  (CALIBRATED_METER_TYPES as readonly MeterType[]).includes(t)

// Vorschlag „geeicht bis“ aus dem Jahr der Eichung oder Kennzeichnung (§ 34 Abs. 1 Satz 2 und Abs. 2
// MessEV, § 37 Abs. 1 Satz 2 MessEG): dieses Jahr plus Eichfrist, denn die Frist endet erst mit dem Ende des
// Jahres, in dem sie rechnerisch abläuft. Nur, wenn der 1. Januar des Jahres in der Fassung des Registers
// liegt (Plan PR 21, Abweichung 3); die Kennzeichnung nennt nur das Jahr.
export function calibrationSuggestion(type: MeterType, markedYear: string): { year: number; text: string } | { reason: string } {
  const text = markedYear.trim()
  if (!/^\d{4}$/.test(text)) return { reason: 'Bitte nennen Sie das Jahr vierstellig, etwa 2022.' }
  if (!isCalibrated(type)) {
    return { reason: 'Für diese Sparte schlägt Mietfuchs kein Jahr vor. Tragen Sie das Jahr ein, das der Versorger, der Messdienst oder der Eichschein nennt.' }
  }
  const first = messevCalibrationYears.versions[0]?.validFrom ?? ''
  const firstFullYear = Number(first.slice(0, 4)) + (first.endsWith('-01-01') ? 0 : 1)
  const year = Number(text)
  if (`${year}-01-01` < first || year < firstFullYear) {
    return {
      reason:
        `Für Zähler, die vor ${firstFullYear} geeicht oder gekennzeichnet wurden, schlägt Mietfuchs kein Jahr vor: Am ${germanDate(first)} stieg die Eichfrist der Warmwasser- und Wärmezähler von fünf auf sechs Jahre, und eine Übergangsregel für schon geeichte Zähler enthält die Verordnung nicht. ` +
        'Tragen Sie das Jahr ein, das der Messdienst oder der Eichschein nennt.',
    }
  }
  const years = versionAt(messevCalibrationYears, `${year}-01-01`).value[type]
  return { year: year + years, text: `Vorschlag: geeicht bis Ende ${year + years} (Eichung oder Kennzeichnung ${year}, Eichfrist ${years} Jahre).` }
}
```

Hinweis zur Zahl in der Begründung: „fünf auf sechs“ ist der Inhalt der Änderung (die Dritte
Änderungsverordnung ersetzt „5“ durch „6“), nicht eine Rechtszahl, mit der gerechnet wird; der Wächter
`law-literals.test.ts` prüft nur die Dateien der Berechnung, nicht die Oberfläche.

- [ ] **Step 4: Zählerformular (`client/src/pages/Zaehler.tsx`)**

Importe aus `'../meterForm'` um `asksCalibration, calibrationSuggestion` ergänzen. Zustand im Bauteil:

```ts
  const [markedYear, setMarkedYear] = useState('')
```

Beim Öffnen des Drawers (`onEdit` und „Neuer Zähler“) `setMarkedYear('')`. Im Drawer hinter dem Block mit
„Eingebaut am“ (PR 4):

```tsx
            {asksCalibration(meterForm) && (
              <div className="field-group">
                <label className="field grow">
                  Geeicht bis Ende (Jahr)
                  <input inputMode="numeric" value={meterForm.calibratedUntil} onChange={(e) => setMeterForm({ ...meterForm, calibratedUntil: e.target.value })} />
                  <small className="muted">
                    Die Eichfrist endet mit dem Ende dieses Jahres. Hat der Messdienst sie im Stichprobenverfahren verlängern lassen (§ 35 MessEV),
                    tragen Sie das verlängerte Jahr ein. <Term id="meterCalibration" />
                  </small>
                </label>
                <label className="field">
                  Jahr der Eichung oder Kennzeichnung (etwa „M22“ auf dem Zähler)
                  <input inputMode="numeric" value={markedYear} onChange={(e) => setMarkedYear(e.target.value)} />
                </label>
                {markedYear.trim() !== '' && (() => {
                  const s = calibrationSuggestion(meterForm.type, markedYear)
                  return 'reason' in s
                    ? <p className="muted">{s.reason}</p>
                    : (
                      <p>
                        {s.text}{' '}
                        <button type="button" className="btn secondary" onClick={() => setMeterForm({ ...meterForm, calibratedUntil: String(s.year) })}>Übernehmen</button>
                        <br />
                        <small className="muted">Wurde der Zähler erst nach Ablauf der alten Frist neu geeicht, beginnt die neue Frist mit dem Ablauf der alten (§ 34 Abs. 1 Satz 3 MessEV); nehmen Sie dann das Jahr laut Eichschein.</small>
                      </p>
                    )
                })()}
              </div>
            )}
```

(`Term` ist in Zaehler.tsx importiert; falls nicht: `import Term from '../components/Term'`.)

In der Liste der Zähler hinter der Zählernummer das Eichjahr anzeigen, wenn eines eingetragen ist:

```tsx
{m.calibratedUntil != null && <span className="muted"> · geeicht bis {m.calibratedUntil}</span>}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix client test -- meterForm Zaehler && npm run typecheck && npm run build`
Expected: PASS; der Build bündelt `shared/law/messev.ts`.

- [ ] **Step 6: Commit**

```bash
git add client/src/meterForm.ts client/src/meterForm.test.ts client/src/pages/Zaehler.tsx
git commit -m "Eichfrist: Feld im Zählerformular mit Vorschlag aus dem Jahr der Kennzeichnung

Vorschlag nur ab dem ersten vollen Jahr der sechsjährigen Frist; davor
nennt das Formular den Grund und fragt nach dem Jahr laut Messdienst.

Refs #98"
```

---

### Task 5: Doku und Abschluss

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG**

Unter „Unveröffentlicht“, Abschnitt „Hinzugefügt“:

```markdown
- Eichfrist der Zähler: An jedem Zähler außer Heizkostenverteilern lässt sich eintragen, bis zu welchem Jahr
  er geeicht ist; aus dem Jahr der Eichung oder Kennzeichnung schlägt Mietfuchs es vor (Kalt-, Warmwasser-
  und Wärmezähler sechs Jahre, ab 2022). Stammt eine Ablesung aus der Zeit danach, warnen Zähler-Seite und
  Cockpit und nennen die Beweislast; die Werte werden weiter verwendet
  ([#98](https://github.com/speedone/mietfuchs/issues/98)).
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt „Berechnungs-Engine“, Punkt „Zähler“, hinter dem Absatz über zwei Ablesungen am selben Tag:

```markdown
  **Die Eichfrist** (#98, Heizung PR 21) ist eine Warnung und keine Sperre: `meter.calibration-overdue`
  entsteht in `consumptionOverview` (Zähler-Seite, Cockpit), nicht auf der Abrechnung. Geprüft werden die
  Ablesungen, die der Zeitraum benutzt (`readingsUsedFor` in server/src/calibration.ts, samt der ersten
  Ablesung nach dem Ende, wenn interpoliert wird), und nur die des Geräts seit dem letzten Wechsel. Die
  Frist endet mit dem Ende des Eichjahres (§ 34 Abs. 2 MessEV); eine Ablesung vom 31.12. zählt noch.
  Heizkostenverteiler haben kein Eichjahr (Prüfbedingung). Die Fristen stehen im Register
  (`messev.calibration-years`) erst ab dem 03.11.2021: Die Dritte Änderungsverordnung (BGBl. 2021 I S.
  4742) hob Warmwasser- und Wärmezähler von fünf auf sechs Jahre, ohne Übergangsregel, und was vorher galt,
  ist nicht an der Quelle gelesen. Das Formular schlägt deshalb erst ab dem ersten vollen Jahr ein Eichjahr
  vor.
```

- [ ] **Step 3: Volle Prüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run: `MIETFUCHS_RELEASE=1 npm --prefix server test -- test/law-release.test.ts`
Expected: PASS (kein Parameter dieses Plans ist `unchecked`).

Run (Smoke-Test gegen eine laufende Instanz mit Wegwerf-Ordner, `CI=1` und geschlossenem Update-Port):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Das Skript endet mit Exit-Status 0.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle grün (die Kette mit den beiden neuen Schritten läuft über eine Datenbank der letzten
Version).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Eichfrist der Zähler

Refs #98"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| `calibrated_until` als Jahreszahl, Ende mit Ablauf des Jahres (3.12, § 34 Abs. 2) | 2, 3 |
| Nicht für HKV, Prüfbedingung `type <> 'hkv'` (3.12, 5.3, Z-B10) | 2, 4 |
| Übergangsrecht MessEV 2021 vorher lesen (3.12, R-A27, 13 PR 21) | Rechtsquellen oben; Abweichungen 1–3 |
| `messev.calibration-years`, Anlage 7 Nr. 5.5.1, 5.5.2, 7.1, `eventDate` (4.3) | 1 |
| `meter.calibration-overdue` warning, Werte trotzdem verwendet (3.12, 10.1, #91) | 3 |
| § 35 Stichprobe als Hinweis (3.12, 13 PR 21) | 3 (Hinweistext), 4 (Feldtext), 1 (Lexikon) |
| BGH VIII ZR 112/10, Beweislast, Übertragung auf Wärmezähler im Hinweis (3.12, 14.1) | 1, 3 |
| Regel `meter-calibration`, Begriff `meterCalibration` (10.2, 10.3) | 1 |
| Wer nichts einstellt, merkt nichts (1.2) | Global Constraints; Task 3 Test ohne Eichjahr |

**2. Platzhalter.** Keine. Zwei Stellen hängen an Namen von PR 4, die der Plan nennt (`raw`, Liste der
Zählercodes in `notices.ts`); beide sagen, was zu tun ist, wenn der Name anders lautet oder es die Liste
nicht gibt.

**3. Typen.** `calibratedUntil` ist `number | null` in `Meter`, `MeterBody` und `SnapshotMeter`, `string` nur in
`MeterForm`; `calibrationOverdue(calibratedUntil, readings, period)` und `readingsUsedFor(readings, period)`
werden in Task 3 mit denselben Typen benutzt; `calibrationSuggestion(type, markedYear)` in Task 4.

**4. Review Focus.** 1 → Task 3 „Review Focus 1“; 2 → Task 3 „Review Focus 2“; 3 → Task 3 „Review Focus 3“;
4 → Task 2 „Review Focus 4“; 5 → Task 4 „Review Focus 5“.
