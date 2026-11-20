// Seitenfenster „Mieterhöhung“ (#191, PR 2), ohne DOM, damit es prüfbar bleibt (rentIncreaseForm.test.ts). Gerechnet wird
// auf dem Server (server/src/rentIncrease.ts, POST /api/tenancies/:id/rent-increase/plan); hier stehen der Zustand des
// Fensters, Vorgaben, Auswahllisten, der Rumpf der Rechnung mit Meldungen am Feld und die Wörter für den Zustand. Ein
// Schreiben und das Übernehmen in die Staffel kommen mit PR 3.
import type { Property, RentCapAnswer, RentIncreaseKind, RentIncreaseNeed, RentIncreaseRequest, RentIncreaseState, RentIndexValue, Tenancy, Unit } from './types'
import type { Checked, Problem } from './formProblems'
import { parseEuro } from './api'
import { parseNumberDe } from './numbers'
import { parseMonthText } from './monthText'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { bgbRentCap } from '../../shared/law/bgb-betrkv.ts'
import { CURRENT_INDEX_BASE } from './rentKindForm'

// Der Zustand des Fensters (`value` des Drawer), Texte wie eingegeben. Leer heißt: die Vorgabe der Rechnung.
export type RentIncreaseValue = {
  kind: RentIncreaseKind
  receivedOn: string // <input type="date">
  effectiveFrom: string // Monatsfeld
  allStepsEntered: boolean
  residential: boolean
  noThirdPartyFunds: boolean
  rentCap: RentCapAnswer
  rentAtCapDate: string
  rentAtCapDateOn: string // der Tag, den das Feld beim Eingeben nannte (Durchsicht K1); leer, solange keiner bekannt ist
  comparison: string
  rangeLow: string
  rangeHigh: string
  area: string
  operatingCosts: string
  requested: string
  fromMonth: string
  fromValue: string
  fromBase: string
  toMonth: string
  toValue: string
  toBase: string
}
export type RentIncreaseField = Exclude<keyof RentIncreaseValue, 'kind' | 'allStepsEntered' | 'residential' | 'noThirdPartyFunds' | 'rentCap' | 'rentAtCapDateOn'>

export const RENT_INCREASE_STATE_LABELS: Record<RentIncreaseState, string> = {
  possible: 'Möglich',
  notYet: 'Noch nicht möglich',
  blocked: 'Nicht möglich',
}

export function rentIncreaseKindOptions(): { value: RentIncreaseKind; label: string }[] {
  return [{ value: 'comparison', label: 'Bis zur Vergleichsmiete (§ 558 BGB)' }, { value: 'index', label: 'Indexmiete anpassen (§ 557b BGB)' }]
}

const CAP = valueAt(bgbRentCap, LAW_AS_OF)
// Immer alle drei, damit der gespeicherte bzw. vorbelegte Wert sichtbar bleibt.
export function rentCapOptions(): { value: RentCapAnswer; label: string }[] {
  return [
    { value: 'yes', label: `Ja (${CAP.reducedPercent} %)` },
    { value: 'no', label: `Nein (${CAP.percent} %)` },
    { value: 'unknown', label: `Weiß nicht (gerechnet mit ${CAP.reducedPercent} %)` },
  ]
}
export const RENT_CAP_HINT = 'Gilt am Tag des Zugangs oder des Wirksamwerdens in der Gemeinde eine Verordnung, die die Kappungsgrenze senkt? Vorbelegt mit der Angabe am Objekt; prüfen Sie sie vor jedem Verlangen.'

const areaText = (m2: number): string => m2.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// Vorgaben beim Öffnen: Art nach der Art der Miete, Kappungsgrenze vom Objekt, Fläche der Wohnung; Zugang und Monat leer
// (die Rechnung nimmt heute und den frühestmöglichen Monat).
export function rentIncreaseStart(t: Pick<Tenancy, 'rentKind'>, unit: Pick<Unit, 'areaM2'> | undefined, property: Pick<Property, 'rentCapReduced'> | null | undefined): RentIncreaseValue {
  const capOf = property?.rentCapReduced
  return {
    kind: t.rentKind === 'index' ? 'index' : 'comparison',
    receivedOn: '', effectiveFrom: '',
    allStepsEntered: false, residential: false, noThirdPartyFunds: false,
    rentCap: capOf === true ? 'yes' : capOf === false ? 'no' : 'unknown',
    rentAtCapDate: '', rentAtCapDateOn: '', comparison: '', rangeLow: '', rangeHigh: '',
    area: unit && unit.areaM2 > 0 ? areaText(unit.areaM2) : '',
    operatingCosts: '', requested: '',
    fromMonth: '', fromValue: '', fromBase: '', toMonth: '', toValue: '', toBase: '',
  }
}

const FIELD_NAMES: Record<RentIncreaseField, string> = {
  receivedOn: 'Zugang beim Mieter', effectiveFrom: 'Wirksam ab', rentAtCapDate: 'Miete am Stichtag', comparison: 'Vergleichsmiete je m²',
  rangeLow: 'Spanne von', rangeHigh: 'Spanne bis', area: 'Wohnfläche', operatingCosts: 'Enthaltene Betriebskosten', requested: 'Verlangte Miete',
  fromMonth: 'Ausgangsindex, Monat', fromValue: 'Ausgangsindex, Wert', fromBase: 'Ausgangsindex, Basisjahr',
  toMonth: 'Neuer Index, Monat', toValue: 'Neuer Index, Wert', toBase: 'Neuer Index, Basisjahr',
}
const problem = (field: RentIncreaseField, short: string, text: string): Problem<RentIncreaseField> => ({ field, short, text: `${FIELD_NAMES[field]}: ${text}` })

// Der Rumpf der Rechnung, oder die Meldungen am Feld. Der Server prüft dasselbe noch einmal. `stepBase` ist das Basisjahr
// des Indexwerts der bisherigen Stufe (Durchsicht K2): Trägt sie eine andere Basis als die aktuelle Reihe, gilt ein leeres
// Basisjahr des Ausgangsindex nicht still als die aktuelle.
export function rentIncreaseRequest(v: RentIncreaseValue, ctx: { stepBase?: number | null } = {}): Checked<RentIncreaseRequest, RentIncreaseField> {
  const problems: Problem<RentIncreaseField>[] = []
  const body: RentIncreaseRequest = { kind: v.kind }
  if (v.receivedOn.trim() !== '') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.receivedOn)) body.receivedOn = v.receivedOn
    else problems.push(problem('receivedOn', 'Kein Datum', 'Geben Sie das Datum ein, an dem das Schreiben beim Mieter ankommt.'))
  }
  const month = (field: RentIncreaseField, text: string): string | undefined => {
    const m = parseMonthText(text)
    if (m.kind === 'month') return m.key
    if (m.kind === 'invalid') problems.push(problem(field, m.short, m.text))
    return undefined
  }
  const effective = month('effectiveFrom', v.effectiveFrom)
  if (effective) body.effectiveFrom = effective
  body.allStepsEntered = v.allStepsEntered
  body.residential = v.residential
  const cents = (field: RentIncreaseField, text: string): number | undefined => {
    if (text.trim() === '') return undefined
    const c = parseEuro(text)
    if (c === null || c < 0) {
      problems.push(problem(field, 'Kein Betrag', 'Geben Sie einen Betrag in Euro ein, etwa „8,50“.'))
      return undefined
    }
    return c
  }
  if (v.kind === 'comparison') {
    body.noThirdPartyFunds = v.noThirdPartyFunds
    body.rentCap = v.rentCap
    const entries: [RentIncreaseField, 'rentAtCapDateCents' | 'comparisonCentsPerM2' | 'rangeLowCentsPerM2' | 'rangeHighCentsPerM2'][] = [
      ['rentAtCapDate', 'rentAtCapDateCents'], ['comparison', 'comparisonCentsPerM2'], ['rangeLow', 'rangeLowCentsPerM2'], ['rangeHigh', 'rangeHighCentsPerM2'],
    ]
    for (const [field, key] of entries) {
      const c = cents(field, v[field])
      if (c !== undefined) body[key] = c
    }
    if (body.rentAtCapDateCents !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v.rentAtCapDateOn)) body.rentAtCapDateOn = v.rentAtCapDateOn
    if (v.area.trim() !== '') {
      const a = parseNumberDe(v.area)
      if (a === null || !(a > 0)) problems.push(problem('area', 'Keine Fläche', 'Geben Sie die tatsächliche Wohnfläche in m² ein, etwa „61,5“.'))
      else body.areaM2 = a
    }
    const operating = cents('operatingCosts', v.operatingCosts)
    if (operating !== undefined) body.operatingCostsCents = operating
    const requested = cents('requested', v.requested)
    if (requested !== undefined) body.requestedCents = requested
  } else {
    const index = (prefix: 'from' | 'to'): RentIndexValue | undefined => {
      const monthField = `${prefix}Month` as const
      const valueField = `${prefix}Value` as const
      const baseField = `${prefix}Base` as const
      if (v[monthField].trim() === '' && v[valueField].trim() === '') return undefined
      const m = month(monthField, v[monthField])
      if (v[monthField].trim() === '') problems.push(problem(monthField, 'Monat fehlt', 'Geben Sie den Monat des Indexwerts ein, etwa „10.2026“.'))
      const value = parseNumberDe(v[valueField])
      const tenths = value === null ? 0 : Math.round(value * 10)
      if (value === null || tenths <= 0 || Math.abs(value * 10 - tenths) > 1e-6) problems.push(problem(valueField, 'Kein Indexwert', 'Geben Sie den Wert mit höchstens einer Nachkommastelle ein, etwa „106,1“.'))
      const stepBase = prefix === 'from' && ctx.stepBase != null && String(ctx.stepBase) !== CURRENT_INDEX_BASE ? ctx.stepBase : null
      if (v[baseField].trim() === '' && stepBase !== null) {
        problems.push(problem(baseField, 'Basisjahr fehlt', `Die bisherige Stufe nennt die Basis ${stepBase}, leer hieße die aktuelle Reihe (Basis ${CURRENT_INDEX_BASE}). Geben Sie das Basisjahr des Werts ein.`))
        return undefined
      }
      const baseText = v[baseField].trim() === '' ? CURRENT_INDEX_BASE : v[baseField].trim()
      const base = /^\d{4}$/.test(baseText) ? Number(baseText) : null
      if (base === null) problems.push(problem(baseField, 'Kein Jahr', 'Geben Sie das Basisjahr der Reihe ein, etwa „2020“; leer heißt die aktuelle Reihe.'))
      return m && value !== null && tenths > 0 && base !== null ? { month: m, value: tenths / 10, base } : undefined
    }
    const from = index('from')
    const to = index('to')
    if (from) body.fromIndex = from
    if (to) body.toIndex = to
  }
  return problems.length > 0 ? { problems } : { body }
}

// Welche Felder eine Angabe brauchen, die die Rechnung vermisst (zum Hervorheben).
export const NEED_FIELDS: Partial<Record<RentIncreaseNeed, RentIncreaseField>> = {
  rentAtCapDate: 'rentAtCapDate', comparisonRent: 'comparison', operatingCosts: 'operatingCosts', fromIndex: 'fromValue', toIndex: 'toValue',
}
