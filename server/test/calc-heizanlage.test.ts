// Die Heizanlage in der Berechnung (Heizung PR 4). Eine Anlage ändert in dieser Version keine Zahl
// (Entwurf 11.2, A2); neu gerechnet werden nur zwei Dinge, und beide greifen erst mit Angaben, die
// es vorher nicht gab: Zähler der Anlage sind keine Hauptzähler des Hauses, und Warmwasserzähler
// zählen beim Kaltwasser mit (G-B8). Weiter unten: Fernablesbarkeit (#214) und Zweifamilienhaus (#180).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import {
  snapshotOf, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotMeter, type SnapshotReading, type SnapshotSource,
  type SnapshotTenancy, type SnapshotUnit,
} from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'

const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const item = (id: string, year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, period: calendarPeriod(year), category: 'Wasserversorgung', description: id, amountCents: 200000, key: 'area', ...over,
})
const meter = (id: string, unitId: string | null, type: SnapshotMeter['type'], over: Partial<SnapshotMeter> = {}): SnapshotMeter => ({ id, unitId, type, ...over })
// Ein Zähler über das ganze Jahr: Stand am 31.12. des Vorjahres und am 31.12.
const wholeYear = (meterId: string, y: number, from: number, to: number): SnapshotReading[] => [
  { meterId, date: `${y - 1}-12-31`, value: from },
  { meterId, date: `${y}-12-31`, value: to },
]
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>, y = 2025, plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement({ ...snapshotOf(source(s), y), ...(plants === undefined ? {} : { heatingPlants: plants }) })
const share = (r: ComputedSettlement, tenancyId: string, itemId: string): number | undefined =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp1', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})

// ---------- Wasserschlüssel (G-B8) ----------

test('Wasser (G-B8): Warmwasserzähler zählen beim Kaltwasser mit; nur mit Warmwasserzähler gilt der Hauptzähler', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('haus', null, 'kaltwasser'), meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('haus', 2025, 0, 200), ...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' })],
  })
  // b hat keinen Kaltwasserzähler, also ist der Hauptzähler die Basis (200 m³): a trägt 80 m³ (kalt
  // und warm), b seine 30 m³ Warmwasser, die übrigen 90 m³ bleiben beim Vermieter (#116). Vorher
  // trug a nur seine 60 m³ Kaltwasser, und die 20 m³ Warmwasser landeten beim Vermieter.
  assert.equal(share(r, 'ta', 'wasser'), 80000)
  assert.equal(share(r, 'tb', 'wasser'), 30000)
  assert.ok(r.notices.some((n) => n.code === 'meter.unit-without-meter' && n.text.includes('für b gibt es keinen abgelesenen Zähler „Kaltwasser“')))
})

test('Wasser (G-B8): ohne Hauptzähler ist die Basis kalt und warm zusammen; der Schlüssel Warmwasser nur warm', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-kalt', 'b', 'kaltwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-kalt', 2025, 0, 30), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [
      item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' }),
      item('warm', 2025, { amountCents: 60000, key: 'meter', meterType: 'warmwasser' }),
    ],
  })
  // 80 und 60 von 140 m³: 114.285,71 und 85.714,29 Cent, der Restcent geht an den größeren Rest.
  // Vorher 60 und 30 von 90 m³: 133.333 und 66.667 Cent.
  assert.equal(share(r, 'ta', 'wasser'), 114286)
  assert.equal(share(r, 'tb', 'wasser'), 85714)
  assert.equal(share(r, 'ta', 'warm'), 24000)
  assert.equal(share(r, 'tb', 'warm'), 36000)
})

// ---------- Zähler der Anlage ----------

test('Ein Zähler der Heizanlage ist kein Hauptzähler des Hauses', () => {
  const ohne: Partial<SnapshotSource> = {
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-waerme', 'a', 'waerme')],
    readings: wholeYear('a-waerme', 2025, 0, 1000),
    costItems: [item('heizung', 2025, { category: HEATING_CATEGORY, amountCents: 100000, key: 'meter', meterType: 'waerme' })],
  }
  const mit: Partial<SnapshotSource> = {
    ...ohne,
    meters: [...(ohne.meters ?? []), meter('speicher', null, 'waerme', { heatingPlantId: 'hp1', heatingRole: 'dhwHeat' })],
    readings: [...(ohne.readings ?? []), ...wholeYear('speicher', 2025, 0, 5000)],
  }
  // Als Hauptzähler gelesen, trüge a nur 1.000 von 5.000 kWh, also 200 €, und 800 € blieben beim
  // Vermieter.
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), 100000)
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), share(settle(ohne), 'ta', 'heizung'))
})

// ---------- Anlegen ändert keine Zahl (Entwurf 11.2, A2, 12.3 Nr. 12) ----------

test('Anlage mit Vorgaben: jede Abrechnung bleibt gleich, über das ganze Ergebnis', () => {
  for (const y of [2025, 2027]) {
    const s: Partial<SnapshotSource> = {
      units: [
        unit('a', { areaM2: 60 }), unit('b', { areaM2: 40 }),
        unit('c', { participates: false, selfUsed: true, selfPersons: 2, areaM2: 80 }),
        unit('garage', { areaM2: 0, noConnection: ['waerme'] }),
      ],
      tenancies: [
        tenancy('ta1', 'a', { end: `${y}-04-30` }),
        tenancy('ta2', 'a', { start: `${y}-06-01` }),
        tenancy('tb', 'b', { heatingModel: 'flatRate' }),
      ],
      meters: [meter('a-waerme', 'a', 'waerme'), meter('b-waerme', 'b', 'waerme'), meter('c-waerme', 'c', 'waerme')],
      readings: [...wholeYear('a-waerme', y, 0, 4000), ...wholeYear('b-waerme', y, 0, 2500), ...wholeYear('c-waerme', y, 0, 3000)],
      costItems: [
        item('verbrauch', y, { category: HEATING_CATEGORY, amountCents: 700000, key: 'meter', meterType: 'waerme' }),
        item('grund', y, { category: HEATING_CATEGORY, amountCents: 300000, key: 'area' }),
        item('messdienst', y, { category: HEATING_CATEGORY, amountCents: 50000, key: 'amounts', tenancyAmounts: { ta1: 10000, ta2: 12000, tb: 15000 } }),
        item('wartung', y, { category: HEATING_CATEGORY, amountCents: 20000, key: 'direct', directUnitId: 'a' }),
        item('grundsteuer', y, { category: 'Grundsteuer', amountCents: 90000, key: 'area' }),
      ],
    }
    const ohne = settle(s, y)
    const anlagen = [plant(), plant({ method: 'service' }), plant({ method: 'service', source: 'homeowners' }), plant({ units: [{ unitId: 'a', heatedAreaM2: null }] })]
    for (const p of anlagen) assert.deepEqual(settle(s, y, [p]), ohne, `${y}: ${JSON.stringify(p)}`)
    assert.deepEqual(settle(s, y, []), ohne, `${y}: leere Liste`)
  }
})

// ---------- Fernablesbarkeit (#214, Entwurf 3.13, 6.5, 10.1) ----------

const heizBestand = (y: number, meters: SnapshotMeter[] = []): Partial<SnapshotSource> => ({
  units: [unit('a'), unit('b')],
  tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
  meters,
  costItems: [item('heizung', y, { category: HEATING_CATEGORY, amountCents: 100000, key: 'amounts', tenancyAmounts: { ta: 60000, tb: 40000 } })],
})
const remoteNotices = (r: ComputedSettlement) => r.notices.filter((n) => n.code.startsWith('heating.remote-reading'))

test('R-A1: Gerät eingebaut 15.12.2021, nicht fernablesbar, 2025: die Kürzung je Mieter beziffert', () => {
  const hkvA = meter('hkv-a', 'a', 'hkv', { name: 'HKV Wohnzimmer', remoteReadable: false, installedOn: '2021-12-15' })
  const r = settle(heizBestand(2025, [hkvA]), 2025, [plant({ method: 'service' })])
  const [n, ...weitere] = remoteNotices(r)
  assert.equal(weitere.length, 0)
  assert.equal(n?.code, 'heating.remote-reading-missing')
  assert.equal(n?.level, 'warning')
  assert.deepEqual(n?.subject, { kind: 'meter', id: 'hkv-a' })
  assert.match(n?.text ?? '', /„HKV Wohnzimmer“/)
  assert.match(n?.text ?? '', /nach dem 01\.12\.2021/)
  assert.match(n?.text ?? '', /um 3 % kürzen/)
  // 3 % der gedruckten Heizzeilen (Entwurf 6.5): 600,00 € und 400,00 €.
  assert.match(n?.text ?? '', /ta \(a\) 18,00 €/)
  assert.match(n?.text ?? '', /tb \(b\) 12,00 €/)
  assert.ok(r.legalBasis.values.some((v) => v.id === 'hkv.remote-reading.new-devices'))
  assert.ok(r.legalBasis.values.some((v) => v.id === 'hkv.cut.remote-reading'))
  // Ohne Anlage kennt Mietfuchs die Geräte nicht, und vor 2027 gibt es dann keinen Hinweis; so
  // rechnete auch die erste Fassung des Entwurfs.
  assert.deepEqual(remoteNotices(settle(heizBestand(2025, [hkvA]))), [])
})

test('Einbaudatum unbekannt: ein Hinweis mit „bis zu“, der die Ampel nicht färbt', () => {
  const r = settle(heizBestand(2025, [meter('hkv-a', 'a', 'hkv', { name: 'HKV', remoteReadable: false })]), 2025, [plant()])
  const [n] = remoteNotices(r)
  assert.equal(n?.code, 'heating.remote-reading')
  assert.equal(n?.level, 'hint')
  assert.match(n?.text ?? '', /um bis zu 3 % kürzen/)
  assert.match(n?.text ?? '', /ta \(a\) 18,00 €/)
})

test('Angabe an der Anlage: keine Geräte fernablesbar, einige nach 2021 eingebaut', () => {
  // Vor 2027 nur „bis zu“: Ein neues Gerät kann ein einzelner Ersatz in einem nicht fernablesbaren
  // System sein (§ 5 Abs. 2 Satz 4 HeizkostenV), dann gilt die Frist bis 31.12.2026 (Durchsicht von #230).
  const anlage = plant({ method: 'service', devicesRemote: 'none', devicesInstalledAfter2021: 'some' })
  const [n] = remoteNotices(settle(heizBestand(2025), 2025, [anlage]))
  assert.equal(n?.code, 'heating.remote-reading')
  assert.equal(n?.level, 'hint')
  assert.match(n?.text ?? '', /Laut Ihrer Angabe an der Heizanlage/)
  assert.match(n?.text ?? '', /um bis zu 3 % kürzen/)
  assert.equal(n?.subject, undefined)
  const [spaeter] = remoteNotices(settle(heizBestand(2027), 2027, [anlage]))
  assert.equal(spaeter?.code, 'heating.remote-reading-missing')
})

test('Ersatz eines einzelnen Geräts in einem nicht fernablesbaren System: vor 2027 nur „bis zu“', () => {
  const neu = meter('hkv-a', 'a', 'hkv', { name: 'HKV neu', remoteReadable: false, installedOn: '2023-05-01' })
  const alt = meter('hkv-b', 'b', 'hkv', { name: 'HKV alt', remoteReadable: false, installedOn: '2015-01-01' })
  const [n] = remoteNotices(settle(heizBestand(2025, [neu, alt]), 2025, [plant()]))
  assert.equal(n?.code, 'heating.remote-reading')
  assert.match(n?.text ?? '', /um bis zu 3 % kürzen/)
})

test('Die Kürzung steht nur bei Mietern in Wohnungen an der Anlage', () => {
  const [n] = remoteNotices(settle(heizBestand(2027), 2027, [plant({ devicesRemote: 'none', units: [{ unitId: 'a', heatedAreaM2: null }] })]))
  assert.equal(n?.code, 'heating.remote-reading-missing')
  assert.match(n?.text ?? '', /ta \(a\) 18,00 €/)
  assert.doesNotMatch(n?.text ?? '', /tb \(b\)/)
})

test('Alle Geräte fernablesbar laut Anlage: kein Hinweis, auch ab 2027', () => {
  assert.deepEqual(remoteNotices(settle(heizBestand(2027), 2027, [plant({ devicesRemote: 'all' })])), [])
})

test('Ohne Anlage und mit unbekannter Angabe: der Hinweis aus PR 1, wortgleich', () => {
  const ohne = remoteNotices(settle(heizBestand(2027), 2027))
  assert.equal(ohne.length, 1)
  assert.equal(ohne[0]?.code, 'heating.remote-reading')
  assert.deepEqual(remoteNotices(settle(heizBestand(2027), 2027, [plant()])), ohne)
  assert.deepEqual(remoteNotices(settle(heizBestand(2026), 2026)), [])
})

// ---------- Zweifamilienhaus (#180, Entwurf 8.9) ----------

const zfh = (units: SnapshotUnit[], withHeating = true): ComputedSettlement => computeSettlement({
  ...snapshotOf(source({
    units,
    tenancies: units.filter((u) => u.participates).map((u) => tenancy(`t-${u.id}`, u.id)),
    costItems: withHeating ? [item('heizung', 2025, { category: HEATING_CATEGORY, amountCents: 100000, key: 'area' })] : [],
  }), 2025),
  property: { kind: 'zfh', cableBuiltBeforeDec2021: null },
})
const kindNotices = (r: ComputedSettlement) => r.notices.filter((n) => n.code === 'property.kind-mismatch')

test('Zweifamilienhaus: passt die Objektart nicht zu den Wohnungen, gibt es einen Hinweis', () => {
  const drei = [unit('eg'), unit('og'), unit('dg')]
  const [n] = kindNotices(zfh(drei))
  assert.equal(n?.level, 'hint')
  assert.match(n?.text ?? '', /höchstens zwei Wohnungen/)
  // Eine selbst bewohnte und eine vermietete Wohnung: Die Ausnahme kann gelten, kein Hinweis.
  assert.deepEqual(kindNotices(zfh([unit('eg', { participates: false, selfUsed: true, selfPersons: 2 }), unit('og')])), [])
  // Ohne Heizkosten spielt die Ausnahme keine Rolle.
  assert.deepEqual(kindNotices(zfh(drei, false)), [])
  // Ein Mehrfamilienhaus bekommt den Hinweis nie.
  const mfh = computeSettlement({ ...snapshotOf(source({ units: drei, costItems: [item('heizung', 2025, { category: HEATING_CATEGORY, key: 'area' })] }), 2025), property: { kind: 'mfh', cableBuiltBeforeDec2021: null } })
  assert.deepEqual(kindNotices(mfh), [])
})

test('Angaben zur Fernablesbarkeit vor der Anlage: Mit der Anlage ändern sich Hinweise, nie Beträge (Durchsicht von #230)', () => {
  const geraet = meter('hkv-a', 'a', 'hkv', { name: 'HKV', remoteReadable: false, installedOn: '2023-05-01' })
  const ohne = settle(heizBestand(2025, [geraet]), 2025)
  const mit = settle(heizBestand(2025, [geraet]), 2025, [plant()])
  assert.notDeepEqual(remoteNotices(mit), remoteNotices(ohne), 'der Hinweis kommt mit der Anlage')
  const betraege = (r: ComputedSettlement) => [...r.statements.values()].map((st) => [st.tenancyId, st.rows.map((row) => row.shareCents), st.balanceCents])
  assert.deepEqual(betraege(mit), betraege(ohne))
  assert.equal(mit.totalCostsCents, ohne.totalCostsCents)
})

