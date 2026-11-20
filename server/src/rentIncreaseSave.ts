// Speichern einer Mieterhöhung (#191, PR 3): Entwurf, Versand, Antwort des Mieters, Rücknahme und die Übernahme in die
// Kaltmiete-Staffel. Rein bis auf die Marken (Prüfsumme); die Routen in index.ts lesen den Bestand, rechnen mit
// `planRentIncrease` (rentIncrease.ts) und schreiben in einer Transaktion. Vorbild ist die Übernahme der Vorauszahlung
// (#317, prepaymentSteps.ts): Marke des gesehenen Stands, 409 mit dem neuen, eine Transaktion, `patchTenancyIn`.
//
// - **Die Staffel bleibt die einzige Quelle des Solls.** Eine Stufe schreibt erst die Zustimmung (Vergleichsmiete, auch
//   teilweise) bzw. der Versand (Indexmiete, wirkt ohne Zustimmung, § 557b Abs. 3 BGB). **Schweigen ist keine Zustimmung**
//   (§ 558b Abs. 2 BGB, Gegenprüfung S8): Nach Ablauf der Frist geschieht nichts von selbst.
// - **Höchstens ein offenes Verlangen je Mietverhältnis**: ein Entwurf, oder ein versandtes Verlangen nach § 558 ohne Antwort.
// - **Zurücknehmen** entfernt eine so geschriebene Stufe nur, wenn sie unverändert ist; sonst 409 mit Satz.
// - **Versand rechnet neu** mit dem tatsächlichen Zugang und friert diese Rechnung ein; nennt das gedruckte Schreiben dann
//   andere Zahlen (Miete, Monat, Zustimmungsfrist), wird nicht gespeichert, sondern neu angelegt.
import { createHash } from 'node:crypto'
import type {
  Property, RentEntry, RentIncrease, RentIncreaseBasis, RentIncreaseDecision, RentIncreaseLetterInput, RentIncreasePlan,
  RentIncreaseRequest, RentIncreaseView, Settings, Tenancy, Unit,
} from '../../shared/types.ts'
import { effectiveLandlord, footerLine, recipientLines, returnLine } from '../../shared/landlord.ts'
import { salutationOf } from '../../shared/letter.ts'
import { rateAtMonth } from '../../shared/monthRate.ts'
import { germanDate } from '../../shared/law/register.ts'
import { monthName } from '../../shared/monthlyInfo.ts'
import { compareText } from './calc.ts'

// Eine Ablehnung, deren Satz schon für den Nutzer geschrieben ist; die Fehlerbehandlung in index.ts gibt Status und Satz
// weiter.
export class RentIncreaseError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 32)

// Offen ist ein Entwurf und ein versandtes Verlangen nach § 558 ohne Antwort. Eine versandte Indexerklärung wirkt schon.
export const isOpen = (x: Pick<RentIncrease, 'kind' | 'status'>): boolean => x.status === 'draft' || (x.kind === 'comparison' && x.status === 'sent')

// Die Marke eines Plans: Sie ändert sich mit dem Plan und mit jedem Verlangen des Mietverhältnisses, damit ein zweiter
// Klick auf „Entwurf anlegen“ nicht zwei Entwürfe anlegt.
export function planToken(plan: RentIncreasePlan, increases: readonly Pick<RentIncrease, 'id' | 'status'>[]): string {
  return hash([plan, increases.map((x) => [x.id, x.status])])
}

// Die Marke eines Verlangens: die Zeile und die Kaltmiete-Staffel, aus der eine Rücknahme eine Stufe entfernen würde.
export function increaseToken(x: RentIncrease, t: { baseRents: readonly RentEntry[] }): string {
  return hash([x, [...t.baseRents].sort((a, b) => compareText(a.from, b.from))])
}
export const viewOf = (x: RentIncrease, t: { baseRents: readonly RentEntry[] }): RentIncreaseView => ({ ...x, token: increaseToken(x, t) })

// ---------- Entwurf ----------

export type BasisInput = {
  today: string
  request: RentIncreaseRequest
  plan: RentIncreasePlan
  letter: RentIncreaseLetterInput
  tenancy: Tenancy
  unit: Pick<Unit, 'name' | 'areaM2'>
  property: Property | null
  settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'>
}

// Ein Plan, aus dem sich ein Schreiben machen lässt: nicht gesperrt (zu früh ist erlaubt, der Zugang kommt beim Versand),
// mit bisheriger und neuer Miete und Monat. Sonst der Satz der Ablehnung.
export function draftProblem(plan: RentIncreasePlan): string | null {
  if (plan.state === 'blocked' || plan.newCents === null || plan.currentCents === null || plan.effectiveFrom === null) {
    return `Aus dieser Rechnung lässt sich kein Schreiben machen. ${plan.refusals[0] ?? 'Bitte ergänzen Sie die Angaben der Rechnung.'}`
  }
  return null
}

// Was das Schreiben braucht, eingefroren: Eingaben, Rechnung samt Registerstand, Absender und Empfänger zum Zeitpunkt,
// Kappungsgrenzen-Verordnung mit Datum (S2), Vorauszahlungen im Monat des Wirksamwerdens.
export function buildBasis(i: BasisInput): RentIncreaseBasis {
  const { plan, tenancy: t, property } = i
  const landlord = effectiveLandlord(property, i.settings)
  const month = plan.effectiveFrom ?? i.today.slice(0, 7)
  const capAnswer = i.request.rentCap ?? (property?.rentCapReduced === true ? 'yes' : property?.rentCapReduced === false ? 'no' : 'unknown')
  return {
    version: 1,
    letterDate: i.today,
    request: i.request,
    plan,
    letter: i.letter,
    rentCap: plan.kind === 'comparison' ? { answer: capAnswer, answeredOn: i.today } : null,
    sender: { name: landlord.landlordName.trim(), address: landlord.landlordAddress, contact: landlord.landlordContact, returnLine: returnLine(landlord, property), footer: footerLine(landlord) },
    recipient: recipientLines(i.letter.recipientName, t, property),
    salutation: salutationOf(i.letter.recipientName, t.letterSalutation),
    premises: { propertyName: property?.name ?? '', address: (property?.address ?? '').trim(), unitName: i.unit.name, areaM2: i.unit.areaM2 },
    inclusive: t.costModel === 'inclusive' || t.heatingModel === 'inclusive',
    prepayments: { operatingCents: rateAtMonth(t.prepayments, month), heatingCents: rateAtMonth(t.heatingPrepayments ?? [], month), flatRateCents: rateAtMonth(t.flatRates ?? [], month) },
  }
}

export function draftOf(i: { id: string; tenancyId: string; today: string; basis: RentIncreaseBasis }): RentIncrease {
  const { plan } = i.basis
  return {
    id: i.id,
    tenancyId: i.tenancyId,
    kind: plan.kind,
    createdOn: i.today,
    receivedOn: null,
    effectiveFrom: plan.effectiveFrom ?? '',
    fromCents: plan.currentCents ?? 0,
    toCents: plan.newCents ?? 0,
    basis: i.basis,
    status: 'draft',
    agreedCents: null,
    decidedOn: null,
  }
}

// ---------- Versand ----------

// Die Eingaben der Rechnung beim Versand: wie im Entwurf, mit dem tatsächlichen Zugang; Monat und (Vergleichsmiete)
// verlangte Miete bleiben die des Schreibens.
export function sendRequest(x: RentIncrease, receivedOn: string): RentIncreaseRequest {
  return { ...x.basis.request, receivedOn, effectiveFrom: x.effectiveFrom, ...(x.kind === 'comparison' ? { requestedCents: x.toCents } : {}) }
}

// Darf mit diesem Zugang als versendet gespeichert werden? Nur wenn die Rechnung dazu `possible` ist und das gedruckte
// Schreiben dieselben Zahlen nennt; sonst der Satz der Ablehnung.
export function sendProblem(x: RentIncrease, plan: RentIncreasePlan, receivedOn: string, today: string): string | null {
  if (x.status !== 'draft') return 'Das Schreiben ist schon als versendet gespeichert. Bitte laden Sie die Seite neu.'
  if (compareText(receivedOn, today) > 0) return `Der Zugang am ${germanDate(receivedOn)} liegt in der Zukunft. Speichern Sie das Schreiben als versendet, sobald es beim Mieter angekommen ist.`
  if (compareText(receivedOn, x.createdOn) < 0) return `Der Zugang am ${germanDate(receivedOn)} liegt vor dem Tag des Schreibens (${germanDate(x.createdOn)}).`
  if (plan.state !== 'possible') {
    return `Bei Zugang am ${germanDate(receivedOn)} ist die Erhöhung so nicht möglich. ${plan.refusals.join(' ')}`.trim()
  }
  if (plan.newCents !== x.toCents) {
    return `Bei Zugang am ${germanDate(receivedOn)} ergibt die Rechnung ${plan.newCents === null ? 'keine neue Miete' : euro(plan.newCents)}, das Schreiben nennt ${euro(x.toCents)}. Bitte legen Sie das Schreiben neu an und drucken Sie es neu.`
  }
  const before = x.basis.plan.consent
  if (x.kind === 'comparison' && before && plan.consent && before.consentEnd !== plan.consent.consentEnd) {
    return `Das Schreiben nennt als Ende der Zustimmungsfrist den ${germanDate(before.consentEnd)}; bei Zugang am ${germanDate(receivedOn)} endet sie am ${germanDate(plan.consent.consentEnd)}. Bitte legen Sie das Schreiben mit diesem Zugang neu an und drucken Sie es neu.`
  }
  return null
}

// ---------- Staffel ----------

// Die Stufe, die ein Verlangen schreibt: Vergleichsmiete mit der zugestimmten Miete (Art `comparison`), Indexmiete mit der
// neuen Miete und dem neuen Indexwert (Art `index`).
export function stepOf(x: RentIncrease): RentEntry {
  if (x.kind === 'index') {
    const to = x.basis.plan.index?.to
    return { from: x.effectiveFrom, monthlyCents: x.toCents, reason: 'index', ...(to ? { index: to } : {}) }
  }
  return { from: x.effectiveFrom, monthlyCents: x.status === 'partial' && x.agreedCents !== null ? x.agreedCents : x.toCents, reason: 'comparison' }
}

const sameStep = (a: RentEntry, b: RentEntry): boolean =>
  a.from === b.from && a.monthlyCents === b.monthlyCents && (a.reason ?? 'agreement') === (b.reason ?? 'agreement') &&
  JSON.stringify(a.index ?? null) === JSON.stringify(b.index ?? null)

// Die Staffel mit der neuen Stufe. Steht schon eine Stufe ab dem Monat oder später, wird nichts geschrieben: Die
// Erhöhung läge vor einer schon vereinbarten Änderung.
export function withStep(rents: readonly RentEntry[], step: RentEntry): RentEntry[] {
  const later = [...rents].sort((a, b) => compareText(a.from, b.from)).find((r) => compareText(r.from, step.from) >= 0)
  if (later) throw new RentIncreaseError(409, `In der Kaltmiete-Staffel steht schon eine Stufe ab ${monthName(later.from)}. Die neue Miete ab ${monthName(step.from)} trägt Mietfuchs deshalb nicht ein; prüfen Sie die Staffel.`)
  return [...rents, step]
}

// Die Staffel ohne die geschriebene Stufe, wenn sie unverändert dasteht. Fehlt sie, bleibt die Staffel, wie sie ist.
export function withoutStep(rents: readonly RentEntry[], step: RentEntry): RentEntry[] | null {
  const at = rents.find((r) => r.from === step.from)
  if (!at) return null
  if (!sameStep(at, step)) {
    const what = at.monthlyCents !== step.monthlyCents ? `${euro(at.monthlyCents)} statt ${euro(step.monthlyCents)}` : 'Art oder Indexwert'
    throw new RentIncreaseError(409, `Die Stufe ab ${monthName(step.from)} wurde nach der Übernahme geändert (${what}). Mietfuchs nimmt sie deshalb nicht heraus. Prüfen Sie die Kaltmiete-Staffel und ändern Sie sie bei Bedarf selbst; danach lässt sich das Verlangen zurücknehmen.`)
  }
  return rents.filter((r) => r !== at)
}

// ---------- Antwort und Rücknahme ----------

// Welche Antworten auf welchen Stand folgen dürfen. Zustimmung, teilweise Zustimmung und Ablehnung gibt es nur beim
// Verlangen nach § 558 (eine Indexerklärung braucht keine); eine Ablehnung kann noch einer Zustimmung weichen (etwa im
// Rechtsstreit). Zurücknehmen geht nach dem Versand immer.
const ALLOWED: Readonly<Record<RentIncreaseDecision, readonly RentIncrease['status'][]>> = {
  agreed: ['sent', 'refused'],
  partial: ['sent', 'refused'],
  refused: ['sent'],
  withdrawn: ['sent', 'agreed', 'partial', 'refused'],
}
const STATUS_WORDS: Readonly<Record<RentIncrease['status'], string>> = {
  draft: 'ein Entwurf', sent: 'versandt', agreed: 'zugestimmt', partial: 'teilweise zugestimmt', refused: 'abgelehnt', withdrawn: 'zurückgenommen',
}
export const DECISION_TITLES: Readonly<Record<RentIncreaseDecision, string>> = {
  agreed: 'Zustimmung zur Mieterhöhung eingetragen',
  partial: 'Teilweise Zustimmung zur Mieterhöhung eingetragen',
  refused: 'Ablehnung der Mieterhöhung eingetragen',
  withdrawn: 'Mieterhöhung zurückgenommen',
}

export const isDecision = (x: unknown): x is RentIncreaseDecision => x === 'agreed' || x === 'partial' || x === 'refused' || x === 'withdrawn'

// Der Satz, warum diese Antwort nicht gespeichert wird, oder `null`.
export function decisionProblem(x: RentIncrease, decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string, today: string): string | null {
  if (x.kind === 'index' && decision !== 'withdrawn') return 'Eine Anpassung der Indexmiete braucht keine Zustimmung des Mieters; sie wirkt mit dem Zugang (§ 557b Abs. 3 BGB). Sie lässt sich nur zurücknehmen.'
  if (!ALLOWED[decision].includes(x.status)) return `Das Verlangen ist ${STATUS_WORDS[x.status]}; „${DECISION_TITLES[decision]}“ passt dazu nicht. Bitte laden Sie die Seite neu.`
  if (x.receivedOn !== null && compareText(decidedOn, x.receivedOn) < 0) return `Der Tag der Antwort liegt vor dem Zugang am ${germanDate(x.receivedOn)}.`
  if (compareText(decidedOn, today) > 0) return 'Der Tag der Antwort liegt in der Zukunft.'
  if (decision === 'partial') {
    if (agreedCents === null) return 'Bitte geben Sie die Miete an, der der Mieter zugestimmt hat.'
    if (agreedCents <= x.fromCents) return `Bei einer teilweisen Zustimmung liegt die Miete über der bisherigen von ${euro(x.fromCents)}; sonst hat der Mieter abgelehnt.`
    if (agreedCents > x.toCents) return `Der Mieter kann höchstens der verlangten Miete von ${euro(x.toCents)} zustimmen.`
  }
  return null
}

// Der neue Stand nach der Antwort.
export function decided(x: RentIncrease, decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string): RentIncrease {
  return { ...x, status: decision, agreedCents: decision === 'partial' ? agreedCents : null, decidedOn }
}
// Schreibt der Übergang eine Stufe, oder nimmt er eine heraus? Vergleichsmiete: Zustimmung (auch teilweise) schreibt;
// Indexmiete: der Versand. Zurücknehmen nimmt heraus, was vorher geschrieben war.
export const writesStep = (before: RentIncrease['status'], after: RentIncrease['status'], kind: RentIncrease['kind']): boolean =>
  kind === 'index' ? before === 'draft' && after === 'sent' : (after === 'agreed' || after === 'partial') && before !== 'agreed' && before !== 'partial'
export const stepWritten = (x: Pick<RentIncrease, 'kind' | 'status'>): boolean => (x.kind === 'index' ? x.status === 'sent' : x.status === 'agreed' || x.status === 'partial')
