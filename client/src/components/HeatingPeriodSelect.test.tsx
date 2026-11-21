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

// Sichtprüfung E23: Das Feld erschien mit „Heizung und Warmwasser“ ohne Satz, warum es da ist.
test('E23: der Satz sagt, warum nach der Heizperiode gefragt wird', () => {
  render(<HeatingPeriodSelect options={[{ value: '2025-05', label: 'Heizperiode 2025/2026 (01.05.2025–30.04.2026)' }]} value="2025-05" onChange={() => {}} />)
  expect(screen.getByText(/Ihre Heizung rechnet in einem eigenen Zeitraum ab, der Heizperiode\. Wählen Sie die Heizperiode, die die Rechnung abdeckt; mit ihr wird die Position abgerechnet\./)).toBeTruthy()
})

// #690 (Durchsicht): Steht die laufende Heizperiode zur Wahl, darf der Satz nicht sagen, hier stünden nur die endenden.
test('#690: mit der laufenden Heizperiode nennt der Satz sie; ohne sie bleibt er wortgleich', () => {
  const OHNE = 'Ihre Heizung rechnet in einem eigenen Zeitraum ab, der Heizperiode. Wählen Sie die Heizperiode, die die Rechnung abdeckt; mit ihr wird die Position abgerechnet. Hier stehen die Heizperioden, die in diesem Abrechnungszeitraum enden. Die Rechnung einer späteren Heizperiode erfassen Sie im Abrechnungszeitraum, in dem sie endet.'
  render(<HeatingPeriodSelect options={[{ value: '2025-07', label: 'Heizperiode 2025/2026' }]} value="2025-07" onChange={() => {}} />)
  expect(screen.getByText(OHNE)).toBeTruthy()
  cleanup()
  render(<HeatingPeriodSelect options={[{ value: '2025-07', label: 'Heizperiode 2025/2026' }, { value: '2026-07', label: 'Heizperiode 2026/2027, läuft noch', current: true }]} value="2025-07" onChange={() => {}} />)
  expect(screen.queryByText(OHNE)).toBeNull()
  expect(screen.queryByText(/Die Rechnung einer späteren Heizperiode erfassen Sie/)).toBeNull()
  expect(screen.getByText(/Hier stehen die Heizperioden, die in diesem Abrechnungszeitraum enden, und die laufende Heizperiode\. Die laufende wird in dem Abrechnungszeitraum abgerechnet, in dem sie endet\./)).toBeTruthy()
})
