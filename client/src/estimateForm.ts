// Dialog der Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 8.7, N5), ohne DOM prüfbar. Was der
// Server prüft, prüft er weiter; hier stehen die Sätze vorher und der Flächenanteil, der über die Grenze
// des § 9a Abs. 2 entscheidet.
import type { EstimateMethod, EstimatePart, SelfEstimateOption, SelfEstimateView, SelfPotView } from './types'
import { ambiguousText, ambiguousThousands, parseNumberDe } from './numbers'

export const METHOD_OPTIONS: { value: EstimateMethod; label: string }[] = [
  { value: 'buildingAverage', label: 'Durchschnittsverbrauch des Gebäudes je m² (Vorgabe)' },
  { value: 'previousPeriod', label: 'Verbrauch derselben Wohnung in der vorigen Heizperiode' },
  { value: 'comparableUnit', label: 'Verbrauch einer vergleichbaren Wohnung in dieser Heizperiode, je m² umgerechnet' },
]
export const WHY_TEXT: Record<NonNullable<SelfEstimateOption['why']>, string> = {
  noReading: 'Stand fehlt',
  replacement: 'Endstand des alten Geräts beim Zählerwechsel fehlt',
  negative: 'Zähler zeigt weniger als vorher',
  noValues: 'Werte des Ablesedienstes fehlen',
}
// Warum ein Weg keinen Vorschlag hat (der Vermieter trägt den Wert dann selbst ein).
export const NO_PROPOSAL_TEXT: Record<Exclude<SelfEstimateOption['proposals'][number]['why'], 'ok'>, string> = {
  noPrevious: 'Für die vorige Heizperiode gibt es keinen vollständig abgelesenen Verbrauch dieser Wohnung.',
  lengthDiffers: 'Die vorige Heizperiode ist anders lang; einen umgerechneten Wert schlägt Mietfuchs nicht vor.',
  noMeasured: 'Keine andere Wohnung hat in dieser Heizperiode einen vollständig abgelesenen Verbrauch.',
}

export type EstimateForm = { method: EstimateMethod; comparableUnitId: string; value: string; reason: string; confirmed: boolean }

// Eine Zahl in deutscher („12.000“, „12.000,5“) oder technischer Schreibweise („12000.5“), wie überall
// (`parseNumberDe`). Ein Punkt vor genau drei Ziffern ist ein Tausenderpunkt.
export const parseAmount = (text: string): number | null => parseNumberDe(text)

export function proposalValue(option: SelfEstimateOption, method: EstimateMethod, comparableUnitId: string): number | null {
  if (method === 'comparableUnit') return option.comparable.find((c) => c.unitId === comparableUnitId)?.value ?? null
  return option.proposals.find((p) => p.method === method)?.value ?? null
}

// Auf drei Nachkommastellen, in deutscher Schreibweise ohne Tausenderpunkt, damit das Feld wieder gelesen
// wird, wie es dasteht.
const round = (n: number): string => String(Math.round(n * 1000) / 1000).replace('.', ',')

export function emptyEstimate(option: SelfEstimateOption, existing?: Pick<SelfEstimateView, 'value' | 'method' | 'reason' | 'confirmed'>): EstimateForm {
  if (existing) return { method: existing.method, comparableUnitId: '', value: round(existing.value), reason: existing.reason, confirmed: existing.confirmed }
  const v = proposalValue(option, 'buildingAverage', '')
  return { method: 'buildingAverage', comparableUnitId: '', value: v === null ? '' : round(v), reason: '', confirmed: false }
}

// Den Vorschlag des gewählten Wegs übernehmen; ohne Vorschlag bleibt der eingetragene Wert stehen.
export function chooseMethod(form: EstimateForm, option: SelfEstimateOption, method: EstimateMethod, comparableUnitId: string): EstimateForm {
  const v = proposalValue(option, method, comparableUnitId)
  return { ...form, method, comparableUnitId, value: v === null ? form.value : round(v) }
}

const pct = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const m2 = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// Der tatsächliche Flächenanteil mit dieser Schätzung und was daraus folgt (§ 9a Abs. 2, „überschreitet“:
// streng größer, verglichen über Produkte wie in der Berechnung). Der letzte Satz stimmt bei gleich und
// verschieden großen Wohnungen (Abweichung 9 des Plans).
export function thresholdLines(pot: Pick<SelfPotView, 'pot' | 'areaM2' | 'estimatedAreaM2'>, option: Pick<SelfEstimateOption, 'areaM2' | 'estimated'>, threshold: number): string[] {
  const estimated = (pot.estimatedAreaM2 ?? 0) + (option.estimated ? 0 : option.areaM2)
  const share = pot.areaM2 > 0 ? (estimated * 100) / pot.areaM2 : 0
  const verdict = estimated * 100 > pot.areaM2 * threshold
    ? `Das überschreitet ${threshold} %: Die Kosten ${pot.pot === 'heating' ? 'der Heizung' : 'des Warmwassers'} werden dann ausschließlich nach Fläche verteilt (§ 9a Abs. 2 HeizkostenV).`
    : estimated * 100 === pot.areaM2 * threshold
      ? `Das sind genau ${threshold} %, also keine Überschreitung; die Kosten werden weiter nach Verbrauch verteilt.`
      : `Das liegt unter ${threshold} %; die Kosten werden weiter nach Verbrauch verteilt.`
  return [
    `Maßgeblich ist die Fläche der Wohnungen mit geschätztem Verbrauch, nicht ihre Zahl: mit dieser Schätzung ${m2(estimated)} von ${m2(pot.areaM2)} m², also ${pct(share)} %.`,
    verdict,
    `Bei vier gleich großen Wohnungen hat jede genau ${threshold} % und überschreitet die Grenze nicht. Eine Wohnung mit mehr als ${threshold} % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen.`,
  ]
}

// Der Rumpf für den Server. Beim Warmwasser (m³) fragt das Formular bei „12.345“ nach, statt zu raten: Dort
// kommen drei Nachkommastellen ebenso vor wie Tausender. Kilowattstunden und Einheiten liest es mit
// Tausenderpunkt.
export function estimateBody(form: EstimateForm, part: EstimatePart): { body: { value: number; method: EstimateMethod; reason: string; confirmed: boolean } } | { error: string } {
  if (part === 'water' && ambiguousThousands(form.value)) return { error: ambiguousText(form.value) }
  const value = parseAmount(form.value)
  if (value === null || value < 0) return { error: 'Der geschätzte Verbrauch ist eine Zahl ab 0.' }
  const reason = form.reason.trim()
  if (reason === '') return { error: 'Bitte nennen Sie die Begründung, warum der Verbrauch nicht erfasst werden konnte (etwa „Wärmezähler defekt“).' }
  return { body: { value, method: form.method, reason, confirmed: form.confirmed } }
}
