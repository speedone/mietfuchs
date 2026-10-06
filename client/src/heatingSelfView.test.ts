import { describe, expect, it } from 'vitest'
import { boundaryLight, boundaryText, distributionLines, potLines, readingResult, shareEditable, userLine } from './heatingSelfView'
import { fmtEuro } from './api'
import type { HeatingDistribution, SelfBoundaryView, SelfHeatingStatement, SelfUnitView } from './types'

const b = (over: Partial<SelfBoundaryView> = {}): SelfBoundaryView => ({ date: '2025-09-30', kind: 'change', status: 'read', offDays: 0, far: false, gap: null, ...over })
const dist = (over: Partial<HeatingDistribution> = {}): HeatingDistribution => ({
  own: { heating: 70, water: 70, insulationRule: 'notApplies' }, effective: { heating: 70, water: 70, insulationRule: 'notApplies' },
  inherited: false, begun: true, first: false, forcedPercent: null, ...over,
})

describe('Ampel der Ablesungen (Heizung PR 10, Entwurf 3.5)', () => {
  it('abgelesen grün, daneben gelb, fehlend rot; eine Antwort macht „nicht möglich“ gelb, „versäumt“ bleibt rot', () => {
    expect(boundaryLight(b())).toBe('green')
    expect(boundaryLight(b({ status: 'off', offDays: 3 }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'missing' }))).toBe('red')
    expect(boundaryLight(b({ status: 'missing', gap: 'impossible' }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'missing', gap: 'missed' }))).toBe('red')
    // Ab der Warngrenze rot, bis der Vermieter gewählt hat (Abweichung 22).
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true }))).toBe('red')
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true, gap: 'useReading' }))).toBe('yellow')
    expect(boundaryLight(b({ status: 'off', offDays: 36, far: true, gap: 'imprecise' }))).toBe('yellow')
  })
  it('der Satz nennt Grenze und Tage', () => {
    expect(boundaryText(b({ status: 'off', offDays: 3 }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 3 Tage daneben')
    expect(boundaryText(b({ status: 'off', offDays: 36, far: true }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 36 Tage daneben, über einen Wintermonat; bitte wählen')
    expect(boundaryText(b({ status: 'off', offDays: 36, far: true, gap: 'imprecise' }), 'C')).toBe('C, Mieterwechsel zum 30.09.2025: abgelesen 36 Tage daneben, über einen Wintermonat (geteilt nach § 9b Abs. 3)')
    expect(boundaryText(b({ status: 'missing', kind: 'end', date: '2025-12-31' }), 'B')).toBe('B, Ende der Heizperiode am 31.12.2025: keine Ablesung')
  })
})

describe('Anteil nach Verbrauch (§ 6 Abs. 4)', () => {
  it('nach Beginn nur noch zu sehen, vorher und beim ersten Mal änderbar', () => {
    expect(shareEditable(dist())).toBe(false)
    expect(shareEditable(dist({ begun: false }))).toBe(true)
    expect(shareEditable(dist({ first: true }))).toBe(true)
    expect(distributionLines(dist({ inherited: true, own: { heating: null, water: null, insulationRule: null } }))).toContain('Heizung 70 %, Warmwasser 70 % nach Verbrauch, übernommen aus der vorigen Heizperiode')
    expect(distributionLines(dist({ forcedPercent: 70 })).join(' ')).toMatch(/§ 7 Abs\. 1 Satz 2/)
  })
})

const self: SelfHeatingStatement = {
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'combined',
  alpha: { percent: 15, dhwHeatKwh: 9000, referenceKwh: 60000, reference: 'fuel', estimated: false },
  shares: { heating: 70, water: 70, forced: false, previous: null },
  pots: [
    { pot: 'heating', costCents: 562800, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 40000, consumptionUnit: 'kWh', baseCentsPerM2: 844.2, consumptionCentsPerUnit: 9.849 },
    { pot: 'water', costCents: 103200, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 120, consumptionUnit: 'm³', baseCentsPerM2: 154.8, consumptionCentsPerUnit: 602 },
  ],
  units: [],
}
const unitC: SelfUnitView = {
  unitId: 'c', unitName: 'C', areaM2: 60, heatAreaM2: 60,
  readings: [
    { meterId: 'wc', meterName: 'Wärme C', pot: 'heating', boundary: '2025-09-30', date: '2025-09-30', value: 7700 },
    { meterId: 'xc', meterName: 'Warmwasser C', pot: 'water', boundary: '2025-09-30', date: null, value: null },
  ],
  boundaries: [], users: [],
}

describe('Ausweis und Ableseergebnis (Entwurf 8.8, § 6 Abs. 1 Satz 2)', () => {
  it('Topf mit Kosten, Anteil und Preisen je Einheit', () => {
    // fmtEuro setzt ein geschütztes Leerzeichen vor „€“, die Preise je Einheit ebenso.
    const [pot] = self.pots
    if (!pot) throw new Error('kein Topf im Ausweis')
    expect(potLines(pot)).toEqual([
      `Heizung: ${fmtEuro(562800)}`,
      `Grundkosten 30 %: ${fmtEuro(168840)} für 200 m², 8,4420\u00a0€ je m²`,
      `Verbrauchskosten 70 %: ${fmtEuro(393960)} für 40.000 kWh, 0,098490\u00a0€ je kWh`,
    ])
  })
  it('Nutzerzeile mit Verbrauch, Gradtagen und Betrag', () => {
    const c1 = { key: 'C1', role: 'tenancy' as const, tenancyId: 'C1', label: 'Mieter C1', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640, heatingConsumption: 7200, waterConsumption: 38, heatingGroup: false, waterGroup: false, heatingCents: 103330, waterCents: 29823, heatingCo2Cents: 0, waterCo2Cents: 0 }
    expect(userLine({ ...c1, heatingCo2Cents: 9281 }, self)).toContain(`Heizung 7.200 kWh, ${fmtEuro(103330)}, nach CO₂-Abzug ${fmtEuro(94049)}`)
    expect(userLine(c1, self))
      .toBe(`Mieter C1, 01.01.2025 bis 30.09.2025 (273 Tage, 640 ‰ der Gradtage): Heizung 7.200 kWh, ${fmtEuro(103330)}; Warmwasser 38 m³, ${fmtEuro(29823)}`)
  })
  it('Ableseergebnis je Wohnung: Zähler, Datum, Stand; fehlend als solcher benannt', () => {
    expect(readingResult(unitC, '2025-09-30')).toEqual(['Wärme C: 7.700 kWh am 30.09.2025', 'Warmwasser C: nicht abgelesen'])
  })
})
