// Betriebsstrom und Wechsel des Abrechnungszeitraums (Nachprüfung der Durchsicht von #252, G2-N-W1): Die
// Stromrechnung und ihre Abzüge wandern als Einheit. Bei jeder der drei Antworten (im Rumpf lassen, ganz in
// den neuen Zeitraum, nach Tagen aufteilen) gelingt der Wechsel; beim Aufteilen wird der Abzug mit
// denselben Tagesanteilen geteilt, und jeder Teil zeigt auf den Teil der Rechnung im selben Zeitraum.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { readCostItems } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import type { CostItem } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI_AB_2025 = { startMonth: 1, changes: ['2025-05'] }
let n = 0
const ids = () => `w-${++n}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-wechsel-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Haus mit zwei Wohnungen, Hausstrom 1.000 € und Müll 300 € in 2025, Schätzhilfe 100 € gebucht.
async function bestand(opened: OpenedDatabase, method: 'service' | 'manual'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'B', areaM2: 20, participates: true })
    await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
    await createEntity(db, 'tenancies', 't-b', { unitId: 'u2', tenantName: 'B', persons: 1, start: '2024-01-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method })
    if (method === 'manual') await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas 2025', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
    await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 100000, key: 'area' })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
  })
  await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil der Brennstoffkosten' }, ids))
}

const items = (opened: OpenedDatabase): Promise<CostItem[]> => opened.read((db) => readCostItems(db))
const sum = (list: readonly CostItem[]) => list.reduce((a, c) => a + c.amountCents, 0)

async function wechsel(opened: OpenedDatabase, kalt: string) {
  const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
  const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.id.endsWith('|heizung') ? g.from : kalt]))
  return opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, groups, token: preview.token }, ids, TODAY))
}

for (const method of ['service', 'manual'] as const) {
  for (const kalt of ['2025-01', '2025-05', 'split']) {
    test(`G2-N-W1: Zeitraumwechsel mit Betriebsstrom-Abzug gelingt (${method === 'service' ? 'Messdienst' : 'eigene Abrechnung'}, Antwort ${kalt}); Abzug zeigt auf die Rechnung seines Zeitraums, kein Cent wandert`, async () => {
      await withDatabase(async (opened) => {
        await bestand(opened, method)
        const vorher = await items(opened)
        const allgemeinVorher = sum(vorher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom'))
        const r = await wechsel(opened, kalt)
        if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
        const nachher = await items(opened)
        // Geldinvariante: Gesamtsumme und Allgemeinstrom netto wie vorher.
        assert.equal(sum(nachher), sum(vorher))
        assert.equal(sum(nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom')), allgemeinVorher)
        const abzuege = nachher.filter((c) => c.operatingPower === 'deduction')
        assert.equal(sum(abzuege), -10000)
        for (const d of abzuege) {
          const g = nachher.find((c) => c.id === d.operatingPowerGeneralId) ?? assert.fail(`${d.id}: keine Rechnung`)
          assert.equal(g.period, d.period, `${d.id}: Rechnung in anderem Zeitraum`)
          const ausDieser = -sum(abzuege.filter((x) => x.operatingPowerGeneralId === g.id))
          assert.ok(ausDieser <= g.amountCents, `${g.id}: mehr Abzug als Rechnung`)
        }
        if (kalt === 'split') {
          // Dieselben Tagesanteile: 120 von 365 Tagen im Rumpf.
          assert.deepEqual(abzuege.map((d) => [d.period, d.amountCents]).sort(), [['2025-01', -3288], ['2025-05', -6712]])
        } else {
          assert.deepEqual(abzuege.map((d) => d.period), [kalt])
        }
      })
    })
  }
}

// Scheitert eine Prüfung am Endstand doch, antwortet der Wechsel mit 409 und Vorschau, nie mit einer nackten 400.
test('G2-N-W1: lässt der Wechsel mehr Abzug als Rechnung im Zeitraum, antwortet er mit Vorschau und Satz; gespeichert wird nichts', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
      // Leistungszeitraum über das ganze Jahr: Die Rechnung wird nach Tagen geteilt, der Abzug bleibt im Rumpf.
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 100000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    })
    await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 90000, basis: 'geschätzt' }, ids))
    const vorher = await items(opened)
    const r = await wechsel(opened, '2025-01')
    if (!r || !('error' in r)) return assert.fail('angenommen')
    assert.match(r.error, /mehr abgezogen, als die Rechnung beträgt/)
    assert.match(r.error, /Gespeichert wurde nichts/)
    assert.ok('preview' in r && r.preview, 'Vorschau fehlt')
    assert.deepEqual(await items(opened), vorher)
  })
})
