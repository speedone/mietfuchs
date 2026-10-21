// Nebenkostenmodell am Mietverhältnis (#93), die Seite der Oberfläche.
import { expect, test } from 'vitest'
import { parseMonthText } from './monthText'
import { COST_MODEL_LABELS, HEATING_MODEL_LABELS, SELF_SUPPLY_TENANCY_HINT, buildPersonHistory, buildSchedule, costModelBadge, costModelBody, defaultTenancyUnitId, notSettledText, overlapQuestion, parsePersons, partialMonthNote, prepaymentColumn, scheduleField, scheduleMonthText, showsFlatRates, startsSchedule } from './tenancyModel'
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

test('Mieter heizt selbst (Heizung PR 19): nur bei der Heizung wählbar, gespeichert wie gewählt, ohne Pauschale', () => {
  expect(Object.keys(HEATING_MODEL_LABELS)).toEqual(['settlement', 'flatRate', 'inclusive', 'selfSupply'])
  expect(Object.keys(COST_MODEL_LABELS)).not.toContain('selfSupply')
  expect(HEATING_MODEL_LABELS.selfSupply).toBe('Mieter heizt selbst (eigener Vertrag für Brennstoff oder Wärme)')
  expect(costModelBody('settlement', 'selfSupply')).toEqual({ costModel: null, heatingModel: 'selfSupply' })
  expect(showsFlatRates('settlement', 'selfSupply')).toBe(false)
  expect(costModelBadge(null, 'selfSupply')).toBe('Heizung selbst')
  expect(costModelBadge('flatRate', 'selfSupply')).toBe('kalt pauschal · Heizung selbst')
  // § 6 Abs. 2 Satz 6 CO2KostAufG: die Hinweispflicht steht unter der Auswahl (Prüfung M1).
  expect(SELF_SUPPLY_TENANCY_HINT).toMatch(/Wartung und Betriebsstrom, die Sie tragen, rechnet Mietfuchs weiter ab/)
  expect(SELF_SUPPLY_TENANCY_HINT).toMatch(/in Textform auf den Erstattungsanspruch und auf die Pflicht nach § 43 Abs\. 1 GModG hinweisen \(§ 6 Abs\. 2 Satz 6 CO2KostAufG\)/)
  expect(SELF_SUPPLY_TENANCY_HINT).toMatch(/12 Monaten/)
})

// Die eine Stelle, die einen Monat liest, ist parseMonthText (Durchsicht K4: parseScheduleMonth entfällt).
const scheduleKey = (text: string): string | null => {
  const r = parseMonthText(text)
  return r.kind === 'month' ? r.key : null
}

test('Monat einer Staffel: auch in deutscher Schreibweise, wie sie Safari und Firefox ohne Monatsauswahl bekommen', () => {
  // Chrome liefert aus der Monatsauswahl immer JJJJ-MM
  expect(scheduleKey('2026-01')).toBe('2026-01')
  // Safari auf dem Mac und Firefox zeigen ein Textfeld; dort tippt man, was man kennt
  expect(scheduleKey('01.2026')).toBe('2026-01')
  expect(scheduleKey('1.2026')).toBe('2026-01')
  expect(scheduleKey('10/2026')).toBe('2026-10')
  expect(scheduleKey(' 01.01.2026 ')).toBe('2026-01')
  expect(scheduleKey('1.10.2026')).toBe('2026-10')
  expect(scheduleKey('2026-10-01')).toBe('2026-10')
})

test('Monat einer Staffel: ein Tag mitten im Monat und Unsinn werden nicht gedeutet', () => {
  // Eine Staffel gilt ab Monatsanfang; „15.10.2026“ still als Oktober zu lesen, hieße raten
  expect(scheduleKey('15.10.2026')).toBeNull()
  expect(scheduleKey('2026-10-15')).toBeNull()
  expect(scheduleKey('13.2026')).toBeNull()
  expect(scheduleKey('00.2026')).toBeNull()
  // seit dem Monatsfeld (#346, Schritt 5) auch mit Namen
  expect(scheduleKey('Januar 2026')).toBe('2026-01')
  expect(scheduleKey('26-01')).toBeNull()
  expect(scheduleKey('')).toBeNull()
  // ein Jahr außerhalb von 1900 bis 2100 ist ein Tippfehler
  expect(scheduleKey('01.0026')).toBeNull()
  expect(scheduleKey('01.2206')).toBeNull()
  expect(scheduleKey('01.2100')).toBe('2100-01')
})

test('Monat einer Staffel zur Anzeige: JJJJ-MM wird MM.JJJJ und lässt sich wieder lesen', () => {
  expect(scheduleMonthText('2026-01')).toBe('01.2026')
  expect(scheduleKey(scheduleMonthText('2026-10'))).toBe('2026-10')
  expect(scheduleMonthText('')).toBe('')
})

// Durchsicht von #287: „+ Mieterhöhung ab Monat …“, 900 € eingetragen, den Monat stehen lassen.
// Die neue Zeile galt dann „ab Einzug“, gesendet wurden zwei Einträge zum Einzugsmonat, und nach
// „es gilt der letzte Eintrag“ galten 900 € rückwirkend ab Einzug. „Ab Einzug“ gibt es deshalb nur
// in der ersten Zeile einer Staffel; in jeder weiteren ist ein fehlender Monat ein Fehler.
test('Staffel aus dem Formular: nur die erste Zeile darf ohne Monat ab Einzug gelten', () => {
  expect(buildSchedule([{ from: '', amount: '800,00' }], '2025-02-01', 'baseRent')).toEqual({ schedule: [{ from: '2025-02', monthlyCents: 80000 }] })
  expect(buildSchedule([{ from: '02.2025', amount: '800,00' }, { from: '', amount: '900,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ problems: [{ field: 'baseRent.1.from', short: 'Monat fehlt', text: 'Kaltmiete, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.' }] })
  expect(buildSchedule([{ from: '', amount: '150,00' }, { from: '', amount: '170,00' }], '2025-02-01', 'prepayment'))
    .toEqual({ problems: [{ field: 'prepayment.1.from', short: 'Monat fehlt', text: 'Vorauszahlung, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.' }] })
  expect(buildSchedule([{ from: '01.2025', amount: '90,00' }, { from: '', amount: '95,00' }], '2025-01-01', 'flatRate'))
    .toEqual({ problems: [{ field: 'flatRate.1.from', short: 'Monat fehlt', text: 'Pauschale, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.' }] })
  expect(buildSchedule([{ from: '05.2025', amount: '120,00' }, { from: '', amount: '130,00' }], '2025-01-01', 'heatingPrepayment'))
    .toEqual({ problems: [{ field: 'heatingPrepayment.1.from', short: 'Monat fehlt', text: 'Heizvorauszahlung, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.' }] })
  // mit Monat: gilt ab diesem Monat
  expect(buildSchedule([{ from: '02.2025', amount: '800,00' }, { from: '01.2026', amount: '900,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ schedule: [{ from: '2025-02', monthlyCents: 80000 }, { from: '2026-01', monthlyCents: 90000 }] })
  // ganz leere Zeilen fallen weg, wo sie auch stehen
  expect(buildSchedule([{ from: '', amount: '' }, { from: '', amount: ' ' }], '2025-02-01', 'baseRent')).toEqual({ schedule: [] })
})

test('Staffel aus dem Formular: zwei Zeilen zum selben Monat werden nicht still zusammengelegt', () => {
  // Die erste ohne Monat gilt ab Einzug; eine zweite mit dem Einzugsmonat überschriebe sie rückwirkend.
  expect(buildSchedule([{ from: '', amount: '800,00' }, { from: '02.2025', amount: '900,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ problems: [{ field: 'baseRent.1.from', short: 'Monat doppelt', text: 'Kaltmiete, Zeile 2: Eine andere Zeile gilt schon ab Februar 2025. Geben Sie jeder Zeile einen eigenen Monat.' }] })
})

test('Staffel aus dem Formular: Monat und Betrag werden geprüft', () => {
  expect(buildSchedule([{ from: '03.', amount: '800,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ problems: [{ field: 'baseRent.0.from', short: 'Jahr fehlt', text: 'Kaltmiete, Zeile 1: Geben Sie zum Monat auch das Jahr ein, etwa „3.2025“.' }] })
  // in einer weiteren Zeile gibt es kein „ab Einzug“, also auch keinen Hinweis darauf
  expect(buildSchedule([{ from: '02.2025', amount: '800,00' }, { from: '.2026', amount: '900,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ problems: [{ field: 'baseRent.1.from', short: 'Monat fehlt', text: 'Kaltmiete, Zeile 2: Geben Sie zum Jahr auch den Monat ein, etwa „3.2025“.' }] })
  expect(buildSchedule([{ from: '02.2025', amount: 'viel' }], '2025-02-01', 'baseRent')).toEqual({ problems: [{ field: 'baseRent.0.amount', short: 'Kein Betrag', text: 'Kaltmiete, Zeile 1: Geben Sie den Betrag je Monat ein, etwa „800,00“.' }] })
  expect(buildSchedule([{ from: '02.2025', amount: '-5,00' }], '2025-02-01', 'heatingPrepayment')).toEqual({ problems: [{ field: 'heatingPrepayment.0.amount', short: 'Betrag negativ', text: 'Heizvorauszahlung, Zeile 1: Geben Sie den Betrag je Monat ein, etwa „800,00“.' }] })
  // alle Angaben auf einmal, je mit ihrem Feld (#346, Schritt 5)
  expect(buildSchedule([{ from: '13.2025', amount: 'viel' }, { from: '', amount: '900,00' }], '2025-02-01', 'baseRent')).toEqual({ problems: [
    { field: 'baseRent.0.from', short: 'Monat 13 gibt es nicht', text: 'Kaltmiete, Zeile 1: Den Monat 13 gibt es nicht. Geben Sie den Monat als Zahl von 1 bis 12 ein, etwa „3.2025“.' },
    { field: 'baseRent.0.amount', short: 'Kein Betrag', text: 'Kaltmiete, Zeile 1: Geben Sie den Betrag je Monat ein, etwa „800,00“.' },
    { field: 'baseRent.1.from', short: 'Monat fehlt', text: 'Kaltmiete, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.' },
  ] })
  expect(scheduleField('flatRate', 3, 'amount')).toBe('flatRate.3.amount')
})

// Durchsicht von #287: Ein gespeicherter Altwert vor 1900 (oder nach 2100) steht im Feld, wie er ist, und
// das Speichern sagt, was am Jahr nicht stimmt, statt „Bitte noch das Jahr wählen“.
test('Staffel: ein gespeichertes Jahr außerhalb von 1900 bis 2100 heißt so, am Feld und mit Ort', () => {
  expect(buildSchedule([{ from: scheduleMonthText('1899-05'), amount: '800,00' }], '2025-02-01', 'baseRent')).toEqual({ problems: [
    { field: 'baseRent.0.from', short: 'Jahr außerhalb 1900 bis 2100', text: 'Kaltmiete, Zeile 1: Das Jahr 1899 liegt außerhalb von 1900 bis 2100. Bitte prüfen Sie das Jahr.' },
  ] })
})

test('Personen-Staffel: auch dort gilt nur die erste Zeile ohne Datum ab Einzug', () => {
  expect(buildPersonHistory([{ from: '', persons: '2' }, { from: '', persons: '3' }], '2025-02-01')).toEqual({ error: 'Bitte Personen-Staffel prüfen: Jede weitere Zeile braucht ein Datum.' })
})

// Durchsicht von fix/monatsauswahl, Kann 1: Eine weitere Stufe mit einem Monat vor dem Einzug galt
// still nie (vertipptes Jahr bei einer Mieterhöhung).
test('Staffel aus dem Formular: eine weitere Stufe vor dem Einzug wird gemeldet', () => {
  expect(buildSchedule([{ from: '02.2025', amount: '800,00' }, { from: '03.2015', amount: '900,00' }], '2025-02-01', 'baseRent'))
    .toEqual({ problems: [{ field: 'baseRent.1.from', short: 'Vor dem Einzug', text: 'Kaltmiete, Zeile 2: Die Zeile ab März 2015 liegt vor dem Einzug (Februar 2025) und gälte deshalb nie. Bitte prüfen Sie Monat und Jahr.' }] })
  // die erste Stufe vor dem Einzug gilt ab Einzug, wie bisher
  expect(buildSchedule([{ from: '01.2024', amount: '800,00' }], '2025-02-01', 'baseRent')).toEqual({ schedule: [{ from: '2024-01', monthlyCents: 80000 }] })
})

// Kann 2: „erste Zeile“ ist die erste Stufe, nicht die erste Position im Formular.
test('Staffel aus dem Formular: leere Zeilen davor zählen nicht, die erste Zeile mit Betrag ist die erste Stufe', () => {
  expect(buildSchedule([{ from: '', amount: '' }, { from: '', amount: '800,00' }], '2025-02-01', 'baseRent')).toEqual({ schedule: [{ from: '2025-02', monthlyCents: 80000 }] })
  expect(startsSchedule([{ from: '', amount: '' }, { from: '', amount: '800,00' }], 1)).toBe(true)
  expect(startsSchedule([{ from: '02.2025', amount: '800,00' }, { from: '', amount: '' }], 1)).toBe(false)
  expect(startsSchedule([{ from: '', amount: '' }], 0)).toBe(true)
})

// Kann 3: Ein gespeicherter Wert mit Tag ('2024-02-15') ist kein Monat der Staffel. Die Berechnung
// vergleicht Text ('2024-02-15' > '2024-02'), er gälte dort erst ab März; ihn hier als Februar zu
// lesen, verschöbe beim nächsten Speichern still die Staffel. Er wird angezeigt, nicht gedeutet.
test('Staffel: ein gespeicherter Wert, der kein Monat ist, wird gemeldet und nicht gedeutet', () => {
  // scheduleMonthText lässt ihn stehen; das Monatsfeld zeigt ihn so, wie er gespeichert ist
  expect(scheduleMonthText('2024-02-15')).toBe('2024-02-15')
  expect(buildSchedule([{ from: scheduleMonthText('2024-02-15'), amount: '800,00' }], '2024-01-01', 'baseRent')).toEqual({ problems: [
    { field: 'baseRent.0.from', short: 'Nur Monat und Jahr', text: 'Kaltmiete, Zeile 1: Hier zählt nur der Monat ab dem Ersten. Geben Sie Monat und Jahr ohne Tag ein, etwa „3.2025“.' },
  ] })
})

// N15 aus #341: Bei einer Pauschale stand in der Spalte nur „—“, obwohl monatlich ein Betrag gezahlt wird.
test('die Spalte Vorauszahlung nennt eine Pauschale mit ihrem Betrag', () => {
  expect(prepaymentColumn({ prepayments: [], flatRates: [{ from: '2024-01', monthlyCents: 6000 }] })).toEqual([{ label: 'Pauschale:', amount: '60,00 €' }])
  expect(prepaymentColumn({ prepayments: [{ from: '2024-01', monthlyCents: 20000 }], flatRates: [{ from: '2024-01', monthlyCents: 5000 }, { from: '2025-07', monthlyCents: 5500 }] })).toEqual([
    { label: null, amount: '200,00 €' },
    { label: 'Pauschale ab 01/2024:', amount: '50,00 €' },
    { label: 'Pauschale ab 07/2025:', amount: '55,00 €' },
  ])
})

test('Anteil im angebrochenen Monat: Einzug am 15. zeigt Tage und Betrag wie die Abrechnung', () => {
  const rows = [{ from: '', amount: '150,00' }]
  expect(partialMonthNote(rows, '2026-10-15', '', 'prepayment')?.replace(/\s/g, ' '))
    .toBe('Einzug am 15.10.2026: Im Oktober 2026 zählen 17 von 31 Tagen, also 82,26 € statt 150,00 €.')
})

test('Anteil im angebrochenen Monat: nichts bei vollen Monaten, Rate 0 oder unfertigen Angaben', () => {
  expect(partialMonthNote([{ from: '', amount: '150,00' }], '2026-10-01', '2027-03-31', 'prepayment')).toBeNull()
  expect(partialMonthNote([{ from: '', amount: '0' }], '2026-10-15', '', 'prepayment')).toBeNull()
  expect(partialMonthNote([{ from: '', amount: '' }], '2026-10-15', '', 'prepayment')).toBeNull()
  expect(partialMonthNote([{ from: '', amount: '150,00' }], '', '', 'prepayment')).toBeNull()
})

test('Anteil im angebrochenen Monat: Auszug mit der dann geltenden Staffelstufe, Ein- und Auszug im selben Monat', () => {
  const rows = [{ from: '', amount: '150,00' }, { from: '01.2027', amount: '180,00' }]
  expect(partialMonthNote(rows, '2026-10-15', '2027-03-10', 'prepayment')?.replace(/\s/g, ' '))
    .toBe('Einzug am 15.10.2026: Im Oktober 2026 zählen 17 von 31 Tagen, also 82,26 € statt 150,00 €. Auszug am 10.03.2027: Im März 2027 zählen 10 von 31 Tagen, also 58,06 € statt 180,00 €.')
  expect(partialMonthNote([{ from: '', amount: '310,00' }], '2026-10-05', '2026-10-14', 'baseRent')?.replace(/\s/g, ' '))
    .toBe('Einzug am 05.10.2026, Auszug am 14.10.2026: Im Oktober 2026 zählen 10 von 31 Tagen, also 100,00 € statt 310,00 €.')
})

test('Anteil im angebrochenen Monat: kein Satz bei Auszug vor Einzug, denn die Abrechnung rechnet dann 0 €', () => {
  expect(partialMonthNote([{ from: '', amount: '150,00' }], '2026-10-15', '2026-09-30', 'prepayment')).toBeNull()
})

test('Anteil im angebrochenen Monat: eine Stufe ab dem Auszugsmonat gilt im Auszugsmonat', () => {
  const rows = [{ from: '', amount: '150,00' }, { from: '03.2027', amount: '180,00' }]
  expect(partialMonthNote(rows, '2026-10-01', '2027-03-10', 'prepayment')?.replace(/\s/g, ' '))
    .toBe('Auszug am 10.03.2027: Im März 2027 zählen 10 von 31 Tagen, also 58,06 € statt 180,00 €.')
})
