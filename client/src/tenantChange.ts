// Der Mieterwechsel-Assistent in den Stammdaten: Eingaben prüfen und den Rumpf für
// POST /api/tenancies/:id/change bauen (#150). Eigene Datei, damit die Regeln ohne DOM prüfbar sind.
//
// Gespeichert wird in **einer** Anfrage, die der Server in einer Transaktion ausführt. Vorher
// schickte der Assistent drei Anfragen nacheinander, und lehnte der Server die letzte ab, standen
// das Ende des alten Mietverhältnisses und die Zwischenablesungen schon da; ein zweiter Versuch
// legte die Ablesungen doppelt an.
import { parseQuantity } from './costForm'
import { parseEuro } from './api'
import { PERSONS_HINT, parsePersons, SELF_SUPPLY_KIND_OPTIONS } from './tenancyModel'
import type { InterimGapStatus, Meter, SelfSupplyKind, Tenancy } from './types'
import type { Problem } from './formProblems'

// `heatingPrepayment` nur bei getrennter Heizkostenabrechnung (Heizung PR 5): dann ist `prepayment`
// die übrige Vorauszahlung.
export type NewTenantForm = { name: string; start: string; persons: string; baseRent: string; prepayment: string; heatingPrepayment?: string }

export const EMPTY_NEW_TENANT: NewTenantForm = { name: '', start: '', persons: '2', baseRent: '', prepayment: '' }

export type TenantChangeBody = {
  end: string
  // `date`: eigenes Ablesedatum neben dem Auszug (Heizung PR 10); fehlt es, gilt der Auszugstag.
  readings: { meterId: string; value: number; date?: string }[]
  // Keine Zwischenablesung bei eigener Heizkostenabrechnung: nicht möglich oder nicht durchgeführt (Heizung PR 10).
  interimGap?: { status: InterimGapStatus; reason: string }
  newTenancy: {
    tenantName: string
    persons: number
    personHistory: { from: string; persons: number }[]
    start: string
    baseRents: { from: string; monthlyCents: number }[]
    prepayments: { from: string; monthlyCents: number }[]
    prepaymentOverrides: Record<string, number>
    heatingPrepayments?: { from: string; monthlyCents: number }[]
    heatingModel?: 'selfSupply'
    selfSupplyKind?: SelfSupplyKind
  } | null
  // #229: neue Anschrift, E-Mail und Telefon des Vormieters, nur die geänderten Felder; `null` entfernt die Angabe.
  contact?: Partial<Record<keyof ContactForm, string | null>>
}

// Erreichbarkeit des ausziehenden Mieters (#229), in den Feldern, die das Mietverhältnis schon hat. Alles freiwillig.
export type ContactForm = { correspondenceAddress: string; email: string; phone: string }
type ContactSource = Partial<Pick<Tenancy, 'correspondenceAddress' | 'email' | 'phone'>>
const CONTACT_KEYS = ['correspondenceAddress', 'email', 'phone'] as const
// Wie der Server (LETTER_LINE_MAX): eine Zeile, höchstens 200 Zeichen.
export const CONTACT_LINE_MAX = 200

export const contactForm = (t: ContactSource): ContactForm =>
  ({ correspondenceAddress: t.correspondenceAddress ?? '', email: t.email ?? '', phone: t.phone ?? '' })

// Nur, was sich gegenüber dem Mietverhältnis geändert hat; sonst überschriebe ein offenes Fenster eine Angabe, die
// inzwischen anderswo geändert wurde, mit dem alten Stand.
export function contactChanges(t: ContactSource, form: ContactForm | undefined): TenantChangeBody['contact'] | undefined {
  if (!form) return undefined
  const out: NonNullable<TenantChangeBody['contact']> = {}
  for (const key of CONTACT_KEYS) {
    const value = form[key].trim()
    if (value !== (t[key] ?? '').trim()) out[key] = value === '' ? null : value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function contactProblems(form: ContactForm | undefined): Problem<TenantChangeField>[] {
  if (!form) return []
  const problems: Problem<TenantChangeField>[] = []
  if (form.correspondenceAddress.trim().length > CONTACT_LINE_MAX) {
    problems.push({ field: 'correspondenceAddress', short: `Höchstens ${CONTACT_LINE_MAX} Zeichen`, text: `Neue Anschrift: Bitte höchstens ${CONTACT_LINE_MAX} Zeichen.` })
  }
  const email = form.email.trim()
  if (email !== '' && !EMAIL.test(email)) problems.push({ field: 'email', short: 'Keine E-Mail-Adresse', text: 'E-Mail-Adresse: Bitte in der Form name@beispiel.de angeben oder leer lassen.' })
  return problems
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Kosten der Zwischenablesung (BGH VIII ZR 19/07), als Satz unter den Zählerständen (Heizung PR 10).
export const INTERIM_FEE_HINT = 'Die Kosten einer Zwischenablesung beim Mieterwechsel sind keine Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist (BGH VIII ZR 19/07).'

// Die Antworten, wenn bei eigener Heizkostenabrechnung ein Stand fehlt (Heizung PR 10, Entwurf 3.5).
export const INTERIM_GAP_OPTIONS: { value: Extract<InterimGapStatus, 'impossible' | 'missed'>; label: string }[] = [
  { value: 'impossible', label: 'Sie war nicht möglich' },
  { value: 'missed', label: 'Sie wurde nicht durchgeführt' },
]

// Ein Zählerstand im Assistenten, gelesen wie auf der Zähler-Seite (#149, #105): „1.234“ ist
// 1234. Leer heißt „nicht abgelesen“ und wird übersprungen.
export function parseMeterValue(text: string): number | null {
  if (!text.trim()) return null
  const value = parseQuantity(text)
  return value === null || value < 0 ? null : value
}

// Einzug des Nachmieters: standardmäßig der Tag nach dem Auszug.
export function defaultStart(end: string): string {
  const d = new Date(`${end}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Schritt 1: das Auszugsdatum. `null` heißt in Ordnung.
export function endProblem(endDate: string, tenancy: Pick<Tenancy, 'start'>): string | null {
  if (!ISO_DATE.test(endDate) || endDate < tenancy.start) return 'Bitte ein gültiges Auszugsdatum nach dem Einzug angeben.'
  return null
}

// Schritt 2: die Zählerstände. Ein leeres Feld ist erlaubt, ein unlesbares nicht.
export function meterProblem(meters: Pick<Meter, 'id' | 'name'>[], values: Record<string, string>): string | null {
  for (const m of meters) {
    const v = values[m.id]
    if (v?.trim() && parseMeterValue(v) === null) return `Zählerstand für „${m.name}“ ist keine gültige Zahl.`
  }
  return null
}

// Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 3.5): Fehlt ein Stand eines Wärme- oder
// Warmwasserzählers, sagt der Vermieter warum, und zwar vor dem Speichern; „nicht möglich“ nur mit Grund
// (Durchsicht von #239, I3).
export function gapProblem(heatIds: readonly string[], meterValues: Record<string, string>, gap: { status: InterimGapStatus | ''; reason: string } | null | undefined): string | null {
  const missingHeat = heatIds.some((id) => parseMeterValue(meterValues[id] ?? '') === null)
  if (heatIds.length === 0 || !missingHeat) return null
  if (!gap || gap.status === '') {
    return 'Für die Heizkostenabrechnung fehlt ein Zählerstand. Bitte tragen Sie ihn ein oder geben Sie an, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.'
  }
  if (gap.status === 'impossible' && gap.reason.trim() === '') return 'Bitte nennen Sie den Grund für die Teilung nach § 9b Abs. 3 HeizkostenV, also warum die Zwischenablesung nicht möglich war; er steht in der Abrechnung.'
  return null
}

export type TenantChangeInput = Parameters<typeof buildTenantChange>[0]
export type TenantChangeField = 'end' | 'correspondenceAddress' | 'email' | 'phone' |'name' | 'start' | 'persons' | 'baseRent' | 'prepayment' | 'heatingPrepayment' | 'gapStatus' | 'gapReason' | `meter:${string}` | `meterDate:${string}`

// Der Mieterwechsel im Seitenfenster (#346 Schritt 7): alle Angaben auf einmal, je mit Feld, kurze Fassung am Feld und
// Satz mit Ort für die Sammelmeldung. Dieselben Regeln wie buildTenantChange, das danach den Rumpf baut; ist die
// Liste leer, gelingt es.
export function tenantChangeProblems(input: TenantChangeInput): Problem<TenantChangeField>[] {
  const { tenancy, endDate, meters, meterValues, vacancy, newTenant } = input
  const problems: Problem<TenantChangeField>[] = []
  const endOk = ISO_DATE.test(endDate) && endDate >= tenancy.start
  if (!endOk) {
    const short = endDate === '' ? 'Auszugsdatum fehlt' : ISO_DATE.test(endDate) ? 'Vor dem Einzug' : 'Kein Datum'
    problems.push({ field: 'end', short, text: 'Auszug: Bitte ein gültiges Auszugsdatum nach dem Einzug angeben.' })
  }
  problems.push(...contactProblems(input.contact))
  for (const m of meters) {
    const v = meterValues[m.id]
    if (v?.trim() && parseMeterValue(v) === null) problems.push({ field: `meter:${m.id}`, short: 'Keine Zahl', text: `Zählerstand für „${m.name}“ ist keine gültige Zahl.` })
  }
  for (const m of meters) {
    const date = input.meterDates?.[m.id] ?? ''
    if (date !== '' && !ISO_DATE.test(date)) problems.push({ field: `meterDate:${m.id}`, short: 'Kein Datum', text: `Das Ablesedatum für „${m.name}“ ist kein Datum.` })
  }
  const heatIds = input.heatMeterIds ?? []
  if (gapProblem(heatIds, meterValues, input.interimGap) !== null) {
    const gap = input.interimGap
    if (!gap || gap.status === '') problems.push({ field: 'gapStatus', short: 'Antwort fehlt', text: 'Zwischenablesung: Für die Heizkostenabrechnung fehlt ein Zählerstand. Bitte tragen Sie ihn ein oder geben Sie an, ob die Zwischenablesung nicht möglich war oder nicht durchgeführt wurde.' })
    else problems.push({ field: 'gapReason', short: 'Grund fehlt', text: 'Zwischenablesung: Bitte nennen Sie den Grund für die Teilung nach § 9b Abs. 3 HeizkostenV, also warum die Zwischenablesung nicht möglich war; er steht in der Abrechnung.' })
  }
  if (vacancy) return problems
  if (!newTenant.name.trim()) problems.push({ field: 'name', short: 'Name fehlt', text: 'Neuer Mieter: Bitte den Namen angeben.' })
  if (!ISO_DATE.test(newTenant.start)) problems.push({ field: 'start', short: newTenant.start === '' ? 'Einzug fehlt' : 'Kein Datum', text: 'Neuer Mieter: Bitte das Einzugsdatum angeben.' })
  else if (endOk && newTenant.start <= endDate) problems.push({ field: 'start', short: 'Nicht nach dem Auszug', text: 'Neuer Mieter: Der Einzug muss nach dem Auszug liegen.' })
  if (parsePersons(newTenant.persons) === null) {
    problems.push({ field: 'persons', short: newTenant.persons.trim() === '' ? 'Personenzahl fehlt' : 'Keine Personenzahl', text: `Neuer Mieter: Bitte die Personenzahl angeben. ${PERSONS_HINT}` })
  }
  if (newTenant.baseRent.trim() && parseEuro(newTenant.baseRent) === null) problems.push({ field: 'baseRent', short: 'Kein Betrag', text: 'Neuer Mieter: Die Kaltmiete bitte als Betrag angeben, z. B. 800,00.' })
  if (newTenant.prepayment.trim() && parseEuro(newTenant.prepayment) === null) problems.push({ field: 'prepayment', short: 'Kein Betrag', text: 'Neuer Mieter: Die Vorauszahlung bitte als Betrag angeben, z. B. 150,00.' })
  if (input.askHeating) {
    const text = (newTenant.heatingPrepayment ?? '').trim()
    const cents = text ? parseEuro(text) : null
    if (text === '') problems.push({ field: 'heatingPrepayment', short: 'Heizvorauszahlung fehlt', text: 'Neuer Mieter: Bitte die Heizvorauszahlung angeben (0,00, wenn er keine zahlt).' })
    else if (cents === null || cents < 0) problems.push({ field: 'heatingPrepayment', short: 'Kein Betrag', text: 'Neuer Mieter: Die Heizvorauszahlung bitte als Betrag angeben (0,00, wenn er keine zahlt).' })
  }
  return problems
}

// Schritt 3: der ganze Wechsel als ein Rumpf, oder die Meldung, warum nicht.
export function buildTenantChange(input: {
  // Heizung PR 19 (Durchsicht S-3): Heizt der Vormieter selbst, tut es der Nachmieter auch, mit derselben Art.
  tenancy: Pick<Tenancy, 'start'> & Partial<Pick<Tenancy, 'heatingModel' | 'selfSupplyKind'>> & ContactSource
  endDate: string
  // #229: neue Anschrift, E-Mail und Telefon des ausziehenden Mieters (vorbelegt mit `contactForm`).
  contact?: ContactForm
  meters: Pick<Meter, 'id' | 'name'>[]
  meterValues: Record<string, string>
  vacancy: boolean
  newTenant: NewTenantForm
  // Die Anlage der Wohnung rechnet die Heizkosten getrennt ab (Durchsicht von #231): Dann gehört zum
  // Nachmieter auch seine Heizvorauszahlung, sonst wiese die Heizkostenabrechnung 0 € aus.
  askHeating?: boolean
  // Heizung PR 10: eigenes Ablesedatum je Zähler (leer heißt Auszugstag), die Wärme- und Warmwasserzähler
  // der Wohnung, wenn eine Anlage mit eigener Heizkostenabrechnung sie versorgt, und die Antwort, wenn
  // dort ein Stand fehlt.
  meterDates?: Record<string, string>
  heatMeterIds?: string[]
  interimGap?: { status: InterimGapStatus | ''; reason: string } | null
}): { error: string } | { body: TenantChangeBody } {
  const { tenancy, endDate, meters, meterValues, vacancy, newTenant } = input
  const ende = endProblem(endDate, tenancy)
  if (ende) return { error: ende }
  const zaehler = meterProblem(meters, meterValues)
  if (zaehler) return { error: zaehler }
  const readings: TenantChangeBody['readings'] = []
  for (const m of meters) {
    const value = parseMeterValue(meterValues[m.id] ?? '')
    const date = input.meterDates?.[m.id] ?? ''
    if (date !== '' && !ISO_DATE.test(date)) return { error: `Das Ablesedatum für „${m.name}“ ist kein Datum.` }
    if (value !== null) readings.push({ meterId: m.id, value, ...(date !== '' ? { date } : {}) })
  }
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 3.5): fehlt ein Stand, sagt der Vermieter warum.
  const heatIds = input.heatMeterIds ?? []
  const missingHeat = heatIds.some((id) => parseMeterValue(meterValues[id] ?? '') === null)
  let interimGap: TenantChangeBody['interimGap']
  const gapError = gapProblem(heatIds, meterValues, input.interimGap)
  if (gapError) return { error: gapError }
  const g = input.interimGap
  if (heatIds.length > 0 && missingHeat && g && g.status !== '') interimGap = { status: g.status, reason: g.reason.trim() }
  const contactError = contactProblems(input.contact)[0]
  if (contactError) return { error: contactError.text }
  const changes = contactChanges(tenancy, input.contact)
  const gap = { ...(interimGap ? { interimGap } : {}), ...(changes ? { contact: changes } : {}) }
  if (vacancy) return { body: { end: endDate, readings, ...gap, newTenancy: null } }

  const persons = parsePersons(newTenant.persons)
  if (!newTenant.name.trim() || !ISO_DATE.test(newTenant.start) || persons === null) {
    return { error: `Bitte Name, Einzugsdatum und Personenzahl des neuen Mieters prüfen. ${PERSONS_HINT}` }
  }
  if (newTenant.start <= endDate) return { error: 'Der Einzug des neuen Mieters muss nach dem Auszug liegen.' }
  // Ein leeres Feld heißt „keine Staffel“; Unlesbares wird gemeldet statt still weggelassen.
  const baseRent = newTenant.baseRent.trim() ? parseEuro(newTenant.baseRent) : null
  const prepayment = newTenant.prepayment.trim() ? parseEuro(newTenant.prepayment) : null
  if (newTenant.baseRent.trim() && baseRent === null) return { error: 'Die Kaltmiete bitte als Betrag angeben, z. B. 800,00.' }
  if (newTenant.prepayment.trim() && prepayment === null) return { error: 'Die Vorauszahlung bitte als Betrag angeben, z. B. 150,00.' }
  const heatingText = (newTenant.heatingPrepayment ?? '').trim()
  const heating = input.askHeating ? (heatingText ? parseEuro(heatingText) : null) : null
  if (input.askHeating && (heating === null || heating < 0)) return { error: 'Bitte die Heizvorauszahlung des neuen Mieters angeben (0,00, wenn er keine zahlt).' }
  const month = newTenant.start.slice(0, 7)
  return {
    body: {
      end: endDate,
      readings,
      ...gap,
      newTenancy: {
        tenantName: newTenant.name.trim(),
        persons,
        personHistory: [{ from: newTenant.start, persons }],
        start: newTenant.start,
        baseRents: baseRent !== null ? [{ from: month, monthlyCents: baseRent }] : [],
        prepayments: prepayment !== null ? [{ from: month, monthlyCents: prepayment }] : [],
        prepaymentOverrides: {},
        ...(input.askHeating && heating !== null ? { heatingPrepayments: [{ from: month, monthlyCents: heating }] } : {}),
        ...(tenancy.heatingModel === 'selfSupply' ? { heatingModel: 'selfSupply' as const, ...(tenancy.selfSupplyKind ? { selfSupplyKind: tenancy.selfSupplyKind } : {}) } : {}),
      },
    },
  }
}

// Nachprüfung N-3 zu PR 19: Heizt der Vormieter selbst, übernimmt der Nachmieter das samt Art (`buildTenantChange`).
// Die Wechselmaske sagt es, statt es still zu tun. Null, wenn nichts übernommen wird.
export function successorHeatingNote(tenancy: Partial<Pick<Tenancy, 'heatingModel' | 'selfSupplyKind'>>): string | null {
  if (tenancy.heatingModel !== 'selfSupply') return null
  const kind = tenancy.selfSupplyKind ? SELF_SUPPLY_KIND_OPTIONS.find((o) => o.value === tenancy.selfSupplyKind)?.label : undefined
  return `Der neue Mieter heizt ebenfalls selbst („Mieter heizt selbst“${kind ? `: ${kind}` : ''}). Ändern lässt sich das danach in den Stammdaten.`
}
