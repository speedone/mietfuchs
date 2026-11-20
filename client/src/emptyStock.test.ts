// Der erste Schritt im leeren Bestand (#346, Schritt 10, N12).
import { expect, test } from 'vitest'
import type { Tenancy, Unit } from './types'
import { costsStep, emptySettlement, ledgerStep, startStep } from './emptyStock'

const unit: Unit = { id: 'u1', propertyId: 'o', name: 'EG', areaM2: 80, participates: true }
const tenancy: Tenancy = { id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [], start: '2020-01-01', end: '2020-12-31', prepayments: [], prepaymentOverrides: {}, baseRents: [] }

test('erst die Wohnung, dann das Mietverhältnis, dann die Belege', () => {
  // Ein „Anlegen“ öffnet auf der Zielseite das Formular (#554); die Belege haben keine Stelle außer der Seite.
  expect(startStep([], [], '2025', true)).toMatchObject({ label: 'Wohnung anlegen', tab: 'stammdaten', focus: { kind: 'new', what: 'unit' } })
  expect(startStep([unit], [], '2025', true)).toMatchObject({ label: 'Mietverhältnis anlegen', tab: 'stammdaten', focus: { kind: 'new', what: 'tenancy' } })
  const late = startStep([unit], [tenancy], '05/2025–04/2026', false)
  expect(late).toMatchObject({ label: 'Belege erfassen', tab: 'belege:eingang', focus: null })
  expect(late.text).toMatch(/den Zeitraum 05\/2025–04\/2026/)
})

test('leer ist nur ein Zeitraum ohne Abrechnung, Pauschale und Kosten', () => {
  expect(emptySettlement({ statements: [], totalCostsCents: 0 })).toBe(true)
  expect(emptySettlement({ statements: [], notSettled: [{}], totalCostsCents: 0 })).toBe(false)
  expect(emptySettlement({ statements: [], totalCostsCents: 100 })).toBe(false)
  expect(emptySettlement({ statements: [{}], totalCostsCents: 0 })).toBe(false)
})

// Systemprüfung: Mietkonto und Steuer nannten im leeren Jahr die Stammdaten bzw. nichts, ohne Knopf.
test('Mietkonto ohne Mietverhältnis im Jahr: erst die Wohnung, dann das Mietverhältnis, sonst zur Karte „Mietverhältnisse“', () => {
  expect(ledgerStep([], [], 2025)).toMatchObject({ label: 'Wohnung anlegen', tab: 'stammdaten', focus: { kind: 'new', what: 'unit' } })
  expect(ledgerStep([unit], [], 2025)).toMatchObject({ label: 'Mietverhältnis anlegen', tab: 'stammdaten', focus: { kind: 'new', what: 'tenancy' } })
  // Es gibt Mietverhältnisse, nur keines im Jahr: Beginn und Ende prüft man in der Karte, ein Formular wäre geraten.
  const other = ledgerStep([unit], [tenancy], 2025)
  expect(other).toMatchObject({ label: 'Mietverhältnisse prüfen', tab: 'stammdaten', focus: { kind: 'section', section: 'tenancies' } })
  for (const step of [ledgerStep([], [], 2025), ledgerStep([unit], [], 2025), other]) expect(step.text).toMatch(/^Für 2025 gibt es keine Mietverhältnisse\. /)
})

test('Steuer ohne Kosten: in den Eingang der Belege, ohne Wohnung zuerst die Wohnung (N12)', () => {
  expect(costsStep([unit])).toEqual({ label: 'Belege erfassen', tab: 'belege:eingang', focus: null })
  expect(costsStep([])).toMatchObject({ label: 'Wohnung anlegen', tab: 'stammdaten', focus: { kind: 'new', what: 'unit' } })
})
