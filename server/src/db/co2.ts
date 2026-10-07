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
// (Methode der Anlage `service`) und seit Heizung PR 11 die Angaben zum Warmwasser bei eigener
// Heizkostenabrechnung (`self`).
//
// Diese Datei importiert aus repository.ts und read.ts, nie umgekehrt.
import { lineRowsOf } from './selfLine.ts'
import { selfActive, selfFromOf } from '../heating.ts'
import { captureOf, hotWaterOf, lineServiceRows } from '../hca.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { consumptionInPeriod } from '../calc.ts'
import { suppliedAreaOf } from '../dhw.ts'
import { lineRoot, servesUnit } from '../../../shared/heatingPeriod.ts'
import { andList } from '../../../shared/wording.ts'
import { dayBefore, germanDate as germanDay } from '../../../shared/law/register.ts'
import type { BillingPeriod, Co2Statement, Co2TenantRelief, HeatingPeriodView, PeriodKey } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { co2ApplicableFrom, co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, valueAt } from '../../../shared/law/register.ts'
import { heatingPeriodsEndingIn } from '../../../shared/heatingPeriod.ts'
import { periodLabel, periodOfKey, resolvePeriodParam } from '../../../shared/period.ts'
import type { Database, Executor } from './client.ts'
import { readCo2Statements, readCostItems, readProperties, readHeatingServiceValues, readMeters, readReadings, readStock, readUnits } from './read.ts'
import { stockViewFor } from './fuelStock.ts'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import { asNullableFilled, CrossPropertyError, has, HeatingError, merged, oneOfOrUndefined, plantSpanOf, raw } from './repository.ts'
import { closedText, dropIfEmpty, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext, type PlantContext } from './heatingPeriodContext.ts'
// Für ältere Importe (Tests): Die Helfer der Heizperioden stehen seit Heizung PR 8 in heatingPeriodContext.ts.
export { dropIfEmpty, ensureHeatingPeriod } from './heatingPeriodContext.ts'
import { distributionOf } from './heatingSelf.ts'
import { heatingRulesOf } from '../heatingInfo.ts'
import { postalCodeOf } from '../../../shared/heatingInfo.ts'
import { CO2_METHODS, co2Statements, co2TenantReliefs, costItems, DHW_METHODS, heatingPeriods, tenancies, units } from './schema.ts'

const ASK_METHOD = 'Bitte beantworten Sie zuerst die Frage, ob die Kostenaufstellung eine Zeile wie „Abzüglich CO₂-Kosten Vermieter“ enthält.'
const SERVICE_NOT_SELF = 'Rechnet ein Messdienst oder die Gemeinschaft ab, beantworten Sie die Frage nach der Abzugszeile. Hat der Messdienst die CO₂-Kosten nicht aufgeteilt, wählen Sie „gar nicht aufgeteilt“; mit der Brennstoffrechnung als Lieferung teilt Mietfuchs dann selbst auf.'
const MANUAL_SELF = 'Bei freien Schlüsseln teilt Mietfuchs die CO₂-Kosten selbst auf, ebenso bei der eigenen Heizkostenabrechnung, aus den Lieferungen des Versorgers. Angeben lässt sich hier nur die Fläche der Einstufung, wenn sie von der Wohnfläche der versorgten Wohnungen abweicht.'
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
export async function heatingPeriodViews(db: Database, plantId: string, periodParam: string, today = ''): Promise<HeatingPeriodView[] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const resolved = resolvePeriodParam(ctx.objectRules, periodParam)
  if ('error' in resolved) throw new HeatingError(400, resolved.error)
  const p = resolved.period
  const hs = heatingPeriodsEndingIn(ctx.plantRules, p)
  const statements = (await readCo2Statements(db)).filter((s) => s.plantId === plantId)
  const rows = await db.select().from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const items = (await readCostItems(db)).filter((c) => c.heatingPlantId === plantId && c.category === HEATING_CATEGORY)
  // Der Vorrat (Heizung PR 8) nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle; seit Heizung PR 10
  // auch bei der eigenen Heizkostenabrechnung (Entwurf 8.2).
  const stockData = isStockEnergy(ctx.plant.energy) ? await readStock(db) : null
  const lineRows = ctx.plant.method === 'self' ? (await lineRowsOf(db, plantId)).merged : []
  const selfBegin = selfFromOf(ctx.plant)
  // Für die Formeln (Heizung PR 11): angeschlossene Wohnungen, ihre Warmwasserzähler und Ablesungen.
  const served = (await readUnits(db)).filter((u) => u.propertyId === ctx.plant.propertyId && servesUnit(ctx.plant, u))
  // Nur Wohnungen mit Warmwasser (ohne „kein Anschluss: Warmwasser“, #117), wie die versorgte Fläche.
  const servedIds = new Set(served.filter((u) => !(u.noConnection ?? []).includes('warmwasser')).map((u) => u.id))
  const waterMeters = (await readMeters(db)).filter((m) => m.type === 'warmwasser' && m.unitId !== null && servedIds.has(m.unitId))
  const readings = waterMeters.length > 0 ? await readReadings(db) : []
  // Kesseltausch (Durchsicht von #240, Geld-I1): Die Anlage heizt nur in ihrer Laufzeit; Vorschlag und
  // Beschriftung gelten für sie. Verfahren, Temperatur und Bestätigung gelten für die Linie (der Speicher
  // bleibt), das Volumen ist das der Anlage selbst (wie calc.ts).
  const span = await plantSpanOf(db, plantId)
  const allPlants = (await lineRowsOf(db, plantId)).plants
  const lineIds = new Set(allPlants.filter((x) => lineRoot(x, allPlants) === lineRoot({ id: plantId, replacesPlantId: allPlants.find((y) => y.id === plantId)?.replacesPlantId ?? null }, allPlants)).map((x) => x.id))
  const lineRowsAll = lineIds.size > 1 ? await db.select().from(heatingPeriods).where(inArray(heatingPeriods.plantId, [...lineIds])) : rows
  const serviceValues = await readHeatingServiceValues(db)
  const postalCode = postalCodeOf((await readProperties(db)).find((x) => x.id === ctx.plant.propertyId)?.address ?? null)
  const views: HeatingPeriodView[] = []
  for (const h of hs) {
    const self = selfActive(ctx.plant, String(h.key))
    const row = rows.find((r) => r.period === h.key)
    const lineRow = lineRowsAll.find((r) => r.plantId !== plantId && r.period === h.key && r.dhwMethod !== null)
    const closed = await heatingPeriodClosed(db, ctx, h)
    const from = span.from !== null && span.from > h.from ? span.from : h.from
    const to = span.to !== null && span.to < h.to ? span.to : h.to
    const running = from !== h.from || to !== h.to ? { from, to } : null
    // Der Vorschlag für V nur, wenn jeder Warmwasserzähler am Beginn und am Ende abgelesen ist (M5);
    // sonst nennt die Karte, was fehlt.
    const missing = waterMeters.flatMap((m) => {
      const dates = readings.filter((r) => r.meterId === m.id).map((r) => r.date)
      const gaps = [
        ...(dates.some((d) => d <= dayBefore(from)) ? [] : [`zum ${germanDay(dayBefore(from))}`]),
        ...(dates.some((d) => d >= to) ? [] : [`zum ${germanDay(to)}`]),
      ]
      return gaps.length > 0 ? [`„${m.name}“ ${gaps.join(' und ')}`] : []
    })
    const volume = waterMeters.length === 0 || missing.length > 0 ? null
      : Math.round(waterMeters.reduce((a, m) => a + consumptionInPeriod(readings.filter((r) => r.meterId === m.id), from, to), 0) * 1000) / 1000
    views.push({
      plantId,
      period: h.key,
      label: periodLabel(h),
      from: h.from,
      to: h.to,
      short: h.short,
      closed,
      hotWater: {
        dhwMethod: row?.dhwMethod ?? lineRow?.dhwMethod ?? null, dhwUnmeasurable: row?.dhwUnmeasurable ?? lineRow?.dhwUnmeasurable ?? null,
        dhwHeatKwh: row?.dhwHeatKwh ?? null, totalHeatKwh: row?.totalHeatKwh ?? null,
        dhwVolumeM3: row?.dhwVolumeM3 ?? null, dhwTempC: row?.dhwTempC ?? lineRow?.dhwTempC ?? null,
      },
      // Vorschlag für V aus den Warmwasserzählern der angeschlossenen Wohnungen in der Laufzeit, auf Liter
      // gerundet, und die mit Warmwasser versorgte Fläche (§ 9 Abs. 2 Satz 5 Nr. 2 HeizkostenV).
      hotWaterBasis: {
        volumeFromMetersM3: volume,
        volumeMissing: missing.length > 0 ? `Für den Vorschlag aus den Warmwasserzählern fehlt ein Stand: ${andList(missing)}.` : null,
        running,
        suppliedAreaM2: suppliedAreaOf(served),
      },
      co2: statements.find((s) => s.period === h.key) ?? null,
      items: items
        .filter((c) => c.period === h.key)
        .map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, key: c.key, tenancyAmounts: c.tenancyAmounts, selfAmounts: c.selfAmounts, fuelDeliveryId: c.fuelDeliveryId })),
      stock: stockData ? stockViewFor(stockData, ctx, h, closed) : null,
      // Anteil nach Verbrauch (Heizung PR 10), nur bei eigener Abrechnung.
      // Über die Linie (Durchsicht von #239, I3), und erst ab dem Beginn der eigenen Abrechnung (I1).
      distribution: ctx.plant.method === 'self' && (selfBegin === null || h.key >= selfBegin || self)
        ? distributionOf(lineRows, ctx.plant.energy, h, today)
        : null,
      capture: self ? captureOf(ctx.plant, String(h.key)) : null,
      selfHotWater: self ? hotWaterOf(ctx.plant, String(h.key)) : null,
      // Über die Linie (Durchsicht von #241, I1): nach einem Kesseltausch dieselben Werte bei beiden Anlagen.
      serviceValues: lineServiceRows(serviceValues, allPlants, plantId, String(h.key)),
      // Heizung PR 14: Eingaben zu § 6a (eigene Zeile) und die Angaben zu § 11, § 2, monatlicher Information und
      // Verbrauchervertrag, wie sie gelten (geerbt über die Linie) und wie die eigene Zeile sie sagt.
      info: {
        infoTaxesText: row?.infoTaxesText ?? null, infoDistrictGhg: row?.infoDistrictGhg ?? null, infoDistrictPef: row?.infoDistrictPef ?? null,
        climateFactor: row?.climateFactor ?? null, climateFactorPrev: row?.climateFactorPrev ?? null, climateFactorSource: row?.climateFactorSource ?? null,
        infoReferenceKwhPerM2: row?.infoReferenceKwhPerM2 ?? null, infoReferenceSource: row?.infoReferenceSource ?? null,
        postalCode,
      },
      rules: heatingRulesOf(lineRowsAll.map((r) => ({ ...r, period: String(r.period) })), allPlants, plantId, String(h.key)),
      ownRules: {
        exemption: row?.exemption ?? null, exemptionScope: row?.exemptionScope ?? null, exemptionBillingAgreed: row?.exemptionBillingAgreed ?? null,
        agreedOtherwise: row?.agreedOtherwise ?? null, monthlyInfoElsewhere: row?.monthlyInfoElsewhere ?? null, consumerContract: row?.consumerContract ?? null,
      },
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
  // Heizung PR 10 (N7): bei der eigenen Heizkostenabrechnung wie bei freien Schlüsseln.
  if (ctx.plant.method !== 'service' && st.method !== 'self') throw new HeatingError(400, MANUAL_SELF)
  if (ctx.plant.method === 'service' && st.method === 'self') throw new HeatingError(400, SERVICE_NOT_SELF)
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

// Eingaben der Volumenformel (Heizung PR 11, § 9 Abs. 2 Satz 2 HeizkostenV): das gemessene Volumen und
// die gemessene oder geschätzte mittlere Temperatur. Ergänzend wie die Sammlungen in repository.ts: Was
// im Rumpf steht, ersetzt; was fehlt, bleibt.
function readFormulaInputs(body: unknown): { dhwVolumeM3?: number | null; dhwTempC?: number | null } {
  const out: { dhwVolumeM3?: number | null; dhwTempC?: number | null } = {}
  const numberOf = (key: string): number | null => {
    const v = raw(body, key)
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new HeatingError(400, key === 'dhwVolumeM3' ? 'Das Volumen des Warmwassers ist keine Zahl.' : 'Die Temperatur des Warmwassers ist keine Zahl.')
    return v
  }
  if (has(body, 'dhwVolumeM3')) {
    const v = numberOf('dhwVolumeM3')
    if (v !== null && !(v >= 0)) throw new HeatingError(400, 'Das Volumen des Warmwassers ist eine Zahl ab 0 m³.')
    out.dhwVolumeM3 = v
  }
  if (has(body, 'dhwTempC')) {
    const t = numberOf('dhwTempC')
    if (t !== null && !(t > 0 && t < 100)) throw new HeatingError(400, 'Die mittlere Temperatur des Warmwassers liegt zwischen 0 und 100 °C.')
    out.dhwTempC = t
  }
  return out
}

// Wie die Wärme für das Warmwasser ermittelt wurde, und bei einer Formel, ob das Messen nur mit
// unzumutbar hohem Aufwand möglich wäre (§ 9 Abs. 2 Satz 2 HeizkostenV). Die Bestätigung gibt es nur zu
// einer Formel. Beim Messdienst steht das Ergebnis in seiner Abrechnung; bei eigener Abrechnung (Heizung
// PR 11) rechnet Mietfuchs selbst und nimmt dazu Volumen und Temperatur.
export async function saveHotWater(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingPeriodView['hotWater'] | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method === 'manual') {
    throw new HeatingError(400, 'Die Angaben zum Warmwasser gibt es nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet, oder bei eigener Heizkostenabrechnung. Bei freien Schlüsseln verteilen die Positionen selbst.')
  }
  const h = heatingPeriodOf(ctx, period)
  const text = raw(body, 'dhwMethod')
  const dhwMethod = text === null || text === undefined || text === '' ? null : oneOfOrUndefined(DHW_METHODS, text)
  if (dhwMethod === undefined) throw new HeatingError(400, 'Dieses Verfahren für das Warmwasser kennt Mietfuchs nicht. Bitte wählen Sie aus der Liste.')
  const formula = dhwMethod === 'volumeFormula' || dhwMethod === 'areaFormula'
  const answer = raw(body, 'dhwUnmeasurable')
  const dhwUnmeasurable = formula && has(body, 'dhwUnmeasurable') && typeof answer === 'boolean' ? answer : null
  const formulaInputs = ctx.plant.method === 'self' ? readFormulaInputs(body) : {}
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.update(heatingPeriods).set({ dhwMethod, dhwUnmeasurable, ...formulaInputs }).where(eq(heatingPeriods.id, heatingPeriodId))
    await dropIfEmpty(tx, heatingPeriodId)
  })
  const [row] = await db.select().from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
  return {
    dhwMethod: row?.dhwMethod ?? null, dhwUnmeasurable: row?.dhwUnmeasurable ?? null, dhwHeatKwh: row?.dhwHeatKwh ?? null, totalHeatKwh: row?.totalHeatKwh ?? null,
    dhwVolumeM3: row?.dhwVolumeM3 ?? null, dhwTempC: row?.dhwTempC ?? null,
  }
}
