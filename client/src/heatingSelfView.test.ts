import { describe, expect, it } from 'vitest'
import { boundaryLight, boundaryText, missingDevicesLines, distributionLines, estimateLines, gapConsequence, heatUnitOf, insulationAsked, percentOf, potLines, READING_RESULT_HINT, readingResult, shareEditable, unsureShareHint, userLine } from './heatingSelfView'
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
  // Systemprüfung: Heizkostenverteiler gewählt, kein Gerät angelegt. Nichts abzulesen ist nicht „abgelesen“.
  it('ohne angelegtes Gerät: rot und der fehlende Schritt statt „abgelesen“', () => {
    expect(boundaryLight(b({ noDevicePots: ['heating'] }))).toBe('red')
    expect(boundaryText(b({ noDevicePots: ['heating'], kind: 'end', date: '2025-12-31' }), 'EG')).toBe('EG, Ende der Heizperiode am 31.12.2025: für die Heizung kein Gerät angelegt')
    expect(boundaryText(b({ noDevicePots: ['heating', 'water'], kind: 'end', date: '2025-12-31' }), 'EG')).toBe('EG, Ende der Heizperiode am 31.12.2025: für die Heizung und das Warmwasser kein Gerät angelegt')
    expect(boundaryText(b({ noDevicePots: ['heating'], kind: 'end', date: '2025-12-31' }), 'EG', 'serviceValues')).toBe('EG, Ende der Heizperiode am 31.12.2025: für die Heizung kein Wert des Ablesedienstes eingetragen')
    // Durchsicht des Zweigs: Fehlt daneben ein Stand des anderen Topfs, steht beides da.
    expect(boundaryText(b({ noDevicePots: ['heating'], status: 'missing', kind: 'end', date: '2025-12-31', missingMeters: [{ name: 'Warmwasser' }] }), 'EG'))
      .toBe('EG, Ende der Heizperiode am 31.12.2025: für die Heizung kein Gerät angelegt; keine Ablesung am Zähler „Warmwasser“')
  })
  it('je Topf ohne Gerät ein Satz mit dem Weg zur Seite Zähler; sonst keiner', () => {
    const pot = (over: Partial<SelfHeatingStatement['pots'][number]>) => ({ pot: 'heating', byAreaOnly: true, ...over }) as SelfHeatingStatement['pots'][number]
    expect(missingDevicesLines({ capture: 'hca', pots: [pot({ noDevices: true })] })).toEqual([
      'Heizung: An keiner Wohnung ist ein Heizkostenverteiler angelegt; verteilt wird deshalb nur nach Fläche. Legen Sie die Geräte auf der Seite „Zähler & Stände“ an und tragen Sie dort die Ablesungen zu Beginn und Ende der Heizperiode ein.',
    ])
    expect(missingDevicesLines({ capture: 'heatMeter', pots: [pot({ noDevices: true, basisUnit: 'm³' }), pot({ pot: 'water', noDevices: true })] }).map((l) => l.split(';')[0])).toEqual([
      'Heizung: An keiner Wohnung ist ein Wärmezähler angelegt', 'Warmwasser: An keiner Wohnung ist ein Warmwasserzähler angelegt',
    ])
    expect(missingDevicesLines({ capture: 'heatMeter', pots: [pot({ noDevices: true, basisUnit: 'm³' })] })[0]).toMatch(/nur nach umbautem Raum\./)
    expect(missingDevicesLines({ capture: 'serviceValues', pots: [pot({ noDevices: true })] })).toEqual([
      'Heizung: Es sind keine Werte des Ablesedienstes eingetragen; verteilt wird deshalb nur nach Fläche. Tragen Sie die Werte auf dieser Seite unter „Werte des Ablesedienstes“ ein.',
    ])
    expect(missingDevicesLines({ capture: 'hca', pots: [pot({})] })).toEqual([])
    // Eine ältere abgeschlossene Abrechnung kennt die Angabe nicht.
    expect(missingDevicesLines({ pots: [pot({})] })).toEqual([])
  })
  // Befund M7 aus #341: gemeint war der neue Warmwasserzähler, der Satz nannte ihn nicht.
  it('der Satz nennt den Zähler ohne Stand, mit Nummer', () => {
    expect(boundaryText(b({ status: 'missing', kind: 'start', date: '2024-12-31', missingMeters: [{ name: 'Warmwasser neu', number: 'WW-4711' }] }), 'EG links'))
      .toBe('EG links, Beginn der Heizperiode am 31.12.2024: keine Ablesung am Zähler „Warmwasser neu“ (Nr. WW-4711)')
    expect(boundaryText(b({ status: 'missing', kind: 'end', date: '2025-12-31', missingMeters: [{ name: 'Wärme' }, { name: 'Warmwasser' }] }), 'B'))
      .toBe('B, Ende der Heizperiode am 31.12.2025: keine Ablesung an den Zählern „Wärme“ und „Warmwasser“')
    expect(boundaryText(b({ status: 'missing', gap: 'missed', missingMeters: [{ name: 'Wärme' }] }), 'C'))
      .toBe('C, Mieterwechsel zum 30.09.2025: keine Ablesung am Zähler „Wärme“ (nicht durchgeführt)')
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
  // Systemprüfung: Grund- und Verbrauchskosten stehen je Nutzer getrennt (7.200 kWh mal 0,098490 € = 709,13 €).
  it('Nutzerzeile mit Verbrauch, Gradtagen und Betrag', () => {
    const c1 = { key: 'C1', role: 'tenancy' as const, tenancyId: 'C1', label: 'Mieter C1', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640, heatingConsumption: 7200, waterConsumption: 38, heatingGroup: false, waterGroup: false, heatingCents: 103330, waterCents: 29823, heatingCo2Cents: 0, waterCo2Cents: 0 }
    expect(userLine({ ...c1, heatingCo2Cents: 9281 }, self)).toContain(`Heizung 7.200 kWh, ${fmtEuro(103330)} (Grundkosten ${fmtEuro(32417)}, Verbrauchskosten ${fmtEuro(70913)}), nach CO₂-Abzug ${fmtEuro(94049)}`)
    expect(userLine(c1, self))
      .toBe(`Mieter C1, 01.01.2025 bis 30.09.2025 (273 Tage, 640 ‰ der Gradtage): Heizung 7.200 kWh, ${fmtEuro(103330)} (Grundkosten ${fmtEuro(32417)}, Verbrauchskosten ${fmtEuro(70913)}); Warmwasser 38 m³, ${fmtEuro(29823)} (Grundkosten ${fmtEuro(6947)}, Verbrauchskosten ${fmtEuro(22876)})`)
  })
  it('Ableseergebnis je Wohnung: Zähler, Datum, Stand; fehlend als solcher benannt', () => {
    expect(readingResult(unitC, '2025-09-30')).toEqual(['Wärme C: 7.700 kWh am 30.09.2025', 'Warmwasser C: nicht abgelesen'])
  })
  // UI-Durchsicht H5: Ein Wärmezähler in MWh mit Stand 88,4 erschien als „88 kWh“, falsche Einheit und gerundet.
  it('Ableseergebnis: die Einheit kommt vom Zähler, Nachkommastellen bleiben', () => {
    const unit: SelfUnitView = {
      unitId: 'c', unitName: 'EG links', areaM2: 60, heatAreaM2: 60, boundaries: [], users: [],
      readings: [
        { meterId: 'w', meterName: 'Wärme EG links', meterUnit: 'MWh', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 88.4 },
        { meterId: 'ww', meterName: 'Warmwasser EG links', meterUnit: 'm³', pot: 'water', boundary: '2025-12-31', date: '2025-12-31', value: 12.375 },
        { meterId: 'x', meterName: 'Wärme alt', meterUnit: 'MWh', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 0.5, oldEndValue: 91.25 },
      ],
    }
    expect(readingResult(unit, '2025-12-31')).toEqual([
      'Wärme EG links: 88,4 MWh am 31.12.2025',
      'Warmwasser EG links: 12,375 m³ am 31.12.2025',
      'Wärme alt: 91,25 MWh am 31.12.2025 (Endstand des alten Zählers; der neue beginnt mit 0,5)',
    ])
  })
})

describe('Durchsicht von #239', () => {
  it('C1: Rat bei „Weiß ich nicht“ unter dem Pflichtanteil, nur bei Öl und Gas', () => {
    expect(unsureShareHint('gas', 'unknown', 50)).toMatch(/Mit 70 % liegen Sie in jedem Fall richtig; trifft § 7 Abs\. 1 Satz 2 HeizkostenV zu, sind weniger nicht zulässig\./)
    expect(unsureShareHint('gas', 'unknown', 70)).toBeNull()
    expect(unsureShareHint('gas', 'notApplies', 50)).toBeNull()
    expect(unsureShareHint('districtHeating', 'unknown', 50)).toBeNull()
    expect([insulationAsked('lpg'), insulationAsked('heatPump')]).toEqual([true, false])
  })
  it('I3: die Folge jeder Antwort und der Grund im Text', () => {
    // Nachprüfung, N1: wie der Server, „bis zu“ und als Auslegung mit Fundstelle.
    expect(gapConsequence('missed')).toMatch(/Nach einer Auslegung \(LG Hamburg, 11 S 202\/87\) dürfen die Mieter ihren Anteil an diesen Kosten um bis zu 15 % kürzen\./)
    expect(gapConsequence('impossible')).toMatch(/§ 9b Abs\. 3 HeizkostenV\)\. Nennen Sie den Grund/)
    expect(boundaryText({ date: '2025-09-30', kind: 'change', status: 'missing', offDays: 0, far: false, gap: 'impossible', gapReason: 'Wohnung nicht zugänglich' }, 'C'))
      .toBe('C, Mieterwechsel zum 30.09.2025: keine Ablesung (nicht möglich: Wohnung nicht zugänglich)')
  })
  it('M9: Prozent mit höchstens zwei Nachkommastellen', () => {
    expect([percentOf('65,25'), percentOf('65.125'), percentOf('70'), percentOf('')]).toEqual([65.25, null, 70, null])
  })
})

describe('Heizung PR 12: bei Heizkostenverteilern und Ablesedienst Einheiten statt kWh', () => {
  it('Nutzerzeile und Ableseergebnis', () => {
    const u = {
      key: 'A', role: 'tenancy' as const, tenancyId: 'A', label: 'Mieter A', from: '2025-01-01', to: '2025-12-31', days: 365, degreeDayPermille: 1000,
      heatingConsumption: 785, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0,
    }
    const pot = { pot: 'heating' as const, costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 7850, consumptionUnit: 'Einheiten' as const, baseCentsPerM2: 0, consumptionCentsPerUnit: null }
    expect(userLine(u, { pots: [pot] })).toContain('Heizung 785 Einheiten')
    expect(userLine(u, { pots: [{ ...pot, consumptionUnit: 'kWh' }] })).toContain('Heizung 785 kWh')
    expect(heatUnitOf({ pots: [pot] })).toBe('Einheiten')
    const unit: SelfUnitView = {
      unitId: 'a', unitName: 'A', areaM2: 60, heatAreaM2: 60, boundaries: [], users: [],
      readings: [{ meterId: 'a1', meterName: 'Wohnzimmer', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 500 }],
    }
    expect(readingResult(unit, '2025-12-31', 'Einheiten')).toEqual(['Wohnzimmer: 500 Einheiten am 31.12.2025'])
    expect(readingResult(unit, '2025-12-31')).toEqual(['Wohnzimmer: 500 kWh am 31.12.2025'])
  })
})

describe('#342, Durchsicht E2: Topf einheitlich in MWh', () => {
  it('Nutzerzeile und Ableseergebnis in MWh, wenn der Topf in MWh steht', () => {
    const pot = { pot: 'heating' as const, costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 52.5, consumptionUnit: 'MWh', baseCentsPerM2: 0, consumptionCentsPerUnit: null }
    expect(heatUnitOf({ pots: [pot] })).toBe('MWh')
    const u = {
      key: 'A', role: 'tenancy' as const, tenancyId: 'A', label: 'Mieter A', from: '2025-01-01', to: '2025-12-31', days: 365, degreeDayPermille: 1000,
      heatingConsumption: 12, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0,
    }
    expect(userLine(u, { pots: [pot] })).toContain('Heizung 12 MWh')
    const unit: SelfUnitView = { unitId: 'a', unitName: 'A', areaM2: 60, heatAreaM2: 60, boundaries: [], users: [], readings: [{ meterId: 'a1', meterName: 'Wärme A', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 13 }] }
    expect(readingResult(unit, '2025-12-31', heatUnitOf({ pots: [pot] }))).toEqual(['Wärme A: 13 MWh am 31.12.2025'])
  })
})

describe('#342: das Ableseergebnis nennt die Einheit des Zählers', () => {
  it('ein Wärmezähler in MWh und ein Warmwasserzähler in Litern', () => {
    const unit: SelfUnitView = {
      unitId: 'b', unitName: 'B', areaM2: 80, heatAreaM2: 80, boundaries: [], users: [],
      readings: [
        { meterId: 'wz-b', meterName: 'Wärme B', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 16.125, meterUnit: 'MWh' },
        { meterId: 'xw-b', meterName: 'Warmwasser B', pot: 'water', boundary: '2025-12-31', date: '2025-12-31', value: 40000, meterUnit: 'l', oldEndValue: 38000 },
      ],
    }
    expect(readingResult(unit, '2025-12-31')).toEqual([
      'Wärme B: 16,125 MWh am 31.12.2025',
      'Warmwasser B: 38.000 l am 31.12.2025 (Endstand des alten Zählers; der neue beginnt mit 40.000)',
    ])
  })
})

describe('Durchsicht #241 Recht-I2: Ableseergebnis am Stichtag nennt den Stichtagswert, nicht die 0', () => {
  it('Stichtag beim Heizkostenverteiler, Wechsel beim Wärmezähler', () => {
    const unit: SelfUnitView = {
      unitId: 'a', unitName: 'A', areaM2: 60, heatAreaM2: 60, boundaries: [], users: [],
      readings: [
        { meterId: 'a1', meterName: 'Wohnzimmer', pot: 'heating', boundary: '2025-12-31', date: '2025-12-31', value: 0, oldEndValue: 842 },
        { meterId: 'xa', meterName: 'Warmwasser', pot: 'water', boundary: '2025-12-31', date: '2025-12-31', value: 3, oldEndValue: 40 },
      ],
    }
    expect(readingResult(unit, '2025-12-31', 'Einheiten')).toEqual([
      'Wohnzimmer: Stichtagswert 842 Einheiten am 31.12.2025 (Gerät danach auf 0)',
      'Warmwasser: 40 m³ am 31.12.2025 (Endstand des alten Zählers; der neue beginnt mit 3)',
    ])
    expect(READING_RESULT_HINT).toMatch(/§ 6 Abs\. 1 Satz 3/)
  })
})

describe('Ausweis mit Schätzung (Heizung PR 13)', () => {
  it('Topf über der Grenze: nur nach Fläche, mit Satz zu § 9a Abs. 2', () => {
    const lines = potLines({ pot: 'heating', costCents: 562800, consumptionPct: 0, byAreaOnly: false, areaM2: 200, consumption: 40000, consumptionUnit: 'kWh', baseCentsPerM2: 2814, consumptionCentsPerUnit: null, overThreshold: true, estimatedAreaM2: 60 })
    expect(lines).toContain('Geschätzt ist der Verbrauch für 60 von 200 m²; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach Fläche verteilt.')
  })
  it('Nutzer mit geschätztem Verbrauch, auch gemeinsam nach § 9b Abs. 3', () => {
    const u = { key: 'C1', role: 'tenancy' as const, tenancyId: 'C1', label: 'Mieter C1', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640, heatingConsumption: 7680, waterConsumption: null, heatingGroup: true, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0, heatingEstimated: true }
    expect(userLine(u, { pots: [] })).toContain('Heizung 7.680 kWh (geschätzt nach § 9a, gemeinsam nach § 9b Abs. 3)')
    expect(userLine({ ...u, heatingGroup: false }, { pots: [] })).toContain('Heizung 7.680 kWh (geschätzt nach § 9a),')
    expect(userLine({ ...u, heatingEstimated: false }, { pots: [] })).toContain('Heizung 7.680 kWh (gemeinsam nach § 9b Abs. 3),')
  })
  it('Druck: die Schätzung der eigenen Wohnung mit Weg und Begründung, nie die einer anderen', () => {
    const self = {
      pots: [],
      estimates: [
        { plantId: 'hp', unitId: 'c', unitName: 'C', part: 'heat' as const, value: 12000, method: 'buildingAverage' as const, reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure' as const, capture: 'heatMeter' as const, valueUnit: 'kWh' as const, users: 1, kept: 1, complete: false },
        { plantId: 'hp', unitId: 'a', unitName: 'A', part: 'heat' as const, value: 9000, method: 'previousPeriod' as const, reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure' as const, capture: 'heatMeter' as const, valueUnit: 'kWh' as const, users: 1, kept: 0, complete: false },
      ],
    }
    expect(estimateLines(self, 'c', { heatingEstimated: true })).toEqual([
      // Wortlaut seit der Durchsicht von #242 (R-I1, R-I2); ohne Verbrauch des Nutzers ohne den Satz zum Anteil.
      'Heizung: Der Verbrauch Ihrer Wohnung konnte nicht ordnungsgemäß erfasst werden (Gerät ausgefallen; Begründung: „Wärmezähler defekt“) und ist nach § 9a HeizkostenV ermittelt, nach dem Durchschnitt des Gebäudes je m²: 12.000 kWh für die ganze Heizperiode der Wohnung. Für die Zeit vor Ihrem Einzug liegt eine gültige Ablesung vor; sie gilt dort weiter.',
    ])
    // Der Vormieter mit gültiger Ablesung bekommt keinen Satz zur Schätzung.
    expect(estimateLines(self, 'c', { heatingEstimated: false })).toEqual([])
    expect(estimateLines({ ...self, estimates: undefined }, 'c', { heatingEstimated: true })).toEqual([])
  })
})

// Durchsicht von #242 (Recht): R-I1 Wortlaut, R-I2 nachrechenbarer Satz für den Nachmieter, R-M5 Klammern,
// R-M8 über der Grenze, R-M9 geschätzter Teil im Topf, G-M6 ganze Heizperiode.
describe('Durchsicht von #242: Ausweis mit Schätzung', () => {
  const est = (over: Record<string, unknown> = {}) => ({
    plantId: 'hp', unitId: 'c', unitName: 'C', part: 'heat' as const, value: 12000, method: 'buildingAverage' as const, reason: 'Wärmezähler defekt (Fachbetrieb)', confirmed: true,
    cause: 'deviceFailure' as const, capture: 'heatMeter' as const, valueUnit: 'kWh' as const, users: 1, kept: 1, complete: false, ...over,
  })
  const heat = { pot: 'heating' as const, costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 40000, consumptionUnit: 'kWh' as const, baseCentsPerM2: 0, consumptionCentsPerUnit: 1, overThreshold: false, estimatedAreaM2: 60 }
  it('R-I1/R-I2/R-M5: „nicht ordnungsgemäß erfasst“, Grund aus der Auswahl, Begründung in Anführungszeichen, Anteil des Nachmieters nachrechenbar', () => {
    const self = { pots: [heat], changeSplit: 'degreeDays' as const, estimates: [est()] }
    expect(estimateLines(self, 'c', { heatingEstimated: true, heatingConsumption: 4320 })).toEqual([
      'Heizung: Der Verbrauch Ihrer Wohnung konnte nicht ordnungsgemäß erfasst werden (Gerät ausgefallen; Begründung: „Wärmezähler defekt (Fachbetrieb)“) und ist nach § 9a HeizkostenV ermittelt, nach dem Durchschnitt des Gebäudes je m²: 12.000 kWh für die ganze Heizperiode der Wohnung. ' +
        'Für die Zeit vor Ihrem Einzug liegt eine gültige Ablesung vor; sie gilt dort weiter. Auf Ihren Zeitraum entfallen 360 ‰ der Gradtage, also 360 ‰ von 12.000 kWh = 4.320 kWh.',
    ])
    // Teilung nach Tagen bzw. Warmwasser nach Tagen.
    expect(estimateLines({ ...self, changeSplit: 'time' as const }, 'c', { heatingEstimated: true, heatingConsumption: 4320 })[0]).toMatch(/360 ‰ der Tage/)
  })
  // Durchsicht Runde 2, N-I2: nur bei einem ersetzten gemessenen Teilstück, nicht bei bloßem Anfangsstand oder Ablesedienst ohne Werte.
  it('G-M6/N-I2: der Satz zu abgelesenen Zeiten nur, wenn ein gemessenes Teilstück ersetzt wird', () => {
    const mit = { pots: [heat], changeSplit: 'degreeDays' as const, estimates: [est({ kept: 0, replacesMeasured: true })] }
    expect(estimateLines(mit, 'c', { heatingEstimated: true, heatingConsumption: 12000 })[0]).toMatch(/ganze Heizperiode der Wohnung\. Sie gilt auch für Zeiten, für die Ablesungen vorliegen\.$/)
    const ohne = { pots: [heat], changeSplit: 'degreeDays' as const, estimates: [est({ kept: 0, replacesMeasured: false })] }
    expect(estimateLines(ohne, 'c', { heatingEstimated: true, heatingConsumption: 12000 })[0]).not.toMatch(/Ablesungen vorliegen/)
    const dienst = { pots: [heat], changeSplit: 'degreeDays' as const, estimates: [est({ kept: 0, cause: 'otherReason', reason: 'Werte fehlen' })] }
    expect(estimateLines(dienst, 'c', { heatingEstimated: true, heatingConsumption: 12000 })[0]).not.toMatch(/Ablesungen vorliegen/)
  })
  it('R-M8: über der Grenze ist der Verbrauch für die Verteilung nicht maßgeblich', () => {
    const over = { ...heat, overThreshold: true, consumptionPct: 0 }
    const self = { pots: [over], changeSplit: 'degreeDays' as const, estimates: [est()] }
    expect(estimateLines(self, 'c', { heatingEstimated: true, heatingConsumption: 4320 })[0]).toMatch(/Für die Verteilung ist der Verbrauch nicht maßgeblich.*§ 9a Abs\. 2/)
    const u = { key: 'A', role: 'tenancy' as const, tenancyId: 'A', label: 'Mieter A', from: '2025-01-01', to: '2025-12-31', days: 365, degreeDayPermille: 1000, heatingConsumption: 12000, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0 }
    expect(userLine(u, { pots: [over] })).toContain('Heizung 12.000 kWh (für die Verteilung nicht maßgeblich, § 9a Abs. 2)')
  })
  it('R-M9: der Topf nennt, wie viel darin geschätzt ist', () => {
    expect(potLines({ ...heat, estimatedConsumption: 4320, costCents: 100000 }).join(' ')).toMatch(/davon geschätzt nach § 9a HeizkostenV: 4\.320 kWh/)
    expect(potLines({ ...heat, estimatedConsumption: 0, costCents: 100000 }).join(' ')).not.toMatch(/geschätzt/)
  })
})

describe('#322: Ausweis nach umbautem Raum', () => {
  it('Grundkosten der Heizung je m³, über der Grenze nach umbautem Raum', () => {
    const base = { pot: 'heating' as const, costCents: 562800, consumptionPct: 30, byAreaOnly: false, areaM2: 650, consumption: 40000, consumptionUnit: 'kWh', baseCentsPerM2: 606.0923, consumptionCentsPerUnit: 4.221, basisUnit: 'm³' as const }
    // Systemprüfung: 650 m³ mal 6,0609 € ergäben 3.939,59 €; mit sechs Stellen stimmt der Betrag.
    expect(potLines(base)[1]).toBe(`Grundkosten 70 %: ${fmtEuro(393960)} für 650 m³, 6,060923 € je m³`)
    expect(potLines({ ...base, consumptionPct: 0, overThreshold: true, estimatedAreaM2: 300, consumptionCentsPerUnit: null })).toContain('Geschätzt ist der Verbrauch für 300 von 650 m³; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach umbautem Raum verteilt.')
  })
})

describe('#322, Durchsicht S2 und K4: Druckzeilen beim umbauten Raum', () => {
  const est = { plantId: 'hp', unitId: 'c', unitName: 'C', part: 'heat' as const, value: 12000, method: 'buildingAverage' as const, reason: 'defekt', confirmed: true, cause: 'deviceFailure' as const, capture: 'heatMeter' as const, valueUnit: 'kWh' as const, users: 1, kept: 0, complete: false }
  const heat = { pot: 'heating' as const, costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 600, consumption: 40000, consumptionUnit: 'kWh' as const, baseCentsPerM2: 0, consumptionCentsPerUnit: 1, overThreshold: false, estimatedAreaM2: 0, basisUnit: 'm³' as const }
  it('Schätzung nach dem Durchschnitt je m³, über der Grenze nach umbautem Raum', () => {
    expect(estimateLines({ pots: [heat], changeSplit: 'degreeDays', estimates: [est] }, 'c', { heatingEstimated: true, heatingConsumption: 12000 })[0]).toMatch(/nach dem Durchschnitt des Gebäudes je m³: 12\.000 kWh/)
    expect(estimateLines({ pots: [{ ...heat, overThreshold: true }], changeSplit: 'degreeDays', estimates: [est] }, 'c', { heatingEstimated: true, heatingConsumption: 12000 })[0]).toMatch(/Der geschätzte umbaute Raum des Hauses überschreitet die Grenze des § 9a Abs\. 2 HeizkostenV, verteilt wird nur nach umbautem Raum\./)
  })
  it('kein Verbrauch erfasst: nur nach umbautem Raum', () => {
    expect(potLines({ ...heat, byAreaOnly: true, consumptionCentsPerUnit: null })).toContain('Kein Verbrauch erfasst: nur nach umbautem Raum verteilt.')
  })
})

// Systemprüfung: Mengen standen ohne Nachkommastellen neben dem Preis je Einheit („für 35 MWh“ bei gerechneten 35,4),
// Menge mal Preis ergab auf dem Blatt nie den Betrag; Grund- und Verbrauchskosten standen je Mieter nicht getrennt.
describe('Ausweis zum Nachrechnen: Mengen so genau wie gerechnet', () => {
  // Vier Wohnungen zu 72,5 m², Wärmezähler in MWh, 70 % nach Verbrauch von 2.856,00 €.
  const consumptions = [4.2, 9.6, 0.1, 21.5]
  // Die Summe trägt einen Gleitkommarest, wie ihn der Server aus Differenzen von Ständen liefern kann.
  const total = 35.400000000000006
  const pot = {
    pot: 'heating' as const, costCents: 285600, consumptionPct: 70, byAreaOnly: false, areaM2: 290, consumption: total, consumptionUnit: 'MWh',
    baseCentsPerM2: 85680 / 290, consumptionCentsPerUnit: 199920 / total,
  }
  const cents = [45139, 75636, 21985, 142840]
  const users = consumptions.map((c, i) => ({
    key: `T${i}`, role: 'tenancy' as const, tenancyId: `T${i}`, label: `Mieter ${i}`, from: '2025-01-01', to: '2025-12-31', days: 365, degreeDayPermille: 1000,
    heatingConsumption: c, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: cents[i] ?? 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0,
  }))
  const units: SelfUnitView[] = users.map((u, i) => ({ unitId: `u${i}`, unitName: `W${i}`, areaM2: 72.5, heatAreaM2: 72.5, readings: [], boundaries: [], users: [u] }))
  const statement = { pots: [pot], units }
  const de = (text: string): number => Number(text.replace(/\./g, '').replace(',', '.'))
  const firstUser = () => {
    const first = users[0]
    if (!first) throw new Error('kein Nutzer')
    return first
  }

  it('die Zahlen des Befunds: 35,4 MWh im Topf, 4,2, 9,6 und 0,1 MWh je Mieter, 72,5 m²', () => {
    expect(total).not.toBe(35.4)
    expect(potLines(pot)).toEqual([
      `Heizung: ${fmtEuro(285600)}`,
      `Grundkosten 30 %: ${fmtEuro(85680)} für 290 m², 2,95448 € je m²`,
      `Verbrauchskosten 70 %: ${fmtEuro(199920)} für 35,4 MWh, 56,474576 € je MWh`,
    ])
    const lines = users.map((u) => userLine(u, statement))
    expect(lines[0]).toBe(`Mieter 0, 01.01.2025 bis 31.12.2025 (365 Tage, 1.000 ‰ der Gradtage): Heizung 4,2 MWh, ${fmtEuro(45139)} (Grundkosten ${fmtEuro(21420)} für 72,5 m², Verbrauchskosten ${fmtEuro(23719)})`)
    expect(lines[1]).toContain(`Heizung 9,6 MWh, ${fmtEuro(75636)} (Grundkosten ${fmtEuro(21420)} für 72,5 m², Verbrauchskosten ${fmtEuro(54216)})`)
    expect(lines[2]).toContain(`Heizung 0,1 MWh, ${fmtEuro(21985)} (Grundkosten ${fmtEuro(21420)} für 72,5 m², Verbrauchskosten ${fmtEuro(565)})`)
  })

  // Im Beispiel geht es genau auf; allgemein gilt nur „bis auf Rundung von höchstens einem Cent“ (Durchsicht, nächster Block).
  it('je Zeile des Beispiels: gedruckte Menge mal gedruckter Preis ergibt den gedruckten Betrag', () => {
    const row = /kosten [\d,]+ %: ([\d.,]+) € für ([\d.,]+) \S+, ([\d.,]+) € je /
    const prices: number[] = []
    for (const line of potLines(pot).slice(1)) {
      const m = row.exec(line)
      if (!m) throw new Error(`Zeile nicht lesbar: ${line}`)
      const [amount, quantity, price] = [de(m[1] ?? ''), de(m[2] ?? ''), de(m[3] ?? '')]
      expect(Math.round(quantity * price * 100), line).toBe(Math.round(amount * 100))
      prices.push(price)
    }
    const [basePrice, usePrice] = prices
    if (basePrice === undefined || usePrice === undefined) throw new Error('Preise fehlen')
    // Je Mieter: Verbrauch mal Preis = Verbrauchskosten, Fläche mal Preis = Grundkosten (ganze Heizperiode), beides = Betrag.
    for (const u of users) {
      const line = userLine(u, statement)
      const m = /Heizung ([\d.,]+) MWh, ([\d.,]+) € \(Grundkosten ([\d.,]+) € für ([\d.,]+) m², Verbrauchskosten ([\d.,]+) €\)/.exec(line)
      if (!m) throw new Error(`Zeile nicht lesbar: ${line}`)
      const [quantity, amount, base, area, use] = [de(m[1] ?? ''), de(m[2] ?? ''), de(m[3] ?? ''), de(m[4] ?? ''), de(m[5] ?? '')]
      expect(Math.round(quantity * usePrice * 100), line).toBe(Math.round(use * 100))
      // Die Grundkosten sind der Rest zum Betrag der Zeile: höchstens ein Cent neben Fläche mal Preis.
      expect(Math.abs(Math.round(area * basePrice * 100) - Math.round(base * 100)), line).toBeLessThanOrEqual(1)
      expect(Math.round(base * 100) + Math.round(use * 100), line).toBe(Math.round(amount * 100))
    }
  })

  it('ganze Zahlen ohne Nachkommastellen, kein Schwanz aus Gleitkommaresten', () => {
    const first = firstUser()
    expect(userLine({ ...first, heatingConsumption: 0.1 + 0.2 }, { pots: [{ ...pot, consumptionCentsPerUnit: null }] })).toContain('Heizung 0,3 MWh,')
    expect(userLine({ ...first, heatingConsumption: 785 }, { pots: [{ ...pot, consumptionUnit: 'Einheiten', consumptionCentsPerUnit: null }] })).toContain('Heizung 785 Einheiten,')
    expect(userLine({ ...first, degreeDayPermille: 359.96 }, { pots: [pot] })).toContain('360 ‰ der Gradtage')
    expect(userLine({ ...first, degreeDayPermille: 640.4 }, { pots: [pot] })).toContain('640,4 ‰ der Gradtage')
  })

  it('ein gerechneter Anteil (§ 9b Abs. 3) bekommt so viele Stellen, wie der Preis für den Cent braucht', () => {
    const first = firstUser()
    const share = 6.2 / 3
    const line = userLine({ ...first, heatingConsumption: share, heatingGroup: true, heatingCents: 30000 }, { pots: [pot] })
    const m = /Heizung ([\d.,]+) MWh/.exec(line)
    if (!m) throw new Error(line)
    // Die Rundung der Menge verschiebt den Betrag um höchstens einen Viertelcent.
    expect(Math.abs(de(m[1] ?? '') - share) * (199920 / total)).toBeLessThanOrEqual(0.25)
    // In kWh genügen dafür zwei Stellen.
    expect(userLine({ ...first, heatingConsumption: 6200 / 3, heatingGroup: true }, { pots: [{ ...pot, consumptionUnit: 'kWh', consumptionCentsPerUnit: 9.849 }] })).toContain('Heizung 2.066,67 kWh')
  })

  it('Fläche und Raum mit Nachkommastellen, der Preis mit so vielen Stellen, wie die Menge verlangt', () => {
    const lines = potLines({ ...pot, areaM2: 217.5, baseCentsPerM2: 85680 / 217.5, estimatedAreaM2: 72.5, overThreshold: true, consumptionPct: 0, consumptionCentsPerUnit: null })
    expect(lines[1]).toMatch(/für 217,5 m², 3,93931 € je m²$/)
    expect(lines[2]).toMatch(/^Geschätzt ist der Verbrauch für 72,5 von 217,5 m²;/)
    // Ein krummer Anteil nach Verbrauch wird nicht auf ganze Prozent gerundet.
    expect(potLines({ ...pot, consumptionPct: 65.25 })[1]).toMatch(/^Grundkosten 34,75 %:/)
  })

  it('ohne Preis je Einheit oder ohne Betrag keine Aufteilung (alte Stände, nur nach Fläche, über der Grenze)', () => {
    const first = firstUser()
    expect(userLine(first, { pots: [{ ...pot, consumptionCentsPerUnit: null }] }).endsWith(`Heizung 4,2 MWh, ${fmtEuro(45139)}`)).toBe(true)
    expect(userLine({ ...first, heatingCents: 0 }, statement).endsWith(`Heizung 4,2 MWh, ${fmtEuro(0)}`)).toBe(true)
    // Ohne `units` (Aufrufer ohne Wohnungen) fehlt nur die Fläche.
    expect(userLine(first, { pots: [pot] })).toContain(`(Grundkosten ${fmtEuro(21420)}, Verbrauchskosten ${fmtEuro(23719)})`)
    // Mit CO₂-Abzug steht die Aufteilung beim Betrag vor dem Abzug.
    expect(userLine({ ...first, heatingCo2Cents: 1000 }, statement)).toContain(`${fmtEuro(45139)} (Grundkosten ${fmtEuro(21420)} für 72,5 m², Verbrauchskosten ${fmtEuro(23719)}), nach CO₂-Abzug ${fmtEuro(44139)}`)
  })
})

// Durchsicht des Zweigs: Teilzeitraum, ehrliche Grenze von einem Cent, Stände ohne Fläche, negative Null.
describe('Ausweis zum Nachrechnen: Durchsicht', () => {
  const total = 35.400000000000006
  const heat = {
    pot: 'heating' as const, costCents: 285600, consumptionPct: 70, byAreaOnly: false, areaM2: 290, consumption: total, consumptionUnit: 'MWh',
    baseCentsPerM2: 85680 / 290, consumptionCentsPerUnit: 199920 / total,
  }
  const water = {
    pot: 'water' as const, costCents: 100000, consumptionPct: 70, byAreaOnly: false, areaM2: 290, consumption: 120, consumptionUnit: 'm³',
    baseCentsPerM2: 30000 / 290, consumptionCentsPerUnit: 70000 / 120,
  }
  const user = (over: Record<string, unknown> = {}) => ({
    key: 'A', role: 'tenancy' as const, tenancyId: 'A', label: 'Mieter A', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640,
    heatingConsumption: 4.2, waterConsumption: 20, heatingGroup: false, waterGroup: false, heatingCents: 37428, waterCents: 17276, heatingCo2Cents: 0, waterCo2Cents: 0, ...over,
  })
  const next = { ...user(), key: 'B', tenancyId: 'B', label: 'Mieter B', from: '2025-10-01', to: '2025-12-31', days: 92, degreeDayPermille: 360 }
  const unitOf = (a: ReturnType<typeof user>, others: ReturnType<typeof user>[] = [next]): SelfUnitView => ({ unitId: 'u', unitName: 'W', areaM2: 72.5, heatAreaM2: 72.5, readings: [], boundaries: [], users: [a, ...others] })

  it('Teilzeitraum: die Klammer nennt den Anteil, mit dem die Fläche in diesem Topf gewichtet ist', () => {
    const a = user()
    // Heizung nach Gradtagen: 72,5 m² · 2,95448 € · 640/1.000 = 137,09 €; Warmwasser immer nach Tagen:
    // 72,5 · 1,03448 · 273/365 = 56,10 € (gedruckt der Rest zum Betrag der Zeile, 56,09 €).
    expect(userLine(a, { pots: [heat, water], units: [unitOf(a)], changeSplit: 'degreeDays' }))
      .toBe(`Mieter A, 01.01.2025 bis 30.09.2025 (273 Tage, 640 ‰ der Gradtage): Heizung 4,2 MWh, ${fmtEuro(37428)} (Grundkosten ${fmtEuro(13709)} für 72,5 m², davon 640 von 1.000 ‰ der Gradtage, Verbrauchskosten ${fmtEuro(23719)}); ` +
        `Warmwasser 20 m³, ${fmtEuro(17276)} (Grundkosten ${fmtEuro(5609)} für 72,5 m², davon 273 von 365 Tagen, Verbrauchskosten ${fmtEuro(11667)})`)
    // Zeitanteilige Teilung: auch die Heizung nach Tagen.
    const t = user({ heatingCents: 39740 })
    expect(userLine(t, { pots: [heat], units: [unitOf(t)], changeSplit: 'time' })).toContain(`(Grundkosten ${fmtEuro(16021)} für 72,5 m², davon 273 von 365 Tagen, Verbrauchskosten ${fmtEuro(23719)})`)
  })
  it('Teilzeitraum: geht die Rechnung aus den Feldern des Stands nicht auf, steht keine Fläche da', () => {
    const a = user()
    // Die Wohnung nennt nur diesen Nutzer (der übrige Teil der Heizperiode fehlt): 72,5 m² mal Preis wären 214,20 €, nicht 137,09 €.
    expect(userLine(a, { pots: [heat], units: [unitOf(a, [])], changeSplit: 'degreeDays' })).toContain(`(Grundkosten ${fmtEuro(13709)}, Verbrauchskosten ${fmtEuro(23719)})`)
    // Ohne Angabe, wie beim Wechsel geteilt wird, ist der Anteil der Heizung nicht bekannt.
    expect(userLine(a, { pots: [heat], units: [unitOf(a)] })).toContain(`(Grundkosten ${fmtEuro(13709)}, Verbrauchskosten ${fmtEuro(23719)})`)
  })
  it('Menge mal Preis ergibt den gedruckten Betrag bis auf Rundung von höchstens einem Cent, mehr nicht', () => {
    // Verbundenes Warmwasser: Der Topfbetrag ist ungerundet 118,635 €, gedruckt wird der gerundete; der Preis kommt vom ungerundeten.
    const exact = 11863.5
    const pot = { ...heat, costCents: Math.round(exact), consumption: 17.35, consumptionUnit: 'kWh', baseCentsPerM2: (exact * 0.3) / 290, consumptionCentsPerUnit: (exact * 0.7) / 17.35 }
    const de = (text: string): number => Number(text.replace(/\./g, '').replace(',', '.'))
    const diffs = potLines(pot).slice(1).map((line) => {
      const m = /kosten [\d,]+ %: ([\d.,]+) € für ([\d.,]+) \S+, ([\d.,]+) € je /.exec(line)
      if (!m) throw new Error(`Zeile nicht lesbar: ${line}`)
      return Math.abs(Math.round(de(m[2] ?? '') * de(m[3] ?? '') * 100) - Math.round(de(m[1] ?? '') * 100))
    })
    for (const d of diffs) expect(d).toBeLessThanOrEqual(1)
    // Genau dieser Fall liegt einen Cent daneben: Die Grenze ist ein Cent, nicht null.
    expect(Math.max(...diffs)).toBe(1)
  })
  it('ein Stand ohne Fläche der Wohnung stürzt nicht ab, der Teil der Zeile entfällt', () => {
    const a = user()
    const bare = { unitId: 'u', unitName: 'W', readings: [], boundaries: [], users: [a, next] } as unknown as SelfUnitView
    expect(userLine(a, { pots: [heat, water], units: [bare], changeSplit: 'degreeDays' }))
      .toContain(`(Grundkosten ${fmtEuro(13709)}, Verbrauchskosten ${fmtEuro(23719)}); Warmwasser 20 m³, ${fmtEuro(17276)} (Grundkosten ${fmtEuro(5609)}, Verbrauchskosten ${fmtEuro(11667)})`)
  })
  it('keine negative Null bei Mengen, Preisen und Beträgen', () => {
    const a = user({ heatingConsumption: -5.5e-17, waterConsumption: -0, heatingCents: 0, waterCents: 0 })
    const line = userLine(a, { pots: [heat, water] })
    expect(line).toContain('Heizung 0 MWh,')
    expect(line).toContain('Warmwasser 0 m³,')
    const lines = potLines({ ...heat, costCents: -0, consumption: -0, baseCentsPerM2: -0, consumptionCentsPerUnit: -5.5e-17, estimatedConsumption: 0 }).join(' ')
    expect(lines).not.toMatch(/-0/)
  })
})
