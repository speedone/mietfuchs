// CO₂-Kostenaufteilung (Heizung PR 6, #97, #209; Entwurf 7, 9.2, 9.4). Reine Funktionen. Die
// Rechtswerte reicht der Aufrufer aus dem Register herein (`law()` protokolliert sie); hier steht
// keine Zahl der Stufentabelle und kein Datum (law-literals.test.ts).
import type { Co2Stage } from '../../shared/law/co2kostaufg.ts'
import type { BillingPeriod, Co2Assessment, Co2StageRange, Co2Statement, Co2TenantLine, Co2TenantRelief, DhwMethod, HeatingEnergy, HeatingMethod, HeatingSource } from '../../shared/types.ts'
import { serviceProbe, type ProbeResult } from '../../shared/co2Probe.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { Snapshot, SnapshotCostItem, SnapshotHeatingPeriodRow, SnapshotUnit } from './snapshot.ts'

// Brennstoffe mit Standardwert für den Emissionsfaktor nach der EBeV, die das Gesetz erfasst (§ 2
// Abs. 1 Satz 1 CO2KostAufG, Entwurf 5.3). Die Wärmelieferung erfasst Satz 2 „hinsichtlich der für
// die Wärmeerzeugung eingesetzten Brennstoffe“; ob CO₂-Kosten anfallen, weist erst der Lieferant
// aus (§ 3 Abs. 4), deshalb steht sie nicht hier (R-A28). Holz und Pellets liest die CO₂-Rechnung
// als „nicht erfasst“ (W8).
export const CO2_FUELS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal']

// Warmwasser ohne Wärmezähler (§ 9 Abs. 2 Satz 2 und 4 HeizkostenV).
export const FORMULA_METHODS: readonly DhwMethod[] = ['volumeFormula', 'areaFormula']

// Ein Cent und die Rundung von L (ein halber Cent): so weit darf L neben C · ‰ liegen (Entwurf 9.2,
// 7.4 „|G − V − L| ≤ 1 ct + Rundung von L“).
export const L_TOLERANCE_CENTS = 1.5

// Gleitkomma-Rauschen an Grenzen (Entwurf 9.2: „kaufmännisch mit 1e-9 Toleranz“).
const EPS = 1e-9
const DAY_MS = 86400000

// Kaufmännisch auf `decimals` Nachkommastellen (§ 5 Abs. 1 Satz 3). Die Werte sind nie negativ.
export function roundSpecific(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f + EPS) / f
}

// Der Faktor, mit dem die Grenzen der Tabelle bei einem Zeitraum unter einem Jahr gekürzt werden
// (§ 5 Abs. 1 Satz 4): Tage des Zeitraums durch die Tage der zwölf Monate ab seinem Beginn. Ob ein
// einseitig gesetzter Rumpf „vereinbart“ ist, ist offen (Entwurf 15.1 Nr. 11); gekürzt wird wie bei
// den Messdiensten, die auf ihren Zeitraum rechnen.
export function tableFactor(period: { from: string; to: string; short: boolean }): number {
  if (!period.short) return 1
  const [y, m, d] = period.from.split('-').map(Number)
  const start = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)
  const yearLater = Date.UTC((y ?? 0) + 1, (m ?? 1) - 1, d ?? 1)
  const days = (Date.parse(`${period.to}T00:00:00Z`) - start) / DAY_MS + 1
  return days / ((yearLater - start) / DAY_MS)
}

// Die Tabelle als Spannen, mit gekürzten Grenzen.
export function stageRanges(table: readonly Co2Stage[], factor: number): Co2StageRange[] {
  return table.map((s, i) => {
    const next = table[i + 1]
    return { from: s.from * factor, to: next ? next.from * factor : null, landlordPercent: s.landlordPercent }
  })
}

// Die Stufe eines schon gerundeten Werts, unten einschließend (Anlage CO2KostAufG: „12 bis < 17“).
export function stageOf(value: number, ranges: readonly Co2StageRange[]): Co2StageRange {
  let found = ranges[0]
  for (const r of ranges) if (value >= r.from - EPS) found = r
  if (!found) throw new Error('Stufentabelle ohne Stufe')
  return found
}

export type Restage = { value: number | null; stage: Co2StageRange | null; percentOk: boolean | null; sumOk: boolean | null }

type ServiceValues = Pick<Co2Statement, 'serviceKgPerM2' | 'serviceEmissionsKg' | 'serviceAreaM2' | 'areaM2' | 'serviceLandlordPermille' | 'serviceTotalCents' | 'serviceLandlordCents'>

// Nachstufung der Angaben laut Messdienst (Entwurf 9.2): Mietfuchs ordnet den gedruckten Wert in
// die Tabelle ein. Ein ganzzahlig gedruckter Wert kann jeder Wert in [w − 0,5; w + 0,5) gewesen
// sein; passt der Anteil laut Messdienst zu einer Stufe darin, ist er stimmig. Dazu muss L zu C · ‰
// passen. `null` heißt: nicht zu prüfen, weil eine Angabe fehlt.
export function restage(st: ServiceValues, ranges: readonly Co2StageRange[], decimals: number): Restage {
  const area = st.serviceAreaM2 ?? st.areaM2
  const printed = st.serviceKgPerM2 ?? (st.serviceEmissionsKg !== null && area !== null && area > 0 ? st.serviceEmissionsKg / area : null)
  if (printed === null) return { value: null, stage: null, percentOk: null, sumOk: null }
  const value = roundSpecific(printed, decimals)
  const stage = stageOf(value, ranges)
  const permille = st.serviceLandlordPermille
  if (permille === null) return { value, stage, percentOk: null, sumOk: null }
  const candidates = st.serviceKgPerM2 !== null && Number.isInteger(st.serviceKgPerM2)
    ? ranges.filter((r) => r.from < value + 0.5 && (r.to === null || r.to > value - 0.5))
    : [stage]
  const percentOk = candidates.some((r) => r.landlordPercent * 10 === permille)
  const sumOk = st.serviceTotalCents === null || st.serviceLandlordCents === null
    ? null
    : Math.abs(st.serviceLandlordCents - (st.serviceTotalCents * permille) / 1000) <= L_TOLERANCE_CENTS
  return { value, stage, percentOk, sumOk }
}

// Was für den Ausweis nach § 7 Abs. 3 fehlt (Einstufung und Berechnungsgrundlagen), als Satzteile.
export function ausweisGaps(st: ServiceValues): string[] {
  const gaps: string[] = []
  const area = st.serviceAreaM2 ?? st.areaM2
  if (st.serviceKgPerM2 === null && (st.serviceEmissionsKg === null || area === null)) gaps.push('der CO₂-Ausstoß je Quadratmeter (oder Ausstoß und Fläche)')
  if (st.serviceLandlordPermille === null) gaps.push('der Anteil des Vermieters in Prozent')
  if (st.serviceTotalCents === null) gaps.push('die CO₂-Kosten insgesamt')
  return gaps
}

// L_self (Entwurf 7.4): der Wert laut Messdienst, sonst die Näherung L · Eigenbeträge / S. Exakt ist
// die Näherung nur bei einem linearen Schlüssel; der Ausweis nennt sie so.
export function selfLandlordRaw(landlordCents: number, usersTotalCents: number, selfNetCents: number, givenCents: number | null): { raw: number; approximated: boolean } {
  if (givenCents !== null) return { raw: givenCents, approximated: false }
  if (selfNetCents <= 0 || usersTotalCents <= 0) return { raw: 0, approximated: false }
  return { raw: (landlordCents * selfNetCents) / usersTotalCents, approximated: true }
}

// Der Anteil eines Mieters an einer Bezugsgröße: beim reinen Ausweis seine Messdienstbeträge im
// Topf, bei der eigenen Aufteilung (PR 7) sein Anteil an den Brennstoffpositionen.
export type ReliefShare = { tenancyId: string; cents: number }

// Abzug je Mieter nach Anteil (Entwurf 9.4, R-A5): r = L · x / F. Gerundet wird beim Aufrufer, als
// eine Verteilung von R = round(Σ r) mit `distributeCents`.
export function reliefsByShare(landlordCents: number, shares: readonly ReliefShare[], totalCents: number): { tenancyId: string; raw: number }[] {
  return shares.map((s) => ({ tenancyId: s.tenancyId, raw: totalCents > 0 ? (landlordCents * s.cents) / totalCents : 0 }))
}

export type ReliefProblem = { kind: 'sum'; givenCents: number } | { kind: 'tenancy'; tenancyId: string; givenCents: number; shareCents: number }

// Abzugsbeträge beim reinen Ausweis (Entwurf 7.5): die Werte laut Messdienst, geprüft auf
// Σ r ≤ L und r ≤ x. Ist das verletzt, rechnet Mietfuchs alle nach Anteil (L · x / S); fehlt nur
// ein Wert, wird nur er so ergänzt. Ein Betrag für ein Mietverhältnis ohne Messdienstbetrag im
// Topf hat den Anteil 0; jeder positive Betrag ist dann zu viel.
export function shownReliefs(
  landlordCents: number,
  usersTotalCents: number,
  shares: readonly ReliefShare[],
  given: readonly Co2TenantRelief[],
): { raws: { tenancyId: string; raw: number; approximated: boolean }[]; problem: ReliefProblem | null; missing: string[] } {
  const proportional = reliefsByShare(landlordCents, shares, usersTotalCents)
  const byId = new Map(given.map((g) => [g.tenancyId, g.cents]))
  const shareOf = new Map(shares.map((s) => [s.tenancyId, s.cents]))
  const givenCents = given.reduce((a, g) => a + g.cents, 0)
  const over = given.find((g) => g.cents > (shareOf.get(g.tenancyId) ?? 0))
  const problem: ReliefProblem | null = givenCents > landlordCents
    ? { kind: 'sum', givenCents }
    : over ? { kind: 'tenancy', tenancyId: over.tenancyId, givenCents: over.cents, shareCents: shareOf.get(over.tenancyId) ?? 0 } : null
  if (problem) return { raws: proportional.map((p) => ({ ...p, approximated: true })), problem, missing: [] }
  const missing: string[] = []
  const raws = proportional.map((p) => {
    const g = byId.get(p.tenancyId)
    if (g !== undefined) return { tenancyId: p.tenancyId, raw: g, approximated: false }
    missing.push(p.tenancyId)
    return { ...p, approximated: true }
  })
  return { raws, problem: null, missing }
}

// ---------- Töpfe (Entwurf 6.1 Nr. 4) ----------

// Ein Topf: die Positionen einer Anlage in einer Heizperiode, mit den Angaben dazu. `serviceItems`
// sind die Messdienstpositionen (Schlüssel `amounts`), über die allein die Probe läuft (W9);
// `foreign` die übrigen. `carrierId` ist die Position, in der L steckt: die gewählte, sonst die
// größte Messdienstposition. Welche es ist, ändert nur, wie sich der Vermieteranteil zerlegt, nicht,
// was die Mieter tragen. `reliefKey` kennzeichnet die Zeilen ohne Position (Abzugszeilen).
export type Co2Pot = {
  plantId: string
  plantName: string
  energy: HeatingEnergy
  method: HeatingMethod
  source: HeatingSource
  period: BillingPeriod
  items: SnapshotCostItem[]
  serviceItems: SnapshotCostItem[]
  foreign: SnapshotCostItem[]
  statement: Co2Statement | null
  hotWater: SnapshotHeatingPeriodRow | null
  probe: ProbeResult | null
  carrierId: string | null
  reliefKey: string
}

// Ein Topf je Anlage im Zeitraum dieser Berechnung (Entwurf 6.1 Nr. 4.1). Seit Heizung PR 5 rechnet
// `computeSettlement` jede Heizperiode einer Anlage mit eigener Heizperiode für sich: nach Weg b als
// Teilabrechnung (`scope: 'heatingPart'`), nach Weg d als Heizkostenabrechnung (`heatingSnapshotFor`);
// der Zeitraum der Berechnung ist dann die Heizperiode, und ihre Positionen stehen in `items`. Ohne
// eigene Heizperiode ist die Heizperiode der Zeitraum des Objekts. In jedem Fall ist der Topf: die
// Positionen der Anlage mit dem Schlüssel des Zeitraums. In P ist der Topf einer Anlage mit eigener
// Heizperiode deshalb leer, denn ihre Positionen stehen in `heatingParts` (snapshot.ts).
export function co2PotsOf(snapshot: Snapshot, items: readonly SnapshotCostItem[]): Co2Pot[] {
  const period = snapshot.period
  return (snapshot.heatingPlants ?? []).map((plant): Co2Pot => {
    const pot = items.filter((c) => c.category === HEATING_CATEGORY && c.heatingPlantId === plant.id && c.period === period.key)
    const serviceItems = pot.filter((c) => c.key === 'amounts')
    // Angaben laut Messdienst gelten nur bei einer Anlage, die ein Messdienst oder die Gemeinschaft
    // abrechnet; die Routen sperren den Wechsel (Durchsicht M-3), ein Archiv kann trotzdem eine
    // andere Lage bringen.
    const statement = plant.method !== 'service' ? null : (snapshot.co2Statements ?? []).find((s) => s.plantId === plant.id && s.period === period.key) ?? null
    let probe: ProbeResult | null = null
    if (
      statement && (statement.method === 'serviceDeducted' || statement.method === 'serviceShown') &&
      statement.serviceUsersTotalCents !== null && statement.serviceLandlordCents !== null && statement.serviceUnitsCount !== null
    ) {
      probe = serviceProbe({
        deducted: statement.method === 'serviceDeducted',
        items: serviceItems,
        usersTotalCents: statement.serviceUsersTotalCents,
        landlordCents: statement.serviceLandlordCents,
        unitsCount: statement.serviceUnitsCount,
        approx: statement.serviceUsersTotalApprox,
      })
    }
    const chosen = serviceItems.find((c) => c.id === statement?.serviceCostItemId)
    const largest = serviceItems.reduce<SnapshotCostItem | null>((a, c) => (a === null || c.amountCents > a.amountCents ? c : a), null)
    return {
      plantId: plant.id,
      plantName: plant.name ?? '',
      energy: plant.energy,
      method: plant.method,
      source: plant.source,
      period,
      items: pot,
      serviceItems,
      foreign: pot.filter((c) => c.key !== 'amounts'),
      statement,
      hotWater: (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === plant.id && r.period === period.key) ?? null,
      probe,
      carrierId: (chosen ?? largest)?.id ?? null,
      reliefKey: `co2:${plant.id}:${period.key}`,
    }
  })
}

// ---------- Vorwegabzug (Entwurf 7.4) ----------

// `toleranceCents`: der Rundungsspielraum der Probe (NE · 2 ct). Kappt `take()` den co2Share um mehr,
// steckt L vermutlich in einer anderen Position (Durchsicht M-2).
export type Co2Deduction = { landlordCents: number; selfRaw: number; selfApproximated: boolean; toleranceCents: number }

// Beim Vorwegabzug mit bestandener Probe (mit geschätztem S im weiteren Spielraum) die Zerlegung des Vermieterrests
// in der Position, in der L steckt: L_self (laut Messdienst, sonst L · Eigenbeträge / S) und den
// abziehbaren Rest. Die Eigenbeträge sind die der selbstgenutzten Wohnungen in den
// Messdienstpositionen des Topfs. `applicable` fragt das Register (`co2.applicable-from`), und nur
// für Töpfe mit einem solchen Datensatz.
export function co2DeductionsOf(pots: readonly Co2Pot[], units: readonly SnapshotUnit[], applicable: (period: BillingPeriod) => boolean): Map<string, Co2Deduction> {
  const selfUsed = new Set(units.filter((u) => u.selfUsed && !u.participates).map((u) => u.id))
  const out = new Map<string, Co2Deduction>()
  for (const pot of pots) {
    const st = pot.statement
    if (!st || st.method !== 'serviceDeducted' || !pot.probe || pot.carrierId === null) continue
    // Ein geschätztes S weitet nur den Spielraum der Probe (serviceProbe); geht sie nicht auf, wird
    // nichts gebucht (Durchsicht I-2: sonst stand der CO₂-Teil der eigenen Wohnung zweimal privat).
    if (!pot.probe.ok) continue
    if (!applicable(pot.period)) continue
    const L = st.serviceLandlordCents ?? 0
    const S = st.serviceUsersTotalCents ?? 0
    const selfNet = pot.serviceItems.reduce(
      (a, c) => a + Object.entries(c.selfAmounts ?? {}).filter(([id]) => selfUsed.has(id)).reduce((b, [, x]) => b + Math.max(0, x), 0),
      0,
    )
    const self = selfLandlordRaw(L, S, selfNet, st.serviceSelfLandlordCents)
    out.set(pot.carrierId, { landlordCents: L, selfRaw: self.raw, selfApproximated: self.approximated, toleranceCents: pot.probe.toleranceCents })
  }
  return out
}

// ---------- Ausweis (Entwurf 7.4 „Ausweis“, 9.5) ----------

// Die Zeilen je Mieter: „vom Vermieter übernommen“ (beim reinen Ausweis die gebuchte Abzugszeile,
// sonst der Wert laut Messdienst oder L · x / S als Anzeige ohne Buchung) und „in Ihren Heizkosten
// enthalten“ als (C − L) · x / S, ohne C nicht. `shares` sind die Messdienstbeträge des Mieters im
// Topf.
export function tenantLines(st: Co2Statement, shares: readonly ReliefShare[], printed: ReadonlyMap<string, { cents: number; approximated: boolean }>): Co2TenantLine[] {
  const S = st.serviceUsersTotalCents ?? 0
  const L = st.serviceLandlordCents ?? 0
  const given = new Map(st.reliefs.map((r) => [r.tenancyId, r.cents]))
  return shares.map((s) => {
    const booked = printed.get(s.tenancyId)
    const g = given.get(s.tenancyId)
    const landlordCents = booked ? booked.cents : g ?? (S > 0 ? Math.round((L * s.cents) / S) : 0)
    const approximated = booked ? booked.approximated : g === undefined
    const tenantCents = st.serviceTotalCents !== null && S > 0 ? Math.round(((st.serviceTotalCents - L) * s.cents) / S) : null
    return { tenancyId: s.tenancyId, landlordCents, tenantCents, approximated }
  })
}

export function co2Assessment(
  st: Co2Statement,
  re: Restage,
  p: { booked: boolean; ranges: Co2StageRange[]; shortened: boolean; deduction: Co2Deduction | undefined; tenants: Co2TenantLine[] },
): Co2Assessment {
  return {
    method: st.method,
    booked: p.booked,
    deducted: st.method === 'serviceDeducted',
    totalCents: st.serviceTotalCents,
    landlordCents: st.serviceLandlordCents,
    landlordPermille: st.serviceLandlordPermille,
    kgPerM2: re.value,
    emissionsKg: st.serviceEmissionsKg,
    areaM2: st.serviceAreaM2 ?? st.areaM2,
    stage: re.stage,
    table: p.ranges,
    shortened: p.shortened,
    stageMatches: re.percentOk,
    selfLandlordCents: p.deduction ? Math.round(p.deduction.selfRaw) : null,
    selfApproximated: p.deduction?.selfApproximated ?? false,
    tenants: p.tenants,
  }
}
