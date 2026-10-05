// Nebenkostenmodell am Mietverhältnis (#93), die Seite der Oberfläche.
import { expect, test } from 'vitest'
import { COST_MODEL_LABELS, buildPersonHistory, costModelBadge, costModelBody, defaultTenancyUnitId, notSettledText, overlapQuestion, parsePersons, prepaymentColumn, showsFlatRates } from './tenancyModel'
import type { Tenancy, Unit } from './types'

test('die Staffel der Pauschale erscheint nur bei einer Pauschale', () => {
  expect(showsFlatRates('flatRate', 'settlement')).toBe(true)
  expect(showsFlatRates('settlement', 'flatRate')).toBe(true)
  expect(showsFlatRates('inclusive', undefined)).toBe(false)
})

test('„Abrechnung“ wird als null gespeichert, damit ohne Angabe dasselbe gilt wie vorher', () => {
  expect(costModelBody('settlement', 'inclusive')).toEqual({ costModel: null, heatingModel: 'inclusive' })
})

test('der Hinweis „Ohne Abrechnung“ nennt das Modell in Worten', () => {
  expect(notSettledText({ tenancyId: 't', tenantName: 'Jonas Schulz', unitName: 'OG', costModel: 'flatRate', heatingModel: 'settlement' }))
    .toBe('Jonas Schulz (OG): Nebenkosten als Pauschale')
  expect(notSettledText({ tenancyId: 't', tenantName: 'A', unitName: 'EG', costModel: 'inclusive', heatingModel: 'inclusive' }))
    .toBe('A (EG): Nebenkosten in der Miete enthalten, Heizung in der Miete enthalten')
  expect(Object.keys(COST_MODEL_LABELS)).toEqual(['settlement', 'flatRate', 'inclusive'])
})

// #135: Eine vermietete Garage hat keine Bewohner. 0 Personen muss gehen, sonst steht sie mit einer
// erfundenen Person in der Verteilbasis des Personenschlüssels.
test('Personenzahl: 0 und ganze Zahlen sind erlaubt, negativ, gebrochen und leer nicht', () => {
  expect(parsePersons('0')).toBe(0)
  expect(parsePersons('3')).toBe(3)
  expect(parsePersons(' 2 ')).toBe(2)
  expect(parsePersons('')).toBeNull()
  expect(parsePersons('  ')).toBeNull()
  expect(parsePersons('-1')).toBeNull()
  expect(parsePersons('1,5')).toBeNull()
  expect(parsePersons('1.5')).toBeNull()
  expect(parsePersons('zwei')).toBeNull()
})

test('Personen-Staffel: 0 Personen wird übernommen, die erste Zeile ohne Datum gilt ab Einzug', () => {
  expect(buildPersonHistory([{ from: '', persons: '0' }], '2025-03-01')).toEqual({ personHistory: [{ from: '2025-03-01', persons: 0 }] })
})

test('Personen-Staffel: die Meldung nennt, was erlaubt ist', () => {
  const result = buildPersonHistory([{ from: '', persons: '-1' }], '2025-03-01')
  if (!('error' in result)) return expect.fail('negative Personenzahl angenommen')
  expect(result.error).toMatch(/0/)
  expect(result.error).toMatch(/ganze Zahl/)
})

test('Personen-Staffel: sortiert nach Datum, eine spätere Zeile ohne Datum ist ein Fehler', () => {
  expect(buildPersonHistory([{ from: '2025-07-01', persons: '1' }, { from: '2025-01-01', persons: '2' }], '2025-01-01'))
    .toEqual({ personHistory: [{ from: '2025-01-01', persons: 2 }, { from: '2025-07-01', persons: 1 }] })
  expect(buildPersonHistory([{ from: '', persons: '1' }, { from: '', persons: '2' }], '2025-01-01')).toHaveProperty('error')
  expect(buildPersonHistory([], '2025-01-01')).toHaveProperty('error')
})

test('neues Mietverhältnis: vorgewählt wird die erste vermietbare Wohnung ohne laufendes Mietverhältnis (#142)', () => {
  const units: Unit[] = [
    { id: 'eigen', propertyId: 'p', name: 'EG', areaM2: 80, participates: false, selfUsed: true },
    { id: 'belegt', propertyId: 'p', name: 'OG', areaM2: 60, participates: true },
    { id: 'frei', propertyId: 'p', name: 'DG', areaM2: 40, participates: true },
  ]
  const ten = (unitId: string, end: string | null): Tenancy => ({ id: unitId, unitId, tenantName: 'X', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
  const heute = '2026-10-01'
  expect(defaultTenancyUnitId(units, [ten('belegt', null)], heute)).toBe('frei')
  // ein beendetes Mietverhältnis belegt die Wohnung nicht mehr
  expect(defaultTenancyUnitId(units, [ten('belegt', '2025-06-30')], heute)).toBe('belegt')
  // alle vermietbaren belegt: die erste vermietbare, nie die selbstgenutzte
  expect(defaultTenancyUnitId(units, [ten('belegt', null), ten('frei', null)], heute)).toBe('belegt')
  // gar keine vermietbare: die erste Wohnung, wie bisher
  expect(defaultTenancyUnitId([units[0] as Unit], [], heute)).toBe('eigen')
  expect(defaultTenancyUnitId([], [], heute)).toBe('')
})

// #142: Die Liste der Mietverhältnisse zeigte das Nebenkostenmodell nicht.
test('Kennzeichen des Nebenkostenmodells in der Liste: nichts bei Abrechnung, sonst knapp', () => {
  expect(costModelBadge(undefined, undefined)).toBeNull()
  expect(costModelBadge(null, null)).toBeNull()
  expect(costModelBadge('settlement', 'settlement')).toBeNull()
  expect(costModelBadge('flatRate', 'flatRate')).toBe('Pauschale')
  expect(costModelBadge('inclusive', 'inclusive')).toBe('inklusiv')
  expect(costModelBadge('flatRate', null)).toBe('kalt pauschal · Heizung abgerechnet')
  expect(costModelBadge(null, 'inclusive')).toBe('kalt abgerechnet · Heizung inklusiv')
  expect(costModelBadge('inclusive', 'flatRate')).toBe('kalt inklusiv · Heizung pauschal')
})

// #204: Zwei Mietverhältnisse derselben Wohnung, die sich überschneiden, berechnen die Wohnung für
// die gemeinsamen Tage doppelt. Beim Speichern fragt die Oberfläche nach; der Server lehnt nicht ab.
test('Rückfrage bei Überschneidung: nennt Mieter und Zeitraum deutsch, gesiezt; sonst keine', () => {
  const ten = (id: string, unitId: string, tenantName: string, start: string, end: string | null) =>
    ({ id, unitId, tenantName, start, end }) as Tenancy
  const bestand = [ten('x', 'A', 'Xaver', '2023-01-01', '2025-09-30'), ten('z', 'B', 'Zora', '2020-01-01', null)]
  const q = overlapQuestion({ unitId: 'A', start: '2025-09-01', end: null }, bestand)
  expect(q?.title).toBe('Mietverhältnisse überschneiden sich')
  expect(q?.message).toContain('„Xaver“ vom 01.09.2025 bis 30.09.2025')
  expect(q?.message).toContain('Trotzdem speichern?')
  expect(q?.message).toMatch(/Sie/)
  expect(q?.confirmLabel).toBe('Trotzdem speichern')
  // offener gemeinsamer Zeitraum
  expect(overlapQuestion({ unitId: 'B', start: '2025-03-01', end: null }, bestand)?.message).toContain('„Zora“ ab dem 01.03.2025')
  // lückenlos, andere Wohnung, das Mietverhältnis selbst beim Bearbeiten: keine Rückfrage
  expect(overlapQuestion({ unitId: 'A', start: '2025-10-01', end: null }, bestand)).toBeNull()
  expect(overlapQuestion({ unitId: 'C', start: '2025-01-01', end: null }, bestand)).toBeNull()
  expect(overlapQuestion({ id: 'x', unitId: 'A', start: '2023-01-01', end: '2025-12-31' }, bestand)).toBeNull()
  // ohne Einzug (Formular unvollständig) keine Rückfrage, das meldet die Prüfung davor
  expect(overlapQuestion({ unitId: 'A', start: '', end: null }, bestand)).toBeNull()
})

// Sichtprüfung E12: Nach dem Aufteilen für die getrennte Heizkostenabrechnung zeigte die Spalte
// „Vorauszahlung je Monat“ nur die übrige Vorauszahlung, und es sah aus, als sei sie gesunken.
test('die Spalte Vorauszahlung nennt die Heizvorauszahlung daneben', () => {
  const t = { prepayments: [{ from: '2024-01', monthlyCents: 28000 }, { from: '2025-05', monthlyCents: 16500 }], heatingPrepayments: [{ from: '2025-05', monthlyCents: 11500 }] }
  expect(prepaymentColumn(t)).toEqual([
    { label: 'ab 01/2024:', amount: '280,00\u00a0€' },
    { label: 'ab 05/2025:', amount: '165,00\u00a0€' },
    { label: '+ Heizung ab 05/2025:', amount: '115,00\u00a0€' },
  ])
  expect(prepaymentColumn({ prepayments: [{ from: '2024-01', monthlyCents: 28000 }] })).toEqual([{ label: null, amount: '280,00\u00a0€' }])
  expect(prepaymentColumn({ prepayments: [{ from: '2024-01', monthlyCents: 28000 }], heatingPrepayments: [{ from: '2024-01', monthlyCents: 9000 }] })).toEqual([
    { label: null, amount: '280,00\u00a0€' },
    { label: '+ Heizung:', amount: '90,00\u00a0€' },
  ])
})
