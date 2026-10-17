// Integrationstests gegen den echten Server: Wohnungen löschen, Objekte, Mieterwechsel und IBAN-Prüfung.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import type {
  CostItem, Meter, Payment, Property, Reading, Settlement, Tenancy, Unit, UnitDependents,
} from '../../shared/types.ts'
import {
  type ClientSettings, type Server, archive, databaseOfV080, errorFrom, jsonOf, restore, startServer, wechsel, withProperties,
} from '../testing/api.ts'

// ---------- Was mit einer Wohnung gelöscht wird (#142) ----------
// Die Löschfrage nannte nur die Mietverhältnisse. Die Fremdschlüssel nehmen aber mehr mit, und
// ein Vermieter, der das nicht weiß, löscht mit der Garage seine Ablesungen und Zahlungen.

test('Wohnung löschen: die Antwort zählt, was mitgelöscht wird, und die Zahlen stimmen danach', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const eg = await post<Unit>('/api/units', { name: 'EG', areaM2: 80, participates: true })
    const og = await post<Unit>('/api/units', { name: 'OG', areaM2: 60, participates: true })
    const neu = (unitId: string, tenantName: string) => post<Tenancy>('/api/tenancies', {
      unitId, tenantName, persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })
    const a = await neu(eg.id, 'A')
    await neu(eg.id, 'B')
    const c = await neu(og.id, 'C')
    const zaehler = await post<Meter>('/api/meters', { name: 'KW EG', unitId: eg.id, type: 'kaltwasser', unit: 'm³' })
    await post<Meter>('/api/meters', { name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' })
    for (const [date, value] of [['2024-12-31', 1], ['2025-12-31', 50]] as const) await post('/api/readings', { meterId: zaehler.id, date, value })
    for (const date of ['2025-01-03', '2025-02-03', '2025-03-03']) await post('/api/payments', { tenancyId: a.id, date, amountCents: 50000 })
    await post('/api/payments', { tenancyId: c.id, date: '2025-01-03', amountCents: 40000 })
    await post('/api/costItems', { year: 2025, category: 'Grundsteuer', description: 'Anteile', amountCents: 10000, key: 'custom', customShares: { [eg.id]: 50, [og.id]: 50 } })
    await post('/api/costItems', { year: 2025, category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area', participantUnitIds: [eg.id] })
    await post('/api/costItems', { year: 2025, category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 10000, key: 'amounts', tenancyAmounts: { [a.id]: 3000, [c.id]: 4000 } })
    await post('/api/costItems', { year: 2025, category: 'Hauswart', description: 'Direkt', amountCents: 10000, key: 'direct', directUnitId: eg.id })

    const deps = await s.api<UnitDependents>(`/api/units/${eg.id}/dependents`)
    assert.deepEqual(deps, { tenancies: 2, meters: 1, readings: 2, payments: 3, costItemLinks: 3, directCostItems: 1, fuelDeliveries: 0 })
    // Die andere Wohnung hat nur ihr Eigenes.
    assert.deepEqual(await s.api<UnitDependents>(`/api/units/${og.id}/dependents`), { tenancies: 1, meters: 0, readings: 0, payments: 1, costItemLinks: 2, directCostItems: 0, fuelDeliveries: 0 })
    assert.equal((await fetch(`${s.base}/api/units/gibt-es-nicht/dependents`)).status, 404)

    // Die Zählung ist kein Versprechen ins Blaue: Nach dem Löschen fehlt genau das Gezählte.
    await s.api(`/api/units/${eg.id}`, { method: 'DELETE' })
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1)
    assert.deepEqual((await s.api<Meter[]>('/api/meters')).map((m) => m.name), ['Haupt'])
    assert.equal((await s.api<Reading[]>('/api/readings')).length, 0)
    assert.equal((await s.api<Payment[]>('/api/payments')).length, 1)
    const direkt = (await s.api<CostItem[]>('/api/costItems')).find((i) => i.description === 'Direkt')
    assert.equal(direkt?.directUnitId ?? null, null, 'die direkt zugeordnete Rechnung bleibt, ohne Wohnung')
  } finally {
    s.stop()
  }
})

// ---------- Objekte (#92) ----------

test('Objekt: ein frischer Server hat genau ein Objekt, und ohne Angabe gilt es', async () => {
  const s = await startServer()
  try {
    const objekte = await s.api<Property[]>('/api/properties')
    assert.deepEqual(objekte.map((p) => p.id), ['objekt-1'])
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    assert.equal(unit.propertyId, 'objekt-1')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  } finally {
    s.stop()
  }
})

test('Objekt: mit zwei Objekten verlangen die Datenrouten die Angabe, und sie grenzt ein', async () => {
  await withProperties(async (s, b) => {
    const ohne = await fetch(`${s.base}/api/units`)
    assert.equal(ohne.status, 400)
    assert.match((await jsonOf<{ error: string }>(ohne)).error, /Objekt/)
    const ohneRumpf = await fetch(`${s.base}/api/units`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) })
    assert.equal(ohneRumpf.status, 400)
    assert.equal((await fetch(`${s.base}/api/settlement/2025`)).status, 400)
    assert.equal((await fetch(`${s.base}/api/units?property=gibt-es-nicht`)).status, 404)

    const a = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ propertyId: 'objekt-1', name: 'A-EG', areaM2: 50, participates: true }) })
    const bw = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 70, participates: true }) })
    assert.equal(bw.propertyId, b.id, 'die Angabe in der Adresse gilt auch beim Anlegen')
    assert.deepEqual((await s.api<Unit[]>(`/api/units?property=${b.id}`)).map((u) => u.id), [bw.id])
    assert.deepEqual((await s.api<Unit[]>('/api/units?property=objekt-1')).map((u) => u.id), [a.id])
  })
})

test('Objekt: zwei Objekte rechnen und schließen getrennt ab, auch im selben Jahr', async () => {
  await withProperties(async (s, b) => {
    await s.api('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    await s.api(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    await s.api('/api/costItems?property=objekt-1', {
      method: 'POST',
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'Nur A', amountCents: 50000, key: 'area' }),
    })
    const inB = await s.api<{ totalCostsCents: number }>(`/api/settlement/2025?property=${b.id}`)
    assert.equal(inB.totalCostsCents, 0, 'die Rechnung von A taucht in B nicht auf')
    const inA = await s.api<{ totalCostsCents: number }>('/api/settlement/2025?property=objekt-1')
    assert.equal(inA.totalCostsCents, 50000)

    await s.api('/api/settlement/2025/close?property=objekt-1', { method: 'POST', body: JSON.stringify({}) })
    assert.equal((await fetch(`${s.base}/api/settlement/2025/close?property=${b.id}`, { method: 'DELETE' })).status, 404)
    const nochZu = await s.api<{ closed: unknown }>('/api/settlement/2025?property=objekt-1')
    assert.notEqual(nochZu.closed, null, 'die Abrechnung von A ist noch abgeschlossen')
    await s.api(`/api/settlement/2025/close?property=${b.id}`, { method: 'POST', body: JSON.stringify({}) })
    for (const route of ['consumption', 'rentledger', 'taxreport']) {
      assert.equal((await fetch(`${s.base}/api/${route}/2025?property=${b.id}`)).status, 200, route)
    }
  })
})

test('Objekt: gelöscht wird nur ein leeres, und nie das letzte', async () => {
  await withProperties(async (s, b) => {
    await s.api(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    const belegt = await fetch(`${s.base}/api/properties/${b.id}`, { method: 'DELETE' })
    assert.equal(belegt.status, 409)
    assert.match((await jsonOf<{ error: string }>(belegt)).error, /1 Wohnung/)
    const [w] = await s.api<Unit[]>(`/api/units?property=${b.id}`)
    await s.api(`/api/units/${w?.id}`, { method: 'DELETE' })
    await s.api(`/api/properties/${b.id}`, { method: 'DELETE' })
    const letztes = await fetch(`${s.base}/api/properties/objekt-1`, { method: 'DELETE' })
    assert.equal(letztes.status, 409)
    assert.equal((await fetch(`${s.base}/api/properties/gibt-es-nicht`, { method: 'DELETE' })).status, 404)
  })
})

test('Objekt: ändern, und ein Verweis über die Objektgrenze wird mit 400 abgelehnt', async () => {
  await withProperties(async (s, b) => {
    const geaendert = await s.api<Property>(`/api/properties/${b.id}`, { method: 'PUT', body: JSON.stringify({ iban: 'DE02120300000000202051', address: 'Weg 3' }) })
    assert.equal(geaendert.iban, 'DE02120300000000202051')
    assert.equal(geaendert.name, 'Gartenweg 3')
    const a = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    const res = await fetch(`${s.base}/api/meters?property=${b.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', unitId: a.id, type: 'kaltwasser', unit: 'm³' }),
    })
    assert.equal(res.status, 400)
    assert.match((await jsonOf<{ error: string }>(res)).error, /Gartenweg 3/)
  })
})

test('Objekt: Teilnehmer und Einzelbeträge halten die Objektgrenze auch beim Umziehen (#94)', async () => {
  // Beides wurde mit #94 ergänzt, der Wächter kannte es nicht: Eine Wohnung mit Teilnahme oder
  // ein Mietverhältnis mit Einzelbetrag konnte über die API in ein anderes Objekt wechseln. Die
  // Position verlor still ihren Teilnehmer, und das nächste Backup ließ sich nicht einspielen.
  await withProperties(async (s, b) => {
    const a1 = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    const a2 = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-OG', areaM2: 50, participates: true }) })
    const b1 = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    const t = await s.api<Tenancy>('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: a2.id, tenantName: 'Meier', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area', participantUnitIds: [a1.id],
    }) })
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Heizung', description: 'Heizung', amountCents: 10000, key: 'amounts', tenancyAmounts: { [t.id]: 5000 },
    }) })
    const umzug = await fetch(`${s.base}/api/units/${a1.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: b.id }),
    })
    assert.equal(umzug.status, 400, 'die Wohnung ist Teilnehmerin einer Position im alten Objekt')
    assert.match((await jsonOf<{ error: string }>(umzug)).error, /Teilnahme/)
    const wechsel = await fetch(`${s.base}/api/tenancies/${t.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: b1.id }),
    })
    assert.equal(wechsel.status, 400, 'das Mietverhältnis hat einen Einzelbetrag im alten Objekt')
    assert.match((await jsonOf<{ error: string }>(wechsel)).error, /Einzelbetr/)
  })
})

test('Eigenbeträge (#104): gespeichert, gelesen, gerechnet, und nur im eigenen Objekt', async () => {
  await withProperties(async (s, b) => {
    const eigen = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'Haupt', areaM2: 100, participates: false, selfUsed: true }) })
    const el = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'Einlieger', areaM2: 50, participates: true }) })
    const fremd = await s.api<Unit>(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B', areaM2: 50, participates: false, selfUsed: true }) })
    const t = await s.api<Tenancy>('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: el.id, tenantName: 'Meier', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    const k = await s.api<{ id: string, selfAmounts?: Record<string, number> }>('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({
      year: 2025, category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 300000, key: 'amounts',
      tenancyAmounts: { [t.id]: 124000 }, selfAmounts: { [eigen.id]: 160000 },
    }) })
    assert.deepEqual(k.selfAmounts, { [eigen.id]: 160000 })
    const abrechnung = await s.api<{ selfUsedShareCents: number }>('/api/settlement/2025?property=objekt-1')
    assert.equal(abrechnung.selfUsedShareCents, 160000)
    const quer = await fetch(`${s.base}/api/costItems/${k.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selfAmounts: { [fremd.id]: 100 } }),
    })
    assert.equal(quer.status, 400, 'ein Eigenbetrag für eine Wohnung eines anderen Objekts')
  })
})

test('Einheit ohne Anschluss (#117): gespeichert, gelesen, unbekannte Typen fallen weg, Löschen räumt ab', async () => {
  const s = await startServer()
  try {
    const g = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Garage', areaM2: 15, participates: true, noConnection: ['kaltwasser', 'kaltwasser', 'erfunden'] }) })
    assert.deepEqual(g.noConnection, ['kaltwasser'])
    const g2 = await s.api<Unit>(`/api/units/${g.id}`, { method: 'PUT', body: JSON.stringify({ noConnection: ['kaltwasser', 'strom'] }) })
    assert.deepEqual(g2.noConnection, ['kaltwasser', 'strom'])
    const g3 = await s.api<Unit>(`/api/units/${g.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Garage 1' }) })
    assert.deepEqual(g3.noConnection, ['kaltwasser', 'strom'], 'ein Teilrumpf lässt die Angabe stehen')
    await s.api(`/api/units/${g.id}`, { method: 'DELETE' })
  } finally {
    s.stop()
  }
})

test('Kabelanlage ab dem 01.12.2021 (#121): am Objekt gespeichert, und die Abrechnung 2023 warnt', async () => {
  const s = await startServer()
  try {
    const [objekt] = await s.api<Property[]>('/api/properties')
    const p = await s.api<Property>(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ cableBuiltBeforeDec2021: false }) })
    assert.equal(p.cableBuiltBeforeDec2021, false)
    const u = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: u.id, tenantName: 'M', persons: 1, personHistory: [], start: '2023-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2023, category: 'Kabel/Antenne', description: 'Kabel', amountCents: 12000, key: 'units' }) })
    const abrechnung = await s.api<Settlement>('/api/settlement/2023')
    assert.deepEqual(abrechnung.notices?.map((n) => n.code), ['tv-signal.new-system'])
    const zurueck = await s.api<Property>(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ cableBuiltBeforeDec2021: null }) })
    assert.equal(zurueck.cableBuiltBeforeDec2021, null, 'unbekannt ist ein ausdrücklicher Wert')
  } finally {
    s.stop()
  }
})

test('Objekt: die Einstellungen führen Hausname und Adresse nicht mehr, auch wenn ein alter Tab sie schickt', async () => {
  const s = await startServer()
  try {
    const nachher = await s.api<Record<string, unknown>>('/api/settings', { method: 'PUT', body: JSON.stringify({ houseName: 'Alter Tab', address: 'Weg 1', landlordName: 'Erika' }) })
    assert.equal('houseName' in nachher, false)
    assert.equal('address' in nachher, false)
    assert.equal(nachher.landlordName, 'Erika')
    const [objekt] = await s.api<Property[]>('/api/properties')
    assert.equal(objekt?.name, '', 'der Name des Objekts kommt aus dem Objekt, nicht aus einem alten Tab')
  } finally {
    s.stop()
  }
})

test('Objekt: ein Backup von v0.8.0 kommt als Objekt 1 zurück, mit denselben Zahlen', async () => {
  const s = await startServer()
  try {
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', await databaseOfV080(2025))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const objekte = await s.api<Property[]>('/api/properties')
    assert.deepEqual(objekte.map((p) => [p.id, p.name, p.address]), [['objekt-1', 'Lindenstraße 7', '12345 Stadt']])
    const abrechnung = await s.api<{ totalCostsCents: number, landlord: { totalCents: number } }>('/api/settlement/2025')
    assert.equal(abrechnung.totalCostsCents, 100000)
  } finally {
    s.stop()
  }
})

test('Objekt: ein Backup mit einem Verweis über die Objektgrenze wird abgelehnt, bevor etwas ersetzt ist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kreuz-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const connection = await connect(file)
    applyMigrations(connection, await loadMigrations())
    connection.exec(`INSERT INTO properties (id, name, kind, address) VALUES ('objekt-2', 'Zwei', 'mfh', '')`)
    connection.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 50, 1)`)
    connection.exec(`INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m1', 'objekt-2', 'X', 'u1', 'kaltwasser', 'm³')`)
    connection.close()
    const vorher = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'bleibt', areaM2: 1, participates: true }) })
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(String(r.body.error), /Zähler/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [vorher.id], 'die bisherigen Daten sind unverändert')
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Mieterwechsel in einem Schritt (#150) ----------
//
// Der Assistent schickte drei Anfragen nacheinander: altes Mietverhältnis beenden,
// Zwischenablesungen anlegen, neues Mietverhältnis anlegen. Lehnte der Server den dritten Schritt
// ab, waren die ersten beiden schon gespeichert, und ein zweiter Versuch legte die Ablesungen
// doppelt an. Jetzt gibt es eine Route, die alles in einer Transaktion schreibt.

type TenantChangeAnswer = { ended: Tenancy, newTenancy: Tenancy | null, readings: Reading[] }

// Ein Objekt mit einer Wohnung, einem offenen Mietverhältnis, einem Wohnungs- und einem
// Hauptzähler.
async function changeStock(s: Server, propertyId = 'objekt-1') {
  const unit = await s.api<Unit>(`/api/units?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
  const tenancy = await s.api<Tenancy>(`/api/tenancies?property=${propertyId}`, { method: 'POST', body: JSON.stringify({
    unitId: unit.id, tenantName: 'Alt', persons: 2, personHistory: [{ from: '2024-01-01', persons: 2 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 12000 }], prepaymentOverrides: {}, baseRents: [],
  }) })
  const wasser = await s.api<Meter>(`/api/meters?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'KW EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³' }) })
  const haupt = await s.api<Meter>(`/api/meters?property=${propertyId}`, { method: 'POST', body: JSON.stringify({ name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' }) })
  return { unit, tenancy, wasser, haupt }
}

const newTenancyBody = (prepaymentCents: number) => ({
  tenantName: 'Neu', persons: 3, personHistory: [{ from: '2025-07-01', persons: 3 }], start: '2025-07-01',
  baseRents: [{ from: '2025-07', monthlyCents: 80000 }], prepayments: [{ from: '2025-07', monthlyCents: prepaymentCents }],
  prepaymentOverrides: {}, costModel: 'flatRate',
})

const postChange = (s: Server, tenancyId: string, body: unknown, propertyId = 'objekt-1') =>
  fetch(`${s.base}/api/tenancies/${tenancyId}/change?property=${propertyId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

test('Mieterwechsel (#150): beendet, liest ab und legt den Nachmieter an, alles in einem Schritt', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy, wasser, haupt } = await changeStock(s)
    const res = await postChange(s, tenancy.id, {
      end: '2025-06-30', readings: [{ meterId: wasser.id, value: 123.5 }, { meterId: haupt.id, value: 980 }], newTenancy: newTenancyBody(15000),
    })
    assert.equal(res.status, 200, await res.clone().text())
    const answer = await jsonOf<TenantChangeAnswer>(res)
    assert.equal(answer.ended.end, '2025-06-30')
    assert.equal(answer.newTenancy?.unitId, unit.id)
    assert.equal(answer.newTenancy?.end, null)
    assert.equal(answer.newTenancy?.costModel, 'flatRate')
    assert.deepEqual(answer.newTenancy?.prepayments, [{ from: '2025-07', monthlyCents: 15000 }])
    assert.equal(answer.readings.length, 2)

    const tenancies = await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')
    assert.equal(tenancies.find((t) => t.id === tenancy.id)?.end, '2025-06-30')
    assert.deepEqual(tenancies.map((t) => t.tenantName), ['Alt', 'Neu'])
    const readings = await s.api<Reading[]>('/api/readings?property=objekt-1')
    assert.deepEqual(readings.map((r) => [r.meterId, r.date, r.value]).sort(), [[haupt.id, '2025-06-30', 980], [wasser.id, '2025-06-30', 123.5]].sort())
    assert.ok(readings.every((r) => /Mieterwechsel Alt/.test(r.note ?? '')), 'die Ablesung trägt keinen Vermerk')

    // Leerstand: ohne neues Mietverhältnis
    const leer = await postChange(s, answer.newTenancy?.id ?? assert.fail('kein Nachmieter'), { end: '2026-03-31', readings: [], newTenancy: null })
    assert.equal(leer.status, 200)
    assert.equal((await jsonOf<TenantChangeAnswer>(leer)).newTenancy, null)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): scheitert der dritte Schritt, ist nichts gespeichert, und ein zweiter Versuch legt nichts doppelt an', async () => {
  const s = await startServer()
  try {
    const { tenancy, wasser, haupt } = await changeStock(s)
    const readings = [{ meterId: wasser.id, value: 123.5 }, { meterId: haupt.id, value: 980 }]
    const res = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(-100) })
    assert.equal(res.status, 400)
    const fehler = await errorFrom(res)
    assert.doesNotMatch(fehler, /Failed query|insert into|params:/, 'SQL in der Meldung')
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id)?.end, null, 'das alte Mietverhältnis wurde trotzdem beendet')
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [], 'Zwischenablesungen blieben stehen')
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 1)

    // Der zweite Versuch mit richtiger Vorauszahlung: jede Ablesung genau einmal.
    const zweiter = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(15000) })
    assert.equal(zweiter.status, 200, await zweiter.clone().text())
    assert.equal((await s.api<Reading[]>('/api/readings?property=objekt-1')).length, 2)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 2)

    // Ein doppelt abgeschickter Wechsel trifft ein schon beendetes Mietverhältnis und legt nichts an.
    const dritter = await postChange(s, tenancy.id, { end: '2025-06-30', readings, newTenancy: newTenancyBody(15000) })
    assert.equal(dritter.status, 409)
    assert.match(await errorFrom(dritter), /bereits zum 30\.06\.2025 beendet/, "das Datum steht deutsch da")
    assert.equal((await s.api<Reading[]>('/api/readings?property=objekt-1')).length, 2)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).length, 2)
  } finally {
    s.stop()
  }
})

// #204: Der Mieterwechsel setzt die Daten lückenlos und erzeugt nie eine Überschneidung. Ein von
// Hand angelegtes Mietverhältnis, das sich überschneidet, nimmt der Server an (die Oberfläche fragt
// nach), und die Abrechnung meldet es als Fehler.
test('Überschneidung (#204): Mieterwechsel lückenlos; ein überschneidendes Mietverhältnis wird angenommen und in der Abrechnung gemeldet', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy, wasser, haupt } = await changeStock(s)
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 120000, key: 'area' }) })
    const res = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 1 }, { meterId: haupt.id, value: 2 }], newTenancy: { ...newTenancyBody(15000), costModel: null } })
    assert.equal(res.status, 200, await res.clone().text())
    assert.deepEqual(tenancyOverlaps(await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')), [])
    const vorher = await s.api<Settlement>('/api/settlement/2025?property=objekt-1')
    assert.equal(vorher.notices?.some((n) => n.code === 'tenancy.overlap'), false)

    const anlegen = await fetch(`${s.base}/api/tenancies?property=objekt-1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      unitId: unit.id, tenantName: 'Doppelt', persons: 1, personHistory: [{ from: '2025-06-01', persons: 1 }], start: '2025-06-01', end: '2025-08-31',
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    assert.ok(anlegen.ok, `abgelehnt: ${anlegen.status} ${await anlegen.clone().text()}`)
    const s2025 = await s.api<Settlement>('/api/settlement/2025?property=objekt-1')
    const found = (s2025.notices ?? []).filter((n) => n.code === 'tenancy.overlap')
    // Alt (bis 30.06.) mit Doppelt (01.06. bis 31.08.), Doppelt mit Neu (ab 01.07.)
    assert.equal(found.length, 2)
    assert.ok(found.every((n) => n.level === 'error' && n.subject?.kind === 'tenancy'))
    assert.match(found[0]?.text ?? '', /Alt.*Doppelt.*vom 01\.06\.2025 bis 30\.06\.2025 \(30 Tage\)/)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): unsinnige Angaben werden mit einem Satz abgelehnt, ohne etwas zu speichern', async () => {
  const s = await startServer()
  try {
    const { tenancy, wasser } = await changeStock(s)
    const faelle: Array<[string, unknown]> = [
      ['Auszug vor Einzug', { end: '2023-12-31', readings: [], newTenancy: null }],
      ['kein Datum', { end: 'gestern', readings: [], newTenancy: null }],
      ['Nachmieter vor dem Auszug', { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(15000), start: '2025-06-30' } }],
      ['Stand keine Zahl', { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 'viel' }], newTenancy: null }],
      ['unbekannter Zähler', { end: '2025-06-30', readings: [{ meterId: 'gibt-es-nicht', value: 1 }], newTenancy: null }],
      ['derselbe Zähler zweimal', { end: '2025-06-30', readings: [{ meterId: wasser.id, value: 1 }, { meterId: wasser.id, value: 2 }], newTenancy: null }],
    ]
    for (const [fall, body] of faelle) {
      const res = await postChange(s, tenancy.id, body)
      assert.equal(res.status, 400, fall)
      assert.ok((await errorFrom(res)).length > 10, fall)
    }
    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id)?.end, null)
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [])
    assert.equal((await postChange(s, 'gibt-es-nicht', { end: '2025-06-30', readings: [], newTenancy: null })).status, 404)
  } finally {
    s.stop()
  }
})

test('Mieterwechsel (#150): über die Grenze eines Objekts wird mit 400 abgelehnt und nichts gespeichert', async () => {
  await withProperties(async (s, b) => {
    const a = await changeStock(s, 'objekt-1')
    const fremd = await changeStock(s, b.id)
    // Das Mietverhältnis gehört zu Objekt A, die Anfrage nennt B.
    const falschesObjekt = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [], newTenancy: null }, b.id)
    assert.equal(falschesObjekt.status, 400)
    // Ein Zähler aus Objekt B.
    const fremderZaehler = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [{ meterId: fremd.wasser.id, value: 1 }], newTenancy: null })
    assert.equal(fremderZaehler.status, 400)
    assert.match(await errorFrom(fremderZaehler), /Zähler/)
    // Der Nachmieter soll in eine Wohnung aus Objekt B.
    const fremdeWohnung = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(15000), unitId: fremd.unit.id } })
    assert.equal(fremdeWohnung.status, 400)

    assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === a.tenancy.id)?.end, null)
    assert.equal((await s.api<Tenancy[]>(`/api/tenancies?property=${b.id}`)).length, 1)
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [])
    assert.deepEqual(await s.api<Reading[]>(`/api/readings?property=${b.id}`), [])
  })
})

// ---------- IBAN (#279) ----------
// Geprüft wird beim Speichern über die Routen, mit derselben Funktion wie im Formular
// (shared/iban.ts). Abgelehnt wird nur eine IBAN, die neu gesetzt oder geändert wird; eine
// gespeicherte ungültige, die eine Seite unverändert mitschickt, hindert das Speichern einer
// anderen Angabe nicht. Backup, Wiederherstellen und Umstieg prüfen bewusst nicht.

const IBAN_OK = 'DE89370400440532013000'
const IBAN_OK_2 = 'DE02120300000000202051'
const IBAN_FALSCH = 'DE00370400440532013000'

const sendJson = (s: Server, url: string, body: unknown, method = 'PUT') =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('IBAN (#279): eine neue ungültige IBAN lehnt jede Route mit 400 ab, eine gültige wird normiert', async () => {
  const s = await startServer()
  try {
    // Einstellungen
    const abgelehnt = await sendJson(s, '/api/settings', { landlordName: 'Erika', iban: IBAN_FALSCH })
    assert.equal(abgelehnt.status, 400)
    assert.match(await errorFrom(abgelehnt), /IBAN des Vermieters ist nicht gültig\. Die Prüfziffer stimmt nicht/)
    assert.equal((await s.api<ClientSettings>('/api/settings')).landlordName, '', 'nichts gespeichert, auch nicht der Name')
    const laenge = await sendJson(s, '/api/settings', { iban: 'DE8937040044' })
    assert.match(await errorFrom(laenge), /DE hat 22 Zeichen, eingetragen sind 12/)
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ iban: 'de89 3704 0044 0532 0130 00' }) })
    assert.equal((await s.api<ClientSettings>('/api/settings')).iban, IBAN_OK, 'normiert gespeichert')
    // Leeren ist immer erlaubt, auch mit null
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ iban: null }) })
    assert.equal((await s.api<ClientSettings>('/api/settings')).iban, '')

    // Mietverhältnis: anlegen, ändern, Nachmieter beim Wechsel
    const { tenancy } = await changeStock(s)
    const neu = await sendJson(s, '/api/tenancies?property=objekt-1', { ...newTenancyBody(10000), unitId: tenancy.unitId, iban: IBAN_FALSCH }, 'POST')
    assert.equal(neu.status, 400)
    assert.match(await errorFrom(neu), /IBAN des Mieters ist nicht gültig/)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1, 'kein Mietverhältnis angelegt')
    const geaendert = await sendJson(s, `/api/tenancies/${tenancy.id}`, { iban: IBAN_FALSCH, phone: '0123' })
    assert.equal(geaendert.status, 400)
    const gespeichert = (await s.api<Tenancy[]>('/api/tenancies'))[0]
    assert.equal(gespeichert?.phone, undefined, 'nichts gespeichert')
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ iban: 'gb82 west 1234 5698 7654 32' }) })
    assert.equal((await s.api<Tenancy[]>('/api/tenancies'))[0]?.iban, 'GB82WEST12345698765432')
    const wechsel = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(10000), iban: IBAN_FALSCH } })
    assert.equal(wechsel.status, 400)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies'))[0]?.end, null, 'der Wechsel ist ganz unterblieben')
    const gelungen = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [], newTenancy: { ...newTenancyBody(10000), iban: `${IBAN_OK_2.toLowerCase()} ` } })
    assert.equal(gelungen.status, 200)
    assert.equal((await jsonOf<TenantChangeAnswer>(gelungen)).newTenancy?.iban, IBAN_OK_2)

    // Objekt: ändern und anlegen
    const objekt = await sendJson(s, '/api/properties/objekt-1', { iban: IBAN_FALSCH, address: 'Weg 9' })
    assert.equal(objekt.status, 400)
    assert.match(await errorFrom(objekt), /abweichende IBAN des Objekts ist nicht gültig/)
    assert.equal((await s.api<Property[]>('/api/properties'))[0]?.address, '', 'nichts gespeichert')
    const anlegen = await sendJson(s, '/api/properties', { name: 'Gartenweg 3', iban: 'XX00' }, 'POST')
    assert.equal(anlegen.status, 400)
    assert.match(await errorFrom(anlegen), /„XX“ gehört zu keinem Land/)
    assert.equal((await s.api<Property[]>('/api/properties')).length, 1, 'kein Objekt angelegt')
    const b = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', iban: 'de02 1203 0000 0000 2020 51' }) })
    assert.equal(b.iban, IBAN_OK_2)
    // Leeren bleibt erlaubt, und die Lesart bleibt: '' heißt bewusst keine, null die Vorgabe
    const leer = await s.api<Property>(`/api/properties/${b.id}?property=${b.id}`, { method: 'PUT', body: JSON.stringify({ iban: '' }) })
    assert.equal(leer.iban, '')
    const vorgabe = await s.api<Property>(`/api/properties/${b.id}?property=${b.id}`, { method: 'PUT', body: JSON.stringify({ iban: null }) })
    assert.equal(vorgabe.iban, null)
  } finally {
    s.stop()
  }
})

test('IBAN (#279): eine gespeicherte ungültige IBAN hindert das Speichern anderer Angaben nicht und bleibt, wie sie ist', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await changeStock(s)
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika' }) })
    // Die ungültigen IBANs kommen über ein Backup herein, das sie nicht prüft; geschrieben werden
    // sie von Hand in die Datenbank des Archivs, wie sie eine Version vor der Prüfung gespeichert hätte.
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
    const datei = path.join(ordner, 'mietfuchs.sqlite')
    fs.writeFileSync(datei, entryData(zip, 'mietfuchs.sqlite'))
    const connection = await connect(datei)
    connection.exec(`UPDATE settings SET iban = 'de00 1111 2222'`)
    connection.exec(`UPDATE properties SET iban = 'DE00 3333', landlord_name = 'Erben'`)
    connection.exec(`UPDATE tenancies SET iban = 'de00-4444'`)
    connection.close()
    zip.updateFile('mietfuchs.sqlite', fs.readFileSync(datei))
    fs.rmSync(ordner, { recursive: true, force: true })
    assert.equal((await restore(s, zip.toBuffer())).status, 200)

    // Einstellungen: unverändert mitgeschickt, auch anders geschrieben, ist kein Grund zur Ablehnung,
    // und umgeschrieben wird sie auch nicht.
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika Muster', iban: 'de00 1111 2222' }) })
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ paymentDeadlineDays: 21, iban: 'DE0011112222' }) })
    const einstellungen = await s.api<ClientSettings>('/api/settings')
    assert.equal(einstellungen.landlordName, 'Erika Muster')
    assert.equal(einstellungen.paymentDeadlineDays, 21)
    assert.equal(einstellungen.iban, 'de00 1111 2222', 'nicht still umgeschrieben')
    // Eine andere ungültige ist eine Änderung und wird abgelehnt
    assert.equal((await sendJson(s, '/api/settings', { iban: 'DE00 1111 2223' })).status, 400)

    // Objekt
    const objekt = await s.api<Property>('/api/properties/objekt-1', { method: 'PUT', body: JSON.stringify({ address: 'Weg 9', iban: 'DE00 3333', landlordName: 'Erben' }) })
    assert.equal(objekt.address, 'Weg 9')
    assert.equal(objekt.iban, 'DE00 3333')
    assert.equal((await sendJson(s, '/api/properties/objekt-1', { iban: 'DE00 3334' })).status, 400)

    // Mietverhältnis: mit und ohne IBAN im Rumpf, und der Mieterwechsel des alten
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ phone: '0123', iban: 'de00-4444' }) })
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'Teilrumpf' }) })
    const [mv] = await s.api<Tenancy[]>('/api/tenancies')
    assert.equal(mv?.phone, '0123')
    assert.equal(mv?.notes, 'Teilrumpf')
    assert.equal(mv?.iban, 'de00-4444')
    assert.equal((await sendJson(s, `/api/tenancies/${tenancy.id}`, { iban: 'DE00-4445' })).status, 400)
    const wechsel = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [], newTenancy: null })
    assert.equal(wechsel.status, 200)
    assert.equal((await jsonOf<TenantChangeAnswer>(wechsel)).ended.iban, 'de00-4444')

    // Leeren ist immer erlaubt
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ iban: null }) })
    assert.equal((await s.api<Tenancy[]>('/api/tenancies'))[0]?.iban, undefined)
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ iban: '' }) })
    assert.equal((await s.api<ClientSettings>('/api/settings')).iban, '')
  } finally {
    s.stop()
  }
})

test('IBAN (#279): Wiederherstellen aus einer db.json übernimmt ungültige IBANs unverändert', async () => {
  const s = await startServer()
  try {
    const stand = {
      settings: { houseName: 'Haus', address: '', landlordName: 'Erika', iban: 'DE00 9999', paymentDeadlineDays: 30 },
      units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }],
      tenancies: [{
        id: 't1', unitId: 'u1', tenantName: 'Alt', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }],
        start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], iban: 'de00 abc',
      }],
      costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
    }
    const r = await restore(s, archive({}, stand))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await s.api<ClientSettings>('/api/settings')).iban, 'DE00 9999')
    assert.equal((await s.api<Tenancy[]>('/api/tenancies'))[0]?.iban, 'de00 abc')
  } finally {
    s.stop()
  }
})

function entryData(zip: AdmZip, name: string): Buffer {
  const entry = zip.getEntry(name)
  if (!entry) return assert.fail(`im Archiv fehlt der Eintrag ${name}`)
  return entry.getData()
}
