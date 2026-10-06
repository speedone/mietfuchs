import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { ALREADY_SETTLED_OPTIONS, BEFORE_2023_OPTIONS, STOCK_UNIT_OPTIONS, showsStockCard, stockBody, stockSummary, stockToForm } from './stockForm'
import { periodKey } from '../../shared/period.ts'
import type { HeatingStockStatement, StockView } from './types'

const leer: StockView = {
  row: { stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null },
  derived: null, closingLockedBy: null, askAlreadySettled: false, statement: null, frozen: null, problem: 'Für die Bestandsrechnung (Heizperiode 2025) fehlt: die Einheit des Vorrats, der Anfangsbestand und der Endbestand.',
}
const BESTAND: HeatingStockStatement = {
  unit: 'l', openingSource: 'own', closingMeasuredOn: '2025-12-31', paidCents: 565000, oldStockKg: 5352.6,
  opening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, layers: [] },
  deliveries: [{ label: 'Lieferung vom 15.03.2025', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549, co2Counted: true }],
  closing: { quantity: 1800, costCents: 180000, emissionsKg: 4817.34, co2Cents: 31530, layers: [] },
  consumed: { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 },
}

test('Leere Heizperiode: keine Vorauswahl; Einheit Pflicht, sobald eine Menge dasteht', () => {
  const f = stockToForm(leer)
  expect([f.unit, f.openingQuantity, f.before2023, f.closingQuantity, f.measuredOn]).toEqual(['', '', '', '', ''])
  expect(STOCK_UNIT_OPTIONS.map((o) => o.value)).toEqual(['', 'l', 'kg', 'srm'])
  expect(BEFORE_2023_OPTIONS[1]?.label).toBe('Ja, vor dem 01.01.2023 in Rechnung gestellt')
  expect(stockBody({ ...f, closingQuantity: '1800' }, leer)).toEqual({ error: 'Bitte wählen Sie die Einheit des Vorrats.' })
})

test('Erste Heizperiode: Anfangsbestand mit Wert, kg, CO₂-Kosten und Frage nach 2023; deutsche Schreibweise', () => {
  const f = { ...stockToForm(leer), unit: 'l' as const, openingQuantity: '2000', openingCost: '1.900,00', openingKg: '5352,6', openingCo2: '0', before2023: 'yes' as const, closingQuantity: '1800', measuredOn: '2025-12-31' }
  expect(stockBody(f, leer)).toEqual({
    body: {
      stockUnit: 'l', closingQuantity: 1800, closingMeasuredOn: '2025-12-31', openingQuantity: 2000, openingCostCents: 190000,
      openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true,
    },
  })
  expect(stockBody({ ...f, openingQuantity: 'viel' }, leer)).toEqual({ error: 'Bitte prüfen Sie „Anfangsbestand“: keine Zahl ab 0.' })
})

test('Folgeperiode: Der Anfangsbestand kommt aus der Vorperiode und wird nicht geschickt', () => {
  const folge: StockView = { ...leer, derived: { value: BESTAND.closing, period: periodKey('2025-01'), label: '2025', frozen: true } }
  const r = stockBody({ ...stockToForm(folge), unit: 'l', closingQuantity: '900' }, folge)
  expect(r).toEqual({ body: { stockUnit: 'l', closingQuantity: 900, closingMeasuredOn: null } })
})

test('Zusammenfassung und wann die Karte erscheint', () => {
  expect(stockSummary({ ...leer, statement: BESTAND })).toEqual([
    `Anfangsbestand 2.000 l · ${fmtEuro(190000)}`,
    `Lieferung vom 15.03.2025: 3.000 l · ${fmtEuro(315000)}`,
    `Endbestand 1.800 l · ${fmtEuro(180000)} (zu den jüngsten Lieferungen bewertet)`,
    `Verbraucht 5.700 l · ${fmtEuro(575000)} · 15.254,91 kg CO₂ · CO₂-Kosten ${fmtEuro(64810)}`,
  ])
  // Gespeicherte Mengen gehen ohne Tausenderpunkt ins Formular, damit sie unverändert zurückkommen.
  expect(stockToForm({ ...leer, row: { ...leer.row, openingQuantity: 2000, openingEmissionsKg: 5352.6 } })).toMatchObject({ openingQuantity: '2000', openingKg: '5352,6' })
  const v = (co2Method: 'selfAfterService' | 'serviceDeducted' | null) => ({ stock: leer, co2: co2Method === null ? null : { method: co2Method } })
  expect(showsStockCard({ method: 'manual' }, v(null))).toBe(true)
  expect(showsStockCard({ method: 'service' }, v('selfAfterService'))).toBe(true)
  expect(showsStockCard({ method: 'service' }, v('serviceDeducted'))).toBe(false)
  expect(showsStockCard({ method: 'manual' }, { stock: null, co2: null })).toBe(false)
})

test('Durchsicht von #237, C1: Nach einer Abrechnung nach Lieferung fragt die Karte, ob der Anfangsbestand schon umgelegt wurde, vorbelegt mit „ja“', () => {
  const frage: StockView = { ...leer, askAlreadySettled: true }
  expect(stockToForm(frage).alreadySettled).toBe('yes')
  expect(stockToForm(leer).alreadySettled).toBe('')
  expect(ALREADY_SETTLED_OPTIONS.map((o) => o.value)).toEqual(['yes', 'no'])
  const f = { ...stockToForm(frage), unit: 'l' as const, openingQuantity: '2000', closingQuantity: '1000' }
  expect(stockBody(f, frage)).toMatchObject({ body: { openingAlreadySettled: true } })
  expect(stockBody({ ...f, alreadySettled: 'no' }, frage)).toMatchObject({ body: { openingAlreadySettled: false } })
  // Ohne Frage wird nichts geschickt; der Server entscheidet dann nach der Vorperiode.
  expect('openingAlreadySettled' in ((stockBody({ ...stockToForm(leer), unit: 'l', closingQuantity: '1' }, leer) as { body: object }).body)).toBe(false)
})

test('Durchsicht von #237, I4: Bei Pellets und Holz nennt die Zusammenfassung keine CO₂-Angaben', () => {
  expect(stockSummary({ ...leer, statement: BESTAND }, false).at(-1)).toBe(`Verbraucht 5.700 l · ${fmtEuro(575000)}`)
})
