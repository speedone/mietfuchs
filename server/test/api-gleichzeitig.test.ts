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
    // Wo geändert wurde, weiß der Server nicht (es kann derselbe Tab gewesen sein): Die Meldung behauptet kein zweites Fenster.
    assert.doesNotMatch(String(b.body.error), /Fenster|Gerät/)
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

// Wächter gegen falsche Ablehnungen: Was die Liste liefert, muss als gesehener Stand durchgehen, auch mit dem, was sie
// dazusetzt (`year` im Kalenderobjekt, `fromDeposit` an einer Zahlung aus der Kaution). Setzt künftig jemand der Liste
// ein Feld dazu, das nicht gespeichert ist, ohne es in `VIEW_ONLY` (repository.ts) einzutragen, wird dieser Test rot;
// sonst lehnte jedes Speichern aus dem Formular ab.
test('Mit dem Stand aus der Liste gespeichert: keine Sammlung und kein Objekt lehnt ab', async () => {
  const s = await startServer()
  try {
    const { unit, tenancy } = await stock(s)
    const second = await post<Unit>(s, '/api/units', { name: 'OG', areaM2: 60, participates: false, selfUsed: true, selfPersons: 2, floor: '1. OG', mea: 400 })
    const meter = await post<Meter>(s, '/api/meters', { name: 'KW EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³', meterNumber: 'A-1', calibratedUntil: 2030 })
    await post<Meter>(s, '/api/meters', { name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' })
    await post<Reading>(s, '/api/readings', { meterId: meter.id, date: '2025-12-31', value: 50.5, note: 'abgelesen' })
    await post<Payment>(s, '/api/payments', { tenancyId: tenancy.id, date: '2026-01-03', amountCents: 50000, note: 'Januar' })
    // Eine Zahlung aus der Kaution: Die Liste setzt `fromDeposit` dazu.
    await post(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-01-05', kind: 'received', amountCents: 150000 })
    await post(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2026-02-10', kind: 'applied', purpose: 'rent', amountCents: 50000 })
    await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Gebäudeversicherung', description: 'Versicherung', vendor: 'Versicherung AG', amountCents: 138000, key: 'area' })
    await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Grundsteuer', description: 'Anteile', amountCents: 10000, key: 'custom', customShares: { [unit.id]: 50, [second.id]: 50 } })
    await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Aufzug', description: 'Aufzug', amountCents: 10000, labor35aCents: 2000, key: 'area', participantUnitIds: [unit.id] })
    await post<CostItem>(s, '/api/costItems', { year: 2025, category: 'Wasserversorgung', description: 'Wasser', amountCents: 20000, key: 'meter', meterType: 'kaltwasser' })

    let checked = 0
    const CHANGE: Record<string, Record<string, unknown>> = {
      units: { notes: 'geändert' }, costItems: { vendor: 'geändert' }, meters: { meterNumber: 'geändert' },
      readings: { note: 'geändert' }, payments: { note: 'geändert' }, properties: { address: 'geändert' },
    }
    for (const list of Object.keys(CHANGE)) {
      const rows = await s.api<Record<string, unknown>[]>(`/api/${list}`)
      assert.ok(rows.length > 0, `${list}: Der Bestand des Tests hat keinen Eintrag.`)
      if (list === 'costItems') assert.ok(rows.every((r) => 'year' in r), 'Im Kalenderobjekt trägt jede Position der Liste `year`.')
      if (list === 'payments') assert.ok(rows.some((r) => r.fromDeposit === true), 'Die Zahlung aus der Kaution trägt `fromDeposit`.')
      for (const seen of rows) {
        // Mit einer Änderung, sonst griffe die Ausnahme „der Stand gilt schon“ und der Vergleich bliebe ungeprüft.
        const res = await put(s, `/api/${list}/${String(seen.id)}`, { ...CHANGE[list], ifUnchanged: seen })
        assert.equal(res.status, 200, `${list}: ${JSON.stringify(seen)} wurde abgelehnt: ${String(res.body.error)}`)
        checked++
      }
    }
    assert.ok(checked >= 12)
  } finally {
    s.stop()
  }
})

// Die Einstellungen (Vermieter, Bankverbindung, Druck, KI) sind eine Zeile, und jede Karte schickt nur ihren Teil. Die
// Antwort ist angereichert (`fixedByEnv`, `aiKeys`, `aiExternal`, wirksame KI-Werte). Deshalb schickt die Karte als
// `ifUnchanged` nur die Schlüssel mit, die sie selbst schreibt, wie sie sie geladen hat, und nur die werden verglichen.
const pick = (from: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((key) => [key, from[key] ?? null]))
const LANDLORD = ['landlordName', 'iban', 'paymentDeadlineDays', 'landlordAddress', 'landlordContact'] as const
const PRINT = ['printFoldMarks', 'printAttachments', 'printFooter', 'printPaymentQr'] as const
const settingsOf = (s: Server) => s.api<Record<string, unknown>>('/api/settings')
// Was die KI-Karte schickt: alles außer `consent`, das nur die eigene Route ändert.
const aiFormOf = (settings: Record<string, unknown>): Record<string, unknown> => {
  const ai = settings.ai
  if (ai === null || typeof ai !== 'object') assert.fail('Die Einstellungen tragen keine KI-Einstellungen.')
  const { consent: _consent, ...form } = { ...ai } as Record<string, unknown>
  return form
}

test('Einstellungen: Das zweite Fenster überschreibt die IBAN des ersten nicht mehr still', async () => {
  const s = await startServer()
  try {
    await put(s, '/api/settings', { landlordName: 'Erika Muster', iban: 'DE89370400440532013000', paymentDeadlineDays: 30 })
    // Beide Fenster laden die Einstellungen.
    const seen = pick(await settingsOf(s), LANDLORD)
    const form = { ...seen, landlordAddress: '', landlordContact: '' }

    // Fenster A: neue IBAN.
    const a = await put(s, '/api/settings', { ...form, iban: 'DE02120300000000202051', ifUnchanged: seen })
    assert.equal(a.status, 200)
    // Fenster B kennt noch die alte und ändert nur den Kontakt.
    const b = await put(s, '/api/settings', { ...form, landlordContact: 'Tel. 0123 456789', ifUnchanged: seen })
    assert.equal(b.status, 409)
    assert.match(String(b.body.error), /Einstellungen wurden inzwischen geändert/)
    assert.match(String(b.body.error), /Gespeichert wurde nichts/)
    assert.doesNotMatch(String(b.body.error), /Fenster|Gerät/)
    assert.equal(b.body.stale, true)
    const current = b.body.current
    assert.ok(current !== null && typeof current === 'object' && 'iban' in current && current.iban === 'DE02120300000000202051', 'Die Antwort nennt den Stand von jetzt.')
    const stored = await settingsOf(s)
    assert.equal(stored.iban, 'DE02120300000000202051')
    assert.ok(!stored.landlordContact)
    assert.ok(!('ifUnchanged' in stored))

    // Dieselbe Anfrage noch einmal (Doppelklick, Wiederholung nach verlorener Antwort): Der Stand gilt schon, Erfolg.
    assert.equal((await put(s, '/api/settings', { ...form, iban: 'DE02 1203 0000 0000 2020 51', ifUnchanged: seen })).status, 200)
    // Mit dem Stand von jetzt geht B durch.
    assert.equal((await put(s, '/api/settings', { ...form, iban: stored.iban, landlordContact: 'Tel. 0123 456789', ifUnchanged: pick(stored, LANDLORD) })).status, 200)
    // Ohne die Angabe (älterer Tab, Skript) gilt wie bisher der letzte.
    assert.equal((await put(s, '/api/settings', { ...form })).status, 200)
    assert.equal((await settingsOf(s)).iban, 'DE89370400440532013000')
  } finally {
    s.stop()
  }
})

test('Einstellungen: Verglichen werden nur die Schlüssel der Karte, eine andere Karte stört nicht', async () => {
  const s = await startServer()
  try {
    // Ein Fenster lädt einmal und speichert dann eine Karte nach der anderen, jede mit dem Stand vom Laden.
    const loaded = await settingsOf(s)
    const aiForm = aiFormOf(loaded)
    const landlord = pick(loaded, LANDLORD)

    // Vermieter, aus dem frischen Bestand (alles leer bzw. Vorgabe).
    const first = await put(s, '/api/settings', { ...landlord, landlordName: 'Erika Muster', ifUnchanged: landlord })
    assert.equal(first.status, 200, String(first.body.error))
    // Druck: Die Seite Abrechnung kennt die Einstellungen von vor dem Speichern des Vermieters.
    const print = await put(s, '/api/settings', { printFoldMarks: true, printAttachments: false, printFooter: true, printPaymentQr: false, ifUnchanged: pick(loaded, PRINT) })
    assert.equal(print.status, 200, String(print.body.error))
    // KI: ebenso, mit dem geladenen Stand ihrer eigenen Schlüssel.
    const ki = await put(s, '/api/settings', { ai: { ...aiForm, extraInstructions: 'Bitte genau lesen.' }, ifUnchanged: { ai: aiForm } })
    assert.equal(ki.status, 200, String(ki.body.error))
    // Die Update-Prüfung (Teilrumpf ohne Angabe) ändert nichts, was eine Karte vergleicht.
    assert.equal((await put(s, '/api/settings', { updateCheck: 'off' })).status, 200)
    // Vermieter noch einmal, mit dem Stand aus der Antwort des eigenen Speicherns.
    const again = await put(s, '/api/settings', { ...pick(first.body, LANDLORD), landlordContact: 'Tel. 0123 456789', ifUnchanged: pick(first.body, LANDLORD) })
    assert.equal(again.status, 200, String(again.body.error))

    const stored = await settingsOf(s)
    assert.equal(stored.landlordName, 'Erika Muster')
    assert.equal(stored.landlordContact, 'Tel. 0123 456789')
    assert.equal(stored.printFooter, true)

    // Die KI-Karte eines zweiten Fensters mit dem Stand von vorher wird abgelehnt; mit dem Stand von jetzt geht sie durch.
    const stale = await put(s, '/api/settings', { ai: { ...aiForm, extraInstructions: 'Anders.' }, ifUnchanged: { ai: aiForm } })
    assert.equal(stale.status, 409)
    const nowForm = aiFormOf(stored)
    assert.equal((await put(s, '/api/settings', { ai: { ...nowForm, extraInstructions: 'Anders.' }, ifUnchanged: { ai: nowForm } })).status, 200)
  } finally {
    s.stop()
  }
})

// Durchsicht K1: Prüfung und Schreiben sind ein Vorgang. Kommen beide Fenster im selben Augenblick, geht genau eines
// durch, und das andere überschreibt dessen Änderung weder mit seinem Stand noch mit dem alten.
test('Einstellungen: gleichzeitige Speichern mit demselben Stand, genau eines geht durch', async () => {
  const s = await startServer()
  try {
    await put(s, '/api/settings', { landlordName: 'Erika Muster', iban: 'DE89370400440532013000', paymentDeadlineDays: 30 })
    const seen = pick(await settingsOf(s), LANDLORD)
    // Acht Fenster mit demselben Stand, jedes mit einem anderen Kontakt.
    const answers = await Promise.all(Array.from({ length: 8 }, (_, n) => put(s, '/api/settings', { ...seen, landlordContact: `Tel. ${n}`, ifUnchanged: seen })))
    const through = answers.flatMap((answer, n) => (answer.status === 200 ? [n] : []))
    assert.equal(through.length, 1, `Durchgegangen: ${through.join(', ')}`)
    assert.ok(answers.every((answer) => answer.status === 200 || answer.status === 409))
    assert.equal((await settingsOf(s)).landlordContact, `Tel. ${String(through[0])}`)
  } finally {
    s.stop()
  }
})

// Durchsicht K2: Auf einem frischen Bestand fehlen Anschrift und Kontakt (die Karte sah `null`); ein Speichern ohne
// Änderung schreibt dort leeren Text. Das ist für das zweite Fenster keine Änderung, ebenso wenig eine fehlende
// Zahlungsfrist gegen die Voreinstellung 30 Tage.
test('Einstellungen: leerer Text gegen fehlende Angabe und die Voreinstellung der Frist sind keine Änderung', async () => {
  const s = await startServer()
  try {
    const seen = pick(await settingsOf(s), LANDLORD)
    assert.equal(seen.landlordAddress, null)
    // Fenster A speichert, ohne etwas zu ändern: Anschrift und Kontakt stehen danach als leerer Text da.
    assert.equal((await put(s, '/api/settings', { ...seen, landlordAddress: '', landlordContact: '', paymentDeadlineDays: 30, ifUnchanged: seen })).status, 200)
    assert.equal((await settingsOf(s)).landlordAddress, '')
    // Fenster B kennt den Stand davor und ändert nur den Namen.
    const b = await put(s, '/api/settings', { ...seen, landlordName: 'Erika Muster', landlordAddress: '', landlordContact: '', paymentDeadlineDays: 30, ifUnchanged: seen })
    assert.equal(b.status, 200, String(b.body.error))
    // Eine fehlende Frist im gesehenen Stand gleicht der Voreinstellung.
    const c = await put(s, '/api/settings', { landlordContact: 'Tel. 1', ifUnchanged: { ...pick(await settingsOf(s), LANDLORD), paymentDeadlineDays: null, landlordContact: null } })
    assert.equal(c.status, 200, String(c.body.error))
  } finally {
    s.stop()
  }
})
