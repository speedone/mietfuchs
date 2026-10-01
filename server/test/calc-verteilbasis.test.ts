// Verteilbasis erweitern (#94): Teilnehmer, Schlüssel „laut Gemeinschaftsabrechnung“ und
// Einzelbeträge je Mietverhältnis, mit Handrechnung.
//
// Gebaut wird unmittelbar ein Schnappschuss und keine db.json: Die alte Datei kennt diese Angaben
// nicht (LegacyCostItem in store.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, start = '2025-01-01', end: string | null = null): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'key'>): SnapshotCostItem => ({
  id: 'k', year: 2025, category: 'Sonstige Betriebskosten', description: 'Probe', amountCents: 100000, ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const settle = (s: SnapshotSource): ComputedSettlement => computeSettlement(snapshotOf(s, 2025))
const shareOf = (s: ComputedSettlement, tenancyId: string): number =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.totalShareCents ?? 0
const rowOf = (s: ComputedSettlement, tenancyId: string) => s.statements.find((st) => st.tenancyId === tenancyId)?.rows[0]

// ---------- Teilnehmer ----------

test('Teilnehmer: der Aufzug von Haus A verteilt nur auf Haus A', () => {
  const s = settle(source({
    units: [unit('a1'), unit('a2'), unit('b1', { areaM2: 100 })],
    tenancies: [tenancy('t-a1', 'a1'), tenancy('t-a2', 'a2'), tenancy('t-b1', 'b1')],
    costItems: [item({ key: 'area', participantUnitIds: ['a1', 'a2'] })],
  }))
  assert.deepEqual([shareOf(s, 't-a1'), shareOf(s, 't-a2'), shareOf(s, 't-b1')], [50000, 50000, 0])
  assert.equal(s.landlord.totalCents, 0)
  assert.equal(rowOf(s, 't-a1')?.basisText, '50 von 100 m²')
  assert.deepEqual(s.warnings, [])
})

test('Teilnehmer: eine selbstgenutzte Wohnung, die nicht teilnimmt, trägt keinen Eigenanteil', () => {
  const s = settle(source({
    units: [unit('eigen', { participates: false, selfUsed: true }), unit('m')],
    tenancies: [tenancy('t-m', 'm')],
    costItems: [item({ key: 'area', participantUnitIds: ['m'] })],
  }))
  assert.equal(shareOf(s, 't-m'), 100000)
  assert.equal(s.selfUsedShareCents, 0)
})

test('Teilnehmer: beim Verbrauch zählen nur die Zähler der Teilnehmer', () => {
  const s = settle(source({
    units: [unit('x'), unit('y')],
    tenancies: [tenancy('t-x', 'x'), tenancy('t-y', 'y')],
    meters: [{ id: 'mx', unitId: 'x', type: 'kaltwasser' }, { id: 'my', unitId: 'y', type: 'kaltwasser' }],
    readings: [
      { meterId: 'mx', date: '2024-12-31', value: 0 }, { meterId: 'mx', date: '2025-12-31', value: 30 },
      { meterId: 'my', date: '2024-12-31', value: 0 }, { meterId: 'my', date: '2025-12-31', value: 70 },
    ],
    costItems: [item({ key: 'meter', meterType: 'kaltwasser', participantUnitIds: ['x'] })],
  }))
  assert.deepEqual([shareOf(s, 't-x'), shareOf(s, 't-y')], [100000, 0])
})

test('Teilnehmer: eine leere Liste verteilt nichts und sagt es', () => {
  const s = settle(source({
    units: [unit('a')],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'units', participantUnitIds: [] })],
  }))
  assert.equal(shareOf(s, 't-a'), 0)
  assert.equal(s.landlord.totalCents, 100000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0] ?? '', /Probe.*keine Wohnung nimmt teil/)
})

// ---------- Laut Gemeinschaftsabrechnung ----------

const weg = { measure: 'mea' as const, total: 10000, totalCents: 5000000 }

test('Gemeinschaft: eine Eigentumswohnung, ganzjährig vermietet, bekommt ihren Anteil ganz', () => {
  const s = settle(source({
    units: [unit('w', { mea: 124 })],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 62000, externalBasis: weg })],
  }))
  assert.equal(shareOf(s, 't'), 62000)
  assert.equal(rowOf(s, 't')?.basisText, '124 von 10.000 MEA · Gesamtkosten der Anlage 50.000,00 €')
  assert.deepEqual(s.warnings, [])
})

test('Gemeinschaft: Mieterwechsel zur Jahresmitte teilt tagesanteilig, centgenau', () => {
  const s = settle(source({
    units: [unit('w', { mea: 124 })],
    tenancies: [tenancy('t1', 'w', '2025-01-01', '2025-06-30'), tenancy('t2', 'w', '2025-07-01')],
    costItems: [item({ key: 'external', amountCents: 62000, externalBasis: weg })],
  }))
  // 62.000 × 181/365 = 30.745,2 und × 184/365 = 31.254,8
  assert.deepEqual([shareOf(s, 't1'), shareOf(s, 't2')], [30745, 31255])
  assert.equal(s.landlord.totalCents, 0)
  assert.match(rowOf(s, 't1')?.basisText ?? '', /· 181\/365 Tage$/)
})

test('Gemeinschaft: Leerstand trägt der Vermieter', () => {
  const s = settle(source({
    units: [unit('w', { mea: 124 })],
    tenancies: [tenancy('t2', 'w', '2025-07-01')],
    costItems: [item({ key: 'external', amountCents: 62000, externalBasis: weg })],
  }))
  assert.equal(shareOf(s, 't2'), 31255)
  assert.equal(s.landlord.totalCents, 30745)
})

test('Gemeinschaft: zwei Wohnungen derselben Anlage teilen nach ihren MEA', () => {
  const s = settle(source({
    units: [unit('w1', { mea: 100 }), unit('w2', { mea: 300 })],
    tenancies: [tenancy('t1', 'w1'), tenancy('t2', 'w2')],
    costItems: [item({ key: 'external', amountCents: 40000, externalBasis: { measure: 'mea', total: 10000, totalCents: 1000000 } })],
  }))
  assert.deepEqual([shareOf(s, 't1'), shareOf(s, 't2')], [10000, 30000])
  assert.deepEqual(s.warnings, [])
})

test('Gemeinschaft: passt der Betrag nicht zur Gesamtsumme, gibt es eine Warnung, gezahlt ist trotzdem der Betrag', () => {
  const s = settle(source({
    units: [unit('w', { mea: 124 })],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 70000, externalBasis: weg })],
  }))
  assert.equal(shareOf(s, 't'), 70000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0] ?? '', /700,00 €/)
  assert.match(s.warnings[0] ?? '', /620,00 €/)
})

test('Gemeinschaft: nach Fläche und nach Einheiten', () => {
  const nachFlaeche = settle(source({
    units: [unit('w', { areaM2: 62 })],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 5000, externalBasis: { measure: 'area', total: 1240, totalCents: 100000 } })],
  }))
  assert.equal(rowOf(nachFlaeche, 't')?.basisText, '62 von 1.240 m² · Gesamtkosten der Anlage 1.000,00 €')
  assert.deepEqual(nachFlaeche.warnings, [])
  const nachEinheiten = settle(source({
    units: [unit('w')],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 2500, externalBasis: { measure: 'units', total: 40, totalCents: 100000 } })],
  }))
  assert.equal(rowOf(nachEinheiten, 't')?.basisText, '1 von 40 Einheiten · Gesamtkosten der Anlage 1.000,00 €')
})

test('Gemeinschaft: ohne Miteigentumsanteile oder ohne Angaben geht der Betrag an den Vermieter', () => {
  const ohneMea = settle(source({
    units: [unit('w')],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 62000, externalBasis: weg })],
  }))
  assert.equal(ohneMea.landlord.totalCents, 62000)
  assert.match(ohneMea.warnings[0] ?? '', /Miteigentumsanteile/)
  const ohneAngaben = settle(source({
    units: [unit('w', { mea: 124 })],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'external', amountCents: 62000 })],
  }))
  assert.equal(ohneAngaben.landlord.totalCents, 62000)
  assert.match(ohneAngaben.warnings[0] ?? '', /Gemeinschaft/)
})

// ---------- Einzelbeträge je Mietverhältnis ----------

test('Einzelbeträge: der Messdienst teilt beim Nutzerwechsel selbst, der Rest bleibt beim Vermieter', () => {
  const s = settle(source({
    units: [unit('w'), unit('leer', { participates: true })],
    tenancies: [tenancy('t1', 'w', '2025-01-01', '2025-06-30'), tenancy('t2', 'w', '2025-07-01')],
    costItems: [item({ key: 'amounts', amountCents: 80000, tenancyAmounts: { t1: 30000, t2: 40000 } })],
  }))
  assert.deepEqual([shareOf(s, 't1'), shareOf(s, 't2')], [30000, 40000])
  assert.equal(s.landlord.totalCents, 10000)
  assert.equal(rowOf(s, 't1')?.basisText, 'laut Einzelabrechnung')
  assert.deepEqual(s.warnings, [])
})

test('Einzelbeträge: mehr als die Rechnung wird nicht verteilt', () => {
  const s = settle(source({
    units: [unit('w')],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'amounts', amountCents: 10000, tenancyAmounts: { t: 12000 } })],
  }))
  assert.equal(shareOf(s, 't'), 0)
  assert.equal(s.landlord.totalCents, 10000)
  assert.match(s.warnings[0] ?? '', /120,00 €.*100,00 €|übersteig/)
})

test('Einzelbeträge: wer im Jahr wohnte und keinen Betrag hat, wird genannt', () => {
  const s = settle(source({
    units: [unit('w'), unit('v')],
    tenancies: [tenancy('t', 'w'), tenancy('vergessen', 'v')],
    costItems: [item({ key: 'amounts', amountCents: 10000, tenancyAmounts: { t: 6000 } })],
  }))
  assert.equal(shareOf(s, 't'), 6000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0] ?? '', /vergessen/)
})

test('Einzelbeträge: ein Betrag für ein Mietverhältnis, das nicht im Jahr lag, entfällt mit Warnung', () => {
  const s = settle(source({
    units: [unit('w')],
    tenancies: [tenancy('t', 'w', '2025-01-01'), tenancy('alt', 'w', '2020-01-01', '2024-12-31')],
    costItems: [item({ key: 'amounts', amountCents: 10000, tenancyAmounts: { t: 6000, alt: 1000, 'gibt-es-nicht': 500 } })],
  }))
  assert.equal(shareOf(s, 't'), 6000)
  assert.equal(s.landlord.totalCents, 4000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0] ?? '', /2 Einzelbeträge über 15,00 € .* entfallen/)
})

test('Einzelbeträge: der §35a-Lohnanteil folgt den Beträgen', () => {
  const s = settle(source({
    units: [unit('w')],
    tenancies: [tenancy('t1', 'w', '2025-01-01', '2025-06-30'), tenancy('t2', 'w', '2025-07-01')],
    costItems: [item({ key: 'amounts', amountCents: 80000, labor35aCents: 8000, tenancyAmounts: { t1: 30000, t2: 40000 } })],
  }))
  assert.deepEqual([rowOf(s, 't1')?.labor35aCents, rowOf(s, 't2')?.labor35aCents], [3000, 4000])
})

// ---------- Invarianten über zufällige Bestände mit den neuen Angaben ----------
// Dieselben Zusagen wie in calc.test.ts, jetzt mit Teilnehmern (auch leeren), Angaben einer
// Gemeinschaft (auch unpassenden) und Einzelbeträgen (auch zu großen, verwaisten, fehlenden).

type Rng = () => number
function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function randomSource(rnd: Rng): SnapshotSource {
  const pick = <T>(arr: readonly T[]): T => {
    const x = arr[Math.floor(rnd() * arr.length)]
    if (x === undefined) throw new Error('leere Auswahl')
    return x
  }
  const units: SnapshotUnit[] = []
  for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) {
    const usage = pick(['vermietet', 'vermietet', 'eigen', 'ausgenommen'] as const)
    units.push({
      id: `u${i}`, name: `W${i}`, areaM2: rnd() < 0.15 ? 0 : Math.round(rnd() * 120),
      participates: usage === 'vermietet', selfUsed: usage === 'eigen',
      selfPersons: usage === 'eigen' ? Math.floor(rnd() * 3) : undefined,
      mea: rnd() < 0.2 ? undefined : Math.round(rnd() * 300),
    })
  }
  const tenancies: SnapshotTenancy[] = []
  for (const u of units) {
    if (rnd() < 0.25) continue
    const start = rnd() < 0.3 ? `2025-0${1 + Math.floor(rnd() * 9)}-01` : '2020-01-01'
    const end = rnd() < 0.3 ? `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-28` : null
    tenancies.push(tenancy(`t${tenancies.length}`, u.id, start, end))
  }
  const costItems: SnapshotCostItem[] = []
  for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
    const key = pick(['area', 'units', 'persons', 'external', 'amounts'] as const)
    const amountCents = 1 + Math.floor(rnd() * 300000)
    const c: SnapshotCostItem = { id: `c${i}`, year: 2025, category: 'Sonstige Betriebskosten', description: `P${i}`, amountCents, key }
    const r = rnd()
    if (r < 0.2) c.participantUnitIds = []
    else if (r < 0.6) c.participantUnitIds = units.filter(() => rnd() < 0.5).map((u) => u.id)
    if (key === 'external' && rnd() < 0.9) {
      c.externalBasis = { measure: pick(['mea', 'area', 'units'] as const), total: 1 + Math.floor(rnd() * 10000), totalCents: Math.floor(rnd() * 5000000) }
    }
    if (key === 'amounts') {
      const given: Record<string, number> = {}
      for (const t of [...tenancies, tenancy('verwaist', 'weg')]) if (rnd() < 0.7) given[t.id] = Math.floor(rnd() * amountCents * 0.8)
      c.tenancyAmounts = given
    }
    if (rnd() < 0.3) c.labor35aCents = Math.floor(rnd() * amountCents)
    costItems.push(c)
  }
  return source({ units, tenancies, costItems })
}

test('Invariante (#94): Mieteranteile + Vermieteranteil ergeben die Gesamtkosten, kein Anteil ist negativ', () => {
  const rnd = makeRng(94)
  for (let i = 0; i < 500; i++) {
    const src = randomSource(rnd)
    const s = settle(src)
    const mieter = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
    assert.equal(mieter + s.landlord.totalCents, s.totalCostsCents, `Fall ${i}\n${JSON.stringify(src)}`)
    for (const st of s.statements) {
      for (const row of st.rows) {
        assert.ok(row.shareCents >= 0, `Fall ${i}: negativer Anteil ${row.shareCents}`)
        assert.ok((row.labor35aCents ?? 0) <= row.shareCents, `Fall ${i}: §35a über dem Anteil`)
      }
    }
    for (const row of s.landlord.rows) assert.ok(row.shareCents >= 0, `Fall ${i}: negativer Vermieteranteil ${row.shareCents}\n${JSON.stringify(src)}`)
    assert.ok(s.selfUsedShareCents <= s.landlord.totalCents, `Fall ${i}: Eigenanteil über dem Vermieteranteil`)
  }
})

test('Einzelbeträge: mit einer selbstgenutzten Wohnung sagt die Abrechnung, dass ihr Anteil nicht ausgewiesen ist', () => {
  // Der Betrag des Messdienstes für die eigene Wohnung lässt sich nicht eintragen, er steckt im
  // Rest beim Vermieter. Der private Anteil der Steuerübersicht wäre sonst still zu niedrig.
  const s = settle(source({
    units: [unit('w'), unit('eigen', { participates: false, selfUsed: true })],
    tenancies: [tenancy('t', 'w')],
    costItems: [item({ key: 'amounts', amountCents: 10000, tenancyAmounts: { t: 6000 } })],
  }))
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0] ?? '', /eigen.*selbstgenutzt|selbstgenutzt.*eigen/)
})

test('Teilnehmer: nach dem Löschen der letzten Teilnehmerwohnung verteilt die Berechnung nichts und sagt es', () => {
  // Die leere Liste, wie sie nach der Kaskade aus der Datenbank kommt (participants_limited).
  const s = settle(source({
    units: [unit('b')],
    tenancies: [tenancy('t-b', 'b')],
    costItems: [item({ key: 'area', participantUnitIds: [] })],
  }))
  assert.equal(shareOf(s, 't-b'), 0)
  assert.match(s.warnings[0] ?? '', /keine Wohnung nimmt teil/)
})
