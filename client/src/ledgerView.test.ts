import { describe, expect, it } from 'vitest'
import type { RentLedgerRow, RentMonth, RentMonthStatus } from './types'
import { showDecemberNote } from './ledgerView'

const month = (m: number, sollCents: number, status: RentMonthStatus): RentMonth => ({
  month: m, baseRentCents: sollCents, prepaymentCents: 0, sollCents, paidCents: status === 'paid' ? sollCents : 0, status,
})

// Eine Zeile mit zwölf Monaten, deren Dezember sich vorgeben lässt. Über den Typ gebaut, damit
// der Übersetzer mitprüft, dass hier wirklich eine Mietkonto-Zeile steht.
const row = (dezember: RentMonth): RentLedgerRow => ({
  tenancyId: 't1', tenantName: 'Müller', unitName: 'OG',
  months: [...Array.from({ length: 11 }, (_, i) => month(i + 1, 100000, 'paid')), dezember],
  sollYearCents: 1200000, baseRentYearCents: 1200000, prepaymentYearCents: 0,
  paidYearCents: 1100000, balanceCents: -100000, openMonths: 1,
})

const heute = new Date('2026-09-22T00:00:00Z')

describe('Mietkonto: der Hinweis zum offenen Dezember (#70)', () => {
  it('erscheint für ein vergangenes Jahr mit offenem Dezember', () => {
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2025, heute)).toBe(true)
    expect(showDecemberNote(row(month(12, 100000, 'partial')), 2025, heute)).toBe(true)
  })

  it('erscheint nicht im laufenden Jahr', () => {
    // **Der Befund der Durchsicht, gemessen.** `rentLedger` füllt immer alle zwölf Monate, der
    // Dezember des laufenden Jahres trägt also Soll und steht offen — im Januar genauso wie im
    // September. Ohne diese Bedingung bekäme jedes laufende Mietverhältnis den Hinweis das ganze
    // Jahr über, Monate bevor er etwas bedeuten kann.
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2026, heute)).toBe(false)
    // Und erst recht nicht für ein künftiges.
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2027, heute)).toBe(false)
  })

  it('erscheint nicht, wenn der Dezember bezahlt ist oder kein Soll trägt', () => {
    expect(showDecemberNote(row(month(12, 100000, 'paid')), 2025, heute)).toBe(false)
    // Kein Soll heißt, das Mietverhältnis lief im Dezember nicht mehr; `rentLedger` setzt den
    // Monat dann auf „paid", aber auch mit offenem Status gäbe es nichts zu erklären.
    expect(showDecemberNote(row(month(12, 0, 'open')), 2025, heute)).toBe(false)
  })

  it('kommt ohne Dezember-Eintrag nicht ins Straucheln', () => {
    // Eine Zeile ohne zwölf Monate erzeugt `rentLedger` nicht. Der Zugriff auf `months[11]` wäre
    // trotzdem ein `undefined`, und darauf eine Eigenschaft zu lesen beendete die Seite.
    const ohne: RentLedgerRow = { ...row(month(12, 100000, 'open')), months: [] }
    expect(showDecemberNote(ohne, 2025, heute)).toBe(false)
  })
})
