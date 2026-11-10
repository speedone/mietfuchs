// @vitest-environment jsdom
// Gespeicherter, nicht ausgewerteter Beleg mit abgelehnter E-Rechnung (#189): Der Grund steht offen da.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { KeptReceipt } from './KeptReceipt'

afterEach(cleanup)

test('KeptReceipt nennt, warum die E-Rechnung im PDF nicht übernommen wurde', () => {
  render(<KeptReceipt failure={{ error: 'nicht erreichbar', file: 'a.pdf', reason: 'unreachable', kept: true, eInvoiceRefusal: 'Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten.' }} onRetry={() => {}} />)
  expect(screen.getByText(/Die E-Rechnung im PDF wird nicht übernommen: Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten\./)).toBeTruthy()
})

test('KeptReceipt ohne E-Rechnung wie bisher', () => {
  render(<KeptReceipt failure={{ error: 'nicht erreichbar', file: 'a.pdf', reason: 'unreachable', kept: true }} onRetry={() => {}} />)
  expect(screen.queryByText(/E-Rechnung/)).toBeNull()
})

test('KeptReceipt zu einer XML-Datei: nur der Grund, keine KI, kein „Erneut versuchen“', () => {
  render(<KeptReceipt failure={{ error: 'Die E-Rechnung wird nicht übernommen. X', file: 'a.xml', reason: 'e-invoice', kept: true, eInvoiceRefusal: 'Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten.' }} onRetry={() => {}} onManual={() => {}} />)
  expect(screen.getByText(/^Die E-Rechnung wird nicht übernommen: Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten\. Ihr Beleg ist gespeichert/)).toBeTruthy()
  expect(screen.queryByText(/KI/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Von Hand erfassen' })).toBeTruthy()
})
