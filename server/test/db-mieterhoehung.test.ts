// Mieterhöhung, Daten (#191, Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, Datenmodell): Art und
// Indexwert je Stufe der Kaltmiete, Art der Miete und Ausschluss am Mietverhältnis, Kappungsgrenzen-Verordnung am Objekt,
// die (noch leere) Tabelle rent_increases. Spalten aus Schritt …_mieterhoehung_daten, Bedingungen aus dem nächsten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readProperties, readTenancies } from '../src/db/read.ts'
import { createEntity, createProperty, updateEntity, updateProperty } from '../src/db/repository.ts'
import type { RentEntry, Tenancy } from '../../shared/types.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-mieterhoehung-'))

test('Kette: ein Bestand von vor dem Schritt kommt ohne Angaben durch, die Daten bleiben', async () => {
  const dir = tmp()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const at = migrations.findIndex((m) => m.tag.endsWith('_mieterhoehung_daten'))
    if (at < 0) return assert.fail('Schritt …_mieterhoehung_daten fehlt')
    assert.equal(migrations[at + 1]?.tag.endsWith('_mieterhoehung_bedingungen'), true, 'die Bedingungen folgen im nächsten Schritt')
    applyMigrations(c, migrations.slice(0, at))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 2, '2020-04-15')`)
    c.exec(`INSERT INTO base_rents (tenancy_id, "from", monthly_cents) VALUES ('t', '2020-04', 60000), ('t', '2023-07', 66000)`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p', 't', '2025-01-03', 80000)`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows(`SELECT tenancy_id, "from", monthly_cents, reason, index_month, index_tenths, index_base FROM base_rents ORDER BY "from"`), [
      ['t', '2020-04', 60000, null, null, null, null],
      ['t', '2023-07', 66000, null, null, null, null],
    ])
    assert.deepEqual(c.rows(`SELECT id, rent_kind, rent_increase_excluded FROM tenancies`), [['t', null, null]])
    assert.deepEqual(c.rows(`SELECT rent_cap_reduced FROM properties`), [[null]])
    assert.deepEqual(c.rows(`SELECT id FROM payments`), [['p']])
    assert.deepEqual(c.rows(`SELECT count(*) FROM rent_increases`), [[0]])
    assert.deepEqual(c.rows(`PRAGMA foreign_key_check`), [])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Bedingungen: Art aus der Liste, Indexwert ganz oder gar nicht, Wert über 0, Basisjahr vierstellig', async () => {
  const dir = tmp()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'M', 1, '2025-01-01')`)
    let n = 0
    const rent = (reason: string, month: string, tenths: string, base: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO base_rents (tenancy_id, "from", monthly_cents, reason, index_month, index_tenths, index_base) VALUES ('t', '20${String(n).padStart(2, '0')}-01', 50000, ${reason}, ${month}, ${tenths}, ${base})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(rent('NULL', 'NULL', 'NULL', 'NULL'), true, 'ohne Angabe')
    assert.equal(rent(`'modernization'`, 'NULL', 'NULL', 'NULL'), true, 'Modernisierung')
    assert.equal(rent(`'index'`, `'2025-01'`, '1209', '2020'), true, 'mit Indexwert')
    assert.equal(rent(`'mietspiegel'`, 'NULL', 'NULL', 'NULL'), false, 'unbekannte Art')
    assert.equal(rent(`'index'`, `'2025-01'`, 'NULL', '2020'), false, 'Wert fehlt')
    assert.equal(rent(`'index'`, `'2025-13'`, '1209', '2020'), false, 'kein Monat')
    assert.equal(rent(`'index'`, `'2025-01'`, '0', '2020'), false, 'Wert 0')
    assert.equal(rent(`'index'`, `'2025-01'`, '120.9', '2020'), false, 'Wert nicht in Zehnteln')
    assert.equal(rent(`'index'`, `'2025-01'`, '1209', '20'), false, 'Basisjahr zweistellig')
    const tenancy = (kind: string, excluded: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, rent_kind, rent_increase_excluded) VALUES ('t${n}', 'u', 'M', 1, '2025-01-01', ${kind}, ${excluded})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(tenancy('NULL', 'NULL'), true)
    assert.equal(tenancy(`'index'`, '0'), true)
    assert.equal(tenancy(`'staffel'`, 'NULL'), false)
    assert.equal(tenancy('NULL', '2'), false)
    const property = (value: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO properties (id, name, kind, address, rent_cap_reduced) VALUES ('p${n}', 'Haus', 'mfh', '', ${value})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(property('NULL'), true)
    assert.equal(property('1'), true)
    assert.equal(property('2'), false)
    const increase = (status: string, agreed: string, basis: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO rent_increases (id, tenancy_id, kind, created_on, effective_from, from_cents, to_cents, basis, status, agreed_cents) VALUES ('r${n}', 't', 'comparison', '2026-11-20', '2027-02', 50000, 55000, ${basis}, ${status}, ${agreed})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(increase(`'draft'`, 'NULL', `'{}'`), true)
    assert.equal(increase(`'partial'`, '52000', `'{}'`), true)
    assert.equal(increase(`'partial'`, 'NULL', `'{}'`), false, 'teilweise ohne Betrag')
    assert.equal(increase(`'agreed'`, '52000', `'{}'`), false, 'Betrag ohne teilweise')
    assert.equal(increase(`'draft'`, 'NULL', `'[]'`), false, 'basis kein Objekt')
    assert.equal(increase(`'offen'`, 'NULL', `'{}'`), false, 'unbekannter Stand')
    c.exec(`DELETE FROM tenancies WHERE id = 't'`)
    assert.deepEqual(c.rows(`SELECT count(*) FROM rent_increases`), [[0]], 'fällt mit dem Mietverhältnis')
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const withDatabase = async (work: (db: Parameters<Parameters<Awaited<ReturnType<typeof openFreshDatabase>>['write']>[0]>[0]) => Promise<void>) => {
  const dataDir = tmp()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await work(db)
    })
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const tenancyOf = async (db: Parameters<typeof readTenancies>[0], id = 't'): Promise<Tenancy> => {
  const t = (await readTenancies(db)).find((x) => x.id === id)
  if (!t) return assert.fail(`Mietverhältnis ${id} fehlt`)
  return t
}

test('Repository: ein Mietverhältnis ohne Angaben liest sich wie vor #191, ohne neue Schlüssel', async () => {
  await withDatabase(async (db) => {
    await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01', baseRents: [{ from: '2025-01', monthlyCents: 50000 }] })
    const t = await tenancyOf(db)
    assert.deepEqual(t.baseRents, [{ from: '2025-01', monthlyCents: 50000 }])
    assert.equal('rentKind' in t, false)
    assert.equal('rentIncreaseExcluded' in t, false)
    const [p] = await readProperties(db)
    assert.equal(p && 'rentCapReduced' in p, false)
  })
})

test('Repository: Art der Miete, Ausschluss, Art und Indexwert je Stufe gehen hin und zurück', async () => {
  await withDatabase(async (db) => {
    const baseRents: RentEntry[] = [
      { from: '2023-01', monthlyCents: 68500, reason: 'agreement', index: { month: '2022-10', value: 94.2, base: 2020 } },
      { from: '2024-03', monthlyCents: 77153, reason: 'index', index: { month: '2023-12', value: 106.1, base: 2020 } },
      { from: '2024-09', monthlyCents: 79153, reason: 'modernization' },
    ]
    await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2023-01-01', rentKind: 'index', rentIncreaseExcluded: false, baseRents })
    let t = await tenancyOf(db)
    assert.equal(t.rentKind, 'index')
    assert.equal(t.rentIncreaseExcluded, false)
    assert.deepEqual(t.baseRents, baseRents)
    // Ein Teilrumpf lässt alles stehen; null leert.
    await updateEntity(db, 'tenancies', 't', { tenantName: 'Mieterin' })
    t = await tenancyOf(db)
    assert.equal(t.rentKind, 'index')
    assert.deepEqual(t.baseRents, baseRents)
    await updateEntity(db, 'tenancies', 't', { rentIncreaseExcluded: true })
    assert.equal((await tenancyOf(db)).rentIncreaseExcluded, true)
    await updateEntity(db, 'tenancies', 't', { rentIncreaseExcluded: null, baseRents: [{ from: '2023-01', monthlyCents: 68500 }], rentKind: null })
    t = await tenancyOf(db)
    assert.equal('rentKind' in t, false)
    assert.equal('rentIncreaseExcluded' in t, false)
    assert.deepEqual(t.baseRents, [{ from: '2023-01', monthlyCents: 68500 }])
  })
})

test('Repository: eine Staffelmiete mit Stufen der Art „Staffel“', async () => {
  await withDatabase(async (db) => {
    const baseRents: RentEntry[] = [
      { from: '2024-01', monthlyCents: 70000, reason: 'agreement' },
      { from: '2025-01', monthlyCents: 72000, reason: 'staggered' },
    ]
    await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2024-01-01', rentKind: 'staggered', baseRents })
    assert.deepEqual((await tenancyOf(db)).baseRents, baseRents)
  })
})

test('Wächter: Index und Art passen zur Art der Miete, Indexwert und Basisjahr sind plausibel, je ein Satz', async () => {
  await withDatabase(async (db) => {
    await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2024-01-01', rentKind: 'free', baseRents: [{ from: '2024-01', monthlyCents: 70000 }] })
    const rejects = async (body: Record<string, unknown>, message: RegExp) => {
      await assert.rejects(updateEntity(db, 'tenancies', 't', body), (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.equal(Reflect.get(e, 'status'), 400, e.message)
        assert.match(e.message, message)
        return true
      })
    }
    const index = { month: '2023-10', value: 117.8, base: 2020 }
    await rejects({ baseRents: [{ from: '2024-01', monthlyCents: 70000, index }] }, /Indexwert.*nur bei einer Indexmiete/)
    await rejects({ baseRents: [{ from: '2024-01', monthlyCents: 70000, reason: 'index' }] }, /Anpassung einer Indexmiete.*nur bei einer Indexmiete/)
    await rejects({ baseRents: [{ from: '2024-01', monthlyCents: 70000, reason: 'staggered' }] }, /Stufe einer Staffelmiete.*nur bei einer Staffelmiete/)
    await rejects({ rentKind: 'index', baseRents: [{ from: '2024-01', monthlyCents: 70000, index: { ...index, value: 0 } }] }, /Indexwert.*größer als 0/)
    await rejects({ rentKind: 'index', baseRents: [{ from: '2024-01', monthlyCents: 70000, index: { ...index, value: 117.85 } }] }, /höchstens einer Nachkommastelle/)
    await rejects({ rentKind: 'index', baseRents: [{ from: '2024-01', monthlyCents: 70000, index: { ...index, base: 20 } }] }, /Basisjahr/)
    await rejects({ rentKind: 'index', baseRents: [{ from: '2024-01', monthlyCents: 70000, index: { ...index, month: '2023-13' } }] }, /Monat des Indexwerts/)
    await rejects({ baseRents: [{ from: '2024-01', monthlyCents: 70000, reason: 'mietspiegel' }] }, /Art der Stufe/)
    await rejects({ rentKind: 'staffel' }, /Art der Miete/)
    await rejects({ rentIncreaseExcluded: 'ja' }, /ja oder nein/)
    // Wer die Art der Miete wechselt, nimmt Stufen mit, die nicht mehr passen, nicht still mit.
    await updateEntity(db, 'tenancies', 't', { rentKind: 'index', baseRents: [{ from: '2024-01', monthlyCents: 70000, index }] })
    await rejects({ rentKind: 'free' }, /Indexwert.*nur bei einer Indexmiete/)
    assert.deepEqual((await tenancyOf(db)).baseRents, [{ from: '2024-01', monthlyCents: 70000, index }])
  })
})

test('Objekt: Kappungsgrenzen-Verordnung ja, nein, unbekannt; ein anderer Wert ist ein Satz', async () => {
  await withDatabase(async (db) => {
    const created = await createProperty(db, 'p2', { name: 'Haus', kind: 'mfh', address: '', rentCapReduced: true })
    assert.equal(created.rentCapReduced, true)
    assert.equal((await updateProperty(db, 'p2', { rentCapReduced: false }))?.rentCapReduced, false)
    assert.equal((await updateProperty(db, 'p2', { name: 'Haus 2' }))?.rentCapReduced, false)
    const cleared = await updateProperty(db, 'p2', { rentCapReduced: null })
    assert.equal(cleared && 'rentCapReduced' in cleared, false)
    await assert.rejects(updateProperty(db, 'p2', { rentCapReduced: 'ja' }), /Kappungsgrenze.*ja, nein oder/)
  })
})
