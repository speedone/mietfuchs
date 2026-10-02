// Der Schnappschuss eines Objekts (#92): `narrowToProperty` ist die einzige Stelle, die einen
// Bestand auf ein Objekt eingrenzt. Geprüft wird je Sammlung, dass genau das Objekt bleibt und
// nichts vom anderen durchrutscht. Die Invariante in calc.test.ts prüft dasselbe rechnend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { narrowToProperty, snapshotFor, snapshotOf, type PropertyScopedSource } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})

// Zwei Objekte, jedes mit Wohnung, Mietverhältnis, Zahlung, Wohnungszähler, Hauptzähler,
// Ablesungen, Kostenposition und einem Abschluss für dasselbe Jahr.
const source: PropertyScopedSource = {
  units: [
    { id: 'a-w', propertyId: 'A', name: 'A-EG', areaM2: 50, participates: true },
    { id: 'b-w', propertyId: 'B', name: 'B-EG', areaM2: 70, participates: true },
  ],
  tenancies: [tenancy('a-t', 'a-w'), tenancy('b-t', 'b-w')],
  costItems: [
    { id: 'a-k', propertyId: 'A', year: 2025, category: 'Grundsteuer', description: 'A', amountCents: 100, key: 'area' },
    { id: 'b-k', propertyId: 'B', year: 2025, category: 'Grundsteuer', description: 'B', amountCents: 200, key: 'area' },
  ],
  meters: [
    { id: 'a-m', propertyId: 'A', unitId: 'a-w', type: 'kaltwasser' },
    { id: 'a-haupt', propertyId: 'A', unitId: null, type: 'kaltwasser' },
    { id: 'b-haupt', propertyId: 'B', unitId: null, type: 'kaltwasser' },
  ],
  readings: [
    { meterId: 'a-m', date: '2025-12-31', value: 10 },
    { meterId: 'a-haupt', date: '2025-12-31', value: 30 },
    { meterId: 'b-haupt', date: '2025-12-31', value: 50 },
  ],
  payments: [
    { tenancyId: 'a-t', date: '2025-01-05', amountCents: 1000 },
    { tenancyId: 'b-t', date: '2025-01-05', amountCents: 2000 },
  ],
  closedSettlements: [
    { propertyId: 'A', year: 2024, selfUsedShareCents: 1, prepaymentCents: 10, prepaymentOverridden: false },
    { propertyId: 'B', year: 2024, selfUsedShareCents: 2, prepaymentCents: 20, prepaymentOverridden: true },
  ],
}

const ids = (rows: readonly { id?: string }[]) => rows.map((r) => r.id)

test('Objekt: die Wurzeln bleiben, die ihr Objekt tragen', () => {
  const a = narrowToProperty(source, 'A')
  assert.deepEqual(ids(a.units), ['a-w'])
  assert.deepEqual(ids(a.costItems), ['a-k'])
  // Auch der Hauptzähler: Er hat keine Wohnung, gehört aber zum Objekt.
  assert.deepEqual(ids(a.meters), ['a-m', 'a-haupt'])
})

test('Objekt: was erbt, folgt seiner Wurzel', () => {
  const b = narrowToProperty(source, 'B')
  assert.deepEqual(ids(b.tenancies), ['b-t'], 'Mietverhältnis über seine Wohnung')
  assert.deepEqual(b.payments.map((p) => p.amountCents), [2000], 'Zahlung über ihr Mietverhältnis')
  assert.deepEqual(b.readings.map((r) => r.value), [50], 'Ablesung über ihren Zähler, auch am Hauptzähler')
})

test('Objekt: der Abschluss desselben Jahres im anderen Objekt gilt nicht', () => {
  const snapshot = snapshotFor(source, 'A', 2024)
  assert.deepEqual(snapshot.closedSettlement, { selfUsedShareCents: 1, prepaymentCents: 10, prepaymentOverridden: false, selfUseByItem: null, itemTotals: null })
  assert.equal(snapshot.propertyId, 'A')
})

test('Objekt: ein Schnappschuss ohne Objekt sagt das', () => {
  // Der Stand vor den Objekten, wie ihn Regression und Umstieg rechnen.
  assert.equal(snapshotOf(narrowToProperty(source, 'A'), 2025).propertyId, null)
})

test('Objekt: ein unbekanntes Objekt ergibt einen leeren Bestand und keinen fremden', () => {
  const x = narrowToProperty(source, 'gibt-es-nicht')
  assert.deepEqual([x.units, x.tenancies, x.costItems, x.meters, x.readings, x.payments, x.closedSettlements], [[], [], [], [], [], [], []])
})
