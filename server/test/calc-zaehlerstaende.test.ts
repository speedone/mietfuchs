// Zählerstände in Abrechnung und Cockpit (Systemprüfung): negativer Verbrauch im Verteilschlüssel, Deckung des
// Zeitraums je Zähler, Ablesung mit Datum in der Zukunft, Zähler vorhanden, aber im Zeitraum nicht abgelesen.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, consumptionOverview, type ComputedSettlement, type ConsumptionOverviewRow } from '../src/calc.ts'
import { blockingErrors } from '../../shared/notices.ts'
import type { Notice } from '../../shared/types.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string): SnapshotUnit => ({ id, name: `Wohnung ${id.toUpperCase()}`, areaM2: 50, participates: true })
const meter = (id: string, unitId: string | null): SnapshotMeter => ({ id, unitId, type: 'kaltwasser', name: `Wasser ${id}` })
const year = (meterId: string, from: number, to: number): SnapshotReading[] => [
  { meterId, date: '2024-12-31', value: from }, { meterId, date: '2025-12-31', value: to },
]
const wasser: SnapshotCostItem = { id: 'w', period: calendarPeriod(2025), category: 'Wasser', description: 'Wasser', amountCents: 90000, key: 'meter', meterType: 'kaltwasser' }
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [unit('a'), unit('b'), unit('c')],
  tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
  costItems: [wasser],
  meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c')],
  readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>, asOf = '2026-03-01'): ComputedSettlement => computeSettlement(snapshotOf(source(s), 2025), { asOf })
const overview = (s: Partial<SnapshotSource>, y = 2025, asOf = '2026-03-01'): ConsumptionOverviewRow[] => consumptionOverview(snapshotOf(source(s), y), { asOf })
const share = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents
const notice = (s: { notices: Notice[] }, code: string): Notice[] => s.notices.filter((n) => n.code === code)
const row = (rows: ConsumptionOverviewRow[], id: string): ConsumptionOverviewRow => rows.find((r) => r.meterId === id) ?? assert.fail(`Zähler ${id} fehlt in der Übersicht`)

// ---------- 1. Negativer Verbrauch im Verteilschlüssel ----------

test('Negativer Verbrauch im Schlüssel: Fehler an der Abrechnung, die Position wird nicht verteilt', () => {
  const s = settle({ readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 250)] })
  const [n, ...more] = notice(s, 'meter.negative-in-key')
  assert.ok(n, 'kein Hinweis meter.negative-in-key')
  assert.equal(more.length, 0)
  assert.equal(n.level, 'error')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'zc' })
  assert.match(n.text, /„Wasser“/)
  assert.match(n.text, /Wasser zc/)
  // Sichert das Abschließen ab (#319) und setzt „Entwurf, nicht versenden“.
  assert.deepEqual(blockingErrors(s.notices).map((x) => x.code), ['meter.negative-in-key'])
  // Kein Mieter bekommt einen negativen Anteil, keiner trägt mehr als die Rechnung: Der Vermieter trägt sichtbar.
  for (const st of s.statements) assert.equal(st.totalShareCents, 0, st.tenancyId)
  assert.equal(s.landlord.totalCents, 90000)
  assert.deepEqual(s.warnings, s.notices.map((x) => x.text))
})

test('Negativer Verbrauch: ein Rücksprung mitten im Zeitraum zählt auch bei positiver Jahressumme', () => {
  const s = settle({ readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), { meterId: 'zc', date: '2025-06-30', value: 900 }] })
  assert.equal(notice(s, 'meter.negative-in-key').length, 1)
})

test('Negativer Verbrauch vor dem Zeitraum oder an einem Zähler anderer Sparte: kein Fehler, verteilt wie bisher', () => {
  const s = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c'), { id: 'strom', unitId: 'a', type: 'strom' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), { meterId: 'zc', date: '2023-12-31', value: 400 }, ...year('strom', 500, 100)],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key'), [])
  assert.deepEqual([share(s, 't-a'), share(s, 't-b'), share(s, 't-c')], [30000, 30000, 30000])
})

test('Negativer Verbrauch am Hauptzähler, der die Basis wäre: Fehler statt stillem Rückfall', () => {
  const s = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('haupt', 5000, 4000)],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key').map((n) => n.subject), [{ kind: 'meter', id: 'haupt' }])
  assert.equal(s.landlord.totalCents, 90000)
})

test('Negativer Verbrauch am Bezugszähler mit verteiltem Rest: Fehler, nicht verteilt', () => {
  const s = settle({
    costItems: [{ ...wasser, meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [] } }],
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 250), ...year('haupt', 1000, 1200)],
  })
  assert.equal(notice(s, 'meter.negative-in-key').length, 1)
  assert.equal(s.landlord.totalCents, 90000)
})

// ---------- 2. Deckung des Zeitraums je Zähler ----------

test('Übersicht: ab dem zweiten Jahr ohne Endstand ist der Zeitraum nicht gedeckt, readingCount zählt weiter alle', () => {
  const readings = [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350)]
  for (const r of overview({ readings })) assert.equal(r.periodCovered, true, r.meterId)
  const next = overview({ readings }, 2026)
  for (const r of next) {
    assert.equal(r.readingCount, 2, r.meterId)
    assert.equal(r.periodCovered, false, r.meterId)
  }
  // Nur der Anfangsstand und eine Ablesung mitten im Jahr: Das Ende fehlt.
  assert.equal(row(overview({ readings: [...readings, { meterId: 'za', date: '2026-06-30', value: 170 }] }, 2026), 'za').periodCovered, false)
})

test('Übersicht: ein im Zeitraum eingebauter Zähler ist ab seiner ersten Ablesung gedeckt', () => {
  const readings: SnapshotReading[] = [{ meterId: 'za', date: '2025-07-01', value: 0 }, { meterId: 'za', date: '2025-12-31', value: 20 }]
  assert.equal(row(overview({ readings }), 'za').periodCovered, true)
  // Nur der Einbaustand: Das Ende fehlt.
  assert.equal(row(overview({ readings: readings.slice(0, 1) }), 'za').periodCovered, false)
  // Erst nach dem Zeitraum eingebaut: Für diesen Zeitraum fehlt nichts.
  assert.equal(row(overview({ readings }, 2024), 'za').periodCovered, true)
  // Ohne jede Ablesung fehlt alles.
  assert.equal(row(overview({ readings }), 'zb').periodCovered, false)
})

test('Übersicht: Zählerwechsel mit Endstand deckt, ohne Endstand nicht', () => {
  const swap = (oldEndValue?: number): SnapshotReading[] => [
    { meterId: 'za', date: '2024-12-31', value: 900 },
    { meterId: 'za', date: '2025-06-30', value: 0, replacement: true, ...(oldEndValue === undefined ? {} : { oldEndValue }) },
    { meterId: 'za', date: '2025-12-31', value: 30 },
  ]
  assert.equal(row(overview({ readings: swap(950) }), 'za').periodCovered, true)
  assert.equal(row(overview({ readings: swap() }), 'za').periodCovered, false)
})

test('Übersicht: ein als neuer Zähler angelegter Tausch, der alte endet mit seiner letzten Ablesung', () => {
  const s: Partial<SnapshotSource> = {
    meters: [meter('alt', 'a'), meter('neu', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [
      { meterId: 'alt', date: '2024-12-31', value: 900 }, { meterId: 'alt', date: '2025-06-30', value: 950 },
      { meterId: 'neu', date: '2025-06-30', value: 0 }, { meterId: 'neu', date: '2025-12-31', value: 30 },
      { meterId: 'haupt', date: '2024-12-31', value: 0 }, { meterId: 'haupt', date: '2025-09-30', value: 400 },
    ],
  }
  const rows = overview(s)
  assert.equal(row(rows, 'alt').periodCovered, true)
  assert.equal(row(rows, 'neu').periodCovered, true)
  // Der Hauptzähler hat keinen Nachfolger: Ihm fehlt das Ende.
  assert.equal(row(rows, 'haupt').periodCovered, false)
  // Im Folgejahr ist der alte Geschichte, dem neuen fehlt der Endstand.
  const next = overview(s, 2026)
  assert.equal(row(next, 'alt').periodCovered, true)
  assert.equal(row(next, 'neu').periodCovered, false)
})

// ---------- 3. Ablesung mit Datum in der Zukunft ----------

const zukunft = (): Partial<SnapshotSource> => ({
  readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2052-12-31', value: 350 }],
})

test('Ablesung in der Zukunft: Warnung in der Übersicht am Zähler, mit Datum', () => {
  const rows = overview(zukunft())
  const [n] = notice(row(rows, 'zc'), 'meter.reading-future')
  assert.ok(n, 'kein Hinweis meter.reading-future')
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'zc' })
  assert.match(n.text, /31\.12\.2052/)
  assert.ok(row(rows, 'zc').warnings.includes(n.text))
  assert.deepEqual(notice(row(rows, 'za'), 'meter.reading-future'), [])
})

test('Ablesung in der Zukunft: Warnung an der Abrechnung, wenn der Verbrauch des Zeitraums an ihr hängt', () => {
  const s = settle(zukunft())
  const [n, ...more] = notice(s, 'meter.reading-future')
  assert.ok(n, 'kein Hinweis meter.reading-future')
  assert.equal(more.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'zc' })
  assert.match(n.text, /„Wasser“/)
  assert.match(n.text, /31\.12\.2052/)
})

test('Ablesung in der Zukunft: ohne Stichtag, mit Ablesung bis heute oder ohne Wirkung auf den Zeitraum kein Hinweis', () => {
  // Ohne Stichtag weiß die Berechnung nicht, was Zukunft ist.
  assert.deepEqual(notice(computeSettlement(snapshotOf(source(zukunft()), 2025)), 'meter.reading-future'), [])
  for (const r of consumptionOverview(snapshotOf(source(zukunft()), 2025))) assert.deepEqual(notice(r, 'meter.reading-future'), [], r.meterId)
  // Der Versorger liest im Februar ab: Das ist Interpolation wie bisher, kein Fehler.
  const spaet = { readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2026-02-15', value: 350 }] }
  assert.deepEqual(notice(settle(spaet), 'meter.reading-future'), [])
  assert.deepEqual(notice(row(overview(spaet), 'zc'), 'meter.reading-future'), [])
  // Der Endstand des Zeitraums ist abgelesen; die Ablesung in der Zukunft dahinter benutzt der Zeitraum nicht.
  const dahinter = { readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), { meterId: 'zc', date: '2052-12-31', value: 900 }] }
  assert.deepEqual(notice(settle(dahinter), 'meter.reading-future'), [])
  assert.deepEqual(notice(row(overview(dahinter), 'zc'), 'meter.reading-future'), [])
})

// ---------- 4. Zähler vorhanden, aber im Zeitraum nicht abgelesen ----------

test('Zähler ohne Ablesung im Zeitraum: eigener Hinweis mit Ziel Zähler, nicht „Wohnung ohne Zähler“', () => {
  const s = settle({ readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }] })
  const [n, ...more] = notice(s, 'meter.unit-not-read')
  assert.ok(n, 'kein Hinweis meter.unit-not-read')
  assert.equal(more.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'zc' })
  assert.match(n.text, /Wohnung C/)
  assert.match(n.text, /Wasser zc/)
  assert.deepEqual(notice(s, 'meter.unit-without-meter'), [])
  // Die Zahlen bleiben, wie sie waren: Die übrigen tragen mit.
  assert.deepEqual([share(s, 't-a'), share(s, 't-b'), share(s, 't-c')], [45000, 45000, 0])
})

test('Wohnung ganz ohne Zähler: Wortlaut und Ziel wie bisher, auch neben einer nicht abgelesenen', () => {
  const ohne = settle({ meters: [meter('za', 'a'), meter('zb', 'b')], readings: [...year('za', 100, 150), ...year('zb', 200, 250)] })
  const text = '„Wasser“: für Wohnung C gibt es keinen abgelesenen Zähler „Kaltwasser“ - ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen Wohnungen mitgetragen. Mit einem Hauptzähler (Zähler ohne Wohnung) gilt für sie der Rest des Hauptzählers. Hat eine dieser Einheiten keinen eigenen Anschluss (etwa eine Garage), entfernen Sie in den Stammdaten der Einheit unter „Weitere Angaben - Anschlüsse“ das Häkchen dieser Zählerart.'
  assert.deepEqual(notice(ohne, 'meter.unit-without-meter').map((n) => [n.text, n.subject]), [[text, { kind: 'unit', id: 'c' }]])
  assert.deepEqual(notice(ohne, 'meter.unit-not-read'), [])
  const beides = settle({ meters: [meter('za', 'a'), meter('zb', 'b')], readings: [...year('za', 100, 150), { meterId: 'zb', date: '2024-12-31', value: 200 }] })
  assert.deepEqual(notice(beides, 'meter.unit-without-meter').map((n) => n.text), [text])
  assert.deepEqual(notice(beides, 'meter.unit-not-read').map((n) => n.subject), [{ kind: 'meter', id: 'zb' }])
})

test('Kein Zähler im Zeitraum abgelesen: „Kein Verbrauch erfasst“ bleibt, dazu der Hinweis mit Ziel Zähler', () => {
  const s = settle({ readings: [{ meterId: 'za', date: '2024-12-31', value: 100 }, { meterId: 'zb', date: '2024-12-31', value: 200 }] })
  assert.deepEqual(notice(s, 'meter.no-consumption').map((n) => n.text), ['„Wasser“: kein Verbrauch für Zählertyp „Kaltwasser“ erfasst - Betrag geht an den Vermieter.'])
  assert.deepEqual(notice(s, 'meter.unit-not-read').map((n) => n.subject), [{ kind: 'meter', id: 'za' }])
  // Ganz ohne Zähler bleibt es bei dem einen Hinweis.
  const ohne = settle({ meters: [] })
  assert.equal(notice(ohne, 'meter.no-consumption').length, 1)
  assert.deepEqual(notice(ohne, 'meter.unit-not-read'), [])
})
