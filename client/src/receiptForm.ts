// Von Hand erfassen aus dem Beleg (#490 PR 3, #487 Teil 2, Entscheidung 2A): Ein gespeicherter Beleg ohne Position öffnet
// das vorhandene Kostenformular, mit dem Beleg vorbelegt und der Kostenart, die sein Name nennt. Tippt man einen
// Rechnungssteller, den es im Vorjahr gab, lassen sich Kostenart, Beschreibung und Schlüssel von dort übernehmen, wie
// mit „Aus dem Vorjahr übernehmen“ (carryOver.ts), nie der Betrag: Der ist die Zahl des neuen Jahres.
import type { Meter, Unit, UploadInfo } from './types'
import { matchCategory } from './types'
import { EMPTY_ITEM_FORM, withCategory, type ItemForm, type KeyContext } from './costForm'
import { carryOverForm, type CarryRow } from './carryOver'
import { normalizedText } from '../../shared/duplicates.ts'

const FALLBACK = 'Sonstige Betriebskosten'

// Die Kostenart, die der Dateiname nennt (dieselbe Lesart wie `attachChoices` in receipts.ts), sonst leer: Der Rückfall
// von matchCategory auf „Sonstige Betriebskosten“ wäre ein stiller Vorschlag ohne Grund, und das Auswahlfeld zeigte
// eine Kostenart, die niemand gewählt hat.
export function categoryFromName(name: string): string {
  // NFC: macOS liefert Dateinamen zerlegt („u“ und Trema), matchCategory sucht das „ü“.
  const text = name.normalize('NFC').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
  const category = matchCategory(text)
  return category === FALLBACK && !/sonstig/i.test(text) ? '' : category
}

// Das Formular einer neuen Position aus einem Beleg: der Beleg angehängt, die Kostenart samt dem Schlüssel, den das
// Formular für sie vorschlägt; ohne Kostenart der übliche Schlüssel, und die Auswahl fragt.
export function receiptItemForm(upload: Pick<UploadInfo, 'file' | 'originalName'>, units: Unit[], meters: Meter[], ctx?: KeyContext): ItemForm {
  const category = categoryFromName(upload.originalName || upload.file)
  const base: ItemForm = { ...EMPTY_ITEM_FORM, invoiceFile: upload.file }
  return category ? withCategory(base, category, units, meters, ctx) : { ...base, category: '' }
}

// Die Vorlagen des Vorjahres (carryOverRows) mit demselben Rechnungssteller. Verglichen wird der ganze Name ohne
// Schreibweise (shared/duplicates.ts), ab drei Zeichen; ein Präfix trifft nicht, sonst stünde bei „Stadt“ jede
// Rechnung der Stadtwerke. Mit `form`: ohne die Vorlage, die das Formular schon zeigt (gleiche Kostenart und
// Beschreibung), damit der Hinweis nach dem Übernehmen verschwindet.
export function vendorPrevious(rows: readonly CarryRow[], vendor: string, form?: Pick<ItemForm, 'category' | 'description'>): CarryRow[] {
  const wanted = normalizedText(vendor)
  if (wanted.length < 3) return []
  return rows.filter((r) => normalizedText(r.source.vendor) === wanted
    && !(form && form.category === r.source.category && normalizedText(form.description) === normalizedText(r.description)))
}

// Übernehmen: Kostenart, Beschreibung und Schlüssel samt Angaben aus der Vorlage (`carryOverForm`); was der Beleg
// dieses Jahres sagt, bleibt: Betrag, Lohnanteil, Rechnungssteller, Beleg, Zahlungsdatum und Leistungszeitraum.
export function adoptPrevious(form: ItemForm, row: CarryRow): ItemForm {
  return {
    ...carryOverForm(row),
    id: form.id,
    vendor: form.vendor,
    amount: form.amount,
    labor35a: form.labor35a,
    invoiceFile: form.invoiceFile,
    paidOn: form.paidOn,
    serviceFrom: form.serviceFrom,
    serviceTo: form.serviceTo,
  }
}

// Was das Kostenformular von einem Beleg braucht, aus dem es geöffnet wird: Name und Art für Vorschau und Kostenart,
// Objekt und Jahr für den Sprung dorthin (App.tsx `openNewCostItem`), das gespeicherte Rechnungsdatum.
export type ReceiptStart = Pick<UploadInfo, 'file' | 'originalName' | 'mimeType' | 'propertyId' | 'year' | 'invoiceDate'>
