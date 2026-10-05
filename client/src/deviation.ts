// Was die Seite Abrechnung über ein abgeschlossenes Jahr sagt, dessen heutige Berechnung abweicht
// (#56), ohne DOM prüfbar. Der Ton erklärt und drängt nicht: Ob eine korrigierte Abrechnung
// verschickt wird, entscheidet der Vermieter, nicht das Programm. Eine Ursache nennt der Text
// nicht, denn eine Abweichung entsteht aus einer Korrektur an Mietfuchs ebenso wie aus einer
// Eingabe, die nach dem Abschluss geändert wurde.

import { fmtDate, fmtEuro } from './api'
import type { SettlementComparison } from './types'

const saldo = (cents: number | null): string =>
  cents === null ? 'nicht enthalten' : cents > 0 ? `Guthaben ${fmtEuro(cents)}` : cents < 0 ? `Nachzahlung ${fmtEuro(-cents)}` : 'ausgeglichen'

export type DeviationView = { title: string, intro: string, lines: { id: string, text: string }[] }

export function deviationView(cmp: SettlementComparison | undefined): DeviationView | null {
  if (!cmp) return null
  if (!cmp.comparable) {
    return {
      title: 'Vergleich mit der heutigen Berechnung nicht möglich',
      intro: 'Diese Abrechnung wurde mit einer älteren Version abgeschlossen, oder die heutige Berechnung ist nicht möglich; Mietfuchs kann sie nicht mit der heutigen Berechnung vergleichen.',
      lines: [],
    }
  }
  // Ein geänderter Rechtswert (Heizung PR 1): ein neuer Stand des Rechtsregisters, etwa nach einer
  // Berichtigung. Er steht unter den Salden, und allein bekommt er einen eigenen Titel, denn dann
  // ergibt die heutige Berechnung dieselben Zahlen.
  const valueLines = cmp.valueChanges.map((v) => ({ id: `law:${v.id}`, text: `Rechtswert geändert: ${v.title} von ${v.frozenText} auf ${v.currentText}.` }))
  if (cmp.deviations.length === 0 && valueLines.length === 0) return null
  if (cmp.deviations.length === 0) {
    return {
      title: 'Rechtswerte seit dem Abschluss geändert',
      intro:
        'Seit dem Abschluss hat sich ein Rechtswert geändert, mit dem diese Abrechnung gerechnet wurde. Die heutige Berechnung ergibt für die Mieter dieselben Salden. ' +
        'Die verschickte Abrechnung bleibt, wie sie ist.',
      lines: valueLines,
    }
  }
  return {
    title: 'Die heutige Berechnung weicht vom abgeschlossenen Stand ab',
    intro:
      'Die heutige Berechnung ergibt für dieses abgeschlossene Jahr andere Zahlen, weil sich seit dem Abschluss Daten oder die Berechnung von Mietfuchs geändert haben. ' +
      'Die verschickte Abrechnung bleibt, wie sie ist; ob Sie eine korrigierte verschicken, entscheiden Sie.',
    lines: [...cmp.deviations.map((d) => {
      const who = `${d.tenantName} (${d.unitName})`
      // Nur auf einer Seite: nichts nachgerechnet, also auch kein Urteil über die Richtung.
      if (d.direction === 'added') return { id: d.tenancyId, text: `${who}: kam nach dem Abschluss hinzu, heute ${saldo(d.currentBalanceCents)}.` }
      if (d.direction === 'removed') return { id: d.tenancyId, text: `${who}: steht heute nicht mehr in der Abrechnung dieses Objekts; abgeschlossen ${saldo(d.frozenBalanceCents)}.` }
      const head = `${who}: abgeschlossen ${saldo(d.frozenBalanceCents)}, heute ${saldo(d.currentBalanceCents)}`
      const amount = fmtEuro(Math.abs(d.differenceCents))
      if (d.direction === 'tenant') {
        return { id: d.tenancyId, text: `${head} — ${amount} zugunsten des Mieters. Eine Korrektur zu seinen Gunsten ist möglich und in der Regel geboten.` }
      }
      return {
        id: d.tenancyId,
        text: cmp.deadlinePassed
          ? `${head} — ${amount} zugunsten des Vermieters. Die Frist ist abgelaufen (${fmtDate(cmp.deadline)}); eine Korrektur zulasten des Mieters (Nachforderung oder geringeres Guthaben) ist in der Regel ausgeschlossen (§ 556 Abs. 3 BGB).`
          : `${head} — ${amount} zugunsten des Vermieters. Eine korrigierte Abrechnung zulasten des Mieters (Nachforderung oder geringeres Guthaben) ist bis zum ${fmtDate(cmp.deadline)} noch möglich, wenn sie ihm bis dahin zugeht.`,
      }
    }), ...valueLines],
  }
}
