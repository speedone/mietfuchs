// Integrationstests: automatische Vorversionen der Datenbank (#318, Schritt 1).
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner
// (startServerIn in testing/api.ts setzt auch CI und NKA_UPDATE_URL).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { Unit } from '../../shared/types.ts'
import { type ClientSettings, type HealthReport, databaseOfV080, errorFrom, jsonOf, postJson, startServerIn, uploadBelegFile, waitForExit } from '../testing/api.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { units } from '../src/db/schema.ts'
import { connect } from '../src/db/client.ts'
import { PRIOR_DIR, priorVersionName } from '../src/db/priorVersions.ts'

type Listed = { name: string, createdAt: string, size: number }

const DAY = 24 * 60 * 60 * 1000

// Ein Datenordner mit einer Datenbank, die einen Bestand trägt (eine Wohnung „EG“).
async function dataDirWithStock(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const opened = await openFreshDatabase(dir)
  try {
    await opened.write((db) => db.insert(units).values({ id: 'u-eg', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, selfUsed: false }))
  } finally {
    opened.close()
  }
  return dir
}

const list = async (base: string): Promise<Listed[]> => {
  const res = await fetch(`${base}/api/prior-versions`)
  assert.equal(res.status, 200)
  return jsonOf<Listed[]>(res)
}

const placeCopy = (dir: string, name: string, source = path.join(dir, 'mietfuchs.sqlite')): void => {
  fs.mkdirSync(path.join(dir, PRIOR_DIR), { recursive: true })
  fs.copyFileSync(source, path.join(dir, PRIOR_DIR, name))
}

test('Vorversionen: Eine leere Datenbank bekommt beim Start keine', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    assert.deepEqual(await list(s.base), [])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Mit Bestand entsteht beim Start eine, nicht im Backup und nicht in den Checks', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    const versions = await list(s.base)
    assert.equal(versions.length, 1)
    assert.match(versions[0].name, /^vorversion-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/)
    assert.ok(versions[0].size > 0)
    assert.ok(Math.abs(Date.parse(versions[0].createdAt) - Date.now()) < 60_000)

    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    assert.ok(!zip.getEntries().some((e) => e.entryName.includes('vorversion')), zip.getEntries().map((e) => e.entryName).join(', '))

    const health = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.deepEqual(Object.keys(health.checks).sort(), ['data', 'database', 'uploads'])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Ist die jüngste keine sieben Tage alt, entsteht keine neue', async () => {
  const dir = await dataDirWithStock()
  const recent = priorVersionName(new Date(Date.now() - 2 * DAY))
  placeCopy(dir, recent)
  const s = await startServerIn(dir)
  try {
    assert.deepEqual((await list(s.base)).map((v) => v.name), [recent])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Sind alle älter, entsteht eine neue, und es bleiben vier', async () => {
  const dir = await dataDirWithStock()
  const old = [40, 30, 20, 10].map((d) => priorVersionName(new Date(Date.now() - d * DAY)))
  for (const name of old) placeCopy(dir, name)
  const s = await startServerIn(dir)
  try {
    const names = (await list(s.base)).map((v) => v.name)
    assert.equal(names.length, 4)
    assert.ok(!names.includes(old[0]), 'die älteste fällt weg')
    assert.deepEqual(names.slice(1), [old[3], old[2], old[1]])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Einspielen bringt den alten Stand zurück, mit Sicherung und frischen Einstellungen', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    const [version] = await list(s.base)
    await s.api(`/api/units/u-eg`, { method: 'DELETE' })
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true }) })
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Neu Eingetragen' }) })

    const res = await postJson(s, `/api/prior-versions/${encodeURIComponent(version.name)}/restore`, {})
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name), ['EG'])
    assert.notEqual((await s.api<ClientSettings>('/api/settings')).landlordName, 'Neu Eingetragen')
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')))
    // Die Vorversion selbst bleibt, wie sie ist.
    assert.ok((await list(s.base)).some((v) => v.name === version.name))
  } finally {
    s.stop()
  }
})

test('Vorversionen: Einspielen nennt Belege, die seither gelöscht wurden', async () => {
  const dir = await dataDirWithStock()
  const first = await startServerIn(dir)
  const file = await uploadBelegFile(first, '%PDF-Grundsteuer', 'Grundsteuer 2025.pdf')
  const item = await first.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area', invoiceFile: file }) })
  first.child.kill()
  await waitForExit(first.child)
  // Die Vorversion vom ersten Start kennt den Beleg noch nicht; der zweite Start legt eine mit ihm an.
  fs.rmSync(path.join(dir, PRIOR_DIR), { recursive: true, force: true })
  const s = await startServerIn(dir)
  try {
    const [version] = await list(s.base)
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    assert.equal((await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })).status, 200)
    const res = await postJson(s, `/api/prior-versions/${version.name}/restore`, {})
    assert.equal(res.status, 200)
    const body = await jsonOf<{ notes: string[] }>(res)
    assert.ok(body.notes.some((n) => n.includes('fehlt') && n.includes(file)), body.notes.join(' | '))
  } finally {
    s.stop()
  }
})

test('Vorversionen: Eine Vorversion eines älteren Aufbaus holt die Migrationskette nach', async () => {
  const dir = await dataDirWithStock()
  const name = priorVersionName(new Date(Date.now() - DAY))
  fs.mkdirSync(path.join(dir, PRIOR_DIR), { recursive: true })
  fs.writeFileSync(path.join(dir, PRIOR_DIR, name), await databaseOfV080(2025))
  const s = await startServerIn(dir)
  try {
    const res = await postJson(s, `/api/prior-versions/${name}/restore`, {})
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name).sort(), ['EG', 'OG'])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Eine beschädigte Vorversion wird abgelehnt, der Bestand bleibt', async () => {
  const dir = await dataDirWithStock()
  const name = priorVersionName(new Date(Date.now() - DAY))
  fs.mkdirSync(path.join(dir, PRIOR_DIR), { recursive: true })
  fs.writeFileSync(path.join(dir, PRIOR_DIR, name), 'keine Datenbank')
  const s = await startServerIn(dir)
  try {
    const res = await postJson(s, `/api/prior-versions/${name}/restore`, {})
    assert.equal(res.status, 400)
    assert.match(await errorFrom(res), /beschädigt/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name), ['EG'])
  } finally {
    s.stop()
  }
})

test('Vorversionen: Nur eigene Namen, kein Pfad von außen', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    for (const bad of ['..%2Fmietfuchs.sqlite', 'mietfuchs.sqlite', 'vorversion-2026-02-31-000000.sqlite']) {
      const res = await postJson(s, `/api/prior-versions/${bad}/restore`, {})
      assert.equal(res.status, 400, bad)
    }
    const missing = await postJson(s, `/api/prior-versions/${priorVersionName(new Date('2020-01-01T00:00:00Z'))}/restore`, {})
    assert.equal(missing.status, 404)
  } finally {
    s.stop()
  }
})

test('Durchsicht S1: Lässt sich die Datenbank nicht öffnen, gehen Liste und Einspielen trotzdem', async () => {
  const dir = await dataDirWithStock()
  const name = priorVersionName(new Date(Date.now() - DAY))
  placeCopy(dir, name)
  // Danach ist die Arbeitsdatei kaputt: genau der Fall, für den es die Vorversionen gibt.
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite'), 'kaputt'.repeat(200))
  const s = await startServerIn(dir)
  try {
    assert.deepEqual((await list(s.base)).map((v) => v.name), [name])
    const res = await postJson(s, `/api/prior-versions/${name}/restore`, {})
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name), ['EG'])
    // Die kaputte Datei ist nicht weg, sie liegt als vor-restore daneben.
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')))
  } finally {
    s.stop()
  }
})

test('Durchsicht S1: Stehen die Daten noch in der db.json, antworten die Routen mit 503', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  // Eine Datei, die keine Datenbank ist, und daneben eine db.json: Der Umstieg ist gescheitert.
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite'), 'kaputt'.repeat(200))
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} }))
  const s = await startServerIn(dir)
  try {
    assert.equal((await fetch(`${s.base}/api/prior-versions`)).status, 503)
    assert.equal((await postJson(s, `/api/prior-versions/${priorVersionName(new Date())}/restore`, {})).status, 503)
  } finally {
    s.stop()
  }
})

const unitNamesIn = async (file: string): Promise<string[]> => {
  const c = await connect(file)
  try {
    return c.rows('SELECT name FROM units ORDER BY name').map((r) => String(r[0]))
  } finally {
    c.close()
  }
}

test('Durchsicht M1: Zweimal einspielen, und der Stand vor dem ersten liegt noch im Datenordner', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    const [version] = await list(s.base)
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true }) })
    assert.equal((await postJson(s, `/api/prior-versions/${version.name}/restore`, {})).status, 200)
    assert.equal((await postJson(s, `/api/prior-versions/${version.name}/restore`, {})).status, 200)
    const aside = fs.readdirSync(s.dataDir).filter((n) => n.startsWith('mietfuchs.sqlite.vor-restore.vom-'))
    assert.equal(aside.length, 1, fs.readdirSync(s.dataDir).join(', '))
    assert.deepEqual(await unitNamesIn(path.join(s.dataDir, aside[0])), ['EG', 'OG'])
    assert.deepEqual(await unitNamesIn(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), ['EG'])
  } finally {
    s.stop()
  }
})
