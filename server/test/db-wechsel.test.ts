// Wechsel des Abrechnungszeitraums (#208, Entwurf 3.6, N4, Testfall G-A1/N4 aus 12.2): Vorschau,
// Neuerfassung der Jahreskorrekturen, Aufteilen und Zuordnen der Positionen, Sperre neben einem
// Abschluss, alles in einer Transaktion.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { applyPeriodChange, monthsText, previewPeriodChange } from '../src/db/periodChange.ts'
import { closeSettlement, createEntity, listCollection, listProperties, PeriodError, updateEntity } from '../src/db/repository.ts'
import { assessments } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, PeriodChangePreview, Tenancy } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI_AB_2025 = { startMonth: 1, changes: ['2025-05'] }
let n = 0
const ids = () => `neu-${++n}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-wechsel-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Der Bestand aus Testfall G-A1/N4: Mieter A das ganze Jahr mit Jahreskorrektur 2.200 € (Soll
// 2.400), Mieter B nur bis 28.02.2025 mit 350 €, Grundsteuer 480 € mit Leistungszeitraum 2025,
// Müllabfuhr ohne Leistungszeitraum.
async function bestand(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
    await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true })
    await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: { '2025-01': 220000 } })
    await createEntity(db, 'tenancies', 't-b', { unitId: 'u2', tenantName: 'B', persons: 1, start: '2024-01-01', end: '2025-02-28', prepayments: [{ from: '2024-01', monthlyCents: 17500 }], prepaymentOverrides: { '2025-01': 35000 } })
    await createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
  })
}

const items = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const tenancies = async (opened: OpenedDatabase): Promise<Tenancy[]> =>
  (await opened.read((db) => listCollection(db, 'tenancies'))).filter((e): e is Tenancy => 'tenantName' in e)
const rules = async (opened: OpenedDatabase) => (await opened.read(listProperties)).find((p) => p.id === 'objekt-1')?.periodRules
const preview = async (opened: OpenedDatabase, next: unknown): Promise<PeriodChangePreview> =>
  (await opened.read((db) => previewPeriodChange(db, 'objekt-1', next, TODAY))) ?? assert.fail('kein Objekt')

test('Monate in Worten', () => {
  assert.equal(monthsText(['2025-01', '2025-02', '2025-03', '2025-04']), '01–04/2025')
  assert.equal(monthsText(['2025-05', '2025-06', '2026-04']), '05/2025–04/2026')
  assert.equal(monthsText(['2025-03']), '03/2025')
})

test('Vorschau G-A1/N4: Rumpf, Aufteilen, Zuordnen und Neuerfassen der Jahreskorrektur nur für A', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const v = await preview(opened, MAI_AB_2025)
    assert.deepEqual(v.newShort, [{ key: '2025-01', label: '01.01.–30.04.2025' }])
    assert.ok(v.periods.some((p) => p.key === '2025-05' && p.label === '2025/2026'))
    assert.deepEqual(v.blocked, [])
    assert.deepEqual(v.moves.map((m) => [m.costItemId, m.parts.map((p) => [p.period, p.amountCents])]), [['gs', [['2025-01', 15781], ['2025-05', 32219]]]])
    assert.deepEqual(v.groups.map((g) => [g.from, g.fromLabel, g.items.map((i) => i.costItemId), g.options.map((o) => o.key), g.suggested]),
      [['2025-01', '2025', ['mu'], ['2025-01', '2025-05'], '2025-01']])
    assert.deepEqual(v.overrides, [{
      tenancyId: 't-a', tenantName: 'A',
      from: [{ key: '2025-01', label: '2025', cents: 220000 }],
      ask: [{ period: '2025-01', label: '01.01.–30.04.2025', months: '01–04/2025' }, { period: '2025-05', label: '2025/2026', months: '05/2025–04/2026' }],
    }], 'B lag ganz im Rumpf und behält seine Korrektur')
  })
})

test('Ohne Antworten wird nicht gespeichert, mit Antworten alles in einem Schritt (N4)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const ohne = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(ohne && 'error' in ohne, 'abgelehnt')
    assert.match(ohne.error, /Für den Wechsel fehlen Angaben/)
    assert.match(ohne.error, /„Müll 2025“/)
    assert.match(ohne.error, /A: tatsächlich gezahlt 01–04\/2025/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] }, 'nichts geschrieben')
    assert.equal((await items(opened)).length, 2)

    const ok = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{
      groups: { '2025-01': '2025-01' },
      overrides: { 't-a': { '2025-01': 70000, '2025-05': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(ok && 'property' in ok)
    assert.deepEqual(ok.property.periodRules, MAI_AB_2025)
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.taxYear]).sort(), [
      ['2025-01', 15781, undefined], ['2025-01', 30000, undefined], ['2025-05', 32219, 2025],
    ])
    const korrektur = Object.fromEntries((await tenancies(opened)).map((t) => [t.id, t.prepaymentOverrides]))
    assert.deepEqual(korrektur, { 't-a': { '2025-01': 70000 }, 't-b': { '2025-01': 35000 } })
  })
})

test('Ein Wechsel neben einer abgeschlossenen Abrechnung wird abgelehnt, nichts geschrieben (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => closeSettlement(db, { id: 'z', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01T00:00:00Z', sentAt: null, settlement: {} }))
    const v = await preview(opened, MAI_AB_2025)
    assert.match(v.blocked.join(' '), /Die Abrechnung 2025 ist abgeschlossen/)
    const r = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(r && 'error' in r)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
    // Ein Wechsel nach dem abgeschlossenen Zeitraum geht.
    const spaeter = await preview(opened, { startMonth: 1, changes: ['2026-05'] })
    assert.deepEqual(spaeter.blocked, [])
  })
})

test('Eine Antwort, die nicht passt, oder eine veraltete Vorschau: 409 statt eines halben Wechsels (Review Focus 3)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const falsch = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{
      groups: { '2025-01': '2024-05' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(falsch && 'error' in falsch)
    assert.match(falsch.error, /„Müll 2025“/)
    const halb = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{
      groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000 } },
    }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(halb && 'error' in halb)
    assert.match(halb.error, /05\/2025–04\/2026/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
    // Derselbe Wechsel ein zweites Mal: Es ändert sich nichts.
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    await assert.rejects(opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY)),
      (err: unknown) => err instanceof PeriodError && /Es ändert sich nichts/.test(err.message))
  })
})

test('Regeln: Beginnmonat 1 bis 12, Monate als JJJJ-MM, kein Wechsel auf einen Monat, in dem ohnehin ein Zeitraum beginnt', async () => {
  await withDatabase(async (opened) => {
    const fehler = async (next: unknown, muster: RegExp) =>
      assert.rejects(opened.read((db) => previewPeriodChange(db, 'objekt-1', next, TODAY)), (err: unknown) => err instanceof PeriodError && muster.test(err.message))
    await fehler({ startMonth: 13, changes: [] }, /Januar bis Dezember/)
    await fehler({ startMonth: 1, changes: ['2025-5'] }, /kein Monat/)
    await fehler({ startMonth: 1, changes: ['2026-01'] }, /Ab Januar 2026 beginnt ohnehin ein Abrechnungszeitraum/)
    await fehler(null, /Rhythmus/)
    assert.equal(await opened.read((db) => previewPeriodChange(db, 'gibt-es-nicht', MAI_AB_2025, TODAY)), null)
  })
})

test('Einen Wechsel entfernen: Der Rumpf wächst wieder zum Jahr, beide Korrekturen werden neu erfasst', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    const v = await preview(opened, { startMonth: 1, changes: [] })
    const a = v.overrides.find((o) => o.tenancyId === 't-a') ?? assert.fail('A fehlt')
    assert.deepEqual(a.ask.map((x) => [x.period, x.months]), [['2025-01', '01–12/2025'], ['2026-01', '01–12/2026']])
    assert.deepEqual(v.newShort, [])
  })
})

test('Eine Auswertung wandert auf den Zeitraum mit der größten Überschneidung, wenn es ihren nicht mehr gibt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a1', file: 'a.pdf', propertyId: 'objekt-1', year: 2026, requestedPeriod: periodKey('2026-01'), createdAt: '2026-03-01T00:00:00Z' })
    })
    const v = await preview(opened, MAI_AB_2025)
    assert.deepEqual(v.assessments, [{ assessmentId: 'a1', file: 'a.pdf', from: '2026-01', to: '2026-05', toLabel: '2026/2027' }])
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    const [row] = await opened.read((db) => db.select().from(assessments))
    assert.equal(row?.requestedPeriod, '2026-05')
  })
})

// Durchsicht von #222: Die Schreibprüfungen verlangen, dass jeder gespeicherte Schlüssel einen
// Zeitraum des Objekts bezeichnet. Bliebe nach dem Wechsel einer verwaist, scheiterte danach jedes
// Speichern dieses Mietverhältnisses oder dieser Position.
async function everythingSaves(opened: OpenedDatabase): Promise<void> {
  for (const t of await tenancies(opened)) await opened.write((db) => updateEntity(db, 'tenancies', t.id, { notes: 'nach dem Wechsel' }))
  for (const c of await items(opened)) await opened.write((db) => updateEntity(db, 'costItems', c.id, { vendor: 'nach dem Wechsel' }))
}

test('Nach einem Wechsel lässt sich jedes Mietverhältnis und jede Position speichern, auch nach dem Entfernen des Wechsels', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    await everythingSaves(opened)
    const zurueck = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', { startMonth: 1, changes: [] }, { ...{
      groups: { '2025-05': '2025-01' }, overrides: { 't-a': { '2025-01': 220000, '2026-01': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', { startMonth: 1, changes: [] }, TODAY))?.token }, ids, TODAY))
    assert.ok(zurueck && 'property' in zurueck, zurueck && 'error' in zurueck ? zurueck.error : 'kein Objekt')
    await everythingSaves(opened)
    const grundsteuer = (await items(opened)).filter((c) => c.category === 'Grundsteuer')
    assert.deepEqual(grundsteuer.map((c) => c.period), ['2025-01', '2025-01'])
    assert.equal(grundsteuer.reduce((a, c) => a + c.amountCents, 0), 48000)
  })
})

test('Ein schon aufgeteilter Teil wird beim nächsten Wechsel nur über seinen eigenen Anteil geteilt', async () => {
  // Jeder Teil trägt den ganzen Leistungszeitraum der Rechnung, sein Betrag ist aber nur der Anteil
  // seines Zeitraums. Würde er über den ganzen Leistungszeitraum neu geteilt, landete ein Teil des
  // Mai-bis-Dezember-Betrags noch einmal in Januar bis April.
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    const juli = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, { ...{
      overrides: { 't-a': { '2025-01': 120000, '2025-07': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, TODAY))?.token }, ids, TODAY))
    assert.ok(juli && 'property' in juli, juli && 'error' in juli ? juli.error : 'kein Objekt')
    const grundsteuer = (await items(opened)).filter((c) => c.category === 'Grundsteuer').map((c) => [c.period, c.amountCents]).sort()
    // Mai und Juni: 61 von 245 Tagen des Teils über 32.219 Cent.
    assert.deepEqual(grundsteuer, [['2025-01', 15781], ['2025-01', 8022], ['2025-07', 24197]])
    await everythingSaves(opened)
  })
})
