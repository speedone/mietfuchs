// Die Karte „CO₂-Erstattung“ (Heizung PR 19, #97): Was aus dem Formular in den Rumpf der Erstattung wird.
import { expect, test } from 'vitest'
import { emptyRefundForm, refundAreaOf, refundBody, refundStatus, refundTenancies, refundToForm, type Co2RefundForm } from './co2RefundForm'
import { periodKey } from '../../shared/period.ts'

const P = periodKey('2025-01')
const form = (over: Partial<Co2RefundForm>): Co2RefundForm => ({ ...emptyRefundForm('t', 80), supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amount: '240,00', ...over })

test('Pflichtangaben und Betrag', () => {
  expect(refundBody(form({ tenancyId: '' }), P)).toEqual({ error: 'Bitte wählen Sie den Mieter.' })
  expect(refundBody(form({ claimedAt: '' }), P)).toEqual({ error: 'Bitte geben Sie den Tag an, an dem der Mieter die Erstattung in Textform verlangt hat.' })
  expect(refundBody(form({ amount: 'zwei' }), P)).toEqual({ error: 'Der Betrag laut Anzeige ist kein Betrag.' })
  expect(refundBody(form({}), P)).toMatchObject({ body: { tenancyId: 't', amountCents: 24000, settlePeriod: null, paidOutOn: null, areaM2: 80 } })
})

test('Verrechnen in dieser Abrechnung oder ausgezahlt', () => {
  expect(refundBody(form({ settle: 'here' }), P)).toMatchObject({ body: { settlePeriod: '2025-01', paidOutOn: null } })
  expect(refundBody(form({ settle: 'paid', paidOutOn: '' }), P)).toEqual({ error: 'Bitte geben Sie den Tag der Auszahlung an.' })
  expect(refundBody(form({ settle: 'paid', paidOutOn: '2025-04-01' }), P)).toMatchObject({ body: { settlePeriod: null, paidOutOn: '2025-04-01' } })
})

test('Grundlagen: leer heißt keine Angabe; gewerbliche Messung nur mit gewerblicher Nutzung; § 5a-Beträge nur mit Tag', () => {
  const b = refundBody(form({ emissionsKg: '2.400', co2Cost: '600,00', commercialUse: false, commercialMetered: true, gridFee: '', halfSplitFrom: '' }), P)
  expect(b).toMatchObject({ body: { emissionsKg: 2400, co2CostCents: 60000, commercialMetered: false, gridFeeCents: null, halfSplitFrom: null } })
  expect(refundBody(form({ gridFee: '120,00', halfSplitFrom: '' }), P)).toMatchObject({ body: { gridFeeCents: null } })
  expect(refundBody(form({ gridFee: '120,00', halfSplitFrom: '2028-01-01' }), P)).toMatchObject({ body: { gridFeeCents: 12000, halfSplitFrom: '2028-01-01' } })
  expect(refundBody(form({ areaM2: 'viel' }), P)).toEqual({ error: 'Die Wohnfläche ist eine Zahl ab 0.' })
})

test('Hin und zurück, und der Stand in der Liste', () => {
  const r = {
    id: 'e', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: P, paidOutOn: null,
    billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: 80, ownAppliances: true, commercialUse: false, commercialMetered: false,
    nonResidential: false, restriction: 'none' as const, halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
  }
  expect(refundToForm(r, P)).toMatchObject({ settle: 'here', amount: '240,00', ownAppliances: true, areaM2: '80' })
  expect(refundStatus({ ...r, settleLabel: '2025', refundDue: '2026-03-01' }, P)).toBe('in dieser Abrechnung verrechnet')
  expect(refundStatus({ ...r, settlePeriod: periodKey('2026-01'), settleLabel: '2026', refundDue: '2026-03-01' }, P)).toBe('verrechnet in der Abrechnung 2026')
  expect(refundStatus({ ...r, settlePeriod: null, settleLabel: null, refundDue: '2026-03-01' }, P)).toBe('offen, spätestens am 01.03.2026 zu erstatten')
  expect(refundStatus({ ...r, settlePeriod: null, paidOutOn: '2025-04-01', settleLabel: null, refundDue: '2026-03-01' }, P)).toBe('ausgezahlt am 01.04.2025')
})

test('Prüfung M4, S5: wählbar sind nur Mieter, die selbst heizen; die Fläche aller Wohnungen desselben Mieters (Auslegung)', () => {
  const t = (id: string, unitId: string, tenantName: string, heatingModel?: 'selfSupply', end: string | null = null) => ({ id, unitId, tenantName, start: '2020-01-01', end, ...(heatingModel ? { heatingModel } : {}) })
  const tenancies = [t('a', 'eg', 'Mieter A', 'selfSupply'), t('b', 'og', 'Mieter A', 'selfSupply'), t('c', 'dg', 'Mieter C'), t('d', 'eg', 'Früher', 'selfSupply', '2019-12-31')]
  const units = [{ id: 'eg', areaM2: 80 }, { id: 'og', areaM2: 70 }, { id: 'dg', areaM2: 50 }]
  expect(refundTenancies(tenancies).map((x) => x.id)).toEqual(['a', 'b', 'd'])
  expect(refundAreaOf('a', tenancies, units, '2025-06-01')).toBe(150)
  expect(refundAreaOf('c', tenancies, units, '2025-06-01')).toBe(50)
})
