// Das Rechtsregister (Heizung PR 1, Entwurf 4.2 und 4.7): Abfrage nach Zeitregel, Protokoll der
// benutzten Werte, Vollständigkeit der Fassungen und je Parameter die Stichtage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLawLog, dayAfter, dayBefore, germanDate, law, LAW_AS_OF, onlyVersion, recordVersionAt, valueAt, versionAt, type LawParam } from '../../shared/law/register.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import * as rulesModule from '../../shared/law/rules.ts'
import { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths } from '../../shared/law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
import { practiceVacancyPersons } from '../../shared/law/practice.ts'
import { ustgStandardRate } from '../../shared/law/ustg.ts'
import { co2ApplicableFrom, co2CutMissing, co2FirstPeriodStart, co2RoundingDecimals, co2StageTable } from '../../shared/law/co2kostaufg.ts'
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
  const modules = { betrkvTvSignal, bgbDeadlineMonths, bgbMaxPeriodMonths, co2ApplicableFrom, co2CutMissing, co2RoundingDecimals, co2StageTable, hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit, practiceVacancyPersons, ustgStandardRate }
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
