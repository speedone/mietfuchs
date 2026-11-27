// Ändert der Monat laut Verwendungszweck etwas an der Tilgung (#693)? Rein.
//
// Wer jeden Monat „Miete 11/2026“ überweist und nichts schuldet, bestimmt mit dem Monat genau die Forderung, die die
// Zahlung ohne Bestimmung ohnehin tilgte (§ 366 Abs. 2 BGB, rentAllocation.ts). Dann braucht es keinen Vorschlag und
// keine Bestätigung: Die Zeile bleibt, wie sie ohne Erkennung des Monats wäre. Gefragt wird nicht mit einer zweiten
// Regel („nichts offen vor dem Monat“), sondern mit der Tilgung selbst: Der Eingang wird einmal ohne und einmal mit
// Monat zu den Zahlungen des Objekts gelegt, und nur wenn Beginn des Kontos (`ledgerStartOf` liest den Monat der ersten
// Zahlung) und jeder Teil jeder Zahlung des Mietverhältnisses gleich sind, ändert der Monat nichts. Mietkonto und
// Steuer lesen genau diese Teile; die Invariante dazu steht in invariant-kontoauszug-monat.test.ts.
//
// Die Kennung der künftigen Zahlung ist noch unbekannt, und am selben Tag entscheidet die Kennung über die Reihenfolge:
// Verglichen wird deshalb mit einer Kennung vor und einer nach allen anderen. Im Zweifel „ändert etwas“.
import { allocateRentPayments, ledgerStartOf, ledgerTenancy, type AllocationTenancy } from '../rentAllocation.ts'
import type { SnapshotPayment } from '../snapshot.ts'

const FIRST_ID = ''
const LAST_ID = '￿'

export function designationChangesNothing(
  t: AllocationTenancy & { id: string },
  objectPayments: readonly SnapshotPayment[],
  incoming: { date: string; amountCents: number },
  month: string,
): boolean {
  const year = Number(incoming.date.slice(0, 4))
  const view = (id: string, designatedMonth: string | null): string => {
    const added: SnapshotPayment = { id, tenancyId: t.id, date: incoming.date, amountCents: incoming.amountCents, kind: 'rent', ...(designatedMonth ? { designatedMonth } : {}) }
    const all = [...objectPayments, added]
    const slices = allocateRentPayments(ledgerTenancy(t, all, year), all.filter((p) => p.tenancyId === t.id))
    return JSON.stringify({ start: ledgerStartOf(t, all, year), slices })
  }
  return [FIRST_ID, LAST_ID].every((id) => view(id, null) === view(id, month))
}
