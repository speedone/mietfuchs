import type { CostItem, FederalState, Property, PropertyKind } from './types'
import { PROPERTY_KIND_LABELS } from './types'
import { ibanForSave, ibanToInput, storedIbanInvalid } from './ibanField'
import { fmtDate } from './api'
import { IBAN_LABELS } from '../../shared/iban.ts'
import type { Problem } from './formProblems'
import { isFederalState, localHolidaysOf, STATES, stateName } from '../../shared/holidays.ts'
import { allowsSpread, spreadRestQuestions, spreadSpan } from '../../shared/spread.ts'

// Die Entscheidungslogik der Karte „Objekt“ (#92), ohne DOM prüfbar wie costForm.ts und
// unitForm.ts; die Komponente rendert nur.

export type PropertyForm = {
  name: string
  address: string
  kind: PropertyKind
  // Abweichende Angaben gelten nur mit Haken; sonst die Vorgabe aus den Einstellungen.
  own: boolean
  landlordName: string
  iban: string
  paymentDeadlineDays: string
  // Teil 2 von #415: Anschrift und Kontakt des Vermieters für Rücksendeangabe und Fußzeile des Briefs
  landlordAddress: string
  landlordContact: string
  // Kabelanlage vor oder ab dem 01.12.2021 errichtet (#121)
  cable: CableAnswer
  // Angespannter Wohnungsmarkt mit Geltung der Verordnung (§ 5d CO2KostAufG, Heizung PR 18)
  tightMarket: TightMarketAnswer
  tightMarketFrom: string
  tightMarketTo: string
  // Bundesland für Fristen und Feiertage; '' heißt unbekannt.
  state: FederalState | ''
} & TaxHeaderForm & {
  // Der gespeicherte Stand des Abschnitts „Für die Steuer (Anlage V)“ (#96 PR 2): Gesendet wird nur, was davon abweicht,
  // damit ein Speichern ohne Eingabe nichts Neues schickt (client/CLAUDE.md, „nur gesendet, was sich geändert hat“).
  taxSaved: TaxHeaderForm
  // Das Jahr des vorzeitigen Endes nach § 82b Abs. 2 EStDV (#262 PR 4) als Text der Auswahl, '' heißt keines; dazu der
  // gespeicherte Stand, denn gesendet wird nur eine Änderung (sie löst die Rückfrage aus).
  spreadRestYear: string
  spreadRestSaved: string
}

// Kopf der Anlage V (#96 PR 2, Entwurf B2): Z. 6 Aktenzeichen, Z. 7 vier Daten. Texte, wie eingegeben.
export type TaxHeaderForm = {
  groundTaxFileNumber: string
  purchaseContractOn: string
  ownershipTransferOn: string
  buildingApplicationOn: string
  completedOn: string
}
export type TaxHeaderField = keyof TaxHeaderForm
export const TAX_HEADER_FIELDS: readonly TaxHeaderField[] = ['groundTaxFileNumber', 'purchaseContractOn', 'ownershipTransferOn', 'buildingApplicationOn', 'completedOn']
const EMPTY_TAX_HEADER: TaxHeaderForm = { groundTaxFileNumber: '', purchaseContractOn: '', ownershipTransferOn: '', buildingApplicationOn: '', completedOn: '' }
// Die Beschriftungen am Feld und in der Karte zum Lesen (wie im Verlauf, journalView.ts).
export const TAX_HEADER_LABELS: Record<TaxHeaderField, string> = {
  groundTaxFileNumber: 'Aktenzeichen laut Grundsteuermessbescheid',
  purchaseContractOn: 'Notar- oder Kaufvertrag vom',
  ownershipTransferOn: 'Eigentumsübergang am',
  buildingApplicationOn: 'Bauantrag oder Bauanzeige vom',
  completedOn: 'Fertiggestellt am',
}
// Höchstlänge wie die Bedingung `properties_ground_tax_file_number_valid` (Schutz gegen versehentlich Eingefügtes).
export const GROUND_TAX_FILE_NUMBER_MAX = 40

// Das Aktenzeichen, wie es in Zeile 6 gehört: „ohne Sonderzeichen“, also nur Ziffern und Buchstaben. Gespeichert bleibt
// es wie eingegeben, denn die Formate sind je Land verschieden und eine Prüfung der Form wäre geraten.
export const fileNumberDigits = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '')

// Ein Tag des Kopfs: leer, 'JJJJ-MM-TT' (Kalenderfeld) oder deutsch 'T.M.JJJJ'; ein Tag, den es nicht gibt, ist ein Fehler.
export function headerDateText(text: string): { date: string | null } | { error: string } {
  const t = text.trim()
  if (t === '') return { date: null }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : de ? [de[3], de[2], de[1]] : []
  if (y === undefined || m === undefined || d === undefined) return { error: 'kein Datum; bitte als TT.MM.JJJJ oder im Kalender wählen' }
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const check = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) return { error: 'diesen Tag gibt es nicht' }
  return { date }
}

// Ist am Objekt etwas aus dem Kopf der Anlage V eingetragen? Dann steht der Abschnitt offen.
export const hasTaxHeader = (p: Property): boolean => TAX_HEADER_FIELDS.some((f) => (p[f] ?? null) !== null)
const taxHeaderOf = (p: Property): TaxHeaderForm => ({
  groundTaxFileNumber: p.groundTaxFileNumber ?? '',
  purchaseContractOn: p.purchaseContractOn ?? '',
  ownershipTransferOn: p.ownershipTransferOn ?? '',
  buildingApplicationOn: p.buildingApplicationOn ?? '',
  completedOn: p.completedOn ?? '',
})

export type CableAnswer = 'vor' | 'nach' | 'unbekannt'
export const CABLE_LABELS: Record<CableAnswer, string> = {
  unbekannt: 'unbekannt oder keine Anlage',
  vor: 'vor dem 01.12.2021 errichtet',
  nach: 'ab dem 01.12.2021 errichtet',
}

// § 5d Abs. 1 Nr. 1 und Abs. 3 Satz 2 CO2KostAufG (Heizung PR 18): ob das Gebäude in einem Gebiet liegt, das eine
// der drei Verordnungen nach dem BGB bestimmt (Prüfung S9).
export type TightMarketAnswer = 'unbekannt' | 'ja' | 'nein'
export const TIGHT_MARKET_LABELS: Record<TightMarketAnswer, string> = {
  unbekannt: 'weiß ich nicht',
  ja: 'ja, das Gebäude liegt in einem solchen Gebiet',
  nein: 'nein',
}

// Das Bundesland (shared/holidays.ts). Leer steht vorn und sagt, was dann gilt; die Länder folgen in der
// Reihenfolge der Liste, die Kürzel sind die Werte, damit Auswahl und gespeicherter Wert dieselben sind.
// Kurz, damit der Eintrag am Handy ganz zu sehen ist (#346 Schritt 7b); was dann gilt, sagt der Hinweis am Feld.
export const STATE_UNKNOWN_LABEL = 'unbekannt'
export const STATE_UNKNOWN_HINT = 'Ohne Bundesland zählen nur die bundesweiten Feiertage.'
export const STATE_OPTIONS: readonly { value: FederalState | ''; label: string }[] = [
  { value: '', label: STATE_UNKNOWN_LABEL },
  ...STATES.map((s) => ({ value: s.code, label: s.name })),
]

// Ein Wert der Auswahl, wie sie ihn meldet: alles außer einem der 16 Kürzel heißt unbekannt.
export const stateFromSelect = (v: string): FederalState | '' => (isFederalState(v) ? v : '')

// Was zum gewählten Land unter der Auswahl steht: die Feiertage, die dort nur in einzelnen Gemeinden
// gelten und die Mietfuchs deshalb nicht mitzählt. `null`, wenn es keine gibt.
export function stateNote(state: FederalState | '', year: number): string | null {
  if (state === '') return null
  const local = localHolidaysOf(year, state)
  if (local.length === 0) return null
  const names = local.map((h) => `${h.name} (${h.where})`).join('; ')
  return `In ${stateName(state)} gelten einige Feiertage nur in einzelnen Gemeinden: ${names}. Mietfuchs zählt sie bei Fristen nicht mit.`
}

export type PropertyBody = Pick<Property, 'name' | 'address' | 'kind' | 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact' | 'cableBuiltBeforeDec2021' | 'tightMarket' | 'tightMarketFrom' | 'tightMarketTo' | 'state'>
  & Partial<Pick<Property, TaxHeaderField | 'spreadRestYear'>>

// ---------- Vorzeitiges Ende der Verteilung (§ 82b Abs. 2 EStDV, #262 PR 4, Entwurf E-7) ----------
//
// Ein Jahr am Objekt für alle verteilten Positionen: Im Jahr des Verkaufs, der Schenkung, des Erbfalls oder des Endes der
// Vermietung wird der noch nicht abgezogene Rest abgezogen; Mietfuchs rechnet es in der Steuerübersicht (outflow.ts).
// Dieselbe Beschriftung im Verlauf (`FIELD_LABELS` in journalView.ts).
export const SPREAD_REST_LABEL = 'Verkauft, verschenkt, vererbt oder Vermietung beendet im Jahr'
// Der Eintrag ohne Jahr, kurz, damit die Auswahl am Handy nichts abschneidet.
export const SPREAD_REST_NONE = 'nichts davon'
// Eine Position, wie die Liste der Kosten sie liefert, so weit die Verteilung sie braucht.
export type SpreadRestItem = Pick<CostItem, 'description' | 'period' | 'category' | 'amountCents'> & Partial<Pick<CostItem, 'paidOn' | 'taxYear' | 'spreadYears' | 'operatingPower'>>
const spreadOnly = (items: readonly SpreadRestItem[]) =>
  items.filter((c): c is SpreadRestItem & { spreadYears: NonNullable<CostItem['spreadYears']> } =>
    c.spreadYears != null && allowsSpread({ category: c.category, amountCents: c.amountCents, operatingPower: c.operatingPower ?? null }))
// Das Feld steht nur da, wenn das Objekt eine Position mit gerechneter Verteilung hat, oder wenn ein Jahr gespeichert ist
// (sonst ließe es sich nicht mehr leeren).
export const showsSpreadRest = (items: readonly SpreadRestItem[], saved: string): boolean => saved !== '' || spreadOnly(items).length > 0
// Die Jahre der Auswahl: vom ersten Beginn bis zum letzten Ende einer Verteilung. **Der angezeigte Wert entspricht dem
// gespeicherten**: Ein Jahr außerhalb steht mit da, sonst zeigte der Browser den ersten Eintrag (CLAUDE.md, Tests Ebene 3).
// `current`: die Wahl im Formular; ein gespeichertes Jahr außerhalb bleibt auch nach einer anderen Wahl wählbar (K1).
export function spreadRestOptions(items: readonly SpreadRestItem[], saved: string, current: string = saved): number[] {
  const spans = spreadOnly(items).map(spreadSpan)
  const first = Math.min(...spans.map((x) => x.from))
  const last = Math.max(...spans.map((x) => x.to))
  const years = spans.length === 0 ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const extra = [saved, current].filter((v) => v !== '').map(Number).filter((y) => Number.isInteger(y) && !years.includes(y))
  return [...years, ...new Set(extra)].sort((a, b) => a - b)
}
// Die Rückfrage beim Speichern, dieselbe wie am Server (409 `question: 'spread'`, bestätigt mit `confirmSpread`); leer,
// wenn das Jahr nicht mitgeht oder keine Position betroffen ist.
export function spreadRestChange(saved: string, body: Pick<PropertyBody, 'spreadRestYear'>, items: readonly SpreadRestItem[]): string[] {
  if (!('spreadRestYear' in body)) return []
  return spreadRestQuestions(saved === '' ? null : Number(saved), body.spreadRestYear ?? null, items)
}

// Die Vorbelegung der Bezeichnung, wenn das Objekt noch keine hat (Durchsicht zu #346, Schritt 3). Eine frische
// Installation legt ihr erstes Objekt ohne Namen an (Migration 0001 übernimmt `house_name`, und der ist dort leer).
// Seit die Bezeichnung Pflicht ist (M12), verlangte schon das erste Speichern der Karte, etwa nur der Adresse,
// einen Namen. Vorbelegt wird in der Karte und nicht in der Datenbank: Ein Migrationsschritt änderte vorhandene
// Bestände, und ein Name, den der Vermieter nie gesehen hat, stünde dann still auf jeder Abrechnung. So steht er
// im Feld, lässt sich überschreiben und wird mit dem ersten Speichern übernommen.
export const PROPERTY_NAME_DEFAULT = 'Mein Objekt'

// Weicht das Objekt bei Vermieter, Bank, Frist, Anschrift oder Kontakt von den Einstellungen ab?
const ownLandlord = (p: Property): boolean =>
  p.landlordName !== null || p.iban !== null || p.paymentDeadlineDays !== null || (p.landlordAddress ?? null) !== null || (p.landlordContact ?? null) !== null

export const propertyToForm = (p: Property): PropertyForm => ({
  name: p.name.trim() === '' ? PROPERTY_NAME_DEFAULT : p.name,
  address: p.address,
  kind: p.kind,
  own: ownLandlord(p),
  landlordName: p.landlordName ?? '',
  iban: ibanToInput(p.iban),
  paymentDeadlineDays: p.paymentDeadlineDays === null ? '' : String(p.paymentDeadlineDays),
  landlordAddress: p.landlordAddress ?? '',
  landlordContact: p.landlordContact ?? '',
  cable: p.cableBuiltBeforeDec2021 === true ? 'vor' : p.cableBuiltBeforeDec2021 === false ? 'nach' : 'unbekannt',
  tightMarket: p.tightMarket === true ? 'ja' : p.tightMarket === false ? 'nein' : 'unbekannt',
  tightMarketFrom: p.tightMarketFrom ?? '',
  tightMarketTo: p.tightMarketTo ?? '',
  state: p.state ?? '',
  ...taxHeaderOf(p),
  taxSaved: taxHeaderOf(p),
  spreadRestYear: p.spreadRestYear == null ? '' : String(p.spreadRestYear),
  spreadRestSaved: p.spreadRestYear == null ? '' : String(p.spreadRestYear),
})

// Das leere Formular für ein neues Objekt: dieselben Felder wie beim Bearbeiten, jede Angabe auf ihrer
// Voreinstellung (unbekannt, keine Abweichung), damit das neue Objekt rechnet wie eines, das man nie bearbeitet hat.
export const EMPTY_PROPERTY_FORM: PropertyForm = {
  name: '', address: '', kind: 'mfh', own: false, landlordName: '', iban: '', paymentDeadlineDays: '', landlordAddress: '', landlordContact: '',
  cable: 'unbekannt', tightMarket: 'unbekannt', tightMarketFrom: '', tightMarketTo: '', state: '',
  ...EMPTY_TAX_HEADER, taxSaved: EMPTY_TAX_HEADER, spreadRestYear: '', spreadRestSaved: '',
}

// **Ein leeres Feld heißt „Vorgabe“, auch mit Haken.** Wer den Haken setzt, um nur eine andere
// IBAN einzutragen, meint mit dem leeren Vermieternamen nicht „kein Vermieter“; sonst fehlte
// der Name auf der gedruckten Abrechnung, still und auf einem Dokument für den Mieter. Die
// Unterscheidung von `null` und `''` bleibt im Datenmodell erhalten, nur diese Karte bietet
// „bewusst keine“ nicht an.
//
// Die IBAN wird geprüft (#279), aber nur eine neue oder geänderte: Eine gespeicherte ungültige
// (`storedIban`) geht unverändert mit, damit die übrigen Angaben trotzdem gespeichert werden.
// Die Felder der Karte mit Meldung (#346, Schritt 3).
export type PropertyField = 'name' | 'iban' | 'paymentDeadlineDays' | TaxHeaderField
// `problems` nennt alle Angaben auf einmal (#346, Schritt 3); `error`, `field` und `short` sind die erste davon.
export type PropertyBodyError = { error: string; field?: PropertyField; short?: string; problems: Problem<PropertyField>[] }
export function propertyBody(form: PropertyForm, storedIban: string | null = null): PropertyBody | PropertyBodyError {
  const problems: Problem<PropertyField>[] = []
  // Die Bezeichnung ist Pflicht (UI-Durchsicht M12): Leer gespeichert hieß das Objekt in der Seitenleiste „Ohne Namen“.
  if (!form.name.trim()) problems.push({ text: 'Bezeichnung: Geben Sie dem Objekt einen Namen, etwa „Mehrfamilienhaus Musterstraße“.', field: 'name', short: 'Bezeichnung fehlt' })
  const override = (value: string): string | null => (form.own && value.trim() !== '' ? value.trim() : null)
  const iban = ibanForSave(override(form.iban) ?? '', storedIban, IBAN_LABELS.property)
  if ('error' in iban) problems.push({ text: iban.error, field: 'iban', short: 'IBAN ungültig' })
  const deadlineText = override(form.paymentDeadlineDays)
  const deadline = deadlineText === null ? null : Number(deadlineText)
  if (deadline !== null && (!Number.isInteger(deadline) || deadline < 0)) {
    problems.push({ text: 'Die Zahlungsfrist ist eine ganze Zahl von Tagen, 0 oder mehr.', field: 'paymentDeadlineDays', short: 'Ganze Zahl von Tagen' })
  }
  // Die Geltung der Verordnung nur bei „ja“ (Abweichung 4 des Plans zu Heizung PR 18).
  const yes = form.tightMarket === 'ja'
  const tightFrom = yes && form.tightMarketFrom !== '' ? form.tightMarketFrom : null
  const tightTo = yes && form.tightMarketTo !== '' ? form.tightMarketTo : null
  if (tightFrom !== null && tightTo !== null && tightFrom > tightTo) problems.push({ text: 'Der Beginn der Verordnung liegt nach dem Ende. Bitte prüfen Sie beide Tage.' })
  // Kopf der Anlage V (#96 PR 2): nur, was vom Gespeicherten abweicht; leer heißt `null`.
  const header: Partial<Pick<Property, TaxHeaderField>> = {}
  const fileNumber = form.groundTaxFileNumber.trim()
  if (fileNumber.length > GROUND_TAX_FILE_NUMBER_MAX) {
    problems.push({ text: `${TAX_HEADER_LABELS.groundTaxFileNumber}: höchstens ${GROUND_TAX_FILE_NUMBER_MAX} Zeichen.`, field: 'groundTaxFileNumber', short: `Höchstens ${GROUND_TAX_FILE_NUMBER_MAX} Zeichen` })
  } else if (fileNumber !== form.taxSaved.groundTaxFileNumber.trim()) {
    header.groundTaxFileNumber = fileNumber === '' ? null : fileNumber
  }
  for (const field of TAX_HEADER_FIELDS) {
    if (field === 'groundTaxFileNumber') continue
    const parsed = headerDateText(form[field])
    if ('error' in parsed) {
      problems.push({ text: `${TAX_HEADER_LABELS[field]}: ${parsed.error}.`, field, short: 'Kein Datum' })
      continue
    }
    const saved = headerDateText(form.taxSaved[field])
    if (parsed.date !== ('date' in saved ? saved.date : null)) header[field] = parsed.date
  }
  const first = problems[0]
  if (first || 'error' in iban) {
    const head = first ?? { text: '' }
    return { error: head.text, ...(head.field ? { field: head.field } : {}), ...(head.short ? { short: head.short } : {}), problems }
  }
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    kind: form.kind,
    landlordName: override(form.landlordName),
    iban: iban.value === '' ? null : iban.value,
    paymentDeadlineDays: deadline,
    landlordAddress: override(form.landlordAddress),
    landlordContact: override(form.landlordContact),
    cableBuiltBeforeDec2021: form.cable === 'vor' ? true : form.cable === 'nach' ? false : null,
    tightMarket: yes ? true : form.tightMarket === 'nein' ? false : null,
    tightMarketFrom: tightFrom,
    tightMarketTo: tightTo,
    state: form.state === '' ? null : form.state,
    ...header,
    ...(form.spreadRestYear !== form.spreadRestSaved ? { spreadRestYear: form.spreadRestYear === '' ? null : Number(form.spreadRestYear) } : {}),
  }
}

// Die Angaben der Karte „Objekt“ zum Lesen: Die Karte zeigt nur an, bearbeitet wird im Seitenfenster wie bei
// Wohnungen und Mietverhältnissen (Spezifikation Abschnitt 4, „Anlegen oder Bearbeiten heißt Seitenfenster“).
// Was fehlt, sagt es; Vermieter, IBAN und Zahlungsfrist stehen nur, wenn das Objekt abweicht, sonst ein Satz,
// dass die Einstellungen gelten.
export function propertySummary(p: Property): { label: string; value: string }[] {
  const none = 'nicht angegeben'
  const tight = p.tightMarket === true ? 'ja' : p.tightMarket === false ? 'nein' : 'unbekannt'
  const span = [p.tightMarketFrom && `seit ${fmtDate(p.tightMarketFrom)}`, p.tightMarketTo && `bis ${fmtDate(p.tightMarketTo)}`].filter(Boolean).join(' ')
  const rows = [
    { label: 'Bezeichnung', value: p.name.trim() || none },
    { label: 'Adresse', value: p.address.trim() || none },
    { label: 'Art', value: PROPERTY_KIND_LABELS[p.kind] },
    { label: 'Bundesland', value: p.state ? stateName(p.state) : STATE_UNKNOWN_LABEL },
    { label: 'Kabel- oder Antennenanlage', value: CABLE_LABELS[p.cableBuiltBeforeDec2021 === true ? 'vor' : p.cableBuiltBeforeDec2021 === false ? 'nach' : 'unbekannt'] },
    { label: 'Angespannter Wohnungsmarkt', value: tight === 'ja' && span ? `ja, Verordnung ${span}` : tight },
  ]
  // Kopf der Anlage V (#96 PR 2), nur wenn etwas eingetragen ist.
  if (hasTaxHeader(p)) {
    const parts = [
      p.groundTaxFileNumber ? `Aktenzeichen ${p.groundTaxFileNumber}` : null,
      ...TAX_HEADER_FIELDS.filter((f) => f !== 'groundTaxFileNumber').map((f) => { const v = p[f]; return v ? `${TAX_HEADER_LABELS[f]} ${fmtDate(v)}` : null }),
    ].filter((x): x is string => x !== null)
    rows.push({ label: 'Für die Steuer (Anlage V)', value: parts.join(', ') })
  }
  if (p.spreadRestYear != null) rows.push({ label: SPREAD_REST_LABEL, value: String(p.spreadRestYear) })
  if (!ownLandlord(p)) {
    return [...rows, { label: 'Vermieter und Bankverbindung', value: 'wie in den Einstellungen' }]
  }
  // `null` heißt Vorgabe aus den Einstellungen, `''` bewusst keine (nur aus Altbestand oder Import, siehe propertyBody).
  const shown = (v: string | null, show: (v: string) => string): string => (v === null ? 'wie in den Einstellungen' : v === '' ? 'keine' : show(v))
  return [
    ...rows,
    { label: 'Vermieter', value: shown(p.landlordName, (v) => v) },
    { label: 'IBAN', value: shown(p.iban, (v) => `${ibanToInput(v)}${storedIbanInvalid(v) ? ' (vermutlich falsch eingetragen, bitte prüfen)' : ''}`) },
    { label: 'Zahlungsfrist', value: p.paymentDeadlineDays === null ? 'wie in den Einstellungen' : `${p.paymentDeadlineDays} Tage` },
    { label: 'Anschrift des Vermieters', value: shown(p.landlordAddress ?? null, (v) => v) },
    { label: 'Kontakt', value: shown(p.landlordContact ?? null, (v) => v) },
  ]
}
