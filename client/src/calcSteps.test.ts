import { describe, expect, test } from 'vitest'
import { stepsOf } from './calcSteps'
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
