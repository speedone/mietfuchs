// CO₂-Angaben und Warmwasser je Heizperiode in der Datenbank (Heizung PR 6, Entwurf 5.5, 7, 11.3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { heatingPeriodViews, removeCo2Statement, saveCo2Statement, saveHotWater } from '../src/db/co2.ts'
import { createHeatingPlant, heatingPlantViolations, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readCo2Statements, readHeatingPeriodRows } from '../src/db/read.ts'
import { closeSettlement, createEntity, createProperty, crossPropertyViolations, CrossPropertyError, HeatingError, updateEntity } from '../src/db/repository.ts'
import { heatingPeriods, heatingPlants, units } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-co2-'))
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

// Ein Haus mit zwei Wohnungen, je einem Mieter, einer Gasheizung beim Messdienst und der
// Messdienstposition 2025.
async function bestand(opened: Opened, method: 'service' | 'manual' = 'service'): Promise<void> {
  await opened.write(async (db) => {
    for (const u of ['a', 'b']) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method })
    await createEntity(db, 'costItems', 'hz', {
      propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Messdienst', amountCents: 100500, key: 'amounts',
      tenancyAmounts: { ta: 60000, tb: 40000 },
    })
  })
}

const vorwegabzug = { method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2, reliefs: [{ tenancyId: 'ta', cents: 300 }] }

test('CO₂-Angaben: speichern legt die Heizperiode an, ein zweites Speichern ergänzt, Beträge je Mieter werden ersetzt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const gespeichert = await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug)) ?? assert.fail('keine Anlage')
    assert.deepEqual([gespeichert.plantId, gespeichert.period, gespeichert.method, gespeichert.serviceUsersTotalCents, gespeichert.reliefs], ['hp', '2025-01', 'serviceDeducted', 100000, [{ tenancyId: 'ta', cents: 300 }]])
    const ergaenzt = await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { serviceTotalCents: 1250, reliefs: [{ tenancyId: 'tb', cents: 200 }] })) ?? assert.fail('keine Anlage')
    assert.deepEqual([ergaenzt.serviceUsersTotalCents, ergaenzt.serviceTotalCents, ergaenzt.reliefs], [100000, 1250, [{ tenancyId: 'tb', cents: 200 }]])
    assert.equal((await opened.read(readCo2Statements)).length, 1)
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.period, view?.label, view?.closed, view?.co2?.serviceTotalCents, view?.items.map((i) => i.id)], ['2025-01', '2025', false, 1250, ['hz']])
    assert.equal(await opened.read((db) => heatingPeriodViews(db, 'gibt-es-nicht', '2025')), null)
    assert.equal(await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), true)
    assert.equal(await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), false)
  })
})

test('CO₂-Angaben: Sperren und Pflichtangaben, jede mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const speichern = (body: unknown, period = '2025-01') => opened.write((db) => saveCo2Statement(db, 'hp', period, body))
    await assert.rejects(speichern({}), heatingError(400, /Frage, ob die Kostenaufstellung/))
    await assert.rejects(speichern({ method: 'self' }), heatingError(400, /späteren Version/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceLandlordCents: 500, serviceUnitsCount: 2 }), heatingError(400, /Summe der Kosten aller Nutzer/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceUsersTotalCents: 100000, serviceUnitsCount: 2 }), heatingError(400, /CO₂-Anteil des Vermieters/))
    await assert.rejects(speichern({ method: 'serviceShown', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 0 }), heatingError(400, /Nutzeinheiten/))
    await assert.rejects(speichern({ ...vorwegabzug, reliefs: [{ tenancyId: 'ta', cents: -1 }] }), heatingError(400, /ab 0 €/))
    await assert.rejects(speichern({ ...vorwegabzug, serviceCostItemId: 'gibt-es-nicht' }), heatingError(400, /Einzelbeträgen des Messdienstes/))
    await assert.rejects(speichern(vorwegabzug, '2025-02'), heatingError(400, /gibt es für diese Heizanlage nicht/))
    // Vor 2023 gibt es keine Aufteilung (§ 11 Abs. 2 Satz 1 CO2KostAufG).
    await assert.rejects(speichern(vorwegabzug, '2022-01'), heatingError(400, /01\.01\.2023/))
    // Der Messdienst hat nicht aufgeteilt: ohne Summen zulässig.
    assert.equal((await speichern({ method: 'selfAfterService' }))?.method, 'selfAfterService')
  })
})

test('CO₂-Angaben: nur bei einer Anlage mit Messdienst; abgeschlossene Heizperiode gesperrt (409)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'manual')
    await assert.rejects(opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug)), heatingError(400, /freien Schlüsseln/))
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'volumeFormula' })), heatingError(400, /Messdienst oder die Gemeinschaft/))
  })
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    await opened.write((db) => closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { serviceTotalCents: 1 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeCo2Statement(db, 'hp', '2025-01')), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter' })), heatingError(409, /abgeschlossen/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.equal(view?.closed, true)
  })
})

test('Warmwasser laut Messdienst: Formel mit oder ohne bestätigten Aufwand, Wärmezähler ohne Bestätigung', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'volumeFormula', dhwUnmeasurable: true })), { dhwMethod: 'volumeFormula', dhwUnmeasurable: true })
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter', dhwUnmeasurable: true })), { dhwMethod: 'heatMeter', dhwUnmeasurable: null })
    assert.deepEqual(await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: null })), { dhwMethod: null, dhwUnmeasurable: null })
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'schaetzung' })), heatingError(400, /Verfahren/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(view?.hotWater, { dhwMethod: null, dhwUnmeasurable: null })
  })
})

test('Objektgrenze: Beträge nur für Mietverhältnisse desselben Objekts; Wechsel und Archiv werden abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      // Ein drittes Mietverhältnis ohne Einzelbetrag: Nur der CO₂-Betrag hält es im Objekt.
      await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieter c', persons: 1, start: '2020-01-01' })
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createEntity(db, 'units', 'x', { propertyId: 'objekt-2', name: 'X', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'tx', { unitId: 'x', tenantName: 'Fremd', persons: 1, start: '2020-01-01' })
    })
    await assert.rejects(
      opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { ...vorwegabzug, reliefs: [{ tenancyId: 'tx', cents: 100 }] })),
      (err: unknown) => err instanceof CrossPropertyError && /anderen Objekts/.test(err.message),
    )
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { ...vorwegabzug, reliefs: [{ tenancyId: 'tc', cents: 100 }] }))
    await assert.rejects(
      opened.write((db) => updateEntity(db, 'tenancies', 'tc', { unitId: 'x' })),
      (err: unknown) => err instanceof CrossPropertyError && /CO₂-Angaben/.test(err.message),
    )
    // Ein von Hand bearbeitetes Archiv: die Wohnung des Mietverhältnisses steht jetzt im anderen
    // Objekt. Geändert wird an repository.ts vorbei, so wie es eine Datei von außen täte.
    await opened.write(async (db) => { await db.update(units).set({ propertyId: 'objekt-2' }).where(eq(units.id, 'c')) })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /CO₂-Betrag „vom Vermieter übernommen“ für Mieter c/.test(b)), befunde.join('\n'))
  })
})

test('Heizanlage entfernen: mit CO₂-Angaben 409 statt stillem Löschen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp')), { removed: false, reason: 'co2', periods: ['2025-01'] })
    await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01'))
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp'))).removed, true)
  })
})

test('Entfernen lässt keine leere Heizperiode zurück: sonst sperrte sie den Wechsel des Zeitraums der Heizung (PR 5)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01'))
    assert.deepEqual(await opened.read(readHeatingPeriodRows), [], 'nach dem Entfernen der CO₂-Angaben')
    await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter' }))
    await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: null }))
    assert.deepEqual(await opened.read(readHeatingPeriodRows), [], 'nach dem Leeren der Angabe zum Warmwasser')
    // Bleibt eine der beiden Angaben, bleibt die Heizperiode.
    await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'heatMeter' }))
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01'))
    assert.deepEqual((await opened.read(readHeatingPeriodRows)).map((r) => r.dhwMethod), ['heatMeter'])
  })
})

test('Eigene Heizperiode: Angaben zur Heizperiode 2024/2025 sind kein Befund beim Wiederherstellen (Prüfung nach dem Rhythmus der Anlage)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    // Die Anlage rechnet Mai bis April, das Objekt im Kalenderjahr. Gesetzt an den Routen vorbei,
    // der Wechsel mit Vorschau ist Sache von PR 5.
    await opened.write(async (db) => { await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp')) })
    await opened.write((db) => saveCo2Statement(db, 'hp', '2024-05', { method: 'selfAfterService' }))
    assert.deepEqual(await opened.read(heatingPlantViolations), [])
    // Ein Schlüssel, den es für die Anlage nicht gibt, bleibt ein Befund.
    await opened.write(async (db) => { await db.update(heatingPeriods).set({ period: periodKey('2024-07') }).where(eq(heatingPeriods.plantId, 'hp')) })
    assert.ok((await opened.read(heatingPlantViolations)).some((b) => /2024-07/.test(b)))
  })
})

test('Heizanlage ändern: mit CO₂-Angaben weder weg vom Messdienst noch zu einem Energieträger ohne CO₂-Kosten (Durchsicht M-3)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', vorwegabzug))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' })), heatingError(409, /CO₂-Angaben/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'heatPump' })), heatingError(409, /CO₂-Angaben/))
    // Ein vertippter Brennstoff lässt sich berichtigen.
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'oil' })))?.energy, 'oil')
    await opened.write((db) => removeCo2Statement(db, 'hp', '2025-01'))
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' })))?.method, 'manual')
  })
})
