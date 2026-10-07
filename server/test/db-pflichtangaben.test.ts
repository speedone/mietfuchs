// Pflichtangaben und Ausnahmen in der Datenbank (Heizung PR 14): Angaben nach § 6a je Heizperiode, Ausnahme,
// Vereinbarung, monatliche Information und Verbrauchervertrag ab einer Heizperiode, § 10 beim Anteil.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, updateProperty } from '../src/db/repository.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { saveDistribution, setUpSelf } from '../src/db/heatingSelf.ts'
import { saveHeatingInfo, saveHeatingRules } from '../src/db/heatingInfo.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { periodKey } from '../../shared/period.ts'
import { postalCodeOf } from '../../shared/heatingInfo.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-pflichtangaben-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)
let ids = 0
const newId = () => `m-${++ids}`

// Drei Wohnungen (oder die angegebenen), Gasheizung mit freien Schlüsseln.
async function haus(opened: Opened, wohnungen: readonly (readonly [string, number, boolean])[] = [['a', 60, false], ['b', 80, false], ['c', 60, false]]): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area, selbst] of wohnungen) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: !selbst, selfUsed: selbst })
      if (!selbst) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}
const SETUP = { period: '2026-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }

test('Angaben nach § 6a speichern: Klimafaktoren und Vergleichswert über 0 und nur mit Quelle; abgeschlossen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const save = (body: Record<string, unknown>) => opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', body))
    const saved = await save({ infoTaxesText: ' Energiesteuer 312,00 € ', climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: ' DWD, Klimafaktoren 79100 ' })
    assert.deepEqual(saved, {
      infoTaxesText: 'Energiesteuer 312,00 €', infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15,
      climateFactorSource: 'DWD, Klimafaktoren 79100', infoReferenceKwhPerM2: null, infoReferenceSource: null, postalCode: null,
    })
    await assert.rejects(save({ climateFactor: 0 }), status(400, /Klimafaktor.*größer als 0/))
    await assert.rejects(save({ climateFactorSource: '' }), status(400, /Quelle der Klimafaktoren/))
    // Nr. 4: Vergleichswert über 0 und nur mit Quelle; ein Hausdurchschnitt ist keiner.
    await assert.rejects(save({ infoReferenceKwhPerM2: 120 }), status(400, /Quelle des Vergleichswerts.*eigenen Haus/))
    await assert.rejects(save({ infoReferenceKwhPerM2: 0, infoReferenceSource: 'Ablesedienst' }), status(400, /Vergleichswert.*größer als 0/))
    const ref = await save({ infoReferenceKwhPerM2: 120, infoReferenceSource: ' Vergleichswerte des Ablesedienstes 2026 ' })
    assert.deepEqual([ref?.infoReferenceKwhPerM2, ref?.infoReferenceSource], [120, 'Vergleichswerte des Ablesedienstes 2026'])
    await assert.rejects(save({ infoReferenceSource: '' }), status(400, /Quelle des Vergleichswerts/))
    assert.equal((await save({ infoReferenceKwhPerM2: null, infoReferenceSource: null }))?.infoReferenceKwhPerM2, null)
    await assert.rejects(save({ infoDistrictPef: -1 }), status(400, /Primärenergiefaktor.*ab 0/))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2026-01'), closedAt: '2027-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(save({ infoTaxesText: 'x' }), status(409, /abgeschlossen/))
    assert.equal(await opened.write((db) => saveHeatingInfo(db, 'gibt-es-nicht', '2026-01', {})), null)
  })
})

test('Angaben beim Messdienst: 400; bei einer Etagenheizung gilt die Verordnung nicht', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'service' }))
    await assert.rejects(opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', { infoTaxesText: 'x' })), status(400, /Messdienst/))
    // Die monatliche Information betrifft auch den Messdienst.
    assert.equal((await opened.write((db) => saveHeatingRules(db, 'hp', '2026-01', { monthlyInfoElsewhere: true })))?.monthlyInfoElsewhere, true)
  })
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true }))
    await opened.write((db) => createHeatingPlant(db, 'etage', 'objekt-1', { energy: 'gas', method: 'manual', supply: 'perUnit' }))
    await assert.rejects(opened.write((db) => saveHeatingRules(db, 'etage', '2026-01', { exemption: 'lowDemand' })), status(400, /Etagenheizungen.*§ 1 Abs\. 1/))
  })
})

test('Postleitzahl aus der Adresse, in der Ansicht je Heizperiode', async () => {
  assert.equal(postalCodeOf('Lindenweg 3, 79100 Freiburg'), '79100')
  assert.equal(postalCodeOf('Lindenweg 3'), null)
  assert.equal(postalCodeOf(null), null)
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => updateProperty(db, 'objekt-1', { address: 'Lindenweg 3, 79100 Freiburg' }))
    await opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', { climateFactor: 1.08, climateFactorSource: 'DWD' }))
    const [view] = (await opened.read((db) => heatingPeriodViews(db, 'hp', '2026', '2025-12-01'))) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.info.climateFactor, view?.info.postalCode], [1.08, '79100'])
  })
})

test('Review Focus 5: § 10 – mehr als 70 % nur mit Vereinbarung, nie über 100 %, beim Pflichtanteil nie darunter', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 80 }, '2025-12-01', newId)), status(400, /§ 10 HeizkostenV.*vereinbart/))
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 80, above70Agreed: true }, '2025-12-01', newId))
    assert.equal(ok?.plant.method, 'self')
    const row = (await opened.read(readStock)).heatingPeriodRows.find((r) => r.plantId === 'hp' && r.period === '2026-01')
    assert.deepEqual([row?.heatConsumptionPct, row?.above70Agreed], [80, true])
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 101, waterConsumptionPct: 70, insulationRule: 'notApplies', above70Agreed: true }, '2026-11-01')), status(400, /höchstens 100 %/))
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 60, waterConsumptionPct: 70, insulationRule: 'applies' }, '2026-11-01')), status(400, /§ 7 Abs\. 1 Satz 2/))
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies' }, '2026-11-01')), status(400, /§ 10 HeizkostenV/))
    const pflichtMehr = await opened.write((db) => saveDistribution(db, 'hp', '2027-01', { heatConsumptionPct: 85, waterConsumptionPct: 70, insulationRule: 'applies', above70Agreed: true }, '2026-11-01'))
    assert.deepEqual([pflichtMehr?.effective?.heating, pflichtMehr?.effective?.above70Agreed], [85, true])
  })
})

test('Review Focus 3: Vereinbarung nach § 2 nur im Haus mit höchstens zwei Wohnungen, eine selbst bewohnt; „keine“ geht immer', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => saveHeatingRules(db, 'hp', '2026-01', { agreedOtherwise: 'area' })), status(400, /§ 2 HeizkostenV.*höchstens zwei Wohnungen/))
    assert.equal((await opened.write((db) => saveHeatingRules(db, 'hp', '2026-01', { agreedOtherwise: 'none' })))?.agreedOtherwise, 'none')
  })
  await withDatabase(async (opened) => {
    await haus(opened, [['a', 90, true], ['b', 70, false]])
    assert.equal((await opened.write((db) => saveHeatingRules(db, 'hp', '2026-01', { agreedOtherwise: 'area' })))?.agreedOtherwise, 'area')
    assert.equal((await opened.write((db) => saveHeatingRules(db, 'hp', '2026-01', { agreedOtherwise: null })))?.agreedOtherwise, null)
  })
})

test('Ausnahme nach § 11: Umfang und vereinbarte Abrechnung nur mit Ausnahme; gilt ab der Heizperiode, nie zurück; abgeschlossen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const rules = (period: string, body: Record<string, unknown>) => opened.write((db) => saveHeatingRules(db, 'hp', period, body))
    const mit = await rules('2026-01', { exemption: 'pre1981', exemptionScope: 'both', exemptionBillingAgreed: true })
    assert.deepEqual([mit?.exemption, mit?.exemptionScope, mit?.exemptionBillingAgreed], ['pre1981', 'both', true])
    const ohne = await rules('2026-01', { exemption: 'none' })
    assert.deepEqual([ohne?.exemption, ohne?.exemptionScope, ohne?.exemptionBillingAgreed], ['none', null, null])
    // Ohne eigene Antwort zur Ausnahme gibt es auch keinen Umfang und keine vereinbarte Abrechnung in der Zeile.
    const leer = await rules('2028-01', { exemptionScope: 'both', exemptionBillingAgreed: true })
    assert.deepEqual([leer?.exemption, leer?.exemptionScope, leer?.exemptionBillingAgreed], [null, null, null])
    await rules('2026-01', { exemption: 'lowDemand' })
    const view = async (p: string) => ((await opened.read((db) => heatingPeriodViews(db, 'hp', p, '2025-12-01'))) ?? assert.fail('keine Anlage'))[0] ?? assert.fail('keine Heizperiode')
    // 2025 bleibt ohne Ausnahme; 2027 erbt sie aus 2026, nur die Wärme.
    assert.deepEqual([(await view('2025')).rules.exemption, (await view('2027')).rules.exemption, (await view('2027')).rules.exemptionScope, (await view('2027')).rules.fromPeriod.exemption], ['none', 'lowDemand', 'heat', '2026-01'])
    assert.equal((await view('2027')).ownRules.exemption, null)
    await assert.rejects(rules('2026-01', { exemption: 'heim' }), status(400, /Ausnahme kennt Mietfuchs nicht/))
    await assert.rejects(rules('2026-01', { consumerContract: '  ' }), status(400, /Streitbeilegung/))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2026-01'), closedAt: '2027-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(rules('2026-01', { exemption: 'none' }), status(409, /abgeschlossen/))
  })
})

test('Kesseltausch: die neue Anlage erbt Ausnahme und Bestätigung der alten', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => saveHeatingRules(db, 'hp', '2025-01', { exemption: 'authority', exemptionScope: 'both', monthlyInfoElsewhere: true }))
    const neu = await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2026-01-01', energy: 'oil' }))
    const id = neu?.plant.id ?? assert.fail('keine neue Anlage')
    const [v] = (await opened.read((db) => heatingPeriodViews(db, id, '2026', '2025-12-01'))) ?? assert.fail('keine Anlage')
    assert.deepEqual([v?.rules.exemption, v?.rules.exemptionScope, v?.rules.monthlyInfoElsewhere], ['authority', 'both', true])
  })
})
