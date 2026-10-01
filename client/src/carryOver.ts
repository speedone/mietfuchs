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
import { buildCostItemBody, itemToForm, type BuildResult, type ItemForm } from './costForm'

export type CarryRow = {
  source: CostItem
  description: string
  vendor: string
  amount: string
  labor35a: string
  // Nur bei „laut Gemeinschaftsabrechnung“: die Kosten der ganzen Anlage im neuen Jahr
  externalTotalAmount: string
  checked: boolean
  // Steht im Jahr schon eine Position derselben Kostenart mit derselben Beschreibung?
  already: boolean
  // Einzelbeträge je Mieter lassen sich nicht in einer Zeile eintragen, nur im Formular.
  inline: boolean
}

// Die Jahreszahl des Vorjahres als ganzes Wort: „Grundsteuer 2025“ wird „Grundsteuer 2026“, eine
// Rechnungsnummer 120250 bleibt.
export function replaceYear(text: string, from: number, to: number): string {
  // Ohne Lookbehind, das ältere Browser nicht kennen (pdf.js läuft aus demselben Grund in der
  // legacy-Fassung).
  return text.replace(new RegExp(`(^|\\D)${from}(?=\\D|$)`, 'g'), (_m, before: string) => `${before}${to}`)
}

// Steht im Jahr schon eine Position derselben Kostenart mit dieser Beschreibung? Die Seite fragt
// das bei jeder Anzeige neu, damit eine über das Formular angelegte Zeile gleich vermerkt ist.
export function alreadyCarried(items: readonly CostItem[], row: Pick<CarryRow, 'source' | 'description'>, year: number): boolean {
  const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  return items.some((i) => i.year === year && i.category === row.source.category && sameText(i.description, row.description))
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
      already: alreadyCarried(items, { source, description }, year),
      inline: source.key !== 'amounts',
    }
  })
}

// Ein Betrag hakt die Zeile an, ein geleertes Feld ab; abhaken lässt sie sich jederzeit von Hand.
export function withCarryAmount(row: CarryRow, amount: string): CarryRow {
  return { ...row, amount, checked: amount.trim() !== '' }
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
