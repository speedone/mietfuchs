// Integrationsdurchsicht 0.13.0, zweite Runde: Ein Kesseltausch macht aus „alle Wohnungen“ keine feste Liste.
// Vorher schrieb `replaceHeatingPlant` an alte und neue Anlage die Wohnungen vom Tag des Tauschs; eine danach
// angelegte Wohnung hing still an keiner Anlage, und die übrigen Mieter trugen ihre Heizkosten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant, heatingPlantViolations, listHeatingPlants, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { saveServiceValues } from '../src/db/serviceValues.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-tauschliste-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const P = (y: number) => periodOfKey(CALENDAR_RULES, periodKey(`${y}-01`)) ?? assert.fail(`kein Zeitraum ${y}`)
const settlement = async (opened: OpenedDatabase, y: number) => computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', P(y)), {})
const wohnung = (opened: OpenedDatabase, id: string, area: number) => opened.write(async (db) => {
  await createEntity(db, 'units', id, { propertyId: 'objekt-1', name: id.toUpperCase(), areaM2: area, participates: true })
  await createEntity(db, 'tenancies', `t${id}`, { unitId: id, tenantName: `Mieter ${id.toUpperCase()}`, persons: 1, start: '2020-01-01' })
})

// Eigene Heizkostenabrechnung mit Werten eines Ablesedienstes, ohne Warmwasser: 70 % nach Verbrauch, 30 % nach Fläche.
let ids = 0
const SELF = { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'serviceValues', dhwHeatMeter: false, totalHeatMeter: false }
const selbst = (opened: OpenedDatabase, plantId: string, period: string) =>
  opened.write((db) => setUpSelf(db, plantId, { ...SELF, period }, '2024-02-01', () => `neu-${++ids}`))
const werte = (opened: OpenedDatabase, plantId: string, rows: [string, number][]) =>
  opened.write((db) => saveServiceValues(db, plantId, '2025-01', { values: rows.map(([unitId, heatValue]) => ({ unitId, from: '2025-01-01', to: '2025-12-31', heatValue, waterValue: null })) }))
const heizkosten = (opened: OpenedDatabase, plantId: string) =>
  opened.write((db) => createEntity(db, 'costItems', 'heiz', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 200000, key: 'heatingSystem', heatingPlantId: plantId, heatingPart: 'fuel', heatingTarget: 'heating' }))

test('Kesseltausch ohne Liste: eine danach angelegte Wohnung trägt bei eigener Heizkostenabrechnung ihren Anteil', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened, 'a', 50)
    await wohnung(opened, 'b', 50)
    await opened.write((db) => createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual' }))
    await selbst(opened, 'k0', '2024-01')
    await opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-01-01', energy: 'gas', name: 'Gas', previousName: 'Öl' }))
    await wohnung(opened, 'c', 100)
    // Vor der Behebung hing C nicht an der Anlage, und ihre Werte ließen sich nicht speichern.
    await werte(opened, 'k1', [['a', 100], ['b', 100], ['c', 200]]).catch(() => werte(opened, 'k1', [['a', 100], ['b', 100]]))
    await heizkosten(opened, 'k1')
    const s = await settlement(opened, 2025)
    const share = (id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents
    assert.deepEqual([share('ta'), share('tb'), share('tc')], [50000, 50000, 100000], s.notices.map((n) => n.text).join('\n'))
    assert.ok(!s.notices.some((n) => n.code === 'heating.unit-unserved'), s.notices.map((n) => n.code).join(', '))
    const plants = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual(plants.map((p) => [p.id, p.units, p.method]), [['k0', null, 'self'], ['k1', null, 'self']])
    assert.deepEqual(await opened.read((db) => heatingPlantViolations(db)), [])
    // Die Anlage lässt sich ändern, ohne dass sie eine Liste bekommt.
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'k1', { name: 'Gastherme' })))?.units, null)
  })
})

test('Kesseltausch mit Liste: die Liste bleibt die des Vermieters', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened, 'a', 50)
    await wohnung(opened, 'b', 50)
    await opened.write((db) => createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }] }))
    await opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-01-01', energy: 'gas', name: 'Gas', previousName: 'Öl' }))
    const plants = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual(plants.map((p) => [p.id, p.units?.map((u) => u.unitId) ?? null]), [['k0', ['a']], ['k1', ['a']]])
  })
})

test('Kesseltausch ohne Liste: der umbaute Raum geht mit, eine danach angelegte Wohnung ohne Wert ist ein Fehler an der Anlage', async () => {
  await withDatabase(async (opened) => {
    await wohnung(opened, 'a', 60)
    await wohnung(opened, 'b', 80)
    await opened.write(async (db) => {
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 600000, key: 'area' })
    })
    let n = 0
    const SETUP = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }], areaBasisHeat: 'volume', unitValues: [{ unitId: 'a', volumeM3: 150 }, { unitId: 'b', volumeM3: 200 }] }, '2025-02-01', () => `neu-${++n}`))
    await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2026-01-01', energy: 'districtHeating', name: 'Fernwärme', previousName: 'Gas' }))
    const neu = (await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).find((p) => p.id === 'hp2')
    assert.equal(neu?.units, null)
    assert.deepEqual(neu?.basisValues?.map((u) => [u.unitId, u.volumeM3]), [['a', 150], ['b', 200]])
    await wohnung(opened, 'd', 50)
    await opened.write((db) => createEntity(db, 'costItems', 'fw', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Fernwärme', amountCents: 600000, key: 'heatingSystem', heatingPlantId: 'hp2', heatingPart: 'fuel', heatingTarget: 'both' }))
    const s = await settlement(opened, 2026)
    assert.ok(s.notices.some((x) => x.code === 'heating.self-incomplete' && /An D fehlt der umbaute Raum/.test(x.text)), s.notices.map((x) => `${x.code}: ${x.text}`).join('\n'))
  })
})

// Bestand: Eine von 0.11.0 bis 0.12 getauschte Anlage trägt die feste Liste vom Tag des Tauschs, und ob sie vom Vermieter
// stammt, lässt sich nicht unterscheiden. Bei eigener Heizkostenabrechnung nennt die Abrechnung jede Wohnung mit Fläche,
// die an keiner Anlage hängt, auch eine leere (Durchsicht zu PR #436, M1).
async function bestand(opened: OpenedDatabase, method: 'self' | 'manual', swap: boolean): Promise<void> {
  await wohnung(opened, 'a', 50)
  await wohnung(opened, 'b', 50)
  const liste = [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }]
  await opened.write((db) => createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual', units: liste }))
  if (method === 'self') await selbst(opened, 'k0', '2024-01')
  if (swap) await opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-01-01', energy: 'gas', name: 'Gas', previousName: 'Öl' }))
  const plant = swap ? 'k1' : 'k0'
  await wohnung(opened, 'c', 100)
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'garage', { propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true })
    await createEntity(db, 'units', 'leer', { propertyId: 'objekt-1', name: 'Leer', areaM2: 40, participates: true })
    await createEntity(db, 'units', 'kalt', { propertyId: 'objekt-1', name: 'Kalt', areaM2: 40, participates: true, noConnection: ['waerme'] })
    await createEntity(db, 'tenancies', 'tkalt', { unitId: 'kalt', tenantName: 'Kalt', persons: 1, start: '2020-01-01' })
  })
  if (method === 'self') {
    await werte(opened, plant, [['a', 100], ['b', 100]])
    await heizkosten(opened, plant)
  } else {
    await opened.write((db) => createEntity(db, 'costItems', 'heiz', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 200000, key: 'area', heatingPlantId: plant }))
  }
}
const unserved = async (opened: OpenedDatabase, y = 2025) => (await settlement(opened, y)).notices.filter((n) => n.code === 'heating.unit-unserved')

test('Bestand: eigene Heizkostenabrechnung nach Tausch, Wohnung mit Fläche an keiner Anlage ergibt eine Warnung mit dem Weg', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'self', true)
    const found = await unserved(opened)
    assert.deepEqual(found.map((n) => /„(\w+)“ hängt/.exec(n.text)?.[1]), ['C', 'Leer'], found.map((n) => n.text).join('\n'))
    assert.match(found[0]?.text ?? '', /trägt deshalb keinen Anteil an den Heizkosten der Heizanlage „Gas“.*die übrigen Nutzer tragen ihn.*„Heizanlage ändern“/s)
    assert.equal(found[0]?.level, 'warning')
    assert.deepEqual(found[0]?.subject, { kind: 'heatingPlant', id: 'k1' })
    // Ohne Heizkosten im Zeitraum kein Hinweis.
    assert.deepEqual(await unserved(opened, 2026), [])
  })
})

test('Bestand: ohne Kesseltausch (Liste vom Vermieter) und bei freien Schlüsseln nach Tausch kein Hinweis', async () => {
  for (const [method, swap] of [['self', false], ['manual', true]] as const) {
    await withDatabase(async (opened) => {
      await bestand(opened, method, swap)
      assert.deepEqual(await unserved(opened), [], `${method} ${swap}`)
    })
  }
})
