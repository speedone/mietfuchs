// Umstellung auf Wärmelieferung im laufenden Mietverhältnis (Heizung PR 16, #213): der Hinweis
// `heating.contracting` nach § 556c BGB, der WärmeLV und BGH VIII ZR 46/25, im Wortlaut der Gegenprüfung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { subtractMonths, switchFindings } from '../src/heatDelivery.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { asBilledPlant } from '../../shared/heatDelivery.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod, calendarYearPeriod, periodKey } from '../../shared/period.ts'

const P = calendarPeriod(2025)
const unit = (id: string): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true })
const units = [unit('a'), unit('b')]
const mieter = (id: string, name: string, unitId: string, start: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: name, persons: 1, personHistory: [], start, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const position: SnapshotCostItem = {
  id: 'hz', period: P, category: HEATING_CATEGORY, description: 'Wärmelieferung', amountCents: 100000, key: 'area', heatingPlantId: 'hp',
}
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Kessel', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, ...over,
})
// Meier wohnt seit 2010, also schon vor jeder Umstellung der Tests; Schulz zieht am Tag der Umstellung ein.
const vorher = [mieter('ta', 'Meier', 'a', '2010-01-01'), mieter('tb', 'Schulz', 'b', '2025-10-01')]
const source = (tenancies: SnapshotTenancy[]): SnapshotSource => ({ units, tenancies, costItems: [position], meters: [], readings: [], payments: [], closedSettlements: [] })
const settle = (p: SnapshotHeatingPlant, tenancies: SnapshotTenancy[] = vorher): ComputedSettlement =>
  computeSettlement({ ...snapshotOf(source(tenancies), 2025), heatingPlants: [asBilledPlant(p)], co2Statements: [] })
const codes = (r: ComputedSettlement) => r.notices.map((n) => n.code)
const umstellung = (r: ComputedSettlement) => r.notices.filter((n) => n.code === 'heating.contracting')
const one = (r: ComputedSettlement) => {
  const [n, ...rest] = umstellung(r)
  if (!n) return assert.fail(`kein Hinweis: ${codes(r).join(', ')}`)
  assert.equal(rest.length, 0)
  return n
}
const gasCon = (over: Partial<SnapshotHeatingPlant> = {}) => plant({ energy: 'gas', contracting: true, heatDeliverySince: '2025-10-01', ...over })

test('§ 556c: Umstellung am 01.10.2025 von der eigenen Heizung; nur der Mieter, dessen Vertrag vorher lief (Review Focus 4)', () => {
  const n = one(settle(gasCon({ previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' })))
  assert.deepEqual([n.level, n.title, n.subject], ['hint', 'Umstellung auf Wärmelieferung', { kind: 'heatingPlant', id: 'hp' }])
  assert.match(n.text, /Meier/)
  assert.doesNotMatch(n.text, /Schulz/)
  assert.match(n.text, /maßgeblich ist, ob der Mietvertrag vor der Umstellung geschlossen wurde; ohne eingetragenes Vertragsdatum nimmt Mietfuchs den Mietbeginn/)
  // Prüfung R-M1 in der Fassung der Gegenprüfung: zwei Voraussetzungen, die Ankündigung als eigene Pflicht.
  assert.match(n.text, /Die Kosten der Wärmelieferung tragen sie als Betriebskosten nur, wenn die Wärme mit verbesserter Effizienz aus einer vom Lieferanten neu errichteten Anlage oder aus einem Wärmenetz kommt \(hatte die bisherige Anlage einen Jahresnutzungsgrad von mindestens 80 %, genügt eine verbesserte Betriebsführung\) und die Kosten der Wärmelieferung die Betriebskosten der bisherigen Eigenversorgung mit Wärme oder Warmwasser nicht übersteigen \(Kostenvergleich nach §§ 8 bis 10 WärmeLV; § 556c Abs\. 1 BGB\)\. Außerdem müssen Sie die Umstellung spätestens 3 Monate vorher in Textform und mit den Angaben nach § 11 Abs\. 2 WärmeLV ankündigen \(§ 556c Abs\. 2 BGB, § 11 Abs\. 1 WärmeLV\)\./)
  // Prüfung R-M2 in der Fassung der Gegenprüfung.
  assert.match(n.text, /Fehlt eine der beiden Voraussetzungen nach § 556c Abs\. 1 BGB, tragen diese Mieter die Kosten der Wärmelieferung nicht als Betriebskosten\. Die Wärmelieferverordnung geht davon aus, dass Sie dann die Bestandteile umlegen, die den Kosten bei eigener Versorgung nach § 7 Abs\. 2 und § 8 Abs\. 2 HeizkostenV entsprechen; dafür können Sie vom Lieferanten verlangen, diese Bestandteile seines Preises gesondert auszuweisen \(§ 5 WärmeLV\)\./)
  assert.doesNotMatch(n.text, /§ 11 Abs\. 3 WärmeLV/)
  assert.ok(settle(gasCon({ previousSupply: 'landlord' })).legalBasis.values?.some((v) => v.id === 'bgb.heat-delivery-switch'))
})

test('Prüfung C-S7: maßgeblich ist das Vertragsdatum; Vertrag vor der Umstellung, Einzug am Tag der Umstellung ergibt einen Hinweis', () => {
  const n = one(settle(gasCon({ previousSupply: 'landlord' }), [mieter('ta', 'Meier', 'a', '2010-01-01'), mieter('tb', 'Schulz', 'b', '2025-10-01', { contractDate: '2025-08-01' })]))
  assert.match(n.text, /Meier und Schulz/)
})

test('Prüfung R-S1: Pauschale und Inklusivmiete bei der Heizung erfüllen § 556c Abs. 1 nicht; ausgezogene Mieter auch nicht', () => {
  const r = settle(gasCon({ previousSupply: 'landlord' }), [mieter('ta', 'Meier', 'a', '2010-01-01', { heatingModel: 'inclusive' }), mieter('tb', 'Schulz', 'b', '2010-01-01', { heatingModel: 'flatRate' })])
  assert.equal(umstellung(r).length, 0)
  const aus = settle(gasCon({ previousSupply: 'landlord' }), [mieter('ta', 'Meier', 'a', '2010-01-01', { end: '2025-09-30' })])
  assert.equal(umstellung(aus).length, 0)
})

test('§ 11 Abs. 3 WärmeLV: Ankündigung zu spät oder nicht erfasst (Prüfung R-M3, R-S6)', () => {
  const spaet = one(settle(gasCon({ previousSupply: 'landlord', switchAnnouncedOn: '2025-07-01' })))
  assert.match(spaet.text, /Die Umstellungsankündigung ging am 01\.07\.2025 zu, weniger als 3 Monate vor der Umstellung\. Ohne ordnungsgemäße Ankündigung beginnt die Frist für Einwendungen gegen die Abrechnung der Wärmelieferkosten \(§ 556 Abs\. 3 Satz 5 BGB\) frühestens, wenn der Mieter eine Mitteilung erhalten hat, die § 11 Abs\. 1 und 2 WärmeLV entspricht \(§ 11 Abs\. 3 WärmeLV\)\./)
  // Rückwärts gerechnet entsprechend §§ 187, 188 Abs. 2 BGB (Auslegung): Zugang bis 30.06. bei Umstellung am 01.10.
  const rechtzeitig = one(settle(gasCon({ previousSupply: 'landlord', switchAnnouncedOn: '2025-06-30' })))
  assert.doesNotMatch(rechtzeitig.text, /weniger als/)
  const ohne = one(settle(gasCon({ previousSupply: 'landlord' })))
  assert.match(ohne.text, /Ob und wann die Umstellungsankündigung zuging, ist nicht erfasst\./)
})

test('Prüfung R-S1: vorherige Versorgung unbekannt, die Einleitung ist bedingt', () => {
  const n = one(settle(gasCon({ previousSupply: null })))
  assert.match(n.text, /Haben Sie vorher mit einer eigenen Anlage versorgt und trugen diese Mieter die Heizkosten als Betriebskosten, gilt § 556c BGB: Die Kosten der Wärmelieferung tragen sie/)
})

test('VIII ZR 46/25: vorher selbst geheizt, § 556c gilt nicht; der Einzelfall wird nicht verallgemeinert (Prüfung R-S4)', () => {
  const n = one(settle(gasCon({ previousSupply: 'tenant' })))
  assert.match(n.text, /VIII ZR 46\/25 und 47\/25/)
  assert.match(n.text, /§ 556c BGB gilt dann nicht/)
  assert.match(n.text, /auch stillschweigend/)
  assert.match(n.text, /bloße Zahlung von Vorauszahlungen genügt dafür nicht/)
  assert.match(n.text, /In dem entschiedenen Fall hat der BGH eine solche Vereinbarung jedenfalls über die Kosten angenommen, die bei eigener zentraler Versorgung nach § 7 Abs\. 2 und § 8 Abs\. 2 HeizkostenV angefallen wären\./)
  assert.match(n.text, /§ 7 Abs\. 4 und § 8 Abs\. 4 HeizkostenV einschließlich der kalkulatorischen Kosten umfasst, hat der BGH offengelassen/)
  assert.doesNotMatch(n.text, /Dann können Sie jedenfalls|verbesserter Effizienz/)
})

test('Review Focus 5: Umstellung vor dem 01.07.2013, eigener Text, kein Programmfehler (Prüfung R-S5)', () => {
  const n = one(settle(plant({ energy: 'districtHeating', heatDeliverySince: '2012-10-01', previousSupply: 'landlord' })))
  assert.match(n.text, /vor dem 01\.07\.2013/)
  assert.match(n.text, /Die vollen Kosten der Wärmelieferung können Sie dann nur umlegen, wenn der Mietvertrag es ausdrücklich vorsieht oder der Mieter der Änderung zugestimmt hat \(BGH, Urteil vom 6\. April 2005, VIII ZR 54\/04\)\./)
  assert.ok(!(settle(plant({ energy: 'districtHeating', heatDeliverySince: '2012-10-01' })).legalBasis.values ?? []).some((v) => v.id === 'bgb.heat-delivery-switch'))
})

test('Wer nichts einträgt, merkt nichts: ohne Tag der Umstellung kein Hinweis und kein Rechtswert', () => {
  for (const p of [plant({ energy: 'gas', contracting: true }), plant({ energy: 'districtHeating' }), plant()]) {
    const r = settle(p)
    assert.equal(umstellung(r).length, 0)
    assert.ok(!(r.legalBasis.values ?? []).some((v) => v.id === 'bgb.heat-delivery-switch'))
  }
})

test('Monate abziehen: Monatsende bleibt im Monat', () => {
  assert.equal(subtractMonths('2025-10-01', 3), '2025-07-01')
  assert.equal(subtractMonths('2025-05-31', 3), '2025-02-28')
  assert.equal(subtractMonths('2024-05-31', 3), '2024-02-29')
  assert.equal(subtractMonths('2026-02-15', 3), '2025-11-15')
})

test('Befund rein: eine Anlage ohne Positionen in dieser Abrechnung meldet nichts (Weg b: der Unteraufruf meldet ihn)', () => {
  assert.deepEqual(switchFindings([asBilledPlant(gasCon())], [], vorher, units), [])
})

test('Weg b: eigene Heizperiode Mai bis April, der Hinweis kommt aus der Heizperiode, genau einmal', () => {
  const src = co2Source(2025, {}, [], { contracting: true, heatDeliverySince: '2024-10-01', previousSupply: 'landlord', periodStartMonth: 5 })
  const r = computeSettlement(snapshotFor({ ...src, fuelDeliveries: [], costItems: src.costItems.map((c) => ({ ...c, period: periodKey('2024-05'), fuelDeliveryId: undefined })) }, 'objekt-1', calendarYearPeriod(2025)))
  assert.equal(umstellung(r).length, 1, codes(r).join(', '))
  assert.match(umstellung(r)[0]?.text ?? '', /Mieter A und Mieter B/)
})

// Gegenmutation M4.2 überlebte: Ohne weitere Kosten fehlt ein Mietverhältnis mit Pauschale ohnehin in der Abrechnung.
// Mit einer kalten Position steht es darin, und die Regel nach § 556c Abs. 1 (Prüfung R-S1) muss selbst greifen.
test('Prüfung R-S1: Heizpauschale mit kalten Betriebskosten in der Abrechnung, trotzdem kein Hinweis zu § 556c', () => {
  const muell: SnapshotCostItem = { id: 'mu', period: P, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area' }
  const tenancies = [mieter('ta', 'Meier', 'a', '2010-01-01', { heatingModel: 'flatRate' })]
  const r = computeSettlement({ ...snapshotOf({ ...source(tenancies), costItems: [position, muell] }, 2025), heatingPlants: [asBilledPlant(gasCon({ previousSupply: 'landlord' }))], co2Statements: [] })
  assert.ok(r.statements.some((st) => st.tenancyId === 'ta'), 'Meier steht in der Abrechnung')
  assert.equal(umstellung(r).length, 0)
  assert.deepEqual(switchFindings([asBilledPlant(gasCon())], [position], tenancies, units), [])
})
