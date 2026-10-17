// Hinweise der Steuerübersicht bei einem Zeitraum über zwei Kalenderjahre (Mai bis April, eigene Heizperiode nach
// Weg b und Weg d). Der Eigenanteil am Übertrag aus dem Vorrat (`stockCarrySelfCents`) zählte in zwei Steuerjahren;
// „Eigennutzung im Jahr geändert“ und „abgeschlossene Abrechnung weicht ab“ erschienen im Folgejahr.
// Zwei Einheiten à 100 m², eine vermietet, eine selbstgenutzt; Heizöl nach Fläche mit Vorrat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { heatingPlants, properties } from '../src/db/schema.ts'
import { frozenSettlementOf, snapshotFor } from '../src/snapshot.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules, TaxReport } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const YEARS = [2023, 2024, 2025, 2026, 2027]

// Rhythmen: Kalenderobjekt; Objekt Mai bis April; Kalenderobjekt mit Heizperiode Mai bis April in der Abrechnung
// (Weg b); dieselbe Heizperiode als eigene Heizkostenabrechnung (Weg d).
type Rhythm = 'kalender' | 'mai' | 'wegB' | 'wegD'
// Lieferungen: Zeitraum (1 oder 2), Datum, Liter, Betrag, Jahr der Zahlung.
// `unmarked`: Teil der Heizkosten leer, nur mit der Lieferung verknüpft (so speichert es das Formular, FuelCard.tsx).
// `credit`: eine Gutschrift auf den Brennstoff ohne eigene Lieferung.
type Delivery = { id: string; period: 1 | 2; date: string; liters: number; cents: number; taxYear: number; unmarked?: true; credit?: true }
type Options = { selfTenancy?: boolean; archive?: boolean }

const D1: Delivery = { id: 'd1', period: 1, date: '2024-10-01', liters: 2000, cents: 200000, taxYear: 2024 }
const D2: Delivery = { id: 'd2', period: 2, date: '2025-10-01', liters: 1000, cents: 110000, taxYear: 2025 }
const SCENARIOS: Record<string, Delivery[]> = {
  // A: jede Lieferung im Jahr, in dem ihr Zeitraum beginnt.
  A: [D1, D2],
  // B: die Lieferung des ersten Zeitraums im Februar 2025, bezahlt 2025 (Zeitraum beginnt 2024).
  B: [{ ...D1, date: '2025-02-01', taxYear: 2025 }, D2],
  // C: zwei Lieferungen im ersten Zeitraum, je 1.000 €, bezahlt 2024 und 2025.
  C: [{ ...D1, id: 'd1a', liters: 1000, cents: 100000 }, { ...D1, id: 'd1b', date: '2025-02-01', liters: 1000, cents: 100000, taxYear: 2025 }, D2],
  // D: keine Lieferung im zweiten Zeitraum; er verbraucht nur aus dem Vorrat.
  D: [D1],
  // E: wie B, die Positionen ohne Kennzeichen „Brennstoff“, nur mit der Lieferung verknüpft.
  E: [{ ...D1, date: '2025-02-01', taxYear: 2025, unmarked: true }, { ...D2, unmarked: true }],
  // F: wie A, dazu eine Gutschrift von 550 € auf den Brennstoff des zweiten Zeitraums, gezahlt 2026. Sie zieht keinen
  // Übertrag in das Jahr 2026 (Gewicht je Jahr nicht unter 0).
  F: [D1, D2, { id: 'g2', period: 2, date: '2026-02-01', liters: 0, cents: -55000, taxYear: 2026, credit: true }],
}

async function measure(rhythm: Rhythm, deliveries: Delivery[], options: Options = {}): Promise<Record<number, TaxReport>> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-stockcarry-'))
  const opened: OpenedDatabase = await openFreshDatabase(dataDir)
  const start = rhythm === 'kalender' ? '01' : '05'
  const k = (n: 1 | 2) => `${2023 + n}-${start}`
  try {
    await opened.write(async (db) => {
      if (rhythm === 'mai') await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'a', areaM2: 100, participates: true })
      await createEntity(db, 'units', 's', { propertyId: 'objekt-1', name: 's', areaM2: 100, participates: false, selfUsed: true, selfPersons: 1 })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'a', persons: 1, start: '2020-01-01' })
      // Die selbstgenutzte Einheit war Juni bis September 2024 vermietet (Hinweis „Nutzung im Jahr geändert“).
      if (options.selfTenancy) await createEntity(db, 'tenancies', 'ts', { unitId: 's', tenantName: 's', persons: 1, start: '2024-06-01', end: '2024-09-30' })
      await createHeatingPlant(db, 'oel', 'objekt-1', { energy: 'oil', method: 'manual' })
      if (rhythm === 'wegB' || rhythm === 'wegD') await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'oel'))
      // Zeitraum 1: Anfang 1.000 l / 1.000 €, Ende 1.500 l; Zeitraum 2: Ende 500 l. Preis der jüngsten Lieferung bewertet.
      await saveStock(db, 'oel', k(1), { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 1500 })
      for (const d of deliveries) {
        if (!d.credit) await createDelivery(db, d.id, 'oel', { label: d.id, deliveredAt: d.date, invoiceDate: d.date, quantity: d.liters, quantityUnit: 'l', emissionsKg: d.liters * 2.676, co2CostCents: 0 })
        await createEntity(db, 'costItems', `c-${d.id}`, {
          propertyId: 'objekt-1', period: k(d.period), category: HEATING_CATEGORY, description: d.id, amountCents: d.cents, key: 'area', heatingPlantId: 'oel',
          heatingPart: d.unmarked ? null : 'fuel', fuelDeliveryId: d.credit ? null : d.id, taxYear: d.taxYear,
        })
      }
      await saveStock(db, 'oel', k(2), { stockUnit: 'l', closingQuantity: 500 })
    })
    const source = await opened.read((db) => readStock(db))
    if (rhythm === 'wegD') {
      for (const p of source.heatingPlants) Object.assign(p, { separateSettlement: true, separateSpans: [{ from: '2024-05', until: null }] })
    }
    if (options.archive) {
      // Der erste Zeitraum abgeschlossen als Archivstück von vor #142: ohne Zerlegung des Vermieteranteils. Künstlich:
      // Ein echtes Archiv dieser Zeit hat keinen Vorrat; der Eigenanteil am Übertrag geht hier in die Summe ein.
      const rules = rhythm === 'mai' ? MAI : CALENDAR_RULES
      const p = periodOfKey(rules, periodKey(k(1))) ?? assert.fail(`kein Zeitraum ${k(1)}`)
      const frozen = computeSettlement(snapshotFor(source, 'objekt-1', p), {})
      const archiv: unknown = JSON.parse(JSON.stringify(frozen, (key, value: unknown) => (key === 'landlordParts' ? undefined : value)))
      source.closedSettlements.push({ ...frozenSettlementOf(archiv), id: 'abschluss', propertyId: 'objekt-1', period: p.key, closedAt: '2025-06-30', sentAt: null, settlement: archiv })
    }
    const years: Record<number, TaxReport> = {}
    for (const y of YEARS) years[y] = taxReportFor(source, 'objekt-1', y)
    return years
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const each = <T>(r: Record<number, TaxReport>, f: (t: TaxReport) => T): T[] => YEARS.map((y) => f(r[y] ?? assert.fail(`kein Jahr ${y}`)))
const carry = (r: Record<number, TaxReport>): number[] => each(r, (t) => t.expenses.stockCarrySelfCents ?? 0)
// Was sich nicht ändern darf: brutto, privat, abziehbar, die Vorauszahlungen der Abrechnung und die Teile.
const fixed = (r: Record<number, TaxReport>): string[] => each(r, (t) =>
  `${t.expenses.totalCents}/${t.expenses.privateCents}/${t.expenses.deductibleCents}/${t.income.prepaymentSettlementCents}/${t.settlementPeriods.map((p) => p.label).join('+')}`)

// Übertrag je Zeitraum (Eigenanteil 50 %): Z1 1.000 € + Lieferungen − 1.500 € → −250 €; Z2 1.500 € + 1.100 € − 550 € →
// +475 €, ohne Lieferung 1.500 € − 500 € → +500 €. Jahre 2023 bis 2027.
// Der Übertrag gehört in das Jahr, in dem die Brennstoffrechnungen seines Zeitraums bezahlt sind, bei mehreren Jahren
// anteilig nach ihren Beträgen (C: −125 € und −125 €). Ohne Brennstoffrechnung (D) das Jahr, in dem der Zeitraum
// beginnt, bei dem die Abrechnung den Übertrag führt: bei Weg b die Abrechnung des Kalenderjahres 2026, in der die
// Heizperiode 2025/2026 steht, sonst 2025.
const EXPECTED: Record<Rhythm, Partial<Record<keyof typeof SCENARIOS, number[]>>> = {
  kalender: { A: [0, -25000, 47500, 0, 0] },
  mai: { A: [0, -25000, 47500, 0, 0], B: [0, 0, 22500, 0, 0], C: [0, -12500, 35000, 0, 0], D: [0, -25000, 50000, 0, 0], E: [0, 0, 22500, 0, 0], F: [0, -25000, 47500, 0, 0] },
  wegB: { A: [0, -25000, 47500, 0, 0], B: [0, 0, 22500, 0, 0], C: [0, -12500, 35000, 0, 0], D: [0, -25000, 0, 50000, 0] },
  wegD: { A: [0, -25000, 47500, 0, 0], B: [0, 0, 22500, 0, 0], C: [0, -12500, 35000, 0, 0], D: [0, -25000, 50000, 0, 0], E: [0, 0, 22500, 0, 0], F: [0, -25000, 47500, 0, 0] },
}

for (const [rhythm, scenarios] of Object.entries(EXPECTED) as [Rhythm, Record<string, number[]>][]) {
  for (const [scenario, expected] of Object.entries(scenarios)) {
    test(`Vorratsübertrag im Hinweis der Steuerübersicht, ${rhythm}, Fall ${scenario}: im Jahr der Zahlung, genau einmal; die Steuerzahlen bleiben`, async () => {
      const r = await measure(rhythm, SCENARIOS[scenario] ?? assert.fail(`kein Fall ${scenario}`))
      assert.deepEqual(fixed(r), FIXED[rhythm]?.[scenario] ?? assert.fail(`keine Messung ${rhythm}/${scenario}`))
      assert.deepEqual(carry(r), expected, `Übertrag je Steuerjahr, ${rhythm}, Fall ${scenario}`)
    })
  }
}

test('Hinweis „Eigennutzung im Jahr geändert“: nur, wenn das Mietverhältnis der selbstgenutzten Einheit im Steuerjahr liegt, auch bei Mai–April', async () => {
  const kal = await measure('kalender', SCENARIOS.A ?? [], { selfTenancy: true })
  const mai = await measure('mai', SCENARIOS.A ?? [], { selfTenancy: true })
  // Juni bis September 2024: nur das Steuerjahr 2024. Bei Mai–April berührt der Zeitraum 2024/2025 auch 2025.
  assert.deepEqual(each(kal, (t) => t.selfUseChangedInYear), [false, true, false, false, false])
  assert.deepEqual(each(mai, (t) => t.selfUseChangedInYear), [false, true, false, false, false], 'Mai–April')
  assert.deepEqual(fixed(kal), FIXED_SELF_TENANCY.kalender)
  assert.deepEqual(fixed(mai), FIXED_SELF_TENANCY.mai)
})

test('Hinweis „abgeschlossene Abrechnung weicht ab“ (Archivstück von vor #142): nicht für einen Zeitraum ohne Positionen im Steuerjahr', async () => {
  const kal = await measure('kalender', SCENARIOS.A ?? [], { archive: true })
  const mai = await measure('mai', SCENARIOS.A ?? [], { archive: true })
  // Das Archivstück von 2024 weicht heute ab; der Hinweis gehört nur ins Jahr 2024.
  assert.deepEqual(each(kal, (t) => t.closedSelfUseDiffers), [false, true, false, false, false])
  assert.deepEqual(each(mai, (t) => t.closedSelfUseDiffers), [false, true, false, false, false], 'Mai–April')
  assert.deepEqual(fixed(kal), FIXED_ARCHIVE.kalender)
  assert.deepEqual(fixed(mai), FIXED_ARCHIVE.mai)
})
// Gemessen vor der Behebung des Übertrags (Stand 690fa87, gleich origin/main bis auf die Hinweise): brutto/privat/
// abziehbar/Vorauszahlungen der Abrechnung/Teile je Jahr 2023 bis 2027.
const FIXED: Record<Rhythm, Partial<Record<string, string[]>>> = {
  kalender: {
    A: ['0/0/0/0/2023', '200000/100000/100000/0/2024', '110000/55000/55000/0/2025', '0/0/0/0/2026', '0/0/0/0/2027'],
  },
  mai: {
    A: ['0/0/0/null/2022/2023+2023/2024', '200000/100000/100000/null/2023/2024+2024/2025', '110000/55000/55000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
    B: ['0/0/0/null/2022/2023+2023/2024', '0/0/0/null/2023/2024+2024/2025', '310000/155000/155000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
    C: ['0/0/0/null/2022/2023+2023/2024', '100000/50000/50000/null/2023/2024+2024/2025', '210000/105000/105000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
    D: ['0/0/0/null/2022/2023+2023/2024', '200000/100000/100000/null/2023/2024+2024/2025', '0/0/0/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
    E: ['0/0/0/null/2022/2023+2023/2024', '0/0/0/null/2023/2024+2024/2025', '310000/155000/155000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
    F: ['0/0/0/null/2022/2023+2023/2024', '200000/100000/100000/null/2023/2024+2024/2025', '110000/55000/55000/null/2024/2025+2025/2026', '-55000/-27500/-27500/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
  },
  wegB: {
    A: ['0/0/0/0/2023', '200000/100000/100000/0/2024+2025', '110000/55000/55000/0/2025+2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    B: ['0/0/0/0/2023', '0/0/0/0/2024', '310000/155000/155000/0/2025+2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    C: ['0/0/0/0/2023', '100000/50000/50000/0/2024+2025', '210000/105000/105000/0/2025+2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    D: ['0/0/0/0/2023', '200000/100000/100000/0/2024+2025', '0/0/0/0/2025', '0/0/0/0/2026', '0/0/0/0/2027'],
  },
  wegD: {
    A: ['0/0/0/0/2023', '200000/100000/100000/null/2024+Heizkosten 2024/2025', '110000/55000/55000/null/2025+Heizkosten 2025/2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    B: ['0/0/0/0/2023', '0/0/0/0/2024', '310000/155000/155000/null/2025+Heizkosten 2024/2025+Heizkosten 2025/2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    C: ['0/0/0/0/2023', '100000/50000/50000/null/2024+Heizkosten 2024/2025', '210000/105000/105000/null/2025+Heizkosten 2024/2025+Heizkosten 2025/2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    D: ['0/0/0/0/2023', '200000/100000/100000/null/2024+Heizkosten 2024/2025', '0/0/0/0/2025', '0/0/0/0/2026', '0/0/0/0/2027'],
    E: ['0/0/0/0/2023', '0/0/0/0/2024', '310000/155000/155000/null/2025+Heizkosten 2024/2025+Heizkosten 2025/2026', '0/0/0/0/2026', '0/0/0/0/2027'],
    F: ['0/0/0/0/2023', '200000/100000/100000/null/2024+Heizkosten 2024/2025', '110000/55000/55000/null/2025+Heizkosten 2025/2026', '-55000/-27500/-27500/null/2026+Heizkosten 2025/2026', '0/0/0/0/2027'],
  },
}
const FIXED_SELF_TENANCY = {
  kalender: ['0/0/0/0/2023', '200000/100000/100000/0/2024', '110000/55000/55000/0/2025', '0/0/0/0/2026', '0/0/0/0/2027'],
  mai: ['0/0/0/null/2022/2023+2023/2024', '200000/100000/100000/null/2023/2024+2024/2025', '110000/55000/55000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
}
const FIXED_ARCHIVE = {
  kalender: ['0/0/0/0/2023', '200000/75000/125000/0/2024', '110000/55000/55000/0/2025', '0/0/0/0/2026', '0/0/0/0/2027'],
  mai: ['0/0/0/null/2022/2023+2023/2024', '200000/75000/125000/null/2023/2024+2024/2025', '110000/55000/55000/null/2024/2025+2025/2026', '0/0/0/null/2025/2026+2026/2027', '0/0/0/null/2026/2027+2027/2028'],
}
