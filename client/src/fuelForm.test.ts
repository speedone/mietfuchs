import { describe, expect, test } from 'vitest'
import { fmtEuro } from './api'
import {
  defaultGrade, degreeDaysBody, degreeDaysToForm, deliveryLine, deliveryOptions, deliveryUnitId, emptyFuelForm, fuelBody, fuelToForm, gradeOptions, monthsOf, ownedBy, RESTRICTION_OPTIONS, stockFuelBody, unitWordFor,
} from './fuelForm'
import type { FuelDelivery } from './types'

const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: 311747, quantity: null, quantityUnit: null, energyKwh: 29886, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 5406.17, co2CostCents: 60000,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: 900, fixedCents: 12000, estimated: false, usedByService: true, parts: [],
}

test('Lieferung ins Formular und zurück: Beträge, Zahlen, Anteil in Prozent', () => {
  const form = fuelToForm(gas)
  expect(form).toMatchObject({ label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amount: '3.117,47', fixed: '120,00', sharePercent: '90', emissionsKg: '5406,17', co2Cost: '600,00', energyKwh: '29886' })
  const r = fuelBody(form, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toEqual({
    label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, fixedCents: 12000, sharePermille: 900,
    emissionsKg: 5406.17, co2CostCents: 60000, energyKwh: 29886, gasBasis: null, usedByService: true,
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

// ---------- Lieferungen von Heizöl, Flüssiggas, Pellets, Holz und Kohle (Heizung PR 8) ----------

const oel: FuelDelivery = {
  ...gas, id: 'o', label: '', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', amountCents: null,
  quantity: 2500, quantityUnit: 'l', energyKwh: null, sharePermille: null, fixedCents: null, emissionsKg: 6690.75, co2CostCents: 43791,
}

test('Lieferung für den Vorrat: Lieferdatum und Menge statt Rechnungszeitraum; Zeile und Zuordnung nach dem Lieferdatum', () => {
  const form = fuelToForm(oel)
  expect([form.deliveredAt, form.invoiceDate, form.quantity, form.quantityUnit]).toEqual(['2025-10-10', '2025-10-12', '2500', 'l'])
  expect(stockFuelBody(form, 'manual')).toEqual({
    body: { label: '', deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', heatingValue: null, fuelGrade: null, quantity: 2500, quantityUnit: 'l', emissionsKg: 6690.75, co2CostCents: 43791 },
  })
  expect(stockFuelBody({ ...form, amount: '2.500,00' }, 'service')).toMatchObject({ body: { amountCents: 250000, usedByService: true } })
  expect(stockFuelBody({ ...form, deliveredAt: '' }, 'manual')).toEqual({ error: 'Bitte geben Sie das Lieferdatum an. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.' })
  expect(stockFuelBody({ ...form, quantity: '' }, 'manual')).toEqual({ error: 'Bitte geben Sie die gelieferte Menge an, wie auf der Rechnung.' })
  expect(stockFuelBody({ ...form, quantityUnit: '' }, 'manual')).toEqual({ error: 'Bitte wählen Sie die Einheit der Menge.' })
  expect(deliveryLine(oel)).toBe('geliefert am 10.10.2025 · 2.500 l · 6.690,75 kg CO₂ · CO₂-Kosten ' + fmtEuro(43791))
  expect(deliveryOptions([oel])[1]?.label).toBe('Lieferung vom 10.10.2025')
  expect(ownedBy([oel], { from: '2025-01-01', to: '2025-12-31' }).map((d) => d.id)).toEqual(['o'])
  expect(ownedBy([oel], { from: '2026-01-01', to: '2026-12-31' })).toEqual([])
})

describe('Rechnung einer Etagenheizung (Heizung PR 9)', () => {
  test('das Formular führt die Wohnung', () => {
    expect(emptyFuelForm().unitId).toBe('')
    expect(fuelToForm({ ...gas, unitId: 'og' }).unitId).toBe('og')
  })
  test('bei perUnit Pflicht, bei zentraler Anlage leer', () => {
    expect(deliveryUnitId({ unitId: '' }, { supply: 'perUnit' })).toEqual({ error: 'Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft.' })
    expect(deliveryUnitId({ unitId: 'og' }, { supply: 'perUnit' })).toEqual({ unitId: 'og' })
    expect(deliveryUnitId({ unitId: 'og' }, { supply: 'central' })).toEqual({ unitId: null })
  })
  test('fuelBody schickt keine Wohnung; die setzt die Karte', () => {
    const r = fuelBody({ ...emptyFuelForm(), invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', unitId: 'og' }, 'manual')
    if ('error' in r) throw new Error(r.error)
    expect('unitId' in r.body).toBe(false)
  })
})

test('Heizwert und Zeile der Tabelle (Heizung PR 11): nur bei Heizkesseln, vorbelegt nur bei genau einer Zeile', () => {
  expect(gradeOptions('oil').map((o) => o.value)).toEqual(['', 'heatingOilEL', 'heavyFuelOil'])
  expect(gradeOptions('oil')[0]?.label).toBe('keine (Heizwert laut Rechnung)')
  expect(gradeOptions('districtHeating')).toEqual([])
  expect(defaultGrade('pellets')).toBe('woodPellets')
  expect(defaultGrade('oil')).toBe('')
  expect([unitWordFor('l'), unitWordFor('')]).toEqual(['Liter', 'Einheit'])
  const oel: FuelDelivery = { ...gas, label: 'Öl', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-12', energyKwh: null, quantity: 3000, quantityUnit: 'l', heatingValue: 9.8, fuelGrade: 'heatingOilEL' }
  const form = fuelToForm(oel)
  expect([form.heatingValue, form.grade]).toEqual(['9,8', 'heatingOilEL'])
  // Ein Heizwert laut Rechnung geht vor; die Zeile der Tabelle wird dann nicht geschickt.
  const mit = stockFuelBody({ ...form, heatingValue: '10,2' }, 'self')
  expect('body' in mit && [mit.body.heatingValue, mit.body.fuelGrade]).toEqual([10.2, null])
  const ohne = stockFuelBody({ ...form, heatingValue: '' }, 'self')
  expect('body' in ohne && [ohne.body.heatingValue, ohne.body.fuelGrade]).toEqual([null, 'heatingOilEL'])
  expect(stockFuelBody({ ...form, heatingValue: 'zehn' }, 'self')).toEqual({ error: 'Der Heizwert laut Rechnung ist eine Zahl über 0.' })
  // Gas: nach Brennwert oder Heizwert, davon hängt der Faktor der Formeln ab.
  const g = fuelBody({ ...fuelToForm(gas), gasBasis: 'hs' }, 'self')
  expect('body' in g && g.body.gasBasis).toBe('hs')
})

test('Nachprüfung #240, W1: „11.325“ als Heizwert ist mehrdeutig und wird nachgefragt; Mengen mit Tausenderpunkt bleiben tausend', () => {
  const oel: FuelDelivery = { ...gas, label: 'Öl', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-12', energyKwh: null, quantity: 3000, quantityUnit: 'l', heatingValue: null, fuelGrade: null }
  const form = fuelToForm(oel)
  expect(stockFuelBody({ ...form, heatingValue: '11.325' }, 'self')).toEqual({ error: 'Heizwert laut Rechnung: Meinen Sie 11,325 oder 11325? Bitte schreiben Sie Nachkommastellen mit Komma (11,325) und Tausender ohne Punkt (11325).' })
  const komma = stockFuelBody({ ...form, heatingValue: '11,325' }, 'self')
  expect('body' in komma && komma.body.heatingValue).toBe(11.325)
  const menge = stockFuelBody({ ...form, quantity: '1.200' }, 'self')
  expect('body' in menge && menge.body.quantity).toBe(1200)
})
