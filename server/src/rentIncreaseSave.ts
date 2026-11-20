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
// - **Versand rechnet neu** mit dem tatsächlichen Zugang und friert diese Rechnung getrennt ein (`basis.sentPlan`); die
//   Grundlage des gedruckten Schreibens (`basis.plan`) bleibt, damit ein Nachdruck das verschickte Schreiben ergibt
//   (Durchsicht M1). Nennt das gedruckte Schreiben zum tatsächlichen Zugang andere Zahlen (bisherige Miete,
//   Kappungsgrenze, Monat, verlangte Miete, Ende der Zustimmungsfrist), wird nicht gespeichert, sondern neu angelegt.
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
    sentPlan: null,
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

// Was das gedruckte Schreiben aus der Rechnung nennt (client/src/rentIncreaseLetter.ts) und beim Versand gleich bleiben
// muss, je mit dem Wort für den Satz der Ablehnung. Der Zugang selbst gehört nicht dazu: Das Schreiben nennt ihn als
// Annahme („bei Zugang am …“), maßgeblich ist das Ende der Zustimmungsfrist.
const PRINTED: readonly { label: string; of: (p: RentIncreasePlan) => unknown; show: (p: RentIncreasePlan) => string }[] = [
  { label: 'bisherige Miete', of: (p) => p.currentCents, show: (p) => (p.currentCents === null ? 'keine' : euro(p.currentCents)) },
  { label: 'verlangte Miete', of: (p) => p.newCents, show: (p) => (p.newCents === null ? 'keine' : euro(p.newCents)) },
  { label: 'Wirksamwerden', of: (p) => p.effectiveFrom, show: (p) => (p.effectiveFrom === null ? 'keines' : `ab ${monthName(p.effectiveFrom)}`) },
  {
    label: 'Kappungsgrenze',
    of: (p) => (p.cap ? [p.cap.percent, p.cap.baseDay, p.cap.baseCents, p.cap.modernizationCents, p.cap.limitCents] : null),
    show: (p) => (p.cap ? `${euro(p.cap.limitCents)} (Ausgangsmiete ${euro(p.cap.baseCents)} am ${germanDate(p.cap.baseDay)}, ${p.cap.percent} %)` : 'keine'),
  },
  { label: 'Ende der Zustimmungsfrist', of: (p) => p.consent?.consentEndOnWorkday ?? null, show: (p) => (p.consent ? germanDate(p.consent.consentEndOnWorkday) : 'keines') },
  { label: 'Vergleichsrechnung', of: (p) => p.comparison, show: (p) => (p.comparison ? `${euro(p.comparison.limitCents)}` : 'keine') },
  { label: 'Indexwerte', of: (p) => p.index, show: (p) => (p.index ? `${p.index.from.value.toLocaleString('de-DE')} und ${p.index.to.value.toLocaleString('de-DE')}` : 'keine') },
]

// Darf mit diesem Zugang als versendet gespeichert werden? Nur wenn die Rechnung dazu `possible` ist (sonst 400) und das
// gedruckte Schreiben dieselben Zahlen und Fristen nennt (sonst 409); `null`, wenn ja.
export function sendProblem(x: RentIncrease, plan: RentIncreasePlan, receivedOn: string, today: string): RentIncreaseError | null {
  const no = (message: string) => new RentIncreaseError(400, message)
  if (x.status !== 'draft') return no('Das Schreiben ist schon als versendet gespeichert. Bitte laden Sie die Seite neu.')
  if (compareText(receivedOn, today) > 0) return no(`Der Zugang am ${germanDate(receivedOn)} liegt in der Zukunft. Speichern Sie das Schreiben als versendet, sobald es beim Mieter angekommen ist.`)
  if (compareText(receivedOn, x.createdOn) < 0) return no(`Der Zugang am ${germanDate(receivedOn)} liegt vor dem Tag des Schreibens (${germanDate(x.createdOn)}).`)
  if (plan.state !== 'possible') {
    return no(`Bei Zugang am ${germanDate(receivedOn)} ist die Erhöhung so nicht möglich. ${plan.refusals.join(' ')}`.trim())
  }
  const printed = x.basis.plan
  const changed = PRINTED.filter((f) => JSON.stringify(f.of(printed)) !== JSON.stringify(f.of(plan)))
  if (changed.length > 0) {
    const what = changed.map((f) => `${f.label} ${f.show(plan)} statt ${f.show(printed)}`).join(', ')
    return new RentIncreaseError(409, `Bei Zugang am ${germanDate(receivedOn)} und nach dem heutigen Stand nennt die Rechnung andere Angaben als das gedruckte Schreiben: ${what}. Bitte legen Sie das Schreiben neu an und drucken Sie es neu.`)
  }
  return null
}

// Das versandte Verlangen: Zugang und Stand neu, die Rechnung zum Zugang daneben; die Grundlage des Schreibens bleibt.
export function sentOf(x: RentIncrease, plan: RentIncreasePlan, receivedOn: string): RentIncrease {
  return { ...x, receivedOn, status: 'sent', basis: { ...x.basis, sentPlan: plan } }
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
// Steht danach noch eine Stufe, baut die auf der Erhöhung auf (etwa eine spätere Erhöhung mit ihr als bisheriger Miete
// und Kappungsgrenze); dann wird nichts herausgenommen (Integrationsdurchsicht S-Geld).
export function withoutStep(rents: readonly RentEntry[], step: RentEntry): RentEntry[] | null {
  const at = rents.find((r) => r.from === step.from)
  if (!at) return null
  const next = [...rents].sort((a, b) => compareText(a.from, b.from)).find((r) => compareText(r.from, step.from) > 0)
  if (next) throw new RentIncreaseError(409, `In der Kaltmiete-Staffel steht nach der Stufe ab ${monthName(step.from)} noch eine Stufe ab ${monthName(next.from)}, die auf dieser Erhöhung aufbaut. Mietfuchs nimmt die Erhöhung deshalb nicht zurück. Nehmen Sie zuerst die spätere Änderung zurück oder ändern Sie die Staffel selbst.`)
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
export function decisionProblem(x: RentIncrease, decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string, today: string, tenancyEnd: string | null): string | null {
  if (x.kind === 'index' && decision !== 'withdrawn') return 'Eine Anpassung der Indexmiete braucht keine Zustimmung des Mieters; sie wirkt mit dem Zugang (§ 557b Abs. 3 BGB). Sie lässt sich nur zurücknehmen.'
  if (!ALLOWED[decision].includes(x.status)) return `Das Verlangen ist ${STATUS_WORDS[x.status]}; „${DECISION_TITLES[decision]}“ passt dazu nicht. Bitte laden Sie die Seite neu.`
  if (x.receivedOn !== null && compareText(decidedOn, x.receivedOn) < 0) return `Der Tag der Antwort liegt vor dem Zugang am ${germanDate(x.receivedOn)}.`
  if (compareText(decidedOn, today) > 0) return 'Der Tag der Antwort liegt in der Zukunft.'
  // Integrationsdurchsicht K-Geld-1: Endet das Mietverhältnis vor dem Wirksamwerden, gäbe es keine Miete, die steigt.
  const effectiveDay = `${x.effectiveFrom}-01`
  if ((decision === 'agreed' || decision === 'partial') && tenancyEnd !== null && compareText(tenancyEnd, effectiveDay) < 0) {
    return `Das Mietverhältnis endet am ${germanDate(tenancyEnd)}, vor dem Wirksamwerden am ${germanDate(effectiveDay)}. Eine Zustimmung trägt Mietfuchs deshalb nicht ein; prüfen Sie das Ende des Mietverhältnisses, oder tragen Sie die Ablehnung ein bzw. nehmen Sie das Verlangen zurück.`
  }
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
