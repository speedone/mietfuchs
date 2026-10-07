// Schätzung nach § 9a in der Abrechnung (Heizung PR 13): Beispiel A (Entwurf 8.6), der Endstand des
// Wärmezählers C fehlt. C hat 60 von 200 m², also 30 %: Der Topf Heizung geht nach Fläche (§ 9a Abs. 2),
// der Topf Warmwasser bleibt nach Verbrauch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'
import type { CaptureMethod, CostItem, HeatingEstimate, HeatingPart, HeatingPlant, Meter, Reading } from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import { selfDelivery, selfMeter, selfReading, selfRow, selfMeters, selfReadings, selfSnapshot, selfTenancy, selfUnit, type SelfSnapshotOptions } from '../testing/selfHeating.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const textOf = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const shareOf = (s: ComputedSettlement, tenancyId: string, itemId: string) =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((r) => r.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${tenancyId} ${itemId}`)
const selfOf = (s: ComputedSettlement, plantId = 'hp') => s.heating?.find((h) => h.plantId === plantId)?.self ?? assert.fail('kein Ausweis')
const TENANTS = ['A', 'B', 'C1', 'C2'] as const

// Beispiel A ohne den Endstand des Wärmezählers C.
const base = selfSnapshot()
const OHNE_ENDE_C = selfReadings().filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
const estimate = (over: Partial<HeatingEstimate> = {}): HeatingEstimate => ({
  plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, ...over,
})
const run = (o: SelfSnapshotOptions = {}) => computeSettlement(selfSnapshot(o))
const sum = (s: ComputedSettlement) => s.statements.reduce((a, st) => a + st.totalShareCents, 0) + s.landlord.rows.reduce((a, r) => a + r.shareCents, 0)
const positions = (s: Snapshot) => s.costItems.reduce((a, c) => a + c.amountCents, 0)

test('Ohne Schätzung: Fehler mit Verweis auf die Schätzung, statt „spätere Version“', () => {
  const s = run({ readings: OHNE_ENDE_C })
  const text = textOf(s, 'heating.self-incomplete')
  assert.match(text, /schätzen Sie den Verbrauch auf der Seite Heizkosten unter „Schätzung \(§ 9a\)“/)
  assert.doesNotMatch(text, /späteren Version/)
  // Zwei Stände am selben Tag bleiben ein Befund ohne Verweis: Welcher stimmt, weiß nur der Vermieter.
  const doppelt = run({ readings: [...selfReadings(), selfReading('wz-a', '2025-12-31', 13500)] })
  assert.doesNotMatch(textOf(doppelt, 'heating.self-incomplete'), /Schätzung/)
})

test('Mit Schätzung: verteilt, Topf Heizung nur nach Fläche (30 % > 25 %), Warmwasser unverändert, keine Kürzung', () => {
  const snap = selfSnapshot({ readings: OHNE_ENDE_C, estimates: [estimate()] })
  const s = computeSettlement(snap)
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(sum(s), positions(snap))
  // Miete Wärmezähler (nur Heizung, 120 €) nach Fläche und Gradtagen: 60/200, 80/200, 60/200 · 640 ‰, 60/200 · 360 ‰.
  assert.deepEqual(TENANTS.map((t) => shareOf(s, t, 'wz')), [3600, 4800, 2304, 1296])
  // Miete Warmwasserzähler (nur Warmwasser) wie ohne Schätzung.
  const ohne = computeSettlement(base)
  assert.deepEqual(TENANTS.map((t) => shareOf(s, t, 'wwz')), TENANTS.map((t) => shareOf(ohne, t, 'wwz')))
  assert.match(textOf(s, 'heating.estimate-over-25'), /60 von 200 m² \(30 %\).*überschreitet 25 %.*ausschließlich nach Fläche.*§ 9a Abs\. 2.*Auslegung/s)
  assert.ok(!codes(s).includes('heating.no-consumption'), 'keine Kürzung nach § 12 Abs. 1 Satz 1 (15.1 Nr. 7)')
  // Prüfbericht A5: Der Vormieter behält seinen abgelesenen Verbrauch; geschätzt ist nur der Teil des
  // Nachmieters (12.000 kWh · 360 ‰ = 4.320 kWh).
  assert.match(textOf(s, 'heating.estimated'), /von C ist nach § 9a HeizkostenV geschätzt: 12\.000 kWh.*Durchschnitt des Gebäudes je m².*Wärmezähler defekt.*Mieter C1 behält seinen abgelesenen Verbrauch.*für Mieter C2 gilt der Anteil der Schätzung nach Gradtagen: 4\.320 kWh/s)
  assert.ok(!codes(s).includes('heating.estimate-complete'))
  assert.equal(s.notices.find((n) => n.code === 'heating.estimated')?.level, 'hint')
  const self = selfOf(s)
  const heating = self.pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
  assert.deepEqual([heating.overThreshold, heating.estimatedAreaM2, heating.consumptionPct, heating.consumptionCentsPerUnit], [true, 60, 0, null])
  const water = self.pots.find((p) => p.pot === 'water') ?? assert.fail('Topf Warmwasser')
  assert.deepEqual([water.overThreshold, water.estimatedAreaM2, water.consumptionPct], [false, 0, 70])
  assert.equal(self.threshold, 25)
  assert.deepEqual(self.estimates?.map((e) => [e.plantId, e.unitId, e.part, e.value, e.users, e.kept, e.complete]), [['hp', 'c', 'heat', 12000, 1, 1, false]])
  const [c1, c2] = self.units.find((u) => u.unitId === 'c')?.users ?? []
  assert.deepEqual([c1?.heatingConsumption, c1?.heatingEstimated], [7200, false])
  assert.ok(c2 && c2.heatingEstimated === true && Math.abs((c2.heatingConsumption ?? 0) - 4320) < 1e-9)
  assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.estimate-threshold'))
  // Rechenweg: der Topf nur nach Fläche, mit der Norm.
  const steps = s.statements.find((st) => st.tenancyId === 'C2')?.rows.find((r) => r.costItemId === 'gas')?.steps ?? []
  assert.ok(steps.some((x) => /geschätzt für 60 von 200 m², mehr als die Grenze: nur nach Fläche verteilt \(§ 9a Abs\. 2 HeizkostenV\)/.test(x.value)), JSON.stringify(steps))
})

test('Unter der Grenze: Topf nach Verbrauch, der Rechenweg nennt die Schätzung', () => {
  // Fünf Wohnungen, C hat 60 von 320 m² (18,75 %).
  const units = [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60), selfUnit('d', 60), selfUnit('e', 60)]
  const extraMeters = ['d', 'e'].flatMap((u) => [selfMeter(`wz-${u}`, u, `Wärme ${u}`, 'waerme'), selfMeter(`xw-${u}`, u, `Warmwasser ${u}`, 'warmwasser')])
  const extraReadings = ['d', 'e'].flatMap((u) => [selfReading(`wz-${u}`, '2024-12-31', 0), selfReading(`wz-${u}`, '2025-12-31', 12000), selfReading(`xw-${u}`, '2024-12-31', 0), selfReading(`xw-${u}`, '2025-12-31', 30)])
  const s = run({
    units, meters: [...selfMeters(), ...extraMeters], readings: [...OHNE_ENDE_C, ...extraReadings],
    tenancies: [...TENANTS.map((id) => ({ A: selfTenancy('A', 'a', '2020-01-01', null), B: selfTenancy('B', 'b', '2020-01-01', null), C1: selfTenancy('C1', 'c', '2020-01-01', '2025-09-30'), C2: selfTenancy('C2', 'c', '2025-10-01', null) }[id])), selfTenancy('D', 'd', '2020-01-01', null), selfTenancy('E', 'e', '2020-01-01', null)],
    estimates: [estimate()],
  })
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.ok(!codes(s).includes('heating.estimate-over-25'))
  const heating = selfOf(s).pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
  assert.deepEqual([heating.overThreshold, heating.estimatedAreaM2, heating.consumptionPct], [false, 60, 70])
  const steps = s.statements.find((st) => st.tenancyId === 'C2')?.rows.find((r) => r.costItemId === 'wz')?.steps ?? []
  assert.ok(steps.some((x) => /4\.320 von .* kWh \(geschätzt nach § 9a HeizkostenV\)/.test(x.value)), JSON.stringify(steps))
  assert.ok(steps.some((x) => x.term === 'heatingEstimate'))
  assert.ok(!s.statements.find((st) => st.tenancyId === 'C1')?.rows.find((r) => r.costItemId === 'wz')?.steps?.some((x) => /geschätzt/.test(x.value)))
})

test('Unbestätigt: Warnung statt Hinweis', () => {
  const s = run({ readings: OHNE_ENDE_C, estimates: [estimate({ confirmed: false })] })
  assert.match(textOf(s, 'heating.estimate-unconfirmed'), /nicht bestätigt.*Geräteausfalls oder aus einem anderen zwingenden Grund.*VIII ZR 373\/04/s)
  assert.ok(!codes(s).includes('heating.estimated'))
  assert.equal(s.notices.find((n) => n.code === 'heating.estimate-unconfirmed')?.level, 'warning')
})

test('Review Focus 1 (Prüfbericht A9): Schätzung neben vollständiger Ablesung: Warnung, § 9a greift dann nicht; bis zum Entfernen gilt sie', () => {
  const s = run({ estimates: [estimate({ value: 10000 })] })
  const n = s.notices.find((x) => x.code === 'heating.estimate-complete') ?? assert.fail('keine Warnung')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /vollständige.*Ablesungen.*nicht ordnungsgemäß erfasst.*§ 9a.*insoweit falsch.*Entfernen Sie die Schätzung/s)
  assert.ok(!codes(s).includes('heating.estimated'))
  const self = selfOf(s)
  const c1 = self.units.find((u) => u.unitId === 'c')?.users[0] ?? assert.fail('C1')
  assert.equal(c1.heatingEstimated, true)
  assert.ok(Math.abs((c1.heatingConsumption ?? 0) - 6400) < 1e-6, String(c1.heatingConsumption))
  assert.equal(self.estimates?.[0]?.complete, true)
})

test('Ohne Schätzung kein Wert der Grenze im Rechtsstand und keine neuen Felder mit Inhalt', () => {
  const s = computeSettlement(base)
  assert.ok(!s.legalBasis.values?.some((v) => v.id === 'hkv.estimate-threshold'))
  const self = selfOf(s)
  assert.deepEqual([self.estimates, self.threshold], [[], null])
  assert.ok(self.pots.every((p) => !p.overThreshold && p.estimatedAreaM2 === 0))
  assert.ok(self.units.every((u) => u.users.every((x) => x.heatingEstimated === false && x.waterEstimated === false)))
})

test('Optionen für den Dialog: fehlender Endstand bei C mit Vorschlag Durchschnitt 12.000 kWh, Vorperiode gleich lang', () => {
  const s = run({ readings: OHNE_ENDE_C })
  const self = selfOf(s)
  const option = self.estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat') ?? assert.fail('keine Option C')
  assert.deepEqual([option.why, option.boundary, option.areaM2, option.estimated], ['noReading', '2025-12-31', 60, false])
  assert.deepEqual(option.proposals.find((p) => p.method === 'buildingAverage')?.value, 12000)
  assert.deepEqual(option.comparable.map((c) => [c.unitId, c.value]), [['a', 12000], ['b', 12000]])
  // Die Vorperiode 2024 hat keinen Anfangsstand: kein Vorschlag aus ihr.
  assert.equal(option.proposals.find((p) => p.method === 'previousPeriod')?.why, 'noPrevious')
  const a = self.estimateOptions?.find((o) => o.unitId === 'a' && o.part === 'heat') ?? assert.fail('keine Option A')
  assert.equal(a.why, null)
  // Mit Ständen am 31.12.2023 rechnet Mietfuchs die Vorperiode: C hatte 2024 400 kWh.
  const mitVorjahr = run({ readings: [...OHNE_ENDE_C, selfReading('wz-c', '2023-12-31', 100)] })
  const prev = selfOf(mitVorjahr).estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat')?.proposals.find((p) => p.method === 'previousPeriod')
  assert.deepEqual(prev, { method: 'previousPeriod', value: 400, perM2: null, why: 'ok' })
  // Die Vorperiode steht nicht im Rechtsstand dieser Abrechnung.
  assert.deepEqual(mitVorjahr.legalBasis.values?.map((v) => v.id), run({ readings: OHNE_ENDE_C }).legalBasis.values?.map((v) => v.id))
})

test('Leerstand und Eigennutzung: der geschätzte Anteil der Zeit ohne Mieter bleibt beim Vermieter, Σ Zeilen = Σ Positionen', () => {
  const snap = selfSnapshot({
    readings: OHNE_ENDE_C,
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', '2025-09-30')],
    estimates: [estimate()],
  })
  const s = computeSettlement(snap)
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(sum(s), positions(snap))
  assert.match(textOf(s, 'heating.estimated'), /Mieter C1 behält seinen abgelesenen Verbrauch.*für Leerstand \(Vermieter\) gilt der Anteil/s)
  const leer = selfOf(s).units.find((u) => u.unitId === 'c')?.users.find((u) => u.role === 'vacancy') ?? assert.fail('kein Leerstand')
  assert.ok(leer.heatingEstimated === true && Math.abs((leer.heatingConsumption ?? 0) - 4320) < 1e-9)
})

test('Heizkostenverteiler mit Wechsel vom Wärmezähler am 30.06.: mit Schätzung nach § 9a nicht mehr gemischt, sondern verteilt (Meldung aus PR 12 eingelöst)', () => {
  const hkv = (u: string) => selfMeter(`hk-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'product' })
  const xw = (u: string) => selfMeter(`xw-${u}`, u, `WW ${u}`, 'warmwasser')
  const dhw = selfMeter('ww', null, 'Speicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' })
  const water: Reading[] = [
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-12-31', 9000),
  ]
  const hkR = (u: string, e: number, c?: number) => [selfReading(`hk-${u}`, '2024-12-31', 0), ...(c !== undefined ? [selfReading(`hk-${u}`, '2025-09-30', c)] : []), selfReading(`hk-${u}`, '2025-12-31', e)]
  const capture: CaptureMethod = 'hca'
  const mid = [selfReading('hk-a', '2025-06-30', 0), selfReading('hk-a', '2025-12-31', 600), ...hkR('b', 1600), ...hkR('c', 1200, 720), selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-06-30', 6000)]
  const o: SelfSnapshotOptions = {
    plant: { capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' }] },
    meters: [hkv('a'), hkv('b'), hkv('c'), selfMeter('wz-a', 'a', 'WZ a', 'waerme'), dhw, xw('a'), xw('b'), xw('c')],
    readings: [...water, ...mid],
  }
  const ohne = run(o)
  assert.match(textOf(ohne, 'heating.mixed-capture'), /Bei A wechselt das Gerät.*„Schätzung \(§ 9a\)“.*in Einheiten/s)
  const snap = selfSnapshot({ ...o, estimates: [estimate({ unitId: 'a', value: 1200, reason: 'Wechsel des Geräts zum 30.06., kein Stand des neuen Geräts zu Beginn' })] })
  const s = computeSettlement(snap)
  assert.ok(!codes(s).includes('heating.mixed-capture'), codes(s).join(', '))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(selfOf(s).units.find((u) => u.unitId === 'a')?.users[0]?.heatingConsumption, 1200)
  assert.equal(sum(s), positions(snap))
})

test('Kesseltausch: eine Schätzung an der alten Anlage gilt auch für die neue (Linie), Σ Zeilen = Σ Positionen', () => {
  const item = (id: string, plant: string, amountCents: number, heatingPart: HeatingPart, extra: Partial<CostItem> = {}): CostItem => ({
    id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem', heatingPlantId: plant, heatingPart, heatingTarget: 'both', ...extra,
  })
  const hp2: HeatingPlant = { ...(base.heatingPlants?.[0] as HeatingPlant), id: 'hp2', name: 'neu', replacesPlantId: 'hp' }
  const readings = [
    selfReading('wz-a', '2024-12-31', 1000), selfReading('wz-a', '2025-12-31', 13000),
    selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 16000),
    selfReading('wz-c', '2024-12-31', 500), selfReading('wz-c', '2025-09-30', 7700),
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-06-30', 4500), selfReading('ww', '2025-12-31', 9000),
  ]
  const snap = selfSnapshot({
    plant: { name: 'alt', endsOn: '2025-06-30' },
    plants: [hp2],
    rows: [selfRow({}, 2025, 'hp2')],
    deliveries: [
      selfDelivery({ id: 'd1', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', energyKwh: 30000 }),
      selfDelivery({ id: 'd2', plantId: 'hp2', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', energyKwh: 30000 }),
    ],
    costItems: [item('gas1', 'hp', 300000, 'fuel', { fuelDeliveryId: 'd1' }), item('gas2', 'hp2', 300000, 'fuel', { fuelDeliveryId: 'd2' })],
    readings,
    estimates: [estimate()],
  })
  const s = computeSettlement(snap)
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  for (const plantId of ['hp', 'hp2']) {
    const self = selfOf(s, plantId)
    assert.equal(self.ok, true, plantId)
    assert.deepEqual(self.estimates?.map((e) => [e.plantId, e.unitId]), [['hp', 'c']], plantId)
    assert.equal(self.pots.find((p) => p.pot === 'heating')?.overThreshold, true, plantId)
  }
  assert.equal(sum(s), positions(snap))
})
