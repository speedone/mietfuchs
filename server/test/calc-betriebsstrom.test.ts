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

// R-W1 (Durchsicht von #252): Liegt der Abzug in einer abgeschlossenen Abrechnung, hat jeder Zustand seinen
// eigenen Kopf. Nur „nicht gutgeschrieben“ nennt „zweimal“; keiner rät zu einem neuen Abzug in einem
// anderen Jahr, denn der käme bei anderen Abrechnungen an.
const DEADLINE = /Ist die Abrechnungsfrist abgelaufen, darf die neue Abrechnung den Mieter nicht schlechter stellen als die zugestellte: keine höhere Nachforderung, kein geringeres Guthaben und auch bei keiner einzelnen Position mehr als zuvor, es sei denn, Sie haben die Verspätung nicht zu vertreten \(§ 556 Abs\. 3 Satz 3 BGB; BGH, Urteile vom 17\.11\.2004, VIII ZR 115\/04, und vom 12\.12\.2007, VIII ZR 190\/06\)/
const geschlossen = (state: OperatingPowerDeduction['closed'], cents = 14784) => codes(settle([betriebsstrom, hausstrom], [abzug(cents, 'ab', '2024-01', state)]))[0] ?? assert.fail('kein Hinweis')

test('R-W1: nicht im eingefrorenen Stand → eigener Kopf, die Mieter zahlen zweimal, wieder öffnen, kein zweiter Abzug, Fristgrenze (R-K1)', () => {
  const n = geschlossen({ label: '2024', state: 'missing' })
  assert.equal(n.level, 'warning')
  assert.match(n.text, /^„Betriebsstrom Heizung“: Dieser Betriebsstrom steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms\. Der Abzug dafür steht in einer abgeschlossenen Abrechnung\./)
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ \(147,84 €\) gehört zur abgeschlossenen Abrechnung 2024, steht aber nicht in ihrem eingefrorenen Stand\. Den Mietern ist er dort nicht gutgeschrieben, sie zahlen diesen Strom also zweimal\./)
  assert.match(n.text, /Öffnen Sie die Abrechnung 2024 wieder und stellen Sie sie neu zu\. Legen Sie keinen zweiten Abzug in einem anderen Jahr an/)
  assert.match(n.text, /Eine Gutschrift dürfen Sie auch nach Ablauf der Abrechnungsfrist noch nachholen/)
  assert.match(n.text, DEADLINE)
  assert.doesNotMatch(n.text, /Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms|abgezogen sind dort/)
})

test('R-W1: unlesbarer Stand → kein „doppelt verteilt“, kein Rat zu einem neuen Abzug, nur die zugestellte Abrechnung prüfen', () => {
  const n = geschlossen({ label: '2024', state: 'unknown' })
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ \(147,84 €\) gehört zur abgeschlossenen Abrechnung 2024\. Ob er dort gutgeschrieben ist, lässt sich aus dem gespeicherten Stand nicht lesen\. Sehen Sie bitte in der zugestellten Abrechnung nach\. Steht er dort, ist nichts zu tun\./)
  assert.match(n.text, /Legen Sie keinen zweiten Abzug an, sonst bekommen die Mieter ihn womöglich zweimal gutgeschrieben/)
  assert.doesNotMatch(n.text, /doppelt verteilt|Erfassen Sie beim Allgemeinstrom|nicht gutgeschrieben/)
})

// R-W1, Zusatzbefund: Wer bei „unbekannt“ doch einen zweiten Abzug anlegt, darf keine stille Abrechnung
// bekommen; stand der erste in der zugestellten, sind es zwei Gutschriften.
test('R-W1: unbekannt neben einem offenen Abzug gleicher Höhe bleibt nicht stumm und nennt beide', () => {
  const n = codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2024-01', { label: '2024', state: 'unknown' }), { ...abzug(14784, 'ab2', '2025-01'), description: 'Abzug 2025' }]))[0] ?? assert.fail('stumm')
  assert.match(n.text, /Daneben sind beim Allgemeinstrom weitere 147,84 € abgezogen \(„Abzug 2025“\)/)
  assert.match(n.text, /Steht der Abzug „Abzug Betriebsstrom Heizung“ in der zugestellten Abrechnung, ist den Mietern der Betriebsstrom zweimal gutgeschrieben/)
})

test('R-W1: nach dem Abschluss vergrößert → gezählt wird der eingefrorene Betrag, wieder öffnen, kein weiterer Abzug', () => {
  // Eingefroren 100,00 €, heute 147,84 €: 47,84 € zahlen die Mieter dort doppelt.
  const n = geschlossen({ label: '2024', state: 'changed', frozenCents: -10000 })
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ steht in der abgeschlossenen Abrechnung 2024 mit 100,00 € statt 147,84 €, denn der Betrag wurde nach dem Abschluss geändert\. 47,84 € zahlen die Mieter dort also doppelt\./)
  assert.match(n.text, /Soll der neue Betrag gelten, öffnen Sie die Abrechnung 2024 wieder und stellen Sie sie neu zu\. Legen Sie dafür keinen weiteren Abzug an\./)
  assert.match(n.text, DEADLINE)
  assert.doesNotMatch(n.text, /Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms|nicht gutgeschrieben/)
  // Gleicht der eingefrorene Betrag den Betriebsstrom aus, gibt es keinen Hinweis.
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(20000, 'ab', '2024-01', { label: '2024', state: 'changed', frozenCents: -14784 })])).length, 0)
})

// R-K3: Nach dem Abschluss verkleinert: Den Mietern ist mehr gutgeschrieben; das trägt der Vermieter, und
// eine Korrektur zu ihren Lasten ist nach der Frist ausgeschlossen. Kein „passen Sie an“.
test('R-K3: nach dem Abschluss verkleinert → der Vermieter trägt den Unterschied, zulässig, kein Rat zum Anpassen oder Wiederöffnen', () => {
  const n = geschlossen({ label: '2024', state: 'changed', frozenCents: -20000 })
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ steht in der abgeschlossenen Abrechnung 2024 mit 200,00 € statt 147,84 €, denn der Betrag wurde nach dem Abschluss verkleinert\. Den Mietern ist dort 52,16 € mehr gutgeschrieben als der Betriebsstrom; diesen Teil des Allgemeinstroms tragen Sie selbst\./)
  assert.match(n.text, /Das benachteiligt die Mieter nicht und ist nach Auffassung von Mietfuchs zulässig \(vgl\. BGH, Urteil vom 03\.06\.2016, V ZR 166\/15, Rn\. 15\)/)
  assert.match(n.text, /Eine Korrektur zu Lasten der Mieter ist nach Ablauf der Abrechnungsfrist ausgeschlossen \(§ 556 Abs\. 3 Satz 3 BGB\)/)
  assert.doesNotMatch(n.text, /passen Sie|öffnen Sie|Erfassen Sie/)
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
  assert.deepEqual(operatingPowerFindings(items, [fremd]), [{ itemId: 'bs', generation: false, description: 'B', amountCents: 100, deductedCents: 0, differenceCents: 100, closedIssues: [], others: [] }])
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

// G-K2, N1: Betriebsstrom und Abzug sind eine Umbuchung zwischen Kostenarten und gehören in dasselbe
// Steuerjahr; sonst stehen beide Jahre der Anlage V falsch (gemessen 900 € statt 1.000 € und 100 € statt 0 €).
test('N1: Abzug in einem anderen Steuerjahr als sein Betriebsstrom → Hinweis; im selben → still', () => {
  const kind = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-tax-year')
  const [n] = kind(settle([betriebsstrom, hausstrom], [{ ...abzug(14784, 'ab', '2024-01'), taxYear: 2024 }]))
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /„Betriebsstrom Heizung“ zählt in der Steuerübersicht zum Jahr 2025, der Abzug „Abzug Betriebsstrom Heizung“ zum Jahr 2024/)
  // G2-N-W2: Der Rat richtet sich an die Position, deren Jahr sich einstellen lässt: den Abzug.
  assert.match(n.text, /Stellen Sie beim Abzug „Abzug Betriebsstrom Heizung“ im Kostenformular das Jahr der Zahlung 2025 ein/)
  assert.doesNotMatch(n.text, /bei beiden/)
  assert.equal(kind(settle([betriebsstrom, hausstrom], [{ ...abzug(14784), taxYear: 2025 }])).length, 0)
})

// R-W2: Der Strom einer Wärmepumpe über den Hauszähler steckt auch im Allgemeinstrom; der Hinweis nennt ihn
// als Strom zur Wärmeerzeugung und kennzeichnet die Übertragung der Rechtsprechung als Auslegung.
test('R-W2: Strom zur Wärmeerzeugung ohne Abzug → Hinweis mit Betrag, als Auslegung gekennzeichnet', () => {
  const wp: SnapshotCostItem = { ...betriebsstrom, id: 'wp', description: 'Strom der Wärmepumpe', heatingPart: 'fuel', amountCents: 60000 }
  const [n] = codes(settle([wp, hausstrom], []))
  if (!n) return assert.fail('kein Hinweis')
  assert.match(n.text, /„Strom der Wärmepumpe“: Dieser Strom zur Wärmeerzeugung steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms/)
  assert.match(n.text, /600,00 € werden damit doppelt verteilt/)
  assert.match(n.text, /Auslegung von Mietfuchs/)
  assert.match(n.text, /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV/)
  assert.equal(codes(settle([wp, hausstrom], [{ ...abzug(60000), itemId: 'wp' }])).length, 0)
})

// G2-K3 (O3): Gleicher Schlüssel, aber andere Teilnehmer der Rechnung verschieben ebenso Geld (gemessen: B
// −60,00 € Allgemeinstrom). Der Hinweis vergleicht deshalb die ganze Verteilung, nicht nur den Schlüssel.
test('G2-K3: Rechnung auf Teilnehmer beschränkt, Abzug nicht → Hinweis „anders verteilt“', () => {
  const strom: SnapshotCostItem = { ...hausstrom, participantUnitIds: ['u1'] }
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug Betriebsstrom Heizung', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'strom' }
  const [n] = (settle([betriebsstrom, strom, ab], [abzug(14784)]).notices ?? []).filter((x) => x.code === 'heating.operating-power-key')
  if (!n) return assert.fail('kein Hinweis')
  assert.match(n.text, /beide nach „Wohnfläche“, aber mit anderen Angaben/)
})
