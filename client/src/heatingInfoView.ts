// Druckblock der Informationen nach § 6a HeizkostenV (Heizung PR 14): Sätze und Balken, ohne DOM prüfbar. Je
// Mieter nur seine eigenen Zahlen; nie die eines Vor- oder Nachmieters.
import type { HeatingEnergy, HeatingInfoStatement } from './types'
import { fmtEuro } from './api'
import { germanDate } from '../../shared/law/register.ts'

const ENERGY_TEXT: Record<HeatingEnergy, string> = {
  gas: 'Erdgas', oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Holzpellets', wood: 'Holz', districtHeating: 'Fernwärme', heatPump: 'Strom für die Wärmepumpe', electric: 'Strom', coal: 'Kohle', other: 'sonstiger Energieträger',
}
const n = (v: number, digits = 2): string => v.toLocaleString('de-DE', { maximumFractionDigits: digits })

export function infoLines(info: HeatingInfoStatement): string[] {
  const lines: string[] = []
  if (info.heatExempt) lines.push('Die Heizung ist nach § 11 HeizkostenV von der Verbrauchserfassung ausgenommen; die folgenden Angaben betreffen das Warmwasser.')
  if (info.scope === 'full') {
    // Nr. 1 a: mit einem weiteren Erzeuger oder ohne Kilowattstunden sind die Anteile unbekannt.
    const known = info.carriers.length > 0 && info.carriers.every((c) => c.percent !== null)
    lines.push(known
      ? `Eingesetzte Energieträger: ${info.carriers.map((c) => `${ENERGY_TEXT[c.energy]} ${n(c.percent ?? 0, 1)} %`).join(', ')}`
      : `Eingesetzte Energieträger: ${info.carriers.map((c) => ENERGY_TEXT[c.energy]).join(', ')}${info.mixedGeneration ? ' und ein weiterer Wärmeerzeuger' : ''}; die Anteile liegen Mietfuchs nicht vor`)
    if (info.district) {
      const ghg = info.district.ghg === null ? 'nicht angegeben' : `${n(info.district.ghg)} g CO₂-Äquivalent je kWh${info.district.annualKg !== null ? `, in dieser Heizperiode zusammen ${n(info.district.annualKg, 0)} kg CO₂-Äquivalent` : ''}`
      lines.push(`Fernwärme laut Versorger: Treibhausgasemissionen ${ghg}; Primärenergiefaktor des Netzes ${info.district.pef === null ? 'nicht angegeben' : n(info.district.pef)}`)
    }
    lines.push(`Steuern, Abgaben und Zölle laut Rechnung: ${info.taxesText ?? 'nicht angegeben'}`)
    lines.push(`Entgelte für Erfassungsgeräte, Eichung, Ablesung und Abrechnung: ${fmtEuro(info.meteringCents)}`)
  }
  lines.push(`Informationen zum Energiesparen, zu Vergleichsprofilen und zu energiebetriebenen Geräten (Stand ${germanDate(info.contactsChecked)}):`)
  for (const c of info.contacts) lines.push(`${c.name}, ${c.url} – ${c.what}`)
  if (info.dispute.kind === 'text') lines.push(`Streitbeilegung: ${info.dispute.text}`)
  return lines
}

export type Comparison = { lines: string[]; bars: { label: string; unit: string; now: number; prev: number }[] }

export function comparisonOf(info: HeatingInfoStatement, tenancyId: string): Comparison | null {
  const u = info.users.find((x) => x.tenancyId === tenancyId)
  if (!u) return null
  const lines: string[] = []
  const bars: Comparison['bars'] = []
  const h = u.heating
  // Nr. 4: Durchschnittsnutzer aus dem Vergleichswert mit Quelle; kein Hausdurchschnitt.
  if (h && h.now !== null && h.referenceKwh !== null && info.reference) {
    lines.push(`Ihr Wärmeverbrauch: ${n(h.now, 0)} kWh${h.estimated ? ' (geschätzt nach § 9a HeizkostenV)' : ''}; Durchschnittsnutzer: ${n(h.referenceKwh, 0)} kWh (${n(info.reference.kwhPerM2)} kWh je m² Wohnfläche, Quelle: ${info.reference.source}; auf Ihre Wohnfläche und Ihre ${u.days} Tage umgerechnet)`)
  }
  // Nr. 5: Wärme witterungsbereinigt, Warmwasser unbereinigt; mit den Tagen beider Zeiträume.
  const days = u.prevDays !== null && u.prevDays !== u.days ? ` (${u.days} Tage, vorhergehender Zeitraum ${u.prevDays} Tage)` : ''
  if (h && h.nowAdjusted !== null && h.prevAdjusted !== null) {
    lines.push(`Heizung, witterungsbereinigt mit den Klimafaktoren ${n(info.climate.factor ?? 0)} und ${n(info.climate.factorPrev ?? 0)}${info.climate.source ? ` (${info.climate.source})` : ''}: dieser Zeitraum ${n(h.nowAdjusted, 0)} ${info.units.heating}, vorhergehender Zeitraum ${n(h.prevAdjusted, 0)} ${info.units.heating}${days}`)
    bars.push({ label: 'Heizung, witterungsbereinigt', unit: info.units.heating, now: h.nowAdjusted, prev: h.prevAdjusted })
  }
  const w = u.water
  if (w && w.now !== null && w.prev !== null) {
    lines.push(`Warmwasser (nicht witterungsbereinigt): dieser Zeitraum ${n(w.now)} ${info.units.water}, vorhergehender Zeitraum ${n(w.prev)} ${info.units.water}${h ? '' : days}`)
    bars.push({ label: 'Warmwasser', unit: info.units.water, now: w.now, prev: w.prev })
  }
  if (u.firstPeriod) lines.push('Für den vorhergehenden Abrechnungszeitraum liegt für Sie kein Verbrauch vor, weil Sie damals noch nicht hier wohnten.')
  if (u.ghgKg !== null) lines.push(`Ihr Anteil an den Treibhausgasemissionen der Fernwärme: ${n(u.ghgKg, 0)} kg CO₂-Äquivalent`)
  return { lines, bars }
}

// Breiten in Prozent des größeren Werts, für die Balken (§ 6a Abs. 3 Satz 1 Nr. 5: „in grafischer Form“).
export function barWidths(values: readonly number[]): number[] {
  const max = Math.max(...values, 0)
  return values.map((v) => (max > 0 ? (v / max) * 100 : 0))
}
