import { describe, expect, test } from 'vitest'
import { sentAtChangeQuestion, sentAtRefusal } from './sentAtStep'
import { deadlineView } from './settlementHistory'

describe('Versanddatum plausibel (#337)', () => {
  test('nicht nach heute, nicht vor dem Ende des Zeitraums; beide Grenzen gelten', () => {
    expect(sentAtRefusal('2026-03-10', '2025-12-31', '2026-03-10')).toBeNull()
    expect(sentAtRefusal('2025-12-31', '2025-12-31', '2026-03-10')).toBeNull()
    expect(sentAtRefusal('2026-03-11', '2025-12-31', '2026-03-10')).toBe('Das Versanddatum liegt nach heute. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging.')
    expect(sentAtRefusal('2025-12-30', '2025-12-31', '2026-03-10')).toBe('Das Versanddatum liegt vor dem Ende des Abrechnungszeitraums am 31.12.2025. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging.')
    expect(sentAtRefusal('', '2025-12-31', '2026-03-10')).toBeNull()
  })

  test('das erste Datum fragt nicht, eine Änderung und das Entfernen fragen', () => {
    expect(sentAtChangeQuestion('', '2026-03-01')).toBeNull()
    expect(sentAtChangeQuestion('2026-03-01', '2026-03-01')).toBeNull()
    expect(sentAtChangeQuestion('2026-03-01', '2026-03-05')).toEqual({
      title: 'Versanddatum ändern?',
      message: 'Gespeichert ist als Versanddatum der 01.03.2026, neu wäre es der 05.03.2026. Nach diesem Tag richtet sich die Frist nach § 556 Abs. 3 BGB. Ändern Sie es nur, wenn die Abrechnung an einem anderen Tag an die Mieter ging.',
      confirmLabel: 'Versanddatum ändern',
    })
    expect(sentAtChangeQuestion('2026-03-01', '')?.confirmLabel).toBe('Versanddatum entfernen')
  })

  test('ein gespeichertes, unplausibles Datum meldet die Frist nicht als gewahrt', () => {
    const heute = new Date(2026, 2, 10, 12)
    const zukunft = deadlineView('2025', '2026-12-31', '2026-06-01', [], heute, '2025-12-31')
    expect(zukunft.level).toBe('notice')
    expect(zukunft.text).not.toMatch(/gewahrt/)
    expect(zukunft.text).toBe('Als Versanddatum der Abrechnung 2025 ist der 01.06.2026 eingetragen. Das Versanddatum liegt nach heute. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging.')
    expect(deadlineView('2025', '2026-12-31', '2025-11-30', [], heute, '2025-12-31').text).toMatch(/vor dem Ende des Abrechnungszeitraums/)
    expect(deadlineView('2025', '2026-12-31', '2026-03-01', [], heute, '2025-12-31').text).toMatch(/gewahrt/)
  })

  test('ein unplausibles Versanddatum eines früheren Abschlusses zählt nicht als Versand', () => {
    const heute = new Date(2026, 2, 10, 12)
    const frueher = (sentAt: string) => ({ id: 'h', closedAt: '2026-01-10T09:00:00.000Z', sentAt, reopenedAt: '2026-03-01T10:00:00.000Z', settlement: {} })
    const zukunft = deadlineView('2025', '2026-12-31', null, [frueher('2026-06-01')], heute, '2025-12-31')
    expect(zukunft.level).toBe('notice')
    expect(zukunft.text).not.toMatch(/gewahrt/)
    expect(zukunft.text).toBe('Als Versanddatum einer früheren Fassung der Abrechnung 2025 ist der 01.06.2026 eingetragen. Das Versanddatum liegt nach heute. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging. Abrechnungsfrist (§ 556 BGB): Die Abrechnung 2025 muss dem Mieter bis zum 31.12.2026 zugehen - noch 296 Tage.')
    // Nach Fristende: kein „nach dem Ende der Frist“ aus einem Datum, das nicht stimmen kann; die Frist ohne Versand gilt.
    const spaet = deadlineView('2025', '2026-12-31', null, [frueher('2027-02-01')], new Date(2027, 0, 10, 12), '2025-12-31')
    expect(spaet.level).toBe('error')
    expect(spaet.text).not.toMatch(/nach dem Ende der Frist/)
    expect(spaet.text).toMatch(/^Als Versanddatum einer früheren Fassung der Abrechnung 2025 ist der 01\.02\.2027 eingetragen\. Das Versanddatum liegt nach heute\./)
    // Ein plausibles früheres Datum geht einem unplausiblen vor.
    expect(deadlineView('2025', '2026-12-31', null, [frueher('2025-11-01'), frueher('2026-01-12')], heute, '2025-12-31').text).toMatch(/am 12\.01\.2026 versendet .*gewahrt/)
  })
})
