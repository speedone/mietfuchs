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
  const reasons = ['notAllocable', 'noBasis', 'selfUse', 'vacancy', 'flatRate', 'inclusive', 'outsideUnit', 'amountsRest', 'customRest', 'mainMeterRest', 'rounding'] as const
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
