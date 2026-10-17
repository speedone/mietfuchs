import { describe, expect, it } from 'vitest'
import type { RentLedgerRow, RentMonth, RentMonthStatus } from './types'
import { bookingDate, newPaymentDate, rentDueNote, rowStanding, shareText, showDecemberNote } from './ledgerView'

const month = (m: number, sollCents: number, status: RentMonthStatus): RentMonth => ({
  month: m, baseRentCents: sollCents, prepaymentCents: 0, flatRateCents: 0, sollCents, paidCents: status === 'paid' ? sollCents : 0, status,
})

// Eine Zeile mit zwölf Monaten, deren Dezember sich vorgeben lässt. Über den Typ gebaut, damit
// der Übersetzer mitprüft, dass hier wirklich eine Mietkonto-Zeile steht.
const row = (dezember: RentMonth): RentLedgerRow => ({
  tenancyId: 't1', tenantName: 'Müller', unitName: 'OG',
  months: [...Array.from({ length: 11 }, (_, i) => month(i + 1, 100000, 'paid')), dezember],
  sollYearCents: 1200000, baseRentYearCents: 1200000, prepaymentYearCents: 0, flatRateYearCents: 0,
  paidYearCents: 1100000, settlementYearCents: 0, balanceCents: -100000, dueSollCents: 1200000, arrearsCents: 100000, openMonths: 1,
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

describe('Mietkonto: Stand einer Zeile im laufenden Jahr (#133, zweite Browserabnahme)', () => {
  const zeile = (over: Partial<RentLedgerRow>): RentLedgerRow => ({ ...row(month(12, 100000, 'notDue')), ...over })
  it('künftige Monate sind kein Rückstand: „bisher bezahlt“', () => {
    expect(rowStanding(zeile({ paidYearCents: 900000, balanceCents: -300000, dueSollCents: 900000, arrearsCents: 0 }))).toEqual({ kind: 'paidSoFar', cents: 300000 })
  })
  it('ein fälliger offener Monat ist ein Rückstand', () => {
    expect(rowStanding(zeile({ paidYearCents: 800000, balanceCents: -400000, dueSollCents: 900000, arrearsCents: 100000 }))).toEqual({ kind: 'arrears', cents: 100000 })
  })
  it('Überzahlung und ganz bezahlt', () => {
    expect(rowStanding(zeile({ paidYearCents: 1300000, balanceCents: 100000, dueSollCents: 1200000, arrearsCents: 0 }))).toEqual({ kind: 'credit', cents: 100000 })
    expect(rowStanding(zeile({ paidYearCents: 1200000, balanceCents: 0, dueSollCents: 1200000, arrearsCents: 0 }))).toEqual({ kind: 'paid', cents: 0 })
  })
})

describe('Mietkonto: Buchungsdatum beim Klick auf einen Monat (#133, letzte Durchsicht)', () => {
  const heute = new Date(2026, 9, 1)
  it('ein fälliger Monat: der Erste des Monats', () => {
    expect(bookingDate(2026, month(9, 100000, 'open'), heute)).toBe('2026-09-01')
  })
  it('ein noch nicht fälliger Monat: heute, denn gezahlt wird heute (Zuflussprinzip)', () => {
    expect(bookingDate(2026, month(12, 100000, 'notDue'), heute)).toBe('2026-10-01')
  })
})

describe('Datum einer neuen Zahlung (#142)', () => {
  const heute = new Date(2026, 9, 1, 12)
  it('im laufenden Jahr: heute', () => {
    expect(newPaymentDate(2026, heute)).toBe('2026-10-01')
  })
  it('ein früheres Jahr: der 31.12. dieses Jahres, nicht heute, damit die Zahlung im gewählten Jahr steht', () => {
    expect(newPaymentDate(2025, heute)).toBe('2025-12-31')
  })
  it('ein späteres Jahr: der 1. Januar', () => {
    expect(newPaymentDate(2027, heute)).toBe('2027-01-01')
  })
  it('örtlich gelesen, nicht in UTC: kurz nach Mitternacht am 1. Januar ist schon das neue Jahr', () => {
    const neujahr = new Date(2026, 0, 1, 0, 30)
    expect(newPaymentDate(2026, neujahr)).toBe('2026-01-01')
  })
})

describe('Mietkonto: der angebrochene Monat (#311)', () => {
  it('nennt den Anteil am Monat, ein voller Monat bleibt ohne Zusatz', () => {
    expect(shareText({ share: { days: 17, of: 31 } })).toBe('anteilig 17/31 Tage')
    expect(shareText({})).toBeNull()
  })
})

describe('Fälligkeit des laufenden Monats als Auskunft', () => {
  it('nennt den dritten Werktag nach den Feiertagen am Ort, ohne Samstag', () => {
    expect(rentDueNote(2027, new Date(2027, 0, 2), 'BW')).toBe(
      'Die Miete für Januar ist fällig bis Do., 07.01.2027 (3. Werktag, Samstag nicht mitgezählt; nach den Feiertagen in Baden-Württemberg). ' +
      'Als Rückstand zählt das Mietkonto den laufenden Monat erst ab dem nächsten.',
    )
    expect(rentDueNote(2026, new Date(2026, 7, 1), 'BE')).toMatch(/^Die Miete für August ist fällig bis Mi\., 05\.08\.2026 /)
  })

  it('ohne Bundesland zählen nur die bundesweiten Feiertage, und das steht dabei', () => {
    expect(rentDueNote(2027, new Date(2027, 0, 2), null)).toMatch(/fällig bis Mi\., 06\.01\.2027 \(3\. Werktag, Samstag nicht mitgezählt; nur nach den bundesweiten Feiertagen, weil beim Objekt kein Bundesland eingetragen ist\)/)
    expect(rentDueNote(2027, new Date(2027, 0, 2), undefined)).toBe(rentDueNote(2027, new Date(2027, 0, 2), null))
  })

  it('nach dem Tag „war fällig“, am Tag selbst noch „ist“', () => {
    expect(rentDueNote(2026, new Date(2026, 9, 5), 'BY')).toMatch(/^Die Miete für Oktober ist fällig bis Mo\., 05\.10\.2026/)
    expect(rentDueNote(2026, new Date(2026, 9, 6), 'BY')).toMatch(/^Die Miete für Oktober war fällig bis Mo\., 05\.10\.2026/)
  })

  it('nur im laufenden Jahr', () => {
    expect(rentDueNote(2025, new Date(2026, 9, 6), 'BY')).toBeNull()
    expect(rentDueNote(2027, new Date(2026, 9, 6), 'BY')).toBeNull()
  })
})
