// Das Zahlungsdatum über die echten Routen (#255 PR 3, Durchsicht M1 und K4): Die Rückfrage kommt als 409 mit
// `question: 'paidOn'`, beim gewöhnlichen Speichern wie beim Aufteilen, und mit `confirmPaidOn` wird gespeichert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from '../testing/api.ts'
import type { CostItem, SplitPreviewPart } from '../../shared/types.ts'
import { splitPaidOnQuestions } from '../../shared/paidOn.ts'

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
