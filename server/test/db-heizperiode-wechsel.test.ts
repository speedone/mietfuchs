// Wechsel der eigenen Heizperiode (Heizung PR 5, Entwurf 3.0, 3.6, G-A2, B2) und was der Wechsel des
// Objektzeitraums mit Heizpositionen tut.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange, taxYearIn } from '../src/db/heatingPeriodChange.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { closeSettlement, createEntity, findEntity, listCollection, PeriodError, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, listHeatingPlants } from '../src/db/heating.ts'
import { heatingPlants, heatingSeparateSpans } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPeriodChangePreview } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizwechsel-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown =>
  entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined
const heizposition = (db: Database, id: string, period: string, over: Record<string, unknown> = {}) =>
  createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', ...over })
const items = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const preview = async (opened: OpenedDatabase, rules: unknown): Promise<HeatingPeriodChangePreview> =>
  (await opened.read((db) => previewHeatingPeriodChange(db, 'hp1', rules, TODAY))) ?? assert.fail('keine Anlage')
// Der Wechsel mit der Marke der eben erstellten Vorschau, wie die Oberfläche ihn schickt (PR 3: `token`).
const wechseln = async (opened: OpenedDatabase, rules: unknown, answers: Record<string, unknown>) => {
  const { token } = await preview(opened, rules)
  return opened.write((db) => applyHeatingPeriodChange(db, 'hp1', rules, { ...answers, token }, TODAY))
}
const eigeneHeizperiode = (db: Database, startMonth: number) => db.update(heatingPlants).set({ periodStartMonth: startMonth }).where(eq(heatingPlants.id, 'hp1'))

async function haus(db: Database): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })
}

test('G-A2: Beim ersten Einstellen kommt die Messdienstabrechnung 2025/26 von 2026 nach 2025/2026; Abgeschlossenes bleibt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await heizposition(db, 'c2024', '2024-01')
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await heizposition(db, 'c2026', '2026-01')
    })
    const v = await preview(opened, MAI)
    assert.deepEqual(v.blocked, [])
    assert.deepEqual(v.moves.map((m) => [m.costItemId, m.from, m.to, m.toLabel]), [['c2026', '2026-01', '2025-05', '2025/2026']])
    assert.deepEqual(v.groups, [])
    const r = await wechseln(opened, MAI, {})
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.periodStartMonth, r.plant.periodChanges], [5, []])
    const nachher = Object.fromEntries((await items(opened)).map((c) => [c.id, [c.period, c.taxYear, c.heatingPlantId]]))
    assert.deepEqual(nachher, { c2024: ['2024-01', undefined, undefined], c2026: ['2025-05', 2026, 'hp1'] })
  })
})

test('Eine Heizperiode in einer abgeschlossenen Abrechnung sperrt den Wechsel (Review Focus 2)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2024-05', { heatingPlantId: 'hp1', taxYear: 2025 })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} })
    })
    const v = await preview(opened, { startMonth: 1, changes: [] })
    assert.match(v.blocked.join(' '), /Heizperiode 2024\/2025 gehört zur abgeschlossenen Abrechnung 2025/)
    const r = await wechseln(opened, { startMonth: 1, changes: [] }, {})
    assert.ok(r && 'error' in r)
    assert.match(r.error, /Gespeichert wurde nichts/)
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.periodStartMonth, 5)
    assert.equal((await items(opened))[0]?.period, '2024-05')
  })
})

test('B2: Die Heizperiode wechselt auf Januar; die Heizkorrektur wird für den Rumpf und das Jahr neu erfasst', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
      await updateEntity(db, 'tenancies', 't1', {
        prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }],
        heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
        heatingPrepaymentOverrides: [{ plantId: 'hp1', period: '2025-05', cents: 140000, provisional: false, fromMonth: null, toMonth: null }],
        // Die Jahreskorrektur 2026 enthält bei Weg d nur die übrigen Vorauszahlungen (3.7).
        prepaymentOverrides: { '2026-01': 212400 },
      })
    })
    const rules = { startMonth: 5, changes: ['2026-01'] }
    const v = await preview(opened, rules)
    assert.deepEqual(v.newShort, [{ key: '2025-05', label: '01.05.–31.12.2025' }])
    // Der Rumpf 2025-05 bleibt getrennt: Heizkorrektur. 2026 ist H = P: Die Abrechnung 2026 rechnet
    // danach auch die Heizstaffel an, ihre Jahreskorrektur wird deshalb für alles neu erfasst.
    assert.deepEqual(v.overrides.map((o) => [o.tenancyId, o.from.map((f) => [f.kind, f.key, f.cents]), o.ask.map((a) => [a.kind, a.period, a.months])]), [
      ['t1', [['heating', '2025-05', 140000], ['total', '2026-01', 212400]], [['heating', '2025-05', '05–12/2025'], ['total', '2026-01', '01–12/2026']]],
    ])
    // Ab 2026 ist H = P: Diese Heizperioden stehen danach in der Gesamtabrechnung (die Liste reicht
    // bis zum Ende des Jahres nach dem letzten Wechsel).
    assert.deepEqual(v.endsSeparate, [{ key: '2026-01', label: '2026' }, { key: '2027-01', label: '2027' }])
    const ohne = await wechseln(opened, rules, {})
    assert.ok(ohne && 'error' in ohne)
    assert.match(ohne.error, /Müller: tatsächlich gezahlte Heizvorauszahlung 05–12\/2025/)
    const ok = await wechseln(opened, rules, { overrides: { t1: { '2025-05': 90000 } }, totals: { t1: { '2026-01': 360000 } } })
    assert.ok(ok && 'plant' in ok)
    assert.deepEqual(ok.plant.periodChanges, ['2026-01'])
    const t1 = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    assert.deepEqual(fieldOf(t1, 'heatingPrepaymentOverrides'), [{ plantId: 'hp1', period: '2025-05', cents: 90000, provisional: false, fromMonth: null, toMonth: null }])
    assert.deepEqual(fieldOf(t1, 'prepaymentOverrides'), { '2026-01': 360000 })
  })
})

test('Zurück zum Zeitraum des Objekts: die Heizposition kommt in den Zeitraum, in dem ihre Heizperiode endet', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2025-05', { heatingPlantId: 'hp1', taxYear: 2026 })
    })
    const r = await wechseln(opened, null, {})
    assert.ok(r && 'plant' in r)
    assert.equal(r.plant.periodStartMonth, null)
    assert.deepEqual((await items(opened)).map((c) => [c.period, c.taxYear]), [['2026-01', undefined]])
    await assert.rejects(opened.read((db) => previewHeatingPeriodChange(db, 'hp1', null, TODAY)), (e: unknown) => e instanceof PeriodError && /Es ändert sich nichts/.test(e.message))
    assert.equal(await opened.read((db) => previewHeatingPeriodChange(db, 'gibt-es-nicht', MAI, TODAY)), null)
  })
})

test('Wechsel des Objektzeitraums: Heizpositionen der eigenen Heizperiode bleiben, wo sie sind', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2025-05', { heatingPlantId: 'hp1', taxYear: 2026 })
      await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
    })
    const v = await opened.read((db) => previewPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, TODAY)) ?? assert.fail('kein Objekt')
    assert.deepEqual(v.groups.flatMap((g) => g.items.map((i) => i.costItemId)), ['mu'])
    assert.deepEqual(v.blocked, [])
  })
})

test('Wechsel des Objektzeitraums, der Weg d für eine Heizperiode umschalten würde, wird abgelehnt (Review Focus 5)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
    })
    const v = await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI, TODAY)) ?? assert.fail('kein Objekt')
    assert.match(v.blocked.join(' '), /nicht mehr getrennt abgerechnet\. Stellen Sie zuerst unter Stammdaten → Heizung/)
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI, { understood: true }, () => 'neu', TODAY))
    assert.ok(r && 'error' in r)
  })
})

test('Eine veraltete Vorschau schreibt nichts (Marke wie beim Wechsel des Objektzeitraums)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await heizposition(db, 'c1', '2026-01')
    })
    const { token } = await preview(opened, MAI)
    await opened.write((db) => heizposition(db, 'c2', '2025-01'))
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', MAI, { token }, TODAY))
    assert.ok(r && 'error' in r)
    assert.match(r.error, /nicht mehr aktuell/)
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.periodStartMonth, null)
  })
})

test('Rhythmuswechsel bei Weg d ab Monat X: gefragt werden nur Monate, die die Heizperiode anrechnet (Durchsicht von #231, Minor 5)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2026-01', until: null })
      await updateEntity(db, 'tenancies', 't1', {
        heatingPrepayments: [{ from: '2026-01', monthlyCents: 12300 }],
        heatingPrepaymentOverrides: [{ plantId: 'hp1', period: '2025-05', cents: 40000, provisional: false, fromMonth: null, toMonth: null }],
      })
    })
    // Neu ab November 2025: Die Heizperiode 11/2025–10/2026 reicht über X, ihre Monate November und
    // Dezember 2025 rechnet aber die Abrechnung 2025 an.
    const v = await preview(opened, { startMonth: 5, changes: ['2025-11'] })
    const asks = v.overrides.flatMap((o) => o.ask.map((a) => [a.kind, a.period, a.months]))
    assert.deepEqual(asks.filter(([kind]) => kind === 'heating'), [['heating', '2025-11', '01–10/2026']], JSON.stringify(asks))
  })
})

// Laienprobe B12: „Erdgas 2024“ (Kalenderjahr, ohne Leistungszeitraum) kam beim Umstellen auf Mai bis
// April still in die Heizperiode 05/2023–04/2024, mit der es nur vier Monate teilt. Vorbelegt bleibt
// sie (sie endet in 2024, so steht die Position weiter in der Abrechnung 2024); wählbar ist jede
// Heizperiode, die 2024 berührt, mit Tagen beschriftet, und die Vorschau bittet um Prüfung.
test('Laienprobe B12: Heizpositionen ohne Leistungszeitraum: Auswahl der Heizperiode mit Tagen, Hinweis zum Prüfen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'manual' })
      await heizposition(db, 'gas2024', '2024-01', { description: 'Erdgas 2024' })
    })
    const v = await preview(opened, MAI)
    const m = v.moves.find((x) => x.costItemId === 'gas2024') ?? assert.fail('keine Verschiebung')
    assert.deepEqual([m.to, m.toRange, m.fromRange, m.check], ['2023-05', '01.05.2023–30.04.2024', '01.01.–31.12.2024', true])
    assert.deepEqual(m.options.map((o) => [o.key, o.range]), [['2023-05', '01.05.2023–30.04.2024'], ['2024-05', '01.05.2024–30.04.2025']])
    const r = await wechseln(opened, MAI, { moves: { gas2024: '2024-05' } })
    assert.ok(r && 'plant' in r, JSON.stringify(r))
    assert.equal((await items(opened)).find((c) => c.id === 'gas2024')?.period, '2024-05')
    const falsch = await wechseln(opened, { startMonth: 9, changes: [] }, { moves: { gas2024: '1999-05' } })
    assert.ok(falsch && 'error' in falsch && /Heizperiode für „Erdgas 2024“ wählen/.test(falsch.error))
  })
})

// Review der Laienprobe, Runde 1: das Jahr der Zahlung wie beim Wechsel des Objektzeitraums geklemmt.
test('Review Runde 1: Jahr der Zahlung in der neuen Heizperiode in die erlaubte Spanne geklemmt', () => {
  const h = { from: '2025-05-01', to: '2026-04-30' }
  assert.equal(taxYearIn(h, { taxYear: 2028, period: periodKey('2026-01') }), 2027)
  assert.equal(taxYearIn(h, { taxYear: 2023, period: periodKey('2026-01') }), 2025)
  assert.equal(taxYearIn(h, { period: periodKey('2026-01') }), 2026)
  assert.equal(taxYearIn({ from: '2025-01-01', to: '2025-12-31' }, { taxYear: 2026, period: periodKey('2024-05') }), null)
})
