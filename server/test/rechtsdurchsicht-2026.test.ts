// Jährliche Durchsicht der Rechtslage vom 02.10.2026 (#110); Befunde und Quellen in
// docs/superpowers/specs/2026-10-02-rechtsdurchsicht-2026.md.
//
// Fernablesbare Erfassungsgeräte: Nicht fernablesbare Zähler
// und Heizkostenverteiler mussten bis zum 31.12.2026 nachgerüstet oder getauscht werden
// (§ 5 Abs. 3 HeizkostenV). Sonst, oder wenn die monatlichen Verbrauchsinformationen nach § 6a
// fehlen, darf der Mieter seinen Anteil um 3 % kürzen (§ 12 Abs. 1 Satz 2 und 3). Welche Geräte
// eingebaut sind, weiß Mietfuchs nicht; es gibt deshalb einen Hinweis ohne Betrag, und zwar ab
// dem Abrechnungsjahr 2027, nicht vorher.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { ruleCoverage, rulesFor } from '../src/rules.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const heizung = (year: number, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: `h${year}`, year, category: 'Heizung und Warmwasser', description: 'Wärme laut Messdienst', amountCents: 300000,
  key: 'amounts', tenancyAmounts: { A: 100000, B: 100000, C: 100000 }, ...over,
})
const haus = {
  units: [unit('w1', 60), unit('w2', 60), unit('w3', 60)],
  tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2'), tenancy('C', 'w3')],
}
const settle = (year: number, s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, year))
const remote = (s: ComputedSettlement) => s.notices.filter((n) => n.code === 'heating.remote-reading')

test('Regel: die Pflicht für alle Geräte gilt ab 01.01.2027, 2026 noch nicht', () => {
  assert.equal(ruleCoverage('heating-remote-reading', '2026-01-01', '2026-12-31'), 'none')
  assert.equal(ruleCoverage('heating-remote-reading', '2027-01-01', '2027-12-31'), 'full')
  assert.equal(ruleCoverage('heating-remote-reading', '2026-12-31', '2026-12-31'), 'none')
  assert.equal(ruleCoverage('heating-remote-reading', '2027-01-01', '2027-01-01'), 'full')
  assert.ok(rulesFor('2027-01-01', '2027-12-31').some((r) => r.code === 'heating-remote-reading'))
  assert.ok(!rulesFor('2026-01-01', '2026-12-31').some((r) => r.code === 'heating-remote-reading'))
})

test('Abrechnung 2026: kein Hinweis, die Nachrüstfrist läuft bis 31.12.2026', () => {
  assert.deepEqual(remote(settle(2026, { ...haus, costItems: [heizung(2026)] })), [])
})

test('Abrechnung 2027: ein Hinweis zur Fernablesbarkeit, mit Regel und 3 %, ohne Betrag', () => {
  const s = settle(2027, { ...haus, costItems: [heizung(2027)] })
  const n = remote(s)
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'hint')
  assert.equal(n[0]?.rule, 'heating-remote-reading')
  assert.deepEqual(n[0]?.subject, { kind: 'costItem', id: 'h2027' })
  assert.ok((n[0]?.terms ?? []).includes('heatingCostOrdinance'))
  const text = n[0]?.text ?? ''
  assert.match(text, /fernablesbar/)
  assert.match(text, /3 %/)
  assert.match(text, /§ 12 Abs\. 1 HeizkostenV/)
  assert.match(text, /§ 6a/)
  assert.doesNotMatch(text, /\d+,\d\d €/, 'ohne Kenntnis der Geräte kein Betrag')
  assert.ok(s.legalBasis.rules.some((r) => r.code === 'heating-remote-reading'))
  // Gerechnet wird wie erfasst.
  assert.deepEqual(s.statements.map((st) => st.totalShareCents), [100000, 100000, 100000])
})

test('Abrechnung 2027: zwei Heizpositionen ergeben einen Hinweis, keine Heizposition keinen', () => {
  const zwei = settle(2027, { ...haus, costItems: [heizung(2027), heizung(2027, { id: 'g', description: 'Grundkosten', key: 'area', tenancyAmounts: undefined })] })
  assert.equal(remote(zwei).length, 1)
  const ohne = settle(2027, { ...haus, costItems: [heizung(2027, { category: 'Grundsteuer', key: 'area', tenancyAmounts: undefined })] })
  assert.deepEqual(remote(ohne), [])
})

test('Abrechnung 2027: kein Hinweis, wenn kein Mieter über die Heizung abgerechnet wird (Warmmiete)', () => {
  const warm = { ...haus, tenancies: haus.tenancies.map((t) => ({ ...t, heatingModel: 'inclusive' as const })) }
  assert.deepEqual(remote(settle(2027, { ...warm, costItems: [heizung(2027, { key: 'area', tenancyAmounts: undefined })] })), [])
})

test('Lexikon: die Nachrüstfrist 31.12.2026 steht bei der Heizkostenverordnung', () => {
  assert.match(GLOSSARY.heatingCostOrdinance.needed, /31\.12\.2026/)
  assert.match(GLOSSARY.heatingCostOrdinance.needed, /Abrechnungsjahr 2027/)
})

test('Lexikon: Abrechnungsfrist bei fehlendem oder angefochtenem Grundsteuerbescheid (BGH VIII ZR 6/24)', () => {
  // Primärquelle geprüft: BGH, Urteil vom 20.05.2026, VIII ZR 6/24, Rn. 62 und 67 (Durchsicht #110).
  const t = GLOSSARY.settlementDeadline
  assert.match(t.norm, /BGH, Urteil vom 20\.05\.2026, VIII ZR 6\/24/)
  assert.match(t.needed, /Grundsteuerbescheid/)
  assert.match(t.needed, /Einspruch/)
  assert.match(t.needed, /drei Monate/)
})
