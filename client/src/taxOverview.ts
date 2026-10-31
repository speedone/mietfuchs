// Gesamtsicht über alle Objekte (#96 PR 3, Entwurf 2026-10-30-steuer-objekt-ruecklage-design.md, Teil C): was die Seite
// zeigt, aus `TaxOverview` vom Server (server/src/taxOverview.ts). Hier wird nichts gerechnet, nur gewählt: die Spalte
// nach der Grundlage (Ist: Zeile 32 und `surplusCents`; Soll nur zum Abgleich) und die Art jeder Zeile. Die Seite rendert.
import type { PropertyKind, TaxOverview, TaxOverviewSums } from './types'
import type { Basis } from './taxView'
import { anlageVLines } from './anlageV'

// Erst ab zwei Objekten (Zusage aus #91): Wer ein Haus vermietet, sieht davon nichts.
export const showsOverview = (propertyCount: number): boolean => propertyCount >= 2

type Head = { propertyId: string; name: string; kind: PropertyKind; current: boolean }
export type OverviewAmounts = { incomeCents: number; deductibleCents: number; privateCents: number; surplusCents: number }
export type OverviewLine = Head & (
  // `number` null: nach einem Objekt mit Fehler (Durchsicht S3), die Beträge stehen trotzdem da.
  | ({ state: 'rental'; number: number | null } & OverviewAmounts)
  // Ohne Einnahmen und Werbungskosten: neutral, ohne Aussage über die Pflicht zur Anlage V (R-C).
  | { state: 'neutral'; text: string }
  | { state: 'error'; text: string }
)

export type OverviewView = {
  title: string
  lines: OverviewLine[]
  totals: OverviewAmounts
  showsPrivate: boolean
  incomeHead: string
  failedText: string | null
}

const amounts = (s: TaxOverviewSums, basis: Basis): OverviewAmounts => ({
  incomeCents: basis === 'soll' ? s.sollCents : s.incomeCents,
  deductibleCents: s.deductibleCents,
  privateCents: s.privateCents,
  surplusCents: basis === 'soll' ? s.surplusSollCents : s.surplusCents,
})

export const neutralText = (year: number): string => `Keine Einnahmen und keine Werbungskosten in ${year}.`

export function overviewView(o: TaxOverview, basis: Basis, currentId: string | undefined): OverviewView {
  const lines: OverviewLine[] = o.rows.map((r) => {
    const head = { propertyId: r.propertyId, name: r.name || 'Ohne Namen', kind: r.kind, current: r.propertyId === currentId }
    if (!r.ok) return { ...head, state: 'error', text: `Nicht gerechnet: ${r.error}` }
    if (!r.hasRental) return { ...head, state: 'neutral', text: neutralText(o.year) }
    return { ...head, state: 'rental', number: r.number, ...amounts(r.sums, basis) }
  })
  const failed = lines.filter((l) => l.state === 'error').length
  const total = anlageVLines(o.year)?.income.total
  return {
    title: `Alle Objekte ${o.year}`,
    lines,
    totals: amounts(o.totals, basis),
    // Der private Teil steht daneben, sobald es ihn in einer Zeile mit Beträgen gibt (Kommentar in #96 zur Kopfkarte);
    // ein Objekt ohne Vermietung zeigt keine Beträge und zählt nicht in die Summe (Durchsicht S1).
    showsPrivate: o.rows.some((r) => r.ok && r.hasRental && r.sums.privateCents !== 0),
    incomeHead: basis === 'soll' ? 'Einnahmen vereinbart (Soll)' : total !== undefined ? `Einnahmen (Zeile ${total})` : 'Einnahmen',
    failedText: failed === 0 ? null
      : `${failed === 1 ? 'Ein Objekt zählt' : `${failed} Objekte zählen`} nicht in die Summe, weil die Steuerübersicht dort nicht gerechnet werden konnte. Die Nummern der Objekte danach stehen erst fest, wenn der Fehler behoben ist.`,
  }
}

export const OVERVIEW_NOTE = 'Kein Formular: Die Summe dient nur Ihrer Kontrolle.'

export function overviewMore(year: number): string[] {
  return [
    'In der Regel geben Sie je Objekt eine Anlage V ab, und das Finanzamt summiert sie selbst. Gehören zu einem Objekt mehrere Gebäude oder geben Sie Anlagen für Vermietungen ab, die nicht in Mietfuchs stehen, kann die Nummerierung abweichen.',
    `Die Zahlen sind dieselben wie in der Steuerübersicht jedes Objekts: Einnahmen nach der Summe der Zeilen mit der Zehn-Tage-Regel, Werbungskosten im Jahr ${year} nach Abzug des privaten Teils, bei verteiltem Erhaltungsaufwand (§ 82b EStDV) nur der Anteil dieses Jahres. Bei verbilligter Vermietung sind sie schon um den unentgeltlichen Teil gekürzt (§ 21 Abs. 2 EStG).`,
    'Eine laufende Nummer der Anlage bekommt jedes Objekt mit Mietverhältnis, Einnahmen oder Werbungskosten im Jahr, in der Reihenfolge der Objekte. Auch eine leer stehende Wohnung kann Werbungskosten haben, wenn Sie sie vermieten wollen.',
    'Ob für ein Objekt ohne Einnahmen und Werbungskosten eine Anlage V nötig ist, beurteilt Mietfuchs nicht.',
  ]
}
