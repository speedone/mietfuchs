// Brennstofflieferungen im Schnappschuss und in der Abrechnung (Heizung PR 7, Entwurf 5.8, 8.2, 12.2,
// 12.3). Ein Haus mit zwei Wohnungen, Objekt von Mai bis April, eine Gasheizung mit freien Schlüsseln;
// die Gasrechnung 15.03.2025–14.03.2026 über 6.500 € steht in der Heizperiode 2025/2026.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, freezeFuelCarries } from '../src/db/fuel.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, removeEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { fuelGapQuestions } from '../src/db/fuel.ts'
import { frozenFuelCancelledOf, frozenFuelCarriesOf, frozenFuelRowsOf, snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { CALENDAR_RULES, periodContaining, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, Co2Statement, FrozenFuelCarry, FuelDelivery, LandlordPart, PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const P = (key: string, rules: PeriodRules = MAI): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
type Quelle = Parameters<typeof snapshotFor>[0]

const anlage = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant & { propertyId: string } => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
  propertyId: 'objekt-1', ...over,
})
const lieferung = (over: Partial<FuelDelivery> = {}): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: periodKey('2025-05'), category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area',
  heatingPlantId: 'hp', fuelDeliveryId: 'd', ...over,
})
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: `Mieter ${unitId.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null as string | null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const abgeschlossen = (key: string, over: Record<string, unknown> = {}) => ({
  period: periodKey(key), propertyId: 'objekt-1', selfUsedShareCents: 0, prepaymentCents: 0, prepaymentOverridden: false, ...over,
})

function quelle(over: Partial<Quelle> = {}): Quelle {
  return {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: MAI }],
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: true, propertyId: 'objekt-1' },
    ],
    tenancies: [mieter('ta', 'a'), mieter('tb', 'b')],
    costItems: [position({ id: 'gas' })],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [anlage()],
    fuelDeliveries: [lieferung()],
    ...over,
  }
}
const snap = (key: string, over: Partial<Quelle> = {}, rules: PeriodRules = MAI) => snapshotFor(quelle(over), 'objekt-1', P(key, rules))
const settle = (key: string, over: Partial<Quelle> = {}, asOf?: string): ComputedSettlement =>
  computeSettlement(snap(key, over), asOf ? { asOf } : {})

test('Schnappschuss: ohne Lieferung kein Feld `fuel`; mit Lieferung ihre Positionen auch aus anderen Zeiträumen', () => {
  assert.equal(snap('2025-05', { fuelDeliveries: [] }).fuel, undefined)
  const s = snap('2024-05')
  assert.deepEqual(s.fuel?.deliveries.map((d) => d.id), ['d'])
  assert.deepEqual(s.fuel?.items.map((c) => c.id), ['gas'], 'die Position aus 2025/2026 trägt den Schlüssel der Übertragszeile in 2024/2025')
  assert.deepEqual(s.costItems.map((c) => c.id), [], 'verteilt wird in 2024/2025 nur der Übertrag')
})

test('Schnappschuss: abgeschlossene Heizperioden mit Frist und Übertragszeilen; eigene Heizperiode der Anlage', () => {
  const zeilen = { statements: [{ tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', rows: [{ kind: 'fuelCarry', costItemId: 'fuel:e:2024-05:gas0', shareCents: 54464 }, { costItemId: 'x', shareCents: 1 }] }] }
  assert.deepEqual(frozenFuelRowsOf(zeilen), [{ costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', shareCents: 54464 }])
  assert.deepEqual(frozenFuelRowsOf(null), [])
  const s = snap('2025-05', { closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(zeilen) })] })
  assert.deepEqual(s.fuel?.closed, [{ plantId: 'hp', period: '2024-05', label: '2024/2025', deadline: '2026-04-30', fuelRows: frozenFuelRowsOf(zeilen), carries: [] }])
  // Objekt im Kalenderjahr, Anlage von Mai bis April: Mit P = 2025 ist die Heizperiode 2024/2025 abgeschlossen.
  const eigen = snapshotFor(quelle({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    heatingPlants: [anlage({ periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false })],
    closedSettlements: [abgeschlossen('2025-01')],
  }), 'objekt-1', P('2026-01', CALENDAR_RULES))
  assert.deepEqual(eigen.fuel?.closed.map((c) => [c.period, c.label, c.deadline]), [['2024-05', '2025', '2026-12-31']])
})

// ---------- Überträge in der Abrechnung (Entwurf 8.2, Fälle a–f) ----------

const anteilVon = (r: ComputedSettlement, tenancyId: string, prefix: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.filter((row) => row.costItemId.startsWith(prefix)).reduce((a, row) => a + row.shareCents, 0) ?? 0
const teileVon = (r: ComputedSettlement, id: string): LandlordPart[] => r.landlord.rows.find((x) => x.costItemId === id)?.landlordParts ?? []
const summe = (r: ComputedSettlement): number => r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const schaetzung = (cents: number) => lieferung({ id: 'e', label: 'Schätzung', invoiceFrom: '2025-03-15', invoiceTo: '2025-04-30', amountCents: cents, estimated: true })
const eingefroren = (deliveryId: string, period: string, cents: number): FrozenFuelCarry => ({ deliveryId, plantId: 'hp', period: periodKey(period), cents, emissionsKg: 0, co2Cents: 0 })
const zeilenDerSchaetzung = (ta: number, tb: number) => [
  { costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'ta', tenantName: 'Mieter A', unitName: 'A', shareCents: ta },
  { costItemId: 'fuel:e:2024-05:gas0', tenancyId: 'tb', tenantName: 'Mieter B', unitName: 'B', shareCents: tb },
]

test('Fall a: H trägt 5.516,61 €, H−1 983,39 €; je Mieter nach dem Schlüssel der Gasposition, Summe 6.500,00 €', () => {
  const h = settle('2025-05')
  assert.deepEqual([anteilVon(h, 'ta', 'gas'), anteilVon(h, 'tb', 'gas')], [390000, 260000])
  assert.deepEqual([anteilVon(h, 'ta', 'fuel:d:'), anteilVon(h, 'tb', 'fuel:d:')], [-59003, -39336])
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  assert.equal(summe(h), 650000)
  const zeile = h.statements[0]?.rows.find((row) => row.kind === 'fuelCarry') ?? assert.fail('keine Übertragszeile')
  assert.equal(zeile.description, 'Gas: Anteil für 2024/2025 (voriger Zeitraum)')
  assert.deepEqual(zeile.steps?.[0], { label: 'Anteil der Rechnung', value: '6.500,00 € × 151,29 ‰ (nach der Gradtagszahlentabelle) = 983,39 €', term: 'degreeDays' })
  const h1 = settle('2024-05')
  assert.deepEqual([anteilVon(h1, 'ta', 'fuel:d:'), anteilVon(h1, 'tb', 'fuel:d:')], [59003, 39336])
  assert.deepEqual(teileVon(h1, 'fuel:d:2024-05:2025-05'), [{ reason: 'fuelCarry', cents: -98339 }])
  assert.equal(summe(h1), 0)
  assert.equal(h.statements.reduce((a, st) => a + st.totalShareCents, 0) + h1.statements.reduce((a, st) => a + st.totalShareCents, 0), 650000)
})

test('Fall b: Schätzung 907,74 € eingefroren; 75,65 € beim Vermieter, vor und nach Fristablauf benannt', () => {
  const ueber = {
    fuelDeliveries: [lieferung(), schaetzung(90774)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 90774)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(54464, 36310) })],
  }
  const vorher = settle('2025-05', ueber, '2026-03-20')
  assert.deepEqual(teileVon(vorher, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: 7565 }])
  assert.equal(summe(vorher), 650000)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /war 907,74 € geschätzt; tatsächlich entfallen 983,39 €\. Die Differenz von 75,65 € steht bei Ihnen\./)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /berichtigten Abrechnung 2024\/2025; sie muss den Mietern bis 30\.04\.2026 zugehen/)
  const nachher = settle('2025-05', ueber, '2026-06-01')
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /am 30\.04\.2026 abgelaufen\. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben/)
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /in der Regel binnen drei Monaten/)
})

test('Fall c: ohne Schätzung abgeschlossen; 983,39 € beim Vermieter mit Hinweis', () => {
  const h = settle('2025-05', { closedSettlements: [abgeschlossen('2024-05')] })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  assert.match(textOf(h, 'fuel.closed-period-part'), /für 2024\/2025 \(983,39 €\) gehört in die Abrechnung 2024\/2025, die ohne Schätzung abgeschlossen wurde; bis Sie ihn nachfordern, steht er bei Ihnen\./)
  assert.equal(summe(h), 650000)
})

test('Fall e: Schätzung 1.050,00 € zu hoch; −66,61 € und die Gutschrift je Mieter', () => {
  const h = settle('2025-05', {
    fuelDeliveries: [lieferung(), schaetzung(105000)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 105000)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(63000, 42000) })],
  })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 105000 }, { reason: 'fuelEstimateDiff', cents: -6661 }])
  const n = h.notices.find((x) => x.code === 'fuel.estimate-overcharged') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /haben 66,61 € zu viel getragen, hier: Mieter A \(A\) 39,97 € und Mieter B \(B\) 26,64 €\. Eine Gutschrift ist jederzeit zulässig und wird empfohlen\./)
  assert.equal(summe(h), 650000)
})

test('Invariante (Abschluss mit Schätzung, Startwert 515): Die Rechnung deckt die Schätzung nur teilweise ab; die Gutschriften je Mieter ergeben zusammen den Betrag, den die Mieter zu viel getragen haben', () => {
  // Geschätzt ist 01.01.–30.04.2025 (9.000,00 €), die Rechnung beginnt am 15.03.2025: Nur der Teil der Schätzung
  // für 15.03.–30.04. ist mit der Rechnung zu vergleichen, und nur er geht in die Gutschrift je Mieter.
  const e = lieferung({ id: 'e', label: 'Schätzung', invoiceFrom: '2025-01-01', invoiceTo: '2025-04-30', amountCents: 900000, estimated: true })
  const h = settle('2025-05', {
    fuelDeliveries: [lieferung(), e],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 900000)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(540000, 360000) })],
  })
  const n = h.notices.find((x) => x.code === 'fuel.estimate-overcharged') ?? assert.fail(codes(h).join(', '))
  const cents = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100)
  const total = cents(n.text.match(/haben ([\d.,]+) € zu viel getragen/)?.[1] ?? assert.fail(n.text))
  const diff = teileVon(h, 'fuel:d:2025-05:2024-05').find((p) => p.reason === 'fuelEstimateDiff')?.cents ?? assert.fail('keine Abweichung')
  assert.equal(total, -diff)
  const each = [...n.text.matchAll(/Mieter [AB] \([AB]\) ([\d.,]+) €/g)].map((m) => cents(m[1] ?? ''))
  assert.equal(each.length, 2)
  // Vorher: der Faktor −diff/E auf alle Zeilen der Schätzung, also rund 9.000 € / E-fach zu viel.
  assert.equal(each.reduce((a, c) => a + c, 0), total, n.text)
})

// ---------- Durchsicht von #247, Runde 3 (G-W2, G-K1, G-K2): Gutschrift je Mieter bei zu hoher Schätzung ----------
// Der eingefrorene Stand von 2024/2025 entsteht wie in der Anwendung: Die Schätzung wird mit dem Schlüssel der
// Vorjahresrechnung über die Heizperiode verteilt, je Mietverhältnis nach seinen Tagen darin.
const vorjahr = lieferung({ id: 'v', label: 'Gas 2023/2024', invoiceFrom: '2023-05-01', invoiceTo: '2024-04-30' })
const vorjahrPosition = position({ id: 'gasv', fuelDeliveryId: 'v', period: periodKey('2023-05'), amountCents: 600000 })
const gutschriftFall = (opts: { tenancies: ReturnType<typeof mieter>[]; estimates: FuelDelivery[]; units?: Quelle['units'] }) => {
  const units = opts.units ? { units: opts.units } : {}
  const zu = settle('2024-05', { ...units, tenancies: opts.tenancies, fuelDeliveries: [vorjahr, ...opts.estimates], costItems: [vorjahrPosition] })
  const carries = zu.heating?.[0]?.fuel?.carries ?? []
  const h = settle('2025-05', {
    ...units,
    tenancies: opts.tenancies,
    fuelDeliveries: [lieferung(), vorjahr, ...opts.estimates],
    costItems: [position({ id: 'gas' }), vorjahrPosition],
    fuelCarryFrozen: opts.estimates.map((e) => eingefroren(e.id, '2024-05', carries.filter((c) => c.deliveryId === e.id).reduce((a, c) => a + c.cents, 0))),
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(zu) })],
  })
  const n = h.notices.find((x) => x.code === 'fuel.estimate-overcharged') ?? assert.fail(codes(h).join(', '))
  const cents = (x: string) => Math.round(Number(x.replace(/\./g, '').replace(',', '.')) * 100)
  const diff = teileVon(h, 'fuel:d:2025-05:2024-05').find((p) => p.reason === 'fuelEstimateDiff')?.cents ?? assert.fail('keine Abweichung')
  const je = Object.fromEntries([...n.text.matchAll(/(Mieter [A-Z0-9]+) \([A-Z]\) ([\d.]+,\d\d) €/g)].map((m) => [m[1] ?? '', cents(m[2] ?? '')]))
  return { text: n.text, diff, je, summe: Object.values(je).reduce((a, c) => a + c, 0) }
}
const schaetzungVon = (id: string, from: string, to: string, cents: number) => lieferung({ id, label: `Schätzung ${id}`, invoiceFrom: from, invoiceTo: to, amountCents: cents, estimated: true })

test('Durchsicht #247 G-W2: Mieterwechsel in der Schätzung: wer im abgedeckten Zeitraum nicht wohnte, bekommt keine Gutschrift', () => {
  // B1 wohnt bis 28.02.2025, B2 ab 01.03.2025; die Rechnung deckt die Schätzung erst ab 15.03.2025 ab.
  const f = gutschriftFall({
    tenancies: [mieter('ta', 'a'), { ...mieter('tb1', 'b'), tenantName: 'Mieter B1', end: '2025-02-28' }, { ...mieter('tb2', 'b'), tenantName: 'Mieter B2', start: '2025-03-01' }],
    estimates: [schaetzungVon('e', '2025-01-01', '2025-04-30', 900000)],
  })
  assert.equal(f.diff, -158569)
  // Im abgedeckten Zeitraum tragen A 60 % und B2 40 % der Schätzung (951,41 € und 634,28 €); B1 wohnte dort nicht.
  // Vorher: A 951,41 €, B1 528,28 €, B2 106,00 €. Je Mieter höchstens 2 Cent neben dem Ideal, weil die eingefrorenen
  // Zeilen auf den Cent gerundet sind.
  assert.deepEqual(Object.keys(f.je).sort(), ['Mieter A', 'Mieter B2'], f.text)
  assert.ok(Math.abs((f.je['Mieter A'] ?? 0) - 95141.4) <= 2 && Math.abs((f.je['Mieter B2'] ?? 0) - 63427.6) <= 2, f.text)
  assert.equal(f.summe, 158569)
})

test('Durchsicht #247 G-K1/G-K2: Leerstand im abgedeckten Zeitraum: die Mieter bekommen nur ihren Teil, und der Text nennt nur ihn', () => {
  // B ist ab 01.03.2025 leer: Den Teil der Schätzung für B trug der Vermieter (Leerstand).
  const f = gutschriftFall({
    tenancies: [mieter('ta', 'a'), { ...mieter('tb', 'b'), end: '2025-02-28' }],
    estimates: [schaetzungVon('e', '2025-01-01', '2025-04-30', 900000)],
  })
  assert.equal(f.diff, -158569)
  assert.deepEqual(f.je, { 'Mieter A': 95141 }, f.text)
  assert.match(f.text, /Die Abweichung beträgt 1\.585,69 €; davon haben die Mieter dieser Heizperiode 951,41 € zu viel getragen, hier: Mieter A \(A\) 951,41 €\. Der Rest lag bei Ihnen\./)
})

test('Durchsicht #247 G-K1: zwei Schätzungen, verschieden weit abgedeckt: jede zählt mit ihrem abgedeckten Teil', () => {
  // März geschätzt (die Rechnung deckt ihn ab dem 15. ab), April geschätzt (ganz abgedeckt); B1 wohnt bis 31.03.,
  // B2 ab 01.04. Die Gutschrift für B1 kommt nur aus dem März, die für B2 nur aus dem April.
  const f = gutschriftFall({
    tenancies: [mieter('ta', 'a'), { ...mieter('tb1', 'b'), tenantName: 'Mieter B1', end: '2025-03-31' }, { ...mieter('tb2', 'b'), tenantName: 'Mieter B2', start: '2025-04-01' }],
    estimates: [schaetzungVon('e1', '2025-03-01', '2025-03-31', 300000), schaetzungVon('e2', '2025-04-01', '2025-04-30', 200000)],
  })
  assert.equal(f.summe, -f.diff, f.text)
  // Von Hand: abgedeckt sind vom März 15.–31. nach Gradtagen, vom April alles; A trägt 60 %, B 40 % jeder Schätzung.
  const table = onlyVersion(hkvDegreeDays).value
  const e1 = 300000 * degreeDayPermille([{ from: '2025-03-15', to: '2025-03-31' }], table) / degreeDayPermille([{ from: '2025-03-01', to: '2025-03-31' }], table)
  const e2 = 200000
  const d = -f.diff
  const erwartet = { 'Mieter A': 0.6 * d, 'Mieter B1': (0.4 * d * e1) / (e1 + e2), 'Mieter B2': (0.4 * d * e2) / (e1 + e2) }
  assert.deepEqual(Object.keys(f.je).sort(), Object.keys(erwartet).sort(), f.text)
  for (const [name, v] of Object.entries(erwartet)) assert.ok(Math.abs((f.je[name] ?? Number.NaN) - v) <= 2, `${name}: ${f.je[name]} statt ${v.toFixed(2)}; ${f.text}`)
})

test('Durchsicht #247 G-K4 (M10): drei gleiche Wohnungen: die Gutschriften je Mieter ergeben zusammen genau die Abweichung, nicht einen Cent mehr oder weniger', () => {
  // Je Mieter ein Drittel; einzeln gerundet ergäben drei Drittel einen Cent zu wenig oder zu viel.
  const flat = { participates: true, propertyId: 'objekt-1' }
  const f = gutschriftFall({
    units: [{ id: 'a', name: 'A', areaM2: 50, ...flat }, { id: 'b', name: 'B', areaM2: 50, ...flat }, { id: 'c', name: 'C', areaM2: 50, ...flat }],
    tenancies: [mieter('ta', 'a'), mieter('tb', 'b'), mieter('tc', 'c')],
    estimates: [schaetzungVon('e', '2025-01-01', '2025-04-30', 900001)],
  })
  assert.notEqual(-f.diff % 3, 0, 'der Fall braucht eine Abweichung, die sich nicht in Drittel teilen lässt')
  assert.equal(Object.keys(f.je).length, 3, f.text)
  assert.equal(f.summe, -f.diff, f.text)
})

test('Fall f: H−1 wieder offen; die Schätzung zählt nicht mehr, H−1 bucht die echte Rechnung herein (Review Focus 3)', () => {
  const ueber = { fuelDeliveries: [lieferung(), schaetzung(90774)] }
  assert.deepEqual(teileVon(settle('2025-05', ueber), 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  const h1 = settle('2024-05', ueber)
  assert.equal(anteilVon(h1, 'ta', 'fuel:e:'), 0)
  assert.equal(anteilVon(h1, 'ta', 'fuel:d:'), 59003)
  assert.ok(!codes(h1).includes('fuel.estimated'))
})

test('Gutschrift derselben Rechnung: beide Positionen im selben Verhältnis, Summe bleibt (Review Focus 1)', () => {
  const ueber = { costItems: [position({ id: 'gas', amountCents: 700000 }), position({ id: 'gs', description: 'Gutschrift Gas', amountCents: -50000 })] }
  const h = settle('2025-05', ueber)
  assert.equal(summe(h), 650000)
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  assert.equal(anteilVon(h, 'ta', 'fuel:d:') + anteilVon(h, 'tb', 'fuel:d:'), -98339)
  const h1 = settle('2024-05', ueber)
  assert.equal(anteilVon(h1, 'ta', 'fuel:d:') + anteilVon(h1, 'tb', 'fuel:d:'), 98339)
})

test('Eigennutzung: Der Eigenanteil der Abrechnung folgt dem Verbrauch, der Übertrag nimmt seinen Teil mit (Entwurf 8.2, N8)', () => {
  const ueber = {
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: false, selfUsed: true, selfPersons: 1, propertyId: 'objekt-1' },
    ],
    tenancies: [mieter('ta', 'a')],
  }
  const h = settle('2025-05', ueber)
  assert.equal(h.selfUsedShareCents, 260000 - 39336)
  assert.equal(summe(h), 650000)
})

test('Hinweise: Gradtage, fester Teil, Lücke; Bewertung mit Abdeckung und Überträgen; Gradtagstabelle im Rechtsstand', () => {
  const h = settle('2025-05')
  assert.equal(h.notices.find((n) => n.code === 'fuel.share-by-degree-days')?.level, 'hint')
  assert.match(textOf(h, 'fuel.share-by-degree-days'), /Den Teil für 2025\/2026 \(848,71 ‰ des Verbrauchs\) bestimmt Mietfuchs nach der Gradtagszahlentabelle/)
  assert.match(textOf(h, 'fuel.share-by-degree-days'), /Zählerstand des Versorgungszählers zum 30\.04\.2025/)
  assert.ok(codes(h).includes('fuel.fixed-unknown'))
  assert.match(textOf(h, 'fuel.uncovered'), /^Heizanlage „Gas“, Heizperiode 2025\/2026: Für 15\.03\.–30\.04\.2026 \(47 Tage, 151,3 ‰ der Gradtage\) liegt keine Rechnung vor; diesen Teil verteilt Mietfuchs nicht\. .*Lesen Sie den Gaszähler zum 30\.04\.2026 ab und tragen Sie den Stand auf der Seite Zähler ein/)
  assert.deepEqual(h.notices.find((n) => n.code === 'fuel.uncovered')?.subject, { kind: 'heatingCosts', id: 'hp' })
  const fuel = h.heating?.[0]?.fuel ?? assert.fail('keine Bewertung')
  assert.equal(fuel.coveragePermille.toFixed(2), '848.71')
  assert.deepEqual(fuel.carries, [{ deliveryId: 'd', period: '2024-05', cents: -98339, totalCents: 650000 }])
  assert.deepEqual([fuel.deliveries[0]?.method, fuel.deliveries[0]?.inPeriodCents], ['degreeDays', 551661])
  assert.ok(h.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'))
})

test('Heizrechnung über die Heizperiode: verknüpft kein Hinweis, bei freien Schlüsseln ohne Verknüpfung fuel.manual-beyond-period', () => {
  const ueber = (over: Partial<SnapshotCostItem>) => ({ costItems: [position({ id: 'gas', serviceFrom: '2025-03-15', serviceTo: '2026-03-14', ...over })] })
  const verknuepft = settle('2025-05', ueber({}))
  assert.ok(!codes(verknuepft).includes('period.heating-mismatch') && !codes(verknuepft).includes('fuel.manual-beyond-period'))
  const lose = settle('2025-05', { ...ueber({ fuelDeliveryId: null }), fuelDeliveries: [] })
  assert.match(textOf(lose, 'fuel.manual-beyond-period'), /^„Gas“: Die Rechnung reicht über die Heizperiode 2025\/2026 hinaus/)
  assert.ok(!codes(lose).includes('period.heating-mismatch'))
})

test('Wer nichts einstellt, merkt nichts: ohne Lieferung dieselbe Abrechnung wie ohne Verknüpfung, keine Gradtage im Rechtsstand', () => {
  const ohne = settle('2025-05', { fuelDeliveries: [] })
  const ganzOhne = settle('2025-05', { fuelDeliveries: [], costItems: [position({ id: 'gas', fuelDeliveryId: null })] })
  assert.deepEqual(ohne, ganzOhne)
  assert.ok(!ohne.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'))
  assert.ok(!codes(ohne).some((c) => c.startsWith('fuel.')))
})

// ---------- Invarianten über Zufallsbestände (Entwurf 12.3 Nr. 1, 5) ----------

function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const DAY = 86400000
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

test('Invarianten: je Abrechnung Σ Zeilen = Σ Positionen; über alle Heizperioden ist jede Lieferung genau einmal verteilt, auch über einen Abschluss', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 60; lauf++) {
    const deliveries: FuelDelivery[] = []
    const items: (SnapshotCostItem & { propertyId: string })[] = []
    let start = isoOf(Date.UTC(2024, 1, 1) + int(0, 90) * DAY)
    const anzahl = int(2, 3)
    for (let k = 0; k < anzahl; k++) {
      const end = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 420) - 1) * DAY)
      deliveries.push(lieferung({ id: `d${k}`, label: `Rechnung ${k}`, invoiceFrom: start, invoiceTo: end, fixedCents: rnd() < 0.5 ? int(0, 20000) : null }))
      items.push(position({ id: `p${k}`, fuelDeliveryId: `d${k}`, period: periodContaining(MAI, end).key, amountCents: int(100000, 900000), key: rnd() < 0.5 ? 'area' : 'units' }))
      start = isoOf(Date.parse(`${end}T00:00:00Z`) + DAY)
    }
    const first = deliveries[0]?.invoiceFrom ?? assert.fail('keine Lieferung')
    const last = deliveries.at(-1)?.invoiceTo ?? assert.fail('keine Lieferung')
    const keys: string[] = []
    for (let p = periodContaining(MAI, first); p.from <= last; p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
    const fall = `Lauf ${lauf}: ${JSON.stringify(deliveries.map((d) => [d.invoiceFrom, d.invoiceTo, d.fixedCents]))}`
    // Die erste Heizperiode wird in der Hälfte der Läufe abgeschlossen: Was sie herein- und
    // hinausbucht, friert ein, wie beim Abschluss (Task 9).
    const base = { costItems: items, fuelDeliveries: deliveries }
    const erste = settle(keys[0] ?? assert.fail(fall), base)
    const zu = rnd() < 0.5
    const frozen: FrozenFuelCarry[] = []
    if (zu) {
      for (const d of deliveries) {
        const cents = (erste.heating?.[0]?.fuel?.carries ?? []).filter((c) => c.deliveryId === d.id).reduce((a, c) => a + c.cents, 0)
        if (cents !== 0) frozen.push(eingefroren(d.id, keys[0] ?? '', cents))
      }
    }
    const weiter = { ...base, fuelCarryFrozen: frozen, closedSettlements: zu ? [abgeschlossen(keys[0] ?? '', { fuelCarryRows: frozenFuelRowsOf(erste) })] : [] }
    const ergebnisse = [erste, ...keys.slice(1).map((key) => settle(key, weiter))]
    // Nr. 1: Σ aller Zeilen = Σ der Positionen dieses Zeitraums.
    ergebnisse.forEach((r, i) => {
      const positionen = items.filter((c) => c.period === keys[i]).reduce((a, c) => a + c.amountCents, 0)
      assert.equal(summe(r), positionen, `${fall}, ${keys[i]}`)
    })
    // Nr. 5: Je Lieferung heben sich die Überträge über alle Heizperioden auf.
    for (const d of deliveries) {
      const netto = ergebnisse.flatMap((r) => r.heating?.[0]?.fuel?.carries ?? []).filter((c) => c.deliveryId === d.id).reduce((a, c) => a + c.cents, 0)
      assert.equal(netto, 0, `${fall}, ${d.id}`)
    }
  }
})

test('Eigene Heizperiode nach Weg b: Die Heizperiode ohne eigene Positionen bucht den Übertrag herein; über beide Abrechnungen 6.500,00 €', () => {
  // Objekt im Kalenderjahr, Anlage von Mai bis April: Die Heizperiode 2024/2025 endet in 2025 und hat
  // keine Position, die Gasrechnung steht in 2025/2026 (endet in 2026).
  const eigen = (key: string) => snapshotFor(quelle({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    heatingPlants: [anlage({ periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false })],
  }), 'objekt-1', P(key, CALENDAR_RULES))
  const p2025 = computeSettlement(eigen('2025-01'))
  const p2026 = computeSettlement(eigen('2026-01'))
  const mieter = (r: ComputedSettlement) => r.statements.reduce((a, st) => a + st.totalShareCents, 0)
  assert.equal(mieter(p2025), 98339)
  assert.equal(mieter(p2026), 551661)
  assert.equal(mieter(p2025) + mieter(p2026), 650000)
})

// ---------- Eigene CO₂-Aufteilung (Entwurf 7.6, 9; G-A3, G-B5) ----------

// Drei Wohnungen mit 600 m², Gas 9.000 € nach Fläche (50/30/20 %), Messkosten 1.000 € nach Einheiten;
// die Gasrechnung liegt ganz in der Heizperiode: 24.105,6 kg, CO₂-Kosten 773,79 € (Beispiel B1).
const drei = (over: Partial<Quelle> = {}): Partial<Quelle> => ({
  units: [
    { id: 'a', name: 'A', areaM2: 300, participates: true, propertyId: 'objekt-1' },
    { id: 'b', name: 'B', areaM2: 180, participates: true, propertyId: 'objekt-1' },
    { id: 'c', name: 'C', areaM2: 120, participates: true, propertyId: 'objekt-1' },
  ],
  tenancies: [mieter('ta', 'a'), mieter('tb', 'b'), mieter('tc', 'c')],
  costItems: [position({ id: 'gas', amountCents: 900000 }), position({ id: 'mess', description: 'Messkosten', amountCents: 100000, key: 'units', fuelDeliveryId: null })],
  fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', emissionsKg: 24105.6, co2CostCents: 77379 })],
  ...over,
})
const abzugVon = (r: ComputedSettlement, tenancyId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.filter((row) => row.kind === 'co2Relief').reduce((a, row) => a + row.shareCents, 0) ?? 0
const aufteilung = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-05'), method: 'selfAfterService', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})

test('G-B5: Der Abzug folgt dem Schlüssel des Brennstoffs; A trägt 232,14 €, nicht 224,40 € wie nach dem ganzen Topf', () => {
  const r = settle('2025-05', drei())
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb'), abzugVon(r, 'tc')], [-23214, -13928, -9285])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 46427 }])
  assert.equal(summe(r), 1000000)
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.deepEqual([co2.method, co2.basis, co2.kgPerM2, co2.landlordPermille, co2.landlordCents, co2.totalCents, co2.areaM2, co2.areaSource, co2.coveragePermille], ['self', 'deliveries', 40.2, 600, 46427, 77379, 600, 'served', 1000])
  const zeile = r.statements[0]?.rows.find((row) => row.kind === 'co2Relief') ?? assert.fail('keine Abzugszeile')
  assert.equal(zeile.basisText, 'nach Ihrem Anteil an den Brennstoffkosten')
  assert.deepEqual(zeile.steps?.[1], { label: 'Ihr Teil davon', value: '464,274 € × 4.500,00 € ÷ 9.000,00 € = 232,137 €' })
  assert.ok(!codes(r).some((c) => c === 'co2.missing' || c === 'co2.share-approximated'))
})

test('§ 8 und § 9: 500 ‰ im Nichtwohngebäude, halber Anteil bei einer Vorgabe, keine Aufteilung bei beiden', () => {
  const nichtWohnen = settle('2025-05', drei({ heatingPlants: [anlage({ nonResidential: true })] }))
  assert.equal(abzugVon(nichtWohnen, 'ta'), -19345)
  assert.match(textOf(nichtWohnen, 'co2.non-residential'), /mindestens 50 % der CO₂-Kosten \(§ 8 Abs\. 1 CO2KostAufG\)/)
  assert.ok(nichtWohnen.legalBasis.values?.some((v) => v.id === 'co2.non-residential'))
  const gebaeude = settle('2025-05', drei({ heatingPlants: [anlage({ restriction: 'building' })] }))
  assert.equal(abzugVon(gebaeude, 'ta'), -11607)
  assert.match(textOf(gebaeude, 'co2.restriction'), /des Gebäudes entgegen\. Ihr Anteil an den CO₂-Kosten wird deshalb um 50 % gekürzt \(§ 9 Abs\. 1 CO2KostAufG\)\. Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen \(§ 9 Abs\. 3 CO2KostAufG\)/)
  const beides = settle('2025-05', drei({ heatingPlants: [anlage({ restriction: 'both' })] }))
  assert.equal(abzugVon(beides, 'ta'), 0)
  assert.match(textOf(beides, 'co2.restriction'), /werden die CO₂-Kosten nicht aufgeteilt \(§ 9 Abs\. 2 CO2KostAufG\)/)
  assert.equal(beides.heating?.[0]?.co2?.landlordCents, 0)
})

test('Review Focus 5: Heizpauschale bei B; nur wer Brennstoffzeilen hat, bekommt einen Abzug', () => {
  const r = settle('2025-05', drei({ tenancies: [mieter('ta', 'a'), { ...mieter('tb', 'b'), heatingModel: 'flatRate' as const }, mieter('tc', 'c')] }))
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb'), abzugVon(r, 'tc')], [-23214, 0, -9285])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 32499 }])
  assert.equal(summe(r), 1000000)
})

test('Ohne Verknüpfung: nach dem ganzen Topf und co2.share-approximated; ohne CO₂-Angaben co2.incomplete', () => {
  const lose = settle('2025-05', drei({ costItems: [position({ id: 'gas', amountCents: 900000, fuelDeliveryId: null }), position({ id: 'mess', description: 'Messkosten', amountCents: 100000, key: 'units', fuelDeliveryId: null })] }))
  assert.ok(Math.abs(abzugVon(lose, 'ta') + 22440) <= 1, `A: ${abzugVon(lose, 'ta')}`)
  assert.match(textOf(lose, 'co2.share-approximated'), /Keine Position der Heizanlage ist als Brennstoff gekennzeichnet/)
  const ohne = settle('2025-05', drei({ fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30' })] }))
  assert.match(textOf(ohne, 'co2.incomplete'), /die CO₂-Angaben der Rechnung „Gas 2025\/2026“/)
  assert.equal(abzugVon(ohne, 'ta'), 0)
  const zuViel = settle('2025-05', drei({ fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', emissionsKg: 24105.6, co2CostCents: 950000 })] }))
  assert.equal(zuViel.notices.find((n) => n.code === 'co2.exceeds-heating')?.level, 'error')
  assert.equal(abzugVon(zuViel, 'ta'), 0)
})

test('Ohne Lieferung bei freien Schlüsseln: co2.missing führt zu den Lieferungen; Emissionshandel ab 2023 ohne Hinweis', () => {
  assert.match(textOf(settle('2025-05', drei({ fuelDeliveries: [] })), 'co2.missing'), /als Lieferungen ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf/)
  const ets = settle('2025-05', drei({ fuelDeliveries: [], heatingPlants: [anlage({ energy: 'districtHeating', districtEtsNew: true })] }))
  // Durchsicht von #233: Die Abrechnung sagt, warum nicht aufgeteilt wird.
  assert.deepEqual(codes(ets).filter((c) => c.startsWith('co2.')), ['co2.district-ets-exempt'])
  assert.match(textOf(ets, 'co2.district-ets-exempt'), /erstmals nach dem 01\.01\.2023 .*nicht aufgeteilt \(§ 2 Abs\. 4 Satz 2 CO2KostAufG\)/)
  assert.ok(ets.legalBasis.values?.some((v) => v.id === 'co2.district-ets-new'))
})

test('G-A3 (F13): Messdienst ohne Aufteilung, Gasrechnung als Lieferung; Entlastung 240,00 €, nicht 203,69 €', () => {
  const messdienst = { ...anlage({ method: 'service' }) }
  const ueber = (st: Partial<Co2Statement> = {}): Partial<Quelle> => ({
    heatingPlants: [messdienst],
    costItems: [position({ id: 'hz', description: 'Heizung und Warmwasser laut Messdienst', amountCents: 400000, key: 'amounts', tenancyAmounts: { ta: 240000, tb: 160000 }, fuelDeliveryId: null })],
    fuelDeliveries: [lieferung({ amountCents: 311747, emissionsKg: 2950, co2CostCents: 60000 })],
    co2Statements: [aufteilung({ serviceFuelGrossCents: 311747, ...st })],
  })
  const r = settle('2025-05', ueber())
  assert.deepEqual([abzugVon(r, 'ta'), abzugVon(r, 'tb')], [-14400, -9600])
  assert.deepEqual(teileVon(r, 'co2:hp:2025-05'), [{ reason: 'co2Share', cents: 24000 }])
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.deepEqual([co2.method, co2.totalCents, co2.kgPerM2, co2.landlordPermille], ['selfAfterService', 60000, 29.5, 400])
  assert.ok(Math.abs((co2.emissionsKg ?? 0) - 2950) < 1e-6, 'E umgerechnet = E der Rechnung')
  assert.ok(!codes(r).includes('co2.service-unsplit'))
  assert.match(textOf(r, 'co2.service-unsplit-healed'), /bis zu 3 %/)
  assert.match(textOf(r, 'co2.share-approximated'), /weist den Brennstoffanteil je Nutzer nicht aus/)
  assert.ok(!codes(r).includes('co2.service-fuel-mismatch'))
  assert.match(textOf(settle('2025-05', ueber({ serviceFuelGrossCents: 320000 })), 'co2.service-fuel-mismatch'), /Brennstoffkosten von 3\.200,00 € angesetzt, die Rechnungen, die Sie als angesetzt gekennzeichnet haben, ergeben 3\.117,47 €/)
  // Ohne angesetzte Rechnung bleibt es bei der Warnung aus PR 6.
  const nicht = settle('2025-05', { ...ueber(), fuelDeliveries: [lieferung({ amountCents: 311747, emissionsKg: 2950, co2CostCents: 60000, usedByService: false })] })
  assert.ok(codes(nicht).includes('co2.service-unsplit'))
})

// ---------- Durchsicht PR #233: Geld ----------

const mieterSumme = (r: ComputedSettlement) => r.statements.reduce((a, st) => a + st.totalShareCents, 0)

test('Durchsicht I1: Lieferung ohne Position mit 0 eingefroren, Position später verknüpft: 983,39 € beim Vermieter, Mieter von H 5.516,61 € statt 6.500,00 €', () => {
  const ohne = settle('2024-05', { costItems: [] })
  const ueber = { fuelCarryFrozen: [eingefroren('d', '2024-05', 0)], closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(ohne) })] }
  const h = settle('2025-05', ueber)
  assert.equal(mieterSumme(h), 551661)
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  assert.match(textOf(h, 'fuel.closed-period-part'), /983,39 €/)
  assert.equal(summe(h), 650000)
})

test('Durchsicht I3: Schätzung, deren Tage eine echte Rechnung teilweise abdeckt, zählt nur für die übrigen Tage', () => {
  const ueber = {
    fuelDeliveries: [lieferung({ id: 'd1', label: 'Schlussrechnung alt', invoiceFrom: '2024-05-01', invoiceTo: '2025-04-15' }), schaetzung(90774)],
    costItems: [position({ id: 'alt', fuelDeliveryId: 'd1', period: periodKey('2024-05'), amountCents: 500000 })],
  }
  const h1 = settle('2024-05', ueber)
  // 16.–30.04.2025: 15 · 80/30 = 40 Gradtage von 71,29 + 80 = 151,29 der Schätzung.
  const rest = Math.round((90774 * 40) / ((17 * 130) / 31 + 80))
  assert.equal(mieterSumme(h1), 500000 + rest)
  assert.deepEqual(h1.heating?.[0]?.fuel?.gaps, [])
})

test('Durchsicht I4: unverknüpfte Heizposition ohne Leistungszeitraum: kein Schätzvorschlag, sondern die Frage nach der Verknüpfung', () => {
  const ohneZeitraum = { costItems: [position({ id: 'gas' }), position({ id: 'alt', description: 'Gas alt', period: periodKey('2024-05'), amountCents: 520000, fuelDeliveryId: null })] }
  const h1 = settle('2024-05', ohneZeitraum)
  assert.ok((h1.heating?.[0]?.fuel?.gaps ?? []).every((g) => g.estimate === null), JSON.stringify(h1.heating?.[0]?.fuel?.gaps))
  assert.match(textOf(h1, 'fuel.loose-item'), /Ist die Rechnung schon als Position erfasst\?/)
  // Mit Leistungszeitraum deckt die Position ihre Tage ab; es bleibt keine Lücke.
  const mitZeitraum = { costItems: [position({ id: 'gas' }), position({ id: 'alt', description: 'Gas alt', period: periodKey('2024-05'), amountCents: 520000, fuelDeliveryId: null, serviceFrom: '2024-03-15', serviceTo: '2025-03-14' })] }
  assert.deepEqual(settle('2024-05', mitZeitraum).heating?.[0]?.fuel?.gaps, [])
})

test('Durchsicht M1: Lieferung über drei Heizperioden: je Heizperiode eine eigene Kennung und der richtige Rechenweg', () => {
  const ueber = { fuelDeliveries: [lieferung({ invoiceFrom: '2024-03-15', invoiceTo: '2025-05-14' })], costItems: [position({ id: 'gas', period: periodKey('2025-05') })] }
  const h = settle('2025-05', ueber)
  const ids = h.statements[0]?.rows.map((r) => r.costItemId) ?? []
  assert.equal(new Set(ids).size, ids.length, ids.join(', '))
  const landlord = h.landlord.rows.map((r) => r.costItemId)
  assert.equal(new Set(landlord).size, landlord.length, landlord.join(', '))
  const sum = mieterSumme(settle('2023-05', ueber)) + mieterSumme(settle('2024-05', ueber)) + mieterSumme(h)
  assert.equal(sum, 650000)
})

test('Durchsicht M4: Hinweise an Übertragszeilen zeigen auf die Position, nicht auf die Kennung der Zeile', () => {
  const h = settle('2024-05', { costItems: [position({ id: 'gas', key: 'direct', directUnitId: 'gibt-es-nicht' })] })
  for (const n of h.notices) if (n.subject?.kind === 'costItem') assert.ok(!n.subject.id.startsWith('fuel:'), JSON.stringify(n))
})

test('Durchsicht C1: Wärmepumpe mit Lieferung: keine CO₂-Aufteilung, kein CO₂-Hinweis (§ 2 Abs. 1 CO2KostAufG: nur Brennstoffe mit Standardwerten nach § 7 Abs. 4 BEHG)', () => {
  const wp = settle('2025-05', drei({ heatingPlants: [anlage({ energy: 'heatPump' })], fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30' })] }))
  assert.ok(!codes(wp).some((c) => c.startsWith('co2.')), codes(wp).join(', '))
  assert.equal(abzugVon(wp, 'ta'), 0)
  assert.equal(wp.heating?.[0]?.co2 ?? null, null)
  // Fernwärme ohne CO₂-Angaben der Rechnung: der bedingte Hinweis wie ohne Lieferung, keine Aufteilung.
  const fw = settle('2025-05', drei({ heatingPlants: [anlage({ energy: 'districtHeating' })], fuelDeliveries: [lieferung({ invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30' })] }))
  assert.ok(!codes(fw).includes('co2.incomplete'), codes(fw).join(', '))
  assert.match(textOf(fw, 'co2.missing'), /Weist Ihr Wärmelieferant CO₂-Kosten aus/)
})

test('Durchsicht Recht I1: Ohne Schätzung abgeschlossen heißt nicht „tragen Sie selbst“; Nachforderung nach § 556 Abs. 3 Satz 3 BGB genannt', () => {
  const h = settle('2025-05', { closedSettlements: [abgeschlossen('2024-05')] })
  const t = textOf(h, 'fuel.closed-period-part')
  assert.doesNotMatch(t, /Sie tragen ihn selbst/)
  assert.match(t, /nicht zu vertreten haben \(§ 556 Abs\. 3 Satz 3 BGB/)
  assert.match(t, /binnen drei Monaten/)
  const nachher = settle('2025-05', {
    fuelDeliveries: [lieferung(), schaetzung(90774)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 90774)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(54464, 36310) })],
  }, '2026-06-01')
  const s = textOf(nachher, 'fuel.estimate-settled')
  assert.doesNotMatch(s, /freiwillig/)
  assert.match(s, /Lag die Rechnung schon vor Ablauf der Frist vor, ist die Verspätung in der Regel zu vertreten\./)
})

test('Durchsicht Recht I2: Die Schätzung nennt ihre Grundlage und sagt, dass ihre Zulässigkeit nicht entschieden ist', () => {
  const h = settle('2024-05', { fuelDeliveries: [lieferung({ id: 'e', label: 'Schätzung 15.03.–30.04.2025: 151,29 ‰ der Rechnung „Gas 2024/2025“ nach Gradtagen', invoiceFrom: '2025-03-15', invoiceTo: '2025-04-30', amountCents: 90774, estimated: true }), lieferung({ id: 'd1', label: 'Gas 2024/2025', invoiceFrom: '2024-03-15', invoiceTo: '2025-03-14' })], costItems: [position({ id: 'gas1', fuelDeliveryId: 'd1', period: periodKey('2024-05') })] })
  const t = textOf(h, 'fuel.estimated')
  assert.match(t, /Grundlage: Schätzung 15\.03\.–30\.04\.2025: 151,29 ‰ der Rechnung „Gas 2024\/2025“ nach Gradtagen/)
  assert.match(t, /höchstrichterlich nicht entschieden/)
  // Grundsatz der Verbrauchsabgrenzung (VIII ZR 156/11) ja, aber nicht als Beleg für die Schätzung einer fehlenden Rechnung.
  assert.doesNotMatch(t, /156\/11/)
})

test('Durchsicht Recht Minor: Gradtage-Hinweis ohne unbelegte Aussage über die Versorger, GasGVV nur für die Grundversorgung', () => {
  const t = textOf(settle('2025-05'), 'fuel.share-by-degree-days')
  assert.doesNotMatch(t, /Deutschen Wetterdienstes/)
  assert.match(t, /Grundversorgung/)
})

// Die Invariante über Abschluss, Wiederöffnen und Verknüpfen steht in fuel-invariant.test.ts: Sie
// geht über die echten Schreibwege der Datenbank und bildet keine Sperre nach.

// ---------- Nachprüfung von 7551434 (Korrekturrunde 2) ----------

test('Nachprüfung I-b: Gutschrift −500 € an einer Lieferung mit eingefrorenem Teil: Mieter in H 5.016,61 €, über beide Zeiträume 6.000,00 €', () => {
  const h1 = settle('2024-05')
  const Y = (h1.heating?.[0]?.fuel?.carries ?? []).reduce((a, c) => a + c.cents, 0)
  const zu = { fuelCarryFrozen: [eingefroren('d', '2024-05', Y)], closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(h1) })] }
  const mit = settle('2025-05', { ...zu, costItems: [position({ id: 'gas' }), position({ id: 'gs', description: 'Gutschrift', amountCents: -50000 })] })
  assert.equal(mieterSumme(mit), 501661)
  assert.equal(mieterSumme(h1) + mieterSumme(mit), 600000)
  assert.equal(summe(mit), 600000)
})

test('Nachprüfung M-a: Heizposition ohne Anlage bei genau einer Anlage zählt als Position ohne Lieferung', () => {
  const h1 = settle('2024-05', { costItems: [position({ id: 'gas' }), position({ id: 'alt', description: 'Gas alt', period: periodKey('2024-05'), amountCents: 520000, fuelDeliveryId: null, heatingPlantId: null })] })
  assert.ok((h1.heating?.[0]?.fuel?.gaps ?? []).every((g) => g.estimate === null), JSON.stringify(h1.heating?.[0]?.fuel?.gaps))
  assert.ok(codes(h1).includes('fuel.loose-item'))
})

test('Nachprüfung M-b, M-c: abgeschlossen, als die Lieferung noch keine Position hatte; Frist nach Wegfall des Hindernisses', () => {
  const ohne = settle('2024-05', { costItems: [] })
  const h = settle('2025-05', { fuelCarryFrozen: [eingefroren('d', '2024-05', 0)], closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(ohne) })] })
  const t = textOf(h, 'fuel.closed-period-part')
  assert.match(t, /Als die Abrechnung 2024\/2025 abgeschlossen wurde, war die Rechnung „Gas 2025\/2026“ noch mit keiner Position verknüpft/)
  assert.match(t, /in der Regel binnen drei Monaten nach Wegfall des Hindernisses \(BGH VIII ZR 220\/05\)/)
  const c = textOf(settle('2025-05', { closedSettlements: [abgeschlossen('2024-05')] }), 'fuel.closed-period-part')
  assert.match(c, /die ohne Schätzung abgeschlossen wurde/)
  assert.match(c, /nach Wegfall des Hindernisses/)
})

test('Nachprüfung M-d: VIII ZR 156/11 nur mit dem, was die Entscheidung trägt (Leistungsprinzip, sachgerechte Schätzung Rn. 14)', () => {
  const t = textOf(settle('2025-05'), 'fuel.share-by-degree-days')
  assert.match(t, /Leistungsprinzip/)
  assert.match(t, /BGH VIII ZR 156\/11, Rn\. 14/)
  assert.doesNotMatch(t, /den Verbrauch darf der Vermieter dabei sachgerecht schätzen/)
})

test('Nachprüfung (Invariante, Startwert 2): Die mittlere Heizperiode nimmt genau, was die abgeschlossene Heizperiode der Positionen hinausgebucht hat', () => {
  // Rechnung über drei Heizperioden; ihre Heizperiode 2025/2026 wird mit zwei Positionen abgeschlossen,
  // danach wird eine Position gelöscht (in einem abgeschlossenen Zeitraum bleibt der eingefrorene Stand).
  const base = { fuelDeliveries: [lieferung({ invoiceFrom: '2024-03-15', invoiceTo: '2025-05-14' })] }
  const zwei = [position({ id: 'gas', period: periodKey('2025-05') }), position({ id: 'nach', description: 'Nachzahlung', period: periodKey('2025-05'), amountCents: 100000 })]
  const h = settle('2025-05', { ...base, costItems: zwei })
  const hinaus = (h.heating?.[0]?.fuel?.carries ?? []).find((c) => c.period === '2024-05')?.cents ?? assert.fail('kein Übertrag nach 2024/2025')
  const ueber = {
    ...base,
    costItems: [zwei[0] ?? assert.fail('keine Position')],
    fuelCarryFrozen: [eingefroren('d', '2025-05', (h.heating?.[0]?.fuel?.carries ?? []).reduce((a, c) => a + c.cents, 0))],
    closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(h), fuelCarries: frozenFuelCarriesOf(h) })],
  }
  const mitte = settle('2024-05', ueber)
  assert.equal(mieterSumme(mitte), -hinaus)
})

// ---------- Nachprüfung von e364435 (Korrekturrunde 3) ----------

test('Nachprüfung W1: Storno nach Abschluss der Heizperiode davor: Vermieter weist die zu viel getragenen 983,39 € aus, mit Hinweis', () => {
  const h1 = settle('2024-05')
  const Y = (h1.heating?.[0]?.fuel?.carries ?? []).reduce((a, c) => a + c.cents, 0)
  assert.equal(Y, 98339)
  const zu = { fuelCarryFrozen: [eingefroren('d', '2024-05', Y)], closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(h1) })] }
  for (const costItems of [
    [position({ id: 'gas' }), position({ id: 'gs', description: 'Storno', amountCents: -650000 })],
    [position({ id: 'gas', amountCents: 0 })],
  ]) {
    const h = settle('2025-05', { ...zu, costItems })
    assert.equal(mieterSumme(h), 0)
    assert.equal(summe(h), 0)
    assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 98339 }, { reason: 'fuelClosedPeriod', cents: -98339 }])
    const n = h.notices.find((x) => x.code === 'fuel.cancelled-after-close') ?? assert.fail(codes(h).join(', '))
    assert.equal(n.level, 'warning')
    assert.match(n.text, /ist storniert oder auf 0 € gesetzt\. Die abgeschlossene Abrechnung 2024\/2025 enthält dafür 983,39 €, die die Mieter zu viel getragen haben\. Öffnen Sie sie wieder und schließen Sie neu ab/)
    assert.match(n.text, /§ 556 Abs\. 3 Satz 3 BGB schließt nach Ablauf der Frist nur eine Nachforderung durch den Vermieter aus/)
  }
})

test('Nachprüfung (gering): Position erst nach dem Abschluss ihrer Heizperiode verknüpft: die andere Heizperiode nimmt nichts und sagt es', () => {
  const ohne = settle('2025-05', { costItems: [position({ id: 'gas', fuelDeliveryId: null })] })
  const ueber = { closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(ohne), fuelCarries: frozenFuelCarriesOf(ohne) })] }
  const h1 = settle('2024-05', ueber)
  assert.equal(mieterSumme(h1), 0)
  assert.match(textOf(h1, 'fuel.owner-closed-unlinked'), /Abrechnung 2025\/2026, in der die Rechnung steht, ist abgeschlossen; ihre Position war beim Abschluss noch nicht mit der Lieferung verknüpft/)
})

test('Invariante (Startwert 515): Rechnung beim Abschluss ihrer Heizperiode verknüpft, aber storniert: der Hinweis sagt „storniert“, nicht „nicht verknüpft“', () => {
  const storniert = settle('2025-05', { costItems: [position({ id: 'gas', amountCents: 0 })] })
  const ueber = { closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(storniert), fuelCarries: frozenFuelCarriesOf(storniert), fuelCancelled: frozenFuelCancelledOf(storniert) })] }
  const h1 = settle('2024-05', ueber)
  assert.equal(mieterSumme(h1), 0)
  const t = textOf(h1, 'fuel.owner-closed-unlinked')
  assert.match(t, /Zur Rechnung „Gas 2025\/2026“ gehörten heute 983,39 € in diese Heizperiode\. Die Abrechnung 2025\/2026, in der die Rechnung steht, ist abgeschlossen; beim Abschluss ergaben ihre Positionen zusammen 0 € \(storniert\)/)
  assert.doesNotMatch(t, /noch nicht mit der Lieferung verknüpft/)
})

test('Invariante (Startwerte 196, 397): mit 0 eingefroren, weil die Rechnung beim Abschluss storniert war: der Hinweis sagt „storniert“, nicht „nicht verknüpft“', () => {
  const vorher = settle('2024-05', { costItems: [position({ id: 'gas', amountCents: 0 })] })
  const h = settle('2025-05', {
    fuelCarryFrozen: [eingefroren('d', '2024-05', 0)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(vorher), fuelCancelled: [{ plantId: 'hp', period: '2024-05', deliveryId: 'd' }] })],
  })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  const t = textOf(h, 'fuel.closed-period-part')
  assert.match(t, /Als die Abrechnung 2024\/2025 abgeschlossen wurde, ergaben die Positionen der Rechnung „Gas 2025\/2026“ zusammen 0 € \(storniert\)\. Ihr Teil für 2024\/2025 \(983,39 €\) ist dort deshalb nicht verteilt/)
  assert.doesNotMatch(t, /noch mit keiner Position verknüpft/)
})

test('Nachprüfung W1, Gegenstück: Storno nach Abschluss der Heizperiode der Positionen: die offene davor verteilt nichts und weist die Gegenbuchung aus', () => {
  const h2 = settle('2025-05')
  const ueber = { closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(h2), fuelCarries: frozenFuelCarriesOf(h2) })] }
  const X = -(h2.heating?.[0]?.fuel?.carries ?? []).reduce((a, c) => a + c.cents, 0)
  assert.equal(X, 98339)
  const h1 = settle('2024-05', { ...ueber, costItems: [position({ id: 'gas', amountCents: 0 })] })
  assert.equal(mieterSumme(h1), 0)
  assert.equal(summe(h1), 0)
  assert.deepEqual(teileVon(h1, 'fuel:d:2024-05:2025-05'), [{ reason: 'fuelCarry', cents: -98339 }, { reason: 'fuelClosedPeriod', cents: 98339 }])
  assert.match(textOf(h1, 'fuel.cancelled-after-close'), /ist storniert oder auf 0 € gesetzt\. Die abgeschlossene Abrechnung 2025\/2026, in der sie steht, enthält dafür 5\.516,61 €, die die Mieter zu viel getragen haben; 983,39 € hatte sie als Anteil dieser Heizperiode hinausgebucht/)
  // Ein eingefrorener Stand ohne die Summe der Rechnung nennt nur den hinausgebuchten Teil.
  const alt = { closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(h2), fuelCarries: frozenFuelCarriesOf(h2).map(({ totalCents: _t, ...c }) => c) })] }
  assert.match(textOf(settle('2024-05', { ...alt, costItems: [position({ id: 'gas', amountCents: 0 })] }), 'fuel.cancelled-after-close'), /in der sie steht, hat 983,39 € als Anteil dieser Heizperiode hinausgebucht/)
})

test('Invariante (Gerät ausgefallen, Startwert 509): Storno nach Abschluss, Teil lag schon beim Vermieter: die wieder geöffnete Heizperiode bucht nichts gegen, der Teil steht einmal beim Vermieter', () => {
  // 2024/2025 wird abgeschlossen, als die Rechnung noch keine Position hat (0 eingefroren). 2025/2026 bucht
  // ihren Teil für 2024/2025 deshalb nicht hinaus, sondern an den Vermieter (`fuelClosedPeriod`), und wird so
  // abgeschlossen. Dann wird 2024/2025 wieder geöffnet und die Rechnung storniert.
  const ohne = settle('2024-05', { costItems: [] })
  const h2 = settle('2025-05', { fuelCarryFrozen: [eingefroren('d', '2024-05', 0)], closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: frozenFuelRowsOf(ohne) })] })
  assert.deepEqual(teileVon(h2, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  const h1 = settle('2024-05', {
    costItems: [position({ id: 'gas', amountCents: 0 })],
    fuelCarryFrozen: [eingefroren('d', '2025-05', (h2.heating?.[0]?.fuel?.carries ?? []).reduce((a, c) => a + c.cents, 0))],
    closedSettlements: [abgeschlossen('2025-05', { fuelCarryRows: frozenFuelRowsOf(h2), fuelCarries: frozenFuelCarriesOf(h2) })],
  })
  assert.equal(mieterSumme(h1), 0)
  assert.equal(summe(h1), 0)
  // Vorher: Gegenbuchung −983,39 € ohne Gegenstück und noch einmal 983,39 € „abgeschlossene Heizperiode“;
  // über beide Abrechnungen stand der Teil zweimal als vom Vermieter getragen da (1.966,78 €).
  assert.deepEqual(teileVon(h1, 'fuel:d:2024-05:2025-05'), [])
  // Ohne Betrag und ohne Teil steht auch keine leere Gegenzeile beim Vermieter (Durchsicht #247, G-K4/M9).
  assert.equal(h1.landlord.rows.some((r) => r.costItemId === 'fuel:d:2024-05:2025-05'), false)
  const teile = [...teileVon(h2, 'fuel:d:2025-05:2024-05'), ...teileVon(h1, 'fuel:d:2024-05:2025-05')]
  assert.equal(teile.filter((p) => p.reason === 'fuelCarry').reduce((a, p) => a + p.cents, 0), 0)
  assert.equal(teile.filter((p) => p.reason === 'fuelClosedPeriod').reduce((a, p) => a + p.cents, 0), 98339)
  // Der Hinweis bleibt: Die Mieter von 2025/2026 haben ihren Teil der stornierten Rechnung zu viel getragen.
  assert.match(textOf(h1, 'fuel.cancelled-after-close'), /enthält dafür 5\.516,61 €, die die Mieter zu viel getragen haben/)
})

// ---------- Nachprüfung von 47f2373 (Korrekturrunde 4) ----------

test('Nachprüfung M2: 2024/2025 mit Schätzung 907,74 € abgeschlossen, die Rechnung kommt und wird storniert: Gegenbuchung beim Vermieter und Warnung', () => {
  const ueber = {
    fuelDeliveries: [lieferung(), schaetzung(90774)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 90774)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(54464, 36310) })],
  }
  for (const costItems of [
    [position({ id: 'gas' }), position({ id: 'gs', description: 'Storno', amountCents: -650000 })],
    [position({ id: 'gas', amountCents: 0 })],
  ]) {
    const h = settle('2025-05', { ...ueber, costItems })
    assert.equal(summe(h), 0)
    assert.deepEqual(teileVon(h, 'fuel:d:2025-05:2024-05'), [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: -90774 }])
    assert.match(textOf(h, 'fuel.cancelled-after-close'), /ist storniert oder auf 0 € gesetzt\. Die abgeschlossene Abrechnung 2024\/2025 enthält dafür 907,74 €, die die Mieter zu viel getragen haben/)
  }
})

test('Nachprüfung G1: Storno ohne abgeschlossene andere Heizperiode: die Rechnung deckt nichts mehr ab, die Lücke steht wieder da', () => {
  const h = settle('2025-05', { costItems: [position({ id: 'gas', amountCents: 0 })] })
  assert.match(textOf(h, 'fuel.uncovered'), /Für 01\.05\.2025–30\.04\.2026 \(365 Tage/)
  assert.deepEqual(h.heating?.[0]?.fuel?.deliveries, [])
  // Eine Rechnung ohne Positionen (noch nicht verknüpft) deckt weiter ab.
  const offen = settle('2025-05', { costItems: [] })
  assert.match(textOf(offen, 'fuel.uncovered'), /Für 15\.03\.–30\.04\.2026/)
})

// ---------- Nachprüfung von 5bee89f (Korrekturrunde 5) ----------

// Eine weitere Rechnung mit Position, aus der eine Schätzung ihren Schlüssel nehmen kann.
const spaeter = lieferung({ id: 'd2', label: 'Gas 2026/2027', invoiceFrom: '2026-03-15', invoiceTo: '2027-03-14' })
const spaeterePosition = position({ id: 'gas2', fuelDeliveryId: 'd2', period: periodKey('2026-05') })

test('Nachprüfung M-b: Rechnung, deren Positionen 0 € ergeben: Hinweis, die Lücke nennt sie, die Rückfrage beim Abschluss ebenfalls', () => {
  const h = settle('2025-05', {
    fuelDeliveries: [lieferung(), spaeter],
    costItems: [position({ id: 'gas' }), position({ id: 'gs', description: 'Gutschrift', amountCents: -650000 }), spaeterePosition],
  })
  const n = h.notices.find((x) => x.code === 'fuel.zero-invoice') ?? assert.fail(codes(h).join(', '))
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Die Positionen der Rechnung „Gas 2025\/2026“ ergeben zusammen 0 €\. Mietfuchs behandelt sie als storniert und rechnet ihren Zeitraum als nicht abgedeckt\. Ist es eine echte Rechnung über 0 €/)
  const lucke = textOf(h, 'fuel.uncovered')
  assert.match(lucke, /liegt nur die Rechnung „Gas 2025\/2026“ vor, deren Positionen zusammen 0 € ergeben/)
  assert.doesNotMatch(lucke, /liegt keine Rechnung vor/)
  const fragen = fuelGapQuestions(h)
  assert.ok(fragen.length > 0)
  assert.deepEqual(fragen.map((q) => q.zeroInvoices), fragen.map(() => ['Gas 2025/2026']))
})

test('Nachprüfung M-a: Schätzung in offener Heizperiode, die Rechnung ist storniert: die Schätzung zählt wieder', () => {
  const h = settle('2024-05', {
    fuelDeliveries: [lieferung(), schaetzung(90774), spaeter],
    costItems: [position({ id: 'gas', amountCents: 0 }), spaeterePosition],
  })
  assert.ok(h.heating?.[0]?.fuel?.deliveries.some((d) => d.deliveryId === 'e'), 'die Schätzung fehlt in der Bewertung')
  assert.ok(codes(h).includes('fuel.estimated'), codes(h).join(', '))
  assert.ok(mieterSumme(h) > 0)
})

test('Nachprüfung G-a: Schätzung ohne Rechnung, aus der sie ihren Schlüssel nehmen kann: Warnung statt „geschätzt“', () => {
  const h = settle('2024-05', { fuelDeliveries: [lieferung(), schaetzung(90774)], costItems: [position({ id: 'gas', amountCents: 0 })] })
  assert.equal(mieterSumme(h), 0)
  assert.ok(!codes(h).includes('fuel.estimated'), codes(h).join(', '))
  const n = h.notices.find((x) => x.code === 'fuel.estimate-undistributed') ?? assert.fail(codes(h).join(', '))
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Die Schätzung „Schätzung“ \(907,74 €\) verteilt Mietfuchs nicht/)
})

// ---------- Durchsicht von #247, Runde 3 (G-K4): der Storno-Merker über die Datenbank ----------

test('Durchsicht #247 G-K4: Abschluss mit stornierter Rechnung über die Datenbank: gespeichert, gelesen, der Hinweis sagt „storniert“', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-storno-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createDelivery(db, 'd', 'hp', { label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', fixedCents: null })
      const fields = { propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, key: 'area', heatingPlantId: 'hp', fuelDeliveryId: 'd', taxYear: 2026 }
      await createEntity(db, 'costItems', 'gas', { ...fields, description: 'Gas', amountCents: 650000 })
      await createEntity(db, 'costItems', 'storno', { ...fields, description: 'Storno', amountCents: -650000 })
    })
    const periodOf = (key: string) => periodOfKey(MAI, periodKey(key)) ?? assert.fail(key)
    // 2025/2026 abschließen, solange die Rechnung storniert ist, wie in index.ts.
    await opened.write(async (db) => db.transaction(async (tx) => {
      const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf('2025-05')), {})
      await closeSettlement(tx, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-05'), closedAt: '2027-01-01', sentAt: null, settlement })
      await freezeFuelCarries(tx, settlement)
    }))
    // Danach das Storno löschen; 2024/2025 ist offen.
    await opened.write((db) => removeEntity(db, 'costItems', 'storno'))
    const h1 = computeSettlement(snapshotFor(await opened.read((db) => readStock(db)), 'objekt-1', periodOf('2024-05')), {})
    const t = textOf(h1, 'fuel.owner-closed-unlinked')
    assert.match(t, /beim Abschluss ergaben ihre Positionen zusammen 0 € \(storniert\)/)
    assert.doesNotMatch(t, /noch nicht mit der Lieferung verknüpft/)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
