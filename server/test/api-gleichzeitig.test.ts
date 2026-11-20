// Integrationstests gegen den echten Server: zwei Fenster bearbeiten denselben Datensatz.
//
// Tab A und Tab B (oder Handy und Rechner im Heimnetz) öffnen dieselbe Kostenposition. A ändert den Betrag und
// speichert, B ändert nur die Beschreibung und speichert danach. Das Formular schickt alle Angaben, also stand danach
// wieder der alte Betrag im Bestand, ohne Meldung. Schickt das Formular den Stand mit, den es geladen hat
// (`ifUnchanged`), lehnt der Server ab (409) und nennt den Stand von jetzt. Ohne die Angabe geht alles wie bisher.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, Meter, Payment, Property, Reading, Tenancy, Unit } from '../../shared/types.ts'
import { type Server, startServer } from '../testing/api.ts'

type Answer = { status: number; body: Record<string, unknown> }
const send = async (s: Server, method: string, route: string, body: unknown): Promise<Answer> => {
  const res = await fetch(`${s.base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const parsed: unknown = await res.json()
  return { status: res.status, body: parsed !== null && typeof parsed === 'object' ? { ...parsed } : {} }
}
const put = (s: Server, route: string, body: unknown) => send(s, 'PUT', route, body)
const post = <T>(s: Server, route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
const only = <T>(list: T[], what: string): T => {
  const [first] = list
  if (first === undefined) assert.fail(`${what} fehlt in der Liste.`)
  return first
}

async function stock(s: Server) {
  const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
  const tenancy = await post<Tenancy>(s, '/api/tenancies', {
    unitId: unit.id, tenantName: 'Frau A', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
  })
  return { unit, tenancy }
}

test('Kostenposition: Das zweite Fenster überschreibt den Betrag des ersten nicht mehr still', async () => {
  const s = await startServer()
  try {
    await stock(s)
    await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Gebäudeversicherung', description: 'Versicherung', amountCents: 138000, key: 'area' })
    // Beide Fenster laden die Liste, wie die Seite Kosten es tut.
    const seen = only(await s.api<CostItem[]>('/api/costItems'), 'Die Kostenposition')
    const url = `/api/costItems/${seen.id}`
    const form = { category: seen.category, description: seen.description, amountCents: seen.amountCents, key: seen.key }

    // Fenster A: Betrag 1.500,00 €.
    const a = await put(s, url, { ...form, amountCents: 150000, ifUnchanged: seen })
    assert.equal(a.status, 200)
    // Fenster B kennt noch 1.380,00 € und ändert nur die Beschreibung.
    const b = await put(s, url, { ...form, description: 'Wohngebäudeversicherung', ifUnchanged: seen })
    assert.equal(b.status, 409)
    assert.match(String(b.body.error), /inzwischen/)
    assert.match(String(b.body.error), /Gespeichert wurde nichts/)
    assert.equal(b.body.stale, true)
    const current = b.body.current
    assert.ok(current !== null && typeof current === 'object' && 'amountCents' in current && current.amountCents === 150000, 'Die Antwort nennt den Stand von jetzt.')
    const stored = only(await s.api<CostItem[]>('/api/costItems'), 'Die Kostenposition')
    assert.equal(stored.amountCents, 150000)
    assert.equal(stored.description, 'Versicherung')

    // Dieselbe Anfrage noch einmal (Doppelklick, Wiederholung nach verlorener Antwort): Der Stand gilt schon, Erfolg.
    const again = await put(s, url, { ...form, amountCents: 150000, ifUnchanged: seen })
    assert.equal(again.status, 200)

    // Mit dem Stand von jetzt geht B durch.
    const fresh = await put(s, url, { ...form, amountCents: 150000, description: 'Wohngebäudeversicherung', ifUnchanged: stored })
    assert.equal(fresh.status, 200)

    // Ohne die Angabe (älterer Tab, Skript) gilt wie bisher der letzte.
    const old = await put(s, url, { ...form })
    assert.equal(old.status, 200)
    assert.equal(only(await s.api<CostItem[]>('/api/costItems'), 'Die Kostenposition').amountCents, 138000)
  } finally {
    s.stop()
  }
})

test('Kostenposition: Ein anderer Weg hat sie geändert oder gelöscht, das offene Formular wird abgelehnt', async () => {
  const s = await startServer()
  try {
    await stock(s)
    const item = await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Hauswart', description: 'Hauswart', amountCents: 50000, key: 'area' })
    const seen = only(await s.api<CostItem[]>('/api/costItems'), 'Die Kostenposition')
    // Ein Teilrumpf von anderer Stelle (Beleg zuordnen, Betrag prüfen, Belegbuchung) ändert die Position.
    assert.equal((await put(s, `/api/costItems/${item.id}`, { vendor: 'Hausmeister GmbH' })).status, 200)
    const stale = await put(s, `/api/costItems/${item.id}`, { description: 'Hauswart 2025', amountCents: 50000, ifUnchanged: seen })
    assert.equal(stale.status, 409)
    assert.equal(only(await s.api<CostItem[]>('/api/costItems'), 'Die Kostenposition').vendor, 'Hausmeister GmbH')

    // Gelöscht: ein Satz, der sagt, was geschehen ist.
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    const gone = await put(s, `/api/costItems/${item.id}`, { description: 'Hauswart 2025', ifUnchanged: seen })
    assert.equal(gone.status, 404)
    assert.match(String(gone.body.error), /Kostenposition/)
    assert.match(String(gone.body.error), /gelöscht/)
    assert.doesNotMatch(String(gone.body.error), /Nicht gefunden/)
  } finally {
    s.stop()
  }
})

test('Wohnung, Zähler, Ablesung und Zahlung: dieselbe Erkennung über die generischen Routen', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy } = await stock(s)
    const meter = await post<Meter>(s, '/api/meters', { name: 'KW EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³' })
    const reading = await post<Reading>(s, '/api/readings', { meterId: meter.id, date: '2025-12-31', value: 50 })
    const payment = await post<Payment>(s, '/api/payments', { tenancyId: tenancy.id, date: '2025-01-03', amountCents: 50000 })

    const cases: { route: string; first: Record<string, unknown>; second: Record<string, unknown>; kept: (list: unknown) => boolean; what: RegExp }[] = [
      { route: `/api/units/${unit.id}`, first: { areaM2: 85 }, second: { name: 'Erdgeschoss' }, kept: (u) => JSON.stringify(u).includes('"areaM2":85') && !JSON.stringify(u).includes('Erdgeschoss'), what: /Wohnung/ },
      { route: `/api/meters/${meter.id}`, first: { meterNumber: 'A-1' }, second: { name: 'Kaltwasser EG' }, kept: (m) => JSON.stringify(m).includes('A-1') && !JSON.stringify(m).includes('Kaltwasser EG'), what: /Zähler/ },
      { route: `/api/readings/${reading.id}`, first: { value: 55 }, second: { date: '2025-12-30' }, kept: (r) => JSON.stringify(r).includes('"value":55') && !JSON.stringify(r).includes('2025-12-30'), what: /Ablesung/ },
      { route: `/api/payments/${payment.id}`, first: { amountCents: 60000 }, second: { note: 'Januar' }, kept: (p) => JSON.stringify(p).includes('"amountCents":60000') && !JSON.stringify(p).includes('Januar'), what: /Zahlung/ },
    ]
    for (const c of cases) {
      const list = c.route.slice(0, c.route.lastIndexOf('/'))
      const id = c.route.slice(c.route.lastIndexOf('/') + 1)
      const seen = (await s.api<{ id: string }[]>(list)).find((x) => x.id === id)
      if (!seen) assert.fail(`${c.route} fehlt in der Liste.`)
      assert.equal((await put(s, c.route, { ...c.first, ifUnchanged: seen })).status, 200, c.route)
      const stale = await put(s, c.route, { ...c.second, ifUnchanged: seen })
      assert.equal(stale.status, 409, c.route)
      assert.match(String(stale.body.error), c.what)
      assert.match(String(stale.body.error), /inzwischen/)
      assert.ok(c.kept((await s.api<{ id: string }[]>(list)).find((x) => x.id === id)), `${c.route}: Der Stand des ersten Fensters bleibt.`)
      // Wiederholung des ersten und der unveränderte Stand von jetzt gehen durch.
      assert.equal((await put(s, c.route, { ...c.first, ifUnchanged: seen })).status, 200, c.route)
      const now = (await s.api<{ id: string }[]>(list)).find((x) => x.id === id)
      assert.equal((await put(s, c.route, { ...c.second, ifUnchanged: now })).status, 200, c.route)
    }
    // Gelöscht: je Sammlung ein Satz.
    for (const [route, what] of [[`/api/payments/${payment.id}`, /Zahlung/], [`/api/readings/${reading.id}`, /Ablesung/], [`/api/meters/${meter.id}`, /Zähler/], [`/api/units/${unit.id}`, /Wohnung/]] as const) {
      await s.api(route, { method: 'DELETE' })
      const gone = await put(s, route, { note: 'x' })
      assert.equal(gone.status, 404)
      assert.match(String(gone.body.error), what)
      assert.match(String(gone.body.error), /gelöscht/)
    }
  } finally {
    s.stop()
  }
})

test('Objekt: Das zweite Fenster überschreibt die Angaben des ersten nicht mehr still', async () => {
  const s = await startServer()
  try {
    const seen = only(await s.api<Property[]>('/api/properties'), 'Das Objekt')
    const url = `/api/properties/${seen.id}`
    assert.equal((await put(s, url, { name: seen.name, address: 'Hauptstraße 1, 12345 Musterstadt', ifUnchanged: seen })).status, 200)
    const stale = await put(s, url, { name: 'Haus am See', address: seen.address, ifUnchanged: seen })
    assert.equal(stale.status, 409)
    assert.match(String(stale.body.error), /inzwischen/)
    assert.equal(stale.body.stale, true)
    const stored = only(await s.api<Property[]>('/api/properties'), 'Das Objekt')
    assert.equal(stored.address, 'Hauptstraße 1, 12345 Musterstadt')
    assert.equal(stored.name, seen.name)
    assert.equal((await put(s, url, { name: 'Haus am See', ifUnchanged: stored })).status, 200)
    assert.equal((await put(s, url, { name: 'Haus am Wald' })).status, 200)
  } finally {
    s.stop()
  }
})
