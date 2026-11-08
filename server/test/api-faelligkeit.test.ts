// Integrationstests: Fälligkeit der Miete am Mietverhältnis (#334, Entwurf E1, Datenmodell). Anlegen, lesen, als
// Teilrumpf stehen lassen, leeren, 400 mit Satz; Backup vor den Schritten 0092/0093, Backup aus einer db.json,
// Verlauf mit Rücksprung. Jeder Test startet den Server mit NKA_DATA_DIR auf einem Wegwerf-Ordner (startServerIn in
// testing/api.ts setzt auch CI und NKA_UPDATE_URL).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { Tenancy, Unit } from '../../shared/types.ts'
import { archive, errorFrom, restore, startServer, type Server } from '../testing/api.ts'
import { journalOf, revert } from '../testing/revert.ts'

const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
const put = (s: Server, id: string, body: unknown) =>
  fetch(`${s.base}/api/tenancies/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const EMPTY = { personHistory: [], end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 50000 }] }
const terms = (t: Tenancy | undefined) => [t?.rentDue ?? null, t?.rentDueDay ?? null, t?.firstRentAtStart ?? null]

test('Fälligkeit am Mietverhältnis: anlegen, lesen, Teilrumpf lässt stehen, null leert, Wechsel der Regel nimmt den Tag mit', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...EMPTY, unitId: u.id, tenantName: 'Becker', persons: 1, start: '2025-01-01', rentDue: 'dayOfMonth', rentDueDay: 15, firstRentAtStart: true })
    assert.deepEqual(terms(t), ['dayOfMonth', 15, true])
    const plain = await post<Tenancy>(s, '/api/tenancies', { ...EMPTY, unitId: u.id, tenantName: 'Ohne', persons: 1, start: '2024-01-01', end: '2024-12-31' })
    assert.deepEqual(terms(plain), [null, null, null], 'ohne Angabe: gesetzlich')
    assert.equal('rentDue' in plain, false, 'gesetzlich wird nicht als Feld geschickt')
    const read = async () => (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)
    assert.deepEqual(terms(await read()), ['dayOfMonth', 15, true])
    // Ein Teilrumpf ohne die Felder lässt sie stehen.
    assert.equal((await put(s, t.id, { tenantName: 'Becker-Neu' })).status, 200)
    assert.deepEqual(terms(await read()), ['dayOfMonth', 15, true])
    // Erste Miete bei Beginn: false und null heißen nein.
    assert.equal((await put(s, t.id, { firstRentAtStart: false })).status, 200)
    assert.deepEqual(terms(await read()), ['dayOfMonth', 15, null])
    // Ein anderer Tag.
    assert.equal((await put(s, t.id, { rentDueDay: 31 })).status, 200)
    assert.deepEqual(terms(await read()), ['dayOfMonth', 31, null])
    // Wechsel der Regel ohne Tag im Rumpf nimmt den gespeicherten Tag mit weg.
    assert.equal((await put(s, t.id, { rentDue: 'inArrears' })).status, 200)
    assert.deepEqual(terms(await read()), ['inArrears', null, null])
    assert.equal((await put(s, t.id, { rentDue: 'dayOfMonth', rentDueDay: 3 })).status, 200)
    // null leert Regel und Tag: gesetzlich.
    assert.equal((await put(s, t.id, { rentDue: null })).status, 200)
    assert.deepEqual(terms(await read()), [null, null, null])
    assert.equal((await put(s, t.id, { rentDue: 'startWorkday', firstRentAtStart: true })).status, 200)
    assert.deepEqual(terms(await read()), ['startWorkday', null, true])
  } finally {
    s.stop()
  }
})

test('Fälligkeit am Mietverhältnis: 400 mit Satz bei unbekannter Regel, Tag ohne festen Tag, Tag außerhalb 1 bis 31, nicht ja oder nein', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...EMPTY, unitId: u.id, tenantName: 'Becker', persons: 1, start: '2025-01-01' })
    const cases: [unknown, RegExp][] = [
      [{ rentDue: 'monatlich' }, /Fälligkeit der Miete/],
      [{ rentDue: 'startWorkday', rentDueDay: 15 }, /Tag.*nur bei einem festen Tag/],
      [{ rentDueDay: 15 }, /Tag.*nur bei einem festen Tag/],
      [{ rentDue: 'dayOfMonth' }, /Tag des Monats/],
      [{ rentDue: 'dayOfMonth', rentDueDay: 0 }, /zwischen 1 und 31/],
      [{ rentDue: 'dayOfMonth', rentDueDay: 32 }, /zwischen 1 und 31/],
      [{ rentDue: 'dayOfMonth', rentDueDay: 1.5 }, /zwischen 1 und 31/],
      [{ rentDue: 'dayOfMonth', rentDueDay: '15' }, /zwischen 1 und 31/],
      [{ firstRentAtStart: 'ja' }, /Erste Miete schon bei Mietbeginn fällig ist ja oder nein/],
      [{ firstRentAtStart: 1 }, /Erste Miete schon bei Mietbeginn fällig ist ja oder nein/],
    ]
    for (const [body, message] of cases) {
      const r = await put(s, t.id, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.match(await errorFrom(r), message, JSON.stringify(body))
    }
    const created = await fetch(`${s.base}/api/tenancies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...EMPTY, unitId: u.id, tenantName: 'X', persons: 1, start: '2025-01-01', rentDue: 'dayOfMonth', rentDueDay: 40 }) })
    assert.equal(created.status, 400)
    // Nichts davon ist gespeichert.
    const [back] = (await s.api<Tenancy[]>('/api/tenancies')).filter((x) => x.id === t.id)
    assert.deepEqual(terms(back), [null, null, null])
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1)
  } finally {
    s.stop()
  }
})

test('Fälligkeit am Mietverhältnis: im Backup erhalten, im Verlauf zurückzunehmen', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...EMPTY, unitId: u.id, tenantName: 'Becker', persons: 1, start: '2025-01-01', rentDue: 'dayOfMonth', rentDueDay: 15 })
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal((await put(s, t.id, { rentDue: 'inArrears', firstRentAtStart: true })).status, 200)
    const read = async () => (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)
    assert.deepEqual(terms(await read()), ['inArrears', null, true])
    // Verlauf: die Änderung steht da und lässt sich zurücknehmen.
    const [top] = await journalOf(s, '?limit=1')
    if (!top) return assert.fail('kein Eintrag im Verlauf')
    assert.match(top.title, /Becker/)
    await revert(s, top.id)
    assert.deepEqual(terms(await read()), ['dayOfMonth', 15, null])
    // Backup: der gesicherte Stand kommt zurück.
    assert.equal((await put(s, t.id, { rentDue: null })).status, 200)
    const back = await restore(s, backup)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.deepEqual(terms(await read()), ['dayOfMonth', 15, null])
  } finally {
    s.stop()
  }
})

test('Fälligkeit am Mietverhältnis: ein Backup von vor den Schritten 0092/0093 und eines mit db.json kommen gesetzlich zurück', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-faelligkeit-backup-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const c = await connect(file)
    const migrations = await loadMigrations()
    const until = migrations.findIndex((m) => m.tag.endsWith('_faelligkeit_miete'))
    if (until < 0) assert.fail('Schritt …_faelligkeit_miete fehlt')
    applyMigrations(c, migrations.slice(0, until))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, contract_date) VALUES ('t', 'u', 'Mieter', 1, '1998-04-01', '1998-03-15')`)
    c.close()
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const [t] = await s.api<Tenancy[]>('/api/tenancies')
    assert.deepEqual(terms(t), [null, null, null])
    assert.equal(t?.contractDate, '1998-03-15')

    // Ein altes Backup mit db.json (Umstieg über den eingefrorenen Eingang) ebenso.
    const json = archive({}, { units: [{ id: 'u1', name: 'EG', areaM2: 50, participates: true }], tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'Alt', persons: 1, personHistory: [], start: '1999-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }], costItems: [], meters: [], readings: [], payments: [], settings: {} })
    const fromJson = await restore(s, json)
    assert.equal(fromJson.status, 200, JSON.stringify(fromJson.body))
    const [alt] = await s.api<Tenancy[]>('/api/tenancies')
    assert.equal(alt?.tenantName, 'Alt')
    assert.deepEqual(terms(alt), [null, null, null])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Durchsicht K3: Beim Mieterwechsel behält der Ausziehende seine Fälligkeit, der Nachmieter beginnt gesetzlich, außer er
// bringt eine eigene mit.
test('Fälligkeit beim Mieterwechsel: der Ausziehende behält sie, der Nachmieter beginnt gesetzlich oder mit seiner eigenen', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const alt = await post<Tenancy>(s, '/api/tenancies', { ...EMPTY, unitId: u.id, tenantName: 'Alt', persons: 1, start: '2025-01-01', rentDue: 'dayOfMonth', rentDueDay: 15, firstRentAtStart: true })
    const change = (id: string, body: unknown) => fetch(`${s.base}/api/tenancies/${id}/change?property=objekt-1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const newBody = (over: Record<string, unknown> = {}) => ({ tenantName: 'Neu', persons: 1, personHistory: [], start: '2025-07-01', baseRents: [{ from: '2025-07', monthlyCents: 50000 }], prepayments: [], prepaymentOverrides: {}, ...over })
    const res = await change(alt.id, { end: '2025-06-30', readings: [], newTenancy: newBody() })
    assert.equal(res.status, 200, await res.clone().text())
    const all = await s.api<Tenancy[]>('/api/tenancies')
    assert.deepEqual(terms(all.find((t) => t.tenantName === 'Alt')), ['dayOfMonth', 15, true])
    const neu = all.find((t) => t.tenantName === 'Neu')
    assert.deepEqual(terms(neu), [null, null, null])
    // Der nächste Nachmieter bringt eine eigene Fälligkeit mit.
    const res2 = await change(neu?.id ?? assert.fail('kein Nachmieter'), { end: '2025-12-31', readings: [], newTenancy: newBody({ tenantName: 'Danach', start: '2026-01-01', baseRents: [{ from: '2026-01', monthlyCents: 50000 }], rentDue: 'inArrears' }) })
    assert.equal(res2.status, 200, await res2.clone().text())
    assert.deepEqual(terms((await s.api<Tenancy[]>('/api/tenancies')).find((t) => t.tenantName === 'Danach')), ['inArrears', null, null])
    // Eine ungültige Angabe am Nachmieter ist eine 400, und nichts ist beendet.
    const danach = (await s.api<Tenancy[]>('/api/tenancies')).find((t) => t.tenantName === 'Danach')
    const bad = await change(danach?.id ?? assert.fail('kein Nachmieter'), { end: '2026-06-30', readings: [], newTenancy: newBody({ tenantName: 'X', start: '2026-07-01', baseRents: [], rentDue: 'dayOfMonth' }) })
    assert.equal(bad.status, 400)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).find((t) => t.tenantName === 'Danach')?.end, null)
  } finally {
    s.stop()
  }
})
