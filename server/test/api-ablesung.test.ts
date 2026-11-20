// Geschätzte Ablesung (#98) über die Routen: Speichern und Lesen von `estimated` mit Begründung, Teilrumpf, die
// Begründung als Pflicht (400 mit Satz) und eine Ablesung ohne Angabe wie bisher.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorFrom, jsonOf, startServer, type Server } from '../testing/api.ts'
import type { Meter, Reading } from '../../shared/types.ts'

const send = (s: Server, route: string, method: string, body?: unknown) =>
  fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const created = async <T>(res: Response): Promise<T> => {
  assert.equal(res.status, 201, await res.clone().text())
  return jsonOf<T>(res)
}
const rejected = async (res: Response, label: string): Promise<string> => {
  assert.equal(res.status, 400, `${label}: ${res.status} ${await res.clone().text()}`)
  const text = await errorFrom(res)
  assert.ok(text.length > 20 && /[.!?]$/.test(text), `${label}: kein Satz: ${text}`)
  assert.doesNotMatch(text, /constraint|SQLITE|INSERT/i, `${label}: Technik statt Satz: ${text}`)
  return text
}
const meterOf = (s: Server) =>
  send(s, '/api/meters?property=objekt-1', 'POST', { name: 'Hauptzähler', unitId: null, type: 'kaltwasser', unit: 'm³' }).then((r) => created<Meter>(r))

test('Geschätzte Ablesung: mit Begründung gespeichert und gelesen, ohne Angabe wie bisher', async () => {
  const s = await startServer()
  try {
    const m = await meterOf(s)
    const plain = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2024-12-31', value: 100 }))
    assert.equal(plain.estimated, undefined)
    assert.equal(plain.estimateReason, undefined)
    const est = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2025-12-31', value: 180, estimated: true, estimateReason: '  Schacht überflutet ' }))
    assert.equal(est.estimated, true)
    assert.equal(est.estimateReason, 'Schacht überflutet')
    const read = await s.api<Reading[]>('/api/readings?property=objekt-1')
    assert.deepEqual(read.map((x) => [x.date, x.estimated, x.estimateReason]), [['2024-12-31', undefined, undefined], ['2025-12-31', true, 'Schacht überflutet']])

    // Teilrumpf: ein anderer Stand lässt die Kennzeichnung stehen; „nicht geschätzt“ nimmt die Begründung mit.
    const changed = await jsonOf<Reading>(await send(s, `/api/readings/${est.id}`, 'PUT', { value: 181 }))
    assert.deepEqual([changed.value, changed.estimated, changed.estimateReason], [181, true, 'Schacht überflutet'])
    const off = await jsonOf<Reading>(await send(s, `/api/readings/${est.id}`, 'PUT', { estimated: false }))
    assert.deepEqual([off.estimated, off.estimateReason], [undefined, undefined])
    // Eine Begründung ohne Schätzung wird nicht gespeichert.
    const reasonOnly = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2026-12-31', value: 200, estimateReason: 'x' }))
    assert.equal(reasonOnly.estimateReason, undefined)
  } finally { s.stop() }
})

test('Geschätzte Ablesung: ohne Begründung oder mit unklarer Angabe abgelehnt, mit Satz', async () => {
  const s = await startServer()
  try {
    const m = await meterOf(s)
    for (const [label, body] of [
      ['ohne Begründung', { estimated: true }],
      ['leere Begründung', { estimated: true, estimateReason: '   ' }],
      ['kein Wahrheitswert', { estimated: 'ja', estimateReason: 'defekt' }],
    ] as const) {
      const text = await rejected(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2025-12-31', value: 1, ...body }), label)
      if (label !== 'kein Wahrheitswert') assert.match(text, /Begründung/)
    }
    assert.deepEqual(await s.api<Reading[]>('/api/readings?property=objekt-1'), [])
    // Beim Ändern ebenso: die Begründung lässt sich nicht leeren, solange geschätzt ist.
    const est = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2025-12-31', value: 1, estimated: true, estimateReason: 'defekt' }))
    await rejected(await send(s, `/api/readings/${est.id}`, 'PUT', { estimateReason: '' }), 'Begründung geleert')
  } finally { s.stop() }
})

// „Ablesung bearbeiten“ auf der Seite Zähler schickt den ganzen Rumpf, Abgewähltes ausdrücklich (`false`, `null`):
// Der Server nimmt ihn an und räumt Wechsel, Endstand, Hinweis und Schätzung wirklich ab. Das Eichjahr des neuen
// Zählers bietet das Fenster beim Bearbeiten nicht an, denn im PUT ist es eine 400.
test('Ablesung bearbeiten: der Rumpf der Oberfläche wird angenommen, Abgewähltes ist danach weg', async () => {
  const s = await startServer()
  try {
    const m = await meterOf(s)
    const full = { date: '2025-06-30', value: 5, replacement: true, oldEndValue: 980, note: 'Tausch', estimated: true, estimateReason: 'defekt' }
    const r = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, ...full }))
    const same = await send(s, `/api/readings/${r.id}`, 'PUT', full)
    assert.equal(same.status, 200, await same.clone().text())
    assert.deepEqual(await jsonOf<Reading>(same), r)
    // Abgewählt geht als `null` hinaus (ein weggelassenes Feld bliebe stehen): Die Ablesung ist danach, was eine
    // frisch angelegte ohne diese Angaben ist, ohne ein gespeichertes `replacement: false`.
    const res = await send(s, `/api/readings/${r.id}`, 'PUT', { date: '2025-07-01', value: 985.5, replacement: null, oldEndValue: null, note: null, estimated: false })
    assert.equal(res.status, 200, await res.clone().text())
    const fresh = await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date: '2025-07-01', value: 985.5 }))
    const list = await s.api<Reading[]>('/api/readings?property=objekt-1')
    const stored = list.find((x) => x.id === r.id)
    const plain = list.find((x) => x.id === fresh.id)
    if (!stored || !plain) assert.fail('eine Ablesung fehlt nach dem Ändern')
    assert.deepEqual(stored, { ...plain, id: r.id })
    await rejected(await send(s, `/api/readings/${r.id}`, 'PUT', { value: 1, newCalibratedUntil: 2031 }), 'Eichjahr im PUT')
  } finally { s.stop() }
})

// Systemprüfung: Das Einbaudatum nimmt der Server bei jedem Zähler an (nicht nur bei fernablesbaren Geräten), und die
// Verbrauchsübersicht verlangt Ablesungen dann erst ab dem Einbau.
test('Einbaudatum an einem Wasserzähler: gespeichert, und der Zeitraum gilt ab dem Einbau als gedeckt', async () => {
  const s = await startServer()
  try {
    const m = await meterOf(s)
    for (const [date, value] of [['2025-06-30', 0], ['2025-12-31', 40]] as const) await created<Reading>(await send(s, '/api/readings', 'POST', { meterId: m.id, date, value }))
    type Row = { meterId: string, periodCovered: boolean, periodGap: { from: string, to: string } | null }
    const rowOf = async (): Promise<Row> => (await jsonOf<Row[]>(await send(s, '/api/consumption/2025?property=objekt-1', 'GET'))).find((r) => r.meterId === m.id) ?? assert.fail('Zähler fehlt in der Übersicht')
    assert.deepEqual((await rowOf()).periodGap, { from: '2025-01-01', to: '2025-06-30' })
    const put = await send(s, `/api/meters/${m.id}`, 'PUT', { name: 'Hauptzähler', unitId: null, type: 'kaltwasser', unit: 'm³', installedOn: '2025-06-30' })
    assert.equal(put.status, 200, await put.clone().text())
    assert.equal((await jsonOf<Meter>(put)).installedOn, '2025-06-30')
    assert.equal((await rowOf()).periodCovered, true)
    await rejected(await send(s, `/api/meters/${m.id}`, 'PUT', { name: 'Hauptzähler', unitId: null, type: 'kaltwasser', unit: 'm³', installedOn: 'gestern' }), 'kein Datum')
  } finally {
    s.stop()
  }
})
