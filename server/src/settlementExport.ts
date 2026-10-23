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
export type ExportableSettlement = Pick<Settlement, 'period' | 'deadline' | 'totalCostsCents' | 'landlord' | 'closed' | 'statements'> & Partial<Pick<Settlement, 'heating' | 'notices' | 'letters'>>

export const EXPORT_FORMAT = 'mietfuchs-abrechnung'
export const EXPORT_VERSION = 1

export type ExportRow = {
  costItemId: string
  category: string
  description: string
  totalCents: number
  // Art einer Zeile ohne Kostenposition (CO₂-Anteil, Übertrag, Netzentgelte, Erstattung), sonst null.
  kind: NonNullable<SettlementRow['kind']> | null
  key: string | null
  keyLabel: string
  basisText: string | null
  shareCents: number
  labor35aCents: number | null
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
  property: { id: string; name: string }
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

const exportRow = (r: SettlementRow): ExportRow => ({
  costItemId: r.costItemId, category: r.category, description: r.description, totalCents: r.totalCents,
  kind: r.kind ?? null, key: r.key ?? null, keyLabel: r.keyLabel, basisText: r.basisText ?? null, shareCents: r.shareCents, labor35aCents: r.labor35aCents ?? null,
})

const errorsOf = (s: ExportableSettlement): Notice[] => (s.closed ? [] : blockingErrors(s.notices ?? []))

export function settlementExportJson(s: ExportableSettlement, property: { id: string; name: string }): SettlementExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    property,
    period: s.period,
    deadline: s.deadline,
    closed: s.closed,
    draft: errorsOf(s).length > 0,
    errors: errorsOf(s).map((n) => ({ code: n.code, title: n.title })),
    totalCostsCents: s.totalCostsCents,
    statements: s.statements.map((st) => ({
      tenancyId: st.tenancyId, unitId: st.unitId, unitName: st.unitName, tenantName: st.tenantName, persons: st.persons, days: st.days,
      periodStart: st.periodStart, periodEnd: st.periodEnd, rows: st.rows.map(exportRow),
      totalShareCents: st.totalShareCents, total35aCents: st.total35aCents, prepaymentCents: st.prepaymentCents, balanceCents: st.balanceCents,
      prepaymentOverridden: st.prepaymentOverridden, suggestedMonthlyCents: st.suggestedMonthlyCents,
      heatingPrepaymentCents: st.heatingPrepaymentCents ?? null, prepaymentNote: st.prepaymentNote ?? null,
      scope: st.scope ?? 'all', heatingOnly: st.heatingOnly === true, recommendedDeadline: st.recommendedDeadline ?? null,
      adjustment: s.letters?.[st.tenancyId]?.adjustment ?? null,
    })),
    landlord: { totalCents: s.landlord.totalCents, rows: s.landlord.rows.map(exportRow) },
    heating: s.heating ?? [],
  }
}

const header = (total: string) => ['Mieter', 'Wohnung', 'Zeitraum von', 'Zeitraum bis', 'Zeile', 'Kostenart', 'Beschreibung', total, 'Schlüssel', 'Basis', 'Anteil', 'davon Lohnanteil § 35a']

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
  if (errorsOf(s).length > 0) rows.push('Entwurf, nicht versenden: Diese Abrechnung enthält Angaben, die sich widersprechen.')
  if ((s.heating ?? []).length > 0) rows.push('Angaben der Heizkostenabrechnung (§ 6a, CO₂, Vorrat) nur im JSON-Export')
  rows.push(header(totalLabel(s.statements.flatMap((st) => st.rows))).join(';'))
  for (const st of s.statements) {
    const head = [textField(st.tenantName), textField(st.unitName), st.periodStart, st.periodEnd]
    const line = (kind: string, rest: string[]) => rows.push([...head, kind, ...rest].join(';'))
    for (const r of st.rows) {
      line(r.kind ? KIND_LABELS[r.kind] : 'Position', [
        textField(r.category), textField(r.description), csvField(euro(r.totalCents)), textField(r.keyLabel), textField(r.basisText ?? ''),
        csvField(euro(r.shareCents)), r.labor35aCents ? csvField(euro(r.labor35aCents)) : '',
      ])
    }
    line('Summe Ihrer Kosten', ['', '', '', '', '', csvField(euro(st.totalShareCents)), st.total35aCents ? csvField(euro(st.total35aCents)) : ''])
    line('Geleistete Vorauszahlungen', ['', '', '', '', '', csvField(euro(st.prepaymentCents)), ''])
    line(st.balanceCents < 0 ? 'Nachzahlung' : st.balanceCents > 0 ? 'Guthaben' : 'Ausgeglichen', ['', '', '', '', '', csvField(euro(Math.abs(st.balanceCents))), ''])
  }
  return `﻿${rows.join('\r\n')}\r\n`
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
  return {
    statements, landlord: { totalCents: Reflect.get(landlord, 'totalCents'), rows: Reflect.get(landlord, 'rows') }, totalCostsCents: total,
    ...(Array.isArray(heating) ? { heating } : {}), ...(Array.isArray(notices) ? { notices } : {}),
    ...(letters !== null && typeof letters === 'object' ? { letters: letters as ExportableSettlement['letters'] } : {}),
  }
}
