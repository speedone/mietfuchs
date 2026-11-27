// #712, gegen den echten Server: Die zweite Vorauszahlung deckt auf Wunsch auch Wasser/Abwasser. Die Angabe steht an der
// Heizanlage, ändert keine Summe, nur den Teil des Vorschlags und den Wortlaut; eine abgeschlossene Abrechnung behält ihren
// Wortlaut, wenn die Angabe später geändert wird, und Backup und Wiederherstellen tragen die Angabe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HeatingPlant, PrepaymentStepPlan, Settlement, Tenancy, Unit } from '../../shared/types.ts'
import { type Server, jsonOf, restore, startServerIn } from '../testing/api.ts'
import type { SettlementExport } from '../src/settlementExport.ts'

const plain = (s: string | undefined): string => (s ?? '').replace(/[\u00a0\u202f]/g, ' ')
const send = (s: Server, url: string, method: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const start = () => startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_TEST_TODAY: '2026-03-10' })
const plan = (s: Server) => s.api<PrepaymentStepPlan>('/api/settlement/2025/prepayment-steps/plan', { method: 'POST', body: JSON.stringify({ months: {} }) })
const plantOf = async (s: Server, id: string) => (await s.api<HeatingPlant[]>('/api/heating-plants')).find((p) => p.id === id) ?? assert.fail('keine Anlage')

// 1.500 € Heizung, 600 € Wasser/Abwasser, 2.000 € Grundsteuer: Vorschlag 342 € (4.100 € / 12). Vorauszahlung 300 €,
// aufgeteilt in 120 € (zweite) und 180 € (übrige).
async function house(s: Server) {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
  const t = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
  const { plant } = await jsonOf<{ plant: { id: string } }>(await send(s, '/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id }) })
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 60000, key: 'area' }) })
  await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 200000, key: 'area' }) })
  const vorschau = await jsonOf<{ token: string }>(await send(s, `/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: true, month: '2025-01' }))
  assert.equal((await send(s, `/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-01', answers: { steps: { [t.id]: { '2025-01': 12000 } }, token: vorschau.token } })).status, 200)
  return { t, plantId: plant.id }
}
const WITH_WATER = /auf 342,00 € angepasst \(.*\)\. Davon entfallen 175,00 € auf Heizung, Warmwasser und Wasser\/Abwasser \(bisher 120,00 €\) und 167,00 € auf die übrigen Nebenkosten \(bisher 180,00 €\)\.$/
const WITHOUT = /auf 342,00 € angepasst \(.*\)\. Davon entfallen 125,00 € auf Heizung und Warmwasser \(bisher 120,00 €\) und 217,00 € auf die übrigen Nebenkosten \(bisher 180,00 €\)\.$/

test('#712: Angabe speichern und lesen; Vorschlag je Teil und Wortlaut folgen ihr, die Summen bleiben', async () => {
  const s = await start()
  try {
    const { t, plantId } = await house(s)
    assert.equal((await plantOf(s, plantId)).secondPrepaymentCoversWater, false)
    const before = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([before.statements[0]?.suggestedMonthlyCents, before.statements[0]?.suggestedHeatingMonthlyCents, before.statements[0]?.secondPrepaymentCoversWater], [34200, 12500, undefined])
    assert.deepEqual(before.letters?.[t.id]?.adjustment, { mode: 'suggestion', newCents: 34200, from: '2026-05', heatingCents: 12500 })
    assert.match(plain(before.letters?.[t.id]?.texts.adjustSuggestion), WITHOUT)

    assert.equal((await send(s, `/api/heating-plants/${plantId}`, 'PUT', { secondPrepaymentCoversWater: true })).status, 200)
    assert.equal((await plantOf(s, plantId)).secondPrepaymentCoversWater, true)
    const after = await s.api<Settlement>('/api/settlement/2025')
    const st = after.statements[0] ?? assert.fail('keine Aufstellung')
    assert.deepEqual([st.suggestedMonthlyCents, st.suggestedHeatingMonthlyCents, st.secondPrepaymentCoversWater], [34200, 17500, true])
    assert.deepEqual(after.letters?.[t.id]?.adjustment, { mode: 'suggestion', newCents: 34200, from: '2026-05', heatingCents: 17500, coversWater: true })
    assert.match(plain(after.letters?.[t.id]?.texts.adjustSuggestion), WITH_WATER)
    // Keine Summe ändert sich: Gesamtkosten, Zeilen, Vorauszahlungen, Saldo.
    const sums = (x: Settlement) => [x.totalCostsCents, x.landlord, x.statements.map((y) => [y.rows, y.totalShareCents, y.prepaymentCents, y.heatingPrepaymentCents, y.balanceCents, y.suggestedMonthlyCents])]
    assert.deepEqual(sums(after), sums(before))

    // Die Meldung zum eigenen Teil nennt ihn, wie die Anlage ihn führt.
    const over = await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'custom', cents: 31000, heatingCents: 32000 } })
    assert.equal(over.status, 400)
    assert.equal((await jsonOf<{ error: string }>(over)).error, 'Der Teil für Heizung, Warmwasser und Wasser/Abwasser liegt über der neuen Vorauszahlung.')
  } finally {
    s.stop()
  }
})

test('#712: der Abschluss friert den Wortlaut ein; eine spätere Änderung der Angabe ändert die abgeschlossene Abrechnung nicht', async () => {
  const s = await start()
  try {
    const { t, plantId } = await house(s)
    assert.equal((await send(s, `/api/heating-plants/${plantId}`, 'PUT', { secondPrepaymentCoversWater: true })).status, 200)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', { sentAt: '2026-03-11' })).status, 201)
    assert.equal((await send(s, `/api/heating-plants/${plantId}`, 'PUT', { secondPrepaymentCoversWater: false })).status, 200)
    assert.equal((await plantOf(s, plantId)).secondPrepaymentCoversWater, false)

    const frozen = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([frozen.statements[0]?.suggestedHeatingMonthlyCents, frozen.statements[0]?.secondPrepaymentCoversWater], [17500, true])
    assert.deepEqual(frozen.letters?.[t.id]?.adjustment, { mode: 'suggestion', newCents: 34200, from: '2026-05', heatingCents: 17500, coversWater: true })
    assert.match(plain(frozen.letters?.[t.id]?.texts.adjustSuggestion), WITH_WATER)
    // Die Übernahme in die Staffel nennt den zweiten Teil, wie das abgeschlossene Schreiben ihn führt.
    const it = (await plan(s)).items[0] ?? assert.fail('kein Eintrag')
    assert.deepEqual([it.state, it.cents, it.heating?.cents, it.heating?.coversWater], ['pending', 16700, 17500, true])
    // Der Export gibt die Anpassung wie das Schreiben wieder.
    const exported = await s.api<SettlementExport>('/api/settlement/2025/export?format=json')
    assert.deepEqual(exported.statements[0]?.adjustment, { mode: 'suggestion', newCents: 34200, from: '2026-05', heatingCents: 17500, coversWater: true })

    // Wieder geöffnet gilt die Angabe von heute.
    assert.equal((await send(s, '/api/settlement/2025/close', 'DELETE')).status, 200)
    const open = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([open.statements[0]?.suggestedHeatingMonthlyCents, open.statements[0]?.secondPrepaymentCoversWater], [12500, undefined])
    assert.match(plain(open.letters?.[t.id]?.texts.adjustSuggestion), WITHOUT)
  } finally {
    s.stop()
  }
})

test('#712: Backup und Wiederherstellen tragen die Angabe', async () => {
  const s = await start()
  try {
    const { plantId } = await house(s)
    assert.equal((await send(s, `/api/heating-plants/${plantId}`, 'PUT', { secondPrepaymentCoversWater: true })).status, 200)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal((await send(s, `/api/heating-plants/${plantId}`, 'PUT', { secondPrepaymentCoversWater: false })).status, 200)
    assert.equal((await plantOf(s, plantId)).secondPrepaymentCoversWater, false)
    const res = await restore(s, backup)
    assert.equal(res.status, 200)
    assert.equal((await plantOf(s, plantId)).secondPrepaymentCoversWater, true)
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).statements[0]?.suggestedHeatingMonthlyCents, 17500)
  } finally {
    s.stop()
  }
})

test('#712: eigene Heizperiode: der Server lehnt die Angabe mit Satz ab', async () => {
  const s = await start()
  try {
    const { plant } = await jsonOf<{ plant: { id: string } }>(await send(s, '/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const vorschau = await jsonOf<{ token: string }>(await send(s, `/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } }))
    assert.equal((await send(s, `/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: { groups: {}, moves: {}, overrides: {}, totals: {}, token: vorschau.token, understood: true } })).status, 200)
    assert.equal((await plantOf(s, plant.id)).periodStartMonth, 5)
    const res = await send(s, `/api/heating-plants/${plant.id}`, 'PUT', { secondPrepaymentCoversWater: true })
    assert.equal(res.status, 400)
    assert.equal((await jsonOf<{ error: string }>(res)).error, 'Die zweite Vorauszahlung kann nur in einer gemeinsamen Abrechnung auch Wasser und Abwasser decken. Diese Heizanlage rechnet in eigenen Heizperioden ab, und die Heizkostenabrechnung rechnet nur Heizung und Warmwasser ab.')
    assert.equal((await plantOf(s, plant.id)).secondPrepaymentCoversWater, false)
  } finally {
    s.stop()
  }
})
