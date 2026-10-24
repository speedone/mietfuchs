// Die Ordnung der Seite Abrechnung (drei Zonen): was „Zu prüfen“ zeigt, die Tabelle je Mieter der Übersicht und das
// Blättern in der Vorschau eines Mieters. Reine Funktionen ohne DOM; die Seite rendert nur.
import { fmtDate, fmtEuro } from './api'
import type { NotSettled, Notice, Settlement } from './types'
import { isAction, PROTECTED, sentences } from './noticeText'
import { notSettledReason } from './tenancyModel'

export type CheckList = { errors: Notice[]; warnings: Notice[]; hints: Notice[]; quiet: Notice[] }

// Ein stiller Hinweis: keiner seiner Sätze trägt einen Betrag, eine Prozentzahl, ein Datum, eine Kürzung oder eine
// Aufforderung. Erkannt wie in noticeText.ts (`PROTECTED`, `isAction`), keine zweite Regel.
export function isQuietHint(n: Notice): boolean {
  return (n.level === 'hint' || n.level === 'info') && sentences(n.text).every((s) => !PROTECTED.test(s) && !isAction(s))
}

// Fehler, Warnungen und Hinweise mit Betrag, Kürzung oder Aufforderung stehen offen wie im Baustein Notice (eingeklappt
// nur „Mehr dazu“); nur stille Hinweise und Auskünfte werden in einer Zeile zusammengefasst (Durchsicht M1). Die
// Reihenfolge innerhalb einer Stufe bleibt die der Berechnung.
export function checkList(notices: readonly Notice[]): CheckList {
  const hints = notices.filter((n) => n.level === 'hint' || n.level === 'info')
  return {
    errors: notices.filter((n) => n.level === 'error'),
    warnings: notices.filter((n) => n.level === 'warning'),
    hints: hints.filter((n) => !isQuietHint(n)),
    quiet: hints.filter(isQuietHint),
  }
}

const HEADLINE_MAX = 120

// Der Kopf einer Zeile: der Titel, ohne ihn (abgeschlossen vor #112) der erste Satz des Textes, gekürzt.
export function noticeHeadline(n: Notice): string {
  if (n.title) return n.title
  const first = (sentences(n.text)[0] ?? n.text).trim()
  return first.length > HEADLINE_MAX ? `${first.slice(0, HEADLINE_MAX).trimEnd()}…` : first
}

// „3 Hinweise (A, B, C, …)“: die Zahl und die Titel, jeder einmal, höchstens drei.
export function hintSummary(hints: readonly Notice[]): string {
  const titles = [...new Set(hints.map(noticeHeadline))]
  const shown = titles.slice(0, 3).join(', ') + (titles.length > 3 ? ', …' : '')
  return `${hints.length} ${hints.length === 1 ? 'Hinweis' : 'Hinweise'} (${shown})`
}

// Das Ergebnis in Worten, wie die Aufstellung es nennt (negativ heißt Nachzahlung).
export function resultText(balanceCents: number): string {
  if (balanceCents < 0) return `Nachzahlung ${fmtEuro(-balanceCents)}`
  if (balanceCents > 0) return `Guthaben ${fmtEuro(balanceCents)}`
  return 'ausgeglichen'
}

export type TenantRow =
  | { settled: true; tenancyId: string; tenantName: string; unitName: string; period: string; days: number; costsCents: number; prepaymentCents: number; balanceCents: number }
  | { settled: false; tenancyId: string; tenantName: string; unitName: string; reason: string }

// Eine Zeile je Mieter: erst die Abrechnungen in ihrer Reihenfolge, dann die Mietverhältnisse ohne Abrechnung
// (Pauschale, Inklusivmiete, Nutzungswechsel) mit ihrem Grund.
export function tenantRows(data: Pick<Settlement, 'statements'> & { notSettled?: NotSettled[] }): TenantRow[] {
  return [
    ...data.statements.map((s): TenantRow => ({
      settled: true,
      tenancyId: s.tenancyId,
      tenantName: s.tenantName,
      unitName: s.unitName,
      period: `${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)}`,
      days: s.days,
      costsCents: s.totalShareCents,
      prepaymentCents: s.prepaymentCents,
      balanceCents: s.balanceCents,
    })),
    ...(data.notSettled ?? []).map((n): TenantRow => ({ settled: false, tenancyId: n.tenancyId, tenantName: n.tenantName, unitName: n.unitName, reason: notSettledReason(n) })),
  ]
}

// Voriger und nächster Mieter der Vorschau.
export function neighbors(ids: readonly string[], id: string): { prev: string | null; next: string | null; index: number; count: number } {
  const index = ids.indexOf(id)
  if (index < 0) return { prev: null, next: null, index, count: ids.length }
  return { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null, index, count: ids.length }
}
