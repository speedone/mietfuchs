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
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { saveInterimGap, setUpSelf } from '../src/db/heatingSelf.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { snapshotFor, type Snapshot } from '../src/snapshot.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

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

// ---------- Hinweise und Ausweis (Heizung PR 10, Entwurf 3.5, 8.5, 8.8, 10.1) ----------

const textOf = (s: ComputedSettlement, code: string): string => s.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${s.notices.map((n) => n.code).join(', ')}`)
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)

test('Ausweis: Töpfe mit Preisen je Einheit, Warmwasseranteil, Nutzer mit Gradtagen, Grenzen der Ablesung', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened))
    const self = s.heating?.[0]?.self ?? assert.fail('kein Ausweis')
    assert.equal(self.ok, true)
    assert.deepEqual(self.alpha && [Math.round(self.alpha.percent * 1000) / 1000, self.alpha.dhwHeatKwh, self.alpha.referenceKwh, self.alpha.reference], [15, 9000, 60000, 'fuel'])
    const heating = self.pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
    assert.deepEqual([heating.costCents, heating.consumptionPct, heating.areaM2, heating.consumption, heating.consumptionUnit], [562800, 70, 200, 40000, 'kWh'])
    assert.ok(Math.abs(heating.baseCentsPerM2 - 844.2) < 1e-9 && Math.abs((heating.consumptionCentsPerUnit ?? 0) - 9.849) < 1e-9)
    const water = self.pots.find((p) => p.pot === 'water') ?? assert.fail('Topf Warmwasser')
    assert.deepEqual([water.costCents, water.consumption, water.consumptionUnit], [103200, 120, 'm³'])
    const c = self.units.find((u) => u.unitId === 'c') ?? assert.fail('Wohnung C')
    assert.deepEqual(c.users.map((u) => [u.tenancyId, u.heatingConsumption, u.waterConsumption, u.heatingCents, u.waterCents]), [
      ['C1', 7200, 38, 103330, 29823], ['C2', 4800, 12, 65510, 9565],
    ])
    assert.deepEqual(c.boundaries.map((b) => [b.date, b.kind, b.status]), [['2024-12-31', 'start', 'read'], ['2025-09-30', 'change', 'read'], ['2025-12-31', 'end', 'read']])
  })
})

test('Z-B2: Wechsel ohne Zwischenablesung, „nicht durchgeführt“: § 9b Abs. 3 und bis zu 15 % auf die Heizkosten nach Abzug', async () => {
  await withDatabase(async (opened) => {
    await beispielA(opened, { skip: ['wc@2025-09-30', 'xc@2025-09-30'] })
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'missed', reason: '' }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    // Exakt 1.375,17666 € und 707,10334 € (heating.test.ts, Task 3); je Position nach #202 gerundet.
    assert.ok(Math.abs(sumOf(s, 'C1') - 137517.666) < 2 && Math.abs(sumOf(s, 'C2') - 70710.334) < 2, `${sumOf(s, 'C1')} / ${sumOf(s, 'C2')}`)
    const text = textOf(s, 'heating.no-interim-reading-missed')
    assert.match(text, /§ 9b Abs\. 1/)
    assert.match(text, /Bis zu 15 % der Heizkosten von Mieter C1 \(C\) 188,70 € und Mieter C2 \(C\) 97,00 €/)
    assert.match(text, /11 S 202\/87.*104a C 226\/05/s)
    assert.ok(!codes(s).includes('heating.no-interim-reading'))
  })
})

test('Zwischenablesung nicht möglich: ein Hinweis ohne Betrag; ohne Antwort die Warnung mit der Bitte um Antwort', async () => {
  await withDatabase(async (opened) => {
    await beispielA(opened, { skip: ['wc@2025-09-30', 'xc@2025-09-30'] })
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const ohne = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.match(textOf(ohne, 'heating.no-interim-reading-missed'), /bitte geben Sie auf der Seite Heizkosten an/)
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    const mit = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.match(textOf(mit, 'heating.no-interim-reading'), /nicht möglich: Wohnung nicht zugänglich.*§ 9b Abs\. 3/s)
    assert.ok(!codes(mit).includes('heating.no-interim-reading-missed'))
    // Durchsicht von #239, I3: Der Grund steht im Ausweis an der Grenze.
    const c = mit.heating?.[0]?.self?.units.find((u) => u.unitId === 'c')?.boundaries.find((b) => b.date === '2025-09-30')
    assert.deepEqual([c?.gap, c?.gapReason], ['impossible', 'Wohnung nicht zugänglich'])
    // Ohne Grund nimmt der Server „nicht möglich“ nicht an.
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: ' ' })), (e: unknown) => e instanceof Error && /Grund/.test(e.message))
  })
})

test('Z-B3 und Z-B1: Ablesung neben Wechsel und Stichtag gilt, wie sie ist, mit Tagen und Gradtagsanteil', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const verschoben = snap.readings.map((r) => {
      if (r.date === '2025-09-30') return { ...r, date: '2025-10-03' }
      if (r.date === '2024-12-31' && snap.meters.find((m) => m.id === r.meterId)?.unitId === 'b') return { ...r, date: '2025-01-05' }
      return r
    })
    const s = computeSettlement({ ...snap, readings: verschoben })
    assert.match(textOf(s, 'heating.interim-reading-off'), /C zum 30\.09\.2025 wurde am 03\.10\.2025 abgelesen \(3 Tage daneben, 7,7 ‰ der Gradtage\).*Vormieter/s)
    assert.match(textOf(s, 'heating.reading-dates-differ'), /31\.12\.2024.*B mit 5 Tagen.*27,4 ‰/s)
    assert.ok(!codes(s).includes('heating.reading-dates-far'))
  })
})

test('Kein Verbrauch erfasst: nur nach Fläche, 15 % auf den Anteil am unerfassten Topf nach CO₂-Abzug (Abweichung 15)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, meters: snap.meters.filter((m) => !(m.type === 'waerme' && m.unitId !== null)) })
    const text = textOf(s, 'heating.no-consumption')
    assert.match(text, /Für Heizung ist kein Verbrauch erfasst/)
    // 15 % auf den Topf Heizung nach CO₂-Abzug: A 1.688,40 € − 145,01 €, B 2.251,20 € − 193,34 €,
    // C1 1.080,58 € − 92,81 €, C2 607,82 € − 52,20 € (Abzüge 167,61 / 223,48 / 117,46 / 60,11 € nach dem
    // Anteil am Brennstoff im Topf Heizung; Herleitung im Kommentar der Abweichung 15).
    assert.match(text, /um 15 % kürzen \(§ 12 Abs\. 1 Satz 1 HeizkostenV\), hier vom Topf Heizung nach CO₂-Abzug laut Ausweis: Mieter A \(A\) 231,51 €, Mieter B \(B\) 308,68 €, Mieter C1 \(C\) 148,17 € und Mieter C2 \(C\) 83,34 €/)
  })
})

test('R-A7: ein anderer Anteil als in der Vorperiode ist ein Wechsel nach § 6 Abs. 4 (Hinweis)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const vorher = { ...(snap.heatingPeriodRows?.[0] ?? assert.fail('keine Zeile')), period: periodKey('2024-01'), heatConsumptionPct: 50, waterConsumptionPct: 50 }
    const s = computeSettlement({ ...snap, heatingPeriodRows: [...(snap.heatingPeriodRows ?? []), vorher] })
    assert.match(textOf(s, 'heating.key-change'), /50 % bei der Heizung.*jetzt 70 %.*§ 6 Abs\. 4 HeizkostenV/s)
  })
})

test('Pauschale: die Warnung nennt den Betrag nach der Heizkostenverordnung (Entwurf 6.3)', async () => {
  await withDatabase(async (opened) => {
    const s = computeSettlement(await beispielA(opened, { flatRateB: true }))
    assert.match(textOf(s, 'heating.flat-rate'), /Nach der Heizkostenverordnung entfielen auf Mieter B \(B\) 2\.615,84 €/)
  })
})

test('Wärmepumpe, deren Erfassung erst im Zeitraum eingebaut wurde: Hinweis, keine Kürzung (§ 12 Abs. 3 Satz 2)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const plants = (snap.heatingPlants ?? []).map((p) => ({ ...p, energy: 'heatPump' as const, hotWater: 'none' as const, capturedOnOct2024: false, captureInstalledOn: '2025-06-01' }))
    const items = snap.costItems.map((c) => (c.heatingTarget === 'both' || c.heatingTarget === 'water' ? { ...c, heatingTarget: 'heating' as const } : c))
    const s = computeSettlement({ ...snap, heatingPlants: plants, costItems: items, meters: snap.meters.filter((m) => !(m.type === 'waerme' && m.unitId !== null)) })
    assert.match(textOf(s, 'heating.heat-pump-capture'), /01\.10\.2024.*§ 12 Abs\. 3 HeizkostenV.*nach dem 01\.06\.2025 beginnt/s)
    assert.ok(!codes(s).includes('heating.no-consumption'), 'keine Kürzung, solange die Verordnung nicht gilt')
  })
})

test('Abweichung 11: beruht der Warmwasseranteil auf der Schätzung beim Abschluss, sagt ein Hinweis das', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const fuel = snap.fuel ?? assert.fail('keine Lieferungen im Schnappschuss')
    const s = computeSettlement({ ...snap, fuel: { ...fuel, deliveries: fuel.deliveries.map((d) => ({ ...d, estimated: true })) } })
    assert.match(textOf(s, 'heating.dhw-share-estimated'), /15 %.*geschätzten Energie.*Folgerechnung/s)
    assert.ok(!codes(computeSettlement(snap)).includes('heating.dhw-share-estimated'))
  })
})

test('Zeitanteilig statt nach Gradtagen: Hinweis mit beiden Beträgen (C1 1.386,21 € gegen 1.331,53 €)', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const plants = (snap.heatingPlants ?? []).map((p) => ({ ...p, changeSplit: 'time' as const }))
    const s = computeSettlement({ ...snap, heatingPlants: plants })
    assert.match(textOf(s, 'heating.change-split-time'), /Mieter C1 \(C\): zeitanteilig 1\.386,21 €, nach Gradtagen 1\.331,53 €/)
  })
})

test('Kosten der Zwischenablesung an einer Heizposition: Hinweis auf BGH VIII ZR 19/07', async () => {
  await withDatabase(async (opened) => {
    const snap = await beispielA(opened)
    const s = computeSettlement({ ...snap, costItems: snap.costItems.map((c) => (c.id === 'imm' ? { ...c, description: 'Zwischenablesung Mieterwechsel' } : c)) })
    assert.match(textOf(s, 'heating.change-fee'), /VIII ZR 19\/07.*nicht entschieden.*AG Berlin-Hohenschönhausen/s)
  })
})

test('R4/B5: freie Schlüssel, Position „nur Heizung“: Mieter April bis Oktober trägt 270 ‰, die kombinierte Position 214/365', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'W1', areaM2: 50, participates: true })
      await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'W2', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'T1', { unitId: 'u1', tenantName: 'Sommer', persons: 1, start: '2025-04-01', end: '2025-10-31' })
      await createEntity(db, 'tenancies', 'T2', { unitId: 'u2', tenantName: 'Ganzjahr', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      for (const [id, target] of [['nur', 'heating'], ['beides', null]] as const) {
        await createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', heatingTarget: target })
      }
    })
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.equal(shareOf(s, 'T1', 'nur'), 13500, '100.000 ct × 50 % × 270 ‰')
    assert.equal(shareOf(s, 'T1', 'beides'), 29315, '100.000 ct × 50 % × 214/365, wie vor dem Anlegen der Anlage (A2)')
    assert.deepEqual(partsOf(s, 'nur'), [{ reason: 'vacancy', cents: 36500 }])
    // Zeitanteilig eingestellt: dann auch „nur Heizung“ nach Tagen, und der Hinweis nennt beide Beträge.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { changeSplit: 'time' }))
    const t = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.equal(shareOf(t, 'T1', 'nur'), 29315)
    assert.match(textOf(t, 'heating.change-split-time'), /Sommer \(W1\): zeitanteilig 293,15 €, nach Gradtagen 135,00 €/)
  })
})

test('Testhelfer selfSnapshot (server/testing/selfHeating.ts) rechnet wie Beispiel A über die Datenbank', async () => {
  await withDatabase(async (opened) => {
    const ueberDb = computeSettlement(await beispielA(opened))
    const rein = computeSettlement(selfSnapshot())
    for (const t of ['A', 'B', 'C1', 'C2']) {
      for (const id of ITEMS) assert.equal(shareOf(rein, t, id), shareOf(ueberDb, t, id), `${t} ${id}`)
    }
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => sumOf(rein, t)), [196189, 261584, 133152, 75075])
    const relief = (s: ComputedSettlement, t: string) => s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.kind === 'co2Relief')?.shareCents ?? 0
    assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => relief(rein, t)), [-16761, -22348, -11340, -6417])
    assert.deepEqual(rein.heating?.[0]?.self?.alpha, ueberDb.heating?.[0]?.self?.alpha)
    assert.deepEqual(rein.heating?.[0]?.self?.dhw, ueberDb.heating?.[0]?.self?.dhw)
    assert.deepEqual(rein.notices.map((n) => n.code).sort(), ueberDb.notices.map((n) => n.code).sort())
  })
})
