// Das Blatt „CO₂-Angaben für den Messdienst“ nach der Durchsicht von #246, Runde 4: Abgrenzung bei einer Lücke,
// Stufe, Weg d und Fläche aus der Abrechnung, der Anfangsbestand aus der Vorperiode und der Vermerk, wenn die
// Bestandsrechnung nicht aufgeht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { co2SheetFor, co2SheetOf } from '../src/co2Sheet.ts'
import { heatingSnapshotFor, snapshotFor, type SnapshotCostItem, type SnapshotHeatingPeriodRow, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Sheet, FuelDelivery, HeatingStatement } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Src = ReturnType<typeof co2Source>

function both(src: Src, plantId = 'hp'): { sheet: Co2Sheet; heating: HeatingStatement | null } {
  const sheet = co2SheetFor(src, 'objekt-1', plantId, P, '2026-10-07') ?? assert.fail('kein Blatt')
  const s = computeSettlement(snapshotFor(src, 'objekt-1', P))
  return { sheet, heating: s.heating?.find((h) => h.plantId === plantId) ?? null }
}

const oel: Partial<FuelDelivery> = { deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', invoiceFrom: null, invoiceTo: null, quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549, label: 'Heizöl März' }
const row = (period: string, over: Partial<SnapshotHeatingPeriodRow>): SnapshotHeatingPeriodRow => ({
  plantId: 'hp', period: periodKey(period), dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: null, openingCostCents: null, openingEmissionsKg: null,
  openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null, ...over,
})
function oelSource(rows: SnapshotHeatingPeriodRow[], linked = true): Src {
  const src = co2Source(2025, oel, [], { energy: 'oil' })
  return {
    ...src,
    costItems: src.costItems.map((c) => ({ ...c, amountCents: 315000, fuelDeliveryId: linked ? c.fuelDeliveryId : null })),
    heatingPeriodRows: rows,
  }
}
const VORRAT = row('2025-01', { openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' })

test('Gegenmutation a: bei einer Lücke ist die abgegrenzte Zeile die Summe der abgegrenzten Teile, nicht die hochgerechneten kg', () => {
  // Eine Gasrechnung Juli 2024 bis Juni 2025: Sie deckt die Heizperiode 2025 nur zum Teil ab.
  const src = co2Source(2025, { invoiceFrom: '2024-07-01', invoiceTo: '2025-06-30', invoiceDate: '2025-07-10', emissionsKg: 10000, co2CostCents: 65450 })
  const { sheet, heating } = both(src)
  const fuel = heating?.fuel ?? assert.fail('keine Abgrenzung')
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  const inPeriod = sheet.billing.inPeriod ?? assert.fail('keine abgegrenzte Zeile')
  assert.ok(inPeriod.coveragePermille < 1000, `Abdeckung ${inPeriod.coveragePermille}`)
  const teile = fuel.deliveries.reduce((a, l) => a + (l.emissionsKg ?? 0), 0)
  assert.ok(Math.abs(inPeriod.emissionsKg - teile) < 1e-6, `${inPeriod.emissionsKg} gegen ${teile}`)
  assert.ok(inPeriod.emissionsKg < 10000, `nicht hochgerechnet: ${inPeriod.emissionsKg}`)
  // Die Abrechnung rechnet nur die kg hoch, die CO₂-Kosten nicht: € der Zeile = € der Grundlage.
  assert.equal(inPeriod.co2Cents, co2.totalCents)
  assert.deepEqual([sheet.billing.basis?.emissionsKg, sheet.billing.basis?.co2Cents], [co2.emissionsKg, co2.totalCents])
  assert.ok((co2.emissionsKg ?? 0) > inPeriod.emissionsKg + 1, 'die Grundlage ist hochgerechnet')
})

test('Gegenmutation b: die Stufe kommt aus der Abrechnung', () => {
  const { sheet, heating } = both(oelSource([VORRAT]))
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.ok(co2.stage, 'die Abrechnung stuft ein')
  assert.deepEqual(sheet.billing.basis?.stage, co2.stage)
  assert.equal(sheet.billing.basis?.areaM2, co2.areaM2)
})

test('Gegenmutation c: nach Weg d liest das Blatt die eigene Heizkostenabrechnung der Heizperiode', () => {
  // Die Anlage rechnet Mai bis April und gesondert ab (Weg d); das Objekt im Kalenderjahr.
  const H = periodKey('2025-05')
  const h = periodOfKey({ startMonth: 5, changes: [] }, H) ?? assert.fail('keine Heizperiode')
  const base = co2Source(2025, { invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', invoiceDate: '2026-05-10', emissionsKg: 9000, co2CostCents: 58905 }, [], {
    periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], separateSettlement: true,
  })
  const src: Src = { ...base, costItems: base.costItems.map((c) => ({ ...c, period: H })) }
  const sheet = co2SheetFor(src, 'objekt-1', 'hp', h, '2026-10-07') ?? assert.fail('kein Blatt')
  const snap = heatingSnapshotFor(src, 'objekt-1', 'hp', h) ?? assert.fail('kein Schnappschuss')
  const heating = computeSettlement(snap).heating?.find((x) => x.plantId === 'hp') ?? assert.fail('keine Anlage in der Heizkostenabrechnung')
  const co2 = heating.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.ok(sheet.billing.basis, 'das Blatt nennt die Grundlage der eigenen Heizkostenabrechnung')
  assert.deepEqual([sheet.billing.basis?.emissionsKg, sheet.billing.basis?.co2Cents, sheet.billing.basis?.kgPerM2], [co2.emissionsKg, co2.totalCents, co2.kgPerM2])
  assert.equal(sheet.billing.inPeriod?.coveragePermille, 1000)
})

test('Fläche aus der Abrechnung: zwei Anlagen im selben Gebäude, das Blatt nennt die gemeinsame Fläche der Einstufung', () => {
  const base = co2Source(2025, {})
  const anlage = (over: Partial<SnapshotHeatingPlant> & { id: string }): SnapshotHeatingPlant & { propertyId: string } => ({
    name: over.id, energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
    units: null, propertyId: 'objekt-1', ...over,
  })
  const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
    propertyId: 'objekt-1', period: P.key, category: HEATING_CATEGORY, description: over.id, amountCents: 0, key: 'area', heatingPart: 'fuel', ...over,
  })
  const d = base.fuelDeliveries[0] ?? assert.fail('keine Lieferung')
  const src: Src = {
    ...base,
    heatingPlants: [
      anlage({ id: 'H1', name: 'Zentral A', units: [{ unitId: 'a', heatedAreaM2: null }] }),
      anlage({ id: 'H2', name: 'Zentral B', units: [{ unitId: 'b', heatedAreaM2: null }], buildingWith: 'H1' }),
    ],
    costItems: [
      position({ id: 'g1', amountCents: 200000, heatingPlantId: 'H1', fuelDeliveryId: 'd1', participantUnitIds: ['a'] }),
      position({ id: 'g2', amountCents: 100000, key: 'direct', directUnitId: 'b', heatingPlantId: 'H2', fuelDeliveryId: 'd2' }),
    ],
    fuelDeliveries: [
      { ...d, id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 },
      { ...d, id: 'd2', plantId: 'H2', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 3000, co2CostCents: 16500 },
    ],
  }
  const { sheet, heating } = both(src, 'H1')
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  // Gemeinsam: 9.000 kg auf 100 m² (60 + 40); die eigene Anlage versorgt nur 60 m². Die Abrechnung sagt selbst,
  // dass die Fläche die des Gebäudes ist (Nach Runde 4: `areaScope`), das Blatt liest es.
  assert.equal(co2.areaM2, 100)
  assert.equal(co2.areaScope, 'building')
  assert.deepEqual([sheet.areaM2, sheet.areaSource], [100, 'building'])
})

test('Fläche aus der Abrechnung: ohne zweite Anlage bleibt sie die der versorgten Wohnungen', () => {
  const { sheet, heating } = both(oelSource([VORRAT]))
  assert.deepEqual([sheet.areaM2, sheet.areaSource], [heating?.co2?.areaM2, 'served'])
})

test('S-K1, Vorperiode: Ein übernommener Anfangsbestand ist als übernommen gekennzeichnet', () => {
  const vorjahr = row('2024-01', { openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 35034, openingInvoicedBefore2023: false, closingQuantity: 1000, closingMeasuredOn: '2024-12-31' })
  const { sheet } = both(oelSource([vorjahr, row('2025-01', { closingQuantity: 1800, closingMeasuredOn: '2025-12-31' })]))
  const o = sheet.opening ?? assert.fail('kein Anfangsbestand')
  assert.equal(o.source, 'carried')
  assert.equal(o.co2CostCents, o.countedCents)
  assert.equal(both(oelSource([VORRAT])).sheet.opening?.source, 'entered')
})

test('Klein 2: geht die Bestandsrechnung nicht auf, sagt der Vermerk genau das, einmal „nicht berücksichtigt“', () => {
  const note = both(oelSource([VORRAT], false)).sheet.opening?.note ?? assert.fail('kein Vermerk')
  assert.equal(note, 'Nicht berücksichtigt: Die Bestandsrechnung des Vorrats (Heizperiode 2025) geht nicht auf.')
})

// Nach Runde 4: Ob die Fläche die gemeinsame eines Gebäudes ist, entscheidet die Abrechnung (`areaScope`); das
// Blatt schließt es nicht aus einer Abweichung.
test('Nach Runde 4: eine Anlage allein heißt „plant“, auch wenn ihre Fläche von der der Wohnungen abweicht', () => {
  const { heating } = both(oelSource([VORRAT]))
  const h = heating ?? assert.fail('keine Anlage')
  const co2 = h.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.equal(co2.areaScope, 'plant')
  // Die Abrechnung stuft mit 80 m² ein (etwa weil nur bestimmte Wohnungen beteiligt sind); die Wohnungen haben 100 m².
  const input = (heating: HeatingStatement | null) => ({
    propertyName: '', address: '', landlordName: '', today: '2026-10-07', overrides: [], items: [], stock: null, enteredAreaM2: null,
    plant: { id: 'hp', name: 'Kessel', energy: 'oil' as const, method: 'manual' as const, units: null, nonResidential: false, restriction: 'none' as const, districtEtsNew: false },
    h: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, units: [{ id: 'a', areaM2: 60 }, { id: 'b', areaM2: 40 }], deliveries: [], heating,
  })
  const abweichend = co2SheetOf(input({ ...h, co2: { ...co2, areaM2: 80, areaScope: 'plant' } }))
  assert.deepEqual([abweichend.areaM2, abweichend.areaSource], [80, 'served'])
  // Eine abgeschlossene Abrechnung von vorher kennt das Feld nicht: Fläche ohne Zusatz.
  const { areaScope: _weg, ...alt } = { ...co2, areaM2: 100 }
  const eingefroren = co2SheetOf(input({ ...h, co2: alt }))
  assert.deepEqual([eingefroren.areaM2, eingefroren.areaSource], [100, null])
})

// Ausnahme nach § 11 für Wärme und Warmwasser ohne vereinbarte Abrechnung (Restpunkt nach dem Umstellen auf
// PR 14): Das CO2KostAufG gilt nicht (§ 2 Abs. 7). Das Blatt liest das aus der Abrechnung (`co2Check`):
// keine Angaben zu §§ 8, 9, keine Befunde, dafür die Ausnahme, wie die Abrechnung sie ausweist.
const ausnahme = (rules: Partial<SnapshotHeatingPeriodRow>): Src => {
  const src = co2Source(2025, { co2CostCents: 55000 })
  return { ...src, heatingPeriodRows: [{ plantId: 'hp', period: P.key, dhwMethod: null, dhwUnmeasurable: null, ...rules }] }
}

test('Ausnahme nach § 11 ohne vereinbarte Abrechnung: das Blatt prüft nicht, stuft nicht ein und nennt die Ausnahme', () => {
  const { sheet, heating } = both(ausnahme({ exemption: 'authority', exemptionScope: 'both' }))
  const check = heating?.co2Check ?? assert.fail('kein co2Check in der Abrechnung')
  assert.equal(check.applies, false)
  assert.match(check.exemption ?? '', /§ 11 Abs\. 1 Nr\. 5 HeizkostenV/)
  assert.deepEqual(check.findings, [])
  assert.equal(sheet.checked, false)
  assert.equal(sheet.exemption, check.exemption)
  assert.deepEqual(sheet.deliveries.map((d) => d.findings), [[]])
  assert.equal(sheet.billing.basis, null)
})

test('Gegentest: mit vereinbarter Abrechnung (§ 2 Abs. 7) bleibt alles wie ohne Ausnahme', () => {
  const ohne = both(ausnahme({}))
  const vereinbart = both(ausnahme({ exemption: 'authority', exemptionScope: 'both', exemptionBillingAgreed: true }))
  for (const { sheet, heating } of [ohne, vereinbart]) {
    const check = heating?.co2Check ?? assert.fail('kein co2Check in der Abrechnung')
    assert.equal(check.applies, true)
    assert.equal(check.exemption, null)
    assert.equal(sheet.checked, true)
    assert.equal(sheet.exemption, null)
    // Die Befunde des Blatts sind die der Abrechnung, je Rechnung.
    assert.deepEqual(sheet.deliveries.map((d) => d.findings), check.findings.map((f) => f.texts))
    assert.equal(sheet.deliveries[0]?.findings.length, 1)
  }
  assert.deepEqual(vereinbart.sheet.deliveries.map((d) => d.findings), ohne.sheet.deliveries.map((d) => d.findings))
})

// Ohne Position in der Heizperiode (beim Messdienst der übliche Ablauf: das Blatt entsteht vor seiner Rechnung),
// hier eine Anlage mit eigener Heizperiode Mai bis April. Die Abrechnung führt die Anlage trotzdem, weil sie
// Lieferungen hat; steht die Heizperiode in gar keiner Abrechnung, fragt das Blatt dieselbe Regel
// (`co2ExemptionOf` in co2Exemption.ts, Rückweg geprüft in co2-sheet.test.ts).
const HM = periodKey('2025-05')
const hMai = periodOfKey({ startMonth: 5, changes: [] }, HM) ?? assert.fail('keine Heizperiode')
const ohnePosition = (rules: Partial<SnapshotHeatingPeriodRow>, positions = false): Src => {
  const src = co2Source(2025, { invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', invoiceDate: '2026-05-10', co2CostCents: 55000 }, [], { periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false })
  return {
    ...src,
    costItems: positions ? src.costItems.map((c) => ({ ...c, period: HM })) : [],
    heatingPeriodRows: [{ plantId: 'hp', period: HM, dhwMethod: null, dhwUnmeasurable: null, ...rules }],
  }
}

test('Ohne Position, Ausnahme nach § 11 ohne vereinbarte Abrechnung: keine §§ 8, 9, keine Summe, keine Befunde, die Ausnahme', () => {
  const src = ohnePosition({ exemption: 'authority', exemptionScope: 'both' })
  const sheet = co2SheetFor(src, 'objekt-1', 'hp', hMai, '2026-10-07') ?? assert.fail('kein Blatt')
  assert.equal(sheet.billing.basis, null)
  assert.equal(sheet.checked, false)
  assert.match(sheet.exemption ?? '', /§ 11 Abs\. 1 Nr\. 5 HeizkostenV/)
  assert.deepEqual(sheet.deliveries.map((d) => d.findings), [[]])
  // Derselbe Wortlaut wie in der Abrechnung, sobald es eine Position gibt.
  const mit = ohnePosition({ exemption: 'authority', exemptionScope: 'both' }, true)
  assert.equal(sheet.exemption, (co2SheetFor(mit, 'objekt-1', 'hp', hMai, '2026-10-07') ?? assert.fail('kein Blatt')).exemption)
  assert.ok(sheet.exemption)
})

test('Gegentest ohne Position: mit vereinbarter Abrechnung (§ 2 Abs. 7) gilt das Gesetz, keine Ausnahme', () => {
  const sheet = co2SheetFor(ohnePosition({ exemption: 'authority', exemptionScope: 'both', exemptionBillingAgreed: true }), 'objekt-1', 'hp', hMai, '2026-10-07') ?? assert.fail('kein Blatt')
  assert.equal(sheet.checked, true)
  assert.equal(sheet.exemption, null)
})
