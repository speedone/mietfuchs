import { expect, test } from 'vitest'
import { scorePosition, type PositionCtx } from './triage'

const ctx = (patch: Partial<PositionCtx>): PositionCtx => ({
  category: 'Sach- und Haftpflichtversicherung', amountCents: 10000, labor35aCents: 0, matchedByDesc: false,
  vendor: 'Versicherung AG', detectedYear: 2025, targetYear: 2025, existingItems: [], ...patch,
})

test('Gutschrift (#139): ein negativer Betrag ist kein fehlender, wird aber zum Prüfen als Gutschrift benannt', () => {
  const s = scorePosition(ctx({ amountCents: -5400 }))
  expect(s.reasons).not.toContain('Betrag fehlt oder ist 0')
  expect(s.reasons.some((r) => /Gutschrift/.test(r))).toBe(true)
  expect(s.level).toBe('gelb')
  // Kein Lohnanteil heißt nicht „Lohnanteil größer als der Betrag“
  expect(s.reasons.some((r) => /§35a/.test(r))).toBe(false)
})

test('Betrag 0 bleibt rot', () => {
  expect(scorePosition(ctx({ amountCents: 0 })).level).toBe('rot')
})
