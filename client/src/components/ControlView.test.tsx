// @vitest-environment jsdom
// Die Kontrollansicht (#321): aufklappbar, nur am Bildschirm, Differenzen werden benannt.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettlementRow, Statement } from '../types'
import ControlView from './ControlView'

afterEach(cleanup)

const row = (share: number, extra: Partial<SettlementRow> = {}): SettlementRow => ({
  costItemId: 'k1', category: 'Grundsteuer', description: 'Grundsteuer 2025', totalCents: 1000, keyLabel: 'Wohnfläche', shareCents: share, ...extra,
})
const st = (id: string, name: string, share: number): Statement => ({
  tenancyId: id, unitId: `u${id}`, tenantName: name, unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: '2025-01-01', periodEnd: '2025-12-31',
  rows: [row(share)], totalShareCents: share, total35aCents: 0, prepaymentCents: 100, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: share - 100,
})
const landlord = (cents: number) => ({ rows: [row(cents, { landlordParts: [{ reason: 'selfUse' as const, cents }] })], totalCents: cents })

test('die Ansicht ist zugeklappt, nur am Bildschirm und zeigt aufgeklappt die Verteilung', () => {
  const { container } = render(<ControlView data={{ statements: [st('a', 'Anna', 600), st('b', 'Ben', 300)], landlord: landlord(100) }} />)
  expect(container.querySelector('.no-print')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByText('Alle Empfänger je Position nebeneinander'))
  fireEvent(container.querySelector('details')!, new Event('toggle'))
  expect(screen.getByRole('columnheader', { name: /Anna/ })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: /Vermieter: Eigennutzung/ })).toBeTruthy()
  expect(screen.getByText('stimmt')).toBeTruthy()
  expect(screen.queryByText('Die Verteilung geht nicht auf')).toBeNull()
})

test('eine Differenz wird benannt', () => {
  const { container } = render(<ControlView data={{ statements: [st('a', 'Anna', 600)], landlord: landlord(100) }} />)
  const details = container.querySelector('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(screen.getByText('Die Verteilung geht nicht auf')).toBeTruthy()
})
