import { describe, expect, test } from 'vitest'
import { fmtEuro } from './api'
import {
  METERED_QUANTITY_OPTIONS, STOCK_QUANTITY_OPTIONS, asksCo2Facts, defaultGrade, degreeDaysBody, degreeDaysToForm, deliveryLine, deliveryOptions, deliveryUnitId, emptyFuelForm, fuelBody, fuelRequiredProblems, fuelToForm, gradeOptions, monthsOf, ownedBy, RESTRICTION_OPTIONS, stockFuelBody, unitWordFor,
} from './fuelForm'
import type { FuelDelivery } from './types'

const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: 311747, quantity: null, quantityUnit: null, energyKwh: 29886, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 5406.17, co2CostCents: 60000,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: 900, fixedCents: 12000, estimated: false, usedByService: true, parts: [], creditNoteKind: null,
}

test('Lieferung ins Formular und zurück: Beträge, Zahlen, Anteil in Prozent', () => {
  const form = fuelToForm(gas)
  expect(form).toMatchObject({ label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amount: '3.117,47', fixed: '120,00', sharePercent: '90', emissionsKg: '5406,17', co2Cost: '600,00', energyKwh: '29886' })
  const r = fuelBody(form, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toEqual({
    label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, fixedCents: 12000, sharePermille: 900,
    emissionsKg: 5406.17, co2CostCents: 60000, energyKwh: 29886, gasBasis: null, usedByService: true,
    quantity: null, quantityUnit: null, emissionFactor: null, parts: [],
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
    body: { label: '', deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', heatingValue: null, fuelGrade: null, quantity: 2500, quantityUnit: 'l', emissionsKg: 6690.75, co2CostCents: 43791, emissionFactor: null },
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

// Heizung PR 16: CO₂-Angaben nach der Energie der Abrechnung und dem Brennstoff des Lieferanten (§ 2 Abs. 1 Satz 2
// CO2KostAufG): Pellet-Contracting hat keine CO₂-Kosten aufzuteilen, Gas-Contracting schon, wie Fernwärme.
test('CO₂-Angaben bei Contracting nach dem Brennstoff des Lieferanten', () => {
  expect(asksCo2Facts({ energy: 'pellets', contracting: true })).toBe(false)
  // Nachprüfung von #272, N1: mit einem weiteren Erzeuger des Lieferanten (Gasspitzenkessel) bleiben die Felder.
  expect(asksCo2Facts({ energy: 'heatPump', contracting: true, heatGeneration: 'mixed' })).toBe(true)
  expect(asksCo2Facts({ energy: 'heatPump', contracting: true, heatGeneration: 'single' })).toBe(false)
  expect(asksCo2Facts({ energy: 'gas', contracting: true })).toBe(true)
  expect(asksCo2Facts({ energy: 'other', contracting: true })).toBe(true)
  expect(asksCo2Facts({ energy: 'districtHeating' })).toBe(true)
  expect(asksCo2Facts({ energy: 'pellets' })).toBe(false)
  expect(asksCo2Facts({ energy: 'oil' })).toBe(true)
})

test('Netzentgelte und Biobrennstoff nur bei einer Heizung nach § 43 (Heizung PR 18)', () => {
  const f = { ...emptyFuelForm(), invoiceFrom: '2028-01-01', invoiceTo: '2028-12-31', gridFee: '300,00', bioCost: '' }
  const ohne = fuelBody(f, 'manual')
  if ('error' in ohne) throw new Error(ohne.error)
  expect('gridFeeCents' in ohne.body || 'bioCostCents' in ohne.body).toBe(false)
  expect(fuelBody(f, 'manual', { halfSplit: true })).toMatchObject({ body: { gridFeeCents: 30000, bioCostCents: null } })
  expect(fuelBody({ ...f, gridFee: 'drei' }, 'manual', { halfSplit: true })).toEqual({ error: 'Die Angabe zu den Netzentgelten ist kein Betrag.' })
  expect(fuelBody({ ...f, bioCost: 'x' }, 'manual', { halfSplit: true })).toEqual({ error: 'Die Angabe zum Biobrennstoff ist kein Betrag.' })
  // Hin und zurück.
  const form = fuelToForm({ ...gas, gridFeeCents: 30000, bioCostCents: 0 })
  expect([form.gridFee, form.bioCost]).toEqual(['300,00', '0,00'])
})

test('Vorrat bei einer Heizung nach § 43: beim Biobrennstoff nur 0 (Prüfung M11, Abweichung 10)', () => {
  const form = { ...fuelToForm(oel), bioCost: '0' }
  expect(stockFuelBody(form, 'manual', { halfSplit: true })).toMatchObject({ body: { bioCostCents: 0 } })
  expect(stockFuelBody({ ...form, bioCost: '' }, 'manual', { halfSplit: true })).toMatchObject({ body: { bioCostCents: null } })
  expect(stockFuelBody({ ...form, bioCost: '12,00' }, 'manual', { halfSplit: true })).toEqual({ error: 'Beim Brennstoff aus dem Tank nimmt Mietfuchs beim Biobrennstoff nur 0 an (kein Pflichtanteil in der Lieferung); einen Betrag rechnet Mietfuchs mit einer späteren Version.' })
  // Ohne Heizung nach § 43 bleibt der Rumpf wie bisher.
  const r = stockFuelBody(form, 'manual')
  if ('error' in r) throw new Error(r.error)
  expect('bioCostCents' in r.body).toBe(false)
})

// ---------- Heizung PR 20: Menge, Emissionsfaktor und Teilmengen laut Rechnung ----------

test('Gas, Fernwärme, Strom: Menge in m³ oder kWh, Emissionsfaktor und Teilmengen gehen hin und zurück', () => {
  const mitTeilen: FuelDelivery = {
    ...gas, quantity: 2890, quantityUnit: 'm3', emissionFactor: 0.20088,
    parts: [{ from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountCents: 288577, fixedCents: 16565, emissionsKg: 4065, co2CostCents: 26605 }],
  }
  const form = fuelToForm(mitTeilen)
  expect([form.quantity, form.quantityUnit, form.emissionFactor]).toEqual(['2890', 'm3', '0,20088'])
  expect(form.parts).toEqual([{ from: '2025-03-15', to: '2025-12-31', energyKwh: '22410', amount: '2.885,77', fixed: '165,65', emissionsKg: '4065', co2Cost: '266,05' }])
  const r = fuelBody(form, 'manual')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toMatchObject({ quantity: 2890, quantityUnit: 'm3', emissionFactor: 0.20088, parts: mitTeilen.parts })
  expect(METERED_QUANTITY_OPTIONS.map((o) => o.value)).toEqual(['', 'm3', 'kWh'])
  expect(STOCK_QUANTITY_OPTIONS.map((o) => o.value)).toEqual(['', 'l', 'kg', 'srm'])
})

test('Teilmengen: Zeitraum und Betrag sind Pflicht, Zahlen werden geprüft', () => {
  const zeitraum = { ...emptyFuelForm(), invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14' }
  const teil = { from: '2025-03-15', to: '2025-12-31', energyKwh: '', amount: '100,00', fixed: '', emissionsKg: '', co2Cost: '' }
  expect(fuelBody({ ...zeitraum, parts: [{ ...teil, to: '' }] }, 'manual')).toEqual({ error: 'Teilmenge 1: Bitte geben Sie den Zeitraum an (von bis).' })
  expect(fuelBody({ ...zeitraum, parts: [{ ...teil, from: '2026-01-01' }] }, 'manual')).toEqual({ error: 'Teilmenge 1: Bitte geben Sie den Zeitraum an (von bis).' })
  expect(fuelBody({ ...zeitraum, parts: [{ ...teil, amount: '' }] }, 'manual')).toEqual({ error: 'Teilmenge 1: Jede Teilmenge braucht ihren Betrag laut Rechnung.' })
  expect(fuelBody({ ...zeitraum, parts: [teil, { ...teil, co2Cost: 'viel' }] }, 'manual')).toEqual({ error: 'Teilmenge 2: Die CO₂-Kosten sind kein Betrag.' })
  expect(fuelBody({ ...zeitraum, co2Cost: 'viel' }, 'manual')).toEqual({ error: 'Die CO₂-Kosten sind kein Betrag.' })
  expect(fuelBody({ ...zeitraum, parts: [{ ...teil, energyKwh: '-5' }] }, 'manual')).toEqual({ error: 'Teilmenge 1: Die Energie ist eine Zahl ab 0.' })
  expect(fuelBody({ ...zeitraum, emissionFactor: 'hoch' }, 'manual')).toEqual({ error: 'Der Emissionsfaktor ist eine Zahl ab 0.' })
  expect(fuelBody({ ...zeitraum, quantity: '-1' }, 'manual')).toEqual({ error: 'Die Menge ist eine Zahl ab 0.' })
  // Eine Einheit, die das Auswahlfeld nicht anbietet, zeigt es leer; gespeichert wird dann auch keine.
  const liter = fuelBody({ ...zeitraum, quantity: '5', quantityUnit: 'l' }, 'manual')
  expect('body' in liter && liter.body.quantityUnit).toBe(null)
  const ok = fuelBody({ ...zeitraum, parts: [teil] }, 'manual')
  expect('body' in ok && ok.body.parts).toEqual([{ from: '2025-03-15', to: '2025-12-31', energyKwh: null, amountCents: 10000, fixedCents: null, emissionsKg: null, co2CostCents: null }])
})

test('Vorrat: eine Menge in m³ oder kWh lehnt das Formular mit Satz ab (Prüfung M4)', () => {
  const form = fuelToForm(oel)
  expect(stockFuelBody({ ...form, quantityUnit: 'm3' }, 'manual')).toEqual({ error: 'Beim Vorrat geben Sie die Menge in Litern, Kilogramm oder Schüttraummetern an, wie auf der Rechnung.' })
  expect(stockFuelBody({ ...form, emissionFactor: '0,2664' }, 'manual')).toMatchObject({ body: { emissionFactor: 0.2664 } })
  // Eine gespeicherte Menge in m³ einer Gasrechnung bleibt im Formular stehen.
  expect(fuelToForm({ ...gas, quantity: 2890, quantityUnit: 'm3' }).quantityUnit).toBe('m3')
})

// #346 Schritt 7: Die Lieferung steht im Seitenfenster; was fehlt, steht am Feld und in der Sammelmeldung, alles auf einmal.
describe('Pflichtangaben einer Lieferung', () => {
  test('Rechnung: Beginn und Ende des Rechnungszeitraums, bei der Etagenheizung die Wohnung', () => {
    expect(fuelRequiredProblems(emptyFuelForm(), { stock: false, perUnit: true }).map((p) => [p.field, p.short])).toEqual([
      ['unitId', 'Wohnung fehlt'], ['invoiceFrom', 'Beginn fehlt'], ['invoiceTo', 'Ende fehlt'],
    ])
    expect(fuelRequiredProblems({ ...emptyFuelForm(), invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31' }, { stock: false, perUnit: false })).toEqual([])
  })
  test('Vorrat: Lieferdatum, Menge und Einheit; eine unlesbare Menge meldet erst die Prüfung des Rumpfs', () => {
    expect(fuelRequiredProblems(emptyFuelForm(), { stock: true, perUnit: false }).map((p) => p.field)).toEqual(['deliveredAt', 'quantity', 'quantityUnit'])
    expect(fuelRequiredProblems({ ...emptyFuelForm(), deliveredAt: '2026-02-01', quantity: 'viel', quantityUnit: 'l' }, { stock: true, perUnit: false })).toEqual([])
  })
})
