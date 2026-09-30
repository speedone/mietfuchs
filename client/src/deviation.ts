// Was die Seite Abrechnung über ein abgeschlossenes Jahr sagt, dessen heutige Berechnung abweicht
// (#56), ohne DOM prüfbar. Der Ton erklärt und drängt nicht: Ob eine korrigierte Abrechnung
// verschickt wird, entscheidet der Vermieter, nicht das Programm. Eine Ursache nennt der Text
// nicht, denn eine Abweichung entsteht aus einer Korrektur an Mietfuchs ebenso wie aus einer
// Eingabe, die nach dem Abschluss geändert wurde.

import { fmtDate, fmtEuro } from './api'
import type { SettlementComparison } from './types'

const saldo = (cents: number | null): string =>
  cents === null ? 'nicht enthalten' : cents > 0 ? `Guthaben ${fmtEuro(cents)}` : cents < 0 ? `Nachzahlung ${fmtEuro(-cents)}` : 'ausgeglichen'

export function deviationView(cmp: SettlementComparison | undefined): { intro: string, lines: string[] } | null {
  if (!cmp) return null
  if (!cmp.comparable) {
    return { intro: 'Diese Abrechnung wurde mit einer älteren Version abgeschlossen; Mietfuchs kann sie nicht mit der heutigen Berechnung vergleichen.', lines: [] }
  }
  if (cmp.deviations.length === 0) return null
  return {
    intro:
      'Die heutige Berechnung ergibt für dieses abgeschlossene Jahr andere Zahlen, weil sich seit dem Abschluss Daten oder die Berechnung von Mietfuchs geändert haben. ' +
      'Die verschickte Abrechnung bleibt, wie sie ist; ob Sie eine korrigierte verschicken, entscheiden Sie.',
    lines: cmp.deviations.map((d) => {
      const head = `${d.tenantName} (${d.unitName}): abgeschlossen ${saldo(d.frozenBalanceCents)}, heute ${saldo(d.currentBalanceCents)}`
      const amount = fmtEuro(Math.abs(d.differenceCents))
      if (d.direction === 'tenant') {
        return `${head} — ${amount} zugunsten des Mieters. Eine Korrektur zu seinen Gunsten ist möglich und in der Regel geboten.`
      }
      return cmp.deadlinePassed
        ? `${head} — ${amount} zugunsten des Vermieters. Die Frist ist abgelaufen (${fmtDate(cmp.deadline)}); eine Nachforderung ist in der Regel ausgeschlossen (§ 556 Abs. 3 BGB).`
        : `${head} — ${amount} zugunsten des Vermieters. Eine korrigierte Abrechnung kann eine Nachforderung bis zum ${fmtDate(cmp.deadline)} noch begründen, wenn sie dem Mieter bis dahin zugeht.`
    }),
  }
}
