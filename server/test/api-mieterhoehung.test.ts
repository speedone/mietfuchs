// Integrationstests: Daten der Mieterhöhung (#191, PR 1). Art der Miete, Ausschluss, Art und Indexwert je Stufe über die
// Routen der Mietverhältnisse, Kappungsgrenzen-Verordnung am Objekt; 400 mit Satz; Backup und Verlauf. Jeder Test
// startet den Server mit NKA_DATA_DIR auf einem Wegwerf-Ordner (startServerIn in testing/api.ts setzt auch CI,
// NKA_UPDATE_URL und NKA_HOST).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Property, RentEntry, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, restore, startServer, type Server } from '../testing/api.ts'
import { journalOf, revert } from '../testing/revert.ts'

const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
const put = (s: Server, url: string, body: unknown) =>
  fetch(`${s.base}${url}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const BASE = { personHistory: [], end: null, prepayments: [], prepaymentOverrides: {} }
const INDEXED: RentEntry[] = [
  { from: '2024-01', monthlyCents: 68500, reason: 'agreement', index: { month: '2023-10', value: 94.2, base: 2020 } },
  { from: '2025-03', monthlyCents: 77153, reason: 'index', index: { month: '2024-12', value: 106.1, base: 2020 } },
]

test('Mieterhöhung, Daten: über die Routen anlegen, lesen, Teilrumpf lässt stehen, 400 mit Satz', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...BASE, unitId: u.id, tenantName: 'Index', persons: 1, start: '2024-01-01', rentKind: 'index', rentIncreaseExcluded: false, baseRents: INDEXED })
    assert.equal(t.rentKind, 'index')
    assert.equal(t.rentIncreaseExcluded, false)
    assert.deepEqual(t.baseRents, INDEXED)
    const read = async () => (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)
    assert.equal((await put(s, `/api/tenancies/${t.id}`, { tenantName: 'Index-Neu' })).status, 200)
    assert.deepEqual((await read())?.baseRents, INDEXED)
    // Indexmiete ohne Index: abgelehnt mit einem Satz, nichts geändert.
    const refused = await put(s, `/api/tenancies/${t.id}`, { rentKind: 'free' })
    assert.equal(refused.status, 400)
    assert.match(await errorFrom(refused), /Die Stufe ab 01\.2024 trägt einen Indexwert\. Einen Indexwert gibt es nur bei einer Indexmiete\./)
    assert.equal((await read())?.rentKind, 'index')
    const bad = await put(s, `/api/tenancies/${t.id}`, { baseRents: [{ from: '2024-01', monthlyCents: 68500, reason: 'mietspiegel' }] })
    assert.equal(bad.status, 400)
    assert.match(await errorFrom(bad), /Art der Stufe ist unbekannt/)
    // Ein Mietverhältnis ohne Angaben schickt die Felder nicht.
    const plain = await post<Tenancy>(s, '/api/tenancies', { ...BASE, unitId: u.id, tenantName: 'Ohne', persons: 1, start: '2023-01-01', end: '2023-12-31', baseRents: [{ from: '2023-01', monthlyCents: 50000 }] })
    assert.equal('rentKind' in plain, false)
    assert.deepEqual(plain.baseRents, [{ from: '2023-01', monthlyCents: 50000 }])
  } finally {
    s.stop()
  }
})

test('Mieterhöhung, Daten: Kappungsgrenzen-Verordnung am Objekt über die Route, ein anderer Wert ist ein Satz', async () => {
  const s = await startServer()
  try {
    const p = await post<Property>(s, '/api/properties', { name: 'Haus', kind: 'mfh', address: '', rentCapReduced: true })
    assert.equal(p.rentCapReduced, true)
    assert.equal((await put(s, `/api/properties/${p.id}`, { rentCapReduced: false })).status, 200)
    const read = async () => (await s.api<Property[]>('/api/properties')).find((x) => x.id === p.id)
    assert.equal((await read())?.rentCapReduced, false)
    const bad = await put(s, `/api/properties/${p.id}`, { rentCapReduced: 'ja' })
    assert.equal(bad.status, 400)
    assert.match(await errorFrom(bad), /Kappungsgrenzen-Verordnung gilt, ist ja, nein oder „weiß nicht“/)
  } finally {
    s.stop()
  }
})

test('Mieterhöhung, Daten: im Backup erhalten, im Verlauf zurückzunehmen', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...BASE, unitId: u.id, tenantName: 'Becker', persons: 1, start: '2024-01-01', rentKind: 'index', baseRents: INDEXED })
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const read = async () => (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)
    assert.equal((await put(s, `/api/tenancies/${t.id}`, { baseRents: [{ from: '2024-01', monthlyCents: 68500, reason: 'modernization' }] })).status, 200)
    assert.deepEqual((await read())?.baseRents, [{ from: '2024-01', monthlyCents: 68500, reason: 'modernization' }])
    const [top] = await journalOf(s, '?limit=1')
    if (!top) return assert.fail('kein Eintrag im Verlauf')
    await revert(s, top.id)
    assert.deepEqual((await read())?.baseRents, INDEXED)
    assert.equal((await put(s, `/api/tenancies/${t.id}`, { rentKind: null, baseRents: [] })).status, 200)
    const back = await restore(s, backup)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.equal((await read())?.rentKind, 'index')
    assert.deepEqual((await read())?.baseRents, INDEXED)
  } finally {
    s.stop()
  }
})
