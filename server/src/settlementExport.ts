// Export der fertigen Abrechnung als Daten (#415, Teil 3): JSON und CSV mit den Zahlen, die auch
// gedruckt werden. Wer ein eigenes Layout will, baut es damit außerhalb; Mietfuchs garantiert weiter
// die Zahlen. Eine Stelle, die aus dem Ergebnis die Exportform baut (reine Funktionen, keine Uhr, kein
// Datenzugriff): Bei einer abgeschlossenen Abrechnung ist das Ergebnis der eingefrorene Stand.
//
// **Keine Personendaten über das hinaus, was auf der Abrechnung steht**: Name des Mieters und der
// Wohnung, keine Anschrift, keine Kontodaten, keine Texte des Anschreibens. **Beträge in JSON sind Cent
// als ganze Zahlen**, nie Euro als Kommazahl; die CSV führt sie wie die Übersicht.csv der Steuer
// deutsch (Komma, ohne Tausenderpunkt), weil Tabellenkalkulationen sie so lesen.
import type { Settlement, SettlementPeriod, SettlementRow } from '../../shared/types.ts'
import { csvField, euro, textField } from './taxReceipts.ts'

// Was der Export vom Ergebnis braucht. Ein eingefrorener Stand kennt manches nicht (`closed`, ältere
// Felder von Zeilen sind optional), mehr verlangt der Export nicht.
export type ExportableSettlement = Pick<Settlement, 'period' | 'deadline' | 'totalCostsCents' | 'landlord' | 'closed' | 'statements'>

export const EXPORT_FORMAT = 'mietfuchs-abrechnung'
export const EXPORT_VERSION = 1

export type ExportRow = {
  costItemId: string
  category: string
  description: string
  totalCents: number
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
  scope: 'all' | 'heating'
  heatingOnly: boolean
}

export type SettlementExport = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  property: { id: string; name: string }
  period: SettlementPeriod
  deadline: string
  closed: { closedAt: string; sentAt: string | null } | null
  totalCostsCents: number
  statements: ExportStatement[]
  landlord: { totalCents: number; rows: ExportRow[] }
}

const exportRow = (r: SettlementRow): ExportRow => ({
  costItemId: r.costItemId, category: r.category, description: r.description, totalCents: r.totalCents,
  key: r.key ?? null, keyLabel: r.keyLabel, basisText: r.basisText ?? null, shareCents: r.shareCents, labor35aCents: r.labor35aCents ?? null,
})

export function settlementExportJson(s: ExportableSettlement, property: { id: string; name: string }): SettlementExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    property,
    period: s.period,
    deadline: s.deadline,
    closed: s.closed,
    totalCostsCents: s.totalCostsCents,
    statements: s.statements.map((st) => ({
      tenancyId: st.tenancyId, unitId: st.unitId, unitName: st.unitName, tenantName: st.tenantName, persons: st.persons, days: st.days,
      periodStart: st.periodStart, periodEnd: st.periodEnd, rows: st.rows.map(exportRow),
      totalShareCents: st.totalShareCents, total35aCents: st.total35aCents, prepaymentCents: st.prepaymentCents, balanceCents: st.balanceCents,
      scope: st.scope ?? 'all', heatingOnly: st.heatingOnly === true,
    })),
    landlord: { totalCents: s.landlord.totalCents, rows: s.landlord.rows.map(exportRow) },
  }
}

const HEADER = ['Mieter', 'Wohnung', 'Zeitraum von', 'Zeitraum bis', 'Zeile', 'Kostenart', 'Beschreibung', 'Gesamtkosten', 'Schlüssel', 'Basis', 'Anteil', 'davon Lohnanteil § 35a']

// Eine Zeile je Position und Mieter, danach je Mieter die Summen: Kosten, Vorauszahlungen, Ergebnis.
// Die Spalte „Zeile“ sagt, was die Zeile ist, damit sich filtern lässt.
export function settlementExportCsv(s: ExportableSettlement): string {
  const rows: string[] = [HEADER.join(';')]
  for (const st of s.statements) {
    const head = [textField(st.tenantName), textField(st.unitName), st.periodStart, st.periodEnd]
    const line = (kind: string, rest: string[]) => rows.push([...head, kind, ...rest].join(';'))
    for (const r of st.rows) {
      line('Position', [
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
