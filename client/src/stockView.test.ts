import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { showsStock, stockBlock } from './stockView'
import { periodKey } from '../../shared/period.ts'
import type { HeatingStatement, Statement } from './types'

const anlage = (stock: HeatingStatement['stock']): HeatingStatement => ({
  plantId: 'hp', plantName: 'Öl', energy: 'oil', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2: null, stock,
})
const BESTAND: NonNullable<HeatingStatement['stock']> = {
  unit: 'l', openingSource: 'frozen', closingMeasuredOn: '2026-01-05', paidCents: 565000, oldStockKg: 5352.6,
  opening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, layers: [] },
  deliveries: [{ label: 'Lieferung vom 15.03.2025', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549, co2Counted: true }],
  closing: { quantity: 1800, costCents: 180000, emissionsKg: 4817.34, co2Cents: 31530, layers: [] },
  consumed: { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 },
}

test('Druckblock Bestandsrechnung (Entwurf 9.5, 8.2): Anfang, Lieferungen, Ende, Verbrauch, Bewertung und Altbestand', () => {
  const v = stockBlock(anlage(BESTAND)) ?? (() => { throw new Error('kein Block') })()
  expect(v.title).toBe('Bestandsrechnung Brennstoff')
  expect(v.lines.map((l) => l.label)).toEqual(['Anfangsbestand', 'Lieferung vom 15.03.2025', 'Endbestand (gepeilt am 05.01.2026)', 'Verbraucht'])
  expect(v.lines[3]?.value).toBe(`5.700 l · ${fmtEuro(575000)} · 15.254,91 kg CO₂ · CO₂-Kosten ${fmtEuro(64810)}`)
  expect(v.notes).toContain('Verbraucht wird das Älteste zuerst; den Endbestand bewertet Mietfuchs wie die Messdienste zu den Preisen der jüngsten Lieferungen.')
  expect(v.notes).toContain('Davon 5.352,6 kg CO₂ aus Brennstoff mit Rechnung vor dem 01.01.2023: Sie zählen für die Einstufung, CO₂-Kosten trägt er nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG).')
  expect(v.notes).toContain('Der Anfangsbestand ist der eingefrorene Endbestand der abgeschlossenen Vorperiode.')
  expect(stockBlock(anlage(null))).toBeNull()
})

test('Der Block steht beim Mieter, der einen Übertrag oder einen CO₂-Abzug dieser Anlage hat', () => {
  const st = (ids: string[]): Pick<Statement, 'tenancyId' | 'rows'> => ({
    tenancyId: 'ta',
    rows: ids.map((costItemId) => ({ costItemId, category: 'Heizung und Warmwasser', description: '', totalCents: 0, keyLabel: '', shareCents: 0 })),
  })
  expect(showsStock(anlage(BESTAND), st(['stock:hp:2025-01:in']))).toBe(true)
  expect(showsStock(anlage(BESTAND), st(['r1']))).toBe(false)
  const bewertung: NonNullable<HeatingStatement['co2']> = {
    method: 'selfAfterService', booked: true, deducted: false, totalCents: null, landlordCents: null, landlordPermille: null, kgPerM2: null,
    emissionsKg: null, areaM2: null, stage: null, table: [], shortened: false, selfLandlordCents: null, selfApproximated: false,
    tenants: [{ tenancyId: 'ta', landlordCents: 1, tenantCents: null, approximated: true }],
  }
  expect(showsStock({ ...anlage(BESTAND), co2: bewertung }, st([]))).toBe(true)
})
