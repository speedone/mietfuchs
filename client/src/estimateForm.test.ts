import { describe, expect, it } from 'vitest'
import { chooseMethod, emptyEstimate, estimateBody, parseAmount, proposalValue, thresholdLines } from './estimateForm'
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
    expect(emptyEstimate(option())).toEqual({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: '', confirmed: false })
    // Eine gespeicherte Schätzung wird gezeigt, wie sie ist.
    expect(emptyEstimate(option(), { value: 9000.5, method: 'previousPeriod', reason: 'defekt', confirmed: true })).toEqual({ method: 'previousPeriod', comparableUnitId: '', value: '9000,5', reason: 'defekt', confirmed: true })
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
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: ' ', confirmed: true }, 'heat')).toEqual({ error: expect.stringMatching(/Begründung/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '-1', reason: 'defekt', confirmed: true }, 'heat')).toEqual({ error: expect.stringMatching(/Zahl ab 0/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12.000', reason: ' defekt ', confirmed: true }, 'heat')).toEqual({ body: { value: 12000, method: 'buildingAverage', reason: 'defekt', confirmed: true } })
  })
  it('Warmwasser: „12.345“ m³ ist mehrdeutig und wird nachgefragt; mit Komma eindeutig', () => {
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12.345', reason: 'defekt', confirmed: true }, 'water')).toEqual({ error: expect.stringMatching(/Meinen Sie 12,345 oder 12345/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12,345', reason: 'defekt', confirmed: true }, 'water')).toEqual({ body: { value: 12.345, method: 'buildingAverage', reason: 'defekt', confirmed: true } })
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
  it('der Satz zu ungleich großen Wohnungen stimmt für jede Größe', () => {
    const last = thresholdLines(pot(200), option(), 25).at(-1) ?? ''
    expect(last).toMatch(/Bei vier gleich großen Wohnungen hat jede genau 25 %/)
    expect(last).toMatch(/Eine Wohnung mit mehr als 25 % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen/)
  })
})
