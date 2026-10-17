// Zählereinheiten, Durchsicht von #342: Bestände, die vor #342 richtig rechneten, ändern sich nicht. Die Fälle F1 bis
// F8 und W aus der Durchsicht (heizung-notizen/einheiten-342-review.md), erwartet wie auf 65e82dc (vor #342) gemessen,
// außer wo eine Behebung gewollt ist (α bei einem Speicherzähler in MWh, gemischt bekannte Einheiten).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
import { selfMeter, selfMeters, selfReading, selfReadings, selfSnapshot, selfTenancy, selfUnit } from '../testing/selfHeating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingEstimate, HeatingPlant, Meter, Reading } from '../../shared/types.ts'

type Settlement = ReturnType<typeof computeSettlement>
const P = 'objekt-1'
const manual = { method: 'manual' } as Partial<HeatingPlant>

function shares(s: Settlement): Record<string, number> {
  const out: Record<string, number> = {}
  for (const st of s.statements) for (const r of st.rows) out[`${st.tenancyId}:${r.costItemId}`] = r.shareCents
  return out
}
const codes = (s: Settlement, level?: string) => s.notices.filter((n) => level === undefined || n.level === level).map((n) => n.code).sort()
const unitCodes = (s: Settlement) => s.notices.map((n) => n.code).filter((c) => c.startsWith('meter.unit'))
const setUnit = (ids: string[], unit: string): Meter[] => selfMeters().map((m) => (ids.includes(m.id) ? { ...m, unit } : m))
const rescaled = (ids: string[], unit: string, f: number, meters = selfMeters(), readings = selfReadings()): { meters: Meter[]; readings: Reading[] } => ({
  meters: meters.map((m) => (ids.includes(m.id) ? { ...m, unit } : m)),
  readings: readings.map((r) => (ids.includes(r.meterId) ? { ...r, value: r.value * f } : r)),
})
const heatItem: CostItem = {
  id: 'heiz', propertyId: P, period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Heizung', amountCents: 300000,
  key: 'meter', meterType: 'waerme', heatingPlantId: 'hp', heatingPart: 'fuel',
}
const waterItem: CostItem = { id: 'wasser', propertyId: P, period: periodKey('2025-01'), category: 'Wasserversorgung', description: 'Warmwasser', amountCents: 100000, key: 'meter', meterType: 'warmwasser' }

// Gemessen auf 65e82dc (probe.ts der Durchsicht), Verbrauchsschlüssel Wärme 3.000 €.
const F1_EXPECTED = { 'A:heiz': 90000, 'B:heiz': 120000, 'C1:heiz': 54000, 'C2:heiz': 36000 }
// Gemessen auf 65e82dc, eigene Abrechnung Beispiel A, Gas.
const F2_GAS = { 'A:gas': 176850, 'B:gas': 235800, 'C1:gas': 119644, 'C2:gas': 67706 }
const pick = (s: Record<string, number>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, s[k]]))

test('F1: Verbrauchsschlüssel, alte Vorgabe „m³“ an Wärmezählern neben kWh: verteilt wie vorher, mit Warnung', () => {
  const s = computeSettlement(selfSnapshot({ meters: setUnit(['wz-a', 'wz-b'], 'm³'), costItems: [heatItem], plant: manual }))
  assert.deepEqual(pick(shares(s), Object.keys(F1_EXPECTED)), F1_EXPECTED)
  assert.deepEqual(codes(s, 'error'), [])
  const n = s.notices.find((x) => x.code === 'meter.unit-unknown')
  assert.ok(n, 'Warnung fehlt')
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'wz-a' })
  assert.match(n.text, /„Wärme A“ und „Wärme B“ in m³, „Wärme C“ in kWh/)
})

test('F2: eigene Abrechnung, ein Wärmezähler „m³“: verteilt wie vorher, mit Warnung', () => {
  const s = computeSettlement(selfSnapshot({ meters: setUnit(['wz-a'], 'm³') }))
  assert.deepEqual(pick(shares(s), Object.keys(F2_GAS)), F2_GAS)
  assert.deepEqual(codes(s, 'error'), [])
  assert.deepEqual(unitCodes(s), ['meter.unit-unknown'])
})

test('F3: alle Wärmezähler „m³“: unverändert und ohne Hinweis', () => {
  const s = computeSettlement(selfSnapshot({ meters: setUnit(['wz-a', 'wz-b', 'wz-c'], 'm³') }))
  assert.deepEqual(pick(shares(s), Object.keys(F2_GAS)), F2_GAS)
  assert.deepEqual(unitCodes(s), [])
})

const old = selfMeter('wz-alt', 'a', 'Wärme A alt', 'waerme', { unit: 'm³' })
const oldReadings = [...selfReadings(), selfReading('wz-alt', '2019-12-31', 0), selfReading('wz-alt', '2020-12-31', 900)]

test('F4: ein stillgelegter Zähler in „m³“ zählt nicht für die Einheit (Durchsicht M1b)', () => {
  const s = computeSettlement(selfSnapshot({ meters: [...selfMeters(), old], readings: oldReadings, costItems: [heatItem], plant: manual }))
  assert.deepEqual(pick(shares(s), Object.keys(F1_EXPECTED)), F1_EXPECTED)
  assert.deepEqual(unitCodes(s), [])
  assert.deepEqual(codes(s, 'error'), [])
})

test('F4 und F4b: eigene Abrechnung mit stillgelegtem Zähler: nur der Befund von vorher, kein Einheitenhinweis', () => {
  for (const readings of [oldReadings, selfReadings()]) {
    const s = computeSettlement(selfSnapshot({ meters: [...selfMeters(), old], readings }))
    assert.deepEqual(codes(s, 'error'), ['heating.self-incomplete', 'heating.self-incomplete'])
    assert.deepEqual(unitCodes(s), [])
  }
})

const mwhBlank = () => {
  const r = rescaled(['wz-a', 'wz-b', 'wz-c'], 'MWh', 1 / 1000)
  return { meters: r.meters.map((m) => (m.id === 'wz-c' ? { ...m, unit: '' } : m)), readings: r.readings }
}

test('F6: eigene Abrechnung, MWh und ein Zähler ohne Einheit: wie vorher (Durchsicht M4)', () => {
  const s = computeSettlement(selfSnapshot(mwhBlank()))
  assert.deepEqual(pick(shares(s), Object.keys(F2_GAS)), F2_GAS)
  assert.deepEqual(codes(s, 'error'), [])
  assert.deepEqual(unitCodes(s), [])
})

test('F6b: Verbrauchsschlüssel, MWh und ein Zähler ohne Einheit: wie vorher', () => {
  const s = computeSettlement(selfSnapshot({ ...mwhBlank(), costItems: [heatItem], plant: manual }))
  assert.deepEqual(pick(shares(s), Object.keys(F1_EXPECTED)), F1_EXPECTED)
  assert.deepEqual(unitCodes(s), [])
})

test('F7: Gas über Sonstiges, „m³“ neben „cbm“: dieselbe Einheit (Durchsicht S1)', () => {
  const gasItem: CostItem = { ...waterItem, id: 'gas2', meterType: 'sonstig', description: 'Gas' }
  const gm = [selfMeter('g-a', 'a', 'Gas A', 'sonstig', { unit: 'm³' }), selfMeter('g-b', 'b', 'Gas B', 'sonstig', { unit: 'cbm' }), selfMeter('g-c', 'c', 'Gas C', 'sonstig', { unit: 'm³' })]
  const gr = ([['g-a', 100], ['g-b', 200], ['g-c', 100]] as const).flatMap(([id, b]) => [selfReading(id, '2024-12-31', 0), selfReading(id, '2025-12-31', b)])
  const s = computeSettlement(selfSnapshot({ meters: [...selfMeters(), ...gm], readings: [...selfReadings(), ...gr], costItems: [gasItem], plant: manual }))
  assert.deepEqual(pick(shares(s), ['A:gas2', 'B:gas2', 'C1:gas2', 'C2:gas2']), { 'A:gas2': 25000, 'B:gas2': 50000, 'C1:gas2': 18699, 'C2:gas2': 6301 })
  assert.deepEqual(unitCodes(s), [])
})

// F8 und W: Wohnungen 100/100/30 m², damit die Grenze des § 9a Abs. 2 nicht greift; für C fehlt der Endstand.
const units = [selfUnit('a', 100), selfUnit('b', 100), selfUnit('c', 30)]
const estimate = (part: 'heat' | 'water', value: number): HeatingEstimate[] => [{
  plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part, value, method: 'buildingAverage', reason: 'defekt', confirmed: true, cause: 'deviceFailure',
  capture: 'heatMeter', valueUnit: part === 'heat' ? 'kWh' : 'm³',
}]

test('F8: alle Wärmezähler in MWh, Schätzung in derselben Zahl: Beträge wie vorher (Durchsicht M2)', () => {
  const m = rescaled(['wz-a', 'wz-b', 'wz-c'], 'MWh', 1 / 1000)
  const readings = m.readings.filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
  const s = computeSettlement(selfSnapshot({ units, meters: m.meters, readings, estimates: estimate('heat', 5) }))
  assert.deepEqual(pick(shares(s), ['A:gas', 'B:gas', 'C1:gas', 'C2:gas']), { 'A:gas': 209795, 'B:gas': 253639, 'C1:gas': 104826, 'C2:gas': 31740 })
  assert.deepEqual(unitCodes(s), [])
  assert.equal(s.notices.some((n) => n.code === 'heating.estimate-base-unit'), false)
})

test('W: alle Warmwasserzähler in Litern, Schätzung in Litern: Beträge wie vorher (Durchsicht M2)', () => {
  const w = rescaled(['xw-a', 'xw-b', 'xw-c'], 'l', 1000)
  const readings = w.readings.filter((r) => !(r.meterId === 'xw-c' && r.date === '2025-12-31'))
  const s = computeSettlement(selfSnapshot({ units, meters: w.meters, readings, estimates: estimate('water', 20000) }))
  assert.deepEqual(pick(shares(s), ['A:gas', 'B:gas', 'C1:gas', 'C2:gas', 'A:wwz', 'C2:wwz']), { 'A:gas': 202080, 'B:gas': 243354, 'C1:gas': 100844, 'C2:gas': 53722, 'A:wwz': 1897, 'C2:wwz': 246 })
  const pot = s.heating?.[0]?.self?.pots.find((p) => p.pot === 'water')
  assert.equal(pot?.consumptionUnit, 'l')
})

test('Gemischt bekannte Einheiten mit Schätzung: umgerechnet, und ein Hinweis sagt, in welcher Einheit die Schätzung gilt (E2)', () => {
  const m = rescaled(['wz-b'], 'MWh', 1 / 1000)
  const readings = m.readings.filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
  const s = computeSettlement(selfSnapshot({ units, meters: m.meters, readings, estimates: estimate('heat', 5000) }))
  const kwh = computeSettlement(selfSnapshot({ units, readings: selfReadings().filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31')), estimates: estimate('heat', 5000) }))
  assert.deepEqual(shares(s), shares(kwh))
  const n = s.notices.find((x) => x.code === 'heating.estimate-base-unit')
  assert.ok(n, 'Hinweis fehlt')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /in kWh/)
  assert.match(n.text, /„Wärme B“ in MWh/)
  assert.match(n.text, /C/)
  assert.equal(s.heating?.[0]?.self?.pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'kWh')
})

test('α: ein Speicherzähler einheitlich in MWh ergibt denselben Warmwasseranteil wie in kWh (Behebung, S5)', () => {
  const kwh = computeSettlement(selfSnapshot())
  const s = computeSettlement(selfSnapshot(rescaled(['ww'], 'MWh', 1 / 1000)))
  const alpha = (x: Settlement) => x.heating?.[0]?.self?.alpha?.percent
  assert.equal(alpha(s), alpha(kwh))
  // Vor #342 waren es 0,015 % und A trug 1.799,97 € statt 1.768,50 € Gas.
  assert.equal(shares(s)['A:gas'], 176850)
})

// ---------- S4: Überschneidung und Zerlegung des Vermieteranteils ----------

test('S4: Überschneidung zweier Mietverhältnisse, Wohnung mit Zählern in m³ und Litern, wie alle in m³', () => {
  const extra = selfMeter('xw-a2', 'a', 'Warmwasser A Küche', 'warmwasser')
  const extraReadings = [selfReading('xw-a2', '2024-12-31', 0), selfReading('xw-a2', '2025-06-30', 2), selfReading('xw-a2', '2025-12-31', 20)]
  const tenancies = [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('A2', 'a', '2025-07-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', null)]
  const base = { tenancies, costItems: [waterItem], plant: manual }
  const m3 = computeSettlement(selfSnapshot({ ...base, meters: [...selfMeters(), extra], readings: [...selfReadings(), ...extraReadings] }))
  const l = rescaled(['xw-a2'], 'l', 1000, [...selfMeters(), extra], [...selfReadings(), ...extraReadings])
  const s = computeSettlement(selfSnapshot({ ...base, ...l }))
  const overlap = (x: Settlement) => x.notices.find((n) => n.code === 'tenancy.overlap')?.text
  assert.ok(overlap(m3), 'Überschneidung fehlt')
  assert.match(overlap(m3) ?? '', /\d/)
  assert.equal(overlap(s), overlap(m3))
  assert.deepEqual(shares(s), shares(m3))
})

test('S4: Zähler einer Wohnung außerhalb in Litern: Zerlegung des Vermieteranteils wie alle in m³', () => {
  const outsideUnits = [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60, { participates: false })]
  // B zieht zum 30.06. aus: Neben dem Teil der Wohnung außerhalb steht Leerstand, sonst nähme der Rest jeden Fehler auf.
  const tenancies = [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', '2025-06-30')]
  const base = { units: outsideUnits, tenancies, costItems: [waterItem], plant: manual }
  const m3 = computeSettlement(selfSnapshot(base))
  const s = computeSettlement(selfSnapshot({ ...base, ...rescaled(['xw-c'], 'l', 1000) }))
  assert.deepEqual(s.landlord, m3.landlord)
  const reasons = m3.landlord.rows.find((r) => r.costItemId === 'wasser')?.landlordParts?.map((x) => x.reason).sort()
  assert.deepEqual(reasons, ['outsideUnit', 'vacancy'])
})

// ---------- S4: Abweichung einer abgeschlossenen Abrechnung ----------

// Salden auf 65e82dc (probe3.ts): alle Wärmezähler einheitlich in MWh bzw. nur wz-b in MWh.
const FROZEN_UNIFORM = [['A', -179428], ['B', -239236], ['C1', -121812], ['C2', -68658]] as const
const FROZEN_MIXED = [['A', -251331], ['B', -95426], ['C1', -164956], ['C2', -97421]] as const
const frozen = (rows: readonly (readonly [string, number])[]) => ({ statements: rows.map(([tenancyId, balanceCents]) => ({ tenancyId, balanceCents })) })

test('S4: abgeschlossen mit einheitlichen Einheiten: keine Abweichung', () => {
  const now = computeSettlement(selfSnapshot(rescaled(['wz-a', 'wz-b', 'wz-c'], 'MWh', 1 / 1000)))
  const c = compareWithFrozen(frozen(FROZEN_UNIFORM), now, '2026-12-31', '2026-10-17')
  assert.equal(c.comparable, true)
  assert.deepEqual(c.deviations, [])
})

test('S4: abgeschlossen mit gemischt bekannten Einheiten: die Abweichung wird angezeigt', () => {
  const now = computeSettlement(selfSnapshot(rescaled(['wz-b'], 'MWh', 1 / 1000)))
  const c = compareWithFrozen(frozen(FROZEN_MIXED), now, '2026-12-31', '2026-10-17')
  assert.deepEqual(c.deviations.map((d) => [d.tenancyId, d.differenceCents]), FROZEN_MIXED.map(([id, b]) => [id, FROZEN_UNIFORM.find((x) => x[0] === id)?.[1] as number - b]))
  assert.equal(c.deviations.find((d) => d.tenancyId === 'B')?.direction, 'landlord')
})
