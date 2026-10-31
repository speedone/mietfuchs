// Die Abrechnungen eines Objekts für die Abrechnungsreife im Mietkonto (#281 E5, server/src/ledgerStatements.ts):
// Zeiträume des Objekts und getrennte Heizperioden (Weg d), Frist, Versand, eingefrorene Anrechnung je Mietverhältnis
// und welche Vorauszahlung eines Monats welche Abrechnung anrechnet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creditedByTenancy, ledgerStatementsFor } from '../src/ledgerStatements.ts'
import type { LedgerStatement } from '../src/calc.ts'
import { periodKey } from '../../shared/period.ts'
import type { Snapshot, SnapshotHeatingPlant, SnapshotTenancy } from '../src/snapshot.ts'

const tenancy: SnapshotTenancy = {
  id: 't', unitId: 'u', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
}
// Mai bis April, ab Mai 2024 getrennt abgerechnet (Weg d).
const plant: SnapshotHeatingPlant = {
  id: 'hp', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
  newDevicesInstall: null, units: null, periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2024-05', until: null }],
}
const snapshot = (plants: SnapshotHeatingPlant[]): Pick<Snapshot, 'tenancies' | 'units' | 'heatingPlants' | 'objectRules' | 'property'> => ({
  tenancies: [tenancy], units: [{ id: 'u', name: 'EG', areaM2: 50, participates: true }], heatingPlants: plants,
  objectRules: { startMonth: 1, changes: [] },
})
const byLabel = (list: LedgerStatement[], label: string): LedgerStatement => list.find((s) => s.label === label) ?? assert.fail(`keine Abrechnung ${label}`)

test('Ohne Heizanlage: je Kalenderjahr ab Beginn eine Abrechnung mit Frist, Versand und Anrechnung je Mietverhältnis', () => {
  const frozen = { statements: [{ tenancyId: 't', prepaymentCents: 220000 }, { tenancyId: 'x', prepaymentCents: 5 }, { tenancyId: 't', prepaymentCents: 'kaputt' }] }
  const list = ledgerStatementsFor(snapshot([]), [{ period: periodKey('2024-01'), sentAt: '2025-03-01', settlement: frozen }], [], '2025-12-31')
  assert.deepEqual(list.map((s) => [s.label, s.months.length, s.deadline, s.closed, s.sentAt]), [
    ['2024', 12, '2025-12-31', true, '2025-03-01'],
    ['2025', 12, '2026-12-31', false, null],
  ])
  assert.equal(byLabel(list, '2024').credited?.get('t'), 220000)
  assert.equal(byLabel(list, '2025').credited, null)
  assert.equal(byLabel(list, '2024').covers('t', '2024-06', 'prepayment'), true)
  assert.equal(byLabel(list, '2024').covers('t', '2024-06', 'heatingPrepayment'), true, 'ohne getrennte Heizkostenabrechnung rechnet die des Objekts sie an')
})

test('Weg d: die Heizvorauszahlung ab Mai 2024 rechnet die Heizkostenabrechnung ihrer Heizperiode an, davor die des Objekts', () => {
  const heatingFrozen = { statements: [{ tenancyId: 't', prepaymentCents: 80000, scope: 'heating' }, { tenancyId: 't', prepaymentCents: 99, scope: 'all' }] }
  const list = ledgerStatementsFor(snapshot([plant]), [], [{ plantId: 'hp', period: periodKey('2024-05'), sentAt: null, settlement: heatingFrozen }], '2025-12-31')
  // Die Heizperiode 2023/2024 ist nicht getrennt (vor Mai 2024): keine eigene Abrechnung.
  assert.deepEqual(list.map((s) => s.label), ['2024', '2025', '2024/2025', '2025/2026'])
  const h = byLabel(list, '2024/2025')
  assert.deepEqual([h.months[0], h.months.at(-1), h.deadline, h.closed, h.sentAt], ['2024-05', '2025-04', '2026-04-30', true, null])
  assert.equal(h.credited?.get('t'), 80000, 'nur die Mieterabrechnungen der Heizkostenabrechnung')
  const cold = byLabel(list, '2024')
  assert.equal(cold.covers('t', '2024-03', 'heatingPrepayment'), true, 'vor dem Beginn der getrennten Abrechnung')
  assert.equal(cold.covers('t', '2024-06', 'heatingPrepayment'), false)
  assert.equal(cold.covers('t', '2024-06', 'prepayment'), true)
  assert.equal(h.covers('t', '2024-06', 'heatingPrepayment'), true)
  assert.equal(h.covers('t', '2024-06', 'prepayment'), false, 'die kalte Vorauszahlung gehört nie in die Heizkostenabrechnung')
  assert.equal(byLabel(list, '2025/2026').covers('t', '2024-06', 'heatingPrepayment'), false, 'jeder Monat genau einmal')
})

test('Archivstück unlesbar: keine Anrechnung, nichts geraten', () => {
  assert.deepEqual([...creditedByTenancy(null, false)], [])
  assert.deepEqual([...creditedByTenancy({ statements: 'x' }, false)], [])
  assert.deepEqual(ledgerStatementsFor({ ...snapshot([]), tenancies: [] }, [], [], '2025-12-31'), [])
})
