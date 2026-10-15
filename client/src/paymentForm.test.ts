import { describe, expect, test } from 'vitest'
import { emptyPaymentForm, PAYMENT_KIND_OPTIONS, paymentBody, paymentTenancyOptions, savedText } from './paymentForm'

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
    expect(paymentBody({ ...emptyPaymentForm('t1', '2025-06-15'), amount: '0' })).toHaveProperty('error')
    expect(paymentBody({ ...emptyPaymentForm('', '2025-06-15'), amount: '1' })).toHaveProperty('error')
    expect(paymentBody({ ...emptyPaymentForm('t1', '15.06.2025'), amount: '1' })).toHaveProperty('error')
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
