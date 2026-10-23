// Die Kontrollansicht der Abrechnung (#321): reine Anzeige aus der vorhandenen Abrechnung.
import { expect, test } from 'vitest'
import type { LandlordPart, Settlement, SettlementRow, Statement } from './types'
import { controlView } from './controlView'

const row = (id: string, share: number, extra: Partial<SettlementRow> = {}): SettlementRow => ({
  costItemId: id, category: 'Grundsteuer', description: `Position ${id}`, totalCents: 1000, keyLabel: 'Wohnfläche', shareCents: share, ...extra,
})
const landlordRow = (id: string, parts: LandlordPart[], extra: Partial<SettlementRow> = {}): SettlementRow =>
  row(id, parts.reduce((a, p) => a + p.cents, 0), { landlordParts: parts, ...extra })

function statement(id: string, name: string, rows: SettlementRow[], prepayment = 0): Statement {
  const total = rows.reduce((a, r) => a + r.shareCents, 0)
  return {
    tenancyId: id, unitId: `u-${id}`, tenantName: name, unitName: `Wohnung ${id}`, persons: 1, days: 365, personDays: 365,
    periodStart: '2025-01-01', periodEnd: '2025-12-31', rows, totalShareCents: total, total35aCents: 0,
    prepaymentCents: prepayment, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: total - prepayment,
  }
}

type Parts = Pick<Settlement, 'statements' | 'landlord'>
const settle = (statements: Statement[], landlordRows: SettlementRow[]): Parts => ({
  statements,
  landlord: { rows: landlordRows, totalCents: landlordRows.reduce((a, r) => a + r.shareCents, 0) },
})

test('je Position stehen Mieter und Gründe des Vermieters nebeneinander, die Summe geht gegen den Rechnungsbetrag auf', () => {
  const view = controlView(settle(
    [statement('a', 'Anna', [row('k1', 400)], 500), statement('b', 'Ben', [row('k1', 300)], 200)],
    [landlordRow('k1', [{ reason: 'selfUse', cents: 200 }, { reason: 'vacancy', cents: 100 }])],
  ))
  expect(view.tenants.map((t) => t.name)).toEqual(['Anna', 'Ben'])
  expect(view.landlordColumns.map((c) => c.label)).toEqual(['Eigennutzung', 'Leerstand'])
  const [item] = view.items
  expect(item).toMatchObject({ id: 'k1', totalCents: 1000, tenantCents: [400, 300], landlordCents: [200, 100], sumCents: 1000, differenceCents: 0 })
  expect(view.hasDifference).toBe(false)
  expect(view.tenants.map((t) => [t.costCents, t.prepaymentCents, t.balanceCents])).toEqual([[400, 500, -100], [300, 200, 100]])
})

test('ein Mieter ohne Zeile in einer Position steht dort mit 0, ein Grund ohne Wert ebenfalls', () => {
  const view = controlView(settle(
    [statement('a', 'Anna', [row('k1', 600), row('k2', 500)]), statement('b', 'Ben', [row('k1', 400)])],
    [landlordRow('k2', [{ reason: 'flatRate', cents: 500 }], { totalCents: 1000 })],
  ))
  expect(view.landlordColumns.map((c) => c.label)).toEqual(['Betriebskostenpauschale'])
  expect(view.items.map((i) => [i.id, i.tenantCents, i.landlordCents, i.differenceCents])).toEqual([
    ['k1', [600, 400], [0], 0],
    ['k2', [500, 0], [500], 0],
  ])
})

test('eine Differenz wird benannt und nicht verborgen', () => {
  const view = controlView(settle([statement('a', 'Anna', [row('k1', 400)])], [landlordRow('k1', [{ reason: 'selfUse', cents: 500 }])]))
  expect(view.items[0]).toMatchObject({ sumCents: 900, differenceCents: -100 })
  expect(view.hasDifference).toBe(true)
})

test('Zeilen ohne eigene Kostenposition stehen gesondert und fließen nicht in die Summenprüfung', () => {
  const view = controlView(settle(
    [statement('a', 'Anna', [row('k1', 700), row('co2:p1:2025', -50, { kind: 'co2Relief', category: 'Heizung', description: 'CO₂-Anteil Vermieter', totalCents: 0 })]),
     statement('b', 'Ben', [row('k1', 300)])],
    [landlordRow('co2:p1:2025', [{ reason: 'co2Share', cents: 50 }], { totalCents: 0 })],
  ))
  expect(view.items.map((i) => i.id)).toEqual(['k1'])
  expect(view.items[0]).toMatchObject({ sumCents: 1000, differenceCents: 0 })
  expect(view.hasDifference).toBe(false)
  expect(view.extras).toHaveLength(1)
  expect(view.extras[0]).toMatchObject({ id: 'co2:p1:2025', tenantCents: [-50, 0], landlordCents: 50, sumCents: 0 })
  expect(view.tenants[0]).toMatchObject({ costCents: 650 })
})

test('Pseudo-Kennungen ohne kind (Zeile des Vermieters) zählen ebenfalls als Zeile ohne Position', () => {
  const view = controlView(settle([], [landlordRow('gmodg:p1:2025', [{ reason: 'gmodgShare', cents: 80 }], { totalCents: 80 })]))
  expect(view.items).toEqual([])
  expect(view.extras.map((e) => e.id)).toEqual(['gmodg:p1:2025'])
})

test('eine ältere Abrechnung ohne Zerlegung zeigt den Grund pauschal in einer Spalte', () => {
  const view = controlView(settle(
    [statement('a', 'Anna', [row('k1', 700)])],
    [row('k1', 300)],
  ))
  expect(view.landlordColumns).toEqual([{ key: 'legacy', label: 'Vermieter (Grund pauschal)' }])
  expect(view.items[0]).toMatchObject({ landlordCents: [300], differenceCents: 0 })
  expect(view.legacy).toBe(true)
})

test('weicht die Summe der Zeilen eines Mieters von seinen Gesamtkosten ab, steht das als Abweichung am Mieter', () => {
  const st = statement('a', 'Anna', [row('k1', 1000)])
  st.totalShareCents = 900
  const view = controlView(settle([st], []))
  expect(view.tenants[0]).toMatchObject({ rowsCents: 1000, costCents: 900, rowsDifferenceCents: 100 })
  expect(view.hasDifference).toBe(true)
})

test('die Sonderzeilen zusammen müssen 0 ergeben, sonst zählt das als Differenz', () => {
  const ok = controlView(settle(
    [statement('a', 'Anna', [row('k1', 1000), row('fuel:l1:h1:h2:k1', 80, { kind: 'fuelCarry' })])],
    [landlordRow('fuel:l1:h1:h2', [{ reason: 'fuelCarry', cents: -80 }], { totalCents: 0 })],
  ))
  expect(ok.extrasSumCents).toBe(0)
  expect(ok.hasDifference).toBe(false)
  const bad = controlView(settle(
    [statement('a', 'Anna', [row('k1', 1000), row('stock:p:h:in', 80)])],
    [],
  ))
  expect(bad.extrasSumCents).toBe(80)
  expect(bad.hasDifference).toBe(true)
})

test('die Kennung mit Doppelpunkt entscheidet allein, kind ist nicht nötig', () => {
  const view = controlView(settle([statement('a', 'Anna', [row('k1', 1000), row('co2:p:h', 5)])], []))
  expect(view.extras.map((e) => e.id)).toEqual(['co2:p:h'])
})
