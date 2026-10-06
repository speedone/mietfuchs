// CO₂-Angaben und Warmwasser je Heizperiode (Heizung PR 6, #97, #209, #211; Entwurf 5.5, 7, 11.3).
//
// Eine Heizperiode bekommt ihre Zeile in `heating_periods` (PR 4), sobald jemand etwas zu ihr
// speichert. Daran hängen die CO₂-Angaben (`co2_statements`, eine Zeile je Heizperiode) und die
// Beträge „vom Vermieter übernommen“ je Mietverhältnis (`co2_tenant_reliefs`).
//
// Welche Heizperioden es gibt, rechnet shared/period.ts aus dem Rhythmus der Anlage (eigene
// Heizperiode, PR 5) oder, ohne eigenen, aus dem des Objekts. Eine Heizperiode gehört in die
// Abrechnung des Objektzeitraums, der ihr Ende enthält (Entwurf 3.0, W1).
//
// Gespeichert wird nur, was diese Version rechnet: Angaben eines Messdienstes oder der Gemeinschaft
// (Methode der Anlage `service`). Die eigene Aufteilung (`self`, freie Schlüssel) kommt mit PR 7.
//
// Diese Datei importiert aus repository.ts und read.ts, nie umgekehrt.
import { eq, inArray } from 'drizzle-orm'
import type { BillingPeriod, Co2Statement, Co2TenantRelief, HeatingPeriodView, PeriodKey } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { co2ApplicableFrom, co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, valueAt } from '../../../shared/law/register.ts'
import { heatingPeriodsEndingIn } from '../../../shared/heatingPeriod.ts'
import { periodLabel, periodOfKey, resolvePeriodParam } from '../../../shared/period.ts'
import type { Database, Executor } from './client.ts'
import { readCo2Statements, readCostItems, readStock } from './read.ts'
import { stockViewFor } from './fuelStock.ts'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import { asNullableFilled, CrossPropertyError, has, HeatingError, merged, oneOfOrUndefined, raw } from './repository.ts'
import { closedText, dropIfEmpty, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext, type PlantContext } from './heatingPeriodContext.ts'
// Für ältere Importe (Tests): Die Helfer der Heizperioden stehen seit Heizung PR 8 in heatingPeriodContext.ts.
export { dropIfEmpty, ensureHeatingPeriod } from './heatingPeriodContext.ts'
import { CO2_METHODS, co2Statements, co2TenantReliefs, costItems, DHW_METHODS, heatingPeriods, tenancies, units } from './schema.ts'

const ASK_METHOD = 'Bitte beantworten Sie zuerst die Frage, ob die Kostenaufstellung eine Zeile wie „Abzüglich CO₂-Kosten Vermieter“ enthält.'
const SERVICE_NOT_SELF = 'Rechnet ein Messdienst oder die Gemeinschaft ab, beantworten Sie die Frage nach der Abzugszeile. Hat der Messdienst die CO₂-Kosten nicht aufgeteilt, wählen Sie „gar nicht aufgeteilt“; mit der Brennstoffrechnung als Lieferung teilt Mietfuchs dann selbst auf.'
const MANUAL_SELF = 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten selbst auf, aus den Lieferungen des Versorgers. Angeben lässt sich hier nur die Fläche der Einstufung, wenn sie von der Wohnfläche der versorgten Wohnungen abweicht.'
// Die Heizperioden einer Anlage mit CO₂-Angaben, die noch nicht abgeschlossen sind. Abgeschlossene
// sind eingefroren und lassen sich nicht mehr entfernen; sie dürfen einen Wechsel der Anlage
// (Kesseltausch, andere Abrechnung) deshalb nicht sperren (Nachprüfung von PR 6).
export async function openCo2Periods(db: Database, plantId: string): Promise<string[]> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return []
  const open: string[] = []
  for (const st of (await readCo2Statements(db)).filter((s) => s.plantId === plantId)) {
    const h = periodOfKey(ctx.plantRules, st.period)
    if (h === null || !(await heatingPeriodClosed(db, ctx, h))) open.push(st.period)
  }
  return open
}

// ---------- Lesen ----------

// Die Heizperioden der Anlage, die im Abrechnungszeitraum P enden, mit ihren Angaben und den
// Positionen der Anlage in dieser Heizperiode (für die Probe der Oberfläche). Ohne eigenen Rhythmus
// genau P.
export async function heatingPeriodViews(db: Database, plantId: string, periodParam: string): Promise<HeatingPeriodView[] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const resolved = resolvePeriodParam(ctx.objectRules, periodParam)
  if ('error' in resolved) throw new HeatingError(400, resolved.error)
  const p = resolved.period
  const hs = heatingPeriodsEndingIn(ctx.plantRules, p)
  const statements = (await readCo2Statements(db)).filter((s) => s.plantId === plantId)
  const rows = await db.select().from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const items = (await readCostItems(db)).filter((c) => c.heatingPlantId === plantId && c.category === HEATING_CATEGORY)
  // Der Vorrat (Heizung PR 8) nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle, und nicht bei der
  // eigenen Heizkostenabrechnung, die ihn erst mit einer späteren Version rechnet.
  const stockData = isStockEnergy(ctx.plant.energy) && ctx.plant.method !== 'self' ? await readStock(db) : null
  const views: HeatingPeriodView[] = []
  for (const h of hs) {
    const row = rows.find((r) => r.period === h.key)
    views.push({
      plantId,
      period: h.key,
      label: periodLabel(h),
      from: h.from,
      to: h.to,
      short: h.short,
      closed: await heatingPeriodClosed(db, ctx, h),
      hotWater: { dhwMethod: row?.dhwMethod ?? null, dhwUnmeasurable: row?.dhwUnmeasurable ?? null },
      co2: statements.find((s) => s.period === h.key) ?? null,
      items: items
        .filter((c) => c.period === h.key)
        .map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, key: c.key, tenancyAmounts: c.tenancyAmounts, selfAmounts: c.selfAmounts, fuelDeliveryId: c.fuelDeliveryId })),
      stock: stockData ? stockViewFor(stockData, ctx, h) : null,
    })
  }
  return views
}

// ---------- CO₂-Angaben ----------

const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Beträge je Mietverhältnis aus dem Rumpf: jede Kennung einmal, ganze Cent ab 0. Ein leerer Betrag
// ist keine Angabe; ein ungültiger ist ein Fehler mit Satz, kein stilles Weglassen.
function readReliefs(value: unknown): Co2TenantRelief[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Co2TenantRelief[] = []
  for (const row of value) {
    const tenancyId = asNullableFilled(raw(row, 'tenancyId'))
    const cents = raw(row, 'cents')
    if (tenancyId === null || seen.has(tenancyId) || cents === null || cents === undefined || cents === '') continue
    if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) {
      throw new HeatingError(400, 'Ein Betrag „vom Vermieter übernommen“ ist ein Betrag ab 0 €.')
    }
    seen.add(tenancyId)
    result.push({ tenancyId, cents })
  }
  return result
}

// Ein neuer Datensatz braucht die Antwort auf die Frage nach der Abzugszeile; eine Vorgabe gibt es
// bewusst nicht (Entwurf 7.2).
function newStatement(plantId: string, period: PeriodKey, body: unknown): Co2Statement {
  const method = oneOfOrUndefined(CO2_METHODS, raw(body, 'method'))
  if (method === undefined) throw new HeatingError(400, ASK_METHOD)
  return {
    heatingPeriodId: '', plantId, period, method, areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null,
    serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
    serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null,
    serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
  }
}

// Ergänzt, wie die Sammlungen in repository.ts: Was im Rumpf steht, ersetzt; was fehlt, bleibt.
function mergeCo2(current: Co2Statement, body: unknown): Co2Statement {
  return {
    ...current,
    method: merged(body, 'method', current.method, (v) => oneOfOrUndefined(CO2_METHODS, v) ?? current.method),
    areaM2: merged(body, 'areaM2', current.areaM2, nullableNumber),
    serviceEmissionsKg: merged(body, 'serviceEmissionsKg', current.serviceEmissionsKg, nullableNumber),
    serviceAreaM2: merged(body, 'serviceAreaM2', current.serviceAreaM2, nullableNumber),
    serviceKgPerM2: merged(body, 'serviceKgPerM2', current.serviceKgPerM2, nullableNumber),
    serviceLandlordPermille: merged(body, 'serviceLandlordPermille', current.serviceLandlordPermille, nullableInt),
    serviceTotalCents: merged(body, 'serviceTotalCents', current.serviceTotalCents, nullableInt),
    serviceLandlordCents: merged(body, 'serviceLandlordCents', current.serviceLandlordCents, nullableInt),
    serviceUsersTotalCents: merged(body, 'serviceUsersTotalCents', current.serviceUsersTotalCents, nullableInt),
    serviceUsersTotalApprox: merged(body, 'serviceUsersTotalApprox', current.serviceUsersTotalApprox, (v) => v === true),
    serviceUnitsCount: merged(body, 'serviceUnitsCount', current.serviceUnitsCount, nullableInt),
    serviceCostItemId: merged(body, 'serviceCostItemId', current.serviceCostItemId, asNullableFilled),
    serviceSelfLandlordCents: merged(body, 'serviceSelfLandlordCents', current.serviceSelfLandlordCents, nullableInt),
    serviceFuelGrossCents: merged(body, 'serviceFuelGrossCents', current.serviceFuelGrossCents, nullableInt),
    serviceFuelNetCents: merged(body, 'serviceFuelNetCents', current.serviceFuelNetCents, nullableInt),
    reliefs: merged(body, 'reliefs', current.reliefs, readReliefs),
  }
}

async function guardCo2(db: Executor, ctx: PlantContext, h: BillingPeriod, st: Co2Statement): Promise<void> {
  // Heizung PR 7: bei freien Schlüsseln nur `self` (die Fläche der Einstufung), beim Messdienst nie.
  if (ctx.plant.method === 'manual' && st.method !== 'self') throw new HeatingError(400, MANUAL_SELF)
  if (ctx.plant.method !== 'manual' && st.method === 'self') throw new HeatingError(400, SERVICE_NOT_SELF)
  if (!valueAt(co2ApplicableFrom, h.from)) {
    throw new HeatingError(400, `Die CO₂-Kosten sind erst für Abrechnungszeiträume aufzuteilen, die am oder nach dem ${germanDate(co2FirstPeriodStart())} beginnen (§ 11 Abs. 2 Satz 1 CO2KostAufG); diese Heizperiode beginnt früher.`)
  }
  if (st.method === 'serviceDeducted' || st.method === 'serviceShown') {
    if (st.serviceUsersTotalCents === null || st.serviceUsersTotalCents < 0) {
      throw new HeatingError(400, 'Bitte tragen Sie die Summe der Kosten aller Nutzer für Heizung und Warmwasser ein, so wie sie in der Kostenaufstellung steht, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.')
    }
    if (st.serviceLandlordCents === null || st.serviceLandlordCents < 0) {
      throw new HeatingError(400, 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein, wie ihn die Abrechnung nennt.')
    }
    if (st.serviceUnitsCount === null || st.serviceUnitsCount < 1) {
      throw new HeatingError(400, 'Bitte tragen Sie die Zahl der Nutzeinheiten laut Abrechnung ein, mindestens 1.')
    }
  }
  if (st.serviceCostItemId !== null) {
    const [c] = await db.select({ plantId: costItems.heatingPlantId, period: costItems.period, key: costItems.key }).from(costItems).where(eq(costItems.id, st.serviceCostItemId))
    if (!c || c.plantId !== ctx.plant.id || String(c.period) !== h.key || c.key !== 'amounts') {
      throw new HeatingError(400, 'Die gewählte Position gehört nicht zu den Einzelbeträgen des Messdienstes dieser Heizperiode. Bitte wählen Sie eine Position der Heizanlage mit dem Schlüssel Einzelbeträge.')
    }
  }
  // Beträge je Mietverhältnis nur für Mietverhältnisse desselben Objekts (Objektgrenze, #92).
  const ids = st.reliefs.map((r) => r.tenancyId)
  if (ids.length > 0) {
    const rows = await db.select({ id: tenancies.id, propertyId: units.propertyId }).from(tenancies).innerJoin(units, eq(tenancies.unitId, units.id)).where(inArray(tenancies.id, ids))
    if (rows.some((r) => r.propertyId !== ctx.plant.propertyId)) {
      throw new CrossPropertyError('Ein Betrag „vom Vermieter übernommen“ gehört zu einem Mietverhältnis eines anderen Objekts als die Heizanlage. Bitte wählen Sie ein Mietverhältnis desselben Objekts.')
    }
    if (rows.length < ids.length) {
      throw new HeatingError(400, 'Ein Mietverhältnis, für das ein Betrag „vom Vermieter übernommen“ eingetragen ist, gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
    }
  }
}

const co2Row = (st: Co2Statement, heatingPeriodId: string) => ({
  heatingPeriodId, method: st.method, areaM2: st.areaM2, serviceEmissionsKg: st.serviceEmissionsKg, serviceAreaM2: st.serviceAreaM2,
  serviceKgPerM2: st.serviceKgPerM2, serviceLandlordPermille: st.serviceLandlordPermille, serviceTotalCents: st.serviceTotalCents,
  serviceLandlordCents: st.serviceLandlordCents, serviceUsersTotalCents: st.serviceUsersTotalCents, serviceUsersTotalApprox: st.serviceUsersTotalApprox,
  serviceUnitsCount: st.serviceUnitsCount, serviceCostItemId: st.serviceCostItemId, serviceSelfLandlordCents: st.serviceSelfLandlordCents,
  serviceFuelGrossCents: st.serviceFuelGrossCents, serviceFuelNetCents: st.serviceFuelNetCents,
})

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveCo2Statement(db: Database, plantId: string, period: string, body: unknown): Promise<Co2Statement | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const current = (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key) ?? null
  const next = mergeCo2(current ?? newStatement(plantId, h.key, body), body)
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    await guardCo2(tx, ctx, h, next)
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    const { heatingPeriodId: _id, ...rest } = co2Row(next, heatingPeriodId)
    if (current) await tx.update(co2Statements).set(rest).where(eq(co2Statements.heatingPeriodId, heatingPeriodId))
    else await tx.insert(co2Statements).values(co2Row(next, heatingPeriodId))
    await tx.delete(co2TenantReliefs).where(eq(co2TenantReliefs.statementId, heatingPeriodId))
    if (next.reliefs.length > 0) {
      await tx.insert(co2TenantReliefs).values(next.reliefs.map((r) => ({ statementId: heatingPeriodId, tenancyId: r.tenancyId, cents: r.cents })))
    }
  })
  return (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key) ?? null
}

// `true` entfernt, `false` gab es nicht, `null` keine Anlage.
export async function removeCo2Statement(db: Database, plantId: string, period: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const h = heatingPeriodOf(ctx, period)
  const current = (await readCo2Statements(db)).find((s) => s.plantId === plantId && s.period === h.key)
  if (!current) return false
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    await tx.delete(co2Statements).where(eq(co2Statements.heatingPeriodId, current.heatingPeriodId))
    await dropIfEmpty(tx, current.heatingPeriodId)
  })
  return true
}

// ---------- Warmwasser laut Messdienst (#211, Entwurf 7.7) ----------

// Wie der Messdienst die Wärme für das Warmwasser ermittelt hat, und bei einer Formel, ob das Messen
// nur mit unzumutbar hohem Aufwand möglich wäre (§ 9 Abs. 2 Satz 2 HeizkostenV). Die Bestätigung
// gibt es nur zu einer Formel.
export async function saveHotWater(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingPeriodView['hotWater'] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'service') {
    throw new HeatingError(400, 'Die Angabe, wie die Wärme für das Warmwasser ermittelt wurde, gibt es hier nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet. Bei eigener Abrechnung rechnet Mietfuchs den Warmwasseranteil mit einer späteren Version selbst.')
  }
  const h = heatingPeriodOf(ctx, period)
  const text = raw(body, 'dhwMethod')
  const dhwMethod = text === null || text === undefined || text === '' ? null : oneOfOrUndefined(DHW_METHODS, text)
  if (dhwMethod === undefined) throw new HeatingError(400, 'Dieses Verfahren für das Warmwasser kennt Mietfuchs nicht. Bitte wählen Sie aus der Liste.')
  const formula = dhwMethod === 'volumeFormula' || dhwMethod === 'areaFormula'
  const answer = raw(body, 'dhwUnmeasurable')
  const dhwUnmeasurable = formula && has(body, 'dhwUnmeasurable') && typeof answer === 'boolean' ? answer : null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({ dhwMethod, dhwUnmeasurable }).where(eq(heatingPeriods.id, heatingPeriodId))
    await dropIfEmpty(tx, heatingPeriodId)
  })
  return { dhwMethod, dhwUnmeasurable }
}
