// Zufällige Bestände für die Steuerübersicht (#255, PR 1), mit festem Startwert. Geprüft wird damit, dass das Jahr der
// Zahlung an einer Stelle (`outflowShares`) dieselben Zahlen ergibt wie vorher; deshalb deckt der Generator jede Lage
// ab, in der die Auswahl der Positionen je Steuerjahr verschieden läuft: Kalenderjahr, Mai bis April, ein Wechsel des
// Rhythmus mit Rumpfzeitraum in beide Richtungen, eine Anlage ohne eigene Heizperiode, mit eigener (Weg b) und mit
// getrennter Heizkostenabrechnung (Weg d), Eigennutzung und Einheiten außerhalb, Gutschriften, Rücklage, Lohnanteil,
// Abzüge beim Betriebsstrom samt Heizposition „steckt auch in der Stromrechnung“, und abgeschlossene Zeiträume.
//
// **Nur Bestände, die die Datenbank annimmt**: Das Jahr der Zahlung steht nur an Positionen, deren Zeitraum über zwei
// Kalenderjahre reicht, und liegt dann zwischen dem Jahr des Beginns und dem auf das Ende folgenden
// (`requireTaxYear` in db/repository.ts); in einem Kalenderjahr fehlt es oder ist das Jahr des Beginns.
import type { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodsBetween } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, CostKey, PeriodRules } from '../../shared/types.ts'

// Kennungen der Zahlungen (#281: Die Tilgung braucht sie als Nachrang beim Sortieren).
let paymentSeq = 0
const pid = (): string => `p${String(++paymentSeq).padStart(4, '0')}`


export type TaxSource = Parameters<typeof snapshotFor>[0]
type Item = TaxSource['costItems'][number]
type Plant = NonNullable<TaxSource['heatingPlants']>[number]

export const TAX_STOCK_PROPERTY = 'objekt-1'
// Die Steuerjahre, über die geprüft wird: eines vor dem ersten Zeitraum bis eines nach dem letzten.
export const TAX_STOCK_YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029]

export function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

export type TaxStock = { source: TaxSource; rules: PeriodRules; periods: BillingPeriod[]; plantMode: 'none' | 'object' | 'own' | 'separate' }

export function randomTaxStock(rnd: () => number): TaxStock {
  const pick = <T>(a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))] as T
  const cents = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100)
  const rules: PeriodRules = pick([
    CALENDAR_RULES, CALENDAR_RULES, { startMonth: 5, changes: [] }, { startMonth: 1, changes: ['2026-05'] }, { startMonth: 5, changes: ['2027-01'] }, { startMonth: 10, changes: [] },
  ])
  const plantMode = pick(['none', 'object', 'own', 'separate'] as const)
  const plantStart = pick([5, 10])
  // Öl mit Vorrat: Der Übertrag aus dem Vorrat geht nach dem Jahr der Zahlung des Brennstoffs (`carryShareCents`).
  const oil = plantMode !== 'none' && rnd() < 0.4
  const unitCount = 2 + Math.floor(rnd() * 3)
  const units: TaxSource['units'] = Array.from({ length: unitCount }, (_, i) => {
    const r = rnd()
    const self = i > 0 && r < 0.35
    const out = !self && i > 0 && r < 0.45
    return { id: `u${i}`, propertyId: TAX_STOCK_PROPERTY, name: `W${i}`, areaM2: 30 + Math.floor(rnd() * 80), participates: !self && !out, ...(self ? { selfUsed: true, selfPersons: 1 + Math.floor(rnd() * 3) } : {}) }
  })
  const tenancies: TaxSource['tenancies'] = units.filter((u) => u.participates).map((u) => {
    const persons = 1 + Math.floor(rnd() * 3)
    return {
      id: `t-${u.id}`, unitId: u.id, tenantName: u.id, persons, personHistory: [{ from: '2020-01-01', persons }], start: '2020-01-01', end: null,
      prepayments: [{ from: '2020-01', monthlyCents: cents(50, 300) }], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: cents(300, 900) }],
    }
  })
  const periods = periodsBetween(rules, '2024-01-01', '2028-12-31')
  const yearsOf = (p: Pick<BillingPeriod, 'from' | 'to'>) => [Number(p.from.slice(0, 4)), Number(p.to.slice(0, 4))] as const
  // Das Jahr der Zahlung, wie die Datenbank es annimmt (siehe oben).
  const taxYearFor = (p: Pick<BillingPeriod, 'from' | 'to'>): { taxYear?: number } => {
    const [s, e] = yearsOf(p)
    if (s === e) return rnd() < 0.2 ? { taxYear: s } : {}
    return { taxYear: s + Math.floor(rnd() * (e - s + 2)) }
  }
  const key = (): CostKey => pick(['area', 'area', 'units', 'persons'] as const)
  const items: Item[] = []
  const add = (c: Omit<Item, 'propertyId'>) => items.push({ ...c, propertyId: TAX_STOCK_PROPERTY } as Item)
  const included: string[] = []
  for (const P of periods) {
    const pk = P.key
    add({ id: `gs${pk}`, period: pk, category: 'Grundsteuer', description: `Grundsteuer ${pk}`, amountCents: cents(300, 900), key: 'area', ...taxYearFor(P) })
    add({ id: `vs${pk}`, period: pk, category: 'Sach- und Haftpflichtversicherung', description: `Versicherung ${pk}`, amountCents: cents(500, 1500), key: key(), ...taxYearFor(P) })
    add({ id: `ww${pk}`, period: pk, category: 'Wasser/Abwasser', description: `Wasser ${pk}`, amountCents: cents(300, 900), key: 'persons', ...taxYearFor(P) })
    add({ id: `hs${pk}`, period: pk, category: 'Beleuchtung/Allgemeinstrom', description: `Hausstrom ${pk}`, amountCents: cents(300, 2000), key: key(), ...taxYearFor(P) })
    if (rnd() < 0.5) add({ id: `gr${pk}`, period: pk, category: 'Gartenpflege', description: `Garten ${pk}`, amountCents: cents(200, 800), key: 'area', labor35aCents: cents(50, 150), ...taxYearFor(P) })
    if (rnd() < 0.4) add({ id: `nu${pk}`, period: pk, category: 'Nicht umlagefähig', description: `Reparatur ${pk}`, amountCents: cents(100, 2000), key: 'area', ...(rnd() < 0.5 ? { participantUnitIds: [pick(units).id] } : {}), ...taxYearFor(P) })
    if (rnd() < 0.3) add({ id: `rl${pk}`, period: pk, category: 'Zuführung Erhaltungsrücklage', description: `Rücklage ${pk}`, amountCents: cents(100, 600), key: 'area', ...taxYearFor(P) })
    if (rnd() < 0.3) add({ id: `gu${pk}`, period: pk, category: 'Wasser/Abwasser', description: `Gutschrift Wasser ${pk}`, amountCents: -cents(10, 200), key: 'persons', ...taxYearFor(P) })
    if (plantMode === 'object') {
      add({ id: `gas${pk}`, period: pk, category: HEATING_CATEGORY, description: `Gas ${pk}`, amountCents: cents(1000, 6000), key: key(), heatingPlantId: 'hp1', heatingPart: 'fuel', ...taxYearFor(P) })
      if (rnd() < 0.6) {
        add({ id: `bs${pk}`, period: pk, category: HEATING_CATEGORY, description: `Betriebsstrom ${pk}`, amountCents: cents(30, 300), key: 'area', heatingPlantId: 'hp1', heatingPart: 'operating', operatingPower: 'included', ...taxYearFor(P) })
        included.push(`bs${pk}`)
      }
    }
    const nd = Math.floor(rnd() * 3)
    for (let k = 0; k < nd; k++) {
      const link = included.length > 0 && rnd() < 0.5 ? pick(included) : undefined
      add({
        id: `ab${pk}-${k}`, period: pk, category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${pk}-${k}`, amountCents: -cents(10, 150), key: 'units',
        operatingPower: 'deduction', operatingPowerGeneralId: `hs${pk}`, ...(link ? { operatingPowerItemId: link } : {}), ...taxYearFor(P),
      })
    }
  }
  const own = plantMode === 'own' || plantMode === 'separate'
  if (own) {
    // Heizpositionen in der eigenen Heizperiode; bei Weg d getrennt abgerechnet ab der ersten.
    for (const h of periodsBetween({ startMonth: plantStart, changes: [] }, '2024-01-01', '2028-12-31')) {
      add({ id: `gas${h.key}`, period: h.key, category: HEATING_CATEGORY, description: `Gas ${h.key}`, amountCents: cents(1000, 6000), key: key(), heatingPlantId: 'hp1', heatingPart: 'fuel', ...taxYearFor(h) })
      if (rnd() < 0.5) add({ id: `wa${h.key}`, period: h.key, category: HEATING_CATEGORY, description: `Wartung ${h.key}`, amountCents: cents(100, 400), key: 'area', heatingPlantId: 'hp1', labor35aCents: cents(20, 90), ...taxYearFor(h) })
      if (rnd() < 0.3) add({ id: `hg${h.key}`, period: h.key, category: HEATING_CATEGORY, description: `Gutschrift Heizung ${h.key}`, amountCents: -cents(10, 300), key: 'area', heatingPlantId: 'hp1', heatingPart: 'fuel', ...taxYearFor(h) })
    }
  }
  const plants: Plant[] = plantMode === 'none' ? [] : [{
    id: 'hp1', propertyId: TAX_STOCK_PROPERTY, name: 'Kessel', method: 'manual', source: 'building', supply: 'central', energy: oil ? 'oil' : 'gas', devicesRemote: 'unknown',
    devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, periodStartMonth: own ? plantStart : null, periodChanges: [],
    separateSpans: plantMode === 'separate' ? [{ from: `2024-${String(plantStart).padStart(2, '0')}`, until: null }] : [],
    separateSettlement: plantMode === 'separate', endsOn: null, replacesPlantId: null,
  } as Plant]
  const firstHeating = own ? periodsBetween({ startMonth: plantStart, changes: [] }, '2024-01-01', '2024-12-31')[0] : periods[0]
  const heatingPeriodRows: NonNullable<TaxSource['heatingPeriodRows']> = oil && firstHeating ? [{
    plantId: 'hp1', period: firstHeating.key, dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: 1000, openingCostCents: 95000,
    openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: false, openingAlreadySettled: false,
    closingQuantity: 300 + Math.floor(rnd() * 600), closingMeasuredOn: firstHeating.to,
  } as NonNullable<TaxSource['heatingPeriodRows']>[number]] : []
  const source = {
    properties: [{ id: TAX_STOCK_PROPERTY, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
    units, tenancies, costItems: items, meters: [], readings: [],
    payments: tenancies.map((t, i) => ({ id: pid(), tenancyId: t.id, date: `${2024 + (i % 4)}-03-01`, amountCents: cents(500, 3000) })),
    closedSettlements: [], heatingPlants: plants, heatingPeriodRows,
  } as TaxSource
  return { source, rules, periods, plantMode }
}

// Ein zweites Objekt in derselben Ablage (Durchsicht K4): Die Steuerübersicht und das Steuer-ZIP grenzen über
// `snapshotFor`/`narrowToProperty` ein, und ein Fehler dort ergäbe Werbungskosten zweier Häuser. Das zweite Objekt
// entsteht mit einem eigenen Startwert aus demselben Generator, Kennungen mit Vorsatz `b-`, damit das erste Objekt
// genau der Bestand ohne es bleibt. Ein Objekt teilt sich mit dem anderen keine Wohnung, keinen Zähler und keine Anlage.
export const TAX_STOCK_SECOND = 'objekt-2'
export function withSecondProperty(stock: TaxStock, rnd: () => number): TaxStock & { second: TaxStock } {
  const b = randomTaxStock(rnd)
  const id = (x: string) => `b-${x}`
  const P = TAX_STOCK_SECOND
  const s = b.source
  const items = s.costItems.map((c) => ({
    ...c, id: id(c.id), propertyId: P,
    ...(c.heatingPlantId ? { heatingPlantId: id(c.heatingPlantId) } : {}),
    ...(c.operatingPowerGeneralId ? { operatingPowerGeneralId: id(c.operatingPowerGeneralId) } : {}),
    ...(c.operatingPowerItemId ? { operatingPowerItemId: id(c.operatingPowerItemId) } : {}),
    ...(c.participantUnitIds ? { participantUnitIds: c.participantUnitIds.map(id) } : {}),
  }))
  const source = {
    ...stock.source,
    properties: [...(stock.source.properties ?? []), ...(s.properties ?? []).map((p) => ({ ...p, id: P }))],
    units: [...stock.source.units, ...s.units.map((u) => ({ ...u, id: id(u.id), propertyId: P }))],
    tenancies: [...stock.source.tenancies, ...s.tenancies.map((t) => ({ ...t, id: id(t.id), unitId: id(t.unitId) }))],
    costItems: [...stock.source.costItems, ...items],
    payments: [...stock.source.payments, ...s.payments.map((p) => ({ ...p, tenancyId: id(p.tenancyId) }))],
    heatingPlants: [...(stock.source.heatingPlants ?? []), ...(s.heatingPlants ?? []).map((p) => ({ ...p, id: id(p.id), propertyId: P }))],
    heatingPeriodRows: [...(stock.source.heatingPeriodRows ?? []), ...(s.heatingPeriodRows ?? []).map((r) => ({ ...r, plantId: id(r.plantId) }))],
  } as TaxSource
  return { ...stock, source, second: { ...b, source } }
}
