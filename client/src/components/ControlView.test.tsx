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

function openIt(container: HTMLElement) {
  const details = container.querySelector('details')
  if (!details) return expect.fail('Kein <details> in der Kontrollansicht')
  details.open = true
  fireEvent(details, new Event('toggle'))
}

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
  openIt(container)
  expect(screen.getByText('Die Verteilung geht nicht auf')).toBeTruthy()
  expect(screen.getByText(/bevor Sie abschließen/)).toBeTruthy()
})

test('bei abgeschlossener Abrechnung verweist der Fehlertext auf Wieder öffnen statt auf das Abschließen', () => {
  const { container } = render(<ControlView data={{ statements: [st('a', 'Anna', 600)], landlord: landlord(100), closed: { closedAt: '2026-01-01', sentAt: null } }} />)
  openIt(container)
  expect(screen.queryByText(/bevor Sie abschließen/)).toBeNull()
  expect(screen.getByText(/Wieder öffnen/)).toBeTruthy()
})

test('Sonderzeilen zusammen stehen mit Satz und Probe da', () => {
  const extra = (id: string, c: number): SettlementRow => ({ ...row(c), costItemId: id, kind: 'fuelCarry' })
  const s1: Statement = { ...st('a', 'Anna', 1000), rows: [row(1000), extra('fuel:l:h:g:k1', 80)], totalShareCents: 1080, balanceCents: 980 }
  const { container } = render(<ControlView data={{ statements: [s1], landlord: { rows: [{ ...extra('fuel:l:h:g', -80), landlordParts: [{ reason: 'fuelCarry', cents: -80 }] }], totalCents: -80 } }} />)
  openIt(container)
  expect(screen.getByText(/Sonderzeilen zusammen/)).toBeTruthy()
  expect(screen.getByText(/Übertrag und Gegenbuchung heben sich auf/)).toBeTruthy()
  expect(screen.queryByText('Die Verteilung geht nicht auf')).toBeNull()
})
