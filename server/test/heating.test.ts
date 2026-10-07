// Die eigene Heizkostenabrechnung als reine Rechnung (Heizung PR 10, Entwurf 3.5, 8.4–8.6, 12.2
// „heating.test.ts“): Beispiel A centgenau, die Gegenproben, Ablesungen neben Stichtag und Wechsel,
// § 9b Abs. 3, keine lineare Interpolation, Leerstand, Eigennutzung, beheizte Fläche.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundaryReadingsOf, consumptionSharesOf, estimateDeviceType, estimateKey, estimateProposals, heatPumpVerdict, hotWaterShareOf, planSelf, readingOff, targetProblem, usersOf, weightsOf, type AlphaInput,
  type SelfInput, type SelfMeter, type SelfPlan, type SelfReading, type SelfTenancy, type SelfUnit,
} from '../src/heating.ts'
import { distributeCents } from '../src/calc.ts'
import { hkvDegreeDays, hkvEstimateThreshold, hkvHeatPumpCapture } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { createLawLog, onlyVersion } from '../../shared/law/register.ts'

const table = onlyVersion(hkvDegreeDays).value
const offRule = onlyVersion(practiceReadingOffWarning).value
const near = (a: number, b: number, what: string, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} statt ${b}`)

// Beispiel A (Entwurf 8.6, 3.5): drei Wohnungen, Wechsel in C zum 30.09.2025, Zwischenablesung am 30.09.
const UNITS: SelfUnit[] = [
  { id: 'a', name: 'A', areaM2: 60, heatedAreaM2: null, role: 'rented' },
  { id: 'b', name: 'B', areaM2: 80, heatedAreaM2: null, role: 'rented' },
  { id: 'c', name: 'C', areaM2: 60, heatedAreaM2: null, role: 'rented' },
]
const TENANCIES: SelfTenancy[] = [
  { id: 'A', unitId: 'a', tenantName: 'Mieter A', start: '2020-01-01', end: null },
  { id: 'B', unitId: 'b', tenantName: 'Mieter B', start: '2020-01-01', end: null },
  { id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-09-30' },
  { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-10-01', end: null },
]
const METERS: SelfMeter[] = [
  { id: 'wa', name: 'Wärme A', unitId: 'a', type: 'waerme' }, { id: 'wb', name: 'Wärme B', unitId: 'b', type: 'waerme' }, { id: 'wc', name: 'Wärme C', unitId: 'c', type: 'waerme' },
  { id: 'xa', name: 'Warmwasser A', unitId: 'a', type: 'warmwasser' }, { id: 'xb', name: 'Warmwasser B', unitId: 'b', type: 'warmwasser' }, { id: 'xc', name: 'Warmwasser C', unitId: 'c', type: 'warmwasser' },
]
const r = (meterId: string, date: string, value: number, extra: Partial<SelfReading> = {}): SelfReading => ({ meterId, date, value, ...extra })
const READINGS: SelfReading[] = [
  r('wa', '2024-12-31', 1000), r('wa', '2025-12-31', 13000),
  r('wb', '2024-12-31', 0), r('wb', '2025-12-31', 16000),
  r('wc', '2024-12-31', 500), r('wc', '2025-09-30', 7700), r('wc', '2025-12-31', 12500),
  r('xa', '2024-12-31', 10), r('xa', '2025-12-31', 40),
  r('xb', '2024-12-31', 0), r('xb', '2025-12-31', 40),
  r('xc', '2024-12-31', 5), r('xc', '2025-09-30', 43), r('xc', '2025-12-31', 55),
]
const input = (over: Partial<SelfInput> = {}): SelfInput => ({
  h: { from: '2025-01-01', to: '2025-12-31' },
  neighbors: { before: '2023-12-31', after: '2026-12-31' },
  changeSplit: 'degreeDays', hotWater: 'combined', areaBasisHeat: 'area',
  units: UNITS, tenancies: TENANCIES, meters: METERS, readings: READINGS, gaps: [], table, offRule: () => offRule, ...over,
})
const without = (date: string, meterIds: string[]) => READINGS.filter((x) => !(x.date === date && meterIds.includes(x.meterId)))
const userOf = (plan: SelfPlan, key: string) => plan.units.flatMap((u) => u.users).find((u) => u.key === key) ?? assert.fail(`kein Nutzer ${key}`)

// Die Positionen aus Beispiel A und ihre Verteilung nach #202, in Cent.
const ITEMS: [string, number, 'both' | 'heating' | 'water'][] = [
  ['Erdgas', 600000, 'both'], ['Betriebsstrom', 18000, 'both'], ['Wartung', 24000, 'both'], ['Immissionsmessung', 6000, 'both'],
  ['Miete Wärmezähler', 12000, 'heating'], ['Miete Warmwasserzähler', 6000, 'water'],
]
function distribute(plan: SelfPlan, alpha: number): Record<string, number> {
  const w = weightsOf(plan, { heating: 70, water: 70 }, alpha)
  const keys = ['A', 'B', 'C1', 'C2']
  const sum: Record<string, number> = { A: 0, B: 0, C1: 0, C2: 0 }
  for (const [, amount, target] of ITEMS) {
    const cents = distributeCents(amount, keys.map((k) => ({ key: k, landlord: false, raw: amount * (w.get(k)?.[target] ?? assert.fail(`kein Gewicht ${k}`)) })))
    keys.forEach((k, i) => { sum[k] = (sum[k] ?? 0) + (cents[i] ?? 0) })
  }
  return sum
}
// Exakt je Nutzer: K_H · g(heating) + K_W · g(water), K_H = 5.628 €, K_W = 1.032 € (α = 15 %).
const exact = (plan: SelfPlan, key: string, alpha: number) => {
  const w = weightsOf(plan, { heating: 70, water: 70 }, alpha).get(key) ?? assert.fail(key)
  return 562800 * w.heating + 103200 * w.water
}

test('Beispiel A: 1.961,89 / 2.615,84 / 1.331,52 / 750,75 €, exakt 1.331,52995 und 750,75005 €', () => {
  const plan = planSelf(input())
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(distribute(plan, 0.15), { A: 196189, B: 261584, C1: 133152, C2: 75075 })
  near(exact(plan, 'C1', 0.15), 133152.995, 'C1 exakt', 1e-4)
  near(exact(plan, 'C2', 0.15), 75075.005, 'C2 exakt', 1e-4)
  near(exact(plan, 'A', 0.15), 196188, 'A exakt', 1e-6)
  // Gewichte summieren sich je Topf zu 1: kein Leerstand, nichts verloren.
  const w = weightsOf(plan, { heating: 70, water: 70 }, 0.15)
  near([...w.values()].reduce((a, x) => a + x.heating, 0), 1, 'Σ heating')
  near([...w.values()].reduce((a, x) => a + x.water, 0), 1, 'Σ water')
  // Gemessen, nicht zurückgerechnet: C1 hat 7.200 kWh und 38 m³, C2 4.800 kWh und 12 m³.
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7200, 4800])
  assert.deepEqual([userOf(plan, 'C1').pots.water.value, userOf(plan, 'C2').pots.water.value], [38, 12])
  near(userOf(plan, 'C1').degreeDayPermille, 640, 'Gradtage Januar bis September')
})

test('Gegenprobe zeitanteilig: Grundkosten Heizung C1 378,85 € statt 324,17 €', () => {
  const zeit = planSelf(input({ changeSplit: 'time' }))
  near(562800 * 0.3 * userOf(zeit, 'C1').pots.heating.base, 37884.92, 'zeitanteilig', 0.01)
  const grad = planSelf(input())
  near(562800 * 0.3 * userOf(grad, 'C1').pots.heating.base, 32417.28, 'nach Gradtagen', 0.01)
  // Warmwasser geht immer nach Tagen (§ 9b Abs. 2).
  near(userOf(grad, 'C1').pots.water.base, userOf(zeit, 'C1').pots.water.base, 'Warmwasser gleich')
})

test('§ 9b Abs. 3: ohne Zwischenablesung trägt C1 1.375,18 € (exakt 1.375,17666 €), und Mietfuchs fragt', () => {
  const plan = planSelf(input({ readings: without('2025-09-30', ['wc', 'xc']) }))
  assert.deepEqual(plan.problems, [])
  near(exact(plan, 'C1', 0.15), 137517.666, 'C1', 1e-3)
  near(exact(plan, 'C2', 0.15), 70710.334, 'C2', 1e-3)
  assert.deepEqual(distribute(plan, 0.15), { A: 196189, B: 261584, C1: 137517, C2: 70710 })
  assert.equal(userOf(plan, 'C1').pots.heating.group, true)
  const f = plan.findings.find((x) => x.kind === 'noInterim') ?? assert.fail('kein Befund')
  assert.deepEqual(f, { kind: 'noInterim', unitId: 'c', unitName: 'C', boundary: '2025-09-30', pots: ['heating', 'water'], status: null, reason: '', tenancyIds: ['C1', 'C2'] })
  const answered = planSelf(input({ readings: without('2025-09-30', ['wc', 'xc']), gaps: [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }] }))
  assert.equal(answered.findings.find((x) => x.kind === 'noInterim')?.kind === 'noInterim' ? (answered.findings.find((x) => x.kind === 'noInterim') as { status: string | null }).status : null, 'impossible')
})

test('Keine lineare Interpolation: eine Ablesung im Juni gilt am Wechsel, wie sie ist, und wird nicht hochgerechnet', () => {
  const juni = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-06-30', 6500), r('xc', '2025-06-30', 30)]
  const plan = planSelf(input({ readings: juni }))
  // Die Ablesung vom 30.06. liegt dem Wechsel am 30.09. näher als dem 31.12.2024; sie gilt, wie sie ist
  // (Entwurf 3.5 Nr. 2), und die Grenze zwischen C1 und C2 liegt am 30.06.
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [6000, 6000])
  // Eine Interpolation bis zum 30.09. hätte 9.000 kWh ergeben; dieser Wert darf nie entstehen.
  assert.notEqual(userOf(plan, 'C1').pots.heating.value, 9000)
  const f = plan.findings.find((x) => x.kind === 'interimOff') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'interimOff')
  // 92 Tage daneben, aber kein Monat von Oktober bis April dazwischen: ein Hinweis, keine Warnung.
  assert.deepEqual([f.readingDate, f.days, f.far], ['2025-06-30', 92, false])
})

test('Z-B3: Ablesung am 03.10. statt am 30.09. gilt, wie sie ist; die Grenze liegt am 03.10., Hinweis mit 3 Tagen', () => {
  const okt = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-03', 7800), r('xc', '2025-10-03', 44)]
  const plan = planSelf(input({ readings: okt }))
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7300, 4700])
  assert.equal(userOf(plan, 'C1').pots.heating.group, false)
  const f = plan.findings.find((x) => x.kind === 'interimOff') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'interimOff')
  assert.deepEqual([f.boundary, f.readingDate, f.days, f.far], ['2025-09-30', '2025-10-03', 3, false])
  near(f.permille, (3 * 80) / 31, 'Gradtage 01.–03.10.')
})

test('Zwei Ablesungen neben dem Wechsel (03.10. und 15.10.): es gilt die nähere', () => {
  const zwei = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-03', 7800), r('wc', '2025-10-15', 8100), r('xc', '2025-10-03', 44), r('xc', '2025-10-15', 45)]
  const plan = planSelf(input({ readings: zwei }))
  assert.equal(userOf(plan, 'C1').pots.heating.value, 7300)
})

test('Z-B1: Stichtag 31.12., Ablesungen am 02.01. und 05.01. gelten wie abgelesen, Hinweis mit 5 Tagen und 27,4 ‰', () => {
  const jan = READINGS.map((x) => (x.meterId === 'wa' && x.date === '2024-12-31' ? { ...x, date: '2025-01-02' } : x.meterId === 'wb' && x.date === '2024-12-31' ? { ...x, date: '2025-01-05' } : x))
  const plan = planSelf(input({ readings: jan }))
  assert.deepEqual(plan.problems, [])
  assert.equal(userOf(plan, 'A').pots.heating.value, 12000)
  const f = plan.findings.find((x) => x.kind === 'datesDiffer') ?? assert.fail('kein Hinweis')
  assert.ok(f.kind === 'datesDiffer')
  assert.deepEqual([f.boundary, f.readingDate, f.days, f.far], ['2024-12-31', '2025-01-05', 5, false])
  assert.equal(f.permille.toFixed(1), '27.4')
})

test('Warngrenze: ein Monat Abweichung mit einem Wintermonat dazwischen', () => {
  const zero = { from: '2025-01-01', to: '2025-12-31' }
  void zero
  assert.equal(readingOff('2024-12-31', '2025-02-10', table, offRule).far, true)
  assert.equal(readingOff('2024-12-31', '2025-01-30', table, offRule).far, false)
  assert.equal(readingOff('2024-12-31', '2025-01-31', table, offRule).far, true, 'genau ein Monat')
  assert.equal(readingOff('2025-06-30', '2025-08-15', table, offRule).far, false, 'Sommer')
  assert.equal(readingOff('2025-09-30', '2025-08-25', table, offRule).far, false, 'vorher, ohne Wintermonat')
  assert.equal(readingOff('2025-09-30', '2025-11-05', table, offRule).far, true, 'Oktober dazwischen')
})

test('Abweichung 9: eine Ablesung aus dem Mieterwechsel gehört fest zu ihrer Grenze, auch wenn eine ungebundene näher liegt', () => {
  const gebunden = [
    ...without('2025-09-30', ['wc', 'xc']),
    r('wc', '2025-09-29', 7650), r('xc', '2025-09-29', 42),
    r('wc', '2025-10-10', 7900, { boundFor: '2025-09-30' }), r('xc', '2025-10-10', 44, { boundFor: '2025-09-30' }),
  ]
  const plan = planSelf(input({ readings: gebunden }))
  assert.deepEqual([userOf(plan, 'C1').pots.heating.value, userOf(plan, 'C2').pots.heating.value], [7400, 4600])
  // Ohne Bindung gilt die Nähe-Regel: der 29.09. liegt näher.
  const frei = planSelf(input({ readings: gebunden.map((x) => ({ ...x, boundFor: null })) }))
  assert.equal(userOf(frei, 'C1').pots.heating.value, 7150)
  // Mitte zwischen zwei Grenzen: zur früheren.
  const at = boundaryReadingsOf([r('m', '2025-02-15', 1)], ['2025-01-31', '2025-03-02'], ['2024-12-31', '2025-01-31', '2025-03-02', '2025-12-31'])
  assert.deepEqual([at.get('2025-01-31')?.date ?? null, at.get('2025-03-02')?.date ?? null], ['2025-02-15', null])
})

test('Abweichung 9: zwei verschiedene Werte eines Zählers am selben Tag sind ein Befund, gleiche Werte nicht (#69)', () => {
  const doppelt = planSelf(input({ readings: [...READINGS, r('wa', '2025-12-31', 13050)] }))
  assert.deepEqual(doppelt.problems.map((p) => (p.kind === 'missing' ? [p.reason, p.boundary, p.meterName] : p.kind)), [['sameDay', '2025-12-31', 'Wärme A']])
  assert.deepEqual(planSelf(input({ readings: [...READINGS, r('wa', '2025-12-31', 13000)] })).problems, [])
})

test('Abweichung 9: Zellen über H−1, H und H+1; der eingefrorene Endstand der Vorperiode ist der Anfangsstand', () => {
  // H = 2024, in H+1 zieht C1 am 31.01.2025 aus; die einzige Ablesung um den Jahreswechsel ist vom 20.01.2025.
  const nurC = (outerChanges?: ReadonlyMap<string, readonly string[]>) => planSelf(input({
    h: { from: '2024-01-01', to: '2024-12-31' }, neighbors: { before: '2022-12-31', after: '2025-12-31' }, hotWater: 'none',
    units: UNITS.filter((u) => u.id === 'c'), meters: METERS.filter((m) => m.id === 'wc'),
    tenancies: [{ id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-01-31' }, { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-02-01', end: null }],
    readings: [r('wc', '2023-12-31', 0), r('wc', '2025-01-20', 600)], ...(outerChanges ? { outerChanges } : {}),
  }))
  // Ohne die Grenzen von H+1 nähme H den 20.01. als Endstand, H+1 aber als Zwischenablesung: doppelt.
  assert.deepEqual(nurC().problems, [])
  assert.deepEqual(nurC(new Map([['c', ['2025-01-31']]])).problems.map((p) => (p.kind === 'missing' ? [p.reason, p.boundary] : p.kind)), [['noReading', '2024-12-31']])
  // Eingefroren: H−1 endete mit 1.000 am 31.12.2024; nachgetragen ist nur ein Stand vom 05.01.2025.
  const nachgetragen = READINGS.map((x) => (x.meterId === 'wa' && x.date === '2024-12-31' ? r('wa', '2025-01-05', 1100) : x))
  assert.equal(userOf(planSelf(input({ readings: nachgetragen })), 'A').pots.heating.value, 11900)
  assert.equal(userOf(planSelf(input({ readings: nachgetragen, opening: new Map([['wa', r('wa', '2024-12-31', 1000)]]) })), 'A').pots.heating.value, 12000)
})

test('Abweichung 22: Zwischenablesung ab der Warngrenze; ohne Wahl nicht verteilbar, sonst Ablesung oder § 9b Abs. 3', () => {
  const nov = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-11-05', 8200), r('xc', '2025-11-05', 46)]
  const ohne = planSelf(input({ readings: nov }))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'farInterim' ? [p.kind, p.boundary, p.readingDate, p.days] : p.kind)), [['farInterim', '2025-09-30', '2025-11-05', 36]])
  const gap = (status: 'imprecise' | 'useReading') => [{ unitId: 'c', date: '2025-09-30', status, reason: '' }]
  const ablesung = planSelf(input({ readings: nov, gaps: gap('useReading') }))
  assert.deepEqual([ablesung.problems, userOf(ablesung, 'C1').pots.heating.value], [[], 7700])
  assert.ok(ablesung.findings.some((f) => f.kind === 'interimOff' && f.far))
  const ungenau = planSelf(input({ readings: nov, gaps: gap('imprecise') }))
  assert.deepEqual([ungenau.problems, userOf(ungenau, 'C1').pots.heating.group], [[], true])
  assert.ok(ungenau.findings.some((f) => f.kind === 'noInterim' && f.status === 'imprecise'))
  assert.equal(ungenau.units.find((u) => u.unit.id === 'c')?.boundaries.find((b) => b.kind === 'change')?.far, true)
})

test('Review Focus 1: Leerstand zwischen zwei Mietern, Ablesung nur am Ende des Leerstands', () => {
  const tenancies = TENANCIES.map((t) => (t.id === 'C2' ? { ...t, start: '2025-10-15' } : t))
  const readings = [...without('2025-09-30', ['wc', 'xc']), r('wc', '2025-10-14', 7900), r('xc', '2025-10-14', 44)]
  const plan = planSelf(input({ tenancies, readings }))
  const unit = plan.units.find((u) => u.unit.id === 'c') ?? assert.fail('C')
  assert.deepEqual(unit.users.map((u) => [u.key, u.role, u.from, u.to]), [
    ['C1', 'tenancy', '2025-01-01', '2025-09-30'], ['vacancy:c:2025-10-01', 'vacancy', '2025-10-01', '2025-10-14'], ['C2', 'tenancy', '2025-10-15', '2025-12-31'],
  ])
  assert.equal(userOf(plan, 'C1').pots.heating.group, true)
  assert.equal(userOf(plan, 'vacancy:c:2025-10-01').pots.heating.group, true)
  assert.deepEqual([userOf(plan, 'C2').pots.heating.group, userOf(plan, 'C2').pots.heating.value], [false, 4600])
  // Σ der Nutzer der Wohnung bleibt der Verbrauch der Wohnung.
  const sum = unit.users.reduce((a, u) => a + u.pots.heating.consumption, 0)
  near(sum * plan.totals.heating.consumption, 12000, 'Verbrauch der Wohnung')
  assert.deepEqual(plan.findings.filter((x) => x.kind === 'noInterim').map((x) => x.kind === 'noInterim' ? x.tenancyIds : []), [['C1']])
})

test('Leerstand und Eigennutzung sind Nutzer: Grundkosten und gemessener Verbrauch', () => {
  const units = UNITS.map((u) => (u.id === 'a' ? { ...u, role: 'self' as const } : u))
  const tenancies = TENANCIES.filter((t) => t.id !== 'A' && t.id !== 'B')
  const plan = planSelf(input({ units, tenancies }))
  assert.deepEqual(plan.units.find((u) => u.unit.id === 'a')?.users.map((u) => [u.key, u.role]), [['self:a:2025-01-01', 'self']])
  assert.deepEqual(plan.units.find((u) => u.unit.id === 'b')?.users.map((u) => [u.key, u.role]), [['vacancy:b:2025-01-01', 'vacancy']])
  near(userOf(plan, 'vacancy:b:2025-01-01').pots.heating.consumption, 16000 / 40000, 'Leerstand trägt seinen Verbrauch')
  near(userOf(plan, 'vacancy:b:2025-01-01').pots.heating.base, 80 / 200, 'und seine Grundkosten')
})

test('R-A21: beheizte Fläche nur im Topf Heizung, Warmwasser nach Wohnfläche', () => {
  const units = UNITS.map((u) => (u.id === 'c' ? { ...u, heatedAreaM2: 40 } : u))
  const plan = planSelf(input({ units, areaBasisHeat: 'heatedArea' }))
  near(plan.totals.heating.area, 180, 'Heizung: 60 + 80 + 40 m²')
  near(plan.totals.water.area, 200, 'Warmwasser: Wohnfläche')
  near(userOf(plan, 'A').pots.heating.base, 60 / 180, 'A Heizung')
  near(userOf(plan, 'A').pots.water.base, 60 / 200, 'A Warmwasser')
})

test('Review Focus 4: eine Wohnung ohne Wärmezähler ist ein Fehler, nicht eine Wohnung ohne Verbrauch', () => {
  const plan = planSelf(input({ meters: METERS.filter((m) => m.id !== 'wb') }))
  assert.deepEqual(plan.problems, [{ kind: 'missing', pot: 'heating', unitId: 'b', unitName: 'B', boundary: null, reason: 'noMeter', meterName: null }])
})

test('Fehlender Stand am Ende, Zählerwechsel ohne Endstand und negativer Verbrauch sind ohne Schätzung nach § 9a Fehler', () => {
  const ohneEnde = planSelf(input({ readings: READINGS.filter((x) => !(x.meterId === 'wa' && x.date === '2025-12-31')) }))
  assert.deepEqual(ohneEnde.problems, [{ kind: 'missing', pot: 'heating', unitId: 'a', unitName: 'A', boundary: '2025-12-31', reason: 'noReading', meterName: 'Wärme A' }])
  const wechsel = planSelf(input({ readings: [...READINGS, r('wa', '2025-06-30', 0, { replacement: true, oldEndValue: null })] }))
  assert.equal(wechsel.problems[0]?.kind === 'missing' ? wechsel.problems[0].reason : null, 'replacement')
  const rueckwaerts = planSelf(input({ readings: READINGS.map((x) => (x.meterId === 'wa' && x.date === '2025-12-31' ? { ...x, value: 500 } : x)) }))
  assert.equal(rueckwaerts.problems[0]?.kind === 'missing' ? rueckwaerts.problems[0].reason : null, 'negative')
})

test('Ohne einen einzigen Wärmezähler ist der Topf nicht erfasst und wird nur nach Fläche verteilt', () => {
  const plan = planSelf(input({ meters: METERS.filter((m) => m.type !== 'waerme') }))
  assert.deepEqual(plan.problems, [])
  assert.equal(plan.totals.heating.measured, false)
  const w = weightsOf(plan, { heating: 70, water: 70 }, 0.15)
  near(w.get('A')?.heating ?? 0, 60 / 200, 'A nur nach Fläche')
})

test('Ohne Warmwasser gibt es nur den Topf Heizung', () => {
  const plan = planSelf(input({ hotWater: 'none', meters: METERS.filter((m) => m.type === 'waerme') }))
  assert.deepEqual(plan.pots, ['heating'])
  assert.deepEqual(plan.problems, [])
})

test('Nutzer einer Wohnung: Mieter, Lücken als Leerstand, Eigennutzung, außerhalb', () => {
  const h = { from: '2025-01-01', to: '2025-12-31' }
  const t = (id: string, start: string, end: string | null): SelfTenancy => ({ id, unitId: 'u', tenantName: id, start, end })
  const unit = (role: SelfUnit['role']): SelfUnit => ({ id: 'u', name: 'U', areaM2: 50, heatedAreaM2: null, role })
  assert.deepEqual(usersOf(unit('rented'), [t('x', '2024-01-01', '2025-03-31'), t('y', '2025-05-01', null)], h).map((u) => [u.key, u.from, u.to, u.days]), [
    ['x', '2025-01-01', '2025-03-31', 90], ['vacancy:u:2025-04-01', '2025-04-01', '2025-04-30', 30], ['y', '2025-05-01', '2025-12-31', 245],
  ])
  assert.deepEqual(usersOf(unit('self'), [], h).map((u) => [u.role, u.label]), [['self', 'Eigennutzung']])
  assert.deepEqual(usersOf(unit('outside'), [], h).map((u) => [u.role, u.label]), [['outside', 'außerhalb der Abrechnungseinheit']])
})

test('Ziel einer Position: passt zur Warmwasserbereitung, Brennstoff bei verbundener Anlage zu beidem', () => {
  assert.equal(targetProblem('combined', 'fuel', 'both'), null)
  assert.match(targetProblem('combined', 'fuel', 'heating') ?? '', /§ 9 Abs\. 1 HeizkostenV/)
  assert.equal(targetProblem('combined', 'metering', 'water'), null)
  assert.match(targetProblem('none', 'operating', 'both') ?? '', /kein Warmwasser/)
  assert.match(targetProblem('separate', 'operating', 'both') ?? '', /getrennt/)
  assert.match(targetProblem('combined', null, 'both') ?? '', /Teil/)
  assert.match(targetProblem('combined', 'fuel', null) ?? '', /Ziel/)
})

// ---------- Warmwasseranteil (Entwurf 8.3; ab Heizung PR 11 über dhw.ts) ----------

const gasRechnung = {
  id: 'g', label: 'Gas 2025', invoiceTo: '2025-12-31', deliveredAt: null, invoiceDate: '2026-01-15', energyKwh: 60000,
  quantity: null, quantityUnit: null, gasBasis: 'hs' as const, heatingValue: null, fuelGrade: null,
}
const gas = (over: Partial<AlphaInput> = {}): AlphaInput => ({
  hotWater: 'combined', log: createLawLog(), plant: { energy: 'gas', heatGeneration: null }, row: { dhwMethod: 'heatMeter' },
  h: { from: '2025-01-01', to: '2025-12-31' }, fuelLines: [{ deliveryId: 'g', sharePermille: 1000 }], stock: null, deliveries: [gasRechnung],
  units: [{ areaM2: 200 }], measured: { dhwKwh: 9000, totalKwh: null }, fuelCoveragePermille: 1000, fuelEstimated: false, ...over,
})
const problemOf = (r: ReturnType<typeof hotWaterShareOf>): string => (r.ok ? 'ok' : r.problem)

test('α gemessen (PR 10, ab PR 11 über dhw.ts): 9.000 von 60.000 kWh = 15,0 %, ohne Faktor (Wortlaut, G-B1 abgelehnt)', () => {
  const r = hotWaterShareOf(gas())
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.15, 'α')
  assert.deepEqual([r.alpha.reference, r.alpha.referenceKwh, r.alpha.dhwHeatKwh, r.alpha.estimated], ['fuel', 60000, 9000, false])
  assert.deepEqual([r.alpha.statement.method, r.alpha.statement.factor], ['heatMeter', null])
  // Mit der Schätzung beim Abschluss beruht α auf geschätzter Energie (PR 10 Abweichung 11).
  const geschaetzt = hotWaterShareOf(gas({ fuelEstimated: true }))
  assert.ok(geschaetzt.ok && geschaetzt.alpha?.estimated === true)
})

test('α bei Fernwärme und Wärmepumpe wie in PR 10: Gesamtwärme, wenn gemessen; Wärmepumpe nur gegen sie (A8)', () => {
  const mitZaehler = hotWaterShareOf(gas({ plant: { energy: 'districtHeating' }, measured: { dhwKwh: 9000, totalKwh: 45000 } }))
  assert.ok(mitZaehler.ok && mitZaehler.alpha)
  near(mitZaehler.alpha.value, 0.2, 'Q / Gesamtwärme')
  assert.equal(mitZaehler.alpha.reference, 'totalHeat')
  const ohne = hotWaterShareOf(gas({ plant: { energy: 'districtHeating' } }))
  assert.ok(ohne.ok && ohne.alpha)
  near(ohne.alpha.value, 0.15, 'Q / Lieferung')
  const strom = [{ ...gasRechnung, label: 'Strom 2025', energyKwh: 12000, gasBasis: null }]
  const wp = hotWaterShareOf(gas({ plant: { energy: 'heatPump' }, deliveries: strom, measured: { dhwKwh: 4500, totalKwh: 36000 } }))
  assert.ok(wp.ok && wp.alpha)
  near(wp.alpha.value, 0.125, 'Q / Wärme, nicht Q / Strom')
  assert.equal(problemOf(hotWaterShareOf(gas({ plant: { energy: 'heatPump' }, deliveries: strom, measured: { dhwKwh: 4500, totalKwh: null } }))), 'heatPumpBasis')
})

test('α: Lücke, fehlende Werte und Werte außerhalb sind Fehler wie in PR 10; Formel und Heizöl rechnen ab PR 11; ohne verbundenes Warmwasser kein α', () => {
  assert.equal(problemOf(hotWaterShareOf(gas({ fuelCoveragePermille: 848.71 }))), 'fuelGap')
  assert.equal(problemOf(hotWaterShareOf(gas({ deliveries: [{ ...gasRechnung, energyKwh: null }] }))), 'noFuelEnergy')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: null, totalKwh: null } }))), 'noDhwHeat')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: 60000, totalKwh: null } }))), 'outOfRange')
  assert.equal(problemOf(hotWaterShareOf(gas({ measured: { dhwKwh: 0, totalKwh: null } }))), 'outOfRange')
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'none' })), { ok: true, alpha: null })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'separate', plant: { energy: 'oil' } })), { ok: true, alpha: null })
  // Die Sperren `formulaLater` und `heatingValueLater` aus PR 10 fallen: 15.000 · 1,11 / 60.000 = 27,75 %.
  const formel = hotWaterShareOf(gas({ plant: { energy: 'gas', heatGeneration: 'single' }, row: { dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 } }))
  assert.ok(formel.ok && formel.alpha)
  near(formel.alpha.value, 0.2775, 'Volumenformel')
  assert.deepEqual(formel.alpha.statement.factor, { kind: 'gasCalorific', value: 1.11 })
  // Heizöl aus dem Vorrat: 9.000 kWh / 9,8 kWh/l = 918,37 l von 6.000 l = 15,31 %; Energie 58.800 kWh.
  const oel = { ...gasRechnung, id: 'o1', label: 'Öl Oktober', invoiceTo: null, deliveredAt: '2025-10-12', invoiceDate: null, energyKwh: null, gasBasis: null, quantity: 3000, quantityUnit: 'l' as const, heatingValue: 9.8 }
  const heizoel = hotWaterShareOf(gas({ plant: { energy: 'oil' }, fuelLines: [], stock: { unit: 'l', consumedQuantity: 6000 }, deliveries: [oel] }))
  assert.ok(heizoel.ok && heizoel.alpha)
  near(heizoel.alpha.value, 9000 / 58800, 'B / verbrauchte Menge')
  assert.equal(Math.round(heizoel.alpha.referenceKwh), 58800)
})

// ---------- Anteil nach Verbrauch (Entwurf 8.5, R-A7) ----------

const row = (period: string, heat: number | null, water: number | null = heat, insulationRule: 'applies' | 'notApplies' | 'unknown' | null = null) =>
  ({ period, heatConsumptionPct: heat, waterConsumptionPct: water, insulationRule })
const seventy = () => 70

test('R-A7: Vorgabe ist der Anteil der Vorperiode; ein neuer Anteil ist ein Wechsel', () => {
  const geerbt = consumptionSharesOf([row('2024-01', 50)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([geerbt.heating, geerbt.water, geerbt.own, geerbt.changed], [50, 50, false, false])
  const neu = consumptionSharesOf([row('2024-01', 50), row('2025-01', 70)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([neu.heating, neu.own, neu.changed, neu.previous], [70, true, true, { heating: 50, water: 50 }])
  // Eine spätere Heizperiode zählt nicht als Vorperiode.
  // § 8 Abs. 1: ohne eigenen Wert beim Warmwasser kein Ersatz aus der Heizung (Abweichung 14).
  const ohneWasser = consumptionSharesOf([row('2025-01', 60, null)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([ohneWasser.heating, ohneWasser.water], [60, null])
  const geerbtOhneWasser = consumptionSharesOf([row('2024-01', 60, null)], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.equal(geerbtOhneWasser.water, null)
  const vorher = consumptionSharesOf([row('2026-01', 60)], '2025-01', 'gas', seventy)
  assert.equal(vorher, null)
  assert.equal(consumptionSharesOf([], '2025-01', 'gas', seventy), null)
})

test('§ 7 Abs. 1 Satz 2: bei Öl und Gas zwingend 70 % für die Heizung, nicht bei Fernwärme (§ 7 Abs. 3)', () => {
  const gasHaus = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'gas', seventy) ?? assert.fail('Gas')
  assert.deepEqual([gasHaus.heating, gasHaus.water, gasHaus.forced], [70, 60, true])
  const fern = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'districtHeating', seventy) ?? assert.fail('Fernwärme')
  assert.deepEqual([fern.heating, fern.forced], [60, false])
  const lpg = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', 'lpg', seventy) ?? assert.fail('Flüssiggas')
  assert.equal(lpg.heating, 70, 'Flüssiggas zählt als Gasheizung (Abweichung 13)')
  // Die Angabe zur Dämmung erbt wie der Anteil.
  const geerbt = consumptionSharesOf([row('2024-01', 60, 60, 'applies'), row('2025-01', null, null, null)], '2025-01', 'oil', seventy) ?? assert.fail('Öl')
  assert.deepEqual([geerbt.heating, geerbt.forced], [70, true])
})

// ---------- Wärmepumpen (§ 12 Abs. 3, Entwurf 4.7, F5) ----------

const rule = onlyVersion(hkvHeatPumpCapture).value
const wp = (capturedOnOct2024: boolean | null, captureInstalledOn: string | null, heatPumpInstalledOn: string | null = null) =>
  ({ energy: 'heatPump' as const, capturedOnOct2024, captureInstalledOn, heatPumpInstalledOn })

test('Wärmepumpe: die vier Stichtagsfälle aus 4.7 und F5', () => {
  assert.deepEqual(heatPumpVerdict(wp(true, null), '2025-01-01', rule), { kind: 'applies' }, 'schon am 01.10.2024 erfasst')
  assert.deepEqual(heatPumpVerdict(wp(false, '2025-06-01'), '2025-01-01', rule), { kind: 'notYet', captureInstalledOn: '2025-06-01' }, 'nachgerüstet im Zeitraum')
  assert.deepEqual(heatPumpVerdict(wp(false, '2025-06-01'), '2026-01-01', rule), { kind: 'applies' }, 'Zeitraum nach dem Einbau')
  assert.deepEqual(heatPumpVerdict(wp(null, null, '2025-02-01'), '2025-01-01', rule), { kind: 'applies' }, 'F5: neu eingebaut mit Erfassung')
  assert.deepEqual(heatPumpVerdict(wp(false, null), '2026-01-01', rule), { kind: 'missing' }, '15 % als Auslegung (15.1 Nr. 22)')
  assert.deepEqual(heatPumpVerdict(wp(false, null), '2025-01-01', rule), { kind: 'notYet', captureInstalledOn: null }, 'Frist noch offen')
  assert.equal(heatPumpVerdict({ ...wp(null, null), energy: 'gas' }, '2025-01-01', rule), null)
  // Unbekannt: Mietfuchs rechnet nach der Verordnung, die Einrichtung fragt.
  assert.deepEqual(heatPumpVerdict(wp(null, null), '2025-01-01', rule), { kind: 'applies' })
})

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
  // Der Ausweis bekommt die abgelesenen Mengen vor dem Faktor.
  // Je Nutzer (Durchsicht von #241, Recht-I1): C1 300, C2 200.
  assert.deepEqual(plan.units.find((u) => u.unit.id === 'c')?.measured, [
    { meterId: 'c1', pot: 'heating', raw: 300, userKeys: ['C1'], from: '2025-01-01', to: '2025-09-30' },
    { meterId: 'c1', pot: 'heating', raw: 200, userKeys: ['C2'], from: '2025-10-01', to: '2025-12-31' },
  ])
  // Ohne Gerät des richtigen Typs fehlt der Wert.
  const ohne = planSelf(input({ hotWater: 'none', capture: 'hca', meters: HKV.filter((m) => m.unitId !== 'b'), readings: HKV_READINGS }))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'missing' ? [p.unitId, p.reason] : p.kind)), [['b', 'noMeter']])
  // Ohne `capture` rechnet planSelf wie in PR 10 mit Wärmezählern; die Geräte vom Typ `hkv` zählen dann nicht.
  assert.equal(planSelf(input({ hotWater: 'none', meters: HKV, readings: HKV_READINGS })).totals.heating.measured, false)
})

test('Ablesedienst als gedachter Zähler: Zeilen je Nutzungszeitraum ergeben dieselben Werte; eine Lücke an einem Wechsel bleibt eine Lücke', () => {
  const svc = (unitId: string, values: [string, string, number][]) => {
    const id = `ablesedienst-heizung:${unitId}`
    const readings: SelfReading[] = [r(id, '2024-12-31', 0)]
    let sum = 0
    for (const [, to, v] of values) {
      sum += v
      readings.push(r(id, to, sum))
    }
    return { meter: { id, name: `Ablesedienst ${unitId}`, unitId, type: 'waerme' as const, factor: 1 }, readings }
  }
  const a = svc('a', [['2025-01-01', '2025-12-31', 12000]])
  const b = svc('b', [['2025-01-01', '2025-12-31', 16000]])
  const c = svc('c', [['2025-01-01', '2025-09-30', 7200], ['2025-10-01', '2025-12-31', 4800]])
  const plan = planSelf(input({ hotWater: 'none', capture: 'serviceValues', meters: [a.meter, b.meter, c.meter], readings: [...a.readings, ...b.readings, ...c.readings] }))
  assert.deepEqual(plan.problems, [])
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 7200, 'C1 wie mit Wärmezähler')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 4800, 'C2')
  // Lücke: C hat eine Zeile bis 15.09., dann ab 01.10. Am 30.09. (Wechsel) steht kein eigener Stand;
  // die Ablesung vom 15.09. liegt 15 Tage daneben und gilt wie abgelesen (PR 10), es wird nichts aufgefüllt.
  const luecke = svc('c', [['2025-01-01', '2025-09-15', 7000], ['2025-10-01', '2025-12-31', 4800]])
  const mitLuecke = planSelf(input({ hotWater: 'none', capture: 'serviceValues', meters: [a.meter, b.meter, luecke.meter], readings: [...a.readings, ...b.readings, ...luecke.readings] }))
  near(userOf(mitLuecke, 'C1').pots.heating.value ?? -1, 7000, 'C1 bis zur letzten Zeile')
  near(userOf(mitLuecke, 'C2').pots.heating.value ?? -1, 4800, 'C2')
  assert.ok(mitLuecke.findings.some((f) => f.kind === 'interimOff' && f.boundary === '2025-09-30' && f.readingDate === '2025-09-15'))
})

// ---------- Schätzung nach § 9a (Heizung PR 13, Entwurf 8.7, 12.2) ----------

// Vier Wohnungen mit Wärmezählern, ohne Warmwasser. `end` je Wohnung der Stand am 31.12.2025; null heißt:
// der Stand fehlt (Gerät ausgefallen).
function vier(areas: readonly number[], end: readonly (number | null)[], over: Partial<SelfInput> = {}): SelfInput {
  const ids = areas.map((_, i) => i)
  return input({
    hotWater: 'none',
    units: ids.map((i) => ({ id: `d${i}`, name: `D${i}`, areaM2: areas[i] ?? 0, heatedAreaM2: null, role: 'rented' as const })),
    tenancies: ids.map((i) => ({ id: `T${i}`, unitId: `d${i}`, tenantName: `Mieter ${i}`, start: '2020-01-01', end: null })),
    meters: ids.map((i) => ({ id: `w${i}`, name: `Wärme D${i}`, unitId: `d${i}`, type: 'waerme' as const })),
    readings: ids.flatMap((i) => {
      const e = end[i]
      return [r(`w${i}`, '2024-12-31', 0), ...(e === null || e === undefined ? [] : [r(`w${i}`, '2025-12-31', e)])]
    }),
    ...over,
  })
}
const est = (entries: [string, number][]) => new Map(entries)
const withLimit = (calls?: { n: number }) => () => {
  if (calls) calls.n += 1
  return onlyVersion(hkvEstimateThreshold).value
}
const unitPlanOf = (plan: SelfPlan, id: string) => plan.units.find((u) => u.unit.id === id) ?? assert.fail(`keine Wohnung ${id}`)

test('§ 9a: ohne Schätzung ist ein fehlender Endstand ein Fehler, mit Schätzung tritt sie an die Stelle', () => {
  const ohne = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000]))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'missing' ? [p.unitId, p.reason] : p.kind)), [['d0', 'noReading']])
  const mit = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000], { estimates: est([[estimateKey('d0', 'heating'), 6500]]), estimateThreshold: withLimit() }))
  assert.deepEqual(mit.problems, [])
  assert.equal(userOf(mit, 'T0').pots.heating.value, 6500)
  assert.equal(mit.totals.heating.consumption, 32500)
  assert.deepEqual([mit.totals.heating.estimatedArea, mit.totals.heating.overThreshold], [40, false])
  const unit = unitPlanOf(mit, 'd0')
  assert.deepEqual([unit.estimated.heating, unit.captured.heating, unit.estimateComplete.heating], [true, false, false])
  assert.equal(userOf(mit, 'T0').pots.heating.estimated, true)
  assert.equal(userOf(mit, 'T1').pots.heating.estimated, undefined)
  // Der Ausweis zeigt die Ablesungen, wie sie sind: Anfangsstand da, Endstand fehlt.
  assert.deepEqual(unit.readings.map((x) => [x.boundary, x.value]), [['2024-12-31', 0], ['2025-12-31', null]])
})

test('12.2: Schätzung für 20 % der Fläche → nach Verbrauch; für 40 % → nur nach Fläche (§ 9a Abs. 2)', () => {
  const klein = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000], { estimates: est([[estimateKey('d0', 'heating'), 6500]]), estimateThreshold: withLimit() }))
  near(weightsOf(klein, { heating: 70, water: 70 }, null).get('T0')?.heating ?? 0, 0.3 * (40 / 200) + 0.7 * (6500 / 32500), 'T0 nach Verbrauch')
  const gross = planSelf(vier([40, 40, 40, 80], [6000, 5000, 7000, null], { estimates: est([[estimateKey('d3', 'heating'), 12000]]), estimateThreshold: withLimit() }))
  assert.deepEqual([gross.totals.heating.estimatedArea, gross.totals.heating.overThreshold], [80, true])
  const w = weightsOf(gross, { heating: 70, water: 70 }, null)
  near(w.get('T3')?.heating ?? 0, 80 / 200, 'T3 nur nach Fläche')
  near(w.get('T0')?.heating ?? 0, 40 / 200, 'T0 nur nach Fläche')
  near([...w.values()].reduce((a, x) => a + x.heating, 0), 1, 'Σ heating')
})

test('R-A22: vier gleich große Wohnungen, eine geschätzt: genau 25 %, keine Überschreitung', () => {
  const plan = planSelf(vier([50, 50, 50, 50], [null, 5000, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000]]), estimateThreshold: withLimit() }))
  assert.deepEqual([plan.totals.heating.estimatedArea, plan.totals.heating.overThreshold], [50, false])
  // Zwei geschätzte Wohnungen: 50 %, überschritten.
  const zwei = planSelf(vier([50, 50, 50, 50], [null, null, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000], [estimateKey('d1', 'heating'), 6000]]), estimateThreshold: withLimit() }))
  assert.equal(zwei.totals.heating.overThreshold, true)
  // Eine Wohnung mit mehr als einem Viertel der Fläche überschreitet die Grenze allein.
  const ungleich = planSelf(vier([51, 50, 50, 49], [null, 5000, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000]]), estimateThreshold: withLimit() }))
  assert.equal(ungleich.totals.heating.overThreshold, true)
})

test('Die Grenze wird nur gefragt, wenn es eine Schätzung gibt (Rechtsstand)', () => {
  const calls = { n: 0 }
  planSelf(vier([50, 50, 50, 50], [6000, 5000, 7000, 6000], { estimateThreshold: withLimit(calls) }))
  assert.equal(calls.n, 0)
  planSelf(vier([50, 50, 50, 50], [null, 5000, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000]]), estimateThreshold: withLimit(calls) }))
  assert.equal(calls.n, 1)
})

test('Review Focus 4: je Topf getrennt; beheizte Fläche zählt nur beim Topf Heizung (15.1 Nr. 6)', () => {
  // C hat 60 m² Wohnfläche, aber nur 20 m² beheizte Fläche: Heizung 20 von 160 m² = 12,5 %; Warmwasser
  // 60 von 200 m² = 30 %.
  const units = UNITS.map((u) => (u.id === 'c' ? { ...u, heatedAreaM2: 20 } : u))
  const plan = planSelf(input({
    units, areaBasisHeat: 'heatedArea',
    readings: READINGS.filter((x) => !(x.date === '2025-12-31' && (x.meterId === 'wc' || x.meterId === 'xc'))),
    estimates: est([[estimateKey('c', 'heating'), 12000], [estimateKey('c', 'water'), 50]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  assert.deepEqual([plan.totals.heating.estimatedArea, plan.totals.heating.area, plan.totals.heating.overThreshold], [20, 160, false])
  assert.deepEqual([plan.totals.water.estimatedArea, plan.totals.water.area, plan.totals.water.overThreshold], [60, 200, true])
  const w = weightsOf(plan, { heating: 70, water: 70 }, 0.15)
  // Warmwasser nur nach Fläche, Heizung weiter nach Verbrauch.
  near(w.get('A')?.water ?? 0, 60 / 200, 'A Warmwasser nur nach Fläche')
  assert.ok(Math.abs((w.get('A')?.heating ?? 0) - 60 / 160) > 1e-3, 'A Heizung nach Verbrauch')
})

test('Review Focus 2 (Prüfbericht A5): Zwischenablesung vorhanden, Endstand fehlt: C1 behält 7.200 kWh gemessen, nur C2 wird geschätzt', () => {
  const plan = planSelf(input({
    readings: READINGS.filter((x) => !(x.meterId === 'wc' && x.date === '2025-12-31')),
    estimates: est([[estimateKey('c', 'heating'), 12000]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  // C1 bis 30.09. abgelesen: 7.700 − 500 = 7.200 kWh. C2 ohne Endstand: vom geschätzten Verbrauch der
  // Wohnung für die Heizperiode (12.000 kWh) der Anteil nach Gradtagen Oktober bis Dezember, 360 ‰.
  const c1 = userOf(plan, 'C1').pots.heating
  const c2 = userOf(plan, 'C2').pots.heating
  assert.deepEqual([c1.value, c1.estimated ?? false, c1.group], [7200, false, false])
  near(c2.value ?? -1, 12000 * 0.36, 'C2')
  assert.deepEqual([c2.estimated, c2.group], [true, false])
  near(plan.totals.heating.consumption, 12000 + 16000 + 7200 + 4320, 'Summe')
  const c = unitPlanOf(plan, 'c')
  assert.deepEqual([c.estimated.heating, c.captured.heating, c.estimateComplete.heating], [true, false, false])
  // Kein Geld wandert: Der Anteil von C1 am Verbrauch ist sein Messwert, nicht 12.000 · 640 ‰ = 7.680 kWh.
  near(userOf(plan, 'C1').pots.heating.consumption, 7200 / 39520, 'Bruchteil C1')
  // Warmwasser bleibt gemessen.
  assert.deepEqual([userOf(plan, 'C1').pots.water.value, userOf(plan, 'C2').pots.water.value], [38, 12])
  // 60 von 200 m² = 30 %: Topf Heizung nur nach Fläche.
  assert.equal(plan.totals.heating.overThreshold, true)
  // Der Ausweis je Gerät nennt nur, was abgelesen ist: die Differenz bis zur Zwischenablesung (C1).
  assert.deepEqual(c.measured.filter((x) => x.pot === 'heating').map((x) => [x.raw, x.userKeys]), [[7200, ['C1']]])
})

test('Ohne verwertbare Zwischenablesung (Gerät fiel vor dem Wechsel aus) teilen Vormieter und Nachmieter den geschätzten Verbrauch wie nach § 9b Abs. 3', () => {
  const plan = planSelf(input({
    readings: READINGS.filter((x) => !(x.meterId === 'wc' && (x.date === '2025-12-31' || x.date === '2025-09-30'))),
    gaps: [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Zähler defekt' }],
    estimates: est([[estimateKey('c', 'heating'), 12000]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  // Heizung nach Gradtagen: C1 640 ‰ (Januar bis September), C2 360 ‰.
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 12000 * 0.64, 'C1')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 12000 * 0.36, 'C2')
  assert.deepEqual([userOf(plan, 'C1').pots.heating.group, userOf(plan, 'C2').pots.heating.group], [true, true])
  assert.deepEqual([userOf(plan, 'C1').pots.heating.estimated, userOf(plan, 'C2').pots.heating.estimated], [true, true])
  // Ein ausgefallenes Gerät löst keinen Hinweis auf die fehlende Zwischenablesung aus; der Warmwasserzähler
  // ist zum Wechsel abgelesen. Die Teilung steht im Hinweis zur Schätzung (calc.ts).
  assert.equal(plan.findings.some((x) => x.kind === 'noInterim'), false)
})

test('Prüfbericht A9: Schätzung neben vollständigen Ablesungen ersetzt alles (Markierung „unbrauchbar“) und ist als vollständig erkannt', () => {
  const plan = planSelf(input({ estimates: est([[estimateKey('c', 'heating'), 10000]]), estimateThreshold: withLimit() }))
  const c = unitPlanOf(plan, 'c')
  assert.equal(c.estimateComplete.heating, true)
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 6400, 'C1: 10.000 · 640 ‰')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 3600, 'C2: 10.000 · 360 ‰')
  near(plan.totals.heating.consumption, 12000 + 16000 + 10000, 'Summe ohne die abgelesenen 12.000 kWh von C')
  // Die ersetzten Ablesungen stehen nicht mehr als Verbrauch des Geräts im Ausweis.
  assert.deepEqual(c.measured.filter((x) => x.pot === 'heating'), [])
})

test('§ 9a bei Zählerwechsel ohne Endstand, negativem Verbrauch und zwei Ständen am selben Tag: die Schätzung deckt es', () => {
  const wechsel = [...READINGS, r('wa', '2025-06-30', 0, { replacement: true, oldEndValue: null })]
  const w = planSelf(input({ readings: wechsel, estimates: est([[estimateKey('a', 'heating'), 11000]]), estimateThreshold: withLimit() }))
  assert.deepEqual(w.problems, [])
  assert.equal(userOf(w, 'A').pots.heating.value, 11000)
  assert.equal(unitPlanOf(w, 'a').estimateComplete.heating, false)
  const rueck = READINGS.map((x) => (x.meterId === 'wa' && x.date === '2025-12-31' ? { ...x, value: 500 } : x))
  const n = planSelf(input({ readings: rueck, estimates: est([[estimateKey('a', 'heating'), 11000]]), estimateThreshold: withLimit() }))
  assert.deepEqual(n.problems, [])
  assert.equal(userOf(n, 'A').pots.heating.value, 11000)
  const doppelt = [...READINGS, r('wa', '2025-12-31', 13500)]
  const d = planSelf(input({ readings: doppelt, estimates: est([[estimateKey('a', 'heating'), 11000]]), estimateThreshold: withLimit() }))
  assert.deepEqual(d.problems, [])
  assert.equal(userOf(d, 'A').pots.heating.value, 11000)
})

test('§ 9a mit Leerstand und Eigennutzung: der Anteil der Zeit ohne Mieter bleibt beim Vermieter', () => {
  // C2 zieht nicht ein; ab 01.10. steht C leer. Endstand fehlt.
  const plan = planSelf(input({
    tenancies: TENANCIES.filter((t) => t.id !== 'C2'),
    readings: READINGS.filter((x) => !(x.meterId === 'wc' && x.date === '2025-12-31')),
    estimates: est([[estimateKey('c', 'heating'), 12000]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  const leer = plan.units.flatMap((u) => u.users).find((u) => u.role === 'vacancy') ?? assert.fail('kein Leerstand')
  near(leer.pots.heating.value ?? -1, 4320, 'Leerstand trägt den Anteil Oktober bis Dezember')
  assert.equal(userOf(plan, 'C1').pots.heating.value, 7200)
  const eigen = planSelf(input({
    units: UNITS.map((u) => (u.id === 'b' ? { ...u, role: 'self' as const } : u)),
    tenancies: TENANCIES.filter((t) => t.id !== 'B'),
    readings: READINGS.filter((x) => !(x.meterId === 'wb' && x.date === '2025-12-31')),
    estimates: est([[estimateKey('b', 'heating'), 15000]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(eigen.problems, [])
  const self = eigen.units.flatMap((u) => u.users).find((u) => u.role === 'self') ?? assert.fail('keine Eigennutzung')
  assert.deepEqual([self.pots.heating.value, self.pots.heating.estimated], [15000, true])
})

test('§ 9a mit Heizkostenverteilern: der geschätzte Verbrauch ist in bewerteten Einheiten, ohne Faktor', () => {
  const hkv: SelfMeter[] = [
    { id: 'ha', name: 'HKV A', unitId: 'a', type: 'hkv', factor: 2 }, { id: 'hb', name: 'HKV B', unitId: 'b', type: 'hkv', factor: 1 }, { id: 'hc', name: 'HKV C', unitId: 'c', type: 'hkv', factor: 1 },
  ]
  const readings = [r('ha', '2024-12-31', 0), r('ha', '2025-12-31', 300), r('hb', '2024-12-31', 0), r('hb', '2025-12-31', 800), r('hc', '2024-12-31', 0), r('hc', '2025-09-30', 400)]
  const plan = planSelf(input({ hotWater: 'none', capture: 'hca', meters: hkv, readings, estimates: est([[estimateKey('c', 'heating'), 640]]), estimateThreshold: withLimit() }))
  assert.deepEqual(plan.problems, [])
  assert.equal(userOf(plan, 'A').pots.heating.value, 600)
  assert.equal(userOf(plan, 'C1').pots.heating.value, 400)
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 640 * 0.36, 'C2 ohne Faktor')
})

test('Vorschläge: Durchschnitt des Gebäudes je m², vergleichbare Wohnungen je m², Vorperiode nur bei gleicher Länge', () => {
  const ohneEnde = READINGS.filter((x) => !(x.meterId === 'wc' && x.date === '2025-12-31'))
  const plan = planSelf(input({ readings: ohneEnde }))
  const { proposals, comparable } = estimateProposals(plan, null, true, 'c', 'heating')
  // A 12.000 kWh auf 60 m², B 16.000 auf 80 m²: 28.000 / 140 = 200 kWh je m²; C 60 m² → 12.000.
  assert.deepEqual(proposals.find((p) => p.method === 'buildingAverage'), { method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' })
  assert.deepEqual(proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' })
  assert.deepEqual(comparable, [{ unitId: 'a', unitName: 'A', perM2: 200, value: 12000 }, { unitId: 'b', unitName: 'B', perM2: 200, value: 12000 }])
  assert.deepEqual(proposals.find((p) => p.method === 'comparableUnit'), { method: 'comparableUnit', value: null, perM2: null, why: 'ok' })
  // Vorperiode 2024 mit Ständen der Wohnung C am 31.12.2023 und 31.12.2024: 500 kWh.
  const vorher = planSelf(input({ h: { from: '2024-01-01', to: '2024-12-31' }, neighbors: { before: '2022-12-31', after: '2025-12-31' }, readings: [...READINGS, r('wc', '2023-12-31', 0)] }))
  assert.deepEqual(estimateProposals(plan, vorher, true, 'c', 'heating').proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: 500, perM2: null, why: 'ok' })
  assert.deepEqual(estimateProposals(plan, vorher, false, 'c', 'heating').proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: null, perM2: null, why: 'lengthDiffers' })
  // Eine Wohnung mit Fehler oder mit Schätzung zählt für den Durchschnitt nicht mit.
  const zwei = planSelf(input({ readings: ohneEnde.filter((x) => !(x.meterId === 'wb' && x.date === '2025-12-31')), estimates: est([[estimateKey('b', 'heating'), 99999]]), estimateThreshold: withLimit() }))
  assert.deepEqual(estimateProposals(zwei, null, true, 'c', 'heating').proposals.find((p) => p.method === 'buildingAverage'), { method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' })
  const keiner = planSelf(input({ readings: READINGS.filter((x) => !(x.date === '2025-12-31' && ['wa', 'wb', 'wc'].includes(x.meterId))) }))
  assert.deepEqual(estimateProposals(keiner, null, true, 'c', 'heating').proposals.find((p) => p.method === 'buildingAverage'), { method: 'buildingAverage', value: null, perM2: null, why: 'noMeasured' })
})

test('Gerät, das geschätzt werden kann: je Erfassung und Topf', () => {
  assert.equal(estimateDeviceType('heatMeter', 'heat'), 'waerme')
  assert.equal(estimateDeviceType(null, 'heat'), 'waerme')
  assert.equal(estimateDeviceType('hca', 'heat'), 'hkv')
  assert.equal(estimateDeviceType('serviceValues', 'heat'), null)
  assert.equal(estimateDeviceType('heatMeter', 'water'), 'warmwasser')
  assert.equal(estimateDeviceType('serviceValues', 'water'), null)
})

test('§ 10 (Heizung PR 14): mehr als 70 % nach Vereinbarung erbt mit dem Anteil; § 7 Abs. 1 Satz 2 bleibt Mindestanteil', () => {
  const rows = [{ period: '2024-01', heatConsumptionPct: 80, waterConsumptionPct: 80, insulationRule: 'notApplies' as const, above70Agreed: true }]
  const geerbt = consumptionSharesOf(rows, '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([geerbt.heating, geerbt.above70Agreed, geerbt.insulation], [80, true, 'notApplies'])
  const eigen = consumptionSharesOf([...rows, { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'unknown' as const, above70Agreed: null }], '2025-01', 'gas', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([eigen.heating, eigen.above70Agreed, eigen.insulation], [70, false, 'unknown'])
  // Pflichtanteil mit Vereinbarung darüber: der vereinbarte höhere Wert gilt; ohne Vereinbarung der Pflichtanteil.
  const pflicht = consumptionSharesOf([{ period: '2025-01', heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies' as const, above70Agreed: true }], '2025-01', 'oil', seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([pflicht.heating, pflicht.forced], [85, true])
  const ohne = consumptionSharesOf([{ period: '2025-01', heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies' as const, above70Agreed: false }], '2025-01', 'oil', seventy) ?? assert.fail('kein Anteil')
  assert.equal(ohne.heating, 70)
})
