// Bezugszähler und verteilter Rest (#98): die reine Planung des Rests, ohne Geld. Was sie entscheidet: ob sich der
// Rest bilden lässt, ob die Gruppe ganz gemessen ist, und welche Mengen wohin gehen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planMeterRest, selfRestShare, type RestInput, type RestPlan } from '../src/meterRest.ts'
import { makeRng } from '../testing/taxStock.ts'
import type { MeterRestTarget } from '../../shared/types.ts'

// Zwei Wohnungen hinter dem Hauptzähler, beide gemessen und bewohnt.
const measured = (over: Partial<RestInput> = {}): RestInput => ({
  reference: 1100,
  behind: [
    { unitId: 'a', inGroup: true, inBasis: true, value: 400 },
    { unitId: 'b', inGroup: true, inBasis: true, value: 600 },
  ],
  subs: [],
  group: [{ unitId: 'a', measured: true, occupied: true }, { unitId: 'b', measured: true, occupied: true }],
  unmeteredOutside: [],
  key: 'area',
  ...over,
})
// Gewerbe mit Zähler, zwei Wohnungen ohne: Die Gruppe sind die Wohnungen.
const unmeasured = (over: Partial<RestInput> = {}): RestInput => ({
  reference: 1000,
  behind: [{ unitId: 'g', inGroup: false, inBasis: true, value: 200 }],
  subs: [],
  group: [{ unitId: 'w1', measured: false, occupied: true }, { unitId: 'w2', measured: false, occupied: true }],
  unmeteredOutside: [],
  key: 'area',
  ...over,
})
const planOf = (p: RestPlan) => (p.kind === 'plan' ? p : assert.fail(`kein Plan, sondern ${JSON.stringify(p)}`))
const errorOf = (p: RestPlan) => (p.kind === 'error' ? p : assert.fail(`kein Fehler, sondern ${JSON.stringify(p)}`))
const fallbackOf = (p: RestPlan) => (p.kind === 'fallback' ? p : assert.fail(`kein Rückfall, sondern ${JSON.stringify(p)}`))

test('Messdifferenz: Rest ist Bezug minus Zähler', () => {
  const p = planOf(planMeterRest(measured()))
  assert.equal(p.total, 1100)
  assert.equal(p.measuredIn, 1000)
  assert.equal(p.outside, 0)
  assert.equal(p.rest, 100)
})

test('Gewerbe: Rest ist der Verbrauch der ungemessenen Gruppe', () => {
  const p = planOf(planMeterRest(unmeasured()))
  assert.equal(p.measuredIn, 200)
  assert.equal(p.rest, 800)
})

test('gemischte Gruppe: rest-mixed mit den ungemessenen Einheiten', () => {
  const e = errorOf(planMeterRest(measured({ group: [{ unitId: 'a', measured: true, occupied: true }, { unitId: 'b', measured: false, occupied: true }] })))
  assert.equal(e.code, 'meter.rest-mixed')
  assert.equal(e.reason, 'mixed')
  assert.deepEqual(e.detail, ['b'])
})

test('eine leere Einheit ohne Zähler macht die Gruppe nicht gemischt', () => {
  const p = planOf(planMeterRest(measured({ group: [{ unitId: 'a', measured: true, occupied: true }, { unitId: 'b', measured: false, occupied: false }] })))
  assert.equal(p.rest, 100)
})

test('ungemessen bewohnt außerhalb der Gruppe: rest-mixed mit eigenem Grund', () => {
  const e = errorOf(planMeterRest(unmeasured({ unmeteredOutside: ['x'] })))
  assert.equal(e.code, 'meter.rest-mixed')
  assert.equal(e.reason, 'outside')
  assert.deepEqual(e.detail, ['x'])
})

test("key 'meter' bei ungemessener Gruppe: rest-mixed", () => {
  const e = errorOf(planMeterRest(unmeasured({ key: 'meter' })))
  assert.equal(e.code, 'meter.rest-mixed')
  assert.equal(e.reason, 'meter-key')
})

test('Bezug deckt den Zeitraum nicht: ungemessen rest-unavailable, gemessen Rückfall', () => {
  const e = errorOf(planMeterRest(unmeasured({ reference: null })))
  assert.equal(e.code, 'meter.rest-unavailable')
  assert.equal(e.reason, 'main-partial')
  const f = fallbackOf(planMeterRest(measured({ reference: null })))
  assert.equal(f.reason, 'main-partial')
  // Rückfall: nach den Zählern, ohne Rest.
  assert.equal(f.total, 1000)
  assert.equal(f.rest, 0)
})

test('Rest unter 0: ungemessen rest-unavailable, gemessen Rückfall', () => {
  const e = errorOf(planMeterRest(unmeasured({ reference: 150 })))
  assert.equal(e.code, 'meter.rest-unavailable')
  assert.equal(e.reason, 'negative')
  const f = fallbackOf(planMeterRest(measured({ reference: 900 })))
  assert.equal(f.reason, 'negative')
  assert.equal(f.total, 1000)
})

test('Rückfall rechnet die Zwischenzähler mit: Sie gehen weiter an ihr Ziel', () => {
  const f = fallbackOf(planMeterRest(measured({ reference: 1000, subs: [{ meterId: 'garten', value: 200, target: 'landlord' }] })))
  assert.equal(f.total, 1200)
  assert.equal(f.subs[0]?.value, 200)
})

test('Rechenrauschen unter 0 ist 0, kein Rückfall', () => {
  const p = planOf(planMeterRest(measured({ reference: 1000 - 1e-12 })))
  assert.equal(p.rest, 0)
})

test('Zwischenzähler ohne ganzen Zeitraum: sub-incomplete', () => {
  const e = errorOf(planMeterRest(measured({ subs: [{ meterId: 'garten', value: null, target: 'landlord' }] })))
  assert.equal(e.code, 'meter.sub-incomplete')
  assert.deepEqual(e.detail, ['garten'])
})

test('excluded mindert total, die anderen Ziele nicht', () => {
  const p = planOf(planMeterRest(measured({
    reference: 1200,
    subs: [{ meterId: 'garten', value: 200, target: 'excluded' }],
  })))
  assert.equal(p.total, 1000)
  assert.equal(p.rest, 0)
  const q = planOf(planMeterRest(measured({ reference: 1200, subs: [{ meterId: 'bau', value: 150, target: 'landlord' }] })))
  assert.equal(q.total, 1200)
  assert.equal(q.rest, 50)
})

test("Vermieter trägt den Rest ('landlord', 'selfUse'): keine Prüfung der Gruppe", () => {
  const p = planOf(planMeterRest({ ...unmeasured({ key: 'selfUse' }), group: [{ unitId: 'g', measured: true, occupied: true }, { unitId: 'e', measured: false, occupied: true }] }))
  assert.equal(p.rest, 800)
  // Ohne verwendbaren Bezug lässt sich der Rest nicht bilden; mit ungemessener Einheit ist das kein Rückfall.
  assert.equal(errorOf(planMeterRest({ ...unmeasured({ key: 'landlord', reference: null }) })).code, 'meter.rest-unavailable')
})

test('Summenregel: gemessen + außerhalb + Rest + Zwischenzähler (ohne excluded) = total, für zufällige Eingaben', () => {
  const rnd = makeRng(98)
  const targets: MeterRestTarget[] = ['landlord', 'selfUse', 'excluded', { key: 'area', unitIds: ['a'] }, { key: 'direct', unitIds: ['b'] }]
  let plans = 0
  for (let i = 0; i < 500; i++) {
    const behind = Array.from({ length: Math.floor(rnd() * 5) }, (_, k) => ({
      unitId: rnd() < 0.1 ? null : `u${k}`, inGroup: rnd() < 0.5, inBasis: rnd() < 0.7, value: Math.round(rnd() * 50000) / 100,
    }))
    const subs = Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => ({
      meterId: `s${k}`, value: Math.round(rnd() * 20000) / 100, target: targets[Math.floor(rnd() * targets.length)] ?? 'landlord',
    }))
    const allMeasured = rnd() < 0.5
    const input: RestInput = {
      reference: rnd() < 0.1 ? null : Math.round(rnd() * 300000) / 100,
      behind,
      subs,
      group: [{ unitId: 'a', measured: allMeasured, occupied: true }, { unitId: 'b', measured: allMeasured, occupied: rnd() < 0.8 }],
      unmeteredOutside: [],
      key: (['area', 'persons', 'units', 'landlord', 'selfUse'] as const)[Math.floor(rnd() * 5)] ?? 'area',
    }
    const p = planMeterRest(input)
    if (p.kind === 'error') continue
    const counted = p.subs.filter((s) => s.target !== 'excluded').reduce((a, s) => a + s.value, 0)
    assert.ok(Math.abs(p.measuredIn + p.outside + p.rest + counted - p.total) < 1e-6, `Fall ${i}: ${JSON.stringify(p)}`)
    assert.ok(p.rest >= 0, `Fall ${i}: Rest negativ`)
    if (p.kind === 'plan') plans++
  }
  assert.ok(plans > 50, `nur ${plans} Pläne`)
})

// Fix-Runde 1: Wann der Rest Eigenanteil ist, genau wie beim Rest des Hauptzählers (#116).
test('Rest des Hauptzählers nach #116 (asMainMeterRest): Rückfall auch mit Einheiten ohne Zähler, Rauschen bleibt', () => {
  // Wie consumptionFor ihn fragt: Gewerbe gemessen, die Wohnungen ohne Zähler, Ziel Eigenanteil.
  const main = (over: Partial<RestInput> = {}) => unmeasured({ key: 'selfUse', asMainMeterRest: true, ...over })
  assert.equal(errorOf(planMeterRest(unmeasured({ key: 'selfUse', reference: null }))).code, 'meter.rest-unavailable')
  const short = fallbackOf(planMeterRest(main({ reference: null })))
  assert.equal(short.reason, 'main-partial')
  assert.equal(short.total, 200)
  assert.equal(fallbackOf(planMeterRest(main({ reference: 150 }))).reason, 'negative')
  // Was #116 genau vergleicht, vergleicht auch der Plan genau: 0,1 + 0,2 liegt über 0,3.
  const noise = main({ reference: 0.3, behind: [{ unitId: 'g', inGroup: false, inBasis: true, value: 0.1 }, { unitId: 'h', inGroup: false, inBasis: true, value: 0.2 }] })
  assert.equal(fallbackOf(planMeterRest(noise)).reason, 'negative')
  const above = planOf(planMeterRest(main({ reference: 0.3 + 1e-12, behind: [{ unitId: 'g', inGroup: false, inBasis: true, value: 0.3 }] })))
  assert.equal(above.rest, 0.3 + 1e-12 - 0.3)
  assert.equal(planOf(planMeterRest(main())).rest, 800)
})

test('selfRestShare: Eigenanteil nur, wenn alle Einheiten ohne Zähler selbstgenutzt sind und kein Zähler eine Lücke hat', () => {
  const self = { unitId: 'e', selfUsed: true, wholeSelf: true }
  const rented = { unitId: 'w', selfUsed: false, wholeSelf: false }
  const phased = { unitId: 'e', selfUsed: true, wholeSelf: false }
  // `notice`: welcher Satz von `meter.unit-without-meter` gilt, genau wie bei #116 (keiner, wenn nur ganz
  // selbstgenutzte Einheiten keinen Zähler haben; den Tagessatz nur, wenn ein Eigenanteil nach Tagen entsteht).
  assert.deepEqual(selfRestShare({ unmeasured: [self], partial: 0, daysAllSelf: 365, days: 365 }), { share: 1, reason: 'whole', notice: null })
  assert.deepEqual(selfRestShare({ unmeasured: [self, rented], partial: 0, daysAllSelf: 0, days: 365 }), { share: 0, reason: 'rented', notice: 'landlord' })
  assert.deepEqual(selfRestShare({ unmeasured: [self], partial: 1, daysAllSelf: 365, days: 365 }), { share: 0, reason: 'partial', notice: null })
  // Lücke und vermietete Einheit ohne Zähler: beide Hinweise wie bei #116.
  assert.deepEqual(selfRestShare({ unmeasured: [self, rented], partial: 1, daysAllSelf: 0, days: 365 }), { share: 0, reason: 'partial', notice: 'landlord' })
  assert.deepEqual(selfRestShare({ unmeasured: [phased], partial: 1, daysAllSelf: 73, days: 365 }), { share: 0, reason: 'partial', notice: 'landlord' })
  assert.deepEqual(selfRestShare({ unmeasured: [], partial: 0, daysAllSelf: 365, days: 365 }), { share: 0, reason: 'none-unmetered', notice: null })
  // Nutzungswechsel: je Tag, an dem alle Einheiten ohne Zähler selbstgenutzt sind (#259, `daysAllSelf`).
  assert.deepEqual(selfRestShare({ unmeasured: [phased], partial: 0, daysAllSelf: 73, days: 365 }), { share: 0.2, reason: 'days', notice: 'days' })
  // Kein gemeinsamer Tag: kein Eigenanteil, und der Satz ist der für den Vermieter.
  assert.deepEqual(selfRestShare({ unmeasured: [phased, { unitId: 'f', selfUsed: true, wholeSelf: false }], partial: 0, daysAllSelf: 0, days: 365 }), { share: 0, reason: 'days', notice: 'landlord' })
})
