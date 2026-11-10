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
