// Betriebsstrom-Abzug in der Steuerübersicht (#268). Bezahlt ist die ganze Stromrechnung des Allgemeinstroms; eine
// Heizposition „steckt auch in der Stromrechnung“ (`included`) und ein Abzug beim Allgemeinstrom sind beide nur
// Ausschnitte derselben Rechnung. Werbungskosten (§ 9 Abs. 1 Satz 1, § 11 Abs. 2 EStG) sind deshalb beim Strom genau
// die bezahlte Rechnung. Die Steuerübersicht rechnet dafür je Steuerjahr einen Ausgleich
//   C = Σ Betrag der Abzüge (ohne Abzüge ohne Verweis, wenn eine Messdienst-Anlage den Zeitraum berührt)
//       − Σ Betrag der Heizpositionen `included`,
// mit Vorzeichen und ohne Klemme (Entscheidungen R-2, R-3), als eigene Zeile beim Allgemeinstrom. Die Abrechnung an
// die Mieter bleibt, wie sie ist. Beträge in den Kommentaren in €, in den Zusicherungen in Cent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor, type ComputedSettlement } from '../src/calc.ts'
import { frozenSettlementOf, snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, PeriodRules, TaxReport } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
type Plant = NonNullable<Source['heatingPlants']>[number]
type Item = Source['costItems'][number]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (over: Partial<Plant> = {}): Plant => ({
  id: 'hp1', propertyId: 'objekt-1', name: 'Kessel', method: 'manual', source: 'building', supply: 'central',
  energy: 'gas', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
  periodStartMonth: null, periodChanges: [], separateSpans: [], separateSettlement: false, endsOn: null, replacesPlantId: null, ...over,
})
const position = (id: string, key: string, amountCents: number, over: Partial<Item> = {}): Item => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Grundsteuer', description: id, amountCents, key: 'area', ...over,
})
const heizung = (id: string, amountCents: number, over: Partial<Item> = {}, key = '2025-01') =>
  position(id, key, amountCents, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', ...over })
const gas = (amountCents = 500000, key = '2025-01', over: Partial<Item> = {}) => heizung(`gas${key.slice(0, 4)}`, amountCents, { description: 'Gas', heatingPart: 'fuel', ...over }, key)
const hausstrom = (amountCents = 100000, key = '2025-01', over: Partial<Item> = {}) =>
  position('hs', key, amountCents, { category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', key: 'units', ...over })
// Heizposition „Betrieb“, die auch in der Stromrechnung steckt.
const betrieb = (id: string, amountCents: number, over: Partial<Item> = {}, key = '2025-01') =>
  heizung(id, amountCents, { description: `Betriebsstrom ${id}`, heatingPart: 'operating', operatingPower: 'included', ...over }, key)
// Abzug beim Allgemeinstrom; `item`: die Heizposition, zu der er gehört, sonst ohne Verweis.
const abzug = (id: string, amountCents: number, item?: string, over: Partial<Item> = {}, key = '2025-01') =>
  position(id, key, -amountCents, {
    category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${id}`, key: 'units', operatingPower: 'deduction',
    operatingPowerGeneralId: 'hs', ...(item ? { operatingPowerItemId: item } : {}), ...over,
  })
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
// Zwei vermietete Wohnungen, EG 60 m² und OG 40 m², wie pr266-r5-check.md.
const haus = (costItems: Item[], plants: Plant[] = [anlage()], over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [mieter('t1', 'u1'), mieter('t2', 'u2')], costItems, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: plants,
  ...over,
} as Source)
// Eigennutzung: EG 70 m² (t1), OG 50 m² (t2), DG 30 m² selbstgenutzt, zusammen 150 m².
const eigen = (costItems: Item[], over: Partial<Source> = {}): Source => haus(costItems, [anlage()], {
  units: [
    { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 70, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 50, participates: true },
    { id: 'u3', propertyId: 'objekt-1', name: 'DG', areaM2: 30, participates: false, selfUsed: true, selfPersons: 2 },
  ],
  ...over,
} as Partial<Source>)
const tax = (src: Source, year = 2025): TaxReport => taxReportFor(src, 'objekt-1', year)
const settle = (src: Source, key = '2025-01', rules: PeriodRules = CALENDAR_RULES): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))
const LINE = (year = 2025) => `operating-power-balance:${year}`
const line = (r: TaxReport, year = 2025) => r.expenses.items.find((i) => i.costItemId === LINE(year))
const strom = (r: TaxReport) => r.expenses.groups.flatMap((g) => g.categories).find((c) => c.category === 'Beleuchtung/Allgemeinstrom')?.amountCents ?? 0
const mieterSumme = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents ?? assert.fail(`kein Mieter ${id}`)

// ---------- Prüfstücke ohne Eigennutzung (Plan, Abschnitt 6) ----------

test('V1: Abzug 200 ohne Verweis, Anlage ohne Messdienst: Werbungskosten 6.000 statt 5.800, eigene Zeile beim Allgemeinstrom', () => {
  // Bezahlt: Gas 5.000 + Strom 1.000 = 6.000. Heute stand der Abzug wie eine Gutschrift da: 5.000 + 1.000 − 200 = 5.800.
  // C = 200 − 0 = +200.
  const r = tax(haus([gas(), hausstrom(), abzug('ab', 20000)]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(strom(r), 100000, 'Allgemeinstrom 1.000 − 200 + 200')
  assert.equal(r.expenses.groups.find((g) => g.group === 'Laufende Betriebskosten')?.amountCents, 600000)
  assert.deepEqual(r.expenses.items.filter((i) => i.category === 'Beleuchtung/Allgemeinstrom').map((i) => i.amountCents), [100000, -20000, 20000])
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.equal(z.description, 'Betriebsstrom der Heizung, selbst getragen')
  assert.equal(z.group, 'Laufende Betriebskosten')
  assert.equal(z.allocation, 'area')
  assert.equal(z.privateCents, 0)
  assert.equal(z.deductibleCents, 20000)
  assert.equal(z.deductiblePercent, 100)
  assert.equal(z.operatingPowerBalance, true)
  assert.equal(r.operatingPowerBalanceCents, 20000)
  assert.ok(z.steps.some((s) => s.value.includes('„Abzug ab“') && s.value.includes('200,00')), JSON.stringify(z.steps))
})

test('V1: Die Abrechnung an die Mieter bleibt (t1 3.400, t2 2.400)', () => {
  // t1: Gas 3.000 + Strom 500 − Abzug 100 = 3.400; t2: 2.000 + 500 − 100 = 2.400.
  const s = settle(haus([gas(), hausstrom(), abzug('ab', 20000)]))
  assert.equal(mieterSumme(s, 't1'), 340000)
  assert.equal(mieterSumme(s, 't2'), 240000)
})

test('V2: Abzug 200 verknüpft mit Heizposition 200: neutral, keine Zeile', () => {
  // 5.000 + 200 + 1.000 − 200 = 6.000; C = 200 − 200 = 0.
  const src = haus([gas(), betrieb('bs', 20000), hausstrom(), abzug('ab', 20000, 'bs')])
  const r = tax(src)
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r), undefined)
  assert.equal(r.operatingPowerBalanceCents, undefined)
  // Mieter: t1 Gas 3.000 + BS 120 + 500 − 100 = 3.520; t2 2.000 + 80 + 500 − 100 = 2.480.
  const s = settle(src)
  assert.deepEqual([mieterSumme(s, 't1'), mieterSumme(s, 't2')], [352000, 248000])
})

test('V3: Messdienst, Abzug ohne Verweis gilt als gemeldet: neutral (3.800)', () => {
  // Messdienst 3.000 (darin gemeldeter Betriebsstrom 200) + Strom 1.000 − 200 = 3.800 = Gas 2.800 + Strom 1.000.
  const r = tax(haus([heizung('md', 300000, { description: 'Messdienst' }), hausstrom(), abzug('ab', 20000)], [anlage({ method: 'service' })]))
  assert.equal(r.expenses.totalCents, 380000)
  assert.equal(line(r), undefined)
})

test('V4: ohne Abzug 6.000, keine Zeile', () => {
  const r = tax(haus([gas(), hausstrom()]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r), undefined)
})

test('V5: Heizposition 120 unverknüpft und Abzug 200 ohne Verweis: 6.000 (C = 200 − 120 = 80)', () => {
  // Heute 5.000 + 120 + 1.000 − 200 = 5.920.
  const r = tax(haus([gas(), betrieb('bs', 12000), hausstrom(), abzug('ab', 20000)]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r)?.amountCents, 8000)
})

test('V6: Heizposition 120, Abzug 120 verknüpft und 80 ohne Verweis: 6.000 (C = 80)', () => {
  const r = tax(haus([gas(), betrieb('bs', 12000), hausstrom(), abzug('ab1', 12000, 'bs'), abzug('ab2', 8000)]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r)?.amountCents, 8000)
})

test('V11: Heizposition 100, Abzug 200 verknüpft (100 zu viel): 6.000 (C = +100)', () => {
  // Heute 5.000 + 100 + 1.000 − 200 = 5.900.
  const r = tax(haus([gas(), betrieb('bs', 10000), hausstrom(), abzug('ab', 20000, 'bs')]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r)?.amountCents, 10000)
})

test('M1a: Heizposition 300, Abzug 200 verknüpft: 6.000 statt 6.100 (C = −100, keine Klemme)', () => {
  // Heute 5.000 + 300 + 1.000 − 200 = 6.100: Die Stromrechnung zählte 100 doppelt.
  const r = tax(haus([gas(), betrieb('bs', 30000), hausstrom(), abzug('ab', 20000, 'bs')]))
  assert.equal(r.expenses.totalCents, 600000)
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.equal(z.amountCents, -10000)
  // Durchsicht S1: neutral benannt; im selben Jahr verschieden hoch, also ein Satz zum Prüfen.
  assert.equal(z.description, 'Betriebsstrom der Heizung, Ausgleich')
  assert.equal(r.operatingPowerBalanceKind, 'mismatch')
  assert.equal(r.operatingPowerBalanceCents, -10000)
  // Allgemeinstrom 1.000 − 200 − 100 = 700, Heizung 5.000 + 300 = 5.300: zusammen 6.000, Strom also einmal gezählt.
  assert.equal(strom(r), 70000)
})

test('M1b: Heizposition 200 ohne Abzug: 6.000 statt 6.200 (C = −200)', () => {
  const r = tax(haus([gas(), betrieb('bs', 20000), hausstrom()]))
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(line(r)?.amountCents, -20000)
})

test('M2: Abzug 2025 verknüpft mit Heizposition 2026: jedes Jahr für sich die bezahlte Summe (6.000 und 5.000)', () => {
  // 2025: Gas 5.000, Strom 1.000, Abzug −200 → heute 5.800, C = +200 → 6.000.
  // 2026: Gas 5.000, Heizposition 200 → heute 5.200, C = −200 → 5.000 (keine Stromrechnung 2026).
  const src = haus([gas(), hausstrom(), abzug('ab', 20000, 'bs'), gas(500000, '2026-01'), betrieb('bs', 20000, {}, '2026-01')])
  assert.equal(tax(src, 2025).expenses.totalCents, 600000)
  assert.equal(tax(src, 2026).expenses.totalCents, 500000)
  assert.equal(line(tax(src, 2025))?.amountCents, 20000)
  assert.equal(line(tax(src, 2026), 2026)?.amountCents, -20000)
})

test('V7 (#267): Mai bis April, Abzug mit Steuerjahr 2025, Stromrechnung mit Steuerjahr 2026: der Abzug steht mit der Rechnung in 2026', () => {
  const MAI: PeriodRules = { startMonth: 5, changes: [] }
  const src = haus([hausstrom(100000, '2025-05', { taxYear: 2026 }), abzug('ab', 20000, undefined, { taxYear: 2025 }, '2025-05')], [anlage()], {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: MAI }],
  } as Partial<Source>)
  // Bis #267: 2025 nur der Abzug −200 und C = +200 (Betrag 0 in einem Jahr ohne Zahlung), 2026 Strom 1.000 ohne Zeile.
  // Seit #267 zählt das Jahr am Abzug nicht, er steht im Jahr seiner Rechnung: 2025 leer, 2026 Strom 1.000, Abzug −200
  // und C = +200 (Abzug ohne Verweis, selbst getragen) → 1.000.
  assert.deepEqual(tax(src, 2025).expenses.items, [])
  assert.equal(tax(src, 2025).expenses.totalCents, 0)
  assert.equal(tax(src, 2026).expenses.totalCents, 100000)
  assert.equal(line(tax(src, 2026), 2026)?.amountCents, 20000)
})

test('V8: Messdienst-Anlage eines anderen Objekts zählt nicht', () => {
  const src = haus([gas(), hausstrom(), abzug('ab', 20000)], [anlage(), anlage({ id: 'hp2', propertyId: 'objekt-2', method: 'service' })], {
    properties: [
      { id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES },
      { id: 'objekt-2', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES },
    ],
  } as Partial<Source>)
  assert.equal(tax(src).expenses.totalCents, 600000)
})

test('V9: abgeschlossene Abrechnung: Zeile da, keine Position gilt als geändert', () => {
  const base = haus([gas(), hausstrom(), abzug('ab', 20000)])
  const frozen = frozenSettlementOf(settle(base))
  const closed = { ...base, closedSettlements: [{ propertyId: 'objekt-1', period: calendarPeriod(2025), ...frozen }] } as Source
  // Probe: Der eingefrorene Stand kommt wirklich an, sonst prüfte dieser Test nichts (Gegenmutation G8 überlebte zuerst).
  assert.ok(snapshotFor(closed, 'objekt-1', of(CALENDAR_RULES, '2025-01')).closedSettlement, 'kein eingefrorener Stand im Schnappschuss')
  const r = tax(closed)
  assert.equal(r.expenses.totalCents, 600000)
  assert.equal(r.closedItemsChanged, 0)
  assert.equal(r.closedSelfUseDiffers, false)
  assert.equal(line(r)?.amountCents, 20000)
})

test('V10: negativer Allgemeinstrom ohne Kennzeichnung bleibt (5.800), mit Hinweis; mit Messdienst ohne Hinweis', () => {
  const ohne = position('gut', '2025-01', -20000, { category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Heizung', key: 'units' })
  const r = tax(haus([gas(), hausstrom(), ohne]))
  assert.equal(r.expenses.totalCents, 580000)
  assert.equal(line(r), undefined)
  assert.deepEqual(r.unmarkedPowerCredits, [{ costItemId: 'gut', description: 'Abzug Heizung', amountCents: -20000 }])
  assert.equal(tax(haus([gas(), hausstrom(), ohne], [anlage({ method: 'service' })])).unmarkedPowerCredits, undefined)
  assert.equal(tax(haus([gas(), hausstrom()])).unmarkedPowerCredits, undefined)
})

test('V12: Kesseltausch, Messdienst bis 30.06., danach ohne: Abzug ohne Verweis neutral (5.800), aber als nicht eindeutig gemeldet (R-6)', () => {
  const plants = [anlage({ id: 'alt', method: 'service', endsOn: '2025-06-30' }), anlage({ id: 'hp1', replacesPlantId: 'alt' })]
  const r = tax(haus([gas(), hausstrom(), abzug('ab', 20000)], plants))
  assert.equal(r.expenses.totalCents, 580000)
  assert.equal(line(r), undefined)
  assert.deepEqual(r.operatingPowerAmbiguous, [{ costItemId: 'ab', description: 'Abzug ab', amountCents: -20000 }])
  // Durchsicht T1, T1b: daneben nur eine Etagenheizung oder eine Anlage der Gemeinschaft ohne Messdienst: eindeutig.
  const service = anlage({ method: 'service' })
  assert.equal(tax(haus([gas(), hausstrom(), abzug('ab', 20000)], [service, anlage({ id: 'etage', supply: 'perUnit' })])).operatingPowerAmbiguous, undefined)
  assert.equal(tax(haus([gas(), hausstrom(), abzug('ab', 20000)], [service, anlage({ id: 'weg', source: 'homeowners' })])).operatingPowerAmbiguous, undefined)
  // Nur Messdienst im Zeitraum: eindeutig, kein Hinweis.
  assert.equal(tax(haus([gas(), hausstrom(), abzug('ab', 20000)], [anlage({ method: 'service' })])).operatingPowerAmbiguous, undefined)
})

// ---------- Eigennutzung: privat und abziehbar (R-4) ----------
// Heizanteil der eigenen Einheit = Eigenanteil an den Heizkosten derselben Anlage in derselben Abrechnung. Ein Abzug
// ohne Verweis hat keine Anlage: dann Fläche des ganzen Gebäudes (BFH, Urteil vom 24.06.2008, IX R 26/06).

test('E: Abzug 150 ohne Verweis: 6.900 / privat 1.480 / abziehbar 5.420, Zeile nach Fläche (30/150 = 30)', () => {
  // Gas 6.000 nach Fläche: t1 2.800, t2 2.000, eigen 1.200. Strom 900 nach Einheiten: je 300. Abzug −150: je −50.
  // Heute: 6.750 / privat 1.200 + 300 − 50 = 1.450. Zeile +150, privat 150 × 30/150 = 30.
  const r = tax(eigen([gas(600000), hausstrom(90000), abzug('ab', 15000)]))
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [690000, 148000, 542000])
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.deepEqual([z.amountCents, z.privateCents, z.deductibleCents, z.allocation, z.deductiblePercent], [15000, 3000, 12000, 'area', 80])
  // Nicht in den Eigenanteil der Abrechnung.
  assert.equal(r.selfUsedShareCents, settle(eigen([gas(600000), hausstrom(90000), abzug('ab', 15000)])).selfUsedShareCents)
})

test('E2: Paar 150/150 verknüpft: keine Zeile, 6.900 / 1.480', () => {
  // Heizposition 150 nach Fläche: eigen 30. Privat 1.200 + 300 − 50 + 30 = 1.480.
  const r = tax(eigen([gas(600000), betrieb('bs', 15000), hausstrom(90000), abzug('ab', 15000, 'bs')]))
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents], [690000, 148000])
  assert.equal(line(r), undefined)
})

test('E3: Heizposition 200, Abzug 150 verknüpft: 6.900 / 1.480 statt 6.950 / 1.490', () => {
  // Heizposition 200 nach Fläche: eigen 200 × 30/150 = 40. Heute 6.000 + 900 + 200 − 150 = 6.950, privat 1.200 + 300
  // − 50 + 40 = 1.490. C = 150 − 200 = −50. Heizanteil der Anlage: (1.200 + 40) / (6.000 + 200) = 20 %; privat −10.
  const r = tax(eigen([gas(600000), betrieb('bs', 20000), hausstrom(90000), abzug('ab', 15000, 'bs')]))
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [690000, 148000, 542000])
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.deepEqual([z.amountCents, z.privateCents, z.deductibleCents, z.allocation], [-5000, -1000, -4000, 'settlement'])
})

test('E4: Heizposition 150 ohne Abzug: 6.900 / 1.500 statt 7.050 / 1.530 (wie ohne Betriebsstrom)', () => {
  // Heute 6.000 + 150 + 900 = 7.050, privat 1.200 + 30 + 300 = 1.530. C = −150, Heizanteil 20 %: privat −30.
  const r = tax(eigen([gas(600000), betrieb('bs', 15000), hausstrom(90000)]))
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [690000, 150000, 540000])
  assert.deepEqual([line(r)?.amountCents, line(r)?.privateCents], [-15000, -3000])
})

test('R-4 mit Teilnehmern: Anlage heizt EG und DG; privat nach dem Heizanteil 30 %, nicht nach der Gebäudefläche 20 %', () => {
  // Gas 6.000 nach Fläche über EG 70 und DG 30: t1 4.200, eigen 1.800. Heizposition 200 ebenso: t1 140, eigen 60.
  // Strom 900 nach Einheiten über alle drei: je 300. Abzug −150 verknüpft, wie der Strom: je −50.
  // Heute 6.950 / privat 1.800 + 300 + 60 − 50 = 2.110. C = 150 − 200 = −50.
  // Heizanteil (1.800 + 60) / (6.000 + 200) = 30 %: privat −15 → 2.095 (nach Fläche 30/150 wären es −10).
  const nurEgDg = { participantUnitIds: ['u1', 'u3'] }
  const src = eigen([gas(600000, '2025-01', nurEgDg), betrieb('bs', 20000, nurEgDg), hausstrom(90000), abzug('ab', 15000, 'bs')])
  const r = tax(src)
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [690000, 209500, 480500])
  assert.deepEqual([line(r)?.amountCents, line(r)?.privateCents], [-5000, -1500])
  // Probe: richtig gepaart (150/150) ergibt denselben privaten Teil, 1.800 + 300 + 45 − 50 = 2.095.
  const paar = tax(eigen([gas(600000, '2025-01', nurEgDg), betrieb('bs', 15000, nurEgDg), hausstrom(90000), abzug('ab', 15000, 'bs')]))
  assert.deepEqual([paar.expenses.totalCents, paar.expenses.privateCents], [690000, 209500])
})

test('R-4 mit Teilnehmern, Abzug ohne Verweis: keine Anlage zuzuordnen, also Fläche des ganzen Gebäudes (Auslegung)', () => {
  // Heute 6.750 / privat 1.800 + 300 − 50 = 2.050. C = +150, privat 150 × 30/150 = 30 → 2.080.
  const nurEgDg = { participantUnitIds: ['u1', 'u3'] }
  const r = tax(eigen([gas(600000, '2025-01', nurEgDg), hausstrom(90000), abzug('ab', 15000)]))
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents], [690000, 208000])
  assert.ok(line(r)?.steps.some((s) => s.value.includes('Auslegung')), 'der Rechenweg nennt die Auslegung')
})

test('R-4 mit zwei Anlagen: der Heizanteil der Anlage der Heizposition, nicht der aller Heizkosten', () => {
  // Kessel hp1 heizt EG (t1, 70 m²) und DG (eigen, 30 m²): Gas 3.000 → eigen 900 (30 %). Kessel hp2 heizt nur OG (t2):
  // Gas 3.000 → eigen 0. Heizposition 200 an hp1 (EG und DG), ohne Abzug → eigen 60. Strom 900 nach Einheiten: je 300.
  // Heute 7.100 / privat 900 + 60 + 300 = 1.260. C = −200; Heizanteil hp1 (900 + 60) / (3.000 + 200) = 30 % → −60.
  // Über alle Heizkosten wären es (960 / 6.200) × −200 = −30,97.
  const nurEgDg = { participantUnitIds: ['u1', 'u3'] }
  const src = eigen([
    gas(300000, '2025-01', nurEgDg),
    heizung('gas2', 300000, { description: 'Gas OG', heatingPart: 'fuel', heatingPlantId: 'hp2', participantUnitIds: ['u2'] }),
    betrieb('bs', 20000, nurEgDg), hausstrom(90000),
  ], { heatingPlants: [anlage(), anlage({ id: 'hp2', name: 'Kessel OG' })] } as Partial<Source>)
  const r = tax(src)
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents], [690000, 120000])
  assert.deepEqual([line(r)?.amountCents, line(r)?.privateCents], [-20000, -6000])
})

test('Mai bis April mit Eigennutzung: der Eigenanteil laut Abrechnung enthält die abgeleitete Zeile nicht', () => {
  // EG 50 m² (t1), DG 50 m² eigen. Zeitraum ab Mai 2025, alles im Steuerjahr 2025. Gas 4.000 nach Fläche → eigen
  // 2.000; Strom 1.000 nach Einheiten → eigen 500; Abzug −200 verknüpft → eigen −100; Heizposition 300 nach Fläche
  // → eigen 150. Eigenanteil laut Abrechnung 2.000 + 500 − 100 + 150 = 2.550. C = 200 − 300 = −100, Heizanteil
  // (2.000 + 150) / (4.000 + 300) = 50 % → −50, verhältnismäßig „laut Abrechnung“, aber keine Position der Abrechnung.
  const MAI: PeriodRules = { startMonth: 5, changes: [] }
  const src = haus([
    gas(400000, '2025-05'), betrieb('bs', 30000, {}, '2025-05'), hausstrom(100000, '2025-05'), abzug('ab', 20000, 'bs', {}, '2025-05'),
  ], [anlage()], {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: MAI }],
    units: [
      { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true },
      { id: 'u3', propertyId: 'objekt-1', name: 'DG', areaM2: 50, participates: false, selfUsed: true, selfPersons: 1 },
    ],
    tenancies: [mieter('t1', 'u1')],
  } as Partial<Source>)
  const r = tax(src)
  assert.equal(r.income.prepaymentSettlementCents, null, 'kein Zeitraum gleich dem Kalenderjahr')
  assert.deepEqual([line(r)?.amountCents, line(r)?.privateCents, line(r)?.allocation], [-10000, -5000, 'settlement'])
  assert.equal(r.selfUsedShareCents, 255000)
})

// Verschiedene Steuerjahre (#268, Auftrag zum früheren Hinweis `heating.operating-power-tax-year` und zum Satz der
// Vorschau „in der Anlage V verschiebt sich dieser Betrag“): Steht der Abzug in einem anderen Steuerjahr als seine
// Heizposition, verschiebt sich nichts mehr. Jedes Jahr zeigt die in ihm bezahlten Rechnungen, und die Zahlen gleichen
// denen eines Paars im selben Jahr, auch der private Teil.
test('Verschiedene Steuerjahre: Abzug 2025, Heizposition 2026, ohne Eigennutzung jedes Jahr die bezahlten Rechnungen', () => {
  // 2025: Gas 5.000 + Strom 1.000 − Abzug 100 + C 100 = 6.000 (bis #268: 5.900). 2026: Gas 5.000 + Heizposition 100
  // + C −100 = 5.000 (bis #268: 5.100). Bezahlt: 6.000 und 5.000.
  const getrennt = haus([gas(), hausstrom(), abzug('ab', 10000, 'bs'), gas(500000, '2026-01'), betrieb('bs', 10000, {}, '2026-01')])
  assert.deepEqual([tax(getrennt, 2025).expenses.totalCents, tax(getrennt, 2026).expenses.totalCents], [600000, 500000])
  const zusammen = haus([gas(), hausstrom(), abzug('ab', 10000, 'bs'), betrieb('bs', 10000), gas(500000, '2026-01')])
  assert.deepEqual([tax(zusammen, 2025).expenses.totalCents, tax(zusammen, 2026).expenses.totalCents], [600000, 500000])
})

test('Verschiedene Steuerjahre mit Eigennutzung: privat je Jahr wie beim Paar im selben Jahr (1.480 und 1.200)', () => {
  // EG 70 (t1), OG 50 (t2), DG 30 eigen. Gas 6.000 je Jahr nach Fläche (eigen 1.200), Strom 900 in 2025 nach Einheiten
  // (eigen 300). Abzug −150 in 2025 nach Einheiten (eigen −50), verknüpft mit der Heizposition 150 in 2026 (eigen 30).
  // 2025: 6.000 + 900 − 150 + C 150 = 6.900; privat 1.200 + 300 − 50 + 150 × 20 % = 1.480.
  // 2026: 6.000 + 150 + C −150 = 6.000; privat 1.200 + 30 − 150 × (1.230 / 6.150 = 20 %) = 1.200.
  const getrennt = tax2(eigen([gas(600000), hausstrom(90000), abzug('ab', 15000, 'bs'), gas(600000, '2026-01'), betrieb('bs', 15000, {}, '2026-01')]))
  const zusammen = tax2(eigen([gas(600000), hausstrom(90000), abzug('ab', 15000, 'bs'), betrieb('bs', 15000), gas(600000, '2026-01')]))
  assert.deepEqual(getrennt, [[690000, 148000], [600000, 120000]])
  assert.deepEqual(zusammen, getrennt)
})

test('Verschiedene Steuerjahre, Heizschlüssel nach Einheiten (Durchsicht M1, T12): der Verweis ins andere Jahr wird aufgelöst, privat nach dem Heizanteil 1/3', () => {
  // Nach Flächen wären es 20 %, nach dem Heizanteil 1/3: Hier unterscheiden sich beide.
  // Gas 6.000 je Jahr nach Einheiten → eigen 2.000. Strom 900 in 2025 nach Einheiten → 300. Abzug −150 in 2025 → −50,
  // verknüpft mit der Heizposition 150 (nach Einheiten) in 2026 → eigen 50.
  // 2025: 6.900; privat 2.000 + 300 − 50 + 150 × 2.000/6.000 = 2.300 (nach Fläche wären es 2.280).
  // 2026: 6.000; privat 2.000 + 50 − 150 × 2.050/6.150 = 2.000.
  const units = { key: 'units' as const }
  const getrennt = tax2(eigen([gas(600000, '2025-01', units), hausstrom(90000), abzug('ab', 15000, 'bs'), gas(600000, '2026-01', units), betrieb('bs', 15000, units, '2026-01')]))
  const zusammen = tax2(eigen([gas(600000, '2025-01', units), hausstrom(90000), abzug('ab', 15000, 'bs'), betrieb('bs', 15000, units), gas(600000, '2026-01', units)]))
  assert.deepEqual(zusammen, [[690000, 230000], [600000, 200000]])
  assert.deepEqual(getrennt, zusammen)
})
const tax2 = (src: Source) => [2025, 2026].map((y) => [tax(src, y).expenses.totalCents, tax(src, y).expenses.privateCents])

test('K2: abgeschlossene Abrechnung, danach DG größer erfasst: privater Teil der Zeile aus dem eingefrorenen Heizanteil', () => {
  // E3 (Heizposition 200, Abzug 150 verknüpft), abgeschlossen mit DG 30 m²: eingefroren Gas eigen 1.200, Heizposition
  // eigen 40, Heizanteil (1.200 + 40) / 6.200 = 20 %, Zeile C = −50 → privat −10.
  // Danach DG mit 60 m² erfasst (zusammen 180 m²): heute wären es Gas 6.000 × 60/180 = 2.000 und Heizposition 66,67,
  // Heizanteil 2.066,67 / 6.200 = 33,3 % → privat −16,67. Es gilt der eingefrorene Stand, also −10.
  const base = eigen([gas(600000), betrieb('bs', 20000), hausstrom(90000), abzug('ab', 15000, 'bs')])
  const frozen = frozenSettlementOf(settle(base))
  const units = (base.units ?? []).map((u) => (u.id === 'u3' ? { ...u, areaM2: 60 } : u))
  const later = { ...base, units, closedSettlements: [{ propertyId: 'objekt-1', period: calendarPeriod(2025), ...frozen }] } as Source
  assert.ok(snapshotFor(later, 'objekt-1', of(CALENDAR_RULES, '2025-01')).closedSettlement, 'kein eingefrorener Stand im Schnappschuss')
  const r = tax(later)
  assert.equal(r.closedSelfUseDiffers, true, 'heute rechnet die Abrechnung anders')
  assert.equal(r.closedItemsChanged, 0)
  assert.deepEqual([line(r)?.amountCents, line(r)?.privateCents, line(r)?.deductibleCents], [-5000, -1000, -4000])
  // Gegenprobe ohne Abschluss: der heutige Heizanteil.
  assert.equal(line(tax({ ...base, units } as Source))?.privateCents, -1667)
})

test('E ohne Fläche der eigenen Einheit: Zeile nicht aufteilbar, privat 0', () => {
  const src = eigen([gas(600000), hausstrom(90000), abzug('ab', 15000)])
  const units = (src.units ?? []).map((u) => (u.id === 'u3' ? { ...u, areaM2: 0 } : u))
  const r = tax({ ...src, units } as Source)
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.deepEqual([z.allocation, z.privateCents, z.deductibleCents], ['unsplittable', 0, 15000])
})

test('Ohne selbstgenutzte Einheit ist an der Zeile nichts privat, auch mit Vorzeichen', () => {
  const r = tax(haus([gas(), betrieb('bs', 30000), hausstrom(), abzug('ab', 20000, 'bs')]))
  assert.deepEqual([line(r)?.privateCents, line(r)?.deductibleCents], [0, -10000])
})

// ---------- #267: Der Abzug steht im Steuerjahr seiner Stromrechnung (#255, PR 2, Plan E5, Beispiel B2) ----------
// Der Abzug ist keine Zahlung, sondern ein Ausschnitt der bezahlten Stromrechnung. Stand er in einem anderen Jahr als
// sie, blieb dort ein privater Rest, obwohl in dem Jahr nichts bezahlt wurde: Sein privater Teil geht nach dem Schlüssel
// der Stromrechnung, der des Ausgleichs nach dem Heizanteil. Seit #267 nimmt er das Jahr seiner Rechnung, abgeleitet über
// `outflowShares` (outflow.ts) und nicht gespeichert.

// B2: EG 70 m² (t1), OG 50 m² (t2), DG 30 m² selbstgenutzt. Allgemeinstrom 1.000 € (Abrechnung 2025, bezahlt 2026, nach
// Fläche, eigen 20 %). Abzug −200 € im selben Zeitraum, verknüpft mit der Heizposition 200 € in 2026 (nach Einheiten
// wie das Gas 2026, Heizanteil 1/3). Der Kalenderzeitraum mit einem anderen Jahr der Zahlung kommt erst mit PR 3 in die
// Datenbank; die Rechnung nimmt ihn schon heute so, wie er im Schnappschuss steht.
const b2 = (stromKey: string, stromYear?: number) => eigen([
  hausstrom(100000, stromKey, { key: 'area', ...(stromYear !== undefined ? { taxYear: stromYear } : {}) }),
  abzug('ab', 20000, 'bs', { key: 'area' }, stromKey),
  gas(600000, '2026-01', { key: 'units' }), betrieb('bs', 20000, { key: 'units' }, '2026-01'),
])

test('#267, B2: Abzug in der Abrechnung 2025, Stromrechnung 2026 bezahlt: 2025 ohne Betrag und ohne privaten Rest', () => {
  // Bis #267 standen in 2025 der Abzug −200 (privat −40) und ein Ausgleich +200 (privat +40, nach Fläche, weil 2025 keine
  // Heizkosten hat): Betrag 0 in einem Jahr ohne Zahlung, und in 2026 fehlte dafür ein Ausgleich −200 mit privat −66,67
  // nach dem Heizanteil (nächster Test). Jetzt steht der Abzug mit seiner Rechnung in 2026, und 2025 ist leer.
  const r = tax(b2('2025-01', 2026), 2025)
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [0, 0, 0])
  assert.deepEqual(r.expenses.items.map((i) => i.costItemId), [])
})

test('#267, B2: in 2026 stehen Rechnung, Abzug und Heizposition zusammen, mit denselben Zahlen wie bei einer Stromrechnung der Abrechnung 2026', () => {
  // 2026: Gas 6.000 (eigen 2.000), Strom 1.000 (eigen 200), Abzug −200 (eigen −40), Heizposition 200 (eigen 66,67);
  // der Ausgleich ist 0, eine Zeile gibt es nicht. Dieselben Zahlen wie mit Strom und Abzug in der Abrechnung 2026:
  // 7.000 / privat 2.226,67 / abziehbar 4.773,33 (bis #267: privat 2.200, abziehbar 4.800).
  const r = tax(b2('2025-01', 2026), 2026)
  const vergleich = tax(b2('2026-01'), 2026)
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents],
    [vergleich.expenses.totalCents, vergleich.expenses.privateCents, vergleich.expenses.deductibleCents])
  assert.deepEqual([r.expenses.totalCents, r.expenses.privateCents, r.expenses.deductibleCents], [700000, 222667, 477333])
  assert.equal(line(r, 2026), undefined, 'kein Ausgleich: Abzug und Heizposition im selben Jahr')
  assert.deepEqual(r.expenses.items.map((i) => i.costItemId).sort(), ['ab', 'bs', 'gas2026', 'hs'])
})

test('#267, B2 mit Heizkosten in 2025: kein privater Rest im Jahr ohne Stromzahlung, und 2026 wie mit der Rechnung im selben Jahr', () => {
  // Wie Beispiel B2 im Plan, wo der Rest −20 € beträgt: Hat die Anlage auch 2025 Heizkosten (Gas nach Einheiten, eigen 1/3),
  // ging der Ausgleich in 2025 nach dem Heizanteil und der Abzug nach Fläche (eigen 20 %). Bis #267 stand in 2025 deshalb
  // ein privater Rest von 66,67 − 40,00 = 26,67 € neben einem Betrag von 0, und 2026 fehlte er. Jetzt hat 2025 nur das Gas.
  const mitGas2025 = (stromYear?: number) => eigen([...b2('2025-01', stromYear).costItems, gas(300000, '2025-01', { key: 'units' })])
  const ohneStrom = eigen([gas(300000, '2025-01', { key: 'units' })])
  const r2025 = tax(mitGas2025(2026), 2025)
  assert.deepEqual(r2025.expenses.items.map((i) => i.costItemId), ['gas2025'])
  assert.deepEqual([r2025.expenses.totalCents, r2025.expenses.privateCents, r2025.expenses.deductibleCents],
    [tax(ohneStrom, 2025).expenses.totalCents, tax(ohneStrom, 2025).expenses.privateCents, tax(ohneStrom, 2025).expenses.deductibleCents])
  assert.deepEqual([r2025.expenses.totalCents, r2025.expenses.privateCents], [300000, 100000])
  const r2026 = tax(mitGas2025(2026), 2026)
  assert.deepEqual([r2026.expenses.totalCents, r2026.expenses.privateCents, r2026.expenses.deductibleCents], [700000, 222667, 477333])
})

test('#267: Ein gespeichertes Jahr am Abzug, das von seiner Stromrechnung abweicht, zählt nicht (Mai bis April)', () => {
  // Stromrechnung 2025/26 bezahlt 2026, der Abzug trägt (aus der Zeit vor #267) 2025. Er steht trotzdem in 2026.
  const MAI: PeriodRules = { startMonth: 5, changes: [] }
  const src = eigen([
    hausstrom(100000, '2025-05', { key: 'area', taxYear: 2026 }), abzug('ab', 20000, undefined, { key: 'area', taxYear: 2025 }, '2025-05'),
  ], { properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: MAI }] } as Partial<Source>)
  assert.deepEqual(tax(src, 2025).expenses.items.map((i) => i.costItemId), [])
  assert.deepEqual(tax(src, 2026).expenses.items.map((i) => i.costItemId).sort(), ['ab', 'hs', LINE(2026)].sort())
  // Die Auskunft je Abzug im Schnappschuss sagt dasselbe Jahr.
  const snap = snapshotFor(src, 'objekt-1', of(MAI, '2025-05'))
  assert.deepEqual(snap.operatingPowerDeductions?.map((d) => [d.id, d.taxYear]), [['ab', 2026]])
})

// ---------- Wortlaut der Zeile je Lage (Durchsicht S1, K1) ----------
const texts = (r: TaxReport, year = 2025) => (line(r, year)?.steps ?? []).map((x) => `${x.label}: ${x.value}`).join('\n')

test('S1: Paar über zwei Steuerjahre (M2) heißt neutral, nennt den Verweis und rät zu nichts', () => {
  const src = haus([gas(), hausstrom(), abzug('ab', 20000, 'bs'), gas(500000, '2026-01'), betrieb('bs', 20000, {}, '2026-01')])
  for (const year of [2025, 2026]) {
    const r = tax(src, year)
    const z = line(r, year) ?? assert.fail(`keine Zeile ${year}`)
    assert.equal(z.description, 'Betriebsstrom der Heizung, Ausgleich')
    assert.equal(r.operatingPowerBalanceKind, 'otherYear')
    const t = texts(r, year)
    assert.doesNotMatch(t, /ohne Verweis|selbst|Prüfen Sie/, t)
    assert.match(t, /in verschiedenen Steuerjahren/, t)
  }
  assert.match(texts(tax(src, 2025)), /„Abzug ab“ 200,00 €, verknüpft mit der Heizposition „Betriebsstrom bs“ in einem anderen Steuerjahr/)
  assert.match(texts(tax(src, 2026), 2026), /„Betriebsstrom bs“ 200,00 €, steckt auch in der Stromrechnung; ihr Abzug steht in einem anderen Steuerjahr/)
})

test('S1: V11 (verknüpfter Abzug 200 über der Heizposition 100) unterstellt kein Selbsttragen, sagt aber „prüfen“', () => {
  const r = tax(haus([gas(), betrieb('bs', 10000), hausstrom(), abzug('ab', 20000, 'bs')]))
  assert.equal(r.operatingPowerBalanceKind, 'mismatch')
  assert.equal(line(r)?.description, 'Betriebsstrom der Heizung, Ausgleich')
  const t = texts(r)
  assert.doesNotMatch(t, /selbst/, t)
  assert.match(t, /Prüfen Sie in der Abrechnung, ob der Abzug beim Allgemeinstrom zum Betriebsstrom passt\./)
})

test('S1: Abzug ohne Verweis (V1) und Paar plus freier Abzug (V6) heißen „selbst getragen“; K1: kein „-0,00“', () => {
  for (const src of [haus([gas(), hausstrom(), abzug('ab', 20000)]), haus([gas(), betrieb('bs', 12000), hausstrom(), abzug('ab1', 12000, 'bs'), abzug('ab2', 8000)])]) {
    const r = tax(src)
    assert.equal(r.operatingPowerBalanceKind, 'kept')
    assert.equal(line(r)?.description, 'Betriebsstrom der Heizung, selbst getragen')
    const t = texts(r)
    assert.match(t, /tragen ihn selbst/)
    assert.doesNotMatch(t, /-0,00|−0,00|Prüfen Sie/, t)
  }
})

test('S1: freier Abzug neben einem Paar über zwei Steuerjahre: gemischt, ohne „prüfen“', () => {
  const src = haus([gas(), hausstrom(), abzug('frei', 5000), abzug('ab', 20000, 'bs'), gas(500000, '2026-01'), betrieb('bs', 20000, {}, '2026-01')])
  const r = tax(src)
  assert.equal(r.operatingPowerBalanceKind, 'mixed')
  assert.equal(line(r)?.amountCents, 25000)
  assert.equal(line(r)?.description, 'Betriebsstrom der Heizung, Ausgleich')
  assert.doesNotMatch(texts(r), /Prüfen Sie/)
})

// ---------- Nachprüfung zu #268, N2 und N3 ----------

test('N2: verschieden hoch neben einem Abzug ohne Verweis: „prüfen“ gilt dem Paar, der freie Teil heißt selbst getragen', () => {
  // C = 200 + 50 − 100 = 150; davon 50 ohne Verweis, selbst getragen.
  const r = tax(haus([gas(), betrieb('bs', 10000), hausstrom(), abzug('ab', 20000, 'bs'), abzug('frei', 5000)]))
  assert.equal(r.operatingPowerBalanceKind, 'mismatch')
  assert.equal(r.operatingPowerKeptCents, 5000)
  assert.equal(line(r)?.amountCents, 15000)
  const t = texts(r)
  assert.match(t, /Davon tragen Sie 50,00 € selbst \(Abzug ohne Verweis\); dieser Teil ist richtig erfasst\./, t)
  assert.match(t, /Prüfen Sie in der Abrechnung, ob der verknüpfte Abzug beim Allgemeinstrom zum Betriebsstrom passt\./, t)
  // Ohne freien Abzug kein solcher Satz, und das Feld fehlt.
  const ohne = tax(haus([gas(), betrieb('bs', 10000), hausstrom(), abzug('ab', 20000, 'bs')]))
  assert.equal(ohne.operatingPowerKeptCents, undefined)
  assert.doesNotMatch(texts(ohne), /Davon tragen Sie/)
})

test('N3: Abzug mit Verweis auf eine Position, die nicht als Betriebsstrom gekennzeichnet ist, ist ein Verweisfehler und kein anderes Steuerjahr', () => {
  // Der Abzug zeigt auf das Gas (Brennstoff, nicht `included`). Die Zahl bleibt: C = 200.
  const r = tax(haus([gas(), hausstrom(), abzug('ab', 20000, 'gas2025')]))
  assert.equal(line(r)?.amountCents, 20000)
  assert.equal(r.operatingPowerBalanceKind, 'mismatch')
  const t = texts(r)
  assert.doesNotMatch(t, /anderen Steuerjahr|verschiedenen Steuerjahren/, t)
  assert.match(t, /„Abzug ab“ 200,00 €, verknüpft mit „Gas“, die nicht als Betriebsstrom in den Heizkosten gekennzeichnet ist/, t)
  // Verweis auf eine Position, die es im Objekt nicht gibt.
  const weg = tax(haus([gas(), hausstrom(), abzug('ab', 20000, 'gibt-es-nicht')]))
  assert.equal(weg.operatingPowerBalanceKind, 'mismatch')
  assert.match(texts(weg), /„Abzug ab“ 200,00 €, verknüpft mit einer Position, die Mietfuchs nicht findet/)
  // Die Heizposition `included` in einem anderen Jahr bleibt ein Paar über zwei Steuerjahre.
  const paar = tax(haus([gas(), hausstrom(), abzug('ab', 20000, 'bs'), gas(500000, '2026-01'), betrieb('bs', 20000, {}, '2026-01')]))
  assert.equal(paar.operatingPowerBalanceKind, 'otherYear')
})

// ---------- Heizanteil außerhalb 0…1 (Integrationsdurchsicht vor 0.11.0, M1) ----------

test('M1: Gutschrift mit eigenem Schlüssel macht den Heizanteil unbrauchbar (875 %); dann gilt die Fläche, privat −15,00 statt −262,50', () => {
  // A 50 m² vermietet (t1), B 50 m² selbstgenutzt. Gas 1.000 nach Fläche (B 500), Gutschrift Gas −990 nach Einheiten nur
  // für A (B 0), Betriebsstrom 50 „steckt auch in der Stromrechnung“ (B 25), Hausstrom 400, Abzug 20 verknüpft.
  // C = 20 − 50 = −30. Heizanteil (500 + 25) / (1.000 − 990 + 50) = 525 / 60 = 875 %: privat −262,50, abziehbar
  // +232,50. Erwartet: privat zwischen −30 und 0; die Quote taugt nicht, also wie beim Abzug ohne Verweis nach der
  // Fläche des Gebäudes, 50 / 100: privat −15,00, abziehbar −15,00.
  const units = [
    { id: 'u1', propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'B', areaM2: 50, participates: false, selfUsed: true, selfPersons: 1 },
  ]
  const src = haus([
    gas(100000), heizung('gut', -99000, { description: 'Gutschrift Gas', heatingPart: 'fuel', key: 'units', participantUnitIds: ['u1'] }),
    betrieb('bs', 5000, { key: 'area' }), hausstrom(40000, '2025-01', { key: 'area' }), abzug('ab', 2000, 'bs', { key: 'area' }),
  ], [anlage()], { units, tenancies: [mieter('t1', 'u1')] } as Partial<Source>)
  const r = tax(src)
  const z = line(r) ?? assert.fail('keine Zeile')
  assert.deepEqual([z.amountCents, z.privateCents, z.deductibleCents, z.allocation], [-3000, -1500, -1500, 'area'])
  const t = texts(r)
  assert.doesNotMatch(t, /875/, t)
  assert.match(t, /Heizanteil/, t)
  // Gesamt bleibt in sich stimmig.
  assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents)
  // Durchsicht #297 K3: Gutschrift über der Rechnung (netto ≤ 0): ebenfalls Fläche, und die Begründung nennt den Heizanteil,
  // nicht einen Abzug ohne Verweis.
  const ueber = { ...src, costItems: src.costItems.map((c) => (c.id === 'gut' ? { ...c, amountCents: -110000 } : c)) }
  const t2 = texts(tax(ueber))
  assert.match(t2, /Heizanteil der Anlage taugt hier nicht/, t2)
  assert.doesNotMatch(t2, /denn ein Abzug ohne Verweis/, t2)
})
