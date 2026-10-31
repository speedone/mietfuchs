// Rücksprung und `rowid` (#494): Eine Anfrage, die eine Zeile unverändert löscht und neu einfügt, ändert nichts am
// Inhalt, ihre Gruppe fällt weg (`dropIfNoChange`). Die Zeile hat danach aber eine andere `rowid`, und ein Rücksprung,
// der eine früher gelöschte Zeile mit ihrer alten `rowid` wieder einfügt, darf daran nicht scheitern.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Unit } from '../../shared/types.ts'
import { besideServer, startServerIn, uploadBelegFile, waitForExit, type Server } from '../testing/api.ts'
import { dumpStock, newest, revert, revertRaw, previewOf } from '../testing/revert.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const ok = async (res: Response | Promise<Response>) => {
  const r = await res
  assert.ok(r.ok, `${r.status} ${await r.clone().text()}`)
  return r
}
const DATE = '2025-06-30'
const gap = (s: Server, unitId: string) => ok(send(s, 'PUT', `/api/units/${unitId}/interim-gaps/${DATE}`, { status: 'missed', reason: '' }))
async function unit(s: Server, name: string): Promise<string> {
  const u = (await (await ok(send(s, 'POST', '/api/units', { propertyId: 'objekt-1', name, areaM2: 50, participates: true, selfUsed: false }))).json()) as Unit
  return u.id
}
const gapRows = async (s: Server) => (await dumpStock(s.dataDir))['interim_reading_gaps'] ?? assert.fail('Tabelle interim_reading_gaps fehlt')

test('#494: Unverändert erneut gespeicherte Lücke, danach Rücksprung nach einen früheren Eintrag: zeilengleich mit rowid', async () => {
  const s = await startServerIn(tmp())
  try {
    const u = await unit(s, 'Nord 1')
    await gap(s, u)
    // Eine zweite Lücke dahinter, sonst bekäme die neu eingefügte Zeile in der leeren Tabelle wieder rowid 1.
    await gap(s, await unit(s, 'Nord 2'))
    await ok(send(s, 'PUT', `/api/units/${u}`, { notes: 'eins' }))
    const mark = await newest(s)
    const state = await dumpStock(s.dataDir)
    // Dieselbe Antwort noch einmal: keine Änderung, kein Eintrag im Verlauf.
    await gap(s, u)
    assert.equal((await newest(s)).id, mark.id, 'eine Antwort ohne Änderung ergibt keinen Eintrag')
    await ok(send(s, 'PUT', `/api/units/${u}`, { notes: 'zwei' }))
    await revert(s, mark.id, 'after')
    assert.deepEqual(await dumpStock(s.dataDir), state)
  } finally {
    s.stop()
  }
})

test('#494: Rückgängig eines Löschens, nachdem eine andere Lücke unverändert neu gespeichert wurde', async () => {
  const s = await startServerIn(tmp())
  try {
    const ids = [await unit(s, 'Nord 1'), await unit(s, 'Nord 2'), await unit(s, 'Nord 3')]
    for (const id of ids) await gap(s, id)
    const state = await dumpStock(s.dataDir)
    // Die jüngste Lücke löschen: Ihre rowid ist die höchste und wird frei.
    await ok(send(s, 'DELETE', `/api/units/${ids[2]}/interim-gaps/${DATE}`))
    const removal = await newest(s)
    // Die erste unverändert neu speichern: Neu eingefügt bekäme sie die freie rowid der gelöschten.
    await gap(s, ids[0])
    assert.equal((await newest(s)).id, removal.id)
    const preview = await previewOf(s, removal.id, 'including')
    const res = await revertRaw(s, removal.id, 'including', preview.token)
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual(await gapRows(s), state['interim_reading_gaps'])
  } finally {
    s.stop()
  }
})

// Dieselbe Lage über eine Zeile, die ohne Journal entsteht (`unjournaled`, die Zeile eines Belegs ohne Zeile): Sie kann
// die rowid eines eben gelöschten Belegs bekommen. Der Rücksprung über das Löschen räumt ihr den Platz, statt zu scheitern.
test('#494: Rückgängig eines gelöschten Belegs, dessen rowid inzwischen ein Beleg ohne Journal trägt', async () => {
  const s = await startServerIn(tmp())
  try {
    await uploadBelegFile(s, '%PDF-1.4 eins', 'eins.pdf', { propertyId: 'objekt-1', year: '2025' })
    const zwei = await uploadBelegFile(s, '%PDF-1.4 zwei', 'zwei.pdf', { propertyId: 'objekt-1', year: '2025' })
    const before = (await dumpStock(s.dataDir))['uploads'] ?? []
    await ok(send(s, 'DELETE', `/api/uploads/${zwei}`))
    const removal = await newest(s)
    // Ein Beleg, der ohne Zeile im Ordner liegt (von Hand hineinkopiert, aus einer älteren Fassung).
    fs.writeFileSync(path.join(s.dataDir, 'uploads', 'drei.pdf'), '%PDF-1.4 drei')
    await ok(send(s, 'PUT', '/api/uploads/drei.pdf', { year: 2024 }))
    const preview = await previewOf(s, removal.id, 'including')
    const res = await revertRaw(s, removal.id, 'including', preview.token)
    assert.equal(res.status, 200, await res.clone().text())
    const after = (await dumpStock(s.dataDir))['uploads'] ?? []
    assert.deepEqual(after.filter((r) => !r.includes('drei.pdf')), before, 'beide Belege wie vorher, mit ihrer rowid')
    assert.equal(after.filter((r) => r.includes('drei.pdf')).length, 1, 'der Beleg ohne Journal bleibt')
  } finally {
    s.stop()
  }
})

// Dasselbe Muster in den Untertabellen, die eine Route ganz ersetzt (Staffeln eines Mietverhältnisses, #494): Ein
// unverändertes Speichern ändert nichts am Bestand, auch nicht die rowid.
test('#494: Unverändert gespeichertes Mietverhältnis lässt auch die rowid seiner Staffeln', async () => {
  const s = await startServerIn(tmp())
  try {
    const u = await unit(s, 'Nord 1')
    const body = { unitId: u, tenantName: 'Mieter Eins', persons: 2, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 10000 }, { from: '2025-01', monthlyCents: 12000 }] }
    const t = (await (await ok(send(s, 'POST', '/api/tenancies', body))).json()) as { id: string }
    await ok(send(s, 'POST', '/api/tenancies', { ...body, tenantName: 'Mieter Zwei', unitId: await unit(s, 'Nord 2') }))
    const mark = await newest(s)
    const state = await dumpStock(s.dataDir)
    await ok(send(s, 'PUT', `/api/tenancies/${t.id}`, { prepayments: body.prepayments }))
    assert.equal((await newest(s)).id, mark.id, 'keine Änderung, kein Eintrag')
    assert.deepEqual(await dumpStock(s.dataDir), state)
  } finally {
    s.stop()
  }
})

// Durchsicht S1: Dieselben Staffeln in anderer Reihenfolge sind keine Änderung. Antwort und gespeicherter Stand dürfen
// nicht auseinanderlaufen (vorher zeigte die Antwort die neue Reihenfolge, der nächste Aufruf die alte).
test('#494 S1: Staffeln umgekehrt gespeichert: Antwort und Bestand zeigen dieselbe Reihenfolge', async () => {
  const s = await startServerIn(tmp())
  try {
    const u = await unit(s, 'Nord 1')
    const prepayments = [{ from: '2024-01', monthlyCents: 10000 }, { from: '2025-01', monthlyCents: 12000 }]
    const t = (await (await ok(send(s, 'POST', '/api/tenancies', { unitId: u, tenantName: 'Mieter Eins', persons: 2, start: '2024-01-01', prepayments }))).json()) as { id: string }
    await ok(send(s, 'POST', '/api/tenancies', { unitId: await unit(s, 'Nord 2'), tenantName: 'Mieter Zwei', persons: 1, start: '2024-01-01', prepayments }))
    const mark = await newest(s)
    const state = await dumpStock(s.dataDir)
    const put = (await (await ok(send(s, 'PUT', `/api/tenancies/${t.id}`, { prepayments: [...prepayments].reverse() }))).json()) as { prepayments: unknown }
    // Die Staffel wird sortiert geschrieben: keine Änderung, kein Eintrag, der Bestand zeilengleich.
    assert.equal((await newest(s)).id, mark.id, 'umsortiert ist keine Änderung')
    assert.deepEqual(await dumpStock(s.dataDir), state)
    const all = (await (await ok(send(s, 'GET', '/api/tenancies?property=objekt-1'))).json()) as { id: string, prepayments: unknown }[]
    const got = all.find((x) => x.id === t.id) ?? assert.fail('Mietverhältnis fehlt')
    assert.deepEqual(put.prepayments, got.prepayments)
  } finally {
    s.stop()
  }
})

// Durchsicht S1, allgemein: Eine ganz ersetzte Unterliste, die nicht sortiert geschrieben wird (Teilnehmer einer
// Kostenposition), in anderer Reihenfolge. Die Reihenfolge bleibt dann, wie die Anfrage sie geschickt hat, und
// Antwort und Bestand stimmen überein; das Journal kennt jede rowid.
test('#494 S1: Umsortierte Teilnehmer einer Kostenposition: Antwort und Bestand gleich', async () => {
  const s = await startServerIn(tmp())
  try {
    const ids = [await unit(s, 'Nord 1'), await unit(s, 'Nord 2'), await unit(s, 'Nord 3')]
    const body = { propertyId: 'objekt-1', period: '2025-01', category: 'Hauswart', description: 'Hauswart', amountCents: 60000, key: 'area' }
    const c = (await (await ok(send(s, 'POST', '/api/costItems', { ...body, participantUnitIds: ids.slice(0, 2) }))).json()) as { id: string }
    await ok(send(s, 'POST', '/api/costItems', { ...body, participantUnitIds: ids.slice(1) }))
    const put = (await (await ok(send(s, 'PUT', `/api/costItems/${c.id}`, { participantUnitIds: [ids[1], ids[0]] }))).json()) as { participantUnitIds: unknown }
    const all = (await (await ok(send(s, 'GET', '/api/costItems?property=objekt-1'))).json()) as { id: string, participantUnitIds: unknown }[]
    const got = all.find((x) => x.id === c.id) ?? assert.fail('Kostenposition fehlt')
    assert.deepEqual(put.participantUnitIds, [ids[1], ids[0]])
    assert.deepEqual(got.participantUnitIds, put.participantUnitIds)
  } finally {
    s.stop()
  }
})

// Durchsicht S2: Ein Verlauf, den 0.13 schon verschoben hat (eine Gruppe ohne Änderung fiel weg und nahm die einzige Spur
// der neuen rowid mit). Nachgestellt ohne Trigger neben dem gestoppten Server; „Rückgängig“ des Löschens gelingt
// trotzdem, die verschobene Zeile rückt ans Ende.
test('#494 S2: Rückgängig heilt einen schon verschobenen Verlauf', async () => {
  let s = await startServerIn(tmp())
  try {
    const ids = [await unit(s, 'Nord 1'), await unit(s, 'Nord 2'), await unit(s, 'Nord 3')]
    for (const id of ids) await gap(s, id)
    const state = await gapRows(s)
    await ok(send(s, 'DELETE', `/api/units/${ids[2]}/interim-gaps/${DATE}`))
    const removal = await newest(s)
    s.child.kill()
    await waitForExit(s.child)
    const c = await besideServer(s.dataDir)
    c.exec(`UPDATE interim_reading_gaps SET rowid = 3 WHERE unit_id = '${ids[0]}'`)
    c.close()
    s = await startServerIn(s.dataDir)
    await revert(s, removal.id, 'including')
    const after = await gapRows(s)
    assert.deepEqual(after.slice(0, 2), state.slice(1), 'die beiden anderen auf ihrer rowid')
    assert.equal(after.length, 3)
    assert.ok(after.some((r) => r.startsWith(`[4,"${ids[0]}"`)), `die verschobene am Ende: ${after.join(' | ')}`)
  } finally {
    s.stop()
  }
})
