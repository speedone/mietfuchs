// Plausibilität der CO₂-Angaben einer Rechnung (Heizung PR 17, #97, Entwurf 4.5 und 15.2 F6). Nur ein
// „bitte prüfen“: Keine Zahl der Abrechnung hängt daran, und Mietfuchs rechnet nie kg oder € aus kWh vor
// (Entwurf 16). Verglichen wird, was auf der Rechnung steht, mit dem, was nach Gesetz dastehen müsste:
//
// - kg gegen die Standardwerte der EBeV 2030 für das Lieferjahr (§ 3 Abs. 2 CO2KostAufG), nur Erdgas,
//   Heizöl EL und Flüssiggas (Abweichung 6 des Plans);
// - € gegen kg × Preis zum Zeitpunkt der Lieferung zuzüglich Umsatzsteuer (§ 3 Abs. 3). Über zwei
//   Preisjahre und bei Fernwärme mit Anteil aus dem Emissionshandel (§ 3 Abs. 4 Nr. 4 b) eine Spanne
//   (Review Focus 2, 3); im Übergangszeitraum der Umsatzsteuer ebenso bei Rechnungen über die
//   Stichtage und bei Flüssiggas (Abweichung 5).
//
// Abgefragt werden die Werte des Registers nur, wenn die Rechnung die Angaben dafür hat: Wer nichts
// einträgt, sieht im Rechtsstand nichts davon (Entwurf 1.2 Nr. 1).
import { co2CostsBefore, co2EbevFactors, co2Price, co2PriceEts } from '../../shared/law/co2kostaufg.ts'
import { coversDate, law, lawOverridable, yearStart, type LawLog } from '../../shared/law/register.ts'
import { ustgGasHeatNetworkRate, ustgStandardRate } from '../../shared/law/ustg.ts'
import type { FuelDelivery, HeatingEnergy } from '../../shared/types.ts'

export type PlausibilityDelivery = Pick<FuelDelivery, 'id' | 'label' | 'invoiceDate' | 'deliveredAt' | 'invoiceFrom' | 'invoiceTo' | 'quantity' | 'quantityUnit' | 'energyKwh' | 'gasBasis' | 'emissionsKg' | 'co2CostCents' | 'estimated'>

export type PlausibilityFinding =
  | { kind: 'emissions'; deliveryId: string; label: string; emissionsKg: number; expectedKg: number; basis: string; below: boolean }
  | { kind: 'cost'; deliveryId: string; label: string; emissionsKg: number; co2CostCents: number; lowCents: number; highCents: number; prices: number[]; vat: number[]; years: number[] }

// Grenzen ohne Rechtsquelle (Abweichung 7 des Plans, Entwurf 15.2 F6). Nach oben eng: Lieferanten runden
// Faktoren und kg, ein Fehler zwischen Brennwert und Heizwert macht rund 10 % aus. Nach unten großzügiger:
// Ein anerkannter Biomasseanteil (Bio-Erdgas, Bioheizöl) senkt die kg der Rechnung zu Recht unter den
// Standardwert des fossilen Brennstoffs. Bei den Kosten fängt die Grenze Netto statt Brutto, 19 statt 7 %
// und ein falsches Preisjahr.
export const KG_TOLERANCE = { absolute: 1, above: 0.01, below: 0.1 }
export const COST_TOLERANCE = { absoluteCents: 100, relative: 0.03 }

// GJ je MWh, physikalisch (1 kWh = 3,6 MJ); kein Rechtswert.
const GJ_PER_MWH = 3.6
// Wofür ein CO₂-Preis anfällt: die Brennstoffe nach § 2 Abs. 1 CO2KostAufG und Wärme (§ 3 Abs. 4).
const PRICE_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'districtHeating']
// Gas über das Erdgasnetz, Wärme über ein Wärmenetz (§ 28 Abs. 5, 6 UStG). Flüssiggas nur nach dem
// BMF-Schreiben vom 25.10.2022, Rz. 5 (per Tankwagen), deshalb dort beide Sätze.
const REDUCED_BY_LAW: readonly HeatingEnergy[] = ['gas', 'districtHeating']

const de = (n: number, digits = 1): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

// Der Standardwert der kg nach EBeV 2030 für das, was die Rechnung nennt. `null`, wenn die Rechnung die
// nötige Angabe nicht hat oder das Register für das Jahr keine Werte führt.
function expectedEmissions(d: PlausibilityDelivery, energy: HeatingEnergy, year: number, log: LawLog): { kg: number; basis: string } | null {
  const kwh = d.energyKwh
  const input =
    energy === 'gas' ? (kwh !== null && d.gasBasis !== null ? 'kwh' : null)
      : energy === 'oil' ? (d.quantityUnit === 'l' && d.quantity !== null ? 'amount' : kwh !== null ? 'kwh' : null)
        : energy === 'lpg' ? (d.quantityUnit === 'kg' && d.quantity !== null ? 'amount' : kwh !== null ? 'kwh' : null)
          : null
  if (input === null || !coversDate(co2EbevFactors, yearStart(year))) return null
  const f = law(co2EbevFactors, { year }, log)
  const amount = d.quantity ?? 0
  const energyKwh = kwh ?? 0
  if (energy === 'gas') {
    return d.gasBasis === 'hs'
      ? { kg: energyKwh * f.gas.tPerGj * f.gas.hsGjPerMwh, basis: `${de(energyKwh, 0)} kWh nach Brennwert` }
      : { kg: energyKwh * f.gas.tPerGj * GJ_PER_MWH, basis: `${de(energyKwh, 0)} kWh nach Heizwert` }
  }
  if (energy === 'oil') {
    return input === 'amount'
      ? { kg: amount * f.oil.tPerM3 * f.oil.gjPerT * f.oil.tPerGj, basis: `${de(amount, 0)} Litern Heizöl` }
      : { kg: energyKwh * f.oil.tPerGj * GJ_PER_MWH, basis: `${de(energyKwh, 0)} kWh Heizöl` }
  }
  return input === 'amount'
    ? { kg: amount * f.lpg.gjPerT * f.lpg.tPerGj, basis: `${de(amount, 0)} kg Flüssiggas` }
    : { kg: energyKwh * f.lpg.tPerGj * GJ_PER_MWH, basis: `${de(energyKwh, 0)} kWh Flüssiggas` }
}

// Die Steuersätze, die für eine Rechnung vom `start` bis `end` in Betracht kommen. Liegt der Zeitraum ganz
// in der Zeit der Ermäßigung, gilt bei Gas und Wärme der ermäßigte Satz (§ 28 Abs. 5, 6 UStG; BMF Rz. 4).
// Berührt er sie nur teilweise, darf der Lieferant nach Tagen oder Verbrauch aufteilen (BMF Rz. 12), und
// jeder Satz zwischen beiden ist plausibel. Flüssiggas: beide Sätze, sobald der Zeitraum sie berührt.
function vatRates(energy: HeatingEnergy, start: string, end: string, log: LawLog): number[] | null {
  if (!coversDate(ustgStandardRate, end)) return null
  const standard = law(ustgStandardRate, { date: end }, log)
  const reduced = ustgGasHeatNetworkRate.versions.find((v) => (v.validFrom ?? start) <= end && (v.validTo ?? end) >= start)
  if (reduced === undefined || !(REDUCED_BY_LAW.includes(energy) || energy === 'lpg')) return [standard]
  const rate = law(ustgGasHeatNetworkRate, { date: reduced.validFrom !== undefined && reduced.validFrom > start ? reduced.validFrom : start }, log)
  const whole = coversDate(ustgGasHeatNetworkRate, start) && coversDate(ustgGasHeatNetworkRate, end)
  return REDUCED_BY_LAW.includes(energy) && whole ? [rate] : [rate, standard]
}

export function co2Plausibility(d: PlausibilityDelivery, energy: HeatingEnergy, log: LawLog): PlausibilityFinding[] {
  if (d.estimated || d.emissionsKg === null || !(d.emissionsKg > 0)) return []
  const start = d.invoiceFrom ?? d.deliveredAt
  const end = d.invoiceTo ?? d.deliveredAt
  if (start === null || end === null) return []
  const out: PlausibilityFinding[] = []
  const endYear = Number(end.slice(0, 4))

  const expected = expectedEmissions(d, energy, endYear, log)
  if (expected !== null) {
    const below = d.emissionsKg < expected.kg
    const tol = Math.max(KG_TOLERANCE.absolute, (below ? KG_TOLERANCE.below : KG_TOLERANCE.above) * expected.kg)
    if (Math.abs(d.emissionsKg - expected.kg) > tol) {
      out.push({ kind: 'emissions', deliveryId: d.id, label: d.label, emissionsKg: d.emissionsKg, expectedKg: expected.kg, basis: expected.basis, below })
    }
  }

  if (d.co2CostCents === null || !PRICE_ENERGIES.includes(energy)) return out
  // In Rechnung gestellt vor 2023: CO₂-Kosten bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2), also auch
  // keine Preisprüfung. Eine Lieferung von 2022 mit Rechnung von 2023 wird mit dem Preis 2022 geprüft.
  if (d.invoiceDate !== null && (!coversDate(co2CostsBefore, d.invoiceDate) || law(co2CostsBefore, { date: d.invoiceDate }, log))) return out
  const years: number[] = []
  for (let y = Number(start.slice(0, 4)); y <= endYear; y++) years.push(y)
  if (!years.every((y) => coversDate(co2Price, yearStart(y)))) return out
  const prices: number[] = []
  for (const y of years) {
    const p = lawOverridable(co2Price, { year: y }, log)
    if (p === null) return out
    prices.push(p)
  }
  if (energy === 'districtHeating') {
    if (d.invoiceDate === null || !coversDate(co2PriceEts, d.invoiceDate)) return out
    const ets = lawOverridable(co2PriceEts, { date: d.invoiceDate }, log)
    if (ets === null) return out
    prices.push(ets)
  }
  const vat = vatRates(energy, start, end, log)
  if (vat === null) return out
  const t = d.emissionsKg / 1000
  const lowCents = Math.round(t * Math.min(...prices) * (1 + Math.min(...vat) / 100) * 100)
  const highCents = Math.round(t * Math.max(...prices) * (1 + Math.max(...vat) / 100) * 100)
  const tol = (x: number) => Math.max(COST_TOLERANCE.absoluteCents, COST_TOLERANCE.relative * x)
  if (d.co2CostCents < lowCents - tol(lowCents) || d.co2CostCents > highCents + tol(highCents)) {
    out.push({ kind: 'cost', deliveryId: d.id, label: d.label, emissionsKg: d.emissionsKg, co2CostCents: d.co2CostCents, lowCents, highCents, prices, vat, years })
  }
  return out
}

const euroPerT = (v: number): string => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/t`

// Der Text des Hinweises. Bei einer Spanne nennt er beide Enden und die Preise; bei Fernwärme mit Anteil
// aus dem Emissionshandel ist ein Preis mehr als Jahre im Befund. Genannt werden der niedrigste und der
// höchste Preis und Steuersatz, aus denen die Spanne entsteht.
export function plausibilityText(f: PlausibilityFinding, fmtCents: (c: number) => string): string {
  if (f.kind === 'emissions') {
    const bio = f.below
      ? 'Weniger kg können richtig sein, wenn der Lieferant für einen anerkannten Biomasseanteil (etwa Bio-Erdgas oder Bioheizöl) keine Emissionen ansetzt; dann sollte die Rechnung den Anteil nennen. '
      : ''
    return `„${f.label}“: ${de(f.emissionsKg, 2)} kg CO₂ passen nicht zu ${f.basis}. Mit den Standardwerten der Emissionsberichterstattungsverordnung 2030 wären es ${de(f.expectedKg, 2)} kg. ${bio}` +
      'Bitte prüfen Sie die Angaben der Rechnung, auch ob Brennwert oder Heizwert gemeint ist (§ 3 Abs. 1 und 2 CO2KostAufG). Mietfuchs rechnet mit den kg der Rechnung.'
  }
  const expected = f.lowCents === f.highCents ? `wären es ${fmtCents(f.lowCents)}` : `wären es zwischen ${fmtCents(f.lowCents)} und ${fmtCents(f.highCents)}`
  const ets = f.prices.length > f.years.length ? ', mit dem Durchschnittspreis des Emissionshandels' : ''
  const lo = Math.min(...f.prices)
  const hi = Math.max(...f.prices)
  const years = f.years.length > 1 ? `${f.years.slice(0, -1).join(', ')} und ${f.years.at(-1)}` : String(f.years[0] ?? '')
  const priceText = `${lo === hi ? euroPerT(lo) : `${euroPerT(lo)} bis ${euroPerT(hi)}`} (${years}${ets})`
  const vatText = f.vat.length > 1 ? `${Math.min(...f.vat)} bis ${Math.max(...f.vat)}` : String(f.vat[0] ?? '')
  return `„${f.label}“: Die CO₂-Kosten von ${fmtCents(f.co2CostCents)} passen nicht zu ${de(f.emissionsKg, 2)} kg CO₂: Bei ${priceText} zuzüglich ${vatText} % Umsatzsteuer ${expected}. ` +
    'Bitte prüfen Sie die Angaben der Rechnung, etwa ob die Umsatzsteuer enthalten ist (§ 3 Abs. 3 CO2KostAufG). Mietfuchs rechnet mit den CO₂-Kosten der Rechnung.'
}
