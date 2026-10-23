// Integrationstests gegen den echten Server: das Anschreiben zur Abrechnung (#415). Die Ebenen
// (Vorgabe, Installation, Objekt, Mieter), die Prüfung der Platzhalter, das Einfrieren mit dem
// Abschluss und die Abrechnungen, die vor #415 abgeschlossen wurden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import type { HeatingPlant, LetterTemplates, Settlement, StatementLetter, TenancyLetter, Tenancy, Unit } from '../../shared/types.ts'
import { DEFAULT_LETTER_TEXTS } from '../../shared/letter.ts'
import { closedHeatingSettlements, closedSettlements } from '../src/db/schema.ts'
import { type Server, inDatabase, jsonOf, restore, startServer } from '../testing/api.ts'

const plain = (s: string | undefined): string => (s ?? '').replace(/ /g, ' ')
const send = (s: Server, url: string, method: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const letterOf = (st: Settlement, tenancyId: string): StatementLetter => st.letters?.[tenancyId] ?? assert.fail(`kein Anschreiben für ${tenancyId}`)

// Ein Haus mit einem Mieter, dessen Vorauszahlungen die Kosten nicht decken: 600 € Grundsteuer, 12 × 40 €.
async function house(s: Server) {
  await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Max Vermieter', iban: 'DE02120300000000202051', paymentDeadlineDays: 14 }) })
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
  const tenancy = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 4000 }] }) })
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }) })
  return { unit, tenancy }
}

test('Anschreiben (#415): Vorgaben mit eingesetzten Werten, Ebenen und je Mieter', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await house(s)
    const live = await s.api<Settlement>('/api/settlement/2025')
    const l = letterOf(live, tenancy.id)
    assert.equal(plain(l.texts.backPayment), 'Es ergibt sich eine Nachzahlung von 120,00 €. Bitte überweisen Sie den Betrag innerhalb von 14 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter).')
    assert.equal(l.texts.salutation, 'Guten Tag Erika Mustermann,')
    assert.equal(l.texts.subject, 'Nebenkostenabrechnung 2025, Wohnung EG')
    assert.equal(plain(l.values.VorauszahlungBisher), '40,00 €')
    // Vorgabe der Einstellungen wie der frühere Schalter: Vorschlag ankündigen.
    assert.equal(l.adjustment.mode, 'suggestion')
    assert.equal(l.adjustment.newCents, 5000)
    assert.match(plain(l.texts.adjustSuggestion), /auf 50,00 € angepasst/)

    const templates = await s.api<LetterTemplates>(`/api/letter-texts?property=${(await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? ''}`)
    assert.deepEqual(templates.defaults, DEFAULT_LETTER_TEXTS)
    assert.deepEqual(templates.installation, {})
    assert.deepEqual(templates.property, {})
    assert.equal(templates.adjustDefault, 'suggestion')

    // Ein unbekannter Platzhalter ist auf jeder Ebene eine 400, und nichts wird gespeichert.
    const propertyId = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    for (const [url, method] of [['/api/letter-texts', 'PUT'], [`/api/properties/${propertyId}/letter-texts`, 'PUT'], [`/api/settlement/2025/letters/${tenancy.id}`, 'PUT']] as const) {
      const res = await send(s, url, method, { texts: { greeting: 'Gruß {Nam}' } })
      assert.equal(res.status, 400, url)
      assert.match((await jsonOf<{ error: string }>(res)).error, /Gruß.*\{Nam\}/, url)
    }
    assert.equal(letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id).texts.greeting, 'Mit freundlichen Grüßen')

    // Installation, darüber das Objekt, darüber der Mieter.
    assert.equal((await send(s, '/api/letter-texts', 'PUT', { texts: { greeting: 'Viele Grüße', closing: 'Danke, {Name}.' } })).status, 200)
    assert.equal((await send(s, `/api/properties/${propertyId}/letter-texts`, 'PUT', { texts: { greeting: 'Herzliche Grüße' } })).status, 200)
    let now = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    assert.equal(now.texts.greeting, 'Herzliche Grüße')
    assert.equal(now.texts.closing, 'Danke, Erika Mustermann.')
    assert.equal((await send(s, `/api/settlement/2025/letters/${tenancy.id}`, 'PUT', { texts: { greeting: 'Bis bald' }, adjustment: { mode: 'custom', cents: 6000 } })).status, 200)
    now = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    assert.equal(now.texts.greeting, 'Bis bald')
    assert.deepEqual(now.adjustment, { mode: 'custom', newCents: 6000 })
    assert.match(plain(now.texts.adjustCustom), /auf 60,00 € angepasst\.$/)
    assert.deepEqual(await s.api<Record<string, TenancyLetter>>('/api/settlement/2025/letters'), { [tenancy.id]: { texts: { greeting: 'Bis bald' }, adjustment: { mode: 'custom', cents: 6000 } } })
    // `null` nimmt die eigene Angabe weg; die Ebene darüber gilt wieder.
    assert.equal((await send(s, `/api/settlement/2025/letters/${tenancy.id}`, 'PUT', { texts: { greeting: null }, adjustment: null })).status, 200)
    now = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    assert.equal(now.texts.greeting, 'Herzliche Grüße')
    assert.equal(now.adjustment.mode, 'suggestion')

    // Die Vorgabe der Anpassung steht in den Einstellungen (früher `printAdjustSuggestion`).
    assert.equal((await send(s, '/api/letter-texts', 'PUT', { texts: {}, adjustDefault: 'none' })).status, 200)
    assert.equal((await s.api<{ printAdjustSuggestion?: boolean }>('/api/settings')).printAdjustSuggestion, false)
    assert.deepEqual(letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id).adjustment, { mode: 'none', newCents: null })
    assert.equal((await send(s, '/api/letter-texts', 'PUT', { texts: {}, adjustDefault: 'immer' })).status, 400)

    // Ein Mietverhältnis eines anderen Objekts nimmt die Route nicht an.
    assert.equal((await send(s, '/api/settlement/2025/letters/gibt-es-nicht', 'PUT', { texts: {} })).status, 404)
  } finally {
    s.stop()
  }
})

test('Anschreiben (#415): friert mit dem Abschluss ein; spätere Vorlagen ändern es nicht', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await house(s)
    await send(s, '/api/letter-texts', 'PUT', { texts: { greeting: 'Viele Grüße' } })
    await send(s, `/api/settlement/2025/letters/${tenancy.id}`, 'PUT', { texts: {}, adjustment: { mode: 'custom', cents: 5500 } })
    const before = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', {})).status, 201)

    await send(s, '/api/letter-texts', 'PUT', { texts: { greeting: 'Ganz anders', intro: 'Neu' } })
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ iban: '' }) })
    const closed = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual(letterOf(closed, tenancy.id), before, 'der eingefrorene Text bleibt')
    // Je Mieter lässt sich nach dem Abschluss nichts mehr ändern.
    assert.equal((await send(s, `/api/settlement/2025/letters/${tenancy.id}`, 'PUT', { texts: { greeting: 'X' } })).status, 409)

    // Wieder geöffnet gilt die laufende Vorlage, die eigene Wahl des Mieters bleibt.
    assert.equal((await send(s, '/api/settlement/2025/close', 'DELETE')).status, 200)
    const open = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    assert.equal(open.texts.greeting, 'Ganz anders')
    assert.equal(open.adjustment.newCents, 5500)
  } finally {
    s.stop()
  }
})

test('Anschreiben (#415): eine vor #415 abgeschlossene Abrechnung bekommt kein Anschreiben, sie druckt wie bisher (Durchsicht S1)', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await house(s)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', {})).status, 201)
    // So sieht ein Stand aus, den eine ältere Version eingefroren hat: ohne Anschreiben.
    await inDatabase(s, async (db) => {
      const [row] = await db.select().from(closedSettlements)
      if (!row) return assert.fail('kein Abschluss')
      const stand: unknown = row.settlement
      if (stand === null || typeof stand !== 'object') return assert.fail('kein eingefrorener Stand')
      assert.ok('letters' in stand, 'Vorbedingung: der Abschluss hat das Anschreiben eingefroren')
      await db.update(closedSettlements).set({ settlement: { ...stand, letters: undefined } }).where(eq(closedSettlements.id, row.id))
    })
    await send(s, '/api/letter-texts', 'PUT', { texts: { backPayment: 'Zahlen Sie {Betrag}.' } })
    const closed = await s.api<Settlement>('/api/settlement/2025')
    assert.notEqual(closed.closed, null)
    // Was zugestellt wurde, ändert eine Programmänderung nicht rückwirkend: kein Anschreiben, die Seite druckt den alten Aufbau.
    assert.equal(closed.letters, undefined)
    assert.equal(closed.statements[0]?.tenancyId, tenancy.id)
  } finally {
    s.stop()
  }
})

test('Anschreiben (#415): Backup und Wiederherstellen bringen alle Ebenen mit', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await house(s)
    const propertyId = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    await send(s, '/api/letter-texts', 'PUT', { texts: { greeting: 'Viele Grüße' }, adjustDefault: 'none' })
    await send(s, `/api/properties/${propertyId}/letter-texts`, 'PUT', { texts: { closing: 'Danke.' } })
    await send(s, `/api/settlement/2025/letters/${tenancy.id}`, 'PUT', { texts: { salutation: 'Hallo {Name},' }, adjustment: { mode: 'custom', cents: 7000 } })
    const before = letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id)
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const fresh = await startServer()
    try {
      // Vorher die Vorgaben: Eine frische Einrichtung hat keine eigenen Texte.
      assert.deepEqual((await fresh.api<LetterTemplates>('/api/letter-texts')).installation, {})
      const r = await restore(fresh, zip)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(letterOf(await fresh.api<Settlement>('/api/settlement/2025'), tenancy.id), before)
      assert.equal((await fresh.api<LetterTemplates>('/api/letter-texts')).adjustDefault, 'none')
    } finally {
      fresh.stop()
    }
  } finally {
    s.stop()
  }
})

// Durchsicht S5: Die getrennte Heizkostenabrechnung (Weg d) hat ihr eigenes Anschreiben, eigene Anpassungen je
// Mieter (`doc` mit Anlage und Heizperiode), friert es mit ihrem Abschluss ein und sperrt danach.
test('Anschreiben (#415): getrennte Heizkostenabrechnung mit eigenem Anschreiben, Einfrieren und Sperre', async () => {
  const s = await startServer()
  try {
    const { tenancy } = await house(s)
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send(s, '/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const marke = async (url: string, body: unknown) => (await jsonOf<{ token: string }>(await send(s, url, 'POST', body))).token
    const regeln = { startMonth: 5, changes: [] }
    await send(s, `/api/heating-plants/${plant.id}/period`, 'PUT', { rules: regeln, answers: { understood: true, token: await marke(`/api/heating-plants/${plant.id}/period/preview`, { rules: regeln }) } })
    const getrennt = { separate: true, month: '2025-05' }
    const vorschau = await jsonOf<{ token: string; steps: { tenancyId: string; rows: { from: string }[] }[] }>(await send(s, `/api/heating-plants/${plant.id}/separate/preview`, 'POST', getrennt))
    const stufen = Object.fromEntries(vorschau.steps.map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((r) => [r.from, 2000]))]))
    assert.equal((await send(s, `/api/heating-plants/${plant.id}/separate`, 'PUT', { ...getrennt, answers: { understood: true, steps: stufen, token: vorschau.token } })).status, 200)
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 }) })
    const url = `/api/heating-settlement/${plant.id}/2025-05`

    assert.match(letterOf(await s.api<Settlement>(url), tenancy.id).texts.subject, /^Heizkostenabrechnung/)
    assert.equal((await send(s, `${url}/letters/${tenancy.id}`, 'PUT', { texts: { greeting: 'Warme Grüße' } })).status, 200)
    assert.deepEqual(await s.api<Record<string, TenancyLetter>>(`${url}/letters`), { [tenancy.id]: { texts: { greeting: 'Warme Grüße' }, adjustment: null } })
    // Eigener Schlüssel: Die Betriebskostenabrechnung desselben Mieters bleibt bei der Vorlage.
    assert.deepEqual(await s.api<Record<string, TenancyLetter>>('/api/settlement/2025/letters'), {})
    assert.equal(letterOf(await s.api<Settlement>('/api/settlement/2025'), tenancy.id).texts.greeting, 'Mit freundlichen Grüßen')

    let closing = await send(s, `${url}/close`, 'POST', {})
    if (closing.status === 409) closing = await send(s, `${url}/close`, 'POST', { despiteErrors: (await jsonOf<{ errorToken?: string }>(closing)).errorToken })
    assert.equal(closing.status, 201)
    await send(s, '/api/letter-texts', 'PUT', { texts: { greeting: 'Später geändert' } })
    assert.equal(letterOf(await s.api<Settlement>(url), tenancy.id).texts.greeting, 'Warme Grüße', 'eingefroren')
    assert.equal((await send(s, `${url}/letters/${tenancy.id}`, 'PUT', { texts: { greeting: 'X' } })).status, 409)

    // Ein Stand von vor #415 hat kein Anschreiben und bekommt keines.
    await inDatabase(s, async (db) => {
      const [row] = await db.select().from(closedHeatingSettlements)
      if (!row) return assert.fail('kein Abschluss')
      const stand: unknown = row.settlement
      if (stand === null || typeof stand !== 'object') return assert.fail('kein eingefrorener Stand')
      await db.update(closedHeatingSettlements).set({ settlement: { ...stand, letters: undefined } }).where(eq(closedHeatingSettlements.id, row.id))
    })
    assert.equal((await s.api<Settlement>(url)).letters, undefined)
  } finally {
    s.stop()
  }
})
