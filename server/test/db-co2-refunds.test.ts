// CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, #97): Tabelle, Bedingungen, Lesen, Schreiben
// mit Prüfungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { readStock } from '../src/db/read.ts'
import { databaseProblem } from '../src/db/errors.ts'
import { co2Refunds } from '../src/db/schema.ts'
import { createEntity, orphanPeriodKeys } from '../src/db/repository.ts'
import { periodKey } from '../../shared/period.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-erstattung-'))
function rejects(connection: Connection, statement: string): string | null {
  try {
    connection.exec(statement)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

test('Tabelle co2_refunds: Bedingungen mit bekannten Endungen und CASCADE am Mietverhältnis', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('w', 'objekt-1', 'EG', 80, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, heating_model) VALUES ('t', 'w', 'Mieter', 1, '2020-01-01', 'selfSupply')`)
    const ins = (id: string, cols: string, vals: string) =>
      `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents${cols}) VALUES ('${id}', 't', '2025-01-20', '2025-03-01', 24000${vals})`
    assert.equal(rejects(c, ins('a', ', settle_period', ", '2025-01'")), null)
    const cases: [string, string, string, RegExp][] = [
      ['b', ', settle_period, paid_out_on', ", '2025-01', '2025-04-01'", /co2_refunds_settled_or_paid_valid/],
      ['c', ', settle_period', ", '2025-13'", /co2_refunds_settle_period_valid/],
      ['e', ', billed_from, billed_to', ", '2025-12-31', '2025-01-01'", /co2_refunds_billed_order_valid/],
      ['e2', ', billed_from', ", '2025-01-01'", /co2_refunds_billed_complete/],
      ['f', ', area_m2', ', 0', /co2_refunds_area_positive/],
      ['g', ', restriction', ", 'denkmal'", /co2_refunds_restriction_known/],
      ['h', ', commercial_metered', ', 1', /co2_refunds_metered_valid/],
      ['j', ', paid_out_on', ", '01.04.2025'", /co2_refunds_paid_out_valid/],
      ['k', ', half_split_from', ", '2028'", /co2_refunds_half_split_valid/],
      ['l', ', emissions_kg', ', -1', /co2_refunds_emissions_not_negative/],
      ['m', ', co2_cost_cents', ', -1', /co2_refunds_co2_cost_not_negative/],
      ['n', ', grid_fee_cents', ', -1', /co2_refunds_grid_fee_not_negative/],
      ['o', ', bio_cost_cents', ', -1', /co2_refunds_bio_cost_not_negative/],
    ]
    for (const [id, cols, vals, name] of cases) assert.match(rejects(c, ins(id, cols, vals)) ?? '', name, id)
    assert.match(rejects(c, `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents) VALUES ('d', 't', '2025-01-20', '2025-03-01', -1)`) ?? '', /co2_refunds_amount_not_negative/)
    assert.match(rejects(c, `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents) VALUES ('i', 't', '2025-01-20', '01.03.2025', 0)`) ?? '', /co2_refunds_claimed_at_valid/)
    assert.match(rejects(c, `INSERT INTO co2_refunds (id, tenancy_id, supplier_billed_at, claimed_at, amount_cents) VALUES ('i2', 't', '20.01.2025', '2025-03-01', 0)`) ?? '', /co2_refunds_billed_at_valid/)
    c.exec(`DELETE FROM tenancies WHERE id = 't'`)
    assert.deepEqual(c.rows('SELECT COUNT(*) FROM co2_refunds'), [[0]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Jede Bedingung der Tabelle hat einen eigenen deutschen Satz, keinen über Monate in der Form JJJJ-MM, außer dem Zeitraum', () => {
  const own = ['co2_refunds_settled_or_paid_valid', 'co2_refunds_billed_order_valid', 'co2_refunds_billed_complete', 'co2_refunds_metered_valid', 'co2_refunds_paid_out_valid',
    'co2_refunds_half_split_valid', 'co2_refunds_claimed_at_valid', 'co2_refunds_billed_at_valid', 'co2_refunds_billed_from_valid', 'co2_refunds_billed_to_valid']
  for (const name of own) {
    const p = databaseProblem(new Error('Failed query: insert …', { cause: new Error(`CHECK constraint failed: ${name}`) })) ?? assert.fail(name)
    assert.ok(!/JJJJ-MM \(|Gemeinschaft|Wert ist nicht zulässig/.test(p.message), `${name}: ${p.message}`)
    assert.equal(p.status, 400)
  }
})

test('Lesen: Stock führt die Erstattungen in der Reihenfolge der Anlage', async () => {
  const dir = tempDir()
  try {
    const opened = await openFreshDatabase(dir)
    try {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'w', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
        await createEntity(db, 'tenancies', 't', { unitId: 'w', tenantName: 'Mieter', start: '2020-01-01', heatingModel: 'selfSupply' })
      })
      await opened.write(async (db) => {
        await db.insert(co2Refunds).values([
          { id: 'z', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000 },
          { id: 'a', tenancyId: 't', supplierBilledAt: '2026-01-20', claimedAt: '2026-02-01', amountCents: 100, ownAppliances: true, restriction: 'building' },
        ])
      })
      const stock = await opened.read((db) => readStock(db))
      assert.deepEqual(stock.co2Refunds.map((r) => [r.id, r.amountCents, r.settlePeriod, r.ownAppliances, r.restriction, r.halfSplitFrom]), [
        ['z', 24000, null, false, 'none', null],
        ['a', 100, null, true, 'building', null],
      ])
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Wiederherstellen: ein Verrechnungszeitraum, den es für das Objekt nicht gibt, ist ein Befund', async () => {
  const dir = tempDir()
  try {
    const opened = await openFreshDatabase(dir)
    try {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'w', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
        await createEntity(db, 'tenancies', 't', { unitId: 'w', tenantName: 'Mieter', start: '2020-01-01', heatingModel: 'selfSupply' })
        // Kalenderjahre: '2025-05' ist kein Zeitraum des Objekts.
        await db.insert(co2Refunds).values({ id: 'x', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 1, settlePeriod: periodKey('2025-05') })
      })
      assert.deepEqual(await opened.read(orphanPeriodKeys), ['Die CO₂-Erstattung von „Mieter“ steht unter dem Zeitraum 2025-05, den es für das Objekt nicht gibt.'])
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
