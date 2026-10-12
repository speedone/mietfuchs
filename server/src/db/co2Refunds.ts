// CO₂-Erstattungen an Mieter, die selbst heizen, lesen und schreiben (Heizung PR 19, #97). Die Prüfungen stehen
// hier, vor jedem Schreiben: eine Erstattung nur an einem Mietverhältnis mit „Mieter heizt selbst“ (Prüfung M4,
// § 6 Abs. 2 Satz 1 CO2KostAufG), verrechnet nur in einem Zeitraum des Objekts, in dem der Mieter wohnte, und nie in
// einem abgeschlossenen; eine dort verrechnete Erstattung bleibt, wie sie ist (Prüfung S9).
import { eq } from 'drizzle-orm'
import type { Database } from './client.ts'
import { co2Refunds, tenancies, units, CO2_RESTRICTIONS } from './schema.ts'
import { asNullableFilled, findClosedSettlement, HeatingError, ISO_DATE, merged, oneOfOrUndefined, PeriodError, rulesForProperty } from './repository.ts'
import { readCo2Refunds } from './read.ts'
import { parsePeriodKey, periodLabel, periodOfKey } from '../../../shared/period.ts'
import type { Co2Refund, PeriodKey } from '../../../shared/types.ts'
import { claimDeadline, refundDueDate, refundLawAt, refundProposal, type LawAsk, type RefundExclusion } from '../co2Refund.ts'
import { co2ApplicableFrom, co2FirstPeriodStart, co2HalfSplit, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable, halfSplitFirstDay } from '../../../shared/law/co2kostaufg.ts'
import { hkvDegreeDays } from '../../../shared/law/heizkostenv.ts'
import { coversDate, germanDate, valueAt, versionsIn } from '../../../shared/law/register.ts'

export type Co2RefundView = Co2Refund & {
  tenantName: string
  unitName: string
  settleLabel: string | null
  claimDeadline: string | null
  refundDue: string | null
  proposalCents: number | null
  proposalExcluded: RefundExclusion | null
}

// Die Rechtswerte ohne Protokoll, für die Liste (in der Abrechnung fragt calc.ts mit Protokoll).
const plainAsk: LawAsk = {
  applicable: (p) => valueAt(co2ApplicableFrom, p.from),
  stageTable: (p) => valueAt(co2StageTable, p.from),
  decimals: (p) => valueAt(co2RoundingDecimals, p.from),
  restriction: (p) => valueAt(co2Restriction, p.from),
  selfSupply: (d) => valueAt(co2SelfSupply, d),
  pieces: (p) => versionsIn(co2HalfSplit, p),
  degreeDays: (p) => valueAt(hkvDegreeDays, p.from),
}

async function tenancyInfo(db: Database, tenancyId: string) {
  const [row] = await db
    .select({ tenantName: tenancies.tenantName, start: tenancies.start, end: tenancies.end, heatingModel: tenancies.heatingModel, unitName: units.name, propertyId: units.propertyId })
    .from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(eq(tenancies.id, tenancyId))
  return row
}

export async function listRefunds(db: Database, propertyId: string): Promise<Co2RefundView[]> {
  const rules = await rulesForProperty(db, propertyId)
  const out: Co2RefundView[] = []
  for (const r of await readCo2Refunds(db)) {
    const t = await tenancyInfo(db, r.tenancyId)
    if (!t || t.propertyId !== propertyId) continue
    const self = coversDate(co2SelfSupply, r.supplierBilledAt) ? valueAt(co2SelfSupply, r.supplierBilledAt) : null
    const law = refundLawAt(r, plainAsk)
    const proposal = law ? refundProposal(r, law) : null
    const p = r.settlePeriod === null ? null : periodOfKey(rules, r.settlePeriod)
    out.push({
      ...r,
      tenantName: t.tenantName,
      unitName: t.unitName,
      settleLabel: p ? periodLabel(p) : null,
      claimDeadline: self ? claimDeadline(r.supplierBilledAt, self.claimMonths) : null,
      refundDue: self ? refundDueDate(r.claimedAt, self.refundMonths) : null,
      proposalCents: proposal?.cents ?? null,
      proposalExcluded: proposal?.excluded ?? null,
    })
  }
  return out
}

const emptyRefund = (id: string): Co2Refund => ({
  id, tenancyId: '', supplierBilledAt: '', claimedAt: '', amountCents: 0, settlePeriod: null, paidOutOn: null, billedFrom: null, billedTo: null,
  emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false, commercialUse: false, commercialMetered: false, nonResidential: false,
  restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
})
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
// Ein ungültiger Zeitraumschlüssel wird mit einem Satz abgelehnt, statt still verworfen.
const periodOrText = (v: unknown): PeriodKey | null => {
  const text = asNullableFilled(v)
  if (text === null) return null
  const key = parsePeriodKey(text)
  if (key === null) throw new PeriodError(`Den Zeitraum ${text} gibt es für dieses Objekt nicht. Bitte wählen Sie einen Abrechnungszeitraum des Objekts.`)
  return key
}

function mergeRefund(current: Co2Refund, body: unknown): Co2Refund {
  const next: Co2Refund = {
    id: current.id,
    tenancyId: merged(body, 'tenancyId', current.tenancyId, (v) => asNullableFilled(v) ?? ''),
    supplierBilledAt: merged(body, 'supplierBilledAt', current.supplierBilledAt, (v) => asNullableFilled(v) ?? ''),
    claimedAt: merged(body, 'claimedAt', current.claimedAt, (v) => asNullableFilled(v) ?? ''),
    amountCents: merged(body, 'amountCents', current.amountCents, (v) => nullableInt(v) ?? -1),
    settlePeriod: merged(body, 'settlePeriod', current.settlePeriod, periodOrText),
    paidOutOn: merged(body, 'paidOutOn', current.paidOutOn, asNullableFilled),
    billedFrom: merged(body, 'billedFrom', current.billedFrom, asNullableFilled),
    billedTo: merged(body, 'billedTo', current.billedTo, asNullableFilled),
    emissionsKg: merged(body, 'emissionsKg', current.emissionsKg, nullableNumber),
    co2CostCents: merged(body, 'co2CostCents', current.co2CostCents, nullableInt),
    areaM2: merged(body, 'areaM2', current.areaM2, nullableNumber),
    ownAppliances: merged(body, 'ownAppliances', current.ownAppliances, (v) => v === true),
    commercialUse: merged(body, 'commercialUse', current.commercialUse, (v) => v === true),
    commercialMetered: merged(body, 'commercialMetered', current.commercialMetered, (v) => v === true),
    nonResidential: merged(body, 'nonResidential', current.nonResidential, (v) => v === true),
    restriction: merged(body, 'restriction', current.restriction, (v) => oneOfOrUndefined(CO2_RESTRICTIONS, v) ?? 'none'),
    halfSplitFrom: merged(body, 'halfSplitFrom', current.halfSplitFrom, asNullableFilled),
    gridFeeCents: merged(body, 'gridFeeCents', current.gridFeeCents, nullableInt),
    bioCostCents: merged(body, 'bioCostCents', current.bioCostCents, nullableInt),
  }
  if (!next.commercialUse) next.commercialMetered = false
  return next
}

const CLOSED = (what: string) => `Diese Erstattung ist in einer abgeschlossenen Abrechnung verrechnet. Öffnen Sie die Abrechnung wieder, wenn Sie sie ${what} wollen.`

// Ist die Erstattung in einer abgeschlossenen Abrechnung verrechnet? Dann bleibt sie, wie sie ist (Prüfung S9).
async function settledInClosed(db: Database, r: Co2Refund): Promise<boolean> {
  if (r.settlePeriod === null) return false
  const t = await tenancyInfo(db, r.tenancyId)
  return t !== undefined && (await findClosedSettlement(db, t.propertyId, r.settlePeriod)) !== undefined
}

async function guardRefund(db: Database, after: Co2Refund): Promise<void> {
  const t = await tenancyInfo(db, after.tenancyId)
  if (!t) throw new HeatingError(400, 'Bitte wählen Sie das Mietverhältnis, dessen Mieter die Erstattung verlangt.')
  // Prüfung M4, Gegenprüfung M4: nur, wer sich selbst mit Wärme versorgt; sonst bekäme ein Mieter an der Heizung
  // des Vermieters seinen CO₂-Anteil doppelt gutgeschrieben.
  if (t.heatingModel !== 'selfSupply') {
    throw new HeatingError(400, `Eine CO₂-Erstattung nach § 6 Abs. 2 CO2KostAufG steht nur einem Mieter zu, der sich selbst mit Wärme versorgt, also den Brennstoff oder die Wärme über einen eigenen Vertrag bezieht. Stellen Sie in den Stammdaten bei ${t.tenantName} die Heizung auf „Mieter heizt selbst“, wenn das zutrifft.`)
  }
  for (const [value, what] of [[after.supplierBilledAt, 'Der Tag der Abrechnung des Lieferanten'], [after.claimedAt, 'Der Tag der Anzeige']] as const) {
    if (!ISO_DATE.test(value)) throw new HeatingError(400, `${what} fehlt oder ist kein Datum. Bitte wählen Sie ihn im Kalender.`)
  }
  for (const [value, what] of [[after.paidOutOn, 'Der Tag der Auszahlung'], [after.billedFrom, 'Der Beginn des Zeitraums'], [after.billedTo, 'Das Ende des Zeitraums'], [after.halfSplitFrom, 'Der Tag, ab dem § 5a gilt,']] as const) {
    if (value !== null && !ISO_DATE.test(value)) throw new HeatingError(400, `${what} ist kein Datum. Bitte wählen Sie ihn im Kalender.`)
  }
  if (after.claimedAt < after.supplierBilledAt) throw new HeatingError(400, 'Die Anzeige des Mieters kann nicht vor der Abrechnung des Lieferanten liegen.')
  // § 11 Abs. 2 CO2KostAufG: Vor dem ersten Zeitraum der Aufteilung gibt es keine CO₂-Kosten aufzuteilen.
  if (!coversDate(co2SelfSupply, after.supplierBilledAt)) {
    throw new HeatingError(400, `Eine CO₂-Erstattung gibt es erst für Abrechnungen des Lieferanten ab dem ${germanDate(co2FirstPeriodStart())} (§ 11 Abs. 2 CO2KostAufG).`)
  }
  if ((after.billedFrom === null) !== (after.billedTo === null)) throw new HeatingError(400, 'Bitte geben Sie Beginn und Ende des Zeitraums des Lieferanten an, oder keines von beiden.')
  if (after.billedFrom !== null && after.billedTo !== null && after.billedFrom > after.billedTo) throw new HeatingError(400, 'Der Zeitraum des Lieferanten endet vor seinem Beginn. Bitte prüfen Sie die beiden Daten.')
  if (after.amountCents < 0) throw new HeatingError(400, 'Der Betrag laut Anzeige ist ein Betrag in Euro, 0 oder mehr.')
  if (after.settlePeriod !== null && after.paidOutOn !== null) throw new HeatingError(400, 'Eine Erstattung wird entweder verrechnet oder ausgezahlt, nicht beides.')
  if (after.halfSplitFrom !== null && after.halfSplitFrom < halfSplitFirstDay()) {
    throw new HeatingError(400, `Die hälftige Teilung nach § 5a CO2KostAufG gilt frühestens ab dem ${germanDate(halfSplitFirstDay())}.`)
  }
  if ((after.gridFeeCents !== null || after.bioCostCents !== null) && after.halfSplitFrom === null) {
    throw new HeatingError(400, 'Gasnetzentgelte und Biobrennstoff zählen nur bei einer Heizung, für die § 5a CO2KostAufG gilt; tragen Sie dazu den Tag ein, ab dem er gilt.')
  }
  for (const [value, what] of [[after.emissionsKg, 'Der CO₂-Ausstoß'], [after.co2CostCents, 'Die CO₂-Kosten'], [after.gridFeeCents, 'Die Gasnetzentgelte'], [after.bioCostCents, 'Der Biobrennstoff']] as const) {
    if (value !== null && value < 0) throw new HeatingError(400, `${what} ist eine Zahl ab 0.`)
  }
  if (after.areaM2 !== null && after.areaM2 <= 0) throw new HeatingError(400, 'Die Wohnfläche ist eine Zahl größer als 0.')
  if (after.settlePeriod !== null) {
    const rules = await rulesForProperty(db, t.propertyId)
    const key = parsePeriodKey(after.settlePeriod)
    const p = key === null ? null : periodOfKey(rules, key)
    if (!p) throw new PeriodError(`Den Zeitraum ${after.settlePeriod} gibt es für dieses Objekt nicht. Bitte wählen Sie einen Abrechnungszeitraum des Objekts.`)
    if (t.start > p.to || (t.end !== null && t.end < p.from)) {
      throw new HeatingError(400, `${t.tenantName} wohnte im Zeitraum ${periodLabel(p)} nicht und bekommt dafür keine Abrechnung. Verrechnen Sie die Erstattung in einer Abrechnung, die ${t.tenantName} bekommt, oder zahlen Sie sie aus.`)
    }
    if ((await findClosedSettlement(db, t.propertyId, p.key)) !== undefined) {
      throw new HeatingError(409, `Die Abrechnung ${periodLabel(p)} ist abgeschlossen. Öffnen Sie sie wieder, wenn Sie die Erstattung dort verrechnen wollen.`)
    }
  }
}

export async function createRefund(db: Database, id: string, body: unknown): Promise<Co2Refund> {
  const after = mergeRefund(emptyRefund(id), body)
  await guardRefund(db, after)
  await db.insert(co2Refunds).values(after)
  return after
}

export async function updateRefund(db: Database, id: string, body: unknown): Promise<Co2Refund | null> {
  const before = (await readCo2Refunds(db)).find((r) => r.id === id)
  if (!before) return null
  if (await settledInClosed(db, before)) throw new HeatingError(409, CLOSED('ändern'))
  const after = mergeRefund(before, body)
  await guardRefund(db, after)
  const { id: _id, ...rest } = after
  await db.update(co2Refunds).set(rest).where(eq(co2Refunds.id, id))
  return after
}

export async function removeRefund(db: Database, id: string): Promise<boolean> {
  const before = (await readCo2Refunds(db)).find((r) => r.id === id)
  if (!before) return false
  if (await settledInClosed(db, before)) throw new HeatingError(409, CLOSED('löschen'))
  await db.delete(co2Refunds).where(eq(co2Refunds.id, id))
  return true
}
