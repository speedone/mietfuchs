// Die eigene Heizkostenabrechnung auf der Seite Heizkosten und im Druck (Heizung PR 10, Entwurf 3.5,
// 8.8), ohne DOM prüfbar (heatingSelfView.test.ts). Die Zahlen rechnet der Server; hier stehen nur
// Sätze und die Ampel.
import type { HeatingDistribution, HeatingEnergy, InsulationRule, SelfBoundaryView, SelfEstimateView, SelfHeatingStatement, SelfPotView, SelfUnitView, SelfUserView } from './types'
import { fmtDate, fmtEuro } from './api'
import { CAUSE_TEXT } from './estimateForm'
import { hkvConsumptionShareForced, hkvCutNotByConsumption } from '../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

// ---------- Wärmeschutz und Pflichtanteil (Durchsicht von #239, C1 und M1) ----------

// § 7 Abs. 1 Satz 2 HeizkostenV gilt nur bei Öl- oder Gasheizung (Flüssiggas zählt als Gas); sonst
// fragt Mietfuchs nicht.
export const insulationAsked = (energy: HeatingEnergy): boolean => ['oil', 'gas', 'lpg'].includes(energy)
export const INSULATION_QUESTION = 'Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994, und sind die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt?'
export const INSULATION_OPTIONS: { value: InsulationRule; label: string }[] = [
  { value: 'applies', label: 'Ja, beides' },
  { value: 'notApplies', label: 'Nein' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]
const forcedValue = (): number => valueAt(hkvConsumptionShareForced, LAW_AS_OF)
export const insulationExplained = (): string =>
  `Trifft beides zu, sind von den Heizkosten ${forcedValue()} % nach Verbrauch zu verteilen (§ 7 Abs. 1 Satz 2 HeizkostenV); mehr nur mit einer Vereinbarung (§ 10 HeizkostenV).`
// „Weiß ich nicht“ und weniger als der Pflichtanteil: der Rat aus der Durchsicht.
export function unsureShareHint(energy: HeatingEnergy, insulation: InsulationRule | '' | null, share: number | null): string | null {
  const forced = forcedValue()
  if (!insulationAsked(energy) || insulation !== 'unknown' || share === null || share >= forced) return null
  return `Mit ${forced} % liegen Sie in jedem Fall richtig; trifft § 7 Abs. 1 Satz 2 HeizkostenV zu, sind weniger nicht zulässig.`
}

// ---------- Fehlende Zwischenablesung (Durchsicht von #239, I3) ----------

// Was jede Antwort bewirkt, bevor der Vermieter sie gibt.
export function gapConsequence(status: 'impossible' | 'missed'): string {
  return status === 'impossible'
    ? 'Nicht möglich: Die Kosten der Wohnung werden nach Gradtagen und Tagen auf die Mieter geteilt (§ 9b Abs. 3 HeizkostenV). Nennen Sie den Grund; er steht in der Abrechnung.'
    : `Nicht durchgeführt: Mietfuchs teilt die Kosten der Wohnung ebenso nach § 9b Abs. 3 HeizkostenV, denn eine andere Rechnung gibt es nicht; die Zwischenablesung war Pflicht (§ 9b Abs. 1). Nach einer Auslegung (LG Hamburg, 11 S 202/87) dürfen die Mieter ihren Anteil an diesen Kosten um bis zu ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen. Die Abrechnung nennt die Beträge.`
}

// Prozent mit höchstens zwei Nachkommastellen (M9); sonst null.
export function percentOf(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

export type Light = 'green' | 'yellow' | 'red'

// Rot ist, was die Abrechnung nach § 9b Abs. 3 rechnen lässt und eine Kürzung erlaubt; gelb, was
// zulässig ist, aber hingesehen werden sollte (daneben abgelesen, Zwischenablesung nicht möglich).
export function boundaryLight(b: SelfBoundaryView): Light {
  if (b.status === 'read') return 'green'
  // Ab der Warngrenze neben dem Wechsel wählt der Vermieter; bis dahin wird nicht verteilt (Abweichung 22).
  if (b.status === 'off') return b.far && b.kind === 'change' && b.gap !== 'useReading' && b.gap !== 'imprecise' ? 'red' : 'yellow'
  return b.gap === 'impossible' ? 'yellow' : 'red'
}

const KIND_TEXT: Record<SelfBoundaryView['kind'], string> = { start: 'Beginn der Heizperiode am', end: 'Ende der Heizperiode am', change: 'Mieterwechsel zum' }
export function boundaryText(b: SelfBoundaryView, unitName: string): string {
  const head = `${unitName}, ${KIND_TEXT[b.kind]} ${fmtDate(b.date)}`
  if (b.status === 'read') return `${head}: abgelesen`
  if (b.status === 'off') {
    const choice = b.far && b.kind === 'change'
      ? (b.gap === 'imprecise' ? ' (geteilt nach § 9b Abs. 3)' : b.gap === 'useReading' ? ' (Ablesung verwendet)' : '; bitte wählen')
      : ''
    return `${head}: abgelesen ${b.offDays} ${b.offDays === 1 ? 'Tag' : 'Tage'} daneben${b.far ? ', über einen Wintermonat' : ''}${choice}`
  }
  const answer = b.gap === 'impossible' ? ` (nicht möglich${b.gapReason ? `: ${b.gapReason}` : ''})` : b.gap === 'missed' ? ' (nicht durchgeführt)' : ''
  return `${head}: keine Ablesung${answer}`
}

// § 6 Abs. 4: nach Beginn der Heizperiode gilt der Anteil; vorher und beim ersten Mal ist er frei.
export const shareEditable = (d: HeatingDistribution): boolean => d.first || !d.begun

export function distributionLines(d: HeatingDistribution): string[] {
  if (!d.effective) return ['Noch kein Anteil nach Verbrauch festgelegt.']
  const water = d.effective.water === null ? '' : `, Warmwasser ${d.effective.water} %`
  const lines = [`Heizung ${d.effective.heating} %${water} nach Verbrauch${d.inherited ? ', übernommen aus der vorigen Heizperiode' : ''}`]
  if (d.forcedPercent !== null) lines.push(`Vorgeschrieben: ${d.forcedPercent} % bei den Heizkosten (§ 7 Abs. 1 Satz 2 HeizkostenV).`)
  if (!shareEditable(d)) lines.push('Die Heizperiode hat begonnen; einen anderen Anteil tragen Sie für die nächste ein (§ 6 Abs. 4 HeizkostenV).')
  return lines
}

const POT_LABEL = { heating: 'Heizung', water: 'Warmwasser' } as const
const num = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const perUnit = (cents: number, digits: number) => `${num(cents / 100, digits)}\u00a0€`

export function potLines(p: SelfPotView): string[] {
  const base = p.costCents * (1 - p.consumptionPct / 100)
  const lines = [`${POT_LABEL[p.pot]}: ${fmtEuro(p.costCents)}`]
  lines.push(`Grundkosten ${num(100 - p.consumptionPct)} %: ${fmtEuro(Math.round(base))} für ${num(p.areaM2)} m², ${perUnit(p.baseCentsPerM2, 4)} je m²`)
  // § 9a Abs. 2 (Heizung PR 13): über der Grenze nur nach Fläche.
  if (p.overThreshold) lines.push(`Geschätzt ist der Verbrauch für ${num(p.estimatedAreaM2 ?? 0)} von ${num(p.areaM2)} m²; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach Fläche verteilt.`)
  else if (p.byAreaOnly) lines.push('Kein Verbrauch erfasst: nur nach Fläche verteilt.')
  else if (p.consumptionCentsPerUnit !== null) {
    // „je Einheit“, nicht „je Einheiten“ (Durchsicht von #241, Minor 2).
    // Durchsicht von #242, R-M9: der geschätzte Teil, ohne eine Wohnung zu nennen.
    const estimated = (p.estimatedConsumption ?? 0) > 0 ? ` (davon geschätzt nach § 9a HeizkostenV: ${num(p.estimatedConsumption ?? 0)} ${p.consumptionUnit})` : ''
    lines.push(`Verbrauchskosten ${num(p.consumptionPct)} %: ${fmtEuro(Math.round(p.costCents - base))} für ${num(p.consumption)} ${p.consumptionUnit}${estimated}, ${perUnit(p.consumptionCentsPerUnit, 6)} je ${p.consumptionUnit === 'Einheiten' ? 'Einheit' : p.consumptionUnit}`)
  }
  return lines
}

// Heizkostenverteiler und Ablesedienst zählen Einheiten, keine Kilowattstunden (Heizung PR 12, Abweichung 9).
export const heatUnitOf = (self: Pick<SelfHeatingStatement, 'pots'>): 'kWh' | 'Einheiten' =>
  self.pots.find((p) => p.pot === 'heating')?.consumptionUnit === 'Einheiten' ? 'Einheiten' : 'kWh'

export function userLine(u: SelfUserView, self: Pick<SelfHeatingStatement, 'pots'>): string {
  const heatUnit = heatUnitOf(self)
  const time = `${fmtDate(u.from)} bis ${fmtDate(u.to)} (${u.days} Tage, ${num(u.degreeDayPermille)} ‰ der Gradtage)`
  // Der Topfbetrag je Mieter, mit Abzug auch nach CO₂-Abzug: die Grundlage einer Kürzung (Abweichung 15).
  const net = (cents: number, co2: number) => `${fmtEuro(cents)}${co2 > 0 ? `, nach CO₂-Abzug ${fmtEuro(cents - co2)}` : ''}`
  // Heizung PR 13: eine Schätzung nach § 9a und die Gruppe nach § 9b Abs. 3 in einer Klammer.
  // Durchsicht von #242, R-M8: Über der Grenze des § 9a Abs. 2 zählt der Verbrauch für die Kosten nicht.
  const over = (pot: 'heating' | 'water') => self.pots.find((p) => p.pot === pot)?.overThreshold === true
  const note = (estimated: boolean | undefined, group: boolean, notUsed: boolean) => {
    const parts = [...(estimated ? [`geschätzt nach § 9a${group ? ', gemeinsam nach § 9b Abs. 3' : ''}`] : group ? ['gemeinsam nach § 9b Abs. 3'] : []), ...(notUsed ? ['für die Verteilung nicht maßgeblich, § 9a Abs. 2'] : [])]
    return parts.length > 0 ? ` (${parts.join('; ')})` : ''
  }
  const parts = [`Heizung ${u.heatingConsumption === null ? 'nicht erfasst' : `${num(u.heatingConsumption)} ${heatUnit}${note(u.heatingEstimated, u.heatingGroup, over('heating'))}`}, ${net(u.heatingCents, u.heatingCo2Cents)}`]
  if (self.pots.some((p) => p.pot === 'water')) {
    parts.push(`Warmwasser ${u.waterConsumption === null ? 'nicht erfasst' : `${num(u.waterConsumption)} m³${note(u.waterEstimated, u.waterGroup, over('water'))}`}, ${net(u.waterCents, u.waterCo2Cents)}`)
  }
  return `${u.label}, ${time}: ${parts.join('; ')}`
}

// Die Schätzung nach § 9a im Druck (Heizung PR 13, Entwurf 8.8 „Schätzungen mit Methode“): nur die der Wohnung
// des Mieters, und nur, wenn sein Verbrauch daraus kommt; wie bei den Geräten sieht ein Mieter nichts aus
// anderen Wohnungen (Durchsicht von #241, Recht-I1). Die geschätzte Fläche des Hauses nennt `potLines`.
const METHOD_TEXT: Record<SelfEstimateView['method'], string> = {
  previousPeriod: 'dem Verbrauch der Wohnung in einem vergleichbaren Zeitraum',
  comparableUnit: 'dem Verbrauch einer vergleichbaren Wohnung in diesem Zeitraum',
  buildingAverage: 'dem Durchschnitt des Gebäudes je m²',
}
const permille = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
// Durchsicht von #242: R-I1 (Wortlaut des § 9a Abs. 1 Satz 1, Grund aus der Auswahl), R-M5 (Begründung in
// Anführungszeichen), R-I2 (der Anteil des Nachmieters nachrechenbar, ohne Daten des Vormieters), G-M6 (die ganze
// Heizperiode), R-M8 (über der Grenze für die Verteilung nicht maßgeblich).
export function estimateLines(
  self: Pick<SelfHeatingStatement, 'estimates' | 'pots'> & Partial<Pick<SelfHeatingStatement, 'changeSplit'>>,
  unitId: string | undefined,
  u: Pick<SelfUserView, 'heatingEstimated' | 'waterEstimated'> & Partial<Pick<SelfUserView, 'heatingConsumption' | 'waterConsumption'>>,
): string[] {
  return (self.estimates ?? []).filter((e) => !e.stale && e.unitId === unitId && (e.part === 'heat' ? u.heatingEstimated : u.waterEstimated)).map((e) => {
    const unit = e.part === 'heat' ? heatUnitOf(self) : 'm³'
    const pot = self.pots.find((p) => p.pot === (e.part === 'heat' ? 'heating' : 'water'))
    const mine = e.part === 'heat' ? u.heatingConsumption : u.waterConsumption
    const what = `${CAUSE_TEXT[e.cause] ?? 'nicht ordnungsgemäß erfasst'}; Begründung: „${e.reason}“`
    const timeWord = e.part === 'heat' && self.changeSplit !== 'time' ? 'der Gradtage' : 'der Tage'
    const share = mine !== null && mine !== undefined && e.value > 0 ? (mine * 1000) / e.value : null
    const shareText = share !== null ? ` Auf Ihren Zeitraum entfallen ${permille(share)} ‰ ${timeWord}, also ${permille(share)} ‰ von ${num(e.value)} ${unit} = ${num(mine ?? 0)} ${unit}.` : ''
    const split = e.kept > 0
      ? ` Für die Zeit vor Ihrem Einzug liegt eine gültige Ablesung vor; sie gilt dort weiter.${shareText}`
      : e.users > 1
        ? ` Er ist auf die Nutzer der Wohnung geteilt wie nach § 9b Abs. 3 HeizkostenV.${shareText}`
        : e.complete ? '' : ' Sie gilt auch für Zeiten, für die Ablesungen vorliegen.'
    const notUsed = pot?.overThreshold ? ' Für die Verteilung ist der Verbrauch nicht maßgeblich: Die geschätzte Fläche des Hauses überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, verteilt wird nur nach Fläche.' : ''
    return `${e.part === 'heat' ? 'Heizung' : 'Warmwasser'}: Der Verbrauch Ihrer Wohnung konnte nicht ordnungsgemäß erfasst werden (${what}) und ist nach § 9a HeizkostenV ermittelt, nach ${METHOD_TEXT[e.method]}: ${num(e.value)} ${unit} für die ganze Heizperiode der Wohnung.${split}${notUsed}`
  })
}

// Das Ableseergebnis geht an jeden Mieter für seine Wohnung (Durchsicht von #239, I2); gedruckt wird eine
// Wohnung. Einer gesonderten Mitteilung des Warmwasserverbrauchs bedarf es nicht, wenn in der Wohnung ein
// Warmwasserzähler eingebaut ist (§ 6 Abs. 1 Satz 4 HeizkostenV).
export const READING_RESULT_HINT = 'Bei Zählern, die nicht aus der Ferne ablesbar sind, teilen Sie jedem Mieter das Ergebnis der Ablesung seiner Wohnung in der Regel innerhalb eines Monats mit (§ 6 Abs. 1 Satz 2 HeizkostenV). Wählen Sie die Wohnung und drucken Sie ihr Ergebnis. Nicht nötig ist das, wenn das Ergebnis über einen längeren Zeitraum im Gerät in der Wohnung gespeichert ist und der Mieter es selbst abrufen kann, etwa am Stichtagsspeicher eines elektronischen Heizkostenverteilers (§ 6 Abs. 1 Satz 3). Den Warmwasserverbrauch müssen Sie nicht gesondert mitteilen, wenn in der Wohnung ein Warmwasserzähler eingebaut ist (§ 6 Abs. 1 Satz 4).'

// Das Ableseergebnis einer Wohnung zu einer Grenze (§ 6 Abs. 1 Satz 2 HeizkostenV).
export function readingResult(unit: SelfUnitView, boundary: string, heatUnit: 'kWh' | 'Einheiten' = 'kWh'): string[] {
  return unit.readings.filter((r) => r.boundary === boundary).map((r) => (r.date === null || r.value === null
    ? `${r.meterName}: nicht abgelesen`
    : r.oldEndValue !== undefined
      // Durchsicht von #241, Recht-I2: Am Stichtag zeigt das Gerät danach 0; mitgeteilt wird der Stichtagswert.
      ? (r.pot === 'heating' && heatUnit === 'Einheiten' && r.value === 0
        ? `${r.meterName}: Stichtagswert ${num(r.oldEndValue)} Einheiten am ${fmtDate(r.date)} (Gerät danach auf 0)`
        : `${r.meterName}: ${num(r.oldEndValue)} ${r.pot === 'heating' ? heatUnit : 'm³'} am ${fmtDate(r.date)} (Endstand des alten Zählers; der neue beginnt mit ${num(r.value)})`)
      : `${r.meterName}: ${num(r.value)} ${r.pot === 'heating' ? heatUnit : 'm³'} am ${fmtDate(r.date)}`))
}
