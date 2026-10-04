// „Aus dem Vorjahr übernehmen“ (#141): Die Positionen des Vorjahres desselben Objekts werden zur
// Vorlage für das gewählte Jahr. Mit kommen Kostenart, Beschreibung (Jahreszahl ersetzt),
// Rechnungssteller und der Schlüssel samt Angaben; leer bleiben der Betrag, der §35a-Anteil und die
// Kosten der Gemeinschaft, denn das sind die Zahlen des Jahres. Kein Beleg.
//
// Die Vorlagen leben nur im Browser und nicht als Entwürfe in der Datenbank: Eine Position ohne
// Betrag wäre dort eine 0, die in jede Rechnung einginge, oder ein Entwurfs-Kennzeichen, das jede
// Rechnung kennen müsste (siehe docs/superpowers/specs/2026-10-02-schluessel-merken-design.md).
// Gespeichert wird nur, was durch `buildCostItemBody` geht, also dieselbe Prüfung wie im Formular.
import type { CostItem, Tenancy, Unit } from './types'
import { buildCostItemBody, fmtPct, itemToForm, type BuildResult, type ItemForm } from './costForm'
import { replaceYear } from '../../shared/allocation.ts'
import { normalizedText, sameCostCandidates } from '../../shared/duplicates.ts'

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
export function alreadyCarried(items: readonly CostItem[], row: Pick<CarryRow, 'source' | 'description'> & Partial<Pick<CarryRow, 'vendor'>>, year: number): boolean {
  const category = row.source.category
  const sisters = items
    .filter((i) => i.year === year - 1 && i.category === category && i.id !== row.source.id)
    .map((i) => normalizedText(i.description))
  const own = normalizedText(row.description)
  return sameCostCandidates(items, { year, category, description: row.description, vendor: row.vendor ?? row.source.vendor, amountCents: row.source.amountCents })
    .some((i) => {
      const text = normalizedText(i.description)
      return text === own || !sisters.includes(text)
    })
}

export function carryOverRows(items: readonly CostItem[], year: number): CarryRow[] {
  return items.filter((i) => i.year === year - 1).map((source) => {
    const description = replaceYear(source.description, year - 1, year)
    return {
      source,
      description,
      vendor: source.vendor ?? '',
      amount: '',
      labor35a: '',
      externalTotalAmount: '',
      checked: false,
      already: alreadyCarried(items, { source, description, vendor: source.vendor ?? '' }, year),
      inline: source.key !== 'amounts',
    }
  })
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
    invoiceFile: undefined,
  }
}

export function carryOverBody(row: CarryRow, units: Unit[], year: number, tenancies?: Tenancy[]): BuildResult {
  if (!row.inline) return { error: 'Einzelbeträge je Mieter bitte im Formular eintragen („Im Formular öffnen“).' }
  if (!row.amount.trim()) return { error: 'Betrag fehlt.' }
  return buildCostItemBody(carryOverForm(row), units, year, tenancies)
}
