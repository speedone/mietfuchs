import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { CostItem } from '../../shared/types.ts'
import { openDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'
import { properties } from '../src/db/schema.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'

const TODAY = '2026-10-05'
let n = 0
const ids = () => `neu-${++n}`

test('Review B2: Steuerjahr der Teile beim Wechsel von Mai–April auf Kalenderjahr', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'eg', tenantName: 'B', persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 25000 }] })
      await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2024-05', category: 'Müllabfuhr', description: 'Müll 2024/2025', amountCents: 36500, key: 'area', taxYear: 2025 })
    })
    const rules = { startMonth: 5, changes: ['2025-01'] }
    const r = await opened.write(async (db) => {
      const v = await previewPeriodChange(db, 'objekt-1', rules, TODAY)
      return applyPeriodChange(db, 'objekt-1', rules, { understood: true, groups: Object.fromEntries((v?.groups ?? []).map((g) => [g.id, g.suggested])), taxYears: {}, token: v?.token }, ids, TODAY)
    })
    // Teilen verschöbe 245 € von 2025 nach 2024: keine Vorgabe, also mit den Vorschlägen nichts gespeichert.
    assert.ok(r && 'error' in r, JSON.stringify(r))
    const v = await opened.read((db) => previewPeriodChange(db, 'objekt-1', rules, TODAY)) ?? assert.fail('keine Vorschau')
    const g = v.groups[0] ?? assert.fail('keine Gruppe')
    assert.equal(g.suggested, '')
    assert.match(g.split?.notes.join(' ') ?? '', /Geteilt kämen für die Steuer 245,00.€ aus dem Jahr der Zahlung 2025 nach 2024/)
    assert.deepEqual(g.taxShifts.map((t) => t.key), ['2024-05'], 'ganz in den Rumpf 2024 verschöbe alles nach 2024')
    const after = (await opened.read(readStock)).costItems.map((c: CostItem) => [c.period, c.amountCents, c.taxYear ?? null])
    assert.deepEqual(after, [['2024-05', 36500, 2025]], 'nichts geschrieben')
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
