// „In die Staffel übernehmen“ (#317), ohne DOM prüfbar: was die Karte je Mieter zeigt und was vor dem Übernehmen zu
// fragen ist. Den Plan rechnet der Server (server/src/prepaymentSteps.ts); hier werden nur Sätze daraus.
import type { PrepaymentStepItem, PrepaymentStepPlan } from './types'
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
    for (const note of it.notes) lines.push(`${it.tenantName}: ${note}`)
  }
  return lines.length > 0 ? lines : null
}
