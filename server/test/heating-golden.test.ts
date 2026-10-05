// Golden F15 und F12 (Heizung PR 6, Entwurf 12.1). Herleitung von Hand in
// fixtures/heating/<Fixture>/README.md; jede Zahl hier steht dort. Der Bestand entsteht über denselben
// Weg wie beim Nutzer: Wohnungen, Mietverhältnisse, Heizanlage, Position und CO₂-Angaben.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { saveCo2Statement } from '../src/db/co2.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'heating')
const euro = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
type Opened = Awaited<ReturnType<typeof openDatabase>>

async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heating-golden-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Vier Wohnungen à 50 m² mit je einem Mieter seit 2020 und eine Gasheizung beim Messdienst.
async function vierWohnungen(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [i, u] of ['a', 'b', 'c', 'd'].entries()) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: `W${i + 1}`, areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${i + 1}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
  })
}

test('F15 Techem-Muster mit Vorwegabzug: Probe exakt, co2Share 87,50 €, Werbungskosten 3.933,01 €', async () => {
  await withDatabase(async (opened) => {
    await vierWohnungen(opened)
    const betraege = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: 393301, key: 'amounts', tenancyAmounts: betraege,
      })
      await saveCo2Statement(db, 'hp', '2025-01', {
        method: 'serviceDeducted', serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4,
        serviceTotalCents: 25000, serviceLandlordPermille: 350, serviceKgPerM2: 46.4,
      })
    })
    const stock = await opened.read(readStock)
    const p = periodOfKey({ startMonth: 1, changes: [] }, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
    const snapshot = snapshotFor(stock, 'objekt-1', p)
    const s = computeSettlement(snapshot)
    assert.deepEqual(s.statements.map((st) => [st.tenancyId, st.rows.find((r) => r.costItemId === 'hz')?.shareCents]).sort(), Object.entries(betraege).sort())
    assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'hz')?.landlordParts, [{ reason: 'co2Share', cents: 8750 }])
    assert.ok(!s.notices.some((n) => n.code === 'co2.sum-check'), 'die Probe geht auf')
    assert.match(s.notices.find((n) => n.code === 'co2.stage-mismatch')?.text ?? '', /§ 9 CO2KostAufG/)
    const tax = taxReport(snapshot).expenses.items.find((x) => x.costItemId === 'hz') ?? assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.deepEqual([tax.amountCents, tax.privateCents, tax.deductibleCents], [393301, 0, 393301])
    assert.equal(s.heating?.[0]?.co2?.booked, true)
  })
})

test('F12 Mai–April, Messdienst ohne CO₂-Aufteilung: Frist 30.04.2027, co2.service-unsplit mit 3 % je Mieter', async () => {
  const datei = path.join(FIXTURES, 'F12-messdienst-mai-april', 'betraege.json')
  if (!fs.existsSync(datei)) return assert.fail(`${datei} fehlt: die vier Einzelbeträge (Entwurf 12.1) sind noch nicht eingetragen`)
  const daten: unknown = JSON.parse(fs.readFileSync(datei, 'utf8'))
  const liste = (key: string): number[] => {
    const v: unknown = typeof daten === 'object' && daten !== null ? Reflect.get(daten, key) : undefined
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isInteger(x) && x > 0)) return assert.fail(`${key} in betraege.json: vier ganze Cent-Beträge erwartet`)
    return v.map(Number)
  }
  const einzel = liste('einzelbetraege')
  const kuerzung = liste('kuerzungen')
  assert.equal(einzel.reduce((a, c) => a + c, 0), 427651, 'die vier Einzelbeträge ergeben 4.276,51 €')
  // Der eine Nutzer laut Beleg: Heizung 290,12 € + Warmwasser 20,47 €.
  assert.equal(einzel[0], 29012 + 2047, 'Nutzer 1 ist der echte Nutzer des Belegs')
  const summe = kuerzung.reduce((a, c) => a + c, 0)
  assert.ok(summe >= 12828 && summe <= 12831, `Summe der Kürzungen ${summe} liegt nicht zwischen 128,28 und 128,31 €`)
  await withDatabase(async (opened) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    await vierWohnungen(opened)
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'hz', {
        propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: 427651, key: 'amounts', taxYear: 2026,
        tenancyAmounts: { ta: einzel[0], tb: einzel[1], tc: einzel[2], td: einzel[3] },
      })
      await saveCo2Statement(db, 'hp', '2025-05', { method: 'selfAfterService' })
    })
    const regeln: PeriodRules = { startMonth: 5, changes: [] }
    const p = periodOfKey(regeln, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025/2026')
    const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
    assert.deepEqual([s.period.label, s.deadline], ['2025/2026', '2027-04-30'])
    const text = s.notices.find((n) => n.code === 'co2.service-unsplit')?.text ?? assert.fail('kein Hinweis co2.service-unsplit')
    kuerzung.forEach((c, i) => assert.ok(text.includes(`Mieter ${i + 1} (W${i + 1}) ${euro(c)}`), `Kürzung Mieter ${i + 1}: ${text}`))
    assert.ok(!s.notices.some((n) => n.code === 'heating.dhw-not-metered' || n.code === 'heating.not-by-consumption'), 'keine 15 %')
  })
})

// Die vier Einzelbeträge von F12 (aus dem Beleg); F13 baut darauf auf.
function einzelbetraegeF12(): number[] {
  const datei = path.join(FIXTURES, 'F12-messdienst-mai-april', 'betraege.json')
  if (!fs.existsSync(datei)) return assert.fail(`${datei} fehlt: die vier Einzelbeträge aus dem Beleg (Entwurf 12.1) sind noch nicht eingetragen`)
  const daten: unknown = JSON.parse(fs.readFileSync(datei, 'utf8'))
  const v = typeof daten === 'object' && daten !== null ? Reflect.get(daten, 'einzelbetraege') : undefined
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isInteger(x) && x > 0)) return assert.fail('einzelbetraege in betraege.json: vier ganze Cent-Beträge erwartet')
  return v
}

test('F13 Mai–April mit eigener Aufteilung: E umgerechnet, C ganz (G-A3), 26,94 → 30 % gegen 26,95 → 40 %', async () => {
  const einzel = einzelbetraegeF12()
  const S = einzel.reduce((a, c) => a + c, 0)
  const betragVon: Record<string, number | undefined> = { ta: einzel[0], tb: einzel[1], tc: einzel[2], td: einzel[3] }
  const varianten = [
    { kg: 5404.16, wert: 26.9, permille: 300, L: 18000 },
    { kg: 5406.17, wert: 27, permille: 400, L: 24000 },
  ]
  for (const v of varianten) {
    await withDatabase(async (opened) => {
      await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
      await vierWohnungen(opened)
      await opened.write(async (db) => {
        await createEntity(db, 'costItems', 'hz', {
          propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Heizung und Warmwasser laut Messdienst', amountCents: S, key: 'amounts', taxYear: 2026,
          tenancyAmounts: betragVon,
        })
        await saveCo2Statement(db, 'hp', '2025-05', { method: 'selfAfterService', areaM2: 200.6 })
        await createDelivery(db, 'gas', 'hp', {
          label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 311747, energyKwh: 29886, emissionsKg: v.kg, co2CostCents: 60000,
        })
      })
      const p = periodOfKey({ startMonth: 5, changes: [] }, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025/2026')
      const s = computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', p))
      const fall = `${v.kg} kg`
      const h = s.heating?.[0] ?? assert.fail(`${fall}: keine Bewertung`)
      const co2 = h.co2 ?? assert.fail(`${fall}: keine CO₂-Bewertung`)
      assert.deepEqual([co2.method, co2.totalCents, co2.kgPerM2, co2.landlordPermille, co2.landlordCents, co2.areaM2, co2.areaSource], ['selfAfterService', 60000, v.wert, v.permille, v.L, 200.6, 'entered'], fall)
      assert.ok(Math.abs((co2.emissionsKg ?? 0) - v.kg) < 1e-6, `${fall}: E umgerechnet = E der Rechnung`)
      assert.equal(h.fuel?.coveragePermille.toFixed(2), '848.71', fall)
      // Abzug je Mieter: weniger als ein Cent neben L · Einzelbetrag / S, zusammen genau L.
      const abzuege = s.statements.map((st) => st.rows.filter((r) => r.kind === 'co2Relief').reduce((a, r) => a + r.shareCents, 0))
      assert.equal(abzuege.reduce((a, c) => a + c, 0), -v.L, fall)
      s.statements.forEach((st, i) => {
        const e = betragVon[st.tenancyId] ?? assert.fail(`unbekanntes Mietverhältnis ${st.tenancyId}`)
        assert.ok(Math.abs(-(abzuege[i] ?? 0) - (v.L * e) / S) < 1, `${fall}, ${st.tenancyId}: ${abzuege[i]}`)
      })
      assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'co2:hp:2025-05')?.landlordParts, [{ reason: 'co2Share', cents: v.L }], fall)
      const codes = s.notices.map((n) => n.code)
      assert.ok(!codes.includes('co2.service-unsplit'), fall)
      assert.ok(codes.includes('co2.service-unsplit-healed') && codes.includes('co2.share-approximated'), fall)
      assert.match(s.notices.find((n) => n.code === 'fuel.uncovered')?.text ?? '', /15\.03\.–30\.04\.2026 \(47 Tage, 151,3 ‰ der Gradtage\)/, fall)
      assert.ok(s.legalBasis.values?.some((x) => x.id === 'hkv.degree-days'), `${fall}: Gradtagstabelle im Rechtsstand`)
    })
  }
})
