// Entscheidungslogik des Kostenposition-Formulars, bewusst getrennt von der Darstellung:
// Auswahllisten, Validierung und der Rumpf, der an die API geht. Diese Stelle bestimmt, was
// tatsächlich gespeichert wird — sie ist in client/src/costForm.test.ts geprüft.
import type { BillingPeriod, CostItem, CostKey, ExternalMeasure, HeatingPart, HeatingTarget, HotWater, Meter, MeterType, PeriodKey, SplitPreviewPart, Tenancy, Unit } from './types'
import { CATEGORIES, KEY_LABELS, defaultKeyFor, isNotAllocable } from './types'
import { PARTICIPANT_KEYS as SHARED_PARTICIPANT_KEYS, allocationOf, comparablePrevious, previousAllocation, sameAllocation, type Allocation } from '../../shared/allocation.ts'
import { parseEuro } from './api'
import { sameCostCandidates, type DuplicateItem } from '../../shared/duplicates.ts'
import { parseNumberDe } from './numbers'
import { targetOptions } from './heatingSelfForm'
import { usageOf } from './types'
import { CREDIT_WITH_AMOUNTS, costItemBody, euro, type CostItemBody, inBasis, pct, showsTaxUnitField, taxUnitOf, type BuildResult, type CostItemDraft } from '../../shared/costItem.ts'
import { etwByStatement, lastExternalBasis, type KeyContext } from '../../shared/assessment.ts'
import { calendarContext, calendarPeriod, calendarYearPeriod, spansTwoYears } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
// Seit der Belegbuchung (#170) in shared/, weil der Server dieselben Prüfungen und Vorschläge braucht.
export { amountProblem, showsTaxUnitField, type BuildResult } from '../../shared/costItem.ts'
export { aiPositionDefaults, aiPositionPreselect, lastExternalBasis, type AiPositionKey, type KeyContext } from '../../shared/assessment.ts'

export type ItemForm = {
  id?: string
  category: string
  description: string
  vendor: string
  amount: string
  labor35a: string
  key: CostKey
  directUnitId: string
  // leer = noch nicht gewählt; ein Vorbelegen wäre gefährlich, weil das Feld sonst einen
  // Zählertyp speichern kann, der in der Auswahl gar nicht angeboten wird
  meterType: MeterType | ''
  customShares: Record<string, string> // Wohnungs-ID → Prozent-Eingabe
  // Teilnehmer (#94): null heißt alle Wohnungen, auch künftig angelegte.
  participants: string[] | null
  // Laut Gemeinschaftsabrechnung (#94)
  externalMeasure: ExternalMeasure
  externalTotal: string
  externalTotalAmount: string
  // Einzelbeträge je Mietverhältnis (#94): Mietverhältnis-ID → Betrags-Eingabe
  tenancyAmounts: Record<string, string>
  // Beträge selbstgenutzter Wohnungen (#104): Wohnungs-ID → Betrags-Eingabe
  selfAmounts: Record<string, string>
  // Leistungszeitraum als 'JJJJ-MM-TT' aus <input type="date">, leer heißt keine Angabe (#208)
  serviceFrom: string
  serviceTo: string
  // Jahr der Zahlung als Text der Auswahl, leer heißt keine Angabe (#208)
  taxYear: string
  // Teil der Heizkosten, nur bei Heizkosten (#208, A1; Nachprüfung von #237: alle Werte des Modells),
  // leer heißt keine Angabe
  heatingPart: HeatingPart | ''
  // Ziel bei Heizkosten (Heizung PR 10): leer heißt „Heizung und Warmwasser“ bei freien Schlüsseln bzw.
  // noch nicht gewählt bei der eigenen Heizkostenabrechnung.
  heatingTarget: HeatingTarget | ''
  invoiceFile?: string
}

export const EMPTY_ITEM_FORM: ItemForm = {
  category: CATEGORIES[0],
  description: '',
  vendor: '',
  amount: '',
  labor35a: '',
  key: 'area',
  directUnitId: '',
  meterType: '',
  customShares: {},
  participants: null,
  externalMeasure: 'mea',
  externalTotal: '',
  externalTotalAmount: '',
  tenancyAmounts: {},
  selfAmounts: {},
  serviceFrom: '',
  serviceTo: '',
  taxYear: '',
  heatingPart: '',
  heatingTarget: '',
}

// Formular aus einer gespeicherten Position füllen
export function itemToForm(i: CostItem): ItemForm {
  return {
    id: i.id,
    category: i.category,
    description: i.description,
    vendor: i.vendor ?? '',
    amount: (i.amountCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    labor35a: i.labor35aCents ? (i.labor35aCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
    key: i.key,
    directUnitId: i.directUnitId ?? '',
    meterType: i.meterType ?? '',
    customShares: Object.fromEntries(
      Object.entries(i.customShares ?? {}).map(([unitId, pct]) => [unitId, fmtPct(pct)]),
    ),
    participants: i.participantUnitIds ?? null,
    externalMeasure: i.externalBasis?.measure ?? 'mea',
    externalTotal: i.externalBasis ? i.externalBasis.total.toLocaleString('de-DE', { maximumFractionDigits: 6 }) : '',
    externalTotalAmount: i.externalBasis ? fmtCentsInput(i.externalBasis.totalCents) : '',
    tenancyAmounts: Object.fromEntries(Object.entries(i.tenancyAmounts ?? {}).map(([id, c]) => [id, fmtCentsInput(c)])),
    selfAmounts: Object.fromEntries(Object.entries(i.selfAmounts ?? {}).map(([id, c]) => [id, fmtCentsInput(c)])),
    serviceFrom: i.serviceFrom ?? '',
    serviceTo: i.serviceTo ?? '',
    taxYear: i.taxYear !== undefined ? String(i.taxYear) : '',
    heatingPart: i.heatingPart ?? '',
    heatingTarget: i.heatingTarget ?? '',
    invoiceFile: i.invoiceFile ?? undefined,
  }
}

export const fmtPct = pct
const fmtCentsInput = (c: number) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Bei diesen Schlüsseln wirken Teilnehmer (#94); bei Direktzuordnung und vereinbarten Anteilen
// ist die Auswahl ohnehin je Wohnung.
// Die Liste steht in shared/allocation.ts, weil auch der Vergleich mit dem Vorjahr (#141) sie braucht.
export const PARTICIPANT_KEYS: readonly CostKey[] = SHARED_PARTICIPANT_KEYS

const MEASURE_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// Die Beschriftung der Summe aus der Gemeinschaftsabrechnung (#142). „Summe in der Anlage“ las
// sich wie die Summe der Kosten; gemeint ist die Summe der Anteile im gewählten Maßstab.
const EXTERNAL_TOTAL_LABELS: Record<ExternalMeasure, string> = {
  mea: 'Summe der Miteigentumsanteile in der Anlage (z. B. 1.000 MEA)',
  area: 'Summe der Wohnflächen in der Anlage (z. B. 1.240 m²)',
  units: 'Zahl der Einheiten in der Anlage (z. B. 24)',
}
export const externalTotalLabel = (measure: ExternalMeasure): string => EXTERNAL_TOTAL_LABELS[measure]
export const EXTERNAL_MEASURE_OPTIONS: { value: ExternalMeasure, label: string }[] = [
  { value: 'mea', label: 'Miteigentumsanteile (MEA)' },
  { value: 'area', label: 'Wohnfläche (m²)' },
  { value: 'units', label: 'Einheiten' },
]

// Eine Menge wie „10.000“ MEA oder „1.240“ m². Anders als bei Euro-Beträgen ist ein Punkt vor
// genau drei Ziffern hier der Tausenderpunkt: Eine Summe von zehn Miteigentumsanteilen mit drei
// Nachkommastellen gibt es nicht, zehntausend sind die Regel.
// Ohne Rundung auf zwei Stellen (#105): Eine Summe der Anlage mit drei Nachkommastellen blieb
// sonst beim erneuten Speichern nicht, was sie war.
export function parseQuantity(raw: string): number | null {
  return parseNumberDe(raw)
}
const parseAmountNumber = parseQuantity

// Die Mietverhältnisse, die einen Einzelbetrag bekommen können: im Jahr und in einer Wohnung, die
// zur Abrechnung gehört.
// Mit Teilnehmern (#105) nur deren Mietverhältnisse, wie in der Abrechnung.
// `period`: eine Jahreszahl ist das Kalenderjahr (Tests, Kalenderobjekt), sonst der gewählte
// Abrechnungszeitraum (#208).
export function tenanciesForAmounts(tenancies: Tenancy[], units: Unit[], period: number | Pick<BillingPeriod, 'from' | 'to'>, participants: string[] | null = null): Tenancy[] {
  const span = typeof period === 'number' ? calendarYearPeriod(period) : period
  const vermietet = new Set(units.filter((u) => u.participates && (participants === null || participants.includes(u.id))).map((u) => u.id))
  return tenancies.filter((t) => vermietet.has(t.unitId) && t.start <= span.to && (t.end === null || t.end >= span.from))
}

// Der rechnerische Anteil laut Gemeinschaftsabrechnung, zum Vergleich mit dem eingetragenen
// Betrag. Leer, solange die Angaben dafür fehlen.
export function externalHint(form: ItemForm, units: Unit[]): string {
  const share = externalShare(form, units)
  if (share === null) return ''
  if (typeof share === 'string') return share
  const { own, total, expected, amount } = share
  const text = `Rechnerischer Anteil: ${fmtPct(own)} von ${fmtPct(total)} ${MEASURE_LABELS[form.externalMeasure]} = ${fmtCentsInput(expected)} €`
  if (amount === null || !isMismatch(expected, amount)) return text
  return `${text} — weicht um ${fmtCentsInput(Math.abs(expected - amount))} € vom Betrag ab. Bitte die Angaben aus der Gemeinschaftsabrechnung prüfen; verteilt wird der eingetragene Betrag.`
}

// Weicht der rechnerische Anteil vom eingetragenen Betrag ab (#144)? Dann markiert das Formular
// ihn. Dieselbe Toleranz wie die Warnung `external.amount-mismatch` in server/src/calc.ts: mehr
// als 1,00 €, denn die Gemeinschaft rundet je Position und Wohnung.
export function externalMismatch(form: ItemForm, units: Unit[]): boolean {
  const share = externalShare(form, units)
  return share !== null && typeof share !== 'string' && share.amount !== null && isMismatch(share.expected, share.amount)
}
const isMismatch = (expected: number, amount: number) => Math.abs(expected - amount) > 100

// Der rechnerische Anteil, eine Erklärung, warum es keinen gibt, oder `null`, solange Angaben fehlen.
function externalShare(form: ItemForm, units: Unit[]): { own: number, total: number, expected: number, amount: number | null } | string | null {
  const total = parseAmountNumber(form.externalTotal)
  const totalCents = parseEuro(form.externalTotalAmount)
  if (total === null || !(total > 0) || totalCents === null) return null
  const valueOf = (u: Unit) => (form.externalMeasure === 'mea' ? u.mea ?? 0 : form.externalMeasure === 'area' ? u.areaM2 : 1)
  // Mit Teilnehmern (#105) nur deren Wohnungen, wie in der Abrechnung.
  const own = basisUnitsOf(units).filter((u) => form.participants === null || form.participants.includes(u.id)).reduce((a, u) => a + valueOf(u), 0)
  if (!(own > 0)) return form.externalMeasure === 'mea' ? 'Für die Wohnungen sind noch keine Miteigentumsanteile hinterlegt (Stammdaten).' : null
  return { own, total, expected: Math.round((totalCents * own) / total), amount: parseEuro(form.amount) }
}

// Die Wohnungen, für die ein Eigenbetrag (#104) gilt: selbstgenutzt und, wenn die Position auf
// Teilnehmer beschränkt ist, unter ihnen. Genau für sie zeigt das Formular ein Feld. Ein Betrag für
// eine andere Wohnung, etwa eine, die inzwischen vermietet ist, stünde sonst unsichtbar im Formular,
// zählte in die Summe und ließe sich nicht mehr löschen (Befund der Durchsicht).
export function selfAmountUnits(units: Unit[], participants: string[] | null): Unit[] {
  return basisUnitsOf(units).filter((u) => usageOf(u) === 'eigen' && (participants === null || participants.includes(u.id)))
}
const visibleSelfAmounts = (form: ItemForm, units: Unit[]): Record<string, string> => {
  const ids = new Set(selfAmountUnits(units, form.participants).map((u) => u.id))
  return Object.fromEntries(Object.entries(form.selfAmounts).filter(([id]) => ids.has(id)))
}

// Einzelbeträge nur der Mietverhältnisse, deren Feld das Formular zeigt (Durchsicht zu #105):
// Wer eine Wohnung als Teilnehmerin abwählt, sähe den Betrag ihres Mieters sonst nicht mehr, er
// zählte aber in die Summe und ließe sich nicht löschen. Ohne Mietverhältnisse keine Einschränkung.
const visibleTenancyAmounts = (form: ItemForm, units: Unit[], tenancies: Tenancy[] | undefined, period: number | BillingPeriod | undefined): Record<string, string> => {
  if (!tenancies || period === undefined) return form.tenancyAmounts
  const ids = new Set(tenanciesForAmounts(tenancies, units, period, form.participants).map((t) => t.id))
  return Object.fromEntries(Object.entries(form.tenancyAmounts).filter(([id]) => ids.has(id)))
}

export function amountsSumText(form: ItemForm, units: Unit[], tenancies?: Tenancy[], period?: number | BillingPeriod): string {
  const amount = parseEuro(form.amount) ?? 0
  // Eine Gutschrift (#105): Einzelbeträge sind nie negativ, die Summenprüfung ergäbe Unsinn.
  if (amount < 0) return CREDIT_WITH_AMOUNTS
  const sumOf = (m: Record<string, string>) => Object.values(m).reduce((a, raw) => a + Math.max(0, parseEuro(raw.trim() || '0') ?? 0), 0)
  const tenants = sumOf(visibleTenancyAmounts(form, units, tenancies, period))
  const own = sumOf(visibleSelfAmounts(form, units))
  const sum = tenants + own
  // Laienprobe B24: Ohne Betrag oder ohne eingetragene Beträge ist nichts „vollständig verteilt“.
  if (form.amount.trim() === '' || parseEuro(form.amount) === null) return sum > 0 ? `Summe ${fmtCentsInput(sum)} € — bitte oben den Rechnungsbetrag eintragen` : 'Noch keine Beträge eingetragen.'
  if (sum === 0) return 'Noch keine Beträge eingetragen.'
  if (sum > amount) return `${fmtCentsInput(sum)} € — mehr als der Rechnungsbetrag ist nicht möglich`
  const ownText = own > 0 ? `, davon ${fmtCentsInput(own)} € Ihre eigene Wohnung` : ''
  // Gerundet wird bei Einzelbeträgen nichts (#142); ein Rest entsteht, wenn für einen Zeitraum
  // kein Mieter einen Betrag hat, etwa bei Leerstand.
  if (sum === amount) return `Summe ${fmtCentsInput(sum)} €${ownText} — der Rechnungsbetrag ist vollständig verteilt`
  return `Summe ${fmtCentsInput(sum)} €${ownText} — den Rest von ${fmtCentsInput(amount - sum)} € trägt der Vermieter (etwa für Leerstand)`
}

// Wohnungen der Abrechnungseinheit — nur sie können einen vereinbarten Anteil tragen
export const basisUnitsOf = (units: Unit[]) => units.filter(inBasis)

// Auswahllisten. Beide halten dieselbe Regel ein: der gespeicherte Wert steht immer in der
// Liste. Fehlt er, zeigt ein Select im Browser den ersten Eintrag an, während der State
// unverändert bleibt — gespeichert würde dann etwas anderes als das, was zu sehen ist.
// Die Auswahl „Teil der Heizkosten“ (Nachprüfung von #237): alle Werte des Modells und „ohne Angabe“.
// Wie bei den übrigen Auswahlfeldern steht der gespeicherte Wert immer in der Liste, damit der Browser
// zeigt, was gespeichert ist.
export const HEATING_PART_OPTIONS: readonly { value: HeatingPart | ''; label: string }[] = [
  { value: '', label: 'ohne Angabe' },
  { value: 'fuel', label: 'Brennstoff/Energie (Gas, Öl, Fernwärme, Strom der Wärmepumpe)' },
  { value: 'operating', label: 'Betrieb, Wartung, Strom der Heizung' },
  { value: 'metering', label: 'Messdienst, Ablesung, Geräte' },
]

export function meterTypeOptions(unitMeterTypes: MeterType[], stored: MeterType | ''): MeterType[] {
  return [...new Set([...unitMeterTypes, ...(stored ? [stored] : [])])]
}

// Die Zählertypen, nach denen eine Position verteilt werden kann: die der Wohnungszähler, ohne
// Heizkostenverteiler (Heizung PR 4). Deren Einheiten verteilt Mietfuchs erst mit den
// Bewertungsfaktoren (PR 12); bis dahin lehnt auch der Server den Schlüssel ab.
export function costMeterTypes(meters: readonly Pick<Meter, 'type' | 'unitId'>[]): MeterType[] {
  return [...new Set(meters.filter((m) => m.unitId && m.type !== 'hkv').map((m) => m.type))]
}

// Schlüssel wechseln (#142). Beim Verbrauchsschlüssel stand der Zählertyp auf „— wählen —“, auch
// wenn es nur einen gab. Dann wird er jetzt vorgewählt, und zwar im Zustand und nicht nur in der
// Anzeige, sodass gespeichert wird, was zu sehen ist; er steht ja in der Auswahl. Bei mehreren
// Typen wählt weiter der Mensch, und eine schon getroffene Wahl bleibt.
// Mit `ctx` (#141) übernimmt der Wechsel auf „laut Gemeinschaftsabrechnung“ Maßstab und Summe der
// Anteile der zuletzt erfassten Position dieses Schlüssels, wenn das Feld noch leer ist: Die Summe
// der Miteigentumsanteile ist eine Angabe über die Anlage und steht nicht an jeder Position neu an.
export function withKey(form: ItemForm, key: CostKey, unitMeterTypes: MeterType[], ctx?: KeyContext): ItemForm {
  const [only, ...more] = unitMeterTypes
  const meterType = key === 'meter' && !form.meterType && only && more.length === 0 ? only : form.meterType
  const last = key === 'external' && ctx && !form.externalTotal.trim() ? lastExternalBasis(ctx.items) : null
  return { ...form, key, meterType, ...(last ? externalFields(last) : {}) }
}

// ---------- Schlüssel merken (#141) ----------

const fmtQuantity = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
const externalFields = (b: { measure: ExternalMeasure, total: number }): Pick<ItemForm, 'externalMeasure' | 'externalTotal'> =>
  ({ externalMeasure: b.measure, externalTotal: fmtQuantity(b.total) })

// Einen gemerkten Schlüssel ins Formular legen. Teilnehmer, Anteile und Wohnung nur, soweit es die
// Wohnung noch gibt; der Betrag und die Kosten der Gemeinschaft bleiben, wie sie sind.
export function applyAllocation(form: ItemForm, a: Allocation, units: Unit[]): ItemForm {
  const known = new Set(units.map((u) => u.id))
  return {
    ...form,
    key: a.key,
    meterType: a.meterType ?? '',
    directUnitId: a.directUnitId && known.has(a.directUnitId) ? a.directUnitId : '',
    customShares: Object.fromEntries(Object.entries(a.customShares ?? {}).filter(([id]) => known.has(id)).map(([id, pct]) => [id, fmtPct(pct)])),
    participants: a.participantUnitIds ? a.participantUnitIds.filter((id) => known.has(id)) : null,
    ...(a.externalBasis ? externalFields(a.externalBasis) : {}),
  }
}

// Der Vorschlag für eine neue Position: der Schlüssel derselben Kostenart im Vorjahr, sonst bei
// einer Eigentumswohnung „laut Gemeinschaftsabrechnung“, sonst `suggestedKey`.
// Die Angaben zum Schlüssel werden dabei zurückgesetzt: Sonst blieben die gemerkten Teilnehmer der
// einen Kostenart an der nächsten hängen, ohne dass jemand sie gewählt hätte.
function proposal(previous: ItemForm, category: string, units: Unit[], meters: Meter[], ctx?: KeyContext): ItemForm {
  const form: ItemForm = { ...previous, directUnitId: '', meterType: '', customShares: {}, participants: null }
  // Bei einer breiten Kostenart nur mit derselben Beschreibung (shared/allocation.ts).
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.at ?? calendarContext(ctx.year), form.description) : null
  if (remembered) return applyAllocation(form, remembered, units)
  if (etwByStatement(category, ctx)) {
    const last = ctx ? lastExternalBasis(ctx.items) : null
    return { ...form, key: 'external', meterType: '', ...(last ? externalFields(last) : {}) }
  }
  return { ...form, ...suggestedKey(category, units, meters) }
}

// Das Formular einer neuen Position, mit dem Vorschlag schon für die erste Kostenart.
export function newItemForm(units: Unit[], meters: Meter[], ctx?: KeyContext): ItemForm {
  return withCategory({ ...EMPTY_ITEM_FORM }, EMPTY_ITEM_FORM.category, units, meters, ctx)
}

// Der Schlüssel, den das Formular gerade zeigt, in der Gestalt aus shared/allocation.ts. Alle
// Wohnungen angehakt heißt alle, wie beim Speichern (buildCostItemBody).
function formAllocation(form: ItemForm, units: Unit[]): Allocation {
  const all = basisUnitsOf(units).map((u) => u.id)
  const participants = form.participants && !all.every((id) => form.participants?.includes(id)) ? form.participants : null
  const shares = Object.fromEntries(Object.entries(form.customShares).flatMap(([id, raw]) => {
    const h = parseEuro(raw.trim() || '0')
    return h !== null && h > 0 ? [[id, h / 100]] : []
  }))
  const total = parseAmountNumber(form.externalTotal)
  return allocationOf({
    category: form.category,
    description: form.description,
    key: form.key,
    meterType: form.meterType || null,
    directUnitId: form.directUnitId || null,
    customShares: shares,
    participantUnitIds: participants,
    externalBasis: total !== null ? { measure: form.externalMeasure, total, totalCents: 0 } : { measure: form.externalMeasure, total: 0, totalCents: 0 },
  }, all)
}

// Hinweis im Formular, wenn die Position anders verteilt als dieselbe Kostenart im Vorjahr; dieselbe
// Frage stellt die Abrechnung (`key.changed-from-previous-year` in server/src/calc.ts). Leer, wenn
// nichts zu sagen ist.
export function keyChangeNotice(form: ItemForm, units: Unit[], ctx: KeyContext): string {
  if (isNotAllocable(form.category)) return ''
  const basis = basisUnitsOf(units).map((u) => u.id)
  const at = ctx.at ?? calendarContext(ctx.year)
  const before = comparablePrevious(ctx.items, form.category, at, form.description).map((i) => allocationOf(i, basis))
  const first = before[0]
  const now = formAllocation(form, units)
  if (!first || before.some((a) => sameAllocation(a, now))) return ''
  const how = first.key === now.key ? `ebenfalls ${KEY_LABELS[first.key]}, aber mit anderen Angaben` : KEY_LABELS[first.key]
  // Ohne Rechtsauskunft im Einzelnen (die steht im Lexikon und in der Abrechnung): Eine Änderung
  // ist möglich, aber nicht beliebig (Durchsicht).
  return `${at.previousLabel} wurde „${form.category}“ ${how} verteilt. Ein vereinbarter Umlageschlüssel gilt weiter, bis er mit Zustimmung der Mieter oder durch eine zulässige Erklärung geändert ist; ist das geschehen, ist nichts zu tun.`
}

// Die Auswahl der Zeile: die drei einfachen Schlüssel und der gespeicherte, damit angezeigt wird,
// was gespeichert wird (Kosten.test.tsx).
export function aiKeyOptions(stored: CostKey): CostKey[] {
  const simple: CostKey[] = ['area', 'persons', 'units']
  return simple.includes(stored) ? simple : [...simple, stored]
}

// Bei nicht umlagefähigen Kostenarten gibt es nichts zu verteilen (#142): Die Berechnung trägt sie
// ganz dem Vermieter zu und liest ihren Schlüssel nicht (calc.ts, `isNotAllocable`). Das Formular
// zeigt deshalb keine Schlüsselauswahl, und die Liste keinen Schlüssel.
export const showsKeyFields = (category: string): boolean => !isNotAllocable(category)
export function keyListText(item: Pick<CostItem, 'category' | 'key' | 'directUnitId' | 'participantUnitIds'>, units: Pick<Unit, 'id' | 'name'>[] = []): string {
  if (!isNotAllocable(item.category)) return KEY_LABELS[item.key]
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? '?'
  const direct = taxUnitOf(item)
  const ids = direct ? [direct] : showsTaxUnitField(item.category) && item.key === 'area' && item.participantUnitIds ? item.participantUnitIds : []
  return ids.length > 0 ? `— trägt der Vermieter · betrifft ${ids.map(nameOf).join(', ')}` : '— trägt der Vermieter'
}

// Nicht umlagefähig, aber für die Steuer einer Einheit zugeordnet (#163): Regel und Begründung
// in shared/costItem.ts (`showsTaxUnitField`, `taxUnitOf`, `taxPartsOf`).
// Die Auswahl „Betrifft (für die Steuer)“: leer für das ganze Gebäude, `TAX_SCOPE_SOME` für
// bestimmte Einheiten (Teilnehmer, etwa das Dach des Hinterhauses; Durchsicht) oder eine Einheit.
// Angezeigt wird, was gespeichert wird: `taxScopeOf` liest den Wert der Auswahl aus denselben
// Feldern, die `buildCostItemBody` schreibt.
export const TAX_SCOPE_SOME = '__einige'
export function taxScopeOf(form: Pick<ItemForm, 'key' | 'directUnitId' | 'participants'>): string {
  if (form.key === 'direct' && form.directUnitId) return form.directUnitId
  return form.key === 'area' && form.participants !== null ? TAX_SCOPE_SOME : ''
}
export function withTaxUnit(form: ItemForm, scope: string): ItemForm {
  if (scope === TAX_SCOPE_SOME) return { ...form, key: 'area', directUnitId: '', participants: form.participants ?? [] }
  return scope ? { ...form, key: 'direct', directUnitId: scope, participants: null } : { ...form, key: 'area', directUnitId: '', participants: null }
}
export function toggleTaxUnit(form: ItemForm, unitId: string, checked: boolean): ItemForm {
  const current = form.participants ?? []
  const next = checked ? [...current.filter((id) => id !== unitId), unitId] : current.filter((id) => id !== unitId)
  return { ...form, key: 'area', directUnitId: '', participants: next }
}

// `selfPlant` (Heizung PR 10): eine Heizposition einer Anlage mit eigener Heizkostenabrechnung; dort gibt es nur
// den Schlüssel nach Heizkostenverordnung (Abweichung 18).
export function costKeyOptions(unitMeterTypes: MeterType[], stored: CostKey, selfPlant = false): CostKey[] {
  if (selfPlant) return ['heatingSystem']
  return (Object.keys(KEY_LABELS) as CostKey[]).filter(
    (k) => (k !== 'meter' || unitMeterTypes.length > 0 || stored === 'meter') &&
      // Nach Heizkostenverordnung verteilt nur eine Anlage mit eigener Abrechnung; angeboten wird der
      // Schlüssel dort. Sonst nur bei einer Position, die ihn schon hat.
      (k !== 'heatingSystem' || stored === 'heatingSystem'),
  )
}

// Ziel einer Heizposition (Heizung PR 10). Bei eigener Abrechnung nach der Warmwasserbereitung
// (`targetOptions`, dieselbe Regel wie `targetProblem` im Server); bei freien Schlüsseln „Heizung und
// Warmwasser“ (leer, wie bisher) oder „nur Heizung“, dann gelten beim Mieterwechsel die Gradtage
// (Abweichung 16).
export function heatingTargetOptions(selfPlant: boolean, hotWater: HotWater, part: HeatingPart | ''): { value: HeatingTarget | ''; label: string }[] {
  if (selfPlant) return targetOptions(hotWater, part)
  return [{ value: '', label: 'Heizung und Warmwasser' }, { value: 'heating', label: 'nur Heizung' }]
}

// Der Schlüssel, den das Formular einer Kostenposition für eine Kostenart vorschlägt (#142).
// Wasser/Abwasser nach Verbrauch (§ 556a Abs. 1 Satz 2 BGB), aber nur, wenn **jede beteiligte
// Wohnung** einen Kaltwasserzähler hat oder ausdrücklich keinen Wasseranschluss: Fehlt einer
// vermieteten Wohnung der Zähler, zahlte beim Verbrauchsschlüssel ein anderer Mieter oder der
// Vermieter ihren Anteil (siehe calc.ts, #116). Ein Hauptzähler deckt das nicht sicher ab; die
// einfachste sichere Regel ist deshalb, ihn nicht mitzuzählen. Der Vorschlag steht in beiden
// Auswahllisten: Gibt es einen Kaltwasserzähler an einer Wohnung, bietet sie `meter` und
// `kaltwasser` an.
export function suggestedKey(category: string, units: Unit[], meters: Meter[]): { key: CostKey, meterType: MeterType | '' } {
  if (category === 'Wasser/Abwasser') {
    const metered = new Set(meters.filter((m) => m.type === 'kaltwasser' && m.unitId).map((m) => m.unitId))
    const participating = units.filter((u) => u.participates)
    const covered = participating.every((u) => metered.has(u.id) || (u.noConnection ?? []).includes('kaltwasser'))
    if (participating.length > 0 && metered.size > 0 && covered) return { key: 'meter', meterType: 'kaltwasser' }
  }
  return { key: defaultKeyFor(category), meterType: '' }
}

// Kostenart wechseln. Eine neue Position bekommt den Vorschlag der Kostenart; eine bestehende
// behält ihren Schlüssel, denn er ist eine Wahl des Nutzers. Ausnahme (Durchsicht zu #142): Wird
// eine nicht umlagefähige Position umlagefähig, ist ihr gespeicherter Schlüssel nur die neutrale
// Vorgabe und keine Wahl; dann gilt der Vorschlag wie bei einer neuen.
// Mit `ctx` (#141) gilt für eine neue Position der Schlüssel derselben Kostenart im Vorjahr.
export function withCategory(form: ItemForm, category: string, units: Unit[], meters: Meter[], ctx?: KeyContext): ItemForm {
  const suggest = !form.id || (isNotAllocable(form.category) && !isNotAllocable(category))
  // Wer zu „Nicht umlagefähig“ wechselt, nimmt keine Zuordnung der vorigen Kostenart mit: Dort
  // hieße sie „betrifft (für die Steuer)“, und ein alter Teilnehmer oder eine alte Direktzuordnung
  // würde still zu einer Steuerangabe (#163, Durchsicht).
  if (showsTaxUnitField(category) && !showsTaxUnitField(form.category)) {
    return { ...form, category, key: 'area', directUnitId: '', participants: null }
  }
  return suggest ? proposal({ ...form, category }, category, units, meters, ctx) : { ...form, category }
}

// Summe der vereinbarten Anteile in Prozent (unlesbare Eingaben zählen als 0)
export function customSharesSum(form: ItemForm, units: Unit[]): number {
  return basisUnitsOf(units).reduce((a, u) => {
    const hundredths = parseEuro(form.customShares[u.id]?.trim() || '0') ?? 0
    return a + Math.max(0, hundredths) / 100
  }, 0)
}

// Hinweistext unter den Prozentfeldern: macht den Vermieter-Rest schon bei der Eingabe sichtbar
export function customSharesSumText(form: ItemForm, units: Unit[]): string {
  const sum = customSharesSum(form, units)
  if (sum > 100.0001) return `${fmtPct(sum)} % — mehr als 100 % sind nicht möglich`
  const rest = 100 - sum
  return rest > 0.0001
    ? `${fmtPct(sum)} % — die restlichen ${fmtPct(rest)} % trägt der Vermieter`
    : `${fmtPct(sum)} %`
}

// Liest die Eingaben des Formulars in Cent und Prozent; was sich nicht lesen lässt, wird `null`,
// und die Prüfung in shared/costItem.ts sagt es in Worten.
function draftOf(form: ItemForm, units: Unit[], tenancies: Tenancy[] | undefined, period: BillingPeriod): CostItemDraft {
  const parsed = (m: Record<string, string>): Record<string, number | null> =>
    Object.fromEntries(Object.entries(m).filter(([, raw]) => raw.trim()).map(([id, raw]) => [id, parseEuro(raw)]))
  const shares: Record<string, number | null> = {}
  for (const u of basisUnitsOf(units)) {
    const raw = form.customShares[u.id]?.trim()
    if (!raw) continue
    // Prozent in deutscher oder technischer Schreibweise; parseEuro liefert Hundertstel
    const hundredths = parseEuro(raw)
    shares[u.id] = hundredths === null ? null : hundredths / 100
  }
  return {
    category: form.category,
    description: form.description,
    vendor: form.vendor,
    invoiceFile: form.invoiceFile ?? null, // null löscht eine bestehende Zuordnung
    amountCents: parseEuro(form.amount),
    labor35aCents: form.labor35a.trim() ? parseEuro(form.labor35a) : 0,
    key: form.key,
    directUnitId: form.directUnitId || null,
    meterType: form.meterType || null,
    customShares: shares,
    participants: form.participants,
    external: { measure: form.externalMeasure, total: parseAmountNumber(form.externalTotal), totalCents: parseEuro(form.externalTotalAmount) },
    tenancyAmounts: parsed(visibleTenancyAmounts(form, units, tenancies, period)),
    selfAmounts: parsed(visibleSelfAmounts(form, units)),
    serviceFrom: form.serviceFrom || null,
    serviceTo: form.serviceTo || null,
    taxYear: form.taxYear === '' ? null : Number(form.taxYear),
    heatingPart: form.heatingPart === '' ? null : form.heatingPart,
    heatingTarget: form.heatingTarget === '' ? null : form.heatingTarget,
  }
}

// Validiert das Formular und baut den API-Rumpf, mit derselben Prüfung wie der Server
// (shared/costItem.ts).
export function buildCostItemBody(form: ItemForm, units: Unit[], period: number | BillingPeriod, tenancies?: Tenancy[]): BuildResult {
  // Eine Jahreszahl ist das Kalenderjahr (Tests, Kalenderobjekt); sonst der gewählte Zeitraum (#208).
  const p = typeof period === 'number' ? calendarYearPeriod(period) : period
  return costItemBody(draftOf(form, units, tenancies, p), units, p.key)
}

// Hinweise, die an der Kostenart und am Abrechnungsjahr hängen (#107). Dieselbe Regel meldet die
// Berechnung in der Abrechnung; hier steht sie schon beim Erfassen. Mit #108 kommen beide aus
// dem Regelverzeichnis.
// `cableBuiltBeforeDec2021` vom Objekt (#121): Bei einer Anlage ab dem 01.12.2021 schon ab 2021.
export function categoryNotice(category: string, year: number, cableBuiltBeforeDec2021: boolean | null = null): string {
  if (category !== 'Kabel/Antenne') return ''
  if (cableBuiltBeforeDec2021 === false && year >= 2021) {
    return 'Die Kabel- oder Antennenanlage dieses Objekts wurde ab dem 01.12.2021 errichtet: Die Gebühren für das TV-Signal waren nie umlagefähig, auch Betriebsstrom und Wartung nicht; bitte als „Nicht umlagefähig“ erfassen.'
  }
  if (year < 2024) return ''
  return year === 2024
    ? 'Kabelfernsehen (TV-Signal) ist nur bis zum 30.06.2024 umlagefähig, und nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde. Legen Sie für 2024 höchstens das erste Halbjahr um; den Rest bitte als „Nicht umlagefähig“ erfassen. Danach bleibt bei solchen Anlagen nur der Betriebsstrom umlagefähig, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung durch eine Fachkraft.'
    : 'Kabelfernsehen (TV-Signal) ist seit dem 01.07.2024 nicht mehr umlagefähig; bitte als „Nicht umlagefähig“ erfassen. Umlagefähig bleibt nur der Betriebsstrom einer Anlage, die vor dem 01.12.2021 errichtet wurde, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung durch eine Fachkraft.'
}

// Die Rückfrage „Dieselbe Rechnung?“ beim Anlegen einer Position (shared/duplicates.ts). Gefragt
// wird mit dem Betrag, denn eine Gutschrift ist nie dieselbe Rechnung wie eine Rechnung derselben
// Kostenart (Befund gegen 0.10.0-rc.1); sonst riet die Rückfrage, statt der Gutschrift die
// vorhandene Rechnung zu bearbeiten.
export function sameCostOf<T extends DuplicateItem>(
  items: readonly T[], body: { category: string, description: string, vendor?: string, amountCents: number | null },
  propertyId: string | null | undefined, period: number | PeriodKey,
): T[] {
  return sameCostCandidates(items, { propertyId, period: typeof period === 'number' ? calendarPeriod(period) : period, category: body.category, description: body.description, vendor: body.vendor, amountCents: body.amountCents })
}

// ---------- Leistungszeitraum und Aufteilen (#208, Entwurf 3.4, 3.10) ----------

// Nur eine kalte Rechnung mit Leistungszeitraum kann zwei Zeiträume berühren; Heizkosten werden nie
// nach Tagen geteilt (G-C1).
// Ein schon aufgeteilter Teil trägt den ganzen Leistungszeitraum der Rechnung: Bleiben
// Leistungszeitraum und Zeitraum gegenüber der gespeicherten Position (`before`) gleich, wird nur
// berichtigt und nicht erneut aufgeteilt; der Server nimmt das ebenso an (repository.ts).
// Eine Heizposition, die zur kalten wird, zählt nicht als unverändert (Nachprüfung von #226).
export function needsSplitCheck(body: CostItemBody, before?: Pick<CostItem, 'serviceFrom' | 'serviceTo' | 'period' | 'category'> | null): boolean {
  if (body.serviceFrom === null || body.serviceTo === null || body.category === HEATING_CATEGORY) return false
  return !(before && before.category !== HEATING_CATEGORY && before.serviceFrom === body.serviceFrom && before.serviceTo === body.serviceTo && before.period === body.period)
}

// Die Rückfrage vor dem Aufteilen, oder warum nicht aufgeteilt werden kann.
export function splitDecision(parts: readonly SplitPreviewPart[], taxYear: string): { message: string } | { error: string; needsTaxYear: boolean } {
  const closed = parts.find((p) => p.closed)
  if (closed) return { error: `Die Abrechnung ${closed.label} ist abgeschlossen. Öffnen Sie sie wieder, wenn die Rechnung anteilig hinein soll.`, needsTaxYear: false }
  const twoYears = parts.find((p) => p.needsTaxYear)
  if (twoYears && taxYear === '') {
    return { error: `Bitte wählen Sie das Jahr der Zahlung (für die Steuer): Ein Teil der Rechnung gehört in den Zeitraum ${twoYears.label}, der über zwei Kalenderjahre reicht.`, needsTaxYear: true }
  }
  return { message: `Die Rechnung betrifft ${parts.length} Abrechnungszeiträume. Mietfuchs legt je Zeitraum eine Position an: ${parts.map((p) => `${p.label}: ${euro(p.amountCents)}`).join(', ')}.` }
}

// Das Jahr der Zahlung zeigt das Formular nur, wenn der Zeitraum über zwei Kalenderjahre reicht oder
// ein Teil einer aufgeteilten Rechnung dorthin gehört (Entwurf 3.10, 11.4).
export const showsTaxYear = (period: Pick<BillingPeriod, 'from' | 'to'>, needsTaxYear: boolean): boolean => needsTaxYear || spansTwoYears(period)

// Vom Jahr des Beginns bis ein Jahr nach dem Ende (dieselbe Spanne prüft der Server).
export const taxYearOptions = (startYear: number): number[] => [startYear, startYear + 1, startYear + 2]
