import { describe, expect, test } from 'vitest'
import type { Unit } from './types'
import { usageOf } from './types'
import { EMPTY_UNIT_FORM, buildUnitBody, unitToForm, type UnitForm } from './unitForm'

const form = (patch: Partial<UnitForm> = {}): UnitForm => ({
  ...EMPTY_UNIT_FORM, name: 'EG', areaM2: '80', ...patch,
})
const body = (f: UnitForm) => (buildUnitBody(f) as { body: Record<string, unknown> }).body

describe('Nutzungsart schreibt beide Kennzeichen', () => {
  // Widersprüchliche Kombinationen (vermietet und selbstgenutzt) kann die Engine nur
  // abfangen, nicht auflösen — das Formular darf sie gar nicht erst erzeugen.
  test('vermietet', () => {
    expect(body(form({ usage: 'vermietet' }))).toMatchObject({ participates: true, selfUsed: false, selfPersons: null })
  })

  test('Eigennutzung mit Personenzahl', () => {
    expect(body(form({ usage: 'eigen', selfPersons: '2' }))).toMatchObject({ participates: false, selfUsed: true, selfPersons: 2 })
  })

  test('nicht beteiligt', () => {
    expect(body(form({ usage: 'ausgenommen' }))).toMatchObject({ participates: false, selfUsed: false })
  })

  test('die Personenzahl wird verworfen, wenn die Wohnung nicht selbstgenutzt ist', () => {
    expect(body(form({ usage: 'vermietet', selfPersons: '3' })).selfPersons).toBeNull()
  })
})

describe('Rundlauf mit dem Datenmodell', () => {
  const cases: [string, Partial<Unit>][] = [
    ['vermietet', { participates: true }],
    ['eigen', { participates: false, selfUsed: true, selfPersons: 2 }],
    ['ausgenommen', { participates: false }],
  ]

  test('Wohnung → Formular → Rumpf erhält die Nutzungsart', () => {
    for (const [expected, extra] of cases) {
      const u: Unit = { id: 'u1', name: 'W', areaM2: 80, participates: false, ...extra }
      const f = unitToForm(u)
      expect(f.usage).toBe(expected)
      const b = body(f)
      expect(usageOf({ participates: b.participates as boolean, selfUsed: b.selfUsed as boolean })).toBe(expected)
    }
  })

  test('Altbestand ohne selfUsed gilt als nicht beteiligt, nicht als Eigennutzung', () => {
    // Wichtig für die Migration: die Nutzungsart darf sich nicht von selbst ändern.
    expect(unitToForm({ id: 'u1', name: 'W', areaM2: 80, participates: false }).usage).toBe('ausgenommen')
  })

  test('deutsche Dezimaltrennung bleibt erhalten', () => {
    const f = unitToForm({ id: 'u1', name: 'W', areaM2: 80.5, participates: true, rooms: 2.5 })
    expect(f.areaM2).toBe('80,5')
    expect(f.rooms).toBe('2,5')
    expect(body(f).areaM2).toBe(80.5)
  })
})

describe('Validierung', () => {
  test('Name und Wohnfläche sind Pflicht', () => {
    expect(buildUnitBody(form({ name: ' ' }))).toHaveProperty('error')
    expect(buildUnitBody(form({ areaM2: '0' }))).toHaveProperty('error')
    expect(buildUnitBody(form({ areaM2: 'viel' }))).toHaveProperty('error')
  })

  test('negative Personenzahl wird abgelehnt', () => {
    expect(buildUnitBody(form({ usage: 'eigen', selfPersons: '-2' }))).toHaveProperty('error')
  })

  test('leere Personenzahl ist erlaubt', () => {
    expect(body(form({ usage: 'eigen', selfPersons: '' })).selfPersons).toBeNull()
  })
})
