// Eigene Heizperiode im Bestand (Heizung PR 5, Entwurf 3.0, 3.1, 5.3): lesen, schreiben und die
// Schreibprüfungen. Den Rhythmus setzt hier der Test unmittelbar in der Tabelle; über die Route mit
// Vorschau geht es in db-heizperiode-wechsel.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, orphanPeriodKeys, PeriodError, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, listHeatingPlants, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { heatingPeriodChanges, heatingPlants, heatingPrepaymentOverrides, heatingSeparateSpans } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizperiode-'))
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

// Ein Haus im Kalenderjahr mit einer Wohnung, einem Mieter und einer Anlage, die Mai bis April
// abrechnet, ab der Heizperiode 2025/2026 getrennt (Weg d).
async function haus(db: Database): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })
  await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
  await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
  await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
}

const korrektur = (period: string, cents: number, monate?: [string, string]) => ({
  plantId: 'hp1', period, cents, provisional: monate !== undefined, fromMonth: monate?.[0] ?? null, toMonth: monate?.[1] ?? null,
})

test('Lesen: Wechsel und Spannen der Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await db.insert(heatingPeriodChanges).values({ plantId: 'hp1', fromMonth: '2027-01' })
    })
    const [anlage] = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual([anlage?.periodStartMonth, anlage?.periodChanges, anlage?.separateSpans], [5, ['2027-01'], [{ from: '2025-05', until: null }]])
  })
})

test('Heizstaffel und Heizkorrektur: lesen, schreiben, ganz ersetzen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', {
      prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }],
      heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
      heatingPrepaymentOverrides: [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])],
    }))
    const t = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    assert.deepEqual(fieldOf(t, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
    assert.deepEqual(fieldOf(t, 'heatingPrepaymentOverrides'), [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])])
    // Ein Rumpf ohne die Felder lässt sie stehen (Teilrumpf, wie beim Auszug).
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { end: '2027-04-30' }))
    assert.deepEqual(fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingPrepaymentOverrides: [] }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), 'heatingPrepaymentOverrides'), undefined)
  })
})

test('Heizkorrektur: fremde Anlage, Heizperiode, die es nicht gibt, Monate außerhalb', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp2', 'objekt-2', { energy: 'oil' })
    })
    const setzen = (o: unknown) => opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingPrepaymentOverrides: [o] }))
    await assert.rejects(setzen({ ...korrektur('2025-01', 100), plantId: 'hp2' }), (e: unknown) => e instanceof CrossPropertyError && /Heizanlage aber zu/.test(e.message))
    await assert.rejects(setzen(korrektur('2026-01', 100)), (e: unknown) => e instanceof PeriodError && /Heizperiode, die es für die Heizanlage nicht gibt/.test(e.message))
    await assert.rejects(setzen(korrektur('2025-05', 100, ['2026-05', '2026-12'])), (e: unknown) => e instanceof PeriodError && /außerhalb der Heizperiode 2025\/2026/.test(e.message))
    // Vor der Spanne wird die Heizperiode nicht getrennt abgerechnet; dort gilt die Jahreskorrektur der Abrechnung (3.7).
    await assert.rejects(setzen(korrektur('2024-05', 100)), (e: unknown) => e instanceof PeriodError && /nur für eine getrennt abgerechnete Heizperiode/.test(e.message))
    await assert.rejects(setzen({ ...korrektur('2025-05', 100), plantId: 'gibt-es-nicht' }), (e: unknown) => e instanceof HeatingError && e.status === 400)
  })
})

test('Heizposition einer Anlage mit eigener Heizperiode: nur unter einer ihrer Heizperioden (G-A2)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    const position = (id: string, over: Record<string, unknown>) => opened.write((db) => createEntity(db, 'costItems', id, {
      propertyId: 'objekt-1', category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', heatingPlantId: 'hp1', ...over,
    }))
    await assert.rejects(position('c1', { period: '2026-01' }), (e: unknown) => e instanceof PeriodError && /meinen Sie 2025\/2026/.test(e.message))
    await assert.rejects(position('c2', { period: '2025-05' }), (e: unknown) => e instanceof PeriodError && /Jahr der Zahlung/.test(e.message))
    const ok = await position('c3', { period: '2025-05', taxYear: 2026 })
    assert.deepEqual([fieldOf(ok, 'period'), fieldOf(ok, 'heatingPlantId'), fieldOf(ok, 'taxYear')], ['2025-05', 'hp1', 2026])
  })
})

test('Alter Tab: eine Heizposition unter dem Objektzeitraum kommt in die Heizperiode, die darin endet (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    const neu = await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 100000, key: 'area',
    }))
    assert.deepEqual([fieldOf(neu, 'period'), fieldOf(neu, 'heatingPlantId'), fieldOf(neu, 'taxYear')], ['2025-05', 'hp1', 2026])
    const kalt = await opened.write((db) => createEntity(db, 'costItems', 'c2', {
      propertyId: 'objekt-1', period: '2026-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 40000, key: 'area',
    }))
    assert.deepEqual([fieldOf(kalt, 'period'), fieldOf(kalt, 'heatingPlantId')], ['2026-01', undefined])
  })
})

test('Anlage: den Rhythmus setzt PUT nie; getrennt abgerechnet nur ohne eigene Heizperiode', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await assert.rejects(opened.write((db) => createHeatingPlant(db, 'hp0', 'objekt-1', { energy: 'gas', periodStartMonth: 5 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Zeitraum der Heizung/.test(e.message))
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp1', { periodStartMonth: 5 })),
      (e: unknown) => e instanceof HeatingError && /Zeitraum der Heizung/.test(e.message))
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { separateSettlement: true })))?.separateSettlement, true, 'H = P: nur eine Angabe')
    await opened.write((db) => db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1')))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp1', { separateSettlement: false })),
      (e: unknown) => e instanceof HeatingError && /Getrennte Heizkostenabrechnung/.test(e.message))
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { name: 'Kessel' })))?.name, 'Kessel', 'sonst ändert PUT wie bisher')
  })
})

test('Entfernen: Mit Daten nach Weg d bleibt die Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'separate' })
  })
})

test('Wiederherstellen: eine Heizkorrektur unter einer fremden Heizperiode ist ein Befund', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await db.insert(heatingPrepaymentOverrides).values({ tenancyId: 't1', plantId: 'hp1', period: periodKey('2026-01'), cents: 100, provisional: false, fromMonth: null, toMonth: null })
    })
    const befunde = await opened.read(orphanPeriodKeys)
    assert.ok(befunde.some((b) => /Heizvorauszahlung von „Müller“ steht unter der Heizperiode 2026-01/.test(b)), befunde.join(' | '))
  })
})

