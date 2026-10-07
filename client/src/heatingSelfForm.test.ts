import { describe, expect, it } from 'vitest'
import { CAPTURE_SELF_OPTIONS, captureHint, emptySelfSetup, forcedShare, itemsFromConflict, selfSetupBody, shareBounds, targetOptions, type SelfSetupForm } from './heatingSelfForm'
import type { HeatingPlant } from './types'

const plant = { id: 'hp', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' } as Pick<HeatingPlant, 'id' | 'energy' | 'hotWater' | 'capture' | 'areaBasisHeat'>
const filled = (over: Partial<SelfSetupForm> = {}): SelfSetupForm => ({ ...emptySelfSetup(plant, '2025-01'), share: '70', waterShare: '70', insulation: 'notApplies', ...over })

describe('Einrichtung Schritt 7 (Heizung PR 10)', () => {
  it('Vorgaben: Warmwasser über die Anlage, Wärmezähler, Wohnfläche, Wärmezähler am Speicher', () => {
    const f = emptySelfSetup(plant, '2025-01')
    expect([f.hotWater, f.capture, f.areaBasisHeat, f.dhwHeatMeter, f.totalHeatMeter, f.share, f.waterShare]).toEqual(['combined', 'heatMeter', 'area', true, false, '', ''])
  })
  it('Anteil: Grenzen aus dem Register, mit Satz', () => {
    const { min, max } = shareBounds()
    expect([min, max]).toEqual([50, 70])
    expect(selfSetupBody(filled({ share: '' }), 'gas')).toEqual({ error: expect.stringMatching(/zwischen 50 und 70 %/) })
    expect(selfSetupBody(filled({ share: '45' }), 'gas')).toEqual({ error: expect.stringMatching(/mindestens 50 %/) })
    expect(selfSetupBody(filled({ share: '80' }), 'gas')).toEqual({ error: expect.stringMatching(/§ 10 HeizkostenV.*vereinbart/) })
    // Heizung PR 14: mit Vereinbarung über 70 %, nie über 100 %.
    const vereinbart = selfSetupBody(filled({ share: '80', waterShare: '80', above70Agreed: true }), 'gas')
    expect('body' in vereinbart && [vereinbart.body.heatConsumptionPct, vereinbart.body.above70Agreed]).toEqual([80, true])
    expect(selfSetupBody(filled({ share: '101', waterShare: '70', above70Agreed: true }), 'gas')).toEqual({ error: expect.stringMatching(/höchstens 100 %/) })
  })
  it('§ 7 Abs. 1 Satz 2: bei Öl oder Gas und Wärmeschutz vor 1994 sind es 70 %, sonst gilt die Wahl', () => {
    expect(forcedShare('gas', 'applies')).toBe(70)
    expect(forcedShare('lpg', 'applies')).toBe(70)
    expect(forcedShare('districtHeating', 'applies')).toBeNull()
    expect(forcedShare('gas', 'unknown')).toBeNull()
    // Vorgeschrieben: das Feld zeigt den Pflichtanteil und sendet ihn, auch wenn nichts eingetippt ist.
    const pflicht = selfSetupBody(filled({ share: '', insulation: 'applies' }), 'gas')
    expect('body' in pflicht && pflicht.body.heatConsumptionPct).toBe(70)
  })
  it('§ 8 Abs. 1: der Anteil beim Warmwasser ist eine eigene Angabe (Abweichung 14)', () => {
    expect(selfSetupBody(filled({ waterShare: '' }), 'gas')).toEqual({ error: expect.stringMatching(/Warmwasser.*§ 8 Abs\. 1/) })
    const anders = selfSetupBody(filled({ waterShare: '50' }), 'gas')
    expect('body' in anders && [anders.body.heatConsumptionPct, anders.body.waterConsumptionPct]).toEqual([70, 50])
    const ohne = selfSetupBody(filled({ hotWater: 'none', waterShare: '' }), 'gas')
    expect('body' in ohne && ohne.body.waterConsumptionPct).toBeNull()
  })
  it('Warmwasser über die Anlage auch bei Heizöl (Heizung PR 11: Heizwert laut Rechnung, § 9 Abs. 3 HeizkostenV)', () => {
    expect('body' in selfSetupBody(filled(), 'oil')).toBe(true)
    expect(emptySelfSetup({ ...plant, energy: 'oil', hotWater: 'combined' }, '2025-01').hotWater).toBe('combined')
    expect('body' in selfSetupBody(filled({ hotWater: 'none' }), 'oil')).toBe(true)
  })
  it('Erfassung mit Heizkostenverteilern oder Werten eines Ablesedienstes (Heizung PR 12): wählbar, ohne Zusatz', () => {
    expect('body' in selfSetupBody(filled({ capture: 'hca' }), 'gas')).toBe(true)
    expect('body' in selfSetupBody(filled({ capture: 'serviceValues' }), 'gas')).toBe(true)
    expect(CAPTURE_SELF_OPTIONS.every((o) => !o.later && !/späteren Version/.test(o.label))).toBe(true)
    expect(captureHint('hca')).toMatch(/Seite Zähler.*Skala und Bewertungsfaktor.*§ 5 Abs\. 7/)
    expect(captureHint('serviceValues')).toMatch(/Seite Heizkosten/)
  })
  it('Ziel passt zur Warmwasserbereitung; Brennstoff bei verbundener Bereitung nur „beides“', () => {
    expect(targetOptions('combined', 'fuel').map((o) => o.value)).toEqual(['both'])
    expect(targetOptions('combined', 'metering').map((o) => o.value)).toEqual(['both', 'heating', 'water'])
    expect(targetOptions('separate', 'operating').map((o) => o.value)).toEqual(['heating', 'water'])
    expect(targetOptions('none', 'fuel').map((o) => o.value)).toEqual(['heating'])
  })
  it('Positionen aus der 409-Antwort: Teil vorbelegt, Ziel nach der Warmwasserbereitung', () => {
    const items = itemsFromConflict({ error: 'x', items: [{ id: 'c1', period: '2025-01', description: 'Gas', amountCents: 600000, key: 'area', heatingPart: 'fuel' }, { id: 'c2', period: '2025-01', description: 'Wartung', amountCents: 24000, key: 'area', heatingPart: null }] })
    expect(items).toEqual([
      { id: 'c1', description: 'Gas', amountCents: 600000, heatingPart: 'fuel', heatingTarget: '' },
      { id: 'c2', description: 'Wartung', amountCents: 24000, heatingPart: '', heatingTarget: '' },
    ])
    expect(itemsFromConflict({ error: 'x' })).toBeNull()
    const form = filled({ items: items ?? [] })
    expect(selfSetupBody(form, 'gas')).toEqual({ error: expect.stringMatching(/„Gas“.*Ziel/) })
    const [gas, wartung] = form.items
    if (!gas || !wartung) throw new Error('zwei Positionen erwartet')
    const done = selfSetupBody({ ...form, items: [{ ...gas, heatingTarget: 'both' }, { ...wartung, heatingPart: 'operating', heatingTarget: 'both' }] }, 'gas')
    expect(done).toEqual({ body: {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', above70Agreed: false, hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area',
      dhwHeatMeter: true, totalHeatMeter: false,
      items: [{ id: 'c1', heatingPart: 'fuel', heatingTarget: 'both' }, { id: 'c2', heatingPart: 'operating', heatingTarget: 'both' }],
    } })
  })
})

describe('Durchsicht von #239', () => {
  it('M1: bei Fernwärme keine Frage zum Wärmeschutz; gesendet wird „trifft nicht zu“', () => {
    const fern = { ...plant, energy: 'districtHeating' } as typeof plant
    const r = selfSetupBody({ ...emptySelfSetup(fern, '2025-01'), share: '70', waterShare: '70', insulation: '' }, 'districtHeating')
    expect('body' in r && r.body.insulationRule).toBe('notApplies')
    expect(selfSetupBody(filled({ insulation: '' }), 'gas')).toEqual({ error: 'Bitte beantworten Sie die Frage zum Wärmeschutz; „Weiß ich nicht“ ist eine Antwort.' })
  })
  it('M9: Anteil mit höchstens zwei Nachkommastellen', () => {
    expect('error' in selfSetupBody(filled({ share: '65,125' }), 'gas')).toBe(true)
    const r = selfSetupBody(filled({ share: '65,25', waterShare: '60' }), 'gas')
    expect('body' in r && r.body.heatConsumptionPct).toBe(65.25)
  })
})
