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
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { AssignableHeatingItem, HeatingPlant, HeatingPlantUnit } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { parsePeriodKey, periodKey, periodOfKey, rulesOf } from '../../../shared/period.ts'
import type { Database, Executor } from './client.ts'
import { readHeatingPlants, readProperties } from './read.ts'
import { asNullableFilled, asNullableText, asText, HeatingError, ISO_DATE, merged, oneOfOrUndefined, raw, sameProperty } from './repository.ts'
import {
  CHANGE_SPLITS, closedHeatingSettlementHistory, closedHeatingSettlements, closedSettlements, costItems, DEVICES_INSTALLED_AFTER, DEVICES_REMOTE, HEATING_ENERGIES, HEATING_METHODS,
  HEATING_SOURCES, HEATING_SUPPLIES, NEW_DEVICES_INSTALLS, heatingPeriods, heatingPlants, heatingPlantUnits, heatingPrepaymentOverrides, heatingSeparateSpans, meters, units,
} from './schema.ts'

// Die Sätze der Sperren. Jeder sagt, was bis dahin geht.
const LATER = {
  self: 'Die eigene Heizkostenabrechnung nach der Heizkostenverordnung kommt mit einer späteren Version. Wählen Sie bis dahin „Ein Messdienst oder die Hausverwaltung“ oder „Niemand“; an Ihren Beträgen ändert sich dadurch nichts.',
  perUnit: 'Etagenheizungen mit Vertrag auf den Vermieter kommen mit einer späteren Version. Bis dahin erfassen Sie ihre Kosten wie bisher, etwa direkt bei der Wohnung.',
  second: 'Eine zweite Heizanlage im selben Objekt kommt mit einer späteren Version. Bis dahin gehören alle Heizpositionen zur ersten.',
  rhythm: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen unter „Zeitraum der Heizung“ ein; eine Vorschau zeigt, was mit Ihren Heizpositionen geschieht.',
  separateVia: 'Ob die Heizkosten getrennt abgerechnet werden, stellen Sie bei einer eigenen Heizperiode unter „Getrennte Heizkostenabrechnung“ ein; eine Vorschau zeigt, wie die Vorauszahlung aufgeteilt wird.',
  heatedArea: 'Die beheizte Fläche je Wohnung braucht erst die eigene Heizkostenabrechnung; sie kommt mit einer späteren Version.',
}

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
    periodStartMonth: merged(body, 'periodStartMonth', current.periodStartMonth, nullableNumber),
    // Wechsel und Spannen setzen nur die Routen mit Vorschau (Heizung PR 5, Task 4 und 9).
    periodChanges: current.periodChanges,
    separateSpans: current.separateSpans,
    units: merged(body, 'units', current.units, (v) => (v === null ? null : readPlantUnits(v))),
  }
}

// Der Energieträger hat keine Vorgabe; ohne ihn entsteht keine Anlage (createHeatingPlant).
const emptyHeatingPlant = (id: string, propertyId: string): HeatingPlant => ({
  id, propertyId, name: '', energy: 'other', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null,
  capturedOnOct2024: null, warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null,
  periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
})

async function guardHeatingPlant(db: Executor, before: HeatingPlant | null, after: HeatingPlant): Promise<void> {
  if (after.method === 'self') throw new HeatingError(400, LATER.self)
  if (after.supply === 'perUnit') throw new HeatingError(400, LATER.perUnit)
  // Den Rhythmus setzt nur der Wechsel mit Vorschau (heatingPeriodChange.ts, Heizung PR 5).
  if ((before?.periodStartMonth ?? null) !== after.periodStartMonth) throw new HeatingError(400, LATER.rhythm)
  // Mit eigener Heizperiode ändert die Antwort auf „getrennt abgerechnet?“ die Anrechnung der
  // Vorauszahlungen; das geht nur über die Vorschau (separateSettlement.ts). Ohne eigene Heizperiode
  // ist H = P, und die Antwort ist eine Angabe.
  if (before !== null && after.periodStartMonth !== null && before.separateSettlement !== after.separateSettlement) {
    throw new HeatingError(400, LATER.separateVia)
  }
  if ((after.units ?? []).some((u) => u.heatedAreaM2 !== null)) throw new HeatingError(400, LATER.heatedArea)
  if (after.source === 'homeowners' && after.method !== 'service') {
    throw new HeatingError(400, 'Rechnet die Gemeinschaft der Eigentümer ab, übernehmen Sie ihre Abrechnung wie die eines Messdienstes, als Einzelbeträge. Wählen Sie dafür „Die Gemeinschaft (Hausverwaltung) rechnet ab“.')
  }
  if (after.captureInstalledOn !== null && !ISO_DATE.test(after.captureInstalledOn)) {
    throw new HeatingError(400, 'Das Datum, seit dem der Verbrauch der Wärmepumpe erfasst wird, ist kein Datum. Bitte wählen Sie es im Kalender.')
  }
  if (after.warmRentAverageCents !== null && (!Number.isInteger(after.warmRentAverageCents) || after.warmRentAverageCents < 0)) {
    throw new HeatingError(400, 'Die durchschnittlichen Heizkosten der Jahre 2022 bis 2024 sind ein Betrag ab 0 €.')
  }
  await sameProperty(db, after.propertyId, (after.units ?? []).map((u) => u.unitId), 'Die Heizanlage')
  if (before === null) {
    const [schon] = await db.select({ n: count() }).from(heatingPlants).where(eq(heatingPlants.propertyId, after.propertyId))
    if ((schon?.n ?? 0) > 0) throw new HeatingError(400, LATER.second)
  }
}

const plantRow = (p: HeatingPlant) => ({
  id: p.id, propertyId: p.propertyId, name: p.name, energy: p.energy, supply: p.supply, method: p.method,
  separateSettlement: p.separateSettlement, devicesRemote: p.devicesRemote, devicesInstalledAfter2021: p.devicesInstalledAfter2021,
  newDevicesInstall: p.newDevicesInstall,
  source: p.source, captureInstalledOn: p.captureInstalledOn, capturedOnOct2024: p.capturedOnOct2024,
  warmRentAverageCents: p.warmRentAverageCents, changeSplit: p.changeSplit, periodStartMonth: p.periodStartMonth,
  unitsLimited: p.units !== null,
})

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
  const wanted = readIds(raw(body, 'assignItemIds'))
  await db.transaction(async (tx) => {
    await guardHeatingPlant(tx, null, plant)
    await tx.insert(heatingPlants).values(plantRow(plant))
    await writePlantUnits(tx, plant)
    const offen = new Set((await assignableIn(tx, propertyId)).map((c) => c.id))
    if (wanted.some((w) => !offen.has(w))) {
      throw new HeatingError(409, 'Die Heizpositionen haben sich geändert, seit die Vorschau geladen wurde. Bitte öffnen Sie die Einrichtung erneut; angelegt wurde nichts.')
    }
    if (wanted.length > 0) await tx.update(costItems).set({ heatingPlantId: id }).where(inArray(costItems.id, wanted))
  })
  const gespeichert = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!gespeichert) throw new Error('Die Heizanlage ist nach dem Anlegen nicht auffindbar.')
  return { plant: gespeichert, assigned: wanted.length }
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function updateHeatingPlant(db: Database, id: string, body: unknown): Promise<HeatingPlant | null> {
  const current = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!current) return null
  const next = mergeHeatingPlant(current, body)
  await db.transaction(async (tx) => {
    await guardHeatingPlant(tx, current, next)
    const { id: _id, ...rest } = plantRow(next)
    await tx.update(heatingPlants).set(rest).where(eq(heatingPlants.id, id))
    await writePlantUnits(tx, next)
  })
  return (await readHeatingPlants(db)).find((p) => p.id === id) ?? null
}

export type PlantRemoval =
  | { removed: true; released: number }
  | { removed: false; reason: 'missing' }
  | { removed: false; reason: 'meters'; meters: string[] }
  | { removed: false; reason: 'separate' }

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
    await tx.delete(heatingPlants).where(eq(heatingPlants.id, id))
    return { removed: true, released: n?.n ?? 0 }
  })
}

const plantName = (name: string): string => (name ? `„${name}“` : 'ohne Namen')

// Befunde an den Heizanlagen im ganzen Bestand, als lesbare Sätze (Entwurf 5.3, 5.9). Leer heißt in
// Ordnung. Über die Routen entsteht keiner davon; in einem Archiv kann einer stehen. Dieselbe Haltung
// wie `crossPropertyViolations` in repository.ts.
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
    const gesehen = new Set<string>()
    for (const unitId of imObjekt.flatMap((p) => (p.units ?? []).map((u) => u.unitId))) {
      if (gesehen.has(unitId)) befunde.push(`Die Wohnung „${unitNames.get(unitId) ?? unitId}“ hängt an mehreren Heizanlagen.`)
      gesehen.add(unitId)
    }
  }

  // Heizperioden: In dieser Version ist jede Heizperiode ein Abrechnungszeitraum des Objekts (eine
  // eigene kommt mit PR 5).
  const rulesById = new Map((await readProperties(db)).map((p) => [p.id, rulesOf(p)]))
  const perioden = await db
    .select({ period: heatingPeriods.period, propertyId: heatingPlants.propertyId, name: heatingPlants.name })
    .from(heatingPeriods)
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
  for (const h of perioden) {
    const rules = rulesById.get(h.propertyId)
    const key = parsePeriodKey(h.period)
    if (!rules || key === null || periodOfKey(rules, key) === null) {
      befunde.push(`Die Heizanlage ${plantName(h.name)} hat Angaben zur Heizperiode ${h.period}, die es für ihr Objekt nicht gibt.`)
    }
  }
  return befunde
}
