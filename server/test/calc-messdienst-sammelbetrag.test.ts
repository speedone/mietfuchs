// Sammelbetrag des Messdienstes (#704): Der Messdienst rechnet Heizung, Warmwasser, Kaltwasser und Abwasser in einem
// Betrag je Nutzer ab und teilt die CO₂-Kosten selbst auf. Der Haken `includesWater` an der Position ändert nur die
// Bezeichnung und die Hinweise, nie eine Zahl; die Antwort `serviceEnclosed` in der Karte „CO₂-Kosten“ schaltet Probe
// und Buchung ab und verweist auf die beiliegende Heizkostenabrechnung des Messdienstes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { INFORMATIONAL } from '../../shared/notices.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { CO2_DEDUCTED_LABEL, CO2_ENCLOSED_LABEL } from '../../shared/co2Probe.ts'
import type { Co2Statement } from '../../shared/types.ts'

const P = calendarPeriod(2025)
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const own = (id: string): SnapshotUnit => unit(id, { participates: false, selfUsed: true, selfPersons: 1 })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [{ from: '2020-01-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const messdienst = (amountCents: number, tenancyAmounts: Record<string, number>, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'hz', period: P, category: HEATING_CATEGORY, description: 'Abrechnung des Messdienstes', amountCents, key: 'amounts', tenancyAmounts,
  heatingPlantId: 'hp', ...over,
})
const cost = (id: string, category: string, amountCents: number, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id, period: P, category, description: id, amountCents, key: 'area', ...over,
})
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, ...over,
})
const co2 = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: P, method: 'serviceEnclosed', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const snap = (s: Partial<SnapshotSource>, statements: Co2Statement[], plants: SnapshotHeatingPlant[] = [plant()]): Snapshot =>
  ({ ...snapshotOf(source(s), 2025), heatingPlants: plants, co2Statements: statements })
const settle = (s: Partial<SnapshotSource>, statements: Co2Statement[] = [], plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement(snap(s, statements, plants))
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)

// Alles, was Geld ist: je Mieter Zeilen, Summen, Vorauszahlung und Saldo, dazu der Vermieter. Ohne Bezeichnungen.
export const money = (r: ComputedSettlement) => ({
  total: r.totalCostsCents,
  self: r.selfUsedShareCents,
  statements: r.statements.map((st) => ({
    id: st.tenancyId, total: st.totalShareCents, labor: st.total35aCents, prepayment: st.prepaymentCents, balance: st.balanceCents, suggested: st.suggestedMonthlyCents,
    rows: st.rows.map((x) => [x.costItemId, x.kind ?? null, x.totalCents, x.shareCents, x.labor35aCents ?? 0]),
  })),
  landlord: { total: r.landlord.totalCents, rows: r.landlord.rows.map((x) => [x.costItemId, x.totalCents, x.shareCents, x.landlordParts ?? null]) },
})

const haus = { units: [unit('a'), unit('b'), own('c')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')] }
const BETRAEGE = { ta: 182340, tb: 151275 }
const sammel = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => messdienst(410000, BETRAEGE, { selfAmounts: { c: 76385 }, ...over })

test('Haken: dieselben Summen, Zeilenbeträge, Vorauszahlungen und Salden wie ohne; die Zeile trägt das Kennzeichen', () => {
  const kalt = cost('grundsteuer', 'Grundsteuer', 90000)
  const ohne = settle({ ...haus, costItems: [sammel(), kalt] })
  const mit = settle({ ...haus, costItems: [sammel({ includesWater: true }), kalt] })
  assert.deepEqual(money(mit), money(ohne))
  for (const st of mit.statements) {
    const row = st.rows.find((x) => x.costItemId === 'hz') ?? assert.fail('keine Heizzeile')
    assert.equal(row.category, HEATING_CATEGORY, 'die Kostenart bleibt der Datenwert')
    assert.equal(row.includesWater, true)
    assert.ok(st.rows.filter((x) => x.costItemId !== 'hz').every((x) => x.includesWater === undefined))
  }
  assert.equal(mit.landlord.rows.find((x) => x.costItemId === 'hz')?.includesWater, true)
  assert.ok(ohne.statements.every((st) => st.rows.every((x) => !('includesWater' in x))), 'ohne Haken kein neues Feld in den Zeilen')
  assert.ok(ohne.landlord.rows.every((x) => !('includesWater' in x)))
  // Die Hinweise ohne Haken und mit Haken sind dieselben (ohne zweite Wasserposition und ohne CO₂-Angaben); nur der
  // Kürzungsbetrag in co2.missing steht mit Haken als Höchstbetrag (Durchsicht S1, eigener Test unten).
  // Dazu kommt mit Haken die Warnung zur Sammelzeile (`amounts.combined-line`, eigener Test unten).
  const rest = (r: ComputedSettlement) => r.notices.filter((n) => n.code !== 'co2.missing' && n.code !== 'amounts.combined-line')
  assert.deepEqual(codes(mit).filter((c) => c !== 'amounts.combined-line'), codes(ohne))
  assert.deepEqual(rest(mit), rest(ohne))
})

test('„Liegt bei“ (serviceEnclosed): kein co2.missing, kein co2.sum-check, keine Buchung, ein ruhiger Hinweis', () => {
  const s = { ...haus, costItems: [sammel({ includesWater: true })] }
  const ohne = settle(s)
  assert.ok(codes(ohne).includes('co2.missing'), 'ohne Angaben warnt die Abrechnung wie bisher')
  const r = settle(s, [co2({})])
  for (const code of ['co2.missing', 'co2.sum-check', 'co2.sum-check-approx', 'co2.service-unsplit', 'co2.incomplete', 'co2.stage-mismatch', 'co2.pool-foreign-item']) {
    assert.ok(!codes(r).includes(code), `${code} trotz der neuen Antwort`)
  }
  const hints = r.notices.filter((n) => n.code === 'co2.service-enclosed')
  assert.equal(hints.length, 1)
  assert.equal(hints[0]?.level, 'hint')
  assert.deepEqual(hints[0]?.subject, { kind: 'heatingCosts', id: 'hp' })
  assert.match(textOf(r, 'co2.service-enclosed'), /§ 7 Abs\. 3 CO2KostAufG/)
  assert.match(textOf(r, 'co2.service-enclosed'), /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\)/)
  assert.match(textOf(r, 'co2.service-enclosed'), /weil die Heizkostenabrechnung des Messdienstes mit dem Abschnitt zu den CO₂-Kosten jeder Abrechnung beiliegt/)
  // Nachprüfung 7: einmal gesagt, nicht zweimal.
  assert.doesNotMatch(textOf(r, 'co2.service-enclosed'), /Legen Sie jedem Mieter/)
  // Keine Buchung: keine Abzugszeile, kein co2Share beim Vermieter, jeder Mieter trägt seinen Einzelbetrag.
  assert.ok(r.statements.every((st) => st.rows.every((x) => x.kind !== 'co2Relief')))
  assert.ok(r.landlord.rows.every((x) => (x.landlordParts ?? []).every((p) => p.reason !== 'co2Share')))
  assert.deepEqual(money(r), money(ohne))
  // Der Ausweis: nicht gebucht, die Methode steht da, und genannt sind die Mieter mit einer Zeile aus dem Topf.
  const c = r.heating?.[0]?.co2 ?? assert.fail('kein CO₂-Ausweis')
  assert.deepEqual([c.method, c.booked, c.deducted, c.tenants.length], ['serviceEnclosed', false, false, 0])
  assert.deepEqual([...(c.enclosedFor ?? [])].sort(), ['ta', 'tb'])
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.cut.missing'), 'der Kürzungssatz friert mit ein')
})

test('Neue Antwort mit früher eingetragenen Werten: die Werte bleiben unbenutzt, nichts wird geprüft oder gebucht', () => {
  const s = { ...haus, costItems: [sammel({ includesWater: true })] }
  const r = settle(s, [co2({ serviceUsersTotalCents: 100, serviceLandlordCents: 5000, serviceUnitsCount: 3, serviceTotalCents: 20000, serviceLandlordPermille: 400, serviceKgPerM2: 30 })])
  assert.deepEqual(codes(r).filter((c) => c.startsWith('co2.')), ['co2.service-enclosed'])
  assert.deepEqual(money(r), money(settle(s)))
})

test('Neue Antwort steht jeder Messdienstposition offen, auch ohne Haken; wer keine Zeile aus dem Topf hat, bekommt keinen Hinweis', () => {
  const r = settle({ ...haus, costItems: [sammel()] }, [co2({})])
  assert.deepEqual(codes(r).filter((c) => c.startsWith('co2.')), ['co2.service-enclosed'])
  // Nur Pauschalmieter: Niemand hat eine Zeile aus dem Topf, also auch kein Hinweis (wie bei den übrigen des Topfs).
  const pauschal = { units: haus.units, tenancies: haus.tenancies.map((t) => ({ ...t, heatingModel: 'flatRate' as const })) }
  const p = settle({ ...pauschal, costItems: [sammel()] }, [co2({})])
  assert.ok(!codes(p).includes('co2.service-enclosed'))
})

test('Haken und eine der bisherigen Antworten: co2.sum-check nennt, warum die Probe nicht aufgehen kann, und die neue Antwort', () => {
  const st = co2({ method: 'serviceDeducted', serviceUsersTotalCents: 250000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })
  const mit = settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [st])
  assert.equal(mit.notices.find((n) => n.code === 'co2.sum-check')?.level, 'error')
  assert.match(textOf(mit, 'co2.sum-check'), /enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)
  assert.match(textOf(mit, 'co2.sum-check'), /„Nicht eintragen: Die Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei“/)
  // Ohne Haken bleibt der Wortlaut, wie er war.
  const ohne = settle({ ...haus, costItems: [sammel()] }, [st])
  assert.doesNotMatch(textOf(ohne, 'co2.sum-check'), /Kaltwasser/)
  const bereinigt = textOf(mit, 'co2.sum-check')
    .replace(/ „Abrechnung des Messdienstes“ enthält nach Ihrer Angabe[^]*?damit Mietfuchs den Anteil des Vermieters abziehen kann\./, '')
    .replace(', hier höchstens: ', ', hier: ').replace(' (die Beträge enthalten auch Kaltwasser und Abwasser, auf die sich die Kürzung nicht bezieht)', '')
  assert.equal(bereinigt, textOf(ohne, 'co2.sum-check'))
  // Geht die Probe trotz Haken auf, steht der Satz nirgends.
  const passt = settle({ ...haus, costItems: [sammel({ includesWater: true, selfAmounts: { c: 66385 } })] }, [co2({ method: 'serviceDeducted', serviceUsersTotalCents: 400000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })])
  assert.ok(!codes(passt).includes('co2.sum-check'))
})

test('Doppelerfassung: Warnung, wenn daneben eine umlagefähige Position „Wasser/Abwasser“ auf dieselben Mieter geht', () => {
  const wasser = cost('wasser', 'Wasser/Abwasser', 64000, { description: 'Stadtwerke Wasser', key: 'persons' })
  const r = settle({ ...haus, costItems: [sammel({ includesWater: true }), wasser] })
  const n = r.notices.filter((x) => x.code === 'amounts.water-twice')
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'warning')
  assert.deepEqual(n[0]?.subject, { kind: 'costItem', id: 'wasser' })
  const text = textOf(r, 'amounts.water-twice')
  assert.match(text, /„Abrechnung des Messdienstes“ \(4\.100,00 €\)/)
  assert.match(text, /„Stadtwerke Wasser“ \(640,00 €\)/)
  assert.match(text, /Prüfen Sie/)
  assert.match(text, /Gartenwasser/)
  // Die Warnung ändert keine Zahl.
  assert.deepEqual(money(r), money(settle({ ...haus, costItems: [sammel(), wasser] })))
})

test('Doppelerfassung: nicht ohne Haken, nicht bei „Nicht umlagefähig“, nicht in einem anderen Zeitraum, nicht bei anderen Mietern', () => {
  const wasser = cost('wasser', 'Wasser/Abwasser', 64000, { key: 'persons' })
  const twice = (r: ComputedSettlement): boolean => codes(r).includes('amounts.water-twice')
  assert.ok(!twice(settle({ ...haus, costItems: [sammel(), wasser] })), 'ohne Haken')
  assert.ok(!twice(settle({ ...haus, costItems: [sammel({ includesWater: true }), cost('wasser', 'Nicht umlagefähig', 64000)] })), 'nicht umlagefähig')
  assert.ok(!twice(settle({ ...haus, costItems: [sammel({ includesWater: true }), { ...wasser, period: calendarPeriod(2024) }] })), 'anderer Zeitraum')
  // Die Wasserposition geht nur an eine Wohnung, die im Sammelbetrag nicht steht.
  const drei = { units: [unit('a'), unit('b'), unit('d')], tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b'), tenancy('td', 'd')] }
  const fremd = settle({ ...drei, costItems: [messdienst(333615, BETRAEGE, { includesWater: true }), { ...wasser, key: 'direct', directUnitId: 'd' }] })
  assert.ok(!twice(fremd), 'andere Mieter')
  // Zwei Wasserpositionen: je Position eine Warnung, jede an ihrer Position.
  const zwei = settle({ ...haus, costItems: [sammel({ includesWater: true }), wasser, cost('abwasser', 'Wasser/Abwasser', 30000)] })
  assert.deepEqual(zwei.notices.filter((n) => n.code === 'amounts.water-twice').map((n) => n.subject?.id).sort(), ['abwasser', 'wasser'])
})

// Invariante über zufällige Bestände mit festem Startwert: Haken und neue Antwort ändern keine Summe.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('Invariante: über 300 zufällige Bestände ändern Haken und neue Antwort keinen Betrag; die Zeilen ergeben die Gesamtkosten', () => {
  const r = mulberry32(704)
  const int = (min: number, max: number): number => min + Math.floor(r() * (max - min + 1))
  for (let run = 0; run < 300; run++) {
    const n = int(1, 6)
    const units: SnapshotUnit[] = []
    const tenancies: SnapshotTenancy[] = []
    const amounts: Record<string, number> = {}
    const selfAmounts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const id = `u${i}`
      const kind = r()
      if (kind < 0.15) {
        units.push(own(id))
        if (r() < 0.8) selfAmounts[id] = int(0, 200000)
        continue
      }
      units.push(unit(id, { areaM2: int(20, 140) }))
      if (kind < 0.25) continue // Leerstand
      const model = r() < 0.1 ? 'flatRate' as const : r() < 0.1 ? 'inclusive' as const : undefined
      // Mieterwechsel im Jahr bei einem Teil der Wohnungen.
      if (r() < 0.3) {
        tenancies.push(tenancy(`${id}-1`, id, { end: '2025-06-30', persons: int(1, 4) }), tenancy(`${id}-2`, id, { start: '2025-07-01', persons: int(1, 4) }))
        amounts[`${id}-1`] = int(0, 150000)
        if (r() < 0.9) amounts[`${id}-2`] = int(0, 150000)
      } else {
        tenancies.push(tenancy(`${id}-1`, id, { persons: int(1, 5), ...(model ? { heatingModel: model } : {}) }))
        if (r() < 0.9) amounts[`${id}-1`] = int(0, 250000)
      }
    }
    const entered = [...Object.values(amounts), ...Object.values(selfAmounts)].reduce((a, c) => a + c, 0)
    // Meist deckt der Betrag die Einzelbeträge (mit Rest), manchmal liegt er darunter (dann geht alles an den Vermieter).
    const amountCents = r() < 0.9 ? entered + int(0, 30000) : Math.max(0, entered - int(1, 5000))
    const others = [
      cost('grundsteuer', 'Grundsteuer', int(10000, 200000)),
      ...(r() < 0.5 ? [cost('wasser', 'Wasser/Abwasser', int(5000, 150000), { key: r() < 0.5 ? 'persons' : 'area' })] : []),
      ...(r() < 0.3 ? [cost('wartung', HEATING_CATEGORY, int(5000, 40000), { heatingPlantId: 'hp' })] : []),
    ]
    const item = (includesWater: boolean): SnapshotCostItem => messdienst(amountCents, amounts, { selfAmounts, ...(includesWater ? { includesWater: true } : {}) })
    const base = settle({ units, tenancies, costItems: [item(false), ...others] })
    const flagged = settle({ units, tenancies, costItems: [item(true), ...others] })
    const enclosed = settle({ units, tenancies, costItems: [item(true), ...others] }, [co2({})])
    const where = `Lauf ${run}`
    assert.deepEqual(money(flagged), money(base), `${where}: Haken`)
    assert.deepEqual(money(enclosed), money(base), `${where}: neue Antwort`)
    assert.ok(!codes(enclosed).includes('co2.missing') && !codes(enclosed).includes('co2.sum-check'), where)
    assert.ok(enclosed.notices.filter((x) => x.code === 'co2.service-enclosed').length <= 1, where)
    // Mieteranteile + Vermieteranteil = Gesamtkosten, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil.
    const tenants = enclosed.statements.reduce((a, st) => a + st.totalShareCents, 0)
    assert.equal(tenants + enclosed.landlord.totalCents, enclosed.totalCostsCents, where)
    assert.ok(enclosed.statements.every((st) => st.rows.every((x) => x.shareCents >= 0)), where)
    assert.ok(enclosed.selfUsedShareCents <= enclosed.landlord.totalCents, where)
    // Die Warnung zur Doppelerfassung steht genau dann, wenn ein Mieter beide Zeilen trägt.
    const both = flagged.statements.some((st) => st.rows.some((x) => x.costItemId === 'hz' && x.shareCents > 0) && st.rows.some((x) => x.costItemId === 'wasser' && x.shareCents !== 0))
    assert.equal(codes(flagged).includes('amounts.water-twice'), both, where)
  }
})

// ---------- Befunde der Durchsicht ----------

// M1: „liegt bei“ gilt nur beim Vorwegabzug. Hinweis und Zusatz in co2.sum-check nennen die Voraussetzung und den Weg.
test('Durchsicht M1: der Hinweis nennt die Voraussetzung Vorwegabzug; co2.sum-check nennt den Weg über „Ja“ und sagt, dass der Sammelbetrag bei „nur ausgewiesen“ nicht passt', () => {
  assert.equal(CO2_ENCLOSED_LABEL, 'Nicht eintragen: Die Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei')
  assert.equal(CO2_DEDUCTED_LABEL, 'Ja, es gibt eine Abzugszeile')
  const hint = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [co2({})]), 'co2.service-enclosed')
  assert.match(hint, /vor der Verteilung abgezogen/)
  assert.match(hint, /Weist die Abrechnung den Anteil nur aus, muss Mietfuchs ihn abziehen, sonst tragen die Mieter ihn mit/)
  for (const method of ['serviceDeducted', 'serviceShown'] as const) {
    const text = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [co2({ method, serviceUsersTotalCents: 250000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })]), 'co2.sum-check')
    assert.match(text, /nach „Ja, es gibt eine Abzugszeile“ die Angabe „Nicht eintragen: Die Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei“/)
    assert.match(text, /Weist die Abrechnung den Anteil nur aus, passt der Sammelbetrag nicht/)
    assert.match(text, /als getrennte Positionen/)
  }
})

// S6, S10: Die Pflicht trifft den Vermieter; ob der Verweis genügt, ist nicht entschieden. Kein Steuersatz mehr im Hinweis.
test('Durchsicht S6/S10: der Hinweis behauptet nicht, die Beilage genüge, und ist gekürzt', () => {
  const hint = textOf(settle({ units: [unit('a'), unit('b')], tenancies: haus.tenancies, costItems: [messdienst(333615, BETRAEGE)] }, [co2({})]), 'co2.service-enclosed')
  assert.match(hint, /Nach § 7 Abs\. 3 CO2KostAufG weisen Sie in der Heizkostenabrechnung den Anteil des Mieters an den CO₂-Kosten, die Einstufung des Gebäudes und die Berechnungsgrundlagen aus; fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\)\./)
  assert.match(hint, /Ob der Verweis auf die beiliegende Abrechnung des Messdienstes dafür genügt, ist nicht entschieden\./)
  assert.doesNotMatch(hint, /druckt keinen eigenen Ausweis/)
  assert.doesNotMatch(hint, /Werbungskosten/)
  assert.doesNotMatch(hint, /selbst bewohnt/)
})

// M2: Bewohnt der Vermieter selbst eine Wohnung, gehört sein Teil des CO₂-Anteils in den Eigenbetrag und ist privat.
// Messdienst mit Abzugszeile, S = 3.000 € (Mieter 1.400 € und 1.000 €, eigene Wohnung 600 €), L = 100 €, L_self = 20 €.
const P25 = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
const mitEigener = (statement: Co2Statement, amountCents: number, selfCents: number): Snapshot => snapshotFor({
  properties: [{ id: 'o', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ ...unit('a'), propertyId: 'o' }, { ...unit('b'), propertyId: 'o' }, { ...own('c'), propertyId: 'o' }],
  tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
  costItems: [{ ...messdienst(amountCents, { ta: 140000, tb: 100000 }, { selfAmounts: { c: selfCents } }), propertyId: 'o', period: P25.key }],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [{ ...plant(), propertyId: 'o' }],
  co2Statements: [{ ...statement, period: P25.key }],
} as unknown as Parameters<typeof snapshotFor>[0], 'o', P25)
const taxOf = (s: Snapshot) => {
  const x = taxReport(s).expenses.items.find((i) => i.costItemId === 'hz') ?? assert.fail('Position fehlt in der Steuerübersicht')
  return [x.amountCents, x.privateCents, x.deductibleCents]
}

test('Durchsicht M2: „liegt bei“ mit Betrag S + L und Eigenbetrag + L_self ergibt dieselbe Steuer wie die Abzugszeile mit Angaben; der Hinweis nennt die eigene Wohnung genau dann, wenn es einen Eigenbetrag gibt', () => {
  const deducted = mitEigener(co2({ method: 'serviceDeducted', serviceUsersTotalCents: 300000, serviceLandlordCents: 10000, serviceUnitsCount: 3 }), 310000, 60000)
  const enclosed = mitEigener(co2({}), 310000, 62000)
  assert.deepEqual(taxOf(deducted), [310000, 62000, 248000])
  assert.deepEqual(taxOf(enclosed), taxOf(deducted))
  // Ohne L_self im Eigenbetrag stünden 20 € zu viel in den Werbungskosten; deshalb sagt es der Hinweis.
  assert.deepEqual(taxOf(mitEigener(co2({}), 310000, 60000)), [310000, 60000, 250000])
  const mit = textOf(computeSettlement(enclosed), 'co2.service-enclosed')
  // Nachprüfung 8: Der Satz sagt, was zu tun ist.
  assert.match(mit, /Setzen Sie den CO₂-Anteil des Vermieters als Werbungskosten an, tragen Sie den Eigenbetrag Ihrer selbst bewohnten Wohnung um den Teil erhöht ein, der auf sie entfällt; er ist privat\./)
  const ohne = textOf(settle({ units: [unit('a'), unit('b')], tenancies: haus.tenancies, costItems: [messdienst(333615, BETRAEGE)] }, [co2({})]), 'co2.service-enclosed')
  assert.doesNotMatch(ohne, /selbst bewohnte/)
})

// S1: Die Kürzung bezieht sich auf die Heizkosten; im Sammelbetrag steckt auch Wasser. Der Betrag steht dann als Höchstbetrag.
test('Durchsicht S1: Kürzungsbeträge auf einen Sammelbetrag stehen als „höchstens“ mit dem Grund; ohne Haken wortgleich wie bisher', () => {
  const ohne = textOf(settle({ ...haus, costItems: [sammel()] }), 'co2.missing')
  const mit = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true })] }), 'co2.missing')
  assert.match(ohne, /\(§ 7 Abs\. 4 CO2KostAufG\), hier: ta \(a\) 54,70 € und tb \(b\) 45,38 €\./)
  assert.match(mit, /\(§ 7 Abs\. 4 CO2KostAufG\), hier höchstens: ta \(a\) 54,70 € und tb \(b\) 45,38 € \(die Beträge enthalten auch Kaltwasser und Abwasser, auf die sich die Kürzung nicht bezieht\)\./)
  const check = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [co2({ method: 'serviceDeducted', serviceUsersTotalCents: 250000, serviceLandlordCents: 10000, serviceUnitsCount: 3 })]), 'co2.sum-check')
  assert.match(check, /hier höchstens: /)
})

// S3, S4: Der Ausweg ist, die Rechnung des Versorgers gar nicht zu erfassen, nicht „Nicht umlagefähig“.
test('Durchsicht S3/S4: die Warnung zur Doppelerfassung rät, die Versorgerrechnung gar nicht als eigene Position zu erfassen, und nennt einen häufigeren berechtigten Fall', () => {
  const text = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true }), cost('wasser', 'Wasser/Abwasser', 64000, { key: 'persons' })] }), 'amounts.water-twice')
  assert.match(text, /Dann erfassen Sie die Rechnung des Versorgers gar nicht als eigene Position; ihre Kosten stecken schon im Betrag des Messdienstes\./)
  assert.doesNotMatch(text, /umlagefähige Position/)
  assert.match(text, /etwa Wasser einer Wohnung, die der Messdienst nicht abrechnet, oder Gartenwasser/)
})

// S11: Ohne CO₂-Pflicht (Pellets) gibt es weder Hinweis noch Verweis, und auch keine andere CO₂-Meldung.
test('Durchsicht S11: bei einem Energieträger ohne CO₂-Kosten ergibt „liegt bei“ weder Hinweis noch Verweis im Druck', () => {
  const r = settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [co2({})], [plant({ energy: 'pellets' })])
  assert.deepEqual(codes(r).filter((c) => c.startsWith('co2.')), [])
  assert.equal(r.heating?.[0]?.co2 ?? null, null)
  assert.deepEqual(money(r), money(settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [], [plant({ energy: 'pellets' })])))
})

// S2: Zwei Anlagen im selben Gebäude. H1 mit freien Schlüsseln und Lieferung teilt selbst auf, H2 rechnet der Messdienst ab.
const lieferung = { id: 'd1', plantId: 'H1', label: 'Gas', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', unitId: null, amountCents: null, quantity: null, quantityUnit: null,
  energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 12000, co2CostCents: 66000, emissionFactor: null, gridFeeCents: null, bioCostCents: null,
  sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], creditNoteKind: null }
const zweiAnlagen = (statement: Co2Statement): ComputedSettlement => computeSettlement(snapshotFor({
  properties: [{ id: 'o', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: ['a', 'b', 'c'].map((id) => ({ ...unit(id, { areaM2: 100 }), propertyId: 'o' })), tenancies: ['a', 'b', 'c'].map((u) => tenancy(`t${u}`, u)),
  costItems: [
    { id: 'g1', propertyId: 'o', period: P25.key, category: HEATING_CATEGORY, description: 'Gas', amountCents: 200000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'H1', fuelDeliveryId: 'd1', participantUnitIds: ['a', 'b'] },
    { id: 'm2', propertyId: 'o', period: P25.key, category: HEATING_CATEGORY, description: 'Messdienst C', amountCents: 100000, key: 'amounts', tenancyAmounts: { tc: 100000 }, heatingPlantId: 'H2' },
  ],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [
    { ...plant({ id: 'H1', name: 'Zentral AB', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] }), propertyId: 'o' },
    { ...plant({ id: 'H2', name: 'Zentral C', units: [{ unitId: 'c', heatedAreaM2: null }], buildingWith: 'H1' }), propertyId: 'o' },
  ],
  fuelDeliveries: [lieferung],
  co2Statements: [{ ...statement, plantId: 'H2', period: P25.key }],
} as unknown as Parameters<typeof snapshotFor>[0], 'o', P25))

test('Durchsicht S2: liegt die Abrechnung des Messdienstes bei, braucht die Anlage daneben dessen Ausstoß; der Hinweis nennt das Feld, und mit dem Wert stuft sie gemeinsam ein', () => {
  const ohne = zweiAnlagen(co2({}))
  const text = textOf(ohne, 'co2.classification-incomplete')
  assert.match(text, /Liegt dort die Abrechnung des Messdienstes bei, tragen Sie in der Karte „CO₂-Kosten“ unter „CO₂-Ausstoß insgesamt laut Abrechnung \(kg\)“ den Ausstoß ein\./)
  const mit = zweiAnlagen(co2({ serviceEmissionsKg: 3000 }))
  assert.ok(!codes(mit).includes('co2.classification-incomplete'))
  // Derselbe Ausstoß wie mit den Angaben der Abzugszeile führt zur selben Einstufung der Anlage daneben.
  const angaben = zweiAnlagen(co2({ method: 'serviceDeducted', serviceUsersTotalCents: 98000, serviceLandlordCents: 2000, serviceUnitsCount: 1, serviceEmissionsKg: 3000 }))
  const stufe = (r: ComputedSettlement) => r.heating?.find((h) => h.plantId === 'H1')?.co2?.stage ?? assert.fail('keine Einstufung von H1')
  assert.deepEqual(stufe(mit), stufe(angaben))
  assert.notDeepEqual(stufe(mit), stufe(ohne))
})

// Rechtslage der Sammelzeile (gelesen am 27.11.2026): Die Warnung nennt die betroffenen Mieter mit dem Betrag ihrer Zeile.
test('Sammelzeile: Warnung genau an der Position mit Haken, mit Namen und Beträgen der Mieter, den Fundstellen und dem sicheren Weg', () => {
  const r = settle({ ...haus, costItems: [sammel({ includesWater: true }), cost('grundsteuer', 'Grundsteuer', 90000)] })
  const n = r.notices.filter((x) => x.code === 'amounts.combined-line')
  assert.equal(n.length, 1)
  assert.deepEqual([n[0]?.level, n[0]?.title, n[0]?.subject], ['warning', 'Sammelzeile aus Heizung und Wasser: formell angreifbar', { kind: 'costItem', id: 'hz' }])
  const text = n[0]?.text ?? ''
  assert.equal(text,
    '„Abrechnung des Messdienstes“ fasst Heizung, Warmwasser, Kaltwasser und Abwasser in einer Zeile zusammen. ' +
    'Eine Betriebskostenabrechnung muss die Kosten nach Kostenarten trennen und darf nur zusammenfassen, was sachlich eng zusammenhängt (BGH, Urteil vom 15.07.2009, VIII ZR 340/08, Rn. 19); ' +
    'ob es genügt, dass die beiliegende Abrechnung des Messdienstes sie aufschlüsselt, hat der Bundesgerichtshof nicht entschieden (BGH, Beschluss vom 06.07.2021, VIII ZR 371/19, Rn. 14; Beschluss vom 24.01.2017, VIII ZR 285/15, Rn. 5 bis 7). ' +
    'Hält ein Gericht die Zeile für einen Formfehler, können Sie nach Ablauf der Abrechnungsfrist aus dieser Position nichts nachfordern (BGH, Urteil vom 22.09.2010, VIII ZR 285/09, Rn. 40 bis 42; Urteil vom 14.02.2007, VIII ZR 1/06, Rn. 11, 12). ' +
    'Endgültig verloren ist nur die Nachforderung; für die Vorauszahlungen können Sie eine Abrechnung mit getrennten Positionen nachreichen (BGH, Urteil vom 22.09.2010, VIII ZR 285/09, Rn. 44). ' +
    'Betroffen wäre hier eine Nachforderung von bis zu: ta (a) 1.823,40 € und tb (b) 1.512,75 €. ' +
    'Sicher ist es, Heizung und Warmwasser sowie Kaltwasser und Abwasser als getrennte Positionen mit den Beträgen aus der Einzelabrechnung zu erfassen.')
  // Nachprüfung 1: Dass Vorauszahlungen unberührt blieben, ist nicht belegt (VIII ZR 285/09, Rn. 38 und 44).
  assert.doesNotMatch(text, /nicht berührt/)
  // Nachprüfung 7: Die Beilage steht am Haken, nicht noch einmal hier.
  assert.doesNotMatch(text, /Legen Sie/)
  // Sie färbt das Cockpit: Der sichere Weg stellt sie ab.
  assert.ok(!INFORMATIONAL.has('amounts.combined-line'))
  // Nicht ohne Haken, und keine Zahl ändert sich.
  const ohne = settle({ ...haus, costItems: [sammel(), cost('grundsteuer', 'Grundsteuer', 90000)] })
  assert.ok(!codes(ohne).includes('amounts.combined-line'))
  assert.deepEqual(money(r), money(ohne))
})

test('Sammelzeile: je Position eine Warnung; nicht, wenn kein Mieter eine Zeile daraus hat (nur Leerstand, Eigennutzung oder Pauschale)', () => {
  // Zwei Sammelbeträge (etwa zwei Abrechnungen des Messdienstes): je Position eine Warnung mit ihren Mietern.
  const zwei = settle({ ...haus, costItems: [sammel({ includesWater: true }), messdienst(50000, { ta: 50000 }, { id: 'hz2', description: 'Nachberechnung', includesWater: true })] })
  const texte = zwei.notices.filter((x) => x.code === 'amounts.combined-line')
  assert.deepEqual(texte.map((x) => x.subject?.id), ['hz', 'hz2'])
  assert.match(texte[1]?.text ?? '', /Betroffen wäre hier eine Nachforderung von bis zu: ta \(a\) 500,00 €\. /)
  // Nur die eigene Wohnung und Leerstand tragen: niemand, dem gegenüber etwas nachzufordern wäre.
  const eigen = settle({ units: [unit('a'), own('c')], tenancies: [], costItems: [messdienst(100000, {}, { selfAmounts: { c: 60000 }, includesWater: true })] })
  assert.ok(!codes(eigen).includes('amounts.combined-line'))
  const pauschal = settle({ units: haus.units, tenancies: haus.tenancies.map((t) => ({ ...t, heatingModel: 'flatRate' as const })), costItems: [sammel({ includesWater: true })] })
  assert.ok(!codes(pauschal).includes('amounts.combined-line'))
})

// ---------- Befunde der Nachprüfung ----------

// 2: Jede Kürzungsliste, die auf einer Zeile mit Sammelbetrag rechnet, trägt den Zusatz, nicht nur die über `cutsOn`.
test('Nachprüfung 2: nicht fernablesbare Geräte und Haken: der Kürzungsbetrag steht als Höchstbetrag mit dem Grund; bei einem Mieter in der Einzahl; ohne Haken wie bisher', () => {
  // Nach dieser Angabe ist die Kürzung möglich, nicht sicher: Der Hinweis nennt die Beträge mit „bis zu“.
  const geraete = plant({ devicesRemote: 'none', devicesInstalledAfter2021: 'unknown' })
  const mit = textOf(settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [], [geraete]), 'heating.remote-reading')
  assert.match(mit, /, hier bis zu: ta \(a\) [\d.,]+ € und tb \(b\) [\d.,]+ € \(die Beträge enthalten auch Kaltwasser und Abwasser, auf die sich die Kürzung nicht bezieht\)\./)
  const ohne = textOf(settle({ ...haus, costItems: [sammel()] }, [], [geraete]), 'heating.remote-reading')
  assert.match(ohne, /, hier bis zu: ta \(a\) [\d.,]+ € und tb \(b\) [\d.,]+ €\./)
  assert.doesNotMatch(ohne, /Kaltwasser/)
  const einer = { units: [unit('a')], tenancies: [tenancy('ta', 'a')], costItems: [messdienst(182340, { ta: 182340 }, { includesWater: true })] }
  const einzeln = textOf(settle(einer, [], [geraete]), 'heating.remote-reading')
  assert.match(einzeln, /, hier bis zu: ta \(a\) [\d.,]+ € \(darin auch Kaltwasser und Abwasser, auf die sich die Kürzung nicht bezieht\)\./)
  assert.match(textOf(settle(einer), 'co2.missing'), /, hier höchstens: ta \(a\) 54,70 € \(darin auch Kaltwasser und Abwasser, auf die sich die Kürzung nicht bezieht\)\./)
})

// 4: Bei einer Eigentumswohnung rechnet die Gemeinschaft ab.
test('Nachprüfung 4: die Warnung zur Sammelzeile nennt bei einer Eigentumswohnung die Abrechnung der Gemeinschaft', () => {
  const r = settle({ ...haus, costItems: [sammel({ includesWater: true })] }, [], [plant({ source: 'homeowners' })])
  const text = textOf(r, 'amounts.combined-line')
  assert.match(text, /dass die beiliegende Abrechnung der Gemeinschaft sie aufschlüsselt/)
  assert.doesNotMatch(text, /Abrechnung des Messdienstes sie aufschlüsselt/)
})
