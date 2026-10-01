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
      const u: Unit = { id: 'u1', propertyId: 'objekt-1', name: 'W', areaM2: 80, participates: false, ...extra }
      const f = unitToForm(u)
      expect(f.usage).toBe(expected)
      const b = body(f)
      expect(usageOf({ participates: b.participates as boolean, selfUsed: b.selfUsed as boolean })).toBe(expected)
    }
  })

  test('Altbestand ohne selfUsed gilt als nicht beteiligt, nicht als Eigennutzung', () => {
    // Wichtig für die Migration: die Nutzungsart darf sich nicht von selbst ändern.
    expect(unitToForm({ id: 'u1', propertyId: 'objekt-1', name: 'W', areaM2: 80, participates: false }).usage).toBe('ausgenommen')
  })

  test('deutsche Dezimaltrennung bleibt erhalten', () => {
    const f = unitToForm({ id: 'u1', propertyId: 'objekt-1', name: 'W', areaM2: 80.5, participates: true, rooms: 2.5 })
    expect(f.areaM2).toBe('80,5')
    expect(f.rooms).toBe('2,5')
    expect(body(f).areaM2).toBe(80.5)
  })
})

describe('Validierung', () => {
  test('Name und Wohnfläche sind Pflicht', () => {
    expect(buildUnitBody(form({ name: ' ' }))).toHaveProperty('error')
    expect(buildUnitBody(form({ areaM2: '' }))).toHaveProperty('error') // 0 m² ist seit #135 erlaubt, leer nicht
    expect(buildUnitBody(form({ areaM2: 'viel' }))).toHaveProperty('error')
  })

  test('negative Personenzahl wird abgelehnt', () => {
    expect(buildUnitBody(form({ usage: 'eigen', selfPersons: '-2' }))).toHaveProperty('error')
  })

  test('leere Personenzahl ist erlaubt', () => {
    expect(body(form({ usage: 'eigen', selfPersons: '' })).selfPersons).toBeNull()
  })
})

describe('Miteigentumsanteile (#94)', () => {
  test('werden übernommen, geleert und geprüft', () => {
    const base = { ...EMPTY_UNIT_FORM, name: 'ETW', areaM2: '62' }
    expect(buildUnitBody({ ...base, mea: '124' })).toMatchObject({ body: { mea: 124 } })
    expect(buildUnitBody({ ...base, mea: '' })).toMatchObject({ body: { mea: null } })
    expect(buildUnitBody({ ...base, mea: 'viele' })).toHaveProperty('error')
    expect(unitToForm({ id: 'u', propertyId: 'objekt-1', name: 'ETW', areaM2: 62, participates: true, mea: 124.5 }).mea).toBe('124,5')
  })
})

describe('Zahlen in deutscher und technischer Schreibweise (#105)', () => {
  const base = { ...EMPTY_UNIT_FORM, name: 'ETW', areaM2: '62' }
  test('Miteigentumsanteile „78.43“ sind 78,43 und nicht 7843', () => {
    expect(buildUnitBody({ ...base, mea: '78.43' })).toMatchObject({ body: { mea: 78.43 } })
    expect(buildUnitBody({ ...base, mea: '78,43' })).toMatchObject({ body: { mea: 78.43 } })
    expect(buildUnitBody({ ...base, mea: '1.000' })).toMatchObject({ body: { mea: 1000 } })
    expect(buildUnitBody({ ...base, mea: '1.000,5' })).toMatchObject({ body: { mea: 1000.5 } })
  })
  test('Wohnfläche „1.200“ sind tausendzweihundert und nicht 1,2', () => {
    expect(buildUnitBody({ ...base, areaM2: '1.200' })).toMatchObject({ body: { areaM2: 1200 } })
    expect(buildUnitBody({ ...base, areaM2: '62.5' })).toMatchObject({ body: { areaM2: 62.5 } })
    expect(buildUnitBody({ ...base, areaM2: '62,55' })).toMatchObject({ body: { areaM2: 62.55 } })
  })
})

describe('Zahlen: falsch gesetzte Punkte neben einem Komma sind kein Wert (Durchsicht zu #105)', () => {
  const base = { ...EMPTY_UNIT_FORM, name: 'ETW', areaM2: '62' }
  test('„78.43,5“ und „1,234.56“ werden abgelehnt statt still falsch gelesen', () => {
    expect(buildUnitBody({ ...base, mea: '78.43,5' })).toHaveProperty('error')
    expect(buildUnitBody({ ...base, mea: '1,234.56' })).toHaveProperty('error')
    expect(buildUnitBody({ ...base, mea: '1.234,56' })).toMatchObject({ body: { mea: 1234.56 } })
  })
})

describe('Einheit ohne Anschluss (#117)', () => {
  test('die angehakten Zählertypen gehen in den Rumpf und kommen aus der Wohnung zurück', () => {
    const base = { ...EMPTY_UNIT_FORM, name: 'Garage', areaM2: '15' }
    expect(buildUnitBody({ ...base, noConnection: ['kaltwasser'] })).toMatchObject({ body: { noConnection: ['kaltwasser'] } })
    expect(buildUnitBody(base)).toMatchObject({ body: { noConnection: [] } })
    expect(unitToForm({ id: 'g', propertyId: 'objekt-1', name: 'Garage', areaM2: 15, participates: true, noConnection: ['strom'] }).noConnection).toEqual(['strom'])
  })
})

describe('Wohnfläche 0 m² für Garage, Stellplatz oder Lager (#135)', () => {
  test('0 m² ist erlaubt und wird als 0 gespeichert', () => {
    expect(body(form({ name: 'Garage', areaM2: '0' })).areaM2).toBe(0)
  })

  test('negative Fläche bleibt verboten', () => {
    expect(buildUnitBody(form({ areaM2: '-5' }))).toHaveProperty('error')
  })

  test('eine leere Fläche bleibt verboten, sie ist keine Angabe von 0 m²', () => {
    expect(buildUnitBody(form({ areaM2: '' }))).toHaveProperty('error')
    expect(buildUnitBody(form({ areaM2: 'abc' }))).toHaveProperty('error')
  })
})
