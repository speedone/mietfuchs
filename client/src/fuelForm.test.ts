import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import {
  degreeDaysBody, degreeDaysToForm, deliveryLine, deliveryOptions, emptyFuelForm, fuelBody, fuelToForm, monthsOf, ownedBy, RESTRICTION_OPTIONS,
} from './fuelForm'
import type { FuelDelivery } from './types'

const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: 311747, quantity: null, quantityUnit: null, energyKwh: 29886, gasBasis: null, heatingValue: null, emissionsKg: 5406.17, co2CostCents: 60000,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: 900, fixedCents: 12000, estimated: false, usedByService: true, parts: [],
}

test('Lieferung ins Formular und zurück: Beträge, Zahlen, Anteil in Prozent', () => {
  const form = fuelToForm(gas)
  expect(form).toMatchObject({ label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amount: '3.117,47', fixed: '120,00', sharePercent: '90', emissionsKg: '5406,17', co2Cost: '600,00', energyKwh: '29886' })
  const r = fuelBody(form, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toEqual({
    label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, fixedCents: 12000, sharePermille: 900,
    emissionsKg: 5406.17, co2CostCents: 60000, energyKwh: 29886, usedByService: true,
  })
})

test('Bei freien Schlüsseln kein Betrag: Er steht in den verknüpften Positionen', () => {
  const r = fuelBody({ ...fuelToForm(gas), amount: '999,00' }, 'manual')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).not.toHaveProperty('amountCents')
  expect(r.body).not.toHaveProperty('usedByService')
})

test('Fehler mit einem Satz; leere Felder werden null', () => {
  expect(fuelBody(emptyFuelForm(), 'manual')).toEqual({ error: 'Bitte geben Sie den Rechnungszeitraum an (Beginn und Ende laut Rechnung).' })
  const zeitraum = { ...emptyFuelForm(), invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14' }
  expect(fuelBody({ ...zeitraum, fixed: 'zwölf' }, 'manual')).toEqual({ error: 'Der feste Preisbestandteil ist kein Betrag.' })
  expect(fuelBody({ ...zeitraum, sharePercent: '120' }, 'manual')).toEqual({ error: 'Der eingetragene Anteil liegt zwischen 0 und 100 %.' })
  expect(fuelBody({ ...zeitraum, emissionsKg: '-1' }, 'manual')).toEqual({ error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' })
  const leer = fuelBody(zeitraum, 'manual')
  if ('error' in leer) throw new Error(leer.error)
  expect(leer.body).toMatchObject({ fixedCents: null, sharePermille: null, emissionsKg: null, co2CostCents: null, energyKwh: null })
})

test('Zeile der Liste, Auswahl der Lieferungen, Lieferungen einer Heizperiode', () => {
  expect(deliveryLine(gas)).toBe(`15.03.2025–14.03.2026 · ${fmtEuro(311747)} · 5.406,17 kg CO₂ · CO₂-Kosten ${fmtEuro(60000)}`)
  expect(deliveryLine({ ...gas, estimated: true, amountCents: 90774, emissionsKg: null, co2CostCents: null })).toBe(`15.03.2025–14.03.2026 · ${fmtEuro(90774)} · geschätzt, Nachberechnung vorbehalten`)
  const schaetzung = { ...gas, id: 'e', estimated: true }
  expect(deliveryOptions([gas, schaetzung])).toEqual([{ value: '', label: 'keine Lieferung' }, { value: 'd', label: 'Gas 2025/2026' }])
  expect(ownedBy([gas], { from: '2025-05-01', to: '2026-04-30' }).map((d) => d.id)).toEqual(['d'])
  expect(ownedBy([gas], { from: '2024-05-01', to: '2025-04-30' })).toEqual([])
})

test('Gradtagzahlen: Monate des Zeitraums, Formular und Rumpf', () => {
  expect(monthsOf('2025-03-15', '2026-03-14')).toHaveLength(13)
  expect(monthsOf('2025-05-01', '2026-04-30')[0]).toBe('2025-05')
  const form = degreeDaysToForm([{ month: '2025-05', value: 102.5 }], ['2025-05', '2025-06'])
  expect(form).toEqual({ '2025-05': '102,5', '2025-06': '' })
  expect(degreeDaysBody({ ...form, '2025-06': '31' })).toEqual({ body: { values: [{ month: '2025-05', value: 102.5 }, { month: '2025-06', value: 31 }] } })
  expect(degreeDaysBody({ '2025-06': 'viel' })).toEqual({ error: 'Die Gradtagzahl für 06/2025 ist keine Zahl ab 0.' })
})

test('Beschränkungen nach § 9: vier Antworten, „keine“ zuerst', () => {
  expect(RESTRICTION_OPTIONS.map((o) => o.value)).toEqual(['none', 'building', 'supply', 'both'])
})
