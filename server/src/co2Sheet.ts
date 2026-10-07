// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9 des Plans): je Rechnung,
// die die Heizperiode berührt, die Angaben des § 3 Abs. 1 Nr. 1–4 CO2KostAufG (kg, CO₂-Kosten,
// Emissionsfaktor, Energiegehalt) und was der Messdienst für die Einstufung braucht (Fläche, § 8, § 9,
// § 2 Abs. 4, Vorrat). Abgegrenzt wird nicht: Der Messdienst rechnet über seinen Zeitraum selbst und
// braucht die Rechnungen, wie sie sind. Das Blatt gibt es für jede Anlage mit Lieferungen, nicht nur beim
// Messdienst; auch die Gemeinschaft oder ein Steuerberater braucht es.
//
// Die Summe zählt nur, was auch die Abrechnung zählt (Durchsicht von #246, G-W1, G-W2): Eine stornierte
// Rechnung und eine von Rechnungen abgedeckte Schätzung gar nicht (`cancelledDeliveries`,
// `estimateFactors` aus fuel.ts, dieselbe Auswahl wie die Bewertung), eine Rechnung vor dem 01.01.2023
// nur mit ihren kg (§ 11 Abs. 2 Satz 2), den Anfangsbestand mit seinen CO₂-Kosten nach derselben Regel.
// Was nicht zählt, bleibt sichtbar und sagt warum. Die Texte stehen in der dritten Person: Das Blatt geht
// an Dritte.
import { servesUnit } from '../../shared/heatingPeriod.ts'
import { co2CostsBefore, co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { createLawLog, germanDate, valueAt } from '../../shared/law/register.ts'
import type { Co2Sheet, Co2SheetDelivery, Co2SheetStock, FuelDelivery, HeatingPlant, LawOverride, Unit } from '../../shared/types.ts'
import { co2Plausibility, etsExempt, plausibilityText } from './co2Plausibility.ts'
import { cancelledDeliveries, estimateFactors, rangeOf, type FuelItem } from './fuel.ts'

export type Co2SheetInput = {
  propertyName: string
  address: string
  landlordName: string
  plant: Pick<HeatingPlant, 'id' | 'name' | 'energy' | 'method' | 'units' | 'nonResidential' | 'restriction' | 'districtEtsNew'>
  h: { key: string; from: string; to: string }
  units: readonly Pick<Unit, 'id' | 'areaM2' | 'noConnection'>[]
  enteredAreaM2: number | null
  stock: Co2SheetStock | null
  deliveries: readonly FuelDelivery[]
  // Die Kostenpositionen, die auf eine Lieferung zeigen: ihre Summe ist der Betrag einer Rechnung ohne
  // eingetragenen Betrag, und ergibt sie 0, ist die Rechnung storniert.
  items: readonly FuelItem[]
  overrides: readonly LawOverride[]
  // Der Tag, an dem das Blatt entsteht (R-K6).
  today: string
}

const fmtCents = (c: number): string => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const pct = (f: number): string => `${(f * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`

// Ob die CO₂-Kosten einer Rechnung zählen (§ 11 Abs. 2 Satz 2): am Rechnungsdatum, ohne es am Liefertag
// (wie die Bestandsrechnung, Heizung PR 8). Fehlt beides, kann die Rechnung nicht vor dem Ende ihres
// Zeitraums gestellt sein; liegt das vor 2023, ist es offen (`null`).
function costsCount(d: Pick<FuelDelivery, 'invoiceDate' | 'deliveredAt' | 'invoiceTo'>): boolean | null {
  const invoiced = d.invoiceDate ?? d.deliveredAt
  if (invoiced !== null) return !valueAt(co2CostsBefore, invoiced)
  if (d.invoiceTo !== null && !valueAt(co2CostsBefore, d.invoiceTo)) return true
  return null
}

export function co2SheetOf(i: Co2SheetInput): Co2Sheet {
  const mine = i.deliveries.filter((d) => d.plantId === i.plant.id)
  const touching = mine.filter((d) => {
    const r = rangeOf(d)
    return r !== null && r.from <= i.h.to && r.to >= i.h.from
  })
  const cancelled = cancelledDeliveries(i.plant.method, mine, i.items)
  const factors = estimateFactors(mine.filter((d) => rangeOf(d) !== null), cancelled, valueAt(hkvDegreeDays, i.h.from))
  // Bei Wärme aus dem Emissionshandel mit Anschluss nach dem Stichtag gilt das Gesetz nicht (§ 2 Abs. 4
  // Satz 2): keine Prüfung, dieselbe Regel wie in der Abrechnung (R-W1).
  const checked = !etsExempt(i.plant)
  const log = createLawLog(i.overrides)
  const from = germanDate(co2CostsCountedFrom())
  const deliveries: Co2SheetDelivery[] = touching.map((d) => {
    const linked = i.items.filter((c) => c.fuelDeliveryId === d.id)
    const amountCents = d.amountCents ?? (linked.length > 0 ? linked.reduce((a, c) => a + c.amountCents, 0) : null)
    const factor = d.estimated ? (factors.get(d.id) ?? 1) : 1
    const costs = costsCount(d)
    const [counted, note]: [Co2SheetDelivery['counted'], string | null] =
      cancelled.has(d.id) ? ['none', 'Storniert: Die Kostenpositionen dieser Rechnung ergeben 0 €; sie zählt nicht.']
        : d.estimated && factor === 0 ? ['none', 'Schätzung, die durch Rechnungen über denselben Zeitraum abgedeckt ist; sie zählt nicht.']
          : costs === false ? ['kgOnly', `Vor dem ${from} in Rechnung gestellt: Die kg zählen für die Einstufung, die CO₂-Kosten bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2 CO2KostAufG).`]
            : costs === null ? ['kgOnly', `Ohne Rechnungsdatum: Ob die CO₂-Kosten zählen, hängt davon ab, ob die Rechnung vor dem ${from} gestellt wurde (§ 11 Abs. 2 Satz 2 CO2KostAufG); gezählt sind nur die kg.`]
              : d.estimated && factor < 1 ? ['partial', `Schätzung, zählt nur für die Tage ohne Rechnung (${pct(factor)} nach Gradtagen).`]
                : d.estimated ? ['full', 'Schätzung, weil die Rechnung fehlt.'] : ['full', null]
    return {
      id: d.id, label: d.label, invoiceDate: d.invoiceDate, from: d.invoiceFrom, to: d.invoiceTo, deliveredAt: d.deliveredAt,
      quantity: d.quantity, quantityUnit: d.quantityUnit, energyKwh: d.energyKwh, gasBasis: d.gasBasis, emissionFactor: d.emissionFactor,
      emissionsKg: d.emissionsKg, co2CostCents: d.co2CostCents, amountCents, estimated: d.estimated, counted, factor, note,
      findings: checked && counted !== 'none' ? co2Plausibility(d, i.plant.energy, log).map((f) => plausibilityText(f, fmtCents)) : [],
    }
  })
  // Der Anfangsbestand (Vorrat, Heizung PR 8): seine kg zählen immer, seine CO₂-Kosten nicht, wenn er vor
  // 2023 in Rechnung gestellt oder schon mit einer früheren Abrechnung umgelegt wurde (wie die Bestandsrechnung).
  const s = i.stock
  const opening = s && s.openingEmissionsKg !== null
    ? (() => {
        const before = s.openingInvoicedBefore2023 === true
        const settled = s.openingAlreadySettled === true
        return {
          emissionsKg: s.openingEmissionsKg ?? 0,
          co2CostCents: s.openingCo2Cents,
          co2Counted: !before && !settled,
          note: before ? `Vor dem ${from} in Rechnung gestellt: Die CO₂-Kosten bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2 CO2KostAufG).`
            : settled ? 'Schon mit einer früheren Abrechnung umgelegt: Die CO₂-Kosten zählen hier nicht mehr, die kg für die Einstufung.' : null,
        }
      })()
    : null
  // Fläche der Einstufung (Entwurf 9.2): eingetragen, sonst die Wohnfläche der versorgten Wohnungen.
  const served = i.units.filter((u) => servesUnit(i.plant, u)).reduce((a, u) => a + (u.areaM2 > 0 ? u.areaM2 : 0), 0)
  const area = i.enteredAreaM2 ?? (served > 0 ? served : null)
  const kg = deliveries.reduce((a, d) => a + (d.counted === 'none' ? 0 : (d.emissionsKg ?? 0) * d.factor), opening?.emissionsKg ?? 0)
  const co2 = deliveries.reduce((a, d) => a + (d.counted === 'full' || d.counted === 'partial' ? (d.co2CostCents ?? 0) * d.factor : 0), opening?.co2Counted ? (opening.co2CostCents ?? 0) : 0)
  return {
    propertyName: i.propertyName, address: i.address, landlordName: i.landlordName,
    plantName: i.plant.name, energy: i.plant.energy, createdOn: i.today, checked,
    period: { key: i.h.key, from: i.h.from, to: i.h.to },
    areaM2: area, areaSource: i.enteredAreaM2 !== null ? 'entered' : area !== null ? 'served' : null,
    nonResidential: i.plant.nonResidential, restriction: i.plant.restriction, districtEtsNew: i.plant.districtEtsNew,
    stock: i.stock, opening, deliveries,
    totals: { emissionsKg: Math.round(kg * 100) / 100, co2CostCents: Math.round(co2) },
  }
}
