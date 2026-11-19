// Nachzahlung und Guthaben aus der abgeschlossenen Abrechnung am Betrag erkennen (#308). Rein.
//
// Fachliche Regeln (Issue #308 mit dem Kommentar dazu):
// 1. Es zählt nur der aktuelle Abschluss, also das, was der Mieter bekommen hat. Eine Live-Berechnung kann sich noch
//    ändern; eine wieder geöffnete Abrechnung steht nicht mehr unter den Abschlüssen, und ein alter Stand aus
//    `closed_settlement_history` wird nie gelesen. Nach erneutem Abschluss rechnen schon gebuchte Zahlungen gegen den
//    neuen Stand.
// 2. Offen ist die Nachzahlung (bzw. das Guthaben) abzüglich der Zahlungen der Art „Abrechnung“. Abgeleitet, nie
//    gespeichert. Eine Zahlung trägt keinen Zeitraum; sie gehört deshalb zu den Abrechnungen, deren Zeitraum vor ihrem
//    Datum endete, und tilgt davon die älteste zuerst (wie § 366 Abs. 2 BGB bei gleichartigen Forderungen). Ein Rest, der
//    keiner Abrechnung zuzuordnen ist (etwa eine Abrechnung von vor Mietfuchs), bleibt unbeachtet.
// 3. Vorgeschlagen wird nur bei genauem Betrag und nur, wenn genau eine Abrechnung passt; sonst kein Vorschlag (lieber
//    keiner als ein falscher). Der Vorschlag ist immer gelb: Der Vermieter prüft vor dem Buchen.
// 4. Ein Eingang ist eine Nachzahlung nur, wenn das Mietkonto sonst ausgeglichen ist (kein Rückstand nach der
//    Mietkonto-Logik mit Übertrag, #281); sonst könnte er ebenso gut Miete sein. Ein Ausgang an den Mieter in Höhe des
//    offenen Guthabens braucht das nicht: Miete zahlt der Vermieter nicht aus.

import { plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import type { BillingPeriod, HeatingPlant, Payment, PeriodKey, Property } from '../../../shared/types.ts'
import { compareText } from '../apportion.ts'

// Nachzahlung (positiv) oder Guthaben (negativ) eines Mietverhältnisses aus einem Abschluss.
export type ClosedBalance = {
  // Fest je Abrechnung und Mietverhältnis.
  key: string
  tenancyId: string
  // „Abrechnung 2025“, „Abrechnung Heizkosten 2024/2025“ (wie „Heizkosten …“ in `depositStatements`)
  label: string
  // Letzter Tag des Zeitraums: Eine Zahlung davor gehört nicht zu dieser Abrechnung.
  periodTo: string
  sentAt: string | null
  // Tag des Abschlusses (Datumsteil von `closedAt`). Ohne Versanddatum der früheste Tag, an dem ein Umsatz zu dieser
  // Abrechnung gehören kann (Durchsicht PR #654, 1); den Abzug gebuchter Zahlungen begrenzt er nicht, sonst nähme ein
  // erneuter Abschluss sie wieder heraus.
  closedOn: string
  // Gegenteil von `balanceCents` der Mieterabrechnung: positiv schuldet der Mieter.
  dueCents: number
}

export type OpenSettlement = ClosedBalance & { openCents: number }

// Das Mietkonto, soweit der Vorschlag es braucht, aus `rentLedger` (index.ts). `arrearsCents`: mahnfähiger Rückstand
// heute über alle Jahre. `uncertain`: Eine erteilte Abrechnung rechnet mehr Vorauszahlungen an, als gezahlt sind
// (`creditedAsPaid`); der Mieter schuldet dann außerhalb der Abrechnung, und ein Eingang könnte das sein. `month`: der
// Buchungsmonat (`overdue` = Status „offen“, also Rückstand), `null` ohne Zeile.
export type RentAccount = {
  arrearsCents: number
  uncertain: boolean
  month: { sollCents: number; paidCents: number; overdue: boolean } | null
}

export type SettlementMatch =
  | { type: 'settlement'; settlement: OpenSettlement }
  | { type: 'split'; rentCents: number; settlement: OpenSettlement }

type ClosedArchive = { period: PeriodKey; closedAt: string; sentAt: string | null; settlement: unknown }

// Je Mietverhältnis die Summe der `balanceCents` seiner Mieterabrechnungen im Archivstück. Vorsichtig gelesen: Eine
// frühere Version kann es geschrieben haben (wie `balanceOf` in db/deposits.ts). `heating`: nur die Mieterabrechnungen der
// Heizkostenabrechnung, sonst nur die übrigen (wie `creditedByTenancy` in ledgerStatements.ts).
function balancesIn(settlement: unknown, heating: boolean): Map<string, number> {
  const out = new Map<string, number>()
  if (settlement === null || typeof settlement !== 'object') return out
  const statements: unknown = Reflect.get(settlement, 'statements')
  if (!Array.isArray(statements)) return out
  for (const st of statements) {
    if (st === null || typeof st !== 'object') continue
    const id: unknown = Reflect.get(st, 'tenancyId')
    const cents: unknown = Reflect.get(st, 'balanceCents')
    if ((Reflect.get(st, 'scope') === 'heating') !== heating) continue
    if (typeof id !== 'string' || typeof cents !== 'number' || !Number.isSafeInteger(cents)) continue
    out.set(id, (out.get(id) ?? 0) + cents)
  }
  return out
}

export function closedBalancesOf(input: {
  properties: readonly Pick<Property, 'id' | 'periodRules'>[]
  heatingPlants: readonly Pick<HeatingPlant, 'id' | 'propertyId' | 'periodStartMonth' | 'periodChanges' | 'separateSpans'>[]
  closed: readonly (ClosedArchive & { propertyId: string })[]
  closedHeating: readonly (ClosedArchive & { plantId: string })[]
}): ClosedBalance[] {
  const out: ClosedBalance[] = []
  const rulesOfProperty = (id: string) => rulesOf(input.properties.find((p) => p.id === id))
  const add = (owner: string, c: ClosedArchive, p: BillingPeriod, heating: boolean) => {
    for (const [tenancyId, cents] of balancesIn(c.settlement, heating)) {
      if (cents === 0) continue
      const label = heating ? `Abrechnung Heizkosten ${periodLabel(p)}` : `Abrechnung ${periodLabel(p)}`
      out.push({ key: `${owner}|${c.period}|${tenancyId}`, tenancyId, label, periodTo: p.to, sentAt: c.sentAt, closedOn: c.closedAt.slice(0, 10), dueCents: -cents })
    }
  }
  for (const c of input.closed) {
    const p = periodOfKey(rulesOfProperty(c.propertyId), c.period)
    if (p !== null) add(`objekt:${c.propertyId}`, c, p, false)
  }
  // Eine Heizperiode zählt nur, solange sie getrennt abgerechnet wird (wie `depositStatements` in db/deposits.ts).
  for (const c of input.closedHeating) {
    const plant = input.heatingPlants.find((x) => x.id === c.plantId)
    if (!plant) continue
    const objectRules = rulesOfProperty(plant.propertyId)
    const h = periodOfKey(plantRules(plant, objectRules), c.period)
    if (h !== null && settledSeparately(plant, objectRules, h)) add(`anlage:${c.plantId}`, c, h, true)
  }
  return out
}

// Der offene Rest je Abrechnung nach den Zahlungen der Art „Abrechnung“ (Regel 2). Eine Zahlung mindert nur Beträge ihrer
// Richtung: Eine Nachzahlung des Mieters kein Guthaben, eine Auszahlung keine Nachzahlung.
export function openSettlementsOf(balances: readonly ClosedBalance[], payments: readonly Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind'>[]): OpenSettlement[] {
  const open = balances.map((b) => ({ ...b, openCents: b.dueCents }))
  const oldestFirst = [...open].sort((a, b) => compareText(a.periodTo, b.periodTo) || compareText(a.key, b.key))
  const settlementPayments = payments.filter((p) => p.kind === 'settlement' && p.amountCents !== 0)
    .sort((a, b) => compareText(a.date, b.date))
  for (const p of settlementPayments) {
    const sign = Math.sign(p.amountCents)
    let rest = Math.abs(p.amountCents)
    for (const o of oldestFirst) {
      if (rest === 0) break
      if (o.tenancyId !== p.tenancyId || compareText(o.periodTo, p.date) >= 0 || Math.sign(o.openCents) !== sign) continue
      const take = Math.min(rest, Math.abs(o.openCents))
      o.openCents -= sign * take
      rest -= take
    }
  }
  return open
}

// Kann der Umsatz vom Buchungstag zu dieser Abrechnung gehören? Erst nach dem Zeitraum und ab dem Versand, ohne
// Versanddatum ab dem Abschluss (Durchsicht PR #654, 1): Vorher kennt der Mieter den Betrag nicht. Ein Versand auf Papier
// vor dem Abschluss in Mietfuchs geht vor.
const eligible = (o: OpenSettlement, bookingDate: string): boolean =>
  compareText(o.periodTo, bookingDate) < 0 && compareText(o.sentAt ?? o.closedOn, bookingDate) <= 0

// Regel 3 und 4. `sollCents`: Monats-Soll des Buchungsmonats laut Mietkonto. Ein Betrag gleich dem Soll bleibt Miete, wie
// bisher (dann ist die Miete der wahrscheinlichere Grund, und die grüne Zuordnung ändert sich nicht).
export function matchSettlement(
  tx: { amountCents: number; bookingDate: string },
  open: readonly OpenSettlement[],
  account: RentAccount | null,
  sollCents: number | null,
): SettlementMatch | null {
  const candidates = open.filter((o) => o.openCents !== 0 && eligible(o, tx.bookingDate))
  if (tx.amountCents < 0) {
    const hits = candidates.filter((o) => o.openCents === tx.amountCents)
    return hits.length === 1 && hits[0] ? { type: 'settlement', settlement: hits[0] } : null
  }
  if (tx.amountCents <= 0 || account === null || account.uncertain || sollCents === tx.amountCents) return null
  const owed = candidates.filter((o) => o.openCents > 0)
  const exact = owed.filter((o) => o.openCents === tx.amountCents)
  const month = account.month
  // Miete + Nachzahlung: Die Miete des Buchungsmonats ist noch ganz offen, und außer ihr ist nichts im Rückstand.
  const splitPossible = month !== null && sollCents !== null && sollCents > 0 && month.sollCents === sollCents && month.paidCents === 0
  const split = splitPossible ? owed.filter((o) => o.openCents + sollCents === tx.amountCents) : []
  if (exact.length + split.length !== 1) return null
  if (exact[0]) return account.arrearsCents === 0 ? { type: 'settlement', settlement: exact[0] } : null
  const s = split[0]
  if (!s || month === null || sollCents === null) return null
  return account.arrearsCents === (month.overdue ? sollCents : 0) ? { type: 'split', rentCents: sollCents, settlement: s } : null
}
