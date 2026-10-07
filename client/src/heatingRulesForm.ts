// Ausnahme nach § 11, Vereinbarung nach § 2, monatliche Information und Verbrauchervertrag je Heizperiode
// (Heizung PR 14, Entwurf 8.8, 8.9), ohne DOM prüfbar. Die Zahlen des § 11 kommen aus dem Register.
import type { AgreedOtherwise, ExemptionScope, HeatingExemption, HeatingRules } from './types'
import { hkvExemptions, hkvRenewableExemption } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

const EX = valueAt(hkvExemptions, LAW_AS_OF)
// Bis wann Nr. 3 a auch Wärmepumpen nannte (Fassung bis 30.09.2024).
const HEAT_PUMP_UNTIL = hkvRenewableExemption.versions.find((v) => v.value.heatPump)?.validTo
// Kurz im Auswahlfeld, damit auch bei 390 px nichts abgeschnitten wird (Runde 2, R2-N-K5); der Wortlaut steht darunter (Durchsicht von #243, R-K6). Nr. 3
// in zwei Buchstaben, denn die Bedingung „sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird“ gehört nur zu
// Buchst. b (R-W7); Nr. 1 b mit vollem Wortlaut (R-K1).
export const EXEMPTION_OPTIONS: { value: HeatingExemption; label: string; text: string }[] = [
  { value: 'none', label: 'Keine Ausnahme', text: '' },
  { value: 'lowDemand', label: `Nr. 1 a: Heizwärmebedarf unter ${EX.lowDemandKwhPerM2Year} kWh/(m²·a)`, text: `Räume in Gebäuden, die einen Heizwärmebedarf von weniger als ${EX.lowDemandKwhPerM2Year} kWh je m² und Jahr aufweisen (§ 11 Abs. 1 Nr. 1 Buchst. a HeizkostenV).` },
  { value: 'disproportionate', label: 'Nr. 1 b: Erfassung unverhältnismäßig teuer', text: `Räume, bei denen das Anbringen der Ausstattung zur Verbrauchserfassung, die Erfassung des Wärmeverbrauchs oder die Verteilung der Kosten des Wärmeverbrauchs nicht oder nur mit unverhältnismäßig hohen Kosten möglich ist; unverhältnismäßig hoch sind Kosten, die nicht durch die Einsparungen erwirtschaftet werden können, die in der Regel innerhalb von ${EX.paybackYears} Jahren erzielt werden können (§ 11 Abs. 1 Nr. 1 Buchst. b HeizkostenV).` },
  { value: 'pre1981', label: `Nr. 1 c: bezugsfertig vor ${germanDate(EX.readyBefore)}`, text: `Räume, die vor dem ${germanDate(EX.readyBefore)} bezugsfertig geworden sind und in denen der Nutzer den Wärmeverbrauch nicht beeinflussen kann (§ 11 Abs. 1 Nr. 1 Buchst. c HeizkostenV).` },
  { value: 'renewable', label: 'Nr. 3 a: überwiegend Rückgewinnung, Solar', text: `Räume in Gebäuden, die überwiegend mit Wärme aus Anlagen zur Rückgewinnung von Wärme oder aus Solaranlagen versorgt werden (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV)${HEAT_PUMP_UNTIL ? `; für Abrechnungszeiträume, die bis zum ${germanDate(HEAT_PUMP_UNTIL)} beginnen, auch aus Wärmepumpen` : ''}.` },
  { value: 'chp', label: 'Nr. 3 b: überwiegend KWK oder Abwärme', text: 'Räume in Gebäuden, die überwiegend mit Wärme aus Anlagen der Kraft-Wärme-Kopplung oder aus Anlagen zur Verwertung von Abwärme versorgt werden, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird (§ 11 Abs. 1 Nr. 3 Buchst. b HeizkostenV).' },
  { value: 'authority', label: 'Nr. 5: Befreiung durch die Landesstelle', text: 'Sonstige Einzelfälle, in denen die nach Landesrecht zuständige Stelle wegen besonderer Umstände von den Anforderungen der Verordnung befreit hat, um einen unangemessenen Aufwand oder sonstige unbillige Härten zu vermeiden (§ 11 Abs. 1 Nr. 5 HeizkostenV).' },
]
// Durchsicht von #243, R-K2: was nicht zur Wahl steht, und warum.
export const EXEMPTION_NOT_OFFERED = 'Nicht zur Wahl stehen Alters- und Pflegeheime, Studenten- und Lehrlingsheime und vergleichbare Gebäude (§ 11 Abs. 1 Nr. 2) und die gesondert abgerechneten Kosten der Hausanlagen bei einer Wärmelieferung (Nr. 4); diese Fälle deckt Mietfuchs nicht ab.'
export const EXEMPTION_SCOPE_OPTIONS: { value: ExemptionScope; label: string }[] = [
  { value: 'heat', label: 'Nein, nur die Wärme' },
  // Kurz genug für 390 px (Runde 3, N2-K3).
  { value: 'both', label: 'Ja, auch das Warmwasser (Abs. 2)' },
]
export const AGREED_OPTIONS: { value: AgreedOtherwise; label: string }[] = [
  { value: 'none', label: 'Keine abweichende Vereinbarung: die Heizkostenverordnung gilt' },
  { value: 'area', label: 'Vereinbart: nach Wohnfläche' },
  { value: 'fixedPercent', label: 'Vereinbart: feste Anteile' },
  { value: 'consumption', label: 'Vereinbart: nach Verbrauch, abweichend von der Verordnung' },
]
// Wörtlich wie PR 22 es für die monatliche Information braucht: Mitgeteilt ist sie erst, wenn sie den Mieter
// erreicht (BR-Drs. 643/21, S. 18 f.).
export const MONTHLY_ELSEWHERE_LABEL = 'Die Mieter bekommen die monatliche Verbrauchsinformation anders mitgeteilt, etwa vom Messdienst als Brief oder E-Mail oder in einem Portal mit einer Nachricht jeden Monat, dass sie dort steht (§ 6a Abs. 1 HeizkostenV)'

// Woher eine geltende Angabe stammt: aus dieser Heizperiode, aus einer früheren oder gar nicht (Vorgabe).
export function inheritedText(fromPeriod: string | null, period: string): string | null {
  if (fromPeriod === null || fromPeriod === period) return null
  return `Übernommen aus der Heizperiode ${periodText(fromPeriod)}; eine Änderung gilt ab dieser Heizperiode.`
}
const periodText = (p: string): string => (p.slice(5, 7) === '01' ? p.slice(0, 4) : `${p.slice(5, 7)}/${p.slice(0, 4)}`)

// Ob die Karte die Frage nach dem Umfang und der vereinbarten Abrechnung stellt. Ohne Warmwasser der Anlage betrifft
// eine Ausnahme ohnehin die ganze Anlage; dann fragt sie nur nach der vereinbarten Abrechnung (Durchsicht von #243,
// R-K6).
export const asksScope = (r: Pick<HeatingRules, 'exemption'>, centralHotWater = true): boolean => r.exemption !== 'none' && centralHotWater
export const asksBilling = (r: Pick<HeatingRules, 'exemption'>): boolean => r.exemption !== 'none'

// Der Satz unter „Abrechnung vereinbart“, je nach dem, was Mietfuchs rechnet (Durchsicht von #243, R-W8): Nur wenn
// Wärme und Warmwasser ausgenommen sind, entscheidet das Häkchen über die CO₂-Aufteilung.
export function billingText(scope: ExemptionScope | null): string {
  return scope === 'both'
    ? 'Nur dann werden unter einer Ausnahme für Wärme und Warmwasser die CO₂-Kosten nach dem CO2KostAufG aufgeteilt (§ 2 Abs. 7 CO2KostAufG).'
    : 'Ist nur die Wärme ausgenommen, teilt Mietfuchs die CO₂-Kosten ohnehin weiter auf, weil das Warmwasser nach der Verordnung abgerechnet wird (BT-Drs. 20/3172, S. 28; Auslegung von Mietfuchs). Das Häkchen gilt dann erst, wenn Sie auch das Warmwasser ausnehmen.'
}

// Die Rückfrage, bevor eine Angabe an abgeschlossenen Heizperioden vorbei auf eine offene wirkt (Durchsicht von #243,
// G-K1); `null`: keine Rückfrage nötig.
export function laterClosedText(closed: readonly string[]): string | null {
  if (closed.length === 0) return null
  const list = closed.map(periodText)
  const last = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`
  return `Die Angabe gilt ab dieser Heizperiode für die folgenden. ${list.length === 1 ? 'Die Heizperiode' : 'Die Heizperioden'} ${last} ${list.length === 1 ? 'ist' : 'sind'} abgeschlossen und ${list.length === 1 ? 'bleibt' : 'bleiben'}, wie ${list.length === 1 ? 'sie' : 'sie'} abgerechnet ${list.length === 1 ? 'wurde' : 'wurden'}. Die nächste offene Heizperiode übernimmt die Angabe an ${list.length === 1 ? 'ihr' : 'ihnen'} vorbei, und das kann Beträge der Mieter ändern. Soll die Angabe dort nicht gelten, geben Sie sie in der offenen Heizperiode anders an.`
}
