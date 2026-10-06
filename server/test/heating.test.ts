// Die eigene Heizkostenabrechnung als reine Rechnung (Heizung PR 10, Entwurf 3.5, 8.4–8.6, 12.2
// „heating.test.ts“): Beispiel A centgenau, die Gegenproben, Ablesungen neben Stichtag und Wechsel,
// § 9b Abs. 3, keine lineare Interpolation, Leerstand, Eigennutzung, beheizte Fläche.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundaryReadingsOf, consumptionSharesOf, heatPumpVerdict, hotWaterShareOf, planSelf, readingOff, targetProblem, usersOf, weightsOf, type AlphaInput,
  type SelfInput, type SelfMeter, type SelfPlan, type SelfReading, type SelfTenancy, type SelfUnit,
} from '../src/heating.ts'
import { distributeCents } from '../src/calc.ts'
import { hkvDegreeDays, hkvHeatPumpCapture } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { onlyVersion } from '../../shared/law/register.ts'

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

test('Fehlender Stand am Ende, Zählerwechsel ohne Endstand und negativer Verbrauch sind Fehler (§ 9a kommt mit PR 13)', () => {
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

// ---------- Warmwasseranteil (Entwurf 8.3) ----------

const gas = (over: Partial<AlphaInput> = {}): AlphaInput => ({
  hotWater: 'combined', dhwMethod: 'heatMeter', energy: 'gas', dhwHeatKwh: 9000, totalHeatKwh: null, fuelKwh: 60000, fuelCoveragePermille: 1000, ...over,
})

test('α gemessen: 9.000 von 60.000 kWh nach Brennwert = 15,0 % (Wortlaut, G-B1 abgelehnt)', () => {
  const r = hotWaterShareOf(gas())
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.15, 'α')
  assert.deepEqual([r.alpha.reference, r.alpha.referenceKwh, r.alpha.dhwHeatKwh, r.alpha.estimated], ['fuel', 60000, 9000, false])
  // Mit der Schätzung beim Abschluss beruht α auf geschätzter Energie (Abweichung 11).
  const geschaetzt = hotWaterShareOf(gas({ fuelEstimated: true }))
  assert.ok(geschaetzt.ok && geschaetzt.alpha?.estimated === true)
})

test('α bei Fernwärme: Gesamtwärme, wenn gemessen, sonst die gelieferten kWh laut Rechnung', () => {
  const mitZaehler = hotWaterShareOf(gas({ energy: 'districtHeating', totalHeatKwh: 45000 }))
  assert.ok(mitZaehler.ok && mitZaehler.alpha)
  near(mitZaehler.alpha.value, 0.2, 'Q / Gesamtwärme')
  assert.equal(mitZaehler.alpha.reference, 'totalHeat')
  const ohne = hotWaterShareOf(gas({ energy: 'districtHeating' }))
  assert.ok(ohne.ok && ohne.alpha)
  near(ohne.alpha.value, 0.15, 'Q / Lieferung')
})

test('α bei Wärmepumpe: nur gegen die gemessene Gesamtwärme; ohne Gesamtwärmezähler ein Fehler (A8)', () => {
  const r = hotWaterShareOf(gas({ energy: 'heatPump', dhwHeatKwh: 4500, totalHeatKwh: 36000, fuelKwh: 12000 }))
  assert.ok(r.ok && r.alpha)
  near(r.alpha.value, 0.125, 'Q / Wärme, nicht Q / Strom')
  // Gemessene Wärme geteilt durch Strom ergäbe etwa das Dreifache (37,5 %); das rechnet Mietfuchs nicht.
  assert.deepEqual(hotWaterShareOf(gas({ energy: 'heatPump', dhwHeatKwh: 4500, fuelKwh: 12000 })), { ok: false, problem: 'heatPumpBasis' })
})

test('α: Formeln, Heizöl und Lücken sind gesperrt oder Fehler, ohne Warmwasser gibt es kein α', () => {
  assert.deepEqual(hotWaterShareOf(gas({ dhwMethod: 'volumeFormula' })), { ok: false, problem: 'formulaLater' })
  assert.deepEqual(hotWaterShareOf(gas({ energy: 'oil' })), { ok: false, problem: 'heatingValueLater' })
  assert.deepEqual(hotWaterShareOf(gas({ fuelCoveragePermille: 848.71 })), { ok: false, problem: 'fuelGap' })
  assert.deepEqual(hotWaterShareOf(gas({ fuelKwh: null })), { ok: false, problem: 'noFuelEnergy' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: null })), { ok: false, problem: 'noDhwHeat' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: 60000 })), { ok: false, problem: 'outOfRange' })
  assert.deepEqual(hotWaterShareOf(gas({ dhwHeatKwh: 0 })), { ok: false, problem: 'outOfRange' })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'none' })), { ok: true, alpha: null })
  assert.deepEqual(hotWaterShareOf(gas({ hotWater: 'separate', energy: 'oil' })), { ok: true, alpha: null })
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
