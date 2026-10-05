// F18 Rumpfzeitraum (#208, Entwurf 12.1). Herleitung von Hand in
// fixtures/period/F18-rumpfzeitraum/README.md; jede Zahl hier steht dort. Der Bestand entsteht über
// denselben Weg wie beim Nutzer: Positionen anlegen, Zeitraum wechseln mit Vorschau und Antworten.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement } from '../src/calc.ts'
import { openDatabase } from '../src/db/open.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'

test('F18 Rumpfzeitraum: 157,81 / 322,19 €, Frist 30.04.2026, Vorschlag 228 €', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-f18-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Mieter', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
      const base = { propertyId: 'objekt-1', period: '2025-01' }
      await createEntity(db, 'costItems', 'gs', { ...base, category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
      await createEntity(db, 'costItems', 'mu', { ...base, category: 'Müllabfuhr', description: 'Müll Januar bis April', amountCents: 24219, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })
      await createEntity(db, 'costItems', 'gas', { ...base, category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 70000, key: 'amounts', tenancyAmounts: { t1: 70000 }, heatingPart: 'fuel', serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })
      await createEntity(db, 'costItems', 'wa', { ...base, category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 20000, key: 'amounts', tenancyAmounts: { t1: 20000 }, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    })
    const regeln = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await opened.read((db) => previewPeriodChange(db, 'objekt-1', regeln, '2026-10-05')) ?? assert.fail('kein Objekt')
    // Heizkosten stehen in einer eigenen Gruppe und werden nie nach Tagen geteilt (Laienprobe B2).
    assert.deepEqual(vorschau.groups.map((g) => [g.id, g.from, g.split, g.items.map((i) => i.costItemId).sort()]), [['2025-01|heizung', '2025-01', null, ['gas', 'wa']]])
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', regeln, { understood: true, groups: { '2025-01|heizung': '2025-01' }, token: vorschau.token }, () => 'gs-2', '2026-10-05'))
    assert.ok(r && 'property' in r, 'gewechselt')

    const stock = await opened.read(readStock)
    const rumpf = periodOfKey(regeln, periodKey('2025-01')) ?? assert.fail('kein Rumpf')
    const s = computeSettlement(snapshotFor(stock, 'objekt-1', rumpf))
    assert.deepEqual([s.period.label, s.deadline, s.daysInYear], ['01.01.–30.04.2025', '2026-04-30', 120])
    const st = s.statements[0] ?? assert.fail('kein Mieter')
    assert.deepEqual(st.rows.map((row) => [row.costItemId, row.shareCents]).sort(), [['gas', 70000], ['gs', 15781], ['mu', 24219], ['wa', 20000]])
    assert.deepEqual([st.totalShareCents, st.prepaymentCents, st.balanceCents, st.suggestedMonthlyCents], [130000, 80000, -50000, 22800])
    assert.deepEqual(s.notices.map((n) => n.code).filter((c) => c.startsWith('period.')).sort(), ['period.heating-mismatch', 'period.short'])
    assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'), 'die Gradtagstabelle friert mit ein')

    const voll = periodOfKey(regeln, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025-05')
    const s2 = computeSettlement(snapshotFor(stock, 'objekt-1', voll))
    assert.deepEqual(s2.statements[0]?.rows.map((row) => [row.costItemId, row.shareCents]), [['gs-2', 32219]])
    assert.equal(stock.costItems.find((c) => c.id === 'gs-2')?.taxYear, 2025)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
