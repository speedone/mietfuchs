// Die gespeicherte Auswertung eines Belegs (Belegbuchung, #170) als reine Funktionen: was aus
// einer Antwort der KI an Zeilen wird, in welchem Zustand eine Zeile ist und welche Vorschläge die
// Prüfung zu ihr macht. Ohne Datenbank und Netz, damit der Server und die Tests des Browsers
// (client/src/testing/fakeBooking.ts) dieselben Regeln benutzen.
import type { AssessmentLineState, Extraction, StoredAssessmentLine } from '../../shared/types.ts'
import { matchCategory } from '../../shared/categories.ts'
import { normalizedText } from '../../shared/duplicates.ts'

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
