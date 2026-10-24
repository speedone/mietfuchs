// „In die Staffel übernehmen“ (#317), ohne DOM prüfbar: was die Karte je Mieter zeigt und was vor dem Übernehmen zu
// fragen ist. Den Plan rechnet der Server (server/src/prepaymentSteps.ts); hier werden nur Sätze daraus.
import type { PrepaymentStepItem, PrepaymentStepPlan, Statement, StatementLetter } from './types'
import { fmtEuro } from './api'
import { monthLabel } from './monthText'

export const scheduleLabel = (it: Pick<PrepaymentStepItem, 'schedule'>): string =>
  it.schedule === 'heatingPrepayments' ? 'Heizvorauszahlung' : 'Vorauszahlung'

// Der Stand je Mieter in einem Satz.
export function stepStatus(it: PrepaymentStepItem): string {
  if (it.state === 'blocked') return it.blocked ?? 'Lässt sich nicht übernehmen.'
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
  const names = items.map((it) => `${it.tenantName} (${fmtEuro(it.cents)} ab ${monthLabel(it.from)})`).join(', ')
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
    if (it.existing.length > 0) {
      const steps = it.existing.map((e) => `${fmtEuro(e.monthlyCents)} ab ${monthLabel(e.from)}`).join(', ')
      const same = it.existing.some((e) => e.from === it.from)
      lines.push(`${it.tenantName}: Ab ${monthLabel(it.from)} steht in der Staffel schon ${steps}.${same ? ` Die Stufe ab ${monthLabel(it.from)} wird ersetzt` : ' Die neue Stufe kommt davor'}${it.existing.some((e) => e.from > it.from) ? ', spätere bleiben' : ''}. Stammt sie schon aus dieser Abrechnung, wäre eine zweite Anpassung nicht wirksam: Nach AG Köln, Urteil vom 11.12.2023, 203 C 73/23, Rn. 27, kann die Vorauszahlung aufgrund derselben Abrechnung nur einmal angepasst werden.`)
    }
    // S2 der Durchsicht: auch eine Stufe zwischen dem Ende des abgerechneten Zeitraums und dem Monat.
    if (it.earlier.length > 0) {
      const steps = it.earlier.map((e) => `${fmtEuro(e.monthlyCents)} ab ${monthLabel(e.from)}`).join(', ')
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
