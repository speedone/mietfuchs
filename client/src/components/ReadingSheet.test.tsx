// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import ReadingSheet, { SheetPrinter } from './ReadingSheet'
import type { ReadingSheet as Sheet } from '../readingSheet'

const sheet: Sheet = {
  count: 2,
  groups: [
    { key: 'house', title: 'Hauptzähler (Haus)', rows: [{ id: 'a', name: 'Wasser Keller', meterNumber: '77', typeLabel: 'Kaltwasser', unit: 'm³', last: { value: 1234.5, date: '2025-12-31' }, mark: { kind: 'overdue', year: 2025 } }] },
    { key: 'unit:u1', title: 'EG', rows: [{ id: 'b', name: 'Küche', meterNumber: '', typeLabel: 'Warmwasser', unit: 'm³', last: null, mark: { kind: 'ending', year: 2027 } }] },
  ],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.className = ''
})

test('zeigt Gruppen, letzten Stand mit Datum, leere Felder und die Eichfrist', () => {
  render(<ReadingSheet sheet={sheet} propertyName="Lindenweg 12" />)
  expect(screen.getByRole('heading', { name: 'Hauptzähler (Haus)', hidden: true })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'EG', hidden: true })).toBeTruthy()
  const tables = screen.getAllByRole('table', { hidden: true })
  const first = within(tables[0]!).getAllByRole('row', { hidden: true })[1]!
  expect(first.textContent).toContain('1.234,5')
  expect(first.textContent).toContain('31.12.2025')
  expect(first.textContent).toContain('Eichfrist abgelaufen (Ende 2025)')
  expect(within(tables[1]!).getAllByRole('row', { hidden: true })[1]!.textContent).toContain('Eichfrist endet 2027')
  expect(within(tables[0]!).getAllByRole('columnheader', { hidden: true }).map((h) => h.textContent)).toEqual(['Bezeichnung und Ort', 'Zählernummer', 'Art', 'Einheit', 'Letzter Stand', 'Datum', 'Stand', 'Unterschrift'])
})

test('SheetPrinter setzt die Klasse, druckt einmal und räumt nach dem Druck auf', () => {
  vi.useFakeTimers()
  const print = vi.fn()
  vi.stubGlobal('print', print)
  const done = vi.fn()
  const { rerender } = render(<SheetPrinter sheet={sheet} propertyName="X" onDone={done} />)
  expect(document.body.classList.contains('print-reading-sheet')).toBe(true)
  vi.advanceTimersByTime(100)
  rerender(<SheetPrinter sheet={sheet} propertyName="X" onDone={done} />)
  vi.advanceTimersByTime(100)
  expect(print).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('afterprint'))
  expect(done).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('print-reading-sheet')).toBe(false)
})
