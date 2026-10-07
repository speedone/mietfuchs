// Einrichtung Schritt 7: eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 11.2), ohne DOM prüfbar
// (heatingSelfForm.test.ts). Was der Server prüft, prüft er weiter; hier stehen die Sätze, bevor
// gesendet wird, und die Auswahl, die zum Gespeicherten passt.
import type { AreaBasisHeat, CaptureMethod, HeatingEnergy, HeatingPart, HeatingPlant, HeatingTarget, HotWater, InsulationRule } from './types'
import { hkvConsumptionShare, hkvConsumptionShareForced } from '../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

export type SelfItemRow = { id: string; description: string; amountCents: number; heatingPart: HeatingPart | ''; heatingTarget: HeatingTarget | '' }
export type SelfSetupForm = {
  period: string
  hotWater: HotWater | ''
  capture: CaptureMethod
  share: string
  // Anteil beim Warmwasser, eine eigene Wahl (§ 8 Abs. 1, Abweichung 14)
  waterShare: string
  insulation: InsulationRule | ''
  areaBasisHeat: AreaBasisHeat
  dhwHeatMeter: boolean
  totalHeatMeter: boolean
  items: SelfItemRow[]
}
export type SelfSetupBody = {
  period: string
  heatConsumptionPct: number
  waterConsumptionPct: number | null
  insulationRule: InsulationRule
  hotWater: HotWater
  capture: CaptureMethod
  areaBasisHeat: AreaBasisHeat
  dhwHeatMeter: boolean
  totalHeatMeter: boolean
  items: { id: string; heatingPart: HeatingPart; heatingTarget: HeatingTarget }[]
}

export const HOT_WATER_OPTIONS: { value: HotWater; label: string }[] = [
  { value: 'combined', label: 'Ja, die Heizung bereitet auch das Warmwasser' },
  { value: 'separate', label: 'Nein, das Warmwasser hat eine eigene Anlage, deren Kosten getrennt erfasst sind' },
  { value: 'none', label: 'Es gibt kein zentrales Warmwasser' },
]
export const CAPTURE_SELF_OPTIONS: { value: CaptureMethod; label: string; later: boolean }[] = [
  { value: 'heatMeter', label: 'Wärmezähler und Warmwasserzähler je Wohnung', later: false },
  { value: 'hca', label: 'Heizkostenverteiler an den Heizkörpern (kommt mit einer späteren Version)', later: true },
  { value: 'serviceValues', label: 'Werte eines Ablesedienstes (kommt mit einer späteren Version)', later: true },
]
export const PART_OPTIONS: { value: HeatingPart; label: string }[] = [
  { value: 'fuel', label: 'Brennstoff' },
  { value: 'operating', label: 'Betrieb (Strom, Wartung, Reinigung, Messung der Abgase)' },
  { value: 'metering', label: 'Erfassung (Miete der Zähler, Ablesung)' },
]
const TARGET_LABELS: Record<HeatingTarget, string> = { both: 'Heizung und Warmwasser', heating: 'nur Heizung', water: 'nur Warmwasser' }

// Die Ziele, die zur Warmwasserbereitung passen (dieselbe Regel wie `targetProblem` im Server).
export function targetOptions(hotWater: HotWater | '', part: HeatingPart | ''): { value: HeatingTarget; label: string }[] {
  const values: HeatingTarget[] = hotWater === '' ? []
    : hotWater === 'none' ? ['heating']
    : hotWater === 'separate' ? ['heating', 'water']
      : part === 'fuel' ? ['both'] : ['both', 'heating', 'water']
  return values.map((value) => ({ value, label: TARGET_LABELS[value] }))
}

export const shareBounds = (): { min: number; max: number } => valueAt(hkvConsumptionShare, LAW_AS_OF)
// § 7 Abs. 1 Satz 2 (Abweichung 13: Flüssiggas zählt als Gas).
export function forcedShare(energy: HeatingEnergy, insulation: InsulationRule | ''): number | null {
  return insulation === 'applies' && ['oil', 'gas', 'lpg'].includes(energy) ? valueAt(hkvConsumptionShareForced, LAW_AS_OF) : null
}

export function emptySelfSetup(plant: Pick<HeatingPlant, 'energy' | 'hotWater' | 'capture' | 'areaBasisHeat'>, period: string): SelfSetupForm {
  return {
    period,
    // Heizung PR 11: Verbundenes Warmwasser geht bei jeder Energie; bei Brennstoff in Litern, Kilogramm oder
    // Kubikmetern rechnet Mietfuchs mit dem Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV).
    hotWater: plant.hotWater ?? 'combined',
    capture: plant.capture ?? 'heatMeter',
    share: '',
    waterShare: '',
    insulation: '',
    areaBasisHeat: plant.areaBasisHeat ?? 'area',
    dhwHeatMeter: true,
    totalHeatMeter: plant.energy === 'heatPump' || plant.energy === 'districtHeating',
    items: [],
  }
}

// Die Liste aus der Antwort 409 (`{ error, items }`), oder null, wenn die Antwort keine hat.
export function itemsFromConflict(data: Record<string, unknown>): SelfItemRow[] | null {
  if (!Array.isArray(data.items)) return null
  return data.items.flatMap((x: unknown): SelfItemRow[] => {
    if (x === null || typeof x !== 'object') return []
    const r = x as Record<string, unknown>
    if (typeof r.id !== 'string') return []
    const part = r.heatingPart === 'fuel' || r.heatingPart === 'operating' || r.heatingPart === 'metering' ? r.heatingPart : ''
    return [{ id: r.id, description: typeof r.description === 'string' ? r.description : r.id, amountCents: typeof r.amountCents === 'number' ? r.amountCents : 0, heatingPart: part, heatingTarget: '' }]
  })
}

export function selfSetupBody(form: SelfSetupForm, energy: HeatingEnergy): { body: SelfSetupBody } | { error: string } {
  const { min, max } = shareBounds()
  if (CAPTURE_SELF_OPTIONS.find((o) => o.value === form.capture)?.later) {
    return { error: 'Heizkostenverteiler und Werte eines Ablesedienstes kommen mit einer späteren Version. Bis dahin rechnet Mietfuchs mit Wärmezählern und Warmwasserzählern.' }
  }
  if (form.hotWater === '') return { error: 'Bitte beantworten Sie, ob die Heizung auch das Warmwasser bereitet.' }
  // Die Frage zum Wärmeschutz nur bei Öl- oder Gasheizung (Durchsicht von #239, M1); sonst gilt § 7 Abs. 1 Satz 2 nicht.
  const asked = ['oil', 'gas', 'lpg'].includes(energy)
  if (asked && form.insulation === '') return { error: 'Bitte beantworten Sie die Frage zum Wärmeschutz; „Weiß ich nicht“ ist eine Antwort.' }
  const insulationRule: InsulationRule = asked && form.insulation !== '' ? form.insulation : 'notApplies'
  // Vorgeschrieben (§ 7 Abs. 1 Satz 2): das Feld zeigt den Pflichtanteil und ist gesperrt; gesendet
  // wird, was angezeigt ist.
  const forced = forcedShare(energy, form.insulation)
  // Höchstens zwei Nachkommastellen (Durchsicht von #239, M9); anderes gilt als nicht angegeben.
  const percent = (text: string): number | null => {
    const t = text.trim().replace(',', '.')
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null
  }
  const share = forced ?? percent(form.share)
  if (share === null || !Number.isFinite(share)) return { error: `Bitte geben Sie den Anteil nach Verbrauch an, zwischen ${min} und ${max} %, mit höchstens zwei Nachkommastellen.` }
  // § 8 Abs. 1: beim Warmwasser eine eigene Wahl; ohne zentrales Warmwasser keine (Abweichung 14).
  const water = form.hotWater === 'none' ? null : percent(form.waterShare)
  if (form.hotWater !== 'none' && (water === null || !Number.isFinite(water))) {
    return { error: `Bitte geben Sie auch den Anteil nach Verbrauch beim Warmwasser an, zwischen ${min} und ${max} % (§ 8 Abs. 1 HeizkostenV); er darf von dem der Heizung abweichen.` }
  }
  for (const v of water === null ? [share] : [share, water]) {
    if (v < min) return { error: `Die Heizkostenverordnung verlangt mindestens ${min} % nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1).` }
    if (v > max) return { error: `Mehr als ${max} % nach Verbrauch gehen nur mit einer Vereinbarung (§ 10 HeizkostenV); das kommt mit einer späteren Version.` }
  }
  const items: SelfSetupBody['items'] = []
  for (const row of form.items) {
    if (row.heatingPart === '') return { error: `„${row.description}“: Bitte wählen Sie den Teil (Brennstoff, Betrieb oder Erfassung).` }
    if (row.heatingTarget === '' || !targetOptions(form.hotWater, row.heatingPart).some((o) => o.value === row.heatingTarget)) {
      return { error: `„${row.description}“: Bitte wählen Sie das Ziel (Heizung und Warmwasser, nur Heizung oder nur Warmwasser).` }
    }
    items.push({ id: row.id, heatingPart: row.heatingPart, heatingTarget: row.heatingTarget })
  }
  return {
    body: {
      period: form.period, heatConsumptionPct: share, waterConsumptionPct: water, insulationRule, hotWater: form.hotWater, capture: form.capture,
      areaBasisHeat: form.areaBasisHeat, dhwHeatMeter: form.hotWater === 'combined' && form.dhwHeatMeter, totalHeatMeter: form.totalHeatMeter, items,
    },
  }
}
