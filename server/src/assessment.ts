// Die gespeicherte Auswertung eines Belegs (Belegbuchung, #170) als reine Funktionen: was aus
// einer Antwort der KI an Zeilen wird, in welchem Zustand eine Zeile ist und welche Vorschläge die
// Prüfung zu ihr macht. Ohne Datenbank und Netz, damit der Server und die Tests des Browsers
// (client/src/testing/fakeBooking.ts) dieselben Regeln benutzen.
import type {
  AssessmentLine, AssessmentLineState, AssessmentView, CostItem, Extraction, LineFields, LineSuggestion, Meter, PropertyKind,
  StoredAssessment, StoredAssessmentLine, Unit,
} from '../../shared/types.ts'
import { matchCategory } from '../../shared/categories.ts'
import { normalizedText, sameCostCandidates } from '../../shared/duplicates.ts'
import { costItemBody, type CostItemDraft } from '../../shared/costItem.ts'
import { aiPositionDefaults, aiPositionPreselect, aiRowPreselected, categoryDeviationPct, invoiceSumCheck, scorePosition } from '../../shared/assessment.ts'

// Eine Zeile, wie sie aus der KI kommt, noch ohne Nummer und ohne Buchung.
export type NewLine = Pick<StoredAssessmentLine, 'description' | 'category' | 'categoryGuessed' | 'amountCents' | 'labor35aCents'>
// Eine gebuchte Zeile samt dem Beleg, aus dem sie stammt (für die Summenregel über alle Belege).
export type BookedLine = StoredAssessmentLine & { file: string }
// Was eine Buchung an einer Zeile schreibt. Immer vollständig, damit nichts als `undefined` an
// die Datenbank geht (client.ts lehnt das ab).
export type LineChange = Pick<StoredAssessmentLine, 'booking' | 'costItemId' | 'dismissed' | 'description' | 'category' | 'amountCents' | 'labor35aCents'>

export function lineState(l: Pick<StoredAssessmentLine, 'costItemId' | 'booking' | 'dismissed'>): AssessmentLineState {
  if (l.costItemId === null) return l.dismissed ? 'dismissed' : 'open'
  return l.booking === 'linked' ? 'linked' : 'created'
}

export const changeOf = (l: StoredAssessmentLine): LineChange => ({
  booking: l.booking, costItemId: l.costItemId, dismissed: l.dismissed, description: l.description,
  category: l.category, amountCents: l.amountCents, labor35aCents: l.labor35aCents,
})

// Trägt eine Position eine Gutschrift? Ihr Betrag ist negativ, oder eine negative Zeile hängt an
// ihr (auch wenn ihr Betrag inzwischen von Hand geändert wurde). Eine Gutschrift wird nie mit
// einer Rechnung verrechnet, auch nicht über das Ziel: Mit ihr verknüpft, verschwände sie in der
// Summe und stünde nicht mehr sichtbar auf der Abrechnung. Solche Positionen sind deshalb kein
// Verknüpfungsziel und keine mögliche Doppelung einer Rechnungszeile.
export function carriesCredit(item: Pick<CostItem, 'id' | 'amountCents'>, booked: readonly Pick<BookedLine, 'costItemId' | 'amountCents'>[]): boolean {
  return item.amountCents < 0 || booked.some((l) => l.costItemId === item.id && (l.amountCents ?? 0) < 0)
}

// Die Positionen, unter denen eine Zeile ihre Kandidaten (mögliche Doppelungen und Ziele zum
// Verknüpfen) findet. Für eine Rechnungszeile nur Positionen ohne Gutschrift, für eine Gutschrift
// nur solche mit: Eine Gutschrift wird nie verknüpft, ihre Doppelung ist dieselbe Gutschrift. Die
// Ansicht (`suggestLine`) und die Rückfrage des Planers nehmen beide diese Menge.
export function candidatePool<T extends Pick<CostItem, 'id' | 'amountCents'>>(
  items: readonly T[], amountCents: number | null, booked: readonly Pick<BookedLine, 'costItemId' | 'amountCents'>[],
): T[] {
  const credit = amountCents !== null && amountCents < 0
  return items.filter((i) => carriesCredit(i, booked) === credit)
}

// Die Positionen, die aus dieser Auswertung gebucht sind. Sie sind für ihre übrigen Zeilen keine
// Doppelung: Frischwasser und Abwasser sind zwei Zeilen einer Rechnung.
export const ownItemIds = (lines: readonly StoredAssessmentLine[]): string[] =>
  [...new Set(lines.flatMap((l) => (l.costItemId ? [l.costItemId] : [])))]

const toCents = (eur: number | null | undefined): number | null =>
  typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null

// Die Zeilen einer Antwort. Die Kostenart wird den bekannten zugeordnet, notfalls über die
// Beschreibung; dann ist `categoryGuessed` gesetzt und die Ampel gelb. Ein Betrag, den das Modell
// nicht lesen konnte, bleibt `null` und ist etwas anderes als 0.
export function linesFromExtraction(ex: Extraction): NewLine[] {
  return (ex.positions ?? []).map((p) => {
    let category = matchCategory(p.category || '')
    let categoryGuessed = false
    if (category === 'Sonstige Betriebskosten') {
      const byDesc = matchCategory(p.description || '')
      if (byDesc !== 'Sonstige Betriebskosten') {
        category = byDesc
        categoryGuessed = true
      }
    }
    return { description: p.description, category, categoryGuessed, amountCents: toCents(p.amountEur), labor35aCents: toCents(p.labor35aEur) }
  })
}

// Das Jahr aus dem Beleg: bevorzugt der Leistungszeitraum, sonst das Rechnungsdatum.
export function detectedYear(ex: Pick<Extraction, 'periodStart' | 'invoiceDate'>): number | null {
  const src = (ex.periodStart && ex.periodStart.slice(0, 4)) || (ex.invoiceDate && ex.invoiceDate.slice(0, 4)) || ''
  const y = Number(src)
  return Number.isInteger(y) && y > 1990 && y < 2100 ? y : null
}

// Beim erneuten Auswerten: Zeilen, die einer schon gebuchten gleichen (gleicher Betrag und
// gleiche Beschreibung oder Kostenart), kommen nicht noch einmal als offene Zeile dazu. Sonst
// stünde dieselbe Rechnungszeile ein zweites Mal zum Buchen da, und weil Positionen dieser
// Auswertung für ihre eigenen Zeilen keine Doppelung sind, fiele es niemandem auf.
export function withoutBooked(fresh: readonly NewLine[], booked: readonly StoredAssessmentLine[]): NewLine[] {
  const left = [...booked]
  return fresh.filter((l) => {
    const i = left.findIndex((b) => b.amountCents === l.amountCents &&
      (normalizedText(b.description) === normalizedText(l.description) || b.category === l.category))
    if (i < 0) return true
    left.splice(i, 1)
    return false
  })
}

// ---------- Entwurf einer Position aus einer Zeile ----------

// Was aus den Angaben einer Zeile als Kostenposition würde, in der Gestalt der gemeinsamen
// Prüfung (shared/costItem.ts). Der gemerkte Schlüssel gilt nur, solange die Zeile ihn noch
// führt; Wohnungen, die es nicht mehr gibt, fallen heraus, wie bisher im Formular
// (`applyAllocation`). Einzelbeträge hat eine KI-Zeile nie.
export function lineDraft(fields: LineFields, extra: { vendor: string; invoiceFile: string }, units: readonly Unit[]): CostItemDraft {
  const known = new Set(units.map((u) => u.id))
  const a = fields.allocation && fields.allocation.key === fields.key ? fields.allocation : null
  return {
    category: fields.category,
    description: fields.description,
    vendor: extra.vendor,
    invoiceFile: extra.invoiceFile,
    amountCents: fields.amountCents,
    labor35aCents: fields.labor35aCents ?? 0,
    key: fields.key,
    directUnitId: a?.directUnitId && known.has(a.directUnitId) ? a.directUnitId : null,
    meterType: a?.meterType ?? null,
    customShares: Object.fromEntries(Object.entries(a?.customShares ?? {}).filter(([id]) => known.has(id))),
    participants: a?.participantUnitIds ? a.participantUnitIds.filter((id) => known.has(id)) : null,
    external: { measure: a?.externalBasis?.measure ?? 'mea', total: a?.externalBasis?.total ?? null, totalCents: fields.externalTotalCents },
    tenancyAmounts: {},
    selfAmounts: {},
  }
}

// ---------- Vorschläge und Ansicht ----------

export type DescribeContext = {
  // Die Positionen des Objekts der Auswertung, alle Jahre
  items: readonly CostItem[]
  units: readonly Unit[]
  meters: readonly Meter[]
  propertyKind: PropertyKind | null
  originalName: string
  // Name eines anderen Belegs mit gleichem Inhalt, der schon gebucht ist
  twinOf: string | null
  // Alle gebuchten Zeilen (für `carriesCredit`)
  booked: readonly Pick<BookedLine, 'costItemId' | 'amountCents'>[]
}

// Der Vorschlag zu einer offenen oder verworfenen Zeile: Schlüssel aus dem Vorjahr, Kandidaten
// nach der Doppelungsregel, Ampel und ob die Zeile vorab angehakt ist. Dieselben Regeln wie
// bisher in der Schnellerfassung, jetzt für alle drei Wege.
function suggestLine(line: StoredAssessmentLine, a: StoredAssessment, others: readonly CostItem[], ctx: DescribeContext): LineSuggestion {
  const vendor = a.vendor ?? ''
  const defaults = aiPositionDefaults(line.category, ctx.units, ctx.meters, { items: ctx.items, year: a.year, propertyKind: ctx.propertyKind }, line.description)
  const fields: LineFields = {
    description: line.description, category: line.category, amountCents: line.amountCents, labor35aCents: line.labor35aCents,
    key: defaults.key, allocation: defaults.allocation, externalTotalCents: null,
  }
  const pool = candidatePool(others, line.amountCents, ctx.booked)
  const candidates = a.propertyId === null ? [] : sameCostCandidates(pool, { propertyId: a.propertyId, year: a.year, category: line.category, description: line.description, vendor })
  const amount = line.amountCents ?? 0
  const score = scorePosition({
    category: line.category, description: line.description, amountCents: amount, labor35aCents: line.labor35aCents ?? 0,
    matchedByDesc: line.categoryGuessed, vendor, detectedYear: a.detectedYear, targetYear: a.year, existingItems: pool,
    priorYearDeviationPct: categoryDeviationPct(ctx.items, line.category, a.year, amount),
  })
  const built = costItemBody(lineDraft(fields, { vendor, invoiceFile: a.file }, ctx.units), ctx.units, a.year)
  const problem = 'error' in built ? built.error : null
  let level = score.level
  const reasons = [...score.reasons]
  if (problem !== null) {
    level = 'rot'
    reasons.push(`Nicht übernehmbar: ${problem}`)
  } else if (!aiPositionPreselect(defaults) && level === 'gruen') {
    // Gemerkter Schlüssel nur für einzelne Wohnungen (Durchsicht zu #141): nie grün.
    level = 'gelb'
    reasons.push('Schlüssel aus dem Vorjahr nur für einzelne Wohnungen, bitte prüfen')
  }
  if (ctx.twinOf !== null) {
    level = 'rot'
    reasons.push(`gleicher Inhalt wie „${ctx.twinOf}“ — dieser Beleg ist schon gebucht`)
  }
  return {
    fields,
    candidates: candidates.map((c) => ({
      id: c.id, description: c.description, amountCents: c.amountCents, invoiceFile: c.invoiceFile ?? null, key: c.key,
      formOnly: c.key === 'amounts' || c.key === 'external',
    })),
    level,
    reasons,
    preselected: ctx.twinOf === null && aiRowPreselected({ category: line.category, preselect: aiPositionPreselect(defaults), problem, level, candidates }),
  }
}

export function describeAssessment(record: { assessment: StoredAssessment; lines: readonly StoredAssessmentLine[] }, ctx: DescribeContext): AssessmentView {
  const a = record.assessment
  const own = new Set(ownItemIds(record.lines))
  const others = ctx.items.filter((i) => !own.has(i.id))
  const lines: AssessmentLine[] = record.lines.map((l) => {
    const state = lineState(l)
    const { assessmentId: _assessmentId, ...rest } = l
    return {
      ...rest,
      state,
      itemDescription: l.costItemId ? ctx.items.find((i) => i.id === l.costItemId)?.description ?? null : null,
      suggestion: state === 'open' || state === 'dismissed' ? suggestLine(l, a, others, ctx) : null,
    }
  })
  const sum = record.lines.reduce((s, l) => s + (l.amountCents ?? 0), 0)
  return { ...a, originalName: ctx.originalName, lines, open: lines.some((l) => l.state === 'open'), sumWarning: invoiceSumCheck(sum, a.totalGrossCents) }
}
