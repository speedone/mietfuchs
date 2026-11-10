// Eine geprüfte E-Rechnung als `RawExtraction` (#189), damit sie denselben Weg geht wie eine
// KI-Antwort: normalizeAmounts → toExtraction → Belegbuchung.
//
// **Brutto je Position.** Die Positionen einer E-Rechnung sind netto (BT-131), die Belegbuchung
// rechnet brutto. Je Steuergruppe (BG-23) wird deren Brutto (BT-116 + BT-117) im Verhältnis
// Netto × (1 + Satz) auf ihre Positionen verteilt; Zu- und Abschläge auf Dokumentebene gehen so
// anteilig ein. Rest-Cents bekommen nur Positionen mit dem Vorzeichen der Gruppe, damit keine
// das Vorzeichen wechselt. Eine Gruppe ohne Position (nur ein Zuschlag) wird eine eigene Position.
// Zusammen ergeben die Positionen genau BT-112; kein Hochrechnen mit einem angenommenen Satz.
// Mietfuchs setzt deshalb weder `positionsAreNet` noch `labor35aTotalEur`, und normalizeAmounts
// ändert nichts.
//
// **§35a nie geschätzt** (§ 35a Abs. 5 EStG, BMF 09.11.2016 Rn. 39 f.): Vorgeschlagen wird nur
// der Betrag einer Position, die erkennbar Arbeit ist, brutto, abzüglich ihres Anteils an
// Abschlägen auf Dokumentebene, ohne Zuschläge (eine Entsorgungspauschale ist keine
// ausgewiesene Arbeit). Jeder Vorschlag ist in `laborGuessed` vermerkt und will bestätigt sein.

import { largestRemainder } from '../apportion.ts'
import { clip } from '../bank/statement.ts'
import type { RawExtraction } from '../invoiceAmounts.ts'
import type { EInvoice, EInvoiceLine, VatKey } from './model.ts'

const DESCRIPTION_MAX = 200
// Zeiteinheiten nach UN/ECE Rec. 20. Nicht DAY: Versorger rechnen den Grundpreis in Tagen ab.
const TIME_UNITS = new Set(['HUR', 'MIN'])
const WORK = /arbeitszeit|arbeitslohn|\blohn|monteur|gesellen|meisterstunde|maschinenstunde|anfahrt|fahrtkosten|fahrtzeit/i
const NOT_WORK = /material|gutachten|planung|miete/i

const keyOf = (v: VatKey) => `${v.category}|${v.rateBasisPoints}`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const toEur = (cents: number) => cents / 100
const indexKey = (i: number) => String(i).padStart(6, '0')

function isWork(l: EInvoiceLine): boolean {
  const words = `${l.name} ${l.description ?? ''}`
  if (NOT_WORK.test(words)) return false
  return (l.unitCode !== null && TIME_UNITS.has(l.unitCode.toUpperCase())) || WORK.test(words)
}

function descriptionOf(l: EInvoiceLine): string {
  const text = l.description && l.description !== l.name ? `${l.name} - ${l.description}` : l.name
  return clip(text, DESCRIPTION_MAX)
}

// Das Brutto einer Gruppe auf ihre Positionen, Index → Cent.
function spread(gross: number, members: { index: number, line: EInvoiceLine }[], rate: number): Map<number, number> {
  const weights = members.map((m) => m.line.netCents * (10000 + rate) / 10000)
  const weightSum = sum(weights)
  const raw = weights.map((w) => (gross * w) / weightSum)
  const sign = Math.sign(gross)
  const same = members.map((m, i) => i).filter((i) => Math.sign(members[i].line.netCents) === sign)
  const pool = same.length > 0 ? same : members.map((_, i) => i)
  const out = new Map<number, number>()
  members.forEach((m, i) => { if (!pool.includes(i)) out.set(m.index, Math.round(raw[i])) })
  const rest = gross - sum([...out.values()])
  const shares = largestRemainder(rest, pool.map((i) => raw[i]), pool.map((i) => indexKey(members[i].index)))
  pool.forEach((i, k) => out.set(members[i].index, shares[k]))
  return out
}

export function toRawExtraction(inv: EInvoice): { raw: RawExtraction, laborGuessed: boolean[] } {
  const credit = inv.syntax === 'ubl-credit-note' || inv.typeCode === '381'
  const sign = credit ? -1 : 1
  const total = inv.totals.taxInclusive ?? 0

  // Gruppen aus der Aufschlüsselung; eine Position, deren Satz dort fehlt, bildet eine eigene
  // Gruppe mit gerundetem Brutto (dann stimmen die Summenregeln ohnehin nicht, check.ts sagt es).
  const groups = new Map<string, { vat: VatKey, gross: number | null }>()
  for (const g of inv.vatGroups) {
    const k = keyOf(g.vat)
    const prev = groups.get(k)
    groups.set(k, { vat: g.vat, gross: (prev?.gross ?? 0) + g.basisCents + g.taxCents })
  }
  for (const l of inv.lines) if (!groups.has(keyOf(l.vat))) groups.set(keyOf(l.vat), { vat: l.vat, gross: null })

  const amounts: number[] = inv.lines.map(() => 0)
  const extra: { description: string, cents: number }[] = []
  for (const [k, g] of groups) {
    const members = inv.lines.map((line, index) => ({ index, line })).filter((m) => keyOf(m.line.vat) === k)
    const gross = g.gross ?? Math.round(sum(members.map((m) => m.line.netCents)) * (10000 + g.vat.rateBasisPoints) / 10000)
    const weightSum = sum(members.map((m) => m.line.netCents))
    if (members.length === 0 || weightSum === 0) {
      if (gross !== 0) {
        const charges = inv.charges.filter((c) => keyOf(c.vat) === k)
        const reasons = charges.map((c) => c.reason).filter((r) => r !== null)
        extra.push({ description: reasons.length > 0 ? reasons.join(', ') : gross > 0 ? 'Zuschlag' : 'Abschlag', cents: gross })
      }
      members.forEach((m) => { amounts[m.index] = 0 })
      continue
    }
    for (const [index, cents] of spread(gross, members, g.vat.rateBasisPoints)) amounts[index] = cents
  }

  // Weicht die Summe der Gruppen von BT-112 ab (die Rechnung verletzt dann eine Summenregel, und
  // check.ts hat das als Notiz), trägt die betragsgrößte Position den Unterschied: Die Positionen
  // sollen genau den Rechnungsbetrag ergeben, den die Auswertung zeigt.
  const all = [...amounts, ...extra.map((e) => e.cents)]
  const gap = total - sum(all)
  if (gap !== 0 && all.length > 0) {
    const biggest = all.reduce((best, c, i) => (Math.abs(c) > Math.abs(all[best]) ? i : best), 0)
    if (biggest < amounts.length) amounts[biggest] += gap
    else extra[biggest - amounts.length].cents += gap
  }

  // Abschläge je Gruppe, netto, für den Lohnanteil.
  const allowanceByGroup = new Map<string, number>()
  for (const c of inv.charges) if (!c.charge) allowanceByGroup.set(keyOf(c.vat), (allowanceByGroup.get(keyOf(c.vat)) ?? 0) + c.cents)
  const positiveNetByGroup = new Map<string, number>()
  for (const l of inv.lines) if (l.netCents > 0) positiveNetByGroup.set(keyOf(l.vat), (positiveNetByGroup.get(keyOf(l.vat)) ?? 0) + l.netCents)

  const laborGuessed: boolean[] = []
  const positions = inv.lines.map((l, i) => {
    let labor: number | null = null
    if (!credit && l.netCents > 0 && isWork(l)) {
      const rate = l.vat.rateBasisPoints
      const own = l.netCents + Math.round(l.netCents * rate / 10000)
      const groupNet = positiveNetByGroup.get(keyOf(l.vat)) ?? 0
      const allowance = allowanceByGroup.get(keyOf(l.vat)) ?? 0
      const share = groupNet > 0 ? Math.round(allowance * (10000 + rate) / 10000 * l.netCents / groupNet) : 0
      labor = Math.min(Math.max(own - share, 0), Math.max(amounts[i], 0))
    }
    laborGuessed.push(labor !== null)
    return { description: descriptionOf(l), amountEur: toEur(sign * amounts[i]), labor35aEur: labor === null ? null : toEur(labor) }
  })
  for (const e of extra) {
    laborGuessed.push(false)
    positions.push({ description: clip(e.description, DESCRIPTION_MAX), amountEur: toEur(sign * e.cents), labor35aEur: null })
  }

  return {
    raw: {
      vendor: inv.seller,
      invoiceDate: inv.issueDate,
      periodStart: inv.periodStart ?? inv.deliveryDate,
      periodEnd: inv.periodEnd ?? inv.deliveryDate,
      totalGrossEur: toEur(sign * total),
      positions,
    },
    laborGuessed,
  }
}
