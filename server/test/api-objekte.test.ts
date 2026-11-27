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
import type { JournalGroupView } from '../src/db/journal.ts'
import { tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import { newest, revert } from '../testing/revert.ts'
import type {
  CostItem, DepositEntry, FuelDelivery, HeatingPlant, Meter, Payment, Property, Reading, Settlement, TaxReport, Tenancy, Unit, UnitDependents,
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
    assert.deepEqual(deps, { tenancies: 2, meters: 1, readings: 2, payments: 3, costItemLinks: 3, directCostItems: 1, fuelDeliveries: 0, rooms: 0 })
    // Die andere Wohnung hat nur ihr Eigenes.
    assert.deepEqual(await s.api<UnitDependents>(`/api/units/${og.id}/dependents`), { tenancies: 1, meters: 0, readings: 0, payments: 1, costItemLinks: 2, directCostItems: 0, fuelDeliveries: 0, rooms: 0 })
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

test('Objekt: eine Wohnung wechselt über die Route das Objekt, mit Mietverhältnis und Zahlungen, und der Verlauf nennt beide (#180)', async () => {
  await withProperties(async (s, b) => {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const w = await post<Unit>('/api/units?property=objekt-1', { name: 'Falsch angelegt', areaM2: 55, participates: true })
    const t = await post<Tenancy>('/api/tenancies?property=objekt-1', {
      unitId: w.id, tenantName: 'Schulz', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [],
    })
    await post('/api/payments?property=objekt-1', { tenancyId: t.id, date: '2025-01-03', amountCents: 65000 })

    const umzug = await s.api<Unit>(`/api/units/${w.id}?property=objekt-1`, { method: 'PUT', body: JSON.stringify({ propertyId: b.id }) })
    assert.equal(umzug.propertyId, b.id)
    assert.deepEqual((await s.api<Unit[]>('/api/units?property=objekt-1')).map((u) => u.id), [], 'im bisherigen Objekt steht sie nicht mehr')
    assert.deepEqual((await s.api<Unit[]>(`/api/units?property=${b.id}`)).map((u) => u.id), [w.id])
    assert.deepEqual((await s.api<Tenancy[]>(`/api/tenancies?property=${b.id}`)).map((x) => x.id), [t.id], 'das Mietverhältnis wandert mit')
    assert.deepEqual((await s.api<Payment[]>(`/api/payments?property=${b.id}`)).map((p) => p.amountCents), [65000], 'die Zahlung ebenso')
    const abrechnung = await s.api<Settlement>(`/api/settlement/2025?property=${b.id}`)
    assert.deepEqual(abrechnung.statements.map((x) => x.tenantName), ['Schulz'])

    // Der Verlauf: ein Eintrag mit eigenem Satz, sichtbar in beiden Objekten.
    for (const property of ['objekt-1', b.id]) {
      const [eintrag] = await s.api<JournalGroupView[]>(`/api/journal?property=${property}`)
      assert.equal(eintrag?.title, 'Wohnung in ein anderes Objekt verschoben: Falsch angelegt', property)
      assert.deepEqual([...(eintrag?.propertyIds ?? [])].sort(), [b.id, 'objekt-1'].sort())
    }
    // Ein gewöhnliches Ändern behält den bisherigen Satz.
    await s.api(`/api/units/${w.id}?property=${b.id}`, { method: 'PUT', body: JSON.stringify({ areaM2: 56 }) })
    assert.equal((await s.api<JournalGroupView[]>(`/api/journal?property=${b.id}`))[0]?.title, 'Wohnung geändert: Falsch angelegt')
  })
})

test('Objekt: abgelehnter Wechsel nennt den Grund und speichert nichts (#180)', async () => {
  await withProperties(async (s, b) => {
    const w = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 55, participates: true }) })
    await s.api('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: w.id, tenantName: 'Schulz', persons: 1, personHistory: [], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }) })
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2024, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area' }) })
    await s.api('/api/settlement/2024/close?property=objekt-1', { method: 'POST', body: JSON.stringify({}) })
    const res = await fetch(`${s.base}/api/units/${w.id}?property=objekt-1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: b.id }),
    })
    assert.equal(res.status, 400)
    assert.match(await errorFrom(res), /abgeschlossenen Abrechnung 2024 des bisherigen Objekts/)
    assert.deepEqual((await s.api<Unit[]>('/api/units?property=objekt-1')).map((u) => u.id), [w.id])
  })
})

// ---------- Ändern und Löschen prüfen das genannte Objekt (#692) ----------
// Ein Tab, der nach einem Objektwechsel noch die Liste des alten Objekts zeigt, nennt beim Speichern das neue. Der
// Server lehnt dann ab, statt im falschen Haus zu ändern oder zu löschen. Ohne Angabe gilt wie bisher die Kennung allein.

test('Objekt: Ändern und Löschen lehnen ab, wenn der Datensatz nicht zum genannten Objekt gehört, und ändern nichts (#692)', async () => {
  await withProperties(async (s, b) => {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const a = 'objekt-1'
    const unit = await post<Unit>(`/api/units?property=${a}`, { name: 'A-EG', areaM2: 50, participates: true })
    const tenancy = await post<Tenancy>(`/api/tenancies?property=${a}`, {
      unitId: unit.id, tenantName: 'Schulz', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })
    const payment = await post<Payment>(`/api/payments?property=${a}`, { tenancyId: tenancy.id, date: '2025-01-03', amountCents: 65000 })
    const item = await post<CostItem>(`/api/costItems?property=${a}`, { year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area' })
    // Ein Hauptzähler hat keine Wohnung, sein Objekt trägt er selbst.
    const meter = await post<Meter>(`/api/meters?property=${a}`, { name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' })
    const reading = await post<Reading>(`/api/readings?property=${a}`, { meterId: meter.id, date: '2025-01-01', value: 10 })

    const records: [string, string, Record<string, unknown>, RegExp][] = [
      ['units', unit.id, { areaM2: 51 }, /Diese Wohnung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['tenancies', tenancy.id, { persons: 2 }, /Dieses Mietverhältnis gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['payments', payment.id, { amountCents: 1 }, /Diese Zahlung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['costItems', item.id, { amountCents: 1 }, /Diese Kostenposition gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['meters', meter.id, { name: 'Anders' }, /Dieser Zähler gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['readings', reading.id, { value: 11 }, /Diese Ablesung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
    ]
    const stock = async () => Object.fromEntries(await Promise.all(records.map(async ([coll]) => [coll, await s.api<unknown[]>(`/api/${coll}?property=${a}`)] as const)))
    const before = await stock()
    const stepsBefore = await journalSteps(s)

    for (const [coll, id, body, satz] of records) {
      const put = await sendJson(s, `/api/${coll}/${id}?property=${b.id}`, body)
      assert.equal(put.status, 409, `PUT ${coll}`)
      const meldung = await errorFrom(put)
      assert.match(meldung, satz)
      assert.match(meldung, /Geändert wurde nichts\. Wechseln Sie zu „[^“]+“ oder laden Sie die Seite neu\./)
      const del = await fetch(`${s.base}/api/${coll}/${id}?property=${b.id}`, { method: 'DELETE' })
      assert.equal(del.status, 409, `DELETE ${coll}`)
      assert.match(await errorFrom(del), satz)
      // Ein Objekt, das es nicht gibt, ist wie bei jeder Route eine 404.
      assert.equal((await sendJson(s, `/api/${coll}/${id}?property=gibt-es-nicht`, body)).status, 404, `PUT ${coll}, unbekanntes Objekt`)
      assert.equal((await fetch(`${s.base}/api/${coll}/${id}?property=gibt-es-nicht`, { method: 'DELETE' })).status, 404, `DELETE ${coll}, unbekanntes Objekt`)
    }
    // Der ganze Satz: das Objekt des Datensatzes, das gewählte und der Ausweg. Das Objekt des frischen Bestands hat keinen
    // Namen und heißt wie im Umschalter.
    const objektA = (await s.api<Property[]>('/api/properties')).find((p) => p.id === a)?.name || 'Ohne Namen'
    assert.equal(await errorFrom(await sendJson(s, `/api/units/${unit.id}?property=${b.id}`, { areaM2: 51 })),
      `Diese Wohnung gehört zu „${objektA}“, gewählt ist „Gartenweg 3“. Geändert wurde nichts. Wechseln Sie zu „${objektA}“ oder laden Sie die Seite neu.`)
    // Auch das Aufteilen einer Position über zwei Zeiträume schreibt an ihr.
    const split = await sendJson(s, `/api/costItems/${item.id}/split?property=${b.id}`, {})
    assert.equal(split.status, 409)
    assert.match(await errorFrom(split), /Diese Kostenposition gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/)
    assert.deepEqual(await stock(), before, 'nichts geändert, nichts gelöscht')
    assert.deepEqual(await journalSteps(s), stepsBefore, 'kein Schritt im Verlauf')

    // Einen Datensatz, den es nicht mehr gibt, meldet die Route wie bisher, mit und ohne Objekt.
    assert.equal((await sendJson(s, `/api/units/gibt-es-nicht?property=${b.id}`, { areaM2: 1 })).status, 404)
    assert.equal((await fetch(`${s.base}/api/units/gibt-es-nicht?property=${b.id}`, { method: 'DELETE' })).status, 404)
  })
})

test('Objekt: Ändern und Löschen mit dem richtigen Objekt und ohne Angabe gehen durch wie bisher (#692)', async () => {
  await withProperties(async (s, b) => {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const put = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'PUT', body: JSON.stringify(body) })
    const unit = await post<Unit>(`/api/units?property=${b.id}`, { name: 'B-EG', areaM2: 50, participates: true })
    const tenancy = await post<Tenancy>(`/api/tenancies?property=${b.id}`, {
      unitId: unit.id, tenantName: 'Schulz', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })
    const payment = await post<Payment>(`/api/payments?property=${b.id}`, { tenancyId: tenancy.id, date: '2025-01-03', amountCents: 65000 })
    const meter = await post<Meter>(`/api/meters?property=${b.id}`, { name: 'KW', unitId: unit.id, type: 'kaltwasser', unit: 'm³' })
    const reading = await post<Reading>(`/api/readings?property=${b.id}`, { meterId: meter.id, date: '2025-01-01', value: 10 })
    const item = await post<CostItem>(`/api/costItems?property=${b.id}`, { year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area' })

    // Mit dem Objekt des Datensatzes.
    assert.equal((await put<Unit>(`/api/units/${unit.id}?property=${b.id}`, { areaM2: 51 })).areaM2, 51)
    assert.equal((await put<Tenancy>(`/api/tenancies/${tenancy.id}?property=${b.id}`, { persons: 2 })).persons, 2)
    assert.equal((await put<Payment>(`/api/payments/${payment.id}?property=${b.id}`, { amountCents: 65001 })).amountCents, 65001)
    assert.equal((await put<Meter>(`/api/meters/${meter.id}?property=${b.id}`, { name: 'Kaltwasser' })).name, 'Kaltwasser')
    assert.equal((await put<Reading>(`/api/readings/${reading.id}?property=${b.id}`, { value: 11 })).value, 11)
    assert.equal((await put<CostItem>(`/api/costItems/${item.id}?property=${b.id}`, { amountCents: 10001 })).amountCents, 10001)
    // Ohne Angabe, auch bei mehreren Objekten: Die Kennung allein genügt wie bisher (Skripte, Tabs von vor dem Update,
    // und Seiten über alle Objekte wie der Ordner der Belege).
    assert.equal((await put<Unit>(`/api/units/${unit.id}`, { areaM2: 52 })).areaM2, 52)
    assert.equal((await put<Payment>(`/api/payments/${payment.id}`, { amountCents: 65002 })).amountCents, 65002)
    assert.equal((await put<CostItem>(`/api/costItems/${item.id}`, { amountCents: 10002 })).amountCents, 10002)
    await s.api(`/api/readings/${reading.id}`, { method: 'DELETE' })
    await s.api(`/api/payments/${payment.id}?property=${b.id}`, { method: 'DELETE' })
    await s.api(`/api/costItems/${item.id}?property=${b.id}`, { method: 'DELETE' })

    // Wohnung verschieben (#180): Die Adresse nennt das bisherige Objekt, der Rumpf das neue. Ein Zähler hielte sie
    // im bisherigen Objekt fest (`guardUnit`), deshalb vorher weg.
    await s.api(`/api/meters/${meter.id}?property=${b.id}`, { method: 'DELETE' })
    assert.equal((await put<Unit>(`/api/units/${unit.id}?property=${b.id}`, { propertyId: 'objekt-1' })).propertyId, 'objekt-1')
    // Das Mietverhältnis ist mitgewandert: Unter dem neuen Objekt geht es, unter dem alten nicht mehr.
    assert.equal((await put<Tenancy>(`/api/tenancies/${tenancy.id}?property=objekt-1`, { persons: 3 })).persons, 3)
    assert.equal((await sendJson(s, `/api/tenancies/${tenancy.id}?property=${b.id}`, { persons: 4 })).status, 409)
    await s.api(`/api/units/${unit.id}?property=objekt-1`, { method: 'DELETE' })
  })
})

// Die übrigen Routen an einem Datensatz eines Objekts (#692): Heizanlage und alles unter ihr, Lieferung, CO₂-Erstattung,
// Kautionsbuchung und die Unterrouten von Mietverhältnis und Wohnung. Die Mieterhöhung steht in
// api-mieterhoehung-schreiben.test.ts.
test('Objekt: auch Heizanlage, Lieferung, Erstattung, Kaution, Mieterwechsel und Zwischenablesung lehnen ein anderes Objekt ab (#692)', async () => {
  await withProperties(async (s, b) => {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const a = 'objekt-1'
    const unit = await post<Unit>(`/api/units?property=${a}`, { name: 'A-EG', areaM2: 50, participates: true })
    const tenancy = await post<Tenancy>(`/api/tenancies?property=${a}`, {
      unitId: unit.id, tenantName: 'Schulz', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })
    const payment = await post<Payment>(`/api/payments?property=${a}`, { tenancyId: tenancy.id, date: '2025-01-03', amountCents: 65000 })
    const deposit = await post<DepositEntry>(`/api/deposit-entries?property=${a}`, { tenancyId: tenancy.id, date: '2025-01-02', kind: 'received', amountCents: 100000 })
    const { plant } = await post<{ plant: HeatingPlant }>(`/api/heating-plants?property=${a}`, { energy: 'gas', method: 'manual' })
    const delivery = await post<FuelDelivery>(`/api/heating-plants/${plant.id}/deliveries?property=${a}`, { label: 'Gas', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', emissionsKg: 100 })
    await s.api(`/api/tenancies/${tenancy.id}?property=${a}`, { method: 'PUT', body: JSON.stringify({ heatingModel: 'selfSupply' }) })
    const refund = await post<{ id: string }>(`/api/co2-refunds?property=${a}`, { tenancyId: tenancy.id, supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: '2025-01' })

    const lists = async () => ({
      plants: await s.api<unknown[]>(`/api/heating-plants?property=${a}`),
      deliveries: await s.api<unknown[]>(`/api/heating-plants/${plant.id}/deliveries`),
      refunds: await s.api<unknown[]>(`/api/co2-refunds?property=${a}`),
      deposits: await s.api<unknown[]>(`/api/deposit-entries?property=${a}`),
      tenancies: await s.api<unknown[]>(`/api/tenancies?property=${a}`),
      payments: await s.api<unknown[]>(`/api/payments?property=${a}`),
    })
    const before = await lists()
    const stepsBefore = await journalSteps(s)

    const other = `property=${b.id}`
    const calls: [string, string, unknown, RegExp][] = [
      ['PUT', `/api/heating-plants/${plant.id}?${other}`, { name: 'Anders' }, /Diese Heizanlage gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['DELETE', `/api/heating-plants/${plant.id}?${other}`, undefined, /Diese Heizanlage/],
      ['PUT', `/api/heating-plants/${plant.id}/periods/2025-01/co2?${other}`, {}, /Diese Heizanlage/],
      ['POST', `/api/heating-plants/${plant.id}/deliveries?${other}`, { label: 'Öl', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }, /Diese Heizanlage/],
      ['POST', `/api/heating-plants/${plant.id}/replace?${other}`, { date: '2025-06-01' }, /Diese Heizanlage/],
      ['POST', `/api/heating-settlement/${plant.id}/2025-01/close?${other}`, {}, /Diese Heizanlage/],
      ['PUT', `/api/fuel-deliveries/${delivery.id}?${other}`, { fixedCents: 1 }, /Diese Lieferung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['DELETE', `/api/fuel-deliveries/${delivery.id}?${other}`, undefined, /Diese Lieferung/],
      ['PUT', `/api/co2-refunds/${refund.id}?${other}`, { amountCents: 1 }, /Diese Erstattung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['DELETE', `/api/co2-refunds/${refund.id}?${other}`, undefined, /Diese Erstattung/],
      ['PUT', `/api/deposit-entries/${deposit.id}?${other}`, { amountCents: 1 }, /Diese Kautionsbuchung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['DELETE', `/api/deposit-entries/${deposit.id}?${other}`, undefined, /Diese Kautionsbuchung/],
      ['POST', `/api/deposit-entries/from-payment/${payment.id}?${other}`, undefined, /Diese Zahlung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['POST', `/api/tenancies/${tenancy.id}/change?${other}`, { end: '2025-06-30' }, /Dieses Mietverhältnis gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      ['PUT', `/api/units/${unit.id}/interim-gaps/2025-06-30?${other}`, { status: 'missed', reason: '' }, /Diese Wohnung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
    ]
    for (const [method, url, body, satz] of calls) {
      const res = await fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      assert.equal(res.status, 409, `${method} ${url}`)
      const meldung = await errorFrom(res)
      assert.match(meldung, satz, `${method} ${url}`)
      assert.match(meldung, /Geändert wurde nichts\. Wechseln Sie zu „[^“]+“ oder laden Sie die Seite neu\./)
    }
    // Anlegen mit einem Verweis in ein anderes Objekt (Durchsicht, Kann 1): Nennt die Anfrage B, gehört aber die Wohnung,
    // das Mietverhältnis oder der Zähler im Rumpf zu A, wird nichts angelegt.
    const meter = await post<Meter>(`/api/meters?property=${a}`, { name: 'KW', unitId: unit.id, type: 'kaltwasser', unit: 'm³' })
    const metersBefore = await s.api<unknown[]>(`/api/readings?property=${a}`)
    const stepsAfterMeter = await journalSteps(s)
    const creates: [string, unknown, RegExp][] = [
      [`/api/tenancies?${other}`, { unitId: unit.id, tenantName: 'Neu', persons: 1, personHistory: [], start: '2026-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }, /^Diese Wohnung gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/],
      [`/api/payments?${other}`, { tenancyId: tenancy.id, date: '2025-02-03', amountCents: 1 }, /^Dieses Mietverhältnis gehört zu/],
      [`/api/readings?${other}`, { meterId: meter.id, date: '2025-01-01', value: 1 }, /^Dieser Zähler gehört zu/],
      [`/api/deposit-entries?${other}`, { tenancyId: tenancy.id, date: '2025-02-02', kind: 'received', amountCents: 1 }, /^Dieses Mietverhältnis gehört zu/],
      [`/api/co2-refunds?${other}`, { tenancyId: tenancy.id, supplierBilledAt: '2025-01-20', claimedAt: '2025-03-02', amountCents: 1, settlePeriod: '2025-01' }, /^Dieses Mietverhältnis gehört zu/],
    ]
    for (const [url, body, satz] of creates) {
      const res = await sendJson(s, url, body, 'POST')
      assert.equal(res.status, 409, `POST ${url}`)
      assert.match(await errorFrom(res), satz, `POST ${url}`)
    }
    assert.deepEqual(await lists(), before, 'nichts angelegt')
    assert.deepEqual(await s.api<unknown[]>(`/api/readings?property=${a}`), metersBefore)
    assert.deepEqual(await journalSteps(s), stepsAfterMeter, 'kein Schritt im Verlauf')
    // Mit dem Objekt des Verweises geht es.
    assert.equal((await sendJson(s, `/api/payments?property=${a}`, { tenancyId: tenancy.id, date: '2025-02-03', amountCents: 1 }, 'POST')).status, 201)

    // Mit dem Objekt des Datensatzes und ohne Angabe wie bisher; GET liest auch mit einem anderen Objekt.
    assert.equal((await s.api<HeatingPlant>(`/api/heating-plants/${plant.id}?property=${a}`, { method: 'PUT', body: JSON.stringify({ name: 'Kessel' }) })).name, 'Kessel')
    assert.equal((await s.api<FuelDelivery>(`/api/fuel-deliveries/${delivery.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 12000 }) })).fixedCents, 12000)
    assert.equal((await fetch(`${s.base}/api/heating-plants/${plant.id}/deliveries?${other}`)).status, 200)
    await s.api(`/api/deposit-entries/${deposit.id}?property=${a}`, { method: 'DELETE' })
    // Eine Kennung, die es nicht gibt, meldet die Route wie bisher.
    assert.equal((await sendJson(s, `/api/fuel-deliveries/gibt-es-nicht?${other}`, { fixedCents: 1 })).status, 404)
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

test('Bundesland am Objekt: gespeichert, als Teilrumpf ergänzt, leer heißt unbekannt, ein fremdes Kürzel 400', async () => {
  const s = await startServer()
  try {
    const [objekt] = await s.api<Property[]>('/api/properties')
    assert.equal(objekt?.state, null, 'ein frisches Objekt hat kein Bundesland')
    const route = `${s.base}/api/properties/${objekt?.id}`
    const put = (body: unknown) => fetch(route, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const by = await put({ state: 'BY' })
    assert.equal(by.status, 200)
    assert.equal((await jsonOf<Property>(by)).state, 'BY')
    // Ein Teilrumpf ohne `state` lässt es stehen.
    assert.equal((await jsonOf<Property>(await put({ name: 'Haus' }))).state, 'BY')
    // Ein unbekanntes Kürzel wird abgelehnt, nicht still zu „unbekannt“; gespeichert bleibt das alte.
    for (const falsch of ['XX', 'by', 'Bayern', 7]) {
      const r = await put({ state: falsch })
      assert.equal(r.status, 400, String(falsch))
      assert.match(await errorFrom(r), /Bundesland ist unbekannt/)
    }
    assert.equal((await s.api<Property[]>('/api/properties'))[0]?.state, 'BY')
    assert.equal((await jsonOf<Property>(await put({ state: '' }))).state, null)
    assert.equal((await jsonOf<Property>(await put({ state: 'SN' }))).state, 'SN')
    assert.equal((await jsonOf<Property>(await put({ state: null }))).state, null)
    // Beim Anlegen ebenso
    const neu = await fetch(`${s.base}/api/properties`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Zweites', state: 'HB' }) })
    assert.equal((await jsonOf<Property>(neu)).state, 'HB')
    const falschNeu = await fetch(`${s.base}/api/properties`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Drittes', state: 'DE' }) })
    assert.equal(falschNeu.status, 400)
    assert.equal((await s.api<Property[]>('/api/properties')).length, 2, 'nichts halb angelegt')
  } finally {
    s.stop()
  }
})

// #96 PR 2 (Entwurf 2026-10-30-steuer-objekt-ruecklage-design.md, B2): Kopf der Anlage V am Objekt und „an Angehörige
// vermietet“ am Mietverhältnis, über die Routen, im Backup erhalten, aus einem älteren Backup leer.
test('Kopf der Anlage V (#96): Aktenzeichen und Daten am Objekt hin und zurück, als Teilrumpf ergänzt, mit null geleert, Ungültiges 400', async () => {
  const s = await startServer()
  try {
    const [objekt] = await s.api<Property[]>('/api/properties')
    assert.equal(objekt !== undefined && 'groundTaxFileNumber' in objekt, false, 'ohne Angabe steht nichts in der Antwort')
    const route = `${s.base}/api/properties/${objekt?.id}`
    const put = (body: unknown) => fetch(route, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const kopf = { groundTaxFileNumber: '2141/123/45678', purchaseContractOn: '2023-05-10', ownershipTransferOn: '2023-07-01', buildingApplicationOn: '2019-02-01', completedOn: '2020-11-30' }
    const set = await put(kopf)
    assert.equal(set.status, 200)
    const gespeichert = await jsonOf<Property>(set)
    assert.deepEqual([gespeichert.groundTaxFileNumber, gespeichert.purchaseContractOn, gespeichert.ownershipTransferOn, gespeichert.buildingApplicationOn, gespeichert.completedOn], Object.values(kopf))
    const teil = await jsonOf<Property>(await put({ name: 'Haus' }))
    assert.equal(teil.ownershipTransferOn, '2023-07-01', 'ein Teilrumpf lässt die Angaben stehen')
    for (const [body, satz] of [
      [{ purchaseContractOn: '10.05.2023' }, /Kaufvertrag.*kein Datum/],
      [{ completedOn: '2020-11' }, /Fertigstellung.*kein Datum/],
      // Durchsicht K2: ein Tag, den es nicht gibt, wie im Formular (`headerDateText`), auch bei der Verordnung (isoDateOrNull).
      [{ completedOn: '2023-02-31' }, /Fertigstellung.*kein Datum/],
      [{ ownershipTransferOn: '2023-13-01' }, /Eigentumsübergangs.*kein Datum/],
      [{ tightMarket: true, tightMarketFrom: '2023-02-29' }, /Beginn der Verordnung.*kein Datum/],
      [{ groundTaxFileNumber: '1'.repeat(41) }, /Aktenzeichen.*höchstens 40 Zeichen/],
    ] as const) {
      const r = await put(body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.match(await errorFrom(r), satz)
    }
    assert.equal((await s.api<Property[]>('/api/properties'))[0]?.completedOn, '2020-11-30', 'nach der Ablehnung bleibt das Gespeicherte')
    const geleert = await jsonOf<Property>(await put({ groundTaxFileNumber: null, purchaseContractOn: null, ownershipTransferOn: null, buildingApplicationOn: null, completedOn: null }))
    assert.deepEqual([geleert.groundTaxFileNumber, geleert.purchaseContractOn, geleert.ownershipTransferOn, geleert.buildingApplicationOn, geleert.completedOn].map((v) => v ?? null), [null, null, null, null, null])
  } finally {
    s.stop()
  }
})

test('Angehörige (#96): das Kennzeichen am Mietverhältnis über die Route, zählt in der Steuerübersicht, 400 bei anderem Wert, im Backup erhalten', async () => {
  const s = await startServer()
  try {
    const u = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    const leer = { personHistory: [], end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 50000 }] }
    const t = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ ...leer, unitId: u.id, tenantName: 'Tochter', persons: 1, start: '2025-01-01', relative: true }) })
    assert.equal(t.relative, true)
    const fremd = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ ...leer, unitId: u.id, tenantName: 'Fremd', persons: 1, start: '2024-01-01', end: '2024-12-31' }) })
    assert.equal(fremd.relative, undefined, 'ohne Angabe: nein, wie bisher')
    const put = (body: unknown) => fetch(`${s.base}/api/tenancies/${t.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const r = await put({ relative: 2 })
    assert.equal(r.status, 400)
    assert.match(await errorFrom(r), /An Angehörige vermietet ist ja oder nein/)
    assert.equal((await s.api<TaxReport>('/api/taxreport/2025')).costModels.relativeTenancies, 1)
    assert.equal((await s.api<TaxReport>('/api/taxreport/2024')).costModels.relativeTenancies, undefined, 'nur Mietverhältnisse des Jahres')

    // Im Backup erhalten, mit Kopfangaben am Objekt.
    const [objekt] = await s.api<Property[]>('/api/properties')
    await s.api(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ groundTaxFileNumber: '123', ownershipTransferOn: '2023-07-01' }) })
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal((await put({ relative: false })).status, 200)
    await s.api(`/api/properties/${objekt?.id}`, { method: 'PUT', body: JSON.stringify({ groundTaxFileNumber: null, ownershipTransferOn: null }) })
    const back = await restore(s, backup)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((x) => [x.tenantName, x.relative ?? null]), [['Tochter', true], ['Fremd', null]])
    const [wieder] = await s.api<Property[]>('/api/properties')
    assert.deepEqual([wieder?.groundTaxFileNumber, wieder?.ownershipTransferOn], ['123', '2023-07-01'])
  } finally {
    s.stop()
  }
})

test('Kopf der Anlage V (#96): ein Backup von vor den Schritten 0080/0081 kommt mit leeren Angaben zurück', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-steuer-kopf-backup-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const c = await connect(file)
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_anlage_v_kopf'))
    if (bis < 0) assert.fail('Schritt …_anlage_v_kopf fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01')`)
    c.close()
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const [objekt] = await s.api<Property[]>('/api/properties')
    assert.deepEqual([objekt?.groundTaxFileNumber, objekt?.purchaseContractOn, objekt?.ownershipTransferOn, objekt?.buildingApplicationOn, objekt?.completedOn].map((v) => v ?? null), [null, null, null, null, null])
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.relative ?? null), [null])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
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

test('Mieterwechsel (#229): neue Anschrift, E-Mail und Telefon des Vormieters im selben Schritt, alles freiwillig', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await changeStock(s)
    await s.api(`/api/tenancies/${tenancy.id}?property=objekt-1`, { method: 'PUT', body: JSON.stringify({ email: 'alt@example.org', phone: '0301234' }) })
    // Eine Angabe falscher Art wird abgelehnt, und nichts ist gespeichert.
    for (const contact of ['Birkenweg 3', { email: 5 }, { correspondenceAddress: 'x'.repeat(201) }]) {
      const res = await postChange(s, tenancy.id, { end: '2025-06-30', readings: [], newTenancy: null, contact })
      assert.equal(res.status, 400, JSON.stringify(contact))
      assert.equal((await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id)?.end, null)
    }
    // Nur, was mitkommt, ändert sich; leer entfernt die Angabe, ein Umbruch wird „, “.
    const res = await postChange(s, tenancy.id, {
      end: '2025-06-30', readings: [], newTenancy: null,
      contact: { correspondenceAddress: ' Birkenweg 3\n54321 Anderswo ', phone: '' },
    })
    assert.equal(res.status, 200, await res.clone().text())
    const ended = (await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((t) => t.id === tenancy.id) ?? assert.fail('weg')
    assert.equal(ended.end, '2025-06-30')
    assert.equal(ended.correspondenceAddress, 'Birkenweg 3, 54321 Anderswo')
    assert.equal(ended.email, 'alt@example.org', 'nicht mitgeschickt, bleibt')
    assert.equal(ended.phone, undefined, 'leer entfernt')

    // Die Abrechnung schreibt an die neue Anschrift; mit dem Abschluss friert sie ein.
    const letterOf = (st: Settlement) => st.letters?.[tenancy.id] ?? assert.fail('kein Anschreiben')
    await s.api('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }) })
    assert.deepEqual(letterOf(await s.api<Settlement>('/api/settlement/2025?property=objekt-1')).recipient, ['Alt', 'Birkenweg 3', '54321 Anderswo'])
    const close = await fetch(`${s.base}/api/settlement/2025/close?property=objekt-1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(close.status, 201, await close.clone().text())
    await s.api(`/api/tenancies/${tenancy.id}?property=objekt-1`, { method: 'PUT', body: JSON.stringify({ correspondenceAddress: 'Ganz woanders 1, 99999 Fern' }) })
    assert.deepEqual(letterOf(await s.api<Settlement>('/api/settlement/2025?property=objekt-1')).recipient, ['Alt', 'Birkenweg 3', '54321 Anderswo'], 'eingefroren')
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

test('Mieterwechsel (#150): über die Grenze eines Objekts wird abgelehnt und nichts gespeichert', async () => {
  await withProperties(async (s, b) => {
    const a = await changeStock(s, 'objekt-1')
    const fremd = await changeStock(s, b.id)
    // Das Mietverhältnis gehört zu Objekt A, die Anfrage nennt B: seit #692 wie jede Route an einem Datensatz 409 mit Satz.
    const falschesObjekt = await postChange(s, a.tenancy.id, { end: '2025-06-30', readings: [], newTenancy: null }, b.id)
    assert.equal(falschesObjekt.status, 409)
    assert.match(await errorFrom(falschesObjekt), /Dieses Mietverhältnis gehört zu „[^“]+“, gewählt ist „Gartenweg 3“/)
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

// Die Kennungen der Schritte im Verlauf: Eine Ablehnung legt keinen an.
const journalSteps = async (s: Server): Promise<number[]> => (await jsonOf<JournalGroupView[]>(await fetch(`${s.base}/api/journal?limit=200`))).map((g) => g.id)
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

test('Gemerkte Ergebnisse (#651): je Objekt und Jahr getrennt, nach dem Schreiben neu gerechnet', async () => {
  // Abrechnung, Steuer, Verbrauch und Mietkonto werden je Bestand gemerkt (stockMemo.ts). Ohne Schreiben dazwischen
  // fragt dieser Test abwechselnd zwei Objekte und zwei Jahre: Jede Antwort muss ihre eigene sein.
  await withProperties(async (s, b) => {
    await s.api('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'A-EG', areaM2: 50, participates: true }) })
    await s.api(`/api/units?property=${b.id}`, { method: 'POST', body: JSON.stringify({ name: 'B-EG', areaM2: 50, participates: true }) })
    const cost = (property: string, year: number, amountCents: number) => s.api(`/api/costItems?property=${property}`, {
      method: 'POST', body: JSON.stringify({ year, category: 'Grundsteuer', description: `Grundsteuer ${year}`, amountCents, key: 'area' }),
    })
    await cost('objekt-1', 2024, 10000)
    await cost('objekt-1', 2025, 20000)
    await cost(b.id, 2025, 30000)
    const total = async (property: string, year: number) =>
      (await s.api<{ totalCostsCents: number }>(`/api/settlement/${year}?property=${property}`)).totalCostsCents
    const expenses = async (property: string, year: number) =>
      (await s.api<{ expenses: { totalCents: number } }>(`/api/taxreport/${year}?property=${property}`)).expenses.totalCents
    for (let round = 0; round < 2; round++) {
      assert.equal(await total('objekt-1', 2025), 20000)
      assert.equal(await total(b.id, 2025), 30000)
      assert.equal(await total('objekt-1', 2024), 10000)
      assert.equal(await expenses('objekt-1', 2025), 20000)
      assert.equal(await expenses(b.id, 2025), 30000)
      assert.equal(await expenses('objekt-1', 2024), 10000)
    }
    await cost('objekt-1', 2025, 5000)
    assert.equal(await total('objekt-1', 2025), 25000, 'nach dem Schreiben neu gerechnet')
    assert.equal(await expenses('objekt-1', 2025), 25000)
    assert.equal(await total(b.id, 2025), 30000)
  })
})

test('Gemerkte Ergebnisse (#651): nach Rücksprung und Wiederherstellen frisch', async () => {
  // Beide tauschen den Stand aus, ohne dass eine gewöhnliche Route schreibt: der Rücksprung in `write`, das
  // Wiederherstellen mit einer neuen Verbindung. Ein gemerktes Ergebnis von davor darf danach nie herauskommen.
  const s = await startServer()
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 50, participates: true }) })
    const cost = (amountCents: number) => s.api('/api/costItems', {
      method: 'POST', body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents, key: 'area' }),
    })
    const total = async () => (await s.api<{ totalCostsCents: number }>('/api/settlement/2025')).totalCostsCents
    await cost(10000)
    assert.equal(await total(), 10000)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    await cost(5000)
    assert.equal(await total(), 15000)
    assert.equal(await total(), 15000, 'zweimal gefragt, einmal gemerkt')
    await revert(s, (await newest(s)).id, 'including')
    assert.equal(await total(), 10000, 'nach dem Rücksprung')
    await cost(7000)
    assert.equal(await total(), 17000)
    assert.equal((await restore(s, backup)).status, 200)
    assert.equal(await total(), 10000, 'nach dem Wiederherstellen')
  } finally {
    s.stop()
  }
})
