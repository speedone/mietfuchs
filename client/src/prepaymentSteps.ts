// „In die Staffel übernehmen“ (#317), ohne DOM prüfbar: was die Karte je Mieter zeigt und was vor dem Übernehmen zu
// fragen ist. Den Plan rechnet der Server (server/src/prepaymentSteps.ts); hier werden nur Sätze daraus.
import type { PrepaymentStepItem, PrepaymentStepPlan, Statement, StatementLetter } from './types'
import { fmtEuro } from './api'
import { monthLabel } from './monthText'
import { secondPrepaymentLabel } from '../../shared/heatingModel.ts'

export const scheduleLabel = (it: Pick<PrepaymentStepItem, 'schedule'>): string =>
  it.schedule === 'heatingPrepayments' ? 'Heizvorauszahlung' : 'Vorauszahlung'

// #704: Die Zeilen eines Eintrags, je Staffel eine. Mit zwei Staffeln ist `cents` der Teil der übrigen Nebenkosten.
// #712: Die zweite Staffel heißt, wie das abgeschlossene Schreiben sie führt (`heating.coversWater`, `secondPrepaymentLabel`).
export type StepRow = { label: string; cents: number; currentCents: number; existing: PrepaymentStepItem['existing']; earlier: PrepaymentStepItem['earlier'] }
const REST_LABEL = 'Übrige Vorauszahlung'
export function stepRows(it: PrepaymentStepItem): StepRow[] {
  if (!it.heating) return [{ label: scheduleLabel(it), cents: it.cents, currentCents: it.currentCents, existing: it.existing, earlier: it.earlier }]
  return [
    { label: REST_LABEL, cents: it.cents, currentCents: it.currentCents, existing: it.existing, earlier: it.earlier },
    { label: secondPrepaymentLabel(it.heating.coversWater, 'prepayment'), cents: it.heating.cents, currentCents: it.heating.currentCents, existing: it.heating.existing, earlier: it.heating.earlier },
  ]
}
// Der angekündigte Betrag eines Eintrags: mit zwei Staffeln die Summe beider Teile.
export const stepTotal = (it: PrepaymentStepItem): number => it.cents + (it.heating?.cents ?? 0)

// Der Stand je Mieter in einem Satz.
export function stepStatus(it: PrepaymentStepItem): string {
  if (it.state === 'blocked') return it.blocked ?? 'Lässt sich nicht übernehmen.'
  if (it.heating) {
    const what = `Vorauszahlung ${fmtEuro(stepTotal(it))} ab ${monthLabel(it.from)} (übrige Nebenkosten ${fmtEuro(it.cents)}, ${secondPrepaymentLabel(it.heating.coversWater, 'short')} ${fmtEuro(it.heating.cents)})`
    if (it.state === 'taken') return `${what}: steht in beiden Staffeln.`
    return `${what}: noch nicht in der Staffel (dort ${fmtEuro(it.currentCents)} und ${fmtEuro(it.heating.currentCents)}).`
  }
  const what = `${scheduleLabel(it)} ${fmtEuro(it.cents)} ab ${monthLabel(it.from)}`
  if (it.state === 'taken') return `${what}: steht in der Staffel.`
  return `${what}: noch nicht in der Staffel (dort ${fmtEuro(it.currentCents)}).`
}

export const pendingItems = (plan: PrepaymentStepPlan | null): PrepaymentStepItem[] => (plan?.items ?? []).filter((it) => it.state === 'pending')
export const overdueItems = (plan: PrepaymentStepPlan | null): PrepaymentStepItem[] => pendingItems(plan).filter((it) => it.overdue)

// Der Hinweis, wenn eine angekündigte Anpassung im Monat, ab dem sie gilt, noch nicht in der Staffel steht: Das Schreiben
// ist schon die Erklärung; das Mietkonto fordert sonst den bisherigen Betrag.
export function overdueText(items: readonly PrepaymentStepItem[]): string | null {
  if (items.length === 0) return null
  const names = items.map((it) => `${it.tenantName} (${fmtEuro(stepTotal(it))} ab ${monthLabel(it.from)})`).join(', ')
  return `Angekündigt, aber noch nicht in der Staffel: ${names}. Das Mietkonto führt bis dahin die bisherige Vorauszahlung im Soll.`
}

// Was vor dem Übernehmen zu fragen ist: Fehler der Abrechnung, eine Stufe ab dem Monat, Sätze zu Versand und Zugang.
// `null`, wenn nichts zu fragen ist.
export function stepQuestion(plan: PrepaymentStepPlan, chosen: readonly string[]): string[] | null {
  const items = plan.items.filter((it) => chosen.includes(it.tenancyId) && it.state === 'pending')
  const lines: string[] = []
  if (plan.errors.length > 0) {
    lines.push(`Die Abrechnung hat Fehler (${plan.errors.join('; ')}). Eine Anpassung der Vorauszahlungen setzt eine formell und inhaltlich korrekte Abrechnung voraus (BGH, VIII ZR 246/11, Leitsatz).`)
  }
  for (const it of items) {
    // Je Staffel, die geschrieben wird (#704: bei zwei Staffeln jede beim Namen, und nichts zu einer, die schon stimmt).
    const rows = it.heating ? stepRows(it).filter((r) => r.cents !== r.currentCents) : stepRows(it)
    for (const r of rows) {
      if (r.existing.length === 0) continue
      const steps = r.existing.map((e) => `${fmtEuro(e.monthlyCents)} ab ${monthLabel(e.from)}`).join(', ')
      const same = r.existing.some((e) => e.from === it.from)
      const where = it.heating ? `in der Staffel der ${r.label === REST_LABEL ? 'übrigen Vorauszahlung' : r.label}` : 'in der Staffel'
      lines.push(`${it.tenantName}: Ab ${monthLabel(it.from)} steht ${where} schon ${steps}.${same ? ` Die Stufe ab ${monthLabel(it.from)} wird ersetzt` : ' Die neue Stufe kommt davor'}${r.existing.some((e) => e.from > it.from) ? ', spätere bleiben' : ''}. Stammt sie schon aus dieser Abrechnung, wäre eine zweite Anpassung nicht wirksam: Nach AG Köln, Urteil vom 11.12.2023, 203 C 73/23, Rn. 27, kann die Vorauszahlung aufgrund derselben Abrechnung nur einmal angepasst werden.`)
    }
    // S2 der Durchsicht: auch eine Stufe zwischen dem Ende des abgerechneten Zeitraums und dem Monat.
    const earlier = rows.flatMap((r) => r.earlier.map((e) => `${fmtEuro(e.monthlyCents)} ab ${monthLabel(e.from)}${it.heating ? ` (${r.label === REST_LABEL ? 'übrige Vorauszahlung' : r.label})` : ''}`))
    if (earlier.length > 0) {
      const steps = earlier.length > 1 && it.heating ? `${earlier.slice(0, -1).join(', ')} und ${earlier[earlier.length - 1]}` : earlier.join(', ')
      lines.push(`${it.tenantName}: Nach dem abgerechneten Zeitraum steht schon ${steps}. Stammt das schon aus dieser Abrechnung, wäre eine zweite Anpassung nicht wirksam: Nach AG Köln, Urteil vom 11.12.2023, 203 C 73/23, Rn. 27, kann die Vorauszahlung aufgrund derselben Abrechnung nur einmal angepasst werden.`)
    }
    for (const note of it.notes) lines.push(`${it.tenantName}: ${note}`)
  }
  return lines.length > 0 ? lines : null
}

const addMonths = (month: string, n: number): string => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

// S1 der Durchsicht: Der Monat im eingefrorenen Anschreiben entstand mit dem Abschluss; geht der Brief später hinaus, passt
// er womöglich nicht mehr. Dieselbe Regel wie im Plan (server/src/prepaymentSteps.ts): nicht nach dem Versandmonat, oder
// früher als der übernächste Monat nach dem Versand. Gefragt wird beim Versanddatum und vor dem Druck.
export function sentMonthLines(letters: Readonly<Record<string, StatementLetter>>, statements: readonly Pick<Statement, 'tenancyId' | 'tenantName'>[], sentAt: string): string[] {
  const sent = sentAt.slice(0, 7)
  const way = 'Soll der Brief einen späteren Monat nennen: „Wieder öffnen …“, im Anschreiben des Mieters „Ab Monat“ ändern und neu abschließen.'
  return statements.flatMap((st) => {
    const a = letters[st.tenancyId]?.adjustment
    const from = a?.from
    if (!a || a.newCents === null || !from) return []
    if (from <= sent) return [`${st.tenantName}: Das Schreiben nennt ${monthLabel(from)}, der Monat hat am Tag des Versands schon begonnen. Eine Anpassung der Vorauszahlungen ist nur für die Zukunft möglich (BGH, VIII ZR 271/10, Leitsatz 2). ${way}`]
    if (from < addMonths(sent, 2)) return [`${st.tenantName}: Das Schreiben nennt ${monthLabel(from)}; der Versand liegt später als die Vorgabe von Mietfuchs (übernächster Monat nach dem Versand wäre ${monthLabel(addMonths(sent, 2))}). ${way}`]
    return []
  })
}
