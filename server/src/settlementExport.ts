// Export der fertigen Abrechnung als Daten (#415, Teil 3): JSON und CSV mit den Zahlen, die auch
// gedruckt werden. Wer ein eigenes Layout will, baut es damit außerhalb; Mietfuchs garantiert weiter
// die Zahlen. Eine Stelle, die aus dem Ergebnis die Exportform baut (reine Funktionen, keine Uhr, kein
// Datenzugriff): Bei einer abgeschlossenen Abrechnung ist das Ergebnis der eingefrorene Stand.
//
// **Keine Personendaten über das hinaus, was auf der Abrechnung steht**: Name des Mieters und der
// Wohnung, keine Anschrift, keine Kontodaten, keine Texte des Anschreibens. **Beträge in JSON sind Cent
// als ganze Zahlen**, nie Euro als Kommazahl; die CSV führt sie wie die Übersicht.csv der Steuer
// deutsch (Komma, ohne Tausenderpunkt), weil Tabellenkalkulationen sie so lesen.
import type { HeatingStatement, LetterAdjustmentMode, Notice, Settlement, SettlementPeriod, SettlementRow } from '../../shared/types.ts'
import { blockingErrors } from '../../shared/notices.ts'
import { csvField, euro, textField } from './taxReceipts.ts'

// Was der Export vom Ergebnis braucht. Ein eingefrorener Stand kennt manches nicht (`closed`, ältere
// Felder von Zeilen sind optional), mehr verlangt der Export nicht.
// `heating`, `notices` und `letters` fehlen in einem Stand von vor den jeweiligen Änderungen.
// `objectAreaM2` fehlt ohne Gesamtfläche am Objekt und in einem Stand von vor der Angabe.
export type ExportableSettlement = Pick<Settlement, 'period' | 'deadline' | 'totalCostsCents' | 'landlord' | 'closed' | 'statements'> & Partial<Pick<Settlement, 'heating' | 'notices' | 'letters' | 'objectAreaM2'>>

export const EXPORT_FORMAT = 'mietfuchs-abrechnung'
// **Wann die Fassung steigt** (Kompatibilitätszusage ab 1.0, #447, docs/daten-backup.md „Exporte und ihre Form“):
// Vorhandene Felder behalten Namen, Art und Bedeutung. Ein neues Feld ist keine neue Fassung; wer den Export liest,
// ignoriert unbekannte Felder. Entfernen, Umbenennen oder eine andere Bedeutung verlangen `EXPORT_VERSION` + 1 und einen
// Eintrag im CHANGELOG. Texte in Feldern (`basisText`, `keyLabel`, Sätze der Heizungsblöcke) sind Anzeige und nicht
// Teil der Zusage. export-zusage.test.ts hält die Form gegen eine eingecheckte Fassung und sagt, welcher Fall vorliegt.
export const EXPORT_VERSION = 1

export type ExportRow = {
  costItemId: string
  category: string
  // Der Name der eigenen Kostenart (gewerbliche Abrechnung), null ohne; `category` ist dann ihre Grundart.
  costType: string | null
  description: string
  totalCents: number
  // Art einer Zeile ohne Kostenposition (CO₂-Anteil, Übertrag, Netzentgelte, Erstattung), sonst null.
  kind: NonNullable<SettlementRow['kind']> | null
  key: string | null
  keyLabel: string
  basisText: string | null
  shareCents: number
  labor35aCents: number | null
  // Betrag pro m² der Gesamtfläche des Objekts (`property.totalAreaM2`), wie ihn eine gewerbliche Abrechnung als „Betrag pro
  // Einheit“ nennt: Cent je m², auf zwei Nachkommastellen gerundet, also ein Verhältnis und kein Betrag. Nur bei Zeilen mit
  // Schlüssel Fläche und eingetragener Gesamtfläche, sonst null (auch in den Zeilen des Vermieters, die keinen Schlüssel führen). Geteilt wird durch die Gesamtfläche, nicht durch die
  // Fläche, über die verteilt wurde; weichen beide ab, nennt es der Hinweis `property.area-mismatch`.
  centsPerM2: number | null
}

export type ExportStatement = {
  tenancyId: string
  unitId: string
  unitName: string
  tenantName: string
  persons: number
  days: number
  periodStart: string
  periodEnd: string
  rows: ExportRow[]
  totalShareCents: number
  total35aCents: number
  prepaymentCents: number
  // Positiv: Guthaben, negativ: Nachzahlung (wie `Statement.balanceCents`).
  balanceCents: number
  prepaymentOverridden: boolean
  suggestedMonthlyCents: number
  heatingPrepaymentCents: number | null
  prepaymentNote: string | null
  scope: 'all' | 'heating'
  heatingOnly: boolean
  recommendedDeadline: string | null
  // Die Anpassung der Vorauszahlung laut Anschreiben (keine, Vorschlag, eigener Betrag); null ohne Anschreiben.
  adjustment: { mode: LetterAdjustmentMode; newCents: number | null } | null
}

export type SettlementExport = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  // `totalAreaM2`: die Gesamtfläche des Objekts zur Zeit der Berechnung (abgeschlossen: eingefroren), null ohne Angabe.
  property: { id: string; name: string; totalAreaM2: number | null }
  period: SettlementPeriod
  deadline: string
  closed: { closedAt: string; sentAt: string | null } | null
  // Eine offene Abrechnung mit Fehlern ist ein Entwurf (wie der Vermerk im Druck, #341): nicht versenden.
  draft: boolean
  errors: { code: string; title: string }[]
  totalCostsCents: number
  statements: ExportStatement[]
  landlord: { totalCents: number; rows: ExportRow[] }
  // Die Heizungsblöcke wie die Abrechnung sie liefert (Angaben nach § 6a, CO₂, Vorrat, Lieferungen, eigene
  // Heizkostenabrechnung), eingefroren bei einer abgeschlossenen. Leer ohne Heizanlage.
  heating: HeatingStatement[]
}

// Cent je m² der Gesamtfläche, auf zwei Stellen (0,8131 €/m² sind 81.31). Nur für den Flächenschlüssel und Zeilen einer
// Position; null, wo es nichts zu teilen gibt.
export function centsPerM2(r: Pick<SettlementRow, 'key' | 'kind' | 'totalCents'>, areaM2: number | null): number | null {
  if (areaM2 === null || !(areaM2 > 0) || r.key !== 'area' || r.kind) return null
  return Math.round((r.totalCents / areaM2) * 100) / 100
}

const exportRow = (area: number | null) => (r: SettlementRow): ExportRow => ({
  costItemId: r.costItemId, category: r.category, costType: r.costType ?? null, description: r.description, totalCents: r.totalCents,
  kind: r.kind ?? null, key: r.key ?? null, keyLabel: r.keyLabel, basisText: r.basisText ?? null, shareCents: r.shareCents, labor35aCents: r.labor35aCents ?? null,
  centsPerM2: centsPerM2(r, area),
})

const areaOf = (s: Pick<ExportableSettlement, 'objectAreaM2'>): number | null => (typeof s.objectAreaM2 === 'number' && s.objectAreaM2 > 0 ? s.objectAreaM2 : null)

const errorsOf = (s: ExportableSettlement): Notice[] => (s.closed ? [] : blockingErrors(s.notices ?? []))

export function settlementExportJson(s: ExportableSettlement, property: { id: string; name: string }): SettlementExport {
  const area = areaOf(s)
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    property: { ...property, totalAreaM2: area },
    period: s.period,
    deadline: s.deadline,
    closed: s.closed,
    draft: errorsOf(s).length > 0,
    errors: errorsOf(s).map((n) => ({ code: n.code, title: n.title })),
    totalCostsCents: s.totalCostsCents,
    statements: s.statements.map((st) => ({
      tenancyId: st.tenancyId, unitId: st.unitId, unitName: st.unitName, tenantName: st.tenantName, persons: st.persons, days: st.days,
      periodStart: st.periodStart, periodEnd: st.periodEnd, rows: st.rows.map(exportRow(area)),
      totalShareCents: st.totalShareCents, total35aCents: st.total35aCents, prepaymentCents: st.prepaymentCents, balanceCents: st.balanceCents,
      prepaymentOverridden: st.prepaymentOverridden, suggestedMonthlyCents: st.suggestedMonthlyCents,
      heatingPrepaymentCents: st.heatingPrepaymentCents ?? null, prepaymentNote: st.prepaymentNote ?? null,
      scope: st.scope ?? 'all', heatingOnly: st.heatingOnly === true, recommendedDeadline: st.recommendedDeadline ?? null,
      adjustment: s.letters?.[st.tenancyId]?.adjustment ?? null,
    })),
    landlord: { totalCents: s.landlord.totalCents, rows: s.landlord.rows.map(exportRow(area)) },
    heating: s.heating ?? [],
  }
}

// Mit Gesamtfläche am Objekt kommt hinten die Spalte „Betrag pro m²“ dazu (eine eigene Spielart der Kopfzeile, export-zusage.test.ts);
// ohne bleibt die Datei wortgleich.
const PER_M2_COLUMN = 'Betrag pro m² der Gesamtfläche'
const header = (total: string, perM2: boolean) => ['Mieter', 'Wohnung', 'Zeitraum von', 'Zeitraum bis', 'Zeile', 'Kostenart', 'Beschreibung', total, 'Schlüssel', 'Basis', 'Anteil', 'davon Lohnanteil § 35a', ...(perM2 ? [PER_M2_COLUMN] : [])]
// Euro je m² mit vier Nachkommastellen, deutsch (0,8131), wie die Spalte „Betrag pro Einheit“ einer gewerblichen Abrechnung.
const perM2Field = (cents: number | null): string => (cents === null ? '' : (cents / 100).toFixed(4).replace('.', ','))

// Eine Zeile je Position und Mieter, danach je Mieter die Summen: Kosten, Vorauszahlungen, Ergebnis.
// Die Spalte „Zeile“ sagt, was die Zeile ist, damit sich filtern lässt.
const KIND_LABELS: Record<NonNullable<SettlementRow['kind']>, string> = {
  co2Relief: 'CO₂-Anteil des Vermieters',
  fuelCarry: 'Übertrag Brennstoff',
  gmodgRelief: 'Netzentgelte und Biobrennstoff',
  co2Refund: 'CO₂-Erstattung',
}
// Wie die Seite (totalColumnLabel in client/src/calcSteps.ts): Bei Kosten der Gemeinschaft zwei Bedeutungen.
const totalLabel = (rows: readonly SettlementRow[]): string => (rows.some((r) => r.key === 'external') ? 'Gesamtkosten bzw. Anteil an der Gemeinschaft' : 'Gesamtkosten')

export function settlementExportCsv(s: ExportableSettlement): string {
  const rows: string[] = []
  const area = areaOf(s)
  rows.push(header(totalLabel(s.statements.flatMap((st) => st.rows)), area !== null).join(';'))
  for (const st of s.statements) {
    const head = [textField(st.tenantName), textField(st.unitName), st.periodStart, st.periodEnd]
    const line = (kind: string, rest: string[], perM2: number | null = null) => rows.push([...head, kind, ...rest, ...(area !== null ? [perM2Field(perM2)] : [])].join(';'))
    for (const r of st.rows) {
      line(r.kind ? KIND_LABELS[r.kind] : 'Position', [
        // Die Spalte „Kostenart“ nennt die eigene Kostenart, wo es eine gibt, sonst wie bisher die Kostenart von Mietfuchs.
        textField(r.costType ?? r.category), textField(r.description), csvField(euro(r.totalCents)), textField(r.keyLabel), textField(r.basisText ?? ''),
        csvField(euro(r.shareCents)), r.labor35aCents ? csvField(euro(r.labor35aCents)) : '',
      ], centsPerM2(r, area))
    }
    line('Summe Ihrer Kosten', ['', '', '', '', '', csvField(euro(st.totalShareCents)), st.total35aCents ? csvField(euro(st.total35aCents)) : ''])
    line('Geleistete Vorauszahlungen', ['', '', '', '', '', csvField(euro(st.prepaymentCents)), ''])
    line(st.balanceCents < 0 ? 'Nachzahlung' : st.balanceCents > 0 ? 'Guthaben' : 'Ausgeglichen', ['', '', '', '', '', csvField(euro(Math.abs(st.balanceCents))), ''])
  }
  // Hinweise ans Ende, nach einer Leerzeile in der ersten Spalte: Die Kopfzeile bleibt Zeile 1 für jeden Leser.
  const notes: string[] = []
  if (errorsOf(s).length > 0) notes.push('Entwurf, nicht versenden: Diese Abrechnung enthält Angaben, die sich widersprechen.')
  if ((s.heating ?? []).length > 0) notes.push('Angaben der Heizkostenabrechnung (§ 6a, CO₂, Vorrat) nur im JSON-Export')
  if (notes.length > 0) rows.push('', ...notes)
  return `\uFEFF${rows.join('\r\n')}\r\n`
}

// `abrechnung-<Objekt>-<Zeitraum>.<Endung>`: ohne Schrägstriche und Leerzeichen, Umlaute bleiben.
export function exportFilename(propertyName: string, periodLabel: string, ext: 'json' | 'csv'): string {
  const part = (v: string) => v.normalize('NFC').replace(/[^\w\-äöüÄÖÜß]+/g, '-').replace(/^-+|-+$/g, '')
  return `abrechnung-${part(propertyName) || 'objekt'}-${part(periodLabel) || 'zeitraum'}.${ext}`
}

// Der eingefrorene Stand ist `unknown` (eine frühere Version hat ihn geschrieben). Ausgegeben wird er nur, wenn
// die Pflichtfelder da sind; sonst null, und die Route antwortet 409 statt eine halbe Datei zu liefern.
export function frozenExportable(stand: unknown): Omit<ExportableSettlement, 'period' | 'deadline' | 'closed'> | null {
  if (stand === null || typeof stand !== 'object') return null
  const statements: unknown = Reflect.get(stand, 'statements')
  const landlord: unknown = Reflect.get(stand, 'landlord')
  const total: unknown = Reflect.get(stand, 'totalCostsCents')
  if (!Array.isArray(statements) || landlord === null || typeof landlord !== 'object' || !Array.isArray(Reflect.get(landlord, 'rows')) || typeof Reflect.get(landlord, 'totalCents') !== 'number' || typeof total !== 'number') return null
  const heating: unknown = Reflect.get(stand, 'heating')
  const notices: unknown = Reflect.get(stand, 'notices')
  const letters: unknown = Reflect.get(stand, 'letters')
  const objectArea: unknown = Reflect.get(stand, 'objectAreaM2')
  return {
    statements, landlord: { totalCents: Reflect.get(landlord, 'totalCents'), rows: Reflect.get(landlord, 'rows') }, totalCostsCents: total,
    ...(Array.isArray(heating) ? { heating } : {}), ...(Array.isArray(notices) ? { notices } : {}),
    ...(letters !== null && typeof letters === 'object' ? { letters: letters as ExportableSettlement['letters'] } : {}),
    ...(typeof objectArea === 'number' && objectArea > 0 ? { objectAreaM2: objectArea } : {}),
  }
}
