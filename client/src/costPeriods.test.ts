import { describe, expect, test } from 'vitest'
import { filedUnderSettlement, heatingRowTarget, itemsOfSettlement, periodCosts, settledInvoiceFiles, settlementKeyOf } from './costPeriods'
import { CALENDAR_RULES, periodKey as k } from '../../shared/period.ts'
import type { CostItem, HeatingPlant, HeatingSettlementInfo, PeriodRules } from './types'

// Der Bestand der Sichtprüfung (E32, E48): Kalenderobjekt, Heizanlage mit eigener Heizperiode Mai bis
// April, getrennte Heizkostenabrechnung ab 05/2025.
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: true,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], units: null, newDevicesInstall: null, ...over,
})
let n = 0
const item = (period: string, amountCents: number, over: Partial<CostItem> = {}): CostItem => ({
  id: `c${++n}`, propertyId: 'objekt-1', period: k(period), category: 'Grundsteuer', description: 'x', amountCents, key: 'area', ...over,
})
const heating = (period: string, amountCents: number): CostItem => item(period, amountCents, { category: 'Heizung und Warmwasser', heatingPlantId: 'hp1' })

const items = [
  item('2024-01', 100000),
  heating('2023-05', 400000),
  item('2025-01', 856560),
  heating('2024-05', 480000),
  heating('2025-05', 30000),
]

describe('Zu welcher Abrechnung eine Position gehört (E32, E48)', () => {
  test('eine Heizposition gehört in den Zeitraum, in dem ihre Heizperiode endet', () => {
    expect(settlementKeyOf(heating('2024-05', 1), CALENDAR_RULES, [plant()])).toEqual({ key: '2025-01', separate: false })
    // Weg d: getrennt abgerechnet, aber im Jahr 2026, in dem ihre Heizperiode endet
    expect(settlementKeyOf(heating('2025-05', 1), CALENDAR_RULES, [plant()])).toEqual({ key: '2026-01', separate: true })
    expect(settlementKeyOf(item('2025-01', 1), CALENDAR_RULES, [plant()])).toEqual({ key: '2025-01', separate: false })
  })

  test('ohne eigene Heizperiode bleibt der Schlüssel der Position', () => {
    expect(settlementKeyOf(heating('2025-01', 1), CALENDAR_RULES, [plant({ periodStartMonth: null, separateSpans: [] })])).toEqual({ key: '2025-01', separate: false })
    // Anlagen noch nicht geladen: wie bisher
    expect(settlementKeyOf(heating('2024-05', 1), CALENDAR_RULES, [])).toEqual({ key: '2024-05', separate: false })
  })

  test('bei einem Objekt mit eigenem Zeitraum der Zeitraum des Objekts, der das Ende enthält', () => {
    const rules: PeriodRules = { startMonth: 7, changes: [] }
    // Heizperiode 05/2025–04/2026 endet im Zeitraum 07/2025–06/2026
    expect(settlementKeyOf(heating('2025-05', 1), rules, [plant({ separateSpans: [] })])).toEqual({ key: '2025-07', separate: false })
  })

  test('itemsOfSettlement nimmt die Heizpositionen mit, deren Heizperiode im Zeitraum endet', () => {
    expect(itemsOfSettlement(items, k('2025-01'), CALENDAR_RULES, [plant()]).map((c) => c.amountCents)).toEqual([856560, 480000])
  })

  test('der Belegordner führt eine Heizposition im Jahr ihrer Abrechnung', () => {
    const filed = filedUnderSettlement(items, () => CALENDAR_RULES, () => [plant()])
    expect(filed.map((c) => c.period)).toEqual(['2024-01', '2024-01', '2025-01', '2025-01', '2026-01'])
    // Alles andere bleibt, wie es ist
    expect(filed[3]).toEqual({ ...items[3], period: '2025-01' })
  })
})

describe('Kostenvergleich je Abrechnungszeitraum (E48)', () => {
  test('keine technischen Schlüssel als eigene Jahre, Heizung im Jahr ihrer Abrechnung', () => {
    const rows = periodCosts(items, CALENDAR_RULES, [plant()])
    expect(rows.map((r) => [r.key, r.label, r.totalCents, r.separateCents])).toEqual([
      ['2024-01', '2024', 500000, 0],
      ['2025-01', '2025', 1336560, 0],
      ['2026-01', '2026', 30000, 30000],
    ])
    expect(rows[1]?.byCategory.get('Heizung und Warmwasser')).toBe(480000)
  })
})

describe('Belegkopien einer Abrechnung', () => {
  test('die Belege der Positionen, die auf dem Papier stehen, auch die der Heizperiode', () => {
    const row = (costItemId: string) => ({ costItemId, category: 'x', description: 'x', totalCents: 1, keyLabel: 'x', shareCents: 1 })
    const settled = [
      item('2025-01', 1, { invoiceFile: 'a.pdf' }), { ...heating('2024-05', 1), invoiceFile: 'erdgas.pdf' },
      item('2025-01', 1, { invoiceFile: 'a.pdf' }), item('2024-01', 1, { invoiceFile: 'alt.pdf' }),
    ]
    const id = (i: number) => settled[i]?.id ?? ''
    const s = { statements: [{ rows: [row(id(0)), row(id(1))] }], landlord: { rows: [row(id(2))] } }
    expect(settledInvoiceFiles(s, settled)).toEqual(['a.pdf', 'erdgas.pdf'])
  })
})

describe('Cockpit → Heizkostenabrechnung (E45)', () => {
  test('führt in den Zeitraum, in dem die Heizperiode endet, und wählt sie aus', () => {
    const h: HeatingSettlementInfo = {
      plantId: 'hp1', plantName: '', deadline: '2027-04-30', closed: null,
      period: { key: k('2025-05'), from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' },
    }
    expect(heatingRowTarget(h, CALENDAR_RULES)).toEqual({ period: '2026-01', focus: { kind: 'heatingSettlement', id: 'hp1|2025-05' } })
  })
})
