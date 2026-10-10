// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1): Steckt der Betriebsstrom einer
// Heizposition auch in der Stromrechnung des Hauses, muss dort ein Abzug in gleicher Höhe stehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { operatingPowerFindings } from '../src/operatingPower.ts'
import { deductionsOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { CostItem, OperatingPowerDeduction, PeriodKey } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2')],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const betriebsstrom: SnapshotCostItem = { id: 'bs', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung', amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included' }
const hausstrom: SnapshotCostItem = { id: 'strom', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }
const abzug = (cents: number, id = 'ab', period = '2025-01', closed: OperatingPowerDeduction['closed'] = null): OperatingPowerDeduction =>
  ({ id, itemId: 'bs', period: periodKey(period), description: 'Abzug Betriebsstrom Heizung', amountCents: -cents, closed })
const settle = (items: SnapshotCostItem[], deductions: OperatingPowerDeduction[]) =>
  computeSettlement({ ...snapshotOfPeriod(haus(items), P, previousPeriod(CALENDAR_RULES, P)), operatingPowerDeductions: deductions })
const codes = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-double')

test('Ohne Abzug: warning mit Betrag, der doppelt verteilt wird', () => {
  const s = settle([betriebsstrom, hausstrom], [])
  const [n, ...rest] = codes(s)
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'bs' })
  assert.match(n.text, /„Betriebsstrom Heizung“/)
  assert.match(n.text, /abgezogen sind dort 0,00 € statt 147,84 €/)
  assert.match(n.text, /147,84 € werden damit doppelt verteilt/)
  assert.match(n.text, /V ZR 166\/15/)
  // P-K3: auch der Warmwasseranteil (§ 8 Abs. 2 HeizkostenV).
  assert.match(n.text, /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV/)
  // P-K5 mit R2-K3: Selbst tragen ist zulässig, aber nur, wenn der Betriebsstrom aus den Heizkosten herausgeht.
  assert.match(n.text, /oder nehmen Sie den Betriebsstrom aus den Heizkosten heraus und tragen ihn selbst/)
  assert.ok(s.warnings.includes(n.text))
})

// P-W3 mit R2-W2: Ein Abzug in einer abgeschlossenen Abrechnung zählt nur mit dem, was im eingefrorenen
// Stand steht; vier Zustände, je eigener Satz.
test('Abzug in einer abgeschlossenen Abrechnung: gutgeschrieben zählt, ohne Hinweis', () => {
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2024-01', { label: '2024', state: 'credited' })])).length, 0)
})

test('Abzug in einer abgeschlossenen Abrechnung: nicht im eingefrorenen Stand → nicht gutgeschrieben, wieder öffnen, Grenze der Nachforderung', () => {
  const n = codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2024-01', { label: '2024', state: 'missing' })]))[0] ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /abgezogen sind dort 0,00 € statt 147,84 €/)
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ \(147,84 €\) steht in der abgeschlossenen Abrechnung 2024, aber nicht in ihrem eingefrorenen Stand; den Mietern ist er nicht gutgeschrieben/)
  assert.match(n.text, /Öffnen Sie die Abrechnung 2024 wieder und stellen Sie sie neu zu/)
  // R2-K4: Nach Ablauf der Frist keine höhere Nachforderung.
  assert.match(n.text, /Nach Ablauf der Abrechnungsfrist darf die neue Abrechnung keine höhere Nachforderung enthalten als die zugestellte \(§ 556 Abs\. 3 Satz 3 BGB\)/)
})

test('Abzug in einer abgeschlossenen Abrechnung: unlesbarer Stand → unbekannt, keine Aufforderung zur neuen Zustellung, Warnung bleibt', () => {
  const n = codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2024-01', { label: '2024', state: 'unknown' })]))[0] ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ \(147,84 €\) steht in der abgeschlossenen Abrechnung 2024; ob er dort gutgeschrieben ist, lässt sich aus dem eingefrorenen Stand nicht lesen\. Prüfen Sie die zugestellte Abrechnung\./)
  assert.doesNotMatch(n.text, /nicht gutgeschrieben/)
  assert.doesNotMatch(n.text, /stellen Sie sie neu zu/)
})

test('Abzug in einer abgeschlossenen Abrechnung: Betrag nach dem Abschluss geändert → gezählt wird der eingefrorene Betrag', () => {
  // Eingefroren: 100,00 €; heute 147,84 €. Gutgeschrieben sind 100,00 €; 47,84 € werden doppelt verteilt.
  const n = codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2024-01', { label: '2024', state: 'changed', frozenCents: -10000 })]))[0] ?? assert.fail('kein Hinweis')
  assert.match(n.text, /abgezogen sind dort 100,00 € statt 147,84 €; 47,84 € werden damit doppelt verteilt/)
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ steht in der abgeschlossenen Abrechnung 2024 mit einem anderen Betrag; gutgeschrieben sind dort 100,00 € statt 147,84 €/)
  assert.doesNotMatch(n.text, /nicht gutgeschrieben/)
  // Gleicht der eingefrorene Betrag den Betriebsstrom aus, gibt es keinen Hinweis.
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(20000, 'ab', '2024-01', { label: '2024', state: 'changed', frozenCents: -14784 })])).length, 0)
})

// P-W2: Ein von Hand erfasster Abzug zählt, sobald er verknüpft ist; unverknüpft bleibt die Warnung.
test('Handabzug: verknüpft keine Warnung, unverknüpft die Warnung (über deductionsOf, wie snapshotFor)', () => {
  const p = (c: SnapshotCostItem): SnapshotCostItem & { propertyId: string } => ({ ...c, propertyId: 'o1' })
  const hand: SnapshotCostItem = { ...hausstrom, id: 'hand', description: 'Abzug Heizstrom, Bruchteil der Brennstoffkosten', amountCents: -14784 }
  const verknuepft: SnapshotCostItem = { ...hand, operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  const mit = deductionsOf([p(betriebsstrom), p(hausstrom), p(verknuepft)], 'o1', [], CALENDAR_RULES)
  assert.equal(codes(settle([betriebsstrom, hausstrom, verknuepft], mit)).length, 0)
  const ohne = deductionsOf([p(betriebsstrom), p(hausstrom), p(hand)], 'o1', [], CALENDAR_RULES)
  assert.equal(codes(settle([betriebsstrom, hausstrom, hand], ohne)).length, 1)
})

// P-W1: Die Grundlage der Schätzung steht im Rechenweg jeder Zeile der Position (nur in der Oberfläche,
// CalcSteps ist `no-print`), am Betriebsstrom wie am Abzug.
test('Rechenweg: „Grundlage der Schätzung“ an Betriebsstrom und Abzug, ohne Grundlage kein Schritt', () => {
  const grundlage = 'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh\nzusammen 158,4 kWh von 3.000 kWh der Stromrechnung = 5,28 %'
  const bs = { ...betriebsstrom, operatingPowerBasis: grundlage }
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: grundlage }
  const s = settle([bs, hausstrom, ab], [abzug(14784)])
  const stepsOf = (id: string) => s.statements.flatMap((st) => st.rows).filter((r) => r.costItemId === id).flatMap((r) => r.steps ?? [])
  for (const id of ['bs', 'ab']) {
    assert.ok(stepsOf(id).length > 0, `${id}: keine Zeile`)
    const step = stepsOf(id).find((x) => x.label === 'Grundlage der Schätzung') ?? assert.fail(`${id}: kein Schritt`)
    assert.equal(step.value, 'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh; zusammen 158,4 kWh von 3.000 kWh der Stromrechnung = 5,28 %')
    assert.equal(step.term, 'operatingPower')
  }
  assert.ok(!stepsOf('strom').some((x) => x.label === 'Grundlage der Schätzung'))
})

test('Abzug in gleicher Höhe: kein Hinweis; jeder zahlt den Strom einmal', () => {
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug Betriebsstrom Heizung', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  const s = settle([betriebsstrom, hausstrom, ab], [abzug(14784)])
  assert.equal(codes(s).length, 0)
  // Summe der verteilten Kosten = Stromrechnung: 1.050,00 €
  assert.equal(s.totalCostsCents, 105000)
})

test('Abzug zu klein und zu groß: Text mit der Differenz, je in seiner Richtung', () => {
  const klein = codes(settle([betriebsstrom, hausstrom], [abzug(10000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(klein.text, /abgezogen sind dort 100,00 € statt 147,84 €; 47,84 € werden damit doppelt verteilt/)
  const gross = codes(settle([betriebsstrom, hausstrom], [abzug(20000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(gross.text, /abgezogen sind dort 200,00 €, 52,16 € mehr als der Betriebsstrom/)
  assert.match(gross.text, /Diesen Teil des Allgemeinstroms tragen Sie damit selbst/)
})

test('Review Focus 5: Abzug in einem anderen Zeitraum zählt, denn er gehört zur Position', () => {
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2026-01')])).length, 0)
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(7392, 'a1', '2025-01'), abzug(7392, 'a2', '2026-01')])).length, 0)
})

test('Wer nichts einstellt, merkt nichts: ohne Kennzeichnung kein Hinweis und dieselbe Abrechnung', () => {
  const ohne = settle([{ ...betriebsstrom, operatingPower: undefined }, hausstrom], [])
  assert.equal(codes(ohne).length, 0)
  const ohneFeld = computeSettlement(snapshotOfPeriod(haus([{ ...betriebsstrom, operatingPower: undefined }, hausstrom]), P, previousPeriod(CALENDAR_RULES, P)))
  assert.deepEqual(ohne, ohneFeld)
})

test('Befund rein: nur Positionen mit „included“, Abzüge nur über ihren Verweis', () => {
  const items: Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[] = [
    { id: 'bs', description: 'B', amountCents: 100, operatingPower: 'included' },
    { id: 'x', description: 'X', amountCents: 100 },
  ]
  const fremd: OperatingPowerDeduction = { id: 'y', itemId: null, period: periodKey('2025-01'), description: 'Messdienst', amountCents: -50, closed: null }
  assert.deepEqual(operatingPowerFindings(items, [fremd]), [{ itemId: 'bs', description: 'B', amountCents: 100, deductedCents: 0, differenceCents: 100, closedIssues: [] }])
})

test('Schnappschuss: deductionsOf nimmt Abzüge des Objekts aus allen Zeiträumen und liest den eingefrorenen Stand (P-W3, R2-W2)', () => {
  const c = (id: string, propertyId: string, period: string, op?: 'deduction'): CostItem => ({
    id, propertyId, period: periodKey(period), category: 'Beleuchtung/Allgemeinstrom', description: id, amountCents: op ? -10 : 10, key: 'area',
    ...(op ? { operatingPower: op, operatingPowerItemId: 'bs' } : {}),
  })
  const items = [c('a', 'o1', '2024-01', 'deduction'), c('b', 'o1', '2026-01', 'deduction'), c('c', 'o2', '2025-01', 'deduction'), c('d', 'o1', '2025-01'), c('e', 'o1', '2023-01', 'deduction'), c('f', 'o1', '2022-01', 'deduction')]
  // 2024: a steht mit seinem Betrag darin; 2023: e fehlt; 2022: f steht mit einem anderen Betrag darin.
  const closed: { period: PeriodKey; itemTotals: Record<string, number> }[] = [
    { period: periodKey('2024-01'), itemTotals: { a: -10 } },
    { period: periodKey('2023-01'), itemTotals: { x: 5 } },
    { period: periodKey('2022-01'), itemTotals: { f: -4 } },
  ]
  const list = deductionsOf(items, 'o1', closed, CALENDAR_RULES)
  assert.deepEqual(list.map((d) => [d.id, d.period, d.itemId, d.closed]), [
    ['a', '2024-01', 'bs', { label: '2024', state: 'credited' }],
    ['b', '2026-01', 'bs', null],
    ['e', '2023-01', 'bs', { label: '2023', state: 'missing' }],
    ['f', '2022-01', 'bs', { label: '2022', state: 'changed', frozenCents: -4 }],
  ])
  // Ein unlesbarer eingefrorener Stand (`itemTotals` null oder fehlend) heißt „unbekannt“.
  assert.deepEqual(deductionsOf(items, 'o1', [{ period: periodKey('2024-01'), itemTotals: null }], CALENDAR_RULES)[0]?.closed, { label: '2024', state: 'unknown' })
  assert.deepEqual(deductionsOf(items, 'o1', [{ period: periodKey('2024-01') }], CALENDAR_RULES)[0]?.closed, { label: '2024', state: 'unknown' })
})

// G-K3: Der Abzug gehört zu seiner Stromrechnung und muss verteilt sein wie sie, sonst verschieben sich die
// Anteile der Mieter (gemessen: 300 € von 1.000 € nach Einheiten, Rechnung danach auf Fläche, 90 €).
test('G-K3: Abzug anders verteilt als seine Stromrechnung → Hinweis mit Betrag; gleich verteilt → still', () => {
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug Betriebsstrom Heizung', amountCents: -14784, key: 'units', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'strom' }
  const kind = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-key')
  const [n, ...rest] = kind(settle([betriebsstrom, hausstrom, ab], [abzug(14784)]))
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'ab' })
  assert.match(n.text, /„Abzug Betriebsstrom Heizung“ \(147,84 €\) ist anders verteilt als die Stromrechnung „Hausstrom“/)
  assert.match(n.text, /Wohneinheiten/)
  assert.match(n.text, /Wohnfläche/)
  assert.equal(kind(settle([betriebsstrom, hausstrom, { ...ab, key: 'area' }], [abzug(14784)])).length, 0)
})

// G-W1: Mehr Abzug als die Stromrechnung beträgt, macht den Allgemeinstrom netto negativ.
test('G-W1: Summe der Abzüge über der Stromrechnung → Hinweis mit dem Betrag darüber', () => {
  const strom: SnapshotCostItem = { ...hausstrom, amountCents: 100000 }
  const ab = (id: string, cents: number): SnapshotCostItem => ({ ...strom, id, description: `Abzug ${id}`, amountCents: -cents, operatingPower: 'deduction', operatingPowerGeneralId: 'strom' })
  const kind = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-exceeds')
  const [n] = kind(settle([strom, ab('a1', 60000), ab('a2', 60000)], []))
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'strom' })
  assert.match(n.text, /Aus der Stromrechnung „Hausstrom“ \(1\.000,00 €\) sind 1\.200,00 € abgezogen, 200,00 € mehr als die Rechnung/)
  assert.equal(kind(settle([strom, ab('a1', 60000), ab('a2', 40000)], [])).length, 0)
})
