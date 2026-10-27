// Betriebsstrom und Wechsel des Abrechnungszeitraums (Nachprüfung der Durchsicht von #252, G2-N-W1): Die
// Stromrechnung und ihre Abzüge wandern als Einheit. Bei jeder der drei Antworten (im Rumpf lassen, ganz in
// den neuen Zeitraum, nach Tagen aufteilen) gelingt der Wechsel; beim Aufteilen wird der Abzug mit
// denselben Tagesanteilen geteilt, und jeder Teil zeigt auf den Teil der Rechnung im selben Zeitraum.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { readCostItems, readStock } from '../src/db/read.ts'
import { createEntity, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { eq } from 'drizzle-orm'
import { properties } from '../src/db/schema.ts'
import type { CostItem } from '../../shared/types.ts'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey, rulesOf } from '../../shared/period.ts'

const TODAY = '2026-10-05'
const MAI_AB_2025 = { startMonth: 1, changes: ['2025-05'] }
let n = 0
const ids = () => `w-${++n}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-wechsel-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Haus mit zwei Wohnungen, Hausstrom 1.000 € und Müll 300 € in 2025, Schätzhilfe 100 € gebucht.
async function bestand(opened: OpenedDatabase, method: 'service' | 'manual'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'B', areaM2: 20, participates: true })
    await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
    await createEntity(db, 'tenancies', 't-b', { unitId: 'u2', tenantName: 'B', persons: 1, start: '2024-01-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method })
    if (method === 'manual') await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas 2025', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
    await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 100000, key: 'area' })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
  })
  await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil der Brennstoffkosten' }, ids))
}

const items = (opened: OpenedDatabase): Promise<CostItem[]> => opened.read((db) => readCostItems(db))
const sum = (list: readonly CostItem[]) => list.reduce((a, c) => a + c.amountCents, 0)

async function wechsel(opened: OpenedDatabase, kalt: string, heizung?: string) {
  const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
  const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.id.endsWith('|heizung') ? (heizung ?? g.from) : kalt]))
  return opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, groups, token: preview.token }, ids, TODAY))
}

for (const method of ['service', 'manual'] as const) {
  for (const kalt of ['2025-01', '2025-05', 'split']) {
    test(`G2-N-W1: Zeitraumwechsel mit Betriebsstrom-Abzug gelingt (${method === 'service' ? 'Messdienst' : 'eigene Abrechnung'}, Antwort ${kalt}); Abzug zeigt auf die Rechnung seines Zeitraums, kein Cent wandert`, async () => {
      await withDatabase(async (opened) => {
        await bestand(opened, method)
        const vorher = await items(opened)
        const allgemeinVorher = sum(vorher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom'))
        const r = await wechsel(opened, kalt)
        if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
        const nachher = await items(opened)
        // Geldinvariante: Gesamtsumme und Allgemeinstrom netto wie vorher.
        assert.equal(sum(nachher), sum(vorher))
        assert.equal(sum(nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom')), allgemeinVorher)
        const abzuege = nachher.filter((c) => c.operatingPower === 'deduction')
        assert.equal(sum(abzuege), -10000)
        for (const d of abzuege) {
          const g = nachher.find((c) => c.id === d.operatingPowerGeneralId) ?? assert.fail(`${d.id}: keine Rechnung`)
          assert.equal(g.period, d.period, `${d.id}: Rechnung in anderem Zeitraum`)
          const ausDieser = -sum(abzuege.filter((x) => x.operatingPowerGeneralId === g.id))
          assert.ok(ausDieser <= g.amountCents, `${g.id}: mehr Abzug als Rechnung`)
        }
        if (kalt === 'split') {
          // G4-W1: Der Abzug wird im selben Verhältnis geteilt wie seine Rechnung (120 von 365 Tagen im Rumpf), auch
          // mit eigener Abrechnung: Der Betriebsstrom steckt in jedem Teil der Rechnung nach Tagen.
          assert.deepEqual(abzuege.map((d) => [d.period, d.amountCents]).sort(), [['2025-01', -3288], ['2025-05', -6712]])
        } else {
          assert.deepEqual(abzuege.map((d) => d.period), [kalt])
        }
      })
    })
  }
}

// Früher blieb ein großer Abzug einer Rechnung mit Leistungszeitraum im Rumpf und überstieg dort den Teil der
// Rechnung (409). Seit G4-K1 teilt er sich wie die Rechnung, und die Summe je Teil bleibt unter der Rechnung.
test('G4-K1: großer Abzug einer Rechnung mit Leistungszeitraum teilt sich wie sie; kein Teil übersteigt seine Rechnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 100000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    })
    await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 90000, basis: 'geschätzt' }, ids))
    const r = await wechsel(opened, '2025-01')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    const abzuege = nachher.filter((c) => c.operatingPower === 'deduction')
    assert.equal(sum(abzuege), -90000)
    assert.equal(abzuege.length, 2)
    for (const d of abzuege) {
      const g = nachher.find((c) => c.id === d.operatingPowerGeneralId) ?? assert.fail('keine Rechnung')
      assert.equal(g.period, d.period)
      assert.ok(-d.amountCents <= g.amountCents)
    }
  })
})

// Auch eine Prüfung, die erst beim Schreiben scheitert (hier: ein Teil der Rechnung fällt weg, an dem ein Abzug
// hängt), ist ein Konflikt mit dem Bestand: 409 mit Vorschau, keine nackte 400.
test('G2-N-W1: ein Wechsel, der den Teil einer Rechnung mit Abzug entfernt, antwortet mit Vorschau und Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', {
      category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 100000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025,
    }, null, ids))
    for (const [i, t] of teile.entries()) {
      await opened.write((db) => createEntity(db, 'costItems', `ab${i}`, { propertyId: 'objekt-1', period: t.period, category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${i}`, amountCents: -1000, key: 'area', operatingPower: 'deduction', operatingPowerGeneralId: t.id, ...(t.taxYear !== undefined ? { taxYear: t.taxYear } : {}) }))
    }
    const vorher = await items(opened)
    const kalender = { startMonth: 1, changes: [] }
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', kalender, TODAY))) ?? assert.fail('kein Objekt')
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.options[0]?.key ?? '']))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', kalender, { understood: true, groups, token: preview.token }, ids, TODAY))
    if (!r || !('error' in r)) return assert.fail('angenommen')
    assert.match(r.error, /Abzug/)
    assert.match(r.error, /Gespeichert wurde nichts/)
    assert.ok('preview' in r && r.preview, 'Vorschau fehlt')
    assert.deepEqual(await items(opened), vorher)
  })
})

// G4-W1 (Nachprüfung Runde 3, G3-H zurückgenommen): Der Betriebsstrom steckt in jedem Teil der Stromrechnung nach
// Tagen. Wer die Heizung eines Zeitraums trägt, trägt dort den Betriebsstrom; der Allgemeinstrom jedes Zeitraums
// wird um den Betriebsstrom bereinigt, der in IHM steckt. Geprüft je Mieter, nicht je Zeitraum: B1 wohnt im Rumpf
// (01–04/2025), B2 ab 01.05.2025. Von Hand hergeleitet (Fläche A 80 / B 20, Hausstrom nach Einheiten, Rumpf
// 120 von 365 Tagen):
// - Hausstrom 1.000 € → 328,77 € im Rumpf (je Wohnung 164,385 €), 671,23 € in 2025/26 (je 335,615 €).
// - Abzug 100 € → 32,88 € im Rumpf (je −16,44 €), 67,12 € in 2025/26 (je −33,56 €).
// - Heizung 5.100 € (Gas und Betriebsstrom) im Zeitraum der Heizgruppe, B 20 % = 1.020,00 €.
// Heizung im Rumpf: B1 = 1.020,00 + 164,385 − 16,44 = 1.167,94 €; B2 = 335,615 − 33,56 = 302,05 €.
// Heizung in 2025/26: B1 = 164,385 − 16,44 = 147,94 €; B2 = 1.020,00 + 335,615 − 33,56 = 1.322,05 €.
async function hausMitWechsel(opened: OpenedDatabase, strom: Record<string, unknown> = {}): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 20, participates: true })
    await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    await createEntity(db, 'tenancies', 'tb1', { unitId: 'b', tenantName: 'Mieter B1', persons: 1, start: '2020-01-01', end: '2025-04-30' })
    await createEntity(db, 'tenancies', 'tb2', { unitId: 'b', tenantName: 'Mieter B2', persons: 1, start: '2025-05-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
    await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units', ...strom })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area' })
  })
  await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil' }, ids))
}

// Heizung und Allgemeinstrom je Mieter über alle Abrechnungen nach dem Wechsel (Rumpf und 2025/26).
async function jeMieter(opened: OpenedDatabase): Promise<Record<string, number>> {
  const stock = await opened.read((db) => readStock(db))
  const rules = rulesOf(stock.properties.find((p) => p.id === 'objekt-1'))
  const out: Record<string, number> = {}
  for (const key of ['2025-01', '2025-05']) {
    const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
    for (const st of computeSettlement(snapshotFor(stock, 'objekt-1', p)).statements) {
      for (const r of st.rows) {
        if (r.category === 'Heizung und Warmwasser' || r.category === 'Beleuchtung/Allgemeinstrom') out[st.tenantName] = (out[st.tenantName] ?? 0) + r.shareCents
      }
    }
  }
  return out
}

for (const [heizung, b1, b2] of [['2025-01', 116794, 30205], ['2025-05', 14794, 132205]] as const) {
  test(`G4-W1: aufteilen mit eigener Abrechnung, Heizung ${heizung}: je Mieter Heizung + Allgemeinstrom wie von Hand hergeleitet`, async () => {
    await withDatabase(async (opened) => {
      await hausMitWechsel(opened)
      const r = await wechsel(opened, 'split', heizung)
      if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
      const m = await jeMieter(opened)
      assert.equal(m['Mieter B1'], b1, 'Mieter B1')
      assert.equal(m['Mieter B2'], b2, 'Mieter B2')
    })
  })
}

// G4-K1: Teilt sich der Hausstrom über seinen Leistungszeitraum von selbst, teilt sich sein Abzug im selben
// Verhältnis, gleich wie die Gruppe beantwortet wird (hier: kalt im Rumpf, Heizung in 2025/26).
test('G4-K1: Hausstrom mit Leistungszeitraum: Abzug im selben Verhältnis, je Mieter wie hergeleitet', async () => {
  await withDatabase(async (opened) => {
    await hausMitWechsel(opened, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    const r = await wechsel(opened, '2025-01', '2025-05')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const abzuege = (await items(opened)).filter((c) => c.operatingPower === 'deduction')
    assert.deepEqual(abzuege.map((d) => [d.period, d.amountCents]).sort(), [['2025-01', -3288], ['2025-05', -6712]])
    const m = await jeMieter(opened)
    assert.equal(m['Mieter B1'], 14794, 'Mieter B1')
    assert.equal(m['Mieter B2'], 132205, 'Mieter B2')
  })
})

// Durchsicht von #454, Befund 4: Ist der Hausstrom nach Einzelbeträgen verteilt, steht er beim Wechsel in einer eigenen
// Gruppe ohne Aufteilen. Sein Abzug gehört in dieselbe Gruppe; sonst würde er nach Tagen geteilt, die Rechnung aber ganz
// verschoben, und ein Abzug stünde ohne seine Rechnung im Zeitraum.
test('#454: Abzug beim Betriebsstrom geht mit Hausstrom nach Einzelbeträgen in dessen Gruppe und denselben Zeitraum', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, 'service')
    await opened.write((db) => updateEntity(db, 'costItems', 'hs', { key: 'amounts', tenancyAmounts: { 't-a': 80000, 't-b': 20000 } }))
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
    const gruppe = preview.groups.find((g) => g.individualAmounts) ?? assert.fail('keine Gruppe für Einzelbeträge')
    const abzug = (await items(opened)).find((c) => c.operatingPower === 'deduction') ?? assert.fail('kein Abzug')
    assert.deepEqual(gruppe.items.map((i) => i.costItemId).sort(), ['hs', abzug.id].sort())
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.individualAmounts ? '2025-05' : 'split']))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, groups, token: preview.token }, ids, TODAY))
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.deepEqual(nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom').map((c) => [c.operatingPower ?? 'rechnung', c.period, c.amountCents]).sort(),
      [['deduction', '2025-05', -10000], ['rechnung', '2025-05', 100000]])
  })
})
