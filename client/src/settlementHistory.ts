// Frühere Abschlüsse eines Jahres (#56, Teil 2), ohne DOM prüfbar. Ein früherer Stand ist das
// Dokument, das der Mieter damals bekommen hat; gezeigt wird, wann er entstand, verschickt und
// wiedergeöffnet wurde, und was er je Mieter ergab. Der Inhalt stammt womöglich aus einer älteren
// Version und wird deshalb vorsichtig gelesen.

import { fmtDate, fmtEuro } from './api'

export type HistoryEntry = { id: string, closedAt: string, sentAt: string | null, reopenedAt: string, settlement: unknown }

const saldo = (cents: number): string =>
  cents > 0 ? `Guthaben ${fmtEuro(cents)}` : cents < 0 ? `Nachzahlung ${fmtEuro(-cents)}` : 'ausgeglichen'

function linesOf(settlement: unknown): string[] {
  if (settlement === null || typeof settlement !== 'object') return ['Den Inhalt dieses Standes kann diese Version nicht anzeigen.']
  const lines: string[] = []
  const total = Reflect.get(settlement, 'totalCostsCents')
  if (typeof total === 'number') lines.push(`Gesamtkosten ${fmtEuro(total)}`)
  const statements = Reflect.get(settlement, 'statements')
  if (Array.isArray(statements)) {
    for (const st of statements) {
      if (st === null || typeof st !== 'object') continue
      const name = Reflect.get(st, 'tenantName')
      const unit = Reflect.get(st, 'unitName')
      const balance = Reflect.get(st, 'balanceCents')
      if (typeof balance !== 'number') continue
      lines.push(`${typeof name === 'string' ? name : '—'} (${typeof unit === 'string' ? unit : '—'}): ${saldo(balance)}`)
    }
  }
  return lines.length > 0 ? lines : ['Den Inhalt dieses Standes kann diese Version nicht anzeigen.']
}

export function historyView(entries: HistoryEntry[]): { id: string, head: string, lines: string[] }[] {
  return entries.map((e) => ({
    id: e.id,
    head: `Abgeschlossen am ${fmtDate(e.closedAt.slice(0, 10))}, ${e.sentAt ? `versandt am ${fmtDate(e.sentAt)}` : 'nicht versandt'}, wiedergeöffnet am ${fmtDate(e.reopenedAt.slice(0, 10))}`,
    lines: linesOf(e.settlement),
  }))
}
