// Entscheidungslogik des Kostenposition-Formulars, bewusst getrennt von der Darstellung:
// Auswahllisten, Validierung und der Rumpf, der an die API geht. Diese Stelle bestimmt, was
// tatsächlich gespeichert wird — sie ist in client/src/costForm.test.ts geprüft.
import type { CostItem, CostKey, ExternalMeasure, MeterType, Tenancy, Unit } from './types'
import { CATEGORIES, KEY_LABELS } from './types'
import { parseEuro } from './api'
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
    externalTotal: i.externalBasis ? fmtPct(i.externalBasis.total) : '',
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
export const EXTERNAL_MEASURE_OPTIONS: { value: ExternalMeasure, label: string }[] = [
  { value: 'mea', label: 'Miteigentumsanteile (MEA)' },
  { value: 'area', label: 'Wohnfläche (m²)' },
  { value: 'units', label: 'Einheiten' },
]

// Eine Menge wie „10.000“ MEA oder „1.240“ m². Anders als bei Euro-Beträgen ist ein Punkt vor
// genau drei Ziffern hier der Tausenderpunkt: Eine Summe von zehn Miteigentumsanteilen mit drei
// Nachkommastellen gibt es nicht, zehntausend sind die Regel.
export function parseQuantity(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  const hundredths = parseEuro(t)
  return hundredths === null ? null : hundredths / 100
}
const parseAmountNumber = parseQuantity

// Die Mietverhältnisse, die einen Einzelbetrag bekommen können: im Jahr und in einer Wohnung, die
// zur Abrechnung gehört.
export function tenanciesForAmounts(tenancies: Tenancy[], units: Unit[], year: number): Tenancy[] {
  const vermietet = new Set(units.filter((u) => u.participates).map((u) => u.id))
  return tenancies.filter((t) => vermietet.has(t.unitId) && t.start <= `${year}-12-31` && (t.end === null || t.end >= `${year}-01-01`))
}

// Der rechnerische Anteil laut Gemeinschaftsabrechnung, zum Vergleich mit dem eingetragenen
// Betrag. Leer, solange die Angaben dafür fehlen.
export function externalHint(form: ItemForm, units: Unit[]): string {
  const total = parseAmountNumber(form.externalTotal)
  const totalCents = parseEuro(form.externalTotalAmount)
  if (total === null || !(total > 0) || totalCents === null) return ''
  const valueOf = (u: Unit) => (form.externalMeasure === 'mea' ? u.mea ?? 0 : form.externalMeasure === 'area' ? u.areaM2 : 1)
  const own = basisUnitsOf(units).reduce((a, u) => a + valueOf(u), 0)
  if (!(own > 0)) return form.externalMeasure === 'mea' ? 'Für die Wohnungen sind noch keine Miteigentumsanteile hinterlegt (Stammdaten).' : ''
  const expected = Math.round((totalCents * own) / total)
  return `Rechnerischer Anteil: ${fmtPct(own)} von ${fmtPct(total)} ${MEASURE_LABELS[form.externalMeasure]} = ${fmtCentsInput(expected)} €`
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
export function amountsSumText(form: ItemForm, units: Unit[]): string {
  const amount = parseEuro(form.amount) ?? 0
  const sumOf = (m: Record<string, string>) => Object.values(m).reduce((a, raw) => a + Math.max(0, parseEuro(raw.trim() || '0') ?? 0), 0)
  const tenants = sumOf(form.tenancyAmounts)
  const own = sumOf(visibleSelfAmounts(form, units))
  const sum = tenants + own
  if (sum > amount) return `${fmtCentsInput(sum)} € — mehr als der Rechnungsbetrag ist nicht möglich`
  const ownText = own > 0 ? `, davon ${fmtCentsInput(own)} € Ihre eigene Wohnung` : ''
  return `Summe ${fmtCentsInput(sum)} €${ownText} — ${fmtCentsInput(amount - sum)} € trägt der Vermieter (Leerstand, Rundung)`
}

// Wohnungen der Abrechnungseinheit — nur sie können einen vereinbarten Anteil tragen
export const basisUnitsOf = (units: Unit[]) => units.filter((u) => usageOf(u) !== 'ausgenommen')

// Auswahllisten. Beide halten dieselbe Regel ein: der gespeicherte Wert steht immer in der
// Liste. Fehlt er, zeigt ein Select im Browser den ersten Eintrag an, während der State
// unverändert bleibt — gespeichert würde dann etwas anderes als das, was zu sehen ist.
export function meterTypeOptions(unitMeterTypes: MeterType[], stored: MeterType | ''): MeterType[] {
  return [...new Set([...unitMeterTypes, ...(stored ? [stored] : [])])]
}

export function costKeyOptions(unitMeterTypes: MeterType[], stored: CostKey): CostKey[] {
  return (Object.keys(KEY_LABELS) as CostKey[]).filter(
    (k) => (k !== 'meter' || unitMeterTypes.length > 0 || stored === 'meter') &&
      true,
  )
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

// Validiert das Formular und baut den API-Rumpf. Felder, die zum gewählten Schlüssel nicht
// gehören, werden ausdrücklich auf null gesetzt: die generische PUT-Route übernimmt nur
// vorhandene Felder, sonst blieben alte Zuordnungen in der Datei stehen.
export function buildCostItemBody(form: ItemForm, units: Unit[], year: number): BuildResult {
  const amount = parseEuro(form.amount)
  const labor35a = form.labor35a.trim() ? parseEuro(form.labor35a) : 0
  if (!form.description.trim() || amount === null || amount <= 0) {
    return { error: 'Bitte Beschreibung und gültigen Betrag angeben.' }
  }
  if (labor35a === null || labor35a < 0 || labor35a > amount) {
    return { error: 'Der §35a-Lohnanteil muss eine gültige Zahl zwischen 0 und dem Gesamtbetrag sein.' }
  }
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
      return { error: 'Bitte aus der Gemeinschaftsabrechnung die Summe in der Anlage und die Gesamtkosten eintragen.' }
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
    tenancyAmounts = read(form.tenancyAmounts)
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
export function categoryNotice(category: string, year: number): string {
  if (category !== 'Kabel/Antenne' || year < 2024) return ''
  return year === 2024
    ? 'Kabelfernsehen (TV-Signal) ist nur bis zum 30.06.2024 umlagefähig, und nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde. Umlegen Sie für 2024 höchstens das erste Halbjahr; den Rest bitte als „Nicht umlagefähig“ erfassen. Danach bleibt bei solchen Anlagen nur der Betriebsstrom umlagefähig, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung durch eine Fachkraft.'
    : 'Kabelfernsehen (TV-Signal) ist seit dem 01.07.2024 nicht mehr umlagefähig; bitte als „Nicht umlagefähig“ erfassen. Umlagefähig bleibt nur der Betriebsstrom einer Anlage, die vor dem 01.12.2021 errichtet wurde, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung durch eine Fachkraft.'
}
