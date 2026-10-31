// Das Jahr der Zahlung beim Wechsel des Abrechnungszeitraums (Review B2, #478): Ein angegebenes Jahr ist eine
// Tatsache über die Zahlung (§ 11 Abs. 2 Satz 1 EStG) und bleibt stehen; nur eine Position ohne Datum und ohne Jahr
// kann ihr Steuerjahr wechseln, und dann nennt die Vorschau es.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { CostItem, PeriodChangePreview, PeriodRules } from '../../shared/types.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity, updateEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'
import { costItems, properties } from '../src/db/schema.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { storedOutflowYear } from '../src/outflow.ts'
import { baseDescription } from '../src/serviceSplit.ts'

const TODAY = '2026-10-05'
const P = 'objekt-1'
let n = 0
const ids = () => `neu-${++n}`

async function withMay(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, P))
      await createEntity(db, 'units', 'eg', { propertyId: P, name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'eg', tenantName: 'B', persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 25000 }] })
    })
    await work(opened)
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
}

const preview = async (opened: OpenedDatabase, rules: PeriodRules): Promise<PeriodChangePreview> =>
  (await opened.read((db) => previewPeriodChange(db, P, rules, TODAY))) ?? assert.fail('keine Vorschau')

// Wechselt mit den Vorgaben der Vorschau (wie jemand, der nur „Speichern“ drückt).
async function changeWithDefaults(opened: OpenedDatabase, rules: PeriodRules): Promise<PeriodChangePreview> {
  const v = await preview(opened, rules)
  const groups = Object.fromEntries(v.groups.map((g) => [g.id, g.suggested || (g.split !== null ? 'split' : g.options[0]?.key ?? '')]))
  const r = await opened.write((db) => applyPeriodChange(db, P, rules, { understood: true, groups, taxYears: {}, token: v.token }, ids, TODAY))
  if (r === null || 'error' in r) return assert.fail(r === null ? 'kein Objekt' : r.error)
  return v
}

const all = async (opened: OpenedDatabase): Promise<CostItem[]> => (await opened.read(readStock)).costItems
// Je Basisbeschreibung die Summe je wirksamem Steuerjahr.
async function byYear(opened: OpenedDatabase): Promise<Record<string, Record<number, number>>> {
  const out: Record<string, Record<number, number>> = {}
  for (const c of await all(opened)) {
    const y = (out[baseDescription(c.description)] ??= {})
    const year = storedOutflowYear(c)
    y[year] = (y[year] ?? 0) + c.amountCents
  }
  return out
}

test('Review B2 (seit #478): Teilen behält das angegebene Jahr der Zahlung, die Vorschau nennt es statt einer Verschiebung', async () => {
  await withMay(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'mu', { propertyId: P, period: '2024-05', category: 'Müllabfuhr', description: 'Müll 2024/2025', amountCents: 36500, key: 'area', taxYear: 2025 }))
    const rules = { startMonth: 5, changes: ['2025-01'] }
    const v = await preview(opened, rules)
    const g = v.groups[0] ?? assert.fail('keine Gruppe')
    // Vorher verschob das Teilen 245 € von 2025 nach 2024; jetzt bleibt jeder Teil in 2025, und Teilen ist die Vorgabe.
    assert.equal(g.suggested, 'split')
    assert.deepEqual(g.split?.notes, [])
    assert.deepEqual(g.taxShifts, [])
    assert.deepEqual(v.taxYears, [])
    assert.deepEqual(v.keptTaxYears.filter((k) => k.period === '2024-05').map((k) => [k.costItemId, k.taxYear, k.label]), [['mu', 2025, '01.05.–31.12.2024']])
    await changeWithDefaults(opened, rules)
    assert.deepEqual((await all(opened)).map((c) => [c.period, c.amountCents, c.taxYear ?? null]).sort(), [['2024-05', 24500, 2025], ['2025-01', 12000, 2025]])
  })
})

test('#478: Gartenpflege bezahlt 2025 und Gutschrift erhalten 2026 behalten ihr Jahr beim Wechsel zum Kalenderjahr, hin und zurück', async () => {
  await withMay(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'garten', { propertyId: P, period: '2025-05', category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 68298, key: 'area', taxYear: 2025 })
      await createEntity(db, 'costItems', 'gut', { propertyId: P, period: '2025-05', category: 'Müllabfuhr', description: 'Gutschrift Müll', amountCents: -9336, key: 'area', taxYear: 2026 })
    })
    const vorher = await byYear(opened)
    assert.deepEqual(vorher, { Gartenpflege: { 2025: 68298 }, 'Gutschrift Müll': { 2026: -9336 } })
    const kalender = { startMonth: 5, changes: ['2026-01'] }
    const v = await changeWithDefaults(opened, kalender)
    assert.deepEqual(v.taxYears, [], 'kein Jahr gefragt: es ist schon angegeben')
    assert.deepEqual(v.keptTaxYears.map((k) => [k.costItemId, k.period, k.taxYear]).sort(), [['garten', '2026-01', 2025], ['gut', '2025-05', 2026]])
    const garten = v.keptTaxYears.find((k) => k.costItemId === 'garten') ?? assert.fail('Gartenpflege fehlt')
    assert.equal(garten.text, '„Gartenpflege“ behält das Jahr der Zahlung 2025; im Zeitraum 2026 steht sie für die Steuer deshalb als verschoben.')
    // Der Teil im Zeitraum 2026 zählt weiter zu 2025, die Gutschrift im Zeitraum 2025 weiter zu 2026.
    assert.deepEqual(await byYear(opened), vorher)
    const teil2026 = (await all(opened)).find((c) => c.period === '2026-01' && c.category === 'Gartenpflege') ?? assert.fail('kein Teil 2026')
    assert.equal(teil2026.taxYear, 2025)
    // Zurück mit den Vorgaben: dieselben Jahre, und gefragt wird wieder nicht.
    const zurueck = await changeWithDefaults(opened, { startMonth: 5, changes: [] })
    assert.deepEqual(zurueck.taxYears, [])
    assert.deepEqual(await byYear(opened), vorher)
    assert.deepEqual((await all(opened)).map((c) => [c.period, c.amountCents, c.taxYear ?? null]).sort(), [['2025-05', -9336, 2026], ['2025-05', 68298, 2025]])
  })
})

test('#478: Ein gehaltenes Jahr außerhalb der üblichen Spanne des Ziels sagt der Satz der Vorschau dazu', async () => {
  await withMay(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'alt', { propertyId: P, period: '2025-05', category: 'Gartenpflege', description: 'Nachzahlung', amountCents: 10000, key: 'area', taxYear: 2030, confirmTaxYear: true }))
    const v = await preview(opened, { startMonth: 5, changes: ['2026-01'] })
    const k = v.keptTaxYears.find((x) => x.period === '2025-05') ?? assert.fail('kein Eintrag')
    assert.match(k.text, /außerhalb der üblichen Spanne von 2024 bis 2028/)
  })
})

test('#478: Eine Position ohne Datum und ohne Jahr nennt die Vorschau auf jedem Weg als verschoben', async () => {
  await withMay(async (opened) => {
    // Ein alter Bestand: im Zeitraum über zwei Kalenderjahre ohne Jahr der Zahlung (vor der Pflicht oder von einem
    // früheren Wechsel geleert). Er zählt zum Jahr des Beginns, 2024.
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'mu', { propertyId: P, period: '2024-05', category: 'Müllabfuhr', description: 'Müll', amountCents: 36500, key: 'area', taxYear: 2024 })
      await createEntity(db, 'costItems', 'gs', { propertyId: P, period: '2024-05', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 36500, key: 'area', taxYear: 2024, serviceFrom: '2024-05-01', serviceTo: '2025-04-30' })
      await db.update(costItems).set({ taxYear: null })
    })
    const v = await preview(opened, { startMonth: 5, changes: ['2025-01'] })
    const g = v.groups[0] ?? assert.fail('keine Gruppe')
    // Gruppe ganz
    assert.deepEqual(g.taxShifts.map((t) => t.key), ['2025-01'])
    assert.match(g.taxShifts[0]?.text ?? '', /„Müll“ 365,00.€ von 2024 nach 2025/)
    // Gruppe geteilt
    assert.match(g.split?.notes.join(' ') ?? '', /Geteilt kämen für die Steuer 120,00.€ aus dem Jahr der Zahlung 2024 nach 2025/)
    // Rechnung mit Leistungszeitraum, neu geteilt
    const gs = v.moves.find((m) => m.costItemId === 'gs') ?? assert.fail('Grundsteuer fehlt')
    assert.match(gs.taxShift ?? '', /120,00.€ aus dem Jahr der Zahlung 2024 nach 2025/)
    assert.deepEqual(v.keptTaxYears, [])
  })
})

// #96 PR 1 (A6): Die Entnahme aus der Erhaltungsrücklage hat nie ein Datum; ihr Jahr hängt über den Wechsel ganz an der
// Regel aus #478, dass ein angegebenes Jahr bleibt. Die Vorschau nennt es mit der Beschriftung des Formulars, und wo sie
// nach dem Jahr fragt, sagt sie es ebenso.
test('#96: die Entnahme behält beim Wechsel das Jahr, in dem die Gemeinschaft bezahlt hat; die Vorschau nennt es so', async () => {
  await withMay(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'dach', { propertyId: P, period: '2025-05', category: 'Entnahme Erhaltungsrücklage', description: 'Dachsanierung', amountCents: 124000, key: 'area', taxYear: 2025 })
      await createEntity(db, 'costItems', 'fassade', { propertyId: P, period: '2024-05', category: 'Entnahme Erhaltungsrücklage', description: 'Fassade', amountCents: 50000, key: 'area', taxYear: 2024 })
    })
    const vorher = await byYear(opened)
    const kalender = { startMonth: 5, changes: ['2026-01'] }
    const v = await preview(opened, kalender)
    const dach = v.keptTaxYears.find((k) => k.costItemId === 'dach' && k.period === '2026-01') ?? assert.fail('Dach fehlt')
    assert.equal(dach.text, '„Dachsanierung“ behält das Jahr, in dem die Gemeinschaft bezahlt hat (2025); im Zeitraum 2026 steht sie für die Steuer deshalb als verschoben.')
    await changeWithDefaults(opened, kalender)
    assert.deepEqual(await byYear(opened), vorher)
  })
})

test('#96: fragt die Vorschau nach dem Jahr einer Entnahme, trägt die Frage deren Beschriftung', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: P, name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'costItems', 'dach', { propertyId: P, period: '2025-01', category: 'Entnahme Erhaltungsrücklage', description: 'Dachsanierung', amountCents: 124000, key: 'area' })
      await createEntity(db, 'costItems', 'gs', { propertyId: P, period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' })
    })
    const v = await preview(opened, { startMonth: 5, changes: [] })
    const asked = (id: string) => v.taxYears.filter((t) => t.costItemId === id)
    assert.ok(asked('dach').length > 0, 'nach dem Jahr der Entnahme gefragt')
    for (const t of asked('dach')) assert.equal(t.reserveWithdrawal, true)
    for (const t of asked('gs')) assert.equal(t.reserveWithdrawal, undefined)
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})

// Durchsicht #96 PR 1, K2: Eine Altposition (Zuführung mit Datum aus der Zeit vor #96) lässt sich teilweise ändern, ohne
// das Datum anzufassen; erst ein neues oder geändertes Datum ergibt die Ablehnung.
test('#96: Zuführung mit altem Datum, Teiländerung ohne Datum geht, ein geändertes Datum nicht', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-review-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: P, name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'costItems', 'rl', { propertyId: P, period: '2025-01', category: 'Zuführung Erhaltungsrücklage', description: 'Rücklage', amountCents: 90000, key: 'area' })
      await db.update(costItems).set({ paidOn: '2025-03-01' }).where(eq(costItems.id, 'rl'))
    })
    await opened.write((db) => updateEntity(db, 'costItems', 'rl', { description: 'Rücklage 2025' }))
    const rl = (await all(opened)).find((c) => c.id === 'rl') ?? assert.fail('Rücklage fehlt')
    assert.deepEqual([rl.description, rl.paidOn], ['Rücklage 2025', '2025-03-01'])
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'rl', { paidOn: '2025-04-01' })), /kein Zahlungsdatum/)
  } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
