// Brennstofflieferungen im Schnappschuss und in der Abrechnung (Heizung PR 7, Entwurf 5.8, 8.2, 12.2,
// 12.3). Ein Haus mit zwei Wohnungen, Objekt von Mai bis April, eine Gasheizung mit freien Schlüsseln;
// die Gasrechnung 15.03.2025–14.03.2026 über 6.500 € steht in der Heizperiode 2025/2026.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { frozenFuelRowsOf, snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
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
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: periodKey('2025-05'), category: HEATING_CATEGORY, description: 'Gas', amountCents: 650000, key: 'area',
  heatingPlantId: 'hp', fuelDeliveryId: 'd', ...over,
})
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: `Mieter ${unitId.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
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
  assert.deepEqual(s.fuel?.closed, [{ plantId: 'hp', period: '2024-05', label: '2024/2025', deadline: '2026-04-30', fuelRows: frozenFuelRowsOf(zeilen) }])
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
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  assert.equal(summe(h), 650000)
  const zeile = h.statements[0]?.rows.find((row) => row.kind === 'fuelCarry') ?? assert.fail('keine Übertragszeile')
  assert.equal(zeile.description, 'Gas: Anteil für 2024/2025 (voriger Zeitraum)')
  assert.deepEqual(zeile.steps?.[0], { label: 'Anteil der Rechnung', value: '6.500,00 € × 151,29 ‰ (nach der Gradtagszahlentabelle) = 983,39 €', term: 'degreeDays' })
  const h1 = settle('2024-05')
  assert.deepEqual([anteilVon(h1, 'ta', 'fuel:d:'), anteilVon(h1, 'tb', 'fuel:d:')], [59003, 39336])
  assert.deepEqual(teileVon(h1, 'fuel:d:2024-05'), [{ reason: 'fuelCarry', cents: -98339 }])
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
  assert.deepEqual(teileVon(vorher, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: 7565 }])
  assert.equal(summe(vorher), 650000)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /war 907,74 € geschätzt; tatsächlich entfallen 983,39 €\. Die Differenz von 75,65 € steht bei Ihnen\./)
  assert.match(textOf(vorher, 'fuel.estimate-settled'), /berichtigten Abrechnung 2024\/2025; sie muss den Mietern bis 30\.04\.2026 zugehen/)
  const nachher = settle('2025-05', ueber, '2026-06-01')
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /am 30\.04\.2026 abgelaufen\. Nachfordern dürfen Sie nur, wenn Sie die Verspätung nicht zu vertreten haben/)
  assert.match(textOf(nachher, 'fuel.estimate-settled'), /in der Regel binnen drei Monaten/)
})

test('Fall c: ohne Schätzung abgeschlossen; 983,39 € beim Vermieter mit Hinweis', () => {
  const h = settle('2025-05', { closedSettlements: [abgeschlossen('2024-05')] })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelClosedPeriod', cents: 98339 }])
  assert.match(textOf(h, 'fuel.closed-period-part'), /für 2024\/2025 \(983,39 €\) gehört in die Abrechnung 2024\/2025, die ohne Schätzung abgeschlossen wurde\. Sie tragen ihn selbst\./)
  assert.equal(summe(h), 650000)
})

test('Fall e: Schätzung 1.050,00 € zu hoch; −66,61 € und die Gutschrift je Mieter', () => {
  const h = settle('2025-05', {
    fuelDeliveries: [lieferung(), schaetzung(105000)],
    fuelCarryFrozen: [eingefroren('e', '2024-05', 105000)],
    closedSettlements: [abgeschlossen('2024-05', { fuelCarryRows: zeilenDerSchaetzung(63000, 42000) })],
  })
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 105000 }, { reason: 'fuelEstimateDiff', cents: -6661 }])
  const n = h.notices.find((x) => x.code === 'fuel.estimate-overcharged') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /haben 66,61 € zu viel getragen, hier: Mieter A \(A\) 39,97 € und Mieter B \(B\) 26,64 €\. Eine Gutschrift ist jederzeit zulässig und wird empfohlen\./)
  assert.equal(summe(h), 650000)
})

test('Fall f: H−1 wieder offen; die Schätzung zählt nicht mehr, H−1 bucht die echte Rechnung herein (Review Focus 3)', () => {
  const ueber = { fuelDeliveries: [lieferung(), schaetzung(90774)] }
  assert.deepEqual(teileVon(settle('2025-05', ueber), 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
  const h1 = settle('2024-05', ueber)
  assert.equal(anteilVon(h1, 'ta', 'fuel:e:'), 0)
  assert.equal(anteilVon(h1, 'ta', 'fuel:d:'), 59003)
  assert.ok(!codes(h1).includes('fuel.estimated'))
})

test('Gutschrift derselben Rechnung: beide Positionen im selben Verhältnis, Summe bleibt (Review Focus 1)', () => {
  const ueber = { costItems: [position({ id: 'gas', amountCents: 700000 }), position({ id: 'gs', description: 'Gutschrift Gas', amountCents: -50000 })] }
  const h = settle('2025-05', ueber)
  assert.equal(summe(h), 650000)
  assert.deepEqual(teileVon(h, 'fuel:d:2025-05'), [{ reason: 'fuelCarry', cents: 98339 }])
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
  assert.equal(textOf(h, 'fuel.uncovered'), 'Heizanlage „Gas“, Heizperiode 2025/2026: Für 15.03.–30.04.2026 (47 Tage, 151,3 ‰ der Gradtage) fehlt eine Rechnung. Tragen Sie die Folgerechnung ein oder lesen Sie den Gaszähler zum 30.04.2026 ab.')
  assert.deepEqual(h.notices.find((n) => n.code === 'fuel.uncovered')?.subject, { kind: 'heatingCosts', id: 'hp' })
  const fuel = h.heating?.[0]?.fuel ?? assert.fail('keine Bewertung')
  assert.equal(fuel.coveragePermille.toFixed(2), '848.71')
  assert.deepEqual(fuel.carries, [{ deliveryId: 'd', period: '2024-05', cents: -98339 }])
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
  assert.ok(!codes(ets).some((c) => c.startsWith('co2.')))
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
