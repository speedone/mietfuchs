import { describe, expect, test } from 'vitest'
import { calendarPeriod } from '../../shared/period.ts'
import type { CostItem, MeterType, Tenancy, Unit } from './types'
import { usageOf } from './types'
import { EMPTY_UNIT_FORM, buildUnitBody, connectionSummary, connectionTypes, setConnected, unitDeleteMessage, unitToForm, zeroAreaUnits, missingAreaCheck, type UnitForm } from './unitForm'

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

describe('Cockpit: Wohnungen mit 0 m² (#135)', () => {
  // Ob eine Einheit Garage-artig ist, entscheidet der Server (`garageLikeUnitIds` der Abrechnung,
  // isGarageLike in calc.ts); das Cockpit übernimmt es, damit es keine zweite Regel gibt.
  const u = (name: string, areaM2: number, over: Partial<Unit> = {}): Unit => ({ id: name, propertyId: 'p', name, areaM2, participates: true, ...over })
  const units = [u('EG', 80), u('Garage', 0), u('OG', 0), u('Lager', 0, { participates: false })]
  test('Garage 0 m² mit Inklusivmiete und 0 Personen: laut Server Garage-artig, also grün', () => {
    expect(zeroAreaUnits(units, ['Garage'])).toEqual({ zero: [units[1]], missing: [units[2]] })
  })
  test('eine vor #135 abgeschlossene Abrechnung kennt die Einstufung nicht: jede 0 m² gilt als fehlend', () => {
    expect(zeroAreaUnits(units, undefined).missing.map((x) => x.name)).toEqual(['Garage', 'OG'])
  })
})

// #142: Die Löschfrage nannte nur die Mietverhältnisse; mit der Wohnung gehen auch Zähler,
// Ablesungen, Zahlungen und ihre Anteile an Kostenpositionen.
describe('Löschfrage einer Wohnung', () => {
  const none = { tenancies: 0, meters: 0, readings: 0, payments: 0, costItemLinks: 0, directCostItems: 0 }

  test('nennt alles, was mitgelöscht wird, mit Anzahl', () => {
    expect(unitDeleteMessage({ tenancies: 2, meters: 1, readings: 5, payments: 24, costItemLinks: 3, directCostItems: 0 })).toBe(
      'Mit der Wohnung werden gelöscht: 2 Mietverhältnisse, 1 Zähler, 5 Ablesungen, 24 Zahlungen und 3 Angaben an Kostenpositionen ' +
        '(vereinbarte Anteile, Teilnahmen, Einzelbeträge). Das lässt sich nicht rückgängig machen.',
    )
  })

  test('Einzahl, und was nicht da ist, steht nicht da', () => {
    expect(unitDeleteMessage({ ...none, tenancies: 1, payments: 1 })).toBe(
      'Mit der Wohnung werden gelöscht: 1 Mietverhältnis und 1 Zahlung. Das lässt sich nicht rückgängig machen.',
    )
    expect(unitDeleteMessage(none)).toBe('An der Wohnung hängt nichts weiter. Das lässt sich nicht rückgängig machen.')
  })

  test('direkt zugeordnete Rechnungen bleiben und gehen an den Vermieter', () => {
    expect(unitDeleteMessage({ ...none, directCostItems: 2 })).toBe(
      'An der Wohnung hängt nichts weiter. 2 direkt zugeordnete Kostenpositionen bleiben erhalten; ihren Betrag trägt danach der Vermieter. ' +
        'Das lässt sich nicht rückgängig machen.',
    )
  })

  test('ohne Zählung (Server nicht erreichbar) die vollständige Liste ohne Zahlen', () => {
    expect(unitDeleteMessage(null)).toBe(
      'Mit der Wohnung werden auch ihre Mietverhältnisse, Zähler, Ablesungen und Zahlungen gelöscht, dazu ihre Anteile an ' +
        'Kostenpositionen. Das lässt sich nicht rückgängig machen.',
    )
  })
})

// Anschlüsse einer Einheit, positiv gefragt (#142): angehakt heißt angeschlossen, gespeichert wird
// unverändert nur die Ausnahme in `noConnection`.
describe('Anschlüsse einer Einheit', () => {
  test('angeboten werden nur die Zählerarten des Objekts, dazu jede schon gesetzte Ausnahme', () => {
    const m = (type: MeterType, unitId: string | null = 'u1') => ({ type, unitId })
    expect(connectionTypes([], [])).toEqual([])
    expect(connectionTypes([m('kaltwasser'), m('kaltwasser')], [])).toEqual(['kaltwasser'])
    expect(connectionTypes([m('kaltwasser')], ['waerme'])).toEqual(['kaltwasser', 'waerme'])
    expect(connectionTypes([m('sonstig'), m('waerme'), m('kaltwasser', null)], [])).toEqual(['kaltwasser', 'waerme', 'sonstig'])
    // Strom nur mit einem Stromzähler an einer Einheit; der Allgemeinstrom (Hauptzähler) gehört dem Haus.
    expect(connectionTypes([m('strom', null)], [])).toEqual([])
    expect(connectionTypes([m('strom', null)], ['strom'])).toEqual(['strom'])
    expect(connectionTypes([m('strom', 'u1')], [])).toEqual(['strom'])
  })

  test('Häkchen entfernen setzt genau diese Ausnahme, Häkchen setzen nimmt sie zurück', () => {
    const f = { ...EMPTY_UNIT_FORM, name: 'Garage', areaM2: '15' }
    const ohneWasser = setConnected(f, 'kaltwasser', false)
    expect(ohneWasser.noConnection).toEqual(['kaltwasser'])
    expect(setConnected(ohneWasser, 'kaltwasser', false).noConnection).toEqual(['kaltwasser'])
    expect(setConnected(ohneWasser, 'kaltwasser', true).noConnection).toEqual([])
  })

  test('die Zusammenfassung nennt eine Ausnahme, sonst nichts', () => {
    expect(connectionSummary([])).toBe('')
    expect(connectionSummary(['kaltwasser'])).toBe('ohne Wasseranschluss')
    expect(connectionSummary(['kaltwasser', 'waerme'])).toBe('ohne Wasser- und Wärmeanschluss')
    expect(connectionSummary(['sonstig'])).toBe('ohne Anschluss für Sonstiges')
  })

  test('Warmwasser ist ein eigener Anschluss, Heizkostenverteiler sind keiner (Heizung PR 4)', () => {
    const m = (type: MeterType, unitId: string | null = 'u1') => ({ type, unitId })
    expect(connectionTypes([m('warmwasser'), m('kaltwasser'), m('hkv')], [])).toEqual(['kaltwasser', 'warmwasser'])
    expect(connectionSummary(['warmwasser'])).toBe('ohne Warmwasseranschluss')
  })
})

describe('Cockpit: fehlende Fläche oder leere Einheit mit 0 m² (Endprüfung rc.4)', () => {
  // Eine leere Einheit mit 0 m² kann eine Garage sein. „Wohnfläche ergänzen“ als Befehl machte sie
  // beim Personenschlüssel zum Leerstand (#177), und der Vermieter trüge mehr. Deshalb eine Frage.
  const u = (name: string, over: Partial<Unit> = {}): Unit => ({ id: name, propertyId: 'p', name, areaM2: 0, participates: true, ...over })
  const t = (unitId: string, start: string, end: string | null): Tenancy => ({
    id: `t-${unitId}`, unitId, tenantName: 'M', persons: 2, personHistory: [{ from: start, persons: 2 }], start, end,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  })
  test('leere Einheit ohne Mietverhältnis im Jahr: eine bedingte Frage, kein Befehl', () => {
    expect(missingAreaCheck([u('G')], [t('G', '2020-01-01', '2024-12-31')], 2025)).toEqual({
      cta: 'Fläche prüfen',
      detail: 'G hat 0 m² und im Jahr keine Bewohner. Ist G eine Wohnung, tragen Sie die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².',
    })
  })
  test('mehrere leere Einheiten', () => {
    expect(missingAreaCheck([u('G1'), u('G2')], [], 2025).detail).toBe(
      'G1 und G2 haben 0 m² und im Jahr keine Bewohner. Ist eine davon eine Wohnung, tragen Sie dort die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².')
  })
  test('bewohnte Einheit mit 0 m²: der bisherige eindeutige Text', () => {
    expect(missingAreaCheck([u('OG')], [t('OG', '2025-07-01', null)], 2025)).toEqual({ cta: 'Wohnfläche ergänzen', detail: 'Wohnfläche fehlt bei: OG' })
  })
  test('selbstgenutzt mit eigenen Personen gilt als bewohnt', () => {
    expect(missingAreaCheck([u('EG', { participates: false, selfUsed: true, selfPersons: 2 })], [], 2025).detail).toBe('Wohnfläche fehlt bei: EG')
  })
  test('selbstgenutzt ohne Personenzahl: der Befehl, wie der Server (keine Garage)', () => {
    expect(missingAreaCheck([u('EG', { participates: false, selfUsed: true })], [], 2025).detail).toBe('Wohnfläche fehlt bei: EG')
    expect(missingAreaCheck([u('EG', { participates: false, selfUsed: true, selfPersons: undefined })], [], 2025).cta).toBe('Wohnfläche ergänzen')
  })
  test('mit einer Position nach Fläche: der Hinweis der Abrechnung wird angekündigt', () => {
    const flaeche = (over: Partial<CostItem> = {}): CostItem => ({ id: 'c', propertyId: 'p', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 1000, key: 'area', ...over })
    const satz = 'G hat 0 m² und im Jahr keine Bewohner. Ist G eine Wohnung, tragen Sie die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².'
    expect(missingAreaCheck([u('G')], [], 2025, [flaeche()]).detail).toBe(`${satz} Bei Positionen nach Wohnfläche weist die Abrechnung trotzdem darauf hin.`)
    // Nicht bei anderem Schlüssel, nicht umlagefähig oder ohne G als Teilnehmer
    expect(missingAreaCheck([u('G')], [], 2025, [flaeche({ key: 'persons' })]).detail).toBe(satz)
    expect(missingAreaCheck([u('G')], [], 2025, [flaeche({ category: 'Nicht umlagefähig' })]).detail).toBe(satz)
    expect(missingAreaCheck([u('G')], [], 2025, [flaeche({ participantUnitIds: ['EG'] })]).detail).toBe(satz)
  })
  test('beides zugleich: der Befehl für die bewohnte, die Frage für die leere', () => {
    expect(missingAreaCheck([u('OG'), u('G')], [t('OG', '2020-01-01', null)], 2025)).toEqual({
      cta: 'Wohnfläche ergänzen',
      detail: 'Wohnfläche fehlt bei: OG. G hat 0 m² und im Jahr keine Bewohner. Ist G eine Wohnung, tragen Sie die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².',
    })
  })
})
