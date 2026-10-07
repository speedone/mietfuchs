// Heizkostenverteiler und Werte eines Ablesedienstes (Heizung PR 12, Entwurf 8.1, 12.2). Jede Zahl ist
// von Hand nachgerechnet; der Kommentar am Test nennt die Rechnung. Die Verteilung über planSelf prüft
// heating.test.ts, die Abrechnung calc-hkv.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  captureOf, coversPeriod, deviceCutoffs, deviceCutoffText, deviceLines, meterFactor, missingRatings, missingRatingsText, mixedCapture, mixedCaptureText,
  ratingOf, serviceMeters, type HcaMeter,
} from '../src/hca.ts'
import { planSelf, type SelfInput, type SelfReading, type SelfUnit } from '../src/heating.ts'
import type { HeatingServiceValue } from '../../shared/types.ts'
import { periodKey } from '../../shared/period.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { onlyVersion } from '../../shared/law/register.ts'

const H = { from: '2025-01-01', to: '2025-12-31' }
const hkv = (id: string, unitId: string, over: Partial<HcaMeter> = {}): HcaMeter =>
  ({ id, unitId, type: 'hkv', name: id, hcaScale: 'unit', ratingFactor: 1, heatingPlantId: null, ...over })
const read = (meterId: string, date: string, value: number, over: Partial<SelfReading> = {}): SelfReading => ({ meterId, date, value, ...over })
const nameOf = (id: string) => `Wohnung ${id.toUpperCase()}`
const unit = (id: string): SelfUnit => ({ id, name: id.toUpperCase(), areaM2: 50, heatedAreaM2: null, role: 'rented' })
// Ein Plan nur für die Heizung, ohne Mieterwechsel; die Geräte mit ihrem Faktor wie in calc.ts.
function planOf(meters: HcaMeter[], readings: SelfReading[], unitIds: string[]) {
  const input: SelfInput = {
    h: H, neighbors: { before: '2023-12-31', after: '2026-12-31' }, changeSplit: 'degreeDays', hotWater: 'none', areaBasisHeat: 'area',
    units: unitIds.map(unit), tenancies: [], gaps: [], table: onlyVersion(hkvDegreeDays).value, offRule: () => onlyVersion(practiceReadingOffWarning).value,
    meters: meters.flatMap((m) => (m.unitId ? [{ id: m.id, name: m.name ?? m.id, unitId: m.unitId, type: m.type, factor: meterFactor(m) }] : [])),
    readings, capture: 'hca',
  }
  return planSelf(input)
}
const rated = (lines: ReturnType<typeof deviceLines>, unitId: string) =>
  Math.round(lines.filter((l) => l.unitId === unitId).reduce((a, l) => a + l.rated, 0) * 1000) / 1000

test('Skala und Faktor: Produktskala zählt wie abgelesen, Einheitsskala mal Faktor; ohne Skala oder Faktor kein Wert', () => {
  assert.deepEqual(ratingOf(hkv('x', 'a', { hcaScale: 'product', ratingFactor: null })), { ok: true, factor: 1, scale: 'product' })
  // Bei der Produktskala bleibt ein eingetragener Faktor ohne Wirkung; er ist im Ablesewert enthalten.
  assert.deepEqual(ratingOf(hkv('x', 'a', { hcaScale: 'product', ratingFactor: 1.4 })), { ok: true, factor: 1, scale: 'product' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { ratingFactor: 1.25 })), { ok: true, factor: 1.25, scale: 'unit' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { ratingFactor: null })), { ok: false, missing: 'factor' })
  assert.deepEqual(ratingOf(hkv('x', 'a', { hcaScale: null })), { ok: false, missing: 'scale' })
  assert.deepEqual([meterFactor(hkv('x', 'a', { ratingFactor: 0.8 })), meterFactor(hkv('x', 'a', { hcaScale: 'product' })), meterFactor(hkv('x', 'a', { ratingFactor: null }))], [0.8, 1, 1])
  assert.equal(meterFactor({ id: 'w', unitId: 'a', type: 'waerme', ratingFactor: 3 }), 1)
})

test('Erfassung je Heizperiode: der Zeitraum der eigenen Abrechnung trägt sie, ohne Angabe gilt die der Anlage', () => {
  const plant = { capture: 'hca' as const, selfSpans: [{ from: '2024-01', until: '2026-01', capture: 'heatMeter' as const }, { from: '2026-01', until: null, capture: 'hca' as const }] }
  assert.deepEqual(['2024-01', '2025-01', '2026-01', '2027-01'].map((k) => captureOf(plant, k)), ['heatMeter', 'heatMeter', 'hca', 'hca'])
  assert.equal(captureOf({ capture: 'heatMeter', selfSpans: [{ from: '2024-01', until: null }] }, '2025-01'), 'heatMeter')
  assert.equal(captureOf({ capture: null }, '2025-01'), 'heatMeter')
})

test('HKV mit Faktoren 0,8 und 1,25 (Entwurf 12.2): 500 · 1,25 + 200 · 0,8 = 785 von 7.850 Einheiten, also ein Zehntel', () => {
  const meters = [hkv('a1', 'a', { ratingFactor: 1.25 }), hkv('a2', 'a', { ratingFactor: 0.8 }), hkv('b1', 'b', { hcaScale: 'product', ratingFactor: null })]
  const readings = [
    read('a1', '2024-12-31', 0), read('a1', '2025-12-31', 500),
    read('a2', '2024-12-31', 0), read('a2', '2025-12-31', 200),
    read('b1', '2024-12-31', 0), read('b1', '2025-12-31', 7065),
  ]
  const plan = planOf(meters, readings, ['a', 'b'])
  const lines = deviceLines('hca', plan, meters)
  assert.deepEqual(lines.map((l) => [l.meterId, l.scale, l.factor, l.raw, Math.round(l.rated * 1000) / 1000]), [
    ['a1', 'unit', 1.25, 500, 625], ['a2', 'unit', 0.8, 200, 160], ['b1', 'product', 1, 7065, 7065],
  ])
  assert.deepEqual([rated(lines, 'a'), rated(lines, 'b')], [785, 7065])
  assert.equal(rated(lines, 'a') / (rated(lines, 'a') + rated(lines, 'b')), 0.1)
  // Der Ausweis zeigt dieselben Einheiten, mit denen verteilt wird.
  assert.equal(plan.units.find((u) => u.unit.id === 'a')?.consumption.heating, 785)
  assert.deepEqual(deviceLines('heatMeter', plan, meters), [])
})

test('Ablesung einige Tage neben dem Stichtag: der Ausweis nennt die Einheiten, mit denen gerechnet wird', () => {
  // Die Endablesung von a1 liegt am 05.01.2026; die Rechnung nimmt sie wie abgelesen (PR 10).
  const meters = [hkv('a1', 'a', { ratingFactor: 1.25 }), hkv('b1', 'b')]
  const readings = [read('a1', '2024-12-31', 0), read('a1', '2026-01-05', 520), read('b1', '2024-12-31', 0), read('b1', '2025-12-31', 100)]
  const plan = planOf(meters, readings, ['a', 'b'])
  assert.deepEqual(plan.problems, [])
  assert.equal(rated(deviceLines('hca', plan, meters), 'a'), 650)
  assert.equal(plan.units.find((u) => u.unit.id === 'a')?.consumption.heating, 650)
})

test('Tausch eines Geräts mit anderem Faktor (Review Focus 1): altes und neues Gerät je mit ihrem Faktor', () => {
  // 300 · 1,25 = 375 bis zum Tausch, danach 250 · 0,8 = 200; zusammen 575. Das alte Gerät endet mit seiner
  // letzten Ablesung, das neue beginnt mit 0; an jeder Grenze braucht jedes Gerät einen Stand, deshalb steht
  // der des alten auch am Ende (er ändert sich nicht mehr) und der des neuen am Beginn (0).
  const meters = [hkv('d-alt', 'd', { ratingFactor: 1.25 }), hkv('d-neu', 'd', { ratingFactor: 0.8 })]
  const readings = [
    read('d-alt', '2024-12-31', 0), read('d-alt', '2025-06-15', 300), read('d-alt', '2025-12-31', 300),
    read('d-neu', '2024-12-31', 0), read('d-neu', '2025-06-15', 0), read('d-neu', '2025-12-31', 250),
  ]
  const plan = planOf(meters, readings, ['d'])
  assert.deepEqual(plan.problems, [])
  assert.equal(rated(deviceLines('hca', plan, meters), 'd'), 575)
})

test('Stichtagswert (Entwurf 8.1): Rücksetzen wie ein Zählerwechsel; mitten in der Heizperiode ein Hinweis, am Beginn oder Ende nicht', () => {
  // Bis 30.06. 420 Einheiten (Stichtagswert), danach 180; zusammen 600.
  const meters = [hkv('c1', 'c', { hcaScale: 'product', ratingFactor: null })]
  const mitte = [read('c1', '2024-12-31', 0), read('c1', '2025-06-30', 0, { replacement: true, oldEndValue: 420 }), read('c1', '2025-12-31', 180)]
  assert.equal(rated(deviceLines('hca', planOf(meters, mitte, ['c']), meters), 'c'), 600)
  const cut = deviceCutoffs('hca', meters, mitte, ['c'], H)
  assert.deepEqual(cut, [{ meterId: 'c1', name: 'c1', unitId: 'c', date: '2025-06-30' }])
  assert.deepEqual(deviceCutoffs('heatMeter', meters, mitte, ['c'], H), [])
  const first = cut[0] ?? assert.fail('kein Stichtag')
  assert.match(deviceCutoffText('Heizung, Heizperiode 2025', first, H, nameOf), /„c1“ \(Wohnung C\) hat am 30\.06\.2025 auf null zurückgesetzt; die Heizperiode beginnt aber am 01\.01\.2025/)
  // Am Tag vor dem Beginn und am letzten Tag: kein Hinweis; in der Heizperiode zählen 650 Einheiten.
  const amRand = [read('c1', '2023-12-31', 0), read('c1', '2024-12-31', 0, { replacement: true, oldEndValue: 900 }), read('c1', '2025-12-31', 0, { replacement: true, oldEndValue: 650 })]
  assert.deepEqual(deviceCutoffs('hca', meters, amRand, ['c'], H), [])
  assert.equal(rated(deviceLines('hca', planOf(meters, amRand, ['c']), meters), 'c'), 650)
})

// Ablesungen, die die Heizperiode 2025 überdecken (Durchsicht von #241, C1).
const cover = (...ids: string[]) => ids.flatMap((id) => [read(id, '2024-12-31', 0), read(id, '2025-12-31', 100)])

test('Gemischte Geräte (§ 5 Abs. 7, Review Focus 4): eine Wohnung nur mit Geräten der anderen Art; Warmwasserzähler und Zähler der Anlage zählen nicht', () => {
  const wz = (id: string, unitId: string): HcaMeter => ({ id, unitId, type: 'waerme', name: id, heatingPlantId: null })
  const ww: HcaMeter = { id: 'ww-a', unitId: 'a', type: 'warmwasser', name: 'ww-a', heatingPlantId: null }
  const anlage: HcaMeter = { id: 'speicher', unitId: null, type: 'waerme', name: 'Speicher', heatingPlantId: 'hp' }
  const all = cover('a1', 'b1', 'wa', 'wb', 'ww-a', 'speicher')
  assert.equal(mixedCapture('hca', ['a', 'b'], [hkv('a1', 'a'), hkv('b1', 'b'), ww, anlage], all, H), null)
  assert.equal(mixedCapture('heatMeter', ['a', 'b'], [wz('wa', 'a'), wz('wb', 'b'), ww, anlage], all, H), null)
  const m = mixedCapture('hca', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')], all, H)
  assert.deepEqual(m, { heatMeterUnits: ['a'], hcaUnits: ['b'] })
  assert.deepEqual(mixedCapture('heatMeter', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')], all, H), { heatMeterUnits: ['a'], hcaUnits: ['b'] })
  // Beide Arten an derselben Wohnung: erfasst wird mit der eingestellten, nichts ist gemischt.
  assert.equal(mixedCapture('heatMeter', ['a', 'b'], [wz('wa', 'a'), hkv('a1', 'a'), wz('wb', 'b')], all, H), null)
  // Ein Gerät an einer Wohnung, die nicht an der Anlage hängt, zählt nicht.
  assert.equal(mixedCapture('hca', ['b'], [wz('wa', 'a'), hkv('b1', 'b')], all, H), null)
  assert.equal(mixedCapture('serviceValues', ['a', 'b'], [wz('wa', 'a'), hkv('b1', 'b')], all, H), null)
  // Ein Gerät, dessen Ablesungen die Heizperiode nicht überdecken (ausgebaut am 31.12.2024 oder ab dem
  // 31.12.2025 neu), zählt nicht.
  const alt = [read('wa', '2023-12-31', 0), read('wa', '2024-12-31', 900), ...cover('b1')]
  assert.equal(mixedCapture('hca', ['a', 'b'], [wz('wa', 'a'), hkv('a1', 'a'), hkv('b1', 'b')], [...alt, ...cover('a1')], H), null)
  assert.equal(coversPeriod('wa', alt, H), false)
  assert.equal(coversPeriod('n', [read('n', '2025-12-31', 0)], H), false)
  assert.equal(coversPeriod('n', [read('n', '2025-12-30', 0), read('n', '2026-02-01', 5)], H), true)
  const t = mixedCaptureText('hca', m ?? assert.fail('nicht gemischt'), nameOf)
  assert.match(t, /^Eingestellt ist die Erfassung mit Heizkostenverteilern, an den Wohnungen hängen aber Wärmezähler bei Wohnung A und Heizkostenverteiler bei Wohnung B/)
  assert.match(t, /§ 5 Abs\. 7 HeizkostenV.*Vorerfassung.*eigenen Wärmezähler.*Messdienst/s)
  assert.match(t, /löschen Sie es nicht/)
  assert.doesNotMatch(t, /Bis dahin/)
})

test('Fehlende Skala oder fehlender Faktor (hca-factor-missing): je Gerät benannt, nur bei Erfassung mit Heizkostenverteilern und nur für Geräte der Heizperiode', () => {
  const meters = [hkv('a1', 'a', { name: 'Wohnzimmer', ratingFactor: null }), hkv('b1', 'b', { name: 'Bad', hcaScale: null }), hkv('b2', 'b', { ratingFactor: 0.9 }), hkv('b3', 'b', { name: 'alt', hcaScale: null })]
  const readings = [...cover('a1', 'b1', 'b2'), read('b3', '2023-12-31', 0), read('b3', '2024-12-31', 10)]
  const list = missingRatings('hca', ['a', 'b'], meters, readings, H)
  assert.deepEqual(list, [
    { meterId: 'a1', name: 'Wohnzimmer', unitId: 'a', missing: 'factor' },
    { meterId: 'b1', name: 'Bad', unitId: 'b', missing: 'scale' },
  ])
  assert.deepEqual(missingRatings('heatMeter', ['a', 'b'], meters, readings, H), [])
  assert.match(missingRatingsText(list, nameOf), /^Bei diesen Heizkostenverteilern fehlt „Wohnzimmer“ \(Wohnung A\): der Bewertungsfaktor und „Bad“ \(Wohnung B\): die Skala.*als neuen Zähler an/s)
})

test('Werte des Ablesedienstes als gedachter Zähler je Wohnung: kumulierte Stände, Lücken bleiben Lücken (Review Focus 2)', () => {
  const p = periodKey('2025-01')
  const rows: HeatingServiceValue[] = [
    { plantId: 'hp', period: p, unitId: 'a', from: '2025-10-15', to: '2025-12-31', heatValue: 100, waterValue: 3, heatUnit: 'units' },
    { plantId: 'hp', period: p, unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: 12, heatUnit: 'units' },
    { plantId: 'hp', period: p, unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800, waterValue: 20, heatUnit: 'units' },
  ]
  const units = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  const heat = serviceMeters(rows, units, 'heat') ?? assert.fail('keine Werte')
  assert.deepEqual(heat.meters.map((m) => [m.id, m.unitId, m.type, m.factor]), [
    ['ablesedienst-heizung:a', 'a', 'waerme', 1], ['ablesedienst-heizung:b', 'b', 'waerme', 1],
  ])
  // A: 0 am 31.12.2024, 340 am 30.09.2025, 440 am 31.12.2025. Am 14.10. (Tag vor der zweiten Zeile)
  // steht kein Stand. C hat keine Zeile und keinen Zähler.
  assert.deepEqual(heat.readings.filter((r) => r.meterId === 'ablesedienst-heizung:a').map((r) => [r.date, r.value]), [
    ['2024-12-31', 0], ['2025-09-30', 340], ['2025-12-31', 440],
  ])
  const water = serviceMeters(rows, units, 'water') ?? assert.fail('kein Warmwasser')
  assert.deepEqual(water.readings.filter((r) => r.meterId === 'ablesedienst-warmwasser:b').map((r) => [r.date, r.value]), [['2024-12-31', 0], ['2025-12-31', 20]])
  assert.equal(serviceMeters(rows.map((r) => ({ ...r, waterValue: null, heatUnit: 'units' })), units, 'water'), null)
})

test('Durchsicht #241 M2: eine Rücksetzung am ersten Tag der Heizperiode ist ein Stichtag daneben; am Tag davor nicht', () => {
  const meters = [hkv('c1', 'c', { hcaScale: 'product', ratingFactor: null })]
  const ersterTag = [read('c1', '2024-12-31', 0), read('c1', '2025-01-01', 0, { replacement: true, oldEndValue: 5 }), read('c1', '2025-12-31', 100)]
  assert.deepEqual(deviceCutoffs('hca', meters, ersterTag, ['c'], H).map((c) => c.date), ['2025-01-01'])
  assert.match(deviceCutoffText('Heizung', { meterId: 'c1', name: 'c1', unitId: 'c', date: '2025-01-01' }, H, nameOf), /am Tag vor dem Beginn der Heizperiode.*31\.12\./)
})

test('Durchsicht #241 Recht-I2: Die Ablesung am Stichtag trägt im Ausweis den Stichtagswert', () => {
  const meters = [hkv('c1', 'c', { hcaScale: 'product', ratingFactor: null })]
  const plan = planOf(meters, [read('c1', '2024-12-31', 0, { replacement: true, oldEndValue: 900 }), read('c1', '2025-12-31', 0, { replacement: true, oldEndValue: 650 })], ['c'])
  const end = plan.units[0]?.readings.find((r) => r.boundary === '2025-12-31')
  assert.deepEqual([end?.value, end?.oldEndValue], [0, 650])
})
