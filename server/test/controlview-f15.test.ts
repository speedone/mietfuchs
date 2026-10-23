// Hält die eingefrorene Abrechnung des Golden F15 für die Kontrollansicht (#321) gleich mit der Berechnung:
// client/src/testing/f15Settlement.ts. Weicht die Berechnung ab, ist die Datei neu zu erzeugen (Bestand wie in
// heating-golden.test.ts, ohne `steps`), und der Client-Test controlView.f15.test.ts rechnet mit dem neuen Stand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement } from '../src/calc.ts'
import { saveCo2Statement } from '../src/db/co2.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { assertControlSums } from '../testing/landlordParts.ts'
import { f15Settlement } from '../../client/src/testing/f15Settlement.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'

test('Kontrollansicht: die eingefrorene Abrechnung F15 ist die der Berechnung, und die Probe geht auf', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-control-f15-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      for (const [i, u] of ['a', 'b', 'c', 'd'].entries()) {
        await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: `W${i + 1}`, areaM2: 50, participates: true })
        await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${i + 1}`, persons: 1, start: '2020-01-01' })
      }
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: 393301, key: 'amounts',
        tenancyAmounts: { ta: 110327, tb: 95864, tc: 101485, td: 76875 },
      })
      await saveCo2Statement(db, 'hp', '2025-01', {
        method: 'serviceDeducted', serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4,
        serviceTotalCents: 25000, serviceLandlordPermille: 350, serviceKgPerM2: 46.4,
      })
    })
    const stock = await opened.read(readStock)
    const p = periodOfKey({ startMonth: 1, changes: [] }, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
    const s = computeSettlement(snapshotFor(stock, 'objekt-1', p))
    assertControlSums(s, 'F15')
    const withoutSteps = (rows: readonly object[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'steps')))
    assert.deepEqual(
      { statements: s.statements.map((st) => ({ ...st, rows: withoutSteps(st.rows) })), landlord: { rows: withoutSteps(s.landlord.rows), totalCents: s.landlord.totalCents } },
      JSON.parse(JSON.stringify(f15Settlement)),
    )
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
