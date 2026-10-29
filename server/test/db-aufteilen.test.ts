// Aufteilen beim Speichern (#208, Entwurf 3.4): Vorschau, Schreiben in einer Transaktion,
// abgeschlossene Zeiträume, Heizkosten, Jahr der Zahlung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { closeSettlement, createEntity, listCollection, PeriodConflict, PeriodError, previewCostItemSplit, removeEntity, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { costItems as costItemsTable, costSources, periodChanges, properties } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem } from '../../shared/types.ts'
import { SPLIT_FIELDS, splitBlocker } from '../../shared/splitPart.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-aufteilen-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const setRules = (opened: OpenedDatabase, startMonth: number, changes: string[]) =>
  opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: startMonth }).where(eq(properties.id, 'objekt-1'))
    for (const fromMonth of changes) await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth })
  })
let n = 0
const ids = () => `neu-${++n}`
const grundsteuer = { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', invoiceFile: 'gs.pdf', taxYear: 2025 }
const costItems = async (opened: OpenedDatabase): Promise<CostItem[]> => (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)

test('Vorschau und Speichern: zwei Positionen, Beleg an beiden, Jahr der Zahlung nur am Teil über zwei Kalenderjahre', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => [p.period, p.label, p.amountCents, p.needsTaxYear, p.closed]), [
      ['2025-01', '01.01.–30.04.2025', 15781, false, false],
      ['2025-05', '2025/2026', 32219, true, false],
    ])
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    assert.deepEqual(teile.map((c) => [c.period, c.amountCents, c.description, c.invoiceFile, c.taxYear, c.serviceFrom, c.serviceTo]), [
      ['2025-01', 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)', 'gs.pdf', undefined, '2025-01-01', '2025-12-31'],
      ['2025-05', 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', 'gs.pdf', 2025, '2025-01-01', '2025-12-31'],
    ])
  })
})

test('Ohne Jahr der Zahlung für den Teil über zwei Kalenderjahre wird nichts gespeichert', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const { taxYear: _ohne, ...ohneJahr } = grundsteuer
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', ohneJahr, null, ids)),
      (err: unknown) => err instanceof PeriodError && /Jahr der Zahlung/.test(err.message))
    assert.equal((await costItems(opened)).length, 0, 'auch der erste Teil steht nicht da')
  })
})

test('Ein abgeschlossener Zeitraum lehnt das Aufteilen ab (409), nichts wird geschrieben', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await opened.write((db) => closeSettlement(db, { id: 'z', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01T00:00:00Z', sentAt: null, settlement: {} }))
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => p.closed), [true, false])
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids)),
      (err: unknown) => err instanceof PeriodConflict && /Die Abrechnung 01\.01\.–30\.04\.2025 ist abgeschlossen/.test(err.message))
    assert.equal((await costItems(opened)).length, 0)
  })
})

test('Heizkosten werden nicht nach Tagen aufgeteilt; eine Rechnung in einem Zeitraum braucht kein Aufteilen', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, 'objekt-1', { ...grundsteuer, category: 'Heizung und Warmwasser' }, null)),
      (err: unknown) => err instanceof PeriodError && /Heizkosten teilt Mietfuchs nicht nach Tagen auf/.test(err.message))
    const eins = { ...grundsteuer, serviceFrom: '2025-01-01', serviceTo: '2025-03-31', taxYear: undefined }
    assert.equal((await opened.read((db) => previewCostItemSplit(db, 'objekt-1', eins, null))).length, 1)
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', eins, null, ids)),
      (err: unknown) => err instanceof PeriodError && /liegt in einem einzigen Abrechnungszeitraum/.test(err.message))
  })
})

test('Eine vorhandene Position aufteilen: Sie behält ihre Kennung für den Teil ihres Zeitraums', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'alt', { ...grundsteuer, propertyId: 'objekt-1', serviceFrom: undefined, serviceTo: undefined, taxYear: undefined }))
    await setRules(opened, 1, ['2025-05'])
    const teile = await opened.write((db) => saveCostItemSplit(db, null, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }, 'alt', ids))
    assert.deepEqual(teile.map((c) => [c.id === 'alt', c.period, c.amountCents]), [[true, '2025-01', 15781], [false, '2025-05', 32219]])
    assert.equal((await costItems(opened)).length, 2)
  })
})

// #454: Einzelbeträge hängen am Mieter; welcher in welchen Zeitraum gehört, weiß nur die Abrechnung, aus der sie stammen.
// Vorher standen sie ungekürzt in jedem Teil, die Summe überstieg den Teil, und in beiden Zeiträumen wurde nichts verteilt.
test('#454: Einzelbeträge werden nicht nach Tagen aufgeteilt; Vorschau, Speichern und gewöhnliches Speichern sagen, was zu tun ist', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-07'])
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' }))
    const garten = { period: '2025-01', category: 'Gartenpflege', description: 'Garten', amountCents: 10000, key: 'amounts', tenancyAmounts: { t1: 10000 }, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, 'objekt-1', garten, null)), (e) => e instanceof PeriodError && /nach Einzelbeträgen verteilt.*Erfassen Sie die Rechnung je Abrechnungszeitraum.*ohne Leistungszeitraum \(Abflussprinzip, BGH VIII ZR 49\/07\)\.$/.test(e.message))
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', garten, null, ids)), (e) => e instanceof PeriodError && /nach Einzelbeträgen verteilt/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'g', { ...garten, propertyId: 'objekt-1' })),
      (e) => e instanceof PeriodError && /Erfassen Sie die Rechnung je Abrechnungszeitraum/.test(e.message) && !/Aufteilen und speichern/.test(e.message))
    assert.deepEqual(await costItems(opened), [], 'nichts geschrieben')
  })
})

// #454, Architektur: Was ein Teil von der Rechnung erbt, steht in SPLIT_FIELDS. Jedes Feld `same` und `whole` kommt
// unverändert in jedem Teil an; die Felder `part` setzt das Aufteilen.
test('#454: jeder Teil erbt die Felder `same` und `whole` unverändert', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-07'])
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true, mea: 50 }))
    const hausgeld = { period: '2025-01', category: 'Hauswart', description: 'Hausmeister', vendor: 'WEG Muster', amountCents: 10000, key: 'external',
      externalBasis: { measure: 'mea', total: 1000, totalCents: 200000 }, participantUnitIds: ['u1'], serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }
    await opened.write((db) => saveCostItemSplit(db, 'objekt-1', hausgeld, null, ids))
    const parts = await costItems(opened)
    assert.equal(parts.length, 2)
    const [first] = parts
    if (first === undefined) return assert.fail('kein Teil')
    for (const [field, rule] of Object.entries(SPLIT_FIELDS)) {
      if (rule !== 'same' && rule !== 'whole') continue
      for (const p of parts) assert.deepEqual(p[field as keyof CostItem], first[field as keyof CostItem], `${field} in ${p.period}`)
    }
    assert.deepEqual(first.externalBasis, hausgeld.externalBasis)
    assert.deepEqual(parts.map((p) => p.amountCents).reduce((a, b) => a + b, 0), 10000)
  })
})

// Durchsicht von #454, Befund 1: Das Formular fragt bei jedem Leistungszeitraum die Vorschau (`needsSplitCheck`). Eine
// Rechnung mit Einzelbeträgen, deren Leistungszeitraum in einem einzigen Zeitraum liegt, muss dort einen Teil ergeben
// und sich gewöhnlich speichern lassen; abgelehnt wird nur, was wirklich geteilt würde.
test('#454: Einzelbeträge mit Leistungszeitraum in einem Zeitraum: Vorschau ein Teil, gewöhnlich gespeichert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' }))
    const kabel = { period: '2025-01', category: 'Kabelanschluss', description: 'Kabel', amountCents: 12000, key: 'amounts', tenancyAmounts: { t1: 12000 }, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', kabel, null))
    assert.deepEqual(vorschau.map((p) => [p.period, p.amountCents]), [['2025-01', 12000]])
    await opened.write((db) => createEntity(db, 'costItems', 'k', { ...kabel, propertyId: 'objekt-1' }))
    assert.deepEqual((await costItems(opened)).map((c) => [c.id, c.amountCents]), [['k', 12000]])
  })
})

// #455: Das Aufteilen legt die Quelle an, alle Teile verweisen darauf; der Wächter lässt an einem Teil mit Quelle
// nur zu, was die Teile zusammenhält.
const sourceIdsOf = async (opened: OpenedDatabase) => (await costItems(opened)).map((c) => c.sourceId)

test('#455: Aufteilen legt eine Quelle an, alle Teile verweisen darauf', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    const sourceId = teile[0]?.sourceId
    assert.ok(sourceId, 'der erste Teil hat eine Quelle')
    assert.deepEqual(teile.map((c) => c.sourceId), [sourceId, sourceId])
    const quellen = await opened.read((db) => db.select().from(costSources))
    assert.deepEqual(quellen.map((q) => [q.id, q.propertyId, q.rule]), [[sourceId, 'objekt-1', 'days']])
  })
})

test('#455: Ablehnen beim Aufteilen lässt keine Quelle zurück', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const { taxYear: _ohne, ...ohneJahr } = grundsteuer
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', ohneJahr, null, ids)), PeriodError)
    assert.deepEqual(await opened.read((db) => db.select().from(costSources)), [])
  })
})

test('#455: An einem Teil mit Quelle lehnt der Wächter ab: andere Kostenart, Schlüssel Einzelbeträge, Betriebsstrom', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const [teil] = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    assert.ok(teil)
    const update = (body: object) => opened.write((db) => updateEntity(db, 'costItems', teil.id, body))
    await assert.rejects(update({ category: 'Gartenpflege' }), (e) => e instanceof PeriodError && /ein Teil einer aufgeteilten Rechnung.*Kostenart/.test(e.message))
    await assert.rejects(update({ key: 'amounts', tenancyAmounts: {} }), (e) => e instanceof PeriodError && e.message.includes(splitBlocker({ key: 'amounts', description: teil.description }) ?? assert.fail('kein Satz')))
    await assert.rejects(update({ operatingPower: 'deduction' }), (e) => e instanceof PeriodError && /Betriebsstrom/.test(e.message))
    const nach = (await costItems(opened)).find((c) => c.id === teil.id)
    assert.deepEqual([nach?.category, nach?.key, nach?.operatingPower], ['Grundsteuer', 'area', undefined])
  })
})

test('#455: Betrag, Rechnungssteller, Beleg und Schlüssel (nicht Einzelbeträge) lassen sich je Teil berichtigen', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const [teil] = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    assert.ok(teil)
    await opened.write((db) => updateEntity(db, 'costItems', teil.id, { amountCents: 15000, vendor: 'Stadt', invoiceFile: 'neu.pdf', key: 'persons' }))
    const nach = (await costItems(opened)).find((c) => c.id === teil.id)
    assert.deepEqual([nach?.amountCents, nach?.vendor, nach?.invoiceFile, nach?.key, nach?.sourceId], [15000, 'Stadt', 'neu.pdf', 'persons', teil.sourceId])
    assert.deepEqual(await sourceIdsOf(opened), [teil.sourceId, teil.sourceId])
  })
})

// #455 Schritt 2: Teile mit Quelle, die in einem einzigen Zeitraum liegen (Jahresobjekt, Leistungszeitraum 2025).
async function einzeitraumQuelle(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await db.insert(costSources).values({ id: 'q1', propertyId: 'objekt-1', rule: 'days' })
  })
  const teil = { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }
  await opened.write((db) => createEntity(db, 'costItems', 'a', { ...teil, description: 'G (Teil 1)', amountCents: 12000 }))
  await opened.write((db) => createEntity(db, 'costItems', 'b', { ...teil, description: 'G (Teil 2)', amountCents: 24500 }))
  await opened.write(async (db) => {
    await db.update(costItemsTable).set({ sourceId: 'q1' })
  })
}

test('#455: Ein Teil mit Quelle in einem Zeitraum wird nicht noch einmal aufgeteilt (Vorschau und Speichern)', async () => {
  await withDatabase(async (opened) => {
    await einzeitraumQuelle(opened)
    const body = { serviceTo: '2026-06-30' }
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, null, body, 'a')), (e) => e instanceof PeriodError && /ein Teil einer aufgeteilten Rechnung/.test(e.message))
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, null, body, 'a', ids)), (e) => e instanceof PeriodError)
    assert.deepEqual((await costItems(opened)).map((c) => [c.id, c.sourceId, c.amountCents]), [['a', 'q1', 12000], ['b', 'q1', 24500]])
  })
})

test('#455: Ein Teil mit Quelle im selben Zeitraum wechselt weder Zeitraum noch Leistungszeitraum', async () => {
  await withDatabase(async (opened) => {
    await einzeitraumQuelle(opened)
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'a', { period: '2026-01', serviceFrom: '2026-01-01', serviceTo: '2026-12-31', taxYear: 2026 })),
      (e) => e instanceof PeriodError && /ein Teil einer aufgeteilten Rechnung/.test(e.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'a', { serviceTo: '2025-06-30' })), PeriodError)
    assert.deepEqual((await costItems(opened)).map((c) => [c.period, c.serviceTo]), [['2025-01', '2025-12-31'], ['2025-01', '2025-12-31']])
  })
})

test('#455: Am Betriebsstrom eines Teils mit Quelle ändert sich nichts, auch kein Aufheben', async () => {
  await withDatabase(async (opened) => {
    await einzeitraumQuelle(opened)
    await opened.write(async (db) => { await db.update(costItemsTable).set({ operatingPower: 'deduction', category: 'Beleuchtung/Allgemeinstrom', amountCents: -500, operatingPowerGeneralId: 'b' }).where(eq(costItemsTable.id, 'a')) })
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'a', { operatingPower: null })), (e) => e instanceof PeriodError && /Betriebsstrom/.test(e.message))
  })
})

// Durchsicht von PR 2, M3: Sind die Geschwister gelöscht, bleibt der letzte Teil ein Teil mit Quelle und gesperrt
// (Spec: „Löschen je Teil wie heute“). Jeder Satz der Sperre nennt den Ausweg, der wirklich geht: alle Teile löschen und
// die Rechnung neu erfassen. Der Ausweg wird hier auch gegangen.
test('#455: Ein Teil ohne Geschwister bleibt gesperrt, jeder Satz nennt Löschen und neu Erfassen, und das geht', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const [teil, geschwister] = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    if (!teil || !geschwister) return assert.fail('zwei Teile erwartet')
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', geschwister.id)), true)
    const update = (body: object) => opened.write((db) => updateEntity(db, 'costItems', teil.id, body))
    // Der Ausweg im Wortlaut je Sperre (Durchsicht von Task 7, M1–M3): Er muss zum Speichern passen, das danach kommt.
    // Wer nicht aufteilt, erfasst je Zeitraum eine Position; der Schritt „löschen“ steht vor dem Erfassen.
    const zeitraum = /für einen anderen Leistungs- oder Abrechnungszeitraum löschen Sie alle Teile und erfassen die Rechnung neu mit „Aufteilen und speichern“/
    const sperren: [string, object, RegExp][] = [
      ['Leistungszeitraum', { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' }, zeitraum],
      ['Zeitraum', { period: '2025-05', taxYear: 2025 }, zeitraum],
      ['Kostenart', { category: 'Gartenpflege' }, /Löschen Sie alle Teile und erfassen Sie die Rechnung neu mit „Aufteilen und speichern“/],
      ['Betriebsstrom', { operatingPower: 'deduction' }, /Löschen Sie dafür alle Teile und erfassen Sie die Rechnung neu, je Abrechnungszeitraum eine Position mit dem Leistungszeitraum in diesem Zeitraum\.$/],
      ['Einzelbeträge', { key: 'amounts', tenancyAmounts: {} }, /ist ein Teil einer aufgeteilten Rechnung\. Löschen Sie dafür zuerst alle Teile\. „[^“]*“ ist nach Einzelbeträgen verteilt\..*Erfassen Sie die Rechnung je Abrechnungszeitraum/],
    ]
    for (const [was, body, ausweg] of sperren) {
      await assert.rejects(update(body), (e) => e instanceof PeriodError && ausweg.test(e.message), was)
    }
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, null, { serviceTo: '2026-06-30' }, teil.id)), (e) => e instanceof PeriodError && zeitraum.test(e.message), 'erneut aufteilen')
    assert.deepEqual(await sourceIdsOf(opened), [teil.sourceId], 'der Teil behält seine Quelle')
    // Der Ausweg: den letzten Teil löschen (die Quelle fällt mit), dann neu erfassen, hier ohne Aufteilen in einem Zeitraum.
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', teil.id)), true)
    assert.deepEqual(await opened.read((db) => db.select().from(costSources)), [])
    await opened.write((db) => createEntity(db, 'costItems', 'neu', { ...grundsteuer, propertyId: 'objekt-1', serviceFrom: '2025-01-01', serviceTo: '2025-04-30', category: 'Gartenpflege' }))
    assert.deepEqual((await costItems(opened)).map((c) => [c.id, c.category, c.sourceId]), [['neu', 'Gartenpflege', undefined]])
  })
})
