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

// Die Frist nach § 556 Abs. 3 BGB (#142). Nach dem Wiederöffnen fehlte das Versanddatum, und die
// Seite zeigte wieder „noch 91 Tage“, als sei nie etwas verschickt worden. Für die Frist zählt
// aber der Zugang der Abrechnung, und die frühere Fassung ist zugegangen. Deshalb nennt die Seite
// den ersten Versand aus den früheren Abschlüssen, solange der gültige Stand keinen eigenen hat,
// und sagt, was für eine berichtigte Fassung gilt: Nachfordern kann sie nur, wenn auch sie bis zum
// Fristende zugeht (§ 556 Abs. 3 Satz 3 BGB). Das heutige Datum wird hineingereicht. Bezeichnung
// und Ende der Frist kommen von der Abrechnung des Servers (#208); die Seite rechnet sie nicht selbst.
export type DeadlineView = { level: 'ok' | 'notice' | 'error', text: string }

export function deadlineView(label: string, deadline: string, sentAt: string | null, history: HistoryEntry[], today: Date): DeadlineView {
  const end = deadline
  const endText = fmtDate(deadline)
  const daysLeft = Math.ceil((Date.parse(`${deadline}T00:00:00Z`) - today.getTime()) / 86400000)
  if (sentAt) {
    return { level: 'ok', text: `Abrechnung ${label} am ${fmtDate(sentAt)} versendet — die Frist nach §556 BGB (${endText}) ist ${sentAt <= end ? 'gewahrt' : 'überschritten'}.` }
  }
  const earlier = history.map((h) => h.sentAt).filter((d): d is string => typeof d === 'string' && d !== '').sort()[0]
  if (earlier && earlier > end) {
    // Schon die frühere Fassung ging erst nach Fristende zu: dann gilt, was ohne Versand gälte.
    const late = `Eine frühere Fassung der Abrechnung ${label} wurde am ${fmtDate(earlier)} versendet, nach dem Ende der Frist.`
    return { level: 'error', text: `${late} Die Abrechnungsfrist für ${label} ist am ${endText} abgelaufen — Nachforderungen sind in der Regel ausgeschlossen (Guthaben des Mieters bleiben fällig).` }
  }
  if (earlier) {
    const head = `Eine frühere Fassung der Abrechnung ${label} wurde am ${fmtDate(earlier)} versendet (siehe „Frühere Abschlüsse dieses Jahres“); die Frist nach §556 BGB (${endText}) ist für sie gewahrt.`
    if (daysLeft >= 0) {
      return { level: daysLeft < 90 ? 'notice' : 'ok', text: `${head} Soll eine berichtigte Fassung mehr nachfordern, muss auch sie dem Mieter bis zum ${endText} zugehen — noch ${daysLeft} Tage.` }
    }
    return { level: 'notice', text: `${head} Die Frist ist abgelaufen; eine berichtigte Fassung kann in der Regel keine höhere Nachzahlung mehr fordern (Ausnahme nach § 556 Abs. 3 Satz 3 BGB: Der Vermieter hat die Verspätung nicht zu vertreten).` }
  }
  if (daysLeft >= 0) {
    return { level: daysLeft < 90 ? 'notice' : 'ok', text: `Abrechnungsfrist (§556 BGB): Die Abrechnung ${label} muss dem Mieter bis zum ${endText} zugehen — noch ${daysLeft} Tage.` }
  }
  return { level: 'error', text: `Die Abrechnungsfrist für ${label} ist am ${endText} abgelaufen — Nachforderungen sind in der Regel ausgeschlossen (Guthaben des Mieters bleiben fällig).` }
}

export function historyView(entries: HistoryEntry[]): { id: string, head: string, lines: string[] }[] {
  return entries.map((e) => ({
    id: e.id,
    head: `Abgeschlossen am ${fmtDate(e.closedAt.slice(0, 10))}, ${e.sentAt ? `versandt am ${fmtDate(e.sentAt)}` : 'nicht versandt'}, wiedergeöffnet am ${fmtDate(e.reopenedAt.slice(0, 10))}`,
    lines: linesOf(e.settlement),
  }))
}
