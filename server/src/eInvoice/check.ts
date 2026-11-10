// Wird eine gelesene E-Rechnung übernommen, und was muss der Vermieter dazu wissen (#189)?
//
// Abgelehnt wird, was sich nicht sicher übernehmen lässt: Unlesbares, fehlendes Datum oder
// Gesamtbetrag, keine Positionen, eine fremde Währung, und Rechnungsarten, die keine Kosten sind.
// Abschlags- und Teilrechnungen (386, 326) gehören dazu: Die Schlussrechnung nennt die ganzen
// Kosten, beide zu übernehmen zählte sie doppelt. Abgelehnt heißt nur: nicht aus dem XML
// übernommen; der Beleg geht den bisherigen Weg (KI oder von Hand).
//
// Alles andere wird übernommen, mit Notizen, die die Auswertung rot machen (PR 2):
// - die korrigierte Rechnung (384) und welche sie ersetzt,
// - bereits bezahlte Abschläge (BT-113): Als Kosten zählt der Gesamtbetrag BT-112,
// - Summenregeln der EN 16931 (BR-CO-10, -13, -15, -14), je mit einem Cent Spielraum,
// - ein Abzug mit Bezug auf eine Vorgängerrechnung: Zieht eine Schlussrechnung die Abschläge als
//   Position oder Abschlag ab, ist BT-112 nur der Rest und die Kosten wären zu niedrig.

import { euro } from '../../../shared/costItem.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { EInvoice } from './model.ts'

const TAKEN = new Set(['380', '381', '384', '875', '876', '877'])
const ADVANCE = new Set(['386', '326'])
const ADVANCE_TEXT = /abschlag|anzahlung|vorauszahlung|bereits (gezahlt|bezahlt)/i
const SLACK_CENTS = 1

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function refusal(inv: EInvoice): string | null {
  if (inv.unreadable.length > 0) return `Die E-Rechnung ließ sich nicht vollständig lesen (${inv.unreadable.join(', ')}).`
  if (inv.issueDate === null) return 'Die E-Rechnung nennt kein Rechnungsdatum.'
  if (inv.totals.taxInclusive === null) return 'Die E-Rechnung nennt keinen Gesamtbetrag.'
  if (inv.lines.length === 0) return 'Die E-Rechnung enthält keine Positionen.'
  if (inv.currency !== 'EUR') return `Die E-Rechnung ist in ${inv.currency ?? 'unbekannter Währung'} ausgestellt; Mietfuchs übernimmt nur Rechnungen in Euro.`
  if (inv.typeCode !== null && ADVANCE.has(inv.typeCode)) return 'Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten, sonst zählte die Schlussrechnung doppelt. Erfassen Sie die Schlussrechnung.'
  if (inv.typeCode === null || !TAKEN.has(inv.typeCode)) return `Die Rechnungsart ${inv.typeCode ?? '(keine Angabe)'} übernimmt Mietfuchs nicht aus der E-Rechnung.`
  return null
}

// Die Summenregeln, nur wo beide Seiten dastehen. Fehlende Zu- und Abschlagssummen gelten als 0.
function sumNotes(inv: EInvoice): string[] {
  const t = inv.totals
  const notes: string[] = []
  const off = (a: number, b: number) => Math.abs(a - b) > SLACK_CENTS
  const lines = sum(inv.lines.map((l) => l.netCents))
  if (t.lineNet !== null && off(lines, t.lineNet)) notes.push(`Die Positionen ergeben zusammen ${euro(lines)}, die Rechnung nennt als Summe der Positionen ${euro(t.lineNet)}.`)
  if (t.taxExclusive !== null && t.lineNet !== null) {
    const expected = t.lineNet - (t.allowances ?? 0) + (t.charges ?? 0)
    if (off(t.taxExclusive, expected)) notes.push(`Die Summe ohne Umsatzsteuer (${euro(t.taxExclusive)}) passt nicht zu Positionen, Abschlägen und Zuschlägen (${euro(expected)}).`)
  }
  if (t.taxInclusive !== null && t.taxExclusive !== null && t.tax !== null && off(t.taxInclusive, t.taxExclusive + t.tax)) {
    notes.push(`Der Gesamtbetrag (${euro(t.taxInclusive)}) passt nicht zur Summe ohne Umsatzsteuer und der Umsatzsteuer (${euro(t.taxExclusive + t.tax)}).`)
  }
  const groups = sum(inv.vatGroups.map((g) => g.taxCents))
  if (t.tax !== null && inv.vatGroups.length > 0 && off(t.tax, groups)) notes.push(`Die Umsatzsteuer (${euro(t.tax)}) passt nicht zur Summe der Steuergruppen (${euro(groups)}).`)
  return notes
}

function deductionNotes(inv: EInvoice): string[] {
  const referenced = inv.precedingInvoice !== null
  const deductions = [
    ...inv.lines.filter((l) => l.netCents < 0).map((l) => ({ cents: -l.netCents, label: l.name })),
    ...inv.charges.filter((c) => !c.charge && c.cents > 0).map((c) => ({ cents: c.cents, label: c.reason ?? 'Abschlag' })),
  ]
  return deductions
    .filter((d) => referenced || ADVANCE_TEXT.test(d.label))
    .map((d) => `Die Rechnung zieht ${euro(d.cents)} für „${d.label}“ ab. Ist das eine bereits gebuchte Abschlagsrechnung, wären die Kosten zu niedrig.`)
}

export function checkEInvoice(inv: EInvoice): { refused: string } | { notes: string[] } {
  const refused = refusal(inv)
  if (refused !== null) return { refused }
  const notes: string[] = []
  if (inv.typeCode === '384') {
    const p = inv.precedingInvoice
    const which = p ? `die Rechnung ${p.number}${p.date ? ` vom ${germanDate(p.date)}` : ''}` : 'eine frühere Rechnung'
    notes.push(`Diese Rechnung korrigiert ${which}. Diese darf nicht zusätzlich gebucht sein.`)
  }
  const prepaid = inv.totals.prepaid
  if (prepaid !== null && prepaid > 0 && inv.totals.taxInclusive !== null) {
    notes.push(`Abschläge über ${euro(prepaid)} sind bereits bezahlt; als Kosten zählt der Gesamtbetrag von ${euro(inv.totals.taxInclusive)}.`)
  }
  notes.push(...sumNotes(inv), ...deductionNotes(inv))
  return { notes }
}
