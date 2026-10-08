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
import { plantRules, servesUnit, settledSeparately } from '../../shared/heatingPeriod.ts'
import { periodContaining, rulesOf } from '../../shared/period.ts'
import { co2CostsBefore, co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { createLawLog, germanDate, valueAt } from '../../shared/law/register.ts'
import type { BillingPeriod, Co2Sheet, Co2SheetBilling, Co2SheetDelivery, Co2SheetOpening, Co2SheetStock, FuelDelivery, HeatingPlant, HeatingStatement, LawOverride, Unit } from '../../shared/types.ts'
import { computeSettlement, plantStockOf } from './calc.ts'
import type { StockResult } from './fuelStock.ts'
import { heatingSnapshotFor, snapshotFor, wayOf } from './snapshot.ts'
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
  // Die Bestandsrechnung der Abrechnung für diese Heizperiode (`plantStockOf`); `null` ohne Vorrat.
  stockResult?: StockResult | null
  // Die Anlage in der Abrechnung, in der diese Heizperiode steht (Runde 3, S-W1); fehlt, wenn es keine gibt.
  heating?: HeatingStatement | null
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
      inPeriod: (() => {
        const line = i.heating?.fuel?.deliveries.find((l) => l.deliveryId === d.id)
        return line ? { emissionsKg: line.emissionsKg, co2Cents: line.co2Cents, sharePermille: line.sharePermille, method: line.method } : null
      })(),
      findings: checked && counted !== 'none' ? co2Plausibility(d, i.plant.energy, log).map((f) => plausibilityText(f, fmtCents)) : [],
    }
  })
  // Der Anfangsbestand eines Vorrats (G-W2): Das Blatt hat dafür keine eigene Regel, sondern liest die
  // Bestandsrechnung der Abrechnung (`plantStockOf` in calc.ts, Nachprüfung von #246, O2a/O2b). Rechnet sie
  // den Vorrat, zählt das Blatt genau ihren Anfangsbestand (kg, und die CO₂-Kosten, soweit sie berücksichtigt
  // sind). Rechnet sie ihn nicht, weil eine Angabe fehlt, bleibt die Zeile sichtbar und zählt nicht. Die
  // Spalte CO₂-Kosten zeigt wie bei den Rechnungen den eingetragenen Betrag (Runde 3, S-K1); gedruckt wird
  // nur ein Satz in der dritten Person, die Gründe für den Vermieter stehen in `adminNote` (W-N4).
  const r = i.stockResult ?? null
  const row = i.stock
  const where = (label: string) => (label ? ` (Heizperiode ${label})` : '')
  const count = (n: number) => (n === 1 ? 'eine Angabe' : n === 2 ? 'zwei Angaben' : n === 3 ? 'drei Angaben' : `${n} Angaben`)
  const opening: Co2SheetOpening | null = r === null
    ? null
    : r.ok
      ? (() => {
          const v = r.statement.opening
          if (v.layers.length === 0) return null
          const settled = r.statement.openingSettledSource !== undefined
          const counted = v.layers.some((l) => l.co2Counted)
          const own = r.statement.openingSource === 'own'
          const note = settled ? 'Schon mit einer früheren Abrechnung umgelegt: Die CO₂-Kosten zählen hier nicht mehr, die kg für die Einstufung.'
            : !counted ? `Vor dem ${from} in Rechnung gestellt: Die CO₂-Kosten bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2 CO2KostAufG).` : null
          return {
            quantity: v.quantity, emissionsKg: v.emissionsKg, co2CostCents: own && row?.openingCo2Cents != null ? row.openingCo2Cents : v.co2Cents, countedCents: v.co2Cents,
            kgCounted: true, co2Counted: counted, note, adminNote: null, source: own ? 'entered' : 'carried',
          }
        })()
      : row && (row.openingQuantity !== null || row.openingEmissionsKg !== null)
        ? {
            quantity: row.openingQuantity, emissionsKg: row.openingEmissionsKg, co2CostCents: row.openingCo2Cents, countedCents: 0, kgCounted: false, co2Counted: false, source: 'entered',
            note: r.problem.kind === 'missing'
              ? `Nicht berücksichtigt: Für die Bestandsrechnung des Vorrats${where(r.problem.period)} ${r.problem.what.length === 1 ? 'fehlt' : 'fehlen'} ${count(r.problem.what.length)} (${r.problem.what.join('; ')}). Ohne sie rechnet auch die Abrechnung den Vorrat nicht.`
              : `Nicht berücksichtigt: Die Bestandsrechnung des Vorrats${where(r.problem.period)} geht nicht auf.`,
            adminNote: r.problem.kind === 'invalid' ? `Die Bestandsrechnung geht nicht auf: ${r.problem.reasons.join('; ')}.` : null,
          }
        : null
  // Was die Abrechnung der Heizperiode daraus macht (Runde 3, S-W1), gelesen aus ihrem Ergebnis: Endbestand
  // und Verbrauch aus der Bestandsrechnung, die abgegrenzten Rechnungen, die Grundlage der CO₂-Aufteilung.
  const hs = i.heating ?? null
  const stockStatement = hs?.stock ?? (r?.ok ? r.statement : null)
  const fuel = hs?.fuel
  const co2 = hs?.co2 ?? null
  const billing: Co2SheetBilling = {
    closing: stockStatement ? { quantity: stockStatement.closing.quantity, emissionsKg: stockStatement.closing.emissionsKg, co2Cents: stockStatement.closing.co2Cents, measuredOn: stockStatement.closingMeasuredOn } : null,
    consumed: stockStatement ? { quantity: stockStatement.consumed.quantity, emissionsKg: stockStatement.consumed.emissionsKg, co2Cents: stockStatement.consumed.co2Cents } : null,
    inPeriod: fuel && fuel.deliveries.length > 0
      ? {
          // Die Summe der abgegrenzten Teile; die CO₂-Kosten nimmt die Abrechnung ungerundet zusammen und rundet
          // einmal, deshalb ihr Wert und nicht die Summe der gerundeten Zeilen.
          emissionsKg: fuel.deliveries.reduce((a, l) => a + (l.emissionsKg ?? 0), 0),
          co2Cents: fuel.co2Cents ?? fuel.deliveries.reduce((a, l) => a + (l.co2Cents ?? 0), 0),
          coveragePermille: fuel.coveragePermille,
        }
      : null,
    basis: co2 && (co2.basis === 'stock' || co2.basis === 'deliveries')
      ? { source: co2.basis, emissionsKg: co2.emissionsKg, co2Cents: co2.totalCents, kgPerM2: co2.kgPerM2, areaM2: co2.areaM2, landlordPermille: co2.landlordPermille, stage: co2.stage }
      : null,
  }
  // Fläche der Einstufung (Entwurf 9.2): Stuft die Abrechnung ein, ihre Fläche (Runde 4: eine Quelle). Bei
  // mehreren Anlagen eines Gebäudes ist das die gemeinsame (`jointAreaOf` in calc.ts, § 5 Abs. 1 Satz 2
  // CO2KostAufG), nicht die der eigenen Wohnungen. Sonst eingetragen, sonst die der versorgten Wohnungen.
  const served = i.units.filter((u) => servesUnit(i.plant, u)).reduce((a, u) => a + (u.areaM2 > 0 ? u.areaM2 : 0), 0)
  const own = i.enteredAreaM2 ?? (served > 0 ? served : null)
  const ownSource: Co2Sheet['areaSource'] = i.enteredAreaM2 !== null ? 'entered' : own !== null ? 'served' : null
  const billed = co2 && co2.areaM2 !== null ? co2.areaM2 : null
  const area = billed ?? own
  const areaSource: Co2Sheet['areaSource'] = billed === null ? ownSource
    : own !== null && Math.abs(billed - own) < 0.005 ? (co2?.areaSource ?? ownSource) : 'building'
  const kg = deliveries.reduce((a, d) => a + (d.counted === 'none' ? 0 : (d.emissionsKg ?? 0) * d.factor), opening?.kgCounted ? (opening.emissionsKg ?? 0) : 0)
  const co2Sum = deliveries.reduce((a, d) => a + (d.counted === 'full' || d.counted === 'partial' ? (d.co2CostCents ?? 0) * d.factor : 0), opening?.countedCents ?? 0)
  return {
    propertyName: i.propertyName, address: i.address, landlordName: i.landlordName,
    plantName: i.plant.name, energy: i.plant.energy, createdOn: i.today, checked,
    period: { key: i.h.key, from: i.h.from, to: i.h.to },
    areaM2: area, areaSource,
    nonResidential: i.plant.nonResidential, restriction: i.plant.restriction, districtEtsNew: i.plant.districtEtsNew,
    stock: i.stock, opening, billing, deliveries,
    totals: { emissionsKg: Math.round(kg * 100) / 100, co2CostCents: Math.round(co2Sum) },
  }
}

// Das Blatt aus dem Bestand, wie die Route es baut: dieselben Daten und dieselbe Bestandsrechnung wie die
// Abrechnung der Heizperiode. `null` ohne Anlage.
export function co2SheetFor(
  source: Parameters<typeof heatingSnapshotFor>[0] & {
    heatingPlants?: (Pick<HeatingPlant, 'id' | 'energy' | 'method' | 'units' | 'propertyId'> & Partial<Pick<HeatingPlant, 'name' | 'nonResidential' | 'restriction' | 'districtEtsNew'>>)[]
    fuelDeliveries?: FuelDelivery[]
    lawOverrides?: LawOverride[]
  },
  propertyId: string,
  plantId: string,
  h: BillingPeriod,
  today: string,
  meta: { propertyName: string; address: string; landlordName: string } = { propertyName: '', address: '', landlordName: '' },
): Co2Sheet | null {
  const plant = (source.heatingPlants ?? []).find((p) => p.id === plantId && p.propertyId === propertyId)
  const snap = plant ? heatingSnapshotFor(source, propertyId, plantId, h) : null
  if (!plant || !snap) return null
  const key = String(h.key)
  const statement = (source.co2Statements ?? []).find((x) => x.plantId === plantId && x.period === h.key && (x.method === 'self' || x.method === 'selfAfterService'))
  const row = (source.heatingPeriodRows ?? []).find((x) => x.plantId === plantId && x.period === h.key)
  const found = plantStockOf(snap, plant, key, (date) => !valueAt(co2CostsBefore, date))
  // Die Abrechnung, in der diese Heizperiode steht: nach Weg d ihre eigene Heizkostenabrechnung, sonst die
  // Abrechnung des Objektzeitraums, der ihr Ende enthält (Entwurf 3.0). Gelesen wird ihre Anlage.
  const objectRules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  const separate = settledSeparately(wayOf(plant), objectRules, h)
  const settled = separate ? computeSettlement(snap) : computeSettlement(snapshotFor(source, propertyId, periodContaining(objectRules, h.to)))
  const heating = (settled.heating ?? []).find((x) => x.plantId === plantId && String(x.period) === key) ?? null
  return co2SheetOf({
    ...meta,
    plant: { ...plant, name: plant.name ?? '', nonResidential: plant.nonResidential ?? false, restriction: plant.restriction ?? 'none', districtEtsNew: plant.districtEtsNew ?? false },
    h: { key, from: h.from, to: h.to },
    units: source.units.filter((u) => u.propertyId === propertyId),
    enteredAreaM2: statement?.areaM2 ?? null,
    stock: row && row.stockUnit != null ? {
      stockUnit: row.stockUnit, openingQuantity: row.openingQuantity ?? null, openingEmissionsKg: row.openingEmissionsKg ?? null, openingCo2Cents: row.openingCo2Cents ?? null,
      openingInvoicedBefore2023: row.openingInvoicedBefore2023 ?? null, openingAlreadySettled: row.openingAlreadySettled ?? null, closingQuantity: row.closingQuantity ?? null, closingMeasuredOn: row.closingMeasuredOn ?? null,
    } : null,
    stockResult: found?.result ?? null,
    heating,
    deliveries: source.fuelDeliveries ?? [],
    items: source.costItems.flatMap((c) => (c.fuelDeliveryId ? [{ id: c.id, period: String(c.period), amountCents: c.amountCents, fuelDeliveryId: c.fuelDeliveryId }] : [])),
    overrides: source.lawOverrides ?? [],
    today,
  })
}
