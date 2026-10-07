import { describe, expect, it } from 'vitest'
import { CAUSE_OPTIONS, chooseMethod, emptyEstimate, estimateBody, parseAmount, proposalValue, thresholdLines } from './estimateForm'
import type { SelfEstimateOption, SelfPotView } from './types'

const option = (over: Partial<SelfEstimateOption> = {}): SelfEstimateOption => ({
  unitId: 'c', unitName: 'C', part: 'heat', areaM2: 60, why: 'noReading', boundary: '2025-12-31', estimated: false,
  proposals: [
    { method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' },
    { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' },
    { method: 'comparableUnit', value: null, perM2: null, why: 'ok' },
  ],
  comparable: [{ unitId: 'a', unitName: 'A', perM2: 210, value: 12600.25 }],
  ...over,
})
const pot = (areaM2: number, estimatedAreaM2 = 0): SelfPotView => ({
  pot: 'heating', costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2, consumption: 0, consumptionUnit: 'kWh',
  baseCentsPerM2: 0, consumptionCentsPerUnit: null, overThreshold: false, estimatedAreaM2,
})

describe('Dialog der Schätzung (Heizung PR 13, Entwurf 8.7)', () => {
  it('Vorgabe ist der Durchschnitt des Gebäudes, vorbelegt mit dem Vorschlag', () => {
    expect(emptyEstimate(option())).toEqual({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: '', confirmed: false, cause: 'deviceFailure' })
    // Eine gespeicherte Schätzung wird gezeigt, wie sie ist.
    expect(emptyEstimate(option(), { value: 9000.5, method: 'previousPeriod', reason: 'defekt', confirmed: true, cause: 'wrongReading' })).toEqual({ method: 'previousPeriod', comparableUnitId: '', value: '9000,5', reason: 'defekt', confirmed: true, cause: 'wrongReading' })
  })
  it('vergleichbare Wohnung: der Wert der gewählten Wohnung; Vorperiode ohne Wert lässt den Wert stehen', () => {
    expect(proposalValue(option(), 'comparableUnit', 'a')).toBe(12600.25)
    expect(proposalValue(option(), 'comparableUnit', '')).toBeNull()
    expect(proposalValue(option(), 'previousPeriod', '')).toBeNull()
    const form = emptyEstimate(option())
    expect(chooseMethod(form, option(), 'comparableUnit', 'a').value).toBe('12600,25')
    expect(chooseMethod(form, option(), 'previousPeriod', '')).toEqual({ ...form, method: 'previousPeriod' })
  })
  it('Zahlen in deutscher und technischer Schreibweise, und der vorbelegte Wert wird wieder gelesen, wie er dasteht', () => {
    expect(parseAmount('12.000')).toBe(12000)
    expect(parseAmount('12000,5')).toBe(12000.5)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('zwölf')).toBeNull()
    expect(parseAmount(emptyEstimate(option({ proposals: [{ method: 'buildingAverage', value: 1234.5678, perM2: 1, why: 'ok' }] })).value)).toBe(1234.568)
  })
  it('Begründung Pflicht, Wert ab 0', () => {
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: ' ', confirmed: true, cause: 'deviceFailure' as const }, 'heat')).toEqual({ error: expect.stringMatching(/Begründung/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '-1', reason: 'defekt', confirmed: true, cause: 'deviceFailure' as const }, 'heat')).toEqual({ error: expect.stringMatching(/Zahl ab 0/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12.000', reason: ' defekt ', confirmed: true, cause: 'deviceFailure' as const }, 'heat')).toEqual({ body: { value: 12000, method: 'buildingAverage', reason: 'defekt', confirmed: true, cause: 'deviceFailure' } })
  })
  it('Warmwasser: „12.345“ m³ ist mehrdeutig und wird nachgefragt; mit Komma eindeutig', () => {
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12.345', reason: 'defekt', confirmed: true, cause: 'deviceFailure' as const }, 'water')).toEqual({ error: expect.stringMatching(/Meinen Sie 12,345 oder 12345/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12,345', reason: 'defekt', confirmed: true, cause: 'deviceFailure' as const }, 'water')).toEqual({ body: { value: 12.345, method: 'buildingAverage', reason: 'defekt', confirmed: true, cause: 'deviceFailure' } })
  })
})

describe('Grenze des § 9a Abs. 2 vor dem Speichern (N5, Abweichung 9)', () => {
  it('rechnet den tatsächlichen Flächenanteil aus', () => {
    const lines = thresholdLines(pot(200), option(), 25)
    expect(lines[0]).toBe('Maßgeblich ist die Fläche der Wohnungen mit geschätztem Verbrauch, nicht ihre Zahl: mit dieser Schätzung 60 von 200 m², also 30 %.')
    expect(lines[1]).toMatch(/überschreitet 25 %.*ausschließlich nach Fläche.*§ 9a Abs\. 2/)
  })
  it('vier gleich große Wohnungen: genau 25 %, keine Überschreitung', () => {
    const lines = thresholdLines(pot(200), option({ areaM2: 50 }), 25)
    expect(lines[1]).toBe('Das sind genau 25 %, also keine Überschreitung; die Kosten werden weiter nach Verbrauch verteilt.')
  })
  it('kleine Wohnung darunter; schon geschätzte Fläche zählt mit', () => {
    expect(thresholdLines(pot(200), option({ areaM2: 40 }), 25)[1]).toBe('Das liegt unter 25 %; die Kosten werden weiter nach Verbrauch verteilt.')
    expect(thresholdLines(pot(200, 40), option({ areaM2: 40 }), 25)[0]).toMatch(/80 von 200 m², also 40 %/)
    expect(thresholdLines(pot(200, 60), option({ estimated: true }), 25)[0]).toMatch(/60 von 200 m², also 30 %/)
    // Krumme Anteile mit höchstens zwei Nachkommastellen.
    expect(thresholdLines(pot(300), option({ areaM2: 50 }), 25)[0]).toMatch(/50 von 300 m², also 16,67 %/)
  })
  // Der Satz zu ungleich großen Wohnungen steht seit der Durchsicht von #242 allgemein (R-M7, Test unten).
})

// Durchsicht von #242 (Recht): R-I1 Gründe als Auswahl, R-I5 Auslegung, R-M7 allgemeiner Satz zur Fläche.
describe('Durchsicht von #242', () => {
  it('R-I1: der Grund ist eine Auswahl; vorbelegt „Gerät ausgefallen“, ohne fehlenden Wert „zeigt falsch an“', () => {
    expect(CAUSE_OPTIONS.map((c) => c.label)).toEqual(['Gerät ausgefallen', 'Gerät zeigt falsch an', 'Ablesung nicht möglich', 'anderer zwingender Grund'])
    expect(emptyEstimate(option()).cause).toBe('deviceFailure')
    expect(emptyEstimate(option({ why: null })).cause).toBe('wrongReading')
    expect(emptyEstimate(option(), { value: 1, method: 'buildingAverage', reason: 'x', confirmed: true, cause: 'readingImpossible' }).cause).toBe('readingImpossible')
    const form = { ...emptyEstimate(option()), reason: 'defekt', cause: 'otherReason' as const }
    expect(estimateBody(form, 'heat')).toEqual({ body: { value: 12000, method: 'buildingAverage', reason: 'defekt', confirmed: false, cause: 'otherReason' } })
  })
  it('R-I1: eine Schätzung, die nicht mehr zur Erfassung passt, wird neu eingetragen (mit dem Vorschlag, nicht dem alten Wert)', () => {
    const f = emptyEstimate(option(), { value: 12000, method: 'previousPeriod', reason: 'defekt', confirmed: true, cause: 'deviceFailure', stale: true })
    expect([f.value, f.method, f.reason, f.confirmed]).toEqual(['12000', 'buildingAverage', 'defekt', false])
    const g = emptyEstimate(option({ proposals: [{ method: 'buildingAverage', value: 1200, perM2: 20, why: 'ok' }] }), { value: 12000, method: 'buildingAverage', reason: 'defekt', confirmed: true, cause: 'deviceFailure', stale: true })
    expect(g.value).toBe('1200')
  })
  it('R-M7: der letzte Satz gilt für jedes Haus, nicht nur für vier gleich große Wohnungen', () => {
    const lines = thresholdLines(pot(200), option(), 25)
    expect(lines.join(' ')).not.toMatch(/vier gleich großen/)
    expect(lines.join(' ')).toMatch(/Eine Wohnung mit mehr als 25 % der Fläche überschreitet die Grenze allein, mehrere kleinere können es zusammen/)
  })
  it('R-I5: die Flächenregel steht als Auslegung da, bei teilweise abgelesener Wohnung mit eigenem Satz', () => {
    expect(thresholdLines(pot(200), option(), 25).join(' ')).toMatch(/ganze Fläche der Wohnung.*Heizung und Warmwasser getrennt.*Auslegung von Mietfuchs/s)
    expect(thresholdLines(pot(200), option({ partlyMeasured: true }), 25).join(' ')).toMatch(/Gezählt wird die ganze Wohnung, obwohl ein Teil der Heizperiode bis zum Mieterwechsel abgelesen ist/)
    expect(thresholdLines(pot(200), option({ partlyMeasured: false }), 25).join(' ')).not.toMatch(/Gezählt wird die ganze Wohnung/)
  })
})

describe('Durchsicht von #242 Runde 2', () => {
  it('N-M4: „nicht die Zahl“ steht nur einmal im Dialog', () => {
    const text = thresholdLines(pot(200), option(), 25).join(' ')
    expect(text.match(/nicht (ihre|die) Zahl/g)?.length).toBe(1)
  })
})
