// Integrationstests gegen den echten Server: Abschließen einer Abrechnung mit Hinweisen der Stufe
// `error` nur nach Bestätigung (#319), für die Abrechnung des Objekts und die Heizkostenabrechnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, FuelDelivery, FuelGapQuestion, HeatingPlant, Notice, Settlement, Unit } from '../../shared/types.ts'
import { type Server, jsonOf, startServer } from '../testing/api.ts'

type Question = { error: string; errorNotices?: Notice[]; errorToken?: string; fuelGaps?: FuelGapQuestion[] }

const sender = (s: Server) => (url: string, method: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

// Zwei Mietverhältnisse einer Wohnung, die sich im Juli überschneiden: `tenancy.overlap`, Stufe `error`.
async function overlapping(s: Server, unitId: string) {
  await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId, tenantName: 'A', persons: 1, start: '2024-01-01', end: '2025-07-31', prepayments: [{ from: '2024-01', monthlyCents: 10000 }] }) })
  await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId, tenantName: 'B', persons: 1, start: '2025-07-01', end: null, prepayments: [{ from: '2025-07', monthlyCents: 10000 }] }) })
}

test('Abschließen (#319): Fehler fragen nach, Bestätigung schließt ab, ein Tab ohne Bestätigung schließt nicht still ab', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    await overlapping(s, unit.id)
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' }) })
    const live = await s.api<Settlement>('/api/settlement/2025')
    assert.ok((live.notices ?? []).some((n) => n.code === 'tenancy.overlap' && n.level === 'error'), 'Vorbedingung: ein Fehler in der Abrechnung')

    // Wie ein Tab von vor dem Update: ohne Bestätigung.
    const gefragt = await send('/api/settlement/2025/close', 'POST', {})
    assert.equal(gefragt.status, 409)
    const body = await jsonOf<Question>(gefragt)
    assert.match(body.error, /Fehler/)
    assert.match(body.error, /Mietverhältnisse überschneiden sich/)
    assert.equal(body.fuelGaps, undefined, 'ohne Lücke keine Liste, sonst fragte ein alter Tab nach einer Schätzung')
    const overlap = body.errorNotices?.find((n) => n.code === 'tenancy.overlap')
    assert.ok(overlap, 'die Liste nennt den Fehler')
    assert.equal(overlap.title, 'Mietverhältnisse überschneiden sich')
    assert.ok(overlap.text.length > 0)
    assert.equal(overlap.subject?.kind, 'tenancy')
    assert.ok((body.errorNotices ?? []).every((n) => n.level === 'error'))
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).closed, null, 'nichts eingefroren')

    assert.equal((await send('/api/settlement/2025/close', 'POST', { despiteErrors: 'ja' })).status, 409, 'eine fremde Marke bestätigt nichts')
    assert.equal((await send('/api/settlement/2025/close', 'POST', { despiteErrors: true })).status, 400, 'eine Bestätigung ohne Marke gibt es nicht')
    const markeA = body.errorToken ?? assert.fail('keine Prüfmarke')

    // S1: Kommt zwischen Rückfrage und Bestätigung ein Fehler dazu, gilt die Bestätigung nicht.
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Gartenpflege', description: 'Garten', amountCents: 10000, key: 'custom', customShares: { [unit.id]: 150 } }) })
    const neu = await send('/api/settlement/2025/close', 'POST', { despiteErrors: markeA })
    assert.equal(neu.status, 409)
    const neuBody = await jsonOf<Question>(neu)
    assert.ok(neuBody.errorNotices?.some((n) => n.code === 'custom.over-100'), 'die neue Liste nennt den neuen Fehler')
    assert.notEqual(neuBody.errorToken, markeA)
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).closed, null)

    assert.equal((await send('/api/settlement/2025/close', 'POST', { despiteErrors: neuBody.errorToken })).status, 201)
    assert.notEqual((await s.api<Settlement>('/api/settlement/2025')).closed, null)
  } finally {
    s.stop()
  }
})

test('Abschließen (#319): Hinweise der Stufe warning und hint brauchen keine Bestätigung', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    // Eine Wohnung ohne Fläche beim Flächenschlüssel: `basis.unit-no-area`, Stufe `warning`.
    const ohneFlaeche = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'OG', areaM2: 0, participates: true }) })
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    for (const [u, name] of [[unit.id, 'A'], [ohneFlaeche.id, 'B']] as const) {
      await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: u, tenantName: name, persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 10000 }] }) })
    }
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' }) })
    const live = await s.api<Settlement>('/api/settlement/2025')
    assert.ok((live.notices ?? []).some((n) => n.level === 'warning'), 'Vorbedingung: eine Warnung')
    assert.ok(!(live.notices ?? []).some((n) => n.level === 'error'), 'Vorbedingung: kein Fehler')
    assert.equal((await send('/api/settlement/2025/close', 'POST', {})).status, 201)
  } finally {
    s.stop()
  }
})

test('Abschließen der Heizkostenabrechnung (#319): Fehler fragen nach, Bestätigung schließt ab', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    await overlapping(s, unit.id)
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const marke = async (url: string, body: unknown) => (await jsonOf<{ token: string }>(await send(url, 'POST', body))).token
    const regeln = { startMonth: 5, changes: [] }
    await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: regeln, answers: { understood: true, token: await marke(`/api/heating-plants/${plant.id}/period/preview`, { rules: regeln }) } })
    const getrennt = { separate: true, month: '2025-05' }
    const vorschau = await jsonOf<{ token: string; steps: { tenancyId: string; rows: { from: string }[] }[] }>(await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', getrennt))
    const stufen = Object.fromEntries(vorschau.steps.map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((r) => [r.from, 5000]))]))
    const ein = await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { ...getrennt, answers: { understood: true, steps: stufen, token: vorschau.token } })
    assert.equal(ein.status, 200)
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 }) })
    const url = `/api/heating-settlement/${plant.id}/2025-05`
    const live = await s.api<Settlement>(url)
    assert.ok((live.notices ?? []).some((n) => n.level === 'error'), 'Vorbedingung: ein Fehler in der Heizkostenabrechnung')

    const gefragt = await send(`${url}/close`, 'POST', {})
    assert.equal(gefragt.status, 409)
    const body = await jsonOf<Question>(gefragt)
    assert.ok((body.errorNotices ?? []).length > 0)
    assert.ok((body.errorNotices ?? []).every((n) => n.level === 'error'))
    assert.equal((await s.api<Settlement>(url)).closed, null)
    assert.equal((await send(`${url}/close`, 'POST', { despiteErrors: body.errorToken })).status, 201)
    assert.notEqual((await s.api<Settlement>(url)).closed, null)
  } finally {
    s.stop()
  }
})

test('Abschließen (#319): Lücke und Fehler in einer Rückfrage; eine Schätzung ohne Bestätigung fällt zurück', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    await overlapping(s, unit.id)
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'manual' }))
    // Die Rechnung reicht bis Ende Juni; für das zweite Halbjahr fehlt sie.
    const d = await jsonOf<FuelDelivery>(await send(`/api/heating-plants/${plant.id}/deliveries`, 'POST', { label: 'Gas 1. Halbjahr', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30' }))
    await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area', heatingPlantId: plant.id, fuelDeliveryId: d.id }) })

    const gefragt = await send('/api/settlement/2025/close', 'POST', {})
    assert.equal(gefragt.status, 409)
    const body = await jsonOf<Question>(gefragt)
    assert.equal(body.fuelGaps?.length, 1, 'die Lücke')
    assert.ok(body.errorNotices?.some((n) => n.code === 'tenancy.overlap'), 'und der Fehler in derselben Antwort')
    assert.match(body.error, /fehlt eine Rechnung/)
    assert.match(body.error, /Fehler/)

    // Ein Tab von vor dem Update beantwortet nur die Lücke: Es bleibt bei der Rückfrage, und die Schätzung fällt zurück.
    const nurLuecke = await send('/api/settlement/2025/close', 'POST', { fuelEstimates: 'estimate' })
    assert.equal(nurLuecke.status, 409)
    const zweite = await jsonOf<Question>(nurLuecke)
    assert.equal(zweite.fuelGaps, undefined)
    assert.ok((zweite.errorNotices ?? []).length > 0)
    assert.ok(!(await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)).some((x) => x.estimated), 'keine Schätzung ohne Abschluss')
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).closed, null)

    assert.equal((await send('/api/settlement/2025/close', 'POST', { fuelEstimates: 'estimate', despiteErrors: zweite.errorToken })).status, 201)
    assert.ok((await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)).some((x) => x.estimated))
  } finally {
    s.stop()
  }
})
