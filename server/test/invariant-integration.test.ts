// Invarianten über alle Heizungsmerkmale zugleich (Integrationsdurchsicht Geld vor 0.11.0), über zufällige Bestände
// mit festem Startwert. Die übrigen Zufallsinvarianten prüfen je ein Merkmal (calc.test.ts ohne Anlage,
// fuel-invariant.test.ts ohne Contracting, Selbstversorger, § 5a und Abzug, invariant-betriebsstrom-steuer.test.ts
// nur im Kalenderjahr); hier stehen sie nebeneinander: Objekt mit zwei bis vier Einheiten (vermietet, selbstgenutzt,
// außerhalb), Mieterwechsel mit Leerstand, Nebenkostenmodell kalt und Heizung getrennt (Abrechnung, Pauschale,
// Inklusivmiete, Mieter heizt selbst), Kalenderjahr oder Mai bis April, Gas, Öl, Pellets, Wärmepumpe, Fernwärme,
// Contracting, freie Schlüssel oder Messdienst, Kesseltausch, § 5a CO2KostAufG, Rechnungen nach Kalenderjahr
// (Überträge), Vorrat, Gutschrift ohne Rechnung, Betriebsstrom „steckt auch in der Stromrechnung“, Abzüge beim
// Allgemeinstrom mit und ohne Verweis, Wartung mit §35a, Gutschriften kalt, Jahr der Zahlung, CO₂-Erstattungen.
//
// Je Zeitraum und je Mieter:
//   S1 Σ Mieter + Vermieter = Gesamtkosten; S2 je Position Mieter + Vermieter = Betrag, keine fehlt, keine unbekannte
//   Zeile; S3 Vorzeichen wie die Position, Entlastungen nie positiv; S4 Zerlegung des Vermieteranteils geht auf;
//   S5 Pauschale und Inklusivmiete ohne Entlastung, Selbstversorger ohne Brennstoff der Anlage; S6 Entlastung höchstens
//   der getragene Brennstoff; S7 ganze Cent; S8 jede zum Verrechnen eingetragene Erstattung genau einmal, und ohne
//   Abrechnung des Mieters mit Hinweis (Durchsicht S1); S9 Entlastung im Verhältnis des Brennstoffs; S10 bezifferte
//   Kürzungen = Prozentsatz des Anteils, den der Mieter in dieser Abrechnung trägt (Durchsicht S2).
// Abgeschlossen (zufällige Zeiträume eingefroren): F1 eingefroren = heute; F2 der Abschluss ändert die Steuer nicht.
// Je Steuerjahr: T1 privat + abziehbar = Betrag, |privat| ≤ |Betrag| (Durchsicht M1); T2 Σ Zeilen = Werbungskosten;
//   T3 Strom und alles übrige = bezahlte Rechnungen; T4 ohne Eigennutzung nichts privat; T5 Übersicht.csv =
//   Steuerübersicht.
// Standard sind wenige Startwerte, damit der Lauf kurz bleibt; mehr mit INV_FROM/INV_TO (wie fuel-invariant.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxPartsFor, taxReportFor, type ComputedSettlement } from '../src/calc.ts'
import { frozenSettlementOf, snapshotFor } from '../src/snapshot.ts'
import { derivedTaxLines, planTaxArchive } from '../src/taxReceipts.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
import { assertLandlordParts } from '../testing/landlordParts.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, Co2Refund, CostItem, CostKey, FuelDelivery, HeatingEnergy, PeriodRules } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
type Item = Source['costItems'][number]
type Plant = NonNullable<Source['heatingPlants']>[number]
type Rng = () => number
function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
// Dazu je ein Startwert, an dem ein Befund der Durchsicht auffiel: 29 (M1, privater Teil des Ausgleichs über dem
// Betrag), 34 (S1, Erstattung zum Verrechnen ohne Abrechnung des Mieters) und 100 (S2, Kürzung ohne Übertrag).
const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : [...Array.from({ length: 12 }, (_, k) => k + 1), 29, 34, 100]
const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY)
const must = <T>(v: T | null | undefined, what: string): T => v ?? assert.fail(what)
const euroToCents = (s: string) => (s === '' ? 0 : Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100))
const synthetic = (id: string) => /^(co2|gmodg|fuel|co2refund|stock):/.test(id)

type Stock = Source & { fuelDeliveries: FuelDelivery[]; co2Refunds: Co2Refund[]; heatingPlants: Plant[] }
type Gen = { source: Stock; keys: string[]; rules: PeriodRules; years: number[] }

function gen(rnd: Rng): Gen {
  const pick = <T>(a: readonly T[]): T => {
    const i = Math.floor(rnd() * a.length)
    return i < a.length ? (a[i] as T) : assert.fail('leere Auswahl')
  }
  const cents = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100)
  const may = rnd() < 0.5
  const rules: PeriodRules = may ? { startMonth: 5, changes: [] } : CALENDAR_RULES
  const keys = may ? ['2026-05', '2027-05', '2028-05'] : ['2026-01', '2027-01', '2028-01', '2029-01']
  const periods: BillingPeriod[] = keys.map((k) => must(periodOfKey(rules, periodKey(k)), k))
  const first = must(periods[0], 'kein Zeitraum').from
  const last = must(periods[periods.length - 1], 'kein Zeitraum').to
  const span = (Date.parse(last) - Date.parse(first)) / DAY
  const unitCount = 2 + Math.floor(rnd() * 3)
  const units: Source['units'] = Array.from({ length: unitCount }, (_, i) => {
    const r = rnd()
    const self = i > 0 && r < 0.25
    const out = !self && i > 0 && r < 0.32
    return { id: `u${i}`, propertyId: 'objekt-1', name: `W${i}`, areaM2: 30 + Math.floor(rnd() * 80), participates: !self && !out, ...(self ? { selfUsed: true, selfPersons: 1 + Math.floor(rnd() * 3) } : {}) }
  })
  const models = ['settlement', 'settlement', 'settlement', 'flatRate', 'inclusive'] as const
  const tenancies: Source['tenancies'] = []
  const selfUnits = new Set<string>()
  for (const u of units) {
    if (!u.participates && rnd() < 0.7) continue
    const change = rnd() < 0.4
    const endA = change ? addDays(first, 30 + Math.floor(rnd() * (span - 60))) : null
    const unitSelf = u.id !== 'u0' && rnd() < 0.2
    if (unitSelf) selfUnits.add(u.id)
    const make = (id: string, start: string, end: string | null) => {
      const heatingModel = unitSelf ? 'selfSupply' : pick(models)
      const costModel = pick(['settlement', 'settlement', 'flatRate', 'inclusive'] as const)
      const persons = 1 + Math.floor(rnd() * 3)
      tenancies.push({
        id, unitId: u.id, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
        contractDate: start, ...(rnd() < 0.5 ? { halfSplitNoticeOn: '2027-06-01' } : {}),
        prepayments: [{ from: start.slice(0, 7), monthlyCents: cents(50, 300) }], prepaymentOverrides: {}, baseRents: [{ from: start.slice(0, 7), monthlyCents: cents(300, 900) }],
        ...(heatingModel !== 'settlement' ? { heatingModel } : {}),
        ...(heatingModel === 'selfSupply' ? { selfSupplyKind: pick(['central', 'perUnit'] as const) } : {}),
        ...(costModel !== 'settlement' ? { costModel } : {}),
        ...(heatingModel === 'flatRate' || costModel === 'flatRate' ? { flatRates: [{ from: start.slice(0, 7), monthlyCents: cents(20, 150) }] } : {}),
      })
    }
    make(`t${u.id}a`, '2020-01-01', endA)
    if (endA) make(`t${u.id}b`, addDays(endA, 1 + Math.floor(rnd() * 30)), null)
  }
  const energy: HeatingEnergy = pick(['gas', 'gas', 'oil', 'heatPump', 'districtHeating', 'pellets'] as const)
  const contracting = (energy === 'gas' || energy === 'oil' || energy === 'heatPump') && rnd() < 0.4
  const method = pick(['manual', 'manual', 'service'] as const)
  const swapDate = rnd() < 0.2 ? addDays(first, 100 + Math.floor(rnd() * (span - 200))) : null
  const heated = units.filter((u) => !selfUnits.has(u.id)).map((u) => ({ unitId: u.id, heatedAreaM2: null }))
  const handling = pick([null, 'ownMeter', 'deducted', 'landlordPays'] as const)
  const basePlant = {
    operatingPowerHandling: handling, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null,
    units: selfUnits.size > 0 && heated.length > 0 ? heated : null, propertyId: 'objekt-1', source: 'building' as const, method,
  }
  const gm = (energy === 'gas' || energy === 'districtHeating') && rnd() < 0.6
    ? { gmodg43InstalledOn: pick(['2026-03-01', '2027-03-01', '2028-02-01']), emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null }
    : {}
  const plants: Plant[] = [{ ...basePlant, ...gm, id: 'hp', name: 'Kessel', energy, contracting, ...(swapDate ? { endsOn: swapDate } : {}) } as Plant]
  if (swapDate) plants.push({ ...basePlant, id: 'hp2', name: 'Neu', energy: 'gas', contracting: false, replacesPlantId: 'hp' } as Plant)
  const deliveries: FuelDelivery[] = []
  const items: Item[] = []
  const blankDelivery = (o: Partial<FuelDelivery> & { id: string; plantId: string }): FuelDelivery => ({
    label: o.id, invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null, unitId: null, amountCents: null, quantity: null, quantityUnit: null,
    energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: null, co2CostCents: null, emissionFactor: null, gridFeeCents: null, bioCostCents: null,
    sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], creditNoteKind: null, ...o,
  })
  const keyFor = (): CostKey => (method === 'service' && rnd() < 0.5 ? 'amounts' : pick(['area', 'area', 'units', 'persons'] as const))
  const amountsFor = (total: number, P: { from: string; to: string }) => {
    const m: Record<string, number> = {}
    let rest = total
    for (const t of tenancies.filter((x) => x.start <= P.to && (x.end ?? '9999') >= P.from)) {
      const v = Math.floor(rest * rnd() * 0.7)
      m[t.id] = v
      rest -= v
    }
    return m
  }
  const part = () => (selfUnits.size > 0 && heated.length > 0 ? { participantUnitIds: heated.map((h) => h.unitId) } : {})
  const isStock = (e: HeatingEnergy) => e === 'oil' || e === 'pellets'
  let n = 0
  for (const P of periods) {
    const pk = P.key
    const y0 = Number(P.from.slice(0, 4))
    const y1 = Number(P.to.slice(0, 4))
    const ty = () => (y0 === y1 ? {} : { taxYear: pick([y0, y1]) })
    for (const pl of plants) {
      const active = pl.id === 'hp' ? (swapDate === null || P.from <= swapDate) : swapDate !== null && P.to > swapDate
      if (!active) continue
      const e = pl.energy
      const count = 1 + Math.floor(rnd() * 2)
      for (let k = 0; k < count; k++) {
        const id = `d${n++}`
        const amount = cents(800, 6000)
        let invoiceFrom: string | null = null
        let invoiceTo: string | null = null
        let deliveredAt: string | null = null
        if (!isStock(e)) {
          // Rechnung nach Kalenderjahr, auch beim Zeitraum Mai–April (Übertrag).
          const cy = pick([y0, y1])
          invoiceFrom = `${cy}-01-01` < first ? first : `${cy}-01-01`
          invoiceTo = `${cy}-12-31` > last ? last : `${cy}-12-31`
          if (swapDate && pl.id === 'hp' && invoiceTo > swapDate) invoiceTo = swapDate
          if (swapDate && pl.id === 'hp2' && invoiceFrom <= swapDate) invoiceFrom = addDays(swapDate, 1)
          if (invoiceFrom > invoiceTo) continue
        } else {
          deliveredAt = addDays(P.from, Math.floor(rnd() * 200))
          if (swapDate && pl.id === 'hp' && deliveredAt > swapDate) deliveredAt = swapDate
        }
        const end = must(invoiceTo ?? deliveredAt, 'kein Ende')
        const year = Number(end.slice(0, 4))
        const emissionsKg = e === 'heatPump' || e === 'pellets' ? null : Math.round(rnd() * 15000)
        const co2 = emissionsKg === null ? null : Math.round((emissionsKg * (year >= 2027 ? 0.6 : 0.55) * 119) / 100)
        const gmodg = year >= 2027 && (e === 'gas' || e === 'districtHeating') && rnd() < 0.6
        deliveries.push(blankDelivery({
          id, plantId: pl.id, invoiceFrom, invoiceTo, deliveredAt, invoiceDate: end,
          ...(isStock(e) ? { quantity: 500 + Math.floor(rnd() * 3000), quantityUnit: e === 'oil' ? 'l' : 'kg' } : {}),
          emissionsKg, co2CostCents: co2, ...(gmodg ? { gridFeeCents: cents(50, 400), bioCostCents: rnd() < 0.5 ? cents(10, 200) : null } : {}),
        }))
        const ip = periods.find((x) => x.from <= end && x.to >= end) ?? P
        const key = keyFor()
        const spans = Number(ip.from.slice(0, 4)) !== Number(ip.to.slice(0, 4))
        items.push({
          id: `i${id}`, propertyId: 'objekt-1', period: ip.key, category: HEATING_CATEGORY, description: `Brennstoff ${id}`, amountCents: amount, key,
          ...(key === 'amounts' ? { tenancyAmounts: amountsFor(amount, ip) } : {}), heatingPlantId: pl.id, heatingPart: 'fuel', fuelDeliveryId: id, ...part(),
          ...(spans ? { taxYear: pick([Number(ip.from.slice(0, 4)), Number(ip.to.slice(0, 4))]) } : {}),
        })
        // Gutschrift ohne Rechnung
        if (rnd() < 0.15) {
          const cid = `d${n++}`
          deliveries.push(blankDelivery({ id: cid, plantId: pl.id, invoiceFrom, invoiceTo, deliveredAt, invoiceDate: end, creditNoteKind: 'standalone', emissionsKg: null, co2CostCents: null }))
          items.push({
            id: `i${cid}`, propertyId: 'objekt-1', period: ip.key, category: HEATING_CATEGORY, description: `Gutschrift ${cid}`, amountCents: -cents(20, 400), key,
            ...(key === 'amounts' ? { tenancyAmounts: {} } : {}), heatingPlantId: pl.id, heatingPart: 'fuel', fuelDeliveryId: cid, ...part(),
          })
        }
      }
      if (rnd() < 0.7) {
        const included = rnd() < 0.6
        items.push({
          id: `op${pk}${pl.id}`, propertyId: 'objekt-1', period: pk, category: HEATING_CATEGORY, description: `Betriebsstrom ${pk} ${pl.id}`, amountCents: cents(30, 400),
          key: pick(['area', 'units'] as const), heatingPlantId: pl.id, heatingPart: 'operating', ...(included ? { operatingPower: 'included' as const } : {}), ...ty(),
        })
      }
      if (rnd() < 0.5) items.push({ id: `wa${pk}${pl.id}`, propertyId: 'objekt-1', period: pk, category: HEATING_CATEGORY, description: `Wartung ${pk} ${pl.id}`, amountCents: cents(100, 400), key: 'area', heatingPlantId: pl.id, labor35aCents: cents(20, 90), ...ty() })
    }
    items.push({ id: `hs${pk}`, propertyId: 'objekt-1', period: pk, category: 'Beleuchtung/Allgemeinstrom', description: `Hausstrom ${pk}`, amountCents: cents(300, 2000), key: pick(['area', 'units', 'persons'] as const), ...ty() })
    const nd = Math.floor(rnd() * 3)
    for (let k = 0; k < nd; k++) {
      const ops = items.filter((c) => c.operatingPower === 'included')
      const link = ops.length > 0 && rnd() < 0.5 ? pick(ops).id : undefined
      items.push({
        id: `ab${pk}${k}`, propertyId: 'objekt-1', period: pk, category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${pk}-${k}`, amountCents: -cents(10, 250), key: 'units',
        operatingPower: 'deduction', operatingPowerGeneralId: `hs${pk}`, ...(link ? { operatingPowerItemId: link } : {}), ...ty(),
      })
    }
    items.push({ id: `gs${pk}`, propertyId: 'objekt-1', period: pk, category: 'Grundsteuer', description: `Grundsteuer ${pk}`, amountCents: cents(300, 900), key: 'area', ...ty() })
    items.push({ id: `ww${pk}`, propertyId: 'objekt-1', period: pk, category: 'Wasser/Abwasser', description: `Wasser ${pk}`, amountCents: cents(300, 900), key: 'persons', ...ty() })
    if (rnd() < 0.4) items.push({ id: `nu${pk}`, propertyId: 'objekt-1', period: pk, category: 'Nicht umlagefähig', description: `Reparatur ${pk}`, amountCents: cents(100, 2000), key: 'area', ...ty() })
    if (rnd() < 0.3) items.push({ id: `gp${pk}`, propertyId: 'objekt-1', period: pk, category: 'Gartenpflege', description: `Gutschrift Garten ${pk}`, amountCents: -cents(10, 100), key: 'area', ...ty() })
  }
  // Vorrat: Anfangs- und Endbestand der ersten Heizperiode
  const heatingPeriodRows: NonNullable<Source['heatingPeriodRows']> = []
  if (isStock(energy) && rnd() < 0.7) {
    const p0 = must(periods[0], 'kein Zeitraum')
    heatingPeriodRows.push({
      plantId: 'hp', period: p0.key, dhwMethod: null, dhwUnmeasurable: null, stockUnit: energy === 'oil' ? 'l' : 'kg', openingQuantity: 1000, openingCostCents: 95000,
      openingEmissionsKg: energy === 'oil' ? 2676 : null, openingCo2Cents: 0, openingInvoicedBefore2023: false, openingAlreadySettled: false,
      closingQuantity: 300 + Math.floor(rnd() * 600), closingMeasuredOn: p0.to,
    } as NonNullable<Source['heatingPeriodRows']>[number])
  }
  // CO₂-Erstattungen an Selbstversorger, verrechnet oder ausgezahlt
  const co2Refunds: Co2Refund[] = []
  for (const t of tenancies.filter((x) => x.heatingModel === 'selfSupply')) {
    const k = Math.floor(rnd() * 3)
    for (let j = 0; j < k; j++) {
      const P = pick(periods)
      const claimed = addDays(P.from, Math.floor(rnd() * 200))
      if (claimed < t.start || (t.end && claimed > t.end)) continue
      const settle = rnd() < 0.5
      co2Refunds.push({
        id: `r${co2Refunds.length}`, tenancyId: t.id, supplierBilledAt: claimed, claimedAt: claimed, amountCents: cents(20, 300), settlePeriod: settle ? P.key : null,
        paidOutOn: settle ? null : addDays(claimed, 20), billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false,
        commercialUse: false, commercialMetered: false, nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
      })
    }
  }
  const source: Stock = {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
    units, tenancies, costItems: items, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: plants, fuelDeliveries: deliveries, co2Refunds, heatingPeriodRows,
  }
  const years = [...new Set(periods.flatMap((p) => [Number(p.from.slice(0, 4)), Number(p.to.slice(0, 4))]))]
  return { source, keys, rules, years }
}

const periodOf = (g: Gen, key: string): BillingPeriod => must(periodOfKey(g.rules, periodKey(key)), `kein Zeitraum ${key}`)
const settle = (source: Source, P: BillingPeriod): ComputedSettlement => computeSettlement(snapshotFor(source, 'objekt-1', P))

function checkSettlement(g: Gen, P: BillingPeriod, where: string, s: ComputedSettlement, fails: string[]): void {
  const say = (m: string) => fails.push(`${where} ${P.key}: ${m}`)
  const tenants = s.statements.reduce((a, x) => a + x.totalShareCents, 0)
  if (tenants + s.landlord.totalCents !== s.totalCostsCents) say(`S1 ${tenants} + ${s.landlord.totalCents} ≠ ${s.totalCostsCents}`)
  const byId = new Map(g.source.costItems.map((c) => [c.id, c]))
  const deliveryOf = (rowId: string) => g.source.fuelDeliveries.find((d) => rowId.startsWith(`fuel:${d.id}:`))
  const ids = new Set([...s.statements.flatMap((st) => st.rows.map((r) => r.costItemId)), ...s.landlord.rows.map((r) => r.costItemId)])
  for (const id of ids) {
    const t = s.statements.flatMap((st) => st.rows.filter((r) => r.costItemId === id)).reduce((a, r) => a + r.shareCents, 0)
    const l = s.landlord.rows.filter((r) => r.costItemId === id).reduce((a, r) => a + r.shareCents, 0)
    const item = byId.get(id)
    if (item && item.period === P.key && t + l !== item.amountCents) say(`S2 ${id}: ${t} + ${l} ≠ ${item.amountCents}`)
    if (!item && !synthetic(id)) say(`S2 unbekannte Zeile ${id}`)
  }
  for (const it of g.source.costItems.filter((c) => c.period === P.key && c.amountCents !== 0)) if (!ids.has(it.id)) say(`S2 Position ${it.id} (${it.amountCents}) fehlt`)
  const fuelOf = (rows: ComputedSettlement['statements'][number]['rows'], plant: string) => rows.filter((r) =>
    (byId.get(r.costItemId)?.heatingPart === 'fuel' && byId.get(r.costItemId)?.heatingPlantId === plant)
    || (r.kind === 'fuelCarry' && deliveryOf(r.costItemId)?.plantId === plant)
    || r.costItemId.startsWith(`stock:${plant}:`)).reduce((a, r) => a + r.shareCents, 0)
  for (const st of s.statements) {
    const ten = must(g.source.tenancies.find((t) => t.id === st.tenancyId), `kein Mietverhältnis ${st.tenancyId}`)
    const heatModel = ten.heatingModel ?? 'settlement'
    for (const r of st.rows) {
      if (!Number.isInteger(r.shareCents)) say(`S7 halber Cent ${r.costItemId}`)
      const item = byId.get(r.costItemId)
      if (item) {
        if (r.shareCents !== 0 && Math.sign(r.shareCents) !== Math.sign(item.amountCents)) say(`S3 ${st.tenancyId} ${r.costItemId} ${r.shareCents} gegen ${item.amountCents}`)
      } else if ((r.kind === 'co2Relief' || r.kind === 'gmodgRelief' || r.kind === 'co2Refund') && r.shareCents > 0) {
        say(`S3 ${st.tenancyId} ${r.kind} positiv ${r.shareCents}`)
      }
      if (heatModel !== 'settlement' && heatModel !== 'selfSupply' && (r.kind === 'co2Relief' || r.kind === 'gmodgRelief')) say(`S5 ${st.tenancyId} (${heatModel}) bekommt ${r.kind}`)
      if (heatModel === 'selfSupply' && (r.kind === 'co2Relief' || r.kind === 'gmodgRelief' || item?.heatingPart === 'fuel' || r.kind === 'fuelCarry')) say(`S5 Selbstversorger ${st.tenancyId} trägt ${r.costItemId}`)
    }
    for (const plant of ['hp', 'hp2']) {
      const relief = st.rows.filter((r) => (r.kind === 'co2Relief' || r.kind === 'gmodgRelief') && r.costItemId.includes(`:${plant}:`)).reduce((a, r) => a + r.shareCents, 0)
      const fuel = fuelOf(st.rows, plant)
      if (relief < 0 && -relief > fuel) say(`S6 ${st.tenancyId} ${plant}: Entlastung ${relief} über Brennstoff ${fuel}`)
    }
  }
  for (const plant of ['hp', 'hp2']) {
    for (const kind of ['co2Relief', 'gmodgRelief'] as const) {
      const per = s.statements.map((st) => ({
        id: st.tenancyId, fuel: fuelOf(st.rows, plant),
        relief: st.rows.filter((r) => r.kind === kind && r.costItemId.includes(`:${plant}:`)).reduce((a, r) => a + r.shareCents, 0),
      }))
      const R = per.reduce((a, x) => a + x.relief, 0)
      const F = per.reduce((a, x) => a + x.fuel, 0)
      if (R === 0 || F <= 0) continue
      for (const x of per) if (Math.abs(x.relief - (R * x.fuel) / F) > 1.5) say(`S9 ${kind} ${plant} ${x.id}: ${x.relief} statt ${((R * x.fuel) / F).toFixed(1)}`)
    }
  }
  // S10: „um N % kürzen …, hier: Name (Wohnung) x,xx €“ gegen N % dessen, was der Mieter in dieser Abrechnung trägt.
  for (const n of s.notices) {
    const m = /um (?:bis zu )?(\d+) % kürzen(?: \([^)]*\))?[^,]*?, hier: (.*?)(?:\. |;|\.$)/.exec(n.text)
    if (!m) continue
    const pct = Number(m[1])
    for (const piece of (m[2] ?? '').split(/, | und /)) {
      const mm = /^(.*) \((.*)\) (-?[\d.]+,\d\d) €$/.exec(piece)
      if (!mm) continue
      const st = s.statements.find((x) => x.tenantName === mm[1] && x.unitName === mm[2])
      if (!st) continue
      const desc = /^„([^“]*)“/.exec(n.text)?.[1]
      const plantName = /^Heizanlage „([^“]*)“/.exec(n.text)?.[1]
      const item: CostItem | Item | undefined = desc ? g.source.costItems.find((c) => c.description === desc) : undefined
      const plant = plantName ? g.source.heatingPlants.find((p) => p.name === plantName) : undefined
      if (!item && !plant) continue
      const ofPlant = (id: string) => plant !== undefined && (byId.get(id)?.heatingPlantId === plant.id || deliveryOf(id)?.plantId === plant.id || id.startsWith(`stock:${plant.id}:`))
      // Die Kürzung nach § 7 Abs. 4/5 CO2KostAufG rechnet auf den Anteil nach Abzug der Entlastung (§ 5a).
      const withRelief = n.code === 'co2.half-split-missing'
      const heat = st.rows.filter((r) => (item
        ? r.costItemId === item.id || (r.costItemId.startsWith('fuel:') && r.costItemId.endsWith(`:${item.id}`))
        : (withRelief || (r.kind !== 'co2Relief' && r.kind !== 'gmodgRelief')) && (ofPlant(r.costItemId) || (withRelief && plant !== undefined && r.costItemId.includes(`:${plant.id}:`))))).reduce((a, r) => a + r.shareCents, 0)
      // Die Überträge aus dem Vorrat stehen bei der Position, deren Schlüssel sie folgen (Durchsicht von #237, M3); welche
      // das ist, weiß die Probe nicht, deshalb gilt auch der Anteil samt diesen Überträgen.
      const stock = item?.heatingPlantId ? st.rows.filter((r) => r.costItemId.startsWith(`stock:${item.heatingPlantId}:`)).reduce((a, r) => a + r.shareCents, 0) : 0
      const got = euroToCents(mm[3] ?? '')
      const want = Math.round((heat * pct) / 100)
      if (Math.abs(got - want) > 1 && Math.abs(got - Math.round(((heat + stock) * pct) / 100)) > 1) say(`S10 ${n.code} ${st.tenancyId}: genannt ${got}, ${pct} % von ${heat} = ${want}`)
    }
  }
  try {
    assertLandlordParts(s, s.statements.length, where)
  } catch (e) {
    say(`S4 ${(e instanceof Error ? e.message : String(e)).split('\n')[0] ?? ''}`)
  }
  for (const r of s.landlord.rows) if (!Number.isInteger(r.shareCents)) say(`S7 halber Cent Vermieter ${r.costItemId}`)
}

function checkTax(g: Gen, year: number, where: string, fails: string[]): void {
  const say = (m: string) => fails.push(`${where} Steuer ${year}: ${m}`)
  const r = taxReportFor(g.source, 'objekt-1', year)
  const e = r.expenses
  const parts = taxPartsFor(g.source, 'objekt-1', year)
  const inYear = parts === null ? g.source.costItems.filter((c) => c.period === calendarPeriod(year)) : parts.flatMap((p) => p.items)
  for (const i of e.items) {
    if (i.privateCents + i.deductibleCents !== i.amountCents) say(`T1 ${i.costItemId}: ${i.privateCents} + ${i.deductibleCents} ≠ ${i.amountCents}`)
    if (i.operatingPowerBalance) {
      // Die Zeile zum Ausgleich verrechnet Abzüge (+) und Betriebsstrom in den Heizkosten (−), jede mit ihrem Maßstab;
      // ihr privater Teil liegt zwischen den beiden Richtungen (invariant-betriebsstrom-steuer.test.ts, I5; Durchsicht M1).
      const up = inYear.filter((c) => c.operatingPower === 'deduction').reduce((a, c) => a - c.amountCents, 0)
      const down = inYear.filter((c) => c.operatingPower === 'included').reduce((a, c) => a + c.amountCents, 0)
      if (i.privateCents < -down || i.privateCents > up) say(`T1 Ausgleich privat ${i.privateCents} außerhalb −${down} … +${up}`)
    } else if (Math.abs(i.privateCents) > Math.abs(i.amountCents)) {
      say(`T1 privat ${i.privateCents} über Betrag ${i.amountCents} (${i.costItemId})`)
    }
  }
  if (e.privateCents + e.deductibleCents !== e.totalCents) say('T1 Summe')
  const sumItems = e.items.reduce((a, i) => a + i.amountCents, 0)
  if (sumItems !== e.totalCents) say(`T2 Σ Zeilen ${sumItems} ≠ Werbungskosten ${e.totalCents}`)
  if (!g.source.units.some((u) => u.selfUsed) && e.items.some((i) => i.privateCents !== 0)) say('T4 privat ohne Eigennutzung')
  const ids = new Set(inYear.map((c) => c.id))
  if (ids.size !== inYear.length) say('T3 Position doppelt in den Teilen')
  // Ausgleich bei Abzügen und Betriebsstrom über den Steuerjahren: Mit Messdienst steckt der Abzug ohne Verweis in
  // dessen Betrag; bei gemischten Anlagen (Kesseltausch Messdienst → frei) ist das nicht eindeutig, dort keine Probe.
  const plants = g.source.heatingPlants
  const service = plants.some((p) => p.method === 'service')
  const allService = plants.every((p) => p.method === 'service')
  const paid = inYear.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0)
  const reported = inYear.filter((c) => c.operatingPower === 'deduction' && !c.operatingPowerItemId).reduce((a, c) => a + c.amountCents, 0)
  const refunds = g.source.co2Refunds.filter((x) => x.paidOutOn && Number(x.paidOutOn.slice(0, 4)) === year).reduce((a, x) => a + x.amountCents, 0)
  const expected = paid + (allService ? reported : 0) + refunds
  if (e.totalCents !== expected && !(service && !allService)) say(`T3 Werbungskosten ${e.totalCents} ≠ bezahlt ${expected}`)
  const split = new Map(e.items.map((i) => [i.costItemId, i]))
  const plan = planTaxArchive(inYear as CostItem[], new Map(), new Map(), split, derivedTaxLines(r))
  const rows = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n').slice(1).map((l) => l.split(';'))
  const unq = (s: string | undefined) => (s ?? '').replace(/^"|"$/g, '')
  let b = 0
  let p = 0
  let d = 0
  for (const row of rows) {
    b += euroToCents(unq(row[4]))
    p += euroToCents(unq(row[5]))
    d += euroToCents(unq(row[6]))
  }
  const reserve = inYear.filter((c) => c.category === 'Erhaltungsrücklage').reduce((a, c) => a + c.amountCents, 0)
  if (b - reserve !== e.totalCents || p !== e.privateCents || d !== e.deductibleCents) say(`T5 CSV ${b}/${p}/${d} ≠ ${e.totalCents}/${e.privateCents}/${e.deductibleCents}`)
}

test('Integration: Abrechnung je Mieter, Abschluss und Steuer über alle Heizungsmerkmale zugleich', () => {
  const fails: string[] = []
  let refundsChecked = 0
  let balanceLines = 0
  for (const seed of SEEDS) {
    const g = gen(makeRng(seed))
    const where = `Startwert ${seed}`
    const settled = new Map<string, ComputedSettlement>()
    for (const key of g.keys) {
      const P = periodOf(g, key)
      let s: ComputedSettlement
      try {
        s = settle(g.source, P)
      } catch (err) {
        fails.push(`${where} ${key}: wirft ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      settled.set(key, s)
      checkSettlement(g, P, where, s, fails)
    }
    // S8: verrechnet genau einmal; bekommt der Mieter dort keine Abrechnung, ein Hinweis (Durchsicht S1).
    for (const r of g.source.co2Refunds) {
      refundsChecked++
      const got = [...settled.values()].flatMap((s) => s.statements.flatMap((st) => st.rows)).filter((row) => row.costItemId === `co2refund:${r.id}`).reduce((a, row) => a + row.shareCents, 0)
      const target = r.settlePeriod === null ? undefined : settled.get(String(r.settlePeriod))
      const billed = target?.statements.some((st) => st.tenancyId === r.tenancyId) ?? false
      if (got !== (r.settlePeriod !== null && billed ? -r.amountCents : 0)) fails.push(`${where}: S8 Erstattung ${r.id} verrechnet ${got}`)
      if (target && !billed && !target.notices.some((x) => (x.code === 'co2.refund-not-next' || x.code === 'co2.refund-due') && x.subject?.kind === 'tenancy' && x.subject.id === r.tenancyId && x.text.includes('keine Abrechnung'))) {
        fails.push(`${where}: S8 Erstattung ${r.id} ohne Abrechnung des Mieters und ohne Hinweis`)
      }
    }
    for (const y of g.years) {
      try {
        checkTax(g, y, where, fails)
        balanceLines += taxReportFor(g.source, 'objekt-1', y).expenses.items.filter((i) => i.operatingPowerBalance).length
      } catch (err) {
        fails.push(`${where} Steuer ${y}: wirft ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Abschluss: zufällige Zeiträume einfrieren; eingefroren = heute, die übrigen und die Steuer wie oben.
    const closeRnd = makeRng(seed * 13 + 7)
    const frozen = g.keys.filter(() => closeRnd() < 0.5)
    if (frozen.length === 0) continue
    const closedSettlements = frozen.map((key) => {
      const P = periodOf(g, key)
      const st: unknown = JSON.parse(JSON.stringify(must(settled.get(key), `keine Abrechnung ${key}`)))
      return { period: P.key, propertyId: 'objekt-1', sentAt: null, ...frozenSettlementOf(st), settlement: st }
    })
    const g2: Gen = { ...g, source: { ...g.source, closedSettlements } }
    const tag = `${where} [abgeschlossen ${frozen.join('+')}]`
    for (const c of closedSettlements) {
      const P = periodOf(g, String(c.period))
      const cmp = compareWithFrozen(c.settlement, () => settle(g2.source, P), '2099-01-01', '2026-01-01')
      if (!cmp.comparable || cmp.deviations.length > 0) fails.push(`${tag} ${c.period}: F1 eingefroren ≠ heute ${JSON.stringify(cmp.deviations).slice(0, 300)}`)
    }
    for (const key of g.keys.filter((k) => !frozen.includes(k))) {
      const P = periodOf(g, key)
      checkSettlement(g2, P, tag, settle(g2.source, P), fails)
    }
    for (const y of g.years) {
      checkTax(g2, y, tag, fails)
      const a = taxReportFor(g.source, 'objekt-1', y).expenses
      const b = taxReportFor(g2.source, 'objekt-1', y).expenses
      if (a.totalCents !== b.totalCents || a.privateCents !== b.privateCents) fails.push(`${tag} Steuer ${y}: F2 Abschluss ändert die Steuer ${a.totalCents}/${a.privateCents} → ${b.totalCents}/${b.privateCents}`)
    }
  }
  assert.deepEqual(fails.slice(0, 20), [], `${fails.length} Befunde`)
  // Der Generator muss Erstattungen und Ausgleichszeilen erzeugen, sonst prüfen S8 und T1 nichts.
  if (SEEDS.length >= 10) assert.ok(refundsChecked > 0 && balanceLines > 0, `Erstattungen ${refundsChecked}, Ausgleichszeilen ${balanceLines}`)
})
