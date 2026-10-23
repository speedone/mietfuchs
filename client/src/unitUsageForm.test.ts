// Nutzungswechsel im Wohnungsformular (#259).
import { describe, expect, test } from 'vitest'
import type { Unit } from './types'
import { EMPTY_UNIT_FORM, buildUnitBody, unitToForm, type UnitForm } from './unitForm'

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
