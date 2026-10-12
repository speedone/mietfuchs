// Gutschrift ohne Rechnung (#251): die Frage „Was ist diese Gutschrift?“, ohne DOM.
import { expect, test } from 'vitest'
import { CREDIT_ANSWERS, creditAction, creditOnlyOf, creditTargetOptions, PAYMENT_GUIDE, reassignBody } from './fuelCredit'
import type { FuelDelivery } from './types'

const lieferung = (over: Partial<FuelDelivery>): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Gas', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], creditNoteKind: null, ...over,
})
const d0 = lieferung({ id: 'd0', label: 'Rechnung d0' })
const d1 = lieferung({ id: 'd1', label: 'Rechnung d1', invoiceFrom: '2025-07-14', invoiceTo: '2026-09-25' })
const storno = lieferung({ id: 'st', label: 'Storniert' })
const schaetzung = lieferung({ id: 'e', label: 'Schätzung', estimated: true, amountCents: 1000 })
const fremd = lieferung({ id: 'x', plantId: 'hp2', label: 'Anbau' })
const items = [
  { fuelDeliveryId: 'd0', amountCents: 617603 }, { fuelDeliveryId: 'd1', amountCents: 0 }, { fuelDeliveryId: 'd1', amountCents: -30451 },
  { fuelDeliveryId: 'st', amountCents: 1000 }, { fuelDeliveryId: 'st', amountCents: -1000 }, { fuelDeliveryId: 'x', amountCents: 5000 },
]

test('Gutschrift ohne Rechnung: nur echte Lieferungen, deren Positionen zusammen weniger als 0 € ergeben', () => {
  expect(creditOnlyOf([d0, d1, storno, schaetzung], items)).toEqual([{ delivery: d1, cents: -30451 }])
})

test('Ziele: Rechnungen derselben Anlage über mehr als 0 €, ohne Schätzung und ohne die Gutschrift selbst', () => {
  expect(creditTargetOptions(d1, [d0, d1, storno, schaetzung, fremd], items)).toEqual([
    { value: '', label: '— bitte wählen —' },
    { value: 'd0', label: 'Rechnung d0 (01.05.2025–30.04.2026)' },
  ])
})

test('Antwort 1 ordnet zu; mit Rücknahme die berichtigten Mengenfelder, sonst nur das Ziel', () => {
  expect(reassignBody({ targetId: '', returned: false, quantity: '', emissionsKg: '', co2Cost: '' })).toEqual({ error: 'Bitte wählen Sie die Lieferung, die die Gutschrift berichtigt.' })
  expect(reassignBody({ targetId: 'd0', returned: false, quantity: '4800', emissionsKg: '1', co2Cost: '1' })).toEqual({ body: { targetId: 'd0' } })
  expect(reassignBody({ targetId: 'd0', returned: true, quantity: '4800', emissionsKg: '960,5', co2Cost: '48,00' })).toEqual({ body: { targetId: 'd0', quantity: 4800, emissionsKg: 960.5, co2CostCents: 4800 } })
  expect(reassignBody({ targetId: 'd0', returned: true, quantity: '', emissionsKg: '', co2Cost: '' })).toEqual({ error: 'Bitte tragen Sie die berichtigte Menge der Rechnung ein.' })
  expect(creditAction('reassign', d1)).toEqual({ kind: 'reassign', url: '/api/fuel-deliveries/d1/reassign-credit' })
})

test('5f: Antwort 3 speichert die Angabe; Antwort 2 ist nur eine Anleitung und schreibt nichts', () => {
  expect(creditAction('standalone', d1)).toEqual({ kind: 'save', url: '/api/fuel-deliveries/d1', body: { creditNoteKind: 'standalone' } })
  expect(creditAction('payment', d1)).toEqual({ kind: 'guide', text: PAYMENT_GUIDE })
  expect(CREDIT_ANSWERS.map((a) => a.label)).toEqual([
    'Sie berichtigt eine andere Lieferung',
    'Sie ist der Zahlbetrag nach Abzug der Abschläge',
    'Sie ist eine Gutschrift, deren Rechnung nicht in Mietfuchs steht',
  ])
  expect(PAYMENT_GUIDE).toBe('Tragen Sie als Betrag die Kosten laut Rechnung für den Abrechnungszeitraum ein, nicht das Guthaben oder den Zahlbetrag. Abschläge sind Zahlungen, keine Kosten.')
})
