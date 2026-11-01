// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SpreadField from './SpreadField'
import { EMPTY_ITEM_FORM } from '../costForm'

// Integrationsdurchsicht 0.14 (S1): Was der Server ablehnt, steht schon vor dem Speichern am Feld.
describe('SpreadField', () => {
  afterEach(cleanup)
  const form = { ...EMPTY_ITEM_FORM, category: 'Nicht umlagefähig', amount: '1.000,00', spreadYears: '2' as const }
  it('zeigt einen Satz zur Ablehnung statt der Vorschau', () => {
    render(<SpreadField form={form} period={{ from: '2025-01-01' }} problem="Bitte tragen Sie das Datum der Zahlung ein." onChange={() => {}} />)
    expect(screen.getByRole('alert').textContent).toContain('Bitte tragen Sie das Datum der Zahlung ein.')
  })
  it('ohne Satz die Vorschau', () => {
    render(<SpreadField form={form} period={{ from: '2025-01-01' }} onChange={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
