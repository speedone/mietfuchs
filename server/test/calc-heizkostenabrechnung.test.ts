// Die eigene Heizkostenabrechnung in der Abrechnung (Heizung PR 10, Entwurf 6.1, 6.2, 8): Beispiel A
// über die Datenbank, Leerstand, Eigennutzung und Pauschale als Nutzer, eine nicht verteilbare Anlage,
// ein Ziel, das nicht passt, der Warmwasseranteil mit Lücke und bei der Wärmepumpe, der fehlende Vorrat,
// und der CO₂-Abzug nach dem Anteil am Brennstoff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { snapshotFor, type Snapshot } from '../src/snapshot.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-calc-heizkosten-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
let ids = 0
const newId = () => `m-${++ids}`

type Options = {
  energy?: string
  tenantsB?: boolean
  selfA?: boolean
  flatRateB?: boolean
  skip?: string[]
  delivery?: { from: string; to: string; energyKwh: number; link: boolean }
}
// Beispiel A (Entwurf 8.6) in der Datenbank: drei Wohnungen, Wechsel in C zum 30.09.2025 mit
// Zwischenablesung, Gas mit eigener Abrechnung, Wärme- und Warmwasserzähler, Wärmezähler am Speicher.
// `skip` nennt Ablesungen als `Zähler@Datum`, die fehlen sollen.
async function beispielA(opened: Opened, o: Options = {}): Promise<Snapshot> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: !(o.selfA && u === 'a'), selfUsed: o.selfA === true && u === 'a' })
    }
    if (!o.selfA) await createEntity(db, 'tenancies', 'A', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    if (o.tenantsB !== false) await createEntity(db, 'tenancies', 'B', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01', heatingModel: o.flatRateB ? 'flatRate' : 'settlement' })
    await createEntity(db, 'tenancies', 'C1', { unitId: 'c', tenantName: 'Mieter C1', persons: 1, start: '2020-01-01', end: '2025-09-30' })
    await createEntity(db, 'tenancies', 'C2', { unitId: 'c', tenantName: 'Mieter C2', persons: 1, start: '2025-10-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: o.energy ?? 'gas', method: 'manual' })
    await setUpSelf(db, 'hp', {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false,
    }, '2026-02-01', newId)
  })
  const meters = (await opened.read(readStock)).meters
  const meterOf = (unitId: string | null, type: string, role: string | null = null) =>
    meters.find((m) => m.unitId === unitId && m.type === type && (m.heatingRole ?? null) === role)?.id ?? assert.fail(`kein Zähler ${unitId} ${type}`)
  const readings: [string, string, string, number][] = [
    ['wa', meterOf('a', 'waerme'), '2024-12-31', 1000], ['wa', meterOf('a', 'waerme'), '2025-12-31', 13000],
    ['wb', meterOf('b', 'waerme'), '2024-12-31', 0], ['wb', meterOf('b', 'waerme'), '2025-12-31', 16000],
    ['wc', meterOf('c', 'waerme'), '2024-12-31', 500], ['wc', meterOf('c', 'waerme'), '2025-09-30', 7700], ['wc', meterOf('c', 'waerme'), '2025-12-31', 12500],
    ['xa', meterOf('a', 'warmwasser'), '2024-12-31', 10], ['xa', meterOf('a', 'warmwasser'), '2025-12-31', 40],
    ['xb', meterOf('b', 'warmwasser'), '2024-12-31', 0], ['xb', meterOf('b', 'warmwasser'), '2025-12-31', 40],
    ['xc', meterOf('c', 'warmwasser'), '2024-12-31', 5], ['xc', meterOf('c', 'warmwasser'), '2025-09-30', 43], ['xc', meterOf('c', 'warmwasser'), '2025-12-31', 55],
    ['ww', meterOf(null, 'waerme', 'dhwHeat'), '2024-12-31', 0], ['ww', meterOf(null, 'waerme', 'dhwHeat'), '2025-12-31', 9000],
  ]
  const d = o.delivery ?? { from: '2025-01-01', to: '2025-12-31', energyKwh: 60000, link: true }
  await opened.write(async (db) => {
    for (const [name, meterId, date, value] of readings) {
      if ((o.skip ?? []).includes(`${name}@${date}`)) continue
      await createEntity(db, 'readings', `${name}-${date}`, { meterId, date, value })
    }
    await createDelivery(db, 'd1', 'hp', {
      label: 'Erdgas', invoiceDate: '2026-01-15', invoiceFrom: d.from, invoiceTo: d.to, energyKwh: d.energyKwh, fixedCents: 0,
      emissionsKg: 10883.4, co2CostCents: 59859,
    })
    const item = (id: string, description: string, amountCents: number, heatingPart: string, heatingTarget: string, extra: Record<string, unknown> = {}) =>
      createEntity(db, 'costItems', id, {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
      })
    await item('gas', 'Erdgas', 600000, 'fuel', 'both', d.link ? { fuelDeliveryId: 'd1' } : {})
    await item('strom', 'Betriebsstrom', 18000, 'operating', 'both')
    await item('wartung', 'Wartung', 24000, 'operating', 'both')
    await item('imm', 'Immissionsmessung', 6000, 'operating', 'both')
    await item('wz', 'Miete Wärmezähler', 12000, 'metering', 'heating')
    await item('wwz', 'Miete Warmwasserzähler', 6000, 'metering', 'water')
  })
  const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  return snapshotFor(await opened.read(readStock), 'objekt-1', p)
}
const ITEMS = ['gas', 'strom', 'wartung', 'imm', 'wz', 'wwz']
const shareOf = (s: ComputedSettlement, tenancyId: string, itemId: string): number =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((r) => r.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
const sumOf = (s: ComputedSettlement, tenancyId: string): number => ITEMS.reduce((a, id) => a + shareOf(s, tenancyId, id), 0)
const errors = (s: ComputedSettlement) => s.notices.filter((n) => n.level === 'error').map((n) => n.code)
const partsOf = (s: ComputedSettlement, itemId: string) => s.landlord.rows.find((r) => r.costItemId === itemId)?.landlordParts ?? []

test('Beispiel A über die Datenbank: je Position nach #202, zusammen 1.961,89 / 2.615,84 / 1.331,52 / 750,75 €', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    assert.deepEqual(errors(s), [])
    const table: Record<string, [number, number, number, number]> = {
      gas: [176850, 235800, 119644, 67706], strom: [5306, 7074, 3589, 2031], wartung: [7074, 9432, 4786, 2708],
      imm: [1769, 2358, 1196, 677], wz: [3600, 4800, 2203, 1397], wwz: [1590, 2120, 1734, 556],
    }
    for (const [id, cents] of Object.entries(table)) {
      assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => shareOf(s, t, id)), cents, id)
      assert.equal(s.landlord.rows.find((r) => r.costItemId === id), undefined, `${id}: nichts beim Vermieter`)
    }
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => sumOf(s, t)), [196189, 261584, 133152, 75075])
    // Der Rechenweg nennt Grund- und Verbrauchskosten, den Warmwasseranteil und den Anteil.
    const steps = s.statements.find((st) => st.tenancyId === 'C1')?.rows.find((r) => r.costItemId === 'gas')?.steps ?? []
    assert.ok(steps.some((x) => x.label === 'Grundkosten Heizung' && /640 von 1\.000 ‰ Gradtage/.test(x.value)), JSON.stringify(steps))
    assert.ok(steps.some((x) => x.label === 'Verbrauchskosten Heizung' && /7\.200 von 40\.000 kWh/.test(x.value)))
    assert.ok(steps.some((x) => x.label === 'Warmwasseranteil' && /^15 %/.test(x.value)))
  })
})

test('CO₂ bei eigener Abrechnung: Abzug nach dem Anteil am Brennstoff (9.4), R = 568,66 €', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    const relief = (t: string) => s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.kind === 'co2Relief')?.shareCents ?? 0
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map(relief), [-16761, -22348, -11340, -6417])
    assert.equal(s.heating?.[0]?.co2?.landlordPermille, 950)
  })
})

test('Leerstand ist Nutzer: der Anteil der leeren Wohnung B bleibt exakt als Leerstand beim Vermieter', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { tenantsB: false }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'vacancy', cents: 235800 }])
    assert.equal(shareOf(s, 'A', 'gas'), 176850, 'A trägt dasselbe wie mit vermieteter Wohnung B')
  })
})

test('Eigennutzung ist Nutzer: Eigenanteil exakt, und er zählt in den Eigenanteil der Abrechnung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { selfA: true }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'selfUse', cents: 176850 }])
    assert.ok(Math.abs(s.selfUsedShareCents - 196188) <= ITEMS.length, `Eigenanteil ${s.selfUsedShareCents}`)
  })
})

test('Pauschale: der Anteil nach der Verordnung fällt dem Vermieter zu, als Pauschale', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { flatRateB: true }))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'flatRate', cents: 235800 }])
  })
})

test('Review Focus 4: fehlt ein Stand am Ende der Heizperiode, wird die Anlage nicht verteilt, mit einem Fehler', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { skip: ['wc@2025-12-31'] }))
    assert.deepEqual(errors(s), ['heating.self-incomplete'])
    assert.match(s.notices.find((n) => n.code === 'heating.self-incomplete')?.text ?? '', /Wärme C.*31\.12\.2025.*§ 9a/s)
    for (const id of ITEMS) {
      const row = s.landlord.rows.find((r) => r.costItemId === id) ?? assert.fail(id)
      assert.deepEqual(row.landlordParts, [{ reason: 'noBasis', cents: row.totalCents }], id)
    }
  })
})

test('Ein Ziel, das nicht zur Warmwasserbereitung passt, wird nicht verteilt', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, costItems: snap.costItems.map((c) => (c.id === 'gas' ? { ...c, heatingTarget: 'heating' } : c)) })
    assert.ok(errors(s).includes('heating.target-invalid'))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
    assert.equal(shareOf(s, 'A', 'strom'), 5306, 'die übrigen Positionen bleiben')
  })
})

test('Review Focus 5: deckt die Gasrechnung die Heizperiode nicht ab, ist der Warmwasseranteil nicht bestimmbar', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { delivery: { from: '2025-03-15', to: '2025-12-31', energyKwh: 50000, link: true } }))
    assert.ok(errors(s).includes('heating.dhw-share-invalid'))
    assert.match(s.notices.find((n) => n.code === 'heating.dhw-share-invalid')?.text ?? '', /Folgerechnung.*Schätzung/s)
  })
})

test('A8: Wärmepumpe mit Wärmezähler am Warmwasser, aber ohne Gesamtwärmezähler: keine Verteilung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { energy: 'heatPump' }))
    assert.ok(errors(s).includes('heating.heat-pump-dhw-basis'))
    assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
  })
})
