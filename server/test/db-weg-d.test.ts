// Getrennte Heizkostenabrechnung ein- und ausschalten (Heizung PR 5, Entwurf 3.1, Testfälle B1/C1,
// C2/D2, C3, C4, D1 Fall 1 und 2, R-g aus 12.2, Review Focus 3).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { applySeparate, previewSeparate } from '../src/db/separateSettlement.ts'
import { closeSettlement, createEntity, findEntity, HeatingError, StaleTenancyError, updateEntity } from '../src/db/repository.ts'
import { tenancyStamp } from '../../shared/tenancyStamp.ts'
import { createHeatingPlant, listHeatingPlants, updateHeatingPlant } from '../src/db/heating.ts'
import { previewHeatingPeriodChange } from '../src/db/heatingPeriodChange.ts'
import { readStock } from '../src/db/read.ts'
import { closedHeatingSettlements, heatingPlants } from '../src/db/schema.ts'
import { computeSettlement, rentLedger } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import type { SeparatePreview } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-weg-d-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown =>
  entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined

// Ein Haus im Kalenderjahr, die Anlage rechnet Mai bis April ab. Die Abrechnung 2024 enthält
// 4.100 € Heizkosten von 10.000 € (41 %, Testfall B1).
async function haus(db: Database, tenancy: Record<string, unknown>): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }], ...tenancy })
  await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
  await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
  await createEntity(db, 'costItems', 'gs2024', { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer 2024', amountCents: 590000, key: 'area' })
  await createEntity(db, 'costItems', 'h2023', { propertyId: 'objekt-1', period: '2023-05', category: HEATING_CATEGORY, description: 'Messdienst 2023/2024', amountCents: 410000, key: 'area', heatingPlantId: 'hp1', taxYear: 2024 })
  await createEntity(db, 'costItems', 'h2025', { propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 150000, key: 'area', heatingPlantId: 'hp1', taxYear: 2026 })
}

const preview = async (opened: OpenedDatabase, body: unknown, today = TODAY): Promise<SeparatePreview> =>
  (await opened.read((db) => previewSeparate(db, 'hp1', body, today))) ?? assert.fail('keine Anlage')
// Mit der Marke der eben erstellten Vorschau, wie die Oberfläche es schickt (wie beim Wechsel des Zeitraums).
const apply = async (opened: OpenedDatabase, body: Record<string, unknown>) => {
  const { answers, ...rest } = body
  const { token } = await preview(opened, rest)
  return opened.write((db) => applySeparate(db, 'hp1', { ...rest, answers: { ...(answers ?? {}), token } }, TODAY))
}
const ein = (opened: OpenedDatabase, month: string, steps: Record<string, number>, extra: Record<string, unknown> = {}) =>
  apply(opened, { separate: true, month, answers: { steps: { t1: steps }, ...extra } })
const tenancyField = async (opened: OpenedDatabase, key: string) => fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), key)
const schliessen = (opened: OpenedDatabase, period: string) =>
  opened.write((db) => closeSettlement(db, { id: `s${period}`, propertyId: 'objekt-1', period: periodKey(period), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
const abrechnung = async (opened: OpenedDatabase, key: string) => {
  const stock = await opened.read(readStock)
  return computeSettlement(snapshotFor(stock, 'objekt-1', periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(key)))
}
const heizkosten = async (opened: OpenedDatabase, key: string) => {
  const stock = await opened.read(readStock)
  return computeSettlement(heatingSnapshotFor(stock, 'objekt-1', 'hp1', periodOfKey(MAI, periodKey(key)) ?? assert.fail(key)) ?? assert.fail('keine Anlage'))
}
const mieter = (s: { statements: { tenancyId: string; prepaymentCents: number; prepaymentNote?: string }[] }) =>
  s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')

test('B1/C1: Jede Stufe ab X wird geteilt, vorbelegt mit 41 %; das Mietkonto bleibt bei 300 und 330 €', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }, { from: '2026-01', monthlyCents: 33000 }] }))
    const v = await preview(opened, { separate: true, month: '2025-05' })
    assert.deepEqual([v.way, v.month, v.share], ['separate', '2025-05', { permille: 410, source: 'Abrechnung 2024: Heizkosten 4.100,00 € von 10.000,00 €' }])
    assert.deepEqual(v.steps, [{ tenancyId: 't1', tenantName: 'Müller', rows: [{ from: '2025-05', totalCents: 30000, heatingCents: 12300 }, { from: '2026-01', totalCents: 33000, heatingCents: 13500 }] }])
    assert.deepEqual(v.deadlines, [
      { period: '2025-05', label: '2025/2026', deadline: '2027-04-30', passed: false },
      { period: '2026-05', label: '2026/2027', deadline: '2028-04-30', passed: false },
    ])
    const ohne = await apply(opened, { separate: true, month: '2025-05' })
    assert.ok(ohne && 'error' in ohne)
    assert.match(ohne.error, /Müller: Heizanteil ab 05\/2025 eintragen/)
    const r = await ein(opened, '2025-05', { '2025-05': 12300, '2026-01': 13500 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [true, [{ from: '2025-05', until: null }]])
    assert.deepEqual(await tenancyField(opened, 'prepayments'), [{ from: '2025-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }, { from: '2026-01', monthlyCents: 19500 }])
    assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }, { from: '2026-01', monthlyCents: 13500 }])
    const stock = await opened.read(readStock)
    for (const [year, soll] of [[2025, 30000], [2026, 33000]] as const) {
      const row = rentLedger(snapshotFor(stock, 'objekt-1', calendarYearPeriod(year))).rows[0] ?? assert.fail('keine Zeile')
      assert.deepEqual(row.months.map((m) => m.sollCents), Array(12).fill(soll), `Soll ${year}`)
    }
  })
})

test('C2/D2: Jahreskorrektur 2026 über 3.300 € neu erfasst; 876 € vorläufig für Mai–Dezember 2026, angerechnet 1.368 €', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { prepaymentOverrides: { '2026-01': 330000 } }))
    const v = await preview(opened, { separate: true, month: '2026-01' })
    assert.deepEqual(v.overrides, [{
      tenancyId: 't1', tenantName: 'Müller', period: '2026-01', label: '2026', cents: 330000,
      asks: [
        { kind: 'total', period: '2026-01', label: '2026', months: '01–12/2026' },
        { kind: 'heating', period: '2025-05', label: '2025/2026', months: '01–04/2026' },
      ],
      remainder: { period: '2026-05', label: '2026/2027', months: '05–12/2026' },
    }])
    const r = await ein(opened, '2026-01', { '2026-01': 12300 }, { totals: { t1: { '2026-01': 212400 } }, overrides: { t1: { '2025-05': 30000 } } })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(await tenancyField(opened, 'heatingPrepaymentOverrides'), [
      { plantId: 'hp1', period: '2025-05', cents: 30000, provisional: false, fromMonth: null, toMonth: null },
      { plantId: 'hp1', period: '2026-05', cents: 87600, provisional: true, fromMonth: '2026-05', toMonth: '2026-12' },
    ])
    assert.equal(mieter(await heizkosten(opened, '2026-05')).prepaymentCents, 136800)
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 30000)
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 212400)
  })
})

test('C2: Beträge über der Jahreskorrektur werden abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { prepaymentOverrides: { '2026-01': 330000 } }))
    const r = await ein(opened, '2026-01', { '2026-01': 12300 }, { totals: { t1: { '2026-01': 300000 } }, overrides: { t1: { '2025-05': 40000 } } })
    assert.ok(r && 'error' in r)
    assert.match(r.error, /übersteigen die Jahreskorrektur 2026 \(3\.300,00 €\)/)
  })
})

test('C3: Nach dem Abschluss von 2025 frühestens ab 01/2026; 2025/2026 rechnet dann vier Monate an', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await schliessen(opened, '2025-01')
    const vorgabe = await preview(opened, { separate: true })
    assert.deepEqual([vorgabe.month, vorgabe.earliestMonth], ['2026-05', '2026-01'])
    const frueh = await preview(opened, { separate: true, month: '2025-05' })
    assert.deepEqual(frueh.blocked, ['Die Vorauszahlungen bis Dezember 2025 sind in der abgeschlossenen Abrechnung 2025 angerechnet. Öffnen Sie sie wieder, wenn Sie früher beginnen wollen.'])
    const abgelehnt = await ein(opened, '2025-05', { '2025-05': 12300 })
    assert.ok(abgelehnt && 'error' in abgelehnt)
    const r = await ein(opened, '2026-01', { '2026-01': 12300 })
    assert.ok(r && 'plant' in r)
    const a = mieter(await heizkosten(opened, '2025-05'))
    assert.deepEqual([a.prepaymentCents, a.prepaymentNote], [4 * 12300, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.'])
  })
})

test('C4: Ausschalten ohne Abschluss führt die Staffeln ab W zusammen; ohne Zusammenführen rechnet P beide an', async () => {
  for (const merge of [true, false]) {
    await withDatabase(async (opened) => {
      await opened.write((db) => haus(db, {}))
      await ein(opened, '2025-05', { '2025-05': 12300 })
      const v = await preview(opened, { separate: false })
      assert.deepEqual([v.until, v.earliestUntil, v.keep], ['2025-05', '2025-05', []])
      assert.deepEqual(v.merge, [{ tenancyId: 't1', tenantName: 'Müller', rows: [{ from: '2025-05', prepaymentCents: 30000 }] }])
      const r = await apply(opened, { separate: false, answers: { merge } })
      assert.ok(r && 'plant' in r)
      assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [false, []])
      assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), merge ? undefined : [{ from: '2025-05', monthlyCents: 12300 }])
      assert.equal(mieter(await abrechnung(opened, '2025-01')).prepaymentCents, 12 * 30000, `merge ${merge}`)
    })
  }
})

test('D1 Fall 1: P 2025 abgeschlossen, Ausschalten wirkt ab 2026/2027; 2025/2026 rechnet zwölf Monate an', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await schliessen(opened, '2025-01')
    const v = await preview(opened, { separate: false })
    assert.deepEqual([v.until, v.keep.map((k) => [k.period, k.deadline])], ['2026-05', [['2025-05', '2027-04-30']]])
    const frueh = await preview(opened, { separate: false, until: '2025-05' })
    assert.match(frueh.blocked.join(' '), /Die Heizperiode 2025\/2026 hat Monate in der abgeschlossenen Abrechnung 2025\. Sie bleiben eigene Heizkostenabrechnungen/)
    const r = await apply(opened, { separate: false, answers: {} })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(r.plant.separateSpans, [{ from: '2025-05', until: '2026-05' }])
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 12 * 12300)
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 12 * 17700 + 8 * 12300)
  })
})

test('D1 Fall 2: Heizkostenabrechnung 2025/2026 abgeschlossen; ihre Positionen kommen nicht in P 2026', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await opened.write((db) => db.insert(closedHeatingSettlements).values({ id: 'z', plantId: 'hp1', period: periodKey('2025-05'), closedAt: '2026-06-01', sentAt: null, settlement: {} }))
    const frueh = await preview(opened, { separate: false, until: '2025-05' })
    assert.match(frueh.blocked.join(' '), /Die Heizkostenabrechnung 2025\/2026 ist abgeschlossen/)
    const r = await apply(opened, { separate: false, answers: {} })
    assert.ok(r && 'plant' in r)
    const p2026 = await abrechnung(opened, '2026-01')
    assert.deepEqual(mieter({ statements: p2026.statements }).prepaymentCents, 12 * 17700 + 8 * 12300)
    assert.equal(p2026.statements.flatMap((s) => s.rows).some((row) => row.costItemId === 'h2025'), false)
  })
})

test('Wieder einschalten nach dem Ausschalten: die frühere Spanne bleibt, kein Monat doppelt (Review Focus 3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await schliessen(opened, '2025-01')
    await apply(opened, { separate: false, answers: {} })
    const zuFrueh = await preview(opened, { separate: true, month: '2026-01' })
    assert.deepEqual(zuFrueh.blocked, ['Bis April 2026 gilt die frühere getrennte Heizkostenabrechnung. Wählen Sie einen Beginn ab Mai 2026.'])
    const r = await ein(opened, '2026-05', { '2026-05': 12300 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(r.plant.separateSpans, [{ from: '2025-05', until: '2026-05' }, { from: '2026-05', until: null }])
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 12 * 12300)
    assert.equal(mieter(await heizkosten(opened, '2026-05')).prepaymentCents, 12 * 12300)
    // P 2026 rechnet keinen Monat der Heizstaffel an: Januar bis April gehören 2025/2026, Mai bis Dezember 2026/2027.
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 12 * 17700)
  })
})

test('R-g: Die Vorschau nennt eine abgelaufene Frist', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    const v = await preview(opened, { separate: true, month: '2025-05' }, '2027-06-01')
    assert.deepEqual(v.deadlines[0], { period: '2025-05', label: '2025/2026', deadline: '2027-04-30', passed: true })
  })
})

test('H = P: Einschalten teilt nur die Vorauszahlung, ohne Spanne und ohne neue Korrekturen (A3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db, { prepaymentOverrides: { '2025-01': 350000 } })
      await db.update(heatingPlants).set({ periodStartMonth: null }).where(eq(heatingPlants.id, 'hp1'))
    })
    const v = await preview(opened, { separate: true, month: '2025-01' })
    assert.deepEqual([v.way, v.overrides, v.deadlines], ['samePeriod', [], []])
    const r = await ein(opened, '2025-01', { '2025-01': 12300 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [true, []])
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.separateSettlement, true)
  })
})

test('Eine veraltete Vorschau schreibt nichts', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    const { token } = await preview(opened, { separate: true, month: '2025-05' })
    await opened.write((db) => createEntity(db, 'tenancies', 't2', { unitId: 'u1', tenantName: 'Neu', persons: 1, start: '2026-06-01', prepayments: [{ from: '2026-06', monthlyCents: 25000 }] }))
    const r = await opened.write((db) => applySeparate(db, 'hp1', { separate: true, month: '2025-05', answers: { steps: { t1: { '2025-05': 12300 } }, token } }, TODAY))
    assert.ok(r && 'error' in r)
    assert.match(r.error, /nicht mehr aktuell/)
    assert.deepEqual((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.separateSpans, [])
  })
})

test('Weg d mit Heizstaffel: Die Liste der versorgten Wohnungen ändert sich nicht still (Durchsicht von #231, Critical 1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db, {})
      await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true })
      await createEntity(db, 'tenancies', 't2', { unitId: 'u2', tenantName: 'Schmidt', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })
    })
    const v = await preview(opened, { separate: true, month: '2026-01' })
    const steps = Object.fromEntries(v.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((r) => [r.from, 10000]))]))
    const r = await apply(opened, { separate: true, month: '2026-01', answers: { steps } })
    assert.ok(r && 'plant' in r, JSON.stringify(r))
    const abgelehnt = (e: unknown) => e instanceof HeatingError && e.status === 409 && /Schmidt/.test(e.message) && /Heizvorauszahlung/.test(e.message)
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp1', { units: [{ unitId: 'u1', heatedAreaM2: null }] })), abgelehnt)
    await assert.rejects(opened.write((db) => updateEntity(db, 'units', 'u2', { noConnection: ['waerme'] })), abgelehnt)
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.units, null, 'nichts geschrieben')
    // Ohne Heizstaffel in der Wohnung darf die Liste sich ändern.
    await opened.write((db) => createEntity(db, 'units', 'u3', { propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true }))
    await opened.write((db) => updateEntity(db, 'units', 'u3', { noConnection: ['waerme'] }))
  })
})

test('Weg d mit Heizstaffel: ein Mietverhältnis wechselt nicht still zwischen versorgter und unversorgter Wohnung (Durchsicht von #231, Minor 5)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db, {})
      await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true, noConnection: ['waerme'] })
    })
    const v = await preview(opened, { separate: true, month: '2026-01' })
    const steps = Object.fromEntries(v.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((r) => [r.from, 10000]))]))
    assert.ok(await apply(opened, { separate: true, month: '2026-01', answers: { steps } }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'tenancies', 't1', { unitId: 'u2' })),
      (e: unknown) => e instanceof HeatingError && e.status === 409 && /Müller/.test(e.message))
  })
})

// Laienprobe B1: Das Formular des Mietverhältnisses war vor dem Einschalten geladen und schickt
// beim Speichern seinen alten Stand, also die ungeteilte Staffel und eine leere Heizstaffel. Ohne
// Marke ersetzte die Route beides, und die Aufteilung war ohne Meldung weg. Mit der Marke des
// geladenen Stands lehnt sie ab, und es bleibt, was das Aufteilen geschrieben hat.
test('Laienprobe B1: ein veraltetes Formular löscht die Heizstaffel nicht, sondern bekommt 409', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }] }))
    const geladen = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    if (!geladen || !('tenantName' in geladen) || !('prepayments' in geladen)) return assert.fail('t1 fehlt')
    await ein(opened, '2025-05', { '2025-05': 12300 })
    const veraltet = {
      tenantName: 'Müller', phone: '0171 1234567', start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 30000 }], heatingPrepayments: [], flatRates: [], baseRents: [],
      personHistory: [{ from: '2025-01-01', persons: 1 }],
      ifUnchanged: tenancyStamp(geladen),
    }
    await assert.rejects(
      opened.write((db) => updateEntity(db, 'tenancies', 't1', veraltet)),
      (e: unknown) => e instanceof StaleTenancyError && e.status === 409 && /inzwischen/.test(e.message),
    )
    assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
    assert.deepEqual(await tenancyField(opened, 'prepayments'), [{ from: '2025-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }])
    // Mit dem neu geladenen Stand geht dasselbe Speichern durch.
    const frisch = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    if (!frisch || !('prepayments' in frisch)) return assert.fail('t1 fehlt')
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { phone: '0171 1234567', ifUnchanged: tenancyStamp(frisch) }))
    assert.equal(await tenancyField(opened, 'phone'), '0171 1234567')
    assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
  })
})

// Laienprobe B3a: Weg d rückwirkend ab 05/2025. Am 15.01.2027 ist die Frist der Abrechnung 2025
// abgelaufen; das Aufteilen ändert sie trotzdem (sie verliert den Heizanteil Mai bis Dezember). Die
// Vorschau nennt das vorher, mit Frist und Ergebnis vorher und nachher, und speichert nichts.
test('Laienprobe B3a: die Vorschau nennt abgelaufene und laufende Abrechnungen, die das Aufteilen ändert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }] }))
    const v = await preview(opened, { separate: true, month: '2025-05' }, '2027-01-15')
    const p2025 = v.effects.find((e) => e.label === '2025') ?? assert.fail(JSON.stringify(v.effects))
    assert.deepEqual([p2025.deadline, p2025.passed], ['2026-12-31', true])
    assert.deepEqual(p2025.tenants, [{ tenantName: 'Müller', beforeCents: 360000, afterCents: 360000 - 8 * 12300 }])
    const h = v.effects.find((e) => e.label === 'Heizkosten 2025/2026') ?? assert.fail('Heizkostenabrechnung fehlt')
    assert.deepEqual([h.deadline, h.passed], ['2027-04-30', false])
    assert.deepEqual(h.tenants, [{ tenantName: 'Müller', beforeCents: null, afterCents: 12 * 12300 - 150000 }])
    assert.equal(await tenancyField(opened, 'heatingPrepayments'), undefined, 'der Probelauf hat nichts gespeichert')
  })
})

test('Review Runde 1: Weg d rückwirkend über eine abgelaufene Frist nur mit Bestätigung', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }] }))
    const body = { separate: true, month: '2025-05' }
    const { token } = await preview(opened, body, '2027-01-15')
    const ohne = await opened.write((db) => applySeparate(db, 'hp1', { ...body, answers: { steps: { t1: { '2025-05': 12300 } }, token } }, '2027-01-15'))
    assert.ok(ohne && 'error' in ohne, 'abgelehnt')
    assert.match(ohne.error, /Weil Sie die Vorauszahlung rückwirkend aufteilen, haben Sie die Verspätung zu vertreten/)
    assert.ok(ohne.preview.effects.some((e) => e.passed))
    assert.equal(await tenancyField(opened, 'heatingPrepayments'), undefined)
    const mit = await opened.write((db) => applySeparate(db, 'hp1', { ...body, answers: { steps: { t1: { '2025-05': 12300 } }, token, understood: true } }, '2027-01-15'))
    assert.ok(mit && 'plant' in mit)
  })
})

// Review Runde 3 (N2): Weg d rückwirkend, die Abrechnung 2025 hatte schon eine Nachzahlung; verloren ist
// nur das Mehr (der Heizanteil Mai bis Dezember), nicht die ganze Nachzahlung.
test('Review Runde 3: Weg d, verlorene Nachforderung der Abrechnung 2025 ist das Mehr', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }] })
      await createEntity(db, 'costItems', 'gs2025', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 500000, key: 'area' })
    })
    const v = await preview(opened, { separate: true, month: '2025-05' }, '2027-01-15')
    const e = v.effects.find((x) => x.label === '2025') ?? assert.fail(JSON.stringify(v.effects))
    const [m] = e.tenants
    assert.ok(m && m.beforeCents !== null && m.beforeCents < 0 && m.afterCents < m.beforeCents, JSON.stringify(e.tenants))
    assert.equal(e.lostClaimsCents, m.beforeCents - m.afterCents)
  })
})

// Review Runde 3 (N3): Ein Wechsel der Heizperiode verkürzt die getrennt abgerechnete Heizperiode
// 2025/2026 auf 05/2025–02/2026. Verglichen wird wie beim Zeitraumwechsel mit dem bisherigen Zeitraum
// gleichen Schlüssels; war dessen Frist (30.04.2027) am 01.06.2027 schon abgelaufen, ist nur das Mehr verloren.
test('Review Runde 3: verkürzte Heizperiode nach Weg d, verglichen mit dem bisherigen Zeitraum gleichen Schlüssels', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }] }))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    const heute = '2027-06-01'
    const regeln = { startMonth: 5, changes: ['2026-03'] }
    const v = (await opened.read((db) => previewHeatingPeriodChange(db, 'hp1', regeln, heute))) ?? assert.fail('keine Anlage')
    const e = v.effects.find((x) => x.label === 'Heizkosten 01.05.2025–28.02.2026') ?? assert.fail(JSON.stringify(v.effects.map((x) => x.label)))
    assert.deepEqual(e.tenants, [{ tenantName: 'Müller', beforeCents: 12 * 12300 - 150000, afterCents: 10 * 12300 - 150000 }])
    assert.equal(e.lostClaimsCents, 2 * 12300)
  })
})
