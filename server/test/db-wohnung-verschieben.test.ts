// Eine Wohnung in ein anderes Objekt verschieben (#180): was mitwandert, was den Wechsel ablehnt.
//
// Mitwandern dürfen die Mietverhältnisse samt Zahlungen, Staffeln und Kaution, denn sie erben das Objekt über
// die Wohnung. Abgelehnt wird, was zum bisherigen Objekt gehört (Kostenpositionen, Heizanlage, Zeiträume) und
// was eine abgeschlossene Abrechnung beträfe: Der Mieter stünde sonst in einem Haus, dessen zugestellte
// Abrechnung ihn nennt, oder in einem Zeitraum eines Hauses, das ohne ihn abgeschlossen hat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { saveCo2Statement } from '../src/db/co2.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { closeSettlement, createEntity, createProperty, CrossPropertyError, findEntity, updateEntity } from '../src/db/repository.ts'
import { fuelDeliveries, heatingPrepayments, heatingSeparateSpans, properties } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { Tenancy, Unit } from '../../shared/types.ts'

type Opened = Awaited<ReturnType<typeof openFreshDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verschieben-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Zwei Häuser; im ersten die Wohnung „C“ mit dem Mietverhältnis „tc“ seit 2024, eine Zahlung und eine Jahreskorrektur.
async function bestand(opened: Opened, start = '2024-01-01'): Promise<void> {
  await opened.write(async (db) => {
    await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
    await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
    await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieterin C', persons: 1, start, prepaymentOverrides: { '2025-01': 1200 } })
    await createEntity(db, 'payments', 'p1', { tenancyId: 'tc', date: '2025-01-03', amountCents: 50000 })
  })
}

const verschieben = (opened: Opened) => opened.write((db) => updateEntity(db, 'units', 'c', { propertyId: 'objekt-2' }))
const abgelehnt = (text: RegExp) => (err: unknown) => err instanceof CrossPropertyError && text.test(err.message)
const objektVon = async (opened: Opened): Promise<string> => {
  const u = await opened.read((db) => findEntity(db, 'units', 'c'))
  if (!u || !('areaM2' in u)) assert.fail('Wohnung C fehlt')
  return (u satisfies Unit).propertyId
}

test('Verschieben: die Wohnung wechselt mit Mietverhältnis, Zahlung und Jahreskorrektur das Objekt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await verschieben(opened)
    assert.equal(await objektVon(opened), 'objekt-2')
    const t = await opened.read((db) => findEntity(db, 'tenancies', 'tc'))
    if (!t || !('tenantName' in t)) assert.fail('Mietverhältnis fehlt')
    assert.deepEqual([(t satisfies Tenancy).unitId, t.prepaymentOverrides], ['c', { '2025-01': 1200 }])
  })
})

test('Verschieben: eine abgeschlossene Abrechnung des bisherigen Objekts, die die Wohnung nennt, lehnt ab', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => closeSettlement(db, {
      id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null,
      settlement: { statements: [{ tenancyId: 'tc', unitId: 'c', tenantName: 'Mieterin C' }] },
    }))
    await assert.rejects(verschieben(opened), abgelehnt(/abgeschlossenen Abrechnung 2024 des bisherigen Objekts/))
    assert.equal(await objektVon(opened), 'objekt-1', 'gespeichert wurde nichts')
  })
})

test('Verschieben: eine abgeschlossene Abrechnung ohne die Wohnung hindert nicht', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => closeSettlement(db, {
      id: 's1', propertyId: 'objekt-1', period: periodKey('2023-01'), closedAt: '2024-03-01', sentAt: null, settlement: { statements: [] },
    }))
    await verschieben(opened)
    assert.equal(await objektVon(opened), 'objekt-2')
  })
})

test('Verschieben: im Ziel abgeschlossen, solange das Mietverhältnis lief, lehnt ab', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => closeSettlement(db, {
      id: 's2', propertyId: 'objekt-2', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: { statements: [] },
    }))
    await assert.rejects(verschieben(opened), abgelehnt(/Zweites Haus.*Abrechnung 2024 schon abgeschlossen.*Mieterin C/))
    assert.equal(await objektVon(opened), 'objekt-1')
  })
  // Endet der abgeschlossene Zeitraum vor dem Einzug, betrifft er die Mieterin nicht.
  await withDatabase(async (opened) => {
    await bestand(opened, '2025-01-01')
    await opened.write((db) => closeSettlement(db, {
      id: 's2', propertyId: 'objekt-2', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: { statements: [] },
    }))
    await verschieben(opened)
    assert.equal(await objektVon(opened), 'objekt-2')
  })
})

test('Verschieben: eine Jahreskorrektur unter einem Zeitraum, den das Ziel nicht hat, lehnt ab', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => db.update(properties).set({ periodStartMonth: 7 }).where(eq(properties.id, 'objekt-2')))
    await assert.rejects(verschieben(opened), abgelehnt(/Jahreskorrektur/))
    assert.equal(await objektVon(opened), 'objekt-1')
  })
})

test('Verschieben: ein CO₂-Betrag „vom Vermieter übernommen“ gehört zur Heizanlage des bisherigen Objekts', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { ta: 60000 },
      })
      await saveCo2Statement(db, 'hp', '2025-01', {
        method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 2, reliefs: [{ tenancyId: 'tc', cents: 300 }],
      })
    })
    await assert.rejects(verschieben(opened), abgelehnt(/CO₂/))
    assert.equal(await objektVon(opened), 'objekt-1')
  })
})

test('Verschieben: eine Rechnung einer Etagenheizung der Wohnung gehört zur Anlage des bisherigen Objekts', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas' })
      await db.insert(fuelDeliveries).values({ id: 'f1', plantId: 'hp', unitId: 'c', label: 'Gas C', amountCents: 10000 })
    })
    await assert.rejects(verschieben(opened), abgelehnt(/Rechnungen einer Heizung/))
    assert.equal(await objektVon(opened), 'objekt-1')
  })
})

test('Verschieben: Heizvorauszahlung bei getrennter Heizkostenabrechnung der Anlage ohne Liste lehnt ab', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas' })
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp', from: '2025-05', until: null })
      await db.insert(heatingPrepayments).values({ tenancyId: 'tc', from: '2025-05', monthlyCents: 8000 })
    })
    await assert.rejects(verschieben(opened), (err: unknown) => err instanceof Error && /Heizvorauszahlung erfasst/.test(err.message))
    assert.equal(await objektVon(opened), 'objekt-1')
  })
})
