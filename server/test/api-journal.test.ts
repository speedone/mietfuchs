// Integrationstests: Änderungsjournal und Verlauf über die Routen (#318, Schritte 2 und 3).
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner
// (startServerIn in testing/api.ts setzt auch CI und NKA_UPDATE_URL).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { Meter, Tenancy, Unit } from '../../shared/types.ts'
import { connect } from '../src/db/client.ts'
import { createPriorVersion } from '../src/db/priorVersions.ts'
import { changeGroups, units } from '../src/db/schema.ts'
import type { JournalGroupView, JournalRowView } from '../src/db/journal.ts'
import { jsonOf, startServerIn, uploadBelegFile, type Server } from '../testing/api.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'

type Detail = JournalGroupView & { changes: JournalRowView[] }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const journal = async (s: Server, query = ''): Promise<JournalGroupView[]> => {
  const res = await fetch(`${s.base}/api/journal${query}`)
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<JournalGroupView[]>(res)
}
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function stock(s: Server): Promise<{ unit: Unit, tenancy: Tenancy, meter: Meter }> {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG links', areaM2: 60, participates: true, selfUsed: false }) })
  const tenancy = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Müller', persons: 2, start: '2024-01-01' }) })
  const meter = await s.api<Meter>('/api/meters', { method: 'POST', body: JSON.stringify({ name: 'Wasser EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³' }) })
  await s.api('/api/readings', { method: 'POST', body: JSON.stringify({ meterId: meter.id, date: '2024-01-01', value: 10 }) })
  await s.api('/api/payments', { method: 'POST', body: JSON.stringify({ tenancyId: tenancy.id, date: '2024-02-01', amountCents: 50000 }) })
  return { unit, tenancy, meter }
}

const rowsOf = async (file: string, query: string): Promise<unknown[][]> => {
  const c = await connect(file)
  try {
    return c.rows(query)
  } finally {
    c.close()
  }
}

test('Verlauf: Jede schreibende Anfrage ist eine Gruppe mit ihrem Satz, Lesen und Vorschau ergeben keine', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    await fetch(`${s.base}/api/units`)
    await fetch(`${s.base}/api/settlement/2024`)
    const groups = await journal(s, '?property=objekt-1')
    assert.deepEqual(groups.map((g) => g.title), [
      'Zahlung angelegt', 'Ablesung angelegt', 'Zähler angelegt: Wasser EG', 'Mietverhältnis angelegt: Müller', 'Wohnung angelegt: EG links',
    ])
    assert.ok(groups.every((g) => g.propertyIds.join() === 'objekt-1' && !g.installationWide))
    assert.equal(groups[4].route, '/api/units')

    // Wohnung löschen: die Kaskade in einer Gruppe
    assert.equal((await send(s, 'DELETE', `/api/units/${unit.id}`)).status, 200)
    const [deleted] = await journal(s)
    assert.equal(deleted.title, 'Wohnung gelöscht: EG links')
    assert.equal(deleted.route, '/api/units/:id')
    assert.equal(deleted.rows, 5)
    const detail = await jsonOf<Detail>(await fetch(`${s.base}/api/journal/${deleted.id}`))
    assert.deepEqual(detail.changes.map((c) => `${c.table}:${c.op}`).sort(),
      ['meters:delete', 'payments:delete', 'readings:delete', 'tenancies:delete', 'units:delete'])
    assert.equal(detail.changes.find((c) => c.table === 'tenancies')?.before?.tenant_name, 'Müller')
    assert.equal((await fetch(`${s.base}/api/journal/999999`)).status, 404)
    assert.equal((await fetch(`${s.base}/api/journal/abc`)).status, 404)

    // Blättern
    const page = await journal(s, `?before=${deleted.id}&limit=2`)
    assert.deepEqual(page.map((g) => g.description), ['Zahlung angelegt', 'Ablesung angelegt'])
  } finally {
    s.stop()
  }
})

test('Verlauf: Eine abgelehnte Änderung hinterlässt keine Gruppe, eine Änderung ohne Unterschied auch nicht', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    const before = (await journal(s)).length
    const refused = await send(s, 'POST', '/api/readings', { meterId: 'gibt-es-nicht', date: '2024-06-30', value: 1 })
    assert.equal(refused.status, 400)
    assert.equal((await send(s, 'PUT', `/api/units/${unit.id}`, { name: 'EG links' })).status, 200)
    assert.equal((await journal(s)).length, before)
  } finally {
    s.stop()
  }
})

test('Verlauf: Auch eine Route hinter multer (Beleg hochladen) bildet ihre Gruppe', async () => {
  const s = await startServerIn(tmp())
  try {
    await uploadBelegFile(s, '%PDF-1.4 Grundsteuer', 'grundsteuer.pdf', { propertyId: 'objekt-1', year: '2024' })
    const [group] = await journal(s)
    assert.equal(group.title, 'Beleg hochgeladen: grundsteuer.pdf')
  } finally {
    s.stop()
  }
})

// Durchsicht von PR #430, S1: GET /api/uploads trägt Prüfsummen im Hintergrund nach und erbte dabei den Kontext
// der Anfrage; daraus wurde eine Gruppe „Änderung (GET /api/uploads)“. Ein Abbruch ohne laufende Auswertung
// schreibt nichts. Und keine Route schreibt ohne Satz (die Konsole meldete es).
test('Verlauf: Lesen und Systemarbeit im Hintergrund ergeben keine Gruppe, jede Gruppe hat einen Satz', async () => {
  const dir = tmp()
  const s = await startServerIn(dir)
  try {
    await uploadBelegFile(s, '%PDF-1.4 Grundsteuer', 'grundsteuer.pdf', { propertyId: 'objekt-1', year: '2024' })
    // Die Prüfsumme leeren, damit GET sie nachträgt.
    const file = path.join(dir, 'mietfuchs.sqlite')
    const c = await connect(file)
    c.exec("UPDATE uploads SET sha256 = ''")
    c.close()
    assert.equal((await fetch(`${s.base}/api/uploads`)).status, 200)
    let filled = false
    for (let i = 0; i < 50 && !filled; i++) {
      await new Promise((r) => setTimeout(r, 100))
      filled = Number((await rowsOf(file, 'SELECT count(*) FROM uploads WHERE sha256 <> \'\''))[0][0]) === 1
    }
    assert.ok(filled, 'die Prüfsumme wurde nicht nachgetragen')
    assert.equal((await send(s, 'POST', '/api/ai/cancel/gibt-es-nicht')).status, 404)
    assert.deepEqual((await journal(s)).map((g) => g.title), ['Beleg hochgeladen: grundsteuer.pdf'])
    assert.doesNotMatch(s.errorOutput(), /keinen Satz/)
  } finally {
    s.stop()
  }
})

// Nachprüfung von PR #430, S1: Vorschauen gehen über writeData und rollen zurück. Sie haben bewusst keinen
// Satz und meldeten sich trotzdem bei jedem Aufruf auf der Konsole.
test('Verlauf: Eine Vorschau ergibt weder eine Gruppe noch eine Meldung auf der Konsole', async () => {
  const s = await startServerIn(tmp())
  try {
    await stock(s)
    const before = (await journal(s)).length
    const res = await send(s, 'POST', '/api/properties/objekt-1/period/preview', { rules: { startMonth: 5, changes: [] } })
    assert.ok(res.status < 500, String(res.status))
    assert.equal((await journal(s)).length, before)
    assert.doesNotMatch(s.errorOutput(), /keinen Satz/)
  } finally {
    s.stop()
  }
})

test('Verlauf: Mieterwechsel ist eine Gruppe über alle Teile', async () => {
  const s = await startServerIn(tmp())
  try {
    const { tenancy, meter } = await stock(s)
    const res = await send(s, 'POST', `/api/tenancies/${tenancy.id}/change`, {
      end: '2024-06-30', readings: [{ meterId: meter.id, value: 20 }], newTenancy: { tenantName: 'Schmidt', persons: 1, start: '2024-07-01' },
    })
    assert.equal(res.status, 200, await res.clone().text())
    const [group] = await journal(s)
    assert.equal(group.description, 'Mieterwechsel')
    const detail = await jsonOf<Detail>(await fetch(`${s.base}/api/journal/${group.id}`))
    const kinds = new Set(detail.changes.map((c) => `${c.table}:${c.op}`))
    assert.ok(kinds.has('tenancies:update'), [...kinds].join(', '))
    assert.ok(kinds.has('tenancies:insert'), [...kinds].join(', '))
    assert.ok(kinds.has('readings:insert'), [...kinds].join(', '))
  } finally {
    s.stop()
  }
})

test('Backup: Der Verlauf kommt nur auf Wunsch mit, ein Wiederherstellen ohne ihn ergibt einen leeren', async () => {
  const s = await startServerIn(tmp())
  try {
    await stock(s)
    const zipOf = async (query: string) => new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup${query}`)).arrayBuffer()))
    const countIn = async (zip: AdmZip): Promise<number> => {
      const file = path.join(tmp(), 'archiv.sqlite')
      fs.writeFileSync(file, zip.readFile('mietfuchs.sqlite') ?? assert.fail('keine Datenbank im Archiv'))
      const units = await rowsOf(file, 'SELECT count(*) FROM units')
      assert.equal(Number(units[0][0]), 1)
      return Number((await rowsOf(file, 'SELECT count(*) FROM change_groups'))[0][0]) + Number((await rowsOf(file, 'SELECT count(*) FROM change_log'))[0][0])
    }
    const plain = await zipOf('')
    assert.equal(await countIn(plain), 0)
    assert.ok(await countIn(await zipOf('?journal=1')) > 0)

    const fd = new FormData()
    fd.append('file', new Blob([plain.toBuffer()], { type: 'application/zip' }), 'backup.zip')
    const restored = await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })
    assert.equal(restored.status, 200, await restored.clone().text())
    assert.deepEqual(await journal(s), [])
    // Nach dem Wiederherstellen wird weiter erfasst (die Trigger entstehen beim Öffnen neu).
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 50, participates: true, selfUsed: false }) })
    assert.deepEqual((await journal(s)).map((g) => g.title), ['Wohnung angelegt: OG'])
  } finally {
    s.stop()
  }
})

test('Vorversion: Sie enthält das Journal, und eingespielt bringt sie es mit', async () => {
  const dir = tmp()
  const opened = await openFreshDatabase(dir)
  try {
    await opened.write((db) => db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 1, participates: true, selfUsed: false }))
    await opened.write((db) => db.insert(changeGroups).values({ at: new Date().toISOString(), method: 'POST', route: '/api/units', description: 'Wohnung angelegt', schemaSteps: 1 }))
    const name = await createPriorVersion(opened, dir, new Date())
    assert.ok(name, 'keine Vorversion angelegt')
    const groups = await rowsOf(path.join(dir, 'vorversionen', name), 'SELECT description FROM change_groups')
    assert.deepEqual(groups.map((r) => r[0]), ['Wohnung angelegt'])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
