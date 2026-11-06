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
