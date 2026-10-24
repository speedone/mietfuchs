// Befunde der Durchsicht von PR #439 (#318, Rücksprung und Papierkorb), je mit Reproduktion über die Routen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HeatingPlant, Unit } from '../../shared/types.ts'
import { besideServer, chatRequests, jsonOf, LONG_TEXT, startServerIn, until, uploadBelegFile, waitForExit, withOllama, type Server } from '../testing/api.ts'
import { dumpStock, journalOf, newest, previewOf, revert, revertRaw, snapshotPreviewOf } from '../testing/revert.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })

async function restart(s: Server, before?: (dir: string) => Promise<void> | void): Promise<Server> {
  s.child.kill()
  await waitForExit(s.child)
  await before?.(s.dataDir)
  return startServerIn(s.dataDir)
}
const ageJournal = async (dir: string) => {
  const c = await besideServer(dir)
  c.exec("UPDATE change_groups SET at = '2000-01-01T00:00:00.000Z'")
  c.close()
}

// M1: Nach dem Einspielen einer Vorversion nennt der Bestand einen Beleg, der im Papierkorb liegt. Vorher löschte das
// Aufräumen ihn, sobald der Verlauf ihn nicht mehr nannte.
test('Durchsicht M1: Ein Beleg, den der Bestand nennt, kommt aus dem Papierkorb zurück und überlebt das Aufräumen', async () => {
  let s = await startServerIn(tmp())
  try {
    const file = await uploadBelegFile(s, '%PDF-1.4 Grundsteuer', 'grundsteuer.pdf', { propertyId: 'objekt-1', year: '2024' })
    const versions = path.join(s.dataDir, 'vorversionen')
    fs.mkdirSync(versions, { recursive: true })
    const name = 'vorversion-2026-01-01-000000.sqlite'
    const c = await besideServer(s.dataDir)
    c.exec(`VACUUM INTO '${path.join(versions, name).replace(/'/g, "''")}'`)
    c.close()
    assert.equal((await send(s, 'DELETE', `/api/uploads/${file}`)).status, 200)
    const inUploads = path.join(s.dataDir, 'uploads', file)
    assert.ok(!fs.existsSync(inUploads))
    const { token } = await snapshotPreviewOf(s, name)
    const res = await send(s, 'POST', `/api/prior-versions/${name}/restore`, { token })
    assert.equal(res.status, 200, await res.clone().text())
    const body = await jsonOf<{ notes: string[] }>(res)
    assert.ok(fs.existsSync(inUploads), 'nach dem Einspielen zurück im Belegordner')
    assert.ok(body.notes.some((n) => /Papierkorb/.test(n)), body.notes.join(' | '))
    s = await restart(s, ageJournal)
    assert.ok(fs.existsSync(inUploads), 'nach dem Aufräumen noch da')
  } finally {
    s.stop()
  }
})

// M1 (a) und K1: Beim Start gleicht der Server Belegordner und Papierkorb mit dem Bestand ab (etwa nach einem
// Verschieben, das nach dem Festschreiben scheiterte). Nie geht dabei eine Datei verloren.
test('Durchsicht M1/K1: Abgleich beim Start in beide Richtungen, eine Datei des Nutzers bleibt', async () => {
  let s = await startServerIn(tmp())
  try {
    const kept = await uploadBelegFile(s, '%PDF-1.4 A', 'a.pdf', { propertyId: 'objekt-1', year: '2024' })
    const gone = await uploadBelegFile(s, '%PDF-1.4 B', 'b.pdf', { propertyId: 'objekt-1', year: '2024' })
    assert.equal((await send(s, 'DELETE', `/api/uploads/${gone}`)).status, 200)
    const uploads = path.join(s.dataDir, 'uploads')
    const trash = path.join(s.dataDir, 'papierkorb', 'uploads')
    s = await restart(s, (dir) => {
      // Als wäre das Verschieben gescheitert: a.pdf liegt im Papierkorb, b.pdf noch im Belegordner.
      fs.renameSync(path.join(dir, 'uploads', kept), path.join(dir, 'papierkorb', 'uploads', kept))
      fs.renameSync(path.join(dir, 'papierkorb', 'uploads', gone), path.join(dir, 'uploads', gone))
      fs.writeFileSync(path.join(dir, 'uploads', 'eigene-datei.pdf'), 'vom Nutzer')
      return ageJournal(dir)
    })
    assert.ok(fs.existsSync(path.join(uploads, kept)), 'die Datei, die der Bestand nennt, ist zurück')
    assert.ok(!fs.existsSync(path.join(trash, kept)))
    assert.ok(fs.existsSync(path.join(uploads, 'eigene-datei.pdf')), 'die Datei des Nutzers bleibt')
    // b.pdf liegt im Belegordner und bleibt dort: Der Abgleich legt nichts in den Papierkorb.
    assert.ok(fs.existsSync(path.join(uploads, gone)))
  } finally {
    s.stop()
  }
})

// Gegenprüfung von PR #439: Holt der Vermieter einen gelöschten Beleg von Hand aus dem Papierkorb in den Belegordner,
// bleibt er dort. Der Abgleich legt nie einen Beleg aus dem Belegordner in den Papierkorb (vorher tat er es beim nächsten
// Start, und nach zwölf Monaten war er endgültig weg).
test('Gegenprüfung: Ein von Hand aus dem Papierkorb zurückgeholter Beleg bleibt im Belegordner', async () => {
  let s = await startServerIn(tmp())
  try {
    const gone = await uploadBelegFile(s, '%PDF-1.4 B', 'b.pdf', { propertyId: 'objekt-1', year: '2024' })
    assert.equal((await send(s, 'DELETE', `/api/uploads/${gone}`)).status, 200)
    s = await restart(s, (dir) => fs.copyFileSync(path.join(dir, 'papierkorb', 'uploads', gone), path.join(dir, 'uploads', gone)))
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', gone)), 'der zurückgeholte Beleg bleibt')
    s = await restart(s, ageJournal)
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', gone)), 'auch nach dem Aufräumen')
  } finally {
    s.stop()
  }
})

// M2: Ein Widerruf bleibt ein Widerruf.
test('Durchsicht M2: Ein Rücksprung stellt keine widerrufene Zustimmung wieder her', async () => {
  const s = await startServerIn(tmp())
  try {
    assert.equal((await send(s, 'POST', '/api/ai/consent', { slot: 'text' })).status, 200)
    const consentOf = async () => (await dumpStock(s.dataDir, { raw: true })).ai_slots.join()
    assert.match(await consentOf(), /\d{4}-\d{2}-\d{2}/)
    assert.equal((await send(s, 'DELETE', '/api/ai/consent/text')).status, 200)
    const preview = await revert(s, (await newest(s)).id)
    assert.doesNotMatch(await consentOf(), /\d{4}-\d{2}-\d{2}/, 'die Bestätigung bleibt widerrufen')
    assert.ok(preview.notes.some((n) => /Zustimmung/.test(n)), preview.notes.join(' | '))

    assert.equal((await send(s, 'PUT', '/api/settings', { updateCheck: 'on' })).status, 200)
    assert.equal((await send(s, 'PUT', '/api/settings', { updateCheck: 'off' })).status, 200)
    await revert(s, (await newest(s)).id)
    assert.equal((await s.api<{ updateCheck?: string }>('/api/settings')).updateCheck, 'off')
  } finally {
    s.stop()
  }
})

// K2: Während eine KI-Auswertung läuft, schriebe sie nach dem Rücksprung auf einen Beleg, den es nicht mehr gibt.
test('Durchsicht K2: Kein Rücksprung, solange eine KI-Auswertung läuft', async () => {
  await withOllama(async (s, ollama) => {
    await post(s, '/api/units', { name: 'EG', areaM2: 60, participates: true, selfUsed: false })
    const top = await newest(s)
    const requestId = '0123456789abcdef0123456789abcdef'
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf')
    fd.append('pdfText', LONG_TEXT)
    fd.append('requestId', requestId)
    const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } }).then((r) => r.text())
    assert.ok(await until(() => chatRequests(ollama).length > 0), 'Ollama wurde nicht gefragt')
    const preview = await previewOf(s, top.id)
    assert.match(preview.refusals.join(' '), /KI/)
    assert.equal((await revertRaw(s, top.id, 'including', preview.token)).status, 409)
    assert.equal((await send(s, 'POST', `/api/ai/cancel/${requestId}`)).status, 200)
    await pending
  }, { chat: 'hang' })
})

test('Durchsicht K2: Eine Kostenposition nimmt keinen neuen Beleg an, den es im Belegordner nicht gibt', async () => {
  const s = await startServerIn(tmp())
  try {
    const body = { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'GS', amountCents: 100, key: 'area' }
    const missing = await send(s, 'POST', '/api/costItems', { ...body, invoiceFile: 'gibt-es-nicht.pdf' })
    assert.equal(missing.status, 400)
    const file = await uploadBelegFile(s, '%PDF-1.4 GS', 'gs.pdf', { propertyId: 'objekt-1', year: '2024' })
    const item = await post<{ id: string }>(s, '/api/costItems', { ...body, invoiceFile: file })
    // Ein alter Verweis, dessen Datei inzwischen fehlt, hindert das Speichern nicht, solange er sich nicht ändert.
    fs.rmSync(path.join(s.dataDir, 'uploads', file))
    assert.equal((await send(s, 'PUT', `/api/costItems/${item.id}`, { amountCents: 200, invoiceFile: file })).status, 200)
    assert.equal((await send(s, 'PUT', `/api/costItems/${item.id}`, { invoiceFile: 'anderer.pdf' })).status, 400)
  } finally {
    s.stop()
  }
})

// K3: Ein Rücksprung, der sich zu nichts zusammenfasst, bleibt im Verlauf (sonst stünden die zurückgenommenen Einträge
// wieder als geltend da).
test('Durchsicht K3: Ein Rücksprung ohne sichtbaren Unterschied steht trotzdem im Verlauf', async () => {
  const s = await startServerIn(tmp())
  try {
    const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 60, participates: true, selfUsed: false })
    assert.equal((await send(s, 'DELETE', `/api/units/${unit.id}`)).status, 200)
    const deleted = await newest(s)
    await revert(s, deleted.id)
    await revert(s, deleted.id, 'including')
    const [top] = await journalOf(s, '?limit=1')
    assert.match(top.title, /^Zurückgekehrt zum Stand vor „Wohnung gelöscht: EG“/)
    const all = await journalOf(s)
    assert.notEqual(all.find((g) => g.id === deleted.id)?.revertedBy ?? null, null)
  } finally {
    s.stop()
  }
})

// K4: Der oberste Eintrag des gefilterten Verlaufs ist nicht immer die neueste Gruppe.
test('Durchsicht K4: Der Verlauf sagt, welcher Eintrag der neueste insgesamt ist', async () => {
  const s = await startServerIn(tmp())
  try {
    await post(s, '/api/units', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true, selfUsed: false })
    const second = await post<{ id: string }>(s, '/api/properties', { name: 'Zweites Haus' })
    await post(s, '/api/units', { propertyId: second.id, name: 'Hinterhaus', areaM2: 40, participates: true, selfUsed: false })
    const [own] = await journalOf(s, '?property=objekt-1&limit=1')
    assert.equal(own.newest, false)
    const [all] = await journalOf(s, '?limit=1')
    assert.equal(all.newest, true)
  } finally {
    s.stop()
  }
})

// K6: Über den Abschluss einer getrennten Heizkostenabrechnung führt kein Rücksprung.
test('Durchsicht K6: Ein Rücksprung über den Abschluss einer Heizkostenabrechnung wird abgelehnt', async () => {
  const s = await startServerIn(tmp())
  try {
    const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 60, participates: true })
    await post(s, '/api/tenancies', { unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 10000 }] })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send(s, 'POST', '/api/heating-plants', { energy: 'gas', method: 'service' }))
    const token = async (url: string, body: unknown) => (await jsonOf<{ token: string }>(await send(s, 'POST', url, body))).token
    const rules = { startMonth: 5, changes: [] }
    await send(s, 'PUT', `/api/heating-plants/${plant.id}/period`, { rules, answers: { understood: true, token: await token(`/api/heating-plants/${plant.id}/period/preview`, { rules }) } })
    const separate = { separate: true, month: '2025-05' }
    const preview = await jsonOf<{ token: string, steps: { tenancyId: string, rows: { from: string }[] }[] }>(await send(s, 'POST', `/api/heating-plants/${plant.id}/separate/preview`, separate))
    const steps = Object.fromEntries(preview.steps.map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((r) => [r.from, 5000]))]))
    assert.equal((await send(s, 'PUT', `/api/heating-plants/${plant.id}/separate`, { ...separate, answers: { understood: true, steps, token: preview.token } })).status, 200)
    await post(s, '/api/costItems', { period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 })
    const beforeClose = await newest(s)
    const url = `/api/heating-settlement/${plant.id}/2025-05/close`
    let closed = await send(s, 'POST', url, {})
    if (closed.status === 409) closed = await send(s, 'POST', url, { despiteErrors: (await jsonOf<{ errorToken: string }>(closed)).errorToken })
    assert.equal(closed.status, 201, await closed.clone().text())
    const now = await dumpStock(s.dataDir)
    const refused = await previewOf(s, beforeClose.id)
    assert.match(refused.refusals.join(' '), /schließt eine Abrechnung ab/)
    assert.equal((await revertRaw(s, beforeClose.id, 'including', refused.token)).status, 409)
    assert.deepEqual(await dumpStock(s.dataDir), now)
  } finally {
    s.stop()
  }
})
