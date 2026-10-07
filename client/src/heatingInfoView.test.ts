import { describe, expect, it } from 'vitest'
import { barWidths, comparisonOf, infoLines } from './heatingInfoView'
import { fmtEuro } from './api'
import type { HeatingInfoStatement } from './types'

const SOURCE = 'Vergleichswerte des Ablesedienstes Beispiel 2025'
const info: HeatingInfoStatement = {
  scope: 'full', carriers: [{ energy: 'gas', percent: 100 }], district: null, taxesText: 'Energiesteuer 312,00 €', meteringCents: 18000,
  reference: { kwhPerM2: 150, source: SOURCE }, referenceComparable: true,
  contacts: [{ name: 'Deutsche Energie-Agentur (dena)', url: 'https://www.dena.de', what: 'Energieagentur' }], contactsChecked: '2026-10-07',
  dispute: { kind: 'none' }, climate: { factor: 1.08, factorPrev: 1.15, source: 'DWD 79100' }, units: { heating: 'kWh', water: 'm³' },
  users: [
    { tenancyId: 'A', label: 'Mieter A', days: 365, prevDays: 366, heating: { now: 12000, estimated: false, referenceKwh: 9000, prev: 1000, nowAdjusted: 12960, prevAdjusted: 1150 }, water: { now: 30, prev: 25 }, firstPeriod: false, prevUnknown: false, ghgKg: null },
    { tenancyId: 'C2', label: 'Mieter C2', days: 92, prevDays: null, heating: { now: 4800, estimated: false, referenceKwh: 2268.49, prev: null, nowAdjusted: null, prevAdjusted: null }, water: { now: 12, prev: null }, firstPeriod: true, prevUnknown: false, ghgKg: null },
  ],
  missing: [], uncertain: ['5'], comparisons: true, mixedGeneration: false, heatExempt: false,
}

describe('Druckblock § 6a (Heizung PR 14)', () => {
  it('Nr. 1 bis 3 als Zeilen', () => {
    expect(infoLines(info)).toEqual([
      'Eingesetzte Energieträger: Erdgas 100 %',
      'Steuern, Abgaben und Zölle laut Rechnung: Energiesteuer 312,00 €',
      `Entgelte für Erfassungsgeräte, Eichung, Ablesung und Abrechnung: ${fmtEuro(18000)}`,
      'Informationen zum Energiesparen, zu Vergleichsprofilen und zu energiebetriebenen Geräten (Stand 07.10.2026):',
      'Deutsche Energie-Agentur (dena), https://www.dena.de – Energieagentur',
    ])
  })
  it('weiterer Erzeuger, Kesseltausch, Fernwärme mit jährlicher Menge, ausgenommene Wärme, Streitbeilegung', () => {
    expect(infoLines({ ...info, mixedGeneration: true, carriers: [{ energy: 'gas', percent: null }] })[0]).toBe('Eingesetzte Energieträger: Erdgas und ein weiterer Wärmeerzeuger; die Anteile liegen Mietfuchs nicht vor')
    expect(infoLines({ ...info, carriers: [{ energy: 'oil', percent: 25 }, { energy: 'gas', percent: 75 }] })[0]).toBe('Eingesetzte Energieträger: Heizöl 25 %, Erdgas 75 %')
    const fern = infoLines({ ...info, carriers: [{ energy: 'districtHeating', percent: 100 }], district: { ghg: 180, pef: 0.7, annualKg: 7200 } })
    expect(fern[1]).toBe('Fernwärme laut Versorger: Treibhausgasemissionen 180 g CO₂-Äquivalent je kWh, in dieser Heizperiode zusammen 7.200 kg CO₂-Äquivalent; Primärenergiefaktor des Netzes 0,7')
    expect(infoLines({ ...info, heatExempt: true })[0]).toMatch(/nach § 11 HeizkostenV.*Warmwasser/)
    expect(infoLines({ ...info, dispute: { kind: 'text', text: 'Wir nehmen nicht teil.' } }).at(-1)).toBe('Streitbeilegung: Wir nehmen nicht teil.')
    expect(infoLines({ ...info, scope: 'minimal' })).toEqual(infoLines(info).slice(3))
  })
  it('Vergleich nur des eigenen Mieters: Durchschnittsnutzer mit Quelle, witterungsbereinigt mit Faktoren und Quelle, Balken', () => {
    const c = comparisonOf(info, 'A') ?? expect.unreachable()
    expect(c.lines).toEqual([
      `Ihr Wärmeverbrauch: 12.000 kWh; Durchschnittsnutzer: 9.000 kWh (150 kWh je m² Wohnfläche, Quelle: ${SOURCE}; auf Ihre Wohnfläche und Ihre 365 Tage umgerechnet)`,
      'Heizung, witterungsbereinigt mit den Klimafaktoren 1,08 und 1,15 (DWD 79100): dieser Zeitraum 12.960 kWh, vorhergehender Zeitraum 1.150 kWh (365 Tage, vorhergehender Zeitraum 366 Tage)',
      'Warmwasser (nicht witterungsbereinigt): dieser Zeitraum 30 m³, vorhergehender Zeitraum 25 m³',
    ])
    expect(c.bars.map((b) => b.label)).toEqual(['Heizung, witterungsbereinigt', 'Warmwasser'])
    const [jetzt, vorher] = barWidths([12960, 1150])
    expect(jetzt).toBe(100)
    expect(vorher).toBeCloseTo((1150 / 12960) * 100, 10)
    // C2 im ersten Jahr: kein Vorjahr, keine Balken, kein Wert eines anderen Mieters.
    const c2 = comparisonOf(info, 'C2') ?? expect.unreachable()
    expect(c2.bars).toEqual([])
    expect(c2.lines.join(' ')).not.toMatch(/12\.000|1\.150/)
    expect(c2.lines.at(-1)).toMatch(/noch nicht hier wohnten/)
    expect(comparisonOf(info, 'X')).toBeNull()
  })
})
