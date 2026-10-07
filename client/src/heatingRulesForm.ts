// Ausnahme nach § 11, Vereinbarung nach § 2, monatliche Information und Verbrauchervertrag je Heizperiode
// (Heizung PR 14, Entwurf 8.8, 8.9), ohne DOM prüfbar. Die Zahlen des § 11 kommen aus dem Register.
import type { AgreedOtherwise, ExemptionScope, HeatingExemption, HeatingRules } from './types'
import { hkvExemptions, hkvRenewableExemption } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

const EX = valueAt(hkvExemptions, LAW_AS_OF)
// Bis wann Nr. 3 a auch Wärmepumpen nannte (Fassung bis 30.09.2024).
const HEAT_PUMP_UNTIL = hkvRenewableExemption.versions.find((v) => v.value.heatPump)?.validTo
export const EXEMPTION_OPTIONS: { value: HeatingExemption; label: string }[] = [
  { value: 'none', label: 'Keine Ausnahme: die Heizkostenverordnung gilt' },
  { value: 'lowDemand', label: `Gebäude mit einem Heizwärmebedarf von weniger als ${EX.lowDemandKwhPerM2Year} kWh je m² und Jahr (§ 11 Abs. 1 Nr. 1 a)` },
  { value: 'disproportionate', label: `Erfassung nur mit Kosten möglich, die sich nicht in der Regel innerhalb von ${EX.paybackYears} Jahren durch Einsparungen erwirtschaften lassen (§ 11 Abs. 1 Nr. 1 b)` },
  { value: 'pre1981', label: `Räume, die vor dem ${germanDate(EX.readyBefore)} bezugsfertig wurden und in denen der Mieter den Verbrauch nicht beeinflussen kann (§ 11 Abs. 1 Nr. 1 c)` },
  { value: 'renewable', label: `Überwiegend Wärme aus Wärmerückgewinnung oder Solaranlagen${HEAT_PUMP_UNTIL ? ` (bis ${germanDate(HEAT_PUMP_UNTIL)} auch Wärmepumpen)` : ''}, oder aus Kraft-Wärme-Kopplung oder Abwärme, und der Verbrauch des Gebäudes wird nicht erfasst (§ 11 Abs. 1 Nr. 3)` },
  { value: 'authority', label: 'Befreiung durch die zuständige Stelle des Landes (§ 11 Abs. 1 Nr. 5)' },
]
export const EXEMPTION_SCOPE_OPTIONS: { value: ExemptionScope; label: string }[] = [
  { value: 'heat', label: 'Nein, nur die Wärme; das Warmwasser rechnet Mietfuchs weiter nach der Verordnung ab' },
  { value: 'both', label: 'Ja, Wärme und Warmwasser (§ 11 Abs. 2 HeizkostenV)' },
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
  const year = fromPeriod.slice(0, 4)
  const month = fromPeriod.slice(5, 7)
  return `Übernommen aus der Heizperiode ${month === '01' ? year : `${month}/${year}`}; eine Änderung gilt ab dieser Heizperiode.`
}

// Ob die Karte die Frage nach dem Umfang und der vereinbarten Abrechnung stellt.
export const asksScope = (r: Pick<HeatingRules, 'exemption'>): boolean => r.exemption !== 'none'
