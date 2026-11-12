// Kautionsbuchungen lesen und schreiben (#228). Die Prüfungen stehen hier, vor jedem Schreiben: Betrag größer 0, ein
// Kalendertag, der Zweck genau bei einer Verrechnung, und der Stand fällt an keinem Tag unter 0 (`depositProblem` über
// die Buchungen des Mietverhältnisses **nach** der gedachten Änderung, auch beim Ändern und Löschen eines Eingangs).
// Der Stand selbst wird nie gespeichert (shared/deposit.ts). Mietkonto und Steuer lesen diese Tabelle nicht.
import { eq } from 'drizzle-orm'
import type { Database, Executor } from './client.ts'
import { retitleCurrentGroup } from './journal.ts'
import { readDepositEntries } from './read.ts'
import { isCalendarDay } from './repository.ts'
import { DEPOSIT_ENTRY_KINDS, DEPOSIT_PURPOSES, depositEntries, tenancies, units } from './schema.ts'
import { depositProblem } from '../../../shared/deposit.ts'
import { germanDate } from '../../../shared/law/register.ts'
import type { DepositEntry, DepositEntryKind, DepositPurpose } from '../../../shared/types.ts'

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
// liest Teil 1 nicht: Eine Zahlung hängt erst die Verrechnung mit Miete oder Abrechnung an (Teil 2).
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
    // Teil 1 von #228: Die Verrechnung mit Miete oder Abrechnung legt eine Zahlung an und kommt mit Teil 2.
    if (purpose === 'rent' || purpose === 'settlement') throw new DepositError(400, 'Zweck der Verrechnung ist Schaden oder Sonstiges.')
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
    ...(current?.paymentId && purpose ? { paymentId: current.paymentId } : {}),
    ...(note ? { note } : {}),
  }
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

async function insertIn(db: Executor, id: string, body: unknown, pending: DepositEntry[]): Promise<DepositEntry> {
  const after = mergeEntry(null, id, body)
  if ((await propertyOfTenancy(db, after.tenancyId)) === null) {
    throw new DepositError(404, 'Dieses Mietverhältnis gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  }
  pending.push(after)
  guardBalance(pending.filter((e) => e.tenancyId === after.tenancyId))
  await db.insert(depositEntries).values(rowOf(after))
  return after
}

export async function createDepositEntry(db: Database, body: unknown, newId: () => string): Promise<DepositEntry> {
  return insertIn(db, newId(), body, await readDepositEntries(db))
}

// Mehrere Buchungen in einer Transaktion, ganz oder gar nicht, mit einem Satz im Verlauf (für den Kontoauszug, #188;
// Muster `insertPayments`). Ergibt die Kennungen in der Reihenfolge der Rümpfe.
export async function insertDepositEntries(db: Database, bodies: readonly unknown[], newId: () => string, title: string): Promise<string[]> {
  const ids = bodies.map(() => newId())
  await db.transaction(async (tx) => {
    const pending = await readDepositEntries(tx)
    for (const [i, body] of bodies.entries()) await insertIn(tx, ids[i] ?? newId(), body, pending)
    if (bodies.length > 0) await retitleCurrentGroup(tx, title)
  })
  return ids
}

export async function updateDepositEntry(db: Database, id: string, body: unknown): Promise<DepositEntry | null> {
  const all = await readDepositEntries(db)
  const before = all.find((e) => e.id === id)
  if (!before) return null
  const after = mergeEntry(before, id, body)
  guardBalance(all.filter((e) => e.tenancyId === after.tenancyId).map((e) => (e.id === id ? after : e)))
  const { id: _id, ...rest } = rowOf(after)
  await db.update(depositEntries).set(rest).where(eq(depositEntries.id, id))
  return after
}

export async function removeDepositEntry(db: Database, id: string): Promise<boolean> {
  const all = await readDepositEntries(db)
  const before = all.find((e) => e.id === id)
  if (!before) return false
  guardBalance(all.filter((e) => e.tenancyId === before.tenancyId && e.id !== id))
  await db.delete(depositEntries).where(eq(depositEntries.id, id))
  return true
}
