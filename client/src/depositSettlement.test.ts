// Die Aufstellung zum Auszug (#228, Teil 2): was eingegangen, verrechnet und ausgezahlt ist, der Einbehalt und was
// auszuzahlen bleibt; dazu die letzte Abrechnung und ausstehende Zeiträume als Orientierung.
import { expect, test } from 'vitest'
import type { DepositEntry, DepositStatementInfo, Tenancy } from './types'
import { depositAppliedText, depositSettlement, depositsAfterMoveOut } from './depositSettlement'

const TENANCY: Tenancy = {
  id: 't', unitId: 'u', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2022-01-01', end: '2025-12-31',
  prepayments: [], prepaymentOverrides: {}, baseRents: [], depositCents: 240000,
}
const ENTRIES: DepositEntry[] = [
  { id: 'a', tenancyId: 't', date: '2022-01-05', kind: 'received', amountCents: 240000 },
  { id: 'b', tenancyId: 't', date: '2025-12-31', kind: 'interest', amountCents: 1234, note: 'Zinsen 2022 bis 2025' },
]
const INFO: DepositStatementInfo = { tenancyId: 't', last: { label: '2024', balanceCents: -18000 }, lastHeating: null, pending: ['2025'], openRentCents: 0 }
const TODAY = '2026-01-15'

test('bleibt auszuzahlen ist Stand minus Einbehalt', () => {
  const s = depositSettlement({ ...TENANCY, depositHoldCents: 30000, depositHoldNote: 'Nebenkosten 2025' }, ENTRIES, INFO, TODAY)
  expect(s?.balanceCents).toBe(241234)
  expect(s?.hold).toEqual({ cents: 30000, note: 'Nebenkosten 2025' })
  expect(s?.payoutCents).toBe(211234)
})

test('ein Einbehalt über dem Stand wird auf den Stand begrenzt', () => {
  const s = depositSettlement({ ...TENANCY, depositHoldCents: 999900, depositHoldNote: 'Schaden' }, ENTRIES, INFO, TODAY)
  expect(s?.hold).toEqual({ cents: 241234, note: 'Schaden' })
  expect(s?.payoutCents).toBe(0)
})

test('Zeilen in der Reihenfolge Eingänge, Erträge, Verrechnungen, Rückzahlungen', () => {
  const entries: DepositEntry[] = [
    { id: 'r', tenancyId: 't', date: '2026-01-10', kind: 'refunded', amountCents: 100000 },
    { id: 'x', tenancyId: 't', date: '2026-01-05', kind: 'applied', purpose: 'rent', amountCents: 95000, paymentId: 'p' },
    ...ENTRIES,
  ]
  const s = depositSettlement(TENANCY, entries, INFO, TODAY)
  expect(s?.rows.map((r) => [r.label, r.cents])).toEqual([
    ['Eingang', 240000], ['Ertrag (Zinsen)', 1234], ['Verrechnung (Mietrückstand)', -95000], ['Rückzahlung an den Mieter', -100000],
  ])
  expect(s?.balanceCents).toBe(46234)
})

test('letzte Abrechnung und ausstehende Zeiträume als Orientierung', () => {
  const s = depositSettlement(TENANCY, ENTRIES, INFO, TODAY)
  expect(s?.lastStatement?.replace(/ /g, ' ')).toBe('Nebenkostenabrechnung 2024: Nachzahlung 180,00 €')
  expect(s?.pending).toEqual(['Abrechnung für 2025 steht noch aus'])
  const credit = depositSettlement(TENANCY, ENTRIES, { ...INFO, last: { label: '2024', balanceCents: 9500 }, pending: [] }, TODAY)
  expect(credit?.lastStatement?.replace(/ /g, ' ')).toBe('Nebenkostenabrechnung 2024: Guthaben 95,00 €')
  expect(credit?.pending).toEqual([])
  expect(depositSettlement(TENANCY, ENTRIES, undefined, TODAY)?.lastStatement).toBeNull()
})

test('keine Aufstellung vor dem Auszug, ohne Mietende oder ohne Buchung', () => {
  expect(depositSettlement({ ...TENANCY, end: '2026-01-16' }, ENTRIES, INFO, TODAY)).toBeNull()
  expect(depositSettlement({ ...TENANCY, end: null }, ENTRIES, INFO, TODAY)).toBeNull()
  expect(depositSettlement(TENANCY, [], INFO, TODAY)).toBeNull()
  // Am Tag des Auszugs gibt es sie.
  expect(depositSettlement({ ...TENANCY, end: TODAY }, ENTRIES, INFO, TODAY)).not.toBeNull()
})

test('Stand 0: nichts auszuzahlen, kein Einbehalt', () => {
  const entries: DepositEntry[] = [...ENTRIES, { id: 'r', tenancyId: 't', date: '2026-01-10', kind: 'refunded', amountCents: 241234 }]
  const s = depositSettlement({ ...TENANCY, depositHoldCents: 30000, depositHoldNote: 'x' }, entries, INFO, TODAY)
  expect(s?.payoutCents).toBe(0)
  expect(s?.hold).toBeNull()
})

test('Kaution nach Auszug: ausgezogen, Stand über 0, mit Buchungen', () => {
  const moved = { ...TENANCY, id: 't', end: '2026-01-14' }
  const running = { ...TENANCY, id: 'r', tenantName: 'Laufend', end: null }
  const tomorrow = { ...TENANCY, id: 'm', tenantName: 'Morgen', end: '2026-01-16' }
  const empty = { ...TENANCY, id: 'e', tenantName: 'Ohne Buchung', end: '2025-06-30' }
  const paid = { ...TENANCY, id: 'p', tenantName: 'Ausgezahlt', end: '2025-06-30' }
  const entries: DepositEntry[] = [
    { id: '1', tenancyId: 't', date: '2022-01-05', kind: 'received', amountCents: 160000 },
    { id: '2', tenancyId: 'r', date: '2022-01-05', kind: 'received', amountCents: 160000 },
    { id: '3', tenancyId: 'm', date: '2022-01-05', kind: 'received', amountCents: 160000 },
    { id: '4', tenancyId: 'p', date: '2022-01-05', kind: 'received', amountCents: 160000 },
    { id: '5', tenancyId: 'p', date: '2025-07-10', kind: 'refunded', amountCents: 160000 },
  ]
  expect(depositsAfterMoveOut([moved, running, tomorrow, empty, paid], entries, TODAY)).toEqual([
    { tenancyId: 't', tenantName: 'Erika Mustermann', end: '2026-01-14', balanceCents: 160000 },
  ])
})

test('Hinweis der Steuer: einbehalten für Schaden oder Sonstiges im Jahr, nicht in den Einnahmen', () => {
  const entries: DepositEntry[] = [
    { id: '1', tenancyId: 't', date: '2026-02-01', kind: 'applied', purpose: 'damage', amountCents: 30000 },
    { id: '2', tenancyId: 't', date: '2026-03-01', kind: 'applied', purpose: 'other', amountCents: 5000 },
    { id: '3', tenancyId: 't', date: '2026-03-01', kind: 'applied', purpose: 'rent', amountCents: 95000, paymentId: 'p' },
    { id: '4', tenancyId: 't', date: '2025-12-31', kind: 'applied', purpose: 'damage', amountCents: 1000 },
  ]
  expect(depositAppliedText(entries, 2026)?.replace(/\u00a0/g, ' ')).toBe('Aus Kautionen einbehalten, nicht in den Einnahmen enthalten: 350,00 €. Ob und wo das anzugeben ist, hängt vom Grund ab.')
  expect(depositAppliedText(entries.slice(2, 3), 2026)).toBeNull()
  expect(depositAppliedText(entries, 2024)).toBeNull()
})

// Nachzügler: Die getrennte Heizkostenabrechnung einer Anlage (Weg d) steht als eigene Zeile unter der Orientierung.
test('letzte Heizkostenabrechnung einer Anlage als eigene Zeile', () => {
  const s = depositSettlement(TENANCY, ENTRIES, { ...INFO, lastHeating: { label: '2024/2025', balanceCents: 4200 }, pending: ['2025', 'Heizkosten 2025/2026'] }, TODAY)
  expect(s?.lastHeatingStatement?.replace(/\u00a0/g, ' ')).toBe('Heizkostenabrechnung 2024/2025: Guthaben 42,00 €')
  expect(s?.pending).toEqual(['Abrechnung für 2025 steht noch aus', 'Abrechnung für Heizkosten 2025/2026 steht noch aus'])
  expect(depositSettlement(TENANCY, ENTRIES, INFO, TODAY)?.lastHeatingStatement).toBeNull()
})

// Nachzügler: Invariante über zufällige Buchungen und Einbehalte (fester Startwert). Was auszuzahlen bleibt und der
// Einbehalt ergeben zusammen den Stand; keiner ist negativ; der Einbehalt übersteigt den Stand nie; die Zeilen summieren
// sich zum Stand, solange er nicht unter 0 liegt.
test('Invariante: Auszahlung plus Einbehalt ist der Stand, nichts negativ', () => {
  let seed = 228
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const kinds = ['received', 'interest', 'applied', 'refunded'] as const
  for (let run = 0; run < 500; run++) {
    const entries: DepositEntry[] = Array.from({ length: 1 + rand(6) }, (_, i) => {
      const kind = kinds[rand(4)] ?? 'received'
      return { id: `e${i}`, tenancyId: 't', date: `2025-0${1 + rand(9)}-1${rand(10)}`, kind, amountCents: 1 + rand(300000), ...(kind === 'applied' ? { purpose: 'damage' as const } : {}) }
    })
    const hold = rand(3) === 0 ? {} : { depositHoldCents: 1 + rand(400000), depositHoldNote: 'Grund' }
    const s = depositSettlement({ ...TENANCY, ...hold }, entries, INFO, TODAY) ?? expect.fail('keine Aufstellung')
    const held = s.hold?.cents ?? 0
    expect(s.payoutCents + held).toBe(s.balanceCents)
    expect(s.payoutCents).toBeGreaterThanOrEqual(0)
    expect(held).toBeGreaterThanOrEqual(0)
    expect(held).toBeLessThanOrEqual(s.balanceCents)
    const sum = s.rows.reduce((a, r) => a + r.cents, 0)
    expect(s.balanceCents).toBe(Math.max(0, sum))
  }
})
