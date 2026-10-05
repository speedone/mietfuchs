import { describe, expect, test } from 'vitest'
import { deadlineView, historyView } from './settlementHistory'
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

describe('Frist nach § 556 Abs. 3 BGB nach dem Wiederöffnen (#142)', () => {
  const heute = new Date('2026-10-01T12:00:00Z')
  const frueher = (sentAt: string | null, id = 'h') => ({ id, closedAt: '2026-01-10T09:00:00.000Z', sentAt, reopenedAt: '2026-03-01T10:00:00.000Z', settlement: {} })

  test('ohne Versand: die verbleibenden Tage wie bisher', () => {
    const v = deadlineView('2025', '2026-12-31', null, [], heute)
    expect(v.level).toBe('ok')
    expect(v.text).toBe('Abrechnungsfrist (§556 BGB): Die Abrechnung 2025 muss dem Mieter bis zum 31.12.2026 zugehen — noch 91 Tage.')
  })

  test('versandt: gewahrt', () => {
    expect(deadlineView('2025', '2026-12-31', '2026-01-12', [], heute).text).toBe('Abrechnung 2025 am 12.01.2026 versendet — die Frist nach §556 BGB (31.12.2026) ist gewahrt.')
  })

  test('nach dem Wiederöffnen bleibt der frühere Versand sichtbar, statt dass die Frist neu zu laufen scheint', () => {
    const v = deadlineView('2025', '2026-12-31', null, [frueher('2026-01-12')], heute)
    expect(v.text).toContain('am 12.01.2026')
    expect(v.text).toContain('gewahrt')
    expect(v.text).toContain('bis zum 31.12.2026')
    expect(v.text).toContain('noch 91 Tage')
    expect(v.text).not.toMatch(/^Abrechnungsfrist/)
  })

  test('mehrere frühere Abschlüsse: es zählt der erste Versand', () => {
    const v = deadlineView('2025', '2026-12-31', null, [frueher('2026-05-02', 'h2'), frueher('2026-01-12', 'h1'), frueher(null, 'h0')], heute)
    expect(v.text).toContain('am 12.01.2026')
    expect(v.text).not.toContain('02.05.2026')
  })

  test('Frist abgelaufen, aber rechtzeitig versandt: kein Fehler, sondern der Hinweis auf die Berichtigung', () => {
    const v = deadlineView('2024', '2025-12-31', null, [frueher('2025-06-01')], heute)
    expect(v.level).toBe('notice')
    expect(v.text).toContain('am 01.06.2025')
    expect(v.text).toContain('abgelaufen')
    // § 556 Abs. 3 Satz 3 BGB lässt eine Ausnahme zu, wenn der Vermieter die Verspätung nicht zu vertreten hat.
    expect(v.text).toContain('kann in der Regel keine höhere Nachzahlung mehr fordern')
  })

  test('schon der frühere Versand lag nach Fristende: jede Nachforderung ist in der Regel ausgeschlossen', () => {
    const v = deadlineView('2024', '2025-12-31', null, [frueher('2026-02-01')], heute)
    expect(v.level).toBe('error')
    expect(v.text).toContain('am 01.02.2026')
    expect(v.text).toContain('Nachforderungen sind in der Regel ausgeschlossen')
    expect(v.text).not.toContain('höhere Nachzahlung')
  })

  test('Mai bis April: Bezeichnung und Frist kommen von der Abrechnung (#208)', () => {
    expect(deadlineView('2025/2026', '2027-04-30', null, [], heute).text)
      .toBe('Abrechnungsfrist (§556 BGB): Die Abrechnung 2025/2026 muss dem Mieter bis zum 30.04.2027 zugehen — noch 211 Tage.')
  })
})
