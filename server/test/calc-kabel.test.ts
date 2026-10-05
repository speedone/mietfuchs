// Kabelfernsehen (#107): Seit dem 01.07.2024 sind die Gebühren für das TV-Signal nicht mehr als
// Betriebskosten umlagefähig (Wegfall des Nebenkostenprivilegs, § 2 Nr. 15 BetrKV a. F.,
// Übergangsfrist bis 30.06.2024, nur für Anlagen vor dem 01.12.2021, § 2 Satz 2 BetrKV). Danach bleibt
// bei solchen Anlagen nur der Betriebsstrom, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung.
// Mietfuchs kann das eine vom anderen nicht unterscheiden und kürzt deshalb nicht selbst; es
// warnt, und zwar abhängig vom Abrechnungsjahr.

import { calendarPeriod, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'

const bestand = (year: number, category = 'Kabel/Antenne'): SnapshotSource => ({
  units: [{ id: 'u', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [{
    id: 't', unitId: 'u', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }],
  costItems: [{ id: 'k', period: calendarPeriod(year), category, description: 'Kabelanschluss', amountCents: 12000, key: 'units' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})
const warningsFor = (year: number, category?: string) => computeSettlement(snapshotOf(bestand(year, category), year)).warnings

test('Kabel: bis einschließlich 2023 keine Warnung', () => {
  assert.deepEqual(warningsFor(2023), [])
})

test('Kabel: 2024 ist das TV-Signal nur bis zum 30.06. umlagefähig', () => {
  const w = warningsFor(2024)
  assert.equal(w.length, 1)
  assert.match(w[0] ?? '', /30\.06\.2024/)
  assert.match(w[0] ?? '', /Betriebsstrom|Wartung/)
})

test('Kabel: ab 2025 ist das TV-Signal nicht mehr umlagefähig', () => {
  const w = warningsFor(2025)
  assert.equal(w.length, 1)
  assert.match(w[0] ?? '', /nicht mehr umlagefähig/)
})

test('Kabel: die Zahlen bleiben, wie sie eingetragen sind', () => {
  // Mietfuchs kürzt nicht selbst: Die Position kann Betriebsstrom oder Wartung enthalten.
  const s = computeSettlement(snapshotOf(bestand(2025), 2025))
  assert.equal(s.statements[0]?.totalShareCents, 12000)
})

test('Kabel: nicht umlagefähig verbucht, gibt es nichts zu warnen', () => {
  assert.deepEqual(warningsFor(2025, 'Nicht umlagefähig'), [])
})

test('Kabel: eine Anlage ab dem 01.12.2021 war nie umlagefähig, auch 2022 und 2023 nicht (#121)', () => {
  const mit = (year: number, before: boolean | null) =>
    computeSettlement({ ...snapshotOf(bestand(year), year), property: { kind: 'mfh', cableBuiltBeforeDec2021: before } }).notices
  for (const year of [2022, 2023, 2025]) {
    const n = mit(year, false)
    assert.deepEqual(n.map((x) => x.code), ['tv-signal.new-system'], String(year))
    assert.match(n[0]?.text ?? '', /nie umlagefähig/)
    assert.equal(n[0]?.rule, 'tv-signal')
  }
  // Vor dem 01.12.2021 errichtet oder unbekannt: wie bisher.
  assert.deepEqual(mit(2023, true), [])
  assert.deepEqual(mit(2023, null), [])
  assert.deepEqual(mit(2025, true).map((x) => x.code), ['tv-signal.ended'])
})

test('Kabel, neue Anlage: 2021 betrifft nur die Zeit ab Errichtung, und die Glasfaser-Ausnahme nennt ihre Bedingung (#121)', () => {
  const text = (year: number) => computeSettlement({ ...snapshotOf(bestand(year), year), property: { kind: 'mfh', cableBuiltBeforeDec2021: false } }).warnings.join(' ')
  assert.match(text(2021), /ab der Errichtung/)
  assert.doesNotMatch(text(2023), /ab der Errichtung/)
  assert.match(text(2023), /Anbieter frei wählen/)
})

// #142, Zielbild aus #91: Ein Hinweis auf etwas, das nicht umgelegt werden darf, nennt den Betrag,
// der trotzdem bei den Mietern gelandet ist.
test('Kabel nach 2024: die Warnung nennt den auf die Mieter umgelegten Betrag', () => {
  const src = bestand(2025)
  // Zwei Einheiten, eine leer: umgelegt sind 60 €, die andere Hälfte trägt der Vermieter.
  src.units.push({ id: 'leer', name: 'OG', areaM2: 50, participates: true })
  const n = computeSettlement(snapshotOf(src, 2025)).notices
  assert.deepEqual(n.map((x) => x.code), ['tv-signal.ended'])
  assert.match(n[0]?.text ?? '', /Auf die Mieter umgelegt sind in dieser Abrechnung 60,00\s€/)
})

test('Kabel, neue Anlage: auch diese Warnung nennt den umgelegten Betrag', () => {
  const n = computeSettlement({ ...snapshotOf(bestand(2025), 2025), property: { kind: 'mfh', cableBuiltBeforeDec2021: false } }).notices
  assert.match(n[0]?.text ?? '', /Auf die Mieter umgelegt sind in dieser Abrechnung 120,00\s€/)
})

test('Kabel nach 2024: ohne umgelegten Betrag kein Satz über einen Betrag, und die Reihenfolge der Hinweise bleibt', () => {
  const src = bestand(2025)
  src.tenancies = src.tenancies.map((t) => ({ ...t, costModel: 'flatRate' }))
  // Eine Wasserposition ohne Ablesungen ergibt einen Hinweis aus der Verteilung.
  src.costItems.push({ id: 'z', period: calendarPeriod(2025), category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser' })
  const n = computeSettlement(snapshotOf(src, 2025)).notices
  assert.deepEqual(n.map((x) => x.code), ['tv-signal.ended', 'meter.no-consumption'])
  const kabel = n.find((x) => x.code === 'tv-signal.ended')
  assert.doesNotMatch(kabel?.text ?? '', /umgelegt sind in dieser Abrechnung/)
})

test('Kabel nach 2024: eine Gutschrift bekommt keinen Satz über einen umgelegten Betrag', () => {
  const src = bestand(2025)
  src.costItems = [{ id: 'k', period: calendarPeriod(2025), category: 'Kabel/Antenne', description: 'Kabel Gutschrift', amountCents: -3000, key: 'units' }]
  const n = computeSettlement(snapshotOf(src, 2025)).notices
  assert.deepEqual(n.map((x) => x.code), ['tv-signal.ended'])
  assert.doesNotMatch(n[0]?.text ?? '', /umgelegt sind in dieser Abrechnung/)
})

test('Kabel über den Zeitraum (#208): Mai–April nennt den Zeitraum, ein Rumpf vor der Errichtung ist nicht betroffen', () => {
  const kabel = (key: string): SnapshotCostItem => ({ id: 'k', period: periodKey(key), category: 'Kabel/Antenne', description: 'Kabelanschluss', amountCents: 12000, key: 'units' })
  const neueAnlage = { kind: 'mfh' as const, cableBuiltBeforeDec2021: false }
  const at = (rules: PeriodRules, key: string, property: { kind: 'mfh', cableBuiltBeforeDec2021: boolean | null } | null) => {
    const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
    return computeSettlement({ ...snapshotOfPeriod({ ...bestand(2021), costItems: [kabel(key)] }, p, previousPeriod(rules, p)), property }).notices
  }
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const neu = at(mai, '2021-05', neueAnlage).find((x) => x.code === 'tv-signal.new-system') ?? assert.fail('kein Hinweis')
  assert.match(neu.text, /Für 2021\/2022 gilt das für die Kosten ab der Errichtung/)
  const wechsel: PeriodRules = { startMonth: 1, changes: ['2021-05'] }
  assert.equal(at(wechsel, '2021-01', neueAnlage).some((x) => x.code === 'tv-signal.new-system'), false, 'der Rumpf endet am 30.04.2021, vor der Errichtung')
  // Das Übergangsjahr Mai–April: Die Regel endet am 30.06.2024, mitten im Zeitraum; „das erste
  // Halbjahr“ wäre hier Mai bis Oktober und damit falsch.
  const teil = at(mai, '2024-05', null).find((x) => x.code === 'tv-signal.partial-year') ?? assert.fail('kein Übergangshinweis')
  assert.match(teil.text, /Umlegen dürfen Sie für 2024\/2025 höchstens die Zeit bis zum 30\.06\.2024/)
})
