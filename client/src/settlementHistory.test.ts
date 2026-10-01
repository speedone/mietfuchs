import { describe, expect, test } from 'vitest'
import { historyView } from './settlementHistory'
import { fmtEuro } from './api'

describe('Frühere Abschlüsse (#56, Teil 2)', () => {
  test('je früherem Stand: wann abgeschlossen, versandt und wiedergeöffnet, und die Salden', () => {
    const v = historyView([{
      id: 'h1', closedAt: '2026-01-10T09:00:00.000Z', sentAt: '2026-01-12', reopenedAt: '2026-03-01T10:00:00.000Z',
      settlement: { totalCostsCents: 30000, statements: [{ tenancyId: 't', tenantName: 'Meier', unitName: 'EG', balanceCents: -5000 }] },
    }])
    expect(v).toEqual([{
      id: 'h1',
      head: 'Abgeschlossen am 10.01.2026, versandt am 12.01.2026, wiedergeöffnet am 01.03.2026',
      lines: [`Gesamtkosten ${fmtEuro(30000)}`, `Meier (EG): Nachzahlung ${fmtEuro(5000)}`],
    }])
  })

  test('ein früherer Stand, den diese Version nicht lesen kann, erscheint trotzdem mit seinen Daten', () => {
    const v = historyView([{ id: 'h2', closedAt: '2024-01-10T09:00:00.000Z', sentAt: null, reopenedAt: '2024-02-01T10:00:00.000Z', settlement: 'alt' }])
    expect(v[0]?.head).toBe('Abgeschlossen am 10.01.2024, nicht versandt, wiedergeöffnet am 01.02.2024')
    expect(v[0]?.lines).toEqual(['Den Inhalt dieses Standes kann diese Version nicht anzeigen.'])
  })
})
