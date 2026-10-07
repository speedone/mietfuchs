// Heizkostenverteiler mit Skala und Faktor und Werte eines Ablesedienstes in der Datenbank (Heizung
// PR 12, Entwurf 5.6, 8.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readHeatingPlants, readMeters } from '../src/db/read.ts'
import { closeSettlement, createEntity, createProperty, crossPropertyViolations, HeatingError, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { dropIfEmpty, heatingPeriodViews } from '../src/db/co2.ts'
import { saveServiceValues } from '../src/db/serviceValues.ts'
import { heatingSelfSpans, heatingServiceValues } from '../src/db/schema.ts'
import { eq } from 'drizzle-orm'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-hkv-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const heatingError = (status: 400 | 409, text: RegExp) => (err: unknown) =>
  err instanceof HeatingError && err.status === status && text.test(err.message)

test('Heizkostenverteiler: Skala und Faktor werden gespeichert und ergänzend geändert; eine unbekannte Skala ergibt null', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'meters', 'h1', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer', type: 'hkv', unit: 'Einheiten', hcaScale: 'unit', ratingFactor: 1.25 })
    })
    const meter = async () => (await opened.read(readMeters)).find((m) => m.id === 'h1') ?? assert.fail('kein Zähler')
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor], ['unit', 1.25])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { name: 'Wohnzimmer links' }))
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor], ['unit', 1.25])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { hcaScale: 'product', ratingFactor: null }))
    assert.deepEqual([(await meter()).hcaScale, (await meter()).ratingFactor ?? null], ['product', null])
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { hcaScale: 'linear' }))
    assert.equal((await meter()).hcaScale ?? null, null)
  })
})

test('Heizkostenverteiler: Faktor über 0, Skala und Faktor nur am Heizkostenverteiler, je mit einem Satz (Review Focus 5)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'meters', 'h1', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer', type: 'hkv', unit: 'Einheiten' })
      await createEntity(db, 'meters', 'k1', { propertyId: 'objekt-1', unitId: 'a', name: 'Kaltwasser', type: 'kaltwasser', unit: 'm³' })
    })
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: 0 })), heatingError(400, /Zahl über 0, etwa 0,8 oder 1,25/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: -1.25 })), heatingError(400, /Zahl über 0/))
    // Ein Faktor, der keine Zahl ist, wird nicht still geleert.
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: '1,25' })), heatingError(400, /Zahl über 0/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'k1', { ratingFactor: 1 })), heatingError(400, /nur bei einem Heizkostenverteiler/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'k1', { hcaScale: 'unit' })), heatingError(400, /nur bei einem Heizkostenverteiler/))
    // Ein Heizkostenverteiler ohne Wohnung (PR 4) bleibt abgelehnt.
    await assert.rejects(opened.write((db) => createEntity(db, 'meters', 'h2', { propertyId: 'objekt-1', unitId: null, name: 'Haus', type: 'hkv', unit: 'Einheiten', hcaScale: 'product' })), heatingError(400, /Heizkörper einer Wohnung/))
    const k1 = (await opened.read(readMeters)).find((m) => m.id === 'k1')
    assert.deepEqual([k1?.hcaScale ?? null, k1?.ratingFactor ?? null], [null, null], 'nichts geschrieben')
  })
})

let ids = 0
const newId = () => `m-${++ids}`
// Die Einrichtung von PR 10 (Schritt 7) mit der Erfassung als Parameter; eine Anlage wird nur über sie
// zur eigenen Abrechnung (PR 10 Abweichung 17).
const einrichtung = (capture: 'heatMeter' | 'hca' | 'serviceValues', period = '2025-01') => ({
  period, heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture,
  dhwHeatMeter: false, totalHeatMeter: false,
})
async function haus(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}
async function ablesedienst(opened: Opened): Promise<void> {
  await haus(opened)
  await opened.write((db) => setUpSelf(db, 'hp', einrichtung('serviceValues'), '2026-02-01', newId))
}
const zeile = (unitId: string, from: string, to: string, heatValue: unknown, waterValue: unknown = null) => ({ unitId, from, to, heatValue, waterValue })
const plantOf = async (opened: Opened) => (await opened.read(readHeatingPlants)).find((p) => p.id === 'hp') ?? assert.fail('keine Anlage')

test('Einrichtung mit Heizkostenverteilern oder Ablesedienst: keine Wärmezähler, die Warmwasserzähler schon (Abweichung 8)', async () => {
  for (const capture of ['hca', 'serviceValues'] as const) {
    await withDatabase(async (opened) => {
      await haus(opened)
      const done = await opened.write((db) => setUpSelf(db, 'hp', einrichtung(capture), '2026-02-01', newId)) ?? assert.fail('keine Anlage')
      assert.equal(done.plant.capture, capture)
      assert.deepEqual(done.created.map((m) => m.type).sort(), ['warmwasser', 'warmwasser'])
      // Der Zeitraum der eigenen Abrechnung trägt die Erfassung.
      assert.deepEqual(done.plant.selfSpans, [{ from: '2025-01', until: null, capture }])
    })
  }
})

test('Erfassung wechseln: nur mit einem neuen Zeitraum ab einer Heizperiode; frühere Heizperioden behalten ihre Geräte', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('heatMeter'), '2026-02-01', newId))
    // Nebenbei über „Ändern“ geht es nicht.
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { capture: 'hca' })), heatingError(400, /nur zum Beginn einer Heizperiode/))
    // Erneut eingerichtet ab 2026: 2025 bleibt bei Wärmezählern, auch offen.
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca', '2026-01'), '2026-02-01', newId))
    let plant = await plantOf(opened)
    assert.equal(plant.capture, 'hca')
    assert.deepEqual(plant.selfSpans, [{ from: '2025-01', until: '2026-01', capture: 'heatMeter' }, { from: '2026-01', until: null, capture: 'hca' }])
    const [view2025] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    const [view2026] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view2025?.capture, view2026?.capture], ['heatMeter', 'hca'])
    // Zurück zu freien Schlüsseln: Die Zeiträume behalten ihre Erfassung.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    plant = await plantOf(opened)
    assert.ok((plant.selfSpans ?? []).every((s) => s.capture !== undefined && s.capture !== null), JSON.stringify(plant.selfSpans))
  })
})

test('Erfassung berichtigen: beginnt der Zeitraum mit dieser Heizperiode, bekommt er die neue Erfassung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('heatMeter'), '2026-02-01', newId))
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca'), '2026-02-01', newId))
    assert.deepEqual((await plantOf(opened)).selfSpans, [{ from: '2025-01', until: null, capture: 'hca' }])
  })
})

test('Ablesedienst: speichern ersetzt alle Zeilen der Heizperiode; die Ansicht zeigt sie', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    const speichern = (values: unknown[]) => opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values }))
    const a = await speichern([zeile('a', '2025-01-01', '2025-09-30', 340), zeile('a', '2025-10-01', '2025-12-31', 210), zeile('b', '2025-01-01', '2025-12-31', 800)]) ?? assert.fail('keine Anlage')
    assert.equal(a.length, 3)
    assert.deepEqual(a[0], { plantId: 'hp', period: periodKey('2025-01'), unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: null })
    await speichern([zeile('b', '2025-01-01', '2025-12-31', 810.5)])
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.serviceValues?.map((v) => [v.unitId, v.heatValue]), [['b', 810.5]])
    assert.equal(view?.capture, 'serviceValues')
    assert.equal(await opened.write((db) => saveServiceValues(db, 'gibt-es-nicht', '2025-01', { values: [] })), null)
  })
})

test('Ablesedienst: Prüfungen je mit einem Satz, nichts geschrieben', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    const speichern = (values: unknown[]) => opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values }))
    await speichern([zeile('a', '2025-01-01', '2025-12-31', 5)])
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-06-30', 1), zeile('a', '2025-06-30', '2025-12-31', 1)]), heatingError(400, /überschneiden sich/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', 1, 5), zeile('b', '2025-01-01', '2025-12-31', 1)]), heatingError(400, /für alle Zeilen ein oder für keine/))
    await assert.rejects(speichern([zeile('a', '2024-12-01', '2025-12-31', 1)]), heatingError(400, /nicht ganz in der Heizperiode/))
    await assert.rejects(speichern([zeile('a', '2025-03-01', '2025-02-01', 1)]), heatingError(400, /kein gültiger Zeitraum/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', -1)]), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', '1.250')]), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern([zeile('a', '2025-01-01', '2025-12-31', 1, 'viel')]), heatingError(400, /Warmwasser.*Zahl ab 0 oder leer/))
    await assert.rejects(speichern([zeile('x', '2025-01-01', '2025-12-31', 1)]), heatingError(400, /gibt es in diesem Objekt nicht/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.serviceValues?.map((v) => v.heatValue), [5], 'nichts geschrieben')
    // Eine Lücke ist erlaubt und bleibt eine Lücke (Review Focus 2).
    assert.equal((await speichern([zeile('a', '2025-01-01', '2025-09-30', 1), zeile('a', '2025-10-15', '2025-12-31', 1)]))?.length, 2)
  })
})

test('Ablesedienst: nur bei eigener Abrechnung mit dieser Erfassung; nur angeschlossene Wohnungen; abgeschlossen gesperrt (409)', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a', heatedAreaM2: null }] }))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [zeile('b', '2025-01-01', '2025-12-31', 1)] })), heatingError(400, /hängt nicht an dieser Heizanlage/))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [] })), heatingError(409, /abgeschlossen/))
    // Ab 2026 mit Wärmezählern: Werte eines Ablesedienstes gibt es dort nicht.
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('heatMeter', '2026-01'), '2026-02-01', newId))
    await assert.rejects(opened.write((db) => saveServiceValues(db, 'hp', '2026-01', { values: [] })), heatingError(400, /Erfassung „Werte eines Ablesedienstes“/))
  })
})

test('Bewertungsfaktor eines Geräts, das in einer abgeschlossenen Heizperiode zählt: gesperrt (409), ein neues Gerät geht', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca'), '2026-02-01', newId))
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'h1', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer', type: 'hkv', unit: 'Einheiten', hcaScale: 'unit', ratingFactor: 1.25 })
      await createEntity(db, 'readings', 'r1', { meterId: 'h1', date: '2024-12-31', value: 0 })
      await createEntity(db, 'readings', 'r2', { meterId: 'h1', date: '2025-12-31', value: 500 })
    })
    // Offen: berichtigen geht.
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: 1.3 }))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { ratingFactor: 0.8 })), heatingError(409, /abgeschlossenen Heizperiode 2025.*als neuen Zähler an/s))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'h1', { hcaScale: 'product' })), heatingError(409, /abgeschlossenen/))
    // Der Name bleibt änderbar, und ein neues Gerät mit anderem Faktor lässt sich anlegen.
    await opened.write((db) => updateEntity(db, 'meters', 'h1', { name: 'Wohnzimmer alt' }))
    await opened.write((db) => createEntity(db, 'meters', 'h2', { propertyId: 'objekt-1', unitId: 'a', name: 'Wohnzimmer neu', type: 'hkv', unit: 'Einheiten', hcaScale: 'unit', ratingFactor: 0.8 }))
    const m = (await opened.read(readMeters)).find((x) => x.id === 'h1')
    assert.equal(m?.ratingFactor, 1.3)
  })
})

test('Wiederherstellen: ein Wert des Ablesedienstes an einer Wohnung eines anderen Objekts wird gefunden', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus', kind: 'mfh', address: '' })
      await createEntity(db, 'units', 'n', { propertyId: 'objekt-2', name: 'N', areaM2: 40, participates: true })
    })
    await opened.write((db) => saveServiceValues(db, 'hp', '2025-01', { values: [zeile('a', '2025-01-01', '2025-12-31', 1)] }))
    await opened.write(async (db) => {
      const [hp] = await db.select({ id: heatingServiceValues.heatingPeriodId }).from(heatingServiceValues)
      await db.insert(heatingServiceValues).values({ heatingPeriodId: hp?.id ?? '', unitId: 'n', from: '2025-01-01', to: '2025-12-31', heatValue: 1, waterValue: null })
    })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /Wert des Ablesedienstes.*„N“.*anderen Objekts/.test(b)), befunde.join('\n'))
  })
})

test('Zeitraum von vor PR 12 (ohne Erfassung): beim Wechsel bekommt er die bisherige Erfassung der Anlage', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('heatMeter'), '2026-02-01', newId))
    // So steht ein Zeitraum in einer Datenbank von vor PR 12: ohne Erfassung.
    await opened.write((db) => db.update(heatingSelfSpans).set({ capture: null }).where(eq(heatingSelfSpans.plantId, 'hp')))
    assert.deepEqual((await plantOf(opened)).selfSpans, [{ from: '2025-01', until: null }])
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca', '2026-01'), '2026-02-01', newId))
    assert.deepEqual((await plantOf(opened)).selfSpans, [{ from: '2025-01', until: '2026-01', capture: 'heatMeter' }, { from: '2026-01', until: null, capture: 'hca' }])
  })
})

test('Eine Heizperiode, an der nur Werte des Ablesedienstes hängen, wird nicht als leer entfernt (Invariante, Heizung PR 12)', async () => {
  await withDatabase(async (opened) => {
    await ablesedienst(opened)
    // Die Einrichtung schreibt den Anteil in 2025; die Werte stehen in 2026, einer Zeile ohne weitere Angaben.
    await opened.write((db) => saveServiceValues(db, 'hp', '2026-01', { values: [zeile('a', '2026-01-01', '2026-12-31', 7)] }))
    const [row] = await opened.read((db) => db.select({ id: heatingServiceValues.heatingPeriodId }).from(heatingServiceValues))
    await opened.write((db) => dropIfEmpty(db, row?.id ?? assert.fail('keine Zeile')))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.serviceValues?.map((v) => v.heatValue), [7])
  })
})

test('Kesseltausch: die neue Anlage übernimmt die Erfassung mit Heizkostenverteilern', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', einrichtung('hca'), '2026-02-01', newId))
    await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2025-07-01', energy: 'districtHeating', name: 'Fernwärme', previousName: 'Gas' }))
    const neu = (await opened.read(readHeatingPlants)).find((p) => p.id === 'hp2') ?? assert.fail('keine neue Anlage')
    assert.deepEqual([neu.method, neu.capture, neu.selfSpans], ['self', 'hca', [{ from: '2025-01', until: null, capture: 'hca' }]])
  })
})
