// Integrationstests: Sicherungspunkte in der Zeitachse des Verlaufs (#318). Jeder Test startet einen eigenen Server mit
// NKA_DATA_DIR auf einem Wegwerf-Ordner (startServerIn setzt auch CI und NKA_UPDATE_URL).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Unit } from '../../shared/types.ts'
import { besideServer, jsonOf, startServerIn, type Server } from '../testing/api.ts'
import { dumpStock, journalOf, newest, previewOf, restoreSnapshot, restoreSnapshotRaw, snapshotPreviewOf } from '../testing/revert.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { units } from '../src/db/schema.ts'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { PRIOR_DIR, priorVersionName } from '../src/db/priorVersions.ts'
import type { SnapshotPoint } from '../src/db/snapshots.ts'
import type { SnapshotPreview } from '../src/db/snapshotPreview.ts'

const DAY = 24 * 60 * 60 * 1000
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const unitNames = async (s: Server) => (await s.api<Unit[]>('/api/units')).map((u) => u.name).sort()

async function dataDirWithStock(): Promise<string> {
  const dir = tmp()
  const opened = await openFreshDatabase(dir)
  try {
    await opened.write((db) => db.insert(units).values({ id: 'u-eg', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, selfUsed: false }))
  } finally {
    opened.close()
  }
  return dir
}

// Eine wöchentliche Sicherung des Stands, wie er gerade ist.
async function weeklyNow(s: Server, daysAgo = 1): Promise<string> {
  const name = priorVersionName(new Date(Date.now() - daysAgo * DAY))
  fs.mkdirSync(path.join(s.dataDir, PRIOR_DIR), { recursive: true })
  const c = await besideServer(s.dataDir)
  c.exec(`VACUUM INTO '${path.join(s.dataDir, PRIOR_DIR, name).replace(/'/g, "''")}'`)
  c.close()
  return name
}

type Item = { kind?: string, id?: number, name?: string, title: string, type?: string, at: string, timeFrom?: string, size?: number }
const timeline = async (s: Server, query = '') => {
  const res = await fetch(`${s.base}/api/journal?snapshots=1${query}`)
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Item[]>(res)
}

// Eine Datenbank auf dem Stand vor den letzten beiden Schritten, mit einer Wohnung und dem Eintrag dazu im Verlauf,
// wie ihn die ältere Version geschrieben hätte. Der Start holt die Schritte nach und legt die Sicherung davor an.
const OLD_AT = '2026-09-01T10:00:00.000Z'
async function dataDirBeforeUpdate(): Promise<{ dir: string, backup: string }> {
  const dir = tmp()
  const all = await loadMigrations()
  const old = all.slice(0, all.length - 2)
  const c = await connect(path.join(dir, 'mietfuchs.sqlite'))
  try {
    applyMigrations(c, old)
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates, self_used) VALUES ('u-eg', 'objekt-1', 'EG', 80, 1, 0)")
    c.exec(`INSERT INTO change_groups (at, method, route, description, subject_table, schema_steps) VALUES ('${OLD_AT}', 'POST', '/api/units', 'Wohnung angelegt', 'units', ${old.length})`)
    c.exec(`INSERT INTO change_log (group_id, table_name, row_key, op, before, after) VALUES (1, 'units', '{"id":"u-eg"}', 'insert', NULL,
      '{"id":"u-eg","property_id":"objekt-1","name":"EG","area_m2":80,"participates":1,"self_used":0}')`)
  } finally {
    c.close()
  }
  return { dir, backup: `mietfuchs.sqlite.vor-${all[all.length - 2].tag}` }
}

test('Sicherungspunkte: Die Zeitachse zeigt sie zwischen den Änderungen, der Zeitraum gilt, Bereich und Suche blenden sie aus', async () => {
  const dir = await dataDirWithStock()
  const fileTime = new Date(Date.now() - 3 * DAY)
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite.vor-restore'), fs.readFileSync(path.join(dir, 'mietfuchs.sqlite')))
  fs.utimesSync(path.join(dir, 'mietfuchs.sqlite.vor-restore'), fileTime, fileTime)
  const s = await startServerIn(dir)
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true }) })
    const items = await timeline(s)
    const snaps = items.filter((i) => i.kind === 'snapshot')
    assert.deepEqual(snaps.map((p) => p.title).sort(), ['Vor dem Einspielen eines Backups', 'Wöchentliche Sicherung'])
    const weekly = snaps.find((p) => p.type === 'weekly') ?? assert.fail('keine wöchentliche')
    assert.ok((weekly.size ?? 0) > 0 && weekly.timeFrom === 'name')
    const restore = snaps.find((p) => p.type === 'restore') ?? assert.fail('keine vor dem Einspielen')
    assert.deepEqual([restore.at, restore.timeFrom], [fileTime.toISOString(), 'file'])
    // Zeitlich einsortiert: Die neue Wohnung kam nach der wöchentlichen Sicherung des Starts.
    assert.deepEqual(items.map((i) => Date.parse(i.at)), [...items.map((i) => Date.parse(i.at))].sort((a, b) => b - a))
    assert.equal(items[0].kind, undefined, 'die neueste Änderung zuerst')
    // Ohne `snapshots=1` bleibt die Liste, wie sie war.
    assert.ok((await journalOf(s)).every((g) => !('kind' in g)))
    // Bereich und Suche blenden sie aus, der Zeitraum gilt.
    assert.ok((await timeline(s, '&kind=units')).every((i) => i.kind !== 'snapshot'))
    assert.ok((await timeline(s, '&q=OG')).every((i) => i.kind !== 'snapshot'))
    const to = new Date(Date.now() - DAY).toISOString()
    assert.deepEqual((await timeline(s, `&to=${to}`)).map((i) => i.title), ['Vor dem Einspielen eines Backups'])
    // Blättern: Auf der zweiten Seite steht, was älter ist als die erste.
    const first = await timeline(s, '&limit=1')
    assert.equal(first.filter((i) => i.kind !== 'snapshot').length, 1)
    const groupId = first.find((i) => i.kind !== 'snapshot')?.id ?? assert.fail('keine Gruppe')
    const second = await timeline(s, `&limit=1&before=${groupId}`)
    assert.deepEqual([...first, ...second].filter((i) => i.kind === 'snapshot').map((i) => i.name).sort(),
      snaps.map((i) => i.name).sort(), 'jede genau einmal')
  } finally {
    s.stop()
  }
})

test('Sicherungspunkte: Rücksprung über die Sicherung vor dem Update, mit Marke, Schranke und nachgeholten Schritten', async () => {
  const { dir, backup } = await dataDirBeforeUpdate()
  const s = await startServerIn(dir)
  try {
    assert.ok(fs.existsSync(path.join(s.dataDir, backup)), 'Sicherung vor dem Update angelegt')
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true }) })
    assert.deepEqual(await unitNames(s), ['EG', 'OG'])

    const snap = (await timeline(s)).find((i) => i.name === backup) ?? assert.fail('Sicherung fehlt in der Zeitachse')
    // Der Schritt ist noch in keiner veröffentlichten Version, und die Merkdatei nennt keine: „Vor einem Update“.
    assert.deepEqual([snap.type, snap.title, snap.timeFrom], ['update', 'Vor einem Update', 'notice'])

    // Der Eintrag von vor dem Update lässt sich nur lesen; den Stand vor ihm trägt keine Sicherung, es bleibt bei der
    // Ablehnung. Der Stand nach ihm geht Schritt für Schritt (nur die Wohnung OG danach), also ohne Sicherung.
    const old = (await journalOf(s)).find((g) => g.at === OLD_AT) ?? assert.fail('alter Eintrag fehlt')
    assert.equal(old.readOnly, true)
    const before = await previewOf(s, old.id, 'including')
    assert.equal(before.kind, 'journal')
    assert.match(before.refusals.join(' '), /vor dem letzten Update/)
    assert.equal((await previewOf(s, old.id, 'after')).kind, 'journal')

    const preview = await snapshotPreviewOf(s, backup)
    assert.equal(preview.kind, 'snapshot')
    assert.deepEqual(preview.refusals, [])
    assert.equal(preview.later, 1)
    assert.ok(preview.notes.some((n) => /früheren Version/.test(n)), preview.notes.join(' | '))
    assert.ok(preview.consents.length > 0)

    // Ohne passende Marke: 409 mit neuer Vorschau, nichts geändert.
    const stale = await restoreSnapshotRaw(s, backup, 'falsch')
    assert.equal(stale.status, 409)
    assert.equal((await jsonOf<{ preview: SnapshotPreview }>(stale)).preview.kind, 'snapshot')
    assert.deepEqual(await unitNames(s), ['EG', 'OG'])

    const res = await restoreSnapshotRaw(s, backup, preview.token)
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual(await unitNames(s), ['EG'])
    // Auf den heutigen Aufbau gebracht (Spalte aus dem letzten Schritt), die bisherige gesichert, eine Schranke gesetzt.
    const c = await besideServer(s.dataDir)
    const columns = c.rows('PRAGMA table_info(change_groups)').map((r) => String(r[1]))
    c.close()
    assert.ok(columns.includes('request_id'), columns.join(', '))
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')))
    assert.ok(fs.existsSync(path.join(s.dataDir, backup)), 'die Sicherung selbst bleibt')
    assert.equal((await newest(s)).barrier, 'priorVersion')
    // Die Sicherung vor dem Einspielen steht jetzt in der Zeitachse und führt zurück zum Stand mit OG.
    const back = (await timeline(s)).find((i) => i.name === 'mietfuchs.sqlite.vor-restore') ?? assert.fail('vor-restore fehlt')
    assert.equal(back.title, 'Vor dem Einspielen eines Backups')
    await restoreSnapshot(s, 'mietfuchs.sqlite.vor-restore')
    assert.deepEqual(await unitNames(s), ['EG', 'OG'])
    // Die eben eingespielte ist dabei beiseitegelegt, nicht überschrieben worden.
    assert.ok(fs.readdirSync(s.dataDir).some((n) => /^mietfuchs\.sqlite\.vor-restore\.vom-/.test(n)), fs.readdirSync(s.dataDir).join(', '))
    assert.deepEqual(fs.readdirSync(s.dataDir).filter((n) => n.includes('vorschau')), [], 'keine Kopie der Vorschau bleibt liegen')
  } finally {
    s.stop()
  }
})

test('Sicherungspunkte: Über ein eingespieltes Backup hinweg führt die Vorschau zur Sicherung davor', async () => {
  const s = await startServerIn(tmp())
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const archive = Buffer.from(await (await fetch(`${s.base}/api/backup?journal=1`)).arrayBuffer())
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true }) })
    const fd = new FormData()
    fd.append('file', new Blob([archive], { type: 'application/zip' }), 'backup.zip')
    assert.equal((await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })).status, 200)
    assert.deepEqual(await unitNames(s), ['EG'])
    // Der Stand nach „OG angelegt“ steht nicht in diesem Verlauf, wohl aber die Gruppe davor (aus dem Archiv). Der
    // Stand nach ihr ist nicht der vor dem Einspielen (dort kam OG dazu): keine Sicherung passt genau.
    const list = await journalOf(s)
    assert.equal(list[0].barrier, 'restore')
    const plain = await previewOf(s, list[1].id, 'after')
    assert.equal(plain.kind, 'journal')
    assert.match(plain.refusals.join(' '), /Vor dem Einspielen eines Backups/)
    // Die Sicherung vor dem Einspielen steht in der Zeitachse und bringt OG zurück.
    await restoreSnapshot(s, 'mietfuchs.sqlite.vor-restore')
    assert.deepEqual(await unitNames(s), ['EG', 'OG'])
  } finally {
    s.stop()
  }
})

// Der häufigste Fall: Nach einem Abschluss soll der Stand davor zurück. Schritt für Schritt geht das nicht (ein
// zugestellter Stand verschwände still); trägt eine Sicherung genau den Stand davor, nimmt die Vorschau sie und sagt es.
test('Sicherungspunkte: Über einen Abschluss hinweg nimmt die Vorschau die passende Sicherung', async () => {
  const s = await startServerIn(tmp())
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true, selfUsed: false }) })
    await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Müller', persons: 2, start: '2024-01-01', prepayment: 10000 }) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 30000, key: 'area' }) })
    const name = await weeklyNow(s)
    const closed = await send(s, 'POST', '/api/settlement/2024/close', {})
    assert.equal(closed.status, 201, await closed.clone().text())
    const close = await newest(s)
    const preview = await previewOf(s, close.id, 'including') as unknown as SnapshotPreview
    assert.equal(preview.kind, 'snapshot')
    assert.equal(preview.snapshot.name, name)
    assert.equal(preview.entry?.id, close.id)
    assert.equal(preview.mode, 'including')
    assert.match(preview.reasons.join(' '), /schließt eine Abrechnung ab/)
    assert.deepEqual(preview.refusals, [])
    assert.ok(preview.notes.some((n) => /abgeschlossen/.test(n)), preview.notes.join(' | '))
    const res = await restoreSnapshotRaw(s, name, preview.token)
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual((await dumpStock(s.dataDir)).closed_settlements, [])
  } finally {
    s.stop()
  }
})

// Der Rettungsfall: Die Arbeitsdatei lässt sich nicht öffnen. Die Zeitachse zeigt dann nur die Sicherungen, und eine
// lässt sich einspielen (vorher ging das über die Karte in den Einstellungen).
test('Sicherungspunkte: Ohne lesbare Datenbank zeigt die Zeitachse die Sicherungen, und Einspielen geht', async () => {
  const dir = await dataDirWithStock()
  const name = priorVersionName(new Date(Date.now() - DAY))
  fs.mkdirSync(path.join(dir, PRIOR_DIR), { recursive: true })
  fs.copyFileSync(path.join(dir, 'mietfuchs.sqlite'), path.join(dir, PRIOR_DIR, name))
  fs.writeFileSync(path.join(dir, 'mietfuchs.sqlite'), 'kaputt'.repeat(200))
  const s = await startServerIn(dir)
  try {
    assert.equal((await fetch(`${s.base}/api/journal`)).status, 503)
    assert.deepEqual((await timeline(s)).map((i) => [i.kind, i.name]), [['snapshot', name]])
    const { preview } = await restoreSnapshot(s, name)
    assert.match(preview.consents.join(' '), /lassen sich gerade nicht lesen/)
    assert.deepEqual(await unitNames(s), ['EG'])
  } finally {
    s.stop()
  }
})

test('Sicherungspunkte: Die Namensprüfung lässt nur die eigenen Muster zu', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    fs.writeFileSync(path.join(s.dataDir, 'notiz.sqlite'), 'x')
    for (const bad of ['mietfuchs.sqlite', 'db.json.vor-restore', 'mietfuchs.sqlite.vor-9999_fremd', 'notiz.sqlite',
      '..%2Fmietfuchs.sqlite.vor-restore', 'mietfuchs.sqlite.vor-restore-journal', 'vorversionen%2Fvorversion-2026-01-01-000000.sqlite']) {
      for (const route of ['restore/preview', 'restore']) {
        const res = await send(s, 'POST', `/api/prior-versions/${bad}/${route}`, {})
        assert.equal(res.status, 400, `${bad} ${route}: ${res.status}`)
      }
    }
    // Ein gültiger Name, den es nicht gibt.
    assert.equal((await send(s, 'POST', '/api/prior-versions/mietfuchs.sqlite.vor-restore/restore/preview', {})).status, 404)
    assert.equal((await send(s, 'POST', '/api/prior-versions/vorversion-2020-01-01-000000.sqlite/restore', {})).status, 404)
    assert.deepEqual(await unitNames(s), ['EG'])
  } finally {
    s.stop()
  }
})

test('Sicherungspunkte: Aufräumen beim Start behält je Art drei und alles aus zwölf Monaten, die genannte und fremde Dateien bleiben', async () => {
  const dir = await dataDirWithStock()
  const old = new Date(Date.now() - 800 * DAY)
  const restores = ['2020-01-01-0000', '2020-01-02-0000', '2020-01-03-0000', '2020-01-04-0000'].map((t) => `mietfuchs.sqlite.vor-restore.vom-${t}`)
  const updates = ['2019-01-01-0000', '2019-02-01-0000', '2019-03-01-0000', '2019-04-01-0000', '2019-05-01-0000'].map((t) => `mietfuchs.sqlite.vor-0001_objekte.vom-${t}`)
  const recent = `mietfuchs.sqlite.vor-restore.vom-${new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)}-0000`
  const others = ['db.json.vor-restore', 'mietfuchs.sqlite.vor-restore.vom-2018-01-01-0000.kopie', 'notiz.txt']
  for (const n of [...restores, ...updates, recent, ...others]) {
    fs.writeFileSync(path.join(dir, n), 'x')
    fs.utimesSync(path.join(dir, n), old, old)
  }
  // Der offene Hinweis nach dem Update nennt die älteste; sie bleibt.
  fs.writeFileSync(path.join(dir, 'sicherung-vor-update.json'), JSON.stringify({ steps: 1, backup: updates[0], at: old.toISOString() }))
  const s = await startServerIn(dir)
  try {
    const left = new Set(fs.readdirSync(s.dataDir))
    // vor dem Einspielen: die junge und die zwei jüngsten alten bleiben.
    assert.deepEqual([...restores, recent].filter((n) => left.has(n)).sort(), [restores[2], restores[3], recent].sort())
    // vor dem Update: die drei jüngsten und die genannte.
    assert.deepEqual(updates.filter((n) => left.has(n)).sort(), [updates[0], updates[2], updates[3], updates[4]].sort())
    for (const n of others) assert.ok(left.has(n), n)
  } finally {
    s.stop()
  }
})

// Die Regel aus #439 gilt auch beim Einspielen einer Sicherung: Ein Widerruf kommt nie zurück, und eine Zustimmung, die
// es gerade nicht gibt, entsteht nicht.
test('Sicherungspunkte: Einspielen holt keine widerrufene Zustimmung zurück', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    assert.equal((await send(s, 'POST', '/api/ai/consent', { slot: 'text' })).status, 200)
    assert.equal((await send(s, 'PUT', '/api/settings', { updateCheck: 'on' })).status, 200)
    const name = await weeklyNow(s)
    assert.equal((await send(s, 'DELETE', '/api/ai/consent/text')).status, 200)
    assert.equal((await send(s, 'PUT', '/api/settings', { updateCheck: 'off' })).status, 200)
    const { preview } = await restoreSnapshot(s, name)
    assert.match(preview.consents.join(' '), /keiner Übermittlung an einen KI-Dienst/)
    const consent = (await dumpStock(s.dataDir, { raw: true })).ai_slots.join()
    assert.doesNotMatch(consent, /\d{4}-\d{2}-\d{2}/, 'die Bestätigung bleibt widerrufen')
    assert.equal((await s.api<{ updateCheck?: string }>('/api/settings')).updateCheck, 'off')
  } finally {
    s.stop()
  }
})

test('Sicherungspunkte: Die Vorschau nennt fehlende Belege und Belege aus dem Papierkorb', async () => {
  const s = await startServerIn(await dataDirWithStock())
  try {
    const fd = (name: string) => {
      const f = new FormData()
      f.append('file', new Blob([Buffer.from(`%PDF-1.4 ${name}`)], { type: 'application/pdf' }), name)
      f.append('propertyId', 'objekt-1')
      f.append('year', '2024')
      return f
    }
    const upload = async (name: string) => jsonOf<{ file: string }>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd(name) }))
    const a = (await upload('a.pdf')).file
    const b = (await upload('b.pdf')).file
    const name = await weeklyNow(s)
    assert.equal((await send(s, 'DELETE', `/api/uploads/${a}`)).status, 200)
    assert.equal((await send(s, 'DELETE', `/api/uploads/${b}`)).status, 200)
    // b ist ganz weg (von Hand aus dem Papierkorb gelöscht).
    fs.rmSync(path.join(s.dataDir, 'papierkorb', 'uploads', b))
    const preview = await snapshotPreviewOf(s, name)
    assert.deepEqual(preview.missing, [b])
    assert.equal(preview.fromTrash, 1)
    assert.ok(preview.later >= 2)
    void (null as unknown as SnapshotPoint)
  } finally {
    s.stop()
  }
})
