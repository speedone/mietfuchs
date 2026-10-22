// Rückfragen vor Druck und Abschluss (despiteErrors.ts).
import { expect, test } from 'vitest'
import type { Notice } from './types'
import { closeErrorsQuestion, closeMessage } from './despiteErrors'

const FEHLER: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'EG: zugleich.', subject: { kind: 'tenancy', id: 't1' } }

// #409: Auch mit Fehlern fragt die erste Rückfrage zum Abschließen, ob alle Rechnungen vorliegen; sonst
// verspräche der Abschluss eine Vollständigkeit, die Mietfuchs nicht kennen kann.
test('Rückfrage zum Abschließen fragt nach allen Rechnungen des Zeitraums (#409)', () => {
  expect(closeMessage('2025')).toMatch(/^Liegen alle Rechnungen für 2025 vor/)
  expect(closeErrorsQuestion('Abrechnung 2025 abschließen?', [FEHLER], '2025')?.message).toContain('Liegen alle Rechnungen für 2025 vor')
  expect(closeErrorsQuestion('Abrechnung 2025 abschließen?', [], '2025')).toBeNull()
})
