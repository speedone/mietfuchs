// Kautionsbuchungen lesen und schreiben (#228). Die Prüfungen stehen hier, vor jedem Schreiben: Betrag größer 0, ein
// Kalendertag, der Zweck genau bei einer Verrechnung, und der Stand fällt an keinem Tag unter 0 (`depositProblem` über
// die Buchungen des Mietverhältnisses **nach** der gedachten Änderung, auch beim Ändern und Löschen eines Eingangs).
// Der Stand selbst wird nie gespeichert (shared/deposit.ts). Mietkonto und Steuer lesen diese Tabelle nicht.
//
// Eine Verrechnung mit Mietrückstand oder Nachzahlung (Zweck `rent`/`settlement`) legt in derselben Transaktion eine
// **gebundene Zahlung** an (Entwurf, „Verrechnung … erzeugt eine Zahlung“): Wirtschaftlich hat der Vermieter an dem Tag
// Miete bzw. die Nachzahlung erhalten. Mietkonto und Steuer zählen sie über den vorhandenen Weg der Zahlungen, ohne
// eigene Regel. Die Buchung hält die Zahlung in `payment_id`; Betrag, Datum und Art ändert nur sie (repository.ts,
// `BoundPaymentError`). Fällt die Zahlung weg, fällt die Buchung mit (Fremdschlüssel), und umgekehrt löscht diese
// Datei die Zahlung.
import { eq } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import { retitleCurrentGroup } from './journal.ts'
import { linkedTargetRefusal, signedDeposit } from './bankGuard.ts'
import { readClosedHeatingSettlements, readClosedSettlements, readDepositEntries, readHeatingPlants } from './read.ts'
import { insertEntityIn, isCalendarDay, replaceBoundPaymentIn, rulesForProperty } from './repository.ts'
import { bankTransactionLinks, DEPOSIT_ENTRY_KINDS, DEPOSIT_PURPOSES, depositEntries, payments, tenancies, unitNoConnection, units } from './schema.ts'
import { plantRules, servesUnit, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { depositProblem } from '../../../shared/deposit.ts'
import { periodLabel, periodsBetween, settlementDeadline } from '../../../shared/period.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { DepositEntry, DepositEntryKind, DepositPurpose, DepositStatementInfo, TaxReport } from '../../../shared/types.ts'

// Eine Ablehnung, deren Satz schon für den Nutzer geschrieben ist; die Fehlerbehandlung in index.ts gibt Status und
// Satz weiter.
export class DepositError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

const NOTE_MAX = 500
const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const fieldOf = (body: unknown, key: string): { given: boolean; value: unknown } =>
  typeof body === 'object' && body !== null && Object.hasOwn(body, key) ? { given: true, value: Reflect.get(body, key) } : { given: false, value: undefined }

async function propertyOfTenancy(db: Executor, tenancyId: string): Promise<string | null> {
  const [row] = await db.select({ propertyId: units.propertyId }).from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(eq(tenancies.id, tenancyId))
  return row?.propertyId ?? null
}

// Der Rumpf über den bisherigen Stand gelegt (ein Teilrumpf lässt stehen, was er nicht nennt) und geprüft. `paymentId`
// kommt nie aus dem Rumpf: Die gebundene Zahlung legt diese Datei selbst an und hängt sie an.
function mergeEntry(current: DepositEntry | null, id: string, body: unknown): DepositEntry {
  const tenancy = fieldOf(body, 'tenancyId')
  const tenancyId = tenancy.given ? (typeof tenancy.value === 'string' ? tenancy.value : '') : (current?.tenancyId ?? '')
  if (current && tenancyId !== current.tenancyId) {
    throw new DepositError(400, 'Eine Kautionsbuchung wechselt nicht in ein anderes Mietverhältnis. Legen Sie sie dort bitte neu an und löschen Sie diese.')
  }

  const dateField = fieldOf(body, 'date')
  const date = dateField.given ? dateField.value : current?.date
  if (typeof date !== 'string' || !isCalendarDay(date)) throw new DepositError(400, 'Das Datum der Kautionsbuchung fehlt oder ist kein Datum. Bitte wählen Sie es im Kalender.')

  const kindField = fieldOf(body, 'kind')
  const kindRaw = kindField.given ? kindField.value : current?.kind
  const kind: DepositEntryKind | undefined = DEPOSIT_ENTRY_KINDS.find((k) => k === kindRaw)
  if (!kind) throw new DepositError(400, 'Unbekannte Art der Kautionsbuchung. Möglich sind Eingang, Ertrag, Verrechnung und Rückzahlung.')

  const amountField = fieldOf(body, 'amountCents')
  const amountCents = amountField.given ? amountField.value : current?.amountCents
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new DepositError(400, 'Betrag der Kautionsbuchung ist ein Betrag größer als 0.')
  }

  const purposeField = fieldOf(body, 'purpose')
  const purposeGiven = purposeField.given && purposeField.value !== null && purposeField.value !== undefined && purposeField.value !== ''
  let purpose: DepositPurpose | undefined
  if (kind === 'applied') {
    purpose = DEPOSIT_PURPOSES.find((p) => p === (purposeField.given ? purposeField.value : current?.purpose))
    if (!purpose) throw new DepositError(400, 'Bitte geben Sie an, womit Sie verrechnen.')
  } else if (purposeGiven) {
    throw new DepositError(400, 'Einen Zweck gibt es nur bei einer Verrechnung. Bitte wählen Sie die Art „Verrechnung“ oder lassen Sie den Zweck leer.')
  }

  const noteField = fieldOf(body, 'note')
  const noteRaw = noteField.given ? noteField.value : current?.note
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : ''
  if (note.length > NOTE_MAX) throw new DepositError(400, `Die Notiz ist zu lang (höchstens ${NOTE_MAX} Zeichen).`)

  return {
    id, tenancyId, date, kind, amountCents,
    ...(purpose ? { purpose } : {}),
    ...(note ? { note } : {}),
  }
}

// Eine als Miete gebuchte Kaution umbuchen (#228, Hinweis „Ist das die Kaution?“ der Seite Steuer): Die Mietzahlung
// fällt weg, ein Eingang mit Datum, Betrag und Notiz entsteht, in einer Transaktion. Nur ein Mieteingang (Art Miete,
// Betrag über 0, nicht aus einer Verrechnung); `null`, wenn es die Zahlung nicht gibt.
export async function moveToDeposit(db: Database, paymentId: string, newId: () => string): Promise<DepositEntry | null> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId))
    if (!p) return null
    const [bound] = await tx.select({ id: depositEntries.id }).from(depositEntries).where(eq(depositEntries.paymentId, paymentId))
    if (p.kind !== 'rent' || p.amountCents <= 0 || bound) throw new DepositError(400, 'Umbuchen lässt sich nur ein Mieteingang.')
    // Hängt die Zahlung an einem Kontoumsatz (#188), wandert die Zuordnung auf den neuen Eingang (Durchsicht C2); sonst
    // nähme der Fremdschlüssel sie mit, und der Umsatz stünde wieder offen als Miete zum Buchen da.
    const [link] = await tx.select().from(bankTransactionLinks).where(eq(bankTransactionLinks.paymentId, paymentId))
    await tx.delete(payments).where(eq(payments.id, paymentId))
    // Die Notiz einer Zahlung ist unbegrenzt, die einer Buchung nicht; gekürzt statt abgelehnt, denn auf der Seite Steuer
    // ließe sie sich nicht ändern (Durchsicht G5).
    const note = p.note ? p.note.trim().slice(0, NOTE_MAX) : ''
    const entry = await insertIn(tx, newId(), { tenancyId: p.tenancyId, date: p.date, kind: 'received', amountCents: p.amountCents, ...(note ? { note } : {}) }, await readDepositEntries(tx), newId)
    if (link) await tx.insert(bankTransactionLinks).values({ id: link.id, transactionId: link.transactionId, paymentId: null, depositEntryId: entry.id, created: link.created })
    return entry
  })
}

// Nie negativ: an keinem Tag kann mehr verrechnet oder ausgezahlt sein, als bis dahin eingegangen ist.
function guardBalance(after: readonly DepositEntry[]): void {
  const problem = depositProblem(after)
  if (problem) throw new DepositError(400, `Mehr als die Kaution hergibt: Am ${germanDate(problem.date)} fehlten ${euro(-problem.balanceCents)}.`)
}

const rowOf = (e: DepositEntry) => ({
  id: e.id, tenancyId: e.tenancyId, date: e.date, kind: e.kind, amountCents: e.amountCents,
  purpose: e.purpose ?? null, paymentId: e.paymentId ?? null, note: e.note ?? null,
})

export async function listDepositEntries(db: Executor, propertyId: string): Promise<DepositEntry[]> {
  const inProperty = new Set(
    (await db.select({ id: tenancies.id }).from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(eq(units.propertyId, propertyId))).map((r) => r.id),
  )
  return (await readDepositEntries(db)).filter((e) => inProperty.has(e.tenancyId))
}

// Legt eine Verrechnung mit Miete oder Abrechnung eine Zahlung an? Dann mit welcher Art.
const boundKind = (e: Pick<DepositEntry, 'kind' | 'purpose'>): 'rent' | 'settlement' | null =>
  e.kind === 'applied' && (e.purpose === 'rent' || e.purpose === 'settlement') ? e.purpose : null
export const BOUND_PAYMENT_NOTE = 'Aus der Kaution verrechnet'

// Die gebundene Zahlung anlegen, durch denselben Weg wie POST /api/payments.
async function insertBoundPayment(tx: Executor, e: DepositEntry, kind: 'rent' | 'settlement', newId: () => string): Promise<string> {
  const paymentId = newId()
  await insertEntityIn(tx, 'payments', paymentId, { tenancyId: e.tenancyId, date: e.date, amountCents: e.amountCents, kind, note: BOUND_PAYMENT_NOTE })
  return paymentId
}

async function insertIn(db: Executor, id: string, body: unknown, pending: DepositEntry[], newId: () => string): Promise<DepositEntry> {
  const merged = mergeEntry(null, id, body)
  if ((await propertyOfTenancy(db, merged.tenancyId)) === null) {
    throw new DepositError(404, 'Dieses Mietverhältnis gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  }
  pending.push(merged)
  guardBalance(pending.filter((e) => e.tenancyId === merged.tenancyId))
  const kind = boundKind(merged)
  const after = kind ? { ...merged, paymentId: await insertBoundPayment(db, merged, kind, newId) } : merged
  await db.insert(depositEntries).values(rowOf(after))
  return after
}

// Buchungen mit vorgegebenen Kennungen innerhalb einer laufenden Transaktion (Kontoauszug, #188: die Kennung kommt in
// den Link). Dieselben Prüfungen wie eine einzelne Buchung, der Stand über alle zusammen.
export async function insertDepositEntriesIn(tx: Executor, items: readonly { id: string; body: unknown }[], newId: () => string): Promise<void> {
  const pending = await readDepositEntries(tx)
  for (const { id, body } of items) await insertIn(tx, id, body, pending, newId)
}

export async function createDepositEntry(db: Database, body: unknown, newId: () => string): Promise<DepositEntry> {
  return db.transaction(async (tx) => insertIn(tx, newId(), body, await readDepositEntries(tx), newId))
}

// Mehrere Buchungen in einer Transaktion, ganz oder gar nicht, mit einem Satz im Verlauf (für den Kontoauszug, #188;
// Muster `insertPayments`). Ergibt die Kennungen in der Reihenfolge der Rümpfe.
export async function insertDepositEntries(db: Database, bodies: readonly unknown[], newId: () => string, title: string): Promise<string[]> {
  const ids = bodies.map(() => newId())
  await db.transaction(async (tx) => {
    const pending = await readDepositEntries(tx)
    for (const [i, body] of bodies.entries()) await insertIn(tx, ids[i] ?? newId(), body, pending, newId)
    if (bodies.length > 0) await retitleCurrentGroup(tx, title)
  })
  return ids
}

// Eine gebundene Zahlung folgt ihrer Verrechnung: Betrag, Datum und Art ziehen mit; wird aus der Verrechnung mit Miete
// oder Abrechnung eine mit Schaden oder Sonstigem (oder eine andere Art), fällt die Zahlung weg; umgekehrt entsteht sie.
export async function updateDepositEntry(db: Database, id: string, body: unknown, newId: () => string): Promise<DepositEntry | null> {
  return db.transaction(async (tx) => {
    const all = await readDepositEntries(tx)
    const before = all.find((e) => e.id === id)
    if (!before) return null
    const merged = mergeEntry(before, id, body)
    guardBalance(all.filter((e) => e.tenancyId === merged.tenancyId).map((e) => (e.id === id ? merged : e)))
    // Einem Kontoumsatz zugeordnet (#188): senken ja, über den Umsatz heben, die Richtung wechseln oder umhängen nicht.
    const refusal = await linkedTargetRefusal(tx, { depositEntryId: id }, before, { tenancyId: merged.tenancyId, kind: merged.kind, cents: signedDeposit(merged.kind, merged.amountCents) })
    if (refusal) throw new DepositError(409, refusal)
    const kind = boundKind(merged)
    let after: DepositEntry = merged
    if (before.paymentId && kind) {
      // Eine Zahlung aus der Abrechnung gilt keinem Monat (repository.ts); der Monat laut Verwendungszweck fällt dann weg.
      await replaceBoundPaymentIn(tx, before.paymentId, { date: merged.date, amountCents: merged.amountCents, kind, ...(kind === 'settlement' ? { designatedMonth: null } : {}) })
      after = { ...merged, paymentId: before.paymentId }
    } else if (!before.paymentId && kind) {
      after = { ...merged, paymentId: await insertBoundPayment(tx, merged, kind, newId) }
    }
    const { id: _id, ...rest } = rowOf(after)
    await tx.update(depositEntries).set(rest).where(eq(depositEntries.id, id))
    // Erst nach dem Lösen des Verweises: Sonst nähme der Fremdschlüssel die Buchung mit.
    if (before.paymentId && !kind) await tx.delete(payments).where(eq(payments.id, before.paymentId))
    return after
  })
}

export async function removeDepositEntry(db: Executor, id: string): Promise<boolean> {
  const all = await readDepositEntries(db)
  const before = all.find((e) => e.id === id)
  if (!before) return false
  guardBalance(all.filter((e) => e.tenancyId === before.tenancyId && e.id !== id))
  // Mit der gebundenen Zahlung: Ihr Löschen nimmt die Buchung über den Fremdschlüssel mit, beides in einem Schritt.
  if (before.paymentId) await db.delete(payments).where(eq(payments.id, before.paymentId))
  else await db.delete(depositEntries).where(eq(depositEntries.id, id))
  return true
}

// Für die Aufstellung zum Auszug (#228): je Mietverhältnis des Objekts die jüngste abgeschlossene Abrechnung, in der es
// steht, mit ihrem Saldo, und die Zeiträume seiner Wohnzeit, die noch nicht abgeschlossen sind und deren
// Abrechnungsfrist (§ 556 Abs. 3 Satz 2 BGB, `settlementDeadline`) heute noch läuft. Für ältere ist eine Nachforderung
// in der Regel ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB, außer die Verspätung ist nicht zu vertreten); sie als „steht noch aus“ zu nennen, läse sich auf dem Blatt für den Mieter wie eine offene Forderung
// (Durchsicht W1: Einzug 2012, erst seit Kurzem mit Mietfuchs abgerechnet). Gelesen aus dem
// eingefrorenen Stand, also das, was der Mieter bekommen hat; nichts wird neu gerechnet.
//
// Getrennt abgerechnete Heizperioden einer Anlage (Weg d, docs/heizung.md) haben eigene Abrechnung, Frist und Abschluss;
// sie stehen als „Heizkosten …“ unter dem Ausstehenden und mit ihrem Saldo in `lastHeating`, wenn die Anlage die Wohnung
// versorgt und der Mieter die Heizung abgerechnet bekommt. `openRent`: was laut Mietkonto heute offen ist, je
// Mietverhältnis (index.ts rechnet es mit dem Mietkonto des laufenden Jahres).
export async function depositStatements(db: Executor, propertyId: string, today: string, openRent: ReadonlyMap<string, number> = new Map()): Promise<DepositStatementInfo[]> {
  const rules = await rulesForProperty(db, propertyId)
  const closed = (await readClosedSettlements(db)).filter((c) => c.propertyId === propertyId)
  const plants = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
  const closedHeating = await readClosedHeatingSettlements(db)
  const noHeat = new Set((await db.select({ unitId: unitNoConnection.unitId }).from(unitNoConnection).where(eq(unitNoConnection.meterType, 'waerme'))).map((r) => r.unitId))
  const rows = await db.select({ id: tenancies.id, start: tenancies.start, end: tenancies.end, costModel: tenancies.costModel, heatingModel: tenancies.heatingModel, unitId: units.id, parentUnitId: units.parentUnitId }).from(tenancies)
    .innerJoin(units, eq(tenancies.unitId, units.id)).where(eq(units.propertyId, propertyId))
  return rows.map((t) => {
    // Bekommt der Mieter gar keine Abrechnung (Pauschale oder Inklusivmiete für Kaltes und Heizung, Heizung auch
    // „heizt selbst“), steht nichts aus (Abschlussdurchsicht W1). Ohne Angabe gilt Abrechnung, wie in calc.ts.
    const heatingSettles = (t.heatingModel ?? 'settlement') === 'settlement'
    const settles = (t.costModel ?? 'settlement') === 'settlement' || heatingSettles
    const to = t.end ?? today
    let last: DepositStatementInfo['last'] = null
    const pending: string[] = []
    for (const p of periodsBetween(rules, t.start, to)) {
      const frozen = closed.find((c) => c.period === p.key)
      if (!frozen) {
        if (settles && settlementDeadline(p) >= today) pending.push(periodLabel(p))
        continue
      }
      const balance = balanceOf(frozen.settlement, t.id)
      if (balance !== null) last = { label: periodLabel(p), balanceCents: balance }
    }
    let lastHeating: DepositStatementInfo['lastHeating'] = null
    let lastHeatingTo = ''
    const unit = { id: t.unitId, parentUnitId: t.parentUnitId, ...(noHeat.has(t.unitId) ? { noConnection: ['waerme' as const] } : {}) }
    for (const plant of plants) {
      if (!servesUnit(plant, unit)) continue
      for (const h of periodsBetween(plantRules(plant, rules), t.start, to)) {
        if (!settledSeparately(plant, rules, h)) continue
        const frozen = closedHeating.find((c) => c.plantId === plant.id && c.period === h.key)
        if (!frozen) {
          if (heatingSettles && settlementDeadline(h) >= today) pending.push(`Heizkosten ${periodLabel(h)}`)
          continue
        }
        const balance = balanceOf(frozen.settlement, t.id)
        if (balance !== null && h.to > lastHeatingTo) {
          lastHeating = { label: periodLabel(h), balanceCents: balance }
          lastHeatingTo = h.to
        }
      }
    }
    return { tenancyId: t.id, last, lastHeating, pending, openRentCents: openRent.get(t.id) ?? 0 }
  })
}

// Der Hinweis „Ist das die Kaution?“ der Steuer (calc.ts, `possibleDeposits`) kennt die Kautionsbuchungen nicht. Eine
// Mietzahlung, die aus einer Verrechnung stammt, ist sicher nicht die Kaution; sie fällt hier heraus, bevor die Seite
// sie zum Umbuchen anbietet (das endete sonst mit einer Meldung).
export async function withoutBoundDeposits(db: Executor, report: TaxReport): Promise<TaxReport> {
  const received = report.income.received
  if (!received || received.possibleDeposits.length === 0) return report
  const bound = new Set((await readDepositEntries(db)).flatMap((e) => (e.paymentId ? [e.paymentId] : [])))
  return { ...report, income: { ...report.income, received: { ...received, possibleDeposits: received.possibleDeposits.filter((d) => !bound.has(d.paymentId)) } } }
}

// Der Saldo eines Mietverhältnisses im eingefrorenen Stand, vorsichtig gelesen: Er kann aus einer älteren Version stammen.
function balanceOf(settlement: unknown, tenancyId: string): number | null {
  const statements = settlement !== null && typeof settlement === 'object' ? Reflect.get(settlement, 'statements') : null
  if (!Array.isArray(statements)) return null
  let sum: number | null = null
  for (const st of statements) {
    if (st === null || typeof st !== 'object' || Reflect.get(st, 'tenancyId') !== tenancyId) continue
    const b = Reflect.get(st, 'balanceCents')
    if (typeof b === 'number') sum = (sum ?? 0) + b
  }
  return sum
}
