// „Aus dem Vorjahr übernehmen“ (#141): Die Positionen des Vorjahres desselben Objekts werden zur
// Vorlage für das gewählte Jahr. Mit kommen Kostenart, Beschreibung (Jahreszahl ersetzt),
// Rechnungssteller und der Schlüssel samt Angaben; leer bleiben der Betrag, der §35a-Anteil und die
// Kosten der Gemeinschaft, denn das sind die Zahlen des Jahres. Kein Beleg.
//
// Die Vorlagen leben nur im Browser und nicht als Entwürfe in der Datenbank: Eine Position ohne
// Betrag wäre dort eine 0, die in jede Rechnung einginge, oder ein Entwurfs-Kennzeichen, das jede
// Rechnung kennen müsste (siehe docs/superpowers/specs/2026-10-02-schluessel-merken-design.md).
// Gespeichert wird nur, was durch `buildCostItemBody` geht, also dieselbe Prüfung wie im Formular.
import type { BillingPeriod, CostItem, PeriodKey, PeriodRules, Tenancy, Unit } from './types'
import { buildCostItemBody, fmtPct, itemToForm, type BuildResult, type ItemForm } from './costForm'
import { replaceYear } from '../../shared/allocation.ts'
import { normalizedText, sameCostCandidates } from '../../shared/duplicates.ts'
import { calendarContext, formatDayRange, periodLabel, spansTwoYears, type PeriodContext } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { hasOwnRhythm, heatingPeriodsEndingIn, plantRules } from '../../shared/heatingPeriod.ts'
import { filedUnderSettlement, settlementKeyOf, type PlantPeriods } from './costPeriods'

// Die Anlagen des Objekts und seine Regeln: Eine Heizposition mit eigener Heizperiode gehört zum
// Zeitraum, in dem ihre Heizperiode endet (costPeriods.ts). Ohne sie gilt der Schlüssel der Position.
export type CarryHeating = { rules: PeriodRules; plants: readonly PlantPeriods[] }

// Die Jahreszahl ersetzt dieselbe Regel, mit der der gemerkte Schlüssel die Beschreibung vergleicht.
export { replaceYear }

export type CarryRow = {
  source: CostItem
  description: string
  vendor: string
  amount: string
  labor35a: string
  // Nur bei „laut Gemeinschaftsabrechnung“: die Kosten der ganzen Anlage im neuen Jahr
  externalTotalAmount: string
  checked: boolean
  // Steht im Jahr schon eine Position, die dieselbe Rechnung sein könnte (alreadyCarried)?
  already: boolean
  // Einzelbeträge je Mieter lassen sich nicht in einer Zeile eintragen, nur im Formular.
  inline: boolean
  // Das Jahr der Zahlung (#208), um den Abstand der Zeiträume verschoben: Wer 2024/2025 im Jahr
  // 2025 gezahlt hat, zahlt 2025/2026 im Jahr 2026. Leer, wenn die Vorlage keines trägt.
  taxYear?: string
  // Eine Heizposition mit eigener Heizperiode: die Heizperiode derselben Anlage, die im Ziel endet.
  // `null`: keine Heizposition dieser Art, oder es enden keine oder mehrere (dann im Formular, wie beim
  // Neuanlegen).
  heating: { plantId: string; period: PeriodKey } | null
  // Warum die Zeile nur im Formular übernommen werden kann
  formReason?: string
  // Wohin eine Heizposition kommt: Heizperiode und Jahr der Zahlung, bei einer Vorlage ohne Anlage
  // auch die Anlage, die der Server sonst still zuordnete (`defaultHeatingPlant`, Durchsicht).
  heatingNote?: string
}

// Steht im Jahr schon eine Position, die dieselbe Rechnung sein könnte? Die Regel ist die gemeinsame
// aus shared/duplicates.ts (Befund B): dieselbe Kostenart, bei einer breiten zusätzlich ähnliche
// Beschreibung oder derselbe Rechnungssteller. Ein Vergleich der Beschreibung allein traf nie, wenn
// die Rechnung vorher per KI erfasst war, denn die KI beschreibt anders als die Vorlage.
// Ausgenommen ist eine Position, die genau die Übernahme einer anderen Vorjahresposition derselben
// Kostenart ist: Wer Restmüll und Biomüll getrennt führt und Restmüll schon übernommen hat, soll
// Biomüll nicht als erfasst sehen. Die Seite fragt das bei jeder Anzeige neu, damit eine über das
// Formular angelegte Zeile gleich vermerkt ist. Gefragt wird mit dem Vorzeichen der Vorlage: Eine
// Gutschrift des Vorjahres ist nie durch eine Rechnung schon erfasst und umgekehrt (rc.1).
// `at`: der gewählte Zeitraum mit seinem Vorzeitraum (#208); eine Jahreszahl ist das Kalenderjahr.
export function alreadyCarried(items: readonly CostItem[], row: Pick<CarryRow, 'source' | 'description'> & Partial<Pick<CarryRow, 'vendor'>>, at: number | PeriodContext): boolean {
  const ctx = typeof at === 'number' ? calendarContext(at) : at
  const category = row.source.category
  const previous = ctx.previous
  const sisters = items
    .filter((i) => i.period === previous && i.category === category && i.id !== row.source.id)
    .map((i) => normalizedText(i.description))
  const own = normalizedText(row.description)
  return sameCostCandidates(items, { period: ctx.key, category, description: row.description, vendor: row.vendor ?? row.source.vendor, amountCents: row.source.amountCents })
    .some((i) => {
      const text = normalizedText(i.description)
      return text === own || !sisters.includes(text)
    })
}

// `target`: der Zeitraum, in den übernommen wird. Reicht er über zwei Kalenderjahre, braucht jede
// Zeile ein Jahr der Zahlung (Entwurf 3.10): das der Vorlage, um den Abstand der Zeiträume
// verschoben und in die erlaubte Spanne geklemmt; trägt die Vorlage keines (etwa direkt nach einem
// Wechsel), das Jahr, in dem das Ziel beginnt, wie beim Anlegen (Durchsicht von #226, I2).
export function carryOverRows(items: readonly CostItem[], at: number | PeriodContext, target?: Pick<BillingPeriod, 'from' | 'to'>, heating?: CarryHeating): CarryRow[] {
  const ctx = typeof at === 'number' ? calendarContext(at) : at
  // „Schon erfasst“ vergleicht nach dem Zeitraum der Abrechnung, sonst sähe eine Heizposition unter
  // ihrer Heizperiode nie wie eine des Ziels aus.
  const filed = heating ? filedUnderSettlement(items, () => heating.rules, () => heating.plants) : items
  const keyOf = (i: CostItem) => (heating ? settlementKeyOf(i, heating.rules, heating.plants).key : i.period)
  // Die Heizperiode der Anlage, die im Ziel endet; `'ask'` bei keiner oder mehreren.
  // Eine Vorlage ohne Anlage bekommt beim Speichern die einzige Anlage des Objekts (Server,
  // `defaultHeatingPlant`); dieselbe Regel hier, damit die Zeile es vorher sagt.
  const plantOf = (source: CostItem): PlantPeriods | undefined => {
    if (!heating) return undefined
    if (source.heatingPlantId) return heating.plants.find((p) => p.id === source.heatingPlantId)
    return source.category === HEATING_CATEGORY && heating.plants.length === 1 ? heating.plants[0] : undefined
  }
  const heatingOf = (source: CostItem): { plantId: string; period: PeriodKey; from: string; to: string; short: boolean } | 'ask' | null => {
    const plant = plantOf(source)
    if (!heating || !plant || !hasOwnRhythm(plant)) return null
    if (target === undefined) return source.heatingPlantId ? 'ask' : null
    const ending = heatingPeriodsEndingIn(plantRules(plant, heating.rules), target)
    const only = ending.length === 1 ? ending[0] : undefined
    // Ohne eindeutige Heizperiode ordnet auch der Server eine Vorlage ohne Anlage nicht zu.
    if (!only) return source.heatingPlantId ? 'ask' : null
    return { plantId: plant.id, period: only.key, from: only.from, to: only.to, short: only.short }
  }
  const plantName = (source: CostItem): string => {
    const name = plantOf(source)?.name
    return name ? ` „${name}“` : ''
  }
  const taxYearOf = (source: CostItem): string => {
    if (target === undefined) return source.taxYear !== undefined ? String(source.taxYear + ctx.year - ctx.previousYear) : ''
    if (!spansTwoYears(target)) return ''
    const start = Number(target.from.slice(0, 4))
    const end = Number(target.to.slice(0, 4)) + 1
    const wanted = source.taxYear !== undefined ? source.taxYear + ctx.year - ctx.previousYear : start
    return String(Math.min(Math.max(wanted, start), end))
  }
  return items.filter((i) => keyOf(i) === ctx.previous).map((source) => {
    const description = replaceYear(source.description, ctx.previousYear, ctx.year)
    const h = heatingOf(source)
    // Das Jahr der Zahlung einer Heizposition richtet sich nach ihrer Heizperiode (wie im Formular):
    // verschoben aus der Vorlage, in deren Spanne geklemmt; ohne Angabe fragt das Formular.
    const heatingTax = h && h !== 'ask' ? taxYearIn(h, source) : ''
    const formReason = h === 'ask'
      ? 'Im Abrechnungszeitraum enden keine oder mehrere Heizperioden dieser Anlage. Bitte wählen Sie die Heizperiode im Formular („Im Formular öffnen“).'
      : h && heatingTax === null ? 'Bitte geben Sie das Jahr der Zahlung im Formular an („Im Formular öffnen“).' : undefined
    const where = h && h !== 'ask'
      ? `Heizperiode ${periodLabel({ key: h.period, from: h.from, to: h.to, short: h.short })}${h.short ? '' : ` (${formatDayRange(h.from, h.to)})`}${heatingTax ? `, Jahr der Zahlung ${heatingTax}` : ''}.`
      : ''
    const heatingNote = !source.heatingPlantId && plantOf(source)
      ? (where ? `Wird der Heizanlage${plantName(source)} zugeordnet: ${where}` : h === null ? `Wird der Heizanlage${plantName(source)} zugeordnet.` : undefined)
      : where || undefined
    return {
      source,
      description,
      vendor: source.vendor ?? '',
      amount: '',
      labor35a: '',
      externalTotalAmount: '',
      checked: false,
      already: alreadyCarried(filed, { source, description, vendor: source.vendor ?? '' }, ctx),
      inline: source.key !== 'amounts' && formReason === undefined,
      taxYear: h && h !== 'ask' ? heatingTax ?? '' : taxYearOf(source),
      heating: h && h !== 'ask' ? { plantId: h.plantId, period: h.period } : null,
      ...(formReason ? { formReason } : {}),
      ...(heatingNote ? { heatingNote } : {}),
    }
  })
  // Liegt die Heizperiode in einem Kalenderjahr, ist es dieses (kein Feld); reicht sie über zwei, das
  // Jahr der Vorlage um ein Jahr verschoben, geklemmt; ohne Angabe `null`.
  function taxYearIn(h: { from: string; to: string }, source: CostItem): string | null {
    if (!spansTwoYears(h)) return ''
    if (source.taxYear === undefined) return null
    const start = Number(h.from.slice(0, 4))
    const end = Number(h.to.slice(0, 4)) + 1
    return String(Math.min(Math.max(source.taxYear + 1, start), end))
  }
}

// Ein Betrag hakt die Zeile an, ein geleertes Feld ab; abhaken lässt sie sich jederzeit von Hand.
// Eine Zeile, die im Jahr schon erfasst ist, hakt der Betrag nicht an (Durchsicht): Sie anzulegen
// hieße, dieselbe Rechnung zweimal zu verteilen; wer das will, hakt sie selbst an und wird gefragt.
export function withCarryAmount(row: CarryRow, amount: string, already = false): CarryRow {
  return { ...row, amount, checked: !already && amount.trim() !== '' }
}

// Was die Liste beim Schlüssel zusätzlich zeigt (Durchsicht): die vereinbarten Anteile samt
// Summe, wenn sie nicht 100 % ergeben, und die Wohnung der Direktzuordnung. `warn` markiert, was
// geprüft werden sollte: Was unter 100 % fehlt, trägt der Vermieter; ohne Wohnung lässt sich die
// Zeile nicht anlegen.
export function carryKeyDetails(item: CostItem, units: Unit[]): { text: string, warn: boolean } | null {
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? '?'
  if (item.key === 'custom') {
    const shares = Object.entries(item.customShares ?? {})
    const sum = shares.reduce((a, [, p]) => a + p, 0)
    const list = shares.map(([id, p]) => `${name(id)}: ${fmtPct(p)} %`).join(' · ')
    const off = Math.abs(sum - 100) > 0.0001
    return { text: off ? `${list} (zusammen ${fmtPct(sum)} %)` : list, warn: off }
  }
  if (item.key === 'direct') {
    const unit = item.directUnitId ? units.find((u) => u.id === item.directUnitId) : undefined
    return unit ? { text: `direkt ${unit.name}`, warn: false } : { text: 'Wohnung fehlt', warn: true }
  }
  return null
}

// Das Formular einer Vorlage, auch für „Im Formular öffnen“: Schlüssel und Angaben des Vorjahres,
// alles, was eine Zahl des Jahres ist, aus der Zeile.
export function carryOverForm(row: CarryRow): ItemForm {
  return {
    ...itemToForm(row.source),
    id: undefined,
    description: row.description,
    vendor: row.vendor,
    amount: row.amount,
    labor35a: row.labor35a,
    externalTotalAmount: row.externalTotalAmount,
    tenancyAmounts: {},
    selfAmounts: {},
    // Ein Leistungszeitraum oder ein Jahr der Zahlung des Vorzeitraums gilt nicht für den neuen (#208).
    // Das Jahr der Zahlung kommt verschoben aus der Zeile (carryOverRows).
    serviceFrom: '', serviceTo: '', taxYear: row.taxYear ?? '',
    heatingFuel: row.source.heatingPart === 'fuel',
    invoiceFile: undefined,
  }
}

// `period`: der Zeitraum, in den übernommen wird (#208); eine Jahreszahl ist das Kalenderjahr.
// Der Rumpf einer Übernahme; bei einer Heizposition mit eigener Heizperiode dazu die Anlage.
export type CarryBody = { body: Extract<BuildResult, { body: unknown }>['body'] & { heatingPlantId?: string } } | { error: string }

export function carryOverBody(row: CarryRow, units: Unit[], period: number | BillingPeriod, tenancies?: Tenancy[]): CarryBody {
  if (row.formReason) return { error: row.formReason }
  if (!row.inline) return { error: 'Einzelbeträge je Mieter bitte im Formular eintragen („Im Formular öffnen“).' }
  if (!row.amount.trim()) return { error: 'Betrag fehlt.' }
  const form = carryOverForm(row)
  // Eine Heizposition mit eigener Heizperiode steht unter deren Schlüssel, mit dem Jahr der Zahlung
  // ihrer Heizperiode (wie `saveItem` auf der Seite Kosten).
  if (row.heating) {
    const built = buildCostItemBody({ ...form, taxYear: '' }, units, period, tenancies)
    if ('error' in built) return built
    return { body: { ...built.body, period: row.heating.period, heatingPlantId: row.heating.plantId, taxYear: row.taxYear ? Number(row.taxYear) : null } }
  }
  // Liegt der neue Zeitraum in einem Kalenderjahr (etwa ein Rumpf nach einem Wechsel), ist es dieses (#208).
  const twoYears = typeof period !== 'number' && spansTwoYears(period)
  return buildCostItemBody(twoYears ? form : { ...form, taxYear: '' }, units, period, tenancies)
}
