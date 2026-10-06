// Der Warmwasseranteil α nach § 9 HeizkostenV (Heizung PR 11, Entwurf 8.3, #211), als reine Funktionen.
//
// α ist der Anteil der Wärme für das Warmwasser an der Energie, die die Anlage in der Heizperiode
// verbraucht hat. Die Wärme Q wird gemessen (§ 9 Abs. 2 Satz 1) oder, nur bei unzumutbar hohem Aufwand,
// nach einer der beiden Zahlenwertgleichungen bestimmt (Satz 2 und 4). Die Faktoren des Satzes 6 gelten
// **nur für die Formelwerte** (Entwurf G-B1 abgelehnt, 15.1 Nr. 9). Wogegen Q gestellt wird, hängt am
// Erzeuger: bei Heizkesseln der Brennstoff (in kWh laut Rechnung oder als Menge mit B = Q / Hᵢ nach
// Abs. 3), bei Fernwärme die gelieferte Wärme, bei der Wärmepumpe mit Formel der Strom (der Faktor 0,30
// rechnet auf den Strom um, Entwurf 8.3, F1), bei der Stromheizung gemessen der Strom (wie PR 10,
// Abweichung 7) und gemessen bei Wärmepumpe und Mischanlage die gemessene Gesamtwärme (Abs. 1 Satz 2
// und 5, A8).
//
// Aus PR 10 übernommen (Abgleich nach der Prüfung vom 05.10.2026): Die Rechnungen müssen die Heizperiode
// ganz abdecken (`fuelGap`, PR 10 Abweichung 11), α auf der Schätzung beim Abschluss heißt `estimated`,
// und α außerhalb von (0, 1) ist `outOfRange`.
//
// Alle Rechtswerte kommen aus dem Register; diese Datei steht in `ENGINE_FILES` des Wächters
// (law-literals.test.ts). Fehlt eine Angabe, wird nicht geraten, sondern gesagt, was fehlt.
import type {
  DhwFactorKind, DhwHeatingValue, DhwMethod, DhwStatement, FuelDelivery, FuelDeliveryPart, HeatGeneration, HeatingEnergy, HeatingValueTable, HeatingValueUnit,
} from '../../shared/types.ts'
import { law, type LawLog, type Period } from '../../shared/law/register.ts'
import { hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvHeatingValues } from '../../shared/law/heizkostenv.ts'
import { FUEL_GRADE_LABELS, HEATING_VALUE_UNIT_TEXT, isBoiler } from '../../shared/fuelGrades.ts'
import { andList } from '../../shared/wording.ts'
import type { SnapshotUnit } from './snapshot.ts'

// Plausibilität (Entwurf 15.2 F6): keine Rechtsgrenze, nur ein Anlass zu prüfen.
export const DHW_PLAUSIBLE = { min: 0.05, max: 0.5 } as const
// Volle Abdeckung der Heizperiode durch Rechnungen, in Promille (wie PR 10).
const COVERAGE_FULL = 1000

const fmt = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const fmtUpTo = (n: number, digits = 2) => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
export const fmtShare = (alpha: number): string => `${fmt(alpha * 100, 2)} %`

// Was den Warmwasseranteil verhindert. Die ersten fünf stammen aus PR 10 (`AlphaProblem` dort, ohne die
// beiden Sperren `formulaLater` und `heatingValueLater`, die mit dieser PR fallen); `formulaInput` ist
// eine fehlende oder widersprüchliche Eingabe einer Formel oder des Erzeugers, `totalHeatMissing` eine
// Anlage, die nur gegen gemessene Gesamtwärme rechnen darf und keine hat.
export type DhwProblem = 'noDhwHeat' | 'heatPumpBasis' | 'noFuelEnergy' | 'fuelGap' | 'outOfRange' | 'formulaInput' | 'totalHeatMissing'

// ---------- Tage (UTC, inklusive Grenzen, wie calc.ts) ----------

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}
const daysInclusive = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1
// Der letzte Tag des Jahres, das an `from` beginnt (aus 2025-05-01 wird 2026-04-30).
function yearEndFrom(from: string): string {
  const [y, m, d] = from.split('-').map(Number)
  return new Date(Date.UTC((y ?? 0) + 1, (m ?? 1) - 1, (d ?? 1) - 1)).toISOString().slice(0, 10)
}

// Welcher Teil eines Jahres die Heizperiode ist, bei einem Kesseltausch die Laufzeit der Anlage in ihr.
// Eine Heizperiode von zwölf Monaten ist genau ein Jahr, auch im Schaltjahr; nur ein Rumpf oder eine
// kürzere Laufzeit ist weniger. Nach Tagen und nicht nach Gradtagen, weil § 9b Abs. 2 HeizkostenV die
// Kosten des Warmwasserverbrauchs zeitanteilig teilt: Warmwasser hängt nicht an der Witterung
// (Abweichung 3, Festlegung F7 im Entwurf 15.2, ⟨Norm offen: VDI 2077⟩).
export function yearShare(h: Period, running: Period = h): { share: number; days: number; yearDays: number } {
  const end = yearEndFrom(h.from)
  const yearDays = daysInclusive(h.from, end)
  const from = running.from > h.from ? running.from : h.from
  const to = running.to < h.to ? running.to : h.to
  if (from === h.from && to >= end) return { share: 1, days: yearDays, yearDays }
  const days = Math.min(daysInclusive(from, to), yearDays)
  return { share: days / yearDays, days, yearDays }
}

// ---------- Lieferungen der Heizperiode ----------

export type EnergyDelivery = Pick<
  FuelDelivery,
  'id' | 'label' | 'invoiceTo' | 'deliveredAt' | 'invoiceDate' | 'energyKwh' | 'quantity' | 'quantityUnit' | 'gasBasis' | 'heatingValue' | 'fuelGrade'
> & {
  // Anteil des verbrauchsabhängigen Teils dieser Rechnung an der Heizperiode, 0 bis 1 (PR 7,
  // `FuelDeliveryLine.sharePermille` / 1000). Bei Vorrat 1: Dort zählt die verbrauchte Menge.
  share: number
  // Die kWh dieser Rechnung in der Heizperiode, wie die Bewertung der Lieferungen sie ausweist (PR 10,
  // `FuelDeliveryLine.energyKwh`, samt Teilmengen und Schätzung). Fehlt sie, gilt Anteil · kWh.
  kwhInPeriod?: number | null
  parts?: readonly Pick<FuelDeliveryPart, 'energyKwh'>[]
}

// Zu welcher Heizperiode eine Lieferung gehört: der, die das Ende des Rechnungszeitraums bzw. das
// Lieferdatum enthält (Entwurf 5.4).
export const deliveryDate = (d: Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate'>): string | null => d.invoiceTo ?? d.deliveredAt ?? d.invoiceDate
export function deliveriesInPeriod<T extends Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate'>>(ds: readonly T[], h: Period): T[] {
  return ds.filter((d) => {
    const date = deliveryDate(d)
    return date !== null && date >= h.from && date <= h.to
  })
}
// Die jüngste Lieferung vor der Heizperiode in einer Einheit: Ihr Brennstoff liegt im Vorrat, wenn in der
// Heizperiode keine kam (Abweichung 6).
export function latestBefore<T extends Pick<FuelDelivery, 'invoiceTo' | 'deliveredAt' | 'invoiceDate' | 'quantityUnit'>>(ds: readonly T[], h: Period, unit: HeatingValueUnit): T | null {
  const earlier = ds
    .filter((d) => d.quantityUnit === unit)
    .map((d) => ({ d, date: deliveryDate(d) }))
    .filter((x): x is { d: T; date: string } => x.date !== null && x.date < h.from)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return earlier.at(-1)?.d ?? null
}

// Die mit Warmwasser versorgte Wohn- oder Nutzfläche der angeschlossenen Wohnungen (§ 9 Abs. 2 Satz 5
// Nr. 2): ohne die mit „kein Anschluss: Warmwasser“ (#117).
export function suppliedAreaOf(units: readonly Pick<SnapshotUnit, 'areaM2' | 'noConnection'>[]): number {
  return units.filter((u) => !(u.noConnection ?? []).includes('warmwasser')).reduce((a, u) => a + (u.areaM2 || 0), 0)
}

// ---------- Formeln (§ 9 Abs. 2 Satz 2 bis 5) ----------

export type Failure = { ok: false; reasons: string[] }
const fail = (...reasons: string[]): Failure => ({ ok: false, reasons })

export type FormulaInput = { method: 'volumeFormula' | 'areaFormula'; volumeM3: number | null; tempC: number | null; areaM2: number; h: Period; running?: Period | null }

export function formulaHeat(i: FormulaInput, log: LawLog): { ok: true; kwh: number; steps: string[] } | Failure {
  if (i.method === 'volumeFormula') {
    const p = law(hkvDhwVolumeFormula, { period: i.h }, log)
    const reasons: string[] = []
    const swap = i.running ? ' in der Laufzeit dieser Anlage' : ''
    if (i.volumeM3 === null || !(i.volumeM3 > 0)) reasons.push(`das gemessene Volumen des Warmwassers${swap} in m³ fehlt`)
    if (i.tempC === null) reasons.push('die mittlere Temperatur des Warmwassers in °C fehlt (gemessen oder geschätzt)')
    else if (!(i.tempC > p.coldWaterC)) reasons.push(`die Temperatur des Warmwassers (${fmtUpTo(i.tempC, 1)} °C) liegt nicht über der Kaltwassertemperatur von ${fmtUpTo(p.coldWaterC)} °C, die die Formel ansetzt`)
    if (reasons.length > 0 || i.volumeM3 === null || i.tempC === null) return { ok: false, reasons }
    const kwh = p.effort * i.volumeM3 * (i.tempC - p.coldWaterC)
    return {
      ok: true,
      kwh,
      steps: [`Q = ${fmtUpTo(p.effort)} · ${fmtUpTo(i.volumeM3, 3)} m³ · (${fmtUpTo(i.tempC, 1)} °C − ${fmtUpTo(p.coldWaterC)} °C) = ${fmtUpTo(kwh)} kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)`],
    }
  }
  const p = law(hkvDhwAreaFormula, { period: i.h }, log)
  if (!(i.areaM2 > 0)) return fail('die mit Warmwasser versorgte Wohn- oder Nutzfläche ist 0 m²; tragen Sie die Wohnflächen der angeschlossenen Wohnungen ein')
  const year = p.kwhPerM2 * i.areaM2
  const steps = [`Q = ${fmtUpTo(p.kwhPerM2)} · ${fmtUpTo(i.areaM2)} m² = ${fmtUpTo(year)} kWh je Jahr (§ 9 Abs. 2 Satz 4 HeizkostenV)`]
  const ys = yearShare(i.h, i.running ?? i.h)
  if (ys.share === 1) return { ok: true, kwh: year, steps }
  const kwh = year * ys.share
  steps.push(`${i.running ? 'Die Anlage lief in dieser Heizperiode' : 'Die Heizperiode umfasst'} ${ys.days} von ${ys.yearDays} Tagen; Warmwasser wird wie in § 9b Abs. 2 HeizkostenV zeitanteilig gerechnet: ${fmtUpTo(year)} kWh · ${ys.days} / ${ys.yearDays} = ${fmtUpTo(kwh)} kWh`)
  return { ok: true, kwh, steps }
}

// ---------- Energie des Erzeugers in der Heizperiode ----------

export type GeneratorInput = {
  deliveries: readonly EnergyDelivery[]
  // Vorrat (PR 8): die in der Heizperiode verbrauchte Menge; null ohne Vorrat.
  stock: { unit: HeatingValueUnit; consumed: number } | null
  // Nur bei Vorrat ohne Lieferung in der Heizperiode: die jüngste frühere Lieferung derselben Einheit.
  earlier: EnergyDelivery | null
}

export type Energy =
  | { ok: true; kind: 'kwh'; kwh: number; basis: 'hs' | 'hi' | null }
  | { ok: true; kind: 'quantity'; kwh: number; quantity: number; unit: HeatingValueUnit; heatingValue: number; values: DhwHeatingValue[] }

const UNIT_IN: Record<HeatingValueUnit, string> = { l: 'Litern', m3: 'Kubikmetern', kg: 'Kilogramm', srm: 'Schüttraummetern' }
// Die kWh einer Rechnung, wie abgerechnet: angegeben, als Menge in kWh oder aus den Teilmengen (PR 7).
function totalKwhOf(d: EnergyDelivery): number | null {
  if (d.energyKwh !== null) return d.energyKwh
  if (d.quantityUnit === 'kWh' && d.quantity !== null) return d.quantity
  const parts = d.parts ?? []
  return parts.length > 0 && parts.every((p) => p.energyKwh !== null) ? parts.reduce((a, p) => a + (p.energyKwh ?? 0), 0) : null
}
const kwhInPeriodOf = (d: EnergyDelivery): number | null => {
  if (d.kwhInPeriod !== undefined && d.kwhInPeriod !== null) return d.kwhInPeriod
  const total = totalKwhOf(d)
  return total === null ? null : total * d.share
}
const isValueUnit = (u: FuelDelivery['quantityUnit']): u is HeatingValueUnit => u === 'l' || u === 'm3' || u === 'kg' || u === 'srm'

// Der Heizwert einer Lieferung: laut Rechnung, sonst hilfsweise aus der Tabelle, und die nur bei
// Heizkesseln, mit gewählter Zeile und in deren Einheit (§ 9 Abs. 3, Entwurf R-A13). Ein Satz, wenn es
// keinen gibt.
function heatingValueOf(d: EnergyDelivery, energy: HeatingEnergy, unit: HeatingValueUnit, table: HeatingValueTable): DhwHeatingValue | string {
  if (d.heatingValue !== null) return { label: d.label, kwh: d.heatingValue, per: unit, source: 'invoice', grade: d.fuelGrade }
  if (!isBoiler(energy)) return `„${d.label}“ nennt keinen Heizwert, und die Werte der Heizkostenverordnung gelten nur bei Heizkesseln`
  if (d.fuelGrade === null) {
    return `„${d.label}“ nennt keinen Heizwert; tragen Sie den Heizwert laut Rechnung ein oder wählen Sie, wenn keiner darauf steht, die Zeile der Tabelle der Heizkostenverordnung`
  }
  const row = table.values[d.fuelGrade]
  if (!row) return `für „${FUEL_GRADE_LABELS[d.fuelGrade]}“ nennt die geltende Tabelle der Heizkostenverordnung keinen Wert; tragen Sie den Heizwert laut Rechnung ein`
  if (row.per !== unit) {
    return `für „${d.label}“ in ${UNIT_IN[unit]} nennt die Tabelle der Heizkostenverordnung keinen Wert, sie führt ${FUEL_GRADE_LABELS[d.fuelGrade]} nur je ${HEATING_VALUE_UNIT_TEXT[row.per]}; tragen Sie den Heizwert laut Rechnung ein`
  }
  return { label: d.label, kwh: row.kwh, per: row.per, source: 'table', grade: d.fuelGrade }
}

// Brennstoff als Menge: B = Q / Hᵢ nach § 9 Abs. 3; nur in den Einheiten der geltenden Fassung (seit
// 01.12.2021 Liter, Kubikmeter, Kilogramm; Abweichung 2). Mehrere Heizwerte mengengewichtet (Abweichung 6).
function quantityEnergy(energy: HeatingEnergy, h: Period, unit: HeatingValueUnit, quantity: number, weighted: readonly { d: EnergyDelivery; weight: number }[], log: LawLog): Energy | Failure {
  const table = law(hkvHeatingValues, { period: h }, log)
  if (!table.units.includes(unit)) {
    return fail(`§ 9 Abs. 3 Satz 1 HeizkostenV bestimmt den Brennstoffverbrauch in der geltenden Fassung nur in ${andList(table.units.map((u) => UNIT_IN[u])).replace(/ und ([^ ]+)$/, ' oder $1')}; in ${UNIT_IN[unit]} sieht er ihn nicht vor. Erfassen Sie Vorrat und Lieferungen in Kilogramm, oder tragen Sie die Kilowattstunden laut Rechnung ein`)
  }
  const values: DhwHeatingValue[] = []
  const reasons: string[] = []
  for (const { d } of weighted) {
    const v = heatingValueOf(d, energy, unit, table)
    if (typeof v === 'string') reasons.push(v)
    else values.push(v)
  }
  if (reasons.length > 0) return { ok: false, reasons }
  const totalWeight = weighted.reduce((a, w) => a + w.weight, 0)
  const meanHi = weighted.reduce((a, w, k) => a + w.weight * (values[k]?.kwh ?? 0), 0) / totalWeight
  return { ok: true, kind: 'quantity', kwh: quantity * meanHi, quantity, unit, heatingValue: meanHi, values }
}

export function generatorEnergyOf(energy: HeatingEnergy, h: Period, g: GeneratorInput, log: LawLog): Energy | Failure {
  if (g.stock !== null) {
    const own = g.deliveries.filter((d) => d.quantityUnit === g.stock?.unit && d.quantity !== null && d.quantity > 0)
    const basis = own.length > 0 ? own.map((d) => ({ d, weight: d.quantity ?? 0 })) : g.earlier ? [{ d: g.earlier, weight: 1 }] : []
    if (basis.length === 0) {
      return fail('für den Brennstoff aus dem Vorrat ist kein Heizwert bekannt: In dieser Heizperiode gibt es keine Lieferung, und eine frühere ist nicht erfasst; erfassen Sie die letzte Lieferung mit ihrem Heizwert oder der Zeile der Tabelle')
    }
    return quantityEnergy(energy, h, g.stock.unit, g.stock.consumed, basis, log)
  }
  const used = g.deliveries.filter((d) => d.share > 0)
  if (used.length === 0) return fail('in dieser Heizperiode gibt es keine Rechnung des Versorgers mit einem Anteil an ihr; erfassen Sie die Rechnungen als Lieferungen')
  if (used.every((d) => kwhInPeriodOf(d) !== null)) {
    const kwh = used.reduce((a, d) => a + (kwhInPeriodOf(d) ?? 0), 0)
    const bases = new Set(used.map((d) => d.gasBasis))
    if (bases.has('hs') && bases.has('hi')) {
      return fail('die Rechnungen nennen die Kilowattstunden teils nach Brennwert, teils nach Heizwert; so lassen sie sich nicht zusammenzählen. Bitte prüfen Sie die Angabe an den Lieferungen')
    }
    const basis = bases.size === 1 ? ([...bases][0] ?? null) : null
    return { ok: true, kind: 'kwh', kwh, basis }
  }
  const missing = used.filter((d) => kwhInPeriodOf(d) === null)
  if (!isBoiler(energy)) return fail(`${andList(missing.map((d) => `„${d.label}“`))} ${missing.length === 1 ? 'nennt' : 'nennen'} keine Kilowattstunden; bei dieser Heizung zählen die Kilowattstunden laut Rechnung`)
  const units = new Set(used.map((d) => d.quantityUnit))
  const first = used[0]?.quantityUnit ?? null
  if (used.some((d) => d.quantity === null || !(d.quantity > 0)) || units.size !== 1 || first === null || !isValueUnit(first)) {
    return fail('die Rechnungen nennen weder alle Kilowattstunden noch alle eine Menge in derselben Einheit; erfassen Sie bei allen Rechnungen der Heizperiode die Kilowattstunden oder bei allen die Menge')
  }
  const quantity = used.reduce((a, d) => a + d.share * (d.quantity ?? 0), 0)
  return quantityEnergy(energy, h, first, quantity, used.map((d) => ({ d, weight: d.share * (d.quantity ?? 0) })), log)
}

// ---------- Faktor nach § 9 Abs. 2 Satz 6, nur für Formelwerte ----------

type Factor = { kind: DhwFactorKind; value: number; q: (kwh: number) => number; step: (from: number, to: number) => string }

function formulaFactor(energy: HeatingEnergy, e: Energy, h: Period, log: LawLog): { ok: true; factor: Factor | null } | Failure {
  // Stromheizung: Satz 6 nennt keinen Faktor, und eine Formelwärme gegen Strom zu stellen wäre eine eigene
  // Regel. Gemessen rechnet sie wie in PR 10 (Abweichung 7). Unbekannter Energieträger: nur gemessen
  // gegen gemessen (§ 9 Abs. 1 Satz 5).
  if (energy === 'electric') {
    return fail('für eine Stromheizung nennt § 9 Abs. 2 Satz 6 HeizkostenV keinen Faktor; bestimmen Sie den Warmwasseranteil mit einem Wärmezähler am Warmwasserspeicher, er wird dann gegen den Strom laut Rechnung gestellt')
  }
  if (energy === 'other') {
    return fail('bei einem unbekannten Energieträger regelt § 9 HeizkostenV keine Formel; der Anteil lässt sich nur mit gemessener Gesamtwärme bestimmen (§ 9 Abs. 1 Satz 5)')
  }
  const f = law(hkvDhwFactors, { period: h }, log)
  if (energy === 'gas' && e.kind === 'kwh') {
    if (e.basis === null) {
      return fail(`bei den Gasrechnungen fehlt die Angabe, ob nach Brennwert oder nach Heizwert abgerechnet wurde; davon hängt der Faktor ${fmt(f.gasCalorific, 2)} ab (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)`)
    }
    if (e.basis === 'hi') return { ok: true, factor: null }
    return {
      ok: true,
      factor: {
        kind: 'gasCalorific', value: f.gasCalorific, q: (k) => k * f.gasCalorific,
        step: (a, b) => `Erdgas nach Brennwert abgerechnet: ${fmtUpTo(a)} kWh · ${fmt(f.gasCalorific, 2)} = ${fmtUpTo(b)} kWh (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)`,
      },
    }
  }
  if (energy === 'districtHeating') {
    return {
      ok: true,
      factor: {
        kind: 'heatSupply', value: f.heatSupplyDivisor, q: (k) => k / f.heatSupplyDivisor,
        step: (a, b) => `Wärmelieferung: ${fmtUpTo(a)} kWh ÷ ${fmt(f.heatSupplyDivisor, 2)} = ${fmtUpTo(b)} kWh (§ 9 Abs. 2 Satz 6 Nr. 2 HeizkostenV)`,
      },
    }
  }
  if (energy === 'heatPump') {
    const hp = f.heatPump
    if (hp === null) {
      return fail('für Zeiträume, die vor dem Inkrafttreten der Nr. 3 beginnen, sieht § 9 Abs. 2 Satz 6 HeizkostenV keinen Faktor für die Wärmepumpe vor; der Anteil lässt sich dann nur gemessen oder nach anerkannten Regeln der Technik bestimmen (§ 9 Abs. 1 Satz 5)')
    }
    return {
      ok: true,
      factor: {
        kind: 'heatPump', value: hp, q: (k) => k * hp,
        step: (a, b) => `Monovalente Wärmepumpe: ${fmtUpTo(a)} kWh · ${fmt(hp, 2)} = ${fmtUpTo(b)} kWh Strom (§ 9 Abs. 2 Satz 6 Nr. 3 HeizkostenV)`,
      },
    }
  }
  // Heizöl, Flüssiggas, Pellets, Holz, Kohle, und Erdgas als Menge mit Heizwert: kein Faktor.
  return { ok: true, factor: null }
}

// ---------- α ----------

export type DhwInput = {
  energy: HeatingEnergy
  heatGeneration: HeatGeneration | null
  h: Period
  // Kesseltausch (PR 9): die Laufzeit der Anlage in der Heizperiode, wenn sie kürzer ist; sonst null.
  running?: Period | null
  method: DhwMethod
  // Gemessen: Wärme für das Warmwasser und Gesamtwärme der Anlage in kWh (Zähler mit Rolle `dhwHeat`
  // bzw. `totalHeat` oder eingetragen, PR 10 Abweichung 12).
  measured: { dhwKwh: number | null; totalKwh: number | null }
  volumeM3: number | null
  tempC: number | null
  suppliedAreaM2: number
  generator: GeneratorInput
  // Aus der Bewertung der Lieferungen (PR 7): wie viel der Heizperiode die Rechnungen abdecken, in
  // Promille, und ob eine davon die Schätzung beim Abschluss ist (PR 10 Abweichung 11).
  fuelCoveragePermille: number | null
  fuelEstimated: boolean
}

export type DhwOutcome =
  | { ok: true; statement: DhwStatement }
  | { ok: false; code: 'heating.dhw-share-invalid' | 'heating.heat-pump-dhw-basis'; problem: DhwProblem; reasons: string[] }

const failed = (problem: DhwProblem, reasons: string[]): DhwOutcome =>
  ({ ok: false, code: problem === 'heatPumpBasis' ? 'heating.heat-pump-dhw-basis' : 'heating.dhw-share-invalid', problem, reasons })

// α außerhalb von (0, 1) ist ein Widerspruch in den Angaben (PR 10, `outOfRange`).
const outOfRange = (alpha: number): DhwOutcome => failed('outOfRange', [alpha > 0
  ? `der Warmwasseranteil ergäbe ${fmtShare(alpha)}, also mindestens die ganze Energie der Anlage; bitte prüfen Sie die Werte`
  : 'die Wärme für das Warmwasser ist 0 kWh; das passt nicht zu einer Anlage, die das Warmwasser bereitet. Bitte prüfen Sie die Stände und Werte'])

// Die Rechnungen müssen die ganze Heizperiode abdecken; eine Lücke hochzurechnen wäre eine Schätzung
// (PR 10 Abweichung 11). Beim Vorrat zählt die verbrauchte Menge, dort gibt es diese Frage nicht.
function gapOf(i: DhwInput): DhwOutcome | null {
  if (i.generator.stock !== null) return null
  if (i.fuelCoveragePermille !== null && i.fuelCoveragePermille >= COVERAGE_FULL - 1e-6) return null
  return failed('fuelGap', ['die Rechnungen des Versorgers decken die Heizperiode nicht ganz ab, und der Warmwasseranteil braucht den Verbrauch der ganzen Heizperiode; tragen Sie die Folgerechnung ein oder schließen Sie die Abrechnung mit einer Schätzung der fehlenden Rechnung ab'])
}

const DENOMINATOR_WORDS: Record<'fuelKwh' | 'deliveredHeat' | 'electricity', string> = {
  fuelKwh: 'Brennstoff laut Rechnung', deliveredHeat: 'gelieferte Wärme laut Rechnung', electricity: 'Strom laut Rechnung',
}

// Q gegen die Energie stellen und α prüfen. `formula` ist null bei gemessenem Q.
function finish(i: DhwInput, method: DhwMethod, q: number, formula: { kwh: number; factor: Factor | null } | null, e: Energy, steps: string[]): DhwOutcome {
  const factor = formula?.factor ? { kind: formula.factor.kind, value: formula.factor.value } : null
  const values = e.kind === 'quantity' ? e.values : []
  const estimated = i.generator.stock === null && i.fuelEstimated
  if (e.kind === 'kwh') {
    if (!(e.kwh > 0)) return failed('noFuelEnergy', ['die Rechnungen der Heizperiode ergeben 0 kWh'])
    const kind = i.energy === 'districtHeating' ? 'deliveredHeat' : i.energy === 'heatPump' || i.energy === 'electric' ? 'electricity' : 'fuelKwh'
    const alpha = q / e.kwh
    if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
    steps.push(`Warmwasseranteil = ${fmtUpTo(q)} kWh / ${fmtUpTo(e.kwh)} kWh ${DENOMINATOR_WORDS[kind]} = ${fmtShare(alpha)}`)
    return {
      ok: true,
      statement: { method, alpha, heatKwh: q, formulaKwh: formula?.kwh ?? null, factor, denominator: { kind, value: e.kwh, unit: 'kWh' }, energyKwh: e.kwh, fuelForDhw: null, heatingValues: values, estimated, steps },
    }
  }
  if (!(e.quantity > 0) || !(e.heatingValue > 0)) return failed('noFuelEnergy', ['in der Heizperiode wurde kein Brennstoff verbraucht'])
  const b = q / e.heatingValue
  const alpha = b / e.quantity
  if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
  const unit = HEATING_VALUE_UNIT_TEXT[e.unit]
  steps.push(`Heizwert: ${fmtUpTo(e.heatingValue, 3)} kWh je ${unit}${e.values.length > 1 ? ' (Mittel der Rechnungen nach Menge)' : ''}${e.values.some((v) => v.source === 'table') ? ' (Tabelle des § 9 Abs. 3 HeizkostenV, weil die Rechnung keinen nennt)' : ''}`)
  steps.push(`B = Q / Hᵢ = ${fmtUpTo(q)} kWh / ${fmtUpTo(e.heatingValue, 3)} kWh je ${unit} = ${fmtUpTo(b)} ${unit} (§ 9 Abs. 3 HeizkostenV)`)
  steps.push(`Warmwasseranteil = ${fmtUpTo(b)} / ${fmtUpTo(e.quantity)} ${unit} verbrauchter Brennstoff = ${fmtShare(alpha)}`)
  return {
    ok: true,
    statement: {
      method, alpha, heatKwh: q, formulaKwh: formula?.kwh ?? null, factor,
      denominator: { kind: 'fuelQuantity', value: e.quantity, unit: e.unit },
      energyKwh: e.kwh,
      fuelForDhw: { quantity: b, unit: e.unit, heatingValue: e.heatingValue },
      heatingValues: values, estimated, steps,
    },
  }
}

function measuredShare(i: DhwInput, log: LawLog): DhwOutcome {
  const q = i.measured.dhwKwh
  if (q === null || q < 0) {
    return failed('noDhwHeat', ['die gemessene Wärme für das Warmwasser fehlt; tragen Sie die Stände des Wärmezählers am Warmwasserspeicher zu Beginn und Ende der Heizperiode ein'])
  }
  const steps = [`Gemessene Wärme für das Warmwasser: ${fmtUpTo(q)} kWh (§ 9 Abs. 2 Satz 1 HeizkostenV)`]
  const total = i.measured.totalKwh
  // Wärmepumpe: Anteil am Wärmeverbrauch (§ 9 Abs. 1 Satz 2). Gemessene Wärme durch Strom ergäbe etwa
  // das Dreifache (Entwurf 8.3, A8).
  if (i.energy === 'heatPump' && total === null) return failed('heatPumpBasis', [])
  // Nur gegen gemessene Gesamtwärme: Wärmepumpe, unbekannter Energieträger und eine Anlage mit weiterem
  // Erzeuger (§ 9 Abs. 1 Satz 5). Die Stromheizung nicht: Sie rechnet wie in PR 10 gegen den Strom laut
  // Rechnung (Abweichung 7).
  const needsTotal = i.energy === 'heatPump' || i.energy === 'other' || i.heatGeneration === 'mixed'
  if (total !== null && (needsTotal || i.energy === 'districtHeating')) {
    if (!(total > 0)) return failed('totalHeatMissing', ['die gemessene Gesamtwärme ist 0 kWh; bitte prüfen Sie die Stände des Gesamtwärmezählers'])
    const alpha = q / total
    if (!(alpha > 0 && alpha < 1)) return outOfRange(alpha)
    steps.push(`Warmwasseranteil = ${fmtUpTo(q)} kWh / ${fmtUpTo(total)} kWh gemessene Gesamtwärme = ${fmtShare(alpha)} (§ 9 Abs. 1 Satz 2 HeizkostenV)`)
    return {
      ok: true,
      statement: {
        method: 'heatMeter', alpha, heatKwh: q, formulaKwh: null, factor: null, denominator: { kind: 'measuredTotalHeat', value: total, unit: 'kWh' },
        energyKwh: total, fuelForDhw: null, heatingValues: [], estimated: false, steps,
      },
    }
  }
  if (needsTotal) {
    return failed('totalHeatMissing', [i.heatGeneration === 'mixed'
      ? 'die Anlage erzeugt die Wärme nicht allein; dann braucht es die gemessene Gesamtwärme (Gesamtwärmezähler), und die fehlt (§ 9 Abs. 1 Satz 5 HeizkostenV)'
      : 'bei einem unbekannten Energieträger braucht es die gemessene Gesamtwärme (Gesamtwärmezähler), und die fehlt (§ 9 Abs. 1 Satz 5 HeizkostenV)'])
  }
  const e = generatorEnergyOf(i.energy, i.h, i.generator, log)
  if (!e.ok) return failed('noFuelEnergy', e.reasons)
  const gap = gapOf(i)
  if (gap) return gap
  return finish(i, 'heatMeter', q, null, e, steps)
}

function formulaShare(i: DhwInput, method: 'volumeFormula' | 'areaFormula', log: LawLog): DhwOutcome {
  if (i.heatGeneration === null) {
    return failed('formulaInput', ['es fehlt die Antwort, ob die Anlage die Wärme allein erzeugt; sie entscheidet, ob eine Formel zulässig ist (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3 HeizkostenV)'])
  }
  if (i.heatGeneration === 'mixed') {
    return failed('formulaInput', ['die Anlage erzeugt die Wärme nicht allein (etwa mit Solaranlage, Heizstab oder zweitem Kessel); dann lässt sich der Anteil nur mit gemessener Gesamtwärme bestimmen (§ 9 Abs. 1 Satz 5 HeizkostenV) und nicht nach einer Formel'])
  }
  const formula = formulaHeat({ method, volumeM3: i.volumeM3, tempC: i.tempC, areaM2: i.suppliedAreaM2, h: i.h, running: i.running ?? null }, log)
  if (!formula.ok) return failed('formulaInput', formula.reasons)
  const e = generatorEnergyOf(i.energy, i.h, i.generator, log)
  if (!e.ok) return failed('noFuelEnergy', e.reasons)
  const gap = gapOf(i)
  if (gap) return gap
  const f = formulaFactor(i.energy, e, i.h, log)
  if (!f.ok) return failed('formulaInput', f.reasons)
  const steps = [...formula.steps]
  const q = f.factor ? f.factor.q(formula.kwh) : formula.kwh
  if (f.factor) steps.push(f.factor.step(formula.kwh, q))
  return finish(i, method, q, { kwh: formula.kwh, factor: f.factor }, e, steps)
}

export function dhwShareOf(i: DhwInput, log: LawLog): DhwOutcome {
  return i.method === 'heatMeter' ? measuredShare(i, log) : formulaShare(i, i.method, log)
}
