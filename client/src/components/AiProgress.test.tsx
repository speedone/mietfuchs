// @vitest-environment jsdom
// Die Fortschrittsanzeige einer laufenden KI-Auswertung: Sie soll zeigen, dass etwas passiert,
// wie lange es schon dauert, und sich abbrechen lassen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AiProgressBadge } from './AiProgress'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('zeigt Phase und mitlaufende Zeit, nach einer Minute den Hinweis auf langsame Rechner', () => {
  render(<AiProgressBadge progress={{ step: 'extraction', phase: 'waiting' }} startedAt={Date.now()} onCancel={() => {}} />)
  expect(screen.getByText(/Modell liest den Beleg/)).toBeTruthy()
  expect(screen.getByText('0:00')).toBeTruthy()
  expect(screen.queryByText(/Ohne Grafikkarte/)).toBeNull()
  act(() => { vi.advanceTimersByTime(65_000) })
  expect(screen.getByText('1:05')).toBeTruthy()
  expect(screen.getByText(/Ohne Grafikkarte/)).toBeTruthy()
})

test('„Abbrechen“ ruft onCancel', () => {
  const onCancel = vi.fn()
  render(<AiProgressBadge progress={null} startedAt={Date.now()} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(onCancel).toHaveBeenCalledOnce()
})
