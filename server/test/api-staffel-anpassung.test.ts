// Integrationstests gegen den echten Server (#317): Das Anschreiben nennt den Monat der Anpassung, und „In die Staffel
// übernehmen“ setzt die angekündigte Vorauszahlung ab diesem Monat als Stufe ein, nur mit der Marke des Plans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PrepaymentStepPlan, Settlement, Tenancy, Unit } from '../../shared/types.ts'
import { type Server, jsonOf, startServerIn } from '../testing/api.ts'

const plain = (s: string | undefined): string => (s ?? '').replace(/ /g, ' ')
const send = (s: Server, url: string, method: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const start = () => startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_TEST_TODAY: '2026-03-10' })

// 600 € Grundsteuer, 12 × 40 €: Vorschlag 50 € im Monat.
async function house(s: Server) {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
  const tenancy = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 4000 }] }) })
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }) })
  return tenancy
}
const plan = (s: Server, months: Record<string, string> = {}) => s.api<PrepaymentStepPlan>('/api/settlement/2025/prepayment-steps/plan', { method: 'POST', body: JSON.stringify({ months }) })

test('#317: das Anschreiben nennt den Monat, je Mieter änderbar', async () => {
  const s = await start()
  try {
    const t = await house(s)
    let live = await s.api<Settlement>('/api/settlement/2025')
    assert.equal(live.letters?.[t.id]?.adjustment.from, '2026-05')
    assert.match(plain(live.letters?.[t.id]?.texts.adjustSuggestion), /ab Mai 2026 auf 50,00 € angepasst/)
    assert.equal((await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'suggestion', from: '2026-07' } })).status, 200)
    live = await s.api<Settlement>('/api/settlement/2025')
    assert.match(plain(live.letters?.[t.id]?.texts.adjustSuggestion), /ab Juli 2026 auf 50,00 €/)
    const bad = await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'suggestion', from: '2026-13' } })
    assert.equal(bad.status, 400)
    // Vor dem Abschluss gibt es nichts zu übernehmen.
    assert.equal((await send(s, '/api/settlement/2025/prepayment-steps/plan', 'POST', {})).status, 409)
  } finally {
    s.stop()
  }
})

test('#317: In die Staffel übernehmen, mit Marke, Rückfrage bei einer Stufe ab dem Monat', async () => {
  const s = await start()
  try {
    const t = await house(s)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', { sentAt: '2026-03-11' })).status, 201)
    let p = await plan(s)
    const it = p.items[0] ?? assert.fail('kein Eintrag')
    assert.deepEqual([it.tenancyId, it.cents, it.from, it.announcedFrom, it.currentCents, it.state, it.schedule], [t.id, 5000, '2026-05', '2026-05', 4000, 'pending', 'prepayments'])
    assert.deepEqual(it.notes, [])
    assert.deepEqual(p.errors, [])

    // Ein Monat im abgerechneten Zeitraum ist eine 400.
    assert.equal((await send(s, '/api/settlement/2025/prepayment-steps/plan', 'POST', { months: { [t.id]: '2025-12' } })).status, 400)

    // Eine Stufe ab Mai steht schon da (von Hand eingetragen): Der Plan nennt sie, eine alte Marke gilt nicht mehr.
    await s.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepayments: [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 4500 }] }) })
    const stale = await send(s, '/api/settlement/2025/prepayment-steps', 'POST', { tenancyIds: [t.id], token: p.token })
    assert.equal(stale.status, 409)
    p = (await jsonOf<{ plan: PrepaymentStepPlan }>(stale)).plan
    assert.deepEqual(p.items[0]?.existing, [{ from: '2026-05', monthlyCents: 4500 }])

    const ok = await send(s, '/api/settlement/2025/prepayment-steps', 'POST', { tenancyIds: [t.id], token: p.token })
    assert.equal(ok.status, 200)
    const after = (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)
    assert.deepEqual(after?.prepayments, [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 5000 }])
    assert.equal((await plan(s)).items[0]?.state, 'taken')

    // Ein geänderter Monat: übernommen ab Juni, der Satz nennt den Monat des Schreibens.
    const june = await plan(s, { [t.id]: '2026-06' })
    assert.match(june.items[0]?.notes.join(' ') ?? '', /Das Schreiben nennt Mai 2026, übernommen wird ab Juni 2026/)
    // Die abgeschlossene Abrechnung bleibt, wie sie ist.
    assert.deepEqual((await s.api<Settlement>('/api/settlement/2025')).deviation?.deviations, [])
  } finally {
    s.stop()
  }
})
