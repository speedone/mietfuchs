// Monatliche Verbrauchsinformation in der Datenbank (Heizung PR 22): Tabelle heating_monthly_info mit ihren
// Bedingungen, Schreiben je Anlage und Monat, die Ansicht je Heizperiode für die Seite Heizkosten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { type OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { databaseProblem } from '../src/db/errors.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { saveHeatingRules } from '../src/db/heatingInfo.ts'
import { monthlyInfoView, saveMonthlyInfoRow } from '../src/db/monthlyInfo.ts'
import { saveDhwTemperature } from '../src/db/co2.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verbrauchsinfo-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)
async function messageOfFailure(work: () => Promise<unknown>): Promise<string> {
  try {
    await work()
  } catch (err) {
    const problem = databaseProblem(err)
    if (!problem) return assert.fail(`der Fehler gilt nicht als einer der Datenbank: ${String(err)}`)
    return problem.message
  }
  return assert.fail('der Verstoß hat gar keinen Fehler ausgelöst')
}
let ids = 0
const newId = () => `m-${++ids}`

test('Prüfbedingungen: Monat JJJJ-MM, Vergleichswert > 0 nur mit Quelle, Tag als Datum, je Monat einmal; fällt mit der Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    const ins = (month: string, ref: string, source: string, sent: string) => messageOfFailure(() => opened.write((db) => db.run(sql.raw(
      `INSERT INTO heating_monthly_info (plant_id, month, reference_kwh_per_m2, reference_source, sent_on) VALUES ('hp', '${month}', ${ref}, ${source}, ${sent})`))))
    await opened.write((db) => db.run(sql.raw("INSERT INTO heating_monthly_info (plant_id, month, reference_kwh_per_m2, reference_source, sent_on) VALUES ('hp', '2025-11', 10, 'Ablesedienst', '2025-12-05')")))
    await opened.write((db) => db.run(sql.raw("INSERT INTO heating_monthly_info (plant_id, month) VALUES ('hp', '2025-10')")))
    assert.match(await ins('2025-13', 'NULL', 'NULL', 'NULL'), /kein Monat in der Form JJJJ-MM/)
    assert.match(await ins('25-01', 'NULL', 'NULL', 'NULL'), /kein Monat in der Form JJJJ-MM/)
    assert.match(await ins('2025-09', '0', "'x'", 'NULL'), /Vergleichswert ist eine Zahl größer als 0 \(kWh je m² Wohnfläche im Monat\)/)
    assert.match(await ins('2025-08', '10', 'NULL', 'NULL'), /Quelle des Vergleichswerts/)
    assert.match(await ins('2025-07', '10', "'  '", 'NULL'), /Quelle des Vergleichswerts/)
    assert.match(await ins('2025-06', 'NULL', 'NULL', "'5.12.2025'"), /Tag der Mitteilung ist kein Datum/)
    assert.match(await ins('2025-11', 'NULL', 'NULL', 'NULL'), /gibt es schon/)
    await opened.write((db) => db.run(sql.raw("DELETE FROM heating_plants WHERE id = 'hp'")))
    assert.deepEqual((await opened.read(readStock)).monthlyInfoRows, [])
  })
})

test('Schreiben: Teilrumpf ergänzt, null leert, Quelle getrimmt; ohne Anlage null; im Bestand gelesen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    const save = (month: string, body: Record<string, unknown>) => opened.write((db) => saveMonthlyInfoRow(db, 'hp', month, body))
    assert.deepEqual(await save('2025-11', { referenceKwhPerM2: 10, referenceSource: ' Ablesedienst Beispiel ' }),
      { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: null })
    assert.deepEqual(await save('2025-11', { sentOn: '2025-12-05' }),
      { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' })
    assert.deepEqual(await save('2025-11', { referenceKwhPerM2: null, referenceSource: null }),
      { plantId: 'hp', month: '2025-11', referenceKwhPerM2: null, referenceSource: null, sentOn: '2025-12-05' })
    assert.deepEqual((await opened.read(readStock)).monthlyInfoRows, [{ plantId: 'hp', month: '2025-11', referenceKwhPerM2: null, referenceSource: null, sentOn: '2025-12-05' }])
    assert.equal(await opened.write((db) => saveMonthlyInfoRow(db, 'gibt-es-nicht', '2025-11', {})), null)
  })
})

test('Review Focus 5 und Prüfungen: Mitteilung frühestens nach Monatsende; Vergleichswert nur mit Quelle und über 0; Monat in Form', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    const save = (month: string, body: Record<string, unknown>) => opened.write((db) => saveMonthlyInfoRow(db, 'hp', month, body))
    await assert.rejects(save('2025-11', { sentOn: '2025-11-30' }), status(400, /November 2025 nennt den Verbrauch des ganzen Monats und kann frühestens am 01\.12\.2025 mitgeteilt werden/))
    assert.equal((await save('2025-11', { sentOn: '2025-12-01' }))?.sentOn, '2025-12-01')
    await assert.rejects(save('2025-11', { sentOn: '05.12.2025' }), status(400, /kein Datum/))
    // Kann-Befund K3: nicht in der Zukunft, sonst gälte der Monat vorab als mitgeteilt.
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '2025-12-05' }, '2025-12-03')), status(400, /liegt nach dem heutigen Tag/))
    assert.equal((await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '2025-12-03' }, '2025-12-03')))?.sentOn, '2025-12-03')
    await assert.rejects(save('2025-11', { sentOn: '2025-02-30' }), status(400, /kein Datum/))
    await assert.rejects(save('2025-10', { referenceKwhPerM2: 10 }), status(400, /Quelle.*eigenen Haus/))
    await assert.rejects(save('2025-10', { referenceKwhPerM2: 0, referenceSource: 'x' }), status(400, /größer als 0/))
    await assert.rejects(save('2025-10', { referenceKwhPerM2: '10', referenceSource: 'x' }), status(400, /größer als 0/))
    await assert.rejects(save('2025-13', {}), status(400, /kein Monat/))
    // Nichts davon wurde geschrieben.
    assert.deepEqual((await opened.read(readStock)).monthlyInfoRows.map((r) => r.month), ['2025-11'])
  })
})

// Ein Haus mit zwei Wohnungen, eigene Abrechnung mit Wärme- und Warmwasserzählern (Heizperiode 2025).
async function haus(opened: OpenedDatabase, hotWater: 'combined' | 'separate' = 'combined'): Promise<string[]> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 40]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
  const setup = await opened.write((db) => setUpSelf(db, 'hp', { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater, capture: 'heatMeter', dhwHeatMeter: hotWater === 'combined', totalHeatMeter: false }, '2025-12-10', newId))
  return (setup?.created ?? []).filter((m) => m.unitId !== null).map((m) => m.id)
}

test('Ansicht: ohne fernablesbares Gerät nicht erstellt; mit einem die Monate je Mieter; bestätigt „anders mitgeteilt“', async () => {
  await withDatabase(async (opened) => {
    const meterIds = await haus(opened)
    const view = (today = '2025-12-10') => opened.read((db) => monthlyInfoView(db, 'hp', '2025-01', today))
    const leer = await view() ?? assert.fail('keine Anlage')
    assert.deepEqual([leer.managed, leer.months], [false, []])
    const stock = await opened.read(readStock)
    const waermeA = stock.meters.find((m) => meterIds.includes(m.id) && m.unitId === 'a' && m.type === 'waerme') ?? assert.fail('kein Wärmezähler A')
    await opened.write((db) => updateEntity(db, 'meters', waermeA.id, { remoteReadable: true }))
    for (const [date, value] of [['2025-10-31', 5400], ['2025-11-30', 6100]] as const) {
      await opened.write((db) => createEntity(db, 'readings', newId(), { meterId: waermeA.id, date, value }))
    }
    await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }))
    const v = await view() ?? assert.fail('keine Anlage')
    assert.deepEqual([v.plantId, v.period, v.managed, v.elsewhere, v.periodReference], ['hp', '2025-01', true, false, null])
    assert.equal(v.months.length, 12)
    const nov = v.months.find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
    assert.deepEqual([nov.due, nov.sent, nov.mixed, nov.row?.sentOn], [true, true, true, '2025-12-05'])
    const a = nov.users.find((u) => u.tenancyId === 'ta') ?? assert.fail('Mieter A fehlt')
    assert.deepEqual([a.heatKwh, a.remote, a.referenceKwh], [700, false, 600])
    assert.equal(v.months.find((m) => m.month === '2025-12')?.due, false)
    await opened.write((db) => saveHeatingRules(db, 'hp', '2025-01', { monthlyInfoElsewhere: true }))
    assert.equal((await view())?.elsewhere, true)
    await assert.rejects(opened.read((db) => monthlyInfoView(db, 'hp', '2025-13', '2025-12-10')), status(400, /.+/))
    assert.equal(await opened.read((db) => monthlyInfoView(db, 'gibt-es-nicht', '2025-01', '2025-12-10')), null)
  })
})

test('Prüfung S5: Kesseltausch – gespeichert an der Anlage, die am Monatsende heizt; die Ansicht liest die Linie', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const replaced = await opened.write((db) => replaceHeatingPlant(db, 'hp', 'neu', { date: '2025-06-16', energy: 'districtHeating' }))
    assert.equal(replaced?.previous.endsOn, '2025-06-15')
    const vorher = await opened.write((db) => saveMonthlyInfoRow(db, 'neu', '2025-03', { sentOn: '2025-04-02' }))
    const nachher = await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { sentOn: '2025-12-02' }))
    assert.deepEqual([vorher?.plantId, nachher?.plantId], ['hp', 'neu'])
  })
})

test('Getrenntes Warmwasser: die Temperatur für die Umrechnung lässt sich hier eintragen, und dann ist der Monat vollständig', async () => {
  await withDatabase(async (opened) => {
    const meterIds = await haus(opened, 'separate')
    const stock = await opened.read(readStock)
    const mine = stock.meters.filter((m) => meterIds.includes(m.id) && m.unitId === 'a')
    assert.deepEqual(mine.map((m) => m.type).sort(), ['waerme', 'warmwasser'])
    // Nur die Wohnung A, damit nur ihre Lücken zählen.
    await opened.write(async (db) => {
      await updateEntity(db, 'tenancies', 'tb', { end: '2024-12-31' })
      for (const m of mine) {
        await updateEntity(db, 'meters', m.id, { remoteReadable: true })
        for (const [date, value] of [['2025-10-31', m.type === 'waerme' ? 5400 : 20], ['2025-11-30', m.type === 'waerme' ? 6100 : 22.5]] as const) {
          await createEntity(db, 'readings', newId(), { meterId: m.id, date, value })
        }
      }
    })
    await opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2025-11', { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }))
    const nov = async () => (await opened.read((db) => monthlyInfoView(db, 'hp', '2025-01', '2025-12-10')))?.months.find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
    const vorher = await opened.read((db) => monthlyInfoView(db, 'hp', '2025-01', '2025-12-10'))
    assert.deepEqual(vorher?.dhwTemp, { tempC: null, here: true })
    assert.deepEqual([(await nov()).complete, (await nov()).users[0]?.gaps], [false, ['dhwTemp']])
    // Dieselbe Prüfung wie in der Karte „Warmwasser“, derselbe Speicherort (heating_periods.dhw_temp_c).
    await assert.rejects(opened.write((db) => saveDhwTemperature(db, 'hp', '2025-01', { dhwTempC: 120 })), status(400, /zwischen 0 und 100 °C/))
    await assert.rejects(opened.write((db) => saveDhwTemperature(db, 'hp', '2025-01', { dhwTempC: 'warm' })), status(400, /keine Zahl/))
    assert.deepEqual(await opened.write((db) => saveDhwTemperature(db, 'hp', '2025-01', { dhwTempC: 55 })), { dhwTempC: 55 })
    const row = (await opened.read(readStock)).heatingPeriodRows.find((r) => r.plantId === 'hp' && String(r.period) === '2025-01')
    assert.equal(row?.dhwTempC, 55)
    const n = await nov()
    assert.deepEqual([n.complete, n.users[0]?.dhwKwh, n.users[0]?.gaps], [true, 281.25, []])
    assert.equal(await opened.write((db) => saveDhwTemperature(db, 'gibt-es-nicht', '2025-01', { dhwTempC: 55 })), null)
  })
})

test('Verbundenes Warmwasser: die Temperatur gehört in die Karte „Warmwasser“, nicht hierher', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    assert.deepEqual((await opened.read((db) => monthlyInfoView(db, 'hp', '2025-01', '2025-12-10')))?.dhwTemp, { tempC: null, here: false })
    await assert.rejects(opened.write((db) => saveDhwTemperature(db, 'hp', '2025-01', { dhwTempC: 55 })), status(400, /Karte „Warmwasser“/))
  })
})

// Prüfung K2 zu Heizung PR 22: Die Karte fordert keine Monate ein, für die die Abrechnung keine Information nach § 6a
// verlangt. Gilt die Verordnung für die Wärmepumpe nach § 12 Abs. 3 HeizkostenV noch nicht, oder galt die Ausnahme des
// § 11 Abs. 1 Nr. 3 Buchst. a a. F. (überwiegend Wärme aus der Wärmepumpe), erstellt Mietfuchs keine Monate; dieselbe
// Regel wie calc.ts (`heatPumpWithoutMonthlyInfo`).
async function waermepumpe(opened: OpenedDatabase, period: string, plant: Record<string, unknown>): Promise<boolean> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 40]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'heatPump', method: 'manual' })
    await updateHeatingPlant(db, 'hp', plant)
  })
  const setup = await opened.write((db) => setUpSelf(db, 'hp', { period, heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }, `${period.slice(0, 4)}-12-10`, newId))
  const meter = (setup?.created ?? []).find((m) => m.unitId === 'a' && m.type === 'waerme') ?? assert.fail('kein Wärmezähler A')
  await opened.write((db) => updateEntity(db, 'meters', meter.id, { remoteReadable: true }))
  const view = await opened.read((db) => monthlyInfoView(db, 'hp', period, `${period.slice(0, 4)}-12-10`)) ?? assert.fail('keine Anlage')
  return view.managed
}

test('Prüfung K2: Wärmepumpe, deren Verbrauch noch nicht erfasst werden muss (§ 12 Abs. 3): keine Monate', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await waermepumpe(opened, '2025-01', { capturedOnOct2024: false }), false)
  })
  await withDatabase(async (opened) => {
    // Gegenprobe: am 01.10.2024 schon erfasst, die Verordnung gilt.
    assert.equal(await waermepumpe(opened, '2025-01', { capturedOnOct2024: true }), true)
  })
})

test('Prüfung K2: alte Ausnahme der Wärmepumpe (§ 11 Abs. 1 Nr. 3 Buchst. a a. F.): keine Monate, offen gefragt aber schon', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await waermepumpe(opened, '2024-01', { capturedOnOct2024: true, heatPumpMajority: 'yes' }), false)
  })
  await withDatabase(async (opened) => {
    // Ohne Antwort rechnet die Abrechnung mit der Information (`majorityOpen`); die Karte ebenso.
    assert.equal(await waermepumpe(opened, '2024-01', { capturedOnOct2024: true }), true)
  })
  await withDatabase(async (opened) => {
    assert.equal(await waermepumpe(opened, '2024-01', { capturedOnOct2024: true, heatPumpMajority: 'no' }), true)
  })
})
