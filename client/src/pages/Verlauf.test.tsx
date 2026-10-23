// @vitest-environment jsdom
// Die Seite „Verlauf“ (#318, Schritt 3) und ihre Logik (journalView.ts).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Verlauf from './Verlauf'
import { changeTitle, fieldLines, formatValue, type JournalChange, type JournalDetail, type JournalGroup } from '../journalView'

const GROUP: JournalGroup = {
  id: 7, at: '2026-10-24T08:15:00.000Z', method: 'DELETE', route: '/api/units/:id', description: 'Wohnung gelöscht',
  title: 'Wohnung gelöscht: EG links', propertyId: 'objekt-1', rows: 2,
}
const DETAIL: JournalDetail = {
  ...GROUP,
  changes: [
    { id: 1, table: 'tenancies', key: { id: 't1' }, op: 'delete', before: { id: 't1', tenant_name: 'Müller', persons: 2, start: '2024-01-01', end: null }, after: null, changed: ['id', 'tenant_name', 'persons', 'start', 'end'] },
    { id: 2, table: 'units', key: { id: 'u1' }, op: 'delete', before: { id: 'u1', name: 'EG links', area_m2: 60 }, after: null, changed: ['id', 'name', 'area_m2'] },
  ],
}
let sent: string[]
let listed: JournalGroup[]
beforeEach(() => {
  sent = []
  listed = [GROUP]
  vi.stubGlobal('fetch', async (url: string) => {
    sent.push(url)
    const body = url.startsWith('/api/journal/') ? DETAIL : listed
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Der Verlauf nennt jede Gruppe und lädt die Einzelheiten erst beim Aufklappen', async () => {
  render(<Verlauf />)
  const summary = await screen.findByText('Wohnung gelöscht: EG links')
  expect(screen.getByText('(2 Änderungen)')).toBeTruthy()
  expect(sent).toEqual(['/api/journal?limit=50'])
  const details = summary.closest('details')
  if (!details) throw new Error('kein details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(await screen.findByText('Mietverhältnis gelöscht: Müller')).toBeTruthy()
  expect(sent).toEqual(['/api/journal?limit=50', '/api/journal/7'])
  expect(screen.getByText('Mieter:')).toBeTruthy()
  expect(screen.getByText('01.01.2024')).toBeTruthy()
})

test('Ohne Änderungen sagt die Seite, was hier stehen wird', async () => {
  listed = []
  render(<Verlauf />)
  expect(await screen.findByText(/Noch keine Änderungen/)).toBeTruthy()
})

test('Eine Änderung zeigt nur die geänderten Felder mit alt und neu, in der Sprache der Oberfläche', () => {
  const change: JournalChange = {
    id: 1, table: 'cost_items', key: { id: 'c1' }, op: 'update',
    before: { id: 'c1', description: 'Grundsteuer', amount_cents: 12000, paid_on: null },
    after: { id: 'c1', description: 'Grundsteuer', amount_cents: 12500, paid_on: '2025-02-15' },
    changed: ['amount_cents', 'paid_on'],
  }
  expect(changeTitle(change)).toBe('Kostenposition geändert: Grundsteuer')
  expect(fieldLines(change)).toEqual([
    { column: 'amount_cents', label: 'Betrag', before: formatValue('amount_cents', 12000), after: formatValue('amount_cents', 12500) },
    { column: 'paid_on', label: 'Bezahlt am', before: 'leer', after: '15.02.2025' },
  ])
})

test('Werte: Kennzeichen, eingefrorener Stand und unbekannte Spalten', () => {
  expect(formatValue('participates', 1)).toBe('ja')
  expect(formatValue('settlement', { $omitted: 1, length: 900 })).toBe('eingefrorener Stand (nicht im Verlauf)')
  expect(formatValue('irgendwas', 'x')).toBe('x')
  expect(changeTitle({ id: 1, table: 'neue_tabelle', key: {}, op: 'insert', before: null, after: {}, changed: [] })).toBe('neue_tabelle angelegt')
})
