// Pflichtangaben nach § 6a HeizkostenV und die Angaben je Heizperiode als reine Rechnung (Heizung PR 14,
// Entwurf 8.8, 15.1 Nr. 14). Grundlage ist Beispiel A ohne Warmwasser: A 12.000 kWh auf 60 m², B 16.000 kWh
// auf 80 m², C1 bis 30.09. und C2 ab 01.10. auf 60 m²; 2024 als Vorperiode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heatingInfoOf, heatingRulesOf, planByConsumption, type InfoInput, type RuleRow } from '../src/heatingInfo.ts'
import { planSelf, type SelfInput, type SelfPlan } from '../src/heating.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { INFO_CONTACTS, INFO_CONTACTS_CHECKED } from '../../shared/heatingInfo.ts'

const table = onlyVersion(hkvDegreeDays).value
const offRule = onlyVersion(practiceReadingOffWarning).value
const near = (a: number | null | undefined, b: number, what: string) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${what}: ${a} statt ${b}`)

const TENANCIES = [
  { id: 'A', unitId: 'a', tenantName: 'Mieter A', start: '2020-01-01', end: null },
  { id: 'B', unitId: 'b', tenantName: 'Mieter B', start: '2020-01-01', end: null },
  { id: 'C1', unitId: 'c', tenantName: 'Mieter C1', start: '2020-01-01', end: '2025-09-30' },
  { id: 'C2', unitId: 'c', tenantName: 'Mieter C2', start: '2025-10-01', end: null },
]
const base = (h: { from: string; to: string }, readings: SelfInput['readings']): SelfInput => ({
  h, neighbors: { before: '2022-12-31', after: '2026-12-31' }, changeSplit: 'degreeDays', hotWater: 'none', areaBasisHeat: 'area',
  units: [
    { id: 'a', name: 'A', areaM2: 60, heatedAreaM2: null, role: 'rented' },
    { id: 'b', name: 'B', areaM2: 80, heatedAreaM2: null, role: 'rented' },
    { id: 'c', name: 'C', areaM2: 60, heatedAreaM2: null, role: 'rented' },
  ],
  tenancies: TENANCIES,
  meters: [{ id: 'wa', name: 'Wärme A', unitId: 'a', type: 'waerme' }, { id: 'wb', name: 'Wärme B', unitId: 'b', type: 'waerme' }, { id: 'wc', name: 'Wärme C', unitId: 'c', type: 'waerme' }],
  readings, gaps: [], table, offRule: () => offRule,
})
const R = (meterId: string, date: string, value: number) => ({ meterId, date, value })
const READINGS = [
  R('wa', '2023-12-31', 0), R('wa', '2024-12-31', 1000), R('wa', '2025-12-31', 13000),
  R('wb', '2023-12-31', 0), R('wb', '2024-12-31', 0), R('wb', '2025-12-31', 16000),
  R('wc', '2023-12-31', 0), R('wc', '2024-12-31', 500), R('wc', '2025-09-30', 7700), R('wc', '2025-12-31', 12500),
]
const plan: SelfPlan = planSelf(base({ from: '2025-01-01', to: '2025-12-31' }, READINGS))
const prev: SelfPlan = planSelf(base({ from: '2024-01-01', to: '2024-12-31' }, READINGS))
const SOURCE = 'Vergleichswerte des Ablesedienstes Beispiel 2025'
const row = {
  infoTaxesText: 'Energiesteuer 312,00 €, Umsatzsteuer 19 %', infoDistrictGhg: null, infoDistrictPef: null,
  climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'Deutscher Wetterdienst, Klimafaktoren 79100',
  infoReferenceKwhPerM2: 150, infoReferenceSource: SOURCE,
}
const input = (over: Partial<InfoInput> = {}): InfoInput => ({
  byConsumption: true, carriers: [{ energy: 'gas', kwh: 60000 }], mixedGeneration: false, district: null, row, prevClimateFactor: null, consumerContract: 'none',
  meteringCents: 18000, contacts: INFO_CONTACTS, contactsChecked: INFO_CONTACTS_CHECKED, plan, prev, prevPeriod: { from: '2024-01-01', to: '2024-12-31' },
  tenancies: TENANCIES, units: { heating: 'kWh', water: 'm³' }, periodDays: 365, pots: ['heating', 'water'], ...over,
})
const user = (info: ReturnType<typeof heatingInfoOf>, id: string) => info.users.find((u) => u.tenancyId === id) ?? assert.fail(`kein ${id}`)

test('vollständig: nichts sicher fehlend; Vergleich je Mieter mit dem Vergleichswert und Witterungsbereinigung', () => {
  const info = heatingInfoOf(input())
  assert.deepEqual([info.scope, info.missing, info.carriers], ['full', [], [{ energy: 'gas', percent: 100 }]])
  assert.deepEqual(info.dispute, { kind: 'none' })
  assert.deepEqual([info.reference, info.referenceComparable], [{ kwhPerM2: 150, source: SOURCE }, true])
  const a = user(info, 'A')
  near(a.heating?.now, 12000, 'A jetzt')
  // 150 kWh je m² · 60 m² Wohnfläche · 365 / 365 Tage
  near(a.heating?.referenceKwh, 9000, 'A Durchschnittsnutzer')
  near(a.heating?.prev, 1000, 'A Vorjahr')
  near(a.heating?.nowAdjusted, 12960, 'A bereinigt')
  near(a.heating?.prevAdjusted, 1150, 'A Vorjahr bereinigt')
  assert.deepEqual([a.firstPeriod, a.prevUnknown, a.days, a.prevDays], [false, false, 365, 366])
})

test('Review Focus 1: C2 zieht in der Heizperiode ein – nur für ihn ein erstes Jahr („bis zu“), die anderen vergleichen; keine Daten des Vormieters', () => {
  const info = heatingInfoOf(input())
  assert.deepEqual(info.users.filter((u) => u.firstPeriod).map((u) => u.tenancyId), ['C2'])
  assert.deepEqual([info.missing.includes('5'), info.uncertain.includes('5')], [false, true])
  const c2 = user(info, 'C2')
  // Der Vergleichswert gilt für seine 92 Tage (01.10. bis 31.12.2025); ohne Vorjahr kein Wert, auch nicht der von C1.
  near(c2.heating?.referenceKwh, (150 * 60 * 92) / 365, 'C2 Durchschnittsnutzer')
  assert.deepEqual([c2.heating?.prev, c2.heating?.prevAdjusted, c2.prevDays], [null, null, null])
  // C1 bekommt seinen eigenen Vergleich mit 2024 (500 kWh), nicht den der Wohnung.
  near(user(info, 'C1').heating?.prev, 500, 'C1 Vorjahr')
})

test('Wohnte der Mieter schon im Vorjahr, aber Mietfuchs kennt seinen Verbrauch nicht: Nr. 5 fehlt sicher, kein „erstes Jahr“', () => {
  const info = heatingInfoOf(input({ prev: null }))
  assert.ok(info.missing.includes('5'))
  assert.deepEqual([user(info, 'A').firstPeriod, user(info, 'A').prevUnknown], [false, true])
  assert.deepEqual([user(info, 'C2').firstPeriod, user(info, 'C2').prevUnknown], [true, false])
})

test('Rechtsbefund (BR-Drs. 643/21, S. 19, 21): ohne Vergleichswert mit Quelle fehlt Nr. 4, kein Hausdurchschnitt', () => {
  const ohne = heatingInfoOf(input({ row: { ...row, infoReferenceKwhPerM2: null, infoReferenceSource: null } }))
  assert.deepEqual([ohne.missing, ohne.reference], [['4'], null])
  assert.equal(user(ohne, 'A').heating?.referenceKwh, null)
  const ohneQuelle = heatingInfoOf(input({ row: { ...row, infoReferenceSource: '  ' } }))
  assert.deepEqual([ohneQuelle.missing, ohneQuelle.reference], [['4'], null])
})

test('Nr. 4 bei Heizkostenverteilern: Einheiten lassen sich nicht mit kWh vergleichen', () => {
  const info = heatingInfoOf(input({ units: { heating: 'Einheiten', water: 'm³' } }))
  assert.deepEqual([info.missing, info.referenceComparable], [['4'], false])
  assert.equal(user(info, 'A').heating?.referenceKwh, null)
  // Der witterungsbereinigte Vergleich geht in Einheiten (gleiche Erfassung in beiden Zeiträumen).
  near(user(info, 'A').heating?.nowAdjusted, 12960, 'A bereinigt in Einheiten')
})

test('Review Focus 2: Vorjahresfaktor fehlt → Nr. 5 fehlt, kein halber Vergleich; der Faktor der vorigen Zeile gilt mit ihrer Quelle', () => {
  const ohne = heatingInfoOf(input({ row: { ...row, climateFactorPrev: null } }))
  assert.ok(ohne.missing.includes('5'))
  assert.deepEqual([user(ohne, 'A').heating?.prevAdjusted, user(ohne, 'A').heating?.nowAdjusted], [null, null])
  const vorige = heatingInfoOf(input({ row: { ...row, climateFactorPrev: null }, prevClimateFactor: { factor: 1.15, source: 'DWD 2024' } }))
  assert.equal(vorige.missing.includes('5'), false)
  near(user(vorige, 'A').heating?.prevAdjusted, 1150, 'A Vorjahr bereinigt')
})

test('Steuern fehlen (1 b), Fernwärme ohne Emissionen (1 a), Verbrauchervertrag unbeantwortet (3, vielleicht)', () => {
  const fern = (over: Partial<InfoInput>) => input({ carriers: [{ energy: 'districtHeating', kwh: 40000 }], district: { required: 'yes', deliveredKwh: 40000 }, ...over })
  const info = heatingInfoOf(fern({ row: { ...row, infoTaxesText: '  ' }, consumerContract: null }))
  assert.deepEqual([info.missing, info.uncertain], [['1a', '1b'], ['3', '5']])
  const frueh = heatingInfoOf(fern({ district: { required: 'maybe', deliveredKwh: 40000 } }))
  assert.deepEqual([frueh.missing, frueh.uncertain], [[], ['1a', '5']])
  const mit = heatingInfoOf(fern({ row: { ...row, infoDistrictGhg: 180, infoDistrictPef: 0.7 }, consumerContract: 'Wir nehmen an Streitbeilegungsverfahren nicht teil.' }))
  assert.deepEqual([mit.missing, mit.district, mit.dispute], [[], { ghg: 180, pef: 0.7, annualKg: 7200 }, { kind: 'text', text: 'Wir nehmen an Streitbeilegungsverfahren nicht teil.' }])
})

test('Fernwärme: jährliche Menge mal Anteil an den Kosten je Mieter; ohne gelieferte kWh fehlt Nr. 1 a', () => {
  const info = heatingInfoOf(input({
    carriers: [{ energy: 'districtHeating', kwh: 40000 }], district: { required: 'yes', deliveredKwh: 40000 },
    row: { ...row, infoDistrictGhg: 180, infoDistrictPef: 0.7 }, costShares: new Map([['A', 0.25]]),
  }))
  assert.equal(user(info, 'A').ghgKg, 1800)
  assert.equal(user(info, 'B').ghgKg, null)
  const ohneKwh = heatingInfoOf(input({ carriers: [{ energy: 'districtHeating', kwh: null }], district: { required: 'yes', deliveredKwh: null }, row: { ...row, infoDistrictGhg: 180, infoDistrictPef: 0.7 } }))
  assert.deepEqual([ohneKwh.missing, ohneKwh.district?.annualKg], [['1a'], null])
})

test('Nr. 1 a: weiterer Erzeuger unbekannt; Kesseltausch Öl → Gas nach kWh, ohne kWh unbekannt', () => {
  assert.deepEqual(heatingInfoOf(input({ mixedGeneration: true })).missing, ['1a'])
  const tausch = heatingInfoOf(input({ carriers: [{ energy: 'oil', kwh: 15000 }, { energy: 'gas', kwh: 45000 }] }))
  assert.deepEqual([tausch.missing, tausch.carriers], [[], [{ energy: 'oil', percent: 25 }, { energy: 'gas', percent: 75 }]])
  assert.deepEqual(heatingInfoOf(input({ carriers: [{ energy: 'oil', kwh: null }, { energy: 'gas', kwh: 45000 }] })).missing, ['1a'])
})

test('Abs. 5: ohne Verteilung nach Verbrauch nur Nr. 2 und 3', () => {
  const info = heatingInfoOf(input({ byConsumption: false, plan: null, prev: null, row: { ...row, infoTaxesText: null, climateFactor: null } }))
  assert.deepEqual([info.scope, info.missing, info.users], ['minimal', [], []])
  assert.ok(info.contacts.length >= 3)
  assert.equal(planByConsumption(null), false)
  assert.equal(planByConsumption(plan), true)
})

test('Freie Schlüssel nach Zählern (ohne Plan der eigenen Abrechnung): volle Pflicht, Nr. 4 und 5 fehlen', () => {
  const info = heatingInfoOf(input({ plan: null, prev: null }))
  assert.deepEqual([info.scope, info.missing, info.comparisons, info.users], ['full', ['4', '5'], false, []])
})

test('§ 11 nur für die Wärme: kein Vergleich der Heizung, kein Klimafaktor nötig; Nr. 4 fehlt (nur Wärme in kWh)', () => {
  const info = heatingInfoOf(input({ pots: ['water'], row: { ...row, climateFactor: null, climateFactorPrev: null, climateFactorSource: null } }))
  assert.equal(info.heatExempt, true)
  assert.ok(info.users.every((u) => u.heating === null))
  assert.equal(info.missing.includes('5'), false)
})

// ---------- Angaben je Heizperiode ----------

const PLANTS = [{ id: 'alt', replacesPlantId: null }, { id: 'neu', replacesPlantId: 'alt' }, { id: 'fremd', replacesPlantId: null }]
test('Angaben je Heizperiode: geerbt nach vorn über die Linie, nie zurück; die eigene Anlage geht in derselben Heizperiode vor', () => {
  const rows: RuleRow[] = [
    { plantId: 'alt', period: '2024-01', exemption: 'lowDemand' },
    { plantId: 'alt', period: '2025-01', monthlyInfoElsewhere: true, consumerContract: 'none' },
    { plantId: 'neu', period: '2025-01', exemption: 'none' },
    { plantId: 'fremd', period: '2023-01', agreedOtherwise: 'area' },
  ]
  // 2023: noch nichts gesetzt; die Vereinbarung einer anderen Linie gilt nicht.
  assert.deepEqual(heatingRulesOf(rows, PLANTS, 'alt', '2023-01'), {
    exemption: 'none', exemptionScope: null, exemptionBillingAgreed: false, agreedOtherwise: 'none', monthlyInfoElsewhere: false, consumerContract: null,
    fromPeriod: { exemption: null, agreedOtherwise: null, monthlyInfoElsewhere: null, consumerContract: null },
  })
  // 2024: Ausnahme, ohne Antwort zum Umfang nur die Wärme.
  assert.deepEqual([heatingRulesOf(rows, PLANTS, 'alt', '2024-01').exemption, heatingRulesOf(rows, PLANTS, 'alt', '2024-01').exemptionScope], ['lowDemand', 'heat'])
  // 2025 an der alten Anlage: eigene Zeile ohne Ausnahme-Antwort, die neue Anlage sagt „keine“ – die eigene geht vor
  // nur, wenn sie etwas sagt; hier sagt nur die neue etwas, also gilt „keine“.
  assert.equal(heatingRulesOf(rows, PLANTS, 'alt', '2025-01').exemption, 'none')
  // 2026 an der neuen Anlage: geerbt aus 2025.
  const neu = heatingRulesOf(rows, PLANTS, 'neu', '2026-01')
  assert.deepEqual([neu.exemption, neu.monthlyInfoElsewhere, neu.consumerContract, neu.fromPeriod.monthlyInfoElsewhere], ['none', true, 'none', '2025-01'])
  // Eine spätere Antwort ändert keine frühere Heizperiode.
  assert.equal(heatingRulesOf([...rows, { plantId: 'alt', period: '2027-01', exemption: 'authority' }], PLANTS, 'alt', '2024-01').exemption, 'lowDemand')
  // Die eigene Anlage vor der Schwester derselben Linie, wenn beide etwas sagen.
  assert.equal(heatingRulesOf([...rows, { plantId: 'alt', period: '2025-01', exemption: 'pre1981' }], PLANTS, 'alt', '2025-01').exemption, 'pre1981')
  assert.equal(heatingRulesOf([...rows, { plantId: 'alt', period: '2025-01', exemption: 'pre1981' }], PLANTS, 'neu', '2025-01').exemption, 'none')
})
