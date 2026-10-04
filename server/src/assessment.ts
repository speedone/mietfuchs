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

// Die Kandidaten einer Zeile, für die Ansicht (`suggestLine`) und die Rückfrage des Planers
// dieselben: nach der Doppelungsregel (shared/duplicates.ts) aus der Menge `candidatePool`, dazu
// jede Position, an der **dieser Beleg** schon hängt (`attached`), unabhängig von der Kostenart.
// Das ist der nachgereichte Beleg: von Hand per `invoiceFile` an eine Position gehängt, ohne dass
// eine Zeile gebucht ist (Schlussdurchsicht, M3). Ohne diese Regel legte eine Zeile derselben
// Rechnung still eine zweite Position an, wenn ihre Kostenart von der Position abweicht. Als Ziel
// zum Verknüpfen taugen davon nur die aus derselben Menge und demselben Jahr; die Warnung nennt alle.
//
// Zwei weitere Arten, auf dieselbe Weise behandelt (Integrationsdurchsicht des Stapels):
// - `twin`: Positionen, an denen von Hand ein **anderer Beleg mit gleichem Inhalt** hängt (H2).
//   Gleiche Prüfsumme heißt dieselbe Rechnung, gleich welche Kostenart die KI diesmal liest.
// - `own`: die schon aus **diesem** Beleg gebuchten Positionen, aber nur für eine Zeile, die bei
//   einer erneuten Auswertung dazukam (`reassessed`, H1). `withoutBooked` erkennt eine von Hand
//   berichtigte oder anders aufgeteilte Zeile nicht als gebucht; ohne diese Regel stünde sie grün
//   und vorab angehakt da. Für die Zeilen der ersten Auswertung gilt sie nicht: Frischwasser und
//   Abwasser sind zwei Zeilen einer Rechnung, auch wenn eine davon schon gebucht ist.
// `others` sind die Positionen des Objekts ohne die aus dieser Auswertung gebuchten.
export type ReceiptHolders<T> = { attached: T[]; twin: T[]; own: T[] }
export function lineCandidates<T extends CostItem>(
  others: readonly T[],
  a: Pick<StoredAssessment, 'propertyId' | 'year' | 'vendor' | 'file'>,
  line: { category: string; description: string; amountCents: number | null },
  booked: readonly Pick<BookedLine, 'costItemId' | 'amountCents'>[],
  receipt: { own: readonly T[]; twinFiles: readonly string[] } = { own: [], twinFiles: [] },
): { candidates: T[] } & ReceiptHolders<T> {
  if (a.propertyId === null) return { candidates: [], attached: [], twin: [], own: [] }
  const attached = others.filter((i) => i.invoiceFile === a.file)
  const twin = others.filter((i) => !!i.invoiceFile && i.invoiceFile !== a.file && receipt.twinFiles.includes(i.invoiceFile))
  const own = [...receipt.own]
  const pool = candidatePool(others, line.amountCents, booked)
  const ownPool = candidatePool(own, line.amountCents, booked)
  const same = sameCostCandidates(pool, { propertyId: a.propertyId, year: a.year, category: line.category, description: line.description, vendor: a.vendor ?? '' })
  const extra = [...own.filter((i) => ownPool.includes(i)), ...[...attached, ...twin].filter((i) => pool.includes(i))]
    .filter((i) => i.year === a.year && !same.includes(i))
  return { candidates: [...extra, ...same], attached, twin, own }
}

export const attachedText = (attached: readonly Pick<CostItem, 'description'>[]): string =>
  `Dieser Beleg hängt schon an ${attached.map((i) => `„${i.description}“`).join(', ')}.`

const quoted = (items: readonly Pick<CostItem, 'description'>[]): string => items.map((i) => `„${i.description}“`).join(', ')

// Die Begründungen zu `ReceiptHolders`, für die Ampel der Ansicht. `nameOf` nennt einen Beleg so,
// wie der Nutzer ihn kennt.
export function holderReasons(h: ReceiptHolders<Pick<CostItem, 'description' | 'invoiceFile'>>, nameOf: (file: string) => string): string[] {
  const out: string[] = []
  if (h.own.length > 0) out.push(`Dieser Beleg ist schon gebucht (an ${quoted(h.own)}). Ist die Zeile darin enthalten, verwerfen Sie sie.`)
  if (h.attached.length > 0) out.push(attachedText(h.attached))
  if (h.twin.length > 0) out.push(twinText(h.twin, nameOf))
  return out
}

export function twinText(twin: readonly Pick<CostItem, 'description' | 'invoiceFile'>[], nameOf: (file: string) => string): string {
  const files = [...new Set(twin.flatMap((i) => (i.invoiceFile ? [i.invoiceFile] : [])))]
  return `Ein Beleg mit gleichem Inhalt (${files.map((f) => `„${nameOf(f)}“`).join(', ')}) hängt schon an ${quoted(twin)}.`
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
  // Alle anderen Belege mit gleichem Inhalt, Datei → Name (H2: auch von Hand angehängte)
  twinNames: ReadonlyMap<string, string>
  // Alle gebuchten Zeilen (für `carriesCredit`)
  booked: readonly Pick<BookedLine, 'costItemId' | 'amountCents'>[]
}

// Der Vorschlag zu einer offenen oder verworfenen Zeile: Schlüssel aus dem Vorjahr, Kandidaten
// nach der Doppelungsregel, Ampel und ob die Zeile vorab angehakt ist. Dieselben Regeln wie
// bisher in der Schnellerfassung, jetzt für alle drei Wege.
function suggestLine(line: StoredAssessmentLine, a: StoredAssessment, others: readonly CostItem[], ownItems: readonly CostItem[], ctx: DescribeContext): LineSuggestion {
  const vendor = a.vendor ?? ''
  const defaults = aiPositionDefaults(line.category, ctx.units, ctx.meters, { items: ctx.items, year: a.year, propertyKind: ctx.propertyKind }, line.description)
  const fields: LineFields = {
    description: line.description, category: line.category, amountCents: line.amountCents, labor35aCents: line.labor35aCents,
    key: defaults.key, allocation: defaults.allocation, externalTotalCents: null,
  }
  const pool = candidatePool(others, line.amountCents, ctx.booked)
  const { candidates, ...holders } = lineCandidates(others, a, line, ctx.booked, { own: line.reassessed ? ownItems : [], twinFiles: [...ctx.twinNames.keys()] })
  const amount = line.amountCents ?? 0
  const score = scorePosition({
    category: line.category, description: line.description, amountCents: amount, labor35aCents: line.labor35aCents ?? 0,
    matchedByDesc: line.categoryGuessed, vendor, detectedYear: a.detectedYear, targetYear: a.year, existingItems: pool,
    priorYearDeviationPct: categoryDeviationPct(ctx.items, line.category, a.year, amount),
  })
  // Das Jahr aus dem Beleg weicht vom gewählten ab (Schlussdurchsicht, I1): Gebucht wird im Jahr
  // des Belegs, aber nie ungesehen. Eine Jahresrechnung vom Februar, deren Leistungszeitraum die KI
  // nicht gelesen hat, landete sonst mit „Alle grünen übernehmen“ in der Abrechnung des Folgejahres.
  const otherYear = a.requestedYear !== null && a.requestedYear !== a.year
  const built = costItemBody(lineDraft(fields, { vendor, invoiceFile: a.file }, ctx.units), ctx.units, a.year)
  const problem = 'error' in built ? built.error : null
  let level = score.level
  const reasons = [...score.reasons]
  if (otherYear) {
    if (level === 'gruen') level = 'gelb'
    reasons.push(`Beleg aus ${a.year}, gewählt war ${a.requestedYear} — gebucht wird in ${a.year}; sonst das Jahr der Buchung ändern`)
  }
  const held = holderReasons(holders, (f) => ctx.twinNames.get(f) ?? f)
  if (held.length > 0) {
    level = 'rot'
    reasons.push(...held)
  }
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
    preselected: ctx.twinOf === null && !otherYear && aiRowPreselected({ category: line.category, preselect: aiPositionPreselect(defaults), problem, level, candidates }),
  }
}

export function describeAssessment(record: { assessment: StoredAssessment; lines: readonly StoredAssessmentLine[] }, ctx: DescribeContext): AssessmentView {
  const a = record.assessment
  const own = new Set(ownItemIds(record.lines))
  const others = ctx.items.filter((i) => !own.has(i.id))
  const ownItems = ctx.items.filter((i) => own.has(i.id))
  const lines: AssessmentLine[] = record.lines.map((l) => {
    const state = lineState(l)
    const { assessmentId: _assessmentId, ...rest } = l
    return {
      ...rest,
      state,
      itemDescription: l.costItemId ? ctx.items.find((i) => i.id === l.costItemId)?.description ?? null : null,
      suggestion: state === 'open' || state === 'dismissed' ? suggestLine(l, a, others, ownItems, ctx) : null,
    }
  })
  const sum = record.lines.reduce((s, l) => s + (l.amountCents ?? 0), 0)
  return { ...a, originalName: ctx.originalName, lines, open: lines.some((l) => l.state === 'open'), sumWarning: invoiceSumCheck(sum, a.totalGrossCents) }
}
