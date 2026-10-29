// Integrationstests: Rücksprung im Verlauf und Papierkorb für Belege (#318, Schritte 4 und 5).
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
import type { RevertPreview } from '../src/db/revert.ts'
import { besideServer, jsonOf, startServerIn, uploadBelegFile, type Server } from '../testing/api.ts'
import { dumpStock, journalOf, newest, previewOf, revert, revertRaw } from '../testing/revert.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })

async function stock(s: Server): Promise<{ unit: Unit, tenancy: Tenancy, meter: Meter }> {
  const unit = await post<Unit>(s, '/api/units', { name: 'EG links', areaM2: 60, participates: true, selfUsed: false })
  const tenancy = await post<Tenancy>(s, '/api/tenancies', { unitId: unit.id, tenantName: 'Müller', persons: 2, start: '2024-01-01', prepayment: 10000 })
  const meter = await post<Meter>(s, '/api/meters', { name: 'Wasser EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³' })
  // Zwei Ablesungen am selben Tag: Ihre Reihenfolge (rowid) trägt Bedeutung.
  await post(s, '/api/readings', { meterId: meter.id, date: '2024-01-01', value: 10 })
  await post(s, '/api/readings', { meterId: meter.id, date: '2024-01-01', value: 11 })
  await post(s, '/api/payments', { tenancyId: tenancy.id, date: '2024-02-01', amountCents: 50000 })
  return { unit, tenancy, meter }
}

test('Rückgängig: der oberste Eintrag, als Gruppe im Verlauf, und Rückgängig davon stellt wieder her', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    const before = await dumpStock(s.dataDir)
    assert.equal((await send(s, 'PUT', `/api/units/${unit.id}`, { name: 'EG rechts' })).status, 200)
    const changed = await dumpStock(s.dataDir)
    const top = await newest(s)
    const preview = await revert(s, top.id)
    assert.equal(preview.kind, 'journal')
    assert.deepEqual(preview.entries.map((e) => e.title), ['Wohnung geändert: EG rechts'])
    assert.deepEqual(await dumpStock(s.dataDir), before)

    const [undo, original] = await journalOf(s, '?limit=2')
    assert.equal(undo.title, 'Rückgängig: Wohnung geändert: EG rechts')
    assert.equal(original.revertedBy, undo.id)
    // Rückgängig vom Rückgängig: wieder der Stand nach der Änderung, und die Änderung gilt wieder.
    await revert(s, undo.id)
    assert.deepEqual(await dumpStock(s.dataDir), changed)
    const [, undone, again] = await journalOf(s, '?limit=3')
    assert.equal(undone.revertedBy !== null, true)
    assert.equal(again.revertedBy, null)
  } finally {
    s.stop()
  }
})

test('Rücksprung: Eine gelöschte Wohnung kommt mit allem zurück, was mit ihr fiel, in derselben Reihenfolge', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    const before = await dumpStock(s.dataDir)
    assert.equal((await send(s, 'DELETE', `/api/units/${unit.id}`)).status, 200)
    await revert(s, (await newest(s)).id)
    assert.deepEqual(await dumpStock(s.dataDir), before)
  } finally {
    s.stop()
  }
})

// read.ts liest `ORDER BY rowid`, und bei zwei Ablesungen am selben Tag entscheidet die Reihenfolge über den Verbrauch.
// Eine gelöschte Zeile aus der Mitte bekommt ihre alte `rowid` zurück, nicht die nächste freie.
test('Rücksprung: Eine gelöschte Ablesung aus der Mitte steht danach wieder an ihrer Stelle', async () => {
  const s = await startServerIn(tmp())
  try {
    const { meter } = await stock(s)
    await post(s, '/api/readings', { meterId: meter.id, date: '2024-12-31', value: 30 })
    const before = await dumpStock(s.dataDir)
    const readings = await s.api<{ id: string, value: number }[]>('/api/readings')
    const middle = readings.find((r) => r.value === 11) ?? assert.fail('keine Ablesung 11')
    assert.equal((await send(s, 'DELETE', `/api/readings/${middle.id}`)).status, 200)
    await revert(s, (await newest(s)).id)
    assert.deepEqual(await dumpStock(s.dataDir), before)
    assert.deepEqual((await s.api<{ value: number }[]>('/api/readings')).map((r) => r.value), [10, 11, 30])
  } finally {
    s.stop()
  }
})

// #455: Mit dem letzten Teil fällt seine Quelle im selben Vorgang weg. Der Rücksprung legt beide wieder an, die Quelle
// vor dem Teil, der auf sie zeigt (Fremdschlüssel). Die Quelle setzt hier die Datei selbst, denn eine Route, die eine
// anlegt, kommt erst mit dem Aufteilen beim Speichern.
test('Rücksprung über das Löschen des letzten Teils stellt Quelle und Teil wieder her', async () => {
  const s = await startServerIn(tmp())
  try {
    const teil = { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', amountCents: 20000, key: 'area', serviceFrom: '2024-01-01', serviceTo: '2024-12-31' }
    const a = await post<{ id: string }>(s, '/api/costItems', { ...teil, description: 'Grundsteuer (Teil 1)' })
    const b = await post<{ id: string }>(s, '/api/costItems', { ...teil, description: 'Grundsteuer (Teil 2)' })
    const c = await besideServer(s.dataDir)
    try {
      c.exec("INSERT INTO cost_sources (id, property_id, rule) VALUES ('q1', 'objekt-1', 'days')")
      c.exec(`UPDATE cost_items SET source_id = 'q1' WHERE id IN ('${a.id}', '${b.id}')`)
    } finally {
      c.close()
    }
    assert.equal((await send(s, 'DELETE', `/api/costItems/${a.id}`)).status, 200)
    const before = await dumpStock(s.dataDir)
    assert.equal(before.cost_sources?.length, 1)
    assert.equal((await send(s, 'DELETE', `/api/costItems/${b.id}`)).status, 200)
    const gone = await dumpStock(s.dataDir)
    assert.deepEqual([gone.cost_sources, gone.cost_items], [[], []])
    const top = await newest(s)
    const detail = await jsonOf<{ changes: { table: string, op: string, refs: Record<string, string> }[] }>(await fetch(`${s.base}/api/journal/${top.id}`))
    assert.deepEqual(detail.changes.map((ch) => [ch.table, ch.op]).sort(), [['cost_items', 'delete'], ['cost_sources', 'delete']])
    // Im Verlauf heißt die Quelle wie ihr Teil, auch wenn beide gelöscht sind.
    assert.equal(detail.changes.find((ch) => ch.table === 'cost_items')?.refs['source_id=q1'], 'Grundsteuer (Teil 2)')
    await revert(s, top.id)
    assert.deepEqual(await dumpStock(s.dataDir), before)
  } finally {
    s.stop()
  }
})

// #455: Das Aufteilen legt Quelle und Teile in einem Vorgang an; der Rücksprung nimmt beide zurück.
test('Rücksprung über ein Aufteilen entfernt Quelle und Teile', async () => {
  const s = await startServerIn(tmp())
  try {
    const before = await dumpStock(s.dataDir)
    const teile = await post<{ id: string, sourceId?: string }[]>(s, '/api/costItems/split', {
      propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48000, key: 'area',
      serviceFrom: '2024-07-01', serviceTo: '2025-06-30', taxYear: 2024,
    })
    assert.equal(teile.length, 2)
    assert.equal(new Set(teile.map((t) => t.sourceId)).size, 1)
    const after = await dumpStock(s.dataDir)
    assert.equal(after.cost_sources?.length, 1)
    assert.equal(after.cost_items?.length, 2)
    const top = await newest(s)
    await revert(s, top.id)
    const gone = await dumpStock(s.dataDir)
    assert.deepEqual([gone.cost_sources, gone.cost_items], [[], []])
    assert.deepEqual(gone, before)
  } finally {
    s.stop()
  }
})

test('Rücksprung: „Stand vor“ nimmt den Eintrag und alles danach zurück, „Stand nach“ nur alles danach', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    const afterStock = await dumpStock(s.dataDir)
    await send(s, 'PUT', `/api/units/${unit.id}`, { name: 'A' })
    const afterA = await dumpStock(s.dataDir)
    const a = await newest(s)
    await send(s, 'PUT', `/api/units/${unit.id}`, { name: 'B' })
    await post(s, '/api/units', { name: 'OG', areaM2: 50, participates: true, selfUsed: false })

    const after = await previewOf(s, a.id, 'after')
    assert.deepEqual(after.entries.map((e) => e.title), ['Wohnung angelegt: OG', 'Wohnung geändert: B'])
    assert.equal(after.changes, 2)
    await revert(s, a.id, 'after')
    assert.deepEqual(await dumpStock(s.dataDir), afterA)

    // Jetzt bis vor A: A, die beiden zurückgenommenen und der Rücksprung selbst stehen im Bereich; zusammen ergibt das den
    // Stand vor A.
    const including = await previewOf(s, a.id, 'including')
    assert.equal(including.entries.length, 4)
    await revert(s, a.id, 'including')
    assert.deepEqual(await dumpStock(s.dataDir), afterStock)
    const top = await newest(s)
    assert.match(top.title, /^Zurückgekehrt zum Stand vor „Wohnung geändert: A“ vom \d\d\.\d\d\.\d{4}, \d\d:\d\d$/)
  } finally {
    s.stop()
  }
})

test('Rücksprung: Ohne passende Marke wird nichts geschrieben, die Antwort trägt die neue Vorschau', async () => {
  const s = await startServerIn(tmp())
  try {
    const { unit } = await stock(s)
    const top = await newest(s)
    const preview = await previewOf(s, top.id)
    await send(s, 'PUT', `/api/units/${unit.id}`, { name: 'neu' })
    const now = await dumpStock(s.dataDir)
    for (const token of [preview.token, undefined, 'falsch']) {
      const res = await revertRaw(s, top.id, 'including', token)
      assert.equal(res.status, 409)
      const body = await jsonOf<{ error: string, preview: RevertPreview }>(res)
      assert.match(body.error, /geändert/)
      assert.equal(body.preview.entries.length, 2)
      assert.notEqual(body.preview.token, preview.token)
    }
    assert.deepEqual(await dumpStock(s.dataDir), now)
    assert.equal((await send(s, 'POST', '/api/journal/999999/revert/preview', {})).status, 404)
    assert.equal((await send(s, 'POST', `/api/journal/${top.id}/revert/preview`, { mode: 'irgendwie' })).status, 400)
    // Nach dem obersten Eintrag gibt es nichts.
    const nothing = await previewOf(s, (await newest(s)).id, 'after')
    assert.match(nothing.refusals.join(' '), /nichts zurückzunehmen/)
  } finally {
    s.stop()
  }
})

test('Rücksprung: Über einen Abschluss und ein Wiederöffnen hinweg wird abgelehnt, danach geht es', async () => {
  const s = await startServerIn(tmp())
  try {
    await stock(s)
    await post(s, '/api/costItems', { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 30000, key: 'area' })
    const beforeClose = await newest(s)
    const closed = await send(s, 'POST', '/api/settlement/2024/close', {})
    assert.equal(closed.status, 201, await closed.clone().text())
    const frozen = await dumpStock(s.dataDir)

    const refused = await previewOf(s, beforeClose.id)
    assert.match(refused.refusals.join(' '), /„Abrechnung abgeschlossen: 2024-01“ vom .* schließt eine Abrechnung ab\./)
    assert.match(refused.refusals.join(' '), /Wieder öffnen/)
    assert.equal((await revertRaw(s, beforeClose.id, 'including', refused.token)).status, 409)
    assert.deepEqual(await dumpStock(s.dataDir), frozen)

    // Auch das Abschließen selbst nimmt der Verlauf nicht zurück; das geht über „Wieder öffnen“.
    assert.notDeepEqual((await previewOf(s, (await newest(s)).id)).refusals, [])
    assert.equal((await send(s, 'DELETE', '/api/settlement/2024/close')).status, 200)
    const reopened = await newest(s)
    assert.match((await previewOf(s, reopened.id)).refusals.join(' '), /öffnet eine abgeschlossene Abrechnung wieder/)
    // Nach dem Wiederöffnen geht der Rücksprung bis dorthin.
    const afterReopen = await dumpStock(s.dataDir)
    await post(s, '/api/units', { name: 'OG', areaM2: 50, participates: true, selfUsed: false })
    await revert(s, reopened.id, 'after')
    assert.deepEqual(await dumpStock(s.dataDir), afterReopen)
  } finally {
    s.stop()
  }
})

test('Rücksprung: Einträge von vor dem letzten Update sind nur lesbar', async () => {
  const s = await startServerIn(tmp())
  try {
    await stock(s)
    const top = await newest(s)
    assert.equal(top.readOnly, false)
    const c = await besideServer(s.dataDir)
    c.exec(`UPDATE change_groups SET schema_steps = schema_steps - 1 WHERE id = ${top.id}`)
    c.close()
    assert.equal((await newest(s)).readOnly, true)
    const preview = await previewOf(s, top.id)
    assert.match(preview.refusals.join(' '), /vor dem letzten Update.*Sicherung/)
  } finally {
    s.stop()
  }
})

test('Rücksprung: Über ein eingespieltes Backup hinweg wird abgelehnt', async () => {
  const s = await startServerIn(tmp())
  try {
    await stock(s)
    const archive = Buffer.from(await (await fetch(`${s.base}/api/backup?journal=1`)).arrayBuffer())
    const fd = new FormData()
    fd.append('file', new Blob([archive], { type: 'application/zip' }), 'backup.zip')
    assert.equal((await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })).status, 200)
    const list = await journalOf(s)
    assert.equal(list[0].barrier, 'restore')
    // Die Einträge aus dem Archiv stehen darunter, nur lesbar.
    assert.ok(list.slice(1).length > 0 && list.slice(1).every((g) => g.readOnly))
    const preview = await previewOf(s, list[1].id)
    assert.match(preview.refusals.join(' '), /Backup eingespielt.*Vor dem Einspielen eines Backups/)
    // Nach dem Einspielen geht es wieder.
    await post(s, '/api/units', { name: 'OG', areaM2: 50, participates: true, selfUsed: false })
    await revert(s, (await newest(s)).id)
  } finally {
    s.stop()
  }
})

test('Papierkorb: Ein gelöschter Beleg liegt im Papierkorb, der Rücksprung holt ihn zurück, nicht ins Backup', async () => {
  const s = await startServerIn(tmp())
  try {
    const file = await uploadBelegFile(s, '%PDF-1.4 Grundsteuer', 'grundsteuer.pdf', { propertyId: 'objekt-1', year: '2024' })
    const inUploads = path.join(s.dataDir, 'uploads', file)
    const inTrash = path.join(s.dataDir, 'papierkorb', 'uploads', file)
    const withFile = await dumpStock(s.dataDir)
    assert.equal((await send(s, 'DELETE', `/api/uploads/${file}`)).status, 200)
    assert.ok(!fs.existsSync(inUploads) && fs.existsSync(inTrash))
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    assert.deepEqual(zip.getEntries().map((e) => e.entryName).filter((n) => n.includes('papierkorb') || n.includes(file)), [])

    const deleted = await newest(s)
    assert.equal(deleted.title, 'Beleg gelöscht: grundsteuer.pdf')
    const preview = await revert(s, deleted.id)
    assert.deepEqual(preview.files, { restore: 1, trash: 0 })
    assert.ok(fs.existsSync(inUploads) && !fs.existsSync(inTrash))
    assert.deepEqual(await dumpStock(s.dataDir), withFile)

    // Rückgängig davon: wieder im Papierkorb. Und das Hochladen zurückgenommen ebenso.
    await revert(s, (await newest(s)).id)
    assert.ok(!fs.existsSync(inUploads) && fs.existsSync(inTrash))
    // Fehlt die Datei im Papierkorb, wird abgelehnt.
    fs.rmSync(inTrash)
    const missing = await previewOf(s, (await newest(s)).id)
    assert.match(missing.refusals.join(' '), /weder im Belegordner noch im Papierkorb/)
  } finally {
    s.stop()
  }
})

test('Papierkorb: Ein älterer Beleg ohne Zeile wird beim Löschen erfasst und kommt zurück', async () => {
  const s = await startServerIn(tmp())
  try {
    const name = '1700000000000-alt.pdf'
    fs.writeFileSync(path.join(s.dataDir, 'uploads', name), '%PDF-1.4 alt')
    assert.equal((await send(s, 'DELETE', `/api/uploads/${name}`)).status, 200)
    const top = await newest(s)
    assert.equal(top.description, 'Beleg gelöscht')
    await revert(s, top.id)
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', name)))
  } finally {
    s.stop()
  }
})

test('Papierkorb: Beim Start räumt der Server weg, was der Verlauf nicht mehr nennt, und nur eigene Dateien', async () => {
  const dir = tmp()
  const s = await startServerIn(dir)
  const file = await uploadBelegFile(s, '%PDF-1.4 Grundsteuer', 'grundsteuer.pdf', { propertyId: 'objekt-1', year: '2024' })
  assert.equal((await send(s, 'DELETE', `/api/uploads/${file}`)).status, 200)
  s.child.kill()
  await new Promise((resolve) => s.child.once('exit', resolve))
  const trash = path.join(dir, 'papierkorb', 'uploads')
  fs.writeFileSync(path.join(trash, 'unbekannt.pdf'), 'x')
  fs.mkdirSync(path.join(trash, 'restore-0123456789abcdef'))
  fs.mkdirSync(path.join(dir, 'papierkorb', 'eigener-ordner'))
  // Der Verlauf ist abgelaufen: nichts nennt die Datei mehr.
  const c = await besideServer(dir)
  c.exec("UPDATE change_groups SET at = '2000-01-01T00:00:00.000Z'")
  c.close()
  const again = await startServerIn(dir)
  try {
    assert.equal((await journalOf(again)).length, 0)
    assert.deepEqual(fs.readdirSync(trash).sort(), ['restore-0123456789abcdef'])
    assert.ok(fs.existsSync(path.join(dir, 'papierkorb', 'eigener-ordner')))
  } finally {
    again.stop()
  }
})

test('Rücksprung: Einstellungen und KI-Plätze lassen sich zurücknehmen wie andere Zeilen', async () => {
  const s = await startServerIn(tmp())
  try {
    const before = await dumpStock(s.dataDir)
    const settings = await s.api<{ ai: { text: Record<string, unknown> } }>('/api/settings')
    const ai = { ...settings.ai, text: { ...settings.ai.text, model: 'anderes-modell' } }
    assert.equal((await send(s, 'PUT', '/api/settings', { landlordName: 'Neuer Name', ai })).status, 200)
    const changed = await dumpStock(s.dataDir)
    assert.ok(changed.ai_slots.some((row) => row.includes('anderes-modell')), 'der KI-Platz ist geändert')
    assert.notDeepEqual(await dumpStock(s.dataDir), before)
    await revert(s, (await newest(s)).id)
    assert.deepEqual(await dumpStock(s.dataDir), before)
    const reread = await s.api<Record<string, unknown>>('/api/settings')
    assert.notEqual(reread.landlordName, 'Neuer Name')
    // Das nächste Speichern geht vom zurückgenommenen Stand aus, nicht vom Zwischenspeicher.
    assert.equal((await send(s, 'PUT', '/api/settings', { paymentDeadlineDays: 21 })).status, 200)
    assert.notEqual((await s.api<Record<string, unknown>>('/api/settings')).landlordName, 'Neuer Name')
  } finally {
    s.stop()
  }
})

// Das Sicherheitsnetz: Ein Verlauf, der nicht zum Bestand passt (hier von Hand verfälscht), ergäbe einen Verweis ins
// Leere. Dann wird alles zurückgerollt.
test('Rücksprung: Verstößt das Ergebnis gegen eine Zusicherung, bleibt alles, wie es war', async () => {
  const s = await startServerIn(tmp())
  try {
    const { tenancy } = await stock(s)
    await send(s, 'PUT', `/api/tenancies/${tenancy.id}`, { tenantName: 'Schmidt' })
    const top = await newest(s)
    const c = await besideServer(s.dataDir)
    c.exec(`UPDATE change_log SET before = json_set(before, '$.unit_id', 'gibt-es-nicht') WHERE group_id = ${top.id} AND table_name = 'tenancies'`)
    c.close()
    const now = await dumpStock(s.dataDir)
    const preview = await previewOf(s, top.id)
    assert.match(preview.refusals.join(' '), /stimmte der Bestand nicht.*verwiese auf eine fehlende/)
    assert.equal((await revertRaw(s, top.id, 'including', preview.token)).status, 409)
    assert.deepEqual(await dumpStock(s.dataDir), now)
  } finally {
    s.stop()
  }
})
