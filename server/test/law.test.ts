// Das Rechtsregister (Heizung PR 1, Entwurf 4.2 und 4.7): Abfrage nach Zeitregel, Protokoll der
// benutzten Werte, Vollständigkeit der Fassungen und je Parameter die Stichtage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coversDate, createLawLog, dayAfter, dayBefore, germanDate, law, LAW_AS_OF, lawOverridable, onlyVersion, recordVersionAt, valueAt, versionAt, yearStart, type LawParam } from '../../shared/law/register.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import * as rulesModule from '../../shared/law/rules.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from '../../shared/law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo } from '../../shared/law/heizkostenv.ts'
import { practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons } from '../../shared/law/practice.ts'
import { ustgGasHeatNetworkRate, ustgStandardRate } from '../../shared/law/ustg.ts'
import { co2ApplicableFrom, co2CostsBefore, co2EbevFactors, co2Price, co2PriceEts, co2CostsCountedFrom, co2CostsExcludedUntil, co2CutMissing, co2DistrictEtsNew, co2FirstPeriodStart, co2NonResidential, co2Restriction, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { RULES } from '../../shared/law/rules.ts'

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
  const modules = { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths, co2ApplicableFrom, co2CostsBefore, co2CutMissing, co2DistrictEtsNew, co2EbevFactors, co2NonResidential, co2Price, co2PriceEts, co2Restriction, co2RoundingDecimals, co2StageTable, hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvExemptions, hkvHeatingValues, hkvHeatPumpCapture, hkvInfoDistrict, hkvMonthlyInfo, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, hkvRenewableExemption, hkvSettlementInfo, practiceEvaporatorWindow, practiceReadingOffWarning, practiceVacancyPersons, ustgGasHeatNetworkRate, ustgStandardRate }
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
