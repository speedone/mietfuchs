// Das Zahlungsdatum `paid_on` an der Kostenposition (#255, PR 3): Spalte, Schreibprüfung und Rückfrage (R-2, R-4,
// R-6), Backup, Aufteilen, Wechsel des Abrechnungszeitraums und die Belegbuchung, die das Rechnungsdatum nicht als
// Zahlungsdatum nimmt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readCostItems } from '../src/db/read.ts'
import { createEntity, PaidOnQuestion, PeriodError, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { writeDatabaseSnapshot } from '../src/db/backup.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { costItemBody } from '../../shared/costItem.ts'
import { lineDraft } from '../src/assessment.ts'
import { connect, loadMigrations } from '../src/db/client.ts'
import type { CostItem, PeriodRules } from '../../shared/types.ts'
import { periodKey } from '../../shared/period.ts'

let n = 0
const ids = () => `z-${++n}`

async function withDatabase(work: (opened: OpenedDatabase, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zahlungsdatum-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened, dataDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const item = async (opened: OpenedDatabase, id: string): Promise<CostItem> =>
  (await opened.read((db) => readCostItems(db))).find((c) => c.id === id) ?? assert.fail(`keine Position ${id}`)
const base = { propertyId: 'objekt-1', period: '2026-01', category: 'Sach- und Haftpflichtversicherung', description: 'Versicherung', amountCents: 60000, key: 'area' }

async function wohnung(opened: OpenedDatabase): Promise<void> {
  await opened.write((db) => createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true }))
}

test('Spalte: das Datum wird gespeichert, gelesen und mit null geleert; ohne Angabe fehlt es', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await opened.write((db) => createEntity(db, 'costItems', 'v', { ...base, paidOn: '2026-03-15' }))
    assert.equal((await item(opened, 'v')).paidOn, '2026-03-15')
    // Ein Rumpf ohne das Feld (Belegordner „Betrag prüfen“) lässt es stehen.
    await opened.write((db) => updateEntity(db, 'costItems', 'v', { amountCents: 61000 }))
    assert.equal((await item(opened, 'v')).paidOn, '2026-03-15')
    await opened.write((db) => updateEntity(db, 'costItems', 'v', { paidOn: null }))
    assert.equal('paidOn' in (await item(opened, 'v')), false)
    await opened.write((db) => createEntity(db, 'costItems', 'w', base))
    assert.equal('paidOn' in (await item(opened, 'w')), false)
  })
})

test('Spalte: ein Datum, das keines ist, wird abgelehnt (400), auch an der Datenbank vorbei', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    for (const bad of ['2026-02-30', '15.03.2026', 2026]) {
      await assert.rejects(opened.write((db) => createEntity(db, 'costItems', ids(), { ...base, paidOn: bad })), (e: unknown) => e instanceof PeriodError, String(bad))
    }
    // Die Prüfbedingung hält auch, wenn jemand an der Schreibprüfung vorbei schreibt.
    await opened.write((db) => createEntity(db, 'costItems', 'r', base))
    await assert.rejects(opened.write(async (db) => db.run(`UPDATE cost_items SET paid_on = '2026-3-1' WHERE id = 'r'`)))
  })
})

test('R-6 und #267: kein Datum bei „laut Gemeinschaftsabrechnung“, und am Abzug beim Betriebsstrom wird es geleert', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    const external = { ...base, category: 'Hausmeister', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 600000 } }
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'e', { ...external, paidOn: '2026-05-01' })),
      (e: unknown) => e instanceof PeriodError && /Gemeinschaftsabrechnung/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'e', external))
  })
})

test('R-2: ein Datum, das das wirksame Jahr ändert, braucht die Bestätigung; im selben Jahr nicht', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await opened.write((db) => createEntity(db, 'costItems', 'gleich', { ...base, paidOn: '2026-11-30' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'spaet', { ...base, paidOn: '2027-02-10' })),
      (e: unknown) => e instanceof PaidOnQuestion && e.status === 409 && /zu 2027 statt zu 2026/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'spaet', { ...base, paidOn: '2027-02-10', confirmPaidOn: true }))
    assert.equal((await item(opened, 'spaet')).paidOn, '2027-02-10')
    // Nur der Betrag: nichts zu bestätigen.
    await opened.write((db) => updateEntity(db, 'costItems', 'spaet', { amountCents: 70000, paidOn: '2027-02-10' }))
    // Entfernen ändert das Jahr zurück: ebenfalls nachfragen.
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'spaet', { paidOn: null })), (e: unknown) => e instanceof PaidOnQuestion)
    // Ein anderes Datum im selben Jahr: keine Frage.
    await opened.write((db) => updateEntity(db, 'costItems', 'spaet', { paidOn: '2027-03-01' }))
  })
})

test('R-4: außerhalb der Spanne Beginn − 1 bis Ende + 3 fragt Mietfuchs nach, statt abzulehnen', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x', { ...base, paidOn: '2030-01-15' })),
      (e: unknown) => e instanceof PaidOnQuestion && /außerhalb der üblichen Spanne von 2025 bis 2029/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'x', { ...base, paidOn: '2030-01-15', confirmPaidOn: true }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'y', { ...base, paidOn: '2024-12-01' })), (e: unknown) => e instanceof PaidOnQuestion)
  })
})

test('R-2: ein Datum gegen ein gesetztes Jahr der Zahlung wird angezeigt und bestätigt; mit Datum ist das Jahr keine Pflicht', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await opened.write((db) => db.run(`UPDATE properties SET period_start_month = 5 WHERE id = 'objekt-1'`))
    const mai = { ...base, period: '2026-05' }
    await opened.write((db) => createEntity(db, 'costItems', 'm', { ...mai, taxYear: 2026 }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'm', { paidOn: '2027-01-12' })),
      (e: unknown) => e instanceof PaidOnQuestion && /Als Jahr der Zahlung ist 2026 angegeben/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'm', { paidOn: '2027-01-12', confirmPaidOn: true }))
    const m = await item(opened, 'm')
    assert.deepEqual([m.taxYear, m.paidOn], [2026, '2027-01-12'], 'das Jahr bleibt stehen, das Datum geht vor')
    // Ein Zeitraum über zwei Jahre verlangt ein Jahr der Zahlung oder ein Datum.
    await opened.write((db) => createEntity(db, 'costItems', 'n', { ...mai, paidOn: '2026-06-01' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'o', mai)), (e: unknown) => e instanceof PeriodError)
  })
})

test('Aufteilen: jeder Teil trägt das Datum der ganzen Zahlung, gefragt wird einmal', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await opened.write((db) => db.run(`UPDATE properties SET period_start_month = 5 WHERE id = 'objekt-1'`))
    const body = { ...base, period: '2026-05', serviceFrom: '2026-01-01', serviceTo: '2026-12-31', taxYear: 2026, paidOn: '2027-02-01' }
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', body, null, ids)), (e: unknown) => e instanceof PaidOnQuestion)
    const parts = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', { ...body, confirmPaidOn: true }, null, ids))
    assert.equal(parts.length, 2)
    assert.deepEqual(parts.map((p) => p.paidOn), ['2027-02-01', '2027-02-01'])
  })
})

test('Wechsel des Abrechnungszeitraums: das Datum bleibt und wird nicht erneut gefragt', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened)
    await opened.write((db) => createEntity(db, 'costItems', 'v', { ...base, period: '2025-01', paidOn: '2026-02-01', confirmPaidOn: true }))
    const rules: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', rules, '2026-10-05'))) ?? assert.fail('kein Objekt')
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.options[0]?.key ?? '']))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', rules, { understood: true, groups, taxYears: {}, token: preview.token }, ids, '2026-10-05'))
    assert.ok(r !== null && !('error' in r), JSON.stringify(r))
    const all = await opened.read((db) => readCostItems(db))
    assert.ok(all.length > 0 && all.every((c) => c.paidOn === '2026-02-01'), JSON.stringify(all.map((c) => [c.period, c.paidOn])))
  })
})

test('Backup: das Datum steckt im Schnappschuss und kommt beim Öffnen wieder', async () => {
  await withDatabase(async (opened, dataDir) => {
    await wohnung(opened)
    await opened.write((db) => createEntity(db, 'costItems', 'v', { ...base, paidOn: '2027-02-10', confirmPaidOn: true }))
    const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zahlungsdatum-backup-'))
    try {
      await writeDatabaseSnapshot(opened, path.join(ziel, 'mietfuchs.sqlite'))
      const wieder = await openDatabase({ dataDir: ziel })
      try {
        const c = (await wieder.read((db) => readCostItems(db))).find((x) => x.id === 'v')
        assert.equal(c?.paidOn, '2027-02-10')
      } finally {
        wieder.close()
      }
    } finally {
      fs.rmSync(ziel, { recursive: true, force: true })
    }
    void dataDir
  })
})

test('Migration: eine Datenbank von vor dem Schritt bekommt die Spalte leer', async () => {
  const migrations = await loadMigrations()
  assert.ok(migrations.some((m) => m.tag.endsWith('_zahlungsdatum')), 'Schritt …_zahlungsdatum fehlt')
  await withDatabase(async (opened, dataDir) => {
    await wohnung(opened)
    await opened.write((db) => createEntity(db, 'costItems', 'v', base))
    const c = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
    try {
      assert.deepEqual(c.rows(`SELECT paid_on FROM cost_items WHERE id = 'v'`), [[null]])
    } finally {
      c.close()
    }
  })
})

test('Belegbuchung: das Rechnungsdatum ist kein Zahlungsdatum, eine gebuchte Position hat keines', () => {
  const draft = lineDraft({ amountCents: 12000, description: 'Wasser', category: 'Wasserversorgung', labor35aCents: null, key: 'area', externalTotalCents: null } as unknown as Parameters<typeof lineDraft>[0], { vendor: 'Stadtwerke', invoiceFile: 'b.pdf' }, [])
  const built = costItemBody(draft, [], periodKey('2026-01'))
  if (!('body' in built)) assert.fail(built.error)
  assert.equal(built.body.paidOn, null)
})

// Durchsicht S1: Beim Wechsel des Abrechnungszeitraums bleibt das Datum stehen und geht vor; das Steuerjahr einer
// datierten Position verschiebt sich also nie. Die Vorschau kündigt deshalb nichts an, fragt kein Jahr der Zahlung und
// wählt die Vorgabe nicht aus einer Verschiebung, die es nicht gibt. Beide Fälle aus R-9.
test('Wechsel des Zeitraums: mit Datum keine angekündigte Verschiebung des Steuerjahres (R-9, beide Fälle)', async () => {
  for (const paidOn of ['2026-02-10', '2024-12-01']) {
    await withDatabase(async (opened) => {
      await wohnung(opened)
      await opened.write((db) => createEntity(db, 'costItems', 'v', { ...base, period: '2025-01', paidOn, confirmPaidOn: true }))
      const rules: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
      const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', rules, '2026-10-05'))) ?? assert.fail('kein Objekt')
      assert.ok(preview.groups.length > 0, 'eine Gruppe')
      for (const g of preview.groups) {
        assert.deepEqual(g.taxShifts, [], `${paidOn}: ${JSON.stringify(g.taxShifts)}`)
        assert.ok(!(g.split?.notes ?? []).some((n) => n.includes('für die Steuer')), `${paidOn}: ${JSON.stringify(g.split?.notes)}`)
        if (g.split !== null) assert.equal(g.suggested, 'split', paidOn)
      }
      assert.deepEqual(preview.taxYears.filter((t) => t.costItemId === 'v'), [], `${paidOn}: kein Jahr der Zahlung gefragt`)
    })
  }
})
