import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, LineDecision } from '../../shared/types.ts'
import { openDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'
import { saveAssessment } from '../src/db/assessments.ts'
import { bookAssessment, previewBooking } from '../src/db/booking.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { periodKey } from '../../shared/period.ts'

const TODAY = '2026-10-05'
let n = 0
const ids = () => `neu-${++n}`

// Review der Laienprobe, Runde 1: Eine gebuchte Position wird beim Wechsel nicht vorab geteilt, und
// ein Teil einer geteilten Rechnung ist kein Verknüpfungsziel (Summenregel der Belegbuchung).
test('Review B2: gebuchte Rechnung, Wechsel mit den Vorschlägen, danach zweite Buchung an die Position', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const uploadDir = path.join(dataDir, 'uploads'); fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'eg', tenantName: 'B', persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 25000 }] })
    })
    fs.writeFileSync(path.join(uploadDir, 'gs.pdf'), '%PDF gs')
    fs.writeFileSync(path.join(uploadDir, 'gs2.pdf'), '%PDF gs2')
    const a = await opened.write((db) => saveAssessment(db, {
      file: 'gs.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, requestedPeriod: periodKey('2025-01'), vendor: 'Stadt', invoiceDate: '2025-02-10',
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
      lines: [{ description: 'Grundsteuer 2025', category: 'Grundsteuer', categoryGuessed: false, amountCents: 42000, labor35aCents: null }],
    }, { id: 'a1', now: '2026-03-01T00:00:00Z' }))
    const d1: LineDecision[] = [{ idx: 0, action: 'create', fields: { description: 'Grundsteuer 2025', category: 'Grundsteuer', amountCents: 42000, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null } }]
    const p1 = await opened.read((db) => previewBooking(db, a.assessment.id, d1, uploadDir))
    assert.equal((await opened.write((db) => bookAssessment(db, a.assessment.id, d1, p1.token, { uploadDir, newId: () => 'gs-item' }))).kind, 'done')

    const rules = { startMonth: 1, changes: ['2025-07'] }
    const r = await opened.write(async (db) => {
      const v = await previewPeriodChange(db, 'objekt-1', rules, TODAY)
      return applyPeriodChange(db, 'objekt-1', rules, { understood: true, groups: Object.fromEntries((v?.groups ?? []).map((g) => [g.id, g.suggested])), taxYears: {}, token: v?.token }, ids, TODAY)
    })
    assert.ok(r && 'property' in r, JSON.stringify(r))
    const show = async () => (await opened.read(readStock)).costItems.filter((c: CostItem) => c.category === 'Grundsteuer').map((c: CostItem) => [c.id, c.period, c.amountCents, c.taxYear ?? null])

    const b = await opened.write((db) => saveAssessment(db, {
      file: 'gs2.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, requestedPeriod: periodKey('2025-01'), vendor: 'Stadt', invoiceDate: '2025-08-10',
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
      lines: [{ description: 'Grundsteuer Änderungsbescheid', category: 'Grundsteuer', categoryGuessed: false, amountCents: 5000, labor35aCents: null }],
    }, { id: 'a2', now: '2026-03-02T00:00:00Z' }))
    const d2: LineDecision[] = [{ idx: 0, action: 'link', costItemId: 'gs-item', despiteCandidates: true }]
    const p2 = await opened.read((db) => previewBooking(db, b.assessment.id, d2, uploadDir))
    const o = await opened.write((db) => bookAssessment(db, b.assessment.id, d2, p2.token, { uploadDir, newId: ids }))
    const after = await show()
    const total = after.reduce((s, x) => s + Number(x[2]), 0)
    assert.equal(total, 47000, 'Summe aller Teile = Rechnung + Nachtrag')
    assert.equal(o.kind, 'done')
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('Review B2 (a): Wer trotzdem teilt, kann eine weitere Zeile nicht mit einem Teil verknüpfen', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const uploadDir = path.join(dataDir, 'uploads'); fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'eg', tenantName: 'B', persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 25000 }] })
      await createEntity(db, 'costItems', 'gs-item', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 42000, key: 'area' })
    })
    const rules = { startMonth: 1, changes: ['2025-07'] }
    const r = await opened.write(async (db) => {
      const v = await previewPeriodChange(db, 'objekt-1', rules, TODAY)
      return applyPeriodChange(db, 'objekt-1', rules, { understood: true, groups: { '2025-01': 'split' }, taxYears: {}, token: v?.token }, ids, TODAY)
    })
    assert.ok(r && 'property' in r, JSON.stringify(r))
    fs.writeFileSync(path.join(uploadDir, 'gs2.pdf'), '%PDF gs2')
    const b = await opened.write((db) => saveAssessment(db, {
      file: 'gs2.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, requestedPeriod: periodKey('2025-01'), vendor: 'Stadt', invoiceDate: '2025-08-10',
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
      lines: [{ description: 'Grundsteuer Änderungsbescheid', category: 'Grundsteuer', categoryGuessed: false, amountCents: 5000, labor35aCents: null }],
    }, { id: 'a2', now: '2026-03-02T00:00:00Z' }))
    const d2: LineDecision[] = [{ idx: 0, action: 'link', costItemId: 'gs-item', despiteCandidates: true }]
    const p2 = await opened.read((db) => previewBooking(db, b.assessment.id, d2, uploadDir))
    assert.match(p2.errors.map((e) => e.message).join(' '), /Teil einer nach Tagen aufgeteilten Rechnung/)
    assert.equal(p2.errors[0]?.openItemId, 'gs-item')
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
