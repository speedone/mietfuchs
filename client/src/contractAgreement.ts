// Formularlogik zu „nicht im Mietvertrag vereinbart“ (#258): Welche Mietverhältnisse die Frage betrifft,
// wie eine Antwort das Formular ändert und bei welchen Kostenarten es sie gar nicht gibt. Rein, ohne React;
// die Darstellung steht im Seitenfenster der Kostenposition. Importiert aus costForm.ts nur Typen, denn
// costForm.ts importiert von hier.
import type { BillingPeriod, Tenancy, Unit } from './types'
import type { ItemForm } from './costForm'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { isNotAllocable } from '../../shared/categories.ts'
import { PARTICIPANT_KEYS } from '../../shared/allocation.ts'

export type ContractTenancy = { tenancyId: string, tenantName: string, unitId: string, unitName: string }

// Bei diesen Kostenarten gibt es die Antwort „steht nicht im Vertrag“ nicht: Heizung und Warmwasser folgt der
// Heizkostenverordnung (BGH VIII ZR 212/05), die beiden anderen werden nie umgelegt. Dieselbe Menge lehnt der Server ab.
export const allowsContractAnswer = (category: string): boolean => category !== HEATING_CATEGORY && !isNotAllocable(category)

// Die Wohnungen, die an der Position teilnehmen: bei Direktzuordnung die eine, bei vereinbarten Anteilen die mit
// Anteil, sonst die Teilnehmer (leer heißt alle).
function participatingUnitIds(form: ItemForm, units: Unit[]): Set<string> {
  const rented = units.filter((u) => u.participates)
  if (form.key === 'direct') return new Set(rented.filter((u) => u.id === form.directUnitId).map((u) => u.id))
  if (form.key === 'custom') return new Set(rented.filter((u) => (Number(form.customShares[u.id]?.trim().replace(',', '.') || '0') || 0) > 0).map((u) => u.id))
  return new Set(rented.filter((u) => form.participants === null || !PARTICIPANT_KEYS.includes(form.key) || form.participants.includes(u.id)).map((u) => u.id))
}

const inPeriod = (t: Tenancy, period: Pick<BillingPeriod, 'from' | 'to'>) => t.start <= period.to && (t.end === null || t.end >= period.from)

// Die Mietverhältnisse, die im Zeitraum bestehen und an der Position teilnehmen; nur für sie kann das Formular
// „nicht vereinbart“ oder „im Vertrag genannt“ speichern.
export function contractTenancies(form: ItemForm, units: Unit[], tenancies: Tenancy[], period: Pick<BillingPeriod, 'from' | 'to'>): ContractTenancy[] {
  const ids = participatingUnitIds(form, units)
  return tenancies
    .filter((t) => ids.has(t.unitId) && inPeriod(t, period))
    .map((t) => ({ tenancyId: t.id, tenantName: t.tenantName, unitId: t.unitId, unitName: units.find((u) => u.id === t.unitId)?.name ?? '' }))
}

// Die Antwort auf „Warum trägt die Wohnung diese Kosten nicht?“. `contract`: Die Wohnung nimmt wieder teil, die
// genannten Mietverhältnisse tragen nicht, der Vermieter trägt ihren Anteil. `notConcerned`: Die Wohnung bleibt
// abgewählt, die übrigen tragen den Anteil.
export function answerWhy(form: ItemForm, unitId: string, why: 'notConcerned' | 'contract', tenancyIds: string[]): ItemForm {
  const pendingWhy = form.pendingWhy.filter((id) => id !== unitId)
  if (why === 'notConcerned') return { ...form, pendingWhy }
  return {
    ...form,
    participants: form.participants === null || form.participants.includes(unitId) ? form.participants : [...form.participants, unitId],
    notAgreed: [...form.notAgreed, ...tenancyIds.filter((id) => !form.notAgreed.includes(id))],
    named: form.named.filter((id) => !tenancyIds.includes(id)),
    pendingWhy,
  }
}

// Fragt das Abwählen einer Wohnung, warum? Wo die zweite Antwort erlaubt ist, und bei Heizung und Warmwasser, wo statt
// ihrer der Satz zur Heizkostenverordnung steht. Nicht umlagefähig und Rücklage tragen die Mieter ohnehin nicht.
export const asksWhy = (category: string): boolean => allowsContractAnswer(category) || category === HEATING_CATEGORY


// Die Mietverhältnisse einer Wohnung im Zeitraum, auch wenn sie gerade abgewählt ist (für die Warum-Frage).
export function unitTenancies(unitId: string, units: Unit[], tenancies: Tenancy[], period: Pick<BillingPeriod, 'from' | 'to'>): ContractTenancy[] {
  const unitName = units.find((u) => u.id === unitId)?.name ?? ''
  return tenancies.filter((t) => t.unitId === unitId && inPeriod(t, period)).map((t) => ({ tenancyId: t.id, tenantName: t.tenantName, unitId, unitName }))
}

// Eine Wohnung in der Teilnehmerliste an- oder abhaken. Abhaken einer Wohnung mit Mietverhältnis im Zeitraum stellt die
// Warum-Frage; Anhaken nimmt sie zurück. `basisIds`: alle Wohnungen der Liste (Teilnehmer `null` heißt alle).
export function withParticipant(form: ItemForm, unitId: string, checked: boolean, basisIds: string[], units: Unit[], tenancies: Tenancy[], period: Pick<BillingPeriod, 'from' | 'to'>): ItemForm {
  const current = form.participants ?? basisIds
  const participants = checked ? (current.includes(unitId) ? current : [...current, unitId]) : current.filter((id) => id !== unitId)
  const others = form.pendingWhy.filter((id) => id !== unitId)
  const asks = !checked && asksWhy(form.category) && unitTenancies(unitId, units, tenancies, period).length > 0
  return { ...form, participants, pendingWhy: asks ? [...others, unitId] : others }
}

// Die Wohnungen, deren Frage das Formular zeigt: abgewählt in diesem Fenster, noch abgewählt und bei einem Schlüssel
// mit Teilnehmerliste. Eine Frage, die nicht mehr zu sehen ist (Schlüssel gewechselt, wieder angehakt), zählt nicht.
export const openWhy = (form: ItemForm): string[] =>
  !PARTICIPANT_KEYS.includes(form.key) || form.participants === null ? [] : form.pendingWhy.filter((id) => !form.participants?.includes(id))

// Häkchen „trägt nicht, steht nicht im Vertrag“ (Textlink, Warum-Frage): Wer nicht trägt, ist auch nicht „genannt“.
export function withNotAgreed(form: ItemForm, tenancyId: string, on: boolean): ItemForm {
  const notAgreed = form.notAgreed.filter((id) => id !== tenancyId)
  return on ? { ...form, notAgreed: [...notAgreed, tenancyId], named: form.named.filter((id) => id !== tenancyId) } : { ...form, notAgreed }
}

// „Sonstige Betriebskosten“: „Ja“ (im Vertrag genannt) oder „Nein“ (trägt nicht), jeweils aus der anderen Liste.
export function withNamed(form: ItemForm, tenancyId: string, named: boolean): ItemForm {
  if (!named) return withNotAgreed(form, tenancyId, true)
  return { ...form, named: [...form.named.filter((id) => id !== tenancyId), tenancyId], notAgreed: form.notAgreed.filter((id) => id !== tenancyId) }
}

// Die Zeile in der Liste der Positionen, neben „nur EG rechts, OG“; ohne Angabe nichts.
export function notAgreedText(ids: readonly string[] | null | undefined, tenancies: readonly Tenancy[]): string | null {
  if (!ids || ids.length === 0) return null
  return `trägt nicht: ${ids.map((id) => tenancies.find((t) => t.id === id)?.tenantName ?? '?').join(', ')} (Vertrag)`
}
