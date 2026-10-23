// Gradtage beim Leerstand (#314): Teilt die eigene Heizkostenabrechnung nach Gradtagen und steht in einer Wohnung
// ein Leerstand, eine Eigennutzung oder ein Wechsel ohne Zwischenablesung, nennen Rechenweg und Hinweis den
// zeitanteiligen Vergleichswert (und umgekehrt). Keine Zahl der Abrechnung wandert: Die Beträge unten sind die von
// `main` vor #314, gemessen in der Gegenprüfung des Issues.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { INFORMATIONAL } from '../../shared/notices.ts'
import { periodKey } from '../../shared/period.ts'
import type { ChangeSplit, HeatingEstimate, HeatingPeriodData, Reading, Tenancy, Unit } from '../../shared/types.ts'
import { selfMeter, selfReading, selfReadings, selfSnapshot, selfTenancy, selfUnit } from '../testing/selfHeating.ts'

const NEW = 'heating.change-split-degree-days'
const OLD = 'heating.change-split-time'

// Zwei Wohnungen zu je 70 m², 4.000 € nur Heizung, 70 % nach Verbrauch. In A wohnt A1 bis Mai, Juni bis August steht
// sie leer (300 kWh), ab September wohnt A2; abgelesen ist zu jedem Wechsel. B wohnt das ganze Jahr.
function probe(split: ChangeSplit, o: { units?: Unit[]; tenancies?: Tenancy[]; readings?: Reading[]; row?: Partial<HeatingPeriodData> } = {}): ComputedSettlement {
  const readings = o.readings ?? [
    selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-05-31', 5000), selfReading('wz-a', '2025-08-31', 5300), selfReading('wz-a', '2025-12-31', 9000),
    selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 10000),
  ]
  return computeSettlement(selfSnapshot({
    plant: { changeSplit: split, hotWater: 'none' },
    units: o.units ?? [selfUnit('a', 70), selfUnit('b', 70)],
    tenancies: o.tenancies ?? [selfTenancy('A1', 'a', '2020-01-01', '2025-05-31'), selfTenancy('A2', 'a', '2025-09-01', null), selfTenancy('B', 'b', '2020-01-01', null)],
    meters: [selfMeter('wz-a', 'a', 'Wärme A', 'waerme'), selfMeter('wz-b', 'b', 'Wärme B', 'waerme')],
    readings,
    deliveries: [],
    costItems: [{
      id: 'k', propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: 'Heizkosten', amountCents: 400000,
      key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'operating', heatingTarget: 'heating',
    }],
    row: { waterConsumptionPct: null, dhwMethod: null, ...o.row },
  }))
}

const shareOf = (s: ComputedSettlement, id: string): number => s.statements.find((x) => x.tenancyId === id)?.rows.reduce((a, r) => a + r.shareCents, 0) ?? assert.fail(`keine Abrechnung für ${id}`)
const partsOf = (s: ComputedSettlement) => s.landlord.rows.flatMap((r) => r.landlordParts ?? [])
const stepsOf = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id)?.rows.flatMap((r) => r.steps ?? []) ?? assert.fail(`keine Abrechnung für ${id}`)
const noticeOf = (s: ComputedSettlement, code: string) => (s.notices ?? []).find((n) => n.code === code)
const textOf = (s: ComputedSettlement, code: string): string => noticeOf(s, code)?.text ?? assert.fail(`kein Hinweis ${code}: ${(s.notices ?? []).map((n) => n.code).join(', ')}`)

test('#314: Beispiel der Gegenprüfung, nach Gradtagen 68,21 € für den Leerstand gegen 195,44 € zeitanteilig, keine Zahl wandert', () => {
  const g = probe('degreeDays')
  // Die Beträge wie vor #314.
  assert.deepEqual(['A1', 'A2', 'B'].map((t) => shareOf(g, t)), [107884, 77926, 207369])
  assert.deepEqual(partsOf(g), [{ reason: 'vacancy', cents: 6821 }])
  const n = noticeOf(g, NEW) ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.ok(INFORMATIONAL.has(NEW), 'färbt die Ampel nicht')
  assert.match(n.text, /Leerstand in A \(01\.06\.2025 bis 31\.08\.2025\): nach Gradtagen 68,21 €, zeitanteilig 195,44 €/)
  assert.match(n.text, /Mieter A1 \(A\): nach Gradtagen 1\.078,84 €, zeitanteilig 985,06 €/)
  assert.match(n.text, /Mieter A2 \(A\): nach Gradtagen 779,26 €, zeitanteilig 745,81 €/)
  assert.doesNotMatch(n.text, /Mieter B/, 'andere Wohnungen bleiben unberührt')
  assert.match(n.text, /§ 9b Abs\. 2 HeizkostenV/)
  assert.match(n.text, /abweichende Vereinbarung.*geht vor \(§ 9b Abs\. 4 HeizkostenV\)/)
  assert.match(n.text, /Auslegung von Mietfuchs/)
  assert.doesNotMatch(n.text, /VIII ZR 9\/14/, 'nur über eine Sekundärquelle gelesen')
  assert.equal(noticeOf(g, OLD), undefined, 'kein zweiter Hinweis mit demselben Inhalt')
  // Rechenweg: der zeitanteilige Vergleichswert an den Zeilen der Wohnung mit Leerstand, nicht bei B.
  assert.ok(stepsOf(g, 'A1').some((x) => x.label === 'Zum Vergleich zeitanteilig' && /985,06 €/.test(x.value)), JSON.stringify(stepsOf(g, 'A1')))
  assert.ok(stepsOf(g, 'A2').some((x) => x.label === 'Zum Vergleich zeitanteilig' && /745,81 €/.test(x.value)))
  assert.ok(!stepsOf(g, 'B').some((x) => x.label.startsWith('Zum Vergleich')))
})

test('#314: zeitanteilig, der bisherige Hinweis nennt auch den Leerstand und § 9b Abs. 4, der Rechenweg den Wert nach Gradtagen', () => {
  const t = probe('time')
  assert.deepEqual(['A1', 'A2', 'B'].map((x) => shareOf(t, x)), [98506, 74581, 207369])
  assert.deepEqual(partsOf(t), [{ reason: 'vacancy', cents: 19544 }])
  const text = textOf(t, OLD)
  assert.match(text, /Mieter A1 \(A\): zeitanteilig 985,06 €, nach Gradtagen 1\.078,84 €/)
  assert.match(text, /Leerstand in A \(01\.06\.2025 bis 31\.08\.2025\): zeitanteilig 195,44 €, nach Gradtagen 68,21 €/)
  assert.match(text, /§ 9b Abs\. 4 HeizkostenV/)
  assert.match(text, /Den Leerstand teilt Mietfuchs wie einen Nutzerwechsel.*\(Auslegung von Mietfuchs\)/)
  assert.equal(noticeOf(t, NEW), undefined)
  assert.ok(stepsOf(t, 'A1').some((x) => x.label === 'Zum Vergleich nach Gradtagen' && /1\.078,84 €/.test(x.value)))
  assert.ok(!stepsOf(t, 'B').some((x) => x.label.startsWith('Zum Vergleich')))
})

test('#314: gewöhnlicher Mieterwechsel mit Zwischenablesung bekommt nichts', () => {
  // Beispiel A: C1 bis 30.09., C2 ab 01.10., abgelesen am Wechsel.
  const s = computeSettlement(selfSnapshot())
  assert.equal(noticeOf(s, NEW), undefined)
  for (const id of ['A', 'B', 'C1', 'C2']) assert.ok(!stepsOf(s, id).some((x) => x.label.startsWith('Zum Vergleich')), id)
})

test('#314: Wechsel ohne Zwischenablesung nennt den Vergleichswert, ohne Leerstand', () => {
  const s = probe('degreeDays', {
    tenancies: [selfTenancy('A1', 'a', '2020-01-01', '2025-06-30'), selfTenancy('A2', 'a', '2025-07-01', null), selfTenancy('B', 'b', '2020-01-01', null)],
    readings: [selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-12-31', 9000), selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 10000)],
  })
  const text = textOf(s, NEW)
  assert.match(text, /ohne Zwischenablesung/)
  assert.match(text, /Mieter A1 \(A\): nach Gradtagen [\d.,]+ €, zeitanteilig [\d.,]+ €/)
  assert.doesNotMatch(text, /Leerstand|Auslegung/)
  assert.ok(stepsOf(s, 'A1').some((x) => x.label === 'Zum Vergleich zeitanteilig'))
})

test('#314: Eigennutzung nach einem Mietverhältnis nennt den Vergleichswert der Eigennutzung', () => {
  const s = probe('degreeDays', {
    units: [selfUnit('a', 70, { participates: false, selfUsed: true }), selfUnit('b', 70)],
    tenancies: [selfTenancy('A1', 'a', '2020-01-01', '2025-05-31'), selfTenancy('B', 'b', '2020-01-01', null)],
    readings: [selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-05-31', 5000), selfReading('wz-a', '2025-12-31', 9000), selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 10000)],
  })
  const text = textOf(s, NEW)
  assert.match(text, /Eigennutzung in A \(01\.06\.2025 bis 31\.12\.2025\): nach Gradtagen [\d.,]+ €, zeitanteilig [\d.,]+ €/)
  assert.doesNotMatch(text, /Auslegung/, 'die Auslegung betrifft nur den Leerstand')
})

// Durchsicht von #417.
const estimateC = (value: number): HeatingEstimate => ({
  plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh',
})

test('Durchsicht S1: eine Schätzung nach § 9a allein ist kein Wechsel ohne Zwischenablesung', () => {
  // Beispiel A: C1 und C2 mit Zwischenablesung, für C eine Schätzung der Heizung.
  const s = computeSettlement(selfSnapshot({ estimates: [estimateC(10000)] }))
  assert.equal(noticeOf(s, NEW), undefined, (s.notices ?? []).map((n) => n.code).join(', '))
  for (const id of ['C1', 'C2']) assert.ok(!stepsOf(s, id).some((x) => x.label.startsWith('Zum Vergleich')), id)
})

// Beispiel A mit Leerstand in C im Oktober: C1 bis 30.09., C2 ab 01.11., abgelesen an beiden Grenzen.
function leerstandC(split: ChangeSplit): ComputedSettlement {
  return computeSettlement(selfSnapshot({
    plant: { changeSplit: split },
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', '2025-09-30'), selfTenancy('C2', 'c', '2025-11-01', null)],
    readings: [...selfReadings(), selfReading('wz-c', '2025-10-31', 8200), selfReading('xw-c', '2025-10-31', 44)],
  }))
}
const rowSteps = (s: ComputedSettlement, id: string, item: string) => s.statements.find((x) => x.tenancyId === id)?.rows.find((r) => r.costItemId === item)?.steps ?? assert.fail(`keine Zeile ${item} für ${id}`)

test('Durchsicht S2: Warmwasser wird immer nach Tagen geteilt, sein Rechenweg nennt keinen Vergleich', () => {
  for (const split of ['degreeDays', 'time'] as const) {
    const s = leerstandC(split)
    assert.ok(rowSteps(s, 'C2', 'wz').some((x) => x.label.startsWith('Zum Vergleich')), `${split}: Heizung mit Vergleich`)
    assert.ok(!rowSteps(s, 'C2', 'wwz').some((x) => x.label.startsWith('Zum Vergleich')), `${split}: Warmwasser ohne Vergleich`)
  }
})

// Zweifamilienhaus: a selbst bewohnt, b vermietet mit Leerstand Juni bis August; wahlweise Vereinbarung nach § 2
// „nach Wohnfläche“.
function zfhLeerstand(agreed: boolean): ComputedSettlement {
  return probe('degreeDays', {
    units: [selfUnit('a', 70, { participates: false, selfUsed: true }), selfUnit('b', 70)],
    tenancies: [selfTenancy('B1', 'b', '2020-01-01', '2025-05-31'), selfTenancy('B2', 'b', '2025-09-01', null)],
    readings: [
      selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-12-31', 9000),
      selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-05-31', 5000), selfReading('wz-b', '2025-08-31', 5300), selfReading('wz-b', '2025-12-31', 10000),
    ],
    ...(agreed ? { row: { agreedOtherwise: 'area' } } : {}),
  })
}

test('Durchsicht K1, K3: unter einer Vereinbarung „nach Wohnfläche“ kein Hinweis und kein Vergleich im Rechenweg', () => {
  const ohne = zfhLeerstand(false)
  assert.ok(noticeOf(ohne, NEW), 'ohne Vereinbarung kommt der Hinweis')
  assert.ok(stepsOf(ohne, 'B1').some((x) => x.label.startsWith('Zum Vergleich')))
  const mit = zfhLeerstand(true)
  assert.ok(stepsOf(mit, 'B1').some((x) => /nur nach Wohnfläche verteilt/.test(x.value)), 'die Vereinbarung gilt')
  assert.equal(noticeOf(mit, NEW), undefined)
  assert.ok(!stepsOf(mit, 'B1').some((x) => x.label.startsWith('Zum Vergleich')), JSON.stringify(stepsOf(mit, 'B1')))
})
