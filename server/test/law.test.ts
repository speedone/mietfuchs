// Das Rechtsregister (Heizung PR 1, Entwurf 4.2 und 4.7): Abfrage nach Zeitregel, Protokoll der
// benutzten Werte, Vollständigkeit der Fassungen und je Parameter die Stichtage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coversDate, createLawLog, dayAfter, dayBefore, daysIn, eventPeriodEnd, germanDate, law, LAW_AS_OF, lawOverridable, onlyVersion, recordVersionAt, shiftMonths, valueAt, versionAt, versionsIn, yearStart, type LawParam } from '../../shared/law/register.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import * as rulesModule from '../../shared/law/rules.ts'
import { betrkvGenerationPower, betrkvTvSignal, bgbDeadlineMonths, bgbDeadlineOnWorkday, bgbHeatDeliverySwitch, bgbMaxPeriodMonths, bgbRentDueSaturday, bgbRentDueWorkday } from '../../shared/law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvGenerationPower, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo } from '../../shared/law/heizkostenv.ts'
import { practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons } from '../../shared/law/practice.ts'
import { ustgGasHeatNetworkRate, ustgStandardRate } from '../../shared/law/ustg.ts'
import { co2ApplicableFrom, co2CostsBefore, co2EbevFactors, co2Price, co2PriceEts, co2CostsCountedFrom, co2CostsExcludedUntil, co2CutMissing, co2DistrictEtsNew, co2FirstPeriodStart, co2NonResidential, co2Restriction, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { RULES, rulesFor } from '../../shared/law/rules.ts'
import { CALIBRATED_METER_TYPES, messevCalibrationYears } from '../../shared/law/messev.ts'
import { co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings, co2HalfSplitTwoFamily, co2SelfSupply, halfSplitBioFirstDay, halfSplitEnactedOn, halfSplitFirstDay } from '../../shared/law/co2kostaufg.ts'
import { bioCapFrom, gmodgHeating43 } from '../../shared/law/gmodg.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { holidayNewYear, holidayGoodFriday, holidayEasterMonday, holidayLabourDay, holidayAscension, holidayWhitMonday, holidayChristmas, holidayBoxingDay, holidayEpiphany, holidayWomensDay, holidayEasterSunday, holidayWhitSunday, holidayLiberationDay, holidayCorpusChristi, holidayUprising1953, holidayAugsburgPeace, holidayAssumption, holidayChildrensDay, holidayUnityDay, holidayReformation, holidayAllSaints, holidayRepentance, HOLIDAY_PARAMS } from '../../shared/law/feiertagsgesetze.ts'

const year = (y: number) => ({ period: { from: `${y}-01-01`, to: `${y}-12-31` } })

// Zwei erfundene Parameter für die Abfrage selbst, damit ihre Regeln nicht an einem echten Wert
// hängen, der sich bei einer Durchsicht ändern darf.
const source = { rank: 'law', cite: '§ 1 Beispielgesetz', url: 'https://example.org/1', retrieved: '2026-10-05', checked: 'checked' } as const
const rate: LawParam<number, 'periodStart'> = {
  id: 'test.rate', title: 'Satz', norm: '§ 1', timing: 'periodStart',
  versions: [
    { validTo: '2022-12-31', value: 10, source, enacted: 'a' },
    { validFrom: '2023-01-01', value: 12, source, enacted: 'b' },
  ],
  describe: (v) => `${v} %`,
}
const event: LawParam<number, 'eventDate'> = {
  id: 'test.event', title: 'Satz am Tag', norm: '§ 3', timing: 'eventDate',
  versions: [
    { validTo: '2020-06-30', value: 19, source, enacted: 'a' },
    { validFrom: '2020-07-01', validTo: '2020-12-31', value: 16, source, enacted: 'b' },
    { validFrom: '2021-01-01', value: 19, source, enacted: 'c' },
  ],
  describe: (v) => `${v} %`,
}
const window: LawParam<{ readonly note: string }, 'overlap'> = {
  id: 'test.window', title: 'Fenster', norm: '§ 2', timing: 'overlap',
  versions: [{ validFrom: '2024-03-01', validTo: '2024-06-30', value: { note: 'x' }, source, enacted: 'a' }],
  describe: (v) => v.note,
}

test('Register: periodStart nimmt die Fassung am Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(rate, year(2022), log), 10)
  assert.equal(law(rate, year(2023), log), 12)
  // Ein Zeitraum über die Grenze: es gilt der Beginn.
  assert.equal(law(rate, { period: { from: '2022-07-01', to: '2023-06-30' } }, log), 10)
})

test('Register: eventDate nimmt die Fassung am Tag des Ereignisses', () => {
  assert.equal(law(event, { date: '2020-06-30' }, createLawLog()), 19)
  assert.equal(law(event, { date: '2020-07-01' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2020-12-31' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2021-01-01' }, createLawLog()), 19)
})

test('Register: overlap sagt voll, teilweise oder gar nicht, und nennt auch bei „gar nicht“ die Grenzen', () => {
  const log = createLawLog()
  assert.deepEqual(law(window, { period: { from: '2024-04-01', to: '2024-05-31' } }, log),
    { coverage: 'full', value: { note: 'x' }, validFrom: '2024-03-01', validTo: '2024-06-30' })
  assert.equal(law(window, year(2024), log).coverage, 'partial')
  const after = law(window, year(2025), log)
  assert.equal(after.coverage, 'none')
  assert.equal(after.validTo, '2024-06-30')
  assert.equal(law(window, year(2023), log).coverage, 'none')
})

test('Register: das Protokoll führt jede benutzte Fassung einmal, mit Wert in Worten und Fundstelle', () => {
  const log = createLawLog()
  law(rate, year(2023), log)
  law(rate, year(2024), log)
  assert.deepEqual(log.values, [{ id: 'test.rate', title: 'Satz', norm: '§ 1', cite: '§ 1 Beispielgesetz', value: 12, text: '12 %', validFrom: '2023-01-01' }])
  // Ein „gar nicht“ ist kein angewandter Wert: Er gilt im Zeitraum nicht und steht deshalb nicht
  // im Protokoll (Durchsicht von #221, I1). Erst eine Abfrage, die die Fassung berührt, trägt ein.
  law(window, year(2025), log)
  assert.deepEqual(log.values.map((v) => v.id), ['test.rate'])
  law(window, year(2024), log)
  assert.deepEqual(log.values.map((v) => `${v.id} ${v.validFrom ?? ''}`), ['test.rate 2023-01-01', 'test.window 2024-03-01'])
})

test('Register: recordVersionAt trägt eine Fassung ein, die eine Stelle trotz „gar nicht“ für ihren Text braucht', () => {
  const log = createLawLog()
  const after = law(window, year(2025), log)
  assert.equal(after.coverage, 'none')
  assert.deepEqual(log.values, [])
  recordVersionAt(window, after.validTo ?? '', log)
  recordVersionAt(window, after.validTo ?? '', log)
  assert.deepEqual(log.values, [{ id: 'test.window', title: 'Fenster', norm: '§ 2', cite: '§ 1 Beispielgesetz', value: { note: 'x' }, text: 'x', validFrom: '2024-03-01', validTo: '2024-06-30' }])
})

test('Register: zwei Protokolle sind getrennt, es gibt keinen gemeinsamen Zustand', () => {
  const a = createLawLog()
  const b = createLawLog()
  law(rate, year(2023), a)
  assert.equal(a.values.length, 1)
  assert.equal(b.values.length, 0)
})

test('Register: ohne Fassung am Tag ist es ein Programmfehler, keine stille Antwort', () => {
  assert.throws(() => versionAt(window, '2025-01-01'), /Kein Rechtswert „test\.window“ am 2025-01-01/)
  assert.throws(() => valueAt(window, '2024-02-29'), /Kein Rechtswert/)
})

test('Register: Datumshelfer', () => {
  assert.equal(germanDate('2024-07-01'), '01.07.2024')
  assert.equal(dayAfter('2024-06-30'), '2024-07-01')
  assert.equal(dayAfter('2024-02-28'), '2024-02-29')
  assert.equal(dayBefore('2027-01-01'), '2026-12-31')
})

test('Register: onlyVersion verlangt genau eine Fassung', () => {
  assert.equal(onlyVersion(window).validTo, '2024-06-30')
  assert.throws(() => onlyVersion(rate), /nicht genau eine Fassung/)
})

// ---------- Vollständigkeit (4.7) ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/

test('Register: jede Fassung hat Fundstelle, Adresse, Abrufdatum und Prüfstand', () => {
  for (const p of LAW_PARAMS) {
    assert.ok(p.id && p.title && p.norm, p.id)
    assert.ok(p.versions.length > 0, `${p.id} ohne Fassung`)
    for (const v of p.versions) {
      assert.ok(v.source.cite.trim(), `${p.id}: cite`)
      assert.match(v.source.url, /^https:\/\//, `${p.id}: url`)
      assert.match(v.source.retrieved, ISO, `${p.id}: retrieved`)
      assert.ok(v.enacted.trim(), `${p.id}: enacted`)
      assert.ok(typeof p.describe(v.value) === 'string' && p.describe(v.value).trim(), `${p.id}: describe`)
    }
  }
})

test('Register: die Fassungen eines Parameters sind aufsteigend, lückenlos und überlappen nicht', () => {
  for (const p of LAW_PARAMS) {
    for (const v of p.versions) {
      if (v.validFrom !== undefined) assert.match(v.validFrom, ISO, p.id)
      if (v.validTo !== undefined) assert.match(v.validTo, ISO, p.id)
      if (v.validFrom !== undefined && v.validTo !== undefined) assert.ok(v.validFrom <= v.validTo, `${p.id}: ${v.validFrom} nach ${v.validTo}`)
    }
    for (let i = 1; i < p.versions.length; i++) {
      const before = p.versions[i - 1]
      const next = p.versions[i]
      if (!before?.validTo || !next?.validFrom) assert.fail(`${p.id}: Fassung ${i} hat keine Grenze zur vorigen`)
      assert.equal(next.validFrom, dayAfter(before.validTo), `${p.id}: Lücke oder Überschneidung vor Fassung ${i}`)
    }
  }
})

test('Register: null nur bei einem überschreibbaren Parameter, jede Kennung einmal', () => {
  for (const p of LAW_PARAMS) {
    if (!p.overridable) for (const v of p.versions) assert.notEqual(v.value, null, `${p.id}: null ohne overridable`)
  }
  assert.equal(new Set(LAW_PARAMS.map((p) => p.id)).size, LAW_PARAMS.length)
})

test('Register: LAW_AS_OF ist das jüngste Abrufdatum', () => {
  const newest = LAW_PARAMS.flatMap((p) => p.versions.map((v) => v.source.retrieved)).sort().at(-1)
  assert.equal(LAW_AS_OF, newest)
})

// Durchsicht von #221 (M4): Es gibt nur ein Stichtagsdatum. Ein zweites im Regelverzeichnis hätte
// neben LAW_AS_OF stehen bleiben und veralten können, ohne dass eine Abrechnung es zeigt.
test('Register: das Regelverzeichnis führt kein eigenes Stichtagsdatum', () => {
  assert.ok(!Object.hasOwn(rulesModule, 'RULES_AS_OF'), 'RULES_AS_OF gibt es noch; es gilt LAW_AS_OF')
})

test('Register: jede Konstante vom Typ LawParam in shared/law/ steht in LAW_PARAMS', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../shared/law')
  const declared = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^export const (\w+): LawParam</gm)].map((m) => m[1]))
  assert.ok(declared.length >= 7, `nur ${declared.length} Parameter gefunden`)
  const listed = new Set<unknown>(LAW_PARAMS)
  const modules = { betrkvGenerationPower, betrkvTvSignal, bgbDeadlineMonths, bgbHeatDeliverySwitch, bgbMaxPeriodMonths, co2ApplicableFrom, co2CostsBefore, co2CutMissing, co2DistrictEtsNew, co2EbevFactors, co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings, co2HalfSplitTwoFamily, co2NonResidential, co2Price, co2SelfSupply, co2PriceEts, co2Restriction, co2RoundingDecimals, co2StageTable, gmodgHeating43, hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvGenerationPower, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo, practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons, ustgGasHeatNetworkRate, ustgStandardRate, messevCalibrationYears, holidayNewYear, holidayGoodFriday, holidayEasterMonday, holidayLabourDay, holidayAscension, holidayWhitMonday, holidayChristmas, holidayBoxingDay, holidayEpiphany, holidayWomensDay, holidayEasterSunday, holidayWhitSunday, holidayLiberationDay, holidayCorpusChristi, holidayUprising1953, holidayAugsburgPeace, holidayAssumption, holidayChildrensDay, holidayUnityDay, holidayReformation, holidayAllSaints, holidayRepentance, bgbRentDueWorkday, bgbRentDueSaturday, bgbDeadlineOnWorkday }
  for (const name of declared) {
    assert.ok(name && Object.hasOwn(modules, name), `${name} fehlt in diesem Test`)
    assert.ok(listed.has(Reflect.get(modules, name)), `${name} fehlt in LAW_PARAMS`)
  }
})

// ---------- Stichtage je Parameter (4.7) ----------

test('Stichtag betrkv.tv-signal: 2023 voll, 2024 teilweise, ab 2025 nicht mehr; Anlagen ab 01.12.2021 nie', () => {
  const log = createLawLog()
  assert.equal(law(betrkvTvSignal, year(2023), log).coverage, 'full')
  assert.equal(law(betrkvTvSignal, year(2024), log).coverage, 'partial')
  assert.equal(law(betrkvTvSignal, { period: { from: '2024-01-01', to: '2024-06-30' } }, log).coverage, 'full')
  assert.equal(law(betrkvTvSignal, { period: { from: '2024-07-01', to: '2024-12-31' } }, log).coverage, 'none')
  const later = law(betrkvTvSignal, year(2025), log)
  assert.equal(later.coverage, 'none')
  assert.equal(later.validTo, '2024-06-30')
  assert.equal(later.value.newSystemsFrom, '2021-12-01')
})

test('Stichtag hkv.remote-reading.retrofit: Zeitraum 2026-01 nicht, 2027-01 ganz, Mitte 2026 bis Mitte 2027 teilweise', () => {
  const log = createLawLog()
  assert.equal(law(hkvRemoteReadingRetrofit, year(2026), log).coverage, 'none')
  assert.equal(law(hkvRemoteReadingRetrofit, year(2027), log).coverage, 'full')
  assert.equal(law(hkvRemoteReadingRetrofit, { period: { from: '2026-07-01', to: '2027-06-30' } }, log).coverage, 'partial')
  assert.equal(law(hkvRemoteReadingRetrofit, year(2027), log).value.installedUpTo, '2021-12-01')
})

test('Stichtag: die Werte ohne Zeitgrenze gelten 2020 wie 2030', () => {
  for (const y of [2020, 2025, 2030]) {
    const log = createLawLog()
    assert.deepEqual(law(hkvConsumptionShare, year(y), log), { min: 50, max: 70 })
    assert.equal(law(hkvCutNotByConsumption, year(y), log), 15)
    assert.equal(law(hkvCutRemoteReading, year(y), log), 3)
    assert.equal(law(practiceVacancyPersons, year(y), log), 1)
  }
})

test('Stichtag ustg.standard-rate: 16 % nur vom 01.07. bis 31.12.2020', () => {
  assert.equal(law(ustgStandardRate, { date: '2020-06-30' }, createLawLog()), 19)
  assert.equal(law(ustgStandardRate, { date: '2020-12-31' }, createLawLog()), 16)
  assert.equal(valueAt(ustgStandardRate, '2019-12-31'), 19)
  assert.equal(valueAt(ustgStandardRate, '2020-07-01'), 16)
  assert.equal(valueAt(ustgStandardRate, '2021-01-01'), 19)
  assert.equal(valueAt(ustgStandardRate, '2026-10-05'), 19)
  // Vor 2007 galten 16 % (Art. 4 HBeglG 2006); das Register führt keinen Wert davor.
  assert.equal(valueAt(ustgStandardRate, '2007-01-01'), 19)
  assert.throws(() => valueAt(ustgStandardRate, '2006-12-31'), /Kein Rechtswert/)
})

// Durchsicht von #221 (M5): Die Fassung für das zweite Halbjahr 2020 nennt die Norm, wie sie
// zitiert wird, und verweist auf die amtliche Quelle.
test('Fundstelle ustg.standard-rate: § 28 Abs. 1 UStG auf gesetze-im-internet.de', () => {
  const v = versionAt(ustgStandardRate, '2020-08-01')
  assert.equal(v.source.cite, '§ 28 Abs. 1 UStG')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/ustg_1980/__28.html')
})

test('Stichtag hkv.remote-reading.new-devices: Einbau bis 01.12.2021 ohne, ab 02.12.2021 mit Pflicht ab Einbau', () => {
  const log = createLawLog()
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2015-03-01' }, log).required, false)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2021-12-01' }, log).required, false)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2021-12-02' }, log).required, true)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2030-01-01' }, log).installedAfter, '2021-12-01')
  // Jede Fassung steht einmal im Protokoll, auch wenn sie mehrfach abgefragt wurde.
  assert.deepEqual(log.values.map((v) => [v.id, v.validFrom ?? '', v.text]), [
    ['hkv.remote-reading.new-devices', '', 'Einbau bis 01.12.2021: keine Pflicht ab Einbau'],
    ['hkv.remote-reading.new-devices', '2021-12-02', 'Einbau nach dem 01.12.2021: fernablesbar ab Einbau'],
  ])
})

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
  assert.equal(dhw.norm, '§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20')
  // Durchsicht M5 und M1: wer die Wärmemenge nicht messen könnte, und die engere Voraussetzung der Flächenformel.
  assert.match(dhw.summary, /wer die Wärmemenge nur mit unzumutbar hohem Aufwand messen könnte/)
  assert.match(dhw.summary, /weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann/)
  assert.match(dhw.summary, /um 15 % kürzen/)
  assert.equal(dhw.validFrom, undefined)
})

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

test('Regel heating-consumed-fuel: verbrauchte statt gelieferte Brennstoffe, auch beim Vorrat (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR 156/11)', () => {
  const r = RULES.find((x) => x.code === 'heating-consumed-fuel') ?? assert.fail('Regel heating-consumed-fuel fehlt')
  assert.equal(r.norm, '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11')
  assert.match(r.summary, /verbrauchten Brennstoffe/)
  assert.match(r.summary, /Anfangsbestand \+ Lieferungen − Endbestand/)
})

// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 4.3, 8.3) ----------

test('Stichtag: die Zahlenwertgleichungen des § 9 Abs. 2 gelten 2015 wie 2030', () => {
  for (const y of [2015, 2021, 2025, 2030]) {
    const log = createLawLog()
    assert.deepEqual(law(hkvDhwVolumeFormula, year(y), log), { effort: 2.5, coldWaterC: 10 })
    assert.deepEqual(law(hkvDhwAreaFormula, year(y), log), { kwhPerM2: 32 })
  }
})

test('Stichtag hkv.dhw.factors: 0,30 für die monovalente Wärmepumpe erst für Zeiträume ab 01.10.2024 (BGBl. 2023 I Nr. 280, Art. 6 Abs. 2)', () => {
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

test('Stichtag practice.evaporator-window: 400 bis 800 ‰ seit der Hauptablesung, 2015 wie 2030, als Praxis gekennzeichnet', () => {
  for (const y of [2015, 2025, 2030]) assert.deepEqual(law(practiceEvaporatorWindow, year(y), createLawLog()), { min: 400, max: 800 })
  const [v] = practiceEvaporatorWindow.versions
  assert.equal(v?.source.rank, 'practice')
  assert.match(practiceEvaporatorWindow.norm, /keine Rechtsnorm/)
})

// ---------- Werte, die später veröffentlicht werden (Heizung PR 17, Entwurf 4.5) ----------

const preis: LawParam<number | null, 'deliveryYear'> = {
  id: 'test.preis', title: 'Preis', norm: '§ 4', timing: 'deliveryYear',
  versions: [
    { validFrom: '2025-01-01', validTo: '2025-12-31', value: 55, source, enacted: 'a' },
    { validFrom: '2026-01-01', value: null, source, enacted: 'b' },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${v} €/t`),
  overridable: { reason: 'wird später veröffentlicht', max: 1000, unit: '€/t' },
}
const fest: LawParam<number, 'deliveryYear'> = {
  id: 'test.fest', title: 'Fest', norm: '§ 5', timing: 'deliveryYear',
  versions: [{ validFrom: '2023-01-01', validTo: '2030-12-31', value: 3, source, enacted: 'a' }],
  describe: (v) => String(v),
}

test('Register: deliveryYear fragt die Fassung am 1. Januar des Jahres', () => {
  const log = createLawLog()
  assert.equal(law(fest, { year: 2023 }, log), 3)
  assert.equal(law(fest, { year: 2030 }, log), 3)
  assert.throws(() => law(fest, { year: 2031 }, log), /Kein Rechtswert/)
  assert.equal(yearStart(2027), '2027-01-01')
})

test('Register: ein überschreibbarer Wert geht nur über lawOverridable (Abweichung 1)', () => {
  assert.throws(() => law(preis as unknown as LawParam<number, 'deliveryYear'>, { year: 2025 }, createLawLog()), /lawOverridable/)
  assert.throws(() => lawOverridable(fest as unknown as LawParam<number | null, 'deliveryYear'>, { year: 2025 }, createLawLog()), /nicht überschreibbar/)
})

test('Register: veröffentlicht gilt; null ohne Eintrag wird nicht protokolliert; ein Eintrag gilt je Jahr und wird gekennzeichnet', () => {
  const ohne = createLawLog()
  assert.equal(lawOverridable(preis, { year: 2025 }, ohne), 55)
  assert.equal(lawOverridable(preis, { year: 2027 }, ohne), null)
  assert.deepEqual(ohne.values.map((v) => v.validFrom), ['2025-01-01'])
  const eintrag = { paramId: 'test.preis', validFrom: '2027-01-01', value: 64.2, source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' }
  const mit = createLawLog([eintrag])
  assert.equal(lawOverridable(preis, { year: 2027 }, mit), 64.2)
  assert.equal(lawOverridable(preis, { year: 2027 }, mit), 64.2)
  assert.equal(lawOverridable(preis, { year: 2028 }, mit), null, 'ein Eintrag gilt nur für sein Jahr')
  assert.deepEqual(mit.values, [{
    id: 'test.preis', title: 'Preis', norm: '§ 4', cite: 'UBA, Bekanntmachung vom 15.12.2026', value: 64.2, text: '64.2 €/t',
    validFrom: '2027-01-01', validTo: '2027-12-31', overridden: { source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' },
  }])
  // Ein Eintrag für ein Jahr mit veröffentlichtem Wert ist überholt und gilt nicht (4.5).
  assert.equal(lawOverridable(preis, { year: 2025 }, createLawLog([{ ...eintrag, validFrom: '2025-01-01', value: 99 }])), 55)
})

test('Register: eventDate mit Eintrag nach dem Jahr des Datums', () => {
  const ets: LawParam<number | null, 'eventDate'> = {
    id: 'test.ets', title: 'ETS', norm: '§ 3', timing: 'eventDate', overridable: { reason: 'r', max: 1000, unit: '€/t' },
    versions: [{ validFrom: '2026-01-01', validTo: '2026-12-31', value: 73.86, source, enacted: 'a' }, { validFrom: '2027-01-01', value: null, source, enacted: 'b' }],
    describe: (v) => String(v),
  }
  const log = createLawLog([{ paramId: 'test.ets', validFrom: '2027-01-01', value: 70, source: 'UBA', enteredAt: '2027-04-01' }])
  assert.equal(lawOverridable(ets, { date: '2026-02-10' }, log), 73.86)
  assert.equal(lawOverridable(ets, { date: '2027-02-10' }, log), 70)
})

test('Register: coversDate sagt, ob es am Tag eine Fassung gibt', () => {
  assert.equal(coversDate(fest, '2022-12-31'), false)
  assert.equal(coversDate(fest, '2023-01-01'), true)
  assert.equal(coversDate(preis, '2031-06-01'), true)
})

// ---------- Preise und Standardwerte für die Plausibilität (Heizung PR 17, #97) ----------

test('Stichtag co2.price: 2021 25, 2022 30, 2023 30, 2024 45, 2025 55, 2026 60 (Mittelwert des Korridors), 2027 offen (§ 4 Abs. 1 CO2KostAufG, § 10 Abs. 2 BEHG)', () => {
  const log = createLawLog()
  assert.deepEqual([2021, 2022, 2023, 2024, 2025, 2026, 2027, 2030].map((y) => lawOverridable(co2Price, { year: y }, log)), [25, 30, 30, 45, 55, 60, null, null])
  // Geliefert 2022, in Rechnung gestellt 2023: Die CO₂-Kosten zählen (§ 11 Abs. 2 Satz 2 knüpft an die
  // Rechnung an), mit dem Preis zum Zeitpunkt der Lieferung (§ 3 Abs. 3). Vor 2021 gab es keinen Preis.
  assert.equal(coversDate(co2Price, '2022-12-31'), true)
  assert.equal(coversDate(co2Price, '2020-12-31'), false)
  assert.equal(co2Price.describe(55), '55,00 €/t')
  assert.equal(co2Price.describe(null), 'noch nicht veröffentlicht')
  assert.match(versionAt(co2Price, '2026-06-01').source.cite, /§ 4 Abs\. 1 Nr\. 2 CO2KostAufG/)
})

test('Stichtag co2.price-ets: nach Rechnungsjahr der Durchschnitt des Vorjahres (§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3; DEHSt)', () => {
  const log = createLawLog()
  assert.deepEqual(['2023-03-01', '2024-03-01', '2025-03-01', '2026-03-01', '2027-03-01'].map((d) => lawOverridable(co2PriceEts, { date: d }, log)), [80.4, 83.68, 65.01, 73.86, null])
  assert.equal(coversDate(co2PriceEts, '2022-06-30'), false)
})

test('Stichtag co2.ebev-factors: EBeV 2030 Anlage 2 Teil 4 nur 2023 bis 2030; daraus die bekannten Faktoren', () => {
  const f = law(co2EbevFactors, { year: 2025 }, createLawLog())
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} statt ${b}`)
  near(f.gas.tPerGj * 3.6, 0.20088)
  near(f.gas.tPerGj * f.gas.hsGjPerMwh, 0.18139)
  near(f.oil.tPerGj * 3.6, 0.2664)
  near(f.oil.tPerM3 * f.oil.gjPerT * f.oil.tPerGj, 2.6763)
  near(f.lpg.tPerGj * 3.6, 0.2358)
  near(f.lpg.gjPerT * f.lpg.tPerGj, 3.013)
  assert.equal(coversDate(co2EbevFactors, '2022-12-31'), false)
  assert.equal(coversDate(co2EbevFactors, '2031-01-01'), false)
})

test('Stichtag ustg.gas-heat-network-rate: 7 % vom 01.10.2022 bis 31.03.2024 (§ 28 Abs. 5, 6 UStG)', () => {
  assert.equal(law(ustgGasHeatNetworkRate, { date: '2022-10-01' }, createLawLog()), 7)
  assert.equal(law(ustgGasHeatNetworkRate, { date: '2024-03-31' }, createLawLog()), 7)
  assert.equal(coversDate(ustgGasHeatNetworkRate, '2022-09-30'), false)
  assert.equal(coversDate(ustgGasHeatNetworkRate, '2024-04-01'), false)
})

// ---------- Durchsicht Runde 1 (#246) ----------

test('R-W3: der Rechtsstand nennt die EBeV-Werte mit allen Stellen, samt Umrechnungsfaktoren', () => {
  const text = co2EbevFactors.describe(valueAt(co2EbevFactors, '2025-01-01'))
  for (const w of ['0,0558', '0,0655', '0,074', '3,2508', '0,845', '42,8', '46']) assert.ok(text.includes(w), `${w} fehlt in „${text}“`)
  assert.ok(!text.includes('0,056 '), text)
})

test('R-W4, G-K4: überschreibbare Werte nennen ihr Jahr richtig und haben eine Obergrenze', () => {
  assert.equal(co2Price.overridable?.yearLabel?.(2027) ?? '2027', '2027')
  assert.equal(co2PriceEts.overridable?.yearLabel?.(2027), 'für Rechnungen aus 2027 (Durchschnitt der Versteigerungen 2026)')
  assert.equal(co2Price.overridable?.max, 1000)
  assert.equal(co2PriceEts.overridable?.max, 1000)
  assert.match(co2PriceEts.overridable?.reason ?? '', /Durchschnittspreis eines Jahres .*bis zum 31\. März des Folgejahres.*Rechnungen aus dem Folgejahr/)
})

// Folge-PR zu #252 (#253, F4): Der zur Wärmeerzeugung verbrauchte Strom steht seit dem 01.01.2024 in § 2 Nr. 4 Buchst. a
// BetrKV und seit dem 01.10.2024 in § 7 Abs. 2 HeizkostenV (Art. 4, Art. 3 Nr. 1 und Art. 6 G v. 16.10.2023).
test('Stichtag strom zur Wärmeerzeugung: BetrKV ab 2024, HeizkostenV ab 01.10.2024', () => {
  const log = createLawLog()
  assert.equal(law(betrkvGenerationPower, year(2023), log).coverage, 'none')
  assert.equal(law(betrkvGenerationPower, year(2024), log).coverage, 'full')
  assert.equal(law(hkvGenerationPower, year(2024), log).coverage, 'partial')
  assert.equal(law(hkvGenerationPower, { period: { from: '2024-01-01', to: '2024-09-30' } }, log).coverage, 'none')
  assert.equal(law(hkvGenerationPower, year(2025), log).coverage, 'full')
})

// Recht H-5 (Nachprüfung fc20455): Fundstellen des Gesetzes vom 16.10.2023 mit Jahr, und die BetrKV mit ihrem Wortlaut
// „Kosten des Betriebs der zentralen Heizungsanlage“.
test('Register: BGBl. 2023 I Nr. 280 mit Jahr; BetrKV-Beschreibung nach dem Wortlaut', () => {
  for (const p of LAW_PARAMS) for (const v of p.versions) {
    if (v.enacted.includes('Nr. 280')) assert.match(v.enacted, /BGBl\. 2023 I Nr\. 280/, `${p.id}: ${v.enacted}`)
  }
  assert.match(betrkvGenerationPower.describe({ since: '2024-01-01' }), /zu den Kosten des Betriebs der zentralen Heizungsanlage$/)
})

// Heizung PR 16 (#213): Umstellung auf Wärmelieferung. Die erste Fassung beginnt mit dem Inkrafttreten der
// Wärmelieferverordnung (§ 13 WärmeLV); für eine Umstellung davor gibt es keine.
test('Stichtag bgb.heat-delivery-switch: ab 01.07.2013 drei Monate und 80 %, davor keine Fassung (§ 556c BGB, § 11, § 13 WärmeLV)', () => {
  const log = createLawLog()
  assert.deepEqual(law(bgbHeatDeliverySwitch, { date: '2013-07-01' }, log), { noticeMonths: 3, efficiencyPercent: 80 })
  assert.deepEqual(law(bgbHeatDeliverySwitch, { date: '2025-10-01' }, log), { noticeMonths: 3, efficiencyPercent: 80 })
  assert.throws(() => valueAt(bgbHeatDeliverySwitch, '2013-06-30'), /Kein Rechtswert/)
  assert.equal(log.values.length, 1)
  assert.equal(bgbHeatDeliverySwitch.describe({ noticeMonths: 3, efficiencyPercent: 80 }), 'Ankündigung spätestens 3 Monate vor der Umstellung; ab 80 % Jahresnutzungsgrad genügt eine verbesserte Betriebsführung')
  const v = versionAt(bgbHeatDeliverySwitch, '2020-01-01')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/bgb/__556c.html')
  assert.match(v.source.cite, /§ 11 Abs\. 1/)
  assert.equal(v.source.checked, 'checked')
})

// ---------- MessEV (Heizung PR 21, #98) ----------

test('Stichtag messev.calibration-years: ab 01.01.2015 Kaltwasser 6, Warmwasser und Wärme 5; ab 03.11.2021 je 6; davor keine Fassung', () => {
  const log = createLawLog()
  assert.deepEqual(law(messevCalibrationYears, { date: '2021-11-03' }, log), { kaltwasser: 6, warmwasser: 6, waerme: 6 })
  assert.deepEqual(law(messevCalibrationYears, { date: '2028-06-30' }, log), { kaltwasser: 6, warmwasser: 6, waerme: 6 })
  assert.equal(log.values.length, 1, 'dieselbe Fassung zweimal abgefragt ist ein Eintrag')
  assert.equal(log.values[0]?.text, 'Kaltwasser-, Warmwasser- und Wärmezähler je 6 Jahre')
  assert.deepEqual(law(messevCalibrationYears, { date: '2021-11-02' }, createLawLog()), { kaltwasser: 6, warmwasser: 5, waerme: 5 })
  assert.deepEqual(law(messevCalibrationYears, { date: '2015-01-01' }, createLawLog()), { kaltwasser: 6, warmwasser: 5, waerme: 5 })
  assert.equal(messevCalibrationYears.describe({ kaltwasser: 6, warmwasser: 5, waerme: 5 }), 'Kaltwasserzähler 6, Warmwasserzähler 5, Wärmezähler 5 Jahre')
  // Vor der MessEV (Eichordnung) führt das Register keine Fassung.
  assert.throws(() => law(messevCalibrationYears, { date: '2014-12-31' }, createLawLog()), /Kein Rechtswert „messev.calibration-years“ am 2014-12-31/)
})

test('messev.calibration-years: Fundstellen am Wortlaut, die frühere Fassung amtlich aus der Begründung der Änderungsverordnung', () => {
  const neu = versionAt(messevCalibrationYears, '2022-01-01')
  assert.equal(neu.validFrom, '2021-11-03')
  assert.equal(neu.source.checked, 'checked')
  assert.equal(neu.source.retrieved, '2026-10-12')
  assert.match(neu.source.cite, /Anlage 7 Nr\. 5\.5\.1, 5\.5\.2, 7\.1 MessEV/)
  assert.match(neu.enacted, /BGBl\. I S\. 4742/)
  const alt = versionAt(messevCalibrationYears, '2018-01-01')
  assert.deepEqual([alt.validFrom, alt.validTo], ['2015-01-01', '2021-11-02'])
  assert.equal(alt.source.checked, 'checked')
  assert.match(alt.source.cite, /BR-Drs\. 599\/21/)
  assert.match(alt.source.url, /0599-21\.pdf$/)
  assert.match(alt.enacted, /BGBl\. I S\. 2010/)
  assert.deepEqual([...CALIBRATED_METER_TYPES], ['kaltwasser', 'warmwasser', 'waerme'])
})

test('Regel meter-calibration: nennt Frist aus dem Register, MessEG, § 35 MessEV und das Urteil; steht nicht im Rechtsstand einer Abrechnung', () => {
  const rule = RULES.find((r) => r.code === 'meter-calibration') ?? assert.fail('Regel fehlt')
  assert.match(rule.norm, /§ 31 Abs\. 2 Nr\. 3, § 33 Abs\. 1, § 37 Abs\. 1 MessEG; § 34, § 35, Anlage 7 MessEV; BGH, Urteil vom 17\.11\.2010, VIII ZR 112\/10/)
  assert.match(rule.summary, /je 6 Jahre/)
  assert.match(rule.summary, /mit dem Ende des Jahres/)
  assert.match(rule.summary, /Heizkostenverteiler sind nicht eichpflichtig/)
  assert.match(rule.summary, /Vermutung ihrer Richtigkeit nicht zu/)
  assert.equal(rule.validFrom, undefined)
  // Angewendet wird sie auf der Zähler-Seite, nicht in der Abrechnung (Prüfung des Plans, S13).
  assert.equal(rule.scope, 'meters')
  for (const y of [2015, 2022, 2026]) assert.ok(!rulesFor(`${y}-01-01`, `${y}-12-31`).some((r) => r.code === 'meter-calibration'), String(y))
})

// ---------- Zeitregel incurred (Heizung PR 18, Entwurf 3.13, 4.2) ----------

const teilung: LawParam<number, 'incurred'> = {
  id: 'test.teilung', title: 'Teilung', norm: '§ 5a', timing: 'incurred',
  versions: [
    { validTo: '2027-12-31', value: 0, source, enacted: 'a' },
    { validFrom: '2028-01-01', value: 500, source, enacted: 'b' },
  ],
  describe: (v) => `${v} ‰`,
}
const nachTagen = (r: { from: string; to: string }): number => daysIn(r)

test('Register: incurred teilt den Zeitraum an den Fassungen und gewichtet je Teil (01.05.2027–30.04.2028)', () => {
  const log = createLawLog()
  const teile = law(teilung, { period: { from: '2027-05-01', to: '2028-04-30' }, weights: nachTagen }, log)
  assert.deepEqual(teile.map((t) => [t.from, t.to, t.value]), [['2027-05-01', '2027-12-31', 0], ['2028-01-01', '2028-04-30', 500]])
  // 245 und 121 Tage von 366 (2028 ist ein Schaltjahr).
  assert.ok(Math.abs((teile[0]?.weight ?? 0) - 245 / 366) < 1e-12)
  assert.ok(Math.abs((teile[1]?.weight ?? 0) - 121 / 366) < 1e-12)
  assert.deepEqual(log.values.map((v) => v.validFrom ?? ''), ['', '2028-01-01'])
})

test('Register: incurred in einer einzigen Fassung ist ein Teil mit Gewicht 1', () => {
  const teile = law(teilung, { period: { from: '2028-01-01', to: '2028-12-31' }, weights: nachTagen }, createLawLog())
  assert.deepEqual(teile, [{ from: '2028-01-01', to: '2028-12-31', value: 500, weight: 1 }])
})

test('Register: incurred protokolliert keine Fassung ohne Gewicht; ohne jedes Gewicht gelten die Tage', () => {
  const log = createLawLog()
  const teile = law(teilung, { period: { from: '2027-05-01', to: '2028-04-30' }, weights: (r) => (r.from >= '2028-01-01' ? 1 : 0) }, log)
  assert.deepEqual(teile.map((t) => t.weight), [0, 1])
  assert.deepEqual(log.values.map((v) => v.validFrom), ['2028-01-01'])
  const ohne = law(teilung, { period: { from: '2027-05-01', to: '2028-04-30' }, weights: () => 0 }, createLawLog())
  assert.ok(Math.abs((ohne[1]?.weight ?? 0) - 121 / 366) < 1e-12)
})

test('Register: incurred ohne Fassung am Anfang oder Ende ist ein Programmfehler', () => {
  const spaet: LawParam<number, 'incurred'> = { ...teilung, id: 'test.spaet', versions: [{ validFrom: '2028-01-01', value: 500, source, enacted: 'b' }] }
  assert.throws(() => law(spaet, { period: { from: '2027-05-01', to: '2028-04-30' }, weights: nachTagen }, createLawLog()), /Kein Rechtswert/)
})

test('Register: versionsIn schneidet die Fassungen auf einen Bereich zu und protokolliert nichts', () => {
  assert.deepEqual(versionsIn(teilung, { from: '2027-10-15', to: '2028-10-14' }), [
    { from: '2027-10-15', to: '2027-12-31', value: 0 },
    { from: '2028-01-01', to: '2028-10-14', value: 500 },
  ])
  assert.deepEqual(versionsIn(teilung, { from: '2026-01-01', to: '2026-12-31' }), [{ from: '2026-01-01', to: '2026-12-31', value: 0 }])
})

test('Fristende ab einem Ereignis nach §§ 187 Abs. 1, 188 Abs. 2, 3 BGB', () => {
  assert.equal(eventPeriodEnd('2027-06-15', 12), '2028-06-15')
  assert.equal(eventPeriodEnd('2027-01-31', 1), '2027-02-28')
  assert.equal(eventPeriodEnd('2028-02-29', 12), '2029-02-28')
  assert.equal(shiftMonths('2028-01-01', -12), '2027-01-01')
  assert.equal(shiftMonths('2028-03-31', -1), '2028-02-29')
  assert.equal(daysIn({ from: '2028-01-01', to: '2028-04-30' }), 121)
})

// ---------- §§ 5a, 5b, 5d CO2KostAufG und § 43 GModG (Heizung PR 18, #215) ----------

test('Stichtag co2.half-split (Entwurf 4.7): H 2027-05 → 530 ‰ der Gradtage hälftig, Vermieter 271,80 € (3.9)', () => {
  const log = createLawLog()
  const h = { from: '2027-05-01', to: '2028-04-30' }
  const table = law(hkvDegreeDays, { period: h }, log)
  const teile = law(co2HalfSplit, { period: h, weights: (r) => degreeDayPermille([r], table) }, log)
  assert.deepEqual(teile.map((t) => [t.from, t.to, t.value.co2Permille]), [['2027-05-01', '2027-12-31', null], ['2028-01-01', '2028-04-30', 500]])
  const nach = teile[1]?.weight ?? assert.fail('kein Teil ab 2028')
  assert.ok(Math.abs(nach - 0.53) < 1e-9, `Gradtage ab 01.01.2028: ${nach}`)
  // 0,47 · 600 € · 40 % + 0,53 · 600 € · 50 % = 271,80 €
  const vermieter = (1 - nach) * 60000 * 0.4 + nach * 60000 * ((teile[1]?.value.co2Permille ?? 0) / 1000)
  assert.equal(Math.round(vermieter), 27180)
})

test('Stichtag co2.half-split: Netzentgelte und CO₂ ab 01.01.2028, Biobrennstoff ab 01.01.2029 bis 30 %', () => {
  assert.deepEqual(valueAt(co2HalfSplit, '2027-12-31'), { gridFeePermille: null, co2Permille: null, bioPermille: null, bioCapPermille: null })
  assert.deepEqual(valueAt(co2HalfSplit, '2028-01-01'), { gridFeePermille: 500, co2Permille: 500, bioPermille: null, bioCapPermille: null })
  assert.deepEqual(valueAt(co2HalfSplit, '2029-01-01'), { gridFeePermille: 500, co2Permille: 500, bioPermille: 500, bioCapPermille: 300 })
  assert.equal(halfSplitFirstDay(), '2028-01-01')
  assert.equal(halfSplitBioFirstDay(), '2029-01-01')
  const v = versionAt(co2HalfSplit, '2028-06-01')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/co2kostaufg/__5a.html')
  // Am 11.10.2026 an der Quelle gelesen (Prüfung M3); LAW_AS_OF bleibt das jüngste Abrufdatum.
  assert.equal(v.source.retrieved, '2026-10-11')
  assert.match(v.enacted, /BGBl\. 2026 I Nr\. 226/)
})

test('§ 5b, § 5a Abs. 4, § 5d Abs. 3 und § 43 GModG im Register', () => {
  const log = createLawLog()
  assert.deepEqual(law(co2HalfSplitNewBuildings, { date: '2029-03-01' }, log), { firstUseUntil: '2029-12-31', applicationFrom: '2026-05-13' })
  assert.deepEqual(law(co2HalfSplitEmergency, { date: '2027-06-15' }, log), { windowMonths: 12, before: '2028-01-01', installedFrom: '2028-01-01', installedTo: '2028-12-31', laterFrom: '2029-01-01' })
  assert.deepEqual(law(co2HalfSplitTwoFamily, { period: { from: '2028-01-01', to: '2028-12-31' } }, log), { maxDwellings: 2 })
  const g = law(gmodgHeating43, { date: '2027-03-01' }, log)
  assert.equal(g.installedAfter, '2026-07-29')
  assert.deepEqual(g.energies, ['gas', 'oil', 'lpg'])
  assert.deepEqual(g.mandatory.map((m) => [m.from, m.permille]), [['2029-01-01', 100], ['2030-01-01', 150], ['2035-01-01', 300], ['2040-01-01', 600]])
  // Ab 2040 übersteigt der Pflichtanteil die Grenze von 30 % (Abweichung 10).
  assert.equal(bioCapFrom(), '2040-01-01')
  // Prüfung S7: die Einzelnorm auf gesetze-im-internet.de, der Regelungstext in der Fundstelle.
  const v = versionAt(gmodgHeating43, '2027-03-01')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/geg/__43.html')
  assert.match(v.source.cite, /BGBl\. 2026 I Nr\. 226/)
  assert.equal(v.source.retrieved, '2026-10-11')
})

test('Stichtag co2.self-supply: ab 2023 zwölf Monate für Anzeige und Erstattung, 5 % bei eigenen Geräten, 50 % im Nichtwohngebäude (Heizung PR 19)', () => {
  const log = createLawLog()
  assert.deepEqual(law(co2SelfSupply, { date: '2025-01-20' }, log), { claimMonths: 12, refundMonths: 12, ownAppliancesCutPercent: 5, nonResidentialPermille: 500 })
  assert.throws(() => valueAt(co2SelfSupply, '2022-12-31'), /Kein Rechtswert/)
  const v = versionAt(co2SelfSupply, '2025-01-20')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/co2kostaufg/__6.html')
  // Am 12.10.2026 im Wortlaut gelesen (Gegenprüfung PR 19); LAW_AS_OF bleibt das jüngste Abrufdatum.
  assert.equal(v.source.retrieved, '2026-10-12')
  assert.match(v.enacted, /BGBl\. 2026 I Nr\. 226/)
  assert.equal(log.values.length, 1)
  assert.equal(halfSplitEnactedOn(), '2026-07-29')
})

// Fristen nach Werktagen und Feiertage der Länder: je Feiertag ein Parameter mit Tag im Jahr, und dieser Tag
// ist in allen Fassungen derselbe; einmalige Feiertage sind Fassungen von genau einem Tag.
test('Feiertage im Register: ein Tag je Parameter, einmalige Feiertage als Fassung eines Tages', () => {
  for (const p of HOLIDAY_PARAMS) {
    const days = new Set(p.versions.map((v) => v.value.day))
    assert.equal(days.size, 1, `${p.id}: mehrere Tage`)
    assert.equal(p.timing, 'eventDate', p.id)
  }
  assert.deepEqual(valueAt(holidayLiberationDay, '2020-05-08').states, ['BE'])
  assert.deepEqual(valueAt(holidayLiberationDay, '2021-05-08').states, [])
  assert.deepEqual(valueAt(holidayLiberationDay, '2025-05-08').states, ['BE'])
  assert.deepEqual(valueAt(holidayUprising1953, '2028-06-17').states, ['BE'])
  assert.deepEqual(valueAt(holidayWomensDay, '2019-03-08').states, ['BE'])
  assert.deepEqual(valueAt(holidayWomensDay, '2023-03-08').states, ['BE', 'MV'])
  assert.equal(valueAt(holidayReformation, '2017-10-31').states.length, 16)
  assert.equal(valueAt(holidayReformation, '2018-10-31').states.includes('NI'), true)
  assert.equal(valueAt(holidayReformation, '2016-10-31').states.includes('NI'), false)
  assert.equal(holidayAssumption.describe(valueAt(holidayAssumption, LAW_AS_OF)), '15.08., gesetzlicher Feiertag in Saarland; Bayern nur in Gemeinden mit mehr katholischen als evangelischen Einwohnern, wie sie das Landesamt für Statistik feststellt')
  assert.equal(holidayRepentance.describe(valueAt(holidayRepentance, LAW_AS_OF)), 'Mittwoch vor dem 23. November, gesetzlicher Feiertag in Sachsen')
  assert.equal(holidayNewYear.describe(valueAt(holidayNewYear, LAW_AS_OF)), '01.01., gesetzlicher Feiertag in allen Ländern')
})

test('Fristen im Register: dritter Werktag, Samstag kein Werktag (BGH VIII ZR 129/09), § 193 BGB', () => {
  assert.equal(valueAt(bgbRentDueWorkday, LAW_AS_OF), 3)
  assert.equal(bgbRentDueWorkday.describe(3), 'spätestens bis zum 3. Werktag des Monats')
  assert.equal(valueAt(bgbRentDueSaturday, LAW_AS_OF), false)
  assert.match(bgbRentDueSaturday.versions[0]?.source.cite ?? '', /VIII ZR 129\/09/)
  assert.equal(bgbDeadlineOnWorkday.describe(valueAt(bgbDeadlineOnWorkday, LAW_AS_OF)), 'fällt das Fristende auf Sonnabend, Sonntag, Feiertag am Erklärungs- oder Leistungsort, tritt der nächste Werktag an seine Stelle')
  for (const p of [bgbRentDueWorkday, bgbRentDueSaturday, bgbDeadlineOnWorkday]) assert.equal(p.versions.every((v) => v.source.checked === 'checked'), true, p.id)
})
