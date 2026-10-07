// Pflichtangaben und Ausnahmen je Heizperiode in der Datenbank (Heizung PR 14, #99, Entwurf 8.8, 8.9).
//
// **Angaben nach § 6a** (`saveHeatingInfo`): Steuern und Abgaben, Fernwärme, Klimafaktoren mit Quelle und der
// Vergleichswert eines Durchschnittsnutzers mit Quelle. Bei eigener Abrechnung und bei freien Schlüsseln; beim
// Messdienst stehen sie in dessen Abrechnung, bei einer Etagenheizung gilt die Verordnung nicht (§ 1 Abs. 1).
//
// **Ausnahme, Vereinbarung, monatliche Information, Verbrauchervertrag** (`saveHeatingRules`): je Heizperiode;
// sie gelten ab ihr für die folgenden der Linie (server/src/heatingInfo.ts, `heatingRulesOf`). Eine Antwort
// ändert nie eine frühere Heizperiode. Eine abgeschlossene Heizperiode nimmt nichts mehr an (409).
import { eq } from 'drizzle-orm'
import type { HeatingInfoInputs, HeatingPeriodData } from '../../../shared/types.ts'
import { CONSUMER_CONTRACT_NONE, postalCodeOf } from '../../../shared/heatingInfo.ts'
import { mayAgreeOtherwise } from '../../../shared/heating.ts'
import type { Database } from './client.ts'
import { closedText, dropIfEmpty, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readProperties, readTenancies, readUnits } from './read.ts'
import { has, HeatingError, oneOfOrUndefined, raw } from './repository.ts'
import { AGREED_OTHERWISE, EXEMPTION_SCOPES, HEATING_EXEMPTIONS, heatingPeriods } from './schema.ts'

type Inputs = Omit<HeatingInfoInputs, 'postalCode'>
export type OwnRules = Pick<HeatingPeriodData, 'exemption' | 'exemptionScope' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere' | 'consumerContract'>

export const REFERENCE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'
export const CLIMATE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle der Klimafaktoren, etwa „Deutscher Wetterdienst, Klimafaktoren“ mit Postleitzahl und Zeitraum.'

function numberOrNull(v: unknown, text: string, positive: boolean): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive ? v <= 0 : v < 0)) throw new HeatingError(400, text)
  return v
}
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

// Die Anlage, wenn sie hier Angaben annimmt; `null`, wenn es sie nicht gibt.
async function contextFor(db: Database, plantId: string, period: string, what: 'info' | 'rules') {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.supply === 'perUnit') {
    throw new HeatingError(400, 'Für Etagenheizungen gilt die Heizkostenverordnung nicht (§ 1 Abs. 1 HeizkostenV); Angaben nach § 6a, Ausnahmen nach § 11 und Vereinbarungen nach § 2 gibt es dafür nicht.')
  }
  if (what === 'info' && ctx.plant.method === 'service') {
    throw new HeatingError(400, 'Rechnet ein Messdienst oder die Gemeinschaft ab, stehen die Angaben nach § 6a HeizkostenV in deren Abrechnung; hier tragen Sie nichts ein.')
  }
  return { ctx, h: heatingPeriodOf(ctx, period) }
}

export async function saveHeatingInfo(db: Database, plantId: string, period: string, body: unknown): Promise<HeatingInfoInputs | null> {
  const found = await contextFor(db, plantId, period, 'info')
  if (!found) return null
  const { ctx, h } = found
  const next: Partial<Inputs> = {}
  if (has(body, 'infoTaxesText')) next.infoTaxesText = textOrNull(raw(body, 'infoTaxesText'))
  if (has(body, 'infoDistrictGhg')) next.infoDistrictGhg = numberOrNull(raw(body, 'infoDistrictGhg'), 'Die Treibhausgasemissionen sind eine Zahl ab 0 (g CO₂-Äquivalent je kWh).', false)
  if (has(body, 'infoDistrictPef')) next.infoDistrictPef = numberOrNull(raw(body, 'infoDistrictPef'), 'Der Primärenergiefaktor ist eine Zahl ab 0.', false)
  if (has(body, 'climateFactor')) next.climateFactor = numberOrNull(raw(body, 'climateFactor'), 'Der Klimafaktor ist eine Zahl größer als 0.', true)
  if (has(body, 'climateFactorPrev')) next.climateFactorPrev = numberOrNull(raw(body, 'climateFactorPrev'), 'Der Klimafaktor ist eine Zahl größer als 0.', true)
  if (has(body, 'climateFactorSource')) next.climateFactorSource = textOrNull(raw(body, 'climateFactorSource'))
  if (has(body, 'infoReferenceKwhPerM2')) next.infoReferenceKwhPerM2 = numberOrNull(raw(body, 'infoReferenceKwhPerM2'), 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche in der Heizperiode).', true)
  if (has(body, 'infoReferenceSource')) next.infoReferenceSource = textOrNull(raw(body, 'infoReferenceSource'))
  let saved: Inputs | null = null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    const [before] = await tx.select().from(heatingPeriods).where(eq(heatingPeriods.id, id))
    // Geprüft wird der Stand nach dem Zusammenführen: Ein Rumpf kann nur die Quelle oder nur den Wert ändern.
    const after = <K extends keyof Inputs>(k: K): Inputs[K] | null => (next[k] !== undefined ? (next[k] as Inputs[K]) : ((before?.[k] ?? null) as Inputs[K] | null))
    if (after('infoReferenceKwhPerM2') !== null && after('infoReferenceSource') === null) throw new HeatingError(400, REFERENCE_SOURCE_TEXT)
    if ((after('climateFactor') !== null || after('climateFactorPrev') !== null) && after('climateFactorSource') === null) throw new HeatingError(400, CLIMATE_SOURCE_TEXT)
    if (Object.keys(next).length > 0) await tx.update(heatingPeriods).set(next).where(eq(heatingPeriods.id, id))
    const [r] = await tx.select().from(heatingPeriods).where(eq(heatingPeriods.id, id))
    await dropIfEmpty(tx, id)
    saved = {
      infoTaxesText: r?.infoTaxesText ?? null, infoDistrictGhg: r?.infoDistrictGhg ?? null, infoDistrictPef: r?.infoDistrictPef ?? null,
      climateFactor: r?.climateFactor ?? null, climateFactorPrev: r?.climateFactorPrev ?? null, climateFactorSource: r?.climateFactorSource ?? null,
      infoReferenceKwhPerM2: r?.infoReferenceKwhPerM2 ?? null, infoReferenceSource: r?.infoReferenceSource ?? null,
    }
  })
  if (!saved) throw new Error('Die Heizperiode ist nach dem Speichern nicht auffindbar.')
  const property = (await readProperties(db)).find((p) => p.id === ctx.plant.propertyId)
  return { ...(saved as Inputs), postalCode: postalCodeOf(property?.address ?? null) }
}

// § 2 HeizkostenV: eine abweichende Vereinbarung nur im Gebäude mit höchstens zwei Wohnungen, von denen der
// Vermieter eine selbst bewohnt. Wohnung ist hier, was Fläche hat, selbst genutzt wird oder ein
// Mietverhältnis hat; die Berechnung prüft im Zeitraum erneut und wendet eine Vereinbarung nicht an, sobald
// das Haus größer ist.
export const AGREEMENT_TEXT = 'Eine abweichende Vereinbarung nach § 2 HeizkostenV gibt es nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Legen Sie Ihre eigene Wohnung in den Stammdaten als selbstgenutzt an, wenn das zutrifft.'

export async function saveHeatingRules(db: Database, plantId: string, period: string, body: unknown): Promise<OwnRules | null> {
  const found = await contextFor(db, plantId, period, 'rules')
  if (!found) return null
  const { ctx, h } = found
  const next: Partial<OwnRules> = {}
  const enumOf = <T extends string>(list: readonly T[], key: string, text: string): T | null => {
    const v = raw(body, key)
    if (v === null || v === '') return null
    const ok = oneOfOrUndefined(list, v)
    if (ok === undefined) throw new HeatingError(400, text)
    return ok
  }
  const boolOf = (key: string): boolean | null => {
    const v = raw(body, key)
    if (v === null) return null
    if (typeof v !== 'boolean') throw new HeatingError(400, 'Bitte antworten Sie mit Ja oder Nein.')
    return v
  }
  if (has(body, 'exemption')) next.exemption = enumOf(HEATING_EXEMPTIONS, 'exemption', 'Diese Ausnahme kennt Mietfuchs nicht. Bitte laden Sie die Seite neu.')
  if (has(body, 'exemptionScope')) next.exemptionScope = enumOf(EXEMPTION_SCOPES, 'exemptionScope', 'Bitte wählen Sie, ob die Ausnahme auch das Warmwasser betrifft.')
  if (has(body, 'exemptionBillingAgreed')) next.exemptionBillingAgreed = boolOf('exemptionBillingAgreed')
  if (has(body, 'agreedOtherwise')) next.agreedOtherwise = enumOf(AGREED_OTHERWISE, 'agreedOtherwise', 'Diese Vereinbarung kennt Mietfuchs nicht. Bitte laden Sie die Seite neu.')
  if (has(body, 'monthlyInfoElsewhere')) next.monthlyInfoElsewhere = boolOf('monthlyInfoElsewhere')
  if (has(body, 'consumerContract')) {
    const c = raw(body, 'consumerContract')
    if (c === null) next.consumerContract = null
    else if (c === CONSUMER_CONTRACT_NONE) next.consumerContract = CONSUMER_CONTRACT_NONE
    else if (typeof c === 'string' && c.trim() !== '') next.consumerContract = c.trim()
    else throw new HeatingError(400, 'Bei einem Verbrauchervertrag tragen Sie die Information zur Streitbeilegung ein (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV); sonst wählen Sie „Nein“.')
  }
  if (next.agreedOtherwise !== undefined && next.agreedOtherwise !== null && next.agreedOtherwise !== 'none') {
    const units = (await readUnits(db)).filter((u) => u.propertyId === ctx.plant.propertyId)
    const tenancies = await readTenancies(db)
    const dwelling = (u: (typeof units)[number]) => (u.areaM2 || 0) > 0 || u.selfUsed === true || tenancies.some((t) => t.unitId === u.id)
    if (!mayAgreeOtherwise(units, dwelling)) throw new HeatingError(400, AGREEMENT_TEXT)
  }
  let saved: OwnRules | null = null
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const id = await ensureHeatingPeriod(tx, plantId, h.key)
    const [before] = await tx.select().from(heatingPeriods).where(eq(heatingPeriods.id, id))
    const exemption = next.exemption !== undefined ? next.exemption : (before?.exemption ?? null)
    // Ohne Ausnahme gibt es weder den Umfang noch die vereinbarte Abrechnung (§ 2 Abs. 7 CO2KostAufG).
    if (exemption === null || exemption === 'none') {
      next.exemptionScope = null
      next.exemptionBillingAgreed = null
    }
    if (Object.keys(next).length > 0) await tx.update(heatingPeriods).set(next).where(eq(heatingPeriods.id, id))
    const [r] = await tx.select().from(heatingPeriods).where(eq(heatingPeriods.id, id))
    await dropIfEmpty(tx, id)
    saved = {
      exemption: r?.exemption ?? null, exemptionScope: r?.exemptionScope ?? null, exemptionBillingAgreed: r?.exemptionBillingAgreed ?? null,
      agreedOtherwise: r?.agreedOtherwise ?? null, monthlyInfoElsewhere: r?.monthlyInfoElsewhere ?? null, consumerContract: r?.consumerContract ?? null,
    }
  })
  return saved
}
