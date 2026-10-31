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

// `span` (Befund 3 zu #455): die Tage des Leistungszeitraums, die der Teil trägt, vom ersten bis zum letzten; daraus der
// Zusatz „(anteilig …)“. Kommt der Teil beim Wechsel des Rhythmus zu einem stehenden Teil, nennt dessen neuer Zusatz beide
// Spannen (`mergedNamer` in db/periodChange.ts).
export type ServicePart = { period: BillingPeriod; days: number; amountCents: number; labor35aCents: number | null; description: string; span?: { from: string; to: string } }

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
    span: row.span,
  }))
}

// Mehrere Rechnungen je Jahr der Zahlung aus einer Quelle (#478): Stehen Teile verschiedener Jahre im selben Zeitraum,
// trägt jeder dort dieselbe Spanne, und welcher Tag mit welchem Jahr bezahlt wurde, weiß der Bestand nicht. Je Jahr für
// sich nach dieser Spanne geteilt, zählten ihre Tage doppelt, und Geld wanderte zwischen Abrechnungszeiträumen. Deshalb
// gilt je Zeitraum die Teilung aller bewegten Teile als eine Rechnung nach Tagen (`whole`), und jedes Jahr bekommt davon,
// was seine Teile im Verhältnis ihres Betrags zu ihrer Spanne beitragen. Je Jahr bleibt die Summe, je Zeitraum die
// Teilung nach Tagen; den Restcent verteilt `largestRemainder` je Jahr, das letzte Jahr nimmt je Zeitraum den Rest.
// `null`, wenn die Teile eines Jahres verschiedene Vorzeichen haben (dann bleibt die Teilung je Jahr für sich).
//
// Der Rest gleicht nur Rundung aus (Durchsicht #478, Befund 6): Haben die Jahre verschiedene Sätze je Tag (A 2025 für
// Januar bis Juni, B 2026 für Juli bis Dezember), weicht die Teilung als Ganzes um mehr als Restcent von den Anteilen
// nach Tagen ab, und das letzte Jahr bekäme Geld in einem Zeitraum ohne seine Tage. Dann bleibt jedes Jahr bei seinem
// Anteil nach seinen Tagen; je Zeitraum ist die Summe dieser Anteile richtig, nur anders gerundet.
export type PoolMember = { amountCents: number; labor35aCents: number; span: { from: string; to: string } }
export function splitPoolsByDays(whole: readonly ServicePart[], pools: readonly { members: readonly PoolMember[]; parts: readonly ServicePart[] }[], tieId: string): ServicePart[][] | null {
  const signOf = (n: number): number => (n < 0 ? -1 : 1)
  const shareOf = (m: PoolMember, p: ServicePart): number => {
    const from = maxDay(m.span.from, p.period.from)
    const to = minDay(m.span.to, p.period.to)
    return from <= to ? days(from, to) / days(m.span.from, m.span.to) : 0
  }
  const spread = (field: 'amountCents' | 'labor35aCents', total: (p: ServicePart) => number): number[][] | null => {
    const own: number[][] = []
    for (const [k, pool] of pools.entries()) {
      const sum = pool.members.reduce((a, m) => a + m[field], 0)
      const sign = signOf(sum)
      if (pool.members.some((m) => m[field] !== 0 && signOf(m[field]) !== sign)) return null
      const raws = whole.map((p) => pool.members.reduce((a, m) => a + Math.abs(m[field]) * shareOf(m, p), 0))
      own.push(largestRemainder(Math.abs(sum), raws, whole.map((p) => `${tieId}|${p.period.key}|${k}`)).map((c) => sign * c || 0))
    }
    // Das letzte Jahr nimmt je Zeitraum den Rest der Teilung nach Tagen. Wiche das um mehr als Rundung von seinem Anteil
    // ab oder kehrte es sein Vorzeichen um (ein einzeln berichtigter Teil trägt mehr als seine Tage, oder die Sätze je
    // Tag der Jahre sind verschieden), bleibt jedes Jahr bei seinem Anteil nach seinen Tagen: Eine Berichtigung bleibt
    // dann an ihren Tagen, wie bei einem Teil ohne Quelle.
    const lastIndex = pools.length - 1
    const last = whole.map((p, i) => total(p) - own.slice(0, lastIndex).reduce((a, r) => a + (r[i] ?? 0), 0))
    const lastSign = signOf(pools[lastIndex]?.members.reduce((a, m) => a + m[field], 0) ?? 0)
    const ownLast = own[lastIndex] ?? []
    const offRounding = last.some((c, i) => Math.abs(c - (ownLast[i] ?? 0)) > pools.length)
    return offRounding || last.some((c) => c !== 0 && signOf(c) !== lastSign) ? own : [...own.slice(0, lastIndex), last]
  }
  const amounts = spread('amountCents', (p) => p.amountCents)
  const hasLabor = pools.some((pool) => pool.members.some((m) => m.labor35aCents !== 0))
  // Trägt die Teilung als Ganzes keinen Lohnanteil (Summe nicht positiv, § 35a nur an einer Rechnung), ein Jahr aber
  // schon, bleibt jedes Jahr bei seiner Teilung; sonst ginge sein Lohnanteil verloren (Durchsicht #478, Befund 3).
  if (hasLabor && whole.every((p) => p.labor35aCents === null)) return null
  const labor = hasLabor ? spread('labor35aCents', (p) => p.labor35aCents ?? 0) : null
  if (amounts === null || (hasLabor && labor === null)) return null
  return pools.map((pool, k) => whole.flatMap((w, i) => {
    const own = pool.parts.find((p) => p.period.key === w.period.key)
    const amountCents = amounts[k]?.[i] ?? 0
    const laborCents = labor === null ? null : labor[k]?.[i] ?? 0
    if (own === undefined) return amountCents === 0 && !laborCents ? [] : [{ ...w, amountCents, labor35aCents: laborCents }]
    return [{ ...own, amountCents, labor35aCents: own.labor35aCents === null && !laborCents ? null : laborCents }]
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
