// Formularlogik des Seitenfensters „Mieterhöhung“ (#191, PR 2): Vorgaben, Rumpf der Rechnung, Meldungen, Zustand als Wort.
import { describe, expect, it } from 'vitest'
import type { Property, Tenancy, Unit } from './types'
import { RENT_INCREASE_STATE_LABELS, rentCapOptions, rentIncreaseKindOptions, rentIncreaseRequest, rentIncreaseStart, type RentIncreaseValue } from './rentIncreaseForm'

const tenancy = (over: Partial<Tenancy> = {}): Tenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Becker', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {},
  baseRents: [{ from: '2020-01', monthlyCents: 50000 }], rentKind: 'free', rentIncreaseExcluded: false, ...over,
})
const unit: Pick<Unit, 'areaM2'> = { areaM2: 61.5 }
const property: Pick<Property, 'rentCapReduced'> = { rentCapReduced: false }

describe('Mieterhöhung: Vorgaben', () => {
  it('nimmt Art nach der Miete, Kappungsgrenze vom Objekt und Fläche der Wohnung', () => {
    const v = rentIncreaseStart(tenancy(), unit, property)
    expect(v.kind).toBe('comparison')
    expect(v.rentCap).toBe('no')
    expect(v.area).toBe('61,5')
    expect(v.receivedOn).toBe('')
    expect(rentIncreaseStart(tenancy({ rentKind: 'index' }), unit, property).kind).toBe('index')
    expect(rentIncreaseStart(tenancy(), unit, { rentCapReduced: null }).rentCap).toBe('unknown')
    expect(rentIncreaseStart(tenancy(), unit, null).rentCap).toBe('unknown')
  })
  it('Auswahllisten enthalten jeden möglichen Wert', () => {
    expect(rentCapOptions().map((o) => o.value)).toEqual(['yes', 'no', 'unknown'])
    expect(rentIncreaseKindOptions().map((o) => o.value)).toEqual(['comparison', 'index'])
    expect(RENT_INCREASE_STATE_LABELS).toEqual({ possible: 'Möglich', notYet: 'Noch nicht möglich', blocked: 'Nicht möglich' })
  })
})

describe('Mieterhöhung: Rumpf der Rechnung', () => {
  const start = (over: Partial<RentIncreaseValue> = {}): RentIncreaseValue => ({ ...rentIncreaseStart(tenancy(), unit, property), ...over })
  it('liest Beträge, Monat und Fläche in deutscher Schreibweise; leer heißt Vorgabe', () => {
    const r = rentIncreaseRequest(start({ comparison: '9,05', rangeHigh: '9,50', requested: '1.050,00', effectiveFrom: '3.2027', receivedOn: '2026-11-20', allStepsEntered: true }))
    expect('body' in r && r.body).toEqual({
      kind: 'comparison', receivedOn: '2026-11-20', effectiveFrom: '2027-03', allStepsEntered: true, residential: false, noThirdPartyFunds: false,
      rentCap: 'no', comparisonCentsPerM2: 905, rangeHighCentsPerM2: 950, areaM2: 61.5, requestedCents: 105000,
    })
  })
  it('meldet unlesbare Angaben am Feld', () => {
    const r = rentIncreaseRequest(start({ comparison: 'neun', area: '0', effectiveFrom: '13.2027' }))
    expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['effectiveFrom', 'comparison', 'area'])
  })
  it('Indexmiete: Monat, Wert mit höchstens einer Nachkommastelle, Basis leer heißt aktuelle Reihe', () => {
    const r = rentIncreaseRequest(start({ kind: 'index', toMonth: '10.2026', toValue: '106,1', toBase: '' }))
    expect('body' in r && r.body.toIndex).toEqual({ month: '2026-10', value: 106.1, base: 2020 })
    expect('body' in r && r.body.fromIndex).toBeUndefined()
    const bad = rentIncreaseRequest(start({ kind: 'index', toMonth: '10.2026', toValue: '106,15' }))
    expect('problems' in bad && bad.problems.map((p) => p.field)).toEqual(['toValue'])
    const half = rentIncreaseRequest(start({ kind: 'index', fromMonth: '12.2014' }))
    expect('problems' in half && half.problems.map((p) => p.field)).toEqual(['fromValue'])
  })
})
