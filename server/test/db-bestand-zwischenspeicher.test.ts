// Der Bestand bleibt zwischen zwei Lesevorgängen liegen, solange niemand schreibt (#651).
//
// `readStock` liest alle Tabellen der Installation; bei einem großen Bestand (perf-stock.mjs, Stufe m)
// sind das rund 190 ms je Anfrage, und eine Seite stellt mehrere. Weil alle Zugriffe durch eine
// Schlange laufen, ist „seit dem letzten Lesen wurde nicht geschrieben“ eine sichere Auskunft:
// Die Datenbank zählt eigene Schreibvorgänge, und `PRAGMA data_version` meldet die einer zweiten
// Verbindung (Tests mit `besideServer`).
//
// Geprüft wird, was schiefgehen kann, wenn ein Zwischenspeicher veraltet: ein Schreibvorgang, der
// danach nicht sichtbar wäre, ein Lesen im Schreibvorgang, das den eigenen Stand nicht sähe, ein
// zurückgerollter Vorgang, eine zweite Verbindung, und ein Aufrufer, der den geteilten Bestand
// verändert und damit allen folgenden Anfragen etwas Falsches unterschöbe.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, insertEntityIn } from '../src/db/repository.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { besideServer } from '../testing/api.ts'

async function withDatabase(work: (opened: OpenedDatabase, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zwischenspeicher-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened, dataDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const unitBody = (name: string) => ({ propertyId: 'objekt-1', name, areaM2: 80, participates: true })
const unitNames = (stock: { units: { name: string }[] }): string[] => stock.units.map((u) => u.name)

test('Zwischenspeicher: zwei Lesevorgänge ohne Schreiben teilen denselben Bestand', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    const first = await opened.read((db) => readStock(db))
    const second = await opened.read((db) => readStock(db))
    assert.equal(second, first, 'derselbe Bestand, nicht ein zweites Mal gelesen')
    assert.deepEqual(unitNames(second), ['EG'])
  })
})

test('Zwischenspeicher: nach einem Schreibvorgang wird neu gelesen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    const before = await opened.read((db) => readStock(db))
    await opened.write((db) => createEntity(db, 'units', 'u2', unitBody('OG')))
    const after = await opened.read((db) => readStock(db))
    assert.notEqual(after, before)
    assert.deepEqual(unitNames(after), ['EG', 'OG'])
  })
})

test('Zwischenspeicher: ein Lesen im Schreibvorgang sieht dessen eigene Änderung', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    await opened.read((db) => readStock(db))
    const inside = await opened.write(async (db) => {
      await createEntity(db, 'units', 'u2', unitBody('OG'))
      return unitNames(await readStock(db))
    })
    assert.deepEqual(inside, ['EG', 'OG'])
    // Ein Lesen in einem Schreibvorgang darf auch nicht als Stand nach dem Vorgang liegen bleiben.
    const midway = await opened.write(async (db) => {
      const seen = await readStock(db)
      await createEntity(db, 'units', 'u3', unitBody('DG'))
      return seen
    })
    assert.deepEqual(unitNames(midway), ['EG', 'OG'])
    assert.deepEqual(unitNames(await opened.read((db) => readStock(db))), ['EG', 'OG', 'DG'])
  })
})

test('Zwischenspeicher: ein gescheiterter Schreibvorgang hinterlässt keinen veralteten Stand', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    await opened.read((db) => readStock(db))
    await assert.rejects(opened.write((db) => db.transaction(async (tx) => {
      await insertEntityIn(tx, 'units', 'u2', unitBody('OG'))
      throw new Error('abgebrochen')
    })))
    assert.deepEqual(unitNames(await opened.read((db) => readStock(db))), ['EG'])
    // Ohne Transaktion bleibt, was vor dem Fehler geschrieben war; auch das muss zu sehen sein.
    await assert.rejects(opened.write(async (db) => {
      await createEntity(db, 'units', 'u3', unitBody('DG'))
      throw new Error('abgebrochen')
    }))
    assert.deepEqual(unitNames(await opened.read((db) => readStock(db))), ['EG', 'DG'])
  })
})

test('Zwischenspeicher: eine Änderung über eine zweite Verbindung wird gesehen', async () => {
  await withDatabase(async (opened, dataDir) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    assert.deepEqual(unitNames(await opened.read((db) => readStock(db))), ['EG'])
    const beside = await besideServer(dataDir)
    try {
      beside.exec("UPDATE units SET name = 'Erdgeschoss' WHERE id = 'u1'")
    } finally {
      beside.close()
    }
    assert.deepEqual(unitNames(await opened.read((db) => readStock(db))), ['Erdgeschoss'])
  })
})

test('Zwischenspeicher: der geteilte Bestand lässt sich nicht verändern', async () => {
  // Ein Aufrufer, der sortiert, anhängt oder ein Feld setzt, veränderte sonst den Bestand aller
  // folgenden Anfragen, und das fiele erst an einer falschen Zahl auf.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', unitBody('EG')))
    const stock = await opened.read((db) => readStock(db))
    const unit = stock.units[0]
    if (!unit) return assert.fail('die Wohnung fehlt')
    assert.throws(() => { stock.units.push(unit) }, TypeError)
    assert.throws(() => { unit.name = 'anders' }, TypeError)
    assert.throws(() => { stock.settings.houseName = 'anders' }, TypeError)
  })
})
