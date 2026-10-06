// Brennstofflieferungen einer Heizanlage (Heizung PR 7, #97; Entwurf 5.4, 8.2): anlegen, ändern,
// entfernen; die Ortswerte der Gradtagzahlen; die Schätzung beim Abschluss und das Einfrieren.
//
// **Was eine Lieferung in dieser Version sein kann:** eine Rechnung über Gas, Fernwärme oder Strom
// einer Wärmepumpe mit Rechnungszeitraum, und seit Heizung PR 8 eine Lieferung von Heizöl, Flüssiggas,
// Pellets, Holz oder Kohle mit Lieferdatum und Menge für die Bestandsrechnung (db/fuelStock.ts).
// Lieferungen je Wohnung gibt es nur bei der Etagenheizung (Heizung PR 9). Netzentgelte und Biobrennstoff
// § 5a (PR 18) lehnt der Server bis dahin mit einem Satz ab.
//
// **Gesperrt** ist eine Lieferung, von der eine abgeschlossene Heizperiode einen Teil eingefroren hat
// (8.2, G-A4): Mengen, Zeiträume und Beträge, nicht die Bezeichnung.
//
// Diese Datei importiert aus repository.ts und read.ts, nie umgekehrt.
import { and, count, eq, inArray } from 'drizzle-orm'
import { formatDayRange, parsePeriodKey, periodContaining, periodLabel, periodsBetween } from '../../../shared/period.ts'
import type { BillingPeriod, DegreeDayValue, FuelDelivery, FuelDeliveryPart, FuelGapQuestion, HeatingEnergy, HeatingMethod, HeatingStatement, HeatingSupply, PeriodKey } from '../../../shared/types.ts'
import { STOCK_ENERGIES } from '../fuel.ts'
import { dayAfter, germanDate } from '../../../shared/law/register.ts'
import type { Database, Executor } from './client.ts'
import { dropIfEmpty, ensureHeatingPeriod } from './heatingPeriodContext.ts'
import { readDegreeDayValues, readFuelDeliveries } from './read.ts'
import { asNullableFilled, asText, frozenDeliveryText, HeatingError, heatingPeriodAt, plantServesUnit, stockTakenOverBy, stockTakenOverText, heatingRulesOf, ISO_DATE, merged, oneOfOrUndefined, plantSpanOf, raw } from './repository.ts'
import { costItems, degreeDayValues, FUEL_QUANTITY_UNITS, fuelCarryFrozen, fuelDeliveries, fuelDeliveryParts, GAS_BASES, heatingPeriods, heatingPlants, properties } from './schema.ts'

const LATER = {
  other: 'Tragen Sie zuerst bei der Heizanlage den Energieträger ein; Lieferungen gibt es für Gas, Fernwärme und Strom einer Wärmepumpe.',
  halfSplit: 'Netzentgelte und Biobrennstoff nach § 5a CO2KostAufG kommen mit einer späteren Version.',
  self: 'Die eigene Heizkostenabrechnung kommt mit einer späteren Version.',
}
const frozenText = frozenDeliveryText
const stockClosedText = (h: BillingPeriod) =>
  `Die Lieferung gehört zur abgeschlossenen Heizperiode ${periodLabel(h)}; ihr Vorrat ist eingefroren. Lieferdatum, Menge und Beträge lassen sich deshalb nicht mehr ändern. Öffnen Sie die Abrechnung wieder, um etwas zu ändern.`

const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

// Die Teilmengen aus dem Rumpf, nach Beginn geordnet. Eine leere Zeile fällt weg; eine halbe ist ein
// Fehler mit Satz, kein stilles Weglassen.
function readParts(value: unknown): FuelDeliveryPart[] {
  if (!Array.isArray(value)) return []
  const parts: FuelDeliveryPart[] = []
  for (const row of value) {
    const from = asNullableFilled(raw(row, 'from'))
    const to = asNullableFilled(raw(row, 'to'))
    const amountCents = nullableInt(raw(row, 'amountCents'))
    if (from === null && to === null && amountCents === null) continue
    if (from === null || to === null || amountCents === null) throw new HeatingError(400, 'Eine Teilmenge braucht Beginn, Ende und Betrag.')
    parts.push({
      from, to, amountCents,
      energyKwh: nullableNumber(raw(row, 'energyKwh')),
      fixedCents: nullableInt(raw(row, 'fixedCents')),
      emissionsKg: nullableNumber(raw(row, 'emissionsKg')),
      co2CostCents: nullableInt(raw(row, 'co2CostCents')),
    })
  }
  return parts.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

// Ergänzt, wie die Sammlungen in repository.ts: Was im Rumpf steht, ersetzt; was fehlt, bleibt.
// `estimated` setzt nur der Abschluss (Task 9), nie der Rumpf.
function mergeDelivery(current: FuelDelivery, body: unknown): FuelDelivery {
  return {
    ...current,
    label: merged(body, 'label', current.label, (v) => asText(v, '')),
    invoiceDate: merged(body, 'invoiceDate', current.invoiceDate, asNullableFilled),
    deliveredAt: merged(body, 'deliveredAt', current.deliveredAt, asNullableFilled),
    invoiceFrom: merged(body, 'invoiceFrom', current.invoiceFrom, asNullableFilled),
    invoiceTo: merged(body, 'invoiceTo', current.invoiceTo, asNullableFilled),
    unitId: merged(body, 'unitId', current.unitId, asNullableFilled),
    amountCents: merged(body, 'amountCents', current.amountCents, nullableInt),
    quantity: merged(body, 'quantity', current.quantity, nullableNumber),
    quantityUnit: merged(body, 'quantityUnit', current.quantityUnit, (v) => oneOfOrUndefined(FUEL_QUANTITY_UNITS, v) ?? null),
    energyKwh: merged(body, 'energyKwh', current.energyKwh, nullableNumber),
    gasBasis: merged(body, 'gasBasis', current.gasBasis, (v) => oneOfOrUndefined(GAS_BASES, v) ?? null),
    heatingValue: merged(body, 'heatingValue', current.heatingValue, nullableNumber),
    emissionsKg: merged(body, 'emissionsKg', current.emissionsKg, nullableNumber),
    co2CostCents: merged(body, 'co2CostCents', current.co2CostCents, nullableInt),
    emissionFactor: merged(body, 'emissionFactor', current.emissionFactor, nullableNumber),
    gridFeeCents: merged(body, 'gridFeeCents', current.gridFeeCents, nullableInt),
    bioCostCents: merged(body, 'bioCostCents', current.bioCostCents, nullableInt),
    sharePermille: merged(body, 'sharePermille', current.sharePermille, nullableNumber),
    fixedCents: merged(body, 'fixedCents', current.fixedCents, nullableInt),
    usedByService: merged(body, 'usedByService', current.usedByService, (v) => v !== false),
    parts: merged(body, 'parts', current.parts, readParts),
  }
}

const emptyDelivery = (id: string, plantId: string): FuelDelivery => ({
  id, plantId, label: '', invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null, unitId: null, amountCents: null,
  quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
})

type PlantFacts = { id: string; energy: HeatingEnergy; method: HeatingMethod; supply: HeatingSupply; name: string }

async function plantOf(db: Executor, plantId: string): Promise<PlantFacts | null> {
  const [p] = await db.select({ id: heatingPlants.id, energy: heatingPlants.energy, method: heatingPlants.method, supply: heatingPlants.supply, name: heatingPlants.name }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  return p ?? null
}

async function frozenCount(db: Executor, id: string): Promise<number> {
  const [n] = await db.select({ n: count() }).from(fuelCarryFrozen).where(eq(fuelCarryFrozen.deliveryId, id))
  return n?.n ?? 0
}

async function guardDelivery(db: Executor, plant: PlantFacts, before: FuelDelivery | null, after: FuelDelivery): Promise<void> {
  if (plant.method === 'self') throw new HeatingError(400, LATER.self)
  const stock = STOCK_ENERGIES.includes(plant.energy)
  if (plant.energy === 'other') throw new HeatingError(400, LATER.other)
  // Lieferungen mit Wohnung (Heizung PR 9, Entwurf 5.4 F8): bei einer Etagenheizung immer, sonst nie.
  // Eine Rechnung, deren Positionen einer Wohnung zugeordnet sind, gehört zu dieser.
  if (plant.supply === 'perUnit') {
    if (!after.unitId) throw new HeatingError(400, 'Bei einer Etagenheizung gehört jede Rechnung zu einer Wohnung. Bitte wählen Sie die Wohnung, deren Heizung sie betrifft.')
    if (!(await plantServesUnit(db, plant.id, after.unitId))) throw new HeatingError(400, `Die gewählte Wohnung hängt nicht an der Etagenheizung „${plant.name}“.`)
    const verknuepft = await db.select({ unitId: costItems.directUnitId }).from(costItems).where(eq(costItems.fuelDeliveryId, after.id))
    if (verknuepft.some((c) => c.unitId !== after.unitId)) {
      throw new HeatingError(400, 'An dieser Rechnung hängen Positionen einer anderen Wohnung. Lösen Sie die Verknüpfung dort, bevor Sie die Wohnung der Rechnung ändern.')
    }
  } else if (after.unitId) {
    throw new HeatingError(400, 'Eine Rechnung einer zentralen Heizanlage gehört zu keiner einzelnen Wohnung. Lassen Sie die Wohnung leer.')
  }
  if (after.gridFeeCents !== null || after.bioCostCents !== null) throw new HeatingError(400, LATER.halfSplit)
  // Kesseltausch (Heizung PR 9): Eine Lieferung gehört in die Zeit, in der die Anlage heizt.
  const span = await plantSpanOf(db, plant.id)
  const firstDay = after.deliveredAt ?? after.invoiceFrom
  const lastDay = after.deliveredAt ?? after.invoiceTo
  const label = `„${after.label || 'Lieferung'}“`
  if (span.to !== null && lastDay !== null && lastDay > span.to) {
    throw new HeatingError(400, `Die Heizanlage „${span.name}“ ist seit dem ${germanDate(dayAfter(span.to))} außer Betrieb; ${label} reicht über diesen Tag hinaus. Erfassen Sie Brennstoff für die Zeit danach bei der neuen Anlage.`)
  }
  if (span.from !== null && firstDay !== null && firstDay < span.from) {
    throw new HeatingError(400, `Die Heizanlage „${span.name}“ heizt erst seit dem ${germanDate(span.from)}; ${label} beginnt davor. Erfassen Sie Brennstoff für die Zeit davor bei der Anlage, die sie ersetzt hat.`)
  }
  const what = `„${after.label || 'Lieferung'}“`
  const dates: [string | null, string][] = [
    [after.invoiceDate, 'Rechnungsdatum'], [after.invoiceFrom, 'Beginn des Rechnungszeitraums'], [after.invoiceTo, 'Ende des Rechnungszeitraums'], [after.deliveredAt, 'Lieferdatum'],
  ]
  for (const [v, name] of dates) {
    if (v !== null && !ISO_DATE.test(v)) throw new HeatingError(400, `${name} von ${what} ist kein Datum. Bitte wählen Sie es im Kalender.`)
  }
  if (stock) {
    // Vorratsenergien (Heizung PR 8, Entwurf 5.4, 8.2): Die Lieferung gehört zur Heizperiode ihres
    // Lieferdatums; ihre Menge braucht die Einheit des Vorrats. Einen Rechnungszeitraum gibt es nicht,
    // abgegrenzt wird über Anfangs- und Endbestand.
    if (after.deliveredAt === null) {
      throw new HeatingError(400, `Bitte tragen Sie das Lieferdatum von ${what} ein. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.`)
    }
    if (after.invoiceFrom !== null || after.invoiceTo !== null || after.parts.length > 0 || after.sharePermille !== null) {
      throw new HeatingError(400, `Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle hat ${what} keinen Rechnungszeitraum; den Verbrauch ergibt die Bestandsrechnung aus Anfangs- und Endbestand. Bitte tragen Sie nur das Lieferdatum ein.`)
    }
    if (after.quantity === null || !(after.quantity > 0) || (after.quantityUnit !== 'l' && after.quantityUnit !== 'kg' && after.quantityUnit !== 'srm')) {
      throw new HeatingError(400, `Bitte tragen Sie die gelieferte Menge von ${what} in Litern, Kilogramm oder Schüttraummetern ein, wie auf der Rechnung.`)
    }
    // Eine Lieferung in einer abgeschlossenen Heizperiode ist gesperrt (G-A4), auch beim Verschieben
    // hinein oder hinaus; die Bezeichnung bleibt änderbar.
    const same = (d: FuelDelivery) => JSON.stringify({ ...d, label: '', usedByService: true })
    if (before === null || same(before) !== same(after)) {
      for (const date of [before?.deliveredAt ?? null, after.deliveredAt]) {
        const at = date === null ? null : await heatingPeriodAt(db, plant.id, date)
        if (at?.closed) throw new HeatingError(409, stockClosedText(at.period))
      }
    }
    // Hat die abgeschlossene Folgeperiode den Endbestand übernommen (C2), bleiben Menge, Einheit und
    // Lieferdatum; Beträge, kg und CO₂-Kosten dürfen sich ändern.
    const moved = before !== null && (before.quantity !== after.quantity || before.quantityUnit !== after.quantityUnit || before.deliveredAt !== after.deliveredAt)
    for (const date of moved ? [before?.deliveredAt ?? null, after.deliveredAt] : []) {
      const took = date === null ? null : await stockTakenOverBy(db, plant.id, date)
      if (took) throw new HeatingError(409, stockTakenOverText(took.label, 'Menge, Einheit und Lieferdatum ihrer Lieferungen'))
    }
  } else {
    if (after.invoiceFrom === null || after.invoiceTo === null) {
      throw new HeatingError(400, `Bei Gas, Fernwärme und Strom braucht ${what} den Rechnungszeitraum (Beginn und Ende laut Rechnung); nach ihm teilt Mietfuchs die Rechnung auf die Heizperioden auf.`)
    }
    if (after.invoiceFrom > after.invoiceTo) throw new HeatingError(400, `Der Rechnungszeitraum von ${what} endet vor seinem Beginn.`)
  }
  if (plant.method === 'manual' && after.amountCents !== null && !after.estimated) {
    throw new HeatingError(400, `Bei freien Schlüsseln steht der Betrag in der Kostenposition: Verknüpfen Sie die Position mit ${what}, statt hier einen Betrag einzutragen.`)
  }
  const notNegative: [number | null, string][] = [
    [after.fixedCents, 'Der feste Preisbestandteil'], [after.emissionsKg, 'Der CO₂-Ausstoß'], [after.co2CostCents, 'Die CO₂-Kosten'],
    [after.energyKwh, 'Die Energie'], [after.quantity, 'Die Menge'], [after.emissionFactor, 'Der Emissionsfaktor'],
  ]
  for (const [v, name] of notNegative) if (v !== null && v < 0) throw new HeatingError(400, `${name} von ${what} ist eine Zahl ab 0.`)
  if (after.heatingValue !== null && !(after.heatingValue > 0)) throw new HeatingError(400, `Der Heizwert von ${what} ist eine Zahl über 0.`)
  if (after.sharePermille !== null && after.invoiceFrom !== null && after.invoiceTo !== null) {
    if (after.sharePermille < 0 || after.sharePermille > 1000) throw new HeatingError(400, 'Ein eingetragener Anteil liegt zwischen 0 und 1000 ‰.')
    const heating = await heatingRulesOf(db, plant.id)
    if (heating && periodsBetween(heating.rules, after.invoiceFrom, after.invoiceTo).length > 2) {
      throw new HeatingError(400, `${what} reicht über mehr als zwei Heizperioden; einen eingetragenen Anteil gibt es nur für eine Rechnung, die zwei berührt. Lassen Sie Mietfuchs nach Zählerstand oder Gradtagen teilen, oder erfassen Sie Teilmengen.`)
    }
  }
  let last: string | null = null
  for (const p of after.parts) {
    if (!ISO_DATE.test(p.from) || !ISO_DATE.test(p.to) || p.from > p.to) throw new HeatingError(400, 'Eine Teilmenge braucht Beginn und Ende als Datum; das Ende liegt nicht vor dem Beginn.')
    if (after.invoiceFrom === null || after.invoiceTo === null || p.from < after.invoiceFrom || p.to > after.invoiceTo) throw new HeatingError(400, 'Eine Teilmenge liegt außerhalb des Rechnungszeitraums.')
    if (last !== null && p.from <= last) throw new HeatingError(400, 'Teilmengen dürfen sich nicht überschneiden.')
    if ((p.fixedCents ?? 0) < 0 || (p.emissionsKg ?? 0) < 0 || (p.co2CostCents ?? 0) < 0 || (p.energyKwh ?? 0) < 0) throw new HeatingError(400, 'Die Zahlen einer Teilmenge sind Zahlen ab 0, nur der Betrag darf negativ sein.')
    last = p.to
  }
  // Ein neues Rechnungsende muss in der Heizperiode der Positionen bleiben (Durchsicht M3), sonst
  // stünde die Rechnung in einer Heizperiode, in die sie nicht gehört, und ihr Teil liefe falsch.
  if (before !== null && (before.invoiceTo ?? before.deliveredAt) !== (after.invoiceTo ?? after.deliveredAt)) {
    const end = after.invoiceTo ?? after.deliveredAt
    const heating = await heatingRulesOf(db, plant.id)
    const linked = await db.select({ period: costItems.period, description: costItems.description }).from(costItems).where(eq(costItems.fuelDeliveryId, before.id))
    if (end !== null && heating !== null && linked.length > 0) {
      const h = periodContaining(heating.rules, end)
      const fremd = linked.find((c) => c.period !== h.key)
      if (fremd) {
        throw new HeatingError(409,
          `Mit diesem Rechnungsende gehört ${what} in die Heizperiode ${periodLabel(h)}; die verknüpfte Position „${fremd.description}“ steht aber in einem anderen Zeitraum. ` +
            'Lösen Sie zuerst die Verknüpfung oder ändern Sie den Zeitraum der Position.')
      }
    }
  }
  if (before !== null && (await frozenCount(db, before.id)) > 0) {
    const same = (d: FuelDelivery) => JSON.stringify({ ...d, label: '', usedByService: true })
    if (same(before) !== same(after)) throw new HeatingError(409, frozenText(before.label || 'Lieferung'))
  }
}

const rowOf = (d: FuelDelivery) => {
  const { parts: _parts, ...row } = d
  return row
}

async function writeParts(db: Executor, d: FuelDelivery): Promise<void> {
  await db.delete(fuelDeliveryParts).where(eq(fuelDeliveryParts.deliveryId, d.id))
  if (d.parts.length > 0) await db.insert(fuelDeliveryParts).values(d.parts.map((p) => ({ deliveryId: d.id, ...p })))
}

// `null`: Diese Anlage gibt es nicht; die Route macht daraus ihre 404.
export async function listDeliveries(db: Database, plantId: string): Promise<FuelDelivery[] | null> {
  if (!(await plantOf(db, plantId))) return null
  return (await readFuelDeliveries(db)).filter((d) => d.plantId === plantId)
}

export async function createDelivery(db: Database, id: string, plantId: string, body: unknown): Promise<FuelDelivery | null> {
  const plant = await plantOf(db, plantId)
  if (!plant) return null
  const d = mergeDelivery(emptyDelivery(id, plantId), body)
  await db.transaction(async (tx) => {
    await guardDelivery(tx, plant, null, d)
    await tx.insert(fuelDeliveries).values(rowOf(d))
    await writeParts(tx, d)
  })
  return (await readFuelDeliveries(db)).find((x) => x.id === id) ?? null
}

export async function updateDelivery(db: Database, id: string, body: unknown): Promise<FuelDelivery | null> {
  const current = (await readFuelDeliveries(db)).find((x) => x.id === id)
  if (!current) return null
  const plant = await plantOf(db, current.plantId)
  if (!plant) return null
  const next = mergeDelivery(current, body)
  await db.transaction(async (tx) => {
    await guardDelivery(tx, plant, current, next)
    await tx.update(fuelDeliveries).set(rowOf(next)).where(eq(fuelDeliveries.id, id))
    await writeParts(tx, next)
  })
  return (await readFuelDeliveries(db)).find((x) => x.id === id) ?? null
}

// `false`: Diese Lieferung gibt es nicht. Eingefrorene Teile und verknüpfte Positionen halten sie.
export async function removeDelivery(db: Database, id: string): Promise<boolean> {
  const current = (await readFuelDeliveries(db)).find((x) => x.id === id)
  if (!current) return false
  if ((await frozenCount(db, id)) > 0) throw new HeatingError(409, frozenText(current.label || 'Lieferung'))
  // Vorrat (Heizung PR 8): eine Lieferung in einer abgeschlossenen Heizperiode bleibt.
  const plant = await plantOf(db, current.plantId)
  if (plant && STOCK_ENERGIES.includes(plant.energy) && current.deliveredAt !== null) {
    const at = await heatingPeriodAt(db, plant.id, current.deliveredAt)
    if (at?.closed) throw new HeatingError(409, stockClosedText(at.period))
    const took = await stockTakenOverBy(db, plant.id, current.deliveredAt)
    if (took) throw new HeatingError(409, stockTakenOverText(took.label, 'ihre Lieferungen'))
  }
  const [linked] = await db.select({ n: count() }).from(costItems).where(eq(costItems.fuelDeliveryId, id))
  const n = linked?.n ?? 0
  if (n > 0) {
    throw new HeatingError(409, `An der Lieferung „${current.label || 'Lieferung'}“ hängen noch ${n} ${n === 1 ? 'Kostenposition' : 'Kostenpositionen'}. Lösen Sie zuerst die Verknüpfung oder löschen Sie die Positionen.`)
  }
  await db.transaction(async (tx) => { await tx.delete(fuelDeliveries).where(eq(fuelDeliveries.id, id)) })
  return true
}

// ---------- Ortswerte der Gradtagzahlen (Stufe 4 in 3.2) ----------

async function propertyExists(db: Executor, propertyId: string): Promise<boolean> {
  const [p] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId))
  return p !== undefined
}

// `null`: Dieses Objekt gibt es nicht.
export async function listDegreeDays(db: Database, propertyId: string): Promise<DegreeDayValue[] | null> {
  if (!(await propertyExists(db, propertyId))) return null
  return (await readDegreeDayValues(db)).filter((v) => v.propertyId === propertyId).map(({ month, value }) => ({ month, value }))
}

// Die Liste ersetzt alle Werte des Objekts; eine leere Liste löscht sie.
export async function saveDegreeDays(db: Database, propertyId: string, body: unknown): Promise<DegreeDayValue[] | null> {
  if (!(await propertyExists(db, propertyId))) return null
  const list = raw(body, 'values')
  if (!Array.isArray(list)) throw new HeatingError(400, 'Bitte schicken Sie die Gradtagzahlen als Liste von Monat und Wert.')
  const values: DegreeDayValue[] = []
  const seen = new Set<string>()
  for (const row of list) {
    const month = parsePeriodKey(raw(row, 'month'))
    const value = raw(row, 'value')
    if (month === null || seen.has(month)) throw new HeatingError(400, 'Jede Gradtagzahl braucht einen Monat (JJJJ-MM), jeder Monat einmal.')
    if (typeof value !== 'number' || !(value > 0)) throw new HeatingError(400, 'Eine Gradtagzahl ist eine Zahl über 0.')
    seen.add(month)
    values.push({ month, value })
  }
  // Monate einer abgeschlossenen Heizperiode einer Anlage mit Lieferungen bleiben (Durchsicht M2): Die
  // Aufteilung der Rechnungen dieser Heizperiode ist eingefroren.
  const before = new Map((await readDegreeDayValues(db)).filter((v) => v.propertyId === propertyId).map((v) => [v.month, v.value]))
  const after = new Map(values.map((v) => [v.month, v.value]))
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((m) => before.get(m) !== after.get(m)).sort()
  if (changed.length > 0) {
    const plants = await db.select({ id: heatingPlants.id }).from(heatingPlants).innerJoin(fuelDeliveries, eq(fuelDeliveries.plantId, heatingPlants.id)).where(eq(heatingPlants.propertyId, propertyId))
    for (const month of changed) {
      for (const plant of new Set(plants.map((x) => x.id))) {
        const at = await heatingPeriodAt(db, plant, `${month}-01`)
        if (at?.closed) {
          throw new HeatingError(409,
            `Die Gradtagzahl für ${month.slice(5, 7)}/${month.slice(0, 4)} gehört zur abgeschlossenen Heizperiode ${periodLabel(at.period)}; die Aufteilung ihrer Rechnungen ist eingefroren. Öffnen Sie die Abrechnung wieder, um sie zu ändern.`)
        }
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(degreeDayValues).where(eq(degreeDayValues.propertyId, propertyId))
    if (values.length > 0) await tx.insert(degreeDayValues).values(values.map((v) => ({ propertyId, ...v })))
  })
  return listDegreeDays(db, propertyId)
}

// ---------- Abschluss (Heizung PR 7, Entwurf 8.2, N1, G-A4) ----------

type WithHeating = { heating?: HeatingStatement[]; deadline?: string }

// Die Lücken einer Berechnung, für die Mietfuchs eine Schätzung vorschlagen kann. Der Betrag ist
// zugleich, was der Vermieter ohne Schätzung trägt, wenn die Rechnung nach dem Abschluss kommt.
export function fuelGapQuestions(s: WithHeating): FuelGapQuestion[] {
  return (s.heating ?? []).flatMap((h) =>
    (h.fuel?.gaps ?? []).flatMap((g) =>
      g.estimate ? [{ plantId: h.plantId, plantName: h.plantName, period: h.period, from: g.from, to: g.to, amountCents: g.estimate.amountCents, deadline: s.deadline ?? '', ...(g.zeroInvoices ? { zeroInvoices: g.zeroInvoices } : {}) }] : []))
}

// Je Lücke mit Vorschlag eine geschätzte Lieferung, ohne Kostenposition: verteilt wird sie mit dem
// Schlüssel der Rechnung, aus der sie geschätzt ist (fuel.ts). Gibt die neuen Kennungen zurück.
export async function createEstimates(db: Executor, s: WithHeating, newId: () => string): Promise<string[]> {
  const ids: string[] = []
  for (const h of s.heating ?? []) {
    for (const g of h.fuel?.gaps ?? []) {
      const e = g.estimate
      if (!e) continue
      const id = newId()
      await db.insert(fuelDeliveries).values(rowOf({
        ...emptyDelivery(id, h.plantId),
        // Die Grundlage steht in der Bezeichnung; der Druckblock „Brennstoff“ nennt sie (Durchsicht, Recht I2).
        label: `Schätzung ${formatDayRange(e.from, e.to)}: ${e.factorPermille.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ‰ der Rechnung „${e.basedOn}“ ${e.byMeter ? 'nach Zählerstand' : 'nach Gradtagen'}`,
        invoiceFrom: e.from,
        invoiceTo: e.to,
        amountCents: e.amountCents,
        emissionsKg: e.emissionsKg,
        co2CostCents: e.co2CostCents,
        estimated: true,
      }))
      ids.push(id)
    }
  }
  return ids
}

// Nimmt Schätzungen zurück. Der Abschluss braucht das nicht, denn er legt sie in derselben
// Transaktion an (scheitert er, fallen sie mit); es bleibt für den Fall, dass eine Schätzung von Hand
// zurückgenommen werden soll.
export async function removeEstimates(db: Executor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.delete(fuelDeliveries).where(and(inArray(fuelDeliveries.id, [...ids]), eq(fuelDeliveries.estimated, true)))
}

// Friert je Heizperiode der Abrechnung und je Lieferung ein, was sie herein- (+) oder hinausgebucht
// (−) hat, dazu Ausstoß und CO₂-Kosten dieser Lieferung in ihr (G-A4). Auch eine Lieferung ohne
// Übertrag bekommt ihre Zeile: Sie berührt eine abgeschlossene Heizperiode und ist damit gesperrt.
// Ein zweites Einfrieren derselben Heizperiode ersetzt.
export async function freezeFuelCarries(db: Executor, s: WithHeating): Promise<void> {
  for (const h of s.heating ?? []) {
    const fuel = h.fuel
    if (!fuel) continue
    const ids = [...new Set([...fuel.deliveries.map((d) => d.deliveryId), ...fuel.carries.map((c) => c.deliveryId)])]
    if (ids.length === 0) continue
    const heatingPeriodId = await ensureHeatingPeriod(db, h.plantId, h.period)
    await db.delete(fuelCarryFrozen).where(eq(fuelCarryFrozen.heatingPeriodId, heatingPeriodId))
    await db.insert(fuelCarryFrozen).values(ids.map((deliveryId) => {
      const line = fuel.deliveries.find((d) => d.deliveryId === deliveryId)
      return {
        deliveryId,
        heatingPeriodId,
        cents: fuel.carries.filter((c) => c.deliveryId === deliveryId).reduce((a, c) => a + c.cents, 0),
        emissionsKg: line?.emissionsKg ?? 0,
        co2Cents: line?.co2Cents ?? 0,
      }
    }))
  }
}

// Die Heizperioden, die ein eingefrorener Stand bewertet hat. Der Stand ist `unknown`, denn er kann
// aus einer früheren Version stammen; was nicht lesbar ist, gibt nichts frei.
function heatingKeysOf(settlement: unknown): { plantId: string; period: PeriodKey }[] {
  if (settlement === null || typeof settlement !== 'object' || !('heating' in settlement) || !Array.isArray(settlement.heating)) return []
  return settlement.heating.flatMap((h: unknown) => {
    if (h === null || typeof h !== 'object' || !('plantId' in h) || !('period' in h)) return []
    const period = parsePeriodKey(h.period)
    return typeof h.plantId === 'string' && period !== null ? [{ plantId: h.plantId, period }] : []
  })
}

// Wiederöffnen (8.2 Fall f): Die eingefrorenen Teile der Heizperioden dieses Stands entfallen; danach
// rechnen alle Zeiträume wieder mit dem, was die Lieferungen heute ergeben.
export async function unfreezeFuelCarries(db: Executor, settlement: unknown): Promise<void> {
  for (const k of heatingKeysOf(settlement)) {
    const rows = await db.select({ id: heatingPeriods.id }).from(heatingPeriods)
      .where(and(eq(heatingPeriods.plantId, k.plantId), eq(heatingPeriods.period, k.period)))
    for (const r of rows) {
      await db.delete(fuelCarryFrozen).where(eq(fuelCarryFrozen.heatingPeriodId, r.id))
      // Die Zeile entstand womöglich nur fürs Einfrieren; leer bliebe sie stehen und sperrte den
      // Wechsel des Zeitraums der Heizung (wie in db/co2.ts).
      await dropIfEmpty(db, r.id)
    }
  }
}
