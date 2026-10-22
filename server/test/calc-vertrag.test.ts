// Nicht vereinbarte Betriebskosten trägt der Vermieter (#258, Entwurf Entscheidungen 2, 5, 6). Steht ein
// Mietverhältnis in `notAgreedTenancyIds` einer Position, bleibt seine Wohnung in der Verteilbasis; verteilt
// wird wie heute, und sein Anteil geht mit dem Grund `notAgreed` an den Vermieter. Bei „Sonstige
// Betriebskosten“ meldet ein Hinweis die Mietverhältnisse ohne Antwort. Jede Zahl ist von Hand nachgerechnet.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { LandlordPart, Notice } from '../../shared/types.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const garden = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'k', period: calendarPeriod(2025), category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 100000, key: 'area', ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [unit('u1'), unit('u2')], tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2')], costItems: [garden()],
  meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf(source(s), 2025))
const shareOf = (s: ComputedSettlement, tenancyId: string, itemId = 'k'): number => {
  const st = s.statements.find((x) => x.tenancyId === tenancyId) ?? assert.fail(`keine Abrechnung für ${tenancyId}`)
  return st.rows.filter((r) => r.costItemId === itemId).reduce((a, r) => a + r.shareCents, 0)
}
const partsOf = (s: ComputedSettlement, itemId = 'k'): LandlordPart[] => {
  const row = s.landlord.rows.find((r) => r.costItemId === itemId) ?? assert.fail(`keine Zeile des Vermieteranteils für ${itemId}`)
  return row.landlordParts ?? assert.fail(`Zeile ${itemId} ohne Zerlegung`)
}
const noticesOf = (s: ComputedSettlement, code: string): Notice[] => s.notices.filter((n) => n.code === code)

test('nicht vereinbart: Fläche, der Anteil von t1 geht an den Vermieter, t2 trägt unverändert die Hälfte', () => {
  const s = settle({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(s, 't1'), 0)
  assert.equal(shareOf(s, 't2'), 50000)
  assert.deepEqual(partsOf(s), [{ reason: 'notAgreed', cents: 50000 }])
  // Die Position fehlt in der Abrechnung von t1 (BGH VIII ZR 93/15): keine Zeile, auch keine mit 0 €.
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('keine Abrechnung für t1')
  assert.equal(st.rows.some((r) => r.costItemId === 'k'), false)
})

test('nicht vereinbart gegen den heutigen Behelf: ohne u1 in den Teilnehmern trägt t2 alles, und das ist der gewollte Unterschied', () => {
  // Der Behelf (#94) nimmt u1 aus der Verteilbasis; dann trägt t2 die vollen 1.000 €. Richtig ist, dass die
  // Wohnung in der Basis bleibt und ihr Anteil beim Vermieter landet (Entwurf, „Ziel und Warum“).
  const behelf = settle({ costItems: [garden({ participantUnitIds: ['u2'] })] })
  assert.equal(shareOf(behelf, 't2'), 100000)
  const richtig = settle({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(richtig, 't2'), 50000)
})

test('nicht vereinbart beim Mieterwechsel: nur t1a, t1b trägt seinen Teil wie ohne Eintrag', () => {
  const tenancies = [tenancy('t1a', 'u1', { end: '2025-06-30' }), tenancy('t1b', 'u1', { start: '2025-07-01' }), tenancy('t2', 'u2')]
  const ohne = settle({ tenancies })
  const mit = settle({ tenancies, costItems: [garden({ notAgreedTenancyIds: ['t1a'] })] })
  // 1.000 € × 50/100 × 181/365 = 247,95 € für t1a, × 184/365 = 252,05 € für t1b.
  assert.equal(shareOf(ohne, 't1a'), 24795)
  assert.equal(shareOf(ohne, 't1b'), 25205)
  assert.equal(shareOf(mit, 't1a'), 0)
  assert.equal(shareOf(mit, 't1b'), 25205)
  assert.equal(shareOf(mit, 't2'), 50000)
  assert.deepEqual(partsOf(mit), [{ reason: 'notAgreed', cents: 24795 }])
})

test('nicht vereinbart bei Einzelbeträgen: der Betrag von t1 geht an den Vermieter, kein Rest nach Einzelbeträgen', () => {
  const s = settle({ costItems: [garden({ key: 'amounts', amountCents: 50000, tenancyAmounts: { t1: 30000, t2: 20000 }, notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(s, 't1'), 0)
  assert.equal(shareOf(s, 't2'), 20000)
  assert.deepEqual(partsOf(s), [{ reason: 'notAgreed', cents: 30000 }])
  assert.equal(noticesOf(s, 'amounts.missing').length, 0)
})

test('nicht vereinbart bei Direktzuordnung: die ganze Position geht an den Vermieter', () => {
  const s = settle({ costItems: [garden({ key: 'direct', directUnitId: 'u1', notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(s, 't1'), 0)
  assert.deepEqual(partsOf(s), [{ reason: 'notAgreed', cents: 100000 }])
})

test('Hinweis allocation.not-agreed: je Mietverhältnis mit Position und Betrag, Auslegung unter „Mehr dazu“', () => {
  const s = settle({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] })
  const [n, ...rest] = noticesOf(s, 'allocation.not-agreed')
  assert.ok(n, 'kein Hinweis allocation.not-agreed')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'hint')
  assert.deepEqual(n.subject, { kind: 'tenancy', id: 't1' })
  assert.match(n.text, /Mieter t1 \(u1\)/)
  assert.match(n.text, /„Gartenpflege“/)
  assert.match(n.text, /500,00 €/)
  assert.match(n.text, /§ 556 Abs\. 1 BGB/)
  assert.match(n.text, /VIII ZR 159\/05/)
  assert.ok(n.terms?.includes('notAgreedCosts'))
  // Ohne Eintrag kein Hinweis.
  assert.equal(noticesOf(settle({}), 'allocation.not-agreed').length, 0)
})

test('„Sonstige Betriebskosten“ ohne Antwort: verteilt wie heute, der Hinweis nennt beide Mieter mit Betrag', () => {
  const other = garden({ category: 'Sonstige Betriebskosten', description: 'Dachrinnenreinigung', amountCents: 20000 })
  const s = settle({ costItems: [other] })
  assert.equal(shareOf(s, 't1'), 10000)
  assert.equal(shareOf(s, 't2'), 10000)
  const [n, ...rest] = noticesOf(s, 'allocation.other-unanswered')
  assert.ok(n, 'kein Hinweis allocation.other-unanswered')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'hint')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'k' })
  assert.match(n.text, /„Dachrinnenreinigung“/)
  assert.match(n.text, /Mieter t1 \(u1\) mit 100,00 €/)
  assert.match(n.text, /Mieter t2 \(u2\) mit 100,00 €/)
  assert.match(n.text, /VIII ZR 167\/03/)
  assert.ok(n.terms?.includes('namedOtherCosts'))
  // Beide im Vertrag benannt: kein Hinweis.
  assert.equal(noticesOf(settle({ costItems: [{ ...other, namedTenancyIds: ['t1', 't2'] }] }), 'allocation.other-unanswered').length, 0)
  // Einer benannt, einer nicht vereinbart: auch keiner.
  const both = settle({ costItems: [{ ...other, namedTenancyIds: ['t2'], notAgreedTenancyIds: ['t1'] }] })
  assert.equal(noticesOf(both, 'allocation.other-unanswered').length, 0)
  // Nur einer beantwortet: der andere bleibt im Hinweis.
  const [one] = noticesOf(settle({ costItems: [{ ...other, namedTenancyIds: ['t2'] }] }), 'allocation.other-unanswered')
  assert.ok(one)
  assert.match(one.text, /Mieter t1 \(u1\) mit 100,00 €/)
  assert.doesNotMatch(one.text, /Mieter t2/)
})

test('Steuer unverändert: die Position bleibt voll Werbungskosten, nur die Umlage von t1 entfällt', () => {
  const ohne = snapshotOf(source({}), 2025)
  const mit = snapshotOf(source({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] }), 2025)
  const a = taxReport(ohne)
  const b = taxReport(mit)
  assert.deepEqual(b.expenses, a.expenses)
  assert.deepEqual(b.income, a.income)
  const group = b.expenses.groups.find((g) => g.categories.some((c) => c.category === 'Gartenpflege')) ?? assert.fail('keine Gruppe mit Gartenpflege')
  assert.equal(group.categories.find((c) => c.category === 'Gartenpflege')?.amountCents, 100000)
  assert.equal(group.privateCents, 0)
  // Was entfällt, ist die Erstattung durch t1: 500 € weniger bei den Mietern.
  const sa = computeSettlement(ohne)
  const sb = computeSettlement(mit)
  const tenants = (s: ComputedSettlement) => s.statements.reduce((x, st) => x + st.totalShareCents, 0)
  assert.equal(tenants(sa) - tenants(sb), 50000)
})

test('nicht vereinbart gilt nicht bei Heizung, nicht Umlagefähigem und Rücklage (Wiederherstellen prüft das nicht)', () => {
  for (const category of ['Heizung und Warmwasser', 'Nicht umlagefähig', 'Zuführung Erhaltungsrücklage']) {
    const ohne = settle({ costItems: [garden({ category, description: category })] })
    const mit = settle({ costItems: [garden({ category, description: category, notAgreedTenancyIds: ['t1'], namedTenancyIds: ['t2'] })] })
    assert.deepEqual(mit.statements, ohne.statements, category)
    assert.deepEqual(mit.landlord, ohne.landlord, category)
    assert.equal(noticesOf(mit, 'allocation.not-agreed').length, 0, category)
  }
})

test('Lexikon: die Beispiele zu notAgreedCosts und namedOtherCosts sind die Rechnung von oben', () => {
  // Gartenpflege: A nicht vereinbart, B 500 €, Vermieter 500 €; mit dem Behelf trüge B 1.000 €.
  const s = settle({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(s, 't2'), 50000)
  assert.equal(partsOf(s).find((p) => p.reason === 'notAgreed')?.cents, 50000)
  assert.match(GLOSSARY.notAgreedCosts.example, /1\.000 € × 50\/100 = 500 €, und die übrigen 500 € trägt der Vermieter/)
  assert.match(GLOSSARY.notAgreedCosts.example, /trüge B die ganzen 1\.000 €/)
  // Dachrinnenreinigung: nur B benannt, A nicht vereinbart.
  const o = settle({ costItems: [garden({ category: 'Sonstige Betriebskosten', description: 'Dachrinnenreinigung', amountCents: 20000, namedTenancyIds: ['t2'], notAgreedTenancyIds: ['t1'] })] })
  assert.equal(shareOf(o, 't2'), 10000)
  assert.deepEqual(partsOf(o), [{ reason: 'notAgreed', cents: 10000 }])
  assert.match(GLOSSARY.namedOtherCosts.example, /200 € × 50\/100 = 100 €; den Anteil von Mieter A über 100 € trägt der Vermieter/)
  assert.match(GLOSSARY.namedOtherCosts.norm ?? '', /BGH, Urteil vom 07\.04\.2004, VIII ZR 167\/03/)
  assert.match(GLOSSARY.notAgreedCosts.norm ?? '', /BGH, Urteil vom 31\.05\.2006, VIII ZR 159\/05/)
})

test('Hinweis allocation.not-agreed: zwei Positionen desselben Mieters in einem Hinweis, Beträge zusammen gleich der Zeile', () => {
  const s = settle({
    tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2'), tenancy('t3', 'u3')],
    units: [unit('u1'), unit('u2'), unit('u3')],
    costItems: [
      garden({ amountCents: 100, notAgreedTenancyIds: ['t1', 't2'] }),
      garden({ id: 'k2', category: 'Hauswart', description: 'Hauswart', amountCents: 30000, notAgreedTenancyIds: ['t1'] }),
    ],
  })
  // 1,00 € auf drei gleiche Wohnungen: je 33,33 Cent, der Restcent geht an den Vermieter; zusammen 67 Cent für t1 und t2.
  assert.deepEqual(partsOf(s), [{ reason: 'notAgreed', cents: 67 }])
  const ns = noticesOf(s, 'allocation.not-agreed')
  assert.deepEqual(ns.map((n) => n.subject?.id), ['t1', 't2'])
  const [first, second] = ns
  assert.ok(first && second)
  assert.match(first.text, /die Positionen „Gartenpflege“ \(0,(33|34) €\) und „Hauswart“ \(100,00 €\) nicht/)
  assert.match(second.text, /die Position „Gartenpflege“ \(0,(33|34) €\) nicht/)
  const cents = (t: string) => Number(/„Gartenpflege“ \(0,(\d\d) €\)/.exec(t)?.[1])
  assert.equal(cents(first.text) + cents(second.text), 67)
})

test('Abzug Betriebsstrom: übernimmt „nicht vereinbart“ seiner Stromrechnung, t1 bekommt keine Gutschrift', () => {
  // Durchsicht des Endstands: Der Abzug (negativ, verknüpft über `operatingPowerGeneralId`) ist ein Ausschnitt der
  // Stromrechnung. Trägt t1 die Rechnung laut Vertrag nicht, darf er auch aus dem Abzug nichts gutgeschrieben
  // bekommen; sonst zahlte der Vermieter ihm einen Teil der Kosten aus, die er nie getragen hat.
  const strom = garden({ id: 'strom', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, notAgreedTenancyIds: ['t1'] })
  const abzug = garden({ id: 'ab', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', amountCents: -20000, operatingPower: 'deduction', operatingPowerGeneralId: 'strom' })
  const ohne = settle({ costItems: [{ ...strom, notAgreedTenancyIds: null }, abzug] })
  const s = settle({ costItems: [strom, abzug] })
  // Rechnung: 1.000 € × 50/100 = 500 € je Wohnung; Abzug: −200 € × 50/100 = −100 € je Wohnung.
  assert.equal(shareOf(s, 't1', 'strom'), 0)
  assert.equal(shareOf(s, 't1', 'ab'), 0)
  // t2 trägt unverändert, was er ohne Eintrag trüge.
  assert.equal(shareOf(s, 't2', 'strom'), shareOf(ohne, 't2', 'strom'))
  assert.equal(shareOf(s, 't2', 'ab'), shareOf(ohne, 't2', 'ab'))
  assert.equal(shareOf(s, 't2', 'strom'), 50000)
  assert.equal(shareOf(s, 't2', 'ab'), -10000)
  // Beim Vermieter: 500 € aus der Rechnung, −100 € aus dem Abzug, zusammen 400 € `notAgreed`.
  assert.deepEqual(partsOf(s, 'strom'), [{ reason: 'notAgreed', cents: 50000 }])
  assert.deepEqual(partsOf(s, 'ab'), [{ reason: 'notAgreed', cents: -10000 }])
  // Der Hinweis zu t1 nennt beide Ausschnitte.
  const [n] = noticesOf(s, 'allocation.not-agreed')
  assert.ok(n, 'kein Hinweis allocation.not-agreed')
  assert.match(n.text, /„Hausstrom“ \(500,00 €\) und „Abzug Betriebsstrom“ \(-100,00 €\)/)
})

test('Hinweis allocation.not-agreed bei Pauschale und Inklusivmiete: ohne den Satz zur Abrechnung, die es nicht gibt', () => {
  // Durchsicht des Endstands: Ein Mieter mit Pauschale oder Inklusivmiete bekommt keine Abrechnung der kalten Kosten;
  // „In der Abrechnung von … fehlt sie“ wäre falsch. Der Anteil steht trotzdem beim Vermieter als `notAgreed`.
  for (const costModel of ['flatRate', 'inclusive'] as const) {
    const s = settle({ tenancies: [tenancy('t1', 'u1', { costModel }), tenancy('t2', 'u2')], costItems: [garden({ notAgreedTenancyIds: ['t1'] })] })
    const [n] = noticesOf(s, 'allocation.not-agreed')
    assert.ok(n, `${costModel}: kein Hinweis allocation.not-agreed`)
    assert.match(n.text, /Mieter t1 \(u1\) trägt laut Mietvertrag die Position „Gartenpflege“ \(500,00 €\) nicht/, costModel)
    assert.doesNotMatch(n.text, /In der Abrechnung von/, costModel)
    assert.deepEqual(partsOf(s), [{ reason: 'notAgreed', cents: 50000 }], costModel)
  }
  // Mit Abrechnung bleibt der Satz.
  const [n] = noticesOf(settle({ costItems: [garden({ notAgreedTenancyIds: ['t1'] })] }), 'allocation.not-agreed')
  assert.match(n?.text ?? '', /In der Abrechnung von Mieter t1 \(u1\) fehlt sie\./)
})
