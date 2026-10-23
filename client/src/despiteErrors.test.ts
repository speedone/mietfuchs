// Rückfragen vor Druck und Abschluss (despiteErrors.ts).
import { expect, test } from 'vitest'
import type { Notice } from './types'
import { closeErrorsQuestion, closeMessage, completenessQuestion, exportQuestion } from './despiteErrors'

const FEHLER: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'EG: zugleich.', subject: { kind: 'tenancy', id: 't1' } }

// #409: Auch mit Fehlern fragt die erste Rückfrage zum Abschließen, ob alle Rechnungen vorliegen; sonst
// verspräche der Abschluss eine Vollständigkeit, die Mietfuchs nicht kennen kann.
test('Rückfrage zum Abschließen fragt nach allen Rechnungen des Zeitraums (#409)', () => {
  expect(closeMessage('2025', 'mfh')).toMatch(/^Liegen alle Rechnungen für 2025 vor/)
  expect(closeErrorsQuestion('Abrechnung 2025 abschließen?', [FEHLER], completenessQuestion('2025', 'mfh'))?.message).toContain('Liegen alle Rechnungen für 2025 vor')
  expect(closeErrorsQuestion('Abrechnung 2025 abschließen?', [], completenessQuestion('2025', 'mfh'))).toBeNull()
})

// Durchsicht zu #409, Befund 3: Hausgeld nennt die Frage nur bei einer Eigentumswohnung, bei der getrennten
// Heizkostenabrechnung die Rechnungen der Heizung.
test('Rückfrage zum Abschließen nennt die Rechnungen, die zur Abrechnung passen (#409)', () => {
  expect(closeMessage('2025', 'etw')).toMatch(/Hausgeld/)
  expect(closeMessage('2025', 'mfh')).not.toMatch(/Hausgeld/)
  expect(closeMessage('2025', undefined)).not.toMatch(/Hausgeld/)
  const heating = closeMessage('2024/2025', 'etw', true)
  expect(heating).toMatch(/^Liegen alle Rechnungen für 2024\/2025 vor/)
  expect(heating).toMatch(/Brennstoff/)
  expect(heating).not.toMatch(/Hausgeld|Heizkostenabrechnung/)
})

// #415 Teil 3: Der Export einer offenen Abrechnung mit Fehlern fragt wie der Druck; die Datei trägt dann `draft`.
test('Rückfrage vor dem Export: nur bei einer offenen Abrechnung mit Fehlern', () => {
  const q = exportQuestion([FEHLER], false)
  expect(q?.cancelLabel).toBe('Nicht exportieren')
  expect(q?.confirmLabel).toBe('Trotzdem exportieren')
  expect(q?.message).toContain('Entwurf')
  expect(q?.errors).toEqual([FEHLER])
  expect(exportQuestion([FEHLER], true)).toBeNull()
  expect(exportQuestion([], false)).toBeNull()
})
