// Die Kontrollansicht der Abrechnung (#321): je Kostenposition alle Empfänger nebeneinander (jeder Mieter,
// die Gründe des Vermieters) und eine Summe gegen den Rechnungsbetrag. Reine Anzeige aus der vorhandenen
// Abrechnung, nichts wird neu gerechnet außer den Summen zur Probe. Eine Differenz ungleich 0 dürfte es seit
// #202 nicht geben; gibt es eine, wird sie benannt.

import { landlordReasonLabel } from './landlordReasons'
import type { LandlordReason, Settlement, SettlementRow } from './types'

export type ControlTenant = {
  tenancyId: string
  name: string
  unit: string
  /** Summe der Zeilen der Abrechnung (Positionen und Zeilen ohne Position). */
  rowsCents: number
  /** Die Gesamtkosten laut Abrechnung. */
  costCents: number
  prepaymentCents: number
  balanceCents: number
  /** Zeilen minus Gesamtkosten; 0, wenn beides übereinstimmt. */
  rowsDifferenceCents: number
}

export type ControlColumn = { key: string; label: string }

export type ControlLine = {
  id: string
  category: string
  description: string
  totalCents: number
  /** Je Mieter (Reihenfolge von `tenants`). */
  tenantCents: number[]
  /** Je Spalte des Vermieters (Reihenfolge von `landlordColumns`) oder bei Zeilen ohne Position die Summe. */
  landlordCents: number[]
  sumCents: number
  differenceCents: number
}

export type ControlExtra = {
  id: string
  category: string
  description: string
  tenantCents: number[]
  landlordCents: number
  sumCents: number
}

export type ControlView = {
  tenants: ControlTenant[]
  landlordColumns: ControlColumn[]
  items: ControlLine[]
  extras: ControlExtra[]
  /** Alle Sonderzeilen zusammen (Mieter und Vermieter); Übertrag und Gegenbuchung heben sich auf, also 0. */
  extrasSumCents: number
  /** Mindestens eine Zeile des Vermieters ohne Zerlegung (Abrechnung von vor #142). */
  legacy: boolean
  hasDifference: boolean
}

const LEGACY_KEY = 'legacy'

// Eine Zeile ohne eigene Kostenposition: allein die Pseudo-Kennung entscheidet (`kind` steht nicht an jeder Gegenzeile) (`co2:`, `fuel:`, `gmodg:`, `stock:`, `co2refund:`).
const isExtra = (r: SettlementRow): boolean => r.costItemId.includes(':')

export function controlView(data: Pick<Settlement, 'statements' | 'landlord'>): ControlView {
  const tenants: ControlTenant[] = data.statements.map((st) => {
    const rowsCents = st.rows.reduce((a, r) => a + r.shareCents, 0)
    return {
      tenancyId: st.tenancyId, name: st.tenantName, unit: st.unitName, rowsCents, costCents: st.totalShareCents,
      prepaymentCents: st.prepaymentCents, balanceCents: st.balanceCents, rowsDifferenceCents: rowsCents - st.totalShareCents,
    }
  })

  // Spalten des Vermieters in der Reihenfolge ihres ersten Auftretens; ohne Zerlegung eine pauschale.
  const columns = new Map<string, string>()
  let legacy = false
  const partsOf = (r: SettlementRow): { key: string; cents: number }[] => {
    if (!r.landlordParts || r.landlordParts.length === 0) {
      legacy = true
      columns.set(LEGACY_KEY, 'Vermieter (Grund pauschal)')
      return [{ key: LEGACY_KEY, cents: r.shareCents }]
    }
    return r.landlordParts.map((p) => {
      const key: LandlordReason = p.reason
      if (!columns.has(key)) columns.set(key, landlordReasonLabel(key))
      return { key, cents: p.cents }
    })
  }

  type Acc = { first: SettlementRow; tenant: number[]; landlord: Map<string, number> }
  const items = new Map<string, Acc>()
  const extras = new Map<string, Acc>()
  const accOf = (r: SettlementRow): Acc => {
    const map = isExtra(r) ? extras : items
    let acc = map.get(r.costItemId)
    if (!acc) {
      acc = { first: r, tenant: tenants.map(() => 0), landlord: new Map() }
      map.set(r.costItemId, acc)
    }
    return acc
  }
  data.statements.forEach((st, i) => {
    for (const r of st.rows) accOf(r).tenant[i] = (accOf(r).tenant[i] ?? 0) + r.shareCents
  })
  for (const r of data.landlord.rows) {
    const acc = accOf(r)
    for (const p of partsOf(r)) acc.landlord.set(p.key, (acc.landlord.get(p.key) ?? 0) + p.cents)
  }

  const landlordColumns: ControlColumn[] = [...columns].map(([key, label]) => ({ key, label }))
  const sum = (xs: Iterable<number>) => { let a = 0; for (const x of xs) a += x; return a }

  const lines: ControlLine[] = [...items].map(([id, acc]) => {
    const landlordCents = landlordColumns.map((c) => acc.landlord.get(c.key) ?? 0)
    const sumCents = sum(acc.tenant) + sum(landlordCents)
    return {
      id, category: acc.first.category, description: acc.first.description, totalCents: acc.first.totalCents,
      tenantCents: acc.tenant, landlordCents, sumCents, differenceCents: sumCents - acc.first.totalCents,
    }
  })
  const extraLines: ControlExtra[] = [...extras].map(([id, acc]) => {
    const landlordCents = sum(acc.landlord.values())
    return { id, category: acc.first.category, description: acc.first.description, tenantCents: acc.tenant, landlordCents, sumCents: sum(acc.tenant) + landlordCents }
  })

  const extrasSumCents = sum(extraLines.map((x) => x.sumCents))
  return {
    tenants, landlordColumns, items: lines, extras: extraLines, extrasSumCents, legacy,
    hasDifference: extrasSumCents !== 0 || lines.some((l) => l.differenceCents !== 0) || tenants.some((t) => t.rowsDifferenceCents !== 0),
  }
}
