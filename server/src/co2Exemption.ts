// Die Ausnahme nach § 11 HeizkostenV und das CO2KostAufG (§ 2 Abs. 7), als eine Regel für Abrechnung und
// Blatt für den Messdienst (Durchsicht von #246, „eine Quelle je Entscheidung“). Die Abrechnung ruft sie je
// Heizperiode auf (calc.ts, `co2OffByExemption`, `exemptionText`); das Blatt liest das Ergebnis der Abrechnung
// (`heating[].co2Check`) und fragt dieselbe Regel nur, wenn die Heizperiode in keiner Abrechnung steht.
import type { HeatingExemption, HeatingRules, HeatingSupply, HotWater, SelfSpanRange } from '../../shared/types.ts'
import { hotWaterOf } from '../../shared/heatingPeriod.ts'
import { hkvExemptions, hkvRenewableExemption } from '../../shared/law/heizkostenv.ts'
import { law, type LawLog, type Period } from '../../shared/law/register.ts'

type RulePlant = { supply?: HeatingSupply | null; hotWater?: HotWater | null; selfSpans?: readonly SelfSpanRange[] }

const fmtDay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

// Wie weit die Ausnahme reicht: Bereitet die Anlage in der Heizperiode kein Warmwasser, betrifft eine Ausnahme der
// Wärme die ganze Anlage. Für eine Etagenheizung gilt die Verordnung ohnehin nicht (§ 1 Abs. 1): keine Ausnahme.
export function exemptionScopeFor(plant: RulePlant | null | undefined, rules: HeatingRules, key: string): HeatingRules['exemptionScope'] {
  if (!plant || (plant.supply ?? 'central') !== 'central') return null
  const s = rules.exemptionScope
  return s === 'heat' && hotWaterOf(plant, key) === 'none' ? 'both' : s
}

// § 2 Abs. 7 CO2KostAufG: in den Fällen des § 11 keine CO₂-Aufteilung, außer eine Abrechnung der Heiz- und
// Warmwasserkosten ist vereinbart. Ist nur die Wärme ausgenommen, wird weiter aufgeteilt, denn das Warmwasser
// bleibt unter der Verordnung und das Gesetz unterscheidet den Fall nicht (Auslegung zur sicheren Seite: Ohne
// Aufteilung dürften die Mieter sonst kürzen).
export function co2OffByExemptionOf(plant: RulePlant | null | undefined, rules: HeatingRules, key: string): boolean {
  return exemptionScopeFor(plant, rules, key) === 'both' && !rules.exemptionBillingAgreed
}

// Der Wortlaut einer Ausnahme nach § 11 Abs. 1, mit den Werten des Registers für den Zeitraum.
export function exemptionText(e: HeatingExemption, period: Period, log: LawLog): string {
  const v = law(hkvExemptions, { period }, log)
  switch (e) {
    case 'lowDemand': return `Räume in einem Gebäude mit einem Heizwärmebedarf von weniger als ${v.lowDemandKwhPerM2Year} kWh je m² und Jahr (§ 11 Abs. 1 Nr. 1 Buchst. a HeizkostenV)`
    // Durchsicht von #243, R-K1: der ganze Wortlaut des Buchst. b.
    case 'disproportionate': return `Räume, bei denen das Anbringen der Ausstattung zur Verbrauchserfassung, die Erfassung des Wärmeverbrauchs oder die Verteilung der Kosten des Wärmeverbrauchs nicht oder nur mit unverhältnismäßig hohen Kosten möglich ist; unverhältnismäßig hoch sind Kosten, die nicht durch die Einsparungen erwirtschaftet werden können, die in der Regel innerhalb von ${v.paybackYears} Jahren erzielt werden können (§ 11 Abs. 1 Nr. 1 Buchst. b HeizkostenV)`
    case 'pre1981': return `Räume, die vor dem ${fmtDay(v.readyBefore)} bezugsfertig geworden sind und in denen der Nutzer den Wärmeverbrauch nicht beeinflussen kann (§ 11 Abs. 1 Nr. 1 Buchst. c HeizkostenV)`
    // Durchsicht von #243, R-W7: Die Bedingung „sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird“ gehört
    // nur zu Buchst. b. Zwei Fassungen des Buchst. a: für Zeiträume, die vor dem 01.10.2024 beginnen, mit Wärmepumpen.
    case 'renewable': return `Räume in einem Gebäude, das überwiegend mit Wärme aus ${hkvRenewableExemption.describe(law(hkvRenewableExemption, { period }, log))} versorgt wird`
    case 'chp': return 'Räume in einem Gebäude, das überwiegend mit Wärme aus Anlagen der Kraft-Wärme-Kopplung oder aus Anlagen zur Verwertung von Abwärme versorgt wird, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird (§ 11 Abs. 1 Nr. 3 Buchst. b HeizkostenV)'
    case 'authority': return 'eine Befreiung durch die nach Landesrecht zuständige Stelle wegen besonderer Umstände, um einen unangemessenen Aufwand oder sonstige unbillige Härten zu vermeiden (§ 11 Abs. 1 Nr. 5 HeizkostenV)'
    case 'none': return ''
  }
}

// Die Ausnahme, unter der das CO2KostAufG nicht gilt, im Wortlaut; `null`, wenn es gilt.
export function co2ExemptionOf(plant: RulePlant | null | undefined, rules: HeatingRules, key: string, period: Period, log: LawLog): string | null {
  if (!co2OffByExemptionOf(plant, rules, key) || rules.exemption === 'none') return null
  return exemptionText(rules.exemption, period, log)
}
