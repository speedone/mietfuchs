// Eine kalte Rechnung über mehrere Abrechnungszeiträume, nach Tagen geteilt (#208, Entwurf 3.4).
//
// Mietfuchs wendet für kalte Betriebskosten das Leistungsprinzip an: Eine Rechnung gehört anteilig
// in jeden Zeitraum, in dem die Leistung erbracht wurde. Das Abflussprinzip wäre ebenfalls zulässig
// (BGH VIII ZR 49/07), wird aber nicht angeboten, denn Positionen tragen kein Zahlungsdatum. Für
// Heizung und Warmwasser gilt das nicht (VIII ZR 156/11): Sie werden nie nach Tagen geteilt.
//
// Die Restcent verteilt `largestRemainder`, der Entscheid ist die Kennung der Rechnung mit dem
// Schlüssel des Zeitraums; der §35a-Lohnanteil folgt demselben Verhältnis. Eine Gutschrift wird mit
// ihrem Betrag geteilt und behält in jedem Teil ihr Vorzeichen. Dieselbe Regel nutzen das Speichern
// (repository.ts) und der Wechsel des Rhythmus (db/periodChange.ts).

import { largestRemainder } from './calc.ts'
import { formatDayRange, periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'
export { baseDescription, isSplitPart } from '../../shared/splitPart.ts'
import { baseDescription, SPLIT_SUFFIX } from '../../shared/splitPart.ts'

export type ServicePart = { period: BillingPeriod; days: number; amountCents: number; labor35aCents: number | null; description: string }

type SplitItem = { id: string; description: string; amountCents: number; labor35aCents?: number; serviceFrom: string; serviceTo: string }

const MS_DAY = 86400000
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1


// Ein Betrag auf die Tage verteilt; ein negativer mit seinem Betrag und danach mit Vorzeichen.
function byDays(total: number, weights: number[], keys: string[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  return largestRemainder(abs, weights.map((w) => (abs * w) / sum), keys).map((c) => sign * c || 0)
}

// Eine Rechnung, die nach Tagen auf die Zeiträume verteilt wird: beim Speichern die ganze Rechnung mit ihrem
// Leistungszeitraum, beim Wechsel des Rhythmus die Summe der bewegten Teile mit deren Spannen (#455).
// `marked`: Es bleiben Teile derselben Quelle stehen, also trägt auch ein einziges Ergebnis den Zusatz.
export type SourceInvoice = {
  tieId: string
  description: string
  amountCents: number
  labor35aCents?: number
  spans: readonly { from: string; to: string }[]
  marked: boolean
}

const maxDay = (a: string, b: string): string => (a > b ? a : b)
const minDay = (a: string, b: string): string => (a < b ? a : b)

// Die Spannen als Vereinigung: sortiert, Überlappendes und Aneinanderstoßendes nicht doppelt gezählt.
function unionOf(spans: readonly { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = spans.filter((s) => s.from <= s.to).map((s) => ({ ...s })).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const merged: { from: string; to: string }[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.from <= last.to) last.to = maxDay(last.to, s.to)
    else merged.push(s)
  }
  return merged
}

export function deriveSourceParts(rules: PeriodRules, invoice: SourceInvoice): ServicePart[] {
  const union = unionOf(invoice.spans)
  const first = union[0]
  const last = union[union.length - 1]
  if (!first || !last) return []
  // Je Zeitraum die Tage der Vereinigung; wo keine liegen (Lücke), kommt nichts hin.
  const rows = periodsBetween(rules, first.from, last.to).flatMap((period) => {
    const overlaps = union
      .map((s) => ({ from: maxDay(s.from, period.from), to: minDay(s.to, period.to) }))
      .filter((o) => o.from <= o.to)
    const first = overlaps[0]
    const last = overlaps[overlaps.length - 1]
    if (!first || !last) return []
    return [{ period, span: { from: first.from, to: last.to }, weight: overlaps.reduce((a, o) => a + days(o.from, o.to), 0) }]
  })
  const weights = rows.map((r) => r.weight)
  const keys = rows.map((r) => `${invoice.tieId}|${r.period.key}`)
  const amounts = byDays(invoice.amountCents, weights, keys)
  // §35a nur an einer Rechnung, nicht an einer Gutschrift (amountProblem in shared/costItem.ts).
  const labor = invoice.labor35aCents && invoice.amountCents > 0 ? byDays(invoice.labor35aCents, weights, keys) : null
  const base = baseDescription(invoice.description)
  const suffixed = rows.length > 1 || invoice.marked
  return rows.map((row, i) => ({
    period: row.period,
    days: row.weight,
    amountCents: amounts[i] ?? 0,
    labor35aCents: labor ? labor[i] ?? 0 : null,
    description: suffixed ? `${base} (anteilig ${formatDayRange(row.span.from, row.span.to)})` : invoice.description,
  }))
}

export function splitByService(rules: PeriodRules, item: SplitItem): ServicePart[] {
  return deriveSourceParts(rules, {
    tieId: item.id,
    description: item.description,
    amountCents: item.amountCents,
    ...(item.labor35aCents !== undefined ? { labor35aCents: item.labor35aCents } : {}),
    spans: [{ from: item.serviceFrom, to: item.serviceTo }],
    marked: false,
  })
}

// Die Abzüge des Betriebsstroms einer Stromrechnung, geteilt wie die Rechnung (Nachprüfung von #252, G4-K1;
// Folge-PR, Geld-H1 und F7). `parts` sind die Teile der Rechnung nach dem Wechsel.
//
// 1. Die Summe aller Abzüge wird **gemeinsam** auf die Teile verteilt, im Verhältnis der **Beträge** der Teile
//    (nicht der Tage). Die Quote eines Teils ist dann Summe × Teil ÷ Rechnung ≤ Teil, und weil der Teil ein ganzer
//    Betrag ist, liegt auch die aufgerundete Quote nicht darüber: Aus keinem Teil wird mehr abgezogen, als er
//    beträgt, bei jeder Zahl von Teilen. Nach Tagen gälte das ab drei Teilen nicht, denn das Restverfahren ist
//    nicht monoton (Alabama-Paradox), und schon bei zwei Teilen nicht, wenn zwei Abzüge die ganze Rechnung ergeben.
// 2. Der Betrag jedes Teils geht der Reihe nach auf die Abzüge, im Verhältnis dessen, was von jedem noch übrig ist;
//    im letzten Teil geht der Rest genau auf. So ergibt jeder Abzug genau seinen Betrag und jeder Teil genau seine
//    Summe, und kein Teil eines Abzugs wechselt das Vorzeichen.
// Gegenüber dem Teilen jedes Abzugs nach Tagen weicht ein Teil um höchstens wenige Cent ab (Geldprüfung F7).
export function splitDeductionsAlike(deductions: readonly { id: string; description: string; amountCents: number }[], parts: readonly ServicePart[]): ServicePart[][] {
  if (deductions.length === 0) return []
  const weights = parts.map((p) => Math.abs(p.amountCents))
  const total = weights.reduce((a, w) => a + w, 0)
  // Eine Rechnung mit Abzug ist positiv (Wächter); ohne Betrag bleiben nur die Tage.
  const basis = total > 0 ? weights : parts.map((p) => p.days)
  const basisSum = basis.reduce((a, w) => a + w, 0)
  const abs = deductions.map((d) => Math.abs(d.amountCents))
  const all = abs.reduce((a, b) => a + b, 0)
  const keys = parts.map((p, i) => `${i}|${p.period.key}`)
  const perPart = basisSum > 0 ? largestRemainder(all, basis.map((w) => (all * w) / basisSum), keys) : parts.map((_, i) => (i === 0 ? all : 0))
  const rest = [...abs]
  const shares: number[][] = deductions.map(() => [])
  perPart.forEach((partCents, k) => {
    const last = k === perPart.length - 1
    const open = rest.reduce((a, r) => a + r, 0)
    const got = last || open === 0
      ? [...rest]
      : largestRemainder(partCents, rest.map((r) => (partCents * r) / open), deductions.map((d) => d.id))
    got.forEach((c, j) => {
      shares[j]?.push(c)
      rest[j] = (rest[j] ?? 0) - c
    })
  })
  return deductions.map((d, j) => {
    const sign = d.amountCents < 0 ? -1 : 1
    const base = baseDescription(d.description)
    return parts.map((p, k) => ({
      period: p.period,
      days: p.days,
      amountCents: sign * (shares[j]?.[k] ?? 0) || 0,
      labor35aCents: null,
      description: parts.length > 1 ? `${base}${SPLIT_SUFFIX.exec(p.description)?.[0] ?? ''}` : d.description,
    }))
  })
}
