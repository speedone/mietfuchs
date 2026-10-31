// Das Zahlungsdatum einer Kostenposition für die Steuer (#255, PR 3, Entscheidungen R-2 bis R-8). Hier stehen die
// Regeln, die Server und Formular gleich sehen müssen: welches Jahr eine Angabe ergibt, die übliche Spanne, wann sich
// das wirksame Jahr ändert (dann fragt das Formular nach und der Server verlangt die Bestätigung) und wann der Hinweis
// zur Zehn-Tage-Regel kommt. **Gerechnet** wird das Steuerjahr nur in server/src/outflow.ts (`outflowShares`), das
// `statedOutflowYear` von hier nimmt; jede Auswertung fragt dort (Abstimmung in #292).
//
// - Das Datum gilt für die ganze Position (Abstimmung 1 in #255). Teilzahlungen und Abschläge bildet es nicht ab; die
//   kommen mit den verknüpften Abbuchungen (#292), und eine verknüpfte Abbuchung ist ein Nachweis, keine zusätzliche
//   Zahlung (Abstimmung 2).
// - Vorrang: Zahlungsdatum, dann das angegebene Jahr der Zahlung (`taxYear`, das bleibt, Abstimmung 3), dann das
//   Abrechnungsjahr.
// - Maßgeblich ist der Abfluss (§ 11 Abs. 2 Satz 1 EStG), nicht das Rechnungsdatum und nicht der Buchungstag: bei der
//   Überweisung der Eingang des gedeckten Auftrags bei der Bank (H 11 EStH 2024 „Überweisung“), bei der Lastschrift der
//   Einzug (BFH VIII B 58/15). Deshalb belegt die Belegbuchung das Feld nie vor.
import type { CostItem } from './types.ts'
import { isNotAllocable, isReserveCategory } from './categories.ts'

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Ist das ein Kalendertag in der Form JJJJ-MM-TT?
export function isPaidOnDate(v: unknown): v is string {
  return typeof v === 'string' && ISO.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
}

export const paidOnYear = (paidOn: string): number => Number(paidOn.slice(0, 4))

// Das angegebene Steuerjahr einer Position: aus dem Zahlungsdatum, sonst das angegebene Jahr der Zahlung; `null` ohne
// Angabe (dann gilt das Abrechnungsjahr). `!= null`, weil ein `null` aus einer Ablage „nicht angegeben“ heißt.
export function statedOutflowYear(item: { paidOn?: string | null; taxYear?: number | null }): number | null {
  if (item.paidOn != null) return paidOnYear(item.paidOn)
  if (item.taxYear != null) return item.taxYear
  return null
}

// Wo es kein Zahlungsdatum gibt (R-6, Abzug #267): Hausgeld laut Gemeinschaftsabrechnung trägt den Anteil eines Jahres
// laut Abrechnung, keine einzelne Zahlung; der Abzug beim Betriebsstrom fließt mit seiner Stromrechnung ab. Bei einer
// nicht umlagefähigen Kostenart zählt der Schlüssel nicht (`costItemBody` speichert einen neutralen), ein
// stehengebliebenes `external` also auch nicht (Durchsicht K1). An Zuführung und Entnahme der Erhaltungsrücklage
// (#143, #96 A3) auch nicht: Maßgeblich ist, wann die Gemeinschaft das Geld ausgibt (BFH, Urteil vom 14.01.2025,
// IX R 19/24), und im Feld stünde erfahrungsgemäß die eigene Hausgeldzahlung. Das Jahr genügt, die Hausgeldabrechnung
// ist eine Jahresrechnung. Server (Ablehnung mit 400) und Formular (kein Feld) fragen beide hier.
export const allowsPaidOn = (item: Pick<CostItem, 'key'> & { category?: string; operatingPower?: CostItem['operatingPower'] | null }): boolean =>
  (item.category === undefined || !isReserveCategory(item.category)) &&
  (item.key !== 'external' || (item.category !== undefined && isNotAllocable(item.category))) && item.operatingPower !== 'deduction'

// Die übliche Spanne (R-4): vom Jahr vor dem Beginn (Vorauszahlung im Dezember) bis drei Jahre nach dem Ende (späte
// Nachzahlung, etwa nach einem Grundsteuerbescheid, § 30 Abs. 1 GrStG). Außerhalb fragt Mietfuchs nach, statt
// abzulehnen; § 11 Abs. 2 EStG kennt keine Grenze.
export type YearSpan = { startYear: number; endYear: number }
export const paidOnSpan = (p: YearSpan): { from: number; to: number } => ({ from: p.startYear - 1, to: p.endYear + 3 })

type Dated = { paidOn?: string | null; taxYear?: number | null; period: string }
const effectiveYear = (c: Dated): number => statedOutflowYear(c) ?? Number(c.period.slice(0, 4))
const fmt = (iso: string): string => iso.split('-').reverse().join('.')

// Was ein neu eingetragenes, geändertes oder entferntes Zahlungsdatum für die Steuer ändert (R-2, R-4), als Sätze für
// die Rückfrage; leer heißt: nichts zu bestätigen. `before` ist die gespeicherte Position (`null` beim Anlegen), `span`
// die Jahre des Zeitraums, in dem `after` steht (bei einer Heizposition unter eigener Heizperiode deren Jahre).
// Gefragt wird nur, wenn sich das Datum ändert: Wer nur den Betrag berichtigt, bestätigt nichts erneut.
export function paidOnQuestions(before: Dated | null, after: Dated, span: YearSpan): string[] {
  return withAdvice(paidOnFindings(before, after, span))
}

// Der Rat bei jeder Rückfrage, die das Jahr einer Position für die Steuer ändert; auch in shared/spread.ts (#262).
export const ADVICE = 'Haben Sie die Steuererklärung eines betroffenen Jahres schon abgegeben, besprechen Sie die Änderung mit Ihrem Steuerberater oder Finanzamt.'
const withAdvice = (findings: string[]): string[] => (findings.length > 0 ? [...findings, ADVICE] : [])

function paidOnFindings(before: Dated | null, after: Dated, span: YearSpan): string[] {
  const was = before?.paidOn ?? null
  const now = after.paidOn ?? null
  if (was === now) return []
  const out: string[] = []
  const prior = before === null ? effectiveYear({ ...after, paidOn: null }) : effectiveYear(before)
  const next = effectiveYear(after)
  if (now !== null && after.taxYear != null && after.taxYear !== paidOnYear(now)) {
    out.push(`Als Jahr der Zahlung ist ${after.taxYear} angegeben; mit dem Datum ${fmt(now)} zählt die Position für die Steuer zu ${paidOnYear(now)}.`)
  } else if (prior !== next) {
    out.push(now === null
      ? `Ohne Zahlungsdatum zählt die Position für die Steuer wieder zu ${next} statt zu ${prior}.`
      : `Mit dem Datum ${fmt(now)} zählt die Position für die Steuer zu ${next} statt zu ${prior}.`)
  }
  if (now !== null) {
    const s = paidOnSpan(span)
    const y = paidOnYear(now)
    if (y < s.from || y > s.to) {
      out.push(`Das Datum ${fmt(now)} liegt außerhalb der üblichen Spanne von ${s.from} bis ${s.to} für diesen Abrechnungszeitraum. Bitte prüfen Sie das Jahr.`)
    }
  }
  return out
}

// Die Rückfrage zum Jahr der Zahlung (#478, E2): Ein Jahr ist eine gröbere Angabe als ein Datum und bekommt dieselbe
// übliche Spanne (`paidOnSpan`) und dieselbe Haltung: außerhalb nachfragen statt ablehnen, denn § 11 Abs. 2 EStG kennt
// keine Grenze. Gefragt wird nur, wenn sich das Jahr ändert (wer nur den Betrag berichtigt, bestätigt nichts erneut),
// in beiden Arten von Zeiträumen gleich. Ein Jahr innerhalb der Spanne, das das wirksame Jahr ändert, fragt nicht; die
// Steuerübersicht nennt die Position dann als verschoben. Server (`requireTaxYear`, 409 `question: 'taxYear'`) und
// Formular fragen beide hier.
export function taxYearQuestions(before: { taxYear?: number | null } | null, after: { taxYear?: number | null; period: string }, span: YearSpan): string[] {
  const now = after.taxYear ?? null
  if (now === null || (before?.taxYear ?? null) === now) return []
  const s = paidOnSpan(span)
  if (now >= s.from && now <= s.to) return []
  return withAdvice([`Als Jahr der Zahlung ist ${now} angegeben; das liegt außerhalb der üblichen Spanne von ${s.from} bis ${s.to} für diesen Abrechnungszeitraum. Bitte prüfen Sie das Jahr.`])
}

// Dieselbe Frage beim Aufteilen einer Rechnung über mehrere Abrechnungszeiträume (#208, Durchsicht von PR 3, M1): Das
// Datum gilt für die ganze Rechnung, also für jeden Teil, und jeder Teil zählt mit seinem eigenen Zeitraum. Ein Teil in
// einem anderen Kalenderjahr hätte ohne Datum sein eigenes Jahr; das Datum kann also das Steuerjahr eines Teils ändern,
// auch wenn es im Jahr des Formulars liegt. Server (`saveCostItemSplit`) und Formular (Kosten.tsx, nach der Vorschau)
// fragen beide hier, mit den Teilen der Vorschau (`SplitPreviewPart` trägt die Jahre ihres Zeitraums). Ein Teil über
// zwei Kalenderjahre trägt das Jahr der Zahlung des Rumpfes, einer in einem Kalenderjahr keines. Gefragt wird nur, wenn
// sich das Datum gegenüber der gespeicherten Position ändert; verglichen wird ein Teil mit ihr, wenn er in ihrem Zeitraum
// liegt, sonst wie neu angelegt.
export type SplitPartSpan = YearSpan & { period: string; needsTaxYear: boolean }
export function splitPaidOnQuestions(current: Dated | null, base: Dated, parts: readonly SplitPartSpan[]): string[] {
  if (current !== null && (current.paidOn ?? null) === (base.paidOn ?? null)) return []
  const out: string[] = []
  for (const p of parts) {
    const part = { ...base, period: p.period, taxYear: p.needsTaxYear ? base.taxYear ?? null : null }
    for (const q of paidOnFindings(current !== null && current.period === p.period ? current : null, part, p)) {
      if (!out.includes(q)) out.push(q)
    }
  }
  return withAdvice(out)
}

// Der Hinweis zur Zehn-Tage-Regel (R-8, § 11 Abs. 2 Satz 2 in Verbindung mit Abs. 1 Satz 2 EStG): nur ein Hinweis,
// gerechnet wird die Regel nicht, denn sie hängt an der Fälligkeit (BFH X R 2/21), die Mietfuchs nicht kennt. Er kommt,
// wenn das Datum zwischen dem 22.12. und dem 10.01. liegt, und nie bei der Grundsteuer: Ihre gesetzlichen Fälligkeiten
// (§ 28 GrStG) liegen nie in dieser Zeit, und eine Nachzahlung nach § 30 GrStG ist nicht regelmäßig wiederkehrend.
export function tenDayWindow(paidOn: string, category: string): boolean {
  if (category === 'Grundsteuer' || !isPaidOnDate(paidOn)) return false
  const md = paidOn.slice(5)
  return md >= '12-22' || md <= '01-10'
}
