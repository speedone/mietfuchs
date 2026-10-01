import { describe, expect, test } from 'vitest'
import { stepsOf, suggestionBasis, totalColumnLabel, totalNote } from './calcSteps'
import type { SettlementRow } from './types'
import { fmtEuro } from './api'

const row = (over: Partial<SettlementRow>): SettlementRow => ({
  costItemId: 'k', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 100000, keyLabel: 'Wohnfläche', shareCents: 33333, ...over,
})

describe('Rechenweg (#114)', () => {
  test('mit Schritten aus der Berechnung: genau diese', () => {
    const steps = [{ label: 'Rechnungsbetrag', value: '1.000,00 €' }]
    expect(stepsOf(row({ steps }))).toEqual({ steps, complete: true })
  })

  test('eine vorher abgeschlossene Abrechnung: das, was die Zeile selbst hergibt, und ein ehrlicher Hinweis', () => {
    const r = stepsOf(row({ basisText: '60 von 180 m²' }))
    expect(r.complete).toBe(false)
    expect(r.steps.map((x) => [x.label, x.value])).toEqual([
      ['Rechnungsbetrag', fmtEuro(100000)],
      ['Umlageschlüssel', 'Wohnfläche'],
      ['Anteil an der Verteilbasis', '60 von 180 m²'],
      ['Ergebnis', fmtEuro(33333)],
    ])
  })
})

describe('Gemeinschaftsabrechnung auf der Abrechnung (#144)', () => {
  const zeile = (key: SettlementRow['key']): SettlementRow => ({ costItemId: 'x', category: 'Hauswart', description: 'Hausmeister', totalCents: 51240, key, keyLabel: 'Laut Gemeinschaftsabrechnung', shareCents: 51240 })
  test('die Spalte nennt beides, sobald eine Zeile laut Gemeinschaftsabrechnung dabei ist', () => {
    expect(totalColumnLabel([zeile('area')])).toBe('Gesamtkosten')
    expect(totalColumnLabel([zeile('area'), zeile('external')])).toBe('Gesamtkosten bzw. Anteil an der Gemeinschaft')
  })
  test('die Zeile selbst sagt, dass ihr Betrag der Anteil an der Gemeinschaft ist', () => {
    expect(totalNote(zeile('external'))).toBe('Anteil an der Gemeinschaft')
    expect(totalNote(zeile('area'))).toBe('')
  })
  test('eine vorher abgeschlossene Zeile ohne Schritte nennt den Betrag nicht „Rechnungsbetrag“', () => {
    expect(stepsOf(zeile('external')).steps[0]?.label).toBe('Anteil an der Gemeinschaft')
  })
})

describe('Vorschlag nach § 560 Abs. 4 BGB (#134, zweite Browserabnahme)', () => {
  test('ganzes Jahr: ein Zwölftel der Jahreskosten', () => {
    expect(suggestionBasis({ days: 365 }, 365)).toBe('ein Zwölftel Ihrer Jahreskosten, gerundet')
  })
  test('Einzug im Jahr: auf ein volles Jahr hochgerechnet', () => {
    expect(suggestionBasis({ days: 306 }, 365)).toBe('Ihr Anteil für 306 Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet')
  })
})
