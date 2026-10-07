// Den ganzen Datenbestand aus der Datenbank lesen (#55).
//
// **Der Leser der Routen**, also der für den heutigen Stand des Schemas. Der Umstieg benutzt ihn
// ausdrücklich **nicht**: In seiner Umstiegsdatei steht zu diesem Zeitpunkt nur Migration 0000,
// und dafür gibt es `legacy/read.ts`. Ein Test hält das fest, denn läse der Umstieg von hier,
// scheiterte er an der ersten Migration, die eine Spalte hinzufügt.
//
// Das Gegenstück zum Schreiben steht seit Aufgabe 6 nicht mehr an einer Stelle: Die Routen
// schreiben über `db/repository.ts`, `db/write.ts` legt nur noch die Einstellungszeilen an, und
// den ganzen Bestand schreibt `legacy/write.ts` beim Umstieg.
//
// **Gelesen wird in der Reihenfolge, in der die Zeilen angelegt wurden** (`rowid`), und das ist
// keine Kosmetik. Zwei Ablesungen mit demselben Datum sortiert die Berechnung stabil, es gilt
// also die Reihenfolge der Datei: Welcher der beiden Stände der spätere ist, entscheidet über
// den Verbrauch und damit über Geld. Dasselbe in klein gilt für die Anzeige, denn die Zeilen
// der Abrechnung stehen in der Reihenfolge der Kostenpositionen. Ohne `ORDER BY` liefert SQLite
// zwar in aller Regel die rowid-Reihenfolge, zugesichert ist das aber nicht; sobald ein Index
// die Abfrage bedient, kann es anders kommen.

import { eq, sql } from 'drizzle-orm'
import type { AiConsent, AiSettings, AiSlot, Co2Statement, CostItem, DegreeDayValue, FrozenFuelCarry, FuelDelivery, HeatingPeriodData, HeatingPlant, HeatingServiceValue, InterimGap, Meter, Payment, PeriodKey, Property, Reading, Settings, Tenancy, Unit } from '../../../shared/types.ts'
import { periodKey } from '../../../shared/period.ts'
import { migrateAi, type MigratedSettings } from '../ai/settings.ts'
import { DEFAULT_SETTINGS } from '../defaults.ts'
import { frozenSettlementOf, type FrozenItemSelfUse, type SnapshotSource } from '../snapshot.ts'
import type { Executor } from './client.ts'
import {
  aiSlots, baseRents, closedHeatingSettlements, co2Statements, co2TenantReliefs, degreeDayValues, fuelCarryFrozen, fuelDeliveries, fuelDeliveryParts, heatingPeriods, closedSettlements, costItemAmounts, costItemParticipants, costItemSelfAmounts, costItemShares, costItems, unitNoConnection, meters, payments,
  flatRates, heatingPeriodChanges, heatingPlants, heatingPlantUnits, heatingPrepaymentOverrides, heatingPrepayments, heatingSelfSpans, heatingSeparateSpans, heatingServiceValues, periodChanges, personHistory, prepaymentOverrides, prepayments, properties, readings, settings, tenancies, units,
  interimReadingGaps,
} from './schema.ts'

// Eine abgeschlossene Abrechnung, wie sie in der Datenbank steht. `settlement` bleibt
// `unknown`: Es ist ein Archivstück, das wortgleich erhalten bleiben soll, und ein Typ darüber
// wäre eine Behauptung über etwas, das eine frühere Version geschrieben hat. Die Berechnung
// liest daraus nur den Eigenanteil und die Vorauszahlungen, und die holt `frozenSettlementOf`
// aus snapshot.ts heraus — dieselbe Funktion wie auf dem Weg über die Datei.
export type StoredClosedSettlement = {
  id: string
  propertyId: string
  // Der Zeitraum der Abrechnung (#208).
  period: PeriodKey
  closedAt: string
  sentAt: string | null
  selfUsedShareCents: number
  prepaymentCents: number
  prepaymentOverridden: boolean
  // Eigenanteile je Position (#163), ebenfalls aus `frozenSettlementOf`
  selfUseByItem: Record<string, FrozenItemSelfUse> | null
  itemTotals: Record<string, number> | null
  settlement: unknown
}

// Der Bestand, wie er in der Datenbank liegt. Er erfüllt `SnapshotSource` (snapshot.ts), lässt
// sich also unmittelbar zu einem Schnappschuss eines Jahres machen.
export type Stock = SnapshotSource & {
  properties: Property[]
  units: Unit[]
  tenancies: Tenancy[]
  costItems: CostItem[]
  meters: Meter[]
  heatingPlants: HeatingPlant[]
  // CO₂-Angaben und Zeilen der Heizperioden (Heizung PR 6)
  co2Statements: Co2Statement[]
  heatingPeriodRows: HeatingPeriodData[]
  // Antworten zu fehlenden Zwischenablesungen (Heizung PR 10)
  interimGaps: InterimGap[]
  // Werte der Ablesedienste (Heizung PR 12)
  heatingServiceValues: HeatingServiceValue[]
  // Lieferungen, eingefrorene Überträge, Ortswerte (Heizung PR 7)
  fuelDeliveries: FuelDelivery[]
  fuelCarryFrozen: FrozenFuelCarry[]
  degreeDayValues: (DegreeDayValue & { propertyId: string })[]
  readings: Reading[]
  payments: Payment[]
  closedSettlements: StoredClosedSettlement[]
  closedHeatingSettlements: StoredClosedHeatingSettlement[]
  settings: MigratedSettings
}

// Ein fehlendes Feld kommt aus der Datenbank als NULL zurück. Im Datenmodell steht dort ein
// optionales Feld, also `undefined`. Der Unterschied ist für die Berechnung keiner (beide sind
// „nichts“), und `JSON.stringify` lässt ein `undefined` wieder ganz weg, sodass die Oberfläche
// genau das sieht, was sie heute sieht. Wo das Datenmodell `null` ausdrücklich zulässt (das
// offene Mietverhältnis, der Hauptzähler ohne Wohnung), bleibt das `null` stehen.
const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined

// Zeilen nach ihrer Kennung bündeln, in der Reihenfolge, in der sie gelesen wurden.
function groupBy<T, K>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => K): Map<string, K[]> {
  const groups = new Map<string, K[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = groups.get(key)
    if (list) list.push(valueOf(row))
    else groups.set(key, [valueOf(row)])
  }
  return groups
}

// Die Reihenfolge, in der die Zeilen angelegt wurden. Siehe oben; steht als Konstante da, damit
// keine Abfrage sie vergisst.
const INSERTION_ORDER = sql`rowid`

// ---------- Je Sammlung ein Leser ----------
//
// Jede Sammlung hat ihren eigenen Leser, und `readStock` setzt sie nur zusammen. Der Grund ist
// die Route: `GET /api/units` braucht die Wohnungen und nicht den ganzen Bestand. Damit steht
// die Naht zwischen Zeile und Domänentyp je Sammlung an genau einer Stelle, und sie ist eine
// benannte Funktion und keine Zusicherung (dasselbe Muster wie bei der KI-Auswertung, #63).

export async function readProperties(db: Executor): Promise<Property[]> {
  const rows = await db.select().from(properties).orderBy(INSERTION_ORDER)
  // Die Wechsel aufsteigend nach Monat, nicht nach Anlage: shared/period.ts verlangt sie so.
  const changeRows = await db.select().from(periodChanges).orderBy(periodChanges.fromMonth)
  const changes = groupBy(changeRows, (r) => r.propertyId, (r) => r.fromMonth)
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    address: p.address,
    // Hier bleibt `null` stehen und wird nicht zu `undefined`: Es heißt „die Vorgabe gilt“ und
    // ist damit eine Auskunft, kein fehlendes Feld.
    landlordName: p.landlordName,
    iban: p.iban,
    paymentDeadlineDays: p.paymentDeadlineDays,
    cableBuiltBeforeDec2021: p.cableBuiltBeforeDec2021,
    // Der Rhythmus (#208). Immer mitgeliefert, damit niemand ihn erraten muss.
    periodRules: { startMonth: p.periodStartMonth, changes: changes.get(p.id) ?? [] },
  }))
}

export async function readUnits(db: Executor): Promise<Unit[]> {
  const rows = await db.select().from(units).orderBy(INSERTION_ORDER)
  const noConnectionRows = await db.select().from(unitNoConnection).orderBy(INSERTION_ORDER)
  const noConnection = groupBy(noConnectionRows, (r) => r.unitId, (r) => r.meterType)
  return rows.map((u) => ({
    id: u.id,
    propertyId: u.propertyId,
    name: u.name,
    areaM2: u.areaM2,
    participates: u.participates,
    selfUsed: orUndefined(u.selfUsed),
    selfPersons: orUndefined(u.selfPersons),
    // Nur, wenn es einen Wert gibt, wie die übrigen Angaben aus #94: Eine Wohnung aus einer
    // db.json hat das Feld gar nicht.
    ...(u.mea === null ? {} : { mea: u.mea }),
    // Ebenso nur, wenn es Einträge gibt (#117).
    ...(noConnection.has(u.id) ? { noConnection: noConnection.get(u.id) } : {}),
    rooms: orUndefined(u.rooms),
    floor: orUndefined(u.floor),
    notes: orUndefined(u.notes),
  }))
}

// Ein Mietverhältnis liegt über fünf Tabellen: sich selbst und die drei Staffeln, dazu die
// Jahreskorrektur. Deshalb liest dieser Leser mehr als einen Tisch, und deshalb ist er der
// einzige, bei dem das so ist.
export async function readTenancies(db: Executor): Promise<Tenancy[]> {
  const rows = await db.select().from(tenancies).orderBy(INSERTION_ORDER)
  const personRows = await db.select().from(personHistory).orderBy(INSERTION_ORDER)
  const prepaymentRows = await db.select().from(prepayments).orderBy(INSERTION_ORDER)
  const flatRateRows = await db.select().from(flatRates).orderBy(INSERTION_ORDER)
  const baseRentRows = await db.select().from(baseRents).orderBy(INSERTION_ORDER)
  const overrideRows = await db.select().from(prepaymentOverrides).orderBy(INSERTION_ORDER)

  const persons = groupBy(personRows, (r) => r.tenancyId, (r) => ({ from: r.from, persons: r.persons }))
  const prepaid = groupBy(prepaymentRows, (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  const flat = groupBy(flatRateRows, (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  const rents = groupBy(baseRentRows, (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  // Die Jahreskorrektur wird gleich zu einem Objekt (`Object.fromEntries`), deshalb Paare,
  // geschlüsselt nach Zeitraum (#208). Der
  // angeschriebene Rückgabetyp macht daraus ein Paar statt einer Liste, ohne etwas zu behaupten:
  // Er beschreibt, was danebensteht, und der Übersetzer rechnet es nach.
  const overrides = groupBy(overrideRows, (r) => r.tenancyId, (r): [string, number] => [r.period, r.amountCents])
  // Heizstaffel und Heizkorrekturen (Heizung PR 5). Wie die Pauschale nur, wenn es Zeilen gibt: So
  // bleibt ein Mietverhältnis ohne getrennte Heizvorauszahlung genau so, wie es vorher gelesen wurde.
  const heizstaffel = groupBy(await db.select().from(heatingPrepayments).orderBy(INSERTION_ORDER), (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  const heizkorrekturen = groupBy(
    await db.select().from(heatingPrepaymentOverrides).orderBy(INSERTION_ORDER),
    (r) => r.tenancyId,
    (r) => ({ plantId: r.plantId, period: r.period, cents: r.cents, provisional: r.provisional, fromMonth: r.fromMonth, toMonth: r.toMonth }),
  )

  return rows.map((t) => ({
    id: t.id,
    unitId: t.unitId,
    tenantName: t.tenantName,
    persons: t.persons,
    personHistory: persons.get(t.id) ?? [],
    start: t.start,
    end: t.end,
    prepayments: prepaid.get(t.id) ?? [],
    // Nur mit Einträgen, wie die übrigen Angaben aus #93: Die db.json kennt das Feld nicht.
    ...(flat.has(t.id) ? { flatRates: flat.get(t.id) } : {}),
    ...(heizstaffel.has(t.id) ? { heatingPrepayments: heizstaffel.get(t.id) ?? [] } : {}),
    ...(heizkorrekturen.has(t.id) ? { heatingPrepaymentOverrides: heizkorrekturen.get(t.id) ?? [] } : {}),
    prepaymentOverrides: Object.fromEntries(overrides.get(t.id) ?? []),
    baseRents: rents.get(t.id) ?? [],
    email: orUndefined(t.email),
    phone: orUndefined(t.phone),
    correspondenceAddress: orUndefined(t.correspondenceAddress),
    iban: orUndefined(t.iban),
    contractDate: orUndefined(t.contractDate),
    depositCents: orUndefined(t.depositCents),
    depositStatus: orUndefined(t.depositStatus),
    // Nur mit Wert, wie die Angaben aus #94: Ein Mietverhältnis aus einer db.json hat sie nicht.
    ...(t.costModel === null ? {} : { costModel: t.costModel }),
    ...(t.heatingModel === null ? {} : { heatingModel: t.heatingModel }),
    notes: orUndefined(t.notes),
  }))
}

export async function readCostItems(db: Executor): Promise<CostItem[]> {
  const rows = await db.select().from(costItems).orderBy(INSERTION_ORDER)
  const shareRows = await db.select().from(costItemShares).orderBy(INSERTION_ORDER)
  const shares = groupBy(shareRows, (r) => r.costItemId, (r): [string, number] => [r.unitId, r.percent])
  const participantRows = await db.select().from(costItemParticipants).orderBy(INSERTION_ORDER)
  const participants = groupBy(participantRows, (r) => r.costItemId, (r) => r.unitId)
  const amountRows = await db.select().from(costItemAmounts).orderBy(INSERTION_ORDER)
  const amounts = groupBy(amountRows, (r) => r.costItemId, (r): [string, number] => [r.tenancyId, r.amountCents])
  const selfAmountRows = await db.select().from(costItemSelfAmounts).orderBy(INSERTION_ORDER)
  const selfAmounts = groupBy(selfAmountRows, (r) => r.costItemId, (r): [string, number] => [r.unitId, r.amountCents])
  return rows.map((c) => {
    const own = shares.get(c.id)
    const teilnehmer = participants.get(c.id)
    const betraege = amounts.get(c.id)
    const eigen = selfAmounts.get(c.id)
    return {
      id: c.id,
      propertyId: c.propertyId,
      period: c.period,
      category: c.category,
      description: c.description,
      vendor: orUndefined(c.vendor),
      amountCents: c.amountCents,
      key: c.key,
      directUnitId: c.directUnitId,
      meterType: c.meterType,
      // Das Feld nur, wenn es Anteile gibt: Eine Position ohne vereinbarte Anteile hat es
      // auch in der Datei nicht.
      ...(own ? { customShares: Object.fromEntries(own) } : {}),
      // Dieselbe Haltung bei den Angaben aus #94: nur, wenn es sie gibt.
      ...(c.participantsLimited ? { participantUnitIds: teilnehmer ?? [] } : {}),
      ...(betraege ? { tenancyAmounts: Object.fromEntries(betraege) } : {}),
      ...(eigen ? { selfAmounts: Object.fromEntries(eigen) } : {}),
      ...(c.externalMeasure !== null && c.externalTotal !== null && c.externalTotalCents !== null
        ? { externalBasis: { measure: c.externalMeasure, total: c.externalTotal, totalCents: c.externalTotalCents } }
        : {}),
      labor35aCents: orUndefined(c.labor35aCents),
      invoiceFile: orUndefined(c.invoiceFile),
      // Leistungszeitraum, Jahr der Zahlung, Brennstoffmerkmal (#208): der Schlüssel nur, wenn es
      // den Wert gibt, wie bei den Angaben aus #94. Ein Bestand ohne sie liest sich Schlüssel für
      // Schlüssel wie vorher (die Rundreise in db-stock.test.ts vergleicht streng).
      ...(c.serviceFrom !== null ? { serviceFrom: c.serviceFrom } : {}),
      ...(c.serviceTo !== null ? { serviceTo: c.serviceTo } : {}),
      ...(c.taxYear !== null ? { taxYear: c.taxYear } : {}),
      ...(c.heatingPart !== null ? { heatingPart: c.heatingPart } : {}),
      // Das Ziel bei Heizkosten (Heizung PR 10), ebenso nur, wenn es gesetzt ist.
      ...(c.heatingTarget !== null ? { heatingTarget: c.heatingTarget } : {}),
      // Die Heizanlage (Heizung PR 4), ebenso nur, wenn es sie gibt.
      ...(c.heatingPlantId !== null ? { heatingPlantId: c.heatingPlantId } : {}),
      // Die Lieferung (Heizung PR 7), ebenso nur, wenn es sie gibt.
      ...(c.fuelDeliveryId !== null ? { fuelDeliveryId: c.fuelDeliveryId } : {}),
    }
  })
}

export async function readMeters(db: Executor): Promise<Meter[]> {
  const rows = await db.select().from(meters).orderBy(INSERTION_ORDER)
  return rows.map((m) => ({
    id: m.id,
    propertyId: m.propertyId,
    name: m.name,
    unitId: m.unitId,
    type: m.type,
    meterNumber: orUndefined(m.meterNumber),
    unit: m.unit,
    // Heizanlage, Fernablesbarkeit und Einbau (Heizung PR 4): der Schlüssel nur, wenn es den Wert
    // gibt, wie bei den Kostenpositionen.
    ...(m.heatingPlantId !== null ? { heatingPlantId: m.heatingPlantId } : {}),
    ...(m.heatingRole !== null ? { heatingRole: m.heatingRole } : {}),
    ...(m.remoteReadable !== null ? { remoteReadable: m.remoteReadable } : {}),
    ...(m.installedOn !== null ? { installedOn: m.installedOn } : {}),
    // Skala und Bewertungsfaktor eines Heizkostenverteilers (Heizung PR 12).
    ...(m.hcaScale !== null ? { hcaScale: m.hcaScale } : {}),
    ...(m.ratingFactor !== null ? { ratingFactor: m.ratingFactor } : {}),
  }))
}

// Die Heizanlagen (Heizung PR 4). Die Liste der Wohnungen gibt es nur, wenn die Anlage eine hat
// (`units_limited`); sonst versorgt sie alle Wohnungen ihres Objekts.
export async function readHeatingPlants(db: Executor): Promise<HeatingPlant[]> {
  const rows = await db.select().from(heatingPlants).orderBy(INSERTION_ORDER)
  const zeilen = await db.select().from(heatingPlantUnits).orderBy(INSERTION_ORDER)
  const byPlant = groupBy(zeilen, (z) => z.plantId, (z) => ({ unitId: z.unitId, heatedAreaM2: z.heatedAreaM2 }))
  // Wechsel und Spannen nach Weg d (Heizung PR 5), aufsteigend.
  const wechsel = groupBy(await db.select().from(heatingPeriodChanges).orderBy(heatingPeriodChanges.fromMonth), (w) => w.plantId, (w) => w.fromMonth)
  const spannen = groupBy(await db.select().from(heatingSeparateSpans).orderBy(heatingSeparateSpans.from), (s) => s.plantId, (s) => ({ from: s.from, until: s.until }))
  // Zeiträume der eigenen Heizkostenabrechnung (Durchsicht von #239), aufsteigend.
  const eigene = groupBy(await db.select().from(heatingSelfSpans).orderBy(heatingSelfSpans.from), (s) => s.plantId, (s) => ({ from: s.from, until: s.until, ...(s.capture !== null ? { capture: s.capture } : {}) }))
  return rows.map((p) => ({
    id: p.id,
    propertyId: p.propertyId,
    name: p.name,
    energy: p.energy,
    supply: p.supply,
    method: p.method,
    separateSettlement: p.separateSettlement,
    devicesRemote: p.devicesRemote,
    devicesInstalledAfter2021: p.devicesInstalledAfter2021,
    newDevicesInstall: p.newDevicesInstall,
    source: p.source,
    captureInstalledOn: p.captureInstalledOn,
    capturedOnOct2024: p.capturedOnOct2024,
    warmRentAverageCents: p.warmRentAverageCents,
    changeSplit: p.changeSplit,
    nonResidential: p.nonResidential,
    restriction: p.restriction,
    districtEtsNew: p.districtEtsNew,
    periodStartMonth: p.periodStartMonth,
    periodChanges: wechsel.get(p.id) ?? [],
    separateSpans: spannen.get(p.id) ?? [],
    units: p.unitsLimited ? (byPlant.get(p.id) ?? []) : null,
    endsOn: p.endsOn,
    replacesPlantId: p.replacesPlantId,
    buildingWith: p.buildingWith,
    takesOverStock: p.takesOverStock,
    // Eigene Heizkostenabrechnung (Heizung PR 10).
    hotWater: p.hotWater,
    capture: p.capture,
    areaBasisHeat: p.areaBasisHeat,
    heatPumpInstalledOn: p.heatPumpInstalledOn,
    heatGeneration: p.heatGeneration,
    heatPumpMajority: p.heatPumpMajority,
    hcaModel: p.hcaModel,
    selfSpans: eigene.get(p.id) ?? [],
  }))
}

// Die Werte der Ablesedienste (Heizung PR 12), mit Anlage und Heizperiode aus `heating_periods`, in der
// Reihenfolge, in der sie angelegt wurden.
export async function readHeatingServiceValues(db: Executor): Promise<HeatingServiceValue[]> {
  const rows = await db
    .select({ v: heatingServiceValues, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(heatingServiceValues)
    .innerJoin(heatingPeriods, eq(heatingServiceValues.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"heating_service_values".rowid`)
  return rows.map(({ v, plantId, period }) => ({
    plantId, period: periodKey(String(period)), unitId: v.unitId, from: v.from, to: v.to, heatValue: v.heatValue, waterValue: v.waterValue,
  }))
}

// Die CO₂-Angaben je Heizperiode (Heizung PR 6), mit Anlage und Heizperiode aus `heating_periods`
// und den Beträgen „vom Vermieter übernommen“ je Mietverhältnis.
export async function readCo2Statements(db: Executor): Promise<Co2Statement[]> {
  const rows = await db
    .select({ statement: co2Statements, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(co2Statements)
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"co2_statements".rowid`)
  const reliefs = await db.select().from(co2TenantReliefs).orderBy(INSERTION_ORDER)
  const byStatement = groupBy(reliefs, (r) => r.statementId, (r) => ({ tenancyId: r.tenancyId, cents: r.cents }))
  return rows.map(({ statement, plantId, period }) => ({
    ...statement,
    plantId,
    period: periodKey(String(period)),
    reliefs: byStatement.get(statement.heatingPeriodId) ?? [],
  }))
}

// Die Zeilen der Heizperioden (PR 4), für die Angaben zum Warmwasser im Schnappschuss.
export async function readHeatingPeriodRows(db: Executor): Promise<HeatingPeriodData[]> {
  return await db.select().from(heatingPeriods).orderBy(INSERTION_ORDER)
}

// Die Antworten zu fehlenden Zwischenablesungen (Heizung PR 10, Abweichung 8), nach Wohnung und Datum.
export async function readInterimGaps(db: Executor): Promise<InterimGap[]> {
  const rows = await db.select().from(interimReadingGaps).orderBy(interimReadingGaps.unitId, interimReadingGaps.date)
  return rows.map((r) => ({ unitId: r.unitId, date: r.date, status: r.status, reason: r.reason }))
}

// Die Brennstofflieferungen samt Teilmengen (Heizung PR 7), die Teilmengen nach Beginn.
export async function readFuelDeliveries(db: Executor): Promise<FuelDelivery[]> {
  const rows = await db.select().from(fuelDeliveries).orderBy(INSERTION_ORDER)
  const parts = await db.select().from(fuelDeliveryParts).orderBy(fuelDeliveryParts.deliveryId, fuelDeliveryParts.from)
  const byDelivery = groupBy(parts, (p) => p.deliveryId, (p) => ({
    from: p.from, to: p.to, energyKwh: p.energyKwh, amountCents: p.amountCents, fixedCents: p.fixedCents, emissionsKg: p.emissionsKg, co2CostCents: p.co2CostCents,
  }))
  return rows.map((d) => ({ ...d, parts: byDelivery.get(d.id) ?? [] }))
}

// Was abgeschlossene Heizperioden je Lieferung eingefroren haben (Heizung PR 7, G-A4), mit Anlage und
// Heizperiode aus `heating_periods`.
export async function readFuelCarryFrozen(db: Executor): Promise<FrozenFuelCarry[]> {
  const rows = await db
    .select({ f: fuelCarryFrozen, plantId: heatingPeriods.plantId, period: heatingPeriods.period })
    .from(fuelCarryFrozen)
    .innerJoin(heatingPeriods, eq(fuelCarryFrozen.heatingPeriodId, heatingPeriods.id))
    .orderBy(sql`"fuel_carry_frozen".rowid`)
  return rows.map(({ f, plantId, period }) => ({
    deliveryId: f.deliveryId, plantId, period: periodKey(String(period)), cents: f.cents, emissionsKg: f.emissionsKg, co2Cents: f.co2Cents,
  }))
}

// Die Gradtagzahlen der Orte (Heizung PR 7), je Objekt nach Monat.
export async function readDegreeDayValues(db: Executor): Promise<(DegreeDayValue & { propertyId: string })[]> {
  return await db.select().from(degreeDayValues).orderBy(degreeDayValues.propertyId, degreeDayValues.month)
}

export async function readReadings(db: Executor): Promise<Reading[]> {
  const rows = await db.select().from(readings).orderBy(INSERTION_ORDER)
  return rows.map((r) => ({
    id: r.id,
    meterId: r.meterId,
    date: r.date,
    value: r.value,
    replacement: orUndefined(r.replacement),
    oldEndValue: orUndefined(r.oldEndValue),
    note: orUndefined(r.note),
    // Grenze einer Ablesung aus dem Mieterwechsel (Heizung PR 10), nur wenn gesetzt.
    ...(r.interimFor !== null ? { interimFor: r.interimFor } : {}),
  }))
}

export async function readPayments(db: Executor): Promise<Payment[]> {
  const rows = await db.select().from(payments).orderBy(INSERTION_ORDER)
  return rows.map((p) => ({
    id: p.id,
    tenancyId: p.tenancyId,
    date: p.date,
    amountCents: p.amountCents,
    note: orUndefined(p.note),
  }))
}

export async function readClosedSettlements(db: Executor): Promise<StoredClosedSettlement[]> {
  const rows = await db.select().from(closedSettlements).orderBy(INSERTION_ORDER)
  return rows.map((c) => ({
    id: c.id,
    propertyId: c.propertyId,
    period: c.period,
    closedAt: c.closedAt,
    sentAt: c.sentAt,
    // Derselbe Auszug wie auf dem Weg über die Datei (snapshot.ts). Zwei Leser desselben
    // Archivstücks, die sich bei krummem Inhalt uneinig sind, wären genau die Sorte Unterschied,
    // die beim Umstieg als „Abrechnung weicht ab“ auffällt und die dann niemand erklären kann.
    ...frozenSettlementOf(c.settlement),
    settlement: c.settlement,
  }))
}

// Die abgeschlossenen Heizkostenabrechnungen nach Weg d (Heizung PR 5), mit demselben Auszug aus dem
// Archivstück wie bei den Abrechnungen des Objekts.
export type StoredClosedHeatingSettlement = Omit<StoredClosedSettlement, 'propertyId'> & { plantId: string }

export async function readClosedHeatingSettlements(db: Executor): Promise<StoredClosedHeatingSettlement[]> {
  const rows = await db.select().from(closedHeatingSettlements).orderBy(INSERTION_ORDER)
  return rows.map((c) => ({
    id: c.id,
    plantId: c.plantId,
    period: c.period,
    closedAt: c.closedAt,
    sentAt: c.sentAt,
    ...frozenSettlementOf(c.settlement),
    settlement: c.settlement,
  }))
}

// Der ganze Bestand. Braucht ihn, wer rechnet (der Schnappschuss) oder wer ihn als Ganzes
// vergleicht (der Umstieg und sein Gleichstand).
export async function readStock(db: Executor): Promise<Stock> {
  return {
    properties: await readProperties(db),
    units: await readUnits(db),
    tenancies: await readTenancies(db),
    costItems: await readCostItems(db),
    meters: await readMeters(db),
    heatingPlants: await readHeatingPlants(db),
    co2Statements: await readCo2Statements(db),
    heatingPeriodRows: await readHeatingPeriodRows(db),
    interimGaps: await readInterimGaps(db),
    heatingServiceValues: await readHeatingServiceValues(db),
    fuelDeliveries: await readFuelDeliveries(db),
    fuelCarryFrozen: await readFuelCarryFrozen(db),
    degreeDayValues: await readDegreeDayValues(db),
    readings: await readReadings(db),
    payments: await readPayments(db),
    closedSettlements: await readClosedSettlements(db),
    closedHeatingSettlements: await readClosedHeatingSettlements(db),
    settings: await readSettings(db),
  }
}

// Die Einstellungen samt der beiden KI-Plätze.
//
// **Fehlt die Zeile, gelten die Vorgabewerte einer neuen Einrichtung.** Das ist der häufigste
// Fall überhaupt, nämlich jeder erste Start, denn die Zeile entsteht erst beim ersten Speichern.
// Früher beantwortete das `load()` in store.ts, indem es eine fehlende db.json mit `DEFAULT_DB`
// auffüllte; die Datenbank ist deren Nachfolgerin und antwortet deshalb genauso.
//
// Entschieden wird das an der **Zeile** und nie an einem Wert. Ein Feld, das der Nutzer geleert
// hat, bleibt leer; eine Adresse still durch die Voreinstellung zu ersetzen, wäre eine Änderung
// hinter seinem Rücken. Deshalb steht der Rückfall ganz oben und nicht als `?? ''` an jedem
// einzelnen Feld.
export async function readSettings(db: Executor): Promise<MigratedSettings> {
  const rows = await db.select().from(settings).orderBy(INSERTION_ORDER)
  const row = rows[0]
  if (!row) return migrateAi({ ...DEFAULT_SETTINGS })
  const slotRows = await db.select().from(aiSlots).orderBy(INSERTION_ORDER)
  const slotOf = (name: 'text' | 'images'): AiSlot | null => {
    const found = slotRows.find((s) => s.slot === name)
    if (!found) return null
    return { provider: found.provider, preset: found.preset, url: found.url, model: found.model, vision: found.vision }
  }
  const consent: Partial<Record<'text' | 'images', AiConsent>> = {}
  for (const slot of slotRows) {
    if (slot.consentUrl !== null && slot.consentModel !== null && slot.consentDate !== null) {
      consent[slot.slot] = { url: slot.consentUrl, model: slot.consentModel, date: slot.consentDate }
    }
  }
  // Ohne Zeile für den Standard-Platz gäbe es keinen Anbieter. Durch Mietfuchs selbst kann das
  // nicht entstehen: Einstellungen und Plätze werden immer zusammen in einer Transaktion
  // geschrieben. Ein Wert muss hier trotzdem stehen, weil der Typ einen verlangt, und die alten
  // Ollama-Felder derselben Zeile sind das Nächstliegende.
  const text = slotOf('text') ?? { provider: 'ollama', preset: 'ollama-local', url: row.ollamaUrl, model: row.ollamaModel, vision: null }
  const ai: AiSettings = {
    text,
    images: slotOf('images'),
    timeoutSeconds: row.aiTimeoutSeconds,
    numCtx: row.aiNumCtx,
    maxOutputTokens: row.aiMaxOutputTokens,
    pageImageEdge: row.aiPageImageEdge,
    jsonMode: row.aiJsonMode,
    reasoningEffort: row.aiReasoningEffort,
    extraInstructions: row.aiExtraInstructions,
    consent,
  }
  const stored: Settings = {
    houseName: row.houseName,
    address: row.address,
    landlordName: row.landlordName,
    iban: row.iban,
    paymentDeadlineDays: row.paymentDeadlineDays,
    ollamaUrl: row.ollamaUrl,
    ollamaModel: row.ollamaModel,
    // Diese vier gibt es nur, wenn ein Wert dasteht. Ein Feld mit dem Wert `undefined` wäre
    // etwas anderes als ein fehlendes Feld, sobald jemand zwei Stände vergleicht — und genau
    // das tut der Umstieg.
    ...(row.printAdjustSuggestion == null ? {} : { printAdjustSuggestion: row.printAdjustSuggestion }),
    ...(row.printAttachments == null ? {} : { printAttachments: row.printAttachments }),
    ...(row.updateCheck == null ? {} : { updateCheck: row.updateCheck }),
    ...(row.updateDismissed == null ? {} : { updateDismissed: row.updateDismissed }),
    ai,
  }
  return { ...stored, ai }
}
