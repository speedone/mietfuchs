// Das Zahlungsdatum über die echten Routen (#255 PR 3, Durchsicht M1 und K4): Die Rückfrage kommt als 409 mit
// `question: 'paidOn'`, beim gewöhnlichen Speichern wie beim Aufteilen, und mit `confirmPaidOn` wird gespeichert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from '../testing/api.ts'
import type { CostItem, SplitPreviewPart } from '../../shared/types.ts'
import { splitPaidOnQuestions, taxYearQuestions } from '../../shared/paidOn.ts'

test('Route: 409 mit question paidOn, mit Bestätigung gespeichert; Aufteilen über den Jahreswechsel ebenso', async () => {
  const s = await startServer()
  try {
    const send = (route: string, method: string, body: unknown) => fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const base = { period: '2025-01', category: 'Sach- und Haftpflichtversicherung', description: 'Versicherung', amountCents: 60000, key: 'area' }
    const r1 = await send('/api/costItems', 'POST', { ...base, paidOn: '2026-02-10' })
    assert.equal(r1.status, 409)
    const b1 = await r1.json() as { error: string; question: string }
    assert.equal(b1.question, 'paidOn')
    assert.match(b1.error, /zu 2026 statt zu 2025/)
    const r2 = await send('/api/costItems', 'POST', { ...base, paidOn: '2026-02-10', confirmPaidOn: true })
    assert.equal(r2.status, 201)
    assert.equal((await r2.json() as CostItem).paidOn, '2026-02-10')

    // Durchsicht M1: Jahresversicherung 07/2025 bis 06/2026, bezahlt am 01.07.2025. Der Teil 2026 zählt damit zu 2025.
    const split = { ...base, description: 'Gebäudeversicherung', serviceFrom: '2025-07-01', serviceTo: '2026-06-30', paidOn: '2025-07-01' }
    // Die Vorschau nennt je Teil die Jahre seines Zeitraums; daraus fragt das Formular mit derselben Regel wie hier.
    const pre = await send('/api/costItems/split/preview', 'POST', split)
    assert.equal(pre.status, 200)
    const { parts: preview } = await pre.json() as { parts: SplitPreviewPart[] }
    assert.deepEqual(preview.map((p) => [p.period, p.startYear, p.endYear]), [['2025-01', 2025, 2025], ['2026-01', 2026, 2026]])
    const r3 = await send('/api/costItems/split', 'POST', split)
    assert.equal(r3.status, 409)
    const b3 = await r3.json() as { error: string; question: string }
    assert.equal(b3.question, 'paidOn')
    assert.match(b3.error, /zu 2025 statt zu 2026/)
    assert.equal(b3.error, splitPaidOnQuestions(null, { ...split, taxYear: null }, preview).join(' '))
    const r4 = await send('/api/costItems/split', 'POST', { ...split, confirmPaidOn: true })
    assert.equal(r4.status, 201)
    const parts = await r4.json() as CostItem[]
    assert.deepEqual(parts.map((p) => [p.period, p.paidOn]), [['2025-01', '2025-07-01'], ['2026-01', '2025-07-01']])
  } finally {
    s.stop()
  }
})

// #478 (E2): Ein Jahr der Zahlung ist auch im Kalenderzeitraum möglich; die übliche Spanne ist dieselbe wie beim Datum
// (`paidOnSpan`), außerhalb fragt der Server nach (409 `question: 'taxYear'`), statt abzulehnen.
test('Route: Jahr der Zahlung im Kalenderzeitraum, außerhalb der Spanne 409 mit question taxYear', async () => {
  const s = await startServer()
  try {
    const send = (route: string, method: string, body: unknown) => fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const base = { period: '2025-01', category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 22766, key: 'area' }
    const r1 = await send('/api/costItems', 'POST', { ...base, taxYear: 2026 })
    assert.equal(r1.status, 201, await r1.clone().text())
    assert.equal((await r1.json() as CostItem).taxYear, 2026)
    const r2 = await send('/api/costItems', 'POST', { ...base, taxYear: 2030 })
    assert.equal(r2.status, 409)
    const b2 = await r2.json() as { error: string; question: string }
    assert.equal(b2.question, 'taxYear')
    assert.equal(b2.error, taxYearQuestions(null, { period: '2025-01', taxYear: 2030 }, { startYear: 2025, endYear: 2025 }).join(' '))
    assert.match(b2.error, /außerhalb der üblichen Spanne von 2024 bis 2028/)
    const r3 = await send('/api/costItems', 'POST', { ...base, taxYear: 2030, confirmTaxYear: true })
    assert.equal(r3.status, 201)
    // Nur der Betrag berichtigt: Das Jahr ändert sich nicht, gefragt wird nicht.
    const saved = await r3.json() as CostItem
    const r4 = await send(`/api/costItems/${saved.id}`, 'PUT', { amountCents: 30000 })
    assert.equal(r4.status, 200, await r4.clone().text())
  } finally {
    s.stop()
  }
})

// #96 PR 1 (A3): An der Entnahme und an der Zuführung zur Erhaltungsrücklage gibt es kein Zahlungsdatum. Maßgeblich ist,
// wann die Gemeinschaft das Geld ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24), nicht die eigene Hausgeldzahlung; der
// Server lehnt ein Datum mit Meldung ab und leert nichts still. Das Jahr der Zahlung genügt, auch im Kalenderzeitraum
// ein anderes als das Startjahr (#478).
test('Route: Zahlungsdatum an Entnahme und Zuführung der Erhaltungsrücklage ergibt 400, das Jahr der Zahlung geht', async () => {
  const s = await startServer()
  try {
    const send = (route: string, method: string, body: unknown) => fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await send('/api/units', 'POST', { name: 'Wohnung', areaM2: 60, participates: true })
    for (const category of ['Entnahme Erhaltungsrücklage', 'Zuführung Erhaltungsrücklage']) {
      const base = { period: '2025-01', category, description: category, amountCents: 124000, key: 'area' }
      const mit = await send('/api/costItems', 'POST', { ...base, paidOn: '2025-03-01', confirmPaidOn: true })
      assert.equal(mit.status, 400, category)
      assert.match((await mit.json() as { error: string }).error, /Erhaltungsrücklage gibt es kein Zahlungsdatum/, category)
      const ohne = await send('/api/costItems', 'POST', base)
      assert.equal(ohne.status, 201, `${category}: ${await ohne.clone().text()}`)
      const saved = await ohne.json() as CostItem
      // Nachträglich ein Datum setzen geht ebenso wenig.
      const put = await send(`/api/costItems/${saved.id}`, 'PUT', { paidOn: '2025-03-01' })
      assert.equal(put.status, 400, category)
    }
    const jahr = await send('/api/costItems', 'POST', { period: '2025-01', category: 'Entnahme Erhaltungsrücklage', description: 'Dach', amountCents: 50000, key: 'area', taxYear: 2026 })
    assert.equal(jahr.status, 201, await jahr.clone().text())
    assert.equal((await jahr.json() as CostItem).taxYear, 2026)
  } finally {
    s.stop()
  }
})
