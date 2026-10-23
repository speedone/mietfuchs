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
import { closeSettlement, createEntity, HeatingError, orphanPeriodKeys, PeriodError } from '../src/db/repository.ts'
import { createRefund, listRefunds, removeRefund, updateRefund } from '../src/db/co2Refunds.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
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

// ---------- Lesen und Schreiben mit Prüfungen (Task 4) ----------

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const rejectsWith = (status: number, text: RegExp) => (e: unknown) =>
  (e instanceof HeatingError || e instanceof PeriodError) && e.status === status && text.test(e.message)
const anzeige = { tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: 2400, co2CostCents: 60000, areaM2: 80 }

async function seed(opened: OpenedDatabase, heatingModel: string | null = 'selfSupply'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'w', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
    await createEntity(db, 'tenancies', 't', { unitId: 'w', tenantName: 'Mieter', persons: 1, start: '2020-01-01', end: '2025-06-30', heatingModel, prepayments: [{ from: '2020-01', monthlyCents: 10000 }] })
  })
}

test('Anlegen, Lesen mit Nachrechnung und Fristen, Ändern, Löschen', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    const r = await opened.write((db) => createRefund(db, 'e1', { ...anzeige, settlePeriod: '2025-01' }))
    assert.deepEqual([r.amountCents, r.settlePeriod, r.restriction, r.ownAppliances], [24000, '2025-01', 'none', false])
    const [v] = await opened.read((db) => listRefunds(db, 'objekt-1'))
    assert.deepEqual([v?.tenantName, v?.unitName, v?.settleLabel, v?.claimDeadline, v?.refundDue, v?.proposalCents], ['Mieter', 'EG', '2025', '2026-01-20', '2026-03-01', 24000])
    const neu = await opened.write((db) => updateRefund(db, 'e1', { ownAppliances: true, amountCents: 22800 }))
    assert.deepEqual([neu?.ownAppliances, neu?.amountCents, neu?.settlePeriod], [true, 22800, '2025-01'])
    assert.equal(await opened.write((db) => updateRefund(db, 'gibt-es-nicht', { amountCents: 1 })), null)
    assert.equal(await opened.write((db) => removeRefund(db, 'e1')), true)
    assert.equal(await opened.write((db) => removeRefund(db, 'e1')), false)
    assert.deepEqual(await opened.read((db) => listRefunds(db, 'objekt-2')), [])
  })
})

test('Prüfung M4: eine Erstattung nur an einem Mietverhältnis, dessen Mieter selbst heizt', async () => {
  await withDatabase(async (opened) => {
    await seed(opened, null)
    await assert.rejects(opened.write((db) => createRefund(db, 'x', anzeige)),
      rejectsWith(400, /^Eine CO₂-Erstattung nach § 6 Abs\. 2 CO2KostAufG steht nur einem Mieter zu, der sich selbst mit Wärme versorgt, also den Brennstoff oder die Wärme über einen eigenen Vertrag bezieht\. Stellen Sie in den Stammdaten bei Mieter die Heizung auf „Mieter heizt selbst“, wenn das zutrifft\.$/))
  })
})

test('Review Focus 2: kein Verrechnen in einem Zeitraum ohne Mietzeit oder in einem abgeschlossenen; Prüfung S9: keine Änderung dort', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    await assert.rejects(opened.write((db) => createRefund(db, 'x', { ...anzeige, settlePeriod: '2026-01' })), rejectsWith(400, /wohnte im Zeitraum 2026 nicht/))
    await assert.rejects(opened.write((db) => createRefund(db, 'x', { ...anzeige, settlePeriod: '2025-05' })), rejectsWith(400, /Zeitraum 2025-05 gibt es für dieses Objekt nicht/))
    const r = await opened.write((db) => createRefund(db, 'y', { ...anzeige, settlePeriod: '2025-01' }))
    await opened.write((db) => closeSettlement(db, { id: 'c', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => createRefund(db, 'z', { ...anzeige, settlePeriod: '2025-01' })), rejectsWith(409, /abgeschlossen/))
    // S9: auch Betrag oder Grundlagen einer dort verrechneten Erstattung bleiben, und löschen geht nicht.
    await assert.rejects(opened.write((db) => updateRefund(db, r.id, { amountCents: 1 })), rejectsWith(409, /abgeschlossenen Abrechnung verrechnet/))
    await assert.rejects(opened.write((db) => removeRefund(db, r.id)), rejectsWith(409, /abgeschlossenen Abrechnung verrechnet/))
    const offen = await opened.write((db) => createRefund(db, 'o', anzeige))
    assert.equal(offen.settlePeriod, null)
  })
})

test('Integrationsdurchsicht S1: kein Verrechnen bei einem Mieter, der für den Zeitraum keine Abrechnung bekommt (Inklusivmiete, Wohnung außerhalb)', async () => {
  // Mieter B heizt selbst und zahlt Inklusivmiete ohne Vorauszahlung: Er bekommt für 2025 keine Abrechnung, eine dort zum
  // Verrechnen eingetragene Erstattung von 120,00 € verschwand still. Jetzt lehnt das Speichern ab und verweist auf die
  // Auszahlung; auszahlen und offen lassen geht weiter.
  const satz = (why: string) => new RegExp(`^Mieter B bekommt für 2025 keine Abrechnung \\(${why}\\)\\. Verrechnen lässt sich die CO₂-Erstattung deshalb nicht; zahlen Sie sie aus und tragen Sie den Tag der Auszahlung ein \\(§ 6 Abs\\. 2 Satz 5 CO2KostAufG\\)\\.$`)
  const b = { tenancyId: 'tb', supplierBilledAt: '2025-10-01', claimedAt: '2025-11-01', amountCents: 12000 }
  for (const [name, unit, tenancy] of [
    ['Inklusivmiete ohne Vorauszahlung', { participates: true }, { costModel: 'inclusive' }],
    ['die Wohnung gehört nicht zur Abrechnungseinheit', { participates: false }, { prepayments: [{ from: '2020-01', monthlyCents: 10000 }] }],
    // Durchsicht von PR #426, K-1: ganz in einer Zeit, in der die Einheit nicht vermietet ist (#259).
    ['laut der Nutzung der Einheit in diesem Zeitraum nicht vermietet', { participates: true, usageChanges: [{ from: '2025-03-01', usage: 'eigen' }] }, { start: '2025-03-01', prepayments: [{ from: '2025-03', monthlyCents: 10000 }] }],
  ] as const) {
    await withDatabase(async (opened) => {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
        await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, ...unit })
        await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 10000 }] })
        await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01', heatingModel: 'selfSupply', ...tenancy })
        await createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' })
      })
      await assert.rejects(opened.write((db) => createRefund(db, 'x', { ...b, settlePeriod: '2025-01' })), rejectsWith(400, satz(name)), name)
      const offen = await opened.write((db) => createRefund(db, 'o', b))
      await assert.rejects(opened.write((db) => updateRefund(db, offen.id, { settlePeriod: '2025-01' })), rejectsWith(400, satz(name)), name)
      const aus = await opened.write((db) => updateRefund(db, offen.id, { paidOutOn: '2025-12-01' }))
      assert.equal(aus?.paidOutOn, '2025-12-01', name)
    })
  }
})

test('Prüfungen: Anzeige vor der Abrechnung des Lieferanten, verrechnet und ausgezahlt, § 5a vor 2028, Zeitraum halb', async () => {
  await withDatabase(async (opened) => {
    await seed(opened)
    await assert.rejects(opened.write((db) => createRefund(db, 'a', { ...anzeige, claimedAt: '2025-01-10' })), rejectsWith(400, /vor der Abrechnung des Lieferanten/))
    await assert.rejects(opened.write((db) => createRefund(db, 'b', { ...anzeige, settlePeriod: '2025-01', paidOutOn: '2025-04-01' })), rejectsWith(400, /verrechnet oder ausgezahlt/))
    await assert.rejects(opened.write((db) => createRefund(db, 'c', { ...anzeige, halfSplitFrom: '2027-06-01' })), rejectsWith(400, /01\.01\.2028/))
    await assert.rejects(opened.write((db) => createRefund(db, 'd', { ...anzeige, gridFeeCents: 100 })), rejectsWith(400, /§ 5a/))
    await assert.rejects(opened.write((db) => createRefund(db, 'e', { ...anzeige, tenancyId: 'gibt-es-nicht' })), rejectsWith(400, /Mietverhältnis/))
    await assert.rejects(opened.write((db) => createRefund(db, 'f', { ...anzeige, billedTo: null })), rejectsWith(400, /Beginn und Ende/))
    await assert.rejects(opened.write((db) => createRefund(db, 'g', { ...anzeige, claimedAt: '01.03.2025' })), rejectsWith(400, /kein Datum/))
    await assert.rejects(opened.write((db) => createRefund(db, 'h', { ...anzeige, amountCents: -5 })), rejectsWith(400, /Betrag/))
    // § 11 Abs. 2: Vor 2023 gibt es keine CO₂-Kosten, also auch keine Erstattung.
    await assert.rejects(opened.write((db) => createRefund(db, 'j', { ...anzeige, supplierBilledAt: '2022-12-20', billedFrom: '2022-01-01', billedTo: '2022-12-31' })), rejectsWith(400, /ab dem 01\.01\.2023/))
    const m = await opened.write((db) => createRefund(db, 'i', { ...anzeige, commercialMetered: true }))
    assert.equal(m.commercialMetered, false, 'ohne gewerbliche Nutzung keine getrennte Messung')
  })
})
