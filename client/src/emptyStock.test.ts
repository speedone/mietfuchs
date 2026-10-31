// Der erste Schritt im leeren Bestand (#346, Schritt 10, N12).
import { expect, test } from 'vitest'
import type { Tenancy, Unit } from './types'
import { emptySettlement, startStep } from './emptyStock'

const unit: Unit = { id: 'u1', propertyId: 'o', name: 'EG', areaM2: 80, participates: true }
const tenancy: Tenancy = { id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [], start: '2020-01-01', end: '2020-12-31', prepayments: [], prepaymentOverrides: {}, baseRents: [] }

test('erst die Wohnung, dann das Mietverhältnis, dann die Belege', () => {
  expect(startStep([], [], '2025', true)).toMatchObject({ label: 'Wohnung anlegen', tab: 'stammdaten' })
  expect(startStep([unit], [], '2025', true)).toMatchObject({ label: 'Mietverhältnis anlegen', tab: 'stammdaten' })
  const late = startStep([unit], [tenancy], '05/2025–04/2026', false)
  expect(late).toMatchObject({ label: 'Belege erfassen', tab: 'belege:eingang' })
  expect(late.text).toMatch(/den Zeitraum 05\/2025–04\/2026/)
})

test('leer ist nur ein Zeitraum ohne Abrechnung, Pauschale und Kosten', () => {
  expect(emptySettlement({ statements: [], totalCostsCents: 0 })).toBe(true)
  expect(emptySettlement({ statements: [], notSettled: [{}], totalCostsCents: 0 })).toBe(false)
  expect(emptySettlement({ statements: [], totalCostsCents: 100 })).toBe(false)
  expect(emptySettlement({ statements: [{}], totalCostsCents: 0 })).toBe(false)
})
