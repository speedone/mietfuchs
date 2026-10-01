// Garage und Stellplatz mit 0 m² und 0 Personen (#135). Das Formular lässt beides jetzt zu; hier
// steht, dass Datenbank und Berechnung damit umgehen: Die Datenbank nimmt die 0 an, und eine
// Verteilbasis, in der alle Einheiten 0 haben, teilt nicht durch null, sondern gibt die Position
// mit einer Meldung an den Vermieter.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { openDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const tenancy = (id: string, unitId: string, persons: number): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: '2020-01-01', persons }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const item = (id: string, key: SnapshotCostItem['key']): SnapshotCostItem => ({ id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key })
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))

// Jeder Betrag eine endliche ganze Zahl, und Mieter plus Vermieter ergeben die Kosten.
function assertSound(s: ComputedSettlement): void {
  for (const st of s.statements) {
    for (const r of st.rows) assert.ok(Number.isInteger(r.shareCents), `${st.tenancyId}: ${r.shareCents}`)
    assert.ok(Number.isInteger(st.totalShareCents) && Number.isInteger(st.suggestedMonthlyCents) && Number.isInteger(st.balanceCents))
  }
  const tenants = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
  assert.equal(tenants + s.landlord.totalCents, s.totalCostsCents)
}

test('Garage mit 0 m² neben einer Wohnung: zählt beim Flächenschlüssel nicht mit', () => {
  const s = settle({
    units: [unit('wohnung', 80), unit('garage', 0)],
    tenancies: [tenancy('tw', 'wohnung', 2), tenancy('tg', 'garage', 0)],
    costItems: [item('fläche', 'area'), item('personen', 'persons')],
  })
  assertSound(s)
  const garage = s.statements.find((x) => x.tenancyId === 'tg')
  assert.equal(garage?.totalShareCents, 0)
  const wohnung = s.statements.find((x) => x.tenancyId === 'tw')
  assert.equal(wohnung?.totalShareCents, 200000)
  // Die 0 ist eine Angabe: je ein Hinweis, keine Warnung (Durchsicht zu #135).
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.unit-zero', 'hint'], ['basis.tenancy-zero', 'hint']])
})

test('Vermietete Wohnung mit 2 Personen und 0 m²: die Fläche ist vergessen, das bleibt eine Warnung', () => {
  const s = settle({
    units: [unit('eg', 80), unit('og', 0)],
    tenancies: [tenancy('t1', 'eg', 2), tenancy('t2', 'og', 2)],
    costItems: [item('fläche', 'area')],
  })
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.unit-no-area', 'warning']])
})

test('0 Personen in einer Wohnung mit Fläche: die Personenzahl ist vergessen, das bleibt eine Warnung', () => {
  const s = settle({
    units: [unit('eg', 80), unit('og', 60)],
    tenancies: [tenancy('t1', 'eg', 2), tenancy('t2', 'og', 0)],
    costItems: [item('personen', 'persons')],
  })
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.tenancy-no-persons', 'warning']])
})

test('Gemeinschaftsabrechnung nach Fläche: eine Garage ohne Fläche und Bewohner ist kein Alarm, eine Wohnung mit Bewohnern schon', () => {
  const external = (id: string): SnapshotCostItem => ({ ...item(id, 'external'), externalBasis: { measure: 'area', total: 500, totalCents: 500000 } })
  const garage = settle({
    units: [unit('wohnung', 100), unit('garage', 0)],
    tenancies: [tenancy('tw', 'wohnung', 2), tenancy('tg', 'garage', 0)],
    costItems: [external('hausgeld')],
  })
  assert.ok(!garage.notices.some((n) => n.code === 'external.value-missing'), garage.warnings.join(' | '))
  const vergessen = settle({
    units: [unit('wohnung', 100), unit('og', 0)],
    tenancies: [tenancy('tw', 'wohnung', 2), tenancy('to', 'og', 1)],
    costItems: [external('hausgeld')],
  })
  assert.ok(vergessen.notices.some((n) => n.code === 'external.value-missing' && n.level === 'warning'), vergessen.warnings.join(' | '))
})

test('Alle Einheiten mit 0 m² und 0 Personen: keine Division durch null, die Kosten trägt der Vermieter', () => {
  const s = settle({
    units: [unit('g1', 0), unit('g2', 0)],
    tenancies: [tenancy('t1', 'g1', 0), tenancy('t2', 'g2', 0)],
    costItems: [item('fläche', 'area'), item('personen', 'persons')],
  })
  assertSound(s)
  assert.equal(s.landlord.totalCents, 200000)
  for (const st of s.statements) assert.equal(st.totalShareCents, 0)
  assert.ok(s.notices.some((n) => n.code === 'item.no-basis'), s.notices.map((n) => n.code).join(', '))
})

test('Datenbank: 0 m² und 0 Personen werden angenommen', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-garage-'))
  const opened = await openDatabase({ dataDir })
  try {
    const u = await opened.write((db) => createEntity(db, 'units', 'g', { propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true }))
    assert.equal(Reflect.get(u, 'areaM2'), 0)
    const t = await opened.write((db) => createEntity(db, 'tenancies', 't', {
      unitId: 'g', tenantName: 'Mieter', persons: 0, personHistory: [{ from: '2025-01-01', persons: 0 }], start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    assert.equal(Reflect.get(t, 'persons'), 0)
    assert.deepEqual(Reflect.get(t, 'personHistory'), [{ from: '2025-01-01', persons: 0 }])
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
