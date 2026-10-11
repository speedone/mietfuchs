// Wärmelieferung in der Berechnung (Heizung PR 16, #213): Contracting rechnet wie Fernwärme über eine Naht im
// Schnappschuss, mit den Ausnahmen, an denen der Brennstoff des Lieferanten zählt (CO₂-Pflicht, Energieträger
// nach § 6a, Formeln bei der Wärmepumpe), und der Hinweis zu § 556c BGB.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { co2Required } from '../src/co2.ts'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { consumptionSharesOf } from '../src/heating.ts'
import { snapshotFor, snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { asBilledPlant, billingEnergy } from '../../shared/heatDelivery.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod, calendarYearPeriod } from '../../shared/period.ts'
import type { HeatingPlant } from '../../shared/types.ts'
import { selfDelivery, selfReading, selfSnapshot } from '../testing/selfHeating.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const messdienst = (amountCents = 100000): SnapshotCostItem => ({
  id: 'hz', period: P, category: HEATING_CATEGORY, description: 'Wärmelieferung laut Messdienst', amountCents, key: 'amounts', tenancyAmounts: { ta: 60000, tb: 40000 }, heatingPlantId: 'hp',
})
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Kessel', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, ...over,
})
const zwei = { units: [unit('a'), unit('b')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')] }
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s })
// Die Berechnung bekommt die Anlage, wie `snapshotFor` sie liefert (`asBilledPlant`).
const snap = (p: SnapshotHeatingPlant): Snapshot => ({ ...snapshotOf(source({ ...zwei, costItems: [messdienst()] }), 2025), heatingPlants: [asBilledPlant(p)], co2Statements: [] })
const settle = (p: SnapshotHeatingPlant): ComputedSettlement => computeSettlement(snap(p))
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)

test('Naht: snapshotFor gibt Contracting die Energie der Fernwärme und behält den Brennstoff', () => {
  const mit = snapshotFor(co2Source(2025, {}, [], { contracting: true }), 'objekt-1', calendarYearPeriod(2025)).heatingPlants?.[0] ?? assert.fail('keine Anlage')
  assert.deepEqual([mit.energy, mit.fuelEnergy, mit.contracting], ['districtHeating', 'gas', true])
  const ohne = snapshotFor(co2Source(2025, {}), 'objekt-1', calendarYearPeriod(2025)).heatingPlants?.[0] ?? assert.fail('keine Anlage')
  assert.deepEqual([ohne.energy, ohne.fuelEnergy], ['gas', undefined])
  // Idempotent: Die Anlage der Berechnung bleibt Wärmelieferung.
  assert.equal(billingEnergy(mit), 'districtHeating')
  assert.deepEqual([asBilledPlant(mit).energy, asBilledPlant(mit).fuelEnergy], ['districtHeating', 'gas'])
})

test('Review Focus 1: § 7 Abs. 3 HeizkostenV, Contracting mit Gas rechnet ohne Pflichtanteil', () => {
  const row = { period: '2025-01', heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'applies' as const }
  const seventy = () => 70
  const shares = consumptionSharesOf([row], '2025-01', billingEnergy({ energy: 'gas', contracting: true }), seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([shares.heating, shares.forced], [60, false])
  const eigen = consumptionSharesOf([row], '2025-01', billingEnergy({ energy: 'gas', contracting: false }), seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([eigen.heating, eigen.forced], [70, true])
})

test('CO₂-Pflicht nach dem Brennstoff des Lieferanten (§ 2 Abs. 1 Satz 2 CO2KostAufG)', () => {
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'pellets' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'wood' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'electric' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'heatPump' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'gas' }), true)
  // Prüfung R-K4: „Sonstiges“ bleibt CO₂-pflichtig, als Auslegung.
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'other' }), true)
  assert.equal(co2Required({ energy: 'districtHeating' }), true)
  assert.equal(co2Required({ energy: 'oil' }), true)
  assert.equal(co2Required({ energy: 'pellets' }), false)
})

test('Abrechnung: Pellet-Contracting ohne CO₂-Hinweis; Gas- und „Sonstiges“-Contracting mit dem Satz zum Wärmelieferanten', () => {
  assert.ok(!codes(settle(plant({ energy: 'pellets', contracting: true }))).some((c) => c.startsWith('co2.')), 'Pellets: nichts aufzuteilen')
  const gas = settle(plant({ energy: 'gas', contracting: true })).notices.find((n) => n.code === 'co2.missing') ?? assert.fail('kein co2.missing')
  assert.match(gas.text, /Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie/)
  // Prüfung C-M4: kein „Mietfuchs weiß nicht, womit diese Anlage heizt“; der Weg über die Lieferungen ist offen.
  const sonst = settle(plant({ energy: 'other', contracting: true }))
  assert.ok(!codes(sonst).includes('co2.fuel-unknown'), codes(sonst).join(', '))
  assert.match(sonst.notices.find((n) => n.code === 'co2.missing')?.text ?? '', /Weist Ihr Wärmelieferant CO₂-Kosten aus/)
})

test('Ausweis: die Heizperiode trägt Contracting und den Brennstoff des Lieferanten', () => {
  const h = settle(plant({ energy: 'gas', contracting: true })).heating?.[0] ?? assert.fail('keine Heizperiode')
  assert.deepEqual([h.energy, h.contracting, h.fuelEnergy], ['districtHeating', true, 'gas'])
  const ohne = settle(plant()).heating?.[0] ?? assert.fail('keine Heizperiode')
  assert.deepEqual([ohne.energy, 'contracting' in ohne, 'fuelEnergy' in ohne], ['gas', false, false])
})

// Prüfung C-M2: Die Informationen nach § 6a nennen den eingesetzten Energieträger, und Treibhausgasemissionen und
// Primärenergiefaktor eines Wärmenetzes verlangt § 6a Abs. 3 Satz 1 Nr. 1 Buchst. a nur „bei Nutzern, die mit
// Fernwärme aus Fernwärmesystemen versorgt werden“. Bei Contracting ist das der Kessel im Haus, kein Netz.
test('§ 6a bei Contracting: Energieträger ist der Brennstoff des Kessels, keine Angaben des Wärmenetzes verlangt', () => {
  const angaben = { infoTaxesText: 'Energiesteuer 312,00 €', climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'DWD', infoReferenceKwhPerM2: 150, infoReferenceSource: 'Vergleichswerte', consumerContract: 'none' as const }
  const mit = (plant: Partial<HeatingPlant>) => {
    const base = selfSnapshot({ plant, row: angaben })
    return computeSettlement({ ...base, readings: [...base.readings, ...base.meters.filter((m) => m.unitId !== null).map((m) => selfReading(m.id, '2023-12-31', 0))] })
  }
  const info = (r: ComputedSettlement) => r.heating?.find((h) => h.info)?.info ?? assert.fail(`kein Ausweis nach § 6a: ${codes(r).join(', ')}`)
  const c = info(mit({ contracting: true }))
  assert.deepEqual(c.carriers.map((x) => x.energy), ['gas'])
  assert.equal(c.district, null)
  assert.ok(!c.missing.includes('1a') && !c.uncertain.includes('1a'), `1a: ${JSON.stringify([c.missing, c.uncertain])}`)
  // Gegenprobe: Fernwärme ohne Angaben des Netzes nennt Nr. 1 a.
  const f = info(mit({ energy: 'districtHeating' }))
  assert.ok(f.missing.includes('1a') || f.uncertain.includes('1a'))
})

// Warmwasseranteil nach einer Formel (§ 9 Abs. 2 Satz 6 HeizkostenV): Contracting rechnet als Wärmelieferung
// (÷ 1,15, Nr. 2) und nicht nach dem Brennstoff des Kessels (× 1,11 bei Erdgas nach Brennwert, Nr. 1).
const formel = { dhwMethod: 'volumeFormula' as const, dhwVolumeM3: 120, dhwTempC: 60, dhwUnmeasurable: true }
test('Formel bei Gas-Contracting: ÷ 1,15 wie Wärmelieferung, nicht × 1,11', () => {
  const s = computeSettlement(selfSnapshot({ plant: { contracting: true, heatGeneration: 'single' }, row: formel, deliveries: [selfDelivery({ gasBasis: 'hs' })] }))
  const dhw = s.heating?.find((h) => h.plantId === 'hp')?.self?.dhw ?? assert.fail(`kein Rechenweg: ${codes(s).join(', ')}`)
  assert.deepEqual([dhw.factor?.kind, dhw.factor?.value], ['heatSupply', 1.15])
  assert.ok(dhw.steps.some((x) => /Wärmelieferung: .* ÷ 1,15 = .*§ 9 Abs\. 2 Satz 6 Nr\. 2/.test(x)), dhw.steps.join(' | '))
})

// Prüfung R-M4, Gegenprüfung: Contracting mit einer Wärmepumpe ist zugelassen; gesperrt sind nur die Formeln,
// weil offen ist, ob Nr. 2 (÷ 1,15) oder Nr. 3 (× 0,30) gilt.
test('Wärmepumpe mit Contracting: Formel gesperrt mit dem Satz zur offenen Frage; gemessen geht', () => {
  const pumpe = { energy: 'heatPump' as const, contracting: true, heatGeneration: 'single' as const, capturedOnOct2024: true }
  const s = computeSettlement(selfSnapshot({ plant: pumpe, row: formel }))
  const n = s.notices.find((x) => x.code === 'heating.dhw-share-invalid') ?? assert.fail(`kein Fehler: ${codes(s).join(', ')}`)
  assert.match(n.text, /denn bei Contracting mit einer Wärmepumpe regelt die Heizkostenverordnung nicht, ob der Formelwert durch 1,15 zu dividieren \(Wärmelieferung\) oder bei einer monovalenten Wärmepumpe mit 0,30 zu multiplizieren ist \(§ 9 Abs\. 2 Satz 6 Nr\. 2 und 3 HeizkostenV\); Mietfuchs rät keine der beiden Zahlen; bitte messen Sie die Wärme für das Warmwasser mit einem Wärmezähler \(§ 9 Abs\. 2 Satz 1\)/)
  // Gemessen (Wärmezähler, Beispiel A) rechnet sie gegen die gelieferte Wärme.
  const gemessen = computeSettlement(selfSnapshot({ plant: pumpe }))
  assert.ok(!codes(gemessen).includes('heating.dhw-share-invalid'), codes(gemessen).join(', '))
  assert.equal(gemessen.heating?.find((h) => h.plantId === 'hp')?.self?.dhw?.denominator.kind, 'deliveredHeat')
})

// Prüfung C-S2: Das Blatt für den Messdienst nahm die Anlage aus der Quelle, nicht aus dem Schnappschuss; bei
// Contracting stand dort der Brennstoff, und der Vorrat einer Ölanlage wurde gelesen.
test('Blatt für den Messdienst: Contracting mit Öl ist Wärmelieferung, ohne Vorrat', () => {
  const src = co2Source(2025, { co2CostCents: 52549 }, [], { energy: 'oil', contracting: true })
  const vorrat = { stockUnit: 'l' as const, openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, openingAlreadySettled: false, closingQuantity: 800, closingMeasuredOn: '2025-12-31' }
  const sheet = co2SheetFor({ ...src, heatingPeriodRows: [{ plantId: 'hp', period: P, dhwMethod: null, dhwUnmeasurable: null, ...vorrat }] }, 'objekt-1', 'hp', calendarYearPeriod(2025), '2026-10-12') ?? assert.fail('kein Blatt')
  assert.deepEqual([sheet.energy, sheet.contracting, sheet.fuelEnergy, sheet.opening ?? null], ['districtHeating', true, 'oil', null])
})

// Durchsicht von #272, M1: § 11 Abs. 1 Nr. 3 Buchst. a a. F. („mit Wärme aus … Wärmepumpen- … anlagen“) und § 12 Abs. 3
// HeizkostenV („Wärme oder Warmwasser aus Wärmepumpen“) hängen am Wärmeerzeuger, nicht am Betreiber (§ 1 Abs. 1 Nr. 2:
// Wärmelieferung „auch aus Anlagen nach Nummer 1“). Contracting mit Wärmepumpe rechnet dafür wie die eigene Wärmepumpe
// (Auslegung am Wortlaut). Mit gemessener Gesamtwärme ist der Warmwasseranteil in beiden Fällen derselbe; ohne sie
// rechnet die eigene Wärmepumpe keinen Anteil (§ 9 Abs. 1 Satz 2, `heatPumpBasis`), Contracting gegen die gelieferte
// Wärme laut Rechnung. Ohne Contracting ergeben die Zahlen der Durchsicht A 1.995,90 €, B 2.661,20 €, C1 1.229,10 €,
// C2 773,80 € (2023, ohne Gesamtwärme).
test('Contracting mit Wärmepumpe: alte Ausnahme (2023) und Übergang nach § 12 Abs. 3 (2025) wie bei der eigenen Wärmepumpe', () => {
  const pumpe = { energy: 'heatPump' as const, heatGeneration: 'single' as const, capturedOnOct2024: false, captureInstalledOn: '2026-03-01', heatPumpMajority: 'yes' as const }
  const sums = (r: ComputedSettlement) => Object.fromEntries(r.statements.map((st) => [st.tenancyId, st.rows.reduce((a, x) => a + x.shareCents, 0)]))
  const heat = (r: ComputedSettlement) => codes(r).filter((c) => c.startsWith('heating.heat-pump') || c === 'heating.info-incomplete' || c.startsWith('co2.')).sort()
  assert.deepEqual(sums(computeSettlement(selfSnapshot({ year: 2023, plant: pumpe }))), { A: 199590, B: 266120, C1: 122910, C2: 77380 })
  for (const year of [2023, 2025]) {
    const row = { totalHeatKwh: 60000 }
    // Die Rechnung einer Wärmepumpe trägt keine CO₂-Werte (Nachprüfung von #272, N1: mit Werten über 0 würde aufgeteilt).
    const deliveries = [selfDelivery({ emissionsKg: null, co2CostCents: null }, year)]
    const eigen = computeSettlement(selfSnapshot({ year, plant: pumpe, row, deliveries }))
    const con = computeSettlement(selfSnapshot({ year, plant: { ...pumpe, contracting: true }, row, deliveries }))
    assert.deepEqual(heat(con), heat(eigen), `${year}`)
    assert.deepEqual(sums(con), sums(eigen), `${year}`)
    assert.ok(codes(con).includes('heating.heat-pump-capture'), `${year}: ${codes(con).join(', ')}`)
    if (year === 2023) assert.ok(codes(con).includes('heating.heat-pump-old-exemption'), codes(con).join(', '))
    assert.ok(!codes(con).includes('heating.info-incomplete'), `${year}: keine Kürzung nach § 12`)
  }
})

// Nachprüfung von #272, N1: § 2 Abs. 1 Satz 2 CO2KostAufG erfasst Wärmelieferung „hinsichtlich der für die Wärmeerzeugung
// eingesetzten Brennstoffe“. Erzeugt der Lieferant die Wärme nicht allein mit der Wärmepumpe (etwa mit Gasspitzenkessel,
// `mixed`) oder weist die Rechnung CO₂-Kosten aus, wird aufgeteilt wie bisher; nur die reine Wärmepumpe bleibt ohne.
test('Contracting mit Wärmepumpe und Gasspitzenkessel: CO₂ wird aufgeteilt wie bei Gas-Contracting; reine Wärmepumpe nicht', () => {
  const row = { totalHeatKwh: 60000 }
  const base = { heatGeneration: 'mixed' as const, capturedOnOct2024: true, contracting: true }
  const sums = (r: ComputedSettlement) => Object.fromEntries(r.statements.map((st) => [st.tenancyId, st.rows.reduce((a, x) => a + x.shareCents, 0)]))
  const co2Share = (r: ComputedSettlement) => r.landlord.rows.flatMap((x) => x.landlordParts ?? []).filter((x) => x.reason === 'co2Share').reduce((a, x) => a + x.cents, 0)
  const wp = computeSettlement(selfSnapshot({ plant: { ...base, energy: 'heatPump' }, row }))
  const gas = computeSettlement(selfSnapshot({ plant: { ...base, energy: 'gas' }, row }))
  assert.ok(co2Share(gas) > 0, 'Gas-Contracting teilt auf')
  assert.equal(co2Share(wp), co2Share(gas))
  assert.deepEqual(sums(wp), sums(gas))
  assert.deepEqual([co2Share(wp), sums(wp)], [CO2_SHARE, MIXED_SUMS])
  // Gegenprobe: Die reine Wärmepumpe des Lieferanten ohne CO₂-Kosten auf der Rechnung bleibt ohne Aufteilung und Hinweis.
  const rein = computeSettlement(selfSnapshot({ plant: { ...base, energy: 'heatPump', heatGeneration: 'single' }, row, deliveries: [selfDelivery({ emissionsKg: null, co2CostCents: null })] }))
  assert.equal(co2Share(rein), 0)
  assert.ok(!codes(rein).some((c) => c.startsWith('co2.')), codes(rein).join(', '))
  // Weist die Rechnung der reinen Wärmepumpe doch CO₂-Kosten über 0 aus, wird aufgeteilt (Regel der Nachprüfung).
  assert.ok(co2Share(computeSettlement(selfSnapshot({ plant: { ...base, energy: 'heatPump', heatGeneration: 'single' }, row }))) > 0)
})
// Aus dem Lauf: Vermieteranteil an den CO₂-Kosten 568,66 €, Anteile der Mieter nach Abzug.
const CO2_SHARE = 56866
const MIXED_SUMS = { A: 179428, B: 239236, C1: 121812, C2: 68658 }

// Gegenmutation N1.1 überlebte (der Gasspitzenkessel wirkte nur über die CO₂-Werte der Rechnung): Fehlen sie, kommt bei
// `mixed` der bestehende Hinweis co2.missing, bei der reinen Wärmepumpe nicht.
test('Contracting mit Wärmepumpe und Gasspitzenkessel ohne CO₂-Angaben: co2.missing; reine Wärmepumpe still', () => {
  const ohneCo2 = [selfDelivery({ emissionsKg: null, co2CostCents: null })]
  const plantOf = (heatGeneration: 'mixed' | 'single') => ({ energy: 'heatPump' as const, heatGeneration, capturedOnOct2024: true, contracting: true })
  const mixed = computeSettlement(selfSnapshot({ plant: plantOf('mixed'), row: { totalHeatKwh: 60000 }, deliveries: ohneCo2 }))
  assert.ok(codes(mixed).includes('co2.missing'), codes(mixed).join(', '))
  const single = computeSettlement(selfSnapshot({ plant: plantOf('single'), row: { totalHeatKwh: 60000 }, deliveries: ohneCo2 }))
  assert.ok(!codes(single).includes('co2.missing'), codes(single).join(', '))
})
