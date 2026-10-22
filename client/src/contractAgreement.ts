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

// Die Mietverhältnisse, die im Zeitraum bestehen und an der Position teilnehmen; nur für sie kann das Formular
// „nicht vereinbart“ oder „im Vertrag genannt“ speichern.
export function contractTenancies(form: ItemForm, units: Unit[], tenancies: Tenancy[], period: Pick<BillingPeriod, 'from' | 'to'>): ContractTenancy[] {
  const ids = participatingUnitIds(form, units)
  return tenancies
    .filter((t) => ids.has(t.unitId) && t.start <= period.to && (t.end === null || t.end >= period.from))
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
