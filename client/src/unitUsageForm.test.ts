// Nutzungswechsel im Wohnungsformular (#259).
import { describe, expect, test } from 'vitest'
import type { BillingPeriod, Meter, Tenancy, Unit } from './types'
import { EMPTY_UNIT_FORM, buildUnitBody, unitToForm, type UnitForm } from './unitForm'
import { EMPTY_ITEM_FORM, suggestedKey, tenanciesForAmounts } from './costForm'
import { contractTenancies } from './contractAgreement'
import { defaultTenancyUnitId } from './tenancyModel'

const form = (patch: Partial<UnitForm> = {}): UnitForm => ({
  ...EMPTY_UNIT_FORM, name: 'EG', areaM2: '80', ...patch,
})
const body = (f: UnitForm): Record<string, unknown> => {
  const r = buildUnitBody(f)
  if (!('body' in r)) throw new Error(`Unerwartete Meldungen: ${JSON.stringify(r.problems)}`)
  return r.body
}

describe('Nutzungswechsel (#259)', () => {
  test('wird nach Datum gesendet, und die eigenen Personen bleiben, wenn eine Stufe Eigennutzung ist', () => {
    expect(body(form({ usage: 'vermietet', selfPersons: '2', usageChanges: [{ from: '2026-01-01', usage: 'ausgenommen' }, { from: '2025-07-01', usage: 'eigen' }] }))).toMatchObject({
      participates: true, selfUsed: false, selfPersons: 2,
      usageChanges: [{ from: '2025-07-01', usage: 'eigen' }, { from: '2026-01-01', usage: 'ausgenommen' }],
    })
    expect(body(form({}))).toMatchObject({ usageChanges: [] })
  })

  test('meldet ein fehlendes Datum und einen doppelten Tag je Zeile', () => {
    const r = buildUnitBody(form({ usageChanges: [{ from: '', usage: 'eigen' }, { from: '2025-07-01', usage: 'eigen' }, { from: '2025-07-01', usage: 'ausgenommen' }] }))
    const problems = 'problems' in r ? r.problems : []
    expect(problems.map((x) => [x.field, x.short])).toEqual([
      ['usageChange.0', 'Datum fehlt'], ['usageChange.2', 'Tag doppelt'],
    ])
  })

  test('kommt aus der Einheit ins Formular', () => {
    const u: Unit = { id: 'u', propertyId: 'p', name: 'EG', areaM2: 80, participates: false, selfUsed: true, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] }
    expect(unitToForm(u).usageChanges).toEqual([{ from: '2025-07-01', usage: 'vermietet' }])
  })
})

// Durchsicht von #423 (Daten/Oberfläche): Die Fragen „vermietet im Zeitraum“ und „selbstgenutzt“ lesen die Staffel.
describe('Nutzungswechsel in den Formularen', () => {
  const PERIOD = { key: '2025-01', from: '2025-01-01', to: '2025-12-31' } as unknown as BillingPeriod
  const spaeter: Unit = { id: 'b', propertyId: 'p', name: 'OG', areaM2: 50, participates: false, selfUsed: true, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] }
  const frueher: Unit = { id: 'c', propertyId: 'p', name: 'DG', areaM2: 50, participates: true, usageChanges: [{ from: '2024-01-01', usage: 'eigen' }] }
  const tenancy = (id: string, unitId: string, start: string): Tenancy => ({ id, unitId, tenantName: id, persons: 1, personHistory: [], start, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
  const T = [tenancy('t-b', 'b', '2025-07-01'), tenancy('t-c', 'c', '2025-01-01')]

  test('Einzelbeträge: der Mieter einer erst später vermieteten Wohnung ist dabei, einer in einer selbstgenutzten nicht', () => {
    expect(tenanciesForAmounts(T, [spaeter, frueher], PERIOD).map((t) => t.id)).toEqual(['t-b'])
  })

  test('Umlagevereinbarung: dieselbe Frage', () => {
    expect(contractTenancies({ ...EMPTY_ITEM_FORM, category: 'Aufzug', description: 'Aufzug', amount: '1' }, [spaeter, frueher], T, PERIOD).map((r) => r.tenancyId)).toEqual(['t-b'])
  })

  test('Vorschlag des Schlüssels: eine heute selbstgenutzte Wohnung ohne Zähler steht dem Verbrauch nicht im Weg', () => {
    const meters: Meter[] = [{ id: 'm', propertyId: 'p', name: 'm', unitId: 'b', type: 'kaltwasser', unit: 'm³' } as unknown as Meter]
    expect(suggestedKey('Wasser/Abwasser', [spaeter, frueher], meters, PERIOD).key).toBe('meter')
  })

  test('neues Mietverhältnis: vorgeschlagen wird eine heute vermietete Wohnung ohne Mieter', () => {
    expect(defaultTenancyUnitId([frueher, spaeter], [], '2025-08-01')).toBe('b')
  })
})

test('ein Wechsel auf dieselbe Nutzung wie davor wird gemeldet', () => {
  const r = buildUnitBody(form({ usage: 'eigen', usageChanges: [{ from: '2025-07-01', usage: 'eigen' }, { from: '2025-09-01', usage: 'vermietet' }, { from: '2025-03-01', usage: 'eigen' }] }))
  const problems = 'problems' in r ? r.problems : []
  expect(problems.map((x) => [x.field, x.short])).toEqual([['usageChange.0', 'Keine Änderung'], ['usageChange.2', 'Keine Änderung']])
})
