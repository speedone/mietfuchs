// Überschneidende Mietverhältnisse einer Wohnung (#204). Weiterrechnen wie erfasst, aber ein
// Hinweis der Stufe `error`, der beide Mieter, den Zeitraum und den Mehrbetrag nennt: was die
// Mieter dieser Wohnung im Jahr zusammen mehr tragen, als auf die Wohnung entfällt.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, NOTICE_KINDS } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const tenancy = (over: Pick<SnapshotTenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end'> & { persons?: number } & Partial<SnapshotTenancy>): SnapshotTenancy => ({
  persons: over.persons ?? 1, personHistory: [{ from: over.start, persons: over.persons ?? 1 }],
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const grundsteuer: SnapshotCostItem = { id: 'gs', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 120000, key: 'area' }

// Das Beispiel aus dem Issue: zwei Wohnungen zu je 50 m², 1.200 € Grundsteuer nach Fläche.
// Wohnung A: Xaver bis 30.09.2025, Yvonne ab 01.09.2025 — 30 Tage doppelt belegt.
const source = (tenancies: SnapshotTenancy[], costItems: SnapshotCostItem[] = [grundsteuer]): SnapshotSource => ({
  units: [
    { id: 'A', name: 'Wohnung A', areaM2: 50, participates: true },
    { id: 'B', name: 'Wohnung B', areaM2: 50, participates: true },
  ],
  tenancies, costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const xaver = tenancy({ id: 'x', unitId: 'A', tenantName: 'Xaver', start: '2023-01-01', end: '2025-09-30', persons: 2 })
const yvonne = tenancy({ id: 'y', unitId: 'A', tenantName: 'Yvonne', start: '2025-09-01', end: null, persons: 1 })
const zora = tenancy({ id: 'z', unitId: 'B', tenantName: 'Zora', start: '2020-01-01', end: null, persons: 2 })
const settle = (tenancies: SnapshotTenancy[], costItems?: SnapshotCostItem[], year = 2025) =>
  computeSettlement(snapshotOf(source(tenancies, costItems), year))
const overlapNotices = (s: ReturnType<typeof settle>) => s.notices.filter((n) => n.code === 'tenancy.overlap')

test('Beispiel aus dem Issue: Hinweis der Stufe error mit beiden Mietern, Zeitraum und 49,32 € Mehrbetrag', () => {
  const s = settle([xaver, yvonne, zora])
  const found = overlapNotices(s)
  assert.equal(found.length, 1)
  const n = found[0]
  assert.equal(n?.level, 'error')
  // „Hier beheben →“ führt zum früheren Mietverhältnis, dessen Auszug meist der Tippfehler ist.
  assert.deepEqual(n?.subject, { kind: 'tenancy', id: 'x' })
  const text = n?.text ?? ''
  assert.match(text, /Xaver/)
  assert.match(text, /Yvonne/)
  assert.match(text, /Wohnung A/)
  assert.match(text, /vom 01\.09\.2025 bis 30\.09\.2025 \(30 Tage\)/)
  // Von Hand: 1.200 € × 50/100 m² × 30/365 Tage = 49,3150… € → 49,32 €.
  assert.equal(Math.round(120000 * (50 / 100) * (30 / 365)), 4932)
  assert.match(text, /49,32 €/)
  for (const t of n?.terms ?? []) assert.ok(Object.hasOwn(GLOSSARY, t), `Begriff ${t} fehlt im Lexikon`)
  assert.equal(NOTICE_KINDS['tenancy.overlap']?.level, 'error')
})

test('Weitergerechnet wie erfasst: Anteile unverändert, der Mehrbetrag steht als negativer Leerstand beim Vermieter', () => {
  const s = settle([xaver, yvonne, zora])
  const share = (id: string) => s.statements.find((st) => st.tenancyId === id)?.rows[0]?.shareCents
  // 600 € × 273/365 und 600 € × 122/365, wie ohne den Hinweis
  assert.equal(share('x'), 44877)
  assert.equal(share('y'), 20055)
  assert.equal(share('z'), 60000)
  const vacancy = s.landlord.rows[0]?.landlordParts?.find((p) => p.reason === 'vacancy')?.cents
  assert.equal(vacancy, -4932)
})

test('Neben einer selbstgenutzten Wohnung: der Eigenanteil bleibt exakt, der Überhang steht ganz im Leerstand (b19b698)', () => {
  const snap = snapshotOf({
    ...source([xaver, yvonne]),
    units: [
      { id: 'A', name: 'Wohnung A', areaM2: 50, participates: true },
      { id: 'B', name: 'Wohnung B', areaM2: 50, participates: false, selfUsed: true, selfPersons: 1 },
    ],
  }, 2025)
  const s = computeSettlement(snap)
  const parts = s.landlord.rows[0]?.landlordParts ?? []
  assert.equal(parts.find((p) => p.reason === 'selfUse')?.cents, 60000)
  assert.equal(parts.find((p) => p.reason === 'vacancy')?.cents, -4932)
  assert.match(overlapNotices(s)[0]?.text ?? '', /49,32 €/)
})

test('Personenschlüssel: Mehrbetrag aus der Verteilbasis nachgerechnet, beide Lesarten genannt (Durchsicht V2)', () => {
  const muell: SnapshotCostItem = { id: 'm', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Müll', amountCents: 73000, key: 'persons' }
  const s = settle([xaver, yvonne, zora], [muell])
  // Personentage: Xaver 2 × 273 = 546, Yvonne 1 × 122 = 122, Zora 2 × 365 = 730, zusammen 1.398;
  // Wohnung A trägt 668/1.398. In den 30 Tagen zählen Xaver 60 und Yvonne 30 Personentage doppelt.
  // Beim Personenschlüssel stecken sie auch in der Verteilbasis, deshalb wird ohne sie neu geteilt:
  // Ohne Yvonnes 30 trüge A 638/1.368, ohne Xavers 60 trüge A 608/1.338. Welches Datum falsch ist,
  // weiß nur der Vermieter, deshalb stehen beide Beträge da:
  // ohne Xavers Tage 730 € × (668/1.398 − 608/1.338) = 17,093… € → 17,09 €,
  // ohne Yvonnes Tage 730 € × (668/1.398 − 638/1.368) = 8,359… € → 8,36 €.
  assert.equal(Math.round(73000 * (668 / 1398 - 608 / 1338)), 1709)
  assert.equal(Math.round(73000 * (668 / 1398 - 638 / 1368)), 836)
  assert.match(overlapNotices(s)[0]?.text ?? '',
    /Ist bei Xaver ein Datum falsch, tragen die Mieter dieser Wohnung 2025 bei den betroffenen Positionen zusammen 17,09 € mehr, als auf die Wohnung entfällt; ist es bei Yvonne falsch, 8,36 €\./)
})

test('Personenschlüssel mit Pauschale: nur eine Lesart wirkt, der Text sagt welche (Durchsicht V1)', () => {
  const muell: SnapshotCostItem = { id: 'm', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Müll', amountCents: 73000, key: 'persons' }
  const pauschal = tenancy({ ...yvonne, costModel: 'flatRate' })
  // Zugebucht wird nur Xaver (546 Personentage). Ohne seine 60 doppelten: 730 € × (546/1.398 − 486/1.338)
  // = 19,950… € → 19,95 €. Ohne Yvonnes Tage trüge Xaver mehr, nicht weniger: kein Betrag zu viel.
  assert.equal(Math.round(73000 * (546 / 1398 - 486 / 1338)), 1995)
  const text = overlapNotices(settle([xaver, pauschal, zora], [muell]))[0]?.text ?? ''
  assert.match(text, /Ist bei Xaver ein Datum falsch, tragen die Mieter dieser Wohnung 2025 bei den betroffenen Positionen zusammen 19,95 € mehr, als auf die Wohnung entfällt; ist es bei Yvonne falsch, tragen die Mieter dieser Wohnung dadurch 2025 nicht zu viel\./)
  // Integrationsdurchsicht: Die Lesart „Yvonne“ ist 0, weil zur Seite „zu viel“ geklemmt wird. Die
  // Anteile verschieben sich aber, zugunsten der Mieter: Ohne Yvonnes 30 Personentage trüge Xaver
  // 730 € × 546/1.368 statt 546/1.398, also mehr. „Wirkt sich nicht aus“ wäre deshalb falsch.
  assert.ok(73000 * 546 / 1368 > 73000 * 546 / 1398)
  assert.doesNotMatch(text, /nicht aus/)
})

test('Mehrere Positionen: der Mehrbetrag ist die Summe über alle, auf den Cent erst am Ende gerundet', () => {
  const muell: SnapshotCostItem = { id: 'm', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Müll', amountCents: 73000, key: 'persons' }
  const s = settle([xaver, yvonne, zora], [grundsteuer, muell])
  // Je Lesart summiert: ohne Xavers Tage 4.931,507 ct + 1.709,361 ct = 6.640,87 ct → 66,41 €,
  // ohne Yvonnes Tage 4.931,507 ct + 835,937 ct = 5.767,44 ct → 57,67 €.
  assert.equal(Math.round(60000 * 30 / 365 + 73000 * (668 / 1398 - 608 / 1338)), 6641)
  assert.equal(Math.round(60000 * 30 / 365 + 73000 * (668 / 1398 - 638 / 1368)), 5767)
  assert.match(overlapNotices(s)[0]?.text ?? '', /Xaver.*66,41 €.*Yvonne falsch, 57,67 €/)
})

test('Kein Hinweis: lückenlos, andere Wohnung, Überschneidung nur in einem anderen Jahr', () => {
  const lueckenlos = tenancy({ ...yvonne, start: '2025-10-01' })
  assert.equal(overlapNotices(settle([xaver, lueckenlos, zora])).length, 0)
  const andereWohnung = tenancy({ ...yvonne, unitId: 'B' })
  assert.equal(overlapNotices(settle([xaver, andereWohnung])).length, 0)
  // Überschneidung im September 2025, abgerechnet wird 2026
  assert.equal(overlapNotices(settle([xaver, yvonne, zora], [{ ...grundsteuer, period: calendarPeriod(2026) }], 2026)).length, 0)
})

test('Über den Jahreswechsel: der Zeitraum steht ganz da, beziffert wird nur das Abrechnungsjahr', () => {
  const alt = tenancy({ id: 'x', unitId: 'A', tenantName: 'Xaver', start: '2023-01-01', end: '2025-01-31' })
  const neu = tenancy({ id: 'y', unitId: 'A', tenantName: 'Yvonne', start: '2024-12-01', end: null })
  const text = overlapNotices(settle([alt, neu, zora]))[0]?.text ?? ''
  assert.match(text, /vom 01\.12\.2024 bis 31\.01\.2025/)
  assert.match(text, /davon 31 Tage in 2025/)
  // 1.200 € × 50/100 × 31/365 = 50,958… € → 50,96 €
  assert.equal(Math.round(120000 * 0.5 * 31 / 365), 5096)
  assert.match(text, /50,96 €/)
})

test('Fläche mit Pauschale: zu viel nur, wenn Xavers Datum falsch ist; der Text sagt es so (Durchsicht V1)', () => {
  const pauschal = tenancy({ ...yvonne, costModel: 'flatRate' })
  const n = overlapNotices(settle([xaver, pauschal, zora]))[0]
  assert.equal(n?.level, 'error')
  // Xaver trägt 1.200 € × 50/100 × 30/365 = 49,32 € für Tage, die vielleicht Yvonne gehören;
  // Yvonne trägt mit Pauschale nichts, ist ihr Einzug falsch, zahlt kein Mieter zu viel.
  assert.match(n?.text ?? '', /Ist bei Xaver ein Datum falsch, tragen die Mieter dieser Wohnung 2025 bei den betroffenen Positionen zusammen 49,32 € mehr, als auf die Wohnung entfällt; ist es bei Yvonne falsch, tragen die Mieter dieser Wohnung dadurch 2025 nicht zu viel\./)
  assert.doesNotMatch(n?.text ?? '', /nicht aus/)
})

test('Gutschrift: die Mieter bekommen zu viel gutgeschrieben, kein „−49,32 € mehr“ (Durchsicht V2)', () => {
  const text = overlapNotices(settle([xaver, yvonne, zora], [{ ...grundsteuer, amountCents: -120000 }]))[0]?.text ?? ''
  assert.match(text, /Die Mieter dieser Wohnung bekommen 2025 bei den betroffenen Gutschriften zusammen 49,32 € mehr gutgeschrieben, als auf die Wohnung entfällt\./)
  assert.doesNotMatch(text, /−|-49/)
})

test('Kosten und Gutschrift zusammen: beide Richtungen getrennt genannt, kein Nettobetrag (Integrationsdurchsicht)', () => {
  // 1.200 € Kosten: 1.200 € × 50/100 × 30/365 = 49,32 € zu viel getragen;
  // 300 € Gutschrift: 300 € × 50/100 × 30/365 = 12,33 € zu viel gutgeschrieben.
  assert.equal(Math.round(120000 * 0.5 * 30 / 365), 4932)
  assert.equal(Math.round(30000 * 0.5 * 30 / 365), 1233)
  const text = overlapNotices(settle([xaver, yvonne, zora], [grundsteuer, { ...grundsteuer, id: 'gut', amountCents: -30000 }]))[0]?.text ?? ''
  assert.match(text, /Die Mieter dieser Wohnung tragen 2025 bei den betroffenen Kosten zusammen 49,32 € mehr, als auf die Wohnung entfällt, und bekommen 12,33 € mehr gutgeschrieben\./)
})

test('Verbrauchsschlüssel: Mehrbetrag nach dem Verbrauch in der Überschneidung', () => {
  // Wohnung A und B je ein Zähler, je 1 m³ am Tag; 365 € Wasser auf 730 m³.
  const wasser: SnapshotCostItem = { id: 'w', period: calendarPeriod(2025), category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 36500, key: 'meter', meterType: 'kaltwasser' }
  const snap = snapshotOf({
    ...source([xaver, yvonne, zora], [wasser]),
    meters: [{ id: 'mA', unitId: 'A', type: 'kaltwasser' }, { id: 'mB', unitId: 'B', type: 'kaltwasser' }],
    readings: [
      { meterId: 'mA', date: '2024-12-31', value: 0 }, { meterId: 'mA', date: '2025-12-31', value: 365 },
      { meterId: 'mB', date: '2024-12-31', value: 0 }, { meterId: 'mB', date: '2025-12-31', value: 365 },
    ],
  }, 2025)
  // In den 30 Tagen wurden in A 30 m³ gemessen, beiden zugerechnet: 365 € × 30/730 = 15,00 €.
  assert.match(overlapNotices(computeSettlement(snap))[0]?.text ?? '', /15,00 €/)
})

test('Verbrauchsschlüssel mit ungleichem Verbrauch: geteilt wird nach dem Verbrauch der Überschneidung, nicht nach Tagen (Durchsicht S1)', () => {
  // Wohnung A: 243 m³ bis 31.08., 300 m³ im September, 92 m³ danach; B 365 m³. 1.000 € auf 1.000 m³.
  // Beide bekommen die 300 m³ des Septembers: 1.000 € × 300/1.000 = 300,00 € zu viel, in beiden Lesarten.
  // Nach Tagen gerechnet wären es 543 × 30/273 = 59,67 € und 392 × 30/122 = 96,39 €.
  const wasser: SnapshotCostItem = { id: 'w', period: calendarPeriod(2025), category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' }
  const snap = snapshotOf({
    ...source([xaver, yvonne, zora], [wasser]),
    meters: [{ id: 'mA', unitId: 'A', type: 'kaltwasser' }, { id: 'mB', unitId: 'B', type: 'kaltwasser' }],
    readings: [
      { meterId: 'mA', date: '2024-12-31', value: 0 }, { meterId: 'mA', date: '2025-08-31', value: 243 },
      { meterId: 'mA', date: '2025-09-30', value: 543 }, { meterId: 'mA', date: '2025-12-31', value: 635 },
      { meterId: 'mB', date: '2024-12-31', value: 0 }, { meterId: 'mB', date: '2025-12-31', value: 365 },
    ],
  }, 2025)
  const text = overlapNotices(computeSettlement(snap))[0]?.text ?? ''
  assert.match(text, /Die Mieter dieser Wohnung tragen 2025 bei den betroffenen Positionen zusammen 300,00 € mehr, als auf die Wohnung entfällt\./)
})

test('Einzelbeträge: der Messdienst teilt selbst auf, nichts doppelt', () => {
  const heiz: SnapshotCostItem = { id: 'h', period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Heizung', amountCents: 100000, key: 'amounts', tenancyAmounts: { x: 30000, y: 20000, z: 50000 } }
  const n = overlapNotices(settle([xaver, yvonne, zora], [heiz]))[0]
  assert.match(n?.text ?? '', /Die Mieter dieser Wohnung tragen dadurch 2025 nicht zu viel\./)
})
