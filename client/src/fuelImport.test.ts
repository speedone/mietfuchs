// Eine ausgelesene Lieferantenrechnung im Formular der Lieferung (Heizung PR 20, #103): Vorbelegung, Prüfungen
// innerhalb derselben Rechnung und der Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG.
import { expect, test } from 'vitest'
import { bioAccepted, fuelChecks, fuelFormFromExtraction, type FuelImportPlace } from './fuelImport'
import { emptyFuelForm, fuelBody, stockFuelBody } from './fuelForm'
import { fmtEuro } from './api'
import type { FuelInvoiceExtraction } from './types'

const gas: FuelInvoiceExtraction = {
  vendor: 'Stadtwerke Beispielstadt', invoiceDate: '2026-03-20', periodStart: '2025-03-15', periodEnd: '2026-03-14',
  totalGrossEur: 4067.8, fixedEur: 207.06, quantity: 2890, quantityUnit: 'm3', energyKwh: 31285, gasBasis: 'hs', heatingValue: null,
  emissionsKg: 5674.8, co2CostEur: 380.99, co2CostNet: false, emissionFactor: 0.20088, bioCostEur: null,
  parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
  ],
  amountsNetUnadjusted: false,
}
const oel: FuelInvoiceExtraction = {
  ...gas, vendor: 'Heizöl Beispiel', invoiceDate: '2025-10-14', periodStart: undefined, periodEnd: undefined, deliveredAt: '2025-10-12', totalGrossEur: 3150, quantity: 3000, quantityUnit: 'l',
  gasBasis: null, heatingValue: 10.05, energyKwh: 30150, emissionsKg: 8032, co2CostEur: 525.69, emissionFactor: 0.2664, parts: [], fixedEur: null,
}
const service: FuelImportPlace = { method: 'service', stock: false, halfSplit: false, co2: true, gas: true }
const manual: FuelImportPlace = { method: 'manual', stock: false, halfSplit: false, co2: true, gas: true }

test('Formular aus der Auswertung: alle Angaben nach § 3 Abs. 1, Teilmengen, Bezeichnung; der Rumpf trägt sie', () => {
  const f = fuelFormFromExtraction(gas, emptyFuelForm(), service)
  expect(f).toMatchObject({
    label: 'Stadtwerke Beispielstadt 15.03.2025–14.03.2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', invoiceDate: '2026-03-20', amount: '4.067,80', fixed: '207,06',
    quantity: '2890', quantityUnit: 'm3', energyKwh: '31285', gasBasis: 'hs', heatingValue: '', emissionsKg: '5674,8', co2Cost: '380,99', emissionFactor: '0,20088', bioCost: '', deliveredAt: '',
  })
  expect(f.parts).toEqual([
    { from: '2025-03-15', to: '2025-12-31', energyKwh: '22410', amount: '2.885,77', fixed: '165,65', emissionsKg: '4065', co2Cost: '266,05' },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: '8875', amount: '1.182,03', fixed: '41,41', emissionsKg: '1609,8', co2Cost: '114,94' },
  ])
  const r = fuelBody(f, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toMatchObject({ amountCents: 406780, fixedCents: 20706, emissionsKg: 5674.8, co2CostCents: 38099, energyKwh: 31285, emissionFactor: 0.20088, gasBasis: 'hs', quantity: 2890, quantityUnit: 'm3' })
  expect(r.body.parts).toEqual([
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountCents: 288577, fixedCents: 16565, emissionsKg: 4065, co2CostCents: 26605 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountCents: 118203, fixedCents: 4141, emissionsKg: 1609.8, co2CostCents: 11494 },
  ])
})

test('Heizöl: Liefertag statt Zeitraum, Heizwert laut Rechnung, Menge in Litern; der Vorrat speichert Emissionsfaktor und Rechnungsdatum', () => {
  const f = fuelFormFromExtraction(oel, emptyFuelForm(), { method: 'manual', stock: true, halfSplit: false, co2: true, gas: false })
  expect([f.label, f.deliveredAt, f.invoiceDate, f.invoiceFrom, f.quantity, f.quantityUnit, f.heatingValue, f.parts]).toEqual(['Heizöl Beispiel 12.10.2025', '2025-10-12', '2025-10-14', '', '3000', 'l', '10,05', []])
  const r = stockFuelBody(f, 'manual')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toMatchObject({ deliveredAt: '2025-10-12', invoiceDate: '2025-10-14', quantity: 3000, quantityUnit: 'l', heatingValue: 10.05, emissionsKg: 8032, co2CostCents: 52569, emissionFactor: 0.2664 })
})

test('Beim Vorrat bleiben Zeitraum und Teilmengen leer, die der Server dort ablehnt; eine Gasmenge erscheint nicht als Vorratseinheit', () => {
  const f = fuelFormFromExtraction(gas, emptyFuelForm(), { method: 'manual', stock: true, halfSplit: false, co2: true, gas: false })
  expect([f.invoiceFrom, f.invoiceTo, f.parts, f.quantityUnit]).toEqual(['', '', [], ''])
  const g = fuelFormFromExtraction({ ...gas, quantityUnit: 'l' }, emptyFuelForm(), manual)
  expect(g.quantityUnit).toBe('')
})

test('Prüfungen: Summe der Teilmengen, Energie, hochgerechnet, nicht hochgerechnet', () => {
  expect(fuelChecks(gas, service)).toEqual([])
  // Ein Cent je Teilmenge ist Rundung, kein Befund.
  expect(fuelChecks({ ...gas, totalGrossEur: 4067.82 }, service)).toEqual([])
  expect(fuelChecks({ ...gas, totalGrossEur: 4067.83 }, service)).toHaveLength(1)
  const lueckig: FuelInvoiceExtraction = { ...gas, energyKwh: 31000, parts: gas.parts.slice(0, 1) }
  const checks = fuelChecks({ ...lueckig, amountsAdjusted: 'netto' }, service)
  expect(checks).toContain(`Die Teilmengen ergeben ${fmtEuro(288577)}, der Rechnungsbetrag ist ${fmtEuro(406780)}. Bitte prüfen Sie, ob eine Teilmenge fehlt oder ob die Nachzahlung statt des Rechnungsbetrags gelesen wurde.`)
  expect(checks).toContain('Die Teilmengen ergeben 22.410 kWh, die Rechnung nennt 31.000 kWh.')
  expect(checks).toContain('Die Teilmengen waren netto ausgewiesen; Mietfuchs hat sie anteilig auf den Rechnungsbetrag hochgerechnet. Bitte prüfen Sie die Beträge.')
  expect(fuelChecks({ ...gas, amountsNetUnadjusted: true }, service)).toContain('Die Rechnung nennt die Teilmengen netto, und der Abstand zum Rechnungsbetrag lässt sich nicht allein mit der Umsatzsteuer erklären. Bitte tragen Sie die Bruttobeträge von Hand ein.')
})

test('Prüfung S7: netto genannte CO₂-Kosten als Sache des Lieferanten, ohne Umrechnung', () => {
  expect(fuelChecks({ ...gas, co2CostNet: true }, service)).toContain('Die Rechnung nennt die CO₂-Kosten ohne Umsatzsteuer. Auszuweisen sind sie einschließlich Umsatzsteuer (§ 3 Abs. 1 Nr. 2, Abs. 3 CO2KostAufG); das ist Sache des Lieferanten. Sie können bei ihm eine berichtigte Rechnung anfordern. Mietfuchs rechnet den Betrag nicht um. Kennen Sie den Betrag mit Umsatzsteuer, tragen Sie ihn selbst ein.')
})

test('Prüfung S3: bei freien Schlüsseln steht der Rechnungsbetrag in der Kostenposition, die Karte sagt es', () => {
  expect(fuelChecks(gas, manual)).toEqual([`Bei freien Schlüsseln steht der Rechnungsbetrag in der Kostenposition. Legen Sie eine Position „Heizung und Warmwasser“ über ${fmtEuro(406780)} an und verknüpfen Sie sie mit dieser Lieferung.`])
  expect(fuelChecks(gas, { ...manual, method: 'self' })).toHaveLength(1)
  expect(fuelChecks({ ...gas, totalGrossEur: null }, manual)).toEqual([])
})

test('Biobrennstoff nur dort vorbelegen, wo der Server ihn annimmt (PR 18)', () => {
  // Keine Heizung nach § 43: nie; Vorrat: nur die 0; ab dem Jahr über der Grenze von § 5a Abs. 3 Nr. 3 kein Betrag; sonst jeder Betrag.
  expect(bioAccepted({ halfSplit: false, stock: false }, 12.5, '2030-01-31')).toBe(false)
  expect(bioAccepted({ halfSplit: true, stock: true }, 12.5, '2030-01-31')).toBe(false)
  expect(bioAccepted({ halfSplit: true, stock: true }, 0, '2030-01-31')).toBe(true)
  expect(bioAccepted({ halfSplit: true, stock: false }, 12.5, '2030-01-31')).toBe(true)
  expect(bioAccepted({ halfSplit: true, stock: false }, 12.5, '2040-01-31')).toBe(false)
  expect(bioAccepted({ halfSplit: true, stock: false }, 0, '2040-01-31')).toBe(true)
  expect(bioAccepted({ halfSplit: true, stock: false }, null, '2030-01-31')).toBe(false)
  const mitBio: FuelInvoiceExtraction = { ...gas, periodEnd: '2030-01-31', bioCostEur: 12.5 }
  expect(fuelFormFromExtraction(mitBio, emptyFuelForm(), service).bioCost).toBe('')
  const f = fuelFormFromExtraction(mitBio, emptyFuelForm(), { ...service, halfSplit: true })
  expect(f.bioCost).toBe('12,50')
  // fuelBody schickt den Betrag nur mit der Freigabe aus PR 18.
  const ohne = fuelBody(f, 'service')
  const mit = fuelBody(f, 'service', { halfSplit: true })
  if ('error' in ohne || 'error' in mit) throw new Error('kein Rumpf')
  expect('bioCostCents' in ohne.body).toBe(false)
  expect(mit.body.bioCostCents).toBe(1250)
})

test('Prüfung M6: Biobrennstoff nicht übernommen, je nach Grund ein eigener Satz; übernommen mit Beginn und Grenze der Teilung', () => {
  const mitBio: FuelInvoiceExtraction = { ...gas, periodEnd: '2030-01-31', bioCostEur: 12.5 }
  expect(fuelChecks(mitBio, service)).toEqual([
    `Die Rechnung weist ${fmtEuro(1250)} als Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig zu nutzenden Brennstoff aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Mietfuchs hat ihn nicht übernommen, weil an dieser Heizanlage kein Einbau nach § 43 Abs. 1 GModG eingetragen ist. Diese Pflicht gilt nur für eine Gas-, Öl- oder Flüssiggasheizung, die nach dem 29.07.2026 in ein bestehendes Gebäude eingebaut wurde. Trifft das zu, tragen Sie den Tag des Einbaus an der Heizanlage ein und lesen Sie die Rechnung erneut aus.`,
  ])
  expect(fuelChecks({ ...oel, energyKwh: null, deliveredAt: '2030-01-31', bioCostEur: 12.5 }, { method: 'service', stock: true, halfSplit: true, co2: true, gas: false })).toEqual([
    `Die Rechnung weist ${fmtEuro(1250)} als Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig zu nutzenden Brennstoff aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Mietfuchs hat ihn nicht übernommen, weil Mietfuchs diesen Preisbestandteil bei Brennstoff aus einem Vorrat noch nicht rechnet. Bitte bewahren Sie die Rechnung auf.`,
  ])
  expect(fuelChecks({ ...mitBio, periodEnd: '2040-01-31' }, { ...service, halfSplit: true })).toEqual([
    `Die Rechnung weist ${fmtEuro(1250)} als Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig zu nutzenden Brennstoff aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Mietfuchs hat ihn nicht übernommen, weil ab dem 01.01.2040 der Pflichtanteil die Grenze von § 5a Abs. 3 Nr. 3 CO2KostAufG übersteigt; das rechnet Mietfuchs mit einer späteren Version. Bitte bewahren Sie die Rechnung auf.`,
  ])
  expect(fuelChecks(mitBio, { ...service, halfSplit: true })).toEqual([
    'Die Rechnung weist einen Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig zu nutzenden Brennstoff aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Mietfuchs hat ihn übernommen. Hälftig geteilt werden diese Kosten erst ab dem 01.01.2029 und höchstens für einen Brennstoffanteil von 30 Prozent (§ 5a Abs. 1 Nr. 2, Abs. 3 Nr. 3 CO2KostAufG).',
  ])
  // Eine 0 ist eine Angabe und kein Befund.
  expect(fuelChecks({ ...gas, bioCostEur: 0 }, service)).toEqual([])
})

test('Durchsicht S1: nur vorbelegen, was die Karte zeigt; CO₂-Angaben ohne Feld nennt ein Satz', () => {
  const ohne: FuelImportPlace = { method: 'service', stock: false, halfSplit: false, co2: false, gas: false }
  const f = fuelFormFromExtraction(gas, emptyFuelForm(), ohne)
  expect([f.emissionsKg, f.co2Cost, f.emissionFactor, f.gasBasis]).toEqual(['', '', '', ''])
  expect(f.parts.map((p) => [p.emissionsKg, p.co2Cost])).toEqual([['', ''], ['', '']])
  expect(f.parts.map((p) => p.amount)).toEqual(['2.885,77', '1.182,03'])
  const r = fuelBody(f, 'service')
  if ('error' in r) throw new Error(r.error)
  expect([r.body.co2CostCents, r.body.emissionsKg, r.body.emissionFactor, r.body.gasBasis]).toEqual([null, null, null, null])
  expect(fuelChecks(gas, ohne)).toContain(`Die Rechnung nennt CO₂-Angaben (5.674,8 kg CO₂, CO₂-Kosten ${fmtEuro(38099)}). Bei dieser Heizanlage fragt Mietfuchs sie nicht ab und hat sie nicht übernommen.`)
  expect(fuelChecks({ ...gas, emissionsKg: null, co2CostEur: null, emissionFactor: null, parts: [] }, ohne)).toEqual([])
  // Eine Heizanlage ohne Gas bekommt keinen Bezug der kWh, die mit Gas schon.
  expect(fuelFormFromExtraction(gas, emptyFuelForm(), { ...ohne, co2: true }).gasBasis).toBe('')
  expect(fuelFormFromExtraction(gas, emptyFuelForm(), { ...ohne, co2: true, gas: true }).gasBasis).toBe('hs')
})

test('Durchsicht S5: beim Vorrat nennt ein Satz den Energiegehalt, den Mietfuchs nicht übernimmt; Menge × Heizwert wird gegengeprüft', () => {
  const vorrat: FuelImportPlace = { method: 'service', stock: true, halfSplit: false, co2: true, gas: false }
  const satz = 'Die Rechnung nennt einen Energiegehalt von 30.150 kWh (§ 3 Abs. 1 Nr. 4 CO2KostAufG). Beim Brennstoff aus dem Vorrat übernimmt Mietfuchs ihn nicht: Mietfuchs rechnet mit der verbrauchten Menge × Heizwert (§ 9 Abs. 3 HeizkostenV). Steht auf der Rechnung ein Heizwert, prüfen Sie das Feld „Heizwert laut Rechnung“; sonst wählen Sie die Zeile der Tabelle.'
  expect(fuelChecks(oel, vorrat)).toEqual([satz])
  // 3.000 l × 11,05 kWh/l = 33.150 kWh, die Rechnung nennt 30.150 kWh: mehr als 1 % Abstand.
  expect(fuelChecks({ ...oel, heatingValue: 11.05 }, vorrat)).toEqual([satz, 'Menge × Heizwert laut Rechnung ergibt 33.150 kWh, die Rechnung nennt 30.150 kWh. Bitte prüfen Sie Menge und Heizwert.'])
  expect(fuelChecks({ ...oel, energyKwh: null }, vorrat)).toEqual([])
  // Bei Gas, Fernwärme und Strom wird der Energiegehalt übernommen; ein Heizwert hat dort kein Feld (Kann K2).
  expect(fuelChecks(gas, service)).toEqual([])
  expect(fuelFormFromExtraction({ ...gas, heatingValue: 11.3 }, emptyFuelForm(), service).heatingValue).toBe('')
})
