import { expect, test } from 'vitest'
import { landlordReasonText } from './landlordReasons'
import { fmtEuro } from './api'
import type { SettlementRow } from './types'

const row = (over: Partial<SettlementRow>): SettlementRow => ({
  costItemId: 'k', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 100000, keyLabel: 'Wohnfläche', shareCents: 50000, ...over,
})

test('ein Grund: nur der Grund, ohne Betrag', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'flatRate', cents: 50000 }] }))).toBe('Betriebskostenpauschale')
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'inclusive', cents: 50000 }] }))).toBe('Inklusivmiete')
})

test('mehrere Gründe: jeder mit seinem Betrag', () => {
  expect(landlordReasonText(row({
    shareCents: 50100,
    landlordParts: [{ reason: 'selfUse', cents: 25000 }, { reason: 'vacancy', cents: 25000 }, { reason: 'rounding', cents: 100 }],
  }))).toBe(`Eigennutzung ${fmtEuro(25000)} · Leerstand ${fmtEuro(25000)} · Rundungsrest ${fmtEuro(100)}`)
})

test('jeder Grund hat eine Beschriftung', () => {
  const reasons = ['notAllocable', 'noBasis', 'selfUse', 'vacancy', 'flatRate', 'inclusive', 'outsideUnit', 'amountsRest', 'customRest', 'mainMeterRest', 'co2Share', 'fuelCarry', 'fuelClosedPeriod', 'fuelEstimateDiff', 'rounding'] as const
  for (const reason of reasons) {
    const text = landlordReasonText(row({ landlordParts: [{ reason, cents: 50000 }] }))
    expect(text).not.toBe('')
    expect(text).not.toBe(reason)
  }
})

test('eine vorher abgeschlossene Abrechnung ohne Zerlegung: die Gründe pauschal wie bisher', () => {
  expect(landlordReasonText(row({}))).toBe('Eigennutzung / Leerstand / Rundung / keine Verteilbasis')
  expect(landlordReasonText(row({ category: 'Nicht umlagefähig' }))).toBe('nicht umlagefähig')
})

test('CO₂-Anteil des Vermieters beim Vorwegabzug (Heizung PR 6)', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'co2Share', cents: 8750 }] }))).toBe('CO₂-Anteil des Vermieters')
})

test('Brennstoff anderer Heizperioden (Heizung PR 7)', () => {
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelCarry', cents: 98339 }] }))).toBe('Brennstoff einer anderen Heizperiode (Abgrenzung)')
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelClosedPeriod', cents: 98339 }] }))).toBe('Brennstoff einer abgeschlossenen Heizperiode')
  expect(landlordReasonText(row({ landlordParts: [{ reason: 'fuelEstimateDiff', cents: -6661 }] }))).toBe('Abweichung von der Schätzung')
})
