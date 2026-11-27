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
    // Durchsicht zu PR #435, M1 (1): ein Monat im abgerechneten Zeitraum ist eine 400, und gespeichert ist nichts.
    const inside = await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'suggestion', from: '2025-06' } })
    assert.equal(inside.status, 400)
    assert.match((await jsonOf<{ error: string }>(inside)).error, /Juni 2025 liegt im abgerechneten Zeitraum/)
    assert.equal((await s.api<Settlement>('/api/settlement/2025')).letters?.[t.id]?.adjustment.from, '2026-07')
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
    // Das Änderungsjournal (#318) führt die Übernahme mit ihrem Satz.
    const groups = await s.api<{ title: string }[]>('/api/journal')
    assert.ok(groups.some((g) => g.title.startsWith('Angekündigte Vorauszahlung in die Staffel übernommen')), JSON.stringify(groups.map((g) => g.title)))

    // Ein geänderter Monat: übernommen ab Juni, der Satz nennt den Monat des Schreibens.
    const june = await plan(s, { [t.id]: '2026-06' })
    assert.match(june.items[0]?.notes.join(' ') ?? '', /Das Schreiben nennt Mai 2026, übernommen wird ab Juni 2026/)
    // Die abgeschlossene Abrechnung bleibt, wie sie ist.
    assert.deepEqual((await s.api<Settlement>('/api/settlement/2025')).deviation?.deviations, [])
  } finally {
    s.stop()
  }
})

// Durchsicht (M1): Der Anpassungssatz entfällt nur, wenn der Betrag schon am Ende des abgerechneten Zeitraums galt. Eine
// Stufe danach, ob übernommen oder vorab von Hand eingetragen, ist gerade die Anpassung, die der Brief erklären muss
// (§ 560 Abs. 4 BGB); sonst forderte das Mietkonto 50 €, ohne dass der Mieter die Erklärung bekommt.
test('nach dem Übernehmen wieder geöffnet und neu abgeschlossen: Satz und Plan bleiben', async () => {
  const s = await start()
  try {
    const t = await house(s)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', {})).status, 201)
    const p = await plan(s)
    assert.equal((await send(s, '/api/settlement/2025/prepayment-steps', 'POST', { tenancyIds: [t.id], token: p.token })).status, 200)
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id)?.prepayments, [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 5000 }])
    // Wieder öffnen (etwa weil der Absender fehlte): Das Anschreiben kündigt die Anpassung weiter an.
    assert.equal((await send(s, '/api/settlement/2025/close', 'DELETE')).status, 200)
    const open = (await s.api<Settlement>('/api/settlement/2025')).letters?.[t.id] ?? assert.fail('kein Anschreiben')
    assert.deepEqual(open.adjustment, { mode: 'suggestion', newCents: 5000, from: '2026-05' })
    assert.match(plain(open.texts.adjustSuggestion), /ab Mai 2026 auf 50,00 € angepasst/)
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', {})).status, 201)
    const frozen = (await s.api<Settlement>('/api/settlement/2025')).letters?.[t.id] ?? assert.fail('kein Anschreiben')
    assert.deepEqual(frozen.adjustment, { mode: 'suggestion', newCents: 5000, from: '2026-05' })
    const again = (await plan(s)).items[0] ?? assert.fail('kein Eintrag')
    assert.deepEqual([again.cents, again.from, again.state], [5000, '2026-05', 'taken'])
  } finally {
    s.stop()
  }
})

test('eine vorab zum Monat der Anpassung eingetragene Stufe nimmt dem Brief den Satz nicht', async () => {
  const s = await start()
  try {
    const t = await house(s)
    await s.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepayments: [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 5000 }] }) })
    const live = (await s.api<Settlement>('/api/settlement/2025')).letters?.[t.id] ?? assert.fail('kein Anschreiben')
    assert.deepEqual(live.adjustment, { mode: 'suggestion', newCents: 5000, from: '2026-05' })
    // Galt der Betrag dagegen schon im abgerechneten Zeitraum und gilt weiter, gibt es nichts anzupassen.
    await s.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepayments: [{ from: '2024-01', monthlyCents: 5000 }] }) })
    const same = (await s.api<Settlement>('/api/settlement/2025')).letters?.[t.id] ?? assert.fail('kein Anschreiben')
    assert.equal(same.adjustment.newCents, null)
  } finally {
    s.stop()
  }
})

// #704 Teil 2: Vorauszahlung aufgeteilt (Heizung im Zeitraum des Objekts), eine Gesamtabrechnung. Das Anschreiben nennt die
// Anpassung je Teil, die Summe ist der Vorschlag; „In die Staffel übernehmen“ schreibt beide Staffeln in einem Vorgang.
test('#704: aufgeteilte Vorauszahlung: Anschreiben je Teil, eigener Betrag mit eigenem Heizanteil, Übernahme in beide Staffeln', async () => {
  const s = await start()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const t = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: { id: string } }>(await send(s, '/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id }) })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 200000, key: 'area' }) })
    const vorschau = await jsonOf<{ token: string }>(await send(s, `/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: true, month: '2025-01' }))
    assert.equal((await send(s, `/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-01', answers: { steps: { [t.id]: { '2025-01': 12000 } }, token: vorschau.token } })).status, 200)

    // Vorschlag 292 € (3.500 € / 12), davon Heizung 125 €; bisher 120 € und 180 €.
    let live = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([live.statements[0]?.suggestedMonthlyCents, live.statements[0]?.suggestedHeatingMonthlyCents], [29200, 12500])
    assert.deepEqual(live.letters?.[t.id]?.adjustment, { mode: 'suggestion', newCents: 29200, from: '2026-05', heatingCents: 12500 })
    assert.match(plain(live.letters?.[t.id]?.texts.adjustSuggestion), /ab Mai 2026 auf 292,00 € angepasst \(.*\)\. Davon entfallen 125,00 € auf Heizung und Warmwasser \(bisher 120,00 €\) und 167,00 € auf die übrigen Nebenkosten \(bisher 180,00 €\)\.$/)

    // Eigener Betrag: der Heizanteil wird geprüft und gespeichert.
    const over = await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'custom', cents: 31000, heatingCents: 32000 } })
    assert.equal(over.status, 400)
    assert.match((await jsonOf<{ error: string }>(over)).error, /Teil für Heizung und Warmwasser liegt über der neuen Vorauszahlung/)
    assert.equal((await send(s, `/api/settlement/2025/letters/${t.id}`, 'PUT', { adjustment: { mode: 'custom', cents: 31000, heatingCents: 14000 } })).status, 200)
    live = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual(live.letters?.[t.id]?.adjustment, { mode: 'custom', newCents: 31000, from: '2026-05', heatingCents: 14000 })
    assert.match(plain(live.letters?.[t.id]?.texts.adjustCustom), /auf 310,00 € angepasst\. Davon entfallen 140,00 € auf Heizung und Warmwasser \(bisher 120,00 €\) und 170,00 € auf die übrigen Nebenkosten \(bisher 180,00 €\)\.$/)

    // Abschließen friert den Satz samt Teilen ein; der Plan nennt beide, die Übernahme schreibt beide.
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', { sentAt: '2026-03-11' })).status, 201)
    const p = await plan(s)
    const it = p.items[0] ?? assert.fail('kein Eintrag')
    assert.deepEqual([it.state, it.schedule, it.cents, it.currentCents, it.heating?.cents, it.heating?.currentCents, it.blocked], ['pending', 'prepayments', 17000, 18000, 14000, 12000, undefined])
    const saved = await send(s, '/api/settlement/2025/prepayment-steps', 'POST', { tenancyIds: [t.id], token: p.token })
    assert.equal(saved.status, 200)
    const after = (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === t.id) ?? assert.fail('kein Mietverhältnis')
    assert.deepEqual(after.prepayments, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-01', monthlyCents: 18000 }, { from: '2026-05', monthlyCents: 17000 }])
    assert.deepEqual(after.heatingPrepayments, [{ from: '2025-01', monthlyCents: 12000 }, { from: '2026-05', monthlyCents: 14000 }])
    assert.equal((await plan(s)).items[0]?.state, 'taken')
    // Der eingefrorene Satz bleibt, wie zugestellt.
    const frozen = await s.api<Settlement>('/api/settlement/2025')
    assert.match(plain(frozen.letters?.[t.id]?.texts.adjustCustom), /Davon entfallen 140,00 € auf Heizung und Warmwasser \(bisher 120,00 €\)/)
  } finally {
    s.stop()
  }
})

// Integrationsdurchsicht Geld zu #704, M1, über den echten Server: zwei Heizanlagen im Objekt. Haus A rechnet in eigener
// Heizperiode getrennt ab, Haus B im Zeitraum des Objekts mit aufgeteilter Vorauszahlung. Der Vorschlag der Abrechnung gilt
// wegen Haus A als „ohne Heizung“, enthält für den Mieter in Haus B aber dessen Heizkosten. Die Übernahme darf den Betrag
// nicht neben seine Heizstaffel schreiben (das wären 300 € statt 200 € im Monat); für den Mieter in Haus A bleibt sie möglich.
test('#704: zwei Heizanlagen, eine getrennt abgerechnet, eine aufgeteilt: die Übernahme sperrt beim Mieter der aufgeteilten', async () => {
  const s = await start()
  try {
    const post = async <T>(url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
    const a = await post<Unit>('/api/units', { name: 'Haus A', areaM2: 60, participates: true })
    const b = await post<Unit>('/api/units', { name: 'Haus B', areaM2: 60, participates: true })
    const ta = await post<Tenancy>('/api/tenancies', { unitId: a.id, tenantName: 'Anna', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
    const tb = await post<Tenancy>('/api/tenancies', { unitId: b.id, tenantName: 'Bert', persons: 1, start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
    const plant = async (name: string, unitId: string) => (await jsonOf<{ plant: { id: string } }>(await send(s, '/api/heating-plants', 'POST', { name, buildingWith: 'own', energy: 'gas', method: 'service', units: [{ unitId, heatedAreaM2: null }] }))).plant
    const hpA = await plant('Haus A', a.id)
    const hpB = await plant('Haus B', b.id)
    // Haus A: eigene Heizperiode Mai bis April, getrennt abgerechnet ab Mai 2024.
    const rules = { startMonth: 5, changes: [] }
    const zeitraum = await jsonOf<{ token: string }>(await send(s, `/api/heating-plants/${hpA.id}/period/preview`, 'POST', { rules }))
    assert.equal((await send(s, `/api/heating-plants/${hpA.id}/period`, 'PUT', { rules, answers: { understood: true, token: zeitraum.token } })).status, 200)
    const getrennt = await jsonOf<{ token: string, way: string }>(await send(s, `/api/heating-plants/${hpA.id}/separate/preview`, 'POST', { separate: true, month: '2024-05' }))
    assert.equal(getrennt.way, 'separate')
    assert.equal((await send(s, `/api/heating-plants/${hpA.id}/separate`, 'PUT', { separate: true, month: '2024-05', answers: { understood: true, steps: { [ta.id]: { '2024-05': 10000 } }, token: getrennt.token } })).status, 200)
    // Haus B: wie das Objekt, Vorauszahlung aufgeteilt ab Januar 2025.
    const geteilt = await jsonOf<{ token: string, way: string }>(await send(s, `/api/heating-plants/${hpB.id}/separate/preview`, 'POST', { separate: true, month: '2025-01' }))
    assert.equal(geteilt.way, 'samePeriod')
    assert.equal((await send(s, `/api/heating-plants/${hpB.id}/separate`, 'PUT', { separate: true, month: '2025-01', answers: { understood: true, steps: { [tb.id]: { '2025-01': 10000 } }, token: geteilt.token } })).status, 200)
    await post('/api/costItems', { period: '2025-01', category: 'Heizung und Warmwasser', description: 'Heizung B', amountCents: 120000, key: 'area', heatingPlantId: hpB.id, participantUnitIds: [b.id] })
    await post('/api/costItems', { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 264000, key: 'area' })

    const live = await s.api<Settlement>('/api/settlement/2025')
    const bert = live.statements.find((x) => x.tenancyId === tb.id) ?? assert.fail('Bert fehlt')
    // 1.320 € Grundsteuer + 1.200 € Heizung B: 210 € im Monat, und die enthalten seine Heizung.
    assert.deepEqual([bert.suggestedMonthlyCents, live.suggestionWithoutHeating], [21000, true])
    assert.equal((await send(s, '/api/settlement/2025/close', 'POST', { sentAt: '2026-03-11' })).status, 201)
    const p = await plan(s)
    const itB = p.items.find((x) => x.tenancyId === tb.id) ?? assert.fail('kein Eintrag für Bert')
    assert.equal(itB.state, 'blocked')
    assert.match(itB.blocked ?? '', /andere Heizanlage des Objekts getrennt abrechnet.*Heizvorauszahlung von 100,00 €.*doppelt/)
    const itA = p.items.find((x) => x.tenancyId === ta.id) ?? assert.fail('kein Eintrag für Anna')
    // Anna in Haus A: 110 € für die übrigen Nebenkosten statt 100 €, in die Staffel der übrigen; ihre Heizung ist getrennt.
    assert.deepEqual([itA.state, itA.schedule, itA.cents, itA.currentCents], ['pending', 'prepayments', 11000, 10000])
    // Auch gewählt wird für Bert nichts geschrieben.
    assert.equal((await send(s, '/api/settlement/2025/prepayment-steps', 'POST', { tenancyIds: [tb.id], token: p.token })).status, 200)
    const after = (await s.api<Tenancy[]>('/api/tenancies')).find((x) => x.id === tb.id) ?? assert.fail('kein Mietverhältnis')
    assert.deepEqual([after.prepayments.at(-1), after.heatingPrepayments], [{ from: '2025-01', monthlyCents: 10000 }, [{ from: '2025-01', monthlyCents: 10000 }]])
  } finally {
    s.stop()
  }
})
