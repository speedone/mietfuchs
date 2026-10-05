// F14 „Eigene Heizperiode“ (Entwurf 12.1, Herleitung in fixtures/period/F14-heizperiode/README.md):
// der ganze Weg über die Datenbank, vom Bestand im Kalenderjahr bis zu beiden Abrechnungen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange } from '../src/db/heatingPeriodChange.ts'
import { readStock } from '../src/db/read.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

const TODAY = '2026-10-05'

test('F14: eigene Heizperiode, Auszug 31.10.2025, Abrechnung nur mit Heizkosten', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-f14-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't-m', { unitId: 'eg', tenantName: 'M', persons: 1, start: '2024-01-01', end: '2025-10-31', prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
      await createEntity(db, 'tenancies', 't-n', { unitId: 'eg', tenantName: 'N', persons: 1, start: '2025-11-01', prepayments: [{ from: '2025-11', monthlyCents: 22000 }] })
      const heizung = (id: string, period: string, amountCents: number, tenancyAmounts: Record<string, number>) =>
        createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents, key: 'amounts', tenancyAmounts })
      await heizung('Messdienst 2024/2025', '2025-01', 95000, { 't-m': 95000 })
      await heizung('Messdienst 2025/2026', '2026-01', 100000, { 't-m': 41230, 't-n': 58770 })
      for (const year of [2025, 2026]) {
        await createEntity(db, 'costItems', `Grundsteuer ${year}`, { propertyId: 'objekt-1', period: `${year}-01`, category: 'Grundsteuer', description: `Grundsteuer ${year}`, amountCents: 60000, key: 'area' })
      }
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service', assignItemIds: ['Messdienst 2024/2025', 'Messdienst 2025/2026'] })
    })
    const mai = { startMonth: 5, changes: [] }
    const vorschau = await opened.read((db) => previewHeatingPeriodChange(db, 'hp1', mai, TODAY)) ?? assert.fail('keine Anlage')
    assert.deepEqual(vorschau.moves.map((m) => [m.costItemId, m.from, m.to]), [
      ['Messdienst 2024/2025', '2025-01', '2024-05'],
      ['Messdienst 2025/2026', '2026-01', '2025-05'],
    ])
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', mai, { token: vorschau.token }, TODAY))
    assert.ok(r && 'plant' in r)

    const stock = await opened.read(readStock)
    assert.deepEqual(
      stock.costItems.filter((c) => c.category === HEATING_CATEGORY).map((c) => [c.id, c.period, c.taxYear]),
      [['Messdienst 2024/2025', '2024-05', 2025], ['Messdienst 2025/2026', '2025-05', 2026]],
    )
    const abrechnung = (key: string) => computeSettlement(snapshotFor(stock, 'objekt-1', periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(key)), { asOf: TODAY })
    const zeilen = (s: ReturnType<typeof abrechnung>) => Object.fromEntries(s.statements.map((st) => [st.tenantName, {
      rows: st.rows.map((row) => [row.description, row.shareCents]),
      total: st.totalShareCents, prepayment: st.prepaymentCents, balance: st.balanceCents,
      ...(st.heatingOnly ? { heatingOnly: true, recommended: st.recommendedDeadline } : {}),
    }]))

    const s2025 = abrechnung('2025-01')
    assert.equal(s2025.deadline, '2026-12-31')
    assert.deepEqual(s2025.heatingPeriods?.map((h) => h.period.label), ['2024/2025'])
    assert.deepEqual(zeilen(s2025), {
      M: { rows: [['Grundsteuer 2025', 49973], ['Messdienst 2024/2025', 95000]], total: 144973, prepayment: 200000, balance: 55027 },
      N: { rows: [['Grundsteuer 2025', 10027]], total: 10027, prepayment: 44000, balance: 33973 },
    })
    assert.equal(s2025.totalCostsCents, 155000)

    const s2026 = abrechnung('2026-01')
    assert.equal(s2026.deadline, '2027-12-31')
    assert.deepEqual(s2026.heatingPeriods?.map((h) => h.period.label), ['2025/2026'])
    assert.deepEqual(zeilen(s2026), {
      N: { rows: [['Grundsteuer 2026', 60000], ['Messdienst 2025/2026', 58770]], total: 118770, prepayment: 264000, balance: 145230 },
      M: { rows: [['Messdienst 2025/2026', 41230]], total: 41230, prepayment: 0, balance: -41230, heatingOnly: true, recommended: '2026-12-31' },
    })
    assert.equal(s2026.totalCostsCents, 160000)
    const warnung = s2026.notices?.find((n) => n.code === 'period.heating-only-statement') ?? assert.fail('keine Warnung')
    assert.match(warnung.text, /Stellen Sie sie bis 31\.12\.2026 zu\. Fordern Sie dafür die Abrechnung des Messdienstes für 2025\/2026 bis spätestens Oktober 2026 an\./)
    for (const s of [s2025, s2026]) {
      assert.equal(s.landlord.totalCents, 0)
      assert.equal(s.statements.reduce((a, st) => a + st.totalShareCents, 0), s.totalCostsCents)
    }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
