// Die Heizanlage eines Objekts (Heizung PR 4, Entwurf 5.3, 11.2 und 13): anlegen, ändern,
// entfernen, und was davor geprüft wird.
//
// **Was eine Anlage in dieser Version tut:** Sie hält fest, womit geheizt wird, wer abrechnet,
// welche Wohnungen angeschlossen sind und ob die Geräte fernablesbar sind. Gerechnet wird damit nur
// die Fernablesbarkeit (remoteReading.ts); an der Verteilung ändert eine Anlage nichts, denn
// `manual` und `service` verteilen wie bisher (Entwurf 11.2, A2).
//
// **Was später kommt, lehnt der Server mit einem Satz ab** (Entwurf 13, W7): die eigene
// Heizkostenabrechnung (PR 10), Etagenheizungen auf Vertrag des Vermieters und eine zweite Anlage
// (PR 9), eine eigene Heizperiode und die getrennte Abrechnung (PR 5), die beheizte Fläche je
// Wohnung (PR 10). Ihre Spalten stehen schon da, damit diese PRs die Tabelle nicht neu bauen.
//
// **Die angeschlossenen Wohnungen** stehen in `heating_plant_units`. Ob es eine Liste gibt, sagt
// `units_limited`: Ohne Liste versorgt die Anlage alle Wohnungen des Objekts. Eigens gespeichert
// aus demselben Grund wie `participants_limited` bei den Kostenpositionen (#94): Ohne die Spalte
// sähe eine Anlage, deren letzte Wohnung gelöscht wurde, aus wie eine ohne Liste, und sie
// versorgte plötzlich das ganze Haus.
//
// Diese Datei importiert aus repository.ts, nie umgekehrt; die Prüfungen an Kostenpositionen und
// Zählern stehen dort, weil sie zum Verschmelzen dieser Sammlungen gehören.
import { and, count, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { AssignableHeatingItem, HeatingPlant, HeatingPlantUnit, PeriodKey, SelfSpanRange } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { plantRules } from '../../../shared/heatingPeriod.ts'
import { CO2_FUELS } from '../co2.ts'
import { STOCK_ENERGIES } from '../fuel.ts'
import { openCo2Periods } from './co2.ts'
import { parsePeriodKey, periodContaining, periodKey, periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { closedHeatingKeys, heatingPeriodClosed, plantContext } from './heatingPeriodContext.ts'
import type { Database, Executor } from './client.ts'
import { readHeatingPlants, readMeters, readProperties, readUnits } from './read.ts'
import { KWH_ENERGIES, openSelfSpan } from '../heating.ts'
import { SELF_VIA_SETUP, SelfItemsError, selfItemsOf } from './heatingSelf.ts'
import { hkvCutNotByConsumption } from '../../../shared/law/heizkostenv.ts'
import { dayAfter, LAW_AS_OF, valueAt } from '../../../shared/law/register.ts'
import { asNullableFilled, asNullableText, asText, guardServedChange, has, heatingPeriodAt, heatingRulesOf, HeatingError, insertEntityIn, ISO_DATE, merged, oneOfOrUndefined, raw, sameProperty } from './repository.ts'
import { buildingCycle, lineRoot, sameLine, servesUnit } from '../../../shared/heatingPeriod.ts'
import {
  AREA_BASES_HEAT, CAPTURE_METHODS, CHANGE_SPLITS, CO2_RESTRICTIONS, HEAT_GENERATIONS, HOT_WATER, fuelDeliveries, closedHeatingSettlementHistory, co2Statements, closedHeatingSettlements, closedSettlements, costItems, DEVICES_INSTALLED_AFTER, DEVICES_REMOTE, HEATING_ENERGIES, HEATING_METHODS,
  HEATING_SOURCES, HEATING_SUPPLIES, NEW_DEVICES_INSTALLS, heatingPeriodChanges, heatingPeriods, heatingPlants, heatingPlantUnits, heatingPrepaymentOverrides, heatingSelfSpans, heatingSeparateSpans, meters, units,
} from './schema.ts'

// Die Sätze der Sperren. Jeder sagt, was bis dahin geht.
const LATER = {
  rhythm: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen unter „Zeitraum der Heizung“ ein; eine Vorschau zeigt, was mit Ihren Heizpositionen geschieht.',
  separateVia: 'Ob die Heizkosten getrennt abgerechnet werden, stellen Sie bei einer eigenen Heizperiode unter „Getrennte Heizkostenabrechnung“ ein; eine Vorschau zeigt, wie die Vorauszahlung aufgeteilt wird.',
  capture: 'Heizkostenverteiler und die Werte eines Ablesedienstes wertet Mietfuchs mit einer späteren Version aus. Bis dahin rechnen Sie mit Wärmezählern ab oder übernehmen die Abrechnung des Messdienstes als Einzelbeträge.',
  dhwHeatingValue: 'Den Warmwasseranteil bei Heizöl, Flüssiggas, Pellets, Holz und Kohle rechnet Mietfuchs mit einer späteren Version; dafür braucht es den Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV). Bis dahin geht die eigene Abrechnung, wenn das Warmwasser getrennt oder gar nicht bereitet wird.',
}

// Der Verweis auf den Kesseltausch (Heizung PR 9) in den Sätzen, die einen Wechsel des Energieträgers sperren.
const SWAP_HINT = 'Wurde die Heizung erneuert, wählen Sie bei der Heizanlage „Heizung erneuert (Kessel getauscht)“: Dann endet die bisherige Anlage, und eine neue beginnt mit denselben Wohnungen.'

const nullableBoolean = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Die angeschlossenen Wohnungen aus dem Rumpf: jede einmal, eine beheizte Fläche nur als Zahl. Ein
// Eintrag ohne Kennung fällt weg.
function readPlantUnits(value: unknown): HeatingPlantUnit[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: HeatingPlantUnit[] = []
  for (const row of value) {
    const unitId = asNullableFilled(raw(row, 'unitId'))
    if (unitId === null || seen.has(unitId)) continue
    seen.add(unitId)
    result.push({ unitId, heatedAreaM2: nullableNumber(raw(row, 'heatedAreaM2')) })
  }
  return result
}

// Kennungen aus dem Rumpf, jede einmal.
function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((v) => asNullableText(v)).filter((v): v is string => v !== null && v !== ''))]
}

function mergeHeatingPlant(current: HeatingPlant, body: unknown): HeatingPlant {
  return {
    id: current.id,
    // Eine Anlage wechselt das Objekt nicht; wer umzieht, legt sie im anderen neu an.
    propertyId: current.propertyId,
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    energy: merged(body, 'energy', current.energy, (v) => oneOfOrUndefined(HEATING_ENERGIES, v) ?? current.energy),
    supply: merged(body, 'supply', current.supply, (v) => oneOfOrUndefined(HEATING_SUPPLIES, v) ?? current.supply),
    method: merged(body, 'method', current.method, (v) => oneOfOrUndefined(HEATING_METHODS, v) ?? current.method),
    separateSettlement: merged(body, 'separateSettlement', current.separateSettlement, nullableBoolean),
    devicesRemote: merged(body, 'devicesRemote', current.devicesRemote, (v) => oneOfOrUndefined(DEVICES_REMOTE, v) ?? current.devicesRemote),
    devicesInstalledAfter2021: merged(body, 'devicesInstalledAfter2021', current.devicesInstalledAfter2021, (v) => oneOfOrUndefined(DEVICES_INSTALLED_AFTER, v) ?? current.devicesInstalledAfter2021),
    newDevicesInstall: merged(body, 'newDevicesInstall', current.newDevicesInstall, (v) => oneOfOrUndefined(NEW_DEVICES_INSTALLS, v) ?? null),
    source: merged(body, 'source', current.source, (v) => oneOfOrUndefined(HEATING_SOURCES, v) ?? current.source),
    captureInstalledOn: merged(body, 'captureInstalledOn', current.captureInstalledOn, asNullableFilled),
    capturedOnOct2024: merged(body, 'capturedOnOct2024', current.capturedOnOct2024, nullableBoolean),
    warmRentAverageCents: merged(body, 'warmRentAverageCents', current.warmRentAverageCents, nullableNumber),
    changeSplit: merged(body, 'changeSplit', current.changeSplit, (v) => oneOfOrUndefined(CHANGE_SPLITS, v) ?? current.changeSplit),
    // CO₂-Merkmale (Heizung PR 7).
    nonResidential: merged(body, 'nonResidential', current.nonResidential, (v) => v === true),
    restriction: merged(body, 'restriction', current.restriction, (v) => oneOfOrUndefined(CO2_RESTRICTIONS, v) ?? current.restriction),
    districtEtsNew: merged(body, 'districtEtsNew', current.districtEtsNew, (v) => v === true),
    periodStartMonth: merged(body, 'periodStartMonth', current.periodStartMonth, nullableNumber),
    // Wechsel und Spannen setzen nur die Routen mit Vorschau (Heizung PR 5, Task 4 und 9).
    periodChanges: current.periodChanges,
    separateSpans: current.separateSpans,
    units: merged(body, 'units', current.units, (v) => (v === null ? null : readPlantUnits(v))),
    // Setzt nur der Kesseltausch (`replaceHeatingPlant`).
    endsOn: current.endsOn,
    replacesPlantId: current.replacesPlantId,
    buildingWith: merged(body, 'buildingWith', current.buildingWith, asNullableFilled),
    // Setzen nur der Kesseltausch und das Ändern einer Nachfolgerin (`takesOverStockOf`).
    takesOverStock: current.takesOverStock,
    // Eigene Heizkostenabrechnung (Heizung PR 10).
    hotWater: merged(body, 'hotWater', current.hotWater, (v) => oneOfOrUndefined(HOT_WATER, v) ?? current.hotWater),
    capture: merged(body, 'capture', current.capture, (v) => (v === null ? null : oneOfOrUndefined(CAPTURE_METHODS, v) ?? current.capture)),
    areaBasisHeat: merged(body, 'areaBasisHeat', current.areaBasisHeat, (v) => oneOfOrUndefined(AREA_BASES_HEAT, v) ?? current.areaBasisHeat),
    heatPumpInstalledOn: merged(body, 'heatPumpInstalledOn', current.heatPumpInstalledOn, asNullableFilled),
    // Warmwasser ohne Wärmezähler (Heizung PR 11): ein Erzeuger oder mehrere; Unbekanntes ist keine Antwort.
    heatGeneration: merged(body, 'heatGeneration', current.heatGeneration, (v) => oneOfOrUndefined(HEAT_GENERATIONS, v) ?? null),
    // Setzt nur die Einrichtung der eigenen Abrechnung; das Zurückschalten löscht ihn (updateHeatingPlant).
    selfSpans: current.selfSpans ?? [],
  }
}

// Der Energieträger hat keine Vorgabe; ohne ihn entsteht keine Anlage (createHeatingPlant).
const emptyHeatingPlant = (id: string, propertyId: string): HeatingPlant => ({
  id, propertyId, name: '', energy: 'other', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null,
  capturedOnOct2024: null, warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null,
  periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, selfSpans: [],
})

export async function guardHeatingPlant(db: Executor, before: HeatingPlant | null, after: HeatingPlant): Promise<void> {
  // Etagenheizung auf Vertrag des Vermieters (Heizung PR 9, Entwurf 9.3, 11.2): Die Rechnung jeder
  // Wohnung gehört direkt zu ihr, also freie Schlüssel mit Direktzuordnung. Vorratsenergien rechnet
  // Mietfuchs dafür nicht, denn der Vorrat hängt an der Anlage, nicht an der Wohnung (Festlegung 3).
  if (after.supply === 'perUnit') {
    if (after.method !== 'manual') {
      throw new HeatingError(400, 'Bei Etagenheizungen auf Ihren Namen ordnen Sie die Rechnung jeder Wohnung direkt dieser Wohnung zu; einen Messdienst oder eine eigene Heizkostenabrechnung gibt es dafür in Mietfuchs nicht.')
    }
    // Fernwärme bis in die Wohnung ist eine Wärmelieferung (§ 1 Abs. 1 Nr. 2 HeizkostenV), keine
    // Etagenheizung (Recht M5 der Durchsicht von #238).
    if (after.energy === 'districtHeating') {
      throw new HeatingError(400, 'Fernwärme ist keine Etagenheizung, auch wenn jede Wohnung eine eigene Übergabestation hat. Wählen Sie bei der Heizung „Fernwärme“.')
    }
    if (STOCK_ENERGIES.includes(after.energy)) {
      throw new HeatingError(400, 'Etagenheizungen mit eigenem Tank oder Lager je Wohnung (Heizöl, Flüssiggas, Pellets, Holz, Kohle) rechnet Mietfuchs nicht, denn der Vorrat wird je Heizanlage geführt. Erfassen Sie ihre Kosten wie bisher direkt bei der Wohnung.')
    }
  }
  // Den Rhythmus setzt nur der Wechsel mit Vorschau (heatingPeriodChange.ts, Heizung PR 5).
  if ((before?.periodStartMonth ?? null) !== after.periodStartMonth) throw new HeatingError(400, LATER.rhythm)
  // Mit eigener Heizperiode ändert die Antwort auf „getrennt abgerechnet?“ die Anrechnung der
  // Vorauszahlungen; das geht nur über die Vorschau (separateSettlement.ts). Ohne eigene Heizperiode
  // ist H = P, und die Antwort ist eine Angabe.
  if (before !== null && after.periodStartMonth !== null && before.separateSettlement !== after.separateSettlement) {
    throw new HeatingError(400, LATER.separateVia)
  }
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3, 8.1, 8.3, Abweichungen 10 und 17).
  if (after.method === 'self') {
    if (after.capture === null) throw new HeatingError(400, 'Bitte wählen Sie, womit der Verbrauch erfasst wird.')
    if (after.capture !== 'heatMeter') throw new HeatingError(400, LATER.capture)
    if (after.hotWater === 'combined' && !KWH_ENERGIES.includes(after.energy)) throw new HeatingError(400, LATER.dhwHeatingValue)
    if (after.areaBasisHeat === 'heatedArea' && (after.units === null || after.units.some((u) => u.heatedAreaM2 === null))) {
      throw new HeatingError(400, 'Für Grundkosten nach der beheizten Fläche nennen Sie die angeschlossenen Wohnungen und tragen bei jeder die beheizte Fläche ein.')
    }
  }
  if (after.heatPumpInstalledOn !== null && !ISO_DATE.test(after.heatPumpInstalledOn)) {
    throw new HeatingError(400, 'Das Einbaudatum der Wärmepumpe ist kein Datum. Bitte wählen Sie es im Kalender.')
  }
  if (after.source === 'homeowners' && after.method !== 'service') {
    throw new HeatingError(400, 'Rechnet die Gemeinschaft der Eigentümer ab, übernehmen Sie ihre Abrechnung wie die eines Messdienstes, als Einzelbeträge. Wählen Sie dafür „Die Gemeinschaft (Hausverwaltung) rechnet ab“.')
  }
  if (after.captureInstalledOn !== null && !ISO_DATE.test(after.captureInstalledOn)) {
    throw new HeatingError(400, 'Das Datum, seit dem der Verbrauch der Wärmepumpe erfasst wird, ist kein Datum. Bitte wählen Sie es im Kalender.')
  }
  if (after.warmRentAverageCents !== null && (!Number.isInteger(after.warmRentAverageCents) || after.warmRentAverageCents < 0)) {
    throw new HeatingError(400, 'Die durchschnittlichen Heizkosten der Jahre 2022 bis 2024 sind ein Betrag ab 0 €.')
  }
  // § 2 Abs. 4 Satz 2 CO2KostAufG betrifft nur Wärmelieferungen (Heizung PR 7).
  if (after.districtEtsNew && after.energy !== 'districtHeating') {
    throw new HeatingError(400, 'Die Angabe zur Wärme aus dem Emissionshandel gibt es nur bei Fernwärme.')
  }
  if (before !== null && before.supply !== after.supply) {
    // Zentral oder Etagenheizung (Heizung PR 9): Positionen und Rechnungen sind je nachdem anders
    // gebaut (Direktzuordnung, Wohnung an der Rechnung); ein Wechsel ließe sie still falsch stehen.
    const [posten] = await db.select({ n: count() }).from(costItems).where(eq(costItems.heatingPlantId, after.id))
    const [rechnungen] = await db.select({ n: count() }).from(fuelDeliveries).where(eq(fuelDeliveries.plantId, after.id))
    if ((posten?.n ?? 0) + (rechnungen?.n ?? 0) > 0) {
      throw new HeatingError(409, 'An dieser Heizanlage stehen schon Heizpositionen oder Rechnungen. Ob zentral oder je Wohnung geheizt wird, lässt sich dann nicht mehr ändern; legen Sie dafür eine weitere Heizanlage an.')
    }
  }
  if (before !== null) {
    // Verknüpfte Positionen gibt es nur bei freien Schlüsseln (Heizung PR 7); ein Wechsel ließe sie
    // sonst still anders rechnen.
    const [verknuepft] = await db.select({ n: count() }).from(costItems).innerJoin(fuelDeliveries, eq(costItems.fuelDeliveryId, fuelDeliveries.id)).where(eq(fuelDeliveries.plantId, after.id))
    // Heizung PR 10 (N6): Verknüpfte Positionen gibt es bei freien Schlüsseln und bei der eigenen
    // Heizkostenabrechnung; gesperrt ist nur der Wechsel zum Messdienst.
    if (before.method !== 'service' && after.method === 'service' && (verknuepft?.n ?? 0) > 0) {
      const n = verknuepft?.n ?? 0
      throw new HeatingError(400, `An dieser Anlage ${n === 1 ? 'ist eine Kostenposition' : `sind ${n} Kostenpositionen`} mit Lieferungen verknüpft. Lösen Sie die Verknüpfungen zuerst; ein Messdienst rechnet den Brennstoff in seinen eigenen Beträgen ab.`)
    }
    const [lieferungen] = await db.select({ n: count() }).from(fuelDeliveries).where(eq(fuelDeliveries.plantId, after.id))
    // Lieferungen mit Rechnungszeitraum (Gas, Fernwärme, Strom) und mit Lieferdatum für den Vorrat
    // (Heizung PR 8) sind verschieden gebaut; ein Wechsel dazwischen ließe sie still anders rechnen.
    const stockBefore = STOCK_ENERGIES.includes(before.energy)
    const stockAfter = STOCK_ENERGIES.includes(after.energy)
    // Auch ein eingetragener Vorrat zählt (Durchsicht von #237, M2; Nachprüfung: jeder, auch in einer
    // abgeschlossenen Heizperiode): Mit einem anderen Energieträger stimmte die Bestandsrechnung nicht mehr,
    // und eine wieder geöffnete Heizperiode rechnete ohne ihren Vorrat.
    if (before.energy !== after.energy && stockBefore && !stockAfter) {
      const [vorrat] = await db.select({ n: count() }).from(heatingPeriods)
        .where(and(eq(heatingPeriods.plantId, after.id), or(isNotNull(heatingPeriods.stockUnit), isNotNull(heatingPeriods.openingQuantity), isNotNull(heatingPeriods.closingQuantity))))
      if ((vorrat?.n ?? 0) > 0) {
        throw new HeatingError(409, `An dieser Anlage ist ein Vorrat eingetragen (Anfangs- oder Endbestand); mit einem anderen Energieträger stimmte die Bestandsrechnung nicht mehr. ${SWAP_HINT}`)
      }
    }
    if (before.energy !== after.energy && (stockBefore !== stockAfter || after.energy === 'other') && (lieferungen?.n ?? 0) > 0) {
      throw new HeatingError(400, stockBefore
        ? `An dieser Anlage stehen Lieferungen für den Vorrat (Lieferdatum und Menge); Gas, Fernwärme und Strom werden nach dem Rechnungszeitraum abgegrenzt. War der Energieträger falsch eingetragen, entfernen Sie die Lieferungen zuerst. ${SWAP_HINT}`
        : `An dieser Anlage stehen Lieferungen mit Rechnungszeitraum; Heizöl, Flüssiggas, Pellets, Holz und Kohle rechnet Mietfuchs über den Vorrat mit Lieferdatum und Menge. War der Energieträger falsch eingetragen, entfernen Sie die Lieferungen zuerst. ${SWAP_HINT}`)
    }
  }
  await sameProperty(db, after.propertyId, (after.units ?? []).map((u) => u.unitId), 'Die Heizanlage')
  // Gebäude (Heizung PR 9, Recht I3): eigenes oder das einer anderen Anlage desselben Objekts.
  if (after.buildingWith !== null && after.buildingWith !== 'own') {
    const [other] = await db.select({ propertyId: heatingPlants.propertyId }).from(heatingPlants).where(eq(heatingPlants.id, after.buildingWith))
    if (after.buildingWith === after.id || !other || other.propertyId !== after.propertyId) {
      throw new HeatingError(400, 'Die Anlage, in deren Gebäude diese Heizanlage stehen soll, gibt es in diesem Objekt nicht. Bitte wählen Sie erneut.')
    }
  }
}

// Die Pflichtfrage beim Anlegen einer weiteren Anlage (Heizung PR 9, Recht I3): Im selben Gebäude
// werden Anlagen gemeinsam eingestuft (§ 5 Abs. 1 Satz 1 und Satz 2 Halbsatz 2 CO2KostAufG: der Ausstoß
// „des Gebäudes“, die „Gesamtwohnfläche“ der Wohnungen „in einem Gebäude … mit gesonderter oder zentraler
// Versorgung“). Keine Vorbelegung: Die Antwort kennt nur der Vermieter.
const BUILDING_QUESTION = (names: string): string =>
  `Steht die neue Heizanlage im selben Gebäude wie ${names}? Bitte beantworten Sie die Frage; im selben Gebäude stuft Mietfuchs die Anlagen für die CO₂-Aufteilung gemeinsam ein.`

const NAME_REQUIRED = 'Bei mehreren Heizanlagen braucht jede einen Namen, etwa „Haus A“ oder „Gastherme EG“.'

// Ab zwei Anlagen in einem Objekt (Heizung PR 9, Entwurf 5.3): jede mit Namen, verschieden im Objekt,
// jede mit ihrer Liste der Wohnungen, und keine Wohnung an zweien. Sonst verteilten zwei Anlagen
// dieselben Kosten auf dieselben Mieter, und Hinweise und Ausweis könnten sie nicht auseinanderhalten.
// Geprüft wird über alle Anlagen des Objekts **nach** dem Schreiben, in derselben Transaktion; scheitert
// die Prüfung, wird nichts gespeichert. Mit einer Anlage gilt nichts davon.
export async function guardPlantsOfProperty(db: Executor, propertyId: string): Promise<void> {
  const plants = await db
    .select({ id: heatingPlants.id, name: heatingPlants.name, unitsLimited: heatingPlants.unitsLimited, replacesPlantId: heatingPlants.replacesPlantId, buildingWith: heatingPlants.buildingWith })
    .from(heatingPlants)
    .where(eq(heatingPlants.propertyId, propertyId))
    .orderBy(heatingPlants.id)
  if (plants.length < 2) return
  // Gebäude (Nachprüfung von #238, I-C): Verweisen die Angaben im Kreis aufeinander, gäbe es keine Anlage,
  // von der das Gebäude ausgeht. Die Anlagen stehen dann ohnehin im selben Gebäude.
  const cycle = buildingCycle(plants)
  if (cycle !== null) {
    const names = cycle.map((id) => `„${plants.find((p) => p.id === id)?.name.trim() || 'ohne Namen'}“`)
    throw new HeatingError(400, `Die Angaben zum Gebäude verweisen im Kreis aufeinander (${names.join(' → ')} → ${names[0] ?? ''}). Diese Heizanlagen stehen damit schon im selben Gebäude; die Angabe hier ist nicht nötig. Gespeichert wurde nichts.`)
  }
  const seen = new Set<string>()
  for (const p of plants) {
    const name = p.name.trim()
    if (name === '') throw new HeatingError(400, NAME_REQUIRED)
    const key = name.toLocaleLowerCase('de-DE')
    if (seen.has(key)) throw new HeatingError(400, `Zwei Heizanlagen heißen „${name}“. Bitte geben Sie ihnen verschiedene Namen.`)
    seen.add(key)
    if (!p.unitsLimited) {
      throw new HeatingError(400, `Bei mehreren Heizanlagen braucht jede ihre Wohnungen. Wählen Sie bei „${name}“ aus, welche Wohnungen an ihr hängen.`)
    }
  }
  const rows = await db
    .select({ plantId: heatingPlantUnits.plantId, unitId: units.id, unitName: units.name })
    .from(heatingPlantUnits)
    .innerJoin(units, eq(heatingPlantUnits.unitId, units.id))
    .where(inArray(heatingPlantUnits.plantId, plants.map((p) => p.id)))
  const nameOf = new Map(plants.map((p) => [p.id, p.name.trim()]))
  const owner = new Map<string, string>()
  for (const r of rows) {
    const first = owner.get(r.unitId)
    // Nach einem Kesseltausch heizen alte und neue Anlage dieselben Wohnungen nacheinander, auch über
    // mehrere Täusche (Durchsicht von #238, C1).
    const a = plants.find((p) => p.id === first)
    const b = plants.find((p) => p.id === r.plantId)
    if (first !== undefined && first !== r.plantId && !(a && b && sameLine(a, b, plants))) {
      throw new HeatingError(400, `Die Wohnung „${r.unitName}“ hängt an „${nameOf.get(first) ?? ''}“ und an „${nameOf.get(r.plantId) ?? ''}“. Jede Wohnung hängt an genau einer Heizanlage.`)
    }
    owner.set(r.unitId, r.plantId)
  }
}

// Name und Wohnungen anderer Anlagen desselben Objekts, die mit dem Anlegen geändert werden (Heizung
// PR 9): So bekommt die erste Anlage beim Anlegen der zweiten Namen und Grenzen im selben Schritt.
// Andere Felder einer Anlage ändert nur `updateHeatingPlant`.
function readAdjust(value: unknown): { id: string; body: Record<string, unknown> }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row: unknown) => {
    const id = asNullableFilled(raw(row, 'id'))
    if (id === null) return []
    const body: Record<string, unknown> = {}
    if (has(row, 'name')) body.name = raw(row, 'name')
    if (has(row, 'units')) body.units = raw(row, 'units')
    return [{ id, body }]
  })
}

export const plantRow = (p: HeatingPlant) => ({
  id: p.id, propertyId: p.propertyId, name: p.name, energy: p.energy, supply: p.supply, method: p.method,
  separateSettlement: p.separateSettlement, devicesRemote: p.devicesRemote, devicesInstalledAfter2021: p.devicesInstalledAfter2021,
  newDevicesInstall: p.newDevicesInstall,
  source: p.source, captureInstalledOn: p.captureInstalledOn, capturedOnOct2024: p.capturedOnOct2024,
  warmRentAverageCents: p.warmRentAverageCents, changeSplit: p.changeSplit, periodStartMonth: p.periodStartMonth,
  unitsLimited: p.units !== null,
  nonResidential: p.nonResidential, restriction: p.restriction, districtEtsNew: p.districtEtsNew,
  endsOn: p.endsOn, replacesPlantId: p.replacesPlantId, buildingWith: p.buildingWith, takesOverStock: p.takesOverStock,
  hotWater: p.hotWater, capture: p.capture, areaBasisHeat: p.areaBasisHeat, heatPumpInstalledOn: p.heatPumpInstalledOn,
  heatGeneration: p.heatGeneration,
})

// Die Zeiträume der eigenen Heizkostenabrechnung, ganz ersetzt wie die Liste der Wohnungen (Durchsicht von #239).
export async function writeSelfSpans(tx: Executor, plantId: string, spans: readonly SelfSpanRange[]): Promise<void> {
  await tx.delete(heatingSelfSpans).where(eq(heatingSelfSpans.plantId, plantId))
  if (spans.length > 0) await tx.insert(heatingSelfSpans).values(spans.map((s) => ({ plantId, from: s.from, until: s.until })))
}

// Die Liste der Wohnungen, ganz ersetzt wie die Untertabellen in repository.ts.
async function writePlantUnits(db: Executor, p: HeatingPlant): Promise<void> {
  await db.delete(heatingPlantUnits).where(eq(heatingPlantUnits.plantId, p.id))
  const rows = p.units ?? []
  if (rows.length > 0) await db.insert(heatingPlantUnits).values(rows.map((u) => ({ plantId: p.id, unitId: u.unitId, heatedAreaM2: u.heatedAreaM2 })))
}

export async function listHeatingPlants(db: Database, propertyId: string): Promise<HeatingPlant[]> {
  return (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
}

// Heizpositionen, die beim Anlegen zugeordnet werden können (Entwurf 3.0, 11.2): Kostenart Heizung
// und Warmwasser, noch ohne Anlage, in einem Zeitraum, der nicht abgeschlossen ist. Abgeschlossene
// bekommen keine Anlage, denn der eingefrorene Stand bleibt maßgeblich.
async function assignableIn(db: Executor, propertyId: string): Promise<AssignableHeatingItem[]> {
  const offen = await db
    .select({ id: costItems.id, period: costItems.period, description: costItems.description, amountCents: costItems.amountCents })
    .from(costItems)
    .where(and(eq(costItems.propertyId, propertyId), eq(costItems.category, HEATING_CATEGORY), isNull(costItems.heatingPlantId)))
    .orderBy(costItems.period, costItems.description)
  const zu = new Set(
    (await db.select({ period: closedSettlements.period }).from(closedSettlements).where(eq(closedSettlements.propertyId, propertyId)))
      .map((c) => String(c.period)),
  )
  return offen
    .filter((c) => !zu.has(String(c.period)))
    .map((c) => ({ id: c.id, period: periodKey(String(c.period)), description: c.description, amountCents: c.amountCents }))
}

export const assignableHeatingItems = (db: Database, propertyId: string): Promise<AssignableHeatingItem[]> => assignableIn(db, propertyId)

// Anlegen samt Zuordnung der Positionen aus der Vorschau, in einer Transaktion. Steht in
// `assignItemIds` eine Position, die nicht mehr zuzuordnen ist (inzwischen abgeschlossen,
// gelöscht oder schon zugeordnet), entsteht nichts, und die Vorschau ist neu zu laden.
export async function createHeatingPlant(db: Database, id: string, propertyId: string, body: unknown): Promise<{ plant: HeatingPlant; assigned: number }> {
  if (oneOfOrUndefined(HEATING_ENERGIES, raw(body, 'energy')) === undefined) {
    throw new HeatingError(400, 'Womit wird geheizt? Bitte wählen Sie den Energieträger der Anlage.')
  }
  const plant = mergeHeatingPlant(emptyHeatingPlant(id, propertyId), body)
  // Zur eigenen Heizkostenabrechnung nur über die Einrichtung (Heizung PR 10, Abweichung 17): Anteil,
  // Zähler und Umstellung der Positionen entstehen dort in einer Transaktion.
  if (plant.method === 'self') throw new HeatingError(400, SELF_VIA_SETUP)
  const wanted = readIds(raw(body, 'assignItemIds'))
  const adjust = readAdjust(raw(body, 'adjust'))
  const others = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
  const running = others.filter((p) => p.endsOn === null)
  if (running.length > 0 && plant.buildingWith === null) {
    throw new HeatingError(400, BUILDING_QUESTION(running.map((p) => `„${p.name.trim() || 'der bisherigen Heizanlage'}“`).join(' oder ')))
  }
  const allUnits = await readUnits(db)
  await db.transaction(async (tx) => {
    // Heizung PR 9: erst die übrigen Anlagen des Objekts anpassen, dann die neue anlegen, dann alle
    // zusammen prüfen.
    for (const a of adjust) {
      const current = others.find((p) => p.id === a.id)
      if (!current) {
        throw new HeatingError(409, 'Eine andere Heizanlage dieses Objekts gibt es nicht mehr. Bitte öffnen Sie die Einrichtung erneut; angelegt wurde nichts.')
      }
      const next = mergeHeatingPlant(current, a.body)
      await guardHeatingPlant(tx, current, next)
      // Dieselbe Sperre wie beim Ändern (Durchsicht von #231, Critical 1): Wohnungen, die die Anlage
      // danach anders versorgt.
      await guardServedChange(tx, current.id, allUnits.filter((u) => u.propertyId === propertyId && servesUnit(current, u) !== servesUnit(next, u)).map((u) => u.id))
      const { id: _id, ...rest } = plantRow(next)
      await tx.update(heatingPlants).set(rest).where(eq(heatingPlants.id, current.id))
      await writePlantUnits(tx, next)
    }
    await guardHeatingPlant(tx, null, plant)
    await tx.insert(heatingPlants).values(plantRow(plant))
    await writePlantUnits(tx, plant)
    const offen = new Set((await assignableIn(tx, propertyId)).map((c) => c.id))
    if (wanted.some((w) => !offen.has(w))) {
      throw new HeatingError(409, 'Die Heizpositionen haben sich geändert, seit die Vorschau geladen wurde. Bitte öffnen Sie die Einrichtung erneut; angelegt wurde nichts.')
    }
    if (wanted.length > 0) await tx.update(costItems).set({ heatingPlantId: id }).where(inArray(costItems.id, wanted))
    await guardPlantsOfProperty(tx, propertyId)
  })
  const gespeichert = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!gespeichert) throw new Error('Die Heizanlage ist nach dem Anlegen nicht auffindbar.')
  return { plant: gespeichert, assigned: wanted.length }
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function updateHeatingPlant(db: Database, id: string, body: unknown): Promise<HeatingPlant | null> {
  const current = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!current) return null
  const all = (await readHeatingPlants(db)).filter((p) => p.propertyId === current.propertyId)
  const next = { ...mergeHeatingPlant(current, body), takesOverStock: await takesOverStockOf(db, current, all, body) }
  // Zur eigenen Heizkostenabrechnung nur über die Einrichtung (Heizung PR 10, Abweichung 17).
  if (next.method === 'self' && current.method !== 'self') throw new HeatingError(400, SELF_VIA_SETUP)
  // Zurück von der eigenen Abrechnung: Die Positionen offener Zeiträume brauchen einen anderen
  // Schlüssel. Ohne Bestätigung 409 mit der Liste und den Folgen (§ 12 Abs. 1, § 6 Abs. 4); mit
  // `convertItems: 'area'` werden sie in derselben Transaktion nach Wohnfläche verteilt (Abweichung 17).
  const zurueck = current.method === 'self' && next.method !== 'self'
  // Durchsicht von #239, W1: Zurück heißt, der Beginn entfällt, und die Anteile offener Heizperioden ab ihm
  // werden geleert; die abgeschlossener bleiben, denn sie stehen in zugestellten Abrechnungen.
  // Runde 3: Bleiben abgeschlossene Heizperioden der eigenen Abrechnung, endet sie mit der ersten offenen
  // (`selfTo`), statt zu verschwinden; sonst rechnete die heutige Abrechnung sie anders als zugestellt.
  // Eine abgeschlossene nach einer offenen ließe sich so nicht beschreiben; dann zuerst abschließen.
  const open = zurueck ? openSelfSpan(current) : null
  const span = open ? await selfSpanEnd(db, id, open.from) : null
  if (span && span.closedAfter !== null) {
    throw new HeatingError(409, `Die Heizperiode ${span.closedAfter.slice(0, 4)} ist abgeschlossen, die Heizperiode ${(span.to ?? '').slice(0, 4)} davor nicht. Schließen Sie diese zuerst ab oder öffnen Sie die spätere wieder, bevor Sie die eigene Heizkostenabrechnung beenden.`)
  }
  if (zurueck) {
    const rest = (current.selfSpans ?? []).filter((s) => s.until !== null)
    next.selfSpans = open && span?.to && span.to !== open.from ? [...rest, { from: open.from, until: span.to }] : rest
  }
  const clearShares = zurueck ? await openShareRowsFrom(db, id, open?.from ?? null) : []
  const offen = zurueck ? await selfItemsOf(db, id, null, 'heatingSystem') : []
  if (offen.length > 0 && raw(body, 'convertItems') !== 'area') {
    throw new SelfItemsError(
      `Diese Heizanlage hat ${offen.length === 1 ? 'eine Position' : `${offen.length} Positionen`} in offenen Zeiträumen, die nach der Heizkostenverordnung verteilt ${offen.length === 1 ? 'wird' : 'werden'}. Bestätigen Sie, dass sie künftig nach Wohnfläche verteilt ${offen.length === 1 ? 'wird' : 'werden'}; prüfen Sie danach die Schlüssel. ` +
        `Fällt die Anlage unter die Heizkostenverordnung, verteilen Sie damit nicht nach Verbrauch, und jeder Mieter darf seinen Anteil um ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen (§ 12 Abs. 1 Satz 1 HeizkostenV). ` +
        'Einen anderen Abrechnungsmaßstab dürfen Sie nur für künftige Abrechnungszeiträume und zu ihrem Beginn wählen, durch Erklärung gegenüber den Mietern (§ 6 Abs. 4 HeizkostenV). ' +
        'Die Anteile nach Verbrauch der offenen Heizperioden werden dabei verworfen; abgeschlossene Heizperioden rechnen weiter nach der Heizkostenverordnung, wie sie zugestellt wurden.',
      offen,
    )
  }
  // Gebäude (Nachprüfung von #238): Neben einer laufenden Anlage gibt es „nicht gefragt“ nicht mehr, wenn die
  // Frage einmal beantwortet war.
  const running = all.filter((p) => p.id !== id && p.endsOn === null && !sameLine(p, current, all))
  if (current.buildingWith !== null && next.buildingWith === null && running.length > 0) {
    throw new HeatingError(400, `Steht diese Heizanlage im selben Gebäude wie ${running.map((p) => `„${p.name.trim() || 'die andere Heizanlage'}“`).join(' oder ')}? Bitte wählen Sie eine Antwort; neben einer laufenden Heizanlage braucht Mietfuchs sie für die CO₂-Aufteilung.`)
  }
  // Welche Wohnungen die Anlage danach anders versorgt (Durchsicht von #231, Critical 1).
  const changed = (await readUnits(db)).filter((u) => u.propertyId === current.propertyId && servesUnit(current, u) !== servesUnit(next, u)).map((u) => u.id)
  const openCo2 = await openCo2Periods(db, id)
  await db.transaction(async (tx) => {
    await guardHeatingPlant(tx, current, next)
    // Verheizt die neue Anlage den Brennstoff doch weiter, gilt kein eigener Anfangsbestand mehr in ihrer
    // ersten Heizperiode; er stammt dann aus dem Restbestand der alten.
    const first = next.takesOverStock === true && current.takesOverStock === false ? await firstPeriodOf(tx, all, current) : null
    if (first) {
      await tx.update(heatingPeriods).set({ openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null })
        .where(and(eq(heatingPeriods.plantId, id), eq(heatingPeriods.period, first.key)))
    }
    await guardServedChange(tx, id, changed)
    guardCo2Plant(current, next, openCo2)
    const { id: _id, ...rest } = plantRow(next)
    await tx.update(heatingPlants).set(rest).where(eq(heatingPlants.id, id))
    for (const c of offen) {
      await tx.update(costItems).set({ key: 'area', heatingTarget: null }).where(eq(costItems.id, c.id))
    }
    for (const rowId of clearShares) {
      await tx.update(heatingPeriods).set({ heatConsumptionPct: null, waterConsumptionPct: null, insulationRule: null }).where(eq(heatingPeriods.id, rowId))
    }
    await writePlantUnits(tx, next)
    if (zurueck) await writeSelfSpans(tx, id, next.selfSpans ?? [])
    await guardPlantsOfProperty(tx, current.propertyId)
  })
  return (await readHeatingPlants(db)).find((p) => p.id === id) ?? null
}

// Die erste offene Heizperiode ab `from` und, falls danach noch eine abgeschlossene kommt, deren Schlüssel
// (Runde 3).
async function selfSpanEnd(db: Database, plantId: string, from: string | null): Promise<{ to: string | null; closedAfter: string | null } | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx || from === null) return null
  const closed = new Set(await closedHeatingKeys(db, ctx))
  const key = parsePeriodKey(from)
  let h = key === null ? null : periodOfKey(ctx.plantRules, key)
  while (h && closed.has(String(h.key))) h = periodContaining(ctx.plantRules, dayAfter(h.to))
  const to = h ? String(h.key) : null
  const closedAfter = to === null ? null : ([...closed].filter((k) => k > to).sort()[0] ?? null)
  return { to, closedAfter }
}

// Die Zeilen offener Heizperioden ab `from` mit einem Anteil (Durchsicht von #239, W1).
async function openShareRowsFrom(db: Database, plantId: string, from: string | null): Promise<string[]> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return []
  const rows = await db.select({ id: heatingPeriods.id, period: heatingPeriods.period, pct: heatingPeriods.heatConsumptionPct }).from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const out: string[] = []
  for (const r of rows) {
    if (r.pct === null || (from !== null && String(r.period) < from)) continue
    const key = parsePeriodKey(String(r.period))
    const h = key === null ? null : periodOfKey(ctx.plantRules, key)
    if (h && (await heatingPeriodClosed(db, ctx, h))) continue
    out.push(r.id)
  }
  return out
}

// Die erste Heizperiode einer Nachfolgerin und die letzte ihrer Vorgängerin (Kesseltausch).
async function firstPeriodOf(db: Executor, plants: readonly HeatingPlant[], plant: HeatingPlant): Promise<{ key: PeriodKey; closed: boolean; lastClosed: boolean } | null> {
  const before = plants.find((p) => p.id === plant.replacesPlantId)
  if (!before?.endsOn) return null
  const first = await heatingPeriodAt(db, plant.id, isoDayAfter(before.endsOn))
  const last = await heatingPeriodAt(db, before.id, before.endsOn)
  return first ? { key: first.period.key, closed: first.closed, lastClosed: last?.closed ?? false } : null
}

// Die Antwort auf „Verheizt der neue Kessel den Brennstoff im Tank weiter?“ (Nachprüfung von #238). Es gibt
// sie nur an einer Nachfolgerin mit demselben Vorratsbrennstoff; ändern lässt sie sich, solange weder die
// letzte Heizperiode der alten noch die erste der neuen abgeschlossen ist, denn beide rechnen damit.
async function takesOverStockOf(db: Executor, current: HeatingPlant, plants: readonly HeatingPlant[], body: unknown): Promise<boolean | null> {
  if (!has(body, 'takesOverStock')) return current.takesOverStock
  const v = raw(body, 'takesOverStock')
  // Ohne Antwort gilt ja; dieselbe Antwort ändert nichts.
  if (typeof v !== 'boolean' || v === (current.takesOverStock ?? true)) return current.takesOverStock
  const before = plants.find((p) => p.id === current.replacesPlantId)
  if (!before || before.energy !== current.energy || !STOCK_ENERGIES.includes(current.energy)) {
    throw new HeatingError(400, 'Ob die neue Heizanlage den Brennstoff im Tank weiter verheizt, fragt Mietfuchs nur nach einem Kesseltausch mit demselben Brennstoff.')
  }
  const first = await firstPeriodOf(db, plants, current)
  if (first?.closed || first?.lastClosed) {
    throw new HeatingError(409, 'Die Heizperiode des Tauschs ist abgeschlossen; sie rechnet mit der bisherigen Antwort, ob die neue Heizanlage den Brennstoff im Tank weiter verheizt. Öffnen Sie die Abrechnung wieder, um sie zu ändern.')
  }
  return v
}

// Mit CO₂-Angaben (Heizung PR 6, Durchsicht M-3) gelten sie nur für eine Anlage beim Messdienst mit
// einem Energieträger, für den CO₂-Kosten anfallen können. Ein Wechsel weg davon ließe sie still
// stehen; ein vertippter Brennstoff (Öl statt Gas) bleibt änderbar. Gezählt werden nur Heizperioden, die
// nicht abgeschlossen sind: Nur deren Angaben lassen sich entfernen, die übrigen sind eingefroren.
function guardCo2Plant(current: HeatingPlant, next: HeatingPlant, openCo2: readonly string[]): void {
  const leavesService = current.method === 'service' && next.method !== 'service'
  const leavesCo2 = next.energy !== current.energy && !CO2_FUELS.includes(next.energy) && next.energy !== 'districtHeating'
  if ((!leavesService && !leavesCo2) || openCo2.length === 0) return
  throw new HeatingError(409,
    `Zu dieser Heizanlage sind CO₂-Angaben erfasst (Heizperiode ${openCo2.join(', ')}). ` +
      `${leavesService ? 'Sie gelten nur für eine Anlage, die ein Messdienst oder die Gemeinschaft abrechnet' : 'Sie gelten nur für einen Energieträger, für den CO₂-Kosten anfallen'}. ` +
      'Entfernen Sie die Angaben auf der Seite Heizkosten, wenn die Änderung so stimmt; gespeichert wurde nichts.')
}

// ---------- Kesseltausch (Heizung PR 9) ----------

const ENERGY_NAMES: Record<HeatingPlant['energy'], string> = {
  gas: 'Gas', oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Pellets', wood: 'Holz', districtHeating: 'Fernwärme', heatPump: 'Wärmepumpe', electric: 'Strom', coal: 'Kohle', other: 'Heizung',
}
const isoDayBefore = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const isoDayAfter = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const germanDay = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Was der Rumpf des Kesseltauschs an der neuen Anlage setzen darf; alles andere übernimmt sie von der
// alten (Gebäude, Geräte, Rhythmus, Merkmale nach § 8 und § 9 CO2KostAufG).
const SWAP_FIELDS = ['name', 'energy', 'method', 'source', 'devicesRemote', 'devicesInstalledAfter2021', 'newDevicesInstall', 'captureInstalledOn', 'capturedOnOct2024', 'warmRentAverageCents', 'districtEtsNew'] as const

// Der Kesseltausch (Heizung PR 9): Die bisherige Anlage endet am Tag vor `date`, eine neue beginnt an
// `date` mit denselben Wohnungen. Beide bekommen einen Namen und die Liste der Wohnungen, denn ab dann
// stehen zwei Anlagen im Objekt; die Wohnungen dürfen sie teilen, weil sie nacheinander heizen.
// Lieferungen, Positionen, Vorrat und CO₂-Angaben bleiben bei der alten Anlage. Ein Restbestand im
// Vorrat ist der Endbestand ihrer letzten Heizperiode; die Abrechnung weist ihn beim Vermieter aus.
// `null`, wenn es die Anlage nicht gibt.
export async function replaceHeatingPlant(db: Database, oldId: string, newId: string, body: unknown): Promise<{ plant: HeatingPlant; previous: HeatingPlant } | null> {
  const plants = await readHeatingPlants(db)
  const old = plants.find((p) => p.id === oldId)
  if (!old) return null
  const date = asNullableFilled(raw(body, 'date'))
  if (date === null || !ISO_DATE.test(date)) {
    throw new HeatingError(400, 'Der Tag, an dem die neue Heizung in Betrieb ging, ist kein Datum. Bitte wählen Sie ihn im Kalender.')
  }
  if (old.endsOn !== null) {
    throw new HeatingError(409, `Die Heizanlage ${plantName(old.name)} ist schon außer Betrieb (letzter Betriebstag ${germanDay(old.endsOn)}). Erfassen Sie den Tausch bei der Anlage, die sie ersetzt hat.`)
  }
  if (old.supply === 'perUnit') {
    throw new HeatingError(400, 'Bei einer Etagenheizung erfasst Mietfuchs keinen Kesseltausch. Wechselt eine Therme den Energieträger, ändern Sie ihn an der Anlage; die Rechnungen gehören ohnehin je zu einer Wohnung.')
  }
  if (old.separateSpans.length > 0) {
    throw new HeatingError(400, 'Werden die Heizkosten getrennt abgerechnet, erfasst Mietfuchs einen Kesseltausch noch nicht; das kommt mit einer späteren Version. Schalten Sie bis dahin die getrennte Heizkostenabrechnung aus.')
  }
  const newEnergy = oneOfOrUndefined(HEATING_ENERGIES, raw(body, 'energy'))
  if (newEnergy === undefined) {
    throw new HeatingError(400, 'Womit heizt die neue Anlage? Bitte wählen Sie ihren Energieträger.')
  }
  // Gleicher Energieträger über einen Zähler (Gas, Fernwärme, Strom; Recht I1 der Durchsicht von #238):
  // Die Rechnungen laufen weiter wie bisher, ein Tausch würde die Jahresrechnung nur zerschneiden. Bei
  // einer Vorratsenergie geht der Restbestand dagegen an die neue Anlage über (siehe Abrechnung).
  if (newEnergy === old.energy && !STOCK_ENERGIES.includes(old.energy)) {
    throw new HeatingError(409, 'Bleibt der Energieträger gleich und läuft er über denselben Zähler, brauchen Sie keinen Tausch; ändern Sie nur die Angaben der Anlage.')
  }
  const endsOn = isoDayBefore(date)
  // Lieferungen der alten Anlage nach dem Tausch gehörten zur neuen.
  for (const d of await db.select().from(fuelDeliveries).where(eq(fuelDeliveries.plantId, oldId))) {
    const last = d.deliveredAt ?? d.invoiceTo ?? d.invoiceFrom
    if (last !== null && last > endsOn) {
      throw new HeatingError(400, `Die Lieferung „${d.label || 'Lieferung'}“ der bisherigen Anlage reicht bis ${germanDay(last)} und liegt damit nach dem Tausch. Prüfen Sie den Tag des Tauschs, oder ordnen Sie die Lieferung zuerst richtig zu.`)
    }
  }
  // Abgeschlossene Heizperioden (Durchsicht von #238, M2): Endet die alte Anlage genau am Ende einer
  // abgeschlossenen Heizperiode, ändert sich darin nichts, und der Tausch zum Ersten geht ohne Wiederöffnen.
  // Gesperrt ist ein Tausch mitten in einer abgeschlossenen und vor einer abgeschlossenen späteren.
  const at = await heatingPeriodAt(db, oldId, endsOn)
  if (at?.closed && at.period.to !== endsOn) {
    throw new HeatingError(409, `Der Tausch fällt in die abgeschlossene Heizperiode ${periodLabel(at.period)}. Öffnen Sie die Abrechnung wieder, um ihn zu erfassen.`)
  }
  const heating = await heatingRulesOf(db, oldId)
  const later = heating ? await heatingPeriodAt(db, oldId, date) : null
  if (later?.closed) {
    throw new HeatingError(409, `Die Heizperiode ${periodLabel(later.period)} nach dem Tausch ist schon abgeschlossen; sie rechnet mit der bisherigen Anlage. Öffnen Sie die Abrechnung wieder, um den Tausch zu erfassen.`)
  }
  // Angaben der alten Anlage für Zeiträume ganz nach dem Tausch (Durchsicht von #238, M1): Positionen,
  // CO₂-Angaben und Vorrat gehörten dann zur neuen. Mietfuchs hängt sie nicht still um.
  if (heating) {
    const after = (key: string): boolean => (periodOfKey(heating.rules, parsePeriodKey(key) ?? periodKey('1900-01'))?.from ?? '') > endsOn
    const posten = (await db.select({ period: costItems.period, description: costItems.description }).from(costItems).where(eq(costItems.heatingPlantId, oldId)))
      .filter((c) => after(String(c.period)))
    const zeilen = (await db.select({ period: heatingPeriods.period }).from(heatingPeriods).where(eq(heatingPeriods.plantId, oldId)))
      .filter((h) => after(String(h.period)))
    if (posten.length > 0 || zeilen.length > 0) {
      const was = posten.length > 0 ? `die Position ${posten.map((c) => `„${c.description}“`).join(', ')}` : `Angaben zur Heizperiode ${zeilen.map((h) => String(h.period)).join(', ')}`
      throw new HeatingError(409, `An der bisherigen Anlage stehen ${was} für die Zeit nach dem Tausch. Ordnen Sie sie zuerst richtig zu oder entfernen Sie sie; gespeichert wurde nichts.`)
    }
  }
  const served = (await readUnits(db)).filter((u) => u.propertyId === old.propertyId && servesUnit(old, u)).map((u) => ({ unitId: u.id, heatedAreaM2: null }))
  const picked: Record<string, unknown> = {}
  for (const k of SWAP_FIELDS) if (has(body, k)) picked[k] = raw(body, k)
  const base: HeatingPlant = { ...old, id: newId, name: '', separateSpans: [], units: served, endsOn: null, replacesPlantId: oldId, takesOverStock: null,
    // Der Beginn der eigenen Abrechnung geht nur mit, wenn die alte Anlage selbst abrechnet (Runde 3).
    selfSpans: openSelfSpan(old) ? [{ from: openSelfSpan(old)?.from ?? '', until: null }] : [] }
  const merged = mergeHeatingPlant(base, picked)
  // Zur eigenen Heizkostenabrechnung nur über die Einrichtung (Heizung PR 10); eine Anlage, die schon
  // selbst abrechnet, gibt die Art an die neue weiter.
  if (merged.method === 'self' && old.method !== 'self') throw new HeatingError(400, SELF_VIA_SETUP)
  // Die Angabe zum Emissionshandel gilt nur für eine Wärmelieferung. Bei demselben Vorratsbrennstoff die
  // Frage, ob die neue Anlage ihn weiter verheizt (Nachprüfung von #238); ohne Antwort ja.
  const answer = raw(body, 'takesOverStock')
  const plant: HeatingPlant = {
    ...merged,
    name: merged.name.trim() || `${ENERGY_NAMES[merged.energy]} ab ${germanDay(date)}`,
    districtEtsNew: merged.energy === 'districtHeating' && merged.districtEtsNew,
    takesOverStock: merged.energy === old.energy && STOCK_ENERGIES.includes(old.energy) ? answer !== false : null,
  }
  const previousName = asText(raw(body, 'previousName'), '').trim() || old.name.trim() || `${ENERGY_NAMES[old.energy]} bis ${germanDay(endsOn)}`
  const previous: HeatingPlant = { ...old, name: previousName, units: served, endsOn }
  // Stände der Zähler der Anlage am letzten Tag der alten (Durchsicht von #239, I3): Bei der eigenen
  // Heizkostenabrechnung grenzt der Stand am Warmwasserspeicher die Wärme beider Anlagen ab. Die Zähler
  // bleiben, wo sie sind; die neue Anlage liest sie über die Linie.
  const lineIds = new Set(plants.filter((p) => lineRoot(p, plants) === lineRoot(old, plants)).map((p) => p.id))
  const plantMeters = (await readMeters(db)).filter((m) => m.heatingPlantId !== null && m.heatingPlantId !== undefined && lineIds.has(m.heatingPlantId) && m.heatingRole)
  const standRaw = raw(body, 'meterReadings')
  const stands = (Array.isArray(standRaw) ? standRaw : []).flatMap((x): { meterId: string; value: number }[] => {
    const meterId = raw(x, 'meterId')
    const value = raw(x, 'value')
    return typeof meterId === 'string' && typeof value === 'number' && Number.isFinite(value) && plantMeters.some((m) => m.id === meterId) ? [{ meterId, value }] : []
  })
  await db.transaction(async (tx) => {
    for (const [i, s] of stands.entries()) await insertEntityIn(tx, 'readings', `${newId}-stand-${i + 1}`, { meterId: s.meterId, date: endsOn, value: s.value })
    // Geprüft wird die neue Anlage wie beim Ändern (`before` = sie selbst): Ihr Rhythmus kommt von der
    // alten und wird nicht neu gesetzt.
    await guardHeatingPlant(tx, plant, plant)
    await tx.update(heatingPlants).set({ name: previous.name, unitsLimited: true, endsOn }).where(eq(heatingPlants.id, oldId))
    await writePlantUnits(tx, previous)
    await tx.insert(heatingPlants).values(plantRow(plant))
    await writePlantUnits(tx, plant)
    await writeSelfSpans(tx, newId, plant.selfSpans ?? [])
    if (plant.periodChanges.length > 0) await tx.insert(heatingPeriodChanges).values(plant.periodChanges.map((fromMonth) => ({ plantId: newId, fromMonth })))
    await guardPlantsOfProperty(tx, old.propertyId)
  })
  const after = await readHeatingPlants(db)
  const neu = after.find((p) => p.id === newId)
  const alt = after.find((p) => p.id === oldId)
  if (!neu || !alt) throw new Error('Die Heizanlagen sind nach dem Kesseltausch nicht auffindbar.')
  return { plant: neu, previous: alt }
}

export type PlantRemoval =
  // `notice`: was mit der Linie geschieht, wenn die Anlage mitten aus ihr entfernt wird.
  | { removed: true; released: number; notice: string | null }
  | { removed: false; reason: 'missing' }
  | { removed: false; reason: 'meters'; meters: string[] }
  | { removed: false; reason: 'separate' }
  | { removed: false; reason: 'co2'; periods: string[] }
  | { removed: false; reason: 'deliveries'; count: number }

// Entfernt wird eine Anlage samt Liste der Wohnungen und Heizperioden (CASCADE). Ihre
// Kostenpositionen bleiben, nur ohne Anlage; an Beträgen und Verteilung ändert das in dieser Version
// nichts. Hängen noch Zähler an ihr, wird nicht entfernt: Ohne Anlage wären sie Hauptzähler des
// Hauses und verteilten Verbrauch um (#116). Was aus ihnen wird, entscheidet der Vermieter.
export async function removeHeatingPlant(db: Database, id: string): Promise<PlantRemoval> {
  // Prüfen und Entfernen in einer Transaktion (Durchsicht von #230): Zwischen der Frage nach den
  // Zählern und dem Löschen darf kein Zähler dazukommen.
  return db.transaction(async (tx): Promise<PlantRemoval> => {
    const [plant] = await tx.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.id, id))
    if (!plant) return { removed: false, reason: 'missing' }
    // CO₂-Angaben (Heizung PR 6) fielen mit den Heizperioden (CASCADE). Sie sind erfasste Arbeit des
    // Vermieters; entfernen soll er sie selbst, wenn die Anlage wirklich entfällt.
    const co2 = await tx
      .select({ period: heatingPeriods.period })
      .from(co2Statements)
      .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
      .where(eq(heatingPeriods.plantId, id))
    if (co2.length > 0) return { removed: false, reason: 'co2', periods: co2.map((c) => String(c.period)) }
    // Lieferungen (Heizung PR 7) hält die Datenbank (RESTRICT); der Satz sagt, was zu tun ist.
    const [lieferungen] = await tx.select({ n: count() }).from(fuelDeliveries).where(eq(fuelDeliveries.plantId, id))
    if ((lieferungen?.n ?? 0) > 0) return { removed: false, reason: 'deliveries', count: lieferungen?.n ?? 0 }
    // Getrennte Heizkostenabrechnung (Heizung PR 5): Spannen, Heizkorrekturen und abgeschlossene
    // Heizkostenabrechnungen hängen an der Anlage. Ohne sie fiele jede getrennte Heizperiode still in
    // die Betriebskostenabrechnung zurück.
    const anzahl = async (table: typeof heatingSeparateSpans | typeof heatingPrepaymentOverrides | typeof closedHeatingSettlements | typeof closedHeatingSettlementHistory) =>
      (await tx.select({ n: count() }).from(table).where(eq(table.plantId, id)))[0]?.n ?? 0
    const getrennt = (await anzahl(heatingSeparateSpans)) + (await anzahl(heatingPrepaymentOverrides)) + (await anzahl(closedHeatingSettlements)) + (await anzahl(closedHeatingSettlementHistory))
    if (getrennt > 0) return { removed: false, reason: 'separate' }
    const zaehler = await tx.select({ name: meters.name }).from(meters).where(eq(meters.heatingPlantId, id))
    if (zaehler.length > 0) return { removed: false, reason: 'meters', meters: zaehler.map((z) => z.name) }
    const [n] = await tx.select({ n: count() }).from(costItems).where(eq(costItems.heatingPlantId, id))
    await tx.update(costItems).set({ heatingPlantId: null }).where(eq(costItems.heatingPlantId, id))
    // Kesseltausch (Durchsicht von #238): Wird die neue Anlage entfernt, ist der Tausch rückgängig, und
    // die ersetzte heizt wieder (I1). Wird die ersetzte entfernt, verliert die Nachfolgerin den Verweis
    // (C2); sonst lehnte das Wiederherstellen des eigenen Backups ihn ab.
    const [self] = await tx.select({ replacesPlantId: heatingPlants.replacesPlantId, buildingWith: heatingPlants.buildingWith, endsOn: heatingPlants.endsOn }).from(heatingPlants).where(eq(heatingPlants.id, id))
    // Mitten aus einer Linie entfernt (A → A2 → A3 ohne A2), ersetzt A3 die Anlage A und heizt ab dem Tag
    // nach dem letzten Betriebstag von A, also auch in der Zeit von A2.
    const [successor] = await tx.select({ id: heatingPlants.id, name: heatingPlants.name }).from(heatingPlants).where(eq(heatingPlants.replacesPlantId, id))
    const [before] = self?.replacesPlantId ? await tx.select({ name: heatingPlants.name, endsOn: heatingPlants.endsOn }).from(heatingPlants).where(eq(heatingPlants.id, self.replacesPlantId)) : []
    if (self?.replacesPlantId && !successor) await tx.update(heatingPlants).set({ endsOn: null }).where(eq(heatingPlants.id, self.replacesPlantId))
    await tx.update(heatingPlants).set({ replacesPlantId: self?.replacesPlantId ?? null }).where(eq(heatingPlants.replacesPlantId, id))
    // Gebäude (Nachprüfung von #238, I-B): Verweise auf die entfernte Anlage gehen an ihre Nachfolgerin, die
    // dasselbe Gebäude heizt; sonst an das Gebäude, in dem sie stand. Stand sie in keinem anderen, wird die
    // erste verweisende Anlage der Bezugspunkt, und die übrigen verweisen auf sie.
    const pointing = await tx.select({ id: heatingPlants.id }).from(heatingPlants).where(and(eq(heatingPlants.buildingWith, id), ne(heatingPlants.id, id))).orderBy(sql`rowid`)
    const target = successor?.id ?? (self?.buildingWith && self.buildingWith !== 'own' && self.buildingWith !== id ? self.buildingWith : null)
    if (target !== null) {
      await tx.update(heatingPlants).set({ buildingWith: target }).where(and(eq(heatingPlants.buildingWith, id), ne(heatingPlants.id, target)))
    } else if (pointing[0]) {
      const head = pointing[0].id
      await tx.update(heatingPlants).set({ buildingWith: self?.buildingWith === id ? null : (self?.buildingWith ?? null) }).where(eq(heatingPlants.id, head))
      await tx.update(heatingPlants).set({ buildingWith: head }).where(eq(heatingPlants.buildingWith, id))
    }
    await tx.delete(heatingPlants).where(eq(heatingPlants.id, id))
    const notice = successor && before?.endsOn
      ? `„${successor.name.trim() || 'Die nächste Heizanlage'}“ übernimmt den Zeitraum der entfernten Anlage und heizt jetzt ab dem ${germanDay(isoDayAfter(before.endsOn))}, im Anschluss an „${before.name.trim() || 'die vorige Heizanlage'}“.`
      : null
    return { removed: true, released: n?.n ?? 0, notice }
  })
}

const plantName = (name: string): string => (name ? `„${name}“` : 'ohne Namen')

// Befunde an den Heizanlagen im ganzen Bestand, als lesbare Sätze (Entwurf 5.3, 5.9). Leer heißt in
// Ordnung. Über die Routen entsteht keiner davon; in einem Archiv kann einer stehen. Dieselbe Haltung
// wie `crossPropertyViolations` in repository.ts.
// Ein Verweis auf eine ersetzte Anlage, die es nicht mehr gibt (Durchsicht von #238, C2): Seit dem
// Löschen einer ersetzten Anlage der Verweis mitfällt, entsteht er nicht mehr; ein älteres Archiv kann
// ihn tragen. Beim Wiederherstellen wird er geradegerückt statt abgelehnt; die Nachfolgerin gilt dann
// als Anlage ohne Vorgängerin. Gibt die Namen der betroffenen Anlagen zurück.
export async function straightenHeatingPlants(db: Database): Promise<string[]> {
  const plants = await db.select({ id: heatingPlants.id, name: heatingPlants.name, replacesPlantId: heatingPlants.replacesPlantId, buildingWith: heatingPlants.buildingWith }).from(heatingPlants)
  const ids = new Set(plants.map((p) => p.id))
  const waisen = plants.filter((p) => p.replacesPlantId !== null && !ids.has(p.replacesPlantId))
  for (const p of waisen) await db.update(heatingPlants).set({ replacesPlantId: null }).where(eq(heatingPlants.id, p.id))
  // Ebenso „im selben Gebäude wie …“ auf eine Anlage, die es nicht mehr gibt (Nachprüfung von #238): Die
  // Angabe gilt dann als nicht gefragt.
  const ohneGebaeude = plants.filter((p) => p.buildingWith !== null && p.buildingWith !== 'own' && !ids.has(p.buildingWith))
  for (const p of ohneGebaeude) await db.update(heatingPlants).set({ buildingWith: null }).where(eq(heatingPlants.id, p.id))
  return [...new Set([...waisen, ...ohneGebaeude].map((p) => p.name))]
}

export async function heatingPlantViolations(db: Database): Promise<string[]> {
  const befunde: string[] = []
  const wohnungen = await db
    .select({ plant: heatingPlants.name, unit: units.name })
    .from(heatingPlantUnits)
    .innerJoin(heatingPlants, eq(heatingPlantUnits.plantId, heatingPlants.id))
    .innerJoin(units, eq(heatingPlantUnits.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const w of wohnungen) befunde.push(`Die Heizanlage ${plantName(w.plant)} versorgt die Wohnung „${w.unit}“ eines anderen Objekts.`)
  const posten = await db
    .select({ description: costItems.description })
    .from(costItems)
    .innerJoin(heatingPlants, eq(costItems.heatingPlantId, heatingPlants.id))
    .where(ne(costItems.propertyId, heatingPlants.propertyId))
  for (const c of posten) befunde.push(`Die Kostenposition „${c.description}“ gehört zur Heizanlage eines anderen Objekts.`)
  const zaehler = await db
    .select({ name: meters.name })
    .from(meters)
    .innerJoin(heatingPlants, eq(meters.heatingPlantId, heatingPlants.id))
    .where(ne(meters.propertyId, heatingPlants.propertyId))
  for (const z of zaehler) befunde.push(`Der Zähler „${z.name}“ gehört zur Heizanlage eines anderen Objekts.`)

  // Heizung PR 10: Positionen nach Heizkostenverordnung gehören zu einer Anlage mit eigener Abrechnung.
  const eigene = new Set((await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.method, 'self'))).map((p) => p.id))
  for (const c of await db.select({ id: costItems.id, description: costItems.description, plantId: costItems.heatingPlantId }).from(costItems).where(eq(costItems.key, 'heatingSystem'))) {
    if (c.plantId === null || !eigene.has(c.plantId)) {
      befunde.push(`Die Position „${c.description}“ wird nach der Heizkostenverordnung verteilt, ihre Heizanlage rechnet aber nicht selbst ab.`)
    }
  }

  // Überlappende Anlagen: Ab zwei Anlagen in einem Objekt braucht jede ihre Liste, und keine Wohnung
  // hängt an zweien. Sonst verteilten zwei Anlagen dieselben Kosten auf dieselben Mieter.
  const anlagen = await readHeatingPlants(db)
  const unitNames = new Map((await db.select({ id: units.id, name: units.name }).from(units)).map((u) => [u.id, u.name]))
  for (const propertyId of new Set(anlagen.map((p) => p.propertyId))) {
    const imObjekt = anlagen.filter((p) => p.propertyId === propertyId)
    if (imObjekt.length < 2) continue
    for (const p of imObjekt.filter((x) => x.units === null)) {
      befunde.push(`Im Objekt stehen mehrere Heizanlagen, und die Heizanlage ${plantName(p.name)} hat keine Liste der Wohnungen; dann versorgten zwei Anlagen dieselben Wohnungen.`)
    }
    // Nach einem Kesseltausch dürfen alte und neue Anlage dieselben Wohnungen haben (Heizung PR 9).
    const gesehen = new Map<string, HeatingPlant>()
    for (const p of imObjekt) {
      for (const unitId of (p.units ?? []).map((u) => u.unitId)) {
        const vorher = gesehen.get(unitId)
        if (vorher && !sameLine(vorher, p, imObjekt)) befunde.push(`Die Wohnung „${unitNames.get(unitId) ?? unitId}“ hängt an mehreren Heizanlagen.`)
        gesehen.set(unitId, p)
      }
    }
    for (const p of imObjekt.filter((x) => x.replacesPlantId !== null)) {
      const vorher = imObjekt.find((x) => x.id === p.replacesPlantId)
      if (vorher && vorher.endsOn === null) befunde.push(`Die Heizanlage ${plantName(p.name)} ersetzt eine Anlage, die nicht außer Betrieb ist.`)
    }
    // Heizung PR 9: Namen ab zwei Anlagen. Ohne sie ließen sich Hinweise und Ausweis nicht zuordnen.
    if (imObjekt.some((p) => p.name.trim() === '')) befunde.push('Im Objekt stehen mehrere Heizanlagen, und eine davon hat keinen Namen.')
  }

  // Heizperioden: ein Zeitraum nach dem Rhythmus der Anlage, also ihrer eigenen Heizperiode (PR 5)
  // oder, ohne eigene, dem des Objekts. Zeilen entstehen seit PR 6 auch für eine eigene Heizperiode
  // (CO₂-Angaben, Warmwasser); geprüft am Objekt, lehnte das Wiederherstellen sie ab.
  const rulesById = new Map((await readProperties(db)).map((p) => [p.id, rulesOf(p)]))
  const plantRulesById = new Map((await readHeatingPlants(db)).map((p) => [p.id, plantRules(p, rulesById.get(p.propertyId) ?? rulesOf(undefined))]))
  const perioden = await db
    .select({ period: heatingPeriods.period, plantId: heatingPeriods.plantId, name: heatingPlants.name })
    .from(heatingPeriods)
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
  for (const h of perioden) {
    const rules = plantRulesById.get(h.plantId)
    const key = parsePeriodKey(h.period)
    if (!rules || key === null || periodOfKey(rules, key) === null) {
      befunde.push(`Die Heizanlage ${plantName(h.name)} hat Angaben zur Heizperiode ${h.period}, die es für ihr Objekt nicht gibt.`)
    }
  }
  return befunde
}
