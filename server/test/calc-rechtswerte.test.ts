// Rechtswerte einer Abrechnung (Heizung PR 1, Entwurf 4.2 und 4.4): Jeder Wert aus dem Register,
// mit dem die Berechnung gerechnet oder einen Hinweis geschrieben hat, steht in
// `legalBasis.values`, und nur diese. So friert beim Abschluss ein, mit welcher Zahl gerechnet
// wurde, und `deviation` kann sie später vergleichen.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { LAW_AS_OF } from '../../shared/law/register.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const item = (year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem =>
  ({ id: 'k', period: calendarPeriod(year), category: 'Grundsteuer', description: 'Posten', amountCents: 120000, key: 'area', ...over })
const snap = (year: number, s: Partial<SnapshotSource>, property?: Snapshot['property']): Snapshot => ({
  ...snapshotOf({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s }, year),
  ...(property !== undefined ? { property } : {}),
})
const two = { units: [unit('w1', 60), unit('w2', 40)], tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2')] }
// Frist und Höchstdauer des Zeitraums (#208) stehen in jeder Abrechnung; gefragt wird hier nach den
// übrigen, deshalb ohne sie.
const ids = (s: ComputedSettlement) => s.legalBasis.values.map((v) => v.id).filter((id) => !id.startsWith('bgb.')).sort()

test('Rechtswerte: ohne Heizung, Kabel und Leerstand keine, und der Rechtsstand ist das Datum des Registers', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  assert.deepEqual(ids(s), [])
  assert.equal(s.legalBasis.asOf, LAW_AS_OF)
})

test('Rechtswerte: Heizung nach Fläche friert 50 bis 70 % und 15 % ein, mit Fundstelle und Text', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, { category: 'Heizung und Warmwasser', description: 'Heizöl' })] }))
  // Die Fernablesbarkeit gilt erst ab 2027 und steht deshalb nicht dabei (Durchsicht von #221, I1).
  // Ab 2023 nennt die Abrechnung ohne Heizanlage die CO₂-Kürzung (Heizung PR 6, co2.fuel-unknown).
  assert.deepEqual(ids(s), ['co2.applicable-from', 'co2.cut.missing', 'hkv.consumption-share', 'hkv.cut.not-by-consumption'])
  const cut = s.legalBasis.values.find((v) => v.id === 'hkv.cut.not-by-consumption')
  assert.deepEqual(cut, {
    id: 'hkv.cut.not-by-consumption',
    title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung',
    norm: '§ 12 Abs. 1 Satz 1 HeizkostenV',
    cite: '§ 12 Abs. 1 Satz 1 HeizkostenV',
    value: 15,
    text: '15 %',
  })
})

test('Rechtswerte: Kabel 2024 und 2025 frieren die Kabelregel ein, auch wenn sie nicht mehr gilt', () => {
  for (const year of [2024, 2025]) {
    const s = computeSettlement(snap(year, { ...two, costItems: [item(year, { category: 'Kabel/Antenne', key: 'units' })] }))
    assert.deepEqual(ids(s), ['betrkv.tv-signal'], String(year))
    assert.equal(s.legalBasis.values.find((v) => v.id === 'betrkv.tv-signal')?.validTo, '2024-06-30')
  }
})

test('Rechtswerte: Messdienst 2023 und 2026 ohne Fernablesungshinweis frieren nur die CO₂-Kürzung ein, 2027 dazu den Zeitpunkt und die 3 %', () => {
  const heat = (year: number) => item(year, { category: 'Heizung und Warmwasser', key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })
  // Ein Wert, der im Zeitraum nicht gilt, ist kein angewandter Rechtswert (Durchsicht von #221, I1).
  // Ab 2023 nennt die Abrechnung ohne Heizanlage die CO₂-Kürzung (Heizung PR 6, co2.fuel-unknown).
  const co2 = ['co2.applicable-from', 'co2.cut.missing']
  assert.deepEqual(ids(computeSettlement(snap(2023, { ...two, costItems: [heat(2023)] }))), co2)
  assert.deepEqual(ids(computeSettlement(snap(2026, { ...two, costItems: [heat(2026)] }))), co2)
  assert.deepEqual(ids(computeSettlement(snap(2027, { ...two, costItems: [heat(2027)] }))), [...co2, 'hkv.cut.remote-reading', 'hkv.remote-reading.retrofit'])
})

test('Rechtswerte: Leerstand beim Personenschlüssel friert die eine Person ein, ohne Leerstand nicht', () => {
  const muell = item(2025, { category: 'Müllabfuhr', key: 'persons' })
  const leer = computeSettlement(snap(2025, { units: two.units, tenancies: [tenancy('A', 'w1')], costItems: [muell] }))
  assert.deepEqual(ids(leer), ['practice.vacancy-persons'])
  assert.equal(leer.legalBasis.values.find((v) => v.id === 'practice.vacancy-persons')?.text, '1 Person je Leerstandstag')
  assert.deepEqual(ids(computeSettlement(snap(2025, { ...two, costItems: [muell] }))), [])
})

test('Rechtswerte: jedes Jahr rechnet, auch weit vor und nach den Fassungen des Registers', () => {
  // Fehlt eine Fassung, wirft das Register; eine Abrechnung darf daran nicht scheitern.
  for (const year of [1990, 2021, 2024, 2027, 2100]) {
    const s = computeSettlement(snap(year, {
      units: two.units,
      tenancies: [tenancy('A', 'w1', { start: '1980-01-01', personHistory: [{ from: '1980-01-01', persons: 1 }] })],
      costItems: [
        item(year, { id: 'h', category: 'Heizung und Warmwasser' }),
        item(year, { id: 'k', category: 'Kabel/Antenne', key: 'units' }),
        item(year, { id: 'm', category: 'Müllabfuhr', key: 'persons' }),
      ],
    }, { kind: 'mfh', cableBuiltBeforeDec2021: false }))
    assert.ok(ids(s).length >= 4, `${year}: ${ids(s).join(', ')}`)
  }
})

test('Rechtswerte: zwei Abrechnungen nacheinander teilen kein Protokoll', () => {
  const heat = computeSettlement(snap(2025, { ...two, costItems: [item(2025, { category: 'Heizung und Warmwasser' })] }))
  const plain = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  assert.ok(ids(heat).length > 0)
  assert.deepEqual(ids(plain), [])
})

test('Rechtswerte: Frist und Höchstdauer des Zeitraums frieren in jeder Abrechnung ein (#208)', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  const bgb = s.legalBasis.values.filter((v) => v.id.startsWith('bgb.')).map((v) => [v.id, v.value])
  assert.deepEqual(bgb.sort(), [['bgb.deadline-months', 12], ['bgb.max-period-months', 12]])
  assert.equal(s.deadline, '2026-12-31')
})

test.todo('Eintrag des Vermieters: die Abrechnung nennt ihn als Hinweis und im Rechtsstand (Heizung PR 17)')
