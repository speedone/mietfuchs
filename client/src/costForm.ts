// Entscheidungslogik des Kostenposition-Formulars, bewusst getrennt von der Darstellung:
// Auswahllisten, Validierung und der Rumpf, der an die API geht. Diese Stelle bestimmt, was
// tatsächlich gespeichert wird — sie ist in client/src/costForm.test.ts geprüft.
import type { CostItem, CostKey, MeterType, Unit } from './types'
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
    invoiceFile: i.invoiceFile ?? undefined,
  }
}

export const fmtPct = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

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
    (k) => k !== 'meter' || unitMeterTypes.length > 0 || stored === 'meter',
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
  if (labor35a === null || labor35a > amount) {
    return { error: 'Der §35a-Lohnanteil muss eine gültige Zahl ≤ Gesamtbetrag sein.' }
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
      invoiceFile: form.invoiceFile ?? null, // null löscht eine bestehende Zuordnung
    },
  }
}
