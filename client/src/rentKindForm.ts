// Art der Miete und Art je Stufe der Kaltmiete am Mietverhältnis (#191, Entwurf
// docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, Oberfläche 1): Beschriftungen, Auswahllisten, Prüfung und
// Rumpf. Gerechnet wird damit erst ab PR 2 (server/src/rentIncrease.ts); Mietkonto, Abrechnung und Steuer lesen nichts
// davon. Dieselben Regeln prüft der Server (`rentScheduleProblem` in server/src/db/repository.ts).
import type { RentChangeReason, RentEntry, RentIndexValue, RentKind, Tenancy } from './types'
import type { Problem } from './formProblems'
import { monthLabel, parseMonthText } from './monthText'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { bgbStaggeredRent } from '../../shared/law/bgb-betrkv.ts'
import { practiceVpiSeries } from '../../shared/law/practice.ts'

// '' heißt nicht angegeben und wird als null gespeichert.
export type RentKindChoice = '' | RentKind
export const RENT_KIND_LABELS: Record<RentKind, string> = {
  free: 'Nach Vertrag',
  staggered: 'Staffelmiete',
  index: 'Indexmiete',
}
// Immer alle Einträge, damit der gespeicherte Wert sichtbar bleibt.
export function rentKindOptions(): { value: RentKindChoice; label: string }[] {
  return [{ value: '', label: 'Nicht angegeben' }, ...(['free', 'staggered', 'index'] as const).map((value) => ({ value, label: RENT_KIND_LABELS[value] }))]
}
export const RENT_KIND_HINT = '„Nach Vertrag“ heißt: keine Staffel- und keine Indexmiete vereinbart, erhöht wird bis zur Vergleichsmiete. Mietkonto, Abrechnung und Steuer rechnen mit der Angabe nicht.'

// „Schließt der Vertrag Mieterhöhungen aus?“ (§ 557 Abs. 3 BGB): '' nicht angegeben (null), sonst nein oder ja.
export type ExclusionChoice = '' | 'no' | 'yes'
export function exclusionOptions(): { value: ExclusionChoice; label: string }[] {
  return [{ value: '', label: 'Nicht angegeben' }, { value: 'no', label: 'Nein' }, { value: 'yes', label: 'Ja' }]
}
export const exclusionOf = (v: boolean | null | undefined): ExclusionChoice => (v === true ? 'yes' : v === false ? 'no' : '')
export const exclusionValue = (c: ExclusionChoice): boolean | null => (c === 'yes' ? true : c === 'no' ? false : null)
export const EXCLUSION_HINT = 'Etwa ein Zeitmietvertrag mit fester Miete oder eine ausdrückliche Vereinbarung (§ 557 Abs. 3 BGB).'

// Art einer Stufe; '' heißt nicht angegeben und zählt wie „Vertragsbeginn oder Vereinbarung“ (die sichere Seite).
export type RentReasonChoice = '' | RentChangeReason
export const RENT_REASON_LABELS: Record<RentChangeReason, string> = {
  agreement: 'Vertragsbeginn oder Vereinbarung',
  staggered: 'Stufe der Staffelmiete',
  index: 'Anpassung der Indexmiete',
  comparison: 'Zustimmung zur Vergleichsmiete',
  modernization: 'Modernisierung (§§ 559 ff. BGB)',
}
// Die Einträge der Auswahl „Art“ an einer Stufe: Staffel- und Indexstufe nur bei der passenden Art der Miete, der
// gespeicherte Wert aber immer, sonst zeigte das Feld etwas anderes, als gespeichert ist.
export function rentReasonOptions(kind: RentKindChoice, current: RentReasonChoice): { value: RentReasonChoice; label: string }[] {
  const reasons = (['agreement', 'staggered', 'index', 'comparison', 'modernization'] as const).filter((r) =>
    r === current || (r === 'staggered' ? kind === 'staggered' : r === 'index' ? kind === 'index' : true))
  return [
    ...(current === '' ? [{ value: '' as const, label: 'Nicht angegeben (wie Vereinbarung)' }] : []),
    ...reasons.map((value) => ({ value, label: RENT_REASON_LABELS[value] })),
  ]
}
// Die Vorgabe für eine neue Stufe: die erste ist der Vertragsbeginn, jede weitere passt zur Art der Miete.
export function defaultRentReason(kind: RentKindChoice, first: boolean): RentChangeReason {
  if (first) return 'agreement'
  return kind === 'staggered' ? 'staggered' : kind === 'index' ? 'index' : 'agreement'
}

// Die Angaben einer Zeile der Kaltmiete-Staffel neben Monat und Betrag.
export type RentRowExtra = { reason: RentReasonChoice; indexMonth: string; indexValue: string; indexBase: string }
export type RentRow = { from: string; amount: string } & RentRowExtra
export const EMPTY_RENT_EXTRA: RentRowExtra = { reason: '', indexMonth: '', indexValue: '', indexBase: '' }

const VPI = valueAt(practiceVpiSeries, LAW_AS_OF)
// Der Platzhalter des Basisjahrs: die aktuelle Reihe aus dem Register. Bleibt das Feld leer, gilt sie.
export const CURRENT_INDEX_BASE = String(VPI.base)

const monthText = (key: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  return m ? `${m[2]}.${m[1]}` : key
}
export const indexValueText = (value: number): string => value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function rentRowExtraOf(e: Pick<RentEntry, 'reason' | 'index'>): RentRowExtra {
  return {
    reason: e.reason ?? '',
    indexMonth: e.index ? monthText(e.index.month) : '',
    indexValue: e.index ? indexValueText(e.index.value) : '',
    indexBase: e.index ? String(e.index.base) : '',
  }
}

export type RentRowField = `baseRent.${number}.${'reason' | 'indexMonth' | 'indexValue' | 'indexBase'}`
const field = (i: number, part: 'reason' | 'indexMonth' | 'indexValue' | 'indexBase'): RentRowField => `baseRent.${i}.${part}`
const isBlank = (row: { from: string; amount: string }): boolean => !row.from.trim() && !row.amount.trim()
// Ein Indexwert mit höchstens einer Nachkommastelle, Komma oder Punkt; in Zehnteln.
function indexTenthsOf(text: string): number | null {
  const m = /^\s*(\d{1,5})(?:[.,](\d))?\s*$/.exec(text)
  if (!m) return null
  const tenths = Number(m[1]) * 10 + Number(m[2] ?? '0')
  return tenths > 0 ? tenths : null
}

// Art und Indexwert je Stufe zu einer Staffel, die `buildSchedule` (tenancyModel.ts) schon ohne Befund gelesen hat: Jede
// Zeile mit Inhalt ist darin genau eine Stufe, die erste ohne Monat ab Einzug. Gemeldet wird jede Angabe auf einmal.
export function withRentDetails(
  rows: readonly RentRow[],
  start: string,
  schedule: readonly { from: string; monthlyCents: number }[],
  kind: RentKindChoice,
): { entries: RentEntry[] } | { problems: Problem<RentRowField>[] } {
  const entries: RentEntry[] = []
  const problems: Problem<RentRowField>[] = []
  let first = true
  for (const [i, row] of rows.entries()) {
    if (isBlank(row)) continue
    const parsed = parseMonthText(row.from)
    const from = parsed.kind === 'month' ? parsed.key : first ? start.slice(0, 7) : null
    first = false
    const money = schedule.find((e) => e.from === from)
    if (!money) continue
    const where = `Kaltmiete, Zeile ${i + 1}`
    const entry: RentEntry = { from: money.from, monthlyCents: money.monthlyCents }
    if (row.reason !== '') entry.reason = row.reason
    const index = rowIndex(row, i, where, problems)
    if (index !== undefined) entry.index = index
    if (entry.index !== undefined && kind !== 'index') {
      problems.push({ field: field(i, 'indexValue'), short: 'Nur bei Indexmiete', text: `${where}: Einen Indexwert gibt es nur bei einer Indexmiete. Wählen Sie bei „Art der Miete“ „Indexmiete“ oder leeren Sie Indexmonat und Indexwert.` })
    }
    if (entry.reason === 'index' && kind !== 'index') {
      problems.push({ field: field(i, 'reason'), short: 'Nur bei Indexmiete', text: `${where}: „${RENT_REASON_LABELS.index}“ gibt es nur bei einer Indexmiete. Wählen Sie bei „Art der Miete“ „Indexmiete“ oder eine andere Art der Stufe.` })
    }
    if (entry.reason === 'staggered' && kind !== 'staggered') {
      problems.push({ field: field(i, 'reason'), short: 'Nur bei Staffelmiete', text: `${where}: „${RENT_REASON_LABELS.staggered}“ gibt es nur bei einer Staffelmiete. Wählen Sie bei „Art der Miete“ „Staffelmiete“ oder eine andere Art der Stufe.` })
    }
    entries.push(entry)
  }
  return problems.length > 0 ? { problems } : { entries }
}

function rowIndex(row: RentRow, i: number, where: string, problems: Problem<RentRowField>[]): RentIndexValue | undefined {
  if (!row.indexMonth.trim() && !row.indexValue.trim() && !row.indexBase.trim()) return undefined
  const month = parseMonthText(row.indexMonth)
  const tenths = indexTenthsOf(row.indexValue)
  const baseText = row.indexBase.trim() || CURRENT_INDEX_BASE
  const base = /^\d{4}$/.test(baseText) && Number(baseText) >= 1950 && Number(baseText) <= 2100 ? Number(baseText) : null
  let ok = true
  if (month.kind !== 'month') {
    ok = false
    problems.push({ field: field(i, 'indexMonth'), short: month.kind === 'invalid' ? month.short : 'Monat fehlt', text: `${where}: Geben Sie den Monat des Indexwerts ein, etwa „10.2025“.` })
  }
  if (tenths === null) {
    ok = false
    problems.push({ field: field(i, 'indexValue'), short: 'Kein Indexwert', text: `${where}: Der Indexwert ist eine Zahl größer als 0 mit höchstens einer Nachkommastelle, etwa „121,7“.` })
  }
  if (base === null) {
    ok = false
    problems.push({ field: field(i, 'indexBase'), short: 'Kein Basisjahr', text: `${where}: Das Basisjahr ist vierstellig, etwa „${CURRENT_INDEX_BASE}“ für „${CURRENT_INDEX_BASE} = 100“.` })
  }
  if (!ok || month.kind !== 'month' || tenths === null || base === null) return undefined
  return { month: month.key, value: tenths / 10, base }
}

// Der Hinweis unter der Staffel einer Staffelmiete: Stufen mit weniger als dem Mindestabstand (§ 557a Abs. 2 Satz 1 BGB,
// Registerwert). Nur ein Hinweis; die Staffel bleibt, wie vereinbart (Recherche O5). Eine Stufe der Art Modernisierung
// zählt nicht, sie ist keine Stufe der Staffel.
export function staggeredGapNote(entries: readonly Pick<RentEntry, 'from' | 'reason'>[], kind: RentKindChoice): string | null {
  if (kind !== 'staggered') return null
  const min = valueAt(bgbStaggeredRent, LAW_AS_OF).minMonths
  const steps = [...entries].filter((e) => e.reason !== 'modernization').sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const short: string[] = []
  for (let k = 1; k < steps.length; k += 1) {
    const a = steps[k - 1]
    const b = steps[k]
    if (!a || !b) continue
    const gap = monthsBetween(a.from, b.from)
    if (gap < min) short.push(`zwischen ${monthLabel(a.from)} und ${monthLabel(b.from)} nur ${gap} ${gap === 1 ? 'Monat' : 'Monate'}`)
  }
  if (short.length === 0) return null
  return `Bei einer Staffelmiete muss jede Stufe mindestens ${min} Monate gelten (§ 557a Abs. 2 BGB); hier liegen ${short.join(', ')}. Mietfuchs speichert die Staffel wie vereinbart. Prüfen Sie den Vertrag.`
}
const monthsBetween = (a: string, b: string): number => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

// Der Rumpf der beiden Angaben am Mietverhältnis.
export function rentKindBody(form: { rentKind: RentKindChoice; rentIncreaseExcluded: ExclusionChoice }): Pick<Tenancy, 'rentKind' | 'rentIncreaseExcluded'> {
  return { rentKind: form.rentKind === '' ? null : form.rentKind, rentIncreaseExcluded: exclusionValue(form.rentIncreaseExcluded) }
}
