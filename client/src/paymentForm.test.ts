import { describe, expect, test } from 'vitest'
import { emptyPaymentForm, hasSettlementPayments, newPaymentForm, noRentYearText, PAYMENT_KIND_OPTIONS, paymentBody, paymentFormHints, paymentTenancyOptions, rentWithoutRow, savedText, SETTLEMENT_OFFSET_HINT } from './paymentForm'

const ledger = { rows: [{ tenancyId: 't1', tenantName: 'Müller', unitName: 'EG' }] } as const
const tenancies = [
  { id: 't1', tenantName: 'Müller', unitId: 'u1' },
  { id: 't0', tenantName: 'Schmidt', unitId: 'u1' }, // ausgezogen, keine Zeile im Jahr
]
const unitName = (id: string) => (id === 'u1' ? 'EG' : '—')

describe('Zahlung erfassen: die Art (#280)', () => {
  test('Voreinstellung ist Miete, und jede Art steht in der Auswahl', () => {
    const form = emptyPaymentForm('t1', '2025-06-15')
    expect(form.kind).toBe('rent')
    expect(PAYMENT_KIND_OPTIONS.map((o) => o.value)).toEqual(['rent', 'settlement'])
  })

  test('der Rumpf trägt die Art, ein Guthaben negativ', () => {
    const built = paymentBody({ ...emptyPaymentForm('t1', '2025-06-15'), amount: '-200,00', kind: 'settlement' })
    expect(built).toEqual({ body: { tenancyId: 't1', date: '2025-06-15', amountCents: -20000, kind: 'settlement', note: undefined } })
    expect(paymentBody({ ...emptyPaymentForm('t1', '2025-06-15'), amount: '800' })).toEqual({
      body: { tenancyId: 't1', date: '2025-06-15', amountCents: 80000, kind: 'rent', note: undefined },
    })
  })

  test('ohne Betrag, Datum oder Mietverhältnis kein Rumpf', () => {
    const fields = (form: Parameters<typeof paymentBody>[0]) => {
      const r = paymentBody(form)
      return 'problems' in r ? r.problems.map((p) => p.field) : []
    }
    expect(fields({ ...emptyPaymentForm('t1', '2025-06-15'), amount: '0' })).toEqual(['amount'])
    expect(fields({ ...emptyPaymentForm('', '2025-06-15'), amount: '1' })).toEqual(['tenancyId'])
    expect(fields({ ...emptyPaymentForm('t1', '15.06.2025'), amount: '1' })).toEqual(['date'])
    // #346, Schritt 3 (UI-Durchsicht M5): jede fehlende Angabe mit ihrem Feld, kein Sammelsatz.
    expect(fields({ ...emptyPaymentForm('', ''), amount: '' })).toEqual(['tenancyId', 'date', 'amount'])
  })

  test('Miete bietet die Zeilen des Mietkontos an, die Abrechnung auch ausgezogene Mieter', () => {
    expect(paymentTenancyOptions('rent', ledger, tenancies, unitName, '').map((o) => o.value)).toEqual(['t1'])
    expect(paymentTenancyOptions('settlement', ledger, tenancies, unitName, '')).toEqual([
      { value: 't1', label: 'Müller · EG' },
      { value: 't0', label: 'Schmidt · EG' },
    ])
    // Wer nach der Wahl zurück auf Miete stellt, sieht weiter, was gewählt ist.
    expect(paymentTenancyOptions('rent', ledger, tenancies, unitName, 't0').map((o) => o.value)).toEqual(['t1', 't0'])
  })

  test('die Bestätigung nennt Nachzahlung und Guthaben', () => {
    expect(savedText({ amountCents: 15000, kind: 'settlement' })).toMatch(/^Nachzahlung aus der Abrechnung über 150,00/)
    expect(savedText({ amountCents: -20000, kind: 'settlement' })).toMatch(/^Guthaben aus der Abrechnung über 200,00/)
    expect(savedText({ amountCents: 80000, kind: 'rent' })).toMatch(/^Zahlung über 800,00/)
  })
})

describe('Durchsicht von #280', () => {
  test('M1: bei einem Guthaben der Satz zur Verrechnung mit der Miete, volle Miete als Miete', () => {
    const form = { ...emptyPaymentForm('t1', '2025-06-15'), kind: 'settlement' as const }
    expect(paymentFormHints({ ...form, amount: '-200,00' })).toContain(SETTLEMENT_OFFSET_HINT)
    expect(SETTLEMENT_OFFSET_HINT).toMatch(/Miete in voller Höhe als „Miete“/)
    expect(SETTLEMENT_OFFSET_HINT).toMatch(/Guthaben mit Minus als „Abrechnung“/)
    expect(paymentFormHints({ ...form, amount: '150' })).not.toContain(SETTLEMENT_OFFSET_HINT)
    expect(paymentFormHints({ ...form, kind: 'rent', amount: '-200' })).toEqual([])
    // Der Grundsatz sagt nicht mehr, ein verrechnetes Guthaben sei allein mit Minus einzutragen.
    expect(paymentFormHints({ ...form, amount: '' }).join(' ')).not.toMatch(/verrechnetes Guthaben mit Minus/)
  })

  test('M2b: ohne Zeile im Mietkonto beginnt das Formular mit „Abrechnung“', () => {
    expect(newPaymentForm({ rows: [] }, '2026-03-01')).toMatchObject({ kind: 'settlement', tenancyId: '' })
    expect(newPaymentForm(null, '2026-03-01').kind).toBe('settlement')
    expect(newPaymentForm(ledger, '2025-03-01')).toMatchObject({ kind: 'rent', tenancyId: 't1' })
    expect(noRentYearText(2026)).toBe('In 2026 besteht kein Mietverhältnis; hier lassen sich nur Nachzahlungen oder Guthaben aus der Abrechnung erfassen.')
  })

  test('M2b: eine Miete für ein Mietverhältnis ohne Zeile wird erkannt, eine Abrechnung nicht', () => {
    expect(rentWithoutRow({ kind: 'rent', tenancyId: 't0' }, ledger)).toBe(true)
    expect(rentWithoutRow({ kind: 'settlement', tenancyId: 't0' }, ledger)).toBe(false)
    expect(rentWithoutRow({ kind: 'rent', tenancyId: 't1' }, ledger)).toBe(false)
    expect(rentWithoutRow({ kind: 'rent', tenancyId: '' }, ledger)).toBe(false)
  })

  test('N1: Zahlungen aus der Abrechnung zählen nach Vorhandensein, nicht nach Summe', () => {
    const payments = [
      { tenancyId: 't1', date: '2025-03-01', kind: 'settlement' as const },
      { tenancyId: 't1', date: '2025-04-01', kind: 'settlement' as const },
      { tenancyId: 't2', date: '2024-04-01', kind: 'settlement' as const },
      { tenancyId: 't2', date: '2025-04-01', kind: 'rent' as const },
    ]
    expect(hasSettlementPayments(payments, 2025)).toBe(true)
    expect(hasSettlementPayments(payments, 2025, 't1')).toBe(true)
    expect(hasSettlementPayments(payments, 2025, 't2')).toBe(false)
    expect(hasSettlementPayments(payments, 2026)).toBe(false)
  })
})
