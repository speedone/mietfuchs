// Die Abzugszeilen nach § 7 Abs. 5 CO2KostAufG an allen Stellen, an denen die Berechnung die CO₂-Abzugszeile
// eines Topfs erkennt (Heizung PR 18, Prüfung M5): Vorschlag nach § 560 im Rumpfzeitraum und Kürzungsbeträge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { valueAt } from '../../shared/law/register.ts'
import { hkvCutRemoteReading } from '../../shared/law/heizkostenv.ts'
import { delivery, item, plant, three, type Quelle } from '../testing/halfSplitSnapshot.ts'
import { selfDelivery, selfReadings, selfSnapshot } from '../testing/selfHeating.ts'

// Ein Rumpf 01.01.–30.04.2028 (Wechsel des Rhythmus auf Mai), ganz in der Teilung nach § 5a.
const RUMPF: PeriodRules = { startMonth: 1, changes: ['2028-05'] }
function rumpf(over: Partial<Quelle>) {
  const p = periodOfKey(RUMPF, periodKey('2028-01')) ?? assert.fail('kein Rumpf')
  const q = three({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, tightMarket: null, periodRules: RUMPF }],
    costItems: [item({ id: 'gas', period: periodKey('2028-01'), amountCents: 300000, serviceFrom: '2028-01-01', serviceTo: '2028-04-30' })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-01-01', invoiceTo: '2028-04-30', label: 'Gas Jan–Apr 2028', emissionsKg: null, co2CostCents: null })],
    tenancies: ['a', 'b', 'c'].map((u) => ({
      id: `t${u}`, unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
      prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
    })),
    ...over,
  })
  return computeSettlement(snapshotFor(q, 'objekt-1', p))
}

test('Rumpf: die Abzugszeile nach § 5a gehört zu denselben Heizkosten wie ihr Brennstoff (Vorschlag nach § 560)', () => {
  // Netzentgelte 300 €, ganz in 2028: Der Vermieter trägt 150 €, Mieter A (50 %) davon 75 €.
  const mit = rumpf({ fuelDeliveries: [delivery({ invoiceFrom: '2028-01-01', invoiceTo: '2028-04-30', label: 'Gas Jan–Apr 2028', emissionsKg: null, co2CostCents: null, gridFeeCents: 30000 })] })
  const a = mit.statements.find((s) => s.tenancyId === 'ta') ?? assert.fail('kein Mieter A')
  assert.deepEqual(a.rows.filter((r) => r.kind === 'gmodgRelief').map((r) => r.shareCents), [-7500])
  // Derselbe Vorschlag wie ohne Netzentgelte mit 150 € weniger Brennstoff.
  const netto = rumpf({ costItems: [item({ id: 'gas', period: periodKey('2028-01'), amountCents: 285000, serviceFrom: '2028-01-01', serviceTo: '2028-04-30' })] })
  const b = netto.statements.find((s) => s.tenancyId === 'ta') ?? assert.fail('kein Mieter A')
  assert.equal(a.totalShareCents, b.totalShareCents)
  assert.ok(b.suggestedMonthlyCents > 0, `Vorschlag ${b.suggestedMonthlyCents}`)
  assert.equal(a.suggestedMonthlyCents, b.suggestedMonthlyCents)
})

test('Kürzungsbeträge nach § 7 Abs. 4 rechnen auf die Heizkosten nach beiden Abzügen (Entwurf 6.5)', () => {
  // Ohne CO₂-Angaben: `co2.incomplete` nennt die 3 % je Mieter auf die Heizkosten nach dem Abzug nach § 5a.
  const p = periodOfKey({ startMonth: 5, changes: [] }, periodKey('2027-05')) ?? assert.fail('kein Zeitraum')
  const r = computeSettlement(snapshotFor(three({
    fuelDeliveries: [delivery({ gridFeeCents: 30000, emissionsKg: null, co2CostCents: null })],
    heatingPlants: [plant()],
  }), 'objekt-1', p))
  const n = r.notices.find((x) => x.code === 'co2.incomplete') ?? assert.fail('kein Hinweis')
  // Mieter A: 4.500,00 € − 39,75 € = 4.460,25 €; 3 % = 133,81 €.
  assert.match(n.text, /Mieter A \(A\) 133,81 €/)
})

test('Eigene Heizkostenabrechnung mit Warmwasser: der Abzug nach § 5a steht im Ausweis je Topf (potCo2Of)', () => {
  // Beispiel A im Jahr 2028, Heizung nach § 43 seit 2027; Netzentgelte 300 €, ganz in der Teilung.
  const r = computeSettlement(selfSnapshot({
    year: 2028,
    plant: { gmodg43InstalledOn: '2027-03-01' },
    deliveries: [selfDelivery({ gridFeeCents: 30000, bioCostCents: 0 }, 2028)],
  }))
  const rows = r.statements.find((s) => s.tenancyId === 'A')?.rows ?? assert.fail('kein Mieter A')
  const relief = -rows.filter((x) => x.kind === 'co2Relief' || x.kind === 'gmodgRelief').reduce((a, x) => a + x.shareCents, 0)
  assert.ok(rows.some((x) => x.kind === 'gmodgRelief'), 'Abzugszeile nach § 5a')
  const user = r.heating?.[0]?.self?.units.flatMap((u) => u.users).find((u) => u.tenancyId === 'A') ?? assert.fail('kein Nutzer A')
  // Der Ausweis zerlegt den gedruckten Abzug auf Heizung und Warmwasser; zusammen ist es genau der Abzug.
  assert.ok(Math.abs(user.heatingCo2Cents + user.waterCo2Cents - relief) <= 1, `${user.heatingCo2Cents} + ${user.waterCo2Cents} statt ${relief}`)
})

test('Etagenheizung: der Anteil nach § 5a folgt den Rechnungen jeder Wohnung (§ 5 Abs. 1 Satz 2)', () => {
  // Heizperiode 01.05.2027–30.04.2028. EG mit Rechnung über die ganze Heizperiode, OG nur Januar bis April 2028.
  // Einstufung über beide: 3.000 kg auf 100 m² = 30,0 → 40 %. EG: 400 · 0,47 + 500 · 0,53 = 453 ‰; OG ganz hälftig.
  const p = periodOfKey({ startMonth: 5, changes: [] }, periodKey('2027-05')) ?? assert.fail('kein Zeitraum')
  const thermen = plant({ supply: 'perUnit', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] })
  const q = three({
    units: [
      { id: 'eg', name: 'EG', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'og', name: 'OG', areaM2: 40, participates: true, propertyId: 'objekt-1' },
    ],
    tenancies: [
      { id: 't1', unitId: 'eg', tenantName: 'Mieter 1', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
      { id: 't2', unitId: 'og', tenantName: 'Mieter 2', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    ],
    heatingPlants: [thermen],
    costItems: [
      item({ id: 'g-eg', description: 'Gas EG', amountCents: 150000, key: 'direct', directUnitId: 'eg', fuelDeliveryId: 'd-eg' }),
      item({ id: 'g-og', description: 'Gas OG', amountCents: 100000, key: 'direct', directUnitId: 'og', fuelDeliveryId: 'd-og' }),
    ],
    fuelDeliveries: [
      delivery({ id: 'd-eg', label: 'Gas EG', unitId: 'eg', emissionsKg: 1800, co2CostCents: 20000, gridFeeCents: 10000 }),
      delivery({ id: 'd-og', label: 'Gas OG', unitId: 'og', invoiceFrom: '2028-01-01', invoiceTo: '2028-04-30', emissionsKg: 1200, co2CostCents: 12000, gridFeeCents: 4000 }),
    ],
  })
  const r = computeSettlement(snapshotFor(q, 'objekt-1', p))
  const rows = (kind: string) => r.statements.flatMap((st) => st.rows.filter((row) => row.kind === kind).map((row): [string, number] => [st.tenancyId, row.shareCents]))
  assert.deepEqual(rows('co2Relief'), [['t1', -9060], ['t2', -6000]])
  // Netzentgelte: EG 100 € · 0,53 · 50 % = 26,50 €, OG 40 € · 50 % = 20,00 €.
  assert.deepEqual(rows('gmodgRelief'), [['t1', -2650], ['t2', -2000]])
})

test('Eigene Heizkostenabrechnung: Kürzungsbeträge nach § 9b und § 6a rechnen nach beiden Abzügen (Prüfung M5)', () => {
  // Beispiel A 2028 ohne Zwischenablesung beim Wechsel in C: § 9b Abs. 1 verletzt (15 %), § 6a Abs. 3 unvollständig (3 %).
  const r = computeSettlement(selfSnapshot({
    year: 2028,
    plant: { gmodg43InstalledOn: '2027-03-01' },
    deliveries: [selfDelivery({ gridFeeCents: 30000, bioCostCents: 0 }, 2028)],
    readings: selfReadings(2028).filter((x) => x.date !== '2028-09-30'),
  }))
  const heizkosten = (t: string): number => (r.statements.find((s) => s.tenancyId === t)?.rows ?? []).filter((x) => x.category === 'Heizung und Warmwasser').reduce((a, x) => a + x.shareCents, 0)
  const euro = (c: number): string => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  const zwischen = r.notices.find((n) => n.code === 'heating.no-interim-reading-missed') ?? assert.fail('kein Hinweis § 9b')
  assert.ok(zwischen.text.includes(`Mieter C1 (C) ${euro(Math.round(heizkosten('C1') * 0.15))}`), zwischen.text)
  const info = r.notices.find((n) => n.code === 'heating.info-incomplete') ?? assert.fail('kein Hinweis § 6a')
  assert.ok(info.text.includes(`Mieter A (A) ${euro(Math.round(heizkosten('A') * 0.03))}`), info.text)
})

test('Ausnahme nur für die Wärme: die Kürzung wegen fehlender Fernablesbarkeit rechnet ohne die Abzugszeile nach § 5a der Wärme (Prüfung M5)', () => {
  const r = computeSettlement(selfSnapshot({
    year: 2028,
    plant: { gmodg43InstalledOn: '2027-03-01', devicesRemote: 'none' },
    row: { exemption: 'lowDemand', exemptionScope: 'heat' },
    deliveries: [selfDelivery({ gridFeeCents: 30000, bioCostCents: 0 }, 2028)],
  }))
  assert.ok(r.statements.some((s) => s.rows.some((x) => x.kind === 'gmodgRelief')), 'Abzugszeile nach § 5a')
  const n = r.notices.find((x) => x.code === 'heating.remote-reading-missing') ?? assert.fail(r.notices.map((x) => x.code).join(', '))
  const user = r.heating?.[0]?.self?.units.flatMap((u) => u.users).find((u) => u.tenancyId === 'A') ?? assert.fail('kein Nutzer A')
  const cut = Math.round(((user.waterCents - user.waterCo2Cents) * valueAt(hkvCutRemoteReading, '2028-01-01')) / 100)
  const euro = `${(cut / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  assert.ok(n.text.includes(`Mieter A (A) ${euro}`), `${euro}: ${n.text}`)
})

test('Rumpf vor 2028: die CO₂-Abzugszeile der eigenen Aufteilung geht mit dem Faktor ihres Brennstoffs in den Vorschlag (Behebung)', () => {
  // Rumpf 01.01.–30.04.2027, keine Heizung nach § 43. Gas 3.000 € nach Fläche (50/30/20 %), CO₂ 600 € bei
  // 24.105,6 kg auf 600 m²: 40,2 kg je m² liegt über der auf 120/365 gekürzten Tabelle in der Stufe 95 %. Der
  // Vermieter trägt 570 €, A 285 €, B 171 €, C 114 €.
  const R27: PeriodRules = { startMonth: 1, changes: ['2027-05'] }
  const p = periodOfKey(R27, periodKey('2027-01')) ?? assert.fail('kein Rumpf')
  const q = (amountCents: number, co2: boolean) => three({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, tightMarket: null, periodRules: R27 }],
    heatingPlants: [plant({ gmodg43InstalledOn: null })],
    costItems: [item({ id: 'gas', period: periodKey('2027-01'), amountCents, serviceFrom: '2027-01-01', serviceTo: '2027-04-30' })],
    fuelDeliveries: [delivery({ invoiceFrom: '2027-01-01', invoiceTo: '2027-04-30', label: 'Gas Jan–Apr 2027', emissionsKg: co2 ? 24105.6 : null, co2CostCents: co2 ? 60000 : null })],
    tenancies: ['a', 'b', 'c'].map((u) => ({
      id: `t${u}`, unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
      prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
    })),
  })
  const mit = computeSettlement(snapshotFor(q(300000, true), 'objekt-1', p))
  const netto = computeSettlement(snapshotFor(q(243000, false), 'objekt-1', p))
  const reliefs = mit.statements.map((s) => [s.tenancyId, s.rows.filter((r) => r.kind === 'co2Relief').reduce((a, r) => a + r.shareCents, 0)])
  assert.deepEqual(reliefs, [['ta', -28500], ['tb', -17100], ['tc', -11400]])
  const vorschlag = (r: typeof mit) => r.statements.map((s) => [s.tenancyId, s.suggestedMonthlyCents])
  // Derselbe Vorschlag wie mit 570 € weniger Brennstoff; vorher fehlte der Abzug im Vorschlag.
  assert.deepEqual(vorschlag(mit), vorschlag(netto))
  // A: 1.215,00 € in 120 Tagen mit 530 ‰ der Gradtage, hochgerechnet 2.292,45 €, je Monat 191 €.
  assert.deepEqual(vorschlag(mit), [['ta', 19100], ['tb', 11500], ['tc', 7600]])
  assert.ok(vorschlag(netto).every(([, c]) => Number(c) > 0))
})
