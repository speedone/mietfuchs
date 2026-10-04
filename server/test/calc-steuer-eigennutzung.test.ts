// Werbungskosten bei teilweiser Eigennutzung (#163), mit Handrechnung.
//
// Die Regeln stehen in docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md: Umlagefähige
// Kosten übernehmen den Eigenanteil der Abrechnung, nicht umlagefähige werden direkt zugeordnet oder
// nach der Fläche des ganzen Gebäudes aufgeteilt. Gebaut wird unmittelbar ein Schnappschuss, weil
// die db.json Teilnehmer und Einzelbeträge nicht kennt.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, RESERVE_CATEGORY, taxReport } from '../src/calc.ts'
import { frozenSettlementOf, snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { TaxExpenseItem, TaxReport } from '../../shared/types.ts'

const tenancy = (id: string, unitId: string, start = '2020-01-01', end: string | null = null, persons = 1): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const rented = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const own = (id: string, areaM2: number, selfPersons = 2): SnapshotUnit => ({ id, name: id, areaM2, participates: false, selfUsed: true, selfPersons })
const item = (id: string, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const tax = (s: SnapshotSource): TaxReport => taxReport(snapshotOf(s, 2025))
const itemOf = (r: TaxReport, id: string): TaxExpenseItem => {
  const found = r.expenses.items.find((x) => x.costItemId === id)
  if (!found) assert.fail(`keine Position ${id} in der Steuerübersicht`)
  return found
}
const split = (r: TaxReport, id: string) => {
  const x = itemOf(r, id)
  return { privat: x.privateCents, abziehbar: x.deductibleCents, zuordnung: x.allocation, prozent: x.deductiblePercent }
}

// ---------- Einliegerwohnung: 120 m² eigen, 45 m² vermietet ----------

test('Einliegerwohnung: Grundsteuer laut Abrechnung, Dachreparatur nach Fläche, Überschuss aus dem abziehbaren Teil', () => {
  const src = source({
    units: [own('eigen', 120), rented('elw', 45)],
    tenancies: [tenancy('t', 'elw')],
    payments: [{ tenancyId: 't', date: '2025-06-01', amountCents: 600000 }],
    costItems: [
      // 600 € × 120/165 = 436,3636… → 436,36 € Eigenanteil, die Mieterin trägt 163,64 €.
      item('grundsteuer', { amountCents: 60000 }),
      // 3.300 € × 120/165 = 2.400 € privat, 900 € abziehbar.
      item('dach', { category: 'Nicht umlagefähig', amountCents: 330000 }),
    ],
  })
  const r = tax(src)
  assert.deepEqual(split(r, 'grundsteuer'), { privat: 43636, abziehbar: 16364, zuordnung: 'settlement', prozent: 27.27 })
  assert.deepEqual(split(r, 'dach'), { privat: 240000, abziehbar: 90000, zuordnung: 'area', prozent: 27.27 })
  assert.equal(r.expenses.totalCents, 390000, 'die Bruttosumme bleibt')
  assert.equal(r.expenses.privateCents, 283636)
  assert.equal(r.expenses.deductibleCents, 106364)
  assert.equal(r.surplusPaidCents, 600000 - 106364)
  // Die Abrechnung und die Steuerübersicht sagen bei der Grundsteuer dasselbe.
  assert.equal(computeSettlement(snapshotOf(src, 2025)).selfUsedShareCents, 43636)
})

test('Einliegerwohnung: die Gruppen tragen privat und abziehbar, zusammen der Betrag', () => {
  const r = tax(source({
    units: [own('eigen', 120), rented('elw', 45)],
    tenancies: [tenancy('t', 'elw')],
    costItems: [item('grundsteuer', { amountCents: 60000 }), item('dach', { category: 'Nicht umlagefähig', amountCents: 330000 })],
  }))
  const g = r.expenses.groups.find((x) => x.group === 'Verwaltung & Instandhaltung')
  if (!g) return assert.fail('Gruppe fehlt')
  assert.deepEqual([g.amountCents, g.privateCents, g.deductibleCents], [330000, 240000, 90000])
  assert.deepEqual([g.categories[0]?.privateCents, g.categories[0]?.deductibleCents], [240000, 90000])
})

// ---------- Mehrfamilienhaus mit eigener Wohnung ----------

test('Mehrfamilienhaus mit eigener Wohnung: Versicherung laut Abrechnung, Verwaltung nach Fläche', () => {
  // 80 m² eigen, 90 und 60 m² vermietet, zusammen 230 m².
  const r = tax(source({
    units: [own('eg', 80), rented('og1', 90), rented('og2', 60)],
    tenancies: [tenancy('t1', 'og1'), tenancy('t2', 'og2')],
    costItems: [
      item('versicherung', { category: 'Sach- und Haftpflichtversicherung', amountCents: 230000 }),
      item('verwaltung', { category: 'Nicht umlagefähig', amountCents: 115000 }),
    ],
  }))
  assert.deepEqual(split(r, 'versicherung'), { privat: 80000, abziehbar: 150000, zuordnung: 'settlement', prozent: 65.22 })
  assert.deepEqual(split(r, 'verwaltung'), { privat: 40000, abziehbar: 75000, zuordnung: 'area', prozent: 65.22 })
})

// ---------- Direkte Zuordnung ----------

test('Badsanierung direkt in der vermieteten Wohnung: voll abziehbar; in der eigenen: ganz privat', () => {
  const units = [own('eg', 80), rented('og', 90)]
  const r = tax(source({
    units,
    tenancies: [tenancy('t', 'og')],
    costItems: [
      item('bad-og', { category: 'Nicht umlagefähig', amountCents: 500000, key: 'direct', directUnitId: 'og' }),
      item('bad-eg', { category: 'Nicht umlagefähig', amountCents: 400000, key: 'direct', directUnitId: 'eg' }),
    ],
  }))
  assert.deepEqual(split(r, 'bad-og'), { privat: 0, abziehbar: 500000, zuordnung: 'direct-rented', prozent: null })
  assert.deepEqual(split(r, 'bad-eg'), { privat: 400000, abziehbar: 0, zuordnung: 'direct-self', prozent: null })
})

test('Direkt auf eine leere Wohnung: abziehbar, denn Leerstand mit Vermietungsabsicht bleibt Werbungskosten', () => {
  const r = tax(source({
    units: [own('eg', 80), rented('og', 90)],
    costItems: [item('maler', { category: 'Nicht umlagefähig', amountCents: 120000, key: 'direct', directUnitId: 'og' })],
  }))
  assert.deepEqual(split(r, 'maler'), { privat: 0, abziehbar: 120000, zuordnung: 'direct-rented', prozent: null })
})

test('Direkt auf eine Einheit außerhalb der Abrechnungseinheit: abziehbar, aber gekennzeichnet', () => {
  const r = tax(source({
    units: [own('eg', 80), rented('og', 90), { id: 'laden', name: 'Laden', areaM2: 50, participates: false, selfUsed: false }],
    costItems: [item('tuer', { category: 'Nicht umlagefähig', amountCents: 50000, key: 'direct', directUnitId: 'laden' })],
  }))
  assert.equal(split(r, 'tuer').zuordnung, 'direct-outside')
  assert.equal(split(r, 'tuer').privat, 0)
})

test('Direkt auf eine gelöschte Wohnung: wie eine Gebäudekosten nach Fläche', () => {
  const r = tax(source({
    units: [own('eg', 50), rented('og', 50)],
    costItems: [item('weg', { category: 'Nicht umlagefähig', amountCents: 100000, key: 'direct', directUnitId: 'gibt-es-nicht' })],
  }))
  assert.deepEqual(split(r, 'weg'), { privat: 50000, abziehbar: 50000, zuordnung: 'area', prozent: 50 })
})

test('Umlagefähig direkt auf die eigene Wohnung mit Mietverhältnis bis März: privat ist der Eigenanteil der Abrechnung', () => {
  const src = source({
    units: [own('eg', 80), rented('og', 90)],
    tenancies: [tenancy('t', 'og'), tenancy('vorher', 'eg', '2020-01-01', '2025-03-31')],
    costItems: [item('wasser', { category: 'Wasser/Abwasser', amountCents: 36500, key: 'direct', directUnitId: 'eg' })],
  })
  const r = tax(src)
  const settlement = computeSettlement(snapshotOf(src, 2025))
  assert.equal(split(r, 'wasser').zuordnung, 'direct-self')
  assert.equal(split(r, 'wasser').privat, settlement.selfUsedShareCents)
  // Eine selbstgenutzte Wohnung bekommt keine Abrechnung, auch nicht für ihren früheren Mieter;
  // die Abrechnung weist die ganze Position als Eigenanteil aus, und die Steuer folgt ihr.
  assert.equal(split(r, 'wasser').privat, 36500)
  assert.equal(r.selfUseChangedInYear, true, 'die eigene Wohnung war im Jahr vermietet')
})

// ---------- Teilnehmer: das Dach des Hinterhauses ----------

test('Dachreparatur nur am Hinterhaus: Grundmenge sind die betroffenen Einheiten', () => {
  // Hinterhaus: eigen 80 m², vermietet 60 m². Vorderhaus 90 m² ist nicht betroffen.
  // 1.200 € × 80/140 = 685,7143 € → 685,71 € privat, 514,29 € abziehbar (42,86 %).
  const r = tax(source({
    units: [own('hh-eigen', 80), rented('vh', 90), rented('hh', 60)],
    tenancies: [tenancy('t1', 'vh'), tenancy('t2', 'hh')],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 120000, participantUnitIds: ['hh-eigen', 'hh'] })],
  }))
  assert.deepEqual(split(r, 'dach'), { privat: 68571, abziehbar: 51429, zuordnung: 'area', prozent: 42.86 })
  const steps = itemOf(r, 'dach').steps.map((s) => `${s.label}: ${s.value}`).join('\n')
  assert.match(steps, /140 m²/)
  assert.match(steps, /80 m²/)
  assert.match(steps, /1\.200,00 € × 80\/140 = 685,7143 €/)
  assert.match(steps, /514,29 €.*42,86 %/)
})

// ---------- Gutschrift ----------

test('Gutschrift: senkt den privaten Anteil im selben Verhältnis (Zahlen aus #129)', () => {
  const r = tax(source({
    units: [own('eg', 50), rented('og', 50)],
    tenancies: [tenancy('t', 'og')],
    costItems: [
      item('rechnung', { category: 'Wasser/Abwasser', amountCents: 100000 }),
      item('erstattung', { category: 'Wasser/Abwasser', amountCents: -20000 }),
      item('reparatur', { category: 'Nicht umlagefähig', amountCents: 100000 }),
      item('reparatur-gutschrift', { category: 'Nicht umlagefähig', amountCents: -20000 }),
    ],
  }))
  assert.deepEqual([split(r, 'rechnung').privat, split(r, 'erstattung').privat], [50000, -10000])
  assert.deepEqual([split(r, 'reparatur').privat, split(r, 'reparatur-gutschrift').privat], [50000, -10000])
  assert.equal(split(r, 'reparatur-gutschrift').abziehbar, -10000)
  assert.equal(r.expenses.privateCents, 80000)
})

test('Gutschrift: die Rundung ist spiegelbildlich', () => {
  // 1 € × 1/3: privat 0,33 €; −1 € × 1/3: privat −0,33 €, nicht −0,34 €.
  const r = tax(source({
    units: [own('eg', 10), rented('og', 20)],
    costItems: [item('plus', { category: 'Nicht umlagefähig', amountCents: 100 }), item('minus', { category: 'Nicht umlagefähig', amountCents: -100 })],
  }))
  assert.equal(split(r, 'plus').privat, 33)
  assert.equal(split(r, 'minus').privat, -33)
  // Genau auf halbem Cent: 1 Cent × 1/2 → 1 Cent bzw. −1 Cent.
  const half = tax(source({
    units: [own('eg', 10), rented('og', 10)],
    costItems: [item('plus', { category: 'Nicht umlagefähig', amountCents: 1 }), item('minus', { category: 'Nicht umlagefähig', amountCents: -1 })],
  }))
  assert.deepEqual([split(half, 'plus').privat, split(half, 'minus').privat], [1, -1])
})

// ---------- Garage ----------

test('Garage mit 0 m²: ändert das Flächenverhältnis nicht; mit Fläche zählt sie als Nutzfläche', () => {
  const ohne = tax(source({
    units: [own('eg', 100), rented('og', 100), rented('garage', 0)],
    tenancies: [tenancy('t1', 'og'), tenancy('t2', 'garage', '2020-01-01', null, 0)],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 100000 })],
  }))
  assert.equal(split(ohne, 'dach').privat, 50000)
  // 1.000 € × 100/220 = 454,5454… → 454,55 €
  const mit = tax(source({
    units: [own('eg', 100), rented('og', 100), rented('garage', 20)],
    tenancies: [tenancy('t1', 'og'), tenancy('t2', 'garage', '2020-01-01', null, 0)],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 100000 })],
  }))
  assert.equal(split(mit, 'dach').privat, 45455)
})

// ---------- Fehlende Fläche ----------

test('Eigene Wohnung ohne Fläche: nicht aufteilbar, nichts wird geschätzt', () => {
  const r = tax(source({
    units: [own('eg', 0), rented('og', 90)],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 100000 })],
  }))
  assert.deepEqual(split(r, 'dach'), { privat: 0, abziehbar: 100000, zuordnung: 'unsplittable', prozent: null })
})

test('Ohne jede Fläche: nicht aufteilbar', () => {
  const r = tax(source({
    units: [own('eg', 0), rented('og', 0)],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 100000 })],
  }))
  assert.equal(split(r, 'dach').zuordnung, 'unsplittable')
})

// ---------- Ausnahmen der Abrechnung ----------

test('Hat die Abrechnung eine Position nicht verteilt, gilt die Fläche', () => {
  // Verbrauch ohne Zähler: die Abrechnung meldet „kein Verbrauch“, alles beim Vermieter.
  const r = tax(source({
    units: [own('eg', 50), rented('og', 150)],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('wasser', { category: 'Wasser/Abwasser', amountCents: 80000, key: 'meter', meterType: 'kaltwasser' })],
  }))
  assert.deepEqual(split(r, 'wasser'), { privat: 20000, abziehbar: 60000, zuordnung: 'area', prozent: 75 })
})

test('Personenschlüssel: privat laut Abrechnung, zum Vergleich der Anteil nach Fläche', () => {
  // Eigen 50 m² mit 1 Person, vermietet 150 m² mit 3 Personen: laut Abrechnung 1/4, nach Fläche 1/4.
  // Mit 3 eigenen Personen: laut Abrechnung 3/6 = 500 €, nach Fläche 250 €.
  const r = tax(source({
    units: [own('eg', 50, 3), rented('og', 150)],
    tenancies: [tenancy('t', 'og', '2020-01-01', null, 3)],
    costItems: [item('muell', { category: 'Müllabfuhr', amountCents: 100000, key: 'persons' })],
  }))
  assert.equal(split(r, 'muell').privat, 50000)
  assert.equal(itemOf(r, 'muell').areaPrivateCents, 25000)
  // Nach Fläche verteilt ist der Vergleich überflüssig.
  const f = tax(source({
    units: [own('eg', 50), rented('og', 150)],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('gs', { amountCents: 100000 })],
  }))
  assert.equal(itemOf(f, 'gs').areaPrivateCents, null)
})

test('Pauschale und Leerstand bleiben abziehbar', () => {
  const r = tax(source({
    units: [own('eg', 50), rented('og', 50), rented('dg', 100)],
    tenancies: [{ ...tenancy('t', 'og'), costModel: 'flatRate' }],
    costItems: [item('gs', { amountCents: 200000 })],
  }))
  // Eigen 50 von 200 m²: 500 € privat; der Anteil der Pauschale (500 €) und des Leerstands (1.000 €) bleibt abziehbar.
  assert.deepEqual([split(r, 'gs').privat, split(r, 'gs').abziehbar], [50000, 150000])
})

test('Die Erhaltungsrücklage bleibt außen vor, auch bei Eigennutzung (#143)', () => {
  const r = tax(source({
    units: [own('eg', 50), rented('og', 50)],
    costItems: [item('ruecklage', { category: RESERVE_CATEGORY, amountCents: 90000 })],
  }))
  assert.equal(r.expenses.items.length, 0)
  assert.equal(r.reserveContributionCents, 90000)
  assert.equal(r.expenses.privateCents, 0)
})

test('Ohne eigene Wohnung ist nichts privat, und der Überschuss bleibt der bisherige', () => {
  const r = tax(source({
    units: [rented('a', 50), rented('b', 50), { id: 'laden', name: 'Laden', areaM2: 80, participates: false, selfUsed: false }],
    tenancies: [tenancy('t', 'a')],
    payments: [{ tenancyId: 't', date: '2025-03-01', amountCents: 300000 }],
    costItems: [item('gs', { amountCents: 100000 }), item('dach', { category: 'Nicht umlagefähig', amountCents: 50000 })],
  }))
  assert.equal(r.expenses.privateCents, 0)
  assert.equal(r.expenses.deductibleCents, r.expenses.totalCents)
  assert.equal(r.surplusPaidCents, 300000 - 150000)
})

// ---------- Abgeschlossene Abrechnung ----------

const closedSource = () => {
  const src = source({
    units: [own('eg', 80), rented('og', 120)],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('gs', { amountCents: 100000 }), item('vers', { category: 'Sach- und Haftpflichtversicherung', amountCents: 50000 })],
  })
  return { src, frozen: computeSettlement(snapshotOf(src, 2025)) }
}

test('Abgeschlossene Abrechnung: privat je Position aus dem eingefrorenen Stand', () => {
  const { src, frozen } = closedSource()
  // Nach dem Abschluss geändert: Die eigene Wohnung ist größer erfasst, die Beträge sind dieselben.
  const later = {
    ...src,
    units: [own('eg', 120), rented('og', 120)],
    closedSettlements: [{ year: 2025, ...frozenSettlementOf(frozen) }],
  }
  const r = tax(later)
  assert.equal(split(r, 'gs').privat, 40000, 'der eingefrorene Eigenanteil, nicht 50.000')
  assert.equal(split(r, 'gs').abziehbar, 60000)
  assert.equal(split(r, 'vers').privat, 20000)
  assert.equal(r.closedSelfUseDiffers, true)
  assert.equal(r.closedItemsChanged, 0)
  // Unverändert: kein Hinweis.
  assert.equal(tax({ ...src, closedSettlements: [{ year: 2025, ...frozenSettlementOf(frozen) }] }).closedSelfUseDiffers, false)
})

// Die Einliegerwohnung (120 m² eigen, 45 m² vermietet), abgeschlossen mit der Grundsteuer allein.
const einlieger = (costItems: SnapshotCostItem[]) => source({
  units: [own('eigen', 120), rented('elw', 45)],
  tenancies: [tenancy('t', 'elw')],
  costItems,
})
const closedWith = (base: SnapshotSource, later: SnapshotCostItem[]): SnapshotSource => ({
  ...base,
  costItems: later,
  closedSettlements: [{ year: 2025, ...frozenSettlementOf(computeSettlement(snapshotOf(base, 2025))) }],
})

test('Abgeschlossene Abrechnung: eine danach erfasste Position wird heute gerechnet, nicht als 0 privat', () => {
  // Gebäudeversicherung 1.650 € nachgetragen: 1.650 € × 120/165 = 1.200 € privat.
  const base = einlieger([item('gs', { amountCents: 60000 })])
  const r = tax(closedWith(base, [item('gs', { amountCents: 60000 }), item('vers', { category: 'Sach- und Haftpflichtversicherung', amountCents: 165000 })]))
  assert.equal(split(r, 'gs').privat, 43636)
  assert.deepEqual([split(r, 'vers').privat, split(r, 'vers').abziehbar], [120000, 45000])
  assert.equal(r.closedItemsChanged, 1)
})

test('Abgeschlossene Abrechnung: ein danach geänderter Betrag wird heute gerechnet, nie negativ abziehbar', () => {
  // Grundsteuer beim Abschluss 600 € (436,36 € privat), danach auf 100 € berichtigt:
  // heute 100 € × 120/165 = 72,73 € privat, 27,27 € abziehbar.
  const base = einlieger([item('gs', { amountCents: 60000 })])
  const r = tax(closedWith(base, [item('gs', { amountCents: 10000 })]))
  assert.deepEqual([split(r, 'gs').privat, split(r, 'gs').abziehbar], [7273, 2727])
  assert.equal(r.closedItemsChanged, 1)
})

test('Abgeschlossene Abrechnung: eine 0-€-Position zählt nicht als nach dem Abschluss geändert (Durchsicht)', () => {
  // Ältere Versionen schrieben für eine Position ohne Betrag keine Zeile aufs Papier; sie steht
  // dann nicht in den eingefrorenen Beträgen. Geändert ist sie damit nicht, und privat ist an ihr
  // nichts. Nachgestellt, indem ihre Zeilen aus dem eingefrorenen Stand entfernt werden.
  const base = einlieger([item('gs', { amountCents: 60000 }), item('leer', { category: 'Sach- und Haftpflichtversicherung', amountCents: 0 })])
  const settlement = computeSettlement(snapshotOf(base, 2025))
  const ohneLeer = <T extends { costItemId: string }>(rows: T[]): T[] => rows.filter((row) => row.costItemId !== 'leer')
  const alt = {
    ...settlement,
    statements: settlement.statements.map((st) => ({ ...st, rows: ohneLeer(st.rows) })),
    landlord: { ...settlement.landlord, rows: ohneLeer(settlement.landlord.rows) },
  }
  const frozenAlt = frozenSettlementOf(alt)
  if (frozenAlt.itemTotals === null || Object.hasOwn(frozenAlt.itemTotals, 'leer')) assert.fail('der nachgestellte Altbestand muss Beträge ohne die leere Position führen')
  const r = tax({ ...base, closedSettlements: [{ year: 2025, ...frozenAlt }] })
  assert.equal(r.closedItemsChanged, 0)
  assert.deepEqual([split(r, 'leer').privat, split(r, 'leer').abziehbar], [0, 0])
  // Wird sie danach mit einem Betrag erfasst, ist sie geändert.
  assert.equal(tax(closedWith(base, [item('gs', { amountCents: 60000 }), item('leer', { category: 'Sach- und Haftpflichtversicherung', amountCents: 1000 })])).closedItemsChanged, 1)
})

test('Abgeschlossene Abrechnung von vor #142: die eingefrorene Summe wird auf die Positionen verteilt', () => {
  const { src, frozen } = closedSource()
  // Ein Archivstück ohne Zerlegung des Vermieteranteils, mit einer anderen Summe als heute.
  // Ein Archivstück ist für den Auszug `unknown`; gebaut wird es deshalb über JSON.
  const ohneZerlegung: unknown = JSON.parse(JSON.stringify(frozen, (key, value: unknown) => (key === 'landlordParts' ? undefined : value)))
  const archiv = { ...(ohneZerlegung !== null && typeof ohneZerlegung === 'object' ? ohneZerlegung : {}), selfUsedShareCents: 30001 }
  const r = tax({ ...src, closedSettlements: [{ year: 2025, ...frozenSettlementOf(archiv) }] })
  // Heute 40.000 und 20.000; die 30.001 im Verhältnis 2:1 → 20.000,67 und 10.000,33 → 20.001 und 10.000.
  assert.deepEqual([split(r, 'gs').privat, split(r, 'vers').privat], [20001, 10000])
  assert.equal(r.closedSelfUseDiffers, true)
})

// ---------- Der Rechenweg ----------

// ---------- Einheiten außerhalb der Abrechnungseinheit ----------

test('Einheit außerhalb der Abrechnungseinheit: umlagefähige Kosten nach der Fläche des ganzen Gebäudes', () => {
  // 100 m² eigen, 100 m² vermietet, 100 m² Gewerbe außerhalb. Grundsteuer 3.000 € nach Fläche:
  // Die Abrechnung verteilt über 200 m² und weist 1.500 € Eigenanteil aus; privat sind nach dem
  // Gebäude 3.000 € × 100/300 = 1.000 €, sonst zählte das Gewerbe wie privat.
  const r = tax(source({
    units: [own('eigen', 100), rented('og', 100), { id: 'laden', name: 'Laden', areaM2: 100, participates: false, selfUsed: false }],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('gs', { amountCents: 300000 })],
  }))
  assert.deepEqual(split(r, 'gs'), { privat: 100000, abziehbar: 200000, zuordnung: 'area', prozent: 66.67 })
  assert.equal(itemOf(r, 'gs').settlementPrivateCents, 150000, 'zum Vergleich der Eigenanteil der Abrechnung')
  assert.equal(r.selfUsedShareCents, 150000, 'die Abrechnung selbst bleibt unberührt')
})

test('Einheit außerhalb: Verbrauch und Einzelbeträge bleiben bei der Abrechnung, sie ordnen eindeutig zu', () => {
  const r = tax(source({
    units: [own('eigen', 100), rented('og', 100), { id: 'laden', name: 'Laden', areaM2: 100, participates: false, selfUsed: false }],
    tenancies: [tenancy('t', 'og')],
    meters: [{ id: 'me', unitId: 'eigen', type: 'kaltwasser' }, { id: 'mo', unitId: 'og', type: 'kaltwasser' }],
    readings: [
      { meterId: 'me', date: '2024-12-31', value: 0 }, { meterId: 'me', date: '2025-12-31', value: 30 },
      { meterId: 'mo', date: '2024-12-31', value: 0 }, { meterId: 'mo', date: '2025-12-31', value: 70 },
    ],
    costItems: [item('wasser', { category: 'Wasser/Abwasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' })],
  }))
  assert.deepEqual([split(r, 'wasser').privat, split(r, 'wasser').zuordnung], [30000, 'settlement'])
})

test('Nicht umlagefähig nur am Hinterhaus: Vorderhaus eigen, Dach des vermieteten Hinterhauses ganz abziehbar', () => {
  const r = tax(source({
    units: [own('vorderhaus', 120), rented('hinterhaus', 80)],
    tenancies: [tenancy('t', 'hinterhaus')],
    costItems: [item('dach', { category: 'Nicht umlagefähig', amountCents: 300000, participantUnitIds: ['hinterhaus'] })],
  }))
  assert.deepEqual([split(r, 'dach').privat, split(r, 'dach').abziehbar], [0, 300000])
})

test('Rechenweg: laut Abrechnung nennt Schlüssel und Eigenanteil; direkt nennt die Wohnung', () => {
  const r = tax(source({
    units: [own('Eigene Wohnung', 80), rented('OG', 120)],
    tenancies: [tenancy('t', 'OG')],
    costItems: [
      item('gs', { amountCents: 100000 }),
      item('bad', { category: 'Nicht umlagefähig', amountCents: 50000, key: 'direct', directUnitId: 'Eigene Wohnung' }),
    ],
  }))
  const text = (id: string) => itemOf(r, id).steps.map((s) => `${s.label}: ${s.value}`).join('\n')
  assert.match(text('gs'), /nach Wohnfläche/)
  assert.match(text('gs'), /400,00 €/)
  assert.match(text('bad'), /Eigene Wohnung/)
  assert.match(text('bad'), /selbstgenutzt/)
})

test('Hinweis-Kennzeichen: Lohnanteil an einer Position mit privatem Teil', () => {
  const r = tax(source({
    units: [own('eg', 50), rented('og', 50)],
    tenancies: [tenancy('t', 'og')],
    costItems: [item('garten', { category: 'Gartenpflege', amountCents: 100000, labor35aCents: 80000 })],
  }))
  assert.equal(itemOf(r, 'garten').labor35aCents, 80000)
  assert.equal(r.expenses.labor35aCents, 80000, '§35a bleibt unverändert')
})

// Integrationsdurchsicht vor 0.10: Bis 0.8.0 speicherte das Formular auch bei „Nicht umlagefähig“
// den Umlageschlüssel, oft `direct` mit einer Wohnung. Seit #163 heißt das „Betrifft (für die
// Steuer)“. Ein Datenschritt räumt es bewusst nicht ab; die Seite nennt die Zuordnung, und dafür
// führt jede Position die Einheiten, denen sie zugeordnet ist.
test('Nicht umlagefähig: die Position nennt die Einheiten, denen sie zugeordnet ist', () => {
  const r = tax(source({
    units: [own('EG', 100), rented('OG', 150), rented('DG', 50)],
    tenancies: [tenancy('t', 'OG'), tenancy('u', 'DG')],
    costItems: [
      item('alt-eg', { category: 'Nicht umlagefähig', key: 'direct', directUnitId: 'EG' }),
      item('alt-og', { category: 'Nicht umlagefähig', key: 'direct', directUnitId: 'OG' }),
      item('dach', { category: 'Nicht umlagefähig', participantUnitIds: ['OG', 'DG'] }),
      item('gebaeude', { category: 'Nicht umlagefähig' }),
      item('leer', { category: 'Nicht umlagefähig', participantUnitIds: [] }),
      item('wasser', { category: 'Wasser', key: 'direct', directUnitId: 'OG' }),
    ],
  }))
  const u = (id: string) => ({ unitId: id, unitName: id })
  assert.deepEqual(itemOf(r, 'alt-eg').taxUnits, [u('EG')])
  assert.deepEqual(itemOf(r, 'alt-og').taxUnits, [u('OG')])
  assert.deepEqual(itemOf(r, 'dach').taxUnits, [u('OG'), u('DG')])
  assert.equal(itemOf(r, 'gebaeude').taxUnits, null, 'ganzes Gebäude')
  assert.equal(itemOf(r, 'leer').taxUnits, null, 'eine leere Liste nennt keine Einheit (Durchsicht)')
  assert.equal(itemOf(r, 'wasser').taxUnits, null, 'umlagefähig: die Zuordnung ist der Umlageschlüssel, nicht „Betrifft“')
})
