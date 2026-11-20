// Prüfungen beim Speichern über die Sammelrouten: Auszug vor Einzug, ungültige Datumsangaben, Sätze für Laien statt
// eines Befunds der Datenbank. Überall dasselbe Muster wie bei der IBAN (#279): Abgelehnt wird nur eine neu gesetzte
// oder geänderte Angabe; was krumm im Bestand steht (Wiederherstellen, Umstieg), bleibt speicherbar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Meter, Payment, Reading, Tenancy, Unit } from '../../shared/types.ts'
import { besideServer, jsonOf, startServer, type Server } from '../testing/api.ts'

type Answer = { status: number, error: string }

const send = async (s: Server, method: 'POST' | 'PUT', route: string, body: unknown): Promise<Answer> => {
  const res = await fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await jsonOf<{ error?: string }>(res)
  return { status: res.status, error: json.error ?? '' }
}

const refused = (answer: Answer, sentence: RegExp): void => {
  assert.equal(answer.status, 400, answer.error)
  assert.match(answer.error, sentence)
  assert.doesNotMatch(answer.error, /Technischer Befund|constraint|Invalid time/)
}

const post = <T>(s: Server, route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })

const tenancyBody = (unitId: string, more: Record<string, unknown> = {}) => ({
  unitId, tenantName: 'A', persons: 1, start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 60000 }],
  ...more,
})

// Schreibt an den Routen vorbei in den Bestand, wie ihn ein altes Backup oder der Umstieg mitbringen kann.
const directly = async (s: Server, sql: string): Promise<void> => {
  const c = await besideServer(s.dataDir)
  try {
    c.exec(sql)
  } finally {
    c.close()
  }
}

test('Mietverhältnis: Auszug vor Einzug wird abgelehnt, beim Anlegen und beim Ändern', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { start: '2025-06-01', end: '2025-03-31' })), /Auszug.*vor dem Einzug/)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 0)

    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id, { start: '2025-06-01' }))
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '2025-03-31' }), /Auszug.*vor dem Einzug/)
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '2025-12-31', start: '2026-01-01' }), /Auszug.*vor dem Einzug/)
    // Am selben Tag ein- und ausgezogen ist ein Tag Mietzeit und bleibt erlaubt.
    const einTag = await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '2025-06-01' })
    assert.equal(einTag.status, 200, einTag.error)
  } finally {
    s.stop()
  }
})

test('Mietverhältnis: ein schon gespeicherter Auszug vor dem Einzug hindert das Speichern anderer Angaben nicht', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id, { start: '2025-06-01' }))
    await directly(s, `UPDATE tenancies SET "end" = '2025-03-31' WHERE id = '${t.id}'`)

    // Die Seite schickt beide Daten unverändert mit.
    const res = await send(s, 'PUT', `/api/tenancies/${t.id}`, { phone: '030 1234', start: '2025-06-01', end: '2025-03-31' })
    assert.equal(res.status, 200, res.error)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies'))[0]?.phone, '030 1234')
    // Wer eines der beiden Daten anfasst, muss es richtig machen.
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '2025-04-30' }), /Auszug.*vor dem Einzug/)
  } finally {
    s.stop()
  }
})

test('Ungültige Datumsangaben werden mit einem Satz abgelehnt: Einzug, Auszug, Vertrag, Zahlung, Ablesung, Zähler', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { start: '' })), /Einzug fehlt/)
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { start: '2025-02-31' })), /Einzug.*kein Datum/)
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { end: 'bald' })), /Auszug.*kein Datum/)
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { contractDate: '1.1.2025' })), /Vertragsdatum.*kein Datum/)
    // Ohne den Schlüssel `start` beginnt ein neues Mietverhältnis ebenso leer.
    refused(await send(s, 'POST', '/api/tenancies', { unitId: eg.id, tenantName: 'B' }), /Einzug fehlt/)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 0)

    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id))
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { start: '' }), /Einzug fehlt/)
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '2025-13-01' }), /Auszug.*kein Datum/)
    // Ein leerer Auszug heißt wie `null`: das Mietverhältnis läuft.
    const offen = await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: '' })
    assert.equal(offen.status, 200, offen.error)

    refused(await send(s, 'POST', '/api/payments', { tenancyId: t.id, date: 'irgendwann', amountCents: 100 }), /Zahlung.*kein Datum/)
    refused(await send(s, 'POST', '/api/payments', { tenancyId: t.id, amountCents: 100 }), /Datum der Zahlung fehlt/)
    const p = await post<Payment>(s, '/api/payments', { tenancyId: t.id, date: '2025-01-03', amountCents: 100 })
    refused(await send(s, 'PUT', `/api/payments/${p.id}`, { date: '2025-02-30' }), /Zahlung.*kein Datum/)

    const m = await post<Meter>(s, '/api/meters', { name: 'Wasser EG', unitId: eg.id, type: 'kaltwasser', unit: 'm³' })
    refused(await send(s, 'POST', '/api/readings', { meterId: m.id, date: 'gestern', value: 1 }), /Ablesung.*kein Datum/)
    const r = await post<Reading>(s, '/api/readings', { meterId: m.id, date: '2025-01-01', value: 1 })
    refused(await send(s, 'PUT', `/api/readings/${r.id}`, { date: '' }), /Datum der Ablesung fehlt/)
    refused(await send(s, 'PUT', `/api/meters/${m.id}`, { installedOn: 'neulich' }), /eingebaut.*kein Datum/i)
    assert.equal((await s.api<Reading[]>('/api/readings')).length, 1)
    assert.equal((await s.api<Payment[]>('/api/payments')).length, 1)
  } finally {
    s.stop()
  }
})

test('Ungültige Datumsangaben: was so im Bestand steht und unverändert mitkommt, hindert das Speichern nicht', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id))
    const p = await post<Payment>(s, '/api/payments', { tenancyId: t.id, date: '2025-01-03', amountCents: 100 })
    const m = await post<Meter>(s, '/api/meters', { name: 'Wasser EG', unitId: eg.id, type: 'kaltwasser', unit: 'm³' })
    const r = await post<Reading>(s, '/api/readings', { meterId: m.id, date: '2025-01-01', value: 1 })
    await directly(s, `UPDATE tenancies SET contract_date = 'Januar 2025' WHERE id = '${t.id}'`)
    await directly(s, `UPDATE payments SET date = '3.1.2025' WHERE id = '${p.id}'`)
    await directly(s, `UPDATE readings SET date = '1.1.2025' WHERE id = '${r.id}'`)
    await directly(s, `UPDATE meters SET installed_on = 'neulich' WHERE id = '${m.id}'`)

    for (const res of [
      await send(s, 'PUT', `/api/tenancies/${t.id}`, { contractDate: 'Januar 2025', phone: '030 1234' }),
      await send(s, 'PUT', `/api/payments/${p.id}`, { date: '3.1.2025', note: 'bar' }),
      await send(s, 'PUT', `/api/readings/${r.id}`, { date: '1.1.2025', note: 'Keller' }),
      // Durchsicht, Sollte 2: Die ältere, unbedingte Prüfung des Einbautags lehnte beides ab.
      await send(s, 'PUT', `/api/meters/${m.id}`, { name: 'Wasser Keller' }),
      await send(s, 'PUT', `/api/meters/${m.id}`, { installedOn: 'neulich', name: 'Wasser EG' }),
    ]) assert.equal(res.status, 200, res.error)
  } finally {
    s.stop()
  }
})

test('Häufige Fehleingaben bekommen einen Satz für Laien statt eines Befunds der Datenbank', async () => {
  const s = await startServer()
  try {
    refused(await send(s, 'POST', '/api/units', { name: 'EG', areaM2: -5, participates: true }), /Wohnfläche.*negativ/)
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    refused(await send(s, 'PUT', `/api/units/${eg.id}`, { areaM2: -1 }), /Wohnfläche.*negativ/)

    refused(await send(s, 'POST', '/api/tenancies', tenancyBody('gibt-es-nicht')), /Wohnung.*gibt es nicht/)
    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id))
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { unitId: 'gibt-es-nicht' }), /Wohnung.*gibt es nicht/)
    refused(await send(s, 'POST', '/api/payments', { tenancyId: 'gibt-es-nicht', date: '2025-01-03', amountCents: 100 }), /Mietverhältnis.*gibt es nicht/)
    refused(await send(s, 'POST', '/api/readings', { meterId: 'gibt-es-nicht', date: '2025-01-01', value: 1 }), /Zähler.*gibt es nicht/)
  } finally {
    s.stop()
  }
})

test('Datumsangaben: eine Angabe falscher Art und ein Jahr außerhalb von 1900 bis 2100 werden mit Satz abgelehnt', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { start: 20250101 })), /Einzug ist kein Datum/)
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { end: 5 })), /Auszug ist kein Datum/)
    refused(await send(s, 'POST', '/api/tenancies', tenancyBody(eg.id, { start: '0000-01-01' })), /Einzug.*1900 bis 2100/)
    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id))
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { end: false }), /Auszug ist kein Datum/)
    refused(await send(s, 'PUT', `/api/tenancies/${t.id}`, { contractDate: 2025 }), /Vertragsdatum ist kein Datum/)
    refused(await send(s, 'POST', '/api/payments', { tenancyId: t.id, date: '2200-12-31', amountCents: 100 }), /Zahlung.*1900 bis 2100/)
    refused(await send(s, 'POST', '/api/payments', { tenancyId: t.id, date: 20250103, amountCents: 100 }), /Datum der Zahlung ist kein Datum/)
    const m = await post<Meter>(s, '/api/meters', { name: 'Wasser EG', unitId: eg.id, type: 'kaltwasser', unit: 'm³' })
    refused(await send(s, 'POST', '/api/readings', { meterId: m.id, date: 20250101, value: 1 }), /Datum der Ablesung ist kein Datum/)
    refused(await send(s, 'PUT', `/api/meters/${m.id}`, { installedOn: 2020 }), /eingebaut.*kein Datum/)
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1)
  } finally {
    s.stop()
  }
})

// Durchsicht, Sollte 4: Die Berechnung rät keinen Einzug und fängt nichts auf; die Routen sagen aber vorher, welches
// Mietverhältnis es ist, statt mit 500 „Invalid time value“ zu antworten.
test('Leerer Einzug im Bestand: die Rechnungen des Objekts nennen das Mietverhältnis mit einem Satz, die Stammdaten bleiben erreichbar', async () => {
  const s = await startServer()
  try {
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const t = await post<Tenancy>(s, '/api/tenancies', tenancyBody(eg.id, { tenantName: 'Familie Krumm' }))
    await directly(s, `UPDATE tenancies SET start = '' WHERE id = '${t.id}'`)
    for (const route of ['/api/settlement/2025', '/api/rentledger/2025', '/api/taxreport/2025', '/api/consumption/2025', '/api/upcoming']) {
      const res = await fetch(`${s.base}${route}`)
      const body = await jsonOf<{ error?: string }>(res)
      assert.equal(res.status, 409, `${route}: ${body.error ?? ''}`)
      assert.match(body.error ?? '', /^Beim Mietverhältnis „Familie Krumm“ \(Wohnung „EG“\) fehlt der Einzug oder er ist kein Datum\. Tragen Sie ihn in den Stammdaten ein/, route)
    }
    assert.equal((await s.api<Tenancy[]>('/api/tenancies')).length, 1)
    assert.equal((await s.api<Unit[]>('/api/units')).length, 1)
    const fixed = await send(s, 'PUT', `/api/tenancies/${t.id}`, { start: '2025-01-01' })
    assert.equal(fixed.status, 200, fixed.error)
    assert.equal((await fetch(`${s.base}/api/settlement/2025`)).status, 200)
  } finally {
    s.stop()
  }
})
