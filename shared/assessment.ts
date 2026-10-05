// Die Ampel einer ausgewerteten Rechnungsposition und der Vorschlag, mit dem sie in die Prüfung
// geht (Belegbuchung, #170). Bis hierher stand beides im Browser (client/src/triage.ts und
// client/src/costForm.ts); seit der Server die Auswertung speichert und ihre Vorschläge
// mitliefert, braucht er dieselbe Antwort. Reine Logik ohne Netz und DOM.
import type { BillingPeriod, CostItem, ExternalMeasure, Meter, PeriodKey, PeriodRules, PropertyKind, StoredAssessment, TrafficLight, Unit } from './types.ts'
import { calendarContext, calendarPeriod, calendarYearPeriod, isCalendarRules, periodOfKey, periodsBetween, spansTwoYears, type PeriodContext } from './period.ts'
import { allocationOf, previousAllocation, type Allocation } from './allocation.ts'
import { defaultKeyFor, isNotAllocable } from './categories.ts'
import { sameCostCandidates } from './duplicates.ts'
import { euro } from './costItem.ts'

const RANK: Record<TrafficLight, number> = { gruen: 0, gelb: 1, rot: 2 }

// Kleiner Sammler: hebt das Niveau nur an, nie ab, und merkt sich die Begründungen. Auch die
// Ampel der Zählerstände (client/src/triage.ts) benutzt ihn.
export function createScorer() {
  let level: TrafficLight = 'gruen'
  const reasons: string[] = []
  return {
    bump(l: TrafficLight, reason: string) {
      reasons.push(reason)
      if (RANK[l] > RANK[level]) level = l
    },
    result() {
      return { level, reasons }
    },
  }
}

export type PositionCtx = {
  category: string // bereits über matchCategory zugeordnete Kategorie
  amountCents: number // Betrag (0 = ungültig/fehlt, negativ = Gutschrift)
  labor35aCents: number
  matchedByDesc: boolean // Kategorie kam nur über den Beschreibungs-Fallback
  vendor: string
  detectedYear: number | null
  targetYear: number
  existingItems: readonly CostItem[]
  priorYearDeviationPct?: number | null // Abweichung der Kategorie-Summe ggü. Vorjahr in %
  description?: string // für die Frage, ob dieselbe Rechnung schon erfasst ist
  // Der Zeitraum, in den gebucht wird (#208). Fehlt er, der Kalenderzeitraum des Jahres.
  targetPeriod?: PeriodKey
}

export const candidateText = (i: CostItem): string => `„${i.description}“ (${euro(i.amountCents)}${i.invoiceFile ? '' : ', ohne Beleg'})`

export function scorePosition(ctx: PositionCtx): { level: TrafficLight; reasons: string[] } {
  const s = createScorer()

  if (ctx.amountCents === 0) s.bump('rot', 'Betrag fehlt oder ist 0')
  // Eine Gutschrift (#139) wird übernommen, aber nie ungesehen: Sie senkt die Kosten des Jahres.
  if (ctx.amountCents < 0) s.bump('gelb', 'Gutschrift — senkt die Kosten des Jahres')
  if (isNotAllocable(ctx.category)) s.bump('rot', 'nicht umlagefähig — trägt der Vermieter')
  if (ctx.category === 'Sonstige Betriebskosten') s.bump('rot', 'Kategorie unklar — bitte zuordnen')
  if (ctx.detectedYear == null) s.bump('rot', 'Rechnungsjahr nicht erkannt')

  const vendor = ctx.vendor.trim().toLowerCase()
  const year = ctx.detectedYear ?? ctx.targetYear
  const period = ctx.targetPeriod ?? calendarPeriod(year)
  if (vendor && ctx.amountCents !== 0) {
    const dupe = ctx.existingItems.some(
      (it) => it.period === period && it.amountCents === ctx.amountCents && (it.vendor ?? '').trim().toLowerCase() === vendor,
    )
    if (dupe) s.bump('rot', 'mögliche Dublette — gleicher Betrag, Steller und Jahr existiert bereits')
  }

  // Schon eine Position, die dieselbe Rechnung sein könnte, etwa aus dem Vorjahr übernommen
  // (shared/duplicates.ts)? Nie grün: verknüpfen oder bewusst als neue Position anlegen.
  const candidates = sameCostCandidates(ctx.existingItems, { category: ctx.category, description: ctx.description ?? '', vendor: ctx.vendor, period, amountCents: ctx.amountCents })
  // Eine Gutschrift wird nie verknüpft (Belegbuchung, #170), der Rat lautet für sie anders. Gefragt
  // wird mit dem Betrag: Eine Gutschrift ist nie dieselbe wie eine Rechnung (rc.1).
  if (candidates.length > 0) {
    s.bump('gelb', ctx.amountCents < 0
      ? `schon erfasst: ${candidates.map(candidateText).join(', ')} — ist es dieselbe Gutschrift, nicht noch einmal anlegen`
      : `schon erfasst: ${candidates.map(candidateText).join(', ')} — verknüpfen oder bewusst als neue Position anlegen`)
  }

  if (ctx.matchedByDesc) s.bump('gelb', 'Kategorie nur über die Beschreibung erraten')
  if (ctx.amountCents > 0 && ctx.labor35aCents > ctx.amountCents) s.bump('gelb', '§35a-Lohnanteil größer als der Betrag')
  if (ctx.detectedYear != null && ctx.detectedYear !== ctx.targetYear) {
    s.bump('gelb', `Rechnungsjahr ${ctx.detectedYear} ≠ Zieljahr ${ctx.targetYear}`)
  }
  if (ctx.priorYearDeviationPct != null && Math.abs(ctx.priorYearDeviationPct) > 25) {
    const sign = ctx.priorYearDeviationPct > 0 ? '+' : ''
    s.bump('gelb', `${sign}${Math.round(ctx.priorYearDeviationPct)} % gegenüber Vorjahr`)
  }

  return s.result()
}

// Vorab angehakt ist eine KI-Zeile nur, wenn nichts dagegen spricht: umlagefähig, mit Schlüssel für
// alle (aiPositionPreselect), übernehmbar, nicht rot und ohne eine Position, die dieselbe Rechnung
// sein könnte.
export function aiRowPreselected(r: { category: string; preselect: boolean; problem: string | null; level: TrafficLight; candidates: readonly unknown[] }): boolean {
  return !isNotAllocable(r.category) && r.preselect && r.problem === null && r.level !== 'rot' && r.candidates.length === 0
}

// Weicht die Summe der Kostenart im Zeitraum, mit diesem Betrag, um wie viel Prozent vom Vorzeitraum
// ab? `null` ohne Vorzeitraum. `replacedCents` ist der Betrag, den die Zeile beim Verknüpfen
// ersetzt (eine übernommene Schätzung, server/src/assessment.ts `replacedByLinking`): Er fällt aus
// der Summe, sonst stünde die Rechnung neben der Schätzung, die sie ablöst, und der Vergleich
// meldete rund das Doppelte des Vorjahres.
export function categoryDeviationPct(items: readonly CostItem[], category: string, at: PeriodContext, amountCents: number, replacedCents = 0): number | null {
  const sum = (key: PeriodKey) => items.filter((i) => i.period === key && i.category === category).reduce((a, i) => a + i.amountCents, 0)
  const prior = sum(at.previous)
  return prior > 0 ? ((sum(at.key) - replacedCents + amountCents - prior) / prior) * 100 : null
}

// Weicht die Summe der erkannten Positionen von der Rechnungs-Gesamtsumme ab, ist meist eine
// Position übersehen oder doppelt. Toleranz: 2 % bzw. 50 ct (Rundung).
export function invoiceSumCheck(positionsSumCents: number, totalGrossCents: number | null): string | null {
  if (totalGrossCents == null || totalGrossCents <= 0) return null
  const diff = Math.abs(positionsSumCents - totalGrossCents)
  if (diff > Math.max(50, totalGrossCents * 0.02)) {
    const eur = (diff / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })
    return `Positionssumme weicht von der Rechnungssumme ab (Δ ${eur} €)`
  }
  return null
}

// ---------- Der gemerkte Schlüssel einer KI-Zeile (#141) ----------

// Woraus der Vorschlag für eine neue Position entsteht: die Positionen des Objekts (alle Jahre),
// das Abrechnungsjahr und die Art des Objekts. `at` ist der Zeitraum, in dem gebucht wird, mit
// seinem Vorzeitraum (#208); fehlt er, ist es das Kalenderjahr `year` (Tests, Kalenderobjekt).
export type KeyContext = { items: readonly CostItem[]; year: number; at?: PeriodContext; propertyKind?: PropertyKind | null }

// Maßstab und Summe der Anteile der zuletzt erfassten Position „laut Gemeinschaftsabrechnung“ im
// Objekt, jüngstes Jahr zuerst, sonst die zuletzt angelegte.
export function lastExternalBasis(items: readonly CostItem[]): { measure: ExternalMeasure, total: number } | null {
  let found: CostItem | null = null
  // Zeitraumschlüssel 'JJJJ-MM' ordnen sich als Text wie die Zeit (#208).
  for (const i of items) if (i.key === 'external' && i.externalBasis && (!found || i.period >= found.period)) found = i
  return found?.externalBasis ? { measure: found.externalBasis.measure, total: found.externalBasis.total } : null
}

// Bei einer Eigentumswohnung verteilt die Gemeinschaft (#102); die Grundsteuer setzt dagegen die
// Gemeinde dem Eigentümer unmittelbar fest, sie steht nicht in der Hausgeldabrechnung.
export const etwByStatement = (category: string, ctx?: KeyContext): boolean =>
  ctx?.propertyKind === 'etw' && !isNotAllocable(category) && category !== 'Grundsteuer'

export type AiPositionKey = { key: CostItem['key']; allocation: Allocation | null }

// Ein gemerkter Schlüssel, dem inzwischen etwas fehlt (alle Teilnehmer gelöscht, die Wohnung der
// Direktzuordnung weg), gilt in der KI-Zeile nicht: Sie hat kein Feld, das ihn ergänzen ließe.
function stillComplete(a: Allocation, units: readonly Unit[]): boolean {
  const known = new Set(units.map((u) => u.id))
  if (a.participantUnitIds && !a.participantUnitIds.some((id) => known.has(id))) return false
  if (a.key === 'direct' && !(a.directUnitId && known.has(a.directUnitId))) return false
  return true
}

// KI-Übernahme (#141): der Schlüssel einer ausgewerteten Position. Einen gemerkten Schlüssel mit
// Einzelbeträgen übernimmt die Zeile nicht, denn die Beträge je Mieter sind Zahlen des Jahres.
// `meters` bleibt in der Unterschrift, damit die Aufrufer unverändert bleiben.
export function aiPositionDefaults(category: string, units: readonly Unit[], meters: readonly Meter[], ctx?: KeyContext, description?: string): AiPositionKey {
  void meters
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.at ?? calendarContext(ctx.year), description) : null
  if (remembered && remembered.key !== 'amounts' && stillComplete(remembered, units)) return { key: remembered.key, allocation: remembered }
  // Bei einer Eigentumswohnung nur, wenn die Summe der Anteile schon einmal erfasst ist: Ein Feld
  // dafür hat die Zeile nicht, sie bliebe sonst unübernehmbar.
  const last = ctx && etwByStatement(category, ctx) ? lastExternalBasis(ctx.items) : null
  if (last) return { key: 'external', allocation: allocationOf({ category, description: '', key: 'external', externalBasis: { ...last, totalCents: 0 } }) }
  return { key: defaultKeyFor(category), allocation: null }
}

// Eine KI-Zeile, deren gemerkter Schlüssel nur bestimmte Wohnungen trifft (Teilnehmer oder
// Direktzuordnung), ist nie vorab angehakt.
export function aiPositionPreselect(d: AiPositionKey): boolean {
  return !(d.allocation && (d.allocation.participantUnitIds || d.allocation.key === 'direct'))
}

// ---------- Der Zielzeitraum einer Belegbuchung (#208) ----------

const MS_DAY = 86400000
const overlap = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1
}

// Der Abrechnungszeitraum, in den ein Beleg eines Kalenderjahres gehört, wenn niemand etwas anderes
// gewählt hat: der mit der größten Überschneidung, bei Gleichstand der frühere (Teilentwurf 10). Beim
// Kalenderobjekt ist es das Kalenderjahr selbst.
export function periodForYear(rules: PeriodRules, year: number): BillingPeriod {
  const jahr = calendarYearPeriod(year)
  if (isCalendarRules(rules)) return jahr
  let best: BillingPeriod | null = null
  for (const p of periodsBetween(rules, jahr.from, jahr.to)) if (best === null || overlap(p, jahr) > overlap(best, jahr)) best = p
  return best ?? jahr
}

// Wohin eine Auswertung bucht: in den gewählten Zeitraum, wenn er das Jahr des Belegs berührt; sonst
// in den des Jahres (`periodForYear`). Beim Kalenderobjekt ergibt das wie bisher das Jahr des Belegs.
export function bookingPeriod(rules: PeriodRules, a: Pick<StoredAssessment, 'year' | 'requestedPeriod'>): BillingPeriod {
  const requested = a.requestedPeriod === null ? null : periodOfKey(rules, a.requestedPeriod)
  if (requested !== null && overlap(requested, calendarYearPeriod(a.year)) > 0) return requested
  return periodForYear(rules, a.year)
}

// Das Jahr der Zahlung einer gebuchten Position (Entwurf 3.10): nur bei einem Zeitraum über zwei
// Kalenderjahre, aus dem Rechnungsdatum, wenn es in der erlaubten Spanne liegt (Beginn bis ein Jahr
// nach dem Ende, wie in server/src/db/repository.ts), sonst das Jahr des Belegs, sonst der Beginn.
export function bookingTaxYear(period: BillingPeriod, a: Pick<StoredAssessment, 'year' | 'invoiceDate'>): number | null {
  if (!spansTwoYears(period)) return null
  const start = Number(period.from.slice(0, 4))
  const end = Number(period.to.slice(0, 4)) + 1
  const fits = (y: number): boolean => y >= start && y <= end
  const fromInvoice = a.invoiceDate !== null ? Number(a.invoiceDate.slice(0, 4)) : null
  if (fromInvoice !== null && fits(fromInvoice)) return fromInvoice
  return fits(a.year) ? a.year : start
}
