// „Offene Monate als bezahlt erfassen“ im Mietkonto (#608): Wer Mieten von Hand pflegt, erfasst pünktliche Mieten in
// einem Schritt, auch rückwirkend. Rein, ohne Datenbank; die Routen in index.ts lesen den Bestand und schreiben die
// Zahlungen (Muster der Belegbuchung: Vorschau mit Marke, angelegt wird nur mit ihr, sonst 409 mit neuer Vorschau).
//
// **Der Plan** liest das Mietkonto (`rentLedger`, dieselbe Zeile wie die Seite): je gewähltem Mietverhältnis und Monat von
// Januar bis „Bis Monat“ mit Soll eine Mietzahlung über den offenen Rest (Soll − gezahlt, dieselbe Zahl, die der Klick
// auf den Monat vorbelegt), für diesen Monat laut Verwendungszweck (§ 366 Abs. 1 BGB) und am Fälligkeitstag
// (`rentPaidOn`: höchstens der Monatsletzte und nie nach heute). Ein Monat vor dem Beginn der Erfassung (`notRecorded`)
// zählt mit dem ganzen Soll: Genau das ist „rückwirkend“. Ein später gedeckter Monat (`paidLaterOn`) nicht.
//
// **Die Nachprüfung** rechnet das Mietkonto mit den neuen Zahlungen noch einmal. Jeder geplante Monat, der danach nicht
// bezahlt ist, steht in `unresolved` (anlegen bleibt erlaubt, die Oberfläche sagt es). Weil das Konto eines Objekts mit
// seiner frühesten erfassten Mietzahlung beginnt (rentAllocation.ts, `recordingStart`), können rückwirkende Zahlungen
// Monate neu zählen lassen, die vorher nicht erfasst waren: bei nicht gewählten Mietverhältnissen und bei gewählten nach
// „Bis Monat“. Wo danach ein Monat außerhalb des Plans schlechter steht oder der Rückstand steigt, nennt `othersAffected`
// das Mietverhältnis mit dem Rückstand vorher und nachher. Beides fließt in die Marke.
import { createHash } from 'node:crypto'
import type { MarkPaidAffected, MarkPaidPayment, MarkPaidPlan, MarkPaidUnresolved, Payment, RentLedger, RentMonthStatus } from '../../shared/types.ts'
import { FIRST_YEAR, rentDueOn, rentPaidOn } from '../../shared/rentDue.ts'
import { parsePeriodKey } from '../../shared/period.ts'
import { rentLedger, type LedgerOptions } from './calc.ts'
import type { Snapshot, SnapshotPayment } from './snapshot.ts'

export type MarkPaidRequest = { tenancyIds: string[], through: string }
export type MarkPaidPlanBody = Omit<MarkPaidPlan, 'token'>
export const MARK_PAID_NOTE = 'als bezahlt erfasst'

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const monthOf = (year: number, month: number): string => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`

// Der Rumpf einer Anfrage, geprüft (400 mit Satz für den Nutzer): „Bis Monat“ ein Monat im Jahr der Ansicht und nicht nach
// dem laufenden Monat, die Mietverhältnisse nicht leer und jedes eines dieses Objekts (`known`).
export function markPaidRequestOf(year: number, body: unknown, today: string, known: ReadonlySet<string>): { request: MarkPaidRequest } | { error: string } {
  const raw = body !== null && typeof body === 'object' ? body : {}
  const ids: unknown = Reflect.get(raw, 'tenancyIds')
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x): x is string => typeof x === 'string' && x !== '')) {
    return { error: 'Wählen Sie mindestens ein Mietverhältnis, dessen Monate als bezahlt erfasst werden.' }
  }
  if (ids.some((id) => !known.has(id))) return { error: 'Ein gewähltes Mietverhältnis gehört nicht zu diesem Objekt. Bitte laden Sie die Seite neu.' }
  const through: unknown = Reflect.get(raw, 'through')
  if (typeof through !== 'string' || !MONTH.test(through) || parsePeriodKey(through) === null) {
    return { error: '„Bis Monat“ braucht die Form JJJJ-MM, etwa 2025-03.' }
  }
  if (Number(through.slice(0, 4)) !== year) return { error: `„Bis Monat“ muss im Jahr ${year} liegen.` }
  if (through > today.slice(0, 7)) return { error: '„Bis Monat“ darf nicht nach dem laufenden Monat liegen; künftige Mieten erfassen Sie, wenn sie eingegangen sind.' }
  return { request: { tenancyIds: [...new Set(ids)], through } }
}

// Der Fälligkeitstag des Monats wie im Mietkonto (Land des Objekts, ohne Land der späteste aller Länder); vor 1995 kennt
// Mietfuchs keine Feiertage, dann der Monatserste.
function dueDateOf(snapshot: Snapshot, tenancyId: string, month: string): string {
  const t = snapshot.tenancies.find((x) => x.id === tenancyId)
  if (!t || Number(month.slice(0, 4)) < FIRST_YEAR) return `${month}-01`
  try {
    return rentDueOn(t, month, snapshot.property?.state ?? null)
  } catch {
    // Ein fester Tag ohne Angabe des Tages (krumm, nicht kaputt): der Monatserste.
    return `${month}-01`
  }
}

// Was nach den neuen Zahlungen schlechter steht als vorher: offen oder teilweise statt bezahlt, nicht erfasst oder
// noch nicht fällig.
const worse = (before: RentMonthStatus, after: RentMonthStatus): boolean =>
  (after === 'open' || after === 'partial') && before !== 'open' && (before !== 'partial' || after === 'open')

type Account = { tenancyId: string, tenantName: string, unitName: string, arrearsCents: number }
const accountsOf = (l: RentLedger): Map<string, Account> => new Map([
  ...l.rows.map((r): [string, Account] => [r.tenancyId, r]),
  ...l.carriedOnly.map((r): [string, Account] => [r.tenancyId, { ...r, arrearsCents: r.openCents }]),
])

// Ein Jahr des Mietkontos, wie die Route es rechnet (Schnappschuss und Optionen des Jahres).
export type LedgerView = { snapshot: Snapshot, options: LedgerOptions & { asOf: string } }

// Vergleich eines Jahres vorher und nachher, je Mietverhältnis außerhalb der geplanten Monate. Im Jahr der Ansicht zählt
// ein steigender Rückstand nur bei nicht gewählten Mietverhältnissen (bei gewählten sinkt er durch den Plan und steigt
// höchstens durch Monate außerhalb des Plans, die der Vergleich je Monat sieht); in späteren Jahren bei allen.
function affectedIn(before: RentLedger, after: RentLedger, planned: ReadonlySet<string>, chosen: ReadonlySet<string>, requestYear: boolean): MarkPaidAffected[] {
  const beforeAccounts = accountsOf(before)
  return [...accountsOf(after).values()].flatMap((a): MarkPaidAffected[] => {
    const prevRow = before.rows.find((r) => r.tenancyId === a.tenancyId)
    const row = after.rows.find((r) => r.tenancyId === a.tenancyId)
    let recorded = false
    let changed = false
    for (const [k, mo] of (row?.months ?? []).entries()) {
      const was = prevRow?.months[k]
      if (!was || planned.has(`${a.tenancyId}/${monthOf(after.year, mo.month)}`)) continue
      if (was.status === 'notRecorded' && mo.status !== 'notRecorded') {
        recorded = true
        if (mo.status === 'open' || mo.status === 'partial') changed = true
      } else if (worse(was.status, mo.status) || (was.status !== 'notRecorded' && mo.paidCents > was.paidCents)) {
        changed = true
      }
    }
    const beforeCents = beforeAccounts.get(a.tenancyId)?.arrearsCents ?? 0
    const risen = a.arrearsCents > beforeCents && (!requestYear || !chosen.has(a.tenancyId))
    if (!changed && !risen) return []
    return [{ tenancyId: a.tenancyId, tenantName: a.tenantName, unitName: a.unitName, year: after.year, reason: recorded ? 'recordingStart' : 'shifted', beforeCents, afterCents: a.arrearsCents }]
  })
}

// `later`: das Mietkonto eines späteren Jahres (bis zum Jahr von heute) für die Nachprüfung; ohne Angabe derselbe
// Schnappschuss mit dem anderen Jahr und ohne Abrechnungen (die nur einteilen, was nicht mehr einzeln einforderbar ist).
export function planMarkPaid(snapshot: Snapshot, options: LedgerOptions & { asOf: string }, request: MarkPaidRequest, later?: (year: number) => LedgerView): MarkPaidPlanBody {
  const before = rentLedger(snapshot, options)
  const chosen = new Set(request.tenancyIds)
  const last = Number(request.through.slice(5, 7))
  const payments: MarkPaidPayment[] = []
  for (const row of before.rows) {
    if (!chosen.has(row.tenancyId)) continue
    for (const mo of row.months) {
      // Noch nicht fällig (Durchsicht S2): nicht eingegangen, nur weil der Monat begonnen hat.
      if (mo.month > last || mo.sollCents <= 0 || mo.paidLaterOn || mo.status === 'notDue') continue
      const month = monthOf(before.year, mo.month)
      // Vor dem Beginn der Erfassung (Durchsicht S1): das Soll abzüglich der Mietzahlungen, die diesen Monat laut
      // Verwendungszweck nennen (bisher in `designatedOutside`); sie gelten danach für ihn.
      const designated = snapshot.payments
        .filter((p) => p.tenancyId === row.tenancyId && (p.kind ?? 'rent') === 'rent' && p.designatedMonth === month)
        .reduce((x, p) => x + p.amountCents, 0)
      const rest = mo.status === 'notRecorded' ? mo.sollCents - designated : mo.sollCents - mo.paidCents
      if (rest <= 0) continue
      payments.push({
        tenancyId: row.tenancyId, tenantName: row.tenantName, unitName: row.unitName, month,
        date: rentPaidOn(month, dueDateOf(snapshot, row.tenancyId, month), options.asOf), amountCents: rest,
      })
    }
  }
  const totalCents = payments.reduce((a, p) => a + p.amountCents, 0)
  if (payments.length === 0) return { payments, totalCents, unresolved: [], othersAffected: [] }

  // Nachprüfung auf dem Schnappschuss mit den neuen Zahlungen.
  const added: SnapshotPayment[] = payments.map((p, i) => ({ id: `markpaid-${String(i).padStart(4, '0')}`, tenancyId: p.tenancyId, date: p.date, amountCents: p.amountCents, kind: 'rent', designatedMonth: p.month }))
  const withAdded = (s: Snapshot): Snapshot => ({ ...s, payments: [...s.payments, ...added] })
  const after = rentLedger(withAdded(snapshot), options)
  const planned = new Set(payments.map((p) => `${p.tenancyId}/${p.month}`))
  const unresolved: MarkPaidUnresolved[] = payments.flatMap((p) => {
    const row = after.rows.find((r) => r.tenancyId === p.tenancyId)
    const mo = row?.months[Number(p.month.slice(5, 7)) - 1]
    if (!row || !mo || mo.status === 'paid') return []
    return [{ tenancyId: p.tenancyId, tenantName: p.tenantName, unitName: p.unitName, month: p.month, status: mo.status, openCents: mo.openPrepaymentCents + mo.openRentCents }]
  })
  const othersAffected = affectedIn(before, after, planned, chosen, true)
  // Durchsicht M1: Der frühere Beginn der Erfassung gilt auch für die Jahre danach, bis heute.
  const viewOf = later ?? ((y: number): LedgerView => ({
    snapshot: { ...snapshot, year: y },
    options: { asOf: options.asOf, ...(options.holidaysChecked ? { holidaysChecked: options.holidaysChecked } : {}) },
  }))
  for (let y = before.year + 1; y <= Number(options.asOf.slice(0, 4)); y++) {
    const view = viewOf(y)
    othersAffected.push(...affectedIn(rentLedger(view.snapshot, view.options), rentLedger(withAdded(view.snapshot), view.options), planned, chosen, false))
  }
  return { payments, totalCents, unresolved, othersAffected }
}

// Die Marke über Anfrage und Plan: Ändert sich der Bestand, die Wahl oder „Bis Monat“, ändert sie sich.
export function markPaidToken(request: MarkPaidRequest, plan: MarkPaidPlanBody): string {
  const source = JSON.stringify({ tenancyIds: [...request.tenancyIds].sort(), through: request.through, plan })
  return createHash('sha256').update(source).digest('hex').slice(0, 32)
}

// Der Satz im Verlauf, mit der Zahl.
export const markPaidTitle = (count: number): string => (count === 1 ? 'Eine Mietzahlung als bezahlt erfasst' : `${count} Mietzahlungen als bezahlt erfasst`)

// Die Rümpfe für das Anlegen, je geplantem Monat eine Mietzahlung (dieselben Prüfungen wie POST /api/payments).
export type MarkPaidWrite = Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind' | 'note'> & { designatedMonth: string }
export function markPaidWrites(payments: readonly MarkPaidPayment[]): MarkPaidWrite[] {
  return payments.map((p) => ({ tenancyId: p.tenancyId, date: p.date, amountCents: p.amountCents, kind: 'rent', designatedMonth: p.month, note: MARK_PAID_NOTE }))
}
