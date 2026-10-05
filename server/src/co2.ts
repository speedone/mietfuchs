// CO₂-Kostenaufteilung (Heizung PR 6, #97, #209; Entwurf 7, 9.2, 9.4). Reine Funktionen. Die
// Rechtswerte reicht der Aufrufer aus dem Register herein (`law()` protokolliert sie); hier steht
// keine Zahl der Stufentabelle und kein Datum (law-literals.test.ts).
import type { Co2Stage } from '../../shared/law/co2kostaufg.ts'
import type { Co2StageRange, Co2Statement, Co2TenantRelief, DhwMethod, HeatingEnergy } from '../../shared/types.ts'

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
