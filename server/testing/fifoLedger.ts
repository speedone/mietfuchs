// Das Mietkonto vor #281 als Testorakel (Entwurf docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md,
// Invarianten): Zahlungen des Jahres Jan→Dez der Reihe nach auf das Monats-Soll verteilt, ohne Übertrag. Wortgleich
// aus calc.ts vor der Umstellung auf rentAllocation.ts übernommen. invariant-mietkonto.test.ts verlangt: Wer jeden
// Monat genau das Soll im Monat zahlt, sieht im neuen Mietkonto dieselben Zahlen wie hier.
//
// Liegt in testing/ und nicht in test/, weil `node --test` jede Datei unter test/ ausführt.
import type { BillingPeriod, RentLedgerRow, RentMonth } from '../../shared/types.ts'
import { periodMonths } from '../../shared/period.ts'
import { monthShare, monthSoll, overlapDays as rangeOverlapDays } from '../../shared/monthRate.ts'
import { compareName, isRentPayment } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'

// Was das alte Mietkonto je Zeile lieferte (die Felder vor #281).
export type FifoLedgerRow = Pick<RentLedgerRow, 'tenancyId' | 'tenantName' | 'unitName' | 'sollYearCents' | 'baseRentYearCents' | 'prepaymentYearCents' | 'flatRateYearCents' | 'heatingPrepaymentYearCents' | 'paidYearCents' | 'settlementYearCents' | 'balanceCents' | 'dueSollCents' | 'arrearsCents' | 'openMonths'> & {
  months: Pick<RentMonth, 'month' | 'share' | 'baseRentCents' | 'prepaymentCents' | 'flatRateCents' | 'heatingPrepaymentCents' | 'sollCents' | 'paidCents' | 'status'>[]
}

export function fifoLedgerRows(
  source: Pick<Snapshot, 'units' | 'tenancies' | 'payments'>,
  span: Pick<BillingPeriod, 'from' | 'to'>,
  options: { asOf?: string } = {},
): FifoLedgerRow[] {
  const months = periodMonths(span)
  const asOfMonth = options.asOf?.slice(0, 7)
  const dueMonths = asOfMonth === undefined ? months.length : months.filter((m) => m < asOfMonth).length
  const unitById = new Map(source.units.map((u) => [u.id, u]))
  // Der Schnappschuss führt alle Zahlungen. Welche zur Spanne zählt, entscheidet diese Rechnung
  // nach ihrem Datum, und diese Regel bleibt bewusst an dieser Stelle.
  return source.tenancies
    .filter((t) => rangeOverlapDays(t.start, t.end, span.from, span.to) > 0)
    .map((t) => {
      // Die Heizstaffel (Heizung PR 5, Entwurf 3.11): im Soll neben der übrigen Vorauszahlung. Die
      // Felder dazu stehen nur in Zeilen mit Heizstaffel, damit sich ohne sie nichts ändert.
      const withHeating = Array.isArray(t.heatingPrepayments) && t.heatingPrepayments.length > 0
      const rowMonths = months.map((mm): FifoLedgerRow['months'][number] => {
        // Dieselbe Monatsregel wie die Abrechnung (#311): im angebrochenen Monat anteilig. Das Soll je
        // Bestandteil kommt aus `monthSoll` (shared/monthRate.ts), derselben Stelle wie die Tilgung (#312).
        const share = monthShare(t, mm)
        const soll = monthSoll(t, mm)
        const baseRentCents = soll.baseRent
        const prepaymentCents = soll.prepayment
        const flatRateCents = soll.flatRate
        const heatingPrepaymentCents = withHeating ? soll.heatingPrepayment : 0
        return {
          month: Number(mm.slice(5, 7)),
          ...(share.days > 0 && share.days < share.of ? { share } : {}),
          baseRentCents,
          prepaymentCents,
          ...(withHeating ? { heatingPrepaymentCents } : {}),
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + heatingPrepaymentCents + flatRateCents,
          paidCents: 0,
          status: 'open',
        }
      })
      // Zahlungseingänge der Spanne der Reihe nach auf die Monate verteilen, und zwar nur die Miete
      // (#280). Eine Nachzahlung aus der Abrechnung deckt kein Monats-Soll, und ein ausgezahltes
      // Guthaben ist keine Rücklastschrift; verteilt rissen beide eine Lücke in den Dezember oder
      // erfänden eine Überzahlung. Sie stehen gesondert in `settlementYearCents`.
      const inSpan = source.payments.filter((p) => p.tenancyId === t.id && p.date >= span.from && p.date <= span.to)
      const paidYearCents = inSpan.filter(isRentPayment).reduce((a, p) => a + p.amountCents, 0)
      const settlementYearCents = inSpan.filter((p) => !isRentPayment(p)).reduce((a, p) => a + p.amountCents, 0)
      let remaining = paidYearCents
      for (const [k, mo] of rowMonths.entries()) {
        if (mo.sollCents <= 0) {
          // kein Soll → als gedeckt behandeln, kein Geld verbrauchen
          mo.status = 'paid'
          continue
        }
        const applied = Math.max(0, Math.min(remaining, mo.sollCents))
        mo.paidCents = applied
        remaining -= applied
        mo.status = applied >= mo.sollCents ? 'paid' : k >= dueMonths ? 'notDue' : applied > 0 ? 'partial' : 'open'
      }
      const sollYearCents = rowMonths.reduce((a, mo) => a + mo.sollCents, 0)
      const dueSollCents = rowMonths.filter((_, k) => k < dueMonths).reduce((a, mo) => a + mo.sollCents, 0)
      return {
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        months: rowMonths,
        sollYearCents,
        baseRentYearCents: rowMonths.reduce((a, mo) => a + mo.baseRentCents, 0),
        prepaymentYearCents: rowMonths.reduce((a, mo) => a + mo.prepaymentCents, 0),
        flatRateYearCents: rowMonths.reduce((a, mo) => a + mo.flatRateCents, 0),
        ...(withHeating ? { heatingPrepaymentYearCents: rowMonths.reduce((a, mo) => a + (mo.heatingPrepaymentCents ?? 0), 0) } : {}),
        paidYearCents,
        settlementYearCents,
        balanceCents: paidYearCents - sollYearCents,
        dueSollCents,
        arrearsCents: Math.max(0, dueSollCents - paidYearCents),
        openMonths: rowMonths.filter((mo) => mo.status === 'open' || mo.status === 'partial').length,
      }
    })
    // Eine Liste, die ein Mensch liest: deutsche Sortierung, fest eingestellt (siehe compareName).
    .sort((a, b) => compareName(a.unitName, b.unitName) || compareName(a.tenantName, b.tenantName))
}
