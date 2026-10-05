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
import { lostClaims } from '../src/db/dryRun.ts'
import { closeSettlement, createEntity, listCollection, listProperties, PeriodError, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { eq } from 'drizzle-orm'
import { assessmentLines, assessments, properties } from '../src/db/schema.ts'
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
      [['2025-01', '2025', ['mu'], ['2025-01', '2025-05'], 'split']], 'Laienprobe B2: ohne Leistungszeitraum vorbelegt mit dem Aufteilen nach Tagen')
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
    const ohne = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(ohne && 'error' in ohne, 'abgelehnt')
    assert.match(ohne.error, /Für den Wechsel fehlen Angaben/)
    assert.match(ohne.error, /„Müll 2025“/)
    assert.match(ohne.error, /A: tatsächlich gezahlt 01–04\/2025/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] }, 'nichts geschrieben')
    assert.equal((await items(opened)).length, 2)

    const ok = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{
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
    const r = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
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
    const falsch = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{
      groups: { '2025-01': '2024-05' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(falsch && 'error' in falsch)
    assert.match(falsch.error, /„Müll 2025“/)
    const halb = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{
      groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000 } },
    }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    assert.ok(halb && 'error' in halb)
    assert.match(halb.error, /05\/2025–04\/2026/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
    // Derselbe Wechsel ein zweites Mal: Es ändert sich nichts.
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    await assert.rejects(opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY)),
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
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
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
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
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
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    await everythingSaves(opened)
    const zurueck = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', { startMonth: 1, changes: [] }, { understood: true, ...{
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
    await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, ...{ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, token: (await previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))?.token }, ids, TODAY))
    const juli = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, { understood: true, ...{
      overrides: { 't-a': { '2025-01': 120000, '2025-07': null } },
    }, token: (await previewPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, TODAY))?.token }, ids, TODAY))
    assert.ok(juli && 'property' in juli, juli && 'error' in juli ? juli.error : 'kein Objekt')
    const grundsteuer = (await items(opened)).filter((c) => c.category === 'Grundsteuer').map((c) => [c.period, c.amountCents]).sort()
    // Mai und Juni: 61 von 245 Tagen des Teils über 32.219 Cent.
    assert.deepEqual(grundsteuer, [['2025-01', 15781], ['2025-01', 8022], ['2025-07', 24197]])
    await everythingSaves(opened)
  })
})

// Nachprüfung von #226 (Ruling 3): Fällt beim Neuaufteilen ein Teil weg, wandern die gebuchten Zeilen
// einer Belegauswertung auf einen verbleibenden Teil. Sonst stünde die schon gebuchte Rechnung wieder
// offen im Posteingang und ließe sich ein zweites Mal buchen (#184).
test('Ein Wechsel, der die Teile einer Rechnung verringert, behält die gebuchte Belegzeile', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', {
      category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025, invoiceFile: 'gs.pdf',
    }, null, ids))
    const zweiter = teile.find((c) => c.period === '2025-05') ?? assert.fail('kein Teil 2025-05')
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a1', file: 'gs.pdf', propertyId: 'objekt-1', year: 2025, requestedPeriod: periodKey('2025-05'), createdAt: '2026-03-01T00:00:00Z' })
      await db.insert(assessmentLines).values({ assessmentId: 'a1', idx: 0, description: 'Grundsteuer', category: 'Grundsteuer', amountCents: 32219, booking: 'linked', costItemId: zweiter.id })
    })
    const kalender = { startMonth: 1, changes: [] }
    const r = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', kalender, { understood: true,
      groups: {}, token: (await previewPeriodChange(db, 'objekt-1', kalender, TODAY))?.token,
    }, ids, TODAY))
    assert.ok(r && 'property' in r, r && 'error' in r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents]), [['2025-01', 48000]])
    const [zeile] = await opened.read((db) => db.select().from(assessmentLines))
    assert.deepEqual([zeile?.booking, zeile?.costItemId], ['linked', nachher[0]?.id], 'die Zeile bleibt gebucht, am verbleibenden Teil')
    assert.equal(nachher[0]?.invoiceFile, 'gs.pdf')
  })
})

// Laienprobe B2/B3: Zweifamilienhaus, EG vermietet (80 m², 250 € Vorauszahlung), OG selbst bewohnt
// (90 m²). Grundsteuer und Erdgas 2025 ohne Leistungszeitraum. Wechsel ab 07/2025 am 05.10.2026.
async function birkenweg(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'og', { propertyId: 'objekt-1', name: 'OG', areaM2: 90, participates: false, selfUsed: true })
    await createEntity(db, 'tenancies', 't-bsp', { unitId: 'eg', tenantName: 'Familie Beispiel', persons: 3, start: '2020-03-01', prepayments: [{ from: '2020-03', monthlyCents: 25000 }] })
    await createEntity(db, 'costItems', 'gs25', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 42000, key: 'area' })
    await createEntity(db, 'costItems', 'gas25', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Erdgas 2025', amountCents: 260000, key: 'area' })
  })
}
const JULI_AB_2025 = { startMonth: 1, changes: ['2025-07'] }

test('Laienprobe B2: Kalte Jahresrechnungen ohne Leistungszeitraum werden nach Tagen aufgeteilt (Vorgabe), Heizkosten stehen in eigener Gruppe', async () => {
  await withDatabase(async (opened) => {
    await birkenweg(opened)
    const v = await preview(opened, JULI_AB_2025)
    assert.deepEqual(v.groups.map((g) => [g.id, g.heating, g.items.map((i) => i.costItemId), g.suggested]), [
      ['2025-01', false, ['gs25'], 'split'],
      ['2025-01|heizung', true, ['gas25'], '2025-01'],
    ])
    const kalt = v.groups[0] ?? assert.fail('keine Gruppe')
    assert.equal(kalt.split?.range, '01.01.–31.12.2025')
    // 181 von 365 Tagen: 420 € · 181/365 = 208,27 €, der Rest 211,73 €.
    assert.deepEqual(kalt.split?.items, [{ costItemId: 'gs25', parts: [
      { period: '2025-01', label: '01.01.–30.06.2025', amountCents: 20827 },
      { period: '2025-07', label: '2025/2026', amountCents: 21173 },
    ] }])
    assert.equal(v.groups[1]?.split, null, 'Heizkosten nie nach Tagen')
    const ok = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', JULI_AB_2025, { understood: true,
      groups: { '2025-01': 'split', '2025-01|heizung': '2025-01' }, taxYears: {},
      token: (await previewPeriodChange(db, 'objekt-1', JULI_AB_2025, TODAY))?.token,
    }, ids, TODAY))
    assert.ok(ok && 'property' in ok, JSON.stringify(ok))
    const nachher = (await items(opened)).filter((c) => c.category === 'Grundsteuer')
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.serviceFrom, c.serviceTo]).sort(), [
      ['2025-01', 20827, '2025-01-01', '2025-12-31'], ['2025-07', 21173, '2025-01-01', '2025-12-31'],
    ])
  })
})

test('Laienprobe B3: Die Vorschau nennt den Rumpf mit abgelaufener Frist und beziffert, was nicht mehr verlangt werden darf', async () => {
  await withDatabase(async (opened) => {
    await birkenweg(opened)
    const v = await preview(opened, JULI_AB_2025)
    const rumpf = v.effects.find((e) => e.label === '01.01.–30.06.2025') ?? assert.fail(JSON.stringify(v.effects))
    assert.deepEqual([rumpf.deadline, rumpf.passed, rumpf.replaces], ['2026-06-30', true, [{ label: '2025', deadline: '2026-12-31' }]])
    const bsp = rumpf.tenants.find((t) => t.tenantName === 'Familie Beispiel') ?? assert.fail('kein Mieter')
    assert.ok(bsp.beforeCents !== null)
    // Vorher Abrechnung 2025: 12 · 250 € gegen 80/170 von 3.020 €; nachher im Rumpf 6 · 250 € gegen
    // die halbe Grundsteuer und das ganze Erdgas.
    assert.equal(bsp.beforeCents, 300000 - Math.round((42000 + 260000) * 80 / 170))
    assert.equal(bsp.afterCents, 150000 - Math.round((20827 + 260000) * 80 / 170))
    assert.equal(rumpf.lostClaimsCents, Math.max(0, -bsp.afterCents))
    const folge = v.effects.find((e) => e.label === '2025/2026') ?? assert.fail('2025/2026 fehlt')
    assert.deepEqual([folge.deadline, folge.passed, folge.lostClaimsCents], ['2027-06-30', false, 0])
    assert.equal((await items(opened)).length, 2, 'der Probelauf hat nichts gespeichert')
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
  })
})

// Review der Laienprobe, Runde 1: Die Bestätigung einer abgelaufenen Frist verlangt auch der Server,
// und jede 409 bringt die Vorschau mit Fristen und Ergebnissen mit.
test('Review Runde 1: ohne Bestätigung keine Abrechnung mit abgelaufener Frist; die 409 trägt die Fristen', async () => {
  await withDatabase(async (opened) => {
    await birkenweg(opened)
    const ohne = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', JULI_AB_2025, {
      groups: { '2025-01': 'split', '2025-01|heizung': '2025-01' }, token: (await previewPeriodChange(db, 'objekt-1', JULI_AB_2025, TODAY))?.token,
    }, ids, TODAY))
    assert.ok(ohne && 'error' in ohne, 'abgelehnt')
    assert.match(ohne.error, /Weil Sie den Zeitraum selbst umstellen, haben Sie die Verspätung zu vertreten; eine Nachzahlung aus diesem Zeitraum können Sie deshalb nicht mehr verlangen \(§ 556 Abs\. 3 Satz 3 BGB\)/)
    assert.ok(ohne.preview.effects.some((e) => e.passed), 'die Vorschau der 409 nennt die abgelaufene Frist')
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] }, 'nichts geschrieben')
    const veraltet = await opened.write((db) => applyPeriodChange(db, 'objekt-1', JULI_AB_2025, { understood: true, token: 'alt' }, ids, TODAY))
    assert.ok(veraltet && 'error' in veraltet && veraltet.preview.effects.length > 0, 'auch die veraltete Vorschau trägt die Fristen')
  })
})

test('Review Runde 1: verlorene Nachforderung ist nur, was die Nachzahlung über die bisherige hinaus erhöht', () => {
  assert.equal(lostClaims([{ beforeCents: -10000, afterCents: -25000 }, { beforeCents: null, afterCents: -500 }, { beforeCents: 5000, afterCents: 3000 }]), 15000 + 500)
})
