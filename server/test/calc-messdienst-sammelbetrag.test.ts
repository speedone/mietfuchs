// Sammelbetrag des Messdienstes (#704): Der Messdienst rechnet Heizung, Warmwasser, Kaltwasser und Abwasser in einem
// Betrag je Nutzer ab und teilt die CO₂-Kosten selbst auf. Der Haken `includesWater` an der Position ändert nur die
// Bezeichnung und die Hinweise, nie eine Zahl; die Antwort `serviceEnclosed` in der Karte „CO₂-Kosten“ schaltet Probe
// und Buchung ab und verweist auf die beiliegende Heizkostenabrechnung des Messdienstes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'
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
  // Die Hinweise ohne Haken und mit Haken sind dieselben (ohne zweite Wasserposition und ohne CO₂-Angaben).
  assert.deepEqual(mit.notices, ohne.notices)
})

test('Neue Antwort „Messdienst hat aufgeteilt, Abrechnung liegt bei“: kein co2.missing, kein co2.sum-check, keine Buchung, ein ruhiger Hinweis', () => {
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
  assert.match(textOf(r, 'co2.service-enclosed'), /Legen Sie .* bei/)
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
  assert.match(textOf(mit, 'co2.sum-check'), /„Der Messdienst hat die CO₂-Kosten aufgeteilt und weist das in seiner Abrechnung aus; ich lege sie der Abrechnung bei“/)
  // Ohne Haken bleibt der Wortlaut, wie er war.
  const ohne = settle({ ...haus, costItems: [sammel()] }, [st])
  assert.doesNotMatch(textOf(ohne, 'co2.sum-check'), /Kaltwasser/)
  assert.equal(textOf(mit, 'co2.sum-check').replace(/ „Abrechnung des Messdienstes“ enthält nach Ihrer Angabe[^]*?ich lege sie der Abrechnung bei“\./, ''), textOf(ohne, 'co2.sum-check'))
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
