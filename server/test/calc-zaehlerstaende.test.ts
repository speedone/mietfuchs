// Zählerstände in Abrechnung und Cockpit (Systemprüfung): negativer Verbrauch im Verteilschlüssel, Deckung des
// Zeitraums je Zähler, Ablesung mit Datum in der Zukunft, Zähler vorhanden, aber im Zeitraum nicht abgelesen.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, consumptionOverview, readingSlackDays, type ComputedSettlement, type ConsumptionOverviewRow } from '../src/calc.ts'
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

// Durchsicht (Sollte 5): Ein Rücksprung, der sich beim selben Empfänger ausgleicht, verschiebt kein Geld. Er bleibt die
// Warnung `meter.negative` der Verbrauchsübersicht, und die Abrechnung rechnet wie vorher.
test('Rücksprung mitten im Jahr bei ganzjährigem Mieter: kein Fehler, Zahlen wie bisher', () => {
  const s = settle({ readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2025-06-30', value: 330.4 }, { meterId: 'zc', date: '2025-12-31', value: 330 }] })
  assert.deepEqual(notice(s, 'meter.negative-in-key'), [])
  assert.deepEqual(s.notices.filter((n) => n.level === 'error'), [])
  // 50, 50 und 30 von 130 m³ aus 900 €.
  assert.deepEqual([share(s, 't-a'), share(s, 't-b'), share(s, 't-c')], [34616, 34615, 20769])
  assert.equal(s.landlord.totalCents, 0)
  const rows = overview({ readings: [{ meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2025-06-30', value: 330.4 }, { meterId: 'zc', date: '2025-12-31', value: 330 }] })
  assert.equal(notice(row(rows, 'zc'), 'meter.negative').length, 1)
})

test('Rücksprung mitten im Jahr bei Mieterwechsel: der Nachmieter bekäme negativen Verbrauch, Fehler', () => {
  const s = settle({
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), { ...tenancy('t-c', 'c'), end: '2025-06-30' }, { ...tenancy('t-c2', 'c'), start: '2025-07-01' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2025-06-30', value: 400 }, { meterId: 'zc', date: '2025-12-31', value: 350 }],
  })
  const [n, ...more] = notice(s, 'meter.negative-in-key')
  assert.ok(n, 'kein Hinweis meter.negative-in-key')
  assert.equal(more.length, 0)
  assert.match(n.text, /vom 01\.07\.2025 bis zum 31\.12\.2025 \(-50\)/)
  assert.equal(s.landlord.totalCents, 90000)
})

// Zweite Durchsicht (Sollte 2): Geprüft wird ungerundet. Zähler in MWh mit drei Nachkommastellen, 12,345 auf 12,344.
test('Kleiner Rücksprung über Mieterwechsel und Leerstand: Fehler, auch unter einem Tausendstel je Abschnitt', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-b', 'b'), { ...tenancy('t-a1', 'a'), end: '2025-04-30' }, { ...tenancy('t-a2', 'a'), start: '2025-09-01' }],
    meters: [meter('za', 'a'), meter('zb', 'b')],
    readings: [...year('za', 12.345, 12.344), ...year('zb', 200, 200.004)],
  })
  assert.equal(notice(s, 'meter.negative-in-key').length, 1)
  for (const st of s.statements) assert.equal(st.totalShareCents, 0, st.tenancyId)
})

// Zweite Durchsicht: Auf dem Abschnitt einer Überschneidung zweier Mietverhältnisse ist der Verbrauch für sich negativ,
// beide Mieter haben über ihre Zeit aber positiven Verbrauch. Der Fehler dort ist `tenancy.overlap`, nicht dieser.
test('Überschneidung zweier Mietverhältnisse: negativ nur im gemeinsamen Monat, beide Empfänger positiv, kein zweiter Fehler', () => {
  const s = settle({
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), { ...tenancy('t-c', 'c'), end: '2025-07-31' }, { ...tenancy('t-c2', 'c'), start: '2025-07-01' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250),
      { meterId: 'zc', date: '2024-12-31', value: 300 }, { meterId: 'zc', date: '2025-06-30', value: 330 }, { meterId: 'zc', date: '2025-07-31', value: 320 }, { meterId: 'zc', date: '2025-12-31', value: 370 }],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key'), [])
  assert.equal(notice(s, 'tenancy.overlap').length, 1)
})

test('Text des Fehlers: sagt nur, was am Zähler stimmt, auch wenn ein zweiter Zähler der Wohnung positiv ist', () => {
  const s = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c'), { id: 'ww', unitId: 'c', type: 'warmwasser', name: 'Warmwasser C' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), ...year('ww', 50, 47)],
  })
  const [n] = notice(s, 'meter.negative-in-key')
  assert.ok(n, 'kein Hinweis meter.negative-in-key')
  assert.match(n.text, /„Warmwasser C“ vom 01\.01\.2025 bis zum 31\.12\.2025 \(-3\)/)
  assert.doesNotMatch(n.text, /wäre negativ/)
})

test('Negativer Verbrauch vor dem Zeitraum oder an einem Zähler anderer Sparte: kein Fehler, verteilt wie bisher', () => {
  const s = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c'), { id: 'strom', unitId: 'a', type: 'strom' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), { meterId: 'zc', date: '2023-12-31', value: 400 }, ...year('strom', 500, 100)],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key'), [])
  assert.deepEqual([share(s, 't-a'), share(s, 't-b'), share(s, 't-c')], [30000, 30000, 30000])
})

// Durchsicht (Muss 1): Der Hauptzähler geht nur als Summe des Zeitraums in die Basis. Ein Rücksprung mittendrin (ein
// Schätzwert des Versorgers) verschiebt nichts; der Bestand rechnet wie vorher.
test('Hauptzähler mit Rücksprung mittendrin und positiver Summe: kein Fehler, Zahlen wie bisher', () => {
  const s = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250),
      { meterId: 'haupt', date: '2024-12-31', value: 5000 }, { meterId: 'haupt', date: '2025-06-30', value: 5100 }, { meterId: 'haupt', date: '2025-07-31', value: 5099 }, { meterId: 'haupt', date: '2025-12-31', value: 5200 }],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key'), [])
  assert.deepEqual([share(s, 't-a'), share(s, 't-b'), share(s, 't-c')], [22500, 22500, 0])
  assert.equal(s.landlord.totalCents, 45000)
})

test('Hauptzähler, der nicht Basis ist (kurz) oder im Zeitraum rückwärts läuft: löst nie den Fehler aus', () => {
  const kurz = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250),
      { meterId: 'haupt', date: '2024-06-30', value: 5000 }, { meterId: 'haupt', date: '2025-03-31', value: 4900 }, { meterId: 'haupt', date: '2025-09-30', value: 5100 }],
  })
  assert.deepEqual(notice(kurz, 'meter.negative-in-key'), [])
  assert.equal(notice(kurz, 'meter.main-partial').length, 1)
  assert.deepEqual([share(kurz, 't-a'), share(kurz, 't-b')], [45000, 45000])
  // Summe negativ: Der Hauptzähler wird nicht Basis (wie bisher mit Warnung), verteilt wird nach den Wohnungszählern.
  const negativ = settle({
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('haupt', 5000, 4000)],
  })
  assert.deepEqual(notice(negativ, 'meter.negative-in-key'), [])
  assert.equal(notice(negativ, 'meter.sub-exceeds-main').length, 1)
  assert.deepEqual([share(negativ, 't-a'), share(negativ, 't-b')], [45000, 45000])
})

test('Zwischenzähler mit negativer Summe: Fehler, denn sein Ziel bekäme einen negativen Betrag', () => {
  const s = settle({
    costItems: [{ ...wasser, meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [{ meterId: 'garten', target: { key: 'direct', unitIds: ['a'] } }] } }],
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('zc', 'c'), meter('haupt', null), { ...meter('garten', null), scope: 'common' }],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350), ...year('haupt', 1000, 1200), ...year('garten', 20, 10)],
  })
  assert.deepEqual(notice(s, 'meter.negative-in-key').map((n) => n.subject), [{ kind: 'meter', id: 'garten' }])
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

// Zweite Durchsicht (Sollte 3): Beide Enden gleich. Der Anfang ist nur dann später, wenn der Zähler nachweislich erst im
// Zeitraum eingebaut ist (`installedOn`, Nachfolger) oder vorher niemand in der Wohnung wohnte (wie `neededDays`).
test('Übersicht: der Anfang zählt wie das Ende, außer der Zähler ist nachweislich erst im Zeitraum eingebaut', () => {
  const readings: SnapshotReading[] = [{ meterId: 'za', date: '2025-06-30', value: 0 }, { meterId: 'za', date: '2025-12-31', value: 20 }]
  // Ganzjährig bewohnt, erste Ablesung am 30.06.: Die Wohnung zahlt ein halbes Jahr, das ist nicht gedeckt.
  const halb = row(overview({ readings }), 'za')
  assert.equal(halb.periodCovered, false)
  assert.deepEqual(halb.periodGap, { from: '2025-01-01', to: '2025-06-30' })
  // Mit Einbaudatum am Zähler ab dem Einbau.
  const eingebaut = overview({ meters: [{ ...meter('za', 'a'), installedOn: '2025-06-30' }], readings })
  assert.equal(row(eingebaut, 'za').periodCovered, true)
  // Erst nach dem Zeitraum eingebaut: Für diesen Zeitraum fehlt nichts.
  assert.equal(row(overview({ meters: [{ ...meter('za', 'a'), installedOn: '2025-06-30' }], readings }, 2024), 'za').periodCovered, true)
  // Ohne jede Ablesung fehlt alles.
  assert.deepEqual(row(overview({ readings }), 'zb').periodGap, { from: '2025-01-01', to: '2025-12-31' })
})

test('Übersicht: neu angelegter Bestand im ersten Jahr bleibt grün, wenn die Abrechnung ihn ohne Hinweis verteilt', () => {
  // Anfangsstand zum 01.01. statt zum 31.12.: ein Tag am Anfang, im Spielraum.
  const erster = row(overview({ readings: [{ meterId: 'za', date: '2025-01-01', value: 0 }, { meterId: 'za', date: '2025-12-31', value: 20 }] }), 'za')
  assert.equal(erster.periodCovered, true)
  assert.deepEqual(erster.periodSlack, [{ from: '2025-01-01', to: '2025-01-01' }])
  // Erstbezug am 01.05., Anfangsstand beim Einzug: Vorher wohnte niemand dort, die Abrechnung verlangt nichts.
  const einzug = (date: string) => row(overview({
    tenancies: [{ ...tenancy('t-a', 'a'), start: '2025-05-01' }],
    readings: [{ meterId: 'za', date, value: 0 }, { meterId: 'za', date: '2025-12-31', value: 20 }],
  }), 'za')
  assert.equal(einzug('2025-04-30').periodCovered, true)
  assert.deepEqual(einzug('2025-04-30').periodSlack, [])
  assert.equal(einzug('2025-05-01').periodCovered, true)
  assert.deepEqual(einzug('2025-06-30').periodGap, { from: '2025-05-01', to: '2025-06-30' })
})

test('Übersicht: der Hauptzähler hat an keinem Ende Spielraum, wie `meter.main-partial` in der Abrechnung', () => {
  const s: Partial<SnapshotSource> = {
    meters: [meter('za', 'a'), meter('zb', 'b'), meter('haupt', null)],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'haupt', date: '2025-01-02', value: 0 }, { meterId: 'haupt', date: '2025-12-31', value: 400 }],
  }
  assert.equal(notice(settle(s), 'meter.main-partial').length, 1)
  assert.deepEqual(row(overview(s), 'haupt').periodGap, { from: '2025-01-01', to: '2025-01-02' })
})

// Zweite Durchsicht (Sollte 4): Im kurzen Zeitraum wiegen 14 Tage zu schwer.
test('Spielraum am Rand: höchstens 14 Tage und höchstens rund 4 % der Tage des Zeitraums', () => {
  assert.equal(readingSlackDays(365), 14)
  assert.equal(readingSlackDays(366), 14)
  assert.equal(readingSlackDays(122), 4)
  assert.equal(readingSlackDays(31), 1)
  assert.equal(readingSlackDays(10), 0)
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

// Durchsicht (Sollte 3): Die Abrechnung rechnet mit einer Ablesung kurz vor dem Stichtag ohne Hinweis; das Cockpit
// verlangt dann nichts, was der Vermieter nicht erfüllen kann.
test('Übersicht: Ablesung wenige Tage vor dem Ende des Zeitraums deckt, eine Lücke darüber nennt ihre Tage', () => {
  const dez = (day: string): SnapshotReading[] => [{ meterId: 'za', date: '2024-12-28', value: 0 }, { meterId: 'za', date: `2025-${day}`, value: 50 }]
  assert.equal(row(overview({ readings: dez('12-28') }), 'za').periodCovered, true)
  assert.equal(row(overview({ readings: dez('12-28') }), 'za').periodGap, null)
  // Was im Spielraum fehlt, steht dabei (das Cockpit nennt es als ruhigen Zusatz); Anfang und Ende teilen ihn.
  assert.deepEqual(row(overview({ readings: dez('12-28') }), 'za').periodSlack, [{ from: '2025-12-29', to: '2025-12-31' }])
  assert.deepEqual(row(overview({ readings: [{ meterId: 'za', date: '2025-01-08', value: 0 }, { meterId: 'za', date: '2025-12-25', value: 50 }] }), 'za').periodSlack,
    [{ from: '2025-01-01', to: '2025-01-08' }, { from: '2025-12-26', to: '2025-12-31' }])
  assert.equal(row(overview({ readings: [{ meterId: 'za', date: '2025-01-08', value: 0 }, { meterId: 'za', date: '2025-12-24', value: 50 }] }), 'za').periodCovered, false)
  assert.equal(row(overview({ readings: dez('12-17') }), 'za').periodCovered, true)
  const frueh = row(overview({ readings: dez('12-16') }), 'za')
  assert.equal(frueh.periodCovered, false)
  assert.deepEqual(frueh.periodGap, { from: '2025-12-17', to: '2025-12-31' })
  // Ohne Endstand: die Tage des Zeitraums, zuletzt abgelesen am Stichtag davor.
  const offen = row(overview({ readings: year('za', 0, 50) }, 2026), 'za')
  assert.deepEqual(offen.periodGap, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(offen.lastReadingOn, '2025-12-31')
  // Die letzte Ablesung liegt am Stichtag davor oder im Spielraum davor: Es fehlt schlicht der Endstand.
  assert.equal(offen.longUnread, false)
  assert.equal(row(overview({ readings: dez('12-28') }, 2026), 'za').longUnread, false)
  // Der Hauptzähler taugt der Abrechnung nur über den ganzen Zeitraum als Basis (`meter.main-partial`): kein Spielraum.
  const haupt = row(overview({ meters: [meter('haupt', null)], readings: [{ meterId: 'haupt', date: '2024-12-28', value: 0 }, { meterId: 'haupt', date: '2025-12-28', value: 50 }] }), 'haupt')
  assert.deepEqual(haupt.periodGap, { from: '2025-12-29', to: '2025-12-31' })
})

// Durchsicht (Sollte 2): Ein durch einen neu angelegten Hauptzähler ersetzter ist danach Geschichte.
test('Übersicht: Hauptzähler durch einen neu angelegten Hauptzähler ersetzt, der alte ist im Folgejahr nicht rot', () => {
  const s: Partial<SnapshotSource> = {
    meters: [meter('h1', null), meter('h2', null), { ...meter('garten', null), scope: 'common' }],
    readings: [
      { meterId: 'h1', date: '2023-12-31', value: 1 }, { meterId: 'h1', date: '2024-06-30', value: 5 },
      { meterId: 'h2', date: '2024-06-30', value: 0 }, { meterId: 'h2', date: '2024-12-31', value: 5 }, { meterId: 'h2', date: '2025-12-31', value: 9 },
      { meterId: 'garten', date: '2023-12-31', value: 1 }, { meterId: 'garten', date: '2024-06-30', value: 5 },
    ],
  }
  assert.equal(row(overview(s), 'h1').periodCovered, true)
  assert.equal(row(overview(s, 2024), 'h1').periodCovered, true)
  assert.equal(row(overview(s), 'h2').periodCovered, true)
  // Ein Zähler für einen Teil des Hauses ist kein Vorgänger des Hauptzählers.
  assert.equal(row(overview(s), 'garten').periodCovered, false)
  // Ein Wohnungszähler ohne Nachfolger, seit Jahren nicht abgelesen: nicht gedeckt, mit dem Tag der letzten Ablesung.
  const alt = row(overview({ readings: [{ meterId: 'za', date: '2022-12-31', value: 1 }, { meterId: 'za', date: '2023-06-30', value: 5 }] }), 'za')
  assert.equal(alt.periodCovered, false)
  assert.equal(alt.lastReadingOn, '2023-06-30')
  assert.equal(alt.longUnread, true)
})

// Durchsicht (Sollte 4): Mehrere Heizkostenverteiler je Wohnung sind der Normalfall; ein später eingebauter zweiter ist
// kein Nachfolger des ersten.
test('Übersicht: ein später eingebauter paralleler Zähler verdeckt keinen fehlenden Endstand', () => {
  const hkv = (id: string): SnapshotMeter => ({ id, unitId: 'a', type: 'hkv', name: id })
  const rows = overview({
    meters: [hkv('k1'), { ...hkv('k2'), installedOn: '2025-03-01' }],
    readings: [{ meterId: 'k1', date: '2023-12-31', value: 1 }, { meterId: 'k1', date: '2024-12-31', value: 5 }, { meterId: 'k2', date: '2025-03-01', value: 0 }, { meterId: 'k2', date: '2025-12-31', value: 5 }],
  })
  assert.equal(row(rows, 'k1').periodCovered, false)
  assert.equal(row(rows, 'k2').periodCovered, true)
  // Liest der alte nach dem Einbau des neuen weiter, laufen beide nebeneinander: kein Nachfolger.
  const parallel = overview({
    meters: [hkv('k1'), hkv('k2')],
    readings: [{ meterId: 'k1', date: '2024-12-31', value: 1 }, { meterId: 'k1', date: '2025-06-30', value: 5 }, { meterId: 'k1', date: '2025-09-30', value: 6 }, { meterId: 'k2', date: '2025-06-30', value: 0 }, { meterId: 'k2', date: '2025-12-31', value: 5 }],
  })
  assert.equal(row(parallel, 'k1').periodCovered, false)
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

test('Zimmer einer Wohnung (#573): der nicht abgelesene Zähler der Wohnung steht einmal, mit dem Rat zum Anschluss', () => {
  const room = (id: string, areaM2: number): SnapshotUnit => ({ ...unit(id), areaM2, parentUnitId: 'c' })
  const s = settle({
    units: [unit('a'), unit('b'), unit('c'), room('c1', 20), room('c2', 30)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c1', 'c1'), tenancy('t-c2', 'c2')],
    readings: [...year('za', 100, 150), ...year('zb', 200, 250), { meterId: 'zc', date: '2024-12-31', value: 300 }],
  })
  const [n, ...more] = notice(s, 'meter.unit-not-read')
  assert.ok(n, 'kein Hinweis meter.unit-not-read')
  assert.equal(more.length, 0)
  assert.equal(n.text.split('„Wasser zc“').length, 2, n.text)
  assert.match(n.text, /keinen eigenen Anschluss/)
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

// Integrationsdurchsicht: Neben `meter.negative-in-key` an der Heizposition nach Wärmezählern stand „nach Zählern
// verteilt werden 94,5 % der Heizkosten“. Die Position wird aber nicht verteilt, der Satz widersprach dem Fehler.
test('Negativer Verbrauch an der Heizposition nach Wärmezählern: kein Hinweis auf den Verbrauchsanteil daneben', () => {
  const heatMeter = (id: string, unitId: string): SnapshotMeter => ({ id, unitId, type: 'waerme', name: `Wärme ${id}` })
  const byMeter: SnapshotCostItem = { id: 'hv', period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Gas nach Verbrauch', amountCents: 189000, key: 'meter', meterType: 'waerme' }
  const byArea: SnapshotCostItem = { id: 'hg', period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Gas Grundkosten', amountCents: 11000, key: 'area' }
  const stock = { costItems: [byMeter, byArea], meters: [heatMeter('za', 'a'), heatMeter('zb', 'b'), heatMeter('zc', 'c')] }
  // Zur Kontrolle der Bestand mit sauberen Ständen: Dort steht der Hinweis, mit 94,5 %.
  const clean = settle({ ...stock, readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 350)] })
  assert.deepEqual(notice(clean, 'meter.negative-in-key'), [])
  assert.match(notice(clean, 'heating.consumption-share')[0]?.text ?? '', /nach Zählern verteilt werden 94,5 % der Heizkosten/)
  const s = settle({ ...stock, readings: [...year('za', 100, 150), ...year('zb', 200, 250), ...year('zc', 300, 250)] })
  assert.equal(notice(s, 'meter.negative-in-key').length, 1)
  // Die Position nach Zählern trägt niemand, die Grundkosten sind verteilt.
  assert.ok(s.statements.every((st) => st.rows.every((r) => r.costItemId !== 'hv' || r.shareCents === 0)))
  assert.ok(s.statements.some((st) => st.rows.some((r) => r.costItemId === 'hg' && r.shareCents > 0)))
  assert.deepEqual(notice(s, 'heating.consumption-share'), [])
  assert.deepEqual(notice(s, 'heating.all-by-consumption'), [])
})

// Integrationsdurchsicht (Daten): Ein krummer Einbautag, der im Bestand stehen bleibt (krumm, nicht kaputt), machte
// Cockpit und Zähler-Seite zu einem 500 („Invalid time value“). Die Deckungsprüfung liest ihn dann, als fehle er.
test('Krummer Einbautag im Bestand: die Verbrauchsübersicht rechnet, als fehle er', () => {
  const readings = year('za', 100, 150)
  const without = row(overview({ meters: [meter('za', 'a')], readings }), 'za')
  for (const installedOn of ['neulich', '2025-02-30', '30.06.2025', '2025-13-01', '']) {
    const r = row(overview({ meters: [{ ...meter('za', 'a'), installedOn }], readings }), 'za')
    assert.deepEqual(r, without, installedOn)
  }
  // Auch die Abrechnung stolpert nicht.
  assert.doesNotThrow(() => settle({ meters: [{ ...meter('za', 'a'), installedOn: 'neulich' }, meter('zb', 'b'), meter('zc', 'c')], readings: [...readings, ...year('zb', 1, 2), ...year('zc', 1, 2)] }))
})

// Durchsicht des Abschlusses: Der Anteil wurde ohne die nicht verteilte Position gerechnet und nannte dann die falsche
// Richtung („28,6 %“, unter dem Mindestsatz, wo es nach der Berichtigung 75 % sind). Regel: Wird eine Position der
// Gruppe wegen eines Fehlers nicht verteilt, schweigt `heating.consumption-share`; sonst gilt die Rechnung über alle
// Positionen der Gruppe, auch ohne Ablesungen und im leeren Haus.
const typedMeter = (id: string, unitId: string, type: 'waerme' | 'warmwasser'): SnapshotMeter => ({ id, unitId, type, name: `${type} ${id}` })
const heatingItem = (over: Partial<SnapshotCostItem> & { id: string, amountCents: number }): SnapshotCostItem => ({
  period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: over.id, key: 'area', ...over,
})
const heatMeters = [typedMeter('ha', 'a', 'waerme'), typedMeter('hb', 'b', 'waerme'), typedMeter('hc', 'c', 'waerme')]
const heatReadings = [...year('ha', 100, 150), ...year('hb', 200, 250), ...year('hc', 300, 350)]
const shareText = (names: string, pct: string, above: boolean): string =>
  `Heizung und Warmwasser (${names}): nach Zählern verteilt werden ${pct} % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
  `${above ? 'Ein höherer Anteil nach Verbrauch bleibt nur bestehen, wenn er rechtsgeschäftlich bestimmt ist, etwa im Mietvertrag vereinbart (§ 10 HeizkostenV). ' : ''}Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.`

test('Verbrauchsanteil: eine wegen negativen Verbrauchs nicht verteilte Position lässt den Hinweis für die Gruppe ganz schweigen', () => {
  const costItems = [
    heatingItem({ id: 'H', amountCents: 65000, key: 'meter', meterType: 'waerme' }),
    heatingItem({ id: 'W', amountCents: 10000, key: 'meter', meterType: 'warmwasser' }),
    heatingItem({ id: 'G', amountCents: 25000 }),
  ]
  const meters = [...heatMeters, typedMeter('wa', 'a', 'warmwasser'), typedMeter('wb', 'b', 'warmwasser'), typedMeter('wc', 'c', 'warmwasser')]
  const water = [...year('wa', 10, 20), ...year('wb', 10, 20), ...year('wc', 10, 20)]
  const broken = settle({ costItems, meters, readings: [...year('ha', 100, 150), ...year('hb', 200, 250), ...year('hc', 300, 250), ...water] })
  assert.equal(notice(broken, 'meter.negative-in-key').length, 1)
  assert.deepEqual(notice(broken, 'heating.consumption-share'), [])
  assert.deepEqual(notice(broken, 'heating.all-by-consumption'), [])
  // Nach der berichtigten Ablesung: 750 von 1.000 € nach Zählern, über dem Höchstsatz.
  const fixed = settle({ costItems, meters, readings: [...heatReadings, ...water] })
  assert.deepEqual(notice(fixed, 'heating.consumption-share').map((n) => n.text), [shareText('„H“, „W“ und „G“', '75', true)])
})

test('Verbrauchsanteil im gewöhnlichen Mischfall: 30 % und 80 % im Wortlaut wie bisher', () => {
  const mixed = (meterCents: number, areaCents: number) => settle({ meters: heatMeters, readings: heatReadings, costItems: [
    heatingItem({ id: 'V', amountCents: meterCents, key: 'meter', meterType: 'waerme' }), heatingItem({ id: 'G', amountCents: areaCents }),
  ] })
  assert.deepEqual(notice(mixed(30000, 70000), 'heating.consumption-share').map((n) => n.text), [shareText('„V“ und „G“', '30', false)])
  assert.deepEqual(notice(mixed(80000, 20000), 'heating.consumption-share').map((n) => n.text), [shareText('„V“ und „G“', '80', true)])
  assert.deepEqual(notice(mixed(60000, 40000), 'heating.consumption-share'), [])
})

test('Verbrauchsanteil ohne Ablesungen und im leeren Haus: der Hinweis steht wie bisher', () => {
  const costItems = [heatingItem({ id: 'V', amountCents: 80000, key: 'meter', meterType: 'waerme' }), heatingItem({ id: 'G', amountCents: 20000 })]
  const unread = settle({ costItems, meters: heatMeters, readings: [] })
  assert.equal(notice(unread, 'meter.no-consumption').length, 1)
  assert.deepEqual(notice(unread, 'heating.consumption-share').map((n) => n.text), [shareText('„V“ und „G“', '80', true)])
  const empty = settle({ costItems, meters: heatMeters, readings: heatReadings, tenancies: [] })
  assert.deepEqual(notice(empty, 'heating.consumption-share').map((n) => n.text), [shareText('„V“ und „G“', '80', true)])
})

test('Verbrauchsanteil: trägt nur ein Teil der Mieter die Position nach Zählern, zählt sie ganz', () => {
  // Wohnung C hat nichts verbraucht; ihre Mieterin trägt von „V“ nichts.
  const s = settle({ meters: heatMeters, readings: [...year('ha', 100, 150), ...year('hb', 200, 250), ...year('hc', 300, 300)], costItems: [
    heatingItem({ id: 'V', amountCents: 80000, key: 'meter', meterType: 'waerme' }), heatingItem({ id: 'G', amountCents: 20000 }),
  ] })
  assert.ok(s.statements.some((st) => st.rows.every((r) => r.costItemId !== 'V' || r.shareCents === 0)))
  assert.deepEqual(notice(s, 'heating.consumption-share').map((n) => n.text), [shareText('„V“ und „G“', '80', true)])
})
