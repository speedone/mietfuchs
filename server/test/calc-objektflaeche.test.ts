// Gesamtfläche des Objekts (gewerbliche Abrechnung, Pilot): Referenzfall „Gaglower Str.“ aus der Tabelle des Vermieters.
// Objekt 3.334,81 m², ein Mieter mit 1.064,67 m², der Rest ohne Mietverhältnis. Die Kosten gehen nach Fläche; die
// erwarteten Anteile sind die Werte der Tabelle (Rechnung × 1.064,67 / 3.334,81, auf den Cent), die Beträge pro m² die
// Spalte „Betrag pro Einheit“ des Formulars.
//
// Gebaut wird unmittelbar ein Schnappschuss wie in calc-verteilbasis.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarPeriod } from '../../shared/period.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotProperty, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { settlementExportCsv, settlementExportJson, type ExportableSettlement } from '../src/settlementExport.ts'

const OBJECT_AREA = 3334.81
const TENANT_AREA = 1064.67

const tenancy: SnapshotTenancy = {
  id: 't-gewerbe', unitId: 'mieteinheit', tenantName: 'Gewerbemieter', persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }],
  start: '2025-01-01', end: null,
  // Strom 1.366,33 €, Heizung 1.091,29 €, Wasser 24,30 € je Monat laut Mietvertrag, heute in einem Topf.
  prepayments: [{ from: '2025-01', monthlyCents: 136633 + 109129 + 2430 }], prepaymentOverrides: {}, baseRents: [],
}
const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
// Strom und Heizung als „Sonstige Betriebskosten“: Für beides hat Mietfuchs noch keine passende Kostenart nach Fläche
// (Beleuchtung/Allgemeinstrom trägt die Regeln des Betriebsstroms, Heizung die der HeizkostenV). Hier zählt nur die Fläche.
const item = (id: string, category: string, description: string, amountCents: number): SnapshotCostItem => ({
  id, period: calendarPeriod(2025), category, description, amountCents, key: 'area',
})
const COSTS: SnapshotCostItem[] = [
  item('strom', 'Sonstige Betriebskosten', 'Strom', 2313747),
  item('heizung', 'Sonstige Betriebskosten', 'Heizung', 3989307),
  item('wasser', 'Wasser/Abwasser', 'Wasser', 93829),
  item('aufzug', 'Aufzug', 'Wartung Fahrstuhl', 271155),
  item('treppe', 'Gebäudereinigung', 'Treppenhausreinigung', 1833590),
]
const source = (units: SnapshotUnit[]): SnapshotSource => ({
  units, tenancies: [tenancy], costItems: COSTS, meters: [], readings: [], payments: [], closedSettlements: [],
})
const property = (totalAreaM2?: number): SnapshotProperty => ({ kind: 'sonstiges', cableBuiltBeforeDec2021: null, ...(totalAreaM2 !== undefined ? { totalAreaM2 } : {}) })
const settle = (units: SnapshotUnit[], totalAreaM2?: number): ComputedSettlement =>
  computeSettlement({ ...snapshotOf(source(units), 2025), property: property(totalAreaM2) })
// Die Fläche ohne Mietverhältnis: das Objekt abzüglich der Mieteinheit, als Leerstand beim Vermieter.
const GAGLOWER = [unit('mieteinheit', TENANT_AREA), unit('leerstand', 2270.14)]

const shareOf = (s: ComputedSettlement, itemId: string): number =>
  s.statements[0]?.rows.find((r) => r.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId}`)

test('Referenzfall Gaglower Str.: Anteile nach Fläche centgenau wie die Tabelle des Vermieters', () => {
  const s = settle(GAGLOWER, OBJECT_AREA)
  assert.equal(shareOf(s, 'strom'), 738686) // 7.386,86 €
  assert.equal(shareOf(s, 'heizung'), 1273624) // 12.736,24 €
  assert.equal(shareOf(s, 'wasser'), 29956) // 299,56 €
  assert.equal(shareOf(s, 'aufzug'), 86569)
  assert.equal(shareOf(s, 'treppe'), 585391)
  // Mieteranteile + Vermieteranteil = Gesamtkosten.
  const tenant = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
  assert.equal(tenant + s.landlord.totalCents, s.totalCostsCents)
  // Die Vorauszahlung steht heute in einem Topf: 12 × 2.481,92 €.
  assert.equal(s.statements[0]?.prepaymentCents, 12 * 248192)
})

test('Gesamtfläche gleich der Summe der Einheiten: kein Hinweis, die Fläche steht in der Abrechnung', () => {
  const s = settle(GAGLOWER, OBJECT_AREA)
  assert.equal(s.objectAreaM2, OBJECT_AREA)
  assert.ok(!s.notices.some((n) => n.code === 'property.area-mismatch'))
})

test('Ohne Gesamtfläche: kein Feld, kein Hinweis, dieselben Zahlen', () => {
  const s = settle(GAGLOWER)
  assert.ok(!('objectAreaM2' in s))
  assert.ok(!s.notices.some((n) => n.code === 'property.area-mismatch'))
  assert.equal(shareOf(s, 'strom'), shareOf(settle(GAGLOWER, OBJECT_AREA), 'strom'))
})

test('Gesamtfläche weicht von der Summe der Einheiten ab: Hinweis mit beiden Zahlen, verteilt wird über die Einheiten', () => {
  // Nur die Mieteinheit angelegt: Die Abrechnung teilt über 1.064,67 m², der Mieter trägt alles.
  const s = settle([unit('mieteinheit', TENANT_AREA)], OBJECT_AREA)
  const notice = s.notices.find((n) => n.code === 'property.area-mismatch') ?? assert.fail('Hinweis fehlt')
  assert.equal(notice.level, 'hint')
  assert.match(notice.text, /3\.334,81 m²/)
  assert.match(notice.text, /1\.064,67 m²/)
  assert.equal(shareOf(s, 'strom'), 2313747)
})

test('Gesamtfläche innerhalb eines Hundertstels: kein Hinweis (Rundung der Eingabe)', () => {
  const s = settle(GAGLOWER, OBJECT_AREA + 0.005)
  assert.ok(!s.notices.some((n) => n.code === 'property.area-mismatch'))
})

// ---------- Export ----------

const exportable = (s: ComputedSettlement): ExportableSettlement => ({ ...s, closed: null })

test('Export JSON: Gesamtfläche am Objekt und Betrag pro m² je Zeile nach Fläche, wie die Spalte des Formulars', () => {
  const json = settlementExportJson(exportable(settle(GAGLOWER, OBJECT_AREA)), { id: 'p', name: 'Gaglower Str.' })
  assert.equal(json.property.totalAreaM2, OBJECT_AREA)
  const perM2 = (id: string) => json.statements[0]?.rows.find((r) => r.costItemId === id)?.centsPerM2
  assert.equal(perM2('aufzug'), 81.31) // 0,8131 €/m²
  assert.equal(perM2('treppe'), 549.83) // 5,4983 €/m²
  assert.equal(perM2('strom'), 693.82)
  // Die Zeilen des Vermieters führen keinen Schlüssel (SettlementRow) und damit keinen Betrag pro m².
  assert.equal(json.landlord.rows.find((r) => r.costItemId === 'aufzug')?.centsPerM2, null)
})

test('Export JSON ohne Gesamtfläche: Felder da, aber null', () => {
  const json = settlementExportJson(exportable(settle(GAGLOWER)), { id: 'p', name: 'Gaglower Str.' })
  assert.equal(json.property.totalAreaM2, null)
  assert.ok(json.statements[0]?.rows.every((r) => r.centsPerM2 === null))
})

test('Export JSON: kein Betrag pro m² bei anderem Schlüssel', () => {
  const s = computeSettlement({ ...snapshotOf({ ...source(GAGLOWER), costItems: [{ ...item('e', 'Aufzug', 'Aufzug', 271155), key: 'units' }] }, 2025), property: property(OBJECT_AREA) })
  const json = settlementExportJson(exportable(s), { id: 'p', name: 'H' })
  assert.equal(json.statements[0]?.rows[0]?.centsPerM2, null)
})

test('Export CSV: mit Gesamtfläche die Spalte „Betrag pro m² der Gesamtfläche“ in Euro mit vier Stellen', () => {
  const lines = settlementExportCsv(exportable(settle(GAGLOWER, OBJECT_AREA))).replace(/^﻿/, '').split('\r\n')
  assert.ok(lines[0]?.endsWith(';davon Lohnanteil § 35a;Betrag pro m² der Gesamtfläche'))
  const aufzug = lines.find((l) => l.includes('Wartung Fahrstuhl')) ?? assert.fail('keine Zeile Aufzug')
  assert.equal(aufzug.split(';').at(-1), '0,8131')
  // Jede Zeile hat gleich viele Spalten wie der Kopf.
  const width = lines[0]?.split(';').length
  assert.ok(lines.filter((l) => l !== '' && l.includes(';')).every((l) => l.split(';').length === width))
})

test('Export CSV ohne Gesamtfläche: Kopfzeile wie bisher', () => {
  const head = settlementExportCsv(exportable(settle(GAGLOWER))).replace(/^﻿/, '').split('\r\n')[0]
  assert.equal(head, 'Mieter;Wohnung;Zeitraum von;Zeitraum bis;Zeile;Kostenart;Beschreibung;Gesamtkosten;Schlüssel;Basis;Anteil;davon Lohnanteil § 35a')
})
