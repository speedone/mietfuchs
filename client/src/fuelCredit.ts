// Gutschrift ohne Rechnung (#251): Ergeben die Positionen einer Lieferung zusammen weniger als 0 €, belegt sie keinen
// Verbrauch. Die Karte „Lieferungen“ fragt „Was ist diese Gutschrift?“; die Logik dafür steht hier, ohne DOM prüfbar.
// Die Daten unterscheiden die Fälle nicht: eine Gutschrift oder Stornorechnung zu einer anderen Lieferung (Antwort 1),
// der Zahlbetrag einer Jahresrechnung nach Abzug der Abschläge (Antwort 2, ein Erfassungsfehler) oder eine Gutschrift,
// deren Rechnung nicht in Mietfuchs steht (Antwort 3). Gespeichert wird nur Antwort 3; Antwort 1 ändert Daten, Antwort 2
// ist eine Anleitung.
import { parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelDelivery } from './types'

type LinkedItem = { fuelDeliveryId?: string | null; amountCents: number }

export const CREDIT_QUESTION = 'Was ist diese Gutschrift?'
export type CreditAnswer = 'reassign' | 'payment' | 'standalone'
export const CREDIT_ANSWERS: readonly { value: CreditAnswer; label: string }[] = [
  { value: 'reassign', label: 'Sie berichtigt eine andere Lieferung' },
  { value: 'payment', label: 'Sie ist der Zahlbetrag nach Abzug der Abschläge' },
  { value: 'standalone', label: 'Sie ist eine Gutschrift, deren Rechnung nicht in Mietfuchs steht' },
]
export const PAYMENT_GUIDE = 'Tragen Sie als Betrag die Kosten laut Rechnung für den Abrechnungszeitraum ein, nicht das Guthaben oder den Zahlbetrag. Abschläge sind Zahlungen, keine Kosten.'
export const RETURNED_QUESTION = 'Hat der Lieferant Brennstoff zurückgenommen?'
// § 3 Abs. 3 CO2KostAufG: Der CO₂-Kostenanteil hängt an Menge und Zertifikatspreis; ein Preisnachlass ändert beides nicht.
export const RETURNED_HINT = 'Nur dann ändern sich Menge, CO₂-Ausstoß und CO₂-Kosten der Rechnung; ein Preisnachlass lässt sie unverändert.'
export const STANDALONE_DONE = 'Sie haben angegeben, dass die Rechnung zu dieser Gutschrift nicht in Mietfuchs steht. Mietfuchs verteilt sie nach dem Verbrauch und rechnet ihren Zeitraum als nicht abgedeckt.'

const sumOf = (id: string, items: readonly LinkedItem[]): { n: number; cents: number } => {
  const mine = items.filter((c) => c.fuelDeliveryId === id)
  return { n: mine.length, cents: mine.reduce((a, c) => a + c.amountCents, 0) }
}

// Die Gutschriften ohne Rechnung unter den Lieferungen: echte Lieferungen mit Positionen, die zusammen weniger als 0 € ergeben.
export function creditOnlyOf(deliveries: readonly FuelDelivery[], items: readonly LinkedItem[]): { delivery: FuelDelivery; cents: number }[] {
  return deliveries.flatMap((d) => {
    const s = sumOf(d.id, items)
    return !d.estimated && s.n > 0 && s.cents < 0 ? [{ delivery: d, cents: s.cents }] : []
  })
}

// Die Lieferungen, die die Gutschrift berichtigen kann: dieselbe Anlage, keine Schätzung, Positionen über mehr als 0 €.
// Die erste Zeile ist „bitte wählen“, damit die Auswahl nie eine Lieferung zeigt, die nicht gewählt ist.
export function creditTargetOptions(source: FuelDelivery, deliveries: readonly FuelDelivery[], items: readonly LinkedItem[]): { value: string; label: string }[] {
  return [
    { value: '', label: '— bitte wählen —' },
    ...deliveries
      .filter((d) => d.id !== source.id && d.plantId === source.plantId && !d.estimated && sumOf(d.id, items).cents > 0)
      .map((d) => {
        const range = d.invoiceFrom && d.invoiceTo ? formatDayRange(d.invoiceFrom, d.invoiceTo) : null
        return { value: d.id, label: d.label ? (range ? `${d.label} (${range})` : d.label) : (range ?? 'Lieferung') }
      }),
  ]
}

export type ReassignForm = { targetId: string; returned: boolean; quantity: string; emissionsKg: string; co2Cost: string }
export const emptyReassignForm = (): ReassignForm => ({ targetId: '', returned: false, quantity: '', emissionsKg: '', co2Cost: '' })

// Der Rumpf für „Sie berichtigt eine andere Lieferung“. Hat der Lieferant Brennstoff zurückgenommen, die berichtigten
// Angaben der Zielrechnung; sonst nur das Ziel.
export function reassignBody(form: ReassignForm): { body: Record<string, unknown> } | { error: string } {
  if (form.targetId === '') return { error: 'Bitte wählen Sie die Lieferung, die die Gutschrift berichtigt.' }
  if (!form.returned) return { body: { targetId: form.targetId } }
  const quantity = parseDecimal(form.quantity)
  if (form.quantity.trim() === '' || quantity === null || quantity < 0) return { error: 'Bitte tragen Sie die berichtigte Menge der Rechnung ein.' }
  const kg = form.emissionsKg.trim() === '' ? null : parseDecimal(form.emissionsKg)
  if (kg !== null && kg < 0) return { error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' }
  if (form.emissionsKg.trim() !== '' && kg === null) return { error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' }
  const co2 = form.co2Cost.trim() === '' ? null : parseEuro(form.co2Cost)
  if (form.co2Cost.trim() !== '' && (co2 === null || co2 < 0)) return { error: 'Die CO₂-Kosten sind ein Betrag ab 0.' }
  return { body: { targetId: form.targetId, quantity, ...(kg !== null ? { emissionsKg: kg } : {}), ...(co2 !== null ? { co2CostCents: co2 } : {}) } }
}

// Was eine Antwort bewirkt: zuordnen (Rumpf aus `reassignBody`), die Angabe speichern oder nur eine Anleitung zeigen.
export function creditAction(answer: CreditAnswer, d: Pick<FuelDelivery, 'id'>):
  | { kind: 'reassign'; url: string }
  | { kind: 'save'; url: string; body: { creditNoteKind: 'standalone' } }
  | { kind: 'guide'; text: string } {
  if (answer === 'reassign') return { kind: 'reassign', url: `/api/fuel-deliveries/${d.id}/reassign-credit` }
  if (answer === 'standalone') return { kind: 'save', url: `/api/fuel-deliveries/${d.id}`, body: { creditNoteKind: 'standalone' } }
  return { kind: 'guide', text: PAYMENT_GUIDE }
}
