// Brennstofflieferungen in der Datenbank (Heizung PR 7, Entwurf 5.4, 8.2, 13 PR 7): anlegen, ändern,
// entfernen, die Sperren dieser Version, die Verknüpfung der Positionen, die eingefrorenen Teile und
// die Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDelivery, createEstimates, freezeFuelCarries, fuelGapQuestions, listDegreeDays, listDeliveries, removeDelivery, removeEstimates, saveDegreeDays, unfreezeFuelCarries, updateDelivery } from '../src/db/fuel.ts'
import { readFuelCarryFrozen, readFuelDeliveries } from '../src/db/read.ts'
import type { HeatingStatement } from '../../shared/types.ts'
import { ensureHeatingPeriod } from '../src/db/co2.ts'
import { createHeatingPlant, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, createProperty, CrossPropertyError, crossPropertyViolations, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'
import { costItems, fuelCarryFrozen, heatingPlants } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-'))
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

// Ein Haus mit einer Wohnung im Kalenderjahr und einer Gasheizung mit freien Schlüsseln.
async function bestand(opened: Opened, energy = 'gas', method = 'manual'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method })
  })
}
const gas = { label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', emissionsKg: 5406.17, co2CostCents: 60000 }

test('Lieferung: anlegen mit Teilmengen, ändern, lesen; „geschätzt“ setzt nur der Abschluss', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const d = await opened.write((db) => createDelivery(db, 'd1', 'hp', {
      ...gas, estimated: true,
      parts: [
        { from: '2026-01-01', to: '2026-03-14', amountCents: 150000 },
        { from: '2025-03-15', to: '2025-12-31', amountCents: 500000, fixedCents: 10000 },
      ],
    })) ?? assert.fail('keine Anlage')
    assert.deepEqual([d.label, d.estimated, d.usedByService, d.parts.map((p) => p.from)], ['Gas 2025/2026', false, true, ['2025-03-15', '2026-01-01']])
    const geaendert = await opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 20000, parts: [] })) ?? assert.fail('keine Lieferung')
    assert.deepEqual([geaendert.fixedCents, geaendert.parts, geaendert.emissionsKg], [20000, [], 5406.17])
    assert.equal((await opened.read((db) => listDeliveries(db, 'hp')))?.length, 1)
    assert.equal(await opened.read((db) => listDeliveries(db, 'gibt-es-nicht')), null)
    assert.equal(await opened.write((db) => removeDelivery(db, 'd1')), true)
    assert.equal(await opened.write((db) => removeDelivery(db, 'd1')), false)
  })
})

test('Lieferung: Sperren dieser Version und Pflichtangaben, jede mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'oil')
    // Seit Heizung PR 8: Bei Heizöl braucht eine Lieferung Lieferdatum und Menge statt eines Rechnungszeitraums.
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', gas)), heatingError(400, /Lieferdatum/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...gas, deliveredAt: '2025-03-15', quantity: 1000, quantityUnit: 'l' })), heatingError(400, /Bestandsrechnung/))
  })
  await withDatabase(async (opened) => {
    await bestand(opened)
    const anlegen = (body: Record<string, unknown>) => opened.write((db) => createDelivery(db, 'x', 'hp', body))
    await assert.rejects(anlegen({ ...gas, unitId: 'u1' }), heatingError(400, /späteren Version/))
    await assert.rejects(anlegen({ ...gas, gridFeeCents: 100 }), heatingError(400, /späteren Version/))
    await assert.rejects(anlegen({ label: 'ohne Zeitraum' }), heatingError(400, /Rechnungszeitraum/))
    await assert.rejects(anlegen({ ...gas, invoiceTo: '2025-03-01' }), heatingError(400, /endet vor seinem Beginn/))
    await assert.rejects(anlegen({ ...gas, amountCents: 650000 }), heatingError(400, /Kostenposition/))
    await assert.rejects(anlegen({ ...gas, invoiceFrom: '2024-12-15', invoiceTo: '2026-01-14', sharePermille: 900 }), heatingError(400, /mehr als zwei Heizperioden/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-01-01', to: '2025-06-30', amountCents: 1 }] }), heatingError(400, /außerhalb des Rechnungszeitraums/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-03-15', to: '2025-06-30', amountCents: 1 }, { from: '2025-06-30', to: '2025-12-31', amountCents: 1 }] }), heatingError(400, /überschneiden/))
    await assert.rejects(anlegen({ ...gas, parts: [{ from: '2025-03-15', to: '2025-06-30' }] }), heatingError(400, /Beginn, Ende und Betrag/))
    // Ein eingetragener Anteil bei einer Rechnung über zwei Heizperioden ist erlaubt.
    assert.equal((await anlegen({ ...gas, sharePermille: 900 }))?.sharePermille, 900)
  })
})

test('Lieferung beim Messdienst: Betrag erlaubt, Verknüpfung einer Position nicht', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'gas', 'service')
    const d = await opened.write((db) => createDelivery(db, 'd1', 'hp', { ...gas, amountCents: 311747, usedByService: false }))
    assert.deepEqual([d?.amountCents, d?.usedByService], [311747, false])
    await assert.rejects(
      opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' })),
      heatingError(400, /Messdienst/),
    )
  })
})

test('Verknüpfung: nur Heizkosten, nur in der Heizperiode, die das Ende der Rechnung enthält (Review Focus 2)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    const position = (id: string, over: Record<string, unknown>) =>
      opened.write((db) => createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1', ...over }))
    await assert.rejects(position('a', { period: '2025-01' }), heatingError(400, /endet am 14\.03\.2026 und gehört deshalb in die Heizperiode 2026/))
    await assert.rejects(position('b', { category: 'Grundsteuer' }), heatingError(400, /nur zu einer Position der Kostenart/))
    await assert.rejects(position('c', { fuelDeliveryId: 'gibt-es-nicht' }), heatingError(400, /gibt es nicht/))
    await assert.rejects(position('f', { key: 'amounts', tenancyAmounts: {} }), heatingError(400, /nicht als Einzelbeträge/))
    const ok = await position('d', {})
    assert.equal(Reflect.get(ok, 'fuelDeliveryId'), 'd1')
    // Abschlag und Gutschrift derselben Rechnung zeigen beide auf sie (G-C4).
    await position('e', { description: 'Gutschrift Gas', amountCents: -50000 })
    await assert.rejects(opened.write((db) => removeDelivery(db, 'd1')), heatingError(409, /2 Kostenpositionen/))
    // Die Verknüpfung wird mit null gelöst.
    await opened.write((db) => updateEntity(db, 'costItems', 'e', { fuelDeliveryId: null }))
    assert.equal(Reflect.get((await opened.read((db) => findEntity(db, 'costItems', 'e'))) ?? {}, 'fuelDeliveryId'), undefined)
  })
})

test('Eingefroren: Mengen, Zeiträume und Beträge gesperrt, die Bezeichnung nicht; Löschen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write(async (db) => {
      const h = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
      await db.insert(fuelCarryFrozen).values({ deliveryId: 'd1', heatingPeriodId: h, cents: 403839 })
    })
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { invoiceTo: '2026-03-31' })), heatingError(409, /eingefroren/))
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { emissionsKg: 1 })), heatingError(409, /eingefroren/))
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { label: 'Gas Stadtwerke' })))?.label, 'Gas Stadtwerke')
    await assert.rejects(opened.write((db) => removeDelivery(db, 'd1')), heatingError(409, /eingefroren/))
  })
})

test('Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode sind gesperrt (Entwurf 8.2 Fall d, A10)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'gz', { propertyId: 'objekt-1', unitId: null, name: 'Gaszähler', type: 'sonstig', unit: 'm³', heatingPlantId: 'hp', heatingRole: 'supply' })
      await createEntity(db, 'readings', 'r1', { meterId: 'gz', date: '2025-03-14', value: 1000 })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} })
    })
    await assert.rejects(opened.write((db) => createEntity(db, 'readings', 'r2', { meterId: 'gz', date: '2025-04-30', value: 1200 })), heatingError(409, /Heizperiode 2025 ist abgeschlossen/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'readings', 'r1', { value: 999 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeEntity(db, 'readings', 'r1')), heatingError(409, /abgeschlossen/))
    // Ein Stand im offenen Jahr geht, ebenso ein Stand an einem Zähler einer Wohnung.
    await opened.write((db) => createEntity(db, 'readings', 'r3', { meterId: 'gz', date: '2026-03-14', value: 9000 }))
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'wz', { propertyId: 'objekt-1', unitId: 'u1', name: 'Wasser', type: 'kaltwasser', unit: 'm³' })
      await createEntity(db, 'readings', 'r4', { meterId: 'wz', date: '2025-06-30', value: 10 })
    })
  })
})

test('Heizanlage: CO₂-Merkmale, keine stille Entfernung mit Lieferungen, kein Wechsel weg von freien Schlüsseln mit Verknüpfung', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const p = await opened.write((db) => updateHeatingPlant(db, 'hp', { nonResidential: true, restriction: 'building' }))
    assert.deepEqual([p?.nonResidential, p?.restriction, p?.districtEtsNew], [true, 'building', false])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { districtEtsNew: true })), heatingError(400, /Fernwärme/))
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'service' })), heatingError(400, /verknüpft/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'oil' })), heatingError(400, /Lieferungen/))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp')), { removed: false, reason: 'deliveries', count: 1 })
  })
})

test('Ortswerte der Gradtage: je Monat ein Wert über 0, ganz ersetzt; Objektgrenze der Verknüpfung beim Wiederherstellen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const gespeichert = await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-02', value: 380 }, { month: '2025-01', value: 412.5 }] }))
    assert.deepEqual(gespeichert, [{ month: '2025-01', value: 412.5 }, { month: '2025-02', value: 380 }])
    await assert.rejects(opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-13', value: 1 }] })), heatingError(400, /Monat/))
    await assert.rejects(opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-01', value: 0 }] })), heatingError(400, /über 0/))
    assert.deepEqual(await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [] })), [])
    assert.equal(await opened.read((db) => listDegreeDays(db, 'gibt-es-nicht')), null)
    // Ein von Hand bearbeitetes Archiv: Die Anlage gehört jetzt zu einem anderen Objekt als die Position.
    await opened.write(async (db) => {
      await createDelivery(db, 'd1', 'hp', gas)
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1' })
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await db.update(heatingPlants).set({ propertyId: 'objekt-2' }).where(eq(heatingPlants.id, 'hp'))
      await db.update(costItems).set({ heatingPlantId: null }).where(eq(costItems.id, 'c1'))
    })
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /„Gas“ zeigt auf eine Lieferung einer Heizanlage eines anderen Objekts/.test(b)), befunde.join('\n'))
  })
})

// ---------- Abschluss (Entwurf 8.2, N1, G-A4) ----------

// Die Bewertung einer Heizperiode, wie computeSettlement sie liefert, mit den Zahlen von Fall a und der
// Lücke aus 3.3; die Heizperiode ist hier das Kalenderjahr des Bestands.
const bewertung = (over: Partial<NonNullable<HeatingStatement['fuel']>> = {}): { heating: HeatingStatement[]; deadline: string } => ({
  deadline: '2026-12-31',
  heating: [{
    plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2: null,
    fuel: {
      coveragePermille: 848.71, emissionsKg: 4588.3, co2Cents: 50923,
      deliveries: [{
        deliveryId: 'd1', label: 'Gas 2025/2026', from: '2025-03-15', to: '2026-03-14', estimated: false, method: 'degreeDays', sharePermille: 848.71,
        fixedKnown: false, split: true, amountCents: 650000, inPeriodCents: 551661, emissionsKg: 4588.3, co2Cents: 50923,
      }],
      carries: [{ deliveryId: 'd1', period: periodKey('2024-01'), cents: -98339 }],
      gaps: [{
        from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29,
        estimate: { from: '2026-03-15', to: '2026-04-30', amountCents: 90774, emissionsKg: 1815.5, co2CostCents: 9077, basedOn: 'Gas 2025/2026', byMeter: false, factorPermille: 151.29 },
      }],
      ...over,
    },
  }],
})

test('Abschluss: Rückfrage je Lücke mit Vorschlag, Schätzung anlegen und wieder entfernen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    assert.deepEqual(fuelGapQuestions(bewertung()), [{ plantId: 'hp', plantName: 'Gas', period: '2025-01', from: '2026-03-15', to: '2026-04-30', amountCents: 90774, deadline: '2026-12-31' }])
    assert.deepEqual(fuelGapQuestions({}), [])
    assert.deepEqual(fuelGapQuestions(bewertung({ gaps: [{ from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29, estimate: null }] })), [])
    let n = 0
    const ids = await opened.write((db) => createEstimates(db, bewertung(), () => `e${++n}`))
    assert.deepEqual(ids, ['e1'])
    const e = (await opened.read((db) => readFuelDeliveries(db))).find((d) => d.id === 'e1') ?? assert.fail('keine Schätzung')
    assert.deepEqual(
      [e.label, e.estimated, e.invoiceFrom, e.invoiceTo, e.amountCents, e.emissionsKg, e.co2CostCents],
      ['Schätzung 15.03.–30.04.2026: 151,29 ‰ der Rechnung „Gas 2025/2026“ nach Gradtagen', true, '2026-03-15', '2026-04-30', 90774, 1815.5, 9077],
    )
    await opened.write((db) => removeEstimates(db, ids))
    assert.deepEqual((await opened.read((db) => readFuelDeliveries(db))).map((d) => d.id), ['d1'])
  })
})

test('Einfrieren und Freigeben: je Lieferung Übertrag, Ausstoß und CO₂-Kosten der Heizperiode', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => freezeFuelCarries(db, bewertung()))
    assert.deepEqual(await opened.read((db) => readFuelCarryFrozen(db)), [{ deliveryId: 'd1', plantId: 'hp', period: '2025-01', cents: -98339, emissionsKg: 4588.3, co2Cents: 50923 }])
    // Ein zweites Einfrieren ersetzt, statt eine zweite Zeile anzulegen.
    await opened.write((db) => freezeFuelCarries(db, bewertung()))
    assert.equal((await opened.read((db) => readFuelCarryFrozen(db))).length, 1)
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 1 })), heatingError(409, /eingefroren/))
    // Freigegeben wird nach dem eingefrorenen Stand; ein unlesbarer Stand gibt nichts frei.
    await opened.write((db) => unfreezeFuelCarries(db, 'kaputt'))
    assert.equal((await opened.read((db) => readFuelCarryFrozen(db))).length, 1)
    await opened.write((db) => unfreezeFuelCarries(db, JSON.parse(JSON.stringify(bewertung()))))
    assert.deepEqual(await opened.read((db) => readFuelCarryFrozen(db)), [])
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { fixedCents: 1 })))?.fixedCents, 1)
  })
})

// ---------- Durchsicht PR #233: Geld und Daten ----------

async function eingefroren(opened: Opened, cents: number): Promise<void> {
  await opened.write(async (db) => {
    const h = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
    await db.insert(fuelCarryFrozen).values({ deliveryId: 'd1', heatingPeriodId: h, cents })
    await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} })
  })
}
const gasPosition = (over: Record<string, unknown> = {}) =>
  ({ propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area', fuelDeliveryId: 'd1', ...over })

test('Durchsicht I2, Nachprüfung I-b: Mit eingefrorenem Teil bleibt die letzte Position verknüpft; weitere Positionen gehen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => createDelivery(db, 'd2', 'hp', { ...gas, label: 'andere' }))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', gasPosition()))
    await eingefroren(opened, 403839)
    // Die letzte Position: Lösen, Umhängen und Löschen ließen den eingefrorenen Teil doppelt stehen.
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'c1', { fuelDeliveryId: null })), heatingError(409, /letzte Position/))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'c1', { fuelDeliveryId: 'd2' })), heatingError(409, /letzte Position/))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'c1')), heatingError(409, /letzte Position/))
    // Eine Gutschrift, ein Abschlag oder die Schlussrechnung dazu: erlaubt (der eingefrorene Teil bleibt).
    assert.equal(Reflect.get(await opened.write((db) => createEntity(db, 'costItems', 'c2', gasPosition({ description: 'Gutschrift', amountCents: -50000 }))), 'fuelDeliveryId'), 'd1')
    // Mit zwei Positionen darf eine gehen; dann ist die andere wieder die letzte.
    await opened.write((db) => updateEntity(db, 'costItems', 'c2', { fuelDeliveryId: null }))
    await opened.write((db) => removeEntity(db, 'costItems', 'c2'))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'c1')), heatingError(409, /letzte Position/))
    // Der Betrag darf sich ändern: Die Summe bleibt über die Zeiträume stimmig.
    assert.equal(Reflect.get((await opened.write((db) => updateEntity(db, 'costItems', 'c1', { amountCents: 660000 }))) ?? {}, 'amountCents'), 660000)
  })
})

test('Durchsicht I1: Mit 0 eingefroren (noch ohne Position) lässt sich die Position verknüpfen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await eingefroren(opened, 0)
    assert.equal(Reflect.get(await opened.write((db) => createEntity(db, 'costItems', 'c1', gasPosition())), 'fuelDeliveryId'), 'd1')
  })
})

test('Durchsicht I5: Eine Lieferung eines anderen Objekts lässt sich nicht verknüpfen', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' }))
    await assert.rejects(
      opened.write((db) => createEntity(db, 'costItems', 'c1', gasPosition({ propertyId: 'objekt-2' }))),
      (err: unknown) => err instanceof CrossPropertyError && /desselben Objekts/.test(err.message),
    )
  })
})

test('Durchsicht M3: Ein neues Rechnungsende in einer anderen Heizperiode als die Positionen wird abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', gasPosition()))
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { invoiceTo: '2025-12-31' })), heatingError(409, /Heizperiode 2025;/))
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { invoiceTo: '2026-03-31' })))?.invoiceTo, '2026-03-31')
  })
})

test('Durchsicht M2: Gradtagzahlen des Orts für Monate einer abgeschlossenen Heizperiode mit Lieferungen sind gesperrt', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-03', value: 100 }, { month: '2026-03', value: 90 }] }))
    await opened.write((db) => createDelivery(db, 'd1', 'hp', gas))
    await eingefroren(opened, 403839)
    await assert.rejects(opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-03', value: 120 }, { month: '2026-03', value: 90 }] })), heatingError(409, /03\/2025/))
    // Ein Monat einer offenen Heizperiode geht.
    assert.deepEqual(await opened.write((db) => saveDegreeDays(db, 'objekt-1', { values: [{ month: '2025-03', value: 100 }, { month: '2026-03', value: 95 }] })), [{ month: '2025-03', value: 100 }, { month: '2026-03', value: 95 }])
  })
})
