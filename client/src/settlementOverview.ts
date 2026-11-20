// Die Ordnung der Seite Abrechnung (drei Zonen): was „Zu prüfen“ zeigt, die Tabelle je Mieter der Übersicht und das
// Blättern in der Vorschau eines Mieters. Reine Funktionen ohne DOM; die Seite rendert nur.
import { fmtDate, fmtEuro } from './api'
import type { NotSettled, Notice, Settlement, Statement, StatementLetter } from './types'
import { chooseLetterBlocks } from '../../shared/letter.ts'
import { monthName } from '../../shared/monthlyInfo.ts'
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

// Was der Brief eines Mieters an neuer Vorauszahlung ankündigt (§ 560 Abs. 4 BGB), als Zeile der Übersicht vor dem
// Abschluss (Systemprüfung: Die Vorgabe kündigt den Vorschlag an, und die Seite sagte es erst im Brief selbst). Nur, wenn
// der Baustein gedruckt wird (`chooseLetterBlocks`). Ohne „bisher“: Der Brief nennt es in der Vorgabe nicht, und die Rate
// am Ende des Zeitraums kann vom laufenden Betrag abweichen.
export function announcedAdjustment(letter: Pick<StatementLetter, 'adjustment' | 'texts'> | null | undefined, balanceCents: number): string | null {
  const cents = letter?.adjustment.newCents ?? null
  if (!letter || cents === null || !chooseLetterBlocks(letter, balanceCents, 0).some((b) => b === 'adjustSuggestion' || b === 'adjustCustom')) return null
  const from = letter.adjustment.from
  return `Brief kündigt an: Vorauszahlung ${fmtEuro(cents)}${from ? ` ab ${monthName(from)}` : ''}`
}
// Durchsicht (S1): Der gewählte Betrag (Vorschlag oder eigener, `chosenCents`) gilt schon (`currentPrepaymentAt`), der Brief
// lässt den Satz deshalb weg. Die Übersicht sagt es, statt gar nichts zu zeigen.
export function alreadyAppliesNote(letter: Pick<StatementLetter, 'adjustment'> | null | undefined, chosenCents: number | null, currentCents: number | null): string | null {
  if (!letter || letter.adjustment.mode === 'none' || letter.adjustment.newCents !== null) return null
  if (chosenCents === null || currentCents === null || chosenCents !== currentCents) return null
  return `Brief kündigt keine Anpassung an: ${fmtEuro(currentCents)} gelten schon`
}
// Der Weg, es zu ändern, einmal unter der Tabelle.
export const ADJUSTMENT_NOTE =
  'Die neue Vorauszahlung kündigt der Brief nach § 560 Abs. 4 BGB an. Sie ändern Betrag und Monat je Mieter über „Ansehen“ und dort „Anschreiben bearbeiten“ oder kündigen dort nichts an; ' +
  'die Vorgabe für alle Mieter steht in den Einstellungen unter „Anschreiben zur Abrechnung“.'

// Systemprüfung: Ohne erfasste Zahlungen im Mietkonto steht das Soll als „geleistet“ in der Abrechnung, und der Hinweis
// `prepayment.arrears` kommt erst mit einem geführten Mietkonto. Ein ruhiger Satz der Seite, solange sie offen ist und
// mindestens eine Vorauszahlung nicht von Hand angepasst wurde; kein Hinweis der Berechnung.
export function prepaymentBasisNote(data: { statements: readonly Pick<Statement, 'prepaymentCents' | 'prepaymentOverridden'>[], closed?: Settlement['closed'] | null }): string | null {
  if (data.closed || !data.statements.some((st) => !st.prepaymentOverridden && st.prepaymentCents > 0)) return null
  return 'Als Vorauszahlungen ist angesetzt, was laut Vertrag zu zahlen war. Hat ein Mieter weniger gezahlt, tragen Sie den gezahlten Betrag in seiner Abrechnung ein: über „Ansehen“ und dort „✎ anpassen“.'
}

// Voriger und nächster Mieter der Vorschau.
export function neighbors(ids: readonly string[], id: string): { prev: string | null; next: string | null; index: number; count: number } {
  const index = ids.indexOf(id)
  if (index < 0) return { prev: null, next: null, index, count: ids.length }
  return { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null, index, count: ids.length }
}
