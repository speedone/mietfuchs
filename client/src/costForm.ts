// Entscheidungslogik des Kostenposition-Formulars, bewusst getrennt von der Darstellung:
// Auswahllisten, Validierung und der Rumpf, der an die API geht. Diese Stelle bestimmt, was
// tatsächlich gespeichert wird — sie ist in client/src/costForm.test.ts geprüft.
import type { CostItem, CostKey, ExternalMeasure, Meter, MeterType, PropertyKind, Tenancy, Unit } from './types'
import { CATEGORIES, KEY_LABELS, defaultKeyFor, isNotAllocable } from './types'
import { allocationOf, previousAllocation, previousYearItems, sameAllocation, type Allocation } from '../../shared/allocation.ts'
import { parseEuro } from './api'
import { parseNumberDe } from './numbers'
import { usageOf } from './types'

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
    invoiceFile: i.invoiceFile ?? undefined,
  }
}

export const fmtPct = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const fmtCentsInput = (c: number) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Bei diesen Schlüsseln wirken Teilnehmer (#94); bei Direktzuordnung und vereinbarten Anteilen
// ist die Auswahl ohnehin je Wohnung.
export const PARTICIPANT_KEYS: CostKey[] = ['area', 'units', 'persons', 'meter', 'external', 'amounts']

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
export function tenanciesForAmounts(tenancies: Tenancy[], units: Unit[], year: number, participants: string[] | null = null): Tenancy[] {
  const vermietet = new Set(units.filter((u) => u.participates && (participants === null || participants.includes(u.id))).map((u) => u.id))
  return tenancies.filter((t) => vermietet.has(t.unitId) && t.start <= `${year}-12-31` && (t.end === null || t.end >= `${year}-01-01`))
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

// Summe der Einzelbeträge und was davon der Vermieter trägt.
const CREDIT_WITH_AMOUNTS = 'Bei einer Gutschrift sind Einzelbeträge nicht möglich; verteilen Sie sie bitte nach einem anderen Schlüssel.'

// Einzelbeträge nur der Mietverhältnisse, deren Feld das Formular zeigt (Durchsicht zu #105):
// Wer eine Wohnung als Teilnehmerin abwählt, sähe den Betrag ihres Mieters sonst nicht mehr, er
// zählte aber in die Summe und ließe sich nicht löschen. Ohne Mietverhältnisse keine Einschränkung.
const visibleTenancyAmounts = (form: ItemForm, units: Unit[], tenancies: Tenancy[] | undefined, year: number | undefined): Record<string, string> => {
  if (!tenancies || year === undefined) return form.tenancyAmounts
  const ids = new Set(tenanciesForAmounts(tenancies, units, year, form.participants).map((t) => t.id))
  return Object.fromEntries(Object.entries(form.tenancyAmounts).filter(([id]) => ids.has(id)))
}

export function amountsSumText(form: ItemForm, units: Unit[], tenancies?: Tenancy[], year?: number): string {
  const amount = parseEuro(form.amount) ?? 0
  // Eine Gutschrift (#105): Einzelbeträge sind nie negativ, die Summenprüfung ergäbe Unsinn.
  if (amount < 0) return CREDIT_WITH_AMOUNTS
  const sumOf = (m: Record<string, string>) => Object.values(m).reduce((a, raw) => a + Math.max(0, parseEuro(raw.trim() || '0') ?? 0), 0)
  const tenants = sumOf(visibleTenancyAmounts(form, units, tenancies, year))
  const own = sumOf(visibleSelfAmounts(form, units))
  const sum = tenants + own
  if (sum > amount) return `${fmtCentsInput(sum)} € — mehr als der Rechnungsbetrag ist nicht möglich`
  const ownText = own > 0 ? `, davon ${fmtCentsInput(own)} € Ihre eigene Wohnung` : ''
  // Gerundet wird bei Einzelbeträgen nichts (#142); ein Rest entsteht, wenn für einen Zeitraum
  // kein Mieter einen Betrag hat, etwa bei Leerstand.
  if (sum === amount) return `Summe ${fmtCentsInput(sum)} €${ownText} — der Rechnungsbetrag ist vollständig verteilt`
  return `Summe ${fmtCentsInput(sum)} €${ownText} — den Rest von ${fmtCentsInput(amount - sum)} € trägt der Vermieter (etwa für Leerstand)`
}

// Wohnungen der Abrechnungseinheit — nur sie können einen vereinbarten Anteil tragen
export const basisUnitsOf = (units: Unit[]) => units.filter((u) => usageOf(u) !== 'ausgenommen')

// Auswahllisten. Beide halten dieselbe Regel ein: der gespeicherte Wert steht immer in der
// Liste. Fehlt er, zeigt ein Select im Browser den ersten Eintrag an, während der State
// unverändert bleibt — gespeichert würde dann etwas anderes als das, was zu sehen ist.
export function meterTypeOptions(unitMeterTypes: MeterType[], stored: MeterType | ''): MeterType[] {
  return [...new Set([...unitMeterTypes, ...(stored ? [stored] : [])])]
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

// Woraus der Vorschlag für eine neue Position entsteht: die Positionen des Objekts (alle Jahre),
// das Abrechnungsjahr und die Art des Objekts.
export type KeyContext = { items: readonly CostItem[]; year: number; propertyKind?: PropertyKind | null }

const fmtQuantity = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
const externalFields = (b: { measure: ExternalMeasure, total: number }): Pick<ItemForm, 'externalMeasure' | 'externalTotal'> =>
  ({ externalMeasure: b.measure, externalTotal: fmtQuantity(b.total) })

// Maßstab und Summe der Anteile der zuletzt erfassten Position „laut Gemeinschaftsabrechnung“ im
// Objekt, jüngstes Jahr zuerst, sonst die zuletzt angelegte. Bis die Summe am Objekt steht (siehe
// docs/superpowers/specs/2026-10-02-schluessel-merken-design.md), ist das ihre Quelle.
export function lastExternalBasis(items: readonly CostItem[]): { measure: ExternalMeasure, total: number } | null {
  let found: CostItem | null = null
  for (const i of items) if (i.key === 'external' && i.externalBasis && (!found || i.year >= found.year)) found = i
  return found?.externalBasis ? { measure: found.externalBasis.measure, total: found.externalBasis.total } : null
}

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

// Bei einer Eigentumswohnung verteilt die Gemeinschaft (#102); die Grundsteuer setzt dagegen die
// Gemeinde dem Eigentümer unmittelbar fest, sie steht nicht in der Hausgeldabrechnung.
const etwByStatement = (category: string, ctx?: KeyContext): boolean =>
  ctx?.propertyKind === 'etw' && !isNotAllocable(category) && category !== 'Grundsteuer'

// Der Vorschlag für eine neue Position: der Schlüssel derselben Kostenart im Vorjahr, sonst bei
// einer Eigentumswohnung „laut Gemeinschaftsabrechnung“, sonst `suggestedKey`.
// Die Angaben zum Schlüssel werden dabei zurückgesetzt: Sonst blieben die gemerkten Teilnehmer der
// einen Kostenart an der nächsten hängen, ohne dass jemand sie gewählt hätte.
function proposal(previous: ItemForm, category: string, units: Unit[], meters: Meter[], ctx?: KeyContext): ItemForm {
  const form: ItemForm = { ...previous, directUnitId: '', meterType: '', customShares: {}, participants: null }
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.year) : null
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
    year: 0,
    category: form.category,
    key: form.key,
    meterType: form.meterType || null,
    directUnitId: form.directUnitId || null,
    customShares: shares,
    participantUnitIds: participants,
    externalBasis: total !== null ? { measure: form.externalMeasure, total, totalCents: 0 } : { measure: form.externalMeasure, total: 0, totalCents: 0 },
  })
}

// Hinweis im Formular, wenn die Position anders verteilt als dieselbe Kostenart im Vorjahr; dieselbe
// Frage stellt die Abrechnung (`key.changed-from-previous-year` in server/src/calc.ts). Leer, wenn
// nichts zu sagen ist.
export function keyChangeNotice(form: ItemForm, units: Unit[], ctx: KeyContext): string {
  if (isNotAllocable(form.category)) return ''
  const before = previousYearItems(ctx.items, form.category, ctx.year).map(allocationOf)
  const first = before[0]
  const now = formAllocation(form, units)
  if (!first || before.some((a) => sameAllocation(a, now))) return ''
  const how = first.key === now.key ? `ebenfalls ${KEY_LABELS[first.key]}, aber mit anderen Angaben` : KEY_LABELS[first.key]
  return `${ctx.year - 1} wurde „${form.category}“ ${how} verteilt. Einen vereinbarten Umlageschlüssel ändern Sie nicht einseitig von Jahr zu Jahr; ist die Änderung so vereinbart, ist nichts zu tun.`
}

// KI-Übernahme (#141): der Schlüssel einer ausgewerteten Position. Einen gemerkten Schlüssel mit
// Einzelbeträgen übernimmt die Zeile nicht, denn die Beträge je Mieter sind Zahlen des Jahres und
// stehen dort nicht zur Eingabe.
export type AiPositionKey = { key: CostKey; allocation: Allocation | null }
export function aiPositionDefaults(category: string, units: Unit[], meters: Meter[], ctx?: KeyContext): AiPositionKey {
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.year) : null
  if (remembered && remembered.key !== 'amounts') return { key: remembered.key, allocation: remembered }
  // Bei einer Eigentumswohnung nur, wenn die Summe der Anteile schon einmal erfasst ist: Ein Feld
  // dafür hat die Zeile nicht, sie bliebe sonst unübernehmbar.
  const last = ctx && etwByStatement(category, ctx) ? lastExternalBasis(ctx.items) : null
  if (last) return { key: 'external', allocation: allocationOf({ year: 0, category, key: 'external', externalBasis: { ...last, totalCents: 0 } }) }
  // Wie bisher nur der Schlüssel; die Auswahl der Zeile bietet die drei einfachen an.
  return { key: defaultKeyFor(category), allocation: null }
}

export type AiPosition = AiPositionKey & { description: string; category: string; amount: string; labor35a: string; externalTotalAmount: string }

// Die Auswahl der Zeile: die drei einfachen Schlüssel und der gespeicherte, damit angezeigt wird,
// was gespeichert wird (Kosten.test.tsx).
export function aiKeyOptions(stored: CostKey): CostKey[] {
  const simple: CostKey[] = ['area', 'persons', 'units']
  return simple.includes(stored) ? simple : [...simple, stored]
}

function aiPositionForm(p: AiPosition, extra: { vendor?: string; invoiceFile?: string }, units: Unit[]): ItemForm {
  const base: ItemForm = { ...EMPTY_ITEM_FORM, category: p.category, description: p.description, vendor: extra.vendor ?? '', amount: p.amount, labor35a: p.labor35a, invoiceFile: extra.invoiceFile }
  const withAlloc = p.allocation && p.allocation.key === p.key ? applyAllocation(base, p.allocation, units) : { ...base, key: p.key }
  return { ...withAlloc, externalTotalAmount: p.externalTotalAmount }
}

// Der Rumpf einer übernommenen Position, über dieselbe Prüfung wie im Formular.
export function aiPositionBody(p: AiPosition, extra: { vendor?: string; invoiceFile?: string }, units: Unit[], year: number): BuildResult {
  return buildCostItemBody(aiPositionForm(p, extra, units), units, year)
}
export function aiPositionProblem(p: AiPosition, units: Unit[], year: number): string | null {
  const built = aiPositionBody(p, {}, units, year)
  return 'error' in built ? built.error : null
}

// Bei nicht umlagefähigen Kostenarten gibt es nichts zu verteilen (#142): Die Berechnung trägt sie
// ganz dem Vermieter zu und liest ihren Schlüssel nicht (calc.ts, `isNotAllocable`). Das Formular
// zeigt deshalb keine Schlüsselauswahl, und die Liste keinen Schlüssel.
export const showsKeyFields = (category: string): boolean => !isNotAllocable(category)
export function keyListText(item: Pick<CostItem, 'category' | 'key'>): string {
  return isNotAllocable(item.category) ? '— trägt der Vermieter' : KEY_LABELS[item.key]
}

export function costKeyOptions(unitMeterTypes: MeterType[], stored: CostKey): CostKey[] {
  return (Object.keys(KEY_LABELS) as CostKey[]).filter(
    (k) => (k !== 'meter' || unitMeterTypes.length > 0 || stored === 'meter') &&
      true,
  )
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

export type BuildResult = { error: string } | { body: Record<string, unknown> }

// Betrag und §35a-Lohnanteil einer Kostenposition, wie das Formular sie prüft (#139). Dieselbe
// Prüfung gilt für Positionen, die aus einer Belegauswertung übernommen werden, damit eine
// Gutschrift dort nicht anders behandelt wird als hier. `null` bei einem Betrag heißt unlesbar.
// Eine Gutschrift hat einen negativen Betrag; Berechnung und Datenbank kennen sie. Nur 0 ist
// keine Kostenposition. Die Meldung nennt den Grund, statt „gültig“ offen zu lassen.
export function amountProblem(amount: number | null, labor35a: number | null, category?: string): string | null {
  if (amount === null) return 'Bitte den Betrag als Euro-Betrag angeben, z. B. 54,00 (eine Gutschrift mit Minus: -54,00).'
  if (amount === 0) return 'Ein Betrag von 0 € ist keine Kostenposition. Bitte den Rechnungsbetrag eintragen.'
  // § 35a EStG bescheinigt gezahlte Lohnkosten. Bei einer Gutschrift bescheinigte die Berechnung
  // ohnehin nichts (calc.ts meldet den Lohnanteil als ungültig), die Steuerübersicht zählte ihn
  // aber mit.
  if (amount < 0 && labor35a !== 0) return 'Bei einer Gutschrift gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  // Die Zuführung zur Erhaltungsrücklage ist keine bezahlte Arbeit, sondern angespartes Geld
  // (#143); einen Lohnanteil gibt es erst an der Rechnung, die die Gemeinschaft daraus bezahlt.
  if (category === 'Zuführung Erhaltungsrücklage' && labor35a !== 0) {
    return 'An der Zuführung zur Erhaltungsrücklage gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  }
  if (labor35a === null || labor35a < 0 || (amount > 0 && labor35a > amount)) {
    return 'Der §35a-Lohnanteil muss eine gültige Zahl zwischen 0 und dem Gesamtbetrag sein.'
  }
  return null
}

// Validiert das Formular und baut den API-Rumpf. Felder, die zum gewählten Schlüssel nicht
// gehören, werden ausdrücklich auf null gesetzt: die generische PUT-Route übernimmt nur
// vorhandene Felder, sonst blieben alte Zuordnungen in der Datei stehen.
export function buildCostItemBody(form: ItemForm, units: Unit[], year: number, tenancies?: Tenancy[]): BuildResult {
  const amount = parseEuro(form.amount)
  const labor35a = form.labor35a.trim() ? parseEuro(form.labor35a) : 0
  if (!form.description.trim()) return { error: 'Bitte eine Beschreibung angeben.' }
  const problem = amountProblem(amount, labor35a, form.category)
  if (problem !== null || amount === null) return { error: problem ?? 'Bitte einen Betrag angeben.' }
  // Nicht umlagefähig (#142): Gespeichert wird die neutrale Vorgabe ohne jede Zuordnung. Die
  // Spalte verlangt einen Schlüssel, die Berechnung liest ihn hier aber nicht; eine Zuordnung, die
  // aus einer früheren Kostenart im Formular stehengeblieben ist, bliebe sonst als tote Angabe in
  // der Datenbank und tauchte nach einem Wechsel der Kostenart unbemerkt wieder auf.
  if (isNotAllocable(form.category)) {
    return {
      body: {
        year,
        category: form.category,
        description: form.description.trim(),
        vendor: form.vendor.trim() || undefined,
        amountCents: amount,
        labor35aCents: labor35a || undefined,
        key: 'area',
        directUnitId: null,
        meterType: null,
        customShares: null,
        participantUnitIds: null,
        externalBasis: null,
        tenancyAmounts: null,
        selfAmounts: null,
        invoiceFile: form.invoiceFile ?? null,
      },
    }
  }
  if (amount < 0 && form.key === 'amounts') return { error: CREDIT_WITH_AMOUNTS }
  if (form.key === 'direct' && !form.directUnitId) {
    return { error: 'Bei Direktzuordnung bitte eine Wohnung wählen.' }
  }
  if (form.key === 'meter' && !form.meterType) {
    return { error: 'Bei Verbrauchsumlage bitte einen Zählertyp wählen.' }
  }

  let customShares: Record<string, number> | null = null
  if (form.key === 'custom') {
    customShares = {}
    for (const u of basisUnitsOf(units)) {
      const raw = form.customShares[u.id]?.trim()
      if (!raw) continue
      // Prozent in deutscher oder technischer Schreibweise; parseEuro liefert Hundertstel
      const hundredths = parseEuro(raw)
      if (hundredths === null || hundredths < 0) {
        return { error: `Anteil für „${u.name}" bitte als Prozentzahl angeben (z. B. 33,33).` }
      }
      if (hundredths > 0) customShares[u.id] = hundredths / 100
    }
    const sum = Object.values(customShares).reduce((a, p) => a + p, 0)
    if (sum <= 0) return { error: 'Bitte mindestens einen Anteil größer 0 % angeben.' }
    if (sum > 100.0001) {
      return { error: `Die Anteile ergeben ${fmtPct(sum)} % — mehr als 100 % sind nicht möglich.` }
    }
  }

  // Teilnehmer: alle angehakt heißt null, damit auch künftig angelegte Wohnungen dazugehören.
  let participantUnitIds: string[] | null = null
  if (PARTICIPANT_KEYS.includes(form.key) && form.participants !== null) {
    if (form.participants.length === 0) return { error: 'Bitte mindestens eine teilnehmende Wohnung wählen.' }
    const alle = basisUnitsOf(units).map((u) => u.id)
    participantUnitIds = alle.every((id) => form.participants?.includes(id)) ? null : form.participants
  }

  let externalBasis: { measure: ExternalMeasure, total: number, totalCents: number } | null = null
  if (form.key === 'external') {
    const total = parseAmountNumber(form.externalTotal)
    const totalCents = parseEuro(form.externalTotalAmount)
    if (total === null || !(total > 0) || totalCents === null) {
      return { error: 'Bitte aus der Gemeinschaftsabrechnung die Summe der Anteile in der Anlage und die Kosten der Gemeinschaft eintragen.' }
    }
    externalBasis = { measure: form.externalMeasure, total, totalCents }
  }

  let tenancyAmounts: Record<string, number> | null = null
  let selfAmounts: Record<string, number> | null = null
  if (form.key === 'amounts') {
    const read = (m: Record<string, string>): Record<string, number> | null => {
      const out: Record<string, number> = {}
      for (const [id, raw] of Object.entries(m)) {
        if (!raw.trim()) continue
        const cents = parseEuro(raw)
        if (cents === null || cents < 0) return null
        out[id] = cents
      }
      return out
    }
    tenancyAmounts = read(visibleTenancyAmounts(form, units, tenancies, year))
    selfAmounts = read(visibleSelfAmounts(form, units))
    if (!tenancyAmounts || !selfAmounts) return { error: 'Einzelbeträge bitte als Euro-Beträge angeben (z. B. 312,40).' }
    const sum = [...Object.values(tenancyAmounts), ...Object.values(selfAmounts)].reduce((a, c) => a + c, 0)
    if (sum > amount) return { error: 'Die Einzelbeträge ergeben zusammen mehr als der Rechnungsbetrag.' }
  }

  return {
    body: {
      year,
      category: form.category,
      description: form.description.trim(),
      vendor: form.vendor.trim() || undefined,
      amountCents: amount,
      labor35aCents: labor35a || undefined,
      key: form.key,
      directUnitId: form.key === 'direct' ? form.directUnitId : null,
      meterType: form.key === 'meter' ? form.meterType : null,
      customShares,
      participantUnitIds,
      externalBasis,
      tenancyAmounts,
      selfAmounts,
      invoiceFile: form.invoiceFile ?? null, // null löscht eine bestehende Zuordnung
    },
  }
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
