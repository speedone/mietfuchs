// Betriebsstrom und Abzug gemeinsam anlegen (Heizung PR 15, #212): die Schätzhilfe der Seite Heizkosten.
// Beide Positionen entstehen in **einer** Transaktion über denselben Weg wie jede andere Position
// (`insertCostItemIn`), damit kein Abzug ohne Betriebsstrom stehenbleibt und dieselben Prüfungen gelten.
//
// Der Betriebsstrom geht wie der Brennstoff (bei eigener Abrechnung nach der Heizkostenverordnung, Ziel
// `both`), der Abzug wie der Allgemeinstrom. Beim Messdienst gibt es nur den Abzug, denn der Messdienst
// verteilt den Betriebsstrom in seinen Beträgen.
//
// Die Grundlage der Schätzung (P-W1) steht an beiden Positionen: Bestreitet ein Mieter den Betrag, muss
// der Vermieter sie darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { basisOf, euro, GENERAL_POWER_CATEGORY, operatingPowerRefusal, operatingPowerShare, ownEstimateShare } from '../../../shared/operatingPower.ts'
import type { CostItem, OperatingPowerDevice } from '../../../shared/types.ts'
import { periodLabel, periodOfKey, spansTwoYears, startYearOf } from '../../../shared/period.ts'
import type { Database } from './client.ts'
import { heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readCostItems } from './read.ts'
import { has, HeatingError, insertCostItemIn, itemPeriodClosed, raw } from './repository.ts'

export type OperatingPowerMethod = 'estimate' | 'measured' | 'own'
export type OperatingPowerBooking = { method: OperatingPowerMethod; share: { cents: number; steps: string[] }; heatingItem: CostItem | null; deduction: CostItem }

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')

function devicesOf(value: unknown): OperatingPowerDevice[] | null {
  if (!Array.isArray(value)) return null
  return value.map((d, i) => ({
    label: textOf(raw(d, 'label')).trim() || `Gerät ${i + 1}`,
    watts: numberOrNull(raw(d, 'watts')) ?? 0,
    hoursPerDay: numberOrNull(raw(d, 'hoursPerDay')) ?? 0,
    // P-K8: eigene Tage des Geräts, sonst die Heiztage.
    days: numberOrNull(raw(d, 'days')),
  }))
}

const HOW: Record<OperatingPowerMethod, string> = { estimate: 'geschätzt', measured: 'gemessen', own: 'selbst geschätzt' }

// P-W4, R2-K2: Bei einer Gemeinschaftsabrechnung muss die Gemeinschaft den Betriebsstrom mit den
// Heizkosten verteilen, tut es aber nicht immer (V ZR 166/15 war genau dieser Fall). Mietfuchs hat keinen
// Weg, dort abzuziehen; der Satz verspricht deshalb keinen.
const COMMUNITY_DUTY = 'Den Betriebsstrom mit den Heizkosten zu verteilen, dazu ist die Gemeinschaft verpflichtet (BGH, Urteil vom 03.06.2016, V ZR 166/15). ' +
  'Prüfen Sie in der Hausgeldabrechnung, ob der Betriebsstrom bei den Heizkosten steht; steht er im Allgemeinstrom, wenden Sie sich an die Verwaltung. ' +
  'Für Ihre Abrechnung an die Mieter gilt dasselbe (§ 7 Abs. 2 HeizkostenV).'

// Die Verteilung, die der Abzug vom Allgemeinstrom übernimmt und der Betriebsstrom von der
// Brennstoffposition. Einzelbeträge und Gemeinschaftsabrechnung lassen sich nicht übertragen; beide
// Fälle lehnt die Hilfe vorher mit eigenem Satz ab.
const distributionOf = (c: CostItem) => ({
  key: c.key,
  ...(c.meterType ? { meterType: c.meterType } : {}),
  ...(c.directUnitId ? { directUnitId: c.directUnitId } : {}),
  ...(c.customShares ? { customShares: c.customShares } : {}),
  ...(c.participantUnitIds ? { participantUnitIds: c.participantUnitIds } : {}),
})

export async function bookOperatingPower(db: Database, plantId: string, body: unknown, newId: () => string): Promise<OperatingPowerBooking | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const plant = ctx.plant
  // P-W5, R2-W1, R-W2: Bei Wärmepumpe und Stromheizung gehört der Strom zur Wärmeerzeugung zu den Heizkosten,
  // aber nicht als Betriebsstrom (§ 7 Abs. 2 HeizkostenV); keine Schätzhilfe.
  // Pumpen und Regelung lassen sich im Kostenformular kennzeichnen und verknüpfen (repository.ts).
  const refusal = operatingPowerRefusal(plant.energy)
  if (refusal) throw new HeatingError(400, refusal)
  // heatingPeriodOf wirft selbst HeatingError(400), wenn es die Heizperiode nicht gibt.
  const h = heatingPeriodOf(ctx, textOf(raw(body, 'period')))
  if (await heatingPeriodClosed(db, ctx, h)) {
    throw new HeatingError(409, 'Die Abrechnung dieser Heizperiode ist abgeschlossen. Öffnen Sie sie wieder, bevor Sie den Betriebsstrom erfassen.')
  }
  const items = await readCostItems(db)
  const generalId = textOf(raw(body, 'generalItemId'))
  const general = items.find((c) => c.id === generalId && c.propertyId === plant.propertyId)
  if (!general || general.category !== GENERAL_POWER_CATEGORY || !(general.amountCents > 0) || general.operatingPower !== undefined) {
    throw new HeatingError(400, `Bitte wählen Sie die Stromrechnung des Hauses: eine Position der Kostenart „${GENERAL_POWER_CATEGORY}“ mit positivem Betrag.`)
  }
  // P-W3: Steht der Allgemeinstrom in einer abgeschlossenen Abrechnung, erreichte ein Abzug dort die
  // Mieter nicht mehr, und sie zahlten den Betriebsstrom zweimal (V ZR 166/15 Rn. 13).
  if (await itemPeriodClosed(db, general)) {
    throw new HeatingError(409, `Der Allgemeinstrom „${general.description}“ steht in einer abgeschlossenen Abrechnung; ein Abzug dort käme bei den Mietern nicht mehr an. Öffnen Sie diese Abrechnung wieder, bevor Sie den Betriebsstrom erfassen, oder wählen Sie die Stromrechnung eines offenen Zeitraums.`)
  }
  // Durchsicht von #252, G-K1 und N1: Der Betriebsstrom einer Heizperiode steckt nur in einer
  // Stromrechnung, deren Zeitraum sich mit ihr überschneidet; ein Abzug aus einer anderen käme bei den
  // Mietern eines anderen Zeitraums an.
  const generalPeriod = periodOfKey(ctx.objectRules, general.period)
  if (!generalPeriod || generalPeriod.to < h.from || generalPeriod.from > h.to) {
    throw new HeatingError(400, `Die Stromrechnung „${general.description}“${generalPeriod ? ` (${periodLabel(generalPeriod)})` : ''} liegt nicht in der Heizperiode ${periodLabel(h)}; den Betriebsstrom dieser Heizperiode enthält sie nicht. Wählen Sie die Stromrechnung, deren Zeitraum sich mit der Heizperiode überschneidet.`)
  }
  // G-K1, G-K2: Betriebsstrom und Abzug sind eine Umbuchung aus der Stromrechnung und zählen in der
  // Steuer zu einem Jahr. Berührt die Heizperiode zwei Kalenderjahre, ist es das der Stromrechnung; sonst
  // ist es das Jahr der Heizperiode, und führend ist dann der Betriebsstrom (G2-N-W2): Sein Jahr lässt sich
  // nicht anders stellen, der Abzug bekommt dasselbe. Angegeben wird es nur, wo ein Zeitraum zwei
  // Kalenderjahre berührt; sonst ist es das Jahr des Zeitraums (repository.ts).
  const taxYear = general.taxYear ?? startYearOf(general.period)
  const heatingTaxYear = spansTwoYears(h) ? taxYear : Number(h.from.slice(0, 4))
  if (general.key === 'amounts') {
    throw new HeatingError(400, 'Der Allgemeinstrom ist nach Einzelbeträgen verteilt; einen Abzug in derselben Verteilung gibt es nicht. Ziehen Sie den Betriebsstrom bitte in den Beträgen selbst ab.')
  }
  if (general.key === 'external') {
    throw new HeatingError(400, `Der Allgemeinstrom ist laut Gemeinschaftsabrechnung verteilt; einen Abzug in derselben Verteilung gibt es nicht. ${COMMUNITY_DUTY}`)
  }
  // Drei Wege: selbst geschätzt (P-W2), gemessen, nach Leistung und Tagen.
  const ownCents = numberOrNull(raw(body, 'ownCents'))
  const measuredKwh = numberOrNull(raw(body, 'measuredKwh'))
  const method: OperatingPowerMethod = ownCents !== null || has(body, 'basis') ? 'own' : measuredKwh !== null || has(body, 'measuredKwh') ? 'measured' : 'estimate'
  const share = method === 'own'
    ? ownEstimateShare({ cents: ownCents, basis: textOf(raw(body, 'basis')), billCents: general.amountCents })
    : operatingPowerShare({
      devices: method === 'estimate' ? devicesOf(raw(body, 'devices')) : null,
      heatingDays: method === 'estimate' ? numberOrNull(raw(body, 'heatingDays')) : null,
      measuredKwh: method === 'measured' ? (measuredKwh ?? 0) : null,
      billKwh: numberOrNull(raw(body, 'billKwh')) ?? 0,
      billCents: general.amountCents,
    })
  if ('error' in share) throw new HeatingError(400, share.error)
  // Durchsicht von #252, G-W1: Aus einer Stromrechnung lässt sich nicht mehr abziehen, als sie beträgt;
  // sonst wäre der Allgemeinstrom netto negativ und der Betriebsstrom doppelt verteilt.
  const fromGeneral = items.filter((c) => c.operatingPowerGeneralId === general.id)
  const deducted = -fromGeneral.reduce((a, c) => a + c.amountCents, 0)
  if (deducted + share.cents > general.amountCents) {
    throw new HeatingError(400, `Aus der Stromrechnung „${general.description}“ (${euro(general.amountCents)}) sind schon ${euro(deducted)} abgezogen (${fromGeneral.map((c) => `„${c.description}“`).join(', ')}); mit ${euro(share.cents)} wären es ${euro(deducted + share.cents)}, mehr als die Rechnung. Prüfen Sie die vorhandenen Abzüge.`)
  }
  // Ein zweiter Betriebsstrom derselben Anlage und Heizperiode oder ein zweiter Abzug aus derselben
  // Rechnung ist meist eine doppelte Buchung; nach einem Kesseltausch im Jahr ist er richtig. Deshalb eine
  // Rückfrage und keine Sperre (wie `despiteCandidates` bei der Belegbuchung).
  const booked = [...items.filter((c) => c.operatingPower === 'included' && c.heatingPlantId === plant.id && c.period === h.key), ...fromGeneral]
  if (booked.length > 0 && raw(body, 'despiteExisting') !== true) {
    throw new HeatingError(409, `Für diese Heizperiode oder diese Stromrechnung ist schon gebucht: ${booked.map((c) => `„${c.description}“ (${euro(Math.abs(c.amountCents))})`).join(', ')}. Eine zweite Buchung verteilt den Betriebsstrom doppelt. Legen Sie nur dann noch einmal an, wenn es ein weiterer Betriebsstrom ist, etwa nach einem Kesseltausch im Jahr.`)
  }
  const how = HOW[method]
  const operatingPowerBasis = basisOf(share.steps)

  let heatingBody: Record<string, unknown> | null = null
  if (plant.method !== 'service') {
    const base = {
      propertyId: plant.propertyId, period: h.key, category: HEATING_CATEGORY, description: `Betriebsstrom Heizung (${how})`,
      amountCents: share.cents, heatingPlantId: plant.id, heatingPart: 'operating', operatingPower: 'included', operatingPowerBasis,
      ...(spansTwoYears(h) ? { taxYear } : {}),
    }
    if (plant.method === 'self') {
      heatingBody = { ...base, key: 'heatingSystem', heatingTarget: 'both' }
    } else {
      const fuel = items
        .filter((c) => c.heatingPlantId === plant.id && c.period === h.key && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null))
        .sort((a, b) => b.amountCents - a.amountCents)[0]
      if (!fuel) {
        // P-K2: Verteilt wird nach § 7 Abs. 1 (beim Warmwasser § 8 Abs. 1); Abs. 2 zählt die Kosten auf.
        throw new HeatingError(400, 'Erfassen Sie zuerst die Brennstoffposition der Heizperiode; der Betriebsstrom wird nach ihrem Schlüssel verteilt (§ 7 Abs. 1 und 2 HeizkostenV).')
      }
      // R2-K1: je ein eigener Satz; bei der Gemeinschaftsabrechnung derselbe Verweis wie beim Allgemeinstrom.
      if (fuel.key === 'amounts') {
        throw new HeatingError(400, `„${fuel.description}“ ist nach Einzelbeträgen verteilt; einen Betriebsstrom in derselben Verteilung legt Mietfuchs nicht an. Nehmen Sie den Betriebsstrom bitte in die Einzelbeträge auf und erfassen Sie den Abzug beim Allgemeinstrom im Kostenformular.`)
      }
      if (fuel.key === 'external') {
        throw new HeatingError(400, `„${fuel.description}“ ist laut Gemeinschaftsabrechnung verteilt; einen Betriebsstrom in derselben Verteilung legt Mietfuchs nicht an. ${COMMUNITY_DUTY}`)
      }
      heatingBody = { ...base, ...distributionOf(fuel), ...(fuel.heatingTarget ? { heatingTarget: fuel.heatingTarget } : {}) }
    }
  }
  const heatingId = heatingBody ? newId() : null
  const deductionId = newId()
  const deductionBody = {
    propertyId: plant.propertyId, period: general.period, category: GENERAL_POWER_CATEGORY,
    // P-K9: Beim Messdienst hat der Abzug kein Gegenstück in Mietfuchs; die Beschreibung sagt, wohin der
    // Betrag gehört. Meldet der Vermieter ihn nicht, trägt er ihn selbst (zulässig, V ZR 166/15 Rn. 15).
    description: `Abzug Betriebsstrom Heizung (${how})${plant.method === 'service' ? ', an Messdienst gemeldet' : ''}`,
    amountCents: -share.cents, ...distributionOf(general),
    ...(spansTwoYears(generalPeriod) ? { taxYear: heatingBody ? heatingTaxYear : taxYear } : {}),
    operatingPower: 'deduction', operatingPowerBasis, operatingPowerGeneralId: general.id, ...(heatingId ? { operatingPowerItemId: heatingId } : {}),
  }
  await db.transaction(async (tx) => {
    if (heatingBody && heatingId) await insertCostItemIn(tx, heatingId, heatingBody)
    await insertCostItemIn(tx, deductionId, deductionBody)
  })
  const after = await readCostItems(db)
  const deduction = after.find((c) => c.id === deductionId)
  if (!deduction) throw new Error('Der Abzug ist nach dem Anlegen nicht auffindbar.')
  return { method, share: { cents: share.cents, steps: share.steps }, heatingItem: heatingId ? (after.find((c) => c.id === heatingId) ?? null) : null, deduction }
}
