// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import HeatingPeriodSelect from './HeatingPeriodSelect'

afterEach(cleanup)

test('Die Heizperiode zeigt den gespeicherten Wert', () => {
  render(<HeatingPeriodSelect options={[{ value: '2024-05', label: 'Heizperiode 2024/2025' }, { value: '2025-05', label: 'Heizperiode 2025/2026' }]} value="2025-05" onChange={() => {}} />)
  const select = screen.getByRole('combobox', { name: 'Heizperiode' }) as HTMLSelectElement
  expect(select.value).toBe('2025-05')
  expect(select.selectedOptions[0]?.textContent).toBe('Heizperiode 2025/2026')
})

test('Laienprobe B16: der Satz sagt, wohin die Rechnung einer späteren Heizperiode gehört', () => {
  render(<HeatingPeriodSelect options={[{ value: '2025-05', label: 'Heizperiode 2025/2026 (01.05.2025–30.04.2026)' }]} value="2025-05" onChange={() => {}} />)
  expect(screen.getByText(/Die Rechnung einer späteren Heizperiode erfassen Sie im Abrechnungszeitraum, in dem sie endet/)).toBeTruthy()
})
