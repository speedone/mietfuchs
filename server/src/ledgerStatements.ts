// Die Abrechnungen eines Objekts, wie das Mietkonto sie für die Abrechnungsreife liest (#281, Entwurf
// docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md, E5). calc.ts bleibt rein: Diese Datei baut aus dem
// Schnappschuss und den Abschlüssen die `LedgerStatement`s, die `rentLedger` mit `statements` bekommt; die Route
// /api/rentledger reicht sie hinein.
//
// Je Abrechnung (kalte Abrechnung je Zeitraum des Objekts, getrennte Heizkostenabrechnung je Heizperiode nach Weg d):
// - die Monate, die sie anrechnet, Bezeichnung und Frist (`settlementDeadline`, § 556 Abs. 3 Satz 2 BGB, Fassung am
//   Beginn des Zeitraums wie in der Abrechnung);
// - ob sie abgeschlossen ist und ihr Versanddatum (`sentAt`), aus den Abschlusstabellen;
// - die eingefrorene Anrechnung der Vorauszahlungen je Mietverhältnis (`prepaymentCents` der Mieterabrechnungen im
//   Archivstück; bei einer Jahreskorrektur das Gezahlte, sonst das Soll);
// - welche Vorauszahlung eines Monats sie anrechnet (`covers`): die kalte immer die Abrechnung des Objekts, die
//   Heizvorauszahlung die Heizkostenabrechnung der getrennten Heizperiode, die den Monat enthält, sonst ebenfalls die
//   des Objekts (`separateOwner`, shared/heatingPeriod.ts, die eine Stelle für diese Regel).
import { periodLabel, periodMonths, periodsBetween, rulesOf, settlementDeadline } from '../../shared/period.ts'
import { plantRules, separateOwner, servesUnit, settledSeparately } from '../../shared/heatingPeriod.ts'
import type { PeriodKey } from '../../shared/types.ts'
import { compareText } from './apportion.ts'
import type { LedgerStatement } from './calc.ts'
import { wayOf, type Snapshot } from './snapshot.ts'

export type ClosedForLedger = { period: PeriodKey; sentAt: string | null; settlement: unknown }

// Die Anrechnung je Mietverhältnis aus einem Archivstück. Ein Archivstück ist ungetypt (eine frühere Version hat es
// geschrieben); gelesen wird nur, was eine Zahl ist. `heating`: nur die Mieterabrechnungen der Heizkostenabrechnung,
// sonst nur die übrigen.
export function creditedByTenancy(settlement: unknown, heating: boolean): Map<string, number> {
  const out = new Map<string, number>()
  if (settlement === null || typeof settlement !== 'object') return out
  const statements: unknown = Reflect.get(settlement, 'statements')
  if (!Array.isArray(statements)) return out
  for (const st of statements) {
    if (st === null || typeof st !== 'object') continue
    const id: unknown = Reflect.get(st, 'tenancyId')
    const cents: unknown = Reflect.get(st, 'prepaymentCents')
    const isHeating = Reflect.get(st, 'scope') === 'heating'
    if (typeof id !== 'string' || typeof cents !== 'number' || isHeating !== heating) continue
    out.set(id, (out.get(id) ?? 0) + cents)
  }
  return out
}

// Alle Abrechnungen, die Monate ab dem ersten Mietbeginn des Objekts bis `until` anrechnen.
export function ledgerStatementsFor(
  snapshot: Pick<Snapshot, 'tenancies' | 'units' | 'heatingPlants' | 'objectRules' | 'property'>,
  closed: readonly ClosedForLedger[],
  closedHeating: readonly (ClosedForLedger & { plantId: string })[],
  until: string,
): LedgerStatement[] {
  const first = snapshot.tenancies.map((t) => t.start).reduce<string | null>((a, b) => (a === null || compareText(b, a) < 0 ? b : a), null)
  if (first === null || compareText(first, until) > 0) return []
  const rules = snapshot.objectRules ?? rulesOf(null)
  const plants = (snapshot.heatingPlants ?? []).map((p) => ({ plant: p, way: wayOf(p) }))
  const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
  const tenancyById = new Map(snapshot.tenancies.map((t) => [t.id, t]))
  // Die Anlage, die die Wohnung eines Mietverhältnisses versorgt (wie im Hinweis `prepayment.arrears` in calc.ts).
  const plantOf = (tenancyId: string) => {
    const t = tenancyById.get(tenancyId)
    const unit = t ? unitById.get(t.unitId) : undefined
    return unit ? plants.find((p) => servesUnit(p.plant, unit)) : undefined
  }
  const separateOf = (tenancyId: string, month: string) => {
    const p = plantOf(tenancyId)
    return p ? { plantId: p.plant.id, period: separateOwner(p.way, rules, month) } : null
  }

  const out: LedgerStatement[] = []
  for (const p of periodsBetween(rules, first, until)) {
    const c = closed.find((x) => x.period === p.key)
    out.push({
      label: periodLabel(p),
      months: periodMonths(p),
      deadline: settlementDeadline(p),
      closed: c !== undefined,
      sentAt: c?.sentAt ?? null,
      credited: c ? creditedByTenancy(c.settlement, false) : null,
      covers: (tenancyId, month, component) => component === 'prepayment' || (separateOf(tenancyId, month)?.period ?? null) === null,
    })
  }
  for (const { plant, way } of plants) {
    if (way.periodStartMonth === null) continue
    for (const h of periodsBetween(plantRules(way, rules), first, until)) {
      if (!settledSeparately(way, rules, h)) continue
      const c = closedHeating.find((x) => x.plantId === plant.id && x.period === h.key)
      out.push({
        label: periodLabel(h),
        months: periodMonths(h),
        deadline: settlementDeadline(h),
        closed: c !== undefined,
        sentAt: c?.sentAt ?? null,
        credited: c ? creditedByTenancy(c.settlement, true) : null,
        covers: (tenancyId, month, component) => {
          if (component !== 'heatingPrepayment') return false
          const owner = separateOf(tenancyId, month)
          return owner !== null && owner.plantId === plant.id && owner.period?.key === h.key
        },
      })
    }
  }
  return out
}
