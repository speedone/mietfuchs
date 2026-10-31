// Größeren Erhaltungsaufwand verteilen (§ 82b EStDV, #262 PR 1) in der Datenbank: Spalten `cost_items.spread_years`
// und `properties.spread_rest_year` (Schritte …_verteilung_82b und …_verteilung_82b_bedingungen) mit Bedingungen, und
// das Zusammenführen und Prüfen in repository.ts. Gesucht werden die Schritte nach Namen, nicht nach Nummer: Sie werden
// beim Einreihen hinter andere Schritte des Releases neu erzeugt. Entwurf
// docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md, „Daten“ und E-1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readCostItems, readProperties } from '../src/db/read.ts'
import { createEntity, PeriodError, SpreadQuestion, updateEntity, updateProperty } from '../src/db/repository.ts'
import { eq } from 'drizzle-orm'
import { costItems } from '../src/db/schema.ts'
import type { CostItem } from '../../shared/types.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verteilung-'))

test('Kette: Positionen und Objekte von vor dem Schritt bekommen keine Verteilung (NULL); die Bedingungen lassen nur 2 bis 5 und 1900 bis 2200 zu', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_verteilung_82b'))
    if (bis < 0) assert.fail('Schritt …_verteilung_82b fehlt')
    assert.equal(migrations[bis + 1]?.tag.endsWith('_verteilung_82b_bedingungen'), true, 'die Bedingungen folgen unmittelbar')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, tax_year) VALUES
      ('c2', 'objekt-1', '2025-01', 'Nicht umlagefähig', 'Dach', 1000000, 'area', 2025),
      ('c1', 'objekt-1', '2025-01', 'Grundsteuer', 'Grundsteuer', 48000, 'area', NULL)`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows('SELECT id, category, amount_cents, tax_year, spread_years FROM cost_items ORDER BY rowid'), [
      ['c2', 'Nicht umlagefähig', 1000000, 2025, null],
      ['c1', 'Grundsteuer', 48000, null, null],
    ])
    assert.deepEqual(c.rows('SELECT id, spread_rest_year FROM properties ORDER BY rowid'), [['objekt-1', null]])
    for (const ok of [2, 5]) c.exec(`UPDATE cost_items SET spread_years = ${ok} WHERE id = 'c2'`)
    for (const bad of [0, 1, 6, -3]) {
      assert.throws(() => c.exec(`UPDATE cost_items SET spread_years = ${bad} WHERE id = 'c2'`), /cost_items_spread_years_valid/, String(bad))
    }
    for (const ok of [1900, 2030, 2200]) c.exec(`UPDATE properties SET spread_rest_year = ${ok} WHERE id = 'objekt-1'`)
    for (const bad of [1899, 2201, 25]) {
      assert.throws(() => c.exec(`UPDATE properties SET spread_rest_year = ${bad} WHERE id = 'objekt-1'`), /properties_spread_rest_year_valid/, String(bad))
    }
    // Der Neubau hält die übrigen Bedingungen und Fremdschlüssel.
    assert.throws(() => c.exec("UPDATE cost_items SET key = 'unbekannt' WHERE id = 'c1'"), /cost_items_key_known/)
    assert.throws(() => c.exec("UPDATE properties SET state = 'XX' WHERE id = 'objekt-1'"), /properties_state_known/)
    assert.throws(() => c.exec("UPDATE cost_items SET property_id = 'gibt-es-nicht' WHERE id = 'c1'"), /FOREIGN KEY/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function withStock(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write((db) => createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }))
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const dach = { propertyId: 'objekt-1', period: '2026-01', category: 'Nicht umlagefähig', description: 'Dach', amountCents: 1_000_000, key: 'area' }
const spreadOf = async (opened: OpenedDatabase): Promise<[string, number | null][]> =>
  (await opened.read((db) => readCostItems(db))).map((c: CostItem) => [c.id, c.spreadYears ?? null])

test('Repository: Wahl beim Anlegen ohne Rückfrage; ein Teilrumpf lässt sie stehen; null und leer entfernen sie (mit Bestätigung)', async () => {
  await withStock(async (opened) => {
    const c = await opened.write((db) => createEntity(db, 'costItems', 'c', { ...dach, spreadYears: 3 })) as CostItem
    assert.equal(c.spreadYears, 3)
    await opened.write((db) => createEntity(db, 'costItems', 'd', { ...dach, description: 'Fenster' }))
    await opened.write((db) => createEntity(db, 'costItems', 'e', { ...dach, description: 'Entnahme', category: 'Entnahme Erhaltungsrücklage', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 5_000_000 }, spreadYears: 5 }))
    await opened.write((db) => updateEntity(db, 'costItems', 'c', { vendor: 'Dachdecker' }))
    await opened.write((db) => updateEntity(db, 'costItems', 'd', { spreadYears: 2, confirmSpread: true }))
    await opened.write((db) => updateEntity(db, 'costItems', 'd', { spreadYears: null, confirmSpread: true }))
    await opened.write((db) => updateEntity(db, 'costItems', 'e', { spreadYears: '', confirmSpread: true }))
    assert.deepEqual(await spreadOf(opened), [['c', 3], ['d', null], ['e', null]])
  })
})

test('Repository: Setzen, Ändern oder Entfernen an einer gespeicherten Position und ein anderes Jahr an einer verteilten fragen nach (409), gespeichert wird nichts', async () => {
  await withStock(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'c', { ...dach }))
    await opened.write((db) => createEntity(db, 'costItems', 'v', { ...dach, description: 'Fassade', spreadYears: 4 }))
    const asks = async (id: string, body: Record<string, unknown>, pattern: RegExp) => {
      await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', id, body)), (e: unknown) => e instanceof SpreadQuestion && e.status === 409 && pattern.test(e.message))
    }
    await asks('c', { spreadYears: 3 }, /auf 3 Jahre verteilt: Abzug 2026 bis 2028 statt ganz 2026\..*an die Erklärung des ersten Jahres gebunden/)
    await asks('v', { spreadYears: 2 }, /auf 2 Jahre verteilt/)
    await asks('v', { spreadYears: null }, /Ohne Verteilung/)
    await asks('v', { paidOn: '2027-01-08', confirmPaidOn: true }, /Die Verteilung beginnt dann 2027 statt 2026/)
    // Betrag berichtigen fragt nicht.
    await opened.write((db) => updateEntity(db, 'costItems', 'v', { amountCents: 900_000 }))
    assert.deepEqual(await spreadOf(opened), [['c', null], ['v', 4]])
  })
})

test('Repository: an einer Kostenart, die nicht verteilt werden kann, an einer Gutschrift oder mit falschem Wert 400; nichts wird gespeichert', async () => {
  await withStock(async (opened) => {
    const rejects = async (work: Parameters<OpenedDatabase['write']>[0], pattern: RegExp) => {
      await assert.rejects(opened.write(work), (e: unknown) => e instanceof PeriodError && e.status === 400 && pattern.test(e.message))
    }
    const kind = /Verteilen nach § 82b EStDV lässt sich nur „Nicht umlagefähig“ oder „Entnahme Erhaltungsrücklage“/
    await rejects((db) => createEntity(db, 'costItems', 'x', { ...dach, category: 'Grundsteuer', spreadYears: 2 }), kind)
    await rejects((db) => createEntity(db, 'costItems', 'x', { ...dach, category: 'Zuführung Erhaltungsrücklage', spreadYears: 2 }), /Zuführung/)
    await rejects((db) => createEntity(db, 'costItems', 'x', { ...dach, amountCents: -5000, spreadYears: 2 }), /Gutschrift/)
    for (const bad of [1, 6, 2.5, '3', 'drei']) {
      await rejects((db) => createEntity(db, 'costItems', 'x', { ...dach, spreadYears: bad }), /auf 2 bis 5 Jahre/)
    }
    // Die Kostenart oder den Betrag einer verteilten Position so ändern, dass nicht mehr verteilt werden kann: ebenso.
    await opened.write((db) => createEntity(db, 'costItems', 'v', { ...dach, spreadYears: 3 }))
    await rejects((db) => updateEntity(db, 'costItems', 'v', { category: 'Sonstige Betriebskosten' }), kind)
    await rejects((db) => updateEntity(db, 'costItems', 'v', { amountCents: -100 }), /Gutschrift/)
    // Beides zugleich umstellen geht (das Formular schickt null, sobald die Bedingung nicht mehr gilt).
    await opened.write((db) => updateEntity(db, 'costItems', 'v', { category: 'Sonstige Betriebskosten', spreadYears: null, confirmSpread: true }))
    assert.deepEqual(await spreadOf(opened), [['v', null]])
  })
})

test('Repository: eine Wahl, die die Bedingung verletzt und so gespeichert ist (Ablage von Hand), bleibt bei anderen Änderungen stehen (krumm, nicht kaputt)', async () => {
  await withStock(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'g', { ...dach, category: 'Grundsteuer', description: 'Grundsteuer' }))
    await opened.write((db) => db.update(costItems).set({ spreadYears: 3 }).where(eq(costItems.id, 'g')))
    await opened.write((db) => updateEntity(db, 'costItems', 'g', { vendor: 'Stadtkasse' }))
    assert.deepEqual(await spreadOf(opened), [['g', 3]])
  })
})

test('Repository: Jahr des vorzeitigen Endes am Objekt setzen und leeren; außerhalb 1900 bis 2200 oder keine Jahreszahl 400', async () => {
  await withStock(async (opened) => {
    const restYear = async () => (await opened.read((db) => readProperties(db))).map((p) => p.spreadRestYear ?? null)
    assert.deepEqual(await restYear(), [null])
    await opened.write((db) => updateProperty(db, 'objekt-1', { spreadRestYear: 2028 }))
    await opened.write((db) => updateProperty(db, 'objekt-1', { name: 'Haus' }))
    assert.deepEqual(await restYear(), [2028])
    for (const bad of [1899, 2201, 2028.5, '2028', 'zwanzig']) {
      await assert.rejects(opened.write((db) => updateProperty(db, 'objekt-1', { spreadRestYear: bad })), (e: unknown) => e instanceof PeriodError && /Jahr/.test(e.message), String(bad))
    }
    await opened.write((db) => updateProperty(db, 'objekt-1', { spreadRestYear: null }))
    assert.deepEqual(await restYear(), [null])
  })
})
