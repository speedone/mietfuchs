// Integrationstests: Daten der Mieterhöhung (#191, PR 1). Art der Miete, Ausschluss, Art und Indexwert je Stufe über die
// Routen der Mietverhältnisse, Kappungsgrenzen-Verordnung am Objekt; 400 mit Satz; Backup und Verlauf. Jeder Test
// startet den Server mit NKA_DATA_DIR auf einem Wegwerf-Ordner (startServerIn in testing/api.ts setzt auch CI,
// NKA_UPDATE_URL und NKA_HOST).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Property, RentEntry, RentIncreasePlan, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, restore, startServer, startServerIn, type Server } from '../testing/api.ts'
import { journalOf, revert } from '../testing/revert.ts'
import { tenancyStamp } from '../../shared/tenancyStamp.ts'

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

test('Mieterhöhung, Daten: die Marke des Formulars erfasst Art, Indexwert, Art der Miete und Ausschluss (Durchsicht)', async () => {
  const s = await startServer()
  try {
    const u = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 50, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', { ...BASE, unitId: u.id, tenantName: 'Index', persons: 1, start: '2024-01-01', baseRents: [{ from: '2024-01', monthlyCents: 68500 }] })
    const read = async () => (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id) ?? assert.fail('Mietverhältnis fehlt')
    const alt = tenancyStamp(await read())
    // Ein anderer Weg (zweiter Tab) ergänzt Art und Index der Stufe; das Formular kennt das nicht.
    const first = await put(s, `/api/tenancies/${t.id}`, { ifUnchanged: alt, rentKind: 'index', baseRents: INDEXED })
    assert.equal(first.status, 200)
    const stale = await put(s, `/api/tenancies/${t.id}`, { ifUnchanged: alt, baseRents: [{ from: '2024-01', monthlyCents: 68500 }] })
    assert.equal(stale.status, 409)
    assert.deepEqual((await read()).baseRents, INDEXED)
    // Auch eine Änderung nur an Art der Miete oder Ausschluss ändert die Marke.
    const neu = tenancyStamp(await read())
    assert.equal((await put(s, `/api/tenancies/${t.id}`, { ifUnchanged: neu, rentIncreaseExcluded: true })).status, 200)
    const staleExcl = await put(s, `/api/tenancies/${t.id}`, { ifUnchanged: neu, tenantName: 'X' })
    assert.equal(staleExcl.status, 409)
  } finally {
    s.stop()
  }
})

test('Mieterhöhung, Daten: die Marke eines Mietverhältnisses ohne die neuen Felder bleibt, wie sie war', () => {
  const stamp = tenancyStamp({ start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 10000 }], heatingPrepayments: [], flatRates: [], baseRents: [{ from: '2024-01', monthlyCents: 50000 }], personHistory: [] })
  assert.equal(stamp, '["2024-01-01",null,["2024-01=10000"],[],[],["2024-01=50000"],[]]')
})

// PR 2 (Rechnung): POST /api/tenancies/:id/rent-increase/plan rechnet nur lesend aus dem Bestand und den Eingaben.
test('Mieterhöhung, Rechnung: Plan über die Route, nur lesend, 404 und 400 mit Satz', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, { NKA_TEST_TODAY: '2026-11-20' })
  try {
    const p = await post<Property>(s, '/api/properties', { name: 'Haus', kind: 'mfh', address: '', rentCapReduced: false, state: 'BY' })
    const u = await post<Unit>(s, `/api/units?property=${p.id}`, { name: 'EG', areaM2: 60, participates: true })
    const t = await post<Tenancy>(s, `/api/tenancies?property=${p.id}`, { ...BASE, unitId: u.id, tenantName: 'Becker', persons: 1, start: '2020-01-01', rentKind: 'free', rentIncreaseExcluded: false, baseRents: [{ from: '2020-01', monthlyCents: 50000 }] })
    const journalBefore = (await journalOf(s)).length
    const plan = await post<RentIncreasePlan>(s, `/api/tenancies/${t.id}/rent-increase/plan`, { kind: 'comparison', allStepsEntered: true, residential: true, noThirdPartyFunds: true, comparisonCentsPerM2: 1000 })
    assert.equal(plan.state, 'possible', plan.reasons.join(' '))
    assert.equal(plan.receivedOn, '2026-11-20', 'Vorgabe ist heute laut Server')
    assert.equal(plan.effectiveFrom, '2027-02')
    assert.equal(plan.cap?.percent, 20, 'Kappungsgrenze vom Objekt')
    assert.equal(plan.maxCents, 60000)
    assert.deepEqual(plan.consent, { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' })
    assert.equal((await journalOf(s)).length, journalBefore, 'nichts geschrieben')
    const missing = await fetch(`${s.base}/api/tenancies/gibtsnicht/rent-increase/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'comparison' }) })
    assert.equal(missing.status, 404)
    for (const body of [{ kind: 'mietspiegel' }, { kind: 'comparison', receivedOn: '2026-02-31' }, { kind: 'comparison', comparisonCentsPerM2: -1 }, { kind: 'comparison', comparisonCentsPerM2: Number.MAX_SAFE_INTEGER }, { kind: 'index', toIndex: { month: '2026-10', value: 106.15, base: 2020 } }, { kind: 'comparison', rentCap: 'vielleicht' }, { kind: 'comparison', receivedOn: '1990-03-05' }, { kind: 'comparison', receivedOn: '9999-12-20' }, { kind: 'comparison', rentAtCapDateOn: '2024-02-30' }]) {
      const bad = await fetch(`${s.base}/api/tenancies/${t.id}/rent-increase/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(bad.status, 400, JSON.stringify(body))
      assert.match(await errorFrom(bad), /\.$/, 'ein ganzer Satz')
    }
  } finally {
    s.stop()
  }
})
